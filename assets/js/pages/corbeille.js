(function () {
  'use strict';

  var _tab        = 'corbeille';
  var _filterType = 'all';
  var _corbeille  = [];
  var _archives   = [];
  var _loaded     = false;

  var COLS = [
    { col: 'missions',          label: 'Mission',          icon: 'fa-list-check',          color: '#22c55e' },
    { col: 'interventions',     label: 'Intervention',     icon: 'fa-wrench',              color: '#3b82f6' },
    { col: 'pmp_interventions', label: 'Intervention PMP', icon: 'fa-screwdriver-wrench',  color: '#a855f7' },
    { col: 'pmp_plans',         label: 'Plan PMP',         icon: 'fa-clipboard-list',      color: '#f97316' },
  ];

  function _nameOf(item) {
    return item._trashName || item.title || item.name || '—';
  }

  function _typeOf(item) {
    return item._trashType || item._colLabel || '—';
  }

  function _dateOf(item, field) {
    var ts = item[field];
    if (!ts) return '—';
    try {
      var d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
             ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '—'; }
  }

  function _load() {
    if (_loaded) return;
    _loaded = true;

    COLS.forEach(function (c) {
      db.collection(c.col).where('inTrash', '==', true)
        .onSnapshot(function (snap) {
          _corbeille = _corbeille.filter(function (x) { return x._col !== c.col; });
          snap.docs.forEach(function (d) {
            _corbeille.push(Object.assign({ id: d.id, _col: c.col, _colLabel: c.label, _colIcon: c.icon, _colColor: c.color }, d.data()));
          });
          if (MX.state.currentPage === 'corbeille') _render();
        }, function (err) { console.warn('[Corbeille] ' + c.col + ' trash:', err.message); });

      db.collection(c.col).where('archived', '==', true)
        .onSnapshot(function (snap) {
          _archives = _archives.filter(function (x) { return x._col !== c.col; });
          snap.docs.forEach(function (d) {
            _archives.push(Object.assign({ id: d.id, _col: c.col, _colLabel: c.label, _colIcon: c.icon, _colColor: c.color }, d.data()));
          });
          if (MX.state.currentPage === 'corbeille') _render();
        }, function (err) { console.warn('[Corbeille] ' + c.col + ' archives:', err.message); });
    });
  }

  function _sortedItems() {
    var list = (_tab === 'corbeille' ? _corbeille : _archives).slice();
    if (_filterType !== 'all') {
      list = list.filter(function (x) { return x._col === _filterType; });
    }
    var dateField = _tab === 'corbeille' ? 'trashedAt' : 'archivedAt';
    list.sort(function (a, b) {
      var ta = (a[dateField] && a[dateField].seconds) || 0;
      var tb = (b[dateField] && b[dateField].seconds) || 0;
      return tb - ta;
    });
    return list;
  }

  function _render() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    var isAdmin   = MX.Auth.isAdmin();
    var items     = _sortedItems();
    var dateField = _tab === 'corbeille' ? 'trashedAt'  : 'archivedAt';
    var byField   = _tab === 'corbeille' ? 'trashedBy'  : 'archivedBy';

    // ── Header ──
    var h = '<div class="corb-page">';
    h += '<div class="corb-header">' +
         '<div class="corb-title"><i class="fas fa-trash-can"></i> Corbeille &amp; Archives</div>' +
         '<p class="corb-subtitle">Restaurer, archiver ou supprimer définitivement les éléments</p>' +
         '</div>';

    // ── Tabs ──
    h += '<div class="corb-tabs">' +
         '<button class="corb-tab' + (_tab === 'corbeille' ? ' active' : '') + '" onclick="MX._corbTab(\'corbeille\')">' +
         '<i class="fas fa-trash"></i> Corbeille <span class="corb-cnt">' + _corbeille.length + '</span></button>' +
         '<button class="corb-tab' + (_tab === 'archives' ? ' active' : '') + '" onclick="MX._corbTab(\'archives\')">' +
         '<i class="fas fa-box-archive"></i> Archives <span class="corb-cnt">' + _archives.length + '</span></button>' +
         '</div>';

    // ── Filters ──
    h += '<div class="corb-filters">' +
         '<button class="corb-flt' + (_filterType === 'all' ? ' active' : '') + '" onclick="MX._corbFilter(\'all\')">Tout</button>';
    COLS.forEach(function (c) {
      h += '<button class="corb-flt' + (_filterType === c.col ? ' active' : '') + '" onclick="MX._corbFilter(\'' + c.col + '\')">' + c.label + '</button>';
    });
    h += '</div>';

    // ── List ──
    if (!items.length) {
      h += '<div class="corb-empty">' +
           '<i class="fas ' + (_tab === 'corbeille' ? 'fa-trash' : 'fa-box-archive') + '"></i>' +
           '<p>' + (_tab === 'corbeille' ? 'La corbeille est vide' : 'Aucun élément archivé') + '</p>' +
           '</div>';
    } else {
      h += '<div class="corb-list">';
      items.forEach(function (item) {
        var name   = MX.esc(_nameOf(item));
        var type   = MX.esc(_typeOf(item));
        var date   = _dateOf(item, dateField);
        var by     = MX.esc(item[byField] || '—');
        var reason = (_tab === 'corbeille' && item.trashReason) ? ('<span class="corb-reason">' + MX.esc(item.trashReason) + '</span>') : '';

        var actRestore = '<button class="corb-btn corb-btn--restore" onclick="MX._corbRestore(\'' + item._col + '\',\'' + item.id + '\')">' +
                         '<i class="fas fa-rotate-left"></i> Restaurer</button>';
        var actArchive = (_tab === 'corbeille')
          ? '<button class="corb-btn corb-btn--archive" onclick="MX._corbArchive(\'' + item._col + '\',\'' + item.id + '\')">' +
            '<i class="fas fa-box-archive"></i> Archiver</button>'
          : '';
        var actPurge = isAdmin
          ? '<button class="corb-btn corb-btn--purge" onclick="MX._corbPurge(\'' + item._col + '\',\'' + item.id + '\',\'' + name.replace(/'/g, "\\'") + '\')">' +
            '<i class="fas fa-trash-can"></i></button>'
          : '';

        h += '<div class="corb-item">' +
             '<div class="corb-item-ico" style="background:' + item._colColor + '22;color:' + item._colColor + '">' +
             '<i class="fas ' + item._colIcon + '"></i></div>' +
             '<div class="corb-item-body">' +
             '<div class="corb-item-name">' + name + '</div>' +
             '<div class="corb-item-meta">' +
             '<span class="corb-badge" style="background:' + item._colColor + '22;color:' + item._colColor + '">' + type + '</span>' +
             '<span class="corb-meta-info"><i class="fas fa-clock"></i> ' + date + '</span>' +
             '<span class="corb-meta-info"><i class="fas fa-user"></i> ' + by + '</span>' +
             reason +
             '</div>' +
             '</div>' +
             '<div class="corb-item-actions">' + actRestore + actArchive + actPurge + '</div>' +
             '</div>';
      });
      h += '</div>';
    }

    h += '</div>'; // .corb-page
    mc.innerHTML = h;
  }

  // ── Global action handlers ──
  window.MX._corbTab = function (tab) { _tab = tab; _filterType = 'all'; _render(); };
  window.MX._corbFilter = function (type) { _filterType = type; _render(); };

  window.MX._corbRestore = async function (col, id) {
    try {
      await MX.Trash.restore(col, id);
      MX.toast('Élément restauré ✓');
    } catch (e) { MX.toast('Erreur restauration : ' + (e.message || ''), true); }
  };

  window.MX._corbArchive = async function (col, id) {
    try {
      await MX.Trash.archive(col, id);
      MX.toast('Élément archivé ✓');
    } catch (e) { MX.toast('Erreur archivage : ' + (e.message || ''), true); }
  };

  window.MX._corbPurge = function (col, id, name) {
    MX.showModal({
      title: 'Suppression définitive',
      sub: 'Cette action est irréversible.',
      body: '<p style="color:var(--text2);font-size:13px;margin:0">Supprimer définitivement <strong>' + name + '</strong>&nbsp;?</p>',
      actions: [
        { label: 'Supprimer définitivement', cls: 'danger', fn: async function () {
          try {
            var ok = await MX.Trash.purge(col, id);
            if (ok !== false) MX.toast('Supprimé définitivement');
          } catch (e) { MX.toast('Erreur : ' + (e.message || ''), true); }
        }},
        { label: 'Annuler', cls: 'cancel' },
      ],
    });
  };

  function render() {
    if (!MX.Auth.canSeeAll()) {
      var mc = document.getElementById('main-content');
      if (mc) mc.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;color:var(--text3);padding:40px">' +
        '<i class="fas fa-lock" style="font-size:48px;opacity:0.3"></i>' +
        '<div style="font-size:18px;font-weight:700;color:var(--text2)">Accès réservé</div>' +
        '<div style="font-size:13px;color:var(--text3)">Cette page est accessible aux responsables et administrateurs uniquement.</div>' +
        '</div>';
      return;
    }
    _load();
    _render();
  }

  window.MX.Pages.Corbeille = { render: render };
})();
