// Tests pour la refonte "Organisation Responsable" (assets/js/pages/org-resp.js
// + assets/css/components.css) — grille hebdomadaire sans créneaux horaires,
// priorité à 3 niveaux (rouge/vert/bleu, jamais de gris), affectation
// multi-techniciens, récurrence hebdomadaire/mensuelle déterministe (sans
// doublon), glisser-déposer jour à jour, et surtout la correction du bug de
// disparition des tâches : toute tâche créée depuis le planning DOIT avoir un
// jour valide avant écriture, sinon le formulaire reste ouvert (noAutoClose)
// et un message d'erreur est montré — jamais de création silencieuse d'une
// tâche invisible (dayId: null).
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE   = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (180s) — le process est arrêté de force.');
  process.exit(1);
}, 180000);

// Référence indépendante de l'algorithme "Nième jour-de-semaine du mois" (même
// formule que _nthWeekdayOfMonth dans org-resp.js) — utilisée uniquement
// comme oracle de test pour savoir QUAND naviguer, jamais importée du code
// applicatif.
function nthWeekdayOfMonthRef(year, monthIdx, weekdayJs, nth) {
  const first = new Date(year, monthIdx, 1);
  const diff  = (weekdayJs - first.getDay() + 7) % 7;
  const date  = 1 + diff + (nth - 1) * 7;
  const d     = new Date(year, monthIdx, date);
  return d.getMonth() === monthIdx ? d : null;
}
function mondayOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0=lundi
  x.setDate(x.getDate() - day);
  x.setHours(0,0,0,0);
  return x;
}

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

// Le bandeau de nouvelle version (#ver-modal-overlay) peut réapparaître à tout
// moment (vérification périodique) et intercepte alors les clics — on le
// retire systématiquement juste avant chaque clic, comme le fait déjà
// navigation_visibility_test.js (clickSafe/dismissOverlay).
async function dismissOverlay(page) { await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); }); }
async function clickSafe(page, selector) {
  await dismissOverlay(page);
  await page.click(selector, { force: true });
  // Laisse le temps au gestionnaire onchange/onclick (toggle de classe,
  // affichage conditionnel) de s'appliquer avant le clic suivant — ce bac à
  // sable de test peut être sous charge CPU variable.
  await page.waitForTimeout(80);
}

async function openOrgResp(page) {
  await page.evaluate(() => { MX.showPage('org-resp'); });
  await page.waitForTimeout(350);
  await dismissOverlay(page);
}

async function openHeaderNewTask(page) {
  await clickSafe(page, '.or-cp-ab-btn--primary');
  await page.waitForTimeout(150);
}

