// Tests UNITAIRES purs (aucun navigateur, aucun émulateur) de la courbe
// thermique bâtiment — assets/js/utils/heating-engine.js:
// computeBuildingAverageTemp/interpolateCurve/analyzeCurveDeviation
// (CONFIGURATION THERMIQUE). Même idiome que tests/heating_engine_v2_test.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'utils', 'heating-engine.js'), 'utf8');
const sandbox = { window: {} };
// eslint-disable-next-line no-new-func
new Function('window', src)(sandbox.window);
const HE = sandbox.window.MX.HeatingEngine;

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

var now = Date.parse('2026-01-15T12:00:00Z');
function roomReading(roomId, temp, ageHours) { return { roomId: roomId, temp: temp, recordedAt: { toMillis: () => now - ageHours * 3600 * 1000 } }; }

console.log('--- 1. computeBuildingAverageTemp — moyenne des pièces SÉLECTIONNÉES uniquement ---');
{
  var rooms = [
    { id: 'r1', trackedActive: true, archived: false },
    { id: 'r2', trackedActive: true, archived: false },
    { id: 'r3', trackedActive: true, archived: false }, // existe mais PAS sélectionnée
  ];
  var readings = [roomReading('r1', 20, 1), roomReading('r2', 22, 2), roomReading('r3', 10, 1)]; // r3 = 10°C, ne doit JAMAIS influencer
  var res = HE.computeBuildingAverageTemp(['r1', 'r2'], rooms, readings, now, 24);
  ok('1.1 Moyenne correcte (20+22)/2=21, r3 non sélectionnée exclue', res.value === 21);
  ok('1.2 sampleCount = 2 (pièces sélectionnées avec relevé frais)', res.sampleCount === 2);
}

console.log('\n--- 2. Pièce inactive ou archivée jamais incluse même si sélectionnée ---');
{
  var rooms = [
    { id: 'r1', trackedActive: true, archived: false },
    { id: 'r2', trackedActive: false, archived: false }, // désactivée
    { id: 'r3', trackedActive: true, archived: true },   // archivée
  ];
  var readings = [roomReading('r1', 20, 1), roomReading('r2', 99, 1), roomReading('r3', 99, 1)];
  var res = HE.computeBuildingAverageTemp(['r1', 'r2', 'r3'], rooms, readings, now, 24);
  ok('2.1 Seule r1 (active, non archivée) compte', res.value === 20 && res.sampleCount === 1);
}

console.log('\n--- 3. Relevé manquant ou trop ancien JAMAIS assimilé à 0°C ---');
{
  var rooms = [{ id: 'r1', trackedActive: true, archived: false }, { id: 'r2', trackedActive: true, archived: false }, { id: 'r3', trackedActive: true, archived: false }];
  var readings = [roomReading('r1', 20, 1), roomReading('r2', 20, 48)]; // r2 : relevé de 48h, hors fraîcheur (24h)
  var res = HE.computeBuildingAverageTemp(['r1', 'r2'], rooms, readings, now, 24);
  ok('3.1 r2 exclu (relevé trop ancien), moyenne = 20 (pas (20+0)/2=10)', res.value === 20);
  ok('3.2 r2 listé dans excludedStale (relevé existant mais périmé)', res.excludedStale.indexOf('r2') !== -1);

  var res2 = HE.computeBuildingAverageTemp(['r1', 'r3'], rooms, readings, now, 24); // r3 n'a AUCUN relevé
  ok('3.3 r3 (aucun relevé) listé dans excludedMissing, pas excludedStale', res2.excludedMissing.indexOf('r3') !== -1);
  ok('3.4 Aucune valeur -> jamais 0°C, moyenne reste basée sur r1 seul (20°C)', res2.value === 20);
}

console.log('\n--- 4. Aucune pièce exploitable -> value:null (jamais inventé) ---');
{
  var res = HE.computeBuildingAverageTemp([], [], [], now, 24);
  ok('4.1 value === null, sampleCount === 0', res.value === null && res.sampleCount === 0);
}

