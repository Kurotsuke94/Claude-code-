// Tests pour "Visibilité des modules" (écran Super Admin) — voir
// assets/js/pages/nav-visibility.js (registre ITEMS + MX.NavVisibility) et
// assets/js/app.js (buildNav(), consommation de MX.NavVisibility.shouldShow).
//
// Couvre : valeurs par défaut sans config, masquage par profil (tech vs
// responsable), familles vides masquées, restriction Super Admin de l'écran
// et de l'écriture Firestore (simulée fidèlement par mock-firebase.js —
// voir SUPER_ADMIN_ONLY_DOCS), cohérence desktop/mobile, non-régression
// (aucune route cassée, aucune permission existante modifiée), et le
// responsive de l'écran d'édition lui-même.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE  = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');
const SUPER_ADMIN_EMAIL = 'keyzeur94460@hotmail.fr';
const OTHER_ADMIN_EMAIL = 'admin@test.local';

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (120s) — le process est arrêté de force.');
  process.exit(1);
}, 120000);

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
  // Passe par le VRAI formulaire/flux de login (MX.Auth.login), pas par
  // window.__mockAuth.signInWithEmailAndPassword() directement : ce dernier
  // court-circuite l'enveloppe de session admin applicative (localStorage
  // "mx_admin_session", voir auth.js) que le vrai login() écrit après coup,
  // et onAuthStateChanged rejette alors la session comme "restaurée sans
  // enveloppe valide" — un faux négatif purement lié au raccourci de test.
  await page.evaluate((email) => {
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = 'x';
  }, email);
  await page.evaluate(() => { MX.Auth.login({ preventDefault() {} }); });
  await page.waitForTimeout(300);
}
function evalPage(page, fn, ...args) { return page.evaluate(fn, ...args); }
async function saveVisibility(page, cfg) {
  return page.evaluate((cfg) => MX.DB.saveNavVisibility(cfg, 'test'), cfg);
}
async function sidebarHtml(page) { return page.evaluate(() => document.getElementById('sidebar-nav').innerHTML); }
async function bottomHtml(page)  { return page.evaluate(() => document.getElementById('bottom-nav').innerHTML); }
async function dismissOverlay(page) { await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); }); }
async function clickSafe(page, selector) { await dismissOverlay(page); await page.click(selector, { force: true }); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => { ctx.route('**://*.googleapis.com/**', r => r.abort()); ctx.route('**://*.gstatic.com/**', r => r.abort()); };
  const newCtx = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await routeBlock(ctx);
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };

  // ═══ 1. Aucune configuration → tous les menus actuels visibles ═══
  {
    console.log('\n--- 1. Aucune configuration existante ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'kevin', '1111');
    const html = await sidebarHtml(page);
    ok('1.1 Planning visible (technicien, pas de config)', /Planning/.test(html));
    ok('1.2 Missions visible (technicien, pas de config)', /Missions/.test(html));
    const cfg = await evalPage(page, () => MX.state.navVisibility);
    ok('1.2b state.navVisibility bien null/undefined (aucun doc)', !cfg);
    await ctx.close();
  }

  // ═══ 2. Tech Planning masqué → Planning absent ═══
  {
    console.log('\n--- 2. Tech Planning masqué ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, { planning: { tech: false, responsable: true } });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    const html = await sidebarHtml(page);
    ok('2.1 Planning absent de la sidebar (technicien)', !/>Planning</.test(html));
    ok('2.2 Missions toujours visible (non masqué)', /Missions/.test(html));
    await ctx.close();
  }

  // ═══ 3. Responsable Planning masqué → Planning absent ═══
  {
    console.log('\n--- 3. Responsable Planning masqué ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, { planning: { tech: true, responsable: false } });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'sophie', '9999');
    const html = await sidebarHtml(page);
    ok('3.1 Planning absent de la sidebar (responsable)', !/>Planning</.test(html));
    await ctx.close();
  }

  // ═══ 4. Tech masqué / Responsable visible → comportements différents ═══
  {
    console.log('\n--- 4. Tech masqué / Responsable visible ---');
    const { ctx: ctxA, page: pageA } = await newCtx();
    await adminLogin(pageA, SUPER_ADMIN_EMAIL);
    await saveVisibility(pageA, { planning: { tech: false, responsable: true } });
    await pageA.waitForTimeout(200);
    await pageA.evaluate(() => window.__mockAuth.signOut());
    await pageA.waitForTimeout(200);
    await pinLogin(pageA, 'kevin', '1111');
    const htmlTech = await sidebarHtml(pageA);
    ok('4.1 Planning absent pour le technicien', !/>Planning</.test(htmlTech));

    const { ctx: ctxB, page: pageB } = await newCtx();
    await pinLogin(pageB, 'sophie', '9999');
    const htmlResp = await sidebarHtml(pageB);
    ok('4.2 Planning toujours visible pour la responsable (même config)', />Planning</.test(htmlResp));
    await ctxA.close(); await ctxB.close();
  }

  // ═══ 5-6. Stock masqué (tech / responsable) ═══
  {
    console.log('\n--- 5-6. Stock masqué ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, { stock: { tech: false, responsable: true } });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    let html = await sidebarHtml(page);
    ok('5.1 Stock absent pour le technicien', !/data-group="stock"/.test(html));
    await ctx.close();
  }
  {
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, { stock: { tech: true, responsable: false } });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'sophie', '9999');
    const html = await sidebarHtml(page);
    ok('6.1 Stock absent pour la responsable', !/data-group="stock"/.test(html));
    await ctx.close();
  }

  // ═══ 7. Plusieurs modules masqués simultanément ═══
  {
    console.log('\n--- 7. Plusieurs modules masqués ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, {
      planning: { tech: false, responsable: true },
      stock:    { tech: false, responsable: true },
      anly:     { tech: false, responsable: true },
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    const html = await sidebarHtml(page);
    ok('7.1 Planning absent', !/>Planning</.test(html));
    ok('7.2 Stock absent', !/data-group="stock"/.test(html));
    ok('7.3 Analyses absent', !/data-group="anly"/.test(html));
    ok('7.4 Missions toujours présent (non masqué)', /Missions/.test(html));
    await ctx.close();
  }

  // ═══ 8. Famille vide → titre de famille masqué ═══
  {
    console.log('\n--- 8. Famille vide (PILOTAGE) masquée pour la responsable ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, {
      'org-resp':             { tech: true, responsable: false },
      'gestion-semaine-tech': { tech: true, responsable: false },
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'sophie', '9999');
    const html = await sidebarHtml(page);
    ok('8.1 Organisation Responsable absente', !/Organisation Responsable/.test(html));
    ok('8.2 Gestion semaine tech absente', !/Gestion semaine tech/.test(html));
    ok('8.3 Le titre de section "PILOTAGE" est masqué (famille vide)', !/>PILOTAGE</.test(html));
    ok('8.4 "ÉQUIPE" reste affiché (jamais configurable, non vide)', />ÉQUIPE</.test(html));
    await ctx.close();
  }

  // ═══ 9. Menu Super Admin visible uniquement au vrai Super Admin ═══
  {
    console.log('\n--- 9. Écran réservé au Super Admin ---');
    const { ctx: ctxOther, page: pageOther } = await newCtx();
    await adminLogin(pageOther, OTHER_ADMIN_EMAIL);
    const htmlOther = await sidebarHtml(pageOther);
    ok('9.1 "Visibilité des modules" absent pour un admin non-Super-Admin', !/Visibilité des modules/.test(htmlOther));
    const redirectedOther = await evalPage(pageOther, () => { MX.Pages.NavVisibility.render(); return MX.state.currentPage; });
    ok('9.2 Un appel direct render() redirige un admin non-Super-Admin hors de l\'écran', redirectedOther !== 'nav-visibility');
    await ctxOther.close();

    const { ctx: ctxSuper, page: pageSuper } = await newCtx();
    await adminLogin(pageSuper, SUPER_ADMIN_EMAIL);
    const htmlSuper = await sidebarHtml(pageSuper);
    ok('9.3 "Visibilité des modules" visible pour le vrai Super Admin', /Visibilité des modules/.test(htmlSuper));
    await evalPage(pageSuper, () => { MX.showPage('nav-visibility'); });
    await pageSuper.waitForTimeout(200);
    const onPage = await evalPage(pageSuper, () => MX.state.currentPage === 'nav-visibility');
    ok('9.4 Le Super Admin accède bien à l\'écran', onPage);
    await ctxSuper.close();
  }

  // ═══ 10-11. Tech / Responsable ne voient jamais le menu de config ═══
  {
    console.log('\n--- 10-11. Tech/Responsable ne voient jamais le menu de config ---');
    const { ctx: ctxT, page: pageT } = await newCtx();
    await pinLogin(pageT, 'kevin', '1111');
    const htmlT = await sidebarHtml(pageT);
    ok('10.1 "Visibilité des modules" absent pour un technicien', !/Visibilité des modules/.test(htmlT));
    const redirT = await evalPage(pageT, () => { MX.Pages.NavVisibility.render(); return MX.state.currentPage; });
    ok('10.2 Un technicien qui appelle render() est redirigé', redirT !== 'nav-visibility');
    await ctxT.close();

    const { ctx: ctxR, page: pageR } = await newCtx();
    await pinLogin(pageR, 'sophie', '9999');
    const htmlR = await sidebarHtml(pageR);
    ok('11.1 "Visibilité des modules" absent pour une responsable', !/Visibilité des modules/.test(htmlR));
    const redirR = await evalPage(pageR, () => { MX.Pages.NavVisibility.render(); return MX.state.currentPage; });
    ok('11.2 Une responsable qui appelle render() est redirigée', redirR !== 'nav-visibility');
    await ctxR.close();
  }

  // ═══ 12-13. Cohérence mobile / desktop ═══
  {
    console.log('\n--- 12-13. Navigation mobile / desktop cohérente ---');
    const { ctx, page } = await newCtx({ width: 390, height: 844 });
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, { planning: { tech: false, responsable: true } });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    let bot = await bottomHtml(page);
    ok('12.1 Bouton Planning absent de la bottom nav mobile (technicien)', !/Planning/.test(bot));
    ok('12.2 Bouton Missions toujours présent (mobile)', /Missions/.test(bot));
    let side = await sidebarHtml(page);
    ok('13.1 Planning absent de la sidebar desktop (même config, cohérence)', !/>Planning</.test(side));
    await ctx.close();
  }

  // ═══ 14. Configuration Firestore indisponible → fallback sécurisé ═══
  {
    console.log('\n--- 14. Fallback si la configuration est indisponible ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'kevin', '1111');
    // Simule un état où le document n'a jamais pu être chargé (absent ou
    // erreur d'écoute) : listenNavVisibility(cb) appelle cb(null) dans ce
    // cas (voir db.js) — reproduit ici directement l'état résultant.
    await evalPage(page, () => { MX.state.navVisibility = null; });
    const stillVisible = await evalPage(page, () => MX.NavVisibility.shouldShow('planning'));
    ok('14.1 shouldShow() retombe sur "visible" si aucune configuration n\'a pu être chargée', stillVisible === true);
    await evalPage(page, () => { MX.buildNav(); });
    await page.waitForTimeout(150);
    const html = await sidebarHtml(page);
    ok('14.2 La navigation reste fonctionnelle (non vidée) malgré l\'absence de configuration', /Missions/.test(html) && html.length > 200);
    await ctx.close();
  }

  // ═══ 15. Configuration modifiée en direct → navigation mise à jour ═══
  {
    console.log('\n--- 15. Mise à jour temps réel (sans que l\'utilisateur navigue) ---');
    const { ctx, page } = await newCtx();
    await pinLogin(page, 'kevin', '1111');
    let html = await sidebarHtml(page);
    ok('15.1 Planning visible avant toute modification', />Planning</.test(html));

    // Kevin reste connecté (session technicien intacte) pendant toute cette
    // étape. __setCurrentUserForTest() impersonne le Super Admin UNIQUEMENT
    // pour la vérification de permission simulée par le mock (fidèle à
    // firestore.rules), sans déclencher onAuthStateChanged sur cette page —
    // exactement le scénario réel : le Super Admin écrit depuis un AUTRE
    // poste pendant que Kevin est déjà connecté ici.
    await page.evaluate(() => {
      window.__mockAuth.__setCurrentUserForTest({ uid: 'super-uid', isAnonymous: false, email: 'keyzeur94460@hotmail.fr' });
    });
    await saveVisibility(page, { planning: { tech: false, responsable: true } });
    await page.evaluate(() => { window.__mockAuth.__setCurrentUserForTest(null); }); // restaure l'état "aucun admin Firebase" pour Kevin
    await page.waitForTimeout(300);
    const stillKevin = await evalPage(page, () => MX.state.currentUser && MX.state.currentUser.id === 'kevin');
    ok('15.2 La session de Kevin n\'a jamais été interrompue pendant l\'écriture', stillKevin);
    html = await sidebarHtml(page);
    ok('15.3 Planning disparaît automatiquement de la sidebar sans rechargement de page (listener temps réel)', !/>Planning</.test(html));
    await ctx.close();
  }

  // ═══ 16-17. Aucun module supprimé / aucune route cassée ═══
  {
    console.log('\n--- 16-17. Aucun module supprimé, aucune route cassée ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await saveVisibility(page, { planning: { tech: false, responsable: true } });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    let side = await sidebarHtml(page);
    ok('16.1 Planning bien absent du menu (précondition)', !/>Planning</.test(side));
    await evalPage(page, () => { MX.showPage('planning'); });
    await page.waitForTimeout(300);
    const stillRoutes = await evalPage(page, () => MX.state.currentPage === 'planning');
    const mc = await page.evaluate(() => document.getElementById('main-content').innerHTML);
    ok('16.2 La route "planning" fonctionne toujours en accès direct (masquage ≠ suppression)', stillRoutes);
    ok('17.1 Le contenu de la page Planning est bien rendu (aucune route cassée)', mc.length > 100);
    await ctx.close();
  }

  // ═══ 18. Aucune permission existante modifiée ═══
  {
    console.log('\n--- 18. Aucune permission existante modifiée ---');
    const { ctx, page } = await newCtx();
    // Un technicien avec un rôle personnalisé qui REFUSE explicitement
    // "planning" doit rester masqué même si la config de visibilité
    // l'autorise — la visibilité ne fait qu'AJOUTER une restriction,
    // jamais en retirer une existante.
    const roleId = await evalPage(page, async () => {
      const id = await MX.DB.addRole({ name: 'Test role', order: 1, permissions: { planning: { view: false } } });
      return id;
    });
    // __setCurrentUserForTest impersonne le Super Admin UNIQUEMENT pour la
    // vérification de permission simulée par le mock (voir test 15) — cette
    // page n'a encore aucune session technicien à préserver ici.
    await page.evaluate(() => {
      window.__mockAuth.__setCurrentUserForTest({ uid: 'super-uid', isAnonymous: false, email: 'keyzeur94460@hotmail.fr' });
    });
    await page.evaluate(async (roleId) => {
      await MX.DB.saveNavVisibility({ planning: { tech: true, responsable: true } }, 'test');
      // Affecte le rôle personnalisé restrictif à Kevin directement en base.
      await window.__mockDb.collection('users').doc('kevin').set({ roleId: roleId }, { merge: true });
    }, roleId);
    await page.evaluate(() => { window.__mockAuth.__setCurrentUserForTest(null); });
    await page.waitForTimeout(200);
    await pinLogin(page, 'kevin', '1111');
    const html = await sidebarHtml(page);
    ok('18.1 Planning reste absent malgré une visibilité "autorisée" (permission existante prioritaire)', !/>Planning</.test(html));
    await ctx.close();
  }

  // ═══ Firestore rule (simulée) : écriture réservée au Super Admin ═══
  {
    console.log('\n--- Règle Firestore config/navigation_visibility ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, OTHER_ADMIN_EMAIL);
    let rejected = false;
    try { await saveVisibility(page, { planning: { tech: false, responsable: true } }); }
    catch (e) { rejected = /permission/i.test(e.message || ''); }
    ok('R.1 Un admin Firebase non-Super-Admin ne peut PAS écrire config/navigation_visibility', rejected);

    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(150);
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    let succeeded = true;
    try { await saveVisibility(page, { planning: { tech: false, responsable: true } }); }
    catch (e) { succeeded = false; }
    ok('R.2 Le Super Admin PEUT écrire config/navigation_visibility', succeeded);

    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(150);
    await adminLogin(page, OTHER_ADMIN_EMAIL);
    const readExists = await page.evaluate(() => window.__mockDb.collection('config').doc('navigation_visibility').get().then(s => s.exists));
    ok('R.3 La lecture reste autorisée pour un admin non-Super-Admin (seule l\'écriture est restreinte)', readExists === true);
    await ctx.close();
  }

  // ═══ Responsive de l'écran "Visibilité des modules" ═══
  {
    console.log('\n--- Responsive (375/390/430/768/1024/1280/1440/1920) ---');
    const { ctx, page } = await newCtx({ width: 375, height: 800 });
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await evalPage(page, () => { MX.showPage('nav-visibility'); });
    await page.waitForTimeout(200);

    const widths = [375, 390, 430, 768, 1024, 1280, 1440, 1920];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      await evalPage(page, () => { MX.Pages.NavVisibility.render(); });
      await page.waitForTimeout(100);
      const info = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        toggleCount: document.querySelectorAll('#main-content button[aria-pressed]').length,
        toggleHeights: Array.from(document.querySelectorAll('#main-content button[aria-pressed]')).slice(0, 5).map(el => el.getBoundingClientRect().height),
      }));
      ok(w + 'px — aucun scroll horizontal global de la page', info.scrollW <= info.clientW + 2);
      ok(w + 'px — au moins un contrôle de visibilité rendu', info.toggleCount > 0);
      ok(w + 'px — cibles de bascule suffisamment grandes (≥ 32px)', info.toggleHeights.every(h => h >= 32));
    }
    await ctx.close();
  }

  // ═══ Boutons Afficher tout / Masquer tout + Enregistrer ═══
  {
    console.log('\n--- Boutons de bascule groupée + enregistrement ---');
    const { ctx, page } = await newCtx();
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await evalPage(page, () => { MX.showPage('nav-visibility'); });
    await page.waitForTimeout(200);
    await evalPage(page, () => { MX.Pages.NavVisibility._bulkSet('tech', false); });
    let allMasked = await evalPage(page, () => document.getElementById('main-content').innerHTML);
    ok('B.1 "Masquer tout pour les techniciens" masque bien tous les items (aperçu)', (allMasked.match(/Masqué/g) || []).length >= 19);
    await evalPage(page, () => { MX.Pages.NavVisibility._save(); });
    await page.waitForTimeout(300);
    const doc = await page.evaluate(() => window.__mockDb.collection('config').doc('navigation_visibility').get().then(s => s.data()));
    ok('B.2 La configuration "tout masqué pour tech" est bien persistée', doc && doc['mes-missions'] && doc['mes-missions'].tech === false);
    await page.evaluate(() => window.__mockAuth.signOut());
    await page.waitForTimeout(150);
    await pinLogin(page, 'kevin', '1111');
    const sideHtml = await sidebarHtml(page);
    ok('B.3 Un technicien ne voit plus aucun module configurable après "Masquer tout"', !/Missions/.test(sideHtml) && !/Interventions/.test(sideHtml));
    ok('B.4 Accueil et Paramètres restent toujours visibles (non configurables)', /Accueil/.test(sideHtml) && /Paramètres/.test(sideHtml));
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests de visibilité des modules passent.');
  process.exit(failures ? 1 : 0);
})();
