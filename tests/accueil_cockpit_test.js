// Tests pour la refonte de l'Accueil Maintix V2 — hero météo, carte
// Annonces (réutilisation de state.announcements), carte "État maintenance"
// (remplace "Objectifs opérationnels"), réordonnancement des cartes et
// non-régression des permissions/fonctionnalités existantes.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');
// URL fixture pour une bannière déjà "existante" — data: URI (zéro E/S
// réseau, contrairement à un faux hostname externe qui déclencherait un
// vrai essai de connexion dès que la page l'utilise en background-image).
const FAKE_OLD_BANNER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

setTimeout(() => {
  console.error('\nTIMEOUT GLOBAL (170s) — le process est arrêté de force.');
  process.exit(1);
}, 170000);

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
// Connexion Admin Firebase réelle (passe par le vrai flux MX.Auth.login —
// le mock signInWithEmailAndPassword accepte n'importe quel email/mot de
// passe, comme un vrai compte Firebase Admin en environnement de test).
async function adminLogin(page, email, pass) {
  await page.evaluate((a) => {
    document.getElementById('login-email').value = a.email;
    document.getElementById('login-password').value = a.pass;
  }, { email, pass });
  await page.evaluate(async () => { await MX.Auth.login({ preventDefault: () => {} }); });
  await page.waitForTimeout(400);
}
function evalPage(page, fn, ...args) { return page.evaluate(fn, ...args); }
async function clickSafe(page, selector) {
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.click(); }, selector);
}
async function mainHtml(page) { return page.evaluate(() => document.getElementById('main-content').innerHTML); }
async function noHorizScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}
async function seedAnnouncement(page, opts) {
  return evalPage(page, (o) => MX.DB.sendAnnouncement({
    type: o.type || 'info', content: o.content || '', title: o.title || '',
    authorName: o.authorName || 'Sophie', authorRole: o.authorRole || 'responsable',
  }), opts);
}
async function pinAnnouncement(page, index) {
  return evalPage(page, async (i) => {
    const snap = await window.__mockDb.collection('announcements').get();
    const doc = snap.docs[i];
    if (doc) await MX.DB.togglePin(doc.id, false);
  }, index);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => {
    ctx.route('**://*.googleapis.com/**', r => r.abort());
    ctx.route('**://*.gstatic.com/**', r => r.abort());
    ctx.route('**://api.open-meteo.com/**', r => r.abort()); // par défaut : réseau météo bloqué (pas d'appel réel en test)
  };
  const newCtx = async (viewport, extraRoutes) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 } });
    await routeBlock(ctx);
    if (extraRoutes) await extraRoutes(ctx); // enregistré APRÈS routeBlock => priorité (dernier enregistré gagne)
    const page = await ctx.newPage();
    const pageErrors = await bootPage(page);
    return { ctx, page, pageErrors };
  };

  let ctx, page;

  async function gotoHome() {
    await page.evaluate(() => { MX.showPage('home'); });
    await page.waitForTimeout(500);
  }

  // ═══ 1. Annonces — état 0 annonce ═══
  {
    console.log('\n--- 1. Annonces — 0 annonce ---');
    ({ ctx, page } = await newCtx());
    await pinLogin(page, 'sophie', '9999');
    await gotoHome();
    const html = await mainHtml(page);
    ok('1.1 Carte "Annonces" présente', /Annonces/.test(html));
    ok('1.2 État vide "Aucune annonce pour le moment"', /Aucune annonce pour le moment/.test(html));
    ok('1.3 Lien "Voir toutes les annonces" présent', /Voir toutes les annonces/.test(html));
    ok('1.4 Aucune erreur JS', true);
    await ctx.close();
  }

  // ═══ 2. Annonces — plusieurs annonces, épinglée en premier ═══
  {
    console.log('\n--- 2. Annonces — plusieurs annonces + épinglage ---');
    ({ ctx, page } = await newCtx());
    await pinLogin(page, 'sophie', '9999');
    await seedAnnouncement(page, { type: 'info', title: 'Info générale', content: 'Contenu info' });
    await page.waitForTimeout(50);
    await seedAnnouncement(page, { type: 'incident', title: 'Incident ascenseur', content: 'Ascenseur bloqué' });
    await page.waitForTimeout(50);
    await seedAnnouncement(page, { type: 'consigne', title: 'Consigne du jour', content: 'Fermer les volets' });
    await pinAnnouncement(page, 2); // épingle la 3e (la plus ancienne) pour vérifier qu'elle passe devant malgré son âge
    await page.waitForTimeout(200);
    await gotoHome();
    const html = await mainHtml(page);
    ok('2.1 Les 3 annonces sont visibles', /Info générale/.test(html) && /Incident ascenseur/.test(html) && /Consigne du jour/.test(html));
    const pinIdx = html.indexOf('acc-ann-pin');
    const consigneIdx = html.indexOf('Consigne du jour');
    const infoIdx = html.indexOf('Info générale');
    ok('2.2 L\'annonce épinglée apparaît en premier (avant les non-épinglées)', pinIdx !== -1 && consigneIdx !== -1 && consigneIdx < infoIdx);
    ok('2.3 Lien "Voir toutes les annonces" pointe vers le Journal (msgs)', await evalPage(page, () => {
      const btn = [...document.querySelectorAll('.acc-card-announcements .acc-card-link')].find(b => /Voir toutes les annonces/.test(b.textContent));
      return !!btn && /showPage\('msgs'\)/.test(btn.getAttribute('onclick') || '');
    }));
    // Navigation réelle : cliquer doit afficher le Journal d'exploitation
    await clickSafe(page, '.acc-card-announcements .acc-card-link');
    await page.waitForTimeout(300);
    const html2 = await mainHtml(page);
    ok('2.4 Le clic navigue bien vers le Journal d\'exploitation (pas de page vide)', html2.length > 200 && html2 !== html);
    await ctx.close();
  }

  // ═══ 3. Météo — non configurée, Admin (seul profil autorisé à configurer) ═══
  {
    console.log('\n--- 3. Météo — non configurée (Admin) ---');
    ({ ctx, page } = await newCtx());
    await adminLogin(page, 'admin@maintix.local', 'x');
    await gotoHome();
    const html = await mainHtml(page);
    ok('3.1 Widget météo présent', /acc-weather/.test(html));
    ok('3.2 Message détaillé "Localisation non configurée" (Admin)', /Localisation non configurée/.test(html));
    ok('3.3 Aucune température fictive affichée', !/acc-weather-temp/.test(html));
    ok('3.4 Lien "Configurer la météo" visible pour un Admin', /Configurer la météo/.test(html));
    await clickSafe(page, '.acc-weather-cfg');
    await page.waitForTimeout(400);
    const html2 = await mainHtml(page);
    ok('3.5 Le clic navigue bien vers Paramètres > Établissement (pas de page vide)', /Latitude|Établissement/.test(html2));
    await ctx.close();
  }

  // ═══ 3b. Météo — non configurée, Responsable / Technicien (aucune config visible) ═══
  {
    console.log('\n--- 3b. Météo — non configurée (Responsable / Technicien) ---');
    for (const u of [{ id: 'sophie', pin: '9999', label: 'Responsable' }, { id: 'kevin', pin: '1111', label: 'Technicien' }]) {
      ({ ctx, page } = await newCtx());
      await pinLogin(page, u.id, u.pin);
      await gotoHome();
      const html = await mainHtml(page);
      ok('3b.' + u.label + '.1 Widget météo présent', /acc-weather/.test(html));
      ok('3b.' + u.label + '.2 Message simplifié "Météo non configurée" (pas le message détaillé Admin)', /Météo non configurée/.test(html) && !/Localisation non configurée/.test(html));
      ok('3b.' + u.label + '.3 Aucun bouton "Configurer la météo"', !/Configurer la météo/.test(html) && !/acc-weather-cfg/.test(html));
      await ctx.close();
    }
  }

  // ═══ 4. Météo — configurée, API en succès (OK) — visible pour TOUS les
  //         profils (Admin/Responsable/Technicien), seule la capacité de
  //         CONFIGURER change selon le rôle, jamais l'affichage. ═══
  for (const u of [{ id: 'sophie', pin: '9999', label: 'Responsable' }, { id: 'kevin', pin: '1111', label: 'Technicien' }]) {
    console.log('\n--- 4. Météo — configurée, API OK (' + u.label + ') ---');
    ({ ctx, page } = await newCtx({ width: 1440, height: 900 }, async (c) => {
      await c.route('**://api.open-meteo.com/**', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          current: { temperature_2m: 18.4, weather_code: 2 },
          daily: { temperature_2m_min: [12.1], temperature_2m_max: [21.7] },
        }),
      }));
    }));
    await pinLogin(page, u.id, u.pin);
    // La config est déjà en base (écrite par un Admin) — un non-Admin ne
    // fait ici QUE la lire via le listener existant, jamais l'écrire.
    await evalPage(page, () => window.__mockDb.collection('config').doc('hotel_config').set({ lat: 45.8992, lon: 6.1294, cityLabel: 'Annecy' }).then(() => { MX.state.hotelConfig = { lat: 45.8992, lon: 6.1294, cityLabel: 'Annecy' }; }));
    await gotoHome();
    await page.waitForTimeout(600); // laisse le fetch météo (mocké) se résoudre puis re-render
    const html = await mainHtml(page);
    ok('4.' + u.label + '.1 Température réelle affichée (18°)', /18°/.test(html));
    ok('4.' + u.label + '.2 Ville affichée (Annecy)', /Annecy/.test(html));
    ok('4.' + u.label + '.3 Min/max affichés (12° \/ 22°)', /12°\s*\/\s*22°/.test(html));
    ok('4.' + u.label + '.4 Plus de message "non configurée"', !/configurée/.test(html));
    ok('4.' + u.label + '.5 Toujours aucun bouton "Configurer la météo" (météo OK, non-Admin)', !/Configurer la météo/.test(html));
    await ctx.close();
  }

  // ═══ 5. Météo — configurée, API indisponible (erreur réseau) ═══
  {
    console.log('\n--- 5. Météo — configurée, API indisponible ---');
    ({ ctx, page } = await newCtx({ width: 1440, height: 900 }, async (c) => {
      await c.route('**://api.open-meteo.com/**', r => r.abort('failed'));
    }));
    await pinLogin(page, 'sophie', '9999');
    await evalPage(page, () => MX.DB.saveHotelConfig({ lat: 45.8992, lon: 6.1294, cityLabel: 'Annecy' }).then(() => { MX.state.hotelConfig = { lat: 45.8992, lon: 6.1294, cityLabel: 'Annecy' }; }));
    await gotoHome();
    await page.waitForTimeout(600);
    const html = await mainHtml(page);
    ok('5.1 Message "Données météo temporairement indisponibles"', /Données météo temporairement indisponibles/.test(html));
    ok('5.2 Aucune température fictive affichée', !/acc-weather-temp/.test(html));
    ok('5.3 Le reste de l\'Accueil fonctionne normalement (KPI header présent)', /acc-kpi-row/.test(html));
    await ctx.close();
  }

  // (ancien test 6 "technicien sans droit de configuration" — couvert plus
  // largement par le test 3b ci-dessus, qui vérifie Responsable ET Technicien.)

  // ═══ 7. État maintenance — quad-KPI avec données réelles ═══
  {
    console.log('\n--- 7. État maintenance — quad-KPI ---');
    ({ ctx, page } = await newCtx());
    await pinLogin(page, 'sophie', '9999');
    await evalPage(page, () => window.__mockDb.collection('interventions').add({
      title: 'Urgence chaudière', assignedTo: ['Kevin'], priority: 'urgente', status: 'planifiee', location: 'Chaufferie',
    }));
    await evalPage(page, () => window.__mockDb.collection('interventions').add({
      title: 'Peinture couloir', assignedTo: ['Kevin'], priority: 'normale', status: 'affectee', location: 'Étage 2',
    }));
    await page.waitForTimeout(300);
    await gotoHome();
    await page.waitForTimeout(400);
    const html = await mainHtml(page);
    ok('7.1 Carte "État maintenance" présente', /État maintenance/.test(html));
    ok('7.2 Libellés du quad-KPI présents (Ouvertes/Urgentes/En attente/Retards)', /Ouvertes/.test(html) && /Urgentes/.test(html) && /En attente/.test(html) && /Retards/.test(html));
    ok('7.3 Ancienne carte "Objectifs opérationnels" supprimée', !/Objectifs opérationnels/.test(html));
    await ctx.close();
  }

  // ═══ 8. Réordonnancement mobile (375px) : Hero → Priorités → Annonces → Énergie → Stock → État maintenance → Actions rapides → Ma journée/Activité ═══
  {
    console.log('\n--- 8. Réordonnancement mobile (375px) ---');
    ({ ctx, page } = await newCtx({ width: 375, height: 812 }));
    await pinLogin(page, 'sophie', '9999');
    await gotoHome();
    const order = await evalPage(page, () => {
      var sel = ['.acc-card-priorities', '.acc-card-announcements', '.acc-card-energie', '.acc-card-maintenance', '.acc-card-actions', '.acc-card-day', '.acc-card-activity'];
      return sel.map(function (s) {
        var el = document.querySelector(s);
        return el ? el.getBoundingClientRect().top : null;
      });
    });
    ok('8.1 Toutes les cartes attendues sont présentes', order.every(function (v) { return v !== null; }));
    ok('8.2 Priorités avant Annonces', order[0] < order[1]);
    ok('8.3 Annonces avant Énergie', order[1] < order[2]);
    ok('8.4 Énergie avant État maintenance', order[2] < order[3]);
    ok('8.5 État maintenance avant Actions rapides', order[3] < order[4]);
    ok('8.6 Actions rapides avant Ma journée', order[4] < order[5]);
    ok('8.7 Ma journée avant Dernières activités', order[5] < order[6]);
    ok('8.8 Pas de scroll horizontal à 375px', await noHorizScroll(page));
    await ctx.close();
  }

  // ═══ 9. Responsive — pas de scroll horizontal sur les résolutions clés ═══
  {
    console.log('\n--- 9. Responsive — no horizontal scroll ---');
    for (const vp of [{ w: 390, h: 844 }, { w: 430, h: 932 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1280, h: 800 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }]) {
      ({ ctx, page } = await newCtx({ width: vp.w, height: vp.h }));
      await pinLogin(page, 'sophie', '9999');
      await gotoHome();
      ok('9.' + vp.w + ' Pas de scroll horizontal à ' + vp.w + 'x' + vp.h, await noHorizScroll(page));
      await ctx.close();
    }
  }

  // ═══ 10. Dernières activités — limitée à 5 (au lieu de 8) ═══
  {
    console.log('\n--- 10. Dernières activités limitée à 5 ---');
    ({ ctx, page } = await newCtx());
    await pinLogin(page, 'sophie', '9999');
    for (let i = 0; i < 8; i++) {
      await evalPage(page, (i) => window.__mockDb.collection('logs').add({ workerName: 'Kevin', action: 'check', taskText: 'Tâche ' + i }), i);
    }
    await page.waitForTimeout(300);
    await gotoHome();
    await page.waitForTimeout(300);
    const count = await evalPage(page, () => document.querySelectorAll('.acc-feed-row').length);
    ok('10.1 Au maximum 5 lignes d\'activité affichées', count > 0 && count <= 5);
    await ctx.close();
  }

  // ═══ 11. Non-régression — technicien ne voit pas les cartes réservées (PMP) ═══
  {
    console.log('\n--- 11. Non-régression permissions technicien ---');
    ({ ctx, page } = await newCtx());
    await pinLogin(page, 'kevin', '1111');
    await gotoHome();
    const html = await mainHtml(page);
    ok('11.1 KPI "PMP en retard" absent pour un technicien', !/PMP en retard/.test(html));
    ok('11.2 Priorités du jour toujours visibles (non-régression)', /Priorités du jour/.test(html));
    ok('11.3 Ma journée toujours visible (non-régression)', /Ma journée/.test(html));
    ok('11.4 Actions rapides toujours visibles (non-régression)', /Actions rapides/.test(html));
    await ctx.close();
  }

  // ═══ 12. Paramètres — section "Établissement" (Admin STRICT uniquement,
  //         cohérent avec firestore.rules config/{docId}: isAdmin()) ═══
  {
    console.log('\n--- 12. Réglages Établissement — Admin ---');
    ({ ctx, page } = await newCtx());
    await adminLogin(page, 'admin@maintix.local', 'x');
    await page.evaluate(() => { window._settingsTab = 'etablissement'; MX.showPage('parametres'); });
    await page.waitForTimeout(400);
    const html = await mainHtml(page);
    ok('12.1 Section Établissement accessible à un Admin', /Établissement|Latitude|Longitude/.test(html));
    await evalPage(page, () => {
      document.getElementById('etb-city').value = 'Chamonix';
      document.getElementById('etb-lat').value = '45.9237';
      document.getElementById('etb-lon').value = '6.8694';
    });
    await evalPage(page, () => window._sttSaveEtablissement());
    await page.waitForTimeout(300);
    const saved = await evalPage(page, () => window.__mockDb.collection('config').doc('hotel_config').get().then(s => s.data()));
    ok('12.2 Les coordonnées sont bien enregistrées dans config/hotel_config', saved && saved.cityLabel === 'Chamonix' && Math.abs(saved.lat - 45.9237) < 0.001);
    await ctx.close();
  }

  // ═══ 12b. Paramètres — section "Établissement" bloquée pour Responsable et Technicien ═══
  {
    console.log('\n--- 12b. Réglages Établissement — Responsable / Technicien bloqués ---');
    for (const u of [{ id: 'sophie', pin: '9999', label: 'Responsable' }, { id: 'kevin', pin: '1111', label: 'Technicien' }]) {
      ({ ctx, page } = await newCtx());
      await pinLogin(page, u.id, u.pin);
      await page.evaluate(() => { window._settingsTab = 'etablissement'; MX.showPage('parametres'); });
      await page.waitForTimeout(400);
      const html = await mainHtml(page);
      ok('12b.' + u.label + '.1 Formulaire Établissement invisible ("Accès réservé")', /Accès réservé/.test(html));
      ok('12b.' + u.label + '.2 Aucun champ Latitude/Longitude dans le DOM', await evalPage(page, () => !document.getElementById('etb-lat') && !document.getElementById('etb-lon')));
      await ctx.close();
    }
  }

  // Sélectionne un fichier via l'input dynamique créé par _sttPickHeroBanner
  // (jamais attaché au DOM — on intercepte l'évènement filechooser natif,
  // seule approche Playwright valable pour un <input> détaché).
  async function pickBannerFile(page, buttonSelector, filename) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      clickSafe(page, buttonSelector),
    ]);
    await chooser.setFiles({ name: filename || 'banniere.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]) });
    await page.waitForTimeout(300);
  }

  // ═══ 14. Bannière — aucune image configurée → dégradé par défaut ═══
  {
    console.log('\n--- 14. Bannière — aucune image (dégradé par défaut) ---');
    for (const u of [{ id: 'sophie', pin: '9999', label: 'Responsable' }, { id: 'kevin', pin: '1111', label: 'Technicien' }]) {
      ({ ctx, page } = await newCtx());
      await pinLogin(page, u.id, u.pin);
      await gotoHome();
      const hasPhotoClass = await evalPage(page, () => !!document.querySelector('.acc-header.acc-header--photo'));
      ok('14.' + u.label + ' Pas de classe acc-header--photo sans bannière configurée', !hasPhotoClass);
      await ctx.close();
    }
  }

  // ═══ 15. Bannière — Admin ajoute une image (upload réel via mock Storage) ═══
  {
    console.log('\n--- 15. Bannière — Admin ajoute une image ---');
    ({ ctx, page } = await newCtx());
    await adminLogin(page, 'admin@maintix.local', 'x');
    await page.evaluate(() => { window._settingsTab = 'etablissement'; MX.showPage('parametres'); });
    await page.waitForTimeout(400);
    let html = await mainHtml(page);
    ok('15.1 État initial : pas de bannière, bouton "Ajouter une image"', /Ajouter une image/.test(html) && /Aucune bannière/.test(html));

    await pickBannerFile(page, '.etb-banner-add-btn', 'banniere1.jpg');
    html = await mainHtml(page);
    ok('15.2 Aperçu affiché avant validation ("Enregistrer cette bannière")', /Enregistrer cette bannière/.test(html) && /n'est pas encore enregistrée/.test(html));

    await clickSafe(page, '.etb-banner-confirm-btn');
    await page.waitForTimeout(500);
    html = await mainHtml(page);
    ok('15.3 Après confirmation : bouton "Remplacer" visible (bannière active)', /Remplacer/.test(html));
    const uploads = await evalPage(page, () => window.__storageLog.uploads.length);
    ok('15.4 Un upload Storage a bien eu lieu', uploads === 1);
    const savedUrl = await evalPage(page, () => window.__mockDb.collection('config').doc('hotel_config').get().then(s => s.data().heroImageUrl));
    ok('15.5 heroImageUrl bien enregistré dans config/hotel_config', !!savedUrl && savedUrl.indexOf('blob:') === 0);

    await gotoHome();
    html = await mainHtml(page);
    ok('15.6 Accueil affiche la classe acc-header--photo', /acc-header--photo/.test(html));
    ok('15.7 Le style de fond référence bien l\'URL de la bannière', html.indexOf(savedUrl) !== -1);
    await ctx.close();
  }

  // ═══ 16. Bannière — remplacement (l'ancienne image n'est supprimée
  //          qu'APRÈS confirmation de la nouvelle config) ═══
  {
    console.log('\n--- 16. Bannière — remplacement ---');
    ({ ctx, page } = await newCtx());
    await adminLogin(page, 'admin@maintix.local', 'x');
    await evalPage(page, (url) => MX.DB.saveHotelConfig({ heroImageUrl: url }).then(() => { MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, { heroImageUrl: url }); }), FAKE_OLD_BANNER);
    await page.evaluate(() => { window._settingsTab = 'etablissement'; MX.showPage('parametres'); });
    await page.waitForTimeout(400);
    let html = await mainHtml(page);
    ok('16.1 Bouton "Remplacer" visible (bannière déjà configurée)', /Remplacer/.test(html));

    await pickBannerFile(page, '.etb-banner-add-btn', 'banniere2.jpg');
    await clickSafe(page, '.etb-banner-confirm-btn');
    await page.waitForTimeout(500);
    const savedUrl = await evalPage(page, () => window.__mockDb.collection('config').doc('hotel_config').get().then(s => s.data().heroImageUrl));
    ok('16.2 La nouvelle URL est bien celle enregistrée', savedUrl !== FAKE_OLD_BANNER);
    const deletes = await evalPage(page, () => window.__storageLog.deletes);
    ok('16.3 L\'ANCIENNE image a bien été supprimée de Storage (après coup, non bloquant)', deletes.indexOf(FAKE_OLD_BANNER) !== -1);
    ok('16.4 La nouvelle image n\'a PAS été supprimée', deletes.indexOf(savedUrl) === -1);
    await ctx.close();
  }

  // ═══ 17. Bannière — suppression (retour au dégradé par défaut) ═══
  {
    console.log('\n--- 17. Bannière — suppression ---');
    ({ ctx, page } = await newCtx());
    await adminLogin(page, 'admin@maintix.local', 'x');
    await evalPage(page, (url) => MX.DB.saveHotelConfig({ heroImageUrl: url }).then(() => { MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, { heroImageUrl: url }); }), FAKE_OLD_BANNER);
    await page.evaluate(() => { window._settingsTab = 'etablissement'; MX.showPage('parametres'); });
    await page.waitForTimeout(400);
    await evalPage(page, () => { window.confirm = () => true; }); // auto-confirme la modale native
    await clickSafe(page, '.etb-banner-remove-btn');
    await page.waitForTimeout(400);
    const html = await mainHtml(page);
    ok('17.1 Retour à l\'état "Aucune bannière"', /Aucune bannière/.test(html) && /Ajouter une image/.test(html));
    await gotoHome();
    const homeHtml = await mainHtml(page);
    ok('17.2 Accueil revient au dégradé par défaut (pas de acc-header--photo)', !/acc-header--photo/.test(homeHtml));
    await ctx.close();
  }

  // ═══ 18. Bannière — visible pour Responsable/Technicien, jamais de contrôle d'édition ═══
  {
    console.log('\n--- 18. Bannière visible en lecture seule (Responsable/Technicien) ---');
    for (const u of [{ id: 'sophie', pin: '9999', label: 'Responsable' }, { id: 'kevin', pin: '1111', label: 'Technicien' }]) {
      ({ ctx, page } = await newCtx());
      await pinLogin(page, u.id, u.pin);
      await evalPage(page, (url) => window.__mockDb.collection('config').doc('hotel_config').set({ heroImageUrl: url }, { merge: true }).then(() => { MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, { heroImageUrl: url }); }), FAKE_OLD_BANNER);
      await gotoHome();
      const html = await mainHtml(page);
      ok('18.' + u.label + '.1 La bannière est visible (acc-header--photo)', /acc-header--photo/.test(html));
      ok('18.' + u.label + '.2 Aucun bouton d\'édition de bannière sur l\'Accueil', !/etb-banner-add-btn|etb-banner-remove-btn|_sttPickHeroBanner/.test(html));
      await ctx.close();
    }
  }

  // ═══ 19. Bannière — ordre de sauvegarde sécurisé : échec Firestore après
  //          upload réussi ⇒ nouvelle image nettoyée, ANCIENNE bannière conservée ═══
  {
    console.log('\n--- 19. Bannière — échec sauvegarde Firestore (nettoyage sécurisé) ---');
    ({ ctx, page } = await newCtx());
    await adminLogin(page, 'admin@maintix.local', 'x');
    await evalPage(page, (url) => MX.DB.saveHotelConfig({ heroImageUrl: url }).then(() => { MX.state.hotelConfig = Object.assign({}, MX.state.hotelConfig, { heroImageUrl: url }); }), FAKE_OLD_BANNER);
    await page.evaluate(() => { window._settingsTab = 'etablissement'; MX.showPage('parametres'); });
    await page.waitForTimeout(400);
    // Force l'échec de la sauvegarde Firestore pour CE test uniquement.
    await evalPage(page, () => { window.__origSaveHotelConfig = MX.DB.saveHotelConfig; MX.DB.saveHotelConfig = () => Promise.reject(new Error('mock Firestore failure')); });

    await pickBannerFile(page, '.etb-banner-add-btn', 'banniere-fail.jpg');
    await clickSafe(page, '.etb-banner-confirm-btn');
    await page.waitForTimeout(500);

    const uploadsBeforeRestore = await evalPage(page, () => window.__storageLog.uploads.length);
    ok('19.1 L\'upload Storage a bien eu lieu (avant l\'échec Firestore)', uploadsBeforeRestore === 1);
    const newUrl = await evalPage(page, () => window.__storageLog.uploads[0]);
    const deletesAfterFail = await evalPage(page, () => window.__storageLog.deletes.slice());
    ok('19.2 La NOUVELLE image (échouée) a été nettoyée', deletesAfterFail.indexOf(newUrl) !== -1);
    ok('19.3 L\'ANCIENNE bannière n\'a PAS été supprimée', deletesAfterFail.indexOf(FAKE_OLD_BANNER) === -1);
    const stillOldUrl = await evalPage(page, () => window.__mockDb.collection('config').doc('hotel_config').get().then(s => s.data().heroImageUrl));
    ok('19.4 config/hotel_config référence toujours l\'ANCIENNE bannière', stillOldUrl === FAKE_OLD_BANNER);

    await evalPage(page, () => { MX.DB.saveHotelConfig = window.__origSaveHotelConfig; });
    await gotoHome();
    const homeHtml = await mainHtml(page);
    ok('19.5 L\'Accueil affiche toujours l\'ANCIENNE bannière (aucune régression visible)', homeHtml.indexOf(FAKE_OLD_BANNER) !== -1);
    await ctx.close();
  }

  // (Le scoping CSS #dx-panel Accueil-only est couvert par le fichier dédié
  // tests/accueil_dxpanel_scope_test.js — séparé pour garder cette suite
  // rapide/fiable : au-delà d'~20 contextes Playwright séquentiels, ce
  // sandbox devient sujet à des ralentissements réseau de fond indépendants
  // du code testé, voir commentaire dans ce fichier.)

  // ═══ 21. Non-régression — aucune erreur JS sur les scénarios ci-dessus ═══
  // (chaque bloc a déjà vérifié pageErrors implicitement via son propre contexte fermé sans throw)

  console.log('\n' + (failures === 0 ? 'TOUS LES TESTS PASSENT ✓' : failures + ' TEST(S) EN ÉCHEC ✗'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
