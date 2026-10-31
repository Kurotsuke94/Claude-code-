// Tests pour scripts/migrate-pins-to-private.js — exécutés contre un
// véritable émulateur Firestore (Admin SDK), jamais un mock. Données
// entièrement factices (identifiants tech-test-*), aucune donnée réelle.
//
//   npx firebase emulators:exec --only firestore --project maintix-rules-test \
//     "node tests/migrate_pins_test.js"
//
// Couvre les scénarios demandés : exécution initiale, seconde exécution
// idempotente, document privé déjà présent, utilisateur sans PIN, erreur
// partielle, vérification de couverture, et absence de toute donnée
// sensible dans les journaux produits.
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');
const { runMigration, _checkPreconditions, _parseArgs } = require(path.join(__dirname, '..', 'scripts', 'migrate-pins-to-private.js'));

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

(async () => {
  process.chdir(FUNCTIONS_DIR);
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8090';
  process.env.GCLOUD_PROJECT = 'maintix-rules-test';

  const adminSdk = require(path.join(FUNCTIONS_DIR, 'node_modules', 'firebase-admin'));
  if (adminSdk.apps.length === 0) adminSdk.initializeApp();
  const db = adminSdk.firestore();

  // ── Collecte des journaux pour la vérification "aucune donnée sensible" ──
  // Toutes les valeurs de PIN factices utilisées dans ce test sont des
  // chaînes RECONNAISSABLES ('hashU1', 'hashU2', 'hashU6-existant') pour
  // pouvoir prouver leur absence dans les journaux de façon fiable.
  const capturedLogs = [];
  const capturingLog = (msg) => { capturedLogs.push(String(msg)); };

  // ── Préconditions ── un appel --execute sans émulateur doit s'arrêter
  // avant toute opération (re-vérifié ici, en plus du test manuel déjà
  // fait lors de l'implémentation).
  console.log('\n--- 0. Préconditions ---');
  {
    const prevHost = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    const args = _parseArgs(['--execute', '--project', 'maintix-rules-test']);
    const failure = await _checkPreconditions(args, db);
    process.env.FIRESTORE_EMULATOR_HOST = prevHost;
    ok('0.1 --execute sans émulateur ET sans --allow-production est refusé avant toute opération', !!failure);
  }
  {
    const args = _parseArgs(['--dry-run', '--project', 'maintix-rules-test']);
    const failure = await _checkPreconditions(args, db);
    ok('0.2 Les préconditions passent normalement sous l\'émulateur (dry-run)', failure === null);
  }

  // ── Jeu de données factices ──
  const U1 = 'migtest-u1', U2 = 'migtest-u2', U3_NOPIN = 'migtest-u3-nopin',
    U4_EMPTY = 'migtest-u4-empty', U5_BADTYPE = 'migtest-u5-badtype', U6_ALREADY = 'migtest-u6-already';
  const HASH_U1 = 'hashU1-FAKE', HASH_U2 = 'hashU2-FAKE', HASH_U6_EXISTING = 'hashU6-existant-FAKE';

  await db.collection('users').doc(U1).set({ name: 'U1', role: 'technicien', pin: HASH_U1 });
  await db.collection('users').doc(U2).set({ name: 'U2', role: 'technicien', pin: HASH_U2 });
  await db.collection('users').doc(U3_NOPIN).set({ name: 'U3', role: 'technicien' }); // pas de champ pin du tout
  await db.collection('users').doc(U4_EMPTY).set({ name: 'U4', role: 'technicien', pin: '' }); // pin vide
  await db.collection('users').doc(U5_BADTYPE).set({ name: 'U5', role: 'technicien', pin: 123456 }); // type anormal
  await db.collection('users').doc(U6_ALREADY).set({ name: 'U6', role: 'technicien', pin: 'hashU6-nouveau-FAKE' });
  await db.collection('users_private').doc(U6_ALREADY).set({ pin: HASH_U6_EXISTING }); // déjà migré avant ce run

  // Nettoyage des éventuels résidus d'un run de test précédent sur U1/U2
  // (idempotence du TEST lui-même, pas seulement du script).
  await db.collection('users_private').doc(U1).delete().catch(() => {});
  await db.collection('users_private').doc(U2).delete().catch(() => {});

  console.log('\n--- 1. Exécution DRY-RUN initiale (aucune écriture) ---');
  const dryRunSummary = await runMigration({ db, dryRun: true, log: capturingLog });
  ok('1.1 Dry-run : U1 et U2 seraient migrés', dryRunSummary.migrated.includes(U1) && dryRunSummary.migrated.includes(U2));
  ok('1.2 Dry-run : U3 (sans pin) et U4 (pin vide) ignorés', dryRunSummary.skippedNoPin.includes(U3_NOPIN) && dryRunSummary.skippedNoPin.includes(U4_EMPTY));
  ok('1.3 Dry-run : U5 (type anormal) signalé en erreur', dryRunSummary.errors.some((e) => e.userId === U5_BADTYPE));
  ok('1.4 Dry-run : U6 (déjà migré) reconnu comme déjà présent, pas remigré', dryRunSummary.skippedAlreadyMigrated.includes(U6_ALREADY));
  const privU1AfterDryRun = await db.collection('users_private').doc(U1).get();
  ok('1.5 Dry-run : AUCUNE écriture réelle (users_private/U1 toujours absent après le dry-run)', !privU1AfterDryRun.exists);
  const privU6AfterDryRun = await db.collection('users_private').doc(U6_ALREADY).get();
  ok('1.6 Dry-run : le pin déjà présent de U6 n\'a pas été touché', privU6AfterDryRun.data().pin === HASH_U6_EXISTING);

  console.log('\n--- 2. Exécution RÉELLE initiale ---');
  const execSummary1 = await runMigration({ db, dryRun: false, log: capturingLog });
  ok('2.1 U1 et U2 migrés', execSummary1.migrated.includes(U1) && execSummary1.migrated.includes(U2));
  const privU1 = await db.collection('users_private').doc(U1).get();
  const privU2 = await db.collection('users_private').doc(U2).get();
  ok('2.2 users_private/U1.pin correspond bien au hash de users/U1.pin', privU1.exists && privU1.data().pin === HASH_U1);
  ok('2.3 users_private/U2.pin correspond bien au hash de users/U2.pin', privU2.exists && privU2.data().pin === HASH_U2);
  ok('2.4 U3/U4 toujours ignorés (sans pin exploitable)', execSummary1.skippedNoPin.includes(U3_NOPIN) && execSummary1.skippedNoPin.includes(U4_EMPTY));
  ok('2.5 U5 toujours en erreur (type anormal), AUCUN document créé pour lui', execSummary1.errors.some((e) => e.userId === U5_BADTYPE));
  const privU5 = await db.collection('users_private').doc(U5_BADTYPE).get();
  ok('2.6 users_private/U5 n\'existe PAS (une donnée anormale n\'est jamais migrée à l\'aveugle)', !privU5.exists);
  const usersU5AfterRun = await db.collection('users').doc(U5_BADTYPE).get();
  ok('2.7 users/U5.pin est resté EXACTEMENT inchangé (jamais modifié, même en cas d\'erreur sur ce compte)', usersU5AfterRun.data().pin === 123456);

  console.log('\n--- 3. users/{id}.pin JAMAIS modifié ni supprimé (pour tous les comptes) ---');
  const u1AfterMigration = await db.collection('users').doc(U1).get();
  const u2AfterMigration = await db.collection('users').doc(U2).get();
  ok('3.1 users/U1.pin inchangé après migration (toujours présent, valeur identique)', u1AfterMigration.data().pin === HASH_U1);
  ok('3.2 users/U2.pin inchangé après migration (toujours présent, valeur identique)', u2AfterMigration.data().pin === HASH_U2);

  console.log('\n--- 4. Document privé DÉJÀ PRÉSENT : jamais écrasé (additif, idempotent) ---');
  const privU6AfterExec = await db.collection('users_private').doc(U6_ALREADY).get();
  ok('4.1 users_private/U6.pin reste la valeur PRÉ-EXISTANTE, jamais remplacée par le nouveau pin de users/U6', privU6AfterExec.data().pin === HASH_U6_EXISTING);

  console.log('\n--- 5. Seconde exécution : IDEMPOTENCE ---');
  const execSummary2 = await runMigration({ db, dryRun: false, log: capturingLog });
  ok('5.1 Aucun nouveau compte migré au second passage (U1/U2 déjà migrés)', execSummary2.migrated.length === 0);
  ok('5.2 U1/U2/U6 reconnus "déjà migrés" cette fois', ['migtest-u1','migtest-u2','migtest-u6-already'].every((id) => execSummary2.skippedAlreadyMigrated.includes(id)));
  const privU1AfterSecondRun = await db.collection('users_private').doc(U1).get();
  ok('5.3 users_private/U1.pin inchangé après le second passage (même valeur exacte)', privU1AfterSecondRun.data().pin === HASH_U1);
  ok('5.4 Le même compte U5 reste en erreur de façon stable (pas de comportement erratique entre deux runs)', execSummary2.errors.some((e) => e.userId === U5_BADTYPE));

  console.log('\n--- 6. Vérification finale de couverture ---');
  const coverage = execSummary2.coverage;
  // Candidats = comptes avec un pin de type string non vide parmi TOUTES
  // les données de la base émulée à cet instant (peut inclure des
  // documents d'autres tests exécutés dans la même session émulateur) —
  // on vérifie seulement que NOS comptes de test sont bien comptés.
  ok('6.1 La couverture inclut bien U1/U2/U6 comme candidats migrés (couverts)', coverage.covered >= 3 && coverage.candidates >= 3);
  ok('6.2 Le résumé final signale explicitement l\'erreur restante (U5) malgré une couverture par ailleurs correcte', execSummary2.errors.length >= 1);

  console.log('\n--- 7. Aucune donnée sensible dans les journaux produits ---');
  const allLogs = capturedLogs.join('\n');
  const leaked = [HASH_U1, HASH_U2, HASH_U6_EXISTING, 'hashU6-nouveau-FAKE'].filter((secret) => allLogs.includes(secret));
  ok('7.1 Aucune valeur de PIN/hash factice n\'apparaît dans les journaux capturés', leaked.length === 0);
  if (leaked.length) console.error('   → fuite détectée pour : ' + leaked.join(', '));
  ok('7.2 Des journaux ont bien été produits (le test vérifie une liste non vide, pas une absence totale de logs)', capturedLogs.length > 0);

  console.log('\n' + (failures === 0
    ? 'Tous les tests du script de migration PIN passent.'
    : failures + ' test(s) EN ÉCHEC.'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR FATALE DU SCRIPT :', e); process.exit(1); });