console.log('\n--- 5. interpolateCurve — jamais d\'extrapolation au-delà des points programmés ---');
{
  var curve = [{ dju: 2, expectedIndoorTemp: 21 }, { dju: 8, expectedIndoorTemp: 19 }, { dju: 14, expectedIndoorTemp: 16 }];
  ok('5.1 DJU exactement sur un point -> valeur exacte', HE.interpolateCurve(curve, 8) === 19);
  ok('5.2 DJU entre deux points -> interpolation linéaire (dju=5 -> 20)', HE.interpolateCurve(curve, 5) === 20);
  ok('5.3 DJU sous le premier point -> valeur du premier point (jamais extrapolé plus haut)', HE.interpolateCurve(curve, 0) === 21);
  ok('5.4 DJU au-dessus du dernier point -> valeur du dernier point (jamais extrapolé plus bas)', HE.interpolateCurve(curve, 20) === 16);
  ok('5.5 Aucun point programmé -> null', HE.interpolateCurve([], 8) === null);
}

console.log('\n--- 6. analyzeCurveDeviation — détection d\'écart, méthode simple et honnête ---');
{
  var curve = [{ dju: 2, expectedIndoorTemp: 21 }, { dju: 14, expectedIndoorTemp: 21 }]; // référence plate : 21°C attendu quel que soit le DJU
  var samples = [
    { dju: 3, actualTemp: 20.8, date: '2026-01-10' }, // écart faible, conforme
    { dju: 10, actualTemp: 19.5, date: '2026-01-12' }, // écart -1.5°C, sous le seuil (1°C)
    { dju: 13, actualTemp: 18.9, date: '2026-01-14' }, // écart -2.1°C
  ];
  var res = HE.analyzeCurveDeviation(curve, samples, 1);
  ok('6.1 3 lignes analysées (toutes avec point de référence)', res.rows.length === 3);
  ok('6.2 degradationFromDju = 10 (premier DJU, en partant du plus bas, où l\'écart dépasse le seuil)', res.degradationFromDju === 10);
  ok('6.3 worstDeviation identifie bien le DJU=13 (écart le plus négatif)', res.worstDeviation.dju === 13);
  ok('6.4 Aucun échantillon -> jamais de degradationFromDju inventé', HE.analyzeCurveDeviation(curve, [], 1).degradationFromDju === null);
  ok('6.5 Aucune courbe de référence -> rows vide, rien inventé', HE.analyzeCurveDeviation([], samples, 1).rows.length === 0);
}

console.log('\n--- 7. buildRoomTemperatureSeries — comparaison individuelle d\'une pièce (demande utilisateur, finalisation) ---');
{
  // 2 jours avec relevé, 1 jour sans (écart de 3 jours au total) — le trou
  // ne doit JAMAIS être comblé par une valeur inventée.
  var d0 = now; // aujourd'hui
  var d1 = now - 24 * 3600 * 1000; // hier (AUCUN relevé)
  var d2 = now - 2 * 24 * 3600 * 1000; // avant-hier
  var readings = [
    { roomId: 'r1', temp: 19.0, recordedAt: { toMillis: () => d2 } },
    { roomId: 'r1', temp: 20.5, recordedAt: { toMillis: () => d0 } },
    { roomId: 'r2', temp: 99, recordedAt: { toMillis: () => d0 } }, // autre pièce, ne doit jamais apparaître
  ];
  var res = HE.buildRoomTemperatureSeries('r1', readings, 3, now, 20);
  ok('7.1 3 points générés (fenêtre demandée)', res.points.length === 3);
  ok('7.2 Le jour sans relevé (hier) a bien temp:null (JAMAIS une valeur inventée/interpolée)', res.points.some(function (p) { return p.temp === null; }));
  ok('7.3 missingDays recense bien le jour sans relevé', res.missingDays.length === 1);
  ok('7.4 sampleCount = 2 (seuls les 2 jours avec relevé réel)', res.sampleCount === 2);
  ok('7.5 lastPoint = dernier relevé réel (20.5°C, aujourd\'hui)', res.lastPoint && res.lastPoint.temp === 20.5);
  ok('7.6 Écart à la cible calculé (20.5 - 20 = +0.5°C)', res.deviation === 0.5);
  ok('7.7 Les relevés d\'une AUTRE pièce (r2) n\'apparaissent jamais dans la série de r1', res.points.every(function (p) { return p.temp !== 99; }));
}
{
  var res2 = HE.buildRoomTemperatureSeries('r-sans-relevé', [], 5, now, 20);
  ok('7.8 Pièce sans aucun relevé -> tous les jours sont des trous, jamais 0°C ni une valeur inventée', res2.points.every(function (p) { return p.temp === null; }));
  ok('7.9 lastPoint null, deviation null (rien à comparer)', res2.lastPoint === null && res2.deviation === null);
}
{
  // Sans targetTemp connue, deviation doit rester null (jamais comparé à
  // une cible inventée).
  var readings3 = [{ roomId: 'r1', temp: 20, recordedAt: { toMillis: () => now } }];
  var res3 = HE.buildRoomTemperatureSeries('r1', readings3, 1, now, undefined);
  ok('7.10 Sans température cible connue, deviation reste null', res3.deviation === null);
}

