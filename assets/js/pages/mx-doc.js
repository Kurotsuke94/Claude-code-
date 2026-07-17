(function () {
  'use strict';

  // ── STATE ──
  var _curTab       = 'modeles';
  var _loaded       = false;
  var _templates    = [];
  var _instances    = [];
  var _unsub        = {};
  var _filterStatus = 'all';

  // Builder state
  var _builderMode  = false;
  var _builderTpl   = null;
  var _builderSecs  = [];
  var _selBlock     = null;

  // V2 Builder state
  var _v2History     = [];
  var _v2Future      = [];
  var _v2SelSIdx     = null;
  var _v2SelEIdx     = null;
  var _v2MobPanel    = 'canvas';
  var _v2PalDragType = null;
  var _v2ElDragSrc   = null;
  var _v2SecDragSrc  = null;

  // V3 Builder state
  var _v3SelSIdx     = null;
  var _v3SelBIdx     = null;
  var _v3MobPanel    = 'canvas';
  var _v3SecCollapsed = {};
  var _v3AddMenuSIdx  = null;

  // V4 Builder state
  var _v4NavTab      = 'elements';
  var _v4SelSIdx     = null;
  var _v4SelBIdx     = null;
  var _v4MobPanel    = 'canvas';
  var _v4SecCollapsed = {};
  var _v4AddMenuSIdx  = null;
  var _v4PropsTab    = 'props';

  // V5 Builder state
  var _v5NavTab      = 'elements';
  var _v5SelSIdx     = null;
  var _v5SelBIdx     = null;
  var _v5MobPanel    = 'canvas';
  var _v5SecCollapsed = {};
  var _v5AddMenuSIdx  = null;

  // V6 Builder state
  var _v6SelSIdx     = null;
  var _v6SelBIdx     = null;
  var _v6SecCollapsed = {};
  var _v6MobPanel    = 'canvas';
  var _v6DragData    = null;

  // V7 Column Library state
  var _colLibrary    = [];
  var _colLibUnsub   = null;
  var _v7PalTab      = 'types';
  var _v7ModalDef    = null;
  var _v7ModalIsNew  = true;
  var _v7ModalTab    = 'info';

  // Execution state
  var _execMode      = false;
  var _execTemplate  = null;
  var _execInstance  = null;
  var _execResponses = {};

  var DB = {
    templates: function () { return db.collection('mx_doc_templates'); },
    instances: function () { return db.collection('mx_doc_instances'); },
  };
  var FV = firebase.firestore.FieldValue;

  // ── CONSTANTS ──
  var BLOCK_TYPES = [
    { type: 'titre',       icon: 'fa-heading',       l: 'Titre',           color: '#8B5CF6' },
    { type: 'sstitre',     icon: 'fa-text-height',   l: 'Sous-titre',      color: '#6366F1' },
    { type: 'separator',   icon: 'fa-minus',         l: 'Séparateur',      color: '#475569' },
    { type: 'texte',       icon: 'fa-align-left',    l: 'Texte libre',     color: '#64748B' },
    { type: 'numerique',   icon: 'fa-hashtag',       l: 'Numérique',       color: '#0EA5E9' },
    { type: 'ouinon',      icon: 'fa-toggle-on',     l: 'Oui / Non',       color: '#10B981' },
    { type: 'faitnonfait', icon: 'fa-circle-check',  l: 'Fait / Non fait', color: '#22C55E' },
    { type: 'commentaire', icon: 'fa-comment-lines', l: 'Commentaire',     color: '#F59E0B' },
    { type: 'liste',       icon: 'fa-list',          l: 'Liste',           color: '#6366F1' },
    { type: 'date',        icon: 'fa-calendar',      l: 'Date',            color: '#F97316' },
    { type: 'heure',       icon: 'fa-clock',         l: 'Heure',           color: '#EF4444' },
    { type: 'photo',       icon: 'fa-camera',        l: 'Photo',           color: '#EC4899' },
    { type: 'signature',   icon: 'fa-pen-nib',       l: 'Signature',       color: '#A855F7' },
  ];

  var SEC_COLORS = ['#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#0EA5E9','#EC4899','#14B8A6','#F97316','#84CC16'];

  var FREQ_LABELS = {
    on_demand: 'À la demande',
    daily:     'Quotidien',
    weekly:    'Hebdomadaire',
    biweekly:  'Bihebdomadaire',
    monthly:   'Mensuel',
    quarterly: 'Trimestriel',
  };

  var STATUS_LABELS = { draft: 'Brouillon', published: 'Publié', archived: 'Archivé' };

  var STATIC_TYPES = ['titre', 'sstitre', 'separator', 'texte'];

  // ── HELPERS ──
  function _fsErr(coll) {
    return function (err) {
      var code = err.code || '';
      if (code === 'failed-precondition') console.warn('[MxDoc] index needed:', coll, err.message);
      else if (code === 'permission-denied') console.warn('[MxDoc] permission-denied:', coll);
      else console.error('[MxDoc]', coll, err);
    };
  }

  function _author() {
    var cu = MX.state.currentUser;
    var ad = MX.state.adminUser;
    if (cu) return cu.name || 'Inconnu';
    if (ad) return (ad.email || 'admin').split('@')[0];
    return 'Inconnu';
  }

  function _canEdit() { return MX.Auth.canSeeAll(); }

  function _uid() { return MX.uuid ? MX.uuid() : ('blk_' + Date.now().toString(36) + Math.random().toString(36).slice(2)); }

  function _e(s) { return MX.esc ? MX.esc(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _fmtTs(ts) {
    if (!ts) return '—';
    var ms = ts && ts.toMillis ? ts.toMillis() : (ts && ts.seconds ? ts.seconds * 1000 : (typeof ts === 'number' ? ts : 0));
    if (!ms) return '—';
    var d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function _btInfo(type) { return BLOCK_TYPES.find(function (b) { return b.type === type; }) || { icon: 'fa-file', l: type, color: 'var(--cyan)' }; }

  // ── LOAD ──
  function _load() {
    if (_loaded) return;
    _loaded = true;
    _unsub.templates = DB.templates().orderBy('createdAt', 'desc').onSnapshot(function (snap) {
      _templates = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    }, _fsErr('mx_doc_templates'));
    _unsub.instances = DB.instances().orderBy('startedAt', 'desc').limit(200).onSnapshot(function (snap) {
      _instances = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      if (_curTab === 'historique') _rerender();
    }, _fsErr('mx_doc_instances'));
  }

  // ── ENTRY POINT ──
  function render() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    if (window._mxdocStartTab) { _curTab = window._mxdocStartTab; delete window._mxdocStartTab; }
    _load();
    if (_builderMode) { _renderBuilderV6(mc); return; }
    if (_execMode)    { _renderExec(mc);       return; }
    mc.innerHTML = _pageShell();
    _renderTabBody();
  }

  function _rerender() {
    if (_builderMode || _execMode) return;
    var bd = document.getElementById('mxd-body');
    if (bd) bd.innerHTML = _tabBody();
  }

  function _pageShell() {
    var tabs = [
      { id: 'modeles',    icon: 'fa-layer-group',       l: 'Mes modèles' },
      { id: 'historique', icon: 'fa-clock-rotate-left', l: 'Historique'  },
      { id: 'parametres', icon: 'fa-sliders',           l: 'Paramètres'  },
    ];
    var th = tabs.map(function (t) {
      return '<button class="mxd-tab' + (_curTab === t.id ? ' mxd-tab--active' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._tab(\'' + t.id + '\')">'
        + '<i class="fas ' + t.icon + '"></i><span>' + t.l + '</span></button>';
    }).join('');
    return '<div class="mxd-page"><div class="mxd-tabs">' + th + '</div>'
      + '<div id="mxd-body" class="mxd-body"></div></div>';
  }

  function _renderTabBody() { var bd = document.getElementById('mxd-body'); if (bd) bd.innerHTML = _tabBody(); }
  function _tabBody() {
    if (_curTab === 'modeles')    return _tModeles();
    if (_curTab === 'historique') return _tHistorique();
    if (_curTab === 'parametres') return _tParametres();
    return '';
  }
  function _tab(id) { _curTab = id; _renderTabBody(); }

  // ── TAB: MES MODÈLES ──
  function _tModeles() {
    var canEdit = _canEdit();
    var filters = [
      { id: 'all', l: 'Tous' }, { id: 'published', l: 'Publiés' },
      { id: 'draft', l: 'Brouillons' }, { id: 'archived', l: 'Archivés' },
    ];
    var fH = filters.map(function (f) {
      return '<button class="mxd-filter-btn' + (_filterStatus === f.id ? ' mxd-filter-btn--active' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._setFilter(\'' + f.id + '\')">' + f.l + '</button>';
    }).join('');
    var visible = _templates.filter(function (t) {
      if (_filterStatus === 'all')      return t.status !== 'archived';
      if (_filterStatus === 'archived') return t.status === 'archived';
      return t.status === _filterStatus;
    });
    var cardsH = visible.length === 0
      ? _emptyState('Aucun modèle', 'fa-file-circle-plus', canEdit ? 'Créez votre premier modèle de document.' : 'Aucun modèle disponible.')
      : visible.map(_templateCard).join('');
    return '<div class="mxd-modeles">'
      + '<div class="mxd-mod-head"><div class="mxd-filters">' + fH + '</div>'
      + (canEdit ? '<button class="mxd-new-btn" onclick="MX.Pages.MxDoc._newTemplate()"><i class="fas fa-plus"></i> Nouveau modèle</button>' : '')
      + '</div><div class="mxd-cards">' + cardsH + '</div></div>';
  }

  function _templateCard(t) {
    var e = _e;
    var status    = t.status || 'draft';
    var statusCls = { draft: 'mxd-status--draft', published: 'mxd-status--pub', archived: 'mxd-status--arch' }[status] || 'mxd-status--draft';
    var statusL   = STATUS_LABELS[status] || status;
    var freqL     = FREQ_LABELS[t.frequency] || t.frequency || 'À la demande';
    var secCnt    = (t.sections || []).length;
    var blkCnt    = (t.sections || []).reduce(function (acc, s) { return acc + (s.blocks || []).length; }, 0);
    var canEdit   = _canEdit();
    var accent    = e(t.color || 'var(--cyan)');
    var tid       = e(t.id);
    var actH = '';
    if (canEdit) {
      var pubArchBtn = status !== 'published'
        ? '<button class="mxd-act-btn mxd-act-btn--pub" onclick="event.stopPropagation();MX.Pages.MxDoc._publishTemplate(\'' + tid + '\')" title="Publier"><i class="fas fa-globe"></i></button>'
        : '<button class="mxd-act-btn mxd-act-btn--arch" onclick="event.stopPropagation();MX.Pages.MxDoc._archiveTemplate(\'' + tid + '\')" title="Archiver"><i class="fas fa-box-archive"></i></button>';
      actH = '<div class="mxd-card-acts">' + pubArchBtn
        + '<button class="mxd-act-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._duplicateTemplate(\'' + tid + '\')" title="Dupliquer"><i class="fas fa-copy"></i></button>'
        + '<button class="mxd-act-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._openBuilder(\'' + tid + '\')" title="Modifier"><i class="fas fa-pen"></i></button>'
        + '<button class="mxd-act-btn mxd-act-btn--del" onclick="event.stopPropagation();MX.Pages.MxDoc._deleteTemplate(\'' + tid + '\')" title="Supprimer"><i class="fas fa-trash"></i></button>'
        + '</div>';
    }
    var launchH = status === 'published'
      ? '<button class="mxd-launch-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._startExec(\'' + tid + '\')"><i class="fas fa-play"></i> Remplir</button>'
      : '';
    var clickFn = canEdit ? 'MX.Pages.MxDoc._openBuilder(\'' + tid + '\')' : (status === 'published' ? 'MX.Pages.MxDoc._startExec(\'' + tid + '\')' : '');
    return '<div class="mxd-card" onclick="' + clickFn + '">'
      + '<div class="mxd-card-accent" style="background:' + accent + '"></div>'
      + '<div class="mxd-card-body">'
      + '<div class="mxd-card-row1"><span class="mxd-status ' + statusCls + '">' + statusL + '</span>' + actH + '</div>'
      + '<div class="mxd-card-icon" style="color:' + accent + '"><i class="fas ' + e(t.icon || 'fa-file-lines') + '"></i></div>'
      + '<div class="mxd-card-title">' + e(t.title || 'Sans titre') + '</div>'
      + (t.description ? '<div class="mxd-card-desc">' + e(t.description) + '</div>' : '')
      + '<div class="mxd-card-meta">'
      + '<span><i class="fas fa-rotate"></i> ' + freqL + '</span>'
      + '<span><i class="fas fa-layer-group"></i> ' + secCnt + ' section' + (secCnt > 1 ? 's' : '') + '</span>'
      + '<span><i class="fas fa-list-check"></i> ' + blkCnt + ' champ' + (blkCnt > 1 ? 's' : '') + '</span>'
      + '</div>' + launchH + '</div></div>';
  }

  function _setFilter(f) { _filterStatus = f; _rerender(); }

  function _emptyState(title, icon, msg) {
    return '<div class="mxd-empty"><i class="fas ' + icon + '"></i>'
      + '<div class="mxd-empty-title">' + title + '</div>'
      + '<div class="mxd-empty-msg">' + msg + '</div></div>';
  }

  // ── TAB: HISTORIQUE ──
  function _tHistorique() {
    var rows = _instances.length === 0
      ? _emptyState('Aucun document', 'fa-clock-rotate-left', 'Les documents remplis apparaîtront ici.')
      : _instances.map(_instanceRow).join('');
    var expH = _instances.length > 0
      ? '<div class="mxd-hist-acts">'
        + '<button class="mxd-export-btn" onclick="MX.Pages.MxDoc._exportExcel()"><i class="fas fa-file-excel"></i> Excel</button>'
        + '<button class="mxd-export-btn" onclick="MX.Pages.MxDoc._exportPdf()"><i class="fas fa-print"></i> Imprimer</button>'
        + '</div>' : '';
    return '<div class="mxd-historique">'
      + '<div class="mxd-hist-head"><div class="mxd-hist-title"><i class="fas fa-clock-rotate-left"></i> Historique des documents</div>' + expH + '</div>'
      + '<div class="mxd-hist-list">' + rows + '</div></div>';
  }

  function _instanceRow(inst) {
    var e    = _e;
    var done = inst.status === 'termine';
    var dateStr = _fmtTs(inst.completedAt || inst.startedAt);
    return '<div class="mxd-inst-row">'
      + '<div class="mxd-inst-icon ' + (done ? 'mxd-inst-icon--done' : '') + '"><i class="fas ' + (done ? 'fa-circle-check' : 'fa-circle-half-stroke') + '"></i></div>'
      + '<div class="mxd-inst-info">'
      + '<div class="mxd-inst-name">' + e(inst.templateTitle || 'Document') + '</div>'
      + '<div class="mxd-inst-meta"><span><i class="fas fa-user"></i> ' + e(inst.assignedTo || '—') + '</span>'
      + '<span><i class="fas fa-calendar"></i> ' + dateStr + '</span></div>'
      + '</div>'
      + '<span class="mxd-inst-badge ' + (done ? 'mxd-inst-badge--done' : 'mxd-inst-badge--prog') + '">' + (done ? 'Terminé' : 'En cours') + '</span>'
      + '</div>';
  }

  // ── TAB: PARAMÈTRES ──
  function _tParametres() {
    var pubCnt = _templates.filter(function (t) { return t.status === 'published'; }).length;
    var dftCnt = _templates.filter(function (t) { return t.status === 'draft'; }).length;
    return '<div class="mxd-params">'
      + '<div class="mxd-params-card">'
      + '<div class="mxd-params-hdr"><i class="fas fa-circle-info"></i> À propos de MX Doc</div>'
      + '<p class="mxd-params-p">MX Doc est le moteur documentaire officiel de Maintix. Il permet de créer des modèles de documents numériques pouvant remplacer tout document papier du service technique.</p>'
      + '<p class="mxd-params-p">Les modèles publiés sont accessibles aux techniciens. Les documents remplis sont archivés et consultables dans l\'historique.</p>'
      + '</div>'
      + '<div class="mxd-params-card">'
      + '<div class="mxd-params-hdr"><i class="fas fa-database"></i> Statistiques</div>'
      + '<div class="mxd-stats-grid">'
      + '<div class="mxd-stat"><div class="mxd-stat-val">' + pubCnt + '</div><div class="mxd-stat-lbl">Modèles publiés</div></div>'
      + '<div class="mxd-stat"><div class="mxd-stat-val">' + dftCnt + '</div><div class="mxd-stat-lbl">Brouillons</div></div>'
      + '<div class="mxd-stat"><div class="mxd-stat-val">' + _instances.length + '</div><div class="mxd-stat-lbl">Documents enregistrés</div></div>'
      + '</div></div>'
      + '<div class="mxd-params-card">'
      + '<div class="mxd-params-hdr"><i class="fas fa-cube"></i> Blocs disponibles</div>'
      + '<div class="mxd-params-types">'
      + BLOCK_TYPES.map(function (bt) { return '<div class="mxd-params-type"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i><span>' + bt.l + '</span></div>'; }).join('')
      + '</div></div></div>';
  }

  // ── CRUD TEMPLATES ──
  function _newTemplate() { _openBuilder(null); }

  function _openBuilder(id) {
    var tpl = id ? _templates.find(function (t) { return t.id === id; }) : null;
    if (id && !tpl) return;
    _builderTpl  = tpl
      ? JSON.parse(JSON.stringify(tpl))
      : { id: null, title: '', description: '', icon: 'fa-file-lines', color: '#8B5CF6', status: 'draft', frequency: 'on_demand', sections: [] };
    _builderSecs = JSON.parse(JSON.stringify(_builderTpl.sections || []));
    if (!_builderSecs.length) {
      _builderSecs.push({ id: _uid(), label: 'Section 1', color: SEC_COLORS[0], columns: ['etat'], rows: [] });
    } else {
      _builderSecs.forEach(function(s, i) { if (!s.color) s.color = SEC_COLORS[i % SEC_COLORS.length]; });
    }
    _selBlock     = null;
    _v2History    = [];
    _v2Future     = [];
    _v2SelSIdx    = null;
    _v2SelEIdx    = null;
    _v2MobPanel   = 'canvas';
    _v2PalDragType = null;
    _v2ElDragSrc   = null;
    _v2SecDragSrc  = null;
    _v3SelSIdx     = null;
    _v3SelBIdx     = null;
    _v3MobPanel    = 'canvas';
    _v3SecCollapsed = {};
    _v3AddMenuSIdx  = null;
    _v4NavTab      = 'elements';
    _v4SelSIdx     = null;
    _v4SelBIdx     = null;
    _v4MobPanel    = 'canvas';
    _v4SecCollapsed = {};
    _v4AddMenuSIdx  = null;
    _v4PropsTab    = 'props';
    _v5NavTab      = 'elements';
    _v5SelSIdx     = null;
    _v5SelBIdx     = null;
    _v5MobPanel    = 'canvas';
    _v5SecCollapsed = {};
    _v5AddMenuSIdx  = null;
    _builderMode  = true;
    _v7LoadLibrary();
    render();
  }

  function _closeBuilder() {
    _v7UnloadLibrary();
    _builderMode  = false;
    _builderTpl   = null;
    _builderSecs  = [];
    _selBlock     = null;
    _v2History    = [];
    _v2Future     = [];
    _v2SelSIdx    = null;
    _v2SelEIdx    = null;
    _v3SelSIdx    = null;
    _v3SelBIdx    = null;
    _v3SecCollapsed = {};
    _v3AddMenuSIdx  = null;
    _v4NavTab      = 'elements';
    _v4SelSIdx     = null;
    _v4SelBIdx     = null;
    _v4SecCollapsed = {};
    _v4AddMenuSIdx  = null;
    _v4PropsTab    = 'props';
    _v5NavTab      = 'elements';
    _v5SelSIdx     = null;
    _v5SelBIdx     = null;
    _v5SecCollapsed = {};
    _v5AddMenuSIdx  = null;
    _v6SelSIdx     = null;
    _v6SelBIdx     = null;
    _v6SecCollapsed = {};
    _v6MobPanel    = 'canvas';
    _v6DragData    = null;
    _v7PalTab      = 'types';
    _v7ModalDef    = null;
    _v7ModalIsNew  = true;
    render();
  }

  async function _publishTemplate(id) {
    MX.syncStart();
    try {
      await DB.templates().doc(id).update({ status: 'published', publishedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
      MX.syncEnd(); MX.toast('Modèle publié');
    } catch (err) { MX.syncFail(); MX.toast('Erreur: ' + err.message, true); }
  }

  async function _archiveTemplate(id) {
    MX.syncStart();
    try {
      await DB.templates().doc(id).update({ status: 'archived', archivedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
      MX.syncEnd(); MX.toast('Modèle archivé');
    } catch (err) { MX.syncFail(); MX.toast('Erreur: ' + err.message, true); }
  }

  async function _duplicateTemplate(id) {
    var tpl = _templates.find(function (t) { return t.id === id; });
    if (!tpl) return;
    var copy = JSON.parse(JSON.stringify(tpl));
    delete copy.id;
    copy.title = 'Copie — ' + tpl.title;
    copy.status = 'draft';
    copy.createdBy = _author();
    copy.createdAt = FV.serverTimestamp();
    copy.updatedAt = FV.serverTimestamp();
    copy.publishedAt = null; copy.archivedAt = null;
    MX.syncStart();
    try {
      await DB.templates().add(copy);
      MX.syncEnd(); MX.toast('Modèle dupliqué');
    } catch (err) { MX.syncFail(); MX.toast('Erreur: ' + err.message, true); }
  }

  function _deleteTemplate(id) {
    var tpl = _templates.find(function (t) { return t.id === id; });
    if (!tpl) return;
    MX.showModal({
      title: 'Supprimer ce modèle ?', sub: _e(tpl.title || 'Sans titre'),
      body: '<p style="color:var(--text2);font-size:13px">Cette action est irréversible. Les documents déjà remplis resteront dans l\'historique.</p>',
      actions: [
        { label: '<i class="fas fa-trash"></i> Supprimer', cls: 'danger', fn: function () { _doDeleteTemplate(id); } },
        { label: 'Annuler', cls: 'cancel', fn: function () {} },
      ],
    });
  }

  async function _doDeleteTemplate(id) {
    MX.syncStart();
    try {
      await DB.templates().doc(id).delete();
      MX.syncEnd(); MX.toast('Modèle supprimé');
    } catch (err) { MX.syncFail(); MX.toast('Erreur: ' + err.message, true); }
  }

  // ─────────────────────────────────────────────────────
  // V2 BUILDER — RENDER
  // ─────────────────────────────────────────────────────
  function _renderBuilderV2(mc) {
    var tpl     = _builderTpl || {};
    var status  = tpl.status || 'draft';
    var statusL = STATUS_LABELS[status] || 'Brouillon';
    var statusCls = status === 'published' ? 'mxd2-badge--pub' : status === 'archived' ? 'mxd2-badge--arch' : 'mxd2-badge--draft';

    mc.innerHTML =
      '<div class="mxd2-builder">'
      + _v2TopBarHTML(tpl, statusL, statusCls)
      + '<div class="mxd2-layout">'
      + '<div class="mxd2-palette" id="mxd2-pal"' + (_v2MobPanel === 'pal' ? ' data-mob="active"' : '') + '>' + _v2PaletteHTML() + '</div>'
      + '<div class="mxd2-canvas-wrap" id="mxd2-canvas"' + (_v2MobPanel === 'canvas' ? ' data-mob="active"' : '') + '>' + _v2CanvasHTML() + '</div>'
      + '<div class="mxd2-props-panel" id="mxd2-props"' + (_v2MobPanel === 'props' ? ' data-mob="active"' : '') + '>' + _v2PropsPanelHTML() + '</div>'
      + '</div>'
      + _v2MobNavHTML()
      + '</div>';
  }

  function _v2TopBarHTML(tpl, statusL, statusCls) {
    var e = _e;
    return '<div class="mxd2-topbar">'
      + '<div class="mxd2-topbar-left">'
      + '<button class="mxd2-back-btn" onclick="MX.Pages.MxDoc._closeBuilder()">'
      + '<i class="fas fa-arrow-left"></i><span>MX Doc</span></button>'
      + '<span class="mxd2-topbar-div"></span>'
      + '<input class="mxd2-title-inp" id="mxd2-title" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…"'
      + ' oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      + '<span class="mxd2-badge ' + statusCls + '">' + statusL + '</span>'
      + '</div>'
      + '<div class="mxd2-topbar-right">'
      + '<button class="mxd2-icon-btn" id="mxd2-undo" onclick="MX.Pages.MxDoc._v2Undo()" title="Annuler" disabled><i class="fas fa-rotate-left"></i></button>'
      + '<button class="mxd2-icon-btn" id="mxd2-redo" onclick="MX.Pages.MxDoc._v2Redo()" title="Rétablir" disabled><i class="fas fa-rotate-right"></i></button>'
      + '<button class="mxd2-icon-btn" onclick="MX.Pages.MxDoc._v2Preview()" title="Aperçu"><i class="fas fa-play"></i></button>'
      + '<button class="mxd2-save-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'draft\')"><i class="fas fa-floppy-disk"></i><span> Enregistrer</span></button>'
      + '<button class="mxd2-pub-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'published\')"><i class="fas fa-globe"></i><span> Publier</span></button>'
      + '</div>'
      + '</div>';
  }

  function _v2PaletteHTML() {
    var h = '<div class="mxd2-pal-hdr"><i class="fas fa-shapes"></i> Éléments</div><div class="mxd2-pal-list">';
    BLOCK_TYPES.forEach(function (bt) {
      h += '<div class="mxd2-pal-item" draggable="true"'
        + ' ondragstart="MX.Pages.MxDoc._v2PalDragStart(event,\'' + bt.type + '\')"'
        + ' ondragend="MX.Pages.MxDoc._v2DragEnd(event)"'
        + ' onclick="MX.Pages.MxDoc._v2PalClick(\'' + bt.type + '\')"'
        + ' title="' + bt.l + '" style="--bt-color:' + bt.color + '">'
        + '<span class="mxd2-pal-icon"><i class="fas ' + bt.icon + '"></i></span>'
        + '<span class="mxd2-pal-label">' + bt.l + '</span>'
        + '</div>';
    });
    h += '</div>';
    return h;
  }

  function _v2CanvasHTML() {
    var tpl    = _builderTpl || {};
    var e      = _e;
    var accent = e(tpl.color || '#8B5CF6');
    var icon   = e(tpl.icon  || 'fa-file-lines');
    var h = '<div class="mxd2-doc-hdr-card" style="--doc-accent:' + accent + '">'
      + '<div class="mxd2-doc-hdr-icon" style="color:' + accent + '"><i class="fas ' + icon + '"></i></div>'
      + '<div class="mxd2-doc-hdr-info">'
      + '<div class="mxd2-doc-hdr-title">' + e(tpl.title || 'Nouveau modèle') + '</div>'
      + '<div class="mxd2-doc-hdr-desc">' + e(tpl.description || 'Cliquez sur Propriétés du document →') + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="mxd2-sections" id="mxd2-sections">';
    _builderSecs.forEach(function (sec, sIdx) { h += _v2SectionHTML(sec, sIdx); });
    h += '</div>'
      + '<button class="mxd2-add-sec-btn" onclick="MX.Pages.MxDoc._v2AddSection()">'
      + '<i class="fas fa-plus"></i> Ajouter une section</button>';
    return h;
  }

  function _v2SectionHTML(sec, sIdx) {
    var e     = _e;
    var color = sec.color || SEC_COLORS[sIdx % SEC_COLORS.length];
    var selSec = _v2SelSIdx === sIdx && _v2SelEIdx === null;
    var blocks = sec.blocks || [];
    var h = '<div class="mxd2-section' + (selSec ? ' mxd2-section--sel' : '') + '"'
      + ' data-sidx="' + sIdx + '" style="--sec-color:' + color + '">'
      + '<div class="mxd2-sec-hdr">'
      + '<span class="mxd2-sec-grip" draggable="true"'
      + ' ondragstart="MX.Pages.MxDoc._v2SecDragStart(event,' + sIdx + ')"'
      + ' ondragend="MX.Pages.MxDoc._v2DragEnd(event)"'
      + ' onclick="event.stopPropagation()"><i class="fas fa-grip-lines"></i></span>'
      + '<span class="mxd2-sec-dot" style="background:' + color + '"></span>'
      + '<input class="mxd2-sec-name-inp" value="' + e(sec.label || '') + '" placeholder="Nom de la section…"'
      + ' oninput="MX.Pages.MxDoc._v2SecLabel(' + sIdx + ',this.value)"'
      + ' onclick="event.stopPropagation();MX.Pages.MxDoc._v2SelectSec(' + sIdx + ')">'
      + '<div class="mxd2-sec-hdr-acts">'
      + '<button class="mxd2-sec-act-btn" title="Propriétés" onclick="event.stopPropagation();MX.Pages.MxDoc._v2SelectSec(' + sIdx + ')"><i class="fas fa-sliders"></i></button>'
      + '<button class="mxd2-sec-act-btn mxd2-sec-act-btn--del" title="Supprimer" onclick="event.stopPropagation();MX.Pages.MxDoc._v2DelSection(' + sIdx + ')"><i class="fas fa-trash"></i></button>'
      + '</div>'
      + '</div>'
      + '<div class="mxd2-sec-body"'
      + ' ondragover="event.preventDefault();MX.Pages.MxDoc._v2SecDzOver(event,' + sIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v2SecDzLeave(event)"'
      + ' ondrop="MX.Pages.MxDoc._v2SecDzDrop(event,' + sIdx + ')">';
    blocks.forEach(function (blk, bIdx) { h += _v2ElementRowHTML(blk, sIdx, bIdx); });
    h += '<div class="mxd2-el-dz" data-sidx="' + sIdx + '"'
      + ' ondragover="event.preventDefault();event.stopPropagation();event.currentTarget.classList.add(\'mxd2-el-dz--over\')"'
      + ' ondragleave="event.currentTarget.classList.remove(\'mxd2-el-dz--over\')"'
      + ' ondrop="event.stopPropagation();MX.Pages.MxDoc._v2ElDzDrop(event,' + sIdx + ',' + blocks.length + ')">'
      + '<i class="fas fa-plus-circle"></i> Déposer un élément ici'
      + '</div>'
      + '</div></div>';
    return h;
  }

  function _v2ElementRowHTML(blk, sIdx, bIdx) {
    var e   = _e;
    var bt  = _btInfo(blk.type);
    var sel = _v2SelSIdx === sIdx && _v2SelEIdx === bIdx;
    var previewH = _v2ElPreviewHTML(blk);
    return '<div class="mxd2-el-row' + (sel ? ' mxd2-el-row--sel' : '') + '"'
      + ' data-sidx="' + sIdx + '" data-bidx="' + bIdx + '" draggable="true"'
      + ' ondragstart="MX.Pages.MxDoc._v2ElDragStart(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragend="MX.Pages.MxDoc._v2DragEnd(event)"'
      + ' onclick="MX.Pages.MxDoc._v2SelectEl(' + sIdx + ',' + bIdx + ')">'
      + '<span class="mxd2-el-drag"><i class="fas fa-grip-vertical"></i></span>'
      + '<span class="mxd2-el-icon" style="color:' + bt.color + '"><i class="fas ' + bt.icon + '"></i></span>'
      + '<span class="mxd2-el-label">' + e(blk.label || bt.l) + (blk.required ? '<span class="mxd2-el-req">*</span>' : '') + '</span>'
      + '<div class="mxd2-el-preview">' + previewH + '</div>'
      + '<div class="mxd2-el-acts">'
      + '<button class="mxd2-el-act-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v2MoveEl(' + sIdx + ',' + bIdx + ',-1)" title="Monter"><i class="fas fa-chevron-up"></i></button>'
      + '<button class="mxd2-el-act-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v2MoveEl(' + sIdx + ',' + bIdx + ',1)" title="Descendre"><i class="fas fa-chevron-down"></i></button>'
      + '<button class="mxd2-el-act-btn mxd2-el-act-btn--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v2DelEl(' + sIdx + ',' + bIdx + ')" title="Supprimer"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '</div>';
  }

  function _v2ElPreviewHTML(blk) {
    if (blk.type === 'faitnonfait') return '<span class="mxd2-prev-fait"><i class="fas fa-check"></i> Fait</span><span class="mxd2-prev-nonfait"><i class="fas fa-times"></i> Pas fait</span>';
    if (blk.type === 'ouinon')      return '<span class="mxd2-prev-oui">Oui</span><span class="mxd2-prev-non">Non</span>';
    if (blk.type === 'numerique')   return '<span class="mxd2-prev-num">0' + (blk.unit ? ' ' + _e(blk.unit) : '') + '</span>';
    if (blk.type === 'commentaire') return '<span class="mxd2-prev-text">' + _e(blk.placeholder || 'Commentaire…') + '</span>';
    if (blk.type === 'date')        return '<span class="mxd2-prev-text">jj/mm/aaaa</span>';
    if (blk.type === 'heure')       return '<span class="mxd2-prev-text">hh:mm</span>';
    if (blk.type === 'photo')       return '<span class="mxd2-prev-icon"><i class="fas fa-camera"></i></span>';
    if (blk.type === 'signature')   return '<span class="mxd2-prev-icon"><i class="fas fa-pen-nib"></i></span>';
    if (blk.type === 'titre')       return '<span class="mxd2-prev-titre">' + _e(blk.value || blk.label || 'Titre') + '</span>';
    if (blk.type === 'sstitre')     return '<span class="mxd2-prev-sstitre">' + _e(blk.value || blk.label || 'Sous-titre') + '</span>';
    if (blk.type === 'separator')   return '<span class="mxd2-prev-sep"></span>';
    if (blk.type === 'texte')       return '<span class="mxd2-prev-text">' + _e(blk.value || blk.label || 'Texte…') + '</span>';
    return '';
  }

  // ── V2 PROPS PANEL ──
  function _v2PropsPanelHTML() {
    if (_v2SelSIdx === null) return _v2DocPropsHTML();
    if (_v2SelEIdx === null) return _v2SecPropsHTML();
    return _v2ElPropsHTML();
  }

  function _v2DocPropsHTML() {
    var tpl = _builderTpl || {};
    var e   = _e;
    var freqOpts = Object.keys(FREQ_LABELS).map(function (k) {
      return '<option value="' + k + '"' + (tpl.frequency === k ? ' selected' : '') + '>' + FREQ_LABELS[k] + '</option>';
    }).join('');
    var ICONS = ['fa-file-lines','fa-file-contract','fa-clipboard-list','fa-file-check',
                 'fa-clipboard-check','fa-file-shield','fa-note-sticky','fa-scroll',
                 'fa-file-alt','fa-book-open','fa-tasks','fa-tools'];
    var iconBtns = ICONS.map(function (ic) {
      return '<button class="mxd2-icon-pick' + (tpl.icon === ic ? ' mxd2-icon-pick--on' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._setBuilderIcon(\'' + ic + '\')" title="' + ic + '">'
        + '<i class="fas ' + ic + '"></i></button>';
    }).join('');
    return '<div class="mxd2-props-type-hdr"><i class="fas fa-file-lines"></i> Propriétés du document</div>'
      + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Description</div>'
      + '<input class="mxd2-prop-inp" id="mxd-bld-desc" value="' + e(tpl.description || '') + '" placeholder="Description du modèle…"'
      + ' oninput="MX.Pages.MxDoc._bldDescChange(this.value)"></div>'
      + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Fréquence</div>'
      + '<select class="mxd2-prop-inp" id="mxd-bld-freq" onchange="MX.Pages.MxDoc._bldFreqChange(this.value)">' + freqOpts + '</select></div>'
      + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Icône</div>'
      + '<div class="mxd2-icon-pick-grid">' + iconBtns + '</div></div>'
      + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Couleur du document</div>'
      + '<input type="color" class="mxd2-color-inp" id="mxd-bld-color" value="' + e(tpl.color || '#8B5CF6') + '"'
      + ' oninput="MX.Pages.MxDoc._bldColorChange(this.value)"></div>';
  }

  function _v2SecPropsHTML() {
    var sec = _builderSecs[_v2SelSIdx];
    if (!sec) return '';
    var e     = _e;
    var color = sec.color || SEC_COLORS[_v2SelSIdx % SEC_COLORS.length];
    var colorBtns = SEC_COLORS.map(function (c) {
      return '<button class="mxd2-color-btn' + (color === c ? ' mxd2-color-btn--on' : '') + '"'
        + ' style="background:' + c + '" onclick="MX.Pages.MxDoc._v2SecColor(' + _v2SelSIdx + ',\'' + c + '\')">'
        + (color === c ? '<i class="fas fa-check"></i>' : '') + '</button>';
    }).join('');
    return '<div class="mxd2-props-type-hdr" style="--bt-color:#6366F1"><i class="fas fa-layer-group"></i> Section</div>'
      + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Nom de la section</div>'
      + '<input class="mxd2-prop-inp" value="' + e(sec.label || '') + '" placeholder="Nom…"'
      + ' oninput="MX.Pages.MxDoc._v2SecLabelSync(' + _v2SelSIdx + ',this.value)"></div>'
      + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Couleur</div>'
      + '<div class="mxd2-color-grid">' + colorBtns + '</div></div>'
      + '<div class="mxd2-props-actions">'
      + '<button class="mxd2-del-btn" onclick="MX.Pages.MxDoc._v2DelSection(' + _v2SelSIdx + ')">'
      + '<i class="fas fa-trash"></i> Supprimer la section</button></div>';
  }

  function _v2ElPropsHTML() {
    var sec = _builderSecs[_v2SelSIdx];
    if (!sec) return '';
    var blk = sec.blocks[_v2SelEIdx];
    if (!blk) return '';
    var e        = _e;
    var bt       = _btInfo(blk.type);
    var isStatic = STATIC_TYPES.indexOf(blk.type) >= 0;

    var h = '<div class="mxd2-props-type-hdr" style="--bt-color:' + bt.color + '">'
      + '<i class="fas ' + bt.icon + '"></i> ' + bt.l + '</div>';

    if (blk.type !== 'separator') {
      h += '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Libellé</div>'
        + '<input class="mxd2-prop-inp" value="' + e(blk.label || '') + '" placeholder="Libellé du champ…"'
        + ' oninput="MX.Pages.MxDoc._v2PropChange(\'label\',this.value)"></div>';
    }

    if (blk.type === 'titre' || blk.type === 'sstitre' || blk.type === 'texte') {
      h += '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Contenu</div>'
        + '<textarea class="mxd2-prop-textarea" rows="3" oninput="MX.Pages.MxDoc._v2PropChange(\'value\',this.value)">' + e(blk.value || '') + '</textarea></div>';
    }

    if (!isStatic) {
      var RESP_TYPES = ['faitnonfait','ouinon','numerique','commentaire','date','heure','photo','signature'];
      h += '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Type de réponse</div><div class="mxd2-resp-types">';
      RESP_TYPES.forEach(function (t) {
        var rbt = _btInfo(t);
        h += '<button class="mxd2-resp-type-btn' + (blk.type === t ? ' mxd2-resp-type-btn--on' : '') + '"'
          + ' style="--bt-color:' + rbt.color + '"'
          + ' onclick="MX.Pages.MxDoc._v2ChangeType(\'' + t + '\')" title="' + rbt.l + '">'
          + '<i class="fas ' + rbt.icon + '"></i><span>' + rbt.l + '</span></button>';
      });
      h += '</div></div>';
      h += '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Comportement</div>'
        + '<div class="mxd2-toggle-list">'
        + _v2ToggleRowHTML('Champ obligatoire', 'required', !!blk.required)
        + '</div></div>';
    }

    if (blk.type === 'numerique') {
      h += '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Unité</div>'
        + '<input class="mxd2-prop-inp" value="' + e(blk.unit || '') + '" placeholder="kWh, m³, °C…"'
        + ' oninput="MX.Pages.MxDoc._v2PropChange(\'unit\',this.value)"></div>'
        + '<div class="mxd2-prop-row2">'
        + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Min</div>'
        + '<input type="number" class="mxd2-prop-inp" value="' + (blk.min !== undefined ? blk.min : '') + '"'
        + ' oninput="MX.Pages.MxDoc._v2PropChangeNum(\'min\',this.value)"></div>'
        + '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Max</div>'
        + '<input type="number" class="mxd2-prop-inp" value="' + (blk.max !== undefined ? blk.max : '') + '"'
        + ' oninput="MX.Pages.MxDoc._v2PropChangeNum(\'max\',this.value)"></div>'
        + '</div>';
    }

    if (blk.type === 'commentaire') {
      h += '<div class="mxd2-prop-group"><div class="mxd2-prop-label">Texte d\'aide</div>'
        + '<input class="mxd2-prop-inp" value="' + e(blk.placeholder || '') + '" placeholder="Ex: Décrivez l\'état observé…"'
        + ' oninput="MX.Pages.MxDoc._v2PropChange(\'placeholder\',this.value)"></div>';
    }

    h += '<div class="mxd2-props-actions">'
      + '<button class="mxd2-del-btn" onclick="MX.Pages.MxDoc._v2DelEl(' + _v2SelSIdx + ',' + _v2SelEIdx + ')">'
      + '<i class="fas fa-trash"></i> Supprimer l\'élément</button></div>';
    return h;
  }

  function _v2ToggleRowHTML(label, key, checked) {
    return '<label class="mxd2-toggle-row">'
      + '<span class="mxd2-toggle-row-label">' + label + '</span>'
      + '<span class="mxd2-toggle' + (checked ? ' mxd2-toggle--on' : '') + '"'
      + ' onclick="MX.Pages.MxDoc._v2ToggleProp(\'' + key + '\',this)">'
      + '<span class="mxd2-toggle-knob"></span></span></label>';
  }

  function _v2MobNavHTML() {
    var p = _v2MobPanel;
    return '<div class="mxd2-mob-nav">'
      + '<button class="mxd2-mob-btn' + (p === 'pal'    ? ' mxd2-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v2MobSwitch(\'pal\')">'
      + '<i class="fas fa-shapes"></i><span>Éléments</span></button>'
      + '<button class="mxd2-mob-btn' + (p === 'canvas' ? ' mxd2-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v2MobSwitch(\'canvas\')">'
      + '<i class="fas fa-file-lines"></i><span>Document</span></button>'
      + '<button class="mxd2-mob-btn' + (p === 'props'  ? ' mxd2-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v2MobSwitch(\'props\')">'
      + '<i class="fas fa-sliders"></i><span>Propriétés</span></button>'
      + '</div>';
  }

  // ── V2 REFRESH HELPERS ──
  function _v2RefreshCanvas() {
    var c = document.getElementById('mxd2-canvas');
    if (c) c.innerHTML = _v2CanvasHTML();
  }

  function _v2RefreshProps() {
    var p = document.getElementById('mxd2-props');
    if (p) p.innerHTML = _v2PropsPanelHTML();
  }

  function _v2RefreshSection(sIdx) {
    var existing = document.querySelector('.mxd2-section[data-sidx="' + sIdx + '"]');
    if (!existing) { _v2RefreshCanvas(); return; }
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = _v2SectionHTML(sec, sIdx);
    existing.replaceWith(tmp.firstChild);
  }

  function _v2RefreshEl(sIdx, bIdx) {
    var existing = document.querySelector('.mxd2-el-row[data-sidx="' + sIdx + '"][data-bidx="' + bIdx + '"]');
    if (!existing) { _v2RefreshSection(sIdx); return; }
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var blk = sec.blocks[bIdx];
    if (!blk) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = _v2ElementRowHTML(blk, sIdx, bIdx);
    existing.replaceWith(tmp.firstChild);
  }

  function _v2UpdateUndoRedo() {
    var undo = document.getElementById('mxd2-undo');
    var redo = document.getElementById('mxd2-redo');
    if (undo) undo.disabled = _v2History.length === 0;
    if (redo) redo.disabled = _v2Future.length  === 0;
  }

  // ── V2 UNDO/REDO ──
  function _v2Push() {
    _v2History.push(JSON.stringify(_builderSecs));
    if (_v2History.length > 50) _v2History.shift();
    _v2Future = [];
    _v2UpdateUndoRedo();
  }

  function _v2Undo() {
    if (!_v2History.length) return;
    _v2Future.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2History.pop());
    _v2SelSIdx = null; _v2SelEIdx = null;
    _v2RefreshCanvas(); _v2RefreshProps(); _v2UpdateUndoRedo();
  }

  function _v2Redo() {
    if (!_v2Future.length) return;
    _v2History.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2Future.pop());
    _v2SelSIdx = null; _v2SelEIdx = null;
    _v2RefreshCanvas(); _v2RefreshProps(); _v2UpdateUndoRedo();
  }

  function _v2Preview() {
    if (!_builderTpl) return;
    var previewTpl = JSON.parse(JSON.stringify(_builderTpl));
    previewTpl.sections = JSON.parse(JSON.stringify(_builderSecs));
    _execTemplate  = previewTpl;
    _execInstance  = null;
    _execResponses = {};
    _execMode      = true;
    var mc = document.getElementById('main-content');
    if (!mc) return;
    _renderExec(mc);
    var backBtn = mc.querySelector('.mxd-exec-back');
    if (backBtn) {
      backBtn.onclick = function () {
        _execMode     = false;
        _execTemplate = null;
        var mc2 = document.getElementById('main-content');
        if (mc2) _renderBuilderV2(mc2);
      };
    }
  }

  // ── V2 SELECTION ──
  function _v2SelectSec(sIdx) {
    _v2SelSIdx = sIdx; _v2SelEIdx = null;
    document.querySelectorAll('.mxd2-section').forEach(function (el) {
      el.classList.toggle('mxd2-section--sel', parseInt(el.getAttribute('data-sidx')) === sIdx);
    });
    document.querySelectorAll('.mxd2-el-row--sel').forEach(function (el) { el.classList.remove('mxd2-el-row--sel'); });
    _v2RefreshProps();
    if (window.innerWidth < 768) _v2MobSwitch('props');
  }

  function _v2SelectEl(sIdx, bIdx) {
    _v2SelSIdx = sIdx; _v2SelEIdx = bIdx;
    document.querySelectorAll('.mxd2-section--sel').forEach(function (el) { el.classList.remove('mxd2-section--sel'); });
    document.querySelectorAll('.mxd2-el-row').forEach(function (el) {
      el.classList.toggle('mxd2-el-row--sel',
        parseInt(el.getAttribute('data-sidx')) === sIdx && parseInt(el.getAttribute('data-bidx')) === bIdx);
    });
    _v2RefreshProps();
    if (window.innerWidth < 768) _v2MobSwitch('props');
  }

  // ── V2 SECTION MUTATIONS ──
  function _v2AddSection() {
    _v2Push();
    _builderSecs.push({ id: _uid(), label: 'Nouvelle section', color: SEC_COLORS[_builderSecs.length % SEC_COLORS.length], blocks: [] });
    _v2SelSIdx = _builderSecs.length - 1; _v2SelEIdx = null;
    _v2RefreshCanvas(); _v2RefreshProps();
    setTimeout(function () {
      var lastSec = document.querySelector('.mxd2-section[data-sidx="' + (_builderSecs.length - 1) + '"]');
      if (lastSec) lastSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function _v2DelSection(sIdx) {
    if (_builderSecs.length <= 1) { MX.toast('Au moins une section est requise'); return; }
    _v2Push();
    _builderSecs.splice(sIdx, 1);
    _v2SelSIdx = null; _v2SelEIdx = null;
    _v2RefreshCanvas(); _v2RefreshProps();
  }

  function _v2SecLabel(sIdx, v) {
    if (_builderSecs[sIdx]) _builderSecs[sIdx].label = v;
  }

  function _v2SecLabelSync(sIdx, v) {
    _v2SecLabel(sIdx, v);
    var inp = document.querySelector('.mxd2-section[data-sidx="' + sIdx + '"] .mxd2-sec-name-inp');
    if (inp && inp !== document.activeElement) inp.value = v;
  }

  function _v2SecColor(sIdx, color) {
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].color = color;
    var sec = document.querySelector('.mxd2-section[data-sidx="' + sIdx + '"]');
    if (sec) {
      sec.style.setProperty('--sec-color', color);
      var dot = sec.querySelector('.mxd2-sec-dot');
      if (dot) dot.style.background = color;
    }
    _v2RefreshProps();
  }

  // ── V2 ELEMENT MUTATIONS ──
  function _v2PalClick(type) {
    var targetSIdx = (_v2SelSIdx !== null) ? _v2SelSIdx : 0;
    var sec = _builderSecs[targetSIdx];
    if (!sec) return;
    _v2Push();
    var bt  = _btInfo(type);
    var blk = { id: _uid(), type: type, label: bt.l };
    sec.blocks.push(blk);
    _v2SelSIdx = targetSIdx; _v2SelEIdx = sec.blocks.length - 1;
    _v2RefreshSection(targetSIdx); _v2RefreshProps();
    setTimeout(function () {
      var el = document.querySelector('.mxd2-el-row--sel');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function _v2DelEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v2Push();
    sec.blocks.splice(bIdx, 1);
    if (_v2SelSIdx === sIdx && _v2SelEIdx === bIdx) { _v2SelSIdx = sIdx; _v2SelEIdx = null; }
    _v2RefreshSection(sIdx); _v2RefreshProps();
  }

  function _v2MoveEl(sIdx, bIdx, dir) {
    var sec    = _builderSecs[sIdx];
    if (!sec) return;
    var newIdx = bIdx + dir;
    if (newIdx < 0 || newIdx >= sec.blocks.length) return;
    _v2Push();
    var tmp = sec.blocks[bIdx];
    sec.blocks[bIdx] = sec.blocks[newIdx];
    sec.blocks[newIdx] = tmp;
    _v2SelSIdx = sIdx; _v2SelEIdx = newIdx;
    _v2RefreshSection(sIdx); _v2RefreshProps();
  }

  // ── V2 PROP MUTATIONS ──
  function _v2PropChange(key, value) {
    if (_v2SelSIdx === null || _v2SelEIdx === null) return;
    var sec = _builderSecs[_v2SelSIdx];
    if (!sec) return;
    var blk = sec.blocks[_v2SelEIdx];
    if (!blk) return;
    blk[key] = value;
    if (key === 'label') {
      var el = document.querySelector('.mxd2-el-row[data-sidx="' + _v2SelSIdx + '"][data-bidx="' + _v2SelEIdx + '"] .mxd2-el-label');
      if (el) el.innerHTML = _e(value) + (blk.required ? '<span class="mxd2-el-req">*</span>' : '');
    } else if (key === 'required') {
      _v2RefreshEl(_v2SelSIdx, _v2SelEIdx);
    }
  }

  function _v2PropChangeNum(key, strVal) {
    var n = parseFloat(strVal);
    _v2PropChange(key, isNaN(n) ? undefined : n);
  }

  function _v2ChangeType(newType) {
    if (_v2SelSIdx === null || _v2SelEIdx === null) return;
    var sec = _builderSecs[_v2SelSIdx];
    if (!sec) return;
    var blk = sec.blocks[_v2SelEIdx];
    if (!blk) return;
    _v2Push();
    var oldBt = _btInfo(blk.type);
    blk.type  = newType;
    var newBt = _btInfo(newType);
    if (!blk.label || blk.label === oldBt.l) blk.label = newBt.l;
    _v2RefreshEl(_v2SelSIdx, _v2SelEIdx);
    _v2RefreshProps();
  }

  function _v2ToggleProp(key, el) {
    var isOn = el.classList.toggle('mxd2-toggle--on');
    _v2PropChange(key, isOn);
  }

  // ── V2 DRAG & DROP ──
  function _v2PalDragStart(event, type) {
    _v2PalDragType = type; _v2ElDragSrc = null; _v2SecDragSrc = null;
    event.dataTransfer.effectAllowed = 'copy';
  }

  function _v2ElDragStart(event, sIdx, bIdx) {
    _v2ElDragSrc = { sIdx: sIdx, bIdx: bIdx }; _v2PalDragType = null; _v2SecDragSrc = null;
    event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  }

  function _v2SecDragStart(event, sIdx) {
    _v2SecDragSrc = sIdx; _v2ElDragSrc = null; _v2PalDragType = null;
    event.dataTransfer.effectAllowed = 'move';
  }

  function _v2DragEnd(event) {
    _v2PalDragType = null; _v2ElDragSrc = null; _v2SecDragSrc = null;
    document.querySelectorAll('.mxd2-el-dz--over,.mxd2-sec-body--dz-over').forEach(function (el) {
      el.classList.remove('mxd2-el-dz--over'); el.classList.remove('mxd2-sec-body--dz-over');
    });
  }

  function _v2ElDzDrop(event, sIdx, bIdx) {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.classList.remove('mxd2-el-dz--over');
    if (_v2PalDragType) {
      _v2Push();
      var bt  = _btInfo(_v2PalDragType);
      var blk = { id: _uid(), type: _v2PalDragType, label: bt.l };
      var sec = _builderSecs[sIdx];
      if (!sec) return;
      sec.blocks.splice(bIdx, 0, blk);
      _v2SelSIdx = sIdx; _v2SelEIdx = bIdx;
      _v2RefreshSection(sIdx); _v2RefreshProps();
    } else if (_v2ElDragSrc) {
      _v2Push();
      var srcSec = _builderSecs[_v2ElDragSrc.sIdx];
      var dstSec = _builderSecs[sIdx];
      if (!srcSec || !dstSec) return;
      var blk2 = srcSec.blocks.splice(_v2ElDragSrc.bIdx, 1)[0];
      var ins  = bIdx;
      if (_v2ElDragSrc.sIdx === sIdx && _v2ElDragSrc.bIdx < bIdx) ins--;
      dstSec.blocks.splice(Math.max(0, ins), 0, blk2);
      _v2SelSIdx = sIdx; _v2SelEIdx = Math.max(0, ins);
      _v2RefreshCanvas(); _v2RefreshProps();
    }
  }

  function _v2SecDzOver(event, sIdx) {
    if (!_v2PalDragType && !_v2ElDragSrc) return;
    event.preventDefault();
    event.currentTarget.classList.add('mxd2-sec-body--dz-over');
  }

  function _v2SecDzLeave(event) {
    event.currentTarget.classList.remove('mxd2-sec-body--dz-over');
  }

  function _v2SecDzDrop(event, sIdx) {
    event.preventDefault();
    event.currentTarget.classList.remove('mxd2-sec-body--dz-over');
    // Only handle if not caught by the inner drop zone
  }

  // ── V2 MOBILE ──
  function _v2MobSwitch(panel) {
    _v2MobPanel = panel;
    var ids = { pal: 'mxd2-pal', canvas: 'mxd2-canvas', props: 'mxd2-props' };
    Object.keys(ids).forEach(function (k) {
      var el = document.getElementById(ids[k]);
      if (el) el.setAttribute('data-mob', k === panel ? 'active' : '');
    });
    document.querySelectorAll('.mxd2-mob-btn').forEach(function (btn) {
      var panels = ['pal','canvas','props'];
      var idx    = Array.from(btn.parentNode.children).indexOf(btn);
      btn.classList.toggle('mxd2-mob-btn--on', panels[idx] === panel);
    });
  }

  // ─────────────────────────────────────────────────────
  // V6 BUILDER — HYBRIDE MAINTIX (WYSIWYG DOCUMENT UX)
  // ─────────────────────────────────────────────────────

  var V6_SECTION_COLORS = ['#6366F1','#8B5CF6','#EC4899','#EF4444','#F97316','#F59E0B','#22C55E','#0EA5E9','#14B8A6','#64748B'];

  var V6_COLS = [
    { key: 'valeur',      icon: 'fa-hashtag',       l: 'Valeur',       color: '#0EA5E9', hasUnit: true },
    { key: 'etat',        icon: 'fa-circle-check',  l: 'État',         color: '#22C55E' },
    { key: 'ouinon',      icon: 'fa-toggle-on',     l: 'Oui / Non',    color: '#10B981' },
    { key: 'commentaire', icon: 'fa-comment-lines', l: 'Commentaire',  color: '#F59E0B' },
    { key: 'photo',       icon: 'fa-camera',        l: 'Photo',        color: '#EC4899' },
    { key: 'signature',   icon: 'fa-pen-nib',       l: 'Signature',    color: '#A855F7' },
    { key: 'date',        icon: 'fa-calendar',      l: 'Date',         color: '#F97316' },
    { key: 'heure',       icon: 'fa-clock',         l: 'Heure',        color: '#EF4444' },
  ];

  // V7 intelligent column types
  var V7_COL_TYPES = [
    { key:'texte',       icon:'fa-font',         l:'Texte',                   color:'#64748B' },
    { key:'int',         icon:'fa-hashtag',       l:'Valeur numérique',        color:'#0EA5E9', hasUnit:true, hasMinMax:true },
    { key:'decimal',     icon:'fa-decimal',       l:'Valeur décimale',         color:'#38BDF8', hasUnit:true, hasMinMax:true, hasDecimals:true },
    { key:'ouinon',      icon:'fa-toggle-on',     l:'Oui / Non',               color:'#10B981' },
    { key:'etatcheck',   icon:'fa-check',         l:'✔ / ❌',                 color:'#22C55E' },
    { key:'conforme',    icon:'fa-circle-check',  l:'Conforme / Non conforme', color:'#16A34A' },
    { key:'marchearret', icon:'fa-power-off',     l:'Marche / Arrêt',          color:'#F97316' },
    { key:'liste',       icon:'fa-list',          l:'Liste déroulante',        color:'#8B5CF6' },
    { key:'date',        icon:'fa-calendar',      l:'Date',                    color:'#F59E0B' },
    { key:'heure',       icon:'fa-clock',         l:'Heure',                   color:'#EF4444' },
    { key:'photo',       icon:'fa-camera',        l:'Photo',                   color:'#EC4899' },
    { key:'signature',   icon:'fa-pen-nib',       l:'Signature',               color:'#A855F7' },
    { key:'commentaire', icon:'fa-comment-lines', l:'Commentaire',             color:'#F59E0B' },
    { key:'barcode',     icon:'fa-barcode',       l:'Code-barres',             color:'#475569' },
    { key:'qrcode',      icon:'fa-qrcode',        l:'QR Code',                color:'#0D9488' },
    { key:'compteur',    icon:'fa-calculator',    l:'Compteur',                color:'#0EA5E9' },
    { key:'temps',       icon:'fa-stopwatch',     l:'Temps',                   color:'#6366F1' },
    { key:'pourcent',    icon:'fa-percent',       l:'Pourcentage',             color:'#F97316' },
    { key:'monnaie',     icon:'fa-euro-sign',     l:'Monnaie',                 color:'#22C55E' },
  ];

  // AI keyword → column type suggestions
  var V7_AI_KW = {
    'ph':          { type:'decimal', unit:'pH', min:0, max:14, decimals:1 },
    'température': { type:'decimal', unit:'°C' },
    'temp':        { type:'decimal', unit:'°C' },
    'pression':    { type:'decimal', unit:'bar' },
    'niveau':      { type:'decimal', unit:'m' },
    'débit':       { type:'decimal', unit:'m³/h' },
    'intensité':   { type:'decimal', unit:'A' },
    'tension':     { type:'decimal', unit:'V' },
    'chlore':      { type:'decimal', unit:'mg/L' },
    'sel':         { type:'decimal', unit:'g/L' },
    'ppm':         { type:'decimal', unit:'ppm' },
    'photo':       { type:'photo' },
    'état':        { type:'etatcheck' },
    'etat':        { type:'etatcheck' },
    'conforme':    { type:'conforme' },
    'marche':      { type:'marchearret' },
    'signature':   { type:'signature' },
    'commentaire': { type:'commentaire' },
    'remarque':    { type:'commentaire' },
    'date':        { type:'date' },
    'heure':       { type:'heure' },
    'oui':         { type:'ouinon' },
    'non':         { type:'ouinon' },
    'pompe':       { type:'marchearret' },
    'vanne':       { type:'marchearret' },
    'bac':         { type:'etatcheck' },
    'fuite':       { type:'etatcheck' },
    'chasse':      { type:'etatcheck' },
    'ballon':      { type:'etatcheck' },
    'filtre':      { type:'etatcheck' },
  };

  function _renderBuilderV6(mc) {
    var tpl = _builderTpl || {};
    mc.innerHTML = '<div class="mxd6-wrap" id="mxd6-root">'
      + _v6TopBarHTML(tpl)
      + '<div class="mxd6-layout" id="mxd6-layout">'
      +   '<aside class="mxd6-palette" id="mxd6-palette">' + _v6PaletteHTML() + '</aside>'
      +   '<main class="mxd6-canvas" id="mxd6-canvas"'
      +     ' ondragover="event.preventDefault();MX.Pages.MxDoc._v6CanvasDzOver(event)"'
      +     ' ondrop="MX.Pages.MxDoc._v6CanvasDzDrop(event)">'
      +     _v6CanvasInnerHTML()
      +   '</main>'
      +   '<aside class="mxd6-props" id="mxd6-props">' + _v6PropsPanelHTML() + '</aside>'
      + '</div>'
      + _v6MobBarHTML()
      + '</div>';
    _v6UpdateUndoRedo();
  }

  function _v6TopBarHTML(tpl) {
    var e = _e;
    var status = tpl.status || 'draft';
    var badgeLabel = STATUS_LABELS[status] || 'Brouillon';
    var badgeCls = status === 'published' ? 'mxd6-badge--pub' : status === 'archived' ? 'mxd6-badge--arch' : 'mxd6-badge--draft';
    return '<header class="mxd6-topbar">'
      + '<div class="mxd6-topbar-l">'
      +   '<button class="mxd6-back-btn" onclick="MX.Pages.MxDoc._closeBuilder()" title="Retour"><i class="fa-solid fa-arrow-left"></i></button>'
      +   '<input class="mxd6-title-inp" id="mxd6-title" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…" oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      +   '<span class="mxd6-status-badge ' + badgeCls + '">' + badgeLabel + '</span>'
      + '</div>'
      + '<div class="mxd6-topbar-c">'
      +   '<button class="mxd6-ud-btn" id="mxd6-undo" onclick="MX.Pages.MxDoc._v6Undo()" disabled title="Annuler"><i class="fa-solid fa-rotate-left"></i></button>'
      +   '<button class="mxd6-ud-btn" id="mxd6-redo" onclick="MX.Pages.MxDoc._v6Redo()" disabled title="Rétablir"><i class="fa-solid fa-rotate-right"></i></button>'
      + '</div>'
      + '<div class="mxd6-topbar-r">'
      +   '<button class="mxd6-topbar-btn mxd6-topbar-btn--ghost" onclick="MX.Pages.MxDoc._v6Preview()"><i class="fa-regular fa-eye"></i><span> Aperçu</span></button>'
      +   '<button class="mxd6-topbar-btn mxd6-topbar-btn--save" onclick="MX.Pages.MxDoc._saveBuilder()"><i class="fa-solid fa-floppy-disk"></i><span> Enregistrer</span></button>'
      +   '<button class="mxd6-topbar-btn mxd6-topbar-btn--pub" onclick="MX.Pages.MxDoc._saveBuilder(\'published\')"><i class="fa-solid fa-rocket"></i><span> Publier</span></button>'
      + '</div>'
      + '</header>';
  }

  function _v6PaletteHTML() {
    var e = _e;
    var tab = _v7PalTab;
    var h = '<div class="mxd6-pal-inner">';
    // Tab bar
    h += '<div class="mxd7-pal-tabs">'
      + '<button class="mxd7-pal-tab' + (tab === 'types' ? ' mxd7-pal-tab--on' : '') + '" onclick="MX.Pages.MxDoc._v7SetPalTab(\'types\')"><i class="fa-solid fa-table-columns"></i> Types</button>'
      + '<button class="mxd7-pal-tab' + (tab === 'library' ? ' mxd7-pal-tab--on' : '') + '" onclick="MX.Pages.MxDoc._v7SetPalTab(\'library\')"><i class="fa-solid fa-book"></i> Bibliothèque</button>'
      + '</div>';

    if (tab === 'types') {
      h += '<p class="mxd6-pal-label">TYPES DE COLONNES</p>';
      V7_COL_TYPES.forEach(function(c) {
        h += '<div class="mxd6-pal-card" draggable="true"'
          + ' ondragstart="MX.Pages.MxDoc._v7TypeDragStart(event,' + JSON.stringify(c.key) + ')"'
          + ' onclick="MX.Pages.MxDoc._v7TypeClick(' + JSON.stringify(c.key) + ')">'
          + '<span class="mxd6-pal-ic" style="background:' + c.color + '22;color:' + c.color + '"><i class="fa-solid ' + c.icon + '"></i></span>'
          + '<span class="mxd6-pal-lbl">' + e(c.l) + '</span>'
          + '</div>';
      });
    } else {
      // Library tab
      h += '<button class="mxd7-newcol-btn" onclick="MX.Pages.MxDoc._v7OpenColModal(null)">'
        + '<i class="fa-solid fa-plus"></i> Nouvelle colonne</button>';
      h += '<button class="mxd7-ai-btn" onclick="MX.Pages.MxDoc._v7OpenAIModal()">'
        + '<i class="fa-solid fa-wand-magic-sparkles"></i> Générer les colonnes</button>';
      if (!_colLibrary.length) {
        h += '<div class="mxd7-lib-empty"><i class="fa-regular fa-folder-open"></i><p>Aucune colonne sauvegardée.<br>Cliquez <strong>Nouvelle colonne</strong> pour commencer.</p></div>';
      } else {
        h += '<p class="mxd6-pal-label">MES COLONNES</p>';
        _colLibrary.forEach(function(col) {
          var ct = _v7TypeDef(col.type);
          var ic = ct ? ct.icon : 'fa-columns';
          var color = col.color || (ct ? ct.color : '#64748B');
          var emoji = col.icon || '';
          h += '<div class="mxd6-pal-card mxd7-lib-card" draggable="true"'
            + ' ondragstart="MX.Pages.MxDoc._v7LibDragStart(event,' + JSON.stringify(col.id) + ')"'
            + ' onclick="MX.Pages.MxDoc._v7LibClick(' + JSON.stringify(col.id) + ')">'
            + '<span class="mxd6-pal-ic mxd7-lib-ic" style="background:' + color + '22;color:' + color + '">'
            + (emoji ? '<span class="mxd7-col-emoji">' + e(emoji) + '</span>' : '<i class="fa-solid ' + ic + '"></i>')
            + '</span>'
            + '<span class="mxd6-pal-lbl">' + e(col.name || '—') + '</span>'
            + '<button class="mxd7-lib-edit" onclick="event.stopPropagation();MX.Pages.MxDoc._v7OpenColModal(' + JSON.stringify(col.id) + ')" title="Modifier"><i class="fa-regular fa-pen-to-square"></i></button>'
            + '</div>';
        });
      }
    }

    h += '</div>';
    h += '<button class="mxd6-add-sec-pal" onclick="MX.Pages.MxDoc._v6AddSection()"><i class="fa-solid fa-plus"></i> Nouvelle section</button>';
    return h;
  }

  function _v6CanvasInnerHTML() {
    if (!_builderSecs.length) {
      return '<div class="mxd6-canvas-empty">'
        + '<i class="fa-regular fa-file-lines fa-2x"></i>'
        + '<p>Ajoutez une première section pour commencer</p>'
        + '<button class="mxd6-cta-sec" onclick="MX.Pages.MxDoc._v6AddSection()"><i class="fa-solid fa-plus"></i> Nouvelle section</button>'
        + '</div>';
    }
    var h = '<div class="mxd6-canvas-inner">';
    _builderSecs.forEach(function(sec, sIdx) { h += _v6SectionHTML(sec, sIdx); });
    h += '<button class="mxd6-add-sec-row" onclick="MX.Pages.MxDoc._v6AddSection()"><i class="fa-solid fa-plus"></i> Ajouter une section</button>';
    h += '</div>';
    return h;
  }

  function _v6SectionHTML(sec, sIdx) {
    var e = _e;
    var color = sec.color || '#6366F1';
    var collapsed = !!_v6SecCollapsed[sIdx];
    var selected = (_v6SelSIdx === sIdx && _v6SelBIdx === null);
    var isTable = !!sec.rows;
    var cnt = isTable ? (sec.rows || []).length : (sec.blocks || []).length;
    var h = '<div class="mxd6-sec' + (selected ? ' mxd6-sec--sel' : '') + '" id="mxd6-sec-' + sIdx + '"'
      + ' ondragover="event.preventDefault();MX.Pages.MxDoc._v6SecDzOver(event,' + sIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v6SecDzLeave(event,' + sIdx + ')"'
      + ' ondrop="MX.Pages.MxDoc._v6SecDzDrop(event,' + sIdx + ')">'
      + '<div class="mxd6-sec-hd" style="border-left:4px solid ' + color + '" onclick="MX.Pages.MxDoc._v6SelectSec(' + sIdx + ')">'
      +   '<i class="mxd6-sec-dh fa-solid fa-grip-vertical" draggable="true"'
      +     ' ondragstart="event.stopPropagation();MX.Pages.MxDoc._v6SecDragStart(event,' + sIdx + ')"'
      +     ' onmousedown="event.stopPropagation()"></i>'
      +   '<span class="mxd6-sec-name" contenteditable="true"'
      +     ' onclick="event.stopPropagation()"'
      +     ' onblur="MX.Pages.MxDoc._v6SecLabelChange(' + sIdx + ',this)"'
      +     ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur()}"'
      +     '>' + e(sec.label || 'Section') + '</span>'
      +   '<span class="mxd6-sec-cnt">' + cnt + '</span>'
      +   '<div class="mxd6-sec-hd-acts">'
      +     '<button class="mxd6-sec-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DupSection(' + sIdx + ')" title="Dupliquer"><i class="fa-regular fa-copy"></i></button>'
      +     '<button class="mxd6-sec-act mxd6-sec-act--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DelSection(' + sIdx + ')" title="Supprimer"><i class="fa-regular fa-trash"></i></button>'
      +   '</div>'
      +   '<button class="mxd6-sec-toggle" onclick="event.stopPropagation();MX.Pages.MxDoc._v6ToggleCollapse(' + sIdx + ')">'
      +     '<i class="fa-solid fa-chevron-' + (collapsed ? 'down' : 'up') + '"></i>'
      +   '</button>'
      + '</div>';
    if (!collapsed) {
      h += '<div class="mxd6-sec-bd">';
      if (isTable) {
        h += _v6TableHTML(sec, sIdx);
      } else {
        var blks = sec.blocks || [];
        if (!blks.length) {
          h += '<div class="mxd6-sec-empty" ondragover="event.preventDefault()" ondrop="MX.Pages.MxDoc._v6RowDzDrop(event,' + sIdx + ',0)">'
            + '<i class="fa-regular fa-plus-circle"></i> Glissez un composant ici ou cliquez <strong>Ajouter une ligne</strong>'
            + '</div>';
        } else {
          blks.forEach(function(blk, bIdx) { h += _v6LegacyRowHTML(blk, sIdx, bIdx); });
        }
        h += '<div class="mxd6-sec-drop-tail"'
          + ' ondragover="event.preventDefault();this.classList.add(\'mxd6-dz-over\')"'
          + ' ondragleave="this.classList.remove(\'mxd6-dz-over\')"'
          + ' ondrop="MX.Pages.MxDoc._v6RowDzDrop(event,' + sIdx + ',' + blks.length + ');this.classList.remove(\'mxd6-dz-over\')"></div>';
        h += '<button class="mxd6-add-line" onclick="MX.Pages.MxDoc._v6AddQuick(' + sIdx + ')">'
          + '<i class="fa-solid fa-plus"></i> Ajouter une ligne</button>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── V6/V7 TABLE RENDERING ──
  function _v6TableHTML(sec, sIdx) {
    var e = _e;
    var cols = sec.columns || [];
    var rows = sec.rows || [];
    var resolved = cols.map(_v7ResolveCol).filter(Boolean);
    var h = '<div class="mxd6-tbl-wrap">';
    if (!cols.length) {
      h += '<div class="mxd6-tbl-nocols"><i class="fa-solid fa-table-columns"></i> Aucune colonne — glissez un type depuis la palette ou cliquez dessus.</div>';
    } else {
      h += '<table class="mxd6-tbl"><thead><tr><th class="mxd6-th-label">Contrôle</th>';
      resolved.forEach(function(r, ci) {
        var col = r.def;
        var color = col.color || '#64748B';
        var emoji = col.icon || '';
        var ct = _v7TypeDef(col.type || col.key);
        var faIcon = ct ? ct.icon : (col.icon_fa || 'fa-columns');
        h += '<th class="mxd6-th-col mxd7-th-draggable" style="color:' + color + '"'
          + ' draggable="true"'
          + ' ondragstart="MX.Pages.MxDoc._v7ColHdrDragStart(event,' + sIdx + ',' + ci + ')"'
          + ' ondragover="event.preventDefault();this.classList.add(\'mxd7-th-dz\')"'
          + ' ondragleave="this.classList.remove(\'mxd7-th-dz\')"'
          + ' ondrop="MX.Pages.MxDoc._v7ColHdrDrop(event,' + sIdx + ',' + ci + ');this.classList.remove(\'mxd7-th-dz\')">'
          + '<div class="mxd6-th-txt">'
          + (emoji ? '<span class="mxd7-col-emoji-sm">' + e(emoji) + '</span>' : '<i class="fa-solid ' + faIcon + '"></i>')
          + '<span> ' + e(col.name || col.l || col.key) + '</span>'
          + (r.src === 'v7' && col.unit ? '<span class="mxd7-th-unit"> (' + e(col.unit) + ')</span>' : '')
          + '</div>'
          + '<button class="mxd7-th-rm" onclick="event.stopPropagation();MX.Pages.MxDoc._v7RemoveCol(' + sIdx + ',' + ci + ')" title="Retirer cette colonne"><i class="fa-solid fa-xmark"></i></button>'
          + '</th>';
      });
      h += '<th class="mxd6-th-acts"></th></tr></thead><tbody>';
      if (!rows.length) {
        h += '<tr><td colspan="' + (resolved.length + 2) + '" class="mxd6-tbl-empty">'
          + '<i class="fa-regular fa-plus-circle"></i> Cliquez <strong>Ajouter une ligne</strong> pour commencer'
          + '</td></tr>';
      } else {
        rows.forEach(function(row, rIdx) { h += _v6TableRowHTML(row, sIdx, rIdx, cols, resolved); });
      }
      h += '</tbody></table>';
    }
    h += '</div>'
      + '<button class="mxd6-add-line" onclick="MX.Pages.MxDoc._v6AddQuick(' + sIdx + ')">'
      + '<i class="fa-solid fa-plus"></i> Ajouter une ligne</button>';
    return h;
  }

  function _v6TableRowHTML(row, sIdx, rIdx, cols, resolved) {
    var e = _e;
    resolved = resolved || cols.map(_v7ResolveCol).filter(Boolean);
    var selected = (_v6SelSIdx === sIdx && _v6SelBIdx === rIdx);
    var h = '<tr class="mxd6-tbl-row' + (selected ? ' mxd6-tbl-row--sel' : '') + '"'
      + ' id="mxd6-row-' + sIdx + '-' + rIdx + '"'
      + ' draggable="true"'
      + ' ondragstart="MX.Pages.MxDoc._v6RowDragStart(event,' + sIdx + ',' + rIdx + ')"'
      + ' ondragover="event.preventDefault();MX.Pages.MxDoc._v6RowDzOver(event,' + sIdx + ',' + rIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v6RowDzLeave(event,' + sIdx + ',' + rIdx + ')"'
      + ' ondrop="MX.Pages.MxDoc._v6RowDzDrop(event,' + sIdx + ',' + rIdx + ')"'
      + ' onclick="MX.Pages.MxDoc._v6SelectRow(' + sIdx + ',' + rIdx + ')">'
      + '<td class="mxd6-td-label">'
      +   '<i class="mxd6-row-dh fa-solid fa-grip-vertical" onmousedown="event.stopPropagation()"></i>'
      +   '<span class="mxd6-row-lbl' + (row.required ? ' mxd6-row-lbl--req' : '') + '"'
      +     ' contenteditable="true" onclick="event.stopPropagation()"'
      +     ' onblur="MX.Pages.MxDoc._v6RowLabelChange(' + sIdx + ',' + rIdx + ',this)"'
      +     ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur()}"'
      +     '>' + e(row.label || '') + '</span>'
      + '</td>';
    resolved.forEach(function(r) {
      h += '<td class="mxd6-td-cell">' + _v7CellBuilderHTML(r.def, row) + '</td>';
    });
    h += '<td class="mxd6-td-acts">'
      + '<button class="mxd6-row-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DupEl(' + sIdx + ',' + rIdx + ')" title="Dupliquer"><i class="fa-regular fa-copy"></i></button>'
      + '<button class="mxd6-row-act' + (row.required ? ' mxd6-row-act--on' : '') + '" onclick="event.stopPropagation();MX.Pages.MxDoc._v6ToggleProp(' + sIdx + ',' + rIdx + ',\'required\')" title="Obligatoire"><i class="fa-solid fa-asterisk"></i></button>'
      + '<button class="mxd6-row-act mxd6-row-act--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DelEl(' + sIdx + ',' + rIdx + ')" title="Supprimer"><i class="fa-regular fa-trash"></i></button>'
      + '</td></tr>';
    return h;
  }

  // Unified builder preview cell — handles both V6 keys and V7 column defs
  function _v6CellHTML(colKey, row) {
    var r = _v7ResolveCol(colKey);
    return r ? _v7CellBuilderHTML(r.def, row) : '';
  }

  function _v7CellBuilderHTML(col, row) {
    var e = _e;
    var type = col.type || col.key || 'texte';
    switch (type) {
      case 'valeur':
      case 'int':
      case 'decimal':
      case 'compteur':
      case 'pourcent':
      case 'monnaie':
        return '<div class="mxd6-cell-val-wrap">'
          + '<input type="number" class="mxd6-cell-val" placeholder="' + (col.defaultVal !== undefined ? String(col.defaultVal) : '—') + '" tabindex="-1" onclick="event.stopPropagation()">'
          + (col.unit ? '<span class="mxd6-cell-unit">' + e(col.unit) + '</span>' : (row && row.unit ? '<span class="mxd6-cell-unit">' + e(row.unit) + '</span>' : ''))
          + '</div>';
      case 'etat':
      case 'etatcheck':
        return '<div class="mxd6-cell-etat">'
          + '<button class="mxd6-etat-ok" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-check"></i></button>'
          + '<button class="mxd6-etat-ko" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-xmark"></i></button>'
          + '</div>';
      case 'conforme':
        return '<div class="mxd6-cell-etat">'
          + '<button class="mxd6-etat-ok" tabindex="-1" onclick="event.stopPropagation()">' + e(col.libelleOk || 'Conforme') + '</button>'
          + '<button class="mxd6-etat-ko" tabindex="-1" onclick="event.stopPropagation()">' + e(col.libelleKo || 'Non conforme') + '</button>'
          + '</div>';
      case 'ouinon':
        return '<div class="mxd6-cell-yn">'
          + '<button class="mxd6-yn-oui" tabindex="-1" onclick="event.stopPropagation()">' + e(col.labelOui || 'Oui') + '</button>'
          + '<button class="mxd6-yn-non" tabindex="-1" onclick="event.stopPropagation()">' + e(col.labelNon || 'Non') + '</button>'
          + '</div>';
      case 'marchearret':
        return '<div class="mxd6-cell-yn">'
          + '<button class="mxd6-yn-oui" tabindex="-1" onclick="event.stopPropagation()">M</button>'
          + '<button class="mxd6-yn-non" tabindex="-1" onclick="event.stopPropagation()">A</button>'
          + '</div>';
      case 'liste':
        var opts = (col.listeValues || []).map(function(v) { return '<option>' + e(v) + '</option>'; }).join('');
        return '<select class="mxd6-cell-select" tabindex="-1" onclick="event.stopPropagation()"><option value="">—</option>' + opts + '</select>';
      case 'commentaire':
      case 'texte':
        return '<button class="mxd6-cell-ic" tabindex="-1" onclick="event.stopPropagation()" title="Commentaire"><i class="fa-regular fa-comment"></i></button>';
      case 'photo':
        return '<button class="mxd6-cell-ic mxd7-cell-photo" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-camera"></i>' + (col.photoMax > 1 ? '<span class="mxd7-cell-badge">' + col.photoMax + '</span>' : '') + '</button>';
      case 'signature':
        return '<button class="mxd6-cell-ic" tabindex="-1" onclick="event.stopPropagation()" title="Signature"><i class="fa-solid fa-pen-nib"></i></button>';
      case 'barcode':
        return '<button class="mxd6-cell-ic" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-barcode"></i></button>';
      case 'qrcode':
        return '<button class="mxd6-cell-ic" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-qrcode"></i></button>';
      case 'temps':
        return '<input type="text" class="mxd6-cell-date" placeholder="00:00" tabindex="-1" onclick="event.stopPropagation()">';
      case 'date':
        return '<input type="date" class="mxd6-cell-date" tabindex="-1" onclick="event.stopPropagation()">';
      case 'heure':
        return '<input type="time" class="mxd6-cell-heure" tabindex="-1" onclick="event.stopPropagation()">';
      default:
        return '<span class="mxd6-cell-unit">—</span>';
    }
  }

  // ── V7 COLUMN LIBRARY & HELPERS ──────────────────────────────────────────────

  // Resolve a column key/id to {src:'v7'|'v6', def}
  function _v7ResolveCol(ck) {
    if (!ck) return null;
    for (var i = 0; i < _colLibrary.length; i++) {
      if (_colLibrary[i].id === ck) return { src: 'v7', def: _colLibrary[i] };
    }
    for (var j = 0; j < V6_COLS.length; j++) {
      if (V6_COLS[j].key === ck) return { src: 'v6', def: V6_COLS[j] };
    }
    // Also match V7_COL_TYPES by key (for quick type-palette adds without saving)
    for (var k = 0; k < V7_COL_TYPES.length; k++) {
      if (V7_COL_TYPES[k].key === ck) return { src: 'v7type', def: V7_COL_TYPES[k] };
    }
    return null;
  }

  // Get V7_COL_TYPES def by key
  function _v7TypeDef(key) {
    for (var i = 0; i < V7_COL_TYPES.length; i++) {
      if (V7_COL_TYPES[i].key === key) return V7_COL_TYPES[i];
    }
    return null;
  }

  // Refresh palette panel only
  function _v7RefreshPalette() {
    var el = document.getElementById('mxd6-palette');
    if (el) el.innerHTML = _v6PaletteHTML();
  }

  // Switch palette tab
  function _v7SetPalTab(tab) {
    _v7PalTab = tab;
    _v7RefreshPalette();
  }

  // Firestore: load library with realtime updates
  function _v7LoadLibrary() {
    if (_colLibUnsub) return;
    try {
      _colLibUnsub = db.collection('mxColLibrary')
        .orderBy('_createdAt', 'asc')
        .onSnapshot(function(snap) {
          _colLibrary = [];
          snap.forEach(function(doc) { _colLibrary.push(Object.assign({ id: doc.id }, doc.data())); });
          _v7RefreshPalette();
        }, function(err) { console.warn('[V7] Library:', err); });
    } catch(e) { console.warn('[V7] Library unavailable'); }
  }

  function _v7UnloadLibrary() {
    if (_colLibUnsub) { _colLibUnsub(); _colLibUnsub = null; }
  }

  function _v7SaveColLib(def) {
    var col = db.collection('mxColLibrary');
    if (def.id) {
      col.doc(def.id).set(def, { merge: true });
    } else {
      def._createdAt = FV.serverTimestamp();
      col.add(def).then(function(ref) { def.id = ref.id; });
    }
  }

  function _v7DeleteColLib(colId) {
    if (!colId) return;
    db.collection('mxColLibrary').doc(colId).delete();
  }

  // ── PALETTE DRAG/CLICK HANDLERS ──

  // Type palette click — adds a V7 type key to active section
  function _v7TypeClick(typeKey) {
    var sIdx = (_v6SelSIdx !== null) ? _v6SelSIdx : (_builderSecs.length ? 0 : -1);
    if (sIdx < 0) { _v6AddSection(); sIdx = 0; }
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.rows) return;
    _v6Push();
    var cols = sec.columns || [];
    if (cols.indexOf(typeKey) < 0) { cols.push(typeKey); sec.columns = cols; }
    _v6RefreshSection(sIdx); _v6RefreshProps();
  }

  // Type palette drag start
  function _v7TypeDragStart(e, typeKey) {
    _v6DragData = { type: 'col', colKey: typeKey };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', typeKey || '');
  }

  // Library card click — adds library col ID to active section
  function _v7LibClick(colId) {
    var sIdx = (_v6SelSIdx !== null) ? _v6SelSIdx : (_builderSecs.length ? 0 : -1);
    if (sIdx < 0) { _v6AddSection(); sIdx = 0; }
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.rows) return;
    _v6Push();
    var cols = sec.columns || [];
    if (cols.indexOf(colId) < 0) { cols.push(colId); sec.columns = cols; }
    _v6RefreshSection(sIdx); _v6RefreshProps();
  }

  // Library card drag start
  function _v7LibDragStart(e, colId) {
    _v6DragData = { type: 'col', colKey: colId };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', colId || '');
  }

  // Remove a column from section by index
  function _v7RemoveCol(sIdx, ci) {
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.rows) return;
    _v6Push();
    sec.columns = (sec.columns || []).filter(function(_, i) { return i !== ci; });
    _v6RefreshSection(sIdx); _v6RefreshProps();
  }

  // Column header drag (reorder columns within a section)
  function _v7ColHdrDragStart(e, sIdx, ci) {
    _v6DragData = { type: 'colhdr', sIdx: sIdx, fromCi: ci };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'colhdr');
    e.stopPropagation();
  }

  function _v7ColHdrDrop(e, sIdx, toCi) {
    e.preventDefault(); e.stopPropagation();
    var dd = _v6DragData;
    if (!dd || dd.type !== 'colhdr' || dd.sIdx !== sIdx || dd.fromCi === toCi) return;
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.rows) return;
    _v6Push();
    var cols = (sec.columns || []).slice();
    var moved = cols.splice(dd.fromCi, 1)[0];
    var insertAt = toCi > dd.fromCi ? toCi - 1 : toCi;
    cols.splice(insertAt, 0, moved);
    sec.columns = cols;
    _v6RefreshSection(sIdx);
  }

  // ── COLUMN CREATION MODAL ────────────────────────────────────────────────────

  function _v7OpenColModal(colId) {
    if (colId) {
      var found = null;
      for (var i = 0; i < _colLibrary.length; i++) { if (_colLibrary[i].id === colId) { found = _colLibrary[i]; break; } }
      if (!found) return;
      _v7ModalDef = JSON.parse(JSON.stringify(found));
      _v7ModalIsNew = false;
    } else {
      _v7ModalDef = { id: null, name: '', icon: '', color: '#0EA5E9', type: 'decimal', required: false };
      _v7ModalIsNew = true;
    }
    _v7ModalTab = 'info';
    _v7RenderModal();
  }

  function _v7CloseColModal() {
    _v7ModalDef = null;
    var el = document.getElementById('mxd7-modal-overlay');
    if (el) el.remove();
  }

  function _v7RenderModal() {
    var existing = document.getElementById('mxd7-modal-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'mxd7-modal-overlay';
    overlay.className = 'mxd7-modal-overlay';
    overlay.innerHTML = _v7ModalHTML();
    document.body.appendChild(overlay);
  }

  function _v7ModalHTML() {
    var e = _e;
    var def = _v7ModalDef || {};
    var type = def.type || 'decimal';
    var ct = _v7TypeDef(type);
    var h = '<div class="mxd7-modal">';
    h += '<div class="mxd7-modal-hdr">'
      + '<span class="mxd7-modal-title">' + (_v7ModalIsNew ? 'Nouvelle colonne' : 'Modifier la colonne') + '</span>'
      + '<button class="mxd7-modal-close" onclick="MX.Pages.MxDoc._v7CloseColModal()"><i class="fa-solid fa-xmark"></i></button>'
      + '</div>';
    h += '<div class="mxd7-modal-body">';

    // Name + icon + color row
    h += '<div class="mxd7-mf-row">'
      + '<div class="mxd7-mf-grp mxd7-mf-grp--grow">'
      +   '<label class="mxd7-mf-lbl">Nom</label>'
      +   '<input class="mxd7-mf-inp" id="mxd7-col-name" value="' + e(def.name || '') + '" placeholder="PH Brut…" oninput="MX.Pages.MxDoc._v7MUpdate(\'name\',this.value)">'
      + '</div>'
      + '<div class="mxd7-mf-grp">'
      +   '<label class="mxd7-mf-lbl">Icône</label>'
      +   '<input class="mxd7-mf-inp mxd7-mf-emoji" id="mxd7-col-icon" value="' + e(def.icon || '') + '" placeholder="🧪" maxlength="2" oninput="MX.Pages.MxDoc._v7MUpdate(\'icon\',this.value)">'
      + '</div>'
      + '<div class="mxd7-mf-grp">'
      +   '<label class="mxd7-mf-lbl">Couleur</label>'
      +   '<input class="mxd7-mf-color" type="color" value="' + e(def.color || '#0EA5E9') + '" oninput="MX.Pages.MxDoc._v7MUpdate(\'color\',this.value)">'
      + '</div>'
      + '</div>';

    // Type grid
    h += '<div class="mxd7-mf-grp"><label class="mxd7-mf-lbl">Type de colonne</label>';
    h += '<div class="mxd7-type-grid">';
    V7_COL_TYPES.forEach(function(c) {
      var on = c.key === type;
      h += '<button class="mxd7-type-chip' + (on ? ' mxd7-type-chip--on' : '') + '"'
        + ' style="' + (on ? 'border-color:' + (ct ? ct.color : c.color) + ';color:' + (ct ? ct.color : c.color) + ';' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._v7MSetType(' + JSON.stringify(c.key) + ')">'
        + '<i class="fa-solid ' + c.icon + '"></i><span>' + e(c.l) + '</span>'
        + '</button>';
    });
    h += '</div></div>';

    // Type-specific params
    h += _v7ModalParamsHTML(def, type);

    // Required toggle
    h += '<div class="mxd7-mf-row mxd7-mf-row--mt">'
      + '<label class="mxd7-mf-lbl">Champ obligatoire</label>'
      + '<label class="mxd7-toggle"><input type="checkbox" ' + (def.required ? 'checked' : '') + ' onchange="MX.Pages.MxDoc._v7MUpdate(\'required\',this.checked)"><span class="mxd7-toggle-slider"></span></label>'
      + '</div>';

    h += '</div>';
    h += '<div class="mxd7-modal-foot">';
    if (!_v7ModalIsNew && def.id) {
      h += '<button class="mxd7-btn-del" onclick="MX.Pages.MxDoc._v7DeleteColConfirm(' + JSON.stringify(def.id) + ')"><i class="fa-regular fa-trash"></i> Supprimer</button>';
    }
    h += '<button class="mxd7-btn-cancel" onclick="MX.Pages.MxDoc._v7CloseColModal()">Annuler</button>';
    h += '<button class="mxd7-btn-save" onclick="MX.Pages.MxDoc._v7SaveColModal()"><i class="fa-solid fa-floppy-disk"></i> Enregistrer</button>';
    h += '</div></div>';
    return '<div class="mxd7-modal-inner">' + h + '</div>';
  }

  function _v7ModalParamsHTML(def, type) {
    var e = _e;
    var h = '';
    if (type === 'int' || type === 'decimal' || type === 'pourcent' || type === 'monnaie' || type === 'compteur') {
      h += '<div class="mxd7-mf-section"><p class="mxd7-mf-section-lbl">Paramètres numériques</p>';
      h += '<div class="mxd7-mf-row">';
      h += _mfField('Unité', 'text', def.unit || '', '_v7MUpdate(\'unit\',this.value)', 'pH, °C, bar…');
      h += _mfField('Valeur mini', 'number', def.min !== undefined ? def.min : '', '_v7MUpdate(\'min\',parseFloat(this.value)||null)', '');
      h += _mfField('Valeur maxi', 'number', def.max !== undefined ? def.max : '', '_v7MUpdate(\'max\',parseFloat(this.value)||null)', '');
      h += _mfField('Décimales', 'number', def.decimals !== undefined ? def.decimals : 1, '_v7MUpdate(\'decimals\',parseInt(this.value)||0)', '');
      h += _mfField('Valeur par défaut', 'number', def.defaultVal !== undefined ? def.defaultVal : '', '_v7MUpdate(\'defaultVal\',parseFloat(this.value))', '');
      h += '</div></div>';
    }
    if (type === 'photo') {
      h += '<div class="mxd7-mf-section"><p class="mxd7-mf-section-lbl">Paramètres photo</p>';
      h += '<div class="mxd7-mf-row">';
      h += _mfField('Nombre max', 'number', def.photoMax || 1, '_v7MUpdate(\'photoMax\',parseInt(this.value)||1)', '');
      h += '</div>';
      h += '<div class="mxd7-mf-row">';
      h += _mfToggle('Appareil photo', 'photoCamera', def.photoCamera !== false);
      h += _mfToggle('Galerie', 'photoGallery', def.photoGallery !== false);
      h += _mfToggle('Compression auto', 'photoCompress', def.photoCompress !== false);
      h += '</div></div>';
    }
    if (type === 'signature') {
      h += '<div class="mxd7-mf-section"><p class="mxd7-mf-section-lbl">Paramètres signature</p>';
      h += '<div class="mxd7-mf-row">';
      h += _mfToggle('Signature responsable', 'sigResponsable', !!def.sigResponsable);
      h += _mfToggle('Signature technicien', 'sigTechnicien', !!def.sigTechnicien);
      h += '</div></div>';
    }
    if (type === 'liste') {
      var vals = def.listeValues || [];
      h += '<div class="mxd7-mf-section"><p class="mxd7-mf-section-lbl">Valeurs de la liste</p>';
      h += '<div class="mxd7-liste-vals" id="mxd7-liste-vals">';
      vals.forEach(function(v, i) {
        h += '<div class="mxd7-liste-val-row">'
          + '<input class="mxd7-mf-inp" value="' + e(v) + '" oninput="MX.Pages.MxDoc._v7MListeUpdate(' + i + ',this.value)">'
          + '<button class="mxd7-liste-rm" onclick="MX.Pages.MxDoc._v7MListeRemove(' + i + ')"><i class="fa-solid fa-xmark"></i></button>'
          + '</div>';
      });
      h += '</div>';
      h += '<button class="mxd7-liste-add" onclick="MX.Pages.MxDoc._v7MListeAdd()"><i class="fa-solid fa-plus"></i> Ajouter</button>';
      h += '</div>';
    }
    if (type === 'conforme') {
      h += '<div class="mxd7-mf-section"><p class="mxd7-mf-section-lbl">Libellés</p>';
      h += '<div class="mxd7-mf-row">';
      h += _mfField('Libellé vert', 'text', def.libelleOk || 'Conforme', '_v7MUpdate(\'libelleOk\',this.value)', '');
      h += _mfField('Libellé rouge', 'text', def.libelleKo || 'Non conforme', '_v7MUpdate(\'libelleKo\',this.value)', '');
      h += '</div></div>';
    }
    if (type === 'ouinon') {
      h += '<div class="mxd7-mf-section"><p class="mxd7-mf-section-lbl">Libellés</p>';
      h += '<div class="mxd7-mf-row">';
      h += _mfField('Libellé Oui', 'text', def.labelOui || 'Oui', '_v7MUpdate(\'labelOui\',this.value)', '');
      h += _mfField('Libellé Non', 'text', def.labelNon || 'Non', '_v7MUpdate(\'labelNon\',this.value)', '');
      h += '</div></div>';
    }
    return h;
  }

  function _mfField(label, type, val, handler, ph) {
    var e = _e;
    return '<div class="mxd7-mf-grp">'
      + '<label class="mxd7-mf-lbl">' + e(label) + '</label>'
      + '<input class="mxd7-mf-inp" type="' + type + '" value="' + e(String(val)) + '" placeholder="' + e(ph) + '" oninput="MX.Pages.MxDoc.' + handler + '">'
      + '</div>';
  }

  function _mfToggle(label, key, on) {
    var e = _e;
    return '<div class="mxd7-mf-grp">'
      + '<label class="mxd7-mf-lbl">' + e(label) + '</label>'
      + '<label class="mxd7-toggle"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="MX.Pages.MxDoc._v7MUpdate(\'' + key + '\',this.checked)"><span class="mxd7-toggle-slider"></span></label>'
      + '</div>';
  }

  // Modal state update (called from inline handlers)
  function _v7MUpdate(key, val) {
    if (!_v7ModalDef) return;
    _v7ModalDef[key] = val;
    if (key === 'type') { _v7ModalTab = 'info'; }
  }

  function _v7MSetType(typeKey) {
    if (!_v7ModalDef) return;
    _v7ModalDef.type = typeKey;
    _v7RenderModal();
  }

  function _v7MListeAdd() {
    if (!_v7ModalDef) return;
    _v7ModalDef.listeValues = (_v7ModalDef.listeValues || []).concat(['']);
    _v7RenderModal();
  }

  function _v7MListeUpdate(i, val) {
    if (!_v7ModalDef || !_v7ModalDef.listeValues) return;
    _v7ModalDef.listeValues[i] = val;
  }

  function _v7MListeRemove(i) {
    if (!_v7ModalDef || !_v7ModalDef.listeValues) return;
    _v7ModalDef.listeValues.splice(i, 1);
    _v7RenderModal();
  }

  function _v7SaveColModal() {
    var def = _v7ModalDef;
    if (!def) return;
    // Collect current input values from DOM before saving
    var nameEl = document.getElementById('mxd7-col-name');
    if (nameEl) def.name = nameEl.value.trim();
    if (!def.name) { MX.toast && MX.toast('Veuillez saisir un nom pour la colonne', true); return; }
    _v7SaveColLib(def);
    _v7CloseColModal();
    MX.toast && MX.toast('Colonne enregistrée dans la bibliothèque');
  }

  function _v7DeleteColConfirm(colId) {
    if (!confirm('Supprimer cette colonne de la bibliothèque ?')) return;
    _v7DeleteColLib(colId);
    _v7CloseColModal();
  }

  // ── AI COLUMN SUGGESTION MODAL ───────────────────────────────────────────────

  function _v7OpenAIModal() {
    var existing = document.getElementById('mxd7-ai-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'mxd7-ai-overlay';
    overlay.className = 'mxd7-modal-overlay';
    overlay.innerHTML = '<div class="mxd7-modal-inner"><div class="mxd7-modal mxd7-ai-modal">'
      + '<div class="mxd7-modal-hdr"><span class="mxd7-modal-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Générer les colonnes</span>'
      + '<button class="mxd7-modal-close" onclick="document.getElementById(\'mxd7-ai-overlay\').remove()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxd7-modal-body">'
      + '<label class="mxd7-mf-lbl">Décrivez votre procédure</label>'
      + '<textarea class="mxd7-ai-inp" id="mxd7-ai-txt" placeholder="Ex: Tournée CTA avec pH brut, pH adoucie, température, pression, niveau d\'eau, état des pompes…" rows="4"></textarea>'
      + '<div id="mxd7-ai-results" class="mxd7-ai-results"></div>'
      + '</div>'
      + '<div class="mxd7-modal-foot">'
      + '<button class="mxd7-btn-cancel" onclick="document.getElementById(\'mxd7-ai-overlay\').remove()">Fermer</button>'
      + '<button class="mxd7-btn-save" onclick="MX.Pages.MxDoc._v7AIGenerate()"><i class="fa-solid fa-sparkles"></i> Analyser</button>'
      + '</div></div></div>';
    document.body.appendChild(overlay);
  }

  function _v7AIGenerate() {
    var txt = (document.getElementById('mxd7-ai-txt') || {}).value || '';
    if (!txt.trim()) return;
    var words = txt.toLowerCase().split(/[\s,;.\/\(\)]+/).filter(Boolean);
    var seen = {};
    var suggestions = [];
    words.forEach(function(w) {
      // Match against keywords
      Object.keys(V7_AI_KW).forEach(function(kw) {
        if (w.indexOf(kw) >= 0 && !seen[kw]) {
          seen[kw] = true;
          var hint = V7_AI_KW[kw];
          // Check if library already has a matching column
          var libMatch = _colLibrary.filter(function(c) { return c.name && c.name.toLowerCase().indexOf(kw) >= 0; })[0];
          suggestions.push({ label: libMatch ? libMatch.name : (w.charAt(0).toUpperCase() + w.slice(1)), hint: hint, libCol: libMatch || null });
        }
      });
      // Direct library name match
      _colLibrary.forEach(function(c) {
        var cname = (c.name || '').toLowerCase();
        if (cname.indexOf(w) >= 0 && !seen['lib_' + c.id]) {
          seen['lib_' + c.id] = true;
          suggestions.push({ label: c.name, hint: { type: c.type }, libCol: c });
        }
      });
    });
    var res = document.getElementById('mxd7-ai-results');
    if (!res) return;
    if (!suggestions.length) {
      res.innerHTML = '<p class="mxd7-ai-none">Aucune suggestion — essayez des termes comme : pH, température, pression, pompe, conforme, photo…</p>';
      return;
    }
    var e = _e;
    var html = '<p class="mxd7-ai-subtitle">Colonnes suggérées — cliquez pour ajouter à la section active</p><div class="mxd7-ai-chips">';
    suggestions.forEach(function(s, si) {
      var ct = _v7TypeDef(s.hint.type || 'decimal');
      var color = ct ? ct.color : '#64748B';
      html += '<div class="mxd7-ai-chip" style="border-color:' + color + '20;color:' + color + '" onclick="MX.Pages.MxDoc._v7AIAddCol(' + si + ')">'
        + '<i class="fa-solid ' + (ct ? ct.icon : 'fa-columns') + '"></i> ' + e(s.label)
        + (s.libCol ? ' <span class="mxd7-ai-from-lib">bibliothèque</span>' : '')
        + '</div>';
    });
    html += '</div>';
    res.innerHTML = html;
    res._suggestions = suggestions;
  }

  function _v7AIAddCol(si) {
    var res = document.getElementById('mxd7-ai-results');
    if (!res || !res._suggestions) return;
    var s = res._suggestions[si];
    if (!s) return;
    var sIdx = (_v6SelSIdx !== null) ? _v6SelSIdx : (_builderSecs.length ? 0 : -1);
    if (sIdx < 0) { _v6AddSection(); sIdx = 0; }
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.rows) return;
    _v6Push();
    var cols = sec.columns || [];
    if (s.libCol) {
      // Use existing library column
      if (cols.indexOf(s.libCol.id) < 0) { cols.push(s.libCol.id); sec.columns = cols; }
    } else {
      // Create a new quick column from hint
      var newDef = Object.assign({ id: null, name: s.label, icon: '', color: ((_v7TypeDef(s.hint.type) || {}).color || '#64748B'), type: s.hint.type || 'decimal', required: false }, s.hint);
      _v7SaveColLib(newDef);
      // Will appear in library via snapshot — for now add the type key
      if (cols.indexOf(s.hint.type || 'decimal') < 0) { cols.push(s.hint.type || 'decimal'); sec.columns = cols; }
    }
    _v6RefreshSection(sIdx);
    MX.toast && MX.toast('Colonne ajoutée : ' + s.label);
  }

  // ── LEGACY BLOCK RENDERING (backward compat for sec.blocks model) ──
  function _v6LegacyRowHTML(blk, sIdx, bIdx) {
    var selected = (_v6SelSIdx === sIdx && _v6SelBIdx === bIdx);
    if (blk.type !== 'v5row') return _v6StaticRowHTML(blk, sIdx, bIdx, selected);
    var e = _e;
    return '<div class="mxd6-row' + (selected ? ' mxd6-row--sel' : '') + '" id="mxd6-row-' + sIdx + '-' + bIdx + '"'
      + ' draggable="true"'
      + ' ondragstart="MX.Pages.MxDoc._v6RowDragStart(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragover="event.preventDefault();MX.Pages.MxDoc._v6RowDzOver(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v6RowDzLeave(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondrop="MX.Pages.MxDoc._v6RowDzDrop(event,' + sIdx + ',' + bIdx + ')"'
      + ' onclick="MX.Pages.MxDoc._v6SelectRow(' + sIdx + ',' + bIdx + ')">'
      + '<i class="mxd6-row-dh fa-solid fa-grip-vertical" onmousedown="event.stopPropagation()"></i>'
      + '<div class="mxd6-row-body">'
      +   '<div class="mxd6-row-name-row">'
      +     '<span class="mxd6-row-lbl' + (blk.required ? ' mxd6-row-lbl--req' : '') + '"'
      +       ' contenteditable="true" onclick="event.stopPropagation()"'
      +       ' onblur="MX.Pages.MxDoc._v6RowLabelChange(' + sIdx + ',' + bIdx + ',this)"'
      +       ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur()}"'
      +       '>' + e(blk.label || '') + '</span>'
      +   '</div>'
      +   '<div class="mxd6-row-ctrls">' + _v6RowControlsHTML(blk) + '</div>'
      + '</div>'
      + '<div class="mxd6-row-acts">'
      +   '<button class="mxd6-row-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DupEl(' + sIdx + ',' + bIdx + ')" title="Dupliquer"><i class="fa-regular fa-copy"></i></button>'
      +   '<button class="mxd6-row-act' + (blk.required ? ' mxd6-row-act--on' : '') + '" onclick="event.stopPropagation();MX.Pages.MxDoc._v6ToggleProp(' + sIdx + ',' + bIdx + ',\'required\')" title="Obligatoire"><i class="fa-solid fa-asterisk"></i></button>'
      +   '<button class="mxd6-row-act mxd6-row-act--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DelEl(' + sIdx + ',' + bIdx + ')" title="Supprimer"><i class="fa-regular fa-trash"></i></button>'
      + '</div>'
      + '</div>';
  }

  function _v6StaticRowHTML(blk, sIdx, bIdx, selected) {
    var e = _e;
    var cls = { titre: 'mxd6-static-titre', sstitre: 'mxd6-static-sstitre', separator: 'mxd6-static-sep', texte: 'mxd6-static-texte' }[blk.type] || '';
    var h = '<div class="mxd6-row mxd6-row--static ' + cls + (selected ? ' mxd6-row--sel' : '') + '"'
      + ' id="mxd6-row-' + sIdx + '-' + bIdx + '"'
      + ' draggable="true"'
      + ' ondragstart="MX.Pages.MxDoc._v6RowDragStart(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragover="event.preventDefault();MX.Pages.MxDoc._v6RowDzOver(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v6RowDzLeave(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondrop="MX.Pages.MxDoc._v6RowDzDrop(event,' + sIdx + ',' + bIdx + ')"'
      + ' onclick="MX.Pages.MxDoc._v6SelectRow(' + sIdx + ',' + bIdx + ')">';
    if (blk.type === 'separator') {
      h += '<div class="mxd6-row-body"><div class="mxd6-sep-line"></div></div>';
    } else {
      h += '<i class="mxd6-row-dh fa-solid fa-grip-vertical" onmousedown="event.stopPropagation()"></i>'
        + '<div class="mxd6-row-body">'
        + '<span class="mxd6-row-lbl" contenteditable="true" onclick="event.stopPropagation()"'
        +   ' onblur="MX.Pages.MxDoc._v6RowLabelChange(' + sIdx + ',' + bIdx + ',this)"'
        +   ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur()}"'
        +   '>' + e(blk.label || '') + '</span>'
        + '</div>';
    }
    h += '<div class="mxd6-row-acts">'
      + '<button class="mxd6-row-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DupEl(' + sIdx + ',' + bIdx + ')" title="Dupliquer"><i class="fa-regular fa-copy"></i></button>'
      + '<button class="mxd6-row-act mxd6-row-act--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v6DelEl(' + sIdx + ',' + bIdx + ')" title="Supprimer"><i class="fa-regular fa-trash"></i></button>'
      + '</div></div>';
    return h;
  }

  function _v6RowControlsHTML(blk) {
    var e = _e; var h = '';
    if (blk.hasValeur) {
      h += '<div class="mxd6-ctrl-val-wrap">'
        + '<input type="number" class="mxd6-ctrl-val-inp" placeholder="—" tabindex="-1" onclick="event.stopPropagation()">'
        + (blk.unit ? '<span class="mxd6-ctrl-unit">' + e(blk.unit) + '</span>' : '')
        + '</div>';
    }
    if (blk.hasFaitnonfait) {
      h += '<div class="mxd6-ctrl-fnf">'
        + '<button class="mxd6-fnf-fait" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-check"></i> Fait</button>'
        + '<button class="mxd6-fnf-pas" tabindex="-1" onclick="event.stopPropagation()"><i class="fa-solid fa-xmark"></i> Pas fait</button>'
        + '</div>';
    }
    if (blk.hasOuinon) {
      h += '<div class="mxd6-ctrl-yn">'
        + '<button class="mxd6-yn-oui" tabindex="-1" onclick="event.stopPropagation()">Oui</button>'
        + '<button class="mxd6-yn-non" tabindex="-1" onclick="event.stopPropagation()">Non</button>'
        + '</div>';
    }
    if (blk.hasDate) { h += '<input type="date" class="mxd6-ctrl-date" tabindex="-1" onclick="event.stopPropagation()">'; }
    if (blk.hasHeure) { h += '<input type="time" class="mxd6-ctrl-heure" tabindex="-1" onclick="event.stopPropagation()">'; }
    if (blk.hasCommentaire) { h += '<button class="mxd6-ctrl-ic" tabindex="-1" onclick="event.stopPropagation()" title="Commentaire"><i class="fa-regular fa-comment"></i></button>'; }
    if (blk.hasPhoto) { h += '<button class="mxd6-ctrl-ic" tabindex="-1" onclick="event.stopPropagation()" title="Photo"><i class="fa-solid fa-camera"></i></button>'; }
    if (blk.hasSignature) { h += '<button class="mxd6-ctrl-ic" tabindex="-1" onclick="event.stopPropagation()" title="Signature"><i class="fa-solid fa-pen-nib"></i></button>'; }
    return h;
  }

  function _v6PropsPanelHTML() {
    if (_v6SelSIdx === null) return _v6DocPropsHTML();
    var sec = _builderSecs[_v6SelSIdx];
    if (!sec) return _v6DocPropsHTML();
    if (_v6SelBIdx === null) return _v6SecPropsHTML(sec, _v6SelSIdx);
    var items = sec.rows || sec.blocks || [];
    var item = items[_v6SelBIdx];
    if (!item) return _v6SecPropsHTML(sec, _v6SelSIdx);
    if (sec.rows) return _v6ElPropsHTML(item, _v6SelSIdx, _v6SelBIdx);
    return item.type === 'v5row' ? _v6LegacyElPropsHTML(item, _v6SelSIdx, _v6SelBIdx) : _v6StaticPropsHTML(item, _v6SelSIdx, _v6SelBIdx);
  }

  function _v6DocPropsHTML() {
    var e = _e; var tpl = _builderTpl || {};
    return '<div class="mxd6-props-inner">'
      + '<div class="mxd6-props-hd"><i class="fa-regular fa-file-lines"></i> Document</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Titre</label>'
      +   '<input class="mxd6-prop-inp" type="text" value="' + e(tpl.title || '') + '"'
      +   ' oninput="MX.Pages.MxDoc._bldTitleChange(this.value);var t=document.getElementById(\'mxd6-title\');if(t)t.value=this.value">'
      + '</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Description</label>'
      +   '<textarea class="mxd6-prop-ta" rows="3" oninput="MX.Pages.MxDoc._bldDescChange(this.value)">' + e(tpl.description || '') + '</textarea>'
      + '</div>'
      + '<div class="mxd6-props-tip"><i class="fa-regular fa-lightbulb"></i> Cliquez sur une section ou une ligne pour éditer ses propriétés.</div>'
      + '</div>';
  }

  function _v6SecPropsHTML(sec, sIdx) {
    var e = _e; var color = sec.color || '#6366F1';
    var isTable = !!sec.rows;
    var cols = sec.columns || [];
    var h = '<div class="mxd6-props-inner">'
      + '<div class="mxd6-props-hd"><i class="fa-regular fa-folder-open"></i> Section</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Nom</label>'
      +   '<input class="mxd6-prop-inp" type="text" value="' + e(sec.label || '') + '"'
      +   ' oninput="MX.Pages.MxDoc._v6SecLabelProp(' + sIdx + ',this.value)">'
      + '</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Description</label>'
      +   '<input class="mxd6-prop-inp" type="text" value="' + e(sec.description || '') + '"'
      +   ' oninput="MX.Pages.MxDoc._v6SecDesc(' + sIdx + ',this.value)">'
      + '</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Couleur</label>'
      +   '<div class="mxd6-color-pal">'
      +   V6_SECTION_COLORS.map(function(c) {
            return '<button class="mxd6-color-dot' + (color === c ? ' mxd6-color-dot--on' : '') + '"'
              + ' style="background:' + c + '" title="' + c + '"'
              + ' onclick="MX.Pages.MxDoc._v6SecColor(' + sIdx + ',\'' + c + '\')"></button>';
          }).join('')
      +   '</div>'
      + '</div>';
    if (isTable) {
      h += '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Colonnes</label>'
        + '<div class="mxd6-col-grid">';
      V6_COLS.forEach(function(c) {
        var on = cols.indexOf(c.key) >= 0;
        h += '<button class="mxd6-col-tog' + (on ? ' mxd6-col-tog--on' : '') + '"'
          + (on ? ' style="border-color:' + c.color + ';color:' + c.color + '"' : '')
          + ' onclick="MX.Pages.MxDoc._v6ToggleCol(' + sIdx + ',' + JSON.stringify(c.key) + ')">'
          + '<i class="fa-solid ' + c.icon + '"></i><span>' + e(c.l) + '</span>'
          + '</button>';
      });
      h += '</div></div>';
    }
    h += '<hr class="mxd6-sep"><div class="mxd6-prop-actions">'
      + '<button class="mxd6-prop-act-btn" onclick="MX.Pages.MxDoc._v6DupSection(' + sIdx + ')"><i class="fa-regular fa-copy"></i> Dupliquer</button>'
      + '<button class="mxd6-prop-act-btn mxd6-prop-act-btn--del" onclick="MX.Pages.MxDoc._v6DelSection(' + sIdx + ')"><i class="fa-regular fa-trash"></i> Supprimer</button>'
      + '</div></div>';
    return h;
  }

  function _v6ElPropsHTML(row, sIdx, rIdx) {
    var e = _e;
    var sec = _builderSecs[sIdx] || {};
    var hasValeur = (sec.columns || []).indexOf('valeur') >= 0;
    var h = '<div class="mxd6-props-inner">'
      + '<div class="mxd6-props-hd"><i class="fa-regular fa-sliders"></i> Ligne</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Nom</label>'
      +   '<input class="mxd6-prop-inp" type="text" value="' + e(row.label || '') + '"'
      +   ' oninput="MX.Pages.MxDoc._v6PropChange(' + sIdx + ',' + rIdx + ',\'label\',this.value)">'
      + '</div>';
    if (hasValeur) {
      h += '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Unité</label>'
        + '<input class="mxd6-prop-inp" type="text" value="' + e(row.unit || '') + '" placeholder="Ex: pH, °C, %…"'
        +   ' oninput="MX.Pages.MxDoc._v6SetUnit(' + sIdx + ',' + rIdx + ',this.value)">'
        + '</div>';
    }
    h += '<div class="mxd6-prop-toggle-row">'
      + '<span class="mxd6-prop-toggle-lbl">Obligatoire</span>'
      + '<button class="mxd6-toggle' + (row.required ? ' mxd6-toggle--on' : '') + '"'
      +   ' onclick="MX.Pages.MxDoc._v6ToggleProp(' + sIdx + ',' + rIdx + ',\'required\')"></button>'
      + '</div>'
      + '<hr class="mxd6-sep"><div class="mxd6-prop-actions">'
      + '<button class="mxd6-prop-act-btn" onclick="MX.Pages.MxDoc._v6DupEl(' + sIdx + ',' + rIdx + ')"><i class="fa-regular fa-copy"></i> Dupliquer</button>'
      + '<button class="mxd6-prop-act-btn mxd6-prop-act-btn--del" onclick="MX.Pages.MxDoc._v6DelEl(' + sIdx + ',' + rIdx + ')"><i class="fa-regular fa-trash"></i> Supprimer</button>'
      + '</div></div>';
    return h;
  }

  function _v6LegacyElPropsHTML(blk, sIdx, bIdx) {
    var e = _e;
    var h = '<div class="mxd6-props-inner">'
      + '<div class="mxd6-props-hd"><i class="fa-regular fa-sliders"></i> Contrôle</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Nom</label>'
      +   '<input class="mxd6-prop-inp" type="text" value="' + e(blk.label || '') + '"'
      +   ' oninput="MX.Pages.MxDoc._v6PropChange(' + sIdx + ',' + bIdx + ',\'label\',this.value)">'
      + '</div>';
    if (blk.hasValeur) {
      h += '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Unité</label>'
        + '<input class="mxd6-prop-inp" type="text" value="' + e(blk.unit || '') + '" placeholder="Ex: pH, °C, %…"'
        +   ' oninput="MX.Pages.MxDoc._v6SetUnit(' + sIdx + ',' + bIdx + ',this.value)">'
        + '</div>';
    }
    h += '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Composants</label>'
      + '<div class="mxd6-comp-grid">';
    V5_COMPS.forEach(function(c) {
      var on = !!blk[c.key];
      h += '<button class="mxd6-comp-tog' + (on ? ' mxd6-comp-tog--on' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._v6ToggleComp(' + sIdx + ',' + bIdx + ',' + JSON.stringify(c.key) + ')">'
        + '<i class="fa-solid ' + c.icon + '" style="color:' + c.color + '"></i>'
        + '<span>' + e(c.l) + '</span>'
        + '</button>';
    });
    h += '</div></div>';
    h += '<div class="mxd6-prop-toggle-row">'
      + '<span class="mxd6-prop-toggle-lbl">Obligatoire</span>'
      + '<button class="mxd6-toggle' + (blk.required ? ' mxd6-toggle--on' : '') + '"'
      +   ' onclick="MX.Pages.MxDoc._v6ToggleProp(' + sIdx + ',' + bIdx + ',\'required\')"></button>'
      + '</div>'
      + '<hr class="mxd6-sep"><div class="mxd6-prop-actions">'
      + '<button class="mxd6-prop-act-btn" onclick="MX.Pages.MxDoc._v6DupEl(' + sIdx + ',' + bIdx + ')"><i class="fa-regular fa-copy"></i> Dupliquer</button>'
      + '<button class="mxd6-prop-act-btn mxd6-prop-act-btn--del" onclick="MX.Pages.MxDoc._v6DelEl(' + sIdx + ',' + bIdx + ')"><i class="fa-regular fa-trash"></i> Supprimer</button>'
      + '</div></div>';
    return h;
  }

  function _v6StaticPropsHTML(blk, sIdx, bIdx) {
    var e = _e;
    return '<div class="mxd6-props-inner">'
      + '<div class="mxd6-props-hd"><i class="fa-regular fa-text-size"></i> Mise en forme</div>'
      + '<div class="mxd6-prop-grp"><label class="mxd6-prop-lbl">Texte</label>'
      +   '<input class="mxd6-prop-inp" type="text" value="' + e(blk.label || '') + '"'
      +   ' oninput="MX.Pages.MxDoc._v6PropChange(' + sIdx + ',' + bIdx + ',\'label\',this.value)">'
      + '</div>'
      + '<hr class="mxd6-sep"><div class="mxd6-prop-actions">'
      + '<button class="mxd6-prop-act-btn" onclick="MX.Pages.MxDoc._v6DupEl(' + sIdx + ',' + bIdx + ')"><i class="fa-regular fa-copy"></i> Dupliquer</button>'
      + '<button class="mxd6-prop-act-btn mxd6-prop-act-btn--del" onclick="MX.Pages.MxDoc._v6DelEl(' + sIdx + ',' + bIdx + ')"><i class="fa-regular fa-trash"></i> Supprimer</button>'
      + '</div></div>';
  }

  function _v6MobBarHTML() {
    var tabs = [
      { key: 'palette', icon: 'fa-layer-group', l: 'Palette' },
      { key: 'canvas',  icon: 'fa-file-lines',  l: 'Document' },
      { key: 'props',   icon: 'fa-sliders',     l: 'Propriétés' },
    ];
    return '<nav class="mxd6-mob-bar">'
      + tabs.map(function(t) {
          return '<button class="mxd6-mob-btn' + (t.key === _v6MobPanel ? ' mxd6-mob-btn--on' : '') + '"'
            + ' onclick="MX.Pages.MxDoc._v6MobSwitch(\'' + t.key + '\')">'
            + '<i class="fa-solid ' + t.icon + '"></i><span>' + t.l + '</span></button>';
        }).join('')
      + '</nav>';
  }

  // ── V6 REFRESH ──
  function _v6RefreshCanvas() {
    var el = document.getElementById('mxd6-canvas');
    if (el) el.innerHTML = _v6CanvasInnerHTML();
    _v6UpdateUndoRedo();
  }

  function _v6RefreshSection(sIdx) {
    var el = document.getElementById('mxd6-sec-' + sIdx);
    if (!el || !_builderSecs[sIdx]) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = _v6SectionHTML(_builderSecs[sIdx], sIdx);
    el.replaceWith(tmp.firstChild);
  }

  function _v6RefreshRow(sIdx, rIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var elId = 'mxd6-row-' + sIdx + '-' + rIdx;
    if (sec.rows) {
      var row = sec.rows[rIdx];
      if (!row) return;
      var el = document.getElementById(elId);
      if (!el) return;
      var tmp = document.createElement('tbody');
      tmp.innerHTML = _v6TableRowHTML(row, sIdx, rIdx, sec.columns || []);
      el.replaceWith(tmp.firstChild);
    } else {
      var blk = (sec.blocks || [])[rIdx];
      if (!blk) return;
      var el2 = document.getElementById(elId);
      if (!el2) return;
      var tmp2 = document.createElement('div');
      tmp2.innerHTML = _v6LegacyRowHTML(blk, sIdx, rIdx);
      el2.replaceWith(tmp2.firstChild);
    }
  }

  function _v6RefreshProps() {
    var el = document.getElementById('mxd6-props');
    if (el) el.innerHTML = _v6PropsPanelHTML();
  }

  // ── V6 UNDO / REDO ──
  function _v6Push() {
    _v2History.push(JSON.stringify(_builderSecs));
    _v2Future = [];
    _v6UpdateUndoRedo();
  }

  function _v6Undo() {
    if (!_v2History.length) return;
    _v2Future.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2History.pop());
    _v6SelSIdx = null; _v6SelBIdx = null;
    _v6RefreshCanvas(); _v6RefreshProps(); _v6UpdateUndoRedo();
  }

  function _v6Redo() {
    if (!_v2Future.length) return;
    _v2History.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2Future.pop());
    _v6SelSIdx = null; _v6SelBIdx = null;
    _v6RefreshCanvas(); _v6RefreshProps(); _v6UpdateUndoRedo();
  }

  function _v6UpdateUndoRedo() {
    var u = document.getElementById('mxd6-undo');
    var r = document.getElementById('mxd6-redo');
    if (u) u.disabled = !_v2History.length;
    if (r) r.disabled = !_v2Future.length;
  }

  function _v6Preview() {
    if (!_builderTpl) return;
    var copy = JSON.parse(JSON.stringify(_builderTpl));
    copy.sections = JSON.parse(JSON.stringify(_builderSecs));
    _execTemplate = copy; _execMode = true; _builderMode = false; render();
  }

  function _v6MobSwitch(panel) {
    _v6MobPanel = panel;
    var pal = document.getElementById('mxd6-palette');
    var cvs = document.getElementById('mxd6-canvas');
    var prp = document.getElementById('mxd6-props');
    if (pal) pal.setAttribute('data-mob', panel === 'palette' ? 'show' : '');
    if (cvs) cvs.setAttribute('data-mob', panel === 'canvas' ? 'show' : '');
    if (prp) prp.setAttribute('data-mob', panel === 'props' ? 'show' : '');
    document.querySelectorAll('.mxd6-mob-btn').forEach(function(btn, i) {
      btn.classList.toggle('mxd6-mob-btn--on', ['palette','canvas','props'][i] === panel);
    });
  }

  // ── V6 SELECTION ──
  function _v6SelectSec(sIdx) {
    var prevS = _v6SelSIdx; var prevB = _v6SelBIdx;
    _v6SelSIdx = sIdx; _v6SelBIdx = null;
    if (prevB !== null && prevS !== null) {
      var pr = document.getElementById('mxd6-row-' + prevS + '-' + prevB);
      if (pr) { pr.classList.remove('mxd6-row--sel'); pr.classList.remove('mxd6-tbl-row--sel'); }
    }
    if (prevS !== null) { var ps = document.getElementById('mxd6-sec-' + prevS); if (ps) ps.classList.remove('mxd6-sec--sel'); }
    var ns = document.getElementById('mxd6-sec-' + sIdx);
    if (ns) ns.classList.add('mxd6-sec--sel');
    _v6RefreshProps();
  }

  function _v6SelectRow(sIdx, rIdx) {
    var prevS = _v6SelSIdx; var prevB = _v6SelBIdx;
    _v6SelSIdx = sIdx; _v6SelBIdx = rIdx;
    if (prevB !== null && prevS !== null) {
      var pr = document.getElementById('mxd6-row-' + prevS + '-' + prevB);
      if (pr) { pr.classList.remove('mxd6-row--sel'); pr.classList.remove('mxd6-tbl-row--sel'); }
    }
    if (prevS !== null && prevB === null) { var ps = document.getElementById('mxd6-sec-' + prevS); if (ps) ps.classList.remove('mxd6-sec--sel'); }
    var nr = document.getElementById('mxd6-row-' + sIdx + '-' + rIdx);
    if (nr) { nr.classList.add('mxd6-row--sel'); nr.classList.add('mxd6-tbl-row--sel'); }
    _v6RefreshProps();
  }

  // ── V6 SECTIONS ──
  function _v6AddSection() {
    _v6Push();
    var color = V6_SECTION_COLORS[_builderSecs.length % V6_SECTION_COLORS.length];
    _builderSecs.push({ id: _uid(), label: 'Nouvelle section', color: color, columns: ['etat'], rows: [] });
    _v6RefreshCanvas();
    _v6SelectSec(_builderSecs.length - 1);
  }

  function _v6DelSection(sIdx) {
    if (!confirm('Supprimer cette section et tous ses éléments ?')) return;
    _v6Push();
    _builderSecs.splice(sIdx, 1);
    _v6SelSIdx = null; _v6SelBIdx = null;
    _v6RefreshCanvas(); _v6RefreshProps();
  }

  function _v6DupSection(sIdx) {
    _v6Push();
    var copy = JSON.parse(JSON.stringify(_builderSecs[sIdx]));
    copy.id = _uid(); copy.label += ' (copie)';
    if (copy.rows) { copy.rows.forEach(function(r) { r.id = _uid(); }); }
    else if (copy.blocks) { copy.blocks.forEach(function(b) { b.id = _uid(); }); }
    _builderSecs.splice(sIdx + 1, 0, copy);
    _v6RefreshCanvas(); _v6SelectSec(sIdx + 1);
  }

  function _v6ToggleCollapse(sIdx) {
    _v6SecCollapsed[sIdx] = !_v6SecCollapsed[sIdx];
    _v6RefreshSection(sIdx);
  }

  function _v6SecLabelChange(sIdx, el) {
    var val = (el.textContent || '').trim();
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].label = val || 'Section';
    if (_v6SelSIdx === sIdx && _v6SelBIdx === null) _v6RefreshProps();
  }

  function _v6SecLabelProp(sIdx, val) {
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].label = val;
    var el = document.querySelector('#mxd6-sec-' + sIdx + ' .mxd6-sec-name');
    if (el && el !== document.activeElement) el.textContent = val;
  }

  function _v6SecDesc(sIdx, val) {
    if (_builderSecs[sIdx]) _builderSecs[sIdx].description = val;
  }

  function _v6SecColor(sIdx, color) {
    if (!_builderSecs[sIdx]) return;
    _v6Push();
    _builderSecs[sIdx].color = color;
    _v6RefreshSection(sIdx); _v6RefreshProps();
  }

  function _v6ToggleCol(sIdx, colKey) {
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.rows) return;
    _v6Push();
    var cols = sec.columns || [];
    var idx = cols.indexOf(colKey);
    if (idx >= 0) { cols.splice(idx, 1); } else { cols.push(colKey); }
    sec.columns = cols;
    _v6RefreshSection(sIdx); _v6RefreshProps();
  }

  // ── V6 ELEMENTS ──
  function _v6AddQuick(sIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v6Push();
    if (sec.rows) {
      var row = { id: _uid(), label: 'Contrôle', required: false };
      sec.rows.push(row);
      var newRIdx = sec.rows.length - 1;
      _v6RefreshSection(sIdx);
      _v6SelectRow(sIdx, newRIdx);
      setTimeout(function() {
        var lbl = document.querySelector('#mxd6-row-' + sIdx + '-' + newRIdx + ' .mxd6-row-lbl');
        if (lbl) { lbl.focus(); var r = document.createRange(); r.selectNodeContents(lbl); r.collapse(false); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      }, 50);
    } else {
      var blk = _v5NewRow(null);
      sec.blocks.push(blk);
      var newBIdx = sec.blocks.length - 1;
      _v6RefreshSection(sIdx);
      _v6SelectRow(sIdx, newBIdx);
      setTimeout(function() {
        var lbl2 = document.querySelector('#mxd6-row-' + sIdx + '-' + newBIdx + ' .mxd6-row-lbl');
        if (lbl2) { lbl2.focus(); var r2 = document.createRange(); r2.selectNodeContents(lbl2); r2.collapse(false); var s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(r2); }
      }, 50);
    }
  }

  function _v6AddEl(sIdx, compKey) { /* legacy stub */ }
  function _v6AddStatic(sIdx, type) { /* legacy stub */ }

  function _v6DelEl(sIdx, rIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v6Push();
    if (sec.rows) { sec.rows.splice(rIdx, 1); }
    else { sec.blocks.splice(rIdx, 1); }
    if (_v6SelBIdx === rIdx && _v6SelSIdx === sIdx) _v6SelBIdx = null;
    _v6RefreshSection(sIdx); _v6RefreshProps();
  }

  function _v6DupEl(sIdx, rIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v6Push();
    if (sec.rows) {
      var copy = JSON.parse(JSON.stringify(sec.rows[rIdx]));
      copy.id = _uid();
      sec.rows.splice(rIdx + 1, 0, copy);
    } else {
      var copyB = JSON.parse(JSON.stringify(sec.blocks[rIdx]));
      copyB.id = _uid();
      sec.blocks.splice(rIdx + 1, 0, copyB);
    }
    _v6RefreshSection(sIdx); _v6SelectRow(sIdx, rIdx + 1);
  }

  function _v6MoveEl(sIdx, rIdx, dir) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var arr = sec.rows || sec.blocks;
    var nIdx = rIdx + dir;
    if (nIdx < 0 || nIdx >= arr.length) return;
    _v6Push();
    var tmp = arr[rIdx]; arr[rIdx] = arr[nIdx]; arr[nIdx] = tmp;
    _v6RefreshSection(sIdx); _v6SelectRow(sIdx, nIdx);
  }

  function _v6RowLabelChange(sIdx, rIdx, el) {
    var val = (el.textContent || '').trim();
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var items = sec.rows || sec.blocks || [];
    var item = items[rIdx];
    if (!item) return;
    item.label = val || 'Contrôle';
    if (_v6SelSIdx === sIdx && _v6SelBIdx === rIdx) _v6RefreshProps();
  }

  function _v6PropChange(sIdx, rIdx, key, val) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var items = sec.rows || sec.blocks || [];
    var item = items[rIdx];
    if (!item) return;
    item[key] = val;
    if (key === 'label') {
      var lbl = document.querySelector('#mxd6-row-' + sIdx + '-' + rIdx + ' .mxd6-row-lbl');
      if (lbl && lbl !== document.activeElement) lbl.textContent = val;
    }
  }

  function _v6ToggleProp(sIdx, rIdx, prop) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var items = sec.rows || sec.blocks || [];
    var item = items[rIdx];
    if (!item) return;
    _v6Push();
    item[prop] = !item[prop];
    _v6RefreshRow(sIdx, rIdx);
    if (_v6SelSIdx === sIdx && _v6SelBIdx === rIdx) _v6RefreshProps();
  }

  function _v6ToggleComp(sIdx, bIdx, compKey) {
    var sec = _builderSecs[sIdx];
    if (!sec || !sec.blocks) return;
    var blk = sec.blocks[bIdx];
    if (!blk) return;
    _v6Push();
    blk[compKey] = !blk[compKey];
    if (compKey === 'hasValeur' && blk[compKey] && blk.unit === undefined) blk.unit = '';
    _v6RefreshRow(sIdx, bIdx); _v6RefreshProps();
  }

  function _v6SetUnit(sIdx, rIdx, val) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var items = sec.rows || sec.blocks || [];
    var item = items[rIdx];
    if (!item) return;
    item.unit = val;
    if (sec.rows) {
      var u = document.querySelector('#mxd6-row-' + sIdx + '-' + rIdx + ' .mxd6-cell-unit');
      if (u) u.textContent = val;
    } else {
      var u2 = document.querySelector('#mxd6-row-' + sIdx + '-' + rIdx + ' .mxd6-ctrl-unit');
      if (u2) u2.textContent = val;
      else if (val) {
        var wrap = document.querySelector('#mxd6-row-' + sIdx + '-' + rIdx + ' .mxd6-ctrl-val-wrap');
        if (wrap) { var sp = document.createElement('span'); sp.className = 'mxd6-ctrl-unit'; sp.textContent = val; wrap.appendChild(sp); }
      }
    }
  }

  // ── V6 PALETTE ACTIONS ──
  function _v6PalClick(colKey) {
    var sIdx = (_v6SelSIdx !== null) ? _v6SelSIdx : (_builderSecs.length ? 0 : -1);
    if (sIdx < 0) { _v6AddSection(); sIdx = 0; }
    var sec = _builderSecs[sIdx];
    if (sec && sec.rows) _v6ToggleCol(sIdx, colKey);
  }

  function _v6PalDragStart(e, colKey) {
    _v6DragData = { type: 'col', colKey: colKey };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', colKey || '');
  }

  // ── V6 DRAG & DROP ──
  function _v6SecDragStart(e, sIdx) {
    _v6DragData = { type: 'sec', sIdx: sIdx };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sec-' + sIdx);
  }

  function _v6SecDzOver(e, sIdx) {
    e.preventDefault();
    var el = document.getElementById('mxd6-sec-' + sIdx);
    if (el) el.classList.add('mxd6-sec--dz');
  }

  function _v6SecDzLeave(e, sIdx) {
    var el = document.getElementById('mxd6-sec-' + sIdx);
    if (el) el.classList.remove('mxd6-sec--dz');
  }

  function _v6SecDzDrop(e, sIdx) {
    e.preventDefault(); e.stopPropagation();
    var el = document.getElementById('mxd6-sec-' + sIdx);
    if (el) el.classList.remove('mxd6-sec--dz');
    var dd = _v6DragData; _v6DragData = null;
    if (!dd) return;
    if (dd.type === 'sec' && dd.sIdx !== sIdx) {
      _v6Push();
      var moved = _builderSecs.splice(dd.sIdx, 1)[0];
      var newIdx = sIdx > dd.sIdx ? sIdx - 1 : sIdx;
      _builderSecs.splice(newIdx, 0, moved);
      _v6SelSIdx = null; _v6SelBIdx = null;
      _v6RefreshCanvas(); _v6RefreshProps();
    } else if (dd.type === 'col') {
      var sec = _builderSecs[sIdx];
      if (sec && sec.rows) _v6ToggleCol(sIdx, dd.colKey);
    }
  }

  function _v6RowDragStart(e, sIdx, rIdx) {
    _v6DragData = { type: 'row', sIdx: sIdx, rIdx: rIdx };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'row-' + sIdx + '-' + rIdx);
    e.stopPropagation();
  }

  function _v6RowDzOver(e, sIdx, rIdx) {
    e.preventDefault(); e.stopPropagation();
    var el = document.getElementById('mxd6-row-' + sIdx + '-' + rIdx);
    if (el) { el.classList.add('mxd6-row--dz'); el.classList.add('mxd6-tbl-row--dz'); }
  }

  function _v6RowDzLeave(e, sIdx, rIdx) {
    var el = document.getElementById('mxd6-row-' + sIdx + '-' + rIdx);
    if (el) { el.classList.remove('mxd6-row--dz'); el.classList.remove('mxd6-tbl-row--dz'); }
  }

  function _v6RowDzDrop(e, sIdx, rIdx) {
    e.preventDefault(); e.stopPropagation();
    var el = document.getElementById('mxd6-row-' + sIdx + '-' + rIdx);
    if (el) { el.classList.remove('mxd6-row--dz'); el.classList.remove('mxd6-tbl-row--dz'); }
    var dd = _v6DragData; _v6DragData = null;
    if (!dd) return;
    if (dd.type === 'row') {
      var fromS = dd.sIdx; var fromR = dd.rIdx;
      if (fromS === sIdx && fromR === rIdx) return;
      _v6Push();
      var fromSec = _builderSecs[fromS];
      var toSec = _builderSecs[sIdx];
      var fromArr = fromSec.rows || fromSec.blocks;
      var toArr = toSec.rows || toSec.blocks;
      var movedItem = fromArr.splice(fromR, 1)[0];
      var targetR = (fromS === sIdx && fromR < rIdx) ? rIdx - 1 : rIdx;
      toArr.splice(targetR, 0, movedItem);
      _v6SelSIdx = sIdx; _v6SelBIdx = targetR;
      if (fromS === sIdx) { _v6RefreshSection(sIdx); }
      else { _v6RefreshSection(fromS); _v6RefreshSection(sIdx); }
      _v6RefreshProps();
    } else if (dd.type === 'col') {
      var sec2 = _builderSecs[sIdx];
      if (sec2 && sec2.rows) _v6ToggleCol(sIdx, dd.colKey);
    }
  }

  function _v6CanvasDzOver(e) { e.preventDefault(); }

  function _v6CanvasDzDrop(e) {
    e.preventDefault();
    var dd = _v6DragData; _v6DragData = null;
    if (!dd || dd.type !== 'sec') return;
    _v6Push();
    var moved = _builderSecs.splice(dd.sIdx, 1)[0];
    _builderSecs.push(moved);
    _v6SelSIdx = _builderSecs.length - 1; _v6SelBIdx = null;
    _v6RefreshCanvas(); _v6RefreshProps();
  }


  // ─────────────────────────────────────────────────────
  // V5 BUILDER — COMPACT CONTROL-SHEET UX
  // ─────────────────────────────────────────────────────

  var V5_COMPS = [
    { key: 'hasValeur',      icon: 'fa-hashtag',       l: 'Valeur numérique', color: '#0EA5E9', hasUnit: true },
    { key: 'hasFaitnonfait', icon: 'fa-circle-check',  l: 'Fait / Pas fait',  color: '#22C55E' },
    { key: 'hasOuinon',      icon: 'fa-toggle-on',     l: 'Oui / Non',        color: '#10B981' },
    { key: 'hasCommentaire', icon: 'fa-comment-lines', l: 'Commentaire',      color: '#F59E0B' },
    { key: 'hasPhoto',       icon: 'fa-camera',        l: 'Photo',            color: '#EC4899' },
    { key: 'hasSignature',   icon: 'fa-pen-nib',       l: 'Signature',        color: '#A855F7' },
    { key: 'hasDate',        icon: 'fa-calendar',      l: 'Date',             color: '#F97316' },
    { key: 'hasHeure',       icon: 'fa-clock',         l: 'Heure',            color: '#EF4444' },
  ];

  var V5_STATIC_ELS = [
    { type: 'titre',     icon: 'fa-heading',    l: 'Titre',        desc: 'Titre de section',  color: '#8B5CF6' },
    { type: 'sstitre',   icon: 'fa-text-height',l: 'Sous-titre',   desc: 'Sous-titre',        color: '#6366F1' },
    { type: 'separator', icon: 'fa-minus',      l: 'Séparateur',   desc: 'Ligne de séparation',color: '#475569' },
    { type: 'texte',     icon: 'fa-align-left', l: 'Texte simple', desc: 'Bloc de texte libre',color: '#64748B' },
  ];

  function _v5NewRow(comp) {
    var blk = { id: _uid(), type: 'v5row', label: 'Nouveau contrôle', required: false };
    V5_COMPS.forEach(function (c) { blk[c.key] = (c.key === comp); });
    if (comp === 'hasValeur') blk.unit = '';
    if (!comp) blk.hasFaitnonfait = true; // default
    return blk;
  }

  function _renderBuilderV5(mc) {
    var tpl = _builderTpl || {};
    var status  = tpl.status || 'draft';
    var statusL = STATUS_LABELS[status] || 'Brouillon';
    var statusCls = status === 'published' ? 'mxd5-badge--pub' : status === 'archived' ? 'mxd5-badge--arch' : 'mxd5-badge--draft';
    mc.innerHTML =
      '<div class="mxd5-builder" id="mxd5-root">'
      + _v5TopBarHTML(tpl, statusL, statusCls)
      + '<div class="mxd5-layout">'
      + '<div class="mxd5-activity-bar" id="mxd5-nav">' + _v5NavHTML() + '</div>'
      + '<div class="mxd5-left-panel" id="mxd5-left">' + _v5LeftPanelHTML() + '</div>'
      + '<div class="mxd5-canvas-wrap" id="mxd5-canvas">' + _v5CanvasHTML() + '</div>'
      + '<div class="mxd5-props-panel" id="mxd5-props">' + _v5PropsPanelHTML() + '</div>'
      + '</div>'
      + _v5MobNavHTML()
      + '</div>';
    var root = document.getElementById('mxd5-root');
    if (root) {
      root.addEventListener('click', function (ev) {
        if (!ev.target.closest('.mxd5-add-menu') && !ev.target.closest('.mxd5-add-row-btn')) _v5HideAddMenu();
      });
    }
    _v5UpdateUndoRedo();
  }

  function _v5TopBarHTML(tpl, statusL, statusCls) {
    var e = _e;
    return '<div class="mxd5-topbar">'
      + '<div class="mxd5-topbar-left">'
      + '<button class="mxd5-back-btn" onclick="MX.Pages.MxDoc._closeBuilder()" title="Retour"><i class="fas fa-arrow-left"></i></button>'
      + '<div class="mxd5-topbar-brand"><span class="mxd5-brand-name">MX Doc</span><span class="mxd5-brand-sub">Édition du modèle</span></div>'
      + '<div class="mxd5-topbar-div"></div>'
      + '<input class="mxd5-title-inp" id="mxd5-title" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…" oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      + '<span class="mxd5-badge ' + statusCls + '">' + statusL + '</span>'
      + '</div>'
      + '<div class="mxd5-topbar-right">'
      + '<button class="mxd5-tb-btn" id="mxd5-undo" onclick="MX.Pages.MxDoc._v5Undo()" title="Annuler" disabled><i class="fas fa-rotate-left"></i></button>'
      + '<button class="mxd5-tb-btn" id="mxd5-redo" onclick="MX.Pages.MxDoc._v5Redo()" title="Rétablir" disabled><i class="fas fa-rotate-right"></i></button>'
      + '<div class="mxd5-topbar-div"></div>'
      + '<button class="mxd5-preview-btn" onclick="MX.Pages.MxDoc._v5Preview()"><i class="fas fa-eye"></i><span> Aperçu</span></button>'
      + '<button class="mxd5-save-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'draft\')"><i class="fas fa-floppy-disk"></i><span> Enregistrer</span></button>'
      + '<button class="mxd5-pub-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'published\')"><i class="fas fa-paper-plane"></i><span> Publier</span></button>'
      + '</div></div>';
  }

  function _v5NavHTML() {
    var tabs = [
      { id: 'elements', icon: 'fa-grid-2',           l: 'Éléments'  },
      { id: 'sections', icon: 'fa-layer-group',       l: 'Sections'  },
      { id: 'model',    icon: 'fa-file-lines',        l: 'Modèle'    },
    ];
    var h = '<button class="mxd5-nav-fab" onclick="MX.Pages.MxDoc._v5NavSwitch(\'elements\')" title="Ajouter"><i class="fas fa-plus"></i><span>Ajouter</span></button>';
    tabs.forEach(function (t) {
      h += '<button class="mxd5-nav-btn' + (_v5NavTab === t.id ? ' mxd5-nav-btn--on' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._v5NavSwitch(\'' + t.id + '\')" title="' + t.l + '">'
        + '<i class="fas ' + t.icon + '"></i><span>' + t.l + '</span></button>';
    });
    return h;
  }

  function _v5LeftPanelHTML() {
    if (_v5NavTab === 'sections') return _v5SecListHTML();
    if (_v5NavTab === 'model')    return _v5ModelPropsHTML();
    return _v5ElListHTML();
  }

  function _v5ElListHTML() {
    var targetSIdx = _v5SelSIdx !== null ? _v5SelSIdx : (_builderSecs.length ? _builderSecs.length - 1 : 0);
    var h = '<div class="mxd5-lp-hdr"><span>ÉLÉMENTS</span><span class="mxd5-lp-sub">Glissez ou cliquez pour ajouter</span></div>'
      + '<div class="mxd5-el-list" id="mxd5-el-list">';
    V5_COMPS.forEach(function (c) {
      h += '<div class="mxd5-el-card" draggable="true"'
        + ' ondragstart="MX.Pages.MxDoc._v5ElDragStart(event,\'' + c.key + '\')"'
        + ' onclick="MX.Pages.MxDoc._v5AddEl(' + targetSIdx + ',\'' + c.key + '\')">'
        + '<div class="mxd5-el-card-icon" style="color:' + c.color + ';background:' + c.color + '18"><i class="fas ' + c.icon + '"></i></div>'
        + '<div class="mxd5-el-card-body"><div class="mxd5-el-card-name">' + c.l + '</div></div>'
        + '</div>';
    });
    h += '<div class="mxd5-lp-section-hdr">MISE EN FORME</div>';
    V5_STATIC_ELS.forEach(function (s) {
      h += '<div class="mxd5-el-card" draggable="true"'
        + ' ondragstart="MX.Pages.MxDoc._v5ElDragStart(event,\'static:' + s.type + '\')"'
        + ' onclick="MX.Pages.MxDoc._v5AddStatic(' + targetSIdx + ',\'' + s.type + '\')">'
        + '<div class="mxd5-el-card-icon" style="color:' + s.color + ';background:' + s.color + '18"><i class="fas ' + s.icon + '"></i></div>'
        + '<div class="mxd5-el-card-body"><div class="mxd5-el-card-name">' + s.l + '</div><div class="mxd5-el-card-desc">' + s.desc + '</div></div>'
        + '</div>';
    });
    h += '</div><div class="mxd5-lp-footer">'
      + '<button class="mxd5-lp-add-sec" onclick="MX.Pages.MxDoc._v5AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div>';
    return h;
  }

  function _v5SecListHTML() {
    var h = '<div class="mxd5-lp-hdr"><span>SECTIONS</span></div>'
      + '<div class="mxd5-sec-list">';
    _builderSecs.forEach(function (sec, sIdx) {
      var color = sec.color || SEC_COLORS[sIdx % SEC_COLORS.length];
      h += '<div class="mxd5-sec-list-item' + (_v5SelSIdx === sIdx && _v5SelBIdx === null ? ' mxd5-sec-list-item--sel' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._v5SelectSec(' + sIdx + ')">'
        + '<span class="mxd5-sec-dot" style="background:' + color + '"></span>'
        + '<span class="mxd5-sec-list-name">' + _e(sec.label || 'Section') + '</span>'
        + '<span class="mxd5-sec-list-count">' + (sec.blocks || []).length + '</span>'
        + '</div>';
    });
    h += '</div><div class="mxd5-lp-footer">'
      + '<button class="mxd5-lp-add-sec" onclick="MX.Pages.MxDoc._v5AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div>';
    return h;
  }

  function _v5ModelPropsHTML() {
    var tpl = _builderTpl || {};
    var e = _e;
    var freqOpts = Object.keys(FREQ_LABELS).map(function (k) {
      return '<option value="' + k + '"' + (tpl.frequency === k ? ' selected' : '') + '>' + FREQ_LABELS[k] + '</option>';
    }).join('');
    return '<div class="mxd5-lp-hdr"><span>MODÈLE</span></div>'
      + '<div class="mxd5-model-props">'
      + '<div class="mxd5-mp-group"><label>Description</label>'
      + '<textarea class="mxd5-mp-inp" rows="3" oninput="MX.Pages.MxDoc._bldDescChange(this.value)">' + e(tpl.description || '') + '</textarea></div>'
      + '<div class="mxd5-mp-group"><label>Fréquence</label>'
      + '<select class="mxd5-mp-inp" onchange="MX.Pages.MxDoc._bldFreqChange(this.value)">' + freqOpts + '</select></div>'
      + '<div class="mxd5-mp-group"><label>Couleur</label>'
      + '<input type="color" class="mxd5-mp-color" value="' + e(tpl.color || '#8B5CF6') + '" oninput="MX.Pages.MxDoc._bldColorChange(this.value)"></div>'
      + '</div>';
  }

  function _v5CanvasHTML() {
    var secsH = _builderSecs.map(function (sec, sIdx) { return _v5SectionHTML(sec, sIdx); }).join('');
    return '<div class="mxd5-canvas" id="mxd5-canvas-inner">'
      + secsH
      + '<div class="mxd5-canvas-add-sec">'
      + '<button class="mxd5-add-sec-btn" onclick="MX.Pages.MxDoc._v5AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div></div>';
  }

  function _v5SectionHTML(sec, sIdx) {
    var e     = _e;
    var color = sec.color || SEC_COLORS[sIdx % SEC_COLORS.length];
    var coll  = !!_v5SecCollapsed[sIdx];
    var isSel = (_v5SelSIdx === sIdx && _v5SelBIdx === null);
    var blocksH = coll ? '' : (sec.blocks || []).map(function (blk, bIdx) { return _v5RowHTML(blk, sIdx, bIdx); }).join('');
    var addH = coll ? '' : '<div class="mxd5-add-row-wrap" id="mxd5-addrow-' + sIdx + '" style="position:relative">'
      + '<button class="mxd5-add-row-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v5ShowAddMenu(' + sIdx + ')"><i class="fas fa-plus"></i> Ajouter une ligne</button>'
      + (_v5AddMenuSIdx === sIdx ? _v5AddMenuHTML(sIdx) : '')
      + '</div>';
    return '<div class="mxd5-section' + (isSel ? ' mxd5-section--sel' : '') + '" data-sidx="' + sIdx + '" style="--sec-color:' + color + '"'
      + ' ondragover="MX.Pages.MxDoc._v5SecDzOver(event,' + sIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v5SecDzLeave(event,' + sIdx + ')">'
      + '<div class="mxd5-sec-hdr" onclick="MX.Pages.MxDoc._v5SelectSec(' + sIdx + ')">'
      + '<div class="mxd5-sec-drag" draggable="true" ondragstart="MX.Pages.MxDoc._v5SecDragStart(event,' + sIdx + ')" onclick="event.stopPropagation()"><i class="fas fa-grip-vertical"></i></div>'
      + '<div class="mxd5-sec-icon-wrap"><i class="fas fa-building"></i></div>'
      + '<div class="mxd5-sec-info">'
      + '<input class="mxd5-sec-title-inp" value="' + e(sec.label || '') + '" placeholder="Nom de la section…"'
      + ' oninput="MX.Pages.MxDoc._v5SecLabel(' + sIdx + ',this.value)" onclick="event.stopPropagation()">'
      + (sec.description ? '<div class="mxd5-sec-desc">' + e(sec.description) + '</div>' : '')
      + '</div>'
      + '<div class="mxd5-sec-acts">'
      + '<button class="mxd5-sec-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v5ToggleCollapse(' + sIdx + ')" title="' + (coll ? 'Développer' : 'Réduire') + '"><i class="fas fa-chevron-' + (coll ? 'down' : 'up') + '"></i></button>'
      + '<button class="mxd5-sec-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v5DupSection(' + sIdx + ')" title="Dupliquer"><i class="fas fa-copy"></i></button>'
      + '<button class="mxd5-sec-act mxd5-sec-act--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v5DelSection(' + sIdx + ')" title="Supprimer"><i class="fas fa-trash"></i></button>'
      + '</div></div>'
      + '<div class="mxd5-sec-body" id="mxd5-sec-body-' + sIdx + '"'
      + ' ondragover="MX.Pages.MxDoc._v5ElDzOver(event,' + sIdx + ')"'
      + ' ondrop="MX.Pages.MxDoc._v5ElDzDrop(event,' + sIdx + ')">'
      + blocksH + '</div>'
      + addH + '</div>';
  }

  function _v5RowHTML(blk, sIdx, bIdx) {
    if (blk.type !== 'v5row') return _v5StaticRowHTML(blk, sIdx, bIdx);
    var e   = _e;
    var sel = (_v5SelSIdx === sIdx && _v5SelBIdx === bIdx);
    return '<div class="mxd5-row' + (sel ? ' mxd5-row--sel' : '') + '" data-sidx="' + sIdx + '" data-bidx="' + bIdx + '"'
      + ' onclick="MX.Pages.MxDoc._v5SelectRow(' + sIdx + ',' + bIdx + ',event)"'
      + ' draggable="true" ondragstart="MX.Pages.MxDoc._v5ElRowDragStart(event,' + sIdx + ',' + bIdx + ')">'
      + (sel ? _v5FloatBarHTML(sIdx, bIdx) : '')
      + '<div class="mxd5-row-grip"><i class="fas fa-grip-vertical"></i></div>'
      + '<div class="mxd5-row-body">'
      + '<div class="mxd5-row-label">' + e(blk.label || 'Contrôle') + (blk.required ? '<span class="mxd5-req"> *</span>' : '') + '</div>'
      + '<div class="mxd5-row-comps">' + _v5RowCompsHTML(blk) + '</div>'
      + '</div>'
      + '<button class="mxd5-row-opts" onclick="event.stopPropagation()"><i class="fas fa-ellipsis-v"></i></button>'
      + '</div>';
  }

  function _v5StaticRowHTML(blk, sIdx, bIdx) {
    var e   = _e;
    var bt  = _btInfo(blk.type);
    var sel = (_v5SelSIdx === sIdx && _v5SelBIdx === bIdx);
    var content = '';
    if (blk.type === 'titre')     content = '<div class="mxd5-static-titre">' + e(blk.value || blk.label || 'Titre') + '</div>';
    else if (blk.type === 'sstitre')  content = '<div class="mxd5-static-sstitre">' + e(blk.value || blk.label || 'Sous-titre') + '</div>';
    else if (blk.type === 'separator') content = '<div class="mxd5-static-sep"><hr></div>';
    else if (blk.type === 'texte')    content = '<div class="mxd5-static-texte">' + e(blk.value || blk.label || 'Texte…') + '</div>';
    return '<div class="mxd5-static-row' + (sel ? ' mxd5-row--sel' : '') + '" data-sidx="' + sIdx + '" data-bidx="' + bIdx + '"'
      + ' onclick="MX.Pages.MxDoc._v5SelectRow(' + sIdx + ',' + bIdx + ',event)"'
      + ' draggable="true" ondragstart="MX.Pages.MxDoc._v5ElRowDragStart(event,' + sIdx + ',' + bIdx + ')">'
      + (sel ? _v5FloatBarHTML(sIdx, bIdx) : '')
      + '<div class="mxd5-row-grip"><i class="fas fa-grip-vertical"></i></div>'
      + content
      + '<button class="mxd5-row-opts" onclick="event.stopPropagation()"><i class="fas fa-ellipsis-v"></i></button>'
      + '</div>';
  }

  function _v5RowCompsHTML(blk) {
    var h = '';
    if (blk.hasValeur) {
      h += '<div class="mxd5-comp-val">'
        + '<input class="mxd5-val-inp" type="number" placeholder="—" disabled>'
        + (blk.unit ? '<span class="mxd5-unit">' + _e(blk.unit) + '</span>' : '')
        + '</div>';
    }
    if (blk.hasFaitnonfait) {
      var lf = blk.labelFait || 'Fait'; var lnf = blk.labelNonFait || 'Pas fait';
      h += '<div class="mxd5-comp-fnf">'
        + '<button class="mxd5-fnf-btn mxd5-fnf-fait"><i class="fas fa-check"></i> ' + _e(lf) + '</button>'
        + '<button class="mxd5-fnf-btn mxd5-fnf-nonfait"><i class="fas fa-times"></i> ' + _e(lnf) + '</button>'
        + '</div>';
    }
    if (blk.hasOuinon) {
      var lo = blk.labelOui || 'Oui'; var lno = blk.labelNon || 'Non';
      h += '<div class="mxd5-comp-yn">'
        + '<button class="mxd5-yn-btn mxd5-yn-oui"><i class="fas fa-check"></i> ' + _e(lo) + '</button>'
        + '<button class="mxd5-yn-btn mxd5-yn-non"><i class="fas fa-times"></i> ' + _e(lno) + '</button>'
        + '</div>';
    }
    if (blk.hasDate)        h += '<div class="mxd5-comp-small"><i class="fas fa-calendar"></i></div>';
    if (blk.hasHeure)       h += '<div class="mxd5-comp-small"><i class="fas fa-clock"></i></div>';
    if (blk.hasCommentaire) h += '<div class="mxd5-comp-expand-ic" title="Commentaire"><i class="fas fa-comment-lines"></i></div>';
    if (blk.hasPhoto)       h += '<div class="mxd5-comp-expand-ic" title="Photo"><i class="fas fa-camera"></i></div>';
    if (blk.hasSignature)   h += '<div class="mxd5-comp-expand-ic" title="Signature"><i class="fas fa-pen-nib"></i></div>';
    return h;
  }

  function _v5FloatBarHTML(sIdx, bIdx) {
    return '<div class="mxd5-float-bar" onclick="event.stopPropagation()">'
      + '<button title="Dupliquer" onclick="MX.Pages.MxDoc._v5DupEl(' + sIdx + ',' + bIdx + ')"><i class="fas fa-copy"></i></button>'
      + '<button title="Monter" onclick="MX.Pages.MxDoc._v5MoveEl(' + sIdx + ',' + bIdx + ',-1)"><i class="fas fa-chevron-up"></i></button>'
      + '<button title="Descendre" onclick="MX.Pages.MxDoc._v5MoveEl(' + sIdx + ',' + bIdx + ',1)"><i class="fas fa-chevron-down"></i></button>'
      + '<div class="mxd5-float-sep"></div>'
      + '<button title="Supprimer" class="mxd5-fb-del" onclick="MX.Pages.MxDoc._v5DelEl(' + sIdx + ',' + bIdx + ')"><i class="fas fa-trash"></i></button>'
      + '</div>';
  }

  function _v5AddMenuHTML(sIdx) {
    var h = '<div class="mxd5-add-menu" onclick="event.stopPropagation()">';
    V5_COMPS.forEach(function (c) {
      h += '<button class="mxd5-add-menu-item" onclick="MX.Pages.MxDoc._v5AddEl(' + sIdx + ',\'' + c.key + '\')">'
        + '<span class="mxd5-ami-icon" style="color:' + c.color + '"><i class="fas ' + c.icon + '"></i></span>'
        + '<span>' + c.l + '</span></button>';
    });
    return h + '</div>';
  }

  function _v5PropsPanelHTML() {
    if (_v5SelSIdx !== null && _v5SelBIdx !== null) {
      var sec = _builderSecs[_v5SelSIdx];
      var blk = sec && sec.blocks[_v5SelBIdx];
      if (blk) return _v5ElPropsPanelHTML(blk);
    }
    if (_v5SelSIdx !== null) return _v5SecPropsPanelHTML();
    return _v5DocPropsPanelHTML();
  }

  function _v5DocPropsPanelHTML() {
    return '<div class="mxd5-pp-hdr">PROPRIÉTÉS</div>'
      + '<div class="mxd5-pp-empty"><i class="fas fa-mouse-pointer"></i><p>Cliquez sur une ligne ou une section pour la modifier.</p></div>';
  }

  function _v5SecPropsPanelHTML() {
    var sec   = _builderSecs[_v5SelSIdx];
    if (!sec) return _v5DocPropsPanelHTML();
    var e     = _e;
    var color = sec.color || SEC_COLORS[_v5SelSIdx % SEC_COLORS.length];
    var swatches = SEC_COLORS.map(function (c) {
      return '<button class="mxd5-swatch' + (color === c ? ' mxd5-swatch--on' : '') + '"'
        + ' style="background:' + c + '" onclick="MX.Pages.MxDoc._v5SecColor(' + _v5SelSIdx + ',\'' + c + '\')"></button>';
    }).join('');
    return '<div class="mxd5-pp-hdr">SECTION</div>'
      + '<div class="mxd5-pp-body">'
      + '<div class="mxd5-pp-group"><label>Nom</label>'
      + '<input class="mxd5-pp-inp" value="' + e(sec.label || '') + '" placeholder="Nom de la section…"'
      + ' oninput="MX.Pages.MxDoc._v5SecLabel(' + _v5SelSIdx + ',this.value)"></div>'
      + '<div class="mxd5-pp-group"><label>Description</label>'
      + '<textarea class="mxd5-pp-inp" rows="2" oninput="MX.Pages.MxDoc._v5SecDesc(' + _v5SelSIdx + ',this.value)">' + e(sec.description || '') + '</textarea></div>'
      + '<div class="mxd5-pp-group"><label>Couleur</label><div class="mxd5-swatches">' + swatches + '</div></div>'
      + '<div class="mxd5-pp-actions"><button class="mxd5-pp-del" onclick="MX.Pages.MxDoc._v5DelSection(' + _v5SelSIdx + ')"><i class="fas fa-trash"></i> Supprimer la section</button></div>'
      + '</div>';
  }

  function _v5ElPropsPanelHTML(blk) {
    var e = _e;
    if (blk.type !== 'v5row') return _v5StaticPropsPanelHTML(blk);
    var compsH = '<div class="mxd5-pp-comps">';
    V5_COMPS.forEach(function (c) {
      var on = !!blk[c.key];
      compsH += '<div class="mxd5-pp-comp-row">'
        + '<label class="mxd5-pp-comp-label">'
        + '<input type="checkbox"' + (on ? ' checked' : '') + ' onchange="MX.Pages.MxDoc._v5ToggleComp(\'' + c.key + '\',this.checked)">'
        + '<span class="mxd5-pp-comp-icon" style="color:' + c.color + '"><i class="fas ' + c.icon + '"></i></span>'
        + '<span>' + c.l + '</span>'
        + '</label>'
        + (c.key === 'hasValeur' && on
          ? '<input class="mxd5-pp-unit-inp" value="' + e(blk.unit || '') + '" placeholder="Unité…" oninput="MX.Pages.MxDoc._v5SetUnit(this.value)">'
          : '')
        + '</div>';
    });
    compsH += '</div>';
    var toggleRow = function (label, key, val) {
      return '<div class="mxd5-pp-toggle-row"><span>' + label + '</span>'
        + '<button class="mxd5-toggle' + (val ? ' mxd5-toggle--on' : '') + '" onclick="MX.Pages.MxDoc._v5ToggleProp(\'' + key + '\',this)"></button></div>';
    };
    return '<div class="mxd5-pp-hdr">NOM DU CONTRÔLE</div>'
      + '<div class="mxd5-pp-body">'
      + '<div class="mxd5-pp-group">'
      + '<input class="mxd5-pp-inp mxd5-pp-label-inp" value="' + e(blk.label || '') + '" placeholder="Nom du contrôle…"'
      + ' oninput="MX.Pages.MxDoc._v5PropChange(\'label\',this.value)"></div>'
      + '<div class="mxd5-pp-sep"></div>'
      + '<div class="mxd5-pp-group-hdr">COMPOSANTS</div>'
      + compsH
      + '<div class="mxd5-pp-sep"></div>'
      + '<div class="mxd5-pp-toggles">'
      + toggleRow('OBLIGATOIRE', 'required', !!blk.required)
      + '</div>'
      + '<div class="mxd5-pp-actions"><button class="mxd5-pp-del" onclick="MX.Pages.MxDoc._v5DelEl(' + _v5SelSIdx + ',' + _v5SelBIdx + ')"><i class="fas fa-trash"></i> Supprimer la ligne</button></div>'
      + '</div>';
  }

  function _v5StaticPropsPanelHTML(blk) {
    var e  = _e;
    var bt = _btInfo(blk.type);
    var needsVal = (blk.type === 'titre' || blk.type === 'sstitre' || blk.type === 'texte');
    return '<div class="mxd5-pp-hdr">' + bt.l.toUpperCase() + '</div>'
      + '<div class="mxd5-pp-body">'
      + '<div class="mxd5-pp-group"><label>Libellé</label>'
      + '<input class="mxd5-pp-inp" value="' + e(blk.label || '') + '" placeholder="Libellé…" oninput="MX.Pages.MxDoc._v5PropChange(\'label\',this.value)"></div>'
      + (needsVal ? '<div class="mxd5-pp-group"><label>Contenu</label>'
        + '<textarea class="mxd5-pp-inp" rows="3" oninput="MX.Pages.MxDoc._v5PropChange(\'value\',this.value)">' + e(blk.value || '') + '</textarea></div>' : '')
      + '<div class="mxd5-pp-actions"><button class="mxd5-pp-del" onclick="MX.Pages.MxDoc._v5DelEl(' + _v5SelSIdx + ',' + _v5SelBIdx + ')"><i class="fas fa-trash"></i> Supprimer</button></div>'
      + '</div>';
  }

  function _v5MobNavHTML() {
    return '<div class="mxd5-mob-nav">'
      + '<button class="mxd5-mob-btn' + (_v5MobPanel === 'elements' ? ' mxd5-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v5MobSwitch(\'elements\')"><i class="fas fa-grid-2"></i><span>Éléments</span></button>'
      + '<button class="mxd5-mob-btn' + (_v5MobPanel === 'sections' ? ' mxd5-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v5MobSwitch(\'sections\')"><i class="fas fa-layer-group"></i><span>Sections</span></button>'
      + '<button class="mxd5-mob-fab" onclick="MX.Pages.MxDoc._v5AddSection()"><i class="fas fa-plus"></i></button>'
      + '<button class="mxd5-mob-btn' + (_v5MobPanel === 'canvas' ? ' mxd5-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v5MobSwitch(\'canvas\')"><i class="fas fa-eye"></i><span>Aperçu</span></button>'
      + '</div>';
  }

  // ── V5 REFRESH ──
  function _v5RefreshCanvas() {
    var el = document.getElementById('mxd5-canvas-inner');
    if (!el) return;
    el.innerHTML = _builderSecs.map(function (sec, sIdx) { return _v5SectionHTML(sec, sIdx); }).join('')
      + '<div class="mxd5-canvas-add-sec"><button class="mxd5-add-sec-btn" onclick="MX.Pages.MxDoc._v5AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button></div>';
  }

  function _v5RefreshSection(sIdx) {
    var old = document.querySelector('.mxd5-section[data-sidx="' + sIdx + '"],.mxd5-static-row[data-sidx="' + sIdx + '"]');
    var parent = document.getElementById('mxd5-canvas-inner');
    var oldSec = parent && parent.querySelector('[data-sidx="' + sIdx + '"].mxd5-section');
    if (!oldSec) { _v5RefreshCanvas(); return; }
    var sec = _builderSecs[sIdx];
    if (!sec) { _v5RefreshCanvas(); return; }
    var d = document.createElement('div');
    d.innerHTML = _v5SectionHTML(sec, sIdx);
    oldSec.parentNode.replaceChild(d.firstChild, oldSec);
  }

  function _v5RefreshRow(sIdx, bIdx) {
    var old = document.querySelector('.mxd5-row[data-sidx="' + sIdx + '"][data-bidx="' + bIdx + '"],.mxd5-static-row[data-sidx="' + sIdx + '"][data-bidx="' + bIdx + '"]');
    if (!old) { _v5RefreshSection(sIdx); return; }
    var sec = _builderSecs[sIdx]; var blk = sec && sec.blocks[bIdx];
    if (!blk) { _v5RefreshSection(sIdx); return; }
    var d = document.createElement('div');
    d.innerHTML = _v5RowHTML(blk, sIdx, bIdx);
    old.parentNode.replaceChild(d.firstChild, old);
  }

  function _v5RefreshProps() {
    var el = document.getElementById('mxd5-props');
    if (el) el.innerHTML = _v5PropsPanelHTML();
  }

  function _v5RefreshLeftPanel() {
    var el = document.getElementById('mxd5-left');
    if (el) el.innerHTML = _v5LeftPanelHTML();
  }

  function _v5RefreshNav() {
    var el = document.getElementById('mxd5-nav');
    if (el) el.innerHTML = _v5NavHTML();
  }

  // ── V5 UNDO/REDO ──
  function _v5Push() {
    _v2History.push(JSON.stringify(_builderSecs));
    if (_v2History.length > 50) _v2History.shift();
    _v2Future = [];
    _v5UpdateUndoRedo();
  }

  function _v5UpdateUndoRedo() {
    var u = document.getElementById('mxd5-undo');
    var r = document.getElementById('mxd5-redo');
    if (u) u.disabled = !_v2History.length;
    if (r) r.disabled = !_v2Future.length;
  }

  function _v5Undo() {
    if (!_v2History.length) return;
    _v2Future.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2History.pop());
    _v5SelSIdx = null; _v5SelBIdx = null;
    _v5RefreshCanvas(); _v5RefreshProps(); _v5RefreshLeftPanel(); _v5UpdateUndoRedo();
  }

  function _v5Redo() {
    if (!_v2Future.length) return;
    _v2History.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2Future.pop());
    _v5SelSIdx = null; _v5SelBIdx = null;
    _v5RefreshCanvas(); _v5RefreshProps(); _v5RefreshLeftPanel(); _v5UpdateUndoRedo();
  }

  function _v5Preview() {
    if (!_builderTpl) return;
    var copy = JSON.parse(JSON.stringify(_builderTpl));
    copy.sections = JSON.parse(JSON.stringify(_builderSecs));
    _execTemplate = copy; _execMode = true; _builderMode = false; render();
  }

  // ── V5 NAV ──
  function _v5NavSwitch(tab) {
    _v5NavTab = tab; _v5RefreshNav(); _v5RefreshLeftPanel();
  }

  function _v5MobSwitch(panel) {
    _v5MobPanel = panel;
    var lp = document.getElementById('mxd5-left');
    var cw = document.getElementById('mxd5-canvas');
    var pp = document.getElementById('mxd5-props');
    if (lp) lp.setAttribute('data-mob', (panel === 'elements' || panel === 'sections') ? 'active' : '');
    if (cw) cw.setAttribute('data-mob', panel === 'canvas' ? 'active' : '');
    if (pp) pp.setAttribute('data-mob', panel === 'props' ? 'active' : '');
  }

  // ── V5 SELECTION ──
  function _v5SelectSec(sIdx) {
    var prevS = _v5SelSIdx; var prevB = _v5SelBIdx;
    _v5SelSIdx = sIdx; _v5SelBIdx = null;
    if (prevB !== null && prevS !== null) _v5RefreshRow(prevS, prevB);
    if (prevS !== null && prevB === null && prevS !== sIdx) {
      var ps = document.querySelector('.mxd5-section[data-sidx="' + prevS + '"]');
      if (ps) ps.classList.remove('mxd5-section--sel');
    }
    var ns = document.querySelector('.mxd5-section[data-sidx="' + sIdx + '"]');
    if (ns) ns.classList.add('mxd5-section--sel');
    _v5RefreshProps();
  }

  function _v5SelectRow(sIdx, bIdx, ev) {
    if (ev) ev.stopPropagation();
    var prevS = _v5SelSIdx; var prevB = _v5SelBIdx;
    _v5SelSIdx = sIdx; _v5SelBIdx = bIdx;
    if (prevB !== null && (prevS !== sIdx || prevB !== bIdx)) _v5RefreshRow(prevS, prevB);
    _v5RefreshRow(sIdx, bIdx);
    _v5RefreshProps();
  }

  // ── V5 ADD MENU ──
  function _v5ShowAddMenu(sIdx) {
    var prev = _v5AddMenuSIdx; _v5AddMenuSIdx = sIdx;
    if (prev !== null && prev !== sIdx) _v5RefreshSection(prev);
    _v5RefreshSection(sIdx);
  }

  function _v5HideAddMenu() {
    if (_v5AddMenuSIdx === null) return;
    var prev = _v5AddMenuSIdx; _v5AddMenuSIdx = null; _v5RefreshSection(prev);
  }

  // ── V5 SECTION ACTIONS ──
  function _v5AddSection() {
    _v5Push();
    var color = SEC_COLORS[_builderSecs.length % SEC_COLORS.length];
    _builderSecs.push({ id: _uid(), label: 'Section ' + (_builderSecs.length + 1), color: color, blocks: [] });
    _v5SelSIdx = _builderSecs.length - 1; _v5SelBIdx = null;
    _v5RefreshCanvas(); _v5RefreshProps(); _v5RefreshLeftPanel();
    var ns = document.querySelector('.mxd5-section[data-sidx="' + _v5SelSIdx + '"]');
    if (ns) ns.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _v5DelSection(sIdx) {
    if (_builderSecs.length <= 1) { MX.toast('Impossible de supprimer la dernière section', true); return; }
    _v5Push();
    _builderSecs.splice(sIdx, 1);
    if (_v5SelSIdx >= sIdx) { _v5SelSIdx = Math.max(0, _v5SelSIdx - 1); _v5SelBIdx = null; }
    _v5RefreshCanvas(); _v5RefreshProps(); _v5RefreshLeftPanel();
  }

  function _v5DupSection(sIdx) {
    _v5Push();
    var copy = JSON.parse(JSON.stringify(_builderSecs[sIdx]));
    copy.id = _uid(); copy.label = 'Copie — ' + copy.label;
    copy.blocks = (copy.blocks || []).map(function (b) { var nb = JSON.parse(JSON.stringify(b)); nb.id = _uid(); return nb; });
    _builderSecs.splice(sIdx + 1, 0, copy);
    _v5SelSIdx = sIdx + 1; _v5SelBIdx = null;
    _v5RefreshCanvas(); _v5RefreshProps(); _v5RefreshLeftPanel();
  }

  function _v5ToggleCollapse(sIdx) {
    _v5SecCollapsed[sIdx] = !_v5SecCollapsed[sIdx]; _v5RefreshSection(sIdx);
  }

  function _v5SecLabel(sIdx, v) {
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].label = v;
    if (_v5NavTab === 'sections') _v5RefreshLeftPanel();
  }

  function _v5SecDesc(sIdx, v) { if (_builderSecs[sIdx]) _builderSecs[sIdx].description = v; }

  function _v5SecColor(sIdx, color) {
    if (!_builderSecs[sIdx]) return;
    _v5Push(); _builderSecs[sIdx].color = color;
    _v5RefreshSection(sIdx); _v5RefreshProps();
  }

  // ── V5 ELEMENT ACTIONS ──
  function _v5AddEl(sIdx, compKey) {
    if (!_builderSecs[sIdx]) sIdx = _builderSecs.length - 1;
    _v5Push();
    var blk = _v5NewRow(compKey);
    _builderSecs[sIdx].blocks.push(blk);
    _v5SelSIdx = sIdx; _v5SelBIdx = _builderSecs[sIdx].blocks.length - 1;
    _v5HideAddMenu();
    _v5RefreshSection(sIdx); _v5RefreshProps();
    var nr = document.querySelector('.mxd5-row[data-sidx="' + sIdx + '"][data-bidx="' + _v5SelBIdx + '"]');
    if (nr) nr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _v5AddStatic(sIdx, type) {
    if (!_builderSecs[sIdx]) sIdx = _builderSecs.length - 1;
    _v5Push();
    var bt = _btInfo(type);
    _builderSecs[sIdx].blocks.push({ id: _uid(), type: type, label: bt.l, value: '' });
    _v5SelSIdx = sIdx; _v5SelBIdx = _builderSecs[sIdx].blocks.length - 1;
    _v5RefreshSection(sIdx); _v5RefreshProps();
  }

  function _v5DelEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx]; if (!sec) return;
    _v5Push(); sec.blocks.splice(bIdx, 1);
    if (_v5SelSIdx === sIdx && _v5SelBIdx === bIdx) _v5SelBIdx = null;
    else if (_v5SelSIdx === sIdx && _v5SelBIdx > bIdx) _v5SelBIdx--;
    _v5RefreshSection(sIdx); _v5RefreshProps(); _v5RefreshLeftPanel();
  }

  function _v5DupEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx]; if (!sec) return;
    _v5Push();
    var copy = JSON.parse(JSON.stringify(sec.blocks[bIdx])); copy.id = _uid();
    sec.blocks.splice(bIdx + 1, 0, copy);
    _v5SelSIdx = sIdx; _v5SelBIdx = bIdx + 1;
    _v5RefreshSection(sIdx); _v5RefreshProps();
  }

  function _v5MoveEl(sIdx, bIdx, dir) {
    var sec = _builderSecs[sIdx]; if (!sec) return;
    var ni = bIdx + dir;
    if (ni < 0 || ni >= sec.blocks.length) return;
    _v5Push();
    var tmp = sec.blocks[bIdx]; sec.blocks[bIdx] = sec.blocks[ni]; sec.blocks[ni] = tmp;
    _v5SelBIdx = ni; _v5RefreshSection(sIdx);
  }

  function _v5PropChange(key, value) {
    if (_v5SelSIdx === null || _v5SelBIdx === null) return;
    var blk = _builderSecs[_v5SelSIdx] && _builderSecs[_v5SelSIdx].blocks[_v5SelBIdx];
    if (!blk) return;
    blk[key] = value;
    if (key === 'label') {
      var lbl = document.querySelector('.mxd5-row[data-sidx="' + _v5SelSIdx + '"][data-bidx="' + _v5SelBIdx + '"] .mxd5-row-label');
      if (lbl) lbl.textContent = value + (blk.required ? ' *' : '');
    }
  }

  function _v5ToggleProp(key, el) {
    if (_v5SelSIdx === null || _v5SelBIdx === null) return;
    var blk = _builderSecs[_v5SelSIdx] && _builderSecs[_v5SelSIdx].blocks[_v5SelBIdx];
    if (!blk) return;
    blk[key] = !blk[key];
    if (el) el.classList.toggle('mxd5-toggle--on', !!blk[key]);
    if (key === 'required') _v5RefreshRow(_v5SelSIdx, _v5SelBIdx);
  }

  function _v5ToggleComp(compKey, checked) {
    if (_v5SelSIdx === null || _v5SelBIdx === null) return;
    var blk = _builderSecs[_v5SelSIdx] && _builderSecs[_v5SelSIdx].blocks[_v5SelBIdx];
    if (!blk || blk.type !== 'v5row') return;
    _v5Push();
    blk[compKey] = checked;
    _v5RefreshRow(_v5SelSIdx, _v5SelBIdx);
    _v5RefreshProps();
  }

  function _v5SetUnit(value) {
    if (_v5SelSIdx === null || _v5SelBIdx === null) return;
    var blk = _builderSecs[_v5SelSIdx] && _builderSecs[_v5SelSIdx].blocks[_v5SelBIdx];
    if (!blk) return;
    blk.unit = value;
    var unitEl = document.querySelector('.mxd5-row[data-sidx="' + _v5SelSIdx + '"][data-bidx="' + _v5SelBIdx + '"] .mxd5-unit');
    if (unitEl) unitEl.textContent = value;
  }

  // ── V5 DRAG & DROP ──
  var _v5SecDragSrcIdx  = null;
  var _v5ElDragComp     = null;
  var _v5ElDragFromSIdx = null;
  var _v5ElDragFromBIdx = null;

  function _v5SecDragStart(ev, sIdx) {
    _v5SecDragSrcIdx = sIdx;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', 'v5sec:' + sIdx);
    ev.stopPropagation();
  }

  function _v5SecDzOver(ev, sIdx) {
    if (_v5SecDragSrcIdx === null) return;
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll('.mxd5-section').forEach(function (s) { s.classList.remove('mxd5-sec-dz--over'); });
    var el = document.querySelector('.mxd5-section[data-sidx="' + sIdx + '"]');
    if (el) el.classList.add('mxd5-sec-dz--over');
  }

  function _v5SecDzLeave(ev, sIdx) {
    var el = document.querySelector('.mxd5-section[data-sidx="' + sIdx + '"]');
    if (el) el.classList.remove('mxd5-sec-dz--over');
  }

  function _v5ElDragStart(ev, comp) {
    _v5ElDragComp = comp; _v5ElDragFromSIdx = null; _v5ElDragFromBIdx = null;
    ev.dataTransfer.effectAllowed = 'copy';
    ev.dataTransfer.setData('text/plain', 'v5el:' + comp);
    ev.stopPropagation();
  }

  function _v5ElRowDragStart(ev, sIdx, bIdx) {
    var sec = _builderSecs[sIdx]; var blk = sec && sec.blocks[bIdx];
    if (!blk) return;
    _v5ElDragFromSIdx = sIdx; _v5ElDragFromBIdx = bIdx; _v5ElDragComp = null;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', 'v5row:' + sIdx + ':' + bIdx);
    ev.stopPropagation();
  }

  function _v5ElDzOver(ev, sIdx) {
    ev.preventDefault(); ev.stopPropagation();
  }

  function _v5ElDzDrop(ev, sIdx) {
    ev.preventDefault(); ev.stopPropagation();
    var raw = ev.dataTransfer.getData('text/plain') || '';
    var parts = raw.split(':');
    if (parts[0] === 'v5el') {
      var comp = parts[1];
      var isStatic = comp.startsWith('static:');
      _v5Push();
      var blk;
      if (isStatic) {
        var stype = comp.replace('static:', '');
        var bt = _btInfo(stype);
        blk = { id: _uid(), type: stype, label: bt.l, value: '' };
      } else {
        blk = _v5NewRow(comp);
      }
      _builderSecs[sIdx].blocks.push(blk);
      _v5SelSIdx = sIdx; _v5SelBIdx = _builderSecs[sIdx].blocks.length - 1;
      _v5RefreshSection(sIdx); _v5RefreshProps(); _v5RefreshLeftPanel();
    } else if (parts[0] === 'v5row') {
      var fromS = parseInt(parts[1]); var fromB = parseInt(parts[2]);
      if (!isNaN(fromS) && !isNaN(fromB)) {
        _v5Push();
        var moved = _builderSecs[fromS].blocks.splice(fromB, 1)[0];
        _builderSecs[sIdx].blocks.push(moved);
        _v5SelSIdx = sIdx; _v5SelBIdx = _builderSecs[sIdx].blocks.length - 1;
        if (fromS !== sIdx) _v5RefreshSection(fromS);
        _v5RefreshSection(sIdx); _v5RefreshProps(); _v5RefreshLeftPanel();
      }
    } else if (parts[0] === 'v5sec') {
      var target = parseInt(parts[1]);
      if (!isNaN(target) && target !== _v5SecDragSrcIdx && _v5SecDragSrcIdx !== null) {
        document.querySelectorAll('.mxd5-section').forEach(function (s) { s.classList.remove('mxd5-sec-dz--over'); });
        _v5Push();
        var movedSec = _builderSecs.splice(_v5SecDragSrcIdx, 1)[0];
        var insertAt = target > _v5SecDragSrcIdx ? target - 1 : target;
        _builderSecs.splice(insertAt, 0, movedSec);
        _v5SecDragSrcIdx = null;
        _v5SelSIdx = insertAt; _v5SelBIdx = null;
        _v5RefreshCanvas(); _v5RefreshLeftPanel(); _v5RefreshProps();
      }
    }
    _v5ElDragComp = null; _v5ElDragFromSIdx = null; _v5ElDragFromBIdx = null; _v5SecDragSrcIdx = null;
  }

  // ─────────────────────────────────────────────────────
  // V4 BUILDER — CANVAS UX (PREMIUM)
  // ─────────────────────────────────────────────────────

  function _renderBuilderV4(mc) {
    var tpl = _builderTpl || {};
    var status = tpl.status || 'draft';
    var statusL = STATUS_LABELS[status] || 'Brouillon';
    var statusCls = status === 'published' ? 'mxd4-badge--pub' : status === 'archived' ? 'mxd4-badge--arch' : 'mxd4-badge--draft';
    mc.innerHTML =
      '<div class="mxd4-builder" id="mxd4-root">'
      + _v4TopBarHTML(tpl, statusL, statusCls)
      + '<div class="mxd4-layout">'
      + '<div class="mxd4-activity-bar" id="mxd4-nav">' + _v4NavHTML() + '</div>'
      + '<div class="mxd4-left-panel" id="mxd4-left">' + _v4LeftPanelHTML() + '</div>'
      + '<div class="mxd4-canvas-wrap" id="mxd4-canvas">' + _v4CanvasHTML() + '</div>'
      + '<div class="mxd4-props-panel" id="mxd4-props">' + _v4PropsPanelHTML() + '</div>'
      + '</div>'
      + _v4MobNavHTML()
      + '</div>';
    var root = document.getElementById('mxd4-root');
    if (root) {
      root.addEventListener('click', function (ev) {
        if (!ev.target.closest('.mxd4-add-menu') && !ev.target.closest('.mxd4-add-row-btn')) {
          _v4HideAddMenu();
        }
      });
    }
    _v4UpdateUndoRedo();
  }

  function _v4TopBarHTML(tpl, statusL, statusCls) {
    var e = _e;
    return '<div class="mxd4-topbar">'
      + '<div class="mxd4-topbar-left">'
      + '<button class="mxd4-back-btn" onclick="MX.Pages.MxDoc._closeBuilder()" title="Retour"><i class="fas fa-arrow-left"></i></button>'
      + '<div class="mxd4-topbar-brand"><span class="mxd4-brand-name">MX Doc</span><span class="mxd4-brand-sub">Édition du modèle</span></div>'
      + '<div class="mxd4-topbar-divider"></div>'
      + '<input class="mxd4-title-inp" id="mxd4-title" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…" oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      + '<span class="mxd4-badge ' + statusCls + '">' + statusL + '</span>'
      + '</div>'
      + '<div class="mxd4-topbar-right">'
      + '<button class="mxd4-tb-btn" id="mxd4-undo" onclick="MX.Pages.MxDoc._v4Undo()" title="Annuler" disabled><i class="fas fa-rotate-left"></i></button>'
      + '<button class="mxd4-tb-btn" id="mxd4-redo" onclick="MX.Pages.MxDoc._v4Redo()" title="Rétablir" disabled><i class="fas fa-rotate-right"></i></button>'
      + '<div class="mxd4-topbar-divider"></div>'
      + '<button class="mxd4-preview-btn" onclick="MX.Pages.MxDoc._v4Preview()"><i class="fas fa-eye"></i><span> Aperçu</span></button>'
      + '<button class="mxd4-save-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'draft\')"><i class="fas fa-floppy-disk"></i><span> Enregistrer</span></button>'
      + '<button class="mxd4-pub-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'published\')"><i class="fas fa-paper-plane"></i><span> Publier</span></button>'
      + '</div>'
      + '</div>';
  }

  function _v4NavHTML() {
    var tabs = [
      { id: 'elements', icon: 'fa-grid-2',           l: 'Éléments'  },
      { id: 'sections', icon: 'fa-layer-group',       l: 'Sections'  },
      { id: 'model',    icon: 'fa-file-lines',        l: 'Modèle'    },
      { id: 'history',  icon: 'fa-clock-rotate-left', l: 'Historique'},
    ];
    var h = '<button class="mxd4-nav-fab" onclick="MX.Pages.MxDoc._v4NavSwitch(\'elements\')" title="Ajouter"><i class="fas fa-plus"></i><span>Ajouter</span></button>';
    tabs.forEach(function (t) {
      h += '<button class="mxd4-nav-btn' + (_v4NavTab === t.id ? ' mxd4-nav-btn--on' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._v4NavSwitch(\'' + t.id + '\')" title="' + t.l + '">'
        + '<i class="fas ' + t.icon + '"></i><span>' + t.l + '</span></button>';
    });
    return h;
  }

  function _v4LeftPanelHTML() {
    if (_v4NavTab === 'sections') return _v4SecListHTML();
    if (_v4NavTab === 'model')    return _v4ModelPropsHTML();
    if (_v4NavTab === 'history')  return _v4HistoryHTML();
    return _v4ElListHTML();
  }

  var _V4_EL_TYPES = [
    { type: 'titre',       icon: 'fa-heading',       l: 'Titre',           desc: 'Titre de section',       color: '#8B5CF6' },
    { type: 'sstitre',     icon: 'fa-text-height',   l: 'Sous-titre',      desc: 'Sous-titre de section',  color: '#6366F1' },
    { type: 'numerique',   icon: 'fa-hashtag',       l: 'Valeur',          desc: 'Champ numérique',        color: '#0EA5E9' },
    { type: 'faitnonfait', icon: 'fa-circle-check',  l: 'Fait / Pas fait', desc: 'Choix fait ou pas fait', color: '#22C55E' },
    { type: 'ouinon',      icon: 'fa-toggle-on',     l: 'Oui / Non',       desc: 'Choix oui ou non',       color: '#10B981' },
    { type: 'liste',       icon: 'fa-list',          l: 'Liste',           desc: 'Liste déroulante',        color: '#6366F1' },
    { type: 'commentaire', icon: 'fa-comment-lines', l: 'Commentaire',     desc: 'Zone de texte longue',   color: '#F59E0B' },
    { type: 'date',        icon: 'fa-calendar',      l: 'Date',            desc: 'Sélection de date',      color: '#F97316' },
    { type: 'heure',       icon: 'fa-clock',         l: 'Heure',           desc: "Sélection de l'heure",   color: '#EF4444' },
    { type: 'photo',       icon: 'fa-camera',        l: 'Photo',           desc: 'Ajouter une photo',      color: '#EC4899' },
    { type: 'signature',   icon: 'fa-pen-nib',       l: 'Signature',       desc: 'Zone de signature',      color: '#A855F7' },
    { type: 'texte',       icon: 'fa-align-left',    l: 'Texte libre',     desc: 'Bloc de texte libre',    color: '#64748B' },
  ];

  function _v4ElListHTML() {
    var targetSIdx = _v4SelSIdx !== null ? _v4SelSIdx : (_builderSecs.length ? _builderSecs.length - 1 : 0);
    var h = '<div class="mxd4-lp-hdr"><span>ÉLÉMENTS</span></div>'
      + '<div class="mxd4-lp-search"><i class="fas fa-search"></i>'
      + '<input id="mxd4-el-search" placeholder="Rechercher un élément…" oninput="MX.Pages.MxDoc._v4FilterEls(this.value)"></div>'
      + '<div class="mxd4-el-list" id="mxd4-el-list">';
    _V4_EL_TYPES.forEach(function (et) {
      h += '<div class="mxd4-el-card" draggable="true"'
        + ' ondragstart="MX.Pages.MxDoc._v4ElDragStart(event,\'' + et.type + '\')"'
        + ' onclick="MX.Pages.MxDoc._v4AddEl(' + targetSIdx + ',\'' + et.type + '\')">'
        + '<div class="mxd4-el-card-icon" style="color:' + et.color + ';background:' + et.color + '18"><i class="fas ' + et.icon + '"></i></div>'
        + '<div class="mxd4-el-card-body">'
        + '<div class="mxd4-el-card-name">' + et.l + '</div>'
        + '<div class="mxd4-el-card-desc">' + et.desc + '</div>'
        + '</div></div>';
    });
    h += '</div><div class="mxd4-lp-footer">'
      + '<button class="mxd4-lp-add-sec" onclick="MX.Pages.MxDoc._v4AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div>';
    return h;
  }

  function _v4SecListHTML() {
    var h = '<div class="mxd4-lp-hdr"><span>SECTIONS</span></div>'
      + '<div class="mxd4-sec-list" id="mxd4-sec-list">';
    _builderSecs.forEach(function (sec, sIdx) {
      var color = sec.color || SEC_COLORS[sIdx % SEC_COLORS.length];
      var isSel = (_v4SelSIdx === sIdx && _v4SelBIdx === null);
      h += '<div class="mxd4-sec-list-item' + (isSel ? ' mxd4-sec-list-item--sel' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._v4SelectSec(' + sIdx + ')">'
        + '<span class="mxd4-sec-dot" style="background:' + color + '"></span>'
        + '<span class="mxd4-sec-list-name">' + _e(sec.label || 'Section') + '</span>'
        + '<span class="mxd4-sec-list-count">' + (sec.blocks || []).length + '</span>'
        + '</div>';
    });
    h += '</div><div class="mxd4-lp-footer">'
      + '<button class="mxd4-lp-add-sec" onclick="MX.Pages.MxDoc._v4AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div>';
    return h;
  }

  function _v4ModelPropsHTML() {
    var tpl = _builderTpl || {};
    var e = _e;
    var freqOpts = Object.keys(FREQ_LABELS).map(function (k) {
      return '<option value="' + k + '"' + (tpl.frequency === k ? ' selected' : '') + '>' + FREQ_LABELS[k] + '</option>';
    }).join('');
    return '<div class="mxd4-lp-hdr"><span>MODÈLE</span></div>'
      + '<div class="mxd4-model-props">'
      + '<div class="mxd4-mp-group"><label>Description</label>'
      + '<textarea class="mxd4-mp-inp" rows="3" oninput="MX.Pages.MxDoc._bldDescChange(this.value)">' + e(tpl.description || '') + '</textarea></div>'
      + '<div class="mxd4-mp-group"><label>Fréquence</label>'
      + '<select class="mxd4-mp-inp" onchange="MX.Pages.MxDoc._bldFreqChange(this.value)">' + freqOpts + '</select></div>'
      + '<div class="mxd4-mp-group"><label>Couleur du document</label>'
      + '<input type="color" class="mxd4-mp-color" value="' + e(tpl.color || '#8B5CF6') + '" oninput="MX.Pages.MxDoc._bldColorChange(this.value)"></div>'
      + '</div>';
  }

  function _v4HistoryHTML() {
    return '<div class="mxd4-lp-hdr"><span>HISTORIQUE</span></div>'
      + '<div class="mxd4-hist-wrap">'
      + (_v2History.length
        ? '<div class="mxd4-hist-info">' + _v2History.length + ' action(s) enregistrée(s)</div>'
        : '<div class="mxd4-hist-empty">Aucune action à annuler</div>')
      + '</div>';
  }

  function _v4CanvasHTML() {
    var secsH = _builderSecs.map(function (sec, sIdx) { return _v4SectionHTML(sec, sIdx); }).join('');
    return '<div class="mxd4-canvas" id="mxd4-canvas-inner"'
      + ' ondragover="event.preventDefault()" ondrop="MX.Pages.MxDoc._v4SecDzDrop(event)">'
      + secsH
      + '<div class="mxd4-canvas-add-sec">'
      + '<button class="mxd4-add-sec-btn" onclick="MX.Pages.MxDoc._v4AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div></div>';
  }

  function _v4SectionHTML(sec, sIdx) {
    var e     = _e;
    var color = sec.color || SEC_COLORS[sIdx % SEC_COLORS.length];
    var coll  = !!_v4SecCollapsed[sIdx];
    var isSel = (_v4SelSIdx === sIdx && _v4SelBIdx === null);
    var blocksH = coll ? '' : (sec.blocks || []).map(function (blk, bIdx) { return _v4RowHTML(blk, sIdx, bIdx); }).join('');
    var addH = coll ? '' : '<div class="mxd4-add-row" id="mxd4-addrow-' + sIdx + '" style="position:relative">'
      + '<button class="mxd4-add-row-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v4ShowAddMenu(' + sIdx + ')"><i class="fas fa-plus"></i> Ajouter une ligne</button>'
      + (_v4AddMenuSIdx === sIdx ? _v4AddMenuHTML(sIdx) : '')
      + '</div>';
    return '<div class="mxd4-section' + (isSel ? ' mxd4-section--sel' : '') + '" data-sidx="' + sIdx + '" style="--sec-color:' + color + '"'
      + ' ondragover="MX.Pages.MxDoc._v4SecDzOver(event,' + sIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._v4SecDzLeave(event,' + sIdx + ')">'
      + '<div class="mxd4-sec-hdr" onclick="MX.Pages.MxDoc._v4SelectSec(' + sIdx + ')">'
      + '<div class="mxd4-sec-drag" draggable="true" ondragstart="MX.Pages.MxDoc._v4SecDragStart(event,' + sIdx + ')" onclick="event.stopPropagation()"><i class="fas fa-grip-vertical"></i></div>'
      + '<div class="mxd4-sec-icon-wrap"><i class="fas fa-building"></i></div>'
      + '<div class="mxd4-sec-info">'
      + '<input class="mxd4-sec-title-inp" value="' + e(sec.label || '') + '" placeholder="Nom de la section…"'
      + ' oninput="MX.Pages.MxDoc._v4SecLabel(' + sIdx + ',this.value)" onclick="event.stopPropagation()">'
      + (sec.description ? '<div class="mxd4-sec-desc">' + e(sec.description) + '</div>' : '')
      + '</div>'
      + '<div class="mxd4-sec-acts">'
      + '<button class="mxd4-sec-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v4ToggleCollapse(' + sIdx + ')" title="' + (coll ? 'Développer' : 'Réduire') + '"><i class="fas fa-chevron-' + (coll ? 'down' : 'up') + '"></i></button>'
      + '<button class="mxd4-sec-act" onclick="event.stopPropagation();MX.Pages.MxDoc._v4DupSection(' + sIdx + ')" title="Dupliquer"><i class="fas fa-copy"></i></button>'
      + '<button class="mxd4-sec-act mxd4-sec-act--del" onclick="event.stopPropagation();MX.Pages.MxDoc._v4DelSection(' + sIdx + ')" title="Supprimer"><i class="fas fa-trash"></i></button>'
      + '</div></div>'
      + '<div class="mxd4-sec-body" id="mxd4-sec-body-' + sIdx + '"'
      + ' ondragover="MX.Pages.MxDoc._v4ElDzOver(event,' + sIdx + ')"'
      + ' ondrop="MX.Pages.MxDoc._v4ElDzDrop(event,' + sIdx + ')">'
      + blocksH + '</div>'
      + addH
      + '</div>';
  }

  function _v4RowHTML(blk, sIdx, bIdx) {
    var e   = _e;
    var bt  = _btInfo(blk.type);
    var sel = (_v4SelSIdx === sIdx && _v4SelBIdx === bIdx);
    return '<div class="mxd4-row' + (sel ? ' mxd4-row--sel' : '') + '" data-sidx="' + sIdx + '" data-bidx="' + bIdx + '"'
      + ' onclick="MX.Pages.MxDoc._v4SelectRow(' + sIdx + ',' + bIdx + ',event)"'
      + ' draggable="true" ondragstart="MX.Pages.MxDoc._v4ElDragStart(event,\'' + blk.type + '\',' + sIdx + ',' + bIdx + ')">'
      + (sel ? _v4FloatBarHTML(sIdx, bIdx) : '')
      + '<div class="mxd4-row-grip"><i class="fas fa-grip-vertical"></i></div>'
      + '<div class="mxd4-row-icon" style="color:' + bt.color + ';background:' + bt.color + '18"><i class="fas ' + bt.icon + '"></i></div>'
      + '<div class="mxd4-row-label">' + e(blk.label || bt.l) + (blk.required ? '<span class="mxd4-req"> *</span>' : '') + '</div>'
      + _v4RowValHTML(blk)
      + '<button class="mxd4-row-opts" onclick="event.stopPropagation()" title="Options"><i class="fas fa-ellipsis-v"></i></button>'
      + '</div>';
  }

  function _v4RowValHTML(blk) {
    var e = _e;
    if (blk.type === 'titre')     return '<div class="mxd4-row-val mxd4-rv-titre">' + e(blk.value || blk.label || 'Titre') + '</div>';
    if (blk.type === 'sstitre')   return '<div class="mxd4-row-val mxd4-rv-sstitre">' + e(blk.value || blk.label || 'Sous-titre') + '</div>';
    if (blk.type === 'separator') return '<div class="mxd4-row-val mxd4-rv-sep"><hr></div>';
    if (blk.type === 'texte')     return '<div class="mxd4-row-val mxd4-rv-texte">' + e(blk.value || blk.placeholder || 'Texte libre…') + '</div>';
    if (blk.type === 'faitnonfait') return '<div class="mxd4-row-val mxd4-rv-fnf">'
      + '<button class="mxd4-fnf-btn mxd4-fnf-fait"><i class="fas fa-check"></i> Fait</button>'
      + '<button class="mxd4-fnf-btn mxd4-fnf-nonfait"><i class="fas fa-times"></i> Pas fait</button>'
      + '</div>';
    if (blk.type === 'ouinon') return '<div class="mxd4-row-val mxd4-rv-yn">'
      + '<button class="mxd4-yn-btn mxd4-yn-oui"><i class="fas fa-check"></i> Oui</button>'
      + '<button class="mxd4-yn-btn mxd4-yn-non"><i class="fas fa-times"></i> Non</button>'
      + '</div>';
    if (blk.type === 'numerique') return '<div class="mxd4-row-val mxd4-rv-num">'
      + '<input class="mxd4-val-inp" type="number" placeholder="' + e(String(blk.value !== undefined ? blk.value : '0')) + '" disabled>'
      + (blk.unit ? '<span class="mxd4-val-unit">' + e(blk.unit) + '</span>' : '')
      + '</div>';
    if (blk.type === 'commentaire') return '<div class="mxd4-row-val mxd4-rv-comment"><span class="mxd4-val-ph">' + e(blk.placeholder || 'Commentaire…') + '</span></div>';
    if (blk.type === 'liste') {
      var def = (blk.options && blk.options[0]) ? blk.options[0] : '-- Choisir --';
      return '<div class="mxd4-row-val mxd4-rv-liste"><span>' + e(blk.value || def) + '</span><i class="fas fa-chevron-down"></i></div>';
    }
    if (blk.type === 'date')      return '<div class="mxd4-row-val mxd4-rv-date"><i class="fas fa-calendar"></i><span>' + e(blk.value || 'JJ/MM/AAAA') + '</span></div>';
    if (blk.type === 'heure')     return '<div class="mxd4-row-val mxd4-rv-heure"><i class="fas fa-clock"></i><span>' + e(blk.value || '--:--') + '</span></div>';
    if (blk.type === 'photo')     return '<div class="mxd4-row-val mxd4-rv-photo"><i class="fas fa-camera"></i><span>Photo</span></div>';
    if (blk.type === 'signature') return '<div class="mxd4-row-val mxd4-rv-sig"><i class="fas fa-pen-nib"></i><span>Signature</span></div>';
    return '<div class="mxd4-row-val"></div>';
  }

  function _v4FloatBarHTML(sIdx, bIdx) {
    return '<div class="mxd4-float-bar" onclick="event.stopPropagation()">'
      + '<button title="Dupliquer" onclick="MX.Pages.MxDoc._v4DupEl(' + sIdx + ',' + bIdx + ')"><i class="fas fa-copy"></i></button>'
      + '<button title="Monter" onclick="MX.Pages.MxDoc._v4MoveEl(' + sIdx + ',' + bIdx + ',-1)"><i class="fas fa-chevron-up"></i></button>'
      + '<button title="Descendre" onclick="MX.Pages.MxDoc._v4MoveEl(' + sIdx + ',' + bIdx + ',1)"><i class="fas fa-chevron-down"></i></button>'
      + '<button title="Obligatoire" onclick="MX.Pages.MxDoc._v4ToggleProp(\'required\',this)"><i class="fas fa-thumbtack"></i></button>'
      + '<div class="mxd4-float-sep"></div>'
      + '<button title="Supprimer" class="mxd4-fb-del" onclick="MX.Pages.MxDoc._v4DelEl(' + sIdx + ',' + bIdx + ')"><i class="fas fa-trash"></i></button>'
      + '</div>';
  }

  function _v4AddMenuHTML(sIdx) {
    var types = [
      { type: 'numerique',   icon: 'fa-hashtag',       l: 'Valeur',          color: '#0EA5E9' },
      { type: 'faitnonfait', icon: 'fa-circle-check',  l: 'Fait / Pas fait', color: '#22C55E' },
      { type: 'ouinon',      icon: 'fa-toggle-on',     l: 'Oui / Non',       color: '#10B981' },
      { type: 'liste',       icon: 'fa-list',          l: 'Liste',           color: '#6366F1' },
      { type: 'commentaire', icon: 'fa-comment-lines', l: 'Commentaire',     color: '#F59E0B' },
      { type: 'date',        icon: 'fa-calendar',      l: 'Date',            color: '#F97316' },
      { type: 'heure',       icon: 'fa-clock',         l: 'Heure',           color: '#EF4444' },
      { type: 'photo',       icon: 'fa-camera',        l: 'Photo',           color: '#EC4899' },
      { type: 'signature',   icon: 'fa-pen-nib',       l: 'Signature',       color: '#A855F7' },
    ];
    var h = '<div class="mxd4-add-menu" onclick="event.stopPropagation()">';
    types.forEach(function (t) {
      h += '<button class="mxd4-add-menu-item" onclick="MX.Pages.MxDoc._v4AddEl(' + sIdx + ',\'' + t.type + '\')">'
        + '<span class="mxd4-ami-icon" style="color:' + t.color + '"><i class="fas ' + t.icon + '"></i></span>'
        + '<span>' + t.l + '</span></button>';
    });
    return h + '</div>';
  }

  function _v4PropsPanelHTML() {
    if (_v4SelSIdx !== null && _v4SelBIdx !== null) {
      var sec = _builderSecs[_v4SelSIdx];
      var blk = sec && sec.blocks[_v4SelBIdx];
      if (blk) return _v4ElPropsPanelHTML(blk);
    }
    if (_v4SelSIdx !== null) return _v4SecPropsPanelHTML();
    return _v4DocPropsPanelHTML();
  }

  function _v4DocPropsPanelHTML() {
    return '<div class="mxd4-pp-hdr">PROPRIÉTÉS</div>'
      + '<div class="mxd4-pp-empty"><i class="fas fa-cursor"></i><p>Sélectionnez un élément ou une section pour modifier ses propriétés.</p></div>';
  }

  function _v4SecPropsPanelHTML() {
    var sec   = _builderSecs[_v4SelSIdx];
    if (!sec) return _v4DocPropsPanelHTML();
    var e     = _e;
    var color = sec.color || SEC_COLORS[_v4SelSIdx % SEC_COLORS.length];
    var swatches = SEC_COLORS.map(function (c) {
      return '<button class="mxd4-swatch' + (color === c ? ' mxd4-swatch--on' : '') + '"'
        + ' style="background:' + c + '" onclick="MX.Pages.MxDoc._v4SecColor(' + _v4SelSIdx + ',\'' + c + '\')"></button>';
    }).join('');
    return '<div class="mxd4-pp-hdr">SECTION</div>'
      + '<div class="mxd4-pp-body">'
      + '<div class="mxd4-pp-group"><label>Nom</label>'
      + '<input class="mxd4-pp-inp" value="' + e(sec.label || '') + '" placeholder="Nom de la section…"'
      + ' oninput="MX.Pages.MxDoc._v4SecLabel(' + _v4SelSIdx + ',this.value)"></div>'
      + '<div class="mxd4-pp-group"><label>Description</label>'
      + '<textarea class="mxd4-pp-inp" rows="2" oninput="MX.Pages.MxDoc._v4SecDesc(' + _v4SelSIdx + ',this.value)">' + e(sec.description || '') + '</textarea></div>'
      + '<div class="mxd4-pp-group"><label>Couleur</label><div class="mxd4-swatches">' + swatches + '</div></div>'
      + '<div class="mxd4-pp-actions"><button class="mxd4-pp-del" onclick="MX.Pages.MxDoc._v4DelSection(' + _v4SelSIdx + ')"><i class="fas fa-trash"></i> Supprimer la section</button></div>'
      + '</div>';
  }

  function _v4ElPropsPanelHTML(blk) {
    var e  = _e;
    var bt = _btInfo(blk.type);
    var isStatic = STATIC_TYPES.indexOf(blk.type) >= 0;
    var RESP_TYPES = ['numerique','faitnonfait','ouinon','liste','commentaire','date','heure','photo','signature'];
    var typeOpts = RESP_TYPES.map(function (t) {
      var rbt = _btInfo(t);
      return '<option value="' + t + '"' + (blk.type === t ? ' selected' : '') + '>' + rbt.l + '</option>';
    }).join('');
    var h = '<div class="mxd4-pp-tabs">'
      + '<button class="mxd4-pp-tab' + (_v4PropsTab === 'props' ? ' mxd4-pp-tab--on' : '') + '" onclick="MX.Pages.MxDoc._v4SwitchPropsTab(\'props\')">PROPRIÉTÉS</button>'
      + '<button class="mxd4-pp-tab' + (_v4PropsTab === 'style' ? ' mxd4-pp-tab--on' : '') + '" onclick="MX.Pages.MxDoc._v4SwitchPropsTab(\'style\')">STYLE</button>'
      + '</div>';
    if (_v4PropsTab === 'style') {
      var swatches = SEC_COLORS.map(function (c) {
        return '<button class="mxd4-swatch' + (bt.color === c ? ' mxd4-swatch--on' : '') + '" style="background:' + c + '"></button>';
      }).join('');
      return h + '<div class="mxd4-pp-body">'
        + '<div class="mxd4-pp-group"><label>COULEUR</label><div class="mxd4-swatches">' + swatches + '</div></div>'
        + '</div>';
    }
    var selPreview = '<div class="mxd4-pp-sel-item">'
      + '<div class="mxd4-pp-sel-icon" style="color:' + bt.color + ';background:' + bt.color + '18"><i class="fas ' + bt.icon + '"></i></div>'
      + '<div><div class="mxd4-pp-sel-name">' + e(blk.label || bt.l) + '</div><div class="mxd4-pp-sel-type">' + bt.l + '</div></div>'
      + '</div>';
    h += '<div class="mxd4-pp-body">' + selPreview
      + '<div class="mxd4-pp-group"><label>LIBELLÉ</label>'
      + '<input class="mxd4-pp-inp" value="' + e(blk.label || '') + '" placeholder="Libellé…" oninput="MX.Pages.MxDoc._v4PropChange(\'label\',this.value)"></div>'
      + '<div class="mxd4-pp-group"><label>DESCRIPTION (OPTIONNELLE)</label>'
      + '<textarea class="mxd4-pp-inp" rows="3" placeholder="Description de la vérification…" oninput="MX.Pages.MxDoc._v4PropChange(\'description\',this.value)">' + e(blk.description || '') + '</textarea></div>';
    if (!isStatic) {
      h += '<div class="mxd4-pp-group"><label>TYPE DE RÉPONSE</label>'
        + '<select class="mxd4-pp-inp" onchange="MX.Pages.MxDoc._v4ChangeType(this.value)">' + typeOpts + '</select></div>';
    }
    if (blk.type === 'numerique') {
      h += '<div class="mxd4-pp-group"><label>UNITÉ</label>'
        + '<input class="mxd4-pp-inp" value="' + e(blk.unit || '') + '" placeholder="kWh, m³, °C…" oninput="MX.Pages.MxDoc._v4PropChange(\'unit\',this.value)"></div>'
        + '<div class="mxd4-pp-group"><label>VALEUR PAR DÉFAUT</label>'
        + '<input type="number" class="mxd4-pp-inp" value="' + (blk.value !== undefined ? blk.value : '') + '" oninput="MX.Pages.MxDoc._v4PropChangeNum(\'value\',this.value)"></div>';
    }
    if (!isStatic) {
      h += '<div class="mxd4-pp-toggles">'
        + _v4ToggleRowHTML('OBLIGATOIRE',         'required',       !!blk.required)
        + _v4ToggleRowHTML('VISIBLE',              'visible',        blk.visible !== false)
        + _v4ToggleRowHTML('LECTURE SEULE',        'readonly',       !!blk.readonly)
        + _v4ToggleRowHTML('COMMENTAIRE AUTORISÉ', 'commentAllowed', !!blk.commentAllowed)
        + '</div>';
    }
    h += '<div class="mxd4-pp-actions"><button class="mxd4-pp-del" onclick="MX.Pages.MxDoc._v4DelEl(' + _v4SelSIdx + ',' + _v4SelBIdx + ')"><i class="fas fa-trash"></i> Supprimer l\'élément</button></div>'
      + '</div>';
    return h;
  }

  function _v4ToggleRowHTML(label, key, val) {
    return '<div class="mxd4-pp-toggle-row"><span>' + label + '</span>'
      + '<button class="mxd4-toggle' + (val ? ' mxd4-toggle--on' : '') + '"'
      + ' onclick="MX.Pages.MxDoc._v4ToggleProp(\'' + key + '\',this)"></button></div>';
  }

  function _v4MobNavHTML() {
    return '<div class="mxd4-mob-nav">'
      + '<button class="mxd4-mob-btn' + (_v4MobPanel === 'elements' ? ' mxd4-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v4MobSwitch(\'elements\')"><i class="fas fa-grid-2"></i><span>Éléments</span></button>'
      + '<button class="mxd4-mob-btn' + (_v4MobPanel === 'sections' ? ' mxd4-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v4MobSwitch(\'sections\')"><i class="fas fa-layer-group"></i><span>Sections</span></button>'
      + '<button class="mxd4-mob-fab" onclick="MX.Pages.MxDoc._v4AddSection()"><i class="fas fa-plus"></i></button>'
      + '<button class="mxd4-mob-btn' + (_v4MobPanel === 'canvas' ? ' mxd4-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v4MobSwitch(\'canvas\')"><i class="fas fa-eye"></i><span>Aperçu</span></button>'
      + '</div>';
  }

  function _v4RefreshCanvas() {
    var el = document.getElementById('mxd4-canvas-inner');
    if (!el) return;
    el.innerHTML = _builderSecs.map(function (sec, sIdx) { return _v4SectionHTML(sec, sIdx); }).join('')
      + '<div class="mxd4-canvas-add-sec"><button class="mxd4-add-sec-btn" onclick="MX.Pages.MxDoc._v4AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button></div>';
  }

  function _v4RefreshSection(sIdx) {
    var old = document.querySelector('.mxd4-section[data-sidx="' + sIdx + '"]');
    if (!old) { _v4RefreshCanvas(); return; }
    var sec = _builderSecs[sIdx];
    if (!sec) { _v4RefreshCanvas(); return; }
    var d = document.createElement('div');
    d.innerHTML = _v4SectionHTML(sec, sIdx);
    old.parentNode.replaceChild(d.firstChild, old);
  }

  function _v4RefreshRow(sIdx, bIdx) {
    var old = document.querySelector('.mxd4-row[data-sidx="' + sIdx + '"][data-bidx="' + bIdx + '"]');
    if (!old) { _v4RefreshSection(sIdx); return; }
    var sec = _builderSecs[sIdx];
    var blk = sec && sec.blocks[bIdx];
    if (!blk) { _v4RefreshSection(sIdx); return; }
    var d = document.createElement('div');
    d.innerHTML = _v4RowHTML(blk, sIdx, bIdx);
    old.parentNode.replaceChild(d.firstChild, old);
  }

  function _v4RefreshProps() {
    var el = document.getElementById('mxd4-props');
    if (el) el.innerHTML = _v4PropsPanelHTML();
  }

  function _v4RefreshLeftPanel() {
    var el = document.getElementById('mxd4-left');
    if (el) el.innerHTML = _v4LeftPanelHTML();
  }

  function _v4RefreshNav() {
    var el = document.getElementById('mxd4-nav');
    if (el) el.innerHTML = _v4NavHTML();
  }

  function _v4Push() {
    _v2History.push(JSON.stringify(_builderSecs));
    if (_v2History.length > 50) _v2History.shift();
    _v2Future = [];
    _v4UpdateUndoRedo();
  }

  function _v4UpdateUndoRedo() {
    var u = document.getElementById('mxd4-undo');
    var r = document.getElementById('mxd4-redo');
    if (u) u.disabled = !_v2History.length;
    if (r) r.disabled = !_v2Future.length;
  }

  function _v4Undo() {
    if (!_v2History.length) return;
    _v2Future.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2History.pop());
    _v4SelSIdx = null; _v4SelBIdx = null;
    _v4RefreshCanvas(); _v4RefreshProps(); _v4RefreshLeftPanel(); _v4UpdateUndoRedo();
  }

  function _v4Redo() {
    if (!_v2Future.length) return;
    _v2History.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2Future.pop());
    _v4SelSIdx = null; _v4SelBIdx = null;
    _v4RefreshCanvas(); _v4RefreshProps(); _v4RefreshLeftPanel(); _v4UpdateUndoRedo();
  }

  function _v4Preview() {
    if (!_builderTpl) return;
    var copy = JSON.parse(JSON.stringify(_builderTpl));
    copy.sections = JSON.parse(JSON.stringify(_builderSecs));
    _execTemplate  = copy;
    _execMode      = true;
    _builderMode   = false;
    render();
  }

  function _v4NavSwitch(tab) {
    _v4NavTab = tab;
    _v4RefreshNav();
    _v4RefreshLeftPanel();
  }

  function _v4MobSwitch(panel) {
    _v4MobPanel = panel;
    var lp = document.getElementById('mxd4-left');
    var cw = document.getElementById('mxd4-canvas');
    var pp = document.getElementById('mxd4-props');
    if (lp) lp.setAttribute('data-mob', (panel === 'elements' || panel === 'sections') ? 'active' : '');
    if (cw) cw.setAttribute('data-mob', panel === 'canvas' ? 'active' : '');
    if (pp) pp.setAttribute('data-mob', panel === 'props' ? 'active' : '');
  }

  function _v4SwitchPropsTab(tab) { _v4PropsTab = tab; _v4RefreshProps(); }

  function _v4SelectDoc() { _v4SelSIdx = null; _v4SelBIdx = null; _v4RefreshProps(); }

  function _v4SelectSec(sIdx) {
    var prevS = _v4SelSIdx; var prevB = _v4SelBIdx;
    _v4SelSIdx = sIdx; _v4SelBIdx = null;
    if (prevB !== null && prevS !== null) _v4RefreshRow(prevS, prevB);
    if (prevS !== null && prevB === null && prevS !== sIdx) {
      var ps = document.querySelector('.mxd4-section[data-sidx="' + prevS + '"]');
      if (ps) ps.classList.remove('mxd4-section--sel');
    }
    var ns = document.querySelector('.mxd4-section[data-sidx="' + sIdx + '"]');
    if (ns) ns.classList.add('mxd4-section--sel');
    _v4RefreshProps();
  }

  function _v4SelectRow(sIdx, bIdx, ev) {
    if (ev) ev.stopPropagation();
    var prevS = _v4SelSIdx; var prevB = _v4SelBIdx;
    _v4SelSIdx = sIdx; _v4SelBIdx = bIdx;
    if (prevB !== null && (prevS !== sIdx || prevB !== bIdx)) _v4RefreshRow(prevS, prevB);
    _v4RefreshRow(sIdx, bIdx);
    _v4RefreshProps();
  }

  function _v4ShowAddMenu(sIdx) {
    var prev = _v4AddMenuSIdx;
    _v4AddMenuSIdx = sIdx;
    if (prev !== null && prev !== sIdx) _v4RefreshSection(prev);
    _v4RefreshSection(sIdx);
  }

  function _v4HideAddMenu() {
    if (_v4AddMenuSIdx === null) return;
    var prev = _v4AddMenuSIdx;
    _v4AddMenuSIdx = null;
    _v4RefreshSection(prev);
  }

  function _v4FilterEls(query) {
    var q = (query || '').toLowerCase();
    document.querySelectorAll('#mxd4-el-list .mxd4-el-card').forEach(function (card) {
      var txt = card.textContent.toLowerCase();
      card.style.display = (!q || txt.includes(q)) ? '' : 'none';
    });
  }

  function _v4AddSection() {
    _v4Push();
    var color = SEC_COLORS[_builderSecs.length % SEC_COLORS.length];
    _builderSecs.push({ id: _uid(), label: 'Section ' + (_builderSecs.length + 1), color: color, blocks: [] });
    _v4SelSIdx = _builderSecs.length - 1; _v4SelBIdx = null;
    _v4RefreshCanvas(); _v4RefreshProps(); _v4RefreshLeftPanel();
    var ns = document.querySelector('.mxd4-section[data-sidx="' + _v4SelSIdx + '"]');
    if (ns) ns.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _v4DelSection(sIdx) {
    if (_builderSecs.length <= 1) { MX.toast('Impossible de supprimer la dernière section', true); return; }
    _v4Push();
    _builderSecs.splice(sIdx, 1);
    if (_v4SelSIdx >= sIdx) { _v4SelSIdx = Math.max(0, _v4SelSIdx - 1); _v4SelBIdx = null; }
    _v4RefreshCanvas(); _v4RefreshProps(); _v4RefreshLeftPanel();
  }

  function _v4DupSection(sIdx) {
    _v4Push();
    var copy = JSON.parse(JSON.stringify(_builderSecs[sIdx]));
    copy.id = _uid(); copy.label = 'Copie — ' + copy.label;
    copy.blocks = (copy.blocks || []).map(function (b) { var nb = JSON.parse(JSON.stringify(b)); nb.id = _uid(); return nb; });
    _builderSecs.splice(sIdx + 1, 0, copy);
    _v4SelSIdx = sIdx + 1; _v4SelBIdx = null;
    _v4RefreshCanvas(); _v4RefreshProps(); _v4RefreshLeftPanel();
  }

  function _v4ToggleCollapse(sIdx) {
    _v4SecCollapsed[sIdx] = !_v4SecCollapsed[sIdx];
    _v4RefreshSection(sIdx);
  }

  function _v4SecLabel(sIdx, v) {
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].label = v;
    if (_v4NavTab === 'sections') _v4RefreshLeftPanel();
  }

  function _v4SecDesc(sIdx, v) {
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].description = v;
  }

  function _v4SecColor(sIdx, color) {
    if (!_builderSecs[sIdx]) return;
    _v4Push();
    _builderSecs[sIdx].color = color;
    _v4RefreshSection(sIdx); _v4RefreshProps();
  }

  function _v4AddEl(sIdx, type) {
    if (!_builderSecs[sIdx]) sIdx = _builderSecs.length - 1;
    _v4Push();
    var bt = _btInfo(type);
    var blk = { id: _uid(), type: type, label: bt.l };
    if (type === 'numerique') blk.unit = '';
    if (type === 'liste') blk.options = [];
    _builderSecs[sIdx].blocks.push(blk);
    _v4SelSIdx = sIdx; _v4SelBIdx = _builderSecs[sIdx].blocks.length - 1;
    _v4HideAddMenu();
    _v4RefreshSection(sIdx); _v4RefreshProps();
    var nr = document.querySelector('.mxd4-row[data-sidx="' + sIdx + '"][data-bidx="' + _v4SelBIdx + '"]');
    if (nr) nr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _v4DelEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v4Push();
    sec.blocks.splice(bIdx, 1);
    if (_v4SelSIdx === sIdx && _v4SelBIdx === bIdx) _v4SelBIdx = null;
    else if (_v4SelSIdx === sIdx && _v4SelBIdx > bIdx) _v4SelBIdx--;
    _v4RefreshSection(sIdx); _v4RefreshProps(); _v4RefreshLeftPanel();
  }

  function _v4DupEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v4Push();
    var copy = JSON.parse(JSON.stringify(sec.blocks[bIdx]));
    copy.id = _uid();
    sec.blocks.splice(bIdx + 1, 0, copy);
    _v4SelSIdx = sIdx; _v4SelBIdx = bIdx + 1;
    _v4RefreshSection(sIdx); _v4RefreshProps();
  }

  function _v4MoveEl(sIdx, bIdx, dir) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var ni = bIdx + dir;
    if (ni < 0 || ni >= sec.blocks.length) return;
    _v4Push();
    var tmp = sec.blocks[bIdx]; sec.blocks[bIdx] = sec.blocks[ni]; sec.blocks[ni] = tmp;
    _v4SelBIdx = ni;
    _v4RefreshSection(sIdx);
  }

  function _v4PropChange(key, value) {
    if (_v4SelSIdx === null || _v4SelBIdx === null) return;
    var blk = _builderSecs[_v4SelSIdx] && _builderSecs[_v4SelSIdx].blocks[_v4SelBIdx];
    if (!blk) return;
    blk[key] = value;
    if (key === 'label') {
      var lbl = document.querySelector('.mxd4-row[data-sidx="' + _v4SelSIdx + '"][data-bidx="' + _v4SelBIdx + '"] .mxd4-row-label');
      if (lbl) lbl.textContent = value + (blk.required ? ' *' : '');
    }
  }

  function _v4PropChangeNum(key, strVal) {
    if (_v4SelSIdx === null || _v4SelBIdx === null) return;
    var blk = _builderSecs[_v4SelSIdx] && _builderSecs[_v4SelSIdx].blocks[_v4SelBIdx];
    if (!blk) return;
    var n = parseFloat(strVal);
    blk[key] = isNaN(n) ? undefined : n;
  }

  function _v4ChangeType(newType) {
    if (_v4SelSIdx === null || _v4SelBIdx === null) return;
    var sec = _builderSecs[_v4SelSIdx];
    if (!sec) return;
    _v4Push();
    var blk = sec.blocks[_v4SelBIdx];
    var nblk = { id: blk.id, type: newType, label: blk.label, required: blk.required };
    if (newType === 'numerique') nblk.unit = blk.unit || '';
    if (newType === 'liste') nblk.options = blk.options || [];
    sec.blocks[_v4SelBIdx] = nblk;
    _v4RefreshRow(_v4SelSIdx, _v4SelBIdx); _v4RefreshProps();
  }

  function _v4ToggleProp(key, el) {
    if (_v4SelSIdx === null || _v4SelBIdx === null) return;
    var blk = _builderSecs[_v4SelSIdx] && _builderSecs[_v4SelSIdx].blocks[_v4SelBIdx];
    if (!blk) return;
    blk[key] = !blk[key];
    if (el) el.classList.toggle('mxd4-toggle--on', !!blk[key]);
    if (key === 'required') _v4RefreshRow(_v4SelSIdx, _v4SelBIdx);
  }

  var _v4SecDragSrcIdx = null;
  var _v4ElDragSrcSIdx = null;
  var _v4ElDragSrcBIdx = null;
  var _v4ElDragType    = null;

  function _v4SecDragStart(ev, sIdx) {
    _v4SecDragSrcIdx = sIdx;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', 'sec:' + sIdx);
    ev.stopPropagation();
  }

  function _v4SecDzOver(ev, sIdx) {
    if (_v4SecDragSrcIdx === null || _v4ElDragType !== null) return;
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll('.mxd4-section').forEach(function (s) { s.classList.remove('mxd4-sec-dz--over'); });
    var el = document.querySelector('.mxd4-section[data-sidx="' + sIdx + '"]');
    if (el) el.classList.add('mxd4-sec-dz--over');
  }

  function _v4SecDzLeave(ev, sIdx) {
    var el = document.querySelector('.mxd4-section[data-sidx="' + sIdx + '"]');
    if (el) el.classList.remove('mxd4-sec-dz--over');
  }

  function _v4SecDzDrop(ev) {
    ev.preventDefault();
    document.querySelectorAll('.mxd4-section').forEach(function (s) { s.classList.remove('mxd4-sec-dz--over'); });
    if (_v4SecDragSrcIdx === null) return;
    var raw   = ev.dataTransfer.getData('text/plain') || '';
    var parts = raw.split(':');
    if (parts[0] !== 'sec') { _v4SecDragSrcIdx = null; return; }
    var target = parseInt(parts[1]);
    if (isNaN(target) || target === _v4SecDragSrcIdx) { _v4SecDragSrcIdx = null; return; }
    _v4Push();
    var moved = _builderSecs.splice(_v4SecDragSrcIdx, 1)[0];
    var insertAt = target > _v4SecDragSrcIdx ? target - 1 : target;
    _builderSecs.splice(insertAt, 0, moved);
    _v4SecDragSrcIdx = null;
    _v4SelSIdx = insertAt; _v4SelBIdx = null;
    _v4RefreshCanvas(); _v4RefreshLeftPanel(); _v4RefreshProps();
  }

  function _v4ElDragStart(ev, type, sIdx, bIdx) {
    _v4ElDragType    = type;
    _v4ElDragSrcSIdx = (sIdx !== undefined) ? sIdx : null;
    _v4ElDragSrcBIdx = (bIdx !== undefined) ? bIdx : null;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', 'el:' + type + ':' + (sIdx !== undefined ? sIdx : -1) + ':' + (bIdx !== undefined ? bIdx : -1));
    ev.stopPropagation();
  }

  function _v4ElDzOver(ev, sIdx) {
    if (_v4ElDragType === null) return;
    ev.preventDefault(); ev.stopPropagation();
  }

  function _v4ElDzDrop(ev, sIdx) {
    ev.preventDefault(); ev.stopPropagation();
    if (_v4ElDragType === null) return;
    var raw   = ev.dataTransfer.getData('text/plain') || '';
    var parts = raw.split(':');
    if (parts[0] !== 'el') { _v4ElDragType = null; return; }
    var fromS = parseInt(parts[2]);
    var fromB = parseInt(parts[3]);
    if (fromS >= 0 && fromB >= 0) {
      _v4Push();
      var blk = _builderSecs[fromS].blocks.splice(fromB, 1)[0];
      _builderSecs[sIdx].blocks.push(blk);
      _v4SelSIdx = sIdx; _v4SelBIdx = _builderSecs[sIdx].blocks.length - 1;
      if (fromS !== sIdx) _v4RefreshSection(fromS);
    } else {
      _v4Push();
      var bt  = _btInfo(_v4ElDragType);
      var nbl = { id: _uid(), type: _v4ElDragType, label: bt.l };
      if (_v4ElDragType === 'numerique') nbl.unit = '';
      if (_v4ElDragType === 'liste') nbl.options = [];
      _builderSecs[sIdx].blocks.push(nbl);
      _v4SelSIdx = sIdx; _v4SelBIdx = _builderSecs[sIdx].blocks.length - 1;
    }
    _v4ElDragType = null; _v4ElDragSrcSIdx = null; _v4ElDragSrcBIdx = null;
    _v4RefreshSection(sIdx); _v4RefreshProps(); _v4RefreshLeftPanel();
  }

  // ─────────────────────────────────────────────────────
  // V3 BUILDER — NOTION+CANVA STYLE
  // ─────────────────────────────────────────────────────

  function _renderBuilderV3(mc) {
    var tpl = _builderTpl || {};
    var status  = tpl.status || 'draft';
    var statusL = STATUS_LABELS[status] || 'Brouillon';
    var statusCls = status === 'published' ? 'mxd3-badge--pub' : status === 'archived' ? 'mxd3-badge--arch' : 'mxd3-badge--draft';
    mc.innerHTML =
      '<div class="mxd3-builder" onclick="MX.Pages.MxDoc._v3HideAddMenu()">'
      + _v3TopBarHTML(tpl, statusL, statusCls)
      + '<div class="mxd3-layout">'
      + '<div class="mxd3-canvas-wrap" id="mxd3-canvas"' + (_v3MobPanel === 'canvas' ? ' data-mob="active"' : '') + '>'
      + _v3CanvasHTML()
      + '</div>'
      + '<div class="mxd3-props-panel" id="mxd3-props"' + (_v3MobPanel === 'props' ? ' data-mob="active"' : '') + '>'
      + _v3PropsPanelHTML()
      + '</div>'
      + '</div>'
      + _v3MobNavHTML()
      + '</div>';
  }

  function _v3TopBarHTML(tpl, statusL, statusCls) {
    var e = _e;
    return '<div class="mxd3-topbar">'
      + '<div class="mxd3-topbar-left">'
      + '<button class="mxd3-back-btn" onclick="MX.Pages.MxDoc._closeBuilder()"><i class="fas fa-arrow-left"></i><span> Retour</span></button>'
      + '<div class="mxd3-topbar-div"></div>'
      + '<input class="mxd3-title-inp" id="mxd3-title" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…" oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      + '<span class="mxd3-badge ' + statusCls + '">' + statusL + '</span>'
      + '</div>'
      + '<div class="mxd3-topbar-right">'
      + '<button class="mxd3-icon-btn" id="mxd3-undo" onclick="MX.Pages.MxDoc._v3Undo()" title="Annuler" disabled><i class="fas fa-rotate-left"></i></button>'
      + '<button class="mxd3-icon-btn" id="mxd3-redo" onclick="MX.Pages.MxDoc._v3Redo()" title="Rétablir" disabled><i class="fas fa-rotate-right"></i></button>'
      + '<button class="mxd3-icon-btn" onclick="MX.Pages.MxDoc._v3Preview()" title="Aperçu"><i class="fas fa-play"></i></button>'
      + '<button class="mxd3-save-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'draft\')"><i class="fas fa-floppy-disk"></i><span> Enregistrer</span></button>'
      + '<button class="mxd3-pub-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'published\')"><i class="fas fa-globe"></i><span> Publier</span></button>'
      + '</div>'
      + '</div>';
  }

  function _v3CanvasHTML() {
    var tpl    = _builderTpl || {};
    var e      = _e;
    var accent = e(tpl.color || '#8B5CF6');
    var h = '<div class="mxd3-canvas">'
      + '<div class="mxd3-doc-card" style="--doc-accent:' + accent + '">'
      + '<div class="mxd3-doc-icon" style="color:' + accent + '"><i class="fas ' + e(tpl.icon || 'fa-file-lines') + '"></i></div>'
      + '<div class="mxd3-doc-info">'
      + '<input class="mxd3-doc-title-inp" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…" oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      + '<div class="mxd3-doc-desc" id="mxd3-doc-desc">' + e(tpl.description || 'Cliquez sur l\'icône → pour les propriétés') + '</div>'
      + '</div>'
      + '<button class="mxd3-doc-props-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v3SelectDoc()" title="Propriétés du document"><i class="fas fa-sliders"></i></button>'
      + '</div>'
      + '<div class="mxd3-sections" id="mxd3-secs">';
    _builderSecs.forEach(function (sec, sIdx) { h += _v3SectionHTML(sec, sIdx); });
    h += '</div>'
      + '<button class="mxd3-add-sec-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v3AddSection()"><i class="fas fa-plus"></i> Ajouter une section</button>'
      + '</div>';
    return h;
  }

  function _v3SectionHTML(sec, sIdx) {
    var collapsed = !!_v3SecCollapsed[sIdx];
    var color     = sec.color || SEC_COLORS[sIdx % SEC_COLORS.length];
    var e         = _e;
    var selSec    = _v3SelSIdx === sIdx && _v3SelBIdx === null;
    var blks      = sec.blocks || [];
    var h = '<div class="mxd3-section' + (collapsed ? ' mxd3-section--collapsed' : '') + (selSec ? ' mxd3-section--sel' : '') + '" data-sidx="' + sIdx + '" style="--sec-color:' + color + '">';
    h += '<div class="mxd3-sec-hdr" onclick="event.stopPropagation();MX.Pages.MxDoc._v3SelectSec(' + sIdx + ')">'
      + '<div class="mxd3-sec-hdr-left">'
      + '<button class="mxd3-collapse-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._v3ToggleCollapse(' + sIdx + ')" title="' + (collapsed ? 'Développer' : 'Réduire') + '"><i class="fas fa-chevron-' + (collapsed ? 'right' : 'down') + '"></i></button>'
      + '<span class="mxd3-sec-dot" style="background:' + color + '"></span>'
      + '<input class="mxd3-sec-name-inp" value="' + e(sec.label || 'Section') + '" onclick="event.stopPropagation()" oninput="MX.Pages.MxDoc._v3SecLabel(' + sIdx + ',this.value)">'
      + '<span class="mxd3-sec-count">' + blks.length + ' élément' + (blks.length !== 1 ? 's' : '') + '</span>'
      + '</div>'
      + '<div class="mxd3-sec-hdr-acts">'
      + '<button class="mxd3-sec-act" title="Dupliquer" onclick="event.stopPropagation();MX.Pages.MxDoc._v3DupSection(' + sIdx + ')"><i class="fas fa-copy"></i></button>'
      + '<button class="mxd3-sec-act mxd3-sec-act--del" title="Supprimer" onclick="event.stopPropagation();MX.Pages.MxDoc._v3DelSection(' + sIdx + ')"><i class="fas fa-trash"></i></button>'
      + '</div>'
      + '</div>';
    if (!collapsed) {
      h += '<div class="mxd3-sec-body">';
      if (blks.length === 0) {
        h += '<div class="mxd3-sec-empty">Aucun élément — cliquez <strong>+ Ajouter une ligne</strong> ci-dessous</div>';
      } else {
        blks.forEach(function (blk, bIdx) { h += _v3ElWysiwygHTML(blk, sIdx, bIdx); });
      }
      h += '<div class="mxd3-add-row" onclick="event.stopPropagation()">'
        + '<button class="mxd3-add-el-btn" onclick="MX.Pages.MxDoc._v3ShowAddMenu(' + sIdx + ')"><i class="fas fa-plus"></i> Ajouter une ligne</button>'
        + (_v3AddMenuSIdx === sIdx ? _v3AddMenuHTML(sIdx) : '')
        + '</div>'
        + '</div>';
    }
    h += '</div>';
    return h;
  }

  function _v3ElWysiwygHTML(blk, sIdx, bIdx) {
    var sel = _v3SelSIdx === sIdx && _v3SelBIdx === bIdx;
    var e   = _e;
    var bt  = _btInfo(blk.type);
    var lbl = e(blk.label || bt.l);
    var req = blk.required ? '<span class="mxd3-el-req">*</span>' : '';
    var floatBar = '';
    if (sel) {
      floatBar = '<div class="mxd3-float-bar" onclick="event.stopPropagation()">'
        + '<span class="mxd3-float-type"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i> ' + bt.l + '</span>'
        + '<div class="mxd3-float-sep"></div>'
        + '<button class="mxd3-fb-btn" title="Dupliquer" onclick="MX.Pages.MxDoc._v3DupEl(' + sIdx + ',' + bIdx + ')"><i class="fas fa-copy"></i></button>'
        + '<button class="mxd3-fb-btn" title="Monter" onclick="MX.Pages.MxDoc._v3MoveEl(' + sIdx + ',' + bIdx + ',-1)"><i class="fas fa-chevron-up"></i></button>'
        + '<button class="mxd3-fb-btn" title="Descendre" onclick="MX.Pages.MxDoc._v3MoveEl(' + sIdx + ',' + bIdx + ',1)"><i class="fas fa-chevron-down"></i></button>'
        + '<button class="mxd3-fb-btn mxd3-fb-del" title="Supprimer" onclick="MX.Pages.MxDoc._v3DelEl(' + sIdx + ',' + bIdx + ')"><i class="fas fa-trash"></i></button>'
        + '</div>';
    }
    var bodyH = '';
    if (blk.type === 'titre') {
      bodyH = '<div class="mxd3-wy-titre">' + lbl + '</div>';
    } else if (blk.type === 'sstitre') {
      bodyH = '<div class="mxd3-wy-sstitre">' + lbl + '</div>';
    } else if (blk.type === 'separator') {
      bodyH = '<hr class="mxd3-wy-sep">';
    } else if (blk.type === 'texte') {
      bodyH = '<div class="mxd3-wy-texte">' + (blk.value ? e(blk.value) : '<span class="mxd3-wy-ph">Texte libre…</span>') + '</div>';
    } else if (blk.type === 'faitnonfait') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<div class="mxd3-wy-fnf">'
        + '<button class="mxd3-fnf-btn mxd3-fnf-fait" tabindex="-1"><i class="fas fa-check"></i> Fait</button>'
        + '<button class="mxd3-fnf-btn mxd3-fnf-nonfait" tabindex="-1"><i class="fas fa-times"></i> Non fait</button>'
        + '</div>';
    } else if (blk.type === 'ouinon') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<div class="mxd3-wy-yn">'
        + '<button class="mxd3-yn-btn mxd3-yn-oui" tabindex="-1"><i class="fas fa-check"></i> Oui</button>'
        + '<button class="mxd3-yn-btn mxd3-yn-non" tabindex="-1"><i class="fas fa-times"></i> Non</button>'
        + '</div>';
    } else if (blk.type === 'numerique') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<div class="mxd3-wy-num-row">'
        + '<input class="mxd3-wy-inp" type="number" placeholder="' + e(blk.placeholder || '0') + '" disabled>'
        + (blk.unit ? '<span class="mxd3-wy-unit">' + e(blk.unit) + '</span>' : '')
        + '</div>';
    } else if (blk.type === 'commentaire') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<textarea class="mxd3-wy-ta" placeholder="' + e(blk.placeholder || 'Votre commentaire…') + '" disabled rows="2"></textarea>';
    } else if (blk.type === 'date') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<input class="mxd3-wy-inp mxd3-wy-date" type="date" disabled>';
    } else if (blk.type === 'heure') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<input class="mxd3-wy-inp" type="time" disabled>';
    } else if (blk.type === 'photo') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<div class="mxd3-wy-media"><i class="fas fa-camera"></i><span>Ajouter une photo</span></div>';
    } else if (blk.type === 'signature') {
      bodyH = '<div class="mxd3-wy-lbl">' + lbl + req + '</div>'
        + '<div class="mxd3-wy-media"><i class="fas fa-pen-nib"></i><span>Zone de signature</span></div>';
    }
    return '<div class="mxd3-el' + (sel ? ' mxd3-el--sel' : '') + '" data-sidx="' + sIdx + '" data-bidx="' + bIdx + '"'
      + ' onclick="event.stopPropagation();MX.Pages.MxDoc._v3SelectEl(' + sIdx + ',' + bIdx + ')">'
      + floatBar
      + '<div class="mxd3-el-body">' + bodyH + '</div>'
      + '</div>';
  }

  function _v3AddMenuHTML(sIdx) {
    var h = '<div class="mxd3-add-menu" onclick="event.stopPropagation()">';
    BLOCK_TYPES.forEach(function (bt) {
      h += '<button class="mxd3-add-type" style="--bt-color:' + bt.color + '" onclick="MX.Pages.MxDoc._v3AddEl(' + sIdx + ',\'' + bt.type + '\')">'
        + '<i class="fas ' + bt.icon + '"></i><span>' + bt.l + '</span></button>';
    });
    h += '</div>';
    return h;
  }

  function _v3PropsPanelHTML() {
    if (_v3SelSIdx === null) return _v3DocPropsHTML();
    if (_v3SelBIdx === null) return _v3SecPropsHTML();
    return _v3ElPropsHTML();
  }

  function _v3DocPropsHTML() {
    var tpl  = _builderTpl || {};
    var e    = _e;
    var ICONS = ['fa-file-lines','fa-clipboard-list','fa-wrench','fa-shield-check','fa-fire','fa-bolt','fa-star','fa-building','fa-truck','fa-gear'];
    var FREQS = Object.keys(FREQ_LABELS);
    return '<div class="mxd3-props-body">'
      + '<div class="mxd3-props-hdr"><i class="fas fa-sliders"></i> Propriétés du document</div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Description</label>'
      + '<textarea class="mxd3-prop-ta" id="mxd-bld-desc" rows="3" placeholder="Description…" oninput="MX.Pages.MxDoc._bldDescChange(this.value)">' + e(tpl.description || '') + '</textarea></div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Fréquence</label>'
      + '<select class="mxd3-prop-select" id="mxd-bld-freq" onchange="MX.Pages.MxDoc._bldFreqChange(this.value)">'
      + FREQS.map(function (k) { return '<option value="' + k + '"' + (tpl.frequency === k ? ' selected' : '') + '>' + FREQ_LABELS[k] + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Couleur</label>'
      + '<input type="color" class="mxd3-prop-color" id="mxd-bld-color" value="' + e(tpl.color || '#8B5CF6') + '" oninput="MX.Pages.MxDoc._bldColorChange(this.value)"></div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Icône</label>'
      + '<div class="mxd3-icon-grid">'
      + ICONS.map(function (ic) { return '<button class="mxd3-icon-pick' + (tpl.icon === ic ? ' mxd3-icon-pick--on' : '') + '" onclick="MX.Pages.MxDoc._setBuilderIcon(\'' + ic + '\')" title="' + ic + '"><i class="fas ' + ic + '" style="color:' + e(tpl.color || '#8B5CF6') + '"></i></button>'; }).join('')
      + '</div></div>'
      + '</div>';
  }

  function _v3SecPropsHTML() {
    var sec = _builderSecs[_v3SelSIdx];
    if (!sec) return _v3DocPropsHTML();
    var e     = _e;
    var color = sec.color || SEC_COLORS[_v3SelSIdx % SEC_COLORS.length];
    return '<div class="mxd3-props-body">'
      + '<div class="mxd3-props-hdr"><i class="fas fa-layer-group"></i> Propriétés de la section</div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Nom</label>'
      + '<input class="mxd3-prop-inp" value="' + e(sec.label || '') + '" oninput="MX.Pages.MxDoc._v3SecLabelSync(' + _v3SelSIdx + ',this.value)"></div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Description</label>'
      + '<textarea class="mxd3-prop-ta" rows="2" placeholder="Description de la section…" oninput="MX.Pages.MxDoc._v3SecDesc(' + _v3SelSIdx + ',this.value)">' + e(sec.description || '') + '</textarea></div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Couleur</label>'
      + '<div class="mxd3-color-swatches">'
      + SEC_COLORS.map(function (c) { return '<button class="mxd3-color-sw' + (c === color ? ' mxd3-color-sw--on' : '') + '" style="background:' + c + '" onclick="MX.Pages.MxDoc._v3SecColor(' + _v3SelSIdx + ',\'' + c + '\')"></button>'; }).join('')
      + '</div></div>'
      + '<button class="mxd3-del-btn" onclick="MX.Pages.MxDoc._v3DelSection(' + _v3SelSIdx + ')"><i class="fas fa-trash"></i> Supprimer la section</button>'
      + '</div>';
  }

  function _v3ElPropsHTML() {
    var sec = _builderSecs[_v3SelSIdx];
    if (!sec) return _v3DocPropsHTML();
    var blk = (sec.blocks || [])[_v3SelBIdx];
    if (!blk) return _v3DocPropsHTML();
    var e        = _e;
    var bt       = _btInfo(blk.type);
    var isStatic = STATIC_TYPES.indexOf(blk.type) !== -1;
    var INTERACTIVE = ['numerique','ouinon','faitnonfait','commentaire','date','heure','photo','signature'];
    var h = '<div class="mxd3-props-body">'
      + '<div class="mxd3-props-hdr"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i> ' + bt.l + '</div>'
      + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Libellé</label>'
      + '<input class="mxd3-prop-inp" value="' + e(blk.label || '') + '" oninput="MX.Pages.MxDoc._v3PropChange(\'label\',this.value)"></div>';
    if (isStatic) {
      h += '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Contenu</label>'
        + '<textarea class="mxd3-prop-ta" rows="3" oninput="MX.Pages.MxDoc._v3PropChange(\'value\',this.value)">' + e(blk.value || '') + '</textarea></div>';
    } else {
      h += '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Type</label>'
        + '<div class="mxd3-type-grid">'
        + INTERACTIVE.map(function (t) { var rbt = _btInfo(t); return '<button class="mxd3-type-btn' + (blk.type === t ? ' mxd3-type-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v3ChangeType(\'' + t + '\')" title="' + rbt.l + '" style="--bt-color:' + rbt.color + '"><i class="fas ' + rbt.icon + '"></i></button>'; }).join('')
        + '</div></div>'
        + '<div class="mxd3-prop-group">' + _v3ToggleRowHTML('Champ obligatoire', 'required', !!blk.required) + '</div>'
        + '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Description</label>'
        + '<textarea class="mxd3-prop-ta" rows="2" placeholder="Description du champ…" oninput="MX.Pages.MxDoc._v3PropChange(\'description\',this.value)">' + e(blk.description || '') + '</textarea></div>';
      if (blk.type === 'numerique') {
        h += '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Unité</label>'
          + '<input class="mxd3-prop-inp" value="' + e(blk.unit || '') + '" placeholder="ex: kg, °C" oninput="MX.Pages.MxDoc._v3PropChange(\'unit\',this.value)"></div>'
          + '<div class="mxd3-prop-group mxd3-prop-row">'
          + '<div><label class="mxd3-prop-lbl">Min</label><input class="mxd3-prop-inp" type="number" value="' + (blk.min !== undefined ? blk.min : '') + '" oninput="MX.Pages.MxDoc._v3PropChangeNum(\'min\',this.value)"></div>'
          + '<div><label class="mxd3-prop-lbl">Max</label><input class="mxd3-prop-inp" type="number" value="' + (blk.max !== undefined ? blk.max : '') + '" oninput="MX.Pages.MxDoc._v3PropChangeNum(\'max\',this.value)"></div>'
          + '</div>';
      }
      if (blk.type === 'commentaire') {
        h += '<div class="mxd3-prop-group"><label class="mxd3-prop-lbl">Texte d\'aide</label>'
          + '<input class="mxd3-prop-inp" value="' + e(blk.placeholder || '') + '" placeholder="Votre commentaire…" oninput="MX.Pages.MxDoc._v3PropChange(\'placeholder\',this.value)"></div>';
      }
    }
    h += '<button class="mxd3-del-btn" onclick="MX.Pages.MxDoc._v3DelEl(' + _v3SelSIdx + ',' + _v3SelBIdx + ')"><i class="fas fa-trash"></i> Supprimer cet élément</button>'
      + '</div>';
    return h;
  }

  function _v3ToggleRowHTML(label, key, checked) {
    return '<div class="mxd3-toggle-row">'
      + '<span class="mxd3-toggle-lbl">' + label + '</span>'
      + '<button class="mxd3-toggle' + (checked ? ' mxd3-toggle--on' : '') + '" onclick="MX.Pages.MxDoc._v3ToggleProp(\'' + key + '\',this)">'
      + '<span class="mxd3-toggle-knob"></span></button>'
      + '</div>';
  }

  function _v3MobNavHTML() {
    var p = _v3MobPanel;
    return '<div class="mxd3-mob-nav">'
      + '<button class="mxd3-mob-btn' + (p === 'canvas' ? ' mxd3-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v3MobSwitch(\'canvas\')"><i class="fas fa-pen-ruler"></i><span>Éditeur</span></button>'
      + '<button class="mxd3-mob-btn' + (p === 'props'  ? ' mxd3-mob-btn--on' : '') + '" onclick="MX.Pages.MxDoc._v3MobSwitch(\'props\')"><i class="fas fa-sliders"></i><span>Propriétés</span></button>'
      + '</div>';
  }

  // ── V3 REFRESH HELPERS ──
  function _v3RefreshCanvas() {
    var c = document.getElementById('mxd3-canvas');
    if (c) c.innerHTML = _v3CanvasHTML();
  }

  function _v3RefreshSection(sIdx) {
    var existing = document.querySelector('.mxd3-section[data-sidx="' + sIdx + '"]');
    if (!existing) { _v3RefreshCanvas(); return; }
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = _v3SectionHTML(sec, sIdx);
    existing.replaceWith(tmp.firstChild);
  }

  function _v3RefreshEl(sIdx, bIdx) {
    var existing = document.querySelector('.mxd3-el[data-sidx="' + sIdx + '"][data-bidx="' + bIdx + '"]');
    if (!existing) { _v3RefreshSection(sIdx); return; }
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var blk = (sec.blocks || [])[bIdx];
    if (!blk) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = _v3ElWysiwygHTML(blk, sIdx, bIdx);
    existing.replaceWith(tmp.firstChild);
  }

  function _v3RefreshProps() {
    var p = document.getElementById('mxd3-props');
    if (p) p.innerHTML = _v3PropsPanelHTML();
  }

  function _v3UpdateUndoRedo() {
    var undo = document.getElementById('mxd3-undo');
    var redo = document.getElementById('mxd3-redo');
    if (undo) undo.disabled = _v2History.length === 0;
    if (redo) redo.disabled = _v2Future.length  === 0;
  }

  // ── V3 UNDO/REDO ──
  function _v3Push() {
    _v2History.push(JSON.stringify(_builderSecs));
    if (_v2History.length > 50) _v2History.shift();
    _v2Future = [];
    _v3UpdateUndoRedo();
  }

  function _v3Undo() {
    if (!_v2History.length) return;
    _v2Future.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2History.pop());
    _v3SelSIdx = null; _v3SelBIdx = null;
    _v3RefreshCanvas(); _v3RefreshProps(); _v3UpdateUndoRedo();
  }

  function _v3Redo() {
    if (!_v2Future.length) return;
    _v2History.push(JSON.stringify(_builderSecs));
    _builderSecs = JSON.parse(_v2Future.pop());
    _v3SelSIdx = null; _v3SelBIdx = null;
    _v3RefreshCanvas(); _v3RefreshProps(); _v3UpdateUndoRedo();
  }

  // ── V3 PREVIEW ──
  function _v3Preview() {
    if (!_builderTpl) return;
    var previewTpl = JSON.parse(JSON.stringify(_builderTpl));
    previewTpl.sections = JSON.parse(JSON.stringify(_builderSecs));
    _execTemplate  = previewTpl;
    _execInstance  = null;
    _execResponses = {};
    _execMode      = true;
    var mc = document.getElementById('main-content');
    if (!mc) return;
    _renderExec(mc);
    var backBtn = mc.querySelector('.mxd-exec-back');
    if (backBtn) {
      backBtn.onclick = function () {
        _execMode = false; _execTemplate = null;
        var mc2 = document.getElementById('main-content');
        if (mc2) _renderBuilderV3(mc2);
      };
    }
  }

  // ── V3 SELECTION ──
  function _v3SelectDoc() {
    _v3SelSIdx = null; _v3SelBIdx = null;
    document.querySelectorAll('.mxd3-section--sel').forEach(function (el) { el.classList.remove('mxd3-section--sel'); });
    document.querySelectorAll('.mxd3-el--sel').forEach(function (el) { el.classList.remove('mxd3-el--sel'); });
    _v3RefreshProps();
    if (window.innerWidth < 768) _v3MobSwitch('props');
  }

  function _v3SelectSec(sIdx) {
    var prevSIdx = _v3SelSIdx, prevBIdx = _v3SelBIdx;
    _v3SelSIdx = sIdx; _v3SelBIdx = null;
    if (prevBIdx !== null && prevSIdx !== null) _v3RefreshEl(prevSIdx, prevBIdx);
    document.querySelectorAll('.mxd3-section').forEach(function (el) {
      el.classList.toggle('mxd3-section--sel', parseInt(el.getAttribute('data-sidx')) === sIdx);
    });
    _v3RefreshProps();
    if (window.innerWidth < 768) _v3MobSwitch('props');
  }

  function _v3SelectEl(sIdx, bIdx) {
    var prevSIdx = _v3SelSIdx, prevBIdx = _v3SelBIdx;
    _v3SelSIdx = sIdx; _v3SelBIdx = bIdx;
    if (prevSIdx !== null && prevBIdx !== null && !(prevSIdx === sIdx && prevBIdx === bIdx)) {
      _v3RefreshEl(prevSIdx, prevBIdx);
    }
    _v3RefreshEl(sIdx, bIdx);
    document.querySelectorAll('.mxd3-section--sel').forEach(function (el) { el.classList.remove('mxd3-section--sel'); });
    _v3RefreshProps();
    if (window.innerWidth < 768) _v3MobSwitch('props');
  }

  // ── V3 ADD MENU ──
  function _v3ShowAddMenu(sIdx) {
    var old = _v3AddMenuSIdx;
    _v3AddMenuSIdx = (_v3AddMenuSIdx === sIdx) ? null : sIdx;
    if (old !== null && old !== sIdx) _v3RefreshSection(old);
    if (_v3AddMenuSIdx !== null) _v3RefreshSection(sIdx);
    else if (old === sIdx) _v3RefreshSection(sIdx);
  }

  function _v3HideAddMenu() {
    if (_v3AddMenuSIdx !== null) {
      var old = _v3AddMenuSIdx;
      _v3AddMenuSIdx = null;
      _v3RefreshSection(old);
    }
  }

  // ── V3 SECTION MUTATIONS ──
  function _v3AddSection() {
    _v3Push();
    _builderSecs.push({ id: _uid(), label: 'Nouvelle section', color: SEC_COLORS[_builderSecs.length % SEC_COLORS.length], blocks: [] });
    var newIdx = _builderSecs.length - 1;
    _v3SelSIdx = newIdx; _v3SelBIdx = null;
    _v3RefreshCanvas(); _v3RefreshProps();
    setTimeout(function () {
      var s = document.querySelector('.mxd3-section[data-sidx="' + newIdx + '"]');
      if (s) s.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function _v3DelSection(sIdx) {
    if (_builderSecs.length <= 1) { MX.toast('Au moins une section est requise'); return; }
    _v3Push();
    _builderSecs.splice(sIdx, 1);
    _v3SelSIdx = null; _v3SelBIdx = null;
    _v3RefreshCanvas(); _v3RefreshProps();
  }

  function _v3DupSection(sIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v3Push();
    var copy = JSON.parse(JSON.stringify(sec));
    copy.id    = _uid();
    copy.label = 'Copie — ' + copy.label;
    copy.blocks = (copy.blocks || []).map(function (b) { var bc = JSON.parse(JSON.stringify(b)); bc.id = _uid(); return bc; });
    _builderSecs.splice(sIdx + 1, 0, copy);
    _v3SelSIdx = sIdx + 1; _v3SelBIdx = null;
    _v3RefreshCanvas(); _v3RefreshProps();
  }

  function _v3ToggleCollapse(sIdx) {
    _v3SecCollapsed[sIdx] = !_v3SecCollapsed[sIdx];
    _v3RefreshSection(sIdx);
  }

  function _v3SecLabel(sIdx, v) {
    if (_builderSecs[sIdx]) _builderSecs[sIdx].label = v;
  }

  function _v3SecLabelSync(sIdx, v) {
    _v3SecLabel(sIdx, v);
    var inp = document.querySelector('.mxd3-section[data-sidx="' + sIdx + '"] .mxd3-sec-name-inp');
    if (inp && inp !== document.activeElement) inp.value = v;
  }

  function _v3SecDesc(sIdx, v) {
    if (_builderSecs[sIdx]) _builderSecs[sIdx].description = v;
  }

  function _v3SecColor(sIdx, color) {
    if (!_builderSecs[sIdx]) return;
    _builderSecs[sIdx].color = color;
    var sec = document.querySelector('.mxd3-section[data-sidx="' + sIdx + '"]');
    if (sec) {
      sec.style.setProperty('--sec-color', color);
      var dot = sec.querySelector('.mxd3-sec-dot');
      if (dot) dot.style.background = color;
    }
    _v3RefreshProps();
  }

  // ── V3 ELEMENT MUTATIONS ──
  function _v3AddEl(sIdx, type) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v3Push();
    var bt  = _btInfo(type);
    sec.blocks.push({ id: _uid(), type: type, label: bt.l });
    var newBIdx = sec.blocks.length - 1;
    _v3AddMenuSIdx = null;
    _v3SelSIdx = sIdx; _v3SelBIdx = newBIdx;
    _v3RefreshSection(sIdx); _v3RefreshProps();
    setTimeout(function () {
      var el = document.querySelector('.mxd3-el[data-sidx="' + sIdx + '"][data-bidx="' + newBIdx + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  function _v3DelEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v3Push();
    sec.blocks.splice(bIdx, 1);
    if (_v3SelSIdx === sIdx && _v3SelBIdx === bIdx) { _v3SelBIdx = null; }
    _v3RefreshSection(sIdx); _v3RefreshProps();
  }

  function _v3DupEl(sIdx, bIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    _v3Push();
    var copy = JSON.parse(JSON.stringify(sec.blocks[bIdx]));
    copy.id = _uid();
    sec.blocks.splice(bIdx + 1, 0, copy);
    _v3SelSIdx = sIdx; _v3SelBIdx = bIdx + 1;
    _v3RefreshSection(sIdx); _v3RefreshProps();
  }

  function _v3MoveEl(sIdx, bIdx, dir) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    var newIdx = bIdx + dir;
    if (newIdx < 0 || newIdx >= sec.blocks.length) return;
    _v3Push();
    var tmp = sec.blocks[bIdx];
    sec.blocks[bIdx] = sec.blocks[newIdx];
    sec.blocks[newIdx] = tmp;
    _v3SelSIdx = sIdx; _v3SelBIdx = newIdx;
    _v3RefreshSection(sIdx); _v3RefreshProps();
  }

  // ── V3 PROP MUTATIONS ──
  function _v3PropChange(key, value) {
    if (_v3SelSIdx === null || _v3SelBIdx === null) return;
    var sec = _builderSecs[_v3SelSIdx];
    if (!sec) return;
    var blk = (sec.blocks || [])[_v3SelBIdx];
    if (!blk) return;
    blk[key] = value;
    if (key === 'label' || key === 'required') _v3RefreshEl(_v3SelSIdx, _v3SelBIdx);
  }

  function _v3PropChangeNum(key, strVal) {
    var n = parseFloat(strVal);
    _v3PropChange(key, isNaN(n) ? undefined : n);
  }

  function _v3ChangeType(newType) {
    if (_v3SelSIdx === null || _v3SelBIdx === null) return;
    var sec = _builderSecs[_v3SelSIdx];
    if (!sec) return;
    var blk = (sec.blocks || [])[_v3SelBIdx];
    if (!blk) return;
    _v3Push();
    var oldBt = _btInfo(blk.type);
    blk.type  = newType;
    var newBt = _btInfo(newType);
    if (!blk.label || blk.label === oldBt.l) blk.label = newBt.l;
    _v3RefreshEl(_v3SelSIdx, _v3SelBIdx);
    _v3RefreshProps();
  }

  function _v3ToggleProp(key, el) {
    var isOn = el.classList.toggle('mxd3-toggle--on');
    _v3PropChange(key, isOn);
  }

  // ── V3 MOBILE ──
  function _v3MobSwitch(panel) {
    _v3MobPanel = panel;
    var ids = { canvas: 'mxd3-canvas', props: 'mxd3-props' };
    Object.keys(ids).forEach(function (k) {
      var el = document.getElementById(ids[k]);
      if (el) el.setAttribute('data-mob', k === panel ? 'active' : '');
    });
    document.querySelectorAll('.mxd3-mob-btn').forEach(function (btn) {
      var panels = ['canvas','props'];
      var idx    = Array.from(btn.parentNode.children).indexOf(btn);
      btn.classList.toggle('mxd3-mob-btn--on', panels[idx] === panel);
    });
  }

  // ── BUILDER LEGACY HELPERS (kept for _saveBuilder compatibility) ──
  function _bldTitleChange(v) {
    if (_builderTpl) {
      _builderTpl.title = v;
      var hdr = document.querySelector('.mxd2-doc-hdr-title');
      if (hdr) hdr.textContent = v || 'Nouveau modèle';
      var badge = document.querySelector('.mxd2-topbar .mxd2-badge');
    }
  }
  function _bldDescChange(v)  {
    if (!_builderTpl) return;
    _builderTpl.description = v;
    var hdr = document.querySelector('.mxd2-doc-hdr-desc');
    if (hdr) hdr.textContent = v || 'Cliquez sur Propriétés du document →';
    var hdr3 = document.getElementById('mxd3-doc-desc');
    if (hdr3) hdr3.textContent = v || 'Cliquez sur l\'icône → pour les propriétés';
  }
  function _bldFreqChange(v)  { if (_builderTpl) _builderTpl.frequency = v; }
  function _bldColorChange(v) {
    if (!_builderTpl) return;
    _builderTpl.color = v;
    var card = document.querySelector('.mxd2-doc-hdr-card');
    if (card) card.style.setProperty('--doc-accent', v);
    var ico = document.querySelector('.mxd2-doc-hdr-icon');
    if (ico) ico.style.color = v;
  }

  function _setBuilderIcon(icon) {
    if (!_builderTpl) return;
    _builderTpl.icon = icon;
    document.querySelectorAll('.mxd2-icon-pick').forEach(function (b) {
      b.classList.toggle('mxd2-icon-pick--on', b.title === icon);
    });
    var ico = document.querySelector('.mxd2-doc-hdr-icon i');
    if (ico) { ico.className = 'fas ' + icon; }
  }

  async function _saveBuilder(status) {
    if (!_builderTpl) return;
    var titleEl = document.getElementById('mxd6-title') || document.getElementById('mxd-bld-title') || document.getElementById('mxd2-title') || document.getElementById('mxd3-title') || document.getElementById('mxd4-title') || document.getElementById('mxd5-title');
    var descEl  = document.getElementById('mxd-bld-desc');
    var freqEl  = document.getElementById('mxd-bld-freq');
    var colorEl = document.getElementById('mxd-bld-color');
    if (titleEl) _builderTpl.title       = titleEl.value.trim();
    if (descEl)  _builderTpl.description = descEl.value.trim();
    if (freqEl)  _builderTpl.frequency   = freqEl.value;
    if (colorEl) _builderTpl.color       = colorEl.value;
    if (!_builderTpl.title) { MX.toast('Le nom du modèle est requis', false); return; }
    var payload = {
      title:       _builderTpl.title,
      description: _builderTpl.description || '',
      icon:        _builderTpl.icon  || 'fa-file-lines',
      color:       _builderTpl.color || '#8B5CF6',
      status:      status,
      frequency:   _builderTpl.frequency || 'on_demand',
      sections:    _builderSecs,
      updatedAt:   FV.serverTimestamp(),
      updatedBy:   _author(),
    };
    if (status === 'published' && _builderTpl.status !== 'published') payload.publishedAt = FV.serverTimestamp();
    MX.syncStart();
    try {
      if (_builderTpl.id) {
        await DB.templates().doc(_builderTpl.id).update(payload);
      } else {
        payload.createdAt = FV.serverTimestamp();
        payload.createdBy = _author();
        payload.archivedAt = null;
        await DB.templates().add(payload);
      }
      MX.syncEnd();
      MX.toast(status === 'published' ? 'Modèle publié !' : 'Brouillon enregistré');
      _closeBuilder();
    } catch (err) { MX.syncFail(); MX.toast('Erreur: ' + err.message, true); }
  }

  // ── EXECUTION VIEW ──
  function _startExec(templateId) {
    var tpl = _templates.find(function (t) { return t.id === templateId; });
    if (!tpl) return;
    _execTemplate  = JSON.parse(JSON.stringify(tpl));
    _execInstance  = null;
    _execResponses = {};
    _execMode      = true;
    render();
  }

  function _closeExec() {
    _execMode      = false;
    _execTemplate  = null;
    _execInstance  = null;
    _execResponses = {};
    render();
  }

  // ── V6 EXEC ──────────────────────────────────────────────────────────────────
  function _renderV6ExecSection(sec) {
    var e = _e;
    var cols = sec.columns || [];
    var rows = sec.rows || [];
    if (!rows.length) return '';
    var resolved = cols.map(_v7ResolveCol).filter(Boolean);
    var thead = '<thead><tr>'
      + '<th class="mxd-v6exec-th-label">Contrôle</th>'
      + resolved.map(function(r) {
          var col = r.def;
          var label = col.name || col.l || col.key;
          var emoji = col.icon || '';
          var ct = _v7TypeDef(col.type || col.key);
          var faIcon = ct ? ct.icon : 'fa-columns';
          var color = col.color || (ct ? ct.color : '#64748B');
          return '<th class="mxd-v6exec-th-col" style="color:' + color + '">'
            + (emoji ? '<span class="mxd7-col-emoji-sm">' + e(emoji) + '</span> ' : '<i class="fa-solid ' + faIcon + '"></i> ')
            + e(label) + (col.unit ? ' <span class="mxd7-th-unit">(' + e(col.unit) + ')</span>' : '')
            + '</th>';
        }).join('')
      + '</tr></thead>';
    var tbody = '<tbody>'
      + rows.map(function(row) {
          var rid = e(row.id);
          var tds = resolved.map(function(r) {
            return '<td class="mxd-v6exec-td-cell" id="mxd7-exec-' + rid + '-' + e(r.def.id || r.def.key) + '">'
              + _v7ExecCellHTML(r.def, row)
              + '<span class="mxd7-val-err" id="mxd7-err-' + rid + '-' + e(r.def.id || r.def.key) + '"></span>'
              + '</td>';
          }).join('');
          return '<tr class="mxd-v6exec-tr" data-rid="' + rid + '">'
            + '<td class="mxd-v6exec-td-label">'
            + e(row.label || '')
            + (row.unit ? '<span class="mxd-v6exec-unit"> ' + e(row.unit) + '</span>' : '')
            + (row.required ? '<span class="mxd-req"> *</span>' : '')
            + '</td>'
            + tds
            + '</tr>';
        }).join('')
      + '</tbody>';
    return '<div class="mxd-exec-sec">'
      + '<div class="mxd-exec-sec-hdr">' + e(sec.label || 'Section') + '</div>'
      + '<div class="mxd-v6exec-wrap"><table class="mxd-v6exec-tbl">' + thead + tbody + '</table></div>'
      + '</div>';
  }

  // Validate a value against a column def — returns error message or null
  function _v7Validate(col, val) {
    if (!col) return null;
    var type = col.type || col.key;
    if ((type === 'int' || type === 'decimal' || type === 'pourcent' || type === 'monnaie' || type === 'compteur') && val !== '' && val !== null && val !== undefined) {
      var num = parseFloat(val);
      if (isNaN(num)) return 'Valeur invalide';
      if (col.min !== undefined && col.min !== null && num < col.min) return 'Valeur hors tolérance (min ' + col.min + (col.unit ? ' ' + col.unit : '') + ')';
      if (col.max !== undefined && col.max !== null && num > col.max) return 'Valeur hors tolérance (max ' + col.max + (col.unit ? ' ' + col.unit : '') + ')';
    }
    return null;
  }

  // Exec cell HTML using full column def
  function _v7ExecCellHTML(col, row) {
    var e = _e;
    var rid = e(row.id);
    var cid = e(col.id || col.key);
    var type = col.type || col.key || 'texte';
    var storeKey = col.id || col.key;
    var safeKey = JSON.stringify(storeKey);
    var ph = col.defaultVal !== undefined ? String(col.defaultVal) : '—';
    switch (type) {
      case 'valeur': case 'int': case 'decimal': case 'compteur': case 'pourcent': case 'monnaie':
        return '<input class="mxd-v6exec-val" type="number" placeholder="' + e(ph) + '"'
          + (col.min !== undefined ? ' min="' + col.min + '"' : '')
          + (col.max !== undefined ? ' max="' + col.max + '"' : '')
          + (col.decimals !== undefined ? ' step="' + Math.pow(10, -col.decimals) + '"' : '')
          + ' oninput="MX.Pages.MxDoc._v7ExecSetValidate(\'' + rid + '\',' + safeKey + ',this.value)">'
          + (col.unit ? '<span class="mxd-v6exec-unit"> ' + e(col.unit) + '</span>' : '');
      case 'etat': case 'etatcheck':
        return '<div class="mxd-v6exec-etat">'
          + '<button class="mxd-v6exec-etat-ok" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'ok\',this,\'.mxd-v6exec-etat-ok\',\'mxd-v6exec-etat--on\')"><i class="fa-solid fa-check"></i></button>'
          + '<button class="mxd-v6exec-etat-ko" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'ko\',this,\'.mxd-v6exec-etat-ko\',\'mxd-v6exec-etat--on\')"><i class="fa-solid fa-xmark"></i></button>'
          + '</div>';
      case 'conforme':
        return '<div class="mxd-v6exec-etat">'
          + '<button class="mxd-v6exec-etat-ok" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'ok\',this,\'.mxd-v6exec-etat-ok\',\'mxd-v6exec-etat--on\')">' + e(col.libelleOk || 'Conforme') + '</button>'
          + '<button class="mxd-v6exec-etat-ko" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'ko\',this,\'.mxd-v6exec-etat-ko\',\'mxd-v6exec-etat--on\')">' + e(col.libelleKo || 'Non conforme') + '</button>'
          + '</div>';
      case 'ouinon':
        return '<div class="mxd-v6exec-yn">'
          + '<button class="mxd-v6exec-yn-oui" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'oui\',this,\'.mxd-v6exec-yn-oui\',\'mxd-v6exec-yn--on\')">' + e(col.labelOui || 'Oui') + '</button>'
          + '<button class="mxd-v6exec-yn-non" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'non\',this,\'.mxd-v6exec-yn-non\',\'mxd-v6exec-yn--on\')">' + e(col.labelNon || 'Non') + '</button>'
          + '</div>';
      case 'marchearret':
        return '<div class="mxd-v6exec-yn">'
          + '<button class="mxd-v6exec-yn-oui" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'marche\',this,\'.mxd-v6exec-yn-oui\',\'mxd-v6exec-yn--on\')">Marche</button>'
          + '<button class="mxd-v6exec-yn-non" onclick="MX.Pages.MxDoc._v7ExecToggle(\'' + rid + '\',' + safeKey + ',\'arret\',this,\'.mxd-v6exec-yn-non\',\'mxd-v6exec-yn--on\')">Arrêt</button>'
          + '</div>';
      case 'liste':
        var opts = (col.listeValues || []).map(function(v) { return '<option value="' + e(v) + '">' + e(v) + '</option>'; }).join('');
        return '<select class="mxd-v6exec-select" onchange="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',this.value)"><option value="">—</option>' + opts + '</select>';
      case 'commentaire': case 'texte':
        return '<input class="mxd-v6exec-comment" type="text" placeholder="Commentaire…"'
          + ' onchange="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',this.value)">';
      case 'photo':
        return '<label class="mxd-v6exec-photo-btn" id="mxd7-photo-lbl-' + rid + '-' + cid + '">'
          + '<i class="fa-solid fa-camera"></i>'
          + (col.photoMax > 1 ? '<span class="mxd7-cell-badge">' + col.photoMax + '</span>' : '')
          + '<input type="file" accept="image/*"'
          + (col.photoCamera !== false ? ' capture="environment"' : '')
          + ' style="display:none" onchange="MX.Pages.MxDoc._v6ExecPhoto(\'' + rid + '\',this)"></label>';
      case 'signature':
        return '<button class="mxd-v6exec-sig-btn" onclick="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',\'signed\')"><i class="fa-solid fa-pen-nib"></i></button>';
      case 'barcode': case 'qrcode':
        return '<button class="mxd-v6exec-sig-btn" onclick="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',\'scanned\')"><i class="fa-solid ' + (type === 'qrcode' ? 'fa-qrcode' : 'fa-barcode') + '"></i></button>';
      case 'date':
        return '<input class="mxd-v6exec-date" type="date" onchange="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',this.value)">';
      case 'heure': case 'temps':
        return '<input class="mxd-v6exec-heure" type="time" onchange="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',this.value)">';
      default:
        return '<input class="mxd-v6exec-comment" type="text" onchange="MX.Pages.MxDoc._v6ExecSet(\'' + rid + '\',' + safeKey + ',this.value)">';
    }
  }

  // Backward compat wrapper
  function _v6ExecCellHTML(colKey, row) {
    var r = _v7ResolveCol(colKey);
    return r ? _v7ExecCellHTML(r.def, row) : '<span class="mxd-v6exec-unknown">?</span>';
  }

  function _v6ExecSet(rowId, key, val) {
    if (!_execResponses[rowId]) _execResponses[rowId] = {};
    _execResponses[rowId][key] = val;
  }

  // V7: set with validation feedback
  function _v7ExecSetValidate(rowId, key, val) {
    _v6ExecSet(rowId, key, val);
    // Find column def for validation
    var colDef = null;
    for (var i = 0; i < _colLibrary.length; i++) { if (_colLibrary[i].id === key) { colDef = _colLibrary[i]; break; } }
    if (!colDef) { var r = _v7ResolveCol(key); if (r) colDef = r.def; }
    var errEl = document.getElementById('mxd7-err-' + rowId + '-' + key);
    if (!errEl) return;
    var err = _v7Validate(colDef, val);
    errEl.textContent = err || '';
    var cell = errEl.closest('td');
    if (cell) cell.classList.toggle('mxd7-cell--err', !!err);
  }

  // V7: generic toggle for 2-state cells (etatcheck, ouinon, conforme, marchearret)
  function _v7ExecToggle(rowId, key, val, btn, sibSel, onCls) {
    if (!_execResponses[rowId]) _execResponses[rowId] = {};
    var prev = _execResponses[rowId][key];
    var next = (prev === val) ? null : val;
    _execResponses[rowId][key] = next;
    var wrap = btn.closest('div');
    if (wrap) {
      wrap.querySelectorAll(sibSel).forEach(function(b) { b.classList.remove(onCls); });
      if (next) btn.classList.add(onCls);
    }
  }

  function _v6ExecEtat(rowId, val, btn) {
    _v7ExecToggle(rowId, 'etat', val, btn, '.mxd-v6exec-etat-ok,.mxd-v6exec-etat-ko', 'mxd-v6exec-etat--on');
  }

  function _v6ExecYN(rowId, val, btn) {
    _v7ExecToggle(rowId, 'ouinon', val, btn, '.mxd-v6exec-yn-oui,.mxd-v6exec-yn-non', 'mxd-v6exec-yn--on');
  }

  function _v6ExecPhoto(rowId, input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      _v6ExecSet(rowId, 'photo', ev.target.result);
      var lbl = input.closest('.mxd-v6exec-photo-btn');
      if (lbl) lbl.classList.add('mxd-v6exec-photo--done');
    };
    reader.readAsDataURL(file);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  function _renderExec(mc) {
    var tpl = _execTemplate;
    if (!tpl) { _closeExec(); return; }
    var e      = _e;
    var accent = e(tpl.color || '#8B5CF6');
    var sectH  = (tpl.sections || []).map(function (sec) {
      if (sec.rows) return _renderV6ExecSection(sec);
      return '<div class="mxd-exec-sec">'
        + '<div class="mxd-exec-sec-hdr">' + e(sec.label || 'Section') + '</div>'
        + (sec.blocks || []).map(_renderExecBlock).join('')
        + '</div>';
    }).join('');
    mc.innerHTML = '<div class="mxd-exec">'
      + '<div class="mxd-exec-hdr" style="--exec-accent:' + accent + '">'
      + '<button class="mxd-exec-back" onclick="MX.Pages.MxDoc._closeExec()"><i class="fas fa-arrow-left"></i></button>'
      + '<div class="mxd-exec-hdr-icon"><i class="fas ' + e(tpl.icon || 'fa-file-lines') + '"></i></div>'
      + '<div class="mxd-exec-hdr-txt">'
      + '<div class="mxd-exec-hdr-title">' + e(tpl.title) + '</div>'
      + (tpl.description ? '<div class="mxd-exec-hdr-desc">' + e(tpl.description) + '</div>' : '')
      + '</div></div>'
      + '<div class="mxd-exec-body">' + sectH
      + '<div class="mxd-exec-footer">'
      + '<button class="secondary-btn" onclick="MX.Pages.MxDoc._saveExec(\'en_cours\')"><i class="fas fa-save"></i> Sauvegarder</button>'
      + '<button class="primary-btn" onclick="MX.Pages.MxDoc._saveExec(\'termine\')"><i class="fas fa-check"></i> Valider et terminer</button>'
      + '</div></div></div>';
  }

  function _renderExecBlock(blk) {
    if (blk.type === 'v5row') return _renderV5ExecRow(blk);
    var e   = _e;
    var val = _execResponses[blk.id];
    var bt  = _btInfo(blk.type);
    var bid = e(blk.id);
    var req = blk.required ? '<span class="mxd-req" title="Obligatoire"> *</span>' : '';
    if (blk.type === 'titre')     return '<h2 class="mxd-exec-titre">' + e(blk.value || blk.label || '') + '</h2>';
    if (blk.type === 'sstitre')   return '<h3 class="mxd-exec-sstitre">' + e(blk.value || blk.label || '') + '</h3>';
    if (blk.type === 'separator') return '<hr class="mxd-exec-sep">';
    if (blk.type === 'texte')     return '<div class="mxd-exec-texte">' + e(blk.value || blk.label || '') + '</div>';
    var inputH = '';
    if (blk.type === 'numerique') {
      inputH = '<div class="mxd-num-wrap">'
        + '<input type="number" class="fi" data-blk="' + bid + '"'
        + (blk.min !== undefined ? ' min="' + blk.min + '"' : '')
        + (blk.max !== undefined ? ' max="' + blk.max + '"' : '')
        + ' value="' + (val !== undefined ? val : '') + '"'
        + ' oninput="MX.Pages.MxDoc._setResponse(\'' + bid + '\',parseFloat(this.value))">'
        + (blk.unit ? '<span class="mxd-unit">' + e(blk.unit) + '</span>' : '') + '</div>';
    } else if (blk.type === 'ouinon') {
      inputH = '<div class="mxd-yn">'
        + '<label class="mxd-yn-lbl"><input type="radio" name="blk_' + bid + '" value="oui"' + (val === 'oui' ? ' checked' : '') + ' onchange="MX.Pages.MxDoc._setResponse(\'' + bid + '\',\'oui\')"><span>Oui</span></label>'
        + '<label class="mxd-yn-lbl"><input type="radio" name="blk_' + bid + '" value="non"' + (val === 'non' ? ' checked' : '') + ' onchange="MX.Pages.MxDoc._setResponse(\'' + bid + '\',\'non\')"><span>Non</span></label>'
        + '</div>';
    } else if (blk.type === 'faitnonfait') {
      inputH = '<div class="mxd-yn">'
        + '<label class="mxd-yn-lbl mxd-yn-lbl--fait"><input type="radio" name="blk_' + bid + '" value="fait"' + (val === 'fait' ? ' checked' : '') + ' onchange="MX.Pages.MxDoc._setResponse(\'' + bid + '\',\'fait\')"><span><i class="fas fa-check"></i> Fait</span></label>'
        + '<label class="mxd-yn-lbl mxd-yn-lbl--nonfait"><input type="radio" name="blk_' + bid + '" value="non_fait"' + (val === 'non_fait' ? ' checked' : '') + ' onchange="MX.Pages.MxDoc._setResponse(\'' + bid + '\',\'non_fait\')"><span><i class="fas fa-times"></i> Non fait</span></label>'
        + '</div>';
    } else if (blk.type === 'commentaire') {
      inputH = '<textarea class="fi" rows="3" placeholder="' + e(blk.placeholder || 'Votre commentaire…') + '"'
        + ' oninput="MX.Pages.MxDoc._setResponse(\'' + bid + '\',this.value)">' + (val || '') + '</textarea>';
    } else if (blk.type === 'liste') {
      var listeOpts = (blk.options || []).map(function (opt) {
        return '<option value="' + e(opt) + '"' + (val === opt ? ' selected' : '') + '>' + e(opt) + '</option>';
      }).join('');
      inputH = '<select class="fi" onchange="MX.Pages.MxDoc._setResponse(\'' + bid + '\',this.value)">'
        + '<option value="">-- Choisir --</option>' + listeOpts + '</select>';
    } else if (blk.type === 'date') {
      inputH = '<input type="date" class="fi" value="' + (val || '') + '" oninput="MX.Pages.MxDoc._setResponse(\'' + bid + '\',this.value)">';
    } else if (blk.type === 'heure') {
      inputH = '<input type="time" class="fi" value="' + (val || '') + '" oninput="MX.Pages.MxDoc._setResponse(\'' + bid + '\',this.value)">';
    } else if (blk.type === 'photo') {
      inputH = '<div class="mxd-photo-wrap">'
        + '<input type="file" accept="image/*" capture="environment" class="mxd-photo-inp" id="mxd-ph-' + bid + '" onchange="MX.Pages.MxDoc._onExecPhoto(\'' + bid + '\',this)">'
        + '<label for="mxd-ph-' + bid + '" class="mxd-photo-lbl">'
        + (val ? '<img src="' + val + '" class="mxd-photo-prev">' : '<i class="fas fa-camera"></i><span>Ajouter une photo</span>')
        + '</label></div>';
    } else if (blk.type === 'signature') {
      inputH = '<div class="mxd-sig-wrap"><div class="mxd-sig-ph"><i class="fas fa-pen-nib"></i><span>Zone signature</span></div></div>';
    }
    return '<div class="mxd-exec-blk">'
      + '<div class="mxd-exec-blk-lbl"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i> ' + e(blk.label || bt.l) + req + '</div>'
      + '<div class="mxd-exec-blk-inp">' + inputH + '</div>'
      + '</div>';
  }

  function _setResponse(blkId, value) { _execResponses[blkId] = value; }

  function _v5SetResponse(blkId, key, value) {
    if (!_execResponses[blkId] || typeof _execResponses[blkId] !== 'object') _execResponses[blkId] = {};
    _execResponses[blkId][key] = value;
    // button visual feedback for fnf/yn
    var row = document.getElementById('mxd-v5-' + blkId);
    if (!row) return;
    if (key === 'fnf') {
      row.querySelectorAll('.mxd-v5-fnf-btn').forEach(function (b) { b.classList.remove('mxd-v5-active'); });
      var btn = row.querySelector('.mxd-v5-fnf-btn[data-v="' + value + '"]');
      if (btn) btn.classList.add('mxd-v5-active');
    }
    if (key === 'yn') {
      row.querySelectorAll('.mxd-v5-yn-btn').forEach(function (b) { b.classList.remove('mxd-v5-active'); });
      var btn2 = row.querySelector('.mxd-v5-yn-btn[data-v="' + value + '"]');
      if (btn2) btn2.classList.add('mxd-v5-active');
    }
  }

  function _v5ToggleExpand(blkId, key) {
    var row = document.getElementById('mxd-v5-' + blkId);
    if (!row) return;
    var area = row.querySelector('.mxd-v5-expand-' + key);
    var btn  = row.querySelector('.mxd-v5-expand-btn[data-k="' + key + '"]');
    if (area) { area.style.display = area.style.display === 'none' ? '' : 'none'; }
    if (btn)  btn.classList.toggle('mxd-v5-expand-btn--on');
  }

  function _renderV5ExecRow(blk) {
    var e   = _e;
    var bid = e(blk.id);
    var r   = (_execResponses[blk.id] && typeof _execResponses[blk.id] === 'object') ? _execResponses[blk.id] : {};
    var req = blk.required ? '<span class="mxd-req"> *</span>' : '';
    var h   = '<div class="mxd-v5-row" id="mxd-v5-' + bid + '">'
      + '<div class="mxd-v5-row-label">' + e(blk.label || 'Contrôle') + req + '</div>'
      + '<div class="mxd-v5-row-comps">';
    if (blk.hasValeur) {
      h += '<div class="mxd-v5-val-wrap">'
        + '<input type="number" class="mxd-v5-val-inp" value="' + (r.val !== undefined ? r.val : '') + '"'
        + ' placeholder="—" oninput="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'val\',parseFloat(this.value))">'
        + (blk.unit ? '<span class="mxd-v5-unit">' + e(blk.unit) + '</span>' : '')
        + '</div>';
    }
    if (blk.hasFaitnonfait) {
      var lf = e(blk.labelFait || 'Fait'); var lnf = e(blk.labelNonFait || 'Pas fait');
      h += '<div class="mxd-v5-fnf">'
        + '<button class="mxd-v5-fnf-btn mxd-v5-fait' + (r.fnf === 'fait' ? ' mxd-v5-active' : '') + '"'
        + ' data-v="fait" onclick="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'fnf\',\'fait\')">'
        + '<i class="fas fa-check"></i> ' + lf + '</button>'
        + '<button class="mxd-v5-fnf-btn mxd-v5-nonfait' + (r.fnf === 'non_fait' ? ' mxd-v5-active' : '') + '"'
        + ' data-v="non_fait" onclick="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'fnf\',\'non_fait\')">'
        + '<i class="fas fa-times"></i> ' + lnf + '</button>'
        + '</div>';
    }
    if (blk.hasOuinon) {
      var lo = e(blk.labelOui || 'Oui'); var ln = e(blk.labelNon || 'Non');
      h += '<div class="mxd-v5-yn">'
        + '<button class="mxd-v5-yn-btn mxd-v5-oui' + (r.yn === 'oui' ? ' mxd-v5-active' : '') + '"'
        + ' data-v="oui" onclick="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'yn\',\'oui\')">'
        + '<i class="fas fa-check"></i> ' + lo + '</button>'
        + '<button class="mxd-v5-yn-btn mxd-v5-non' + (r.yn === 'non' ? ' mxd-v5-active' : '') + '"'
        + ' data-v="non" onclick="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'yn\',\'non\')">'
        + '<i class="fas fa-times"></i> ' + ln + '</button>'
        + '</div>';
    }
    if (blk.hasDate) {
      h += '<div class="mxd-v5-date-wrap">'
        + '<input type="date" class="mxd-v5-date-inp" value="' + (r.date || '') + '"'
        + ' oninput="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'date\',this.value)">'
        + '</div>';
    }
    if (blk.hasHeure) {
      h += '<div class="mxd-v5-heure-wrap">'
        + '<input type="time" class="mxd-v5-heure-inp" value="' + (r.heure || '') + '"'
        + ' oninput="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'heure\',this.value)">'
        + '</div>';
    }
    if (blk.hasCommentaire) {
      h += '<div class="mxd-v5-expand-row">'
        + '<button class="mxd-v5-expand-btn' + (r.comment ? ' mxd-v5-expand-btn--on' : '') + '" data-k="comment"'
        + ' onclick="MX.Pages.MxDoc._v5ToggleExpand(\'' + bid + '\',\'comment\')">'
        + '<i class="fas fa-comment-lines"></i> Commentaire</button>'
        + '<div class="mxd-v5-expand-comment" style="display:' + (r.comment ? '' : 'none') + '">'
        + '<textarea class="mxd-v5-comment-ta" rows="2" placeholder="Votre commentaire…"'
        + ' oninput="MX.Pages.MxDoc._v5SetResponse(\'' + bid + '\',\'comment\',this.value)">' + e(r.comment || '') + '</textarea>'
        + '</div></div>';
    }
    if (blk.hasPhoto) {
      h += '<div class="mxd-v5-expand-row">'
        + '<button class="mxd-v5-expand-btn' + (r.photo ? ' mxd-v5-expand-btn--on' : '') + '" data-k="photo"'
        + ' onclick="MX.Pages.MxDoc._v5ToggleExpand(\'' + bid + '\',\'photo\')">'
        + '<i class="fas fa-camera"></i> Photo</button>'
        + '<div class="mxd-v5-expand-photo" style="display:' + (r.photo ? '' : 'none') + '">'
        + '<input type="file" accept="image/*" capture="environment" class="mxd-v5-photo-inp" id="mxd-v5-ph-' + bid + '"'
        + ' onchange="MX.Pages.MxDoc._v5OnPhoto(\'' + bid + '\',this)">'
        + '<label for="mxd-v5-ph-' + bid + '" class="mxd-v5-photo-lbl">'
        + (r.photo ? '<img src="' + r.photo + '" class="mxd-v5-photo-prev">' : '<i class="fas fa-camera"></i><span>Ajouter une photo</span>')
        + '</label></div></div>';
    }
    if (blk.hasSignature) {
      h += '<div class="mxd-v5-sig-ph"><i class="fas fa-pen-nib"></i><span>Zone signature</span></div>';
    }
    h += '</div></div>';
    return h;
  }

  function _v5OnPhoto(blkId, input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var MAX = 800; var w = img.width; var h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = cv.toDataURL('image/jpeg', 0.75);
        _v5SetResponse(blkId, 'photo', dataUrl);
        var lbl = document.querySelector('#mxd-v5-ph-' + blkId + ' + label');
        if (lbl) lbl.innerHTML = '<img src="' + dataUrl + '" class="mxd-v5-photo-prev">';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function _onExecPhoto(blkId, input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var MAX = 800; var w = img.width; var h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = cv.toDataURL('image/jpeg', 0.75);
        _execResponses[blkId] = dataUrl;
        var lbl = document.querySelector('#mxd-ph-' + blkId + ' + label');
        if (lbl) lbl.innerHTML = '<img src="' + dataUrl + '" class="mxd-photo-prev">';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function _saveExec(status) {
    if (!_execTemplate) return;
    if (status === 'termine') {
      var missing = [];
      (_execTemplate.sections || []).forEach(function (sec) {
        (sec.blocks || []).forEach(function (blk) {
          var v = _execResponses[blk.id];
          if (blk.required && (v === undefined || v === null || v === '')) missing.push(blk.label || blk.type);
        });
      });
      if (missing.length) { MX.toast('Champs obligatoires manquants : ' + missing.slice(0, 3).join(', '), false); return; }
    }
    var payload = {
      templateId:    _execTemplate.id,
      templateTitle: _execTemplate.title,
      status:        status,
      assignedTo:    _author(),
      responses:     Object.assign({}, _execResponses),
      updatedAt:     FV.serverTimestamp(),
    };
    if (status === 'termine') payload.completedAt = FV.serverTimestamp();
    MX.syncStart();
    try {
      if (_execInstance && _execInstance.id) {
        await DB.instances().doc(_execInstance.id).update(payload);
      } else {
        payload.startedAt = FV.serverTimestamp();
        await DB.instances().add(payload);
      }
      MX.syncEnd();
      if (status === 'termine') { MX.toast('Document validé et enregistré !'); _closeExec(); }
      else MX.toast('Document sauvegardé');
    } catch (err) { MX.syncFail(); MX.toast('Erreur: ' + err.message, true); }
  }

  // ── EXPORTS ──
  function _exportPdf() { window.print(); }

  function _exportExcel() {
    if (!window.XLSX) { MX.toast('Export XLSX indisponible', false); return; }
    var rows = [['Document', 'Technicien', 'Statut', 'Date début', 'Date fin']];
    _instances.forEach(function (inst) {
      rows.push([inst.templateTitle || '', inst.assignedTo || '',
        inst.status === 'termine' ? 'Terminé' : 'En cours',
        _fmtTs(inst.startedAt), inst.status === 'termine' ? _fmtTs(inst.completedAt) : '']);
    });
    var ws = window.XLSX.utils.aoa_to_sheet(rows);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'MX Doc Historique');
    window.XLSX.writeFile(wb, 'mxdoc-historique.xlsx');
  }

  // ── DESTROY ──
  function _destroy() {
    Object.keys(_unsub).forEach(function (k) { try { if (_unsub[k]) _unsub[k](); } catch (e) {} });
    _unsub         = {};
    _loaded        = false;
    _templates     = [];
    _instances     = [];
    _builderMode   = false;
    _execMode      = false;
    _builderTpl    = null;
    _builderSecs   = [];
    _selBlock      = null;
    _execTemplate  = null;
    _execInstance  = null;
    _execResponses = {};
    _v2History     = [];
    _v2Future      = [];
    _v2SelSIdx     = null;
    _v2SelEIdx     = null;
    _v2MobPanel    = 'canvas';
    _v2PalDragType  = null;
    _v2ElDragSrc    = null;
    _v2SecDragSrc   = null;
    _v3SelSIdx      = null;
    _v3SelBIdx      = null;
    _v3MobPanel     = 'canvas';
    _v3SecCollapsed = {};
    _v3AddMenuSIdx  = null;
    _v4NavTab       = 'elements';
    _v4SelSIdx      = null;
    _v4SelBIdx      = null;
    _v4MobPanel     = 'canvas';
    _v4SecCollapsed = {};
    _v4AddMenuSIdx  = null;
    _v4PropsTab     = 'props';
    _v5NavTab       = 'elements';
    _v5SelSIdx      = null;
    _v5SelBIdx      = null;
    _v5MobPanel     = 'canvas';
    _v5SecCollapsed = {};
    _v5AddMenuSIdx  = null;
  }

  // ── EXPOSE ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.MxDoc = {
    render,
    _tab,
    _setFilter,
    _newTemplate,
    _openBuilder,
    _closeBuilder,
    _publishTemplate,
    _archiveTemplate,
    _duplicateTemplate,
    _deleteTemplate,
    _bldTitleChange,
    _bldDescChange,
    _bldFreqChange,
    _bldColorChange,
    _setBuilderIcon,
    _saveBuilder,
    // V2
    _v2Undo,
    _v2Redo,
    _v2Preview,
    _v2PalDragStart,
    _v2ElDragStart,
    _v2SecDragStart,
    _v2DragEnd,
    _v2ElDzDrop,
    _v2SecDzOver,
    _v2SecDzLeave,
    _v2SecDzDrop,
    _v2SelectSec,
    _v2SelectEl,
    _v2AddSection,
    _v2DelSection,
    _v2SecLabel,
    _v2SecLabelSync,
    _v2SecColor,
    _v2PalClick,
    _v2DelEl,
    _v2MoveEl,
    _v2PropChange,
    _v2PropChangeNum,
    _v2ChangeType,
    _v2ToggleProp,
    _v2MobSwitch,
    // V3
    _v3Undo,
    _v3Redo,
    _v3Preview,
    _v3SelectDoc,
    _v3SelectSec,
    _v3SelectEl,
    _v3ShowAddMenu,
    _v3HideAddMenu,
    _v3AddSection,
    _v3DelSection,
    _v3DupSection,
    _v3ToggleCollapse,
    _v3SecLabel,
    _v3SecLabelSync,
    _v3SecDesc,
    _v3SecColor,
    _v3AddEl,
    _v3DelEl,
    _v3DupEl,
    _v3MoveEl,
    _v3PropChange,
    _v3PropChangeNum,
    _v3ChangeType,
    _v3ToggleProp,
    _v3MobSwitch,
    // V4
    _v4Undo,
    _v4Redo,
    _v4Preview,
    _v4NavSwitch,
    _v4MobSwitch,
    _v4SwitchPropsTab,
    _v4SelectDoc,
    _v4SelectSec,
    _v4SelectRow,
    _v4ShowAddMenu,
    _v4HideAddMenu,
    _v4FilterEls,
    _v4AddSection,
    _v4DelSection,
    _v4DupSection,
    _v4ToggleCollapse,
    _v4SecLabel,
    _v4SecDesc,
    _v4SecColor,
    _v4AddEl,
    _v4DelEl,
    _v4DupEl,
    _v4MoveEl,
    _v4PropChange,
    _v4PropChangeNum,
    _v4ChangeType,
    _v4ToggleProp,
    _v4SecDragStart,
    _v4SecDzOver,
    _v4SecDzLeave,
    _v4SecDzDrop,
    _v4ElDragStart,
    _v4ElDzOver,
    _v4ElDzDrop,
    // V6
    _v6Undo,
    _v6Redo,
    _v6Preview,
    _v6MobSwitch,
    _v6SelectSec,
    _v6SelectRow,
    _v6AddSection,
    _v6DelSection,
    _v6DupSection,
    _v6ToggleCollapse,
    _v6SecLabelChange,
    _v6SecLabelProp,
    _v6SecDesc,
    _v6SecColor,
    _v6AddQuick,
    _v6AddEl,
    _v6AddStatic,
    _v6DelEl,
    _v6DupEl,
    _v6MoveEl,
    _v6RowLabelChange,
    _v6PropChange,
    _v6ToggleProp,
    _v6ToggleCol,
    _v6ToggleComp,
    _v6SetUnit,
    _v6PalClick,
    _v6PalDragStart,
    // V7 Column Library
    _v7SetPalTab,
    _v7TypeClick,
    _v7TypeDragStart,
    _v7LibClick,
    _v7LibDragStart,
    _v7RemoveCol,
    _v7ColHdrDragStart,
    _v7ColHdrDrop,
    _v7OpenColModal,
    _v7CloseColModal,
    _v7MUpdate,
    _v7MSetType,
    _v7MListeAdd,
    _v7MListeUpdate,
    _v7MListeRemove,
    _v7SaveColModal,
    _v7DeleteColConfirm,
    _v7OpenAIModal,
    _v7AIGenerate,
    _v7AIAddCol,
    _v7ExecSetValidate,
    _v7ExecToggle,
    _v6SecDragStart,
    _v6SecDzOver,
    _v6SecDzLeave,
    _v6SecDzDrop,
    _v6RowDragStart,
    _v6RowDzOver,
    _v6RowDzLeave,
    _v6RowDzDrop,
    _v6CanvasDzOver,
    _v6CanvasDzDrop,
    // V5
    _v5Undo,
    _v5Redo,
    _v5Preview,
    _v5NavSwitch,
    _v5MobSwitch,
    _v5SelectSec,
    _v5SelectRow,
    _v5ShowAddMenu,
    _v5HideAddMenu,
    _v5AddSection,
    _v5DelSection,
    _v5DupSection,
    _v5ToggleCollapse,
    _v5SecLabel,
    _v5SecDesc,
    _v5SecColor,
    _v5AddEl,
    _v5AddStatic,
    _v5DelEl,
    _v5DupEl,
    _v5MoveEl,
    _v5PropChange,
    _v5ToggleProp,
    _v5ToggleComp,
    _v5SetUnit,
    _v5SecDragStart,
    _v5SecDzOver,
    _v5SecDzLeave,
    _v5ElDragStart,
    _v5ElRowDragStart,
    _v5ElDzOver,
    _v5ElDzDrop,
    _v5SetResponse,
    _v5ToggleExpand,
    _v5OnPhoto,
    // V6 Exec
    _v6ExecSet,
    _v6ExecEtat,
    _v6ExecYN,
    _v6ExecPhoto,
    // Exec
    _startExec,
    _closeExec,
    _setResponse,
    _onExecPhoto,
    _saveExec,
    _exportPdf,
    _exportExcel,
    _destroy,
  };
})();
