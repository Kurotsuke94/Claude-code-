// Tests de régression pour les flux PIN de assets/js/pages/settings.js
// (changement de PIN self-service, réinitialisation par un Admin) et
// assets/js/pages/admin.js:saveUsers() — modifiés pour écrire le hash dans
// users_private/{id} au lieu de users/{id}.pin (voir rapport de migration
// et tests/pin_security_test.js pour la preuve côté règles/Cloud Function).
// Même harnais que les autres suites (mock-firebase.js + gst_seed.js).
const path = require('path');
const { chromium } = _resolvePlaywright();
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

function _resolvePlaywright() {
  try { return require('playwright'); }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  const explicitPath = process.env.PLAYWRIGHT_REQUIRE_PATH;
  if (explicitPath) return require(explicitPath);
  throw new Error('Playwright introuvable. npm install -D playwright, ou PLAYWRIGHT_REQUIRE_PATH=...');
}

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

const _globalTimeout = setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (90s) — le process est arrêté de force.');
  process.exit(1);
}, 90000);

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
async function adminLogin(page, email) {
  await page.evaluate((email) => {
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = 'x';
  }, email);
  await page.evaluate(() => { MX.Auth.login({ preventDefault() {} }); });
  await page.waitForTimeout(300);
}
function privatePin(page, id) {
  return page.evaluate((id) => {
    const store = window.__mockDb._debugStore['users_private'] || {};
    return store[id] ? store[id].pin : undefined;
  }, id);
}
// _confirmChangePin/_confirmAdminResetPin sont des closures internes à
// settings.js (jamais exposées sur window.MX), appelées uniquement via le
// bouton de la modale (fn: passé à MX.showModal) — on simule donc un clic
// réel sur ce bouton plutôt que d'appeler la fonction directement.
function clickModalButton(page, labelSubstr) {
  return page.evaluate((labelSubstr) => {
    const btns = Array.from(document.querySelectorAll('#m-actions .modal-btn'));
    const b = btns.find((x) => x.textContent.includes(labelSubstr));
    if (!b) throw new Error('Bouton modale introuvable: ' + labelSubstr);
    b.click();
  }, labelSubstr);
}

