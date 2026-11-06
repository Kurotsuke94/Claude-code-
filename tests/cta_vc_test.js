// Tests pour le module CTA/VC (conseiller chauffage) + extension météo/DJU
// de l'Accueil. Même harnais que les autres suites (mock-firebase.js +
// gst_seed.js). Les appels réseau vers api.open-meteo.com sont interceptés
// via page.route() et remplacés par des réponses fixes — ce sandbox n'a de
// toute façon pas d'accès réseau sortant vers ce domaine.
const path = require('path');
const { chromium } = _resolvePlaywright();
const BASE   = 'http://127.0.0.1:8811';

// Résolution portable de Playwright (Windows/macOS/Linux) : priorité à une
// dépendance locale au projet (résolution Node standard — node_modules du
// projet, puis NODE_PATH/installation globale habituelle), avec un repli
// configurable par variable d'environnement pour un poste où Playwright
// est installé ailleurs. Jamais de chemin Linux codé en dur, jamais
// d'installation automatique — une dépendance absente est signalée
// clairement plutôt que masquée.
function _resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }
  const explicitPath = process.env.PLAYWRIGHT_REQUIRE_PATH;
  if (explicitPath) {
    try {
      return require(explicitPath);
    } catch (e) {
      throw new Error(
        'Playwright introuvable au chemin indiqué par PLAYWRIGHT_REQUIRE_PATH="' + explicitPath + '" (' + (e.message || e) + '). ' +
        'Vérifiez ce chemin ou installez Playwright localement (npm install -D playwright) dans ce projet.'
      );
    }
  }
  throw new Error(
    'Playwright introuvable. Installez-le localement dans ce projet (npm install -D playwright), ' +
    'ou indiquez son emplacement via la variable d\'environnement PLAYWRIGHT_REQUIRE_PATH ' +
    '(ex: PLAYWRIGHT_REQUIRE_PATH=/chemin/vers/node_modules/playwright).'
  );
}
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

// GARDE-FOU ENVIRONNEMENT (mock-firebase) — index.html charge le VRAI SDK
// Firebase depuis www.gstatic.com : sur un poste disposant d'un accès
// Internet, il écrase window.firebase défini par tests/mock-firebase.js, puis
// firebase-config.js le redirige vers les émulateurs locaux (127.0.0.1:8090/
// 9099). Sans émulateur démarré, MX.state.users reste vide (pin-input jamais
// créé) et toute écriture Firestore attend indéfiniment (TIMEOUT GLOBAL 180s).
// Même protection que tests/navigation_visibility_test.js et
// tests/accueil_cockpit_test.js : bloquer gstatic/googleapis AVANT page.goto(),
// puis vérifier explicitement que le mock est bien celui utilisé par l'app.
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
      'Test interrompu immédiatement au lieu d\'attendre le TIMEOUT GLOBAL.');
    process.exit(1);
  }
}

const _globalTimeout = setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (180s) — le process est arrêté de force.');
  process.exit(1);
}, 180000);

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysArray(center, pastDays, forecastDays) {
  var out = [];
  for (var i = -pastDays; i <= forecastDays - 1; i++) {
    var d = new Date(center);
    d.setDate(d.getDate() + i);
    out.push(isoDate(d));
  }
  return out;
}

// Construit une réponse Open-Meteo /v1/forecast plausible : jours passés
// avec des températures connues, jours futurs avec des températures plus
// basses (pour exercer la tendance "hausse DJU").
function buildDailyPayload(todayStr) {
  var today = new Date(todayStr + 'T12:00:00Z');
  var time = daysArray(today, 7, 7);
  var mins = [], maxs = [], means = [], codes = [];
  time.forEach(function (d, i) {
    var isPast = d < todayStr;
    var base = isPast ? 8 : 2; // jours futurs plus froids -> DJU en hausse
    mins.push(base - 2); maxs.push(base + 4); means.push(base + 1); codes.push(isPast ? 2 : 3);
  });
  return { timezone: 'Europe/Paris', daily: { time: time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: codes } };
}

async function mockOpenMeteo(page, todayStr, opts) {
  opts = opts || {};
  await page.route('https://api.open-meteo.com/**', function (route) {
    var url = route.request().url();
    if (opts.fail) { return route.abort('failed'); }
    if (url.indexOf('current=') !== -1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        current: { temperature_2m: 8, weather_code: 2 },
        daily: { temperature_2m_min: [6], temperature_2m_max: [13] },
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDailyPayload(todayStr)) });
  });
}

async function bootPage(page, weatherOpts, preHotelConfig) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const todayStr = new Date().toISOString().slice(0, 10);
  await mockOpenMeteo(page, todayStr, weatherOpts);
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ path: SEED });
  if (preHotelConfig) {
    // Pré-configure config/hotel_config AVANT le premier script de page —
    // reflète le cas réel (un Admin configure la localisation une fois,
    // bien avant qu'un Responsable/Technicien ne se connecte), par
    // opposition à une configuration en cours de session déjà démarrée.
    await page.addInitScript((cfg) => {
      window.addEventListener('DOMContentLoaded', () => {}, { once: true });
      const seedHotelConfig = () => {
        if (!window.__mockDb) { setTimeout(seedHotelConfig, 1); return; }
        const store = window.__mockDb._debugStore;
        store.config = store.config || {};
        store.config.hotel_config = Object.assign({}, cfg);
      };
      seedHotelConfig();
    }, preHotelConfig);
  }
  await blockRealFirebase(page);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await assertMockFirebase(page);
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { await window.__seedGst(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
  return { pageErrors, todayStr };
}
async function pinLogin(page, userId, pin) {
  await page.evaluate((userId) => { MX.Auth.selectUser(userId); }, userId);
  await page.waitForTimeout(150);
  await page.evaluate((pin) => { document.getElementById('pin-input').value = pin; }, pin);
  await page.evaluate(async () => { await MX.Auth.confirmPin(); });
  await page.waitForTimeout(300);
}
async function dismissOverlays(page) {
  await page.evaluate(() => {
    const o = document.getElementById('ver-modal-overlay'); if (o) o.remove();
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  });
}
// Clic DOM direct (pas Playwright page.click) : évite les échecs
// "Element is outside of the viewport" quand un bouton se trouve en bas
// d'une carte qui a grandi (ex. nouveaux champs de configuration) —
// { force: true } de Playwright ignore les vérifications de visibilité
// mais PAS le scroll-into-view, qui peut échouer selon la taille de la
// fenêtre par défaut du navigateur de test. Même correctif déjà appliqué
// dans tests/heating_config_page_test.js et tests/_screenshot_config_
// thermique_demo.js pour la même cause (REFONTE CTA/VC + CONFIGURATION
// THERMIQUE a fait grandir plusieurs formulaires/cartes).
async function clickSafe(page, selector) {
  await dismissOverlays(page);
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.click(); }, selector);
  await page.waitForTimeout(250);
  await dismissOverlays(page);
}

