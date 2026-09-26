// Tests — Optimisation du démarrage V1 :
//  1. Les 3 initDefaults/initDefaultBadges/initShiftTemplateDefaults sont
//     lancées en parallèle (Promise.all), plus en chaîne séquentielle.
//  2. Mes Missions peut être préchauffée (MX.Pages.MesMissions.ensureLoaded/
//     isReady), sur le même principe que Interventions/Compteurs/PMP.
//  3. Aucun double listener quand on ouvre ensuite la page pour de vrai.
//  4. L'Accueil déclenche ce préchauffage dès son premier rendu.
//  5/6. Compteurs distingue LOADING (chargement en cours) de EMPTY (aucune
//     donnée confirmée).
//  7/8. Idem pour Mes Missions.
//  9. Les favoris ne bloquent plus le premier rendu de l'Accueil.
// Aucun calcul existant n'est modifié par ce chantier — voir la suite de
// non-régression (accueil_monthly_perf_test, interventions_scheduling_test,
// mes_missions_cockpit_test, etc.) exécutée séparément.
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

// Pré-remplit les documents de config que toute installation Maintix déjà en
// production possède déjà, pour que les 3 fonctions empruntent le chemin
// "déjà existant" (lecture seule, pas d'écriture) — le cas représentatif,
// pas le tout premier démarrage jamais effectué.
const PRESEED = `
(function () {
  var db = window.__mockDb;
  if (!db) return;
  db.collection('config').doc('week').set({ label: 'Semaine test', num: 1 });
  db.collection('config').doc('teams').set({ matin: ['Jordan'], journee: ['Bryan'], soir: ['Dorian'] });
  db.collection('config').doc('alerts').set({});
  db.collection('config').doc('assignments').set({});
  db.collection('config').doc('checks').set({});
  db.collection('badges').doc('seed1').set({ name: 'Seed', active: true, priority: 1 });
  ['matin','journee','soir'].forEach(function (k) {
    db.collection('shift_templates').doc('seed_' + k).set({ isDefaultSeed: k, name: k, tasks: [] });
  });
})();`;

// Enrobe UNIQUEMENT config/week (.doc().get()), badges (.limit(1).get()) et
// shift_templates (.get()) d'un délai artificiel de 80ms — pour rendre
// mesurable, sans toucher à tests/mock-firebase.js, la différence entre un
// enchaînement séquentiel (~240ms, 3×80ms bout à bout) et un lancement
// parallèle (~80ms, le plus lent des trois). N'affecte aucune autre requête.
const PARALLEL_PROBE = `
(function () {
  var db = window.__mockDb;
  if (!db) return;
  window.__PARALLEL_LOG = [];
  var orig = db.collection.bind(db);
  var watched = { config: true, badges: true, shift_templates: true };
  db.collection = function (name) {
    var q = orig(name);
    if (!watched[name]) return q;
    var origDoc = q.doc.bind(q);
    q.doc = function (id) {
      var ref = origDoc(id);
      var origGet = ref.get.bind(ref);
      ref.get = function () {
        window.__PARALLEL_LOG.push({ name: name, t: performance.now() });
        return new Promise(function (resolve) { setTimeout(function () { origGet().then(resolve); }, 80); });
      };
      return ref;
    };
    var origGetQ = q.get.bind(q);
    q.get = function () {
      window.__PARALLEL_LOG.push({ name: name, t: performance.now() });
      return new Promise(function (resolve) { setTimeout(function () { origGetQ().then(resolve); }, 80); });
    };
    var origLimit = q.limit.bind(q);
    q.limit = function (n) {
      var q2 = origLimit(n);
      var origGet2 = q2.get.bind(q2);
      q2.get = function () {
        window.__PARALLEL_LOG.push({ name: name, t: performance.now() });
        return new Promise(function (resolve) { setTimeout(function () { origGet2().then(resolve); }, 80); });
      };
      return q2;
    };
    return q;
  };
})();`;

// Ajoute un délai artificiel UNIQUEMENT sur le premier onSnapshot() des
// collections nommées (sans toucher tests/mock-firebase.js) — sert à rendre
// observable, de façon déterministe (pas une course contre un mock qui se
// résout quasi instantanément), l'état LOADING affiché entre l'ouverture
// d'une page et l'arrivée de sa première donnée. Enrobe RÉCURSIVEMENT
// where()/orderBy()/limit() : les listeners réels chaînent presque toujours
// ces méthodes avant onSnapshot() (ex. CSO.meters().orderBy('name')...), un
// enrobage non récursif du seul objet initial les manquerait.
function slowOnSnapshotProbe(names, delayMs) {
  return `
(function () {
  var db = window.__mockDb;
  if (!db) return;
  var watched = ${JSON.stringify(names)};
  function wrapQuery(q) {
    var w = { get: q.get ? q.get.bind(q) : undefined, doc: q.doc ? q.doc.bind(q) : undefined, add: q.add ? q.add.bind(q) : undefined };
    ['where', 'orderBy', 'limit'].forEach(function (m) {
      if (typeof q[m] === 'function') {
        var orig = q[m].bind(q);
        w[m] = function () { return wrapQuery(orig.apply(null, arguments)); };
      }
    });
    var origOn = q.onSnapshot.bind(q);
    w.onSnapshot = function (cb, errCb) {
      var wrapped = function (snap) { setTimeout(function () { cb(snap); }, ${delayMs}); };
      return origOn(wrapped, errCb);
    };
    return w;
  }
  var origColl = db.collection.bind(db);
  db.collection = function (name) {
    var q = origColl(name);
    if (watched.indexOf(name) === -1) return q;
    return wrapQuery(q);
  };
})();`;
}

