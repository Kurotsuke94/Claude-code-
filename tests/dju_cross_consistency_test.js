// Test de NON-RÉGRESSION CROISÉ entre le calcul DJU côté client
// (assets/js/utils/dju.js) et côté serveur (functions/index.js). Pur Node,
// sans réseau, sans Firebase, sans effets de bord — aucune Cloud Function
// n'est requise ni exécutée.
//
// Objectif : garantir que les deux implémentations, aujourd'hui
// indépendantes (le serveur n'a pas accès à window.MX, voir l'en-tête de
// functions/index.js), restent synchronisées sur les mêmes entrées. Si l'une
// évolue sans l'autre, ce test doit le détecter.
//
// MÉTHODE — même convention que tests/dju_scheduled_function_test.js :
// on extrait le VRAI texte source de functions/index.js (fonction pure
// _estimateDailyMean, constante DJU_BASE_TEMP, expressions de calcul/
// arrondi), jamais une copie ressaisie à la main — toute évolution future du
// fichier réel est automatiquement reflétée ici. Le client est chargé via un
// contexte vm isolé (même technique que tests/dju_test.js), pour exécuter le
// VRAI fichier livré au navigateur.
//
// PÉRIMÈTRE : ce test compare UNIQUEMENT les deux fonctions de calcul pur
// (moyenne journalière + formule DJU19 + arrondis). Il ne compare PAS la
// classification observé/prévisionnel : le client la détermine par
// comparaison de dates (buildDailySeries), le serveur ne la calcule JAMAIS
// — il écrit toujours kind:"observed" en dur, car il ne traite QUE "hier"
// (voir _yesterdayParisDateStr) par construction. C'est une différence
// D'ARCHITECTURE INTENTIONNELLE, pas une divergence à corriger : documentée
// ci-dessous (section 4), pas testée comme une égalité.
//
//   node tests/dju_cross_consistency_test.js
//
// PAS de 'use strict' ici (volontaire, même contrainte que
// tests/dju_scheduled_function_test.js) : eval() en mode strict n'injecte
// plus ses déclarations de fonction dans la portée englobante, ce qui
// casserait l'extraction de _estimateDailyMean ci-dessous.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVER_PATH = path.join(__dirname, '..', 'functions', 'index.js');
const CLIENT_PATH = path.join(__dirname, '..', 'assets', 'js', 'utils', 'dju.js');
const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

