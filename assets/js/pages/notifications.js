(function () {
  'use strict';

  let _filter = 'all';

  const TYPES = [
    { id: 'all',          icon: '🔔', l: 'Tout' },
    { id: 'message',      icon: '📩', l: 'Messages' },
    { id: 'intervention', icon: '🔧', l: 'Interventions' },
    { id: 'stock',        icon: '📦', l: 'Stock' },
    { id: 'badge',        icon: '🏆', l: 'Badges' },
    { id: 'update',       icon: '🚀', l: 'Mises à jour' },
    { id: 'system',       icon: '⚙️', l: 'Système' },
  ];

  function render() {
    const mc = document.getElementById('main-content');
    if (!mc) return;

    const all = MX.state.notifications || [];
    const notifs = _filter === 'all' ? all : all.filter(n => n.type === _filter);
    const totalUnread = all.filter(n => !n.read).length;

    mc.innerHTML = `<div class="notif-page">
      <div class="notif-page-header">
        <h1 class="notif-page-title">
          <i class="fas fa-bell"></i>
          Notifications
          ${totalUnread ? `<span class="notif-page-badge">${totalUnread}</span>` : ''}
        </h1>
        <div class="notif-page-actions">
          ${totalUnread ? `<button class="notif-action-btn" onclick="MX.Pages.Notifications._markAllRead()">
            <i class="fas fa-check-double"></i> Tout marquer lu
          </button>` : ''}
        </div>
      </div>

      <div class="notif-filters">
        ${TYPES.map(t => {
          const cnt = t.id === 'all'
            ? all.filter(n => !n.read).length
            : all.filter(n => n.type === t.id && !n.read).length;
          return `<button class="notif-filter-btn${_filter === t.id ? ' active' : ''}"
            onclick="MX.Pages.Notifications._setFilter('${t.id}')">
            ${t.icon} ${t.l}${cnt ? `<span class="notif-filter-count">${cnt}</span>` : ''}
          </button>`;
        }).join('')}
      </div>

      <div class="notif-full-list">
        ${notifs.length
          ? notifs.map(_renderItem).join('')
          : `<div class="notif-page-empty">
              <i class="fas fa-bell-slash"></i>
              <div>Aucune notification${_filter !== 'all' ? ' dans cette catégorie' : ''}</div>
             </div>`
        }
      </div>
    </div>`;
  }

  function _catColor(type) {
    return MX.Notifs ? MX.Notifs._catColor(type) : 'var(--cyan)';
  }

  function _catIcon(type) {
    return MX.Notifs ? MX.Notifs._catIcon(type) : '🔔';
  }

  function _fmtDate(ts) {
    return MX.Notifs ? MX.Notifs._fmtDate(ts) : '';
  }

  function _renderItem(n) {
    const color = _catColor(n.type);
    const icon  = n.icon || _catIcon(n.type);
    const time  = _fmtDate(n.createdAt);
    return `<div class="notif-full-item${n.read ? '' : ' notif-full-item--unread'}" data-id="${MX.esc(n.id)}">
      <div class="notif-full-item-left">
        <div class="notif-full-icon" style="color:${color};background:${color}22">${icon}</div>
        ${!n.read ? '<div class="notif-unread-dot"></div>' : ''}
      </div>
      <div class="notif-full-body">
        <div class="notif-full-title">${MX.esc(n.title)}</div>
        ${n.description ? `<div class="notif-full-desc">${MX.esc(n.description)}</div>` : ''}
        <div class="notif-full-meta">
          <span class="notif-cat-tag" style="color:${color}">${_catIcon(n.type)} ${n.type}</span>
          ${n.author ? `<span class="notif-meta-sep">·</span><span>${MX.esc(n.author)}</span>` : ''}
          ${time ? `<span class="notif-meta-sep">·</span><span>${time}</span>` : ''}
        </div>
      </div>
      <div class="notif-full-actions">
        ${!n.read ? `<button class="notif-act-icon" onclick="MX.Pages.Notifications._markRead('${MX.esc(n.id)}')" title="Marquer comme lu">
          <i class="fas fa-check"></i>
        </button>` : ''}
        <button class="notif-act-icon notif-act-archive" onclick="MX.Pages.Notifications._archive('${MX.esc(n.id)}')" title="Archiver">
          <i class="fas fa-box-archive"></i>
        </button>
        <button class="notif-act-icon notif-act-delete" onclick="MX.Pages.Notifications._delete('${MX.esc(n.id)}')" title="Supprimer">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
  }

  function _setFilter(type) {
    _filter = type;
    render();
  }

  function _markRead(id) {
    MX.DB.markNotificationRead(id).catch(() => {});
    const n = (MX.state.notifications || []).find(x => x.id === id);
    if (n) { n.read = true; MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []); }
    render();
  }

  function _markAllRead() {
    MX.Notifs && MX.Notifs.markAllRead();
    render();
  }

  function _archive(id) {
    MX.DB.archiveNotification(id).catch(() => {});
    MX.state.notifications = (MX.state.notifications || []).filter(n => n.id !== id);
    MX.Notifs && MX.Notifs.updateBell(MX.state.notifications || []);
    render();
  }

  function _delete(id) {
    MX.showModal(
      'Supprimer la notification ?',
      'Cette action est irréversible.',
      [
        {
          label: 'Supprimer', cls: 'danger', fn: () => {
            MX.DB.deleteNotification(id).catch(() => {});
            MX.state.notifications = (MX.state.notifications || []).filter(n => n.id !== id);
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
