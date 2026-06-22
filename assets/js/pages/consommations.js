(function () {
  'use strict';

  // ── STATE ──
  let _curTab   = 'dashboard';
  let _meters   = [];
  let _readings = [];
  let _clients  = {};
  let _loaded   = false;
  let _unsubCso = {};
  let _photoB64 = null;

  // ── CONSTANTS ──
  const FV = firebase.firestore.FieldValue;
  const CSO = {
    meters:   () => db.collection('cso_meters'),
    readings: () => db.collection('cso_readings'),
    clients:  () => db.collection('cso_clients'),
  };

  const MT = {
    eau_froide:  { icon: '💧', label: 'Eau froide',  unit: 'm³',  color: '#3B82F6', dim: 'rgba(59,130,246,0.15)'  },
    eau_chaude:  { icon: '🔥', label: 'Eau chaude',  unit: 'm³',  color: '#F97316', dim: 'rgba(249,115,22,0.15)'  },
    electricite: { icon: '⚡', label: 'Électricité', unit: 'kWh', color: '#F59E0B', dim: 'rgba(245,158,11,0.15)'  },
    gaz:         { icon: '🌬', label: 'Gaz',         unit: 'm³',  color: '#A78BFA', dim: 'rgba(167,139,250,0.15)' },
  };

  const TABS = [
    { id: 'dashboard', icon: 'fa-gauge',        l: 'Tableau de bord' },
    { id: 'compteurs', icon: 'fa-gauge-high',   l: 'Compteurs'       },
    { id: 'releves',   icon: 'fa-camera',       l: 'Relevés'         },
    { id: 'ratios',    icon: 'fa-percent',      l: 'Ratios'          },
    { id: 'analyses',  icon: 'fa-chart-bar',    l: 'Analyses'        },
    { id: 'alertes',   icon: 'fa-bell',         l: 'Alertes'         },
    { id: 'exports',   icon: 'fa-file-export',  l: 'Exports'         },
  ];

  // ── HELPERS ──
  function _today()     { return new Date().toISOString().slice(0, 10); }
  function _daysAgo(n)  { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function _fmt(n, dec) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const d = dec !== undefined ? dec : (Math.abs(n) >= 100 ? 1 : 2);
    return n.toFixed(d).replace('.', ',');
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
          <i class="fas ${t.icon}"></i><span>${t.l}</span>
        </button>`).join('')}
      </div>
      <div class="cso-body" id="cso-body">${_body()}</div>
    </div>`;
  }

  function _rerender() {
    const el = document.getElementById('cso-body');
    if (el) el.innerHTML = _body();
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
      case 'ratios':    return _tRatios();
      case 'analyses':  return _tAnalyses();
      case 'alertes':   return _tAlertes();
      case 'exports':   return _tExports();
      default:          return _tDashboard();
    }
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

    let kpi = '';
    Object.entries(MT).forEach(([type, meta]) => {
      const val  = _sumConso(type, today);
      const vY   = _sumConso(type, yest);
      const isW  = type === 'eau_froide' || type === 'eau_chaude';
      const ratio = cli > 0 && val > 0 ? (isW ? val * 1000 / cli : val / cli) : null;
      const rUnit = isW ? 'L/client' : `${meta.unit}/client`;

      let trend = '';
      if (val > 0 && vY > 0) {
        const pct = Math.round((val - vY) / vY * 100);
        const cls = pct > 15 ? 'cso-up' : pct < -5 ? 'cso-dn' : 'cso-ok';
        trend = `<span class="${cls}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs hier</span>`;
      }

      kpi += `<div class="cso-kpi" style="--kc:${meta.color};--kd:${meta.dim}">
        <div class="cso-kpi-head"><span class="cso-kpi-ico">${meta.icon}</span><span>${meta.label}</span></div>
        <div class="cso-kpi-val">${val > 0 ? _fmt(val) : '—'} <span class="cso-kpi-u">${meta.unit}</span></div>
        <div class="cso-kpi-foot">${trend}${ratio !== null ? `<span class="cso-ratio-badge">${_fmt(ratio, isW?0:2)} ${rUnit}</span>` : ''}</div>
      </div>`;
    });

    return `<div class="cso-inner">
      <div class="cso-cli-bar">
        <span class="cso-cli-ico">👥</span>
        <div>
          <div class="cso-cli-val">${cli > 0 ? cli : '—'}</div>
          <div class="cso-cli-lbl">Clients présents — ${_dateLbl(today)}</div>
        </div>
        <button class="cso-edit-btn" onclick="MX.Pages.Conso._editCli('${today}',${cli})"><i class="fas fa-pen"></i></button>
      </div>
      <div class="cso-sec-ttl">Consommations — ${_dateLbl(today)}</div>
      <div class="cso-kpi-grid">${kpi}</div>
      <div style="margin-top:16px">
        <button class="primary-btn cso-fab" onclick="MX.Pages.Conso._newReading(null)">
          <i class="fas fa-camera"></i> Nouveau relevé
        </button>
      </div>
    </div>`;
  }

  // ── TAB: COMPTEURS ──
  function _tCompteurs() {
    let html = `<div class="cso-inner">
      <div class="cso-bar-hdr">
        <span class="cso-sec-ttl" style="margin:0">${_meters.length} compteur${_meters.length !== 1 ? 's' : ''}</span>
        <button class="primary-btn" style="width:auto;padding:8px 16px" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Ajouter</button>
      </div>`;

    if (!_meters.length) {
      html += _empty('fa-gauge-high', 'Aucun compteur configuré.<br>Ajoutez votre premier compteur.');
    } else {
      Object.entries(MT).forEach(([type, meta]) => {
        const list = _meters.filter(m => m.type === type);
        if (!list.length) return;
        html += `<div class="cso-group-ttl">${meta.icon} ${meta.label}</div>`;
        list.forEach(m => {
          const lr = _readings.find(r => r.meterId === m.id);
          html += `<div class="cso-meter-card">
            <div class="cso-mico" style="background:${meta.dim};color:${meta.color}">${meta.icon}</div>
            <div class="cso-minfo">
              <div class="cso-mname">${esc(m.name)}</div>
              <div class="cso-mmeta">${esc(m.location || '')}${m.location ? ' · ' : ''}${esc(m.unit || meta.unit)}</div>
              <div class="cso-mlast">Dernier: <b>${lr ? _fmt(lr.index, 1) + ' ' + esc(m.unit || meta.unit) : '—'}</b>${lr ? ' · ' + _dateLbl(lr.date) + ' · ' + esc(lr.technicienName || '') : ''}</div>
            </div>
            <div class="cso-mbtns">
              <button class="cso-ibtn" title="Relevé" onclick="MX.Pages.Conso._newReading('${m.id}')"><i class="fas fa-camera"></i></button>
              <button class="cso-ibtn" title="Modifier" onclick="MX.Pages.Conso._meterForm('${m.id}')"><i class="fas fa-pen"></i></button>
              <button class="cso-ibtn red" title="Supprimer" onclick="MX.Pages.Conso._delMeter('${m.id}','${esc(m.name)}')"><i class="fas fa-trash"></i></button>
            </div>
          </div>`;
        });
      });
    }
    return html + '</div>';
  }

  // ── TAB: RELEVÉS ──
  function _tReleves() {
    const nowMs = Date.now();
    const exp7  = 7 * 86400000;
    let html = `<div class="cso-inner">
      <div class="cso-bar-hdr">
        <span class="cso-sec-ttl" style="margin:0">${_readings.length} relevé${_readings.length !== 1 ? 's' : ''}</span>
        <button class="primary-btn" style="width:auto;padding:8px 16px" onclick="MX.Pages.Conso._newReading(null)"><i class="fas fa-camera"></i> Nouveau relevé</button>
      </div>`;

    if (!_readings.length) {
      html += _empty('fa-camera', 'Aucun relevé enregistré.<br>Prenez votre premier relevé.');
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
              <span>Index: <b>${_fmt(r.index, 1)} ${esc(unit)}</b></span>
              ${r.consumption != null ? `<span>+${_fmt(r.consumption, 2)} ${esc(unit)}</span>` : ''}
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

  // ── TAB: RATIOS ──
  function _tRatios() {
    const today = _today();
    const cli   = _clients[today] || 0;
    let html = `<div class="cso-inner">
      <div class="cso-cli-bar" style="margin-bottom:20px">
        <span class="cso-cli-ico">👥</span>
        <div><div class="cso-cli-val">${cli > 0 ? cli : '—'}</div><div class="cso-cli-lbl">Clients présents — ${_dateLbl(today)}</div></div>
        <button class="cso-edit-btn" onclick="MX.Pages.Conso._editCli('${today}',${cli})"><i class="fas fa-pen"></i></button>
      </div>`;

    if (cli === 0) {
      html += _empty('fa-users-slash', 'Saisissez le nombre de clients<br>pour calculer les ratios.');
    } else {
      html += `<div class="cso-sec-ttl">Ratios du jour</div>`;
      Object.entries(MT).forEach(([type, meta]) => {
        const ids = _meters.filter(m => m.type === type).map(m => m.id);
        if (!ids.length) return;
        const conso = _readings.filter(r => ids.includes(r.meterId) && r.date === today).reduce((s, r) => s + (r.consumption || 0), 0);
        if (!conso) return;
        const isW  = type === 'eau_froide' || type === 'eau_chaude';
        const rv   = isW ? conso * 1000 / cli : conso / cli;
        const rU   = isW ? 'L/client' : `${meta.unit}/client`;
        // 7-day avg
        const vals = [];
        for (let i = 1; i <= 7; i++) {
          const ds = _daysAgo(i), c = _clients[ds] || 0;
          if (!c) continue;
          const cv = _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0);
          if (cv) vals.push(isW ? cv * 1000 / c : cv / c);
        }
        const avg7 = vals.length ? vals.reduce((a, b) => a + b) / vals.length : 0;
        html += `<div class="cso-ratio-card" style="--kc:${meta.color};--kd:${meta.dim}">
          <div class="cso-ratio-head">${meta.icon} ${meta.label}</div>
          <div class="cso-ratio-body">
            <div><div class="cso-ratio-val">${_fmt(rv, isW ? 0 : 2)}</div><div class="cso-ratio-u">${rU}</div></div>
            ${avg7 ? `<div class="cso-ratio-avg"><div class="cso-ratio-avglbl">Moy. 7j</div><div class="cso-ratio-avgval">${_fmt(avg7, isW ? 0 : 2)}</div><div class="cso-ratio-u">${rU}</div></div>` : ''}
          </div>
          <div class="cso-ratio-base">Basé sur ${cli} client${cli > 1 ? 's' : ''} · ${_fmt(conso)} ${meta.unit}</div>
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

    let html = `<div class="cso-inner">
      <div class="cso-period-row">
        ${periods.map(p => `<button class="cso-per-btn${sel===p.id?' active':''}" onclick="window._csoPer='${p.id}';MX.Pages.Conso._tab('analyses')">${p.l}</button>`).join('')}
      </div>`;

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

  // ── TAB: ALERTES ──
  function _tAlertes() {
    const today = _today();
    const cli   = _clients[today] || 0;
    const todayReadings = _readings.filter(r => r.date === today);
    let html = `<div class="cso-inner"><div class="cso-sec-ttl">Détection automatique des anomalies</div>`;
    let hasAny = false;

    if (!todayReadings.length) {
      html += _empty('fa-bell-slash', 'Aucun relevé aujourd\'hui.<br>Effectuez des relevés pour activer la détection.');
    } else if (!cli) {
      html += _empty('fa-users-slash', 'Saisissez le nombre de clients<br>pour activer les alertes.');
    } else {
      const SUGG = {
        eau_froide:  ['Vérifier les WC', 'Contrôler les réseaux', 'Détecter les fuites'],
        eau_chaude:  ['Vérifier la production ECS', 'Contrôler les douches'],
        electricite: ['Vérifier la climatisation', 'Contrôler l\'éclairage'],
        gaz:         ['Vérifier la chaudière', 'Contrôler les brûleurs'],
      };
      Object.entries(MT).forEach(([type, meta]) => {
        const ids = _meters.filter(m => m.type === type).map(m => m.id);
        if (!ids.length) return;
        const conso = todayReadings.filter(r => ids.includes(r.meterId)).reduce((s, r) => s + (r.consumption || 0), 0);
        if (!conso) return;
        hasAny = true;
        const isW = type === 'eau_froide' || type === 'eau_chaude';
        const todayR = isW ? conso * 1000 / cli : conso / cli;
        const rU = isW ? 'L/client' : `${meta.unit}/client`;
        // 7-day avg
        const avgs = [];
        for (let i = 1; i <= 7; i++) {
          const ds = _daysAgo(i), c = _clients[ds] || 0;
          if (!c) continue;
          const cv = _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0);
          if (cv) avgs.push(isW ? cv * 1000 / c : cv / c);
        }
        const avg7 = avgs.length ? avgs.reduce((a, b) => a + b) / avgs.length : 0;
        const dev  = avg7 > 0 ? (todayR - avg7) / avg7 * 100 : 0;
        const lvl  = Math.abs(dev) < 20 ? 'ok' : Math.abs(dev) < 60 ? 'warn' : 'crit';
        const badge = lvl === 'ok' ? '✅ Normal' : `🚨 ${dev > 0 ? '+' : ''}${Math.round(dev)}%`;

        html += `<div class="cso-alert-card ${lvl}">
          <div class="cso-alert-top">
            <span class="cso-alert-pill ${lvl}">${badge}</span>
            <span class="cso-alert-name">${meta.icon} ${meta.label}</span>
          </div>
          <div class="cso-alert-vals">
            <div><div class="cso-alert-vl">Aujourd'hui</div><div class="cso-alert-vv">${_fmt(todayR, isW ? 0 : 2)} ${rU}</div></div>
            ${avg7 > 0 ? `<div><div class="cso-alert-vl">Moy. 7j</div><div class="cso-alert-vv">${_fmt(avg7, isW ? 0 : 2)} ${rU}</div></div>` : ''}
          </div>
          ${lvl !== 'ok' ? `<div class="cso-sugg">${(SUGG[type] || []).map(s => `<span>• ${s}</span>`).join('')}</div>` : ''}
        </div>`;
      });
      if (!hasAny) html += _empty('fa-bell-slash', 'Aucune consommation relevée aujourd\'hui.');
    }
    return html + '</div>';
  }

  // ── TAB: EXPORTS ──
  function _tExports() {
    const today = _today();
    const from  = _daysAgo(30);
    return `<div class="cso-inner">
      <div class="cso-sec-ttl">Exporter les données</div>
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

    MX.showModal({
      title: '📷 Nouveau relevé',
      sub: '',
      body: `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
        <select id="cso-rm" class="fi">${opts}</select>
        <input type="date" id="cso-rd" class="fi" value="${_today()}">
        <input type="number" id="cso-ri" class="fi" step="0.001" placeholder="Index (ex: 12547)"
          style="text-align:center;font-size:22px;font-family:var(--ffm)">
        <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px dashed var(--border2);border-radius:10px;cursor:pointer;color:var(--text2);font-size:13px">
          <i class="fas fa-camera"></i> Photo du compteur (optionnel — conservée 7 jours)
          <input type="file" accept="image/*" capture="environment" id="cso-rp" onchange="MX.Pages.Conso._onPhoto(this)" style="display:none">
        </label>
        <img id="cso-rp-prev" style="display:none;width:100%;max-height:180px;object-fit:contain;border-radius:8px;border:1px solid var(--border2)">
      </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'confirm', fn: _saveReading },
        { label: 'Annuler',     cls: 'cancel',  fn: () => { _photoB64 = null; } }
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
    const meterId = document.getElementById('cso-rm')?.value;
    const dateStr = document.getElementById('cso-rd')?.value;
    const indexRaw = document.getElementById('cso-ri')?.value;
    const index = parseFloat(indexRaw);

    if (!meterId)          { MX.toast('Sélectionnez un compteur', true); return; }
    if (!dateStr)          { MX.toast('Sélectionnez une date', true); return; }
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
      MX.toast(consumption !== null ? `Relevé enregistré · +${_fmt(consumption)} ${m.unit}` : 'Relevé enregistré');
    } catch(e) { MX.toast('Erreur enregistrement', true); console.error(e); }
  }

  // ── EXPORTS ──
  function _allMeters(cb) {
    document.querySelectorAll('.cso-mcb').forEach(x => { x.checked = cb.checked; });
  }

  function _getRows() {
    const from = document.getElementById('cso-ef')?.value;
    const to   = document.getElementById('cso-et')?.value;
    const allCk = document.getElementById('cso-eall')?.checked;
    const ids  = allCk ? _meters.map(m => m.id) : Array.from(document.querySelectorAll('.cso-mcb:checked')).map(x => x.value);
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
        <td>${r.index??''}</td><td>${r.consumption!=null?'+'+_fmt(r.consumption):'—'}</td>
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
    _newReading, _onPhoto, _showPhoto,
    _allMeters, _csv, _pdf,
  };
})();
