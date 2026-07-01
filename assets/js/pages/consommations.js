(function () {
  'use strict';

  // ── STATE ──
  let _curTab        = 'dashboard';
  let _csoSelDate    = ''; // '' = today; set to 'YYYY-MM-DD' when browsing a past date
  let _meters        = [];
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

  // ── CONSTANTS ──
  const FV = firebase.firestore.FieldValue;
  const CSO = {
    meters:   () => db.collection('cso_meters'),
    readings: () => db.collection('cso_readings'),
    clients:  () => db.collection('cso_clients'),
    alerts:   () => db.collection('cso_energy_alerts'),
  };

  const MT = {
    eau_froide:  { icon: '💧', label: 'Eau froide',  unit: 'm³',  color: '#3B82F6', dim: 'rgba(59,130,246,0.15)'  },
    eau_chaude:  { icon: '🔥', label: 'Eau chaude',  unit: 'm³',  color: '#F97316', dim: 'rgba(249,115,22,0.15)'  },
    electricite: { icon: '⚡', label: 'Électricité', unit: 'kWh', color: '#F59E0B', dim: 'rgba(245,158,11,0.15)'  },
    gaz:         { icon: '🌬', label: 'Gaz',         unit: 'm³',  color: '#A78BFA', dim: 'rgba(167,139,250,0.15)' },
    vapeur:      { icon: '♨️', label: 'Vapeur',      unit: 'kg',  color: '#EC4899', dim: 'rgba(236,72,153,0.15)'  },
    eau_glacee:  { icon: '🧊', label: 'Eau glacée',  unit: 'm³',  color: '#06B6D4', dim: 'rgba(6,182,212,0.15)'   },
    chauffage:   { icon: '🏢', label: 'Chauffage (ADP)', unit: 'MWh', color: '#EF4444', dim: 'rgba(239,68,68,0.15)' },
  };

  const TABS = [
    { id: 'dashboard', icon: 'fa-gauge',        l: 'Tableau de bord',    mob: 'Dashboard' },
    { id: 'compteurs', icon: 'fa-gauge-high',   l: 'Compteurs & Ratios', mob: 'Compteurs' },
    { id: 'releves',   icon: 'fa-camera',       l: 'Relevés',            mob: 'Relevés'   },
    { id: 'analyses',  icon: 'fa-chart-bar',    l: 'Analyses',           mob: 'Analyses'  },
    { id: 'alertes',   icon: 'fa-shield-halved', l: 'Supervision',        mob: 'Superv.'   },
    { id: 'exports',   icon: 'fa-file-export',  l: 'Exports',            mob: 'Exports'   },
  ];

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
  function _author() {
    const cu = MX.state.currentUser, ad = MX.state.adminUser;
    return cu ? cu.name : (ad ? (ad.email || 'Admin').split('@')[0] : 'Anonyme');
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

  // ── ENERGY SCORE ──
  function _calcScore() {
    const today = _today();
    let deduct = 0, checked = 0;
    ['eau_froide', 'eau_chaude', 'electricite'].forEach(type => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return;
      const todayC = _readings.filter(r => ids.includes(r.meterId) && r.date === today)
        .reduce((s, r) => s + (r.consumption || 0), 0);
      if (!todayC) return;
      checked++;
      let sum30 = 0, cnt = 0;
      for (let i = 1; i <= 30; i++) {
        const c = _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(i))
          .reduce((s, r) => s + (r.consumption || 0), 0);
        if (c > 0) { sum30 += c; cnt++; }
      }
      if (!cnt) return;
      const ecart = (todayC - sum30 / cnt) / (sum30 / cnt) * 100;
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

    // Surconsommation vs 30-day avg
    Object.entries(MT).forEach(([type, meta]) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return;
      const todayC = _readings.filter(r => ids.includes(r.meterId) && r.date === today)
        .reduce((s, r) => s + (r.consumption || 0), 0);
      if (!todayC) return;
      let sum30 = 0, cnt = 0;
      for (let i = 1; i <= 30; i++) {
        const c = _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(i))
          .reduce((s, r) => s + (r.consumption || 0), 0);
        if (c > 0) { sum30 += c; cnt++; }
      }
      if (!cnt) return;
      const avg = sum30 / cnt;
      const ecart = Math.round((todayC - avg) / avg * 100);
      if (ecart > 80) alerts.push({ type: 'surconsommation', level: 'critical', metric: type, title: `Surconsommation ${meta.label}`, msg: `+${ecart}% vs moyenne 30 jours (${_fmt(todayC)} vs ${_fmt(avg)} ${meta.unit})`, ecart });
      else if (ecart > 30) alerts.push({ type: 'surconsommation', level: 'warning', metric: type, title: `Surconsommation ${meta.label}`, msg: `+${ecart}% vs moyenne 30 jours`, ecart });
    });

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
      const ef = _readings.filter(r => efIds.includes(r.meterId) && r.date === today).reduce((s, r) => s + (r.consumption || 0), 0);
      const ec = _readings.filter(r => ecIds.includes(r.meterId) && r.date === today).reduce((s, r) => s + (r.consumption || 0), 0);
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
    const crits = _csoAlerts.filter(a => a.level === 'critical' && !a.acknowledged);
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
    try { await CSO.alerts().doc(id).update({ acknowledged: true, acknowledgedAt: FV.serverTimestamp(), acknowledgedBy: _author() }); }
    catch(e) { console.error(e); }
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
      _meters = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _rerender();
    });
    _unsubCso.readings = CSO.readings().orderBy('createdAt', 'desc').limit(500).onSnapshot(snap => {
      _readings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _rerender();
    });
    _unsubCso.clients = CSO.clients().orderBy('date', 'desc').limit(90).onSnapshot(snap => {
      _clients = {};
      snap.docs.forEach(d => { _clients[d.id] = d.data().count; });
      _rerender();
    });
    _unsubCso.alerts = CSO.alerts().orderBy('ts', 'desc').limit(100).onSnapshot(snap => {
      _csoAlerts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _checkCriticalBanner();
      _rerender();
    });
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
  }

  function _rerender() {
    const el = document.getElementById('cso-body');
    if (el) el.innerHTML = _body();
    _checkCriticalBanner();
    if (MX.state && MX.state.currentPage === 'home') {
      MX.Pages && MX.Pages.Home && MX.Pages.Home.render();
    }
  }

  function _getCsoState() {
    return { meters: _meters, readings: _readings, clients: _clients, loaded: _loaded };
  }

  function _tab(id) {
    _curTab = id;
    document.querySelectorAll('.cso-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    _rerender();
  }

  function _body() {
    switch (_curTab) {
      case 'compteurs': return _tCompteurs();
      case 'releves':   return _tReleves();
      case 'analyses':  return _tAnalyses();
      case 'alertes':   return _tAlertes();
      case 'exports':   return _tExports();
      default:          return _tDashboard();
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

  // ── TAB: DASHBOARD ──
  function _tDashboard() {
    const today = _today();
    const yest  = _daysAgo(1);
    const cli   = _clients[today] || 0;

    function _sumConso(type, date) {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      return _readings.filter(r => ids.includes(r.meterId) && r.date === date)
        .reduce((s, r) => s + (r.consumption || 0), 0);
    }

    // ── KPI cards ──
    let kpiHtml = '';
    Object.entries(MT).forEach(([type, meta]) => {
      const val   = _sumConso(type, today);
      const vY    = _sumConso(type, yest);
      const isW   = type === 'eau_froide' || type === 'eau_chaude';
      const ratio = cli > 0 && val > 0 ? (isW ? val * 1000 / cli : val / cli) : null;
      const rUnit = isW ? 'L/client' : `${meta.unit}/client`;
      let deltaHtml = '';
      if (val > 0 && vY > 0) {
        const pct = Math.round((val - vY) / vY * 100);
        const cls = pct > 15 ? 'up' : pct < -5 ? 'dn' : 'eq';
        deltaHtml = `<div class="cso-kpi-delta ${cls}">${pct > 0 ? '▲' : '▼'}&thinsp;${Math.abs(pct)}%&thinsp;vs&thinsp;hier</div>`;
      }
      kpiHtml += `<div class="cso-kpi-card" style="--kc:${meta.color};--kd:${meta.dim}">
        <div class="cso-kpi-bar"></div>
        <div class="cso-kpi-hd">
          <span class="cso-kpi-emoji">${meta.icon}</span>
          <span class="cso-kpi-nm">${meta.label}</span>
        </div>
        <div class="cso-kpi-v">${val > 0 ? _fmt(val) : '—'}<span class="cso-kpi-u">&thinsp;${meta.unit}</span></div>
        ${deltaHtml}
        <div class="cso-kpi-r">${ratio !== null ? `${_fmt(ratio, isW ? 0 : 2)}&thinsp;${rUnit}` : '<span style="color:var(--text3)">—</span>'}</div>
      </div>`;
    });

    // ── Mini 7-day bar chart ──
    const days7 = Array.from({ length: 7 }, (_, i) => _daysAgo(6 - i));
    const DOW   = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    let chartHtml = '';
    const firstEntry = Object.entries(MT).find(([type]) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      return ids.length && days7.some(ds => _readings.some(r => ids.includes(r.meterId) && r.date === ds && r.consumption > 0));
    });
    if (firstEntry) {
      const [type, meta] = firstEntry;
      const ids  = _meters.filter(m => m.type === type).map(m => m.id);
      const vals = days7.map(ds => _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0));
      const maxV = Math.max(...vals, 0.001);
      const unit = _meters.find(m => m.type === type)?.unit || meta.unit;
      chartHtml = `<div class="cso-dash-chart">
        <div class="cso-dash-chart-hd">
          <span>${meta.icon} ${meta.label} — 7 derniers jours</span>
          <span class="cso-dash-chart-tot">Total : <b>${_fmt(vals.reduce((a,b)=>a+b,0))} ${esc(unit)}</b></span>
        </div>
        <div class="cso-bars7">
          ${days7.map((ds, i) => {
            const pct = vals[i] > 0 ? Math.max(vals[i] / maxV * 100, 5) : 0;
            const lbl = DOW[new Date(ds + 'T12:00').getDay()];
            const isT = ds === today;
            return `<div class="cso-bar7-col">
              <div class="cso-bar7" style="height:${pct}%;background:${meta.color};opacity:${pct ? (isT ? 1 : 0.5) : 0.1}${isT ? ';box-shadow:0 0 8px '+meta.color+'80' : ''}"></div>
              <div class="cso-bar7-lbl${isT ? ' today' : ''}">${lbl}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    return `<div class="cso-inner">
      <div class="cso-cli-bar">
        <div class="cso-cli-ico">👥</div>
        <div class="cso-cli-info">
          <div class="cso-cli-val">${cli > 0 ? cli : '—'}</div>
          <div class="cso-cli-lbl">Clients présents · ${_dateLbl(today)}</div>
        </div>
        <button class="cso-cli-btn" onclick="MX.Pages.Conso._editCli('${today}',${cli})">
          <i class="fas fa-pen"></i> Modifier
        </button>
      </div>
      <div class="cso-kpi-grid">${kpiHtml}</div>
      ${chartHtml}
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
    const isW      = m.type === 'eau_froide' || m.type === 'eau_chaude';
    const dateRdgs = _readings.filter(r => r.meterId === m.id && r.date === selDate);
    const lr       = dateRdgs[0];
    const selConso = dateRdgs.reduce((s, r) => s + (r.consumption || 0), 0);
    const ratio    = cli > 0 && selConso > 0 ? (isW ? selConso * 1000 / cli : selConso / cli) : null;
    const hasRdg   = !!lr;
    let valLine = '';
    if (lr) {
      valLine = `Index&thinsp;: <b>${_fmtIdx(lr.index)}&thinsp;${esc(unit)}</b>`;
      if (selConso) valLine += ` &middot; Conso&thinsp;: +<b>${_fmtIdx(selConso)}</b>`;
      if (ratio !== null) valLine += ` &middot; R&thinsp;: <b>${_fmt(ratio, isW ? 0 : 2)}</b>`;
    } else {
      valLine = `<span class="cso-mrow-empty"><i class="fas fa-circle-minus"></i> Aucun relevé${isToday ? '' : ' ce jour'}</span>`;
    }
    return `<div class="cso-mrow ${hasRdg ? 'done' : 'pending'}" onclick="MX.Pages.Conso._newReading('${m.id}')">
      <div class="cso-mrow-ico" style="background:${meta.dim};color:${meta.color}">${meta.icon}</div>
      <div class="cso-mrow-info">
        <div class="cso-mrow-top">
          <span class="cso-mrow-name">${esc(m.name)}</span>
          <span class="cso-mrow-badge ${hasRdg ? 'done' : 'pending'}">${hasRdg ? '✅ Relevé' : '🟠 En attente'}</span>
        </div>
        <div class="cso-mrow-vals">${valLine}</div>
      </div>
      <div class="cso-mrow-acts" onclick="event.stopPropagation()">
        <button class="cso-ibtn" title="Historique" onclick="MX.Pages.Conso._meterHistory('${m.id}')"><i class="fas fa-chart-line"></i></button>
        <button class="cso-ibtn" title="Modifier" onclick="MX.Pages.Conso._meterForm('${m.id}')"><i class="fas fa-pen"></i></button>
        <button class="cso-ibtn red" title="Supprimer" onclick="MX.Pages.Conso._delMeter('${m.id}','${esc(m.name)}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }

  // ── TAB: COMPTEURS & RATIOS (zone-based compact refonte) ──
  function _tCompteurs() {
    const today   = _today();
    const selDate = _csoSelDate || today;
    const isToday = selDate === today;
    const cli     = _clients[selDate] || 0;
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
        <button class="cso-add-btn" style="margin-top:8px" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Ajouter un compteur</button>
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
      html += `<button class="cso-add-meter-btn" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Nouveau compteur</button>`;
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
            <button class="cso-ibtn red" title="Supprimer" onclick="MX.Pages.Conso._delReading('${r.id}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
      });
    }
    return html + '</div>';
  }

  // ── TAB: ANALYSES ──
  function _tAnalyses() {
    const periods = [{ id: '7', l: '7 jours' }, { id: '30', l: '30 jours' }, { id: '90', l: '3 mois' }, { id: '365', l: '1 an' }];
    const sel  = window._csoPer || '7';
    const days = parseInt(sel);
    const dates = Array.from({ length: days }, (_, i) => _daysAgo(days - 1 - i));

    // ── Ratio history section ──
    let ratioHtml = '';
    Object.entries(MT).forEach(([type, meta]) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return;
      const isW  = type === 'eau_froide' || type === 'eau_chaude';
      const unit = _meters.find(m => m.type === type)?.unit || meta.unit;
      const rUnit = isW ? 'L/client' : `${unit}/client`;
      const dailyRatios = dates
        .map(ds => {
          const c = _clients[ds] || 0;
          if (!c) return null;
          const cv = _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0);
          return cv > 0 ? (isW ? cv * 1000 / c : cv / c) : null;
        })
        .filter(v => v !== null);
      if (!dailyRatios.length) return;
      const avgRatio = dailyRatios.reduce((a, b) => a + b) / dailyRatios.length;
      const minRatio = Math.min(...dailyRatios);
      const maxRatio = Math.max(...dailyRatios);
      ratioHtml += `<div class="cso-ratio-card" style="--kc:${meta.color};--kd:${meta.dim}">
        <div class="cso-ratio-head">${meta.icon} ${meta.label}</div>
        <div class="cso-ratio-body">
          <div><div class="cso-ratio-val">${_fmt(avgRatio, isW ? 0 : 2)}</div><div class="cso-ratio-u">${rUnit} moy.</div></div>
          <div class="cso-ratio-avg"><div class="cso-ratio-avglbl">Min</div><div class="cso-ratio-avgval">${_fmt(minRatio, isW ? 0 : 2)}</div><div class="cso-ratio-u">${rUnit}</div></div>
          <div class="cso-ratio-avg"><div class="cso-ratio-avglbl">Max</div><div class="cso-ratio-avgval">${_fmt(maxRatio, isW ? 0 : 2)}</div><div class="cso-ratio-u">${rUnit}</div></div>
        </div>
        <div class="cso-ratio-base">Sur ${dailyRatios.length} jour${dailyRatios.length > 1 ? 's' : ''} avec données clients</div>
      </div>`;
    });

    let html = `<div class="cso-inner">
      <div class="cso-period-row">
        ${periods.map(p => `<button class="cso-per-btn${sel===p.id?' active':''}" onclick="window._csoPer='${p.id}';MX.Pages.Conso._tab('analyses')">${p.l}</button>`).join('')}
      </div>
      ${ratioHtml ? `<div class="cso-an-ratio-sec"><div class="cso-an-ratio-ttl"><i class="fas fa-percent"></i> Ratios sur la période</div>${ratioHtml}</div>` : ''}`;

    Object.entries(MT).forEach(([type, meta]) => {
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      if (!ids.length) return;
      const vals = dates.map(ds => _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0));
      const maxV = Math.max(...vals, 0.001);
      const total = vals.reduce((a, b) => a + b, 0);
      const avg   = total / days;
      const unit  = _meters.find(m => m.type === type)?.unit || meta.unit;

      html += `<div class="cso-chart-block">
        <div class="cso-chart-ttl">${meta.icon} ${meta.label}</div>`;

      if (!vals.some(v => v > 0)) {
        html += `<div class="cso-chart-empty">Aucune donnée sur la période</div>`;
      } else {
        const step = days <= 7 ? 1 : days <= 30 ? 3 : days <= 90 ? 7 : 30;
        const DOW  = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
        html += `<div class="cso-bars">` + dates.map((ds, i) => {
          const pct = vals[i] > 0 ? Math.max(vals[i] / maxV * 100, 4) : 0;
          const [, mo, d] = ds.split('-');
          const lbl = days <= 7 ? DOW[new Date(ds).getDay()] : (i % step === 0 ? `${d}/${mo}` : '');
          return `<div class="cso-bar-col">
            <div class="cso-bar" style="height:${pct}%;background:${meta.color};opacity:${pct?1:.12}"></div>
            <div class="cso-bar-lbl">${lbl}</div>
          </div>`;
        }).join('') + `</div>
        <div class="cso-chart-leg">
          <span>Total: <b>${_fmt(total)} ${esc(unit)}</b></span>
          <span>Moy/jour: <b>${_fmt(avg)} ${esc(unit)}</b></span>
        </div>`;
      }
      html += `</div>`;
    });
    return html + '</div>';
  }

  // ── TAB: SUPERVISION (Alertes) ──
  function _tAlertes() {
    const today = _today();
    const per   = window._csoSupPer || '30';
    const days  = parseInt(per);
    const cli   = _clients[today] || 0;

    // ── Score ──
    const score = _calcScore();
    const scoreColor = score >= 90 ? '#34d399' : score >= 70 ? '#06B6D4' : score >= 50 ? '#f59e0b' : '#f87171';
    const scoreLbl   = score >= 90 ? 'Excellent' : score >= 70 ? 'Bon' : score >= 50 ? 'Moyen' : 'Critique';
    const circ = 2 * Math.PI * 28;
    const scoreCircle = `<svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/>
      <circle cx="36" cy="36" r="28" fill="none" stroke="${scoreColor}" stroke-width="6"
        stroke-dasharray="${(score / 100 * circ).toFixed(1)} ${circ.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 36 36)"/>
      <text x="36" y="36" text-anchor="middle" dominant-baseline="central" fill="${scoreColor}" font-size="16" font-weight="700" font-family="monospace">${score}</text>
    </svg>`;

    // ── 4 KPI supervision cards ──
    const SUP_TYPES = ['eau_froide', 'eau_chaude', 'chauffage', 'electricite'];
    let kpiCards = '';
    SUP_TYPES.forEach(type => {
      const meta = MT[type]; if (!meta) return;
      const ids = _meters.filter(m => m.type === type).map(m => m.id);
      const unit = ids.length ? (_meters.find(m => m.type === type)?.unit || meta.unit) : meta.unit;
      const todayC = _readings.filter(r => ids.includes(r.meterId) && r.date === today).reduce((s, r) => s + (r.consumption || 0), 0);
      let sum30 = 0, cnt30 = 0;
      for (let i = 1; i <= 30; i++) {
        const c = _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(i)).reduce((s, r) => s + (r.consumption || 0), 0);
        if (c > 0) { sum30 += c; cnt30++; }
      }
      const avg30 = cnt30 ? sum30 / cnt30 : 0;
      const ecart = avg30 > 0 ? Math.round((todayC - avg30) / avg30 * 100) : null;
      const lvl   = ecart === null ? 'nodata' : Math.abs(ecart) <= 15 ? 'ok' : Math.abs(ecart) <= 40 ? 'warn' : 'crit';
      const lvlClr = lvl === 'ok' ? '#34d399' : lvl === 'warn' ? '#f59e0b' : lvl === 'crit' ? '#f87171' : 'var(--text3)';
      const lvlIco = lvl === 'ok' ? '✓' : lvl === 'warn' ? '⚠' : lvl === 'crit' ? '🚨' : '—';
      const spark7 = Array.from({ length: 7 }, (_, i) => _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(6 - i)).reduce((s, r) => s + (r.consumption || 0), 0));
      kpiCards += `<div class="cso-sup-kpi" style="--kc:${meta.color};--kd:${meta.dim}">
        <div class="cso-sup-kpi-hd">
          <span style="font-size:18px">${meta.icon}</span>
          <span class="cso-sup-kpi-nm">${meta.label}</span>
          <span class="cso-sup-kpi-lvl" style="color:${lvlClr}">${lvlIco}</span>
        </div>
        <div class="cso-sup-kpi-val">${todayC > 0 ? _fmt(todayC) : '—'}<span class="cso-sup-kpi-u"> ${unit}</span></div>
        <div class="cso-sup-kpi-row"><span class="cso-sup-kpi-lbl">Moy. 30j</span><span>${avg30 > 0 ? `${_fmt(avg30)} ${unit}` : '—'}</span></div>
        <div class="cso-sup-kpi-row"><span class="cso-sup-kpi-lbl">Écart</span><span style="color:${lvlClr};font-weight:700">${ecart !== null ? `${ecart > 0 ? '+' : ''}${ecart}%` : '—'}</span></div>
        <div class="cso-sup-kpi-spark">${_sparkSVG(spark7, meta.color, 80, 26)}</div>
      </div>`;
    });

    // ── Multi-series line chart ──
    const periods    = [{ id: '7', l: '7j' }, { id: '30', l: '30j' }, { id: '90', l: '3m' }, { id: '365', l: '1an' }];
    const chartDates = Array.from({ length: days }, (_, i) => _daysAgo(days - 1 - i));
    const chartTypes = ['eau_froide', 'eau_chaude', 'electricite'];
    const datasets   = chartTypes.map(type => {
      const meta = MT[type];
      const ids  = _meters.filter(m => m.type === type).map(m => m.id);
      return { vals: chartDates.map(ds => _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0)), color: meta.color, label: `${meta.icon} ${meta.label}` };
    });
    const hasChartData = datasets.some(d => d.vals.some(v => v > 0));
    let chartHtml = `<div class="cso-chart2-wrap">
      <div class="cso-chart2-hd">
        <span class="cso-chart2-ttl"><i class="fas fa-chart-line"></i> Évolution des consommations</span>
        <div class="cso-chart2-per">${periods.map(p => `<button class="cso-per-btn${per === p.id ? ' active' : ''}" onclick="window._csoSupPer='${p.id}';MX.Pages.Conso._tab('alertes')">${p.l}</button>`).join('')}</div>
      </div>
      <div class="cso-chart2-leg">${datasets.map(d => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text2)"><span style="width:10px;height:2px;background:${d.color};display:inline-block;border-radius:1px"></span>${d.label}</span>`).join('')}</div>
      ${hasChartData ? `<div class="cso-chart2-svg">${_lineSVG(datasets, 150)}</div>` : '<div class="cso-chart2-empty">Aucune donnée sur la période</div>'}
    </div>`;

    // ── Chauffage ADP chart (MWh) ──
    const chIds = _meters.filter(m => m.type === 'chauffage').map(m => m.id);
    let chChart = '';
    if (chIds.length) {
      const chVals = chartDates.map(ds => _readings.filter(r => chIds.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0));
      if (chVals.some(v => v > 0)) {
        const ds2 = [{ vals: chVals, color: MT.chauffage.color, label: '🏢 Chauffage ADP' }];
        chChart = `<div class="cso-chart2-wrap">
          <div class="cso-chart2-hd"><span class="cso-chart2-ttl">🏢 Chauffage ADP — MWh</span></div>
          <div class="cso-chart2-svg">${_lineSVG(ds2, 100)}</div>
        </div>`;
      }
    }

    // ── Per-client analysis ──
    let perCliHtml = '';
    if (cli > 0) {
      ['eau_froide', 'eau_chaude', 'electricite'].forEach(type => {
        const meta = MT[type];
        const ids  = _meters.filter(m => m.type === type).map(m => m.id);
        if (!ids.length) return;
        const isW   = type === 'eau_froide' || type === 'eau_chaude';
        const todayC = _readings.filter(r => ids.includes(r.meterId) && r.date === today).reduce((s, r) => s + (r.consumption || 0), 0);
        if (!todayC) return;
        const todayR = isW ? todayC * 1000 / cli : todayC / cli;
        const rU = isW ? 'L/client' : `${meta.unit}/client`;
        let sum30 = 0, cnt = 0;
        for (let i = 1; i <= 30; i++) {
          const c2 = _clients[_daysAgo(i)] || 0; if (!c2) continue;
          const cv = _readings.filter(r => ids.includes(r.meterId) && r.date === _daysAgo(i)).reduce((s, r) => s + (r.consumption || 0), 0);
          if (cv > 0) { sum30 += isW ? cv * 1000 / c2 : cv / c2; cnt++; }
        }
        const avgR  = cnt ? sum30 / cnt : 0;
        const ecart = avgR > 0 ? Math.round((todayR - avgR) / avgR * 100) : null;
        const clr   = ecart === null ? 'var(--text3)' : Math.abs(ecart) <= 15 ? '#34d399' : Math.abs(ecart) <= 40 ? '#f59e0b' : '#f87171';
        perCliHtml += `<div class="cso-percli-row">
          <span class="cso-percli-ico" style="color:${meta.color}">${meta.icon}</span>
          <span class="cso-percli-nm">${meta.label}</span>
          <span class="cso-percli-val">${_fmt(todayR, isW ? 0 : 2)}<span class="cso-percli-u"> ${rU}</span></span>
          <span class="cso-percli-ecart" style="color:${clr}">${ecart !== null ? `${ecart > 0 ? '+' : ''}${ecart}%` : '—'}</span>
          <span class="cso-percli-avg">${avgR > 0 ? `Moy.30j : ${_fmt(avgR, isW ? 0 : 2)} ${rU}` : 'Pas de base'}</span>
        </div>`;
      });
    }

    // ── Smart alerts ──
    const smartAlerts = _detectAlerts();
    let salHtml = '';
    smartAlerts.forEach((a, idx) => {
      const meta   = MT[a.metric] || {};
      const lvlClr = a.level === 'critical' ? '#f87171' : '#f59e0b';
      salHtml += `<div class="cso-sal-item ${a.level}">
        <div class="cso-sal-badge" style="color:${lvlClr}">${a.level === 'critical' ? '🚨 Critique' : '⚠ Attention'}</div>
        <div class="cso-sal-body">
          <div class="cso-sal-ttl">${meta.icon || ''} ${esc(a.title)}</div>
          <div class="cso-sal-msg">${esc(a.msg)}</div>
          ${a.zone ? `<div class="cso-sal-zone"><i class="fas fa-location-dot"></i> ${esc(a.zone)}</div>` : ''}
        </div>
        <div class="cso-sal-acts">
          <button class="cso-ibtn" title="Créer intervention" onclick="MX.Pages.Conso._salCreateInt(${idx})"><i class="fas fa-screwdriver-wrench"></i></button>
          <button class="cso-ibtn" title="Sauvegarder" onclick="MX.Pages.Conso._salSave(${idx})"><i class="fas fa-floppy-disk"></i></button>
        </div>
      </div>`;
    });

    // ── Top zones ──
    const zoneStats = {};
    _meters.forEach(m => {
      const z = (m.location || '').trim() || 'Sans zone';
      if (!zoneStats[z]) zoneStats[z] = { ok: 0, warn: 0, crit: 0 };
      _readings.some(r => r.meterId === m.id && r.date === today) ? zoneStats[z].ok++ : zoneStats[z].warn++;
    });
    smartAlerts.forEach(a => {
      const z = (a.zone || '').trim() || 'Sans zone';
      if (zoneStats[z]) { if (a.level === 'critical') { zoneStats[z].crit++; zoneStats[z].ok = Math.max(0, zoneStats[z].ok - 1); } else { zoneStats[z].warn = Math.max(1, zoneStats[z].warn); } }
    });
    const topZones = Object.entries(zoneStats).sort((a, b) => (b[1].crit * 10 + b[1].warn) - (a[1].crit * 10 + a[1].warn)).slice(0, 6);
    const zonesHtml = topZones.map(([zone, st]) => `<div class="cso-zones2-row ${st.crit ? 'crit' : st.warn ? 'warn' : 'ok'}">
      <div class="cso-zones2-name"><i class="fas fa-location-dot"></i> ${esc(zone)}</div>
      <div class="cso-zones2-pills">
        ${st.ok  > 0 ? `<span class="cso-zpill ok">${st.ok} ✓</span>`   : ''}
        ${st.warn > 0 ? `<span class="cso-zpill warn">${st.warn} ⚠</span>` : ''}
        ${st.crit > 0 ? `<span class="cso-zpill crit">${st.crit} 🚨</span>` : ''}
      </div>
    </div>`).join('');

    // ── Alert history ──
    const histList = [..._csoAlerts].slice(0, 20);
    const histHtml = histList.map(a => {
      const d  = _tsDate(a.ts || a.createdAt);
      const ds = d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const tm = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      const lc = a.level === 'critical' ? '#f87171' : a.level === 'warning' ? '#f59e0b' : '#34d399';
      return `<div class="cso-hist-alert${a.acknowledged ? ' ack' : ''}">
        <div class="cso-hist-alert-dt"><span>${ds}</span><span class="cso-hist-alert-tm">${tm}</span></div>
        <div class="cso-hist-alert-body">
          <div class="cso-hist-alert-ttl" style="color:${lc}">${esc(a.title || a.type || '')}</div>
          <div class="cso-hist-alert-msg">${esc(a.msg || a.message || '')}</div>
          ${a.zone ? `<div class="cso-hist-alert-zone"><i class="fas fa-location-dot"></i> ${esc(a.zone)}</div>` : ''}
        </div>
        <div class="cso-hist-alert-status">
          ${a.acknowledged ? `<span class="cso-hist-badge ack">✓ Traité</span>` : `<button class="cso-ibtn" title="Marquer traité" onclick="MX.Pages.Conso._resolveAlert('${esc(a.id)}')"><i class="fas fa-check"></i></button>`}
        </div>
      </div>`;
    }).join('');

    return `<div class="cso-inner">
      <div class="cso-sup-header">
        <div class="cso-sup-score">${scoreCircle}<div><div class="cso-sup-score-lbl">Score Énergie</div><div class="cso-sup-score-st" style="color:${scoreColor}">${scoreLbl}</div></div></div>
        <div class="cso-sup-hd-info"><i class="fas fa-shield-halved" style="color:var(--cyan);font-size:18px"></i><div><div style="font-weight:700;font-size:14px">Centre de Supervision</div><div style="font-size:12px;color:var(--text2)">${_dateLbl(today)} · ${_meters.length} compteur${_meters.length !== 1 ? 's' : ''}</div></div></div>
      </div>

      <div class="cso-sup-kpi-grid">${kpiCards || '<div class="cso-chart2-empty">Aucun compteur configuré — <button class="cso-add-btn" onclick="MX.Pages.Conso._tab(\'compteurs\')">Ajouter</button></div>'}</div>

      ${chartHtml}
      ${chChart}

      ${perCliHtml ? `<div class="cso-percli-wrap">
        <div class="cso-section-ttl"><i class="fas fa-users"></i> Par client (${cli} présents aujourd'hui)</div>
        <div class="cso-percli-list">${perCliHtml}</div>
      </div>` : ''}

      <div class="cso-sal-wrap">
        <div class="cso-section-ttl"><i class="fas fa-robot"></i> Alertes intelligentes <span class="cso-section-cnt">${smartAlerts.length}</span></div>
        ${salHtml || '<div class="cso-chart2-empty"><i class="fas fa-check-circle" style="color:#34d399;font-size:20px"></i><br>Aucune anomalie détectée</div>'}
      </div>

      ${topZones.length ? `<div class="cso-zones2-wrap">
        <div class="cso-section-ttl"><i class="fas fa-map-marker-alt"></i> Zones</div>
        <div class="cso-zones2-list">${zonesHtml}</div>
      </div>` : ''}

      <div class="cso-alert-hist-wrap">
        <div class="cso-section-ttl"><i class="fas fa-clock-rotate-left"></i> Historique des alertes <span class="cso-section-cnt">${histList.length}</span></div>
        ${histHtml || '<div class="cso-chart2-empty" style="padding:16px">Aucune alerte enregistrée</div>'}
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
          MX.toast('Clients mis à jour');
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => { const el = document.getElementById('cso-cli-inp'); if (el) { el.focus(); el.select(); } }, 80);
  }

  // ── ACTIONS: METER FORM ──
  function _meterForm(id) {
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
      </div>`,
      actions: [
        { label: m ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: async () => {
          const name = document.getElementById('cso-mn')?.value?.trim();
          const type = document.getElementById('cso-mt')?.value;
          const loc  = document.getElementById('cso-ml')?.value?.trim();
          const unit = document.getElementById('cso-mu')?.value?.trim() || MT[type]?.unit || 'm³';
          if (!name) { MX.toast('Le nom est requis', true); return; }
          const data = { name, type, location: loc || '', unit, updatedAt: FV.serverTimestamp() };
          if (m) { await CSO.meters().doc(id).update(data); MX.toast('Compteur mis à jour'); }
          else   { await CSO.meters().add({ ...data, createdAt: FV.serverTimestamp() }); MX.toast('Compteur créé'); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('cso-mn')?.focus(), 80);
  }

  function _delMeter(id, name) {
    MX.showModal('Supprimer le compteur', `Supprimer "${name}" et tous ses relevés ?`, [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        const snap = await CSO.readings().where('meterId', '==', id).get();
        const b = db.batch();
        snap.docs.forEach(d => b.delete(d.ref));
        b.delete(CSO.meters().doc(id));
        await b.commit();
        MX.toast('Compteur supprimé');
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _delReading(id) {
    MX.showModal('Supprimer le relevé', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        await CSO.readings().doc(id).delete();
        MX.toast('Relevé supprimé');
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
  window.MX.Pages.Conso = {
    render,
    _tab, _editCli, _meterForm, _delMeter, _delReading,
    _newReading, _onPhoto, _showPhoto, _meterHistory,
    _allMeters, _csv, _pdf,
    _csoDateSet, _csoDatePrev, _csoDateNext,
    _getCsoState, _load,
    _csoSetSearch, _csoSetFilter, _toggleZone, _releverZone,
    _resolveAlert, _createIntFromAlert, _critDismiss, _supView,
    _salCreateInt, _salSave,
  };
})();
