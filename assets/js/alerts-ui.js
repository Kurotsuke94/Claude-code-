// ── MX.Alerts — unified alert model for the technician dashboard,
// the "toutes les alertes" view and (indirectly, via shared fields)
// the notification center. Merges two live sources:
//   • triggered_alerts (alerts-engine.js — checklist/planning/missions rules)
//   • cso_energy_alerts (meter overconsumption)
// Never deletes or auto-resolves anything on its own — resolution only
// happens where the underlying detector already decided it (alerts-engine's
// _resolveIfActive, the CSO Cloud Function) or via an explicit "Acquitter".
(function () {
  'use strict';

  // Only 3 buckets are ever shown, matching the dashboard spec exactly.
  // Red is reserved for 'critical' — everything else uses orange/blue.
  const LEVEL_META = {
    critical:  { label: 'Critique',    color: '#EF4444', bg: 'rgba(239,68,68,0.14)' },
    important: { label: 'Important',   color: '#F97316', bg: 'rgba(249,115,22,0.14)' },
    info:      { label: 'Information', color: '#3B82F6', bg: 'rgba(59,130,246,0.14)' },
  };
  function _levelMeta(level) {
    if (level === 'critical')  return LEVEL_META.critical;
    if (level === 'important') return LEVEL_META.important;
    return LEVEL_META.info;
  }

  const KIND_META = {
    checklist: { icon: 'fa-list-check' },
    planning:  { icon: 'fa-calendar-days' },
    missions:  { icon: 'fa-wrench' },
    tech:      { icon: 'fa-user-clock' },
    counter:   { icon: 'fa-gauge-high' },
    generic:   { icon: 'fa-bell' },
  };

  function _tsMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts.seconds) return ts.seconds * 1000;
    const n = new Date(ts).getTime();
    return isNaN(n) ? 0 : n;
  }
  function _fmtWhen(ts) {
    const ms = _tsMs(ts);
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60000)    return "à l'instant";
    if (diff < 3600000)  return 'il y a ' + Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return 'il y a ' + Math.floor(diff / 3600000) + 'h';
    const d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Normalization ──
  function _fromTriggered(a) {
    const kind = a.kind || 'generic';
    return {
      id: a.id, source: 'rule', kind,
      level: a.level || 'warning',
      icon: (KIND_META[kind] || KIND_META.generic).icon,
      title: a.ruleName || 'Alerte',
      description: a.message || '',
      location: a.location || '',
      ts: a.ts,
      status: a.status === 'resolved' ? 'resolved' : 'active',
      acknowledged: !!a.acknowledged,
      raw: a,
    };
  }
  function _fromCso(a) {
    return {
      id: a.id, source: 'cso', kind: 'counter',
      level: a.level || 'warning',
      icon: KIND_META.counter.icon,
      title: 'Surconsommation détectée — ' + (a.meterName || 'Compteur'),
      description: a.msg || '',
      location: a.zone || a.meterName || '',
      ts: a.ts,
      status: a.status === 'resolved' ? 'resolved' : 'active',
      acknowledged: !!a.acknowledged,
      raw: a,
    };
  }

  function getAll() {
    const triggered = (MX.state.triggeredAlerts || []).map(_fromTriggered);
    const cso        = (MX.state.csoAlerts || []).map(_fromCso);
    return triggered.concat(cso).sort((x, y) => _tsMs(y.ts) - _tsMs(x.ts));
  }
  function getActive() {
    return getAll().filter(a => a.status === 'active' && !a.acknowledged);
  }
  function activeCount() { return getActive().length; }

  // ── Navigation target ──
  function _goTo(a) {
    if (a.source === 'cso') { window._csoStartTab = 'compteurs'; MX.showPage('consommations'); return; }
    if (a.kind === 'checklist') { MX.showPage(MX.todayId()); return; }
    if (a.kind === 'planning')  { MX.showPage('planning'); return; }
    if (a.kind === 'missions')  { MX.showPage('interventions'); return; }
  }
  function _hasDestination(a) {
    return a.source === 'cso' || a.kind === 'checklist' || a.kind === 'planning' || a.kind === 'missions';
  }

  function _acknowledge(a) {
    if (a.source === 'cso') {
      if (MX.Pages.Conso && MX.Pages.Conso._resolveAlert) MX.Pages.Conso._resolveAlert(a.id);
    } else {
      MX.DB.acknowledgeAlert(a.id).catch(function () {});
    }
    MX.closeModal();
  }

  // ── Card (dashboard + "toutes les alertes") ──
  function _cardHtml(a) {
    const lm  = _levelMeta(a.level);
    const esc = MX.esc;
    return '<div class="mxa-card" data-src="' + a.source + '" data-id="' + esc(a.id) + '" '
      + 'onclick="MX.Alerts.openDetail(this.dataset.src,this.dataset.id)">'
      + '<div class="mxa-card-ico" style="background:' + lm.bg + ';color:' + lm.color + '"><i class="fas ' + a.icon + '"></i></div>'
      + '<div class="mxa-card-body">'
      + '<div class="mxa-card-top">'
      + '<span class="mxa-lvl-tag" style="background:' + lm.bg + ';color:' + lm.color + '">' + lm.label + '</span>'
      + (a.status === 'resolved' ? '<span class="mxa-resolved-tag"><i class="fas fa-check"></i> Résolue</span>' : '')
      + (a.ts ? '<span class="mxa-card-time">' + _fmtWhen(a.ts) + '</span>' : '')
      + '</div>'
      + '<div class="mxa-card-title">' + esc(a.title) + '</div>'
      + (a.description ? '<div class="mxa-card-desc">' + esc(a.description) + '</div>' : '')
      + (a.location ? '<div class="mxa-card-loc"><i class="fas fa-location-dot"></i> ' + esc(a.location) + '</div>' : '')
      + '</div>'
      + '<i class="fas fa-chevron-right mxa-card-chev"></i>'
      + '</div>';
  }

  // ── Dashboard section (replaces the old "Alertes actives" block) ──
  function renderDashboardSection() {
    const active = getActive();
    if (!active.length) return '';
    const shown = active.slice(0, 5);
    let h = '<div class="dxp-section dxp-section--alert">'
      + '<div class="dxp-hd"><i class="fas fa-triangle-exclamation dxp-ico" style="color:#ef4444"></i>'
      + '<span>Alertes actives</span>'
      + '<span class="dxp-badge dxp-badge--red">' + active.length + '</span>'
      + '</div>'
      + '<div class="mxa-list">' + shown.map(_cardHtml).join('') + '</div>'
      + '<button class="mxa-viewall-btn" onclick="MX.Alerts.openAll()"><i class="fas fa-list-ul"></i> Voir toutes les alertes</button>'
      + '</div>';
    return h;
  }

  // ── Detail modal ──
  function openDetail(source, id) {
    const a = getAll().find(function (x) { return x.source === source && x.id === id; });
    if (!a) return;
    const lm  = _levelMeta(a.level);
    const esc = MX.esc;

    let extra = '';
    if (a.source === 'cso' && a.raw) {
      const r = a.raw;
      extra = '<div class="mxa-detail-grid">'
        + '<div class="mxa-detail-cell"><span class="mxa-detail-lbl">Mesuré</span><b>' + esc(String(r.measured != null ? r.measured : '—')) + ' ' + esc(r.unit || '') + '</b></div>'
        + '<div class="mxa-detail-cell"><span class="mxa-detail-lbl">Habituel</span><b>' + esc(String(r.reference != null ? r.reference : '—')) + ' ' + esc(r.unit || '') + '</b></div>'
        + '<div class="mxa-detail-cell"><span class="mxa-detail-lbl">Écart</span><b style="color:' + lm.color + '">' + (r.ecart > 0 ? '+' : '') + esc(String(r.ecart != null ? r.ecart : '—')) + '%</b></div>'
        + '</div>';
    }

    const sinceTs = (a.raw && a.raw.firstTriggeredAt) || a.ts;
    const rows = ''
      + (a.location ? '<div class="mxa-detail-row"><i class="fas fa-location-dot"></i> ' + esc(a.location) + '</div>' : '')
      + (sinceTs ? '<div class="mxa-detail-row"><i class="fas fa-clock"></i> Depuis ' + esc(_fmtWhen(sinceTs)) + '</div>' : '');

    const actions = [];
    if (_hasDestination(a)) {
      actions.push({ label: '<i class="fas fa-arrow-right"></i> Voir la page concernée', cls: 'confirm', fn: function () { _goTo(a); } });
    }
    if (a.status === 'active' && !a.acknowledged) {
      actions.push({ label: '<i class="fas fa-check"></i> Acquitter', cls: 'cancel', fn: function () { _acknowledge(a); } });
    }
    actions.push({ label: 'Fermer', cls: 'cancel' });

    MX.showModal({
      title: '<span style="color:' + lm.color + '"><i class="fas ' + a.icon + '"></i></span> ' + esc(a.title),
      sub: lm.label + (a.status === 'resolved' ? ' · Résolue' : ' · Active'),
      body: (a.description ? '<p style="margin:0 0 10px;color:var(--text2);font-size:13px;line-height:1.5">' + esc(a.description) + '</p>' : '')
        + rows + extra,
      actions: actions,
    });
  }

  // ── "Toutes les alertes" modal with filter tabs ──
  let _allFilter = 'active';
  function openAll() { _allFilter = 'active'; _renderAllModal(); }
  function _setAllFilter(f) { _allFilter = f; _renderAllModal(); }
  function _renderAllModal() {
    const all       = getAll();
    const activeAll = all.filter(function (a) { return a.status === 'active' && !a.acknowledged; });
    const resolved  = all.filter(function (a) { return a.status === 'resolved'; }).slice(0, 50);
    const counts = {
      active:    activeAll.length,
      critical:  activeAll.filter(function (a) { return a.level === 'critical'; }).length,
      important: activeAll.filter(function (a) { return a.level === 'important'; }).length,
      resolved:  resolved.length,
    };
    let list;
    if (_allFilter === 'critical')       list = activeAll.filter(function (a) { return a.level === 'critical'; });
    else if (_allFilter === 'important') list = activeAll.filter(function (a) { return a.level === 'important'; });
    else if (_allFilter === 'resolved')  list = resolved;
    else                                 list = activeAll;

    const TABS = [
      { id: 'active',    l: 'Toutes',      cnt: counts.active },
      { id: 'critical',  l: 'Critiques',   cnt: counts.critical },
      { id: 'important', l: 'Importantes', cnt: counts.important },
      { id: 'resolved',  l: 'Résolues',    cnt: counts.resolved },
    ];
    const tabsHtml = TABS.map(function (t) {
      return '<button class="mxa-tab' + (_allFilter === t.id ? ' mxa-tab--on' : '') + '" onclick="MX.Alerts._setAllFilter(\'' + t.id + '\')">'
        + t.l + (t.cnt ? ' <span class="mxa-tab-cnt">' + t.cnt + '</span>' : '') + '</button>';
    }).join('');
    const listHtml = list.length
      ? '<div class="mxa-list mxa-list--modal">' + list.map(_cardHtml).join('') + '</div>'
      : '<div class="mxa-empty"><i class="fas fa-circle-check"></i> Aucune alerte ici</div>';

    MX.showModal({
      title: '<i class="fas fa-bell"></i> Toutes les alertes',
      sub: '',
      body: '<div class="mxa-tabs">' + tabsHtml + '</div>' + listHtml,
      actions: [{ label: 'Fermer', cls: 'cancel' }],
    });
  }

  window.MX = window.MX || {};
  window.MX.Alerts = {
    getAll, getActive, activeCount,
    renderDashboardSection, openDetail, openAll, _setAllFilter,
  };
})();
