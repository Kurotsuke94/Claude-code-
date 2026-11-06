// Tests pour la correction "Jordan voit des check-lists d'une autre tranche
// horaire" (module Missions/Checklist). Couvre assets/js/pages/checklist.js
// :render() — le filtre de visibilité par créneau pour un technicien.
//
// Portée : tests Playwright + mock Firestore en mémoire (tests/mock-
// firebase.js), PAS un émulateur Firestore réel ni une vérification des
// règles de sécurité serveur — ces tests prouvent le comportement du CODE
// CLIENT (qui voit quoi dans l'UI), pas que les règles Firestore limitent
// réellement les LECTURES côté serveur (hors périmètre : voir le rapport
// de diagnostic pour ce point, traité séparément).
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

// GARDE-FOU ENVIRONNEMENT (mock-firebase) — index.html charge le VRAI SDK
// Firebase depuis www.gstatic.com : sur un poste disposant d'un accès
// Internet, il écrase window.firebase défini par tests/mock-firebase.js, puis
// firebase-config.js le redirige vers les émulateurs locaux (127.0.0.1:8090/
// 9099). Sans émulateur démarré, l'app ne voit plus les données du mock et
// toute écriture Firestore attend indéfiniment. Même protection que
// tests/navigation_visibility_test.js, tests/accueil_cockpit_test.js et
// tests/cta_vc_test.js : bloquer gstatic/googleapis AVANT page.goto(), puis
// vérifier explicitement que le mock est bien celui utilisé par l'app.
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
    console.error('\nERREUR ENVIRONNEMENT : mock-firebase inactif (window.firebase n\'est pas ' +
      'tests/mock-firebase.js — probablement le vrai SDK Firebase chargé depuis gstatic.com). ' +
      'Test interrompu immédiatement au lieu d\'attendre un délai d\'expiration.');
    process.exit(1);
  }
}

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (120s) — le process est arrêté de force.');
  process.exit(1);
}, 120000);

async function bootPage(page) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ path: SEED });
  await blockRealFirebase(page);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await assertMockFirebase(page);
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
// Connexion Admin Firebase réelle (passe par le vrai flux MX.Auth.login —
// le mock signInWithEmailAndPassword accepte n'importe quel email/mot de
// passe, comme un vrai compte Firebase Admin en environnement de test).
async function adminLogin(page, email, pass) {
  await page.evaluate((a) => {
    document.getElementById('login-email').value = a.email;
    document.getElementById('login-password').value = a.pass;
  }, { email, pass });
  await page.evaluate(async () => { await MX.Auth.login({ preventDefault: () => {} }); });
  await page.waitForTimeout(400);
}
function evalPage(page, fn, ...args) { return page.evaluate(fn, ...args); }

// Seed un créneau week_slots (instance) pour un jour donné, avec un nom et
// un utilisateur assigné (ou aucun -> créneau non assigné) — même mécanisme
// réel que Gestion semaine tech (MX.DB.addShiftTemplate +
// loadTemplateIntoWeekDay), pas une donnée inventée/raccourcie.
async function seedInstance(page, dayId, opts) {
  const weekKey = await evalPage(page, () => MX.weekKeyOf(new Date()));
  return evalPage(page, async (a) => {
    const tplId = await MX.DB.addShiftTemplate({
      name: a.opts.name, icon: a.opts.icon || '', color: a.opts.color || '#6B7280',
      start: a.opts.start || '', end: a.opts.end || '', active: true,
      tasks: (a.opts.tasks || ['Tâche 1']).map((text, i) => ({ id: 't' + i, text, order: i })),
    });
    const user = a.opts.userName ? (MX.state.users || []).find(u => u.name === a.opts.userName) : null;
    const instId = await MX.DB.loadTemplateIntoWeekDay(a.wk, 'x', a.dayId, tplId, user ? user.id : null, user ? user.name : '', 'test');
    // loadTemplateIntoWeekDay régénère un uuid() pour chaque tâche (voir
    // db.js:loadTemplateIntoWeekDay) — on relit donc les vrais ids créés au
    // lieu de supposer qu'ils restent 't0'/'t1'/....
    const sched = MX.getEffectiveDaySchedule(a.dayId);
    const inst = sched.instances.find(i => i.id === instId);
    const taskIds = inst ? inst.tasks.map(t => t.id) : [];
    return { tplId, instId, weekKey: a.wk, taskIds };
  }, { dayId, opts, wk: weekKey });
}
async function visibleSlotLabels(page) {
  return evalPage(page, () => Array.from(document.querySelectorAll('.cl-ws-sg-lbl')).map(el => el.childNodes[0].textContent.trim()));
}
async function noAssignedSlotMessage(page) {
  return evalPage(page, () => /Aucun créneau assigné/.test(document.getElementById('main-content').textContent));
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ═══ 1. Jordan (Matin) ne voit PAS les créneaux Journée/Soir non assignés ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'jordan', '2222');
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin',   userName: 'Jordan' });
    await seedInstance(page, todayId, { name: 'Journée', userName: null }); // non assigné
    await seedInstance(page, todayId, { name: 'Soir',    userName: null }); // non assigné
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(500);
    const labels = await visibleSlotLabels(page);
    ok('1.1 Jordan voit bien son propre créneau (Matin)', labels.includes('Matin'));
    ok('1.2 Jordan NE voit PAS le créneau Journée (non assigné, pas le sien)', !labels.includes('Journée'));
    ok('1.3 Jordan NE voit PAS le créneau Soir (non assigné, pas le sien)', !labels.includes('Soir'));
    ok('1.4 Exactement 1 créneau visible pour Jordan', labels.length === 1);
    ok('1.5 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 2. Un technicien affecté au Soir (Kevin) ne voit pas le Matin
  //         actuel, même non assigné — non-régression du cas "assigné à
  //         quelqu'un d'autre" (jamais affecté par cette correction) et du
  //         cas "non assigné" (celui qui vient d'être corrigé) ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin',   userName: null });   // non assigné
    await seedInstance(page, todayId, { name: 'Journée', userName: 'Jordan' }); // assigné à un AUTRE technicien
    await seedInstance(page, todayId, { name: 'Soir',    userName: 'Kevin' });
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(500);
    const labels = await visibleSlotLabels(page);
    ok('2.1 Kevin voit bien son propre créneau (Soir)', labels.includes('Soir'));
    ok('2.2 Kevin NE voit PAS le Matin (non assigné, pas le sien)', !labels.includes('Matin'));
    ok('2.3 Kevin NE voit PAS la Journée (assignée à Jordan, pas à lui)', !labels.includes('Journée'));
    ok('2.4 Exactement 1 créneau visible pour Kevin', labels.length === 1);
    ok('2.5 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 3+4. Une responsable (Sophie) voit TOUS les créneaux (Matin/Journée/
  //           Soir), y compris ceux des AUTRES techniciens, sans dépendre
  //           de sa propre affectation (elle n'a aucune affectation) ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin',   userName: 'Jordan' });
    await seedInstance(page, todayId, { name: 'Journée', userName: 'Kevin' });
    await seedInstance(page, todayId, { name: 'Soir',    userName: null });
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(500);
    const labels = await visibleSlotLabels(page);
    ok('3.1 Responsable voit le Matin (de Jordan)',   labels.includes('Matin'));
    ok('3.2 Responsable voit la Journée (de Kevin)',  labels.includes('Journée'));
    ok('3.3 Responsable voit le Soir (non assigné)',  labels.includes('Soir'));
    ok('3.4 Les 3 créneaux sont visibles, aucun filtré', labels.length === 3);
    ok('3.5 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 7b. Un Administrateur (Firebase Auth) voit aussi tout — rôle testé
  //          séparément du rôle Responsable (chemins canSeeAll() différents :
  //          isAdmin() vs currentUser.role==='responsable') ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await adminLogin(page, 'admin@maintix.test', 'whatever');
    const todayId = await evalPage(page, () => MX.todayId());
    await seedInstance(page, todayId, { name: 'Matin',   userName: 'Jordan' });
    await seedInstance(page, todayId, { name: 'Journée', userName: null });
    await seedInstance(page, todayId, { name: 'Soir',    userName: 'Kevin' });
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(500);
    const labels = await visibleSlotLabels(page);
    ok('7b.1 Admin voit les 3 créneaux (rôle isAdmin(), distinct de responsable)', labels.length === 3 && labels.includes('Matin') && labels.includes('Journée') && labels.includes('Soir'));
    ok('7b.2 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 5. Historique non supprimé : une tâche déjà cochée (done) reste
  //         présente et cochée après navigation ailleurs puis retour —
  //         jamais effacée silencieusement.
  //         Limite assumée : tests/mock-firebase.js garde son "Firestore"
  //         simulé en mémoire JS de la page (var store = {} dans
  //         makeFirestoreMock), SANS le persister en localStorage (seule
  //         l'auth l'est — voir _authStore plus bas dans ce même fichier).
  //         Une vraie page.reload()/nouvelle page réinjecterait le mock avec
  //         un store VIDE : ça testerait la mécanique du mock, pas le
  //         comportement de l'app. On vérifie donc, dans la MÊME page, que
  //         rien côté client (render(), navigation) ne supprime ou ne
  //         réinitialise silencieusement une donnée déjà écrite en base
  //         (mock). La persistance réelle Firestore à travers un F5
  //         navigateur relève d'un test émulateur (hors périmètre ici, cf.
  //         en-tête de ce fichier).
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'jordan', '2222');
    const todayId = await evalPage(page, () => MX.todayId());
    const { instId, weekKey, taskIds } = await seedInstance(page, todayId, { name: 'Matin', userName: 'Jordan', tasks: ['Vérifier la chaudière'] });
    await evalPage(page, (a) => MX.DB.setWeekSlotTaskDone(a.weekKey, a.dayId, a.instId, a.taskId, true, 'test'), { weekKey, dayId: todayId, instId, taskId: taskIds[0] });
    // Navigation vers un autre écran puis retour sur la check-list du jour :
    // vérifie que render() relit l'état réel de la base (mock) plutôt que de
    // garder/écraser un état mémoire éphémère propre au premier rendu.
    await page.evaluate(() => { MX.showPage('accueil'); });
    await page.waitForTimeout(300);
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(500);
    const info = await evalPage(page, () => {
      const card = document.querySelector('.cl-ws-sg');
      return card ? { text: card.textContent, hasDoneClass: !!document.querySelector('.cl-ws-tr--done') } : null;
    });
    ok('5.1 Le créneau "Matin" existe toujours après navigation (historique non supprimé)', !!info);
    ok('5.2 La tâche cochée reste cochée après navigation (jamais réinitialisée silencieusement)', !!info && info.hasDoneClass);
    ok('5.3 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 6. Une modification d'affectation actualise correctement l'affichage
  //         SANS recharger la page (écoute Firestore temps réel) ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'jordan', '2222');
    const todayId = await evalPage(page, () => MX.todayId());
    const { instId, weekKey } = await seedInstance(page, todayId, { name: 'Matin', userName: null }); // non assigné au départ
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(500);
    const labelsBefore = await visibleSlotLabels(page);
    const msgBefore = await noAssignedSlotMessage(page);
    ok('6.1 Avant affectation : Jordan ne voit AUCUN créneau (non assigné, pas le sien)', labelsBefore.length === 0);
    ok('6.2 Avant affectation : message explicite "Aucun créneau assigné" (jamais une liste vide silencieuse)', msgBefore);

    await evalPage(page, (a) => MX.DB.setWeekSlotAssignee(a.weekKey, a.dayId, a.instId, 'jordan', 'Jordan', 'test'), { weekKey, dayId: todayId, instId });
    await page.waitForTimeout(600); // laisse le listener Firestore (mock) re-rendre automatiquement
    const labelsAfter = await visibleSlotLabels(page);
    ok('6.3 Après affectation : le créneau "Matin" apparaît SANS recharger la page', labelsAfter.includes('Matin'));
    ok('6.4 Aucune erreur JS pendant toute la séquence', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 8. Libellé d'affectation (vue Responsable, jour même) — le nom
  //         affiché sur chaque créneau doit correspondre à l'affectation
  //         réelle (state.assignments / inst.userName via
  //         getEffectiveDaySchedule), jamais à "Non assigné" quand une
  //         affectation existe mais qu'aucune "revendication" dailyClaims
  //         n'a été faite aujourd'hui. Reproduit exactement l'anomalie
  //         observée en vérification visuelle (panneau Planning correct,
  //         libellé de créneau Checklist incorrect) et vérifie la
  //         correction. Modèle legacy (state.tasks/state.assignments),
  //         seul modèle où dailyClaims/assignments peuvent diverger — voir
  //         helpers.js:getEffectiveDaySchedule. ═══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const todayId = await evalPage(page, () => MX.todayId());
    await evalPage(page, async (dayId) => {
      // Matin et Journée formellement affectés (state.assignments), SANS
      // aucune revendication dailyClaims — c'est précisément le cas qui
      // affichait "Non assigné" avant correction.
      await MX.DB.setAssignment(dayId, 'matin', 'Jordan');
      await MX.DB.setTasks(dayId, 'matin', [{ id: 'm1', text: 'Vérifier chaudière', order: 0 }]);
      await MX.DB.setAssignment(dayId, 'journee', 'Kevin');
      await MX.DB.setTasks(dayId, 'journee', [{ id: 'j1', text: 'Entretien espaces communs', order: 0 }]);
      // Soir : aucune affectation du tout — doit rester "Non assigné".
      await MX.DB.setAssignment(dayId, 'soir', '');
      await MX.DB.setTasks(dayId, 'soir', [{ id: 's1', text: 'Fermeture établissement', order: 0 }]);
    }, todayId);
    await page.waitForTimeout(400);
    await page.evaluate((id) => { MX.showPage(id); }, todayId);
    await page.waitForTimeout(600);

    const assigneeBySlot = await evalPage(page, () => {
      const out = {};
      document.querySelectorAll('.cl-ws-sg').forEach(card => {
        const lbl = card.querySelector('.cl-ws-sg-lbl');
        const row = card.querySelector('.cl-ws-asgn-row');
        if (!lbl || !row) return;
        const slot = lbl.childNodes[0].textContent.trim();
        out[slot] = row.textContent.trim();
      });
      return out;
    });
    ok('8.1 Créneau "Matin" affiche bien "Jordan" (affectation réelle, pas "Non assigné")', assigneeBySlot['Matin'] === 'Jordan');
    ok('8.2 Créneau "Journée" affiche bien "Kevin" (affectation réelle, pas "Non assigné")', assigneeBySlot['Journée'] === 'Kevin');
    ok('8.3 Créneau "Soir" affiche "Non assigné" (aucune affectation — comportement correct, pas un faux positif)', assigneeBySlot['Soir'] === 'Non assigné');
    ok('8.4 Le panneau "Planning" (app.js) affiche la même affectation pour Matin (source commune getEffectiveDaySchedule)', await evalPage(page, () => {
      const row = Array.from(document.querySelectorAll('.dxp-slot-row')).find(r => /Matin/.test(r.querySelector('.dxp-slot-lbl')?.textContent || ''));
      return !!row && /Jordan/.test(row.querySelector('.dxp-slot-user')?.textContent || '');
    }));
    ok('8.5 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS PASSENT ✓' : failures + ' TEST(S) EN ÉCHEC ✗'));
  process.exit(failures === 0 ? 0 : 1);
})();
