// Test unitaire PUR (Node, sans Playwright, sans firebase-admin/émulateur) du
// calcul de "la veille en Europe/Paris" utilisé par la fonction planifiée
// computeDailyWeatherDju (functions/index.js). Aucune Cloud Function n'est
// déployée ni exécutée ici — on extrait le VRAI code source de
// _yesterdayParisDateStr/_parisDateStr (pas une copie entretenue à la main)
// pour garantir que ce test suit automatiquement toute évolution future de
// l'algorithme, et on l'exécute en isolation.
//
// Démontre concrètement pourquoi l'ancienne méthode (soustraction de 24h en
// millisecondes) pouvait produire la MAUVAISE date calendaire lors d'un
// changement d'heure Europe/Paris, et que la nouvelle méthode (purement
// calendaire) reste correcte dans le même cas.

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'functions', 'index.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// Extrait le texte source COMPLET d'une fonction nommée, de "function name("
// jusqu'à SA PROPRE accolade fermante — par comptage de profondeur
// d'accolades (en ignorant celles à l'intérieur des chaînes/commentaires),
// jamais par un motif de fin de ligne ("\n}\n"). Portable (Windows/macOS/
// Linux) : ne dépend d'aucune convention de saut de ligne (LF/CRLF), et
// fonctionne aussi bien si le corps de la fonction tient sur une seule
// ligne (ex. _parisDateStr) que sur plusieurs (ex. _yesterdayParisDateStr).
// Le comptage de profondeur garantit aussi que l'extraction s'arrête
// exactement à l'accolade fermante DE CETTE fonction et ne déborde jamais
// sur la fonction suivante, même si celle-ci contient elle-même des
// accolades imbriquées.
function extractFn(name) {
  const startRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = startRe.exec(src);
  if (!m) throw new Error('Fonction ' + name + ' introuvable dans functions/index.js — a-t-elle été renommée/déplacée ? Ce test doit être mis à jour.');

  const start = m.index;
  let i = start + m[0].length; // juste après l'accolade ouvrante de la fonction
  let depth = 1;
  let inString = null; // null | '"' | "'" | '`'
  let inLineComment = false;
  let inBlockComment = false;

  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (c === '\\') { i++; continue; } // caractère échappé, ne pas interpréter
      if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  if (depth !== 0) throw new Error('Fonction ' + name + ' : accolades non équilibrées dans functions/index.js — extraction impossible (le fichier a peut-être changé de forme). Ce test doit être mis à jour.');

  return src.slice(start, i);
}

// Reconstruit les 2 fonctions pures dans ce scope, à partir du texte RÉEL de
// functions/index.js (extrait par regex, pas re-saisi à la main).
eval(extractFn('_parisDateStr'));
eval(extractFn('_yesterdayParisDateStr'));

// Ancienne méthode (celle remplacée) — conservée ICI uniquement pour
// démontrer par comparaison directe qu'elle produisait une date différente
// (et incorrecte) au moment précis d'un changement d'heure.
function _yesterdayParisDateStr_OLD_BUGGY(now) {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return _parisDateStr(yesterday);
}

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label); }
}

// ── 1. Jour normal, loin de tout changement d'heure ──
ok('1.1 Jour normal (janvier, CET) : veille = jour calendaire précédent',
  _yesterdayParisDateStr(new Date('2026-01-15T00:30:00Z')) === '2026-01-14');
ok('1.2 Jour normal (juillet, CEST) : veille = jour calendaire précédent',
  _yesterdayParisDateStr(new Date('2026-07-15T23:20:00Z')) === '2026-07-15');

// ── 2. Horaire réel de déclenchement (01:30 Europe/Paris) un jour normal ──
// 01:30 CET (UTC+1) = 00:30 UTC.
ok('2.1 Déclenchement réel 01:30 Europe/Paris (CET, hiver) -> bonne date',
  _yesterdayParisDateStr(new Date('2026-01-15T00:30:00Z')) === '2026-01-14');
// 01:30 CEST (UTC+2) = 23:30 UTC la veille.
ok('2.2 Déclenchement réel 01:30 Europe/Paris (CEST, été) -> bonne date',
  _yesterdayParisDateStr(new Date('2026-07-14T23:30:00Z')) === '2026-07-14');

