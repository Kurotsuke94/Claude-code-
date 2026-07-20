(function () {
  'use strict';

  // ── STATE ─────────────────────────────────────────────────────────────────
  var _lists      = [];
  var _listsUnsub = null;
  var _loaded     = false;

  var _curListId  = null;
  var _curList    = null;
  var _listUnsub  = null;

  var _curFloorKey  = null;  // "bId|fId"
  var _filterPill   = 'all'; // 'all' | 'fait' | 'ocp' | 'restantes'
  var _expandedRoom = {};

  var _showCreate     = false;
  var _createTitle    = '';
  var _showPaste      = false;
  var _pasteTarget    = null;
  var _pasteText      = '';
  var _dupVisible     = false;
  var _dupSrcId       = null;
  var _dupTitle       = '';
  var _dupKeepBlds    = true;
  var _dupKeepFloors  = true;
  var _dupKeepRooms   = true;
  var _dupResetStatus = true;
  var _showAdmin      = false;
  var _adminExpanded  = {};

  var _dnd       = null;
  var _ctx       = null;
  var _saveTimer = null;

  // ── DB ────────────────────────────────────────────────────────────────────
  var DB = { lists: function () { return db.collection('mx_room_lists'); } };
  var FV = firebase.firestore.FieldValue;

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

  function _isAdmin() {
    try {
      var cu = MX.Auth && MX.Auth.currentUser && MX.Auth.currentUser();
      return !!(cu && (cu.role === 'admin' || cu.role === 'manager' || (cu.email && cu.email === 'keyzeur94460@hotmail.fr')));
    } catch (e) { return false; }
  }

  function _timeStr() {
    var d = new Date();
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function _dateStr() {
    return new Date().toLocaleDateString('fr-FR');
  }

  // ── SMART FLOOR SORT ─────────────────────────────────────────────────────
  function _floorKey(name) {
    if (!name) return 5000;
    var n = String(name).toLowerCase().trim();
    var ss = n.match(/sous.sol\s*(-?\d+)/);
    if (ss) return -100 * Math.abs(parseInt(ss[1], 10));
    if (/sous.sol/.test(n)) return -100;
    if (/^(rdc|rez.de.chauss[eé]e?|rez)(\s|$)/.test(n)) return 0;
    if (/entresol/.test(n)) return 50;
    if (/mezzanine/.test(n)) return 75;
    var rp = n.match(/^r\+(\d+)/);
    if (rp) return parseInt(rp[1], 10) * 100;
    var ord = n.match(/^(\d+)/);
    if (ord) return parseInt(ord[1], 10) * 100;
    if (/terrasse/.test(n)) return 9800;
    if (/toiture/.test(n)) return 9900;
    if (/technique/.test(n)) return 9950;
    return 5000;
  }

  // ── SORT HELPERS ─────────────────────────────────────────────────────────
  function _sortedBlds() {
    if (!_curList || !_curList.buildings) return [];
    return (_curList.buildings || []).slice().sort(function (a, b) {
      return (a.sortOrder !== undefined ? a.sortOrder : 999999) - (b.sortOrder !== undefined ? b.sortOrder : 999999);
    });
  }

  function _sortedFlrs(bId) {
    var b = _findBld(bId);
    if (!b || !b.floors) return [];
    return (b.floors || []).slice().sort(function (a, b) {
      var ao = a.sortOrder !== undefined ? a.sortOrder : _floorKey(a.name);
      var bo = b.sortOrder !== undefined ? b.sortOrder : _floorKey(b.name);
      return ao - bo;
    });
  }

  function _sortedRooms(rooms) {
    return (rooms || []).slice().sort(function (a, b) {
      var an = parseInt(a.number || '', 10);
      var bn = parseInt(b.number || '', 10);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      if (!isNaN(an)) return -1;
      if (!isNaN(bn)) return 1;
      return String(a.number || '').localeCompare(String(b.number || ''));
    });
  }

  function _allFloors() {
    var result = [];
    _sortedBlds().forEach(function (b) {
      _sortedFlrs(b.id).forEach(function (f) {
        result.push({ bId: b.id, fId: f.id, bName: b.name, fName: f.name, flr: f });
      });
    });
    return result;
  }

  function _floorFromKey(key) {
    if (!key) return null;
    var parts = key.split('|');
    return { bId: parts[0], fId: parts[1] };
  }

  function _ensureBldOrders() {
    if (!_curList || !_curList.buildings) return;
    var sorted = _sortedBlds();
    sorted.forEach(function (b, i) { b.sortOrder = i * 1000; });
    _curList.buildings = sorted;
  }

  function _ensureFlrOrders(bId) {
    var b = _findBld(bId); if (!b) return;
    var sorted = _sortedFlrs(bId);
    sorted.forEach(function (f, i) { f.sortOrder = i * 1000; });
    b.floors = sorted;
  }

  // ── STATS ─────────────────────────────────────────────────────────────────
  function _calcStats(buildings) {
    var s = { total: 0, fait: 0, ocp: 0, aucun: 0 };
    (buildings || []).forEach(function (b) {
      (b.floors || []).forEach(function (f) {
        (f.rooms || []).forEach(function (r) {
          if (r.disabled) return;
          s.total++;
          var k = r.status || 'aucun';
          if (k === 'fait') s.fait++;
          else if (k === 'ocp') s.ocp++;
          else s.aucun++;
        });
      });
    });
    s.pct = s.total ? Math.round(s.fait / s.total * 100) : 0;
    return s;
  }

  function _calcFlrStats(flr) {
    var s = { total: 0, fait: 0, ocp: 0, aucun: 0 };
    (flr.rooms || []).forEach(function (r) {
      if (r.disabled) return;
      s.total++;
      var k = r.status || 'aucun';
      if (k === 'fait') s.fait++;
      else if (k === 'ocp') s.ocp++;
      else s.aucun++;
    });
    s.pct = s.total ? Math.round(s.fait / s.total * 100) : 0;
    return s;
  }

  function _pct(n, total) { return total ? Math.round(n / total * 100) : 0; }

  // ── FINDERS ──────────────────────────────────────────────────────────────
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
    _curFloorKey = null; _filterPill = 'all'; _expandedRoom = {};
    _listUnsub = DB.lists().doc(id).onSnapshot(function (doc) {
      if (!doc.exists) { _curList = null; _rerender(); return; }
      var isFirst = !_curList;
      _curList = Object.assign({ id: doc.id }, doc.data());
      if (isFirst) {
        var floors = _allFloors();
        if (floors.length) _curFloorKey = floors[0].bId + '|' + floors[0].fId;
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
      status: 'active', createdAt: FV.serverTimestamp(),
      createdBy: _author(), updatedAt: FV.serverTimestamp(), buildings: []
    }).then(function (ref) {
      _showCreate = false; _createTitle = ''; _openList(ref.id);
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
              changedBy: _dupResetStatus ? '' : (r.changedBy || ''),
              changedAt: _dupResetStatus ? '' : (r.changedAt || ''),
              history: _dupResetStatus ? [] : (r.history || [])
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
      _dupVisible = false; _dupSrcId = null; _dupTitle = '';
      _notify('Liste dupliquée'); _openList(ref.id);
    }).catch(function (err) { _notify('Erreur duplication', true); console.error(err); });
  }

  // ── STATUS CHANGE ─────────────────────────────────────────────────────────
  function _setStatus(bId, fId, rId, status) {
    var r = _findRoom(bId, fId, rId); if (!r) return;
    r.status    = status;
    r.changedBy = _author();
    r.changedAt = _timeStr();
    r.date      = _dateStr();
    if (!r.history) r.history = [];
    r.history.push({ status: status, changedBy: r.changedBy, changedAt: r.changedAt, date: r.date });
    _persist();
    var rowEl = document.querySelector('[data-mxrl-room="' + rId + '"]');
    if (rowEl) rowEl.outerHTML = _roomRowV2HTML(bId, fId, r, !!_expandedRoom[rId]);
    _patchStats();
  }

  function _patchStats() {
    if (!_curList) return;
    var st = _calcStats(_curList.buildings || []);
    var el;
    el = document.getElementById('mxrl-g-total');    if (el) el.textContent = st.total;
    el = document.getElementById('mxrl-g-fait');     if (el) el.textContent = st.fait;
    el = document.getElementById('mxrl-g-ocp');      if (el) el.textContent = st.ocp;
    el = document.getElementById('mxrl-g-rest');     if (el) el.textContent = st.aucun;
    el = document.getElementById('mxrl-g-pct');      if (el) el.textContent = st.pct + '%';
    el = document.getElementById('mxrl-g-bar');      if (el) el.style.width = st.pct + '%';
    el = document.getElementById('mxrl-g-fait-pct'); if (el) el.textContent = _pct(st.fait, st.total) + '%';
    el = document.getElementById('mxrl-g-ocp-pct');  if (el) el.textContent = _pct(st.ocp, st.total) + '%';
    el = document.getElementById('mxrl-g-rest-pct'); if (el) el.textContent = _pct(st.aucun, st.total) + '%';
  }

  // ── DATA MUTATIONS ────────────────────────────────────────────────────────
  function _addBuilding() {
    if (!_curList) return;
    var name = prompt('Nom du bâtiment :');
    if (!name || !name.trim()) return;
    if (!_curList.buildings) _curList.buildings = [];
    var maxOrder = 0;
    (_curList.buildings || []).forEach(function (b) { if ((b.sortOrder || 0) > maxOrder) maxOrder = b.sortOrder || 0; });
    var bld = { id: _uid(), name: name.trim(), sortOrder: maxOrder + 1000, floors: [] };
    _curList.buildings.push(bld);
    _adminExpanded[bld.id] = true;
    _persist(); _rerender();
  }

  function _addFloor(bId) {
    var b = _findBld(bId); if (!b) return;
    var name = prompt('Nom de l\'étage :');
    if (!name || !name.trim()) return;
    if (!b.floors) b.floors = [];
    var flr = { id: _uid(), name: name.trim(), sortOrder: _floorKey(name.trim()), rooms: [] };
    b.floors.push(flr);
    _adminExpanded[bId] = true;
    _curFloorKey = bId + '|' + flr.id;
    _persist(); _rerender();
  }

  function _addRooms(bId, fId, text) {
    var f = _findFlr(bId, fId); if (!f) return;
    if (!f.rooms) f.rooms = [];
    var lines = text.split(/[\n,;]+/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) { _notify('Aucune chambre à importer', true); return; }
    lines.forEach(function (num) {
      f.rooms.push({ id: _uid(), number: num, name: '', status: 'aucun', comment: '', history: [] });
    });
    _notify(lines.length + ' chambre(s) ajoutée(s)');
    _persist(); _rerender();
  }

  function _renameRoom(bId, fId, rId) {
    var r = _findRoom(bId, fId, rId); if (!r) return;
    var num = prompt('Nouveau numéro :', r.number || '');
    if (num === null) return;
    r.number = num.trim();
    _persist(); _rerender();
  }

  function _toggleDisableRoom(bId, fId, rId) {
    var r = _findRoom(bId, fId, rId); if (!r) return;
    r.disabled = !r.disabled;
    _persist(); _rerender();
  }

  function _deleteBuilding(bId) {
    var b = _findBld(bId); if (!b) return;
    var n = (b.floors || []).reduce(function (s, f) { return s + (f.rooms || []).length; }, 0);
    if (!confirm('Supprimer "' + b.name + '"' + (n ? ' et ses ' + n + ' chambre(s)' : '') + ' ?')) return;
    _curList.buildings = (_curList.buildings || []).filter(function (x) { return x.id !== bId; });
    delete _adminExpanded[bId];
    _persist(); _rerender();
  }

  function _deleteFloor(bId, fId) {
    var b = _findBld(bId); var f = _findFlr(bId, fId);
    if (!b || !f) return;
    var n = (f.rooms || []).length;
    if (!confirm('Supprimer "' + f.name + '"' + (n ? ' et ses ' + n + ' chambre(s)' : '') + ' ?')) return;
    b.floors = (b.floors || []).filter(function (x) { return x.id !== fId; });
    if (_curFloorKey === bId + '|' + fId) _curFloorKey = null;
    _persist(); _rerender();
  }

  function _deleteRoom(bId, fId, rId) {
    var f = _findFlr(bId, fId); if (!f) return;
    var r = (f.rooms || []).find(function (x) { return x.id === rId; }); if (!r) return;
    if (!confirm('Supprimer la chambre ' + (r.number || 'sans numéro') + ' ?')) return;
    f.rooms = f.rooms.filter(function (x) { return x.id !== rId; });
    _persist(); _rerender();
  }

  function _setComment(bId, fId, rId, val) {
    var r = _findRoom(bId, fId, rId); if (!r) return;
    r.comment = val; _persist();
  }

  // ── DRAG & DROP ───────────────────────────────────────────────────────────
  function _dndDown(e, handleEl) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    var dtype = handleEl.dataset.dtype;
    var bId   = handleEl.dataset.bid;
    var fId   = handleEl.dataset.fid || null;
    var nm    = dtype === 'bld' ? ((_findBld(bId) || {}).name || '?') : ((_findFlr(bId, fId) || {}).name || '?');
    var ico   = dtype === 'bld' ? 'fa-building' : 'fa-layer-group';
    var ghost = document.createElement('div');
    ghost.className = 'mxrl-dnd-ghost';
    ghost.innerHTML = '<i class="fa-solid ' + ico + '"></i> ' + _e(nm);
    ghost.style.left = (e.clientX + 14) + 'px';
    ghost.style.top  = (e.clientY - 18) + 'px';
    document.body.appendChild(ghost);
    var line = document.getElementById('mxrl-drop-line');
    if (!line) { line = document.createElement('div'); line.id = 'mxrl-drop-line'; document.body.appendChild(line); }
    line.style.display = 'none';
    var rowEl = dtype === 'bld'
      ? document.querySelector('.mxrl-admin-bld[data-bid="' + bId + '"] > .mxrl-admin-bld-row')
      : document.querySelector('.mxrl-admin-flr[data-fid="' + fId + '"]');
    if (rowEl) rowEl.classList.add('mxrl-dnd-dragging');
    _dnd = { type: dtype, bId: bId, fId: fId, ghost: ghost, line: line, rowEl: rowEl, dropIdx: null };
    document.addEventListener('pointermove', _dndMove, { passive: true });
    document.addEventListener('pointerup',   _dndUp);
    document.addEventListener('pointercancel', _dndUp);
  }

  function _dndMove(e) {
    if (!_dnd) return;
    var d = _dnd;
    d.ghost.style.left = (e.clientX + 14) + 'px';
    d.ghost.style.top  = (e.clientY - 18) + 'px';
    var lineY = null;
    var containerEl = document.querySelector('.mxrl-admin-tree');
    var cRect = containerEl ? containerEl.getBoundingClientRect() : null;
    var dropIdx, i, r;
    if (d.type === 'bld') {
      var blds = document.querySelectorAll('.mxrl-admin-bld');
      dropIdx = blds.length;
      for (i = 0; i < blds.length; i++) {
        r = blds[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height * 0.5) { dropIdx = i; lineY = r.top; break; }
        lineY = r.bottom;
      }
      d.dropIdx = dropIdx;
    } else {
      var bldEl = document.querySelector('.mxrl-admin-bld[data-bid="' + d.bId + '"]');
      if (!bldEl) { d.line.style.display = 'none'; return; }
      var flrsCont = bldEl.querySelector('.mxrl-admin-floors');
      if (!flrsCont) { d.line.style.display = 'none'; return; }
      var flrs = flrsCont.querySelectorAll('.mxrl-admin-flr');
      dropIdx = flrs.length;
      for (i = 0; i < flrs.length; i++) {
        r = flrs[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height * 0.5) { dropIdx = i; lineY = r.top; break; }
        lineY = r.bottom;
      }
      d.dropIdx = dropIdx;
    }
    if (lineY !== null && cRect) {
      d.line.style.display = 'block';
      d.line.style.top   = (lineY - 1) + 'px';
      d.line.style.left  = (cRect.left + 6) + 'px';
      d.line.style.width = (cRect.width - 12) + 'px';
    } else { d.line.style.display = 'none'; }
  }

  function _dndUp() {
    if (!_dnd) return;
    document.removeEventListener('pointermove', _dndMove);
    document.removeEventListener('pointerup',   _dndUp);
    document.removeEventListener('pointercancel', _dndUp);
    var d = _dnd; _dnd = null;
    if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.line) d.line.style.display = 'none';
    if (d.dropIdx !== null) _dndApply(d); else _rerender();
  }

  function _dndApply(d) {
    if (!_curList) return;
    if (d.type === 'bld') {
      _ensureBldOrders();
      var sorted = _sortedBlds();
      var curIdx = sorted.findIndex(function (b) { return b.id === d.bId; });
      if (curIdx < 0) { _rerender(); return; }
      var item = sorted.splice(curIdx, 1)[0];
      var newIdx = Math.max(0, Math.min(d.dropIdx > curIdx ? d.dropIdx - 1 : d.dropIdx, sorted.length));
      sorted.splice(newIdx, 0, item);
      sorted.forEach(function (b, i) { b.sortOrder = i * 1000; });
      _curList.buildings = sorted;
    } else {
      _ensureFlrOrders(d.bId);
      var sorted = _sortedFlrs(d.bId);
      var curIdx = sorted.findIndex(function (f) { return f.id === d.fId; });
      if (curIdx < 0) { _rerender(); return; }
      var item = sorted.splice(curIdx, 1)[0];
      var newIdx = Math.max(0, Math.min(d.dropIdx > curIdx ? d.dropIdx - 1 : d.dropIdx, sorted.length));
      sorted.splice(newIdx, 0, item);
      sorted.forEach(function (f, i) { f.sortOrder = i * 1000; });
      var b = _findBld(d.bId); if (b) b.floors = sorted;
    }
    _persist(); _rerender();
  }

  // ── CONTEXT MENU ─────────────────────────────────────────────────────────
  function _openCtx(e, type, bId, fId) {
    e.preventDefault(); e.stopPropagation();
    _ctx = { type: type, bId: bId, fId: fId || null, x: e.clientX, y: e.clientY };
    document.addEventListener('keydown', _ctxKeydown);
    _rerender();
  }
  function _ctxKeydown(e) {
    if (e.key === 'Escape' && _ctx) { _ctx = null; document.removeEventListener('keydown', _ctxKeydown); _rerender(); }
  }
  function _closeCtx() { _ctx = null; document.removeEventListener('keydown', _ctxKeydown); _rerender(); }

  function _ctxUp() {
    if (!_ctx) return;
    var ctx = _ctx; _ctx = null; document.removeEventListener('keydown', _ctxKeydown);
    if (ctx.type === 'bld') {
      _ensureBldOrders();
      var sorted = _sortedBlds();
      var idx = sorted.findIndex(function (b) { return b.id === ctx.bId; });
      if (idx > 0) { var tmp = sorted[idx].sortOrder; sorted[idx].sortOrder = sorted[idx-1].sortOrder; sorted[idx-1].sortOrder = tmp; _persist(); }
    } else {
      _ensureFlrOrders(ctx.bId);
      var sorted = _sortedFlrs(ctx.bId);
      var idx = sorted.findIndex(function (f) { return f.id === ctx.fId; });
      if (idx > 0) { var tmp = sorted[idx].sortOrder; sorted[idx].sortOrder = sorted[idx-1].sortOrder; sorted[idx-1].sortOrder = tmp; _persist(); }
    }
    _rerender();
  }

  function _ctxDown() {
    if (!_ctx) return;
    var ctx = _ctx; _ctx = null; document.removeEventListener('keydown', _ctxKeydown);
    if (ctx.type === 'bld') {
      _ensureBldOrders();
      var sorted = _sortedBlds();
      var idx = sorted.findIndex(function (b) { return b.id === ctx.bId; });
      if (idx < sorted.length-1) { var tmp = sorted[idx].sortOrder; sorted[idx].sortOrder = sorted[idx+1].sortOrder; sorted[idx+1].sortOrder = tmp; _persist(); }
    } else {
      _ensureFlrOrders(ctx.bId);
      var sorted = _sortedFlrs(ctx.bId);
      var idx = sorted.findIndex(function (f) { return f.id === ctx.fId; });
      if (idx < sorted.length-1) { var tmp = sorted[idx].sortOrder; sorted[idx].sortOrder = sorted[idx+1].sortOrder; sorted[idx+1].sortOrder = tmp; _persist(); }
    }
    _rerender();
  }

  function _ctxRename() {
    if (!_ctx) return;
    var ctx = _ctx; _ctx = null; document.removeEventListener('keydown', _ctxKeydown);
    if (ctx.type === 'bld') {
      var b = _findBld(ctx.bId); if (!b) { _rerender(); return; }
      var name = prompt('Renommer le bâtiment :', b.name);
      if (name && name.trim() && name.trim() !== b.name) { b.name = name.trim(); _persist(); }
    } else {
      var f = _findFlr(ctx.bId, ctx.fId); if (!f) { _rerender(); return; }
      var name = prompt('Renommer l\'étage :', f.name);
      if (name && name.trim() && name.trim() !== f.name) { f.name = name.trim(); _persist(); }
    }
    _rerender();
  }

  function _ctxDelete() {
    if (!_ctx) return;
    var ctx = _ctx; _ctx = null; document.removeEventListener('keydown', _ctxKeydown);
    _rerender();
    if (ctx.type === 'bld') _deleteBuilding(ctx.bId);
    else _deleteFloor(ctx.bId, ctx.fId);
  }

  function _tplCtxMenu() {
    if (!_ctx) return '';
    var x = _ctx.x, y = _ctx.y;
    if (x + 210 > window.innerWidth - 8)   x = window.innerWidth  - 210 - 8;
    if (y + 150 > window.innerHeight - 8) y = window.innerHeight - 150 - 8;
    return '<div class="mxrl-ctx-backdrop" onclick="MX.Pages.MxRoomList._closeCtx()"></div>'
      + '<div class="mxrl-ctx" style="left:' + x + 'px;top:' + y + 'px">'
      + '<button class="mxrl-ctx-item" onclick="MX.Pages.MxRoomList._ctxUp()"><i class="fa-solid fa-arrow-up"></i> Monter</button>'
      + '<button class="mxrl-ctx-item" onclick="MX.Pages.MxRoomList._ctxDown()"><i class="fa-solid fa-arrow-down"></i> Descendre</button>'
      + '<div class="mxrl-ctx-sep"></div>'
      + '<button class="mxrl-ctx-item" onclick="MX.Pages.MxRoomList._ctxRename()"><i class="fa-regular fa-pen-to-square"></i> Renommer</button>'
      + '<div class="mxrl-ctx-sep"></div>'
      + '<button class="mxrl-ctx-item mxrl-ctx-item--danger" onclick="MX.Pages.MxRoomList._ctxDelete()"><i class="fa-regular fa-trash"></i> Supprimer</button>'
      + '</div>';
  }

  // ── RENDER ENTRY ──────────────────────────────────────────────────────────
  function render() {
    _loadLists();
    if (_curListId && _curList) _renderDocV2();
    else _renderHome();
  }

  function _rerender() {
    if (_dnd) return;
    var mc = document.getElementById('main-content');
    if (!mc) return;
    if (_curListId && _curList) _renderDocV2();
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
      h += '<div class="mxrl-home-empty"><i class="fa-solid fa-hotel"></i>';
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
        h += '<div class="mxrl-home-card-prog"><div class="mxrl-pbar"><div class="mxrl-pbar-fill" style="width:' + st.pct + '%"></div></div><span class="mxrl-home-card-pct">' + st.pct + '%</span></div>';
        h += '<div class="mxrl-home-card-stats">';
        h += '<span class="mxrl-s-fait"><i class="fa-solid fa-circle-check"></i> ' + st.fait + '</span>';
        if (st.ocp)   h += '<span class="mxrl-s-ocp"><i class="fa-solid fa-triangle-exclamation"></i> ' + st.ocp + '</span>';
        if (st.aucun) h += '<span class="mxrl-s-aucun"><i class="fa-regular fa-circle"></i> ' + st.aucun + '</span>';
        h += '</div></div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    if (_showCreate)  h += _tplCreateModal();
    if (_dupVisible)  h += _tplDupModal();
    mc.innerHTML = h;
  }

  // ── DOC V2 ────────────────────────────────────────────────────────────────
  function _renderDocV2() {
    var mc = document.getElementById('main-content');
    if (!mc) return;
    var list   = _curList;
    var st     = _calcStats(list.buildings || []);
    var floors = _allFloors();
    var e = _e;

    var h = '<div class="mxrl-v2-page">';

    // Header
    h += '<div class="mxrl-v2-header">';
    h += '<div class="mxrl-v2-header-left">';
    h += '<button class="mxrl-v2-back" onclick="MX.Pages.MxRoomList._closeList()"><i class="fa-solid fa-arrow-left"></i></button>';
    h += '<div><div class="mxrl-v2-title">' + e(list.title || 'Liste de chambres') + '</div>';
    h += '<div class="mxrl-v2-subtitle">' + floors.length + ' étage' + (floors.length !== 1 ? 's' : '') + ' · ' + st.total + ' chambres</div></div>';
    h += '</div>';
    h += '<div class="mxrl-v2-header-right">';
    if (_isAdmin()) {
      h += '<button class="mxrl-v2-admin-btn" onclick="MX.Pages.MxRoomList._openAdmin()" title="Gérer la structure"><i class="fa-solid fa-sliders"></i></button>';
    }
    h += '<button class="mxrl-v2-dup-btn" onclick="MX.Pages.MxRoomList._showDupCur()" title="Dupliquer"><i class="fa-regular fa-copy"></i></button>';
    h += '</div></div>';

    // Stats bar
    h += _tplStatsBarV2(st);

    // Floor selector
    h += _tplFloorSelectorV2(floors);

    // Filter pills
    h += _tplFilterPillsV2(floors);

    // Room grid
    h += _tplRoomGridV2(floors);

    h += '</div>';

    if (_showPaste)  h += _tplPasteModal();
    if (_dupVisible) h += _tplDupModal();
    if (_showAdmin) h += _tplAdminModal();
    if (_ctx)       h += _tplCtxMenu();

    mc.innerHTML = h;
  }

  function _tplStatsBarV2(st) {
    var faitPct = _pct(st.fait, st.total);
    var ocpPct  = _pct(st.ocp, st.total);
    var restPct = _pct(st.aucun, st.total);
    var h = '<div class="mxrl-v2-stats">';
    h += '<div class="mxrl-v2-stat"><span class="mxrl-v2-stat-n" id="mxrl-g-total">' + st.total + '</span><span class="mxrl-v2-stat-l">Total</span></div>';
    h += '<div class="mxrl-v2-stat mxrl-v2-stat--fait"><span class="mxrl-v2-stat-n" id="mxrl-g-fait">' + st.fait + '</span><span class="mxrl-v2-stat-pct" id="mxrl-g-fait-pct">' + faitPct + '%</span><span class="mxrl-v2-stat-l">FAIT</span></div>';
    h += '<div class="mxrl-v2-stat mxrl-v2-stat--ocp"><span class="mxrl-v2-stat-n" id="mxrl-g-ocp">' + st.ocp + '</span><span class="mxrl-v2-stat-pct" id="mxrl-g-ocp-pct">' + ocpPct + '%</span><span class="mxrl-v2-stat-l">OCP</span></div>';
    h += '<div class="mxrl-v2-stat mxrl-v2-stat--rest"><span class="mxrl-v2-stat-n" id="mxrl-g-rest">' + st.aucun + '</span><span class="mxrl-v2-stat-pct" id="mxrl-g-rest-pct">' + restPct + '%</span><span class="mxrl-v2-stat-l">Restantes</span></div>';
    h += '<div class="mxrl-v2-stat mxrl-v2-stat--pbar">';
    h += '<div class="mxrl-v2-pbar">'
      + '<div class="mxrl-v2-pbar-fait" id="mxrl-g-bar" style="width:' + st.pct + '%"></div>'
      + '<div class="mxrl-v2-pbar-ocp" style="width:' + ocpPct + '%"></div>'
      + '</div>';
    h += '<span class="mxrl-v2-pct" id="mxrl-g-pct">' + st.pct + '%</span>';
    h += '</div></div>';
    return h;
  }

  function _tplFloorSelectorV2(floors) {
    var e = _e;
    var h = '<div class="mxrl-v2-floor-sel">';
    if (!floors.length) {
      h += '<div class="mxrl-v2-floor-empty">Aucun étage — gérez la structure via <i class="fa-solid fa-sliders"></i></div>';
    } else if (floors.length <= 10) {
      floors.forEach(function (fl) {
        var key    = fl.bId + '|' + fl.fId;
        var active = _curFloorKey === key;
        var fs     = _calcFlrStats(fl.flr);
        var ambig  = floors.filter(function (f2) { return f2.fName === fl.fName; }).length > 1;
        h += '<button class="mxrl-v2-floor-chip' + (active ? ' active' : '') + '" onclick="MX.Pages.MxRoomList._selFloorKey(\'' + e(key) + '\')">';
        h += e(fl.fName);
        if (ambig) h += ' <span class="mxrl-v2-chip-bld">· ' + e(fl.bName) + '</span>';
        h += ' <span class="mxrl-v2-chip-cnt">' + fs.total + '</span>';
        h += '</button>';
      });
    } else {
      h += '<select class="mxrl-v2-floor-select" onchange="MX.Pages.MxRoomList._selFloorKey(this.value)">';
      floors.forEach(function (fl) {
        var key   = fl.bId + '|' + fl.fId;
        var ambig = floors.filter(function (f2) { return f2.fName === fl.fName; }).length > 1;
        var label = ambig ? fl.fName + ' (' + fl.bName + ')' : fl.fName;
        h += '<option value="' + e(key) + '"' + (_curFloorKey === key ? ' selected' : '') + '>' + e(label) + '</option>';
      });
      h += '</select>';
    }
    h += '</div>';
    return h;
  }

  function _tplFilterPillsV2(floors) {
    var st = { total: 0, fait: 0, ocp: 0, aucun: 0 };
    if (_curFloorKey) {
      var ref = _floorFromKey(_curFloorKey);
      var f = _findFlr(ref.bId, ref.fId);
      if (f) st = _calcFlrStats(f);
    }
    var pills = [
      { key: 'all',       label: 'Toutes',    count: st.total },
      { key: 'fait',      label: 'FAIT',      count: st.fait },
      { key: 'ocp',       label: 'OCP',       count: st.ocp },
      { key: 'restantes', label: 'Restantes', count: st.aucun },
    ];
    var h = '<div class="mxrl-v2-pills">';
    pills.forEach(function (p) {
      h += '<button class="mxrl-v2-pill mxrl-v2-pill--' + p.key + (_filterPill === p.key ? ' active' : '') + '" onclick="MX.Pages.MxRoomList._setFilter(\'' + p.key + '\')">'
        + p.label + ' <span class="mxrl-v2-pill-cnt">' + p.count + '</span></button>';
    });
    h += '</div>';
    return h;
  }

  function _tplRoomGridV2(floors) {
    if (!_curFloorKey) {
      if (!floors.length) return '<div class="mxrl-v2-empty"><i class="fa-solid fa-hotel"></i><p>Aucun étage défini.</p></div>';
      return '<div class="mxrl-v2-empty"><i class="fa-solid fa-door-open"></i><p>Sélectionnez un étage ci-dessus.</p></div>';
    }
    var ref = _floorFromKey(_curFloorKey);
    var f = _findFlr(ref.bId, ref.fId);
    if (!f) return '<div class="mxrl-v2-empty"><i class="fa-solid fa-door-open"></i><p>Étage introuvable.</p></div>';
    var allRooms = _sortedRooms((f.rooms || []).filter(function (r) { return !r.disabled; }));
    var filtered = allRooms.filter(function (r) {
      var s = r.status || 'aucun';
      if (_filterPill === 'all')       return true;
      if (_filterPill === 'fait')      return s === 'fait';
      if (_filterPill === 'ocp')       return s === 'ocp';
      if (_filterPill === 'restantes') return s !== 'fait' && s !== 'ocp';
      return true;
    });
    var disabled = _isAdmin() ? _sortedRooms((f.rooms || []).filter(function (r) { return r.disabled; })) : [];
    var e = _e;
    var h = '<div class="mxrl-v2-body">';
    if (!allRooms.length) {
      h += '<div class="mxrl-v2-empty">'
        + '<i class="fa-solid fa-door-open"></i>'
        + '<p>Aucune chambre dans cet étage.</p>';
      if (_isAdmin()) h += '<button class="mxrl-v2-import-btn" onclick="MX.Pages.MxRoomList._openPasteFloor(\'' + e(ref.bId) + '\',\'' + e(ref.fId) + '\')"><i class="fa-solid fa-file-import"></i> Importer</button>';
      h += '</div>';
    } else if (!filtered.length) {
      h += '<div class="mxrl-v2-empty"><i class="fa-solid fa-filter"></i><p>Aucune chambre pour ce filtre.</p></div>';
    } else {
      h += '<div class="mxrl-v2-grid">';
      filtered.forEach(function (r) {
        h += _roomRowV2HTML(ref.bId, ref.fId, r, !!_expandedRoom[r.id]);
      });
      h += '</div>';
    }
    if (disabled.length) {
      h += '<div class="mxrl-v2-disabled-sec">';
      h += '<div class="mxrl-v2-disabled-hdr"><i class="fa-solid fa-ban"></i> Hors service (' + disabled.length + ')</div>';
      disabled.forEach(function (r) {
        h += '<div class="mxrl-v2-disabled-row">'
          + '<span class="mxrl-v2-disabled-num">' + e(r.number || '—') + '</span>'
          + '<button class="mxrl-v2-enable-btn" onclick="MX.Pages.MxRoomList._toggleDisableRoom(\'' + e(ref.bId) + '\',\'' + e(ref.fId) + '\',\'' + e(r.id) + '\')"><i class="fa-solid fa-rotate-left"></i> Réactiver</button>'
          + '</div>';
      });
      h += '</div>';
    }
    if (_isAdmin() && allRooms.length) {
      h += '<div class="mxrl-v2-floor-acts">'
        + '<button class="mxrl-v2-import-btn" onclick="MX.Pages.MxRoomList._openPasteFloor(\'' + e(ref.bId) + '\',\'' + e(ref.fId) + '\')"><i class="fa-solid fa-file-import"></i> Importer des chambres</button>'
        + '</div>';
    }
    h += '</div>';
    return h;
  }

  function _roomRowV2HTML(bId, fId, r, isExp) {
    var e  = _e;
    var st = r.status || 'aucun';
    var h  = '<div class="mxrl-v2-room' + (isExp ? ' expanded' : '') + '" data-mxrl-room="' + e(r.id) + '">';
    // Main row — click anywhere except radios to toggle expand
    h += '<div class="mxrl-v2-room-row" onclick="MX.Pages.MxRoomList._toggleRoom(\'' + e(r.id) + '\')">';
    h += '<div class="mxrl-v2-room-num">' + e(r.number || '—');
    if (r.name) h += '<span class="mxrl-v2-room-name">' + e(r.name) + '</span>';
    h += '</div>';
    h += '<div class="mxrl-v2-radios" onclick="event.stopPropagation()">';
    h += '<button class="mxrl-v2-radio mxrl-v2-radio--fait' + (st === 'fait' ? ' active' : '') + '" data-bid="' + e(bId) + '" data-fid="' + e(fId) + '" data-rid="' + e(r.id) + '" onclick="MX.Pages.MxRoomList._setStatusBtn(this,\'fait\')">FAIT</button>';
    h += '<button class="mxrl-v2-radio mxrl-v2-radio--ocp'  + (st === 'ocp'  ? ' active' : '') + '" data-bid="' + e(bId) + '" data-fid="' + e(fId) + '" data-rid="' + e(r.id) + '" onclick="MX.Pages.MxRoomList._setStatusBtn(this,\'ocp\')">OCP</button>';
    h += '<button class="mxrl-v2-radio mxrl-v2-radio--def'  + (st !== 'fait' && st !== 'ocp' ? ' active' : '') + '" data-bid="' + e(bId) + '" data-fid="' + e(fId) + '" data-rid="' + e(r.id) + '" onclick="MX.Pages.MxRoomList._setStatusBtn(this,\'aucun\')">–</button>';
    h += '</div>';
    h += '<button class="mxrl-v2-chevron" onclick="event.stopPropagation();MX.Pages.MxRoomList._toggleRoom(\'' + e(r.id) + '\')"><i class="fa-solid fa-chevron-' + (isExp ? 'up' : 'down') + '"></i></button>';
    h += '</div>';
    if (isExp) {
      h += '<div class="mxrl-v2-detail">';
      if (r.changedBy) {
        h += '<div class="mxrl-v2-meta"><i class="fa-solid fa-user-check"></i> ' + e(r.changedBy);
        if (r.changedAt) h += ' · <span>' + e(r.changedAt) + '</span>';
        if (r.date)      h += ' · <span>' + e(r.date) + '</span>';
        h += '</div>';
      }
      h += '<div class="mxrl-v2-cmnt-wrap">';
      h += '<label class="mxrl-v2-cmnt-lbl"><i class="fa-regular fa-comment"></i> Commentaire</label>';
      h += '<textarea class="mxrl-v2-cmnt" placeholder="Ajouter un commentaire…" rows="2"'
        + ' data-bid="' + e(bId) + '" data-fid="' + e(fId) + '" data-rid="' + e(r.id) + '"'
        + ' oninput="MX.Pages.MxRoomList._onComment(this)">' + e(r.comment || '') + '</textarea>';
      h += '</div>';
      if (r.history && r.history.length) {
        h += '<div class="mxrl-v2-history">';
        h += '<div class="mxrl-v2-hist-title"><i class="fa-solid fa-clock-rotate-left"></i> Historique</div>';
        var hist = r.history.slice().reverse();
        hist.slice(0, 8).forEach(function (entry) {
          var hs = entry.status || 'aucun';
          h += '<div class="mxrl-v2-hist-row mxrl-v2-hist--' + e(hs) + '">'
            + '<span class="mxrl-v2-hist-st">' + (hs === 'fait' ? 'FAIT' : hs === 'ocp' ? 'OCP' : '—') + '</span>'
            + '<span class="mxrl-v2-hist-by">' + e(entry.changedBy || '') + '</span>'
            + '<span class="mxrl-v2-hist-at">' + e(entry.changedAt || '') + (entry.date ? ' · ' + e(entry.date) : '') + '</span>'
            + '</div>';
        });
        h += '</div>';
      }
      if (_isAdmin()) {
        h += '<div class="mxrl-v2-room-admin">';
        h += '<button class="mxrl-v2-act-btn" onclick="MX.Pages.MxRoomList._renameRoom(\'' + e(bId) + '\',\'' + e(fId) + '\',\'' + e(r.id) + '\')"><i class="fa-regular fa-pen-to-square"></i> Renommer</button>';
        h += '<button class="mxrl-v2-act-btn mxrl-v2-act-btn--warn" onclick="MX.Pages.MxRoomList._toggleDisableRoom(\'' + e(bId) + '\',\'' + e(fId) + '\',\'' + e(r.id) + '\')"><i class="fa-solid fa-ban"></i> Hors service</button>';
        h += '<button class="mxrl-v2-act-btn mxrl-v2-act-btn--danger" onclick="MX.Pages.MxRoomList._deleteRoom(\'' + e(bId) + '\',\'' + e(fId) + '\',\'' + e(r.id) + '\')"><i class="fa-regular fa-trash"></i> Supprimer</button>';
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // ── ADMIN STRUCTURE MODAL ─────────────────────────────────────────────────
  function _tplAdminModal() {
    var e    = _e;
    var blds = _sortedBlds();
    var h    = '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._closeAdmin()">';
    h += '<div class="mxrl-modal mxrl-modal--wide" onclick="event.stopPropagation()">';
    h += '<div class="mxrl-modal-hdr"><h3><i class="fa-solid fa-sliders"></i> Gérer la structure</h3>'
      + '<button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._closeAdmin()"><i class="fa-solid fa-xmark"></i></button></div>';
    h += '<div class="mxrl-modal-body" style="max-height:60vh;overflow-y:auto">';
    h += '<div class="mxrl-admin-tree">';
    if (!blds.length) {
      h += '<div class="mxrl-v2-empty" style="padding:24px"><i class="fa-solid fa-building"></i><p>Aucun bâtiment. Créez-en un ci-dessous.</p></div>';
    }
    blds.forEach(function (b) {
      var isExp = !!_adminExpanded[b.id];
      h += '<div class="mxrl-admin-bld" data-bid="' + e(b.id) + '">';
      h += '<div class="mxrl-admin-bld-row" oncontextmenu="MX.Pages.MxRoomList._openCtx(event,\'bld\',\'' + e(b.id) + '\')">';
      h += '<span class="mxrl-drag-handle mxrl-drag-handle--sm" data-dtype="bld" data-bid="' + e(b.id) + '" onpointerdown="MX.Pages.MxRoomList._dndDown(event,this)" onclick="event.stopPropagation()"><i class="fa-solid fa-grip-vertical"></i></span>';
      h += '<button class="mxrl-caret" onclick="MX.Pages.MxRoomList._toggleAdmin(\'' + e(b.id) + '\')"><i class="fa-solid fa-chevron-' + (isExp ? 'down' : 'right') + '"></i></button>';
      h += '<i class="fa-solid fa-building mxrl-tree-ico"></i>';
      h += '<span class="mxrl-admin-name">' + e(b.name) + '</span>';
      h += '<div class="mxrl-admin-acts">'
        + '<button class="mxrl-admin-act" onclick="MX.Pages.MxRoomList._addFloor(\'' + e(b.id) + '\')" title="Ajouter un étage"><i class="fa-solid fa-plus"></i></button>'
        + '<button class="mxrl-admin-act mxrl-admin-act--del" onclick="MX.Pages.MxRoomList._deleteBuilding(\'' + e(b.id) + '\')" title="Supprimer"><i class="fa-regular fa-trash"></i></button>'
        + '</div></div>';
      if (isExp) {
        h += '<div class="mxrl-admin-floors">';
        var flrs = _sortedFlrs(b.id);
        flrs.forEach(function (f) {
          h += '<div class="mxrl-admin-flr" data-fid="' + e(f.id) + '" oncontextmenu="MX.Pages.MxRoomList._openCtx(event,\'flr\',\'' + e(b.id) + '\',\'' + e(f.id) + '\')">';
          h += '<span class="mxrl-drag-handle mxrl-drag-handle--sm" data-dtype="flr" data-bid="' + e(b.id) + '" data-fid="' + e(f.id) + '" onpointerdown="MX.Pages.MxRoomList._dndDown(event,this)" onclick="event.stopPropagation()"><i class="fa-solid fa-grip-vertical"></i></span>';
          h += '<i class="fa-solid fa-layer-group mxrl-tree-ico-sm"></i>';
          h += '<span class="mxrl-admin-name mxrl-admin-name--flr">' + e(f.name) + '</span>';
          h += '<span class="mxrl-admin-cnt">' + (f.rooms || []).length + ' ch.</span>';
          h += '<div class="mxrl-admin-acts">'
            + '<button class="mxrl-admin-act" onclick="MX.Pages.MxRoomList._openPasteFloor(\'' + e(b.id) + '\',\'' + e(f.id) + '\')" title="Importer chambres"><i class="fa-regular fa-clipboard"></i></button>'
            + '<button class="mxrl-admin-act mxrl-admin-act--del" onclick="MX.Pages.MxRoomList._deleteFloor(\'' + e(b.id) + '\',\'' + e(f.id) + '\')" title="Supprimer étage"><i class="fa-regular fa-trash"></i></button>'
            + '</div></div>';
        });
        if (!flrs.length) h += '<div class="mxrl-admin-empty">Aucun étage · <a onclick="MX.Pages.MxRoomList._addFloor(\'' + e(b.id) + '\')">Ajouter</a></div>';
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div></div>';
    h += '<div class="mxrl-modal-foot">'
      + '<button class="mxrl-btn-outline" onclick="MX.Pages.MxRoomList._addBuilding()"><i class="fa-solid fa-plus"></i> Bâtiment</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._closeAdmin()"><i class="fa-solid fa-check"></i> Fermer</button>'
      + '</div></div></div>';
    return h;
  }

  // ── MODALS ────────────────────────────────────────────────────────────────
  function _tplCreateModal() {
    var e = _e;
    return '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._hideCreate()">'
      + '<div class="mxrl-modal" onclick="event.stopPropagation()">'
      + '<div class="mxrl-modal-hdr"><h3><i class="fa-solid fa-hotel"></i> Nouvelle liste</h3><button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._hideCreate()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxrl-modal-body"><label class="mxrl-label">Nom du document</label>'
      + '<input class="mxrl-input" type="text" placeholder="Ex: Liste chambres vierges" value="' + e(_createTitle) + '" oninput="MX.Pages.MxRoomList._setCreateTitle(this.value)" autofocus></div>'
      + '<div class="mxrl-modal-foot"><button class="mxrl-btn-cancel" onclick="MX.Pages.MxRoomList._hideCreate()">Annuler</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._confirmCreate()"><i class="fa-solid fa-check"></i> Créer</button>'
      + '</div></div></div>';
  }

  function _tplPasteModal() {
    var e    = _e;
    var b    = _pasteTarget && _findBld(_pasteTarget.bId);
    var f    = _pasteTarget && _findFlr(_pasteTarget.bId, _pasteTarget.fId);
    var dest = (b && f) ? (e(b.name) + ' › ' + e(f.name)) : '';
    return '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._hidePaste()">'
      + '<div class="mxrl-modal" onclick="event.stopPropagation()">'
      + '<div class="mxrl-modal-hdr"><h3><i class="fa-regular fa-clipboard"></i> Importer des chambres</h3><button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._hidePaste()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxrl-modal-body">'
      + (dest ? '<div class="mxrl-paste-dest"><i class="fa-solid fa-layer-group"></i> Destination : <strong>' + dest + '</strong></div>' : '')
      + '<label class="mxrl-label">Liste de chambres (une par ligne)</label>'
      + '<textarea class="mxrl-textarea" placeholder="101&#10;102&#10;103&#10;..." rows="10" oninput="MX.Pages.MxRoomList._setPasteText(this.value)">' + e(_pasteText) + '</textarea>'
      + '<p class="mxrl-paste-hint"><i class="fa-solid fa-lightbulb"></i> Collez depuis Excel. Une ligne = une chambre.</p>'
      + '</div>'
      + '<div class="mxrl-modal-foot"><button class="mxrl-btn-cancel" onclick="MX.Pages.MxRoomList._hidePaste()">Annuler</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._confirmPaste()"><i class="fa-solid fa-file-import"></i> Importer</button>'
      + '</div></div></div>';
  }

  function _tplDupModal() {
    var e   = _e;
    var src = _lists.find(function (l) { return l.id === _dupSrcId; });
    var opts = [
      { k: 'blds',  v: _dupKeepBlds,    l: 'Conserver les bâtiments' },
      { k: 'floors',v: _dupKeepFloors,  l: 'Conserver les étages' },
      { k: 'rooms', v: _dupKeepRooms,   l: 'Conserver les chambres' },
      { k: 'reset', v: _dupResetStatus, l: 'Réinitialiser les statuts' },
    ];
    return '<div class="mxrl-overlay" onclick="MX.Pages.MxRoomList._hideDupModal()">'
      + '<div class="mxrl-modal" onclick="event.stopPropagation()">'
      + '<div class="mxrl-modal-hdr"><h3><i class="fa-regular fa-copy"></i> Dupliquer la liste</h3><button class="mxrl-modal-x" onclick="MX.Pages.MxRoomList._hideDupModal()"><i class="fa-solid fa-xmark"></i></button></div>'
      + '<div class="mxrl-modal-body">'
      + (src ? '<div class="mxrl-dup-src"><i class="fa-solid fa-hotel"></i> ' + e(src.title || 'Sans titre') + '</div>' : '')
      + '<label class="mxrl-label">Nom du nouveau document</label>'
      + '<input class="mxrl-input" type="text" value="' + e(_dupTitle) + '" oninput="MX.Pages.MxRoomList._setDupTitle(this.value)">'
      + '<div class="mxrl-dup-opts">'
      + opts.map(function (o) {
        return '<label class="mxrl-dup-opt"><input type="checkbox" ' + (o.v ? 'checked' : '') + ' data-dk="' + o.k + '" onchange="MX.Pages.MxRoomList._setDupOpt(this.dataset.dk,this.checked)"> ' + e(o.l) + '</label>';
      }).join('')
      + '</div></div>'
      + '<div class="mxrl-modal-foot"><button class="mxrl-btn-cancel" onclick="MX.Pages.MxRoomList._hideDupModal()">Annuler</button>'
      + '<button class="mxrl-btn-primary" onclick="MX.Pages.MxRoomList._confirmDup()"><i class="fa-regular fa-copy"></i> Dupliquer</button>'
      + '</div></div></div>';
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  function _openById(id)   { _openList(id); }
  function _deleteById(id) { _deleteList(id); }

  function _closeList() {
    if (_listUnsub) { _listUnsub(); _listUnsub = null; }
    _curListId = null; _curList = null;
    _curFloorKey = null; _filterPill = 'all'; _expandedRoom = {};
    _rerender();
  }

  function _selFloorKey(key) { _curFloorKey = key; _filterPill = 'all'; _expandedRoom = {}; _rerender(); }
  function _setFilter(pill)  { _filterPill = pill; _rerender(); }

  function _toggleRoom(rId) {
    _expandedRoom[rId] = !_expandedRoom[rId];
    if (_curFloorKey) {
      var ref = _floorFromKey(_curFloorKey);
      var r   = _findRoom(ref.bId, ref.fId, rId);
      if (r) {
        var rowEl = document.querySelector('[data-mxrl-room="' + rId + '"]');
        if (rowEl) { rowEl.outerHTML = _roomRowV2HTML(ref.bId, ref.fId, r, !!_expandedRoom[rId]); return; }
      }
    }
    _rerender();
  }

  function _setStatusBtn(btn, status) {
    _setStatus(btn.dataset.bid, btn.dataset.fid, btn.dataset.rid, status);
  }

  function _onComment(el) {
    _setComment(el.dataset.bid, el.dataset.fid, el.dataset.rid, el.value);
  }

  function _openAdmin()       { _showAdmin = true; _rerender(); }
  function _closeAdmin()      { _showAdmin = false; _ctx = null; _rerender(); }
  function _toggleAdmin(bId)  { _adminExpanded[bId] = !_adminExpanded[bId]; _rerender(); }

  function _showCreate2() { _showCreate = true; _rerender(); }
  function _hideCreate()  { _showCreate = false; _rerender(); }
  function _setCreateTitle(v) { _createTitle = v; }
  function _confirmCreate() {
    if (!_createTitle.trim()) { _notify('Saisissez un nom', true); return; }
    _createList(_createTitle);
  }

  function _openPasteFloor(bId, fId) { _pasteTarget = { bId: bId, fId: fId }; _pasteText = ''; _showPaste = true; _rerender(); }
  function _hidePaste()    { _showPaste = false; _pasteText = ''; _rerender(); }
  function _setPasteText(v) { _pasteText = v; }
  function _confirmPaste() {
    if (!_pasteTarget) { _notify('Sélectionnez un étage de destination', true); return; }
    if (!_pasteText.trim()) { _notify('Collez au moins une chambre', true); return; }
    _addRooms(_pasteTarget.bId, _pasteTarget.fId, _pasteText);
    _showPaste = false; _pasteText = ''; _pasteTarget = null;
  }

  function _showDupCur() {
    if (_curListId) _showDup(_curListId);
  }

  function _showDup(id) {
    _dupSrcId = id;
    var src = _lists.find(function (l) { return l.id === id; });
    _dupTitle = src ? (src.title + ' (copie)') : '';
    _dupKeepBlds = true; _dupKeepFloors = true; _dupKeepRooms = true; _dupResetStatus = true;
    _dupVisible = true; _rerender();
  }
  function _hideDupModal() { _dupVisible = false; _dupSrcId = null; _rerender(); }
  function _setDupTitle(v) { _dupTitle = v; }
  function _setDupOpt(key, val) {
    if (key === 'blds')  _dupKeepBlds    = val;
    else if (key === 'floors') _dupKeepFloors  = val;
    else if (key === 'rooms')  _dupKeepRooms   = val;
    else if (key === 'reset')  _dupResetStatus = val;
  }
  function _confirmDup() { _execDuplicate(); }

  // ── DESTROY ───────────────────────────────────────────────────────────────
  function _destroy() {
    if (_listsUnsub) { _listsUnsub(); _listsUnsub = null; }
    if (_listUnsub)  { _listUnsub();  _listUnsub = null; }
    if (_saveTimer)  { clearTimeout(_saveTimer); _saveTimer = null; }
    document.removeEventListener('keydown', _ctxKeydown);
    document.removeEventListener('pointermove', _dndMove);
    document.removeEventListener('pointerup',   _dndUp);
    document.removeEventListener('pointercancel', _dndUp);
    _loaded = false; _lists = []; _curListId = null; _curList = null; _dnd = null; _ctx = null;
  }

  // ── EXPORTS ───────────────────────────────────────────────────────────────
  window.MX.Pages.MxRoomList = {
    render,
    _destroy,
    _openById,
    _deleteById,
    _closeList,
    _selFloorKey,
    _setFilter,
    _toggleRoom,
    _setStatusBtn,
    _onComment,
    _renameRoom,
    _toggleDisableRoom,
    _addBuilding,
    _addFloor,
    _deleteBuilding,
    _deleteFloor,
    _deleteRoom,
    _openAdmin,
    _closeAdmin,
    _toggleAdmin,
    _showCreate: _showCreate2,
    _hideCreate,
    _setCreateTitle,
    _confirmCreate,
    _openPasteFloor,
    _hidePaste,
    _setPasteText,
    _confirmPaste,
    _showDupCur,
    _showDup,
    _hideDupModal,
    _setDupTitle,
    _setDupOpt,
    _confirmDup,
    _dndDown,
    _openCtx,
    _closeCtx,
    _ctxUp,
    _ctxDown,
    _ctxRename,
    _ctxDelete,
  };
})();
