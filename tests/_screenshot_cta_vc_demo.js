// Script de capture d'écran RÉELLE de l'application (pas une maquette) —
// utilise le même harnais que les tests Playwright (mock-firebase.js),
// c'est-à-dire la VRAIE page/le VRAI code assets/js/pages/cta-vc.js rendu
// par un vrai navigateur Chromium, avec un backend Firestore simulé en
// mémoire (aucune requête réseau réelle vers Firebase).
//
// Toutes les données créées ici sont FICTIVES et marquées "[DÉMO]" dans
// leur nom — jamais mélangées avec une donnée réelle (qui n'existe nulle
// part dans ce bac à sable de toute façon).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED = path.join(__dirname, 'gst_seed.js');
const OUT_DIR = process.argv[2] || '/tmp/mx_screens';
fs.mkdirSync(OUT_DIR, { recursive: true });

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysArray(center, pastDays, forecastDays) {
  var out = [];
  for (var i = -pastDays; i <= forecastDays - 1; i++) { var d = new Date(center); d.setDate(d.getDate() + i); out.push(isoDate(d)); }
  return out;
}
function buildDailyPayload(todayStr) {
  var today = new Date(todayStr + 'T12:00:00Z');
  var time = daysArray(today, 7, 7);
  var mins = [], maxs = [], means = [], codes = [];
  time.forEach(function (d) {
    var isPast = d < todayStr;
    var base = isPast ? 11 : 4; // refroidissement à venir -> tendance DJU en hausse, visible sur le graphique
    mins.push(base - 2); maxs.push(base + 4); means.push(base + 1); codes.push(isPast ? 2 : 61);
  });
  return { timezone: 'Europe/Paris', daily: { time: time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: codes } };
}
async function mockOpenMeteo(page, todayStr) {
  await page.route('https://api.open-meteo.com/**', function (route) {
    var url = route.request().url();
    if (url.indexOf('current=') !== -1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 6, weather_code: 3 }, daily: { temperature_2m_min: [3], temperature_2m_max: [10] } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDailyPayload(todayStr)) });
  });
}
async function bootPage(page) {
  const todayStr = new Date().toISOString().slice(0, 10);
  await mockOpenMeteo(page, todayStr);
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ path: SEED });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { await window.__seedGst(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**://*.googleapis.com/**', r => r.abort());
  await ctx.route('**://*.gstatic.com/**', r => r.abort());
  const page = await ctx.newPage();
  await bootPage(page);
  await pinLogin(page, 'sophie', '9999'); // Sophie = Responsable (données de démo, voir tests/gst_seed.js)
  await setHotelConfig(page);

  // ── Données de démonstration — toutes explicitement marquées [DÉMO] ──
  await page.evaluate(async () => {
    window.__demo = {};
    window.__demo.cta1 = await MX.DB.addHeatingCircuit({
      name: 'CTA Hall [DÉMO]', type: 'cta', buildingId: 'batiment_1', zone: 'Hall principal',
      regulationType: 'vanne_3v', waterSetpoint: 45, waterLawCurve: 'Courbe constructeur n°3', targetTemp: 20,
    });
    window.__demo.cta2 = await MX.DB.addHeatingCircuit({
      name: 'CTA Bureaux [DÉMO]', type: 'cta', buildingId: 'batiment_2', zone: 'Bureaux étage 1',
      regulationType: 'consigne', setpointType: 'eau', setpointValue: 20, setpointUnit: '°C', ctaRangeMin: 18, ctaRangeMax: 22, targetTemp: 20,
    });
    window.__demo.vc1 = await MX.DB.addHeatingCircuit({
      name: 'VC Chambres [DÉMO]', type: 'vc', buildingId: 'batiment_2', zone: 'Chambres étage 2-4',
      regulationType: 'vanne_3v', waterSetpoint: 44, vcMaxTemp: 50, targetTemp: 20,
    });
    // Relevé 2 points récent pour CTA Bureaux (Bâtiment 2)
    await MX.DB.addHeatingReading({
      circuitId: window.__demo.cta2, zone: 'Bureaux étage 1',
      points: { point1: { waterTemp: 41, blowTemp: 24, ambientTemp: 20.5 }, point2: { waterTemp: 40, blowTemp: 23.5, ambientTemp: 20.2 } },
      recordedAt: new Date().toISOString(), author: 'Démo', comment: 'Relevé de démonstration [DÉMO]',
    });
    // Relevé 2 points récent pour VC Chambres (Bâtiment 2)
    await MX.DB.addHeatingReading({
      circuitId: window.__demo.vc1, zone: 'Chambres étage 2-4',
      points: { point1: { waterTemp: 44, blowTemp: 38, ambientTemp: 19.8 }, point2: { waterTemp: 42.5, blowTemp: 36.5, ambientTemp: 19.5 } },
      recordedAt: new Date().toISOString(), author: 'Démo', comment: 'Relevé de démonstration [DÉMO]',
    });
    // Un ancien relevé simple (legacy) pour CTA Hall Bâtiment 1 — illustre la
    // coexistence avec l'ancienne forme (pas de proposition MX pour ce
    // circuit : Bâtiment 1 = loi d'eau automatique, exclue par construction).
    await MX.DB.addHeatingReading({ circuitId: window.__demo.cta1, zone: 'Hall principal', temp: 20.3, recordedAt: new Date().toISOString(), author: 'Démo', comment: 'Relevé de démonstration [DÉMO]' });
  });
  await page.waitForTimeout(400);

  // Référence DJU configurée à 18°C (démonstration de la température de
  // référence réglable — voir config/heating_config).
  await page.evaluate(async () => { await MX.DB.saveHeatingConfig({ djuBaseTemp: 18 }); });
  await page.waitForTimeout(400);

  await page.evaluate(() => { MX.showPage('cta-vc'); });
  await page.waitForTimeout(2500); // laisse la météo + le moteur v2 calculer et synchroniser les propositions
  await dismissOverlays(page);

  // ── VUE 1/2/3 — Vue d'ensemble (bandeau météo/DJU + Bâtiment 1 + Bâtiment 2) ──
  await page.screenshot({ path: path.join(OUT_DIR, '01-vue-generale-desktop.png'), fullPage: true });

  // Close-ups ciblés (bâtiment 1 / bâtiment 2) pour plus de clarté
  const b1 = page.locator('.ctavc-building-card', { hasText: 'Bâtiment 1' }).first();
  if (await b1.count()) await b1.screenshot({ path: path.join(OUT_DIR, '02-batiment1-regulation-auto.png') });
  const b2 = page.locator('.ctavc-building-card', { hasText: 'Bâtiment 2' }).first();
  if (await b2.count()) await b2.screenshot({ path: path.join(OUT_DIR, '03-batiment2-regulation-manuelle.png') });

  // ── VUE 5 — close-up réseau VC (Point 1 / Point 2) ──
  const vcNetwork = page.locator('.ctavc-network', { hasText: 'VC Chambres' }).first();
  if (await vcNetwork.count()) await vcNetwork.screenshot({ path: path.join(OUT_DIR, '04-vc-points-mesure.png') });

  // ── VUE 4 — fiche circuit CTA (consigne, plage 18-22°C) ──
  await page.evaluate(() => { MX.Pages.CtaVc._setTab('circuits'); });
  await page.waitForTimeout(400);
  await dismissOverlays(page);
  const ctaCard = page.locator('.ctavc-circuit-card', { hasText: 'CTA Bureaux' }).first();
  if (await ctaCard.count()) { await ctaCard.click({ force: true }); await page.waitForTimeout(400); await dismissOverlays(page); }
  await page.screenshot({ path: path.join(OUT_DIR, '05-cta-fiche-circuit.png'), fullPage: true });

  // ── VUE 6 — Propositions MX : cycle de validation (avance une proposition) ──
  await page.evaluate(() => { MX.Pages.CtaVc._setTab('overview'); });
  await page.waitForTimeout(500);
  await dismissOverlays(page);
  const vcPropId = await page.evaluate(async (vcCircuitId) => {
    const all = Object.entries(firebase.firestore()._debugStore.heating_recommendations || {});
    const found = all.find(([id, r]) => r.circuitId === vcCircuitId && r.engineVersion === 'v2' && r.status === 'proposition_generee');
    return found ? found[0] : null;
  }, await page.evaluate(() => window.__demo.vc1));
  if (vcPropId) {
    await page.evaluate(async (id) => { await MX.DB.validateHeatingProposal(id, 'Sophie (démo)'); }, vcPropId);
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.showPage('cta-vc'); });
    await page.waitForTimeout(600);
    await dismissOverlays(page);
  }
  const b2After = page.locator('.ctavc-building-card', { hasText: 'Bâtiment 2' }).first();
  if (await b2After.count()) await b2After.screenshot({ path: path.join(OUT_DIR, '06-propositions-mx-cycle-validation.png') });

  // ── VUE 7 — Historique (graphiques + tableaux) ──
  await page.evaluate(() => { MX.Pages.CtaVc._setTab('history'); });
  await page.waitForTimeout(700);
  await dismissOverlays(page);
  await page.screenshot({ path: path.join(OUT_DIR, '07-historique-graphiques.png'), fullPage: true });

  // ── Configuration (référence DJU réglable, plages par défaut) ──
  await page.evaluate(() => { MX.Pages.CtaVc._setTab('config'); });
  await page.waitForTimeout(500);
  await dismissOverlays(page);
  await page.screenshot({ path: path.join(OUT_DIR, '08-configuration-dju.png'), fullPage: true });

  await ctx.close();

  // ── Version MOBILE (390x844) — vue d'ensemble + historique ──
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctxM.route('**://*.googleapis.com/**', r => r.abort());
  await ctxM.route('**://*.gstatic.com/**', r => r.abort());
  const pageM = await ctxM.newPage();
  await bootPage(pageM);
  await pinLogin(pageM, 'sophie', '9999');
  await setHotelConfig(pageM);
  await pageM.evaluate(async () => {
    const cid = await MX.DB.addHeatingCircuit({ name: 'VC Chambres [DÉMO]', type: 'vc', buildingId: 'batiment_2', zone: 'Chambres', regulationType: 'vanne_3v', waterSetpoint: 44, vcMaxTemp: 50, targetTemp: 20 });
    await MX.DB.addHeatingCircuit({ name: 'CTA Hall [DÉMO]', type: 'cta', buildingId: 'batiment_1', zone: 'Hall', regulationType: 'vanne_3v', waterSetpoint: 45, targetTemp: 20 });
    await MX.DB.addHeatingReading({ circuitId: cid, zone: 'Chambres', points: { point1: { waterTemp: 44, blowTemp: 38, ambientTemp: 19.8 }, point2: { waterTemp: 42.5, blowTemp: 36.5, ambientTemp: 19.5 } }, recordedAt: new Date().toISOString(), author: 'Démo' });
  });
  await pageM.waitForTimeout(400);
  await pageM.evaluate(() => { MX.showPage('cta-vc'); });
  await pageM.waitForTimeout(2500);
  await dismissOverlays(pageM);
  await pageM.screenshot({ path: path.join(OUT_DIR, '09-mobile-vue-generale.png'), fullPage: true });
  await pageM.evaluate(() => { MX.Pages.CtaVc._setTab('history'); });
  await pageM.waitForTimeout(700);
  await dismissOverlays(pageM);
  await pageM.screenshot({ path: path.join(OUT_DIR, '10-mobile-historique.png'), fullPage: true });

  await browser.close();
  console.log('Captures enregistrées dans ' + OUT_DIR);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });

async function setHotelConfig(page) {
  await page.evaluate(async (c) => {
    await firebase.firestore().collection('config').doc('hotel_config').set(c, { merge: true });
    MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, c);
  }, { lat: 48.75, lon: 2.36, cityLabel: 'Orly [DÉMO]' });
}