// ── 3. Passage à l'heure d'été (dernier dimanche de mars 2026 = 29/03, 01:00 UTC) ──
// Cas concret où l'ancienne méthode se trompait d'un jour calendaire entier :
// "maintenant" = 30 mars 2026, 00:20 locale (CEST, UTC+2) = 29 mars 22:20 UTC.
// Réponse correcte attendue : "2026-03-29".
const DST_SPRING_NOW = new Date('2026-03-29T22:20:00Z');
ok('3.1 Changement d\'heure (printemps) — nouvelle méthode correcte',
  _yesterdayParisDateStr(DST_SPRING_NOW) === '2026-03-29');
ok('3.2 Changement d\'heure (printemps) — l\'ANCIENNE méthode se trompait bien d\'un jour (régression démontrée)',
  _yesterdayParisDateStr_OLD_BUGGY(DST_SPRING_NOW) === '2026-03-28');

// ── 4. Passage à l'heure d'hiver (dernier dimanche d'octobre 2026 = 25/10, 01:00 UTC) ──
// Déclenchement réel 01:30 Europe/Paris le jour du changement -> encore CEST
// à cette heure-là (le changement a lieu à 03:00 CEST -> 02:00 CET) :
// 01:30 CEST = 23:30 UTC la veille.
ok('4.1 Jour du changement d\'heure (automne), déclenchement réel 01:30 -> bonne date',
  _yesterdayParisDateStr(new Date('2026-10-24T23:30:00Z')) === '2026-10-24');
// Le lendemain du changement, 01:30 Europe/Paris est redevenu CET (UTC+1) : 00:30 UTC.
ok('4.2 Lendemain du changement d\'heure (automne), déclenchement réel 01:30 -> bonne date',
  _yesterdayParisDateStr(new Date('2026-10-26T00:30:00Z')) === '2026-10-25');

// ── 5. Changement d'année / de mois (robustesse générale du calcul calendaire) ──
ok('5.1 Nouvel An : veille du 1er janvier = 31 décembre de l\'année précédente',
  _yesterdayParisDateStr(new Date('2026-01-01T00:30:00Z')) === '2025-12-31');
ok('5.2 Changement de mois (28 -> 1er mars, 2026 n\'est pas bissextile)',
  _yesterdayParisDateStr(new Date('2026-03-01T00:30:00Z')) === '2026-02-28');

// ══════════════════════════════════════════════════════════════════════
// ── 6. TEST D'INTÉGRATION — le VRAI handler computeDailyWeatherDju ──
// Au-delà des 2 fonctions pures de date ci-dessus, cette section exécute
// pour de vrai le corps complet de la Cloud Function (lecture config,
// idempotence, appel réseau, écriture) — sans émulateur Firestore
// (indisponible dans cet environnement) et sans déployer ni installer
// firebase-admin/firebase-functions (non installés dans functions/).
//
// Technique : on intercepte temporairement Module._load pour que les 3
// require() de functions/index.js résolvent vers des stubs minimalistes
// (admin.firestore() en mémoire, onSchedule qui restitue juste le handler
// au lieu de l'enregistrer) au lieu d'échouer en MODULE_NOT_FOUND. Le
// fichier réel est ensuite chargé une seule fois tel quel — aucune copie
// de sa logique. Module._load est restauré immédiatement après le require.
const Module = require('module');

// failPaths (Étape 3, section 7) : ensemble optionnel de clés pour lesquelles
// get()/set() doivent lever une exception — simule une panne Firestore
// réelle (permission, indisponibilité...) sans émulateur. Une entrée bare
// "collection/id" fait échouer get() ET set() pour ce document (usage
// historique, inchangé) ; une entrée préfixée "get:collection/id" ou
// "set:collection/id" (Étape 4.1) cible UNIQUEMENT la lecture ou UNIQUEMENT
// l'écriture de ce document, pour isoler précisément lequel des deux chemins
// d'erreur de _persistOneObservedDay est exercé.
function makeFakeDb(seed, failPaths) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const fail = failPaths || new Set();
  return {
    collection(name) {
      store[name] = store[name] || {};
      return {
        doc(id) {
          const path = name + '/' + id;
          return {
            async get() {
              if (fail.has(path) || fail.has('get:' + path)) throw new Error('FAKE_FIRESTORE_ERROR(get:' + path + ')');
              const exists = Object.prototype.hasOwnProperty.call(store[name], id);
              return { exists, data: () => store[name][id] };
            },
            async set(data, opts) {
              if (fail.has(path) || fail.has('set:' + path)) throw new Error('FAKE_FIRESTORE_ERROR(set:' + path + ')');
              if (opts && opts.merge && store[name][id]) store[name][id] = Object.assign({}, store[name][id], data);
              else store[name][id] = Object.assign({}, data);
            },
          };
        },
      };
    },
    _store: store,
  };
}

