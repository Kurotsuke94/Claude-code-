#!/usr/bin/env node
'use strict';

// ── MAINTIX — MIGRATION DES PIN VERS users_private ──
//
// Copie le hash PIN de users/{userId}.pin vers users_private/{userId}.pin,
// de façon STRICTEMENT ADDITIVE et IDEMPOTENTE :
//   - users/{userId}.pin n'est JAMAIS lu que pour être copié — jamais
//     modifié, jamais supprimé, à aucun moment, par ce script.
//   - users_private/{userId}.pin n'est JAMAIS écrasé s'il contient déjà
//     une valeur non vide (relecture + décision dans la MÊME transaction
//     que l'écriture, pour écarter toute course avec une réinitialisation
//     Admin ou un changement self-service concurrent).
//   - Exécuter ce script plusieurs fois produit le même résultat final
//     (aucun utilisateur déjà migré n'est retouché).
//
// Pourquoi ce script existe : l'audit de préparation à la production a
// constaté qu'aucun outil de migration n'existait, alors que
// functions/index.js:verifyPin lit désormais le hash PIN UNIQUEMENT dans
// users_private — sans cette migration, AUCUN compte existant ne peut plus
// s'authentifier dès que le nouveau client/la nouvelle fonction sont
// déployés. Voir le rapport d'audit joint pour le séquencement complet.
//
// SÉCURITÉ / CONFIDENTIALITÉ : ce script ne journalise JAMAIS la valeur du
// champ `pin` (ni en clair, ni son hash) — uniquement des identifiants
// d'utilisateur et des compteurs. Toute fonction de log reçoit des chaînes
// déjà expurgées de cette valeur ; voir _log() et les commentaires associés
// à chaque site où `pin` est lu.
//
// GARDE-FOU PRODUCTION : par défaut, ce script n'écrit RIEN (--dry-run
// implicite). Pour écrire réellement, --execute est obligatoire. Si aucune
// variable FIRESTORE_EMULATOR_HOST n'est détectée (c'est-à-dire que la
// cible n'est PAS un émulateur local), --execute est REFUSÉ à moins de
// passer EXPLICITEMENT --allow-production en plus — et même alors, ce
// script ne doit être lancé contre la production qu'après une relecture et
// une autorisation séparées, jamais depuis cette session d'implémentation
// locale (voir le rapport : "n'exécute pas ce script contre la
// production").
//
// GARDE-FOU PROJET : hors émulateur, ce script REFUSE toute opération (même
// un dry-run) si le project id réellement résolu par le SDK Admin
// (db.projectId, pas seulement --project/GCLOUD_PROJECT) n'est pas EXACTEMENT
// "maintix-c9dbd" — voir EXPECTED_PRODUCTION_PROJECT_ID et
// _checkPreconditions. Le projet ciblé est systématiquement affiché avant
// toute opération, dans tous les modes.
//
// USAGE :
//   node scripts/migrate-pins-to-private.js                  (dry-run, par défaut)
//   node scripts/migrate-pins-to-private.js --dry-run
//   node scripts/migrate-pins-to-private.js --execute         (émulateur uniquement, sauf --allow-production)
//   node scripts/migrate-pins-to-private.js --execute --allow-production   (JAMAIS depuis cette session)
//   node scripts/migrate-pins-to-private.js --project maintix-rules-test --page-size 200

const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');
const PAGE_SIZE_DEFAULT = 300;
// Seul projet Firebase de production autorisé pour ce script. Vérifié
// contre le project id RÉELLEMENT résolu par le SDK Admin (db.projectId,
// jamais seulement --project/GCLOUD_PROJECT, qui ne sont que des intentions
// — db.projectId reflète ce que le SDK utilisera effectivement pour ses
// requêtes, y compris quand il est déduit de credentials par défaut).
// Jamais appliqué sous l'émulateur (voir _checkPreconditions) : les tests
// (tests/migrate_pins_test.js) utilisent délibérément un autre project id
// ('maintix-rules-test') contre l'émulateur local, ce qui doit rester permis.
const EXPECTED_PRODUCTION_PROJECT_ID = 'maintix-c9dbd';

function _loadFirebaseAdmin() {
  // firebase-admin vit dans functions/node_modules (installé pour les
  // Cloud Functions) — ce script n'a pas sa propre dépendance dupliquée.
  return require(path.join(FUNCTIONS_DIR, 'node_modules', 'firebase-admin'));
}

