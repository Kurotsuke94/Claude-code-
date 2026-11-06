// Tests — Missions : vue « Supervision équipe » (responsables, lecture seule).
// Couvre assets/js/pages/mes-missions.js (_renderPage/_renderSupervision).
//
// Portée : Playwright + mock Firestore en mémoire (tests/mock-firebase.js).
// Aucune connexion au vrai Firebase (gstatic/googleapis bloqués + contrôle
// explicite que le mock est actif). Les données week_slots sont créées par
// les VRAIES fonctions de l'app (addShiftTemplate + loadTemplateIntoWeekDay),
// les coches par la VRAIE fonction de validation (setWeekSlotTaskDone /
// MX.MM.toggle), jamais par une donnée raccourcie.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

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
    console.error('\nERREUR ENVIRONNEMENT : mock-firebase inactif — test interrompu.');
    process.exit(1);
  }
}

setTimeout(() => { console.error('\nTIMEOUT GLOBAL (180s) — le process est arrêté de force.'); process.exit(1); }, 180000);

// Profils du test : Kevin et Alban RESPONSABLES (rôle réel attendu en
// production, jamais déduit par l'app), Jordan/Dorian/Bryan techniciens.
const SEED_USERS = `
  window.__seedSup = async function () {
    var db = window.__mockDb;
    var P = [
      { id: 'kevin',  name: 'Kevin',  role: 'responsable', rank: 'responsable', pin: '1111' },
      { id: 'alban',  name: 'Alban',  role: 'responsable', rank: 'responsable', pin: '8888' },
      { id: 'jordan', name: 'Jordan', role: 'technicien',  rank: 'utilisateur', pin: '2222' },
      { id: 'dorian', name: 'Dorian', role: 'technicien',  rank: 'utilisateur', pin: '3333' },
      { id: 'bryan',  name: 'Bryan',  role: 'technicien',  rank: 'utilisateur', pin: '4444' },
    ];
    for (var i = 0; i < P.length; i++) await db.collection('users').doc(P[i].id).set({ name: P[i].name, role: P[i].role, rank: P[i].rank, pin: P[i].pin, color: null });
  };`;

async function bootPage(page) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ content: SEED_USERS });
  // La fenêtre « nouvelle version » (MX.Updates) peut apparaître en cours de
  // test et intercepter les clics réels : masquée ici uniquement (hors sujet).
  await page.addInitScript({ content: "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='#ver-modal-overlay{display:none!important}';document.head.appendChild(s);});" });
  await blockRealFirebase(page);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await assertMockFirebase(page);
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { await window.__seedSup(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
  return pageErrors;
}
async function pinLogin(page, userId, pin) {
  await page.evaluate((u) => { MX.Auth.selectUser(u); }, userId);
  await page.waitForTimeout(150);
  await page.evaluate((p) => { document.getElementById('pin-input').value = p; }, pin);
  await page.evaluate(async () => { await MX.Auth.confirmPin(); });
  await page.waitForTimeout(300);
}
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);

