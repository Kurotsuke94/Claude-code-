(function () {
  'use strict';

  var FV = firebase.firestore.FieldValue;

  // ── UI state ──
  var _activeTab      = 'checklist'; // 'checklist' | 'intervention' | 'pmp'
  var _curFilter      = 'all';
  var _pendingPhKey   = null;
  var _pendingSignal  = null;
  var _activeFilter   = 'all';    // 'all' | 'urgent' | 'retard' | 'done' | 'todo'
  var _searchQuery    = '';
  var _pmpSubTab      = 'today';  // 'today' | 'upcoming' | 'inprogress' | 'urgent'
  var _upcomingRange  = 7;        // 7 | 15 | 30
  var _lastConfettiAt = 0;

  // ── Mission state (dual Firestore listener) ──
  var _allMissions         = []; // merged result
  var _assignedMissions    = []; // where assignedTo == cu.name
  var _unassignedPmpMissions = []; // where assignedTo == null AND isPmp
  var _missionsLoaded      = false;
  var _missionsUnsub       = null;
  var _pmpMissionsUnsub    = null;

  // ── Photo state ──
  var _pendingPmpPh = null;

  // ── Notification tracking ──
  var _seenIds = null;

  // ── Type colors ──
  var TC = {
    checklist:    '#22c55e',
    intervention: '#3b82f6',
    pmp:          '#a855f7',
    urgence:      '#ef4444',
  };

  var SLOT_INFO = {
    matin:   { l: 'Matin',       sub: 'avant 13h',     icon: '☀️',  time: '08:00', order: 1 },
    journee: { l: 'Après-midi',  sub: '13h – 18h',     icon: '🌤',  time: '13:00', order: 2 },
    soir:    { l: 'Soir',        sub: 'fin de service', icon: '🌙',  time: '18:00', order: 3 },
  };

  // ══════════════════════════════════════════════
  // NOTIFICATION SYSTEM (localStorage)
  // ══════════════════════════════════════════════

  function _seenKey() {
    var cu = MX.state.currentUser;
    return 'mm_seen_' + (cu ? cu.name.replace(/\s/g, '_') : 'guest');
  }

  function _loadSeenIds() {
    if (_seenIds) return;
    try {
      var raw = localStorage.getItem(_seenKey());
      _seenIds = new Set(raw ? JSON.parse(raw) : []);
    } catch (e) { _seenIds = new Set(); }
  }

  function _saveSeenIds() {
    try { localStorage.setItem(_seenKey(), JSON.stringify(Array.from(_seenIds))); } catch (e) {}
  }

  function _markTabSeen(type) {
    _loadSeenIds();
    _allMissions.forEach(function (m) {
      if (type === 'all') { _seenIds.add(m.id); return; }
      var mt = m.isPmp ? 'pmp' : (m.missionType || 'intervention');
      if (mt === type) _seenIds.add(m.id);
    });
    _saveSeenIds();
  }

  function _isNew(id) {
    _loadSeenIds();
    return !_seenIds.has(id);
  }

  // ══════════════════════════════════════════════
  // FIRESTORE LISTENER (single, unified)
  // ══════════════════════════════════════════════

  function _mergeAllMissions() {
    var seen = {};
    var result = [];
    _assignedMissions.forEach(function (m) { seen[m.id] = true; result.push(m); });
    _unassignedPmpMissions.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = true; result.push(m); } });
    _allMissions = result;
  }

  function _rerenderIfActive() {
    if (!MX.Auth.canSeeAll() && MX.state.currentUser) {
      var el = document.getElementById('main-content');
      if (el && !document.getElementById('pmp-detail-ov') && !document.getElementById('mm-detail-ov')) {
        el.innerHTML = _renderTech();
      }
    }
  }

  function _loadMissions() {
    if (_missionsLoaded) return;
    var cu = MX.state.currentUser;
    if (!cu || !cu.name) return;
    _missionsLoaded = true;

    // Listener 1: missions explicitly assigned to this tech
    _missionsUnsub = db.collection('missions')
      .where('assignedTo', '==', cu.name)
      .onSnapshot(function (snap) {
        _assignedMissions = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        _mergeAllMissions();
        _rerenderIfActive();
      }, function (err) { console.warn('[MM] missions listener:', err.message); });

    // Listener 2: unassigned PMP missions visible to all techs
    _pmpMissionsUnsub = db.collection('missions')
      .where('assignedTo', '==', null)
      .onSnapshot(function (snap) {
        _unassignedPmpMissions = snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        }).filter(function (m) {
          return !m.done && (m.isPmp || m.missionType === 'pmp' || m.category === 'pmp');
        });
        _mergeAllMissions();
        _rerenderIfActive();
      }, function (err) { console.warn('[MM] unassigned-pmp listener:', err.message); });
  }

  // ══════════════════════════════════════════════
  // TASK BUILDING
  // ══════════════════════════════════════════════

  function _getChecklistTasks() {
    var state   = MX.state;
    var todayId = MX.todayId();
    var cu      = state.currentUser;
    if (!cu) return [];
    var slots  = MX.getDaySlots(todayId) || ['matin', 'journee', 'soir'];
    var result = [];

    slots.forEach(function (slot) {
      var key    = todayId + '_' + slot;
      var tasks  = state.tasks[key] || [];
      var claims = state.dailyClaims || {};
      var slotAssignee = (claims[slot] && claims[slot].name) || state.assignments[key] || '';
      var si = SLOT_INFO[slot] || { order: 9 };

      tasks.forEach(function (task) {
        var mine = task.assignedTo === cu.name || (!task.assignedTo && slotAssignee === cu.name);
        var unassigned = !task.assignedTo && !slotAssignee;
        if (!mine && !unassigned) return;
        var ck = key + '_' + task.id;
        result.push({
          id:          task.id,
          text:        task.text || '',
          desc:        task.description || '',
          priority:    task.priority || 'normale',
          slot:        slot,
          dayId:       todayId,
          checkKey:    ck,
          done:        !!(state.checks[ck]),
          note:        (state.notes && state.notes[ck]) || '',
          fromUser:    null,
          mine:        mine,
          unassigned:  unassigned,
          missionType: 'checklist',
          accepted:    true,
          zone:        task.zone || '',
          subZone:     task.subZone || '',
          estimatedDuration: task.estimatedDuration || '',
          dueDate:     todayId,
          sortOrder:   si.order,
        });
      });
    });

    (state.transfers || []).forEach(function (tr) {
      if (tr.toUser !== cu.name || tr.status !== 'accepted' || tr.dayId !== todayId) return;
      var ck = tr.dayId + '_' + tr.slot + '_' + tr.taskId;
      if (result.some(function (t) { return t.checkKey === ck; })) return;
      var si = SLOT_INFO[tr.slot] || { order: 9 };
      result.push({
        id: tr.taskId, text: tr.taskText || '', desc: '', priority: 'normale',
        slot: tr.slot, dayId: tr.dayId, checkKey: ck,
        done: !!(state.checks[ck]), note: '', fromUser: tr.fromUser,
        mine: true, unassigned: false,
        missionType: 'checklist', accepted: true,
        dueDate: tr.dayId, sortOrder: si.order,
      });
    });

    return result;
  }

  function _getAllTasks(checklistTasks) {
    var todayId = MX.todayId();
    var firestoreTasks = _allMissions
      .filter(function (m) {
        var dayId = m.dayId || '';
        if (dayId > todayId) return false; // skip future
        return true;
      })
      .map(function (m) {
        var isPmp = m.isPmp || m.missionType === 'pmp';
        var type  = isPmp ? 'pmp' : (m.missionType || 'intervention');
        var pd    = m.pmpData || {};
        return {
          id:               m.id,
          firestoreId:      m.id,
          text:             m.text || (isPmp ? (pd.equipmentName || '') : ''),
          desc:             m.description || '',
          priority:         m.priority || 'normale',
          slot:             type,
          dayId:            m.dayId || todayId,
          checkKey:         type + '_' + m.id,
          done:             !!m.done,
          note:             '',
          mine:             true,
          unassigned:       false,
          fromUser:         null,
          missionType:      type,
          accepted:         m.accepted !== undefined ? m.accepted : true,
          zone:             (isPmp ? pd.zone : m.zone) || '',
          subZone:          (isPmp ? pd.subZone : m.subZone) || '',
          estimatedDuration: (isPmp ? pd.estimatedDuration : m.estimatedDuration) || '',
          dueDate:          (isPmp ? pd.dueDate : m.dueDate) || m.dayId || '',
          sortOrder:        10,
          // PMP fields
          isPmp:            isPmp,
          missionId:        m.id,
          pmpData:          pd,
          pmpIntId:         m.pmpIntId || '',
          completedChecklist: m.completedChecklist || {},
          takenBy:          m.takenBy || null,
          takenAt:          m.takenAt || null,
          observations:     m.observations || '',
          photoAvant:       m.photoAvant || null,
          photoPendant:     m.photoPendant || null,
          photoApres:       m.photoApres || null,
          pmpComments:      m.pmpComments || [],
          // Intervention fields
          usedParts:               m.usedParts || [],
          interventionComments:    m.interventionComments || [],
          interventionHistory:     m.interventionHistory || [],
        };
      });

    return checklistTasks.concat(firestoreTasks);
  }

  // ══════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════

  function _addDaysMM(ds, n) {
    var d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function _fmtDur(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return (h ? h + 'h' : '') + String(m).padStart(2, '0') + 'min' + String(s).padStart(2, '0') + 's';
  }

  function _fmtDate(ds) {
    if (!ds) return '';
    var p = ds.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ds;
  }

  // ══════════════════════════════════════════════
  // RENDER — TECHNICIAN VIEW
  // ══════════════════════════════════════════════

  function _applyFilters(tasks, todayISO) {
    var filtered = tasks;
    if (_searchQuery) {
      var q = _searchQuery.toLowerCase();
      filtered = filtered.filter(function (t) {
        return (t.text || '').toLowerCase().indexOf(q) !== -1
          || (t.desc || '').toLowerCase().indexOf(q) !== -1
          || (t.zone || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (_activeFilter === 'urgent') {
      filtered = filtered.filter(function (t) { return t.priority === 'haute' || t.priority === 'critique'; });
    } else if (_activeFilter === 'retard') {
      filtered = filtered.filter(function (t) { return t.dueDate && t.dueDate < todayISO && !t.done; });
    } else if (_activeFilter === 'done') {
      filtered = filtered.filter(function (t) { return t.done; });
    } else if (_activeFilter === 'todo') {
      filtered = filtered.filter(function (t) { return !t.done; });
    }
    return filtered;
  }

  function _confetti() {
    var now = Date.now();
    if (now - _lastConfettiAt < 5000) return;
    _lastConfettiAt = now;
    var canvas = document.getElementById('mm-confetti-canvas');
    if (!canvas) return;
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    var particles = [];
    var colors    = ['#8B5CF6','#22c55e','#f97316','#3b82f6','#ec4899','#fbbf24'];
    for (var i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        r: Math.random() * 6 + 4,
        d: Math.random() * 120 + 60,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltInc: 0.07 * (Math.random() - 0.5),
      });
    }
    var angle = 0, frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      angle += 0.01;
      frame++;
      particles.forEach(function (p) {
        p.tilt += p.tiltInc;
        p.y += (Math.cos(angle + p.d) + 1.5) * 2;
        p.x += Math.sin(angle) * 0.8;
        ctx.beginPath();
        ctx.lineWidth = p.r / 2;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
        ctx.stroke();
      });
      particles = particles.filter(function (p) { return p.y < canvas.height + 20; });
      if (particles.length > 0 && frame < 300) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
      }
    }
    draw();
  }

  function _renderTech() {
    var e       = MX.esc;
    var cu      = MX.state.currentUser;
    var today   = new Date();
    var JOURS   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    var MOIS    = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    var dateStr = JOURS[today.getDay()] + ' ' + today.getDate() + ' ' + MOIS[today.getMonth()];
    var todayISO = today.toISOString().slice(0, 10);

    _loadSeenIds();
    var checklistTasks = _getChecklistTasks();
    var allTasks       = _getAllTasks(checklistTasks);

    // Partition
    var myMissions     = allTasks.filter(function (t) { return t.mine && t.accepted !== false && !t.unassigned; });
    var newMissions    = allTasks.filter(function (t) { return t.mine && t.accepted === false && !t.done; });
    var availableTasks = checklistTasks.filter(function (t) { return t.unassigned; });

    // Stats
    var totalCount  = myMissions.length;
    var doneCount   = myMissions.filter(function (t) { return t.done; }).length;
    var todoCount   = myMissions.filter(function (t) { return !t.done; }).length;
    var urgentCount = myMissions.filter(function (t) { return t.priority === 'haute' || t.priority === 'critique'; }).length;
    var newCount    = newMissions.length;
    var pct         = totalCount ? Math.round(doneCount / totalCount * 100) : 0;
    var pctCol      = pct >= 80 ? TC.checklist : pct >= 40 ? '#f97316' : TC.intervention;

    // Tab counts
    var clCount  = myMissions.filter(function (t) { return t.missionType === 'checklist';    }).length;
    var intCount = myMissions.filter(function (t) { return t.missionType === 'intervention'; }).length;
    var pmpCount = myMissions.filter(function (t) { return t.missionType === 'pmp';          }).length;

    // Unseen badges
    var unseenInt = _allMissions.filter(function (m) {
      var mt = m.isPmp ? 'pmp' : (m.missionType || 'intervention');
      return mt === 'intervention' && !m.done && _isNew(m.id);
    }).length;
    var unseenPmp = _allMissions.filter(function (m) {
      return (m.isPmp || m.missionType === 'pmp') && !m.done && _isNew(m.id);
    }).length;

    // Hero info
    var nc    = MX.userColors ? MX.userColors(cu.name) : { bg: 'var(--cyan)', fg: '#fff' };
    var avBg  = cu.color || nc.bg;
    var avFg  = cu.color ? (MX._contrastColor ? MX._contrastColor(cu.color) : '#fff') : nc.fg;
    var inits = cu.name.substring(0, 2).toUpperCase();
    var fname = cu.name.split(' ')[0];
    var hour  = today.getHours();
    var greet = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
    var ru    = (MX.state.rewardsUsers || {})[cu.name] || {};

    var h = '<div class="mm-v3-wrap">';

    // ── Confetti canvas ─────────────────────────
    h += '<canvas id="mm-confetti-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;display:none"></canvas>';

    // ── Hero ──────────────────────────────────────
    h += '<div class="mm-v3-hero">'
      + '<div class="mm-v3-hero-av" style="background:' + avBg + ';color:' + avFg + '">' + e(inits) + '</div>'
      + '<div class="mm-v3-hero-txt">'
      + '<div class="mm-v3-hero-greet">' + e(greet) + ', <strong>' + e(fname) + '</strong> 👋</div>'
      + '<div class="mm-v3-hero-date">' + e(dateStr) + '</div>'
      + '</div>';
    if (ru.points !== undefined || ru.streak) {
      h += '<div class="mm-v3-hero-xp">';
      if (ru.rank)   h += '<div class="mm-v3-xp-rank">' + e(ru.rank) + '</div>';
      if (ru.points !== undefined) h += '<div class="mm-v3-xp-pts"><span class="mm-v3-xp-val">' + (ru.points || 0) + '</span><span class="mm-v3-xp-lbl">XP</span></div>';
      if (ru.streak) h += '<div class="mm-v3-xp-streak"><span>🔥</span><span class="mm-v3-xp-val">' + ru.streak + '</span><span class="mm-v3-xp-lbl">j</span></div>';
      h += '</div>';
    }
    h += '</div>';

    // ── Stats bar ─────────────────────────────────
    var dashFill = Math.round(pct);
    h += '<div class="mm-v3-stats">'
      + '<div class="mm-v3-stat"><span class="mm-v3-stat-val">' + totalCount + '</span><span class="mm-v3-stat-lbl">Total</span></div>'
      + '<div class="mm-v3-stat mm-v3-stat--done"><span class="mm-v3-stat-val" style="color:' + TC.checklist + '">' + doneCount + '</span><span class="mm-v3-stat-lbl">Terminées</span></div>'
      + '<div class="mm-v3-stat"><span class="mm-v3-stat-val">' + todoCount + '</span><span class="mm-v3-stat-lbl">À faire</span></div>'
      + '<div class="mm-v3-stat mm-v3-stat--urg"><span class="mm-v3-stat-val" style="color:' + TC.urgence + '">' + urgentCount + '</span><span class="mm-v3-stat-lbl">Urgentes</span></div>'
      + '<div class="mm-v3-stat mm-v3-stat--prog">'
      + '<div class="mm-v3-donut-wrap">'
      + '<svg viewBox="0 0 36 36" class="mm-v3-donut">'
      + '<circle class="mm-v3-donut-bg" cx="18" cy="18" r="15.9"/>'
      + '<circle class="mm-v3-donut-fill" cx="18" cy="18" r="15.9" style="stroke:' + pctCol + ';stroke-dasharray:' + dashFill + ' ' + (100 - dashFill) + '"/>'
      + '</svg>'
      + '<span class="mm-v3-donut-pct" style="color:' + pctCol + '">' + pct + '%</span>'
      + '</div>'
      + '<span class="mm-v3-stat-lbl">Progression</span>'
      + '</div>'
      + '</div>';

    // ── 3-Tab navigation ──────────────────────────
    var TABS = [
      { id: 'checklist',    icon: '✅', l: 'Missions',      count: clCount,  badge: 0,         col: TC.checklist    },
      { id: 'intervention', icon: '🔧', l: 'Interventions', count: intCount, badge: unseenInt, col: TC.intervention },
      { id: 'pmp',          icon: '🛠️', l: 'PMP',           count: pmpCount, badge: unseenPmp, col: TC.pmp          },
    ];
    h += '<div class="mm-v3-tabs">';
    TABS.forEach(function (tab) {
      var active = _activeTab === tab.id;
      h += '<button class="mm-v3-tab' + (active ? ' mm-v3-tab--active' : '') + '"'
        + (active ? ' style="border-bottom-color:' + tab.col + ';color:' + tab.col + '"' : '')
        + ' onclick="MX.MM.setTab(\'' + tab.id + '\')">'
        + tab.icon + ' ' + e(tab.l)
        + '<span class="mm-v3-tab-ct">' + tab.count + '</span>'
        + (tab.badge > 0 ? '<span class="mm-v3-tab-badge">' + tab.badge + '</span>' : '')
        + '</button>';
    });
    h += '</div>';

    // ── Nouvelles missions ────────────────────────
    if (newCount) {
      h += '<div class="mm-v3-new-zone">'
        + '<div class="mm-v3-new-hd"><i class="fas fa-bell"></i> '
        + newCount + ' nouvelle' + (newCount > 1 ? 's' : '') + ' mission' + (newCount > 1 ? 's' : '') + ' assignée' + (newCount > 1 ? 's' : '')
        + '</div><div class="mm-v3-new-list">';
      newMissions.forEach(function (m) { h += _newMissionCard(m); });
      h += '</div></div>';
    }

    // ── Toolbar: search + filter pills ────────────
    h += '<div class="mm-v3-toolbar">'
      + '<div class="mm-v3-search-wrap">'
      + '<i class="fas fa-magnifying-glass mm-v3-search-ico"></i>'
      + '<input class="mm-v3-search-inp" type="text" placeholder="Rechercher une mission…" value="' + e(_searchQuery) + '" oninput="MX.MM._doMmSearch(this.value)">'
      + (_searchQuery ? '<button class="mm-v3-search-clr" onclick="MX.MM._doMmSearch(\'\')" title="Effacer"><i class="fas fa-times"></i></button>' : '')
      + '</div>';
    var FILTERS = [
      { id: 'all',    l: 'Toutes'    },
      { id: 'urgent', l: 'Urgent'    },
      { id: 'retard', l: 'En retard' },
      { id: 'todo',   l: 'À faire'   },
      { id: 'done',   l: 'Terminées' },
    ];
    h += '<div class="mm-v3-filter-pills">';
    FILTERS.forEach(function (f) {
      var act = _activeFilter === f.id;
      h += '<button class="mm-v3-fp' + (act ? ' mm-v3-fp--active' : '') + '" onclick="MX.MM.setMmFilter(\'' + f.id + '\')">' + e(f.l) + '</button>';
    });
    h += '</div></div>';

    // ── Content ───────────────────────────────────
    h += '<div class="mm-v3-content">';

    if (_activeTab === 'checklist') {
      // Slot-grouped display
      var tabTasks = myMissions.filter(function (t) { return t.missionType === 'checklist'; });
      var filtered = _applyFilters(tabTasks, todayISO);

      var SLOTS = ['matin', 'journee', 'soir'];
      var hasAny = false;

      SLOTS.forEach(function (slotKey) {
        var si = SLOT_INFO[slotKey];
        var slotTasks     = tabTasks.filter(function (t) { return t.slot === slotKey; });
        var slotFiltered  = filtered.filter(function (t) { return t.slot === slotKey; });
        if (slotTasks.length === 0) return;
        hasAny = true;
        var slotDone  = slotTasks.filter(function (t) { return t.done; }).length;
        var slotTotal = slotTasks.length;
        var slotPct   = slotTotal ? Math.round(slotDone / slotTotal * 100) : 0;
        var barCol    = slotPct === 100 ? TC.checklist : slotPct >= 50 ? '#f97316' : TC.intervention;

        h += '<div class="mm-v3-slot-group">'
          + '<div class="mm-v3-slot-hd">'
          + '<span class="mm-v3-slot-icon">' + si.icon + '</span>'
          + '<span class="mm-v3-slot-name">' + e(si.l) + '</span>'
          + '<span class="mm-v3-slot-sub">' + e(si.sub) + '</span>'
          + '<div class="mm-v3-slot-prog-wrap"><div class="mm-v3-slot-prog-fill" style="width:' + slotPct + '%;background:' + barCol + '"></div></div>'
          + '<span class="mm-v3-slot-ct" style="color:' + barCol + '">' + slotDone + '/' + slotTotal + '</span>'
          + '</div>';

        if (slotFiltered.length === 0) {
          h += '<div class="mm-v3-slot-empty">Aucune tâche ne correspond aux filtres actifs.</div>';
        } else {
          h += '<div class="mm-v3-cards">';
          slotFiltered.forEach(function (task) { h += _checklistCard(task); });
          h += '</div>';
        }
        h += '</div>';
      });

      // Available unassigned
      if (availableTasks.length) {
        hasAny = true;
        h += '<div class="mm-v3-slot-group mm-v3-slot-group--avail">'
          + '<div class="mm-v3-slot-hd">'
          + '<span class="mm-v3-slot-icon">📋</span>'
          + '<span class="mm-v3-slot-name">Disponibles</span>'
          + '<span class="mm-v3-slot-sub">Non assignées</span>'
          + '<span class="mm-v3-slot-ct" style="color:var(--text3)">' + availableTasks.length + '</span>'
          + '</div><div class="mm-v3-cards">';
        availableTasks.forEach(function (task) { h += _availableCard(task); });
        h += '</div></div>';
      }

      if (!hasAny) {
        h += '<div class="mm-v3-empty"><div class="mm-v3-empty-ico">📋</div>'
          + '<div class="mm-v3-empty-ttl">Aucune mission aujourd\'hui</div>'
          + '<div class="mm-v3-empty-sub">Votre responsable n\'a pas encore assigné de tâches.</div></div>';
      }

      // Congrats + confetti when all done
      if (clCount > 0 && myMissions.filter(function (t) { return t.missionType === 'checklist' && !t.done; }).length === 0) {
        h += '<div class="mm-v3-congrats">'
          + '<div class="mm-v3-congrats-ico">🏆</div>'
          + '<div class="mm-v3-congrats-ttl">Toutes les missions terminées !</div>'
          + '<div class="mm-v3-congrats-sub">Félicitations ' + e(fname) + ' !</div>'
          + '</div>';
        setTimeout(function () { if (typeof _confetti === 'function') _confetti(); }, 200);
      }

    } else if (_activeTab === 'intervention') {
      var intTasks  = myMissions.filter(function (t) { return t.missionType === 'intervention'; });
      var intFilt   = _applyFilters(intTasks, todayISO);
      if (intFilt.length === 0) {
        h += '<div class="mm-v3-empty"><div class="mm-v3-empty-ico">🔧</div>'
          + '<div class="mm-v3-empty-ttl">' + (intTasks.length === 0 ? 'Aucune intervention assignée' : 'Aucune intervention ne correspond') + '</div>'
          + '<div class="mm-v3-empty-sub">' + (intTasks.length === 0 ? 'Pas d\'intervention pour aujourd\'hui.' : 'Ajustez les filtres.') + '</div></div>';
      } else {
        h += '<div class="mm-v3-cards">';
        intFilt.forEach(function (task) { h += _interventionCard(task); });
        h += '</div>';
      }

    } else if (_activeTab === 'pmp') {
      var pmpAllTasks = myMissions.filter(function (t) { return t.missionType === 'pmp' && !t.done; });
      var curName2    = cu ? cu.name : '';
      var q2 = _searchQuery ? _searchQuery.toLowerCase() : '';
      if (q2) {
        pmpAllTasks = pmpAllTasks.filter(function (t) {
          var pd = t.pmpData || {};
          return (pd.equipmentName || t.text || '').toLowerCase().indexOf(q2) !== -1
            || (pd.zone || t.zone || '').toLowerCase().indexOf(q2) !== -1;
        });
      }
      var upcomingDue2 = _addDaysMM(todayISO, _upcomingRange);
      var todayPmp     = pmpAllTasks.filter(function (t) { var pd = t.pmpData || {}; return (!pd.dueDate || pd.dueDate === todayISO) && t.takenBy !== curName2; });
      var upcomingPmp  = pmpAllTasks.filter(function (t) { var pd = t.pmpData || {}; return pd.dueDate && pd.dueDate > todayISO && pd.dueDate <= upcomingDue2; });
      var inProgPmp    = pmpAllTasks.filter(function (t) { return t.takenBy === curName2; });
      var urgentPmp    = pmpAllTasks.filter(function (t) { var pd = t.pmpData || {}; return (t.priority === 'haute' || t.priority === 'critique') || (pd.dueDate && pd.dueDate < todayISO); });

      h += _pmpSubTabBar({ today: todayPmp.length, upcoming: upcomingPmp.length, inprogress: inProgPmp.length, urgent: urgentPmp.length });

      if (_pmpSubTab === 'today') {
        if (todayPmp.length === 0) {
          h += '<div class="mm-v3-empty"><div class="mm-v3-empty-ico">☀️</div>'
            + '<div class="mm-v3-empty-ttl">Aucune maintenance aujourd\'hui</div>'
            + '<div class="mm-v3-empty-sub">Pas de PMP prévu pour aujourd\'hui.</div></div>';
        } else {
          h += '<div class="mm-v3-cards">';
          todayPmp.forEach(function (t) { h += _pmpCardToday(t); });
          h += '</div>';
        }
      } else if (_pmpSubTab === 'upcoming') {
        h += '<div class="pmp-upcoming-range">';
        [7, 15, 30].forEach(function (n) {
          h += '<button class="pmp-upcoming-range-btn' + (_upcomingRange === n ? ' pmp-upcoming-range-btn--active' : '') + '"'
            + ' onclick="MX.MM.setUpcomingRange(' + n + ')">' + n + ' jours</button>';
        });
        h += '</div>';
        if (upcomingPmp.length === 0) {
          h += '<div class="mm-v3-empty"><div class="mm-v3-empty-ico">📅</div>'
            + '<div class="mm-v3-empty-ttl">Aucune maintenance à venir</div>'
            + '<div class="mm-v3-empty-sub">Pas de PMP dans les ' + _upcomingRange + ' prochains jours.</div></div>';
        } else {
          h += '<div class="mm-v3-cards">';
          upcomingPmp.forEach(function (t) { h += _pmpCardUpcoming(t, todayISO); });
          h += '</div>';
        }
      } else if (_pmpSubTab === 'inprogress') {
        if (inProgPmp.length === 0) {
          h += '<div class="mm-v3-empty"><div class="mm-v3-empty-ico">⚙️</div>'
            + '<div class="mm-v3-empty-ttl">Aucune maintenance en cours</div>'
            + '<div class="mm-v3-empty-sub">Prenez une maintenance pour la démarrer.</div></div>';
        } else {
          h += '<div class="mm-v3-cards">';
          inProgPmp.forEach(function (t) { h += _pmpCardInProgress(t); });
          h += '</div>';
        }
      } else if (_pmpSubTab === 'urgent') {
        if (urgentPmp.length === 0) {
          h += '<div class="mm-v3-empty"><div class="mm-v3-empty-ico">✅</div>'
            + '<div class="mm-v3-empty-ttl">Aucune urgence</div>'
            + '<div class="mm-v3-empty-sub">Bravo ! Tous les PMP sont dans les délais.</div></div>';
        } else {
          h += '<div class="mm-v3-cards">';
          urgentPmp.forEach(function (t) { h += _pmpCardUrgent(t, todayISO); });
          h += '</div>';
        }
      }
    }

    h += '</div>'; // mm-v3-content

    // Hidden file inputs
    h += '<input type="file" id="mm-ph-in" accept="image/*" capture="environment" style="display:none" onchange="MX.MM._onPh(this)">';
    h += '<input type="file" id="pmp-ph-in" accept="image/*" capture="environment" style="display:none" onchange="MX.MM._onPmpPh(this)">';

    h += '</div>'; // mm-v3-wrap
    return h;
  }

  // ══════════════════════════════════════════════
  // PMP TECH SUB-TABS (v1.1.00)
  // ══════════════════════════════════════════════

  function _pmpSubTabBar(counts) {
    var tabs = [
      { id: 'today',      l: "Aujourd'hui",  icon: 'fas fa-sun',                   ct: counts.today,      red: false },
      { id: 'upcoming',   l: 'À venir',      icon: 'fas fa-calendar-days',         ct: counts.upcoming,   red: false },
      { id: 'inprogress', l: 'En cours',     icon: 'fas fa-spinner',               ct: counts.inprogress, red: false },
      { id: 'urgent',     l: 'Urgent',       icon: 'fas fa-triangle-exclamation',  ct: counts.urgent,     red: true  },
    ];
    var h = '<div class="pmp-tech-subtabs">';
    tabs.forEach(function (tab) {
      var active = _pmpSubTab === tab.id;
      h += '<button class="pmp-tech-subtab' + (active ? ' pmp-tech-subtab--active' : '') + (tab.red ? ' pmp-tech-subtab--urgent' : '') + '"'
        + ' onclick="MX.MM.setPmpSubTab(\'' + tab.id + '\')">'
        + '<i class="' + tab.icon + '"></i><span>' + tab.l + '</span>'
        + (tab.ct > 0 ? '<span class="pmp-tech-subtab-ct' + (tab.red && tab.ct > 0 ? ' pmp-tech-subtab-ct--red' : '') + '">' + tab.ct + '</span>' : '')
        + '</button>';
    });
    h += '</div>';
    return h;
  }

  function _pmpAiBlock(t) {
    var pd    = t.pmpData || {};
    var notes = pd.technicalNotes || pd.observations || '';
    var items = pd.checklistItems || [];
    var dur   = pd.estimatedDuration || '';
    var prio  = t.priority || pd.criticite || '';
    if (!notes && !items.length && !dur && !prio) return '';
    var e = MX.esc;
    var h = '<div class="pmp-ai-block">'
      + '<div class="pmp-ai-block-hdr"><i class="fas fa-robot"></i> Aide à l\'intervention</div>';
    if (dur) {
      h += '<div class="pmp-ai-block-section"><span class="pmp-ai-block-lbl"><i class="fas fa-clock"></i> Durée estimée</span>'
        + '<span class="pmp-ai-block-item">' + e(dur) + '</span></div>';
    }
    if (prio === 'haute' || prio === 'critique') {
      var prioCol = prio === 'critique' ? '#ef4444' : '#f97316';
      h += '<div class="pmp-ai-block-section"><span class="pmp-ai-block-lbl"><i class="fas fa-gauge-high" style="color:' + prioCol + '"></i> Criticité</span>'
        + '<span class="pmp-ai-block-item" style="color:' + prioCol + '">' + e(prio.charAt(0).toUpperCase() + prio.slice(1)) + '</span></div>';
    }
    if (items.length) {
      h += '<div class="pmp-ai-block-section"><span class="pmp-ai-block-lbl"><i class="fas fa-list-check"></i> Tâches (' + items.length + ')</span>';
      items.slice(0, 3).forEach(function (it) {
        h += '<div class="pmp-ai-block-item">' + e(typeof it === 'string' ? it : (it.label || it.text || '')) + '</div>';
      });
      if (items.length > 3) h += '<div class="pmp-ai-block-more">+' + (items.length - 3) + ' de plus</div>';
      h += '</div>';
    }
    if (notes) {
      var shortNotes = notes.length > 120 ? notes.substring(0, 120) + '…' : notes;
      h += '<div class="pmp-ai-block-section"><span class="pmp-ai-block-lbl"><i class="fas fa-note-sticky"></i> Notes techniques</span>'
        + '<div class="pmp-ai-block-notes">' + e(shortNotes) + '</div></div>';
    }
    h += '</div>';
    return h;
  }

  function _pmpCardToday(t) {
    var e       = MX.esc;
    var pd      = t.pmpData || {};
    var today   = new Date().toISOString().slice(0, 10);
    var isLate  = pd.dueDate && pd.dueDate < today;
    var cu      = MX.state.currentUser;
    var curName = cu ? cu.name : '';
    var mid     = e(t.missionId || t.id);
    var h = '<div class="pmp-tech-card' + (isLate ? ' pmp-tech-card--late' : '') + '">'
      + '<div class="pmp-tech-card-bar"></div>'
      + '<div class="pmp-tech-card-inner">'
      + '<div class="pmp-tech-card-head">'
      + '<div><div class="pmp-tech-card-title">' + e(pd.equipmentName || t.text) + '</div>'
      + (pd.family || pd.eqType ? '<div class="pmp-tech-card-family">' + e(pd.family || pd.eqType) + '</div>' : '')
      + '</div>';
    if (t.priority === 'critique') h += '<span class="pmp-tech-card-badge pmp-tech-card-badge--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="pmp-tech-card-badge pmp-tech-card-badge--urg">URGENT</span>';
    h += '</div>';
    h += '<div class="mm-v3-card-meta">';
    if (pd.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</span>';
    if (pd.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(pd.estimatedDuration) + '</span>';
    h += '</div>';
    h += _pmpAiBlock(t);
    h += '<div class="mm-v3-card-actions">';
    if (!t.takenBy) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--take" onclick="MX.MM._takePmpMission(\'' + mid + '\')">'
        + '<i class="fas fa-right-to-bracket"></i><span>📥 Prendre</span></button>';
    } else if (t.takenBy === curName) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--open" onclick="MX.MM._openPmpDetail(\'' + mid + '\')">'
        + '<i class="fas fa-folder-open"></i><span>Ouvrir</span></button>';
    } else {
      h += '<span class="mm-v3-card-taken-info"><i class="fas fa-user-gear"></i> ' + e(t.takenBy) + '</span>';
    }
    h += '</div></div></div>';
    return h;
  }

  function _pmpCardUpcoming(t, todayISO) {
    var e   = MX.esc;
    var pd  = t.pmpData || {};
    var due = pd.dueDate || '';
    var daysUntil = 0;
    if (due && due > todayISO) {
      daysUntil = Math.round((new Date(due + 'T00:00:00') - new Date(todayISO + 'T00:00:00')) / 86400000);
    }
    var items = pd.checklistItems || [];
    var h = '<div class="pmp-tech-card pmp-tech-card--upcoming">'
      + '<div class="pmp-tech-card-bar"></div>'
      + '<div class="pmp-tech-card-inner">'
      + '<div class="pmp-tech-card-head">'
      + '<div><div class="pmp-tech-card-title">' + e(pd.equipmentName || t.text) + '</div>'
      + (pd.family || pd.eqType ? '<div class="pmp-tech-card-family">' + e(pd.family || pd.eqType) + '</div>' : '')
      + '</div>'
      + (daysUntil > 0 ? '<div class="pmp-tech-card-days">J-' + daysUntil + '</div>' : '')
      + '</div>';
    h += '<div class="mm-v3-card-meta">';
    if (pd.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</span>';
    if (due) h += '<span class="mm-v3-meta-it"><i class="fas fa-calendar"></i>' + _fmtDate(due) + '</span>';
    if (pd.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(pd.estimatedDuration) + '</span>';
    h += '</div>';
    if (items.length) {
      h += '<div class="pmp-tech-upcoming-prep"><div class="pmp-tech-prep-lbl"><i class="fas fa-clipboard-list"></i> Préparer</div>';
      items.slice(0, 3).forEach(function (it) {
        h += '<div class="pmp-tech-prep-item"><i class="fas fa-circle-dot"></i> ' + e(typeof it === 'string' ? it : (it.label || it.text || '')) + '</div>';
      });
      if (items.length > 3) h += '<div class="pmp-tech-prep-more">+' + (items.length - 3) + ' tâches supplémentaires</div>';
      h += '</div>';
    }
    if (pd.technicalNotes) {
      var sn = pd.technicalNotes.length > 80 ? pd.technicalNotes.substring(0, 80) + '…' : pd.technicalNotes;
      h += '<div class="pmp-tech-upcoming-notes"><i class="fas fa-note-sticky"></i> ' + e(sn) + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function _pmpCardInProgress(t) {
    var e      = MX.esc;
    var pd     = t.pmpData || {};
    var items  = pd.checklistItems || [];
    var doneC  = Object.keys(t.completedChecklist || {}).filter(function (k) { return t.completedChecklist[k]; }).length;
    var mid    = e(t.missionId || t.id);
    var h = '<div class="pmp-tech-card pmp-tech-card--inprogress">'
      + '<div class="pmp-tech-card-bar"></div>'
      + '<div class="pmp-tech-card-inner">'
      + '<div class="pmp-tech-card-head">'
      + '<div><div class="pmp-tech-card-title">' + e(pd.equipmentName || t.text) + '</div>'
      + (pd.family || pd.eqType ? '<div class="pmp-tech-card-family">' + e(pd.family || pd.eqType) + '</div>' : '')
      + '</div>'
      + '<span class="pmp-tech-card-badge pmp-tech-card-badge--inprog">En cours</span>'
      + '</div>';
    h += '<div class="mm-v3-card-meta">';
    if (pd.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</span>';
    if (pd.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(pd.estimatedDuration) + '</span>';
    h += '</div>';
    if (items.length) {
      var pmpPct = Math.round(doneC / items.length * 100);
      h += '<div class="mm-v3-pmp-prog">'
        + '<div class="mm-v3-pmp-prog-track"><div class="mm-v3-pmp-prog-fill" style="width:' + pmpPct + '%;background:' + TC.pmp + '"></div></div>'
        + '<span class="mm-v3-pmp-prog-lbl">' + doneC + '/' + items.length + ' tâches — ' + pmpPct + '%</span></div>';
    }
    h += '<div class="mm-v3-card-actions">'
      + '<button class="mm-v3-act-main mm-v3-act-main--open" onclick="MX.MM._openPmpDetail(\'' + mid + '\')">'
      + '<i class="fas fa-folder-open"></i><span>📂 Ouvrir</span></button>'
      + '</div></div></div>';
    return h;
  }

  function _pmpCardUrgent(t, todayISO) {
    var e       = MX.esc;
    var pd      = t.pmpData || {};
    var isLate  = pd.dueDate && pd.dueDate < todayISO;
    var cu      = MX.state.currentUser;
    var curName = cu ? cu.name : '';
    var mid     = e(t.missionId || t.id);
    var h = '<div class="pmp-tech-card pmp-tech-card--urgent">'
      + '<div class="pmp-tech-card-bar"></div>'
      + '<div class="pmp-tech-card-inner">'
      + '<div class="pmp-tech-card-head">'
      + '<div><div class="pmp-tech-card-title">' + e(pd.equipmentName || t.text) + '</div>'
      + (pd.family || pd.eqType ? '<div class="pmp-tech-card-family">' + e(pd.family || pd.eqType) + '</div>' : '')
      + '</div>';
    if (isLate) h += '<span class="pmp-tech-card-badge pmp-tech-card-badge--crit">RETARD</span>';
    else if (t.priority === 'critique') h += '<span class="pmp-tech-card-badge pmp-tech-card-badge--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="pmp-tech-card-badge pmp-tech-card-badge--urg">URGENT</span>';
    h += '</div>';
    h += '<div class="mm-v3-card-meta">';
    if (pd.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</span>';
    if (pd.dueDate) {
      h += '<span class="mm-v3-meta-it"><i class="fas fa-calendar' + (isLate ? '' : '-days') + '"></i>' + _fmtDate(pd.dueDate);
      if (isLate) h += ' <span style="color:#ef4444;font-weight:600">(RETARD)</span>';
      h += '</span>';
    }
    if (pd.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(pd.estimatedDuration) + '</span>';
    h += '</div>';
    h += _pmpAiBlock(t);
    h += '<div class="mm-v3-card-actions">';
    if (!t.takenBy) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--take" onclick="MX.MM._takePmpMission(\'' + mid + '\')">'
        + '<i class="fas fa-right-to-bracket"></i><span>📥 Prendre</span></button>';
    } else if (t.takenBy === curName) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--open" onclick="MX.MM._openPmpDetail(\'' + mid + '\')">'
        + '<i class="fas fa-folder-open"></i><span>Ouvrir</span></button>';
    } else {
      h += '<span class="mm-v3-card-taken-info"><i class="fas fa-user-gear"></i> ' + e(t.takenBy) + '</span>';
    }
    h += '</div></div></div>';
    return h;
  }

  // ══════════════════════════════════════════════
  // MISSION CARDS
  // ══════════════════════════════════════════════

  function _missionCard(t) {
    if (t.missionType === 'pmp')          return _pmpCard(t);
    if (t.missionType === 'intervention') return _interventionCard(t);
    return _checklistCard(t);
  }

  function _checklistCard(t) {
    var e     = MX.esc;
    var isUrg = t.priority === 'haute' || t.priority === 'critique';
    var lc    = isUrg ? TC.urgence : TC.checklist;
    var dayE  = e(t.dayId), slotE = e(t.slot), idE = e(t.id);

    var h = '<div class="mm-v3-card' + (t.done ? ' mm-v3-card--done' : '') + (isUrg ? ' mm-v3-card--urgent' : '') + '">'
      + '<div class="mm-v3-card-bar" style="background:' + lc + '"></div>'
      + '<div class="mm-v3-card-body">'
      + '<div class="mm-v3-card-tags">';
    if (t.priority === 'critique') h += '<span class="mm-v3-tag mm-v3-tag--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="mm-v3-tag mm-v3-tag--urg">URGENT</span>';
    if (t.fromUser) h += '<span class="mm-v3-tag mm-v3-tag--xfer">Transféré</span>';
    if (t.done)     h += '<span class="mm-v3-tag mm-v3-tag--done"><i class="fas fa-check"></i> Validé</span>';
    h += '</div>';

    h += '<div class="mm-v3-card-title">' + e(t.text) + '</div>';
    if (t.desc) h += '<div class="mm-v3-card-desc">' + e(t.desc) + '</div>';

    h += '<div class="mm-v3-card-meta">';
    if (t.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(t.zone) + (t.subZone ? ' · ' + e(t.subZone) : '') + '</span>';
    if (t.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(t.estimatedDuration) + '</span>';
    if (t.note) h += '<span class="mm-v3-meta-it"><i class="fas fa-note-sticky"></i>' + e(t.note) + '</span>';
    h += '</div>';

    h += '<div class="mm-v3-card-actions">'
      + '<button class="mm-v3-act-icon" onclick="MX.MM.photo(\'' + e(t.checkKey) + '\')" title="Photo"><i class="fas fa-camera"></i></button>'
      + '<button class="mm-v3-act-icon" onclick="MX.MM.signal(\'' + e(t.checkKey) + '\')" title="Signaler"><i class="fas fa-triangle-exclamation"></i></button>';
    if (t.done) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--done" onclick="MX.MM.toggle(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')">'
        + '<i class="fas fa-circle-check"></i><span>Validée</span></button>';
    } else {
      h += '<button class="mm-v3-act-main mm-v3-act-main--validate" onclick="MX.MM.toggle(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')">'
        + '<i class="fas fa-circle-check"></i><span>Valider</span></button>';
    }
    h += '</div></div></div>';
    return h;
  }

  function _interventionCard(t) {
    var e     = MX.esc;
    var isUrg = t.priority === 'haute' || t.priority === 'critique';
    var today = new Date().toISOString().slice(0, 10);
    var isLate = t.dueDate && t.dueDate < today && !t.done;
    var lc    = isLate ? TC.urgence : isUrg ? TC.urgence : TC.intervention;

    var h = '<div class="mm-v3-card' + (t.done ? ' mm-v3-card--done' : '') + (isLate || isUrg ? ' mm-v3-card--urgent' : '') + '">'
      + '<div class="mm-v3-card-bar" style="background:' + lc + '"></div>'
      + '<div class="mm-v3-card-body">'
      + '<div class="mm-v3-card-tags">';
    if (isLate) h += '<span class="mm-v3-tag mm-v3-tag--crit">RETARD</span>';
    else if (t.priority === 'critique') h += '<span class="mm-v3-tag mm-v3-tag--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="mm-v3-tag mm-v3-tag--urg">URGENT</span>';
    if (t.dueDate) h += '<span class="mm-v3-tag mm-v3-tag--date' + (isLate ? ' mm-v3-tag--date-late' : '') + '"><i class="fas fa-calendar"></i>' + _fmtDate(t.dueDate) + '</span>';
    if (t.done) h += '<span class="mm-v3-tag mm-v3-tag--done"><i class="fas fa-check"></i> Terminé</span>';
    h += '</div>';

    h += '<div class="mm-v3-card-title">' + e(t.text) + '</div>';
    if (t.desc) h += '<div class="mm-v3-card-desc">' + e(t.desc) + '</div>';

    h += '<div class="mm-v3-card-meta">';
    if (t.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(t.zone) + (t.subZone ? ' · ' + e(t.subZone) : '') + '</span>';
    if (t.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(t.estimatedDuration) + '</span>';
    h += '</div>';

    h += '<div class="mm-v3-card-actions">'
      + '<button class="mm-v3-act-main mm-v3-act-main--open" onclick="MX.MM._openInterventionDetail(\'' + e(t.firestoreId || t.id) + '\')">'
      + '<i class="fas fa-folder-open"></i><span>Ouvrir</span></button>'
      + '</div></div></div>';
    return h;
  }

  function _pmpCard(t) {
    var e      = MX.esc;
    var pd     = t.pmpData || {};
    var isUrg  = t.priority === 'haute' || t.priority === 'critique';
    var today  = new Date().toISOString().slice(0, 10);
    var isLate = pd.dueDate && pd.dueDate < today && !t.done;
    var lc     = isLate ? TC.urgence : isUrg ? TC.urgence : TC.pmp;
    var items  = pd.checklistItems || [];
    var doneC  = Object.keys(t.completedChecklist || {}).filter(function (k) { return t.completedChecklist[k]; }).length;

    var h = '<div class="mm-v3-card' + (isLate ? ' mm-v3-card--urgent' : '') + '">'
      + '<div class="mm-v3-card-bar" style="background:' + lc + '"></div>'
      + '<div class="mm-v3-card-body">'
      + '<div class="mm-v3-card-tags">';
    if (isLate) h += '<span class="mm-v3-tag mm-v3-tag--crit">RETARD</span>';
    else if (t.priority === 'critique') h += '<span class="mm-v3-tag mm-v3-tag--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="mm-v3-tag mm-v3-tag--urg">URGENT</span>';
    if (pd.dueDate) h += '<span class="mm-v3-tag mm-v3-tag--date' + (isLate ? ' mm-v3-tag--date-late' : '') + '"><i class="fas fa-calendar"></i>' + _fmtDate(pd.dueDate) + '</span>';
    h += '</div>';

    h += '<div class="mm-v3-card-title">' + e(pd.equipmentName || t.text) + '</div>';

    h += '<div class="mm-v3-card-meta">';
    if (pd.zone) h += '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</span>';
    if (pd.estimatedDuration) h += '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(pd.estimatedDuration) + '</span>';
    h += '</div>';

    if (items.length) {
      var pmpPct = Math.round(doneC / items.length * 100);
      h += '<div class="mm-v3-pmp-prog">'
        + '<div class="mm-v3-pmp-prog-track"><div class="mm-v3-pmp-prog-fill" style="width:' + pmpPct + '%;background:' + TC.pmp + '"></div></div>'
        + '<span class="mm-v3-pmp-prog-lbl">' + doneC + '/' + items.length + ' tâches</span></div>';
    }

    var cu      = MX.state.currentUser;
    var curName = cu ? cu.name : '';
    var mid     = e(t.missionId || t.id);
    h += '<div class="mm-v3-card-actions">';
    if (t.done) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--done" disabled>'
        + '<i class="fas fa-circle-check"></i><span>Terminée</span></button>';
    } else if (!t.takenBy) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--take" onclick="MX.MM._takePmpMission(\'' + mid + '\')">'
        + '<i class="fas fa-right-to-bracket"></i><span>Prendre</span></button>';
    } else if (t.takenBy === curName) {
      h += '<button class="mm-v3-act-main mm-v3-act-main--open" onclick="MX.MM._openPmpDetail(\'' + mid + '\')">'
        + '<i class="fas fa-folder-open"></i><span>Ouvrir</span></button>';
    } else {
      h += '<span class="mm-v3-card-taken-info"><i class="fas fa-user-gear"></i> ' + e(t.takenBy) + '</span>';
    }
    h += '</div></div></div>';
    return h;
  }

  function _newMissionCard(m) {
    var e   = MX.esc;
    var tc  = m.missionType === 'pmp' ? TC.pmp : m.missionType === 'intervention' ? TC.intervention : TC.checklist;
    var lbl = m.missionType === 'pmp' ? '🛠️ Préventif' : m.missionType === 'intervention' ? '🔧 Intervention' : '✅ Checklist';
    var fid = e(m.firestoreId || m.id);
    return '<div class="mm-v3-new-card">'
      + '<div class="mm-v3-new-card-bar" style="background:' + tc + '"></div>'
      + '<div class="mm-v3-new-card-body">'
      + '<div class="mm-v3-tag" style="color:' + tc + ';border-color:' + tc + '40;background:' + tc + '18">' + lbl + '</div>'
      + '<div class="mm-v3-card-title">' + e(m.text) + '</div>'
      + '<div class="mm-v3-card-meta">'
      + (m.zone ? '<span class="mm-v3-meta-it"><i class="fas fa-location-dot"></i>' + e(m.zone) + '</span>' : '')
      + (m.estimatedDuration ? '<span class="mm-v3-meta-it"><i class="fas fa-clock"></i>' + e(m.estimatedDuration) + '</span>' : '')
      + '</div>'
      + '<button class="mm-v3-act-main mm-v3-act-main--accept" onclick="MX.MM._acceptMission(\'' + fid + '\')">'
      + '<i class="fas fa-circle-plus"></i><span>Accepter</span></button>'
      + '</div></div>';
  }

  function _availableCard(t) {
    var e  = MX.esc;
    var si = SLOT_INFO[t.slot] || { l: t.slot, icon: '' };
    return '<div class="mm-v3-card mm-v3-card--avail">'
      + '<div class="mm-v3-card-bar" style="background:var(--text3)"></div>'
      + '<div class="mm-v3-card-body">'
      + '<div class="mm-v3-card-tags">'
      + '<span class="mm-v3-tag">' + (si.icon || '') + ' ' + e(si.l) + '</span>'
      + '<span class="mm-v3-tag mm-v3-tag--avail">Non assigné</span>'
      + '</div>'
      + '<div class="mm-v3-card-title">' + e(t.text) + '</div>'
      + '<div class="mm-v3-card-actions">'
      + '<button class="mm-v3-act-main mm-v3-act-main--take" onclick="MX.MM.prendre(\'' + e(t.dayId) + '\',\'' + e(t.slot) + '\',\'' + e(t.id) + '\')">'
      + '<i class="fas fa-hand-pointer"></i><span>Prendre</span></button>'
      + '</div></div></div>';
  }

  // ══════════════════════════════════════════════
  // ACCEPT MISSION
  // ══════════════════════════════════════════════

  function _acceptMission(missionId) {
    db.collection('missions').doc(missionId).update({ accepted: true })
      .then(function () { MX.toast('Mission acceptée ✓'); })
      .catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  // ══════════════════════════════════════════════
  // PHOTO CELL HELPER (shared)
  // ══════════════════════════════════════════════

  function _photoCell(missionId, cat, dataUrl, label) {
    return '<div class="pmp-photo-cell" data-cat="' + cat + '" onclick="MX.MM._triggerPmpPhoto(\'' + missionId + '\',\'' + cat + '\')">'
      + (dataUrl
        ? '<img src="' + dataUrl + '" class="pmp-photo-thumb">'
        : '<div class="pmp-photo-empty"><i class="fas fa-camera"></i><span>' + label + '</span></div>')
      + '</div>';
  }

  // ══════════════════════════════════════════════
  // INTERVENTION DETAIL PANEL
  // ══════════════════════════════════════════════

  function _openInterventionDetail(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m) return;
    var e = MX.esc;
    var comments = m.interventionComments || [];
    var parts    = m.usedParts || [];

    var h = '<div class="pmp-detail-overlay" id="mm-detail-ov">'
      + '<div class="pmp-detail-modal">'
      + '<div class="pmp-detail-header">'
      + '<div class="pmp-detail-header-l">'
      + '<div class="pmp-detail-badge" style="background:rgba(59,130,246,.15);color:#3b82f6">🔧 Intervention</div>'
      + '<div class="pmp-detail-ttl">' + e(m.text || 'Intervention') + '</div>'
      + (m.zone ? '<div class="pmp-detail-sub"><i class="fas fa-location-dot" style="font-size:9px"></i> ' + e(m.zone) + (m.subZone ? ' · ' + e(m.subZone) : '') + '</div>' : '')
      + '</div>'
      + '<button class="pmp-detail-close" onclick="MX.MM._closeInterventionDetail()"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '<div class="pmp-detail-body">';

    // Description
    if (m.description) {
      h += '<div class="pmp-detail-section">'
        + '<div class="pmp-detail-section-ttl"><i class="fas fa-file-alt"></i> Description</div>'
        + '<div class="pmp-detail-notes">' + e(m.description) + '</div></div>';
    }

    // Info grid
    var infoItems = [];
    if (m.priority && m.priority !== 'normale') infoItems.push({ l: 'Priorité', v: m.priority });
    if (m.dueDate) infoItems.push({ l: 'Échéance', v: _fmtDate(m.dueDate) });
    if (m.estimatedDuration) infoItems.push({ l: 'Durée estimée', v: m.estimatedDuration });
    if (m.assignedTo) infoItems.push({ l: 'Technicien', v: m.assignedTo });
    if (infoItems.length) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-info-circle"></i> Informations</div>'
        + '<div class="pmp-detail-info-grid">'
        + infoItems.map(function (it) {
            return '<div class="pmp-detail-info-item"><span class="pmp-detail-info-lbl">' + e(it.l) + '</span><span>' + e(it.v) + '</span></div>';
          }).join('')
        + '</div></div>';
    }

    // Comments
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-comment"></i> Commentaires</div>';
    if (comments.length) {
      h += '<div class="int-comments-list">';
      comments.forEach(function (c) {
        h += '<div class="int-comment"><div class="int-comment-meta"><span class="int-comment-by">' + e(c.by || '') + '</span>'
          + '<span class="int-comment-ts">' + (c.ts ? new Date(c.ts).toLocaleString('fr-FR') : '') + '</span></div>'
          + '<div class="int-comment-text">' + e(c.text || '') + '</div></div>';
      });
      h += '</div>';
    }
    h += '<div class="int-comment-add">'
      + '<textarea class="fi" id="int-cmt-' + missionId + '" rows="2" placeholder="Ajouter un commentaire…" style="resize:vertical;width:100%;box-sizing:border-box;margin-bottom:5px"></textarea>'
      + '<button class="pmp-chrono-btn pmp-chrono-btn--start" style="width:100%" onclick="MX.MM._addIntComment(\'' + missionId + '\')">'
      + '<i class="fas fa-paper-plane"></i> Envoyer</button>'
      + '</div></div>';

    // Photos
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-camera"></i> Photos</div>'
      + '<div class="pmp-photo-row">'
      + _photoCell(missionId, 'avant',   m.photoAvant   || null, 'Avant')
      + _photoCell(missionId, 'pendant', m.photoPendant || null, 'Pendant')
      + _photoCell(missionId, 'apres',   m.photoApres   || null, 'Après')
      + '</div></div>';

    // Pièces utilisées
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-tools"></i> Pièces utilisées</div>';
    if (parts.length) {
      h += '<div class="int-parts-list">';
      parts.forEach(function (p) {
        h += '<div class="int-part-item"><span class="int-part-name">' + e(p.name || '') + '</span>'
          + '<span class="int-part-qty">× ' + (p.qty || 1) + '</span>'
          + (p.cost ? '<span class="int-part-cost">' + p.cost + ' €</span>' : '') + '</div>';
      });
      h += '</div>';
    }
    h += '<div class="int-part-add">'
      + '<input class="fi" id="int-p-name-' + missionId + '" placeholder="Pièce" style="flex:1;min-width:0">'
      + '<input class="fi" id="int-p-qty-'  + missionId + '" placeholder="Qté" type="number" min="1" style="width:64px">'
      + '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._addIntPart(\'' + missionId + '\')" style="flex-shrink:0"><i class="fas fa-plus"></i></button>'
      + '</div></div>';

    // Validate footer
    h += '<div class="pmp-detail-footer">'
      + '<button class="pmp-validate-btn' + (m.done ? ' pmp-validate-btn--done' : '') + '" onclick="MX.MM._validateIntMission(\'' + missionId + '\')">'
      + (m.done ? '<i class="fas fa-circle-check"></i> Mission validée' : '<i class="fas fa-check"></i> Valider l\'intervention')
      + '</button></div>';

    h += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
  }

  function _closeInterventionDetail() {
    var ov = document.getElementById('mm-detail-ov');
    if (ov) ov.remove();
  }

  function _resumeIntChronoUI(missionId, start, prevElapsed) {
    // kept as no-op for any remaining callers
  }

  function _addIntComment(missionId) {
    var ta = document.getElementById('int-cmt-' + missionId);
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;
    var cu = MX.state.currentUser;
    var comment = { text: text, by: cu ? cu.name : '?', ts: Date.now() };
    db.collection('missions').doc(missionId).update({ interventionComments: FV.arrayUnion(comment) })
      .then(function () {
        ta.value = '';
        MX.toast('Commentaire ajouté ✓');
        var m = _allMissions.find(function (x) { return x.id === missionId; });
        if (m) { if (!m.interventionComments) m.interventionComments = []; m.interventionComments.push(comment); }
        var listEl = document.querySelector('#mm-detail-ov .int-comments-list');
        if (!listEl) {
          var addEl = document.querySelector('#mm-detail-ov .int-comment-add');
          if (addEl) { var nl = document.createElement('div'); nl.className = 'int-comments-list'; addEl.parentNode.insertBefore(nl, addEl); listEl = nl; }
        }
        if (listEl) {
          var e = MX.esc;
          listEl.insertAdjacentHTML('beforeend',
            '<div class="int-comment"><div class="int-comment-meta"><span class="int-comment-by">' + e(comment.by) + '</span>'
            + '<span class="int-comment-ts">' + new Date(comment.ts).toLocaleString('fr-FR') + '</span></div>'
            + '<div class="int-comment-text">' + e(comment.text) + '</div></div>');
        }
      }).catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  function _addIntPart(missionId) {
    var nameEl = document.getElementById('int-p-name-' + missionId);
    var qtyEl  = document.getElementById('int-p-qty-'  + missionId);
    if (!nameEl) return;
    var name = nameEl.value.trim();
    if (!name) { MX.toast('Saisissez le nom de la pièce', true); return; }
    var qty = parseInt(qtyEl ? qtyEl.value : '1') || 1;
    var part = { name: name, qty: qty };
    db.collection('missions').doc(missionId).update({ usedParts: FV.arrayUnion(part) })
      .then(function () {
        nameEl.value = ''; if (qtyEl) qtyEl.value = '';
        MX.toast('Pièce ajoutée ✓');
        var m = _allMissions.find(function (x) { return x.id === missionId; });
        if (m) { if (!m.usedParts) m.usedParts = []; m.usedParts.push(part); }
        var listEl = document.querySelector('#mm-detail-ov .int-parts-list');
        if (listEl) {
          var e = MX.esc;
          listEl.insertAdjacentHTML('beforeend',
            '<div class="int-part-item"><span class="int-part-name">' + e(part.name) + '</span><span class="int-part-qty">× ' + part.qty + '</span></div>');
        }
      }).catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  async function _validateIntMission(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m || m.done) return;
    var cu = MX.state.currentUser;
    try {
      await db.collection('missions').doc(missionId).update({
        done: true, status: 'terminee',
        completedAt: FV.serverTimestamp(),
        completedBy: cu ? cu.name : (m.assignedTo || ''),
      });
      MX.toast('Intervention validée ✓');
      _closeInterventionDetail();
    } catch (err) {
      MX.toast('Erreur validation: ' + err.message, true);
    }
  }

  // ══════════════════════════════════════════════
  // PMP DETAIL PANEL
  // ══════════════════════════════════════════════

  function _avatarColor(name) {
    var colors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#06b6d4'];
    var hash = 0;
    for (var i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
    return colors[hash % colors.length];
  }

  function _avatarInitials(name) {
    var parts = (name || '?').trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (name || '?').slice(0, 2).toUpperCase();
  }

  function _pmpMiniInsights(m, history) {
    var insights = [];
    if (!history.length) return insights;
    var ANOM_KW = ['panne','anomalie','défaut','cassé','cassée','fuite','rouillé','bloqué','bloquée','dysfonctionnement','problème','bruit'];
    var PARTS_KW = ['filtre','courroie','roulement','joint','fusible','relais','sonde','pompe','vanne','condensateur','moteur','courroie'];
    var anomCount = 0;
    var partCounts = {};
    history.forEach(function (hx) {
      var obs = (hx.observations || '').toLowerCase();
      if (ANOM_KW.some(function (kw) { return obs.indexOf(kw) !== -1; })) anomCount++;
      PARTS_KW.forEach(function (kw) { if (obs.indexOf(kw) !== -1) partCounts[kw] = (partCounts[kw] || 0) + 1; });
    });
    var pd = m.pmpData || {};
    var dueDate = pd.dueDate;
    if (dueDate) {
      var today = new Date().toISOString().slice(0, 10);
      if (dueDate < today) {
        var diff = Math.round((new Date(today) - new Date(dueDate)) / 86400000);
        insights.push({ level: 'high', icon: '⚠️', text: 'Intervention en retard de ' + diff + ' jour' + (diff > 1 ? 's' : ''), why: 'car la date prévue (' + _fmtDate(dueDate) + ') est dépassée.' });
      }
    }
    if (history.length >= 3) {
      var rate = Math.round(anomCount / history.length * 100);
      if (rate >= 50) insights.push({ level: 'high', icon: '🔴', text: 'Taux d\'anomalies élevé : ' + rate + '%', why: 'car ' + anomCount + ' interventions sur ' + history.length + ' mentionnent une anomalie.' });
    }
    var recurring = Object.keys(partCounts).filter(function (k) { return partCounts[k] >= 2; });
    if (recurring.length) insights.push({ level: 'medium', icon: '🔧', text: 'Composant récurrent : ' + recurring[0], why: 'car "' + recurring[0] + '" apparaît dans ' + partCounts[recurring[0]] + ' rapports d\'intervention.' });
    if (!insights.length && history.length >= 2) insights.push({ level: 'ok', icon: '✅', text: 'Maintenance bien assurée (' + history.length + ' interventions)', why: 'car l\'historique ne signale aucune anomalie récurrente.' });
    return insights;
  }

  function _openPmpDetail(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m) return;
    var e  = MX.esc;
    var pd = m.pmpData || {};
    var items       = pd.checklistItems || [];
    var completed   = m.completedChecklist || {};
    var doneCnt     = Object.keys(completed).filter(function (k) { return completed[k]; }).length;
    var pmpComments = m.pmpComments || [];
    var parts       = m.usedParts || [];
    var history     = m.interventionHistory || [];
    // Lifecycle state (for header badge only)
    var lifecycle = m.done ? 'terminee' : (m.takenBy ? 'en_cours' : 'disponible');
    var lcLabel   = lifecycle === 'terminee' ? 'Terminée 🟢' : (lifecycle === 'en_cours' ? 'En cours 🟠' : 'Disponible 🟣');
    var lcColor   = lifecycle === 'terminee' ? '#22c55e' : (lifecycle === 'en_cours' ? '#f97316' : '#a855f7');

    // Checklist (toujours éditable sauf si mission terminée)
    var canEdit = !m.done;
    var checklist = items.map(function (it, idx) {
      var ck = completed[String(idx)] || completed[idx];
      return '<label class="pmp-ck-item' + (ck ? ' pmp-ck-item--done' : '') + '">'
        + '<input type="checkbox"' + (ck ? ' checked' : '') + (canEdit ? '' : ' disabled')
        + ' onchange="MX.MM._toggleCheck(\'' + missionId + '\',' + idx + ',this.checked)">'
        + '<span>' + e(it.text || it) + '</span></label>';
    }).join('');

    // Header
    var h = '<div class="pmp-detail-overlay" id="pmp-detail-ov">'
      + '<div class="pmp-detail-modal">'
      + '<div class="pmp-detail-header">'
      + '<div class="pmp-detail-header-l">'
      + '<div class="pmp-detail-badge" style="background:' + lcColor + '22;color:' + lcColor + ';border:1px solid ' + lcColor + '55">' + lcLabel + '</div>'
      + '<div class="pmp-detail-ttl">' + e(pd.equipmentName || '—') + '</div>'
      + (pd.zone ? '<div class="pmp-detail-sub"><i class="fas fa-location-dot" style="font-size:9px"></i> ' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</div>' : '')
      + '</div>'
      + '<button class="pmp-detail-close" onclick="MX.MM._closePmpDetail()"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '<div class="pmp-detail-body">';

    // ── 1. Informations équipement ──
    var lastTech = history.length ? history[history.length - 1].by : (m.assignedTo || null);
    var lastDate = history.length ? history[history.length - 1].date : pd.lastDone;
    h += '<div class="pmp-eq-info-block"><div class="pmp-eq-info-grid">'
      + (pd.ref ? '<div class="pmp-eq-info-item"><span class="pmp-eq-info-lbl">Référence</span><span>' + e(pd.ref) + '</span></div>' : '')
      + (pd.zone ? '<div class="pmp-eq-info-item"><span class="pmp-eq-info-lbl">Local</span><span>' + e(pd.zone) + (pd.subZone ? ' / ' + e(pd.subZone) : '') + '</span></div>' : '')
      + (pd.frequency ? '<div class="pmp-eq-info-item"><span class="pmp-eq-info-lbl">Fréquence</span><span>' + e(String(pd.frequency)) + ' jours</span></div>' : '')
      + (lastDate ? '<div class="pmp-eq-info-item"><span class="pmp-eq-info-lbl">Dernière maintenance</span><span>' + e(_fmtDate(lastDate)) + '</span></div>' : '')
      + (lastTech ? '<div class="pmp-eq-info-item"><span class="pmp-eq-info-lbl">Dernier technicien</span><span>' + e(lastTech) + '</span></div>' : '')
      + (pd.estimatedDuration ? '<div class="pmp-eq-info-item"><span class="pmp-eq-info-lbl">Durée estimée</span><span>' + e(pd.estimatedDuration) + '</span></div>' : '')
      + '</div></div>';

    // ── 2. Historique stats ──
    if (history.length) {
      var ANOM_KW2 = ['panne','anomalie','défaut','cassé','cassée','fuite','rouillé','bloqué','dysfonctionnement','problème'];
      var anomCount2 = 0;
      var dernierePanne = '—';
      history.forEach(function (hx) {
        var obs = (hx.observations || '').toLowerCase();
        if (ANOM_KW2.some(function (kw) { return obs.indexOf(kw) !== -1; })) anomCount2++;
      });
      for (var hi = history.length - 1; hi >= 0; hi--) {
        var obs2 = (history[hi].observations || '').toLowerCase();
        if (ANOM_KW2.some(function (kw) { return obs2.indexOf(kw) !== -1; })) {
          dernierePanne = _fmtDate(history[hi].date) || history[hi].date || '—';
          break;
        }
      }
      h += '<div class="pmp-history-stats">'
        + '<div class="pmp-hist-stat"><span class="pmp-hist-val">' + history.length + '</span><span class="pmp-hist-lbl">interventions</span></div>'
        + '<div class="pmp-hist-stat"><span class="pmp-hist-val' + (anomCount2 > 0 ? ' pmp-hist-val--warn' : '') + '">' + anomCount2 + '</span><span class="pmp-hist-lbl">anomalies</span></div>'
        + '<div class="pmp-hist-stat"><span class="pmp-hist-val" style="font-size:12px">' + e(dernierePanne) + '</span><span class="pmp-hist-lbl">dernière panne</span></div>'
        + '</div>';
    }

    // ── 3. Consignes techniques ──
    if (pd.technicalNotes) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-note-sticky"></i> Consignes techniques</div>'
        + '<div class="pmp-detail-notes pmp-detail-notes--alert">' + e(pd.technicalNotes) + '</div></div>';
    }

    // ── 4. Checklist ──
    if (items.length) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-list-check"></i> Checklist (' + doneCnt + '/' + items.length + ')</div>'
        + '<div class="pmp-ck-list">' + checklist + '</div></div>';
    }

    // ── 5. Journal technique ──
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-book-open"></i> Journal technique</div>';
    h += '<div class="pmp-journal-list" id="pmp-journal-' + missionId + '">';
    pmpComments.forEach(function (c) {
      var initials = _avatarInitials(c.by || '?');
      var color    = _avatarColor(c.by || '?');
      var d        = c.ts ? new Date(c.ts) : null;
      var dateStr  = d ? d.toLocaleDateString('fr-FR') : '';
      var timeStr  = d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      h += '<div class="pmp-journal-entry">'
        + '<div class="pmp-journal-avatar" style="background:' + color + '">' + initials + '</div>'
        + '<div class="pmp-journal-content">'
        + '<div class="pmp-journal-meta"><span class="pmp-journal-author">' + e(c.by || '?') + '</span>'
        + '<span class="pmp-journal-date">' + dateStr + (timeStr ? ' · ' + timeStr : '') + '</span></div>'
        + '<div class="pmp-journal-text">' + e(c.text || '') + '</div>'
        + '</div></div>';
    });
    h += '</div>';
    h += '<div class="pmp-journal-add">'
      + '<textarea class="fi" id="pmp-obs-' + missionId + '" rows="2" placeholder="Observations, anomalies, travaux effectués…" style="resize:vertical;width:100%;box-sizing:border-box;margin-bottom:5px"></textarea>'
      + '<button class="pmp-chrono-btn pmp-chrono-btn--start" style="width:100%" onclick="MX.MM._addPmpComment(\'' + missionId + '\')">'
      + '<i class="fas fa-paper-plane"></i> Ajouter au journal</button>'
      + '</div></div>';

    // ── 6. Photos (5 catégories) ──
    var pmpPhotos = m.pmpPhotos || {};
    var photoCats = [
      { key: 'avant',   label: 'Avant',              icon: 'fa-circle-arrow-right' },
      { key: 'pendant', label: 'Pendant',             icon: 'fa-spinner' },
      { key: 'apres',   label: 'Après',               icon: 'fa-circle-check' },
      { key: 'plaque',  label: 'Plaque signalétique', icon: 'fa-id-badge' },
      { key: 'schema',  label: 'Schéma électrique',   icon: 'fa-bolt' },
    ];
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-camera"></i> Photos</div>';
    h += '<div class="pmp-photo-cats">';
    photoCats.forEach(function (cat) {
      var photos = (pmpPhotos[cat.key] || []).slice();
      if (!photos.length && cat.key === 'avant'   && m.photoAvant)   photos = [m.photoAvant];
      if (!photos.length && cat.key === 'pendant' && m.photoPendant) photos = [m.photoPendant];
      if (!photos.length && cat.key === 'apres'   && m.photoApres)   photos = [m.photoApres];
      h += '<div class="pmp-photo-cat">'
        + '<div class="pmp-photo-cat-hdr"><i class="fas ' + cat.icon + '"></i> ' + cat.label + '</div>'
        + '<div class="pmp-photo-cat-imgs" id="pmp-phcat-' + missionId + '-' + cat.key + '">';
      photos.forEach(function (url) {
        h += '<img src="' + url + '" class="pmp-photo-thumb" onclick="MX.MM._viewPhoto(this.src)">';
      });
      h += '</div>'
        + '<button class="pmp-photo-add-btn" onclick="MX.MM._triggerPmpPhoto(\'' + missionId + '\',\'' + cat.key + '\')">'
        + '<i class="fas fa-plus"></i> Ajouter</button>'
        + '</div>';
    });
    h += '</div></div>';

    // ── 7. Pièces utilisées ──
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-tools"></i> Pièces utilisées</div>';
    h += '<div class="int-parts-list" id="pmp-parts-' + missionId + '">';
    parts.forEach(function (p) {
      h += '<div class="int-part-item"><span class="int-part-name">' + e(p.name || '') + '</span>'
        + '<span class="int-part-qty">× ' + (p.qty || 1) + '</span></div>';
    });
    h += '</div>';
    h += '<div class="int-part-add">'
      + '<input class="fi" id="pmp-p-name-' + missionId + '" placeholder="Nom de la pièce…" style="flex:1;min-width:0">'
      + '<input class="fi" id="pmp-p-qty-'  + missionId + '" placeholder="Qté" type="number" min="1" value="1" style="width:64px">'
      + '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._addPmpPart(\'' + missionId + '\')" style="flex-shrink:0"><i class="fas fa-plus"></i></button>'
      + '</div></div>';

    // ── 8. Assistant Maintix ──
    var insights = _pmpMiniInsights(m, history);
    h += '<div class="pmp-ai-mini">'
      + '<div class="pmp-ai-mini-hdr"><span class="ai-icon-pulse">🤖</span> Assistant Maintix</div>';
    if (insights.length) {
      insights.forEach(function (ins) {
        h += '<div class="pmp-ai-mini-row pmp-ai-mini-row--' + ins.level + '">'
          + ins.icon + ' ' + e(ins.text)
          + '<div class="pmp-ai-mini-why">Pourquoi : ' + e(ins.why) + '</div>'
          + '</div>';
      });
    } else {
      h += '<div class="pmp-ai-mini-row pmp-ai-mini-row--info">💡 Aucun historique disponible pour ' + e(pd.equipmentName || 'cet équipement') + '.'
        + '<div class="pmp-ai-mini-why">Pourquoi : car c\'est la première intervention enregistrée sur cet équipement.</div></div>';
    }
    h += '</div>';

    // ── Footer ──
    h += '<div class="pmp-detail-footer" id="pmp-detail-footer-' + missionId + '">'
      + _buildPmpFooter(m, missionId)
      + '</div>';

    h += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
  }

  function _closePmpDetail() {
    var ov = document.getElementById('pmp-detail-ov');
    if (ov) ov.remove();
  }

  function _addPmpComment(missionId) {
    var ta = document.getElementById('pmp-obs-' + missionId);
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;
    var cu = MX.state.currentUser;
    var comment = { text: text, by: cu ? cu.name : '?', ts: Date.now() };
    db.collection('missions').doc(missionId).update({
      pmpComments: FV.arrayUnion(comment),
    }).then(function () {
      ta.value = '';
      MX.toast('Commentaire ajouté ✓');
      var m = _allMissions.find(function (x) { return x.id === missionId; });
      if (m) { if (!m.pmpComments) m.pmpComments = []; m.pmpComments.push(comment); }
      var listEl = document.getElementById('pmp-journal-' + missionId);
      if (listEl) {
        var e2 = MX.esc;
        var initials = _avatarInitials(comment.by);
        var color    = _avatarColor(comment.by);
        var d        = new Date(comment.ts);
        var dateStr  = d.toLocaleDateString('fr-FR');
        var timeStr  = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        listEl.insertAdjacentHTML('beforeend',
          '<div class="pmp-journal-entry">'
          + '<div class="pmp-journal-avatar" style="background:' + color + '">' + initials + '</div>'
          + '<div class="pmp-journal-content">'
          + '<div class="pmp-journal-meta"><span class="pmp-journal-author">' + e2(comment.by) + '</span>'
          + '<span class="pmp-journal-date">' + dateStr + ' · ' + timeStr + '</span></div>'
          + '<div class="pmp-journal-text">' + e2(comment.text) + '</div>'
          + '</div></div>');
      }
    }).catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  function _addPmpPart(missionId) {
    var nameEl = document.getElementById('pmp-p-name-' + missionId);
    var qtyEl  = document.getElementById('pmp-p-qty-'  + missionId);
    if (!nameEl) return;
    var name = nameEl.value.trim();
    if (!name) { MX.toast('Saisissez le nom de la pièce', true); return; }
    var qty = parseInt(qtyEl ? qtyEl.value : '1') || 1;
    var part = { name: name, qty: qty };
    db.collection('missions').doc(missionId).update({ usedParts: FV.arrayUnion(part) })
      .then(function () {
        nameEl.value = ''; if (qtyEl) qtyEl.value = '1';
        MX.toast('Pièce ajoutée ✓');
        var m = _allMissions.find(function (x) { return x.id === missionId; });
        if (m) { if (!m.usedParts) m.usedParts = []; m.usedParts.push(part); }
        var listEl = document.getElementById('pmp-parts-' + missionId);
        if (listEl) {
          var e = MX.esc;
          listEl.insertAdjacentHTML('beforeend', '<div class="int-part-item"><span class="int-part-name">' + e(part.name) + '</span><span class="int-part-qty">× ' + part.qty + '</span></div>');
        }
      }).catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  // ══════════════════════════════════════════════
  // PHOTO (shared between PMP + intervention)
  // ══════════════════════════════════════════════

  function _triggerPmpPhoto(missionId, category) {
    _pendingPmpPh = { missionId: missionId, category: category };
    var inp = document.getElementById('pmp-ph-in');
    if (inp) inp.click();
  }

  function _onPmpPh(input) {
    var ph = _pendingPmpPh;
    if (!ph || !input.files || !input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        var maxW   = 800;
        var scale  = img.width > maxW ? maxW / img.width : 1;
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        var upd = {};
        upd['pmpPhotos.' + ph.category] = FV.arrayUnion(dataUrl);
        db.collection('missions').doc(ph.missionId).update(upd).then(function () {
          var container = document.getElementById('pmp-phcat-' + ph.missionId + '-' + ph.category);
          if (container) {
            var imgEl = document.createElement('img');
            imgEl.src = dataUrl;
            imgEl.className = 'pmp-photo-thumb';
            imgEl.onclick = function () { MX.MM._viewPhoto(dataUrl); };
            container.appendChild(imgEl);
          }
          MX.toast('Photo jointe ✓');
        }).catch(function (err) { MX.toast('Erreur photo: ' + err.message, true); });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function _viewPhoto(src) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    ov.onclick = function () { ov.remove(); };
    var img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain';
    ov.appendChild(img);
    document.body.appendChild(ov);
  }

  // ══════════════════════════════════════════════
  // LIFECYCLE HELPERS v1.0.40
  // ══════════════════════════════════════════════

  function _buildPmpFooter(m, missionId) {
    if (m.done) return '';
    return '<button class="pmp-validate-btn" onclick="MX.MM._confirmTerminePmp(\'' + missionId + '\')">'
      + '<i class="fas fa-circle-check"></i> Valider la maintenance</button>'
      + '<button class="pmp-release-btn" onclick="MX.MM._releasePmpMission(\'' + missionId + '\')">'
      + '<i class="fas fa-arrow-rotate-left"></i> Rendre la maintenance</button>';
  }

  function _updatePmpFooter(missionId) {
    var footerEl = document.getElementById('pmp-detail-footer-' + missionId);
    if (!footerEl) return;
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m) return;
    footerEl.innerHTML = _buildPmpFooter(m, missionId);
  }

  // ══════════════════════════════════════════════
  // CHECKLIST TOGGLE (PMP)
  // ══════════════════════════════════════════════

  function _toggleCheck(missionId, idx, checked) {
    var upd = {};
    upd['completedChecklist.' + idx] = checked;
    db.collection('missions').doc(missionId).update(upd)
      .catch(function (err) { console.warn('[MM] toggleCheck:', err.message); });
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (m) { if (!m.completedChecklist) m.completedChecklist = {}; m.completedChecklist[String(idx)] = checked; }
    var sec = document.querySelector('.pmp-detail-section-ttl i.fa-list-check');
    if (sec && m) {
      var items   = (m.pmpData && m.pmpData.checklistItems) || [];
      var cnt     = Object.keys(m.completedChecklist || {}).filter(function (k) { return m.completedChecklist[k]; }).length;
      var ttl     = sec.closest('.pmp-detail-section-ttl');
      if (ttl) ttl.innerHTML = '<i class="fas fa-list-check"></i> Checklist (' + cnt + '/' + items.length + ')';
    }
  }

  // ══════════════════════════════════════════════
  // LIFECYCLE — RELEASE / CONFIRM / VALIDATE
  // ══════════════════════════════════════════════

  function _takePmpMission(missionId) {
    var cu = MX.state.currentUser;
    if (!cu) { MX.toast('Non connecté', true); return; }
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m) { MX.toast('Mission introuvable', true); return; }
    if (m.takenBy) { MX.toast('Mission déjà prise par ' + m.takenBy, true); return; }
    var now  = new Date();
    var dd   = String(now.getDate()).padStart(2, '0');
    var mo   = String(now.getMonth() + 1).padStart(2, '0');
    var yyyy = now.getFullYear();
    var hh   = String(now.getHours()).padStart(2, '0');
    var min  = String(now.getMinutes()).padStart(2, '0');
    var logText = cu.name + ' a pris cette maintenance\n'
      + dd + '/' + mo + '/' + yyyy + ' - ' + hh + ':' + min;
    var logEntry = { text: logText, by: cu.name, ts: FV.serverTimestamp(), isSystemLog: true };
    db.collection('missions').doc(missionId).update({
      takenBy: cu.name,
      takenAt: FV.serverTimestamp(),
      pmpComments: FV.arrayUnion(logEntry),
    }).then(function () {
      MX.toast('Maintenance prise ✓');
    }).catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  function _releasePmpMission(missionId) {
    document.getElementById('m-title').textContent = 'Rendre la maintenance';
    document.getElementById('m-sub').innerHTML = '<p style="margin:0;color:var(--text2)">La maintenance sera remise disponible pour un autre technicien.<br>Vos commentaires, photos et pièces sont conservés.</p>';
    document.getElementById('m-actions').innerHTML =
      '<button class="modal-btn confirm" style="background:var(--orange);border-color:var(--orange)" onclick="MX.MM._doReleasePmp(\'' + missionId + '\')">'
      + '<i class="fas fa-arrow-rotate-left"></i> Rendre</button>'
      + '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  function _doReleasePmp(missionId) {
    MX.closeModal();
    db.collection('missions').doc(missionId).update({ takenBy: null, takenAt: null })
      .then(function () {
        var m = _allMissions.find(function (x) { return x.id === missionId; });
        if (m) { m.takenBy = null; m.takenAt = null; }
        MX.toast('Maintenance rendue ✓');
        _closePmpDetail();
      }).catch(function (err) { MX.toast('Erreur: ' + err.message, true); });
  }

  function _confirmTerminePmp(missionId) {
    document.getElementById('m-title').textContent = 'Valider cette maintenance ?';
    document.getElementById('m-sub').innerHTML =
      '<p style="margin:0 0 12px;color:var(--text2);font-size:13px">Cette action :</p>'
      + '<div class="pmp-confirm-checks">'
      + '<div class="pmp-confirm-row ok">✓ clôture le PMP</div>'
      + '<div class="pmp-confirm-row ok">✓ programme automatiquement la prochaine maintenance</div>'
      + '<div class="pmp-confirm-row ok">✓ archive cette intervention</div>'
      + '</div>';
    document.getElementById('m-actions').innerHTML =
      '<button class="modal-btn confirm" onclick="MX.MM._validatePmpMission(\'' + missionId + '\');MX.closeModal()">'
      + '<i class="fas fa-check"></i> Valider</button>'
      + '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  async function _validatePmpMission(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m || m.done) return;
    var cu          = MX.state.currentUser;
    var completedBy = cu ? cu.name : (m.takenBy || m.assignedTo || '');
    var today       = new Date().toISOString().slice(0, 10);
    var lastObs     = (m.pmpComments && m.pmpComments.length)
      ? m.pmpComments[m.pmpComments.length - 1].text
      : (m.observations || '');
    var nextDue = null;
    try {
      await db.collection('missions').doc(missionId).update({
        done: true,
        takenBy: m.takenBy || completedBy,
        completedAt: FV.serverTimestamp(),
        completedBy: completedBy,
      });
      if (m.pmpIntId) {
        var histEntry = {
          date: today,
          by: completedBy,
          observations: lastObs,
          completedChecklist: m.completedChecklist || {},
        };
        await db.collection('pmp_interventions').doc(m.pmpIntId).update({
          status: 'terminee', doneDate: today, observations: lastObs,
          doneBy: completedBy,
          completedChecklist: m.completedChecklist || {},
          interventionHistory: FV.arrayUnion(histEntry),
          updatedAt: FV.serverTimestamp(),
        });
        var intSnap = await db.collection('pmp_interventions').doc(m.pmpIntId).get();
        var intData = intSnap.exists ? intSnap.data() : null;
        if (intData && intData.equipmentId) {
          var eqSnap = await db.collection('pmp_equipments').doc(intData.equipmentId).get();
          var eqData = eqSnap.exists ? eqSnap.data() : null;
          if (eqData) {
            var freq = eqData.frequency || 30;
            nextDue  = _addDaysMM(today, freq);
            await db.collection('pmp_equipments').doc(intData.equipmentId).update({
              lastDone: today, nextDue: nextDue, updatedAt: FV.serverTimestamp(),
            });
          }
        }
      }
      var toastMsg = '✅ Maintenance terminée'
        + (nextDue ? ' — Prochaine : ' + _fmtDate(nextDue) : ' ✓');
      MX.toast(toastMsg);
      _closePmpDetail();
    } catch (err) {
      MX.toast('Erreur validation : ' + err.message, true);
    }
  }

  // ══════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════

  function render() {
    var el = document.getElementById('main-content');
    if (!el) return;
    if (MX.Auth.canSeeAll()) {
      return MX.Pages.Checklist.renderForRole
        ? MX.Pages.Checklist.renderForRole()
        : MX.Pages.Checklist.render(MX.todayId());
    }
    if (!MX.state.currentUser) return MX.Pages.Checklist.render(MX.todayId());
    _loadMissions();
    el.innerHTML = _renderTech();
  }

  function setFilter(f) { _curFilter = f; render(); }

  function setMmFilter(f) { _activeFilter = f; render(); }

  function _doMmSearch(q) { _searchQuery = q || ''; render(); }

  function setTab(tab) {
    _activeTab = tab;
    _activeFilter = 'all';
    _searchQuery  = '';
    _markTabSeen(tab);
    render();
  }

  function setPmpSubTab(tab) {
    _pmpSubTab = tab;
    render();
  }

  function setUpcomingRange(n) {
    _upcomingRange = n;
    render();
  }

  function toggle(dayId, slot, taskId) {
    MX.Pages.Checklist.toggle(dayId, slot, taskId);
  }

  function prendre(dayId, slot, taskId) {
    var cu = MX.state.currentUser;
    if (!cu) return MX.toast('Connectez-vous pour prendre une mission', true);
    MX.Pages.Checklist.assignTask(dayId, slot, taskId, cu.name);
    MX.toast('Mission prise ✓');
  }

  function photo(checkKey) {
    _pendingPhKey = checkKey;
    var inp = document.getElementById('mm-ph-in');
    if (inp) inp.click();
  }

  function _onPh(input) {
    var key = _pendingPhKey;
    if (!key || !input.files || !input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        var maxW   = 800;
        var scale  = img.width > maxW ? maxW / img.width : 1;
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        var cu = MX.state.currentUser;
        MX.syncStart && MX.syncStart();
        db.collection('task_photos').doc(key).set(
          { photos: FV.arrayUnion({ data: dataUrl, by: cu ? cu.name : '?', ts: FV.serverTimestamp() }) },
          { merge: true }
        ).then(function () {
          MX.syncEnd && MX.syncEnd();
          MX.toast('Photo jointe ✓');
        }).catch(function (err) {
          MX.syncFail && MX.syncFail();
          MX.toast('Erreur photo: ' + err.message, true);
        });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function signal(checkKey) {
    var parts  = checkKey.split('_');
    var dayId  = parts[0];
    var slot   = parts[1];
    var taskId = parts.slice(2).join('_');
    var tasks  = MX.state.tasks[dayId + '_' + slot] || [];
    var task   = tasks.find(function (t) { return t.id === taskId; });
    var text   = task ? task.text : 'Mission';
    _pendingSignal = { dayId: dayId, slot: slot, taskId: taskId, taskText: text };
    document.getElementById('m-title').textContent = 'Signaler un problème';
    document.getElementById('m-sub').innerHTML
      = '<div style="font-size:12px;color:var(--orange);font-weight:600;margin-bottom:10px">'
      + '<i class="fas fa-triangle-exclamation"></i> ' + MX.esc(text)
      + '</div>'
      + '<textarea id="mm-sig-ta" placeholder="Décrivez le problème rencontré…" '
      + 'style="width:100%;min-height:80px;padding:9px;border:1px solid var(--border2);border-radius:8px;'
      + 'background:var(--bg3);color:var(--text);font-family:var(--ffs);font-size:13px;resize:vertical;box-sizing:border-box"></textarea>';
    document.getElementById('m-actions').innerHTML
      = '<button class="modal-btn confirm" style="background:var(--orange);border-color:var(--orange)" onclick="MX.MM._doSignal()">'
      + '<i class="fas fa-paper-plane"></i> Envoyer</button>'
      + '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
    setTimeout(function () { var ta = document.getElementById('mm-sig-ta'); if (ta) ta.focus(); }, 60);
  }

  function _doSignal() {
    if (!_pendingSignal) return;
    var ta  = document.getElementById('mm-sig-ta');
    var msg = ta ? ta.value.trim() : '';
    if (!msg) { MX.toast('Veuillez décrire le problème', true); return; }
    var s = _pendingSignal;
    _pendingSignal = null;
    MX.closeModal();
    MX.syncStart && MX.syncStart();
    db.collection('logs').add({
      workerName: MX.state.currentUser ? MX.state.currentUser.name : '?',
      action: 'report', taskText: s.taskText, issue: msg,
      dayId: s.dayId, slot: s.slot, taskId: s.taskId,
      ts: FV.serverTimestamp()
    }).then(function () {
      MX.syncEnd && MX.syncEnd();
      MX.toast('Signalement envoyé ✓');
    }).catch(function (err) {
      MX.syncFail && MX.syncFail();
      MX.toast('Erreur: ' + err.message, true);
    });
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.MesMissions = {
    render: render, setFilter: setFilter, setTab: setTab,
    setPmpSubTab: setPmpSubTab, setUpcomingRange: setUpcomingRange,
    setMmFilter: setMmFilter, _doMmSearch: _doMmSearch,
    toggle: toggle, prendre: prendre,
    photo: photo, _onPh: _onPh, signal: signal, _doSignal: _doSignal,
    _acceptMission: _acceptMission,
    _openPmpDetail: _openPmpDetail, _closePmpDetail: _closePmpDetail,
    _openInterventionDetail: _openInterventionDetail, _closeInterventionDetail: _closeInterventionDetail,
    _triggerPmpPhoto: _triggerPmpPhoto, _onPmpPh: _onPmpPh, _viewPhoto: _viewPhoto,
    _toggleCheck: _toggleCheck,
    _takePmpMission: _takePmpMission,
    _releasePmpMission: _releasePmpMission,
    _doReleasePmp: _doReleasePmp, _confirmTerminePmp: _confirmTerminePmp,
    _addPmpComment: _addPmpComment, _addIntComment: _addIntComment,
    _addPmpPart: _addPmpPart, _addIntPart: _addIntPart,
    _validatePmpMission: _validatePmpMission, _validateIntMission: _validateIntMission,
  };
  window.MX.MM = window.MX.Pages.MesMissions;
})();
