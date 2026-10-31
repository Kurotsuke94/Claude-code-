#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// MAINTIX MX — SEED DE DONNÉES DE TEST POUR L'ÉMULATEUR LOCAL
// ════════════════════════════════════════════════════════════════════════
// Peuple l'ÉMULATEUR Firestore/Auth local (jamais le projet de production
// maintix-c9dbd) avec un jeu minimal de données FICTIVES, nécessaires pour
// pouvoir ouvrir et utiliser Maintix MX en local sans compte réel :
//   - config/hotel_config (coordonnées pour le calcul DJU)
//   - 4 utilisateurs PIN fictifs (2 Responsables, 2 Techniciens)
//   - 1 compte Admin de test (Firebase Auth e-mail/mot de passe)
//
// AUCUNE donnée personnelle, AUCUN PIN réel, AUCUN e-mail réel. Les noms
// ("Testeur Responsable A", etc.), PINs ("1111", "2222"...) et l'e-mail
// admin de test (admin-test@maintix.local) sont des valeurs FICTIVES
// clairement identifiables comme telles — même convention que
// tests/gst_seed.js (PINs courts et reconnaissables comme des valeurs de
// test, jamais un hash ou PIN provenant d'un compte réel).
//
// ── GARANTIES DE SÉCURITÉ ──
// 1. REFUS DE S'EXÉCUTER si l'émulateur Firestore OU l'émulateur Auth
//    n'est pas réellement détecté (sonde réseau réelle sur 127.0.0.1:8090
//    et 127.0.0.1:9099 ci-dessous, pas une simple lecture de variable
//    d'environnement qui pourrait être fausse). Les DEUX vérifications ont
//    lieu AVANT toute initialisation de l'Admin SDK et avant toute
//    écriture — Auth est désormais bloquant au même titre que Firestore
//    (et non plus un simple avertissement) : l'application elle-même ne
//    fonctionne pas sans Auth (connexion anonyme bootstrap requise pour
//    toute lecture/écriture Firestore, voir firebase-config.js), donc un
//    seed partiel sans Auth ne produirait qu'un environnement de test
//    inutilisable malgré des données en apparence présentes.
// 2. Les variables d'environnement FIRESTORE_EMULATOR_HOST/
//    FIREBASE_AUTH_EMULATOR_HOST/GCLOUD_PROJECT sont fixées EXPLICITEMENT
//    ICI, avant le require('firebase-admin') — c'est la lecture de ces
//    variables par le SDK Admin, au moment de son initialisation, qui le
//    fait basculer entièrement vers l'émulateur local. Sans elles (ou si
//    une app Admin SDK existait déjà), le SDK viserait par défaut le vrai
//    projet associé aux identifiants locaux (ex. `firebase login`) — ce
//    script s'interdit donc explicitement cette situation (voir le garde-
//    fou "admin.apps.length" plus bas).
// 3. GCLOUD_PROJECT est fixé à un nom de projet ARBITRAIRE ("maintix-
//    local-dev"), jamais "maintix-c9dbd" — même si une des protections
//    ci-dessus échouait, ce projectId ne correspond à aucune ressource
//    Firebase réelle facturable/accessible.
// 4. Aucune dépendance npm ajoutée : réutilise functions/node_modules/
//    firebase-admin, déjà présent (même mécanisme que tests/
//    pin_security_test.js, partie C).
//
// Usage (après avoir démarré les émulateurs — voir firebase.local.json,
// qui charge firestore.rules.draft-claims-migration plutôt que les règles
// actives, nécessaire pour tester le correctif PIN en local) :
//   firebase emulators:start --config firebase.local.json --only firestore,auth,functions,hosting,storage
//   node scripts/seed-local-emulator.js
// ════════════════════════════════════════════════════════════════════════

const http = require('http');
const path = require('path');
const crypto = require('crypto');

const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8090;
const AUTH_HOST       = '127.0.0.1';
const AUTH_PORT       = 9099;
const PROJECT_ID      = 'maintix-local-dev'; // JAMAIS maintix-c9dbd — nom arbitraire, purement local

function probe(host, port) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

