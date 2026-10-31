// Tests de sécurité PIN — correctifs post-audit (atomicité du
// verrouillage, protection complémentaire contre une attaque distribuée
// sur plusieurs comptes, suppression de la lecture publique des hashes).
// Exécutés contre un véritable émulateur Firestore + Auth (jamais un mock
// navigateur) — voir tests/mock-firebase.js pour les limites explicitement
// documentées de cette approche.
//
//   npx firebase emulators:exec --only firestore,auth --project maintix-rules-test \
//     "node tests/pin_security_test.js"
//
// ⚠ AVERTISSEMENT (demandé explicitement) : un test de concurrence contre
// un émulateur LOCAL, même réel et non un mock, prouve que LE CODE est
// atomique sous une charge concurrente contrôlée de ce laboratoire — PAS
// qu'aucune attaque n'est possible en production. La production ajoute une
// latence réseau réelle, une volumétrie bien supérieure, d'éventuels
// autres goulets d'étranglement (quotas Cloud Functions, limites du SDK
// client, etc.), et l'absence de Firebase App Check (non mis en place ici,
// voir functions/index.js et le rapport joint) laisse un attaquant capable
// de régénérer une session anonyme contourner la limitation par appelant.
// Ce fichier ne prétend prouver que ce qu'il teste réellement : l'atomicité
// du compteur, la portée du verrouillage par compte, la portée et
// l'expiration de la pause par appelant, et l'absence de fuite
// d'information dans les erreurs de verifyPin.
//
// Couvre les 5 scénarios demandés :
//   A/B : users_private illisible par tout client ; écriture correctement
//         restreinte (self-service / Admin / Responsable-sur-technicien /
//         refus cross-utilisateur / refus Responsable-sur-Responsable —
//         règle métier "Sécurité des PIN" : un Responsable peut
//         réinitialiser le PIN de n'importe quel technicien mais jamais
//         celui d'un AUTRE Responsable, seul l'Admin le peut)
//   C.1 : 12 tentatives simultanées pour un même compte (atomicité)
//   C.2 : tentatives distribuées sur plusieurs comptes depuis le même
//         appelant (protection complémentaire, jamais de verrou permanent,
//         jamais de DoS sur un AUTRE appelant)
//   C.3 : un PIN correct reste refusé tant qu'un verrou est actif
//   C.4 : un PIN correct réussit après expiration naturelle du verrou
//   C.5 : compte inconnu vs PIN faux — erreurs strictement indistinguables
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

