const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
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

// ── RATIO-PAR-CLIENT ALERT DETECTOR (Phase 9.1) ─────────────────────────────
// Catégorie NOUVELLE et SÉPARÉE ('ratio_client'), totalement indépendante du
// détecteur ci-dessus (catégorie 'surconsommation'/'anomalie_compteur',
// volume brut normalisé/24h) : trigger distinct sur le même document
// cso_readings, mais ID de doc déterministe différent
// (ratio_client_{meterId} vs overconsumption_{meterId}) — aucun des deux ne
// peut jamais écraser l'autre.
//
// Ne surveille QUE les compteurs explicitement listés dans
// cso_perf_config/ref_meters[type] (compteurs généraux sélectionnés dans
// Performance) — jamais un repli sur "tous les compteurs du type" (même
// principe strict que _generalMeterIds() côté client, jamais celui, permissif,
// de _refMeterIds()). Réutilise l'objectif + la tolérance déjà configurés
// dans cso_perf_config/objectifs — aucune nouvelle configuration créée.
//
// Le ratio est calculé avec la même formule déjà validée que
// _monthlyRealRatio() côté client (index de fin de mois − index de début de
// mois, ÷ clients de la même période) — réimplémentée ici en Node car une
// Cloud Function ne peut pas importer consommations.js (dépendant du DOM).
// Aucun nouvel index Firestore composite requis : la requête cso_readings
// ci-dessous (une seule égalité meterId + un seul orderBy) reproduit
// exactement la forme déjà utilisée en production par le mode "auto" du
// détecteur ci-dessus ; la requête cso_clients n'utilise qu'un encadrement
// sur un unique champ (date), sans index composite nécessaire non plus.
const CSO_LITER_RATIO_TYPES = new Set(["eau_froide", "eau_chaude"]); // reflète MT[type].literRatio côté client

