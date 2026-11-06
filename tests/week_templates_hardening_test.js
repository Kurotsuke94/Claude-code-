// Tests Playwright (mock-firebase.js, AUCUNE base réelle) du LOT 1-BIS —
// durcissement de la couche de données des modèles de semaine (db.js) :
// activité externe (notes / photos / transferts) bloquant le remplacement,
// revalidation dans la transaction, sourceShiftTemplateId obligatoire,
// conflits de version entre deux responsables, archivage (plus de
// suppression), modèles inactifs, plafonds, weekKey / couleurs / horaires,
// règle "aujourd'hui = ajouts de créneaux non terminés uniquement",
// conservation des techniciens et des données existantes.
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
  await page.waitForFunction(() => Object.keys((window.__mockDb._debugStore.shift_templates) || {}).length >= 3, undefined, { timeout: 10000 });

  // Contexte commun : modèle "Matin + Soir actifs du lundi au dimanche".
  const ctx = await page.evaluate(async () => {
    const store = window.__mockDb._debugStore;
    const shifts = Object.entries(store.shift_templates).map(([id, d]) => Object.assign({ id }, d));
    const seed = s => shifts.find(x => x.isDefaultSeed === s);
    const matin = seed('matin'), soir = seed('soir');
    const columns = MX.DB.buildWeekTemplateColumns([matin, soir]);
    const days = MX.DB.emptyWeekTemplateDays(columns);
    ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].forEach(d => {
      days[d][columns[0].key] = { active: true, missions: [{ text: 'Matin ' + d + ' A' }, { text: 'Matin ' + d + ' B' }] };
      days[d][columns[1].key] = { active: true, missions: [{ text: 'Soir ' + d + ' A' }] };
    });
    const tplId = await MX.DB.addWeekTemplate({ name: 'Durcissement [DÉMO]', columns, days }, 'Sophie');
    const now = new Date();
    const plus = n => { const d = new Date(now); d.setDate(now.getDate() + n); return MX.weekKeyOf(d); };
    return { tplId, matinId: matin.id, soirId: soir.id, w1: plus(7), w2: plus(14), w3: plus(21), w4: plus(28), w5: plus(35), shiftsSnap: JSON.stringify(shifts) };
  });
  ok('0.1 Modèle de départ créé (version 1, non archivé)', await page.evaluate(id => { const t = window.__mockDb._debugStore.week_templates[id]; return t.version === 1 && t.archived === false; }, ctx.tplId));

  // ═══════════ 1. Activité externe : notes, photos, transferts ═══════════
  // Semaine w1 : modèle appliqué une fois, puis chaque jour reçoit une activité
  // différente sur son créneau du matin (non coché) ; remplacement demandé.
  const act = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const fs = firebase.firestore();
    await MX.DB.applyWeekTemplateToWeek(a.w1, 'x', a.tplId, {}, 'Sophie');
    const wk = () => JSON.parse(JSON.stringify(store.week_slots[a.w1]));
    const matinOf = d => wk().days[d].find(i => i.templateId === a.matinId);
    const key = (d, inst) => d + '_' + inst.id + '_' + inst.tasks[0].id;
    // Technicien affecté sur chaque matin (aucune case cochée).
    for (const [d, u] of [['lundi', 'Jordan'], ['mardi', 'Dorian'], ['mercredi', 'Kevin'], ['jeudi', 'Alban']]) {
      await MX.DB.setWeekSlotAssignee(a.w1, d, matinOf(d).id, u.toLowerCase(), u, 'Sophie');
    }
    // lundi : note / signalement bloqué (config/notes)
    await MX.DB.setNote(key('lundi', matinOf('lundi')), '[BLOQUÉ] Accès local technique fermé');
    // mardi : photo (task_photos/{clé})
    await fs.collection('task_photos').doc(key('mardi', matinOf('mardi'))).set({ photos: [{ data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', by: 'Dorian' }] }, { merge: true });
    // mercredi : transfert d'une tâche à un collègue
    await MX.DB.createTransfer({ taskId: matinOf('mercredi').tasks[0].id, taskText: 'x', dayId: 'mercredi', slot: matinOf('mercredi').id, fromUser: 'Kevin', toUser: 'Jordan' });
    // jeudi : AUCUNE activité (témoin : doit être remplacé)

    // Nouvelles missions dans le modèle pour rendre un remplacement visible.
    const t = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    ['lundi','mardi','mercredi','jeudi'].forEach(d => { t.days[d][t.columns[0].key].missions = [{ text: 'Matin ' + d + ' V2' }]; });
    await MX.DB.updateWeekTemplate(a.tplId, t, 'Sophie');

    const before = { lundi: JSON.stringify(matinOf('lundi')), mardi: JSON.stringify(matinOf('mardi')), mercredi: JSON.stringify(matinOf('mercredi')) };
    // Aperçu SANS données d'activité : remplacement refusé par prudence.
    const tpl = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const pvNoAct = MX.DB.previewWeekTemplateApplication(wk(), tpl, a.w1, { replaceNotStarted: true });
    // Aperçu AVEC les données d'activité (comme le fera l'interface).
    const activity = await MX.DB.collectWeekActivity(a.w1, wk(), tpl);
    const pv = MX.DB.previewWeekTemplateApplication(wk(), tpl, a.w1, { replaceNotStarted: true, activity });
    const res = await MX.DB.applyWeekTemplateToWeek(a.w1, 'x', a.tplId, { replaceNotStarted: true }, 'Sophie');
    const r = d => (res.items.find(i => i.dayId === d && i.sourceShiftTemplateId === a.matinId) || {}).reason;
    const pr = (p, d) => (p.items.find(i => i.dayId === d && i.sourceShiftTemplateId === a.matinId) || {}).reason;
    const jeudi = matinOf('jeudi');
    return {
      pvNoAct: ['lundi','mardi','mercredi','jeudi'].map(d => pr(pvNoAct, d)),
      pv: ['lundi','mardi','mercredi','jeudi'].map(d => pr(pv, d)),
      res: ['lundi','mardi','mercredi','jeudi'].map(r),
      lundiSame: JSON.stringify(matinOf('lundi')) === before.lundi,
      mardiSame: JSON.stringify(matinOf('mardi')) === before.mardi,
      mercrediSame: JSON.stringify(matinOf('mercredi')) === before.mercredi,
      jeudi: { userName: jeudi.userName, text: jeudi.tasks[0].text, n: jeudi.tasks.length },
      noteStill: !!(store.config && store.config.notes && Object.values(store.config.notes).some(v => /Accès local technique/.test(v))),
      activityKeys: { notes: activity.noteKeys.length, photos: activity.photoKeys.length, transfers: activity.transferTaskIds.length },
    };
  }, ctx);
  ok('1.1 Sans données d\'activité, aucun remplacement possible ("activity-unknown")', act.pvNoAct.every(x => x === 'activity-unknown'));
  ok('1.2 collectWeekActivity détecte la note, la photo et le transfert', act.activityKeys.notes === 1 && act.activityKeys.photos === 1 && act.activityKeys.transfers === 1);
  ok('1.3 Aperçu : note -> "has-activity" (lundi)', act.pv[0] === 'has-activity');
  ok('1.4 Aperçu : photo -> "has-activity" (mardi)', act.pv[1] === 'has-activity');
  ok('1.5 Aperçu : transfert -> "has-activity" (mercredi)', act.pv[2] === 'has-activity');
  ok('1.6 Aperçu : sans activité -> "replace" (jeudi, témoin)', act.pv[3] === 'not-started');
  ok('1.7 Application : mêmes décisions, recalculées DANS la transaction', act.res.join(',') === 'has-activity,has-activity,has-activity,not-started');
  ok('1.8 Créneau avec note jamais modifié (octet pour octet)', act.lundiSame);
  ok('1.9 Créneau avec photo jamais modifié (octet pour octet)', act.mardiSame);
  ok('1.10 Créneau avec transfert jamais modifié (octet pour octet)', act.mercrediSame);
  ok('1.11 Témoin remplacé : nouvelles missions, TECHNICIEN CONSERVÉ (Alban)', act.jeudi.userName === 'Alban' && act.jeudi.text === 'Matin jeudi V2' && act.jeudi.n === 1);
  ok('1.12 La note elle-même n\'est jamais touchée', act.noteStill);

  // Une activité ajoutée APRÈS l'aperçu est quand même vue par la transaction.
  const late = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    await MX.DB.applyWeekTemplateToWeek(a.w2, 'x', a.tplId, {}, 'Sophie');
    const wk = () => JSON.parse(JSON.stringify(store.week_slots[a.w2]));
    const inst = wk().days.vendredi.find(i => i.templateId === a.matinId);
    const tpl = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    tpl.days.vendredi[tpl.columns[0].key].missions = [{ text: 'Vendredi V3' }];
    await MX.DB.updateWeekTemplate(a.tplId, tpl, 'Sophie');
    const tpl2 = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const activity = await MX.DB.collectWeekActivity(a.w2, wk(), tpl2);
    const pv = MX.DB.previewWeekTemplateApplication(wk(), tpl2, a.w2, { replaceNotStarted: true, activity });
    const pvReason = (pv.items.find(i => i.dayId === 'vendredi' && i.sourceShiftTemplateId === a.matinId) || {}).reason;
    // Le technicien ajoute une note ENTRE l'aperçu et la confirmation.
    await MX.DB.setNote('vendredi_' + inst.id + '_' + inst.tasks[0].id, 'Observation ajoutée après l\'aperçu');
    const before = JSON.stringify(wk().days.vendredi.find(i => i.id === inst.id));
    const res = await MX.DB.applyWeekTemplateToWeek(a.w2, 'x', a.tplId, { replaceNotStarted: true }, 'Sophie');
    const r = (res.items.find(i => i.dayId === 'vendredi' && i.sourceShiftTemplateId === a.matinId) || {}).reason;
    return { pvReason, r, same: JSON.stringify(wk().days.vendredi.find(i => i.id === inst.id)) === before };
  }, ctx);
  ok('1.13 Note ajoutée après l\'aperçu : la transaction la voit et n\'écrase rien', late.pvReason === 'not-started' && late.r === 'has-activity' && late.same);

  // ═══════════ 2. Validation : revalidation dans la transaction, source obligatoire ═══════════
  const val = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const fs = firebase.firestore();
    const tryIt = async fn => { try { await fn(); return 'ok'; } catch (e) { return e.code || ('err:' + e.message); } };
    const good = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    // a) Modèle mal formé écrit DIRECTEMENT (hors application) : mission sans texte.
    const bad1 = JSON.parse(JSON.stringify(good));
    bad1.days.lundi[bad1.columns[0].key].missions = [{ id: 'm1' }];
    await fs.collection('week_templates').doc('bad-mission').set(bad1);
    // b) Colonne sans sourceShiftTemplateId.
    const bad2 = JSON.parse(JSON.stringify(good));
    delete bad2.columns[0].sourceShiftTemplateId;
    await fs.collection('week_templates').doc('bad-source').set(bad2);
    // c) missions qui n'est pas un tableau.
    const bad3 = JSON.parse(JSON.stringify(good));
    bad3.days.mardi[bad3.columns[1].key].missions = { pas: 'un tableau' };
    await fs.collection('week_templates').doc('bad-shape').set(bad3);
    const existedBefore = !!(store.week_slots && store.week_slots[a.w3]);
    const r1 = await tryIt(() => MX.DB.applyWeekTemplateToWeek(a.w3, 'x', 'bad-mission', {}, 'Sophie'));
    const r2 = await tryIt(() => MX.DB.applyWeekTemplateToWeek(a.w3, 'x', 'bad-source', {}, 'Sophie'));
    const r3 = await tryIt(() => MX.DB.applyWeekTemplateToWeek(a.w3, 'x', 'bad-shape', {}, 'Sophie'));
    const existsAfter = !!(store.week_slots && store.week_slots[a.w3]);
    let normSource = null;
    try { MX.DB.normalizeWeekTemplate(bad2); } catch (e) { normSource = e.code + '|' + e.message; }
    let addSource = await tryIt(() => MX.DB.addWeekTemplate(bad2, 'Sophie'));
    return { r1, r2, r3, existedBefore, existsAfter, normSource, addSource };
  }, ctx);
  ok('2.1 Modèle invalide (mission sans texte) refusé DANS la transaction', val.r1 === 'invalid-week-template');
  ok('2.2 Modèle sans sourceShiftTemplateId refusé DANS la transaction', val.r2 === 'invalid-week-template');
  ok('2.3 Modèle de forme invalide (missions non-tableau) refusé', val.r3 === 'invalid-week-template');
  ok('2.4 Aucune écriture dans week_slots après ces refus', val.existedBefore === false && val.existsAfter === false);
  ok('2.5 sourceShiftTemplateId obligatoire (normalize + création)', /^invalid-week-template\|.*sourceShiftTemplateId/.test(val.normSource || '') && val.addSource === 'invalid-week-template');

  // ═══════════ 3. Conflit de version entre deux responsables ═══════════
  const ver = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const read = () => JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const kevin = read(), alban = read();                    // ouverture simultanée
    const v0 = kevin.version;
    kevin.days.samedi[kevin.columns[1].key].missions = [{ text: 'Samedi soir — Kevin' }];
    const vK = await MX.DB.updateWeekTemplate(a.tplId, kevin, 'Kevin');
    alban.description = 'Modifié par Alban';
    let err = null;
    try { await MX.DB.updateWeekTemplate(a.tplId, alban, 'Alban'); } catch (e) { err = e; }
    const afterConflict = read();
    // Alban recharge puis enregistre : accepté, et le travail de Kevin est conservé.
    const reloaded = read();
    reloaded.description = 'Modifié par Alban';
    const vA = await MX.DB.updateWeekTemplate(a.tplId, reloaded, 'Alban');
    const final = read();
    // Activation avec une version périmée : refusée aussi.
    let errActive = null;
    try { await MX.DB.setWeekTemplateActive(a.tplId, false, v0, 'Kevin'); } catch (e) { errActive = e.code; }
    return {
      v0, vK, vA, code: err && err.code, msg: err && err.message, by: err && err.updatedBy,
      kevinKept: afterConflict.days.samedi[afterConflict.columns[1].key].missions[0].text === 'Samedi soir — Kevin' && afterConflict.description !== 'Modifié par Alban',
      bothKept: final.description === 'Modifié par Alban' && final.days.samedi[final.columns[1].key].missions[0].text === 'Samedi soir — Kevin',
      finalVersion: final.version, errActive, stillActive: final.active === true,
    };
  }, ctx);
  ok('3.1 Premier enregistrement accepté : version incrémentée', ver.vK === ver.v0 + 1);
  ok('3.2 Second enregistrement concurrent REFUSÉ (code "version-conflict")', ver.code === 'version-conflict');
  ok('3.3 Message clair : modifié entre-temps par Kevin, recharger le modèle', ver.by === 'Kevin' && /modifié entre-temps par Kevin/.test(ver.msg) && /Rechargez/.test(ver.msg));
  ok('3.4 Le travail de Kevin n\'a pas été écrasé', ver.kevinKept);
  ok('3.5 Après rechargement, l\'enregistrement d\'Alban passe et conserve celui de Kevin', ver.vA === ver.vK + 1 && ver.bothKept);
  ok('3.6 Activation avec une version périmée refusée également', ver.errActive === 'version-conflict' && ver.stillActive);

  // ═══════════ 4. Archivage (plus de suppression définitive) et modèle inactif ═══════════
  const arch = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const read = () => JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const tryIt = async fn => { try { await fn(); return 'ok'; } catch (e) { return e.code || ('err:' + e.message); } };
    const w1Before = JSON.stringify(store.week_slots[a.w1]);
    const noDelete = typeof MX.DB.deleteWeekTemplate === 'undefined';
    await MX.DB.archiveWeekTemplate(a.tplId, true, read().version, 'Sophie');
    const t = read();
    const applyArchived = await tryIt(() => MX.DB.applyWeekTemplateToWeek(a.w4, 'x', a.tplId, {}, 'Sophie'));
    const updateArchived = await tryIt(() => MX.DB.updateWeekTemplate(a.tplId, read(), 'Sophie'));
    const w4Created = !!(store.week_slots && store.week_slots[a.w4]);
    const copyId = await MX.DB.duplicateWeekTemplate(a.tplId, 'Sophie');
    const copy = store.week_templates[copyId];
    const applyCopy = await tryIt(() => MX.DB.applyWeekTemplateToWeek(a.w4, 'x', copyId, {}, 'Sophie'));
    await MX.DB.archiveWeekTemplate(a.tplId, false, read().version, 'Sophie');
    const unarchived = read().archived === false;
    // Modèle désactivé : application refusée.
    await MX.DB.setWeekTemplateActive(a.tplId, false, read().version, 'Sophie');
    const applyInactive = await tryIt(() => MX.DB.applyWeekTemplateToWeek(a.w5, 'x', a.tplId, {}, 'Sophie'));
    const w5Created = !!(store.week_slots && store.week_slots[a.w5]);
    await MX.DB.setWeekTemplateActive(a.tplId, true, read().version, 'Sophie');
    return {
      noDelete, archived: t.archived === true && t.archivedBy === 'Sophie', stillStored: !!store.week_templates[a.tplId],
      applyArchived, updateArchived, w4Created, copyOk: copy && copy.archived === false && copy.version === 1, applyCopy,
      unarchived, applyInactive, w5Created, w1Same: JSON.stringify(store.week_slots[a.w1]) === w1Before,
    };
  }, ctx);
  ok('4.1 Aucune fonction de suppression définitive exposée (deleteWeekTemplate absente)', arch.noDelete);
  ok('4.2 Archivage : modèle conservé, marqué archivé (traçabilité)', arch.archived && arch.stillStored);
  ok('4.3 Modèle archivé : application refusée (code "archived"), rien écrit', arch.applyArchived === 'archived' && !arch.w4Created);
  ok('4.4 Modèle archivé : modification refusée (code "archived")', arch.updateArchived === 'archived');
  ok('4.5 Un modèle archivé peut être dupliqué ; la copie est active et applicable', arch.copyOk && arch.applyCopy === 'ok');
  ok('4.6 Réactivation possible', arch.unarchived);
  ok('4.7 Modèle désactivé : application refusée (code "inactive"), rien écrit', arch.applyInactive === 'inactive' && !arch.w5Created);
  ok('4.8 Les semaines déjà générées ne sont jamais modifiées par l\'archivage', arch.w1Same);

  // ═══════════ 5. Plafonds ═══════════
  const caps = await page.evaluate((a) => {
    const store = window.__mockDb._debugStore;
    const base = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
    const mkCols = n => Array.from({ length: n }, (_, i) => ({ key: 'k' + i, sourceShiftTemplateId: 's' + i, name: 'C' + i, color: '#112233', start: '08:00', end: '16:00' }));
    const r = {};
    r.cols12 = code(() => MX.DB.normalizeWeekTemplate({ name: 'x', columns: mkCols(12), days: {} }));
    r.cols13 = code(() => MX.DB.normalizeWeekTemplate({ name: 'x', columns: mkCols(13), days: {} }));
    r.cols0 = code(() => MX.DB.normalizeWeekTemplate({ name: 'x', columns: [], days: {} }));
    const cellN = n => { const t = JSON.parse(JSON.stringify(base)); t.days.lundi[t.columns[0].key] = { active: true, missions: Array.from({ length: n }, (_, i) => ({ text: 'M' + i })) }; return t; };
    r.cell60 = code(() => MX.DB.normalizeWeekTemplate(cellN(60)));
    r.cell61 = code(() => MX.DB.normalizeWeekTemplate(cellN(61)));
    const total = JSON.parse(JSON.stringify(base));
    const cols = mkCols(11);
    total.columns = cols; total.days = {};
    ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].forEach(d => { total.days[d] = {}; cols.forEach(c => { total.days[d][c.key] = { active: true, missions: Array.from({ length: 8 }, (_, i) => ({ text: d + c.key + i })) }; }); });
    r.total616 = code(() => MX.DB.normalizeWeekTemplate(total));           // 7 × 11 × 8 = 616 > 600
    const twelve = Object.assign({}, base, { columns: mkCols(12) });
    r.addCol13 = code(() => MX.DB.addWeekTemplateColumn(twelve, { id: 'nouveau', name: 'N', color: '#000000' }));
    r.longMission = code(() => { const t = JSON.parse(JSON.stringify(base)); t.days.lundi[t.columns[0].key].missions = [{ text: 'x'.repeat(201) }]; MX.DB.normalizeWeekTemplate(t); });
    return r;
  }, ctx);
  ok('5.1 12 créneaux acceptés, 13 refusés, 0 refusé', caps.cols12 === 'ok' && caps.cols13 === 'invalid-week-template' && caps.cols0 === 'invalid-week-template');
  ok('5.2 60 missions par créneau acceptées, 61 refusées', caps.cell60 === 'ok' && caps.cell61 === 'invalid-week-template');
  ok('5.3 Plus de 600 missions au total refusées', caps.total616 === 'invalid-week-template');
  ok('5.4 Ajout d\'une 13e colonne refusé', caps.addCol13 === 'invalid-week-template');
  ok('5.5 Mission > 200 caractères refusée', caps.longMission === 'invalid-week-template');

  // ═══════════ 6. weekKey, couleurs, horaires ═══════════
  const fmt = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const base = JSON.parse(JSON.stringify(store.week_templates[a.tplId]));
    const code = fn => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
    const acode = async fn => { try { await fn(); return 'ok'; } catch (e) { return e.code; } };
    const r = {};
    const keysBefore = Object.keys(store.week_slots || {}).sort().join(',');
    for (const k of ['abc', '2026-W47', '2026_W54', '2026_W00', '2026_W1', '']) {
      r['apply_' + k] = await acode(() => MX.DB.applyWeekTemplateToWeek(k, 'x', a.tplId, {}, 'Sophie'));
    }
    r.preview = code(() => MX.DB.previewWeekTemplateApplication(null, base, 'abc', {}));
    r.collect = await acode(() => MX.DB.collectWeekActivity('abc', null, base));
    r.noDocCreated = Object.keys(store.week_slots || {}).sort().join(',') === keysBefore;
    const withCol = patch => { const t = JSON.parse(JSON.stringify(base)); Object.assign(t.columns[0], patch); return code(() => MX.DB.normalizeWeekTemplate(t)); };
    r.colGGG = withCol({ color: '#GGG000' });
    r.colRed = withCol({ color: 'red' });
    r.colShort = withCol({ color: '#FFF' });
    r.colOk = withCol({ color: '#a1B2c3' });
    r.time25 = withCol({ start: '25:00' });
    r.time8 = withCol({ start: '8:00' });
    r.time60 = withCol({ end: '12:60' });
    r.timeEmpty = withCol({ start: '', end: '' });
    // Capture depuis un modèle de créneau aux valeurs historiques invalides : neutralisées.
    const cap = MX.DB.buildWeekTemplateColumns([{ id: 'legacy', name: 'Ancien', color: 'jaune', start: '8h', end: '17:00' }])[0];
    r.capture = cap.color === '#6B7280' && cap.start === '' && cap.end === '17:00';
    return r;
  }, ctx);
  ok('6.1 weekKey invalides refusés (abc, 2026-W47, W54, W00, W1, vide)', ['abc', '2026-W47', '2026_W54', '2026_W00', '2026_W1', ''].every(k => fmt['apply_' + k] === 'invalid-week-key'));
  ok('6.2 weekKey invalide : aucun document week_slots créé', fmt.noDocCreated);
  ok('6.3 Aperçu et collecte d\'activité refusent aussi un weekKey invalide', fmt.preview === 'invalid-week-key' && fmt.collect === 'invalid-week-key');
  ok('6.4 Couleurs invalides refusées (#GGG000, red, #FFF), #RRGGBB accepté', fmt.colGGG === 'invalid-week-template' && fmt.colRed === 'invalid-week-template' && fmt.colShort === 'invalid-week-template' && fmt.colOk === 'ok');
  ok('6.5 Horaires invalides refusés (25:00, 8:00, 12:60), horaires vides acceptés', fmt.time25 === 'invalid-week-template' && fmt.time8 === 'invalid-week-template' && fmt.time60 === 'invalid-week-template' && fmt.timeEmpty === 'ok');
  ok('6.6 Capture depuis un ancien modèle de créneau aux valeurs invalides : neutralisées sans erreur', fmt.capture);

  // ═══════════ 7. Aujourd'hui : uniquement des ajouts de créneaux non terminés ═══════════
  const today = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const shifts = () => Object.entries(store.shift_templates).map(([id, d]) => Object.assign({ id }, d));
    const nuitId = await MX.DB.addShiftTemplate({ name: 'Nuit [DÉMO]', icon: '🌙', color: '#1E3A8A', start: '22:00', end: '06:00', active: true, tasks: [] });
    const libreId = await MX.DB.addShiftTemplate({ name: 'Sans horaire [DÉMO]', icon: '⭐', color: '#A78BFA', start: '', end: '', active: true, tasks: [] });
    const pick = id => shifts().find(s => s.id === id);
    const columns = MX.DB.buildWeekTemplateColumns([pick(a.matinId), pick(nuitId), pick(libreId)]);
    const days = MX.DB.emptyWeekTemplateDays(columns);
    ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'].forEach(d => columns.forEach(c => { days[d][c.key] = { active: true, missions: [{ text: c.name + ' ' + d }] }; }));
    const tplId = await MX.DB.addWeekTemplate({ name: 'Aujourd\'hui [DÉMO]', columns, days }, 'Sophie');
    const todayId = MX.todayId();
    const wk = MX.weekKeyOf(new Date());
    const todayStr = MX.dateForWeekDay(wk, todayId);
    // Le technicien de garde ce matin est déjà affecté et a commencé.
    await MX.DB.ensureWeekSlots(wk, 'x', 'Sophie');
    const existingId = await MX.DB.loadTemplateIntoWeekDay(wk, 'x', todayId, a.soirId, 'jordan', 'Jordan', 'Sophie');
    const exBefore = JSON.stringify(store.week_slots[wk].days[todayId].find(i => i.id === existingId));
    // 17:00 : Matin (fin 16:33) terminé, Nuit (22:00→06:00) non terminé, Sans horaire inconnu.
    const res1 = await MX.DB.applyWeekTemplateToWeek(wk, 'x', tplId, { todayDateStr: todayStr, nowTime: '17:00' }, 'Sophie');
    const rT = (res, src) => (res.items.find(i => i.dayId === todayId && i.sourceShiftTemplateId === src) || {}).reason;
    const r1 = { matin: rT(res1, a.matinId), nuit: rT(res1, nuitId), libre: rT(res1, libreId) };
    const pastReasons = res1.items.filter(i => i.dateStr < todayStr).map(i => i.reason);
    const futureAdds = res1.items.filter(i => i.dateStr > todayStr).every(i => i.action === 'add');
    const todayList1 = store.week_slots[wk].days[todayId].map(i => i.templateId);
    // 09:00 : le Matin n'est pas terminé -> ajout autorisé.
    const res2 = await MX.DB.applyWeekTemplateToWeek(wk, 'x', tplId, { todayDateStr: todayStr, nowTime: '09:00' }, 'Sophie');
    const r2matin = rT(res2, a.matinId);
    // Remplacement demandé le jour même : jamais.
    const res3 = await MX.DB.applyWeekTemplateToWeek(wk, 'x', tplId, { todayDateStr: todayStr, nowTime: '09:00', replaceNotStarted: true }, 'Sophie');
    const r3 = { matin: rT(res3, a.matinId), nuit: rT(res3, nuitId) };
    const exAfter = JSON.stringify(store.week_slots[wk].days[todayId].find(i => i.id === existingId));
    return { todayId, r1, pastReasons, futureAdds, nuitAdded: todayList1.indexOf(nuitId) !== -1, matinAdded1: todayList1.indexOf(a.matinId) !== -1, r2matin, r3, exSame: exBefore === exAfter };
  }, ctx);
  ok('7.1 Aujourd\'hui : créneau TERMINÉ jamais ajouté (Matin à 17:00 -> "slot-ended")', today.r1.matin === 'slot-ended' && !today.matinAdded1);
  ok('7.2 Aujourd\'hui : créneau non terminé ajouté (Nuit 22:00→06:00 à 17:00)', today.r1.nuit === 'absent' && today.nuitAdded);
  ok('7.3 Aujourd\'hui : horaire inconnu -> refus prudent ("today-no-schedule")', today.r1.libre === 'today-no-schedule');
  ok('7.4 Jours passés de la semaine : tous "past-day"', today.pastReasons.every(r => r === 'past-day'));
  ok('7.5 Jours futurs : ajouts', today.futureAdds);
  ok('7.6 Aujourd\'hui à 09:00 : le Matin (non terminé) peut être ajouté', today.r2matin === 'absent');
  ok('7.7 Aujourd\'hui : jamais de remplacement, même avec l\'option ("today-no-replace")', today.r3.matin === 'today-no-replace' && today.r3.nuit === 'today-no-replace');
  ok('7.8 Créneau du jour déjà affecté (Jordan) jamais modifié', today.exSame);

  // ═══════════ 8. Conservation des techniciens et des données existantes ═══════════
  const keep = await page.evaluate(async (a) => {
    const store = window.__mockDb._debugStore;
    const wk = () => JSON.parse(JSON.stringify(store.week_slots[a.w2]));
    // Technicien affecté + tâche cochée sur un créneau ; puis application "Compléter".
    const inst = wk().days.samedi.find(i => i.templateId === a.soirId);
    await MX.DB.setWeekSlotAssignee(a.w2, 'samedi', inst.id, 'dorian', 'Dorian', 'Sophie');
    await MX.DB.setWeekSlotTaskDone(a.w2, 'samedi', inst.id, inst.tasks[0].id, true, 'Dorian');
    const before = JSON.stringify(wk());
    const res = await MX.DB.applyWeekTemplateToWeek(a.w2, 'x', a.tplId, {}, 'Sophie');
    const after = wk();
    const s = after.days.samedi.find(i => i.id === inst.id);
    const shiftsNow = Object.entries(store.shift_templates).map(([id, d]) => Object.assign({ id }, d));
    const orig = JSON.parse(a.shiftsSnap);
    const shiftsKept = orig.every(o => { const n = shiftsNow.find(x => x.id === o.id); return n && n.name === o.name && n.start === o.start && n.end === o.end && JSON.stringify(n.tasks) === JSON.stringify(o.tasks); });
    // Chargement d'un modèle de créneau : toujours fonctionnel.
    const loadedId = await MX.DB.loadTemplateIntoWeekDay(a.w2, 'x', 'dimanche', a.matinId, 'kevin', 'Kevin', 'Sophie');
    const loaded = wk().days.dimanche.find(i => i.id === loadedId);
    return { written: res.written, sameWeek: JSON.stringify(after) === before, userKept: s.userName === 'Dorian' && s.userId === 'dorian', doneKept: s.tasks[0].done === true, shiftsKept, loadedOk: !!loaded && loaded.userName === 'Kevin' };
  }, ctx);
  ok('8.1 « Compléter » sur une semaine déjà générée : rien écrit, semaine identique', keep.written === false && keep.sameWeek);
  ok('8.2 Technicien (Dorian) et case cochée conservés', keep.userKept && keep.doneKept);
  ok('8.3 Modèles de créneau existants inchangés', keep.shiftsKept);
  ok('8.4 « Charger un modèle de créneau » fonctionne toujours (technicien choisi conservé)', keep.loadedOk);

  ok('9.1 Aucune erreur JS', pageErrors.length === 0);
  if (pageErrors.length) console.error('  erreurs JS :', pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  clearTimeout(_globalTimeout);
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests MODÈLES DE SEMAINE — DURCISSEMENT (Playwright, mock Firestore) passent.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });
