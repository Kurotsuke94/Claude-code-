(function () {
  'use strict';

  let _tab    = 'all';   // all | unread | fav | archived
  let _filter = 'all';   // type filter
  let _search = '';
  let _favIds = new Set();

  const _FAV_KEY = 'mx_notif_favs';

  function _loadFavs() {
    try { _favIds = new Set(JSON.parse(localStorage.getItem(_FAV_KEY) || '[]')); }
    catch (_e) { _favIds = new Set(); }
  }
  function _saveFavs() {
    try { localStorage.setItem(_FAV_KEY, JSON.stringify([..._favIds])); }
    catch (_e) {}
  }

  const TYPES = [
    { id: 'all',          icon: '🔔', l: 'Tout' },
    { id: 'message',      icon: '📩', l: 'Messages' },
    { id: 'mission',      icon: '🔧', l: 'Missions' },
    { id: 'checklist',    icon: '✅', l: 'Checklists' },
    { id: 'counter',      icon: '📊', l: 'Compteurs' },
    { id: 'intervention', icon: '🛠️', l: 'Interventions' },
    { id: 'absence',      icon: '🗓️', l: 'Absences' },
    { id: 'planning',     icon: '📅', l: 'Planning' },
    { id: 'alert',        icon: '🚨', l: 'Alertes' },
    { id: 'stock',        icon: '📦', l: 'Stock' },
    { id: 'badge',        icon: '🏆', l: 'Badges' },
    { id: 'update',       icon: '🚀', l: 'Mises à jour' },
    { id: 'system',       icon: '⚙️', l: 'Système' },
  ];

  const LEVEL_META = {
    critical:  { color: '#EF4444', lbl: 'CRITIQUE'  },
    important: { color: '#F97316', lbl: 'IMPORTANT' },
    warning:   { color: '#EAB308', lbl: 'ATTENTION' },
    info:      { color: '#06B6D4', lbl: 'INFO'      },
    success:   { color: '#22C55E', lbl: 'SUCCÈS'    },
  };

  const PAGE_MAP = {
    mission: 'missions', checklist: 'checks', intervention: 'missions',
    planning: 'planning', stock: 'stock', message: 'messages',
    counter: 'checks', absence: 'planning',
  };

  function _catColor(type) {
    var m = {
      message: '#06B6D4', mission: '#EF4444', checklist: '#F97316',
      counter: '#EAB308', intervention: '#F97316', absence: '#8B5CF6',
      planning: '#3B82F6', alert: '#EF4444', stock: '#EAB308',
      badge: '#22C55E', update: '#8B5CF6', system: '#64748b',
    };
    return m[type] || (MX.Notifs ? MX.Notifs._catColor(type) : '#06B6D4');
  }

  function _catIcon(type) {
    var icons = {
      message: '📩', mission: '🔧', checklist: '✅', counter: '📊',
      intervention: '🛠️', absence: '🗓️', planning: '📅', alert: '🚨',
      stock: '📦', badge: '🏆', update: '🚀', system: '⚙️',
    };
    return icons[type] || (MX.Notifs ? MX.Notifs._catIcon(type) : '🔔');
  }

  function _tsMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts.seconds) return ts.seconds * 1000;
    return new Date(ts).getTime();
  }

  function _fmtTime(ts) {
    if (!ts) return '';
    var d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(_tsMs(ts));
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return 'À l\'instant';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function _filterNotifs(all) {
    var list = all;
    if (_tab === 'unread') list = list.filter(function (n) { return !n.read; });
    else if (_tab === 'fav') list = list.filter(function (n) { return _favIds.has(n.id); });
    if (_filter !== 'all') list = list.filter(function (n) { return n.type === _filter; });
    if (_search.trim()) {
      var q = _search.toLowerCase();
      list = list.filter(function (n) {
        return (n.title || '').toLowerCase().indexOf(q) !== -1
          || (n.description || '').toLowerCase().indexOf(q) !== -1
          || (n.author || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    return list;
  }

  function _groupByDate(notifs) {
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var yestStart  = todayStart - 86400000;
    var weekStart  = todayStart - 6 * 86400000;
    var g = { today: [], yesterday: [], week: [], older: [] };
    notifs.forEach(function (n) {
      var ms = _tsMs(n.createdAt);
      if (ms >= todayStart)     g.today.push(n);
      else if (ms >= yestStart) g.yesterday.push(n);
      else if (ms >= weekStart) g.week.push(n);
      else                      g.older.push(n);
    });
    return g;
  }

  function _renderItem(n) {
    var color = _catColor(n.type);
    var icon  = n.icon || _catIcon(n.type);
    var time  = _fmtTime(n.createdAt);
    var lm    = n.level && LEVEL_META[n.level] ? LEVEL_META[n.level] : null;
    var isFav = _favIds.has(n.id);
    var hasAction = PAGE_MAP[n.type] || n.actionUrl;

    var levelTag = lm
      ? '<span class="nc-level-tag" style="background:' + lm.color + '18;color:' + lm.color + '">' + lm.lbl + '</span>'
      : '';

    return '<div class="nc-item' + (n.read ? '' : ' nc-item--unread') + '" data-id="' + MX.esc(n.id) + '">'
      + '<div class="nc-stripe" style="background:' + color + '"></div>'
      + '<div class="nc-icon-wrap" style="color:' + color + ';background:' + color + '18">' + icon + '</div>'
      + (!n.read ? '<div class="nc-unread-dot"></div>' : '')
      + '<div class="nc-body">'
      + '<div class="nc-title-row">'
      + (lm ? levelTag + ' ' : '')
      + '<span class="nc-title">' + MX.esc(n.title) + '</span>'
      + (time ? '<span class="nc-time">' + time + '</span>' : '')
      + '</div>'
      + (n.description ? '<div class="nc-desc">' + MX.esc(n.description) + '</div>' : '')
      + '<div class="nc-meta-row">'
      + '<span class="nc-type-tag" style="color:' + color + '">' + _catIcon(n.type) + ' ' + n.type + '</span>'
      + (n.author ? '<span class="nc-sep">·</span><span class="nc-author">' + MX.esc(n.author) + '</span>' : '')
      + '</div>'
      + (hasAction
        ? '<div class="nc-actions"><button class="nc-btn-view" data-nid="' + MX.esc(n.id) + '" onclick="MX.Pages.Notifications._actionView(this.dataset.nid)">'
          + '<i class="fas fa-eye"></i> Voir</button></div>'
        : '')
      + '</div>'
      + '<div class="nc-item-btns">'
      + '<button class="nc-icon-btn' + (isFav ? ' nc-fav-on' : '') + '" data-nid="' + MX.esc(n.id) + '" '
      + 'onclick="MX.Pages.Notifications._toggleFav(this.dataset.nid)" title="' + (isFav ? 'Retirer des favoris' : 'Favori') + '">'
      + '<i class="fas fa-star"></i></button>'
      + (!n.read
        ? '<button class="nc-icon-btn nc-read-btn" data-nid="' + MX.esc(n.id) + '" '
          + 'onclick="MX.Pages.Notifications._markRead(this.dataset.nid)" title="Marquer comme lu">'
          + '<i class="fas fa-check"></i></button>'
        : '')
      + '<button class="nc-icon-btn nc-del-btn" data-nid="' + MX.esc(n.id) + '" '
      + 'onclick="MX.Pages.Notifications._delete(this.dataset.nid)" title="Supprimer">'
      + '<i class="fas fa-trash"></i></button>'
      + '</div>'
      + '</div>';
  }

  function _renderGroups(notifs) {
    var g = _groupByDate(notifs);
    var html = '';
    if (g.today.length) {
      html += '<div class="nc-date-sep"><span>Aujourd\'hui</span></div>';
      html += g.today.map(_renderItem).join('');
    }
    if (g.yesterday.length) {
      html += '<div class="nc-date-sep"><span>Hier</span></div>';
      html += g.yesterday.map(_renderItem).join('');
    }
    if (g.week.length) {
      html += '<div class="nc-date-sep"><span>Cette semaine</span></div>';
      html += g.week.map(_renderItem).join('');
    }
    if (g.older.length) {
      html += '<div class="nc-date-sep"><span>Plus anciennes</span></div>';
      html += g.older.map(_renderItem).join('');
    }
    return html;
  }

  function render() {
    _loadFavs();
    var mc = document.getElementById('main-content');
    if (!mc) return;

    var all    = MX.state.notifications || [];
    var notifs = _tab === 'archived' ? [] : _filterNotifs(all);
    var totalUnread = all.filter(function (n) { return !n.read; }).length;

    // Tab counts
    var tabUnread   = all.filter(function (n) { return !n.read; }).length;
    var tabFav      = all.filter(function (n) { return _favIds.has(n.id); }).length;

    var TABS = [
      { id: 'all',      icon: 'fa-bell',       l: 'Tout',      cnt: all.length },
      { id: 'unread',   icon: 'fa-circle',      l: 'Non lues',  cnt: tabUnread },
      { id: 'fav',      icon: 'fa-star',        l: 'Favoris',   cnt: tabFav },
      { id: 'archived', icon: 'fa-box-archive', l: 'Archivées', cnt: 0 },
    ];

    var tabsHtml = TABS.map(function (t) {
      return '<button class="nc-tab' + (_tab === t.id ? ' nc-tab--active' : '') + '" '
        + 'onclick="MX.Pages.Notifications._setTab(\'' + t.id + '\')">'
        + '<i class="fas ' + t.icon + '"></i><span>' + t.l + '</span>'
        + (t.cnt ? '<span class="nc-tab-cnt">' + t.cnt + '</span>' : '')
        + '</button>';
    }).join('');

    // Type filter pills (only show in non-fav/archived tabs)
    var typeHtml = '';
    if (_tab === 'all' || _tab === 'unread') {
      typeHtml = TYPES.map(function (t) {
        var base = _tab === 'unread' ? all.filter(function(n) { return !n.read; }) : all;
        var cnt = t.id === 'all'
          ? base.filter(function(n) { return !n.read; }).length
          : base.filter(function(n) { return n.type === t.id && !n.read; }).length;
        return '<button class="nc-pill' + (_filter === t.id ? ' nc-pill--active' : '') + '" '
          + 'onclick="MX.Pages.Notifications._setFilter(\'' + t.id + '\')">'
          + t.icon + ' ' + t.l
          + (cnt ? '<span class="nc-pill-cnt">' + cnt + '</span>' : '')
          + '</button>';
      }).join('');
    }

    // Stats badges (urgent / missions / messages)
    var statHtml = '';
    var urgentCnt  = all.filter(function(n) { return !n.read && (n.level === 'critical' || n.type === 'alert'); }).length;
    var missionCnt = all.filter(function(n) { return !n.read && n.type === 'mission'; }).length;
    var msgCnt     = all.filter(function(n) { return !n.read && n.type === 'message'; }).length;
    if (urgentCnt)  statHtml += '<span class="nc-stat nc-stat--red"><i class="fas fa-circle-exclamation"></i> ' + urgentCnt + ' urgence' + (urgentCnt > 1 ? 's' : '') + '</span>';
    if (missionCnt) statHtml += '<span class="nc-stat nc-stat--orange"><i class="fas fa-list-check"></i> ' + missionCnt + ' mission' + (missionCnt > 1 ? 's' : '') + '</span>';
    if (msgCnt)     statHtml += '<span class="nc-stat nc-stat--cyan"><i class="fas fa-comments"></i> ' + msgCnt + ' message' + (msgCnt > 1 ? 's' : '') + '</span>';

    // Body
    var bodyHtml;
    if (_tab === 'archived') {
      bodyHtml = '<div class="nc-empty"><i class="fas fa-box-archive"></i><div>Les notifications archivées ne sont plus affichées</div></div>';
    } else if (!notifs.length) {
      var emptyMsg = _search.trim()
        ? 'Aucun résultat pour « ' + MX.esc(_search) + ' »'
        : _tab === 'fav'    ? 'Aucun favori'
        : _tab === 'unread' ? 'Tout est lu ✓'
        : 'Aucune notification';
      bodyHtml = '<div class="nc-empty"><i class="fas fa-bell-slash"></i><div>' + emptyMsg + '</div></div>';
    } else {
      bodyHtml = _renderGroups(notifs);
    }

    mc.innerHTML = '<div class="nc-page">'
      + '<div class="nc-header">'
      + '<div class="nc-header-top">'
      + '<h1 class="nc-title"><i class="fas fa-bell"></i> Notifications'
      + (totalUnread ? '<span class="nc-title-badge">' + totalUnread + '</span>' : '')
      + '</h1>'
      + '<div class="nc-header-right">'
      + (statHtml ? '<div class="nc-stats-bar">' + statHtml + '</div>' : '')
      + (totalUnread
        ? '<button class="nc-action-btn" onclick="MX.Pages.Notifications._markAllRead()">'
          + '<i class="fas fa-check-double"></i> Tout lire</button>'
        : '')
      + '</div>'
      + '</div>'
      + '<div class="nc-search-wrap">'
      + '<i class="fas fa-search nc-search-ico"></i>'
      + '<input class="nc-search" type="search" placeholder="Rechercher…" '
      + 'value="' + MX.esc(_search) + '" oninput="MX.Pages.Notifications._onSearch(this.value)">'
      + (_search ? '<button class="nc-search-clr" onclick="MX.Pages.Notifications._onSearch(\'\')">'
        + '<i class="fas fa-times"></i></button>' : '')
      + '</div>'
      + '</div>'
      + '<div class="nc-tabs">' + tabsHtml + '</div>'
      + (typeHtml ? '<div class="nc-pills">' + typeHtml + '</div>' : '')
      + '<div class="nc-list">' + bodyHtml + '</div>'
      + '</div>';
  }

  function _setTab(t) { _tab = t; render(); }
  function _setFilter(f) { _filter = f; render(); }

  var _searchTimer = null;
  function _onSearch(val) {
    _search = val;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(render, 180);
  }

  function _toggleFav(id) {
    _loadFavs();
    if (_favIds.has(id)) _favIds.delete(id);
    else _favIds.add(id);
    _saveFavs();
    render();
  }

  function _markRead(id) {
    MX.DB.markNotificationRead(id).catch(function () {});
    var n = (MX.state.notifications || []).find(function (x) { return x.id === id; });
    if (n) { n.read = true; MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []); }
    render();
  }

  function _markAllRead() {
    MX.Notifs && MX.Notifs.markAllRead();
    render();
  }

  function _archive(id) {
    MX.DB.archiveNotification(id).catch(function () {});
    MX.state.notifications = (MX.state.notifications || []).filter(function (n) { return n.id !== id; });
    MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []);
    _favIds.delete(id); _saveFavs();
    render();
  }

  function _delete(id) {
    MX.showModal(
      'Supprimer la notification ?',
      'Cette action est irréversible.',
      [
        {
          label: 'Supprimer', cls: 'danger', fn: function () {
            MX.DB.deleteNotification(id).catch(function () {});
            MX.state.notifications = (MX.state.notifications || []).filter(function (n) { return n.id !== id; });
            MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []);
            _favIds.delete(id); _saveFavs();
            render();
          }
        },
        { label: 'Annuler', cls: 'cancel' },
      ]
    );
  }

  function _actionView(id) {
    var n = (MX.state.notifications || []).find(function (x) { return x.id === id; });
    if (!n) return;
    _markRead(id);
    if (n.actionUrl) { window.location.hash = n.actionUrl; return; }
    var page = PAGE_MAP[n.type];
    if (page && MX.showPage) MX.showPage(page);
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Notifications = {
    render, _setTab, _setFilter, _onSearch,
    _toggleFav, _markRead, _markAllRead, _archive, _delete, _actionView,
  };
})();