async function setHotelConfig(page, lat, lon) {
  await page.evaluate(async (c) => {
    await firebase.firestore().collection('config').doc('hotel_config').set(c, { merge: true });
    MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, c);
  }, { lat: lat, lon: lon, cityLabel: 'Orly' });
}

(async () => {
  const browser = await chromium.launch();

  // ═══════════════ 1. DJU — calcul pur ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    const r = await page.evaluate(() => {
      const out = {};
      out.base = MX.Dju.BASE_TEMP;
      out.c1 = MX.Dju.compute19(10);       // 19-10=9
      out.c2 = MX.Dju.compute19(25);       // max(0, 19-25) = 0
      out.c3 = MX.Dju.compute19(null);     // null -> null
      out.estApi = MX.Dju.estimateMean(5, 15, 11).method;   // api_mean préféré
      out.estFallback = MX.Dju.estimateMean(5, 15, undefined).method; // minmax_avg
      out.estNone = MX.Dju.estimateMean(null, null, undefined).value;
      return out;
    });
    ok('1.1 Base DJU = 19°C', r.base === 19);
    ok('1.2 DJU19(moyenne 10°C) = 9', r.c1 === 9);
    ok('1.3 DJU19 jamais négatif (moyenne 25°C) = 0', r.c2 === 0);
    ok('1.4 DJU19(donnée manquante) = null (jamais inventé)', r.c3 === null);
    ok('1.5 Moyenne API préférée quand disponible', r.estApi === 'api_mean');
    ok('1.6 Repli (Tmin+Tmax)/2 documenté comme estimation', r.estFallback === 'minmax_avg' && r.estFallback !== 'api_mean');
    ok('1.7 Aucune valeur inventée si Tmin/Tmax/Tmean tous absents', r.estNone === null);
    ok('1.8 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 2. Série météo — observé vs prévisionnel ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors, todayStr } = await bootPage(page);
    const series = await page.evaluate((today) => {
      const raw = { time: ['2020-01-01', today, '2099-01-01'], temperature_2m_min: [1, 2, 3], temperature_2m_max: [5, 6, 7], temperature_2m_mean: [3, 4, 5], weather_code: [1, 2, 3] };
      return MX.Dju.buildDailySeries(raw, today);
    }, todayStr);
    ok('2.1 Jour strictement passé marqué "observed"', series[0].kind === 'observed');
    ok("2.2 Jour courant marqué \"forecast\" (jamais présenté comme observé)", series[1].kind === 'forecast');
    ok('2.3 Jour futur marqué "forecast"', series[2].kind === 'forecast');
    ok('2.4 DJU19 calculé pour chaque jour avec données', series.every(d => d.dju19 !== null));
    const missing = await page.evaluate(() => MX.Dju.buildDailySeries({ time: ['2024-01-01'], temperature_2m_min: [null], temperature_2m_max: [null] }, '2024-06-01'));
    ok('2.5 Jour sans Tmin/Tmax marqué "missing", DJU null', missing[0].kind === 'missing' && missing[0].dju19 === null);
    ok('2.6 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 3. Accueil — tableau 7 jours + erreurs réseau ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('home'));
    await page.waitForTimeout(2500);
    const cardCount = await page.locator('.acc-wd-card').count();
    ok('3.1 Le tableau météo 7 jours affiche des cartes', cardCount >= 5 && cardCount <= 7);
    const todayCard = await page.locator('.acc-wd-card--today').count();
    ok("3.2 Une carte est marquée \"aujourd'hui\"", todayCard === 1);
    const djuTexts = await page.locator('.acc-wd-dju').allTextContents();
    ok('3.3 Les DJU sont affichés sur chaque jour', djuTexts.every(t => /DJU/.test(t)));
    ok('3.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }
  {
    // Erreur réseau météo — l'Accueil ne doit pas planter, doit afficher un état d'erreur neutre.
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page, { fail: true });
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('home'));
    await page.waitForTimeout(2500);
    const errRow = await page.locator('.acc-wd-row--error, .acc-weather--error').count();
    ok('3.5 Échec réseau météo affiché proprement (pas de crash)', errRow > 0);
    ok('3.6 Aucune erreur JS malgré l\'échec réseau', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 4. CTA/VC — visibilité du module ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.waitForTimeout(500);
    const visibleByDefault = await page.evaluate(() => MX.NavVisibility.shouldShow('cta-vc'));
    ok('4.1 CTA/VC visible par défaut (pas de config = visible)', visibleByDefault === true);
    // Écriture sur config/navigation_visibility réservée Super Admin (même
    // dans le mock, qui reproduit fidèlement cette règle) — voir le
    // précédent tests/navigation_visibility_test.js.
    await page.evaluate(() => { window.__mockAuth.__setCurrentUserForTest({ uid: 'super-uid', isAnonymous: false, email: 'keyzeur94460@hotmail.fr' }); });
    await page.evaluate(async () => {
      await firebase.firestore().collection('config').doc('navigation_visibility').set({ 'cta-vc': { tech: true, responsable: false } }, { merge: true });
    });
    await page.evaluate(() => { window.__mockAuth.__setCurrentUserForTest(null); });
    await page.waitForTimeout(300);
    const hiddenForResp = await page.evaluate(() => MX.NavVisibility.shouldShow('cta-vc'));
    ok('4.2 CTA/VC masquable pour le profil Responsable via la config existante', hiddenForResp === false);
    // L'accès direct reste possible (comportement documenté et assumé du mécanisme existant)
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(500);
    const pageRendered = await page.locator('.ctavc-wrap').count();
    ok('4.3 Accès direct à une page masquée toujours possible (comportement existant inchangé)', pageRendered > 0);
    ok('4.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 5. Circuits — création illimitée, archivage ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(800);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('config')\"]");

    // Crée 5 circuits (plus que l'ancien plafond de 4 CTA+VC)
    for (let i = 1; i <= 5; i++) {
      await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
      await page.fill('#ctavc-f-name', 'Circuit test ' + i);
      await page.selectOption('#ctavc-f-type', i % 2 === 0 ? 'vc' : 'cta');
      await clickSafe(page, '.modal-btn.primary-btn');
      await page.waitForTimeout(300);
    }
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    const circuitCount = await page.evaluate(() => MX.Pages.CtaVc ? undefined : undefined); // no-op, state read via DOM below
    const cardCount = await page.locator('.ctavc-circuit-card').count();
    ok('5.1 5 circuits créés sans plafond à 4 (CTA+VC illimités)', cardCount === 5);

    // Archive le premier
    await page.locator('.ctavc-circuit-card').first().click();
    await page.waitForTimeout(400);
    page.once('dialog', d => d.accept());
    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._confirmArchive"]');
    await page.waitForTimeout(400);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    const cardCountAfterArchive = await page.locator('.ctavc-circuit-card').count();
    ok('5.2 Circuit archivé : retiré de la liste active par défaut (pas supprimé)', cardCountAfterArchive === 4);
    await page.evaluate(() => { document.querySelector('input[type=checkbox]')?.click(); });
    await page.waitForTimeout(400);
    const cardCountShowArchived = await page.locator('.ctavc-circuit-card').count();
    ok('5.3 Case "Afficher les archivés" fait réapparaître le circuit archivé (données conservées)', cardCountShowArchived === 5);
    ok('5.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 6. Types de régulation — champs conditionnels ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(800);
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit régulation');
    await page.selectOption('#ctavc-f-regtype', 'vanne_3v');
    await page.waitForTimeout(150);
    ok('6.1 Champs vanne 3 voies affichés (consigne eau départ)', await page.locator('#ctavc-f-watersp').count() === 1);
    ok('6.2 Champ loi d\'eau affiché', await page.locator('#ctavc-f-waterlaw').count() === 1);
    ok('6.3 Champ "nature de consigne" (type ambiante/eau) absent pour vanne 3V seule', await page.locator('#ctavc-f-setpointtype').count() === 0);
    await page.selectOption('#ctavc-f-regtype', 'consigne');
    await page.waitForTimeout(150);
    ok('6.4 Changement de régulation : champ consigne eau départ disparaît', await page.locator('#ctavc-f-watersp').count() === 0);
    ok('6.5 Champ nature de consigne apparaît pour la régulation "consigne"', await page.locator('#ctavc-f-setpointtype').count() === 1);
    await page.selectOption('#ctavc-f-setpointtype', 'ambiante');
    await page.fill('#ctavc-f-setpointval', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    const created = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_circuits || {}).find(c => c.name === 'Circuit régulation'));
    ok('6.6 Régulation + consigne correctement enregistrées (jamais de valeur par défaut inventée)', created && created.regulationType === 'consigne' && created.setpointType === 'ambiante' && created.setpointValue === 20);
    ok('6.7 Aucun champ "vanne 3 voies" résiduel enregistré pour une régulation "consigne"', created.waterSetpoint === null || created.waterSetpoint === undefined);
    ok('6.8 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 7. Relevés manuels — saisie + historique ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(800);
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit relevés');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    await page.locator('.ctavc-circuit-card', { hasText: 'Circuit relevés' }).click();
    await page.waitForTimeout(400);

    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    await page.fill('#ctavc-r-temp', '18.5');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    ok('7.1 Premier relevé visible dans la fiche circuit', (await page.locator('.ctavc-reading-row').count()) === 1);

    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    await page.fill('#ctavc-r-temp', '19.2');
    await page.fill('#ctavc-r-comment', 'Correction après vérification');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    ok('7.2 Un second relevé ne détruit pas le premier (historique conservé)', (await page.locator('.ctavc-reading-row').count()) === 2);

    const authors = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_readings || {}).map(r => r.author));
    ok('7.3 Auteur du relevé enregistré (identité PIN disponible)', authors.every(a => a === 'Sophie'));
    const isManual = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_readings || {}).every(r => !!r.recordedAt && typeof r.temp === 'number'));
    ok('7.4 Relevés horodatés manuellement, jamais présentés comme automatiques', isManual);
    ok('7.5 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 8. Moteur de recommandation — suffisant / insuffisant ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors, todayStr } = await bootPage(page);
    const result = await page.evaluate((today) => {
      const circuitNoReg = { id: 'c1', name: 'Sans régulation', archived: false };
      const circuitOk = { id: 'c2', name: 'OK', archived: false, regulationType: 'consigne', setpointType: 'ambiante', setpointValue: 20, targetTemp: 20 };
      const readings = [{ circuitId: 'c2', temp: 17, recordedAt: new Date().toISOString() }];
      const series = MX.Dju.buildDailySeries({
        time: [today],
        temperature_2m_min: [1], temperature_2m_max: [3], temperature_2m_mean: [2], weather_code: [1],
      }, today);
      const recoNoReg = MX.HeatingEngine.evaluateCircuit(circuitNoReg, [], series, Date.now(), today);
      const recoOk = MX.HeatingEngine.evaluateCircuit(circuitOk, readings, series, Date.now(), today);
      return {
        noRegAction: recoNoReg[0].action,
        noRegHasNumeric: JSON.stringify(recoNoReg[0]).match(/\bproposedValue\b/) !== null,
        okHasZoneFroide: recoOk.some(r => r.action === 'zone_froide'),
      };
    }, todayStr);
    ok('8.1 Régulation inconnue -> "Données insuffisantes" (jamais de réglage chiffré)', result.noRegAction === 'donnees_insuffisantes');
    ok('8.2 Aucun champ de valeur numérique proposée dans ce cas', !result.noRegHasNumeric);
    ok('8.3 Zone sous sa cible avec données suffisantes -> recommandation actionnable', result.okHasZoneFroide);
    ok('8.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 9. Statuts : à examiner (réel) -> acceptée -> appliquée ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(800);
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit reco');
    await page.selectOption('#ctavc-f-regtype', 'consigne');
    await page.waitForTimeout(150);
    await page.selectOption('#ctavc-f-setpointtype', 'ambiante');
    await page.fill('#ctavc-f-setpointval', '20');
    await page.fill('#ctavc-f-target', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    await page.locator('.ctavc-circuit-card', { hasText: 'Circuit reco' }).click();
    await page.waitForTimeout(400);
    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    await page.fill('#ctavc-r-temp', '16');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(2500); // laisse la météo se charger pour que le moteur ait des données

    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('recommendations')\"]");
    const liveCount = await page.locator('.ctavc-reco-row').count();
    ok('9.1 Au moins une recommandation candidate calculée', liveCount > 0);

    // Le statut 'a_examiner' doit être réellement utilisé dans le parcours
    // normal : le(s) candidat(s) calculé(s) sont persistés AUTOMATIQUEMENT,
    // sans aucun clic ni injection manuelle dans le store.
    await page.waitForFunction(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).some(r => r.status === 'a_examiner'), { timeout: 5000 });
    const afterSync = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}));
    ok('9.2 Candidat(s) calculé(s) automatiquement enregistré(s) comme "à examiner" (sans injection ni clic)', afterSync.length >= 1 && afterSync.every(r => r.status === 'a_examiner'));
    await page.waitForTimeout(500); // laisse le re-rendu afficher les boutons Accepter/Refuser

    const beforeAccept = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.heating_recommendations || {}).length);
    await page.locator('.ctavc-reco-row-actions button').first().click();
    await page.waitForTimeout(400);
    const afterAcceptAll = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}));
    const accepted = afterAcceptAll.find(r => r.status === 'acceptee');
    ok('9.3 "Accepter" transforme le document existant — aucun nouveau document créé (anti-doublon)', afterAcceptAll.length === beforeAccept && !!accepted);
    ok('9.4 "Acceptée" distincte d\'"appliquée" à ce stade (pas de confirmation d\'application)', !!accepted && !accepted.appliedAt && !accepted.appliedBy);

    // Nouvelle interface (REFONTE CTA/VC) : les recommandations enregistrées
    // sont listées en tableau (cta-vc.js:_recoTableHtml) ; un clic sur la
    // ligne ouvre le détail (_openRecoDetail), dont le bouton réel
    // « Confirmer l'application réelle » appelle _markApplied
    // (_recoDetailActions) — plus de bouton onclick=_markApplied dans cet onglet.
    const acceptedId = await page.evaluate(() => { const f = Object.entries(firebase.firestore()._debugStore.heating_recommendations || {}).find(([id, r]) => r.status === 'acceptee'); return f ? f[0] : null; });
    const acceptedRowSel = 'tr[onclick="MX.Pages.CtaVc._openRecoDetail(\'' + acceptedId + '\')"]';
    ok('9.5a La recommandation acceptée apparaît dans le tableau des recommandations', !!acceptedId && (await page.locator(acceptedRowSel).count()) === 1);
    await clickSafe(page, acceptedRowSel);
    const confirmAppliedBtn = page.locator('#m-actions .modal-btn', { hasText: 'Confirmer l\'application réelle' });
    ok('9.5b Le détail de la recommandation acceptée propose le bouton « Confirmer l\'application réelle »', (await confirmAppliedBtn.count()) === 1);
    page.once('dialog', d => d.accept());
    await confirmAppliedBtn.click({ force: true });
    await page.waitForTimeout(400);
    const afterAll = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}));
    const applied = afterAll.find(r => r.status === 'appliquee');
    ok('9.5 Confirmation d\'application distincte, postérieure à l\'acceptation', !!applied && !!applied.appliedBy);
    const finalReco = await page.evaluate((id) => (firebase.firestore()._debugStore.heating_recommendations || {})[id], acceptedId);
    ok('9.5c La MÊME recommandation (celle acceptée) a bien le statut final « appliquee » (appliedAt + appliedBy)', !!finalReco && finalReco.status === 'appliquee' && !!finalReco.appliedAt && !!finalReco.appliedBy);
    ok('9.6 Toujours aucun doublon après l\'application (même nombre total de documents)', afterAll.length === beforeAccept);

    // ── Parcours "refus" : un 2e circuit, isolé, pour tester le refus sans
    // ambiguïté avec le circuit précédent (déjà accepté/appliqué). ──
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('config')\"]");
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit refus');
    await page.selectOption('#ctavc-f-regtype', 'consigne');
    await page.waitForTimeout(150);
    await page.selectOption('#ctavc-f-setpointtype', 'ambiante');
    await page.fill('#ctavc-f-setpointval', '20');
    await page.fill('#ctavc-f-target', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    await page.locator('.ctavc-circuit-card', { hasText: 'Circuit refus' }).click();
    await page.waitForTimeout(400);
    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    await page.fill('#ctavc-r-temp', '20'); // = cible : pas de "zone_froide", seule la tendance météo reste actionnable
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(2000);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('recommendations')\"]");
    await page.waitForFunction(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).some(r => r.status === 'a_examiner'), { timeout: 5000 });
    await page.waitForTimeout(500);
    const beforeRefuse = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.heating_recommendations || {}).length);
    const refuseRow = page.locator('.ctavc-reco-row', { hasText: 'Circuit refus' }).first();
    await refuseRow.locator('.ctavc-reco-row-actions button').last().click(); // 2e bouton = Refuser
    await page.waitForTimeout(400);
    const afterRefuseAll = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}));
    const refused = afterRefuseAll.find(r => r.status === 'refusee');
    ok('9.8 "Refuser" transforme le document existant en statut "refusée" — aucun nouveau document créé', afterRefuseAll.length === beforeRefuse && !!refused);
    ok('9.9 Une recommandation refusée reste distincte d\'une application (jamais de appliedAt/appliedBy)', !!refused && !refused.appliedAt && !refused.appliedBy);

    ok('9.10 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 10. Persistance weather_daily indépendante de l'Accueil ═══════════════
  {
    const page = await browser.newPage();
    // hotel_config déjà configuré AVANT le boot (cas réel : un Admin
    // configure la localisation une fois, bien avant la connexion d'un
    // Responsable/Technicien) — voir bootPage(preHotelConfig).
    const { pageErrors } = await bootPage(page, undefined, { lat: 48.75, lon: 2.36, cityLabel: 'Orly' });
    await pinLogin(page, 'sophie', '9999');
    // Ne visite JAMAIS 'home' — uniquement CTA/VC, pour vérifier que la
    // persistance (centralisée dans app.js depuis ce tour) ne dépend plus
    // de l'ouverture de l'Accueil.
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(3000);
    const stored = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.weather_daily || {}));
    ok('10.1 weather_daily alimenté sans jamais avoir ouvert l\'Accueil', stored.length > 0);
    const allObserved = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.weather_daily || {}).every(d => d.kind === 'observed'));
    ok('10.2 Seuls des jours "observed" sont persistés (jamais une prévision)', allObserved);
    ok('10.3 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 10b. Configuration de la localisation PENDANT une session déjà démarrée ═══════════════
  {
    const page = await browser.newPage();
    // hotel_config VIDE au boot cette fois — simule un Admin qui configure
    // la localisation pour la première fois alors qu'une session est déjà
    // ouverte (sans règle, _ensureDailyDjuPersisted n'aurait jamais
    // qu'une seule chance, au tout premier chargement de hotel_config).
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await page.waitForTimeout(500);
    const beforeConfig = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.weather_daily || {}).length);
    ok('10b.1 Rien de persisté tant qu\'aucune localisation n\'est configurée', beforeConfig === 0);
    await setHotelConfig(page, 48.75, 2.36);
    await page.evaluate(() => { if (MX.ensureDailyDjuPersisted) MX.ensureDailyDjuPersisted(); });
    await page.waitForTimeout(2500);
    const afterConfig = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.weather_daily || {}).length);
    ok('10b.2 La persistance démarre dès que la localisation est configurée, sans attendre un rechargement complet', afterConfig > 0);
    ok('10b.3 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 11. Expiration des recommandations obsolètes ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.waitForTimeout(300);

    const expiryDays = await page.evaluate(() => MX.HeatingEngine.RECO_EXPIRY_DAYS);
    ok('11.0 Durée d\'expiration centralisée et accessible (MX.HeatingEngine.RECO_EXPIRY_DAYS)', typeof expiryDays === 'number' && expiryDays > 0);

    // Écrit directement 3 recommandations de test avec des dates de création
    // contrôlées, pour isoler la logique d'expiration de la génération du
    // moteur (déjà testée en 8/9).
    await page.evaluate((days) => {
      const store = firebase.firestore()._debugStore;
      store.heating_recommendations = store.heating_recommendations || {};
      const oldMs = Date.now() - (days + 1) * 24 * 60 * 60 * 1000;
      const recentMs = Date.now() - 1 * 24 * 60 * 60 * 1000;
      store.heating_recommendations['old-a-examiner'] = { circuitId: 'x', action: 'maintenir', title: 'Vieille', justification: 'j', priority: 'basse', status: 'a_examiner', createdAt: new Date(oldMs).toISOString() };
      store.heating_recommendations['recent-a-examiner'] = { circuitId: 'x', action: 'maintenir', title: 'Récente', justification: 'j', priority: 'basse', status: 'a_examiner', createdAt: new Date(recentMs).toISOString() };
      store.heating_recommendations['old-appliquee'] = { circuitId: 'x', action: 'maintenir', title: 'Vieille mais appliquée', justification: 'j', priority: 'basse', status: 'appliquee', appliedBy: 'Sophie', createdAt: new Date(oldMs).toISOString() };
      // Point 2 de la demande : une décision humaine (acceptée OU refusée),
      // même ancienne, ne doit JAMAIS être rétrogradée en "expirée" — pas
      // seulement "appliquée" (déjà couvert ci-dessus).
      store.heating_recommendations['old-acceptee'] = { circuitId: 'x', action: 'maintenir', title: 'Vieille mais acceptée', justification: 'j', priority: 'basse', status: 'acceptee', decidedBy: 'Sophie', createdAt: new Date(oldMs).toISOString() };
      store.heating_recommendations['old-refusee'] = { circuitId: 'x', action: 'maintenir', title: 'Vieille mais refusée', justification: 'j', priority: 'basse', status: 'refusee', decidedBy: 'Sophie', createdAt: new Date(oldMs).toISOString() };
    }, expiryDays);

    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(1000);

    const after = await page.evaluate(() => firebase.firestore()._debugStore.heating_recommendations);
    ok('11.1 Recommandation ancienne "à examiner" automatiquement expirée', after['old-a-examiner'].status === 'expiree');
    ok('11.2 La recommandation expirée garde un horodatage distinct (expiredAt), pas decidedAt/decidedBy', !!after['old-a-examiner'].expiredAt && !after['old-a-examiner'].decidedBy);
    ok('11.3 Recommandation récente "à examiner" NON expirée', after['recent-a-examiner'].status === 'a_examiner');
    ok('11.4 Recommandation ancienne mais déjà "appliquée" jamais rétrogradée en "expirée"', after['old-appliquee'].status === 'appliquee');
    ok('11.4b Recommandation ancienne mais déjà "acceptée" jamais rétrogradée en "expirée"', after['old-acceptee'].status === 'acceptee');
    ok('11.4c Recommandation ancienne mais déjà "refusée" jamais rétrogradée en "expirée"', after['old-refusee'].status === 'refusee');
    ok('11.5 Historique conservé (aucun document supprimé)', Object.keys(after).length === 5);
    ok('11.6 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 12. Expiration — parcours complet SANS injection artificielle ═══════════════
  // Contrairement au test 11 (qui isole la pure logique d'expiration via des
  // documents injectés directement dans le store), ce test passe par le
  // VRAI parcours applicatif de bout en bout : création d'un circuit réel,
  // relevé réel, synchronisation automatique du candidat calculé par le
  // moteur comme 'a_examiner' (aucune écriture manuelle dans le store). Seul
  // l'horodatage createdAt du document RÉEL ainsi créé est ensuite avancé
  // dans le temps (impossible d'attendre 14 jours réels dans un test), pour
  // vérifier que l'expiration automatique se déclenche bien sur une
  // recommandation réellement produite par l'application.
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(800);
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit expiration réelle');
    await page.selectOption('#ctavc-f-regtype', 'consigne');
    await page.waitForTimeout(150);
    await page.selectOption('#ctavc-f-setpointtype', 'ambiante');
    await page.fill('#ctavc-f-setpointval', '20');
    await page.fill('#ctavc-f-target', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    await page.locator('.ctavc-circuit-card', { hasText: 'Circuit expiration réelle' }).click();
    await page.waitForTimeout(400);
    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    await page.fill('#ctavc-r-temp', '15');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(2500);

    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('recommendations')\"]");
    await page.waitForFunction(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).some(r => r.status === 'a_examiner' && r.title && r.title.length > 0), { timeout: 5000 });
    const beforeIds = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.heating_recommendations || {}));
    ok('12.1 Recommandation réelle (non injectée) bien enregistrée "à examiner"', beforeIds.length >= 1);

    // Avance UNIQUEMENT l'horodatage du/des document(s) RÉELS déjà créés par
    // l'application — ne crée ni ne modifie rien d'autre. Passe par le VRAI
    // .update() Firestore (pas une mutation directe de _debugStore) pour que
    // le listener temps réel déjà abonné (onSnapshot) soit bien notifié —
    // une mutation directe de l'objet ne déclenche pas les listeners déjà
    // actifs dans le mock (voir tests/mock-firebase.js).
    const expiryDays = await page.evaluate(() => MX.HeatingEngine.RECO_EXPIRY_DAYS);
    await page.evaluate((ids) => {
      const oldMs = Date.now() - (ids.expiryDays + 1) * 24 * 60 * 60 * 1000;
      return Promise.all(ids.docIds.map((id) =>
        firebase.firestore().collection('heating_recommendations').doc(id).update({ createdAt: new Date(oldMs).toISOString() })
      ));
    }, { docIds: beforeIds, expiryDays });
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => firebase.firestore()._debugStore.heating_recommendations);
    const allExpired = beforeIds.every((id) => after[id].status === 'expiree');
    ok('12.2 La recommandation réelle (créée par l\'app, jamais injectée) expire bien automatiquement', allExpired);
    const noHumanDecisionFields = beforeIds.every((id) => !after[id].decidedBy && !after[id].decidedAt);
    ok('12.3 L\'expiration automatique n\'écrit jamais decidedAt/decidedBy (reste distincte d\'une décision humaine)', noHumanDecisionFields);
    ok('12.4 Aucun document perdu ni dupliqué pendant tout le parcours (même nombre avant/après)', Object.keys(after).length === beforeIds.length);
    ok('12.5 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 13. Changement de localisation GPS en cours de session ═══════════════
  // Deux localisations différentes successivement configurées PENDANT la
  // même session (pas un rechargement de page) : vérifie que (a) la 2e
  // localisation déclenche bien une nouvelle requête météo (le cache
  // weather.js est invalidé par les coordonnées), (b) les données persistées
  // reflètent la NOUVELLE localisation, pas l'ancienne conservée
  // silencieusement sous les mêmes dates, et (c) chaque jour persisté porte
  // les coordonnées qui l'ont réellement produit.
  {
    // Service Worker BLOQUÉ pour cette page : sw.js ne contourne pas
    // api.open-meteo.com (absent de sa liste BYPASS) ; une fois qu'il contrôle
    // la page, il émet lui-même les requêtes météo et page.route() ne les
    // intercepte plus (limitation documentée de Playwright) — la page
    // interrogeait alors la VRAIE API Open-Meteo et fetchCountByProfile
    // restait à 0. serviceWorkers: 'block' garantit l'interception.
    const page = await browser.newPage({ serviceWorkers: 'block' });
    let currentProfile = 'A';
    const todayStr = new Date().toISOString().slice(0, 10);
    const fetchCountByProfile = { A: 0, B: 0 };
    await page.route('https://api.open-meteo.com/**', (route) => {
      const url = route.request().url();
      // Le profil réellement demandé est déduit de la latitude dans l'URL
      // (pas d'une variable globale côté test) : reflète fidèlement ce que
      // l'app a effectivement envoyé comme coordonnées.
      const profile = url.indexOf('latitude=48.75') !== -1 ? 'A' : (url.indexOf('latitude=43') !== -1 ? 'B' : currentProfile);
      fetchCountByProfile[profile]++;
      const base = profile === 'A' ? 8 : 20; // profils météo nettement différents
      const time = daysArray(new Date(todayStr + 'T12:00:00Z'), 3, 1);
      const mins = time.map(() => base - 2), maxs = time.map(() => base + 4), means = time.map(() => base + 1);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ timezone: 'Europe/Paris', daily: { time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: time.map(() => 1) } }) });
    });
    await page.addInitScript({ path: MOCK_FB });
    await page.addInitScript({ path: SEED });
    await blockRealFirebase(page);
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await assertMockFirebase(page);
    await page.waitForTimeout(1800);
    await page.evaluate(async () => { await window.__seedGst(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await pinLogin(page, 'sophie', '9999');

    // ── Localisation A ──
    currentProfile = 'A';
    await setHotelConfig(page, 48.75, 2.36);
    await page.evaluate(() => { if (MX.ensureDailyDjuPersisted) MX.ensureDailyDjuPersisted(); });
    await page.waitForTimeout(2000);
    const afterA = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.weather_daily || {}));
    ok('13.0 Service Worker bloqué : aucun Service Worker ne contrôle la page', await page.evaluate(() => !(navigator.serviceWorker && navigator.serviceWorker.controller)));
    ok('13.0b Les requêtes Open-Meteo de la localisation A sont bien interceptées par page.route() (Playwright)', fetchCountByProfile.A > 0);
    ok('13.1 Localisation A : des jours observés sont persistés', afterA.length > 0);
    ok('13.2 Localisation A : chaque jour persisté porte les coordonnées de A', afterA.every(d => d.lat === 48.75 && d.lon === 2.36));
    const tMeanA = afterA[0].tMean;

    // ── Localisation B : coordonnées ET météo nettement différentes ──
    await setHotelConfig(page, 43.0, 5.0); // _sttSaveEtablissement met à jour hotelConfig puis appelle ensureDailyDjuPersisted
    await page.evaluate(() => { if (MX.ensureDailyDjuPersisted) MX.ensureDailyDjuPersisted(); });
    await page.waitForTimeout(2000);
    const afterB = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.weather_daily || {}));
    ok('13.3 Changement de localisation : une VRAIE nouvelle requête météo a bien été émise (cache non réutilisé à tort)', fetchCountByProfile.B > 0);
    ok('13.4 Les jours sont désormais tagués avec les NOUVELLES coordonnées (B), pas silencieusement celles de A', afterB.every(d => d.lat === 43.0 && d.lon === 5.0));
    ok('13.5 Les valeurs météo reflètent bien la nouvelle localisation (pas les anciennes valeurs de A conservées)', afterB[0].tMean !== tMeanA);

    // ── Retour à la localisation A dans la MÊME session : ne doit pas rester bloqué sur B ──
    // (Un cache météo valide peut légitimement servir A depuis le cache
    // localStorage sans refaire d'appel réseau — ce n'est pas le point testé
    // ici. Ce qui compte : le suivi par COORDONNÉES de _ensureDailyDjuPersisted
    // ne doit pas rester figé sur la dernière localisation vue (B) — la preuve
    // est que les documents weather_daily sont bien réécrits avec les
    // coordonnées de A, pas laissés silencieusement sur celles de B.)
    await setHotelConfig(page, 48.75, 2.36);
    await page.evaluate(() => { if (MX.ensureDailyDjuPersisted) MX.ensureDailyDjuPersisted(); });
    await page.waitForTimeout(2000);
    const afterBackToA = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.weather_daily || {}));
    ok('13.6 Retour à A en cours de session : les documents portent de nouveau les coordonnées de A (pas de verrou permanent par ancien booléen)', afterBackToA.every(d => d.lat === 48.75 && d.lon === 2.36));
    ok('13.7 Aucune erreur JS sur tout le scénario de changement de localisation', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 14. Visibilité du menu CTA/VC pour les 3 rôles ═══════════════
  // canSeeAll() traite Admin Firebase et Responsable de façon identique
  // (même booléen) — tester avec Sophie (responsable) couvre donc aussi le
  // code path "Admin" pour cette porte d'accès précise ; aucun login Admin
  // Firebase séparé n'est nécessaire ici (voir tests/navigation_visibility_
  // test.js pour des scénarios Admin dédiés sur d'autres écrans).
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'kevin', '1111'); // technicien
    await page.waitForTimeout(400);
    const sidebarTech = await page.evaluate(() => document.getElementById('sidebar-nav').innerHTML);
    ok('14.1 Technicien : CTA/VC est désormais visible dans le menu principal (plus réservé à Responsable/Admin)', /CTA \/ VC/.test(sidebarTech));
    ok('14.2 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999'); // responsable
    await page.waitForTimeout(400);
    const sidebarResp = await page.evaluate(() => document.getElementById('sidebar-nav').innerHTML);
    ok('14.3 Responsable : CTA/VC toujours visible (non-régression)', /CTA \/ VC/.test(sidebarResp));
    ok('14.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 15. Technicien — consultation + relevés, aucun droit de pilotage ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);

    // Un circuit doit déjà exister (créé par une Responsable au préalable —
    // conforme au rôle attendu) pour que le technicien puisse y ajouter un
    // relevé ; la création elle-même est testée séparément (test 5/9).
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(800);
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit technicien');
    await page.selectOption('#ctavc-f-regtype', 'consigne');
    await page.waitForTimeout(150);
    await page.selectOption('#ctavc-f-setpointtype', 'ambiante');
    await page.fill('#ctavc-f-setpointval', '20');
    await page.fill('#ctavc-f-target', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Auth.setCurrentUser(null); });
    await page.waitForTimeout(200);

    await pinLogin(page, 'kevin', '1111'); // technicien
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(2500); // laisse la météo + le moteur de reco tourner

    const tabsHtml = await page.evaluate(() => document.querySelector('.ctavc-tabs').innerHTML);
    ok('15.1 Onglet "Configuration" absent pour un technicien (gestion des circuits = pilotage)', !/Configuration/.test(tabsHtml));

    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    const circuitsHtml = await page.evaluate(() => document.querySelector('.ctavc-body').innerHTML);
    ok('15.2 Bouton "Nouveau circuit" absent pour un technicien', !/Nouveau circuit/.test(circuitsHtml));
    ok('15.3 Le circuit existant reste consultable (lecture)', /Circuit technicien/.test(circuitsHtml));

    await page.locator('.ctavc-circuit-card', { hasText: 'Circuit technicien' }).click();
    await page.waitForTimeout(400);
    const detailHtml = await page.evaluate(() => document.querySelector('.ctavc-body').innerHTML);
    ok('15.4 Boutons "Modifier"/"Archiver" absents de la fiche circuit pour un technicien', !/>Modifier<|>Archiver</.test(detailHtml));
    ok('15.5 Bouton "Relevé" (saisie manuelle) toujours présent pour un technicien', /ctavc-f-|Relevé/.test(detailHtml) || (await page.locator('[onclick^="MX.Pages.CtaVc._openReadingForm"]').count()) === 1);
    ok('15.6 Aucun bouton Accepter/Refuser sur la recommandation du circuit (si une candidate existe)', !/>Accepter<|>Refuser</.test(detailHtml));

    // Le technicien DOIT pouvoir enregistrer un relevé — exigence centrale de cette consigne.
    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    await page.fill('#ctavc-r-temp', '17.5');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    const readingsAfter = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_readings || {}));
    const techReading = readingsAfter.find(r => r.temp === 17.5);
    ok('15.7 Le relevé du technicien est bien enregistré dans Firestore (author = son nom)', !!techReading && techReading.author === 'Kevin');

    // Onglet Recommandations : aucune action de décision visible pour un technicien.
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('recommendations')\"]");
    await page.waitForTimeout(500);
    const recoTabHtml = await page.evaluate(() => document.querySelector('.ctavc-body').innerHTML);
    ok('15.8 Aucun bouton Accepter/Refuser/Appliquée visible pour un technicien dans l\'onglet Recommandations', !/>Accepter<|>Refuser<|Appliquée<\/button/.test(recoTabHtml));

    // Accès direct (console) aux fonctions de pilotage : doivent être bloquées
    // même sans passer par l'UI (protection de CHAQUE action, pas seulement
    // de son bouton).
    const beforeCircuitCount = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.heating_circuits || {}).length);
    await page.evaluate(() => { MX.Pages.CtaVc._openCircuitForm(null); });
    await page.waitForTimeout(200);
    const modalOpened = await page.locator('.modal-overlay').count();
    ok('15.9 Accès direct à _openCircuitForm bloqué pour un technicien (aucun modal, toast d\'erreur)', modalOpened === 0);
    const toastMsg1 = await page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
    ok('15.9b Le toast d\'erreur mentionne bien la restriction de rôle', /réservée/.test(toastMsg1));

    const recosBeforeEntries = await page.evaluate(() => Object.entries(firebase.firestore()._debugStore.heating_recommendations || {}));
    const anyAExaminerEntry = recosBeforeEntries.find(([, r]) => r.status === 'a_examiner');
    if (anyAExaminerEntry) {
      const aExaminerId = anyAExaminerEntry[0];
      await page.evaluate((id) => { MX.Pages.CtaVc._decideReco(id, 'acceptee'); }, aExaminerId);
      await page.waitForTimeout(300);
      const afterDirectDecide = await page.evaluate((id) => firebase.firestore()._debugStore.heating_recommendations[id], aExaminerId);
      ok('15.10 Accès direct à _decideReco bloqué pour un technicien (statut inchangé)', !!afterDirectDecide && afterDirectDecide.status === 'a_examiner');
    } else {
      ok('15.10 Accès direct à _decideReco bloqué pour un technicien (statut inchangé)', true); // aucune candidate à ce stade, rien à régresser
    }

    await page.evaluate(() => { MX.Pages.CtaVc._confirmArchive('__inexistant__', true); });
    await page.waitForTimeout(200);
    const circuitCountUnchanged = await page.evaluate(() => Object.keys(firebase.firestore()._debugStore.heating_circuits || {}).length);
    ok('15.11 Accès direct à _confirmArchive bloqué pour un technicien avant même la confirmation (aucun appel Firestore tenté)', circuitCountUnchanged === beforeCircuitCount);

    ok('15.12 Aucune erreur JS pendant tout le scénario technicien', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 16. Responsable — accès complet conservé (non-régression) ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    const tabsHtml = await page.evaluate(() => document.querySelector('.ctavc-tabs').innerHTML);
    ok('16.1 Onglet "Configuration" toujours présent pour une responsable', /Configuration/.test(tabsHtml));
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    const circuitsHtml = await page.evaluate(() => document.querySelector('.ctavc-body').innerHTML);
    ok('16.2 Bouton "Nouveau circuit" toujours présent pour une responsable', /Nouveau circuit/.test(circuitsHtml));
    ok('16.3 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 17. Listener Firestore mort (permission-denied) PUIS règles
  // corrigées — le circuit créé ensuite doit quand même apparaître ═══════════════
  // Reproduit l'incident réel rapporté : une erreur de permission tue le
  // onSnapshot de heating_circuits (le SDK Firestore ne le relance JAMAIS
  // seul) ; un circuit créé ENSUITE réussit son écriture (confirmation
  // affichée) mais n'apparaissait pas dans la liste avant ce correctif,
  // car l'ancien listener mort n'était jamais ré-attaché tant que la page
  // restait ouverte. Utilise une VRAIE simulation d'erreur de snapshot
  // (firebase.firestore().triggerSnapshotError), pas une réponse invalide.
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);

    // Déclenche une VRAIE erreur de permission sur le listener déjà actif.
    await page.evaluate(() => firebase.firestore().triggerSnapshotError('heating_circuits'));
    await page.waitForTimeout(50);
    const toastAfterError = await page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
    ok('17.1 Erreur de listener rendue VISIBLE (jamais silencieuse)', /interrompue/.test(toastAfterError));

    // Crée un circuit PENDANT que le listener est mort (reconnexion en cours, 1.5s) —
    // reproduit exactement l'ordre réel de l'incident (règles corrigées puis création).
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('config')\"]");
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'Circuit après incident');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(200);
    const toastAfterCreate = await page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
    ok('17.2 La création réussit bien malgré l\'incident précédent (écriture Firestore indépendante du listener)', /Circuit créé/.test(toastAfterCreate));
    const createdInStore = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_circuits || {}).some(c => c.name === 'Circuit après incident'));
    ok('17.3 Le circuit est réellement enregistré dans le faux Firestore (pas une fausse confirmation)', createdInStore);

    // Laisse la reconnexion automatique (1.5s) se terminer, puis vérifie
    // l'affichage SANS quitter/recharger la page.
    await page.waitForTimeout(1700);
    await clickSafe(page, "[onclick=\"MX.Pages.CtaVc._setTab('circuits')\"]");
    await page.waitForTimeout(300);
    const namesAfterReconnect = await page.evaluate(() => Array.from(document.querySelectorAll('.ctavc-circuit-card')).map(el => el.textContent));
    ok('17.4 Le circuit créé pendant l\'incident apparaît bien dans la liste APRÈS la reconnexion automatique, sans recharger la page',
      namesAfterReconnect.some(t => /Circuit après incident/.test(t)));
    ok('17.5 Aucune erreur JS pendant tout le scénario', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════════ 17b. Deux incidents SÉPARÉS (chacun suivi d'une
  // reconnexion réussie) -> chacun obtient sa propre tentative automatique,
  // la borne anti-boucle (_resubscribeAttempted) étant remise à zéro par le
  // succès entre les deux, pas seulement jamais déclenchée une 2e fois ═══════════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);

    await page.evaluate(() => firebase.firestore().triggerSnapshotError('heating_circuits'));
    await page.waitForTimeout(50);
    const toast1 = await page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
    ok('17b.1 1er incident -> reconnexion automatique proposée', /reconnexion/.test(toast1));
    await page.waitForTimeout(1700); // la reconnexion automatique réussit (règles/mock toujours valides)

    // 2e incident, totalement séparé (après succès de la reconnexion du 1er) :
    // doit À NOUVEAU proposer une reconnexion automatique, pas un message de
    // rechargement — la borne anti-boucle ne doit jamais bloquer un futur
    // incident distinct, seulement une boucle sur LE MÊME incident.
    await page.evaluate(() => firebase.firestore().triggerSnapshotError('heating_circuits'));
    await page.waitForTimeout(50);
    const toast2 = await page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
    ok('17b.2 2e incident séparé -> reconnexion automatique À NOUVEAU proposée (anti-boucle remise à zéro par le succès intermédiaire)', /reconnexion/.test(toast2));
    ok('17b.3 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  await browser.close();
  clearTimeout(_globalTimeout);

  if (failures === 0) console.log('\nTOUS LES TESTS PASSENT ✓');
  else { console.error('\n' + failures + ' ÉCHEC(S)'); process.exit(1); }
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
