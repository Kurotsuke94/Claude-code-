// Tests Playwright (mock-firebase.js, AUCUNE base réelle) de la couche de
// données des MODÈLES DE SEMAINE (assets/js/db.js — week_templates,
// previewWeekTemplateApplication, applyWeekTemplateToWeek). Lot 1 : aucune
// interface n'est testée ici, uniquement les fonctions MX.DB exécutées dans
// la vraie page (vrai db.js, vrais helpers), backend Firestore simulé en
// mémoire. Couvre : indépendance des jours/missions, copie figée des
// créneaux, anti-doublon, non-écrasement, conservation des affectations,
// jours/semaines passés, indépendance des semaines générées, anciennes
// données (shift_templates, loadTemplateIntoWeekDay) intactes.
const path = require('path');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

// GARDE-FOU ENVIRONNEMENT (mock-firebase) — voir tests/cta_vc_test.js.
async function blockRealFirebase(page) {
  await page.route('**://*.gstatic.com/**', r => r.abort());
  await page.route('**://*.googleapis.com/**', r => r.abort());
}
async function assertMockFirebase(page) {
  const mockActive = await page.evaluate(() => !!(
    window.__mockDb && window.__mockDb._debugStore &&
    window.firebase && typeof window.firebase.firestore === 'function' &&
    window.firebase.firestore() === window.__mockDb
  ));
  if (!mockActive) {
    console.error('\nERREUR ENVIRONNEMENT : mock-firebase inactif (vrai SDK Firebase chargé depuis gstatic.com ?). Test interrompu.');
    process.exit(1);
  }
}

const _globalTimeout = setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (180s) — le process est arrêté de force.');
  process.exit(1);
}, 180000);

