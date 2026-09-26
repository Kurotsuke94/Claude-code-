// Tests — Interventions : planification OPTIONNELLE.
// Par défaut une intervention est créée SANS horaire ("immédiate", ouverte).
// La case "Planifier cette intervention" (décochée par défaut) révèle les
// champs Début/Fin (les MÊMES champs startDate/startTime/endDate/endTime
// qu'avant — aucun nouveau modèle de données). Les anciennes interventions
// (qui ont toujours startDate/startTime/endDate/endTime) restent lisibles
// et sont considérées "planifiées". Techniciens multiples (assignedTo[])
// déjà en place — non-régression uniquement sur ce point.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (90s) — le process est arrêté de force.');
  process.exit(1);
}, 90000);

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
async function noHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}
async function modalHtml(page) { return page.evaluate(() => document.getElementById('m-body').innerHTML); }
async function clickConfirm(page) {
  await page.evaluate(() => document.querySelector('#m-actions .modal-btn.confirm')?.click());
  await page.waitForTimeout(250);
}
async function openNewInt(page) {
  await evalPage(page, () => MX.Pages.Int._newInt());
  await page.waitForTimeout(150);
}
async function fillTitle(page, title) {
  await evalPage(page, (t) => { document.getElementById('int-f-title').value = t; }, title);
}
async function checkSched(page, checked) {
  await evalPage(page, (c) => {
    const cb = document.getElementById('int-f-sched');
    cb.checked = c;
    MX.Pages.Int._toggleSched(cb);
  }, checked);
  await page.waitForTimeout(80);
}
async function toggleTechByName(page, name) {
  await evalPage(page, (n) => {
    const btn = document.querySelector('.int-tech-pick-item[data-tech="' + n + '"]');
    if (btn) MX.Pages.Int._toggleTech(btn);
  }, name);
}
async function lastIntervention(page) {
  return evalPage(page, async () => {
    const snap = await window.__mockDb.collection('interventions').orderBy('createdAt', 'desc').limit(1).get();
    return snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
  });
}
async function seedIntervention(page, data) {
  return evalPage(page, async (d) => {
    const ref = await window.__mockDb.collection('interventions').add(d);
    return ref.id;
  }, data);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ── 1/2. Formulaire par défaut : case décochée, aucun champ horaire visible ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    const state = await evalPage(page, () => {
      const cb = document.getElementById('int-f-sched');
      const fields = document.getElementById('int-sched-fields');
      return {
        cbExists: !!cb, checked: cb ? cb.checked : null,
        fieldsHidden: fields ? getComputedStyle(fields).display === 'none' : null,
      };
    });
    ok('1.1 Case "Planifier" présente', state.cbExists);
    ok('1.2 Case décochée par défaut', state.checked === false);
    ok('2.1 Champs horaires masqués par défaut', state.fieldsHidden === true);
    ok('2.2 Aucune erreur JS au chargement', errs.length === 0);
    await ctx.close();
  }

  // ── 3. Création d'une intervention non planifiée ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await fillTitle(page, 'Fuite robinet urgente');
    await clickConfirm(page);
    const iv = await lastIntervention(page);
    ok('3.1 Intervention créée', !!iv && iv.title === 'Fuite robinet urgente');
    ok('3.2 Aucun champ startDate', !('startDate' in iv));
    ok('3.3 Aucun champ startTime/endDate/endTime', !('startTime' in iv) && !('endDate' in iv) && !('endTime' in iv));
    await ctx.close();
  }

  // ── 4/5/6. Techniciens : un, plusieurs, aucun ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');

    // 4. Un seul technicien
    await openNewInt(page);
    await fillTitle(page, 'Intervention un tech');
    await toggleTechByName(page, 'Kevin');
    await clickConfirm(page);
    let iv = await lastIntervention(page);
    ok('4.1 Un technicien affecté', Array.isArray(iv.assignedTo) && iv.assignedTo.length === 1 && iv.assignedTo[0] === 'Kevin');
    ok('4.2 Statut "affectee"', iv.status === 'affectee');

    // 5. Plusieurs techniciens
    await openNewInt(page);
    await fillTitle(page, 'Intervention plusieurs techs');
    await toggleTechByName(page, 'Kevin');
    await toggleTechByName(page, 'Jordan');
    await toggleTechByName(page, 'Dorian');
    await clickConfirm(page);
    iv = await lastIntervention(page);
    ok('5.1 Trois techniciens affectés', Array.isArray(iv.assignedTo) && iv.assignedTo.length === 3);
    ok('5.2 Les bons techniciens', ['Kevin','Jordan','Dorian'].every(n => iv.assignedTo.includes(n)));

    // 6. Aucun technicien
    await openNewInt(page);
    await fillTitle(page, 'Intervention sans tech');
    await clickConfirm(page);
    iv = await lastIntervention(page);
    ok('6.1 Aucun technicien affecté', Array.isArray(iv.assignedTo) && iv.assignedTo.length === 0);
    ok('6.2 Statut "planifiee" (non affectée)', iv.status === 'planifiee');

    // "Non affectée" visible dans la liste
    await evalPage(page, () => MX.showPage('interventions'));
    await page.waitForTimeout(200);
    const html = await evalPage(page, () => document.getElementById('main-content').innerHTML);
    ok('6.3 "Non affectée" affichée dans la liste', html.includes('Non affectée'));
    await ctx.close();
  }

  // ── 7/8. Activation de "Planifier" → apparition des champs ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await checkSched(page, true);
    const visible = await evalPage(page, () => {
      const fields = document.getElementById('int-sched-fields');
      return fields ? getComputedStyle(fields).display !== 'none' : false;
    });
    ok('7.1 Case cochable', true);
    ok('8.1 Les champs Début/Fin apparaissent', visible);
    const hasInputs = await evalPage(page, () => !!(document.getElementById('int-f-sd') && document.getElementById('int-f-st') && document.getElementById('int-f-ed') && document.getElementById('int-f-et')));
    ok('8.2 Les 4 champs date/heure présents dans le DOM', hasInputs);
    await ctx.close();
  }

  // ── 9/10. Création d'une intervention planifiée — dates/heures enregistrées ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await fillTitle(page, 'Intervention planifiée demain');
    await checkSched(page, true);
    await evalPage(page, () => {
      document.getElementById('int-f-sd').value = '2026-09-26';
      document.getElementById('int-f-st').value = '09:00';
      document.getElementById('int-f-ed').value = '2026-09-26';
      document.getElementById('int-f-et').value = '10:00';
    });
    await clickConfirm(page);
    const iv = await lastIntervention(page);
    ok('9.1 Intervention planifiée créée', !!iv);
    ok('9.2 status "planifiee" (pas de technicien)', iv.status === 'planifiee');
    ok('10.1 startDate correctement enregistrée', iv.startDate === '2026-09-26');
    ok('10.2 startTime correctement enregistrée', iv.startTime === '09:00');
    ok('10.3 endDate correctement enregistrée', iv.endDate === '2026-09-26');
    ok('10.4 endTime correctement enregistrée', iv.endTime === '10:00');
    await ctx.close();
  }

  // ── 11. Désactivation de "Planifier" masque les champs ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await checkSched(page, true);
    await checkSched(page, false);
    const hidden = await evalPage(page, () => {
      const fields = document.getElementById('int-sched-fields');
      return fields ? getComputedStyle(fields).display === 'none' : false;
    });
    ok('11.1 Champs masqués après décochage', hidden);
    // Et la soumission dans cet état ne doit envoyer aucun champ horaire
    await fillTitle(page, 'Re-décochée avant envoi');
    await clickConfirm(page);
    const iv = await lastIntervention(page);
    ok('11.2 Aucun horaire envoyé après décochage', !('startDate' in iv));
    await ctx.close();
  }

  // ── 12/13. Anciennes interventions (planifiées et non planifiées) lisibles ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');

    const legacyPlannedId = await seedIntervention(page, {
      title: 'Ancienne intervention planifiée', priority: 'normale', status: 'planifiee',
      startDate: '2026-09-20', startTime: '08:00', endDate: '2026-09-20', endTime: '09:30',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    const legacyUnplannedId = await seedIntervention(page, {
      title: 'Ancienne intervention sans horaire', priority: 'normale', status: 'planifiee',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => MX.showPage('interventions'));
    await page.waitForTimeout(300);

    await evalPage(page, (id) => MX.Pages.Int._viewInt(id), legacyPlannedId);
    await page.waitForTimeout(150);
    let mh = await modalHtml(page);
    ok('12.1 Ancienne intervention planifiée : "Début" affiché', mh.includes('20/09/2026'));
    ok('12.2 Ancienne intervention planifiée : heure de fin affichée', mh.includes('09:30'));
    await evalPage(page, () => MX.closeModal());

    await evalPage(page, (id) => MX.Pages.Int._viewInt(id), legacyUnplannedId);
    await page.waitForTimeout(150);
    mh = await modalHtml(page);
    ok('13.1 Intervention sans horaire : mention "non planifiée"', /non planifiée/i.test(mh));
    ok('13.2 Intervention sans horaire : pas de date fantôme', !mh.includes('undefined'));
    await evalPage(page, () => MX.closeModal());
    await ctx.close();
  }

  // ── 14. Modification d'une intervention existante ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');

    // Planifiée -> devient non planifiée
    const id1 = await seedIntervention(page, {
      title: 'À déplanifier', priority: 'normale', status: 'planifiee',
      startDate: '2026-09-27', startTime: '14:00', endDate: '2026-09-27', endTime: '15:00',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => MX.showPage('interventions'));
    await page.waitForTimeout(200);
    await evalPage(page, (id) => MX.Pages.Int._editInt(id), id1);
    await page.waitForTimeout(150);
    const precheckedOnEdit = await evalPage(page, () => document.getElementById('int-f-sched')?.checked);
    ok('14.1 Case pré-cochée à l\'édition d\'une intervention planifiée', precheckedOnEdit === true);
    await checkSched(page, false);
    await clickConfirm(page);
    let iv = await evalPage(page, async (id) => { const d = await window.__mockDb.collection('interventions').doc(id).get(); return d.data(); }, id1);
    ok('14.2 startDate supprimée après déplanification', !('startDate' in iv));

    // Non planifiée -> devient planifiée + changement de titre
    const id2 = await seedIntervention(page, {
      title: 'À planifier', priority: 'normale', status: 'planifiee',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => MX.showPage('interventions'));
    await page.waitForTimeout(200);
    await evalPage(page, (id) => MX.Pages.Int._editInt(id), id2);
    await page.waitForTimeout(150);
    const uncheckedOnEdit = await evalPage(page, () => document.getElementById('int-f-sched')?.checked);
    ok('14.3 Case décochée à l\'édition d\'une intervention non planifiée', uncheckedOnEdit === false);
    await checkSched(page, true);
    await evalPage(page, () => {
      document.getElementById('int-f-title').value = 'Titre modifié';
      document.getElementById('int-f-sd').value = '2026-09-28';
      document.getElementById('int-f-st').value = '11:00';
    });
    await clickConfirm(page);
    iv = await evalPage(page, async (id) => { const d = await window.__mockDb.collection('interventions').doc(id).get(); return d.data(); }, id2);
    ok('14.4 Titre modifié', iv.title === 'Titre modifié');
    ok('14.5 startDate ajoutée après planification', iv.startDate === '2026-09-28');
    ok('14.6 startTime ajoutée après planification', iv.startTime === '11:00');
    await ctx.close();
  }

  // ── 15. Photo toujours fonctionnelle ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    const mh = await modalHtml(page);
    ok('15.1 Bloc photo présent (mode non planifié)', mh.includes('Prendre / choisir une photo'));
    await checkSched(page, true);
    const mh2 = await modalHtml(page);
    ok('15.2 Bloc photo toujours présent (mode planifié)', mh2.includes('Prendre / choisir une photo'));
    await ctx.close();
  }

  // ── 16. Statut toujours fonctionnel ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const id = await seedIntervention(page, {
      title: 'Statut test', priority: 'normale', status: 'affectee',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => MX.showPage('interventions'));
    await page.waitForTimeout(200);
    await evalPage(page, (id) => MX.Pages.Int._editInt(id), id);
    await page.waitForTimeout(150);
    await evalPage(page, () => { document.getElementById('int-f-status').value = 'en_cours'; });
    await clickConfirm(page);
    const iv = await evalPage(page, async (id) => { const d = await window.__mockDb.collection('interventions').doc(id).get(); return d.data(); }, id);
    ok('16.1 Changement de statut toujours fonctionnel', iv.status === 'en_cours');
    await ctx.close();
  }

  // ── 17. Aucune régression Planning (Centre de Pilotage / org-resp.js) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, {
      title: 'Immédiate — jamais dans le planning hebdo', priority: 'normale', status: 'planifiee',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => { if (MX.showPage) MX.showPage('org-resp'); });
    await page.waitForTimeout(500);
    ok('17.1 Aucune erreur JS sur le Planning (Centre de Pilotage)', errs.length === 0);
    await ctx.close();
  }

  // ── 18. Aucune régression Missions (Mes missions) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    await seedIntervention(page, {
      title: 'Intervention immédiate Kevin', priority: 'normale', status: 'affectee',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(500);
    ok('18.1 Aucune erreur JS sur Mes missions', errs.length === 0);
    const html = await evalPage(page, () => document.getElementById('main-content').innerHTML);
    ok('18.2 Intervention immédiate visible aujourd\'hui dans Mes missions', html.includes('Intervention immédiate Kevin'));
    await ctx.close();
  }

  // ── Responsive : la case et les champs restent utilisables (375/1440) ──
  for (const w of [375, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await checkSched(page, true);
    const noScroll = await noHorizScroll(page);
    ok(w + 'px — pas de débordement horizontal avec les champs ouverts', noScroll);
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' test(s) EN ÉCHEC.' : '\nTOUS LES TESTS PASSENT ✓');
  process.exit(failures ? 1 : 0);
})();