// ── Extraction de texte, reprise à l'identique de
// tests/dju_scheduled_function_test.js (comptage de profondeur d'accolades,
// portable, ignore chaînes/commentaires) — pas réinventée ici.
function extractFn(name) {
  const startRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = startRe.exec(serverSrc);
  if (!m) throw new Error('Fonction ' + name + ' introuvable dans functions/index.js — a-t-elle été renommée/déplacée ? Ce test doit être mis à jour.');
  const start = m.index;
  let i = start + m[0].length;
  let depth = 1;
  let inString = null, inLineComment = false, inBlockComment = false;
  for (; i < serverSrc.length && depth > 0; i++) {
    const c = serverSrc[i], next = serverSrc[i + 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inString) { if (c === '\\') { i++; continue; } if (c === inString) inString = null; continue; }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  if (depth !== 0) throw new Error('Fonction ' + name + ' : accolades non équilibrées dans functions/index.js — extraction impossible.');
  return serverSrc.slice(start, i);
}

// Reconstruit la VRAIE fonction serveur dans ce scope (pas une copie).
eval(extractFn('_estimateDailyMean'));

// Constante réelle, extraite (jamais recopiée en dur ici).
const baseTempMatch = /const DJU_BASE_TEMP = (\d+(?:\.\d+)?);/.exec(serverSrc);
if (!baseTempMatch) throw new Error('DJU_BASE_TEMP introuvable dans functions/index.js — ce test doit être mis à jour.');
const SERVER_DJU_BASE_TEMP = Number(baseTempMatch[1]);

// Expressions réelles d'arrondi/formule, extraites telles qu'écrites dans le
// fichier (pas retypées) et compilées en fonctions via `new Function` — les
// noms de paramètres ci-dessous correspondent EXACTEMENT aux identifiants
// utilisés dans l'expression source, aucun renommage.
function extractExpr(regex, label) {
  const m = regex.exec(serverSrc);
  if (!m) throw new Error('Expression "' + label + '" introuvable dans functions/index.js — ce test doit être mis à jour.');
  return m[1];
}
const djuExprText       = extractExpr(/const dju19 = (Math\.max\(0, DJU_BASE_TEMP - mean\.value\));/, 'const dju19 = Math.max(...)');
const meanRoundExprText = extractExpr(/tMean: (Math\.round\(mean\.value \* 10\) \/ 10),/, 'tMean: Math.round(...)');
const djuRoundExprText  = extractExpr(/dju19: (Math\.round\(dju19 \* 10\) \/ 10),/, 'dju19: Math.round(...)');

const serverDju19Raw  = new Function('DJU_BASE_TEMP', 'mean', 'return ' + djuExprText + ';');
const serverRoundMean = new Function('mean', 'return ' + meanRoundExprText + ';');
const serverRoundDju  = new Function('dju19', 'return ' + djuRoundExprText + ';');

// ── Client : chargement du VRAI fichier navigateur dans un contexte vm isolé
// (même technique que tests/dju_test.js, reconduite ici pour rester
// autonome — chaque suite de ce dépôt se charge elle-même, sans dépendre
// d'un autre fichier de test). ──
function loadClientDju() {
  const src = fs.readFileSync(CLIENT_PATH, 'utf8');
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  new vm.Script(src, { filename: CLIENT_PATH }).runInContext(sandbox);
  if (!sandbox.window.MX || !sandbox.window.MX.Dju) throw new Error('window.MX.Dju non exporté par ' + CLIENT_PATH);
  return sandbox.window.MX.Dju;
}
const Dju = loadClientDju();

console.log('\n--- 0. Constantes et formes de formule ---');
{
  ok('0.1 DJU_BASE_TEMP (serveur, extrait) == BASE_TEMP (client)', SERVER_DJU_BASE_TEMP === Dju.BASE_TEMP);
}

// ── Scénarios partagés — entrées RÉALISTES, c-à-d construites comme le fait
// chaque appelant réel (jamais un tMin/tMax NaN : les deux call sites
// réels, buildDailySeries et computeDailyWeatherDju, ne transmettent QUE
// des number ou null — voir section 4 pour la seule divergence théorique,
// non atteignable en pratique, explicitement NON comptée comme un échec). ──
const CASES = [
  { label: 'moyenne API fournie (3.4°C)',                 tMin: -1,   tMax: 8,    tMeanApi: 3.4 },
  { label: 'moyenne estimée Tmin/Tmax (pas de moyenne API)', tMin: 2,  tMax: 10,   tMeanApi: undefined },
  { label: 'moyenne == base (19°C) -> DJU19 = 0',          tMin: 17,   tMax: 21,   tMeanApi: 19 },
  { label: 'moyenne > base (25°C, été) -> DJU19 = 0',      tMin: 20,   tMax: 30,   tMeanApi: 25 },
  { label: 'moyenne très froide (-10°C)',                  tMin: -14,  tMax: -6,   tMeanApi: undefined },
  { label: 'valeur à arrondir (.x5 exact)',                tMin: 14.9, tMax: 15.0, tMeanApi: undefined }, // mean=14.95 -> dju=4.05
  { label: 'tMin/tMax null, pas de moyenne API (donnée manquante réelle)', tMin: null, tMax: null, tMeanApi: undefined },
  { label: 'tMeanApi fournie seule, tMin/tMax null (API partielle)', tMin: null, tMax: null, tMeanApi: 6.2 },
];

console.log('\n--- 1. estimateMean (client) vs _estimateDailyMean (serveur, extraite) ---');
console.log('--- 2. Formule DJU19 (Math.max(0, BASE-mean), extraite côté serveur) ---');
console.log('--- 3. Arrondis (Math.round(x*10)/10, extraits côté serveur) ---');
CASES.forEach(function (c) {
  const clientMean = Dju.estimateMean(c.tMin, c.tMax, c.tMeanApi);
  const serverMean = _estimateDailyMean(c.tMin, c.tMax, c.tMeanApi);

  ok('1. [' + c.label + '] même valeur de moyenne retenue', clientMean.value === serverMean.value);
  ok('1. [' + c.label + '] même méthode (api_mean/minmax_avg/null)', clientMean.method === serverMean.method);

  if (clientMean.value === null) {
    ok('2. [' + c.label + '] moyenne null -> client.compute19 également null (jamais une valeur inventée)', Dju.compute19(clientMean.value) === null);
    return; // le serveur ne calcule jamais dju19 dans ce cas (retour anticipé réel, voir computeDailyWeatherDju) — rien à comparer de plus.
  }

  const clientDjuRaw = Dju.compute19(clientMean.value);
  const serverDjuRaw = serverDju19Raw(SERVER_DJU_BASE_TEMP, serverMean);
  ok('2. [' + c.label + '] DJU19 brut identique (formule Math.max(0, base-moyenne))', clientDjuRaw === serverDjuRaw);

  // Côté client, l'arrondi (buildDailySeries) : Math.round(x*10)/10 — même
  // opération que les expressions extraites côté serveur, appliquée ici
  // pour comparer des sorties "prêtes à persister" équivalentes.
  const clientDjuRounded  = Math.round(clientDjuRaw * 10) / 10;
  const clientMeanRounded = Math.round(clientMean.value * 10) / 10;
  const serverDjuRounded  = serverRoundDju(serverDjuRaw);
  const serverMeanRounded = serverRoundMean(serverMean);
  ok('3. [' + c.label + '] tMean arrondi identique', clientMeanRounded === serverMeanRounded);
  ok('3. [' + c.label + '] dju19 arrondi identique', clientDjuRounded === serverDjuRounded);
});

console.log('\n--- 4. Divergence RÉELLE mais NON ATTEIGNABLE en pratique (documentée, pas un échec) ---');
{
  // _estimateDailyMean (serveur) ne vérifie PAS isNaN(tMin)/isNaN(tMax) dans
  // la branche minmax_avg (seulement typeof === "number"), contrairement à
  // estimateMean (client). Si tMin ou tMax valait NaN, les deux
  // implémentations produiraient des résultats DIFFÉRENTS (client: null ;
  // serveur: une valeur NaN avec method:'minmax_avg'). CE N'EST PAS corrigé
  // ici (hors périmètre : toucher functions/index.js pour ce cas théorique
  // serait une modification non demandée) ni compté comme un échec, car
  // AUCUN des deux call sites réels (buildDailySeries côté client,
  // computeDailyWeatherDju côté serveur) ne peut produire tMin/tMax=NaN —
  // les deux le construisent uniquement via `typeof x === 'number' ? x :
  // null`, jamais NaN (et JSON ne sait pas sérialiser NaN). Documenté ici
  // pour qu'il ne soit jamais confondu avec une divergence silencieuse.
  const clientNaN = Dju.estimateMean(NaN, 10, undefined);
  const serverNaN = _estimateDailyMean(NaN, 10, undefined);
  const theyDiverge = !(clientNaN.value === serverNaN.value && clientNaN.method === serverNaN.method)
    || (Number.isNaN(clientNaN.value) !== Number.isNaN(serverNaN.value));
  console.log('    client.estimateMean(NaN, 10, undefined)        = ' + JSON.stringify(clientNaN));
  console.log('    serveur._estimateDailyMean(NaN, 10, undefined) = { value: ' + serverNaN.value + ', method: ' + JSON.stringify(serverNaN.method) + ' }');
  ok('4.1 Divergence théorique confirmée et isolée (tMin=NaN), non comptée comme régression', theyDiverge);
}

console.log('\n--- 5. Classification observé/prévisionnel — différence d\'architecture, pas une égalité testée ---');
{
  // Vérifie, par lecture directe du texte réel, que le serveur écrit bien
  // kind:"observed" EN DUR (jamais une classification calculée) — confirme
  // que l'absence de comparaison "classification" en section 1-3 ci-dessus
  // est voulue, pas un oubli : il n'y a rien de comparable à tester côté
  // serveur, par construction (il ne traite jamais que "hier", jamais
  // "aujourd'hui" ni un jour futur).
  ok('5.1 Le serveur écrit kind:"observed" en dur (aucune fonction de classification à comparer, par construction)', /kind:\s*"observed"/.test(serverSrc));
  ok('5.2 Le client, lui, calcule bien 3 classifications possibles (observed/forecast/missing) — asymétrie confirmée, pas une régression', /'observed'/.test(fs.readFileSync(CLIENT_PATH, 'utf8')) && /'forecast'/.test(fs.readFileSync(CLIENT_PATH, 'utf8')) && /'missing'/.test(fs.readFileSync(CLIENT_PATH, 'utf8')));
}

console.log('\n' + (failures === 0
  ? 'Tous les tests de cohérence croisée DJU client/serveur passent.'
  : failures + ' test(s) EN ÉCHEC — divergence(s) réelle(s) entre client et serveur à examiner.'));
process.exit(failures === 0 ? 0 : 1);
