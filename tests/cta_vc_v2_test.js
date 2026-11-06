// Tests Playwright (mock-firebase.js, même harnais que tests/cta_vc_test.js)
// pour la REFONTE CTA/VC v2 (quantitatif) : bâtiment/plafonds par circuit,
// relevé à 2 points, propositions chiffrées + cycle de validation à 5
// états, configuration DJU/plages éditable. Fichier SÉPARÉ de
// tests/cta_vc_test.js (déjà volumineux) pour ne couvrir que les AJOUTS de
// cette refonte — la non-régression du module v1 reste prouvée par ce
// fichier existant (exécuté séparément, toujours entièrement vert).
const path = require('path');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED = path.join(__dirname, 'gst_seed.js');

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
  for (var i = -pastDays; i <= forecastDays - 1; i++) { var d = new Date(center); d.setDate(d.getDate() + i); out.push(isoDate(d)); }
  return out;
}
// Tendance DJU en forte hausse (jours futurs nettement plus froids) — pour
// garantir un delta suffisant à exercer le moteur quantitatif v2 de façon
// déterministe (voir assets/js/utils/heating-engine.js:SENSITIVITY_C_PER_DJU_POINT).
function buildDailyPayload(todayStr) {
  var today = new Date(todayStr + 'T12:00:00Z');
  var time = daysArray(today, 7, 7);
  var mins = [], maxs = [], means = [], codes = [];
  time.forEach(function (d) {
    var isPast = d < todayStr;
    var base = isPast ? 10 : -2;
    mins.push(base - 2); maxs.push(base + 4); means.push(base + 1); codes.push(isPast ? 2 : 3);
  });
  return { timezone: 'Europe/Paris', daily: { time: time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: codes } };
}
async function mockOpenMeteo(page, todayStr) {
  await page.route('https://api.open-meteo.com/**', function (route) {
    var url = route.request().url();
    if (url.indexOf('current=') !== -1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 8, weather_code: 2 }, daily: { temperature_2m_min: [6], temperature_2m_max: [13] } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDailyPayload(todayStr)) });
  });
}
async function bootPage(page) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const todayStr = new Date().toISOString().slice(0, 10);
  await mockOpenMeteo(page, todayStr);
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ path: SEED });
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
async function clickSafe(page, selector) {
  await dismissOverlays(page);
  await page.click(selector, { force: true });
  await page.waitForTimeout(250);
  await dismissOverlays(page);
}
// CONFIGURATION THERMIQUE — les bâtiments sont désormais créés depuis
// l'interface (jamais 'batiment_1'/'batiment_2' codés en dur) : ce
// helper crée un bâtiment automatique et un bâtiment manuel RÉELS (via
// MX.DB.addHeatingBuilding, le même chemin que l'UI) pour que les
// scénarios existants continuent de représenter fidèlement l'architecture
// actuelle plutôt qu'un raccourci de test.
async function seedDemoBuildings(page) {
  return await page.evaluate(async () => {
    const autoId = await MX.DB.addHeatingBuilding({ name: 'Bâtiment 1 [DÉMO]', mode: 'automatique' }, 'Test');
    const manuelId = await MX.DB.addHeatingBuilding({ name: 'Bâtiment 2 [DÉMO]', mode: 'manuel_assiste' }, 'Test');
    return { autoId, manuelId };
  });
}
async function setHotelConfig(page, lat, lon) {
  await page.evaluate(async (c) => {
    await firebase.firestore().collection('config').doc('hotel_config').set(c, { merge: true });
    MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, c);
  }, { lat: lat, lon: lon, cityLabel: 'Orly' });
}

