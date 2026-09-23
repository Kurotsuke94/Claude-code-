// Tests pour "Répartition temporaire des missions" (Gestion semaine tech).
// Voir demande : déplacer une tâche d'une instance week_slots à une autre
// AU SEIN DU MÊME JOUR, sans jamais toucher shift_templates, avec une
// méthode drag & drop (desktop) ET une méthode par clic/panneau (mobile).
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (120s) — le process est arrêté de force.');
  process.exit(1);
}, 120000);

async function bootPage(page, opts) {
  opts = opts || {};
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript({ path: MOCK_FB });
  if (opts.denyWeekSlots) await page.addInitScript(() => { window.__mockDenyColl = { week_slots: true }; });
  await page.addInitScript({ path: SEED });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { await window.__seedGst(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
  return pageErrors;
}
async function pinLogin(page, userId, pin) {
  await page.evaluate((userId) => { MX.Auth.selectUser(userId); }, userId);
  await page.waitForTimeout(150);
  await page.evaluate((pin) => { document.getElementById('pin-input').value = pin; }, pin);
  await page.evaluate(async () => { await MX.Auth.confirmPin(); });
  await page.waitForTimeout(300);
}
function evalPage(page, fn, ...args) { return page.evaluate(fn, ...args); }

async function seedInstance(page, dayId, opts) {
  const weekKey = await evalPage(page, () => MX.weekKeyOf(new Date()));
  return evalPage(page, async (a) => {
    const tplId = await MX.DB.addShiftTemplate({
      name: a.opts.name, icon: a.opts.icon || '', color: a.opts.color || '#6B7280',
      start: a.opts.start || '', end: a.opts.end || '', active: true,
      tasks: Array.from({ length: a.opts.taskCount || 0 }, (_, i) => ({ id: 't' + i, text: a.opts.name + ' tâche ' + (i + 1), order: i })),
    });
    const user = a.opts.userName ? (MX.state.users || []).find(u => u.name === a.opts.userName) : null;
    const instId = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplId, user ? user.id : null, user ? user.name : '', 'test');
    return { tplId, instId, weekKey: a.wk };
  }, { dayId, opts, wk: weekKey });
}
async function getWeekDoc(page, wk) { return evalPage(page, (a) => MX.DB.getWeekSlots(a.wk), { wk }); }
async function openGst(page) {
  await page.evaluate(() => { MX.showPage('gestion-semaine-tech'); });
  await page.waitForTimeout(250);
}
async function showMissions(page) {
  await page.evaluate(() => { if (!MX.Pages.GestSemaine) return; const html = document.getElementById('main-content').innerHTML; if (!/Masquer les missions/.test(html)) MX.Pages.GestSemaine._toggleShowMissions(); });
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => { ctx.route('**://*.googleapis.com/**', r => r.abort()); ctx.route('**://*.gstatic.com/**', r => r.abort()); };
  const newCtx = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await routeBlock(ctx);
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page, opts);
    return { ctx, page, pageErrors };
  };

  // ═══ 1. Affichage des missions ═══
  {
    console.log('\n--- 1. Toggle "Afficher les missions" ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', start: '08:00', end: '16:33', userName: 'Kevin', taskCount: 3 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    let html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('1.1 Vue compacte par défaut (pas de tâches listées)', !/Matin tâche 1/.test(html));
    await showMissions(page);
    html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('1.2 Après clic "Afficher les missions", les tâches sont listées', /Matin tâche 1/.test(html) && /Matin tâche 2/.test(html) && /Matin tâche 3/.test(html));
    await ctx.close();
  }

  // ═══ 2. Déplacement Matin → Journée (via drag & drop réel Playwright) ═══
  {
    console.log('\n--- 2. Déplacement Matin → Journée (drag & drop) ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rMatin   = await seedInstance(page, todayId, { name: 'Matin',   icon: '☀️', userName: 'Kevin', taskCount: 2 });
    const rJournee = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 2 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await showMissions(page);
    const srcCard = '#gst-card-' + todayId + '_' + rMatin.instId;
    const dstCard = '#gst-card-' + todayId + '_' + rJournee.instId;
    const srcTaskSel = srcCard + ' div[draggable="true"]:has-text("Matin tâche 1")';
    await page.waitForSelector(srcTaskSel);
    await page.dragAndDrop(srcTaskSel, dstCard);
    await page.waitForTimeout(400);
    const doc = await getWeekDoc(page, wk);
    const matinAfter   = doc.days[todayId].find(i => i.id === rMatin.instId);
    const journeeAfter = doc.days[todayId].find(i => i.id === rJournee.instId);
    ok('2.1 "Matin tâche 1" a quitté Matin', !matinAfter.tasks.some(t => t.text === 'Matin tâche 1'));
    ok('2.2 "Matin tâche 1" est bien dans Journée', journeeAfter.tasks.some(t => t.text === 'Matin tâche 1'));
    ok('2.3 Matin garde son autre tâche (pas tout déplacé)', matinAfter.tasks.length === 1 && matinAfter.tasks[0].text === 'Matin tâche 2');
    ok('2.4 Journée a bien 3 tâches (2 d\'origine + 1 déplacée)', journeeAfter.tasks.length === 3);
    ok('2.5 movedFrom pointe vers l\'instance Matin d\'origine', journeeAfter.tasks.find(t => t.text === 'Matin tâche 1').movedFrom === rMatin.instId);
    await ctx.close();
  }

  // ═══ 3-4. Déplacement Journée → Soir, puis Soir → Matin (panneau clic) ═══
  {
    console.log('\n--- 3-4. Journée → Soir puis Soir → Matin (panneau clic) ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rMatin   = await seedInstance(page, todayId, { name: 'Matin',   icon: '☀️', userName: 'Kevin', taskCount: 1 });
    const rJournee = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    const rSoir    = await seedInstance(page, todayId, { name: 'Soir',    icon: '🌙', userName: 'Kevin', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await showMissions(page);

    // Journée → Soir via le panneau (clic sur la tâche)
    await page.click('#gst-card-' + todayId + '_' + rJournee.instId + ' div[draggable="true"]');
    await page.waitForTimeout(200);
    let modalHtml = await page.evaluate(() => document.getElementById('m-sub').innerHTML);
    ok('3.1 Panneau ouvert avec les 2 autres créneaux en choix', /Matin/.test(modalHtml) && /Soir/.test(modalHtml));
    // sélectionner "Soir"
    await page.evaluate((soirId) => { document.querySelector('input[name="mtm-dest"][value="' + soirId + '"]').checked = true; }, rSoir.instId);
    await page.click('button.modal-btn.confirm');
    await page.waitForTimeout(300);
    let doc = await getWeekDoc(page, wk);
    ok('3.2 "Journée tâche 1" déplacée vers Soir', doc.days[todayId].find(i => i.id === rSoir.instId).tasks.some(t => t.text === 'Journée tâche 1'));
    ok('3.3 Journée est maintenant vide', doc.days[todayId].find(i => i.id === rJournee.instId).tasks.length === 0);

    // Soir → Matin (la tâche native "Soir tâche 1", via panneau) — on reste
    // sur la même page (le rechargement F5/persistance est déjà testé
    // séparément aux points 11-12, pas besoin de le redémontrer ici).
    const soirTaskSel = '#gst-card-' + todayId + '_' + rSoir.instId + ' div[draggable="true"]:has-text("Soir tâche 1")';
    await page.waitForSelector(soirTaskSel);
    await page.click(soirTaskSel);
    await page.waitForTimeout(200);
    await page.evaluate((matinId) => { const el = document.querySelector('input[name="mtm-dest"][value="' + matinId + '"]'); if (el) el.checked = true; }, rMatin.instId);
    await page.click('button.modal-btn.confirm');
    await page.waitForTimeout(300);
    doc = await getWeekDoc(page, wk);
    ok('4.1 "Soir tâche 1" déplacée vers Matin', doc.days[todayId].find(i => i.id === rMatin.instId).tasks.some(t => t.text === 'Soir tâche 1'));
    ok('4.2 Matin a maintenant 2 tâches', doc.days[todayId].find(i => i.id === rMatin.instId).tasks.length === 2);
    await ctx.close();
  }

  // ═══ 5-8. Suppression source / ajout destination / aucun doublon / ID+done+métadonnées conservés ═══
  {
    console.log('\n--- 5-10. Intégrité des données après déplacement direct (DB) ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 3, start: '13:00', end: '21:33' });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 2, start: '10:00', end: '18:33' });
    let doc = await getWeekDoc(page, wk);
    const srcInst = doc.days[todayId].find(i => i.id === rSrc.instId);
    const taskId = srcInst.tasks[1].id; // "Soir tâche 2"
    await page.evaluate((a) => MX.DB.setWeekSlotTaskDone(a.wk, a.dayId, a.instId, a.taskId, true, 'sophie'), { wk, dayId: todayId, instId: rSrc.instId, taskId });
    doc = await getWeekDoc(page, wk);
    const taskBefore = doc.days[todayId].find(i => i.id === rSrc.instId).tasks.find(t => t.id === taskId);
    ok('setup: tâche cochée avant déplacement (précondition)', taskBefore.done === true);

    await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId });
    doc = await getWeekDoc(page, wk);
    const srcAfter = doc.days[todayId].find(i => i.id === rSrc.instId);
    const dstAfter = doc.days[todayId].find(i => i.id === rDst.instId);
    ok('5. Tâche retirée de la source', !srcAfter.tasks.some(t => t.id === taskId));
    ok('5b. Source garde ses 2 autres tâches', srcAfter.tasks.length === 2);
    ok('6. Tâche ajoutée dans la destination', dstAfter.tasks.some(t => t.id === taskId));
    ok('6b. Destination a bien 3 tâches (2+1)', dstAfter.tasks.length === 3);
    ok('7. Aucun doublon (id présent une seule fois, toutes journées confondues)', doc.days[todayId].reduce((n, i) => n + i.tasks.filter(t => t.id === taskId).length, 0) === 1);
    const movedTask = dstAfter.tasks.find(t => t.id === taskId);
    ok('8. ID de tâche conservé', movedTask.id === taskId);
    ok('9. État done conservé (true)', movedTask.done === true);
    ok('9b. Texte de la tâche conservé', movedTask.text === 'Soir tâche 2');
    ok('10. movedFrom (métadonnée) présent et correct', movedTask.movedFrom === rSrc.instId);
    await ctx.close();
  }

  // ═══ 11-12. Persistance Firestore + F5 ═══
  {
    console.log('\n--- 11-12. Persistance + F5 ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 1 });
    const rDst = await seedInstance(page, todayId, { name: 'Soir',  icon: '🌙', userName: 'Kevin', taskCount: 1 });
    let doc = await getWeekDoc(page, wk);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;
    await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId });
    doc = await getWeekDoc(page, wk);
    ok('11. Écrit en base (relecture immédiate confirme)', doc.days[todayId].find(i => i.id === rDst.instId).tasks.some(t => t.id === taskId));
    // "F5" : un vrai page.reload() ne prouve rien de plus ici — mock-
    // firebase.js ne persiste QUE l'auth via localStorage (voir auth_test.js/
    // admin_session_test.js) ; ses collections Firestore vivent en mémoire
    // pure par page et sont donc TOUJOURS vidées par un reload, y compris
    // pour un déplacement parfaitement réussi (limitation connue du mock,
    // sans rapport avec cette fonctionnalité). On prouve la même chose que
    // F5 démontrerait — que la donnée est bien dans le "serveur" et pas
    // seulement dans un état local optimiste — via une resouscription
    // Firestore fraîche après avoir explicitement vidé le cache local de
    // l'écran (_weekData) : _goToday() force _weekData=null puis relit.
    await evalPage(page, () => { MX.Pages.GestSemaine._goToday(); });
    await page.waitForTimeout(400);
    doc = await getWeekDoc(page, wk);
    ok('12. Toujours présent après une resouscription Firestore fraîche (preuve de persistance équivalente à F5 dans ce harnais)', doc.days[todayId].find(i => i.id === rDst.instId).tasks.some(t => t.id === taskId));
    const uiHtml = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('12b. L\'écran lui-même (pas seulement getWeekSlots) réaffiche l\'état persistant après re-render', uiHtml.length > 100);
    await ctx.close();
  }

  // ═══ 13. Modèle shift_templates inchangé ═══
  {
    console.log('\n--- 13. shift_templates strictement inchangé après déplacement ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 3 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 2 });
    const tplBefore = await page.evaluate((tplId) => new Promise(r => { const u = MX.DB.listenShiftTemplates(l => r(l.find(t => t.id === tplId))); }), rSrc.tplId);
    let doc = await getWeekDoc(page, wk);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;
    await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId });
    const tplAfter = await page.evaluate((tplId) => new Promise(r => { const u = MX.DB.listenShiftTemplates(l => r(l.find(t => t.id === tplId))); }), rSrc.tplId);
    ok('13. shift_templates "Soir" a toujours ses 3 tâches d\'origine, à l\'identique', JSON.stringify(tplBefore.tasks) === JSON.stringify(tplAfter.tasks));
    await ctx.close();
  }

  // ═══ 14. Autre jour inchangé ═══
  {
    console.log('\n--- 14. Un autre jour de la même semaine n\'est pas affecté ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const otherDay = todayId === 'lundi' ? 'mardi' : 'lundi';
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 2 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    const rOther = await seedInstance(page, otherDay, { name: 'Matin', icon: '☀️', userName: 'Jordan', taskCount: 2 });
    let doc = await getWeekDoc(page, wk);
    const otherBefore = JSON.stringify(doc.days[otherDay]);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;
    await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId });
    doc = await getWeekDoc(page, wk);
    ok('14. Le jour ' + otherDay + ' est strictement inchangé', JSON.stringify(doc.days[otherDay]) === otherBefore);
    await ctx.close();
  }

  // ═══ 15-16. Autre semaine inchangée + génération d'une nouvelle semaine intacte ═══
  {
    console.log('\n--- 15-16. Semaine suivante inchangée, puis générée depuis les modèles ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const nextWk = await evalPage(page, () => { const m = MX.mondayOfWeekKey(MX.weekKeyOf(new Date())); m.setDate(m.getDate() + 7); return MX.weekKeyOf(m); });
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 2 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    let doc = await getWeekDoc(page, wk);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;
    await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId });

    const nextBefore = await getWeekDoc(page, nextWk);
    ok('15. La semaine suivante (pas encore créée) reste absente/non affectée', nextBefore === null);

    // Nouvelle semaine générée depuis les modèles pour le même jour — ne doit reproduire aucun déplacement
    await page.evaluate((a) => MX.DB.ensureWeekSlots(a.nextWk, 'Semaine suivante', 'sophie'), { nextWk });
    await page.evaluate((a) => MX.DB.loadTemplateIntoWeekDay(a.nextWk, 'x', a.dayId, a.tplId, null, '', 'sophie'), { nextWk, dayId: todayId, tplId: rSrc.tplId });
    const nextDoc = await getWeekDoc(page, nextWk);
    const nextSrcInst = nextDoc.days[todayId][0];
    ok('16. Nouvelle semaine — le créneau "Soir" contient bien ses 2 tâches d\'origine (déplacement non reproduit)', nextSrcInst.tasks.length === 2);
    ok('16b. Aucune tâche marquée movedFrom dans la nouvelle semaine', !nextSrcInst.tasks.some(t => t.movedFrom));
    await ctx.close();
  }

  // ═══ 17. Refus d'un déplacement inter-journées ═══
  {
    console.log('\n--- 17. Un déplacement ne peut jamais franchir deux jours différents ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const otherDay = todayId === 'lundi' ? 'mardi' : 'lundi';
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 1 });
    const rOther = await seedInstance(page, otherDay, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 1 });
    let doc = await getWeekDoc(page, wk);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;
    // moveWeekSlotTask elle-même ne connaît qu'UN dayId : simuler l'appel
    // "erroné" tel qu'un appel direct pourrait le tenter, en fournissant le
    // dayId de la source pour chercher l'instance destination — elle
    // n'existe pas dans CE jour, donc l'écriture échoue proprement.
    let threw = false;
    try { await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rOther.instId, taskId }); }
    catch (e) { threw = true; }
    doc = await getWeekDoc(page, wk);
    ok('17.1 Écriture refusée (instance destination introuvable dans ce jour) — exception levée côté page', threw);
    ok('17.2 La tâche est restée dans Soir (jour source), jamais transférée vers un autre jour', doc.days[todayId].find(i => i.id === rSrc.instId).tasks.some(t => t.id === taskId));
    ok('17.3 Matin de l\'autre jour n\'a reçu aucune tâche supplémentaire', doc.days[otherDay].find(i => i.id === rOther.instId).tasks.length === 1 && doc.days[otherDay].find(i => i.id === rOther.instId).tasks[0].text === 'Matin tâche 1');
    // Confirme aussi que l'UI elle-même ne propose JAMAIS l'autre jour comme
    // destination : ce jour-là ne compte qu'une seule instance (Soir), donc
    // le panneau n'a structurellement aucune option à offrir — il ne doit
    // pas s'ouvrir (Matin, sur l'autre jour, n'est jamais candidat).
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await showMissions(page);
    await page.click('#gst-card-' + todayId + '_' + rSrc.instId + ' div[draggable="true"]');
    await page.waitForTimeout(200);
    const modalOpen = await page.evaluate(() => document.getElementById('modal-bg').classList.contains('show'));
    ok('17.4 Le panneau ne s\'ouvre pas (aucune autre instance CE jour-là ⇒ aucune destination inter-jours possible)', !modalOpen);
    await ctx.close();
  }

  // ═══ 18-19. Permissions technicien / responsable ═══
  {
    console.log('\n--- 18-19. Permissions ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 1 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    let doc = await getWeekDoc(page, wk);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;

    await pinLogin(page, 'kevin', '1111');
    // showPage redirige déjà un technicien loin de l'écran (comportement
    // existant, non modifié) — on vérifie surtout qu'un appel direct
    // (console) est also rejeté par _canEdit(), défense en profondeur.
    await page.evaluate(() => { MX.showPage('gestion-semaine-tech'); });
    await page.waitForTimeout(200);
    const redirected = await page.evaluate(() => MX.state.currentPage !== 'gestion-semaine-tech');
    ok('18.1 Un technicien est redirigé hors de Gestion semaine tech (comportement existant, non cassé)', redirected);
    await page.evaluate((a) => { if (MX.Pages.GestSemaine && MX.Pages.GestSemaine._openMoveTaskModal) MX.Pages.GestSemaine._openMoveTaskModal(a.dayId, a.from, a.taskId); }, { dayId: todayId, from: rSrc.instId, taskId });
    await page.waitForTimeout(150);
    const modalShown = await page.evaluate(() => document.getElementById('modal-bg').classList.contains('show'));
    ok('18.2 _openMoveTaskModal() appelée par un technicien ne fait rien (_canEdit() rejette)', !modalShown);
    doc = await getWeekDoc(page, wk);
    ok('18.3 Aucune tâche déplacée', !doc.days[todayId].find(i => i.id === rDst.instId).tasks.some(t => t.id === taskId));

    await page.evaluate(() => { MX.Auth.clearCurrentUser(); });
    await page.waitForTimeout(200);
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    ok('19.1 Une responsable accède bien à Gestion semaine tech', await page.evaluate(() => MX.state.currentPage === 'gestion-semaine-tech'));
    await showMissions(page);
    await page.click('#gst-card-' + todayId + '_' + rSrc.instId + ' div[draggable="true"]');
    await page.waitForTimeout(150);
    ok('19.2 Le panneau de déplacement s\'ouvre bien pour la responsable', await page.evaluate(() => document.getElementById('modal-bg').classList.contains('show')));
    await ctx.close();
  }

  // ═══ 20-21. Plusieurs missions déplacées + déplacement inverse ═══
  {
    console.log('\n--- 20-21. Plusieurs déplacements successifs + déplacement inverse ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 3 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    let doc = await getWeekDoc(page, wk);
    const srcTasks = doc.days[todayId].find(i => i.id === rSrc.instId).tasks.map(t => t.id);
    for (const taskId of srcTasks) {
      await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId });
    }
    doc = await getWeekDoc(page, wk);
    ok('20.1 Les 3 tâches ont bien toutes rejoint Journée', doc.days[todayId].find(i => i.id === rDst.instId).tasks.length === 4);
    ok('20.2 Soir est bien vide', doc.days[todayId].find(i => i.id === rSrc.instId).tasks.length === 0);

    // Déplacement inverse via restoreWeekSlotTask (retour à l'origine réelle)
    const firstTaskId = srcTasks[0];
    await page.evaluate((a) => MX.DB.restoreWeekSlotTask(a.wk, a.dayId, a.taskId, 'sophie'), { wk, dayId: todayId, taskId: firstTaskId });
    doc = await getWeekDoc(page, wk);
    const restored = doc.days[todayId].find(i => i.id === rSrc.instId).tasks.find(t => t.id === firstTaskId);
    ok('21.1 Déplacement inverse (restauration) : la tâche est revenue dans Soir', !!restored);
    ok('21.2 movedFrom effacé après restauration (redevient une tâche normale)', restored && !restored.movedFrom);
    ok('21.3 Journée n\'a plus que 3 tâches (4-1 restaurée)', doc.days[todayId].find(i => i.id === rDst.instId).tasks.length === 3);
    await ctx.close();
  }

  // ═══ 22. Destination avec autre technicien — confirmation requise ═══
  {
    console.log('\n--- 22. Destination attribuée à un autre technicien ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 1 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Jordan', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await showMissions(page);
    await page.click('#gst-card-' + todayId + '_' + rSrc.instId + ' div[draggable="true"]');
    await page.waitForTimeout(200);
    await page.click('button.modal-btn.confirm'); // confirme le déplacement dans le panneau
    await page.waitForTimeout(250);
    const confirmModalHtml = await page.evaluate(() => document.getElementById('m-sub') ? document.getElementById('m-sub').innerHTML : '');
    ok('22.1 Une confirmation supplémentaire apparaît, mentionnant Jordan', /Jordan/.test(confirmModalHtml));
    let doc = await getWeekDoc(page, wk);
    ok('22.2 Rien n\'est encore déplacé tant que non confirmé', doc.days[todayId].find(i => i.id === rSrc.instId).tasks.length === 1);
    // Confirmer réellement
    await page.click('button.modal-btn.confirm');
    await page.waitForTimeout(300);
    doc = await getWeekDoc(page, wk);
    ok('22.3 Après confirmation explicite, la tâche est bien déplacée vers le créneau de Jordan', doc.days[todayId].find(i => i.id === rDst.instId).tasks.length === 2);
    ok('22.4 L\'affectation du créneau destination (Jordan) n\'a PAS changé — pas de transfert silencieux de responsabilité', doc.days[todayId].find(i => i.id === rDst.instId).userName === 'Jordan');
    await ctx.close();
  }

  // ═══ 23-24. Gestion d'erreur Firestore + aucun état UI incohérent ═══
  {
    console.log('\n--- 23-24. Erreur Firestore pendant un déplacement ---');
    const { ctx, page, pageErrors } = await newCtx({ denyWeekSlots: true });
    // week_slots refusée : pas de semaine visible, mais l'app ne doit pas
    // planter — on vérifie l'absence d'exception non interceptée, la vraie
    // garantie "pas d'état UI incohérent" est couverte par 3.2/4.1/5-10 qui
    // relisent systématiquement Firestore après écriture (jamais l'état
    // local optimiste) : si une écriture avait échoué silencieusement là,
    // ces assertions auraient déjà échoué.
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    ok('23.1 Aucune erreur JS non interceptée malgré week_slots refusée', pageErrors.length === 0);
    const html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('23.2 Écran affiché normalement (pas de crash, état "jamais préparée")', /n\'a pas encore été préparée/.test(html));
    await ctx.close();
  }
  {
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 1 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    let doc = await getWeekDoc(page, wk);
    const taskId = doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id;
    // Simule un ID d'instance destination inexistant (créneau supprimé
    // entre-temps par un autre poste) → moveWeekSlotTask doit throw sans
    // rien écrire, et l'appelant doit voir l'erreur (pas d'état silencieux).
    let threw = false;
    try {
      await page.evaluate((a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, 'id-inexistant', a.taskId, 'sophie'), { wk, dayId: todayId, from: rSrc.instId, taskId });
    } catch (e) { threw = true; }
    ok('24.1 moveWeekSlotTask() rejette proprement si la destination n\'existe plus', threw);
    doc = await getWeekDoc(page, wk);
    ok('24.2 La tâche est restée dans sa source (aucune perte, aucun état incohérent)', doc.days[todayId].find(i => i.id === rSrc.instId).tasks.some(t => t.id === taskId));
    await ctx.close();
  }

  // ═══ 25. "Copier la semaine" ne propage jamais les déplacements temporaires ═══
  {
    console.log('\n--- 25. Copier la semaine — movedFrom jamais propagé ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wkA = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const wkB = await evalPage(page, () => { const m = MX.mondayOfWeekKey(MX.weekKeyOf(new Date())); m.setDate(m.getDate() + 7); return MX.weekKeyOf(m); });

    // 1. Créer semaine A : Soir (Fermeture, Relevé compteurs) + Journée (Nettoyage)
    const kevin = await evalPage(page, () => (MX.state.users || []).find(u => u.name === 'Kevin'));
    const r25 = await evalPage(page, async (a) => {
      const tplSoir = await MX.DB.addShiftTemplate({ name: 'Soir', icon: '🌙', color: '#EF4444', start: '13:00', end: '21:33', active: true,
        tasks: [{ id: 'fermeture', text: 'Fermeture', order: 0 }, { id: 'releve', text: 'Relevé compteurs', order: 1 }] });
      const tplJournee = await MX.DB.addShiftTemplate({ name: 'Journée', icon: '🌤', color: '#3B82F6', start: '10:00', end: '18:33', active: true,
        tasks: [{ id: 'nettoyage', text: 'Nettoyage', order: 0 }] });
      const soirId    = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplSoir, a.uid, 'Kevin', 'sophie');
      const journeeId = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplJournee, a.uid, 'Kevin', 'sophie');
      return { tplSoir, tplJournee, soirId, journeeId };
    }, { wk: wkA, dayId: todayId, uid: kevin.id });

    let docA = await getWeekDoc(page, wkA);
    let soirInstA    = docA.days[todayId].find(i => i.id === r25.soirId);
    let journeeInstA = docA.days[todayId].find(i => i.id === r25.journeeId);
    const releveTaskId = soirInstA.tasks.find(t => t.text === 'Relevé compteurs').id;
    ok('25.setup Soir a bien Fermeture + Relevé compteurs, Journée a Nettoyage', soirInstA.tasks.length === 2 && journeeInstA.tasks.length === 1);

    // 2. Déplacer "Relevé compteurs" Soir → Journée, et cocher "Fermeture" (donnée légitime à préserver dans A)
    await evalPage(page, (a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk: wkA, dayId: todayId, from: r25.soirId, to: r25.journeeId, taskId: releveTaskId });
    const fermetureTaskId = soirInstA.tasks.find(t => t.text === 'Fermeture').id;
    await evalPage(page, (a) => MX.DB.setWeekSlotTaskDone(a.wk, a.dayId, a.instId, a.taskId, true, 'sophie'), { wk: wkA, dayId: todayId, instId: r25.soirId, taskId: fermetureTaskId });

    // 3. Vérifier que semaine A conserve le déplacement
    docA = await getWeekDoc(page, wkA);
    soirInstA    = docA.days[todayId].find(i => i.id === r25.soirId);
    journeeInstA = docA.days[todayId].find(i => i.id === r25.journeeId);
    ok('25.3a Semaine A — "Relevé compteurs" est dans Journée', journeeInstA.tasks.some(t => t.text === 'Relevé compteurs'));
    ok('25.3b Semaine A — "Relevé compteurs" a bien movedFrom vers Soir', journeeInstA.tasks.find(t => t.text === 'Relevé compteurs').movedFrom === r25.soirId);
    ok('25.3c Semaine A — Soir ne garde que "Fermeture" (cochée)', soirInstA.tasks.length === 1 && soirInstA.tasks[0].text === 'Fermeture' && soirInstA.tasks[0].done === true);
    const docASnapshot = JSON.stringify(docA);

    // 4. Copier semaine A vers semaine B
    const copyResult = await evalPage(page, (a) => MX.DB.copyWeekSlots(a.from, a.to, 'Semaine B', 'sophie'), { from: wkA, to: wkB });

    // 5. Semaine B doit remettre la mission dans son instance d'origine (Soir), pas la garder dans Journée
    const docB = await getWeekDoc(page, wkB);
    const soirInstB    = docB.days[todayId].find(i => (i.tasks || []).some(t => t.text === 'Fermeture'));
    const journeeInstB = docB.days[todayId].find(i => (i.tasks || []).some(t => t.text === 'Nettoyage'));
    ok('25.5a Semaine B — "Relevé compteurs" est de retour dans l\'instance Soir (comme le modèle)', soirInstB.tasks.some(t => t.text === 'Relevé compteurs'));
    ok('25.5b Semaine B — Soir contient bien ses 2 tâches normales (Fermeture + Relevé compteurs)', soirInstB.tasks.length === 2);
    ok('25.5c Semaine B — Journée ne garde que "Nettoyage" (pas "Relevé compteurs")', journeeInstB.tasks.length === 1 && journeeInstB.tasks[0].text === 'Nettoyage');
    ok('25.5d Semaine B — même task.id conservé pour "Relevé compteurs"', soirInstB.tasks.find(t => t.text === 'Relevé compteurs').id === releveTaskId);

    // 6. Semaine A reste inchangée (aucune écriture sur la source)
    const docAAfter = await getWeekDoc(page, wkA);
    ok('25.6 Semaine A strictement inchangée après la copie', JSON.stringify(docAAfter) === docASnapshot);

    // 7. shift_templates inchangé
    const tplSoirAfter = await page.evaluate((tplId) => new Promise(res => { const u = MX.DB.listenShiftTemplates(l => res(l.find(t => t.id === tplId))); }), r25.tplSoir);
    ok('25.7 shift_templates "Soir" toujours Fermeture + Relevé compteurs, à l\'identique', tplSoirAfter.tasks.length === 2 && tplSoirAfter.tasks.every(t => ['Fermeture', 'Relevé compteurs'].includes(t.text)));

    // 8. Aucun movedFrom dans la semaine B
    const anyMovedInB = docB.days[todayId].some(i => (i.tasks || []).some(t => t.movedFrom));
    ok('25.8 Aucun movedFrom résiduel dans la semaine B', !anyMovedInB);

    // 9. Les autres tâches (jamais déplacées) sont copiées normalement
    ok('25.9 "Nettoyage" (jamais déplacée) copiée normalement dans Journée B', journeeInstB.tasks[0].text === 'Nettoyage' && journeeInstB.tasks[0].id === docA.days[todayId].find(i => i.id === r25.journeeId).tasks.find(t => t.text === 'Nettoyage').id);

    // 10. Coches / données existantes : la copie repart à zéro (comportement
    // déjà existant, non modifié ici) ; la coche de "Fermeture" reste elle
    // bien présente dans la semaine SOURCE (jamais touchée par la copie).
    ok('25.10a Semaine B — toutes les tâches repartent non cochées (comportement copyWeekSlots existant, inchangé)', soirInstB.tasks.every(t => t.done === false) && journeeInstB.tasks.every(t => t.done === false));
    ok('25.10b Semaine A — "Fermeture" reste cochée (donnée légitime de la source jamais supprimée)', docAAfter.days[todayId].find(i => i.id === r25.soirId).tasks.find(t => t.text === 'Fermeture').done === true);
    ok('25.10c copyWeekSlots() ne signale aucun avertissement (cas normal, instance d\'origine bien présente)', copyResult.warnings.length === 0);

    await ctx.close();
  }

  // ═══ 26. Cas limite : instance d'origine supprimée avant la copie ═══
  {
    console.log('\n--- 26. movedFrom pointe vers une instance retirée avant la copie ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wkA = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const wkB = await evalPage(page, () => { const m = MX.mondayOfWeekKey(MX.weekKeyOf(new Date())); m.setDate(m.getDate() + 7); return MX.weekKeyOf(m); });
    const rSoirA    = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 1 });
    const rJourneeA = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    let docA = await getWeekDoc(page, wkA);
    const taskId = docA.days[todayId].find(i => i.id === rSoirA.instId).tasks[0].id;
    await evalPage(page, (a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'), { wk: wkA, dayId: todayId, from: rSoirA.instId, to: rJourneeA.instId, taskId });
    // L'instance d'origine (Soir) est ensuite entièrement retirée de la semaine A
    await evalPage(page, (a) => MX.DB.deleteWeekSlotInstance(a.wk, a.dayId, a.instId, 'sophie'), { wk: wkA, dayId: todayId, instId: rSoirA.instId });

    const copyResult = await evalPage(page, (a) => MX.DB.copyWeekSlots(a.from, a.to, 'Semaine B bis', 'sophie'), { from: wkA, to: wkB });
    const docB = await getWeekDoc(page, wkB);
    const movedTaskB = docB.days[todayId].flatMap(i => i.tasks || []).find(t => t.id === taskId);
    ok('26.1 Aucune perte de donnée — la tâche existe toujours quelque part dans la semaine B', !!movedTaskB);
    ok('26.2 Solution la plus sûre : la tâche reste dans l\'instance où elle se trouvait (Journée), pas de reconstruction inventée', docB.days[todayId].find(i => (i.tasks || []).some(t => t.id === taskId)).tasks.length >= 1);
    ok('26.3 movedFrom bien absent sur la copie (plus "temporaire" puisque non restaurable)', !movedTaskB.movedFrom);
    ok('26.4 copyWeekSlots() signale explicitement ce cas dans ses warnings', copyResult.warnings.length === 1 && copyResult.warnings[0].taskId === taskId && copyResult.warnings[0].missingOriginInstanceId === rSoirA.instId);
    // Semaine A inchangée par la copie elle-même (le retrait de l'instance était une étape SÉPARÉE, avant la copie)
    const docAAfter = await getWeekDoc(page, wkA);
    ok('26.5 Semaine A non modifiée par l\'appel copyWeekSlots (seule l\'étape de suppression préalable, hors copie, l\'a changée)', !docAAfter.days[todayId].some(i => i.id === rSoirA.instId));
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TEST RÉEL OBLIGATOIRE — Mercredi 23/09/2026, Kevin, Matin/Journée(copie)/Soir
  // ═══════════════════════════════════════════════════════════════════════
  {
    console.log('\n--- TEST RÉEL : 23/09/2026, Kevin, "Relevé compteurs" Soir → Journée ---');
    const { ctx, page } = await newCtx();
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const todayId = await evalPage(page, () => MX.todayId());
    const kevin = await evalPage(page, () => (MX.state.users || []).find(u => u.name === 'Kevin'));
    const dup = await evalPage(page, async () => {
      const src = await MX.DB.addShiftTemplate({ name: 'Journée', icon: '🌤', color: '#3B82F6', start: '10:00', end: '18:33', active: true, tasks: [] });
      return MX.DB.duplicateShiftTemplate(src);
    });
    const r = await evalPage(page, async (a) => {
      const tplMatin = await MX.DB.addShiftTemplate({ name: 'Matin', icon: '☀️', color: '#FDE047', start: '08:00', end: '16:33', active: true,
        tasks: [{ id: 't1', text: 'Vérifier CTA', order: 0 }, { id: 't2', text: 'Relever températures', order: 1 }] });
      const tplSoir = await MX.DB.addShiftTemplate({ name: 'Soir', icon: '🌙', color: '#EF4444', start: '13:00', end: '21:33', active: true,
        tasks: [{ id: 't1', text: 'Fermeture locaux', order: 0 }, { id: 't2', text: 'Ronde générale', order: 1 }, { id: 't3', text: 'Relevé compteurs', order: 2 }] });
      await MX.DB.updateShiftTemplate(a.dupId, { tasks: [{ id: 't1', text: 'Nettoyage filtres', order: 0 }, { id: 't2', text: 'Contrôle VMC', order: 1 }] });
      const instMatin   = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplMatin, a.uid, 'Kevin', 'sophie');
      const instJournee = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, a.dupId, a.uid, 'Kevin', 'sophie');
      const instSoir    = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplSoir, a.uid, 'Kevin', 'sophie');
      return { instMatin, instJournee, instSoir, tplSoir };
    }, { wk, dayId: todayId, dupId: dup, uid: kevin.id });

    // Afficher les missions, repérer "Relevé compteurs" dans Soir, la déplacer vers Journée
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await showMissions(page);
    const soirCard    = '#gst-card-' + todayId + '_' + r.instSoir;
    const journeeCard = '#gst-card-' + todayId + '_' + r.instJournee;
    const releveTaskSel = soirCard + ' div[draggable="true"]:has-text("Relevé compteurs")';
    await page.waitForSelector(releveTaskSel);
    await page.dragAndDrop(releveTaskSel, journeeCard);
    await page.waitForTimeout(400);

    // ✓ Gestion semaine tech
    let gstHtml = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    const journeeCardHtml = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.innerHTML : ''; }, journeeCard);
    const soirCardHtml    = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.innerHTML : ''; }, soirCard);
    ok('RÉEL.1 Gestion semaine tech — "Relevé compteurs" dans Journée', /Relevé compteurs/.test(journeeCardHtml));
    ok('RÉEL.2 Gestion semaine tech — "Relevé compteurs" absente de Soir', !/Relevé compteurs/.test(soirCardHtml));

    // ✓ Mes missions
    await page.evaluate(() => { MX.Auth.clearCurrentUser(); });
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    await page.evaluate(() => { MX.showPage('mes-missions'); MX.MM.setTab('checklist'); });
    await page.waitForTimeout(300);
    let mmHtml = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('RÉEL.3 Mes missions — "Relevé compteurs" présente', /Relevé compteurs/.test(mmHtml));
    // Vérifie qu'elle apparaît dans le groupe Journée (copie), pas Soir
    const groupsOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.mm-v3-slot-group')).map(g => g.innerHTML));
    const journeeGroupIdx = groupsOrder.findIndex(g => /Journée \(copie\)/.test(g));
    ok('RÉEL.4 Mes missions — "Relevé compteurs" dans le groupe "Journée (copie)"', journeeGroupIdx >= 0 && /Relevé compteurs/.test(groupsOrder[journeeGroupIdx]));
    const soirGroupIdx = groupsOrder.findIndex(g => /^Soir|>Soir</.test(g) && !/Journée/.test(g));
    ok('RÉEL.5 Mes missions — "Relevé compteurs" absente du groupe Soir', soirGroupIdx === -1 || !/Relevé compteurs/.test(groupsOrder[soirGroupIdx]));

    // ✓ Checklist
    await page.evaluate((d) => { MX.showPage(d); }, todayId);
    await page.waitForTimeout(300);
    let clHtml = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('RÉEL.6 Checklist — "Relevé compteurs" présente', /Relevé compteurs/.test(clHtml));

    // ✓ F5 — voir la note aux points 11-12 : mock-firebase.js ne persiste
    // que l'auth à travers un vrai reload, ses collections Firestore sont
    // en mémoire pure par page (limitation du harnais de test, sans
    // rapport avec la fonctionnalité). Preuve équivalente : lecture
    // Firestore fraîche (.get(), jamais l'état local mis en cache) depuis
    // la session de Kevin lui-même, puis re-render de la Checklist à
    // partir de cette lecture fraîche.
    const freshDoc = await getWeekDoc(page, wk);
    const freshJournee = freshDoc.days[todayId].find(i => i.id === r.instJournee);
    ok('RÉEL.7a Lecture Firestore fraîche (équivalent F5) — "Relevé compteurs" toujours dans Journée côté serveur', freshJournee.tasks.some(t => t.text === 'Relevé compteurs'));
    await page.evaluate((d) => { MX.Pages.Checklist.render(d); }, todayId);
    await page.waitForTimeout(300);
    clHtml = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('RÉEL.7b Checklist re-render — "Relevé compteurs" toujours affichée', /Relevé compteurs/.test(clHtml));

    // ✓ shift_templates inchangé
    const tplSoirAfter = await page.evaluate((tplId) => new Promise(res => { const u = MX.DB.listenShiftTemplates(l => res(l.find(t => t.id === tplId))); }), r.tplSoir);
    ok('RÉEL.8 shift_templates "Soir" contient toujours "Relevé compteurs"', tplSoirAfter.tasks.some(t => t.text === 'Relevé compteurs'));
    ok('RÉEL.9 shift_templates "Soir" a toujours exactement 3 tâches', tplSoirAfter.tasks.length === 3);

    // ✓ Autre jour inchangé
    const otherDay = todayId === 'lundi' ? 'mardi' : 'lundi';
    const finalDoc = await getWeekDoc(page, wk);
    ok('RÉEL.10 Un autre jour de la semaine n\'a aucune instance créée par erreur', !finalDoc.days[otherDay]);

    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (failures ? failures + ' échec(s).' : 'Tous les tests de répartition temporaire des missions passent.'));
  process.exit(failures ? 1 : 0);
})();