function _parseArgs(argv) {
  const args = {
    execute: false,
    allowProduction: false,
    project: null,
    pageSize: PAGE_SIZE_DEFAULT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--dry-run') args.execute = false;
    else if (a === '--allow-production') args.allowProduction = true;
    else if (a === '--project') { args.project = argv[++i]; }
    else if (a === '--page-size') { args.pageSize = parseInt(argv[++i], 10) || PAGE_SIZE_DEFAULT; }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else throw new Error('Argument inconnu : ' + a + ' (voir --help)');
  }
  return args;
}

function _printHelp() {
  console.log([
    'Migration des PIN existants vers users_private (additive, idempotente).',
    '',
    'Options :',
    '  --dry-run            Simule sans écrire (par défaut)',
    '  --execute            Écrit réellement (nécessite --allow-production hors émulateur)',
    '  --allow-production   Autorise --execute hors émulateur (JAMAIS depuis cette session)',
    '  --project <id>       Force le project id (sinon GCLOUD_PROJECT ou défaut des credentials)',
    '  --page-size <n>      Taille de page de lecture (défaut ' + PAGE_SIZE_DEFAULT + ')',
    '  --help               Affiche cette aide',
  ].join('\n'));
}

// Journalisation centralisée — AUCUNE fonction de ce fichier ne doit
// jamais passer un champ `pin` (hash ou clair) à _log(). Les sites qui
// lisent userData.pin le stockent dans une variable locale (ex. `pinVal`)
// qui n'est JAMAIS interpolée dans une chaîne de log, uniquement inspectée
// (typeof, longueur de chaîne non loggée non plus, vide/non-vide).
function _log(msg) { console.log('[migrate-pins] ' + msg); }
function _warn(msg) { console.warn('[migrate-pins] ⚠ ' + msg); }
function _err(msg) { console.error('[migrate-pins] ✖ ' + msg); }

// ── PRÉCONDITIONS ──
// Retourne null si tout est en ordre, ou une chaîne expliquant pourquoi la
// migration doit s'arrêter AVANT toute lecture/écriture.
async function _checkPreconditions(args, db) {
  const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (args.execute && !isEmulator && !args.allowProduction) {
    return 'Cible non-émulateur détectée (FIRESTORE_EMULATOR_HOST absent) et --execute demandé ' +
      'sans --allow-production. Ce script ne doit JAMAIS modifier une base de production sans ' +
      'une autorisation explicite et séparée — arrêt avant toute écriture.';
  }
  if (!process.env.GCLOUD_PROJECT && !args.project && !isEmulator) {
    return 'Aucun project id déterminable (ni --project, ni GCLOUD_PROJECT) hors émulateur — ' +
      'arrêt pour éviter de cibler un projet par défaut non voulu.';
  }
  // Connectivité minimale : une lecture bon marché doit réussir avant de
  // se lancer dans une migration potentiellement longue. Elle a aussi pour
  // effet de garantir que le client Firestore est prêt (db.projectId lève
  // une erreur interne s'il est lu avant la première requête), ce qui
  // permet la vérification du project id juste après, en toute sécurité.
  try {
    await db.collection('users').limit(1).get();
  } catch (e) {
    return 'Lecture de test sur la collection "users" impossible (' + (e.message || e) + ') — ' +
      'arrêt avant toute migration (accès/réseau/projet incorrect ?).';
  }

  // Project id RÉELLEMENT utilisé par le SDK Admin pour cette session —
  // affiché systématiquement (dry-run ou exécution réelle), avant toute
  // opération de migration proprement dite, pour qu'il soit impossible de
  // cibler le mauvais projet sans s'en apercevoir.
  let resolvedProjectId;
  try {
    resolvedProjectId = db.projectId;
  } catch (e) {
    resolvedProjectId = args.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null;
  }
  _log('Projet Firebase ciblé : ' + (resolvedProjectId || '(indéterminé)') + (isEmulator ? '  [ÉMULATEUR]' : '  [PRODUCTION]'));

  // Hors émulateur, seul le projet de production Maintix attendu est
  // autorisé — refus avant toute opération si un autre projet est ciblé
  // (ex. mauvaise variable d'environnement, mauvais --project), qu'il
  // s'agisse d'un dry-run ou d'une exécution réelle : un dry-run contre le
  // mauvais projet produirait de toute façon un bilan trompeur, pas
  // seulement un risque d'écriture.
  if (!isEmulator && resolvedProjectId !== EXPECTED_PRODUCTION_PROJECT_ID) {
    return 'Projet Firebase ciblé ("' + (resolvedProjectId || '(indéterminé)') + '") différent du seul ' +
      'projet de production autorisé pour ce script ("' + EXPECTED_PRODUCTION_PROJECT_ID + '") — arrêt ' +
      'avant toute opération, pour éviter de migrer (même en dry-run) le mauvais projet Firebase.';
  }

  return null;
}

