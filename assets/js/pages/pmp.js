(function () {
  'use strict';

  var FV = firebase.firestore.FieldValue;

  var _curTab          = 'dashboard';
  var _pmpEq           = [];
  var _pmpInt          = [];
  var _pmpTpl          = [];
  var _loaded          = false;
  var _unsubPmp        = {};
  var _calMonth        = '';
  var _importStep      = 1;
  var _importRawRows   = [];
  var _importHeaders   = [];
  var _importMapping   = {};
  var _importUnmapped  = [];
  var _importAnalysis  = null;
  var _importUserMap   = {};
  var _importResult    = null;
  var _eqSearch        = '';
  var _eqTypeFilter    = 'all';
  var _intStatusFilter = 'all';

  var PMP_DB = {
    eq:  function () { return db.collection('pmp_equipments');   },
    int: function () { return db.collection('pmp_interventions'); },
    tpl: function () { return db.collection('pmp_templates');    },
  };

  var EQ_TYPES = {
    cta:          { l: 'CTA',               icon: '🌀' },
    groupe_froid: { l: 'Groupe Froid',      icon: '❄️' },
    ecs:          { l: 'ECS',               icon: '🔥' },
    ssi:          { l: 'SSI',               icon: '🚨' },
    ascenseur:    { l: 'Ascenseur',         icon: '🛗' },
    tgbt:         { l: 'TGBT',             icon: '⚡' },
    pompe:        { l: 'Pompe',             icon: '💧' },
    adoucisseur:  { l: 'Adoucisseur',       icon: '💎' },
    porte_auto:   { l: 'Porte automatique', icon: '🚪' },
    vmc:          { l: 'VMC',              icon: '💨' },
    eclairage:    { l: 'Éclairage',         icon: '💡' },
    divers:       { l: 'Divers',            icon: '🔧' },
  };

  var FREQS = [
    { v: 7,   l: '7 jours – Hebdomadaire'  },
    { v: 15,  l: '15 jours'                },
    { v: 30,  l: '30 jours – Mensuel'      },
    { v: 60,  l: '60 jours'                },
    { v: 90,  l: '90 jours – Trimestriel'  },
    { v: 180, l: '180 jours – Semestriel'  },
    { v: 365, l: '365 jours – Annuel'      },
  ];

  var CRIT = {
    faible:   { l: 'Faible',   c: '#6B7280' },
    normale:  { l: 'Normale',  c: '#3B82F6' },
    haute:    { l: 'Haute',    c: '#F97316' },
    critique: { l: 'Critique', c: '#EF4444' },
  };

  var INT_ST = {
    planifiee: { l: 'Planifiée',  c: '#F59E0B', bg: 'rgba(245,158,11,.12)'  },
    en_cours:  { l: 'En cours',   c: '#F97316', bg: 'rgba(249,115,22,.12)'  },
    terminee:  { l: 'Terminée',   c: '#22C55E', bg: 'rgba(34,197,94,.12)'   },
    en_retard: { l: 'En retard',  c: '#EF4444', bg: 'rgba(239,68,68,.12)'   },
  };

  var TABS = [
    { id: 'dashboard',     icon: 'fa-gauge',                l: 'Tableau de bord', mob: 'Board'    },
    { id: 'equipements',   icon: 'fa-wrench',               l: 'Équipements',     mob: 'Équip.'   },
    { id: 'calendrier',    icon: 'fa-calendar-days',        l: 'Calendrier',      mob: 'Cal.'     },
    { id: 'interventions', icon: 'fa-clipboard-list',       l: 'Interventions',   mob: 'PMP'      },
    { id: 'retards',       icon: 'fa-triangle-exclamation', l: 'Retards',         mob: 'Retards'  },
    { id: 'modeles',       icon: 'fa-layer-group',          l: 'Modèles',         mob: 'Modèles'  },
    { id: 'import',        icon: 'fa-file-excel',           l: 'Import Excel',    mob: 'Import'   },
    { id: 'historique',    icon: 'fa-clock-rotate-left',    l: 'Historique',      mob: 'Histo.'   },
  ];

  // ── HELPERS ──────────────────────────────────────────────────────────────

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  function _addDays(ds, n) {
    var d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function _dateLbl(s) {
    if (!s) return '—';
    var p = s.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function _author() {
    var cu = MX.state.currentUser;
    var ad = MX.state.adminUser;
    return (cu && cu.name) || (ad && ad.email) || 'Système';
  }

  function esc(s) {
    return MX.esc ? MX.esc(s) : String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _freqLbl(v) {
    var f = FREQS.find(function (x) { return x.v === v; });
    return f ? f.l : (v ? v + ' jours' : '—');
  }

  function _daysLate(dueDate) {
    if (!dueDate) return 0;
    var today = _today();
    if (dueDate >= today) return 0;
    return Math.floor((new Date(today + 'T00:00:00') - new Date(dueDate + 'T00:00:00')) / 86400000);
  }

  // ── DATA LOADING ──────────────────────────────────────────────────────────

  function _load() {
    if (_loaded) return;
    _loaded = true;

    _unsubPmp.eq = PMP_DB.eq().onSnapshot(function (snap) {
      _pmpEq = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    });
    _unsubPmp.int = PMP_DB.int().onSnapshot(function (snap) {
      _pmpInt = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    });
    _unsubPmp.tpl = PMP_DB.tpl().onSnapshot(function (snap) {
      _pmpTpl = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    });

    setTimeout(_checkAndGenerate, 2500);
  }

  // ── AUTO-GENERATION ───────────────────────────────────────────────────────

  async function _checkAndGenerate() {
    if (window._pmpGenDone) return;
    window._pmpGenDone = true;
    var today    = _today();
    var activeEq = _pmpEq.filter(function (e) { return e.status !== 'inactif'; });
    for (var i = 0; i < activeEq.length; i++) {
      var eq = activeEq[i];
      if (!eq.nextDue || eq.nextDue > today) continue;
      var existing = _pmpInt.find(function (x) {
        return x.equipmentId === eq.id && x.dueDate === eq.nextDue &&
               (x.status === 'planifiee' || x.status === 'en_cours');
      });
      if (existing) continue;
      try {
        var intRef = await PMP_DB.int().add({
          equipmentId:   eq.id,
          equipmentName: eq.name,
          type:          eq.type || 'divers',
          zone:          eq.zone || '',
          dueDate:       eq.nextDue,
          frequency:     eq.frequency || 30,
          technician:    eq.technician || '',
          criticite:     eq.criticite || 'normale',
          status:        eq.nextDue < today ? 'en_retard' : 'planifiee',
          source:        'auto',
          createdAt:     FV.serverTimestamp(),
        });
        if (eq.technician && MX.DB && MX.DB.addMission) {
          await MX.DB.addMission({
            text:       '🛠️ PMP - ' + eq.name,
            dayId:      'all',
            assignedTo: eq.technician,
            priority:   eq.criticite === 'critique' ? 'urgent' : 'normale',
            category:   'pmp',
            isPmp:      true,
            pmpIntId:   intRef.id,
            createdBy:  'PMP Auto',
          });
        }
      } catch (e) {
        console.warn('[PMP] auto-gen:', e.message);
      }
    }
  }

  // ── KPI ──────────────────────────────────────────────────────────────────

  function _kpiData() {
    var today     = _today();
    var thisMonth = today.slice(0, 7);
    var activeEq  = _pmpEq.filter(function (e) { return e.status !== 'inactif'; });
    var monthInts = _pmpInt.filter(function (i) { return (i.dueDate || '').startsWith(thisMonth); });
    var realisees = monthInts.filter(function (i) { return i.status === 'terminee'; }).length;
    var enRetard  = _pmpInt.filter(function (i) {
      return i.status === 'en_retard' ||
             (i.dueDate && i.dueDate < today && i.status !== 'terminee' && i.status !== 'annulee');
    }).length;
    var conformite = monthInts.length ? Math.round(realisees / monthInts.length * 100) : 100;
    var upcoming   = _pmpInt
      .filter(function (i) {
        return i.dueDate >= today && i.dueDate <= _addDays(today, 7) && i.status !== 'terminee';
      })
      .sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); });
    var nextDue = upcoming.length ? upcoming[0].dueDate : null;
    return {
      totalEq:        activeEq.length,
      thisMonthCount: monthInts.length,
      realisees:      realisees,
      enRetard:       enRetard,
      conformite:     conformite,
      nextDue:        nextDue,
    };
  }

  function _conformite() { return _kpiData().conformite; }

  // ── RENDER ────────────────────────────────────────────────────────────────

  function render() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    _load();
    var startTab = window._pmpStartTab || _curTab;
    window._pmpStartTab = null;
    _curTab = startTab;
    mc.innerHTML =
      '<div class="pmp-page">' +
        '<div class="pmp-header">' +
          '<div class="pmp-header-icon"><i class="fas fa-screwdriver-wrench"></i></div>' +
          '<div>' +
            '<div class="pmp-header-title">Maintenance Préventive</div>' +
            '<div class="pmp-header-sub">Plan de maintenance intégré Maintix</div>' +
          '</div>' +
        '</div>' +
        '<div class="pmp-tabs" id="pmp-tabs">' + _tabsHtml() + '</div>' +
        '<div class="pmp-body" id="pmp-body">' + _body() + '</div>' +
      '</div>';
  }

  function _tabsHtml() {
    return TABS.map(function (t) {
      var act = _curTab === t.id;
      return '<button class="pmp-tab-btn' + (act ? ' active' : '') + '" onclick="MX.Pages.PMP._tab(\'' + t.id + '\')">' +
        '<i class="fas ' + t.icon + '"></i>' +
        '<span class="pmp-tab-lbl">' + t.l + '</span>' +
        '<span class="pmp-tab-mob">' + t.mob + '</span>' +
        '</button>';
    }).join('');
  }

  function _rerender() {
    var body = document.getElementById('pmp-body');
    if (!body) return;
    body.innerHTML = _body();
    var tabs = document.getElementById('pmp-tabs');
    if (tabs) tabs.innerHTML = _tabsHtml();
  }

  function _tab(id) { _curTab = id; _rerender(); }

  function _body() {
    if (_curTab === 'dashboard')     return _tDashboard();
    if (_curTab === 'equipements')   return _tEquipements();
    if (_curTab === 'calendrier')    return _tCalendrier();
    if (_curTab === 'interventions') return _tInterventions();
    if (_curTab === 'retards')       return _tRetards();
    if (_curTab === 'modeles')       return _tModeles();
    if (_curTab === 'import')        return _tImport();
    if (_curTab === 'historique')    return _tHistorique();
    return '';
  }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────

  function _tDashboard() {
    var kpi   = _kpiData();
    var today = _today();
    var R = 34, CX = 50, CY = 50, C = 2 * Math.PI * R;
    var dc    = kpi.conformite >= 80 ? '#22C55E' : kpi.conformite >= 50 ? '#F97316' : '#EF4444';
    var dashD = (kpi.conformite / 100) * C;
    var dashR = C - dashD;
    var donut =
      '<svg viewBox="0 0 100 100" width="88" height="88" style="flex-shrink:0">' +
        '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--bg4)" stroke-width="10"/>' +
        '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="' + dc + '" stroke-width="10"' +
        ' stroke-dasharray="' + dashD.toFixed(1) + ' ' + dashR.toFixed(1) + '"' +
        ' stroke-linecap="round" transform="rotate(-90 ' + CX + ' ' + CY + ')"/>' +
        '<text x="' + CX + '" y="' + (CY - 4) + '" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)" font-family="var(--ffm)">' + kpi.conformite + '</text>' +
        '<text x="' + CX + '" y="' + (CY + 11) + '" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="var(--ffm)">%</text>' +
      '</svg>';

    var upcoming7 = _pmpInt
      .filter(function (i) {
        return i.dueDate >= today && i.dueDate <= _addDays(today, 7) && i.status !== 'terminee';
      })
      .sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); })
      .slice(0, 5);

    var lateInts = _pmpInt.filter(function (i) {
      return i.status === 'en_retard' ||
             (i.dueDate && i.dueDate < today && i.status !== 'terminee' && i.status !== 'annulee');
    });

    var h = '<div class="pmp-dash">';

    // ── Conformité + KPI grid ──
    h += '<div class="pmp-dash-top">';
    h += '<div class="pmp-conf-card">' + donut +
      '<div><div class="pmp-conf-lbl">Conformité ' + today.slice(0, 7).replace('-', '/') + '</div>' +
      '<div class="pmp-conf-sub">' + kpi.realisees + ' / ' + kpi.thisMonthCount + ' réalisées</div></div></div>';

    h += '<div class="pmp-kpi-grid">';
    h += '<div class="pmp-kpi" onclick="MX.Pages.PMP._tab(\'equipements\')">' +
      '<i class="fas fa-wrench pmp-kpi-ico" style="color:var(--cyan)"></i>' +
      '<div class="pmp-kpi-val">' + kpi.totalEq + '</div>' +
      '<div class="pmp-kpi-lbl">Équipements</div></div>';
    h += '<div class="pmp-kpi" onclick="MX.Pages.PMP._tab(\'interventions\')">' +
      '<i class="fas fa-clipboard-list pmp-kpi-ico" style="color:var(--jour)"></i>' +
      '<div class="pmp-kpi-val">' + kpi.thisMonthCount + '</div>' +
      '<div class="pmp-kpi-lbl">Du mois</div></div>';
    h += '<div class="pmp-kpi" onclick="MX.Pages.PMP._tab(\'historique\')">' +
      '<i class="fas fa-check-circle pmp-kpi-ico" style="color:var(--green)"></i>' +
      '<div class="pmp-kpi-val">' + kpi.realisees + '</div>' +
      '<div class="pmp-kpi-lbl">Réalisées</div></div>';
    h += '<div class="pmp-kpi' + (kpi.enRetard > 0 ? ' pmp-kpi--alert' : '') + '" onclick="MX.Pages.PMP._tab(\'retards\')">' +
      '<i class="fas fa-triangle-exclamation pmp-kpi-ico" style="color:' + (kpi.enRetard > 0 ? 'var(--red)' : 'var(--text3)') + '"></i>' +
      '<div class="pmp-kpi-val" style="color:' + (kpi.enRetard > 0 ? 'var(--red)' : 'var(--text)') + '">' + kpi.enRetard + '</div>' +
      '<div class="pmp-kpi-lbl">En retard</div></div>';
    h += '<div class="pmp-kpi">' +
      '<i class="fas fa-calendar-check pmp-kpi-ico" style="color:var(--orange)"></i>' +
      '<div class="pmp-kpi-val" style="font-size:13px">' + (kpi.nextDue ? _dateLbl(kpi.nextDue) : '—') + '</div>' +
      '<div class="pmp-kpi-lbl">Prochaine</div></div>';
    h += '</div></div>';

    // ── À venir — 7 jours ──
    h += '<div class="pmp-dash-section"><div class="pmp-section-ttl"><i class="fas fa-calendar-days"></i> À venir — 7 jours</div>';
    if (!upcoming7.length) {
      h += '<div class="pmp-empty">Aucune intervention dans les 7 prochains jours</div>';
    } else {
      h += '<div class="pmp-int-list">';
      upcoming7.forEach(function (i) {
        var st = INT_ST[i.status] || INT_ST.planifiee;
        var eq = _pmpEq.find(function (e) { return e.id === i.equipmentId; });
        var ti = eq ? (EQ_TYPES[eq.type] || { icon: '🔧' }) : { icon: '🔧' };
        h += '<div class="pmp-int-row" onclick="MX.Pages.PMP._tab(\'interventions\')">' +
          '<div class="pmp-int-type">' + ti.icon + '</div>' +
          '<div class="pmp-int-info"><div class="pmp-int-name">' + esc(i.equipmentName || '—') + '</div>' +
          '<div class="pmp-int-sub">' + esc(i.zone || '') + (i.technician ? ' · ' + esc(i.technician) : '') + '</div></div>' +
          '<div class="pmp-int-date">' + _dateLbl(i.dueDate) + '</div>' +
          '<div class="pmp-int-st" style="color:' + st.c + ';background:' + st.bg + '">' + st.l + '</div>' +
          '</div>';
      });
      h += '</div>';
    }
    h += '</div>';

    // ── Retards ──
    if (lateInts.length > 0) {
      h += '<div class="pmp-dash-section"><div class="pmp-section-ttl pmp-section-ttl--alert">' +
        '<i class="fas fa-triangle-exclamation"></i> Retards (' + lateInts.length + ')</div>';
      h += '<div class="pmp-int-list">';
      lateInts.slice(0, 5).forEach(function (i) {
        var d  = _daysLate(i.dueDate);
        var eq = _pmpEq.find(function (e) { return e.id === i.equipmentId; });
        var ti = eq ? (EQ_TYPES[eq.type] || { icon: '🔧' }) : { icon: '🔧' };
        h += '<div class="pmp-int-row pmp-int-row--late">' +
          '<div class="pmp-int-type">' + ti.icon + '</div>' +
          '<div class="pmp-int-info"><div class="pmp-int-name">' + esc(i.equipmentName || '—') + '</div>' +
          '<div class="pmp-int-sub">' + esc(i.technician || '—') + '</div></div>' +
          '<div class="pmp-retard-days">' + d + 'j</div>' +
          '<button class="pmp-done-btn" onclick="event.stopPropagation();MX.Pages.PMP._markDone(\'' + esc(i.id) + '\')">' +
          '<i class="fas fa-check"></i> Valider</button>' +
          '</div>';
      });
      h += '</div></div>';
    }

    h += '</div>';
    return h;
  }

  // ── ÉQUIPEMENTS ───────────────────────────────────────────────────────────

  function _tEquipements() {
    var today    = _today();
    var filtered = _pmpEq.slice();
    if (_eqSearch) {
      var s = _eqSearch.toLowerCase();
      filtered = filtered.filter(function (e) {
        return (e.name || '').toLowerCase().includes(s) ||
               (e.zone || '').toLowerCase().includes(s) ||
               (e.ref  || '').toLowerCase().includes(s);
      });
    }
    if (_eqTypeFilter !== 'all') {
      filtered = filtered.filter(function (e) { return e.type === _eqTypeFilter; });
    }
    filtered.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var h = '<div class="pmp-eq-page">';
    h += '<div class="pmp-toolbar">' +
      '<input type="text" class="pmp-search" placeholder="Rechercher…" value="' + esc(_eqSearch) + '"' +
      ' oninput="MX.Pages.PMP._setEqSearch(this.value)">' +
      '<select class="pmp-select" onchange="MX.Pages.PMP._setEqType(this.value)">' +
      '<option value="all">Tous types</option>' +
      Object.entries(EQ_TYPES).map(function (kv) {
        return '<option value="' + kv[0] + '"' + (_eqTypeFilter === kv[0] ? ' selected' : '') + '>' + kv[1].icon + ' ' + kv[1].l + '</option>';
      }).join('') +
      '</select>' +
      '<button class="pmp-add-btn" onclick="MX.Pages.PMP._eqForm(null)"><i class="fas fa-plus"></i> Ajouter</button>' +
      '</div>';

    if (!filtered.length) {
      h += '<div class="pmp-empty pmp-empty--big">' +
        '<i class="fas fa-wrench" style="font-size:32px;opacity:0.3;margin-bottom:12px;display:block"></i>' +
        '<div style="font-size:14px">' + (_pmpEq.length ? 'Aucun résultat' : 'Aucun équipement configuré') + '</div>' +
        (!_pmpEq.length ? '<button class="pmp-add-btn" style="margin-top:12px" onclick="MX.Pages.PMP._eqForm(null)"><i class="fas fa-plus"></i> Ajouter un équipement</button>' : '') +
        '</div>';
    } else {
      h += '<div class="pmp-eq-list">';
      filtered.forEach(function (eq) {
        var ti      = EQ_TYPES[eq.type]  || { icon: '🔧', l: eq.type || 'Divers' };
        var cr      = CRIT[eq.criticite] || CRIT.normale;
        var isLate  = eq.nextDue && eq.nextDue < today && eq.status !== 'inactif';
        var daysOff = eq.nextDue ? Math.round((new Date(eq.nextDue + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000) : null;
        h += '<div class="pmp-eq-card' + (isLate ? ' pmp-eq-card--late' : '') + '">' +
          '<div class="pmp-eq-card-head">' +
          '<div class="pmp-eq-ico">' + ti.icon + '</div>' +
          '<div class="pmp-eq-info"><div class="pmp-eq-name">' + esc(eq.name) + '</div>' +
          '<div class="pmp-eq-type">' + ti.l + (eq.zone ? ' · ' + esc(eq.zone) : '') + '</div></div>' +
          '<div class="pmp-eq-badge" style="color:' + cr.c + ';border-color:' + cr.c + '">' + cr.l + '</div>' +
          '</div>' +
          '<div class="pmp-eq-card-body">' +
          (eq.ref       ? '<span class="pmp-eq-meta"><i class="fas fa-tag"></i> ' + esc(eq.ref) + '</span>' : '') +
          (eq.technician ? '<span class="pmp-eq-meta"><i class="fas fa-user"></i> ' + esc(eq.technician) + '</span>' : '') +
          '<span class="pmp-eq-meta"><i class="fas fa-rotate"></i> ' + _freqLbl(eq.frequency) + '</span>' +
          (eq.nextDue ? '<span class="pmp-eq-meta' +
            (isLate ? ' pmp-eq-meta--late' : daysOff !== null && daysOff <= 7 ? ' pmp-eq-meta--warn' : '') + '">' +
            '<i class="fas fa-calendar-check"></i> ' +
            (isLate ? 'En retard de ' + Math.abs(daysOff) + 'j' : daysOff === 0 ? "Aujourd'hui" : 'Dans ' + daysOff + 'j') +
            '</span>' : '') +
          '</div>' +
          '<div class="pmp-eq-card-footer">' +
          '<span class="pmp-eq-status pmp-eq-status--' + (eq.status || 'actif') + '">' + (eq.status === 'inactif' ? 'Inactif' : 'Actif') + '</span>' +
          '<div class="pmp-eq-actions">' +
          '<button class="pmp-act-btn" onclick="MX.Pages.PMP._createInt(\'' + esc(eq.id) + '\')"><i class="fas fa-plus-circle"></i> Intervention</button>' +
          '<button class="pmp-act-btn" onclick="MX.Pages.PMP._eqForm(\'' + esc(eq.id) + '\')"><i class="fas fa-pen"></i></button>' +
          '<button class="pmp-act-btn pmp-act-btn--del" onclick="MX.Pages.PMP._delEq(\'' + eq.id + '\')"><i class="fas fa-trash"></i></button>' +
          '</div></div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── CALENDRIER ────────────────────────────────────────────────────────────

  function _tCalendrier() {
    var today = _today();
    if (!_calMonth) _calMonth = today.slice(0, 7);
    var parts     = _calMonth.split('-');
    var year      = parseInt(parts[0]);
    var month     = parseInt(parts[1]);
    var months    = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    var daysInMon = new Date(year, month, 0).getDate();
    var firstDay  = new Date(year, month - 1, 1).getDay();
    var startOff  = (firstDay + 6) % 7;
    var prevM     = month === 1  ? (year - 1) + '-12' : year + '-' + String(month - 1).padStart(2, '0');
    var nextM     = month === 12 ? (year + 1) + '-01' : year + '-' + String(month + 1).padStart(2, '0');
    var monthInts = _pmpInt.filter(function (i) { return (i.dueDate || '').startsWith(_calMonth); });
    var byDate    = {};
    monthInts.forEach(function (i) {
      if (!byDate[i.dueDate]) byDate[i.dueDate] = [];
      byDate[i.dueDate].push(i);
    });

    var h = '<div class="pmp-cal">' +
      '<div class="pmp-cal-nav">' +
      '<button class="pmp-cal-btn" onclick="MX.Pages.PMP._setCalMonth(\'' + prevM + '\')"><i class="fas fa-chevron-left"></i></button>' +
      '<div class="pmp-cal-month">' + months[month - 1] + ' ' + year + '</div>' +
      '<button class="pmp-cal-btn" onclick="MX.Pages.PMP._setCalMonth(\'' + nextM + '\')"><i class="fas fa-chevron-right"></i></button>' +
      '</div><div class="pmp-cal-grid">';

    ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].forEach(function (d) {
      h += '<div class="pmp-cal-dh">' + d + '</div>';
    });
    for (var k = 0; k < startOff; k++) h += '<div class="pmp-cal-cell pmp-cal-cell--empty"></div>';

    for (var day = 1; day <= daysInMon; day++) {
      var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var isToday = dateStr === today;
      var ints    = byDate[dateStr] || [];
      var hasLate = ints.some(function (i) { return i.status === 'en_retard' || (i.dueDate < today && i.status !== 'terminee'); });
      var hasDone = ints.some(function (i) { return i.status === 'terminee'; });
      var dotColor = hasLate ? 'var(--red)' : ints.length ? (hasDone ? 'var(--green)' : 'var(--orange)') : '';

      h += '<div class="pmp-cal-cell' + (isToday ? ' pmp-cal-cell--today' : '') + (ints.length ? ' pmp-cal-cell--has' : '') + '">' +
        '<div class="pmp-cal-day">' + day + '</div>' +
        (dotColor ? '<div class="pmp-cal-dot" style="background:' + dotColor + '"></div>' : '') +
        ints.slice(0, 2).map(function (i) {
          var st = INT_ST[i.status] || INT_ST.planifiee;
          return '<div class="pmp-cal-event" style="background:' + st.bg + ';color:' + st.c + '" title="' + esc(i.equipmentName || '') + '">' +
            esc((i.equipmentName || '').slice(0, 9)) + '</div>';
        }).join('') +
        (ints.length > 2 ? '<div class="pmp-cal-more">+' + (ints.length - 2) + '</div>' : '') +
        '</div>';
    }
    h += '</div></div>';
    return h;
  }

  // ── INTERVENTIONS ─────────────────────────────────────────────────────────

  function _tInterventions() {
    var today    = _today();
    var filtered = _pmpInt.slice();
    if (_intStatusFilter !== 'all') {
      filtered = filtered.filter(function (i) { return i.status === _intStatusFilter; });
    }
    filtered.sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });

    var h = '<div class="pmp-int-page">';
    h += '<div class="pmp-toolbar">' +
      '<select class="pmp-select" onchange="MX.Pages.PMP._setIntFilter(this.value)">' +
      '<option value="all"' + (_intStatusFilter === 'all' ? ' selected' : '') + '>Toutes</option>' +
      Object.entries(INT_ST).map(function (kv) {
        return '<option value="' + kv[0] + '"' + (_intStatusFilter === kv[0] ? ' selected' : '') + '>' + kv[1].l + '</option>';
      }).join('') +
      '</select>' +
      '<button class="pmp-add-btn" onclick="MX.Pages.PMP._createIntManual()"><i class="fas fa-plus"></i> Intervention</button>' +
      '</div>';

    if (!filtered.length) {
      h += '<div class="pmp-empty pmp-empty--big">' +
        '<i class="fas fa-clipboard-list" style="font-size:32px;opacity:0.3;margin-bottom:12px;display:block"></i>' +
        '<div>Aucune intervention</div></div>';
    } else {
      h += '<div class="pmp-int-list">';
      filtered.forEach(function (i) {
        var st   = INT_ST[i.status] || INT_ST.planifiee;
        var ti   = EQ_TYPES[i.type] || { icon: '🔧' };
        var late = _daysLate(i.dueDate);
        var isL  = i.status === 'en_retard' || (i.dueDate < today && i.status !== 'terminee');
        h += '<div class="pmp-int-row' + (isL ? ' pmp-int-row--late' : '') + (i.status === 'terminee' ? ' pmp-int-row--done' : '') + '">' +
          '<div class="pmp-int-type">' + ti.icon + '</div>' +
          '<div class="pmp-int-info">' +
          '<div class="pmp-int-name">' + esc(i.equipmentName || '—') + '</div>' +
          '<div class="pmp-int-sub">' + (i.zone ? esc(i.zone) + ' · ' : '') + esc(i.technician || '—') + '</div></div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">' +
          '<div class="pmp-int-date">' + _dateLbl(i.dueDate) + '</div>' +
          (late > 0 ? '<span class="pmp-retard-badge">' + late + 'j retard</span>' : '') +
          '</div>' +
          '<div class="pmp-int-st" style="color:' + st.c + ';background:' + st.bg + '">' + st.l + '</div>' +
          (i.status !== 'terminee' ? '<button class="pmp-done-btn" onclick="MX.Pages.PMP._markDone(\'' + esc(i.id) + '\')"><i class="fas fa-check"></i></button>' : '') +
          '<button class="pmp-act-btn pmp-act-btn--del" onclick="MX.Pages.PMP._delInt(\'' + esc(i.id) + '\')"><i class="fas fa-trash"></i></button>' +
          '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── RETARDS ───────────────────────────────────────────────────────────────

  function _tRetards() {
    var today = _today();
    var lates = _pmpInt.filter(function (i) {
      return i.status === 'en_retard' ||
             (i.dueDate && i.dueDate < today && i.status !== 'terminee' && i.status !== 'annulee');
    }).sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });

    var h = '<div class="pmp-ret-page">';
    if (!lates.length) {
      h += '<div class="pmp-empty pmp-empty--big" style="color:var(--green)">' +
        '<i class="fas fa-circle-check" style="font-size:40px;margin-bottom:12px;display:block"></i>' +
        '<div style="font-weight:700;font-size:16px">Aucun retard !</div>' +
        '<div style="font-size:12px;color:var(--text3);margin-top:6px">Toutes les maintenances sont à jour</div>' +
        '</div>';
    } else {
      h += '<div class="pmp-ret-header"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i> ' +
        lates.length + ' intervention' + (lates.length > 1 ? 's' : '') + ' en retard</div>';
      h += '<div class="pmp-int-list">';
      lates.forEach(function (i) {
        var days = _daysLate(i.dueDate);
        var cr   = CRIT[i.criticite] || CRIT.normale;
        var ti   = EQ_TYPES[i.type]  || { icon: '🔧' };
        h += '<div class="pmp-int-row pmp-int-row--late">' +
          '<div class="pmp-int-type">' + ti.icon + '</div>' +
          '<div class="pmp-int-info">' +
          '<div class="pmp-int-name">' + esc(i.equipmentName || '—') + '</div>' +
          '<div class="pmp-int-sub">Prévu ' + _dateLbl(i.dueDate) + (i.technician ? ' · ' + esc(i.technician) : '') + '</div></div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">' +
          '<span class="pmp-retard-badge pmp-retard-badge--big">' + days + 'j</span>' +
          '<span style="font-size:10px;color:' + cr.c + ';font-weight:600">' + cr.l + '</span>' +
          '</div>' +
          '<button class="pmp-done-btn" onclick="MX.Pages.PMP._markDone(\'' + esc(i.id) + '\')"><i class="fas fa-check"></i> Valider</button>' +
          '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── MODÈLES ───────────────────────────────────────────────────────────────

  function _tModeles() {
    var h = '<div class="pmp-tpl-page">';
    h += '<div class="pmp-toolbar"><button class="pmp-add-btn" onclick="MX.Pages.PMP._tplForm(null)"><i class="fas fa-plus"></i> Nouveau modèle</button></div>';
    if (!_pmpTpl.length) {
      h += '<div class="pmp-empty pmp-empty--big">' +
        '<i class="fas fa-layer-group" style="font-size:32px;opacity:0.3;margin-bottom:12px;display:block"></i>' +
        '<div>Aucun modèle de checklist</div>' +
        '<button class="pmp-add-btn" style="margin-top:12px" onclick="MX.Pages.PMP._tplForm(null)"><i class="fas fa-plus"></i> Créer un modèle</button>' +
        '</div>';
    } else {
      h += '<div class="pmp-tpl-list">';
      _pmpTpl.forEach(function (t) {
        var items = t.items || [];
        h += '<div class="pmp-tpl-card">' +
          '<div class="pmp-tpl-head"><div class="pmp-tpl-name">' + esc(t.name) + '</div>' +
          '<div class="pmp-tpl-cnt">' + items.length + ' tâche' + (items.length !== 1 ? 's' : '') + '</div></div>' +
          (t.description ? '<div class="pmp-tpl-desc">' + esc(t.description) + '</div>' : '') +
          (items.length ? '<div class="pmp-tpl-items">' +
            items.slice(0, 5).map(function (it) {
              return '<div class="pmp-tpl-item"><i class="fas fa-check" style="color:var(--text3);font-size:10px;flex-shrink:0"></i> ' + esc(it.text || it) + '</div>';
            }).join('') +
            (items.length > 5 ? '<div class="pmp-tpl-item" style="color:var(--text3)">+' + (items.length - 5) + ' autres…</div>' : '') +
            '</div>' : '') +
          '<div class="pmp-tpl-footer">' +
          '<button class="pmp-act-btn" onclick="MX.Pages.PMP._tplForm(\'' + esc(t.id) + '\')"><i class="fas fa-pen"></i> Modifier</button>' +
          '<button class="pmp-act-btn pmp-act-btn--del" onclick="MX.Pages.PMP._delTpl(\'' + t.id + '\')"><i class="fas fa-trash"></i></button>' +
          '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── IMPORT EXCEL ─────────────────────────────────────────────────────────

  var IMPORT_FIELDS = [
    { key: 'ref',        label: 'Référence',           aliases: ['ref','reference','bt','nobt','numero','id','code'] },
    { key: 'name',       label: 'Nom intervention',    required: true, aliases: ['nom','libelle','label','designation','intervention','titre','name','intitule','description'] },
    { key: 'equipment',  label: 'Équipement',          aliases: ['equipement','equipment','materiel','appareil','machine','installation'] },
    { key: 'type',       label: 'Catégorie',           aliases: ['type','categorie','category','famille'] },
    { key: 'zone',       label: 'Zone',                aliases: ['zone','secteur','batiment','site'] },
    { key: 'subZone',    label: 'Sous-zone',           aliases: ['souszone','soussecteur','local','piece','localisation'] },
    { key: 'frequency',  label: 'Fréquence',           aliases: ['frequence','frequency','periodicite','declencheur','recurrence','periode','jours','days'] },
    { key: 'nextDue',    label: 'Date prochaine',      aliases: ['dateprochaine','dateprevue','echeance','prochain','dateintervention','datechue','nextdue','prevue','datemaintenance'] },
    { key: 'duration',   label: 'Durée estimée',       aliases: ['duree','duration','temps','dureeestimee','dureeprevue','estimee'] },
    { key: 'criticite',  label: 'Criticité',           aliases: ['criticite','criticality','priorite','gravite','urgence','crit'] },
    { key: 'technician', label: 'Technicien référent', aliases: ['technicien','technician','responsable','operateur','assigne','referent','intervenant'] },
    { key: 'comments',   label: 'Commentaires',        aliases: ['commentaire','comment','note','remarque','observation'] },
  ];

  var TPL_DEFAULTS = {
    cta:          ['Vérifier l\'état des filtres', 'Nettoyer ou remplacer les filtres', 'Contrôler les courroies', 'Vérifier les pressions de soufflage et reprise', 'Contrôler la régulation', 'Graisser les roulements', 'Vérifier les débits d\'air'],
    groupe_froid: ['Contrôler le niveau de fluide frigorigène', 'Vérifier les pressions HP/BP', 'Nettoyer les ailettes du condenseur', 'Contrôler la régulation', 'Recherche de fuites'],
    ecs:          ['Contrôler la température de stockage (≥60°C)', 'Vérifier l\'anode magnésium', 'Purger le ballon', 'Contrôler la pression de service', 'Vérifier le groupe de sécurité'],
    ssi:          ['Test déclenchement manuel des détecteurs', 'Vérifier voyants et signalisations', 'Contrôler l\'état des batteries', 'Test sirènes et avertisseurs', 'Vérifier la centrale incendie'],
    ascenseur:    ['Vérifier le fonctionnement des portes', 'Contrôler les câbles et poulies', 'Lubrifier les guidages', 'Test arrêt d\'urgence', 'Contrôler l\'éclairage cabine'],
    pompe:        ['Contrôler l\'étanchéité des presse-étoupes', 'Vérifier les vibrations', 'Graisser les paliers', 'Contrôler la pression de refoulement', 'Vérifier les clapets anti-retour'],
    tgbt:         ['Vérifier le bon état des serrures', 'Contrôler les disjoncteurs', 'Mesurer les températures des départs', 'Nettoyer l\'intérieur', 'Vérifier les connexions et serrage'],
    vmc:          ['Nettoyer les filtres', 'Vérifier les débits d\'air', 'Contrôler les courroies', 'Graisser les roulements'],
    adoucisseur:  ['Vérifier le niveau de sel', 'Contrôler le cycle de régénération', 'Analyser la dureté de l\'eau', 'Vérifier la pression de service'],
    porte_auto:   ['Vérifier les capteurs de sécurité', 'Contrôler les sécurités antipincement', 'Lubrifier les guidages', 'Test arrêt d\'urgence', 'Régler les vitesses d\'ouverture/fermeture'],
    eclairage:    ['Contrôler les éclairages de secours', 'Vérifier l\'autonomie des batteries', 'Nettoyer les luminaires'],
    divers:       ['Contrôle visuel général', 'Vérifier l\'état général', 'Vérifier les fixations'],
  };

  function _normH(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function _autoMapCols(headers) {
    var normed = headers.map(_normH);
    var mapping = {}, used = {};
    IMPORT_FIELDS.forEach(function (f) {
      var idx = -1;
      for (var i = 0; i < normed.length; i++) {
        if (used[i]) continue;
        var nh = normed[i];
        if (f.aliases.some(function (a) { return nh === a || nh.startsWith(a) || a.startsWith(nh) || nh.includes(a); })) {
          idx = i; break;
        }
      }
      mapping[f.key] = idx;
      if (idx >= 0) used[idx] = true;
    });
    var unmapped = [];
    headers.forEach(function (h, i) { if (!used[i] && (h || '').trim()) unmapped.push({ idx: i, header: h }); });
    return { mapping: mapping, unmapped: unmapped };
  }

  function _parseFreq(s) {
    if (!s) return 30;
    var n = parseInt(s, 10);
    if (!isNaN(n) && n > 0) return n;
    var sl = _normH(s);
    if (sl.includes('hebdo')) return 7;
    if (sl.includes('quinz')) return 15;
    if (sl.includes('bimes')) return 60;
    if (sl.includes('trimes')) return 90;
    if (sl.includes('semes')) return 180;
    if (sl.includes('annuel') || sl.includes('annual')) return 365;
    if (sl.includes('mens')) return 30;
    return 30;
  }

  function _parseDate(s) {
    if (!s) return '';
    var d = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    var m = d.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
      var p1 = m[1].padStart(2, '0'), p2 = m[2].padStart(2, '0');
      var yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return yr + '-' + p2 + '-' + p1;
    }
    try { var dt = new Date(d); if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10); } catch (e_) {}
    return '';
  }

  function _matchType(s) {
    if (!s) return 'divers';
    var n = _normH(s);
    return Object.keys(EQ_TYPES).find(function (k) {
      return k === n || _normH(EQ_TYPES[k].l) === n || n.includes(k) || k.includes(n.slice(0, 4));
    }) || 'divers';
  }

  function _matchCrit(s) {
    if (!s) return 'normale';
    var n = _normH(s);
    return Object.keys(CRIT).find(function (k) {
      return k === n || _normH(CRIT[k].l) === n || n.includes(k);
    }) || 'normale';
  }

  function _tImport() {
    var h = '<div class="pmp-import-page">';

    // Header
    h += '<div class="pmp-import-hdr">' +
      '<div>' +
        '<div class="pmp-import-ttl"><i class="fas fa-file-excel" style="color:#22C55E"></i> Import Excel — Maintenance Préventive</div>' +
        '<div class="pmp-import-sub">Format officiel Maintix · .xlsx · .xls · .csv (compatibilité)</div>' +
      '</div>' +
      '<button class="pmp-act-btn" onclick="MX.Pages.PMP._downloadTemplate()" title="Télécharger le modèle Excel Maintix">' +
        '<i class="fas fa-download"></i> Modèle Maintix' +
      '</button>' +
    '</div>';

    // Steps bar
    var SLBLS = ['Fichier', 'Analyse', 'Aperçu', 'Import'];
    var activeS = _importStep <= 1 ? 0 : _importStep === 3 ? 2 : _importStep >= 4 ? 3 : 1;
    h += '<div class="pmp-import-steps-bar">';
    SLBLS.forEach(function (lbl, i) {
      var done = i < activeS, act = i === activeS;
      h += '<div class="pmp-import-step-item' + (done ? ' done' : act ? ' active' : '') + '">' +
        '<div class="pmp-import-step-num">' + (done ? '<i class="fas fa-check"></i>' : (i + 1)) + '</div>' +
        '<span>' + lbl + '</span></div>';
      if (i < 3) h += '<div class="pmp-import-step-line' + (i < activeS ? ' done' : '') + '"></div>';
    });
    h += '</div>';

    if (_importStep === 1 || _importStep === 2) {
      var loading = _importStep === 2;
      h += '<div class="pmp-import-dropzone' + (loading ? ' loading' : '') + '" id="pmp-dropzone"' +
        ' ondragover="event.preventDefault();document.getElementById(\'pmp-dropzone\').classList.add(\'drag-over\')"' +
        ' ondragleave="document.getElementById(\'pmp-dropzone\').classList.remove(\'drag-over\')"' +
        ' ondrop="event.preventDefault();document.getElementById(\'pmp-dropzone\').classList.remove(\'drag-over\');MX.Pages.PMP._onImportDrop(event)"' +
        ' onclick="if(!this.classList.contains(\'loading\'))document.getElementById(\'pmp-import-input\').click()">';
      if (loading) {
        h += '<i class="fas fa-spinner fa-spin" style="font-size:32px;color:var(--orange);margin-bottom:12px;display:block"></i>' +
          '<div style="font-size:14px;font-weight:600">Analyse du fichier en cours…</div>';
      } else {
        h += '<i class="fas fa-file-excel" style="font-size:40px;color:#22C55E;margin-bottom:12px;display:block"></i>' +
          '<div style="font-size:15px;font-weight:700">Glisser votre fichier Excel ici</div>' +
          '<div style="font-size:12px;color:var(--text3);margin-top:6px;margin-bottom:10px">ou cliquer pour sélectionner</div>' +
          '<div class="pmp-import-fmt-tags"><span>.xlsx</span><span>.xls</span><span>.csv</span></div>';
      }
      h += '<input type="file" id="pmp-import-input" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" style="display:none" onchange="MX.Pages.PMP._onImportFile(this)">';
      h += '</div>';

      h += '<div class="pmp-import-help"><div class="pmp-import-help-ttl"><i class="fas fa-circle-info"></i> Colonnes reconnues automatiquement</div>' +
        '<div class="pmp-import-cols">' +
        IMPORT_FIELDS.map(function (f) {
          return '<div class="pmp-import-col"><strong>' + f.label + '</strong><span>' + f.aliases.slice(0, 3).join(', ') + '…</span></div>';
        }).join('') + '</div></div>';

    } else if (_importStep === 3) {
      var an = _importAnalysis;

      // Stats row
      h += '<div class="pmp-import-stats-row">' +
        '<div class="pmp-import-stat"><div class="pmp-import-stat-n">' + an.total + '</div><div class="pmp-import-stat-l">Lignes</div></div>' +
        '<div class="pmp-import-stat"><div class="pmp-import-stat-n">' + an.equipCount + '</div><div class="pmp-import-stat-l">Équipements</div></div>' +
        '<div class="pmp-import-stat"><div class="pmp-import-stat-n">' + an.zoneCount + '</div><div class="pmp-import-stat-l">Zones</div></div>' +
        '<div class="pmp-import-stat"><div class="pmp-import-stat-n">' + an.freqCount + '</div><div class="pmp-import-stat-l">Fréquences</div></div>' +
      '</div>';

      // Mapping display
      var detected = IMPORT_FIELDS.filter(function (f) { return (_importMapping[f.key] || -1) >= 0; });
      var missed   = IMPORT_FIELDS.filter(function (f) { return (_importMapping[f.key] || -1) < 0; });
      h += '<div class="pmp-import-mapbox">' +
        '<div class="pmp-import-mapbox-ttl"><i class="fas fa-magic" style="color:var(--orange)"></i> Correspondance automatique — ' + detected.length + '/' + IMPORT_FIELDS.length + ' colonnes détectées</div>' +
        '<div class="pmp-import-map-grid">' +
        detected.map(function (f) {
          var colName = _importHeaders[_importMapping[f.key]] || '';
          return '<div class="pmp-import-map-item ok">' +
            '<span class="pmp-import-map-col">' + esc(colName) + '</span>' +
            '<i class="fas fa-arrow-right" style="color:var(--green);font-size:10px;flex-shrink:0"></i>' +
            '<span class="pmp-import-map-field">' + f.label + '</span>' +
          '</div>';
        }).join('') +
        '</div>';
      if (missed.length) {
        h += '<div class="pmp-import-map-miss">Non détectés (optionnels) : ' +
          missed.map(function (f) { return '<span class="pmp-import-col">' + f.label + '</span>'; }).join('') + '</div>';
      }
      h += '</div>';

      // Unrecognized columns
      if (_importUnmapped.length) {
        h += '<div class="pmp-import-unmap-box">' +
          '<div class="pmp-import-unmap-ttl"><i class="fas fa-question-circle" style="color:var(--orange)"></i> ' + _importUnmapped.length + ' colonne' + (_importUnmapped.length > 1 ? 's' : '') + ' non reconnue' + (_importUnmapped.length > 1 ? 's' : '') + ' — à quoi correspondent-elles ?</div>' +
          _importUnmapped.map(function (u) {
            return '<div class="pmp-import-unmap-row">' +
              '<span class="pmp-import-unmap-col">' + esc(u.header) + '</span>' +
              '<i class="fas fa-long-arrow-alt-right" style="color:var(--text3);flex-shrink:0"></i>' +
              '<select class="pmp-select" onchange="MX.Pages.PMP._setImportUserMap(this.value,' + u.idx + ')">' +
                '<option value="">Ignorer cette colonne</option>' +
                IMPORT_FIELDS.map(function (f) {
                  return '<option value="' + f.key + '"' + (_importUserMap[f.key] === u.idx ? ' selected' : '') + '>' + f.label + '</option>';
                }).join('') +
              '</select>' +
            '</div>';
          }).join('') +
        '</div>';
      }

      // Preview table
      var allMap = Object.assign({}, _importMapping);
      Object.keys(_importUserMap).forEach(function (k) { if (_importUserMap[k] >= 0) allMap[k] = _importUserMap[k]; });
      var visFields = IMPORT_FIELDS.filter(function (f) { return (allMap[f.key] !== undefined && allMap[f.key] >= 0); });
      h += '<div class="pmp-import-preview">' +
        '<div class="pmp-import-preview-hd"><span>Aperçu — 10 premières lignes</span></div>' +
        '<div class="pmp-import-table-wrap"><table class="pmp-import-table"><thead><tr>' +
        visFields.map(function (f) { return '<th>' + f.label + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        _importRawRows.slice(0, 10).map(function (r) {
          return '<tr>' + visFields.map(function (f) {
            return '<td>' + esc(String(r[allMap[f.key]] || '')) + '</td>';
          }).join('') + '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        (_importRawRows.length > 10 ? '<div style="text-align:center;font-size:11px;color:var(--text3);padding:8px">+' + (_importRawRows.length - 10) + ' lignes supplémentaires</div>' : '') +
      '</div>';

      h += '<div class="pmp-import-actions">' +
        '<button class="pmp-add-btn" onclick="MX.Pages.PMP._runImport()">' +
          '<i class="fas fa-rocket"></i> Lancer l\'import — ' + _importRawRows.length + ' ligne' + (_importRawRows.length > 1 ? 's' : '') +
        '</button>' +
        '<button class="pmp-act-btn" onclick="MX.Pages.PMP._resetImport()">' +
          '<i class="fas fa-arrow-left"></i> Changer de fichier' +
        '</button>' +
      '</div>';

    } else if (_importStep === 4) {
      h += '<div class="pmp-empty pmp-empty--big">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:36px;color:var(--orange)"></i>' +
        '<div class="pmp-empty-ttl" style="margin-top:14px">Import en cours…</div>' +
        '<div class="pmp-empty-sub">Création des équipements et des interventions</div>' +
      '</div>';

    } else if (_importStep === 5) {
      var res = _importResult || {};
      h += '<div class="pmp-import-result">' +
        '<div style="text-align:center;margin-bottom:16px">' +
          '<i class="fas fa-circle-check" style="font-size:36px;color:var(--green)"></i>' +
          '<div class="pmp-import-result-ttl">Import terminé avec succès</div>' +
        '</div>' +
        '<div class="pmp-import-result-stats">' +
          '<div class="pmp-import-rs"><span class="pmp-import-rs-n" style="color:var(--green)">' + (res.created || 0) + '</span><span>Équipements créés</span></div>' +
          '<div class="pmp-import-rs"><span class="pmp-import-rs-n" style="color:var(--cyan)">' + (res.updated || 0) + '</span><span>Mis à jour</span></div>' +
          '<div class="pmp-import-rs"><span class="pmp-import-rs-n" style="color:var(--orange)">' + (res.intCreated || 0) + '</span><span>Interventions planifiées</span></div>' +
        '</div>';
      if (res.absent > 0) {
        h += '<div class="pmp-import-absent"><i class="fas fa-triangle-exclamation" style="color:var(--orange)"></i> ' +
          '<strong>' + res.absent + ' équipement' + (res.absent > 1 ? 's' : '') + '</strong>' +
          ' présent' + (res.absent > 1 ? 's' : '') + ' dans Maintix mais absent' + (res.absent > 1 ? 's' : '') + ' de ce fichier. ' +
          'Ils ont été conservés et marqués <em>non présents dans le dernier import</em>.</div>';
      }
      if (res.suggestions && res.suggestions.length) {
        h += '<div class="pmp-import-suggest">' +
          '<div class="pmp-import-suggest-ttl"><i class="fas fa-lightbulb" style="color:var(--orange)"></i> Modèles de checklist suggérés</div>' +
          '<p style="font-size:12px;color:var(--text2);margin:6px 0 10px">Ces catégories n\'ont pas encore de modèle de checklist :</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
          res.suggestions.map(function (cat) {
            var t = EQ_TYPES[cat] || { icon: '🔧', l: cat };
            return '<span class="pmp-retard-badge pmp-retard-badge--big">' + t.icon + ' ' + t.l + '</span>';
          }).join('') + '</div>' +
          '<button class="pmp-add-btn" onclick="MX.Pages.PMP._createDefaultTpls(' + JSON.stringify(res.suggestions) + ')">' +
            '<i class="fas fa-layer-group"></i> Créer les modèles par défaut' +
          '</button></div>';
      }
      h += '<div class="pmp-import-actions" style="margin-top:16px">' +
        '<button class="pmp-add-btn" onclick="MX.Pages.PMP._tab(\'equipements\')">' +
          '<i class="fas fa-wrench"></i> Voir les équipements' +
        '</button>' +
        '<button class="pmp-act-btn" onclick="MX.Pages.PMP._resetImport()">' +
          '<i class="fas fa-upload"></i> Nouvel import' +
        '</button></div></div>';
    }

    h += '</div>';
    return h;
  }

  // ── HISTORIQUE ────────────────────────────────────────────────────────────

  function _tHistorique() {
    var done = _pmpInt.filter(function (i) { return i.status === 'terminee'; })
      .sort(function (a, b) {
        var da = a.doneDate || a.dueDate || '';
        var db_ = b.doneDate || b.dueDate || '';
        return db_.localeCompare(da);
      });

    var h = '<div class="pmp-hist-page">';
    if (!done.length) {
      h += '<div class="pmp-empty pmp-empty--big">' +
        '<i class="fas fa-clock-rotate-left" style="font-size:32px;opacity:0.3;margin-bottom:12px;display:block"></i>' +
        '<div>Aucune intervention réalisée</div></div>';
    } else {
      h += '<div class="pmp-hist-count">' + done.length + ' intervention' + (done.length > 1 ? 's' : '') + ' réalisée' + (done.length > 1 ? 's' : '') + '</div>';
      h += '<div class="pmp-int-list">';
      done.forEach(function (i) {
        var ti = EQ_TYPES[i.type] || { icon: '🔧' };
        h += '<div class="pmp-int-row pmp-int-row--done">' +
          '<div class="pmp-int-type">' + ti.icon + '</div>' +
          '<div class="pmp-int-info">' +
          '<div class="pmp-int-name">' + esc(i.equipmentName || '—') + '</div>' +
          '<div class="pmp-int-sub">' + (i.doneBy ? esc(i.doneBy) + ' · ' : '') + _dateLbl(i.doneDate || i.dueDate) + '</div>' +
          (i.observations ? '<div class="pmp-hist-obs"><i class="fas fa-note-sticky" style="font-size:10px"></i> ' + esc(i.observations) + '</div>' : '') +
          '</div>' +
          '<div class="pmp-int-st" style="color:var(--green);background:rgba(34,197,94,.12);flex-shrink:0">Réalisée</div>' +
          '<button class="pmp-act-btn pmp-act-btn--del" onclick="MX.Pages.PMP._delInt(\'' + esc(i.id) + '\')"><i class="fas fa-trash"></i></button>' +
          '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── EQUIPMENT FORM & ACTIONS ──────────────────────────────────────────────

  function _eqForm(id) {
    var eq    = id ? _pmpEq.find(function (e) { return e.id === id; }) : null;
    var users = (MX.state.users || []).filter(function (u) { return u.name && !u.hidden; });
    var tpls  = _pmpTpl;

    var body = '<div style="display:flex;flex-direction:column;gap:10px;max-height:68vh;overflow-y:auto;padding-right:4px">' +
      '<div><label class="pmp-form-lbl">Nom *</label>' +
      '<input class="fi" id="pmp-f-name" placeholder="Ex: CTA Toiture" value="' + esc(eq ? eq.name || '' : '') + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><label class="pmp-form-lbl">Type *</label>' +
      '<select class="fi" id="pmp-f-type"><option value="">— Type —</option>' +
      Object.entries(EQ_TYPES).map(function (kv) {
        return '<option value="' + kv[0] + '"' + (eq && eq.type === kv[0] ? ' selected' : '') + '>' + kv[1].icon + ' ' + kv[1].l + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="pmp-form-lbl">Criticité</label>' +
      '<select class="fi" id="pmp-f-crit">' +
      Object.entries(CRIT).map(function (kv) {
        var sel = eq ? eq.criticite === kv[0] : kv[0] === 'normale';
        return '<option value="' + kv[0] + '"' + (sel ? ' selected' : '') + '>' + kv[1].l + '</option>';
      }).join('') + '</select></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><label class="pmp-form-lbl">Zone</label>' +
      '<input class="fi" id="pmp-f-zone" placeholder="Ex: Toiture" value="' + esc(eq ? eq.zone || '' : '') + '"></div>' +
      '<div><label class="pmp-form-lbl">Sous-zone</label>' +
      '<input class="fi" id="pmp-f-subzone" placeholder="Ex: Local technique" value="' + esc(eq ? eq.subZone || '' : '') + '"></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><label class="pmp-form-lbl">Référence interne</label>' +
      '<input class="fi" id="pmp-f-ref" placeholder="Ex: CTA-01" value="' + esc(eq ? eq.ref || '' : '') + '"></div>' +
      '<div><label class="pmp-form-lbl">Mise en service</label>' +
      '<input class="fi" type="date" id="pmp-f-startDate" value="' + esc(eq ? eq.startDate || '' : '') + '"></div></div>' +
      '<div><label class="pmp-form-lbl">Technicien référent</label>' +
      '<select class="fi" id="pmp-f-tech"><option value="">— Non assigné —</option>' +
      users.map(function (u) {
        return '<option value="' + esc(u.name) + '"' + (eq && eq.technician === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="pmp-form-lbl">Fréquence *</label>' +
      '<select class="fi" id="pmp-f-freq">' +
      FREQS.map(function (f) {
        var sel = eq ? eq.frequency === f.v : f.v === 30;
        return '<option value="' + f.v + '"' + (sel ? ' selected' : '') + '>' + f.l + '</option>';
      }).join('') + '</select></div>' +
      (id ? '<div><label class="pmp-form-lbl">Prochaine échéance</label>' +
        '<input class="fi" type="date" id="pmp-f-nextDue" value="' + esc(eq ? eq.nextDue || '' : '') + '"></div>' : '') +
      '<div><label class="pmp-form-lbl">Modèle de checklist</label>' +
      '<select class="fi" id="pmp-f-tpl"><option value="">— Aucun —</option>' +
      tpls.map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (eq && eq.templateId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="pmp-form-lbl">Statut</label>' +
      '<select class="fi" id="pmp-f-status">' +
      '<option value="actif"' + (!eq || eq.status === 'actif' ? ' selected' : '') + '>Actif</option>' +
      '<option value="inactif"' + (eq && eq.status === 'inactif' ? ' selected' : '') + '>Inactif</option>' +
      '</select></div>' +
      '</div>';

    MX.showModal({ title: id ? "Modifier l'équipement" : 'Nouvel équipement', body: body, actions: [
      { label: 'Enregistrer', cls: 'primary', fn: function () { _saveEq(id); } },
      { label: 'Annuler',     cls: 'cancel' },
    ]});
  }

  async function _saveEq(id) {
    var name      = (document.getElementById('pmp-f-name')?.value      || '').trim();
    var type      =  document.getElementById('pmp-f-type')?.value      || '';
    var crit      =  document.getElementById('pmp-f-crit')?.value      || 'normale';
    var zone      = (document.getElementById('pmp-f-zone')?.value      || '').trim();
    var subZone   = (document.getElementById('pmp-f-subzone')?.value   || '').trim();
    var ref       = (document.getElementById('pmp-f-ref')?.value       || '').trim();
    var startDate =  document.getElementById('pmp-f-startDate')?.value || '';
    var tech      =  document.getElementById('pmp-f-tech')?.value      || '';
    var freq      = parseInt(document.getElementById('pmp-f-freq')?.value || '30') || 30;
    var nextDueEl =  document.getElementById('pmp-f-nextDue');
    var tplId     =  document.getElementById('pmp-f-tpl')?.value       || '';
    var status    =  document.getElementById('pmp-f-status')?.value    || 'actif';

    if (!name) { MX.toast('Nom requis', true); return; }
    if (!type) { MX.toast('Type requis', true); return; }

    var data = { name, type, criticite: crit, zone, subZone, ref, startDate, technician: tech, frequency: freq, templateId: tplId, status, updatedAt: FV.serverTimestamp() };
    if (nextDueEl && nextDueEl.value) data.nextDue = nextDueEl.value;

    try {
      if (id) {
        await PMP_DB.eq().doc(id).update(data);
        MX.toast('Équipement mis à jour ✓');
      } else {
        data.createdAt = FV.serverTimestamp();
        data.lastDone  = '';
        data.nextDue   = startDate ? _addDays(startDate, freq) : _addDays(_today(), freq);
        data.createdBy = _author();
        await PMP_DB.eq().add(data);
        MX.toast('Équipement ajouté ✓');
      }
    } catch (e) { console.error(e); MX.toast('Erreur : ' + e.message, true); }
  }

  function _delEq(id) {
    if (!id) { MX.toast('Identifiant introuvable', true); return; }
    var eq   = _pmpEq.find(function (e) { return e.id === id; });
    var name = eq ? eq.name : '';
    MX.showModal("Supprimer l'équipement ?",
      '"' + esc(name) + '" et ses interventions associées seront supprimés définitivement.',
      [
        { label: 'Supprimer', cls: 'danger', fn: async function () {
          try {
            var batch = db.batch();
            batch.delete(PMP_DB.eq().doc(id));
            _pmpInt.filter(function (i) { return i.equipmentId === id; })
                   .forEach(function (i) { batch.delete(PMP_DB.int().doc(i.id)); });
            await batch.commit();
            MX.toast('Équipement supprimé');
          } catch (e) { console.error('[PMP] delEq:', e); MX.toast('Erreur suppression : ' + e.message, true); }
        }},
        { label: 'Annuler', cls: 'cancel' },
      ]
    );
  }

  // ── INTERVENTION ACTIONS ──────────────────────────────────────────────────

  function _createInt(eqId) {
    var eq = _pmpEq.find(function (e) { return e.id === eqId; });
    if (!eq) return;
    MX.showModal({ title: 'Nouvelle intervention PMP',
      body: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<p style="color:var(--text2);font-size:13px;margin:0">Équipement : <strong>' + esc(eq.name) + '</strong></p>' +
      '<div><label class="pmp-form-lbl">Date prévue</label>' +
      '<input class="fi" type="date" id="pmp-ci-date" value="' + _today() + '"></div>' +
      '</div>',
      actions: [
        { label: 'Créer', cls: 'primary', fn: async function () {
          var date = document.getElementById('pmp-ci-date')?.value || _today();
          try {
            await PMP_DB.int().add({
              equipmentId: eq.id, equipmentName: eq.name, type: eq.type || 'divers',
              zone: eq.zone || '', dueDate: date, frequency: eq.frequency || 30,
              technician: eq.technician || '', criticite: eq.criticite || 'normale',
              status: date < _today() ? 'en_retard' : 'planifiee',
              source: 'manual', createdAt: FV.serverTimestamp(), createdBy: _author(),
            });
            MX.toast('Intervention créée ✓');
          } catch (e) { MX.toast('Erreur : ' + e.message, true); }
        }},
        { label: 'Annuler', cls: 'cancel' },
      ]
    });
  }

  function _createIntManual() {
    var users     = (MX.state.users || []).filter(function (u) { return u.name && !u.hidden; });
    var activeEqs = _pmpEq.filter(function (e) { return e.status !== 'inactif'; })
                          .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    MX.showModal({ title: 'Nouvelle intervention',
      body: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div><label class="pmp-form-lbl">Équipement *</label>' +
      '<select class="fi" id="pmp-ci-eq"><option value="">— Sélectionner —</option>' +
      activeEqs.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label class="pmp-form-lbl">Date prévue *</label>' +
      '<input class="fi" type="date" id="pmp-ci-date2" value="' + _today() + '"></div>' +
      '<div><label class="pmp-form-lbl">Technicien</label>' +
      '<select class="fi" id="pmp-ci-tech"><option value="">— Non assigné —</option>' +
      users.map(function (u) { return '<option value="' + esc(u.name) + '">' + esc(u.name) + '</option>'; }).join('') +
      '</select></div></div>',
      actions: [
        { label: 'Créer', cls: 'primary', fn: async function () {
          var eqId = document.getElementById('pmp-ci-eq')?.value;
          var date = document.getElementById('pmp-ci-date2')?.value || _today();
          var tech = document.getElementById('pmp-ci-tech')?.value  || '';
          if (!eqId) { MX.toast('Équipement requis', true); return; }
          var eq = _pmpEq.find(function (e) { return e.id === eqId; });
          if (!eq) return;
          try {
            await PMP_DB.int().add({
              equipmentId: eq.id, equipmentName: eq.name, type: eq.type || 'divers',
              zone: eq.zone || '', dueDate: date, frequency: eq.frequency || 30,
              technician: tech || eq.technician || '', criticite: eq.criticite || 'normale',
              status: date < _today() ? 'en_retard' : 'planifiee',
              source: 'manual', createdAt: FV.serverTimestamp(), createdBy: _author(),
            });
            MX.toast('Intervention créée ✓');
          } catch (e) { MX.toast('Erreur : ' + e.message, true); }
        }},
        { label: 'Annuler', cls: 'cancel' },
      ]
    });
  }

  function _markDone(intId) {
    var i = _pmpInt.find(function (x) { return x.id === intId; });
    if (!i) return;
    MX.showModal({ title: 'Valider l\'intervention',
      body: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<p style="color:var(--text2);font-size:13px;margin:0">Équipement : <strong>' + esc(i.equipmentName) + '</strong></p>' +
      '<div><label class="pmp-form-lbl">Date de réalisation</label>' +
      '<input class="fi" type="date" id="pmp-done-date" value="' + _today() + '"></div>' +
      '<div><label class="pmp-form-lbl">Observations</label>' +
      '<textarea class="fi" id="pmp-done-obs" rows="2" placeholder="Remarques, anomalies…" style="resize:vertical"></textarea></div>' +
      '</div>',
      actions: [
        { label: 'Valider', cls: 'primary', fn: async function () {
          var doneDate = document.getElementById('pmp-done-date')?.value || _today();
          var obs      = (document.getElementById('pmp-done-obs')?.value || '').trim();
          try {
            await PMP_DB.int().doc(intId).update({
              status: 'terminee', doneDate, observations: obs,
              doneBy: _author(), updatedAt: FV.serverTimestamp(),
            });
            var eq = _pmpEq.find(function (e) { return e.id === i.equipmentId; });
            if (eq) {
              var nextDue = _addDays(doneDate, eq.frequency || 30);
              await PMP_DB.eq().doc(i.equipmentId).update({ lastDone: doneDate, nextDue, updatedAt: FV.serverTimestamp() });
            }
            MX.toast('Intervention validée ✓');
          } catch (e) { MX.toast('Erreur : ' + e.message, true); }
        }},
        { label: 'Annuler', cls: 'cancel' },
      ]
    });
  }

  function _delInt(id) {
    MX.showModal('Supprimer cette intervention ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async function () {
        try {
          await PMP_DB.int().doc(id).delete();
          MX.toast('Intervention supprimée');
        } catch (e) { MX.toast('Erreur : ' + e.message, true); }
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]);
  }

  // ── TEMPLATE ACTIONS ──────────────────────────────────────────────────────

  function _tplForm(id) {
    var tpl   = id ? _pmpTpl.find(function (t) { return t.id === id; }) : null;
    var items = tpl ? (tpl.items || []) : [];
    var itemsHtml = items.map(function (it, idx) {
      return '<div class="pmp-tpl-item-row" id="tplitem_' + idx + '">' +
        '<input class="fi" style="flex:1" placeholder="Tâche…" value="' + esc(it.text || it) + '">' +
        '<button onclick="this.closest(\'.pmp-tpl-item-row\').remove()" style="border:none;background:none;color:var(--red);cursor:pointer;padding:4px 8px;font-size:16px"><i class="fas fa-times"></i></button>' +
        '</div>';
    }).join('');

    MX.showModal({ title: tpl ? 'Modifier le modèle' : 'Nouveau modèle de checklist',
      body: '<div style="display:flex;flex-direction:column;gap:10px;max-height:62vh;overflow-y:auto">' +
      '<div><label class="pmp-form-lbl">Nom du modèle *</label>' +
      '<input class="fi" id="pmp-tpl-name" value="' + esc(tpl ? tpl.name || '' : '') + '" placeholder="Ex: Checklist CTA mensuelle"></div>' +
      '<div><label class="pmp-form-lbl">Description</label>' +
      '<input class="fi" id="pmp-tpl-desc" value="' + esc(tpl ? tpl.description || '' : '') + '" placeholder="Description courte…"></div>' +
      '<div><label class="pmp-form-lbl">Tâches à réaliser</label>' +
      '<div id="pmp-tpl-items" style="display:flex;flex-direction:column;gap:6px">' + itemsHtml + '</div>' +
      '<button onclick="MX.Pages.PMP._tplAddItem()" style="margin-top:8px;padding:6px 12px;font-size:12px;border-radius:6px;background:var(--bg3);border:1px solid var(--border2);color:var(--cyan);cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;gap:6px;width:100%;justify-content:center">' +
      '<i class="fas fa-plus"></i> Ajouter une tâche</button>' +
      '</div></div>',
      actions: [
        { label: 'Enregistrer', cls: 'primary', fn: function () { _saveTpl(id); } },
        { label: 'Annuler',     cls: 'cancel' },
      ]
    });
  }

  function _tplAddItem() {
    var container = document.getElementById('pmp-tpl-items');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'pmp-tpl-item-row';
    div.innerHTML = '<input class="fi" style="flex:1" placeholder="Tâche…">' +
      '<button onclick="this.closest(\'.pmp-tpl-item-row\').remove()" style="border:none;background:none;color:var(--red);cursor:pointer;padding:4px 8px;font-size:16px"><i class="fas fa-times"></i></button>';
    container.appendChild(div);
    div.querySelector('input')?.focus();
  }

  async function _saveTpl(id) {
    var name    = (document.getElementById('pmp-tpl-name')?.value || '').trim();
    var desc    = (document.getElementById('pmp-tpl-desc')?.value || '').trim();
    var itemEls = document.querySelectorAll('#pmp-tpl-items input');
    var items   = Array.from(itemEls).map(function (el) { return { text: el.value.trim() }; }).filter(function (it) { return it.text; });
    if (!name) { MX.toast('Nom requis', true); return; }
    var data = { name, description: desc, items, updatedAt: FV.serverTimestamp() };
    try {
      if (id) {
        await PMP_DB.tpl().doc(id).update(data);
        MX.toast('Modèle mis à jour ✓');
      } else {
        data.createdAt = FV.serverTimestamp();
        data.createdBy = _author();
        await PMP_DB.tpl().add(data);
        MX.toast('Modèle créé ✓');
      }
    } catch (e) { MX.toast('Erreur : ' + e.message, true); }
  }

  function _delTpl(id) {
    if (!id) { MX.toast('Identifiant introuvable', true); return; }
    var tpl  = _pmpTpl.find(function (t) { return t.id === id; });
    var name = tpl ? tpl.name : '';
    MX.showModal('Supprimer le modèle ?', '"' + esc(name) + '" sera supprimé définitivement.', [
      { label: 'Supprimer', cls: 'danger', fn: async function () {
        try { await PMP_DB.tpl().doc(id).delete(); MX.toast('Modèle supprimé'); }
        catch (e) { console.error('[PMP] delTpl:', e); MX.toast('Erreur suppression : ' + e.message, true); }
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]);
  }

  // ── EXCEL IMPORT HANDLERS ────────────────────────────────────────────────

  function _onImportFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    input.value = '';
    _importStep = 2; _rerender();
    setTimeout(function () { _parseImportFile(file); }, 50);
  }

  function _onImportDrop(e) {
    var file = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    _importStep = 2; _rerender();
    setTimeout(function () { _parseImportFile(file); }, 50);
  }

  function _parseImportFile(file) {
    var ext = (file.name || '').split('.').pop().toLowerCase();
    var reader = new FileReader();
    reader.onerror = function () { MX.toast('Erreur de lecture du fichier', true); _importStep = 1; _rerender(); };
    if (ext === 'csv' || ext === 'txt') {
      reader.onload = function (e) { _parseCsvFallback(e.target.result); };
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.onload = function (e) { _parseXlsxFile(e.target.result); };
      reader.readAsArrayBuffer(file);
    }
  }

  function _parseXlsxFile(buffer) {
    try {
      var XLSX = window.XLSX;
      if (!XLSX) { MX.toast('Bibliothèque Excel non disponible — utilisez un fichier CSV', true); _importStep = 1; _rerender(); return; }
      var wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (!data || !data.length) { MX.toast('Fichier vide', true); _importStep = 1; _rerender(); return; }
      _processRawData(data);
    } catch (e) {
      MX.toast('Erreur lecture Excel : ' + e.message, true);
      _importStep = 1; _rerender();
    }
  }

  function _parseCsvFallback(text) {
    try {
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (!lines.length) { MX.toast('Fichier vide', true); _importStep = 1; _rerender(); return; }
      var semiCount = (lines[0].match(/;/g) || []).length;
      var commaCount = (lines[0].match(/,/g) || []).length;
      var sep = lines[0].includes('\t') ? '\t' : semiCount >= commaCount ? ';' : ',';
      var data = lines.map(function (l) {
        return l.split(sep).map(function (c) { return c.trim().replace(/^["']|["']$/g, ''); });
      });
      _processRawData(data);
    } catch (e) {
      MX.toast('Erreur lecture CSV : ' + e.message, true);
      _importStep = 1; _rerender();
    }
  }

  function _processRawData(data) {
    var headers = (data[0] || []).map(function (c) { return String(c || '').trim(); });
    var rows = data.slice(1).filter(function (r) {
      return r.some(function (c) { return String(c || '').trim(); });
    });
    if (!headers.length || !rows.length) {
      MX.toast('Le fichier semble vide ou mal formaté', true);
      _importStep = 1; _rerender(); return;
    }
    var auto = _autoMapCols(headers);
    _importHeaders  = headers;
    _importRawRows  = rows;
    _importMapping  = auto.mapping;
    _importUnmapped = auto.unmapped;
    _importUserMap  = {};

    var nm = _importMapping.name, em = _importMapping.equipment;
    var fm = _importMapping.frequency, zm = _importMapping.zone;
    var equips = new Set(), freqs = new Set(), zones = new Set();
    rows.forEach(function (r) {
      var en = (em >= 0 ? r[em] : '') || (nm >= 0 ? r[nm] : '') || '';
      if (en) equips.add(String(en).trim().toLowerCase());
      if (fm >= 0 && r[fm]) freqs.add(String(r[fm]).trim());
      if (zm >= 0 && r[zm]) zones.add(String(r[zm]).trim().toLowerCase());
    });
    _importAnalysis = { total: rows.length, equipCount: equips.size || rows.length, freqCount: freqs.size, zoneCount: zones.size };
    _importStep = 3; _importResult = null;
    _rerender();
  }

  function _resetImport() {
    _importStep = 1; _importRawRows = []; _importHeaders = [];
    _importMapping = {}; _importUnmapped = []; _importAnalysis = null;
    _importUserMap = {}; _importResult = null;
    _rerender();
  }

  function _setImportUserMap(fieldKey, colIdx) {
    Object.keys(_importUserMap).forEach(function (k) {
      if (_importUserMap[k] === parseInt(colIdx, 10)) delete _importUserMap[k];
    });
    if (fieldKey) _importUserMap[fieldKey] = parseInt(colIdx, 10);
  }

  function _downloadTemplate() {
    var XLSX = window.XLSX;
    var hdrs = ['Référence','Nom de l\'intervention','Équipement','Catégorie','Zone','Sous-zone',
                'Fréquence','Date prochaine intervention','Durée estimée','Criticité',
                'Technicien référent','Commentaires'];
    var example = ['REF-001','Vérification CTA toiture','CTA-TOITURE-01','CTA','Toiture','Local technique',
                   '90','2025-07-01','2h','haute','Dupont Jean','Vérifier filtres et courroies'];
    if (XLSX) {
      try {
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet([hdrs, example]);
        ws['!cols'] = hdrs.map(function () { return { wch: 24 }; });
        XLSX.utils.book_append_sheet(wb, ws, 'PMP Maintix');
        XLSX.writeFile(wb, 'Modele_PMP_Maintix.xlsx');
        return;
      } catch (e_) {}
    }
    var csv = '﻿' + hdrs.join(';') + '\n' + example.join(';');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'Modele_PMP_Maintix.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function _runImport() {
    if (_importStep !== 3) return;
    _importStep = 4; _rerender();

    var today = _today();
    var finalMap = Object.assign({}, _importMapping);
    Object.keys(_importUserMap).forEach(function (k) {
      var v = parseInt(_importUserMap[k], 10);
      if (!isNaN(v) && v >= 0) finalMap[k] = v;
    });

    function _cell(r, key) {
      var idx = finalMap[key];
      return (idx !== undefined && idx >= 0 && idx < r.length) ? String(r[idx] || '').trim() : '';
    }

    var validRows = _importRawRows.filter(function (r) { return _cell(r, 'name') || _cell(r, 'equipment'); });
    var created = 0, updated = 0, intCreated = 0;
    var importedNames = new Set(), catCount = {};

    try {
      for (var i = 0; i < validRows.length; i++) {
        var r = validRows[i];
        var eqName  = _cell(r, 'equipment') || _cell(r, 'name');
        var intName = _cell(r, 'name') || eqName;
        if (!eqName) continue;
        importedNames.add(eqName.toLowerCase());

        var eqType  = _matchType(_cell(r, 'type'));
        catCount[eqType] = (catCount[eqType] || 0) + 1;
        var freq    = _parseFreq(_cell(r, 'frequency')) || 30;
        var nextDue = _parseDate(_cell(r, 'nextDue')) || _addDays(today, freq);
        var crit    = _matchCrit(_cell(r, 'criticite')) || 'normale';
        var tech    = _cell(r, 'technician'), zone = _cell(r, 'zone');
        var subZone = _cell(r, 'subZone'), ref = _cell(r, 'ref');
        var comments = _cell(r, 'comments'), duration = _cell(r, 'duration');

        var existing = _pmpEq.find(function (e) { return (e.name || '').toLowerCase() === eqName.toLowerCase(); });
        var eqId;

        if (existing) {
          await PMP_DB.eq().doc(existing.id).update({
            type: eqType, zone: zone || existing.zone || '',
            subZone: subZone || existing.subZone || '',
            ref: ref || existing.ref || '', criticite: crit, frequency: freq,
            technician: tech || existing.technician || '', nextDue: nextDue,
            lastImportAbsent: false, updatedAt: FV.serverTimestamp(),
          });
          eqId = existing.id; updated++;
        } else {
          var docRef = await PMP_DB.eq().add({
            name: eqName, type: eqType, zone: zone || '', subZone: subZone || '',
            ref: ref || '', criticite: crit, frequency: freq, technician: tech || '',
            startDate: today, lastDone: '', nextDue: nextDue, status: 'actif',
            templateId: '', lastImportAbsent: false,
            createdAt: FV.serverTimestamp(), createdBy: _author() + ' (Import Excel)',
          });
          eqId = docRef.id; created++;
        }

        if (nextDue && eqId) {
          var hasOpen = _pmpInt.some(function (x) {
            return x.equipmentId === eqId && x.dueDate === nextDue &&
                   (x.status === 'planifiee' || x.status === 'en_cours');
          });
          if (!hasOpen) {
            await PMP_DB.int().add({
              equipmentId: eqId, equipmentName: eqName, intName: intName,
              type: eqType, dueDate: nextDue, source: 'import',
              status: nextDue < today ? 'en_retard' : 'planifiee',
              comments: comments, duration: duration,
              createdAt: FV.serverTimestamp(),
            });
            intCreated++;
          }
        }
      }

      var absent = _pmpEq.filter(function (e) {
        return e.status === 'actif' && !importedNames.has((e.name || '').toLowerCase());
      });
      for (var j = 0; j < absent.length; j++) {
        await PMP_DB.eq().doc(absent[j].id).update({ lastImportAbsent: true, updatedAt: FV.serverTimestamp() });
      }

      var suggestions = Object.keys(catCount)
        .filter(function (cat) { return catCount[cat] >= 2; })
        .filter(function (cat) { return !_pmpTpl.some(function (t) { return (t.type || t.category) === cat; }); });

      _importResult = { created: created, updated: updated, intCreated: intCreated, absent: absent.length, suggestions: suggestions };
      _importStep = 5;
      window._pmpGenDone = false;
      _rerender();
      MX.toast('Import terminé : ' + created + ' créé' + (created > 1 ? 's' : '') + ', ' + updated + ' mis à jour ✓');
    } catch (e) {
      MX.toast('Erreur import : ' + e.message, true);
      _importStep = 3; _rerender();
    }
  }

  async function _createDefaultTpls(cats) {
    if (!Array.isArray(cats) || !cats.length) return;
    var done = 0;
    try {
      for (var i = 0; i < cats.length; i++) {
        var cat = cats[i];
        var items = TPL_DEFAULTS[cat] || ['Contrôle visuel général', 'Vérifier l\'état général'];
        var ti = EQ_TYPES[cat] || { l: cat, icon: '🔧' };
        await PMP_DB.tpl().add({
          name: 'Modèle ' + ti.l, type: cat, category: cat,
          description: 'Modèle standard ' + ti.l + ' — généré automatiquement à l\'import',
          items: items,
          createdAt: FV.serverTimestamp(), createdBy: _author() + ' (Import auto)',
        });
        done++;
      }
      MX.toast(done + ' modèle' + (done > 1 ? 's' : '') + ' de checklist créé' + (done > 1 ? 's' : '') + ' ✓');
      if (_importResult) _importResult.suggestions = [];
      _rerender();
    } catch (e) {
      MX.toast('Erreur création modèles : ' + e.message, true);
    }
  }

  // ── FILTER SETTERS ────────────────────────────────────────────────────────

  function _setEqSearch(v)  { _eqSearch        = v; _rerender(); }
  function _setEqType(v)    { _eqTypeFilter    = v; _rerender(); }
  function _setIntFilter(v) { _intStatusFilter = v; _rerender(); }
  function _setCalMonth(v)  { _calMonth        = v; _rerender(); }

  // ── EXPORT ────────────────────────────────────────────────────────────────

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.PMP = {
    render,
    _tab, _setEqSearch, _setEqType, _setIntFilter, _setCalMonth,
    _eqForm, _delEq, _createInt, _createIntManual, _markDone, _delInt,
    _tplForm, _tplAddItem, _delTpl,
    _onImportFile, _onImportDrop, _runImport, _resetImport, _setImportUserMap, _downloadTemplate, _createDefaultTpls, _checkAndGenerate,
    getStats: function () {
      var k = _kpiData();
      return { totalEq: k.totalEq, thisMonthCount: k.thisMonthCount, realisees: k.realisees, enRetard: k.enRetard, conformite: k.conformite, nextDue: k.nextDue };
    },
  };
})();
