// Test dédié à l'agrandissement du bloc météo/DJU dans la bannière Accueil
// (voir assets/css/components.css: .acc-weather, .acc-header-greet).
// Fichier SÉPARÉ de tests/accueil_cockpit_test.js — ce dernier documente déjà
// que ce sandbox devient sujet à des ralentissements au-delà d'~20 contextes
// Playwright séquentiels ; même convention que accueil_dxpanel_scope_test.js.
//
// Vérifie GÉOMÉTRIQUEMENT (getBoundingClientRect, pas une inspection
// visuelle) : absence de chevauchement entre le bloc météo et le texte de
// date à la largeur de la capture fournie par l'utilisateur, agrandissement
// réel du bloc météo, et empilement sans chevauchement sur écran étroit.
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

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ── 1. Largeur de la capture fournie (~1920px) — pas de chevauchement,
  // bloc météo nettement agrandi, pas de débordement horizontal ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
    await ctx.route('**://*.googleapis.com/**', r => r.abort());
    await ctx.route('**://*.gstatic.com/**', r => r.abort());
    await ctx.route('**://api.open-meteo.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        current: { temperature_2m: 7, weather_code: 3 },
        daily: {
          temperature_2m_min:  [1, 2, 3, 4, 5, 6, 3],
          temperature_2m_max:  [8, 9, 10, 8, 9, 10, 8],
          temperature_2m_mean: [4, 5, 6, 5, 6, 7, 5],
          weather_code: [3, 3, 61, 2, 1, 0, 3],
          time: (() => { const t = new Date(); const out = []; for (let i = 0; i <= 6; i++) { const d = new Date(t); d.setDate(d.getDate() + i); out.push(d.toISOString().slice(0, 10)); } return out; })(),
        },
      }),
    }));
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => window.__mockDb.collection('config').doc('hotel_config').set({ lat: 48.75, lon: 2.36, cityLabel: 'Orly' }).then(() => { MX.state.hotelConfig = { lat: 48.75, lon: 2.36, cityLabel: 'Orly' }; }));
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(900); // laisse le fetch météo mocké se résoudre puis re-render

    const geo = await page.evaluate(() => {
      const date = document.querySelector('.acc-header-date');
      const weather = document.querySelector('.acc-weather');
      const header = document.querySelector('.acc-header');
      const cards = Array.from(document.querySelectorAll('.acc-wd-card'));
      const wdRow = document.querySelector('.acc-wd-row');
      if (!date || !weather || !header) return null;
      const d = date.getBoundingClientRect(), w = weather.getBoundingClientRect(), h = header.getBoundingClientRect();
      const lastCard = cards.length ? cards[cards.length - 1].getBoundingClientRect() : null;
      return {
        dateRight: d.right, dateBottom: d.bottom, dateHeight: d.height,
        wLeft: w.left, wTop: w.top, wWidth: w.width, wRight: w.right,
        headerRight: h.right, headerBottom: h.bottom,
        cardCount: cards.length, lastCardRight: lastCard ? lastCard.right : null,
        rowScrollWidth: wdRow ? wdRow.scrollWidth : null, rowClientWidth: wdRow ? wdRow.clientWidth : null,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    ok('1.1 Widget météo "ok" bien rendu (prérequis des mesures suivantes)', !!geo);
    if (geo) {
      ok('1.2 Aucun chevauchement : le bloc météo commence APRÈS la fin du texte de date (avec marge)', geo.wLeft > geo.dateRight);
      ok('1.3 Marge visuelle réelle entre les deux blocs (>= 12px, pas juste 1px de tolérance d\'arrondi)', (geo.wLeft - geo.dateRight) >= 12);
      ok('1.4 Le bloc météo reste DANS la largeur de la page (pas de débordement horizontal)', geo.wRight <= geo.viewportWidth + 1);
      ok('1.5 Le bloc météo utilise réellement la largeur disponible (largeur >= 700px, refonte visuelle)', geo.wWidth >= 700);
      // Régression trouvée et corrigée en cours de refonte : .acc-header-greet
      // compressible (flex-shrink:1) pouvait faire passer la ligne de date
      // complète sur 2 lignes malgré la place disponible côté météo. Verrouillé
      // ici (flex-shrink:0 sur .acc-header-greet) : hauteur d'une seule ligne.
      ok('1.8 La ligne de date complète tient sur UNE SEULE ligne (jamais coupée/repliée)', geo.dateHeight < 22);
      ok('1.9 Les 7 cartes météo sont bien rendues', geo.cardCount === 7);
      ok('1.10 Le bord droit du bloc météo reste DANS la bannière', geo.wRight <= geo.headerRight + 1);
      ok('1.11 La dernière carte (7e jour) reste DANS la bannière, jamais hors cadre', !!geo.lastCardRight && geo.lastCardRight <= geo.headerRight + 1);
      // Régression trouvée et corrigée : même sans déborder de la bannière,
      // la rangée des 7 cartes pouvait être légèrement plus large que
      // l'espace réellement visible (scrollWidth > clientWidth), rendant la
      // 7e carte invisible sans défilement MÊME à 1920px. Sur ordinateur,
      // les 7 doivent être visibles sans défilement interne (contrairement
      // au mobile, où un léger défilement reste explicitement autorisé).
      ok('1.12 Les 7 cartes sont TOUTES visibles sans défilement interne sur grand écran', geo.rowScrollWidth !== null && geo.rowScrollWidth <= geo.rowClientWidth + 2);
    }
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok('1.6 Aucun scroll horizontal introduit par l\'agrandissement', noScroll);
    ok('1.7 Aucune erreur JS', pageErrors.length === 0);

    await page.screenshot({ path: '/tmp/claude-0/-home-user-Claude-code-/c2a21799-f307-550e-95f7-5e299a5edb34/scratchpad/accueil-weather-1920.png', fullPage: false });
    await ctx.close();
  }

  // ── 2. Écran étroit (500px, bien sous le seuil de 900px) — empilement
  // vertical attendu, toujours aucun chevauchement, aucun débordement ──
  {
    const ctx = await browser.newContext({ viewport: { width: 500, height: 900 } });
    await ctx.route('**://*.googleapis.com/**', r => r.abort());
    await ctx.route('**://*.gstatic.com/**', r => r.abort());
    await ctx.route('**://api.open-meteo.com/**', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        current: { temperature_2m: 7, weather_code: 3 },
        daily: {
          temperature_2m_min:  [1, 2, 3, 4, 5, 6, 3],
          temperature_2m_max:  [8, 9, 10, 8, 9, 10, 8],
          temperature_2m_mean: [4, 5, 6, 5, 6, 7, 5],
          weather_code: [3, 3, 61, 2, 1, 0, 3],
          time: (() => { const t = new Date(); const out = []; for (let i = 0; i <= 6; i++) { const d = new Date(t); d.setDate(d.getDate() + i); out.push(d.toISOString().slice(0, 10)); } return out; })(),
        },
      }),
    }));
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    await pinLogin(page, 'sophie', '9999');
    await page.evaluate(() => window.__mockDb.collection('config').doc('hotel_config').set({ lat: 48.75, lon: 2.36, cityLabel: 'Orly' }).then(() => { MX.state.hotelConfig = { lat: 48.75, lon: 2.36, cityLabel: 'Orly' }; }));
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(900);

    const geo = await page.evaluate(() => {
      const date = document.querySelector('.acc-header-date');
      const weather = document.querySelector('.acc-weather');
      const wdWrap = document.querySelector('.acc-wd-wrap');
      const kpiRow = document.querySelector('.acc-kpi-row');
      const bottomNav = document.querySelector('.bottom-nav');
      if (!date || !weather || !wdWrap || !kpiRow) return null;
      const d = date.getBoundingClientRect(), w = weather.getBoundingClientRect();
      const wrap = wdWrap.getBoundingClientRect(), kpi = kpiRow.getBoundingClientRect();
      const nav = bottomNav ? bottomNav.getBoundingClientRect() : null;
      return {
        dateBottom: d.bottom, wTop: w.top, wHeight: w.height, wWidth: w.width,
        wdWrapBottom: wrap.bottom, weatherBottom: w.bottom,
        kpiBottom: kpi.bottom, navTop: nav ? nav.top : null,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    ok('2.1 Rendu mobile OK (prérequis)', !!geo);
    if (geo) {
      ok('2.2 Empilement vertical : le bloc météo commence sous le texte de date (jamais à côté/par-dessus)', geo.wTop >= geo.dateBottom);
      ok('2.3 Le bloc météo occupe la largeur de l\'écran (empilé en colonne, pas tronqué)', geo.wWidth > geo.viewportWidth * 0.85);
      // Régression trouvée et corrigée : .acc-weather héritait silencieusement
      // d'une hauteur minimale de 520px (sa base flex desktop, réinterprétée
      // comme hauteur une fois .acc-header-top passé en colonne), bien plus
      // grande que son contenu réel -> grand vide sous les prévisions.
      // Verrouillé : l'écart entre le bas du bloc météo et le bas de son
      // contenu réel (.acc-wd-wrap) doit rester faible (padding normal, pas
      // un vide artificiel de 150-200px).
      ok('2.6 Aucun grand vide résiduel sous les prévisions météo (écart contenu/carte < 60px)', (geo.weatherBottom - geo.wdWrapBottom) < 60);
      // Les indicateurs ne doivent jamais être masqués par la barre de
      // navigation inférieure fixe (seulement vérifiable si elle existe sur
      // cette page/ce mock).
      if (geo.navTop !== null) {
        ok('2.7 Les indicateurs (fin de la grille KPI) restent AU-DESSUS de la barre de navigation inférieure', geo.kpiBottom <= geo.navTop);
      } else {
        console.log('   (barre de navigation inférieure non trouvée dans ce rendu — vérification 2.7 non applicable)');
      }
    }
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok('2.4 Aucun débordement horizontal sur écran étroit', noScroll);
    ok('2.5 Aucune erreur JS', pageErrors.length === 0);
    await page.screenshot({ path: '/tmp/claude-0/-home-user-Claude-code-/c2a21799-f307-550e-95f7-5e299a5edb34/scratchpad/accueil-weather-500.png', fullPage: true });
    await ctx.close();
  }

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS PASSENT ✓' : failures + ' TEST(S) EN ÉCHEC ✗'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
