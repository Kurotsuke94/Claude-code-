// Tests UNITAIRES purs (aucun navigateur, aucun émulateur) du moteur
// quantitatif v2 (REFONTE CTA/VC + CONFIGURATION THERMIQUE) —
// assets/js/utils/heating-engine.js: proposeQuantitative/
// proposeAllQuantitative/clampForCircuit. Même idiome que tests/dju_test.js :
// charge le fichier réel dans une sandbox Node minimaliste (window.MX),
// jamais une réimplémentation séparée de la logique testée.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'utils', 'heating-engine.js'), 'utf8');
const sandbox = { window: {} };
// eslint-disable-next-line no-new-func
new Function('window', src)(sandbox.window);
const HE = sandbox.window.MX.HeatingEngine;

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

function point(water, blow, ambient) { return { waterTemp: water, blowTemp: blow, ambientTemp: ambient }; }
function reading(circuitId, p1, p2, recordedAtMs) {
  return { circuitId: circuitId, points: { point1: p1, point2: p2 }, recordedAt: { toMillis: () => recordedAtMs } };
}
function weatherDay(date, dju, kind) { return { date: date, dju: dju, dju19: dju, kind: kind }; }

var now = Date.parse('2026-01-15T12:00:00Z');
var freshReading = reading('c1', point(45, 40, 19), point(46, 41, 20), now - 2 * 3600 * 1000); // 2h old
var series = [];
for (var i = 7; i >= 1; i--) series.push(weatherDay('day-' + i, 8, 'observed'));
for (var i = 1; i <= 7; i++) series.push(weatherDay('fday-' + i, 12, 'forecast')); // +4 DJU trend

var BUILDINGS = {
  bAuto: { id: 'bAuto', name: 'Bâtiment Auto [DÉMO]', mode: 'automatique' },
  bManuel: { id: 'bManuel', name: 'Bâtiment Manuel [DÉMO]', mode: 'manuel_assiste' },
};