function _cso_monthBounds(now) {
  const y = now.getFullYear(), m = now.getMonth();
  const mm = String(m + 1).padStart(2, "0");
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

// Même algorithme que consommations.js _lastIndexAt, appliqué à une liste de
// relevés déjà récupérée (au lieu du tableau _readings en mémoire du client).
function _cso_lastIndexAt(readings, dateBound, strictBefore) {
  let best = null;
  for (const r of readings) {
    if (r.index == null || !r.date) continue;
    const ok = strictBefore ? r.date < dateBound : r.date <= dateBound;
    if (!ok) continue;
    if (!best || r.date > best.date || (r.date === best.date && _tsToMs(r.createdAt) > _tsToMs(best.createdAt))) best = r;
  }
  return best ? best.index : null;
}

exports.onReadingWrittenRatioClient = onDocumentWritten(
  { document: "cso_readings/{readingId}", region: REGION },
  async event => {
    const after  = event.data.after;
    const before = event.data.before;
    const data   = (after && after.exists) ? after.data() : ((before && before.exists) ? before.data() : null);
    const meterId = data && data.meterId;
    if (!meterId) return null;

    const db = admin.firestore();
    const meterSnap = await db.collection("cso_meters").doc(meterId).get();
    if (!meterSnap.exists) return null;
    const meter = meterSnap.data();
    const type  = meter.type;

    const alertRef = db.collection("cso_energy_alerts").doc(`ratio_client_${meterId}`);

    // Compteur non désigné "compteur général" pour ce type -> jamais évalué
    // (exclut les sous-compteurs par défaut, sans exception).
    const refSnap = await db.collection("cso_perf_config").doc("ref_meters").get();
    const refIds  = (refSnap.exists && Array.isArray(refSnap.data()[type])) ? refSnap.data()[type] : [];
    if (!refIds.includes(meterId)) return _cso_resolveIfActive(alertRef);

    // Objectif & tolérance déjà configurés dans Performance (cso_perf_config/
    // objectifs) — jamais une valeur inventée si absente pour ce type.
    const objSnap = await db.collection("cso_perf_config").doc("objectifs").get();
    const obj = objSnap.exists ? objSnap.data()[type] : null;
    const target = obj && Number(obj.target) > 0 ? Number(obj.target) : null;
    if (!target) return _cso_resolveIfActive(alertRef); // "Objectif non configuré"
    const tolerance = (obj.tolerance != null && !isNaN(Number(obj.tolerance))) ? Number(obj.tolerance) : 10;

    const now = new Date();
    const { start, end } = _cso_monthBounds(now);
    const monthKey = start.slice(0, 7);

    const readingsSnap = await db.collection("cso_readings")
      .where("meterId", "==", meterId)
      .orderBy("date", "desc")
      .limit(500)
      .get();
    const readings = readingsSnap.docs.map(d => d.data());

    const startIdx = _cso_lastIndexAt(readings, start, true);
    const endIdx   = _cso_lastIndexAt(readings, end, false);
    if (startIdx === null || endIdx === null) return _cso_resolveIfActive(alertRef); // "Données insuffisantes"
    const delta = endIdx - startIdx;
    if (delta < 0) return _cso_resolveIfActive(alertRef); // "Consommation incohérente" — jamais un ratio négatif

    const clientsSnap = await db.collection("cso_clients")
      .where("date", ">=", start)
      .where("date", "<=", end)
      .get();
    let clients = 0, hasClients = false;
    clientsSnap.docs.forEach(d => {
      const v = d.data().count;
      if (typeof v === "number" && v > 0) { clients += v; hasClients = true; }
    });
    if (!hasClients) return _cso_resolveIfActive(alertRef); // "Clients indisponibles" — jamais de ratio inventé

    const ratio = CSO_LITER_RATIO_TYPES.has(type) ? (delta * 1000 / clients) : (delta / clients);

    // Seuils dérivés automatiquement de l'objectif + tolérance déjà
    // configurés — aucun seuil fixe compteur par compteur.
    const warnThreshold = target * (1 + tolerance / 100);
    const critThreshold = target * (1 + 2 * tolerance / 100);
    let level = null;
    if (ratio > critThreshold) level = "critical";
    else if (ratio > warnThreshold) level = "warning";
    if (!level) return _cso_resolveIfActive(alertRef); // dans l'objectif ou la tolérance -> pas d'alerte / clôture

    const existingSnap = await alertRef.get();
    const existing  = existingSnap.exists ? existingSnap.data() : null;
    const wasActive = !!(existing && existing.status === "active");
    const ts = admin.firestore.FieldValue.serverTimestamp();
    const ecartPct = Math.round((ratio - target) / target * 100);
    const rUnit = CSO_LITER_RATIO_TYPES.has(type) ? "L" : (meter.unit || "");

    const payload = {
      category: "ratio_client", type: "ratio_client", level, status: "active",
      meterId, meterName: meter.name || "", metric: type, zone: meter.location || "",
      title: "Ratio par client au-dessus de l'objectif",
      msg: `${meter.name || "Compteur"} — ${Math.round(ratio * 100) / 100} ${rUnit}/client vs objectif ${target} ${rUnit}/client (+${ecartPct}%)`,
      ratio: Math.round(ratio * 1000) / 1000, target, tolerance,
      warnThreshold: Math.round(warnThreshold * 1000) / 1000,
      critThreshold: Math.round(critThreshold * 1000) / 1000,
      ecart: ecartPct, unit: rUnit, clients, period: monthKey,
      ts, lastTriggeredAt: ts,
    };
    if (!wasActive) {
      payload.firstTriggeredAt = ts;
      payload.acknowledged     = false;
      payload.acknowledgedAt   = admin.firestore.FieldValue.delete();
      payload.acknowledgedBy   = admin.firestore.FieldValue.delete();
      payload.resolvedAt       = admin.firestore.FieldValue.delete();
    }
    return alertRef.set(payload, { merge: true });
  }
);

// ── CTA/VC — PERSISTANCE QUOTIDIENNE DES DJU OBSERVÉS ──
// PRÉPARÉE MAIS NON DÉPLOYÉE : cette fonction n'existe que dans ce fichier
// source tant que `firebase deploy --only functions` n'a pas été exécuté
// explicitement avec l'accord de l'utilisateur — aucune ressource Firebase
// n'est créée par la seule présence de ce code.
//
// Comble le point faible du mécanisme client (assets/js/app.js :
// _ensureDailyDjuPersisted) : celui-ci n'écrit weather_daily que lorsqu'une
// session ouvre l'application et que la météo se charge avec succès — si
// personne ne se connecte un jour donné, ce jour reste vide. Cette tâche
// planifiée garantit la continuité indépendamment de toute ouverture de
// l'app.
//
// Idempotence : avant tout appel réseau, vérifie si le document du jour
// cible existe déjà avec kind:"observed" POUR LA MÊME LOCALISATION (lat/lon
// identiques à la config actuelle) — si oui, ne refait rien. Ne retraite
// donc jamais un jour déjà finalisé, y compris en cas de ré-exécution
// manuelle ou de double déclenchement. Si la localisation a changé depuis
// cette écriture, le jour est reconstruit avec les nouvelles coordonnées
// (jamais de donnée d'une ancienne localisation conservée silencieusement
// sous la même date) — voir _yesterdayParisDateStr ci-dessous.
//
// Toujours la veille (hier, Europe/Paris) : jamais "aujourd'hui", dont la
// journée n'est pas terminée — mêmes règles observé/prévisionnel que
// assets/js/utils/dju.js (buildDailySeries), dupliquées ici en pur Node
// (pas d'accès à window.MX côté Cloud Function) ; à maintenir manuellement
// synchronisées si la méthode de calcul évolue côté client. Le calcul de
// "hier" est purement calendaire (voir _yesterdayParisDateStr), pas une
// soustraction de 24h en millisecondes, pour rester fiable lors des
// changements d'heure Europe/Paris.
// REFONTE CTA/VC : cette constante reste volontairement figée à 19 et n'est
// PAS rendue configurable ici. weather_daily.dju19 est la valeur HISTORIQUE
// de référence, écrite une seule fois par jour observé — la rendre
// dépendante d'une configuration changeante romprait l'idempotence par
// contenu ci-dessous (_persistOneObservedDay) et réinterpréterait
// silencieusement l'historique à chaque changement de réglage.
// La référence DJU CONFIGURABLE (config/heating_config.djuBaseTemp, voir
// firestore.rules.draft-claims-migration et assets/js/utils/dju.js) est
// calculée UNIQUEMENT côté client, à la volée, à partir de `tMean` (donnée
// brute, toujours préservée ci-dessous, jamais recalculée ici) — voir
// MX.Dju.computeAt()/recomputeStoredDay(). Aucun recalcul destructif n'a
// jamais lieu côté serveur : si cette fonction était un jour étendue pour
// écrire aussi une valeur à référence configurable, elle devrait ajouter un
// NOUVEAU champ distinct (jamais réécrire dju19) et lire elle-même
// config/heating_config — non fait ici tant qu'aucun besoin serveur réel
// (ex. alerte automatisée) ne le justifie.
const DJU_BASE_TEMP = 19;
// Open-Meteo n'a pas de délai explicite côté serveur (contrairement au
// client, voir assets/js/utils/weather.js:FETCH_TIMEOUT_MS=6000) : sans
// AbortController, une réponse qui ne vient jamais ferait attendre la
// fonction jusqu'à la limite de la plateforme, avec un journal peu clair.
// Valeur plus généreuse que côté client (personne n'attend cet appel).
const OPEN_METEO_TIMEOUT_MS = 10000;
// Fenêtre de rattrapage des jours passés déjà présents dans la réponse
// Open-Meteo (voir plus bas) — DOIT rester <= past_days de l'URL ci-dessous :
// on ne traite jamais un jour hors de ce qui a été explicitement demandé,
// même si l'API renvoyait un jour inattendu.
const BACKFILL_WINDOW_DAYS = 3;
function _parisDateStr(d) {
  // en-CA produit directement AAAA-MM-JJ, sans ambiguïté de format.
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}
// Date calendaire de la veille, en Europe/Paris — calcul PUREMENT calendaire
// (jamais une simple soustraction de 24h en millisecondes, qui peut dériver
// d'environ 1h lors des deux changements d'heure annuels et produire la
// mauvaise date calendaire pour un déclenchement proche de minuit). On part
// de la date du jour (déjà en Europe/Paris), on la décompose en Y/M/D, on
// reconstruit un instant UTC à midi ce même jour calendaire (toujours dans
// la bonne date quel que soit le décalage UTC+1/UTC+2 de Paris) puis on
// retire exactement UN jour calendaire via setUTCDate — jamais une durée en
// millisecondes.
function _yesterdayParisDateStr(now) {
  const todayStr = _parisDateStr(now);
  const parts = todayStr.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1);
  return _parisDateStr(noonUtc);
}
// Même méthode calendaire que _yesterdayParisDateStr, généralisée à un
// nombre de jours arbitraire — fonction INDÉPENDANTE (ne modifie pas
// _yesterdayParisDateStr, dont le texte exact est extrait tel quel par
// tests/dju_scheduled_function_test.js) utilisée uniquement pour borner la
// fenêtre de rattrapage ci-dessous.
function _minBackfillDateStr(now, windowDays) {
  const todayStr = _parisDateStr(now);
  const parts = todayStr.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  noonUtc.setUTCDate(noonUtc.getUTCDate() - windowDays);
  return _parisDateStr(noonUtc);
}
function _estimateDailyMean(tMin, tMax, tMeanApi) {
  if (typeof tMeanApi === "number" && !isNaN(tMeanApi)) return { value: tMeanApi, method: "api_mean" };
  if (typeof tMin === "number" && typeof tMax === "number") return { value: (tMin + tMax) / 2, method: "minmax_avg" };
  return { value: null, method: null };
}

