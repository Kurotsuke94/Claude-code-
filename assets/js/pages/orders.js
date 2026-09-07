(function () {
  // ── Onglet courant (piloté par MX.showOrdersTab depuis la sidebar) ──
  let _tab = 'overview';

  // ── Filtres / recherche (onglets Produits / À commander) ──
  let _filter  = 'all';
  let _search  = '';
  let _sel     = new Set();
  let _pdfInc  = { rupture: true, seuil: true, sous_rec: false, manual: false };
  let _pdfSupp = '';
  let _pdfNote = '';

  // ── État des lieux en cours (local) ──
  // { id, location, mode:'all'|'category'|'location', counts:{productId:string} }
  let _check = null;
  let _checkErr = '';
  let _draftTimer = null;

  // ── Scanner QR (BarcodeDetector natif) ──
  let _scan = { active: false, stream: null, raf: null, detector: null, error: '' };

  const _CATEGORIES = ['Éclairage', 'Électrique', 'Mécanique', 'Filtration', 'Lubrifiants', 'Plomberie', 'Consommables', 'Autre'];

  // ══════════════════════════════════════════════════════════════════════
  // HELPERS — logique produit existante (conservée pour la commande fournisseur)
  // ══════════════════════════════════════════════════════════════════════
  function _qty(p)  { return parseInt(p.qty    || 0, 10); }
  function _min(p)  { return parseInt(p.minQty || 0, 10); }
  function _rec(p)  { return p.recQty ? parseInt(p.recQty, 10) : _min(p) * 2; }
  function _need(p) { return Math.max(0, _rec(p) - _qty(p)); }
  function _status(p) {
    var q = _qty(p), m = _min(p), r = _rec(p);
    if (q <= 0)  return 'rupture';
    if (q <= m)  return 'seuil';
    if (q < r)   return 'sous_rec';
    return 'ok';
  }
  var SC = {
    rupture:  { label: 'Rupture',           col: 'var(--red)',    dim: 'var(--red-dim)',    brd: 'var(--red-border)' },
    seuil:    { label: 'Sous le seuil',     col: 'var(--red)',    dim: 'var(--red-dim)',    brd: 'var(--red-border)' },
    sous_rec: { label: 'Sous recommandé',   col: 'var(--orange)', dim: 'var(--orange-dim)', brd: 'var(--orange-border)' },
    ok:       { label: 'Stock optimal',     col: 'var(--green)',  dim: 'var(--green-dim)',  brd: 'var(--green-border)' },
  };

  // ── NOUVEAU : stock maximum + calcul "à commander" (mockup Stock v2) ──
  // maxQty est un champ additif optionnel. Repli sur l'existant pour les
  // anciens produits qui ne l'ont jamais renseigné — aucune migration requise.
  function _maxQty(p) {
    if (p.maxQty !== undefined && p.maxQty !== null && p.maxQty !== '') return parseInt(p.maxQty, 10);
    if (p.recQty) return parseInt(p.recQty, 10);
    return _min(p) * 2;
  }
  function _needMax(p, counted) {
    var c = (counted === undefined || counted === null) ? _qty(p) : counted;
    return Math.max(0, _maxQty(p) - c);
  }
  function _controlled(p) { return p.lastCheckAt !== undefined && p.lastCheckAt !== null; }
  function _statusMax(p) {
    if (!_controlled(p)) return 'uncontrolled';
    var q = _qty(p), n = _needMax(p, q);
    if (n <= 0) return 'optimal';
    if (q <= _min(p)) return 'order';
    return 'watch';
  }
  var SM = {
    optimal:      { label: 'Stock optimal',   col: 'var(--green)',  dim: 'var(--green-dim)',  brd: 'var(--green-border)' },
    watch:        { label: 'À surveiller',    col: 'var(--orange)', dim: 'var(--orange-dim)', brd: 'var(--orange-border)' },
    order:        { label: 'À commander',     col: 'var(--red)',    dim: 'var(--red-dim)',    brd: 'var(--red-border)' },
    uncontrolled: { label: 'Non contrôlé',    col: 'var(--text3)',  dim: 'var(--bg4)',         brd: 'var(--border2)' },
  };

  function _filtered() {
    var prods = (MX.state.products || []);
    var s = _search.trim().toLowerCase();
    return prods.filter(function (p) {
      if (s) {
        var hay = [p.name, p.ref, p.location, p.category, p.supplier].map(function (x) { return (x || '').toLowerCase(); }).join(' ');
        if (hay.indexOf(s) === -1) return false;
      }
      if (_filter === 'all')           return true;
      if (_filter === 'toorder')       return _needMax(p) > 0;
      if (_filter === 'low')           return _controlled(p) && _qty(p) <= _min(p);
      if (_filter === 'uncontrolled')  return !_controlled(p);
      return true;
    });
  }

  function _pdfItems() {
    var prods = (MX.state.products || []);
    var out = [];
    prods.forEach(function (p) {
      var st = _status(p);
      if (_pdfInc.rupture  && st === 'rupture')   { out.push(p); return; }
      if (_pdfInc.seuil    && st === 'seuil')     { out.push(p); return; }
      if (_pdfInc.sous_rec && st === 'sous_rec')  { out.push(p); return; }
      if (_pdfInc.manual   && _sel.has(p.id))     { out.push(p); return; }
    });
    var seen = new Set();
    return out.filter(function (p) { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }

  function _countByStatus(st) { return (MX.state.products || []).filter(function (p) { return _status(p) === st; }).length; }
  function _countOrdered()  { return (MX.state.products || []).filter(function (p) { return p.orderStatus === 'ordered' || p.orderStatus === 'delivering'; }).length; }
  function _countReceived() { return (MX.state.products || []).filter(function (p) { return p.orderStatus === 'received'; }).length; }

  function _getSuppliers() {
    var seen = new Set(), out = [];
    (MX.state.products || []).forEach(function (p) { if (p.supplier && !seen.has(p.supplier)) { seen.add(p.supplier); out.push(p.supplier); } });
    (MX.state.orders   || []).forEach(function (o) { if (o.supplier && !seen.has(o.supplier)) { seen.add(o.supplier); out.push(o.supplier); } });
    return out;
  }
  function _getLocations() {
    var seen = new Set(), out = [];
    (MX.state.products || []).forEach(function (p) { if (p.location && !seen.has(p.location)) { seen.add(p.location); out.push(p.location); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function _productsAt(loc) { return (MX.state.products || []).filter(function (p) { return p.location === loc; }); }
  function _productsByCategory(cat) { return (MX.state.products || []).filter(function (p) { return p.category === cat; }); }

  // Attribution utilisateur — même logique que _author() dans consommations.js.
  // MX.state.adminUser est déjà garanti non-anonyme (voir auth.js), donc une
  // session anonyme (bootstrap PIN) n'est jamais confondue avec un Admin ici.
  function _stkUser() {
    var cu = MX.state.currentUser, ad = MX.state.adminUser;
    if (cu) return { userId: cu.id || null, userName: cu.name || 'Utilisateur' };
    if (ad) return { userId: ad.uid || null, userName: (ad.email || 'Admin').split('@')[0] };
    return { userId: null, userName: 'Anonyme' };
  }

  function _fmtDate(ts) {
    if (!ts) return '—';
    var d;
    if (ts && ts.toDate) d = ts.toDate();
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  function _fmtDateTime(ts) {
    if (!ts) return '—';
    var d;
    if (ts && ts.toDate) d = ts.toDate();
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ══════════════════════════════════════════════════════════════════════
  // ÉTAT DES LIEUX — semaine en cours, zones, progression (Vue d'ensemble)
  // ══════════════════════════════════════════════════════════════════════
  function _weekLabel() { return (window.MX && MX.mkWeekLabel) ? MX.mkWeekLabel() : ''; }

  function _weekChecks() {
    var w = _weekLabel();
    return (MX.state.stockChecks || []).filter(function (c) { return c.semaine === w; });
  }
  function _myInProgressCheck() {
    var list = MX.state.stockChecks || [];
    var found = null;
    list.forEach(function (c) {
      if (c.status === 'in_progress' && (!found || (c.createdAt && found.createdAt && c.createdAt.seconds > found.createdAt.seconds))) found = c;
    });
    return found;
  }
  function _lastDoneCheck() {
    var list = (MX.state.stockChecks || []).filter(function (c) { return c.status === 'done'; });
    if (!list.length) return null;
    return list[0]; // déjà trié desc par createdAt (listenStockChecks)
  }
  function _weekStats() {
    var locations = _getLocations();
    var totalZones = locations.length;
    var wChecks = _weekChecks().filter(function (c) { return c.status === 'done'; });
    var doneLocs = new Set(wChecks.map(function (c) { return c.location; }));
    var checkedProducts = wChecks.reduce(function (s, c) { return s + (c.checkedProducts || 0); }, 0);
    var productsToOrder = (MX.state.products || []).filter(function (p) { return _needMax(p) > 0; }).length;
    return {
      totalZones: totalZones,
      checkedZones: doneLocs.size,
      pendingZones: Math.max(0, totalZones - doneLocs.size),
      checkedProducts: checkedProducts,
      productsToOrder: productsToOrder,
      totalProducts: (MX.state.products || []).length,
      pct: totalZones ? Math.round((doneLocs.size / totalZones) * 100) : 0
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER — routeur principal
  // ══════════════════════════════════════════════════════════════════════
  function render() {
    if (window._ordStartTab) { _tab = window._ordStartTab; window._ordStartTab = null; }
    var esc = MX.esc;
    var el = document.getElementById('main-content');
    if (!el) return;
    if (_tab !== 'scan' && _scan.active) _scanStop();

    var h = '<div class="stk-page"><div class="stk-main">';
    h += '<div class="stk-hero">';
    h += _renderHeader();
    h += _renderTabs();
    if (_tab === 'overview' || !_tab) h += _renderActionCards();
    h += '</div>';

    switch (_tab) {
      case 'check':     h += _renderCheckTab(); break;
      case 'scan':      h += _renderScanTab(); break;
      case 'manual':    h += _renderManualTab(); break;
      case 'toorder':   h += _renderProductsTab('toorder'); break;
      case 'products':  h += _renderProductsTab('all'); break;
      case 'locations': h += _renderLocationsTab(); break;
      case 'suppliers': h += _renderSuppliersTab(); break;
      case 'history':   h += _renderHistoryTab(); break;
      case 'settings':  h += _renderSettingsTab(); break;
      default:          h += _renderOverviewTab();
    }

    h += '</div>'; // stk-main
    h += '<div class="stk-side">' + _renderSidePanel() + '</div>';
    h += '</div>'; // stk-page

    el.innerHTML = h;
    _wireCheckInputs();
    if (_tab === 'scan' && !_scan.active && !_scan.error) { /* attente clic utilisateur */ }
  }

  function _renderHeader() {
    var u = _stkUser();
    var h = '<div class="stk-hdr">';
    h += '<div><div class="pg-eye">STOCK &amp; LOGISTIQUE</div>';
    h += '<div class="pg-title">Gestion du stock</div>';
    h += '<div class="pg-sub">Un état des lieux simple et efficace pour ne jamais manquer de matériel</div></div>';
    h += '<div class="stk-hdr-right">';
    h += '<div class="stk-hdr-week"><i class="fas fa-calendar-days"></i> ' + MX.esc(_weekLabel()) + '</div>';
    h += '<div class="stk-hdr-user">' + MX.esc(u.userName) + '</div>';
    h += '</div></div>';
    return h;
  }

  function _renderTabs() {
    var defs = [
      { id: 'overview',  l: "Vue d'ensemble" },
      { id: 'check',     l: 'État des lieux' },
      { id: 'toorder',   l: 'À commander' },
      { id: 'products',  l: 'Produits' },
      { id: 'locations', l: 'Emplacements' },
      { id: 'suppliers', l: 'Fournisseurs' },
      { id: 'history',   l: 'Historique' },
      { id: 'settings',  l: 'Paramètres' },
    ];
    var h = '<div class="stk-tabs">';
    defs.forEach(function (t) {
      h += '<button class="stk-tab' + (_tab === t.id ? ' stk-tab-on' : '') + '" onclick="MX.Pages.Orders._goTab(\'' + t.id + '\')">' + t.l + '</button>';
    });
    h += '</div>';
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ONGLET : Vue d'ensemble
  // ══════════════════════════════════════════════════════════════════════
  // Cartes d'action séparées du reste : rendues À L'INTÉRIEUR de .stk-hero
  // (voir render()) pour que l'image de fond s'étende bien derrière elles,
  // en plus du titre et des onglets.
  function _renderActionCards() {
    var stats = _weekStats();
    var h = '';
    h += '<div class="stk-actions">';
    h += '<div class="stk-action stk-action--violet" onclick="MX.Pages.Orders._goTab(\'scan\')">';
    h += '<div class="stk-action-ico"><i class="fas fa-qrcode"></i></div>';
    h += '<div class="stk-action-body"><div class="stk-action-ttl">Scanner un QR code</div>';
    h += '<div class="stk-action-sub">Scannez une armoire, une zone ou un produit</div></div>';
    h += '<div class="stk-action-arrow"><i class="fas fa-arrow-right"></i></div></div>';

    h += '<div class="stk-action stk-action--blue" onclick="MX.Pages.Orders._goTab(\'manual\')">';
    h += '<div class="stk-action-ico"><i class="fas fa-keyboard"></i></div>';
    h += '<div class="stk-action-body"><div class="stk-action-ttl">Saisir le stock directement</div>';
    h += '<div class="stk-action-sub">Choisissez une zone et renseignez les quantités</div></div>';
    h += '<div class="stk-action-arrow"><i class="fas fa-arrow-right"></i></div></div>';

    h += '<div class="stk-action stk-action--green" onclick="MX.Pages.Orders._goTab(\'toorder\')">';
    if (stats.productsToOrder > 0) h += '<span class="stk-action-badge">' + stats.productsToOrder + '</span>';
    h += '<div class="stk-action-ico"><i class="fas fa-cart-shopping"></i></div>';
    h += '<div class="stk-action-body"><div class="stk-action-ttl">Voir les produits à commander</div>';
    h += '<div class="stk-action-sub">Liste automatique selon vos stocks</div></div>';
    h += '<div class="stk-action-arrow"><i class="fas fa-arrow-right"></i></div></div>';

    h += '<div class="stk-action stk-action--orange" onclick="MX.Pages.Orders._goTab(\'history\')">';
    h += '<div class="stk-action-ico"><i class="fas fa-clock-rotate-left"></i></div>';
    h += '<div class="stk-action-body"><div class="stk-action-ttl">Historique des états des lieux</div>';
    h += '<div class="stk-action-sub">Suivi par semaine et par zone</div></div>';
    h += '<div class="stk-action-arrow"><i class="fas fa-arrow-right"></i></div></div>';
    h += '</div>';
    return h;
  }

  function _renderOverviewTab() {
    var stats = _weekStats();
    var h = '';

    // Bloc "État des lieux de la semaine"
    function wkpi(icon, cssVar, val, lbl) {
      return '<div class="stk-week-kpi"><div class="stk-week-kpi-ico" style="background:var(--' + cssVar + '-dim);color:var(--' + cssVar + ')"><i class="fas ' + icon + '"></i></div>'
        + '<div class="stk-week-kpi-val" style="color:var(--' + cssVar + ')">' + val + '</div><div class="stk-week-kpi-lbl">' + lbl + '</div></div>';
    }
    h += '<div class="stk-week">';
    h += '<div class="stk-week-top">';
    h += '<div><div class="stk-week-ttl"><i class="fas fa-calendar-check"></i> État des lieux de la semaine</div><div class="stk-week-sub">' + MX.esc(_weekLabel()) + '</div></div>';
    h += '<div class="stk-week-prog"><div class="stk-week-prog-lbl"><span>Progression globale</span><span>' + stats.checkedZones + ' / ' + stats.totalZones + ' zones</span></div>';
    h += '<div class="stk-week-bar"><div class="stk-week-bar-fill" style="width:' + stats.pct + '%"></div></div></div>';
    h += '</div>';
    h += '<div class="stk-week-kpis">';
    h += wkpi('fa-map-location-dot', 'cyan',   stats.totalZones,      'Zones au total');
    h += wkpi('fa-circle-check',     'green',  stats.checkedZones,    'Zones contrôlées');
    h += wkpi('fa-boxes-stacked',    'jour',   stats.checkedProducts, 'Produits contrôlés');
    h += wkpi('fa-cart-shopping',    'red',    stats.productsToOrder, 'Produits à commander');
    h += wkpi('fa-clock',            'orange', stats.pendingZones,    'Zones en attente');
    h += '</div></div>';

    // Liste produits (aperçu — mêmes onglets que la page dédiée)
    h += _renderProductsTab('all', true);
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ONGLETS : Produits / À commander (table + filtres + CRUD conservé)
  // ══════════════════════════════════════════════════════════════════════
  function _renderProductsTab(mode, embedded) {
    var esc = MX.esc;
    var canEdit = MX.Auth && MX.Auth.canSeeAll ? MX.Auth.canSeeAll() : true;
    var prods = MX.state.products || [];
    if (mode === 'toorder' && _filter === 'all') _filter = 'toorder';
    var vis = _filtered();

    var nToOrder = prods.filter(function (p) { return _needMax(p) > 0; }).length;
    var nLow     = prods.filter(function (p) { return _controlled(p) && _qty(p) <= _min(p); }).length;
    var nUnctrl  = prods.filter(function (p) { return !_controlled(p); }).length;

    var h = '<div class="stk-list-card">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">';
    h += '<div style="font-size:14px;font-weight:700;color:var(--text1)">' + (mode === 'toorder' ? 'Produits à commander' : 'Produits') + '</div>';
    h += '<div style="display:flex;gap:8px;align-items:center">';
    h += '<input class="fi" type="text" placeholder="Rechercher…" value="' + esc(_search) + '" oninput="MX.Pages.Orders._onSearch(this.value)" style="width:180px">';
    if (canEdit) h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._openProdModal(null)">+ Produit</button>';
    h += '</div></div>';

    if (!embedded) {
      h += '<div class="stk-list-tabs">';
      function fb(key, label, cnt) {
        var on = _filter === key ? ' stk-list-tab-on' : '';
        return '<button class="stk-list-tab' + on + '" onclick="MX.Pages.Orders._setFilter(\'' + key + '\')">' + label + '<span class="stk-list-tab-cnt">' + cnt + '</span></button>';
      }
      h += fb('toorder', 'Produits à commander', nToOrder);
      h += fb('low', 'Stocks faibles', nLow);
      h += fb('all', 'Toutes les zones', prods.length);
      h += fb('uncontrolled', 'Produits non contrôlés', nUnctrl);
      h += '</div>';
    }

    h += _renderTable(vis, canEdit);

    if (!embedded) {
      h += '<div class="stk-actbar">';
      h += '<button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._export()"><i class="fas fa-download"></i> Exporter en CSV</button>';
      h += '</div>';
      if (mode === 'toorder') h += _renderPanel(_pdfItems());
    }
    h += '</div>';
    return h;
  }

  function _renderTable(vis, canEdit) {
    var esc = MX.esc;
    var h = '<div class="stk-table-wrap"><table class="stk-table"><thead><tr>';
    h += '<th style="width:26px"><input type="checkbox" onchange="MX.Pages.Orders._selAllVis(this.checked)"></th>';
    h += '<th>Produit</th><th>Référence</th><th>Emplacement</th><th>Stock constaté</th><th>Min.</th><th>Max.</th><th>À commander</th><th>Fournisseur</th><th>Statut</th>';
    if (canEdit) h += '<th style="text-align:right">Action</th>';
    h += '</tr></thead><tbody>';

    if (!vis.length) {
      h += '<tr><td colspan="' + (canEdit ? 11 : 10) + '"><div class="stk-empty"><i class="fas fa-box-open" style="font-size:26px"></i><span>Aucun produit trouvé</span></div></td></tr>';
    } else {
      vis.forEach(function (p) {
        var sm = SM[_statusMax(p)];
        var need = _needMax(p);
        var sel = _sel.has(p.id);
        h += '<tr>';
        h += '<td><input type="checkbox"' + (sel ? ' checked' : '') + ' onchange="MX.Pages.Orders._toggleSel(\'' + esc(p.id) + '\',this.checked)"></td>';
        h += '<td><div style="font-weight:600">' + esc(p.name || '—') + '</div>' + (p.category ? '<div style="font-size:10px;color:var(--text3)">' + esc(p.category) + '</div>' : '') + '</td>';
        h += '<td>' + (p.ref ? esc(p.ref) : '—') + '</td>';
        h += '<td>' + (p.location ? esc(p.location) : '—') + '</td>';
        h += '<td class="stk-num">' + _qty(p) + '</td>';
        h += '<td class="stk-num">' + _min(p) + '</td>';
        h += '<td class="stk-num">' + _maxQty(p) + '</td>';
        h += '<td class="stk-num">' + (need > 0 ? '<b style="color:var(--red)">' + need + '</b>' : '<span style="color:var(--green)">&#10003;</span>') + '</td>';
        h += '<td>' + (p.supplier ? esc(p.supplier) : '—') + '</td>';
        h += '<td><span class="stk-badge" style="color:' + sm.col + ';background:' + sm.dim + ';border-color:' + sm.brd + '">' + sm.label + '</span></td>';
        if (canEdit) {
          h += '<td style="text-align:right;white-space:nowrap">';
          h += '<button class="stk-btn-ghost" style="padding:5px 9px;border-radius:8px" title="Modifier" onclick="MX.Pages.Orders._openProdModal(\'' + esc(p.id) + '\')"><i class="fas fa-pen"></i></button> ';
          h += '<button class="stk-btn-ghost" style="padding:5px 9px;border-radius:8px" title="Actions commande" onclick="MX.Pages.Orders._prodMenu(event,\'' + esc(p.id) + '\')"><i class="fas fa-ellipsis-v"></i></button>';
          h += '</td>';
        }
        h += '</tr>';
      });
    }
    h += '</tbody></table></div>';

    h += '<div class="stk-mobile-cards">';
    if (!vis.length) {
      h += '<div class="stk-empty"><i class="fas fa-box-open" style="font-size:26px"></i><span>Aucun produit trouvé</span></div>';
    } else {
      vis.forEach(function (p) {
        var sm = SM[_statusMax(p)];
        var need = _needMax(p);
        h += '<div class="stk-mcard">';
        h += '<div class="stk-mcard-r1"><span class="stk-mcard-name">' + esc(p.name || '—') + '</span>';
        h += '<span class="stk-badge" style="color:' + sm.col + ';background:' + sm.dim + ';border-color:' + sm.brd + '">' + sm.label + '</span></div>';
        var metas = [];
        if (p.ref) metas.push(esc(p.ref));
        if (p.location) metas.push('📍 ' + esc(p.location));
        if (metas.length) h += '<div class="stk-mcard-r2">' + metas.join(' • ') + '</div>';
        h += '<div class="stk-mcard-r3"><span>Stock <b>' + _qty(p) + '</b></span><span>Min <b>' + _min(p) + '</b></span><span>Max <b>' + _maxQty(p) + '</b></span>';
        if (need > 0) h += '<span>À cmd <b style="color:var(--red)">' + need + '</b></span>';
        h += '</div>';
        if (canEdit) h += '<div style="margin-top:8px"><button class="stk-btn stk-btn-ghost" style="width:100%" onclick="MX.Pages.Orders._openProdModal(\'' + esc(p.id) + '\')"><i class="fas fa-pen"></i> Modifier</button></div>';
        h += '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ONGLET : Emplacements / Fournisseurs (vues dérivées, sans nouvelle
  // collection Firestore — limite assumée, voir rapport final)
  // ══════════════════════════════════════════════════════════════════════
  function _renderLocationsTab() {
    var esc = MX.esc;
    var locs = _getLocations();
    var h = '<div class="stk-list-card"><div style="font-size:14px;font-weight:700;margin-bottom:12px">Emplacements</div>';
    if (!locs.length) {
      h += '<div class="stk-empty"><i class="fas fa-location-dot" style="font-size:26px"></i><span>Aucun emplacement renseigné sur les produits</span></div>';
    } else {
      h += '<div class="stk-table-wrap"><table class="stk-table"><thead><tr><th>Emplacement</th><th>Produits</th><th></th></tr></thead><tbody>';
      locs.forEach(function (loc) {
        var n = _productsAt(loc).length;
        h += '<tr><td><b>' + esc(loc) + '</b></td><td class="stk-num">' + n + '</td>';
        h += '<td style="text-align:right"><button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._onSearch(' + JSON.stringify(loc) + ');MX.Pages.Orders._goTab(\'products\')">Voir les produits</button> ';
        h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._startCheck(' + JSON.stringify(loc) + ',\'location\')">Démarrer un état des lieux</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  function _renderSuppliersTab() {
    var esc = MX.esc;
    var supps = _getSuppliers();
    var h = '<div class="stk-list-card"><div style="font-size:14px;font-weight:700;margin-bottom:12px">Fournisseurs</div>';
    if (!supps.length) {
      h += '<div class="stk-empty"><i class="fas fa-truck" style="font-size:26px"></i><span>Aucun fournisseur renseigné sur les produits</span></div>';
    } else {
      h += '<div class="stk-table-wrap"><table class="stk-table"><thead><tr><th>Fournisseur</th><th>Produits</th><th></th></tr></thead><tbody>';
      supps.forEach(function (s) {
        var n = (MX.state.products || []).filter(function (p) { return p.supplier === s; }).length;
        h += '<tr><td><b>' + esc(s) + '</b></td><td class="stk-num">' + n + '</td>';
        h += '<td style="text-align:right"><button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._onSearch(' + JSON.stringify(s) + ');MX.Pages.Orders._goTab(\'products\')">Voir les produits</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    return h;
  }

  function _renderSettingsTab() {
    var h = '<div class="stk-list-card">';
    h += '<div style="font-size:14px;font-weight:700;margin-bottom:10px">Paramètres du module Stock</div>';
    h += '<div style="font-size:12.5px;color:var(--text2);line-height:1.6;margin-bottom:14px">Catégories de produits disponibles à la création :</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    _CATEGORIES.forEach(function (c) { h += '<span class="stk-badge" style="color:var(--text2);background:var(--bg4);border-color:var(--border)">' + MX.esc(c) + '</span>'; });
    h += '</div>';
    h += '<div style="margin-top:18px;font-size:12px;color:var(--text3)">Les seuils de stock minimum et maximum se règlent directement sur chaque produit (onglet Produits).</div>';
    h += '</div>';
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ONGLET : Historique (commandes fournisseur conservées + états des lieux)
  // ══════════════════════════════════════════════════════════════════════
  function _renderHistoryTab() {
    var esc = MX.esc;
    var checks = (MX.state.stockChecks || []).filter(function (c) { return c.status === 'done'; });
    var h = '<div class="stk-list-card"><div style="font-size:14px;font-weight:700;margin-bottom:12px">Historique des états des lieux</div>';
    if (!checks.length) {
      h += '<div class="stk-empty"><i class="fas fa-clipboard-list" style="font-size:26px"></i><span>Aucun état des lieux validé pour le moment</span></div>';
    } else {
      h += '<div class="stk-table-wrap"><table class="stk-table"><thead><tr><th>Zone</th><th>Semaine</th><th>Date</th><th>Utilisateur</th><th>Produits contrôlés</th><th>À commander</th><th></th></tr></thead><tbody>';
      checks.slice(0, 30).forEach(function (c) {
        h += '<tr><td><b>' + esc(c.location || '—') + '</b></td><td>' + esc(c.semaine || '—') + '</td><td>' + _fmtDateTime(c.updatedAt || c.createdAt) + '</td>';
        h += '<td>' + esc(c.userName || '—') + '</td><td class="stk-num">' + (c.checkedProducts || 0) + '</td>';
        h += '<td class="stk-num">' + (c.productsToOrder > 0 ? '<b style="color:var(--red)">' + c.productsToOrder + '</b>' : '0') + '</td>';
        h += '<td style="text-align:right"><button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._viewCheckDetail(\'' + esc(c.id) + '\')">Voir le détail</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    var orders = MX.state.orders || [];
    h += _renderHistory(orders);
    return h;
  }

  function _viewCheckDetail(id) {
    var esc = MX.esc;
    var c = (MX.state.stockChecks || []).find(function (x) { return x.id === id; });
    if (!c) return;
    MX.showModal({ title: 'État des lieux — ' + esc(c.location || ''), sub: (c.semaine || '') + ' · ' + _fmtDateTime(c.updatedAt || c.createdAt), body: '<div style="text-align:center;padding:20px;color:var(--text3)"><i class="fas fa-spinner fa-spin"></i> Chargement…</div>', actions: '<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>' });
    MX.DB.getStockCheckItems(id).then(function (items) {
      var body = '<div style="max-height:400px;overflow-y:auto">';
      if (!items.length) {
        body += '<p style="color:var(--text3);font-size:12.5px">Aucune ligne enregistrée.</p>';
      } else {
        body += '<table class="stk-table"><thead><tr><th>Produit</th><th>Constaté</th><th>Min</th><th>Max</th><th>À commander</th></tr></thead><tbody>';
        items.forEach(function (it) {
          body += '<tr><td>' + esc(it.productName || '—') + '</td><td class="stk-num">' + it.countedQty + '</td><td class="stk-num">' + it.minQty + '</td><td class="stk-num">' + it.maxQty + '</td>';
          body += '<td class="stk-num">' + (it.qtyToOrder > 0 ? '<b style="color:var(--red)">' + it.qtyToOrder + '</b>' : '0') + '</td></tr>';
        });
        body += '</tbody></table>';
      }
      body += '</div>';
      MX.showModal({ title: 'État des lieux — ' + esc(c.location || ''), sub: (c.semaine || '') + ' · ' + _fmtDateTime(c.updatedAt || c.createdAt), body: body, actions: '<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>' });
    }).catch(function (e) {
      if (MX.toast) MX.toast('Erreur: ' + e.message, true);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // ONGLET : État des lieux — démarrage / reprise / formulaire de saisie
  // ══════════════════════════════════════════════════════════════════════
  function _renderCheckTab() {
    if (_check) return _renderCheckForm();
    var resume = _myInProgressCheck();
    var h = '';
    if (resume) {
      h += '<div class="stk-resume-banner">';
      h += '<div class="stk-resume-txt">Un état des lieux est <b>en cours</b> — zone « ' + MX.esc(resume.location || '') + ' », commencé par ' + MX.esc(resume.userName || '—') + ' le ' + _fmtDateTime(resume.createdAt) + '.</div>';
      h += '<div style="display:flex;gap:8px;flex-shrink:0">';
      h += '<button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._cancelCheck(\'' + MX.esc(resume.id) + '\')">Abandonner</button>';
      h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._resumeCheck(\'' + MX.esc(resume.id) + '\')">Reprendre</button>';
      h += '</div></div>';
    }
    h += '<div class="stk-check-start">';
    h += '<div class="stk-action stk-action--violet" onclick="MX.Pages.Orders._goTab(\'scan\')"><div class="stk-action-ico"><i class="fas fa-qrcode"></i></div><div class="stk-action-ttl">Scanner un QR code</div><div class="stk-action-sub">Identifiez une zone ou une armoire en un instant</div></div>';
    h += '<div class="stk-action stk-action--blue" onclick="MX.Pages.Orders._goTab(\'manual\')"><div class="stk-action-ico"><i class="fas fa-keyboard"></i></div><div class="stk-action-ttl">Saisie directe</div><div class="stk-action-sub">Choisissez une zone manuellement, sans scanner</div></div>';
    h += '</div>';
    return h;
  }

  function _renderScanTab() {
    if (_check) return _renderCheckForm();
    var h = '<div class="stk-list-card"><div class="stk-scan-wrap">';
    if (_scan.active) {
      h += '<video id="stk-scan-video" class="stk-scan-video" playsinline muted autoplay></video>';
      h += '<div class="stk-scan-msg">Visez le QR code de la zone ou de l\'armoire.</div>';
      h += '<button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._scanCancel()">Annuler</button>';
    } else if (_scan.error) {
      var msgs = {
        https:       'Le scanner nécessite une connexion sécurisée (HTTPS). Utilisez la saisie directe.',
        unsupported: 'Votre navigateur ne prend pas en charge le scanner de QR code. Utilisez la saisie directe.',
        denied:      'Accès à la caméra refusé ou indisponible. Utilisez la saisie directe.'
      };
      h += '<div class="stk-scan-err"><i class="fas fa-triangle-exclamation"></i> ' + (msgs[_scan.error] || 'Scanner indisponible.') + '</div>';
      h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._goTab(\'manual\')"><i class="fas fa-keyboard"></i> Utiliser la saisie directe</button>';
    } else {
      h += '<div class="stk-action-ico" style="width:64px;height:64px;font-size:26px;background:var(--cyan);color:#fff"><i class="fas fa-qrcode"></i></div>';
      h += '<div class="stk-scan-msg">Le scan est un raccourci pratique, mais reste optionnel — la saisie directe fonctionne toujours.</div>';
      h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._scanStart()"><i class="fas fa-camera"></i> Activer la caméra</button>';
      h += '<button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._goTab(\'manual\')">Utiliser la saisie directe</button>';
    }
    h += '</div></div>';
    return h;
  }

  function _renderManualTab() {
    if (_check) return _renderCheckForm();
    var esc = MX.esc;
    var locs = _getLocations();
    var h = '<div class="stk-list-card">';
    h += '<div style="font-size:14px;font-weight:700;margin-bottom:14px">Saisie directe</div>';
    h += '<div class="stk-check-field"><label class="stk-check-label">Zone / emplacement</label>';
    h += '<select id="stk-manual-loc" class="fi">';
    h += '<option value="__all__">— Tous les produits —</option>';
    locs.forEach(function (l) { h += '<option value="' + esc(l) + '">' + esc(l) + '</option>'; });
    h += '</select></div>';
    h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._startCheckFromSelect()">Commencer l\'état des lieux</button>';
    h += '</div>';
    return h;
  }

  function _startCheckFromSelect() {
    var sel = document.getElementById('stk-manual-loc');
    var val = sel ? sel.value : '__all__';
    _startCheck(val, val === '__all__' ? 'all' : 'location');
  }

  function _productsForCheck() {
    if (!_check) return [];
    if (_check.mode === 'all') return MX.state.products || [];
    return _productsAt(_check.location);
  }

  function _startCheck(location, mode) {
    var scope = mode === 'all' ? (MX.state.products || []) : _productsAt(location);
    if (!scope.length) {
      if (MX.toast) MX.toast('Aucun produit rattaché à cette zone', true);
      return;
    }
    var u = _stkUser();
    var data = {
      date: new Date().toISOString().slice(0, 10),
      semaine: _weekLabel(),
      userId: u.userId,
      userName: u.userName,
      location: mode === 'all' ? 'Tous les produits' : location,
      totalProducts: scope.length,
      checkedProducts: 0,
      productsToOrder: 0
    };
    MX.syncStart && MX.syncStart();
    MX.DB.createStockCheck(data).then(function (id) {
      MX.syncEnd && MX.syncEnd();
      _check = { id: id, location: data.location, mode: mode, counts: {} };
      _checkErr = '';
      _tab = 'check';
      render();
    }).catch(function (e) {
      MX.syncFail && MX.syncFail();
      if (MX.toast) MX.toast('Erreur: ' + e.message, true);
    });
  }

  // QR détecté : on tente de faire correspondre le texte à une zone connue
  // (préfixe optionnel "MX-ZONE:", sinon correspondance directe/partielle).
  function _onScanResult(raw) {
    var text = (raw || '').replace(/^MX-ZONE:/i, '').trim();
    if (!text) { if (MX.toast) MX.toast('QR code vide ou illisible', true); return; }
    var locs = _getLocations();
    var exact = locs.find(function (l) { return l.toLowerCase() === text.toLowerCase(); });
    var loc = exact || text;
    _startCheck(loc, 'location');
  }

  function _resumeCheck(id) {
    var c = (MX.state.stockChecks || []).find(function (x) { return x.id === id; });
    if (!c) return;
    _check = { id: id, location: c.location, mode: c.location === 'Tous les produits' ? 'all' : 'location', counts: (c.draftCounts || {}) };
    _tab = 'check';
    render();
  }

  function _cancelCheck(id) {
    MX.showModal(
      "Abandonner l'état des lieux ?",
      'Aucune quantité ne sera enregistrée. Cette action est irréversible.',
      [
        { label: 'Abandonner', cls: 'danger', fn: function () {
          MX.DB.cancelStockCheck(id).then(function () {
            if (_check && _check.id === id) _check = null;
            if (MX.toast) MX.toast('État des lieux abandonné');
            render();
          }).catch(function (e) { if (MX.toast) MX.toast('Erreur: ' + e.message, true); });
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    );
  }

  function _renderCheckForm() {
    var esc = MX.esc;
    var scope = _productsForCheck();
    var counted = Object.keys(_check.counts).filter(function (k) { return _check.counts[k] !== '' && _check.counts[k] !== undefined; }).length;

    var h = '<div class="stk-list-card">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">';
    h += '<div style="font-size:14px;font-weight:700">État des lieux — ' + esc(_check.location) + '</div>';
    h += '<button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._cancelCheck(\'' + esc(_check.id) + '\')">Abandonner</button>';
    h += '</div>';
    h += '<div class="stk-check-progress" id="stk-check-progress">' + counted + ' / ' + scope.length + ' produits saisis</div>';

    if (!scope.length) {
      h += '<div class="stk-empty"><i class="fas fa-box-open" style="font-size:26px"></i><span>Aucun produit dans cette zone</span></div>';
    } else {
      scope.forEach(function (p) {
        var val = _check.counts[p.id];
        if (val === undefined) val = '';
        h += '<div class="stk-check-row" data-pid="' + esc(p.id) + '">';
        h += '<div class="stk-check-row-info"><div class="stk-check-row-name">' + esc(p.name || '—') + '</div>';
        h += '<div class="stk-check-row-meta">Min ' + _min(p) + ' · Max ' + _maxQty(p) + (p.ref ? ' · ' + esc(p.ref) : '') + '</div></div>';
        h += '<div class="stk-check-row-input"><input type="number" min="0" inputmode="numeric" class="stk-check-input" data-pid="' + esc(p.id) + '" value="' + esc(String(val)) + '" placeholder="0"></div>';
        h += '</div>';
      });
    }

    h += '<div class="stk-check-footer">';
    h += '<button class="stk-btn stk-btn-ghost" onclick="MX.Pages.Orders._goTab(\'overview\')">Terminer plus tard</button>';
    h += '<button class="stk-btn stk-btn-primary" onclick="MX.Pages.Orders._validateCheck()">Valider l\'état des lieux</button>';
    h += '</div></div>';
    return h;
  }

  // Écoute les champs de saisie SANS re-render complet à chaque frappe
  // (évite de perdre le focus) — met à jour l'état local + sauvegarde le
  // brouillon en base (debounce) pour permettre la reprise (règle #5).
  function _wireCheckInputs() {
    if (_tab !== 'check' || !_check) return;
    var el = document.getElementById('main-content');
    if (!el) return;
    var inputs = el.querySelectorAll('.stk-check-input');
    inputs.forEach(function (inp) {
      inp.addEventListener('input', function () {
        var pid = inp.getAttribute('data-pid');
        _check.counts[pid] = inp.value;
        var progressEl = document.getElementById('stk-check-progress');
        if (progressEl) {
          var scope = _productsForCheck();
          var counted = Object.keys(_check.counts).filter(function (k) { return _check.counts[k] !== '' && _check.counts[k] !== undefined; }).length;
          progressEl.textContent = counted + ' / ' + scope.length + ' produits saisis';
        }
        clearTimeout(_draftTimer);
        _draftTimer = setTimeout(function () {
          if (_check) MX.DB.saveStockCheckDraft(_check.id, _check.counts).catch(function () {});
        }, 800);
      });
    });
  }

  function _validateCheck() {
    if (!_check) return;
    var scope = _productsForCheck();
    var items = [];
    var checkedProducts = 0, productsToOrder = 0;
    scope.forEach(function (p) {
      var raw = _check.counts[p.id];
      if (raw === undefined || raw === '') return;
      var counted = Math.max(0, parseInt(raw, 10) || 0);
      var max = _maxQty(p);
      var need = Math.max(0, max - counted);
      checkedProducts++;
      if (need > 0) productsToOrder++;
      items.push({
        productId: p.id,
        productName: p.name || '',
        reference: p.ref || '',
        location: p.location || '',
        countedQty: counted,
        minQty: _min(p),
        maxQty: max,
        qtyToOrder: need,
        status: need > 0 ? (counted <= 0 ? 'rupture' : 'a_commander') : 'optimal'
      });
    });
    if (!items.length) {
      if (MX.toast) MX.toast('Saisissez au moins une quantité avant de valider', true);
      return;
    }
    MX.syncStart && MX.syncStart();
    MX.DB.commitStockCheck(_check.id, items, { checkedProducts: checkedProducts, productsToOrder: productsToOrder }).then(function () {
      MX.syncEnd && MX.syncEnd();
      if (MX.toast) MX.toast('État des lieux validé ✓ (' + productsToOrder + ' produit(s) à commander)');
      _check = null;
      _tab = 'overview';
      render();
    }).catch(function (e) {
      MX.syncFail && MX.syncFail();
      if (MX.toast) MX.toast('Erreur: ' + e.message, true);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SCANNER QR — BarcodeDetector natif, HTTPS requis, repli saisie directe
  // ══════════════════════════════════════════════════════════════════════
  function _scanSecure() {
    return window.isSecureContext === true || location.protocol === 'https:' || location.hostname === 'localhost';
  }
  function _scanSupported() { return typeof window !== 'undefined' && 'BarcodeDetector' in window; }

  function _scanStart() {
    _scan.error = '';
    if (!_scanSecure())   { _scan.error = 'https';       render(); return; }
    if (!_scanSupported()) { _scan.error = 'unsupported'; render(); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      _scan.stream = stream;
      _scan.active = true;
      render();
      var video = document.getElementById('stk-scan-video');
      if (!video) { _scanStop(); return; }
      video.srcObject = stream;
      video.play().catch(function () {});
      try { _scan.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
      catch (e) { _scan.error = 'unsupported'; _scanStop(); render(); return; }
      _scanLoop(video);
    }).catch(function () {
      _scan.error = 'denied';
      render();
    });
  }
  function _scanLoop(video) {
    if (!_scan.active || !_scan.detector) return;
    _scan.detector.detect(video).then(function (codes) {
      if (!_scan.active) return;
      if (codes && codes.length) {
        var raw = codes[0].rawValue || '';
        _scanStop();
        _onScanResult(raw);
      } else {
        _scan.raf = requestAnimationFrame(function () { _scanLoop(video); });
      }
    }).catch(function () {
      if (_scan.active) _scan.raf = requestAnimationFrame(function () { _scanLoop(video); });
    });
  }
  function _scanStop() {
    if (_scan.raf) cancelAnimationFrame(_scan.raf);
    if (_scan.stream) { try { _scan.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    _scan = { active: false, stream: null, raf: null, detector: null, error: _scan.error };
  }
  function _scanCancel() { _scanStop(); render(); }

  // ══════════════════════════════════════════════════════════════════════
  // Panneau latéral droit
  // ══════════════════════════════════════════════════════════════════════
  function _renderSidePanel() {
    var esc = MX.esc;
    var last = _lastDoneCheck();
    var h = '<div class="stk-side-card">';
    h += '<div class="stk-side-ttl"><i class="fas fa-circle-check"></i> Dernier état des lieux</div>';
    if (last) {
      h += '<div class="stk-lastcheck-loc">' + esc(last.location || '—') + '</div>';
      h += '<div class="stk-lastcheck-meta">' + _fmtDateTime(last.updatedAt || last.createdAt) + ' · Par ' + esc(last.userName || '—') + '</div>';
      h += '<button class="stk-side-btn" onclick="MX.Pages.Orders._viewCheckDetail(\'' + esc(last.id) + '\')">Voir le détail</button>';
    } else {
      h += '<div class="stk-lastcheck-meta">Aucun état des lieux validé pour le moment.</div>';
    }
    h += '</div>';

    h += '<div class="stk-side-card">';
    h += '<div class="stk-side-ttl"><i class="fas fa-bolt"></i> Actions rapides</div>';
    h += '<div class="stk-quick-list">';
    h += '<button class="stk-quick-item" onclick="MX.Pages.Orders._goTab(\'check\')"><i class="fas fa-clipboard-check"></i> Nouvel état des lieux</button>';
    h += '<button class="stk-quick-item" onclick="MX.Pages.Orders._goTab(\'locations\')"><i class="fas fa-location-dot"></i> Gérer les emplacements</button>';
    h += '<button class="stk-quick-item" onclick="MX.Pages.Orders._export()"><i class="fas fa-file-export"></i> Exporter la liste de commande</button>';
    var canEdit = MX.Auth && MX.Auth.canSeeAll ? MX.Auth.canSeeAll() : true;
    if (canEdit) h += '<button class="stk-quick-item" onclick="MX.Pages.Orders._openProdModal(null)"><i class="fas fa-plus"></i> Ajouter un produit</button>';
    h += '</div></div>';

    h += '<div class="stk-tip">🛠️ Un bon stock pour un service sans interruption.</div>';
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Panneau PDF commande fournisseur — CONSERVÉ à l'identique (logique
  // recQty/rec inchangée). Génère un bon de commande séparé, jamais lors
  // de la validation d'un état des lieux (règle #3).
  // ══════════════════════════════════════════════════════════════════════
  function _renderPanel(items) {
    var esc = MX.esc;
    var nR  = (MX.state.products || []).filter(function (p) { return _status(p) === 'rupture'; }).length;
    var nS  = (MX.state.products || []).filter(function (p) { return _status(p) === 'seuil'; }).length;
    var nSR = (MX.state.products || []).filter(function (p) { return _status(p) === 'sous_rec'; }).length;
    var nM  = _sel.size;
    var suppliers = _getSuppliers();
    var dlId = 'ord-supp-dl-' + Date.now();

    var h = '<div class="ord-panel" style="margin-top:14px">';
    h += '<div class="ord-panel-ttl">&#128196; Générer commande fournisseur</div>';
    h += '<div class="ord-panel-body">';
    h += '<div class="ord-panel-lbl">Inclure dans le PDF</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-rupture"' + (_pdfInc.rupture ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'rupture\',this.checked)">';
    h += '<label for="pdf-inc-rupture">Rupture</label>';
    h += '<span class="ord-panel-cnt" style="background:var(--red-dim);color:var(--red)">' + nR + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-seuil"' + (_pdfInc.seuil ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'seuil\',this.checked)">';
    h += '<label for="pdf-inc-seuil">Sous le seuil</label>';
    h += '<span class="ord-panel-cnt" style="background:var(--orange-dim);color:var(--orange)">' + nS + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-sous-rec"' + (_pdfInc.sous_rec ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'sous_rec\',this.checked)">';
    h += '<label for="pdf-inc-sous-rec">Sous recommandé</label>';
    h += '<span class="ord-panel-cnt" style="background:var(--orange-dim);color:var(--orange)">' + nSR + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-chk">';
    h += '<input type="checkbox" id="pdf-inc-manual"' + (_pdfInc.manual ? ' checked' : '') + ' onchange="MX.Pages.Orders._setPdfInc(\'manual\',this.checked)">';
    h += '<label for="pdf-inc-manual">Sélection manuelle</label>';
    h += '<span class="ord-panel-cnt">' + nM + '</span>';
    h += '</div>';

    h += '<div class="ord-panel-lbl" style="margin-top:12px">Fournisseur</div>';
    h += '<input list="' + dlId + '" class="fi ord-fi" placeholder="Nom du fournisseur" value="' + esc(_pdfSupp) + '" oninput="MX.Pages.Orders._setPdfSupp(this.value)">';
    h += '<datalist id="' + dlId + '">';
    suppliers.forEach(function (s) { h += '<option value="' + esc(s) + '">'; });
    h += '</datalist>';

    h += '<div class="ord-panel-lbl" style="margin-top:10px">Commentaire</div>';
    h += '<textarea class="fi ord-fi" rows="3" placeholder="Remarques…" oninput="MX.Pages.Orders._setPdfNote(this.value)" style="resize:vertical">' + esc(_pdfNote) + '</textarea>';

    var disabled = items.length === 0 ? ' disabled' : '';
    h += '<button class="ord-pdf-btn"' + disabled + ' onclick="MX.Pages.Orders._generatePDF()">';
    h += '&#128196; Générer le PDF <span class="ord-pdf-cnt">' + items.length + '</span>';
    h += '</button>';
    h += '</div></div>';
    return h;
  }

  function _histStatusStyle(st) {
    if (st === 'pending')   return 'background:#EAB30820;color:#EAB308;border:1px solid #EAB30880';
    if (st === 'ordered')   return 'background:rgba(59,130,246,0.15);color:#3B82F6;border:1px solid rgba(59,130,246,0.4)';
    if (st === 'delivering') return 'background:var(--orange-dim);color:var(--orange);border:1px solid var(--orange-border)';
    if (st === 'received')  return 'background:var(--green-dim);color:var(--green);border:1px solid var(--green-border)';
    return 'background:var(--bg4);color:var(--text2);border:1px solid var(--border)';
  }
  function _histStatusLabel(st) {
    if (st === 'pending')   return 'En attente';
    if (st === 'ordered')   return 'Commandée';
    if (st === 'delivering') return 'En livraison';
    if (st === 'received')  return 'Reçue';
    return st || '—';
  }

  function _renderHistory(orders) {
    var esc = MX.esc;
    var h = '<div class="ord-panel" style="margin-top:14px">';
    h += '<div class="ord-panel-ttl">&#128203; Historique des commandes fournisseur</div>';
    if (!orders || orders.length === 0) {
      h += '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">Aucune commande</div>';
      h += '</div>';
      return h;
    }
    var shown = orders.slice(0, 5);
    h += '<div class="ord-hist-list">';
    shown.forEach(function (o) {
      h += '<div class="ord-hist-row">';
      h += '<span class="ord-hist-num">' + esc(o.number || '—') + '</span>';
      h += '<span class="ord-hist-dt">' + _fmtDate(o.createdAt) + '</span>';
      h += '<span class="ord-hist-user">' + esc(o.user || '—') + '</span>';
      h += '<span class="ord-hist-badge" style="' + _histStatusStyle(o.status) + '">' + _histStatusLabel(o.status) + '</span>';
      h += '<button class="ord-hist-upd" title="Changer le statut" onclick="MX.Pages.Orders._cycleOrderStatus(\'' + esc(o.id) + '\',\'' + esc(o.status) + '\')">&#8635;</button>';
      h += '<button class="ord-hist-del" title="Supprimer la commande" onclick="MX.Pages.Orders._deleteOrder(\'' + esc(o.id) + '\')">&#10005;</button>';
      h += '</div>';
    });
    h += '</div>';
    if (orders.length > 5) {
      h += '<div style="padding:0 12px 12px">';
      h += '<button class="ord-hist-more" onclick="MX.Pages.Orders._showAllHistory()">Voir tout l\'historique (' + orders.length + ')</button>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _generatePDF() {
    var items = _pdfItems();
    if (!items.length) return;
    var orders = MX.state.orders || [];
    var cmdNum = 'CMD-' + String(orders.length + 1).padStart(3, '0');
    var user = MX.state.currentUser ? MX.state.currentUser.name : (MX.state.adminUser ? (MX.state.adminUser.email || 'Admin').split('@')[0] : 'Utilisateur');
    var now = new Date();
    var dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var supplier = _pdfSupp || '—';
    var comment  = _pdfNote || '';

    var rows = '';
    var total = 0;
    items.forEach(function (p) {
      var need = _need(p);
      total += need;
      rows += '<tr>';
      rows += '<td>' + (p.ref || '—') + '</td>';
      rows += '<td><strong>' + (p.name || '—') + '</strong></td>';
      rows += '<td>' + (p.location || '—') + '</td>';
      rows += '<td style="text-align:center">' + _qty(p) + '</td>';
      rows += '<td style="text-align:center">' + _min(p) + '</td>';
      rows += '<td style="text-align:center">' + _rec(p) + '</td>';
      rows += '<td style="text-align:center;color:#DC2626;font-weight:700">' + need + '</td>';
      rows += '</tr>';
    });

    var html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' + cmdNum + '</title><style>';
    html += 'body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:32px;background:#fff}';
    html += '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}';
    html += '.logo{font-size:24px;font-weight:900;color:#8B5CF6;letter-spacing:-0.5px}';
    html += '.logo span{color:#111}';
    html += '.cmd-title{text-align:right}';
    html += '.cmd-title h1{font-size:20px;font-weight:900;margin:0 0 4px;text-transform:uppercase;letter-spacing:2px}';
    html += '.cmd-title p{margin:2px 0;font-size:12px;color:#666}';
    html += '.meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;padding:16px;background:#f8f8f8;border-radius:8px;border:1px solid #e5e7eb}';
    html += '.meta-item label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;display:block;margin-bottom:3px}';
    html += '.meta-item span{font-size:13px;font-weight:600;color:#111}';
    html += 'table{width:100%;border-collapse:collapse;margin-bottom:20px}';
    html += 'th{background:#111;color:#fff;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em}';
    html += 'td{padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:12px}';
    html += 'tr:nth-child(even) td{background:#fafafa}';
    html += '.total-row td{background:#f0fdf4!important;font-weight:700;color:#15803d;border-top:2px solid #22c55e}';
    html += '.comment-box{margin-top:20px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#fffbeb}';
    html += '.comment-box strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#92400e;margin-bottom:6px}';
    html += '.footer{margin-top:40px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;display:flex;justify-content:space-between}';
    html += '@media print{body{padding:16px}.footer{position:fixed;bottom:16px;left:16px;right:16px}}';
    html += '</style></head><body>';
    html += '<div class="header">';
    html += '<div class="logo">MAIN<span>TIX</span></div>';
    html += '<div class="cmd-title"><h1>Bon de commande</h1><p>' + cmdNum + '</p><p>' + dateStr + '</p></div>';
    html += '</div>';
    html += '<div class="meta">';
    html += '<div class="meta-item"><label>Numéro</label><span>' + cmdNum + '</span></div>';
    html += '<div class="meta-item"><label>Date</label><span>' + dateStr + '</span></div>';
    html += '<div class="meta-item"><label>Créé par</label><span>' + user + '</span></div>';
    html += '<div class="meta-item"><label>Fournisseur</label><span>' + supplier + '</span></div>';
    html += '</div>';
    html += '<table>';
    html += '<thead><tr><th>Référence</th><th>Désignation</th><th>Emplacement</th><th style="text-align:center">Stock actuel</th><th style="text-align:center">Seuil</th><th style="text-align:center">Recommandé</th><th style="text-align:center">Qté à commander</th></tr></thead>';
    html += '<tbody>' + rows + '</tbody>';
    html += '<tfoot><tr class="total-row"><td colspan="6"><strong>Total à commander</strong></td><td style="text-align:center"><strong>' + total + '</strong></td></tr></tfoot>';
    html += '</table>';
    if (comment) html += '<div class="comment-box"><strong>Commentaire</strong>' + comment + '</div>';
    html += '<div class="footer"><span>Généré par Maintix</span><span>' + dateStr + ' à ' + timeStr + '</span></div>';
    html += '</body></html>';

    var win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(function () { win.print(); }, 400);
    }

    var orderData = {
      number: cmdNum, user: user, supplier: _pdfSupp || '', comment: _pdfNote || '', status: 'pending', createdAt: new Date(),
      items: items.map(function (p) { return { id: p.id, name: p.name, ref: p.ref || '', location: p.location || '', qty: _qty(p), minQty: _min(p), recQty: _rec(p), need: _need(p) }; })
    };
    if (MX.DB && MX.DB.addOrder) MX.DB.addOrder(orderData).catch(function (e) { console.error('addOrder error', e); });
    if (MX.toast) MX.toast(cmdNum + ' généré ✓');
  }

  // ══════════════════════════════════════════════════════════════════════
  // CRUD Produit — CONSERVÉ (ajout du champ maxQty)
  // ══════════════════════════════════════════════════════════════════════
  function _openProdModal(id) {
    var esc = MX.esc;
    var prods = MX.state.products || [];
    var p = id ? prods.find(function (x) { return x.id === id; }) : null;
    var catDlId = 'prod-cat-dl';
    var suppDlId = 'prod-supp-dl';
    var suppliers = _getSuppliers();

    var title = p ? 'Modifier le produit' : 'Nouveau produit';
    var sub   = p ? ('Réf. ' + (p.ref || '—')) : 'Ajouter un produit au stock';

    var fields = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
    fields += '<div style="grid-column:1/-1"><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Désignation</label>';
    fields += '<input id="prod-name" class="fi" type="text" placeholder="Nom du produit" value="' + esc(p ? p.name || '' : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Référence</label>';
    fields += '<input id="prod-ref" class="fi" type="text" placeholder="Référence" value="' + esc(p ? p.ref || '' : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Catégorie</label>';
    fields += '<input id="prod-cat" class="fi" type="text" placeholder="Catégorie" list="' + catDlId + '" value="' + esc(p ? p.category || '' : '') + '">';
    fields += '<datalist id="' + catDlId + '">' + _CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Emplacement</label>';
    fields += '<input id="prod-loc" class="fi" type="text" placeholder="Ex: Armoire A3, Hall B" value="' + esc(p ? p.location || '' : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">📊 Stock constaté</label>';
    fields += '<input id="prod-qty" class="fi" type="number" min="0" placeholder="0" value="' + (p ? _qty(p) : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--red);display:block;margin-bottom:5px">📉 Stock minimum</label>';
    fields += '<input id="prod-minqty" class="fi" type="number" min="0" placeholder="0" value="' + (p ? _min(p) : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--green);display:block;margin-bottom:5px">📦 Stock maximum <span style="font-size:10px;font-weight:400;color:var(--text3)">(objectif de réassort)</span></label>';
    fields += '<input id="prod-maxqty" class="fi" type="number" min="0" placeholder="Ex: 20" value="' + (p && p.maxQty !== undefined && p.maxQty !== null && p.maxQty !== '' ? parseInt(p.maxQty, 10) : '') + '"></div>';

    fields += '<div><label style="font-size:11px;font-weight:600;color:var(--cyan);display:block;margin-bottom:5px">Stock recommandé <span style="font-size:10px;font-weight:400;color:var(--text3)">(bon de commande, optionnel)</span></label>';
    fields += '<input id="prod-recqty" class="fi" type="number" min="0" placeholder="Ex: 20" value="' + (p && p.recQty ? parseInt(p.recQty, 10) : '') + '"></div>';

    fields += '<div style="grid-column:1/-1"><label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Fournisseur</label>';
    fields += '<input id="prod-supplier" class="fi" type="text" placeholder="Fournisseur" list="' + suppDlId + '" value="' + esc(p ? p.supplier || '' : '') + '">';
    fields += '<datalist id="' + suppDlId + '">' + suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>';
    fields += '</div>';

    var actions = '';
    if (p) actions += '<button class="modal-btn danger" onclick="MX.Pages.Orders._delProd(\'' + esc(id) + '\')">Supprimer</button>';
    actions += '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    actions += '<button class="modal-btn confirm" onclick="MX.Pages.Orders._saveProd(' + (id ? '\'' + esc(id) + '\'' : 'null') + ')">' + (p ? 'Enregistrer' : 'Ajouter') + '</button>';

    MX.showModal({ title: title, sub: sub, body: fields, actions: actions });
  }

  function _saveProd(id) {
    var name     = (document.getElementById('prod-name')     || {}).value || '';
    var ref      = (document.getElementById('prod-ref')      || {}).value || '';
    var cat      = (document.getElementById('prod-cat')      || {}).value || '';
    var loc      = (document.getElementById('prod-loc')      || {}).value || '';
    var qty      = parseInt((document.getElementById('prod-qty')    || {}).value || '0', 10);
    var minQty   = parseInt((document.getElementById('prod-minqty') || {}).value || '0', 10);
    var maxRaw   = (document.getElementById('prod-maxqty') || {}).value;
    var supplier = (document.getElementById('prod-supplier') || {}).value || '';
    var recQty   = parseInt((document.getElementById('prod-recqty') || {}).value || '0', 10);

    if (!name.trim()) { if (MX.toast) MX.toast('Le nom est obligatoire', true); return; }
    var data = { name: name.trim(), ref: ref.trim(), category: cat.trim(), location: loc.trim(), qty: qty, minQty: minQty, recQty: recQty, supplier: supplier.trim() };
    data.maxQty = (maxRaw !== undefined && maxRaw !== null && maxRaw !== '') ? parseInt(maxRaw, 10) : null;

    var done = function () { MX.closeModal(); if (MX.toast) MX.toast(id ? 'Produit mis à jour ✓' : 'Produit ajouté ✓'); render(); };
    var fail = function (e) { if (MX.toast) MX.toast('Erreur: ' + e.message, true); };
    if (id) MX.DB.updateProduct(id, data).then(done).catch(fail);
    else    MX.DB.addProduct(data).then(done).catch(fail);
  }

  function _delProd(id) {
    var prods = MX.state.products || [];
    var p = prods.find(function (x) { return x.id === id; });
    var name = p ? p.name : id;
    if (!confirm('Supprimer "' + name + '" ? Cette action est irréversible.')) return;
    MX.DB.deleteProduct(id).then(function () {
      MX.closeModal();
      _sel.delete(id);
      if (MX.toast) MX.toast('Produit supprimé');
      render();
    }).catch(function (e) { if (MX.toast) MX.toast('Erreur: ' + e.message, true); });
  }

  function _prodMenu(e, id) {
    e.stopPropagation();
    var esc = MX.esc;
    var prods = MX.state.products || [];
    var p = prods.find(function (x) { return x.id === id; });
    if (!p) return;
    var name = p.name || id;
    var body = '<div style="display:flex;flex-direction:column;gap:8px">';
    body += '<button class="modal-btn confirm" onclick="MX.closeModal();MX.Pages.Orders._openProdModal(\'' + esc(id) + '\')">&#9998; Modifier</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'ordered\')">&#128230; Marquer commandée</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'delivering\')">&#128666; En livraison</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'received\')">&#9989; Réceptionné</button>';
    body += '<button class="modal-btn cancel" onclick="MX.closeModal();MX.Pages.Orders._setOrderStatus(\'' + esc(id) + '\',\'\')">&#8635; Réinitialiser</button>';
    body += '</div>';
    MX.showModal({ title: 'Actions — ' + esc(name), sub: '', body: body, actions: '' });
  }

  function _setOrderStatus(id, status) {
    if (MX.DB && MX.DB.updateProduct) {
      MX.DB.updateProduct(id, { orderStatus: status }).then(function () {
        if (MX.toast) MX.toast('Statut mis à jour ✓');
        render();
      }).catch(function (e) { if (MX.toast) MX.toast('Erreur: ' + e.message, true); });
    }
  }

  function _cycleOrderStatus(id, current) {
    var cycle = ['pending', 'ordered', 'delivering', 'received'];
    var idx  = cycle.indexOf(current);
    var next = cycle[(idx + 1) % cycle.length];
    if (MX.DB && MX.DB.updateOrderStatus) {
      MX.DB.updateOrderStatus(id, next).then(function () {
        if (MX.toast) MX.toast('Statut: ' + _histStatusLabel(next));
        render();
      }).catch(function (e) { if (MX.toast) MX.toast('Erreur: ' + e.message, true); });
    }
  }

  function _deleteOrder(id) {
    var orders = MX.state.orders || [];
    var o = orders.find(function (x) { return x.id === id; });
    var label = o ? (o.number || 'cette commande') : 'cette commande';
    MX.showModal(
      'Supprimer ' + label + ' ?',
      'La commande sera définitivement supprimée. Cette action est irréversible.',
      [
        { label: 'Supprimer', cls: 'danger', fn: function () {
          if (MX.DB && MX.DB.deleteOrder) {
            MX.DB.deleteOrder(id).then(function () {
              if (MX.toast) MX.toast(label + ' supprimée');
              render();
            }).catch(function (e) { if (MX.toast) MX.toast('Erreur: ' + e.message, true); });
          }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    );
  }

  function _showAllHistory() {
    var esc = MX.esc;
    var orders = MX.state.orders || [];
    if (!orders.length) {
      MX.showModal({ title: 'Historique', sub: '', body: '<p style="color:var(--text3);font-size:13px">Aucune commande enregistrée.</p>', actions: '<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>' });
      return;
    }
    var body = '<div style="display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto">';
    orders.forEach(function (o) {
      body += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px">';
      body += '<span style="font-size:12px;font-weight:700;font-family:var(--ffm);color:var(--text1);flex-shrink:0">' + esc(o.number || '—') + '</span>';
      body += '<span style="font-size:10px;color:var(--text3);flex-shrink:0">' + _fmtDate(o.createdAt) + '</span>';
      body += '<span style="font-size:11px;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.user || '—') + '</span>';
      body += '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;white-space:nowrap;' + _histStatusStyle(o.status) + '">' + _histStatusLabel(o.status) + '</span>';
      body += '<button class="ord-hist-upd" onclick="MX.Pages.Orders._cycleOrderStatus(\'' + esc(o.id) + '\',\'' + esc(o.status) + '\')">&#8635;</button>';
      body += '<button class="ord-hist-del" title="Supprimer" onclick="MX.closeModal();MX.Pages.Orders._deleteOrder(\'' + esc(o.id) + '\')">&#10005;</button>';
      body += '</div>';
    });
    body += '</div>';
    MX.showModal({ title: 'Historique des commandes', sub: orders.length + ' commande' + (orders.length > 1 ? 's' : ''), body: body, actions: '<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>' });
  }

  function _export() {
    var prods = MX.state.products || [];
    var rows = [['ID', 'Nom', 'Référence', 'Catégorie', 'Emplacement', 'Stock', 'Min', 'Max', 'À commander', 'Statut', 'Fournisseur', 'Statut commande']];
    prods.forEach(function (p) {
      rows.push([p.id || '', p.name || '', p.ref || '', p.category || '', p.location || '', _qty(p), _min(p), _maxQty(p), _needMax(p), SM[_statusMax(p)].label, p.supplier || '', p.orderStatus || '']);
    });
    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'stock-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    if (MX.toast) MX.toast('Export CSV téléchargé ✓');
  }

  function updateQty(id, val) {
    var qty = parseInt(val, 10);
    if (isNaN(qty)) return;
    if (MX.DB && MX.DB.updateProduct) {
      MX.syncStart && MX.syncStart();
      MX.DB.updateProduct(id, { qty: qty }).then(function () { MX.syncEnd && MX.syncEnd(); }).catch(function (e) { MX.syncFail && MX.syncFail(); console.error(e); });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  function _goTab(tab) {
    if (_tab === 'scan' && tab !== 'scan') _scanStop();
    if (tab !== 'check' && tab !== 'scan' && tab !== 'manual') _check = null;
    _tab = tab;
    render();
  }
  function _setFilter(f) { _filter = f; render(); }
  function _onSearch(v) { _search = v; render(); }
  function _toggleSel(id, on) { if (on) _sel.add(id); else _sel.delete(id); render(); }
  function _selAllVis(on) {
    var vis = _filtered();
    vis.forEach(function (p) { if (on) _sel.add(p.id); else _sel.delete(p.id); });
    render();
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Orders = {
    render: render,
    updateQty: updateQty,
    _goTab: _goTab,
    _setFilter: _setFilter,
    _onSearch: _onSearch,
    _toggleSel: _toggleSel,
    _selAllVis: _selAllVis,
    _setPdfSupp: function (v) { _pdfSupp = v; },
    _setPdfNote: function (v) { _pdfNote = v; },
    _setPdfInc: function (k, v) { _pdfInc[k] = !!v; render(); },
    _openProdModal: _openProdModal,
    _saveProd: _saveProd,
    _delProd: _delProd,
    _generatePDF: _generatePDF,
    _prodMenu: _prodMenu,
    _setOrderStatus: _setOrderStatus,
    _cycleOrderStatus: _cycleOrderStatus,
    _deleteOrder: _deleteOrder,
    _showAllHistory: _showAllHistory,
    _export: _export,
    _startCheck: _startCheck,
    _startCheckFromSelect: _startCheckFromSelect,
    _resumeCheck: _resumeCheck,
    _cancelCheck: _cancelCheck,
    _validateCheck: _validateCheck,
    _viewCheckDetail: _viewCheckDetail,
    _scanStart: _scanStart,
    _scanCancel: _scanCancel,
  };
})();
