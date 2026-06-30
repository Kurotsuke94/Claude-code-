(function () {
  'use strict';

  let _filter = 'all';

  const TYPES = [
    { id: 'all',          icon: '🔔', l: 'Tout' },
    { id: 'message',      icon: '📩', l: 'Messages' },
    { id: 'mission',      icon: '🔧', l: 'Missions' },
    { id: 'checklist',    icon: '✅', l: 'Checklists' },
    { id: 'counter',      icon: '📊', l: 'Compteurs' },
    { id: 'intervention', icon: '🛠', l: 'Interventions' },
    { id: 'absence',      icon: '🗓', l: 'Absences' },
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

  function _lvlMeta(n) {
    if (n.level && LEVEL_META[n.level]) return LEVEL_META[n.level];
    return null;
  }

  function render() {
    const mc = document.getElementById('main-content');
    if (!mc) return;

    const all = MX.state.notifications || [];
    const notifs = _filter === 'all' ? all : all.filter(function(n) { return n.type === _filter; });
    const totalUnread = all.filter(function(n) { return !n.read; }).length;

    var filterHtml = TYPES.map(function(t) {
      var cnt = t.id === 'all'
        ? all.filter(function(n) { return !n.read; }).length
        : all.filter(function(n) { return n.type === t.id && !n.read; }).length;
      return '<button class="notif-filter-btn' + (_filter === t.id ? ' active' : '') + '"'
        + ' onclick="MX.Pages.Notifications._setFilter(\'' + t.id + '\')">'
        + t.icon + ' ' + t.l
        + (cnt ? '<span class="notif-filter-count">' + cnt + '</span>' : '')
        + '</button>';
    }).join('');

    var bodyHtml;
    if (!notifs.length) {
      bodyHtml = '<div class="notif-page-empty">'
        + '<i class="fas fa-bell-slash"></i>'
        + '<div>Aucune notification' + (_filter !== 'all' ? ' dans cette catégorie' : '') + '</div>'
        + '</div>';
    } else {
      bodyHtml = _renderGroups(_groupByDate(notifs));
    }

    mc.innerHTML = '<div class="notif-page">'
      + '<div class="notif-page-header">'
      + '<h1 class="notif-page-title"><i class="fas fa-bell"></i> Notifications'
      + (totalUnread ? '<span class="notif-page-badge">' + totalUnread + '</span>' : '')
      + '</h1>'
      + '<div class="notif-page-actions">'
      + (totalUnread ? '<button class="notif-action-btn" onclick="MX.Pages.Notifications._markAllRead()">'
        + '<i class="fas fa-check-double"></i> Tout marquer lu</button>' : '')
      + '</div>'
      + '</div>'
      + '<div class="notif-filters">' + filterHtml + '</div>'
      + '<div class="notif-full-list">' + bodyHtml + '</div>'
      + '</div>';
  }

  function _tsMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    return new Date(ts).getTime();
  }

  function _groupByDate(notifs) {
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var yestStart  = todayStart - 86400000;

    var groups = { today: [], yesterday: [], older: [] };
    notifs.forEach(function(n) {
      var ms = _tsMs(n.createdAt);
      if (ms >= todayStart) groups.today.push(n);
      else if (ms >= yestStart) groups.yesterday.push(n);
      else groups.older.push(n);
    });
    return groups;
  }

  function _renderGroups(g) {
    var html = '';
    if (g.today.length) {
      html += '<div class="notif-date-sep">Aujourd\'hui</div>';
      html += g.today.map(_renderItem).join('');
    }
    if (g.yesterday.length) {
      html += '<div class="notif-date-sep">Hier</div>';
      html += g.yesterday.map(_renderItem).join('');
    }
    if (g.older.length) {
      html += '<div class="notif-date-sep">Plus ancien</div>';
      html += g.older.map(_renderItem).join('');
    }
    return html || '';
  }

  function _catColor(type) {
    return MX.Notifs ? MX.Notifs._catColor(type) : 'var(--cyan)';
  }

  function _catIcon(type) {
    var icons = {
      mission:'🔧', checklist:'✅', counter:'📊', intervention:'🛠',
      absence:'🗓', planning:'📅', alert:'🚨',
      message:'📩', stock:'📦', badge:'🏆', update:'🚀', system:'⚙️',
    };
    return icons[type] || (MX.Notifs ? MX.Notifs._catIcon(type) : '🔔');
  }

  function _fmtDate(ts) {
    return MX.Notifs ? MX.Notifs._fmtDate(ts) : '';
  }

  function _renderItem(n) {
    var color = _catColor(n.type);
    var icon  = n.icon || _catIcon(n.type);
    var time  = _fmtDate(n.createdAt);
    var lm    = _lvlMeta(n);

    var levelTag = lm
      ? '<span class="nf-level-tag" style="background:' + lm.color + '22;color:' + lm.color + '">' + lm.lbl + '</span>'
      : '';

    return '<div class="notif-full-item' + (n.read ? '' : ' notif-full-item--unread') + '" data-id="' + MX.esc(n.id) + '">'
      + '<div class="notif-full-item-left">'
      + '<div class="notif-full-icon" style="color:' + color + ';background:' + color + '22">' + icon + '</div>'
      + (!n.read ? '<div class="notif-unread-dot"></div>' : '')
      + '</div>'
      + '<div class="notif-full-body">'
      + '<div class="notif-full-title">' + levelTag + MX.esc(n.title) + '</div>'
      + (n.description ? '<div class="notif-full-desc">' + MX.esc(n.description) + '</div>' : '')
      + '<div class="notif-full-meta">'
      + '<span class="notif-cat-tag" style="color:' + color + '">' + _catIcon(n.type) + ' ' + n.type + '</span>'
      + (n.author ? '<span class="notif-meta-sep">·</span><span>' + MX.esc(n.author) + '</span>' : '')
      + (time ? '<span class="notif-meta-sep">·</span><span>' + time + '</span>' : '')
      + '</div>'
      + '</div>'
      + '<div class="notif-full-actions">'
      + (!n.read
        ? '<button class="notif-act-icon" onclick="MX.Pages.Notifications._markRead(\'' + MX.esc(n.id) + '\')" title="Marquer comme lu">'
          + '<i class="fas fa-check"></i></button>'
        : '')
      + '<button class="notif-act-icon notif-act-archive" onclick="MX.Pages.Notifications._archive(\'' + MX.esc(n.id) + '\')" title="Archiver">'
      + '<i class="fas fa-box-archive"></i></button>'
      + '<button class="notif-act-icon notif-act-delete" onclick="MX.Pages.Notifications._delete(\'' + MX.esc(n.id) + '\')" title="Supprimer">'
      + '<i class="fas fa-trash"></i></button>'
      + '</div>'
      + '</div>';
  }

  function _setFilter(type) {
    _filter = type;
    render();
  }

  function _markRead(id) {
    MX.DB.markNotificationRead(id).catch(function() {});
    var n = (MX.state.notifications || []).find(function(x) { return x.id === id; });
    if (n) { n.read = true; MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []); }
    render();
  }

  function _markAllRead() {
    MX.Notifs && MX.Notifs.markAllRead();
    render();
  }

  function _archive(id) {
    MX.DB.archiveNotification(id).catch(function() {});
    MX.state.notifications = (MX.state.notifications || []).filter(function(n) { return n.id !== id; });
    MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []);
    render();
  }

  function _delete(id) {
    MX.showModal(
      'Supprimer la notification ?',
      'Cette action est irréversible.',
      [
        {
          label: 'Supprimer', cls: 'danger', fn: function() {
            MX.DB.deleteNotification(id).catch(function() {});
            MX.state.notifications = (MX.state.notifications || []).filter(function(n) { return n.id !== id; });
            MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []);
            render();
          }
        },
        { label: 'Annuler', cls: 'cancel' },
      ]
    );
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Notifications = { render, _setFilter, _markRead, _markAllRead, _archive, _delete };
})();
