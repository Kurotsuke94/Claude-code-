(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // MÉTÉO — module autonome, sans dépendance à db.js/Firestore.
  // Fournit UNIQUEMENT de vraies données (Open-Meteo, gratuit, sans clé) ou
  // null en cas d'échec/timeout — jamais de valeur inventée. Mise en cache
  // localStorage (45 min) pour éviter un appel réseau à chaque ouverture de
  // l'Accueil ; ne bloque jamais le rendu (à appeler en fire-and-forget).
  //
  // getCurrent() : instantané + min/max du jour (usage historique, Accueil).
  // getDaily()   : série multi-jours (passé réellement mesuré + prévisions),
  //                utilisée par le tableau météo 7 jours de l'Accueil et par
  //                le module CTA/VC pour les DJU — voir assets/js/utils/
  //                dju.js pour le calcul, qui reste séparé de ce module.
  // ══════════════════════════════════════════════════════════════════════

  var CACHE_KEY     = 'mx_weather_cache_v1';
  var DAILY_CACHE_KEY = 'mx_weather_daily_cache_v1';
  var CACHE_TTL_MS  = 45 * 60 * 1000; // 45 min (dans la fourchette 30-60 demandée)
  var FETCH_TIMEOUT_MS = 6000;

  // Codes WMO (norme utilisée par Open-Meteo) → icône FontAwesome + libellé FR.
  var WMO = {
    0:  { icon: 'fa-sun',                  label: 'Ciel dégagé' },
    1:  { icon: 'fa-sun',                  label: 'Plutôt dégagé' },
    2:  { icon: 'fa-cloud-sun',            label: 'Partiellement nuageux' },
    3:  { icon: 'fa-cloud',                label: 'Couvert' },
    45: { icon: 'fa-smog',                 label: 'Brouillard' },
    48: { icon: 'fa-smog',                 label: 'Brouillard givrant' },
    51: { icon: 'fa-cloud-rain',           label: 'Bruine légère' },
    53: { icon: 'fa-cloud-rain',           label: 'Bruine' },
    55: { icon: 'fa-cloud-rain',           label: 'Bruine dense' },
    56: { icon: 'fa-cloud-rain',           label: 'Bruine verglaçante' },
    57: { icon: 'fa-cloud-rain',           label: 'Bruine verglaçante dense' },
    61: { icon: 'fa-cloud-rain',           label: 'Pluie légère' },
    63: { icon: 'fa-cloud-rain',           label: 'Pluie' },
    65: { icon: 'fa-cloud-showers-heavy',  label: 'Forte pluie' },
    66: { icon: 'fa-cloud-rain',           label: 'Pluie verglaçante' },
    67: { icon: 'fa-cloud-rain',           label: 'Forte pluie verglaçante' },
    71: { icon: 'fa-snowflake',            label: 'Neige légère' },
    73: { icon: 'fa-snowflake',            label: 'Neige' },
    75: { icon: 'fa-snowflake',            label: 'Forte neige' },
    77: { icon: 'fa-snowflake',            label: 'Neige en grains' },
    80: { icon: 'fa-cloud-showers-heavy',  label: 'Averses légères' },
    81: { icon: 'fa-cloud-showers-heavy',  label: 'Averses' },
    82: { icon: 'fa-cloud-showers-heavy',  label: 'Fortes averses' },
    85: { icon: 'fa-snowflake',            label: 'Averses de neige' },
    86: { icon: 'fa-snowflake',            label: 'Fortes averses de neige' },
    95: { icon: 'fa-bolt',                 label: 'Orage' },
    96: { icon: 'fa-bolt',                 label: 'Orage avec grêle' },
    99: { icon: 'fa-bolt',                 label: 'Orage violent' },
  };
  function _codeInfo(code) {
    return WMO[code] || { icon: 'fa-cloud', label: 'Conditions inconnues' };
  }

  function _readCache(key, lat, lon) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.lat !== lat || c.lon !== lon) return null;
      if (Date.now() - c.ts > CACHE_TTL_MS) return null;
      return c.data || null;
    } catch (e) { return null; }
  }
  function _writeCache(key, lat, lon, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ lat: lat, lon: lon, ts: Date.now(), data: data }));
    } catch (e) { /* stockage indisponible (quota/navigation privée) — pas bloquant */ }
  }

  // getCurrent(lat, lon) → Promise<{ temp, tempMin, tempMax, code, icon, label } | null>
  // null = donnée indisponible (pas de coordonnées, réseau en échec, timeout,
  // réponse invalide) — l'appelant doit alors afficher un état neutre, jamais
  // une valeur par défaut fictive.
  async function getCurrent(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return null;

    var cached = _readCache(CACHE_KEY, lat, lon);
    if (cached) return cached;

    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + encodeURIComponent(lat)
      + '&longitude=' + encodeURIComponent(lon)
      + '&current=temperature_2m,weather_code'
      + '&daily=temperature_2m_max,temperature_2m_min'
      + '&timezone=auto&forecast_days=1';

    var ctrl  = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
    try {
      var res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return null;
      var json = await res.json();
      if (!json || !json.current || typeof json.current.temperature_2m !== 'number') return null;

      var code = json.current.weather_code;
      var info = _codeInfo(code);
      var daily = json.daily || {};
      var data = {
        temp:    Math.round(json.current.temperature_2m),
        tempMin: (daily.temperature_2m_min && typeof daily.temperature_2m_min[0] === 'number') ? Math.round(daily.temperature_2m_min[0]) : null,
        tempMax: (daily.temperature_2m_max && typeof daily.temperature_2m_max[0] === 'number') ? Math.round(daily.temperature_2m_max[0]) : null,
        code:    code,
        icon:    info.icon,
        label:   info.label,
      };
      _writeCache(CACHE_KEY, lat, lon, data);
      return data;
    } catch (e) {
      if (timer) clearTimeout(timer);
      return null;
    }
  }

  // getDaily(lat, lon, opts) → Promise<{ timezone, daily: <bloc brut Open-Meteo> } | null>
  // Fournit jusqu'à 7 jours passés (past_days, données réellement mesurées)
  // et jusqu'à 7 jours à venir (forecast_days, prévisions) — mêmes règles
  // que getCurrent : jamais de donnée inventée, null si indisponible, cache
  // localStorage dédié (même TTL 45 min), timeout 6 s. Le bloc `daily` brut
  // est retourné tel quel (pas de DJU calculé ici — voir assets/js/utils/
  // dju.js:buildDailySeries, qui reste indépendant de la couche réseau).
  var DEFAULT_PAST_DAYS     = 7;
  var DEFAULT_FORECAST_DAYS = 7;
  async function getDaily(lat, lon, opts) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return null;
    var pastDays     = (opts && typeof opts.pastDays === 'number')     ? opts.pastDays     : DEFAULT_PAST_DAYS;
    var forecastDays = (opts && typeof opts.forecastDays === 'number') ? opts.forecastDays : DEFAULT_FORECAST_DAYS;

    var cached = _readCache(DAILY_CACHE_KEY, lat, lon);
    if (cached) return cached;

    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + encodeURIComponent(lat)
      + '&longitude=' + encodeURIComponent(lon)
      + '&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,weather_code'
      + '&timezone=auto'
      + '&past_days=' + encodeURIComponent(pastDays)
      + '&forecast_days=' + encodeURIComponent(forecastDays);

    var ctrl  = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
    try {
      var res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return null;
      var json = await res.json();
      if (!json || !json.daily || !Array.isArray(json.daily.time)) return null;

      var data = { timezone: json.timezone || null, daily: json.daily };
      _writeCache(DAILY_CACHE_KEY, lat, lon, data);
      return data;
    } catch (e) {
      if (timer) clearTimeout(timer);
      return null;
    }
  }

  window.MX = window.MX || {};
  window.MX.Weather = { getCurrent: getCurrent, getDaily: getDaily, codeInfo: _codeInfo };
})();