console.log('--- 1. Exclusion bâtiment automatique (lu depuis heating_buildings, jamais un id codé en dur) ---');
{
  var c = { id: 'c1', type: 'vc', buildingId: 'bAuto' };
  var r = HE.proposeQuantitative(c, [freshReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('1.1 Mode "exclu" pour un circuit d\'un bâtiment mode:automatique', r.mode === 'exclu');
  ok('1.2 Raison explicite mentionnant le bâtiment et la régulation automatique', r.reason.indexOf('Bâtiment Auto') !== -1 && /automatique/.test(r.reason));

  var c2 = { id: 'c2', type: 'vc', buildingId: 'bManuel' };
  var r2 = HE.proposeQuantitative(c2, [freshReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('1.3 Un bâtiment mode:manuel_assiste N\'EST PAS exclu', r2.mode !== 'exclu');
}

console.log('\n--- 1b. Bâtiment manquant/non résolu — jamais un chiffre par prudence ---');
{
  var cNoBuilding = { id: 'c1', type: 'vc' }; // pas de buildingId du tout
  var r1 = HE.proposeQuantitative(cNoBuilding, [freshReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('1b.1 Aucun buildingId -> "exclu" (jamais un chiffre sans bâtiment assigné)', r1.mode === 'exclu');

  var cUnknownBuilding = { id: 'c1', type: 'vc', buildingId: 'b-inexistant' };
  var r2 = HE.proposeQuantitative(cUnknownBuilding, [freshReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('1b.2 buildingId présent mais introuvable -> "observation" par prudence (jamais "proposition")', r2.mode === 'observation');

  // Rétrocompatibilité : buildingsById omis (ancien appelant) -> jamais
  // exclu pour une raison de bâtiment (comportement préservé).
  var r3 = HE.proposeQuantitative(cUnknownBuilding, [freshReading], series, {}, now, '2026-01-15');
  ok('1b.3 buildingsById omis (compat) : pas d\'exclusion liée au bâtiment', r3.mode === 'proposition');
}

console.log('\n--- 2. Exclusion des circuits hors CTA/VC ---');
{
  var c = { id: 'c1', type: 'autre', buildingId: 'bManuel' };
  var r = HE.proposeQuantitative(c, [freshReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('2.1 Mode "exclu" pour un circuit "autre"', r.mode === 'exclu');
}

console.log('\n--- 3. Mode observation (données insuffisantes) ---');
{
  var c = { id: 'c1', type: 'vc', buildingId: 'bManuel' };
  var r1 = HE.proposeQuantitative(c, [], series, {}, now, '2026-01-15', BUILDINGS); // aucun relevé 2 points
  ok('3.1 Mode "observation" sans relevé à 2 points', r1.mode === 'observation');
  ok('3.2 Aucune valeur chiffrée dans ce mode', typeof r1.proposed === 'undefined');
  var r2 = HE.proposeQuantitative(c, [freshReading], [], {}, now, '2026-01-15', BUILDINGS); // pas de météo
  ok('3.3 Mode "observation" sans série météo exploitable', r2.mode === 'observation');
}

console.log('\n--- 4. VC — une seule grandeur (eau), plafond 50°C jamais dépassé ---');
{
  var c = { id: 'c1', type: 'vc', buildingId: 'bManuel' };
  var hotReading = reading('c1', point(49, 44, 20), point(49.5, 44.5, 20.5), now - 1 * 3600 * 1000);
  var bigTrend = [];
  for (var i = 7; i >= 1; i--) bigTrend.push(weatherDay('day-' + i, 2, 'observed'));
  for (var i = 1; i <= 7; i++) bigTrend.push(weatherDay('fday-' + i, 20, 'forecast')); // Δ = +18
  var r = HE.proposeQuantitative(c, [hotReading], bigTrend, {}, now, '2026-01-15', BUILDINGS);
  ok('4.1 Mode "proposition"', r.mode === 'proposition');
  ok('4.2 proposed.blow est null pour un VC (jamais de grandeur air pour ce type)', r.proposed.blow === null);
  ok('4.3 Valeur d\'eau proposée JAMAIS > 50°C même avec une forte tendance', r.proposed.water.value <= 50);
  ok('4.4 Plafonnement signalé (capped=true)', r.proposed.water.capped === true);
  ok('4.5 Justification mentionne le plafonnement', /plafonn/.test(r.justification));
}

console.log('\n--- 5. VC — plafond configurable (jamais au-delà de 50°C) ---');
{
  var c = { id: 'c1', type: 'vc', buildingId: 'bManuel', vcMaxTemp: 45 };
  var hotReading = reading('c1', point(44, 40, 19), point(44, 40, 19), now - 1 * 3600 * 1000);
  var r = HE.proposeQuantitative(c, [hotReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('5.1 Le plafond PAR CIRCUIT (45°C) est bien respecté', r.proposed.water.value <= 45);
  var c2 = { id: 'c2', type: 'vc', buildingId: 'bManuel' };
  var r2 = HE.proposeQuantitative(c2, [reading('c2', point(49, 49, 20), point(49, 49, 20), now - 1 * 3600 * 1000)], series, { vcMaxTemp: 80 }, now, '2026-01-15', BUILDINGS);
  ok('5.2 Un plafond de config > 50°C est ignoré (plafond physique en dur)', r2.proposed.water.value <= 50);
}

console.log('\n--- 6. CORRECTION 2 — CTA : soufflage (18-22°C) et eau batterie séparés, jamais l\'un ne plafonne l\'autre ---');
{
  // Eau très chaude (41°C), soufflage froid (10°C) — si les deux grandeurs
  // étaient confondues (ancien défaut), l'une écraserait l'autre. Aucune
  // limite d'eau configurée sur ce circuit -> proposed.water doit être null.
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel' };
  var r = HE.proposeQuantitative(c, [reading('c1', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6.1 Mode "proposition"', r.mode === 'proposition');
  ok('6.2 Soufflage proposé reste dans [18,22] (plage par défaut)', r.proposed.blow.value >= 18 && r.proposed.blow.value <= 22);
  ok('6.3 Eau batterie NON configurée -> proposed.water est null (jamais une valeur inventée)', r.proposed.water === null);
  ok('6.4 current.waterTemp (41°C) jamais altéré par la plage de soufflage', r.current.waterTemp === 41);
  ok('6.5 Justification signale l\'absence de limites eau configurées', /non configurées/.test(r.justification));
  ok('6.6 Justification distingue bien "soufflage" et "eau...batterie"', /[Ss]oufflage/.test(r.justification) && /eau.*batterie/.test(r.justification));
}

console.log('\n--- 6b. CTA avec limites d\'eau batterie CONFIGURÉES — proposition chiffrée séparée ---');
{
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', waterTempMin: 35, waterTempMax: 60 };
  var r = HE.proposeQuantitative(c, [reading('c1', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6b.1 proposed.water n\'est plus null une fois les limites configurées', r.proposed.water !== null);
  ok('6b.2 La valeur d\'eau proposée reste DANS les limites de l\'installation (35-60°C)', r.proposed.water.value >= 35 && r.proposed.water.value <= 60);
  ok('6b.3 La valeur d\'eau proposée n\'est JAMAIS bornée par la plage de soufflage 18-22°C', r.proposed.water.value > 22);
  ok('6b.4 Le soufflage reste indépendamment dans [18,22]', r.proposed.blow.value >= 18 && r.proposed.blow.value <= 22);
}

console.log('\n--- 6c. CORRECTION PRIORITAIRE — repli sur les limites GÉNÉRALES d\'eau batterie (Configuration thermique) ---');
{
  // Installation SANS ses propres limites -> doit utiliser config.ctaWaterTempMin/Max
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel' };
  var cfg = { ctaWaterTempMin: 30, ctaWaterTempMax: 38 }; // plage basse volontairement
  var r = HE.proposeQuantitative(c, [reading('c1', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, cfg, now, '2026-01-15', BUILDINGS);
  ok('6c.1 proposed.water n\'est plus null grâce aux limites générales', r.proposed.water !== null);
  ok('6c.2 La valeur respecte STRICTEMENT la limite haute générale (38°C), jamais dépassée malgré la tendance DJU', r.proposed.water.value <= 38);
  ok('6c.3 overshoot=true : le besoin calculé dépasse la limite haute (41°C mesuré + tendance > 38°C)', r.proposed.water.overshoot === true);
  ok('6c.4 capped=true', r.proposed.water.capped === true);
  ok('6c.5 Justification signale explicitement le risque de puissance insuffisante', /puissance thermique disponible peut être insuffisante/.test(r.justification));
}

console.log('\n--- 6d. CORRECTION PRIORITAIRE — les limites d\'installation priment TOUJOURS sur les limites générales ---');
{
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65 };
  var cfg = { ctaWaterTempMin: 10, ctaWaterTempMax: 15 }; // générales volontairement très différentes
  var r = HE.proposeQuantitative(c, [reading('c1', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, cfg, now, '2026-01-15', BUILDINGS);
  ok('6d.1 Les limites de l\'installation (40-65°C) sont utilisées, pas les générales (10-15°C)', r.proposed.water.value >= 40 && r.proposed.water.value <= 65);
  ok('6d.2 Le label cite bien "de l\'installation", pas "générales"', /de l'installation/.test(r.proposed.water.capLabel));
}

console.log('\n--- 6e. CORRECTION PRIORITAIRE — jamais aucune limite nulle part -> aucune valeur inventée ---');
{
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel' };
  var r = HE.proposeQuantitative(c, [reading('c1', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6e.1 proposed.water reste null sans AUCUNE limite configurée (ni installation, ni générale)', r.proposed.water === null);
}

console.log('\n--- 6f. CORRECTION PRIORITAIRE — indépendance stricte CTA eau/soufflage ET entre deux installations distinctes ---');
{
  // Deux circuits CTA avec des limites d'eau TRÈS différentes dans le même
  // appel groupé — aucune contamination croisée possible (chaque appel est
  // pur, sans état partagé).
  var cA = { id: 'cA', type: 'cta', buildingId: 'bManuel', waterTempMin: 20, waterTempMax: 25 };
  var cB = { id: 'cB', type: 'cta', buildingId: 'bManuel', waterTempMin: 55, waterTempMax: 60 };
  var readings = [
    reading('cA', point(50, 10, 19), point(50, 10, 19), now - 1 * 3600 * 1000),
    reading('cB', point(50, 10, 19), point(50, 10, 19), now - 1 * 3600 * 1000),
  ];
  var results = HE.proposeAllQuantitative([cA, cB], readings, series, {}, now, '2026-01-15', BUILDINGS);
  var rA = results.find(function (x) { return x.circuitId === 'cA'; });
  var rB = results.find(function (x) { return x.circuitId === 'cB'; });
  ok('6f.1 Installation A respecte STRICTEMENT ses propres limites (20-25°C), jamais celles de B', rA.proposed.water.value >= 20 && rA.proposed.water.value <= 25);
  ok('6f.2 Installation B respecte STRICTEMENT ses propres limites (55-60°C), jamais celles de A', rB.proposed.water.value >= 55 && rB.proposed.water.value <= 60);
  ok('6f.3 Le soufflage (indépendant de l\'eau) reste dans la plage par défaut pour les deux', rA.proposed.blow.value >= 18 && rA.proposed.blow.value <= 22 && rB.proposed.blow.value >= 18 && rB.proposed.blow.value <= 22);
}

console.log('\n--- 6g. CORRECTION PRIORITAIRE — jamais dépassé même avec une tendance DJU extrême ---');
{
  var extremeSeries = [];
  for (var i = 7; i >= 1; i--) extremeSeries.push(weatherDay('day-' + i, 2, 'observed'));
  for (var i = 1; i <= 7; i++) extremeSeries.push(weatherDay('fday-' + i, 200, 'forecast')); // tendance DJU énorme et irréaliste
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65, ctaRangeMin: 19, ctaRangeMax: 21 };
  var r = HE.proposeQuantitative(c, [reading('c1', point(41, 20, 19), point(41, 20, 19), now - 1 * 3600 * 1000)], extremeSeries, {}, now, '2026-01-15', BUILDINGS);
  ok('6g.1 Eau de batterie JAMAIS au-delà de 65°C même avec une tendance DJU extrême', r.proposed.water.value <= 65);
  ok('6g.2 Soufflage JAMAIS au-delà de 21°C même avec une tendance DJU extrême', r.proposed.blow.value <= 21);
  ok('6g.3 overshoot=true sur les deux grandeurs (le besoin réel dépasse largement les limites)', r.proposed.water.overshoot === true && r.proposed.blow.overshoot === true);
}

console.log('\n--- 6h. CORRECTION PRIORITAIRE — VC : overshoot signalé, jamais au-delà du plafond même en cas de besoin extrême ---');
{
  var extremeSeries = [];
  for (var i = 7; i >= 1; i--) extremeSeries.push(weatherDay('day-' + i, 2, 'observed'));
  for (var i = 1; i <= 7; i++) extremeSeries.push(weatherDay('fday-' + i, 200, 'forecast'));
  var c = { id: 'c1', type: 'vc', buildingId: 'bManuel', vcMaxTemp: 48 };
  var r = HE.proposeQuantitative(c, [reading('c1', point(47, 40, 19), point(47, 40, 19), now - 1 * 3600 * 1000)], extremeSeries, {}, now, '2026-01-15', BUILDINGS);
  ok('6h.1 Jamais au-delà de 48°C (plafond propre à l\'installation)', r.proposed.water.value <= 48);
  ok('6h.2 Jamais au-delà de 50°C (plafond physique absolu) même si vcMaxTemp avait été mal configuré au-delà', r.proposed.water.value <= 50);
  ok('6h.3 overshoot=true', r.proposed.water.overshoot === true);
}

console.log('\n--- 6i. CONFIGURATION DES INSTALLATIONS — tempMin/tempMax générales resserrent TOUTES les grandeurs, jamais un élargissement ---');
{
  // Soufflage : plage CTA 18-22°C, mais tempMax général de l'installation
  // (point 4 de la demande) fixé à 20°C -> doit resserrer, jamais dépasser 20.
  var c1 = { id: 'c1', type: 'cta', buildingId: 'bManuel', tempMin: 10, tempMax: 20 };
  var r1 = HE.proposeQuantitative(c1, [reading('c1', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6i.1 Soufflage JAMAIS au-delà de 20°C (tempMax général plus strict que la plage CTA 18-22)', r1.proposed.blow.value <= 20);

  // Eau batterie : aucune limite eau spécifique, mais tempMin/tempMax
  // générales présentes -> utilisées comme base (jamais une valeur
  // inventée, une vraie limite saisie par l'utilisateur).
  var c2 = { id: 'c2', type: 'cta', buildingId: 'bManuel', tempMin: 30, tempMax: 35 };
  var r2 = HE.proposeQuantitative(c2, [reading('c2', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6i.2 Eau batterie utilise tempMin/tempMax générales à défaut d\'autre limite (reste <= 35°C)', r2.proposed.water !== null && r2.proposed.water.value <= 35);

  // Les limites eau SPÉCIFIQUES à l'installation restent resserrées par
  // tempMax général si celui-ci est plus strict (jamais un élargissement).
  var c3 = { id: 'c3', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65, tempMax: 50 };
  var r3 = HE.proposeQuantitative(c3, [reading('c3', point(41, 10, 19), point(41, 10, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6i.3 Eau batterie (40-65°C) resserrée par tempMax général (50°C) -> jamais au-delà de 50°C', r3.proposed.water.value <= 50);

  // VC : vcMaxTemp 48°C mais tempMax général 45°C -> doit resserrer.
  var c4 = { id: 'c4', type: 'vc', buildingId: 'bManuel', vcMaxTemp: 48, tempMax: 45 };
  var r4 = HE.proposeQuantitative(c4, [reading('c4', point(47, 40, 19), point(47, 40, 19), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('6i.4 VC resserré par tempMax général (45°C), jamais au-delà même avec vcMaxTemp=48°C', r4.proposed.water.value <= 45);
}

console.log('\n--- 7. Plage de soufflage CTA resserrable (circuit ou config), jamais élargie au-delà de 18-22 si non précisé ---');
{
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', ctaRangeMin: 19, ctaRangeMax: 20 };
  var r = HE.proposeQuantitative(c, [reading('c1', point(25, 25, 22), point(25, 25, 22), now - 1 * 3600 * 1000)], series, {}, now, '2026-01-15', BUILDINGS);
  ok('7.1 Plage de soufflage resserrée (19-20°C) respectée', r.proposed.blow.value >= 19 && r.proposed.blow.value <= 20);
}

console.log('\n--- 8. Niveaux de confiance ---');
{
  var c = { id: 'c1', type: 'vc', buildingId: 'bManuel' };
  var fresh = reading('c1', point(40, 38, 19), point(40, 38, 19), now - 1 * 3600 * 1000); // < 24h
  var r1 = HE.proposeQuantitative(c, [fresh], series, {}, now, '2026-01-15', BUILDINGS);
  ok('8.1 Confiance "haute" avec relevé frais (<24h) et historique suffisant', r1.confidence === 'haute');
  var stale = reading('c1', point(40, 38, 19), point(40, 38, 19), now - 36 * 3600 * 1000); // 36h
  var r2 = HE.proposeQuantitative(c, [stale], series, {}, now, '2026-01-15', BUILDINGS);
  ok('8.2 Confiance "moyenne" avec relevé plus ancien (<48h)', r2.confidence === 'moyenne');
}

console.log('\n--- 9. clampForCircuit() — fonction exposée indépendamment (plage de soufflage CTA / eau VC) ---');
{
  ok('9.1 VC : valeur sous le plafond inchangée', HE.clampForCircuit(45, { type: 'vc' }, {}).value === 45);
  ok('9.2 VC : valeur au-dessus du plafond ramenée à 50', HE.clampForCircuit(60, { type: 'vc' }, {}).value === 50);
  ok('9.3 CTA (soufflage) : valeur dans la plage inchangée', HE.clampForCircuit(20, { type: 'cta' }, {}).value === 20);
  ok('9.4 CTA (soufflage) : valeur basse ramenée au minimum', HE.clampForCircuit(5, { type: 'cta' }, {}).value === 18);
  ok('9.5 Type ni CTA ni VC : aucun plafonnement (passthrough)', HE.clampForCircuit(999, { type: 'autre' }, {}).value === 999);
}

console.log('\n--- 10. proposeAllQuantitative() — circuits archivés ignorés ---');
{
  var circuits = [
    { id: 'c1', type: 'vc', buildingId: 'bManuel', archived: true },
    { id: 'c2', type: 'vc', buildingId: 'bManuel', archived: false },
  ];
  var out = HE.proposeAllQuantitative(circuits, [freshReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('10.1 Un seul résultat (le circuit archivé est ignoré)', out.length === 1 && out[0].circuitId === 'c2');
}

console.log('\n--- 11. CORRECTION 1 — v1 (evaluateAll) : jamais de candidat de réglage manuel sur un bâtiment automatique ---');
{
  var c = { id: 'c1', type: 'cta', buildingId: 'bAuto', regulationType: 'consigne', setpointType: 'eau', setpointValue: 20, targetTemp: 22 };
  var readingsV1 = [{ circuitId: 'c1', temp: 15, recordedAt: { toMillis: () => now - 1 * 3600 * 1000 } }]; // nettement sous la cible -> déclencherait "zone_froide"
  var seriesV1 = series; // tendance DJU en hausse -> déclencherait aussi "anticiper_baisse"
  var recos = HE.evaluateAll([c], readingsV1, seriesV1, now, '2026-01-15', BUILDINGS);
  var manualOnes = recos.filter(function (r) { return r.manualAction !== false && (r.action === 'zone_froide' || r.action === 'anticiper_baisse' || r.action === 'reevaluer_redoux'); });
  ok('11.1 Aucun candidat manualAction pour un circuit de bâtiment automatique', manualOnes.length === 0);
  var surveilled = recos.filter(function (r) { return r.action === 'zone_froide' && r.manualAction === false; });
  ok('11.2 La détection elle-même (zone_froide) a quand même lieu, marquée manualAction:false (surveillance)', surveilled.length === 1);
  ok('11.3 La justification indique explicitement "régulation automatique"', /régulation automatique/.test(surveilled[0].justification));

  var cManuel = { id: 'c2', type: 'cta', buildingId: 'bManuel', regulationType: 'consigne', setpointType: 'eau', setpointValue: 20, targetTemp: 22 };
  var recos2 = HE.evaluateAll([cManuel], [{ circuitId: 'c2', temp: 15, recordedAt: { toMillis: () => now - 1 * 3600 * 1000 } }], seriesV1, now, '2026-01-15', BUILDINGS);
  var manualOnes2 = recos2.filter(function (r) { return r.action === 'zone_froide'; });
  ok('11.4 Un bâtiment manuel garde bien manualAction:true (non-régression)', manualOnes2.length === 1 && manualOnes2[0].manualAction === true);
}

console.log('\n--- 12. PASSE DE FIABILISATION — une donnée ancienne ne peut JAMAIS être considérée comme une mesure actuelle ---');
{
  // Relevé de 3 jours (72h), largement au-delà du seuil de 48h — avant
  // cette correction, le moteur v2 l'aurait quand même utilisé pour
  // calculer une proposition chiffrée (avec une confiance "faible", mais
  // une proposition quand même).
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65 };
  var oldReading = reading('c1', point(44, 24, 20), point(43, 24, 20), now - 72 * 3600 * 1000);
  var r = HE.proposeQuantitative(c, [oldReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('12.1 Un relevé de 72h (> 48h) -> mode "observation", JAMAIS "proposition"', r.mode === 'observation');
  ok('12.2 proposed est totalement absent (aucune valeur chiffrée calculée sur une donnée ancienne)', r.proposed === undefined);
  ok('12.3 La justification signale explicitement un relevé trop ancien', /trop ancien|RÉCENT/i.test(r.justification));
}
{
  // Juste EN DESSOUS du seuil (47h59) -> doit encore produire une
  // proposition (confiance réduite, mais une vraie proposition).
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65 };
  var borderlineReading = reading('c1', point(44, 24, 20), point(43, 24, 20), now - (48 * 3600 * 1000 - 60000));
  var r = HE.proposeQuantitative(c, [borderlineReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('12.4 Un relevé juste SOUS le seuil de 48h produit bien une proposition (pas un faux positif de staleness)', r.mode === 'proposition');
}
{
  // EXACTEMENT au seuil (48h pile) -> traité comme ancien (limite stricte,
  // ">" dans le code, donc 48h pile reste encore accepté — vérifie le bon
  // côté de la limite explicitement).
  var c = { id: 'c1', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65 };
  var exactReading = reading('c1', point(44, 24, 20), point(43, 24, 20), now - 48 * 3600 * 1000);
  var r = HE.proposeQuantitative(c, [exactReading], series, {}, now, '2026-01-15', BUILDINGS);
  ok('12.5 Exactement 48h -> encore accepté (limite stricte ">" , pas ">=")', r.mode === 'proposition');
}

console.log('\n--- 13. PASSE DE FIABILISATION — récapitulatif des garanties de fiabilité (toutes déjà testées individuellement, revérifiées ici ensemble) ---');
{
  // Un seul scénario combiné : bâtiment manuel, CTA avec limites serrées,
  // relevé FRAIS mais EXTRÊME, tendance DJU EXTRÊME — vérifie simultanément
  // qu'AUCUNE des garanties ne cède sous la pression combinée.
  var extremeSeries = [];
  for (var i = 7; i >= 1; i--) extremeSeries.push(weatherDay('day-' + i, 1, 'observed'));
  for (var i = 1; i <= 7; i++) extremeSeries.push(weatherDay('fday-' + i, 500, 'forecast'));
  var cAuto = { id: 'cAuto', type: 'vc', buildingId: 'bAuto', vcMaxTemp: 48 };
  var cManuel = { id: 'cManuel', type: 'cta', buildingId: 'bManuel', waterTempMin: 40, waterTempMax: 65, ctaRangeMin: 19, ctaRangeMax: 21 };
  var readingsCombo = [
    reading('cAuto', point(49, 45, 22), point(49, 45, 22), now - 1 * 3600 * 1000),
    reading('cManuel', point(60, 21, 20), point(60, 21, 20), now - 1 * 3600 * 1000),
  ];
  var results = HE.proposeAllQuantitative([cAuto, cManuel], readingsCombo, extremeSeries, {}, now, '2026-01-15', BUILDINGS);
  var rAuto = results.find(function (x) { return x.circuitId === 'cAuto'; });
  var rManuel = results.find(function (x) { return x.circuitId === 'cManuel'; });
  ok('13.1 Bâtiment automatique : mode "exclu" (stricte observation), MÊME avec une tendance DJU extrême', rAuto.mode === 'exclu');
  ok('13.2 Bâtiment manuel CTA : eau de batterie JAMAIS au-delà de 65°C malgré la tendance extrême', rManuel.proposed.water.value <= 65);
  ok('13.3 Bâtiment manuel CTA : soufflage JAMAIS au-delà de 21°C malgré la tendance extrême', rManuel.proposed.blow.value <= 21);
  ok('13.4 CTA et VC restent indépendants même dans ce scénario combiné (les limites de cManuel n\'affectent jamais cAuto, exclu de toute façon)', rAuto.proposed === undefined);
  ok('13.5 Le résultat manuel reste une PROPOSITION (mode "proposition"), jamais appliqué automatiquement — statut persisté séparément géré par cta-vc.js/db.js (validation humaine obligatoire, voir tests Playwright)', rManuel.mode === 'proposition');
}

console.log(failures ? ('\n' + failures + ' test(s) EN ÉCHEC.') : '\nTous les tests unitaires du moteur quantitatif v2 passent.');
process.exit(failures ? 1 : 0);
