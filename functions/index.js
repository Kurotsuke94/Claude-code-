const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
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

// ── METER OVERCONSUMPTION DETECTOR — event-driven, no polling ──────────────
// Fires on every create/update/delete of a cso_readings document. Never trusts
// the event payload's `consumption` field (it may still hold the client's
// pre-recalc heuristic value) — it always re-reads the meter's true two most
// recent readings from Firestore and derives the delta itself from their raw
// `index` values. It never writes to `index`/`consumption`: that calculation
// stays entirely owned by consommations.js (_saveReading / _recalcMeter).
const CSO_ALERT_COOLDOWN_MIN = 60;   // minutes between repeat push notifications for a still-active anomaly
const CSO_AUTO_WARN_PCT      = 30;   // mirrors the existing client-side thresholds (consommations.js _detectAlerts)
const CSO_AUTO_CRIT_PCT      = 80;
const CSO_MANUAL_CRIT_MULT   = 1.5;  // manual mode: critical = seuil × 1.5
const CSO_MIN_ELAPSED_HOURS  = 1;    // ignore readings closer together than this — too noisy to normalize to 24h

function _tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts._seconds != null) return ts._seconds * 1000;
  if (ts.seconds  != null) return ts.seconds * 1000;
  return 0;
}

async function _cso_resolveIfActive(alertRef) {
  const snap = await alertRef.get();
  if (!snap.exists) return null;
  if (snap.data().status !== "active") return null;
  return alertRef.set(
    { status: "resolved", resolvedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function _cso_notifyOverconsumption(db, meter, meterId, level, msg) {
  // ── Centre d'informations ── idempotent per cooldown window (burst-safe: several
  // Cloud Function invocations from the same client recalc batch collapse to one doc).
  const bucket   = Math.floor(Date.now() / (CSO_ALERT_COOLDOWN_MIN * 60000));
  const notifRef = db.collection("notifications").doc(`cso_overconsumption_${meterId}_${bucket}`);
  const notifSnap = await notifRef.get();
  if (!notifSnap.exists) {
    await notifRef.set({
      type: "counter", level,
      title: `Surconsommation — ${meter.name || "Compteur"}`,
      description: msg, icon: "🚨", author: "Maintix", userId: "all",
      data: { meterId }, read: false, archived: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // ── Push FCM aux utilisateurs autorisés (droit "counters" > "view") ──
  const [usersSnap, rolesSnap, tokensSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("roles").get(),
    db.collection("fcmTokens").get(),
  ]);
  const roles = {};
  rolesSnap.docs.forEach(d => { roles[d.id] = d.data(); });
  const authorizedNames = new Set();
  usersSnap.docs.forEach(d => {
    const u = d.data();
    if (!u.name) return;
    if (u.role === "responsable") { authorizedNames.add(u.name); return; }
    if (u.roleId) {
      const role = roles[u.roleId];
      if (role && role.permissions && role.permissions.counters && role.permissions.counters.view) {
        authorizedNames.add(u.name);
      }
    } else {
      authorizedNames.add(u.name); // legacy technicien fallback — counters view granted by default
    }
  });

  const tokens = tokensSnap.docs
    .filter(d => authorizedNames.has(d.data().userName))
    .map(d => d.data().token)
    .filter(Boolean);
  if (!tokens.length) return null;

  return admin.messaging().sendEachForMulticast({
    tokens: [...new Set(tokens)],
    notification: {
      title: level === "critical" ? "🚨 Surconsommation critique" : "⚠️ Surconsommation détectée",
      body:  `${meter.name || "Compteur"} — ${msg}`
    },
    webpush: {
      notification: { icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png", vibrate: [200,100,200] },
      fcm_options:  { link: "/" }
    }
  }).catch(e => console.error("[onReadingWritten] Erreur FCM :", e));
}

exports.onReadingWritten = onDocumentWritten(
  { document: "cso_readings/{readingId}", region: REGION },
  async event => {
    const after  = event.data.after;
    const before = event.data.before;
    const data   = (after && after.exists) ? after.data() : ((before && before.exists) ? before.data() : null);
    const meterId = data && data.meterId;
    if (!meterId) return null;

    const db = admin.firestore();
    const meterRef  = db.collection("cso_meters").doc(meterId);
    const meterSnap = await meterRef.get();
    if (!meterSnap.exists) return null;
    const meter = meterSnap.data();

    const alertRef = db.collection("cso_energy_alerts").doc(`overconsumption_${meterId}`);

    // Manually disabled — leave any existing alert state exactly as it was
    // (the client turns it off explicitly when the meter is disabled).
    if (meter.alertEnabled === false) return null;

    // Re-derive the two chronologically most recent readings directly from
    // Firestore — never trust the triggering event's own snapshot.
    const latestSnap = await db.collection("cso_readings")
      .where("meterId", "==", meterId)
      .orderBy("date", "desc")
      .orderBy("createdAt", "desc")
      .limit(2)
      .get();
    const latest = latestSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (latest.length < 2) return _cso_resolveIfActive(alertRef);

    const [cur, prev] = latest;
    if (cur.index == null || prev.index == null || !cur.createdAt || !prev.createdAt) {
      return _cso_resolveIfActive(alertRef);
    }

    const elapsedHours = (_tsToMs(cur.createdAt) - _tsToMs(prev.createdAt)) / 3600000;
    if (elapsedHours < CSO_MIN_ELAPSED_HOURS) return null; // not enough signal — leave state as-is

    const rawDelta = cur.index - prev.index;
    if (rawDelta < 0) return _cso_resolveIfActive(alertRef); // index reset / meter replaced

    const consumption24h = rawDelta / elapsedHours * 24;
    const mode = meter.alertMode === "manual" ? "manual" : "auto";

    let level = null, reference = null, ecartPct = null;

    if (mode === "manual") {
      const ref = Number(meter.alertManualRef);
      if (!ref || ref <= 0) return _cso_resolveIfActive(alertRef); // no seuil configuré
      reference = ref;
      ecartPct  = Math.round((consumption24h - ref) / ref * 100);
      if (consumption24h > ref * CSO_MANUAL_CRIT_MULT) level = "critical";
      else if (consumption24h > ref)                    level = "warning";
    } else {
      const refDays = Number(meter.alertRefDays) || 30;
      const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - refDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const histSnap = await db.collection("cso_readings")
        .where("meterId", "==", meterId)
        .orderBy("date", "desc")
        .limit(refDays + 5) // small buffer — readings are roughly one per day
        .get();
      const histVals = histSnap.docs
        .filter(d => d.id !== cur.id)
        .map(d => d.data())
        .filter(r => r.consumption != null && r.consumption > 0 && (r.date || "") >= cutoffStr);
      if (histVals.length < 3) return _cso_resolveIfActive(alertRef); // pas assez d'historique
      const avg = histVals.reduce((s, r) => s + r.consumption, 0) / histVals.length;
      if (avg <= 0) return _cso_resolveIfActive(alertRef);
      reference = avg;
      ecartPct  = Math.round((consumption24h - avg) / avg * 100);
      if (ecartPct > CSO_AUTO_CRIT_PCT)      level = "critical";
      else if (ecartPct > CSO_AUTO_WARN_PCT) level = "warning";
    }

    if (!level) return _cso_resolveIfActive(alertRef);

    const unit = meter.unit || "";
    const msg  = `Consommation mesurée : ${consumption24h.toFixed(2)} ${unit} / 24h — habituelle : ${reference.toFixed(2)} ${unit} (${ecartPct > 0 ? "+" : ""}${ecartPct}%)`;

    const existingSnap = await alertRef.get();
    const existing  = existingSnap.exists ? existingSnap.data() : null;
    const wasActive = !!(existing && existing.status === "active");
    const now = admin.firestore.FieldValue.serverTimestamp();

    const payload = {
      type: "surconsommation", level, status: "active",
      meterId, meterName: meter.name || "", metric: meter.type || "", zone: meter.location || "",
      title: "Surconsommation détectée", msg,
      measured:  Math.round(consumption24h * 1000) / 1000,
      reference: Math.round(reference * 1000) / 1000,
      ecart: ecartPct, unit, mode, readingId: cur.id,
      ts: now, lastTriggeredAt: now,
    };
    if (!wasActive) {
      // New occurrence (doc absent, or was previously resolved): reset the
      // acknowledgement/resolution trail so it surfaces again as new.
      payload.firstTriggeredAt = now;
      payload.acknowledged     = false;
      payload.acknowledgedAt   = admin.firestore.FieldValue.delete();
      payload.acknowledgedBy   = admin.firestore.FieldValue.delete();
      payload.resolvedAt       = admin.firestore.FieldValue.delete();
    }
    await alertRef.set(payload, { merge: true });

    // Already-active anomaly that the user acknowledged — state stays live,
    // but no repeat notification until it resolves and fires anew.
    if (wasActive && existing.acknowledged) return null;

    const lastNotifiedMs   = existing ? _tsToMs(existing.notifiedAt) : 0;
    const cooldownElapsed  = (Date.now() - lastNotifiedMs) > CSO_ALERT_COOLDOWN_MIN * 60000;
    if (wasActive && !cooldownElapsed) return null;

    await alertRef.set({ notifiedAt: now }, { merge: true });
    return _cso_notifyOverconsumption(db, meter, meterId, level, msg);
  }
);