async function bootPage(page) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 8, weather_code: 2 }, daily: { temperature_2m_min: [6], temperature_2m_max: [13] } }) }));
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ path: SEED });
  await blockRealFirebase(page);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await assertMockFirebase(page);
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { await window.__seedGst(); });
  await page.waitForTimeout(400);
  return { pageErrors };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const { pageErrors } = await bootPage(page);

  // Modèles de créneau par défaut (Matin/Journée/Soir) créés par l'app au
  // démarrage (db.js:initShiftTemplateDefaults) — les « anciens modèles ».
  await page.waitForFunction(() => Object.keys((window.__mockDb._debugStore.shift_templates) || {}).length >= 3, undefined, { timeout: 10000 });

  const ctx = await page.evaluate(() => {
    const store = window.__mockDb._debugStore;
    const shifts = Object.entries(store.shift_templates).map(([id, d]) => Object.assign({ id }, d));
    const bySeed = {};
    shifts.forEach(s => { if (s.isDefaultSeed) bySeed[s.isDefaultSeed] = s; });
    const now = new Date();
    const next = new Date(now); next.setDate(now.getDate() + 7);
    const prev = new Date(now); prev.setDate(now.getDate() - 7);
    const after = new Date(now); after.setDate(now.getDate() + 14);
    const later = new Date(now); later.setDate(now.getDate() + 21);
    return {
      shifts, matinId: bySeed.matin.id, journeeId: bySeed.journee.id, soirId: bySeed.soir.id,
      shiftsSnapshot: JSON.stringify(shifts.map(s => ({ id: s.id, name: s.name, start: s.start, end: s.end, color: s.color, icon: s.icon, tasks: s.tasks }))),
      nextWk: MX.weekKeyOf(next), prevWk: MX.weekKeyOf(prev), afterWk: MX.weekKeyOf(after), laterWk: MX.weekKeyOf(later),
    };
  });
  ok('0.1 Les 3 anciens modèles de créneau (Matin/Journée/Soir) sont présents', !!(ctx.matinId && ctx.journeeId && ctx.soirId));

  // ═══════════ 1. Création — copie figée des créneaux, missions par jour ═══════════
  const created = await page.evaluate(async (c) => {
    const shifts = c.shifts;
    const columns = MX.DB.buildWeekTemplateColumns(shifts);
    const key = id => columns.find(col => col.sourceShiftTemplateId === id).key;
    const days = MX.DB.emptyWeekTemplateDays(columns);
    days.lundi[key(c.soirId)] = { active: true, missions: [
      { text: 'Contrôle éclairage des couloirs', category: 'Éclairage' },
      { text: 'Vérification éclairage locaux techniques', category: 'Éclairage' },
      { text: 'Contrôle des éclairages de sécurité' },
    ] };
    days.mardi[key(c.soirId)] = { active: true, missions: [
      { text: 'Contrôle éclairage du hall', category: 'Éclairage' },
      { text: 'Vérification éclairage accueil' },
      { text: 'Contrôle éclairage des espaces communs' },
    ] };
    days.lundi[key(c.matinId)] = { active: true, missions: [{ text: 'Relevé des compteurs' }] };
    days.mardi[key(c.matinId)] = { active: true, missions: [] };            // actif sans mission
    days.mercredi[key(c.journeeId)] = { active: false, missions: [{ text: 'Mission d\'un créneau INACTIF' }] };
    const id = await MX.DB.addWeekTemplate({ name: 'Semaine type — Maintenance [DÉMO]', description: 'Test', active: true, columns, days }, 'Sophie');
    const doc = window.__mockDb._debugStore.week_templates[id];
    return { id, doc: JSON.parse(JSON.stringify(doc)), soirKey: key(c.soirId), matinKey: key(c.matinId), journeeKey: key(c.journeeId) };
  }, ctx);
  const tplId = created.id, T = created.doc;
  ok('1.1 Modèle de semaine enregistré dans la collection week_templates', !!T && T.name === 'Semaine type — Maintenance [DÉMO]');
  ok('1.2 Une colonne figée par modèle de créneau ACTIF (3)', T.columns.length === 3);
  const soirShift = ctx.shifts.find(s => s.id === ctx.soirId);
  const soirCol = T.columns.find(c => c.key === created.soirKey);
  ok('1.3 Copie figée : nom/horaires/couleur/icône du créneau Soir capturés', soirCol.name === soirShift.name && soirCol.start === soirShift.start && soirCol.end === soirShift.end && soirCol.color === soirShift.color && soirCol.icon === soirShift.icon && !!soirCol.capturedAt);
  ok('1.4 Les 7 jours existent dans le modèle', ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].every(d => T.days[d] && Object.keys(T.days[d]).length === 3));
  const lundiSoir = T.days.lundi[created.soirKey].missions, mardiSoir = T.days.mardi[created.soirKey].missions;
  ok('1.5 Lundi soir et mardi soir ont des missions DIFFÉRENTES', lundiSoir.map(m => m.text).join('|') !== mardiSoir.map(m => m.text).join('|') && lundiSoir.length === 3 && mardiSoir.length === 3);
  const allIds = [];
  Object.values(T.days).forEach(d => Object.values(d).forEach(cell => cell.missions.forEach(m => allIds.push(m.id))));
  ok('1.6 Chaque mission a un identifiant propre (aucun partage entre cellules)', allIds.length === new Set(allIds).size && allIds.length === 8);
  ok('1.7 Ordre d\'exécution enregistré (0,1,2)', lundiSoir.map(m => m.order).join(',') === '0,1,2');
  ok('1.8 Catégorie facultative conservée quand renseignée, absente sinon', lundiSoir[0].category === 'Éclairage' && !('category' in lundiSoir[2]));
  ok('1.9 Traçabilité createdBy/updatedBy', T.createdBy === 'Sophie' && T.updatedBy === 'Sophie');

  // ═══════════ 2. Validation (pure) ═══════════
  const validation = await page.evaluate((T) => {
    const res = {};
    const tryIt = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code || 'err'; } };
    res.noName = tryIt(() => MX.DB.normalizeWeekTemplate(Object.assign({}, T, { name: '   ' })));
    const badDays = JSON.parse(JSON.stringify(T.days));
    const k = Object.keys(badDays.lundi)[0];
    badDays.lundi[k] = { active: true, missions: [{ text: '  ' }] };
    res.emptyMission = tryIt(() => MX.DB.normalizeWeekTemplate(Object.assign({}, T, { days: badDays })));
    const longCat = JSON.parse(JSON.stringify(T.days));
    longCat.lundi[k] = { active: true, missions: [{ text: 'x', category: 'y'.repeat(41) }] };
    res.longCategory = tryIt(() => MX.DB.normalizeWeekTemplate(Object.assign({}, T, { days: longCat })));
    const dupIds = JSON.parse(JSON.stringify(T.days));
    const keys = Object.keys(dupIds.lundi);
    dupIds.lundi[keys[0]] = { active: true, missions: [{ id: 'SAME', text: 'A' }] };
    dupIds.mardi[keys[0]] = { active: true, missions: [{ id: 'SAME', text: 'B' }] };
    const norm = MX.DB.normalizeWeekTemplate(Object.assign({}, T, { days: dupIds }));
    res.dupRegenerated = norm.days.lundi[keys[0]].missions[0].id !== norm.days.mardi[keys[0]].missions[0].id;
    const dupCols = Object.assign({}, T, { columns: T.columns.concat([Object.assign({}, T.columns[0], { key: 'other' })]) });
    res.dupSource = tryIt(() => MX.DB.normalizeWeekTemplate(dupCols));
    return res;
  }, T);
  ok('2.1 Nom vide refusé', validation.noName === 'invalid-week-template');
  ok('2.2 Mission sans texte refusée', validation.emptyMission === 'invalid-week-template');
  ok('2.3 Catégorie > 40 caractères refusée', validation.longCategory === 'invalid-week-template');
  ok('2.4 Un identifiant de mission présent dans deux cellules est régénéré (indépendance garantie)', validation.dupRegenerated === true);
  ok('2.5 Le même modèle de créneau ne peut être deux colonnes', validation.dupSource === 'invalid-week-template');

  // ═══════════ 3. Indépendance des jours — modifier mardi ne touche pas lundi ═══════════
  const indep = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const before = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const lundiBefore = JSON.stringify(before.days.lundi);
    const t = JSON.parse(JSON.stringify(before));
    t.days.mardi[a.soirKey].missions[0].text = 'Contrôle éclairage du hall (modifié)';
    t.days.mardi[a.soirKey].missions.splice(2, 1);                         // suppression
    t.days.mardi[a.soirKey].missions.reverse();                            // réorganisation
    t.days.mardi[a.soirKey].missions.push({ text: 'Nouvelle mission mardi' }); // ajout
    await MX.DB.updateWeekTemplate(a.tplId, t, 'Sophie');
    const after = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    return { lundiSame: JSON.stringify(after.days.lundi) === lundiBefore, mardi: after.days.mardi[a.soirKey].missions };
  }, { tplId, soirKey: created.soirKey });
  ok('3.1 Modifier/supprimer/réordonner/ajouter le mardi soir ne modifie PAS le lundi (octet pour octet)', indep.lundiSame);
  ok('3.2 Mardi soir : modification, suppression, réorganisation et ajout bien enregistrés', indep.mardi.length === 3 && indep.mardi[1].text === 'Contrôle éclairage du hall (modifié)' && indep.mardi[2].text === 'Nouvelle mission mardi' && indep.mardi.map(m => m.order).join(',') === '0,1,2');

  // ═══════════ 4. Activation / désactivation ═══════════
  const act = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const t = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    t.days.jeudi[a.journeeKey] = { active: true, missions: [{ text: 'Contrôle CVC jeudi' }] };
    await MX.DB.updateWeekTemplate(a.tplId, t, 'Sophie');
    const on = store.week_templates[a.tplId].days.jeudi[a.journeeKey].active;
    const t2 = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    t2.days.jeudi[a.journeeKey].active = false;
    await MX.DB.updateWeekTemplate(a.tplId, t2, 'Sophie');
    const off = store.week_templates[a.tplId].days.jeudi[a.journeeKey];
    await MX.DB.setWeekTemplateActive(a.tplId, false, store.week_templates[a.tplId].version, 'Sophie');
    const tplInactive = store.week_templates[a.tplId].active;
    await MX.DB.setWeekTemplateActive(a.tplId, true, store.week_templates[a.tplId].version, 'Sophie');
    return { on, offActive: off.active, offKeepsMissions: off.missions.length === 1, tplInactive, tplActive: store.week_templates[a.tplId].active };
  }, { tplId, journeeKey: created.journeeKey });
  ok('4.1 Un créneau peut être activé pour un jour précis', act.on === true);
  ok('4.2 Désactivé ensuite : active=false, ses missions restent conservées dans le modèle', act.offActive === false && act.offKeepsMissions);
  ok('4.3 Activation/désactivation du modèle entier', act.tplInactive === false && act.tplActive === true);

  // ═══════════ 5. Copie figée — un modèle de créneau modifié ne change pas le modèle de semaine ═══════════
  const frozen = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const colBefore = JSON.stringify(store.week_templates[a.tplId].columns);
    await MX.DB.updateShiftTemplate(a.soirId, { start: '14:00', color: '#FF0000' });
    const colAfter = JSON.stringify(store.week_templates[a.tplId].columns);
    const shifts = Object.entries(store.shift_templates).map(([id, d]) => Object.assign({ id }, d));
    const tpl = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const diff = MX.DB.diffWeekTemplateColumns(tpl, shifts);
    const soirDiff = diff.find(d => d.key === a.soirKey);
    const otherOk = diff.filter(d => d.key !== a.soirKey).every(d => d.status === 'ok');
    const refreshed = MX.DB.refreshWeekTemplateColumn(tpl, a.soirKey, shifts.find(s => s.id === a.soirId));
    const refreshedCol = refreshed.columns.find(c => c.key === a.soirKey);
    const missionsUntouched = JSON.stringify(refreshed.days) === JSON.stringify(tpl.days);
    const stillFrozenInStore = JSON.stringify(store.week_templates[a.tplId].columns) === colAfter;
    const missing = MX.DB.diffWeekTemplateColumns(tpl, shifts.filter(s => s.id !== a.matinId)).find(d => d.key === a.matinKey);
    return { same: colBefore === colAfter, soirDiff, otherOk, refreshedStart: refreshedCol.start, refreshedColor: refreshedCol.color, missionsUntouched, stillFrozenInStore, missingStatus: missing.status };
  }, { tplId, soirId: ctx.soirId, soirKey: created.soirKey, matinId: ctx.matinId, matinKey: created.matinKey });
  ok('5.1 Modifier le modèle de créneau Soir NE modifie PAS le modèle de semaine (copie figée)', frozen.same);
  ok('5.2 L\'écart est détecté (statut "changed", horaire et couleur figés vs actuels)', frozen.soirDiff.status === 'changed' && frozen.soirDiff.changes.start && frozen.soirDiff.changes.start.frozen === soirShift.start && frozen.soirDiff.changes.start.current === '14:00' && !!frozen.soirDiff.changes.color);
  ok('5.3 Les autres colonnes restent "ok"', frozen.otherOk);
  ok('5.4 Reprise EXPLICITE d\'une colonne : nouvelles valeurs, missions et activations intactes', frozen.refreshedStart === '14:00' && frozen.refreshedColor === '#FF0000' && frozen.missionsUntouched);
  ok('5.5 La reprise est pure : rien n\'est écrit tant que le modèle n\'est pas enregistré', frozen.stillFrozenInStore);
  ok('5.6 Modèle de créneau source supprimé -> statut "source-missing" (la colonne reste utilisable)', frozen.missingStatus === 'source-missing');

  // ═══════════ 6. Duplication ═══════════
  const dup = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const srcBefore = JSON.stringify(store.week_templates[a.tplId]);
    const newId = await MX.DB.duplicateWeekTemplate(a.tplId, 'Alban');
    const src = store.week_templates[a.tplId], copy = JSON.parse(JSON.stringify(store.week_templates[newId]));
    const ids = t => { const out = []; Object.values(t.days).forEach(d => Object.values(d).forEach(c => c.missions.forEach(m => out.push(m.id)))); return out; };
    const texts = t => { const out = []; Object.values(t.days).forEach(d => Object.values(d).forEach(c => c.missions.forEach(m => out.push(m.text)))); return out.join('|'); };
    const shared = ids(copy).filter(i => ids(src).indexOf(i) !== -1).length;
    const sameTexts = texts(JSON.parse(srcBefore)) === texts(copy) && ids(copy).length === ids(src).length;
    copy.days.lundi[a.soirKey].missions[0].text = 'Modifié dans la copie';
    await MX.DB.updateWeekTemplate(newId, copy, 'Alban');
    return { newId, name: store.week_templates[newId].name, shared, sameTexts, srcUnchanged: JSON.stringify(store.week_templates[a.tplId]) === srcBefore, createdBy: store.week_templates[newId].createdBy };
  }, { tplId, soirKey: created.soirKey });
  ok('6.1 Duplication : nouveau modèle "(copie)"', !!dup.newId && dup.newId !== tplId && /\(copie\)$/.test(dup.name) && dup.createdBy === 'Alban');
  ok('6.2 Aucune mission partagée entre l\'original et la copie (nouveaux identifiants)', dup.shared === 0);
  ok('6.3 Mêmes contenus copiés', dup.sameTexts);
  ok('6.4 Modifier la copie ne modifie pas l\'original', dup.srcUnchanged);

  // ═══════════ 7. Écoute et désabonnement ═══════════
  const listen = await page.evaluate(async () => {
    const L = window.__mockDb._debugListeners;
    const before = (L.week_templates || []).length;
    let received = null;
    const unsub = MX.DB.listenWeekTemplates(list => { received = list; });
    await new Promise(r => setTimeout(r, 50));
    const during = (L.week_templates || []).length;
    unsub();
    const after = (L.week_templates || []).length;
    return { isFn: typeof unsub === 'function', count: received ? received.length : -1, before, during, after };
  });
  ok('7.1 listenWeekTemplates renvoie une fonction de désabonnement et reçoit les modèles', listen.isFn && listen.count === 2);
  ok('7.2 Le désabonnement retire réellement le listener (aucun listener orphelin)', listen.during === listen.before + 1 && listen.after === listen.before);

  // ═══════════ 8. Aperçu puis application sur une semaine FUTURE vide ═══════════
  const apply1 = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const tpl = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const preview = MX.DB.previewWeekTemplateApplication(null, tpl, a.nextWk, {});
    const txBefore = window.__mockTxLog ? window.__mockTxLog.committed : 0;
    const res = await MX.DB.applyWeekTemplateToWeek(a.nextWk, MX.weekLabelOf(a.nextWk), a.tplId, {}, 'Sophie');
    const wk = JSON.parse(JSON.stringify(store.week_slots[a.nextWk]));
    return { preview, res: { written: res.written, counts: res.counts }, wk, txDelta: window.__mockTxLog.committed - txBefore };
  }, { tplId, nextWk: ctx.nextWk });
  ok('8.1 Aperçu : 4 ajouts (lundi matin+soir, mardi matin+soir), aucun remplacement ni ignoré', apply1.preview.counts.add === 4 && apply1.preview.counts.replace === 0 && apply1.preview.counts.skip === 0);
  ok('8.2 Aperçu : les cellules inactives sont comptées à part (jamais générées)', apply1.preview.counts.inactive === 7 * 3 - 4);
  ok('8.3 Application écrite via une transaction', apply1.res.written === true && apply1.txDelta === 1);
  const genDays = Object.keys(apply1.wk.days).sort().join(',');
  ok('8.4 Seuls les jours ayant des créneaux ACTIFS sont générés (lundi, mardi)', genDays === 'lundi,mardi');
  const lundiInsts = apply1.wk.days.lundi, mardiInsts = apply1.wk.days.mardi;
  const lSoir = lundiInsts.find(i => i.templateId === ctx.soirId), mSoir = mardiInsts.find(i => i.templateId === ctx.soirId);
  ok('8.5 Lundi soir généré avec SES missions, mardi soir avec LES SIENNES', lSoir.tasks.map(t => t.text).join('|') === lundiSoir.map(m => m.text).join('|') && mSoir.tasks.map(t => t.text).join('|') === indep.mardi.map(m => m.text).join('|'));
  ok('8.6 Horaires/couleur issus de la COPIE FIGÉE (pas du créneau Soir modifié en 14:00/rouge)', lSoir.start === soirShift.start && lSoir.color === soirShift.color);
  ok('8.7 Tâches générées : nouveaux identifiants, done=false, ordre conservé', lSoir.tasks.every(t => t.done === false) && lSoir.tasks.every(t => lundiSoir.every(m => m.id !== t.id)) && lSoir.tasks.map(t => t.order).join(',') === '0,1,2');
  ok('8.8 Catégorie copiée seulement quand elle existe', lSoir.tasks[0].category === 'Éclairage' && !('category' in lSoir.tasks[2]));
  ok('8.9 Créneau actif sans mission généré vide (structure seule)', mardiInsts.some(i => i.templateId === ctx.matinId && i.tasks.length === 0));
  ok('8.10 Aucun technicien imposé : "Non assigné" (sélection actuelle inchangée)', [].concat(lundiInsts, mardiInsts).every(i => i.userId === null && i.userName === ''));
  ok('8.11 Marqueurs informatifs (weekTemplateId/Name, appliedBy) présents', lSoir.weekTemplateId === tplId && lSoir.weekTemplateName === 'Semaine type — Maintenance [DÉMO]' && lSoir.appliedBy === 'Sophie');
  ok('8.12 Créneau INACTIF du mercredi jamais généré malgré sa mission', !apply1.wk.days.mercredi);

  // ═══════════ 9. Aucun doublon en réappliquant ═══════════
  const apply2 = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const before = JSON.stringify(store.week_slots[a.nextWk].days);
    const res = await MX.DB.applyWeekTemplateToWeek(a.nextWk, MX.weekLabelOf(a.nextWk), a.tplId, {}, 'Sophie');
    return { written: res.written, counts: res.counts, reasons: res.items.map(i => i.reason), same: JSON.stringify(store.week_slots[a.nextWk].days) === before };
  }, { tplId, nextWk: ctx.nextWk });
  ok('9.1 Deuxième application : 0 ajout, tout "déjà présent", rien écrit', apply2.written === false && apply2.counts.add === 0 && apply2.reasons.every(r => r === 'already-present'));
  ok('9.2 Semaine strictement identique (aucun doublon)', apply2.same);

  // ═══════════ 10. Remplacement explicite : technicien conservé ; commencé/terminé/personnalisé jamais écrasé ═══════════
  const repl = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const wk = () => JSON.parse(JSON.stringify(store.week_slots[a.nextWk]));
    const lSoir = wk().days.lundi.find(i => i.templateId === a.soirId);
    const lMatin = wk().days.lundi.find(i => i.templateId === a.matinId);
    const mSoir = wk().days.mardi.find(i => i.templateId === a.soirId);
    const mMatin = wk().days.mardi.find(i => i.templateId === a.matinId);
    await MX.DB.setWeekSlotAssignee(a.nextWk, 'lundi', lSoir.id, 'jordan', 'Jordan', 'Sophie');        // affecté, non commencé
    await MX.DB.setWeekSlotAssignee(a.nextWk, 'lundi', lMatin.id, 'kevin', 'Kevin', 'Sophie');
    await MX.DB.setWeekSlotTaskDone(a.nextWk, 'lundi', lMatin.id, lMatin.tasks[0].id, true, 'Kevin'); // terminé (1/1)
    await MX.DB.setWeekSlotAssignee(a.nextWk, 'mardi', mSoir.id, 'dorian', 'Dorian', 'Sophie');
    await MX.DB.setWeekSlotTaskDone(a.nextWk, 'mardi', mSoir.id, mSoir.tasks[0].id, true, 'Dorian'); // commencé (1/3)
    const lMatinBefore = JSON.stringify(wk().days.lundi.find(i => i.id === lMatin.id));
    const mSoirBefore = JSON.stringify(wk().days.mardi.find(i => i.id === mSoir.id));
    const mMatinBefore = JSON.stringify(wk().days.mardi.find(i => i.id === mMatin.id));

    // Modèle modifié : nouvelles missions lundi soir.
    const t = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    t.days.lundi[a.soirKey].missions = [{ text: 'Nouvelle mission lundi soir v2' }];
    await MX.DB.updateWeekTemplate(a.tplId, t, 'Sophie');

    const noOpt = await MX.DB.applyWeekTemplateToWeek(a.nextWk, MX.weekLabelOf(a.nextWk), a.tplId, {}, 'Sophie');
    const lSoirAfterNoOpt = wk().days.lundi.find(i => i.id === lSoir.id);
    const tplNow = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const activity = await MX.DB.collectWeekActivity(a.nextWk, wk(), tplNow);
    const preview = MX.DB.previewWeekTemplateApplication(wk(), tplNow, a.nextWk, { replaceNotStarted: true, activity });
    const withOpt = await MX.DB.applyWeekTemplateToWeek(a.nextWk, MX.weekLabelOf(a.nextWk), a.tplId, { replaceNotStarted: true }, 'Sophie');
    const after = wk();
    const reason = (d, src) => (withOpt.items.find(i => i.dayId === d && i.sourceShiftTemplateId === src) || {}).reason;
    return {
      noOptWritten: noOpt.written, noOptKept: lSoirAfterNoOpt.tasks[0].text !== 'Nouvelle mission lundi soir v2',
      previewReplace: preview.counts.replace,
      lSoirAfter: after.days.lundi.find(i => i.id === lSoir.id),
      lundiCount: after.days.lundi.length, mardiCount: after.days.mardi.length,
      lMatinSame: JSON.stringify(after.days.lundi.find(i => i.id === lMatin.id)) === lMatinBefore,
      mSoirSame: JSON.stringify(after.days.mardi.find(i => i.id === mSoir.id)) === mSoirBefore,
      mMatinReplaced: JSON.stringify(after.days.mardi.find(i => i.id === mMatin.id)) !== mMatinBefore,
      rLundiMatin: reason('lundi', a.matinId), rMardiSoir: reason('mardi', a.soirId),
    };
  }, { tplId, nextWk: ctx.nextWk, soirId: ctx.soirId, matinId: ctx.matinId, soirKey: created.soirKey });
  ok('10.1 Sans confirmation explicite (option), un créneau non commencé N\'EST PAS remplacé', repl.noOptWritten === false && repl.noOptKept);
  ok('10.2 Avec l\'option, l\'aperçu annonce les remplacements (créneaux non commencés uniquement)', repl.previewReplace === 2);
  ok('10.3 Remplacement : même instance (id), TECHNICIEN CONSERVÉ (Jordan), nouvelles missions', repl.lSoirAfter.userName === 'Jordan' && repl.lSoirAfter.userId === 'jordan' && repl.lSoirAfter.tasks.length === 1 && repl.lSoirAfter.tasks[0].text === 'Nouvelle mission lundi soir v2' && repl.lSoirAfter.tasks[0].done === false);
  ok('10.4 Checklist TERMINÉE jamais modifiée (lundi matin, octet pour octet) — raison "completed"', repl.lMatinSame && repl.rLundiMatin === 'completed');
  ok('10.5 Checklist COMMENCÉE jamais modifiée (mardi soir, octet pour octet) — raison "started"', repl.mSoirSame && repl.rMardiSoir === 'started');
  ok('10.6 Aucun doublon créé par le remplacement (nombre d\'instances inchangé)', repl.lundiCount === 2 && repl.mardiCount === 2);
  ok('10.7 Le créneau non commencé du mardi matin a bien été remplacé (option explicite)', repl.mMatinReplaced);

  // ═══════════ 11. Personnalisation (mission déplacée) jamais écrasée ═══════════
  const custom = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const wk = () => JSON.parse(JSON.stringify(store.week_slots[a.afterWk]));
    await MX.DB.applyWeekTemplateToWeek(a.afterWk, MX.weekLabelOf(a.afterWk), a.tplId, {}, 'Sophie');
    const lMatin = wk().days.lundi.find(i => i.templateId === a.matinId);
    const lSoir = wk().days.lundi.find(i => i.templateId === a.soirId);
    await MX.DB.moveWeekSlotTask(a.afterWk, 'lundi', lMatin.id, lSoir.id, lMatin.tasks[0].id, 'Sophie');
    const before = JSON.stringify(wk().days.lundi);
    const res = await MX.DB.applyWeekTemplateToWeek(a.afterWk, MX.weekLabelOf(a.afterWk), a.tplId, { replaceNotStarted: true }, 'Sophie');
    const r = s => (res.items.find(i => i.dayId === 'lundi' && i.sourceShiftTemplateId === s) || {}).reason;
    return { same: JSON.stringify(wk().days.lundi) === before, rMatin: r(a.matinId), rSoir: r(a.soirId) };
  }, { tplId, afterWk: ctx.afterWk, soirId: ctx.soirId, matinId: ctx.matinId });
  ok('11.1 Créneaux personnalisés (mission déplacée) jamais remplacés, même avec l\'option — raison "customized"', custom.same && custom.rMatin === 'customized' && custom.rSoir === 'customized');

  // ═══════════ 12. Instance ajoutée manuellement d'un autre créneau : jamais touchée ═══════════
  const manual = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const extraId = await MX.DB.addShiftTemplate({ name: 'Astreinte [DÉMO]', icon: '🚨', color: '#A78BFA', start: '07:00', end: '15:00', active: true, tasks: [{ id: 'x1', text: 'Tâche astreinte', order: 0 }] });
    await MX.DB.loadTemplateIntoWeekDay(a.nextWk, MX.weekLabelOf(a.nextWk), 'lundi', extraId, null, '', 'Sophie');
    const inst = JSON.parse(JSON.stringify(store.week_slots[a.nextWk].days.lundi.find(i => i.templateId === extraId)));
    await MX.DB.applyWeekTemplateToWeek(a.nextWk, MX.weekLabelOf(a.nextWk), a.tplId, { replaceNotStarted: true }, 'Sophie');
    const after = store.week_slots[a.nextWk].days.lundi.find(i => i.templateId === extraId);
    return { loadedOk: !!inst && inst.tasks.length === 1, same: JSON.stringify(after) === JSON.stringify(inst) };
  }, { tplId, nextWk: ctx.nextWk });
  ok('12.1 « Charger un modèle de créneau » (loadTemplateIntoWeekDay) fonctionne toujours', manual.loadedOk);
  ok('12.2 Une instance d\'un autre créneau, ajoutée à la main, n\'est jamais touchée', manual.same);

  // ═══════════ 13. Semaine passée et jours passés : intouchables ═══════════
  const past = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const existedBefore = !!(store.week_slots && store.week_slots[a.prevWk]);
    let code = null;
    try { await MX.DB.applyWeekTemplateToWeek(a.prevWk, MX.weekLabelOf(a.prevWk), a.tplId, {}, 'Sophie'); } catch (e) { code = e.code; }
    const existsAfter = !!(store.week_slots && store.week_slots[a.prevWk]);
    const tpl = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const pvPastWeek = MX.DB.previewWeekTemplateApplication(null, tpl, a.prevWk, {});
    // Jours passés de la semaine courante : on simule "aujourd'hui = mercredi"
    // de la semaine cible ; lundi et mardi deviennent des jours passés.
    const wed = MX.dateForWeekDay(a.emptyWk, 'mercredi');
    const pv = MX.DB.previewWeekTemplateApplication(null, tpl, a.emptyWk, { todayDateStr: wed });
    const res = await MX.DB.applyWeekTemplateToWeek(a.emptyWk, MX.weekLabelOf(a.emptyWk), a.tplId, { todayDateStr: wed }, 'Sophie');
    return { code, existedBefore, existsAfter, pastWeekAll: pvPastWeek.items.every(i => i.action === 'skip' && i.reason === 'past-week'), pastDays: pv.items.every(i => i.reason === 'past-day'), resWritten: res.written, wkCreated: !!(store.week_slots && store.week_slots[a.emptyWk]) };
  }, { tplId, prevWk: ctx.prevWk, emptyWk: ctx.laterWk });
  ok('13.1 Semaine passée : application refusée (code "past-week")', past.code === 'past-week');
  ok('13.2 Semaine passée : AUCUNE écriture', past.existedBefore === past.existsAfter && past.existsAfter === false);
  ok('13.3 Aperçu d\'une semaine passée : tout "past-week"', past.pastWeekAll);
  ok('13.4 Jours passés (lundi/mardi quand aujourd\'hui = mercredi) : tout "past-day", rien écrit', past.pastDays && past.resWritten === false && past.wkCreated === false);

  // ═══════════ 14. Semaine générée indépendante du modèle ═══════════
  const indepWeek = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const before = JSON.stringify(store.week_slots[a.nextWk]);
    const t = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    Object.values(t.days).forEach(d => Object.values(d).forEach(c => c.missions.forEach(m => { m.text = m.text + ' (v3)'; })));
    await MX.DB.updateWeekTemplate(a.tplId, t, 'Sophie');
    const afterUpdate = JSON.stringify(store.week_slots[a.nextWk]) === before;
    await MX.DB.archiveWeekTemplate(a.tplId, true, store.week_templates[a.tplId].version, 'Sophie');
    return { afterUpdate, afterDelete: JSON.stringify(store.week_slots[a.nextWk]) === before, deleted: store.week_templates[a.tplId].archived === true };
  }, { tplId, nextWk: ctx.nextWk });
  ok('14.1 Modifier le modèle après application ne modifie PAS la semaine générée', indepWeek.afterUpdate);
  ok('14.2 Archiver le modèle ne modifie PAS la semaine générée (suppression définitive retirée)', indepWeek.deleted && indepWeek.afterDelete);

  // ═══════════ 15. Transaction : annulation sans écriture partielle ═══════════
  const tx = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const before = JSON.stringify(store.week_slots || {});
    const aborted0 = window.__mockTxLog.aborted;
    let code = null;
    try { await MX.DB.applyWeekTemplateToWeek(a.nextWk, 'x', 'modele-inexistant', {}, 'Sophie'); } catch (e) { code = e.code; }
    let readAfterWrite = null;
    try {
      await firebase.firestore().runTransaction(async t => {
        const ref = firebase.firestore().collection('week_slots').doc(a.nextWk);
        await t.get(ref); t.set(ref, { probe: 1 }, { merge: true }); await t.get(ref);
      });
    } catch (e) { readAfterWrite = e.message; }
    return { code, abortedDelta: window.__mockTxLog.aborted - aborted0, unchanged: JSON.stringify(store.week_slots || {}) === before, readAfterWrite };
  }, { nextWk: ctx.nextWk });
  ok('15.1 Modèle introuvable : erreur "not-found", transaction annulée', tx.code === 'not-found' && tx.abortedDelta === 2);
  ok('15.2 Aucune écriture partielle après une transaction annulée', tx.unchanged);
  ok('15.3 Le mock applique la règle du vrai SDK : lectures avant écritures', /reads to be executed before all writes/.test(tx.readAfterWrite || ''));

  // ═══════════ 16. Anciennes données intactes ═══════════
  const legacy = await page.evaluate((a) => {
    const store = window.__mockDb._debugStore;
    const shifts = Object.entries(store.shift_templates).map(([id, d]) => Object.assign({ id }, d));
    const orig = JSON.parse(a.shiftsSnapshot);
    const untouched = orig.filter(o => o.id !== a.soirId).every(o => {
      const s = shifts.find(x => x.id === o.id);
      return s && s.name === o.name && s.start === o.start && s.end === o.end && s.color === o.color && JSON.stringify(s.tasks) === JSON.stringify(o.tasks);
    });
    const noWeekField = shifts.every(s => !('days' in s) && !('columns' in s));
    return { untouched, noWeekField, count: shifts.length };
  }, ctx);
  ok('16.1 Modèles de créneau existants intacts (hors modification volontaire du test 5)', legacy.untouched);
  ok('16.2 Aucune donnée de modèle de semaine mélangée dans shift_templates', legacy.noWeekField && legacy.count === 4);

  ok('17.1 Aucune erreur JS', pageErrors.length === 0);
  if (pageErrors.length) console.error('  erreurs JS :', pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  clearTimeout(_globalTimeout);
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests MODÈLES DE SEMAINE — DONNÉES (Playwright, mock Firestore) passent.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });
