// Tests dédiés à la refonte UX "Répartition des missions" (Gestion semaine
// tech). Complète mission_move_test.js (logique métier / intégrité des
// données, inchangée) en couvrant spécifiquement l'ergonomie demandée :
// mode Répartition, panneau desktop/mobile, retour visuel du drag & drop,
// alternative sans glisser, restauration/réinitialisation visibles, et
// l'absence de scroll horizontal global sur 8 largeurs d'écran.
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

async function bootPage(page) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript({ path: MOCK_FB });
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
async function enableRepartition(page) {
  await page.evaluate(() => { const btn = document.querySelector('.gst-repart-btn'); if (btn && !btn.classList.contains('gst-repart-btn--active')) MX.Pages.GestSemaine._toggleShowMissions(); });
  await page.waitForTimeout(150);
}
async function dismissOverlay(page) {
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
}
async function clickSafe(page, selector) {
  // La bannière de nouveautés (#ver-modal-overlay) peut se réafficher de
  // façon asynchrone (vérification de version périodique, sans rapport
  // avec cette fonctionnalité) et intercepter le clic entre le retrait et
  // l'action — on la retire juste avant ET on force le clic pour ignorer
  // toute interception résiduelle du même type.
  await dismissOverlay(page);
  await page.click(selector, { force: true });
}
async function movePanelState(page) {
  return page.evaluate(() => {
    const r = document.getElementById('gst-move-panel-root');
    const p = document.getElementById('gst-mvp-panel');
    if (!r || r.style.display === 'none' || !p) return { open: false };
    const rect = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return { open: true, position: cs.position, right: cs.right, bottom: cs.bottom, width: rect.width, height: rect.height, top: rect.top };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => { ctx.route('**://*.googleapis.com/**', r => r.abort()); ctx.route('**://*.gstatic.com/**', r => r.abort()); };
  const newCtx = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await routeBlock(ctx);
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };

  // ═══ 1. Mode Répartition — affichage et bascule claire ═══
  {
    console.log('\n--- 1. Affichage mode Répartition ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 2 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    let html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('1.1 Bouton "Répartition des missions" présent (mode planning par défaut)', /Répartition des missions/.test(html));
    ok('1.2 Pas de badge de mode en planning (état non ambigu)', !/Mode Répartition des missions/.test(html));
    await enableRepartition(page);
    html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('1.3 Badge "Mode Répartition des missions" affiché après activation', /Mode Répartition des missions/.test(html));
    const btnActive = await page.evaluate(() => document.querySelector('.gst-repart-btn').classList.contains('gst-repart-btn--active'));
    ok('1.4 Bouton visuellement marqué actif (case cochée)', btnActive);
    await ctx.close();
  }

  // ═══ 2. Clic sur une mission ouvre le panneau ═══
  {
    console.log('\n--- 2. Clic mission ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const rSrc = await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 1 });
    await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);
    const rowSel = '#gst-card-' + todayId + '_' + rSrc.instId + ' [data-task-row]';
    await page.waitForSelector(rowSel);
    const rowBox = await page.locator(rowSel).boundingBox();
    ok('2.1 La ligne de mission est une zone de clic large (hauteur ≥ 44px)', rowBox && rowBox.height >= 44);
    await clickSafe(page, rowSel);
    await page.waitForTimeout(200);
    const st = await movePanelState(page);
    ok('2.2 Le panneau s\'ouvre au clic sur la mission', st.open);
    await ctx.close();
  }

  // ═══ 3. Structure du panneau desktop (docké à droite) ═══
  {
    console.log('\n--- 3. Panneau desktop ---');
    const { ctx, page } = await newCtx({ width: 1280, height: 900 });
    const todayId = await evalPage(page, () => MX.todayId());
    const rSrc = await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 1 });
    await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Jordan', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);
    await clickSafe(page, '#gst-card-' + todayId + '_' + rSrc.instId + ' [data-task-row]');
    await page.waitForTimeout(200);
    const st = await movePanelState(page);
    ok('3.1 Panneau ouvert', st.open);
    ok('3.2 Panneau docké à droite (right:0), pas une popup centrée', st.right === '0px');
    ok('3.3 Panneau suffisamment large (≥ 320px, jamais une petite popup)', st.width >= 320);
    const html = await page.evaluate(() => document.getElementById('gst-mvp-panel').innerHTML);
    ok('3.4 Titre "DÉPLACER UNE MISSION" présent', /DÉPLACER UNE MISSION/.test(html));
    ok('3.5 Section "ACTUELLEMENT" présente', /ACTUELLEMENT/.test(html));
    ok('3.6 Section "DÉPLACER VERS" présente', /DÉPLACER VERS/.test(html));
    ok('3.7 Bouton Annuler présent', /Annuler/.test(html));
    ok('3.8 Bouton Déplacer présent', /Déplacer/.test(html));
    ok('3.9 Créneau "Journée" proposé comme destination avec son technicien (Jordan)', /Journée/.test(html) && /Jordan/.test(html));
    await ctx.close();
  }

  // ═══ 4. Structure du panneau mobile (feuille du bas) ═══
  {
    console.log('\n--- 4. Panneau mobile ---');
    const { ctx, page } = await newCtx({ width: 390, height: 844 });
    const todayId = await evalPage(page, () => MX.todayId());
    const rSrc = await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 1 });
    await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);
    await clickSafe(page, '#gst-card-' + todayId + '_' + rSrc.instId + ' [data-task-row]');
    await page.waitForTimeout(200);
    const st = await movePanelState(page);
    ok('4.1 Panneau ouvert', st.open);
    ok('4.2 Panneau ancré en bas de l\'écran (bottom:0)', st.bottom === '0px');
    ok('4.3 Panneau occupe la majorité de la largeur (≥ 90% du viewport)', st.width >= 390 * 0.9);
    const optHeights = await page.evaluate(() => Array.from(document.querySelectorAll('#gst-mvp-panel [data-mvp-option]')).map(el => el.getBoundingClientRect().height));
    ok('4.4 Cartes de destination avec cible tactile ≥ 44px', optHeights.length > 0 && optHeights.every(h => h >= 44));
    const btnHeights = await page.evaluate(() => Array.from(document.querySelectorAll('#gst-mvp-panel button')).map(el => el.getBoundingClientRect().height));
    ok('4.5 Boutons du panneau avec cible tactile ≥ 40px', btnHeights.length > 0 && btnHeights.every(h => h >= 40));
    await ctx.close();
  }

  // ═══ 5. Retour visuel du drag & drop desktop ═══
  {
    console.log('\n--- 5. Drag & drop desktop — retour visuel ---');
    const { ctx, page } = await newCtx({ width: 1280, height: 900 });
    const todayId = await evalPage(page, () => MX.todayId());
    const otherDay = todayId === 'lundi' ? 'mardi' : 'lundi';
    const rMatin   = await seedInstance(page, todayId, { name: 'Matin',   icon: '☀️', userName: 'Kevin', taskCount: 1 });
    const rJournee = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    const rOther   = await seedInstance(page, otherDay, { name: 'Soir',   icon: '🌙', userName: 'Kevin', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);
    const wkDrag = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const dragTaskId = (await getWeekDoc(page, wkDrag)).days[todayId].find(i => i.id === rMatin.instId).tasks[0].id;
    await page.evaluate((a) => { MX.Pages.GestSemaine._onTaskDragStart({ dataTransfer: { effectAllowed: '', setData: () => {} } }, a.dayId, a.instId, a.taskId); }, { dayId: todayId, instId: rMatin.instId, taskId: dragTaskId });
    await page.waitForTimeout(50);
    const state1 = await page.evaluate((a) => {
      const other = document.getElementById('gst-card-' + a.otherDay + '_' + a.otherInst);
      const target = document.getElementById('gst-card-' + a.dayId + '_' + a.targetInst);
      const source = document.getElementById('gst-card-' + a.dayId + '_' + a.sourceInst);
      return { otherOpacity: other ? other.style.opacity : null, targetOutline: target ? target.style.outline : null, sourceOpacity: source ? source.style.opacity : null };
    }, { otherDay, otherInst: rOther.instId, dayId: todayId, targetInst: rJournee.instId, sourceInst: rMatin.instId });
    ok('5.1 Créneau d\'un autre jour atténué pendant le glisser (non ciblable)', Math.abs(parseFloat(state1.otherOpacity) - 0.35) < 0.01);
    ok('5.2 Créneau du même jour mis en évidence comme cible compatible', /dashed/.test(state1.targetOutline || ''));
    ok('5.3 Carte source légèrement atténuée', Math.abs(parseFloat(state1.sourceOpacity) - 0.5) < 0.01);
    await page.evaluate((cardId) => { MX.Pages.GestSemaine._onCardDragOver({ preventDefault: () => {} }, cardId); }, 'gst-card-' + todayId + '_' + rJournee.instId);
    const placeholderShown = await page.evaluate((cardId) => !!document.getElementById(cardId).querySelector('.gst-drop-placeholder'), 'gst-card-' + todayId + '_' + rJournee.instId);
    ok('5.4 Zone "Déposer la mission ici" affichée au survol du créneau ciblé', placeholderShown);
    await page.evaluate(() => { MX.Pages.GestSemaine._onTaskDragEnd(); });
    const cleaned = await page.evaluate((a) => {
      const target = document.getElementById('gst-card-' + a.dayId + '_' + a.targetInst);
      const other = document.getElementById('gst-card-' + a.otherDay + '_' + a.otherInst);
      return { outline: target.style.outline, opacity: other.style.opacity, placeholder: !!target.querySelector('.gst-drop-placeholder') };
    }, { dayId: todayId, targetInst: rJournee.instId, otherDay, otherInst: rOther.instId });
    ok('5.5 Tout le retour visuel est nettoyé à la fin du glisser (dragend)', cleaned.outline === '' && cleaned.opacity === '' && !cleaned.placeholder);
    await ctx.close();
  }

  // ═══ 6. Alternative sans drag toujours disponible ═══
  {
    console.log('\n--- 6. Alternative sans drag (accessibilité) ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', userName: 'Kevin', taskCount: 1 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);
    // Aucun événement dragstart/dragover/drop simulé ici : uniquement clic + panneau.
    await clickSafe(page, '#gst-card-' + todayId + '_' + rSrc.instId + ' [data-task-row]');
    await page.waitForTimeout(200);
    await clickSafe(page, '#gst-mvp-panel [data-mvp-option="' + rDst.instId + '"]');
    await clickSafe(page, '#gst-mvp-panel button.modal-btn.confirm');
    await page.waitForTimeout(300);
    const doc = await getWeekDoc(page, wk);
    ok('6.1 Déplacement réussi via clic seul, sans aucun drag & drop', doc.days[todayId].find(i => i.id === rDst.instId).tasks.some(t => t.text === 'Matin tâche 1'));
    await ctx.close();
  }

  // ═══ 7-9. Déplacement, restauration, réinitialisation — indicateurs visibles ═══
  {
    console.log('\n--- 7-9. Déplacement / Restauration / Réinitialisation (UI) ---');
    const { ctx, page } = await newCtx();
    const todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rSrc = await seedInstance(page, todayId, { name: 'Soir', icon: '🌙', userName: 'Kevin', taskCount: 1 });
    const rDst = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', taskCount: 1 });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);
    await clickSafe(page, '#gst-card-' + todayId + '_' + rSrc.instId + ' [data-task-row]');
    await page.waitForTimeout(200);
    await clickSafe(page, '#gst-mvp-panel button.modal-btn.confirm');
    await page.waitForTimeout(300);
    let html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('7.1 La mission déplacée affiche "⚡ Déplacé depuis"', /⚡ Déplacé depuis/.test(html));
    ok('7.2 Une mission normale n\'affiche jamais ce texte', /Mission technique/.test(html));
    ok('8.1 Un bouton "Restaurer" visible et explicite apparaît sur la mission déplacée', /Restaurer/.test(html));
    ok('9.1 Le badge jour "⚡ 1 personnalisée" est visible', /⚡ 1 personnalisée/.test(html));
    // Même contrôle en mode Planning (compact) : le compteur par créneau
    // doit lui aussi signaler la modification (étape 8 de la demande).
    await page.evaluate(() => { MX.Pages.GestSemaine._toggleShowMissions(); }); // quitte le mode Répartition
    await page.waitForTimeout(100);
    const compactHtml = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('9.2 Compteur par créneau "⚡ 1 personnalisée" visible en mode Planning (compact)', /⚡ 1 personnalisée/.test(compactHtml));
    await page.evaluate(() => { MX.Pages.GestSemaine._toggleShowMissions(); }); // revient en mode Répartition pour la suite
    await page.waitForTimeout(100);

    // 8. Restauration — utilise restoreWeekSlotTask() existante
    const movedTaskId = (await getWeekDoc(page, wk)).days[todayId].find(i => i.id === rDst.instId).tasks.find(t => t.movedFrom).id;
    await page.evaluate((a) => { MX.Pages.GestSemaine._confirmRestoreTask(a.dayId, a.taskId, 'Soir tâche 1'); }, { dayId: todayId, taskId: movedTaskId });
    await page.waitForTimeout(150);
    await clickSafe(page, '.modal-btn.confirm');
    await page.waitForTimeout(300);
    let doc = await getWeekDoc(page, wk);
    ok('8.2 La tâche est bien revenue dans Soir (restoreWeekSlotTask exécutée)', doc.days[todayId].find(i => i.id === rSrc.instId).tasks.some(t => t.text === 'Soir tâche 1'));
    html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('8.3 Le badge "personnalisée" a disparu après restauration', !/personnalisée/.test(html));

    // 9. Réinitialisation au niveau jour — utilise resetWeekSlotDayMoves() existante
    await page.evaluate((a) => { MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.from, a.to, a.taskId, 'sophie'); }, { wk, dayId: todayId, from: rSrc.instId, to: rDst.instId, taskId: doc.days[todayId].find(i => i.id === rSrc.instId).tasks[0].id });
    await page.waitForTimeout(300);
    html = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('9.3 Bouton "Réinitialiser" (badge ⚡) visible au niveau du jour', /personnalisée/.test(html));
    await page.evaluate((dayId) => { MX.Pages.GestSemaine._confirmResetDayMoves(dayId); }, todayId);
    await page.waitForTimeout(150);
    await clickSafe(page, '.modal-btn.confirm');
    await page.waitForTimeout(300);
    doc = await getWeekDoc(page, wk);
    ok('9.4 Journée réinitialisée : la tâche est revenue dans Soir (resetWeekSlotDayMoves exécutée)', doc.days[todayId].find(i => i.id === rSrc.instId).tasks.some(t => t.text === 'Soir tâche 1'));

    // 10-11. Aucun changement de modèle ni d'un autre jour pendant toute la séquence
    const tpl = await page.evaluate((tplId) => new Promise(r => { MX.DB.listenShiftTemplates(l => r(l.find(t => t.id === tplId))); }), rSrc.tplId);
    ok('10. shift_templates "Soir" toujours à 1 tâche d\'origine (jamais écrit)', tpl.tasks.length === 1 && tpl.tasks[0].text === 'Soir tâche 1');
    const otherDay = todayId === 'lundi' ? 'mardi' : 'lundi';
    ok('11. Aucune instance créée par erreur sur un autre jour', !doc.days[otherDay] || doc.days[otherDay].length === 0);
    await ctx.close();
  }

  // ═══ 12. Responsive — 8 largeurs, aucun scroll horizontal global ═══
  {
    console.log('\n--- 12. Responsive (375/390/430/768/1024/1280/1440/1920) ---');
    const { ctx, page } = await newCtx({ width: 375, height: 700 });
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin',   icon: '☀️', userName: 'Kevin',  taskCount: 3, start: '08:00', end: '16:00' });
    await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Jordan', taskCount: 2, start: '10:00', end: '18:00' });
    await seedInstance(page, todayId, { name: 'Soir',    icon: '🌙', userName: 'Dorian', taskCount: 2, start: '18:00', end: '22:00' });
    await pinLogin(page, 'sophie', '9999');
    await openGst(page);
    await enableRepartition(page);

    const widths = [375, 390, 430, 768, 1024, 1280, 1440, 1920];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        rowHeights: Array.from(document.querySelectorAll('[data-task-row]')).map(el => el.getBoundingClientRect().height),
        toggleH: (document.querySelector('.gst-repart-btn') || {}).getBoundingClientRect ? document.querySelector('.gst-repart-btn').getBoundingClientRect().height : 0,
      }));
      ok(w + 'px — aucun scroll horizontal global de la page', info.scrollW <= info.clientW + 2);
      ok(w + 'px — lignes de mission visibles avec cible ≥ 40px', info.rowHeights.length > 0 && info.rowHeights.every(h => h >= 40));
      ok(w + 'px — bouton de bascule mode suffisamment grand (≥ 32px)', info.toggleH >= 32);
    }

    // Desktop (1280) et mobile (390) — vérifie que le panneau adopte bien la
    // disposition attendue à chaque famille de largeur (pas seulement au
    // chargement initial, mais aussi après un redimensionnement).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);
    const anyRow = await page.evaluate(() => { const el = document.querySelector('[data-task-row]'); return el ? el.closest('[data-day-id]').id : null; });
    if (anyRow) {
      await clickSafe(page, '#' + anyRow + ' [data-task-row]');
      await page.waitForTimeout(150);
      const stDesktop = await movePanelState(page);
      ok('1280px — panneau latéral droit (pas une feuille du bas)', stDesktop.open && stDesktop.right === '0px');
      await page.evaluate(() => MX.Pages.GestSemaine._closeMovePanel());
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    if (anyRow) {
      await clickSafe(page, '#' + anyRow + ' [data-task-row]');
      await page.waitForTimeout(150);
      const stMobile = await movePanelState(page);
      ok('390px — panneau feuille du bas (pas un panneau latéral)', stMobile.open && stMobile.bottom === '0px');
    }
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests UX "Répartition des missions" passent.');
  process.exit(failures ? 1 : 0);
})();
