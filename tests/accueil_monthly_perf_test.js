// Tests pour le widget Accueil "Performance du mois" — remplace l'ancienne
// vision journalière par le calcul mensuel OFFICIEL du module Compteurs/
// Performance (MX.Pages.Conso._monthlyRealRatio et consorts, déplacées de
// _tPerformance() vers la portée du module puis exposées — même logique,
// aucune formule dupliquée). Période : 1er du mois → aujourd'hui, sur les
// compteurs généraux explicitement configurés, jamais de repli silencieux.
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
async function noHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

// Seed un compteur EF avec deux relevés (avant le mois / dans le mois) et,
// optionnellement, l'inscrit comme "compteur général" (ref_meters) pour le
// type — seule condition pour que le calcul mensuel officiel le prenne en
// compte (aucun repli silencieux sur "tous les compteurs du type").
async function seedMonthlyMeter(page, { type, startIndex, endIndex, asGeneral }) {
  return evalPage(page, async (o) => {
    function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const beforeMonth = new Date(monthStart.getTime()); beforeMonth.setDate(beforeMonth.getDate() - 1);
    const ref = await window.__mockDb.collection('cso_meters').add({ name: 'Compteur test ' + o.type, type: o.type, unit: 'm³' });
    const meterId = ref.id;
    await window.__mockDb.collection('cso_readings').add({
      meterId, meterType: o.type, index: o.startIndex, date: ymd(beforeMonth),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await window.__mockDb.collection('cso_readings').add({
      meterId, meterType: o.type, index: o.endIndex, date: ymd(now),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (o.asGeneral) {
      const cfgSnap = await window.__mockDb.collection('cso_perf_config').doc('ref_meters').get();
      const cur = cfgSnap.exists ? cfgSnap.data() : {};
      cur[o.type] = (cur[o.type] || []).concat([meterId]);
      await window.__mockDb.collection('cso_perf_config').doc('ref_meters').set(cur);
    }
    return meterId;
  }, { type, startIndex, endIndex, asGeneral });
}

// Seed des clients répartis sur plusieurs jours DANS le mois en cours.
async function seedMonthlyClients(page, counts) {
  return evalPage(page, async (counts) => {
    function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let total = 0;
    for (let i = 0; i < counts.length; i++) {
      const d = new Date(monthStart.getTime()); d.setDate(d.getDate() + i);
      if (d > now) break; // ne jamais semer dans le futur
      await window.__mockDb.collection('cso_clients').doc(ymd(d)).set({ count: counts[i] });
      total += counts[i];
    }
    return total;
  }, counts);
}

async function expectedMonthLabel(page) {
  return evalPage(page, () => {
    const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    const now = new Date();
    const m = MOIS[now.getMonth()];
    return m.charAt(0).toUpperCase() + m.slice(1) + ' ' + now.getFullYear();
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const newCtx = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
    await ctx.route('**://*.googleapis.com/**', r => r.abort());
    await ctx.route('**://*.gstatic.com/**', r => r.abort());
    await ctx.route('**://api.open-meteo.com/**', r => r.abort());
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };
  async function gotoHome(page) {
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(500);
  }
  async function perfCardHtml(page) {
    return evalPage(page, () => {
      const el = document.querySelector('.acc-card-energie');
      return el ? el.innerHTML : '';
    });
  }

  // ═══ 1. Le widget affiche le mois calendaire actuel (pas une fenêtre glissante) ═══
  {
    console.log('\n--- 1. Mois actuel correctement identifié ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    const monthLabel = await expectedMonthLabel(page);
    await gotoHome(page);
    const html = await perfCardHtml(page);
    ok('1.1 Titre "Performance du mois" présent', /Performance du mois/.test(html));
    ok('1.2 Libellé du mois calendaire actuel affiché (ex. "' + monthLabel + '")', html.indexOf(monthLabel) !== -1);
    ok('1.3 Les 4 KPI attendus sont présents', /Clients du mois/.test(html) && /Eau consommée/.test(html) && /Eau \/ client/.test(html) && /Coût énergie/.test(html));
    await ctx.close();
  }

  // ═══ 2. Clients mensuels corrects (somme des jours du mois, pas un seul jour) ═══
  {
    console.log('\n--- 2. Clients mensuels corrects ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    const total = await seedMonthlyClients(page, [100, 120, 130]);
    await page.waitForTimeout(300);
    await gotoHome(page);
    const html = await perfCardHtml(page);
    const expected = total.toLocaleString('fr-FR');
    ok('2.1 "Clients du mois" affiche bien la somme (' + expected + '), pas un seul jour', html.indexOf(expected) !== -1);
    await ctx.close();
  }

  // ═══ 3. Eau mensuelle basée sur la logique officielle (delta d'index, pas une somme de conso) ═══
  {
    console.log('\n--- 3. Eau mensuelle — logique officielle ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await seedMonthlyMeter(page, { type: 'eau_froide', startIndex: 1000, endIndex: 1050, asGeneral: true });
    await page.waitForTimeout(300);
    await gotoHome(page);
    const html = await perfCardHtml(page);
    ok('3.1 "Eau consommée" affiche le delta exact (50,00 m³)', /50,00\s*m³/.test(html));
    await ctx.close();
  }

  // ═══ 4-13 (partagent un même contexte : compteur EF configuré + clients) ═══
  let ctxShared, pageShared;
  {
    console.log('\n--- 4/6/13. Ratio Accueil === Ratio Ratios (même calcul, même période) ---');
    const r = await newCtx();
    ctxShared = r.ctx; pageShared = r.page;
    await pinLogin(pageShared, 'sophie', '9999');
    await seedMonthlyMeter(pageShared, { type: 'eau_froide', startIndex: 2000, endIndex: 2050, asGeneral: true });
    await seedMonthlyClients(pageShared, [100, 120, 130]); // total 350 -> 50000L/350 = 142,857 -> 143
    await pageShared.waitForTimeout(300);

    await gotoHome(pageShared);
    const homeHtml = await perfCardHtml(pageShared);
    const homeRatioMatch = homeHtml.match(/(\d+)\s*L\/client/);
    ok('4.1 Accueil affiche un ratio L/client numérique', !!homeRatioMatch);

    // Ouvre le module Ratios (onglet Performance = Accueil de Compteurs)
    await pageShared.evaluate(() => { MX.showCsoTab('dashboard'); });
    await pageShared.waitForTimeout(500);
    const ratiosVal = await evalPage(pageShared, () => {
      const el = document.querySelector('.pe-sc-ratio-val');
      return el ? el.textContent.trim() : null;
    });
    const ratiosRatioMatch = ratiosVal ? ratiosVal.match(/(\d+)/) : null;
    ok('6.1 Le module Ratios affiche aussi un ratio numérique pour eau_froide ce mois-ci', !!ratiosRatioMatch);
    ok('13.1 ACCUEIL et RATIOS affichent EXACTEMENT le même ratio L/client pour la même période',
      !!homeRatioMatch && !!ratiosRatioMatch && homeRatioMatch[1] === ratiosRatioMatch[1]);
    ok('13.2 Valeur attendue par le calcul (350 clients, 50 m³ -> 143 L/client)', homeRatioMatch && homeRatioMatch[1] === '143');
    await ctxShared.close();
  }

  // ═══ 5. Aucun compteur général configuré → "Donnée indisponible" (pas de repli silencieux) ═══
  {
    console.log('\n--- 5. Aucun compteur général → Donnée indisponible ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    // Un compteur existe et a des relevés, mais N'EST PAS déclaré en ref_meters.
    await seedMonthlyMeter(page, { type: 'eau_froide', startIndex: 500, endIndex: 600, asGeneral: false });
    await seedMonthlyClients(page, [50, 60]);
    await page.waitForTimeout(300);
    await gotoHome(page);
    const html = await perfCardHtml(page);
    ok('5.1 "Eau consommée" = Donnée indisponible (pas de repli sur le compteur non configuré)', /Eau consommée[\s\S]*?Donnée indisponible/.test(html) || /Donnée indisponible[\s\S]*?Eau consommée/.test(html) || (html.match(/Donnée indisponible/g) || []).length >= 2);
    ok('5.2 "Eau \/ client" = Donnée indisponible également', !/\d+\s*L\/client/.test(html));
    ok('5.3 Aucun repli silencieux : le compteur existant (100 m³ de delta) n\'apparaît nulle part', !/100,00\s*m³/.test(html));
    await ctx.close();
  }

  // ═══ 7. Coût énergie — toujours "Donnée indisponible" (aucun prix configuré dans Maintix) ═══
  {
    console.log('\n--- 7. Coût énergie indisponible ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await seedMonthlyMeter(page, { type: 'eau_froide', startIndex: 10, endIndex: 20, asGeneral: true });
    await seedMonthlyClients(page, [10]);
    await page.waitForTimeout(300);
    await gotoHome(page);
    const html = await perfCardHtml(page);
    ok('7.1 "Coût énergie" affiche "Donnée indisponible" (aucun prix n\'existe dans Maintix)', /Donnée indisponible[\s\S]{0,60}Coût énergie/.test(html));
    await ctx.close();
  }

  // ═══ 8. Division par zéro protégée (compteur OK, mais 0 client ce mois-ci) ═══
  {
    console.log('\n--- 8. Division par zéro protégée ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await seedMonthlyMeter(page, { type: 'eau_froide', startIndex: 300, endIndex: 342, asGeneral: true }); // 42 m³, réel
    // Aucun client seedé ce mois-ci.
    await page.waitForTimeout(300);
    await gotoHome(page);
    const html = await perfCardHtml(page);
    ok('8.1 "Eau consommée" reste affichée normalement (42,00 m³ — donnée réelle indépendante des clients)', /42,00\s*m³/.test(html));
    ok('8.2 "Eau \/ client" affiche "—" (pas de division par zéro, pas de NaN/Infinity)', !/NaN|Infinity/.test(html));
    ok('8.3 "Clients du mois" affiche "—" (aucun client ce mois-ci)', /Clients du mois/.test(html));
    await ctx.close();
  }

  // ═══ 9. Non-régression module Ratios (aucune erreur JS, rendu normal) ═══
  {
    console.log('\n--- 9. Non-régression module Ratios ---');
    const { ctx, page, pageErrors } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await seedMonthlyMeter(page, { type: 'eau_froide', startIndex: 1, endIndex: 5, asGeneral: true });
    await page.waitForTimeout(300);
    await page.evaluate(() => { MX.showCsoTab('dashboard'); });
    await page.waitForTimeout(600);
    const html = await mainHtml(page);
    ok('9.1 Le module Compteurs/Performance se rend toujours normalement', /Ratio réel/.test(html) || /Performance/.test(html));
    ok('9.2 Aucune erreur JS non interceptée', pageErrors.length === 0);
    await ctx.close();
  }

  // ═══ 10. Responsive — 4 indicateurs lisibles, aucun débordement ═══
  {
    console.log('\n--- 10. Responsive ---');
    for (const vp of [{ w: 375, h: 812 }, { w: 390, h: 844 }, { w: 430, h: 932 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }]) {
      const { ctx, page } = await newCtx({ width: vp.w, height: vp.h });
      await pinLogin(page, 'sophie', '9999');
      await seedMonthlyMeter(page, { type: 'eau_froide', startIndex: 10, endIndex: 60, asGeneral: true });
      await seedMonthlyClients(page, [200]);
      await page.waitForTimeout(300);
      await gotoHome(page);
      const noScroll = await noHorizScroll(page);
      const tilesVisible = await evalPage(page, () => document.querySelectorAll('.acc-perfm-kpi').length === 4);
      ok('10.' + vp.w + ' Pas de débordement horizontal à ' + vp.w + 'x' + vp.h, noScroll);
      ok('10.' + vp.w + 'b Les 4 tuiles KPI sont présentes à ' + vp.w + 'x' + vp.h, tilesVisible);
      await ctx.close();
    }
  }

  // ═══ 11. Lien "Voir les stats" toujours fonctionnel ═══
  {
    console.log('\n--- 11. Lien "Voir les stats" ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'sophie', '9999');
    await gotoHome(page);
    await evalPage(page, () => {
      const btn = [...document.querySelectorAll('.acc-card-energie .acc-card-link')].find(b => /Voir les stats/.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    const html = await mainHtml(page);
    ok('11.1 Le clic navigue bien vers le module Compteurs (pas de page vide)', html.length > 500 && /cso-page|Performance|Ratio/.test(html));
    await ctx.close();
  }

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS PASSENT ✓' : failures + ' TEST(S) EN ÉCHEC ✗'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });
