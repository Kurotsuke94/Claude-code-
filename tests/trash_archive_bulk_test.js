// Tests pour les actions en masse de "Corbeille & Archives"
// (assets/js/pages/corbeille.js + assets/js/trash.js — restoreMany/
// archiveMany/purgeMany). Couvre la sélection multiple (case à cocher par
// élément + "Tout sélectionner" tri-état), les 3 actions groupées avec
// confirmation, la non-régression des actions individuelles existantes, les
// permissions (identiques aux actions individuelles), un cas d'erreur
// Firestore, et le responsive de la barre d'actions à 5 largeurs.
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = 'http://127.0.0.1:8811';
const MOCK_FB = path.join(__dirname, 'mock-firebase.js');
const SEED    = path.join(__dirname, 'gst_seed.js');
const SUPER_ADMIN_EMAIL = 'keyzeur94460@hotmail.fr';

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
  await page.evaluate((email) => {
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = 'x';
  }, email);
  await page.evaluate(() => { MX.Auth.login({ preventDefault() {} }); });
  await page.waitForTimeout(300);
}
function evalPage(page, fn, ...args) { return page.evaluate(fn, ...args); }
async function dismissOverlay(page) { await page.evaluate(() => { const o = document.getElementById('ver-modal-overlay'); if (o) o.remove(); }); }
async function clickSafe(page, selector) {
  // Clic exécuté directement dans la page (dispatchEvent d'un vrai clic sur
  // le premier élément trouvé) plutôt que via l'automatisation souris de
  // Playwright — contourne à la fois l'overlay de nouveautés parfois
  // superposé (#ver-modal-overlay, sans rapport avec cette fonctionnalité)
  // et les faux positifs de géométrie ("outside of viewport") sur les
  // modales ancrées en bas d'écran (align-items:flex-end), tout en
  // exerçant réellement le handler onclick de l'élément.
  await dismissOverlay(page);
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error('clickSafe: aucun élément trouvé pour le sélecteur ' + selector);
}

async function openCorbeille(page) {
  await page.evaluate(() => { MX.showPage('corbeille'); });
  await page.waitForTimeout(200);
}
async function seedTrashed(page, col, id, name) {
  await page.evaluate((a) => {
    const FV = firebase.firestore.FieldValue;
    return window.__mockDb.collection(a.col).doc(a.id).set({
      inTrash: true, trashedAt: FV.serverTimestamp(), trashedBy: 'Test', trashReason: '',
      _trashName: a.name, _trashType: 'Test', name: a.name,
    });
  }, { col, id, name });
}
async function seedArchived(page, col, id, name) {
  await page.evaluate((a) => {
    const FV = firebase.firestore.FieldValue;
    return window.__mockDb.collection(a.col).doc(a.id).set({
      archived: true, archivedAt: FV.serverTimestamp(), archivedBy: 'Test', name: a.name,
    });
  }, { col, id, name });
}
async function mainHtml(page) { return page.evaluate(() => document.getElementById('main-content').innerHTML); }
async function itemCount(page) { return page.evaluate(() => document.querySelectorAll('.corb-item').length); }
async function checkItem(page, index) {
  await clickSafe(page, '.corb-item:nth-of-type(' + (index + 1) + ') .corb-check--item input');
}
// La liste est triée par date (la plus récente en premier) — pour les tests
// qui doivent vérifier PRÉCISÉMENT quel élément a été traité, sélectionner
// par nom affiché est plus fiable qu'un index positionnel.
async function checkItemByName(page, name) {
  const clicked = await page.evaluate((n) => {
    const items = Array.from(document.querySelectorAll('.corb-item'));
    const item = items.find(el => el.querySelector('.corb-item-name') && el.querySelector('.corb-item-name').textContent.trim() === n);
    if (!item) return false;
    item.querySelector('.corb-check--item input').click();
    return true;
  }, name);
  if (!clicked) throw new Error('checkItemByName: élément "' + name + '" introuvable');
}
async function clickSelectAll(page) { await clickSafe(page, '#corb-select-all'); }
async function rawDoc(page, col, id) {
  return page.evaluate((a) => window.__mockDb.collection(a.col).doc(a.id).get().then(s => s.exists ? s.data() : null), { col, id });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const routeBlock = ctx => { ctx.route('**://*.googleapis.com/**', r => r.abort()); ctx.route('**://*.gstatic.com/**', r => r.abort()); };
  const newCtx = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    await routeBlock(ctx);
    const page = await ctx.newPage();
    await bootPage(page);
    return { ctx, page };
  };

  // ═══ 1. Aucun élément sélectionné ═══
  {
    console.log('\n--- 1. Aucun élément sélectionné ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    const html = await mainHtml(page);
    ok('1.1 Bulk bar affiche "Tout sélectionner" sans sélection', /Tout sélectionner/.test(html));
    ok('1.2 Aucun bouton d\'action de masse visible sans sélection', !/corb-bulkbar-actions/.test(html));
    await ctx.close();
  }

  // ═══ 2. Sélection d'un élément ═══
  {
    console.log('\n--- 2. Sélection d\'un élément ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItem(page, 0);
    const html = await mainHtml(page);
    ok('2.1 Compteur affiche "1 sélectionné"', /1 sélectionné(?!s)/.test(html));
    ok('2.2 Barre d\'actions de masse visible', /corb-bulkbar-actions/.test(html));
    await ctx.close();
  }

  // ═══ 3. Sélection de plusieurs éléments ═══
  {
    console.log('\n--- 3. Sélection de plusieurs éléments ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItem(page, 0);
    await checkItem(page, 1);
    const html = await mainHtml(page);
    ok('3.1 Compteur affiche "2 sélectionnés"', /2 sélectionnés/.test(html));
    await ctx.close();
  }

  // ═══ 4-5. Tout sélectionner / désélectionner tout ═══
  {
    console.log('\n--- 4-5. Tout sélectionner / désélectionner tout ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await clickSelectAll(page);
    let html = await mainHtml(page);
    ok('4.1 "Tout sélectionner" sélectionne les 3 éléments affichés', /3 sélectionnés/.test(html));
    const checkedCount = await page.evaluate(() => document.querySelectorAll('.corb-item .corb-check--item input:checked').length);
    ok('4.2 Les 3 cases à cocher individuelles sont bien cochées', checkedCount === 3);
    await clickSelectAll(page);
    html = await mainHtml(page);
    ok('5.1 Un second clic désélectionne tout', /Tout sélectionner/.test(html) && !/sélectionnés</.test(html));
    await ctx.close();
  }

  // ═══ 6. Sélection partielle (case principale en état indéterminé) ═══
  {
    console.log('\n--- 6. Sélection partielle ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItem(page, 0);
    const state = await page.evaluate(() => {
      const el = document.getElementById('corb-select-all');
      return { checked: el.checked, indeterminate: el.indeterminate };
    });
    ok('6.1 Case principale en état indéterminé (sélection partielle)', state.indeterminate === true && state.checked === false);
    await ctx.close();
  }

  // ═══ 7. Restauration multiple ═══
  {
    console.log('\n--- 7. Restauration multiple ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItemByName(page, 'Mission A');
    await checkItemByName(page, 'Mission B');
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--restore');
    await page.waitForTimeout(150);
    const modalTitle = await page.evaluate(() => document.getElementById('m-title').textContent);
    ok('7.1 Confirmation "Restaurer 2 éléments ?"', /Restaurer 2 éléments/.test(modalTitle));
    await clickSafe(page, 'button.modal-btn.confirm');
    await page.waitForTimeout(300);
    const m1 = await rawDoc(page, 'missions', 'm1');
    const m2 = await rawDoc(page, 'missions', 'm2');
    const m3 = await rawDoc(page, 'missions', 'm3');
    ok('7.2 Mission A restaurée (inTrash=false)', m1.inTrash === false);
    ok('7.3 Mission B restaurée (inTrash=false)', m2.inTrash === false);
    ok('7.4 Mission C (non sélectionnée) reste dans la corbeille', m3.inTrash === true);
    await ctx.close();
  }

  // ═══ 8. Archivage multiple ═══
  {
    console.log('\n--- 8. Archivage multiple ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await clickSelectAll(page);
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--archive');
    await page.waitForTimeout(150);
    const modalTitle = await page.evaluate(() => document.getElementById('m-title').textContent);
    ok('8.1 Confirmation "Archiver 2 éléments ?"', /Archiver 2 éléments/.test(modalTitle));
    await clickSafe(page, 'button.modal-btn.confirm');
    await page.waitForTimeout(300);
    const m1 = await rawDoc(page, 'missions', 'm1');
    const m2 = await rawDoc(page, 'missions', 'm2');
    ok('8.2 Mission A archivée', m1.archived === true && m1.inTrash === false);
    ok('8.3 Mission B archivée', m2.archived === true && m2.inTrash === false);
    await ctx.close();
  }

  // ═══ 9-10-11. Suppression multiple + confirmation obligatoire ═══
  {
    console.log('\n--- 9-11. Suppression multiple + confirmation ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await clickSelectAll(page);
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--purge');
    await page.waitForTimeout(150);
    const modalHtml = await page.evaluate(() => document.getElementById('m-title').textContent + '|' + document.getElementById('m-sub').textContent);
    ok('9.1 Confirmation "Supprimer définitivement 2 éléments ?"', /Supprimer définitivement 2 éléments/.test(modalHtml));
    ok('10.1 Message "Cette action est irréversible."', /irréversible/.test(modalHtml));
    let m1 = await rawDoc(page, 'missions', 'm1');
    ok('10.2 Rien n\'est supprimé avant confirmation', m1 !== null);
    await clickSafe(page, 'button.modal-btn.danger');
    await page.waitForTimeout(300);
    m1 = await rawDoc(page, 'missions', 'm1');
    const m2 = await rawDoc(page, 'missions', 'm2');
    ok('9.2 Mission A supprimée définitivement', m1 === null);
    ok('9.3 Mission B supprimée définitivement', m2 === null);
    await ctx.close();
  }
  {
    console.log('\n--- 11. Annulation de suppression ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItem(page, 0);
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--purge');
    await page.waitForTimeout(150);
    await clickSafe(page, 'button.modal-btn.cancel');
    await page.waitForTimeout(200);
    const m1 = await rawDoc(page, 'missions', 'm1');
    ok('11.1 Annulation : rien n\'est supprimé', m1 !== null && m1.inTrash === true);
    await ctx.close();
  }

  // ═══ 12. Annulation d'archivage ═══
  {
    console.log('\n--- 12. Annulation d\'archivage ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItem(page, 0);
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--archive');
    await page.waitForTimeout(150);
    await clickSafe(page, 'button.modal-btn.cancel');
    await page.waitForTimeout(200);
    const m1 = await rawDoc(page, 'missions', 'm1');
    ok('12.1 Annulation : rien n\'est archivé', m1.archived !== true && m1.inTrash === true);
    await ctx.close();
  }

  // ═══ 13-14. Sélection vidée + éléments retirés de la vue après action ═══
  {
    console.log('\n--- 13-14. Sélection vidée / éléments retirés après action ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItem(page, 0);
    await checkItem(page, 1);
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--archive');
    await page.waitForTimeout(150);
    await clickSafe(page, 'button.modal-btn.confirm');
    await page.waitForTimeout(400);
    const html = await mainHtml(page);
    const n = await itemCount(page);
    ok('13.1 Sélection vidée après action (retour à "Tout sélectionner")', /Tout sélectionner/.test(html));
    ok('14.1 Les 2 éléments archivés ont disparu de la vue Corbeille', n === 1);
    await ctx.close();
  }

  // ═══ 15. Aucune donnée non sélectionnée modifiée ═══
  {
    console.log('\n--- 15. Aucune donnée non sélectionnée modifiée ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await seedTrashed(page, 'missions', 'm4', 'Mission D');
    await seedTrashed(page, 'missions', 'm5', 'Mission E');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await checkItemByName(page, 'Mission A');
    await checkItemByName(page, 'Mission B');
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--archive');
    await page.waitForTimeout(150);
    await clickSafe(page, 'button.modal-btn.confirm');
    await page.waitForTimeout(300);
    const untouched = await Promise.all(['m3', 'm4', 'm5'].map(id => rawDoc(page, 'missions', id)));
    ok('15.1 Les 3 éléments non sélectionnés restent strictement dans la corbeille (inTrash=true, non archivés)',
      untouched.every(d => d.inTrash === true && !d.archived));
    await ctx.close();
  }

  // ═══ 16. Permissions identiques aux actions individuelles ═══
  {
    console.log('\n--- 16. Permissions (responsable, jamais admin) ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await pinLogin(page, 'sophie', '9999'); // responsable — canSeeAll() true, isAdmin() false
    await openCorbeille(page);
    let html = await mainHtml(page);
    ok('16.1 Bouton de suppression individuelle absent pour une responsable', !/corb-btn--purge"/.test(html));
    await clickSelectAll(page);
    html = await mainHtml(page);
    ok('16.2 Bouton de suppression en masse absent pour une responsable', !html.includes('_corbBulkPurge'));
    ok('16.3 Boutons Restaurer/Archiver en masse restent disponibles (pas de permission individuelle requise)', html.includes('_corbBulkRestore') && html.includes('_corbBulkArchive'));
    // Appel direct (contournement UI) — doit rester un no-op côté client.
    await page.evaluate(() => { window.MX._corbBulkPurge(); });
    await page.waitForTimeout(150);
    const modalOpen = await page.evaluate(() => document.getElementById('modal-bg').classList.contains('show'));
    ok('16.4 Un appel direct à _corbBulkPurge() par une responsable n\'ouvre aucune confirmation', !modalOpen);
    const m1 = await rawDoc(page, 'missions', 'm1');
    ok('16.5 Aucune suppression n\'a eu lieu', m1 !== null);
    await ctx.close();
  }

  // ═══ Cas d'erreur Firestore ═══
  {
    console.log('\n--- Cas d\'erreur Firestore (batch refusé) ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'missions', 'm2', 'Mission B');
    await seedTrashed(page, 'missions', 'm3', 'Mission C');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await clickSelectAll(page);
    await page.evaluate(() => { window.__mockDenyColl = { missions: true }; });
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--purge');
    await page.waitForTimeout(150);
    await clickSafe(page, 'button.modal-btn.danger');
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__mockDenyColl = {}; });
    const m1 = await rawDoc(page, 'missions', 'm1');
    const m2 = await rawDoc(page, 'missions', 'm2');
    const m3 = await rawDoc(page, 'missions', 'm3');
    ok('E.1 Aucun élément réellement supprimé quand Firestore refuse le batch', m1 !== null && m2 !== null && m3 !== null);
    ok('E.2 Les 3 éléments restent visibles dans la corbeille après l\'échec', await itemCount(page) === 3);
    const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
    ok('E.3 Le résultat ne prétend jamais un succès complet après un échec (pas "3 éléments supprimés")', !/^3 éléments supprimés/.test(toastText));
    ok('E.4 Le message reflète bien 0 succès / 3 échecs, un résultat clair', /0 supprimé/.test(toastText) && /3 échec/.test(toastText));
    await ctx.close();
  }

  // ═══ Non-régression : actions individuelles toujours présentes ═══
  {
    console.log('\n--- Compatibilité : actions individuelles conservées ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    let html = await mainHtml(page);
    ok('C.1 Bouton "Restaurer" individuel toujours présent', /_corbRestore/.test(html));
    ok('C.2 Bouton "Archiver" individuel toujours présent', /_corbArchive/.test(html));
    ok('C.3 Bouton de suppression individuel toujours présent (admin)', /_corbPurge/.test(html));
    // L'action individuelle fonctionne toujours indépendamment de la sélection.
    await page.evaluate(() => { window.MX._corbArchive('missions', 'm1'); });
    await page.waitForTimeout(300);
    const m1 = await rawDoc(page, 'missions', 'm1');
    ok('C.4 L\'archivage individuel fonctionne toujours (non cassé par la sélection multiple)', m1.archived === true);
    await ctx.close();
  }

  // ═══ Onglet Archives : pas de bouton "Archiver" en masse ═══
  {
    console.log('\n--- Onglet Archives : actions dépendantes de l\'état ---');
    const { ctx, page } = await newCtx();
    await seedArchived(page, 'missions', 'm1', 'Mission A');
    await seedArchived(page, 'missions', 'm2', 'Mission B');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await page.evaluate(() => { MX._corbTab('archives'); });
    await page.waitForTimeout(150);
    await clickSelectAll(page);
    const html = await mainHtml(page);
    ok('A.1 Bouton "Archiver" en masse absent dans l\'onglet Archives', !html.includes('_corbBulkArchive'));
    ok('A.2 Bouton "Restaurer" en masse présent dans l\'onglet Archives', html.includes('_corbBulkRestore'));
    await clickSafe(page, '.corb-bulkbar-actions .corb-btn--restore');
    await page.waitForTimeout(150);
    await clickSafe(page, 'button.modal-btn.confirm');
    await page.waitForTimeout(300);
    const m1 = await rawDoc(page, 'missions', 'm1');
    ok('A.3 Restauration multiple depuis Archives fonctionne (archived retiré)', m1.archived !== true);
    await ctx.close();
  }

  // ═══ Changement d'onglet/filtre vide la sélection ═══
  {
    console.log('\n--- Sélection nettoyée après changement d\'onglet/filtre ---');
    const { ctx, page } = await newCtx();
    await seedTrashed(page, 'missions', 'm1', 'Mission A');
    await seedTrashed(page, 'interventions', 'i1', 'Intervention A');
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await clickSelectAll(page);
    let html = await mainHtml(page);
    ok('S.1 Sélection active avant changement de filtre', /2 sélectionnés/.test(html));
    await page.evaluate(() => { MX._corbFilter('missions'); });
    await page.waitForTimeout(150);
    html = await mainHtml(page);
    ok('S.2 Sélection nettoyée après changement de filtre', /Tout sélectionner/.test(html));
    await ctx.close();
  }

  // ═══ Responsive (375/390/430 mobile, 1280/1920 desktop) ═══
  {
    console.log('\n--- Responsive ---');
    const { ctx, page } = await newCtx({ width: 375, height: 800 });
    for (let i = 1; i <= 6; i++) await seedTrashed(page, 'missions', 'm' + i, 'Mission ' + i);
    await adminLogin(page, SUPER_ADMIN_EMAIL);
    await openCorbeille(page);
    await clickSelectAll(page);

    const widths = [375, 390, 430, 1280, 1920];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        checkHeights: Array.from(document.querySelectorAll('.corb-check')).slice(0, 3).map(el => el.getBoundingClientRect().height),
        checkWidths: Array.from(document.querySelectorAll('.corb-check')).slice(0, 3).map(el => el.getBoundingClientRect().width),
        btnCount: document.querySelectorAll('.corb-bulkbar-actions .corb-btn').length,
      }));
      ok(w + 'px — aucun scroll horizontal global de la page', info.scrollW <= info.clientW + 2);
      ok(w + 'px — cases à cocher avec cible tactile ≥ 44px (hauteur)', info.checkHeights.every(h => h >= 44));
      ok(w + 'px — boutons de la barre d\'actions présents', info.btnCount >= 2);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests d\'actions en masse Corbeille & Archives passent.');
  process.exit(failures ? 1 : 0);
})();