(async () => {
  const browser = await chromium.launch();

  // ═══════════ 1. Formulaire circuit — bâtiment + plafonds VC/CTA ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    const { autoId, manuelId } = await seedDemoBuildings(page);
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(800);

    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    ok('1.1 Sélecteur de bâtiment présent dans le formulaire circuit', await page.locator('#ctavc-f-building').count() === 1);
    ok('1.1b Les bâtiments créés depuis l\'interface apparaissent comme options (jamais codés en dur)', await page.locator('#ctavc-f-building option').count() >= 3); // "non assigné" + les 2 bâtiments créés
    await page.fill('#ctavc-f-name', 'VC Bâtiment 2');
    await page.selectOption('#ctavc-f-type', 'vc');
    await page.waitForTimeout(150);
    ok('1.2 Champ plafond VC apparaît pour le type "vc"', await page.locator('#ctavc-f-vcmax').count() === 1);
    await page.selectOption('#ctavc-f-building', manuelId);
    await page.fill('#ctavc-f-vcmax', '47');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    const vc = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_circuits || {}).find(c => c.name === 'VC Bâtiment 2'));
    ok('1.3 buildingId correctement enregistré (référence réelle vers heating_buildings)', vc && vc.buildingId === manuelId);
    ok('1.4 vcMaxTemp correctement enregistré (47, jamais > 50)', vc && vc.vcMaxTemp === 47);

    await clickSafe(page, '[onclick="MX.Pages.CtaVc._openCircuitForm(null)"]');
    await page.fill('#ctavc-f-name', 'CTA Bâtiment 1');
    await page.selectOption('#ctavc-f-type', 'cta');
    await page.waitForTimeout(150);
    ok('1.5 Champs plage de soufflage CTA apparaissent pour le type "cta"', await page.locator('#ctavc-f-ctamin').count() === 1 && await page.locator('#ctavc-f-ctamax').count() === 1);
    ok('1.5b Champs limites eau de batterie (séparés du soufflage) présents', await page.locator('#ctavc-f-watermin').count() === 1 && await page.locator('#ctavc-f-watermax').count() === 1);
    await page.selectOption('#ctavc-f-building', autoId);
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    const cta = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_circuits || {}).find(c => c.name === 'CTA Bâtiment 1'));
    ok('1.6 Circuit Bâtiment 1 correctement enregistré avec plage de soufflage par défaut (18/22)', cta && cta.buildingId === autoId && cta.ctaRangeMin === 18 && cta.ctaRangeMax === 22);

    ok('1.7 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 2. Vue d'ensemble — cartes Bâtiment 1 / Bâtiment 2 ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    const { autoId, manuelId } = await seedDemoBuildings(page);
    await page.evaluate(async (ids) => {
      await MX.DB.addHeatingCircuit({ name: 'VC B2', type: 'vc', buildingId: ids.manuelId });
      await MX.DB.addHeatingCircuit({ name: 'CTA B1', type: 'cta', buildingId: ids.autoId });
    }, { autoId, manuelId });
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(2200);

    ok('2.1 Carte "Bâtiment 1" affichée', (await page.locator('.ctavc-building-card', { hasText: 'Bâtiment 1' }).count()) >= 1);
    ok('2.2 Carte "Bâtiment 2" affichée', (await page.locator('.ctavc-building-card', { hasText: 'Bâtiment 2' }).count()) >= 1);
    ok('2.3 Le circuit VC B2 apparaît dans la carte Bâtiment 2', (await page.locator('.ctavc-network-name', { hasText: 'VC B2' }).count()) === 1);
    ok('2.4 Le circuit CTA B1 apparaît dans la carte Bâtiment 1, avec exclusion explicite (régulation automatique)', (await page.locator('.ctavc-network', { hasText: 'CTA B1' }).first().innerText()).toLowerCase().includes('automatique'));
    ok('2.5 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 3. Relevé à 2 points — option, jamais automatique ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    const { manuelId } = await seedDemoBuildings(page);
    let circuitId;
    await page.evaluate(async (manuelId) => { window.__v2cid = await MX.DB.addHeatingCircuit({ name: 'VC Relevé 2pts', type: 'vc', buildingId: manuelId }); }, manuelId);
    await page.waitForTimeout(300);
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('circuits'));
    await page.waitForTimeout(400);
    await page.locator('.ctavc-circuit-card', { hasText: 'VC Relevé 2pts' }).click();
    await page.waitForTimeout(400);

    await clickSafe(page, '[onclick^="MX.Pages.CtaVc._openReadingForm"]');
    ok('3.1 Case "Relevé à 2 points" proposée pour un circuit VC', await page.locator('#ctavc-r-2pt-toggle').count() === 1);
    ok('3.2 Par défaut, le champ simple (#ctavc-r-temp) reste affiché (non-régression)', await page.locator('#ctavc-r-temp').count() === 1);
    await dismissOverlays(page); // la modale "nouveautés" (2.5s après le chargement) peut apparaître ici et intercepter le clic suivant
    await page.check('#ctavc-r-2pt-toggle');
    await page.waitForTimeout(150);
    ok('3.3 Activation : les champs Point 1/Point 2 apparaissent', await page.locator('#ctavc-r-p1-water').count() === 1 && await page.locator('#ctavc-r-p2-water').count() === 1);
    ok('3.4 Le champ simple disparaît une fois le mode 2 points activé', await page.locator('#ctavc-r-temp').count() === 0);
    await page.fill('#ctavc-r-p1-water', '45'); await page.fill('#ctavc-r-p1-blow', '40'); await page.fill('#ctavc-r-p1-ambient', '19');
    await page.fill('#ctavc-r-p2-water', '46'); await page.fill('#ctavc-r-p2-blow', '41'); await page.fill('#ctavc-r-p2-ambient', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);

    const cid = await page.evaluate(() => window.__v2cid);
    const reading = await page.evaluate((cid) => Object.values(firebase.firestore()._debugStore.heating_readings || {}).find(r => r.circuitId === cid), cid);
    ok('3.5 Le relevé 2 points est bien enregistré avec la structure points.point1/point2', !!(reading && reading.points && reading.points.point1 && reading.points.point2));
    ok('3.6 Point 1 eau = 45, Point 2 eau = 46 (valeurs correctement attribuées, jamais interverties)', reading.points.point1.waterTemp === 45 && reading.points.point2.waterTemp === 46);
    ok('3.7 Aucun champ "temp" (ancienne forme) sur ce document (pas de mélange des 2 formes)', !('temp' in reading));
    ok('3.8 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 4. Proposition quantitative — cycle complet de validation ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    const { manuelId: manuelId4 } = await seedDemoBuildings(page);
    await page.evaluate(async (manuelId) => {
      window.__v2cid2 = await MX.DB.addHeatingCircuit({ name: 'VC Cycle complet', type: 'vc', buildingId: manuelId });
      await MX.DB.addHeatingReading({
        circuitId: window.__v2cid2,
        points: { point1: { waterTemp: 42, blowTemp: 38, ambientTemp: 19 }, point2: { waterTemp: 43, blowTemp: 39, ambientTemp: 20 } },
        recordedAt: new Date().toISOString(), author: 'Sophie',
      });
    }, manuelId4);
    await page.waitForTimeout(300);
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(2500); // laisse la météo + le moteur v2 calculer et synchroniser

    const afterSync = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).filter(r => r.engineVersion === 'v2'));
    ok('4.1 Une proposition v2 a été calculée et persistée automatiquement ("proposition_generee")', afterSync.some(r => r.status === 'proposition_generee'));
    const propId = Object.keys((await page.evaluate(() => firebase.firestore()._debugStore.heating_recommendations)) || {}).find(async () => true);

    ok('4.2 La comparaison "Situation actuelle"/"Proposition DJU MX" est affichée', (await page.locator('.ctavc-compare').count()) >= 1);
    ok('4.3 Les cartes Point 1 et Point 2 sont affichées', (await page.locator('.ctavc-point-card').count()) >= 2);
    ok('4.4 Le bouton "Valider" est proposé à la Responsable', (await page.locator('button', { hasText: 'Valider' }).count()) >= 1);

    await clickSafe(page, 'button:has-text("Valider")');
    await page.waitForTimeout(400);
    let doc = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).find(r => r.engineVersion === 'v2' && r.status === 'validee'));
    ok('4.5 Après "Valider" : statut "validee" enregistré avec validatedBy', !!(doc && doc.validatedBy));

    await page.evaluate(() => MX.showPage('cta-vc')); // re-render pour afficher le bouton suivant
    await page.waitForTimeout(600);
    ok('4.6 Bouton "Réglage effectué" proposé après validation', (await page.locator('button:has-text("Réglage effectué")').count()) >= 1);
    await clickSafe(page, 'button:has-text("Réglage effectué")');
    await page.fill('#ctavc-apply-val', '44');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    doc = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).find(r => r.engineVersion === 'v2' && r.status === 'reglage_effectue'));
    ok('4.7 Après "Réglage effectué" : appliedValue=44 enregistré', !!(doc && doc.appliedValue === 44));

    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(600);
    await clickSafe(page, 'button:has-text("Confirmer la consigne réelle")');
    await page.fill('#ctavc-confirm-val', '43.5');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    doc = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).find(r => r.engineVersion === 'v2' && r.status === 'consigne_confirmee'));
    ok('4.8 Après confirmation : consigne_confirmee avec confirmedValue=43.5', !!(doc && doc.confirmedValue === 43.5));

    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(600);
    await clickSafe(page, 'button:has-text("Relevé de contrôle")');
    ok('4.9 Le relevé de contrôle est forcé en mode 2 points (pas de case à cocher)', await page.locator('#ctavc-r-2pt-toggle').count() === 0 && await page.locator('#ctavc-r-p1-water').count() === 1);
    await page.fill('#ctavc-r-p1-water', '43'); await page.fill('#ctavc-r-p1-blow', '39'); await page.fill('#ctavc-r-p1-ambient', '20');
    await page.fill('#ctavc-r-p2-water', '44'); await page.fill('#ctavc-r-p2-blow', '40'); await page.fill('#ctavc-r-p2-ambient', '20');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(500);
    doc = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).find(r => r.engineVersion === 'v2' && r.status === 'controle_effectue'));
    ok('4.10 Cycle complet : statut final "controle_effectue" avec controlReadingId renseigné', !!(doc && doc.controlReadingId));

    ok('4.11 Aucune erreur JS sur tout le cycle', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 5. Configuration — référence DJU et plages par défaut éditables ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await setHotelConfig(page, 48.75, 2.36);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => MX.showPage('cta-vc'));
    await page.waitForTimeout(400);
    await page.evaluate(() => MX.Pages.CtaVc._setTab('config'));
    await page.waitForTimeout(400);

    ok('5.1 Champ référence DJU éditable présent', await page.locator('#ctavc-cfg-djubase').count() === 1);
    await page.fill('#ctavc-cfg-djubase', '17');
    await page.fill('#ctavc-cfg-vcmax', '48');
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._saveHeatingConfigForm()"]');
    await page.waitForTimeout(400);
    const cfg = await page.evaluate(() => (firebase.firestore()._debugStore.config || {}).heating_config);
    ok('5.2 djuBaseTemp=17 bien enregistré dans config/heating_config', !!(cfg && cfg.djuBaseTemp === 17));
    ok('5.3 vcMaxTemp=48 bien enregistré', !!(cfg && cfg.vcMaxTemp === 48));

    // Tentative malveillante côté formulaire (contournement du max="50" HTML) :
    // revalidée en JS avant tout appel Firestore.
    await page.fill('#ctavc-cfg-vcmax', '90');
    await clickSafe(page, '[onclick="MX.Pages.CtaVc._saveHeatingConfigForm()"]');
    await page.waitForTimeout(300);
    const cfg2 = await page.evaluate(() => (firebase.firestore()._debugStore.config || {}).heating_config);
    ok('5.4 Une tentative de plafond VC > 50°C est rejetée côté client (valeur précédente conservée)', cfg2.vcMaxTemp === 48);

    ok('5.5 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  await browser.close();
  clearTimeout(_globalTimeout);
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests REFONTE CTA/VC v2 (Playwright, mock Firestore) passent.');
  process.exit(failures ? 1 : 0);
})();
