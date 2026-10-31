(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // DJU (Degrés-Jours Unifiés) — module autonome, pur (aucun fetch, aucune
  // dépendance Firestore/db.js). Reçoit des données météo déjà récupérées
  // (voir assets/js/utils/weather.js:getDaily) et produit une série de DJU
  // exploitable par l'Accueil et la page CTA/VC.
  //
  // MÉTHODE (v1, volontairement simple) :
  //   DJU19 = max(0, 19 − température moyenne journalière)
  // où la température moyenne journalière est, par ordre de préférence :
  //   1. temperature_2m_mean fournie par Open-Meteo (vraie moyenne horaire),
  //   2. à défaut, l'estimation (Tmin + Tmax) / 2 — approximation standard
  //      des méthodes degrés-jours quand la moyenne horaire n'est pas
  //      disponible, explicitement signalée comme estimation.
  // Cette méthode est volontairement isolée dans compute19()/estimateMean()
  // pour rester simple à remplacer (ex. méthode Météo-France avec seuils de
  // chauffe, moyenne pondérée horaire, etc.) sans toucher au reste du code.
  // ══════════════════════════════════════════════════════════════════════

  var BASE_TEMP = 19;

  // estimateMean(tMin, tMax, tMeanApi) → { value, method }
  // method: 'api_mean' (donnée réelle Open-Meteo) | 'minmax_avg' (estimation).
  function estimateMean(tMin, tMax, tMeanApi) {
    if (typeof tMeanApi === 'number' && !isNaN(tMeanApi)) {
      return { value: tMeanApi, method: 'api_mean' };
    }
    if (typeof tMin === 'number' && !isNaN(tMin) && typeof tMax === 'number' && !isNaN(tMax)) {
      return { value: (tMin + tMax) / 2, method: 'minmax_avg' };
    }
    return { value: null, method: null };
  }

  // compute19(dailyMean) → DJU19 (number) ou null si donnée insuffisante.
  // Reste figé sur BASE_TEMP=19 (jamais paramétrable) : c'est la méthode
  // HISTORIQUE, utilisée pour le champ weather_daily.dju19 depuis l'origine
  // du module — ne jamais la faire varier avec la température de référence
  // configurable (refonte CTA/VC), pour ne jamais réinterpréter
  // silencieusement un historique déjà écrit. Voir computeAt() ci-dessous
  // pour le calcul à température de référence CONFIGURABLE.
  function compute19(dailyMean) {
    if (typeof dailyMean !== 'number' || isNaN(dailyMean)) return null;
    return Math.max(0, BASE_TEMP - dailyMean);
  }

  // computeAt(dailyMean, baseTemp) → DJU (number) ou null, à une température
  // de référence CONFIGURABLE (refonte CTA/VC — "DJU MX"). Calcul PUREMENT
  // DÉRIVÉ, jamais stocké : repart toujours de la température moyenne brute
  // déjà enregistrée (weather_daily.tMean, jamais modifiée) — changer la
  // référence ne réécrit donc jamais l'historique, seule la valeur DÉRIVÉE
  // affichée change, recalculée à la demande.
  function computeAt(dailyMean, baseTemp) {
    if (typeof dailyMean !== 'number' || isNaN(dailyMean)) return null;
    if (typeof baseTemp !== 'number' || isNaN(baseTemp)) baseTemp = BASE_TEMP;
    return Math.max(0, baseTemp - dailyMean);
  }

  // buildDailySeries(openMeteoDaily, todayStr) → [{
  //   date, weekday, tMin, tMax, tMean, meanMethod, dju19, djuMethod,
  //   weatherCode, kind: 'observed' | 'forecast' | 'missing'
  // }, …]
  //
  // openMeteoDaily = le bloc `daily` tel que renvoyé par l'API Open-Meteo
  // (time[], temperature_2m_min[], temperature_2m_max[], temperature_2m_mean[]
  // si demandée, weather_code[]). todayStr = date du jour au format
  // AAAA-MM-JJ (fuseau de l'établissement — à fournir par l'appelant, ce
  // module ne lit jamais l'horloge directement pour rester pur/testable).
  //
  // kind :
  //   'observed' = jour strictement antérieur à aujourd'hui (past_days de
  //                l'API — donnée réellement mesurée, jamais une prévision).
  //   'forecast' = aujourd'hui ou jour futur — la journée n'est pas
  //                terminée ou n'a pas encore eu lieu, donc jamais présentée
  //                comme observée, même si Open-Meteo renvoie déjà un
  //                Tmin/Tmax pour aujourd'hui (susceptible de changer).
  //   'missing'  = aucune donnée exploitable pour ce jour.
  // baseTemp (3e paramètre, optionnel) : température de référence DJU
  // CONFIGURABLE (refonte CTA/VC — "DJU MX"). Ajoute un champ `dju` calculé à
  // cette référence, en PLUS de `dju19` (toujours figé à 19, inchangé — voir
  // compute19 ci-dessus). Omis ou égal à 19, `dju` === `dju19` : aucune
  // régression pour l'Accueil ni les appelants existants qui ignorent ce
  // paramètre ou ne lisent que `dju19`.
  function buildDailySeries(openMeteoDaily, todayStr, baseTemp) {
    if (!openMeteoDaily || !Array.isArray(openMeteoDaily.time)) return [];
    var times   = openMeteoDaily.time;
    var tMins   = openMeteoDaily.temperature_2m_min  || [];
    var tMaxs   = openMeteoDaily.temperature_2m_max  || [];
    var tMeans  = openMeteoDaily.temperature_2m_mean || [];
    var codes   = openMeteoDaily.weather_code        || [];
    var ref     = (typeof baseTemp === 'number' && !isNaN(baseTemp)) ? baseTemp : BASE_TEMP;

    return times.map(function (date, i) {
      var tMin = typeof tMins[i] === 'number' ? tMins[i] : null;
      var tMax = typeof tMaxs[i] === 'number' ? tMaxs[i] : null;
      var est  = estimateMean(tMin, tMax, tMeans[i]);
      var dju  = compute19(est.value);
      var djuRef = computeAt(est.value, ref);
      // 'missing' doit suivre EXACTEMENT l'absence de moyenne exploitable
      // (est.value === null), pas seulement tMin/tMax : un jour où l'API ne
      // fournirait QUE temperature_2m_mean (sans min/max) a un DJU valide et
      // ne doit jamais être étiqueté 'missing' (bug corrigé — l'ancienne
      // condition ne testait que tMin/tMax, désynchronisée de dju19).
      var kind = (est.value === null) ? 'missing' : (date < todayStr ? 'observed' : 'forecast');
      return {
        date: date,
        tMin: tMin,
        tMax: tMax,
        tMean: (typeof est.value === 'number') ? Math.round(est.value * 10) / 10 : null,
        meanMethod: est.method,
        dju19: (dju !== null) ? Math.round(dju * 10) / 10 : null,
        dju: (djuRef !== null) ? Math.round(djuRef * 10) / 10 : null,
        djuBaseTemp: ref,
        djuMethod: est.method,
        weatherCode: (typeof codes[i] === 'number') ? codes[i] : null,
        kind: kind,
      };
    });
  }

  // trend(series) → 'hausse' | 'baisse' | 'stable' | null
  // Compare la moyenne DJU des jours à venir (forecast) à celle des jours
  // passés (observed) déjà présents dans la série fournie. Retourne null si
  // l'un des deux groupes est vide (pas assez de recul pour comparer).
  // field (2e paramètre, optionnel) : 'dju19' (défaut, inchangé — Accueil) ou
  // 'dju' (référence configurable — refonte CTA/VC) pour que le moteur
  // quantitatif base sa tendance sur la MÊME référence que les propositions
  // chiffrées, jamais sur 19 si une autre référence est configurée.
  function trend(series, field) {
    field = field === 'dju' ? 'dju' : 'dju19';
    var past = series.filter(function (d) { return d.kind === 'observed' && d[field] !== null; });
    var next = series.filter(function (d) { return d.kind === 'forecast' && d[field] !== null; });
    if (!past.length || !next.length) return null;
    var avgPast = past.reduce(function (s, d) { return s + d[field]; }, 0) / past.length;
    var avgNext = next.reduce(function (s, d) { return s + d[field]; }, 0) / next.length;
    var diff = avgNext - avgPast;
    if (Math.abs(diff) < 0.5) return 'stable';
    return diff > 0 ? 'hausse' : 'baisse';
  }

  // parisDateStr(d) → "AAAA-MM-JJ" dans le fuseau Europe/Paris, JAMAIS le
  // fuseau local de l'appareil. Reste une fonction PURE comme le reste de ce
  // module (ne lit jamais l'horloge elle-même : reçoit toujours une Date
  // déjà connue de l'appelant, par défaut new Date() si omise, pour rester
  // testable avec des instants fixes).
  //
  // Corrige un bug réel : assets/js/pages/home.js et assets/js/app.js
  // calculaient auparavant "aujourd'hui" avec new Date().getFullYear()/
  // getMonth()/getDate() — le calendrier LOCAL DE L'APPAREIL, pas celui de
  // l'établissement (Europe/Paris). Sur un appareil réglé sur un autre
  // fuseau, la comparaison date < todayStr (ci-dessus, buildDailySeries)
  // pouvait alors :
  //   - classer en 'forecast' un jour déjà réellement observé à Paris
  //     (fuseau de l'appareil en retard sur Paris) -> ce jour n'est jamais
  //     persisté dans weather_daily (voir app.js:_ensureDailyDjuPersisted,
  //     qui ne persiste que kind:'observed') -> TROU dans l'historique ;
  //   - classer en 'observed' un jour PAS ENCORE terminé à Paris (fuseau de
  //     l'appareil en avance sur Paris) -> cette donnée provisoire est alors
  //     écrite comme définitive, et plus jamais recalculée ensuite (ni par
  //     le client, ni par functions/index.js:computeDailyWeatherDju, qui
  //     ignore tout jour déjà kind:'observed' pour la même localisation) ->
  //     valeur FIGÉE incorrecte, de façon permanente.
  // Même méthode que functions/index.js:_parisDateStr (toLocaleDateString
  // 'en-CA' avec timeZone explicite), désormais partagée par un seul point
  // côté client pour ne pas la dupliquer dans home.js ET app.js séparément.
  function parisDateStr(d) {
    d = d || new Date();
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  }

  // recomputeStoredDay(dayDoc, baseTemp) → dayDoc avec `dju` recalculé.
  // Pour un document weather_daily DÉJÀ enregistré (historique, voir
  // assets/js/db.js:listenWeatherDailyRange) : repart TOUJOURS de
  // dayDoc.tMean (donnée brute observée, jamais modifiée en base — voir
  // functions/index.js:computeDailyWeatherDju, qui n'écrit jamais `dju`,
  // seulement `dju19` figé à 19 et `tMean`). Ne modifie jamais l'objet reçu
  // ni le document Firestore — calcul dérivé en mémoire uniquement, à
  // chaque lecture. C'est ce qui rend le changement de référence DJU
  // CONFIGURABLE (refonte CTA/VC) non destructif : aucun document
  // historique n'est jamais réécrit, seule la valeur affichée change.
  function recomputeStoredDay(dayDoc, baseTemp) {
    if (!dayDoc) return dayDoc;
    var ref = (typeof baseTemp === 'number' && !isNaN(baseTemp)) ? baseTemp : BASE_TEMP;
    var dju = computeAt(dayDoc.tMean, ref);
    return Object.assign({}, dayDoc, {
      dju: (dju !== null) ? Math.round(dju * 10) / 10 : null,
      djuBaseTemp: ref,
    });
  }

  window.MX = window.MX || {};
  window.MX.Dju = {
    BASE_TEMP: BASE_TEMP,
    estimateMean: estimateMean,
    compute19: compute19,
    computeAt: computeAt,
    buildDailySeries: buildDailySeries,
    recomputeStoredDay: recomputeStoredDay,
    trend: trend,
    parisDateStr: parisDateStr,
  };
})();
