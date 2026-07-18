(function () {
  'use strict';

  // ── STATE ─────────────────────────────────────────────────────────────────
  var _lists      = [];
  var _listsUnsub = null;
  var _loaded     = false;

  var _curListId  = null;
  var _curList    = null;
  var _listUnsub  = null;

  var _viewMode   = 'batiment';
  var _search     = '';
  var _statusFilter = { fait: true, ocp: true, pas_fait: true, aucun: true };
  var _expanded   = {};
  var _selNode    = { type: 'root' };

  var _saveTimer  = null;
  var _filterOpen = false;

  // Modal state
  var _showCreate     = false;
  var _createTitle    = '';
  var _showPaste      = false;
  var _pasteTarget    = null;
  var _pasteText      = '';
  var _showDup        = false;
  var _dupSrcId       = null;
  var _dupTitle       = '';
  var _dupKeepBlds    = true;
  var _dupKeepFloors  = true;
  var _dupKeepRooms   = true;
  var _dupResetStatus = true;

  // ── DB ────────────────────────────────────────────────────────────────────
  var DB = { lists: function () { return db.collection('mx_room_lists'); } };
  var FV = firebase.firestore.FieldValue;

  // ── CONSTANTS ─────────────────────────────────────────────────────────────
  var STATUSES = [
    { key: 'aucun',    label: 'Aucun statut', color: '#64748B', icon: 'fa-circle' },
    { key: 'fait',     label: 'Fait',         color: '#10B981', icon: 'fa-circle-check' },
    { key: 'ocp',      label: 'OCP',          color: '#F59E0B', icon: 'fa-triangle-exclamation' },
    { key: 'pas_fait', label: 'Pas fait',     color: '#EF4444', icon: 'fa-circle-xmark' },
  ];
  var STATUS_MAP = {};
  STATUSES.forEach(function (s) { STATUS_MAP[s.key] = s; });
  var STATUS_CYCLE = { aucun: 'fait', fait: 'ocp', ocp: 'pas_fait', pas_fait: 'aucun' };

  // ── UTILITIES ─────────────────────────────────────────────────────────────
  function _uid() {
    return 'rl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function _e(s) {
    return MX.esc ? MX.esc(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _notify(msg, isErr) {
    if (MX && typeof MX.toast === 'function') MX.toast(msg, !!isErr);
  }

  function _author() {
    try {
      var cu = MX.Auth && MX.Auth.currentUser && MX.Auth.currentUser();
      return (cu && cu.name) || (firebase.auth().currentUser || {}).email || 'Utilisateur';
    } catch (e) { return 'Utilisateur'; }
  }

  function _calcStats(buildings) {
    var s = { total: 0, fait: 0, ocp: 0, pas_fait: 0, aucun: 0 };
    (buildings || []).forEach(function (b) {
      (b.floors || []).forEach(function (f) {
        (f.rooms || []).forEach(function (r) {
          s.total++;
          var k = r.status || 'aucun';
          if (s[k] !== undefined) s[k]++; else s.aucun++;
        });
      });
    });
    s.pct = s.total ? Math.round(s.fait / s.total * 100) : 0;
    return s;
  }

  function _calcFlrStats(flr) {
    var s = { total: 0, fait: 0, ocp: 0, pas_fait: 0, aucun: 0 };
    (flr.rooms || []).forEach(function (r) {
      s.total++;
      var k = r.status || 'aucun';
      if (s[k] !== undefined) s[k]++; else s.aucun++;
    });
    s.pct = s.total ? Math.round(s.fait / s.total * 100) : 0;
    return s;
  }

  function _pct(n, total) { return total ? Math.round(n / total * 100) : 0; }

  function _findBld(bId) {
    return (_curList && _curList.buildings || []).find(function (b) { return b.id === bId; });
  }
  function _findFlr(bId, fId) {
    var b = _findBld(bId);
    return b ? (b.floors || []).find(function (f) { return f.id === fId; }) : null;
  }
  function _findRoom(bId, fId, rId) {
    var f = _findFlr(bId, fId);
    return f ? (f.rooms || []).find(function (r) { return r.id === rId; }) : null;
  }

  // ── FIRESTORE ─────────────────────────────────────────────────────────────
  function _loadLists() {
    if (_loaded) return;
    _loaded = true;
    _listsUnsub = DB.lists().orderBy('updatedAt', 'desc').onSnapshot(function (snap) {
      _lists = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      _rerender();
    }, function (err) { console.error('[MXRL] lists error:', err); });
  }

  function _openList(id) {
    if (_listUnsub) { _listUnsub(); _listUnsub = null; }
    _curListId = id; _curList = null;
    _selNode = { type: 'root' }; _expanded = {};
    _listUnsub = DB.lists().doc(id).onSnapshot(function (doc) {
      if (!doc.exists) { _curList = null; _rerender(); return; }
      var isFirst = !_curList;
      _curList = Object.assign({ id: doc.id }, doc.data());
      if (isFirst) {
        var b0 = (_curList.buildings || [])[0];
        if (b0) _expanded[b0.id] = true;
      }
      _rerender();
    }, function (err) { console.error('[MXRL] list error:', err); });
    _rerender();
  }

  function _persist() {
    if (!_curListId || !_curList) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      _saveTimer = null;
      DB.lists().doc(_curListId).update({
        buildings: _curList.buildings || [],
        updatedAt: FV.serverTimestamp()
      }).catch(function (err) { console.error('[MXRL] persist error:', err); });
    }, 400);
  }

  function _createList(title) {
    DB.lists().add({
      title: (title || 'Nouvelle liste de chambres').trim(),
      status: 'active',
      createdAt: FV.serverTimestamp(),
      createdBy: _author(),
      updatedAt: FV.serverTimestamp(),
      buildings: []
    }).then(function (ref) {
      _showCreate = false; _createTitle = '';
      _openList(ref.id);
    }).catch(function (err) { console.error('[MXRL] create error:', err); _notify('Erreur création', true); });
  }

  function _deleteList(id) {
    var lst = _lists.find(function (l) { return l.id === id; });
    if (!lst) return;
    if (!confirm('Supprimer "' + (lst.title || 'cette liste') + '" ? Cette action est irréversible.')) return;
    DB.lists().doc(id).delete().then(function () {
      if (_curListId === id) { _curListId = null; _curList = null; }
      _notify('Liste supprimée');
    }).catch(function (err) { _notify('Erreur suppression', true); console.error(err); });
  }

  function _execDuplicate() {
    var src = _lists.find(function (l) { return l.id === _dupSrcId; });
    if (!src) return;
    var buildings = [];
    if (_dupKeepBlds) {
      buildings = (src.buildings || []).map(function (b) {
        var floors = _dupKeepFloors ? (b.floors || []).map(function (f) {
          var rooms = _dupKeepRooms ? (f.rooms || []).map(function (r) {
            return Object.assign({}, r, {
              id: _uid(),
              status: _dupResetStatus ? 'aucun' : (r.status || 'aucun'),
              comment: _dupResetStatus ? '' : (r.comment || ''),
              photos: _dupResetStatus ? 0 : (r.photos || 0)
            });
          }) : [];
          return Object.assign({}, f, { id: _uid(), rooms: rooms });
        }) : [];
        return Object.assign({}, b, { id: _uid(), floors: floors });
      });
    }
    DB.lists().add({
      title: (_dupTitle || (src.title + ' (copie)')).trim(),
      status: 'active', createdAt: FV.serverTimestamp(),
      createdBy: _author(), updatedAt: FV.serverTimestamp(), buildings: buildings
    }).then(function (ref) {
      _showDup = false; _dupSrcId = null; _dupTitle = '';
      _notify('Liste dupliquée');
      _openList(ref.id);
    }).catch(function (err) { _notify('Erreur duplication', true); console.error(err); });
  }

  // ── DATA MUTATIONS ────────────────────────────────────────────────────────
  function _addBuilding() {
    if (!_curList) return;
    var name = prompt('Nom du bâtiment :');
    if (!name || !name.trim()) return;
    if (!_curList.buildings) _curList.buildings = [];
    var bld = { id: _uid(), name: name.trim(), order: _curList.buildings.length, floors: [] };
    _curList.buildings.push(bld);
    _expanded[bld.id] = true;
    _persist(); _rerender();
  }

  function _addFloor(bId) {
    var b = _findBld(bId); if (!b) return;
    var name = prompt('Nom de l\'étage :');
    if (!name || !name.trim()) return;
    if (!b.floors) b.floors = [];
    var flr = { id: _uid(), name: name.trim(), order: b.floors.length, rooms: [] };
    b.floors.push(flr);
    _expanded[bId] = true;
    _selNode = { type: 'floor', bId: bId, fId: flr.id };
    _persist(); _rerender();
  }

  function _addRoom(bId, fId) {
    var f = _findFlr(bId, fId); if (!f) return;
    var num = prompt('Numéro ou nom de la chambre :');
    if (!num || !num.trim()) return;
    if (!f.rooms) f.rooms = [];
    f.rooms.push({ id: _uid(), number: num.trim(), name: '', status: 'aucun', comment: '', photos: 0 });
    _persist(); _rerender();
  }

  function _addRooms(bId, fId, text) {
    var f = _findFlr(bId, fId); if (!f) return;
    if (!f.rooms) f.rooms = [];
    var lines = text.split(/[\n,;]+/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) { _notify('Aucune chambre à importer', true); return; }
    lines.forEach(function (num) {
      f.rooms.push({ id: _uid(), number: num, name: '', status: 'aucun', comment: '', photos: 0 });
    });
    _notify(lines.length + ' chambre(s) ajoutée(s)');
    _persist(); _rerender();
  }

  function _deleteBuilding(bId) {
    var b = _findBld(bId); if (!b) return;
    var n = (b.floors || []).reduce(function (s, f) { return s + (f.rooms || []).length; }, 0);
    if (!confirm('Supprimer "' + b.name + '"' + (n ? ' et ses ' + n + ' chambre(s)' : '') + ' ?')) return;
    _curList.buildings = (_curList.buildings || []).filter(function (x) { return x.id !== bId; });
    if (_selNode.bId === bId) _selNode = { type: 'root' };
    delete _expanded[bId];
    _persist(); _rerender();
  }

  function _deleteFloor(bId, fId) {
    var b = _findBld(bId); var f = _findFlr(bId, fId);
    if (!b || !f) return;
    var n = (f.rooms || []).length;
    if (!confirm('Supprimer "' + f.name + '"' + (n ? ' et ses ' + n + ' chambre(s)' : '') + ' ?')) return;
    b.floors = (b.floors || []).filter(function (x) { return x.id !== fId; });
    if (_selNode.fId === fId) _selNode = { type: 'building', bId: bId };
    _persist(); _rerender();
  }

  function _deleteRoom(bId, fId, rId) {
    var f = _findFlr(bId, fId); if (!f) return;
    var r = (f.rooms || []).find(function (x) { return x.id === rId; }); if (!r) return;
    if (!confirm('Supprimer la chambre ' + (r.number || 'sans numéro') + ' ?')) return;
    f.rooms = f.rooms.filter(function (x) { return x.id !== rId; });
    _persist(); _rerender();
  }

  function _cycleStatus(bId, fId, rId) {
    var r = _findRoom(bId, fId, rId); if (!r) return;
    r.status = STATUS_CYCLE[r.status || 'aucun'] || 'aucun';
    _persist();
    var el = document.querySelector('[data-rl-room="' + rId + '"]');
    if (el) el.outerHTML = _roomRowHTML(bId, fId, r);
    else _rerender();
  }

  // ── RENDER ENTRY ──────────────────────────────────────────────────────────
  function render() {
    _loadLists();
    if (_curListId && _curList) _renderDoc();
    else _renderHome();
  }

  function _rerender() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    if (_curListId && _curList) _renderDoc();
    else _renderHome();
  }

  // ── HOME ──────────────────────────────────────────────────────────────────
  function _renderHome() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    var e = _e;
    var h = '<div class="mxrl-home">';
    h += '<div class="mxrl-home-hdr">';
    h += '<div><h1 class="mxrl-home-title"><i class="fa-solid fa-hotel"></i> Listes de chambres</h1>';
    h += '<p class="mxrl-home-sub">Créez et gérez vos listes de chambres par hôtel</p></div>';
    h += '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._showCreate()"><i class="fa-solid fa-plus"></i> Nouvelle liste</button>';
    h += '</div>';

    if (!_loaded || !_lists.length) {
      h += '<div class="mxrl-home-empty">';
      h += '<i class="fa-solid fa-hotel"></i>';
      h += '<p>' + (_loaded ? 'Aucune liste pour l\'instant.' : 'Chargement…') + '</p>';
      if (_loaded) h += '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._showCreate()"><i class="fa-solid fa-plus"></i> Créer une liste</button>';
      h += '</div>';
    } else {
      h += '<div class="mxrl-home-grid">';
      _lists.forEach(function (lst) {
        var st = _calcStats(lst.buildings || []);
        h += '<div class="mxrl-home-card" onclick="MX.Pages.MxRoomList._openById(\'' + e(lst.id) + '\')">';
        h += '<div class="mxrl-home-card-top">';
        h += '<div class="mxrl-home-card-ico"><i class="fa-solid fa-hotel"></i></div>';
        h += '<div class="mxrl-home-card-acts" onclick="event.stopPropagation()">';
        h += '<button class="mxrl-icon-btn" title="Dupliquer" onclick="MX.Pages.MxRoomList._showDup(\'' + e(lst.id) + '\')"><i class="fa-regular fa-copy"></i></button>';
        h += '<button class="mxrl-icon-btn mxrl-icon-btn--red" title="Supprimer" onclick="MX.Pages.MxRoomList._deleteById(\'' + e(lst.id) + '\')"><i class="fa-regular fa-trash"></i></button>';
        h += '</div></div>';
        h += '<div class="mxrl-home-card-body">';
        h += '<div class="mxrl-home-card-title">' + e(lst.title || 'Sans titre') + '</div>';
        h += '<div class="mxrl-home-card-meta">' + st.total + ' chambre' + (st.total !== 1 ? 's' : '') + ' · ' + (lst.buildings || []).length + ' bâtiment' + ((lst.buildings || []).length !== 1 ? 's' : '') + '</div>';
        h += '<div class="mxrl-home-card-prog">';
        h += '<div class="mxrl-pbar"><div class="mxrl-pbar-fill" style="width:' + st.pct + '%"></div></div>';
        h += '<span class="mxrl-home-card-pct">' + st.pct + '%</span>';
        h += '</div>';
        h += '<div class="mxrl-home-card-stats">';
        h += '<span class="mxrl-s-fait"><i class="fa-solid fa-circle-check"></i> ' + st.fait + '</span>';
        if (st.ocp)      h += '<span class="mxrl-s-ocp"><i class="fa-solid fa-triangle-exclamation"></i> ' + st.ocp + '</span>';
        if (st.pas_fait) h += '<span class="mxrl-s-pf"><i class="fa-solid fa-circle-xmark"></i> ' + st.pas_fait + '</span>';
        if (st.aucun)    h += '<span class="mxrl-s-aucun"><i class="fa-regular fa-circle"></i> ' + st.aucun + '</span>';
        h += '</div></div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    if (_showCreate) h += _tplCreateModal();
    if (_showDup)    h += _tplDupModal();
    mc.innerHTML = h;
  }

  // ── DOCUMENT VIEW ─────────────────────────────────────────────────────────
  function _renderDoc() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    var list = _curList;
    var st = _calcStats(list.buildings || []);
    var h = '<div class="mxrl-doc">';
    h += _tplStatsBar(st, list.title);
    h += _tplToolbar();
    h += '<div class="mxrl-layout">';
    h += '<div class="mxrl-left">' + _tplTree(list) + '</div>';
    h += '<div class="mxrl-main" id="mxrl-main">' + _renderContent(list) + '</div>';
    h += '</div></div>';
    if (_showPaste) h += _tplPasteModal();
    if (_showDup)   h += _tplDupModal();
    mc.innerHTML = h;
  }

  function _tplToolbar() {
    var e = _e;
    var h = '<div class="mxrl-toolbar">';
    h += '<div class="mxrl-view-toggle">';
    h += '<button class="mxrl-vtbtn' + (_viewMode === 'batiment' ? ' on' : '') + '" onclick="MX.Pages.MxRoomList._setView(\'batiment\')"><i class="fa-solid fa-building"></i> Par bâtiment</button>';
    h += '<button class="mxrl-vtbtn' + (_viewMode === 'etage' ? ' on' : '') + '" onclick="MX.Pages.MxRoomList._setView(\'etage\')"><i class="fa-solid fa-layer-group"></i> Par étage</button>';
    h += '</div>';
    h += '<div class="mxrl-search-wrap">';
    h += '<i class="fa-solid fa-magnifying-glass mxrl-search-ico"></i>';
    h += '<input class="mxrl-search" type="text" placeholder="Rechercher une chambre, un étage, un bâtiment…" value="' + e(_search) + '" oninput="MX.Pages.MxRoomList._setSearch(this.value)">';
    h += '</div>';
    h += '<div class="mxrl-toolbar-r">';
    h += '<div class="mxrl-filter-wrap">';
    h += '<button class="mxrl-btn-outline" onclick="MX.Pages.MxRoomList._toggleFilter()"><i class="fa-solid fa-sliders"></i> Filtres</button>';
    if (_filterOpen) {
      h += '<div class="mxrl-filter-panel">';
      h += '<div class="mxrl-filter-title">Afficher</div>';
      STATUSES.forEach(function (s) {
        h += '<label class="mxrl-filter-row"><input type="checkbox" ' + (_statusFilter[s.key] ? 'checked' : '') + ' data-sk="' + s.key + '" onchange="MX.Pages.MxRoomList._toggleStatusFilter(this.dataset.sk)"> ' + e(s.label) + '</label>';
      });
      h += '</div>';
    }
    h += '</div>';
    h += '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._quickAdd()"><i class="fa-solid fa-plus"></i> Ajouter</button>';
    h += '</div></div>';
    return h;
  }

  // ── STATS BAR ─────────────────────────────────────────────────────────────
  function _tplStatsBar(st, title) {
    var e = _e;
    var r = 28, circ = 2 * Math.PI * r;
    var dash = (st.pct / 100) * circ;
    var donut = '<svg class="mxrl-donut" viewBox="0 0 72 72">'
      + '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"/>'
      + '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="#10B981" stroke-width="7"'
      + ' stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '"'
      + ' transform="rotate(-90 36 36)" stroke-linecap="round"/>'
      + '<text x="36" y="36" text-anchor="middle" dominant-baseline="central" fill="#F1F5F9" font-size="13" font-weight="700">' + st.pct + '%</text>'
      + '</svg>';

    var h = '<div class="mxrl-stats-bar">';
    h += '<div class="mxrl-stats-bar-l">';
    h += '<button class="mxrl-back-btn" onclick="MX.Pages.MxRoomList._closeList()"><i class="fa-solid fa-arrow-left"></i></button>';
    h += '<h2 class="mxrl-doc-title">' + e(title || 'Liste de chambres') + '</h2>';
    h += '</div>';
    h += '<div class="mxrl-stat-cards">';
    h += '<div class="mxrl-stat-card mxrl-sc--total"><div class="mxrl-sc-n">' + st.total + '</div><div class="mxrl-sc-l">Total chambres</div></div>';
    h += '<div class="mxrl-stat-card mxrl-sc--fait"><div class="mxrl-sc-n">' + st.fait + '</div><div class="mxrl-sc-pct">' + _pct(st.fait, st.total) + '%</div><div class="mxrl-sc-l">Faites</div></div>';
    h += '<div class="mxrl-stat-card mxrl-sc--ocp"><div class="mxrl-sc-n">' + st.ocp + '</div><div class="mxrl-sc-pct">' + _pct(st.ocp, st.total) + '%</div><div class="mxrl-sc-l">OCP</div></div>';
    h += '<div class="mxrl-stat-card mxrl-sc--pf"><div class="mxrl-sc-n">' + st.pas_fait + '</div><div class="mxrl-sc-pct">' + _pct(st.pas_fait, st.total) + '%</div><div class="mxrl-sc-l">Pas faites</div></div>';
    h += '<div class="mxrl-stat-card mxrl-sc--aucun"><div class="mxrl-sc-n">' + st.aucun + '</div><div class="mxrl-sc-pct">' + _pct(st.aucun, st.total) + '%</div><div class="mxrl-sc-l">Sans statut</div></div>';
    h += '<div class="mxrl-stat-card mxrl-sc--donut">' + donut + '<div class="mxrl-sc-l">Progression</div></div>';
    h += '</div></div>';
    return h;
  }

  // ── TREE ──────────────────────────────────────────────────────────────────
  function _tplTree(list) {
    var e = _e;
    var h = '<div class="mxrl-tree">';
    h += '<div class="mxrl-tree-hdr"><span>Structure de l\'hôtel</span><button class="mxrl-tree-add" onclick="MX.Pages.MxRoomList._addBuilding()" title="Ajouter un bâtiment"><i class="fa-solid fa-plus"></i></button></div>';
    h += '<div class="mxrl-tree-body">';

    (list.buildings || []).forEach(function (b) {
      var bs = _calcStats([b]);
      var isExp = !!_expanded[b.id];
      var bSel = _selNode.bId === b.id && !_selNode.fId;
      h += '<div class="mxrl-tree-bld">';
      h += '<div class="mxrl-tree-bld-row' + (bSel ? ' mxrl-sel' : '') + '" onclick="MX.Pages.MxRoomList._selBld(\'' + e(b.id) + '\')">';
      h += '<button class="mxrl-caret" onclick="event.stopPropagation();MX.Pages.MxRoomList._expand(\'' + e(b.id) + '\')"><i class="fa-solid fa-chevron-' + (isExp ? 'down' : 'right') + '"></i></button>';
      h += '<i class="fa-solid fa-building mxrl-tree-ico"></i>';
      h += '<span class="mxrl-tree-name">' + e(b.name) + '</span>';
      h += '<span class="mxrl-tree-pct">' + bs.pct + '%</span>';
      h += '<button class="mxrl-tree-add-fl" onclick="event.stopPropagation();MX.Pages.MxRoomList._addFloor(\'' + e(b.id) + '\')" title="Ajouter un étage"><i class="fa-solid fa-plus"></i></button>';
      h += '</div>';
      if (isExp) {
        h += '<div class="mxrl-tree-floors">';
        (b.floors || []).forEach(function (f) {
          var fs = _calcFlrStats(f);
          var fSel = _selNode.fId === f.id;
          h += '<div class="mxrl-tree-flr' + (fSel ? ' mxrl-sel' : '') + '" onclick="MX.Pages.MxRoomList._selFlr(\'' + e(b.id) + '\',\'' + e(f.id) + '\')">';
          h += '<i class="fa-solid fa-layer-group mxrl-tree-ico-sm"></i>';
          h += '<div class="mxrl-tree-flr-info"><span class="mxrl-tree-flr-name">' + e(f.name) + '</span><span class="mxrl-tree-flr-cnt">' + fs.total + ' ch.</span></div>';
          h += '<span class="mxrl-tree-pct-sm">' + fs.pct + '%</span>';
          h += '</div>';
        });
        if (!(b.floors || []).length) {
          h += '<div class="mxrl-tree-empty-flr">Aucun étage · <a onclick="MX.Pages.MxRoomList._addFloor(\'' + e(b.id) + '\')">Ajouter</a></div>';
        }
        h += '</div>';
      }
      h += '</div>';
    });

    if (!(list.buildings || []).length) {
      h += '<div class="mxrl-tree-empty"><i class="fa-solid fa-building"></i><p>Aucun bâtiment.<br>Commencez par en créer un.</p></div>';
    }
    h += '</div>';

    h += '<div class="mxrl-tree-import">';
    h += '<div class="mxrl-tree-import-title"><i class="fa-solid fa-bolt"></i> Import rapide</div>';
    h += '<button class="mxrl-tree-import-btn" onclick="MX.Pages.MxRoomList._openPaste()"><i class="fa-regular fa-clipboard"></i> Coller une liste</button>';
    h += '<div class="mxrl-tree-astuce"><i class="fa-solid fa-lightbulb"></i><p>Collez simplement votre liste de chambres depuis Excel.</p></div>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // ── CONTENT ───────────────────────────────────────────────────────────────
  function _renderContent(list) {
    if (_viewMode === 'etage') return _renderEtage(list);
    var nd = _selNode;
    if (nd.type === 'floor' && nd.bId && nd.fId) {
      var b = _findBld(nd.bId); var f = _findFlr(nd.bId, nd.fId);
      if (b && f) return _renderFloorRooms(b, f);
    }
    if (nd.type === 'building' && nd.bId) {
      var bld = _findBld(nd.bId); if (bld) return _renderBldDetail(bld);
    }
    return _renderOverview(list);
  }

  function _renderOverview(list) {
    var e = _e;
    var h = '<div class="mxrl-content">';
    h += '<div class="mxrl-content-title"><i class="fa-solid fa-hotel"></i> Vue d\'ensemble</div>';
    if (!(list.buildings || []).length) {
      h += '<div class="mxrl-empty"><i class="fa-solid fa-hotel"></i><p>Commencez par ajouter un bâtiment dans le panneau de gauche.</p></div>';
    } else {
      h += '<div class="mxrl-bld-grid">';
      (list.buildings || []).forEach(function (b) {
        var bs = _calcStats([b]);
        h += '<div class="mxrl-bld-card" onclick="MX.Pages.MxRoomList._selBld(\'' + e(b.id) + '\')">';
        h += '<div class="mxrl-bld-card-top">';
        h += '<div class="mxrl-bld-card-ico"><i class="fa-solid fa-building"></i></div>';
        h += '<div class="mxrl-bld-card-info"><div class="mxrl-bld-card-name">' + e(b.name) + '</div>';
        h += '<div class="mxrl-bld-card-meta">' + bs.total + ' chambres · ' + (b.floors || []).length + ' étage' + ((b.floors || []).length !== 1 ? 's' : '') + '</div></div>';
        h += '<div class="mxrl-bld-card-pct">' + bs.pct + '%</div>';
        h += '</div>';
        h += '<div class="mxrl-pbar"><div class="mxrl-pbar-fill" style="width:' + bs.pct + '%"></div></div>';
        h += '<div class="mxrl-bld-card-stats">';
        h += '<span class="mxrl-s-fait"><i class="fa-solid fa-circle-check"></i> ' + bs.fait + '</span>';
        h += '<span class="mxrl-s-ocp"><i class="fa-solid fa-triangle-exclamation"></i> ' + bs.ocp + '</span>';
        h += '<span class="mxrl-s-pf"><i class="fa-solid fa-circle-xmark"></i> ' + bs.pas_fait + '</span>';
        h += '<span class="mxrl-s-aucun"><i class="fa-regular fa-circle"></i> ' + bs.aucun + '</span>';
        h += '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderBldDetail(b) {
    var e = _e;
    var bs = _calcStats([b]);
    var h = '<div class="mxrl-content">';
    h += '<div class="mxrl-bc"><button class="mxrl-bc-btn" onclick="MX.Pages.MxRoomList._selNode(\'root\')">Vue d\'ensemble</button><i class="fa-solid fa-chevron-right mxrl-bc-sep"></i><span>' + e(b.name) + '</span></div>';
    h += '<div class="mxrl-section-hdr">';
    h += '<div><h3>' + e(b.name) + '</h3><span class="mxrl-section-meta">' + bs.total + ' chambres · ' + (b.floors || []).length + ' étage(s)</span></div>';
    h += '<div class="mxrl-section-actions">';
    h += _miniStats(bs);
    h += '<button class="mxrl-btn-sm mxrl-btn-outline" onclick="MX.Pages.MxRoomList._addFloor(\'' + e(b.id) + '\')"><i class="fa-solid fa-plus"></i> Étage</button>';
    h += '<button class="mxrl-btn-sm mxrl-btn-danger" onclick="MX.Pages.MxRoomList._deleteBuilding(\'' + e(b.id) + '\')"><i class="fa-regular fa-trash"></i></button>';
    h += '</div></div>';
    h += '<div class="mxrl-pbar"><div class="mxrl-pbar-fill" style="width:' + bs.pct + '%"></div></div>';
    if (!(b.floors || []).length) {
      h += '<div class="mxrl-empty"><i class="fa-solid fa-layer-group"></i><p>Aucun étage dans ce bâtiment.</p><button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._addFloor(\'' + e(b.id) + '\')"><i class="fa-solid fa-plus"></i> Ajouter un étage</button></div>';
    } else {
      h += '<div class="mxrl-floors-grid">';
      (b.floors || []).forEach(function (f) {
        var fs = _calcFlrStats(f);
        h += '<div class="mxrl-floor-card" onclick="MX.Pages.MxRoomList._selFlr(\'' + e(b.id) + '\',\'' + e(f.id) + '\')">';
        h += '<div class="mxrl-floor-card-hdr"><span class="mxrl-floor-card-name">' + e(f.name) + '</span><span class="mxrl-floor-card-pct">' + fs.pct + '%</span></div>';
        h += '<div class="mxrl-floor-card-cnt">' + fs.total + ' chambre' + (fs.total !== 1 ? 's' : '') + '</div>';
        h += '<div class="mxrl-pbar"><div class="mxrl-pbar-fill" style="width:' + fs.pct + '%"></div></div>';
        h += '<div class="mxrl-floor-card-stats">';
        h += '<span class="mxrl-s-fait">' + fs.fait + '</span><span class="mxrl-s-ocp">' + fs.ocp + '</span><span class="mxrl-s-pf">' + fs.pas_fait + '</span><span class="mxrl-s-aucun">' + fs.aucun + '</span>';
        h += '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _renderFloorRooms(b, f) {
    var e = _e;
    var fs = _calcFlrStats(f);
    var rooms = _filteredRooms(f.rooms || []);
    var h = '<div class="mxrl-content">';
    h += '<div class="mxrl-bc"><button class="mxrl-bc-btn" onclick="MX.Pages.MxRoomList._selNode(\'root\')">Vue d\'ensemble</button><i class="fa-solid fa-chevron-right mxrl-bc-sep"></i><button class="mxrl-bc-btn" onclick="MX.Pages.MxRoomList._selBld(\'' + e(b.id) + '\')">' + e(b.name) + '</button><i class="fa-solid fa-chevron-right mxrl-bc-sep"></i><span>' + e(f.name) + '</span></div>';
    h += '<div class="mxrl-section-hdr">';
    h += '<div><h3>' + e(b.name) + ' <span class="mxrl-flr-sep">›</span> ' + e(f.name) + '</h3><span class="mxrl-section-meta">' + fs.total + ' chambres</span></div>';
    h += '<div class="mxrl-section-actions">';
    h += _miniStats(fs);
    h += '<button class="mxrl-btn-sm mxrl-btn-outline" onclick="MX.Pages.MxRoomList._addRoom(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-solid fa-plus"></i> Chambre</button>';
    h += '<button class="mxrl-btn-sm mxrl-btn-outline" onclick="MX.Pages.MxRoomList._openPasteFloor(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-regular fa-clipboard"></i> Coller</button>';
    h += '<button class="mxrl-btn-sm mxrl-btn-danger" onclick="MX.Pages.MxRoomList._deleteFloor(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-regular fa-trash"></i></button>';
    h += '</div></div>';
    h += '<div class="mxrl-pbar"><div class="mxrl-pbar-fill" style="width:' + fs.pct + '%"></div></div>';
    if (!rooms.length) {
      h += '<div class="mxrl-empty"><i class="fa-solid fa-door-open"></i>';
      if (_search) h += '<p>Aucune chambre ne correspond à la recherche.</p>';
      else h += '<p>Aucune chambre dans cet étage.</p><div class="mxrl-empty-acts"><button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._addRoom(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-solid fa-plus"></i> Ajouter une chambre</button><button class="mxrl-btn-outline" onclick="MX.Pages.MxRoomList._openPasteFloor(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-regular fa-clipboard"></i> Ajouter par collage</button></div>';
      h += '</div>';
    } else {
      h += '<div class="mxrl-room-table"><div class="mxrl-room-table-hdr"><span>Chambre</span><span>Statut</span><span class="mxrl-col-ico"><i class="fa-regular fa-comment"></i></span><span class="mxrl-col-ico"><i class="fa-regular fa-image"></i></span><span></span></div>';
      h += '<div class="mxrl-room-table-body">';
      rooms.forEach(function (r) { h += _roomRowHTML(b.id, f.id, r); });
      h += '</div></div>';
      h += '<div class="mxrl-floor-btns">';
      h += '<button class="mxrl-btn-ghost" onclick="MX.Pages.MxRoomList._addRoom(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-solid fa-plus"></i> Ajouter une chambre</button>';
      h += '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._openPasteFloor(\'' + e(b.id) + '\',\'' + e(f.id) + '\')"><i class="fa-regular fa-clipboard"></i> Ajouter par collage</button>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function _miniStats(s) {
    return '<div class="mxrl-mini-stats">'
      + '<span class="mxrl-ms-fait"><i class="fa-solid fa-circle-check"></i> ' + s.fait + ' <em>' + _pct(s.fait, s.total) + '%</em></span>'
      + '<span class="mxrl-ms-ocp"><i class="fa-solid fa-triangle-exclamation"></i> ' + s.ocp + ' <em>' + _pct(s.ocp, s.total) + '%</em></span>'
      + '<span class="mxrl-ms-pf"><i class="fa-solid fa-circle-xmark"></i> ' + s.pas_fait + ' <em>' + _pct(s.pas_fait, s.total) + '%</em></span>'
      + '<span class="mxrl-ms-aucun"><i class="fa-regular fa-circle"></i> ' + s.aucun + '</span>'
      + '</div>';
  }

  function _filteredRooms(rooms) {
    return rooms.filter(function (r) {
      var st = r.status || 'aucun';
      if (!_statusFilter[st]) return false;
      if (!_search) return true;
      var q = _search.toLowerCase();
      return (r.number || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q);
    });
  }

  function _roomRowHTML(bId, fId, r) {
    var e = _e;
    var st = STATUS_MAP[r.status || 'aucun'] || STATUS_MAP['aucun'];
    return '<div class="mxrl-room-row" data-rl-room="' + e(r.id) + '">'
      + '<div class="mxrl-room-num">' + e(r.number) + (r.name ? '<span class="mxrl-room-name-lbl">' + e(r.name) + '</span>' : '') + '</div>'
      + '<div class="mxrl-room-st">'
      + '<button class="mxrl-status mxrl-st-' + st.key + '" data-bid="' + e(bId) + '" data-fid="' + e(fId) + '" data-rid="' + e(r.id) + '" onclick="MX.Pages.MxRoomList._cycle(this.dataset.bid,this.dataset.fid,this.dataset.rid)">'
      + '<i class="fa-solid ' + st.icon + '"></i> ' + st.label
      + '</button></div>'
      + '<div class="mxrl-col-ico">' + (r.comment ? '<span class="mxrl-has-cmnt" title="' + e(r.comment) + '"><i class="fa-solid fa-comment"></i></span>' : '<span class="mxrl-no-ico"><i class="fa-regular fa-comment"></i></span>') + '</div>'
      + '<div class="mxrl-col-ico">' + (r.photos > 0 ? '<span class="mxrl-has-photo">' + r.photos + '</span>' : '<span class="mxrl-no-ico"><i class="fa-regular fa-image"></i></span>') + '</div>'
      + '<div class="mxrl-room-acts"><button class="mxrl-room-del" data-bid="' + e(bId) + '" data-fid="' + e(fId) + '" data-rid="' + e(r.id) + '" onclick="MX.Pages.MxRoomList._delRoom(this.dataset.bid,this.dataset.fid,this.dataset.rid)" title="Supprimer"><i class="fa-regular fa-trash"></i></button></div>'
      + '</div>';
  }

  // ── PAR ÉTAGE VIEW ────────────────────────────────────────────────────────
  function _renderEtage(list) {
    var e = _e;
    var floorNames = [], floorMap = {};
    (list.buildings || []).forEach(function (b) {
      (b.floors || []).forEach(function (f) {
        if (!floorMap[f.name]) { floorMap[f.name] = []; floorNames.push(f.name); }
        floorMap[f.name].push({ b: b, f: f });
      });
    });
    var seen = {}, uniq = [];
    floorNames.forEach(function (n) { if (!seen[n]) { seen[n] = true; uniq.push(n); } });

    var h = '<div class="mxrl-content">';
    h += '<div class="mxrl-content-title"><i class="fa-solid fa-layer-group"></i> Vue par étage</div>';
    if (!uniq.length) {
      h += '<div class="mxrl-empty"><i class="fa-solid fa-layer-group"></i><p>Aucun étage défini.</p></div>';
    } else {
      uniq.forEach(function (fname) {
        var entries = floorMap[fname];
        var allRooms = [];
        entries.forEach(function (en) { allRooms = allRooms.concat(en.f.rooms || []); });
        var fs = _calcFlrStats({ rooms: allRooms });
        var key = 'etg_' + fname;
        var isExp = !!_expanded[key];
        h += '<div class="mxrl-etage-sec">';
        h += '<div class="mxrl-etage-hdr" onclick="MX.Pages.MxRoomList._expandKey(\'' + e(key) + '\')">';
        h += '<button class="mxrl-caret"><i class="fa-solid fa-chevron-' + (isExp ? 'down' : 'right') + '"></i></button>';
        h += '<span class="mxrl-etage-name">' + e(fname) + '</span>';
        h += '<span class="mxrl-etage-cnt">' + allRooms.length + ' chambres</span>';
        h += _miniStats(fs);
        h += '<span class="mxrl-etage-pct">' + fs.pct + '%</span>';
        h += '</div>';
        if (isExp) {
          h += '<div class="mxrl-etage-body">';
          entries.forEach(function (en) {
            var rooms = _filteredRooms(en.f.rooms || []);
            if (!rooms.length) return;
            h += '<div class="mxrl-etage-bld-lbl"><i class="fa-solid fa-building"></i> ' + e(en.b.name) + '</div>';
            h += '<div class="mxrl-room-table"><div class="mxrl-room-table-body">';
            rooms.forEach(function (r) { h += _roomRowHTML(en.b.id, en.f.id, r); });
            h += '</div></div>';
          });
          h += '</div>';
        }
        h += '</div>';
      });
    }
    h += '</div>';
    return h;
  }

  // ── MODALS ────────────────────────────────────────────────────────────────
  function _tplCreateModal() {
    var e = _e;
    return '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._hideCreate()">'
      + '<div class="mxrl-modal" onclick="event.stopPropagation()">'
      + '<div class="mxrl-modal-hdr"><h3><i class="fa-solid fa-hotel"></i> Nouvelle liste</h3><button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._hideCreate()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxrl-modal-body">'
      + '<label class="mxrl-label">Nom du document</label>'
      + '<input class="mxrl-input" type="text" placeholder="Ex: Liste chambres vierges" value="' + e(_createTitle) + '" oninput="MX.Pages.MxRoomList._setCreateTitle(this.value)" autofocus>'
      + '</div>'
      + '<div class="mxrl-modal-foot">'
      + '<button class="mxrl-btn-cancel" onclick="MX.Pages.MxRoomList._hideCreate()">Annuler</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._confirmCreate()"><i class="fa-solid fa-check"></i> Créer</button>'
      + '</div></div></div>';
  }

  function _tplPasteModal() {
    var e = _e;
    var target = _pasteTarget;
    var b = target && _findBld(target.bId);
    var f = target && _findFlr(target.bId, target.fId);
    var dest = (b && f) ? (e(b.name) + ' › ' + e(f.name)) : '';
    return '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._hidePaste()">'
      + '<div class="mxrl-modal" onclick="event.stopPropagation()">'
      + '<div class="mxrl-modal-hdr"><h3><i class="fa-regular fa-clipboard"></i> Coller une liste</h3><button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._hidePaste()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxrl-modal-body">'
      + (dest ? '<div class="mxrl-paste-dest"><i class="fa-solid fa-layer-group"></i> Destination : <strong>' + dest + '</strong></div>' : '')
      + '<label class="mxrl-label">Liste de chambres (une par ligne)</label>'
      + '<textarea class="mxrl-textarea" placeholder="101&#10;102&#10;103&#10;104&#10;..." rows="10" oninput="MX.Pages.MxRoomList._setPasteText(this.value)">' + e(_pasteText) + '</textarea>'
      + '<p class="mxrl-paste-hint"><i class="fa-solid fa-lightbulb"></i> Collez directement depuis Excel. Une ligne = une chambre.</p>'
      + '</div>'
      + '<div class="mxrl-modal-foot">'
      + '<button class="mxrl-btn-cancel" onclick="MX.Pages.MxRoomList._hidePaste()">Annuler</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._confirmPaste()"><i class="fa-solid fa-file-import"></i> Importer</button>'
      + '</div></div></div>';
  }

  function _tplDupModal() {
    var e = _e;
    var src = _lists.find(function (l) { return l.id === _dupSrcId; });
    var opts = [
      { k: 'blds', v: _dupKeepBlds, l: 'Conserver les bâtiments' },
      { k: 'floors', v: _dupKeepFloors, l: 'Conserver les étages' },
      { k: 'rooms', v: _dupKeepRooms, l: 'Conserver les chambres' },
      { k: 'reset', v: _dupResetStatus, l: 'Réinitialiser les statuts' },
    ];
    return '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._hideDupModal()">'
      + '<div class="mxrl-modal" onclick="event.stopPropagation()">'
      + '<div class="mxrl-modal-hdr"><h3><i class="fa-regular fa-copy"></i> Dupliquer la liste</h3><button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._hideDupModal()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxrl-modal-body">'
      + (src ? '<div class="mxrl-dup-src"><i class="fa-solid fa-hotel"></i> ' + e(src.title || 'Sans titre') + '</div>' : '')
      + '<label class="mxrl-label">Nom du nouveau document</label>'
      + '<input class="mxrl-input" type="text" placeholder="Ex: Contrôle éclairage" value="' + e(_dupTitle) + '" oninput="MX.Pages.MxRoomList._setDupTitle(this.value)">'
      + '<div class="mxrl-dup-opts">'
      + opts.map(function (o) {
        return '<label class="mxrl-dup-opt"><input type="checkbox" ' + (o.v ? 'checked' : '') + ' data-dk="' + o.k + '" onchange="MX.Pages.MxRoomList._setDupOpt(this.dataset.dk,this.checked)"> ' + e(o.l) + '</label>';
      }).join('')
      + '</div></div>'
      + '<div class="mxrl-modal-foot">'
      + '<button class="mxrl-btn-cancel" onclick="MX.Pages.MxRoomList._hideDupModal()">Annuler</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._confirmDup()"><i class="fa-regular fa-copy"></i> Dupliquer</button>'
      + '</div></div></div>';
  }

  // ── PUBLIC API (called from onclick) ──────────────────────────────────────
  function _openById(id)   { _openList(id); }
  function _deleteById(id) { _deleteList(id); }

  function _closeList() {
    if (_listUnsub) { _listUnsub(); _listUnsub = null; }
    _curListId = null; _curList = null;
    _selNode = { type: 'root' }; _expanded = {};
    _rerender();
  }

  function _selNode(type, bId, fId) {
    _selNode2(type, bId, fId);
  }
  function _selNode2(type, bId, fId) {
    _selNode = { type: type, bId: bId || null, fId: fId || null };
    _rerender();
  }
  function _selBld(bId) { _expanded[bId] = true; _selNode = { type: 'building', bId: bId, fId: null }; _rerender(); }
  function _selFlr(bId, fId) { _expanded[bId] = true; _selNode = { type: 'floor', bId: bId, fId: fId }; _rerender(); }
  function _expand(bId) { _expanded[bId] = !_expanded[bId]; _rerender(); }
  function _expandKey(key) { _expanded[key] = !_expanded[key]; _rerender(); }
  function _setView(mode) { _viewMode = mode; _selNode = { type: 'root' }; _rerender(); }
  function _setSearch(q) { _search = q; _rerender(); }
  function _toggleFilter() { _filterOpen = !_filterOpen; _rerender(); }
  function _toggleStatusFilter(key) { _statusFilter[key] = !_statusFilter[key]; _rerender(); }
  function _cycle(bId, fId, rId) { _cycleStatus(bId, fId, rId); }
  function _delRoom(bId, fId, rId) { _deleteRoom(bId, fId, rId); }

  function _quickAdd() {
    if (_selNode.type === 'floor' && _selNode.bId && _selNode.fId) {
      _addRoom(_selNode.bId, _selNode.fId);
    } else {
      _notify('Sélectionnez d\'abord un étage dans l\'arborescence', true);
    }
  }

  function _showCreate() { _showCreate2(); }
  function _showCreate2() { _showCreate = true; _rerender(); }
  function _hideCreate() { _showCreate = false; _rerender(); }
  function _setCreateTitle(v) { _createTitle = v; }
  function _confirmCreate() {
    if (!_createTitle.trim()) { _notify('Saisissez un nom', true); return; }
    _createList(_createTitle);
  }

  function _openPaste() {
    _pasteTarget = (_selNode.type === 'floor' && _selNode.bId && _selNode.fId)
      ? { bId: _selNode.bId, fId: _selNode.fId } : null;
    _pasteText = ''; _showPaste = true; _rerender();
  }
  function _openPasteFloor(bId, fId) { _pasteTarget = { bId: bId, fId: fId }; _pasteText = ''; _showPaste = true; _rerender(); }
  function _hidePaste() { _showPaste = false; _pasteText = ''; _rerender(); }
  function _setPasteText(v) { _pasteText = v; }
  function _confirmPaste() {
    if (!_pasteTarget) { _notify('Sélectionnez un étage de destination d\'abord', true); return; }
    if (!_pasteText.trim()) { _notify('Collez au moins une chambre', true); return; }
    _addRooms(_pasteTarget.bId, _pasteTarget.fId, _pasteText);
    _showPaste = false; _pasteText = ''; _pasteTarget = null;
  }

  function _showDup(id) {
    _dupSrcId = id;
    var src = _lists.find(function (l) { return l.id === id; });
    _dupTitle = src ? (src.title + ' (copie)') : '';
    _dupKeepBlds = true; _dupKeepFloors = true; _dupKeepRooms = true; _dupResetStatus = true;
    _showDup2();
  }
  function _showDup2() { _showDup = true; _rerender(); }
  function _hideDupModal() { _showDup = false; _dupSrcId = null; _rerender(); }
  function _setDupTitle(v) { _dupTitle = v; }
  function _setDupOpt(key, val) {
    if (key === 'blds') _dupKeepBlds = val;
    else if (key === 'floors') _dupKeepFloors = val;
    else if (key === 'rooms') _dupKeepRooms = val;
    else if (key === 'reset') _dupResetStatus = val;
  }
  function _confirmDup() { _execDuplicate(); }

  // ── DESTROY ───────────────────────────────────────────────────────────────
  function _destroy() {
    if (_listsUnsub) { _listsUnsub(); _listsUnsub = null; }
    if (_listUnsub)  { _listUnsub();  _listUnsub = null; }
    if (_saveTimer)  { clearTimeout(_saveTimer); _saveTimer = null; }
    _loaded = false; _lists = []; _curListId = null; _curList = null;
  }

  // ── EXPORTS ───────────────────────────────────────────────────────────────
  window.MX.Pages.MxRoomList = {
    render,
    _destroy,
    _openById,
    _deleteById,
    _closeList,
    _selNode: _selNode2,
    _selBld,
    _selFlr,
    _expand,
    _expandKey,
    _setView,
    _setSearch,
    _toggleFilter,
    _toggleStatusFilter,
    _cycle,
    _delRoom,
    _quickAdd,
    _addBuilding,
    _addFloor,
    _addRoom,
    _deleteBuilding,
    _deleteFloor,
    _deleteRoom,
    _showCreate: _showCreate2,
    _hideCreate,
    _setCreateTitle,
    _confirmCreate,
    _openPaste,
    _openPasteFloor,
    _hidePaste,
    _setPasteText,
    _confirmPaste,
    _showDup,
    _hideDupModal,
    _setDupTitle,
    _setDupOpt,
    _confirmDup,
  };
})();
