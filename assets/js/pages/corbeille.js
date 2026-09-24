(function () {
  'use strict';

  var _tab        = 'corbeille';
  var _filterType = 'all';
  var _corbeille  = [];
  var _archives   = [];
  var _loaded     = false;
  var _selected   = {}; // clé `${col}|${id}` -> true — sélection multiple, jamais persistée

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

  // ── SÉLECTION MULTIPLE ───────────────────────────────────────────────────
  function _selKey(col, id) { return col + '|' + id; }

  // Retire du set toute clé qui ne correspond plus à un élément actuellement
  // affiché (onglet/filtre courants) — jamais d'ID sélectionné fantôme après
  // changement d'onglet, de filtre, ou une action qui fait disparaître des
  // éléments de la vue (restauration/archivage/suppression, y compris par
  // un autre poste via les listeners temps réel).
  function _pruneSelection(items) {
    var keep = {};
    items.forEach(function (it) {
      var k = _selKey(it._col, it.id);
      if (_selected[k]) keep[k] = true;
    });
    _selected = keep;
  }

  function _selectedCount() { return Object.keys(_selected).length; }

  function _selectedItems(items) {
    return items.filter(function (it) { return !!_selected[_selKey(it._col, it.id)]; });
  }

  function _cnt(n, singular, plural) { return n + ' ' + (n > 1 ? plural : singular); }

  function _render() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    var isAdmin   = MX.Auth.isAdmin();
    var items     = _sortedItems();
    var dateField = _tab === 'corbeille' ? 'trashedAt'  : 'archivedAt';
    var byField   = _tab === 'corbeille' ? 'trashedBy'  : 'archivedBy';

    _pruneSelection(items);
    var selCount = _selectedCount();

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
      // ── Barre d'actions en masse — jamais affichée sans élément (voir
      // ci-dessus, ce bloc n'est atteint que si items.length > 0). ──
      var bulkLabel = selCount > 0 ? _cnt(selCount, 'sélectionné', 'sélectionnés') : 'Tout sélectionner';
      h += '<div class="corb-bulkbar' + (selCount > 0 ? ' corb-bulkbar--active' : '') + '">' +
           '<label class="corb-check corb-check--all" title="Tout sélectionner / désélectionner">' +
           '<input type="checkbox" id="corb-select-all" onclick="MX._corbToggleSelAll()">' +
           '<span class="corb-check-box"></span>' +
           '<span class="corb-bulk-lbl">' + bulkLabel + '</span>' +
           '</label>';
      if (selCount > 0) {
        var bulkActions = '<button class="corb-btn corb-btn--restore" onclick="MX._corbBulkRestore()">' +
                           '<i class="fas fa-rotate-left"></i> Restaurer</button>';
        if (_tab === 'corbeille') {
          bulkActions += '<button class="corb-btn corb-btn--archive" onclick="MX._corbBulkArchive()">' +
                         '<i class="fas fa-box-archive"></i> Archiver</button>';
        }
        if (isAdmin) {
          bulkActions += '<button class="corb-btn corb-btn--purge corb-btn--purge-wide" onclick="MX._corbBulkPurge()">' +
                         '<i class="fas fa-trash-can"></i> Supprimer</button>';
        }
        h += '<div class="corb-bulkbar-actions">' + bulkActions + '</div>';
      }
      h += '</div>';

      h += '<div class="corb-list">';
      items.forEach(function (item) {
        var name    = MX.esc(_nameOf(item));
        var type    = MX.esc(_typeOf(item));
        var date    = _dateOf(item, dateField);
        var by      = MX.esc(item[byField] || '—');
        var reason  = (_tab === 'corbeille' && item.trashReason) ? ('<span class="corb-reason">' + MX.esc(item.trashReason) + '</span>') : '';
        var isSel   = !!_selected[_selKey(item._col, item.id)];

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

        h += '<div class="corb-item' + (isSel ? ' corb-item--sel' : '') + '">' +
             '<label class="corb-check corb-check--item" title="Sélectionner">' +
             '<input type="checkbox"' + (isSel ? ' checked' : '') + ' onclick="event.stopPropagation();MX._corbToggleSel(\'' + item._col + '\',\'' + item.id + '\')">' +
             '<span class="corb-check-box"></span>' +
             '</label>' +
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

    // Case "Tout sélectionner" tri-état — indeterminate ne s'exprime qu'en
    // propriété DOM, jamais en attribut HTML.
    var selectAllEl = document.getElementById('corb-select-all');
    if (selectAllEl) {
      var total = items.length;
      selectAllEl.checked = total > 0 && selCount === total;
      selectAllEl.indeterminate = selCount > 0 && selCount < total;
    }
  }

  // ── Global action handlers ──
  window.MX._corbTab = function (tab) { _tab = tab; _filterType = 'all'; _selected = {}; _render(); };
  window.MX._corbFilter = function (type) { _filterType = type; _selected = {}; _render(); };

  // ── Sélection multiple ──
  window.MX._corbToggleSel = function (col, id) {
    var k = _selKey(col, id);
    if (_selected[k]) delete _selected[k]; else _selected[k] = true;
    _render();
  };
  window.MX._corbToggleSelAll = function () {
    var items = _sortedItems();
    var allSelected = items.length > 0 && items.every(function (it) { return !!_selected[_selKey(it._col, it.id)]; });
    if (allSelected) {
      _selected = {};
    } else {
      items.forEach(function (it) { _selected[_selKey(it._col, it.id)] = true; });
    }
    _render();
  };

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

  // ── Actions en masse ─────────────────────────────────────────────────────
  // Réutilisent exactement MX.Trash (restoreMany/archiveMany/purgeMany, voir
  // assets/js/trash.js) — mêmes champs, mêmes contrôles d'accès que les
  // actions individuelles ci-dessus, jamais de logique parallèle.
  function _bulkRefs() {
    return _selectedItems(_sortedItems()).map(function (it) { return { col: it._col, id: it.id }; });
  }

  window.MX._corbBulkRestore = function () {
    var refs = _bulkRefs();
    if (!refs.length) return;
    MX.showModal({
      title: 'Restaurer ' + _cnt(refs.length, 'élément', 'éléments') + ' ?',
      sub: '',
      actions: [
        { label: 'Restaurer', cls: 'confirm', fn: async function () {
          try {
            var res = await MX.Trash.restoreMany(refs);
            _selected = {};
            if (res.failed.length) {
              MX.toast(res.succeeded.length + ' restauré(s), ' + res.failed.length + ' échec(s)', true);
            } else {
              MX.toast(_cnt(res.succeeded.length, 'élément restauré', 'éléments restaurés') + '.');
            }
            _render();
          } catch (e) { MX.toast('Erreur restauration : ' + (e.message || ''), true); }
        } },
        { label: 'Annuler', cls: 'cancel' },
      ],
    });
  };

  window.MX._corbBulkArchive = function () {
    var refs = _bulkRefs();
    if (!refs.length) return;
    MX.showModal({
      title: 'Archiver ' + _cnt(refs.length, 'élément', 'éléments') + ' ?',
      sub: '',
      actions: [
        { label: 'Archiver', cls: 'confirm', fn: async function () {
          try {
            var res = await MX.Trash.archiveMany(refs);
            _selected = {};
            if (res.failed.length) {
              MX.toast(res.succeeded.length + ' archivé(s), ' + res.failed.length + ' échec(s)', true);
            } else {
              MX.toast(_cnt(res.succeeded.length, 'élément archivé', 'éléments archivés') + '.');
            }
            _render();
          } catch (e) { MX.toast('Erreur archivage : ' + (e.message || ''), true); }
        } },
        { label: 'Annuler', cls: 'cancel' },
      ],
    });
  };

  window.MX._corbBulkPurge = function () {
    if (!MX.Auth.isAdmin()) return; // filet de sécurité — le bouton n'est déjà rendu que pour l'admin
    var refs = _bulkRefs();
    if (!refs.length) return;
    MX.showModal({
      title: 'Supprimer définitivement ' + _cnt(refs.length, 'élément', 'éléments') + ' ?',
      sub: 'Cette action est irréversible.',
      actions: [
        { label: 'Supprimer définitivement', cls: 'danger', fn: async function () {
          try {
            var res = await MX.Trash.purgeMany(refs);
            _selected = {};
            if (res.failed.length) {
              MX.toast(res.succeeded.length + ' supprimé(s), ' + res.failed.length + ' échec(s)', true);
            } else {
              MX.toast(_cnt(res.succeeded.length, 'élément supprimé définitivement', 'éléments supprimés définitivement') + '.');
            }
            _render();
          } catch (e) { MX.toast('Erreur suppression : ' + (e.message || ''), true); }
        } },
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