async function main() {
  // Les DEUX sondes sont effectuées AVANT toute action (env vars, require,
  // initializeApp, écriture) — aucune des deux ne doit dépendre du résultat
  // de l'autre, et aucune écriture ne doit être possible si l'une des deux
  // manque.
  console.log('[seed] Vérification de la présence réelle des émulateurs Firestore (' + FIRESTORE_HOST + ':' + FIRESTORE_PORT + ') et Auth (' + AUTH_HOST + ':' + AUTH_PORT + ')...');
  const [firestoreUp, authUp] = await Promise.all([
    probe(FIRESTORE_HOST, FIRESTORE_PORT),
    probe(AUTH_HOST, AUTH_PORT),
  ]);

  let missing = false;
  if (!firestoreUp) {
    console.error('[seed] ERREUR : aucun émulateur Firestore détecté sur ' + FIRESTORE_HOST + ':' + FIRESTORE_PORT + '.');
    missing = true;
  } else {
    console.log('[seed] Émulateur Firestore détecté ✓');
  }
  if (!authUp) {
    console.error('[seed] ERREUR : aucun émulateur Auth détecté sur ' + AUTH_HOST + ':' + AUTH_PORT + '.');
    missing = true;
  } else {
    console.log('[seed] Émulateur Auth détecté ✓');
  }
  if (missing) {
    console.error('[seed] Ce script REFUSE de s\'exécuter tant que les DEUX émulateurs (Firestore ET Auth) ne');
    console.error('[seed] sont pas détectés — un seed partiel produirait un environnement de test inutilisable');
    console.error('[seed] (l\'application elle-même requiert Auth pour toute opération Firestore) et, pour ne');
    console.error('[seed] jamais risquer d\'écrire ailleurs (y compris, par erreur de configuration, en production).');
    console.error('[seed] Démarrez d\'abord : firebase emulators:start --config firebase.local.json --only firestore,auth,functions,hosting,storage');
    process.exit(1);
  }

  // Fixé AVANT le require('firebase-admin') — voir garanties ci-dessus.
  process.env.FIRESTORE_EMULATOR_HOST    = FIRESTORE_HOST + ':' + FIRESTORE_PORT;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST + ':' + AUTH_PORT;
  process.env.GCLOUD_PROJECT = PROJECT_ID;

  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (admin.apps.length) {
    console.error('[seed] ERREUR : une app Admin SDK est déjà initialisée dans ce processus — arrêt par précaution');
    console.error('[seed] (impossible de garantir dans ce cas qu\'elle cible bien l\'émulateur local).');
    process.exit(1);
  }
  admin.initializeApp({ projectId: PROJECT_ID });
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    // Re-vérification défensive juste avant d'écrire quoi que ce soit.
    console.error('[seed] ERREUR : FIRESTORE_EMULATOR_HOST absent au moment de l\'écriture — abandon.');
    process.exit(1);
  }
  const db = admin.firestore();

  console.log('[seed] Écriture des données de test (toutes fictives, PINs de test non confidentiels)...');

  // ── config/hotel_config — coordonnées de TEST (Paris, donnée
  // géographique publique — PAS l'établissement réel) : nécessaires pour
  // que le module DJU puisse calculer quelque chose en local. ──
  await db.collection('config').doc('hotel_config').set({
    name: 'Établissement TEST (environnement local)',
    lat: 48.8566, lon: 2.3522,
  }, { merge: true });
  console.log('[seed]   + config/hotel_config (coordonnées de test, Paris)');

  // ── Utilisateurs FICTIFS — noms génériques, AUCUN nom ni compte réel.
  // PINs en clair dans ce tableau (volontairement simples et reconnaissables
  // comme des valeurs de test), hashés en SHA-256 avant écriture comme le
  // ferait l'application réelle (users_private/{id}.pin). ──
  const USERS = [
    { id: 'seed_resp_a', name: 'Testeur Responsable A', role: 'responsable', pin: '1111' },
    { id: 'seed_resp_b', name: 'Testeur Responsable B', role: 'responsable', pin: '2222' },
    { id: 'seed_tech_a', name: 'Testeur Technicien A',  role: 'technicien',  pin: '3333' },
    { id: 'seed_tech_b', name: 'Testeur Technicien B',  role: 'technicien',  pin: '4444' },
  ];
  for (const u of USERS) {
    await db.collection('users').doc(u.id).set({ name: u.name, role: u.role }, { merge: true });
    await db.collection('users_private').doc(u.id).set({ pin: sha256(u.pin) }, { merge: true });
    console.log('[seed]   + ' + u.name + ' (' + u.role + ', PIN de test = ' + u.pin + ')');
  }

  // ── Compte Admin de TEST (Firebase Auth e-mail/mot de passe) — e-mail et
  // mot de passe fictifs, jamais le compte admin réel. L'émulateur Auth
  // est garanti présent ici (sondé et bloquant plus haut). Un admin n'a
  // besoin d'aucun document users/{id} : isAdmin() se décide uniquement
  // par le jeton Firebase Auth (sign_in_provider == 'password'), jamais
  // par une donnée Firestore. Ce compte de test n'est volontairement PAS
  // super-admin (isSuperAdmin() reste réservé au seul e-mail réel codé en
  // dur dans firestore.rules) — comportement correct et attendu en local.
  const auth = admin.auth();
  const TEST_ADMIN_EMAIL    = 'admin-test@maintix.local';
  const TEST_ADMIN_PASSWORD = 'TestAdminLocal1234!';
  try {
    await auth.getUserByEmail(TEST_ADMIN_EMAIL);
    console.log('[seed]   = Compte Admin de test déjà présent (' + TEST_ADMIN_EMAIL + ')');
  } catch (e) {
    await auth.createUser({
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
      displayName: 'Admin Test (local)',
    });
    console.log('[seed]   + Compte Admin de test créé : ' + TEST_ADMIN_EMAIL + ' / ' + TEST_ADMIN_PASSWORD);
  }

  console.log('\n[seed] Terminé. Toutes les écritures ont eu lieu UNIQUEMENT dans l\'émulateur local');
  console.log('[seed] (' + FIRESTORE_HOST + ':' + FIRESTORE_PORT + ', projet "' + PROJECT_ID + '").');
  console.log('[seed] Aucune donnée réelle, aucun PIN réel, aucune écriture vers maintix-c9dbd.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[seed] ERREUR inattendue :', e);
  process.exit(1);
});