console.log('\n--- 8. buildBuildingDailyAverageSeries — raccordement analyse DJU / température intérieure (finalisation) ---');
{
  var rooms = [
    { id: 'r1', trackedActive: true, archived: false },
    { id: 'r2', trackedActive: true, archived: false },
    { id: 'r3', trackedActive: false, archived: false }, // non suivie -> jamais dans la moyenne
  ];
  var dToday = now, dYesterday = now - 24 * 3600 * 1000;
  var readings = [
    { roomId: 'r1', temp: 20, recordedAt: { toMillis: () => dToday } },
    { roomId: 'r2', temp: 22, recordedAt: { toMillis: () => dToday } },
    { roomId: 'r1', temp: 18, recordedAt: { toMillis: () => dYesterday } },
    // r2 : aucun relevé hier -> moyenne du jour basée sur r1 seul (18°C), jamais 0°C
    { roomId: 'r3', temp: 5, recordedAt: { toMillis: () => dToday } }, // pièce non suivie, ne doit JAMAIS influencer
  ];
  var res = HE.buildBuildingDailyAverageSeries(['r1', 'r2', 'r3'], rooms, readings, 2, now);
  ok('8.1 2 points générés', res.points.length === 2);
  ok('8.2 Aujourd\'hui : moyenne (20+22)/2=21, pièce non suivie (r3=5°C) exclue', res.points[1].temp === 21);
  ok('8.3 Hier : moyenne basée sur r1 seul (18°C), jamais 0°C pour r2 manquant', res.points[0].temp === 18);
  ok('8.4 Aucun jour manquant ici (au moins une pièce suivie a un relevé chaque jour)', res.missingDays.length === 0);
}
{
  var rooms2 = [{ id: 'r1', trackedActive: true, archived: false }];
  var res2 = HE.buildBuildingDailyAverageSeries(['r1'], rooms2, [], 3, now);
  ok('8.5 Aucun relevé du tout -> les 3 jours sont des trous, jamais une moyenne à 0°C', res2.points.every(function (p) { return p.temp === null; }) && res2.missingDays.length === 3);
}