async function bootPage(page, opts) {
  opts = opts || {};
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ content: PRESEED });
  if (opts.parallelProbe) await page.addInitScript({ content: PARALLEL_PROBE });
  if (opts.slowCollections) await page.addInitScript({ content: slowOnSnapshotProbe(opts.slowCollections, opts.slowDelayMs || 300) });
  if (opts.hangUserPrefs) {
    await page.addInitScript({ content: `
      (function () {
        var db = window.__mockDb;
        if (!db) return;
        var orig = db.collection.bind(db);
        db.collection = function (name) {
          var q = orig(name);
          if (name !== 'user_prefs') return q;
          var origDoc = q.doc.bind(q);
          q.doc = function (id) {
            var ref = origDoc(id);
            ref.get = function () { return new Promise(function () {}); }; // ne se résout jamais
            return ref;
          };
          return q;
        };
      })();` });
  }
  await page.addInitScript({ path: SEED });
  const url = BASE + '/index.html' + (opts.urlPage ? ('?page=' + opts.urlPage) : '');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return el && el.classList.contains('fade-out');
  }, undefined, { timeout: 20000 });
  await page.evaluate(async () => { await window.__seedGst(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
  return pageErrors;
}
async function pinLogin(page, userId, pin) {
  await page.evaluate((userId) => { MX.Auth.selectUser(userId); }, userId);
  await page.waitForTimeout(100);
  await page.evaluate((pin) => { document.getElementById('pin-input').value = pin; }, pin);
  await page.evaluate(async () => { await MX.Auth.confirmPin(); });
  await page.waitForTimeout(150);
}
function evalPage(page, fn, ...args) { return page.evaluate(fn, ...args); }
async function mainHtml(page) { return page.evaluate(() => document.getElementById('main-content').innerHTML); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ── 1. Les 3 initDefaults sont lancées en parallèle ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page, { parallelProbe: true });
    const log = await evalPage(page, () => window.__PARALLEL_LOG || []);
    const byName = {};
    log.forEach(e => { if (!byName[e.name]) byName[e.name] = e.t; });
    ok('1.1 Les 3 collections ont bien été lues (config/badges/shift_templates)',
      'config' in byName && 'badges' in byName && 'shift_templates' in byName);
    const ts = Object.values(byName);
    const spread = ts.length ? Math.max(...ts) - Math.min(...ts) : Infinity;
    console.log('    écart entre les 3 appels : ' + spread.toFixed(1) + ' ms (attendu très inférieur à 80ms — l\'ancien enchaînement séquentiel aurait produit ~160ms, 2×80ms de décalage)');
    ok('1.2 Les 3 lectures sont émises en PARALLÈLE (écart < 80ms, très inférieur aux ~160ms d\'un enchaînement séquentiel)', spread < 80);
    await ctx.close();
  }

  // ── 2/4. Mes Missions peut être préchauffée, dès l'Accueil ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    // L'Accueil est la page d'atterrissage par défaut : son render() a déjà
    // dû déclencher _ensureDataLoaded() → MesMissions.ensureLoaded().
    await page.waitForFunction(() => window.MX.Pages.MesMissions && MX.Pages.MesMissions.isReady && MX.Pages.MesMissions.isReady(), undefined, { timeout: 10000 });
    ok('2.1 MX.Pages.MesMissions.ensureLoaded/isReady existent', true);
    ok('4.1 Home préchauffe Mes Missions (isReady() devient vrai sans jamais ouvrir la page)', true);
    const stillOnHome = await evalPage(page, () => MX.state.currentPage === 'home');
    ok('4.2 Le préchauffage ne force pas de navigation (toujours sur l\'Accueil)', stillOnHome);
    await ctx.close();
  }

  // ── 3. Pas de double listener à l'ouverture réelle de la page ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    await page.waitForFunction(() => window.MX.Pages.MesMissions && MX.Pages.MesMissions.isReady && MX.Pages.MesMissions.isReady(), undefined, { timeout: 10000 });
    const before = await evalPage(page, () => {
      const l = window.__mockDb._debugListeners || {};
      return {
        missions: (l['missions'] || []).length,
        org_tasks: (l['org_tasks'] || []).length,
        interventions: (l['interventions'] || []).length,
        pmp_interventions: (l['pmp_interventions'] || []).length,
      };
    });
    await evalPage(page, () => { MX.showPage('mes-missions'); });
    await page.waitForTimeout(300);
    const after = await evalPage(page, () => {
      const l = window.__mockDb._debugListeners || {};
      return {
        missions: (l['missions'] || []).length,
        org_tasks: (l['org_tasks'] || []).length,
        interventions: (l['interventions'] || []).length,
        pmp_interventions: (l['pmp_interventions'] || []).length,
      };
    });
    ok('3.1 Aucun nouveau listener "missions" créé en ouvrant la page', after.missions === before.missions);
    ok('3.2 Aucun nouveau listener "org_tasks" créé en ouvrant la page', after.org_tasks === before.org_tasks);
    ok('3.3 Aucun nouveau listener "interventions" créé en ouvrant la page', after.interventions === before.interventions);
    ok('3.4 Aucun nouveau listener "pmp_interventions" créé en ouvrant la page', after.pmp_interventions === before.pmp_interventions);
    const html = await mainHtml(page);
    ok('3.5 La page "Mes missions" s\'affiche normalement (listeners préchauffés réutilisés)', html.includes('mm-v3-wrap'));
    await ctx.close();
  }

  // ── 5/6. Compteurs — LOADING puis EMPTY ──
  // Un délai artificiel est injecté UNIQUEMENT sur cso_meters/cso_readings/
  // cso_clients (via slowOnSnapshotProbe, sans toucher mock-firebase.js) :
  // sans lui, le mock répondrait quasi instantanément et l'état LOADING,
  // bien que réel, ne serait qu'une course impossible à observer de façon
  // fiable dans un test automatisé.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page, { slowCollections: ['cso_meters', 'cso_readings', 'cso_clients'], slowDelayMs: 1200 });
    await pinLogin(page, 'kevin', '1111');
    // Compteurs ouvert manuellement (pas depuis l'Accueil) pour observer un
    // état non préchauffé ; navigation + lecture DOM dans le MÊME evaluate()
    // pour capturer l'état exact d'avant l'arrivée des données (setTimeout
    // en attente, jamais exécuté avant la fin de l'evaluate()).
    const htmlImmediate = await evalPage(page, () => {
      MX.showPage('consommations');
      return document.getElementById('main-content').innerHTML;
    });
    ok('5.1 "Chargement de vos compteurs…" affiché avant que les données arrivent', htmlImmediate.includes('Chargement de vos compteurs'));
    ok('5.2 Pas de "Aucun compteur configuré" pendant le chargement (LOADING ≠ EMPTY)', !htmlImmediate.includes('Aucun compteur configuré'));
    await page.waitForFunction(() => window.MX.Pages.Conso && MX.Pages.Conso.isReady && MX.Pages.Conso.isReady(), undefined, { timeout: 10000 });
    await page.waitForTimeout(50);
    const htmlReady = await mainHtml(page);
    ok('6.1 "Aucun compteur configuré" affiché une fois les données confirmées (aucun compteur seedé)', htmlReady.includes('Aucun compteur configuré'));
    ok('6.2 Le message de chargement a disparu', !htmlReady.includes('Chargement de vos compteurs'));
    await ctx.close();
  }

  // ── 7/8. Mes Missions — LOADING puis EMPTY ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await bootPage(page, { slowCollections: ['missions', 'org_tasks', 'interventions', 'pmp_interventions'], slowDelayMs: 1200 });
    await pinLogin(page, 'kevin', '1111');
    const htmlImmediate = await evalPage(page, () => {
      MX.showPage('mes-missions');
      return document.getElementById('main-content').innerHTML;
    });
    ok('7.1 "Synchronisation de vos missions…" affiché avant que les données arrivent', htmlImmediate.includes('Synchronisation de vos missions'));
    await page.waitForFunction(() => window.MX.Pages.MesMissions && MX.Pages.MesMissions.isReady && MX.Pages.MesMissions.isReady(), undefined, { timeout: 10000 });
    await page.waitForTimeout(50);
    await evalPage(page, () => { MX.MM.render(); }); // re-rend pour refléter _ready (comme le ferait un vrai listener)
    const htmlReady = await mainHtml(page);
    ok('8.1 Message de synchronisation disparu une fois les données confirmées', !htmlReady.includes('Synchronisation de vos missions'));
    ok('8.2 "Aucune mission" affiché (aucune mission seedée pour Kevin)', htmlReady.includes('Aucune mission'));
    await ctx.close();
  }

  // ── 9. Les favoris ne bloquent plus le premier rendu ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = await bootPage(page, { hangUserPrefs: true });
    // hangUserPrefs fait que user_prefs/{uid}.get() ne se résout JAMAIS.
    // Si les favoris bloquaient encore le premier rendu, la page resterait
    // indéfiniment sur le splash / #main-content vide.
    await page.waitForFunction(() => MX.state && MX.state.currentPage === 'home', undefined, { timeout: 5000 });
    const html = await mainHtml(page);
    ok('9.1 L\'Accueil est bien rendu malgré un user_prefs.get() qui ne répond jamais', html.length > 200);
    ok('9.2 Aucune erreur JS levée par le chargement différé des favoris', errs.length === 0);
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? '\n' + failures + ' test(s) EN ÉCHEC.' : '\nTOUS LES TESTS PASSENT ✓');
  process.exit(failures ? 1 : 0);
})();