// Traite UN jour (déjà présent dans la réponse Open-Meteo reçue par
// l'appelant, aucun appel réseau ici) : idempotence par contenu (identique à
// l'ancien comportement), calcul mean/DJU19, écriture. Factorisé pour être
// appliqué à "hier" ET aux jours de rattrapage ci-dessous SANS dupliquer la
// logique. Retourne un statut (jamais d'exception) pour le résumé journalisé
// par l'appelant.
async function _persistOneObservedDay(db, dateStr, idx, daily, cfg) {
  const docRef = db.collection("weather_daily").doc(dateStr);
  let existing;
  try {
    existing = await docRef.get();
  } catch (e) {
    console.error(`[computeDailyWeatherDju] Lecture Firestore impossible pour ${dateStr} :`, e.message || e);
    return "firestore_read_error";
  }
  const existingData = existing.exists ? existing.data() : null;
  // Idempotence par CONTENU, pas seulement par présence : un jour déjà
  // "observed" pour la MÊME localisation n'est jamais retraité (rejouer la
  // fonction plusieurs fois ne produit aucun doublon ni écriture inutile).
  // En revanche, si la localisation configurée a changé depuis cette
  // écriture (lat/lon différents), l'ancienne valeur ne représente plus
  // l'établissement réel : on la remplace plutôt que de la laisser
  // silencieusement sous la même date — voir aussi assets/js/app.js pour
  // la même règle côté client.
  const sameLocation = !!existingData
    && typeof existingData.lat === "number" && typeof existingData.lon === "number"
    && Math.abs(existingData.lat - cfg.lat) < 1e-6 && Math.abs(existingData.lon - cfg.lon) < 1e-6;
  if (existingData && existingData.kind === "observed" && sameLocation) {
    console.log(`[computeDailyWeatherDju] ${dateStr} déjà enregistré (observed, même localisation) — idempotence, rien à refaire.`);
    return "already_observed";
  }

  const tMin = typeof daily.temperature_2m_min[idx] === "number" ? daily.temperature_2m_min[idx] : null;
  const tMax = typeof daily.temperature_2m_max[idx] === "number" ? daily.temperature_2m_max[idx] : null;
  const tMeanApi = daily.temperature_2m_mean ? daily.temperature_2m_mean[idx] : undefined;
  const mean = _estimateDailyMean(tMin, tMax, tMeanApi);
  if (mean.value === null) {
    console.warn(`[computeDailyWeatherDju] Aucune température exploitable pour ${dateStr} — rien enregistré.`);
    return "no_usable_temperature";
  }
  const dju19 = Math.max(0, DJU_BASE_TEMP - mean.value);

  try {
    await docRef.set({
      date: dateStr,
      tMin, tMax,
      tMean: Math.round(mean.value * 10) / 10,
      meanMethod: mean.method,
      dju19: Math.round(dju19 * 10) / 10,
      djuMethod: mean.method,
      kind: "observed",
      source: "cloud-function-scheduled",
      lat: cfg.lat, lon: cfg.lon,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error(`[computeDailyWeatherDju] Écriture Firestore impossible pour ${dateStr} :`, e.message || e);
    return "firestore_write_error";
  }

  console.log(`[computeDailyWeatherDju] ${dateStr} enregistré — DJU19=${Math.round(dju19 * 10) / 10}`);
  return "written";
}

exports.computeDailyWeatherDju = onSchedule(
  { schedule: "30 1 * * *", timeZone: "Europe/Paris", region: REGION },
  async () => {
    const db = admin.firestore();

    let cfgSnap;
    try {
      cfgSnap = await db.collection("config").doc("hotel_config").get();
    } catch (e) {
      console.error("[computeDailyWeatherDju] Lecture Firestore de config/hotel_config impossible :", e.message || e);
      return null;
    }
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (typeof cfg.lat !== "number" || typeof cfg.lon !== "number") {
      console.warn("[computeDailyWeatherDju] config/hotel_config.lat/lon non renseignés — rien à faire.");
      return null;
    }
    // Bornes géographiques valides — défense en profondeur : rien ici ne
    // doit faire confiance à la validation déjà faite côté client
    // (assets/js/pages/settings.js) comme seule garantie.
    if (cfg.lat < -90 || cfg.lat > 90 || cfg.lon < -180 || cfg.lon > 180) {
      console.error(`[computeDailyWeatherDju] config/hotel_config.lat/lon hors bornes valides (lat=${cfg.lat}, lon=${cfg.lon}) — rien à faire.`);
      return null;
    }

    const now      = new Date();
    const todayStr = _parisDateStr(now);
    const dateStr  = _yesterdayParisDateStr(now);

    // Court-circuit SANS appel réseau si "hier" est déjà définitivement
    // enregistré pour la même localisation — comportement INCHANGÉ (voir
    // tests/dju_scheduled_function_test.js, section 6.2 : aucun fetch tant
    // que ce cas s'applique). Le rattrapage des jours antérieurs (ci-dessous)
    // n'a lieu QUE lorsqu'un appel réseau est de toute façon nécessaire pour
    // "hier" — jamais d'appel réseau supplémentaire juste pour vérifier
    // d'anciens jours déjà potentiellement à jour.
    let yesterdaySnap;
    try {
      yesterdaySnap = await db.collection("weather_daily").doc(dateStr).get();
    } catch (e) {
      console.error(`[computeDailyWeatherDju] Lecture Firestore impossible pour ${dateStr} :`, e.message || e);
      return null;
    }
    const yesterdayData = yesterdaySnap.exists ? yesterdaySnap.data() : null;
    const yesterdaySameLocation = !!yesterdayData
      && typeof yesterdayData.lat === "number" && typeof yesterdayData.lon === "number"
      && Math.abs(yesterdayData.lat - cfg.lat) < 1e-6 && Math.abs(yesterdayData.lon - cfg.lon) < 1e-6;
    if (yesterdayData && yesterdayData.kind === "observed" && yesterdaySameLocation) {
      console.log(`[computeDailyWeatherDju] ${dateStr} déjà enregistré (observed, même localisation) — idempotence, rien à refaire.`);
      return null;
    }

    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${encodeURIComponent(cfg.lat)}&longitude=${encodeURIComponent(cfg.lon)}`
      + "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,weather_code"
      + "&timezone=Europe%2FParis&past_days=3&forecast_days=1";

    let json;
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OPEN_METEO_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { console.error(`[computeDailyWeatherDju] Open-Meteo HTTP ${res.status}`); return null; }
      json = await res.json();
    } catch (e) {
      clearTimeout(timer);
      const isTimeout = !!e && e.name === "AbortError";
      console.error(`[computeDailyWeatherDju] ${isTimeout ? `Délai dépassé (${OPEN_METEO_TIMEOUT_MS}ms)` : "Échec réseau"} Open-Meteo :`, e.message || e);
      return null;
    }
    if (!json || !json.daily || !Array.isArray(json.daily.time)) {
      console.error("[computeDailyWeatherDju] Réponse Open-Meteo invalide.");
      return null;
    }

    if (json.daily.time.indexOf(dateStr) === -1) {
      console.warn(`[computeDailyWeatherDju] Date cible ${dateStr} absente de la réponse — rien enregistré pour ce jour (jamais de donnée inventée).`);
      // Pas de retour anticipé : d'autres jours de la fenêtre de rattrapage
      // ci-dessous peuvent être présents et exploitables même si "hier"
      // spécifiquement ne l'est pas.
    }

    // Rattrapage : traite TOUS les jours strictement passés (< aujourd'hui,
    // Europe/Paris) déjà présents dans CETTE MÊME réponse Open-Meteo, dans
    // la fenêtre réellement demandée (BACKFILL_WINDOW_DAYS <= past_days de
    // l'URL ci-dessus) — AUCUN appel réseau supplémentaire. Comble une
    // lacune réelle : si une exécution précédente avait échoué (panne
    // Open-Meteo, Firestore...), le lendemain ne retraitait auparavant QUE
    // sa propre veille — les jours d'avant restaient alors définitivement
    // vides. Ne touche jamais aujourd'hui ni un jour futur (jamais une
    // prévision transformée en observation) ; l'idempotence par jour
    // (_persistOneObservedDay) garantit qu'aucun jour déjà "observed" pour
    // la même localisation n'est jamais retraité.
    const minBackfillStr = _minBackfillDateStr(now, BACKFILL_WINDOW_DAYS);
    let written = 0, skippedIdempotent = 0, skippedNoData = 0, errors = 0, outOfWindow = 0;
    for (let i = 0; i < json.daily.time.length; i++) {
      const d = json.daily.time[i];
      if (!(d < todayStr)) continue; // jamais aujourd'hui ni un jour futur
      if (d < minBackfillStr) { outOfWindow++; continue; } // jamais hors de la fenêtre réellement demandée
      const outcome = await _persistOneObservedDay(db, d, i, json.daily, cfg);
      if (outcome === "written") written++;
      else if (outcome === "already_observed") skippedIdempotent++;
      else if (outcome === "no_usable_temperature") skippedNoData++;
      else errors++;
    }
    console.log(`[computeDailyWeatherDju] Fenêtre traitée autour de ${dateStr} : ${written} jour(s) écrit(s), ${skippedIdempotent} déjà à jour, ${skippedNoData} sans donnée exploitable, ${errors} erreur(s) Firestore, ${outOfWindow} hors fenêtre.`);
    return null;
  }
);

// ── AUTHENTIFICATION PIN — VÉRIFICATION SERVEUR + ÉMISSION D'IDENTITÉ FIABLE ──
// PRÉPARÉE MAIS NON DÉPLOYÉE (comme computeDailyWeatherDju ci-dessus) : tant
// que `firebase deploy --only functions:verifyPin` n'a pas été exécuté avec
// l'accord explicite de l'utilisateur, aucune ressource Firebase n'est créée.
//
// Comble la faille de confiance du flux PIN actuel (assets/js/auth.js
// confirmPin()) : le hash du PIN est aujourd'hui comparé entièrement côté
// client, à partir d'une donnée (users/{id}.pin) elle-même lisible par
// n'importe qui (firestore.rules: users -> allow read: if true). Rien ne
// prouve au serveur quelle est l'identité ou le rôle réel de l'appelant —
// MX.state.currentUser.role n'est qu'une variable JS locale, jamais
// vérifiée. Cette fonction callable déplace la vérification du PIN et la
// détermination du rôle côté serveur (Admin SDK, jamais contournable par le
// client), puis émet un VRAI jeton d'identité Firebase (custom token) que
// le client échange ensuite via signInWithCustomToken() — remplaçant la
// session anonyme par une identité stable et vérifiée, portant les rôles en
// custom claims que les règles Firestore peuvent lire via
// request.auth.token.role (voir firestore.rules.draft-claims-migration).
//
// UID STABLE : dérivé déterministement de l'id du document users/{userId}
// (préfixe "pinuser_" pour ne jamais collisionner avec un futur UID Admin
// Firebase Auth réel). Le MÊME utilisateur PIN obtient donc TOUJOURS le
// même UID Firebase d'une connexion à l'autre — nécessaire pour que les
// claims/permissions restent cohérents et traçables.
//
// ANTI-ENNUMÉRATION / ANTI-BRUTE-FORCE :
//  - userId inconnu ou PIN faux renvoient EXACTEMENT la même erreur
//    générique ("PIN incorrect") — jamais de distinction qui révélerait si
//    un identifiant existe.
//  - Un hash factice est TOUJOURS calculé même si userId est introuvable,
//    pour que le temps de réponse ne révèle pas non plus cette différence.
//  - Compteur d'échecs persistant (pin_attempts/{userId}), DÉSORMAIS
//    ATOMIQUE (voir _recordPinAttempt, db.runTransaction ci-dessous) : au
//    5e échec consécutif, verrouillage 60s, qui DOUBLE à chaque nouveau
//    verrouillage tant que les échecs continuent (60s, 120s, 240s, …) —
//    remis à zéro uniquement par une vérification réussie.
//    ⚠ AUDIT (session précédente) : l'ancienne version (lecture puis
//    écriture séparées, sans transaction) a été prouvée NON ATOMIQUE par un
//    test de concurrence réel contre l'émulateur (12 appels parallèles ->
//    compteur final resté à 1 au lieu de 12, verrou jamais déclenché). Voir
//    tests/pin_security_test.js, bloc 1, pour la preuve de la correction.
//  - Limitation COMPLÉMENTAIRE par appelant (pin_attempts_by_caller/
//    {callerUid}, voir _recordPinAttempt) : ralentit une attaque distribuée
//    sur de nombreux comptes depuis la MÊME session Firebase (anonyme ou
//    non) — fenêtre glissante, pause COURTE et toujours temporaire (jamais
//    de verrou permanent), sans jamais affecter un autre appelant (chaque
//    callerUid a son propre compteur, aucun risque de bloquer un
//    utilisateur légitime à cause de l'activité d'un autre). LIMITE
//    CONNUE, à ne jamais sur-vendre : un script qui régénère une session
//    anonyme fraîche (signInAnonymously) entre chaque lot contourne
//    entièrement ce compteur — ce n'est PAS une protection suffisante à
//    elle seule contre un attaquant déterminé. Une protection réellement
//    robuste nécessiterait Firebase App Check (ou équivalent), non mis en
//    place ici : cela suppose d'enregistrer un nouveau fournisseur
//    d'attestation dans la console Firebase, une décision/action de
//    configuration externe qui n'a pas été demandée et n'est pas prise ici.
//  - Le PIN et son hash ne sont JAMAIS renvoyés au client, dans aucune
//    réponse, succès ou erreur.
//
// COMPATIBILITÉ : réplique exactement la même comparaison que le client
// actuel (SHA-256 hex, avec repli PIN en clair pour les comptes legacy non
// encore migrés — voir assets/js/pages/admin.js:saveUsers) : aucune donnée
// existante n'a besoin d'être réinitialisée pour cette migration. Le niveau
// de robustesse du hash lui-même (SHA-256 non salé) reste une limite
// connue, documentée séparément, pas corrigée ici (hors périmètre : cela
// nécessiterait de re-saisir tous les PIN existants).
//
// STOCKAGE DU HASH : désormais lu depuis users_private/{userId}.pin (Admin
// SDK, contourne de toute façon les règles) et non plus depuis
// users/{userId}.pin — ce dernier champ n'est plus exposé en lecture
// publique (voir firestore.rules.draft-claims-migration et le rapport
// d'audit : un hash SHA-256 non salé, lisible par quiconque, se brute-force
// hors-ligne en quelques millisecondes pour un PIN à 4-8 chiffres).
const PIN_MAX_ATTEMPTS         = 5;
const PIN_LOCKOUT_BASE_MS      = 60 * 1000;      // 60s, double à chaque nouveau verrouillage (par COMPTE CIBLE)
const PIN_CALLER_WINDOW_MS     = 10 * 60 * 1000; // fenêtre glissante de 10 min (par APPELANT)
const PIN_CALLER_MAX_FAILURES  = 20;             // tolérant (usage normal : quelques PIN oubliés, jamais 20 comptes différents en 10 min)
const PIN_CALLER_COOLDOWN_MS   = 5 * 60 * 1000;  // pause COURTE, jamais permanente — expire seule
const PIN_GENERIC_ERROR        = "PIN incorrect.";

function _isPlausibleUserId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 128 && /^[A-Za-z0-9_-]+$/.test(v);
}
function _isPlausiblePin(v) {
  return typeof v === "string" && /^[0-9]{4,8}$/.test(v);
}
async function _sha256Hex(str) {
  const buf = await require("crypto").subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Même règle que _roleFamily()/isResponsable() côté client (assets/js/auth.js,
// assets/js/pages/nav-visibility.js) — dupliquée ici volontairement (pas
// d'accès à window.MX côté Cloud Function), à resynchroniser manuellement
// si cette règle évolue côté client.
function _normalizeRole(userDoc) {
  return (userDoc.rank === "responsable" || userDoc.role === "responsable") ? "responsable" : "technicien";
}

// ────────────────────────────────────────────────────────────────────────
// _recordPinAttempt — UNE SEULE transaction Firestore qui lit ET écrit à la
// fois le verrou par compte cible (pin_attempts/{userId}) et la fenêtre par
// appelant (pin_attempts_by_caller/{callerUid}), pour garantir l'atomicité
// sous concurrence (plusieurs appels verifyPin() simultanés pour le même
// compte, ou depuis le même appelant). db.runTransaction() sérialise
// automatiquement les transactions en conflit (relecture + nouvel essai
// côté SDK) : deux appels concurrents ne peuvent plus jamais lire le même
// état "avant" et écraser le résultat de l'autre.
// Retourne un objet {outcome} parmi :
//   - "locked"          : compte cible verrouillé (retryAfterSeconds fourni)
//   - "caller_cooldown" : appelant en pause (retryAfterSeconds fourni)
//   - "ok"              : PIN correct, aucun verrou actif — le compteur du
//                          compte cible est remis à zéro
//   - "denied"          : PIN incorrect, tentative comptée
// ────────────────────────────────────────────────────────────────────────
async function _recordPinAttempt(db, userId, callerUid, matched, now) {
  const targetRef = db.collection("pin_attempts").doc(userId);
  const callerRef = callerUid ? db.collection("pin_attempts_by_caller").doc(callerUid) : null;

  // maxAttempts relevé (défaut SDK : 5) — sous attaque distribuée réelle,
  // de nombreux appels concurrents du MÊME appelant se disputent l'écriture
  // du même document pin_attempts_by_caller/{callerUid}, ce qui épuisait le
  // budget de retry par défaut et faisait remonter une erreur de contention
  // Firestore brute (perdant ainsi le comptage de ces tentatives au lieu de
  // les classer "denied"). 30 couvre confortablement PIN_CALLER_MAX_FAILURES
  // (20) + marge, sans jamais affecter l'usage normal (un seul utilisateur
  // ne génère jamais ce niveau de concurrence sur son propre callerUid).
  return db.runTransaction(async (tx) => {
    const targetSnap = await tx.get(targetRef);
    const callerSnap = callerRef ? await tx.get(callerRef) : null;
    const targetAttempts = targetSnap.exists ? targetSnap.data() : null;
    const callerAttempts = callerSnap && callerSnap.exists ? callerSnap.data() : null;

    // 1. Verrou par COMPTE CIBLE — vérifié AVANT toute autre logique, pour
    // qu'un compte verrouillé le reste même si, par ailleurs, l'appelant
    // n'est pas encore en pause.
    if (targetAttempts && typeof targetAttempts.lockedUntilMs === "number" && targetAttempts.lockedUntilMs > now) {
      return { outcome: "locked", retryAfterSeconds: Math.ceil((targetAttempts.lockedUntilMs - now) / 1000) };
    }

    // 2. Pause COURTE par APPELANT (protection complémentaire contre une
    // attaque distribuée sur plusieurs comptes CIBLES depuis la même
    // session) — bloque la tentative même si le PIN soumis est correct,
    // pour qu'un script ne puisse pas "deviner juste" sur un compte pour
    // continuer d'en tenter d'autres pendant sa propre pause.
    if (callerRef && callerAttempts && typeof callerAttempts.cooldownUntilMs === "number" && callerAttempts.cooldownUntilMs > now) {
      return { outcome: "caller_cooldown", retryAfterSeconds: Math.ceil((callerAttempts.cooldownUntilMs - now) / 1000) };
    }

    if (matched) {
      // Succès : le compte cible repart à zéro. Le compteur par APPELANT
      // n'est volontairement PAS remis à zéro ici — un attaquant qui finit
      // par deviner un PIN après avoir essayé de nombreux comptes ne doit
      // pas repartir d'une ardoise vierge pour continuer d'en essayer
      // d'autres ; seule l'expiration naturelle de la fenêtre le réduit.
      tx.delete(targetRef);
      return { outcome: "ok" };
    }

    // Échec : compteur du compte CIBLE (logique de verrouillage inchangée,
    // désormais protégée par la transaction).
    const prevCount = targetAttempts ? (targetAttempts.count || 0) : 0;
    const prevLockoutLevel = targetAttempts ? (targetAttempts.lockoutLevel || 0) : 0;
    const newCount = prevCount + 1;
    const targetUpdate = { count: newCount, lastAttemptAt: admin.firestore.FieldValue.serverTimestamp() };
    if (newCount >= PIN_MAX_ATTEMPTS) {
      const lockoutLevel = prevLockoutLevel + 1;
      const lockoutMs = PIN_LOCKOUT_BASE_MS * Math.pow(2, lockoutLevel - 1);
      targetUpdate.count = 0;
      targetUpdate.lockoutLevel = lockoutLevel;
      targetUpdate.lockedUntilMs = now + lockoutMs;
    }
    tx.set(targetRef, targetUpdate, { merge: true });

    // Échec : fenêtre glissante par APPELANT (nouveau — protection contre
    // la distribution sur plusieurs comptes). Jamais de verrou permanent :
    // la fenêtre se réinitialise seule après PIN_CALLER_WINDOW_MS, et la
    // pause elle-même expire après PIN_CALLER_COOLDOWN_MS sans aucune
    // action manuelle requise.
    if (callerRef) {
      let windowStartMs = (callerAttempts && typeof callerAttempts.windowStartMs === "number") ? callerAttempts.windowStartMs : now;
      let failCountInWindow = callerAttempts ? (callerAttempts.failCountInWindow || 0) : 0;
      if (now - windowStartMs > PIN_CALLER_WINDOW_MS) {
        windowStartMs = now;
        failCountInWindow = 0;
      }
      failCountInWindow += 1;
      const callerUpdate = { windowStartMs, failCountInWindow, lastAttemptAt: admin.firestore.FieldValue.serverTimestamp() };
      if (failCountInWindow >= PIN_CALLER_MAX_FAILURES) {
        callerUpdate.cooldownUntilMs = now + PIN_CALLER_COOLDOWN_MS;
      }
      tx.set(callerRef, callerUpdate, { merge: true });
    }

    return { outcome: "denied" };
  }, { maxAttempts: 30 });
}

exports.verifyPin = onCall({ region: REGION }, async (request) => {
  const data = request.data || {};
  const userId = data.userId;
  const pin = data.pin;

  if (!_isPlausibleUserId(userId) || !_isPlausiblePin(pin)) {
    throw new HttpsError("invalid-argument", PIN_GENERIC_ERROR);
  }

  const db = admin.firestore();
  const now = Date.now();
  // Identité de l'appelant pour la limitation complémentaire par appelant
  // (voir _recordPinAttempt) — un client PIN est TOUJOURS authentifié au
  // moins anonymement (voir firebase-config.js:signInAnonymously), donc
  // request.auth est normalement toujours défini ici ; en son absence (cas
  // défensif, ne devrait jamais se produire en usage normal de l'app), on
  // se contente de la protection par compte cible, déjà suffisante seule.
  const callerUid = (request.auth && request.auth.uid) ? request.auth.uid : null;

  // users/{userId}      : role/rank/roleId (inchangé)
  // users_private/{userId} : pin (hash) — plus jamais lisible par un client,
  // voir firestore.rules.draft-claims-migration. Les deux lectures passent
  // par l'Admin SDK, qui contourne de toute façon les règles — ce
  // changement de collection n'affecte que ce qui est exposé AUX CLIENTS.
  const [userSnap, privateSnap] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection("users_private").doc(userId).get(),
  ]);
  const userDoc = userSnap.exists ? userSnap.data() : null;
  const privateDoc = privateSnap.exists ? privateSnap.data() : null;
  const storedPin = privateDoc ? String(privateDoc.pin || "") : "";

  // Toujours calculer un hash, même si l'utilisateur n'existe pas, pour ne
  // pas laisser le temps de réponse révéler l'absence du compte.
  const enteredHash = await _sha256Hex(pin);
  let match;
  if (/^[0-9a-f]{64}$/.test(storedPin)) {
    match = userDoc !== null && enteredHash === storedPin;
  } else {
    // Legacy PIN en clair (voir assets/js/pages/admin.js:saveUsers) —
    // comparaison directe, comme le client le fait aujourd'hui.
    match = userDoc !== null && pin === storedPin;
  }

  // Toute la logique de verrouillage (compte cible + appelant) est
  // désormais ATOMIQUE — une seule transaction Firestore lit et écrit les
  // deux compteurs ensemble, éliminant la fenêtre de course prouvée dans
  // l'ancienne version (lecture puis écriture séparées, voir audit et
  // tests/pin_security_test.js).
  //
  // Garde-fou défensif (audit C.2 — contention sous rafale distribuée) : si
  // la transaction elle-même échoue malgré le maxAttempts relevé ci-dessus
  // (ex. rafale encore plus large que prévu), on échoue FERMÉ — jamais de
  // token émis, jamais de PIN considéré comme valide, aucun contournement du
  // comptage (on ne peut pas compter une tentative dont l'écriture n'a
  // jamais pu committer, mais on ne la transforme jamais en succès non
  // plus). L'appelant doit simplement réessayer.
  let result;
  try {
    result = await _recordPinAttempt(db, userId, callerUid, match, now);
  } catch (e) {
    console.error("[verifyPin] Échec de la transaction de comptage (contention Firestore) :", e);
    throw new HttpsError("unavailable", "Service temporairement surchargé — réessayez dans quelques secondes.");
  }

  if (result.outcome === "locked" || result.outcome === "caller_cooldown") {
    // Même code, même forme de message dans les deux cas : le client ne
    // peut pas distinguer "ce compte précis est verrouillé" de "c'est VOUS
    // qui êtes temporairement ralenti" — aucune des deux formulations ne
    // révèle quoi que ce soit sur l'existence ou l'état d'un compte tiers.
    throw new HttpsError("resource-exhausted", "Trop de tentatives — réessayez dans " + result.retryAfterSeconds + "s.");
  }
  if (result.outcome === "denied") {
    throw new HttpsError("permission-denied", PIN_GENERIC_ERROR);
  }

  // result.outcome === "ok" : PIN correct, aucun verrou actif — émission de
  // l'identité fiable. (userDoc ne peut pas être null ici : match est
  // "true" uniquement quand userDoc !== null, voir ci-dessus.)
  const role = _normalizeRole(userDoc);
  const uid = "pinuser_" + userId;
  const claims = { role, userId };
  if (userDoc.roleId) claims.roleId = userDoc.roleId;

  let token;
  try {
    token = await admin.auth().createCustomToken(uid, claims);
  } catch (e) {
    console.error("[verifyPin] Échec de création du custom token :", e);
    throw new HttpsError("internal", "Erreur serveur — réessayez.");
  }

  console.log(`[verifyPin] Authentification réussie pour userId=${userId} (role=${role}).`);
  return { token };
});
