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
    if (_builderMode) { _renderBuilderV4(mc); return; }
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
      _builderSecs.push({ id: _uid(), label: 'Section 1', color: SEC_COLORS[0], blocks: [] });
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
    _builderMode  = true;
    render();
  }

  function _closeBuilder() {
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
    var titleEl = document.getElementById('mxd-bld-title') || document.getElementById('mxd2-title') || document.getElementById('mxd3-title') || document.getElementById('mxd4-title');
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

  function _renderExec(mc) {
    var tpl = _execTemplate;
    if (!tpl) { _closeExec(); return; }
    var e      = _e;
    var accent = e(tpl.color || '#8B5CF6');
    var sectH  = (tpl.sections || []).map(function (sec) {
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