let _fakeDb = makeFakeDb();
const _fakeAdmin = {
  initializeApp: function () {},
  firestore: Object.assign(function () { return _fakeDb; }, { FieldValue: { serverTimestamp: function () { return 'SERVER_TIMESTAMP_STUB'; } } }),
  messaging: function () { return {}; },
};
function _descriptorFn(config, handler) { return { __config: config, __handler: handler }; }
const STUBS = {
  'firebase-admin': _fakeAdmin,
  'firebase-functions/v2/firestore': { onDocumentCreated: _descriptorFn, onDocumentWritten: _descriptorFn },
  'firebase-functions/v2/scheduler': { onSchedule: _descriptorFn },
};

let fnExports;
{
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return originalLoad.apply(this, arguments);
  };
  try {
    fnExports = require(SRC_PATH);
  } finally {
    Module._load = originalLoad; // restauré immédiatement, que le require réussisse ou non
  }
}

ok('6.0 functions/index.js se charge avec les stubs, computeDailyWeatherDju exporté',
  !!fnExports.computeDailyWeatherDju && typeof fnExports.computeDailyWeatherDju.__handler === 'function');
ok('6.0b Planification réelle : "30 1 * * *", Europe/Paris (vérifiée sur la config EXPORTÉE, pas recopiée)',
  fnExports.computeDailyWeatherDju.__config.schedule === '30 1 * * *' && fnExports.computeDailyWeatherDju.__config.timeZone === 'Europe/Paris');

const _runHandler = fnExports.computeDailyWeatherDju.__handler;

// Fetch global stubbable par scénario — jamais de vrai réseau.
const _origFetch = global.fetch;
function _mockFetch(impl) { global.fetch = impl; }
function _restoreFetch() { global.fetch = _origFetch; }

function _openMeteoOkResponse(dateStr, tMin, tMax, tMean) {
  return { ok: true, json: async () => ({ daily: { time: [dateStr], temperature_2m_min: [tMin], temperature_2m_max: [tMax], temperature_2m_mean: [tMean] } }) };
}