const RULES_PATH = path.join(__dirname, '..', 'firestore.rules.draft-claims-migration');
const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }
async function check(label, fn) {
  try { await fn(); ok(label, true); }
  catch (e) { ok(label, false); console.error('   → ' + e.message.split('\n')[0]); }
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // PARTIE A/B — règles users_private (émulateur de règles réel)
  // ════════════════════════════════════════════════════════════════════
  const testEnv = await initializeTestEnvironment({
    projectId: 'maintix-rules-test',
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8090 },
  });

  const adminCtx = testEnv.authenticatedContext('admin-uid', {
    email: 'admin@maintix.local',
    firebase: { sign_in_provider: 'password' },
  });
  const responsable = testEnv.authenticatedContext('pinuser_resp1', {
    firebase: { sign_in_provider: 'custom' }, role: 'responsable', userId: 'resp1',
  });
  // Second Responsable — nécessaire pour prouver la règle métier "un
  // Responsable ne peut jamais réinitialiser le PIN d'un AUTRE Responsable"
  // (section A.2 du rapport ; ex. concret demandé : Kevin ne peut pas
  // changer le PIN d'Alban, ni l'inverse — resp1/resp2 ici jouent ce rôle
  // générique, la règle elle-même n'est jamais nommée par utilisateur).
  const responsable2 = testEnv.authenticatedContext('pinuser_resp2', {
    firebase: { sign_in_provider: 'custom' }, role: 'responsable', userId: 'resp2',
  });
  const technicien = testEnv.authenticatedContext('pinuser_tech1', {
    firebase: { sign_in_provider: 'custom' }, role: 'technicien', userId: 'tech1',
  });
  // tech3 : compte "pas encore migré" — users/{id} existe, users_private
  // n'existe PAS encore (voir seed ci-dessous). Simule exactement le cas
  // identifié par l'audit : un utilisateur dont le document privé n'a
  // jamais été créé (migration pas encore passée, ou échouée pour lui).
  const technicien3 = testEnv.authenticatedContext('pinuser_tech3', {
    firebase: { sign_in_provider: 'custom' }, role: 'technicien', userId: 'tech3',
  });
  // Jeton forgé : sign_in_provider incohérent avec un claim userId quand
  // même présent — scénario impossible à obtenir légitimement (seul
  // verifyPin() pose ce claim, toujours avec sign_in_provider:'custom'),
  // simulé ici uniquement via la capacité de test authenticatedContext
  // pour prouver que la règle vérifie bien LES DEUX conditions ensemble.
  const forgedAnonyme = testEnv.authenticatedContext('forged-uid', {
    firebase: { sign_in_provider: 'anonymous' }, userId: 'tech3',
  });
  const unauth = testEnv.unauthenticatedContext();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('tech1').set({ name: 'Tech Un', role: 'technicien' });
    await db.collection('users').doc('tech2').set({ name: 'Tech Deux', role: 'technicien' });
    await db.collection('users').doc('tech3').set({ name: 'Tech Trois', role: 'technicien' });
    await db.collection('users_private').doc('tech1').set({ pin: 'hash1' });
    await db.collection('users_private').doc('tech2').set({ pin: 'hash2' });
    // Aucun users_private/tech3 créé ici — c'est précisément le cas testé.
    // resp1/resp2 : deux Responsables distincts, nécessaires pour la règle
    // "un Responsable ne peut jamais réinitialiser le PIN d'un AUTRE
    // Responsable" — _isResponsable(userId) (firestore.rules.draft-
    // claims-migration) lit CE document users/{id}.role pour trancher.
    await db.collection('users').doc('resp1').set({ name: 'Resp Un', role: 'responsable' });
    await db.collection('users').doc('resp2').set({ name: 'Resp Deux', role: 'responsable' });
    await db.collection('users_private').doc('resp1').set({ pin: 'hashresp1' });
    await db.collection('users_private').doc('resp2').set({ pin: 'hashresp2' });
  });

  console.log('\n--- A. users_private : lecture bloquée pour TOUT client ---');
  await check('A.1 Admin (client Firestore) NE PEUT PAS lire users_private', () =>
    assertFails(adminCtx.firestore().collection('users_private').doc('tech1').get()));
  await check('A.2 Responsable NE PEUT PAS lire users_private', () =>
    assertFails(responsable.firestore().collection('users_private').doc('tech1').get()));
  await check('A.3 Technicien NE PEUT PAS lire son PROPRE users_private', () =>
    assertFails(technicien.firestore().collection('users_private').doc('tech1').get()));
  await check('A.4 Utilisateur non authentifié NE PEUT PAS lire users_private', () =>
    assertFails(unauth.firestore().collection('users_private').doc('tech1').get()));

  console.log('\n--- B. users_private : écriture correctement restreinte ---');
  await check('B.1 Technicien PEUT mettre à jour SON PROPRE pin (self-service)', () =>
    assertSucceeds(technicien.firestore().collection('users_private').doc('tech1').update({ pin: 'nouveauhash' })));
  await check('B.2 Technicien NE PEUT PAS mettre à jour le pin d\'un AUTRE utilisateur', () =>
    assertFails(technicien.firestore().collection('users_private').doc('tech2').update({ pin: 'vole' })));
  await check('B.3 Technicien NE PEUT PAS glisser un autre champ dans son propre users_private', () =>
    assertFails(technicien.firestore().collection('users_private').doc('tech1').update({ pin: 'x', role: 'responsable' })));
  // CORRECTION (demande explicite "Sécurité des PIN") : B.4 affirmait à
  // tort qu'un Responsable ne peut réinitialiser AUCUN autre PIN — faux,
  // et incohérent avec l'UI RÉELLE : admin.js:renderUsers() (onglet
  // Utilisateurs, accessible à canSeeAll() donc au Responsable, pas
  // réservé à isAdmin()) a un champ PIN éditable par utilisateur, relié à
  // saveUsers() → MX.DB.updateUserPin(u.id, hash) pour N'IMPORTE QUEL
  // utilisateur de la liste. La règle métier réelle (section A.2) est :
  // un Responsable PEUT réinitialiser le PIN d'un TECHNICIEN, mais JAMAIS
  // celui d'un AUTRE RESPONSABLE (ni celui de l'Admin).
  await check('B.4 Responsable PEUT réinitialiser le pin d\'un TECHNICIEN (gestion d\'équipe, déjà exposée par admin.js:saveUsers)', () =>
    assertSucceeds(responsable.firestore().collection('users_private').doc('tech1').update({ pin: 'resp-reinit-tech' })));
  await check('B.4b Responsable NE PEUT PAS réinitialiser le pin d\'un AUTRE RESPONSABLE (ex. Kevin ne peut pas changer le PIN d\'Alban)', () =>
    assertFails(responsable.firestore().collection('users_private').doc('resp2').update({ pin: 'resp1-essaie-resp2' })));
  await check('B.4c Symétrique de B.4b : l\'AUTRE Responsable ne peut pas non plus réinitialiser le premier (Alban ne peut pas changer le PIN de Kevin)', () =>
    assertFails(responsable2.firestore().collection('users_private').doc('resp1').update({ pin: 'resp2-essaie-resp1' })));
  await check('B.4d Ce même second Responsable PEUT réinitialiser le pin d\'un technicien (non-régression, la restriction ne vise QUE les autres Responsables)', () =>
    assertSucceeds(responsable2.firestore().collection('users_private').doc('tech2').update({ pin: 'resp2-reinit-tech2' })));
  await check('B.4e Responsable PEUT mettre à jour SON PROPRE pin (self-service, symétrique au technicien — B.1)', () =>
    assertSucceeds(responsable.firestore().collection('users_private').doc('resp1').update({ pin: 'resp1-change-soi-meme' })));
  await check('B.4f Responsable NE PEUT PAS glisser un autre champ en réinitialisant le pin d\'un technicien (mêmes garanties que le self-service)', () =>
    assertFails(responsable.firestore().collection('users_private').doc('tech2').update({ pin: 'x', role: 'responsable' })));
  await check('B.5 Admin PEUT réinitialiser le pin de n\'importe quel technicien', () =>
    assertSucceeds(adminCtx.firestore().collection('users_private').doc('tech1').update({ pin: 'admin-reset' })));
  await check('B.5b Admin PEUT AUSSI réinitialiser le pin d\'un Responsable (seul rôle à le pouvoir)', () =>
    assertSucceeds(adminCtx.firestore().collection('users_private').doc('resp2').update({ pin: 'admin-reset-resp' })));
  await check('B.6 Utilisateur non authentifié NE PEUT RIEN écrire dans users_private', () =>
    assertFails(unauth.firestore().collection('users_private').doc('tech1').update({ pin: 'intrus' })));

  console.log('\n--- D. users_private : création self-service quand le document est ABSENT ---');
  await check('D.1 Technicien PEUT créer SON PROPRE users_private (document absent, 1ère connexion/PIN pas encore migré)', () =>
    assertSucceeds(technicien3.firestore().collection('users_private').doc('tech3').set({ pin: 'premierhash' })));
  await check('D.2 Une fois créé, le même technicien PEUT le mettre à jour normalement (non-régression avec B.1)', () =>
    assertSucceeds(technicien3.firestore().collection('users_private').doc('tech3').update({ pin: 'secondhash' })));

  // Un nouveau compte "tech4" (document absent) pour tester les refus sans
  // retoucher tech3 (déjà créé ci-dessus par D.1/D.2).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc('tech4').set({ name: 'Tech Quatre', role: 'technicien' });
  });
  await check('D.3 Un AUTRE utilisateur (tech1) NE PEUT PAS créer le users_private de tech4 (document absent, refus cross-utilisateur)', () =>
    assertFails(technicien.firestore().collection('users_private').doc('tech4').set({ pin: 'vole-creation' })));
  await check('D.4 Impossible de glisser un champ supplémentaire dès la CRÉATION (document absent, et pour un AUTRE utilisateur)', () =>
    assertFails(technicien.firestore().collection('users_private').doc('tech4').set({ pin: 'x', role: 'responsable' })));
  // Isole précisément le refus "champ supplémentaire" pour SOI-MÊME (sans
  // le facteur confondant "autre utilisateur" du test D.4 ci-dessus).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc('tech5').set({ name: 'Tech Cinq', role: 'technicien' });
  });
  const technicien5 = testEnv.authenticatedContext('pinuser_tech5', {
    firebase: { sign_in_provider: 'custom' }, role: 'technicien', userId: 'tech5',
  });
  await check('D.5 Impossible de glisser un champ supplémentaire dès la création de SON PROPRE document (document absent, même utilisateur)', () =>
    assertFails(technicien5.firestore().collection('users_private').doc('tech5').set({ pin: 'y', extra: 'champ-interdit' })));
  await check('D.6 Un utilisateur non authentifié NE PEUT PAS créer un users_private (document absent)', () =>
    assertFails(unauth.firestore().collection('users_private').doc('tech4').set({ pin: 'intrus-creation' })));
  await check('D.7 Un jeton forgé (sign_in_provider incohérent avec le claim userId) NE PEUT PAS créer users_private (document absent)', () =>
    assertFails(forgedAnonyme.firestore().collection('users_private').doc('tech3').set({ pin: 'forge-creation' })));
  await check('D.8 Admin PEUT créer users_private pour N\'IMPORTE QUEL utilisateur (document absent) — non-régression', () =>
    assertSucceeds(adminCtx.firestore().collection('users_private').doc('tech4').set({ pin: 'admin-cree' })));

  // D.9/D.10 : même règle métier Responsable qu'en section B (update),
  // mais côté CRÉATION (document encore absent) — branche de code
  // distincte dans la règle (allow create vs allow update), à vérifier
  // séparément.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc('tech6').set({ name: 'Tech Six', role: 'technicien' });
    await ctx.firestore().collection('users').doc('resp3').set({ name: 'Resp Trois', role: 'responsable' });
  });
  await check('D.9 Responsable PEUT créer le users_private d\'un TECHNICIEN dont le document est absent', () =>
    assertSucceeds(responsable.firestore().collection('users_private').doc('tech6').set({ pin: 'resp-cree-tech6' })));
  await check('D.10 Responsable NE PEUT PAS créer le users_private d\'un AUTRE RESPONSABLE dont le document est absent', () =>
    assertFails(responsable.firestore().collection('users_private').doc('resp3').set({ pin: 'resp1-essaie-resp3' })));

  await testEnv.cleanup();

  // ════════════════════════════════════════════════════════════════════
  // PARTIE C — verifyPin (Admin SDK réel, functions/index.js directement)
  // ════════════════════════════════════════════════════════════════════
  process.chdir(FUNCTIONS_DIR);
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8090';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.GCLOUD_PROJECT = 'maintix-rules-test';

  const adminSdk = require(path.join(FUNCTIONS_DIR, 'node_modules', 'firebase-admin'));
  // functions/index.js appelle admin.initializeApp() lui-même en haut du
  // fichier — ne jamais le faire ici avant ce require (sinon
  // "app/duplicate-app", déjà rencontré lors d'une session précédente).
  const fns = require(path.join(FUNCTIONS_DIR, 'index.js'));
  const fdb = adminSdk.firestore();

  async function seedUser(userId, role, pin) {
    await fdb.collection('users').doc(userId).set({ name: userId, role });
    await fdb.collection('users_private').doc(userId).set({ pin });
    await fdb.collection('pin_attempts').doc(userId).delete().catch(() => {});
  }
  function call(userId, pin, callerUid) {
    return fns.verifyPin.run({ data: { userId, pin }, auth: callerUid ? { uid: callerUid } : null });
  }
  async function callExpectError(userId, pin, callerUid) {
    try { await call(userId, pin, callerUid); return null; }
    catch (e) { return { code: e.code, message: e.message }; }
  }

  console.log('\n--- C.1. 12 tentatives SIMULTANÉES pour le MÊME compte (atomicité) ---');
  await seedUser('race1', 'technicien', '9999');
  {
    const N = 12;
    const calls = [];
    for (let i = 0; i < N; i++) calls.push(callExpectError('race1', '0000', 'solo-caller-' + i));
    const results = await Promise.all(calls);
    const denied = results.filter((r) => r && r.code === 'permission-denied').length;
    const locked = results.filter((r) => r && r.code === 'resource-exhausted').length;
    const finalSnap = await fdb.collection('pin_attempts').doc('race1').get();
    const finalData = finalSnap.exists ? finalSnap.data() : null;
    console.log('   ' + N + ' appels envoyés en parallèle -> ' + denied + ' "permission-denied", ' + locked + ' "resource-exhausted"');
    console.log('   Document final : ' + JSON.stringify(finalData));
    ok('C.1.1 Exactement 5 tentatives comptées avant verrouillage (PIN_MAX_ATTEMPTS), jamais plus (preuve d\'atomicité)', denied === 5);
    ok('C.1.2 Les 7 appels restants voient le verrou déjà posé (aucun "trou" dans la sérialisation)', locked === 7);
    ok('C.1.3 Le document final reflète un verrou réellement posé (lockoutLevel=1, lockedUntilMs défini, count remis à 0)',
      !!finalData && finalData.lockoutLevel === 1 && typeof finalData.lockedUntilMs === 'number' && finalData.count === 0);
  }

  console.log('\n--- C.2. Tentatives DISTRIBUÉES sur plusieurs comptes depuis le MÊME appelant ---');
  {
    const CALLER = 'attacker-caller-x';
    const TOTAL_TARGETS = 25; // > PIN_CALLER_MAX_FAILURES (20)
    const targets = [];
    for (let i = 0; i < TOTAL_TARGETS; i++) {
      const id = 'dist' + i;
      await seedUser(id, 'technicien', '1234');
      targets.push(id);
    }
    const calls = targets.map((id) => callExpectError(id, '0000', CALLER));
    const results = await Promise.all(calls);
    const denied = results.filter((r) => r && r.code === 'permission-denied').length;
    const cooldown = results.filter((r) => r && r.code === 'resource-exhausted').length;
    console.log('   ' + TOTAL_TARGETS + ' comptes distincts attaqués par le même appelant -> ' + denied + ' comptées, ' + cooldown + ' en pause appelant');
    ok('C.2.1 Exactement 20 tentatives comptées avant la pause appelant (PIN_CALLER_MAX_FAILURES), jamais plus', denied === 20);
    ok('C.2.2 Les 5 tentatives restantes sont bloquées par la pause appelant (protection distribuée effective)', cooldown === 5);

    let targetsWithDoc = 0;
    let targetsOverCounted = false;
    for (const id of targets) {
      const snap = await fdb.collection('pin_attempts').doc(id).get();
      if (snap.exists) {
        targetsWithDoc++;
        const d = snap.data();
        if ((d.count || 0) > 1 || d.lockedUntilMs) targetsOverCounted = true; // 1 seul échec par compte : jamais verrouillé individuellement
      }
    }
    ok('C.2.3 Chaque compte individuel ne reçoit qu\'un seul échec (jamais verrouillé par lui-même, l\'attaque est trop diluée pour ça)', targetsWithDoc === 20 && !targetsOverCounted);

    // Isolation : un AUTRE appelant, sur un compte totalement différent,
    // n'est jamais affecté par la pause de l'attaquant ci-dessus — aucun
    // risque qu'un utilisateur légitime soit bloqué par l'activité d'un
    // autre appelant.
    await seedUser('isolation-target', 'technicien', '5678');
    const isolationResult = await callExpectError('isolation-target', '0000', 'caller-y-independant');
    ok('C.2.4 Un AUTRE appelant reste totalement indépendant (pas de "pause partagée" entre appelants, pas de DoS possible sur un tiers)',
      !!isolationResult && isolationResult.code === 'permission-denied');
  }

  console.log('\n--- C.3. Un PIN CORRECT reste refusé tant que le compte est VERROUILLÉ ---');
  {
    const resultDuringLock = await callExpectError('race1', '9999', 'caller-honnete-pendant-verrou');
    ok('C.3.1 Le bon PIN ne contourne PAS un verrou actif (sinon le verrouillage serait inutile)',
      !!resultDuringLock && resultDuringLock.code === 'resource-exhausted');
  }

  console.log('\n--- C.4. Succès après EXPIRATION naturelle du verrouillage ---');
  {
    // Simule l'écoulement du temps (60s) en reculant directement
    // lockedUntilMs — pas d'attente réelle dans ce test. Admin SDK, ignore
    // les règles, écrit directement l'état "déjà expiré".
    await fdb.collection('pin_attempts').doc('race1').set({ lockedUntilMs: Date.now() - 1000 }, { merge: true });
    let succeeded = false;
    let token = null;
    try {
      const result = await call('race1', '9999', 'caller-honnete-apres-expiration');
      succeeded = true;
      token = result && result.token;
    } catch (e) { console.error('   → échec inattendu : ' + e.message); }
    ok('C.4.1 Le bon PIN réussit une fois le verrou expiré, et un jeton est bien émis', succeeded && !!token);
    const afterSuccess = await fdb.collection('pin_attempts').doc('race1').get();
    ok('C.4.2 Le compteur du compte cible est entièrement effacé après un succès', !afterSuccess.exists);
  }

  console.log('\n--- C.5. Erreurs génériques : compte inconnu vs PIN faux (indistinguables) ---');
  {
    await seedUser('known-but-wrong', 'technicien', '1111');
    const rUnknown = await callExpectError('compte-totalement-inexistant', '2222', 'caller-generic-1');
    const rWrongKnown = await callExpectError('known-but-wrong', '0000', 'caller-generic-2');
    ok('C.5.1 Même code d\'erreur pour un compte inexistant et un PIN faux sur un compte existant',
      !!rUnknown && !!rWrongKnown && rUnknown.code === rWrongKnown.code);
    ok('C.5.2 Même message d\'erreur dans les deux cas (aucun détail distinctif)',
      !!rUnknown && !!rWrongKnown && rUnknown.message === rWrongKnown.message);
    const rMalformed = await callExpectError('x', 'abc', 'caller-generic-3'); // PIN non numérique -> invalid-argument, AVANT toute lecture Firestore
    ok('C.5.3 Entrée malformée (PIN non numérique) : erreur générique dès la validation, jamais de distinction par ce biais non plus',
      !!rMalformed && rMalformed.code === 'invalid-argument' && rMalformed.message === 'PIN incorrect.');
  }

  console.log('\n' + (failures === 0
    ? 'Tous les tests de sécurité PIN (émulateur réel, Firestore + Auth + Admin SDK) passent.'
    : failures + ' test(s) EN ÉCHEC.'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR FATALE DU SCRIPT :', e); process.exit(1); });