// ── CŒUR DE LA MIGRATION ──
// Traite un utilisateur : retourne une catégorie parmi
//   'migrated' | 'skipped-already-migrated' | 'skipped-no-pin' | 'error'
// Ne journalise jamais la valeur de pin — seulement userId et le résultat.
async function _migrateOneUser(db, userId, userData, dryRun) {
  const pinVal = userData ? userData.pin : undefined;

  if (pinVal === undefined || pinVal === null || pinVal === '') {
    return { userId, category: 'skipped-no-pin' };
  }
  if (typeof pinVal !== 'string') {
    // Donnée anormale (ni absente, ni chaîne) : signalée comme erreur pour
    // investigation manuelle plutôt que silencieusement ignorée ou migrée
    // à l'aveugle. Le TYPE est loggé, jamais la valeur elle-même.
    return { userId, category: 'error', errorMessage: 'champ pin de type inattendu (' + typeof pinVal + ', ni absent ni chaîne)' };
  }

  if (dryRun) {
    // En dry-run, on ne sait pas avec certitude si users_private contient
    // déjà un pin (on pourrait le lire, mais ne JAMAIS écrire) — on lit
    // quand même pour que le bilan dry-run soit fidèle à ce qu'un run réel
    // ferait.
    const privSnap = await db.collection('users_private').doc(userId).get();
    const already = privSnap.exists && !!(privSnap.data() || {}).pin;
    return { userId, category: already ? 'skipped-already-migrated' : 'migrated-dry-run' };
  }

  // Exécution réelle : lecture + décision + écriture dans UNE SEULE
  // transaction, pour ne jamais écraser un pin déjà présent même si une
  // réinitialisation Admin ou un changement self-service concurrent a lieu
  // pendant la migration (même principe que _recordPinAttempt dans
  // functions/index.js — voir le rapport de la passe précédente).
  const privRef = db.collection('users_private').doc(userId);
  const outcome = await db.runTransaction(async (tx) => {
    const privSnap = await tx.get(privRef);
    const existingPin = privSnap.exists ? (privSnap.data() || {}).pin : undefined;
    if (existingPin) return 'skipped-already-migrated'; // jamais écrasé
    tx.set(privRef, { pin: pinVal }, { merge: true });
    return 'migrated';
  });
  return { userId, category: outcome };
}

// Liste paginée de users/{id} — ne retourne que {id, data}, jamais exposé
// au-delà de cette fonction sans filtrage (le champ pin reste dans `data`
// mais n'est jamais loggé par l'appelant, voir _migrateOneUser).
async function* _paginateUsers(db, pageSize) {
  let last = null;
  for (;;) {
    let q = db.collection('users').orderBy('__name__').limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const doc of snap.docs) yield { id: doc.id, data: doc.data() };
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < pageSize) return;
  }
}

// ── VÉRIFICATION FINALE DE COUVERTURE ──
// Recompte, après migration, combien de comptes ayant un pin (chaîne) dans
// users/{id} ont bien un pin non vide dans users_private/{id}. Jamais 100%
// si des erreurs ont eu lieu (volontairement : une donnée anormale n'est
// jamais migrée à l'aveugle, voir _migrateOneUser).
async function _checkCoverage(db, pageSize) {
  let candidates = 0; // users avec un pin (string, non vide) dans users/{id}
  let covered = 0;    // parmi eux, combien ont déjà un pin dans users_private/{id}
  for await (const { id, data } of _paginateUsers(db, pageSize)) {
    const pinVal = data ? data.pin : undefined;
    if (typeof pinVal === 'string' && pinVal !== '') {
      candidates++;
      const privSnap = await db.collection('users_private').doc(id).get();
      if (privSnap.exists && !!(privSnap.data() || {}).pin) covered++;
    }
  }
  return { candidates, covered };
}

// ── POINT D'ENTRÉE RÉUTILISABLE (testé directement par
// tests/migrate_pins_test.js, sans passer par le CLI) ──
async function runMigration(opts) {
  const db = opts.db;
  const dryRun = opts.dryRun !== false; // dry-run par défaut, cohérent avec le CLI
  const pageSize = opts.pageSize || PAGE_SIZE_DEFAULT;
  const log = opts.log || _log;

  log((dryRun ? '[DRY-RUN] ' : '[EXÉCUTION] ') + 'Démarrage de la migration PIN -> users_private.');

  const summary = {
    dryRun,
    migrated: [],
    skippedAlreadyMigrated: [],
    skippedNoPin: [],
    errors: [], // [{ userId, errorMessage }]
    totalScanned: 0,
  };

  for await (const { id, data } of _paginateUsers(db, pageSize)) {
    summary.totalScanned++;
    let result;
    try {
      result = await _migrateOneUser(db, id, data, dryRun);
    } catch (e) {
      // Erreur inattendue (réseau, doc invalide, etc.) sur CET utilisateur
      // uniquement — ne jamais interrompre la migration des autres pour
      // une seule anomalie.
      result = { userId: id, category: 'error', errorMessage: (e && e.message) || String(e) };
    }
    switch (result.category) {
      case 'migrated':
      case 'migrated-dry-run':
        summary.migrated.push(result.userId);
        break;
      case 'skipped-already-migrated':
        summary.skippedAlreadyMigrated.push(result.userId);
        break;
      case 'skipped-no-pin':
        summary.skippedNoPin.push(result.userId);
        break;
      case 'error':
        summary.errors.push({ userId: result.userId, errorMessage: result.errorMessage });
        _warn('Utilisateur ' + result.userId + ' : ' + result.errorMessage);
        break;
      default:
        summary.errors.push({ userId: result.userId, errorMessage: 'catégorie de résultat inconnue' });
    }
  }

  // Vérification finale de couverture — toujours exécutée, même en
  // dry-run (lecture seule, donc sans risque), pour que le bilan affiché
  // reflète fidèlement l'état réel de la base à cet instant.
  summary.coverage = await _checkCoverage(db, pageSize);

  log('--- BILAN ---');
  log('Comptes scannés          : ' + summary.totalScanned);
  log((dryRun ? 'Seraient migrés (dry-run): ' : 'Migrés                  : ') + summary.migrated.length);
  log('Déjà migrés (ignorés)    : ' + summary.skippedAlreadyMigrated.length);
  log('Sans PIN (ignorés)       : ' + summary.skippedNoPin.length);
  log('Erreurs                  : ' + summary.errors.length);
  log('Couverture (users_private/users avec un pin) : ' + summary.coverage.covered + '/' + summary.coverage.candidates);
  if (summary.errors.length > 0) {
    _warn(summary.errors.length + ' compte(s) en erreur — couverture incomplète, à examiner avant toute mise en production.');
  }
  if (!dryRun && summary.coverage.candidates > 0 && summary.coverage.covered < summary.coverage.candidates) {
    _warn('Couverture incomplète après exécution réelle — ne pas considérer la migration comme terminée.');
  }

  return summary;
}

async function main() {
  const args = _parseArgs(process.argv.slice(2));
  if (args.help) { _printHelp(); return; }

  const admin = _loadFirebaseAdmin();
  if (args.project) process.env.GCLOUD_PROJECT = args.project;
  if (admin.apps.length === 0) admin.initializeApp();
  const db = admin.firestore();

  const precondFailure = await _checkPreconditions(args, db);
  if (precondFailure) {
    _err('Précondition non satisfaite — ARRÊT avant toute opération : ' + precondFailure);
    process.exitCode = 2;
    return;
  }

  const summary = await runMigration({ db, dryRun: !args.execute, pageSize: args.pageSize, log: _log });
  process.exitCode = summary.errors.length > 0 ? 1 : 0;
}

module.exports = { runMigration, _migrateOneUser, _checkCoverage, _checkPreconditions, _parseArgs };

if (require.main === module) {
  main().catch((e) => { _err('ERREUR FATALE : ' + ((e && e.message) || e)); process.exitCode = 1; });
}
