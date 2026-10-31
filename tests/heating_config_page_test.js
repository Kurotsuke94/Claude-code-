// Tests Playwright (mock-firebase.js, même harnais que tests/cta_vc_test.js)
// pour la nouvelle page CONFIGURATION THERMIQUE (assets/js/pages/
// heating-config.js) : bâtiments, installations, pièces, courbes DJU /
// température intérieure, et leurs permissions (Responsable/Admin vs
// Technicien). Teste la VRAIE page rendue par un vrai Chromium, backend
// Firestore simulé en mémoire — jamais une maquette.
const path = require('path');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

const _globalTimeout = setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (180s) — le process est arrêté de force.');
  process.exit(1);
}, 180000);

async function bootPage(page) {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 8, weather_code: 2 }, daily: { temperature_2m_min: [6], temperature_2m_max: [13] } }) }));
  await page.addInitScript({ path: MOCK_FB });
  await page.addInitScript({ path: SEED });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { await window.__seedGst(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
  return { pageErrors };
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
// Sans localisation configurée, l'onglet "Vue d'ensemble" de CTA/VC affiche
// un message "Localisation non configurée" et ne rend AUCUNE carte bâtiment
// (voir assets/js/pages/cta-vc.js:_overviewHtml) — même mécanique que
// tests/cta_vc_v2_test.js:setHotelConfig, nécessaire ici pour la section 6
// qui vérifie l'affichage réel de la carte bâtiment automatique.
async function setHotelConfig(page, lat, lon) {
  await page.evaluate(async (c) => {
    await firebase.firestore().collection('config').doc('hotel_config').set(c, { merge: true });
    MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, c);
  }, { lat: lat, lon: lon, cityLabel: 'Orly' });
}

(async () => {
  const browser = await chromium.launch();

  // ═══════════ 1. Technicien : consultation + relevés autorisés, AUCUN droit de configuration structurelle ═══════════
  // SÉCURISATION (passe de finalisation, demande utilisateur point 2) : un
  // technicien doit pouvoir atteindre cette page pour saisir un relevé de
  // température de pièce — il n'est donc plus redirigé. Ce qui reste
  // interdit : créer/modifier/archiver un bâtiment, une installation, une
  // pièce ou un point de courbe (voir _canManage()/_denyManage() dans
  // heating-config.js, ET les règles Firestore qui restent la vraie limite).
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'jordan', '2222'); // technicien, voir tests/gst_seed.js
    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(500);
    ok('1.1 Un technicien N\'EST PLUS redirigé — la page s\'affiche bien pour lui (consultation)', (await page.evaluate(() => MX.state.currentPage)) === 'heating-config');
    ok('1.2 Le titre de la page est bien rendu', !!(await page.locator('.page-title', { hasText: 'Configuration thermique' }).count()));
    ok('1.3 Aucun bouton "Ajouter un bâtiment" (configuration structurelle réservée)', !(await page.locator('text=Ajouter un bâtiment').count()));
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('pieces'); });
    await page.waitForTimeout(300);
    ok('1.4 Le bouton "Nouveau relevé de température" (Pièces) est bien accessible au technicien', !!(await page.locator('text=Nouveau relevé de température').count()));
    const noFormOpened = await page.evaluate(() => { MX.Pages.HeatingConfig._openBuildingForm(null); return !document.getElementById('hc-b-name'); });
    ok('1.5 Appel direct à une action de configuration (_openBuildingForm) refusée malgré l\'accès en lecture à la page', noFormOpened);
    ok('1.6 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 2. Bâtiments — création, modification, modes ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999'); // responsable
    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(500);
    ok('2.1 Page Configuration thermique accessible à une Responsable', (await page.locator('.page-title', { hasText: 'Configuration thermique' }).count()) === 1);
    ok('2.2 4 onglets présents (Bâtiments/Installations/Pièces/Courbes)', (await page.locator('.ctavc-tab').count()) === 4);

    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._openBuildingForm(null)"]');
    await page.fill('#hc-b-name', 'Bâtiment Test [DÉMO]');
    await page.selectOption('#hc-b-mode', 'automatique');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    let building = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_buildings || {}).find(b => b.name === 'Bâtiment Test [DÉMO]'));
    ok('2.3 Bâtiment créé avec mode:automatique', !!(building && building.mode === 'automatique'));
    ok('2.4 createdBy enregistré (traçabilité)', building.createdBy === 'Sophie');

    const buildingId = Object.keys(await page.evaluate(() => firebase.firestore()._debugStore.heating_buildings)).find(async () => true);
    ok('2.5 Une entrée d\'audit a été créée à la création du bâtiment', (await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_config_audit || {}).filter(a => a.entityType === 'building'))).length >= 1);

    // Modification — bouton "Modifier" de la fiche (jamais "Ajouter", dont
    // l'onclick partage le même préfixe _openBuildingForm(null)).
    await clickSafe(page, '.ctavc-detail-actions [onclick^="MX.Pages.HeatingConfig._openBuildingForm"]');
    await page.fill('#hc-b-name', 'Bâtiment Test Renommé [DÉMO]');
    await page.selectOption('#hc-b-mode', 'manuel_assiste');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    building = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_buildings || {})[0]);
    ok('2.6 Bâtiment modifié (nom + mode)', building.name === 'Bâtiment Test Renommé [DÉMO]' && building.mode === 'manuel_assiste');
    const auditEntries = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_config_audit || {}));
    ok('2.7 L\'audit de la modification trace ancienne ET nouvelle valeur du nom', auditEntries.some(a => a.changes && a.changes.name && a.changes.name.old === 'Bâtiment Test [DÉMO]' && a.changes.name.new === 'Bâtiment Test Renommé [DÉMO]'));

    ok('2.8 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 3. Installations — création, association bâtiment, limites séparées ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(async () => { window.__bid = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Install [DÉMO]', mode: 'manuel_assiste' }, 'Sophie'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('installations'); });
    await page.waitForTimeout(300);

    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._openInstallationForm(null)"]');
    await page.fill('#hc-i-name', 'CTA Test [DÉMO]');
    await page.selectOption('#hc-i-type', 'cta');
    await page.waitForTimeout(150);
    const bid = await page.evaluate(() => window.__bid);
    await page.selectOption('#hc-i-building', bid);
    // Formulaire complété (demande utilisateur, point 4) : emplacement,
    // type de régulation + consigne actuelle, température cible, limites
    // générales min/max, EN PLUS des champs CTA déjà existants.
    const buildingModeText = await page.locator('#hc-i-buildingmode').innerText();
    ok('3.0 Le mode du bâtiment associé s\'affiche (lecture seule) dès la sélection', /manuel/i.test(buildingModeText));
    await page.fill('#hc-i-zone', 'Chambres étage 2 [DÉMO]');
    await page.selectOption('#hc-i-regtype', 'consigne');
    await page.waitForSelector('#hc-i-setpointtype', { state: 'visible' });
    await page.selectOption('#hc-i-setpointtype', 'eau');
    await page.fill('#hc-i-setpointval', '43.5');
    await page.fill('#hc-i-target', '20');
    await page.fill('#hc-i-tempmin', '15');
    await page.fill('#hc-i-tempmax', '21');
    await page.fill('#hc-i-ctamin', '19');
    await page.fill('#hc-i-ctamax', '21');
    await page.fill('#hc-i-watermin', '40');
    await page.fill('#hc-i-watermax', '65');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    const inst = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_circuits || {}).find(c => c.name === 'CTA Test [DÉMO]'));
    ok('3.1 Installation créée et associée au bâtiment', !!(inst && inst.buildingId === bid));
    ok('3.2 Plage de soufflage enregistrée (19-21)', inst.ctaRangeMin === 19 && inst.ctaRangeMax === 21);
    ok('3.3 Limites eau de batterie enregistrées SÉPARÉMENT (40-65), jamais confondues avec le soufflage', inst.waterTempMin === 40 && inst.waterTempMax === 65 && inst.waterTempMin !== inst.ctaRangeMin);
    ok('3.3b Emplacement/zone enregistré', inst.zone === 'Chambres étage 2 [DÉMO]');
    ok('3.3c Type de régulation + consigne actuelle enregistrés', inst.regulationType === 'consigne' && inst.setpointType === 'eau' && inst.setpointValue === 43.5);
    ok('3.3d Température cible enregistrée', inst.targetTemp === 20);
    ok('3.3e Températures min/max générales enregistrées', inst.tempMin === 15 && inst.tempMax === 21);

    // RÉELLEMENT utilisé par le moteur v1 (Conseil prioritaire du jour) :
    // avant cette passe, une installation créée depuis CETTE page restait
    // invisible à evaluateCircuit() faute de regulationType (voir
    // heating-engine.js:_regulationKnown, qui exige regulationType +
    // setpointType + setpointValue pour le cas 'consigne').
    ok('3.3f Le moteur dispose bien des champs requis pour évaluer cette installation (_regulationKnown)', !!inst.regulationType && !!inst.setpointType && typeof inst.setpointValue === 'number');

    ok('3.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 4. Pièces — création, sélection (trackedActive), archivage non destructif ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(async () => { window.__bid2 = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Pièces [DÉMO]', mode: 'manuel_assiste' }, 'Sophie'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('pieces'); });
    await page.waitForTimeout(300);

    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._openRoomForm(null)"]');
    await page.fill('#hc-r-name', 'Chambre 101 [DÉMO]');
    const bid2 = await page.evaluate(() => window.__bid2);
    await page.selectOption('#hc-r-building', bid2);
    await page.fill('#hc-r-target', '21');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    let roomId = await page.evaluate(() => { const f = Object.entries(firebase.firestore()._debugStore.heating_rooms || {}).find(([id, r]) => r.name === 'Chambre 101 [DÉMO]'); return f ? f[0] : null; });
    let room = await page.evaluate((id) => firebase.firestore()._debugStore.heating_rooms[id], roomId);
    ok('4.1 Pièce créée, associée au bâtiment, suivie par défaut (trackedActive)', !!(room && room.buildingId === bid2 && room.trackedActive === true));

    // Désélection (décocher "Suivie")
    await clickSafe(page, 'input[onchange^="MX.Pages.HeatingConfig._toggleRoomTracked"]');
    await page.waitForTimeout(300);
    room = await page.evaluate((id) => firebase.firestore()._debugStore.heating_rooms[id], roomId);
    ok('4.2 Désélection : trackedActive passe à false (la pièce n\'influencera plus la moyenne)', room.trackedActive === false);

    // Archivage — relevés jamais supprimés
    await page.evaluate(async (roomId) => { await MX.DB.addRoomReading(roomId, 20.5, 'Jordan', ''); }, roomId);
    await page.waitForTimeout(300);
    page.once('dialog', d => d.accept());
    await clickSafe(page, '[onclick^="MX.Pages.HeatingConfig._archiveRoom"]');
    await page.waitForTimeout(400);
    const readingsAfter = await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_readings || {}));
    ok('4.3 Archivage de la pièce : le relevé déjà enregistré reste présent (jamais supprimé)', readingsAfter.some(r => r.roomId === roomId));
    const roomAfter = await page.evaluate((id) => firebase.firestore()._debugStore.heating_rooms[id], roomId);
    ok('4.4 La pièce est bien marquée archivée (pas supprimée du tout)', roomAfter.archived === true);

    ok('4.5 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 5. Courbes — points, modification, suppression, graphique ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(async () => { window.__bid3 = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Courbe [DÉMO]', mode: 'manuel_assiste' }, 'Sophie'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('courbes'); });
    await page.waitForTimeout(300);
    const bid3 = await page.evaluate(() => window.__bid3);
    await page.evaluate((bid) => { MX.Pages.HeatingConfig._setCurveBuilding(bid); }, bid3);
    await page.waitForTimeout(300);

    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._openCurvePointForm(null)"]');
    await page.fill('#hc-c-dju', '5');
    await page.fill('#hc-c-temp', '21');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._openCurvePointForm(null)"]');
    await page.fill('#hc-c-dju', '12');
    await page.fill('#hc-c-temp', '18');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    let pointEntries = await page.evaluate(() => Object.entries(firebase.firestore()._debugStore.heating_curve_points || {}));
    ok('5.1 2 points de courbe créés', pointEntries.length === 2);
    ok('5.2 Le graphique SVG de la courbe est rendu (2 points suffisent)', (await page.locator('.ra-svg-wrap svg').count()) >= 1);

    // Modification d'un point
    const firstPointId = pointEntries[0][0];
    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._openCurvePointForm(\'' + firstPointId + '\')"]');
    await page.fill('#hc-c-temp', '22');
    await clickSafe(page, '.modal-btn.primary-btn');
    await page.waitForTimeout(400);
    const updated = await page.evaluate((id) => firebase.firestore()._debugStore.heating_curve_points[id], firstPointId);
    ok('5.3 Point de courbe modifié (22°C)', updated.expectedIndoorTemp === 22);

    // Suppression — SEULE collection heating_* où delete est permis
    page.on('dialog', d => d.accept());
    await clickSafe(page, '[onclick="MX.Pages.HeatingConfig._deleteCurvePoint(\'' + firstPointId + '\')"]');
    await page.waitForTimeout(400);
    pointEntries = await page.evaluate(() => Object.entries(firebase.firestore()._debugStore.heating_curve_points || {}));
    ok('5.4 Point de courbe supprimé (1 restant) — suppression définitive permise ici uniquement', pointEntries.length === 1);

    ok('5.5 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 5b. NOUVEAU — comparaison individuelle des pièces (demande utilisateur, finalisation) ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    const { bid, r1, r2 } = await page.evaluate(async () => {
      const bid = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Comparaison [DÉMO]', mode: 'manuel_assiste' }, 'Sophie');
      const r1 = await MX.DB.addHeatingRoom({ name: 'Chambre 201 [DÉMO]', buildingId: bid, targetTemp: 20, trackedActive: true }, 'Sophie');
      const r2 = await MX.DB.addHeatingRoom({ name: 'Chambre 202 [DÉMO]', buildingId: bid, targetTemp: 19, trackedActive: true }, 'Sophie');
      await MX.DB.addRoomReading(r1, 19.3, 'Sophie', ''); // aujourd'hui seulement -> 6 jours de trou sur 7
      await MX.DB.addRoomReading(r2, 18.5, 'Sophie', '');
      return { bid, r1, r2 };
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('courbes'); });
    await page.waitForTimeout(300);
    await page.evaluate((bid) => { MX.Pages.HeatingConfig._setCurveBuilding(bid); }, bid);
    await page.waitForTimeout(300);

    ok('5b.1 Sans sélection, message d\'invite affiché (rien tracé par défaut)', (await page.locator('text=Sélectionnez une ou plusieurs pièces').count()) > 0);

    // Sélectionne les 2 pièces — comparaison multi-pièces du même bâtiment.
    await page.evaluate((r1) => { MX.Pages.HeatingConfig._toggleCompareRoom(r1, true); }, r1);
    await page.waitForTimeout(250);
    await page.evaluate((r2) => { MX.Pages.HeatingConfig._toggleCompareRoom(r2, true); }, r2);
    await page.waitForTimeout(250);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setCompareDays('7'); });
    await page.waitForTimeout(300);

    const rowsText = await page.locator('.ctavc-hist-table table').last().innerText();
    ok('5b.2 Les 2 pièces apparaissent dans le tableau de comparaison', rowsText.includes('Chambre 201') && rowsText.includes('Chambre 202'));
    ok('5b.3 L\'écart à la cible de la Chambre 201 est affiché (19.3 - 20 = -0.7°C)', /-0\.7/.test(rowsText));
    ok('5b.4 Les jours sans relevé sont comptés (6 / 7, un seul jour — aujourd\'hui — a un relevé)', /6 \/ 7/.test(rowsText));
    ok('5b.5 Un graphique SVG est bien rendu pour la comparaison', (await page.locator('.ra-svg-wrap svg').count()) >= 1);

    // Désélection d'une pièce -> elle disparaît du tableau.
    await page.evaluate((r2) => { MX.Pages.HeatingConfig._toggleCompareRoom(r2, false); }, r2);
    await page.waitForTimeout(250);
    const rowsAfter = await page.locator('.ctavc-hist-table table').last().innerText();
    ok('5b.6 Désélection : la pièce retirée n\'apparaît plus dans le tableau', !rowsAfter.includes('Chambre 202'));
    ok('5b.7 La pièce restante est toujours là', rowsAfter.includes('Chambre 201'));

    ok('5b.8 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 6. CORRECTION 1 — bâtiment automatique : surveillance uniquement, jamais de réglage ═══════════
  {
    const page = await browser.newPage();
    const { pageErrors } = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await setHotelConfig(page, 48.7262, 2.3594);
    await page.evaluate(async () => {
      window.__bidAuto = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Auto [DÉMO]', mode: 'automatique' }, 'Sophie');
      window.__cidAuto = await MX.DB.addHeatingCircuit({ name: 'VC Auto [DÉMO]', type: 'vc', buildingId: window.__bidAuto, vcMaxTemp: 50 });
      await MX.DB.addHeatingReading({ circuitId: window.__cidAuto, points: { point1: { waterTemp: 45, blowTemp: 40, ambientTemp: 19 }, point2: { waterTemp: 46, blowTemp: 41, ambientTemp: 20 } }, recordedAt: new Date().toISOString(), author: 'Démo' });
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.showPage('cta-vc'); });
    await page.waitForTimeout(2500);

    ok('6.1 Aucune proposition v2 "proposition_generee" n\'est créée pour un circuit de bâtiment automatique', (await page.evaluate(() => Object.values(firebase.firestore()._debugStore.heating_recommendations || {}).filter(r => r.engineVersion === 'v2' && r.status === 'proposition_generee'))).length === 0);
    const cardText = await page.locator('.ctavc-building-card', { hasText: 'Bâtiment Auto' }).first().innerText();
    ok('6.2 La carte du bâtiment affiche explicitement "régulation automatique"', cardText.toLowerCase().includes('automatique'));
    ok('6.3 Aucun bouton "Valider" proposé pour ce circuit (rien à décider)', !(await page.locator('.ctavc-network', { hasText: 'VC Auto' }).first().locator('button', { hasText: 'Valider' }).count()));

    ok('6.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 7. NOUVEAU — relevé de température de pièce via le VRAI formulaire ═══════════
  // Demande utilisateur (passe de finalisation, point 2) : interface réelle
  // bâtiment/pièce/température/date-heure/auteur/commentaire, plusieurs
  // relevés par jour acceptés, moyenne bâtiment n'utilisant QUE les pièces
  // suivies et les relevés valides (jamais une donnée manquante = 0°C).
  // Exercé ici par un TECHNICIEN (jordan) — pas seulement la Responsable —
  // pour vérifier que l'accès en lecture + relevé fonctionne réellement de
  // bout en bout, pas seulement en théorie.
  {
    // IMPORTANT : mock-firebase.js est un bac à sable EN MÉMOIRE propre à
    // CHAQUE page Playwright (contrairement à l'émulateur Firestore réel,
    // qui persiste entre connexions) — créer le bâtiment/les pièces sur une
    // page puis les lire depuis une AUTRE page ne fonctionnerait pas. On
    // crée donc tout sur LA MÊME page, en changeant simplement de session
    // PIN en cours de route (MX.Auth.selectUser + confirmPin, sans
    // redémarrer le navigateur) — le store mock reste partagé.
    const pageTech = await browser.newPage();
    const { pageErrors: techErrors } = await bootPage(pageTech);
    await pinLogin(pageTech, 'sophie', '9999');
    const { bid, r1, r2 } = await pageTech.evaluate(async () => {
      const bid = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Relevés [DÉMO]', mode: 'manuel_assiste' }, 'Sophie');
      const r1 = await MX.DB.addHeatingRoom({ name: 'Chambre 101 [DÉMO]', buildingId: bid, trackedActive: true }, 'Sophie');
      const r2 = await MX.DB.addHeatingRoom({ name: 'Chambre 102 [DÉMO]', buildingId: bid, trackedActive: false }, 'Sophie'); // non suivie
      return { bid, r1, r2 };
    });
    await pageTech.waitForTimeout(300);

    // Technicien : ouvre la page (plus de redirection), saisit un relevé
    // réel via le formulaire (pas un appel direct à MX.DB). confirmPin()
    // gère lui-même le changement de session PIN (pas besoin de signOut
    // explicite — voir assets/js/auth.js:confirmPin).
    await pinLogin(pageTech, 'jordan', '2222');
    await pageTech.evaluate(() => { MX.showPage('heating-config'); });
    await pageTech.waitForTimeout(400);
    await pageTech.evaluate(() => { MX.Pages.HeatingConfig._setTab('pieces'); });
    await pageTech.waitForTimeout(300);
    await pageTech.click('text=Nouveau relevé de température', { force: true });
    await pageTech.waitForSelector('#hc-rr-temp', { state: 'visible' });
    await pageTech.selectOption('#hc-rr-building', bid);
    await pageTech.selectOption('#hc-rr-room', r1);
    await pageTech.fill('#hc-rr-temp', '19.8');
    await pageTech.fill('#hc-rr-comment', 'Relevé [DÉMO] technicien');
    await pageTech.evaluate(() => { const b = document.querySelector('.modal-actions .primary-btn'); if (b) b.click(); });
    await pageTech.waitForTimeout(400);

    const firstReading = await pageTech.evaluate((roomId) => {
      const list = Object.values(firebase.firestore()._debugStore.heating_readings || {});
      return list.find(r => r.roomId === roomId);
    }, r1);
    ok('7.1 Le relevé est bien enregistré avec roomId, temp, auteur ET commentaire', !!firstReading && firstReading.temp === 19.8 && firstReading.author === 'Jordan' && firstReading.comment === 'Relevé [DÉMO] technicien');
    ok('7.2 recordedAt est bien une date exploitable (pas un placeholder)', !!firstReading && !isNaN(new Date(firstReading.recordedAt).getTime()));

    // Un second relevé LE MÊME JOUR pour la même pièce doit être accepté
    // (append-only, jamais fusionné avec le précédent).
    await pageTech.click('text=Nouveau relevé de température', { force: true });
    await pageTech.waitForSelector('#hc-rr-temp', { state: 'visible' });
    await pageTech.selectOption('#hc-rr-building', bid);
    await pageTech.selectOption('#hc-rr-room', r1);
    await pageTech.fill('#hc-rr-temp', '20.4');
    await pageTech.evaluate(() => { const b = document.querySelector('.modal-actions .primary-btn'); if (b) b.click(); });
    await pageTech.waitForTimeout(400);
    const readingsForR1 = await pageTech.evaluate((roomId) => {
      return Object.values(firebase.firestore()._debugStore.heating_readings || {}).filter(r => r.roomId === roomId);
    }, r1);
    ok('7.3 Deux relevés DISTINCTS coexistent pour la même pièce le même jour (jamais fusionnés)', readingsForR1.length === 2);

    // La pièce non suivie (r2) ne doit jamais entrer dans la moyenne, même
    // avec un relevé existant pour elle.
    await pageTech.evaluate(async (roomId) => { await MX.DB.addRoomReading(roomId, 15, 'Jordan', ''); }, r2);
    await pageTech.waitForTimeout(400);
    const avgResult = await pageTech.evaluate(({ bid, r1, r2 }) => {
      const rooms = Object.entries(firebase.firestore()._debugStore.heating_rooms || {}).map(([id, d]) => Object.assign({ id }, d));
      const readings = Object.values(firebase.firestore()._debugStore.heating_readings || {});
      const selected = rooms.filter(r => r.buildingId === bid && r.trackedActive).map(r => r.id);
      return MX.HeatingEngine.computeBuildingAverageTemp(selected, rooms, readings, Date.now());
    }, { bid, r1, r2 });
    ok('7.4 La moyenne bâtiment EXCLUT la pièce non suivie (102, 15°C) malgré son relevé existant', avgResult.value !== 15 && avgResult.value > 15);
    ok('7.5 La moyenne reste calculée uniquement sur la pièce suivie (101)', avgResult.sampleCount === 1);

    ok('7.6 Aucune erreur JS côté technicien', techErrors.length === 0);
    await pageTech.close();
  }

  // ═══════════ 8. NOUVEAU — analyse DJU / température intérieure (demande utilisateur, finalisation) ═══════════
  // Vérifie le RACCORDEMENT réel (pas seulement l'absence de crash) :
  // DJU observé/prévisionnel affichés, température intérieure moyenne vs
  // cible (courbe programmée), écart réel, et l'évolution sur plusieurs
  // jours (tableau jour par jour + détection de seuil de dégradation).
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    // Météo RICHE (historique + prévisionnel sur plusieurs jours), construite
    // après connaître la date du jour CÔTÉ NAVNIGATEUR (MX.Dju.parisDateStr,
    // fuseau Europe/Paris — jamais la date Node, qui peut diverger d'un jour).
    await page.route('https://api.open-meteo.com/**', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 5, weather_code: 2 }, daily: { temperature_2m_min: [2], temperature_2m_max: [9] } }) });
    });
    await page.addInitScript({ path: MOCK_FB });
    await page.addInitScript({ path: SEED });
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.evaluate(async () => { await window.__seedGst(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
    const todayStr = await page.evaluate(() => MX.Dju.parisDateStr());
    await page.unroute('https://api.open-meteo.com/**');
    await page.route('https://api.open-meteo.com/**', (route) => {
      const url = route.request().url();
      if (url.indexOf('current=') !== -1) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 5, weather_code: 2 }, daily: { temperature_2m_min: [2], temperature_2m_max: [9] } }) });
      }
      const center = new Date(todayStr + 'T12:00:00Z');
      const time = [], mins = [], maxs = [], means = [], codes = [];
      for (let i = -5; i <= 6; i++) {
        const d = new Date(center); d.setDate(d.getDate() + i);
        const dStr = d.toISOString().slice(0, 10);
        time.push(dStr);
        // Jours passés (observés) : DJU élevé et STABLE (~10) pour que les
        // relevés "froids" ci-dessous créent un écart détectable. Jours
        // futurs (prévisionnels) : DJU en forte hausse (refroidissement
        // à venir) pour déclencher l'alerte d'anticipation.
        const isPast = dStr < todayStr;
        const base = isPast ? 9 : -5; // base=9 -> DJU19≈10 ; base=-5 -> DJU19≈24 (hausse marquée)
        mins.push(base - 2); maxs.push(base + 2); means.push(base); codes.push(2);
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ timezone: 'Europe/Paris', daily: { time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: codes } }) });
    });

    await pinLogin(page, 'sophie', '9999');
    await setHotelConfig(page, 48.7262, 2.3594);
    const { bid, r1 } = await page.evaluate(async () => {
      const bid = await MX.DB.addHeatingBuilding({ name: 'Bâtiment Analyse DJU [DÉMO]', mode: 'manuel_assiste' }, 'Sophie');
      const r1 = await MX.DB.addHeatingRoom({ name: 'Chambre 301 [DÉMO]', buildingId: bid, targetTemp: 21, trackedActive: true }, 'Sophie');
      return { bid, r1 };
    });
    await page.waitForTimeout(300);
    // Courbe de référence : à DJU 5 -> 21°C attendu ; à DJU 15 -> 17°C
    // attendu (le bâtiment est censé perdre en température avec la hausse
    // du DJU — pente volontairement marquée pour que le test puisse
    // vérifier une détection réelle, pas une coïncidence).
    await page.evaluate(async (bid) => {
      await MX.DB.addHeatingCurvePoint({ buildingId: bid, dju: 5, expectedIndoorTemp: 21 }, 'Sophie');
      await MX.DB.addHeatingCurvePoint({ buildingId: bid, dju: 15, expectedIndoorTemp: 17 }, 'Sophie');
    }, bid);
    await page.waitForTimeout(300);
    // Relevés RÉELS sur 3 jours passés, nettement SOUS la courbe attendue
    // (DJU≈10 -> attendu interpolé 19°C, relevés à 17°C -> écart -2°C,
    // au-delà du seuil de 1°C utilisé par analyzeCurveDeviation).
    await page.evaluate(async ({ r1, todayStr }) => {
      for (const offset of [3, 2, 1]) {
        const d = new Date(todayStr + 'T10:00:00Z'); d.setDate(d.getDate() - offset);
        await MX.DB.addRoomReading(r1, 17, 'Sophie', '', d);
      }
    }, { r1, todayStr });
    await page.waitForTimeout(300);

    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('courbes'); });
    await page.waitForTimeout(300);
    await page.evaluate((bid) => { MX.Pages.HeatingConfig._setCurveBuilding(bid); }, bid);
    await page.waitForTimeout(2500); // laisse le fetch météo + le calcul se terminer

    const analysisText = await page.locator('.ctavc-card', { hasText: 'Analyse DJU / température intérieure' }).first().innerText();
    ok('8.1 DJU observé affiché (valeur numérique, pas un placeholder)', /DJU observé[\s\S]*?\d/.test(analysisText));
    ok('8.2 DJU prévisionnel affiché', /DJU prévisionnel[\s\S]*?\d/.test(analysisText));
    ok('8.3 Température intérieure moyenne affichée (17°C, seule pièce suivie)', /moyenne[\s\S]*?17/i.test(analysisText));
    ok('8.4 Température intérieure cible (courbe interpolée) affichée', /cible/i.test(analysisText));
    ok('8.5 Écart réel à la cible affiché (négatif, le relevé est sous la courbe)', /Écart réel[\s\S]*?-/i.test(analysisText));
    ok('8.6 Un tableau d\'évolution jour par jour est rendu avec au moins une ligne', (await page.locator('.ctavc-card', { hasText: 'Analyse DJU / température intérieure' }).first().locator('table tbody tr').count()) >= 1);
    ok('8.7 Le seuil de dégradation est détecté et affiché (écart -2°C > seuil 1°C)', /perdre en température/i.test(analysisText));
    ok('8.8b Avec 3 échantillons (zone "partielle"), la fiabilité est explicitement qualifiée "Données partielles"', /Données partielles/i.test(analysisText));
    ok('8.8c L\'alerte de dégradation porte bien la mention "Confiance limitée" en zone partielle (jamais présentée comme fiable à 100%)', /Confiance limitée/i.test(analysisText));

    ok('8.8 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  // ═══════════ 8b. PASSE DE FIABILISATION — 2 jours de mesures ne donnent JAMAIS une confiance élevée ═══════════
  // Reproduit EXACTEMENT le scénario signalé par l'utilisateur : seulement
  // 2 relevés, avec un écart énorme et artificiel (-6°C) qui, sans garde-
  // fou, produirait une alerte de dégradation très convaincante — vérifie
  // qu'elle n'apparaît PAS, et que "Données insuffisantes" est affiché à
  // la place.
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('https://api.open-meteo.com/**', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 5, weather_code: 2 }, daily: { temperature_2m_min: [2], temperature_2m_max: [9] } }) });
    });
    await page.addInitScript({ path: MOCK_FB });
    await page.addInitScript({ path: SEED });
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.evaluate(async () => { await window.__seedGst(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); });
    const todayStr = await page.evaluate(() => MX.Dju.parisDateStr());
    await page.unroute('https://api.open-meteo.com/**');
    await page.route('https://api.open-meteo.com/**', (route) => {
      const url = route.request().url();
      if (url.indexOf('current=') !== -1) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 5, weather_code: 2 }, daily: { temperature_2m_min: [2], temperature_2m_max: [9] } }) });
      }
      const center = new Date(todayStr + 'T12:00:00Z');
      const time = [], mins = [], maxs = [], means = [], codes = [];
      for (let i = -5; i <= 6; i++) {
        const d = new Date(center); d.setDate(d.getDate() + i);
        const dStr = d.toISOString().slice(0, 10);
        time.push(dStr);
        const isPast = dStr < todayStr;
        const base = isPast ? 9 : -5;
        mins.push(base - 2); maxs.push(base + 2); means.push(base); codes.push(2);
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ timezone: 'Europe/Paris', daily: { time, temperature_2m_min: mins, temperature_2m_max: maxs, temperature_2m_mean: means, weather_code: codes } }) });
    });

    await pinLogin(page, 'sophie', '9999');
    await setHotelConfig(page, 48.7262, 2.3594);
    const { bid, r1 } = await page.evaluate(async () => {
      const bid = await MX.DB.addHeatingBuilding({ name: 'Bâtiment 2 Jours [DÉMO]', mode: 'manuel_assiste' }, 'Sophie');
      const r1 = await MX.DB.addHeatingRoom({ name: 'Chambre 401 [DÉMO]', buildingId: bid, targetTemp: 21, trackedActive: true }, 'Sophie');
      return { bid, r1 };
    });
    await page.waitForTimeout(300);
    await page.evaluate(async (bid) => {
      await MX.DB.addHeatingCurvePoint({ buildingId: bid, dju: 5, expectedIndoorTemp: 21 }, 'Sophie');
      await MX.DB.addHeatingCurvePoint({ buildingId: bid, dju: 15, expectedIndoorTemp: 17 }, 'Sophie');
    }, bid);
    await page.waitForTimeout(300);
    // SEULEMENT 2 jours de relevés, avec un écart ÉNORME et artificiel
    // (13°C au lieu des ~19°C attendus à DJU≈10, soit -6°C) — si le garde-
    // fou n'existait pas, ce serait l'alerte de dégradation la PLUS
    // convaincante de toute la suite de tests.
    await page.evaluate(async ({ r1, todayStr }) => {
      for (const offset of [2, 1]) {
        const d = new Date(todayStr + 'T10:00:00Z'); d.setDate(d.getDate() - offset);
        await MX.DB.addRoomReading(r1, 13, 'Sophie', '', d);
      }
    }, { r1, todayStr });
    await page.waitForTimeout(300);

    await page.evaluate(() => { MX.showPage('heating-config'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { MX.Pages.HeatingConfig._setTab('courbes'); });
    await page.waitForTimeout(300);
    await page.evaluate((bid) => { MX.Pages.HeatingConfig._setCurveBuilding(bid); }, bid);
    await page.waitForTimeout(2500);

    const analysisText2 = await page.locator('.ctavc-card', { hasText: 'Analyse DJU / température intérieure' }).first().innerText();
    ok('8b.1 "Données insuffisantes" affiché avec seulement 2 jours de mesures', /Données insuffisantes/i.test(analysisText2));
    ok('8b.2 AUCUNE mention de "perdre en température" malgré l\'écart énorme (-6°C) sur les 2 points — jamais une confiance élevée avec si peu de données', !/perdre en température/i.test(analysisText2));
    ok('8b.3 Le message explique le seuil minimal requis', /moins de 3 jours|échantillon trop réduit/i.test(analysisText2));

    ok('8b.4 Aucune erreur JS', pageErrors.length === 0);
    await page.close();
  }

  await browser.close();
  clearTimeout(_globalTimeout);
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests CONFIGURATION THERMIQUE (Playwright, mock Firestore) passent.');
  process.exit(failures ? 1 : 0);
})();
