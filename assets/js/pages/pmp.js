(function () {
  'use strict';

  var FV = firebase.firestore.FieldValue;

  // ── FIRESTORE ERROR HANDLER ──
  function _fsErr(coll) {
    return function (err) {
      var code = err.code || '';
      var link = (err.message || '').match(/https:\/\/\S+/);
      link = link ? link[0] : '';
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
  var _eqFormMode      = null;   // null | 'new' | '<docId>'
  var _eqFormDraft     = {};

  var PMP_DB = {
    eq:  function () { return db.collection('pmp_equipments');   },
    int: function () { return db.collection('pmp_interventions'); },
    tpl: function () { return db.collection('pmp_templates');    },
  };

  var EQ_TYPES = {
    // ── Fluides & Eau
    plomberie:         { l: 'Plomberie',             icon: '🔧', grp: 'Fluides & Eau' },
    pompe:             { l: 'Pompe',                 icon: '💧', grp: 'Fluides & Eau' },
    surpresseur:       { l: 'Surpresseur',           icon: '⬆️', grp: 'Fluides & Eau' },
    adoucisseur:       { l: 'Adoucisseur',           icon: '💎', grp: 'Fluides & Eau' },
    ballon_ecs:        { l: 'Ballon ECS',            icon: '🔥', grp: 'Fluides & Eau' },
    ecs:               { l: 'Production ECS',        icon: '🔥', grp: 'Fluides & Eau' },
    ballon_tampon:     { l: 'Ballon tampon',         icon: '🛢️', grp: 'Fluides & Eau' },
    bac_graisse:       { l: 'Bac à graisse',         icon: '🫙', grp: 'Fluides & Eau' },
    sanitaire:         { l: 'Sanitaire',             icon: '🚿', grp: 'Fluides & Eau' },
    arrosage:          { l: 'Arrosage',              icon: '🌱', grp: 'Fluides & Eau' },
    // ── CVC
    chauffage:         { l: 'Chauffage',             icon: '🌡️', grp: 'CVC' },
    climatisation:     { l: 'Climatisation',         icon: '❄️', grp: 'CVC' },
    ventilation:       { l: 'Ventilation',           icon: '🌬️', grp: 'CVC' },
    cta:               { l: 'CTA',                   icon: '🌀', grp: 'CVC' },
    vmc:               { l: 'VMC',                   icon: '💨', grp: 'CVC' },
    // ── Électricité
    electricite:       { l: 'Électricité',           icon: '⚡', grp: 'Électricité' },
    tgbt:              { l: 'TGBT',                  icon: '⚡', grp: 'Électricité' },
    eclairage:         { l: 'Éclairage',             icon: '💡', grp: 'Électricité' },
    groupe_elec:       { l: 'Groupe électrogène',    icon: '🏭', grp: 'Électricité' },
    compresseur:       { l: 'Compresseur',           icon: '🔩', grp: 'Électricité' },
    // ── Froid
    groupe_froid:      { l: 'Groupes frigorifiques', icon: '🥶', grp: 'Froid' },
    chambre_froide:    { l: 'Chambres froides',      icon: '🧊', grp: 'Froid' },
    // ── Sécurité
    securite_incendie: { l: 'Sécurité incendie',     icon: '🔴', grp: 'Sécurité' },
    ssi:               { l: 'SSI',                   icon: '🚨', grp: 'Sécurité' },
    desenfumage:       { l: 'Désenfumage',           icon: '🌫️', grp: 'Sécurité' },
    controle_acces:    { l: "Contrôle d'accès",      icon: '🔐', grp: 'Sécurité' },
    videosurveillance: { l: 'Vidéosurveillance',     icon: '📹', grp: 'Sécurité' },
    // ── Transport & Automatismes
    ascenseur:         { l: 'Ascenseur',             icon: '🛗', grp: 'Transport & Automatismes' },
    monte_charge:      { l: 'Monte-charge',          icon: '📦', grp: 'Transport & Automatismes' },
    porte_auto:        { l: 'Portes automatiques',   icon: '🚪', grp: 'Transport & Automatismes' },
    portail:           { l: 'Portails',              icon: '🔒', grp: 'Transport & Automatismes' },
    barriere:          { l: 'Barrières parking',     icon: '🚧', grp: 'Transport & Automatismes' },
    // ── Équipements
    cuisine:           { l: 'Cuisine',               icon: '🍳', grp: 'Équipements' },
    buanderie:         { l: 'Buanderie',             icon: '🧺', grp: 'Équipements' },
    piscine:           { l: 'Piscine',               icon: '🏊', grp: 'Loisirs' },
    spa:               { l: 'Spa',                   icon: '🧖', grp: 'Loisirs' },
    // ── Numérique & Communication
    reseau_info:       { l: 'Réseau informatique',   icon: '🌐', grp: 'Numérique & Communication' },
    telephonie:        { l: 'Téléphonie',            icon: '📞', grp: 'Numérique & Communication' },
    television:        { l: 'Télévision',            icon: '📺', grp: 'Numérique & Communication' },
    // ── Bâtiment & Extérieur
    local_technique:   { l: 'Local technique',       icon: '🏭', grp: 'Bâtiment & Extérieur' },
    espaces_verts:     { l: 'Espaces verts',         icon: '🌿', grp: 'Bâtiment & Extérieur' },
    mobilier:          { l: 'Mobilier',              icon: '🪑', grp: 'Bâtiment & Extérieur' },
    batiment:          { l: 'Bâtiment',              icon: '🏢', grp: 'Bâtiment & Extérieur' },
    divers:            { l: 'Divers',                icon: '🔧', grp: 'Bâtiment & Extérieur' },
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

  var DURATIONS = [
    '15 min', '30 min', '45 min',
    '1h', '1h30', '2h', '3h', '4h', '5h', '6h', '7h', '8h',
    '1 journée', '2 journées', '3 journées',
    '1 semaine', '2 semaines', '1 mois',
    'Autre',
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
    { id: 'file',          icon: 'fa-inbox',                l: "File d'attente",  mob: 'File'     },
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

  function _eqTypeOptgroups(sel) {
    var groups = {};
    var order  = [];
    Object.entries(EQ_TYPES).forEach(function (kv) {
      var g = kv[1].grp || 'Autres';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(kv);
    });
    return order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' +
        groups[g].map(function (kv) {
          return '<option value="' + kv[0] + '"' + (sel === kv[0] ? ' selected' : '') + '>' + kv[1].icon + ' ' + kv[1].l + '</option>';
        }).join('') +
        '</optgroup>';
    }).join('');
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
    }, _fsErr('pmp_equipments'));
    _unsubPmp.int = PMP_DB.int().onSnapshot(function (snap) {
      _pmpInt = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    }, _fsErr('pmp_interventions'));
    _unsubPmp.tpl = PMP_DB.tpl().onSnapshot(function (snap) {
      _pmpTpl = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    }, _fsErr('pmp_templates'));

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
               (x.status === 'planifiee' || x.status === 'en_cours' || x.status === 'en_retard');
      });
      if (existing) continue;
      try {
        var checklistItems = [];
        if (eq.templateId) {
          var tpl = _pmpTpl.find(function (t) { return t.id === eq.templateId; });
          if (tpl && tpl.items) {
            checklistItems = tpl.items.map(function (it) { return { text: it.text || it, done: false }; });
          }
        }
        await PMP_DB.int().add({
          equipmentId:       eq.id,
          equipmentName:     eq.name,
          type:              eq.type     || 'divers',
          zone:              eq.zone     || '',
          subZone:           eq.subZone  || '',
          ref:               eq.ref      || '',
          dueDate:           eq.nextDue,
          frequency:         eq.frequency || 30,
          technician:        '',
          criticite:         eq.criticite || 'normale',
          status:            eq.nextDue < today ? 'en_retard' : 'planifiee',
          source:            'auto',
          checklistItems:    checklistItems,
          estimatedDuration: eq.duration || '',
          technicalNotes:    eq.technicalNotes || '',
          templateId:        eq.templateId || '',
          createdAt:         FV.serverTimestamp(),
        });
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
    var enAttente = _pmpInt.filter(function (i) {
      return i.status !== 'terminee' && i.status !== 'annulee' && !i.missionId;
    }).length;
    return {
      totalEq:        activeEq.length,
      thisMonthCount: monthInts.length,
      realisees:      realisees,
      enRetard:       enRetard,
      enAttente:      enAttente,
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

  function _tab(id) { _eqFormMode = null; _curTab = id; _rerender(); }

  function _body() {
    if (_eqFormMode !== null)        return _tEqFormPage();
    if (_curTab === 'dashboard')     return _tDashboard();
    if (_curTab === 'equipements')   return _tEquipements();
    if (_curTab === 'calendrier')    return _tCalendrier();
    if (_curTab === 'interventions') return _tInterventions();
    if (_curTab === 'file')          return _tQueue();
    if (_curTab === 'retards')       return _tRetards();
    if (_curTab === 'modeles')       return _tModeles();
    if (_curTab === 'import')        return _tImport();
    if (_curTab === 'historique')    return _tHistorique();
    return '';
  }

  // ── DASHBOARD V2 — helpers ───────────────────────────────────────────────

  function _parseDurMins(s) {
    if (!s) return 0;
    var low = s.toLowerCase().trim();
    if (low === '15 min') return 15;
    if (low === '30 min') return 30;
    if (low === '45 min') return 45;
    if (low === '1 journée' || low === 'journée') return 480;
    if (low === '2 journées') return 960;
    if (low === '3 journées') return 1440;
    if (low === '1 semaine') return 2400;
    if (low === '2 semaines') return 4800;
    if (low === '1 mois') return 9600;
    var m = s.match(/^(\d+)h(\d+)?$/i);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2] || 0);
    m = s.match(/^(\d+)\s*min$/i);
    if (m) return parseInt(m[1]);
    return 0;
  }

  function _eqHealthScore(eq) {
    var today = _today();
    if (eq.status === 'inactif') return 50;
    var lates = _pmpInt.filter(function (i) {
      return i.equipmentId === eq.id &&
             (i.status === 'en_retard' || (i.dueDate && i.dueDate < today && i.status !== 'terminee' && i.status !== 'annulee'));
    });
    if (!lates.length) {
      if (!eq.nextDue) return 90;
      var daysAhead = Math.round((new Date(eq.nextDue + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
      return daysAhead > 30 ? 96 : daysAhead > 7 ? 88 : daysAhead >= 0 ? 78 : 65;
    }
    var maxLate = Math.max.apply(null, lates.map(function (i) { return _daysLate(i.dueDate); }));
    return maxLate <= 3 ? 70 : maxLate <= 7 ? 55 : maxLate <= 14 ? 40 : 25;
  }

  function _pmdbKpiCard(icon, color, val, lbl, sub, tab, alert) {
    var isAlert = alert && Number(val) > 0;
    var onclick = tab ? ' onclick="MX.Pages.PMP._tab(\'' + tab + '\')" style="cursor:pointer"' : '';
    return '<div class="pmdb-kpi-card' + (isAlert ? ' pmdb-kpi-card--alert' : '') + '"' + onclick + '>' +
      '<div class="pmdb-kpi-ico" style="background:' + color + '20"><i class="fas ' + icon + '" style="color:' + color + '"></i></div>' +
      '<div class="pmdb-kpi-body">' +
        '<div class="pmdb-kpi-val" style="color:' + (isAlert ? '#EF4444' : color) + '">' + val + '</div>' +
        '<div class="pmdb-kpi-lbl">' + lbl + '</div>' +
        '<div class="pmdb-kpi-sub">' + sub + '</div>' +
      '</div></div>';
  }

  function _pmdbChartSVG(series, dates) {
    var W = 700, H = 200, ML = 40, MR = 15, MT = 14, MB = 36;
    var PW = W - ML - MR, PH = H - MT - MB;
    var maxV = 1;
    series.forEach(function (s) { s.vals.forEach(function (v) { if (v > maxV) maxV = v; }); });
    maxV = Math.max(Math.ceil(maxV * 1.3), 5);
    var today = _today();

    function px(i) { return ML + (i / Math.max(dates.length - 1, 1)) * PW; }
    function py(v) { return MT + PH - (v / maxV * PH); }

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var yV = g * maxV / 4;
      var yG = py(yV).toFixed(1);
      grid += '<line x1="' + ML + '" y1="' + yG + '" x2="' + (W - MR) + '" y2="' + yG + '" stroke="var(--border)" stroke-width="0.7" stroke-dasharray="4,3" opacity="0.7"/>';
      if (g > 0) grid += '<text x="' + (ML - 5) + '" y="' + (parseFloat(yG) + 3).toFixed(0) + '" text-anchor="end" font-size="9" fill="var(--text3)">' + Math.round(yV) + '</text>';
    }

    var xlbl = '';
    var xstep = Math.max(1, Math.floor(dates.length / 8));
    dates.forEach(function (ds, i) {
      if (i % xstep === 0 || i === dates.length - 1) {
        var p = ds.split('-');
        xlbl += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="9" fill="var(--text3)">' + p[2] + '/' + p[1] + '</text>';
      }
    });

    var todayIdx = dates.indexOf(today);
    var todayMk = '';
    if (todayIdx >= 0) {
      var tx = px(todayIdx).toFixed(1);
      todayMk = '<line x1="' + tx + '" y1="' + MT + '" x2="' + tx + '" y2="' + (MT + PH) + '" stroke="#5B3DF5" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.45"/>' +
        '<rect x="' + (parseFloat(tx) - 13) + '" y="' + (MT - 12) + '" width="26" height="12" rx="3" fill="#5B3DF5" opacity="0.85"/>' +
        '<text x="' + tx + '" y="' + (MT - 3) + '" text-anchor="middle" font-size="8" fill="#fff" font-weight="600">Auj.</text>';
    }

    function buildPath(vals) {
      var pts = vals.map(function (v, i) { return { x: px(i), y: py(v) }; });
      if (!pts.length) return '';
      var d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
      for (var j = 1; j < pts.length; j++) {
        var cpx = ((pts[j - 1].x + pts[j].x) / 2).toFixed(1);
        d += ' C' + cpx + ',' + pts[j - 1].y.toFixed(1) + ' ' + cpx + ',' + pts[j].y.toFixed(1) + ' ' + pts[j].x.toFixed(1) + ',' + pts[j].y.toFixed(1);
      }
      return d;
    }

    function areaPath(vals) {
      var base = (MT + PH).toFixed(1);
      var p = buildPath(vals);
      return p ? p + ' L' + px(vals.length - 1).toFixed(1) + ',' + base + ' L' + ML + ',' + base + ' Z' : '';
    }

    var seriesSvg = '';
    series.forEach(function (s) {
      var dash = s.dashed ? ' stroke-dasharray="7,4"' : '';
      if (s.area) seriesSvg += '<path d="' + areaPath(s.vals) + '" fill="' + s.color + '" fill-opacity="0.09"/>';
      var linePath = buildPath(s.vals);
      if (linePath) seriesSvg += '<path d="' + linePath + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.w || 2.5) + '" stroke-linecap="round" stroke-linejoin="round"' + dash + '/>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" style="display:block" id="pmdb-svg">' +
      '<rect x="' + ML + '" y="' + MT + '" width="' + PW + '" height="' + PH + '" fill="var(--bg4)" rx="4" opacity="0.25"/>' +
      grid +
      '<line x1="' + ML + '" y1="' + MT + '" x2="' + ML + '" y2="' + (MT + PH) + '" stroke="var(--border)" stroke-width="1"/>' +
      '<line x1="' + ML + '" y1="' + (MT + PH) + '" x2="' + (W - MR) + '" y2="' + (MT + PH) + '" stroke="var(--border)" stroke-width="1"/>' +
      todayMk + seriesSvg + xlbl + '</svg>';
  }

  // ── DASHBOARD V2 ──────────────────────────────────────────────────────────

  function _tDashboard() {
    var today   = _today();
    var per     = window._pmpDashPer   || '30';
    var page    = parseInt(window._pmpDashPage || 1);
    var srch    = window._pmpDashSrch  || '';
    var eqType  = window._pmpDashType  || 'all';
    var eqSite  = window._pmpDashSite  || 'all';
    var eqStat  = window._pmpDashStat  || 'all';
    var PER     = parseInt(per);
    var kpi     = _kpiData();
    var weekEnd = _addDays(today, 6);

    // ── KPI computations ──
    var todayCount = _pmpInt.filter(function (i) {
      return i.dueDate === today && i.status !== 'terminee' && i.status !== 'annulee';
    }).length;
    var weekCount = _pmpInt.filter(function (i) {
      return i.dueDate >= today && i.dueDate <= weekEnd && i.status !== 'terminee' && i.status !== 'annulee';
    }).length;
    var totalMins = _pmpInt.filter(function (i) { return i.status !== 'annulee'; }).reduce(function (s, i) {
      return s + _parseDurMins(i.estimatedDuration);
    }, 0);
    var chargeH = Math.round(totalMins / 60);

    // ── Chart data ──
    var chartDates = [];
    for (var ci = -5; ci < PER; ci++) chartDates.push(_addDays(today, ci));

    function _chartCount(ds, filter) {
      return _pmpInt.filter(function (i) { return i.dueDate === ds && filter(i); }).length;
    }
    var chartSeries = [
      {
        vals: chartDates.map(function (ds) { return _chartCount(ds, function (i) { return i.status !== 'annulee'; }); }),
        color: '#3B82F6', w: 2.5, area: true
      },
      {
        vals: chartDates.map(function (ds) {
          return _chartCount(ds, function (i) { return i.status === 'en_retard' || (i.dueDate < today && i.status !== 'terminee' && i.status !== 'annulee'); });
        }),
        color: '#EF4444', w: 2
      },
      {
        vals: chartDates.map(function (ds) {
          return (ds >= today && ds <= weekEnd) ? _chartCount(ds, function (i) { return i.status !== 'terminee' && i.status !== 'annulee'; }) : 0;
        }),
        color: '#F59E0B', w: 2
      },
      {
        vals: chartDates.map(function (ds) {
          var nm = _addDays(today, 30), nme = _addDays(today, 60);
          return (ds >= nm && ds <= nme) ? _chartCount(ds, function (i) { return i.status !== 'annulee'; }) : 0;
        }),
        color: '#22C55E', w: 2, dashed: true
      },
    ];
    var chartSVG = _pmdbChartSVG(chartSeries, chartDates);

    // ── À surveiller ──
    var lateInts = _pmpInt.filter(function (i) {
      return i.status === 'en_retard' || (i.dueDate && i.dueDate < today && i.status !== 'terminee' && i.status !== 'annulee');
    }).sort(function (a, b) { return _daysLate(b.dueDate) - _daysLate(a.dueDate); }).slice(0, 5);

    var watchHtml = lateInts.length ? lateInts.map(function (i) {
      var days = _daysLate(i.dueDate);
      var ti   = EQ_TYPES[i.type] || { icon: '🔧' };
      var col  = days >= 7 ? '#EF4444' : '#F59E0B';
      var nxt  = _pmpInt.filter(function (x) { return x.equipmentId === i.equipmentId && x.dueDate >= today && x.status !== 'annulee'; })
                         .sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); })[0];
      return '<div class="pmdb-watch-row">' +
        '<div class="pmdb-watch-ico" style="background:' + col + '18;color:' + col + '">' + ti.icon + '</div>' +
        '<div class="pmdb-watch-info">' +
          '<div class="pmdb-watch-name">' + esc(i.equipmentName || '—') + '</div>' +
          '<div class="pmdb-watch-sub"><span style="color:' + col + ';font-weight:600">Retard : ' + days + 'j</span>' +
          (nxt ? ' · Prochaine : ' + _dateLbl(nxt.dueDate) : '') + '</div>' +
        '</div></div>';
    }).join('') : '<div class="pmdb-empty-sm"><i class="fas fa-check-circle" style="color:#22C55E"></i> Aucun retard en cours</div>';

    // ── Top 5 interventions les plus longues ──
    var top5 = _pmpInt.filter(function (i) { return i.estimatedDuration; })
      .map(function (i) { return { name: i.equipmentName || '—', dur: i.estimatedDuration, mins: _parseDurMins(i.estimatedDuration) }; })
      .filter(function (x) { return x.mins > 0; })
      .sort(function (a, b) { return b.mins - a.mins; }).slice(0, 5);

    var top5Html = top5.length ? top5.map(function (item, idx) {
      return '<div class="pmdb-top5-row">' +
        '<span class="pmdb-top5-rank">' + (idx + 1) + '</span>' +
        '<span class="pmdb-top5-name">' + esc(item.name) + '</span>' +
        '<span class="pmdb-top5-dur">' + esc(item.dur) + '</span></div>';
    }).join('') : '<div class="pmdb-empty-sm">Aucune durée renseignée</div>';

    // ── Score de fiabilité donut ──
    var score      = kpi.conformite;
    var scoreColor = score >= 90 ? '#22C55E' : score >= 70 ? '#3B82F6' : score >= 50 ? '#F59E0B' : '#EF4444';
    var scoreLbl   = score >= 90 ? 'Excellent' : score >= 80 ? 'Très bon' : score >= 70 ? 'Bon' : score >= 50 ? 'Moyen' : 'Critique';
    var SR = 60, SCX = 75, SCY = 75, SCIRC = 2 * Math.PI * SR;
    var SdashD = (score / 100) * SCIRC;
    var donutSVG = '<svg viewBox="0 0 150 150" width="120" height="120" style="flex-shrink:0">' +
      '<circle cx="' + SCX + '" cy="' + SCY + '" r="' + SR + '" fill="none" stroke="var(--border)" stroke-width="13"/>' +
      '<circle cx="' + SCX + '" cy="' + SCY + '" r="' + SR + '" fill="none" stroke="' + scoreColor + '" stroke-width="13"' +
      ' stroke-dasharray="' + SdashD.toFixed(1) + ' ' + (SCIRC - SdashD).toFixed(1) + '"' +
      ' stroke-linecap="round" transform="rotate(-90 ' + SCX + ' ' + SCY + ')"/>' +
      '<text x="' + SCX + '" y="' + (SCY - 6) + '" text-anchor="middle" font-size="24" font-weight="700" fill="' + scoreColor + '" font-family="monospace">' + score + '%</text>' +
      '<text x="' + SCX + '" y="' + (SCY + 13) + '" text-anchor="middle" font-size="11" fill="var(--text3)">' + scoreLbl + '</text>' +
      '</svg>';

    var excellent = 0, bonne = 0, moyenne = 0, faible = 0;
    _pmpEq.forEach(function (eq) {
      var s = _eqHealthScore(eq);
      if (s >= 90) excellent++; else if (s >= 70) bonne++; else if (s >= 50) moyenne++; else faible++;
    });
    var totEq = _pmpEq.length || 1;
    var scoreBreak = [
      { lbl: 'Excellente', count: excellent, color: '#22C55E' },
      { lbl: 'Bonne',      count: bonne,     color: '#3B82F6' },
      { lbl: 'Moyenne',    count: moyenne,   color: '#F59E0B' },
      { lbl: 'Faible',     count: faible,    color: '#EF4444' },
    ].map(function (b) {
      return '<div class="pmdb-score-brow">' +
        '<span class="pmdb-score-bdot" style="background:' + b.color + '"></span>' +
        '<span class="pmdb-score-blbl">' + b.lbl + '</span>' +
        '<span class="pmdb-score-bcnt">' + b.count + ' (' + Math.round(b.count / totEq * 100) + '%)</span>' +
        '</div>';
    }).join('');

    // ── Equipment grid (filtered + paginated) ──
    var PER_PAGE = 8;
    var zonesArr = [];
    _pmpEq.forEach(function (e) { if (e.zone && zonesArr.indexOf(e.zone) < 0) zonesArr.push(e.zone); });
    zonesArr.sort();

    var filtered = _pmpEq.filter(function (eq) {
      if (srch) {
        var sv = srch.toLowerCase();
        if (!(eq.name || '').toLowerCase().includes(sv) && !(eq.zone || '').toLowerCase().includes(sv) && !(eq.ref || '').toLowerCase().includes(sv)) return false;
      }
      if (eqType !== 'all' && eq.type !== eqType) return false;
      if (eqSite !== 'all' && eq.zone !== eqSite) return false;
      if (eqStat !== 'all') {
        var isLateF = eq.nextDue && eq.nextDue < today && eq.status !== 'inactif';
        var isSoonF = !isLateF && eq.nextDue && eq.nextDue >= today && eq.nextDue <= weekEnd;
        if (eqStat === 'late' && !isLateF) return false;
        if (eqStat === 'soon' && !isSoonF) return false;
        if (eqStat === 'ok' && (isLateF || isSoonF)) return false;
      }
      return true;
    }).sort(function (a, b) {
      var aL = (a.nextDue && a.nextDue < today) ? 1 : 0;
      var bL = (b.nextDue && b.nextDue < today) ? 1 : 0;
      if (bL !== aL) return bL - aL;
      return (a.nextDue || 'z').localeCompare(b.nextDue || 'z');
    });

    var totalEqs   = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalEqs / PER_PAGE));
    var safeP      = Math.min(Math.max(1, page), totalPages);
    var startIdx   = (safeP - 1) * PER_PAGE;
    var pageEqs    = filtered.slice(startIdx, startIdx + PER_PAGE);

    var eqCardsHtml = '';
    if (!pageEqs.length) {
      eqCardsHtml = '<div class="pmdb-empty"><i class="fas fa-wrench"></i>' +
        '<div>' + (!_pmpEq.length ? 'Aucun équipement configuré' : 'Aucun résultat pour cette recherche') + '</div>' +
        (!_pmpEq.length ? '<button class="pmdb-add-btn" style="margin-top:6px" onclick="MX.Pages.PMP._eqForm(null)"><i class="fas fa-plus"></i> Ajouter</button>' : '') +
        '</div>';
    } else {
      eqCardsHtml = '<div class="pmdb-eq-grid">';
      pageEqs.forEach(function (eq) {
        var ti       = EQ_TYPES[eq.type] || { icon: '🔧', l: eq.type || 'Divers' };
        var isLate   = eq.nextDue && eq.nextDue < today && eq.status !== 'inactif';
        var daysOff  = eq.nextDue ? Math.round((new Date(eq.nextDue + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000) : null;
        var health   = _eqHealthScore(eq);
        var hColor   = health >= 80 ? '#22C55E' : health >= 60 ? '#F59E0B' : health >= 40 ? '#F97316' : '#EF4444';
        var badgeT   = eq.status === 'inactif' ? 'off' : isLate ? 'late' : (daysOff !== null && daysOff <= 7) ? 'soon' : 'ok';
        var badgeLbl = { off:'Inactif', late:'En retard', soon:'À venir', ok:'OK' }[badgeT];
        var nextStr  = !eq.nextDue ? '—' : isLate ? '<span style="color:#EF4444">' + _dateLbl(eq.nextDue) + ' (' + Math.abs(daysOff) + 'j)</span>' :
                       daysOff === 0 ? "Aujourd'hui" : _dateLbl(eq.nextDue);
        var latestInt = _pmpInt.filter(function (i) { return i.equipmentId === eq.id && i.technician; })
                               .sort(function (a, b) { return (b.dueDate || '').localeCompare(a.dueDate || ''); })[0];
        var tech = latestInt ? latestInt.technician : (eq.technician || '');
        var dur  = latestInt ? (latestInt.estimatedDuration || '') : (eq.duration || '');
        var initials = tech ? tech.split(' ').map(function (w) { return w ? w[0].toUpperCase() : ''; }).join('').slice(0, 2) : '';

        eqCardsHtml +=
          '<div class="pmdb-eq-card' + (isLate ? ' pmdb-eq-card--late' : '') + '">' +
            '<div class="pmdb-eq-card-top">' +
              '<div class="pmdb-eq-ico">' + ti.icon + '</div>' +
              '<div class="pmdb-eq-head">' +
                '<div class="pmdb-eq-name">' + esc(eq.name) + '</div>' +
                '<div class="pmdb-eq-ref">' + (eq.ref ? esc(eq.ref) + ' · ' : '') + esc(ti.l) + '</div>' +
              '</div>' +
              '<span class="pmdb-eq-badge pmdb-eq-badge--' + badgeT + '">' + badgeLbl + '</span>' +
            '</div>' +
            (eq.zone ? '<div class="pmdb-eq-zone"><i class="fas fa-location-dot"></i> ' + esc(eq.zone) + (eq.subZone ? ' · ' + esc(eq.subZone) : '') + '</div>' : '') +
            '<div class="pmdb-eq-health-row" style="--hw:' + health + '%;--hc:' + hColor + '">' +
              '<div class="pmdb-eq-health-bar"><div class="pmdb-eq-health-fill"></div></div>' +
              '<span class="pmdb-eq-health-pct" style="color:' + hColor + '">' + health + '%</span>' +
            '</div>' +
            '<div class="pmdb-eq-meta">' +
              '<div class="pmdb-eq-meta-item"><i class="fas fa-calendar-check"></i> ' + nextStr + '</div>' +
              (dur ? '<div class="pmdb-eq-meta-item"><i class="fas fa-clock"></i> ' + esc(dur) + '</div>' : '') +
            '</div>' +
            (tech ? '<div class="pmdb-eq-tech"><div class="pmdb-eq-tech-av">' + initials + '</div><span>' + esc(tech) + '</span></div>' : '') +
            '<div class="pmdb-eq-actions">' +
              '<button class="pmdb-eq-btn-int" onclick="MX.Pages.PMP._createInt(\'' + esc(eq.id) + '\')"><i class="fas fa-plus-circle"></i> Intervention</button>' +
              '<button class="pmdb-eq-btn-ico" onclick="MX.Pages.PMP._eqForm(\'' + esc(eq.id) + '\')" title="Modifier"><i class="fas fa-pen"></i></button>' +
              '<button class="pmdb-eq-btn-ico pmdb-eq-btn-del" onclick="MX.Pages.PMP._delEq(\'' + eq.id + '\')" title="Supprimer"><i class="fas fa-trash"></i></button>' +
            '</div>' +
          '</div>';
      });
      eqCardsHtml += '</div>';
    }

    // ── Pagination ──
    var pgHtml = '';
    if (totalPages > 1) {
      var pageNums = '';
      var prev = -1;
      for (var p = 1; p <= totalPages; p++) {
        var show = p === 1 || p === totalPages || (p >= safeP - 1 && p <= safeP + 1);
        if (show) {
          if (prev > 0 && p - prev > 1) pageNums += '<span class="pmdb-pg-dots">…</span>';
          pageNums += '<button class="pmdb-pg-btn' + (p === safeP ? ' pmdb-pg-btn--act' : '') + '"' +
            ' onclick="window._pmpDashPage=' + p + ';MX.Pages.PMP._tab(\'dashboard\')">' + p + '</button>';
          prev = p;
        }
      }
      pgHtml = '<div class="pmdb-pg-row">' +
        '<div class="pmdb-pagination">' +
          '<button class="pmdb-pg-btn"' + (safeP <= 1 ? ' disabled' : ' onclick="window._pmpDashPage=' + (safeP - 1) + ';MX.Pages.PMP._tab(\'dashboard\')"') + '><i class="fas fa-chevron-left"></i></button>' +
          pageNums +
          '<button class="pmdb-pg-btn"' + (safeP >= totalPages ? ' disabled' : ' onclick="window._pmpDashPage=' + (safeP + 1) + ';MX.Pages.PMP._tab(\'dashboard\')"') + '><i class="fas fa-chevron-right"></i></button>' +
        '</div>' +
        '<div class="pmdb-pg-info">Afficher ' + (startIdx + 1) + '-' + Math.min(startIdx + PER_PAGE, totalEqs) + ' sur ' + totalEqs + ' équipements</div>' +
      '</div>';
    }

    // ── Toolbar selectors ──
    var perBtns = ['7','30','90','365'].map(function (p) {
      var lbl = { 7:'7J', 30:'30J', 90:'3M', 365:'1A' }[p];
      return '<button class="pmdb-per-btn' + (per === p ? ' pmdb-per-btn--act' : '') + '" onclick="window._pmpDashPer=\'' + p + '\';MX.Pages.PMP._tab(\'dashboard\')">' + lbl + '</button>';
    }).join('');

    var typeOpts = '<option value="all"' + (eqType === 'all' ? ' selected' : '') + '>Tous les types</option>' +
      Object.entries(EQ_TYPES).map(function (kv) {
        return '<option value="' + kv[0] + '"' + (eqType === kv[0] ? ' selected' : '') + '>' + kv[1].icon + ' ' + kv[1].l + '</option>';
      }).join('');
    var siteOpts = '<option value="all"' + (eqSite === 'all' ? ' selected' : '') + '>Tous les sites</option>' +
      zonesArr.map(function (z) { return '<option value="' + esc(z) + '"' + (eqSite === z ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('');
    var statOpts = '<option value="all"' + (eqStat === 'all' ? ' selected' : '') + '>Tous les statuts</option>' +
      '<option value="late"' + (eqStat === 'late' ? ' selected' : '') + '>En retard</option>' +
      '<option value="soon"' + (eqStat === 'soon' ? ' selected' : '') + '>À venir (7j)</option>' +
      '<option value="ok"' + (eqStat === 'ok' ? ' selected' : '') + '>OK</option>';

    var filterChange = ';window._pmpDashPage=1;MX.Pages.PMP._tab(\'dashboard\')';

    // ── Assemble ──
    return '<div class="pmdb">' +

      '<div class="pmdb-kpi-row">' +
        _pmdbKpiCard('fa-screwdriver-wrench', '#3B82F6', kpi.totalEq,       'Équipements',          'Tous sites confondus',      'equipements') +
        _pmdbKpiCard('fa-calendar-day',       '#8B5CF6', todayCount,        'Interventions auj.',   'Planifiées',                null) +
        _pmdbKpiCard('fa-triangle-exclamation','#EF4444', kpi.enRetard,     'En retard',            'À traiter',                 'retards', true) +
        _pmdbKpiCard('fa-calendar-week',       '#22C55E', weekCount,        'Cette semaine',        'Interventions',             null) +
        _pmdbKpiCard('fa-calendar',            '#F59E0B', kpi.thisMonthCount,'Ce mois',             'Interventions',             null) +
        _pmdbKpiCard('fa-clock',               '#06B6D4', (chargeH || '0') + ' h', 'Charge annuelle', 'Temps estimé', null) +
      '</div>' +

      '<div class="pmdb-main-grid">' +
        '<div class="pmdb-left-col">' +

          '<div class="pmdb-chart-card">' +
            '<div class="pmdb-chart-hdr">' +
              '<div>' +
                '<div class="pmdb-chart-ttl">Évolution des prochaines interventions</div>' +
                '<div class="pmdb-chart-leg">' +
                  '<span class="pmdb-leg-item"><span class="pmdb-leg-dot" style="background:#3B82F6"></span>Tous</span>' +
                  '<span class="pmdb-leg-item"><span class="pmdb-leg-dot" style="background:#EF4444"></span>En retard</span>' +
                  '<span class="pmdb-leg-item"><span class="pmdb-leg-dot" style="background:#F59E0B"></span>Cette semaine</span>' +
                  '<span class="pmdb-leg-item"><span class="pmdb-leg-dot--dash" style="border-color:#22C55E"></span>Mois prochain</span>' +
                '</div>' +
              '</div>' +
              '<div class="pmdb-chart-acts">' +
                '<div class="pmdb-per-group">' + perBtns + '</div>' +
                '<button class="pmdb-chart-ico-btn" onclick="MX.Pages.PMP._tab(\'dashboard\')" title="Actualiser"><i class="fas fa-rotate"></i></button>' +
              '</div>' +
            '</div>' +
            '<div class="pmdb-chart-wrap">' + chartSVG + '</div>' +
          '</div>' +

          '<div class="pmdb-eq-section">' +
            '<div class="pmdb-eq-toolbar">' +
              '<input type="text" class="pmdb-filter-search" placeholder="Rechercher un équipement…" value="' + esc(srch) + '" oninput="window._pmpDashSrch=this.value' + filterChange + '">' +
              '<select class="pmdb-filter-sel" onchange="window._pmpDashType=this.value' + filterChange + '">' + typeOpts + '</select>' +
              '<select class="pmdb-filter-sel" onchange="window._pmpDashSite=this.value' + filterChange + '">' + siteOpts + '</select>' +
              '<select class="pmdb-filter-sel" onchange="window._pmpDashStat=this.value' + filterChange + '">' + statOpts + '</select>' +
              '<button class="pmdb-add-btn" onclick="MX.Pages.PMP._eqForm(null)"><i class="fas fa-plus"></i> Ajouter un équipement</button>' +
            '</div>' +
            eqCardsHtml +
            pgHtml +
          '</div>' +

        '</div>' +

        '<div class="pmdb-right-col">' +

          '<div class="pmdb-widget">' +
            '<div class="pmdb-widget-hdr"><i class="fas fa-triangle-exclamation"></i> À surveiller</div>' +
            '<div class="pmdb-watch-list">' + watchHtml + '</div>' +
            (lateInts.length ? '<div class="pmdb-widget-ft"><a onclick="MX.Pages.PMP._tab(\'retards\')" class="pmdb-widget-link">Voir toutes les alertes (' + kpi.enRetard + ') →</a></div>' : '') +
          '</div>' +

          '<div class="pmdb-widget">' +
            '<div class="pmdb-widget-hdr"><i class="fas fa-ranking-star"></i> Top 5 interventions les plus longues</div>' +
            '<div class="pmdb-top5-list">' + top5Html + '</div>' +
            (top5.length >= 5 ? '<div class="pmdb-widget-ft"><a onclick="MX.Pages.PMP._tab(\'interventions\')" class="pmdb-widget-link">Voir le classement complet →</a></div>' : '') +
          '</div>' +

          '<div class="pmdb-widget">' +
            '<div class="pmdb-widget-hdr"><i class="fas fa-star-half-stroke"></i> Score de fiabilité global</div>' +
            '<div class="pmdb-score-body">' +
              '<div class="pmdb-score-donut">' + donutSVG + '</div>' +
              '<div class="pmdb-score-breakdown">' + scoreBreak + '</div>' +
            '</div>' +
            '<div class="pmdb-widget-ft"><a onclick="MX.Pages.PMP._tab(\'equipements\')" class="pmdb-widget-link">Voir le détail par équipement →</a></div>' +
          '</div>' +

        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── FILE D'ATTENTE ────────────────────────────────────────────────────────

  function _tQueue() {
    var today    = _today();
    var active   = _pmpInt.filter(function (i) { return i.status !== 'terminee' && i.status !== 'annulee'; });
    var toAssign = active.filter(function (i) { return !i.missionId; });
    var assigned = active.filter(function (i) { return  i.missionId; });
    var overdue  = active.filter(function (i) { return (i.dueDate || '') < today; }).length;
    var todayDue = active.filter(function (i) { return  i.dueDate === today; }).length;

    var h = '<div class="pmp-queue-page">';

    h += '<div class="pmp-queue-stats">';
    h += '<div class="pmp-queue-stat pmp-queue-stat--red"><div class="pmp-queue-stat-n">' + overdue + '</div><div class="pmp-queue-stat-l">En retard</div></div>';
    h += '<div class="pmp-queue-stat pmp-queue-stat--orange"><div class="pmp-queue-stat-n">' + todayDue + '</div><div class="pmp-queue-stat-l">Aujourd\'hui</div></div>';
    h += '<div class="pmp-queue-stat"><div class="pmp-queue-stat-n">' + toAssign.length + '</div><div class="pmp-queue-stat-l">À affecter</div></div>';
    h += '<div class="pmp-queue-stat pmp-queue-stat--green"><div class="pmp-queue-stat-n">' + assigned.length + '</div><div class="pmp-queue-stat-l">Affectées</div></div>';
    h += '</div>';

    h += '<div class="pmp-section-ttl"><i class="fas fa-inbox"></i> À affecter (' + toAssign.length + ')</div>';
    if (!toAssign.length) {
      h += '<div class="pmp-empty" style="text-align:center;padding:16px;color:var(--green)"><i class="fas fa-circle-check" style="font-size:20px;margin-bottom:6px;display:block"></i>Toutes les interventions sont affectées</div>';
    } else {
      h += '<div class="pmp-queue-list">';
      toAssign.sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });
      toAssign.forEach(function (i) {
        var ti     = EQ_TYPES[i.type] || { icon: '🔧' };
        var cr     = CRIT[i.criticite] || CRIT.normale;
        var isLate = (i.dueDate || '') < today;
        var days   = isLate ? _daysLate(i.dueDate) : null;
        h += '<div class="pmp-queue-item' + (isLate ? ' pmp-queue-item--late' : '') + '">' +
          '<div class="pmp-queue-item-ico">' + ti.icon + '</div>' +
          '<div class="pmp-queue-item-info">' +
            '<div class="pmp-queue-item-name">' + esc(i.equipmentName || '—') + '</div>' +
            '<div class="pmp-queue-item-sub">' + esc(i.zone || '') + (i.subZone ? ' · ' + esc(i.subZone) : '') + '</div>' +
          '</div>' +
          '<div class="pmp-queue-item-meta">' +
            '<span class="pmp-queue-item-date' + (isLate ? ' pmp-queue-item-date--late' : '') + '">' + (isLate ? 'Retard ' + days + 'j' : _dateLbl(i.dueDate)) + '</span>' +
            '<span class="pmp-eq-badge" style="color:' + cr.c + ';border-color:' + cr.c + '">' + cr.l + '</span>' +
          '</div>' +
          '<button class="pmp-assign-btn" onclick="MX.Pages.PMP._assignModal(\'' + esc(i.id) + '\')"><i class="fas fa-user-plus"></i> Affecter</button>' +
          '</div>';
      });
      h += '</div>';
    }

    if (assigned.length) {
      h += '<div class="pmp-section-ttl" style="margin-top:16px"><i class="fas fa-user-check"></i> Affectées (' + assigned.length + ')</div>';
      h += '<div class="pmp-queue-list">';
      assigned.sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });
      assigned.forEach(function (i) {
        var ti = EQ_TYPES[i.type] || { icon: '🔧' };
        var st = INT_ST[i.status] || INT_ST.planifiee;
        h += '<div class="pmp-queue-item pmp-queue-item--assigned">' +
          '<div class="pmp-queue-item-ico">' + ti.icon + '</div>' +
          '<div class="pmp-queue-item-info">' +
            '<div class="pmp-queue-item-name">' + esc(i.equipmentName || '—') + '</div>' +
            '<div class="pmp-queue-item-sub"><i class="fas fa-user" style="font-size:10px"></i> ' + esc(i.technician || '—') + '</div>' +
          '</div>' +
          '<div class="pmp-int-st" style="color:' + st.c + ';background:' + st.bg + '">' + st.l + '</div>' +
          '<button class="pmp-act-btn" onclick="MX.Pages.PMP._assignModal(\'' + esc(i.id) + '\')" title="Réaffecter"><i class="fas fa-pen"></i></button>' +
          '</div>';
      });
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  async function _assignModal(intId) {
    var i = _pmpInt.find(function (x) { return x.id === intId; });
    if (!i) return;
    var today = _today();
    var users = (MX.state.users || []).filter(function (u) { return u.name && !u.hidden; });
    var eq    = _pmpEq.find(function (e) { return e.id === i.equipmentId; });
    var cr    = CRIT[i.criticite] || CRIT.normale;

    var presentNames = new Set();
    try {
      var snap = await db.collection('planning_entries').where('date', '==', today).get();
      snap.forEach(function (d) { var p = d.data(); if (p.userName) presentNames.add(p.userName); });
    } catch (e) { console.warn('[PMP] planning fetch:', e.message); }

    var checklistItems = i.checklistItems || [];
    if (!checklistItems.length && eq && eq.templateId) {
      var tpl = _pmpTpl.find(function (t) { return t.id === eq.templateId; });
      if (tpl && tpl.items) checklistItems = tpl.items.map(function (it) { return { text: it.text || it, done: false }; });
    }

    var DURS = DURATIONS.filter(function (d) { return d !== 'Autre'; });
    var curDur = i.estimatedDuration || (eq && eq.duration) || '';

    var body =
      '<div style="display:flex;flex-direction:column;gap:12px;max-height:70vh;overflow-y:auto;padding-right:4px">' +
      '<div class="pmp-assign-eq-info">' +
        '<div style="font-size:13px;font-weight:600">' + esc(i.equipmentName || '—') + '</div>' +
        (i.zone ? '<div style="font-size:11px;color:var(--text3)">' + esc(i.zone) + (i.subZone ? ' · ' + esc(i.subZone) : '') + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">' +
          '<span class="pmp-eq-badge" style="color:' + cr.c + ';border-color:' + cr.c + '">' + cr.l + '</span>' +
          '<span style="font-size:11px;color:var(--text3)"><i class="fas fa-calendar" style="font-size:9px"></i> Prévu: ' + _dateLbl(i.dueDate) + '</span>' +
        '</div>' +
      '</div>' +
      '<div><label class="pmp-form-lbl">Technicien *</label>' +
        (presentNames.size ? '<div style="font-size:10.5px;color:var(--green);margin-bottom:5px"><i class="fas fa-circle-check"></i> ✓ = présent aujourd\'hui selon le planning</div>' : '') +
        '<select class="fi" id="pmp-asgn-tech"><option value="">— Non assigné —</option>' +
        users.map(function (u) {
          var isP = presentNames.has(u.name);
          return '<option value="' + esc(u.name) + '"' + (i.technician === u.name ? ' selected' : '') + '>' + esc(u.name) + (isP ? ' ✓' : '') + '</option>';
        }).join('') + '</select></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div><label class="pmp-form-lbl">Priorité</label>' +
          '<select class="fi" id="pmp-asgn-pri">' +
          Object.entries(CRIT).map(function (kv) {
            return '<option value="' + kv[0] + '"' + (i.criticite === kv[0] ? ' selected' : '') + '>' + kv[1].l + '</option>';
          }).join('') + '</select></div>' +
        '<div><label class="pmp-form-lbl">Durée estimée</label>' +
          '<select class="fi" id="pmp-asgn-dur">' +
          '<option value="">Non définie</option>' +
          DURS.map(function (d) { return '<option value="' + d + '"' + (curDur === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') +
          '</select></div>' +
      '</div>' +
      ((eq && eq.technicalNotes) ?
        '<div class="pmp-assign-notes"><div style="font-size:10.5px;font-weight:700;color:var(--orange);margin-bottom:4px"><i class="fas fa-note-sticky"></i> Consignes techniques</div>' +
        '<div style="font-size:12px;color:var(--text2);white-space:pre-wrap;line-height:1.5">' + esc(eq.technicalNotes) + '</div></div>' : '') +
      '</div>';

    MX.showModal({ title: "Affecter l'intervention", body: body, actions: [
      { label: 'Affecter', cls: 'primary', fn: async function () {
        var tech = document.getElementById('pmp-asgn-tech')?.value || '';
        var pri  = document.getElementById('pmp-asgn-pri')?.value  || i.criticite || 'normale';
        var dur  = document.getElementById('pmp-asgn-dur')?.value  || '';
        if (!tech) { MX.toast('Technicien requis', true); return; }
        try {
          await PMP_DB.int().doc(intId).update({
            technician:        tech,
            criticite:         pri,
            estimatedDuration: dur,
            status:            (i.dueDate || '') < today ? 'en_retard' : 'en_cours',
            assignedAt:        FV.serverTimestamp(),
            assignedBy:        _author(),
            updatedAt:         FV.serverTimestamp(),
          });
          var missionData = {
            text:       '🛠️ PMP — ' + (i.equipmentName || ''),
            dayId:      i.dueDate,
            assignedTo: tech,
            priority:   pri === 'critique' ? 'critique' : pri === 'haute' ? 'haute' : 'normale',
            category:   'pmp',
            isPmp:      true,
            pmpIntId:   intId,
            done:       false,
            pmpData: {
              equipmentId:       i.equipmentId,
              equipmentName:     i.equipmentName,
              type:              i.type      || 'divers',
              zone:              i.zone      || '',
              subZone:           i.subZone   || '',
              ref:               i.ref       || '',
              dueDate:           i.dueDate,
              criticite:         pri,
              estimatedDuration: dur,
              technicalNotes:    (eq && eq.technicalNotes) || i.technicalNotes || '',
              checklistItems:    checklistItems,
            },
            createdAt:  FV.serverTimestamp(),
            createdBy:  _author(),
          };
          if (i.missionId) {
            await db.collection('missions').doc(i.missionId).update({
              assignedTo: tech,
              priority:   missionData.priority,
              pmpData:    missionData.pmpData,
              updatedAt:  FV.serverTimestamp(),
            });
          } else {
            var mRef = await db.collection('missions').add(missionData);
            await PMP_DB.int().doc(intId).update({ missionId: mRef.id });
          }
          MX.toast('Affecté à ' + tech + ' ✓');
          window._pmpGenDone = false;
        } catch (e) { MX.toast('Erreur : ' + e.message, true); }
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]});
  }

  // ── ÉQUIPEMENTS ───────────────────────────────────────────────────────────

  function _eqListHtml(today) {
    var filtered = _pmpEq.slice();
    if (_eqSearch) {
      var s = _eqSearch.toLowerCase();
      filtered = filtered.filter(function (e) {
        var ti = EQ_TYPES[e.type] || {};
        var cr = CRIT[e.criticite] || {};
        return (e.name         || '').toLowerCase().includes(s) ||
               (e.ref          || '').toLowerCase().includes(s) ||
               (e.zone         || '').toLowerCase().includes(s) ||
               (e.subZone      || '').toLowerCase().includes(s) ||
               (e.technician   || '').toLowerCase().includes(s) ||
               (e.type         || '').toLowerCase().includes(s) ||
               (ti.l           || '').toLowerCase().includes(s) ||
               (cr.l           || '').toLowerCase().includes(s) ||
               (e.status       || '').toLowerCase().includes(s) ||
               (e.technicalNotes || '').toLowerCase().includes(s) ||
               (e.comments     || '').toLowerCase().includes(s);
      });
    }
    if (_eqTypeFilter !== 'all') {
      filtered = filtered.filter(function (e) { return e.type === _eqTypeFilter; });
    }
    filtered.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var h = '';
    if (!filtered.length) {
      h += '<div class="pmp-empty pmp-empty--big">' +
        '<i class="fas fa-wrench" style="font-size:32px;opacity:0.3;margin-bottom:12px;display:block"></i>' +
        '<div style="font-size:14px">' + (_pmpEq.length ? 'Aucun résultat pour "' + esc(_eqSearch) + '"' : 'Aucun équipement configuré') + '</div>' +
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
          '<div class="pmp-eq-type">' + esc(ti.l) + (eq.zone ? ' · ' + esc(eq.zone) : '') + '</div></div>' +
          '<div class="pmp-eq-badge" style="color:' + cr.c + ';border-color:' + cr.c + '">' + cr.l + '</div>' +
          '</div>' +
          '<div class="pmp-eq-card-body">' +
          (eq.ref        ? '<span class="pmp-eq-meta"><i class="fas fa-tag"></i> ' + esc(eq.ref) + '</span>' : '') +
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
    return h;
  }

  function _tEquipements() {
    var today = _today();
    var h = '<div class="pmp-eq-page">';
    h += '<div class="pmp-toolbar">' +
      '<input type="text" class="pmp-search" id="pmp-eq-search" placeholder="Rechercher nom, famille, zone, technicien…" value="' + esc(_eqSearch) + '"' +
      ' oninput="MX.Pages.PMP._setEqSearch(this.value)">' +
      '<select class="pmp-select" onchange="MX.Pages.PMP._setEqType(this.value)">' +
      '<option value="all"' + (_eqTypeFilter === 'all' ? ' selected' : '') + '>Toutes les familles</option>' +
      _eqTypeOptgroups(_eqTypeFilter) +
      '</select>' +
      '<button class="pmp-add-btn" onclick="MX.Pages.PMP._eqForm(null)"><i class="fas fa-plus"></i> Ajouter</button>' +
      '</div>';
    h += '<div id="pmp-eq-list-wrap">' + _eqListHtml(today) + '</div>';
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

  // ── EQUIPMENT FORM — FULL PAGE ────────────────────────────────────────────

  function _eqForm(id) {
    _eqFormMode = id || 'new';
    _rerender();
  }

  function _eqFormBack() {
    _eqFormMode = null;
    _curTab = 'equipements';
    _rerender();
  }

  function _onDurChange(v) {
    var el = document.getElementById('pmp-f-dur-other');
    if (el) el.style.display = v === 'Autre' ? 'block' : 'none';
  }

  function _tEqFormPage() {
    var isEdit = _eqFormMode !== 'new';
    var eq     = isEdit ? _pmpEq.find(function (e) { return e.id === _eqFormMode; }) : null;
    var users  = (MX.state.users || []).filter(function (u) { return u.name && !u.hidden; });
    var tpls   = _pmpTpl;

    var eqDur      = eq ? (eq.duration || '') : '';
    var durIsOther = eqDur !== '' && !DURATIONS.includes(eqDur);
    var durSel     = durIsOther ? 'Autre' : eqDur;
    var durOther   = durIsOther ? eqDur : '';

    var h = '<div class="pmp-eqfm-page">';

    // ── header bar
    h += '<div class="pmp-eqfm-header">' +
      '<button class="pmp-eqfm-back" onclick="MX.Pages.PMP._eqFormBack()">' +
        '<i class="fas fa-arrow-left"></i> Équipements' +
      '</button>' +
      '<h2 class="pmp-eqfm-title">' + (isEdit ? "Modifier l'équipement" : 'Nouvel équipement') + '</h2>' +
      '<button class="pmp-eqfm-save-btn" onclick="MX.Pages.PMP._saveEqForm()">' +
        '<i class="fas fa-check"></i> ' + (isEdit ? 'Enregistrer' : 'Créer') +
      '</button>' +
    '</div>';

    // ── section 1 : Informations générales
    h += '<div class="pmp-eqfm-section">' +
      '<div class="pmp-eqfm-section-title"><i class="fas fa-info-circle"></i> Informations générales</div>' +
      '<div class="pmp-eqfm-grid">' +

      '<div class="pmp-eqfm-field pmp-eqfm-field--full">' +
        '<label class="pmp-eqfm-lbl">Nom <span class="pmp-eqfm-req">*</span></label>' +
        '<input class="pmp-eqfm-input" id="pmp-f-name" placeholder="Ex: CTA Toiture, Pompe de relevage…" value="' + esc(eq ? eq.name || '' : '') + '">' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Famille <span class="pmp-eqfm-req">*</span></label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-type">' +
          '<option value="">— Sélectionner —</option>' +
          _eqTypeOptgroups(eq ? eq.type || '' : '') +
        '</select>' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Criticité</label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-crit">' +
          Object.entries(CRIT).map(function (kv) {
            var sel = eq ? eq.criticite === kv[0] : kv[0] === 'normale';
            return '<option value="' + kv[0] + '"' + (sel ? ' selected' : '') + '>' + kv[1].l + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Zone <span class="pmp-eqfm-req">*</span></label>' +
        '<input class="pmp-eqfm-input" id="pmp-f-zone" placeholder="Ex: Toiture, Sous-sol, RDC…" value="' + esc(eq ? eq.zone || '' : '') + '">' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Sous-zone</label>' +
        '<input class="pmp-eqfm-input" id="pmp-f-subzone" placeholder="Ex: Local technique" value="' + esc(eq ? eq.subZone || '' : '') + '">' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Référence</label>' +
        '<input class="pmp-eqfm-input" id="pmp-f-ref" placeholder="Ex: CTA-01" value="' + esc(eq ? eq.ref || '' : '') + '">' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">État</label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-status">' +
          '<option value="actif"' + (!eq || eq.status === 'actif' ? ' selected' : '') + '>Actif</option>' +
          '<option value="inactif"' + (eq && eq.status === 'inactif' ? ' selected' : '') + '>Inactif</option>' +
        '</select>' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Technicien référent</label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-tech">' +
          '<option value="">— Non assigné —</option>' +
          users.map(function (u) {
            return '<option value="' + esc(u.name) + '"' + (eq && eq.technician === u.name ? ' selected' : '') + '>' + esc(u.name) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '</div></div>';

    // ── section 2 : Organisation maintenance
    h += '<div class="pmp-eqfm-section">' +
      '<div class="pmp-eqfm-section-title"><i class="fas fa-calendar-alt"></i> Organisation maintenance</div>' +
      '<div class="pmp-eqfm-grid">' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Fréquence <span class="pmp-eqfm-req">*</span></label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-freq">' +
          FREQS.map(function (f) {
            var sel = eq ? eq.frequency === f.v : f.v === 30;
            return '<option value="' + f.v + '"' + (sel ? ' selected' : '') + '>' + f.l + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Durée estimée</label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-dur" onchange="MX.Pages.PMP._onDurChange(this.value)">' +
          '<option value="">— Non définie —</option>' +
          DURATIONS.map(function (d) {
            return '<option value="' + d + '"' + (durSel === d ? ' selected' : '') + '>' + d + '</option>';
          }).join('') +
        '</select>' +
        '<input class="pmp-eqfm-input" id="pmp-f-dur-other" placeholder="Préciser la durée…"' +
          ' style="margin-top:6px;display:' + (durSel === 'Autre' ? 'block' : 'none') + '"' +
          ' value="' + esc(durOther) + '">' +
      '</div>' +

      (isEdit ? '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Prochaine échéance <span class="pmp-eqfm-req">*</span></label>' +
        '<input class="pmp-eqfm-input" type="date" id="pmp-f-nextDue" value="' + esc(eq ? eq.nextDue || '' : '') + '">' +
      '</div>' : '') +

      '<div class="pmp-eqfm-field">' +
        '<label class="pmp-eqfm-lbl">Modèle de checklist</label>' +
        '<select class="pmp-eqfm-select" id="pmp-f-tpl">' +
          '<option value="">— Aucun —</option>' +
          tpls.map(function (t) {
            return '<option value="' + esc(t.id) + '"' + (eq && eq.templateId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '</div></div>';

    // ── section 3 : Documents (placeholder)
    h += '<div class="pmp-eqfm-section">' +
      '<div class="pmp-eqfm-section-title">' +
        '<i class="fas fa-folder-open"></i> Documents' +
        ' <span class="pmp-soon-tag">Bientôt disponible</span>' +
      '</div>' +
      '<div class="pmp-eqfm-docs-placeholder">' +
        '<div class="pmp-eqfm-docs-grid">' +
          ['PDF', 'Notice', 'Schéma', 'Photo', 'Vidéo', 'Manuel'].map(function (d) {
            return '<div class="pmp-eqfm-doc-slot">' +
              '<i class="fas fa-file-circle-plus"></i>' +
              '<span>' + d + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<p class="pmp-eqfm-docs-note">La gestion documentaire sera activée dans une prochaine mise à jour.</p>' +
      '</div>' +
    '</div>';

    // ── section 4 : Consignes techniques
    h += '<div class="pmp-eqfm-section">' +
      '<div class="pmp-eqfm-section-title"><i class="fas fa-clipboard-list"></i> Consignes techniques</div>' +
      '<textarea class="pmp-eqfm-textarea" id="pmp-f-notes"' +
        ' placeholder="Instructions de maintenance, points d\'attention, consignes de sécurité, procédures spécifiques…">' +
        esc(eq ? eq.technicalNotes || '' : '') +
      '</textarea>' +
    '</div>';

    // ── section 5 : Commentaires
    h += '<div class="pmp-eqfm-section">' +
      '<div class="pmp-eqfm-section-title"><i class="fas fa-comment-dots"></i> Commentaires</div>' +
      '<textarea class="pmp-eqfm-textarea pmp-eqfm-textarea--sm" id="pmp-f-comments"' +
        ' placeholder="Observations, historique, remarques…">' +
        esc(eq ? eq.comments || '' : '') +
      '</textarea>' +
    '</div>';

    // ── footer actions
    h += '<div class="pmp-eqfm-footer">' +
      '<button class="pmp-eqfm-cancel-btn" onclick="MX.Pages.PMP._eqFormBack()">' +
        '<i class="fas fa-times"></i> Annuler' +
      '</button>' +
      '<button class="pmp-eqfm-save-btn pmp-eqfm-save-btn--lg" onclick="MX.Pages.PMP._saveEqForm()">' +
        '<i class="fas fa-check"></i> ' + (isEdit ? 'Enregistrer les modifications' : "Créer l'équipement") +
      '</button>' +
    '</div>';

    h += '</div>';
    return h;
  }

  function _collectEqForm() {
    var isEdit = _eqFormMode !== 'new';
    var durSel = document.getElementById('pmp-f-dur')?.value || '';
    var durOther = (document.getElementById('pmp-f-dur-other')?.value || '').trim();
    return {
      isEdit:         isEdit,
      id:             isEdit ? _eqFormMode : null,
      name:           (document.getElementById('pmp-f-name')?.value    || '').trim(),
      type:            document.getElementById('pmp-f-type')?.value    || '',
      criticite:       document.getElementById('pmp-f-crit')?.value    || 'normale',
      zone:           (document.getElementById('pmp-f-zone')?.value    || '').trim(),
      subZone:        (document.getElementById('pmp-f-subzone')?.value || '').trim(),
      ref:            (document.getElementById('pmp-f-ref')?.value     || '').trim(),
      status:          document.getElementById('pmp-f-status')?.value  || 'actif',
      technician:      document.getElementById('pmp-f-tech')?.value    || '',
      frequency:      parseInt(document.getElementById('pmp-f-freq')?.value || '30') || 30,
      nextDue:         document.getElementById('pmp-f-nextDue')?.value || '',
      templateId:      document.getElementById('pmp-f-tpl')?.value     || '',
      duration:        durSel === 'Autre' ? durOther : durSel,
      technicalNotes: (document.getElementById('pmp-f-notes')?.value    || '').trim(),
      comments:       (document.getElementById('pmp-f-comments')?.value || '').trim(),
    };
  }

  function _saveEqForm() {
    var d = _collectEqForm();
    if (!d.name)      { MX.toast('Nom requis', true);      return; }
    if (!d.type)      { MX.toast('Famille requise', true);  return; }
    if (!d.zone)      { MX.toast('Zone requise', true);     return; }
    if (!d.frequency) { MX.toast('Fréquence requise', true); return; }
    if (d.isEdit && !d.nextDue) { MX.toast('Prochaine échéance requise', true); return; }

    var ti = EQ_TYPES[d.type] || { icon: '🔧', l: d.type };
    var cr = CRIT[d.criticite] || CRIT.normale;
    _eqFormDraft = d;

    var preview = '<div class="pmp-eqfm-preview">' +
      '<div class="pmp-eqfm-preview-head">' +
        '<div class="pmp-eqfm-preview-ico">' + ti.icon + '</div>' +
        '<div>' +
          '<div class="pmp-eqfm-preview-name">' + esc(d.name) + '</div>' +
          '<div class="pmp-eqfm-preview-type">' + esc(ti.l) + '</div>' +
        '</div>' +
        '<div class="pmp-eq-badge" style="color:' + cr.c + ';border-color:' + cr.c + '">' + cr.l + '</div>' +
      '</div>' +
      '<div class="pmp-eqfm-preview-rows">' +
        '<div class="pmp-eqfm-preview-row"><i class="fas fa-map-marker-alt"></i><span>' + esc(d.zone) + (d.subZone ? ' · ' + esc(d.subZone) : '') + '</span></div>' +
        '<div class="pmp-eqfm-preview-row"><i class="fas fa-rotate"></i><span>' + _freqLbl(d.frequency) + '</span></div>' +
        (d.duration ? '<div class="pmp-eqfm-preview-row"><i class="fas fa-clock"></i><span>' + esc(d.duration) + '</span></div>' : '') +
        (d.technician ? '<div class="pmp-eqfm-preview-row"><i class="fas fa-user"></i><span>' + esc(d.technician) + '</span></div>' : '') +
        (d.nextDue ? '<div class="pmp-eqfm-preview-row"><i class="fas fa-calendar-check"></i><span>' + _dateLbl(d.nextDue) + '</span></div>' : '') +
      '</div>' +
    '</div>';

    MX.showModal({
      title: d.isEdit ? "Confirmer la modification" : "Confirmer la création",
      body: preview,
      actions: [
        { label: d.isEdit ? 'Enregistrer' : 'Créer', cls: 'primary', fn: function () { _doSaveEq(); } },
        { label: 'Modifier', cls: 'cancel' },
      ],
    });
  }

  async function _doSaveEq() {
    var d = _eqFormDraft;
    if (!d || !d.name) return;
    var data = {
      name: d.name, type: d.type, criticite: d.criticite,
      zone: d.zone, subZone: d.subZone, ref: d.ref,
      status: d.status, technician: d.technician,
      frequency: d.frequency, templateId: d.templateId,
      duration: d.duration,
      technicalNotes: d.technicalNotes, comments: d.comments,
      updatedAt: FV.serverTimestamp(),
    };
    if (d.nextDue) data.nextDue = d.nextDue;
    try {
      if (d.isEdit) {
        await PMP_DB.eq().doc(d.id).update(data);
        MX.toast('Équipement mis à jour ✓');
      } else {
        data.createdAt = FV.serverTimestamp();
        data.lastDone  = '';
        data.nextDue   = _addDays(_today(), d.frequency);
        data.createdBy = _author();
        await PMP_DB.eq().add(data);
        MX.toast('Équipement créé ✓');
      }
      _eqFormMode  = null;
      _eqFormDraft = {};
      _curTab = 'equipements';
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
            var eq      = _pmpEq.find(function (e) { return e.id === i.equipmentId; });
            var nextDue = _addDays(doneDate, eq ? (eq.frequency || 30) : 30);
            if (eq) {
              await PMP_DB.eq().doc(i.equipmentId).update({ lastDone: doneDate, nextDue, updatedAt: FV.serverTimestamp() });
            }
            // Mark linked mission done
            if (i.missionId) {
              db.collection('missions').doc(i.missionId).update({
                done: true, completedAt: FV.serverTimestamp(), completedBy: _author(),
              }).catch(function (e) { console.warn('[PMP] mission done:', e.message); });
            }
            // Auto-create next intervention in queue
            var nextExists = _pmpInt.some(function (x) {
              return x.equipmentId === i.equipmentId && x.dueDate === nextDue &&
                     x.status !== 'terminee' && x.status !== 'annulee';
            });
            if (!nextExists) {
              var checklistItems = i.checklistItems || [];
              if (!checklistItems.length && eq && eq.templateId) {
                var tpl = _pmpTpl.find(function (t) { return t.id === (eq && eq.templateId); });
                if (tpl && tpl.items) checklistItems = tpl.items.map(function (it) { return { text: it.text || it, done: false }; });
              }
              PMP_DB.int().add({
                equipmentId: i.equipmentId, equipmentName: i.equipmentName,
                type: i.type || 'divers', zone: i.zone || '', subZone: i.subZone || '',
                ref: i.ref || '', dueDate: nextDue, frequency: eq ? (eq.frequency || 30) : 30,
                technician: '', criticite: i.criticite || 'normale', status: 'planifiee',
                source: 'auto', checklistItems: checklistItems,
                estimatedDuration: (eq && eq.duration) || '',
                technicalNotes: (eq && eq.technicalNotes) || '',
                templateId: (eq && eq.templateId) || '',
                createdAt: FV.serverTimestamp(),
              }).catch(function (e) { console.warn('[PMP] next-int:', e.message); });
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

  function _setEqSearch(v) {
    _eqSearch = v;
    var wrap = document.getElementById('pmp-eq-list-wrap');
    if (wrap) { wrap.innerHTML = _eqListHtml(_today()); return; }
    _rerender();
  }
  function _setEqType(v) {
    _eqTypeFilter = v;
    var wrap = document.getElementById('pmp-eq-list-wrap');
    if (wrap) { wrap.innerHTML = _eqListHtml(_today()); return; }
    _rerender();
  }
  function _setIntFilter(v) { _intStatusFilter = v; _rerender(); }
  function _setCalMonth(v)  { _calMonth        = v; _rerender(); }

  // ── EXPORT ────────────────────────────────────────────────────────────────

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.PMP = {
    render,
    _tab, _setEqSearch, _setEqType, _setIntFilter, _setCalMonth,
    _eqForm, _eqFormBack, _onDurChange, _saveEqForm, _delEq, _createInt, _createIntManual, _markDone, _delInt,
    _assignModal,
    _tplForm, _tplAddItem, _delTpl,
    _onImportFile, _onImportDrop, _runImport, _resetImport, _setImportUserMap, _downloadTemplate, _createDefaultTpls, _checkAndGenerate,
    getStats: function () {
      var k = _kpiData();
      return { totalEq: k.totalEq, thisMonthCount: k.thisMonthCount, realisees: k.realisees, enRetard: k.enRetard, conformite: k.conformite, nextDue: k.nextDue };
    },
  };
})();