(async () => {
  const browser = await chromium.launch();

  // ── 1. Changement de PIN self-service : mauvais PIN actuel refusé ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    const before = await privatePin(page, 'kevin');
    await page.evaluate(() => { MX.Pages.Settings._openChangePinModal(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('stt-pin-cur').value = '0000'; // mauvais PIN actuel
      document.getElementById('stt-pin-new').value = '7777';
      document.getElementById('stt-pin-conf').value = '7777';
    });
    await clickModalButton(page, 'Confirmer');
    await page.waitForTimeout(200);
    const errText = await page.evaluate(() => document.getElementById('stt-pin-err')?.textContent || '');
    const after = await privatePin(page, 'kevin');
    ok('1.1 Mauvais PIN actuel : message d\'erreur affiché', /incorrect/i.test(errText));
    ok('1.2 Mauvais PIN actuel : le hash stocké n\'a PAS changé', after === before);
    ok('1.3 Aucune erreur JS', errs.length === 0);
    await ctx.close();
  }

  // ── 2. Changement de PIN self-service : succès ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await pinLogin(page, 'kevin', '1111');
    await page.evaluate(() => { MX.Pages.Settings._openChangePinModal(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('stt-pin-cur').value = '1111'; // bon PIN actuel
      document.getElementById('stt-pin-new').value = '7777';
      document.getElementById('stt-pin-conf').value = '7777';
    });
    await clickModalButton(page, 'Confirmer');
    await page.waitForTimeout(200);
    const newHash = await page.evaluate(() => MX.hashPin('7777'));
    const stored = await privatePin(page, 'kevin');
    ok('2.1 Bon PIN actuel + nouveau PIN valide : le hash stocké correspond au NOUVEAU PIN', stored === newHash);
    ok('2.2 La modale se ferme (succès)', await page.evaluate(() => document.getElementById('modal-bg').classList.contains('show')) === false);
    ok('2.3 Aucune erreur JS', errs.length === 0);
    // Non-régression : une nouvelle connexion avec le NOUVEAU PIN fonctionne
    await page.evaluate(() => { MX.Auth.clearCurrentUser(); });
    await page.waitForTimeout(150);
    await pinLogin(page, 'kevin', '7777');
    const cuName = await page.evaluate(() => MX.state.currentUser && MX.state.currentUser.name);
    ok('2.4 Reconnexion avec le nouveau PIN réussit (verifyPin lit bien users_private)', cuName === 'Kevin');
    await ctx.close();
  }

  // ── 3. Réinitialisation par un Admin ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await adminLogin(page, 'admin@maintix.local');
    await page.evaluate(() => { MX.Pages.Settings._openAdminResetPinModal(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.getElementById('stt-rpin-user').value = 'jordan';
      document.getElementById('stt-rpin-new').value = '5555';
    });
    await clickModalButton(page, 'Réinitialiser');
    await page.waitForTimeout(200);
    const newHash = await page.evaluate(() => MX.hashPin('5555'));
    const stored = await privatePin(page, 'jordan');
    ok('3.1 Admin réinitialise le PIN de Jordan : hash correctement stocké dans users_private', stored === newHash);
    ok('3.2 Aucune erreur JS', errs.length === 0);
    await ctx.close();
  }

  // ── 4. saveUsers() : un champ PIN laissé VIDE ne doit PAS écraser le PIN existant ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await adminLogin(page, 'admin@maintix.local');
    const before = await privatePin(page, 'dorian'); // PIN existant ('3333' hashé par le seed ? non: seed stocke en clair '3333')
    // Simule l'admin ouvrant l'écran Utilisateurs SANS toucher au champ PIN
    // de Dorian, puis cliquant Enregistrer (reproduit exactement le bug visé :
    // u.pin n'est plus jamais repeuplé depuis Firestore, donc vide par défaut).
    await page.evaluate(() => {
      MX.state.users = [
        { id: 'dorian', name: 'Dorian', role: 'technicien', color: null }, // pas de .pin ici : champ non touché
      ];
    });
    await page.evaluate(async () => { await MX.Pages.Admin.saveUsers(); });
    await page.waitForTimeout(200);
    const after = await privatePin(page, 'dorian');
    ok('4.1 saveUsers() sans PIN saisi ne touche PAS au hash existant (pas d\'écrasement par du vide)', after === before);
    ok('4.2 Aucune erreur JS', errs.length === 0);
    await ctx.close();
  }

  // ── 5. saveUsers() : un NOUVEAU PIN saisi est bien hashé et stocké ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = await bootPage(page);
    await adminLogin(page, 'admin@maintix.local');
    await page.evaluate(() => {
      MX.state.users = [
        { id: 'dorian', name: 'Dorian', role: 'technicien', color: null, pin: '4444' }, // admin saisit un nouveau PIN
      ];
    });
    await page.evaluate(async () => { await MX.Pages.Admin.saveUsers(); });
    await page.waitForTimeout(200);
    const newHash = await page.evaluate(() => MX.hashPin('4444'));
    const stored = await privatePin(page, 'dorian');
    ok('5.1 saveUsers() avec un nouveau PIN saisi : hash correctement stocké dans users_private', stored === newHash);
    ok('5.2 Aucune erreur JS', errs.length === 0);
    await ctx.close();
  }

  await browser.close();
  clearTimeout(_globalTimeout);
  console.log('\n' + (failures === 0
    ? 'Tous les tests des flux PIN de Réglages/Admin passent.'
    : failures + ' test(s) EN ÉCHEC.'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERREUR FATALE:', e); process.exit(1); });