(async () => {
  // 6.1 — Pas de lat/lon configurés -> aucun appel réseau, rien n'est écrit.
  {
    let fetchCalled = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: {} } });
    _mockFetch(async () => { fetchCalled = true; return _openMeteoOkResponse('2020-01-01', 1, 2, 1.5); });
    await _runHandler();
    ok('6.1 Localisation non configurée -> aucun appel réseau, rien n\'est écrit', !fetchCalled && Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 6.2 — Jour déjà "observed" pour la MÊME localisation -> idempotent, aucun appel réseau.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    let fetchCalled = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } }, weather_daily: { [yesterdayStr]: { date: yesterdayStr, kind: 'observed', lat: 48.75, lon: 2.36, tMean: 5 } } });
    _mockFetch(async () => { fetchCalled = true; return _openMeteoOkResponse(yesterdayStr, 1, 2, 1.5); });
    await _runHandler();
    ok('6.2 Jour déjà "observed" pour la MÊME localisation -> rejoué sans appel réseau ni modification (idempotence)',
      !fetchCalled && _fakeDb._store.weather_daily[yesterdayStr].tMean === 5);
    _restoreFetch();
  }

  // 6.3 — Jour déjà "observed" mais pour une AUTRE localisation -> reconstruit avec les nouvelles coordonnées.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 43.0, lon: 5.0 } }, weather_daily: { [yesterdayStr]: { date: yesterdayStr, kind: 'observed', lat: 48.75, lon: 2.36, tMean: 5 } } });
    _mockFetch(async () => _openMeteoOkResponse(yesterdayStr, 10, 20, 15));
    await _runHandler();
    const doc = _fakeDb._store.weather_daily[yesterdayStr];
    ok('6.3 Jour "observed" existant pour une AUTRE localisation -> reconstruit (pas conservé silencieusement)',
      doc.lat === 43.0 && doc.lon === 5.0 && doc.tMean === 15);
    _restoreFetch();
  }

  // 6.4 — Écriture normale (aucun doc existant) : DJU19/tMean/kind/lat/lon corrects.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async () => _openMeteoOkResponse(yesterdayStr, 10, 14, 12));
    await _runHandler();
    const doc = _fakeDb._store.weather_daily[yesterdayStr];
    ok('6.4 Écriture normale : tMean/dju19/kind/lat/lon tous corrects',
      !!doc && doc.tMean === 12 && doc.dju19 === 7 && doc.kind === 'observed' && doc.lat === 48.75 && doc.lon === 2.36 && doc.source === 'cloud-function-scheduled');
    _restoreFetch();
  }

  // 6.5 — Échec réseau (exception) : rien n'est écrit, pas d'exception non interceptée.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async () => { throw new Error('network down'); });
    let threw = false;
    try { await _runHandler(); } catch (e) { threw = true; }
    ok('6.5 Échec réseau (exception fetch) : géré proprement, aucune exception ne remonte, rien n\'est écrit',
      !threw && Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 6.6 — Réponse HTTP non-ok (ex: 500) : rien n'est écrit.
  {
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async () => ({ ok: false, status: 500 }));
    await _runHandler();
    ok('6.6 Réponse HTTP non-ok (500) : rien n\'est écrit', Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 6.7 — Date cible absente de la réponse Open-Meteo : rien n'est écrit (jamais de donnée inventée).
  {
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async () => _openMeteoOkResponse('1999-01-01', 1, 2, 1.5)); // jamais la date attendue
    await _runHandler();
    ok('6.7 Date cible absente de la réponse -> rien n\'est écrit (jamais de donnée inventée)', Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 6.8 — Aucune température exploitable (tMin/tMax/tMean tous absents) : rien n'est écrit.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async () => ({ ok: true, json: async () => ({ daily: { time: [yesterdayStr], temperature_2m_min: [null], temperature_2m_max: [null] } }) }));
    await _runHandler();
    ok('6.8 Aucune température exploitable -> rien n\'est écrit', Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 6.9 — Rejouer DEUX FOIS la fonction pour la même nuit, même localisation -> aucun doublon, toujours idempotent.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    let fetchCount = 0;
    _mockFetch(async () => { fetchCount++; return _openMeteoOkResponse(yesterdayStr, 10, 14, 12); });
    await _runHandler();
    await _runHandler();
    ok('6.9 Rejouée deux fois pour la même nuit -> un seul appel réseau, un seul document, aucun doublon',
      fetchCount === 1 && Object.keys(_fakeDb._store.weather_daily || {}).length === 1);
    _restoreFetch();
  }

  // ══════════════════════════════════════════════════════════════════════
  // ── 7. ÉTAPE 3 — scénarios critiques ajoutés : lat/lon invalides, erreurs
  // Firestore, délai dépassé réseau, et rattrapage de jours antérieurs
  // (fenêtre déjà reçue dans la même réponse Open-Meteo). ──
  // Petit utilitaire LOCAL AU TEST (construction de dates de fixtures
  // uniquement, ne teste rien par lui-même) — même méthode calendaire que
  // _yesterdayParisDateStr, généralisée à N jours, pour fabriquer des
  // entrées de test réalistes sans dépendre d'une date figée.
  function _testDaysAgoStr(n) {
    const base = _parisDateStr(new Date());
    const parts = base.split('-').map(Number);
    const noonUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    noonUtc.setUTCDate(noonUtc.getUTCDate() - n);
    return _parisDateStr(noonUtc);
  }

  // 7.1 — Lecture Firestore de config/hotel_config en échec (ex. panne,
  // permission) -> pas d'exception non interceptée, aucun appel réseau, rien écrit.
  {
    let fetchCalled = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } }, new Set(['config/hotel_config']));
    _mockFetch(async () => { fetchCalled = true; return _openMeteoOkResponse(_yesterdayParisDateStr(new Date()), 1, 2, 1.5); });
    let threw = false;
    try { await _runHandler(); } catch (e) { threw = true; }
    ok('7.1 Erreur Firestore (lecture config/hotel_config) : gérée proprement, aucune exception, aucun appel réseau',
      !threw && !fetchCalled);
    _restoreFetch();
  }

  // 7.2 — Lecture Firestore de weather_daily/{hier} (vérif. d'idempotence
  // PRÉALABLE au fetch) en échec -> pas d'exception, aucun appel réseau.
  {
    const yesterdayStr = _yesterdayParisDateStr(new Date());
    let fetchCalled = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } }, new Set(['weather_daily/' + yesterdayStr]));
    _mockFetch(async () => { fetchCalled = true; return _openMeteoOkResponse(yesterdayStr, 1, 2, 1.5); });
    let threw = false;
    try { await _runHandler(); } catch (e) { threw = true; }
    ok('7.2 Erreur Firestore (lecture weather_daily de la veille) : gérée proprement, aucune exception, aucun appel réseau',
      !threw && !fetchCalled);
    _restoreFetch();
  }

  // 7.3 — Latitude hors bornes valides (> 90) -> aucun appel réseau, rien écrit.
  {
    let fetchCalled = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 200, lon: 2.36 } } });
    _mockFetch(async () => { fetchCalled = true; return _openMeteoOkResponse(_yesterdayParisDateStr(new Date()), 1, 2, 1.5); });
    await _runHandler();
    ok('7.3a Latitude hors bornes (200) -> aucun appel réseau, rien n\'est écrit', !fetchCalled && Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }
  // 7.3b — Longitude hors bornes valides (< -180) -> même traitement.
  {
    let fetchCalled = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: -500 } } });
    _mockFetch(async () => { fetchCalled = true; return _openMeteoOkResponse(_yesterdayParisDateStr(new Date()), 1, 2, 1.5); });
    await _runHandler();
    ok('7.3b Longitude hors bornes (-500) -> aucun appel réseau, rien n\'est écrit', !fetchCalled && Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 7.4 — Délai Open-Meteo dépassé (fetch rejeté par AbortController) ->
  // pas d'exception non interceptée, rien écrit ; le signal d'abandon est
  // bien transmis à fetch (préalable réel à tout délai dépassé).
  {
    let sawSignal = false;
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async (url, opts) => {
      sawSignal = !!(opts && opts.signal && typeof opts.signal.aborted === 'boolean');
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });
    let threw = false;
    try { await _runHandler(); } catch (e) { threw = true; }
    ok('7.4a Un AbortSignal est bien transmis à fetch (préalable à tout délai dépassé réel)', sawSignal);
    ok('7.4b Délai dépassé simulé (AbortError) : géré proprement, aucune exception, rien n\'est écrit',
      !threw && Object.keys(_fakeDb._store.weather_daily || {}).length === 0);
    _restoreFetch();
  }

  // 7.5 — Rattrapage : jour-3 déjà "observed" (ne doit pas être réécrit),
  // jour-2 pas encore observé (doit être écrit), hier pas encore observé
  // (doit être écrit) — TOUT dans la MÊME réponse Open-Meteo, sans second
  // appel réseau.
  {
    const d1 = _yesterdayParisDateStr(new Date()); // hier
    const d2 = _testDaysAgoStr(2);
    const d3 = _testDaysAgoStr(3);
    let fetchCount = 0;
    _fakeDb = makeFakeDb({
      config: { hotel_config: { lat: 48.75, lon: 2.36 } },
      weather_daily: { [d3]: { date: d3, kind: 'observed', lat: 48.75, lon: 2.36, tMean: 99 } }, // déjà finalisé, ne doit pas changer
    });
    _mockFetch(async () => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ({ daily: {
          time: [d3, d2, d1],
          temperature_2m_min:  [1, 2, 3],
          temperature_2m_max:  [5, 6, 7],
          temperature_2m_mean: [3, 4, 5],
        } }),
      };
    });
    await _runHandler();
    const store = _fakeDb._store.weather_daily;
    ok('7.5a Un seul appel réseau pour toute la fenêtre de rattrapage', fetchCount === 1);
    ok('7.5b Jour-3 déjà "observed" : INCHANGÉ (pas réécrasé)', store[d3].tMean === 99);
    ok('7.5c Jour-2 (pas encore observé) : rattrapé dans la même exécution', !!store[d2] && store[d2].tMean === 4 && store[d2].kind === 'observed');
    ok('7.5d Hier (pas encore observé) : toujours écrit normalement', !!store[d1] && store[d1].tMean === 5 && store[d1].kind === 'observed');
    _restoreFetch();
  }

  // 7.6 — Jour présent dans la réponse mais HORS de la fenêtre de rattrapage
  // réellement demandée (> BACKFILL_WINDOW_DAYS avant aujourd'hui) -> jamais
  // traité, même si la donnée serait par ailleurs exploitable (défense en
  // profondeur contre une réponse inattendue).
  {
    const d1 = _yesterdayParisDateStr(new Date());
    const dOld = _testDaysAgoStr(10); // bien au-delà de BACKFILL_WINDOW_DAYS (3) et de past_days (3)
    _fakeDb = makeFakeDb({ config: { hotel_config: { lat: 48.75, lon: 2.36 } } });
    _mockFetch(async () => ({
      ok: true,
      json: async () => ({ daily: {
        time: [dOld, d1],
        temperature_2m_min:  [1, 3],
        temperature_2m_max:  [5, 7],
        temperature_2m_mean: [3, 5],
      } }),
    }));
    await _runHandler();
    const store = _fakeDb._store.weather_daily;
    ok('7.6a Hier bien écrit normalement', !!store[d1]);
    ok('7.6b Jour hors fenêtre (10 jours avant) jamais écrit, malgré une donnée exploitable présente', !store[dOld]);
    _restoreFetch();
  }

  // ══════════════════════════════════════════════════════════════════════
  // ── 8. ÉTAPE 4.1 — erreur Firestore sur UN SEUL jour précis EN PLEIN
  // rattrapage, pendant que d'autres jours de la MÊME exécution réussissent.
  // Reproduit une VRAIE erreur Firestore dans la fausse base (pas une
  // réponse météo invalide) : fail = 'set:weather_daily/{d2}' -> get()
  // réussit normalement pour d2 (non encore observé), puis set() lève une
  // exception réelle, interceptée par _persistOneObservedDay. ──
  {
    const d1 = _yesterdayParisDateStr(new Date());
    const d2 = _testDaysAgoStr(2);
    const d3 = _testDaysAgoStr(3);
    _fakeDb = makeFakeDb(
      {
        config: { hotel_config: { lat: 48.75, lon: 2.36 } },
        weather_daily: { [d3]: { date: d3, kind: 'observed', lat: 48.75, lon: 2.36, tMean: 99 } }, // historique existant, ne doit pas être écrasé
      },
      new Set(['set:weather_daily/' + d2]) // échec RÉEL ciblé sur l'écriture de d2 uniquement
    );
    _mockFetch(async () => ({
      ok: true,
      json: async () => ({ daily: {
        time: [d3, d2, d1],
        temperature_2m_min:  [1, 2, 3],
        temperature_2m_max:  [5, 6, 7],
        temperature_2m_mean: [3, 4, 5],
      } }),
    }));
    let threw = false;
    try { await _runHandler(); } catch (e) { threw = true; }
    const store = _fakeDb._store.weather_daily;
    ok('8.1 Aucune exception non interceptée ne fait échouer toute la fonction', !threw);
    ok('8.2 Jour-3 (historique déjà observé) : jamais écrasé par l\'erreur sur un autre jour', store[d3].tMean === 99);
    ok('8.3 Jour-2 (set() en échec) : jamais déclaré enregistré (document absent, pas de donnée partielle/fausse)', !store[d2]);
    ok('8.4 Hier (jour valide suivant dans la même boucle) : quand même traité et enregistré normalement', !!store[d1] && store[d1].tMean === 5 && store[d1].kind === 'observed');
    _restoreFetch();
  }

  // 8.5 — Variante : échec sur la LECTURE (get) d'un jour précis du
  // rattrapage, pas seulement l'écriture — même garanties.
  {
    const d1 = _yesterdayParisDateStr(new Date());
    const d2 = _testDaysAgoStr(2);
    const d3 = _testDaysAgoStr(3);
    _fakeDb = makeFakeDb(
      {
        config: { hotel_config: { lat: 48.75, lon: 2.36 } },
        weather_daily: { [d3]: { date: d3, kind: 'observed', lat: 48.75, lon: 2.36, tMean: 99 } },
      },
      new Set(['get:weather_daily/' + d2])
    );
    _mockFetch(async () => ({
      ok: true,
      json: async () => ({ daily: {
        time: [d3, d2, d1],
        temperature_2m_min:  [1, 2, 3],
        temperature_2m_max:  [5, 6, 7],
        temperature_2m_mean: [3, 4, 5],
      } }),
    }));
    let threw = false;
    try { await _runHandler(); } catch (e) { threw = true; }
    const store = _fakeDb._store.weather_daily;
    ok('8.5a Échec de LECTURE sur un jour précis : aucune exception non interceptée', !threw);
    ok('8.5b Jour-3 (historique) toujours inchangé', store[d3].tMean === 99);
    ok('8.5c Jour-2 (get() en échec) jamais déclaré enregistré', !store[d2]);
    ok('8.5d Hier toujours traité et enregistré normalement malgré l\'échec d\'un autre jour', !!store[d1] && store[d1].tMean === 5);
    _restoreFetch();
  }

  console.log('');
  console.log(pass + ' OK, ' + fail + ' FAIL');
  if (fail > 0) { console.log('DES TESTS ONT ÉCHOUÉ'); process.exit(1); }
  console.log('TOUS LES TESTS PASSENT ✓');
})();