// Jours utilisés : aujourd'hui, un jour de week-end (≠ aujourd'hui), un jour
// « ancien système » (legacy, sans week_slots) et un jour « ancienne forme »
// (instance week_slots minimale, sans horaires/couleur/icône).
async function pickDays(page) {
  return ev(page, () => {
    const today = MX.todayId();
    const we = today === 'samedi' ? 'dimanche' : 'samedi';
    const weekdays = MX.DAYS.filter(d => !d.we && d.id !== today).map(d => d.id);
    return { today, we, legacy: weekdays[0], oldShape: weekdays[1], wk: MX.weekKeyOf(new Date()) };
  });
}
async function seedInstance(page, dayId, opts) {
  return ev(page, async (a) => {
    const tplId = await MX.DB.addShiftTemplate({
      name: a.o.name, icon: a.o.icon || '', color: a.o.color || '#6B7280',
      start: a.o.start || '', end: a.o.end || '', active: true,
      tasks: a.o.tasks.map((text, i) => ({ id: 't' + i, text, order: i })),
    });
    const user = a.o.userName ? MX.state.users.find(u => u.name === a.o.userName) : null;
    const instId = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplId, user ? user.id : null, user ? user.name : '', 'test');
    const doc = window.__mockDb._debugStore.week_slots[a.wk];
    const inst = doc.days[a.dayId].find(i => i.id === instId);
    return { instId, taskIds: inst.tasks.map(t => t.id) };
  }, { dayId, o: opts, wk: await ev(page, () => MX.weekKeyOf(new Date())) });
}
async function seedAll(page) {
  const D = await pickDays(page);
  const jMatin = await seedInstance(page, D.today, { name: 'Matin', icon: '☀️', color: '#FDE047', start: '08:00', end: '16:30', userName: 'Jordan', tasks: ['Ronde chaufferie', 'Relevé compteurs', 'Contrôle piscine'] });
  const dJour  = await seedInstance(page, D.today, { name: 'Journée', icon: '🌤', color: '#3B82F6', start: '10:00', end: '18:30', userName: 'Dorian', tasks: ['Chambre 204 robinet', 'Ampoules couloir'] });
  await seedInstance(page, D.today, { name: 'Soir', icon: '🌙', color: '#EF4444', start: '13:00', end: '21:30', userName: null, tasks: ['Fermeture locaux', 'Rapport du soir'] });
  const bWe    = await seedInstance(page, D.we, { name: 'Soir WE', icon: '🌙', color: '#EF4444', start: '13:00', end: '21:30', userName: 'Bryan', tasks: ['Ronde week-end'] });
  // Jour « ancien système » : tâches legacy (collection tasks) + affectation config/assignments.
  await ev(page, async (d) => {
    await window.__mockDb.collection('tasks').doc(d + '_matin').set({ items: [{ id: 'L1', text: 'Legacy filtre CTA' }, { id: 'L2', text: 'Legacy purge radiateurs' }] });
    // Créneau legacy personnalisé SANS titulaire (≠ textes par défaut MX.DEFT).
    await window.__mockDb.collection('tasks').doc(d + '_journee').set({ items: [{ id: 'L3', text: 'Legacy vidange ballon' }] });
    await window.__mockDb.collection('config').doc('assignments').set({ [d + '_matin']: 'Dorian' }, { merge: true });
  }, D.legacy);
  // Jour « ancienne forme » : instance week_slots minimale écrite telle quelle.
  await ev(page, async (a) => {
    const ref = window.__mockDb.collection('week_slots').doc(a.wk);
    const snap = await ref.get();
    const days = Object.assign({}, snap.data().days);
    days[a.day] = [{ id: 'old1', name: 'Ancien créneau', userName: 'Jordan', tasks: [{ id: 'o1', text: 'Ancienne tâche' }] }];
    await ref.set({ days }, { merge: true });
  }, { wk: D.wk, day: D.oldShape });
  await page.waitForTimeout(400);
  return { D, jMatin, dJour, bWe };
}
const techCard = (page, name) => ev(page, (n) => {
  const el = document.querySelector('.mm-sv-tech[data-tech="' + n + '"]');
  if (!el) return null;
  return { cls: el.className, meta: el.querySelector('.mm-sv-tech-meta').textContent, pct: el.querySelector('.mm-sv-tech-pct').textContent, chips: el.querySelectorAll('.mm-sv-chip').length };
}, name);
const kpis = (page) => ev(page, () => Array.from(document.querySelectorAll('.mm-sv-kpi strong')).map(s => +s.textContent));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ═══ 1. Technicien : affichage inchangé, aucune supervision ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'jordan', '2222');
    const S = await seedAll(page);
    await ev(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(500);
    const r = await ev(page, () => {
      const m = document.getElementById('main-content');
      return { cockpit: !!m.querySelector('.mm-v3-wrap'), sw: !!m.querySelector('.mm-sv-switch'), sv: !!m.querySelector('.mm-sv-wrap'), txt: m.textContent };
    });
    ok('1.1 Technicien : cockpit « Mes missions » affiché', r.cockpit);
    ok('1.2 Technicien : AUCUN sélecteur Mes missions / Supervision', !r.sw);
    ok('1.3 Technicien : aucune vue supervision', !r.sv);
    ok('1.4 Technicien : voit sa propre checklist (Ronde chaufferie)', r.txt.includes('Ronde chaufferie'));
    ok('1.5 Technicien : ne voit PAS la checklist de Dorian', !r.txt.includes('Chambre 204 robinet'));
    // Tentative manuelle d'ouvrir la supervision (console) → refusée.
    await ev(page, () => MX.MM.setView('team'));
    await page.waitForTimeout(200);
    const forced = await ev(page, () => ({ sv: !!document.querySelector('.mm-sv-wrap'), cockpit: !!document.querySelector('.mm-v3-wrap') }));
    ok('1.6 Technicien : setView("team") forcé → reste sur sa vue personnelle', !forced.sv && forced.cockpit);
    // Le technicien coche toujours comme avant (MX.MM.toggle → week_slots).
    await ev(page, (a) => MX.MM.toggle(a.day, a.inst, a.task), { day: S.D.today, inst: S.jMatin.instId, task: S.jMatin.taskIds[0] });
    await page.waitForTimeout(400);
    const done = await ev(page, (a) => window.__mockDb._debugStore.week_slots[a.wk].days[a.day].find(i => i.id === a.inst).tasks[0].done, { wk: S.D.wk, day: S.D.today, inst: S.jMatin.instId });
    ok('1.7 Technicien : la coche fonctionne comme avant (week_slots mis à jour)', done === true);
    ok('1.8 Aucune erreur JS (technicien)', errs.length === 0);
    if (errs.length) console.error(errs);
    await ctx.close();
  }

  // ═══ 2. Responsable Kevin (ordinateur) : accès, contenu, synchro, lecture seule ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    const S = await seedAll(page);
    await ev(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(500);
    const r0 = await ev(page, () => ({ sw: !!document.querySelector('.mm-sv-switch'), cockpit: !!document.querySelector('.mm-v3-wrap'), sv: !!document.querySelector('.mm-sv-wrap') }));
    ok('2.1 Kevin (responsable) : sélecteur affiché', r0.sw);
    ok('2.2 Kevin : vue par défaut = Mes missions (cockpit inchangé)', r0.cockpit && !r0.sv);
    await page.click('.mm-sv-switch-btn:nth-child(2)');
    await page.waitForTimeout(250);
    const r1 = await ev(page, () => ({
      sv: !!document.querySelector('.mm-sv-wrap'), cockpit: !!document.querySelector('.mm-v3-wrap'),
      techs: Array.from(document.querySelectorAll('.mm-sv-tech')).map(e => e.dataset.tech),
      unas: document.querySelectorAll('.mm-sv-unas-row').length,
      ro: !!document.querySelector('.mm-sv-ro'),
      activeDay: (document.querySelector('.mm-sv-day.is-active') || {}).dataset,
    }));
    ok('2.3 Supervision équipe affichée', r1.sv && !r1.cockpit);
    ok('2.4 Liste des techniciens : Jordan, Dorian, Bryan', ['Jordan', 'Dorian', 'Bryan'].every(n => r1.techs.includes(n)));
    ok('2.5 Responsables sans mission non listés (Kevin, Alban)', !r1.techs.includes('Kevin') && !r1.techs.includes('Alban'));
    ok('2.6 Jour sélectionné par défaut = aujourd\'hui', r1.activeDay && r1.activeDay.day === S.D.today);
    ok('2.7 Créneau non attribué du jour signalé (Soir)', r1.unas === 1);
    ok('2.8 Badge « Lecture seule » visible', r1.ro);
    const k0 = await kpis(page);
    ok('2.9 KPI du jour : 0 terminée, 7 restantes, 2 techniciens actifs, 1 non attribué', k0.join(',') === '0,7,2,1');
    const j0 = await techCard(page, 'Jordan');
    ok('2.10 Carte Jordan : 0/3, non commencé, chip créneau Matin', j0 && /0\/3/.test(j0.meta) && /is-todo/.test(j0.cls) && j0.chips === 1);
    const b0 = await techCard(page, 'Bryan');
    ok('2.11 Bryan sans créneau aujourd\'hui → « Aucun créneau ce jour »', b0 && /Aucun créneau ce jour/.test(b0.meta) && /is-empty/.test(b0.cls));

    // Synchronisation : Jordan valide une mission (même fonction que son bouton).
    await ev(page, (a) => MX.DB.setWeekSlotTaskDone(a.wk, a.day, a.inst, a.task, true, 'Jordan'), { wk: S.D.wk, day: S.D.today, inst: S.jMatin.instId, task: S.jMatin.taskIds[0] });
    await page.waitForTimeout(400);
    const j1 = await techCard(page, 'Jordan');
    const k1 = await kpis(page);
    ok('2.12 Synchro : carte Jordan passe à 1/3 « en cours » sans recharger', j1 && /1\/3/.test(j1.meta) && /is-progress/.test(j1.cls) && j1.pct === '33%');
    ok('2.13 Synchro : KPI équipe 1 terminée / 6 restantes', k1[0] === 1 && k1[1] === 6);
    // Dorian termine tout son créneau → « Terminé ».
    for (const t of S.dJour.taskIds) await ev(page, (a) => MX.DB.setWeekSlotTaskDone(a.wk, a.day, a.inst, a.task, true, 'Dorian'), { wk: S.D.wk, day: S.D.today, inst: S.dJour.instId, task: t });
    await page.waitForTimeout(400);
    const d1 = await techCard(page, 'Dorian');
    ok('2.14 Dorian 2/2 → statut « terminé » (100 %)', d1 && /is-done/.test(d1.cls) && d1.pct === '100%');

    // Détail de Jordan.
    await page.click('.mm-sv-tech[data-tech="Jordan"]');
    await page.waitForTimeout(250);
    const dt = await ev(page, () => {
      const d = document.querySelector('.mm-sv-dt');
      return d && {
        name: d.dataset.tech, tasks: d.querySelectorAll('.mm-sv-task').length, done: d.querySelectorAll('.mm-sv-task.is-done').length,
        slot: (d.querySelector('.mm-sv-slot-name') || {}).textContent || '', hrs: (d.querySelector('.mm-sv-slot-h') || {}).textContent || '',
        teamVisible: getComputedStyle(document.querySelector('.mm-sv-team')).display !== 'none',
        backVisible: getComputedStyle(d.querySelector('.mm-sv-back')).display !== 'none',
        txt: d.textContent,
      };
    });
    ok('2.15 Détail Jordan : 3 missions dont 1 terminée', dt && dt.name === 'Jordan' && dt.tasks === 3 && dt.done === 1);
    ok('2.16 Détail : créneau Matin + horaires 08:00 – 16:30', dt && /Matin/.test(dt.slot) && dt.hrs === '08:00 – 16:30');
    ok('2.17 Détail : n\'affiche PAS les missions de Dorian', dt && !dt.txt.includes('Chambre 204'));
    ok('2.18 Ordinateur : équipe ET détail visibles côte à côte, pas de bouton retour', dt && dt.teamVisible && !dt.backVisible);

    // Lecture seule : aucun contrôle de saisie, clics sans effet sur les données.
    const before = await ev(page, () => JSON.stringify(window.__mockDb._debugStore.week_slots));
    const ro = await ev(page, () => {
      const root = document.querySelector('.mm-sv-wrap');
      const inputs = root.querySelectorAll('input, select, textarea, [contenteditable="true"]').length;
      const taskHandlers = Array.from(root.querySelectorAll('.mm-sv-task, .mm-sv-task *, .mm-sv-slot, .mm-sv-unas-row')).filter(e => e.getAttribute('onclick')).length;
      const writeCalls = Array.from(root.querySelectorAll('[onclick]')).map(e => e.getAttribute('onclick')).filter(s => !/^MX\.MM\.(setView|_supSetDay|_supSelectTech)\(/.test(s));
      return { inputs, taskHandlers, writeCalls };
    });
    ok('2.19 Lecture seule : aucune case/champ de saisie dans la supervision', ro.inputs === 0);
    ok('2.20 Lecture seule : aucune action sur les missions/créneaux', ro.taskHandlers === 0);
    ok('2.21 Lecture seule : seuls des boutons de navigation existent', ro.writeCalls.length === 0);
    const tasksEls = await page.$$('.mm-sv-task');
    for (const el of tasksEls) await el.click();
    await page.click('.mm-sv-unas-row').catch(() => {});
    await page.waitForTimeout(300);
    const after = await ev(page, () => JSON.stringify(window.__mockDb._debugStore.week_slots));
    ok('2.22 Lecture seule : cliquer les missions ne modifie pas week_slots', before === after);

    // Navigation par jour : week-end, ancien système, ancienne forme, semaine.
    await ev(page, (d) => MX.MM._supSetDay(d), S.D.we);
    await page.waitForTimeout(200);
    const we = await ev(page, () => ({ wday: !!document.querySelector('.mm-sv-day.is-active.is-we') }));
    const bWe = await techCard(page, 'Bryan');
    ok('2.23 Week-end : jour affiché comme week-end', we.wday);
    ok('2.24 Week-end : Bryan 0/1 avec son créneau', bWe && /0\/1/.test(bWe.meta) && bWe.chips === 1);

    await ev(page, (d) => MX.MM._supSetDay(d), S.D.legacy);
    await page.waitForTimeout(200);
    const lg = await ev(page, () => ({ note: (document.querySelector('.mm-sv-note') || {}).textContent || '' }));
    const dLg = await techCard(page, 'Dorian');
    ok('2.25 Ancien système : journée legacy signalée', /ancien système/i.test(lg.note));
    ok('2.26 Ancien système : Dorian 0/2 (tâches legacy + affectation)', dLg && /0\/2/.test(dLg.meta));
    const lgK = await kpis(page);
    const lgD = await ev(page, () => ({
      note: (document.querySelector('.mm-sv-note.is-unprep') || {}).textContent || '',
      unasRows: document.querySelectorAll('.mm-sv-unas-row').length,
      defs: Array.from(document.querySelectorAll('.mm-sv-defs-row')).map(r => ({ name: r.querySelector('.mm-sv-defs-name').textContent, tag: r.querySelector('.mm-sv-defs-tag').textContent })),
      chipLegacy: !!document.querySelector('.mm-sv-tech[data-tech="Dorian"] .mm-sv-chip.is-legacy'),
    }));
    ok('2.26b Jour non préparé : indicateur « Planning non préparé » + tâches par défaut non comptées', /Planning non préparé/.test(lgD.note) && /par défaut sans titulaire, non comptée/.test(lgD.note));
    ok('2.26c Jour non préparé : seules les tâches attribuées comptent (0 terminée / 2 restantes)', lgK[0] === 0 && lgK[1] === 2);
    ok('2.26d Jour non préparé : les tâches par défaut ne sont PAS des « créneaux non attribués »', lgK[3] === 0 && lgD.unasRows === 0);
    ok('2.26e Tâches par défaut (textes MX.DEFT) étiquetées « Tâches par défaut »', lgD.defs.some(r => /Soir/.test(r.name) && r.tag === 'Tâches par défaut'));
    ok('2.26f Créneau legacy personnalisé sans titulaire étiqueté « Ancien système »', lgD.defs.some(r => /Journée/.test(r.name) && r.tag === 'Ancien système'));
    ok('2.26g Créneau attribué de l\'ancien système signalé (chip « ancien système »)', lgD.chipLegacy);
    await page.click('.mm-sv-tech[data-tech="Dorian"]');
    await page.waitForTimeout(200);
    ok('2.26h Détail : créneau de l\'ancien système étiqueté', await ev(page, () => /Ancien système/.test((document.querySelector('.mm-sv-dt') || {}).textContent || '')));
    await page.click('.mm-sv-tech[data-tech="Jordan"]');
    await page.waitForTimeout(200);

    await ev(page, (d) => MX.MM._supSetDay(d), S.D.oldShape);
    await page.waitForTimeout(200);
    const jOld = await techCard(page, 'Jordan');
    ok('2.27 Ancienne forme week_slots (sans horaires/couleur) : affichée sans erreur', jOld && /0\/1/.test(jOld.meta));

    // Journée réellement vide : ni week_slots, ni tâches legacy (l'app crée
    // par défaut des tâches legacy pour chaque créneau — on les vide ici).
    const emptyDay = await ev(page, (used) => MX.DAYS.map(d => d.id).find(id => !used.includes(id)), [S.D.today, S.D.we, S.D.legacy, S.D.oldShape]);
    await ev(page, async (d) => { for (const sl of MX.getDaySlots(d)) await window.__mockDb.collection('tasks').doc(d + '_' + sl).set({ items: [] }); }, emptyDay);
    await page.waitForTimeout(300);
    await ev(page, (d) => MX.MM._supSetDay(d), emptyDay);
    await page.waitForTimeout(200);
    const em = await ev(page, () => (document.querySelector('.mm-sv-note') || {}).textContent || '');
    ok('2.28 Journée sans planning : indicateur « Planning non préparé »', /Planning non préparé/.test(em));
    const emChip = await ev(page, (d) => { const c = document.querySelector('.mm-sv-day[data-day="' + d + '"]'); return { unprep: c.classList.contains('is-unprep'), txt: c.querySelector('.mm-sv-day-pct').textContent }; }, emptyDay);
    ok('2.28b Ruban : jour sans planning marqué « Non prép. » (pas 0 %)', emChip.unprep && emChip.txt === 'Non prép.');

    await ev(page, () => MX.MM._supSetDay('week'));
    await page.waitForTimeout(200);
    const wkv = await ev(page, () => {
      const j = document.querySelector('.mm-sv-tech[data-tech="Jordan"]');
      const det = document.querySelector('.mm-sv-dt');
      return {
        strip: j ? j.querySelectorAll('.mm-sv-wd').length : 0,
        dtDays: det ? det.querySelectorAll('.mm-sv-dt-day:not(.is-off)').length : 0,
        unas: document.querySelectorAll('.mm-sv-unas-row').length,
      };
    });
    const jW = await techCard(page, 'Jordan');
    ok('2.29 Semaine : bande des 7 jours par technicien', wkv.strip === 7);
    ok('2.30 Semaine : Jordan 1/4 (Matin du jour + ancienne forme)', jW && /1\/4/.test(jW.meta));
    ok('2.31 Semaine : détail de Jordan réparti sur 2 journées', wkv.dtDays === 2);
    ok('2.32 Semaine : seul le créneau préparé sans titulaire est « non attribué »', wkv.unas === 1);
    // Tâches par défaut : attendu calculé indépendamment depuis la programmation
    // effective (jours legacy, tâches sans titulaire de créneau ni individuel).
    const expDef = await ev(page, () => MX.DAYS.reduce((a, d) => {
      const s = MX.getEffectiveDaySchedule(d.id);
      if (s.source === 'week_slots') return a;
      return a + s.instances.reduce((b, i) => b + (i.userName ? 0 : i.tasks.filter(t => !t.assignedTo).length), 0);
    }, 0));
    const wkK = await kpis(page);
    const wkD = await ev(page, () => ({
      sum: (document.querySelector('.mm-sv-defs-ct') || {}).textContent || '',
      foot: (document.querySelector('.mm-sv-ov-foot') || {}).textContent || '',
      open: (document.querySelector('.mm-sv-defs') || {}).open,
      inUnas: Array.from(document.querySelectorAll('.mm-sv-unas-row')).some(r => /Tâches par défaut/.test(r.textContent)),
    }));
    // Vraies missions de la semaine : jour J (Jordan 3 + Dorian 2 + Soir non
    // attribué 2) + week-end Bryan 1 + ancien système attribué Dorian 2 +
    // ancienne forme Jordan 1 = 11, dont 3 terminées.
    ok('2.32b Semaine : KPI = vraies missions uniquement (3 terminées / 8 restantes)', wkK[0] === 3 && wkK[1] === 8);
    ok('2.32c Semaine : KPI « Non attribués » = 1 (tâches par défaut exclues)', wkK[3] === 1);
    ok('2.32d Semaine : section « Planning non préparé » avec le bon nombre de tâches par défaut (' + expDef + ')', expDef > 0 && wkD.sum.indexOf(String(expDef) + ' tâche') === 0);
    ok('2.32e Semaine : section repliée par défaut (indicateur discret)', wkD.open === false);
    ok('2.32f Semaine : pied des indicateurs « sans planning préparé · tâches par défaut non comptées »', /sans planning préparé/.test(wkD.foot) && /par défaut non comptée/.test(wkD.foot));
    ok('2.32g Semaine : aucune tâche par défaut présentée comme créneau non attribué', !wkD.inUnas);
    // Ordinateur : la position des notifications est inchangée (en bas).
    const dToast = await ev(page, async () => { MX.toast('Notification test'); await new Promise(r => setTimeout(r, 250)); const r = document.getElementById('toast').getBoundingClientRect(); return r.top > innerHeight / 2; });
    ok('2.32h Ordinateur : notification toujours en bas (comportement inchangé)', dToast);

    // Retour à Mes missions : cockpit personnel intact.
    await page.click('.mm-sv-switch-btn:nth-child(1)');
    await page.waitForTimeout(250);
    const back = await ev(page, () => ({ cockpit: !!document.querySelector('.mm-v3-wrap'), sv: !!document.querySelector('.mm-sv-wrap') }));
    ok('2.33 Retour « Mes missions » : cockpit personnel de Kevin', back.cockpit && !back.sv);
    ok('2.34 Aucune erreur JS (responsable, ordinateur)', errs.length === 0);
    if (errs.length) console.error(errs);
    await ctx.close();
  }

  // ═══ 3. Responsable Alban (mobile 390 px) ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'alban', '8888');
    await seedAll(page);
    await ev(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(500);
    ok('3.1 Alban (responsable) : sélecteur affiché sur mobile', await ev(page, () => !!document.querySelector('.mm-sv-switch')));
    await ev(page, () => MX.MM.setView('team'));
    await page.waitForTimeout(250);
    const m0 = await ev(page, () => {
      const w = document.querySelector('.mm-sv-wrap');
      return {
        sv: !!w, overflow: w.scrollWidth - w.clientWidth,
        detailHidden: getComputedStyle(document.querySelector('.mm-sv-detail')).display === 'none',
        daysScroll: getComputedStyle(document.querySelector('.mm-sv-days')).overflowX,
      };
    });
    ok('3.2 Mobile : supervision affichée', m0.sv);
    ok('3.3 Mobile : aucun débordement horizontal', m0.overflow <= 1);
    ok('3.4 Mobile : liste équipe seule (détail masqué tant qu\'aucun technicien choisi)', m0.detailHidden);
    ok('3.5 Mobile : jours dans un ruban défilant', m0.daysScroll === 'auto');
    const vis = await ev(page, () => {
      const s = document.querySelector('.mm-sv-days').getBoundingClientRect();
      const a = document.querySelector('.mm-sv-day.is-active').getBoundingClientRect();
      return a.left >= s.left - 1 && a.right <= s.right + 1;
    });
    ok('3.5b Mobile : le jour sélectionné est entièrement visible dans le ruban', vis);
    await page.tap('.mm-sv-tech[data-tech="Jordan"]');
    await page.waitForTimeout(250);
    const m1 = await ev(page, () => ({
      teamHidden: getComputedStyle(document.querySelector('.mm-sv-team')).display === 'none',
      backVisible: !!document.querySelector('.mm-sv-back') && getComputedStyle(document.querySelector('.mm-sv-back')).display !== 'none',
      tasks: document.querySelectorAll('.mm-sv-dt .mm-sv-task').length,
      overflow: (() => { const w = document.querySelector('.mm-sv-wrap'); return w.scrollWidth - w.clientWidth; })(),
    }));
    ok('3.6 Mobile : détail plein écran (équipe masquée) avec bouton retour', m1.teamHidden && m1.backVisible);
    ok('3.7 Mobile : checklist de Jordan affichée (3 missions)', m1.tasks === 3);
    ok('3.8 Mobile : détail sans débordement horizontal', m1.overflow <= 1);
    await page.tap('.mm-sv-back');
    await page.waitForTimeout(250);
    ok('3.9 Mobile : retour à la liste équipe', await ev(page, () => !document.querySelector('.mm-sv-dt') && getComputedStyle(document.querySelector('.mm-sv-team')).display !== 'none'));

    // ── Défilement jusqu'au dernier élément, jamais sous la barre du bas ──
    // Obstacle = haut de la barre de navigation inférieure OU de son bouton
    // central « + » (qui dépasse au-dessus de la barre), le plus haut des deux.
    const scrollEndCheck = (sel) => ev(page, async (sel) => {
      const mc = document.getElementById('main-content');
      mc.scrollTop = mc.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 150));
      const els = document.querySelectorAll(sel);
      const last = els[els.length - 1];
      if (!last) return { found: false };
      const nav = document.getElementById('bottom-nav');
      const fab = document.querySelector('.mbn-fab');
      const tops = [innerHeight];
      if (nav && getComputedStyle(nav).display !== 'none') tops.push(nav.getBoundingClientRect().top);
      if (fab && fab.offsetParent) tops.push(fab.getBoundingClientRect().top);
      const obstacle = Math.min.apply(null, tops);
      const r = last.getBoundingClientRect();
      return { found: true, bottom: Math.round(r.bottom), obstacle: Math.round(obstacle), clear: r.bottom <= obstacle - 4, top: r.top >= 0 };
    }, sel);
    // Longue checklist pour Bryan aujourd'hui (16 missions).
    const S3 = await pickDays(page);
    await seedInstance(page, S3.today, { name: 'Journée longue', icon: '🛠', color: '#22C55E', start: '07:00', end: '19:00', userName: 'Bryan',
      tasks: Array.from({ length: 16 }, (_, i) => 'Mission longue n°' + (i + 1)) });
    await page.waitForTimeout(400);
    const tEnd = await scrollEndCheck('.mm-sv-team > *');
    ok('3.11 Vue équipe : le dernier élément défile au-dessus de la barre de navigation (' + tEnd.bottom + ' ≤ ' + tEnd.obstacle + ')', tEnd.found && tEnd.clear && tEnd.top);
    await page.tap('.mm-sv-tech[data-tech="Bryan"]');
    await page.waitForTimeout(250);
    const nb = await ev(page, () => document.querySelectorAll('.mm-sv-dt .mm-sv-task').length);
    ok('3.12 Détail : les 16 missions de Bryan sont présentes', nb === 16);
    const dEnd = await scrollEndCheck('.mm-sv-dt .mm-sv-task');
    ok('3.13 Détail : la DERNIÈRE mission est entièrement visible au-dessus de la barre (' + dEnd.bottom + ' ≤ ' + dEnd.obstacle + ')', dEnd.found && dEnd.clear && dEnd.top);
    const lastTxt = await ev(page, () => { const t = document.querySelectorAll('.mm-sv-dt .mm-sv-task-txt'); return t[t.length - 1].textContent; });
    ok('3.14 Détail : la dernière mission est bien « Mission longue n°16 »', lastTxt === 'Mission longue n°16');
    // Notifications temporaires : en haut, jamais sur la checklist du bas ni la barre.
    // Remonte en haut : le sélecteur et la barre supérieure sont visibles.
    await ev(page, () => { document.getElementById('main-content').scrollTop = 0; });
    await page.tap('.mm-sv-back').catch(() => {});
    await page.waitForTimeout(200);
    const tst = await ev(page, async () => {
      MX.toast('Bienvenue Alban !');
      await new Promise(r => setTimeout(r, 250));
      const r = document.getElementById('toast').getBoundingClientRect();
      const nav = document.getElementById('bottom-nav').getBoundingClientRect();
      const hit = (b) => !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom);
      // Tous les boutons visibles de la page (hors notification) : aucun ne doit être recouvert.
      const covered = Array.from(document.querySelectorAll('button, a, [onclick]')).filter(el => {
        if (el.closest('#toast') || el.closest('#bottom-nav')) return false;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight) return false;
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') return false;
        return hit(b);
      }).map(el => el.className || el.tagName);
      const sw = document.querySelector('.mm-sv-switch').getBoundingClientRect();
      const tasks = Array.from(document.querySelectorAll('.mm-sv-tech, .mm-sv-task')).filter(el => hit(el.getBoundingClientRect())).length;
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), navTop: Math.round(nav.top), inView: r.left >= 0 && r.right <= innerWidth, covered, switchHit: hit(sw), tasks };
    });
    ok('3.15 Mobile : notification en haut, dans la barre supérieure (loin de la barre du bas)', tst.top < 60 && tst.bottom < tst.navTop - 200);
    ok('3.16 Mobile : notification entièrement dans l\'écran', tst.inView);
    ok('3.16b Mobile : la notification ne recouvre aucun bouton (' + (tst.covered.join(',') || 'aucun') + ')', tst.covered.length === 0 && !tst.switchHit);
    ok('3.16c Mobile : la notification ne recouvre aucune mission ni carte technicien', tst.tasks === 0);
    await page.tap('.mm-sv-tech[data-tech="Bryan"]');
    await page.waitForTimeout(250);
    // Semaine : défilement complet du détail.
    await ev(page, () => MX.MM._supSetDay('week'));
    await page.waitForTimeout(250);
    const wEnd = await scrollEndCheck('.mm-sv-dt > *');
    ok('3.17 Semaine (détail) : le dernier jour défile au-dessus de la barre (' + wEnd.bottom + ' ≤ ' + wEnd.obstacle + ')', wEnd.found && wEnd.clear && wEnd.top);
    await page.tap('.mm-sv-back');
    await page.waitForTimeout(250);
    const wTeamEnd = await scrollEndCheck('.mm-sv-team > *');
    ok('3.18 Semaine (équipe) : « Planning non préparé » accessible au-dessus de la barre', wTeamEnd.found && wTeamEnd.clear);
    await page.tap('.mm-sv-defs-sum');
    await page.waitForTimeout(200);
    const dfEnd = await scrollEndCheck('.mm-sv-defs-row');
    ok('3.19 Semaine : section dépliée, dernière ligne visible au-dessus de la barre', dfEnd.found && dfEnd.clear && dfEnd.top);
    const ovf = await ev(page, () => { const w = document.querySelector('.mm-sv-wrap'); return w.scrollWidth - w.clientWidth; });
    ok('3.20 Semaine mobile : aucun débordement horizontal', ovf <= 1);
    // Checklist personnelle (Mes missions) : notification aussi en haut.
    await ev(page, () => MX.MM.setView('mine'));
    await page.waitForTimeout(300);
    const pt = await ev(page, async () => { MX.toast('Mission validée'); await new Promise(r => setTimeout(r, 250)); return Math.round(document.getElementById('toast').getBoundingClientRect().top); });
    ok('3.21 Mes missions (mobile) : notification en haut, checklist personnelle intacte', pt < 140 && await ev(page, () => !!document.querySelector('.mm-v3-wrap')));
    ok('3.10 Aucune erreur JS (mobile)', errs.length === 0);
    if (errs.length) console.error(errs);
    await ctx.close();
  }

  // ═══ 4. Changement de profil sur le même appareil : responsable → technicien ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    await seedAll(page);
    await ev(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(300);
    await ev(page, () => MX.MM.setView('team'));
    await page.waitForTimeout(200);
    ok('4.1 Kevin en supervision', await ev(page, () => !!document.querySelector('.mm-sv-wrap')));
    await pinLogin(page, 'jordan', '2222');
    await ev(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(400);
    const r = await ev(page, () => ({ sv: !!document.querySelector('.mm-sv-wrap'), sw: !!document.querySelector('.mm-sv-switch'), cockpit: !!document.querySelector('.mm-v3-wrap') }));
    ok('4.2 Jordan connecté ensuite sur le même appareil : ni supervision ni sélecteur', !r.sv && !r.sw && r.cockpit);
    ok('4.3 Aucune erreur JS', errs.length === 0);
    if (errs.length) console.error(errs);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (failures ? failures + ' échec(s)' : 'TOUS LES CONTRÔLES PASSENT'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
