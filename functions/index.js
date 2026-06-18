const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const admin                 = require("firebase-admin");
admin.initializeApp();

const REGION      = "europe-west1";
const SLOT_LABELS = { matin: "Matin", journee: "Journée", soir: "Soir" };
const DAY_IDS     = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

// ── PUSH ON NEW MISSION ──
exports.onNewMission = onDocumentCreated(
  { document: "missions/{missionId}", region: REGION },
  async event => {
    const snap = event.data;
    if (!snap) return null;
    const { text, assignedTo, createdBy } = snap.data();
    const db = admin.firestore();

    const tokensSnap = await db.collection("fcmTokens").get();
    let tokens = [];

    if (!assignedTo || assignedTo === "all") {
      tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
    } else {
      tokens = tokensSnap.docs
        .filter(d => d.data().userName === assignedTo)
        .map(d => d.data().token).filter(Boolean);
    }

    if (!tokens.length) return null;

    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: "🚨 Nouvelle mission",
        body:  text + (createdBy ? " — de " + createdBy : "")
      },
      webpush: {
        notification: { icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png", vibrate: [200,100,200] },
        fcm_options:  { link: "/" }
      }
    });

    // Remove stale tokens
    const batch = db.batch();
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
          batch.delete(db.collection("fcmTokens").doc(tokens[i]));
        }
      }
    });
    return batch.commit();
  }
);

// ── SCHEDULED REMINDERS (every 15 min) ──
exports.slotReminders = onSchedule(
  { schedule: "every 15 minutes", timeZone: "Europe/Paris", region: REGION },
  async () => {
    const db  = admin.firestore();
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    const hh  = now.getHours().toString().padStart(2,"0");
    const mm  = now.getMinutes().toString().padStart(2,"0");
    const cur = `${hh}:${mm}`;
    const todayId = DAY_IDS[now.getDay()];

    const [alertsDoc, checksDoc, assignDoc, teamsDoc, tokensSnap] = await Promise.all([
      db.collection("config").doc("alerts").get(),
      db.collection("config").doc("checks").get(),
      db.collection("config").doc("assignments").get(),
      db.collection("config").doc("teams").get(),
      db.collection("fcmTokens").get()
    ]);

    if (!alertsDoc.exists) return null;

    const alerts      = alertsDoc.data();
    const checks      = checksDoc.exists  ? checksDoc.data()  : {};
    const assignments = assignDoc.exists  ? assignDoc.data()  : {};
    const teams       = teamsDoc.exists   ? teamsDoc.data()   : {};

    const tokensByUser = {};
    tokensSnap.docs.forEach(d => {
      const { token, userName } = d.data();
      if (!token || !userName) return;
      if (!tokensByUser[userName]) tokensByUser[userName] = [];
      tokensByUser[userName].push(token);
    });

    const sends = [];
    for (const slot of ["matin","journee","soir"]) {
      const alert = alerts[slot];
      if (!alert || !alert.active || !alert.deadline) continue;
      if (!_near(cur, alert.deadline)) continue;

      const tasksDoc = await db.collection("tasks").doc(`${todayId}_${slot}`).get();
      if (!tasksDoc.exists) continue;

      const items     = tasksDoc.data().items || [];
      const done      = items.filter(t => checks[`${todayId}_${slot}_${t.id}`]).length;
      if (done >= items.length && items.length > 0) continue;

      const remaining = items.length - done;
      const recipients = new Set([
        assignments[`${todayId}_${slot}`],
        ...(teams[slot] || [])
      ].filter(Boolean));

      const tokens = [];
      recipients.forEach(n => { if (tokensByUser[n]) tokens.push(...tokensByUser[n]); });
      if (!tokens.length) continue;

      sends.push(admin.messaging().sendEachForMulticast({
        tokens: [...new Set(tokens)],
        notification: {
          title: `⏰ Rappel ${SLOT_LABELS[slot]} — ${alert.deadline}`,
          body:  `${remaining} tâche${remaining > 1 ? "s" : ""} non complétée${remaining > 1 ? "s" : ""}`
        },
        webpush: {
          notification: { icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png" },
          fcm_options:  { link: "/" }
        }
      }));
    }

    return Promise.all(sends);
  }
);

function _near(cur, deadline) {
  const toMin = s => { const [h,m] = s.split(":").map(Number); return h * 60 + m; };
  return Math.abs(toMin(cur) - toMin(deadline)) <= 8;
}
