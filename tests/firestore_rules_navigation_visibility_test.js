// Vérification RÉELLE (émulateur Firestore, pas un mock) de la règle
// config/navigation_visibility et de sa protection contre le contournement
// via la règle générique config/{docId} — voir firestore.rules.
//
// Contrairement aux autres suites de tests/ (Playwright + mock-firebase.js,
// qui simulent fidèlement CE document précis mais restent un mock), ce
// fichier charge le VRAI contenu de firestore.rules dans un véritable
// moteur de règles Firestore (Firebase Emulator Suite) via
// @firebase/rules-unit-testing — c'est la seule façon de prouver le
// comportement serveur réel, y compris la sémantique d'union/OR entre
// plusieurs blocs "match" correspondant au même chemin.
//
// PRÉREQUIS (non installés par défaut dans ce dépôt — volontairement, pour
// ne pas alourdir package.json d'une dépendance ~700 paquets/130 Mo pour un
// seul test ponctuel) :
//   npm install --no-save firebase-tools @firebase/rules-unit-testing
// Puis exécuter via l'émulateur :
//   npx firebase emulators:exec --only firestore \
//     --project maintix-rules-test "node tests/firestore_rules_navigation_visibility_test.js"
// (nécessite Java — l'émulateur Firestore est un .jar — et un accès réseau
// pour le téléchargement ponctuel du binaire de l'émulateur au premier
// lancement, via `firebase setup:emulators:firestore`).
//
// Scénarios couverts (demande explicite) :
//   1. Super Admin peut écrire navigation_visibility
//   2. admin Firebase non-Super-Admin NE PEUT PAS écrire
//   3-4. Responsable / Technicien NE PEUVENT PAS écrire — NOTE : côté
//        règles Firestore, Responsable et Technicien sont STRICTEMENT
//        INDISCERNABLES l'un de l'autre (voir explication en bas de
//        fichier) : les deux s'authentifient uniquement par une session
//        Firebase Auth ANONYME (bootstrap PIN, firebase-config.js), le
//        rôle réel n'étant vérifié QUE côté client. Ce test vérifie donc
//        UN SEUL contexte "utilisateur PIN anonyme", représentatif des
//        deux rôles à l'identique.
//   5. Les autres documents config/{docId} gardent leur comportement actuel.
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
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

  const superAdmin = testEnv.authenticatedContext('super-uid', {
    email: 'keyzeur94460@hotmail.fr',
    firebase: { sign_in_provider: 'password' },
  });
  const otherAdmin = testEnv.authenticatedContext('other-uid', {
    email: 'autre-admin@maintix.local',
    firebase: { sign_in_provider: 'password' },
  });
  // Représente indifféremment Responsable OU Technicien (voir note en tête
  // de fichier) — session Firebase Auth anonyme, comme tout utilisateur PIN.
  const pinUser = testEnv.authenticatedContext('pin-uid', {
    firebase: { sign_in_provider: 'anonymous' },
  });

  console.log('\n--- config/navigation_visibility ---');
  await check('1. Super Admin PEUT écrire config/navigation_visibility',
    () => assertSucceeds(superAdmin.firestore().collection('config').doc('navigation_visibility').set({ planning: { tech: false, responsable: true } })));

  await check('2. Un admin Firebase non-Super-Admin NE PEUT PAS écrire config/navigation_visibility',
    () => assertFails(otherAdmin.firestore().collection('config').doc('navigation_visibility').set({ planning: { tech: true, responsable: true } })));

  await check('3. Un utilisateur PIN (Responsable) NE PEUT PAS écrire config/navigation_visibility',
    () => assertFails(pinUser.firestore().collection('config').doc('navigation_visibility').set({ planning: { tech: true, responsable: true } })));

  await check('4. Un utilisateur PIN (Technicien — même contexte règles que Responsable) NE PEUT PAS écrire config/navigation_visibility',
    () => assertFails(pinUser.firestore().collection('config').doc('navigation_visibility').set({ planning: { tech: true, responsable: true } })));

  await check('5. La lecture de config/navigation_visibility reste autorisée pour un admin non-Super-Admin',
    () => assertSucceeds(otherAdmin.firestore().collection('config').doc('navigation_visibility').get()));

  await check('5b. La lecture de config/navigation_visibility reste autorisée pour un utilisateur PIN',
    () => assertSucceeds(pinUser.firestore().collection('config').doc('navigation_visibility').get()));

  console.log('\n--- Non-régression : autres documents config/{docId} ---');
  await check('6. config/hotel_config — un admin Firebase (non-super) peut toujours écrire (comportement inchangé)',
    () => assertSucceeds(otherAdmin.firestore().collection('config').doc('hotel_config').set({ hotelName: 'Test' })));

  await check('7. config/hotel_config — un utilisateur PIN ne peut toujours pas écrire (comportement inchangé)',
    () => assertFails(pinUser.firestore().collection('config').doc('hotel_config').set({ hotelName: 'Test' })));

  await check('8. config/checks — un utilisateur PIN peut toujours écrire (exception opérationnelle inchangée)',
    () => assertSucceeds(pinUser.firestore().collection('config').doc('checks').set({ done: true })));

  await check('9. config/notes — un utilisateur PIN peut toujours écrire (exception opérationnelle inchangée)',
    () => assertSucceeds(pinUser.firestore().collection('config').doc('notes').set({ text: 'x' })));

  await check('10. Toute lecture config/* reste libre (comportement inchangé)',
    () => assertSucceeds(pinUser.firestore().collection('config').doc('hotel_config').get()));

  await testEnv.cleanup();
  console.log(failures
    ? ('\n' + failures + ' test(s) EN ÉCHEC.')
    : '\nTous les tests de règles Firestore (émulateur réel) passent.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });

// NOTE — indiscernabilité Responsable / Technicien côté règles Firestore :
// cette application authentifie les comptes Responsable et Technicien
// exclusivement par PIN vérifié CÔTÉ CLIENT (voir assets/js/auth.js),
// adossé à une session Firebase Auth anonyme unique et commune ouverte au
// démarrage (assets/js/firebase-config.js) pour TOUT utilisateur PIN, quel
// que soit son rôle réel. Aucun custom claim, aucune Cloud Function, aucun
// second provider ne distingue Responsable de Technicien au niveau du
// jeton request.auth exploité par firestore.rules. Par construction, une
// règle Firestore ne peut donc PAS traiter Responsable et Technicien
// différemment aujourd'hui — les deux sont { auth != null, anonyme } au
// sens des règles. Ce n'est pas une lacune de cette fonctionnalité : c'est
// une caractéristique de l'architecture d'authentification existante,
// déjà vraie pour config/checks et config/notes avant ce chantier.
