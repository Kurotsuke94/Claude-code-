// Tests — Interventions : refonte du suivi par couleurs + correction du
// bug "intervention sans date invisible".
//
// BUG CORRIGÉ : le listener principal de interventions.js triait les
// interventions par .orderBy('startDate','desc') — Firestore EXCLUT
// silencieusement de orderBy() tout document où le champ trié est absent.
// Une intervention non planifiée (startDate absent par design, voir la
// phase précédente "planification optionnelle") n'atteignait donc jamais
// _interventions, et disparaissait de toute la liste Gestion/Calendrier qui
// en dépend. Fix : trier par 'createdAt' (toujours présent).
//
// NOUVEAU SYSTÈME DE STATUTS (4 couleurs) :
//   ROUGE  a_prendre_en_charge — état initial de toute nouvelle intervention
//   JAUNE  en_pause            — motif facultatif, conservé et consultable
//   VERT   en_cours            — aucun chronomètre, aucune durée
//   BLEU   terminee            — aucune date de fin obligatoire
// Le retard ("en_retard") n'est PLUS un statut : _isLate(iv) est une info
// calculée, jamais écrite en base, jamais confondue avec l'avancement réel.
// Compat : les anciens statuts (planifiee/affectee/en_retard) retombent sur
// ROUGE via _effStatus() — aucune migration destructive, aucun champ perdu.
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
async function mainHtml(page) { return page.evaluate(() => document.getElementById('main-content').innerHTML); }
async function modalHtml(page) { return page.evaluate(() => document.getElementById('m-body').innerHTML); }
async function noHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}
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
async function getIntervention(page, id) {
  return evalPage(page, async (id) => {
    const d = await window.__mockDb.collection('interventions').doc(id).get();
    return d.exists ? { id, ...d.data() } : null;
  }, id);
}
async function seedIntervention(page, data) {
  return evalPage(page, async (d) => {
    const ref = await window.__mockDb.collection('interventions').add(d);
    return ref.id;
  }, data);
}
async function gotoGestion(page) {
  await evalPage(page, () => MX.showPage('interventions'));
  await page.waitForTimeout(250);
}
async function clickCardAction(page, title, labelSubstr) {
  return evalPage(page, (opts) => {
    const cards = Array.from(document.querySelectorAll('.int-card'));
    const card = cards.find(c => c.querySelector('.int-card-title')?.textContent === opts.title);
    if (!card) return false;
    const btn = Array.from(card.querySelectorAll('.int-act-btn')).find(b => b.textContent.includes(opts.labelSubstr));
    if (!btn) return false;
    btn.click();
    return true;
  }, { title, labelSubstr });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ── 1/2. Création d'une intervention sans date + visibilité immédiate (LE BUG) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await fillTitle(page, 'Fuite robinet sans date');
    await clickConfirm(page);
    const iv = await lastIntervention(page);
    ok('1.1 Intervention sans date créée', !!iv && !('startDate' in iv));
    await gotoGestion(page);
    const html = await mainHtml(page);
    ok('2.1 BUG CORRIGÉ : l\'intervention sans date apparaît immédiatement dans la liste', html.includes('Fuite robinet sans date'));
    ok('2.2 "Aucune date planifiée" affiché (pas un espace vide)', html.includes('Aucune date planifiée'));
    await ctx.close();
  }

  // ── 3. Présence dans la vue du technicien affecté (Mes Missions) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await fillTitle(page, 'Intervention pour Kevin');
    await toggleTechByName(page, 'Kevin');
    await clickConfirm(page);
    await evalPage(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(300);
    // Reconnexion en Kevin pour voir sa propre vue Mes Missions
    await evalPage(page, () => { MX.Auth.clearCurrentUser(); MX.Auth.selectUser('kevin'); });
    await page.waitForTimeout(100);
    await evalPage(page, () => { document.getElementById('pin-input').value = '1111'; });
    await evalPage(page, async () => { await MX.Auth.confirmPin(); });
    await page.waitForTimeout(300);
    await evalPage(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(400);
    const html = await mainHtml(page);
    ok('3.1 L\'intervention sans date est visible dans Mes Missions (Kevin)', html.includes('Intervention pour Kevin'));
    await ctx.close();
  }

  // ── 4/5. Création d'une intervention planifiée + statut rouge initial ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await openNewInt(page);
    await fillTitle(page, 'Intervention planifiée rouge');
    await evalPage(page, () => {
      const cb = document.getElementById('int-f-sched');
      cb.checked = true;
      MX.Pages.Int._toggleSched(cb);
      document.getElementById('int-f-sd').value = '2026-10-20';
      document.getElementById('int-f-st').value = '09:00';
    });
    await clickConfirm(page);
    const iv = await lastIntervention(page);
    ok('4.1 Intervention planifiée créée', !!iv && iv.startDate === '2026-10-20');
    ok('5.1 Statut rouge initial (a_prendre_en_charge) même planifiée', iv.status === 'a_prendre_en_charge');
    await ctx.close();
  }

  // ── 5(bis)/6/7/8/9/10/11. Cycle complet des 4 couleurs sur une intervention sans date ──
  let cycleId;
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    cycleId = await seedIntervention(page, {
      title: 'Cycle couleurs', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    let iv = await getIntervention(page, cycleId);
    ok('5.2 Statut rouge confirmé avant toute action', iv.status === 'a_prendre_en_charge');

    // 6. Rouge → Vert (Démarrer / Prendre en charge)
    await gotoGestion(page);
    await clickCardAction(page, 'Cycle couleurs', 'Prendre en charge');
    await page.waitForTimeout(100);
    await clickConfirm(page);
    iv = await getIntervention(page, cycleId);
    ok('6.1 Passage du rouge au vert (en_cours) au démarrage', iv.status === 'en_cours');

    // 7/8. Vert → Jaune (Mettre en pause) + motif enregistré
    await gotoGestion(page);
    await clickCardAction(page, 'Cycle couleurs', 'Mettre en pause');
    await page.waitForTimeout(100);
    await evalPage(page, () => { document.getElementById('int-pause-reason').value = 'Pièce en attente de livraison'; });
    await clickConfirm(page);
    iv = await getIntervention(page, cycleId);
    ok('7.1 Passage du vert au jaune (en_pause) lors de la mise en pause', iv.status === 'en_pause');
    ok('8.1 Motif de pause enregistré en base', iv.pauseReason === 'Pièce en attente de livraison');
    await gotoGestion(page);
    await evalPage(page, (id) => MX.Pages.Int._viewInt(id), cycleId);
    await page.waitForTimeout(100);
    const viewHtml = await modalHtml(page);
    ok('8.2 Motif de pause affiché et consultable dans le détail', viewHtml.includes('Pièce en attente de livraison'));
    await evalPage(page, () => MX.closeModal());

    // 9. Jaune → Vert (Reprendre)
    await gotoGestion(page);
    await clickCardAction(page, 'Cycle couleurs', 'Reprendre');
    await page.waitForTimeout(100);
    await clickConfirm(page);
    iv = await getIntervention(page, cycleId);
    ok('9.1 Retour du jaune au vert (en_cours) lors de la reprise', iv.status === 'en_cours');
    ok('9.2 Le motif de pause reste conservé (consultable) après reprise', iv.pauseReason === 'Pièce en attente de livraison');

    // 10/11. Vert → Bleu (Terminer), sans chronomètre ni date de fin obligatoire
    await gotoGestion(page);
    await clickCardAction(page, 'Cycle couleurs', 'Terminer');
    await page.waitForTimeout(100);
    // Ne remplit NI le rapport NI le temps passé — tous deux facultatifs.
    await clickConfirm(page);
    iv = await getIntervention(page, cycleId);
    ok('10.1 Passage au bleu (terminee) lors de la terminaison', iv.status === 'terminee');
    ok('11.1 Terminaison réussie sans temps passé renseigné (aucune durée obligatoire)', iv.timeSpentMin === null || iv.timeSpentMin === undefined);
    ok('11.2 Aucune date de fin (endDate) exigée pour terminer', !('endDate' in iv) || iv.endDate === undefined);

    // ── 12. Persistance (relecture Firestore directe, hors variable JS mémorisée) ──
    // Note harnais : chaque browser.newContext() a son propre mock Firestore isolé
    // (pas de persistance cross-contexte, et page.reload() recrée aussi un mock vierge).
    // La vérification la plus honnête que ce harnais permette est donc une relecture
    // Firestore directe (getIntervention, pas une variable JS en cache) dans la MÊME session,
    // après la séquence complète de transitions.
    const ivReread = await getIntervention(page, cycleId);
    ok('12.1 Statut "terminee" persiste en base (relecture Firestore, pas une variable mémorisée)', !!ivReread && ivReread.status === 'terminee');
    ok('12.2 Motif de pause toujours présent en base après le cycle complet', ivReread.pauseReason === 'Pièce en attente de livraison');

    await ctx.close();
  }

  // ── 13. Synchronisation entre plusieurs utilisateurs (même session, 2 identités) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const syncId = await seedIntervention(page, {
      title: 'Sync multi-utilisateurs', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    // Sophie (responsable) met en pause
    await gotoGestion(page);
    await clickCardAction(page, 'Sync multi-utilisateurs', 'Prendre en charge');
    await page.waitForTimeout(100);
    await clickConfirm(page);
    // Kevin (technicien assigné) se connecte sur la MÊME page/mock et doit
    // voir le changement de Sophie sans action de sa part (listener temps réel).
    await evalPage(page, () => { MX.Auth.clearCurrentUser(); MX.Auth.selectUser('kevin'); });
    await page.waitForTimeout(100);
    await evalPage(page, () => { document.getElementById('pin-input').value = '1111'; });
    await evalPage(page, async () => { await MX.Auth.confirmPin(); });
    await page.waitForTimeout(300);
    await gotoGestion(page);
    const html = await mainHtml(page);
    ok('13.1 Kevin voit le statut "En cours" défini par Sophie (synchronisation temps réel)', html.includes('Sync multi-utilisateurs') && /En cours/.test(html));
    await ctx.close();
  }

  // ── 14. Conservation des affectations multiples à travers les transitions ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const multiId = await seedIntervention(page, {
      title: 'Multi techs', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: ['Kevin', 'Jordan', 'Dorian'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    await clickCardAction(page, 'Multi techs', 'Prendre en charge');
    await page.waitForTimeout(100);
    await clickConfirm(page);
    let iv = await getIntervention(page, multiId);
    ok('14.1 Affectations multiples conservées après Prendre en charge', Array.isArray(iv.assignedTo) && iv.assignedTo.length === 3);
    await gotoGestion(page);
    await clickCardAction(page, 'Multi techs', 'Terminer');
    await page.waitForTimeout(100);
    await clickConfirm(page);
    iv = await getIntervention(page, multiId);
    ok('14.2 Affectations multiples conservées après Terminer', Array.isArray(iv.assignedTo) && iv.assignedTo.length === 3 && ['Kevin','Jordan','Dorian'].every(n => iv.assignedTo.includes(n)));
    await ctx.close();
  }

  // ── 15. Compatibilité avec les anciennes interventions (statuts legacy) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const legacyPlanifiee = await seedIntervention(page, {
      title: 'Ancienne planifiee', priority: 'normale', status: 'planifiee',
      startDate: '2026-09-20', startTime: '08:00', endDate: '2026-09-20', endTime: '09:00',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    const legacyRetard = await seedIntervention(page, {
      title: 'Ancienne en_retard', priority: 'normale', status: 'en_retard',
      startDate: '2026-09-01', startTime: '08:00', endDate: '2026-09-01', endTime: '09:00',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    const html = await mainHtml(page);
    ok('15.1 Ancienne intervention "planifiee" visible', html.includes('Ancienne planifiee'));
    ok('15.2 Ancienne intervention "en_retard" visible', html.includes('Ancienne en_retard'));
    ok('15.3 Ancienne intervention "en_retard" affichée comme ROUGE (à prendre en charge), jamais reclassée "terminée"', !/Ancienne en_retard[\s\S]{0,300}Terminée/.test(html));
    // Les deux peuvent démarrer normalement malgré leur ancien statut brut.
    const started = await clickCardAction(page, 'Ancienne planifiee', 'Prendre en charge');
    ok('15.4 Bouton "Prendre en charge" disponible sur une ancienne intervention', started);
    await page.waitForTimeout(100);
    await clickConfirm(page);
    const iv = await getIntervention(page, legacyPlanifiee);
    ok('15.5 Transition réussie depuis un ancien statut legacy', iv.status === 'en_cours');
    await ctx.close();
  }

  // ── 15bis. Rendu des 6 cas historiques demandés explicitement : planifiee,
  // affectee, en_retard, en_cours, terminee, et sans statut du tout ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, { title: 'Legacy affectee', priority: 'normale', status: 'affectee', assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'Legacy en_cours', priority: 'normale', status: 'en_cours', assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'Legacy terminee', priority: 'normale', status: 'terminee', assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'Legacy sans statut', priority: 'normale', assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'Legacy en_retard ambigu', priority: 'normale', status: 'en_retard', assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await gotoGestion(page);
    await page.waitForTimeout(200);

    const badgeOf = title => evalPage(page, (t) => {
      const cards = Array.from(document.querySelectorAll('.int-card'));
      const card = cards.find(c => c.querySelector('.int-card-title')?.textContent === t);
      return card ? card.querySelector('.int-badge').textContent.trim() : null;
    }, title);
    const hasLegacyBadge = title => evalPage(page, (t) => {
      const cards = Array.from(document.querySelectorAll('.int-card'));
      const card = cards.find(c => c.querySelector('.int-card-title')?.textContent === t);
      return !!(card && card.querySelector('.int-badge--legacy'));
    }, title);

    ok('15bis.1 "affectee" (jamais démarrée) -> ROUGE "À prendre en charge"', (await badgeOf('Legacy affectee')) === 'À prendre en charge');
    ok('15bis.2 "en_cours" (déjà démarrée) -> VERT "En cours", JAMAIS rouge à tort', (await badgeOf('Legacy en_cours')) === 'En cours');
    ok('15bis.3 "terminee" -> reste BLEU "Terminée"', (await badgeOf('Legacy terminee')) === 'Terminée');
    ok('15bis.4 Sans aucun champ status -> ROUGE "À prendre en charge" par défaut', (await badgeOf('Legacy sans statut')) === 'À prendre en charge');
    ok('15bis.5 "en_retard" (ambigu, cf rapport) -> ROUGE "À prendre en charge"', (await badgeOf('Legacy en_retard ambigu')) === 'À prendre en charge');
    ok('15bis.6 "en_retard" porte le marqueur "progression d\'origine inconnue" (transparence, ne prétend pas savoir)', await hasLegacyBadge('Legacy en_retard ambigu'));
    ok('15bis.7 "en_cours" ne porte PAS ce marqueur (son état est connu avec certitude)', !(await hasLegacyBadge('Legacy en_cours')));
    ok('15bis.8 "affectee" ne porte PAS ce marqueur (jamais démarrée, sans ambiguïté)', !(await hasLegacyBadge('Legacy affectee')));
    ok('15bis.9 "terminee" ne porte PAS ce marqueur', !(await hasLegacyBadge('Legacy terminee')));
    await ctx.close();
  }
  // Note (voir rapport final §3) : le mock Firestore de ce harnais (mock-firebase.js)
  // ne reproduit pas l'exclusion silencieuse d'un orderBy() sur un champ absent — il
  // trie "undefined" au lieu d'exclure le document. Une vérification ponctuelle avec
  // un mock corrigé temporairement (exclusion stricte, comme le vrai Firestore) a
  // confirmé qu'un document sans AUCUN champ createdAt serait, comme startDate avant
  // lui, exclu de la liste. Aucun code de création de ce dépôt (interventions.js
  // _newInt(), et les 6 points d'écriture de pmp.js) n'omet createdAt — ce n'est donc
  // pas une régression introduite ici, mais une limite résiduelle théorique à garder
  // en tête pour d'éventuelles données très anciennes créées hors de l'app.

  // ── 16. Absence de faux retard pour une intervention sans date ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, {
      title: 'Immédiate jamais en retard', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    const html = await mainHtml(page);
    // Adapté : la refonte graphique a inséré "Créée le …" + le menu "···"
    // entre le titre et les badges, élargissant la fenêtre texte-à-texte
    // attendue (mesuré : ~510 caractères) — le sens du test est inchangé.
    ok('16.1 Aucun badge "En retard" sur une intervention sans date', !/Immédiate jamais en retard[\s\S]{0,600}En retard/.test(html));
    ok('16.2 Toujours affichée comme ROUGE (à prendre en charge), pas de faux retard', /Immédiate jamais en retard[\s\S]{0,600}À prendre en charge/.test(html));
    await ctx.close();
  }

  // ── 17. Absence de régression du calendrier ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const today = new Date().toISOString().slice(0, 10);
    await seedIntervention(page, {
      title: 'Planifiée aujourd\'hui', priority: 'normale', status: 'a_prendre_en_charge',
      startDate: today, startTime: '09:00', endDate: today, endTime: '10:00',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await seedIntervention(page, {
      title: 'Jamais au calendrier (sans date)', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    await evalPage(page, () => { MX.Pages.Int._tab('calendrier'); });
    await page.waitForTimeout(300);
    const html = await mainHtml(page);
    ok('17.1 Le calendrier affiche bien l\'intervention planifiée du jour', html.includes('Planifiée aujourd\'hui'));
    ok('17.2 Le calendrier n\'affiche PAS l\'intervention sans date (jamais ajoutée artificiellement)', !html.includes('Jamais au calendrier'));
    await ctx.close();
  }

  // ── 18. Absence de régression dans Mes Missions (déjà couvert en #3, vérification complémentaire : aucune erreur JS) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    await evalPage(page, () => MX.showPage('mes-missions'));
    await page.waitForTimeout(400);
    ok('18.1 Aucune erreur JS sur Mes Missions après la refonte des statuts', errs.length === 0);
    await ctx.close();
  }

  // ── 18bis. Notifications : urgence (ROUGE) et retard (calculé, jamais un statut) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');

    const urgentId = await seedIntervention(page, {
      title: 'Fuite urgente chambre 12', priority: 'urgente', status: 'a_prendre_en_charge',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page); // force (re)montage du listener _load() -> _sendIntNotifs
    await page.waitForTimeout(300);
    const urgentNotif = await evalPage(page, async (id) => {
      const snap = await window.__mockDb.collection('notifications').doc('int_urgent_' + id).get();
      return snap.exists ? snap.data() : null;
    }, urgentId);
    ok('18bis.1 Notification créée pour une intervention urgente ROUGE', !!urgentNotif && urgentNotif.title.includes('urgente'));
    ok('18bis.2 Notification urgente adressée au technicien affecté', urgentNotif && urgentNotif.userId === 'Kevin');

    const pastDate = '2020-01-01';
    const lateId = await seedIntervention(page, {
      title: 'Climatisation en panne depuis longtemps', priority: 'normale', status: 'en_cours',
      startDate: pastDate, startTime: '08:00', endDate: pastDate, endTime: '09:00',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    await page.waitForTimeout(300);
    const lateNotif = await evalPage(page, async (id) => {
      const snap = await window.__mockDb.collection('notifications').doc('int_retard_' + id).get();
      return snap.exists ? snap.data() : null;
    }, lateId);
    ok('18bis.3 Notification "en retard" créée pour une intervention dont endDate est dépassée', !!lateNotif && lateNotif.title.includes('retard'));
    const ivLate = await getIntervention(page, lateId);
    ok('18bis.4 Le statut métier reste "en_cours" (le retard ne devient jamais un statut)', ivLate.status === 'en_cours');

    // Négatif : une intervention sans date ne doit JAMAIS générer de notification de retard.
    const unplannedId = await seedIntervention(page, {
      title: 'Sans date, ne doit jamais notifier de retard', priority: 'normale', status: 'en_cours',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    await page.waitForTimeout(300);
    const noLateNotif = await evalPage(page, async (id) => {
      const snap = await window.__mockDb.collection('notifications').doc('int_retard_' + id).get();
      return snap.exists;
    }, unplannedId);
    ok('18bis.5 Aucune notification de retard pour une intervention sans date', !noLateNotif);
    await ctx.close();
  }

  // ── 18ter. Compteurs d'en-tête et filtres (correspondent aux données réellement chargées) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, { title: 'KPI Rouge', priority: 'normale', status: 'a_prendre_en_charge', assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'KPI Jaune', priority: 'normale', status: 'en_pause', pauseReason: 'Pièce', assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'KPI Vert', priority: 'normale', status: 'en_cours', assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'KPI Bleu', priority: 'normale', status: 'terminee', assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await gotoGestion(page);
    await page.waitForTimeout(200);
    const kpis = await evalPage(page, () => Array.from(document.querySelectorAll('.int-kpi-val')).map(e => e.textContent.trim()));
    ok('18ter.1 Compteur Total = 4 (les 4 interventions seedées)', kpis[0] === '4');
    ok('18ter.2 Compteur "À prendre en charge" = 1', kpis[1] === '1');
    ok('18ter.3 Compteur "En attente" (en_pause) = 1', kpis[2] === '1');
    ok('18ter.4 Compteur "En cours" = 1', kpis[3] === '1');
    ok('18ter.5 Compteur "Terminées" = 1', kpis[4] === '1');

    // Filtre pill "En attente" → seule la carte jaune doit rester affichée.
    await evalPage(page, () => MX.Pages.Int._setGestionFilter('en_pause'));
    await page.waitForTimeout(150);
    const filteredTitles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('18ter.6 Filtre "En attente" ne montre que la carte en_pause', filteredTitles.length === 1 && filteredTitles[0] === 'KPI Jaune');

    await evalPage(page, () => MX.Pages.Int._setGestionFilter(''));
    await page.waitForTimeout(150);
    const allTitles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('18ter.7 Filtre "Toutes" réaffiche les 4 cartes', allTitles.length === 4);
    await ctx.close();
  }

  // ── 19. Fonctionnement sur mobile ──
  for (const w of [375, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, {
      title: 'Mobile test', priority: 'normale', status: 'en_cours',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    const noScroll = await noHorizScroll(page);
    ok(w + 'px — pas de débordement horizontal (liste Gestion)', noScroll);
    const btnSizesOk = await evalPage(page, () => {
      const btns = Array.from(document.querySelectorAll('.int-act-btn'));
      return btns.every(b => b.getBoundingClientRect().height >= 28);
    });
    ok(w + 'px — boutons d\'action suffisamment grands', btnSizesOk);
    await ctx.close();
  }

  // ── 20. Respect des permissions existantes ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, {
      title: 'Pour Kevin seulement', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await seedIntervention(page, {
      title: 'Pour Jordan seulement', priority: 'normale', status: 'a_prendre_en_charge',
      assignedTo: ['Jordan'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await evalPage(page, () => { MX.Auth.clearCurrentUser(); MX.Auth.selectUser('kevin'); });
    await page.waitForTimeout(100);
    await evalPage(page, () => { document.getElementById('pin-input').value = '1111'; });
    await evalPage(page, async () => { await MX.Auth.confirmPin(); });
    await page.waitForTimeout(300);
    await gotoGestion(page);
    const html = await mainHtml(page);
    ok('20.1 Un technicien ne voit que les interventions qui lui sont affectées', html.includes('Pour Kevin seulement') && !html.includes('Pour Jordan seulement'));
    ok('20.2 Aucun bouton Modifier/Annuler/Supprimer pour un technicien (permissions admin inchangées)', !html.includes('fa-pen') && !html.includes('fa-trash'));
    await ctx.close();
  }

  // Note (refonte graphique, voir rapport final) : _tGestion() distingue
  // désormais explicitement "chargement en cours" de "chargement confirmé,
  // liste vide" (if (!_ready) return <état de chargement>), pour ne jamais
  // afficher "Aucune intervention" avant que Firestore ait réellement
  // répondu. Vérifié par relecture du code (_tGestion(), interventions.js) ;
  // non testable de façon fiable dans ce harnais : l'application appelle
  // déjà MX.showPage() pendant son propre amorçage (avant même la saisie du
  // PIN), donc _load() et le setTimeout(0) du mock Firestore se résolvent
  // systématiquement avant que ce script externe ne puisse revérifier l'état
  // — la fenêtre réelle ne dure qu'un seul tick JS, trop courte pour être
  // capturée de façon déterministe via les API de page/connexion exposées.

  // ── 22. Refonte graphique : recherche, tri, filtres, bouton "+" ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await seedIntervention(page, { title: 'Fuite évier cuisine', priority: 'urgente', status: 'a_prendre_en_charge', location: 'Cuisine', assignedTo: ['Kevin'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await seedIntervention(page, { title: 'Peinture hall', priority: 'basse', status: 'a_prendre_en_charge', location: 'Hall', assignedTo: ['Jordan'], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' } });
    await gotoGestion(page);
    await page.waitForTimeout(200);

    // 22.1/22.2 — Recherche (titre, puis localisation)
    await evalPage(page, () => { const i = document.getElementById('int-f-search'); i.value = 'évier'; i.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(150);
    let titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.1 Recherche par titre filtre correctement', titles.length === 1 && titles[0] === 'Fuite évier cuisine');
    await evalPage(page, () => { const i = document.getElementById('int-f-search'); i.value = 'Hall'; i.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(150);
    titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.2 Recherche par localisation filtre correctement', titles.length === 1 && titles[0] === 'Peinture hall');
    // Effacer via le bouton X
    await evalPage(page, () => MX.Pages.Int._setFilter('search', ''));
    await page.waitForTimeout(150);
    titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.3 Recherche effacée : les deux cartes réapparaissent', titles.length === 2);

    // 22.4 — Filtre technicien
    await evalPage(page, () => { const s = document.querySelector('.int-toolbar-filters select'); s.value = 'Jordan'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(150);
    titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.4 Filtre technicien fonctionne', titles.length === 1 && titles[0] === 'Peinture hall');
    await evalPage(page, () => MX.Pages.Int._setFilter('tech', ''));
    await page.waitForTimeout(150);

    // 22.5 — Filtre priorité
    await evalPage(page, () => MX.Pages.Int._setFilter('prio', 'urgente'));
    await page.waitForTimeout(150);
    titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.5 Filtre priorité fonctionne', titles.length === 1 && titles[0] === 'Fuite évier cuisine');
    await evalPage(page, () => MX.Pages.Int._setFilter('prio', ''));
    await page.waitForTimeout(150);

    // 22.6 — Tri par priorité (urgente avant basse)
    await evalPage(page, () => MX.Pages.Int._setFilter('sort', 'priorite'));
    await page.waitForTimeout(150);
    titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.6 Tri "Priorité" place l\'urgente en premier', titles[0] === 'Fuite évier cuisine');
    await evalPage(page, () => MX.Pages.Int._setFilter('sort', 'ancien'));
    await page.waitForTimeout(150);
    titles = await evalPage(page, () => Array.from(document.querySelectorAll('.int-card-title')).map(e => e.textContent));
    ok('22.7 Tri "Plus anciennes" inverse l\'ordre (la première créée apparaît en premier)', titles[0] === 'Fuite évier cuisine');
    await evalPage(page, () => MX.Pages.Int._setFilter('sort', 'recent'));

    // 22.8 — Bouton flottant "+" ouvre bien le formulaire (clic réel sur l'élément)
    await page.click('#int-fab');
    await page.waitForTimeout(200);
    const formOpen = await evalPage(page, () => !!document.getElementById('int-f-title'));
    ok('22.8 Le bouton flottant "+" ouvre le formulaire de création', formOpen);
    await evalPage(page, () => MX.closeModal());
    await ctx.close();
  }

  // ── 23. Zone photo modernisée : ajout, aperçu, retrait explicite ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const id = await seedIntervention(page, {
      title: 'Avec photo', priority: 'normale', status: 'a_prendre_en_charge',
      photo: PNG, assignedTo: [], createdBy: 'Sophie', createdAt: { __sv: 'timestamp' },
    });
    await gotoGestion(page);
    await evalPage(page, (id) => MX.Pages.Int._editInt(id), id);
    await page.waitForTimeout(200);
    let state = await evalPage(page, () => ({
      wrapVisible: document.getElementById('int-ph-wrap').style.display !== 'none',
      pickerVisible: document.getElementById('int-ph-picker').style.display !== 'none',
      src: document.getElementById('int-ph-prev').src,
    }));
    ok('23.1 Photo existante : aperçu affiché (pas le bouton de sélection)', state.wrapVisible && !state.pickerVisible);
    ok('23.2 Aperçu affiche bien la photo enregistrée', state.src.startsWith('data:image/png'));

    // Retrait explicite
    await evalPage(page, () => MX.Pages.Int._removeIntPhoto());
    await page.waitForTimeout(100);
    state = await evalPage(page, () => ({
      wrapVisible: document.getElementById('int-ph-wrap').style.display !== 'none',
      pickerVisible: document.getElementById('int-ph-picker').style.display !== 'none',
    }));
    ok('23.3 Retrait : le sélecteur réapparaît, l\'aperçu disparaît', !state.wrapVisible && state.pickerVisible);
    await page.click('.modal-actions .modal-btn.confirm');
    await page.waitForTimeout(150);
    const doc = await getIntervention(page, id);
    ok('23.4 Retrait confirmé : photo bien écrite à null en base (pas juste visuel)', doc.photo === null);

    // Nouvelle intervention : pas de photo par défaut, le sélecteur est visible
    await gotoGestion(page);
    await evalPage(page, () => MX.Pages.Int._newInt());
    await page.waitForTimeout(150);
    const freshState = await evalPage(page, () => ({
      wrapVisible: document.getElementById('int-ph-wrap').style.display !== 'none',
      pickerVisible: document.getElementById('int-ph-picker').style.display !== 'none',
    }));
    ok('23.5 Nouvelle intervention : sélecteur de photo visible par défaut, aucun aperçu fantôme', !freshState.wrapVisible && freshState.pickerVisible);
    await evalPage(page, () => MX.closeModal());
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' test(s) EN ÉCHEC.' : '\nTOUS LES TESTS PASSENT ✓');
  process.exit(failures ? 1 : 0);
})();
