(function () {
  'use strict';

  // ── STATE ──
  let _curTab        = 'dashboard';
  let _csoSelDate    = ''; // '' = today; set to 'YYYY-MM-DD' when browsing a past date
  let _meters        = [];
  let _archivedMeters = [];
  let _readings      = [];
  let _clients       = {};
  let _csoAlerts     = [];   // cso_energy_alerts documents
  let _loaded        = false;
  let _unsubCso      = {};
  let _photoB64      = null;
  let _csoSearch     = '';
  let _csoTypeFilter = 'all';
  let _openZones     = null; // null = not yet loaded
  let _relQueue      = [];   // meter IDs for "Relever tout" queue
  let _relQueueIdx   = 0;
  let _critBeepTimer = null;
  let _currentCritAlert = null;
  let _lastSmartAlerts  = [];
  let _anHiddenTypes    = new Set();
  const _recalcLocks   = new Set(); // meters currently being recalculated
  const _recalcPending = new Set(); // meters waiting for a re-run once current lock releases
  const _recalcWaiters = new Map(); // meterId → [{resolve,reject}] Promises waiting for recalc to finish
  let _readingIndexCache = {};      // docId → last known index value (to detect external modifications)
  let _perfCfg   = { thresholds: {}, classes: {}, ref_meters: {}, objectifs: {}, justifications: {}, alert_rules: {} }; // Performance config from Firestore

  // ── PHASE 1B : chargement complémentaire par plage de dates ──────────────
  // Le listener live de cso_readings est plafonné à 500 docs (tous compteurs
  // confondus, triés par createdAt desc) pour rester léger en temps réel.
  // Au-delà de ce plafond, l'historique le plus ancien peut manquer pour les
  // périodes longues (3 mois / 1 an). _ensureReadingsFrom() complète alors
  // ce cache par une requête ponctuelle (pas un listener) filtrée sur `date`,
  // fusionnée dans _readings (marquée `_ext:true`) sans jamais toucher aux
  // ~15 fonctions qui lisent déjà _readings directement (Phase 1).
  const _readingsLiveCap      = 500;  // seule source de vérité : réutilisé tel quel dans le .limit() du listener _load()
  let _extReadingsFrom        = null; // date la plus ancienne déjà couverte par une requête complémentaire
  let _extReadingsFetching    = null; // Promise en vol (évite les requêtes dupliquées)
  // Idem pour cso_clients (plafond du listener live : 90 jours).
  const _clientsLiveCap       = 90;   // seule source de vérité : réutilisé tel quel dans le .limit() du listener _load()
  let _clientsLiveMinDate     = null; // date la plus ancienne du dernier snapshot live ; null = live < plafond → tout est chargé
  const _clientsExtDates      = new Set(); // dates chargées hors fenêtre live (à préserver lors des rafraîchissements du listener)
  let _extClientsFetching     = null;

  // ── FIRESTORE ERROR HANDLER ──
  function _fsErr(coll) {
    return function (err) {
      const code = err.code || '';
      const link = (err.message || '').match(/https:\/\/\S+/)?.[0] || '';
      if (code === 'failed-precondition') {
        console.warn('────────────────────────\n⚠ Firestore\n\nCollection : ' + coll + '\n\nIndex manquant.\n' + (link ? 'Lien Firebase :\n' + link + '\n' : '') + '────────────────────────');
      } else if (code === 'permission-denied') {
        console.warn('[Firestore] ' + coll + ' — permission refusée :', err.message);
      } else if (code === 'unavailable') {
        console.warn('[Firestore] ' + coll + ' — service indisponible.');
      } else {
        console.error('[Firestore] ' + coll + ' — erreur listener :', err);
      }
    };
  }

  // ── CONSTANTS ──
  const FV = firebase.firestore.FieldValue;
  const CSO = {
    meters:   () => db.collection('cso_meters'),
    readings: () => db.collection('cso_readings'),
    clients:  () => db.collection('cso_clients'),
    alerts:   () => db.collection('cso_energy_alerts'),
    perfConfig: () => db.collection('cso_perf_config'),
    log:      () => db.collection('cso_activity_log'),
  };

  // literRatio: true  → ratio par client affiché en L/client (× 1000, unité de
  // base m³→L). C'est la SEULE définition de "type eau" du fichier — avant
  // cette refonte, cette liste était recopiée à 6 endroits différents avec
  // des divergences (eau_glacee oubliée par endroits, gaz inclus à tort par
  // ailleurs via un test sur l'unité 'm³' au lieu du type). Toute nouvelle
  // fonction de calcul doit lire ce flag via _isLiterRatioType(type), jamais
  // recopier une liste de noms de type.
  const MT = {
    eau_froide:  { icon: '💧', label: 'Eau froide',  unit: 'm³',  color: '#3B82F6', dim: 'rgba(59,130,246,0.15)', literRatio: true  },
    eau_chaude:  { icon: '🔥', label: 'Eau chaude',  unit: 'm³',  color: '#F97316', dim: 'rgba(249,115,22,0.15)', literRatio: true  },
    electricite: { icon: '⚡', label: 'Électricité', unit: 'kWh', color: '#F59E0B', dim: 'rgba(245,158,11,0.15)' },
    gaz:         { icon: '🌬', label: 'Gaz',         unit: 'm³',  color: '#A78BFA', dim: 'rgba(167,139,250,0.15)' },
    vapeur:      { icon: '♨️', label: 'Vapeur',      unit: 'kg',  color: '#EC4899', dim: 'rgba(236,72,153,0.15)'  },
    eau_glacee:  { icon: '🧊', label: 'Eau glacée',  unit: 'm³',  color: '#06B6D4', dim: 'rgba(6,182,212,0.15)', literRatio: true  },
    chauffage:   { icon: '🏢', label: 'Chauffage (ADP)', unit: 'MWh', color: '#EF4444', dim: 'rgba(239,68,68,0.15)' },
  };

  const TABS = [
    // Phase 4 : cet onglet garde son id historique 'dashboard' (référencé
    // depuis app.js et alerts-ui.js) mais rend désormais _tPerformance() —
    // voir _body() plus bas. Seul le libellé change ; ce n'est plus
    // l'ancien "Tableau de bord énergétique".
    { id: 'dashboard', icon: 'fa-gauge',        l: 'Accueil',            mob: 'Accueil' },
    { id: 'compteurs', icon: 'fa-gauge-high',   l: 'Compteurs & Ratios', mob: 'Compteurs' },
    { id: 'releves',   icon: 'fa-camera',       l: 'Relevés',            mob: 'Relevés'   },
    { id: 'analyses',  icon: 'fa-chart-bar',    l: 'Analyses',           mob: 'Analyses'  },
    { id: 'alertes',   icon: 'fa-shield-halved', l: 'Supervision',        mob: 'Superv.'   },
    { id: 'performance', icon: 'fa-bolt-lightning', l: 'Performance', mob: 'Perf.' },
    { id: 'exports',   icon: 'fa-file-export',  l: 'Exports',            mob: 'Exports'   },
  ];

  // ── PERFORMANCE ÉNERGÉTIQUE — Valeurs par défaut (Firestore prend le dessus) ──
  const PERF_DEFAULTS = {
    thresholds: {
      eau_froide:  { excellent: 120, bon: 145, correct: 170, moyen: 190, mauvais: 220 },
      eau_chaude:  { excellent:  45, bon:  60, correct:  75, moyen:  90, mauvais: 110 },
      electricite: { excellent:   3, bon:   4, correct:   5, moyen:   6, mauvais:   7 },
      gaz:         { excellent:   2, bon:   3, correct:   4, moyen:   5, mauvais:   6 },
    },
    classes: {
      excellent: { l: 'Excellent', color: '#22c55e', scoreCenter: 95 },
      bon:       { l: 'Bon',       color: '#86efac', scoreCenter: 82 },
      correct:   { l: 'Correct',   color: '#fbbf24', scoreCenter: 67 },
      moyen:     { l: 'Moyen',     color: '#f97316', scoreCenter: 52 },
      mauvais:   { l: 'Mauvais',   color: '#ef4444', scoreCenter: 37 },
      critique:  { l: 'Critique',  color: '#991b1b', scoreCenter: 15 },
    },
    classOrder: ['excellent', 'bon', 'correct', 'moyen', 'mauvais', 'critique'],
  };

  // ─ Merge Firestore config with defaults ─
  function _perfT() {
    const t = {};
    Object.keys(PERF_DEFAULTS.thresholds).forEach(type => {
      t[type] = Object.assign({}, PERF_DEFAULTS.thresholds[type],
        (_perfCfg.thresholds && _perfCfg.thresholds[type]) || {});
    });
    return t;
  }
  function _perfC() {
    const c = {};
    PERF_DEFAULTS.classOrder.forEach(k => {
      c[k] = Object.assign({}, PERF_DEFAULTS.classes[k],
        (_perfCfg.classes && _perfCfg.classes[k]) || {});
    });
    return c;
  }

  // Returns {key, l, color, scoreCenter} for a type+ratio value
  function _getGrade(type, ratio) {
    const t = _perfT()[type];
    const c = _perfC();
    const na = { key: 'na', l: '—', color: '#64748b', scoreCenter: 0 };
    if (!t || ratio === null || ratio === undefined || isNaN(ratio)) return na;
    for (const k of PERF_DEFAULTS.classOrder) {
      if (k === 'critique') return { key: k, ...c[k] };
      if (ratio <= t[k]) return { key: k, ...c[k] };
    }
    return { key: 'critique', ...c.critique };
  }

  // Returns meter IDs for ratio calc: configured ref meters or all meters of that type
  function _refMeterIds(type) {
    const cfg = (_perfCfg.ref_meters && _perfCfg.ref_meters[type]) || [];
    if (Array.isArray(cfg) && cfg.length) return cfg;
    return _meters.filter(m => m.type === type).map(m => m.id);
  }

  // Returns per-type ratio for a given date (uses ref meters only)
  function _perfRatio(type, date) {
    const ids  = _refMeterIds(type);
    if (!ids.length) return null;
    const val  = sumConsumption(_readings, ids, date);
    if (!val) return null;
    const cli  = _clients[date] || 0;
    return computeRatio(type, val, cli);
  }

  // Per-type raw consumption for a date (uses ref meters only)
  function _perfConso(type, date) {
    const ids = _refMeterIds(type);
    return sumConsumption(_readings, ids, date) || null;
  }

  // Global score from today's ratios (based on configurable thresholds)
  function _calcPerfScore(date) {
    const d   = date || _today();
    const cli = _clients[d] || 0;
    if (!cli) return null;
    const types = ['eau_froide', 'eau_chaude', 'electricite'];
    let sum = 0, count = 0;
    types.forEach(type => {
      const ratio = _perfRatio(type, d);
      if (ratio === null) return;
      const grade = _getGrade(type, ratio);
      if (grade.key === 'na') return;
      sum += grade.scoreCenter;
      count++;
    });
    return count ? Math.round(sum / count) : null;
  }



  // ── HELPERS ──
  function _today()     { return new Date().toISOString().slice(0, 10); }
  function _daysAgo(n)  { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function _fmt(n, dec) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const d = dec !== undefined ? dec : (Math.abs(n) >= 100 ? 1 : 2);
    return n.toFixed(d).replace('.', ',');
  }
  // Display exact index / consumption — no rounding, min 2 decimals, max 3
  function _fmtIdx(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const s = n.toString();
    const dot = s.indexOf('.');
    const sig = dot >= 0 ? s.length - dot - 1 : 0;
    return n.toFixed(Math.min(Math.max(sig, 2), 3)).replace('.', ',');
  }
  function _dateLbl(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }
  function _tsMs(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds)  return ts.seconds * 1000;
    return 0;
  }
  function _tsDate(ts) { const ms = _tsMs(ts); return ms ? new Date(ms) : null; }

  // ════════════════════════════════════════════════════════════════════════
  // MOTEUR DE CALCUL COMMUN — MX.CsoCalc
  // Fonctions pures (aucun accès Firestore, aucune lecture de l'état module
  // _meters/_readings/_clients) utilisées par TOUS les onglets — Dashboard,
  // Compteurs, Performance, Analyses, Supervision — pour que consommation,
  // ratio, moyenne, comparaison de périodes et statut soient calculés une
  // seule fois, de la même façon, partout. Exposées aussi sur
  // window.MX.CsoCalc (cf. bloc EXPOSE en fin de fichier) pour rester
  // testables indépendamment du reste du fichier et réutilisables si les
  // pages sont un jour scindées en plusieurs fichiers (pas fait ici).
  // ════════════════════════════════════════════════════════════════════════

  // Un type d'énergie doit-il être exprimé en L/client (× 1000, m³→L) dans
  // les ratios ? SOURCE UNIQUE : le flag literRatio de MT[type] (voir plus
  // haut). Remplace les listes de noms de type ('eau_froide','eau_chaude',
  // 'eau_glacee'...) recopiées à 6 endroits différents du fichier, dont
  // certaines oubliaient eau_glacee et une autre testait l'unité 'm³' — ce
  // qui incluait à tort le gaz (également en m³) dans la conversion litres.
  function _isLiterRatioType(type) {
    return !!(MT[type] && MT[type].literRatio);
  }

  // Consommation totale (somme du champ `consumption`) pour un ensemble de
  // compteurs, sur une date ('YYYY-MM-DD') ou un tableau de dates.
  function sumConsumption(readings, meterIds, dateOrDates) {
    const dates = new Set(Array.isArray(dateOrDates) ? dateOrDates : [dateOrDates]);
    const ids   = new Set(meterIds || []);
    let total = 0;
    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      if (ids.has(r.meterId) && dates.has(r.date)) total += (r.consumption || 0);
    }
    return total;
  }

  // Consommation totale pour un type d'énergie (résout les compteurs de ce
  // type parmi `meters`), sur une date ou un tableau de dates.
  function sumConsumptionByType(readings, meters, type, dateOrDates) {
    const ids = meters.filter(m => m.type === type).map(m => m.id);
    return sumConsumption(readings, ids, dateOrDates);
  }

  // Ratio par client pour une valeur de consommation donnée. `value === 0`
  // reste un ratio de 0 (donnée valide) — seul un nombre de clients nul/
  // absent ou une valeur non numérique donnent `null` ("pas de ratio").
  // C'est à l'appelant de décider si une consommation nulle doit être
  // affichée comme "—" (comme le fait le Dashboard) ou comme 0 dans une
  // série (comme le fait Analyses) : ce choix ne doit pas être figé ici.
  function computeRatio(type, value, clientCount) {
    if (!clientCount || isNaN(clientCount)) return null;
    if (value === null || value === undefined || isNaN(value)) return null;
    return _isLiterRatioType(type) ? (value * 1000 / clientCount) : (value / clientCount);
  }

  // Moyenne arithmétique d'un tableau de valeurs (ignore null/undefined/NaN).
  // Retourne 0 sur un tableau vide (comportement déjà attendu par l'existant
  // pour les moyennes 30 jours — évite d'introduire des `null` en cascade).
  function average(arr) {
    const vals = (arr || []).filter(v => v !== null && v !== undefined && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  // Minimum et maximum d'un tableau de valeurs strictement positives (les
  // relevés à 0/absents ne sont pas des mesures — même convention que le
  // filtre `nonZero` déjà utilisé dans l'onglet Analyses).
  function minMax(arr) {
    const vals = (arr || []).filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 0 };
  }

  // Compare deux totaux de périodes consécutives (période courante vs
  // période précédente de même durée). `pct` est `null` si la période de
  // référence est nulle/absente (rien à comparer), sinon l'écart en %.
  function comparePeriods(currentTotal, previousTotal) {
    if (!previousTotal) return { pct: null, trend: 'na' };
    const pct = (currentTotal - previousTotal) / previousTotal * 100;
    return { pct, trend: pct > 5 ? 'up' : pct < -5 ? 'down' : 'stable' };
  }

  // Tendance d'une valeur ponctuelle (ex : consommation du jour) par rapport
  // à une valeur de référence (ex : moyenne 30 jours). Même forme de retour
  // que comparePeriods — les deux partagent la même notion de tendance.
  function trendFromDeviation(value, reference) {
    if (!reference) return { pct: null, trend: 'na' };
    const pct = (value - reference) / reference * 100;
    return { pct, trend: pct > 5 ? 'up' : pct < -5 ? 'down' : 'stable' };
  }

  // Statut normal / attention / critique à partir d'un écart en %. Clés
  // ('ok'/'warn'/'crit'/'na') identiques à celles déjà utilisées par les
  // templates (stCol/stLbl de l'onglet Analyses) : aucun changement visuel,
  // seule la logique de seuil est désormais centralisée ici.
  function statusFromDeviation(pct, opts) {
    const warnAt = (opts && opts.warnAt != null) ? opts.warnAt : 10;
    const critAt = (opts && opts.critAt != null) ? opts.critAt : 50;
    if (pct === null || pct === undefined || isNaN(pct)) return 'na';
    if (pct > critAt) return 'crit';
    if (pct > warnAt) return 'warn';
    return 'ok';
  }

  // ── Périodes ──────────────────────────────────────────────────────────
  // Construit un tableau de dates 'YYYY-MM-DD' pour un type de période.
  // Phase 1 : moteur seul, PAS ENCORE branché sur un sélecteur d'interface
  // (aucun nouvel onglet, aucune UI ajoutée ici). Sert de base commune pour
  // qu'une future page utilise exactement le même découpage de dates pour
  // la consommation ET pour le nombre de clients (même périmètre garanti,
  // car les deux lectures partageront le même tableau `dates`).
  function periodDates(kind, opts) {
    const o   = opts || {};
    const ref = o.refDate ? new Date(o.refDate + 'T12:00:00') : new Date();
    const pad = n => String(n).padStart(2, '0');
    const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const range = (start, end) => {
      const out = []; const cur = new Date(start);
      while (cur <= end) { out.push(toStr(cur)); cur.setDate(cur.getDate() + 1); }
      return out;
    };
    switch (kind) {
      case 'day':           return [toStr(ref)];
      case 'last30':        return Array.from({ length: 30 }, (_, i) => _daysAgo(29 - i));
      case 'month-current':  return range(new Date(ref.getFullYear(), ref.getMonth(), 1), ref);
      case 'month-previous': return range(new Date(ref.getFullYear(), ref.getMonth() - 1, 1), new Date(ref.getFullYear(), ref.getMonth(), 0));
      case 'custom':
        if (!o.start || !o.end) return [];
        return range(new Date(o.start + 'T12:00:00'), new Date(o.end + 'T12:00:00'));
      default: return [];
    }
  }

  function _author() {
    const cu = MX.state.currentUser, ad = MX.state.adminUser;
    return cu ? cu.name : (ad ? (ad.email || 'Admin').split('@')[0] : 'Anonyme');
  }
  function _isResp() {
    if (MX.state.adminUser) return true;
    return MX.Auth ? MX.Auth.isResponsable() : false;
  }
  function _logActivity(action, meterId, meterName, allowed) {
    try {
      CSO.log().add({
        action,
        meterId:   meterId   || null,
        meterName: meterName || null,
        by:        _author(),
        allowed:   allowed !== false,
        ts:        FV.serverTimestamp(),
        date:      _today(),
      });
    } catch (e) { /* non-bloquant */ }
  }

  function _logReadingEdit(meterId, meterName, oldIndex, newIndex, motif) {
    try {
      CSO.log().add({
        action:    'edit_reading',
        meterId:   meterId   || null,
        meterName: meterName || null,
        oldIndex,
        newIndex,
        motif:     motif || '',
        by:        _author(),
        allowed:   true,
        ts:        FV.serverTimestamp(),
        date:      _today(),
      });
    } catch (e) { /* non-bloquant */ }
  }

  function _showRecalcProgress(msg) {
    let ov = document.getElementById('cso-recalc-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'cso-recalc-ov';
      ov.className = 'cso-recalc-ov';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `<div class="cso-recalc-inner">
      <i class="fas fa-calculator" style="font-size:28px;color:var(--cyan);margin-bottom:10px"></i>
      <div class="cso-recalc-msg">${esc(msg || 'Recalcul en cours…')}</div>
      <div class="cso-recalc-bar"><div class="cso-recalc-bar-inner"></div></div>
      <div class="cso-recalc-sub">Recalcul chronologique des consommations</div>
    </div>`;
    ov.style.display = 'flex';
  }

  function _hideRecalcProgress() {
    const ov = document.getElementById('cso-recalc-ov');
    if (ov) ov.style.display = 'none';
  }
  function esc(s) { return MX.esc ? MX.esc(s) : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ── SVG HELPERS ──
  function _sparkSVG(vals, color, W, H) {
    W = W || 80; H = H || 28;
    if (!vals || !vals.length || !vals.some(v => v > 0)) return `<svg width="${W}" height="${H}"></svg>`;
    const max = Math.max(...vals, 0.001);
    const min = Math.min(...vals.filter(v => v > 0), 0);
    const range = max - min || 1;
    const pts = vals.map((v, i) => {
      const x = (i / Math.max(vals.length - 1, 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const lastX = ((vals.length - 1) / Math.max(vals.length - 1, 1)) * W;
    const lastY = (H - ((vals[vals.length - 1] - min) / range) * (H - 4) - 2).toFixed(1);
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY}" r="2.5" fill="${color}"/>
    </svg>`;
  }

  function _lineSVG(datasets, H) {
    H = H || 140;
    const W = 460;
    if (!datasets || !datasets.length) return '';
    const allVals = datasets.flatMap(d => d.vals);
    const max = Math.max(...allVals, 0.001);
    const N = Math.max(...datasets.map(d => d.vals.length), 1);
    let lines = '';
    datasets.forEach(ds => {
      if (!ds.vals.some(v => v > 0)) return;
      const pts = ds.vals.map((v, i) => {
        const x = (i / Math.max(N - 1, 1)) * (W - 24) + 12;
        const y = H - 20 - (v / max) * (H - 32);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      lines += `<polyline points="${pts}" fill="none" stroke="${ds.color}" stroke-width="2" stroke-linejoin="round" opacity="0.85"/>`;
    });
    return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;max-width:100%">
      <line x1="12" y1="${H - 20}" x2="${W - 12}" y2="${H - 20}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      ${lines}
    </svg>`;
  }

  // Smooth bezier line chart with gradient area fill
  function _bezierLineSVG(datasets, labels, H) {
    H = H || 200;
    const W = 600, PADt = 12, PADb = 38, PADl = 8, PADr = 8;
    const cW = W - PADl - PADr, cH = H - PADt - PADb;
    if (!datasets || !datasets.length) return '';
    const N = Math.max(...datasets.map(d => d.vals.length), 2);
    const maxV = Math.max(...datasets.flatMap(d => d.vals), 0.001);
    const px = i => PADl + (i / Math.max(N - 1, 1)) * cW;
    const py = v => PADt + cH - (v / maxV) * cH;
    let grid = '', xlbls = '', areas = '', lines = '';
    for (let g = 0; g <= 4; g++) {
      const y = PADt + (g / 4) * cH;
      const v = maxV * (1 - g / 4);
      grid += `<line x1="${PADl}" y1="${y.toFixed(1)}" x2="${W - PADr}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>` +
        `<text x="${(PADl + 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" fill="rgba(255,255,255,0.22)" font-size="8" font-family="monospace">${_fmt(v, v >= 100 ? 0 : 1)}</text>`;
    }
    const step = N <= 7 ? 1 : N <= 30 ? 5 : N <= 90 ? 14 : 30;
    (labels || []).forEach((lb, i) => {
      if (i % step !== 0 && i !== N - 1) return;
      const parts = lb.split('-');
      const lbl = parts.length === 3 ? `${parts[2]}/${parts[1]}` : lb;
      xlbls += `<text x="${px(i).toFixed(1)}" y="${(H - PADb + 14).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="8" font-family="sans-serif">${lbl}</text>`;
    });
    datasets.forEach(ds => {
      if (!ds.vals.some(v => v > 0)) return;
      const pts = ds.vals.map((v, i) => ({ x: px(i), y: py(v) }));
      let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i], cpx = (p0.x + p1.x) / 2;
        d += ` C ${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      }
      const bY = (PADt + cH).toFixed(1);
      const gId = 'ag' + ds.color.replace('#', '');
      areas += `<defs><linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${ds.color}" stop-opacity="0.2"/><stop offset="100%" stop-color="${ds.color}" stop-opacity="0"/></linearGradient></defs>`;
      areas += `<path d="${d} L ${pts[pts.length - 1].x.toFixed(1)},${bY} L ${pts[0].x.toFixed(1)},${bY} Z" fill="url(#${gId})"/>`;
      lines += `<path d="${d}" fill="none" stroke="${ds.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
      lines += `<circle cx="${pts[pts.length - 1].x.toFixed(1)}" cy="${pts[pts.length - 1].y.toFixed(1)}" r="3" fill="${ds.color}"/>`;
    });
    return `<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">
      <line x1="${PADl}" y1="${(PADt + cH).toFixed(1)}" x2="${W - PADr}" y2="${(PADt + cH).toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
      ${grid}${areas}${lines}${xlbls}</svg></div>`;
  }

  // Horizontal bar chart: today vs 30-day avg per energy type
  function _hBarSVG(items, rowH) {
    if (!items || !items.length) return '';
    const ROW = rowH || 46, W = 480, PL = 112, PR = 70, BW = W - PL - PR;
    const H = items.length * ROW + 16;
    const maxV = Math.max(...items.flatMap(it => [it.today, it.avg]), 0.001);
    let rows = '';
    items.forEach((it, i) => {
      const y = i * ROW + 8;
      const tp = Math.max((it.today / maxV) * BW, 0);
      const ap = Math.max((it.avg / maxV) * BW, 0);
      const dc = it.pctDiff === null ? 'rgba(255,255,255,0.3)' : it.pctDiff > 10 ? '#f87171' : it.pctDiff < -10 ? '#34d399' : '#94a3b8';
      const dt = it.pctDiff !== null ? `${it.pctDiff > 0 ? '+' : ''}${_fmt(it.pctDiff, 0)}%` : '—';
      rows += `<text x="${PL - 8}" y="${(y + 16).toFixed(1)}" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="9.5" font-family="sans-serif">${esc(it.label)}</text>`;
      rows += `<rect x="${PL}" y="${(y + 2).toFixed(1)}" width="${ap.toFixed(1)}" height="10" rx="2" fill="${it.color}" opacity="0.18"/>`;
      rows += `<text x="${(PL + ap + 3).toFixed(1)}" y="${(y + 11).toFixed(1)}" fill="rgba(255,255,255,0.25)" font-size="7.5" font-family="sans-serif">30j moy</text>`;
      rows += `<rect x="${PL}" y="${(y + 14).toFixed(1)}" width="${tp.toFixed(1)}" height="16" rx="3" fill="${it.color}" opacity="0.82"/>`;
      rows += `<text x="${(PL + tp + 4).toFixed(1)}" y="${(y + 25).toFixed(1)}" fill="${it.color}" font-size="9" font-weight="600" font-family="sans-serif">${_fmt(it.today, 1)} ${esc(it.unit)}</text>`;
      rows += `<text x="${W - PR + 4}" y="${(y + 21).toFixed(1)}" fill="${dc}" font-size="10" font-weight="700" font-family="monospace">${dt}</text>`;
    });
    return `<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block" preserveAspectRatio="xMidYMid meet">${rows}</svg></div>`;
  }

  // Donut chart: distribution by energy type
  function _donutSVG(items, sz) {
    if (!items || items.length < 2) return '';
    const total = items.reduce((s, it) => s + it.val, 0);
    if (!total) return '';
    const SZ = sz || 160, cx = SZ/2, cy = SZ/2, R = Math.round(SZ*0.4), ri = Math.round(SZ*0.2625);
    let paths = '', leg = '', ang = -Math.PI / 2;
    items.forEach(it => {
      const pct = it.val / total, sw = pct * 2 * Math.PI, ea = ang + sw, lg = sw > Math.PI ? 1 : 0;
      if (pct > 0.005) {
        const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
        const x2 = cx + R * Math.cos(ea), y2 = cy + R * Math.sin(ea);
        const ix1 = cx + ri * Math.cos(ang), iy1 = cy + ri * Math.sin(ang);
        const ix2 = cx + ri * Math.cos(ea), iy2 = cy + ri * Math.sin(ea);
        paths += `<path d="M ${x1.toFixed(2)},${y1.toFixed(2)} A ${R},${R} 0 ${lg} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L ${ix2.toFixed(2)},${iy2.toFixed(2)} A ${ri},${ri} 0 ${lg} 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z" fill="${it.color}" opacity="0.85" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`;
      }
      leg += `<div class="ra-donut-leg-item"><span class="ra-leg-dot" style="background:${it.color}"></span><span class="ra-donut-leg-lbl">${esc(it.label)}</span><span class="ra-donut-leg-pct">${_fmt(pct * 100, 1)}%</span></div>`;
      ang = ea;
    });
    return `<div class="ra-donut-wrap"><svg width="${SZ}" height="${SZ}" viewBox="0 0 ${SZ} ${SZ}">${paths}<circle cx="${cx}" cy="${cy}" r="${ri - 1}" fill="var(--surface,#0f172a)"/><text x="${cx}" y="${cy - 5}" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="8" font-family="sans-serif">répartition</text><text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-size="14" font-weight="700" font-family="monospace">${items.length}</text><text x="${cx}" y="${cy + 22}" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="7.5" font-family="sans-serif">énergies</text></svg><div class="ra-donut-legend">${leg}</div></div>`;
  }

  // Area line chart: weekly aggregation for drift detection
  function _areaLineSVG(datasets, labels, H) {
    H = H || 160;
    const W = 500, PADt = 12, PADb = 28, PADl = 8, PADr = 8;
    const cW = W - PADl - PADr, cH = H - PADt - PADb;
    if (!datasets || !datasets.length) return '';
    const N = Math.max(...datasets.map(d => d.vals.length), 2);
    const maxV = Math.max(...datasets.flatMap(d => d.vals), 0.001);
    const px = i => PADl + (i / Math.max(N - 1, 1)) * cW;
    const py = v => PADt + cH - (v / maxV) * cH;
    let areas = '', lines = '', xlbls = '';
    datasets.forEach(ds => {
      if (!ds.vals.some(v => v > 0)) return;
      const pts = ds.vals.map((v, i) => ({ x: px(i), y: py(v) }));
      let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i], cpx = (p0.x + p1.x) / 2;
        d += ` C ${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      }
      const bY = (PADt + cH).toFixed(1);
      const gId = 'wag' + ds.color.replace('#', '');
      areas += `<defs><linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${ds.color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${ds.color}" stop-opacity="0.02"/></linearGradient></defs>`;
      areas += `<path d="${d} L ${pts[pts.length - 1].x.toFixed(1)},${bY} L ${pts[0].x.toFixed(1)},${bY} Z" fill="url(#${gId})"/>`;
      lines += `<path d="${d}" fill="none" stroke="${ds.color}" stroke-width="1.8" stroke-linecap="round" opacity="0.9"/>`;
    });
    (labels || []).forEach((lb, i) => {
      xlbls += `<text x="${px(i).toFixed(1)}" y="${(H - PADb + 14).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="8" font-family="sans-serif">${esc(lb)}</text>`;
    });
    const baseY = (PADt + cH).toFixed(1);
    return `<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet"><line x1="${PADl}" y1="${baseY}" x2="${W - PADr}" y2="${baseY}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>${areas}${lines}${xlbls}</svg></div>`;
  }

  // Supervision line chart with per-dataset threshold dots + red zone
  function _supLineSVG(datasets, labels, H) {
    H = H || 220;
    const W = 600, PADt = 16, PADb = 42, PADl = 10, PADr = 10;
    const cW = W - PADl - PADr, cH = H - PADt - PADb;
    if (!datasets || !datasets.length) return '';
    const N = Math.max(...datasets.map(d => d.vals.length), 2);
    const maxV = Math.max(...datasets.flatMap(d => d.vals), 0.001);
    const px = i => PADl + (i / Math.max(N - 1, 1)) * cW;
    const py = v => PADt + cH - (v / maxV) * cH;
    let grid = '', areas = '', lines = '', xlbls = '', thrLines = '';
    for (let g = 0; g <= 4; g++) {
      const y = PADt + (g / 4) * cH, v = maxV * (1 - g / 4);
      grid += `<line x1="${PADl}" y1="${y.toFixed(1)}" x2="${W-PADr}" y2="${y.toFixed(1)}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>`;
      grid += `<text x="${(PADl+2).toFixed(1)}" y="${(y-3).toFixed(1)}" class="an2-axis-lbl" font-size="8" font-family="monospace">${_fmt(v,v>=100?0:1)}</text>`;
    }
    const step = N<=7?1:N<=30?5:N<=90?14:30;
    (labels||[]).forEach((lb,i) => {
      if (i%step!==0&&i!==N-1) return;
      const parts=lb.split('-'); const lbl=parts.length===3?`${parts[2]}/${parts[1]}`:lb;
      xlbls+=`<text x="${px(i).toFixed(1)}" y="${(H-PADb+16).toFixed(1)}" text-anchor="middle" class="an2-axis-lbl" font-size="8" font-family="sans-serif">${lbl}</text>`;
    });
    datasets.forEach(ds => {
      if (!ds.vals.some(v=>v>0)) return;
      const nonZero=ds.vals.filter(v=>v>0);
      const avg=nonZero.length?nonZero.reduce((a,b)=>a+b,0)/nonZero.length:0;
      const thr=avg*1.35;
      if (thr>0&&thr<maxV) {
        const ty=py(thr);
        thrLines+=`<line x1="${PADl}" y1="${ty.toFixed(1)}" x2="${W-PADr}" y2="${ty.toFixed(1)}" stroke="${ds.color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.4"/>`;
        thrLines+=`<rect x="${PADl}" y="${PADt}" width="${cW}" height="${(ty-PADt).toFixed(1)}" fill="rgba(248,113,113,0.03)"/>`;
      }
      const pts=ds.vals.map((v,i)=>({x:px(i),y:py(v)}));
      let d=`M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i=1;i<pts.length;i++){const p0=pts[i-1],p1=pts[i],cpx=(p0.x+p1.x)/2;d+=` C ${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;}
      const bY=(PADt+cH).toFixed(1),gId='sv'+ds.color.replace('#','');
      areas+=`<defs><linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${ds.color}" stop-opacity="0.15"/><stop offset="100%" stop-color="${ds.color}" stop-opacity="0"/></linearGradient></defs>`;
      areas+=`<path d="${d} L ${pts[pts.length-1].x.toFixed(1)},${bY} L ${pts[0].x.toFixed(1)},${bY} Z" fill="url(#${gId})"/>`;
      lines+=`<path d="${d}" fill="none" stroke="${ds.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`;
      ds.vals.forEach((v,i)=>{if(thr>0&&v>thr)lines+=`<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="4" fill="#f87171" opacity="0.9" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`;});
      lines+=`<circle cx="${pts[pts.length-1].x.toFixed(1)}" cy="${pts[pts.length-1].y.toFixed(1)}" r="3" fill="${ds.color}"/>`;
    });
    const baseY=(PADt+cH).toFixed(1);
    return `<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">
      <line x1="${PADl}" y1="${baseY}" x2="${W-PADr}" y2="${baseY}" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
      ${grid}${thrLines}${areas}${lines}${xlbls}</svg></div>`;
  }

  // Heatmap SVG: cells[{row,col,level,val}]
  function _heatmapSVG(cells, rowLabels, colLabels, nRows, nCols, cellH) {
    const CELL_W = Math.max(12, Math.min(26, Math.floor(460/nCols)));
    const CELL_H = cellH || 26, PAD_L = 30, PAD_T = 18, PAD_B = 8;
    const W = PAD_L + nCols*CELL_W + 8, H = PAD_T + nRows*CELL_H + PAD_B;
    let rects='', rowLbls='', colLbls='';
    cells.forEach(c => {
      const x=PAD_L+c.col*CELL_W, y=PAD_T+c.row*CELL_H;
      const color=c.level==='crit'?'#f87171':c.level==='warn'?'#f59e0b':c.level==='ok'?'#34d399':'rgba(0,0,0,0.04)';
      const opacity=c.level==='none'?1:(0.15+c.val*0.65).toFixed(2);
      rects+=`<rect x="${x+1}" y="${y+1}" width="${CELL_W-2}" height="${CELL_H-2}" rx="2" fill="${color}" opacity="${opacity}"/>`;
    });
    rowLabels.forEach((l,i) => { rowLbls+=`<text x="${PAD_L-3}" y="${(PAD_T+i*CELL_H+CELL_H/2+4).toFixed(1)}" text-anchor="end" class="an2-axis-lbl" font-size="13" font-family="sans-serif">${l}</text>`; });
    colLabels.forEach((l,i) => { if(!l)return; colLbls+=`<text x="${(PAD_L+i*CELL_W+CELL_W/2).toFixed(1)}" y="${(PAD_T-5).toFixed(1)}" text-anchor="middle" class="an2-axis-lbl" font-size="7.5" font-family="sans-serif">${l}</text>`; });
    return `<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block" preserveAspectRatio="xMidYMid meet">${rects}${rowLbls}${colLbls}</svg></div>`;
  }

  // ── INTERACTIVE MAIN CHART SVG (v2) ──
  function _anMainSVG(series, dates, clients) {
    const W = 700, H = 188, PADl = 56, PADr = 12, PADt = 16, PADb = 36;
    const cW = W - PADl - PADr, cH = H - PADt - PADb;
    const N = dates.length;
    if (!series.length || !N) return '<div class="an2-empty"><i class="fas fa-chart-line"></i> Aucune donnée sur la période</div>';
    const px = i => PADl + (i / Math.max(N - 1, 1)) * cW;
    const py = v => PADt + cH - (v / 100) * cH;

    // Normalize each series individually to 0-100, keep real max
    const normSeries = series.map(s => {
      const mx = Math.max(...s.vals, 0.001);
      return { ...s, normVals: s.vals.map(v => v / mx * 100), mx };
    });

    // Primary series = first visible one → drives Y-axis labels
    const primary = normSeries[0];

    function fmtAxisVal(v, unit) {
      if (v === 0) return '0';
      if (unit === 'kWh' && v >= 1000) return `${(v/1000).toFixed(v>=10000?0:1).replace(/\.0$/,'')} MWh`;
      if (v >= 10000) return `${Math.round(v/1000)}k`;
      if (v >= 1000) return `${(v/1000).toFixed(1).replace(/\.0$/,'')}k`;
      if (v >= 100) return Math.round(v).toString();
      if (v >= 10) return v.toFixed(1).replace(/\.0$/,'');
      return v.toFixed(2).replace(/\.?0+$/,'');
    }

    let defs = '', grid = '', areas = '', maLines = '', lines = '', dots = '', xlbls = '';

    // Grid + Y-axis labels (real values from primary series)
    for (let g = 0; g <= 4; g++) {
      const y = PADt + (g / 4) * cH;
      const realVal = primary ? primary.mx * (1 - g / 4) : 0;
      const lbl = primary ? fmtAxisVal(realVal, primary.unit) : '';
      grid += `<line x1="${PADl}" y1="${y.toFixed(1)}" x2="${W-PADr}" y2="${y.toFixed(1)}" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>`;
      grid += `<text x="${(PADl-4).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" class="an2-axis-lbl">${lbl}</text>`;
    }
    // Unit label above Y-axis
    if (primary) {
      grid += `<text x="${(PADl-4).toFixed(1)}" y="${(PADt-4).toFixed(1)}" text-anchor="end" class="an2-axis-unit">${primary.unit}</text>`;
    }

    // X-axis date labels
    const MONTHS = ['jan','fév','mar','avr','mai','jui','jul','aoû','sep','oct','nov','déc'];
    const DAYS   = ['dim','lun','mar','mer','jeu','ven','sam'];
    const step = N <= 7 ? 1 : N <= 30 ? 5 : N <= 90 ? 14 : 30;
    dates.forEach((ds, i) => {
      if (i % step !== 0 && i !== N - 1) return;
      const dt = new Date(ds + 'T12:00');
      let lbl;
      if (N <= 7) lbl = `${DAYS[dt.getDay()]} ${dt.getDate()}`;
      else if (N <= 90) lbl = `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
      else lbl = `${MONTHS[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`;
      xlbls += `<text x="${px(i).toFixed(1)}" y="${(H - PADb + 16).toFixed(1)}" text-anchor="middle" class="an2-axis-lbl">${lbl}</text>`;
    });

    normSeries.forEach(ds => {
      if (!ds.normVals.some(v => v > 0)) return;
      const pts = ds.normVals.map((v, i) => ({ x: px(i), y: py(v) }));
      let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i-1], p1 = pts[i], cpx = (p0.x + p1.x) / 2;
        d += ` C ${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      }
      const bY = (PADt + cH).toFixed(1);
      const gId = 'mc' + ds.color.replace('#', '');
      defs += `<linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${ds.color}" stop-opacity="0.18"/><stop offset="100%" stop-color="${ds.color}" stop-opacity="0.01"/></linearGradient>`;
      areas += `<path d="${d} L ${pts[pts.length-1].x.toFixed(1)},${bY} L ${pts[0].x.toFixed(1)},${bY} Z" fill="url(#${gId})"/>`;
      lines += `<path d="${d}" fill="none" stroke="${ds.color}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>`;
      // 7-day moving average
      const MA = 7;
      let maD = '';
      ds.normVals.forEach((_, i) => {
        const sl = ds.normVals.slice(Math.max(0, i - MA + 1), i + 1).filter(v => v > 0);
        if (!sl.length) return;
        const avg = sl.reduce((a, b) => a + b, 0) / sl.length;
        maD += maD ? ` L ${px(i).toFixed(1)},${py(avg).toFixed(1)}` : `M ${px(i).toFixed(1)},${py(avg).toFixed(1)}`;
      });
      if (maD) maLines += `<path d="${maD}" fill="none" stroke="${ds.color}" stroke-width="1" stroke-dasharray="3,3" opacity="0.35"/>`;
      // Anomaly dots
      ds.normVals.forEach((v, i) => {
        if (v > 108) dots += `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3.5" fill="#ef4444" opacity="0.85" stroke="white" stroke-width="1"/>`;
      });
      // Last point
      const last = pts[pts.length-1];
      lines += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.8" fill="${ds.color}" stroke="white" stroke-width="1.2"/>`;
    });

    const baseY = (PADt + cH).toFixed(1);
    const overlay = `<rect id="an2-overlay" x="${PADl}" y="${PADt}" width="${cW}" height="${cH}" fill="transparent" style="cursor:crosshair"/>`;
    const vcursor = `<line id="an2-vcursor" x1="${PADl}" y1="${PADt}" x2="${PADl}" y2="${PADt+cH}" stroke="rgba(0,0,0,0.18)" stroke-width="1" stroke-dasharray="3,2" display="none"/>`;

    // Store data for JS interactivity
    window._anChartData = { dates, series, W, PADl, PADr, cW, N, clients: clients || {} };

    return `<div class="ra-svg-wrap an2-chart-svg-wrap">
      <svg id="an2-svg" width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">
        <defs>${defs}</defs>
        <line x1="${PADl}" y1="${baseY}" x2="${W-PADr}" y2="${baseY}" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
        ${grid}${areas}${maLines}${lines}${dots}${xlbls}${overlay}${vcursor}
      </svg>
    </div>`;
  }

  // ── SCORE GAUGE SVG (semi-circle) ──
  function _anScoreGauge(score, grade, color) {
    const W = 156, H = 88, cx = 78, cy = 80, R = 50, sw = 10;
    const s = Math.min(100, Math.max(0, score));
    // Arc goes from left (9 o'clock) CCW through top to right (3 o'clock)
    // End angle in math convention: π - s/100*π
    const endAng = Math.PI - (s / 100) * Math.PI;
    const ex = (cx + R * Math.cos(endAng)).toFixed(1);
    const ey = (cy - R * Math.sin(endAng)).toFixed(1); // SVG y inverted
    const large = s >= 100 ? 1 : 0;
    // Background full arc
    const bgArc = `M ${cx-R},${cy} A ${R},${R} 0 0 0 ${cx+R},${cy}`;
    // Filled arc (CCW sweep=0)
    const fillArc = s <= 0 ? '' : s >= 100
      ? `M ${cx-R},${cy} A ${R},${R} 0 1 0 ${cx+R},${cy}`
      : `M ${cx-R},${cy} A ${R},${R} 0 ${large} 0 ${ex},${ey}`;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <path d="${bgArc}" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="${sw}" stroke-linecap="round"/>
      ${fillArc ? `<path d="${fillArc}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>` : ''}
      <text x="${cx}" y="${cy-10}" text-anchor="middle" fill="${color}" font-size="26" font-weight="700" font-family="monospace">${grade}</text>
      <text x="${cx}" y="${cy+8}" text-anchor="middle" class="an2-axis-lbl" font-size="10" font-family="sans-serif">${score} / 100</text>
    </svg>`;
  }

  // ── ENERGY SCORE ──
  function _calcScore() {
    const today = _today();
    let deduct = 0, checked = 0;
    ['eau_froide', 'eau_chaude', 'electricite'].forEach(type => {
      const todayC = sumConsumptionByType(_readings, _meters, type, today);
      if (!todayC) return;
      checked++;
      const past30 = Array.from({ length: 30 }, (_, i) => sumConsumptionByType(_readings, _meters, type, _daysAgo(i + 1)))
        .filter(v => v > 0);
      if (!past30.length) return;
      const { pct: ecart } = trendFromDeviation(todayC, average(past30));
      if (ecart > 50) deduct += 20;
      else if (ecart > 25) deduct += 10;
      else if (ecart > 10) deduct += 5;
    });
    return Math.max(0, Math.min(100, 100 - deduct));
  }

  // ── SMART ALERT DETECTION ──
  function _detectAlerts() {
    const today = _today();
    const alerts = [];
    const efIds  = _meters.filter(m => m.type === 'eau_froide').map(m => m.id);
    const ecIds  = _meters.filter(m => m.type === 'eau_chaude').map(m => m.id);

    // Surconsommation par compteur : détectée côté serveur (Cloud Function
    // onReadingWritten, event-driven sur cso_readings) et persistée dans
    // cso_energy_alerts — voir _csoAlerts / _meterRowHtml / _checkCriticalBanner.
    // Volontairement retiré d'ici pour éviter un double calcul/double alerte.

    // Compteur sans relevé récent
    _meters.forEach(m => {
      const mR = _readings.filter(r => r.meterId === m.id);
      if (!mR.length) {
        alerts.push({ type: 'sans_releve', level: 'warning', metric: m.type, title: 'Compteur sans relevé', msg: `${m.name} — aucun relevé`, zone: m.location || '' });
      } else {
        const ds = mR[0].date || '';
        const days = ds ? Math.floor((new Date(today) - new Date(ds)) / 86400000) : 999;
        if (days > 3) alerts.push({ type: 'sans_releve', level: days > 7 ? 'critical' : 'warning', metric: m.type, title: 'Compteur sans relevé', msg: `${m.name} — dernier relevé il y a ${days}j`, zone: m.location || '' });
      }
    });

    // Compteur bloqué (même index sur 2 relevés)
    _meters.forEach(m => {
      const mR = _readings.filter(r => r.meterId === m.id).slice(0, 3);
      if (mR.length >= 2 && mR[0].index != null && mR[0].index === mR[1].index) {
        alerts.push({ type: 'bloque', level: 'warning', metric: m.type, title: 'Compteur bloqué', msg: `${m.name} — index identique sur les 2 derniers relevés`, zone: m.location || '' });
      }
    });

    // ECS excessive (eau chaude ≥ 70% eau froide)
    if (efIds.length && ecIds.length) {
      const ef = sumConsumption(_readings, efIds, today);
      const ec = sumConsumption(_readings, ecIds, today);
      if (ef > 0 && ec >= ef * 0.7) alerts.push({ type: 'ecs_excessive', level: 'warning', metric: 'eau_chaude', title: 'ECS excessive', msg: `Eau chaude (${_fmt(ec)} m³) ≥ 70% de l'eau froide (${_fmt(ef)} m³)` });
    }

    _lastSmartAlerts = alerts;
    return alerts;
  }

  // ── CRITICAL BANNER SYSTEM ──
  function _beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.45);
    } catch(e) {}
  }
  function _startBeep() { if (_critBeepTimer) return; _beep(); _critBeepTimer = setInterval(_beep, 10000); }
  function _stopBeep()  { if (_critBeepTimer) { clearInterval(_critBeepTimer); _critBeepTimer = null; } }

  function _checkCriticalBanner() {
    _updateTitleBadge();
    const crits = _csoAlerts.filter(a => a.level === 'critical' && !a.acknowledged && a.status !== 'resolved');
    let banner = document.getElementById('cso-crit-banner');
    if (!crits.length) { _stopBeep(); if (banner) banner.remove(); _currentCritAlert = null; return; }
    const alert = crits[0];
    _currentCritAlert = alert;
    if (!banner) { banner = document.createElement('div'); banner.id = 'cso-crit-banner'; banner.className = 'cso-crit-banner'; document.body.appendChild(banner); _startBeep(); }
    banner.innerHTML = `<div class="cso-crit-inner">
      <span class="cso-crit-ico">🚨</span>
      <div class="cso-crit-msg"><b>ALERTE URGENTE</b> — ${esc(alert.title || alert.type || '')}<span class="cso-crit-sub">${esc(alert.msg || alert.message || '')}</span></div>
      <div class="cso-crit-acts">
        <button class="cso-crit-btn see" onclick="MX.Pages.Conso._supView()">Voir</button>
        <button class="cso-crit-btn int" onclick="MX.Pages.Conso._createIntFromAlert('${esc(alert.id)}')">Créer intervention</button>
        <button class="cso-crit-btn ign" onclick="MX.Pages.Conso._critDismiss('${esc(alert.id)}')">Ignorer</button>
      </div>
    </div>`;
  }

  function _supView() { _stopBeep(); MX.Pages.Conso._tab('alertes'); }
  function _critDismiss(id) { _stopBeep(); const b = document.getElementById('cso-crit-banner'); if (b) b.remove(); _resolveAlert(id); }

  async function _resolveAlert(id) {
    try {
      await CSO.alerts().doc(id).update({
        acknowledged: true, acknowledgedAt: FV.serverTimestamp(), acknowledgedBy: _author(),
        status: 'resolved', resolvedAt: FV.serverTimestamp(), resolvedBy: _author(), resolvedReason: 'manual',
      });
    } catch(e) { console.error(e); }
  }

  // ── Live count of active meter anomalies, reflected in the page title ──
  function _activeAnomalyCount() {
    return _csoAlerts.filter(a => a.status === 'active').length;
  }
  function _updateTitleBadge() {
    const el = document.getElementById('topbar-title');
    if (!el || !MX.state || MX.state.currentPage !== 'consommations') return;
    const n = _activeAnomalyCount();
    el.innerHTML = n ? `Consommations <span class="cso-title-anomaly-badge">🚨 ${n}</span>` : 'Consommations';
  }

  async function _createIntFromAlert(id) {
    _stopBeep(); const b = document.getElementById('cso-crit-banner'); if (b) b.remove();
    const alert = _csoAlerts.find(a => a.id === id);
    if (alert) { window._intPrefill = { title: alert.title || 'Alerte énergie', priority: 'haute', zone: alert.zone || '', desc: alert.msg || alert.message || '', source: 'cso_alert' }; MX.nav && MX.nav('interventions'); }
    await _resolveAlert(id);
  }

  function _salCreateInt(idx) {
    const a = _lastSmartAlerts[idx]; if (!a) return;
    window._intPrefill = { title: a.title, priority: a.level === 'critical' ? 'haute' : 'moyenne', zone: a.zone || '', desc: a.msg, source: 'cso_smart_alert' };
    MX.nav && MX.nav('interventions');
  }

  async function _salSave(idx) {
    const a = _lastSmartAlerts[idx]; if (!a) return;
    try {
      await CSO.alerts().add({ type: a.type, level: a.level, metric: a.metric, title: a.title, msg: a.msg, zone: a.zone || '', ecart: a.ecart || null, date: _today(), ts: FV.serverTimestamp(), acknowledged: false });
      MX.toast('Alerte sauvegardée');
    } catch(e) { MX.toast('Erreur sauvegarde', true); console.error(e); }
  }

  // ── DATA LAYER ──
  function _load() {
    if (_loaded) return;
    _loaded = true;
    _unsubCso.meters = CSO.meters().orderBy('name').onSnapshot(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _meters         = all.filter(m => !m.archived);
      _archivedMeters = all.filter(m =>  m.archived);
      _rerender();
    }, _fsErr('cso_meters'));
    _unsubCso.readings = CSO.readings().orderBy('createdAt', 'desc').limit(_readingsLiveCap).onSnapshot(snap => {
      // Detect index changes to trigger recalculation for multi-session modifications.
      // _recalcMeter only writes `consumption` (not `index`), so cache mismatches on
      // `index` exclusively detect real user edits — no infinite recalc loop possible.
      const changedMeterIds = new Set();
      snap.docChanges().forEach(change => {
        const data = change.doc.data();
        const id   = change.doc.id;
        if (change.type === 'modified' || change.type === 'added') {
          const prevIdx = _readingIndexCache[id];
          if (prevIdx !== data.index) changedMeterIds.add(data.meterId);
          _readingIndexCache[id] = data.index;
        } else if (change.type === 'removed') {
          if (_readingIndexCache[id] !== undefined) changedMeterIds.add(data.meterId);
          delete _readingIndexCache[id];
        }
      });
      // Fusionne (ne remplace pas) : préserve les relevés complémentaires
      // chargés par _ensureReadingsFrom (marqués _ext), hors de la fenêtre
      // live, tout en rafraîchissant intégralement la fenêtre live elle-même.
      const liveDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const liveIds  = new Set(liveDocs.map(d => d.id));
      _readings = liveDocs.concat(_readings.filter(r => r._ext && !liveIds.has(r.id)));
      changedMeterIds.forEach(mid => recalculateConsumption(mid).catch(() => {}));
      _rerender();
    }, _fsErr('cso_readings'));
    _unsubCso.clients = CSO.clients().orderBy('date', 'desc').limit(_clientsLiveCap).onSnapshot(snap => {
      // Fusionne : préserve les dates complémentaires chargées par
      // _ensureClientsFrom / saisies via _editCli hors de la fenêtre live.
      const liveDates = new Set();
      snap.docs.forEach(d => { _clients[d.id] = d.data().count; liveDates.add(d.id); });
      Object.keys(_clients).forEach(d => {
        if (!liveDates.has(d) && !_clientsExtDates.has(d)) delete _clients[d];
      });
      _clientsLiveMinDate = snap.size === _clientsLiveCap ? [...liveDates].sort()[0] : null;
      _rerender();
    }, _fsErr('cso_clients'));
    _unsubCso.alerts = CSO.alerts().orderBy('ts', 'desc').limit(100).onSnapshot(snap => {
      _csoAlerts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _checkCriticalBanner();
      _rerender();
    }, _fsErr('cso_energy_alerts'));
    _unsubCso.perfConfig = CSO.perfConfig().onSnapshot(snap => {
      _perfCfg = { thresholds: {}, classes: {}, ref_meters: {}, objectifs: {}, justifications: {}, alert_rules: {} };
      snap.docs.forEach(d => {
        if (d.id === 'thresholds')     _perfCfg.thresholds     = d.data();
        if (d.id === 'classes')        _perfCfg.classes        = d.data();
        if (d.id === 'ref_meters')     _perfCfg.ref_meters     = d.data();
        if (d.id === 'objectifs')      _perfCfg.objectifs      = d.data();
        if (d.id === 'justifications') _perfCfg.justifications = d.data();
        if (d.id === 'alert_rules')    _perfCfg.alert_rules    = d.data();
      });
      _rerender();
    }, _fsErr('cso_perf_config'));
  }

  // ── CHARGEMENT COMPLÉMENTAIRE PAR PLAGE DE DATES (Phase 1B) ─────────────
  // Ces fonctions sont volontairement séparées du listener live : une seule
  // requête ponctuelle (`.get()`, pas `.onSnapshot()`) par plage manquante,
  // jamais une deuxième souscription temps réel — le volume de lecture reste
  // borné à ce qui est réellement demandé par la page ouverte, pas à un flux
  // continu supplémentaire.

  // Date la plus ancienne garantie couverte par le SEUL listener live (hors
  // relevés complémentaires `_ext`). `null` = le listener n'a pas atteint son
  // plafond → il contient tout l'historique, aucune requête n'est jamais utile.
  function _liveGuaranteedFrom() {
    const live = _readings.filter(r => !r._ext);
    if (live.length < _readingsLiveCap) return null;
    let min = null;
    live.forEach(r => { if (r.date && (!min || r.date < min)) min = r.date; });
    return min;
  }

  // Garantit que _readings couvre au moins depuis `minDateNeeded` jusqu'à
  // aujourd'hui. Ne bloque jamais le rendu en cours : si la donnée manque,
  // une requête ponctuelle part en tâche de fond et déclenche _rerender() à
  // son retour — la page affichée se complète alors d'elle-même, exactement
  // comme le fait déjà un listener live qui reçoit une mise à jour.
  function _ensureReadingsFrom(minDateNeeded) {
    if (!minDateNeeded) return;
    const guaranteedFrom = _extReadingsFrom || _liveGuaranteedFrom();
    if (guaranteedFrom === null) return;       // tout l'historique est déjà en mémoire
    if (minDateNeeded >= guaranteedFrom) return; // déjà couvert
    if (_extReadingsFetching) return;          // une requête est déjà en vol ; son _rerender() re-testera
    _extReadingsFetching = CSO.readings()
      .where('date', '>=', minDateNeeded)
      .where('date', '<',  guaranteedFrom)
      .get()
      .then(snap => {
        const known = new Set(_readings.map(r => r.id));
        snap.docs.forEach(d => {
          if (!known.has(d.id)) _readings.push({ id: d.id, ...d.data(), _ext: true });
        });
        _extReadingsFrom = minDateNeeded;
        _rerender();
      })
      .catch(_fsErr('cso_readings (plage complémentaire)'))
      .finally(() => { _extReadingsFetching = null; });
  }

  // Purge les relevés complémentaires d'UN compteur après un recalcul —
  // leur `consumption` peut être devenu obsolète (le recalcul réécrit tous
  // les relevés du compteur, pas seulement le plus récent) et, hors de la
  // fenêtre live, rien ne les aurait rafraîchis automatiquement. Réinitialise
  // aussi le marqueur global : plus simple et plus sûr qu'un recalcul fin de
  // "quelles plages restent valides", au prix d'une re-requête un peu plus
  // large au prochain besoin (rare : uniquement après écriture d'un relevé).
  function _invalidateExtReadings(meterId) {
    if (_extReadingsFrom === null) return;
    _readings = _readings.filter(r => !(r._ext && r.meterId === meterId));
    _extReadingsFrom = null;
  }

  // Équivalent de _ensureReadingsFrom pour cso_clients (plafond du listener
  // live : _clientsLiveCap jours). Pas de mécanisme d'invalidation séparé :
  // _editCli met à jour _clients[date] en local immédiatement après écriture
  // (donnée connue avec certitude, jamais besoin de la rafraîchir).
  function _ensureClientsFrom(minDateNeeded) {
    if (!minDateNeeded) return;
    const guaranteedFrom = _clientsLiveMinDate;
    if (guaranteedFrom === null) return;
    if (minDateNeeded >= guaranteedFrom) return;
    if (_extClientsFetching) return;
    _extClientsFetching = CSO.clients()
      .where('date', '>=', minDateNeeded)
      .where('date', '<',  guaranteedFrom)
      .get()
      .then(snap => {
        snap.docs.forEach(d => { _clients[d.id] = d.data().count; _clientsExtDates.add(d.id); });
        _rerender();
      })
      .catch(_fsErr('cso_clients (plage complémentaire)'))
      .finally(() => { _extClientsFetching = null; });
  }

  // ── RENDER ──
  function render() {
    if (window._csoStartTab) { _curTab = window._csoStartTab; window._csoStartTab = null; }
    _load();
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="cso-page">
      <div class="cso-tabs">
        ${TABS.map(t => `<button class="cso-tab${_curTab===t.id?' active':''}" data-tab="${t.id}" onclick="MX.Pages.Conso._tab('${t.id}')">
          <i class="fas ${t.icon}"></i>
          <span class="cso-tab-full">${t.l}</span>
          <span class="cso-tab-mob">${t.mob}</span>
        </button>`).join('')}
      </div>
      <div class="cso-body" id="cso-body">${_body()}</div>
      <button class="cso-mob-fab" onclick="MX.Pages.Conso._newReading(null)" aria-label="Nouveau relevé">
        <i class="fas fa-camera"></i>
      </button>
    </div>`;
    _updateTitleBadge();
  }

  // ── INTERACTIVE CHART INIT (v2) ──
  function _anInit() {
    const svg  = document.getElementById('an2-svg');
    const tip  = document.getElementById('an2-tooltip');
    const wrap = document.getElementById('an2-chart-wrap');
    const data = window._anChartData;
    if (!svg || !tip || !data || !data.dates.length) return;
    const { W, PADl, PADr, cW, N, dates, series, clients } = data;

    function fmtN(n) { if (n == null || n === 0) return '0'; return n >= 1000 ? n.toFixed(0) : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2); }
    function getIdx(e) {
      const rect = svg.getBoundingClientRect();
      const vbX = (e.clientX - rect.left) / rect.width * W;
      return Math.max(0, Math.min(N - 1, Math.round((vbX - PADl) / cW * (N - 1))));
    }
    function dateFull(ds) {
      if (!ds) return '';
      const [y, m, d] = ds.split('-');
      const mn = ['Janv.','Févr.','Mars','Avr.','Mai','Juin','Juil.','Août','Sept.','Oct.','Nov.','Déc.'][parseInt(m)-1];
      return `${parseInt(d)} ${mn} ${y}`;
    }

    const vcursor = document.getElementById('an2-vcursor');
    svg.addEventListener('mousemove', function(e) {
      const idx  = getIdx(e);
      const date = dates[idx];
      const rect = svg.getBoundingClientRect();
      const vbX  = (e.clientX - rect.left) / rect.width * W;
      const cx   = Math.max(PADl, Math.min(W - PADr, vbX));
      if (vcursor) { vcursor.setAttribute('x1', cx.toFixed(1)); vcursor.setAttribute('x2', cx.toFixed(1)); vcursor.removeAttribute('display'); }

      const cli = (clients && clients[date]) || 0;
      let html = `<div class="an2-tt-date">${dateFull(date)}${cli > 0 ? `<span class="an2-tt-cli">👥 ${cli} clients</span>` : ''}</div>`;
      let hasAny = false;
      series.forEach(s => {
        const v = s.vals[idx] ?? null;
        const prev = idx > 0 ? (s.vals[idx-1] ?? null) : null;
        const evo  = v != null && prev != null && prev > 0 ? ((v - prev) / prev * 100) : null;
        const ec   = evo !== null ? `<span style="color:${evo>5?'var(--red)':evo<-5?'var(--green)':'var(--text3)'};margin-left:4px;font-size:9px">${evo>0?'↑ +':'↓ '}${Math.abs(evo).toFixed(0)}%</span>` : '';
        const valStr = v != null && v > 0 ? `<b>${fmtN(v)}</b> ${s.unit}` : `<span style="color:var(--text3)">—</span>`;
        const ratio = v != null && v > 0 && cli > 0 ? computeRatio(s.type, v, cli) : null;
        const ratioStr = ratio !== null ? `<span class="an2-tt-sub">${fmtN(ratio)} ${_isLiterRatioType(s.type) ? 'L' : s.unit}/client</span>` : '';
        const avg30 = s.avg30 ?? null;
        const avgStr = avg30 != null && avg30 > 0 ? `<span class="an2-tt-sub">moy.30j : ${fmtN(avg30)} ${s.unit}</span>` : '';
        html += `<div class="an2-tt-row"><span style="color:${s.color}">${s.icon} ${s.label}</span><span class="an2-tt-val">${valStr}${ec}</span></div>`;
        if (ratioStr || avgStr) html += `<div class="an2-tt-subs">${avgStr}${ratioStr}</div>`;
        if (v != null && v > 0) hasAny = true;
      });
      if (!hasAny) html += `<div class="an2-tt-row" style="color:var(--text3);font-size:10px;justify-content:center">Aucune donnée ce jour</div>`;

      tip.innerHTML = html;
      tip.style.display = 'block';
      const wRect = wrap.getBoundingClientRect();
      let tx = e.clientX - wRect.left + 14;
      if (tx + 220 > wRect.width) tx = e.clientX - wRect.left - 228;
      tip.style.left = Math.max(0, tx) + 'px';
      tip.style.top  = Math.max(0, e.clientY - wRect.top - 20) + 'px';
    });
    svg.addEventListener('mouseleave', function() {
      tip.style.display = 'none';
      if (vcursor) vcursor.setAttribute('display', 'none');
    });
  }

  function _rerender() {
    const el = document.getElementById('cso-body');
    if (el) el.innerHTML = _body();
    _checkCriticalBanner();
    if (_curTab === 'analyses') setTimeout(_anInit, 30);
    // 'dashboard' rend désormais le même contenu que 'performance' (Phase 4) —
    // les deux doivent déclencher les mêmes animations d'entrée.
    if (_curTab === 'performance' || _curTab === 'dashboard') setTimeout(_peInitAnimations, 60);
    if (MX.state && MX.state.currentPage === 'home') {
      MX.Pages && MX.Pages.Home && MX.Pages.Home.render();
    }
  }

  function _getCsoState() {
    return {
      meters: _meters, readings: _readings, clients: _clients, loaded: _loaded,
      extReadingsFrom: _extReadingsFrom, clientsLiveMinDate: _clientsLiveMinDate,
    };
  }

  function _tab(id) {
    _curTab = id;
    document.querySelectorAll('.cso-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    _rerender();
  }

  // Recharge le contenu de l'onglet courant sans en changer l'identité.
  // Utilisé par les boutons internes de Performance (période, navigation
  // mois/jour...) qui ont besoin de rafraîchir l'affichage : appeler
  // _tab('performance') directement forcerait _curTab sur 'performance' même
  // quand l'utilisateur se trouve sur l'onglet 'dashboard' (Phase 4 : les
  // deux affichent la même page), ce qui ferait sauter l'onglet actif à
  // chaque clic sur une pagination interne.
  function _peRefresh() { _rerender(); }

  function _body() {
    switch (_curTab) {
      case 'compteurs': return _tCompteurs();
      case 'releves':   return _tReleves();
      case 'performance': return _tPerformance();
      case 'analyses':  return _tAnalyses();
      case 'alertes':   return _tAlertes();
      case 'exports':   return _tExports();
      // Phase 4 : l'ancien "Tableau de bord" (_tDashboard) est remplacé par
      // la page Performance — source de vérité unique (_tPerformance), pas
      // de copie. _tDashboard() est volontairement conservée plus bas,
      // inutilisée, en cas de retour arrière ; aucun autre code n'y fait
      // référence (voir _rerender et les handlers _pe* ci-dessous).
      case 'dashboard': return _tPerformance();
      default:          return _tPerformance();
    }
  }

  // ── DATE NAV (Compteurs tab) ──
  function _csoDateSet(ds) {
    const today = _today();
    if (!ds || ds > today) return;
    _csoSelDate = ds === today ? '' : ds;
    if (_curTab === 'compteurs') _rerender();
  }
  function _csoDatePrev() {
    const base = _csoSelDate || _today();
    const d = new Date(base + 'T12:00');
    d.setDate(d.getDate() - 1);
    _csoSelDate = d.toISOString().slice(0, 10);
    _rerender();
  }
  function _csoDateNext() {
    if (!_csoSelDate) return;
    const today = _today();
    const d = new Date(_csoSelDate + 'T12:00');
    d.setDate(d.getDate() + 1);
    const next = d.toISOString().slice(0, 10);
    _csoSelDate = next >= today ? '' : next;
    _rerender();
  }

  // ── TAB: DASHBOARD (Phase 4 : NON APPELÉE) ──────────────────────────────
  // _body() ne route plus aucun onglet vers cette fonction — l'onglet
  // 'dashboard' (renommé "Accueil") rend désormais _tPerformance(), seule
  // page conservée. Fonction volontairement gardée intacte (non supprimée)
  // pour permettre un retour en arrière rapide ; à retirer dans une phase
  // ultérieure une fois la bascule confirmée stable.
  // ── TAB: DASHBOARD — Phase 2 : vue de synthèse "quelques secondes" ──────
  // Toute la donnée passe par MX.CsoCalc (sumConsumptionByType, computeRatio,
  // comparePeriods, average, statusFromDeviation, periodDates) + MT — aucune
  // liste locale de types, aucun calcul parallèle. Les alertes affichées
  // viennent uniquement de _csoAlerts (cso_energy_alerts, source de vérité
  // persistée) : aucune nouvelle logique d'alerte n'est créée ici.
  function _tDashboard() {
    const today = _today();

    // ── Période comparée (jour / mois en cours / 30 derniers jours) ──
    // "Personnalisée" reste une capacité de periodDates('custom', ...) déjà
    // disponible ; le Tableau de bord n'expose que 3 préréglages pour rester
    // lisible "en quelques secondes" — l'exploration fine reste dans Analyses.
    const period = window._csoDashPeriod || 'day';
    let dates, prevDates, periodLbl, partialNote = '';
    if (period === 'month-current') {
      dates     = periodDates('month-current');
      prevDates = periodDates('month-previous').slice(0, dates.length);
      periodLbl = `Mois en cours · ${_dateLbl(dates[0])} → ${_dateLbl(today)}`;
      partialNote = `Comparé aux ${dates.length} premier${dates.length > 1 ? 's' : ''} jour${dates.length > 1 ? 's' : ''} du mois précédent (mois non terminé)`;
    } else if (period === 'last30') {
      dates     = periodDates('last30');
      prevDates = periodDates('custom', { start: _daysAgo(59), end: _daysAgo(30) });
      periodLbl = `30 derniers jours · ${_dateLbl(dates[0])} → ${_dateLbl(today)}`;
    } else {
      dates     = [today];
      prevDates = [_daysAgo(1)];
      periodLbl = `Aujourd'hui · ${_dateLbl(today)}`;
    }
    const allNeeded = dates.concat(prevDates);
    const minNeeded = allNeeded.reduce((m, d) => (!m || d < m) ? d : m, null);
    // Non bloquant : complète l'historique en tâche de fond si besoin (voir
    // _ensureReadingsFrom / _ensureClientsFrom, Phase 1B) — la page affichée
    // se met à jour seule (_rerender) si des données arrivent après coup.
    _ensureReadingsFrom(minNeeded);
    _ensureClientsFrom(minNeeded);

    const datesSet = new Set(dates);
    const hasAnyReadingInPeriod = _readings.some(r => datesSet.has(r.date));

    // ── A. En-tête ──
    const lastReadingMs = _readings.reduce((m, r) => { const ms = _tsMs(r.createdAt); return ms > m ? ms : m; }, 0);
    function _relTime(ms) {
      if (!ms) return null;
      const diffMin = Math.round((Date.now() - ms) / 60000);
      if (diffMin < 1)  return "à l'instant";
      if (diffMin < 60) return `il y a ${diffMin} min`;
      const diffH = Math.round(diffMin / 60);
      if (diffH < 24) return `il y a ${diffH} h`;
      return `il y a ${Math.round(diffH / 24)} j`;
    }
    const lastUpdateLbl = _relTime(lastReadingMs);

    const perBtns = [
      { id: 'day',           l: "Aujourd'hui" },
      { id: 'month-current', l: 'Mois en cours' },
      { id: 'last30',        l: '30 derniers jours' },
    ].map(p => `<button class="cso-per-btn${period === p.id ? ' active' : ''}" onclick="window._csoDashPeriod='${p.id}';MX.Pages.Conso._tab('dashboard')">${p.l}</button>`).join('');

    // ── Cas limite : aucun compteur configuré ──
    if (!_meters.length) {
      return `<div class="cso-inner">
        <div class="sv-header">
          <div class="sv-header-left">
            <i class="fas fa-gauge" style="color:var(--cyan);font-size:20px"></i>
            <div><div class="sv-header-ttl">Tableau de bord énergétique</div>
              <div class="sv-header-sub">Aucun compteur configuré</div></div>
          </div>
        </div>
        <div class="cso-chart2-empty">
          <i class="fas fa-gauge-high" style="font-size:28px;opacity:.25"></i><br>
          Aucun compteur n'est encore configuré — impossible de calculer une consommation.<br>
          <button class="cso-add-btn" onclick="MX.Pages.Conso._tab('compteurs')">Ajouter un compteur</button>
        </div>
      </div>`;
    }

    // ── B/C. Données par type d'énergie (source unique : MT + MX.CsoCalc) ──
    // Le statut par type (ok/warn/crit/na) reste une lecture LOCALE de
    // l'écart vs période précédente (comparePeriods/statusFromDeviation,
    // Phase 1) — affichée uniquement dans sa propre carte, jamais qualifiée
    // d'« alerte ». Elle n'alimente PAS le badge « Situation globale »
    // ci-dessous : celui-ci doit rester fondé uniquement sur les alertes
    // persistées (cso_energy_alerts), pour ne jamais laisser croire qu'un
    // simple écart de consommation local est une alerte enregistrée.
    let energyCardsHtml = '';
    Object.entries(MT).forEach(([type, meta]) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return; // aucun compteur de ce type : pas de carte (pas de "0" fictif)
      const unit = _meters.find(m => m.type === type)?.unit || meta.unit;

      const hasReading = _readings.some(r => ids.includes(r.meterId) && datesSet.has(r.date));
      const total       = sumConsumptionByType(_readings, _meters, type, dates);
      const prevTotal    = sumConsumptionByType(_readings, _meters, type, prevDates);
      const { pct, trend } = comparePeriods(total, prevTotal);
      const status = hasReading ? statusFromDeviation(pct) : 'na';

      const dailyRatios = dates
        .map(d => computeRatio(type, sumConsumptionByType(_readings, _meters, type, d), _clients[d] || 0))
        .filter(v => v !== null);
      const hasRatio = dailyRatios.length > 0;
      const avgRatio = hasRatio ? average(dailyRatios) : null;
      const rUnit = _isLiterRatioType(type) ? 'L/client' : `${unit}/client`;

      const stColor = status === 'crit' ? 'var(--red)' : status === 'warn' ? 'var(--orange)' : status === 'ok' ? 'var(--green)' : 'var(--text3)';
      // 'na' recouvre deux causes distinctes qu'il ne faut pas confondre à
      // l'affichage : aucun relevé du tout, ou un relevé existe mais sans
      // historique suffisant pour comparer (ex. rien sur la période
      // précédente) — sans quoi une vraie donnée du jour serait présentée
      // comme "Pas de relevé", ce qui serait faux.
      const stLabel = status === 'crit' ? 'Dérive marquée' : status === 'warn' ? 'À surveiller' : status === 'ok' ? 'Normal'
        : !hasReading ? 'Pas de relevé' : 'Historique insuffisant';
      const trendIcon = pct === null ? 'fa-minus' : trend === 'up' ? 'fa-arrow-trend-up' : trend === 'down' ? 'fa-arrow-trend-down' : 'fa-minus';

      energyCardsHtml += `<div class="sv-energy-card" style="--ec:${meta.color};--ed:${meta.dim}">
        <div class="sv-energy-hd">
          <span class="sv-energy-ico">${meta.icon}</span>
          <div>
            <div class="sv-energy-nm">${esc(meta.label)}</div>
            <div class="sv-energy-status" style="color:${stColor}"><span class="sv-status-dot" style="background:${stColor}"></span>${stLabel}</div>
          </div>
          <div class="sv-energy-ecart" style="color:${stColor}"><i class="fas ${trendIcon}"></i> ${pct !== null ? `${pct > 0 ? '+' : ''}${Math.round(pct)}%` : '—'}</div>
        </div>
        <div class="sv-energy-val">${hasReading ? _fmt(total) : '<span style="font-size:13px;color:var(--text3)">Aucun relevé</span>'}${hasReading ? `<span class="sv-energy-u"> ${esc(unit)}</span>` : ''}</div>
        <div class="sv-energy-foot">${hasRatio ? `${_fmt(avgRatio, _isLiterRatioType(type) ? 0 : 2)} ${rUnit}` : 'Ratio non disponible'}</div>
      </div>`;
    });

    // ── E. Alertes prioritaires (source de vérité : cso_energy_alerts) ──
    const activeAlerts = _csoAlerts.filter(a => a.status === 'active');
    const critCount = activeAlerts.filter(a => a.level === 'critical').length;
    const warnCount = activeAlerts.filter(a => a.level === 'warning').length;
    const sortedAlerts = [...activeAlerts].sort((a, b) => {
      if (a.level !== b.level) return a.level === 'critical' ? -1 : 1;
      return _tsMs(b.ts) - _tsMs(a.ts);
    });
    let alertsHtml = '';
    if (!sortedAlerts.length) {
      alertsHtml = `<div class="cso-chart2-empty"><i class="fas fa-check-circle" style="color:var(--green);font-size:20px"></i><br>Aucune alerte active</div>`;
    } else {
      sortedAlerts.slice(0, 4).forEach(a => {
        const meta = MT[a.metric] || {};
        const lvlC = a.level === 'critical' ? 'var(--red)' : 'var(--orange)';
        alertsHtml += `<div class="sv-tl-item sv-tl--${a.level}">
          <div class="sv-tl-line"><span class="sv-tl-dot" style="background:${lvlC}"></span></div>
          <div class="sv-tl-body">
            <div class="sv-tl-ttl">${meta.icon || '⚡'} ${esc(a.title || a.type || 'Alerte')}</div>
            <div class="sv-tl-msg">${esc(a.msg || a.message || '')}</div>
          </div>
          <div class="sv-tl-meta">
            <div class="sv-tl-acts">
              <button class="sv-tl-act" onclick="MX.Pages.Conso._createIntFromAlert('${esc(a.id)}')" title="Créer intervention"><i class="fas fa-screwdriver-wrench"></i></button>
            </div>
          </div>
        </div>`;
      });
      if (sortedAlerts.length > 4) {
        alertsHtml += `<button class="cso-add-btn" style="margin-top:8px" onclick="MX.Pages.Conso._tab('alertes')">Voir les ${sortedAlerts.length - 4} autre${sortedAlerts.length - 4 > 1 ? 's' : ''} — Supervision</button>`;
      }
    }

    // ── Situation globale : fondée UNIQUEMENT sur les alertes persistées ──
    // (cso_energy_alerts, source de vérité — même principe que le badge
    // d'en-tête de l'onglet Supervision). Ne dépend jamais du statut par
    // type ci-dessus : un écart de consommation local sans alerte
    // enregistrée reste visible dans sa propre carte, mais n'affiche
    // jamais "Anomalie"/"Alerte" en en-tête — cela laisserait croire à
    // une alerte persistée qui n'existe pas. Une alerte critique reste
    // affichée telle quelle même si la consommation est repassée à la
    // normale entre-temps : c'est à l'alerte d'être résolue (Supervision),
    // pas au Tableau de bord de la masquer de sa propre initiative.
    let globalStatus;
    if (critCount > 0) globalStatus = 'crit';
    else if (warnCount > 0) globalStatus = 'warn';
    else if (!hasAnyReadingInPeriod) globalStatus = 'na';
    else globalStatus = 'ok';
    const globalBadge = {
      crit: { cls: 'sv-badge--crit', icon: 'fa-triangle-exclamation', lbl: 'Alerte critique active' },
      warn: { cls: 'sv-badge--warn', icon: 'fa-exclamation-circle',  lbl: 'Alerte active à surveiller' },
      ok:   { cls: 'sv-badge--ok',   icon: 'fa-check-circle',        lbl: 'Situation normale' },
      na:   { cls: 'sv-badge--na',   icon: 'fa-circle-question',     lbl: 'Données insuffisantes' },
    }[globalStatus];

    // ── Clients (widget opérationnel du jour — indépendant de la période d'analyse choisie) ──
    const cliToday = _clients[today];
    const hasCliToday = cliToday !== undefined;

    return `<div class="cso-inner">
      <div class="sv-header">
        <div class="sv-header-left">
          <i class="fas fa-gauge" style="color:var(--cyan);font-size:20px"></i>
          <div>
            <div class="sv-header-ttl">Tableau de bord énergétique</div>
            <div class="sv-header-sub">${periodLbl}${lastUpdateLbl ? ` · Dernier relevé ${lastUpdateLbl}` : ''}</div>
          </div>
        </div>
        <div class="sv-header-badges">
          <span class="sv-badge ${globalBadge.cls}"><i class="fas ${globalBadge.icon}"></i> ${globalBadge.lbl}</span>
        </div>
      </div>

      <div class="cso-chart2-per">${perBtns}</div>
      ${partialNote ? `<div class="cso-dash-chart-tot" style="padding:0 2px">${esc(partialNote)}</div>` : ''}

      <div class="cso-cli-bar">
        <div class="cso-cli-ico">👥</div>
        <div class="cso-cli-info">
          <div class="cso-cli-val">${hasCliToday ? cliToday : '<span style="color:var(--text3);font-size:14px">Non renseigné</span>'}</div>
          <div class="cso-cli-lbl">Clients présents · ${_dateLbl(today)}</div>
        </div>
        <button class="cso-cli-btn" onclick="MX.Pages.Conso._editCli('${today}',${hasCliToday ? cliToday : 0})">
          <i class="fas fa-pen"></i> ${hasCliToday ? 'Modifier' : 'Renseigner'}
        </button>
      </div>

      <div class="cso-kpi-grid">
        <div class="cso-kpi-card" style="--kc:var(--cyan);--kd:rgba(139,92,246,0.15)">
          <div class="cso-kpi-bar"></div>
          <div class="cso-kpi-hd"><span class="cso-kpi-emoji"><i class="fas fa-gauge-high"></i></span><span class="cso-kpi-nm">Compteurs actifs</span></div>
          <div class="cso-kpi-v">${_meters.length}</div>
        </div>
        <div class="cso-kpi-card" style="--kc:${critCount > 0 ? '#EF4444' : warnCount > 0 ? '#F97316' : '#22C55E'};--kd:rgba(239,68,68,0.15)">
          <div class="cso-kpi-bar"></div>
          <div class="cso-kpi-hd"><span class="cso-kpi-emoji"><i class="fas fa-bell"></i></span><span class="cso-kpi-nm">Alertes actives</span></div>
          <div class="cso-kpi-v">${activeAlerts.length}</div>
          ${activeAlerts.length ? `<div class="cso-kpi-delta up">${critCount} critique${critCount !== 1 ? 's' : ''} · ${warnCount} attention${warnCount !== 1 ? 's' : ''}</div>` : ''}
        </div>
      </div>

      ${!hasAnyReadingInPeriod
        ? `<div class="cso-chart2-empty"><i class="fas fa-camera" style="font-size:26px;opacity:.25"></i><br>Aucun relevé enregistré sur cette période.<br>
            <button class="cso-add-btn" onclick="MX.Pages.Conso._newReading(null)">Faire un relevé</button></div>`
        : `<div class="sv-energy-grid">${energyCardsHtml}</div>`
      }

      <div class="sv-timeline">
        <div class="sv-section-ttl"><i class="fas fa-list-check"></i> Alertes prioritaires <span class="sv-cnt">${activeAlerts.length}</span></div>
        ${alertsHtml}
      </div>

      <button class="cso-fab-btn" onclick="MX.Pages.Conso._newReading(null)">
        <i class="fas fa-camera"></i> Nouveau relevé
      </button>
    </div>`;
  }

  // ── ZONE HELPERS ──
  function _getOpenZones() {
    if (_openZones !== null) return _openZones;
    try { _openZones = JSON.parse(localStorage.getItem('mx_cso_zones') || '{}'); }
    catch(e) { _openZones = {}; }
    return _openZones;
  }
  function _saveOpenZones() {
    try { localStorage.setItem('mx_cso_zones', JSON.stringify(_openZones)); } catch(e) {}
  }
  function _toggleZone(encoded) {
    const zone = decodeURIComponent(encoded);
    const oz   = _getOpenZones();
    oz[zone]   = oz[zone] !== false ? false : true; // default open; false = closed
    _saveOpenZones();
    _rerender();
  }
  function _zoneGroups() {
    const g = {};
    _meters.forEach(m => {
      const z = (m.location || '').trim() || 'Sans zone';
      if (!g[z]) g[z] = [];
      g[z].push(m);
    });
    return g;
  }
  function _filteredMeters(meters, selDate) {
    return meters.filter(m => {
      if (_csoTypeFilter === 'pending') {
        if (_readings.some(r => r.meterId === m.id && r.date === selDate)) return false;
      } else if (_csoTypeFilter === 'done') {
        if (!_readings.some(r => r.meterId === m.id && r.date === selDate)) return false;
      } else if (_csoTypeFilter !== 'all') {
        if (m.type !== _csoTypeFilter) return false;
      }
      if (_csoSearch) {
        const q    = _csoSearch.toLowerCase();
        const meta = MT[m.type] || MT.eau_froide;
        if (!m.name.toLowerCase().includes(q) &&
            !(m.location || '').toLowerCase().includes(q) &&
            !meta.label.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }
  function _csoSetSearch(v) { _csoSearch = v; _rerender(); }
  function _csoSetFilter(v) { _csoTypeFilter = v; _rerender(); }
  function _releverZone(encoded) {
    const location  = decodeURIComponent(encoded);
    const selDate   = _csoSelDate || _today();
    const allInZone = _meters.filter(m => ((m.location || '').trim() || 'Sans zone') === location);
    const pending   = allInZone.filter(m => !_readings.some(r => r.meterId === m.id && r.date === selDate));
    if (!pending.length) { MX.toast && MX.toast('✅ Tous les relevés de cette zone sont effectués !'); return; }
    _relQueue    = pending.map(m => m.id);
    _relQueueIdx = 0;
    _nextQueueReading();
  }
  function _nextQueueReading() {
    if (_relQueueIdx >= _relQueue.length) {
      _relQueue = [];
      MX.toast && MX.toast('✅ Tous les relevés effectués !');
      return;
    }
    const meterId = _relQueue[_relQueueIdx];
    const m = _meters.find(x => x.id === meterId);
    if (!m) { _relQueueIdx++; _nextQueueReading(); return; }
    _newReading(meterId);
  }
  function _meterRowHtml(m, selDate, cli, isToday) {
    const meta     = MT[m.type] || MT.eau_froide;
    const unit     = m.unit || meta.unit;
    const dateRdgs = _readings.filter(r => r.meterId === m.id && r.date === selDate);
    const lr       = dateRdgs[0];
    const selConso = dateRdgs.reduce((s, r) => s + (r.consumption || 0), 0);
    const ratio    = selConso > 0 ? computeRatio(m.type, selConso, cli) : null;
    const hasRdg   = !!lr;
    const resp     = _isResp();
    const alert    = _csoAlerts.find(a => a.meterId === m.id && a.status === 'active');
    let valLine = '';
    if (lr) {
      valLine = `Index&thinsp;: <b>${_fmtIdx(lr.index)}&thinsp;${esc(unit)}</b>`;
      if (selConso) valLine += ` &middot; Conso&thinsp;: +<b>${_fmtIdx(selConso)}</b>`;
      if (ratio !== null) valLine += ` &middot; R&thinsp;: <b>${_fmt(ratio, _isLiterRatioType(m.type) ? 0 : 2)}</b>`;
    } else {
      valLine = `<span class="cso-mrow-empty"><i class="fas fa-circle-minus"></i> Aucun relevé${isToday ? '' : ' ce jour'}</span>`;
    }
    const respBtns = resp ? `
        <button class="cso-ibtn green" title="Modifier" onclick="MX.Pages.Conso._meterForm('${m.id}')"><i class="fas fa-pen"></i></button>
        <span class="cso-mrow-acts-sep"></span>
        <button class="cso-ibtn amber" title="Archiver" onclick="MX.Pages.Conso._archiveMeter('${m.id}','${esc(m.name)}')"><i class="fas fa-box-archive"></i></button>
        <button class="cso-ibtn red" title="Supprimer" onclick="MX.Pages.Conso._delMeter('${m.id}','${esc(m.name)}')"><i class="fas fa-trash"></i></button>` : '';
    const alertBadge = alert
      ? `<span class="cso-mrow-badge cso-mrow-badge--${alert.level}">${alert.level === 'critical' ? 'CRITIQUE' : 'IMPORTANTE'}</span>`
      : `<span class="cso-mrow-badge ${hasRdg ? 'done' : 'pending'}">${hasRdg ? '✅ Relevé' : '🟠 En attente'}</span>`;
    const alertBlock = alert ? `
      <div class="cso-mrow-alert cso-mrow-alert--${alert.level}" onclick="event.stopPropagation()">
        <span class="cso-beacon" aria-hidden="true"></span>
        <div class="cso-mrow-alert-body">
          <div class="cso-mrow-alert-ttl">🚨 SURCONSOMMATION DÉTECTÉE</div>
          <div class="cso-mrow-alert-msg">${esc(alert.msg || '')}</div>
        </div>
        ${resp ? `<button class="cso-ibtn" title="Acquitter l'alerte" onclick="MX.Pages.Conso._resolveAlert('${esc(alert.id)}')"><i class="fas fa-check"></i></button>` : ''}
      </div>` : '';
    return `<div class="cso-mrow ${hasRdg ? 'done' : 'pending'}${alert ? ' cso-mrow--anomaly cso-mrow--' + alert.level : ''}" onclick="MX.Pages.Conso._newReading('${m.id}')">
      <div class="cso-mrow-ico" style="background:${meta.dim};color:${meta.color}">${meta.icon}</div>
      <div class="cso-mrow-info">
        <div class="cso-mrow-top">
          <span class="cso-mrow-name">${esc(m.name)}</span>
          ${alertBadge}
        </div>
        <div class="cso-mrow-vals">${valLine}</div>
        ${alertBlock}
      </div>
      <div class="cso-mrow-acts" onclick="event.stopPropagation()">
        <button class="cso-ibtn blue" title="Relevé" onclick="MX.Pages.Conso._newReading('${m.id}')"><i class="fas fa-camera"></i></button>
        <button class="cso-ibtn orange" title="Historique" onclick="MX.Pages.Conso._meterHistory('${m.id}')"><i class="fas fa-chart-line"></i></button>
        ${respBtns}
      </div>
    </div>`;
  }

  // ── TAB: COMPTEURS & RATIOS (zone-based compact refonte) ──
  function _tCompteurs() {
    const today   = _today();
    const selDate = _csoSelDate || today;
    const isToday = selDate === today;
    const cli     = _clients[selDate] || 0;
    // Navigation par jour (_csoDatePrev) pouvant remonter arbitrairement loin.
    _ensureReadingsFrom(selDate);
    _ensureClientsFrom(selDate);
    const prevDs  = (() => { const d = new Date(selDate + 'T12:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
    const nextDs  = (() => { const d = new Date(selDate + 'T12:00'); d.setDate(d.getDate() + 1); const n = d.toISOString().slice(0, 10); return n <= today ? n : null; })();

    let html = `<div class="cso-inner">
      <div class="cso-date-nav">
        <button class="cso-date-btn" onclick="MX.Pages.Conso._csoDatePrev()" title="${_dateLbl(prevDs)}"><i class="fas fa-chevron-left"></i></button>
        <input type="date" class="cso-date-inp" value="${selDate}" max="${today}" onchange="MX.Pages.Conso._csoDateSet(this.value)">
        <button class="cso-date-btn" onclick="MX.Pages.Conso._csoDateNext()"${!nextDs ? ' disabled' : ''} title="${nextDs ? _dateLbl(nextDs) : ''}"><i class="fas fa-chevron-right"></i></button>
        ${!isToday ? `<button class="cso-date-today-btn" onclick="MX.Pages.Conso._csoDateSet('${today}')">Aujourd'hui</button>` : ''}
      </div>
      <div class="cso-cli-bar">
        <div class="cso-cli-ico">👥</div>
        <div class="cso-cli-info">
          <div class="cso-cli-val">${cli > 0 ? cli : '—'}</div>
          <div class="cso-cli-lbl">Clients présents · ${_dateLbl(selDate)}</div>
        </div>
        <button class="cso-cli-btn" onclick="MX.Pages.Conso._editCli('${selDate}',${cli})">
          <i class="fas fa-pen"></i> ${cli > 0 ? 'Modifier' : 'Saisir'}
        </button>
      </div>`;

    if (!_meters.length) {
      html += `<div class="cso-empty-st">
        <div class="cso-empty-ico"><i class="fas fa-gauge-high"></i></div>
        <div class="cso-empty-ttl">Aucun compteur configuré</div>
        <div class="cso-empty-sub">Ajoutez votre premier compteur pour commencer.</div>
        ${_isResp() ? `<button class="cso-add-btn" style="margin-top:8px" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Ajouter un compteur</button>` : ''}
      </div>`;
    } else {
      // ── Barre de recherche ──
      html += `<div class="cso-compt-search-wrap">
        <i class="fas fa-magnifying-glass cso-search-ico"></i>
        <input class="cso-compt-search" type="search" placeholder="Nom, zone, type..." autocomplete="off"
               value="${esc(_csoSearch)}" oninput="MX.Pages.Conso._csoSetSearch(this.value)">
        ${_csoSearch ? `<button class="cso-search-clr" onclick="MX.Pages.Conso._csoSetSearch('')"><i class="fas fa-xmark"></i></button>` : ''}
      </div>`;

      // ── Filtres rapides ──
      const doneAll  = _meters.filter(m => _readings.some(r => r.meterId === m.id && r.date === selDate)).length;
      const pendAll  = _meters.length - doneAll;
      const usedTypes = [...new Set(_meters.map(m => m.type))].filter(t => MT[t]);
      html += `<div class="cso-fchips">
        <button class="cso-fchip${_csoTypeFilter === 'all' ? ' act' : ''}" onclick="MX.Pages.Conso._csoSetFilter('all')">Tous <span class="cso-fchip-cnt">${_meters.length}</span></button>
        <button class="cso-fchip${_csoTypeFilter === 'pending' ? ' act act-orange' : ''}" onclick="MX.Pages.Conso._csoSetFilter('pending')">🟠 À faire <span class="cso-fchip-cnt">${pendAll}</span></button>
        <button class="cso-fchip${_csoTypeFilter === 'done' ? ' act act-green' : ''}" onclick="MX.Pages.Conso._csoSetFilter('done')">✅ Relevés <span class="cso-fchip-cnt">${doneAll}</span></button>
        ${usedTypes.map(t => { const mt2 = MT[t]; return `<button class="cso-fchip${_csoTypeFilter === t ? ' act' : ''}" onclick="MX.Pages.Conso._csoSetFilter('${t}')">${mt2.icon} ${mt2.label}</button>`; }).join('')}
      </div>`;

      // ── Groupes par zone ──
      const groups     = _zoneGroups();
      const zoneSorted = Object.keys(groups).sort((a, b) => {
        if (a === 'Sans zone') return 1;
        if (b === 'Sans zone') return -1;
        return a.localeCompare(b, 'fr');
      });
      let anyVisible = false;
      zoneSorted.forEach(zone => {
        const allInZone = groups[zone];
        const filtered  = _filteredMeters(allInZone, selDate);
        if (!filtered.length) return;
        anyVisible = true;
        const oz     = _getOpenZones();
        const isOpen = oz[zone] !== false; // default: open
        const done   = allInZone.filter(m => _readings.some(r => r.meterId === m.id && r.date === selDate)).length;
        const total  = allInZone.length;
        const pct    = total ? Math.round(done / total * 100) : 0;
        const barClr = pct === 100 ? '#34d399' : pct >= 50 ? '#f59e0b' : '#f87171';
        const enc    = encodeURIComponent(zone);
        html += `<div class="cso-zone${isOpen ? ' open' : ''}">
          <div class="cso-zone-hd" onclick="MX.Pages.Conso._toggleZone('${enc}')">
            <div class="cso-zone-hd-left">
              <span class="cso-zone-chev">${isOpen ? '▼' : '▶'}</span>
              <span class="cso-zone-ico">📍</span>
              <span class="cso-zone-name">${esc(zone)}</span>
              <span class="cso-zone-total">${total}</span>
            </div>
            <button class="cso-zone-relev-btn" onclick="event.stopPropagation();MX.Pages.Conso._releverZone('${enc}')">
              <i class="fas fa-clipboard-list"></i><span class="cso-zone-relev-lbl"> Relever tout</span>
            </button>
          </div>
          <div class="cso-zone-prog">
            <div class="cso-zone-prog-txt">
              <span>${done === total ? '<span class="cso-zp-done">✅ Complet</span>' : `<span class="cso-zp-pend">🟠 ${total - done} en attente</span>`} · ${done}/${total}</span>
              <span class="cso-zone-pct">${pct}%</span>
            </div>
            <div class="cso-zone-track"><div class="cso-zone-fill" style="width:${pct}%;background:${barClr}"></div></div>
          </div>
          ${isOpen ? `<div class="cso-zone-body">${filtered.map(m => _meterRowHtml(m, selDate, cli, isToday)).join('')}</div>` : ''}
        </div>`;
      });
      if (!anyVisible) {
        html += `<div class="cso-empty-st"><div class="cso-empty-ico"><i class="fas fa-magnifying-glass"></i></div>
          <div class="cso-empty-ttl">Aucun résultat</div>
          <div class="cso-empty-sub">Modifiez le filtre ou la recherche.</div></div>`;
      }
      if (_isResp()) {
        html += `<button class="cso-add-meter-btn" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Nouveau compteur</button>`;
      }
    }

    // ── Compteurs archivés (Responsable uniquement) ──
    if (_isResp() && _archivedMeters.length) {
      const isOpen = window._csoArchOpen === true;
      html += `<div class="cso-arch-section">
        <div class="cso-arch-hdr" onclick="window._csoArchOpen=!window._csoArchOpen;MX.Pages.Conso._rerender()">
          <span class="cso-arch-chev">${isOpen ? '▼' : '▶'}</span>
          <i class="fas fa-box-archive"></i> Compteurs archivés
          <span class="cso-arch-badge">${_archivedMeters.length}</span>
        </div>`;
      if (isOpen) {
        html += `<div class="cso-arch-list">`;
        _archivedMeters.forEach(m => {
          const meta = MT[m.type] || MT.eau_froide;
          const rdgCount = _readings.filter(r => r.meterId === m.id).length;
          html += `<div class="cso-arch-row">
            <div class="cso-arch-ico" style="background:${meta.dim};color:${meta.color}">${meta.icon}</div>
            <div class="cso-arch-info">
              <div class="cso-arch-name">${esc(m.name)}</div>
              <div class="cso-arch-meta">${esc(meta.label)}${m.location ? ' · ' + esc(m.location) : ''} · ${rdgCount} relevé${rdgCount !== 1 ? 's' : ''}</div>
            </div>
            <div class="cso-arch-acts">
              <button class="cso-ibtn green" title="Restaurer" onclick="MX.Pages.Conso._restoreMeter('${m.id}','${esc(m.name)}')"><i class="fas fa-rotate-left"></i> Restaurer</button>
              <button class="cso-ibtn red" title="Supprimer définitivement" onclick="MX.Pages.Conso._delMeterPermanent('${m.id}','${esc(m.name)}')"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    }

    return html + '</div>';
  }

  // ── TAB: RELEVÉS ──
  function _tReleves() {
    const nowMs = Date.now();
    const exp7  = 7 * 86400000;
    let html = `<div class="cso-inner">
      <div class="cso-ph">
        <div class="cso-ph-ttl"><i class="fas fa-camera"></i> ${_readings.length} relevé${_readings.length !== 1 ? 's' : ''}</div>
        <button class="cso-add-btn" onclick="MX.Pages.Conso._newReading(null)"><i class="fas fa-camera"></i> Nouveau relevé</button>
      </div>`;

    if (!_readings.length) {
      html += `<div class="cso-empty-st">
        <div class="cso-empty-ico"><i class="fas fa-camera"></i></div>
        <div class="cso-empty-ttl">Aucun relevé enregistré</div>
        <div class="cso-empty-sub">Prenez votre premier relevé pour commencer le suivi.</div>
      </div>`;
    } else {
      let lastDate = null;
      _readings.forEach(r => {
        const d    = _tsDate(r.createdAt);
        const ds   = r.date || (d ? d.toISOString().slice(0, 10) : '');
        const time = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
        if (ds !== lastDate) { html += `<div class="cso-date-sep">${_dateLbl(ds)}</div>`; lastDate = ds; }
        const m    = _meters.find(x => x.id === r.meterId);
        const meta = MT[m?.type || 'eau_froide'] || MT.eau_froide;
        const unit = m?.unit || meta.unit;
        const tsMs = _tsMs(r.createdAt);
        const hasPhoto = r.photoB64 && (tsMs + exp7 > nowMs);
        html += `<div class="cso-rrow">
          <div class="cso-rico" style="background:${meta.dim};color:${meta.color}">${meta.icon}</div>
          <div class="cso-rinfo">
            <div class="cso-rname">${esc(r.meterName || '?')}</div>
            <div class="cso-rmeta">
              <span>${time}</span>
              <span>Index: <b>${_fmtIdx(r.index)} ${esc(unit)}</b></span>
              ${r.consumption != null ? `<span>+${_fmtIdx(r.consumption)} ${esc(unit)}</span>` : ''}
              <span>${esc(r.technicienName || '')}</span>
            </div>
          </div>
          <div class="cso-rbtns">
            ${hasPhoto ? `<button class="cso-ibtn" title="Photo" onclick="MX.Pages.Conso._showPhoto('${r.id}')"><i class="fas fa-image"></i></button>` : ''}
            <button class="cso-ibtn" title="Modifier l'index" onclick="MX.Pages.Conso._editReading('${r.id}')"><i class="fas fa-pen"></i></button>
            <button class="cso-ibtn red" title="Supprimer" onclick="MX.Pages.Conso._delReading('${r.id}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
      });
    }
    return html + '</div>';
  }

  // ── TAB: ANALYSES — Dashboard supervision énergétique V2 ──
  function _tAnalyses() {
    const per  = window._csoPer || '30';
    const days = parseInt(per);
    const today = _today();
    const dates = Array.from({length: days}, (_, i) => _daysAgo(days - 1 - i));
    // Complète en tâche de fond (si besoin) l'historique nécessaire à cette
    // période : la comparaison "vs période précédente" remonte jusqu'à
    // days*2 jours, et la moyenne de référence jusqu'à 30 jours — le plus
    // ancien des deux fixe la date à garantir. Ne bloque pas le rendu : si
    // des données manquent, la page s'affiche avec ce qui est déjà en
    // mémoire puis se met à jour seule (_rerender) une fois la requête
    // complémentaire terminée — même comportement que les listeners live.
    _ensureReadingsFrom(_daysAgo(Math.max(days * 2 - 1, 29)));
    _ensureClientsFrom(_daysAgo(Math.max(days * 2 - 1, 29)));
    const ratioZone = window._csoRatioZone || 'all';
    const zones   = [...new Set(_meters.map(m => m.zone).filter(Boolean))].sort();
    const fMeters = ratioZone === 'all' ? _meters : _meters.filter(m => (m.zone || '') === ratioZone);

    window._anToggle = function(type) {
      if (_anHiddenTypes.has(type)) _anHiddenTypes.delete(type);
      else _anHiddenTypes.add(type);
      MX.Pages.Conso._tab('analyses');
    };

    // ── Per-type data ──
    const typeData = {};
    Object.entries(MT).forEach(([type, meta]) => {
      const ids  = fMeters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return;
      const unit = fMeters.find(m => m.type === type)?.unit || meta.unit;
      const daily = dates.map(ds => sumConsumption(_readings, ids, ds));
      const total = daily.reduce((a, b) => a + b, 0);
      const prevDates = Array.from({length: days}, (_, i) => _daysAgo(days * 2 - 1 - i));
      const prevTotal = prevDates.reduce((s, ds) => s + sumConsumption(_readings, ids, ds), 0);
      const { pct: evoPct } = comparePeriods(total, prevTotal);
      const todayVal = sumConsumption(_readings, ids, today);
      const avg30Arr = Array.from({length: 30}, (_, i) => _daysAgo(30 - 1 - i))
        .map(ds => sumConsumption(_readings, ids, ds))
        .filter(v => v > 0);
      const avg30Val   = average(avg30Arr);
      const { pct: todayEcart } = trendFromDeviation(todayVal, avg30Val);
      const lvl = statusFromDeviation(todayEcart);
      const nonZero = daily.filter(v => v > 0);
      const { min: minV, max: maxV } = minMax(daily);
      const avgV = average(nonZero);
      const sorted = [...nonZero].sort((a,b)=>a-b);
      const medV = sorted.length ? (sorted.length%2===0?(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2:sorted[Math.floor(sorted.length/2)]) : 0;
      const stdV = nonZero.length>1 ? Math.sqrt(nonZero.reduce((s,v)=>s+(v-avgV)**2,0)/nonZero.length) : 0;
      // Forecast = avg daily * days in month
      const last7 = daily.slice(-7).filter(v=>v>0);
      const dailyAvg7 = last7.length ? average(last7) : avgV;
      const todayDt = new Date(today);
      const daysInMonth = new Date(todayDt.getFullYear(), todayDt.getMonth()+1, 0).getDate();
      const forecastTotal = dailyAvg7 * daysInMonth;
      const dailyRatios = dates.map((ds,i) => computeRatio(type, daily[i], _clients[ds] || 0))
        .filter(v => v !== null);
      const avgRatio = average(dailyRatios);
      typeData[type] = {
        meta, unit, daily, total, prevTotal, evoPct, todayVal, avg30Val,
        todayEcart, lvl, avgRatio, rUnit: _isLiterRatioType(type) ? 'L/client' : `${unit}/client`,
        spark: daily.slice(-14), minV, maxV, avgV, medV, stdV, forecastTotal, dailyAvg7
      };
    });

    const perBtns = ['7','30','90','365'].map(p => {
      const lbl = {7:'7J',30:'30J',90:'3M',365:'1A'}[p];
      return `<button class="an2-rb${per===p?' an2-rb--act':''}" onclick="window._csoPer='${p}';MX.Pages.Conso._tab('analyses')">${lbl}</button>`;
    }).join('');

    if (!Object.keys(typeData).length) {
      return `<div class="cso-inner"><div class="an2-toolbar"><div class="an2-rb-group">${perBtns}</div></div>
        <div class="cso-empty-state"><i class="fas fa-chart-bar" style="font-size:32px;opacity:.2"></i>
        <p style="color:var(--text-3);margin-top:10px">Aucun compteur dans cette zone</p></div></div>`;
    }

    const score = _calcScore();
    const grade = score>=95?'A+':score>=85?'A':score>=70?'B':score>=50?'C':'D';
    const gradeColor = score>=85?'#34d399':score>=70?'#f59e0b':score>=50?'#fb923c':'#f87171';
    const smartAlerts = _detectAlerts();
    const critCount = smartAlerts.filter(a=>a.level==='critical').length;
    const warnCount = smartAlerts.filter(a=>a.level==='warning').length;

    // Zone selector
    const zoneSelect = zones.length>1 ? `<select class="an2-zone-sel" onchange="window._csoRatioZone=this.value;MX.Pages.Conso._tab('analyses')">
      <option value="all"${ratioZone==='all'?' selected':''}>Toutes les zones</option>
      ${zones.map(z=>`<option value="${esc(z)}"${ratioZone===z?' selected':''}>${esc(z)}</option>`).join('')}
    </select>` : '';

    // ── KPI Cards ──
    const kpiTypes = ['eau_froide','eau_chaude','chauffage','electricite'];
    const stCol = {crit:'#f87171',warn:'#f59e0b',ok:'#34d399',na:'#475569'};
    const stLbl = {crit:'Dérive',warn:'Attention',ok:'Normal',na:'—'};
    const kpiHtml = kpiTypes.map(type => {
      const d = typeData[type]; if (!d) return '';
      const { meta, unit, evoPct, todayVal, avg30Val, todayEcart, lvl, spark } = d;
      const evoColor = evoPct===null?'#64748b':evoPct>5?'#f87171':evoPct<-5?'#34d399':'#64748b';
      const evoIcon  = evoPct===null?'fa-minus':evoPct>5?'fa-arrow-trend-up':evoPct<-5?'fa-arrow-trend-down':'fa-minus';
      return `<div class="an2-kpi" style="--kc:${meta.color}">
        <div class="an2-kpi-hd">
          <span class="an2-kpi-ico">${meta.icon}</span>
          <span class="an2-kpi-lbl">${esc(meta.label)}</span>
          <span class="an2-kpi-status" style="color:${stCol[lvl]}">● ${stLbl[lvl]}</span>
        </div>
        <div class="an2-kpi-val">${_fmt(todayVal,todayVal>=100?0:1)}<span class="an2-kpi-u"> ${esc(unit)}</span></div>
        <div class="an2-kpi-meta">
          <span>Moy.30J ${_fmt(avg30Val,avg30Val>=100?1:2)} ${esc(unit)}</span>
          ${todayEcart!==null?`<span style="color:${evoColor}"><i class="fas ${evoIcon}"></i> ${todayEcart>0?'+':''}${_fmt(todayEcart,0)}%</span>`:''}
        </div>
        <div class="an2-kpi-spark">${_sparkSVG(spark, meta.color, 100, 28)}</div>
      </div>`;
    }).filter(Boolean).join('');

    // ── Summary bar ──
    const summaryHtml = kpiTypes.map(type => {
      const d = typeData[type]; if (!d) return '';
      const { meta, todayVal, avg30Val, todayEcart, lvl, unit } = d;
      const ecartStr = todayEcart!==null?`${todayEcart>0?'+':''}${_fmt(todayEcart,0)}% vs moy. 30j`:'';
      const msgMap = {
        ok:   `${meta.label} : ${_fmt(todayVal,todayVal>=100?0:1)} ${unit} (${ecartStr}). Consommation normale.`,
        warn: `${meta.label} : ${_fmt(todayVal,todayVal>=100?0:1)} ${unit} (${ecartStr}). Vérifier si le relevé est correct ou si l'installation est à l'arrêt.`,
        crit: `${meta.label} : ${_fmt(todayVal,todayVal>=100?0:1)} ${unit} (${ecartStr}). Surveillance recommandée.`,
        na:   `${meta.label} : Pas de donnée suffisante pour aujourd'hui.`,
      };
      return `<div class="an2-sum-item" style="border-left:2px solid ${stCol[lvl]}">
        <span style="color:${meta.color}">${meta.icon}</span>
        <span class="an2-sum-txt">${esc(msgMap[lvl])}</span>
      </div>`;
    }).filter(Boolean).join('');

    // ── Main chart: visible series (legend-filtered) ──
    const mainSeries = Object.entries(typeData)
      .filter(([t,d]) => !_anHiddenTypes.has(t) && d.daily.some(v=>v>0))
      .map(([t,d]) => ({ type:t, icon:d.meta.icon, label:d.meta.label, color:d.meta.color, unit:d.unit, vals:d.daily, avg30:d.avg30Val }));

    const legendHtml = Object.entries(typeData)
      .filter(([,d]) => d.daily.some(v=>v>0))
      .map(([type,d]) => {
        const off = _anHiddenTypes.has(type);
        return `<label class="an2-ck${off?' an2-ck--off':''}">
          <input type="checkbox" ${off?'':'checked'} onchange="window._anToggle('${type}')">
          <span class="an2-ck-dot" style="background:${off?'transparent':d.meta.color};border-color:${d.meta.color}"></span>
          <span>${esc(d.meta.label)}</span>
        </label>`;
      }).join('');

    const mainChartSVG = _anMainSVG(mainSeries, dates, _clients);

    // Main chart stats
    const allVals = mainSeries.flatMap(s=>s.vals.filter(v=>v>0));
    const stMin = allVals.length?Math.min(...allVals):0;
    const stMax = allVals.length?Math.max(...allVals):0;
    const stAvg = allVals.length?allVals.reduce((a,b)=>a+b,0)/allVals.length:0;
    const stS = [...allVals].sort((a,b)=>a-b);
    const stMed = stS.length?(stS.length%2===0?(stS[stS.length/2-1]+stS[stS.length/2])/2:stS[Math.floor(stS.length/2)]):0;
    const stStd = allVals.length>1?Math.sqrt(allVals.reduce((s,v)=>s+(v-stAvg)**2,0)/allVals.length):0;
    const stTot = mainSeries.reduce((s,sr)=>s+sr.vals.reduce((a,b)=>a+b,0),0);

    // ── Alert panel (right sidebar) ──
    const savedAlerts = _csoAlerts.filter(a=>!a.acknowledged&&a.status!=='resolved'&&(a.level==='critical'||a.level==='warning'));
    const allAlerts   = [...smartAlerts,...savedAlerts.slice(0,4)];
    const alertPanelHtml = allAlerts.slice(0,8).map(a => {
      const mt = MT[a.metric||a.type||''] || {};
      const isCrit = a.level==='critical';
      const lc = isCrit?'#f87171':'#f59e0b';
      const zone = a.zone?`<span class="an2-ap-zone">${esc(a.zone)}</span>`:'';
      const ecart = a.ecart?`<span class="an2-ap-ecart" style="color:${lc}">+${a.ecart}%</span>`:'';
      return `<div class="an2-ap-row">
        <span class="an2-ap-dot" style="background:${lc}"></span>
        <div class="an2-ap-body">
          <span class="an2-ap-ico">${mt.icon||'⚠️'}</span>
          <span class="an2-ap-lbl">${esc(mt.label||a.type||'Anomalie')}</span>${zone}
        </div>
        <div class="an2-ap-right">${ecart}
          <span class="an2-ap-badge" style="background:${lc}20;color:${lc};border:1px solid ${lc}50">${isCrit?'Critique':'Attention'}</span>
        </div>
      </div>`;
    }).join('') || '<div class="an2-ap-empty"><i class="fas fa-check-circle" style="color:#34d399"></i> Aucune anomalie</div>';

    // ── Comparison bars (today vs avg) ──
    const cmpHtml = Object.entries(typeData)
      .filter(([,d])=>d.avg30Val>0||d.todayVal>0)
      .map(([,d]) => {
        const mx = Math.max(d.todayVal,d.avg30Val,0.001);
        const tw = (d.todayVal/mx*100).toFixed(1), aw = (d.avg30Val/mx*100).toFixed(1);
        const pct = d.avg30Val>0?(d.todayVal-d.avg30Val)/d.avg30Val*100:null;
        const dc = pct===null?'#64748b':pct>10?'#f87171':pct<-10?'#34d399':'#94a3b8';
        const dt = pct!==null?`${pct>0?'↑ +':'↓ '}${_fmt(pct,0)}%`:'—';
        return `<div class="an2-cmp-row">
          <div class="an2-cmp-lbl">${d.meta.icon} ${esc(d.meta.label)}</div>
          <div class="an2-cmp-bars">
            <div class="an2-cmp-bar-row"><span class="an2-cmp-bar-tag">Auj.</span>
              <div class="an2-cmp-track"><div class="an2-cmp-fill" style="width:${tw}%;background:${d.meta.color}"></div></div>
              <span class="an2-cmp-v">${_fmt(d.todayVal,d.todayVal>=100?0:1)} ${esc(d.unit)}</span>
            </div>
            <div class="an2-cmp-bar-row"><span class="an2-cmp-bar-tag">30J</span>
              <div class="an2-cmp-track"><div class="an2-cmp-fill" style="width:${aw}%;background:${d.meta.color};opacity:0.32"></div></div>
              <span class="an2-cmp-v" style="color:var(--text-3)">${_fmt(d.avg30Val,d.avg30Val>=100?0:1)} ${esc(d.unit)}</span>
            </div>
          </div>
          <div class="an2-cmp-delta" style="color:${dc}">${dt}</div>
        </div>`;
      }).join('');

    // ── Donut ──
    const donutItems = Object.entries(typeData).filter(([,d])=>d.total>0)
      .map(([,d])=>({label:d.meta.label,color:d.meta.color,val:d.total,unit:d.unit}));
    const donutTotal = donutItems.reduce((s,it)=>s+it.val,0)||1;
    const donutLeg = donutItems.map(it => {
      const pct = (it.val/donutTotal*100).toFixed(1);
      return `<div class="an2-dl-row">
        <span class="an2-dl-dot" style="background:${it.color}"></span>
        <span class="an2-dl-lbl">${esc(it.label)}</span>
        <span class="an2-dl-pct">${pct}%</span>
        <span class="an2-dl-v">${_fmt(it.val,it.val>=100?0:1)} ${esc(it.unit)}</span>
      </div>`;
    }).join('');

    // ── Weekly chart ──
    const nW = Math.min(Math.ceil(days/7), 8);
    const wkLabels = Array.from({length:nW}, (_,i)=>`S.${i+1}`);
    const wkSeries = Object.entries(typeData)
      .filter(([,d])=>d.daily.some(v=>v>0))
      .map(([,d]) => {
        const rawVals = Array.from({length:nW},(_,wi) => {
          const si = days-(nW-wi)*7;
          return d.daily.slice(Math.max(0,si), Math.max(0,si+7)).reduce((a,b)=>a+b,0);
        });
        const mx = Math.max(...rawVals,0.001);
        return { color:d.meta.color, label:d.meta.label, rawVals, vals:rawVals.map(v=>v/mx*100) };
      });
    const curWk = wkSeries.reduce((s,sr)=>s+(sr.rawVals[sr.rawVals.length-1]||0),0);
    const prevWk = wkSeries.reduce((s,sr)=>s+(sr.rawVals[sr.rawVals.length-2]||0),0);
    const wkEvo = prevWk>0?(curWk-prevWk)/prevWk*100:null;
    const wkPrevFc = wkSeries.reduce((s,sr)=>s+(sr.rawVals[sr.rawVals.length-1]||0),0)*4;

    // ── Heatmap ──
    const hmTypes = ['eau_froide','eau_chaude','electricite','chauffage'].filter(t=>typeData[t]&&typeData[t].daily.some(v=>v>0));
    const hmDays  = Math.min(30, days);
    const hmDates = Array.from({length:hmDays},(_,i)=>_daysAgo(hmDays-1-i));
    const hmCells = [];
    hmTypes.forEach((type,ri) => {
      const d=typeData[type];
      hmDates.forEach((ds,ci) => {
        const v=d.daily[days-hmDays+ci]||0, rel=d.avg30Val>0?v/d.avg30Val:0;
        const lv=!v?'none':rel>1.5?'crit':rel>1.1?'warn':'ok';
        hmCells.push({row:ri,col:ci,level:lv,val:Math.min(rel,2)/2});
      });
    });
    const hmRowLabels = hmTypes.map(t=>typeData[t].meta.icon);
    const hmColLabels = hmDates.map((ds,i)=>(i%5===0||i===hmDays-1)?ds.split('-')[2]:'');

    // ── Alert history table ──
    const histAlerts = [..._csoAlerts].sort((a,b)=>_tsMs(b.ts)-_tsMs(a.ts)).slice(0,12);
    const histHtml = histAlerts.length ? histAlerts.map(a => {
      const mt = MT[a.type||a.metric||'']||{};
      const m  = _meters.find(me=>me.id===(a.meterId||''));
      const isCrit=a.level==='critical', isSurv=a.level==='surveillance';
      const lc=isCrit?'#f87171':isSurv?'#3B82F6':'#f59e0b';
      const ll=isCrit?'Critique':isSurv?'Surveillance':'Attention';
      const ts=_tsDate(a.ts);
      const dStr=ts?ts.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'';
      const tStr=ts?ts.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'';
      const ec=a.ecart!=null?`${a.ecart>0?'+':''}${_fmt(a.ecart,0)}%`:'—';
      return `<tr class="an2-hist-row">
        <td><b>${tStr}</b><br><span style="color:var(--text-3);font-size:10px">${dStr}</span></td>
        <td>${mt.icon||'⚠️'} ${esc(mt.label||a.type||'—')}</td>
        <td class="an2-hist-zone">${esc(m?.zone||a.zone||'—')}</td>
        <td style="color:${a.ecart>0?'#f87171':'#34d399'};font-weight:600">${ec}</td>
        <td>${esc(a.alertType||a.type||'Dérive')}</td>
        <td><span class="an2-hist-badge" style="background:${lc}20;color:${lc};border:1px solid ${lc}50">${ll}</span></td>
        <td style="color:var(--text-3)">${esc(a.acknowledged?'Résolu':a.action||'—')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="an2-hist-empty">Aucune alerte enregistrée</td></tr>`;

    // ── Forecast widgets ──
    const forecastHtml = kpiTypes.filter(t=>typeData[t]).map(t => {
      const d=typeData[t];
      const todayDt = new Date(today);
      const daysInMonth = new Date(todayDt.getFullYear(),todayDt.getMonth()+1,0).getDate();
      const expected = d.avg30Val*daysInMonth;
      const pct = expected>0?(d.forecastTotal-expected)/expected*100:null;
      const col = pct===null?'#64748b':pct>10?'#f87171':pct<-10?'#34d399':'#f59e0b';
      return `<div class="an2-fc-item" style="border-left:2px solid ${d.meta.color}">
        <span>${d.meta.icon}</span>
        <div class="an2-fc-body">
          <div class="an2-fc-lbl">${esc(d.meta.label)}</div>
          <div class="an2-fc-val">${_fmt(d.forecastTotal,d.forecastTotal>=100?0:1)} <span class="an2-fc-u">${esc(d.unit)}</span></div>
          ${pct!==null?`<div style="color:${col};font-size:10px">${pct>0?'+':''}${_fmt(pct,0)}% vs attendu</div>`:''}
        </div>
      </div>`;
    }).join('');

    // ── Right column cards ──
    const scoreLblCompact = score>=95?'Excellent':score>=85?'Très bon':score>=70?'Bon':score>=50?'Moyen':'Critique';

    // Top 5 meters by period consumption
    const _rcTop5Raw = _meters.map(m => {
      const total = dates.reduce((s,ds) =>
        s + _readings.filter(r=>r.meterId===m.id&&r.date===ds).reduce((a,r)=>a+(r.consumption||0),0), 0);
      return {name:m.name||m.id, type:m.type, total, unit:m.unit||((MT[m.type]||{}).unit||'')};
    }).filter(m=>m.total>0).sort((a,b)=>b.total-a.total).slice(0,5);
    const _rcTop5Max = _rcTop5Raw.length ? _rcTop5Raw[0].total : 1;
    const rcTop5Html = _rcTop5Raw.length ? _rcTop5Raw.map((m,i) => {
      const mt = MT[m.type]||{};
      const pct = (m.total/_rcTop5Max*100).toFixed(1);
      return `<div class="an2-rc-top-row">
        <span class="an2-rc-rank">${i+1}</span>
        <div class="an2-rc-top-body">
          <div class="an2-rc-top-nm">${mt.icon||''} ${esc(m.name)}</div>
          <div class="an2-rc-top-bar-wrap"><div class="an2-rc-top-bar" style="width:${pct}%;background:${mt.color||'var(--accent)'}"></div></div>
        </div>
        <span class="an2-rc-top-v">${_fmt(m.total,m.total>=100?0:1)} ${esc(m.unit)}</span>
      </div>`;
    }).join('') : '<div class="an2-rc-empty">Aucune donnée</div>';

    // Meters in anomaly today vs 30-day average
    const _rcAnomRaw = _meters.map(m => {
      const todayV = _readings.filter(r=>r.meterId===m.id&&r.date===today).reduce((s,r)=>s+(r.consumption||0),0);
      const a30 = Array.from({length:30},(_,i)=>_daysAgo(30-1-i))
        .map(ds=>_readings.filter(r=>r.meterId===m.id&&r.date===ds).reduce((s,r)=>s+(r.consumption||0),0))
        .filter(v=>v>0);
      const avg30 = a30.length ? a30.reduce((a,b)=>a+b,0)/a30.length : 0;
      const ecart = avg30>0 ? (todayV-avg30)/avg30*100 : null;
      return {name:m.name||m.id, type:m.type, todayV, ecart, unit:m.unit||((MT[m.type]||{}).unit||'')};
    }).filter(m=>m.ecart!==null&&Math.abs(m.ecart)>20&&m.todayV>0)
      .sort((a,b)=>Math.abs(b.ecart)-Math.abs(a.ecart)).slice(0,5);
    const rcAnomHtml = _rcAnomRaw.length ? _rcAnomRaw.map(m => {
      const mt = MT[m.type]||{};
      const col = m.ecart>50?'#f87171':m.ecart>20?'#f59e0b':'#34d399';
      return `<div class="an2-rc-anom-row">
        <span class="an2-rc-anom-ico">${mt.icon||'⚠️'}</span>
        <div class="an2-rc-anom-body">
          <div class="an2-rc-anom-nm">${esc(m.name)}</div>
          <div class="an2-rc-anom-sub">${_fmt(m.todayV,1)} ${esc(m.unit)}</div>
        </div>
        <span class="an2-rc-anom-ecart" style="color:${col}">${m.ecart>0?'+':''}${_fmt(m.ecart,0)}%</span>
      </div>`;
    }).join('') : '<div class="an2-rc-empty"><i class="fas fa-check-circle" style="color:#34d399"></i> Aucune anomalie</div>';

    // Last 6 readings sorted by createdAt
    const _rcRecentRaw = [..._readings].sort((a,b) => {
      const ta = a.createdAt&&a.createdAt.toMillis ? a.createdAt.toMillis() : _tsMs(a.createdAt);
      const tb = b.createdAt&&b.createdAt.toMillis ? b.createdAt.toMillis() : _tsMs(b.createdAt);
      return tb-ta;
    }).slice(0,6);
    const rcRecentHtml = _rcRecentRaw.length ? _rcRecentRaw.map(r => {
      const m = _meters.find(me=>me.id===r.meterId);
      const mt = MT[m?.type||'']||{};
      const unit = m?.unit||mt.unit||'';
      const d = _tsDate(r.createdAt);
      const tStr = d ? d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '';
      const dStr = d ? d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : (r.date||'');
      return `<div class="an2-rc-rel-row">
        <span class="an2-rc-rel-ico" style="color:${mt.color||'var(--text3)'}">${mt.icon||'📊'}</span>
        <div class="an2-rc-rel-body">
          <div class="an2-rc-rel-nm">${esc(m?.name||r.meterName||'—')}</div>
          <div class="an2-rc-rel-meta">${dStr} ${tStr}</div>
        </div>
        <span class="an2-rc-rel-v">${r.index!=null?_fmtIdx(r.index):'—'} ${esc(unit)}</span>
      </div>`;
    }).join('') : '<div class="an2-rc-empty">Aucun relevé</div>';

    // Today evolution per type (compact progress bars)
    const rcEvoHtml = Object.entries(typeData).filter(([,d])=>d.avg30Val>0||d.todayVal>0).map(([,d]) => {
      const pct = d.avg30Val>0 ? Math.min(130,d.todayVal/d.avg30Val*100).toFixed(0) : (d.todayVal>0?50:0);
      const col = d.avg30Val<=0?'#64748b':d.todayVal>d.avg30Val*1.1?'#f87171':d.todayVal<d.avg30Val*0.9?'#34d399':'#64748b';
      return `<div class="an2-rc-evo-row">
        <span class="an2-rc-evo-ico">${d.meta.icon}</span>
        <div class="an2-rc-evo-track"><div class="an2-rc-evo-fill" style="width:${Math.min(100,pct)}%;background:${d.meta.color}"></div></div>
        <span class="an2-rc-evo-val" style="color:${col}">${_fmt(d.todayVal,d.todayVal>=100?0:1)} ${esc(d.unit)}</span>
      </div>`;
    }).join('') || '<div class="an2-rc-empty">Pas de données</div>';

    return `<div class="cso-inner an2-page">
      <!-- Toolbar -->
      <div class="an2-toolbar">
        <span class="an2-toolbar-ttl"><i class="fas fa-chart-line"></i> Analyses énergétiques</span>
        <div class="an2-rb-group">${perBtns}</div>
        ${zoneSelect?`<div class="an2-zone-wrap"><i class="fas fa-filter"></i>${zoneSelect}</div>`:''}
      </div>

      <!-- KPI row + Score gauge -->
      <div class="an2-kpi-row">
        ${kpiHtml}
        <div class="an2-score-widget">
          <div class="an2-score-lbl">Score énergétique</div>
          ${_anScoreGauge(score, grade, gradeColor)}
        </div>
      </div>

      <!-- Summary bar -->
      <div class="an2-summary-bar">${summaryHtml}</div>

      <!-- Main row: chart (70%) + right column dashboard (30%) -->
      <div class="an2-main-row">
        <div class="an2-chart-panel">
          <div class="an2-chart-hdr">
            <span class="an2-chart-ttl"><i class="fas fa-chart-line"></i> Évolution des consommations</span>
            <div class="an2-ck-group">${legendHtml}</div>
            <div class="an2-chart-acts">
              ${critCount?`<span class="an2-bdg an2-bdg--crit">${critCount} crit.</span>`:''}
              ${warnCount?`<span class="an2-bdg an2-bdg--warn">${warnCount} att.</span>`:''}
            </div>
          </div>
          <div class="an2-chart-wrap" id="an2-chart-wrap">
            ${mainChartSVG}
            <div class="an2-tooltip" id="an2-tooltip" style="display:none"></div>
          </div>
          <div class="an2-chart-stats">
            <span><b>Min</b> ${_fmt(stMin,stMin>=100?0:1)}</span>
            <span><b>Max</b> ${_fmt(stMax,stMax>=100?0:1)}</span>
            <span><b>Moy.</b> ${_fmt(stAvg,stAvg>=100?1:2)}</span>
            <span><b>Méd.</b> ${_fmt(stMed,stMed>=100?1:2)}</span>
            <span><b>Total</b> ${_fmt(stTot,stTot>=1000?0:1)}</span>
            <span><b>σ</b> ${_fmt(stStd,stStd>=100?1:2)}</span>
            <span class="an2-stats-sub">% du max · — moy.mobile 7j · <span style="color:#f87171">●</span> dépassement</span>
          </div>
        </div>

        <!-- Right column: 6 compact dashboard cards -->
        <div class="an2-right-col">
          <div class="an2-rc-card">
            <div class="an2-rc-hdr"><i class="fas fa-star"></i> Score énergétique</div>
            <div class="an2-rc-score-row">
              <div class="an2-rc-score-num" style="color:${gradeColor}">${score}<span class="an2-rc-score-max">/100</span></div>
              <div class="an2-rc-score-right">
                <div class="an2-rc-score-bar-wrap"><div class="an2-rc-score-bar" style="width:${score}%;background:${gradeColor}"></div></div>
                <div class="an2-rc-score-lbl">${scoreLblCompact} · <b style="font-size:13px;color:${gradeColor}">${grade}</b></div>
              </div>
            </div>
          </div>
          <div class="an2-rc-card">
            <div class="an2-rc-hdr">
              <span><i class="fas fa-triangle-exclamation"></i> Alertes${allAlerts.length?` (${allAlerts.length})`:''}</span>
              <a class="an2-ap-link" onclick="MX.Pages.Conso._tab('alertes')">Tout voir</a>
            </div>
            <div class="an2-rc-alerts">${alertPanelHtml}</div>
          </div>
          <div class="an2-rc-card">
            <div class="an2-rc-hdr"><i class="fas fa-chart-bar"></i> Évolution aujourd'hui</div>
            <div class="an2-rc-evo-list">${rcEvoHtml}</div>
          </div>
          <div class="an2-rc-card">
            <div class="an2-rc-hdr"><i class="fas fa-ranking-star"></i> Top 5 compteurs (${per}J)</div>
            <div class="an2-rc-top5">${rcTop5Html}</div>
          </div>
          <div class="an2-rc-card">
            <div class="an2-rc-hdr"><i class="fas fa-circle-exclamation"></i> Compteurs en anomalie</div>
            <div class="an2-rc-anom-list">${rcAnomHtml}</div>
          </div>
          <div class="an2-rc-card">
            <div class="an2-rc-hdr"><i class="fas fa-clock-rotate-left"></i> Derniers relevés</div>
            <div class="an2-rc-rel-list">${rcRecentHtml}</div>
          </div>
        </div>
      </div>

      <!-- Row 3: comparison + donut + weekly -->
      <div class="an2-row3">
        <div class="an2-card">
          <div class="an2-card-hdr"><i class="fas fa-chart-bar"></i> Aujourd'hui vs moy. 30 jours</div>
          <div class="an2-cmp-list">${cmpHtml}</div>
        </div>
        <div class="an2-card">
          <div class="an2-card-hdr"><i class="fas fa-circle-half-stroke"></i> Répartition par énergie</div>
          <div class="an2-donut-wrap">
            ${donutItems.length>=2?_donutSVG(donutItems,108):'<div class="an2-empty">Données insuffisantes</div>'}
            <div class="an2-donut-leg">${donutLeg}</div>
          </div>
        </div>
        <div class="an2-card">
          <div class="an2-card-hdr"><i class="fas fa-chart-area"></i> Évolution hebdomadaire
            ${wkEvo!==null?`<span class="an2-wk-evo" style="color:${wkEvo>5?'#f87171':wkEvo<-5?'#34d399':'#f59e0b'}">${wkEvo>0?'+':''}${_fmt(wkEvo,0)}% vs S.préc.</span>`:''}
          </div>
          ${_areaLineSVG(wkSeries, wkLabels, 110)}
          <div class="an2-wk-stats">
            <div class="an2-wk-stat"><span class="an2-wk-lbl">Cette semaine</span><span class="an2-wk-val">${_fmt(curWk,curWk>=1000?0:1)}</span></div>
            <div class="an2-wk-stat"><span class="an2-wk-lbl">Moy. 30J</span><span class="an2-wk-val">${_fmt(prevWk,prevWk>=1000?0:1)}</span></div>
            <div class="an2-wk-stat"><span class="an2-wk-lbl">Préd. fin mois</span><span class="an2-wk-val" style="color:#f59e0b">${_fmt(wkPrevFc,wkPrevFc>=1000?0:1)}</span><span class="an2-wk-lbl"> (+${_fmt(wkSeries.reduce((s,sr)=>s+(sr.rawVals[sr.rawVals.length-1]||0),0)/Math.max(prevWk,0.001)*100-100,0)}%)</span></div>
          </div>
        </div>
      </div>

      <!-- Row 4: heatmap + alert history -->
      <div class="an2-row4">
        ${hmTypes.length?`<div class="an2-card">
          <div class="an2-card-hdr"><i class="fas fa-th"></i> Carte thermique (30 derniers jours)
            <span class="an2-hm-leg"><span style="color:#34d399">●</span> Normal <span style="color:#f59e0b">●</span> +10% <span style="color:#f87171">●</span> +50%</span>
          </div>
          ${_heatmapSVG(hmCells,hmRowLabels,hmColLabels,hmTypes.length,hmDays,22)}
        </div>`:''}
        <div class="an2-card an2-card--hist">
          <div class="an2-card-hdr"><i class="fas fa-list-check"></i> Historique des alertes
            <a class="an2-ap-link" onclick="MX.Pages.Conso._tab('alertes')">Voir tout</a>
          </div>
          <div class="an2-hist-wrap">
            <table class="an2-hist-tbl">
              <thead><tr><th>Heure</th><th>Compteur</th><th>Zone</th><th>Variation</th><th>Type</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>${histHtml}</tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Forecast row -->
      ${forecastHtml?`<div class="an2-card an2-card--fc">
        <div class="an2-card-hdr"><i class="fas fa-arrow-trend-up"></i> Prévision fin de mois (extrapolation 7J)</div>
        <div class="an2-fc-grid">${forecastHtml}</div>
      </div>`:''}
    </div>`;
  }

  // ── TAB: SUPERVISION — Salle de contrôle énergétique ──
  const _SUG = {
    eau_froide:  ['Vérifier fuites réseau', 'Contrôler WC & robinets', 'Vérifier arrosage extérieur', 'Contrôler remplissage ballon ECS', 'Inspecter compteur fuyard'],
    eau_chaude:  ['Vérifier production ECS', 'Contrôler vannes 3 voies', 'Vérifier pertes thermiques', 'Contrôler ballon de stockage', 'Vérifier débit circulateur'],
    electricite: ['Vérifier CVC / climatisation', 'Contrôler éclairages laissés allumés', 'Contrôler équipements cuisine', 'Vérifier charge serveurs', 'Contrôler chauffage électrique'],
    chauffage:   ['Vérifier réglages chaufferie', 'Contrôler vannes de régulation', 'Vérifier calorifugeage', 'Contrôler robinets thermostatiques', 'Vérifier compensation météo'],
    gaz:         ['Contrôler brûleurs', 'Vérifier pertes de charge', 'Contrôler débitmètre', 'Vérifier régulation température'],
    default:     ['Vérifier le compteur', 'Contrôler les relevés', 'Analyser les consommations'],
  };


  // ══════════════════════════════════════════════════════════
  // PERFORMANCE ÉNERGÉTIQUE TAB (v1)
  // ══════════════════════════════════════════════════════════
  // ── IA: automated trend analysis text ──
  function _iaAnalysisHtml() {
    const types = ['eau_froide', 'eau_chaude', 'electricite'];
    const analyses = [];
    types.forEach(type => {
      const meta = MT[type];
      const data = [];
      for (let i = 1; i <= 14; i++) {
        const d = _daysAgo(i);
        const ratio = _perfRatio(type, d);
        if (ratio !== null) data.push({ d, ratio, cli: _clients[d] || 0 });
      }
      if (data.length < 4) return;
      const halfN      = Math.min(4, Math.floor(data.length / 2));
      const recentData = data.slice(0, halfN);
      const olderData  = data.slice(halfN);
      if (!olderData.length) return;
      const recentAvg = recentData.reduce((s, x) => s + x.ratio, 0) / recentData.length;
      const olderAvg  = olderData.reduce((s, x) => s + x.ratio, 0)  / olderData.length;
      if (!olderAvg) return;
      const trendPct = (recentAvg - olderAvg) / olderAvg * 100;
      if (Math.abs(trendPct) < 8) return;
      const recentCli = recentData.reduce((s, x) => s + x.cli, 0) / recentData.length;
      const olderCli  = olderData.reduce((s, x) => s + x.cli, 0)  / olderData.length;
      const cliPct    = olderCli > 0 ? (recentCli - olderCli) / olderCli * 100 : 0;
      const clientLinked = Math.sign(cliPct) === Math.sign(trendPct) && Math.abs(cliPct) > 5;
      const dir  = trendPct > 0 ? 'augmente' : 'diminue';
      const absT = Math.abs(trendPct);
      let note = 'Depuis ' + data.length + ' jours, la consommation ' + meta.label.toLowerCase() +
                 ' ' + dir + ' (' + (trendPct > 0 ? '+' : '') + Math.round(trendPct) + '% vs période précédente).';
      let severity = absT > 25 ? 'critique' : 'warn';
      if (type === 'eau_froide' && trendPct > 15 && !clientLinked) {
        note += ' La variation est indépendante du nombre de clients — fuite probable à investiguer.';
        severity = 'critique';
      } else if (clientLinked) {
        note += ' La variation semble liée à l\'activité (nombre de clients).';
        severity = 'info';
      } else if (trendPct < -12) {
        note += ' Amélioration notable des performances.';
        severity = 'info';
      }
      analyses.push({ meta, note, severity });
    });
    if (!analyses.length) {
      return '<div class="pe-ia-row pe-ia--ok"><i class="fas fa-robot" style="color:var(--cyan)"></i>' +
             ' <span>Consommations stables sur les 14 derniers jours — aucune tendance significative détectée.</span></div>';
    }
    return analyses.map(function(a) {
      const col  = a.severity === 'critique' ? '#ef4444' : a.severity === 'warn' ? '#f59e0b' : '#06b6d4';
      const icon = a.severity === 'critique' ? 'fa-circle-exclamation' : a.severity === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info';
      return '<div class="pe-ia-row pe-ia--' + a.severity + '" style="border-left:3px solid ' + col + '">' +
        '<i class="fas ' + icon + '" style="color:' + col + ';flex-shrink:0;margin-top:2px"></i>' +
        '<div class="pe-ia-body">' +
          '<span class="pe-ia-type">' + a.meta.icon + ' ' + a.meta.label + '</span>' +
          '<span class="pe-ia-txt">' + a.note + '</span>' +
        '</div></div>';
    }).join('');
  }

  function _tPerformance() {
    const today    = _today();
    const peDate   = window._peSelDate || today;
    const cli      = _clients[peDate] || 0;
    const e        = MX.esc || (s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
    const c        = _perfC();
    const t        = _perfT();
    const isW      = _isLiterRatioType;

    // ── Comparison dates ──
    const d_hier   = _daysAgo(peDate === today ? 1 : Math.ceil((new Date(today)-new Date(peDate))/86400000)+1);

    // ── A. Sélecteur de période (comparaison réellement comparable) ──
    // Ancré sur peDate (le jour navigable existant, _peDatePrev/_peDateNext)
    // plutôt que sur "aujourd'hui" : Performance permet d'investiguer une
    // date passée, la comparaison de période doit suivre la même ancre.
    // Construit uniquement avec MX.CsoCalc.periodDates('custom', ...) —
    // aucune énumération de dates recréée à la main.
    function _daysBefore(dateStr, n) {
      const d = new Date(dateStr + 'T12:00:00');
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    }
    const compPeriod = window._peCompPeriod || 'day';
    let cDates, cPrevDates, cPeriodLbl, cPartialNote = '';
    if (compPeriod === 'week') {
      cDates     = periodDates('custom', { start: _daysBefore(peDate, 6), end: peDate });
      cPrevDates = periodDates('custom', { start: _daysBefore(peDate, 13), end: _daysBefore(peDate, 7) });
      cPeriodLbl = `7 jours · ${_dateLbl(cDates[0])} → ${_dateLbl(peDate)}`;
    } else if (compPeriod === 'month-current') {
      const peD = new Date(peDate + 'T12:00:00');
      const monthStart = new Date(peD.getFullYear(), peD.getMonth(), 1).toISOString().slice(0, 10);
      cDates = periodDates('custom', { start: monthStart, end: peDate });
      const prevStart = new Date(peD.getFullYear(), peD.getMonth() - 1, 1);
      const prevEnd   = new Date(prevStart); prevEnd.setDate(prevEnd.getDate() + cDates.length - 1);
      cPrevDates = periodDates('custom', { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) });
      cPeriodLbl = `Mois en cours · ${_dateLbl(cDates[0])} → ${_dateLbl(peDate)}`;
      cPartialNote = `Comparé aux ${cDates.length} premier${cDates.length > 1 ? 's' : ''} jour${cDates.length > 1 ? 's' : ''} du mois précédent (mois non terminé)`;
    } else {
      cDates     = [peDate];
      cPrevDates = [d_hier];
      cPeriodLbl = peDate === today ? "Aujourd'hui" : _dateLbl(peDate);
    }
    const cDatesSet = new Set(cDates);

    // Le tableau historique va jusqu'à 90 jours, la navigation par jour
    // (_peDatePrev) peut remonter arbitrairement loin, et la comparaison de
    // période ci-dessus peut demander plus loin encore (mois précédent) :
    // on garantit le chargement du plus ancien des trois besoins. Non
    // bloquant (voir commentaire équivalent dans _tAnalyses).
    const perfMinDate = [peDate, cDates[0], cPrevDates[0], _daysAgo(89)].reduce((m, d) => (!m || d < m) ? d : m, null);
    _ensureReadingsFrom(perfMinDate);
    _ensureClientsFrom(perfMinDate);

    // ── Grade badge HTML ──
    function gradeBadge(key) {
      if (!key || key === 'na') return '<span class="pe-grade pe-grade--na">—</span>';
      const g = c[key] || {};
      return `<span class="pe-grade" style="background:${g.color}20;color:${g.color};border:1px solid ${g.color}50">${g.l || key}</span>`;
    }

    // ── Global performance score ──
    const perfScore = _calcPerfScore(peDate);
    const scoreStr  = perfScore !== null ? String(perfScore) : '—';
    const scoreGrade = perfScore === null ? 'na'
      : perfScore >= 90 ? 'excellent'
      : perfScore >= 75 ? 'bon'
      : perfScore >= 60 ? 'correct'
      : perfScore >= 45 ? 'moyen'
      : perfScore >= 30 ? 'mauvais' : 'critique';
    const scoreMeta = c[scoreGrade] || {};
    const scoreLbl  = scoreMeta.l || '—';
    const scoreCol  = scoreMeta.color || '#64748b';
    const classLbl  = { excellent: 'A', bon: 'B', correct: 'C', moyen: 'D', mauvais: 'E', critique: 'F' };
    const scoreLetter = classLbl[scoreGrade] || '—';

    // Score ring SVG
    const r = 42, circ = 2 * Math.PI * r;
    const arc = perfScore !== null ? (perfScore / 100 * circ).toFixed(1) : '0';
    const scoreSVG = `<svg class="pe-score-ring" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="9"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="${scoreCol}" stroke-width="9"
        stroke-dasharray="${arc} ${circ.toFixed(1)}" stroke-linecap="round"
        transform="rotate(-90 50 50)"/>
      <text x="50" y="43" text-anchor="middle" fill="${scoreCol}" font-size="22" font-weight="700" font-family="Space Mono,monospace">${scoreStr}</text>
      <text x="50" y="57" text-anchor="middle" fill="${scoreCol}" font-size="9" font-weight="600" font-family="sans-serif">/100</text>
    </svg>`;

    // ── Données par type (source unique : MT + compteurs existants) ──
    // typeBreakdown reste la base de la synthèse (B), du forecast et de la
    // grille de ratios déjà existante (v4EnergyCards) ; refIds/refNames y
    // sont ajoutés pour la section D (compteurs de référence déjà
    // configurés via _refMeterIds — aucune nouvelle source de vérité).
    const typeBreakdown = [];
    Object.keys(MT).forEach(type => {
      if (!_meters.some(m => m.type === type)) return;
      const meta   = MT[type];
      const conso  = _perfConso(type, peDate);
      const ratio  = _perfRatio(type, peDate);
      const grade  = _getGrade(type, ratio);
      const rUnit  = isW(type) ? 'L/client' : `${meta.unit}/client`;
      const refIds   = _refMeterIds(type);
      const refNames = refIds.map(id => { const m = _meters.find(x => x.id === id); return m ? e(m.name) : null; }).filter(Boolean);
      typeBreakdown.push({ type, meta, conso, ratio, rUnit, grade, refIds, refNames });
    });

    // ── Per-type score breakdown ──
    let breakdownHtml = '';
    typeBreakdown.forEach(({ type, meta, ratio, rUnit, grade }) => {
      const g = c[grade.key] || {};
      const pct = grade.key !== 'na' ? (grade.scoreCenter || 0) : 0;
      breakdownHtml += `<div class="pe-breakdown-row">
        <span class="pe-bd-ico">${meta.icon}</span>
        <span class="pe-bd-lbl">${meta.label}</span>
        <span class="pe-bd-val">${ratio !== null ? `${_fmt(ratio, isW(type)?0:2)} ${rUnit}` : '—'}</span>
        <div class="pe-bd-bar-wrap"><div class="pe-bd-bar" style="width:${pct}%;background:${g.color || '#64748b'}"></div></div>
        ${gradeBadge(grade.key)}
      </div>`;
    });

    // ── C. Comparaison par type : période sélectionnée vs période précédente ──
    // Réutilise exclusivement sumConsumptionByType/comparePeriods/computeRatio/
    // average/statusFromDeviation (MX.CsoCalc, Phase 1) — aucun calcul de
    // consommation ou de ratio recréé ici. Jamais d'addition entre types :
    // chaque ligne garde sa propre unité.
    const cPrevDatesSet = new Set(cPrevDates);
    function statusPill(status) {
      const map = {
        crit: { l: 'Critique',  col: '#ef4444' },
        warn: { l: 'À surveiller', col: '#f59e0b' },
        ok:   { l: 'Normal',    col: '#22c55e' },
        na:   { l: '—',         col: '#64748b' },
      }[status] || { l: '—', col: '#64748b' };
      return `<span class="pe-grade" style="background:${map.col}20;color:${map.col};border:1px solid ${map.col}50">${map.l}</span>`;
    }
    let compRows = '';
    Object.entries(MT).forEach(([type, meta]) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return;
      const unit = _meters.find(m => m.type === type)?.unit || meta.unit;
      const hasReading     = _readings.some(r => ids.includes(r.meterId) && cDatesSet.has(r.date));
      const hasPrevReading = _readings.some(r => ids.includes(r.meterId) && cPrevDatesSet.has(r.date));
      const total     = sumConsumptionByType(_readings, _meters, type, cDates);
      const prevTotal = sumConsumptionByType(_readings, _meters, type, cPrevDates);
      const { pct } = comparePeriods(total, prevTotal);
      const status  = hasReading ? statusFromDeviation(pct) : 'na';
      const absDelta = (hasReading && hasPrevReading) ? (total - prevTotal) : null;
      const dailyRatios = cDates
        .map(d => computeRatio(type, sumConsumptionByType(_readings, _meters, type, d), _clients[d] || 0))
        .filter(v => v !== null);
      const hasRatio = dailyRatios.length > 0;
      const avgRatio = hasRatio ? average(dailyRatios) : null;
      const rUnit = isW(type) ? 'L/client' : `${unit}/client`;
      compRows += `<tr>
        <td class="pe-comp-per">${meta.icon} ${e(meta.label)}</td>
        <td>${hasReading ? `${_fmt(total)} ${e(unit)}` : '<span class="pe-hist-nd">Aucun relevé</span>'}</td>
        <td>${hasPrevReading ? `${_fmt(prevTotal)} ${e(unit)}` : '<span class="pe-hist-nd">Aucun relevé</span>'}</td>
        <td>${absDelta !== null ? `${absDelta >= 0 ? '+' : ''}${_fmt(absDelta)} ${e(unit)}` : '—'}</td>
        <td>${pct !== null ? `${pct > 0 ? '+' : ''}${_fmt(pct, 1)}%` : '—'}</td>
        <td>${hasRatio ? `${_fmt(avgRatio, isW(type) ? 0 : 2)} ${rUnit}` : '—'}</td>
        <td>${statusPill(status)}</td>
      </tr>`;
    });
    const perfPerBtns = [
      { id: 'day',           l: peDate === today ? "Aujourd'hui" : _dateLbl(peDate) },
      { id: 'week',          l: '7 jours' },
      { id: 'month-current', l: 'Mois en cours' },
    ].map(p => `<button class="cso-per-btn${compPeriod === p.id ? ' active' : ''}" onclick="window._peCompPeriod='${p.id}';MX.Pages.Conso._peRefresh()">${p.l}</button>`).join('');

    // ── Prévisions fin de mois ──
    const todayDt    = new Date(today);
    const daysInMonth = new Date(todayDt.getFullYear(), todayDt.getMonth()+1, 0).getDate();
    const dayOfMonth  = todayDt.getDate();
    const daysLeft    = daysInMonth - dayOfMonth;
    let forecastHtml  = '';
    typeBreakdown.slice(0,3).forEach(({type, meta, ratio, rUnit, grade}) => {
      const ratios7 = Array.from({length:7},(_,i)=>_perfRatio(type,_daysAgo(i+1))).filter(v=>v!==null);
      const avg7    = ratios7.length ? ratios7.reduce((a,b)=>a+b,0)/ratios7.length : (ratio || 0);
      const foreG   = avg7 ? _getGrade(type, avg7) : { key: 'na' };
      const foreCol = (c[foreG.key]||{}).color || '#64748b';
      forecastHtml += `<div class="pe-fc-row">
        <span class="pe-fc-ico">${meta.icon}</span>
        <div class="pe-fc-body">
          <div class="pe-fc-lbl">${meta.label}</div>
          <div class="pe-fc-val" style="color:${foreCol}">${avg7 ? `${_fmt(avg7, isW(type)?0:2)} ${rUnit}` : '—'}</div>
          <div class="pe-fc-sub">Moy. 7 derniers jours · ${daysLeft} j restants</div>
        </div>
        ${gradeBadge(foreG.key)}
      </div>`;
    });

    // ── D. Analyse des compteurs — types/compteurs à investiguer ──
    // Réutilise les statuts déjà calculés en C et les compteurs de
    // référence déjà configurés (_refMeterIds, typeBreakdown) : aucune
    // nouvelle source de vérité, aucun nouveau moteur d'alerte — seulement
    // une lecture croisée "statut dégradé" + "relevé manquant".
    let investigateHtml = '';
    typeBreakdown.forEach(({ type, meta, refNames }) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      const hasReading = _readings.some(r => ids.includes(r.meterId) && cDatesSet.has(r.date));
      const total     = sumConsumptionByType(_readings, _meters, type, cDates);
      const prevTotal = sumConsumptionByType(_readings, _meters, type, cPrevDates);
      const { pct } = comparePeriods(total, prevTotal);
      const status = hasReading ? statusFromDeviation(pct) : 'na';
      if (status === 'crit' || status === 'warn') {
        const col = status === 'crit' ? '#ef4444' : '#f59e0b';
        investigateHtml += `<div class="pe-alert-card" style="border-left-color:${col}">
          <div class="pe-alert-head"><i class="fas fa-magnifying-glass" style="color:${col}"></i> <strong>${meta.icon} ${e(meta.label)}</strong></div>
          <div class="pe-alert-msg">${status === 'crit' ? 'Écart important' : 'Écart notable'} vs période précédente (${pct > 0 ? '+' : ''}${_fmt(pct, 1)}%)${refNames.length ? ' — référence : ' + refNames.join(', ') : ''}.</div>
        </div>`;
      }
      const missingMeters = _meters.filter(m => m.type === type && !_readings.some(r => r.meterId === m.id && cDatesSet.has(r.date)));
      if (missingMeters.length) {
        investigateHtml += `<div class="pe-alert-card" style="border-left-color:#64748b">
          <div class="pe-alert-head"><i class="fas fa-camera" style="color:#64748b"></i> <strong>${meta.icon} ${e(meta.label)}</strong></div>
          <div class="pe-alert-msg">${missingMeters.length} compteur${missingMeters.length > 1 ? 's' : ''} sans relevé sur la période : ${missingMeters.map(m => e(m.name)).join(', ')}.</div>
        </div>`;
      }
    });
    if (!investigateHtml) investigateHtml = '<div class="pe-no-alert"><i class="fas fa-check-circle" style="color:#22c55e"></i> Rien à investiguer sur cette période</div>';

    // ── Helper: client count for a date ──
    function _cliForDate(d) {
      var v = _clients[d];
      if (!v) return 0;
      return typeof v === 'object' ? (v.count || 0) : v;
    }

    // ── Helper: check configured alert rules for a date, returns array of triggered alerts ──
    function _getTriggeredAlerts(date) {
      const rules = (_perfCfg.alert_rules && _perfCfg.alert_rules.rules) || [];
      const triggered = [];
      rules.forEach(function(rule) {
        const res = rule.resource || 'eau_froide';
        const val = parseFloat(rule.value);
        if (isNaN(val)) return;
        if (rule.type === 'total') {
          const conso = _perfConso(res, date);
          if (conso !== null && conso > val) triggered.push({ rule: rule, actual: conso, unit: 'm³' });
        } else if (rule.type === 'ratio') {
          const ratio = _perfRatio(res, date);
          if (ratio !== null && ratio > val) triggered.push({ rule: rule, actual: ratio, unit: 'L/client' });
        } else if (rule.type === 'variation') {
          const ratio = _perfRatio(res, date);
          const dObj = new Date(date + 'T00:00:00'); dObj.setDate(dObj.getDate() - 1);
          const prevDate = dObj.toISOString().slice(0, 10);
          const prev = _perfRatio(res, prevDate);
          if (ratio !== null && prev !== null && prev > 0) {
            const pct = (ratio - prev) / prev * 100;
            if (pct > val) triggered.push({ rule: rule, actual: pct, unit: '%' });
          }
        }
      });
      return triggered;
    }

    // ── Period selector for history table ──
    var pePeriod = window._pePeriod || '14';
    var nHistDays = pePeriod === 'today' ? 1 : pePeriod === '7' ? 7 : pePeriod === '30' ? 30 : pePeriod === '90' ? 90 : 14;
    var PERIOD_BTNS = [
      { key: 'today', l: "Aujourd'hui" },
      { key: '7',   l: 'Semaine' },
      { key: '14',  l: '14 jours' },
      { key: '30',  l: 'Mois' },
      { key: '90',  l: '3 mois' },
    ];
    var quickNav = '<div class="pe-hist-nav">' +
      PERIOD_BTNS.map(function(b) {
        return '<button class="pe-hist-nav-btn' + (pePeriod === b.key ? ' pe-hist-nav-btn--active' : '') + '" onclick="window._pePeriod=\'' + b.key + '\';MX.Pages.Conso._peRefresh()">' + b.l + '</button>';
      }).join('') +
    '</div>';


    // ── Monthly evolution chart (SVG bar) ──
    // ── Ratio réel mensuel — navigation mois par mois ──────────────────────
    // Remplace l'ancien graphique SVG. Calcul explicitement demandé :
    // index de fin de mois − index de début de mois (jamais une moyenne de
    // ratios journaliers/mensuels), sur les compteurs généraux CONFIGURÉS
    // uniquement (_perfCfg.ref_meters — même source que _refMeterIds,
    // aucune nouvelle source de vérité). "Non configuré" si rien n'est
    // sélectionné pour ce type — jamais de repli silencieux sur un autre
    // compteur. Le ratio final réutilise computeRatio (MX.CsoCalc).
    function _lastIndexAt(meterId, dateBound, strictBefore) {
      let best = null;
      _readings.forEach(r => {
        if (r.meterId !== meterId || r.index == null) return;
        const ok = strictBefore ? r.date < dateBound : r.date <= dateBound;
        if (!ok) return;
        if (!best || r.date > best.date || (r.date === best.date && _tsMs(r.createdAt) > _tsMs(best.createdAt))) best = r;
      });
      return best ? best.index : null;
    }
    function _monthBounds(monthKey) {
      const [y, m] = monthKey.split('-').map(Number);
      const start = monthKey + '-01';
      const end   = monthKey + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
      return { start, end };
    }
    function _monthlyClientsTotal(monthKey) {
      let total = 0, found = false;
      Object.keys(_clients).forEach(d => {
        if (d.indexOf(monthKey) === 0) {
          const v = _cliForDate(d);
          if (v > 0) { total += v; found = true; }
        }
      });
      return found ? total : null;
    }
    // Résout les compteurs GÉNÉRAUX configurés pour un type — jamais le
    // fallback de _refMeterIds() (qui renverrait tous les compteurs du
    // type si rien n'est configuré). Revérifie aussi le type réel de
    // chaque compteur référencé : si la config pointe vers un compteur
    // dont le type a changé/été supprimé, il est exclu plutôt que de
    // mélanger des unités incompatibles.
    function _generalMeterIds(type) {
      const cfg = (_perfCfg.ref_meters && _perfCfg.ref_meters[type]) || [];
      if (!Array.isArray(cfg) || !cfg.length) return [];
      return cfg.filter(id => {
        const m = _meters.find(x => x.id === id);
        return m && m.type === type;
      });
    }
    // Index de début = dernier relevé STRICTEMENT avant le 1er du mois ;
    // index de fin = dernier relevé au plus tard le dernier jour du mois.
    // Ni l'un ni l'autre n'exige un relevé daté DANS le mois lui-même —
    // jamais une somme des champs `consumption` du mois (sumConsumption*
    // est volontairement écarté ici, cf. commentaire de _buildMonthlyRatioNav).
    // Statuts renvoyés : no_meter / insufficient / incoherent / ok.
    function _monthlyConsoStatus(type, monthKey) {
      const ids = _generalMeterIds(type);
      if (!ids.length) return { status: 'no_meter' };
      const { start, end } = _monthBounds(monthKey);
      let total = 0;
      for (const id of ids) {
        const startIdx = _lastIndexAt(id, start, true);
        const endIdx   = _lastIndexAt(id, end, false);
        if (startIdx === null || endIdx === null) return { status: 'insufficient' };
        const delta = endIdx - startIdx;
        if (delta < 0) return { status: 'incoherent' };
        total += delta;
      }
      return { status: 'ok', conso: Math.round(total * 1000) / 1000 };
    }
    // Clients et consommation sont calculés indépendamment l'un de l'autre
    // (l'absence de clients ne doit pas masquer une consommation réelle
    // disponible, et inversement) ; seul le ratio final dépend des deux.
    function _monthlyRealRatio(type, monthKey) {
      const consoRes = _monthlyConsoStatus(type, monthKey);
      const clients  = _monthlyClientsTotal(monthKey);
      const ratio = (consoRes.status === 'ok' && clients !== null)
        ? computeRatio(type, consoRes.conso, clients) : null;
      return { consoStatus: consoRes.status, conso: consoRes.conso ?? null, clients, ratio };
    }
    const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    function _monthLabel(monthKey) {
      const [y, m] = monthKey.split('-').map(Number);
      const n = MOIS_FR[m - 1];
      return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + y;
    }
    function _buildMonthlyRatioNav() {
      const curMonthKey = today.slice(0, 7);
      const ratioMonth  = window._peRatioMonth || curMonthKey;
      const { start }   = _monthBounds(ratioMonth);
      // Charge l'historique nécessaire au calcul par index (marge de 60j
      // avant le mois pour retrouver l'index de départ même sans relevé
      // récent). Non bloquant (Phase 1B) : la page se complète seule si
      // la requête complémentaire ramène des données après coup.
      _ensureReadingsFrom(_daysBefore(start, 60));
      _ensureClientsFrom(_daysBefore(start, 31));

      const monthLbl   = _monthLabel(ratioMonth);
      const monthShort = MOIS_FR[parseInt(ratioMonth.slice(5, 7), 10) - 1];
      const atCurrent  = ratioMonth >= curMonthKey;

      function blockFor(type, meta) {
        const res  = _monthlyRealRatio(type, ratioMonth);
        const unit = (_meters.find(m => m.type === type) || {}).unit || meta.unit;
        const rUnit = isW(type) ? 'L' : e(unit);

        // Chaque ligne reflète sa PROPRE cause d'indisponibilité — jamais
        // un message générique masquant les autres, jamais un faux zéro.
        const consoLine = res.consoStatus === 'no_meter'    ? 'Compteur général non configuré'
                         : res.consoStatus === 'insufficient' ? 'Données insuffisantes'
                         : res.consoStatus === 'incoherent'   ? 'Consommation incohérente'
                         : `${_fmt(res.conso, 1)} ${e(unit)}`; // res.conso peut valoir 0 : donnée réelle, jamais masquée
        const clientsLine = res.clients === null ? 'Clients indisponibles' : res.clients.toLocaleString('fr-FR');
        const ratioLine = res.ratio !== null
          ? `${_fmt(res.ratio, isW(type) ? 0 : 2)} ${rUnit}/client`
          : 'Ratio indisponible';

        // ── Objectif / statut (optionnel, cf. section 7) ──────────────────
        // Réutilise la configuration déjà existante (cso_perf_config/
        // objectifs) et _getGrade (seuils déjà configurés) — rien n'est
        // inventé, "Non configuré" si l'objectif n'existe pas pour ce type.
        const obj = _perfCfg.objectifs && _perfCfg.objectifs[type];
        let objLine = 'Non configuré', statusBadge = '';
        if (obj && obj.target) {
          const target = parseFloat(obj.target);
          objLine = `${_fmt(target, isW(type) ? 0 : 2)} ${rUnit}/client`;
          if (res.ratio !== null && target > 0) {
            const ecart = (res.ratio - target) / target * 100;
            objLine += ` <span class="pe-obj-pct">(${ecart > 0 ? '+' : ''}${_fmt(ecart, 1)}%)</span>`;
          }
        }
        if (res.ratio !== null) {
          const grade = _getGrade(type, res.ratio);
          statusBadge = gradeBadge(grade.key);
        }

        return `<div class="pe-v4-card">
          <div class="pe-v4-card-hd">${meta.icon} ${e(meta.label)} — ${e(monthLbl)}${statusBadge ? ' ' + statusBadge : ''}</div>
          <div class="pe-day-ef-summary">
            <div class="pe-day-ef-row"><span class="pe-day-ef-nm">Consommation ${monthShort}</span><span class="pe-day-ef-v">${consoLine}</span></div>
            <div class="pe-day-ef-row"><span class="pe-day-ef-nm">Clients ${monthShort}</span><span class="pe-day-ef-v">${clientsLine}</span></div>
            <div class="pe-day-ef-total"><span class="pe-day-ef-nm"><strong>Ratio réel</strong></span><span class="pe-day-ef-v">${ratioLine}</span></div>
            <div class="pe-day-ef-row"><span class="pe-day-ef-nm">Objectif</span><span class="pe-day-ef-v">${objLine}</span></div>
          </div>
        </div>`;
      }

      const blocksHtml = ['eau_froide', 'eau_chaude'].map(t => blockFor(t, MT[t])).join('');
      const partialNote = atCurrent
        ? '<div class="pe-hist-nd" style="padding:6px 2px 0">Mois en cours — période partielle (jusqu\'à aujourd\'hui)</div>'
        : '';

      return `<div class="pe-section pe-section--chart">
        <div class="pe-section-head"><i class="fas fa-calendar-days"></i> Ratio réel mensuel
          <button class="pe-cfg-btn" onclick="MX.Pages.Conso._peOpenGeneralMetersConfig()"><i class="fas fa-crosshairs"></i> Compteurs généraux</button>
        </div>
        <div class="pe-date-row">
          <button class="cso-ibtn" onclick="MX.Pages.Conso._peRatioMonthPrev()" title="Mois précédent"><i class="fas fa-chevron-left"></i></button>
          <span class="pe-date-lbl">${e(monthLbl)}</span>
          <button class="cso-ibtn" onclick="MX.Pages.Conso._peRatioMonthNext()" title="Mois suivant"${atCurrent ? ' disabled' : ''}><i class="fas fa-chevron-right"></i></button>
        </div>
        ${partialNote}
        <div class="pe-v4-row2">${blocksHtml}</div>
      </div>`;
    }

    // ── Monthly bilan table ──
    function _buildMonthlyTable() {
      var now2d = new Date(today + 'T00:00:00');
      var y2d = now2d.getFullYear();
      var MFULL = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
      var trows = '';
      for (var mo3d = 0; mo3d <= now2d.getMonth(); mo3d++) {
        var dIM4 = new Date(y2d, mo3d + 1, 0).getDate();
        var mCli4 = 0, mEau4 = 0, mRS4 = 0, mRC4 = 0;
        for (var ddd = 1; ddd <= dIM4; ddd++) {
          if (mo3d === now2d.getMonth() && ddd > now2d.getDate()) break;
          var dsd = new Date(y2d, mo3d, ddd).toISOString().slice(0, 10);
          var cl4 = _cliForDate(dsd);
          if (cl4 > 0) mCli4 += cl4;
          var eau4 = _perfConso('eau_froide', dsd);
          if (eau4 !== null) mEau4 += eau4;
          var rrd = _perfRatio('eau_froide', dsd);
          if (rrd !== null) { mRS4 += rrd; mRC4++; }
        }
        if (!mCli4 && !mEau4) continue;
        var avgR4 = mRC4 ? Math.round(mRS4 / mRC4) : null;
        var grade4 = avgR4 !== null ? _getGrade('eau_froide', avgR4) : null;
        var col4 = grade4 ? ((c[grade4.key] || {}).color || '#64748b') : '#64748b';
        trows += '<tr>' +
          '<td class="pe-mt-month">' + MFULL[mo3d] + '</td>' +
          '<td class="pe-mt-val">' + (mCli4 > 0 ? mCli4.toLocaleString('fr-FR') : '—') + '</td>' +
          '<td class="pe-mt-val">' + (mEau4 > 0 ? _fmt(mEau4, 1) + ' m³' : '—') + '</td>' +
          '<td class="pe-mt-val" style="color:' + col4 + ';font-weight:700">' + (avgR4 !== null ? avgR4 : '—') + '</td>' +
          '<td class="pe-mt-val">' + (grade4 && grade4.key !== 'na' ? gradeBadge(grade4.key) : '—') + '</td>' +
          '</tr>';
      }
      if (!trows) return '';
      return '<div class="pe-section pe-section--monthly-tbl">' +
        '<div class="pe-section-head"><i class="fas fa-table"></i> Bilan mensuel — Eau froide</div>' +
        '<div class="pe-mt-wrap"><table class="pe-mt-table"><thead>' +
        '<tr><th>Mois</th><th>Clients</th><th>Eau totale</th><th>L/client</th><th>Score</th></tr>' +
        '</thead><tbody>' + trows + '</tbody></table></div></div>';
    }

    // ── 14-day history table — per ref-meter columns for EF ──
    const histDays = Array.from({length: nHistDays}, (_, i) => _daysAgo(i)).reverse();
    // EF ref meters → dynamic column headers
    const efRefIds   = _refMeterIds('eau_froide');
    const efRefMtrs  = efRefIds.map(function(id){ return _meters.find(function(m){ return m.id === id; }); }).filter(Boolean);
    const histColSpan = efRefMtrs.length + 4; // date + clients + meters + total + L/client + classe + arrow

    let histHead = '<tr><th>Date</th><th>Clients</th>';
    efRefMtrs.forEach(function(m){ histHead += '<th>' + e(m.name) + '</th>'; });
    if (!efRefMtrs.length) histHead += '<th>Total EF</th>';
    histHead += '<th>Total EF m³</th><th>L/client</th><th>Classe</th><th></th></tr>';

    let histBody = '';
    histDays.forEach(function(hDate) {
      const cliN    = _cliForDate(hDate);
      const isToday = hDate === today;
      const hasJustif  = !!(_perfCfg.justifications && _perfCfg.justifications[hDate]);
      const triggered  = _getTriggeredAlerts(hDate);
      const hasAlert   = triggered.length > 0;

      let row = '<tr class="pe-hist-row' + (isToday ? ' pe-hist-today' : '') + (hasAlert ? ' pe-hist-alert' : '') +
        '" onclick="MX.Pages.Conso._peShowDay(\'' + hDate + '\')" title="Voir le détail du ' + hDate + '">';
      // Date cell
      row += '<td><span class="pe-hist-date">' +
        (isToday ? '<span class="pe-today-badge">Auj.</span> ' : '') + hDate +
        '</span>' +
        (hasJustif ? ' <i class="fas fa-comment-dots pe-justif-icon" title="Justification enregistrée"></i>' : '') +
        (hasAlert  ? ' <i class="fas fa-circle-exclamation pe-alert-icon" title="' + triggered.length + ' alerte(s)"></i>' : '') +
        '</td>';
      // Clients
      row += '<td class="pe-hist-cli">' + (cliN || '—') + '</td>';
      // Per ref-meter columns (m³)
      let totalEF = 0;
      efRefMtrs.forEach(function(m) {
        const conso = _readings.filter(function(r){ return r.meterId === m.id && r.date === hDate; })
          .reduce(function(s, r){ return s + (r.consumption || 0); }, 0);
        totalEF += conso;
        row += '<td class="pe-hist-m3">' + (conso > 0 ? _fmt(conso, 1) : '<span class="pe-hist-nd">—</span>') + '</td>';
      });
      if (!efRefMtrs.length) {
        // fallback: show raw total from _perfConso
        const raw = _perfConso('eau_froide', hDate);
        totalEF = raw || 0;
        row += '<td class="pe-hist-m3">' + (raw !== null ? _fmt(raw, 1) : '<span class="pe-hist-nd">—</span>') + '</td>';
      }
      // Total EF
      row += '<td class="pe-hist-total pe-hist-m3">' + (totalEF > 0 ? _fmt(totalEF, 1) : '<span class="pe-hist-nd">—</span>') + '</td>';
      // L/client
      const efRatioVal = cliN > 0 && totalEF > 0 ? Math.round(totalEF * 1000 / cliN) : null;
      const efRatioCfg = _perfRatio('eau_froide', hDate); // use configured ratio (may differ if _perfConso uses different logic)
      const displayRatio = efRatioCfg !== null ? Math.round(efRatioCfg) : (efRatioVal !== null ? efRatioVal : null);
      row += '<td class="pe-hist-ratio">' + (displayRatio !== null ? '<strong>' + displayRatio + '</strong>' : '<span class="pe-hist-nd">—</span>') + '</td>';
      // Classe
      const efGrade = displayRatio !== null ? _getGrade('eau_froide', displayRatio) : { key: 'na' };
      row += '<td>' + gradeBadge(efGrade.key) + '</td>';
      // Arrow
      row += '<td class="pe-hist-action"><i class="fas fa-chevron-right pe-hist-arr"></i></td>';
      row += '</tr>';
      histBody += row;
    });

    var histPeriodLbl = pePeriod === 'today' ? "Aujourd'hui" : pePeriod === '7' ? '7 jours' : pePeriod === '30' ? '30 jours' : pePeriod === '90' ? '90 jours' : '14 jours';
    const histTable = '<div class="pe-section pe-section--history">' +
      '<div class="pe-section-head"><i class="fas fa-table-list"></i> Historique — Eau froide <span class="pe-hist-hint">Cliquer pour le détail</span></div>' +
      quickNav +
      '<div class="pe-hist-wrap"><table class="pe-hist-table">' +
      '<thead>' + histHead + '</thead>' +
      '<tbody>' + (histBody || '<tr><td colspan="' + histColSpan + '" class="pe-hist-nd" style="text-align:center;padding:20px">Aucune donnée</td></tr>') + '</tbody>' +
      '</table></div></div>';

    // ── E. Objectifs et seuils ──
    // "Objectif" (target/tolerance, cso_perf_config/objectifs) et "seuils"
    // (excellent→critique, cso_perf_config/thresholds via _getGrade) sont
    // deux configurations RÉELLES et déjà distinctes : on les affiche côte
    // à côte sans en inventer une troisième. Un type sans objectif configuré
    // affiche "Non configuré" — jamais une valeur par défaut inventée.
    const objCfg = _perfCfg.objectifs || {};
    // Compute monthly average ratios (current month, days 1 to today)
    function _monthAvgRatio(type) {
      const now = new Date(today + 'T00:00:00');
      const daysThisMonth = now.getDate(); // day of month (1-based)
      let sum = 0, cnt = 0;
      for (let d = 1; d <= daysThisMonth; d++) {
        const dt = new Date(now.getFullYear(), now.getMonth(), d);
        const ds = dt.toISOString().slice(0, 10);
        const r  = _perfRatio(type, ds);
        if (r !== null) { sum += r; cnt++; }
      }
      return cnt ? sum / cnt : null;
    }
    let objRows = '';
    typeBreakdown.forEach(function({ type: ot, meta: mt, ratio: ratioToday, grade: gradeToday }) {
      const obj = objCfg[ot];
      const isWater = isW(ot);
      const unit    = isWater ? 'L/client' : e(mt.unit) + '/client';
      const ratioMonth = _monthAvgRatio(ot);
      function fmtR(v) { return v !== null ? _fmt(v, isWater ? 0 : 2) : '—'; }
      const classCell = '<td class="pe-obj-class-cell">' + gradeBadge(gradeToday.key) + '</td>';
      if (!obj || !obj.target) {
        objRows += '<tr class="pe-obj-tr">' +
          '<td><span class="pe-obj-type-lbl">' + mt.icon + ' ' + e(mt.label) + '</span></td>' +
          '<td class="pe-obj-target-cell"><span class="pe-hist-nd">Non configuré</span></td>' +
          '<td class="pe-obj-today-cell">' + fmtR(ratioToday) + '</td>' +
          '<td class="pe-obj-month-cell">' + fmtR(ratioMonth) + '</td>' +
          classCell +
          '<td class="pe-obj-ach-cell"><span class="pe-hist-nd">—</span></td>' +
          '</tr>';
        return;
      }
      const target  = parseFloat(obj.target);
      const tol     = parseFloat(obj.tolerance || 10);
      const upper   = target * (1 + tol / 100);
      // Statut "objectif" (target/tolérance) — distinct de la classe par
      // seuils (colonne précédente, excellent→critique via _getGrade).
      let todayStatus = 'na', todayCol = '#64748b';
      if (ratioToday !== null) {
        if (ratioToday <= target)       { todayStatus = 'ok';   todayCol = '#22c55e'; }
        else if (ratioToday <= upper)   { todayStatus = 'warn'; todayCol = '#f59e0b'; }
        else                            { todayStatus = 'over'; todayCol = '#ef4444'; }
      }
      const todayPct = ratioToday !== null && target > 0 ? (ratioToday - target) / target * 100 : null;
      // Objectif atteint (today)
      const achieved = ratioToday !== null ? todayStatus !== 'over' : null;
      objRows += '<tr class="pe-obj-tr">' +
        '<td><span class="pe-obj-type-lbl">' + mt.icon + ' ' + e(mt.label) + '</span></td>' +
        '<td class="pe-obj-target-cell">' + fmtR(target) + ' <small>' + unit + '</small></td>' +
        '<td class="pe-obj-today-cell" style="color:' + todayCol + ';font-weight:700">' + fmtR(ratioToday) +
          (todayPct !== null ? ' <span class="pe-obj-pct">(' + (todayPct > 0 ? '+' : '') + _fmt(todayPct, 1) + '%)</span>' : '') + '</td>' +
        '<td class="pe-obj-month-cell">' + fmtR(ratioMonth) + '</td>' +
        classCell +
        '<td class="pe-obj-ach-cell">' + (achieved === null ? '<span class="pe-hist-nd">—</span>' :
          achieved ? '<span class="pe-obj-ach pe-obj-ach--yes"><i class="fas fa-check-circle"></i> Oui</span>'
                   : '<span class="pe-obj-ach pe-obj-ach--no"><i class="fas fa-times-circle"></i> Non</span>') +
          '<small class="pe-obj-tol">±' + tol + '%</small></td>' +
        '</tr>';
    });

    // ── Date selector ──
    const dateSel = '<div class="pe-date-row">' +
      '<button class="cso-ibtn" onclick="MX.Pages.Conso._peDatePrev()"><i class="fas fa-chevron-left"></i></button>' +
      '<span class="pe-date-lbl">' + (peDate === today ? "Aujourd'hui" : peDate) + '</span>' +
      '<button class="cso-ibtn" onclick="MX.Pages.Conso._peDateNext()"' + (peDate === today ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button>' +
      '</div>';

    const noCliBanner = cli === 0
      ? '<div class="pe-nocli-banner"><i class="fas fa-users"></i> Nombre de clients non renseigné pour le ' + peDate + ' — <button class="pe-nocli-btn" onclick="MX.Pages.Conso._editCliDate(\'' + peDate + '\')">Renseigner</button></div>'
      : '';

    var monthlyRatioNav = _buildMonthlyRatioNav();
    var monthlyTable = _buildMonthlyTable();

    // ── V4: extra KPI data for strip ──
    var v4Now = new Date(today + 'T00:00:00');
    var v4MoTot = 0;
    Object.keys(_clients).forEach(function(d4k) {
      var dd4 = new Date(d4k + 'T00:00:00');
      var cl4b = _cliForDate(d4k);
      if (dd4.getFullYear() === v4Now.getFullYear() && dd4.getMonth() === v4Now.getMonth() && cl4b > 0) v4MoTot += cl4b;
    });
    var v4EauToday = _perfConso('eau_froide', peDate);
    var v4RatioToday = _perfRatio('eau_froide', peDate);
    var v4RatioGrade = v4RatioToday !== null ? _getGrade('eau_froide', v4RatioToday) : { key: 'na' };
    var v4RatioCol = (c[v4RatioGrade.key] || {}).color || '#3b82f6';

    // ── V4: 5-card KPI strip ──
    var v4Strip =
      '<div class="pe-v4-kpi-card" style="--kc:#6366f1">' +
        '<div class="pe-v4-kpi-ico" style="background:#6366f120;color:#6366f1"><i class="fas fa-users"></i></div>' +
        '<div class="pe-v4-kpi-info">' +
          '<div class="pe-v4-kpi-lbl">Clients aujourd\'hui</div>' +
          '<div class="pe-v4-kpi-val">' + (cli > 0 ? cli.toLocaleString('fr-FR') : '—') + '</div>' +
          '<div class="pe-v4-kpi-sub">' + (peDate === today ? 'Aujourd\'hui' : peDate) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pe-v4-kpi-card" style="--kc:#8b5cf6">' +
        '<div class="pe-v4-kpi-ico" style="background:#8b5cf620;color:#8b5cf6"><i class="fas fa-calendar-days"></i></div>' +
        '<div class="pe-v4-kpi-info">' +
          '<div class="pe-v4-kpi-lbl">Clients ce mois</div>' +
          '<div class="pe-v4-kpi-val">' + (v4MoTot > 0 ? v4MoTot.toLocaleString('fr-FR') : '—') + '</div>' +
          '<div class="pe-v4-kpi-sub">Cumul mensuel</div>' +
        '</div>' +
      '</div>' +
      '<div class="pe-v4-kpi-card" style="--kc:#3b82f6">' +
        '<div class="pe-v4-kpi-ico" style="background:#3b82f620;color:#3b82f6"><i class="fas fa-droplet"></i></div>' +
        '<div class="pe-v4-kpi-info">' +
          '<div class="pe-v4-kpi-lbl">Eau froide aujourd\'hui</div>' +
          '<div class="pe-v4-kpi-val">' + (v4EauToday !== null ? _fmt(v4EauToday, 1) + ' m³' : '—') + '</div>' +
          '<div class="pe-v4-kpi-sub">Consommation totale EF</div>' +
        '</div>' +
      '</div>' +
      '<div class="pe-v4-kpi-card" style="--kc:' + v4RatioCol + '">' +
        '<div class="pe-v4-kpi-ico" style="background:' + v4RatioCol + '20;color:' + v4RatioCol + '"><i class="fas fa-chart-simple"></i></div>' +
        '<div class="pe-v4-kpi-info">' +
          '<div class="pe-v4-kpi-lbl">Ratio L/client</div>' +
          '<div class="pe-v4-kpi-val" style="color:' + v4RatioCol + '">' + (v4RatioToday !== null ? Math.round(v4RatioToday) + ' L' : '—') + '</div>' +
          '<div class="pe-v4-kpi-sub">Eau froide · ' + gradeBadge(v4RatioGrade.key) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pe-v4-kpi-card" style="--kc:' + scoreCol + '">' +
        '<div class="pe-v4-kpi-ico" style="background:' + scoreCol + '20;color:' + scoreCol + '"><i class="fas fa-star"></i></div>' +
        '<div class="pe-v4-kpi-info">' +
          '<div class="pe-v4-kpi-lbl">Score du jour</div>' +
          '<div class="pe-v4-kpi-val" style="color:' + scoreCol + '">' + (perfScore !== null ? perfScore : '—') + '</div>' +
          '<div class="pe-v4-kpi-sub">Classe ' + scoreLetter + ' · ' + scoreLbl + '</div>' +
        '</div>' +
      '</div>';

    // ── V4: header score badge ──
    var v4HdrBadge =
      '<div class="pe-v4-hdr-score">' +
        '<span class="pe-v4-hdr-letter" style="background:' + scoreCol + '20;color:' + scoreCol + '">' + scoreLetter + '</span>' +
        '<div class="pe-v4-hdr-sc-info">' +
          '<span class="pe-v4-hdr-sc-num" style="color:' + scoreCol + '">' + scoreStr + '<small>/100</small></span>' +
          '<span class="pe-v4-hdr-sc-lbl">' + scoreLbl + '</span>' +
        '</div>' +
      '</div>';

    // ── V4: energy cards with progress bars ──
    var v4EnergyCards = '';
    typeBreakdown.forEach(function(etd) {
      var etype = etd.type, emeta = etd.meta, eratio = etd.ratio, erUnit = etd.rUnit, egrade = etd.grade;
      var egData = c[egrade.key] || {};
      var egCol = egData.color || '#64748b';
      var epct = egrade.key !== 'na' ? (egData.scoreCenter || 0) : 0;
      var eobj = (_perfCfg.objectifs && _perfCfg.objectifs[etype]) ? parseFloat(_perfCfg.objectifs[etype].target) : null;
      var eecart = (eratio !== null && eobj !== null && eobj > 0) ? ((eratio - eobj) / eobj * 100) : null;
      var eecartStr = eecart !== null ? ((eecart > 0 ? '+' : '') + _fmt(eecart, 1) + '%') : null;
      var eecartCol = eecart === null ? '#64748b' : (eecart <= 0 ? '#22c55e' : '#ef4444');
      v4EnergyCards +=
        '<div class="pe-v4-ec" style="--ec:' + emeta.color + '">' +
          '<div class="pe-v4-ec-hd">' +
            '<span class="pe-v4-ec-ico">' + emeta.icon + '</span>' +
            '<span class="pe-v4-ec-lbl">' + emeta.label + '</span>' +
            gradeBadge(egrade.key) +
          '</div>' +
          '<div class="pe-v4-ec-ratio">' + (eratio !== null ? _fmt(eratio, isW(etype) ? 0 : 2) + ' ' + erUnit : '—') + '</div>' +
          '<div class="pe-v4-ec-bar-wrap"><div class="pe-v4-ec-bar" style="width:' + epct + '%;background:' + egCol + '"></div></div>' +
          (eobj !== null && !isNaN(eobj) ?
            '<div class="pe-v4-ec-obj">Obj. ' + eobj + ' ' + erUnit +
            (eecartStr ? ' <span style="color:' + eecartCol + ';font-weight:700">' + eecartStr + '</span>' : '') +
            '</div>' : '') +
        '</div>';
    });

    // ── V4: assembled layout ──
    return '<div class="cso-inner pe-page pe-page--v4">' +

      '<div class="pe-v4-hdr">' +
        '<div class="pe-v4-hdr-left">' + dateSel + '</div>' +
        '<div class="pe-v4-hdr-center">' +
          '<button class="pe-cfg-btn" onclick="MX.Pages.Conso._peOpenConfig()">' +
          '<i class="fas fa-sliders"></i> Configurer</button>' +
        '</div>' +
        '<div class="pe-v4-hdr-right">' + v4HdrBadge + '</div>' +
      '</div>' +

      noCliBanner +

      '<div class="pe-v4-layout">' +

        '<div class="pe-v4-main">' +

          '<div class="pe-v4-kpi-strip">' + v4Strip + '</div>' +

          '<div class="pe-v4-row2">' +
            '<div class="pe-v4-card pe-v4-score-sec">' +
              '<div class="pe-v4-card-hd"><i class="fas fa-star"></i> Score énergétique</div>' +
              '<div class="pe-v4-score-inner">' +
                '<div class="pe-score-ring-wrap">' +
                  scoreSVG +
                  '<div class="pe-score-class-badge" style="color:' + scoreCol + '">' + scoreLetter + '</div>' +
                  '<div class="pe-score-lbl" style="color:' + scoreCol + '">' + scoreLbl + '</div>' +
                '</div>' +
                '<div class="pe-v4-breakdown">' + (breakdownHtml || '<div class="pe-bd-empty">Relevés manquants</div>') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="pe-v4-card pe-v4-energy-sec">' +
              '<div class="pe-v4-card-hd"><i class="fas fa-divide"></i> Ratios par énergie</div>' +
              '<div class="pe-v4-energy-grid">' +
                (v4EnergyCards || '<div class="cso-empty-state" style="padding:20px"><i class="fas fa-bolt-lightning" style="font-size:22px;opacity:.2"></i><p>Aucun compteur configuré</p></div>') +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="pe-v4-card pe-v4-sec--comp">' +
            '<div class="pe-v4-card-hd"><i class="fas fa-arrows-left-right"></i> Comparaison par type <span class="pe-v4-card-sub">' + e(cPeriodLbl) + '</span></div>' +
            '<div class="cso-chart2-per">' + perfPerBtns + '</div>' +
            (cPartialNote ? '<div class="pe-hist-nd" style="padding:6px 2px 2px">' + e(cPartialNote) + '</div>' : '') +
            '<div class="pe-comp-table-wrap"><table class="pe-comp-table">' +
            '<thead><tr><th>Type</th><th>Période</th><th>Période préc.</th><th>Écart abs.</th><th>Évolution</th><th>Ratio/client</th><th>Statut</th></tr></thead>' +
            '<tbody>' + (compRows || '<tr><td colspan="7" style="text-align:center;padding:16px" class="pe-hist-nd">Aucun compteur configuré</td></tr>') + '</tbody>' +
            '</table></div>' +
          '</div>' +

          '<div class="pe-v4-card pe-v4-sec--ai">' +
            '<div class="pe-v4-card-hd"><i class="fas fa-robot"></i> Analyse automatique <span class="pe-v4-card-sub">14 derniers jours</span></div>' +
            '<div class="pe-v4-ai-timeline">' + _iaAnalysisHtml() + '</div>' +
          '</div>' +

          monthlyRatioNav +
          monthlyTable +
          histTable +

          '<div class="pe-v4-card pe-v4-sec--forecast">' +
            '<div class="pe-v4-card-hd"><i class="fas fa-chart-line"></i> Tendances &amp; Prévisions <span class="pe-v4-card-sub">Fin de mois estimée</span></div>' +
            '<div class="pe-fc-list">' + (forecastHtml || '<div class="pe-bd-empty">Données insuffisantes</div>') + '</div>' +
          '</div>' +

        '</div>' +

        '<aside class="pe-v4-sidebar">' +

          '<div class="pe-v4-sw">' +
            '<div class="pe-v4-sw-hd"><i class="fas fa-star"></i> Score global</div>' +
            '<div class="pe-v4-sw-score-body">' +
              '<div class="pe-v4-sw-score-num" style="color:' + scoreCol + '">' + scoreStr + '<small>/100</small></div>' +
              gradeBadge(scoreGrade) +
              '<div class="pe-v4-sw-score-cls" style="color:' + scoreCol + '">Classe ' + scoreLetter + ' — ' + scoreLbl + '</div>' +
            '</div>' +
          '</div>' +

          '<div class="pe-v4-sw">' +
            '<div class="pe-v4-sw-hd"><i class="fas fa-magnifying-glass"></i> À investiguer</div>' +
            investigateHtml +
          '</div>' +

          (objRows ?
            '<div class="pe-v4-sw">' +
              '<div class="pe-v4-sw-hd"><i class="fas fa-bullseye"></i> Objectifs</div>' +
              '<div class="pe-v4-sw-tbl-wrap"><table class="pe-obj-table">' +
              '<thead><tr><th>Type</th><th>Obj.</th><th>Auj.</th><th>Mois</th><th>Classe</th><th>OK</th></tr></thead>' +
              '<tbody>' + objRows + '</tbody>' +
              '</table></div>' +
            '</div>' : '') +

        '</aside>' +

      '</div>' +

    '</div>';
  }

  function _peInitAnimations() {
    document.querySelectorAll('.pe-v4-ec-bar').forEach(function(bar) {
      var target = bar.style.width;
      bar.style.transition = 'none';
      bar.style.width = '0';
      setTimeout(function() { bar.style.transition = 'width .8s cubic-bezier(.4,0,.2,1)'; bar.style.width = target; }, 40);
    });
    document.querySelectorAll('.pe-bd-bar').forEach(function(bar) {
      var target = bar.style.width;
      bar.style.transition = 'none';
      bar.style.width = '0';
      setTimeout(function() { bar.style.transition = 'width .7s cubic-bezier(.4,0,.2,1)'; bar.style.width = target; }, 100);
    });
  }

  // Date navigation for performance tab
  function _peDatePrev() {
    const d = new Date((window._peSelDate || _today()) + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    window._peSelDate = d.toISOString().slice(0, 10);
    _rerender();
  }
  function _peDateNext() {
    const today = _today();
    if (!window._peSelDate || window._peSelDate >= today) return;
    const d = new Date(window._peSelDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    window._peSelDate = d.toISOString().slice(0, 10);
    if (window._peSelDate >= today) window._peSelDate = '';
    _rerender();
  }
  // Navigation mois par mois pour le bloc "Ratio réel mensuel" — état
  // indépendant de peDate/_peSelDate (celui-ci navigue jour par jour pour
  // l'historique/le detail-modal). Jamais de mois futur.
  function _peRatioMonthPrev() {
    const cur  = window._peRatioMonth || _today().slice(0, 7);
    const [y, m] = cur.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    window._peRatioMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    _rerender();
  }
  function _peRatioMonthNext() {
    const curMonthKey = _today().slice(0, 7);
    const cur = window._peRatioMonth || curMonthKey;
    if (cur >= curMonthKey) return;
    const [y, m] = cur.split('-').map(Number);
    const d = new Date(y, m, 1);
    window._peRatioMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    _rerender();
  }
  function _editCliDate(date) {
    window._csoSelDate = date || _today();
    MX.Pages.Conso._tab('compteurs');
  }

  function _peShowDay(date) {
    const esc = MX.esc || (s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const c   = _perfC();
    const TYPES = ['eau_froide', 'eau_chaude', 'electricite', 'chauffage'];
    const isW   = _isLiterRatioType;
    const cliRaw = _clients[date];
    const cliN   = typeof cliRaw === 'object' ? (cliRaw && cliRaw.count || 0) : (cliRaw || 0);
    const justif  = (_perfCfg.justifications && _perfCfg.justifications[date]) || '';
    const perfSc  = _calcPerfScore(date);

    // ── EF summary at top (ref meters + total + ratio) ──
    const efRefIds  = _refMeterIds('eau_froide');
    const efRefMtrs = efRefIds.map(id => _meters.find(m => m.id === id)).filter(Boolean);
    let efSummaryRows = '';
    let efTotal = 0;
    efRefMtrs.forEach(m => {
      const conso = _readings.filter(r => r.meterId === m.id && r.date === date)
        .reduce((s, r) => s + (r.consumption || 0), 0);
      efTotal += conso;
      efSummaryRows += '<div class="pe-day-ef-row">' +
        '<span class="pe-day-ef-nm">' + esc(m.name) + '</span>' +
        '<span class="pe-day-ef-v">' + (conso > 0 ? _fmt(conso, 1) + ' m³' : '<span class="pe-hist-nd">—</span>') + '</span>' +
        '</div>';
    });
    const efRatio = cliN > 0 && efTotal > 0 ? Math.round(efTotal * 1000 / cliN) : (_perfRatio('eau_froide', date) !== null ? Math.round(_perfRatio('eau_froide', date)) : null);
    const efGrade = efRatio !== null ? _getGrade('eau_froide', efRatio) : { key: 'na', l: '—', color: '#64748b' };
    const efCol   = (c[efGrade.key] || {}).color || '#64748b';
    const efSummaryHtml = efSummaryRows ? (
      '<div class="pe-day-ef-summary">' +
        efSummaryRows +
        '<div class="pe-day-ef-total">' +
          '<span class="pe-day-ef-nm"><strong>Total EF</strong></span>' +
          '<span class="pe-day-ef-v"><strong>' + _fmt(efTotal, 1) + ' m³</strong></span>' +
        '</div>' +
        (efRatio !== null ?
          '<div class="pe-day-ef-ratio" style="color:' + efCol + '">' +
            '<span><i class="fas fa-divide"></i> Ratio officiel</span>' +
            '<span><strong>' + efRatio + ' L/client</strong> ' +
              '<span class="pe-day-grade pe-grade" style="background:' + efCol + '20;color:' + efCol + ';border:1px solid ' + efCol + '50">' + (efGrade.l || '—') + '</span>' +
            '</span>' +
          '</div>'
        : '') +
      '</div>'
    ) : '';

    // ── Per-type detailed breakdown (all meters) ──
    let rowsHtml = '';
    TYPES.forEach(type => {
      const mt = MT[type]; if (!mt) return;
      // Show ALL meters for this type (not just ref), grouped
      const typeIds = _meters.filter(m => m.type === type).map(m => m.id);
      if (!typeIds.length) return;
      let meterRows = '';
      typeIds.forEach(id => {
        const m = _meters.find(x => x.id === id); if (!m) return;
        const conso = _readings.filter(rd => rd.meterId === id && rd.date === date)
          .reduce((s, rd) => s + (rd.consumption || 0), 0);
        if (!conso) return;
        const isRef = efRefIds.includes(id) && type === 'eau_froide';
        meterRows += '<div class="pe-day-meter-row">' +
          '<span class="pe-day-meter-nm">' +
            esc(m.name) +
            (m.zone ? ' <small class="pe-day-zone">' + esc(m.zone) + '</small>' : '') +
            (isRef ? ' <span class="pe-day-ref-tag"><i class="fas fa-crosshairs"></i></span>' : '') +
          '</span>' +
          '<span class="pe-day-meter-v">' + _fmt(conso, 2) + ' ' + esc(m.unit || mt.unit) + '</span>' +
          '</div>';
      });
      if (!meterRows) return;
      const ratio = _perfRatio(type, date);
      const grade = ratio !== null ? _getGrade(type, ratio) : { key: 'na', l: '—', color: '#64748b' };
      const col = (c[grade.key] || {}).color || '#64748b';
      rowsHtml += '<div class="pe-day-type-block">' +
        '<div class="pe-day-type-hd" style="border-left:3px solid ' + col + '">' +
          '<span class="pe-day-type-ico">' + mt.icon + '</span>' +
          '<span class="pe-day-type-lbl">' + esc(mt.label) + '</span>' +
          (ratio !== null ? '<span class="pe-day-ratio" style="color:' + col + '">' + _fmt(ratio, isW(type) ? 0 : 2) + ' ' + (isW(type) ? 'L' : esc(mt.unit)) + '/client</span>' : '') +
          '<span class="pe-day-grade pe-grade" style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '50">' + (grade.l || '—') + '</span>' +
        '</div>' +
        '<div class="pe-day-meters">' + meterRows + '</div>' +
        '</div>';
    });

    // ── Triggered alerts for this day ──
    const triggered = (function() {
      const rules = (_perfCfg.alert_rules && _perfCfg.alert_rules.rules) || [];
      const out = [];
      rules.forEach(function(rule) {
        const res = rule.resource || 'eau_froide';
        const mt  = MT[res] || {};
        const val = parseFloat(rule.value);
        if (isNaN(val)) return;
        let actual = null, label = '', unit = '';
        if (rule.type === 'total') {
          actual = _perfConso(res, date);
          label  = 'Total ' + (mt.label || res); unit = 'm³';
          if (actual === null || actual <= val) return;
        } else if (rule.type === 'ratio') {
          actual = _perfRatio(res, date);
          label  = 'Ratio ' + (mt.label || res); unit = 'L/client';
          if (actual === null || actual <= val) return;
        } else if (rule.type === 'variation') {
          const dObj = new Date(date + 'T00:00:00'); dObj.setDate(dObj.getDate() - 1);
          const prev = _perfRatio(res, dObj.toISOString().slice(0, 10));
          actual = _perfRatio(res, date);
          if (actual === null || prev === null || prev <= 0) return;
          actual = (actual - prev) / prev * 100;
          label  = 'Variation ' + (mt.label || res); unit = '%';
          if (actual <= val) return;
        } else return;
        out.push({ label: label, val: val, actual: actual, unit: unit });
      });
      return out;
    })();

    let alertsHtml = '';
    if (triggered.length) {
      alertsHtml = '<div class="pe-day-alerts-block">' +
        '<div class="pe-day-justif-lbl" style="color:#ef4444"><i class="fas fa-circle-exclamation"></i> Alertes déclenchées</div>';
      triggered.forEach(function(a) {
        alertsHtml += '<div class="pe-day-alert-row">' +
          '<span class="pe-day-alert-nm">' + esc(a.label) + ' &gt; ' + _fmt(a.val, a.unit==='%'?0:1) + ' ' + esc(a.unit) + '</span>' +
          '<span class="pe-day-alert-actual" style="color:#ef4444">' + _fmt(a.actual, a.unit==='%'?1:0) + ' ' + esc(a.unit) + '</span>' +
          '</div>';
      });
      alertsHtml += '</div>';
    }

    const scoreStr = perfSc !== null ? perfSc + '/100' : '—';
    const justifSection = '<div class="pe-day-justif-block">' +
      '<div class="pe-day-justif-lbl"><i class="fas fa-comment-dots"></i> Justification / Commentaire</div>' +
      (justif
        ? '<div class="pe-day-justif-text">' + esc(justif) + '</div>' +
          '<button class="pe-justif-add-btn" onclick="MX.Pages.Conso._peAddJustif(\'' + date + '\')"><i class="fas fa-pen"></i> Modifier</button>'
        : '<button class="pe-justif-add-btn" onclick="MX.Pages.Conso._peAddJustif(\'' + date + '\')"><i class="fas fa-plus"></i> Ajouter un commentaire</button>') +
      '</div>';

    const html = '<div class="pe-day-modal-backdrop" onclick="this.remove()">' +
      '<div class="pe-day-modal" onclick="event.stopPropagation()">' +
        '<div class="pe-day-modal-hd">' +
          '<span class="pe-day-modal-ttl"><i class="fas fa-calendar-day"></i> Détail du ' + date + '</span>' +
          '<button class="pe-day-modal-close" onclick="this.closest(\'.pe-day-modal-backdrop\').remove()"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="pe-day-modal-meta">' +
          '<span><i class="fas fa-users"></i> ' + (cliN || '—') + ' clients</span>' +
          '<span><i class="fas fa-star"></i> Score : ' + scoreStr + '</span>' +
          (triggered.length ? '<span style="color:#ef4444"><i class="fas fa-circle-exclamation"></i> ' + triggered.length + ' alerte(s)</span>' : '') +
        '</div>' +
        (efSummaryHtml ? '<div class="pe-day-ef-wrap">' + efSummaryHtml + '</div>' : '') +
        alertsHtml +
        '<div class="pe-day-types">' + (rowsHtml || '<div class="pe-bd-empty">Aucun relevé pour cette date</div>') + '</div>' +
        justifSection +
      '</div>' +
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function _peAddJustif(date) {
    const existing = (_perfCfg.justifications && _perfCfg.justifications[date]) || '';
    const backdrop = document.querySelector('.pe-day-modal-backdrop');
    const modal = backdrop ? backdrop.querySelector('.pe-day-modal') : null;
    if (!modal) return;
    const prev = modal.querySelector('.pe-day-justif-block');
    if (prev) prev.remove();
    const block = document.createElement('div');
    block.className = 'pe-day-justif-block';
    block.innerHTML = '<div class="pe-day-justif-lbl"><i class="fas fa-comment-dots"></i> Justification</div>' +
      '<textarea class="pe-justif-textarea" id="pe-justif-ta" rows="3" placeholder="Ex : fermeture partielle, événement spécial...">' + existing.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</textarea>' +
      '<div class="pe-justif-btns">' +
        '<button class="pe-justif-save-btn" onclick="MX.Pages.Conso._peSaveJustif(\'' + date + '\',document.getElementById(\'pe-justif-ta\').value)"><i class="fas fa-save"></i> Enregistrer</button>' +
        '<button class="pe-justif-cancel-btn" onclick="document.querySelector(\'.pe-day-modal-backdrop\').remove()"><i class="fas fa-times"></i> Annuler</button>' +
      '</div>';
    modal.appendChild(block);
    setTimeout(() => { const ta = document.getElementById('pe-justif-ta'); if (ta) ta.focus(); }, 50);
  }

  function _peSaveJustif(date, text) {
    const val = (text || '').trim();
    const ref = CSO.perfConfig().doc('justifications');
    const op = val
      ? ref.set({ [date]: val }, { merge: true })
      : ref.update({ [date]: firebase.firestore.FieldValue.delete() }).catch(() => {});
    op && op.then
      ? op.then(() => { document.querySelector('.pe-day-modal-backdrop') && document.querySelector('.pe-day-modal-backdrop').remove(); })
          .catch(err => { if (window.MX && MX.toast) MX.toast('Erreur : ' + err.message, 'error'); })
      : (document.querySelector('.pe-day-modal-backdrop') && document.querySelector('.pe-day-modal-backdrop').remove());
  }


  // ── Configuration drawer ──
  function _peOpenConfig() {
    var ex = document.getElementById('pe-cfg-drawer');
    if (ex) { ex.remove(); return; }
    var esc2 = MX.esc || function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var REF_TYPES2 = ['eau_froide','eau_chaude','electricite','gaz'];
    var CLASS_ORD2 = ['excellent','bon','correct','moyen','mauvais','critique'];
    var TYPE_META2 = {
      eau_froide:  { label: 'Eau froide',  unit: 'L/client',   icon: '💧' },
      eau_chaude:  { label: 'Eau chaude',  unit: 'L/client',   icon: '🔥' },
      electricite: { label: 'Électricité', unit: 'kWh/client', icon: '⚡' },
      gaz:         { label: 'Gaz',         unit: 'kWh/client', icon: '🌬' },
    };
    var OBJ_TYPES2 = ['eau_froide','eau_chaude','electricite'];
    var cfgRef2 = _perfCfg.ref_meters || {};

    // ── Compteurs de référence ──
    var refSecHtml = '';
    REF_TYPES2.forEach(function(type) {
      var typeMeters = _meters.filter(function(m){ return m.type === type; });
      if (!typeMeters.length) return;
      var mt2 = MT[type]; if (!mt2) return;
      var selIds = cfgRef2[type] || [];
      refSecHtml += '<div class="pe-cfg-type-block">' +
        '<div class="pe-cfg-type-hd">' + mt2.icon + ' ' + esc2(mt2.label) + '</div>' +
        '<div class="pe-cfg-meter-list">' +
        typeMeters.map(function(m2) {
          var checked = !selIds.length || selIds.indexOf(m2.id) !== -1;
          return '<label class="pe-cfg-meter-item"><input type="checkbox" class="pe-cfg-ref-cb" data-type="' + type + '" data-id="' + esc2(m2.id) + '"' + (checked ? ' checked' : '') + '> ' + esc2(m2.name) + (m2.zone ? ' <small>(' + esc2(m2.zone) + ')</small>' : '') + '</label>';
        }).join('') +
        '</div></div>';
    });
    if (!refSecHtml) refSecHtml = '<div class="pe-hist-nd" style="padding:6px 0;font-size:12px">Aucun compteur configuré</div>';

    // ── Clients ──
    var todayD2 = _today(), hierD2 = _daysAgo(1);
    function _cliD(d){ var v = _clients[d]; if(!v)return 0; return typeof v==='object'?(v.count||0):v; }
    var now3 = new Date(), y3 = now3.getFullYear(), mo3b = now3.getMonth();
    var prevMo3 = mo3b===0?11:mo3b-1, prevYr3 = mo3b===0?y3-1:y3;
    var cliMo3 = 0, cliPrev3 = 0;
    Object.keys(_clients).forEach(function(d3){ var dd3=new Date(d3+'T00:00:00'); var n3=_cliD(d3); if(dd3.getFullYear()===y3&&dd3.getMonth()===mo3b)cliMo3+=n3; else if(dd3.getFullYear()===prevYr3&&dd3.getMonth()===prevMo3)cliPrev3+=n3; });
    var cliHtml2 = '<div class="pe-cfg-cli-grid">' +
      '<div class="pe-cfg-cli-item"><span class="pe-cfg-cli-lbl">Aujourd\'hui</span><span class="pe-cfg-cli-val">' + (_cliD(todayD2)||'—') + '</span><button class="cso-ibtn" onclick="document.getElementById(\'pe-cfg-drawer\').remove();MX.Pages.Conso._editCliDate(\'' + todayD2 + '\')"><i class="fas fa-pen"></i></button></div>' +
      '<div class="pe-cfg-cli-item"><span class="pe-cfg-cli-lbl">Hier</span><span class="pe-cfg-cli-val">' + (_cliD(hierD2)||'—') + '</span><button class="cso-ibtn" onclick="document.getElementById(\'pe-cfg-drawer\').remove();MX.Pages.Conso._editCliDate(\'' + hierD2 + '\')"><i class="fas fa-pen"></i></button></div>' +
      '<div class="pe-cfg-cli-item"><span class="pe-cfg-cli-lbl">Ce mois</span><span class="pe-cfg-cli-val">' + (cliMo3>0?cliMo3.toLocaleString('fr-FR'):'—') + '</span></div>' +
      '<div class="pe-cfg-cli-item"><span class="pe-cfg-cli-lbl">Mois précédent</span><span class="pe-cfg-cli-val">' + (cliPrev3>0?cliPrev3.toLocaleString('fr-FR'):'—') + '</span></div>' +
    '</div>';

    // ── Objectifs & seuils ──
    var thrCfg2 = _perfCfg.thresholds || {}, clsCfg2 = _perfCfg.classes || {}, objCfg2 = _perfCfg.objectifs || {};
    var objSecHtml2 = '';
    OBJ_TYPES2.forEach(function(type) {
      var mt3 = TYPE_META2[type]; if (!mt3) return;
      var defThr = PERF_DEFAULTS.thresholds[type] || {};
      var cfgThr = thrCfg2[type] || {};
      var obj3 = objCfg2[type] || {};
      objSecHtml2 += '<div class="pe-cfg-type-block">' +
        '<div class="pe-cfg-type-hd">' + mt3.icon + ' ' + esc2(mt3.label) + '</div>' +
        '<div class="pe-cfg-thr-grid">' +
        CLASS_ORD2.filter(function(k){ return k!=='critique'; }).map(function(k) {
          var def2 = PERF_DEFAULTS.classes[k] || {};
          var cfgCls2 = clsCfg2[k] || {};
          var col2 = cfgCls2.color || def2.color || '#64748b';
          var val2 = cfgThr[k] !== undefined ? cfgThr[k] : (defThr[k] || '');
          return '<div class="pe-cfg-thr-row">' +
            '<span class="pe-cfg-thr-dot" style="background:' + col2 + '"></span>' +
            '<label class="pe-cfg-thr-lbl">' + (k.charAt(0).toUpperCase()+k.slice(1)) + '</label>' +
            '<span class="pe-cfg-thr-op">≤</span>' +
            '<input class="fi pe-cfg-thr-inp" id="pe-cfg-thr-' + type + '-' + k + '" type="number" min="0" step="0.5" value="' + val2 + '">' +
            '<span class="pe-cfg-thr-unit">' + mt3.unit + '</span>' +
            '<input class="pe-cfg-col-inp" id="pe-cfg-col-' + type + '-' + k + '" type="color" value="' + col2 + '">' +
          '</div>';
        }).join('') +
        '</div>' +
        '<div class="pe-cfg-obj-row">' +
          '<label class="pe-cfg-obj-lbl">Objectif <input class="fi pe-cfg-obj-inp" id="pe-cfg-obj-' + type + '" type="number" min="0" step="0.5" value="' + (obj3.target||'') + '" placeholder="—"> <span class="pe-cfg-thr-unit">' + mt3.unit + '</span></label>' +
          '<label class="pe-cfg-obj-lbl">Tolérance <input class="fi pe-cfg-obj-inp" id="pe-cfg-tol-' + type + '" type="number" min="0" max="100" step="1" value="' + (obj3.tolerance||10) + '" placeholder="10"> <span class="pe-cfg-thr-unit">%</span></label>' +
        '</div>' +
      '</div>';
    });

    // ── Alertes ──
    var rulesArr2 = ((_perfCfg.alert_rules && _perfCfg.alert_rules.rules) || []).slice();
    var aRL = { eau_froide:'💧 EF', eau_chaude:'🔥 ECS', electricite:'⚡ Élec' };
    var aTL = { total:'Total', ratio:'Ratio', variation:'Variation' };
    var aUL = { total:'m³', ratio:'L/client', variation:'%' };
    function renderRules2(arr) {
      return arr.length
        ? arr.map(function(r, i){ return '<div class="pe-alert-rule-row"><span class="pe-alert-rule-lbl">' + (aRL[r.resource]||r.resource) + ' — ' + (aTL[r.type]||r.type) + ' &gt; <strong>' + r.value + '</strong> ' + (aUL[r.type]||'') + '</span><button class="pe-alert-rule-del cso-ibtn" onclick="window._peCfgDelRule(' + i + ')"><i class="fas fa-trash"></i></button></div>'; }).join('')
        : '<div class="pe-hist-nd" style="font-size:12px;padding:6px 0">Aucune règle configurée</div>';
    }

    var drawerHtml2 = '<div id="pe-cfg-drawer" class="pe-cfg-drawer">' +
      '<div class="pe-cfg-backdrop" onclick="document.getElementById(\'pe-cfg-drawer\').remove()"></div>' +
      '<div class="pe-cfg-panel">' +
        '<div class="pe-cfg-hd">' +
          '<span class="pe-cfg-ttl"><i class="fas fa-sliders"></i> Configuration Performance</span>' +
          '<button class="cso-ibtn pe-cfg-close" onclick="document.getElementById(\'pe-cfg-drawer\').remove()"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="pe-cfg-body">' +
          '<div class="pe-cfg-section"><div class="pe-cfg-section-hd"><i class="fas fa-crosshairs"></i> Compteurs de référence</div>' +
          '<p class="pe-ref-intro">Sélectionnez les compteurs utilisés pour le calcul des ratios officiels (L/client).</p>' +
          refSecHtml + '</div>' +
          '<div class="pe-cfg-section"><div class="pe-cfg-section-hd"><i class="fas fa-users"></i> Nombre de clients</div>' +
          cliHtml2 + '</div>' +
          '<div class="pe-cfg-section"><div class="pe-cfg-section-hd"><i class="fas fa-bullseye"></i> Objectifs &amp; seuils</div>' +
          '<p class="pe-ref-intro">Seuils par classe (≤ valeur) et objectif L/client. Couleur modifiable par classe.</p>' +
          objSecHtml2 + '</div>' +
          '<div class="pe-cfg-section"><div class="pe-cfg-section-hd"><i class="fas fa-bell"></i> Alertes</div>' +
          '<p class="pe-ref-intro">Déclenchement automatique si un seuil est dépassé sur la journée.</p>' +
          '<div id="pe-cfg-alert-list" class="pe-alert-rules-list">' + renderRules2(rulesArr2) + '</div>' +
          '<div class="pe-alert-add-form">' +
            '<select class="fi pe-alert-sel" id="pe-cfg-alt"><option value="total">Total &gt;</option><option value="ratio">Ratio &gt;</option><option value="variation">Variation &gt;</option></select>' +
            '<select class="fi pe-alert-sel" id="pe-cfg-ares"><option value="eau_froide">💧 EF</option><option value="eau_chaude">🔥 ECS</option><option value="electricite">⚡ Élec</option></select>' +
            '<input class="fi pe-alert-val" id="pe-cfg-aval" type="number" min="0" step="0.1" placeholder="Seuil">' +
            '<button class="cso-ibtn pe-alert-add-btn" onclick="window._peCfgAddRule()"><i class="fas fa-plus"></i> Ajouter</button>' +
          '</div></div>' +
        '</div>' +
        '<div class="pe-cfg-footer">' +
          '<button class="cso-ibtn pe-cfg-reset-btn" onclick="window._peCfgReset()"><i class="fas fa-rotate-left"></i> Réinitialiser</button>' +
          '<button class="cso-ibtn" onclick="document.getElementById(\'pe-cfg-drawer\').remove()">Annuler</button>' +
          '<button class="cso-ibtn cso-ibtn--primary pe-cfg-save-btn" onclick="window._peCfgSave()"><i class="fas fa-save"></i> Sauvegarder</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', drawerHtml2);
    window._peCfgRulesArr = rulesArr2;

    window._peCfgRenderRules = function() {
      var el = document.getElementById('pe-cfg-alert-list');
      if (el) el.innerHTML = renderRules2(window._peCfgRulesArr);
    };
    window._peCfgAddRule = function() {
      var t = document.getElementById('pe-cfg-alt').value;
      var r = document.getElementById('pe-cfg-ares').value;
      var v = parseFloat(document.getElementById('pe-cfg-aval').value);
      if (isNaN(v) || v <= 0) { if (MX.toast) MX.toast('Saisissez une valeur > 0', true); return; }
      window._peCfgRulesArr.push({ type: t, resource: r, value: v });
      document.getElementById('pe-cfg-aval').value = '';
      window._peCfgRenderRules();
    };
    window._peCfgDelRule = function(i) {
      window._peCfgRulesArr.splice(i, 1);
      window._peCfgRenderRules();
    };
    window._peCfgSave = function() {
      var saveBtn = document.querySelector('.pe-cfg-save-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
      var thrData3 = {};
      ['eau_froide','eau_chaude','electricite','gaz'].forEach(function(type) {
        thrData3[type] = {};
        ['excellent','bon','correct','moyen','mauvais'].forEach(function(k) {
          var el = document.getElementById('pe-cfg-thr-' + type + '-' + k);
          if (el && el.value !== '') thrData3[type][k] = parseFloat(el.value);
        });
      });
      var clsData3 = {};
      CLASS_ORD2.forEach(function(k) {
        var def3 = PERF_DEFAULTS.classes[k] || {};
        clsData3[k] = { l: def3.l, scoreCenter: def3.scoreCenter };
        var colEl = document.getElementById('pe-cfg-col-eau_froide-' + k);
        clsData3[k].color = colEl ? colEl.value : (def3.color || '#64748b');
      });
      var refData3 = {};
      document.querySelectorAll('.pe-cfg-ref-cb').forEach(function(cb) {
        if (!refData3[cb.dataset.type]) refData3[cb.dataset.type] = [];
        if (cb.checked) refData3[cb.dataset.type].push(cb.dataset.id);
      });
      var objData3 = {};
      OBJ_TYPES2.forEach(function(ot) {
        var tEl = document.getElementById('pe-cfg-obj-' + ot);
        var tolEl = document.getElementById('pe-cfg-tol-' + ot);
        if (tEl && tEl.value !== '') objData3[ot] = { target: parseFloat(tEl.value), tolerance: (tolEl && tolEl.value !== '') ? parseFloat(tolEl.value) : 10 };
      });
      var alertData3 = { rules: window._peCfgRulesArr || [] };
      var db4 = firebase.firestore();
      var pc4 = db4.collection('cso_perf_config');
      Promise.all([
        pc4.doc('thresholds').set(thrData3, { merge: true }),
        pc4.doc('classes').set(clsData3, { merge: true }),
        pc4.doc('ref_meters').set(refData3, { merge: true }),
        pc4.doc('objectifs').set(objData3, { merge: true }),
        pc4.doc('alert_rules').set(alertData3),
      ]).then(function() {
        var d4 = document.getElementById('pe-cfg-drawer'); if (d4) d4.remove();
        if (MX.toast) MX.toast('Configuration enregistrée');
      }).catch(function(err) {
        if (MX.toast) MX.toast('Erreur : ' + err.message, true);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Sauvegarder'; }
      });
    };
    window._peCfgReset = function() {
      if (!confirm('Réinitialiser les paramètres par défaut ?')) return;
      ['eau_froide','eau_chaude','electricite','gaz'].forEach(function(type) {
        var def3 = PERF_DEFAULTS.thresholds[type] || {};
        ['excellent','bon','correct','moyen','mauvais'].forEach(function(k) {
          var el = document.getElementById('pe-cfg-thr-' + type + '-' + k);
          if (el) el.value = def3[k] || '';
          var colEl = document.getElementById('pe-cfg-col-' + type + '-' + k);
          if (colEl) colEl.value = (PERF_DEFAULTS.classes[k] || {}).color || '#64748b';
        });
      });
      OBJ_TYPES2.forEach(function(ot) {
        var el1 = document.getElementById('pe-cfg-obj-' + ot), el2 = document.getElementById('pe-cfg-tol-' + ot);
        if (el1) el1.value = ''; if (el2) el2.value = 10;
      });
      window._peCfgRulesArr = [];
      window._peCfgRenderRules();
    };
  }

  // ── Configuration dédiée : compteurs GÉNÉRAUX pour le ratio réel mensuel ──
  // Section indépendante de "Compteurs de référence" (_peOpenConfig ci-dessus) :
  // celle-ci alimente _refMeterIds() (repli sur tous les compteurs du type si
  // rien n'est configuré, utilisé par le score énergétique — logique non
  // modifiée ici). Cette configuration-ci n'a AUCUN repli : une case non
  // cochée = compteur exclu, et si rien n'est coché pour un type, la case
  // reste vide en base ⇒ _generalMeterIds() renvoie [] ⇒ "Compteur général
  // non configuré" (déjà géré par _monthlyConsoStatus). Les deux partagent
  // volontairement le même document Firestore cso_perf_config/ref_meters et
  // les mêmes clés eau_froide/eau_chaude — aucune nouvelle source de vérité —
  // seule cette UI est nouvelle et dédiée, pour être visible directement à
  // côté du bloc "Ratio réel mensuel" plutôt que noyée dans la configuration
  // générale de Performance.
  function _peOpenGeneralMetersConfig() {
    var ex = document.getElementById('pe-genmeter-drawer');
    if (ex) { ex.remove(); return; }
    var esc3 = MX.esc || function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var GM_TYPES = ['eau_froide', 'eau_chaude'];
    var cfgRef3 = _perfCfg.ref_meters || {};

    var secHtml = GM_TYPES.map(function(type) {
      var mt = MT[type];
      var typeMeters = _meters.filter(function(m) { return m.type === type; });
      var selIds = Array.isArray(cfgRef3[type]) ? cfgRef3[type] : [];
      var listHtml = typeMeters.length
        ? typeMeters.map(function(m) {
            var checked = selIds.indexOf(m.id) !== -1;
            return '<label class="pe-cfg-meter-item"><input type="checkbox" class="pe-gm-cb" data-type="' + type + '" data-id="' + esc3(m.id) + '"' + (checked ? ' checked' : '') + '> ' +
              esc3(m.name) + ' <small style="color:var(--text3)">(' + esc3(m.id) + ')</small></label>';
          }).join('')
        : '<div class="pe-hist-nd" style="padding:4px 0;font-size:12px">Aucun compteur ' + esc3(mt.label.toLowerCase()) + ' n\'existe pour le moment.</div>';
      return '<div class="pe-cfg-type-block">' +
        '<div class="pe-cfg-type-hd">' + mt.icon + ' ' + esc3(mt.label) + '</div>' +
        '<div class="pe-cfg-meter-list">' + listHtml + '</div>' +
        (typeMeters.length && !selIds.length ? '<div class="pe-hist-nd" style="padding:4px 0 0;font-size:11px">Aucun compteur coché : le ratio ' + esc3(mt.label.toLowerCase()) + ' affichera « Compteur général non configuré ».</div>' : '') +
      '</div>';
    }).join('');

    var drawerHtml = '<div id="pe-genmeter-drawer" class="pe-cfg-drawer">' +
      '<div class="pe-cfg-backdrop" onclick="document.getElementById(\'pe-genmeter-drawer\').remove()"></div>' +
      '<div class="pe-cfg-panel">' +
        '<div class="pe-cfg-hd">' +
          '<span class="pe-cfg-ttl"><i class="fas fa-crosshairs"></i> Compteurs généraux utilisés pour le ratio</span>' +
          '<button class="cso-ibtn pe-cfg-close" onclick="document.getElementById(\'pe-genmeter-drawer\').remove()"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="pe-cfg-body">' +
          '<div class="pe-cfg-section">' +
          '<p class="pe-ref-intro">Cochez uniquement les compteurs généraux (jamais un sous-compteur) à utiliser pour le calcul du ratio réel mensuel (Eau froide et Eau chaude). Ces réglages sont indépendants de la sélection ci-dessus utilisée pour le score énergétique global — bien qu\'ils partagent la même configuration enregistrée.</p>' +
          secHtml +
          '</div>' +
        '</div>' +
        '<div class="pe-cfg-footer">' +
          '<button class="cso-ibtn" onclick="document.getElementById(\'pe-genmeter-drawer\').remove()">Annuler</button>' +
          '<button class="cso-ibtn cso-ibtn--primary pe-gm-save-btn" onclick="window._peGmSave()"><i class="fas fa-save"></i> Sauvegarder</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', drawerHtml);

    window._peGmSave = function() {
      var saveBtn = document.querySelector('.pe-gm-save-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
      var gmData = { eau_froide: [], eau_chaude: [] };
      document.querySelectorAll('.pe-gm-cb').forEach(function(cb) {
        if (cb.checked) gmData[cb.dataset.type].push(cb.dataset.id);
      });
      firebase.firestore().collection('cso_perf_config').doc('ref_meters').set(gmData, { merge: true })
        .then(function() {
          var d = document.getElementById('pe-genmeter-drawer'); if (d) d.remove();
          if (MX.toast) MX.toast('Compteurs généraux enregistrés');
        })
        .catch(function(err) {
          if (MX.toast) MX.toast('Erreur : ' + err.message, true);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Sauvegarder'; }
        });
    };
  }

  function _tAlertes() {
    const today = _today();
    const per   = window._csoSupPer || '30';
    const days  = parseInt(per);
    // ── Smart alert detection ──
    const smartAlerts = _detectAlerts();
    const nCrit = smartAlerts.filter(a => a.level === 'critical').length;
    const nWarn = smartAlerts.filter(a => a.level === 'warning').length;
    const savedCrit = _csoAlerts.filter(a => a.level === 'critical' && !a.acknowledged && a.status !== 'resolved').length;
    const savedWarn = _csoAlerts.filter(a => a.level === 'warning' && !a.acknowledged && a.status !== 'resolved').length;
    const totalCrit = nCrit + savedCrit;
    const totalWarn = nWarn + savedWarn;

    // ── Score ──
    const score = _calcScore();
    const scoreColor = score >= 90 ? '#34d399' : score >= 70 ? '#06B6D4' : score >= 50 ? '#f59e0b' : '#f87171';
    const scoreLbl   = score >= 90 ? 'Excellent' : score >= 70 ? 'Bon' : score >= 50 ? 'Moyen' : 'Critique';
    const scoreSub   = score >= 90 ? 'Consommations dans les normes' : score >= 70 ? 'Légères anomalies détectées' : score >= 50 ? 'Anomalies à surveiller' : 'Interventions requises';
    const scoreR = 56, scoreCirc = 2 * Math.PI * scoreR;
    const scoreSVG = `<svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="${scoreR}" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="10"/>
      <circle cx="70" cy="70" r="${scoreR}" fill="none" stroke="${scoreColor}" stroke-width="10"
        stroke-dasharray="${(score/100*scoreCirc).toFixed(1)} ${scoreCirc.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 70 70)"/>
      <text x="70" y="62" text-anchor="middle" fill="${scoreColor}" font-size="30" font-weight="700" font-family="Space Mono,monospace">${score}</text>
      <text x="70" y="80" text-anchor="middle" class="an2-axis-lbl" font-size="10" font-family="sans-serif">/100</text>
      <text x="70" y="97" text-anchor="middle" fill="${scoreColor}" font-size="11" font-weight="600" font-family="sans-serif">${scoreLbl}</text>
    </svg>`;

    // ── Energy status cards ──
    const SUP_TYPES = ['eau_froide', 'eau_chaude', 'chauffage', 'electricite'];
    let energyCards = '';
    const energyData = {};
    SUP_TYPES.forEach(type => {
      const meta = MT[type]; if (!meta) return;
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      const unit = ids.length ? (_meters.find(m => m.type === type)?.unit || meta.unit) : meta.unit;
      const todayC = _readings.filter(r => ids.includes(r.meterId) && r.date === today).reduce((s,r) => s+(r.consumption||0), 0);
      const spark7 = Array.from({length:7}, (_,i) => _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(6-i)).reduce((s,r) => s+(r.consumption||0), 0));
      let sum30 = 0, cnt30 = 0;
      for (let i = 1; i <= 30; i++) {
        const c = _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(i)).reduce((s,r) => s+(r.consumption||0), 0);
        if (c > 0) { sum30 += c; cnt30++; }
      }
      const avg30 = cnt30 ? sum30/cnt30 : 0;
      const ecart = avg30 > 0 ? Math.round((todayC - avg30)/avg30 * 100) : null;
      const lvl = ecart === null ? 'nodata' : Math.abs(ecart) <= 15 ? 'ok' : Math.abs(ecart) <= 40 ? 'warn' : 'crit';
      const lvlColor = lvl === 'ok' ? '#34d399' : lvl === 'warn' ? '#f59e0b' : lvl === 'crit' ? '#f87171' : 'var(--text3)';
      const lvlLabel = lvl === 'ok' ? 'Normal' : lvl === 'warn' ? 'Surveillance' : lvl === 'crit' ? 'Critique' : 'Sans données';
      const barPct = avg30 > 0 ? Math.min(100, Math.round(todayC/avg30*100)) : 0;
      energyData[type] = { todayC, avg30, ecart, lvl, ids, unit };
      energyCards += `<div class="sv-energy-card" style="--ec:${meta.color};--ed:${meta.dim}">
        <div class="sv-energy-hd">
          <span class="sv-energy-ico">${meta.icon}</span>
          <div>
            <div class="sv-energy-nm">${meta.label}</div>
            <div class="sv-energy-status" style="color:${lvlColor}"><span class="sv-status-dot" style="background:${lvlColor}"></span>${lvlLabel}</div>
          </div>
          <div class="sv-energy-ecart" style="color:${lvlColor}">${ecart !== null ? `${ecart > 0 ? '+' : ''}${ecart}%` : '—'}</div>
        </div>
        <div class="sv-energy-val">${todayC > 0 ? _fmt(todayC) : '—'}<span class="sv-energy-u"> ${unit}</span></div>
        <div class="sv-energy-bar-wrap"><div class="sv-energy-bar" style="width:${barPct}%;background:${lvlColor}"></div></div>
        <div class="sv-energy-foot">Moy.30j : ${avg30 > 0 ? `${_fmt(avg30)} ${unit}` : '—'}</div>
        <div class="sv-energy-spark">${_sparkSVG(spark7, meta.color, 80, 26)}</div>
      </div>`;
    });

    // ── Score per-energy mini bars ──
    let scoreBars = '';
    SUP_TYPES.forEach(type => {
      const d = energyData[type]; if (!d) return;
      const meta = MT[type];
      const barW = d.avg30 > 0 ? Math.min(100, Math.round(d.todayC/d.avg30*100)) : 0;
      const barC = d.lvl === 'ok' ? '#34d399' : d.lvl === 'warn' ? '#f59e0b' : d.lvl === 'crit' ? '#f87171' : 'rgba(255,255,255,0.12)';
      scoreBars += `<div class="sv-sbar-row">
        <span class="sv-sbar-ico">${meta.icon}</span>
        <div class="sv-sbar-wrap"><div class="sv-sbar-fill" style="width:${barW}%;background:${barC}"></div></div>
        <span class="sv-sbar-pct" style="color:${barC}">${barW}%</span>
      </div>`;
    });

    // ── Main chart: multi-energy over period ──
    const periods = [{id:'7',l:'7j'},{id:'30',l:'30j'},{id:'90',l:'3m'},{id:'365',l:'1an'}];
    const chartDates = Array.from({length: days}, (_,i) => _daysAgo(days-1-i));
    const chartDS = ['eau_froide','eau_chaude','electricite','chauffage'].map(type => {
      const meta = MT[type];
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      return { vals: chartDates.map(ds => _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s,r) => s+(r.consumption||0), 0)), color: meta.color, label: `${meta.icon} ${meta.label}` };
    });
    const hasChartData = chartDS.some(d => d.vals.some(v => v > 0));
    const chartXLabels = chartDates.map((ds,i) => i % Math.ceil(days/6) === 0 ? ds.slice(5) : '');

    // ── Alert timeline (smart + saved, desc) ──
    const nowDt = new Date();
    const tlItems = [];
    smartAlerts.forEach((a, salIdx) => {
      const meta = MT[a.metric] || {};
      tlItems.push({ ts: nowDt, level: a.level, title: a.title, msg: a.msg, icon: meta.icon||'⚡', zone: a.zone||'', isSmart: true, salIdx, id: null });
    });
    _csoAlerts.filter(a => !a.acknowledged && a.status !== 'resolved').forEach(a => {
      const d = _tsDate(a.ts || a.createdAt);
      const meta = MT[a.type] || MT[a.metric] || {};
      tlItems.push({ ts: d || nowDt, level: a.level, title: a.title||a.type, msg: a.msg||a.message||'', icon: meta.icon||'⚡', zone: a.zone||'', isSmart: false, salIdx: null, id: a.id });
    });
    tlItems.sort((a, b) => b.ts - a.ts);
    let tlHtml = '';
    tlItems.slice(0, 15).forEach(item => {
      const lvlC = item.level === 'critical' ? '#f87171' : item.level === 'warning' ? '#f59e0b' : '#34d399';
      const tmStr = item.ts.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
      const dtStr = item.ts.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'});
      const actBtns = item.isSmart
        ? `<button class="sv-tl-act" onclick="MX.Pages.Conso._salSave(${item.salIdx})" title="Sauvegarder"><i class="fas fa-floppy-disk"></i></button>
           <button class="sv-tl-act" onclick="MX.Pages.Conso._salCreateInt(${item.salIdx})" title="Créer intervention"><i class="fas fa-screwdriver-wrench"></i></button>`
        : `<button class="sv-tl-act" onclick="MX.Pages.Conso._resolveAlert('${esc(item.id)}')" title="Résoudre"><i class="fas fa-check"></i></button>`;
      tlHtml += `<div class="sv-tl-item sv-tl--${item.level}">
        <div class="sv-tl-line"><span class="sv-tl-dot" style="background:${lvlC}"></span></div>
        <div class="sv-tl-body">
          <div class="sv-tl-ttl">${item.icon} ${esc(item.title)}</div>
          <div class="sv-tl-msg">${esc(item.msg)}</div>
          ${item.zone ? `<div class="sv-tl-zone"><i class="fas fa-location-dot"></i> ${esc(item.zone)}</div>` : ''}
        </div>
        <div class="sv-tl-meta">
          <span class="sv-tl-time">${dtStr} ${tmStr}</span>
          <div class="sv-tl-acts">${actBtns}</div>
        </div>
      </div>`;
    });

    // ── Intelligent suggestions (critical only) ──
    const critAlerts = smartAlerts.filter(a => a.level === 'critical');
    let sugHtml = '';
    critAlerts.forEach((a, ci) => {
      const meta = MT[a.metric] || {};
      const sugs = (_SUG[a.metric] || _SUG.default).slice(0, 4);
      const salI = smartAlerts.indexOf(a);
      sugHtml += `<div class="sv-suggest-card" style="--sc:${meta.color||'#06B6D4'}">
        <div class="sv-suggest-hd">${meta.icon||'⚡'} ${esc(a.title)}</div>
        <div class="sv-suggest-ecart" style="color:#f87171">+${a.ecart||0}% vs moy. 30j</div>
        <ul class="sv-suggest-list">${sugs.map(s => `<li><i class="fas fa-chevron-right"></i> ${esc(s)}</li>`).join('')}</ul>
        <button class="sv-suggest-btn" onclick="MX.Pages.Conso._salCreateInt(${salI})"><i class="fas fa-screwdriver-wrench"></i> Créer intervention</button>
      </div>`;
    });

    // ── Heatmap: 30 days × 4 energy types ──
    const hmTypes = ['eau_froide','eau_chaude','electricite','chauffage'];
    const hmDays = 30;
    const hmCells = [];
    const hmColLabels = Array.from({length: hmDays}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate() - (hmDays-1-i));
      return i % 5 === 0 ? `${d.getDate()}/${d.getMonth()+1}` : '';
    });
    const hmRowLabels = hmTypes.map(t => MT[t]?.icon || t);
    hmTypes.forEach((type, row) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      const vals = Array.from({length:hmDays}, (_,i) => _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(hmDays-1-i)).reduce((s,r) => s+(r.consumption||0), 0));
      const nz = vals.filter(v => v > 0);
      const avg = nz.length ? nz.reduce((a,b) => a+b, 0)/nz.length : 0;
      vals.forEach((v, col) => {
        const lvl = v === 0 ? 'none' : avg === 0 ? 'ok' : v > avg*1.5 ? 'crit' : v > avg*1.2 ? 'warn' : 'ok';
        hmCells.push({row, col, level: lvl, val: avg > 0 ? Math.min(1, v/avg) : 0});
      });
    });

    // ── History table ──
    const histItems = [..._csoAlerts].slice(0, 12);
    let histRows = '';
    histItems.forEach(a => {
      const d = _tsDate(a.ts || a.createdAt);
      const ds = d ? d.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}) : '—';
      const meta = MT[a.type] || MT[a.metric] || {};
      const lvlC = a.level === 'critical' ? '#f87171' : a.level === 'warning' ? '#f59e0b' : '#34d399';
      histRows += `<div class="sv-hist-row${a.acknowledged ? ' sv-hist-ack' : ''}">
        <span class="sv-hist-ico" style="color:${meta.color||lvlC}">${meta.icon||'⚡'}</span>
        <div class="sv-hist-body">
          <div class="sv-hist-ttl">${esc(a.title||a.type||'')}</div>
          ${a.zone ? `<div class="sv-hist-zone"><i class="fas fa-location-dot"></i> ${esc(a.zone)}</div>` : ''}
        </div>
        <div class="sv-hist-right">
          <span class="sv-hist-date">${ds}</span>
          ${a.acknowledged
            ? `<span class="sv-hist-done"><i class="fas fa-check"></i></span>`
            : `<button class="sv-tl-act" onclick="MX.Pages.Conso._resolveAlert('${esc(a.id)}')"><i class="fas fa-check"></i></button>`}
        </div>
      </div>`;
    });

    return `<div class="cso-inner sv-page">

      <div class="sv-header">
        <div class="sv-header-left">
          <i class="fas fa-shield-halved" style="color:var(--cyan);font-size:20px"></i>
          <div>
            <div class="sv-header-ttl">Centre de Supervision Énergétique</div>
            <div class="sv-header-sub">${_dateLbl(today)} · ${_meters.length} compteur${_meters.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="sv-header-badges">
          ${totalCrit > 0 ? `<span class="sv-badge sv-badge--crit"><i class="fas fa-triangle-exclamation"></i> ${totalCrit} critique${totalCrit > 1 ? 's' : ''}</span>` : ''}
          ${totalWarn > 0 ? `<span class="sv-badge sv-badge--warn"><i class="fas fa-exclamation-circle"></i> ${totalWarn} attention${totalWarn > 1 ? 's' : ''}</span>` : ''}
          ${totalCrit === 0 && totalWarn === 0 ? `<span class="sv-badge sv-badge--ok"><i class="fas fa-check-circle"></i> Tout normal</span>` : ''}
        </div>
      </div>

      <div class="sv-top-row">
        <div class="sv-score-card">
          <div class="sv-score-gauge">${scoreSVG}</div>
          <div class="sv-score-info">
            <div class="sv-score-ttl">Score Énergie</div>
            <div class="sv-score-sub" style="color:${scoreColor}">${scoreSub}</div>
            <div class="sv-score-bars">${scoreBars}</div>
          </div>
        </div>
        <div class="sv-energy-grid">${energyCards || '<div class="cso-chart2-empty" style="grid-column:1/-1">Aucun compteur configuré — <button class="cso-add-btn" onclick="MX.Pages.Conso._tab(\'compteurs\')">Ajouter</button></div>'}</div>
      </div>

      <div class="ra-chart-block">
        <div class="sv-chart-head">
          <span><i class="fas fa-chart-line"></i> Évolution des consommations</span>
          <div class="cso-chart2-per">${periods.map(p => `<button class="cso-per-btn${per === p.id ? ' active' : ''}" onclick="window._csoSupPer='${p.id}';MX.Pages.Conso._tab('alertes')">${p.l}</button>`).join('')}</div>
        </div>
        <div class="ra-chart-leg">${chartDS.map(d => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text2)"><span style="width:10px;height:2px;background:${d.color};display:inline-block;border-radius:1px"></span>${d.label}</span>`).join('')}</div>
        ${hasChartData ? _supLineSVG(chartDS, chartXLabels, 220) : '<div class="cso-chart2-empty">Aucune donnée sur la période</div>'}
      </div>

      <div class="sv-timeline">
        <div class="sv-section-ttl"><i class="fas fa-clock"></i> Chronologie des alertes <span class="sv-cnt">${tlItems.length}</span></div>
        ${tlHtml || '<div class="cso-chart2-empty"><i class="fas fa-check-circle" style="color:#34d399;font-size:20px"></i><br>Aucune anomalie active</div>'}
      </div>

      ${critAlerts.length > 0 ? `<div class="sv-section--crit">
        <div class="sv-section-ttl"><i class="fas fa-robot"></i> Suggestions intelligentes <span class="sv-cnt">${critAlerts.length}</span></div>
        <div class="sv-suggest-grid">${sugHtml}</div>
      </div>` : ''}

      <div class="sv-row2">
        <div class="sv-section">
          <div class="sv-section-ttl"><i class="fas fa-th"></i> Heatmap 30 jours</div>
          ${_heatmapSVG(hmCells, hmRowLabels, hmColLabels, hmTypes.length, hmDays)}
        </div>
        <div class="sv-section">
          <div class="sv-section-ttl"><i class="fas fa-clock-rotate-left"></i> Historique <span class="sv-cnt">${histItems.length}</span></div>
          <div class="sv-hist-list">
            ${histRows || '<div class="cso-chart2-empty" style="padding:16px">Aucune alerte enregistrée</div>'}
          </div>
        </div>
      </div>

    </div>`;
  }

  // ── TAB: EXPORTS ──
  function _tExports() {
    const today = _today();
    const from  = _daysAgo(30);
    return `<div class="cso-inner">
      <div class="cso-ph">
        <div class="cso-ph-ttl"><i class="fas fa-file-export"></i> Exporter les données</div>
      </div>
      <div class="cso-export-form">
        <label class="cso-exp-lbl">Période</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <input type="date" id="cso-ef" class="fi" value="${from}" style="width:155px">
          <span style="align-self:center;color:var(--text2)">→</span>
          <input type="date" id="cso-et" class="fi" value="${today}" style="width:155px">
        </div>
        <label class="cso-exp-lbl">Compteurs</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
          <label class="cso-ck-lbl"><input type="checkbox" id="cso-eall" onchange="MX.Pages.Conso._allMeters(this)" checked> Tous</label>
          ${_meters.map(m => {
            const meta = MT[m.type] || MT.eau_froide;
            return `<label class="cso-ck-lbl"><input type="checkbox" class="cso-mcb" value="${m.id}" checked> ${meta.icon} ${esc(m.name)}</label>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="primary-btn" style="width:auto;padding:11px 20px" onclick="MX.Pages.Conso._csv()">
            <i class="fas fa-file-csv"></i> CSV
          </button>
          <button class="primary-btn" style="width:auto;padding:11px 20px;background:var(--red);border-color:var(--red)" onclick="MX.Pages.Conso._pdf()">
            <i class="fas fa-file-pdf"></i> PDF
          </button>
        </div>
      </div>
    </div>`;
  }

  // ── EMPTY STATE ──
  function _empty(icon, msg) {
    return `<div class="cso-empty"><i class="fas ${icon}"></i><p>${msg}</p></div>`;
  }

  // ── ACTIONS: CLIENTS ──
  function _editCli(date, current) {
    MX.showModal({
      title: '👥 Clients présents',
      sub: `<div style="color:var(--text2);margin-bottom:4px">${_dateLbl(date)}</div>`,
      body: `<input type="number" id="cso-cli-inp" class="fi" min="0" max="9999" value="${current || ''}" placeholder="Ex: 150" style="text-align:center;font-size:28px;font-family:var(--ffm)">`,
      actions: [
        { label: 'Enregistrer', cls: 'confirm', fn: async () => {
          const v = parseInt(document.getElementById('cso-cli-inp')?.value || '');
          if (isNaN(v) || v < 0) return;
          await CSO.clients().doc(date).set({ date, count: v, updatedAt: FV.serverTimestamp() });
          // Mise à jour locale immédiate : la valeur vient d'être écrite avec
          // certitude, inutile d'attendre un éventuel rafraîchissement — et
          // nécessaire si `date` est hors de la fenêtre du listener live
          // (_clientsLiveCap jours), sans quoi elle resterait invisible tant
          // qu'aucune requête complémentaire n'est déclenchée.
          _clients[date] = v; _clientsExtDates.add(date);
          MX.toast('Clients mis à jour');
          _rerender();
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => { const el = document.getElementById('cso-cli-inp'); if (el) { el.focus(); el.select(); } }, 80);
  }

  // ── ACTIONS: METER FORM ──
  function _meterForm(id) {
    if (!_isResp()) { MX.toast('Action réservée au responsable', true); return; }
    const m    = id ? _meters.find(x => x.id === id) : null;
    const opts = Object.entries(MT).map(([k, v]) => `<option value="${k}"${m?.type===k?' selected':''}>${v.icon} ${v.label}</option>`).join('');
    MX.showModal({
      title: m ? 'Modifier le compteur' : 'Nouveau compteur',
      sub: '',
      body: `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
        <input id="cso-mn" class="fi" placeholder="Nom *" value="${esc(m?.name||'')}" maxlength="60">
        <select id="cso-mt" class="fi">${opts}</select>
        <input id="cso-ml" class="fi" placeholder="Emplacement" value="${esc(m?.location||'')}" maxlength="60">
        <input id="cso-mu" class="fi" placeholder="Unité (laisser vide = défaut)" value="${esc(m?.unit||'')}" maxlength="10">
        <div style="border-top:1px solid var(--border2);margin-top:4px;padding-top:10px;display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2);cursor:pointer">
            <input type="checkbox" id="cso-mae" ${m?.alertEnabled === false ? '' : 'checked'}>
            Détection de surconsommation active
          </label>
          <select id="cso-mam" class="fi">
            <option value="auto"${m?.alertMode !== 'manual' ? ' selected' : ''}>Référence automatique (moyenne de l'historique)</option>
            <option value="manual"${m?.alertMode === 'manual' ? ' selected' : ''}>Seuil manuel</option>
          </select>
          <input id="cso-mar" class="fi" type="number" step="0.01" min="0" placeholder="Seuil manuel (unité / 24h)" value="${m?.alertManualRef != null ? m.alertManualRef : ''}">
          <input id="cso-mad" class="fi" type="number" step="1" min="3" placeholder="Jours d'historique pour la référence auto (défaut 30)" value="${m?.alertRefDays != null ? m.alertRefDays : ''}">
        </div>
      </div>`,
      actions: [
        { label: m ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: async () => {
          const name = document.getElementById('cso-mn')?.value?.trim();
          const type = document.getElementById('cso-mt')?.value;
          const loc  = document.getElementById('cso-ml')?.value?.trim();
          const unit = document.getElementById('cso-mu')?.value?.trim() || MT[type]?.unit || 'm³';
          if (!name) { MX.toast('Le nom est requis', true); return; }
          const alertEnabled   = document.getElementById('cso-mae')?.checked !== false;
          const alertMode      = document.getElementById('cso-mam')?.value === 'manual' ? 'manual' : 'auto';
          const alertManualRaw = document.getElementById('cso-mar')?.value;
          const alertDaysRaw   = document.getElementById('cso-mad')?.value;
          const data = {
            name, type, location: loc || '', unit, updatedAt: FV.serverTimestamp(),
            alertEnabled, alertMode,
            alertManualRef: alertManualRaw ? parseFloat(alertManualRaw) : null,
            alertRefDays:   alertDaysRaw   ? parseInt(alertDaysRaw, 10) : null,
          };
          if (m) {
            await CSO.meters().doc(id).update(data);
            // Disabling detection turns the voyant off immediately — the server-side
            // detector only re-evaluates on the next reading, which may not come soon.
            if (!alertEnabled) {
              await CSO.alerts().doc(`overconsumption_${id}`).set({
                status: 'resolved', resolvedAt: FV.serverTimestamp(), resolvedBy: _author(), resolvedReason: 'disabled',
              }, { merge: true }).catch(() => {});
            }
            MX.toast('Compteur mis à jour');
          }
          else { await CSO.meters().add({ ...data, createdAt: FV.serverTimestamp() }); MX.toast('Compteur créé'); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('cso-mn')?.focus(), 80);
  }

  function _delMeter(id, name) {
    // ── Role guard ──
    if (!_isResp()) {
      _logActivity('delete_refused', id, name, false);
      MX.showModal({
        title: '<i class="fas fa-lock" style="color:#EF4444"></i> Accès refusé',
        body: `<div style="text-align:center;padding:12px 0">
          <div style="font-size:40px;margin-bottom:12px">🔒</div>
          <p style="color:var(--text);font-weight:600;margin-bottom:6px">Action réservée au Responsable</p>
          <p style="color:var(--text3);font-size:13px">Seul un responsable peut supprimer un compteur.<br>Votre tentative a été enregistrée dans le journal.</p>
        </div>`,
        actions: [{ label: 'Compris', cls: 'cancel' }],
      });
      return;
    }

    // ── Protection : compteur avec données ──
    const rdgCount   = _readings.filter(r => r.meterId === id).length;
    const alertCount = _csoAlerts.filter(a => a.meterId === id || _meters.find(m => m.id === id && a.metric === m.type)).length;
    const hasData    = rdgCount > 0;

    if (hasData) {
      MX.showModal({
        title: '<i class="fas fa-shield-halved" style="color:#F59E0B"></i> Suppression impossible',
        body: `<div style="padding:4px 0">
          <p style="color:var(--text);font-weight:600;margin-bottom:10px">Ce compteur contient des données historiques.</p>
          <p style="color:var(--text3);font-size:13px;margin-bottom:14px">Pour préserver l'intégrité des analyses, il ne peut pas être supprimé.</p>
          <div class="cso-del-data-list">
            ${rdgCount ? `<div class="cso-del-data-row"><i class="fas fa-check" style="color:#22C55E"></i> ${rdgCount} relevé${rdgCount>1?'s':''} enregistré${rdgCount>1?'s':''}</div>` : ''}
            ${alertCount ? `<div class="cso-del-data-row"><i class="fas fa-check" style="color:#22C55E"></i> Alertes associées</div>` : ''}
          </div>
          <div class="cso-del-arch-tip"><i class="fas fa-box-archive"></i> Vous pouvez uniquement l'<strong>archiver</strong> pour le masquer tout en conservant l'historique.</div>
        </div>`,
        actions: [
          { label: '<i class="fas fa-box-archive"></i> Archiver', cls: 'confirm', fn: () => _archiveMeter(id, name) },
          { label: 'Annuler', cls: 'cancel' },
        ],
      });
      return;
    }

    // ── Confirmation multi-étapes ──
    _delMeterConfirm(id, name);
  }

  function _delMeterConfirm(id, name) {
    const inputId = 'cso-del-confirm-inp';
    const btnId   = 'cso-del-confirm-btn';
    MX.showModal({
      title: '<i class="fas fa-triangle-exclamation" style="color:#EF4444"></i> Supprimer ce compteur ?',
      body: `<div class="cso-del-modal-body">
        <div class="cso-del-warn-box">
          <div class="cso-del-meter-name"><i class="fas fa-gauge-high"></i> ${esc(name)}</div>
          <p style="color:var(--text3);font-size:13px;margin:10px 0 4px">Cette action supprimera définitivement :</p>
          <ul class="cso-del-list">
            <li>tous les relevés associés</li>
            <li>l'historique complet</li>
            <li>les graphiques</li>
            <li>les ratios calculés</li>
            <li>les alertes liées</li>
          </ul>
          <div class="cso-del-irreversible"><i class="fas fa-exclamation-circle"></i> Cette action est irréversible.</div>
        </div>
        <div class="cso-del-confirm-wrap">
          <label class="cso-del-confirm-lbl">Pour confirmer, saisissez le nom du compteur :</label>
          <div class="cso-del-confirm-hint">${esc(name)}</div>
          <input id="${inputId}" class="cso-del-confirm-inp" type="text" placeholder="${esc(name)}" autocomplete="off"
            oninput="(function(v){var b=document.getElementById('${btnId}');if(b)b.disabled=v.trim()!==decodeURIComponent('${encodeURIComponent(name)}')})(this.value)">
        </div>
      </div>`,
      actions: [
        { label: '<i class="fas fa-trash"></i> Supprimer définitivement', cls: 'danger', id: btnId, disabled: true, fn: async () => {
          const inp = document.getElementById(inputId);
          if (!inp || inp.value.trim() !== name) { MX.toast('Nom incorrect', true); return; }
          if (!_isResp()) { MX.toast('Accès refusé', true); return; }
          const snap = await CSO.readings().where('meterId', '==', id).get();
          const b = db.batch();
          snap.docs.forEach(d => b.delete(d.ref));
          b.delete(CSO.meters().doc(id));
          await b.commit();
          _logActivity('delete', id, name, true);
          MX.toast('Compteur supprimé');
        }},
        { label: 'Annuler', cls: 'cancel' },
      ],
    });
  }

  function _archiveMeter(id, name) {
    if (!_isResp()) { MX.toast('Accès refusé', true); return; }
    MX.showModal('Archiver ce compteur', `<div style="color:var(--text3);font-size:13px">
      <p style="margin-bottom:10px">Le compteur <strong style="color:var(--text)">${esc(name)}</strong> sera masqué de la liste active.</p>
      <ul class="cso-del-list">
        <li>L'historique et les relevés sont conservés</li>
        <li>Les ratios et graphiques restent accessibles</li>
        <li>Vous pourrez le restaurer à tout moment</li>
      </ul>
    </div>`, [
      { label: '<i class="fas fa-box-archive"></i> Archiver', cls: 'confirm', fn: async () => {
        await CSO.meters().doc(id).update({ archived: true, archivedAt: FV.serverTimestamp(), archivedBy: _author() });
        _logActivity('archive', id, name, true);
        MX.toast('Compteur archivé');
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]);
  }

  function _restoreMeter(id, name) {
    if (!_isResp()) { MX.toast('Accès refusé', true); return; }
    MX.showModal('Restaurer ce compteur', `Remettre <strong>${esc(name)}</strong> dans la liste active ?`, [
      { label: '<i class="fas fa-rotate-left"></i> Restaurer', cls: 'confirm', fn: async () => {
        await CSO.meters().doc(id).update({ archived: false, archivedAt: FV.delete(), archivedBy: FV.delete() });
        _logActivity('restore', id, name, true);
        MX.toast('Compteur restauré');
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]);
  }

  function _delMeterPermanent(id, name) {
    if (!_isResp()) { MX.toast('Accès refusé', true); return; }
    const inputId = 'cso-delp-inp';
    const btnId   = 'cso-delp-btn';
    MX.showModal({
      title: '<i class="fas fa-skull-crossbones" style="color:#EF4444"></i> Suppression définitive',
      body: `<div class="cso-del-modal-body">
        <div class="cso-del-warn-box">
          <div class="cso-del-meter-name"><i class="fas fa-box-archive"></i> ${esc(name)}</div>
          <p style="color:var(--text3);font-size:13px;margin:10px 0 4px">Suppression définitive de l'archive et de toutes ses données :</p>
          <ul class="cso-del-list">
            <li>Tous les relevés archivés</li>
            <li>L'historique complet</li>
          </ul>
          <div class="cso-del-irreversible"><i class="fas fa-exclamation-circle"></i> Cette action est irréversible.</div>
        </div>
        <div class="cso-del-confirm-wrap">
          <label class="cso-del-confirm-lbl">Saisissez le nom pour confirmer :</label>
          <div class="cso-del-confirm-hint">${esc(name)}</div>
          <input id="${inputId}" class="cso-del-confirm-inp" type="text" placeholder="${esc(name)}" autocomplete="off"
            oninput="(function(v){var b=document.getElementById('${btnId}');if(b)b.disabled=v.trim()!==decodeURIComponent('${encodeURIComponent(name)}')})(this.value)">
        </div>
      </div>`,
      actions: [
        { label: '<i class="fas fa-skull-crossbones"></i> Supprimer définitivement', cls: 'danger', id: btnId, disabled: true, fn: async () => {
          const inp = document.getElementById(inputId);
          if (!inp || inp.value.trim() !== name) { MX.toast('Nom incorrect', true); return; }
          if (!_isResp()) { MX.toast('Accès refusé', true); return; }
          const snap = await CSO.readings().where('meterId', '==', id).get();
          const b = db.batch();
          snap.docs.forEach(d => b.delete(d.ref));
          b.delete(CSO.meters().doc(id));
          await b.commit();
          _logActivity('delete_permanent', id, name, true);
          MX.toast('Compteur supprimé définitivement');
        }},
        { label: 'Annuler', cls: 'cancel' },
      ],
    });
  }

  function _editReading(id) {
    if (!_isResp()) {
      _logActivity('edit_reading_denied', null, null, false);
      MX.showModal({
        title: '<i class="fas fa-lock" style="color:#EF4444"></i> Accès refusé',
        body: `<div style="text-align:center;padding:12px 0">
          <div style="font-size:36px;margin-bottom:10px">🔒</div>
          <p style="color:var(--text);font-weight:600;margin-bottom:6px">Action réservée au Responsable</p>
          <p style="color:var(--text3);font-size:13px">Seul un responsable peut modifier un relevé.<br>Votre tentative a été enregistrée dans le journal.</p>
        </div>`,
        actions: [{ label: 'Compris', cls: 'cancel' }],
      });
      return;
    }
    const r = _readings.find(x => x.id === id);
    if (!r) return;
    const m    = _meters.find(x => x.id === r.meterId);
    if (!m) return;
    const meta = MT[m.type] || MT.eau_froide;
    const unit = m.unit || meta.unit;
    MX.showModal({
      title: `<i class="fas fa-pen" style="color:${meta.color}"></i> Modifier le relevé`,
      sub: `${esc(r.meterName || m.name)} · ${_dateLbl(r.date)}`,
      body: `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg3);border-radius:8px;font-size:13px">
          <span style="color:var(--text3)">Index actuel</span>
          <span style="font-family:var(--ffm);font-weight:700;color:var(--text)">${_fmtIdx(r.index)} <span style="color:var(--text3)">${esc(unit)}</span></span>
        </div>
        <label style="color:var(--text2);font-size:13px;font-weight:500">Nouvel index</label>
        <input type="number" id="cso-ei" class="fi" step="0.001" value="${r.index}"
          style="text-align:center;font-size:22px;font-family:var(--ffm)">
        <label style="color:var(--text2);font-size:13px;font-weight:500">Motif de la correction <span style="color:#EF4444">*</span></label>
        <input type="text" id="cso-em" class="fi" placeholder="Ex : erreur de saisie, remise à zéro…" maxlength="200">
        <div style="font-size:11px;color:var(--text3);padding:4px 0">
          <i class="fas fa-info-circle"></i> La modification recalculera automatiquement toutes les consommations de ce compteur.
        </div>
      </div>`,
      actions: [
        { label: '<i class="fas fa-calculator"></i> Enregistrer & recalculer', cls: 'confirm', fn: () => _doEditReading(id, r) },
        { label: 'Annuler', cls: 'cancel' },
      ],
    });
  }

  async function _doEditReading(id, r) {
    const newIndexRaw = document.getElementById('cso-ei')?.value;
    const motif       = (document.getElementById('cso-em')?.value || '').trim();
    const newIndex    = parseFloat(newIndexRaw);

    if (!newIndexRaw || isNaN(newIndex)) { MX.toast('Saisissez le nouvel index', true); return; }
    if (!motif)                          { MX.toast('Le motif est obligatoire', true); return; }
    if (newIndex === r.index)            { MX.toast('L\'index n\'a pas changé', true); return; }

    const m = _meters.find(x => x.id === r.meterId);
    if (!m) return;

    _showRecalcProgress('Mise à jour de l\'index… ███░░░');
    try {
      await CSO.readings().doc(id).update({
        index:     newIndex,
        consumption: null,
        editedAt:  FV.serverTimestamp(),
        editedBy:  _author(),
        motif,
      });
      _logReadingEdit(r.meterId, r.meterName || m.name, r.index, newIndex, motif);
      _showRecalcProgress('Recalcul des analyses… ███████');
      await recalculateConsumption(r.meterId);
      _hideRecalcProgress();
      MX.toast('Relevé modifié · Recalcul terminé');
    } catch(e) {
      _hideRecalcProgress();
      MX.toast('Erreur lors de la modification', true);
      console.error(e);
    }
  }

  // ── _flushRecalcWaiters — resolve/reject all Promises waiting on a meter ──
  function _flushRecalcWaiters(meterId, err) {
    const waiters = _recalcWaiters.get(meterId) || [];
    _recalcWaiters.delete(meterId);
    waiters.forEach(({ resolve, reject }) => err ? reject(err) : resolve());
  }

  // ── recalculateConsumption — unified entry point ──────────────────────────
  // Called automatically after every create / edit / delete of a reading.
  // Uses per-meter locking so different meters recalculate in parallel, and
  // a pending queue so a mid-recalc modification is never silently dropped.
  // Returns a Promise that resolves only after the recalc actually completes,
  // even when a recalc is already in progress for the same meter (waiter pattern).
  function recalculateConsumption(meterId) {
    if (!meterId) return Promise.resolve();
    if (_recalcLocks.has(meterId)) {
      // Recalc in progress — queue one re-run and return a Promise that resolves
      // after that re-run finishes (not immediately).
      _recalcPending.add(meterId);
      return new Promise((resolve, reject) => {
        const list = _recalcWaiters.get(meterId) || [];
        _recalcWaiters.set(meterId, [...list, { resolve, reject }]);
      });
    }
    _recalcLocks.add(meterId);
    return _recalcMeter(meterId)
      .then(() => {
        _invalidateExtReadings(meterId);
        // Flush waiters only when there is no pending re-run queued — otherwise
        // the pending re-run will flush them once it completes.
        if (!_recalcPending.has(meterId)) _flushRecalcWaiters(meterId);
      })
      .catch(e => {
        _flushRecalcWaiters(meterId, e);
        throw e;
      })
      .finally(() => {
        _recalcLocks.delete(meterId);
        if (_recalcPending.has(meterId)) {
          _recalcPending.delete(meterId);
          // Run once more to pick up any change that arrived mid-recalc
          setTimeout(() => recalculateConsumption(meterId), 0);
        }
      });
  }

  async function _recalcMeter(meterId) {
    const snap = await CSO.readings().where('meterId', '==', meterId).get();
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort chronologically; within the same date, older createdAt comes first
    all.sort((a, b) => {
      if ((a.date || '') < (b.date || '')) return -1;
      if ((a.date || '') > (b.date || '')) return 1;
      return _tsMs(a.createdAt) - _tsMs(b.createdAt);
    });

    const CHUNK = 499;
    let batchStart   = 0;
    let lastIndex    = null;
    let newLastIndex = null;

    while (batchStart < all.length) {
      const b     = db.batch();
      const chunk = all.slice(batchStart, batchStart + CHUNK);
      chunk.forEach(r => {
        const newCons = (lastIndex !== null && r.index != null && r.index >= lastIndex)
          ? Math.round((r.index - lastIndex) * 1000) / 1000
          : null;
        b.update(CSO.readings().doc(r.id), { consumption: newCons });
        if (r.index != null) { lastIndex = r.index; newLastIndex = r.index; }
      });
      await b.commit();
      batchStart += CHUNK;
    }

    if (newLastIndex !== null) {
      await CSO.meters().doc(meterId).update({ lastIndex: newLastIndex });
    }
  }

  function _delReading(id) {
    // Look up meterId BEFORE the modal so it's captured in the closure after deletion
    const _delR    = _readings.find(x => x.id === id);
    const _delMId  = _delR ? _delR.meterId : null;
    MX.showModal('Supprimer le relevé', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        await CSO.readings().doc(id).delete();
        MX.toast('Relevé supprimé');
        // Recalculate all consumptions for the meter so subsequent readings update
        if (_delMId) recalculateConsumption(_delMId).catch(e => console.error('[CSO] recalcDel:', e));
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _showPhoto(id) {
    const r = _readings.find(x => x.id === id);
    if (!r?.photoB64) return;
    MX.showModal({
      title: 'Photo du relevé',
      sub: `${esc(r.meterName || '')} · ${_dateLbl(r.date)}`,
      body: `<img src="${r.photoB64}" style="width:100%;max-height:380px;object-fit:contain;border-radius:8px">`,
      actions: [{ label: 'Fermer', cls: 'cancel' }]
    });
  }

  function _meterHistory(id) {
    const m = _meters.find(x => x.id === id);
    if (!m) return;
    const meta = MT[m.type] || MT.eau_froide;
    const unit = m.unit || meta.unit;
    const mReadings = _readings.filter(r => r.meterId === id).slice(0, 30);
    let rows = '';
    if (!mReadings.length) {
      rows = '<div style="text-align:center;color:var(--text3);padding:28px 0">Aucun relevé enregistré</div>';
    } else {
      mReadings.forEach(r => {
        const d    = _tsDate(r.createdAt);
        const time = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
        rows += `<div class="cso-hist-row">
          <div class="cso-hist-date">${_dateLbl(r.date)}<span class="cso-hist-time">${time}</span></div>
          <div class="cso-hist-idx">${_fmtIdx(r.index)}<span class="cso-hist-u"> ${esc(unit)}</span></div>
          <div class="cso-hist-conso">${r.consumption != null ? `+${_fmtIdx(r.consumption)}` : '—'}</div>
          <div class="cso-hist-tech">${esc(r.technicienName || '')}</div>
        </div>`;
      });
    }
    MX.showModal({
      title: `${meta.icon} ${esc(m.name)}`,
      sub: `Historique${m.location ? ' · ' + esc(m.location) : ''} · ${mReadings.length} relevés`,
      body: `<div class="cso-hist-hdr"><span>Date</span><span>Index</span><span>Conso.</span><span>Technicien</span></div>
             <div class="cso-hist-list">${rows}</div>`,
      actions: [{ label: 'Fermer', cls: 'cancel' }]
    });
  }

  // ── NEW READING WORKFLOW ──
  function _newReading(preId) {
    _photoB64 = null;
    if (!_meters.length) {
      MX.toast('Créez d\'abord un compteur', true);
      _tab('compteurs');
      return;
    }
    const opts = _meters.map(m => {
      const meta = MT[m.type] || MT.eau_froide;
      return `<option value="${m.id}"${m.id===preId?' selected':''}>${meta.icon} ${esc(m.name)}</option>`;
    }).join('');
    const inQueue = _relQueue.length > 0 && _relQueueIdx < _relQueue.length;
    const title   = inQueue ? `📷 Relevé ${_relQueueIdx + 1}/${_relQueue.length}` : '📷 Nouveau relevé';

    MX.showModal({
      title,
      sub: '',
      body: `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
        <select id="cso-rm" class="fi">${opts}</select>
        <input type="date" id="cso-rd" class="fi" value="${_csoSelDate || _today()}">
        <input type="number" id="cso-ri" class="fi" step="0.001" placeholder="Index (ex: 12547)"
          style="text-align:center;font-size:22px;font-family:var(--ffm)">
        <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px dashed var(--border2);border-radius:10px;cursor:pointer;color:var(--text2);font-size:13px">
          <i class="fas fa-camera"></i> Photo du compteur (optionnel — conservée 7 jours)
          <input type="file" accept="image/*" capture="environment" id="cso-rp" onchange="MX.Pages.Conso._onPhoto(this)" style="display:none">
        </label>
        <img id="cso-rp-prev" style="display:none;width:100%;max-height:180px;object-fit:contain;border-radius:8px;border:1px solid var(--border2)">
      </div>`,
      actions: [
        { label: inQueue && _relQueueIdx < _relQueue.length - 1 ? `Enregistrer (${_relQueueIdx+1}/${_relQueue.length}) →` : 'Enregistrer', cls: 'confirm', fn: _saveReading },
        { label: 'Annuler', cls: 'cancel', fn: () => { _photoB64 = null; _relQueue = []; _relQueueIdx = 0; } }
      ]
    });
    setTimeout(() => document.getElementById('cso-ri')?.focus(), 100);
  }

  async function _onPhoto(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      _photoB64 = await _compress(file, 400, 400, 0.65);
      const prev = document.getElementById('cso-rp-prev');
      if (prev) { prev.src = _photoB64; prev.style.display = 'block'; }
    } catch(e) { MX.toast('Erreur lecture photo', true); }
  }

  function _compress(file, mW, mH, q) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > mW) { h = Math.round(h * mW / w); w = mW; }
        if (h > mH) { w = Math.round(w * mH / h); h = mH; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function _saveReading() {
    const meterId  = document.getElementById('cso-rm')?.value;
    const dateStr  = document.getElementById('cso-rd')?.value;
    const indexRaw = document.getElementById('cso-ri')?.value;
    const index    = parseFloat(indexRaw);

    if (!meterId)               { MX.toast('Sélectionnez un compteur', true); return; }
    if (!dateStr)               { MX.toast('Sélectionnez une date', true); return; }
    if (!indexRaw || isNaN(index)) { MX.toast('Saisissez l\'index', true); return; }

    const m = _meters.find(x => x.id === meterId);
    if (!m) return;

    const prev = _readings.find(r => r.meterId === meterId && r.date <= dateStr && r.index < index)
              || _readings.find(r => r.meterId === meterId);
    const consumption = (prev && prev.index <= index) ? Math.round((index - prev.index) * 1000) / 1000 : null;

    const expAt = new Date(); expAt.setDate(expAt.getDate() + 7);
    try {
      await CSO.readings().add({
        meterId, meterName: m.name, meterType: m.type,
        index, consumption,
        technicienName: _author(),
        date: dateStr,
        createdAt:      FV.serverTimestamp(),
        photoB64:       _photoB64 || null,
        photoExpiresAt: _photoB64 ? firebase.firestore.Timestamp.fromDate(expAt) : null,
      });
      await CSO.meters().doc(meterId).update({ lastIndex: index, lastReadAt: FV.serverTimestamp() });
      _photoB64 = null;
      MX.toast(consumption !== null ? `Relevé enregistré · +${_fmtIdx(consumption)} ${m.unit}` : 'Relevé enregistré');
      // Recalculate ALL consumptions for this meter to keep subsequent readings consistent
      recalculateConsumption(meterId).catch(e => console.error('[CSO] recalcSave:', e));
      if (_relQueue.length && _relQueueIdx < _relQueue.length) {
        _relQueueIdx++;
        setTimeout(() => _nextQueueReading(), 600);
      }
    } catch(e) { MX.toast('Erreur enregistrement', true); console.error(e); }
  }

  // ── EXPORTS ──
  function _allMeters(cb) {
    document.querySelectorAll('.cso-mcb').forEach(x => { x.checked = cb.checked; });
  }

  function _getRows() {
    const from  = document.getElementById('cso-ef')?.value;
    const to    = document.getElementById('cso-et')?.value;
    const allCk = document.getElementById('cso-eall')?.checked;
    const ids   = allCk ? _meters.map(m => m.id) : Array.from(document.querySelectorAll('.cso-mcb:checked')).map(x => x.value);
    return _readings.filter(r => ids.includes(r.meterId) && (!from || r.date >= from) && (!to || r.date <= to));
  }

  function _csv() {
    const rows = _getRows();
    if (!rows.length) { MX.toast('Aucune donnée', true); return; }
    const hdr = ['Date','Heure','Compteur','Type','Index','Consommation','Unité','Technicien'];
    const lines = [hdr, ...rows.map(r => {
      const d = _tsDate(r.createdAt);
      const m = _meters.find(x => x.id === r.meterId);
      return [r.date||'', d?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'',
        r.meterName||'', MT[r.meterType||'']?.label||'', r.index??'',
        r.consumption??'', m?.unit||'m³', r.technicienName||''];
    })];
    const csv  = lines.map(l => l.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = `conso_${_today()}.csv`; a.click();
    URL.revokeObjectURL(url);
    MX.toast('CSV téléchargé');
  }

  function _pdf() {
    const rows = _getRows();
    if (!rows.length) { MX.toast('Aucune donnée', true); return; }
    const from = document.getElementById('cso-ef')?.value;
    const to   = document.getElementById('cso-et')?.value;
    const tbody = rows.map(r => {
      const d = _tsDate(r.createdAt);
      const m = _meters.find(x => x.id === r.meterId);
      return `<tr><td>${r.date?_dateLbl(r.date):''}</td><td>${d?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):''}</td>
        <td>${r.meterName||''}</td><td>${MT[r.meterType||'']?.label||''}</td>
        <td>${r.index!=null?_fmtIdx(r.index):''}</td><td>${r.consumption!=null?'+'+_fmtIdx(r.consumption):'—'}</td>
        <td>${m?.unit||'m³'}</td><td>${r.technicienName||''}</td></tr>`;
    }).join('');
    const win = window.open('','_blank');
    if (!win) { MX.toast('Autorisez les popups pour le PDF', true); return; }
    win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
      <title>Consommations ${_dateLbl(from)} — ${_dateLbl(to)}</title>
      <style>body{font-family:Arial,sans-serif;margin:24px;color:#111;font-size:12px}
      h1{font-size:20px;margin-bottom:4px}.sub{color:#666;margin-bottom:18px}
      table{width:100%;border-collapse:collapse}th{background:#0F172A;color:#fff;padding:8px;font-size:11px;text-align:left}
      td{padding:7px 8px;border-bottom:1px solid #eee}tr:nth-child(even)td{background:#f8f8f8}
      .ft{margin-top:16px;font-size:10px;color:#999}@media print{@page{margin:1cm}}</style>
      </head><body>
      <h1>📊 Rapport Consommations — Maintix</h1>
      <div class="sub">Du ${_dateLbl(from)} au ${_dateLbl(to)} · ${rows.length} relevés · Généré le ${_dateLbl(_today())}</div>
      <table><thead><tr><th>Date</th><th>Heure</th><th>Compteur</th><th>Type</th><th>Index</th><th>Consommation</th><th>Unité</th><th>Technicien</th></tr></thead>
      <tbody>${tbody}</tbody></table>
      <div class="ft">Maintix · Données exportées le ${new Date().toLocaleString('fr-FR')}</div>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
    MX.toast('Génération PDF…');
  }

  // ── EXPOSE ──
  window.MX       = window.MX       || {};
  window.MX.Pages = window.MX.Pages || {};
  // Moteur de calcul commun (phase 1 de la refonte énergétique) — fonctions
  // pures, sans dépendance à l'état du module. Toujours utilisées ci-dessus
  // en interne (dashboard/performance/analyses/alertes) ; exposées ici pour
  // rester vérifiables indépendamment et réutilisables par une future page.
  window.MX.CsoCalc = {
    isLiterRatioType: _isLiterRatioType,
    sumConsumption, sumConsumptionByType, computeRatio,
    average, minMax, comparePeriods, trendFromDeviation, statusFromDeviation,
    periodDates,
  };
  window.MX.Pages.Conso = {
    render,
    _tab, _editCli, _meterForm, _delMeter, _delReading,
    _editReading, _recalcMeter, recalculateConsumption,
    _newReading, _onPhoto, _showPhoto, _meterHistory,
    _allMeters, _csv, _pdf,
    _csoDateSet, _csoDatePrev, _csoDateNext,
    _getCsoState, _load,
    _ensureReadingsFrom, _ensureClientsFrom,
    _csoSetSearch, _csoSetFilter, _toggleZone, _releverZone,
    _resolveAlert, _createIntFromAlert, _critDismiss, _supView,
    _salCreateInt, _salSave,
    _rerender, _archiveMeter, _restoreMeter, _delMeterPermanent,
    _peDatePrev, _peDateNext, _editCliDate, _peRefresh,
    _peRatioMonthPrev, _peRatioMonthNext,
    _peShowDay, _peAddJustif, _peSaveJustif, _peOpenConfig, _peOpenGeneralMetersConfig,
  };
})();
