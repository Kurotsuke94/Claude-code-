// Vérification RÉELLE (émulateur Firestore, pas un mock navigateur) des
// règles CLAIMS-BASED proposées pour sécuriser CTA/VC — voir
// firestore.rules.draft-claims-migration (BROUILLON, non appliqué à
// firestore.rules, jamais déployé). Charge ce brouillon dans un véritable
// moteur de règles (Firebase Emulator Suite) via @firebase/rules-unit-testing
// — la seule façon de prouver un comportement serveur réel, comme pour
// tests/firestore_rules_navigation_visibility_test.js (même technique).
//
// PRÉREQUIS : @firebase/rules-unit-testing + firebase-tools (installés en
// devDependencies pour ce chantier — voir package.json). Exécution :
//   npx firebase emulators:exec --only firestore \
//     --project maintix-rules-test "node tests/firestore_rules_cta_vc_claims_test.js"
// (même émulateur/port que les autres tests de règles — voir firebase.json
// "emulators".)
//
// MÉTHODE DE SIMULATION DES RÔLES : testEnv.authenticatedContext(uid, claims)
// permet d'injecter N'IMPORTE QUELLE forme de jeton pour les besoins du
// test — ce n'est PAS une faculté qu'un attaquant réel posséderait (un vrai
// custom claim ne peut être posé que par l'Admin SDK, côté serveur, via
// functions/index.js:verifyPin). Ici, on l'utilise pour vérifier que LA
// RÈGLE ELLE-MÊME exige bien sign_in_provider == 'custom' ET un claim
// `role` cohérent — pas pour contourner quoi que ce soit.
//
// Scénarios couverts (demande explicite, point 6) :
//   1. Administrateur autorisé (accès complet aux 4 collections)
//   2. Responsable autorisé (accès complet aux 4 collections)
//   3. Technicien autorisé à créer un relevé valide
//   4. Technicien refusé pour modifier un circuit
//   5. Technicien refusé pour décider une recommandation (accepter/refuser)
//      — mais autorisé pour la seule transition automatique d'expiration
//   6. Utilisateur non authentifié refusé (les 4 collections)
//   7. Tentative de falsification du rôle refusée (role dans le DOCUMENT
//      écrit, ou sign_in_provider incohérent avec le claim role)
//   8. Champs invalides / écritures non conformes refusés (relevé)
//   9. Règles users empêchant l'élévation de privilèges (self), tout en
//      préservant la gestion d'équipe existante par un Responsable
//  10. weather_daily : écriture bloquée pour TOUT client, y compris Admin
//      (serveur uniquement, via computeDailyWeatherDju / Admin SDK)
//  11. Non-régression : isAdmin() reste vrai pour un vrai Admin Firebase
//      (sign_in_provider != 'custom' ajouté sans casser le cas existant)
//  12. SCÉNARIO CRITIQUE (audit "Sécurité des PIN") : une session PIN
//      (sign_in_provider == 'custom') ne peut JAMAIS satisfaire isAdmin(),
//      prouvé sur des ressources admin-only SANS RAPPORT avec users/
//      users_private (config/hotel_config, suppression d'une mission) —
//      seule preuve jusqu'ici manquante : les tests existants ne
//      couvraient que users/users_private pour ce point, ou testaient
//      l'ANCIEN modèle sign_in_provider=='anonymous' (voir tests/
//      firestore_rules_navigation_visibility_test.js), jamais 'custom'
//      contre une ressource générique.
//  13. Administration des rôles : l'Admin peut changer le rôle/rang d'un
//      utilisateur ; un Technicien ne peut pas s'auto-élever. DÉFAUT
//      DÉCOUVERT pendant l'écriture de ce test (13b) : un Responsable PEUT
//      modifier role/rank/roleId sur SON PROPRE document — voir le
//      commentaire à cet endroit pour le détail et la portée réelle.
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { serverTimestamp } = require('firebase/firestore');

