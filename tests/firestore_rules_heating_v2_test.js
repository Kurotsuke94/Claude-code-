// Vérification RÉELLE (émulateur Firestore) des règles AJOUTÉES par la
// REFONTE CTA/VC (v2, quantitatif) dans firestore.rules.draft-claims-
// migration — BROUILLON, jamais déployé. Même méthode et même fichier de
// règles que tests/firestore_rules_cta_vc_claims_test.js (qui couvre déjà
// le modèle v1) ; ce fichier est volontairement SÉPARÉ pour ne couvrir que
// les ajouts de cette refonte, sans alourdir le fichier existant :
//   1. config/heating_config — lecture tout rôle vérifié, écriture
//      Responsable/Admin seulement (jamais Technicien, jamais Admin
//      Firebase "de base" via le bloc générique /config/{docId}, qui
//      exige isAdmin() — un Responsable PIN n'est PAS isAdmin()).
//   2. heating_circuits — validation des nouveaux champs optionnels
//      (buildingId, vcMaxTemp <= 50, ctaRangeMin/Max).
//   3. heating_readings — forme à 2 points (points.point1/point2),
//      coexistant avec l'ancienne forme à 1 point (temp).
//   4. heating_recommendations — création v2 (proposition_generee +
//      engineVersion:'v2' uniquement), et le cycle à 5 états strict :
//      décision (Responsable/Admin) vs action physique (tout rôle vérifié,
//      machine à états, jamais de saut d'état, jamais de champ en trop).
//
// Exécution (même émulateur que les autres suites de règles) :
//   node tests/firestore_rules_heating_v2_test.js   (émulateur déjà démarré)
// ou : npx firebase emulators:exec --only firestore --project maintix-rules-test \
//        "node tests/firestore_rules_heating_v2_test.js"
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

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
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8090 },
  });

  const admin = testEnv.authenticatedContext('v2-admin-uid', { email: 'admin@maintix.local', firebase: { sign_in_provider: 'password' } });
  const responsable = testEnv.authenticatedContext('v2-pinuser-resp1', { firebase: { sign_in_provider: 'custom' }, role: 'responsable', userId: 'v2resp1' });
  const technicien = testEnv.authenticatedContext('v2-pinuser-tech1', { firebase: { sign_in_provider: 'custom' }, role: 'technicien', userId: 'v2tech1' });
  const anonyme = testEnv.authenticatedContext('v2-anon-uid', { firebase: { sign_in_provider: 'anonymous' } });

  const SV = { __type__: 'serverTimestamp' }; // placeholder — remplacé par les helpers withSecurityRulesDisabled ci-dessous si besoin
  // request.time lors d'une écriture réelle depuis le SDK client correspond
  // à un FieldValue.serverTimestamp() — reproduit ici en import direct pour
  // rester fidèle au test existant (voir firestore_rules_cta_vc_claims_test.js).
  const { serverTimestamp } = require('firebase/firestore');

  console.log('\n--- 1. config/heating_config : écriture Responsable/Admin, lecture tout rôle vérifié ---');
  await check('1.1 Responsable PEUT écrire config/heating_config', () =>
    assertSucceeds(responsable.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 18 })));
  await check('1.2 Admin PEUT écrire config/heating_config', () =>
    assertSucceeds(admin.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 19 })));
  await check('1.3 Technicien NE PEUT PAS écrire config/heating_config', () =>
    assertFails(technicien.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 10 })));
  await check('1.4 Technicien PEUT lire config/heating_config', () =>
    assertSucceeds(technicien.firestore().collection('config').doc('heating_config').get()));
  await check('1.5 Non authentifié NE PEUT PAS écrire config/heating_config', () =>
    assertFails(anonyme.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 10 })));

  console.log('\n--- 1b. PASSE DE FIABILISATION — config/heating_config : validation serveur complète des 6 champs ---');
  await check('1b.1 Les 6 champs valides, ensemble, sont acceptés', () =>
    assertSucceeds(responsable.firestore().collection('config').doc('heating_config').set({
      djuBaseTemp: 18, ctaRangeMin: 18, ctaRangeMax: 22, vcMaxTemp: 48, ctaWaterTempMin: 35, ctaWaterTempMax: 60,
    })));
  await check('1b.2 djuBaseTemp non-numérique (chaîne) refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: '18' })));
  await check('1b.3 djuBaseTemp hors bornes (0, non strictement positif) refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 0 })));
  await check('1b.4 djuBaseTemp hors bornes (50, au-delà de 30°C) refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 50 })));
  await check('1b.5 vcMaxTemp au-delà de 50°C refusé (plafond physique, même ici)', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ vcMaxTemp: 55 })));
  await check('1b.6 ctaWaterTempMax hors bornes (150°C) refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ ctaWaterTempMax: 150 })));
  await check('1b.7 ctaWaterTempMin négatif refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ ctaWaterTempMin: -5 })));
  await check('1b.8 Bornes incohérentes : ctaRangeMin >= ctaRangeMax refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ ctaRangeMin: 22, ctaRangeMax: 18 })));
  await check('1b.9 Bornes incohérentes : ctaWaterTempMin >= ctaWaterTempMax refusé', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ ctaWaterTempMin: 60, ctaWaterTempMax: 35 })));
  await check('1b.10 Bornes égales (min == max) également refusées (plage vide, jamais acceptée)', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ ctaRangeMin: 20, ctaRangeMax: 20 })));
  await check('1b.11 Champ inconnu/arbitraire refusé (hasOnly — pas de porte dérobée dans ce document partagé)', () =>
    assertFails(responsable.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 18, injectedField: 'x' })));
  await check('1b.12 Un seul champ fourni (les autres restent optionnels/absents) accepté', () =>
    assertSucceeds(responsable.firestore().collection('config').doc('heating_config').set({ ctaWaterTempMin: 35 })));
  await check('1b.13 Valeur explicitement null acceptée (réglage effacé, jamais une erreur)', () =>
    assertSucceeds(responsable.firestore().collection('config').doc('heating_config').set({ vcMaxTemp: null })));
  await check('1b.14 Admin soumis aux MÊMES bornes que Responsable (pas de passe-droit)', () =>
    assertFails(admin.firestore().collection('config').doc('heating_config').set({ djuBaseTemp: 99 })));

  console.log('\n--- 2. heating_circuits : validation des nouveaux champs optionnels ---');
  // CONFIGURATION THERMIQUE : buildingId est désormais une VRAIE référence
  // vers heating_buildings/{id} (créé depuis l'interface), plus un
  // énumérable codé en dur — seule la FORME (chaîne non vide, ou null) est
  // validée ici par la règle (voir son commentaire). L'existence réelle du
  // bâtiment est vérifiée côté moteur (MX.HeatingEngine.proposeQuantitative),
  // pas ici.
  await check('2.1 buildingId valide (n\'importe quel id de bâtiment réel) accepté', () =>
    assertSucceeds(responsable.firestore().collection('heating_circuits').doc('v2circ1').set({ name: 'VC Est', buildingId: 'un-id-de-batiment-reel' })));
  await check('2.2 buildingId vide (chaîne vide, jamais une référence valide) refusé', () =>
    assertFails(responsable.firestore().collection('heating_circuits').doc('v2circ2').set({ name: 'VC X', buildingId: '' })));
  await check('2.3 buildingId null (non assigné) accepté', () =>
    assertSucceeds(responsable.firestore().collection('heating_circuits').doc('v2circ3').set({ name: 'VC Y', buildingId: null })));
  await check('2.4 vcMaxTemp <= 50 accepté', () =>
    assertSucceeds(responsable.firestore().collection('heating_circuits').doc('v2circ4').set({ name: 'VC Nord', type: 'vc', vcMaxTemp: 48 })));
  await check('2.5 vcMaxTemp > 50 REFUSÉ (plafond de sécurité, défense en profondeur)', () =>
    assertFails(responsable.firestore().collection('heating_circuits').doc('v2circ5').set({ name: 'VC Sud', type: 'vc', vcMaxTemp: 65 })));
  await check('2.6 ctaRangeMin/Max dans [0,30] acceptés', () =>
    assertSucceeds(responsable.firestore().collection('heating_circuits').doc('v2circ6').set({ name: 'CTA 1', type: 'cta', ctaRangeMin: 18, ctaRangeMax: 22 })));
  await check('2.7 ctaRangeMax hors bornes (40) refusé', () =>
    assertFails(responsable.firestore().collection('heating_circuits').doc('v2circ7').set({ name: 'CTA 2', type: 'cta', ctaRangeMax: 40 })));
  await check('2.8 Technicien ne peut toujours pas gérer de circuit (non-régression)', () =>
    assertFails(technicien.firestore().collection('heating_circuits').doc('v2circ8').set({ name: 'CTA 3', buildingId: 'batiment_1' })));

  console.log('\n--- 3. heating_readings : coexistence forme 1 point (legacy) / 2 points (v2) ---');
  await check('3.1 Ancienne forme (temp) toujours acceptée (non-régression)', () =>
    assertSucceeds(technicien.firestore().collection('heating_readings').doc('v2read1').set({ circuitId: 'v2circ1', temp: 19.5, createdAt: serverTimestamp() })));
  await check('3.2 Nouvelle forme à 2 points valide acceptée', () =>
    assertSucceeds(technicien.firestore().collection('heating_readings').doc('v2read2').set({
      circuitId: 'v2circ1',
      points: { point1: { waterTemp: 45, blowTemp: 40, ambientTemp: 19 }, point2: { waterTemp: 46, blowTemp: 41, ambientTemp: 20 } },
      createdAt: serverTimestamp(),
    })));
  await check('3.3 Point 2 incomplet (champ manquant) refusé', () =>
    assertFails(technicien.firestore().collection('heating_readings').doc('v2read3').set({
      circuitId: 'v2circ1',
      points: { point1: { waterTemp: 45, blowTemp: 40, ambientTemp: 19 }, point2: { waterTemp: 46, blowTemp: 41 } },
      createdAt: serverTimestamp(),
    })));
  await check('3.4 Ni temp ni points présents : refusé', () =>
    assertFails(technicien.firestore().collection('heating_readings').doc('v2read4').set({ circuitId: 'v2circ1', createdAt: serverTimestamp() })));
  await check('3.5 points présent mais hors bornes physiques (soufflage 500°C) refusé', () =>
    assertFails(technicien.firestore().collection('heating_readings').doc('v2read5').set({
      circuitId: 'v2circ1',
      points: { point1: { waterTemp: 45, blowTemp: 500, ambientTemp: 19 }, point2: { waterTemp: 46, blowTemp: 41, ambientTemp: 20 } },
      createdAt: serverTimestamp(),
    })));

  console.log('\n--- 4. heating_recommendations : création v2 (proposition_generee) ---');
  await check('4.1 Création proposition_generee + engineVersion:v2 acceptée', () =>
    assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('v2prop1').set({
      circuitId: 'v2circ1', status: 'proposition_generee', engineVersion: 'v2', createdAt: serverTimestamp(),
    })));
  await check('4.2 Création proposition_generee SANS engineVersion:v2 refusée (contournement)', () =>
    assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop2').set({
      circuitId: 'v2circ1', status: 'proposition_generee', createdAt: serverTimestamp(),
    })));
  await check('4.3 Création directe en statut "validee" (saut d\'état à la création) refusée', () =>
    assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop3').set({
      circuitId: 'v2circ1', status: 'validee', engineVersion: 'v2', createdAt: serverTimestamp(),
    })));

  console.log('\n--- 5. heating_recommendations : cycle de validation v2 — décision vs action physique ---');
  // v2prop1 créée ci-dessus en 'proposition_generee'.
  await check('5.1 Technicien NE PEUT PAS valider une proposition (décision réservée Responsable/Admin)', () =>
    assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop1').update({ status: 'validee', validatedAt: serverTimestamp(), validatedBy: 'x' })));
  await check('5.2 Responsable PEUT valider une proposition', () =>
    assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('v2prop1').update({ status: 'validee', validatedAt: serverTimestamp(), validatedBy: 'resp' })));
  await check('5.3 Technicien PEUT marquer le réglage effectué (action physique) après validation', () =>
    assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('v2prop1').update({ status: 'reglage_effectue', appliedAt: serverTimestamp(), appliedBy: 'tech', appliedValue: 46 })));
  await check('5.4 Technicien PEUT confirmer la consigne réelle', () =>
    assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('v2prop1').update({ status: 'consigne_confirmee', confirmedAt: serverTimestamp(), confirmedBy: 'tech', confirmedValue: 46 })));
  await check('5.5 Technicien PEUT lier un relevé de contrôle (contrôle effectué)', () =>
    assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('v2prop1').update({ status: 'controle_effectue', controlledAt: serverTimestamp(), controlledBy: 'tech', controlReadingId: 'v2read2' })));
  await check('5.6 Statut terminal : plus aucune transition acceptée depuis "controle_effectue"', () =>
    assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop1').update({ status: 'validee' })));

  console.log('\n--- 6. heating_recommendations : machine à états stricte (jamais de saut, jamais de champ en trop) ---');
  await check('6.1 Préparation : seconde proposition v2 "proposition_generee"', () =>
    assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('v2prop2b').set({
      circuitId: 'v2circ1', status: 'proposition_generee', engineVersion: 'v2', createdAt: serverTimestamp(),
    })));
  await check('6.2 Technicien NE PEUT PAS sauter directement à "reglage_effectue" sans validation', () =>
    assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop2b').update({ status: 'reglage_effectue', appliedAt: serverTimestamp(), appliedBy: 'tech' })));
  await check('6.3 Responsable valide la proposition', () =>
    assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('v2prop2b').update({ status: 'validee', validatedAt: serverTimestamp(), validatedBy: 'resp' })));
  await check('6.4 Technicien NE PEUT PAS modifier un champ hors de la liste autorisée pour cette transition (ex. priority en plus)', () =>
    assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop2b').update({ status: 'reglage_effectue', appliedAt: serverTimestamp(), appliedBy: 'tech', priority: 'haute' })));
  await check('6.5 Responsable/Admin PEUT refuser une proposition encore "proposition_generee"', async () => {
    await responsable.firestore().collection('heating_recommendations').doc('v2prop4').set({ circuitId: 'v2circ1', status: 'proposition_generee', engineVersion: 'v2', createdAt: serverTimestamp() });
    await assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('v2prop4').update({ status: 'refusee', decidedAt: serverTimestamp(), decidedBy: 'resp' }));
  });
  await check('6.6 Responsable/Admin PEUT reporter une proposition encore "proposition_generee"', async () => {
    await responsable.firestore().collection('heating_recommendations').doc('v2prop5').set({ circuitId: 'v2circ1', status: 'proposition_generee', engineVersion: 'v2', createdAt: serverTimestamp() });
    await assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('v2prop5').update({ status: 'reportee', reportedAt: serverTimestamp(), reportedBy: 'resp', reportedUntil: '2026-02-01' }));
  });
  await check('6.7 Technicien NE PEUT PAS refuser une proposition (décision réservée Responsable/Admin)', async () => {
    await responsable.firestore().collection('heating_recommendations').doc('v2prop6').set({ circuitId: 'v2circ1', status: 'proposition_generee', engineVersion: 'v2', createdAt: serverTimestamp() });
    await assertFails(technicien.firestore().collection('heating_recommendations').doc('v2prop6').update({ status: 'refusee', decidedAt: serverTimestamp(), decidedBy: 'tech' }));
  });

  console.log('\n--- 7. Non-régression : le cycle v1 (a_examiner/acceptee/refusee/appliquee) reste inchangé ---');
  await check('7.1 Création v1 "a_examiner" toujours acceptée', () =>
    assertSucceeds(technicien.firestore().collection('heating_recommendations').doc('v2v1reco1').set({
      circuitId: 'v2circ1', status: 'a_examiner', createdAt: serverTimestamp(),
    })));
  await check('7.2 Responsable PEUT toujours accepter une recommandation v1', () =>
    assertSucceeds(responsable.firestore().collection('heating_recommendations').doc('v2v1reco1').update({ status: 'acceptee', decidedAt: serverTimestamp(), decidedBy: 'resp' })));

  console.log('\n--- 8. heating_circuits : limites eau de batterie (waterTempMin/Max), INDÉPENDANTES de la plage de soufflage ---');
  await check('8.1 waterTempMin/Max valides acceptés', () =>
    assertSucceeds(responsable.firestore().collection('heating_circuits').doc('v2circ10').set({ name: 'CTA Batterie', type: 'cta', waterTempMin: 35, waterTempMax: 60 })));
  await check('8.2 waterTempMax hors bornes (150°C) refusé', () =>
    assertFails(responsable.firestore().collection('heating_circuits').doc('v2circ11').set({ name: 'CTA Batterie 2', type: 'cta', waterTempMax: 150 })));

  console.log('\n--- 8b. CORRECTION PRIORITAIRE — heating_circuits : tempMin/tempMax (limites générales de l\'installation) ---');
  await check('8b.1 tempMin/tempMax valides acceptés', () =>
    assertSucceeds(responsable.firestore().collection('heating_circuits').doc('v2circ12').set({ name: 'CTA Resserré', type: 'cta', tempMin: 10, tempMax: 20 })));
  await check('8b.2 tempMax hors bornes (150°C) refusé (revalidé côté serveur, pas seulement client)', () =>
    assertFails(responsable.firestore().collection('heating_circuits').doc('v2circ13').set({ name: 'CTA Resserré 2', type: 'cta', tempMax: 150 })));
  await check('8b.3 tempMin négatif refusé', () =>
    assertFails(responsable.firestore().collection('heating_circuits').doc('v2circ14').set({ name: 'CTA Resserré 3', type: 'cta', tempMin: -5 })));
  await check('8b.4 Technicien NE PEUT PAS créer d\'installation même avec tempMin/tempMax valides', () =>
    assertFails(technicien.firestore().collection('heating_circuits').doc('v2circ15').set({ name: 'CTA Tech', type: 'cta', tempMin: 10, tempMax: 20 })));

  console.log('\n--- 9. CONFIGURATION THERMIQUE — heating_buildings ---');
  await check('9.1 Responsable PEUT créer un bâtiment mode:manuel_assiste', () =>
    assertSucceeds(responsable.firestore().collection('heating_buildings').doc('bA').set({ name: 'Bâtiment A', mode: 'manuel_assiste' })));
  await check('9.2 Admin PEUT créer un bâtiment mode:automatique', () =>
    assertSucceeds(admin.firestore().collection('heating_buildings').doc('bB').set({ name: 'Bâtiment B', mode: 'automatique' })));
  await check('9.3 Technicien NE PEUT PAS créer de bâtiment', () =>
    assertFails(technicien.firestore().collection('heating_buildings').doc('bC').set({ name: 'Bâtiment C', mode: 'manuel_assiste' })));
  await check('9.4 Technicien PEUT lire les bâtiments', () =>
    assertSucceeds(technicien.firestore().collection('heating_buildings').doc('bA').get()));
  await check('9.5 Un mode hors de la liste autorisée est refusé (état ambigu dangereux)', () =>
    assertFails(responsable.firestore().collection('heating_buildings').doc('bD').set({ name: 'Bâtiment D', mode: 'semi-auto' })));

  console.log('\n--- 10. CONFIGURATION THERMIQUE — heating_rooms (gestion Responsable/Admin, lecture + relevé Technicien) ---');
  await check('10.1 Responsable PEUT créer une pièce', () =>
    assertSucceeds(responsable.firestore().collection('heating_rooms').doc('r1').set({ name: 'Chambre 101', buildingId: 'bA', trackedActive: true })));
  await check('10.2 Technicien NE PEUT PAS créer de pièce (configuration structurelle)', () =>
    assertFails(technicien.firestore().collection('heating_rooms').doc('r2').set({ name: 'Chambre 102', buildingId: 'bA' })));
  await check('10.3 Technicien PEUT lire les pièces (pour choisir la bonne pièce lors d\'un relevé)', () =>
    assertSucceeds(technicien.firestore().collection('heating_rooms').doc('r1').get()));
  await check('10.4 Technicien PEUT soumettre un relevé de température pour une pièce (roomId)', () =>
    assertSucceeds(technicien.firestore().collection('heating_readings').doc('rr1').set({ roomId: 'r1', temp: 20.5, createdAt: serverTimestamp() })));
  await check('10.5 Un relevé portant à la fois circuitId ET roomId est refusé (ambiguïté interdite)', () =>
    assertFails(technicien.firestore().collection('heating_readings').doc('rr2').set({ roomId: 'r1', circuitId: 'v2circ1', temp: 20.5, createdAt: serverTimestamp() })));
  await check('10.6 Un relevé de pièce avec "points" (réservé aux installations) est refusé', () =>
    assertFails(technicien.firestore().collection('heating_readings').doc('rr3').set({ roomId: 'r1', temp: 20.5, points: { point1: { waterTemp: 1, blowTemp: 1, ambientTemp: 1 }, point2: { waterTemp: 1, blowTemp: 1, ambientTemp: 1 } }, createdAt: serverTimestamp() })));

  console.log('\n--- 10b. PASSE DE FIABILISATION — relevé de PIÈCE : auteur jamais falsifiable (même garantie que pour un relevé d\'installation) ---');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc('v2tech1').set({ name: 'Jordan V2', role: 'technicien' });
  });
  await check('10b.1 Technicien NE PEUT PAS usurper un nom différent du sien pour un relevé de PIÈCE', () =>
    assertFails(technicien.firestore().collection('heating_readings').doc('rr-usurp').set({ roomId: 'r1', temp: 19, createdAt: serverTimestamp(), author: 'Quelqu\'un d\'autre' })));
  await check('10b.2 Technicien PEUT écrire SON PROPRE nom exact pour un relevé de pièce', () =>
    assertSucceeds(technicien.firestore().collection('heating_readings').doc('rr-legit').set({ roomId: 'r1', temp: 19, createdAt: serverTimestamp(), author: 'Jordan V2' })));

  console.log('\n--- 11. CONFIGURATION THERMIQUE — heating_curve_points (seule collection heating_* où delete est autorisé) ---');
  await check('11.1 Responsable PEUT créer un point de courbe', () =>
    assertSucceeds(responsable.firestore().collection('heating_curve_points').doc('cp1').set({ buildingId: 'bA', dju: 8, expectedIndoorTemp: 20 })));
  await check('11.2 Technicien NE PEUT PAS créer de point de courbe', () =>
    assertFails(technicien.firestore().collection('heating_curve_points').doc('cp2').set({ buildingId: 'bA', dju: 10, expectedIndoorTemp: 19 })));
  await check('11.3 Responsable PEUT supprimer un point de courbe (correction d\'une saisie erronée)', () =>
    assertSucceeds(responsable.firestore().collection('heating_curve_points').doc('cp1').delete()));
  await check('11.4 Technicien NE PEUT PAS supprimer un point de courbe', async () => {
    await responsable.firestore().collection('heating_curve_points').doc('cp3').set({ buildingId: 'bA', dju: 8, expectedIndoorTemp: 20 });
    await assertFails(technicien.firestore().collection('heating_curve_points').doc('cp3').delete());
  });

  console.log('\n--- 12. CONFIGURATION THERMIQUE — heating_config_audit (append-only, Responsable/Admin) ---');
  await check('12.1 Responsable PEUT écrire une entrée d\'audit valide', () =>
    assertSucceeds(responsable.firestore().collection('heating_config_audit').doc('a1').set({ entityType: 'building', entityId: 'bA', changes: { name: { old: 'X', new: 'Bâtiment A' } }, actor: 'resp', at: serverTimestamp() })));
  await check('12.2 Technicien NE PEUT PAS écrire dans le journal d\'audit', () =>
    assertFails(technicien.firestore().collection('heating_config_audit').doc('a2').set({ entityType: 'building', entityId: 'bA', actor: 'tech', at: serverTimestamp() })));
  await check('12.3 Une entrée d\'audit avec un entityType hors de la liste autorisée est refusée', () =>
    assertFails(responsable.firestore().collection('heating_config_audit').doc('a3').set({ entityType: 'inconnu', entityId: 'bA', actor: 'resp', at: serverTimestamp() })));
  await check('12.4 Aucune modification du journal d\'audit n\'est permise (append-only)', async () => {
    await assertFails(responsable.firestore().collection('heating_config_audit').doc('a1').update({ actor: 'triché' }));
  });
  await check('12.5 Technicien PEUT lire les bâtiments mais PAS le journal d\'audit', () =>
    assertFails(technicien.firestore().collection('heating_config_audit').doc('a1').get()));

  await testEnv.cleanup();
  console.log(failures
    ? ('\n' + failures + ' test(s) EN ÉCHEC.')
    : '\nTous les tests de règles Firestore REFONTE CTA/VC v2 (émulateur réel, brouillon claims) passent.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(1); });
