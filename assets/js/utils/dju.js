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
  function compute19(dailyMean) {
    if (typeof dailyMean !== 'number' || isNaN(dailyMean)) return null;
    return Math.max(0, BASE_TEMP - dailyMean);
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
  function buildDailySeries(openMeteoDaily, todayStr) {
    if (!openMeteoDaily || !Array.isArray(openMeteoDaily.time)) return [];
    var times   = openMeteoDaily.time;
    var tMins   = openMeteoDaily.temperature_2m_min  || [];
    var tMaxs   = openMeteoDaily.temperature_2m_max  || [];
    var tMeans  = openMeteoDaily.temperature_2m_mean || [];
    var codes   = openMeteoDaily.weather_code        || [];

    return times.map(function (date, i) {
      var tMin = typeof tMins[i] === 'number' ? tMins[i] : null;
      var tMax = typeof tMaxs[i] === 'number' ? tMaxs[i] : null;
      var est  = estimateMean(tMin, tMax, tMeans[i]);
      var dju  = compute19(est.value);
      var kind = (tMin === null && tMax === null) ? 'missing' : (date < todayStr ? 'observed' : 'forecast');
      return {
        date: date,
        tMin: tMin,
        tMax: tMax,
        tMean: (typeof est.value === 'number') ? Math.round(est.value * 10) / 10 : null,
        meanMethod: est.method,
        dju19: (dju !== null) ? Math.round(dju * 10) / 10 : null,
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
  function trend(series) {
    var past = series.filter(function (d) { return d.kind === 'observed' && d.dju19 !== null; });
    var next = series.filter(function (d) { return d.kind === 'forecast' && d.dju19 !== null; });
    if (!past.length || !next.length) return null;
    var avgPast = past.reduce(function (s, d) { return s + d.dju19; }, 0) / past.length;
    var avgNext = next.reduce(function (s, d) { return s + d.dju19; }, 0) / next.length;
    var diff = avgNext - avgPast;
    if (Math.abs(diff) < 0.5) return 'stable';
    return diff > 0 ? 'hausse' : 'baisse';
  }

  window.MX = window.MX || {};
  window.MX.Dju = {
    BASE_TEMP: BASE_TEMP,
    estimateMean: estimateMean,
    compute19: compute19,
    buildDailySeries: buildDailySeries,
    trend: trend,
  };
})();
