(function () {
  // ── Local state ──
  var _filter       = 'all';
  var _dateRange    = null;
  var _tagFilter    = null;
  var _searchQ      = '';
  var _selectedType = 'info';
  var _expandedSet  = new Set();
  var _replyListeners = {};
  var _replies      = {};
  var _pendingFile  = null;
  var _pendingTags  = [];
  var _composeOpen  = false;
  var _searchTimer  = null;

  // ── Types ──
  var T = {
    info:         { icon: 'fa-circle-info',          label: 'Information',            c: '#60A5FA', cd: 'rgba(96,165,250,.12)',   cb: 'rgba(96,165,250,.3)' },
    consigne:     { icon: 'fa-clipboard',            label: 'Consigne',               c: '#F59E0B', cd: 'rgba(245,158,11,.12)',   cb: 'rgba(245,158,11,.3)' },
    incident:     { icon: 'fa-triangle-exclamation', label: 'Incident',               c: '#EF4444', cd: 'rgba(239,68,68,.12)',    cb: 'rgba(239,68,68,.3)' },
    intervention: { icon: 'fa-wrench',               label: 'Intervention',           c: '#FB923C', cd: 'rgba(251,146,60,.12)',   cb: 'rgba(251,146,60,.3)' },
    pmp:          { icon: 'fa-shield-halved',        label: 'Maintenance préventive', c: '#4ADE80', cd: 'rgba(74,222,128,.12)',   cb: 'rgba(74,222,128,.3)' },
    stock:        { icon: 'fa-boxes-stacked',        label: 'Stock',                  c: '#A78BFA', cd: 'rgba(167,139,250,.12)',  cb: 'rgba(167,139,250,.3)' },
    compteur:     { icon: 'fa-gauge',                label: 'Compteur',               c: '#FB923C', cd: 'rgba(251,146,60,.12)',   cb: 'rgba(251,146,60,.3)' },
    conso:        { icon: 'fa-chart-line',           label: 'Consommation',           c: '#34D399', cd: 'rgba(52,211,153,.12)',   cb: 'rgba(52,211,153,.3)' },
    technique:    { icon: 'fa-microchip',            label: 'Technique',              c: '#4ADE80', cd: 'rgba(74,222,128,.12)',   cb: 'rgba(74,222,128,.3)' },
    securite:     { icon: 'fa-shield',               label: 'Sécurité',               c: '#EF4444', cd: 'rgba(239,68,68,.12)',    cb: 'rgba(239,68,68,.3)' },
    document:     { icon: 'fa-file-lines',           label: 'Document',               c: '#94A3B8', cd: 'rgba(148,163,184,.12)',  cb: 'rgba(148,163,184,.3)' },
    auto:         { icon: 'fa-robot',                label: 'Automatique',            c: '#94A3B8', cd: 'rgba(148,163,184,.12)',  cb: 'rgba(148,163,184,.3)' },
    // Legacy backward compat
    important:    { icon: 'fa-clipboard',            label: 'Consigne',               c: '#F59E0B', cd: 'rgba(245,158,11,.12)',   cb: 'rgba(245,158,11,.3)' },
    urgent:       { icon: 'fa-triangle-exclamation', label: 'Incident',               c: '#EF4444', cd: 'rgba(239,68,68,.12)',    cb: 'rgba(239,68,68,.3)' },
    suggestion:   { icon: 'fa-lightbulb',            label: 'Suggestion',             c: '#34D399', cd: 'rgba(52,211,153,.12)',   cb: 'rgba(52,211,153,.3)' },
  };

  var COMPOSE_TYPES = ['info','consigne','incident','intervention','pmp','stock','compteur','conso','technique','securite','document'];

  // ── Professional reactions ──
  var JRXN = [
    { key: 'ok',      label: 'Pris en compte',     fa: 'fa-check',                  short: '✓' },
    { key: 'warning', label: 'À vérifier',          fa: 'fa-triangle-exclamation',   short: '⚠' },
    { key: 'wrench',  label: 'Intervention créée',  fa: 'fa-wrench',                 short: '🔧' },
    { key: 'attach',  label: 'Document ajouté',     fa: 'fa-paperclip',              short: '📎' },
    { key: 'seen',    label: 'Vu',                  fa: 'fa-eye',                    short: '👀' },
  ];
  var OLD_RXN = ['👍', '✅', '⚠️'];

  var POPULAR_TAGS = ['CTA','ECS','Cuisine','Ascenseur','Piscine','LocalSud','SSI','Électricité'];

  var FILTER_GROUPS = [
    {
      title: 'Type d\'événement',
      items: [
        { id: 'all',          icon: 'fa-list',                  label: 'Tout le journal' },
        { id: 'info',         icon: 'fa-circle-info',           label: 'Informations' },
        { id: 'consigne',     icon: 'fa-clipboard',             label: 'Consignes' },
        { id: 'incident',     icon: 'fa-triangle-exclamation',  label: 'Incidents' },
        { id: 'intervention', icon: 'fa-wrench',                label: 'Interventions' },
        { id: 'pmp',          icon: 'fa-shield-halved',         label: 'Maintenance préventive' },
        { id: 'stock',        icon: 'fa-boxes-stacked',         label: 'Stock' },
        { id: 'compteur',     icon: 'fa-gauge',                 label: 'Compteurs' },
        { id: 'conso',        icon: 'fa-chart-line',            label: 'Consommations' },
        { id: 'technique',    icon: 'fa-microchip',             label: 'Technique' },
        { id: 'securite',     icon: 'fa-shield',                label: 'Sécurité' },
        { id: 'document',     icon: 'fa-file-lines',            label: 'Documents' },
        { id: 'photos',       icon: 'fa-images',                label: 'Photos' },
      ]
    },
    {
      title: 'Accès rapide',
      items: [
        { id: 'unread',  icon: 'fa-envelope',    label: 'Non lus' },
        { id: 'pinned',  icon: 'fa-thumbtack',   label: 'Épinglés' },
        { id: 'mine',    icon: 'fa-user',         label: 'Mes publications' },
        { id: 'auto',    icon: 'fa-robot',        label: 'Automatiques' },
      ]
    }
  ];

  // ── Permissions ──
  function _author() {
    if (MX.Auth.isAdmin()) return (MX.state.adminUser && MX.state.adminUser.displayName) || 'Admin';
    return (MX.state.currentUser && MX.state.currentUser.name) || null;
  }
  function _role() {
    if (MX.Auth.isAdmin()) return 'admin';
    return (MX.state.currentUser && MX.state.currentUser.role) || null;
  }
  function _allowedTypes() {
    var r = _role();
    if (!r) return [];
    if (r === 'admin' || r === 'responsable') return COMPOSE_TYPES;
    if (r === 'technicien') return ['info','incident','technique','stock','compteur'];
    return [];
  }
  function _canPin() { return MX.Auth.isAdmin() || (MX.state.currentUser && MX.state.currentUser.role === 'responsable'); }
  function _canDel(ann) {
    if (MX.Auth.isAdmin()) return true;
    var cu = MX.state.currentUser;
    if (!cu) return false;
    if (cu.role === 'responsable') return true;
    return ann.authorName === cu.name;
  }
  function _canDelReply(r) {
    if (MX.Auth.isAdmin()) return true;
    var cu = MX.state.currentUser;
    if (!cu) return false;
    if (cu.role === 'responsable') return true;
    return r.authorName === cu.name;
  }

  // ── Helpers ──
  function _tsMs(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds) return ts.seconds * 1000;
    return 0;
  }
  function _relTime(ts) {
    var ms = _tsMs(ts);
    if (!ms) return '';
    var diff = Date.now() - ms;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'À l\'instant';
    if (mins < 60) return 'Il y a ' + mins + ' min';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return 'Il y a ' + hrs + 'h';
    var d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' +
           d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function _fullDate(ts) {
    var ms = _tsMs(ts);
    if (!ms) return '';
    var d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) +
           ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function _renderContent(text) {
    return MX.esc(text || '')
      .replace(/@([\wÀ-ž]+)/g, '<span class="jex-mention jex-mention--user">@$1</span>')
      .replace(/#([A-Za-zÀ-ž0-9_-]+)/g, '<span class="jex-mention jex-mention--tag">#$1</span>');
  }
  function _typeInfo(ann) { return T[ann.type] || T.info; }
  function _startOfDay(daysAgo) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function _typeMatches(ann, filterId) {
    var type = ann.type || 'info';
    if (filterId === 'consigne')     return type === 'consigne' || type === 'important';
    if (filterId === 'incident')     return type === 'incident' || type === 'urgent';
    if (filterId === 'intervention') return type === 'intervention';
    if (filterId === 'pmp')          return type === 'pmp';
    if (filterId === 'stock')        return type === 'stock';
    if (filterId === 'compteur')     return type === 'compteur';
    if (filterId === 'conso')        return type === 'conso';
    if (filterId === 'technique')    return type === 'technique' || type === 'suggestion';
    if (filterId === 'securite')     return type === 'securite';
    if (filterId === 'document')     return type === 'document';
    return type === filterId;
  }

  function _filtered(list) {
    var author = _author();
    var seen = parseInt(localStorage.getItem('mx_msgs_seen') || '0', 10);
    var items = list.slice().sort(function(a, b) {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return _tsMs(b.createdAt) - _tsMs(a.createdAt);
    });

    if (_filter === 'photos')    items = items.filter(function(a) { return a.imageUrl && !(a.imageMime || '').includes('pdf'); });
    else if (_filter === 'unread') items = items.filter(function(a) {
      if (author && (a.readBy || []).includes(author)) return false;
      return _tsMs(a.createdAt) > seen;
    });
    else if (_filter === 'pinned') items = items.filter(function(a) { return a.pinned; });
    else if (_filter === 'mine')   items = items.filter(function(a) { return a.authorName === author; });
    else if (_filter === 'auto')   items = items.filter(function(a) { return a.isAuto; });
    else if (_filter !== 'all')    items = items.filter(function(a) { return _typeMatches(a, _filter); });

    if (_dateRange === 'today')     items = items.filter(function(a) { return _tsMs(a.createdAt) >= _startOfDay(0); });
    else if (_dateRange === 'yesterday') items = items.filter(function(a) { var ms = _tsMs(a.createdAt); return ms >= _startOfDay(1) && ms < _startOfDay(0); });
    else if (_dateRange === 'week') items = items.filter(function(a) { return _tsMs(a.createdAt) >= _startOfDay(7); });
    else if (_dateRange === 'month') items = items.filter(function(a) { return _tsMs(a.createdAt) >= _startOfDay(30); });

    if (_tagFilter) {
      var t = _tagFilter.toLowerCase();
      items = items.filter(function(a) {
        return (a.tags || []).some(function(tg) { return tg.toLowerCase() === t; }) ||
          (a.content || '').toLowerCase().includes('#' + t);
      });
    }
    if (_searchQ) {
      var q = _searchQ.toLowerCase();
      items = items.filter(function(a) {
        return (a.title || '').toLowerCase().includes(q) ||
          (a.content || '').toLowerCase().includes(q) ||
          (a.authorName || '').toLowerCase().includes(q) ||
          (a.tags || []).some(function(tg) { return tg.toLowerCase().includes(q); });
      });
    }
    return items;
  }

  // ── File handling ──
  function _compressMsg(file) {
    if (!file.type.startsWith('image/')) return Promise.resolve(file);
    var MAX_PX = 1400, QUALITY = 0.80;
    return new Promise(function(resolve) {
      var t = setTimeout(function() { resolve(file); }, 10000);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w <= MAX_PX && h <= MAX_PX && file.size < 400000) { clearTimeout(t); resolve(file); return; }
        var s = Math.min(1, MAX_PX / Math.max(w, h));
        w = Math.round(w * s); h = Math.round(h * s);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(function(b) { clearTimeout(t); resolve(b || file); }, 'image/jpeg', QUALITY);
      };
      img.onerror = function() { clearTimeout(t); resolve(file); };
      img.src = url;
    });
  }
  function _pickFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    _pendingFile = file;
    var prev = document.getElementById('jex-attach-preview');
    if (!prev) { input.value = ''; return; }
    if (file.type.startsWith('image/')) {
      var url = URL.createObjectURL(file);
      prev.innerHTML = '<div class="jex-preview-wrap">' +
        '<img src="' + url + '" class="jex-preview-img" alt="preview">' +
        '<button class="jex-preview-rm" onclick="MX.Pages.Messages._removeFile()"><i class="fas fa-times"></i></button>' +
        '</div>';
    } else {
      prev.innerHTML = '<div class="jex-preview-wrap">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg4);border-radius:8px;border:1px solid var(--border)">' +
          '<i class="fas fa-file-pdf" style="color:var(--red);font-size:22px"></i>' +
          '<span style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + MX.esc(file.name) + '</span>' +
        '</div>' +
        '<button class="jex-preview-rm" onclick="MX.Pages.Messages._removeFile()"><i class="fas fa-times"></i></button>' +
        '</div>';
    }
    prev.style.display = 'block';
    input.value = '';
  }
  function _removeFile() {
    _pendingFile = null;
    var prev = document.getElementById('jex-attach-preview');
    if (prev) { prev.innerHTML = ''; prev.style.display = 'none'; }
  }
  function _onDrop(e) {
    e.preventDefault();
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    _pickFile({ files: [file], value: '' });
  }
  function _openImg(url) {
    MX.showModal({
      title: '',
      body: '<div style="text-align:center;padding:4px 0"><img src="' + MX.esc(url) + '" style="max-width:100%;max-height:65vh;border-radius:10px;object-fit:contain;display:block;margin:0 auto"></div>',
      actions: [{ label: 'Fermer', cls: 'cancel' }]
    });
  }

  // ── Render ──
  function render() {
    var el = document.getElementById('main-content');
    if (!el) return;
    var anns = MX.state.announcements || [];
    var author = _author();

    var allowed = _allowedTypes();
    if (allowed.length && !allowed.includes(_selectedType)) _selectedType = allowed[0];

    if (author) {
      anns.forEach(function(a) {
        if (!(a.readBy || []).includes(author)) MX.DB.markReadAnnouncement(a.id, author).catch(function(){});
      });
    }

    var h = '';
    h += '<div class="ph">';
    h += '<div class="ph-eye">JOURNAL D\'EXPLOITATION</div>';
    h += '<div class="ph-row"><div>';
    h += '<div class="ph-title">Journal d\'exploitation</div>';
    h += '<div class="ph-sub">Historique des événements techniques, consignes et activités de maintenance</div>';
    h += '</div></div>';
    h += '</div>';

    h += '<div class="jex-layout">';
    h += '<div class="jex-left" id="jex-left">' + _leftHtml(anns, author) + '</div>';
    h += '<div class="jex-feed" id="jex-feed">';
    h += _composeHtml(author, allowed);
    h += _feedHtml(anns, author);
    h += '</div>';
    h += '<div class="jex-right" id="jex-right">' + _rightHtml(anns) + '</div>';
    h += '</div>';

    el.innerHTML = h;
    _expandedSet.forEach(function(id) { _renderRepliesEl(id); });
    _highlightTypePill(_selectedType);
  }

  // ── Left panel ──
  function _leftHtml(anns, author) {
    var h = '';
    h += '<div class="jex-search-wrap">';
    h += '<div class="jex-search-box">';
    h += '<i class="fas fa-magnifying-glass jex-search-ico"></i>';
    h += '<input class="jex-search-in" type="text" placeholder="Rechercher dans le journal…"';
    h += ' value="' + MX.esc(_searchQ) + '"';
    h += ' oninput="MX.Pages.Messages._setSearch(this.value)">';
    if (_searchQ) h += '<button class="jex-search-clear" onclick="MX.Pages.Messages._setSearch(\'\')"><i class="fas fa-times"></i></button>';
    h += '</div>';
    h += '</div>';

    var seen = parseInt(localStorage.getItem('mx_msgs_seen') || '0', 10);

    FILTER_GROUPS.forEach(function(group) {
      h += '<div class="jex-filter-group">';
      h += '<div class="jex-filter-group-title">' + group.title + '</div>';
      group.items.forEach(function(item) {
        var count = null;
        if (item.id === 'all') count = anns.length;
        else if (item.id === 'unread') count = anns.filter(function(a) {
          if (author && (a.readBy || []).includes(author)) return false;
          return _tsMs(a.createdAt) > seen;
        }).length;
        else if (item.id === 'pinned') count = anns.filter(function(a) { return a.pinned; }).length;
        else if (item.id === 'incident') count = anns.filter(function(a) { return _typeMatches(a, 'incident'); }).length;
        else if (item.id === 'photos') count = anns.filter(function(a) { return a.imageUrl && !(a.imageMime || '').includes('pdf'); }).length;
        var isActive = _filter === item.id && !_dateRange && !_tagFilter && !_searchQ;
        h += '<button class="jex-filter-item' + (isActive ? ' active' : '') + '"';
        h += ' onclick="MX.Pages.Messages._setFilter(\'' + item.id + '\')">';
        h += '<i class="fas ' + item.icon + ' jex-fi"></i>';
        h += '<span class="jex-filter-label">' + item.label + '</span>';
        if (count) h += '<span class="jex-filter-badge">' + count + '</span>';
        h += '</button>';
      });
      h += '</div>';
    });

    h += '<div class="jex-filter-group">';
    h += '<div class="jex-filter-group-title">Période</div>';
    [
      { id: 'today',     label: 'Aujourd\'hui' },
      { id: 'yesterday', label: 'Hier' },
      { id: 'week',      label: 'Cette semaine' },
      { id: 'month',     label: 'Ce mois' },
    ].forEach(function(d) {
      var isActive = _dateRange === d.id;
      h += '<button class="jex-filter-item jex-date-item' + (isActive ? ' active' : '') + '"';
      h += ' onclick="MX.Pages.Messages._setDateFilter(\'' + d.id + '\')">';
      h += '<i class="fas fa-calendar-days jex-fi"></i>';
      h += '<span class="jex-filter-label">' + d.label + '</span>';
      h += '</button>';
    });
    h += '</div>';

    h += '<div class="jex-filter-group">';
    h += '<div class="jex-filter-group-title">Tags fréquents</div>';
    h += '<div class="jex-tag-cloud">';
    POPULAR_TAGS.forEach(function(tag) {
      var isActive = _tagFilter === tag;
      h += '<button class="jex-tag' + (isActive ? ' active' : '') + '"';
      h += ' onclick="MX.Pages.Messages._setTagFilter(\'' + MX.esc(tag) + '\')">#' + MX.esc(tag) + '</button>';
    });
    h += '</div>';
    h += '</div>';

    return h;
  }

  // ── Feed ──
  function _feedHtml(anns, author) {
    var filtered = _filtered(anns);
    var h = '';
    if (!filtered.length) {
      h += '<div class="jex-empty">';
      h += '<div class="jex-empty-ico"><i class="fas fa-book-open-reader"></i></div>';
      h += '<div class="jex-empty-title">Aucune publication</div>';
      h += '<div class="jex-empty-sub">' + (_filter !== 'all' || _searchQ || _dateRange || _tagFilter
        ? 'Aucun événement ne correspond à ce filtre.'
        : 'Le journal d\'exploitation est vide. Documentez le premier événement.') + '</div>';
      h += '</div>';
    } else {
      filtered.forEach(function(a) { h += _cardHtml(a, author); });
    }
    return h;
  }

  // ── Right panel ──
  function _rightHtml(anns) {
    var todayStart = _startOfDay(0);
    var todayAnns  = anns.filter(function(a) { return _tsMs(a.createdAt) >= todayStart; });
    var openIncidents = anns.filter(function(a) { return _typeMatches(a, 'incident') && !a.resolved; }).length;
    var todayInterv = (MX.state.missions || []).filter(function(m) {
      var ms = m.createdAt ? _tsMs(m.createdAt) : 0;
      return ms >= todayStart;
    }).length;
    var pinnedConsignes = anns.filter(function(a) { return a.pinned && (a.type === 'consigne' || a.type === 'important'); });
    var recentPhotos   = anns.filter(function(a) { return a.imageUrl && !(a.imageMime || '').includes('pdf'); }).slice(0, 6);

    var h = '';

    // Stats
    h += '<div class="jex-rp-section">';
    h += '<div class="jex-rp-title"><i class="fas fa-chart-bar"></i> Activité du jour</div>';
    h += '<div class="jex-rp-stats">';
    h += _rpStat(todayAnns.length, 'Publications', 'fa-newspaper', '#60A5FA');
    h += _rpStat(openIncidents, 'Incidents ouverts', 'fa-triangle-exclamation', '#EF4444');
    h += _rpStat(todayInterv, 'Interventions', 'fa-wrench', '#FB923C');
    h += _rpStat(MX.state.presenceCount || 0, 'Connectés', 'fa-users', '#4ADE80');
    h += '</div>';
    h += '</div>';

    // Pinned consignes
    if (pinnedConsignes.length) {
      h += '<div class="jex-rp-section">';
      h += '<div class="jex-rp-title" style="color:var(--orange)"><i class="fas fa-thumbtack"></i> Consignes épinglées</div>';
      pinnedConsignes.slice(0, 4).forEach(function(a) {
        var t = _typeInfo(a);
        h += '<div class="jex-rp-pin" onclick="document.getElementById(\'ann_' + a.id + '\')&&document.getElementById(\'ann_' + a.id + '\').scrollIntoView({behavior:\'smooth\'})">';
        h += '<div class="jex-rp-pin-stripe" style="background:' + t.c + '"></div>';
        h += '<div class="jex-rp-pin-body">';
        if (a.title) h += '<div class="jex-rp-pin-title">' + MX.esc(a.title) + '</div>';
        h += '<div class="jex-rp-pin-text">' + MX.esc((a.content || '').substring(0, 72)) + ((a.content || '').length > 72 ? '…' : '') + '</div>';
        h += '<div class="jex-rp-pin-meta">' + MX.esc(a.authorName || '') + ' · ' + _relTime(a.createdAt) + '</div>';
        h += '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    // Recent photos
    if (recentPhotos.length) {
      h += '<div class="jex-rp-section">';
      h += '<div class="jex-rp-title"><i class="fas fa-images"></i> Dernières photos</div>';
      h += '<div class="jex-rp-photos">';
      recentPhotos.forEach(function(a) {
        h += '<div class="jex-rp-photo" onclick="MX.Pages.Messages._openImg(\'' + MX.esc(a.imageUrl) + '\')"';
        h += ' style="background-image:url(\'' + MX.esc(a.imageUrl) + '\')"></div>';
      });
      h += '</div>';
      h += '</div>';
    }

    // Recent activity
    h += '<div class="jex-rp-section">';
    h += '<div class="jex-rp-title"><i class="fas fa-clock-rotate-left"></i> Flux récent</div>';
    anns.slice(0, 6).forEach(function(a) {
      var t = _typeInfo(a);
      var rc = a.replyCount || 0;
      h += '<div class="jex-rp-activity" onclick="document.getElementById(\'ann_' + a.id + '\')&&document.getElementById(\'ann_' + a.id + '\').scrollIntoView({behavior:\'smooth\'})">';
      h += '<div class="jex-rp-act-stripe" style="background:' + t.c + '"></div>';
      h += '<div class="jex-rp-act-body">';
      h += '<div class="jex-rp-act-title">' + MX.esc(a.title || (a.content || '').substring(0, 38)) + '</div>';
      h += '<div class="jex-rp-act-meta">';
      h += '<span style="color:' + t.c + '">' + MX.esc(t.label) + '</span>';
      h += ' · ' + MX.esc(a.authorName || '') + ' · ' + _relTime(a.createdAt);
      if (rc) h += ' · ' + rc + ' rép.';
      h += '</div>';
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';

    return h;
  }

  function _rpStat(val, label, icon, color) {
    return '<div class="jex-rp-stat">' +
      '<div class="jex-rp-stat-icon" style="color:' + color + '"><i class="fas ' + icon + '"></i></div>' +
      '<div class="jex-rp-stat-val" style="color:' + color + '">' + (val || 0) + '</div>' +
      '<div class="jex-rp-stat-label">' + label + '</div>' +
      '</div>';
  }

  // ── Compose ──
  function _composeHtml(author, allowed) {
    if (!author || !allowed.length) {
      return '<div class="jex-compose-locked">' +
        '<i class="fas fa-lock" style="font-size:28px;color:var(--text3);margin-bottom:10px"></i>' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:6px">Connexion requise</div>' +
        '<div style="font-size:12px;color:var(--text2);margin-bottom:14px">Connectez-vous pour publier dans le journal</div>' +
        '<button onclick="MX.Auth.showUserPicker()" class="primary-btn" style="margin:0 auto;width:auto;padding:10px 24px">' +
          '<i class="fas fa-user-circle"></i> Se connecter' +
        '</button>' +
        '</div>';
    }
    var isAdm = MX.Auth.isAdmin();
    var bg = isAdm ? 'var(--cyan)' : MX.avatarBg(author);
    var fg = isAdm ? '#0C0C0E'    : MX.avatarFg(author);
    var roleMap = { admin: 'Administrateur', responsable: 'Responsable', technicien: 'Technicien' };
    var roleLabel = roleMap[_role()] || 'Utilisateur';

    var h = '<div class="jex-compose" id="jex-compose">';

    h += '<div class="jex-compose-who">';
    if (isAdm) {
      h += '<div class="ann-av" style="background:' + bg + ';color:' + fg + '">' + MX.esc(author.substring(0, 2).toUpperCase()) + '</div>';
    } else {
      h += MX.userAvatarHtml(author, { size: 36, radius: 10 });
    }
    h += '<div>';
    h += '<div style="font-size:13px;font-weight:600">' + (MX.badgeTag ? MX.badgeTag(author) : '') + MX.esc(author) + '</div>';
    h += '<div style="font-size:11px;color:var(--text2)">' + roleLabel + '</div>';
    h += '</div>';
    h += '<button class="jex-compose-trigger" id="jex-compose-btn" onclick="MX.Pages.Messages._toggleCompose()">';
    h += _composeOpen
      ? '<i class="fas fa-times"></i> Annuler'
      : '<i class="fas fa-pen-to-square"></i> Publier un événement';
    h += '</button>';
    h += '</div>';

    h += '<div class="jex-compose-body" id="jex-compose-body" style="display:' + (_composeOpen ? 'block' : 'none') + '">';

    // Type grid
    h += '<div class="jex-type-grid">';
    allowed.forEach(function(key) {
      var t = T[key];
      if (!t) return;
      h += '<button type="button" class="jex-type-btn" id="jtp_' + key + '"';
      h += ' onclick="MX.Pages.Messages._setType(\'' + key + '\')"';
      h += ' style="--tc:' + t.c + ';--tcd:' + t.cd + ';--tcb:' + t.cb + '">';
      h += '<i class="fas ' + t.icon + '"></i>';
      h += '<span>' + t.label + '</span>';
      h += '</button>';
    });
    h += '</div>';

    h += '<input class="fi jex-title-in" id="jex-title" placeholder="Titre (optionnel — ex: Panne CTA Cuisine)" maxlength="120">';
    h += '<textarea class="fi jex-ta" id="jex-content"';
    h += ' placeholder="Décrivez l\'événement… Utilisez @nom pour mentionner quelqu\'un et #tag pour étiqueter"';
    h += ' rows="4" maxlength="2000"';
    h += ' oninput="MX.Pages.Messages._onInput(this)"';
    h += ' ondragover="event.preventDefault()" ondrop="MX.Pages.Messages._onDrop(event)"></textarea>';

    h += '<div class="jex-tags-row">';
    h += '<i class="fas fa-hashtag" style="color:var(--text3);font-size:12px;flex-shrink:0"></i>';
    h += '<input class="jex-tag-in" id="jex-tag-in" placeholder="Tag (Entrée pour valider : CTA, ECS…)" maxlength="30"';
    h += ' onkeydown="MX.Pages.Messages._tagKeydown(event)">';
    h += '<div id="jex-tags-list" class="jex-tags-list"></div>';
    h += '</div>';

    h += '<div class="jex-attach-bar">';
    h += '<label class="jex-attach-btn"><i class="fas fa-paperclip"></i> Fichier<input type="file" accept="image/*,application/pdf,.xlsx,.docx" style="display:none" onchange="MX.Pages.Messages._pickFile(this)"></label>';
    h += '<label class="jex-attach-btn"><i class="fas fa-camera"></i> Photo<input type="file" accept="image/*" capture="environment" style="display:none" onchange="MX.Pages.Messages._pickFile(this)"></label>';
    h += '<label class="jex-attach-btn"><i class="fas fa-image"></i> Galerie<input type="file" accept="image/*" style="display:none" onchange="MX.Pages.Messages._pickFile(this)"></label>';
    h += '<span style="flex:1"></span>';
    h += '<span class="jex-char" id="jex-char">0 / 2000</span>';
    h += '</div>';

    h += '<div id="jex-attach-preview" style="display:none"></div>';

    h += '<div class="jex-compose-foot">';
    h += '<button class="sec-btn" onclick="MX.Pages.Messages._toggleCompose()" style="width:auto;padding:10px 18px"><i class="fas fa-times"></i> Annuler</button>';
    h += '<button class="primary-btn" id="jex-send-btn" onclick="MX.Pages.Messages.send()" style="width:auto;padding:10px 22px"><i class="fas fa-paper-plane"></i> Publier dans le journal</button>';
    h += '</div>';

    h += '</div>'; // compose-body
    h += '</div>'; // compose
    return h;
  }

  // ── Card ──
  function _cardHtml(ann, author) {
    var t = _typeInfo(ann);
    var isAdm = ann.authorRole === 'admin';
    var bg = isAdm ? 'var(--cyan)' : MX.avatarBg(ann.authorName || '');
    var fg = isAdm ? '#0C0C0E'    : MX.avatarFg(ann.authorName || '');
    var rLabel = { admin: 'Admin', responsable: 'Resp.', technicien: 'Tech.' }[ann.authorRole] || '';
    var canPin = _canPin(), canDel = _canDel(ann);
    var isExpanded = _expandedSet.has(ann.id);
    var replies = ann.replyCount || 0;
    var reads   = (ann.readBy || []).length;
    var isUnread = author ? !(ann.readBy || []).includes(author) : false;
    var isNewFmt = ann.reactions && ('ok' in ann.reactions);

    // Reactions HTML
    var rxnH = '<div class="jex-rxns">';
    if (isNewFmt) {
      JRXN.forEach(function(r) {
        var users  = (ann.reactions || {})[r.key] || [];
        var active = author && users.includes(author);
        rxnH += '<button class="jex-rxn' + (active ? ' active' : '') + '" title="' + r.label + '"';
        rxnH += ' onclick="MX.Pages.Messages._react(\'' + ann.id + '\',\'' + r.key + '\',' + active + ')">';
        rxnH += '<i class="fas ' + r.fa + '"></i>';
        rxnH += '<span>' + r.short + '</span>';
        if (users.length) rxnH += '<span class="jex-rxn-count">' + users.length + '</span>';
        rxnH += '</button>';
      });
    } else {
      OLD_RXN.forEach(function(e) {
        var users  = (ann.reactions || {})[e] || [];
        var active = author && users.includes(author);
        rxnH += '<button class="jex-rxn jex-rxn--legacy' + (active ? ' active' : '') + '"';
        rxnH += ' onclick="MX.Pages.Messages._react(\'' + ann.id + '\',\'' + e + '\',' + active + ')">';
        rxnH += e;
        if (users.length) rxnH += '<span class="jex-rxn-count">' + users.length + '</span>';
        rxnH += '</button>';
      });
    }
    rxnH += '</div>';

    var h = '<div class="jex-card' + (ann.pinned ? ' jex-card--pinned' : '') + (isUnread ? ' jex-card--unread' : '') + '" id="ann_' + ann.id + '">';
    h += '<div class="jex-card-stripe" style="background:' + t.c + '"></div>';
    h += '<div class="jex-card-inner">';

    if (ann.pinned) {
      h += '<div class="jex-card-pinbar" style="background:' + t.cd + ';border-color:' + t.cb + ';color:' + t.c + '">';
      h += '<i class="fas fa-thumbtack"></i> Consigne épinglée';
      h += '</div>';
    }

    // Header: author + type badge
    h += '<div class="jex-card-hd">';
    h += '<div class="jex-card-author">';
    if (isAdm) {
      h += '<div class="ann-av" style="background:' + bg + ';color:' + fg + ';width:40px;height:40px;border-radius:11px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + MX.esc((ann.authorName || '?').substring(0, 2).toUpperCase()) + '</div>';
    } else {
      h += MX.userAvatarHtml(ann.authorName || '?', { size: 40, radius: 11 });
    }
    h += '<div class="jex-card-author-info">';
    h += '<div class="jex-card-author-name">' + (MX.badgeTag ? MX.badgeTag(ann.authorName || '') : '') + MX.esc(ann.authorName || '?') + '</div>';
    h += '<div class="jex-card-author-meta">';
    h += '<span class="jex-role-badge" style="color:' + t.c + ';background:' + t.cd + ';border-color:' + t.cb + '">' + rLabel + '</span>';
    h += '<span class="jex-card-ts" title="' + _fullDate(ann.createdAt) + '">' + _relTime(ann.createdAt) + '</span>';
    h += '</div>';
    h += '</div>';
    h += '</div>'; // author

    h += '<div class="jex-card-hd-right">';
    if (isUnread) h += '<div class="jex-dot"></div>';
    h += '<div class="jex-type-badge" style="color:' + t.c + ';background:' + t.cd + ';border-color:' + t.cb + '">';
    h += '<i class="fas ' + t.icon + '"></i> ' + t.label;
    h += '</div>';
    h += '</div>';
    h += '</div>'; // jex-card-hd

    if (ann.title) h += '<div class="jex-card-title">' + MX.esc(ann.title) + '</div>';
    if (ann.content) h += '<div class="jex-card-content">' + _renderContent(ann.content) + '</div>';

    if (ann.tags && ann.tags.length) {
      h += '<div class="jex-card-tags">';
      ann.tags.forEach(function(tag) {
        h += '<span class="jex-card-tag" onclick="MX.Pages.Messages._setTagFilter(\'' + MX.esc(tag) + '\')">#' + MX.esc(tag) + '</span>';
      });
      h += '</div>';
    }

    if (ann.imageUrl) {
      if ((ann.imageMime || '').includes('pdf')) {
        h += '<div class="jex-card-pdf" onclick="window.open(\'' + MX.esc(ann.imageUrl) + '\',\'_blank\')">';
        h += '<i class="fas fa-file-pdf"></i><span>Pièce jointe PDF</span><i class="fas fa-external-link" style="margin-left:auto;opacity:.6"></i>';
        h += '</div>';
      } else {
        h += '<div class="jex-card-img-wrap" onclick="MX.Pages.Messages._openImg(\'' + MX.esc(ann.imageUrl) + '\')">';
        h += '<img src="' + MX.esc(ann.imageUrl) + '" class="jex-card-img" alt="Photo jointe" loading="lazy">';
        h += '<div class="jex-card-img-ov"><i class="fas fa-expand"></i></div>';
        h += '</div>';
      }
    }

    // Footer
    h += '<div class="jex-card-foot">';
    h += rxnH;
    h += '<div class="jex-card-actions">';
    h += '<button class="jex-act' + (isExpanded ? ' jex-act--on' : '') + '" onclick="MX.Pages.Messages._toggleReplies(\'' + ann.id + '\')" title="Répondre">';
    h += '<i class="fas fa-reply"></i>' + (replies ? ' ' + replies : '');
    h += '</button>';
    h += '<button class="jex-act" onclick="MX.Pages.Messages._readers(\'' + ann.id + '\')" title="' + reads + ' lecteur(s)">';
    h += '<i class="fas fa-eye"></i> ' + reads;
    h += '</button>';
    h += '<button class="jex-act jex-act--interv" onclick="MX.Pages.Messages._createIntervention(\'' + ann.id + '\')" title="Créer une intervention">';
    h += '<i class="fas fa-wrench"></i>';
    h += '</button>';
    if (canPin) {
      h += '<button class="jex-act' + (ann.pinned ? ' jex-act--on' : '') + '" onclick="MX.Pages.Messages._pin(\'' + ann.id + '\',' + ann.pinned + ')" title="' + (ann.pinned ? 'Désépingler' : 'Épingler') + '">';
      h += '<i class="fas fa-thumbtack"></i>';
      h += '</button>';
    }
    if (canDel) {
      h += '<button class="jex-act jex-act--del" onclick="MX.Pages.Messages._del(\'' + ann.id + '\')" title="Supprimer">';
      h += '<i class="fas fa-trash"></i>';
      h += '</button>';
    }
    h += '</div>';
    h += '</div>'; // foot

    h += '<div class="jex-replies-wrap" id="rpl_' + ann.id + '" style="display:' + (isExpanded ? 'block' : 'none') + '"></div>';
    h += '</div>'; // inner
    h += '</div>'; // card
    return h;
  }

  // ── Replies ──
  function _renderRepliesEl(annId) {
    var wrap = document.getElementById('rpl_' + annId);
    if (!wrap) return;
    var list = _replies[annId] || [];
    var author = _author();
    var h = '<div class="jex-replies-box">';
    if (!list.length) {
      h += '<div class="jex-replies-empty">Aucune réponse pour l\'instant</div>';
    } else {
      list.forEach(function(r) {
        var isAdm = r.authorRole === 'admin';
        var bg = isAdm ? 'var(--cyan)' : MX.avatarBg(r.authorName || '');
        var fg = isAdm ? '#0C0C0E'     : MX.avatarFg(r.authorName || '');
        var rLbl = { admin: 'Admin', responsable: 'Resp.', technicien: 'Tech.' }[r.authorRole] || '';
        var canDel = _canDelReply(r);
        h += '<div class="jex-reply">';
        if (isAdm) {
          h += '<div class="ann-av sm" style="background:' + bg + ';color:' + fg + '">' + MX.esc((r.authorName || '?').substring(0, 2).toUpperCase()) + '</div>';
        } else {
          h += MX.userAvatarHtml(r.authorName || '?', { size: 28, radius: 8 });
        }
        h += '<div style="flex:1;min-width:0">';
        h += '<div class="jex-reply-meta">';
        h += '<span class="jex-reply-author">' + (MX.badgeTag ? MX.badgeTag(r.authorName || '') : '') + MX.esc(r.authorName || '?') + '</span>';
        h += '<span class="jex-reply-role">' + rLbl + '</span>';
        h += '<span class="jex-reply-ts">' + _relTime(r.createdAt) + '</span>';
        if (canDel) h += '<button onclick="MX.Pages.Messages._delReply(\'' + annId + '\',\'' + r.id + '\')" class="jex-reply-del"><i class="fas fa-times"></i></button>';
        h += '</div>';
        h += '<div class="jex-reply-body">' + _renderContent(r.content || '') + '</div>';
        h += '</div>';
        h += '</div>';
      });
    }
    if (author) {
      h += '<div class="jex-reply-compose">';
      h += '<textarea class="fi" id="rpl_ta_' + annId + '" placeholder="Votre réponse…" rows="2" style="font-size:13px;resize:none"></textarea>';
      h += '<button class="primary-btn" onclick="MX.Pages.Messages._sendReply(\'' + annId + '\')" style="width:auto;padding:8px 16px;font-size:13px;margin-top:6px;align-self:flex-end">';
      h += '<i class="fas fa-paper-plane"></i> Répondre</button>';
      h += '</div>';
    }
    h += '</div>';
    wrap.innerHTML = h;
  }

  // ── Actions ──
  function _toggleCompose() {
    _composeOpen = !_composeOpen;
    var body = document.getElementById('jex-compose-body');
    var btn  = document.getElementById('jex-compose-btn');
    if (body) body.style.display = _composeOpen ? 'block' : 'none';
    if (btn) btn.innerHTML = _composeOpen
      ? '<i class="fas fa-times"></i> Annuler'
      : '<i class="fas fa-pen-to-square"></i> Publier un événement';
    if (_composeOpen) {
      setTimeout(function() {
        var ta = document.getElementById('jex-content');
        if (ta) ta.focus();
        _highlightTypePill(_selectedType);
      }, 60);
    }
  }

  function _setType(type) { _selectedType = type; _highlightTypePill(type); }
  function _highlightTypePill(type) {
    document.querySelectorAll('.jex-type-btn').forEach(function(el) {
      el.classList.toggle('active', el.id === 'jtp_' + type);
    });
  }
  function _onInput(ta) {
    var n = (ta.value || '').length;
    var el = document.getElementById('jex-char');
    if (el) { el.textContent = n + ' / 2000'; el.style.color = n > 1800 ? 'var(--orange)' : 'var(--text3)'; }
  }

  function _setFilter(f) { _filter = f; _dateRange = null; _tagFilter = null; _searchQ = ''; render(); }
  function _setDateFilter(f) { _dateRange = (_dateRange === f) ? null : f; render(); }
  function _setTagFilter(t) { _tagFilter = (_tagFilter === t) ? null : t; _filter = 'all'; _dateRange = null; render(); }
  function _setSearch(q) {
    _searchQ = q;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(function() { render(); }, 280);
  }

  function _tagKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    var val = (e.target.value || '').trim().replace(/^#/, '');
    if (!val || _pendingTags.includes(val)) return;
    _pendingTags.push(val);
    e.target.value = '';
    _renderPendingTags();
  }
  function _removeTag(tag) {
    _pendingTags = _pendingTags.filter(function(t) { return t !== tag; });
    _renderPendingTags();
  }
  function _renderPendingTags() {
    var el = document.getElementById('jex-tags-list');
    if (!el) return;
    el.innerHTML = _pendingTags.map(function(t) {
      return '<span class="jex-compose-tag">#' + MX.esc(t) +
        '<button onclick="MX.Pages.Messages._removeTag(\'' + MX.esc(t) + '\')" style="background:none;border:none;cursor:pointer;color:inherit;padding:0 0 0 4px;line-height:1"><i class="fas fa-times" style="font-size:9px"></i></button>' +
        '</span>';
    }).join('');
  }

  async function send() {
    var author = _author();
    if (!author) return MX.toast('Connectez-vous pour publier', true);
    var content = ((document.getElementById('jex-content') || {}).value || '').trim();
    var title   = ((document.getElementById('jex-title')   || {}).value || '').trim();
    if (!content && !title && !_pendingFile) return MX.toast('Écrivez quelque chose', true);
    var allowed = _allowedTypes();
    if (!allowed.includes(_selectedType)) return MX.toast('Type non autorisé pour votre rôle', true);

    var fileToUpload = _pendingFile;
    var btn = document.getElementById('jex-send-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
      var imageUrl = null, imageMime = null;
      if (fileToUpload) {
        MX.toast('Compression…');
        var compressed = await _compressMsg(fileToUpload);
        MX.toast('Upload en cours…');
        imageUrl = await MX.DB.uploadMessageImage(compressed);
        imageMime = fileToUpload.type || 'image/jpeg';
      }
      await MX.DB.sendAnnouncement({
        type: _selectedType,
        title: title || null,
        content,
        tags: _pendingTags.length ? _pendingTags.slice() : null,
        authorName: author,
        authorRole: _role(),
        imageUrl,
        imageMime,
        useNewReactions: true
      });
      MX.toast('Publié dans le journal ✓');
      var ta = document.getElementById('jex-content'); if (ta) ta.value = '';
      var ti = document.getElementById('jex-title');   if (ti) ti.value = '';
      _pendingFile = null; _pendingTags = [];
      var prev = document.getElementById('jex-attach-preview'); if (prev) { prev.innerHTML = ''; prev.style.display = 'none'; }
      var tl = document.getElementById('jex-tags-list'); if (tl) tl.innerHTML = '';
      _composeOpen = false;
      var body = document.getElementById('jex-compose-body'); if (body) body.style.display = 'none';
      var cbtn = document.getElementById('jex-compose-btn');
      if (cbtn) cbtn.innerHTML = '<i class="fas fa-pen-to-square"></i> Publier un événement';
    } catch (e) {
      console.error(e); MX.toast('Erreur lors de la publication', true);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publier dans le journal'; }
    }
  }

  function _toggleReplies(annId) {
    if (_expandedSet.has(annId)) {
      _expandedSet.delete(annId);
      if (_replyListeners[annId]) { _replyListeners[annId](); delete _replyListeners[annId]; }
      var w = document.getElementById('rpl_' + annId);
      if (w) w.style.display = 'none';
    } else {
      _expandedSet.add(annId);
      var w = document.getElementById('rpl_' + annId);
      if (w) { w.style.display = 'block'; w.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3)"><i class="fas fa-spinner fa-spin"></i></div>'; }
      _replyListeners[annId] = MX.DB.listenReplies(annId, function(list) {
        _replies[annId] = list;
        _renderRepliesEl(annId);
      });
    }
  }

  async function _react(annId, key, isActive) {
    var author = _author();
    if (!author) return MX.toast('Connectez-vous pour réagir', true);
    try { await MX.DB.toggleReaction(annId, key, author, isActive); }
    catch (e) { console.error(e); }
  }

  async function _pin(annId, currentlyPinned) {
    try { await MX.DB.togglePin(annId, currentlyPinned); MX.toast(currentlyPinned ? 'Désépinglé' : 'Épinglé 📌'); }
    catch (e) { MX.toast('Erreur', true); }
  }

  function _del(annId) {
    MX.showModal('Supprimer cette publication ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async function() {
        try { await MX.DB.deleteAnnouncement(annId); MX.toast('Publication supprimée'); }
        catch (e) { MX.toast('Erreur suppression', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  async function _sendReply(annId) {
    var author = _author();
    if (!author) return MX.toast('Connectez-vous pour répondre', true);
    var ta = document.getElementById('rpl_ta_' + annId);
    var content = (ta ? ta.value : '').trim();
    if (!content) return MX.toast('Écrivez quelque chose', true);
    try {
      await MX.DB.sendReply({ annId, content, authorName: author, authorRole: _role() });
      if (ta) ta.value = '';
      MX.toast('Réponse envoyée ✓');
    } catch (e) { MX.toast('Erreur lors de la réponse', true); }
  }

  function _delReply(annId, replyId) {
    MX.showModal('Supprimer cette réponse ?', '', [
      { label: 'Supprimer', cls: 'danger', fn: async function() {
        try { await MX.DB.deleteReply(annId, replyId); MX.toast('Réponse supprimée'); }
        catch (e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _readers(annId) {
    var ann = (MX.state.announcements || []).find(function(a) { return a.id === annId; });
    if (!ann) return;
    var r = ann.readBy || [];
    MX.showModal(
      'Lu par ' + r.length + ' personne' + (r.length !== 1 ? 's' : ''),
      r.length ? r.join(', ') : 'Aucune lecture enregistrée.',
      [{ label: 'Fermer', cls: 'cancel' }]
    );
  }

  function _createIntervention(annId) {
    var ann = (MX.state.announcements || []).find(function(a) { return a.id === annId; });
    if (!ann) return;
    window._jexIntervPrefill = {
      title: ann.title || (ann.content || '').substring(0, 60) || 'Intervention',
      description: ann.content || '',
      fromJournalId: annId,
      type: ann.type
    };
    MX.showPage('interventions');
    MX.toast('Formulaire pré-rempli depuis le journal ✓');
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Messages = {
    render, send,
    _setType, _setFilter, _setDateFilter, _setTagFilter, _setSearch, _onInput,
    _toggleCompose, _tagKeydown, _removeTag,
    _react, _pin, _del,
    _toggleReplies, _sendReply, _delReply,
    _readers, _createIntervention,
    _pickFile, _removeFile, _onDrop, _openImg
  };
})();
