(function () {
  'use strict';

  // ── STATE ──
  var _curTab      = 'modeles';
  var _loaded      = false;
  var _templates   = [];
  var _instances   = [];
  var _unsub       = {};
  var _filterStatus = 'all';

  // Builder state
  var _builderMode  = false;
  var _builderTpl   = null;   // template being edited (working copy)
  var _builderSecs  = [];     // working copy of sections
  var _selBlock     = null;   // { sIdx, bIdx } | null

  // Drag state
  var _palDragType  = null;   // type being dragged from palette
  var _blkDragSrc   = null;   // { sIdx, bIdx } being moved within canvas

  // Execution state
  var _execMode      = false;
  var _execTemplate  = null;
  var _execInstance  = null;  // existing instance doc or null
  var _execResponses = {};

  var DB = {
    templates: function () { return db.collection('mx_doc_templates'); },
    instances: function () { return db.collection('mx_doc_instances'); },
  };
  var FV = firebase.firestore.FieldValue;

  // ── CONSTANTS ──
  var BLOCK_TYPES = [
    { type: 'titre',       icon: 'fa-heading',          l: 'Titre',           color: '#8B5CF6' },
    { type: 'sstitre',     icon: 'fa-text-height',      l: 'Sous-titre',      color: '#6366F1' },
    { type: 'separator',   icon: 'fa-minus',            l: 'Séparateur',      color: '#475569' },
    { type: 'texte',       icon: 'fa-align-left',       l: 'Texte libre',     color: '#64748B' },
    { type: 'numerique',   icon: 'fa-hashtag',          l: 'Numérique',       color: '#0EA5E9' },
    { type: 'ouinon',      icon: 'fa-toggle-on',        l: 'Oui / Non',       color: '#10B981' },
    { type: 'faitnonfait', icon: 'fa-circle-check',     l: 'Fait / Non fait', color: '#22C55E' },
    { type: 'commentaire', icon: 'fa-comment-lines',    l: 'Commentaire',     color: '#F59E0B' },
    { type: 'date',        icon: 'fa-calendar',         l: 'Date',            color: '#F97316' },
    { type: 'heure',       icon: 'fa-clock',            l: 'Heure',           color: '#EF4444' },
    { type: 'photo',       icon: 'fa-camera',           l: 'Photo',           color: '#EC4899' },
    { type: 'signature',   icon: 'fa-pen-nib',          l: 'Signature',       color: '#A855F7' },
  ];

  var FREQ_LABELS = {
    on_demand:  'À la demande',
    daily:      'Quotidien',
    weekly:     'Hebdomadaire',
    biweekly:   'Bihebdomadaire',
    monthly:    'Mensuel',
    quarterly:  'Trimestriel',
  };

  var STATUS_LABELS = {
    draft:     'Brouillon',
    published: 'Publié',
    archived:  'Archivé',
  };

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

    _unsub.templates = DB.templates()
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        _templates = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        _rerender();
      }, _fsErr('mx_doc_templates'));

    _unsub.instances = DB.instances()
      .orderBy('startedAt', 'desc')
      .limit(200)
      .onSnapshot(function (snap) {
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
    if (_builderMode) { _renderBuilder(mc); return; }
    if (_execMode)    { _renderExec(mc);    return; }
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
      { id: 'modeles',    icon: 'fa-layer-group',      l: 'Mes modèles'  },
      { id: 'historique', icon: 'fa-clock-rotate-left', l: 'Historique'  },
      { id: 'parametres', icon: 'fa-sliders',           l: 'Paramètres'  },
    ];
    var th = tabs.map(function (t) {
      return '<button class="mxd-tab' + (_curTab === t.id ? ' mxd-tab--active' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._tab(\'' + t.id + '\')">'
        + '<i class="fas ' + t.icon + '"></i><span>' + t.l + '</span></button>';
    }).join('');
    return '<div class="mxd-page">'
      + '<div class="mxd-tabs">' + th + '</div>'
      + '<div id="mxd-body" class="mxd-body"></div>'
      + '</div>';
  }

  function _renderTabBody() {
    var bd = document.getElementById('mxd-body');
    if (bd) bd.innerHTML = _tabBody();
  }

  function _tabBody() {
    if (_curTab === 'modeles')    return _tModeles();
    if (_curTab === 'historique') return _tHistorique();
    if (_curTab === 'parametres') return _tParametres();
    return '';
  }

  function _tab(id) { _curTab = id; _renderTabBody(); }

  // ─────────────────────────────────────────────────────
  // TAB: MES MODÈLES
  // ─────────────────────────────────────────────────────
  function _tModeles() {
    var canEdit = _canEdit();
    var filters = [
      { id: 'all',       l: 'Tous' },
      { id: 'published', l: 'Publiés' },
      { id: 'draft',     l: 'Brouillons' },
      { id: 'archived',  l: 'Archivés'  },
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
      ? _emptyState('Aucun modèle', 'fa-file-circle-plus',
          canEdit ? 'Créez votre premier modèle de document.' : 'Aucun modèle disponible.')
      : visible.map(_templateCard).join('');

    return '<div class="mxd-modeles">'
      + '<div class="mxd-mod-head">'
      + '<div class="mxd-filters">' + fH + '</div>'
      + (canEdit ? '<button class="mxd-new-btn" onclick="MX.Pages.MxDoc._newTemplate()"><i class="fas fa-plus"></i> Nouveau modèle</button>' : '')
      + '</div>'
      + '<div class="mxd-cards">' + cardsH + '</div>'
      + '</div>';
  }

  function _templateCard(t) {
    var e       = _e;
    var status  = t.status || 'draft';
    var statusCls = { draft: 'mxd-status--draft', published: 'mxd-status--pub', archived: 'mxd-status--arch' }[status] || 'mxd-status--draft';
    var statusL = STATUS_LABELS[status] || status;
    var freqL   = FREQ_LABELS[t.frequency] || t.frequency || 'À la demande';
    var secCnt  = (t.sections || []).length;
    var blkCnt  = (t.sections || []).reduce(function (acc, s) { return acc + (s.blocks || []).length; }, 0);
    var canEdit = _canEdit();
    var accent  = e(t.color || 'var(--cyan)');
    var tid     = e(t.id);

    var actH = '';
    if (canEdit) {
      var pubArchBtn = status !== 'published'
        ? '<button class="mxd-act-btn mxd-act-btn--pub" onclick="event.stopPropagation();MX.Pages.MxDoc._publishTemplate(\'' + tid + '\')" title="Publier"><i class="fas fa-globe"></i></button>'
        : '<button class="mxd-act-btn mxd-act-btn--arch" onclick="event.stopPropagation();MX.Pages.MxDoc._archiveTemplate(\'' + tid + '\')" title="Archiver"><i class="fas fa-box-archive"></i></button>';
      actH = '<div class="mxd-card-acts">'
        + pubArchBtn
        + '<button class="mxd-act-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._duplicateTemplate(\'' + tid + '\')" title="Dupliquer"><i class="fas fa-copy"></i></button>'
        + '<button class="mxd-act-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._openBuilder(\'' + tid + '\')" title="Modifier"><i class="fas fa-pen"></i></button>'
        + '<button class="mxd-act-btn mxd-act-btn--del" onclick="event.stopPropagation();MX.Pages.MxDoc._deleteTemplate(\'' + tid + '\')" title="Supprimer"><i class="fas fa-trash"></i></button>'
        + '</div>';
    }

    var launchH = status === 'published'
      ? '<button class="mxd-launch-btn" onclick="event.stopPropagation();MX.Pages.MxDoc._startExec(\'' + tid + '\')">'
        + '<i class="fas fa-play"></i> Remplir</button>'
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
      + '</div>'
      + launchH
      + '</div>'
      + '</div>';
  }

  function _setFilter(f) { _filterStatus = f; _rerender(); }

  function _emptyState(title, icon, msg) {
    return '<div class="mxd-empty"><i class="fas ' + icon + '"></i>'
      + '<div class="mxd-empty-title">' + title + '</div>'
      + '<div class="mxd-empty-msg">' + msg + '</div></div>';
  }

  // ─────────────────────────────────────────────────────
  // TAB: HISTORIQUE
  // ─────────────────────────────────────────────────────
  function _tHistorique() {
    var rows = _instances.length === 0
      ? _emptyState('Aucun document', 'fa-clock-rotate-left', 'Les documents remplis apparaîtront ici.')
      : _instances.map(_instanceRow).join('');

    var expH = _instances.length > 0
      ? '<div class="mxd-hist-acts">'
        + '<button class="mxd-export-btn" onclick="MX.Pages.MxDoc._exportExcel()"><i class="fas fa-file-excel"></i> Excel</button>'
        + '<button class="mxd-export-btn" onclick="MX.Pages.MxDoc._exportPdf()"><i class="fas fa-print"></i> Imprimer</button>'
        + '</div>'
      : '';

    return '<div class="mxd-historique">'
      + '<div class="mxd-hist-head"><div class="mxd-hist-title"><i class="fas fa-clock-rotate-left"></i> Historique des documents</div>' + expH + '</div>'
      + '<div class="mxd-hist-list">' + rows + '</div>'
      + '</div>';
  }

  function _instanceRow(inst) {
    var e       = _e;
    var done    = inst.status === 'termine';
    var dateStr = _fmtTs(inst.completedAt || inst.startedAt);
    return '<div class="mxd-inst-row">'
      + '<div class="mxd-inst-icon ' + (done ? 'mxd-inst-icon--done' : '') + '"><i class="fas ' + (done ? 'fa-circle-check' : 'fa-circle-half-stroke') + '"></i></div>'
      + '<div class="mxd-inst-info">'
      + '<div class="mxd-inst-name">' + e(inst.templateTitle || 'Document') + '</div>'
      + '<div class="mxd-inst-meta">'
      + '<span><i class="fas fa-user"></i> ' + e(inst.assignedTo || '—') + '</span>'
      + '<span><i class="fas fa-calendar"></i> ' + dateStr + '</span>'
      + '</div>'
      + '</div>'
      + '<span class="mxd-inst-badge ' + (done ? 'mxd-inst-badge--done' : 'mxd-inst-badge--prog') + '">' + (done ? 'Terminé' : 'En cours') + '</span>'
      + '</div>';
  }

  // ─────────────────────────────────────────────────────
  // TAB: PARAMÈTRES
  // ─────────────────────────────────────────────────────
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
      + '</div>'
      + '</div>'
      + '<div class="mxd-params-card">'
      + '<div class="mxd-params-hdr"><i class="fas fa-cube"></i> Blocs disponibles</div>'
      + '<div class="mxd-params-types">'
      + BLOCK_TYPES.map(function (bt) {
          return '<div class="mxd-params-type"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i><span>' + bt.l + '</span></div>';
        }).join('')
      + '</div>'
      + '</div>'
      + '</div>';
  }

  // ─────────────────────────────────────────────────────
  // CRUD TEMPLATES
  // ─────────────────────────────────────────────────────
  function _newTemplate() { _openBuilder(null); }

  function _openBuilder(id) {
    var tpl = id ? _templates.find(function (t) { return t.id === id; }) : null;
    if (id && !tpl) return;
    _builderTpl  = tpl
      ? JSON.parse(JSON.stringify(tpl))
      : { id: null, title: '', description: '', icon: 'fa-file-lines', color: '#8B5CF6', status: 'draft', frequency: 'on_demand', sections: [] };
    _builderSecs = JSON.parse(JSON.stringify(_builderTpl.sections || []));
    if (!_builderSecs.length) _builderSecs.push({ id: _uid(), label: 'Section 1', blocks: [] });
    _selBlock    = null;
    _builderMode = true;
    render();
  }

  function _closeBuilder() {
    _builderMode = false;
    _builderTpl  = null;
    _builderSecs = [];
    _selBlock    = null;
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
    copy.title      = 'Copie — ' + tpl.title;
    copy.status     = 'draft';
    copy.createdBy  = _author();
    copy.createdAt  = FV.serverTimestamp();
    copy.updatedAt  = FV.serverTimestamp();
    copy.publishedAt = null;
    copy.archivedAt  = null;
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
      title: 'Supprimer ce modèle ?',
      sub:   _e(tpl.title || 'Sans titre'),
      body:  '<p style="color:var(--text2);font-size:13px">Cette action est irréversible. Les documents déjà remplis resteront dans l\'historique.</p>',
      actions: [
        { label: '<i class="fas fa-trash"></i> Supprimer', cls: 'danger',  fn: function () { _doDeleteTemplate(id); } },
        { label: 'Annuler',                                cls: 'cancel',   fn: function () {} },
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
  // BUILDER RENDER
  // ─────────────────────────────────────────────────────
  function _renderBuilder(mc) {
    var tpl = _builderTpl || {};
    var e   = _e;

    var freqOpts = Object.keys(FREQ_LABELS).map(function (k) {
      return '<option value="' + k + '"' + (tpl.frequency === k ? ' selected' : '') + '>' + FREQ_LABELS[k] + '</option>';
    }).join('');

    var ICONS = ['fa-file-lines','fa-file-contract','fa-clipboard-list','fa-file-check',
                 'fa-clipboard-check','fa-file-shield','fa-note-sticky','fa-scroll',
                 'fa-file-alt','fa-book-open','fa-tasks','fa-tools'];
    var iconPickH = ICONS.map(function (ic) {
      return '<button class="mxd-icon-pick' + (tpl.icon === ic ? ' mxd-icon-pick--on' : '') + '"'
        + ' onclick="MX.Pages.MxDoc._setBuilderIcon(\'' + ic + '\')" title="' + ic + '">'
        + '<i class="fas ' + ic + '"></i></button>';
    }).join('');

    var palH = BLOCK_TYPES.map(function (bt) {
      return '<div class="mxd-pal-item" draggable="true"'
        + ' ondragstart="MX.Pages.MxDoc._palDragStart(event,\'' + bt.type + '\')"'
        + ' ondragend="MX.Pages.MxDoc._palDragEnd(event)"'
        + ' style="--mxd-bt:' + bt.color + '" title="' + bt.l + '">'
        + '<i class="fas ' + bt.icon + '"></i><span>' + bt.l + '</span>'
        + '</div>';
    }).join('');

    var canvasH = _builderSecs.map(_renderBuilderSection).join('')
      + '<button class="mxd-add-sec-btn" onclick="MX.Pages.MxDoc._addSection()"><i class="fas fa-plus"></i> Ajouter une section</button>';

    mc.innerHTML = '<div class="mxd-builder">'

      + '<div class="mxd-bld-hdr">'
      + '<button class="mxd-bld-back" onclick="MX.Pages.MxDoc._closeBuilder()"><i class="fas fa-arrow-left"></i><span>Retour</span></button>'
      + '<input class="mxd-bld-name" id="mxd-bld-title" value="' + e(tpl.title || '') + '" placeholder="Nom du modèle…"'
      + ' oninput="MX.Pages.MxDoc._bldTitleChange(this.value)">'
      + '<div class="mxd-bld-acts">'
      + '<button class="mxd-bld-draft-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'draft\')"><i class="fas fa-save"></i><span>Brouillon</span></button>'
      + '<button class="mxd-bld-pub-btn" onclick="MX.Pages.MxDoc._saveBuilder(\'published\')"><i class="fas fa-globe"></i><span>Publier</span></button>'
      + '</div>'
      + '</div>'

      + '<div class="mxd-bld-meta">'
      + '<div class="mxd-bld-meta-g"><label>Description</label><input class="fi fi-sm" id="mxd-bld-desc" value="' + e(tpl.description || '') + '" placeholder="Description du document…" oninput="MX.Pages.MxDoc._bldDescChange(this.value)"></div>'
      + '<div class="mxd-bld-meta-g"><label>Fréquence</label><select class="fi fi-sm" id="mxd-bld-freq" onchange="MX.Pages.MxDoc._bldFreqChange(this.value)">' + freqOpts + '</select></div>'
      + '<div class="mxd-bld-meta-g"><label>Icône</label><div class="mxd-icon-row">' + iconPickH + '</div></div>'
      + '<div class="mxd-bld-meta-g"><label>Couleur</label><input type="color" class="mxd-color-inp" id="mxd-bld-color" value="' + e(tpl.color || '#8B5CF6') + '" oninput="MX.Pages.MxDoc._bldColorChange(this.value)"></div>'
      + '</div>'

      + '<div class="mxd-bld-body">'
      + '<div class="mxd-bld-pal"><div class="mxd-pal-hdr"><i class="fas fa-grip-vertical"></i> Blocs disponibles</div>' + palH + '</div>'
      + '<div class="mxd-bld-canvas" id="mxd-canvas">' + canvasH + '</div>'
      + '<div class="mxd-bld-props" id="mxd-props">' + _renderPropsPanel() + '</div>'
      + '</div>'

      + '</div>';
  }

  function _renderBuilderSection(sec, sIdx) {
    var e      = _e;
    var blocks = sec.blocks || [];
    var blksH  = blocks.map(function (blk, bIdx) { return _renderBuilderBlock(blk, sIdx, bIdx); }).join('');
    var dzH    = _dropZone(sIdx, blocks.length);
    return '<div class="mxd-sec" data-sidx="' + sIdx + '">'
      + '<div class="mxd-sec-hdr">'
      + '<i class="fas fa-grip-lines mxd-sec-grip"></i>'
      + '<input class="mxd-sec-name" value="' + e(sec.label || '') + '" placeholder="Nom de la section…"'
      + ' oninput="MX.Pages.MxDoc._secNameChange(' + sIdx + ',this.value)">'
      + '<button class="mxd-sec-del" onclick="MX.Pages.MxDoc._deleteSection(' + sIdx + ')" title="Supprimer"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '<div class="mxd-sec-blocks">' + blksH + dzH + '</div>'
      + '</div>';
  }

  function _dropZone(sIdx, bIdx) {
    return '<div class="mxd-dz" data-sidx="' + sIdx + '" data-bidx="' + bIdx + '"'
      + ' ondragover="event.preventDefault();MX.Pages.MxDoc._dzOver(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragleave="MX.Pages.MxDoc._dzLeave(event)"'
      + ' ondrop="MX.Pages.MxDoc._dzDrop(event,' + sIdx + ',' + bIdx + ')">'
      + '<span><i class="fas fa-plus-circle"></i> Glisser un bloc ici</span>'
      + '</div>';
  }

  function _renderBuilderBlock(blk, sIdx, bIdx) {
    var e   = _e;
    var bt  = _btInfo(blk.type);
    var sel = _selBlock && _selBlock.sIdx === sIdx && _selBlock.bIdx === bIdx;
    return '<div class="mxd-blk' + (sel ? ' mxd-blk--sel' : '') + '" draggable="true"'
      + ' ondragstart="MX.Pages.MxDoc._blkDragStart(event,' + sIdx + ',' + bIdx + ')"'
      + ' ondragend="MX.Pages.MxDoc._palDragEnd(event)"'
      + ' onclick="MX.Pages.MxDoc._selectBlock(' + sIdx + ',' + bIdx + ')">'
      + '<span class="mxd-blk-ico" style="color:' + bt.color + '"><i class="fas ' + bt.icon + '"></i></span>'
      + '<span class="mxd-blk-lbl">' + e(blk.label || bt.l) + '</span>'
      + (blk.required ? '<span class="mxd-blk-req" title="Obligatoire">*</span>' : '')
      + '<div class="mxd-blk-btns">'
      + '<button onclick="event.stopPropagation();MX.Pages.MxDoc._moveBlock(' + sIdx + ',' + bIdx + ',-1)" title="Monter"><i class="fas fa-chevron-up"></i></button>'
      + '<button onclick="event.stopPropagation();MX.Pages.MxDoc._moveBlock(' + sIdx + ',' + bIdx + ',1)" title="Descendre"><i class="fas fa-chevron-down"></i></button>'
      + '<button onclick="event.stopPropagation();MX.Pages.MxDoc._deleteBlock(' + sIdx + ',' + bIdx + ')" title="Supprimer"><i class="fas fa-trash"></i></button>'
      + '</div>'
      + '</div>';
  }

  function _renderPropsPanel() {
    if (!_selBlock) {
      return '<div class="mxd-props-hint"><i class="fas fa-hand-pointer"></i><span>Cliquez sur un bloc pour modifier ses propriétés</span></div>';
    }
    var sec = _builderSecs[_selBlock.sIdx];
    if (!sec) return '';
    var blk = sec.blocks[_selBlock.bIdx];
    if (!blk) return '';
    var e  = _e;
    var bt = _btInfo(blk.type);

    var h = '<div class="mxd-props-wrap">'
      + '<div class="mxd-props-type"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i> ' + bt.l + '</div>';

    // Label (all except separator)
    if (blk.type !== 'separator') {
      h += '<div class="form-group"><label>Libellé</label>'
        + '<input class="fi fi-sm" value="' + e(blk.label || '') + '" placeholder="Libellé du champ…"'
        + ' oninput="MX.Pages.MxDoc._propChange(\'label\',this.value)"></div>';
    }

    // Static content (titre, sstitre, texte)
    if (blk.type === 'titre' || blk.type === 'sstitre' || blk.type === 'texte') {
      h += '<div class="form-group"><label>Contenu</label>'
        + '<textarea class="fi fi-sm" rows="3" oninput="MX.Pages.MxDoc._propChange(\'value\',this.value)">' + e(blk.value || '') + '</textarea></div>';
    }

    // Required checkbox (interactive fields only)
    if (!STATIC_TYPES.includes(blk.type)) {
      h += '<label class="mxd-prop-check">'
        + '<input type="checkbox"' + (blk.required ? ' checked' : '') + ' onchange="MX.Pages.MxDoc._propChange(\'required\',this.checked)">'
        + '<span>Champ obligatoire</span></label>';
    }

    // Numérique extras
    if (blk.type === 'numerique') {
      h += '<div class="form-group"><label>Unité</label>'
        + '<input class="fi fi-sm" value="' + e(blk.unit || '') + '" placeholder="kWh, m³, °C…"'
        + ' oninput="MX.Pages.MxDoc._propChange(\'unit\',this.value)"></div>'
        + '<div style="display:flex;gap:8px">'
        + '<div class="form-group" style="flex:1"><label>Min</label><input type="number" class="fi fi-sm" value="' + (blk.min !== undefined ? blk.min : '') + '" oninput="MX.Pages.MxDoc._propChangeNum(\'min\',this.value)"></div>'
        + '<div class="form-group" style="flex:1"><label>Max</label><input type="number" class="fi fi-sm" value="' + (blk.max !== undefined ? blk.max : '') + '" oninput="MX.Pages.MxDoc._propChangeNum(\'max\',this.value)"></div>'
        + '</div>';
    }

    // Commentaire placeholder
    if (blk.type === 'commentaire') {
      h += '<div class="form-group"><label>Texte d\'aide</label>'
        + '<input class="fi fi-sm" value="' + e(blk.placeholder || '') + '" placeholder="Ex: Décrivez l\'état observé…"'
        + ' oninput="MX.Pages.MxDoc._propChange(\'placeholder\',this.value)"></div>';
    }

    h += '</div>';
    return h;
  }

  // ─────────────────────────────────────────────────────
  // BUILDER STATE MUTATIONS
  // ─────────────────────────────────────────────────────
  function _bldTitleChange(v) { if (_builderTpl) _builderTpl.title = v; }
  function _bldDescChange(v)  { if (_builderTpl) _builderTpl.description = v; }
  function _bldFreqChange(v)  { if (_builderTpl) _builderTpl.frequency = v; }
  function _bldColorChange(v) { if (_builderTpl) _builderTpl.color = v; }

  function _setBuilderIcon(icon) {
    if (!_builderTpl) return;
    _builderTpl.icon = icon;
    document.querySelectorAll('.mxd-icon-pick').forEach(function (b) {
      b.classList.toggle('mxd-icon-pick--on', b.title === icon);
    });
  }

  function _addSection() {
    _builderSecs.push({ id: _uid(), label: 'Nouvelle section', blocks: [] });
    _refreshCanvas();
  }

  function _deleteSection(sIdx) {
    if (_builderSecs.length <= 1) { MX.toast('Au moins une section est requise', false); return; }
    _builderSecs.splice(sIdx, 1);
    _selBlock = null;
    _refreshCanvas();
    _refreshProps();
  }

  function _secNameChange(sIdx, v) {
    if (_builderSecs[sIdx]) _builderSecs[sIdx].label = v;
  }

  function _selectBlock(sIdx, bIdx) {
    _selBlock = { sIdx: sIdx, bIdx: bIdx };
    _refreshCanvas();
    _refreshProps();
  }

  function _deleteBlock(sIdx, bIdx) {
    var sec = _builderSecs[sIdx];
    if (!sec) return;
    sec.blocks.splice(bIdx, 1);
    if (_selBlock && _selBlock.sIdx === sIdx && _selBlock.bIdx === bIdx) _selBlock = null;
    _refreshCanvas();
    _refreshProps();
  }

  function _moveBlock(sIdx, bIdx, dir) {
    var sec    = _builderSecs[sIdx];
    if (!sec) return;
    var newIdx = bIdx + dir;
    if (newIdx < 0 || newIdx >= sec.blocks.length) return;
    var tmp = sec.blocks[bIdx];
    sec.blocks[bIdx]    = sec.blocks[newIdx];
    sec.blocks[newIdx]  = tmp;
    _selBlock = { sIdx: sIdx, bIdx: newIdx };
    _refreshCanvas();
    _refreshProps();
  }

  function _propChange(key, value) {
    if (!_selBlock) return;
    var blk = (_builderSecs[_selBlock.sIdx] || {}).blocks;
    if (!blk) return;
    blk = blk[_selBlock.bIdx];
    if (!blk) return;
    blk[key] = value;
    if (key === 'label') {
      var el = document.querySelector('.mxd-blk--sel .mxd-blk-lbl');
      if (el) el.textContent = value;
    }
    if (key === 'required') {
      _refreshCanvas(); // need to show/hide the * marker
    }
  }

  function _propChangeNum(key, strVal) {
    var n = parseFloat(strVal);
    _propChange(key, isNaN(n) ? undefined : n);
  }

  // ─────────────────────────────────────────────────────
  // DRAG & DROP — Builder
  // ─────────────────────────────────────────────────────
  function _palDragStart(event, blockType) {
    _palDragType = blockType;
    _blkDragSrc  = null;
    event.dataTransfer.effectAllowed = 'copy';
  }

  function _blkDragStart(event, sIdx, bIdx) {
    _blkDragSrc  = { sIdx: sIdx, bIdx: bIdx };
    _palDragType = null;
    event.dataTransfer.effectAllowed = 'move';
  }

  function _palDragEnd(event) {
    _palDragType = null;
    _blkDragSrc  = null;
    document.querySelectorAll('.mxd-dz').forEach(function (z) { z.classList.remove('mxd-dz--over'); });
  }

  function _dzOver(event, sIdx, bIdx) {
    event.preventDefault();
    event.currentTarget.classList.add('mxd-dz--over');
  }

  function _dzLeave(event) {
    event.currentTarget.classList.remove('mxd-dz--over');
  }

  function _dzDrop(event, sIdx, bIdx) {
    event.preventDefault();
    event.currentTarget.classList.remove('mxd-dz--over');

    if (_palDragType) {
      var bt  = _btInfo(_palDragType);
      var blk = { id: _uid(), type: _palDragType, label: bt.l };
      var sec = _builderSecs[sIdx];
      if (!sec) return;
      sec.blocks.splice(bIdx, 0, blk);
      _selBlock = { sIdx: sIdx, bIdx: bIdx };
      _refreshCanvas();
      _refreshProps();
    } else if (_blkDragSrc) {
      var srcSec = _builderSecs[_blkDragSrc.sIdx];
      var dstSec = _builderSecs[sIdx];
      if (!srcSec || !dstSec) return;
      var blk2 = srcSec.blocks.splice(_blkDragSrc.bIdx, 1)[0];
      var ins  = bIdx;
      if (_blkDragSrc.sIdx === sIdx && _blkDragSrc.bIdx < bIdx) ins--;
      dstSec.blocks.splice(Math.max(0, ins), 0, blk2);
      _selBlock = { sIdx: sIdx, bIdx: Math.max(0, ins) };
      _refreshCanvas();
      _refreshProps();
    }
  }

  function _refreshCanvas() {
    var canvas = document.getElementById('mxd-canvas');
    if (!canvas) return;
    canvas.innerHTML = _builderSecs.map(_renderBuilderSection).join('')
      + '<button class="mxd-add-sec-btn" onclick="MX.Pages.MxDoc._addSection()"><i class="fas fa-plus"></i> Ajouter une section</button>';
  }

  function _refreshProps() {
    var props = document.getElementById('mxd-props');
    if (props) props.innerHTML = _renderPropsPanel();
  }

  async function _saveBuilder(status) {
    if (!_builderTpl) return;
    var titleEl = document.getElementById('mxd-bld-title');
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
        payload.createdAt  = FV.serverTimestamp();
        payload.createdBy  = _author();
        payload.archivedAt = null;
        await DB.templates().add(payload);
      }
      MX.syncEnd();
      MX.toast(status === 'published' ? 'Modèle publié !' : 'Brouillon enregistré');
      _closeBuilder();
    } catch (err) {
      MX.syncFail();
      MX.toast('Erreur: ' + err.message, true);
    }
  }

  // ─────────────────────────────────────────────────────
  // EXECUTION VIEW
  // ─────────────────────────────────────────────────────
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

    var sectH = (tpl.sections || []).map(function (sec) {
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
      + '</div>'
      + '</div>'
      + '<div class="mxd-exec-body">'
      + sectH
      + '<div class="mxd-exec-footer">'
      + '<button class="secondary-btn" onclick="MX.Pages.MxDoc._saveExec(\'en_cours\')"><i class="fas fa-save"></i> Sauvegarder</button>'
      + '<button class="primary-btn" onclick="MX.Pages.MxDoc._saveExec(\'termine\')"><i class="fas fa-check"></i> Valider et terminer</button>'
      + '</div>'
      + '</div>'
      + '</div>';
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
        + (blk.unit ? '<span class="mxd-unit">' + e(blk.unit) + '</span>' : '')
        + '</div>';
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
    } else if (blk.type === 'date') {
      inputH = '<input type="date" class="fi" value="' + (val || '') + '" oninput="MX.Pages.MxDoc._setResponse(\'' + bid + '\',this.value)">';
    } else if (blk.type === 'heure') {
      inputH = '<input type="time" class="fi" value="' + (val || '') + '" oninput="MX.Pages.MxDoc._setResponse(\'' + bid + '\',this.value)">';
    } else if (blk.type === 'photo') {
      inputH = '<div class="mxd-photo-wrap">'
        + '<input type="file" accept="image/*" capture="environment" class="mxd-photo-inp" id="mxd-ph-' + bid + '" onchange="MX.Pages.MxDoc._onExecPhoto(\'' + bid + '\',this)">'
        + '<label for="mxd-ph-' + bid + '" class="mxd-photo-lbl">'
        + (val ? '<img src="' + val + '" class="mxd-photo-prev">' : '<i class="fas fa-camera"></i><span>Ajouter une photo</span>')
        + '</label>'
        + '</div>';
    } else if (blk.type === 'signature') {
      inputH = '<div class="mxd-sig-wrap"><div class="mxd-sig-ph"><i class="fas fa-pen-nib"></i><span>Zone signature</span></div></div>';
    }

    return '<div class="mxd-exec-blk">'
      + '<div class="mxd-exec-blk-lbl"><i class="fas ' + bt.icon + '" style="color:' + bt.color + '"></i> ' + e(blk.label || bt.l) + req + '</div>'
      + '<div class="mxd-exec-blk-inp">' + inputH + '</div>'
      + '</div>';
  }

  function _setResponse(blkId, value) {
    _execResponses[blkId] = value;
  }

  function _onExecPhoto(blkId, input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var MAX = 800;
        var w = img.width, h = img.height;
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
      if (missing.length) {
        MX.toast('Champs obligatoires manquants : ' + missing.slice(0, 3).join(', '), false);
        return;
      }
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
    } catch (err) {
      MX.syncFail();
      MX.toast('Erreur: ' + err.message, true);
    }
  }

  // ─────────────────────────────────────────────────────
  // EXPORTS
  // ─────────────────────────────────────────────────────
  function _exportPdf() { window.print(); }

  function _exportExcel() {
    if (!window.XLSX) { MX.toast('Export XLSX indisponible', false); return; }
    var rows = [['Document', 'Technicien', 'Statut', 'Date début', 'Date fin']];
    _instances.forEach(function (inst) {
      rows.push([
        inst.templateTitle || '',
        inst.assignedTo    || '',
        inst.status === 'termine' ? 'Terminé' : 'En cours',
        _fmtTs(inst.startedAt),
        inst.status === 'termine' ? _fmtTs(inst.completedAt) : '',
      ]);
    });
    var ws = window.XLSX.utils.aoa_to_sheet(rows);
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'MX Doc Historique');
    window.XLSX.writeFile(wb, 'mxdoc-historique.xlsx');
  }

  // ─────────────────────────────────────────────────────
  // DESTROY
  // ─────────────────────────────────────────────────────
  function _destroy() {
    Object.keys(_unsub).forEach(function (k) { try { if (_unsub[k]) _unsub[k](); } catch(e) {} });
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
  }

  // ─────────────────────────────────────────────────────
  // EXPOSE
  // ─────────────────────────────────────────────────────
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
    _addSection,
    _deleteSection,
    _secNameChange,
    _selectBlock,
    _deleteBlock,
    _moveBlock,
    _propChange,
    _propChangeNum,
    _palDragStart,
    _blkDragStart,
    _palDragEnd,
    _dzOver,
    _dzLeave,
    _dzDrop,
    _saveBuilder,
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