console.log('\n--- 9. PASSE DE FIABILISATION — analyzeCurveDeviation : fiabilité statistique explicite (suffisant/partiel/insuffisant) ---');
{
  var curve = [{ dju: 2, expectedIndoorTemp: 21 }, { dju: 15, expectedIndoorTemp: 17 }];
  // 2 échantillons avec un écart ÉNORME (-3°C, largement sous le seuil de
  // 1°C) — EXACTEMENT le cas signalé par l'utilisateur : "deux jours de
  // mesures ne doivent jamais produire une recommandation avec une
  // confiance élevée".
  var samples2 = [
    { dju: 10, actualTemp: 15, date: '2026-01-10' },
    { dju: 11, actualTemp: 14.8, date: '2026-01-11' },
  ];
  var res2 = HE.analyzeCurveDeviation(curve, samples2, 1);
  ok('9.1 2 échantillons -> dataSufficiency = "insuffisant" (seuil MIN_PARTIAL=' + HE.DJU_ANALYSIS_MIN_PARTIAL + ')', res2.dataSufficiency === 'insuffisant');
  ok('9.2 Avec données insuffisantes, degradationFromDju reste TOUJOURS null — même avec un écart énorme sur les 2 points', res2.degradationFromDju === null);
  ok('9.3 sampleCount reflète bien le nombre réel d\'échantillons (2)', res2.sampleCount === 2);
  ok('9.4 Les lignes individuelles (rows) restent consultables malgré l\'insuffisance (transparence, pas une dissimulation)', res2.rows.length === 2);
}
{
  // 1 seul échantillon -> insuffisant à plus forte raison.
  var curve = [{ dju: 2, expectedIndoorTemp: 21 }, { dju: 15, expectedIndoorTemp: 17 }];
  var res1 = HE.analyzeCurveDeviation(curve, [{ dju: 10, actualTemp: 10, date: '2026-01-10' }], 1);
  ok('9.5 1 seul échantillon -> "insuffisant", degradationFromDju null malgré un écart extrême (-8.7°C)', res1.dataSufficiency === 'insuffisant' && res1.degradationFromDju === null);
}
{
  // Zone "partielle" : exactement MIN_PARTIAL échantillons (3), sous
  // MIN_SUFFICIENT (7) -> la détection reste disponible mais qualifiée
  // "partielle", jamais "suffisante".
  var curve = [{ dju: 2, expectedIndoorTemp: 21 }, { dju: 15, expectedIndoorTemp: 17 }];
  var samples3 = [
    { dju: 10, actualTemp: 15, date: '2026-01-10' },
    { dju: 11, actualTemp: 14.8, date: '2026-01-11' },
    { dju: 12, actualTemp: 14.5, date: '2026-01-12' },
  ];
  var res3 = HE.analyzeCurveDeviation(curve, samples3, 1);
  ok('9.6 Exactement 3 échantillons (= MIN_PARTIAL) -> "partiel", jamais "insuffisant" ni "suffisant"', res3.dataSufficiency === 'partiel');
  ok('9.7 En zone "partielle", degradationFromDju EST calculé (pas supprimé, juste qualifié côté UI)', res3.degradationFromDju !== null);
}
{
  // Zone "suffisante" : au moins MIN_SUFFICIENT (7) échantillons.
  var curve = [{ dju: 2, expectedIndoorTemp: 21 }, { dju: 15, expectedIndoorTemp: 17 }];
  var samples7 = [];
  for (var i = 0; i < 7; i++) samples7.push({ dju: 10 + i * 0.1, actualTemp: 15, date: '2026-01-' + (10 + i) });
  var res7 = HE.analyzeCurveDeviation(curve, samples7, 1);
  ok('9.8 7 échantillons (= MIN_SUFFICIENT) -> "suffisant"', res7.dataSufficiency === 'suffisant');
  ok('9.9 6 échantillons (juste sous le seuil) -> encore "partiel", pas "suffisant"', HE.analyzeCurveDeviation(curve, samples7.slice(0, 6), 1).dataSufficiency === 'partiel');
}
{
  // Aucun échantillon du tout -> dataSufficiency toujours présent (jamais
  // undefined), cohérent avec les autres cas.
  var res0 = HE.analyzeCurveDeviation([{ dju: 2, expectedIndoorTemp: 21 }, { dju: 15, expectedIndoorTemp: 17 }], [], 1);
  ok('9.10 Aucun échantillon -> dataSufficiency = "insuffisant" (0 < MIN_PARTIAL), jamais undefined', res0.dataSufficiency === 'insuffisant');
}

console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests de la courbe thermique bâtiment passent.');
process.exit(failures ? 1 : 0);