async function fillForm(page, opts) {
  if (opts.title !== undefined) await page.fill('#or-f-title', opts.title);
  if (opts.desc) await page.fill('#or-f-desc', opts.desc);
  if (opts.priorityLabel) await clickSafe(page, `#m-body .or-prio-pill:has-text("${opts.priorityLabel}")`);

  // Le sélecteur de jour (.or-daypick-btn) est à bascule : en mode récurrence
  // hebdomadaire (multi-sélection), il ne faut cliquer chaque jour qu'UNE
  // fois (recurDays inclut déjà le jour d'ancrage), sinon un second clic sur
  // le même bouton le désélectionne (comportement correct de l'appli — c'est
  // l'appel du test qu'il faut ordonner correctement).
  if (opts.recurrence === 'weekly') {
    await clickSafe(page, '#m-body .or-recur-pill[data-val="weekly"]');
    const days = (opts.recurDays && opts.recurDays.length) ? opts.recurDays : (opts.day ? [opts.day] : []);
    for (const d of days) await clickSafe(page, `#m-body .or-daypick-btn[data-day="${d}"]`);
  } else if (opts.recurrence === 'monthly') {
    if (opts.day) await clickSafe(page, `#m-body .or-daypick-btn[data-day="${opts.day}"]`);
    await clickSafe(page, '#m-body .or-recur-pill[data-val="monthly"]');
    if (opts.monthlyNth) await page.selectOption('#or-f-monthly-nth', opts.monthlyNth);
  } else if (opts.recurrence === 'daily') {
    if (opts.day) await clickSafe(page, `#m-body .or-daypick-btn[data-day="${opts.day}"]`);
    await clickSafe(page, '#m-body .or-recur-pill[data-val="daily"]');
  } else {
    if (opts.day) await clickSafe(page, `#m-body .or-daypick-btn[data-day="${opts.day}"]`);
  }

  if (opts.techs) {
    for (const name of opts.techs) await page.selectOption('#or-f-tech-select', { label: name });
  }
}
async function waitUntil(page, predicate, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
async function submitPrimary(page) {
  await clickSafe(page, '#m-actions .primary-btn');
  // Le modal se ferme via noAutoClose + MX.closeModal() manuel après écriture
  // Firestore réussie (async) : on attend l'état stable (fermé OU toast
  // d'erreur affiché) plutôt qu'un délai fixe, pour ne pas dépendre de la
  // charge machine du bac à sable de test.
  await waitUntil(page, () => page.evaluate(() => {
    const open = document.getElementById('modal-bg').classList.contains('show');
    const err  = document.getElementById('toast').className.includes('err');
    return !open || err;
  }), 8000);
  await page.waitForTimeout(150);
}
async function modalIsOpen(page) { return page.evaluate(() => document.getElementById('modal-bg').classList.contains('show')); }
async function toastInfo(page) {
  return page.evaluate(() => {
    const t = document.getElementById('toast');
    return { text: t.textContent, isErr: t.className.includes('err'), shown: t.className.includes('show') };
  });
}
async function dayCardTitles(page, dayId) {
  return page.evaluate((d) => Array.from(document.querySelectorAll('#or-daycol-' + d + ' .or-tc-title')).map(e => e.textContent.trim()), dayId);
}
async function allOrgTasks(page) {
  return page.evaluate(async () => {
    const snap = await window.__mockDb.collection('org_tasks').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => { ctx.route('**://*.googleapis.com/**', r => r.abort()); ctx.route('**://*.gstatic.com/**', r => r.abort()); };
  const newCtx = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1400, height: 900 } });
    await routeBlock(ctx);
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };

  // ── 1. Permission : un technicien ne doit PAS voir le module ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'kevin', '1111');
    await openOrgResp(page);
    const gated = await page.evaluate(() => {
      const mc = document.getElementById('main-content');
      return mc && mc.textContent.includes('Accès réservé');
    });
    const hasGrid = await page.locator('.or-day-col').count();
    ok('1.1 Technicien : accès refusé ("Accès réservé")', gated);
    ok('1.2 Technicien : aucune colonne de planning rendue', hasGrid === 0);
    ok('1.3 Aucune erreur JS', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 2. Responsable : accès OK, grille 7 jours, titre correct ──
  let weekKeyRef = null;
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    const title = await page.evaluate(() => document.querySelector('.or-cp-title')?.textContent || '');
    const cols  = await page.locator('.or-day-col').count();
    ok('2.1 Responsable : accès autorisé', !(await page.evaluate(() => document.getElementById('main-content').textContent.includes('Accès réservé'))));
    ok('2.2 Titre de module = "Organisation Responsable"', title.trim() === 'Organisation Responsable');
    ok('2.3 Grille = 7 colonnes (une par jour)', cols === 7);
    ok('2.4 Légende priorités visible (3 cartes + compteur)', await page.locator('.or-prio-legend-card').count() === 4);
    ok('2.5 Aucune erreur JS au chargement', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 3. BUG FIX : création sans jour → refusée, formulaire reste ouvert ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, { title: 'Tâche sans jour' });
    await submitPrimary(page);
    const stillOpen = await modalIsOpen(page);
    const toast = await toastInfo(page);
    const tasks = await allOrgTasks(page);
    const created = tasks.find(t => t.title === 'Tâche sans jour');
    ok('3.1 Le formulaire reste ouvert (pas de fermeture silencieuse)', stillOpen);
    ok('3.2 Un message d\'erreur explicite est affiché', toast.isErr && /jour/i.test(toast.text));
    ok('3.3 Aucun document Firestore créé sans jour valide', !created);
    // On complète le jour et on confirme que la création aboutit normalement.
    await clickSafe(page, '#m-body .or-daypick-btn[data-day="mercredi"]');
    await submitPrimary(page);
    const closedNow = await modalIsOpen(page);
    const titles = await dayCardTitles(page, 'mercredi');
    ok('3.4 Une fois le jour choisi, la création réussit et ferme le formulaire', !closedNow);
    ok('3.5 La tâche apparaît immédiatement dans la bonne colonne', titles.includes('Tâche sans jour'));
    ok('3.6 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 4. Priorité (3 niveaux, couleurs), multi-techniciens, persistance ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, {
      title: 'Carnet sanitaire', priorityLabel: 'Basse', day: 'lundi',
      techs: ['Sophie', 'Alban'], // grade Responsable — seuls sélectionnables depuis cette refonte
    });
    await submitPrimary(page);
    await page.waitForTimeout(200);

    const card = page.locator('#or-daycol-lundi .or-tc', { hasText: 'Carnet sanitaire' }).first();
    const style = await card.getAttribute('style');
    const avCount = await card.locator('.or-tc-avs .or-av').count();
    ok('4.1 Priorité basse rendue en BLEU (#3B82F6), jamais en gris', !!style && style.includes('#3B82F6'));
    ok('4.2 Deux techniciens affectés → deux bulles rondes', avCount === 2);

    const tasks = await allOrgTasks(page);
    const doc = tasks.find(t => t.title === 'Carnet sanitaire');
    ok('4.3 priority stockée comme champ métier indépendant', doc && doc.priority === 'basse');
    ok('4.4 assignedTo stocké en tableau (compat multi-techniciens)', Array.isArray(doc.assignedTo) && doc.assignedTo.length === 2);
    weekKeyRef = doc.weekKey;

    // Persistance : on quitte le module (autre page) puis on y revient — ceci
    // force une relecture complète depuis Firestore (nouveaux listeners via
    // _subscribe), ce qui est la preuve de persistance pertinente ici (un vrai
    // page.reload() réinitialiserait le mock Firestore lui-même, en mémoire
    // par page — voir les notes dans mission_move_test.js/interventions_status_colors_test.js).
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
    await openOrgResp(page);
    const titlesAfterReload = await dayCardTitles(page, 'lundi');
    ok('4.5 La tâche persiste après re-sélection du module (relecture Firestore)', titlesAfterReload.includes('Carnet sanitaire'));

    // Navigation semaine suivante puis retour : pas de perte, pas de doublon
    await clickSafe(page, '.or-cp-nav-btn[title="Semaine suivante"]');
    await page.waitForTimeout(250);
    await clickSafe(page, '.or-cp-nav-btn[title="Semaine précédente"]');
    await page.waitForTimeout(250);
    const titlesAfterNav = await dayCardTitles(page, 'lundi');
    ok('4.6 La tâche réapparaît correctement après navigation semaine suivante/précédente', titlesAfterNav.filter(t => t === 'Carnet sanitaire').length === 1);
    ok('4.7 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 5. Compatibilité ascendante : ancienne priorité + ancien format technicien ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    // On récupère la weekKey de la semaine courante en créant une tâche neutre,
    // puis on insère directement un document "ancien format" dans Firestore
    // (simulate une tâche créée avant la refonte).
    await openHeaderNewTask(page);
    await fillForm(page, { title: 'Ancrage semaine', day: 'lundi' });
    await submitPrimary(page);
    const anchor = (await allOrgTasks(page)).find(t => t.title === 'Ancrage semaine');
    const wk = anchor.weekKey;

    await page.evaluate(async (weekKey) => {
      await window.__mockDb.collection('org_tasks').doc('legacy1').set({
        title: 'Vérif compteur gaz', description: '', category: 'autre',
        priority: 'urgente', type: 'unique', dayId: 'vendredi', slot: null,
        assignedTo: 'Kevin', weekKey, done: false, status: 'todo',
        doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
        createdBy: 'Sophie', createdAt: { __sv: 'timestamp' }, order: 99, isDefault: false,
      });
    }, wk);
    await openOrgResp(page); // re-render pour prendre en compte le nouveau doc
    await page.waitForTimeout(300);

    const card = page.locator('#or-daycol-vendredi .or-tc', { hasText: 'Vérif compteur gaz' }).first();
    const style = await card.getAttribute('style');
    const avText = await card.locator('.or-tc-avs .or-av').first().textContent();
    ok('5.1 Ancienne priorité "urgente" affichée comme Haute (rouge #EF4444)', !!style && style.includes('#EF4444'));
    ok('5.2 Ancien format assignedTo (chaîne unique) toujours affiché', (avText || '').trim() === 'K');

    const legacyAfter = (await allOrgTasks(page)).find(t => t.id === 'legacy1');
    ok('5.3 La valeur brute "urgente" n\'est JAMAIS réécrite en base (lecture seule)', legacyAfter.priority === 'urgente');
    ok('5.4 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 6. Récurrence hebdomadaire : pas de doublon, occurrences sur plusieurs semaines ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, {
      title: 'Contrôle registre sécurité', day: 'lundi',
      recurrence: 'weekly', recurDays: ['lundi', 'jeudi'],
    });
    await submitPrimary(page);
    await page.waitForTimeout(250);

    let lundiTitles  = await dayCardTitles(page, 'lundi');
    let jeudiTitles  = await dayCardTitles(page, 'jeudi');
    ok('6.1 Occurrence visible le lundi (ancrage) la semaine de création', lundiTitles.includes('Contrôle registre sécurité'));
    ok('6.2 Occurrence virtuelle visible le jeudi la même semaine', jeudiTitles.includes('Contrôle registre sécurité'));

    // Navigation sur 2 semaines suivantes
    await clickSafe(page, '.or-cp-nav-btn[title="Semaine suivante"]');
    await page.waitForTimeout(250);
    await clickSafe(page, '.or-cp-nav-btn[title="Semaine suivante"]');
    await page.waitForTimeout(250);
    lundiTitles = await dayCardTitles(page, 'lundi');
    jeudiTitles = await dayCardTitles(page, 'jeudi');
    ok('6.3 Occurrence toujours visible 2 semaines plus tard (lundi)', lundiTitles.includes('Contrôle registre sécurité'));
    ok('6.4 Occurrence toujours visible 2 semaines plus tard (jeudi)', jeudiTitles.includes('Contrôle registre sécurité'));

    // Retour à la semaine de création, re-visite plusieurs fois : pas de doublon
    await clickSafe(page, '.or-cp-nav-btn[title="Semaine précédente"]');
    await page.waitForTimeout(200);
    await clickSafe(page, '.or-cp-nav-btn[title="Semaine précédente"]');
    await page.waitForTimeout(200);
    await openOrgResp(page);
    await openOrgResp(page);

    const allDocs = (await allOrgTasks(page)).filter(t => t.title === 'Contrôle registre sécurité');
    ok('6.5 Un seul document Firestore réel pour toute la série (aucun doublon créé par la navigation)', allDocs.length === 1);
    ok('6.6 Le document porte bien recurrence:"weekly" et recurDays', allDocs[0].recurrence === 'weekly' && Array.isArray(allDocs[0].recurDays) && allDocs[0].recurDays.includes('jeudi'));
    ok('6.7 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 7. Glisser-déposer : changement réel de jour, persistance, pas de doublon ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, { title: 'Déplace-moi', day: 'mardi' });
    await submitPrimary(page);
    await page.waitForTimeout(200);

    const cardId = await page.locator('.or-tc', { hasText: 'Déplace-moi' }).first().getAttribute('data-id');
    ok('7.1 La carte est bien présente sous Mardi avant déplacement', (await dayCardTitles(page, 'mardi')).includes('Déplace-moi'));

    await page.dragAndDrop(`.or-tc[data-id="${cardId}"]`, '#or-daycol-mercredi');
    await page.waitForTimeout(400);

    const mardiAfter    = await dayCardTitles(page, 'mardi');
    const mercrediAfter = await dayCardTitles(page, 'mercredi');
    ok('7.2 La tâche a quitté la colonne Mardi après glisser-déposer', !mardiAfter.includes('Déplace-moi'));
    ok('7.3 La tâche apparaît dans la colonne Mercredi', mercrediAfter.includes('Déplace-moi'));

    const docs = (await allOrgTasks(page)).filter(t => t.title === 'Déplace-moi');
    ok('7.4 Le déplacement a réellement changé dayId en base (pas juste visuel)', docs.length === 1 && docs[0].dayId === 'mercredi');
    ok('7.5 Aucun doublon créé par le glisser-déposer', docs.length === 1);

    // Persistance : relecture complète depuis Firestore après avoir quitté
    // puis ré-ouvert le module (voir note équivalente au test 4.5).
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
    await openOrgResp(page);
    const mercrediReload = await dayCardTitles(page, 'mercredi');
    ok('7.6 Le déplacement persiste après re-sélection du module (relecture Firestore)', mercrediReload.includes('Déplace-moi'));
    ok('7.7 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 8. Récurrence MENSUELLE : génération au bon mois, aucun doublon ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);

    const monday = mondayOfWeek(new Date());
    const nth = Math.min(4, Math.ceil(monday.getDate() / 7)); // on borne à 4 pour rester sur une semaine qui existe presque tous les mois

    await openHeaderNewTask(page);
    await fillForm(page, {
      title: 'Contrôle mensuel chaufferie', day: 'lundi',
      recurrence: 'monthly', monthlyNth: String(nth),
    });
    await submitPrimary(page);
    await page.waitForTimeout(250);

    ok('8.1 Occurrence visible le lundi la semaine de création', (await dayCardTitles(page, 'lundi')).includes('Contrôle mensuel chaufferie'));
    const originDoc = (await allOrgTasks(page)).find(t => t.title === 'Contrôle mensuel chaufferie');
    ok('8.2 recurrence:"monthly" et recurMonthly{nth,weekday} corrects stockés', !!originDoc && originDoc.recurrence === 'monthly' && originDoc.recurMonthly && Number(originDoc.recurMonthly.nth) === nth && originDoc.recurMonthly.weekday === 'lundi');

    // Calcule, de façon indépendante de l'app, dans combien de semaines le
    // prochain mois aura lui aussi un Nième lundi (1 à 3 mois plus tard selon
    // le calendrier), puis navigue exactement ce nombre de semaines.
    let weeksForward = 0;
    let found = null;
    for (let m = 1; m <= 6 && !found; m++) {
      const targetMonthDate = new Date(monday.getFullYear(), monday.getMonth() + m, 1);
      const occ = nthWeekdayOfMonthRef(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), 1, nth);
      if (occ) { found = occ; weeksForward = Math.round((mondayOfWeek(occ) - monday) / (7 * 86400000)); }
    }
    ok('8.3 Un mois futur avec le même Nième lundi a été trouvé (oracle de test)', !!found && weeksForward > 0);

    for (let i = 0; i < weeksForward; i++) {
      await clickSafe(page, '.or-cp-nav-btn[title="Semaine suivante"]');
      await page.waitForTimeout(150);
    }
    const futureLundi = await dayCardTitles(page, 'lundi');
    ok(`8.4 Occurrence régénérée ${weeksForward} semaine(s) plus tard (mois suivant correspondant)`, futureLundi.includes('Contrôle mensuel chaufferie'));

    for (let i = 0; i < weeksForward; i++) {
      await clickSafe(page, '.or-cp-nav-btn[title="Semaine précédente"]');
      await page.waitForTimeout(150);
    }
    await openOrgResp(page);
    await openOrgResp(page);
    const monthlyDocs = (await allOrgTasks(page)).filter(t => t.title === 'Contrôle mensuel chaufferie');
    ok('8.5 Un seul document Firestore réel pour la série mensuelle (aucun doublon)', monthlyDocs.length === 1);
    ok('8.6 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 9. Compatibilité : anciennes tâches "hebdomadaire"/"mensuelle" (legacy, non liées au nouveau moteur) ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);

    // Ancrage pour connaître la weekKey courante.
    await openHeaderNewTask(page);
    await fillForm(page, { title: 'Ancrage9', day: 'lundi' });
    await submitPrimary(page);
    const wk = (await allOrgTasks(page)).find(t => t.title === 'Ancrage9').weekKey;

    // Insertion directe de documents "à l'ancienne" (type hebdomadaire /
    // mensuelle, sans le champ recurrence du nouveau moteur) — exactement la
    // forme produite par l'ancien _seedWeek()/la bibliothèque de modèles
    // avant cette refonte.
    await page.evaluate(async (weekKey) => {
      await window.__mockDb.collection('org_tasks').doc('legacyHebdo').set({
        title: 'Vérification registre sécurité (legacy)', description: '', category: 'sécurité',
        priority: 'normale', type: 'hebdomadaire', dayId: 'mardi', slot: null,
        assignedTo: 'Jordan', weekKey, done: false, status: 'todo',
        doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
        createdBy: 'Sophie', createdAt: { __sv: 'timestamp' }, order: 50, isDefault: false,
      });
      await window.__mockDb.collection('org_tasks').doc('legacyMensuelle').set({
        title: 'Contrôle extincteurs (legacy)', description: '', category: 'sécurité',
        priority: 'haute', type: 'mensuelle', dayId: 'mercredi', slot: null,
        assignedTo: 'Dorian', weekKey, done: false, status: 'todo',
        doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
        createdBy: 'Sophie', createdAt: { __sv: 'timestamp' }, order: 51, isDefault: false,
      });
    }, wk);
    await openOrgResp(page);
    await page.waitForTimeout(300);

    const mardiTitles    = await dayCardTitles(page, 'mardi');
    const mercrediTitles = await dayCardTitles(page, 'mercredi');
    ok('9.1 Ancienne tâche "hebdomadaire" (legacy) toujours affichée sur son jour', mardiTitles.includes('Vérification registre sécurité (legacy)'));
    ok('9.2 Ancienne tâche "mensuelle" (legacy) toujours affichée sur son jour', mercrediTitles.includes('Contrôle extincteurs (legacy)'));

    // Elle doit rester modifiable normalement (le nouveau formulaire doit
    // pouvoir l'éditer sans la casser, sans exiger un champ qu'elle n'a pas).
    const legacyId = await page.locator('.or-tc', { hasText: 'Vérification registre sécurité (legacy)' }).first().getAttribute('data-id');
    ok('9.3 La carte legacy est identifiée comme une tâche normale (id Firestore brut, pas une occurrence virtuelle)', legacyId === 'legacyHebdo');

    ok('9.4 Aucune erreur JS en affichant des tâches legacy à côté du nouveau moteur', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 10. Récurrence QUOTIDIENNE : tous les jours, aucun doublon ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, { title: 'Ronde quotidienne', day: 'mardi', recurrence: 'daily' });
    await submitPrimary(page);
    await page.waitForTimeout(250);

    // L'ancrage est mardi : aucune occurrence n'est générée AVANT la date de
    // création (comportement voulu, partagé avec hebdo/mensuel — une tâche
    // créée un mardi ne doit pas apparaître rétroactivement le lundi
    // précédent). On vérifie donc un jour APRÈS l'ancrage (jeudi) et la fin
    // de semaine (dimanche).
    const jeudiT     = await dayCardTitles(page, 'jeudi');
    const mardiT     = await dayCardTitles(page, 'mardi');
    const dimancheT  = await dayCardTitles(page, 'dimanche');
    ok('10.1 Occurrence quotidienne visible le mardi (ancrage)', mardiT.includes('Ronde quotidienne'));
    ok('10.2 Occurrence quotidienne visible un autre jour après l\'ancrage (jeudi)', jeudiT.includes('Ronde quotidienne'));
    ok('10.3 Occurrence quotidienne visible jusqu\'au dimanche de la même semaine', dimancheT.includes('Ronde quotidienne'));

    await clickSafe(page, '.or-cp-nav-btn[title="Semaine suivante"]');
    await page.waitForTimeout(250);
    const lundiNext = await dayCardTitles(page, 'lundi');
    ok('10.4 Occurrence quotidienne régénérée la semaine suivante', lundiNext.includes('Ronde quotidienne'));

    await clickSafe(page, '.or-cp-nav-btn[title="Semaine précédente"]');
    await page.waitForTimeout(200);
    await openOrgResp(page);
    const dailyDocs = (await allOrgTasks(page)).filter(t => t.title === 'Ronde quotidienne');
    ok('10.5 Un seul document Firestore réel pour la série quotidienne (aucun doublon)', dailyDocs.length === 1 && dailyDocs[0].recurrence === 'daily');
    ok('10.6 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 11. Priorités personnalisables : ajout, édition, suppression ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);

    ok('11.1 Config par défaut : 3 niveaux Haute/Normale/Basse présents', (await page.locator('.or-prio-legend-card').count()) === 4); // 3 niveaux + carte "total"

    await clickSafe(page, '.or-prio-legend-cfg');
    await page.waitForTimeout(200);
    ok('11.2 Le modal de configuration liste bien 3 niveaux', (await page.locator('.or-prio-cfg-row').count()) === 3);

    // Ajout d'un niveau
    await clickSafe(page, '.or-prio-cfg-add');
    await page.waitForTimeout(250);
    let rows = await page.locator('.or-prio-cfg-row').count();
    ok('11.3 Un niveau supplémentaire a bien été ajouté', rows === 4);

    // Édition du nom du nouveau niveau (dernière ligne)
    const nameInputs = page.locator('.or-prio-cfg-name');
    await nameInputs.last().fill('Critique');
    await nameInputs.last().dispatchEvent('change');
    await page.waitForTimeout(250);

    const docAfterAdd = await page.evaluate(async () => {
      const d = await window.__mockDb.collection('org_config').doc('priorities').get();
      return d.data();
    });
    const added = docAfterAdd.levels.find(l => l.label === 'Critique');
    ok('11.4 Le nouveau niveau "Critique" est bien persisté en base', !!added);

    // Utiliser ce nouveau niveau sur une tâche
    await clickSafe(page, '#m-actions .cancel'); // ferme le modal de config
    await openHeaderNewTask(page);
    const hasCritiquePill = await page.locator('#m-body .or-prio-pill:has-text("Critique")').count();
    ok('11.5 Le nouveau niveau apparaît dans le formulaire de création', hasCritiquePill === 1);
    await clickSafe(page, '#m-body .or-prio-pill:has-text("Critique")');
    await page.fill('#or-f-title', 'Tâche critique test');
    await clickSafe(page, '#m-body .or-daypick-btn[data-day="lundi"]');
    await submitPrimary(page);
    await page.waitForTimeout(250);

    // Suppression du niveau "Critique" : la tâche doit rester mais devenir "non configurée"
    await clickSafe(page, '.or-prio-legend-cfg');
    await page.waitForTimeout(200);
    // "Critique" est le dernier niveau ajouté (ordre le plus élevé) — le nom
    // est dans un attribut value="" d'un <input>, donc pas détectable via
    // hasText (qui ne lit que le texte rendu), d'où le repli sur .last().
    const delBtn = page.locator('.or-prio-cfg-row').last().locator('.or-prio-cfg-del');
    await dismissOverlay(page);
    await delBtn.click({ force: true });
    await page.waitForTimeout(250);
    await clickSafe(page, '#m-actions .danger-btn');
    // _doDeletePrioLevel ré-ouvre le modal de config juste après la
    // suppression (pour laisser l'admin enchaîner) — on le referme avant de
    // vérifier la grille, et on attend que le listener Firestore ait eu le
    // temps de re-render la carte avec le nouveau statut "non configuré".
    await page.waitForTimeout(300);
    await clickSafe(page, '#m-actions .cancel');
    await page.waitForTimeout(300);

    const titlesLundi = await dayCardTitles(page, 'lundi');
    ok('11.6 La tâche reste visible après suppression de son niveau de priorité', titlesLundi.includes('Tâche critique test'));
    const cardAfterDel = page.locator('.or-tc', { hasText: 'Tâche critique test' }).first();
    const styleAfterDel = await cardAfterDel.getAttribute('style');
    ok('11.7 Couleur "non configurée" (grise), jamais une couleur devinée', !!styleAfterDel && styleAfterDel.includes('#6B7280'));

    const docFinal = await page.evaluate(async () => {
      const d = await window.__mockDb.collection('org_config').doc('priorities').get();
      return d.data();
    });
    ok('11.8 Le niveau supprimé n\'existe plus dans la config (pas juste masqué)', !docFinal.levels.find(l => l.label === 'Critique'));
    ok('11.9 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 12. Sélecteur de techniciens : grade Responsable uniquement ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    const optionTexts = await page.locator('#or-f-tech-select option').allTextContents();
    ok('12.1 Kevin (technicien) absent du sélecteur', !optionTexts.includes('Kevin'));
    ok('12.2 Jordan (technicien) absent du sélecteur', !optionTexts.includes('Jordan'));
    ok('12.3 Dorian (technicien) absent du sélecteur', !optionTexts.includes('Dorian'));
    ok('12.4 Sophie (responsable) présente dans le sélecteur', optionTexts.includes('Sophie'));
    ok('12.5 Alban (responsable) présent dans le sélecteur', optionTexts.includes('Alban'));
    ok('12.6 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 13. Validation rapide en un clic (tâche unique) ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, { title: 'Vérifier extincteurs', day: 'mercredi' });
    await submitPrimary(page);
    await page.waitForTimeout(250);

    const card = page.locator('#or-daycol-mercredi .or-tc', { hasText: 'Vérifier extincteurs' }).first();
    const hasValidateBtn = await card.locator('.or-tc-validate-btn').count();
    ok('13.1 Le bouton "✓ Valider" est visible directement sur la carte', hasValidateBtn === 1);

    await card.locator('.or-tc-validate-btn').click();
    await page.waitForTimeout(350);

    const cardAfter = page.locator('#or-daycol-mercredi .or-tc', { hasText: 'Vérifier extincteurs' }).first();
    ok('13.2 Aucun volet ni formulaire ne s\'est ouvert', !(await modalIsOpen(page)));
    const statusText = await cardAfter.locator('.or-tc-status').textContent();
    ok('13.3 Le statut visuel devient "Validée" immédiatement', (statusText || '').trim() === 'Validée');
    ok('13.4 La carte reste affichée sur son jour (pas archivée/disparue)', (await dayCardTitles(page, 'mercredi')).includes('Vérifier extincteurs'));
    const hasValidateBtnAfter = await cardAfter.locator('.or-tc-validate-btn').count();
    ok('13.5 Le bouton "Valider" disparaît une fois la tâche validée (pas de double-validation via l\'UI)', hasValidateBtnAfter === 0);

    const doc = (await allOrgTasks(page)).find(t => t.title === 'Vérifier extincteurs');
    ok('13.6 La validation est bien enregistrée dans Firestore (done:true)', !!doc && doc.done === true && doc.status === 'done');

    // Persistance après re-sélection du module
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
    await openOrgResp(page);
    const statusAfterReload = await page.locator('#or-daycol-mercredi .or-tc', { hasText: 'Vérifier extincteurs' }).first().locator('.or-tc-status').textContent();
    ok('13.7 Le résultat persiste après relecture Firestore', (statusAfterReload || '').trim() === 'Validée');
    ok('13.8 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  // ── 14. Validation rapide sur une occurrence récurrente : série non affectée ──
  {
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await openOrgResp(page);
    await openHeaderNewTask(page);
    await fillForm(page, {
      title: 'Contrôle quotidien sécurité', day: 'lundi',
      recurrence: 'weekly', recurDays: ['lundi', 'mardi', 'mercredi'],
    });
    await submitPrimary(page);
    await page.waitForTimeout(250);

    // On valide uniquement l'occurrence du mardi
    const mardiCard = page.locator('#or-daycol-mardi .or-tc', { hasText: 'Contrôle quotidien sécurité' }).first();
    await mardiCard.locator('.or-tc-validate-btn').click();
    await page.waitForTimeout(350);

    const mardiStatus  = await page.locator('#or-daycol-mardi .or-tc', { hasText: 'Contrôle quotidien sécurité' }).first().locator('.or-tc-status').textContent();
    const lundiStatus  = await page.locator('#or-daycol-lundi .or-tc', { hasText: 'Contrôle quotidien sécurité' }).first().locator('.or-tc-status').textContent();
    const mercrediStatus = await page.locator('#or-daycol-mercredi .or-tc', { hasText: 'Contrôle quotidien sécurité' }).first().locator('.or-tc-status').textContent();
    ok('14.1 Seule l\'occurrence du mardi est validée', (mardiStatus || '').trim() === 'Validée');
    ok('14.2 L\'occurrence du lundi reste "À faire"', (lundiStatus || '').trim() === 'À faire');
    ok('14.3 L\'occurrence du mercredi reste "À faire"', (mercrediStatus || '').trim() === 'À faire');

    const allDocs = (await allOrgTasks(page)).filter(t => t.title === 'Contrôle quotidien sécurité' || t.seriesId);
    const originDoc = allDocs.find(t => !t.isException);
    const excDocs    = allDocs.filter(t => t.isException === true);
    ok('14.4 Le document d\'origine n\'a pas été modifié (toujours non terminé)', !!originDoc && !originDoc.done);
    ok('14.5 Une seule exception créée pour cette validation (pas de doublon)', excDocs.length === 1 && excDocs[0].done === true);
    ok('14.6 Aucune erreur JS pendant ce scénario', pageErrors.length === 0);
    await ctx.close();
  }

  console.log(failures === 0 ? '\nTOUS LES TESTS PASSENT ✓' : `\n${failures} ÉCHEC(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
