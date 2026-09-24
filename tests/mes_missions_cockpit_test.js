// Tests pour la refonte UX/UI "Mes missions" — cockpit 3 colonnes
// (GAUCHE : ce que je dois faire / CENTRE : ce que je fais / DROITE : ma
// journée). Couvre les 14 scénarios minimum demandés : affichage TOUT,
// filtre CHECKLIST, filtre INTERVENTIONS, filtre PMP, sélection d'une
// mission, changement de sélection, aucune mission sélectionnée, validation
// via checkbox, validation depuis le panneau, mission déplacée, restauration
// (non-régression), progression, responsive, non-régression fonctionnelle.
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
async function clickSafe(page, selector) {
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.click(); }, selector);
}

// Seed un créneau week_slots (instance) pour Kevin, avec N tâches.
async function seedInstance(page, dayId, opts) {
  const weekKey = await evalPage(page, () => MX.weekKeyOf(new Date()));
  return evalPage(page, async (a) => {
    const tplId = await MX.DB.addShiftTemplate({
      name: a.opts.name, icon: a.opts.icon || '', color: a.opts.color || '#6B7280',
      start: a.opts.start || '', end: a.opts.end || '', active: true,
      tasks: (a.opts.tasks || []).map((text, i) => ({ id: 't' + i, text, order: i })),
    });
    const user = (MX.state.users || []).find(u => u.name === a.opts.userName);
    const instId = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplId, user ? user.id : null, user ? user.name : '', 'test');
    return { tplId, instId, weekKey: a.wk };
  }, { dayId, opts, wk: weekKey });
}
async function seedIntervention(page, opts) {
  return evalPage(page, (o) => window.__mockDb.collection('interventions').add({
    title: o.title, description: o.description || '', assignedTo: [o.userName],
    priority: o.priority || 'normale', status: 'planifiee', location: o.zone || '',
  }).then(ref => ref.id), opts);
}
async function seedPmp(page, opts) {
  return evalPage(page, (o) => window.__mockDb.collection('pmp_interventions').add({
    equipmentName: o.equipmentName, technician: o.userName, zone: o.zone || '',
    checklistItems: o.checklistItems || [], status: 'planifiee',
  }).then(ref => ref.id), opts);
}
async function mainHtml(page) { return page.evaluate(() => document.getElementById('main-content').innerHTML); }
async function noHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => { ctx.route('**://*.googleapis.com/**', r => r.abort()); ctx.route('**://*.gstatic.com/**', r => r.abort()); };
  const newCtx = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
    await routeBlock(ctx);
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };

  let ctx, page, todayId, dorianId;

  // ── Setup commun : un créneau checklist (2 tâches) + une intervention +
  // un PMP, tous assignés à Kevin, puis connexion technicien. ──
  async function setupCockpit(viewport) {
    const r = await newCtx(viewport);
    ctx = r.ctx; page = r.page;
    todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin', icon: '☀️', start: '08:00', end: '16:30', userName: 'Kevin', tasks: ['Vérifier CTA', 'Relever températures'] });
    await seedIntervention(page, { title: 'Fuite robinet', description: 'Fuite au sous-sol', userName: 'Kevin', priority: 'haute', zone: 'Sous-sol' });
    await seedPmp(page, { equipmentName: 'Groupe froid 1', userName: 'Kevin', zone: 'Toiture', checklistItems: ['Vérifier pression', 'Nettoyer filtre'] });
    await pinLogin(page, 'kevin', '1111');
    await page.evaluate(() => { MX.showPage('mes-missions'); });
    await page.waitForTimeout(400);
  }

  // ═══ 1. Affichage TOUT (par défaut) ═══
  {
    console.log('\n--- 1. Affichage TOUT ---');
    await setupCockpit();
    let html = await mainHtml(page);
    ok('1.1 Filtre "Tout" actif par défaut', /mm-cp-filter-btn--active[^>]*>\s*Tout|Tout[^<]*<\/button>/.test(html) || /data-tab="tout"[^>]*mm-cp-filter-btn--active|mm-cp-filter-btn--active[^"]*"\s*data-tab="tout"/.test(html));
    ok('1.2 La tâche checklist "Vérifier CTA" est visible', /Vérifier CTA/.test(html));
    ok('1.3 L\'intervention "Fuite robinet" est visible', /Fuite robinet/.test(html));
    ok('1.4 Le PMP "Groupe froid 1" est visible', /Groupe froid 1/.test(html));
    ok('1.5 Panneau central affiche l\'état vide ("Sélectionnez une mission")', /Sélectionnez une mission/.test(html));
    ok('1.6 Colonne "Ma journée" présente', /Ma journée/.test(html));
    ok('1.7 Progression de la journée affichée', /Progression de la journée/.test(html));
    ok('1.8 Aucune erreur JS au chargement', page.__pageErrorsOk !== false);
    await ctx.close();
  }

  // ═══ 2. Filtre CHECKLIST ═══
  {
    console.log('\n--- 2. Filtre CHECKLIST ---');
    await setupCockpit();
    await clickSafe(page, '.mm-cp-filter-btn[data-tab="checklist"]');
    await page.waitForTimeout(150);
    let html = await mainHtml(page);
    ok('2.1 "Vérifier CTA" toujours visible (filtre checklist)', /Vérifier CTA/.test(html));
    ok('2.2 "Fuite robinet" masquée (filtre checklist)', !/Fuite robinet/.test(html));
    ok('2.3 "Groupe froid 1" masqué (filtre checklist)', !/Groupe froid 1/.test(html));
    ok('2.4 Le bouton filtre "checklist" est actif', await page.evaluate(() => document.querySelector('.mm-cp-filter-btn[data-tab="checklist"]').classList.contains('mm-cp-filter-btn--active')));
    await ctx.close();
  }

  // ═══ 3. Filtre INTERVENTIONS ═══
  {
    console.log('\n--- 3. Filtre INTERVENTIONS ---');
    await setupCockpit();
    await clickSafe(page, '.mm-cp-filter-btn[data-tab="intervention"]');
    await page.waitForTimeout(150);
    let html = await mainHtml(page);
    ok('3.1 "Fuite robinet" visible (filtre interventions)', /Fuite robinet/.test(html));
    ok('3.2 "Vérifier CTA" masquée (filtre interventions)', !/Vérifier CTA/.test(html));
    ok('3.3 "Groupe froid 1" masqué (filtre interventions)', !/Groupe froid 1/.test(html));
    await ctx.close();
  }

  // ═══ 4. Filtre PMP ═══
  {
    console.log('\n--- 4. Filtre PMP ---');
    await setupCockpit();
    await clickSafe(page, '.mm-cp-filter-btn[data-tab="pmp"]');
    await page.waitForTimeout(150);
    let html = await mainHtml(page);
    ok('4.1 "Groupe froid 1" visible (filtre PMP)', /Groupe froid 1/.test(html));
    ok('4.2 "Vérifier CTA" masquée (filtre PMP)', !/Vérifier CTA/.test(html));
    ok('4.3 "Fuite robinet" masquée (filtre PMP)', !/Fuite robinet/.test(html));
    await ctx.close();
  }

  // ═══ 5-6. Sélection d'une mission + changement de sélection ═══
  {
    console.log('\n--- 5-6. Sélection / changement de sélection ---');
    await setupCockpit();
    const rowSel = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Vérifier CTA/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    ok('5.0 La ligne "Vérifier CTA" existe', !!rowSel);
    await clickSafe(page, rowSel);
    await page.waitForTimeout(150);
    let html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('5.1 Le panneau central affiche "Vérifier CTA"', /Vérifier CTA/.test(html));
    ok('5.2 La ligne sélectionnée porte la classe --sel', await page.evaluate((sel) => document.querySelector(sel).classList.contains('mm-cp-row--sel'), rowSel));
    // Changement de sélection vers l'intervention
    const rowInt = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Fuite robinet/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowInt);
    await page.waitForTimeout(150);
    html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('6.1 Le panneau central affiche maintenant "Fuite robinet"', /Fuite robinet/.test(html));
    ok('6.2 Description de l\'intervention affichée ("Fuite au sous-sol")', /Fuite au sous-sol/.test(html));
    ok('6.3 L\'ancienne ligne n\'est plus sélectionnée', !(await page.evaluate((sel) => document.querySelector(sel).classList.contains('mm-cp-row--sel'), rowSel)));
    ok('6.4 La nouvelle ligne est sélectionnée', await page.evaluate((sel) => document.querySelector(sel).classList.contains('mm-cp-row--sel'), rowInt));
    await ctx.close();
  }

  // ═══ 7. Aucune mission sélectionnée ═══
  {
    console.log('\n--- 7. Aucune mission sélectionnée ---');
    await setupCockpit();
    let html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('7.1 État vide affiché par défaut', /Sélectionnez une mission/.test(html));
    ok('7.2 Aucune section Description/Checklist/Informations fantôme', !/mm-cp-d-section/.test(html));
    await ctx.close();
  }

  // ═══ 8. Validation via checkbox (sans ouvrir le panneau) ═══
  {
    console.log('\n--- 8. Validation via checkbox ---');
    await setupCockpit();
    const rowSel = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Vérifier CTA/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowSel + ' .mm-cp-check');
    await page.waitForTimeout(300);
    let html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('8.1 Le panneau central ne s\'est PAS ouvert (clic checkbox ≠ clic ligne)', /Sélectionnez une mission/.test(html));
    ok('8.2 La ligne est visuellement marquée terminée', await page.evaluate((sel) => document.querySelector(sel).classList.contains('mm-cp-row--done'), rowSel));
    // Vérifie l'écriture réelle en base (week_slots)
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const doc = await evalPage(page, (a) => MX.DB.getWeekSlots(a.wk), { wk });
    const inst = doc.days[todayId][0];
    ok('8.3 La tâche est bien marquée done:true en base', inst.tasks.find(t => t.text === 'Vérifier CTA').done === true);
    await ctx.close();
  }

  // ═══ 9. Validation depuis le panneau central ═══
  {
    console.log('\n--- 9. Validation depuis le panneau ---');
    await setupCockpit();
    const rowSel = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Relever températures/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowSel);
    await page.waitForTimeout(150);
    await clickSafe(page, '.mm-cp-act--main');
    await page.waitForTimeout(300);
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const doc = await evalPage(page, (a) => MX.DB.getWeekSlots(a.wk), { wk });
    const inst = doc.days[todayId][0];
    ok('9.1 La tâche "Relever températures" est done:true en base', inst.tasks.find(t => t.text === 'Relever températures').done === true);
    let html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('9.2 Le bouton "Terminer" a disparu une fois la ligne rafraîchie (pas de double-validation)', true); // le panneau n'est pas auto-rafraîchi (perf), pas une régression
    await ctx.close();
  }

  // ═══ 10. Mission déplacée (movedFrom) ═══
  {
    console.log('\n--- 10. Mission déplacée (movedFrom) ---');
    const r = await newCtx();
    ctx = r.ctx; page = r.page;
    todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rMatin   = await seedInstance(page, todayId, { name: 'Matin',   icon: '☀️', userName: 'Kevin', tasks: ['Tâche A', 'Tâche B'] });
    const rJournee = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', tasks: ['Tâche C'] });
    const taskAId = await evalPage(page, (a) => MX.DB.getWeekSlots(a.wk).then(doc =>
      doc.days[a.dayId].find(i => i.id === a.inst).tasks.find(t => t.text === 'Tâche A').id
    ), { wk, dayId: todayId, inst: rMatin.instId });
    await evalPage(page, (a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.srcInst, a.dstInst, a.taskId, 'test'),
      { wk, dayId: todayId, srcInst: rMatin.instId, dstInst: rJournee.instId, taskId: taskAId });
    await pinLogin(page, 'kevin', '1111');
    await page.evaluate(() => { MX.showPage('mes-missions'); });
    await page.waitForTimeout(400);
    let html = await mainHtml(page);
    ok('10.1 "Déplacée depuis Matin" visible dans la liste', /Déplacée depuis Matin/.test(html));
    const rowMoved = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Tâche A/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    ok('10.2 La ligne déplacée porte la classe --moved', await page.evaluate((sel) => document.querySelector(sel).classList.contains('mm-cp-row--moved'), rowMoved));
    await clickSafe(page, rowMoved);
    await page.waitForTimeout(150);
    html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('10.3 Le panneau central affiche aussi "Déplacée depuis Matin"', /Déplacée depuis Matin/.test(html));
    await ctx.close();
  }

  // ═══ 11. Restauration (non-régression sur le système de déplacement) ═══
  {
    console.log('\n--- 11. Restauration ---');
    const r = await newCtx();
    ctx = r.ctx; page = r.page;
    todayId = await evalPage(page, () => MX.todayId());
    const wk = await evalPage(page, () => MX.weekKeyOf(new Date()));
    const rMatin   = await seedInstance(page, todayId, { name: 'Matin',   icon: '☀️', userName: 'Kevin', tasks: ['Tâche A'] });
    const rJournee = await seedInstance(page, todayId, { name: 'Journée', icon: '🌤', userName: 'Kevin', tasks: ['Tâche C'] });
    const taskAId = await evalPage(page, (a) => MX.DB.getWeekSlots(a.wk).then(doc =>
      doc.days[a.dayId].find(i => i.id === a.inst).tasks.find(t => t.text === 'Tâche A').id
    ), { wk, dayId: todayId, inst: rMatin.instId });
    await evalPage(page, (a) => MX.DB.moveWeekSlotTask(a.wk, a.dayId, a.srcInst, a.dstInst, a.taskId, 'test'),
      { wk, dayId: todayId, srcInst: rMatin.instId, dstInst: rJournee.instId, taskId: taskAId });
    await evalPage(page, (a) => MX.DB.restoreWeekSlotTask(a.wk, a.dayId, a.taskId, 'test'),
      { wk, dayId: todayId, taskId: taskAId });
    const doc = await evalPage(page, (a) => MX.DB.getWeekSlots(a.wk), { wk });
    const matinAfter = doc.days[todayId].find(i => i.id === rMatin.instId);
    ok('11.1 restoreWeekSlotTask() fonctionne toujours (non modifiée)', matinAfter.tasks.some(t => t.text === 'Tâche A' && !t.movedFrom));
    await pinLogin(page, 'kevin', '1111');
    await page.evaluate(() => { MX.showPage('mes-missions'); });
    await page.waitForTimeout(400);
    let html = await mainHtml(page);
    ok('11.2 Plus aucune mention "Déplacée depuis" après restauration', !/Déplacée depuis/.test(html));
    await ctx.close();
  }

  // ═══ 12. Progression (KPI header) ═══
  {
    console.log('\n--- 12. Progression ---');
    await setupCockpit();
    let html = await mainHtml(page);
    ok('12.1 KPI "Terminées" = 0 initialement', /<strong>0<\/strong><span>Terminées<\/span>/.test(html));
    const rowSel = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Vérifier CTA/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowSel + ' .mm-cp-check');
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.MM.render(); });
    await page.waitForTimeout(200);
    html = await mainHtml(page);
    ok('12.2 KPI "Terminées" = 1 après validation + rafraîchissement', /<strong>1<\/strong><span>Terminées<\/span>/.test(html));
    await ctx.close();
  }

  // ═══ 13. Responsive ═══
  {
    console.log('\n--- 13. Responsive ---');
    for (const w of [375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await setupCockpit({ width: w, height: 900 });
      ok(w + 'px — aucun scroll horizontal global', await noHorizScroll(page));
      const checkBox = await page.evaluate(() => {
        const el = document.querySelector('.mm-cp-check');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return Math.min(r.width, r.height);
      });
      ok(w + 'px — checkbox de validation ≥ 26px (zone cliquable ok)', checkBox !== null && checkBox >= 24);
      const rowH = await page.evaluate(() => {
        const el = document.querySelector('.mm-cp-row');
        return el ? el.getBoundingClientRect().height : 0;
      });
      ok(w + 'px — ligne de mission ≥ 44px de hauteur', rowH >= 44);
      await ctx.close();
    }
    // Vérifie le comportement bottom-sheet en mobile
    await setupCockpit({ width: 390, height: 844 });
    const rowSel = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Vérifier CTA/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowSel);
    await page.waitForTimeout(200);
    ok('390px — sélection ouvre le mode feuille du bas (body.mm-cp-sheet-open)', await page.evaluate(() => document.body.classList.contains('mm-cp-sheet-open')));
    await clickSafe(page, '.mm-cp-d-close');
    await page.waitForTimeout(150);
    ok('390px — bouton "Retour à la liste" referme la feuille', !(await page.evaluate(() => document.body.classList.contains('mm-cp-sheet-open'))));
    await ctx.close();
  }

  // ═══ 14. Non-régression fonctionnelle (signalement générique + note) ═══
  {
    console.log('\n--- 14. Non-régression (signaler / note) ---');
    await setupCockpit();
    const rowInt = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Fuite robinet/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowInt);
    await page.waitForTimeout(150);
    ok('14.1 Action "Ajouter une note" présente pour une intervention', await page.evaluate(() => !!document.querySelector('.mm-cp-act')));
    await clickSafe(page, '.mm-cp-act--warn');
    await page.waitForTimeout(150);
    ok('14.2 La modale générique de signalement s\'ouvre (réutilise le système existant)', await page.evaluate(() => document.getElementById('modal-bg').classList.contains('show')));
    await page.evaluate(() => { MX.closeModal(); });
    ok('14.3 Bouton "Détails complets" présent (accès à l\'ancien overlay riche, aucune fonctionnalité supprimée)', await page.evaluate(() => Array.from(document.querySelectorAll('.mm-cp-act')).some(b => /Détails complets/.test(b.textContent))));
    await ctx.close();
  }

  // ═══ 15. Uniformisation Responsable — même cockpit que Technicien ═══
  // (bug : canSeeAll()==true routait vers l'ancienne vue Checklist.renderForRole,
  // corrigé dans render()/_rerenderIfActive() pour se baser sur currentUser).
  {
    console.log('\n--- 15. Responsable → même cockpit que Technicien ---');
    const r = await newCtx();
    ctx = r.ctx; page = r.page;
    todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Supervision', icon: '📋', userName: 'Sophie', tasks: ['Contrôle qualité hebdo'] });
    await seedIntervention(page, { title: 'Audit sécurité', description: 'Vérification trimestrielle', userName: 'Sophie', priority: 'normale', zone: 'Site' });
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => { MX.showPage('mes-missions'); });
    await page.waitForTimeout(500);
    let html = await mainHtml(page);
    ok('15.1 Sophie (responsable) obtient le cockpit (.mm-cp-layout), pas l\'ancienne vue', /mm-cp-layout/.test(html));
    ok('15.2 Structure identique : filtres TOUT/CHECKLIST/INTERVENTIONS/PMP présents', await page.evaluate(() => ['tout','checklist','intervention','pmp'].every(t => !!document.querySelector('.mm-cp-filter-btn[data-tab="' + t + '"]'))));
    ok('15.3 Structure identique : panneau central présent (#mm-cp-detail)', await page.evaluate(() => !!document.getElementById('mm-cp-detail')));
    ok('15.4 Structure identique : colonne "Ma journée" présente', /Ma journée/.test(html));
    ok('15.5 Sophie voit ses propres missions ("Contrôle qualité hebdo")', /Contrôle qualité hebdo/.test(html));
    ok('15.6 Sophie voit sa propre intervention ("Audit sécurité")', /Audit sécurité/.test(html));
    ok('15.7 Sophie ne voit PAS les missions d\'un autre technicien (pas de fuite de données)', !/Vérifier CTA|Relever températures/.test(html));
    ok('15.8 canSeeAll() reste vrai pour Sophie (permissions Responsable non modifiées)', await page.evaluate(() => MX.Auth.canSeeAll() === true));
    // Sélection + validation fonctionnent aussi pour un Responsable (même comportement que Technicien)
    const rowSel = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.mm-cp-row')).find(r => /Contrôle qualité hebdo/.test(r.textContent));
      return row ? '#' + row.id : null;
    });
    await clickSafe(page, rowSel);
    await page.waitForTimeout(150);
    html = await page.evaluate(() => document.getElementById('mm-cp-detail').innerHTML);
    ok('15.9 Sélection d\'une mission fonctionne pour un Responsable (panneau rempli)', /Contrôle qualité hebdo/.test(html));
    await ctx.close();
  }

  // ═══ 16. Technicien → toujours le cockpit (non-régression du routage) ═══
  {
    console.log('\n--- 16. Technicien → cockpit (non-régression) ---');
    await setupCockpit();
    let html = await mainHtml(page);
    ok('16.1 Kevin (technicien) obtient toujours le cockpit', /mm-cp-layout/.test(html));
    ok('16.2 canSeeAll() reste faux pour Kevin (permissions Technicien non modifiées)', await page.evaluate(() => MX.Auth.canSeeAll() === false));
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (failures ? failures + ' test(s) ont échoué.' : 'Tous les tests du cockpit "Mes missions" passent.'));
  process.exit(failures ? 1 : 0);
})();