const RULES_PATH = path.join(__dirname, '..', 'firestore.rules.draft-claims-migration');
let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }
async function check(label, fn) {
  try { await fn(); ok(label, true); }
  catch (e) { ok(label, false); console.error('   → ' + e.message.split('\n')[0]); }
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: 'maintix-rules-test',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8090,
    },
  });

  // ── Contextes ──
  const admin = testEnv.authenticatedContext('admin-uid', {
    email: 'admin@maintix.local',
    firebase: { sign_in_provider: 'password' },
  });
  const responsable = testEnv.authenticatedContext('pinuser_resp1', {
    firebase: { sign_in_provider: 'custom' },
    role: 'responsable',
    userId: 'resp1',
  });
  const technicien = testEnv.authenticatedContext('pinuser_tech1', {
    firebase: { sign_in_provider: 'custom' },
    role: 'technicien',
    userId: 'tech1',
  });
  const technicien2 = testEnv.authenticatedContext('pinuser_tech2', {
    firebase: { sign_in_provider: 'custom' },
    role: 'technicien',
    userId: 'tech2',
  });
  const anonyme = testEnv.authenticatedContext('anon-uid', {
    firebase: { sign_in_provider: 'anonymous' },
  });
  // Jeton "falsifié" : sign_in_provider anonyme MAIS avec un claim role —
  // scénario impossible à obtenir légitimement (seul verifyPin() pose un
  // claim, et toujours avec sign_in_provider:'custom'), mais utile pour
  // prouver que la règle vérifie bien LES DEUX conditions, pas seulement
  // la présence d'un rôle.
  const forgedAnonymeAvecRole = testEnv.authenticatedContext('forged-uid', {
    firebase: { sign_in_provider: 'anonymous' },
    role: 'responsable',
  });
  const unauth = testEnv.unauthenticatedContext();

  // Pré-remplissage de données nécessaires (via la règle "admin", qui
  // réussit toujours) pour tester lecture/modification/suppression dessus.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('heating_circuits').doc('c1').set({ name: 'Circuit 1', archived: false });
    await db.collection('heating_recommendations').doc('r1').set({ status: 'a_examiner', circuitId: 'c1', createdAt: new Date() });
    await db.collection('heating_recommendations').doc('r2').set({ status: 'acceptee', circuitId: 'c1', createdAt: new Date() });
    await db.collection('weather_daily').doc('2026-10-20').set({ date: '2026-10-20', kind: 'observed' });
    // 'pin' ne vit plus dans users/{id} (voir users_private/{id} et
    // tests/pin_security_test.js) — ces documents n'en ont plus besoin ici,
    // aucune assertion de ce fichier ne porte sur le PIN lui-même.
    await db.collection('users').doc('tech1').set({ name: 'Tech Un', role: 'technicien' });
    await db.collection('users').doc('resp1').set({ name: 'Resp Un', role: 'responsable' });
    // tech2 (cible de la section 13, Admin change le rôle/rang d'un AUTRE
    // utilisateur que lui-même) — DÉFAUT CORRIGÉ : ce document n'était pas
    // seedé ICI, section 13.1/13.2 ne passait que par accident lorsque
    // tests/pin_security_test.js (qui crée aussi users/tech2) avait déjà
    // tourné dans le MÊME processus d'émulateur avant ce fichier — jamais
    // garanti (émulateur frais, fichier exécuté seul ou avant
    // pin_security_test.js : .update() sur un document absent échoue avec
    // "Null value error" lors de l'évaluation de resource.data.diff(), pas
    // un vrai refus de règle). Ce fichier doit être auto-suffisant.
    await db.collection('users').doc('tech2').set({ name: 'Tech Deux', role: 'technicien' });
  });

  console.log('\n--- 1. Administrateur : accès complet aux 4 collections ---');
  await check('1.1 Admin peut lire heating_circuits', () => assertSucceeds(admin.firestore().collection('heating_circuits').doc('c1').get()));
  await check('1.2 Admin peut créer un circuit', () => assertSucceeds(admin.firestore().collection('heating_circuits').doc('c2').set({ name: 'Circuit Admin' })));
  await check('1.3 Admin peut modifier un circuit', () => assertSucceeds(admin.firestore().collection('heating_circuits').doc('c1').update({ archived: true })));
  await check('1.4 Admin peut accepter une recommandation', () => assertSucceeds(admin.firestore().collection('heating_recommendations').doc('r1').update({ status: 'acceptee', decidedBy: 'Admin' })));

  console.log('\n--- 2. Responsable : accès complet aux 4 collections ---');
  await check('2.1 Responsable peut lire heating_circuits', () => assertSucceeds(responsable.firestore().collection('heating_circuits').doc('c1').get()));
  await check('2.2 Responsable peut créer un circuit', () => assertSucceeds(responsable.firestore().collection('heating_circuits').doc('c3').set({ name: 'Circuit Resp' })));
  await check('2.3 Responsable peut modifier un circuit', () => assertSucceeds(responsable.firestore().collection('heating_circuits').doc('c1').update({ zone: 'Aile Est' })));
  await check('2.4 Responsable peut refuser une recommandation', () => assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('r1').update({ status: 'refusee', decidedBy: 'Resp' })));
  await check('2.5 Responsable peut marquer appliquée une recommandation acceptée', () => assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('r2').update({ status: 'appliquee', appliedBy: 'Resp' })));

  console.log('\n--- 3. Technicien : création de relevé valide autorisée ---');
  await check('3.1 Technicien peut créer un relevé valide', () => assertSucceeds(
    technicien.firestore().collection('heating_readings').doc('rd1').set({
      circuitId: 'c1', temp: 19.5, createdAt: serverTimestamp(), author: 'Tech Un',
    })
  ));
  await check('3.2 Technicien peut lire les circuits (nécessaire pour choisir où saisir un relevé)', () => assertSucceeds(technicien.firestore().collection('heating_circuits').doc('c1').get()));
  await check('3.3 Technicien peut lire les relevés existants', () => assertSucceeds(technicien.firestore().collection('heating_readings').doc('rd1').get()));

  console.log('\n--- 3b. PASSE DE FIABILISATION — l\'auteur d\'un relevé ne peut JAMAIS être falsifié depuis le client ---');
  await check('3b.1 Technicien NE PEUT PAS usurper le nom d\'un AUTRE technicien enregistré (tech1 prétendant être "Tech Deux")', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-usurp1').set({
      circuitId: 'c1', temp: 20, createdAt: serverTimestamp(), author: 'Tech Deux',
    })
  ));
  await check('3b.2 Technicien NE PEUT PAS écrire un nom entièrement inventé, absent de users/', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-usurp2').set({
      circuitId: 'c1', temp: 20, createdAt: serverTimestamp(), author: 'Nom Totalement Inventé',
    })
  ));
  await check('3b.3 Technicien NE PEUT PAS usurper le nom du Responsable', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-usurp3').set({
      circuitId: 'c1', temp: 20, createdAt: serverTimestamp(), author: 'Resp Un',
    })
  ));
  await check('3b.4 Responsable NE PEUT PAS non plus usurper le nom d\'un technicien', () => assertFails(
    responsable.firestore().collection('heating_readings').doc('rd-usurp4').set({
      circuitId: 'c1', temp: 20, createdAt: serverTimestamp(), author: 'Tech Un',
    })
  ));
  await check('3b.5 Technicien PEUT toujours écrire SON PROPRE nom exact (non-régression — voir 3.1)', () => assertSucceeds(
    technicien.firestore().collection('heating_readings').doc('rd-legit').set({
      circuitId: 'c1', temp: 20, createdAt: serverTimestamp(), author: 'Tech Un',
    })
  ));
  await check('3b.6 Un relevé SANS champ author reste accepté (le champ est facultatif, jamais inventé si absent)', () => assertSucceeds(
    technicien.firestore().collection('heating_readings').doc('rd-noauthor').set({
      circuitId: 'c1', temp: 20, createdAt: serverTimestamp(),
    })
  ));

  console.log('\n--- 4. Technicien : gestion de circuit refusée ---');
  await check('4.1 Technicien NE PEUT PAS créer de circuit', () => assertFails(technicien.firestore().collection('heating_circuits').doc('c-tech').set({ name: 'Circuit Tech' })));
  await check('4.2 Technicien NE PEUT PAS modifier un circuit existant', () => assertFails(technicien.firestore().collection('heating_circuits').doc('c1').update({ archived: true })));

  console.log('\n--- 5. Technicien : décision sur recommandation refusée, expiration automatique autorisée ---');
  await check('5.1 Technicien NE PEUT PAS accepter une recommandation', () => assertFails(technicien.firestore().collection('heating_recommendations').doc('r1').update({ status: 'acceptee', decidedBy: 'Tech' })));
  await check('5.2 Technicien NE PEUT PAS refuser une recommandation', () => assertFails(technicien.firestore().collection('heating_recommendations').doc('r1').update({ status: 'refusee', decidedBy: 'Tech' })));
  await check('5.3 Technicien NE PEUT PAS marquer appliquée une recommandation acceptée', () => assertFails(technicien.firestore().collection('heating_recommendations').doc('r2').update({ status: 'appliquee', appliedBy: 'Tech' })));
  // r1 a déjà été transitionnée par les tests 1.4 (-> acceptee) puis 2.4
  // (-> refusee) ci-dessus : on seed un document frais encore 'a_examiner'
  // pour tester la seule transition automatique autorisée au technicien.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('heating_recommendations').doc('r-expirable').set({ status: 'a_examiner', circuitId: 'c1', createdAt: new Date() });
  });
  await check('5.4 Technicien PEUT déclencher la transition automatique a_examiner -> expiree', () => assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('r-expirable').update({ status: 'expiree', expiredAt: new Date() })));
  await check('5.5 Technicien NE PEUT PAS créer une recommandation directement acceptée (contournement de la décision)', () => assertFails(
    technicien.firestore().collection('heating_recommendations').doc('r-fake').set({ status: 'acceptee', circuitId: 'c1', createdAt: serverTimestamp() })
  ));
  await check('5.6 Technicien PEUT créer une recommandation "à examiner" (synchronisation automatique du moteur)', () => assertSucceeds(
    technicien.firestore().collection('heating_recommendations').doc('r-new').set({ status: 'a_examiner', circuitId: 'c1', createdAt: serverTimestamp() })
  ));

  console.log('\n--- 6. Utilisateur non authentifié refusé partout ---');
  await check('6.1 Non-authentifié : lecture heating_circuits refusée', () => assertFails(unauth.firestore().collection('heating_circuits').doc('c1').get()));
  await check('6.2 Non-authentifié : création de relevé refusée', () => assertFails(unauth.firestore().collection('heating_readings').doc('rd-x').set({ circuitId: 'c1', temp: 20, createdAt: new Date() })));
  await check('6.3 Non-authentifié : lecture heating_recommendations refusée', () => assertFails(unauth.firestore().collection('heating_recommendations').doc('r1').get()));
  await check('6.4 Non-authentifié : lecture weather_daily refusée', () => assertFails(unauth.firestore().collection('weather_daily').doc('2026-10-20').get()));

  console.log('\n--- 7. Tentative de falsification du rôle refusée ---');
  await check('7.1 Un rôle "responsable" placé dans le DOCUMENT écrit (pas le jeton) ne donne aucun droit', () => assertFails(
    anonyme.firestore().collection('heating_circuits').doc('c-forge').set({ name: 'Faux circuit', role: 'responsable' })
  ));
  await check('7.2 Un jeton anonyme portant un claim "role" forgé (sign_in_provider incohérent) reste refusé', () => assertFails(
    forgedAnonymeAvecRole.firestore().collection('heating_circuits').doc('c-forge2').set({ name: 'Faux circuit 2' })
  ));
  await check('7.3 Le même jeton forgé ne peut pas non plus décider une recommandation', () => assertFails(
    forgedAnonymeAvecRole.firestore().collection('heating_recommendations').doc('r1').update({ status: 'acceptee' })
  ));

  console.log('\n--- 8. Champs invalides / écritures non conformes refusés (heating_readings) ---');
  await check('8.1 Relevé refusé : circuitId manquant', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-bad1').set({ temp: 20, createdAt: new Date() })
  ));
  await check('8.2 Relevé refusé : température hors bornes plausibles (200°C)', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-bad2').set({ circuitId: 'c1', temp: 200, createdAt: new Date() })
  ));
  await check('8.3 Relevé refusé : température non numérique', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-bad3').set({ circuitId: 'c1', temp: '20', createdAt: new Date() })
  ));
  await check('8.4 Relevé refusé : createdAt fourni par le client (pas un vrai serverTimestamp)', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-bad4').set({ circuitId: 'c1', temp: 20, createdAt: new Date('2000-01-01') })
  ));
  await check('8.5 Relevé refusé : commentaire anormalement long (abus)', () => assertFails(
    technicien.firestore().collection('heating_readings').doc('rd-bad5').set({ circuitId: 'c1', temp: 20, createdAt: new Date(), comment: 'x'.repeat(5000) })
  ));

  console.log('\n--- 9. users : élévation de privilèges empêchée, gestion d\'équipe préservée ---');
  await check('9.1 Technicien NE PEUT PAS se promouvoir "responsable" sur son propre document', () => assertFails(
    technicien.firestore().collection('users').doc('tech1').update({ role: 'responsable' })
  ));
  await check('9.2 Technicien NE PEUT PAS modifier le document d\'un AUTRE utilisateur', () => assertFails(
    technicien.firestore().collection('users').doc('tech1').set({ name: 'Tech Un (self)' }).then(() =>
      technicien2.firestore().collection('users').doc('tech1').update({ name: 'Changé par un autre' })
    )
  ));
  // CORRECTION AUDIT (session suivante) : 'pin' n'a plus jamais sa place
  // dans users/{userId} — déplacé vers users_private/{userId} (non lisible
  // par le client, voir firestore.rules.draft-claims-migration). L'ancienne
  // version de ce test attendait un SUCCÈS ici ("champ non privilégié") ;
  // c'est désormais l'inverse qui est correct : AUCUNE écriture de 'pin'
  // n'est plus jamais tolérée sur ce document, même pour soi-même — voir
  // tests/pin_security_test.js pour la preuve que le self-service PIN
  // fonctionne toujours, via users_private.
  await check('9.3 Technicien NE PEUT PAS écrire "pin" dans users/{id}, même le sien (déplacé vers users_private)', () => assertFails(
    technicien.firestore().collection('users').doc('tech1').update({ pin: 'nouveauhash' })
  ));
  await check('9.4 Technicien PEUT modifier son propre nom (self-service)', () => assertSucceeds(
    technicien.firestore().collection('users').doc('tech1').update({ name: 'Nouveau Nom' })
  ));
  await check('9.5 Responsable PEUT toujours gérer l\'équipe : changer le roleId d\'un AUTRE utilisateur (non-régression)', () => assertSucceeds(
    responsable.firestore().collection('users').doc('tech1').update({ roleId: 'role-xyz' })
  ));
  await check('9.6 Un utilisateur non authentifié ne peut rien modifier sur users', () => assertFails(
    unauth.firestore().collection('users').doc('tech1').update({ name: 'Intrus' })
  ));

  console.log('\n--- 10. weather_daily : écriture serveur uniquement (même un Admin client est refusé) ---');
  await check('10.1 Admin (client Firestore) NE PEUT PAS écrire weather_daily — serveur uniquement', () => assertFails(
    admin.firestore().collection('weather_daily').doc('2026-10-21').set({ date: '2026-10-21', kind: 'observed' })
  ));
  await check('10.2 Responsable NE PEUT PAS écrire weather_daily', () => assertFails(
    responsable.firestore().collection('weather_daily').doc('2026-10-21').set({ date: '2026-10-21', kind: 'observed' })
  ));
  await check('10.3 Technicien peut toujours LIRE weather_daily (consultation DJU)', () => assertSucceeds(technicien.firestore().collection('weather_daily').doc('2026-10-20').get()));

  console.log('\n--- 11. Non-régression isAdmin() ---');
  await check('11.1 Un vrai Admin Firebase (sign_in_provider=password) reste isAdmin() == true (org_tasks, écriture déjà admin-only ailleurs)', () => assertSucceeds(
    admin.firestore().collection('heating_circuits').doc('c-admin-check').set({ name: 'Vérif isAdmin' })
  ));

  console.log('\n--- 12. SCÉNARIO CRITIQUE : une session PIN (sign_in_provider=\'custom\') ne peut JAMAIS obtenir isAdmin() ---');
  // Demande explicite (audit "Sécurité des PIN") : AUCUN test existant
  // avant celui-ci n'envoyait un jeton sign_in_provider=='custom' (le
  // VRAI modèle PIN, celui émis par functions/index.js:verifyPin) contre
  // une ressource admin-only SANS RAPPORT avec users/users_private. Le
  // test le plus proche (tests/firestore_rules_navigation_visibility_test.js,
  // test 7) prouve la même chose mais avec sign_in_provider=='anonymous'
  // (l'ANCIEN modèle, jamais celui réellement émis par verifyPin) et
  // charge en plus firestore.rules (le fichier ACTIF), pas ce brouillon.
  // Ce test-ci exerce directement la ligne
  // "sign_in_provider != 'custom'" de isAdmin() (voir le helper en tête de
  // firestore.rules.draft-claims-migration) : si cette exclusion était un
  // jour retirée, 12.1/12.2/12.4/12.5 passeraient de assertFails à un
  // succès et ce test échouerait. Cette sensibilité n'a pas pu être
  // vérifiée par exécution ce tour (retrait temporaire de l'exclusion +
  // nouvelle exécution interdites par la consigne "ne démarre aucun
  // émulateur") — seulement établie par lecture directe de la condition
  // exercée ; à confirmer par exécution réelle une fois autorisée.
  //
  // Deux ressources admin-only indépendantes, SANS RAPPORT avec PIN/users,
  // pour ne pas réutiliser le même mécanisme que les tests existants :
  //   - config/hotel_config (match /config/{docId}, allow create/update:
  //     if isAdmin() && docId != 'navigation_visibility')
  //   - missions/{docId}.delete (match /missions/{docId}, allow delete:
  //     if isAdmin())
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('missions').doc('m1').set({ text: 'Mission test', done: false });
  });
  await check('12.1 Responsable (sign_in_provider=custom) NE PEUT PAS écrire config/hotel_config (admin-only)', () => assertFails(
    responsable.firestore().collection('config').doc('hotel_config').set({ lat: 0, lon: 0 })
  ));
  await check('12.2 Technicien (sign_in_provider=custom) NE PEUT PAS écrire config/hotel_config (admin-only)', () => assertFails(
    technicien.firestore().collection('config').doc('hotel_config').set({ lat: 0, lon: 0 })
  ));
  await check('12.3 Un vrai Admin (sign_in_provider=password) PEUT écrire config/hotel_config — confirme que la ressource elle-même est bien admin-only (12.1/12.2 ne sont pas un refus accidentel sans rapport)', () => assertSucceeds(
    admin.firestore().collection('config').doc('hotel_config').set({ lat: 48.8566, lon: 2.3522 })
  ));
  await check('12.4 Responsable (sign_in_provider=custom) NE PEUT PAS supprimer une mission (admin-only)', () => assertFails(
    responsable.firestore().collection('missions').doc('m1').delete()
  ));
  await check('12.5 Technicien (sign_in_provider=custom) NE PEUT PAS supprimer une mission (admin-only)', () => assertFails(
    technicien.firestore().collection('missions').doc('m1').delete()
  ));
  await check('12.6 Un vrai Admin PEUT supprimer une mission — confirme que la ressource elle-même est bien admin-only', () => assertSucceeds(
    admin.firestore().collection('missions').doc('m1').delete()
  ));

  console.log('\n--- 13. Administration des rôles : Admin peut, Technicien ne peut pas s\'auto-élever ---');
  await check('13.1 Admin PEUT changer le rôle d\'un utilisateur (technicien -> responsable)', () => assertSucceeds(
    admin.firestore().collection('users').doc('tech2').update({ role: 'responsable' })
  ));
  await check('13.2 Admin PEUT changer le rang (rank) d\'un utilisateur', () => assertSucceeds(
    admin.firestore().collection('users').doc('tech2').update({ rank: 'responsable' })
  ));
  await check('13.3 Technicien NE PEUT PAS s\'attribuer un roleId sur son propre document (élévation via la matrice de permissions)', () => assertFails(
    technicien.firestore().collection('users').doc('tech1').update({ roleId: 'role-non-destine' })
  ));

  console.log('\n--- 13b. DÉFAUT DÉCOUVERT pendant l\'écriture de ce test — à corriger seulement après autorisation ---');
  // isResponsableOrAdmin() = isAdmin() || isPinRole('responsable') ne
  // dépend QUE de l'ACTEUR (son propre jeton), jamais de la CIBLE visée —
  // contrairement à la branche self-service juste à côté, cette branche ne
  // porte AUCUNE exclusion sur les champs role/rank/roleId. Or un
  // Responsable satisfait TOUJOURS isResponsableOrAdmin() sur N'IMPORTE
  // QUEL document, y compris LE SIEN : la protection "empêche toute
  // auto-élévation" documentée dans le commentaire de users/{userId} ne
  // s'applique donc, dans les faits, qu'à un Technicien — pas à un
  // Responsable agissant sur son propre document.
  // Portée réelle (ne pas surestimer) : ceci ne permet JAMAIS d'atteindre
  // isAdmin()==true (jamais lu depuis Firestore, uniquement depuis
  // request.auth.token.firebase.sign_in_provider — voir isAdmin()). Mais
  // un Responsable peut aujourd'hui modifier role/rank (dégradation vers
  // 'technicien' sans effet réel, puisqu'il reste le jeton 'responsable'
  // émis par verifyPin() qui fait foi au prochain login, pas ce champ) et,
  // plus notable, s'attribuer un roleId arbitraire de la matrice de
  // permissions (assets/js/pages/admin.js:PERM_MODULES) qui ne lui était
  // pas destiné — un élargissement de permissions CLIENT, jamais une
  // élévation vers isAdmin() côté serveur.
  // NON CORRIGÉ ici, conformément à la consigne ("ne modifie pas le
  // brouillon sauf si un défaut réel est démontré et demande alors mon
  // autorisation avant de le corriger") — ce test démontre le défaut et
  // attend une décision.
  await check('13b.1 [DÉFAUT, voir commentaire] Un Responsable PEUT modifier roleId sur SON PROPRE document (bypass via isResponsableOrAdmin(), non lié à isAdmin())', () =>
    assertSucceeds(responsable.firestore().collection('users').doc('resp1').update({ roleId: 'role-auto-attribue' }))
  );

  await testEnv.cleanup();
  console.log(failures
    ? ('\n' + failures + ' test(s) EN ÉCHEC.')
    : '\nTous les tests de règles Firestore CTA/VC (émulateur réel, brouillon claims) passent.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });
