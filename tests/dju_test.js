// Tests unitaires DIRECTS pour assets/js/utils/dju.js — pur Node, aucun
// navigateur, aucun réseau, aucun Firestore. Charge le fichier réel du
// module (IIFE navigateur, window.MX.Dju) dans un contexte vm isolé, pour
// tester le VRAI code livré au client, pas une réécriture.
//
// Complète (sans remplacer) la couverture déjà existante de ce module via
// tests/cta_vc_test.js (Playwright, bout-en-bout) et
// tests/dju_scheduled_function_test.js (equivalent serveur, functions/
// index.js). Celui-ci cible exclusivement les fonctions pures exportées
// par dju.js elles-mêmes.
//
//   node tests/dju_test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DJU_PATH = path.join(__dirname, '..', 'assets', 'js', 'utils', 'dju.js');

function loadDju() {
  const src = fs.readFileSync(DJU_PATH, 'utf8');
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  new vm.Script(src, { filename: DJU_PATH }).runInContext(sandbox);
  if (!sandbox.window.MX || !sandbox.window.MX.Dju) {
    throw new Error('window.MX.Dju non exporté par ' + DJU_PATH);
  }
  return sandbox.window.MX.Dju;
}

const Dju = loadDju();

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

console.log('\n--- 1. estimateMean() ---');
{
  ok('1.1 Moyenne API utilisée en priorité quand fournie', (() => {
    const r = Dju.estimateMean(2, 10, 7.5);
    return r.value === 7.5 && r.method === 'api_mean';
  })());
  ok('1.2 Estimation (Tmin+Tmax)/2 uniquement si pas de moyenne API', (() => {
    const r = Dju.estimateMean(2, 10, undefined);
    return r.value === 6 && r.method === 'minmax_avg';
  })());
  ok('1.3 Moyenne API NaN ignorée -> repli sur minmax_avg', (() => {
    const r = Dju.estimateMean(0, 4, NaN);
    return r.value === 2 && r.method === 'minmax_avg';
  })());
  ok('1.4 Aucune donnée exploitable -> value/method null', (() => {
    const r = Dju.estimateMean(null, null, undefined);
    return r.value === null && r.method === null;
  })());
  ok('1.5 Tmin seul sans Tmax -> aucune estimation possible (jamais inventée)', (() => {
    const r = Dju.estimateMean(5, null, undefined);
    return r.value === null && r.method === null;
  })());
}

console.log('\n--- 2. compute19() — formule DJU19 = max(0, 19 - moyenne) ---');
{
  ok('2.1 Moyenne froide -> DJU positif exact', Dju.compute19(5) === 14);
  ok('2.2 Moyenne exactement à la base (19°C) -> DJU = 0', Dju.compute19(19) === 0);
  ok('2.3 Moyenne SUPÉRIEURE à 19°C -> DJU = 0 (jamais négatif)', Dju.compute19(25) === 0);
  ok('2.4 Moyenne négative (grand froid) -> DJU élevé, formule cohérente', Dju.compute19(-5) === 24);
  ok('2.5 Entrée non numérique -> null (jamais une valeur inventée)', Dju.compute19(null) === null && Dju.compute19(NaN) === null && Dju.compute19(undefined) === null);
}

console.log('\n--- 3. buildDailySeries() — observé vs prévisionnel, données manquantes ---');
{
  const today = '2026-01-15';
  const payload = {
    time: ['2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16'],
    temperature_2m_min:  [1, 2, 3, 4],
    temperature_2m_max:  [5, 6, 7, 8],
    temperature_2m_mean: [3, 4, 5, 6],
    weather_code: [1, 2, 3, 61],
  };
  const series = Dju.buildDailySeries(payload, today);
  ok('3.1 Jour strictement antérieur à aujourd\'hui -> observed', series[0].kind === 'observed' && series[1].kind === 'observed');
  ok('3.2 Aujourd\'hui même avec Tmin/Tmax déjà connus -> forecast (jamais observed)', series[2].kind === 'forecast');
  ok('3.3 Jour futur -> forecast', series[3].kind === 'forecast');
  ok('3.4 DJU19 et tMean arrondis à 1 décimale, méthode api_mean tracée', series[0].dju19 === 16 && series[0].tMean === 3 && series[0].meanMethod === 'api_mean');
  ok('3.5 weatherCode transmis tel quel', series[3].weatherCode === 61);

  // Changement d'année (31 déc -> 1er janv) : comparaison lexicographique
  // AAAA-MM-JJ reste correcte sans traitement spécial.
  const yearBoundary = Dju.buildDailySeries({
    time: ['2025-12-31', '2026-01-01', '2026-01-02'],
    temperature_2m_min: [0, 0, 0], temperature_2m_max: [2, 2, 2], temperature_2m_mean: [1, 1, 1],
  }, '2026-01-01');
  ok('3.6 Changement d\'année : 31/12 -> observed, 01/01 (aujourd\'hui) -> forecast, 02/01 -> forecast',
    yearBoundary[0].kind === 'observed' && yearBoundary[1].kind === 'forecast' && yearBoundary[2].kind === 'forecast');

  // Régression du bug corrigé : moyenne API fournie SANS Tmin/Tmax ->
  // DJU valide, donc NE DOIT PLUS être classé 'missing' (l'ancienne
  // condition ne testait que Tmin/Tmax, désynchronisée de dju19).
  const meanOnly = Dju.buildDailySeries({
    time: ['2026-01-10'],
    temperature_2m_min: [null], temperature_2m_max: [null], temperature_2m_mean: [4],
  }, today);
  ok('3.7 [Régression] Moyenne API seule (sans Tmin/Tmax) -> DJU valide, kind != missing', meanOnly[0].dju19 === 15 && meanOnly[0].kind === 'observed');

  // Vraie absence de donnée (aucune des 3 sources) -> missing, et DJU/tMean
  // bien null (jamais une valeur par défaut inventée).
  const trulyMissing = Dju.buildDailySeries({
    time: ['2026-01-10'],
    temperature_2m_min: [null], temperature_2m_max: [null], temperature_2m_mean: [null],
  }, today);
  ok('3.8 Aucune donnée exploitable -> kind missing, dju19 et tMean null', trulyMissing[0].kind === 'missing' && trulyMissing[0].dju19 === null && trulyMissing[0].tMean === null);

  ok('3.9 Entrée invalide (daily absent/malformé) -> tableau vide, jamais une exception', Array.isArray(Dju.buildDailySeries(null, today)) && Dju.buildDailySeries(null, today).length === 0 && Dju.buildDailySeries({}, today).length === 0);
}

console.log('\n--- 4. trend() ---');
{
  function mk(kind, dju19) { return { kind: kind, dju19: dju19 }; }
  ok('4.1 Hausse significative (prochains jours plus froids)', Dju.trend([mk('observed', 2), mk('forecast', 5)]) === 'hausse');
  ok('4.2 Baisse significative (redoux à venir)', Dju.trend([mk('observed', 5), mk('forecast', 2)]) === 'baisse');
  ok('4.3 Écart faible -> stable', Dju.trend([mk('observed', 3), mk('forecast', 3.2)]) === 'stable');
  ok('4.4 Pas assez de recul (un seul groupe renseigné) -> null', Dju.trend([mk('observed', 3)]) === null && Dju.trend([mk('forecast', 3)]) === null);
  ok('4.5 Jours sans DJU exploitable ignorés dans le calcul', Dju.trend([mk('observed', null), mk('observed', 2), mk('forecast', 5)]) === 'hausse');
}

console.log('\n--- 5. parisDateStr() — Europe/Paris explicite, pas le fuseau de l\'appareil ---');
{
  // Instants fixes en UTC, indépendants du fuseau du process qui exécute ce
  // test (portable Linux/macOS/Windows) — voir assets/js/utils/dju.js pour
  // le détail du bug corrigé que cette fonction remplace.
  const cases = [
    ['2025-12-31T23:30:00Z', '2026-01-01', 'veille du Nouvel An (23h30 UTC = 00h30 Paris, CET)'],
    ['2026-03-28T23:30:00Z', '2026-03-29', 'veille du passage à l\'heure d\'été'],
    ['2026-10-24T22:30:00Z', '2026-10-25', 'veille du passage à l\'heure d\'hiver'],
    ['2026-06-15T10:00:00Z', '2026-06-15', 'plein été (CEST), même date UTC et Paris'],
  ];
  cases.forEach(function (c) {
    const got = Dju.parisDateStr(new Date(c[0]));
    ok('5.x ' + c[2] + ' -> ' + c[1], got === c[1]);
  });
  ok('5.5 Sans argument, retombe sur new Date() sans exception', typeof Dju.parisDateStr() === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(Dju.parisDateStr()));
}

console.log('\n' + (failures === 0
  ? 'Tous les tests unitaires de assets/js/utils/dju.js passent.'
  : failures + ' test(s) EN ÉCHEC.'));
process.exit(failures === 0 ? 0 : 1);
