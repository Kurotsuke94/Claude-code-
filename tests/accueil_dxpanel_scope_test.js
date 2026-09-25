// Vérifie que le ciblage CSS de #dx-panel spécifique à l'Accueil
// (body[data-page="home"] #dx-panel, voir components.css et le
// document.body.dataset.page = id ajouté dans MX.showPage()) n'affecte
// QUE l'Accueil, et laisse #dx-panel strictement inchangé (structure et
// style) sur les autres pages. Fichier séparé de accueil_cockpit_test.js :
// au-delà d'~20 contextes Playwright séquentiels dans ce sandbox, un bruit
// de fond réseau (tentatives de reconnexion SDK Firebase bloquées par la
// sandbox, indépendantes du code testé) peut ralentir/bloquer les tests
// suivants dans le même process — isoler ce test évite ce risque.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (60s) — le process est arrêté de force.');
  process.exit(1);
}, 60000);

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

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const newCtx = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**://*.googleapis.com/**', r => r.abort());
    await ctx.route('**://*.gstatic.com/**', r => r.abort());
    await ctx.route('**://api.open-meteo.com/**', r => r.abort());
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };

  // ── 1. Accueil : body[data-page]="home" + padding ciblé (13px 16px) ──
  {
    console.log('\n--- 1. #dx-panel sur l\'Accueil ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(500);
    const dataPage = await evalPage(page, () => document.body.dataset.page);
    ok('1.1 body[data-page] vaut "home"', dataPage === 'home');
    const padding = await evalPage(page, () => {
      const el = document.querySelector('#dx-panel .dxp-section');
      return el ? getComputedStyle(el).padding : null;
    });
    ok('1.2 #dx-panel présent avec le padding ciblé Accueil (13px 16px)', padding === '13px 16px');
    await ctx.close();
  }

  // ── 2. Autre page (Mes missions) : #dx-panel structurellement présent,
  //       mais avec le padding GÉNÉRIQUE (14px 16px, non modifié) ──
  {
    console.log('\n--- 2. #dx-panel sur une autre page (non-régression) ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => { MX.showPage('mes-missions'); });
    await page.waitForTimeout(500);
    const dataPage = await evalPage(page, () => document.body.dataset.page);
    ok('2.1 body[data-page] vaut "mes-missions"', dataPage === 'mes-missions');
    const padding = await evalPage(page, () => {
      const el = document.querySelector('#dx-panel .dxp-section');
      return el ? getComputedStyle(el).padding : null;
    });
    ok('2.2 #dx-panel présent (non supprimé, structure inchangée)', !!padding);
    ok('2.3 Padding générique inchangé (14px 16px — PAS le padding Accueil)', padding === '14px 16px');
    const sections = await evalPage(page, () => document.querySelectorAll('#dx-panel .dxp-section').length);
    ok('2.4 Sections dxp-section toujours présentes (contenu non altéré)', sections > 0);
    await ctx.close();
  }

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS PASSENT ✓' : failures + ' TEST(S) EN ÉCHEC ✗'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });
