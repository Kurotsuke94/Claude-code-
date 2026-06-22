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
    { id: 'dashboard', icon: 'fa-gauge',        l: 'Tableau de bord', mob: 'Dashboard' },
    { id: 'compteurs', icon: 'fa-gauge-high',   l: 'Compteurs',       mob: 'Compteurs' },
    { id: 'releves',   icon: 'fa-camera',       l: 'Relevés',         mob: 'Relevés'   },
    { id: 'ratios',    icon: 'fa-percent',      l: 'Ratios',          mob: 'Ratios'    },
    { id: 'analyses',  icon: 'fa-chart-bar',    l: 'Analyses',        mob: 'Analyses'  },
    { id: 'alertes',   icon: 'fa-bell',         l: 'Alertes',         mob: 'Alertes'   },
    { id: 'exports',   icon: 'fa-file-export',  l: 'Exports',         mob: 'Exports'   },
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

  // ── TAB: COMPTEURS ──
  function _tCompteurs() {
    let html = `<div class="cso-inner">
      <div class="cso-ph">
        <div class="cso-ph-ttl"><i class="fas fa-gauge-high"></i> ${_meters.length} compteur${_meters.length !== 1 ? 's' : ''}</div>
        <button class="cso-add-btn" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Nouveau compteur</button>
      </div>`;

    if (!_meters.length) {
      html += `<div class="cso-empty-st">
        <div class="cso-empty-ico"><i class="fas fa-gauge-high"></i></div>
        <div class="cso-empty-ttl">Aucun compteur configuré</div>
        <div class="cso-empty-sub">Ajoutez votre premier compteur pour commencer à enregistrer vos consommations.</div>
        <button class="cso-add-btn" style="margin-top:8px" onclick="MX.Pages.Conso._meterForm(null)"><i class="fas fa-plus"></i> Ajouter un compteur</button>
      </div>`;
    } else {
      Object.entries(MT).forEach(([type, meta]) => {
        const list = _meters.filter(m => m.type === type);
        if (!list.length) return;
        html += `<div class="cso-type-sec">
          <div class="cso-type-hd">${meta.icon} ${meta.label}</div>
          <div class="cso-mcard-grid">`;

        list.forEach(m => {
          const mReadings = _readings.filter(r => r.meterId === m.id);
          const lr   = mReadings[0];
          const unit = m.unit || meta.unit;
          const deltaHtml = (lr && lr.consumption != null)
            ? `<div class="cso-mc-delta"><i class="fas fa-arrow-trend-up"></i> +${_fmt(lr.consumption)} ${esc(unit)} relevé précédent</div>`
            : '';

          html += `<div class="cso-mcard">
            <div class="cso-mcard-top" style="background:linear-gradient(135deg,${meta.color}22 0%,${meta.color}0a 100%);border-bottom:2px solid ${meta.color}55">
              <span class="cso-mcard-emoji">${meta.icon}</span>
              <span class="cso-mcard-type" style="color:${meta.color}">${meta.label}</span>
              ${m.location ? `<span class="cso-mcard-loc"><i class="fas fa-location-dot"></i> ${esc(m.location)}</span>` : ''}
            </div>
            <div class="cso-mcard-body">
              <div class="cso-mcard-name">${esc(m.name)}</div>
              <div class="cso-mcard-idx-wrap">
                <div class="cso-mcard-idx-lbl">Index actuel</div>
                <div class="cso-mcard-idx-val">${lr ? _fmt(lr.index, 1) : '—'}<span class="cso-mcard-u"> ${esc(unit)}</span></div>
              </div>
              <div class="cso-mcard-last">
                ${lr
                  ? `<i class="fas fa-clock"></i> ${_dateLbl(lr.date)}${lr.technicienName ? ` · <b>${esc(lr.technicienName)}</b>` : ''}`
                  : `<span style="color:var(--text3)"><i class="fas fa-ban"></i> Aucun relevé</span>`}
              </div>
              ${deltaHtml}
            </div>
            <div class="cso-mcard-acts">
              <button class="cso-mact primary" onclick="MX.Pages.Conso._newReading('${m.id}')">
                <i class="fas fa-camera"></i><span class="cso-mact-txt"> Relevé</span>
              </button>
              <button class="cso-mact" onclick="MX.Pages.Conso._meterHistory('${m.id}')">
                <i class="fas fa-chart-line"></i><span class="cso-mact-txt"> Historique</span>
              </button>
              <button class="cso-mact" onclick="MX.Pages.Conso._meterForm('${m.id}')">
                <i class="fas fa-pen"></i>
              </button>
              <button class="cso-mact del" onclick="MX.Pages.Conso._delMeter('${m.id}','${esc(m.name)}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>`;
        });

        html += `</div></div>`;
      });
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
        <button class="cso-cli-btn" onclick="MX.Pages.Conso._editCli('${today}',${cli})"><i class="fas fa-pen"></i> Modifier</button>
      </div>`;

    if (cli === 0) {
      html += `<div class="cso-empty-st">
        <div class="cso-empty-ico"><i class="fas fa-users-slash"></i></div>
        <div class="cso-empty-ttl">Nombre de clients manquant</div>
        <div class="cso-empty-sub">Saisissez le nombre de clients présents pour calculer les ratios.</div>
      </div>`;
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

    let html = `<div class="cso-inner">
      <div class="cso-ph">
        <div class="cso-ph-ttl"><i class="fas fa-bell"></i> Alertes automatiques</div>
      </div>`;

    if (!todayReadings.length) {
      html += `<div class="cso-empty-st">
        <div class="cso-empty-ico"><i class="fas fa-bell-slash"></i></div>
        <div class="cso-empty-ttl">Aucun relevé aujourd'hui</div>
        <div class="cso-empty-sub">Effectuez des relevés pour activer la détection des anomalies.</div>
        <button class="cso-add-btn" style="margin-top:8px" onclick="MX.Pages.Conso._newReading(null)"><i class="fas fa-camera"></i> Nouveau relevé</button>
      </div>`;
    } else if (!cli) {
      html += `<div class="cso-empty-st">
        <div class="cso-empty-ico"><i class="fas fa-users-slash"></i></div>
        <div class="cso-empty-ttl">Nombre de clients manquant</div>
        <div class="cso-empty-sub">Saisissez le nombre de clients présents pour activer les alertes de ratio.</div>
        <button class="cso-add-btn" style="margin-top:8px" onclick="MX.Pages.Conso._editCli('${today}',0)"><i class="fas fa-pen"></i> Saisir les clients</button>
      </div>`;
    } else {
      const SUGG = {
        eau_froide:  ['Vérifier les WC', 'Contrôler les réseaux', 'Détecter les fuites'],
        eau_chaude:  ['Vérifier la production ECS', 'Contrôler les douches'],
        electricite: ['Vérifier la climatisation', 'Contrôler l\'éclairage'],
        gaz:         ['Vérifier la chaudière', 'Contrôler les brûleurs'],
      };

      let hasAny = false;
      let alertsHtml = '';
      let okHtml = '';

      Object.entries(MT).forEach(([type, meta]) => {
        const ids = _meters.filter(m => m.type === type).map(m => m.id);
        if (!ids.length) return;
        const conso = todayReadings.filter(r => ids.includes(r.meterId)).reduce((s, r) => s + (r.consumption || 0), 0);
        if (!conso) return;
        hasAny = true;
        const isW    = type === 'eau_froide' || type === 'eau_chaude';
        const todayR = isW ? conso * 1000 / cli : conso / cli;
        const rU     = isW ? 'L/client' : `${meta.unit}/client`;
        const avgs   = [];
        for (let i = 1; i <= 7; i++) {
          const ds = _daysAgo(i), c = _clients[ds] || 0;
          if (!c) continue;
          const cv = _readings.filter(r => ids.includes(r.meterId) && r.date === ds).reduce((s, r) => s + (r.consumption || 0), 0);
          if (cv) avgs.push(isW ? cv * 1000 / c : cv / c);
        }
        const avg7 = avgs.length ? avgs.reduce((a, b) => a + b) / avgs.length : 0;
        const dev  = avg7 > 0 ? (todayR - avg7) / avg7 * 100 : 0;
        const lvl  = Math.abs(dev) < 20 ? 'ok' : Math.abs(dev) < 60 ? 'warn' : 'crit';

        if (lvl !== 'ok') {
          const pctStr = `${dev > 0 ? '+' : ''}${Math.round(dev)}%`;
          alertsHtml += `<div class="cso-av2 ${lvl}">
            <div class="cso-av2-left">
              <div class="cso-av2-badge ${lvl}">${lvl === 'crit' ? '🚨 Critique' : '⚠️ Avertissement'}</div>
              <div class="cso-av2-pct ${lvl}">${pctStr}</div>
              <div class="cso-av2-pct-lbl">par rapport à la moyenne</div>
            </div>
            <div class="cso-av2-right">
              <div class="cso-av2-name">${meta.icon} ${meta.label}</div>
              <div class="cso-av2-vals">
                <div class="cso-av2-val-item">
                  <div class="cso-av2-val-lbl">Aujourd'hui</div>
                  <div class="cso-av2-val-n">${_fmt(todayR, isW ? 0 : 2)} <span>${rU}</span></div>
                </div>
                ${avg7 > 0 ? `<div class="cso-av2-val-item">
                  <div class="cso-av2-val-lbl">Moy. 7 jours</div>
                  <div class="cso-av2-val-n">${_fmt(avg7, isW ? 0 : 2)} <span>${rU}</span></div>
                </div>` : ''}
              </div>
              ${(SUGG[type] || []).length ? `<div class="cso-av2-sugg">
                ${(SUGG[type] || []).map(s => `<span class="cso-av2-pill">${s}</span>`).join('')}
              </div>` : ''}
            </div>
          </div>`;
        } else {
          okHtml += `<div class="cso-av2 ok">
            <div class="cso-av2-ok-ico">✅</div>
            <div class="cso-av2-right">
              <div class="cso-av2-name">${meta.icon} ${meta.label}</div>
              <div class="cso-av2-ok-desc">${_fmt(todayR, isW ? 0 : 2)} ${rU}${avg7 > 0 ? ` · Moy. 7j : ${_fmt(avg7, isW ? 0 : 2)} ${rU}` : ''}</div>
            </div>
          </div>`;
        }
      });

      if (!hasAny) {
        html += `<div class="cso-empty-st">
          <div class="cso-empty-ico"><i class="fas fa-bell-slash"></i></div>
          <div class="cso-empty-ttl">Aucune consommation relevée</div>
          <div class="cso-empty-sub">Les alertes s'activent dès que des relevés sont disponibles.</div>
        </div>`;
      } else {
        if (alertsHtml) {
          html += `<div class="cso-alert-sec">
            <div class="cso-alert-sec-ttl">🚨 Anomalies détectées</div>
            ${alertsHtml}
          </div>`;
        }
        if (okHtml) {
          html += `<div class="cso-alert-sec">
            <div class="cso-alert-sec-ttl">✅ Consommations normales</div>
            ${okHtml}
          </div>`;
        }
      }
    }
    return html + '</div>';
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
          <div class="cso-hist-idx">${_fmt(r.index, 1)}<span class="cso-hist-u"> ${esc(unit)}</span></div>
          <div class="cso-hist-conso">${r.consumption != null ? `+${_fmt(r.consumption)}` : '—'}</div>
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
      MX.toast(consumption !== null ? `Relevé enregistré · +${_fmt(consumption)} ${m.unit}` : 'Relevé enregistré');
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
    _newReading, _onPhoto, _showPhoto, _meterHistory,
    _allMeters, _csv, _pdf,
  };
})();
