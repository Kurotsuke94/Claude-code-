// Script de capture d'écran RÉELLE (pas une maquette) de la REFONTE DJU /
// CTA-VC + CONFIGURATION THERMIQUE — même harnais que
// tests/_screenshot_cta_vc_demo.js (mock-firebase.js, VRAIE page rendue
// par un VRAI Chromium, backend Firestore simulé en mémoire, aucune
// requête réseau réelle vers Firebase/Open-Meteo réels).
//
// Toutes les données créées ici sont FICTIVES et marquées "[DÉMO]" dans
// leur nom — jamais mélangées avec une donnée réelle. Les bâtiments ne
// sont JAMAIS codés en dur : ils sont créés via MX.DB.addHeatingBuilding
// / via le formulaire réel de la page Configuration thermique, exactement
// comme le ferait un Responsable.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED = path.join(__dirname, 'gst_seed.js');
const OUT_DIR = process.argv[2] || '/tmp/mx_screens_thermique';
fs.mkdirSync(OUT_DIR, { recursive: true });

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysArray(center, pastDays, forecastDays) {
  var out = [];
  for (var i = -pastDays; i <= forecastDays - 1; i++) { var d = new Date(center); d.setDate(d.getDate() + i); out.push(isoDate(d)); }
  return out;
}
function buildDailyPayload(todayStr) {
  var today = new Date(todayStr + 'T12:00:00Z');
  var time = daysArray(today, 10, 7);
  var mins = [], maxs = [], means = [], codes = [];
  time.forEach(function (d) {
    var isPast = d < todayStr;
    var base = isPast ? 10 : 3; // refroidissement à venir -> tendance DJU en hausse, visible sur le graphique
    mins.push(base - 2); maxs.push(base + 4); means.push(base + 1); codes.push(isPast ? 2 : 61);
  });
  return { timezone: 'Europe/Paris', daily: { time: time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: codes } };
}
async function mockOpenMeteo(page, todayStr) {
  await page.route('https://api.open-meteo.com/**', function (route) {
    var url = route.request().url();
    if (url.indexOf('current=') !== -1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 5, weather_code: 3 }, daily: { temperature_2m_min: [2], temperature_2m_max: [9] } }) });
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
async function setHotelConfig(page) {
  await page.evaluate(async (c) => {
    await firebase.firestore().collection('config').doc('hotel_config').set(c, { merge: true });
    MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, c);
  }, { lat: 48.75, lon: 2.36, cityLabel: 'Orly [DÉMO]' });
}
async function fillAndSubmit(page, fillFn, submitSelector) {
  await fillFn();
  await page.click(submitSelector, { force: true });
  await page.waitForTimeout(350);
  await dismissOverlays(page);
}
// Le bouton primaire de la modale ("Créer"/"Enregistrer"/"Ajouter") peut se
// trouver hors du viewport capturé (fenêtre réduite pour les captures) —
// on invoque directement le clic DOM (même handler onclick que l'utilisateur
// déclencherait réellement) plutôt que de dépendre du scroll Playwright.
async function clickModalPrimary(page) {
  await page.evaluate(() => { const b = document.querySelector('.modal-actions .primary-btn'); if (b) b.click(); });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**://*.googleapis.com/**', r => r.abort());
  await ctx.route('**://*.gstatic.com/**', r => r.abort());
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await bootPage(page);
  await pinLogin(page, 'sophie', '9999'); // Sophie = Responsable (voir tests/gst_seed.js)
  await setHotelConfig(page);
  await page.evaluate(async () => { await MX.DB.saveHeatingConfig({ djuBaseTemp: 18 }); });
  await page.waitForTimeout(300);

  // ══════════════ 1. CONFIGURATION THERMIQUE — bâtiments (RÉELLE interaction UI) ══════════════
  await page.evaluate(() => { MX.showPage('heating-config'); });
  await page.waitForTimeout(600);
  await dismissOverlays(page);

  // -- Ajout du bâtiment AUTOMATIQUE via le vrai formulaire --
  await page.click('[onclick="MX.Pages.HeatingConfig._openBuildingForm(null)"]', { force: true });
  await page.waitForSelector('#hc-b-name', { state: 'visible' });
  await page.fill('#hc-b-name', 'Bâtiment Les Tilleuls [DÉMO]');
  await page.fill('#hc-b-desc', 'Loi d\'eau existante gérée par la régulation du site — surveillance MX uniquement.');
  await page.selectOption('#hc-b-mode', 'automatique');
  await page.screenshot({ path: path.join(OUT_DIR, '09a-config-form-ajout-batiment.png') }); // preuve d'interaction réelle (formulaire rempli avant validation)
  await clickModalPrimary(page);
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  // -- Ajout du bâtiment MANUEL ASSISTÉ --
  await page.click('[onclick="MX.Pages.HeatingConfig._openBuildingForm(null)"]', { force: true });
  await page.waitForSelector('#hc-b-name', { state: 'visible' });
  await page.fill('#hc-b-name', 'Bâtiment Les Érables [DÉMO]');
  await page.fill('#hc-b-desc', 'Pas de loi d\'eau fiable — réglages physiques par le technicien, propositions DJU MX.');
  await page.selectOption('#hc-b-mode', 'manuel_assiste');
  await clickModalPrimary(page);
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  const { bidAuto, bidManuel } = await page.evaluate(() => {
    const list = Object.entries(firebase.firestore()._debugStore.heating_buildings || {});
    const auto = list.find(([, b]) => b.name.indexOf('Tilleuls') !== -1);
    const manuel = list.find(([, b]) => b.name.indexOf('Érables') !== -1);
    return { bidAuto: auto ? auto[0] : null, bidManuel: manuel ? manuel[0] : null };
  });

  await page.screenshot({ path: path.join(OUT_DIR, '09-config-batiments.png'), fullPage: true });

  // ══════════════ 2. CONFIGURATION THERMIQUE — installations ══════════════
  await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('installations'); });
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  // -- CTA (bâtiment manuel) : formulaire COMPLET (demande utilisateur,
  // passe de finalisation, point 4) — emplacement, type de régulation +
  // consigne actuelle, température cible, température min/max autorisées
  // (générales), plage de soufflage ET limites eau de batterie SÉPARÉES.
  // Limite d'eau de batterie VOLONTAIREMENT SERRÉE (40-42°C) pour la
  // capture PRIORITAIRE ci-dessous : le besoin calculé (mesure 43.5°C +
  // tendance DJU) dépassera cette limite, prouvant que le moteur la
  // respecte strictement au lieu de la dépasser (correction prioritaire).
  await page.click('[onclick="MX.Pages.HeatingConfig._openInstallationForm(null)"]', { force: true });
  await page.waitForSelector('#hc-i-name', { state: 'visible' });
  await page.fill('#hc-i-name', 'CTA Restaurant [DÉMO]');
  await page.selectOption('#hc-i-type', 'cta');
  await page.waitForTimeout(150);
  await page.selectOption('#hc-i-building', bidManuel);
  await page.fill('#hc-i-zone', 'Salle de restaurant [DÉMO]');
  await page.selectOption('#hc-i-regtype', 'consigne');
  await page.waitForSelector('#hc-i-setpointtype', { state: 'visible' });
  await page.selectOption('#hc-i-setpointtype', 'eau');
  await page.fill('#hc-i-setpointval', '44');
  await page.fill('#hc-i-target', '20');
  // Bornes générales volontairement LARGES (10-50°C) pour cette démo : elles
  // ne doivent pas masquer, dans CETTE capture, la limite spécifique d'eau
  // de batterie (40-42°C) qui est le point précis à prouver ci-dessous —
  // MX.HeatingEngine._intersectGeneralLimits resserre TOUJOURS avec la
  // borne la plus stricte, donc une borne générale plus large que la limite
  // spécifique n'a simplement aucun effet ici (comportement normal, déjà
  // couvert par les tests unitaires heating_engine_v2_test.js §6d).
  await page.fill('#hc-i-tempmin', '10');
  await page.fill('#hc-i-tempmax', '50');
  await page.fill('#hc-i-ctamin', '19');
  await page.fill('#hc-i-ctamax', '21');
  await page.fill('#hc-i-watermin', '40');
  await page.fill('#hc-i-watermax', '42');
  await page.screenshot({ path: path.join(OUT_DIR, '05a-config-form-cta-complet.png'), fullPage: true }); // preuve : formulaire d'installation complété (régulation, consigne, cible, min/max, soufflage, eau batterie)
  await clickModalPrimary(page);
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  // -- VC (bâtiment manuel) --
  await page.click('[onclick="MX.Pages.HeatingConfig._openInstallationForm(null)"]', { force: true });
  await page.waitForSelector('#hc-i-name', { state: 'visible' });
  await page.fill('#hc-i-name', 'VC Chambres Érables [DÉMO]');
  await page.selectOption('#hc-i-type', 'vc');
  await page.waitForTimeout(150);
  await page.selectOption('#hc-i-building', bidManuel);
  await page.fill('#hc-i-vcmax', '48');
  await clickModalPrimary(page);
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  // -- VC (bâtiment automatique) : MX doit uniquement surveiller, jamais proposer --
  await page.click('[onclick="MX.Pages.HeatingConfig._openInstallationForm(null)"]', { force: true });
  await page.waitForSelector('#hc-i-name', { state: 'visible' });
  await page.fill('#hc-i-name', 'VC Tilleuls [DÉMO]');
  await page.selectOption('#hc-i-type', 'vc');
  await page.waitForTimeout(150);
  await page.selectOption('#hc-i-building', bidAuto);
  await clickModalPrimary(page);
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  await page.screenshot({ path: path.join(OUT_DIR, '09b-config-installations.png'), fullPage: true });

  const { ctaId, vcManuelId, vcAutoId } = await page.evaluate(() => {
    const list = Object.entries(firebase.firestore()._debugStore.heating_circuits || {});
    const cta = list.find(([, c]) => c.name.indexOf('CTA Restaurant') !== -1);
    const vcM = list.find(([, c]) => c.name.indexOf('VC Chambres Érables') !== -1);
    const vcA = list.find(([, c]) => c.name.indexOf('VC Tilleuls') !== -1);
    return { ctaId: cta ? cta[0] : null, vcManuelId: vcM ? vcM[0] : null, vcAutoId: vcA ? vcA[0] : null };
  });

  // CORRECTION (passe de finalisation) : le formulaire "Ajouter une
  // installation" capture désormais lui-même regulationType/consigne/
  // targetTemp (voir capture 05a-config-form-cta-complet.png — déjà saisis
  // pour le CTA via le VRAI formulaire ci-dessus). Seul le VC manuel est
  // encore réglé directement en base ici (l'écran de démonstration ne
  // répète pas une 2e fois la même interaction déjà prouvée) — aucune
  // valeur de température n'est inventée, seul un réglage déjà démontré
  // fonctionnel est reproduit pour alimenter le Conseil prioritaire (vue 7).
  await page.evaluate(async ({ vcManuelId }) => {
    await MX.DB.updateHeatingCircuit(vcManuelId, { regulationType: 'vanne_3v', waterSetpoint: 44, targetTemp: 20 }, 'Démo');
  }, { vcManuelId });
  await page.waitForTimeout(300);

  // Relevés 2 points récents (saisis normalement depuis la page CTA/VC —
  // simulés ici directement en base pour illustrer l'écart situation
  // actuelle / proposition sur les captures).
  await page.evaluate(async ({ ctaId, vcManuelId, vcAutoId }) => {
    await MX.DB.addHeatingReading({ circuitId: ctaId, points: { point1: { waterTemp: 44, blowTemp: 24.5, ambientTemp: 20.8 }, point2: { waterTemp: 43, blowTemp: 24, ambientTemp: 20.5 } }, recordedAt: new Date().toISOString(), author: 'Démo', comment: 'Relevé [DÉMO]' });
    await MX.DB.addHeatingReading({ circuitId: vcManuelId, points: { point1: { waterTemp: 45, blowTemp: 39, ambientTemp: 19.6 }, point2: { waterTemp: 43.5, blowTemp: 37.5, ambientTemp: 19.3 } }, recordedAt: new Date().toISOString(), author: 'Démo', comment: 'Relevé [DÉMO]' });
    await MX.DB.addHeatingReading({ circuitId: vcAutoId, points: { point1: { waterTemp: 46, blowTemp: 40, ambientTemp: 20.1 }, point2: { waterTemp: 47, blowTemp: 41, ambientTemp: 20.4 } }, recordedAt: new Date().toISOString(), author: 'Démo', comment: 'Relevé [DÉMO]' });
  }, { ctaId, vcManuelId, vcAutoId });
  await page.waitForTimeout(400);

  // ══════════════ 3. CONFIGURATION THERMIQUE — pièces ══════════════
  await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('pieces'); });
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  async function addRoom(name, buildingId, floor, target) {
    await page.click('[onclick="MX.Pages.HeatingConfig._openRoomForm(null)"]', { force: true });
    await page.waitForSelector('#hc-r-name', { state: 'visible' });
    await page.fill('#hc-r-name', name);
    await page.selectOption('#hc-r-building', buildingId);
    await page.fill('#hc-r-floor', floor);
    await page.fill('#hc-r-target', String(target));
    return { submit: async () => { await clickModalPrimary(page); await page.waitForTimeout(350); await dismissOverlays(page); } };
  }
  const r1 = await addRoom('Chambre 101 [DÉMO]', bidManuel, 'Étage 1', 20);
  await page.screenshot({ path: path.join(OUT_DIR, '10a-config-form-ajout-piece.png') }); // preuve d'interaction réelle
  await r1.submit();
  const r2 = await addRoom('Chambre 204 [DÉMO]', bidManuel, 'Étage 2', 20);
  await r2.submit();
  const r3 = await addRoom('Salle de réunion [DÉMO]', bidManuel, 'RDC', 19);
  await r3.submit();

  await page.waitForTimeout(300);
  const { room1Id, room2Id, room3Id } = await page.evaluate(() => {
    const list = Object.entries(firebase.firestore()._debugStore.heating_rooms || {});
    const r1 = list.find(([, r]) => r.name.indexOf('101') !== -1);
    const r2 = list.find(([, r]) => r.name.indexOf('204') !== -1);
    const r3 = list.find(([, r]) => r.name.indexOf('réunion') !== -1);
    return { room1Id: r1 ? r1[0] : null, room2Id: r2 ? r2[0] : null, room3Id: r3 ? r3[0] : null };
  });

  // Relevés de température ambiante pour les 3 pièces (via MX.DB.addRoomReading
  // — AUCUNE interface de saisie dédiée n'existe encore pour un technicien ;
  // limitation explicitement signalée dans le bilan final, pas dissimulée).
  await page.evaluate(async ({ room1Id, room2Id, room3Id }) => {
    await MX.DB.addRoomReading(room1Id, 19.8, 'Démo', 'Relevé [DÉMO]');
    await MX.DB.addRoomReading(room2Id, 20.3, 'Démo', 'Relevé [DÉMO]');
    await MX.DB.addRoomReading(room3Id, 17.9, 'Démo', 'Relevé [DÉMO]'); // pièce froide -> illustrera le filtre / moyenne
  }, { room1Id, room2Id, room3Id });
  await page.waitForTimeout(400);

  // Désélection d'une pièce ("Salle de réunion" ne doit plus compter dans la moyenne)
  await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('pieces'); });
  await page.waitForTimeout(400);
  await dismissOverlays(page);
  const uncheckRow = page.locator('tr', { hasText: 'Salle de réunion' }).locator('input[type="checkbox"]');
  if (await uncheckRow.count()) { await uncheckRow.uncheck({ force: true }); await page.waitForTimeout(300); }
  await page.screenshot({ path: path.join(OUT_DIR, '10b-config-pieces-selection.png'), fullPage: true });

  // ══════════════ 4. CONFIGURATION THERMIQUE — courbe DJU / température ══════════════
  await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('courbes'); });
  await page.waitForTimeout(400);
  await dismissOverlays(page);
  await page.evaluate((bid) => { MX.Pages.HeatingConfig._setCurveBuilding(bid); }, bidManuel);
  await page.waitForTimeout(300);

  async function addCurvePoint(dju, temp, label) {
    await page.click('[onclick="MX.Pages.HeatingConfig._openCurvePointForm(null)"]', { force: true });
    await page.waitForSelector('#hc-c-dju', { state: 'visible' });
    await page.fill('#hc-c-dju', String(dju));
    await page.fill('#hc-c-temp', String(temp));
    await page.fill('#hc-c-period', label);
    await clickModalPrimary(page);
    await page.waitForTimeout(350);
    await dismissOverlays(page);
  }
  await addCurvePoint(2, 20.5, 'Doux [DÉMO]');
  await addCurvePoint(8, 19.5, 'Frais [DÉMO]');
  await addCurvePoint(15, 17.5, 'Froid [DÉMO]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '10-config-courbe-dju.png'), fullPage: true });

  // ── COMPARAISON INDIVIDUELLE DES PIÈCES (demande utilisateur, point 3) ──
  // Sélection de 2 pièces du même bâtiment (room1Id/room2Id déjà connus
  // depuis la section Pièces ci-dessus), évolution réelle jour par jour,
  // écarts à la cible et jours sans relevé affichés.
  // Un second relevé pour la Chambre 101, un jour plus tôt, pour que le
  // graphique montre une VRAIE évolution sur 2 jours (pas un point isolé).
  await page.evaluate(async (roomId) => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    await MX.DB.addRoomReading(roomId, 19.2, 'Démo', 'Relevé [DÉMO]', d);
  }, room1Id);
  await page.waitForTimeout(300);
  await page.evaluate(({ room1Id, room2Id }) => {
    MX.Pages.HeatingConfig._toggleCompareRoom(room1Id, true);
    MX.Pages.HeatingConfig._toggleCompareRoom(room2Id, true);
  }, { room1Id, room2Id });
  await page.waitForTimeout(400);
  const comparisonCard = page.locator('.ctavc-card', { hasText: 'Comparaison individuelle des pièces' }).first();
  if (await comparisonCard.count()) await comparisonCard.screenshot({ path: path.join(OUT_DIR, '10c-config-comparaison-pieces.png') });

  // ── ANALYSE DJU / TEMPÉRATURE INTÉRIEURE (demande utilisateur, point 5) ──
  // Laisse le temps à la météo (Open-Meteo mocké) de charger, pour que DJU
  // observé/prévisionnel et la température cible interpolée s'affichent.
  await page.waitForTimeout(2000);
  const analysisCard = page.locator('.ctavc-card', { hasText: 'Analyse DJU / température intérieure' }).first();
  if (await analysisCard.count()) await analysisCard.screenshot({ path: path.join(OUT_DIR, '10d-config-analyse-dju-temperature.png') });
  await page.screenshot({ path: path.join(OUT_DIR, '10e-config-courbes-vue-complete.png'), fullPage: true });

  console.log('Config thermique : bâtiments=' + JSON.stringify({ bidAuto, bidManuel }));
  console.log('Erreurs JS pendant la configuration :', pageErrors.length, pageErrors);

  // ══════════════ 4b. TECHNICIEN — consultation + relevé de pièce RÉEL (demande utilisateur, point 2) ══════════════
  // Même page/même bac à sable mock Firestore (persiste entre les sessions
  // PIN — voir confirmPin() dans assets/js/auth.js) : on bascule sur une
  // session technicien pour prouver l'accès en lecture + le VRAI formulaire
  // de relevé, sans perdre les bâtiments/pièces déjà créés par Sophie.
  await pinLogin(page, 'jordan', '2222'); // Jordan = Technicien (voir tests/gst_seed.js)
  await page.evaluate(() => { MX.showPage('heating-config'); });
  await page.waitForTimeout(500);
  await dismissOverlays(page);
  await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('batiments'); });
  await page.waitForTimeout(300);
  // Preuve : page accessible en consultation, AUCUN bouton "Ajouter"/"Modifier".
  await page.screenshot({ path: path.join(OUT_DIR, '11a-technicien-consultation-batiments.png'), fullPage: true });
  await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('pieces'); });
  await page.waitForTimeout(300);
  await page.click('[onclick="MX.Pages.HeatingConfig._openRoomReadingForm(null)"]', { force: true });
  await page.waitForSelector('#hc-rr-temp', { state: 'visible' });
  await page.selectOption('#hc-rr-building', bidManuel);
  await page.waitForTimeout(150);
  await page.selectOption('#hc-rr-room', room1Id);
  await page.fill('#hc-rr-temp', '19.6');
  await page.fill('#hc-rr-comment', 'Tournée du matin [DÉMO]');
  await page.screenshot({ path: path.join(OUT_DIR, '11b-technicien-releve-piece-formulaire.png'), fullPage: true }); // preuve d'interaction réelle avant validation
  await clickModalPrimary(page);
  await page.waitForTimeout(400);
  await dismissOverlays(page);
  const technicienReadingOk = await page.evaluate((roomId) => {
    return Object.values(firebase.firestore()._debugStore.heating_readings || {}).some(r => r.roomId === roomId && r.author === 'Jordan' && r.temp === 19.6);
  }, room1Id);
  console.log('Relevé technicien correctement enregistré avec auteur réel :', technicienReadingOk);

  // Reconnexion Responsable pour la suite du script (propositions MX
  // réservées Responsable/Admin pour la validation).
  await pinLogin(page, 'sophie', '9999');

  // ══════════════ 5. CTA/VC — vue d'ensemble (desktop) ══════════════
  await page.evaluate(() => { MX.showPage('cta-vc'); });
  await page.waitForTimeout(2500); // laisse la météo + le moteur v2 calculer et synchroniser les propositions
  await dismissOverlays(page);
  await page.screenshot({ path: path.join(OUT_DIR, '01-vue-generale-desktop.png'), fullPage: true });

  // ── VUE 3 — bâtiment automatique : surveillance uniquement ──
  const bAuto = page.locator('.ctavc-building-card', { hasText: 'Tilleuls' }).first();
  if (await bAuto.count()) await bAuto.screenshot({ path: path.join(OUT_DIR, '03-batiment-automatique-surveillance.png') });

  // ── VUE 4 — bâtiment manuel : comparaison situation actuelle / proposition ──
  const bManuel = page.locator('.ctavc-building-card', { hasText: 'Érables' }).first();
  if (await bManuel.count()) await bManuel.screenshot({ path: path.join(OUT_DIR, '04-batiment-manuel-comparaison.png') });

  // ── VUE 5 — CTA : séparation eau de batterie / soufflage, ET preuve
  // CORRECTION PRIORITAIRE — la proposition d'eau de batterie ne dépasse
  // JAMAIS la limite configurée (40-42°C ci-dessus), même si le besoin
  // calculé (mesure 43.5°C + tendance DJU) la dépasse : la valeur affichée
  // reste plafonnée à 42°C avec un badge "Limite atteinte" + avertissement
  // de puissance thermique possiblement insuffisante, visibles au même
  // endroit que le chiffre (jamais relégués à une note en petit texte).
  const ctaNet = page.locator('.ctavc-network', { hasText: 'CTA Restaurant' }).first();
  if (await ctaNet.count()) {
    await ctaNet.screenshot({ path: path.join(OUT_DIR, '05-cta-separation-eau-air.png') });
    await ctaNet.screenshot({ path: path.join(OUT_DIR, 'PRIORITE-cta-limite-eau-respectee.png') });
  }

  // ── VUE 6 — VC : mesures Point 1 (début réseau) / Point 2 (fin réseau) ──
  const vcNet = page.locator('.ctavc-network', { hasText: 'VC Chambres Érables' }).first();
  if (await vcNet.count()) await vcNet.screenshot({ path: path.join(OUT_DIR, '06-vc-points-debut-fin-reseau.png') });

  // ── VUE 7 — Conseil prioritaire du jour ──
  const topReco = page.locator('.ctavc-card--highlight').first();
  if (await topReco.count()) await topReco.screenshot({ path: path.join(OUT_DIR, '07-conseil-prioritaire-du-jour.png') });

  // ── VUE 8 — Historique DJU + graphiques thermiques ──
  await page.evaluate(() => { MX.Pages.CtaVc._setTab('history'); });
  await page.waitForTimeout(700);
  await dismissOverlays(page);
  await page.screenshot({ path: path.join(OUT_DIR, '08-historique-dju-graphiques.png'), fullPage: true });

  await ctx.close();

  // ══════════════ 6. Version MOBILE (390x844) — vue générale ══════════════
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctxM.route('**://*.googleapis.com/**', r => r.abort());
  await ctxM.route('**://*.gstatic.com/**', r => r.abort());
  const pageM = await ctxM.newPage();
  await bootPage(pageM);
  await pinLogin(pageM, 'sophie', '9999');
  await setHotelConfig(pageM);
  await pageM.evaluate(async () => { await MX.DB.saveHeatingConfig({ djuBaseTemp: 18 }); });
  await pageM.waitForTimeout(300);
  await pageM.evaluate(async () => {
    const bidA = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Les Tilleuls [DÉMO]', mode: 'automatique' }, 'Démo');
    const bidM = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Les Érables [DÉMO]', mode: 'manuel_assiste' }, 'Démo');
    const cta = await MX.DB.addHeatingCircuit({ name: 'CTA Restaurant [DÉMO]', type: 'cta', buildingId: bidM, ctaRangeMin: 19, ctaRangeMax: 21, waterTempMin: 40, waterTempMax: 65 });
    const vc = await MX.DB.addHeatingCircuit({ name: 'VC Chambres Érables [DÉMO]', type: 'vc', buildingId: bidM, vcMaxTemp: 48 });
    await MX.DB.addHeatingCircuit({ name: 'VC Tilleuls [DÉMO]', type: 'vc', buildingId: bidA });
    await MX.DB.addHeatingReading({ circuitId: cta, points: { point1: { waterTemp: 44, blowTemp: 24.5, ambientTemp: 20.8 }, point2: { waterTemp: 43, blowTemp: 24, ambientTemp: 20.5 } }, recordedAt: new Date().toISOString(), author: 'Démo' });
    await MX.DB.addHeatingReading({ circuitId: vc, points: { point1: { waterTemp: 45, blowTemp: 39, ambientTemp: 19.6 }, point2: { waterTemp: 43.5, blowTemp: 37.5, ambientTemp: 19.3 } }, recordedAt: new Date().toISOString(), author: 'Démo' });
  });
  await pageM.waitForTimeout(400);
  await pageM.evaluate(() => { MX.showPage('cta-vc'); });
  await pageM.waitForTimeout(2500);
  await dismissOverlays(pageM);
  await pageM.screenshot({ path: path.join(OUT_DIR, '02-vue-generale-mobile.png'), fullPage: true });

  await browser.close();
  console.log('Captures enregistrées dans ' + OUT_DIR);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
