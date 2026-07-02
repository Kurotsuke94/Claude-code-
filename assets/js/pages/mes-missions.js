(function () {
  'use strict';

  var FV = firebase.firestore.FieldValue;

  // ── UI state ──
  var _activeTab    = 'all';     // 'all' | 'checklist' | 'intervention' | 'pmp'
  var _curFilter    = 'all';
  var _pendingPhKey = null;
  var _pendingSignal = null;

  // ── Mission state (single Firestore listener) ──
  var _allMissions    = [];
  var _missionsLoaded = false;
  var _missionsUnsub  = null;

  // ── Chrono + photo state ──
  var _chronoTimer  = null;
  var _chronoMId    = null;
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

  function _loadMissions() {
    if (_missionsLoaded) return;
    var cu = MX.state.currentUser;
    if (!cu || !cu.name) return;
    _missionsLoaded = true;
    _missionsUnsub = db.collection('missions')
      .where('assignedTo', '==', cu.name)
      .onSnapshot(function (snap) {
        _allMissions = snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
        if (!MX.Auth.canSeeAll() && MX.state.currentUser) {
          var el = document.getElementById('main-content');
          if (el && !document.getElementById('pmp-detail-ov') && !document.getElementById('mm-detail-ov')) {
            el.innerHTML = _renderTech();
          }
        }
      }, function (err) { console.warn('[MM] missions listener:', err.message); });
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
          elapsedSeconds:   m.elapsedSeconds || 0,
          chronoRunning:    m.chronoRunning || false,
          chronoStart:      m.chronoStart || null,
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

  function _renderTech() {
    var e       = MX.esc;
    var cu      = MX.state.currentUser;
    var today   = new Date();
    var JOURS   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    var MOIS    = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    var dateStr = JOURS[today.getDay()] + ' ' + today.getDate() + ' ' + MOIS[today.getMonth()];

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

    // Unseen badges (missions from Firestore not yet viewed)
    var unseenInt = _allMissions.filter(function (m) {
      var mt = m.isPmp ? 'pmp' : (m.missionType || 'intervention');
      return mt === 'intervention' && !m.done && _isNew(m.id);
    }).length;
    var unseenPmp = _allMissions.filter(function (m) {
      return (m.isPmp || m.missionType === 'pmp') && !m.done && _isNew(m.id);
    }).length;

    // Tab-filtered list
    var tabFiltered;
    if      (_activeTab === 'checklist')    tabFiltered = myMissions.filter(function (t) { return t.missionType === 'checklist'; });
    else if (_activeTab === 'intervention') tabFiltered = myMissions.filter(function (t) { return t.missionType === 'intervention'; });
    else if (_activeTab === 'pmp')          tabFiltered = myMissions.filter(function (t) { return t.missionType === 'pmp'; });
    else                                    tabFiltered = myMissions;

    // Sort: checklist by slot order, others by dueDate/dayId
    tabFiltered = tabFiltered.slice().sort(function (a, b) {
      var oa = a.sortOrder || 10, ob = b.sortOrder || 10;
      if (oa !== ob) return oa - ob;
      var da = a.dueDate || a.dayId || '', db2 = b.dueDate || b.dayId || '';
      return da < db2 ? -1 : da > db2 ? 1 : 0;
    });

    // Hero info
    var nc    = MX.userColors ? MX.userColors(cu.name) : { bg: 'var(--cyan)', fg: '#fff' };
    var avBg  = cu.color || nc.bg;
    var avFg  = cu.color ? (MX._contrastColor ? MX._contrastColor(cu.color) : '#fff') : nc.fg;
    var inits = cu.name.substring(0, 2).toUpperCase();
    var fname = cu.name.split(' ')[0];
    var hour  = today.getHours();
    var greet = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
    var ru    = (MX.state.rewardsUsers || {})[cu.name] || {};

    var h = '<div class="mm-wrap">';

    // ── Hero ──────────────────────────────────────
    h += '<div class="mm-hero">'
      + '<div class="mm-hero-row">'
      + '<div class="mm-hero-id">'
      + '<div class="mm-hero-av" style="background:' + avBg + ';color:' + avFg + '">' + e(inits) + '</div>'
      + '<div><div class="mm-hero-greet">' + e(greet) + ', <strong>' + e(fname) + '</strong> 👋</div>'
      + '<div class="mm-hero-date">' + e(dateStr) + '</div></div>'
      + '</div>';
    if (ru.points || ru.streak) {
      h += '<div class="mm-hero-chips">';
      if (ru.points) h += '<div class="mm-chip">🏆 <strong>' + ru.points + '</strong><span>pts</span></div>';
      if (ru.streak) h += '<div class="mm-chip">🔥 <strong>' + ru.streak + '</strong><span>j</span></div>';
      h += '</div>';
    }
    h += '</div></div>'; // mm-hero-row, mm-hero

    // ── Summary stats bar ─────────────────────────
    h += '<div class="mm-summary-bar">'
      + '<div class="mm-sum-card"><span class="mm-sum-val">' + totalCount + '</span><span class="mm-sum-lbl">Missions</span></div>'
      + '<div class="mm-sum-card"><span class="mm-sum-val" style="color:' + TC.checklist + '">' + doneCount + '</span><span class="mm-sum-lbl">Terminées</span></div>'
      + '<div class="mm-sum-card"><span class="mm-sum-val">' + todoCount + '</span><span class="mm-sum-lbl">À faire</span></div>'
      + '<div class="mm-sum-card"><span class="mm-sum-val" style="color:' + TC.urgence + '">' + urgentCount + '</span><span class="mm-sum-lbl">Urgentes</span></div>';
    if (newCount) {
      h += '<div class="mm-sum-card mm-sum-card--new"><span class="mm-sum-val" style="color:#f97316">' + newCount + '</span><span class="mm-sum-lbl">Nouvelles</span></div>';
    }
    // Donut progress
    var dashLen = 100;
    var dashFill = Math.round(pct);
    h += '<div class="mm-sum-card mm-sum-card--prog">'
      + '<div class="mm-sum-donut-wrap">'
      + '<svg viewBox="0 0 36 36" class="mm-sum-donut">'
      + '<circle class="mm-sum-donut-bg" cx="18" cy="18" r="15.9"/>'
      + '<circle class="mm-sum-donut-fill" cx="18" cy="18" r="15.9" style="stroke:' + pctCol + ';stroke-dasharray:' + dashFill + ' ' + (100 - dashFill) + '"/>'
      + '</svg>'
      + '<span class="mm-sum-donut-pct" style="color:' + pctCol + '">' + pct + '%</span>'
      + '</div>'
      + '<span class="mm-sum-lbl">Progression</span></div>'
      + '</div>';

    // ── Tab navigation ────────────────────────────
    var TABS = [
      { id: 'all',          l: 'Toutes',       count: totalCount, badge: 0,          col: '' },
      { id: 'checklist',    l: 'Checklists',   count: clCount,    badge: 0,          col: TC.checklist },
      { id: 'intervention', l: 'Interventions',count: intCount,   badge: unseenInt,  col: TC.intervention },
      { id: 'pmp',          l: 'Préventif',    count: pmpCount,   badge: unseenPmp,  col: TC.pmp },
    ];
    h += '<div class="mm-tab-bar">';
    TABS.forEach(function (tab) {
      var active = _activeTab === tab.id;
      h += '<button class="mm-tab' + (active ? ' mm-tab--active' : '') + '"'
        + (active && tab.col ? ' style="border-bottom-color:' + tab.col + ';color:' + tab.col + '"' : '')
        + ' onclick="MX.MM.setTab(\'' + tab.id + '\')">'
        + e(tab.l)
        + '<span class="mm-tab-ct' + (active ? ' mm-tab-ct--active' : '') + '">' + tab.count + '</span>'
        + (tab.badge > 0 ? '<span class="mm-tab-badge">' + tab.badge + '</span>' : '')
        + '</button>';
    });
    h += '</div>';

    // ── Nouvelles missions zone ───────────────────
    if (newCount) {
      h += '<div class="mm-new-zone">'
        + '<div class="mm-new-zone-hd"><i class="fas fa-bell"></i> '
        + newCount + ' nouvelle' + (newCount > 1 ? 's' : '') + ' mission' + (newCount > 1 ? 's' : '') + ' assignée' + (newCount > 1 ? 's' : '')
        + '</div>'
        + '<div class="mm-new-list">';
      newMissions.forEach(function (m) { h += _newMissionCard(m); });
      h += '</div></div>';
    }

    // ── Mission list ──────────────────────────────
    h += '<div class="mm-sections">';

    if (tabFiltered.length === 0 && availableTasks.length === 0) {
      h += '<div class="mm-empty">'
        + '<div class="mm-empty-ico">' + (totalCount === 0 ? '📋' : '🎯') + '</div>'
        + '<div class="mm-empty-ttl">' + (totalCount === 0 ? 'Aucune mission assignée' : 'Aucune mission dans cet onglet') + '</div>'
        + '<div class="mm-empty-sub">' + (totalCount === 0
          ? 'Votre responsable n\'a pas encore assigné de missions pour aujourd\'hui.'
          : 'Consultez un autre onglet.') + '</div></div>';
    } else {
      tabFiltered.forEach(function (task) { h += _missionCard(task); });

      if (totalCount > 0 && doneCount === totalCount && _activeTab === 'all') {
        h += '<div class="mm-congrats">'
          + '<div class="mm-congrats-ico">🏆</div>'
          + '<div class="mm-congrats-ttl">Missions du jour terminées !</div>'
          + '<div class="mm-congrats-sub">Félicitations ' + e(fname) + ', toutes vos missions sont validées !</div>'
          + '</div>';
      }
    }

    // Available unassigned tasks
    if (availableTasks.length && (_activeTab === 'all' || _activeTab === 'checklist')) {
      h += '<div class="mm-section" style="margin-top:8px">'
        + '<div class="mm-sec-hd">'
        + '<div class="mm-sec-hd-l"><span class="mm-sec-dot" style="background:var(--text3)"></span>'
        + '<span class="mm-sec-ttl">Missions disponibles</span>'
        + '<span class="mm-sec-sub">Non assignées</span></div>'
        + '<span class="mm-sec-ct">' + availableTasks.length + '</span></div>'
        + '<div class="mm-cards">';
      availableTasks.forEach(function (task) { h += _availableCard(task); });
      h += '</div></div>';
    }

    h += '</div>'; // mm-sections

    // Hidden inputs
    h += '<input type="file" id="mm-ph-in" accept="image/*" capture="environment" style="display:none" onchange="MX.MM._onPh(this)">';
    h += '<input type="file" id="pmp-ph-in" accept="image/*" capture="environment" style="display:none" onchange="MX.MM._onPmpPh(this)">';

    h += '</div>'; // mm-wrap
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
    var si    = SLOT_INFO[t.slot] || { l: t.slot, icon: '' };
    var isUrg = t.priority === 'haute' || t.priority === 'critique';
    var lc    = isUrg ? TC.urgence : TC.checklist;
    var dayE  = e(t.dayId), slotE = e(t.slot), idE = e(t.id);

    var h = '<div class="mm-card mm-card-v2' + (t.done ? ' mm-card-v2--done' : '') + (isUrg ? ' mm-card-v2--urgent' : '') + '">'
      + '<div class="mm-cv2-bar" style="background:' + lc + '"></div>'
      + '<div class="mm-cv2-body">'
      + '<div class="mm-cv2-top">'
      + '<div class="mm-cv2-top-l">'
      + '<span class="mm-type-bdg mm-type-bdg--cl">' + si.icon + ' ' + e(si.l) + '</span>';
    if (t.priority === 'critique') h += '<span class="mm-pri-bdg mm-pri-bdg--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="mm-pri-bdg mm-pri-bdg--urg">URGENT</span>';
    if (t.fromUser) h += '<span class="mm-pri-bdg mm-pri-bdg--xfer">Transféré</span>';
    h += '</div>'
      + '<div class="mm-cv2-top-r">'
      + (t.done ? '<span class="mm-status-bdg mm-status-bdg--done"><i class="fas fa-check"></i> Validé</span>' : '')
      + '</div></div>';

    h += '<div class="mm-cv2-title">' + e(t.text) + '</div>';
    if (t.desc) h += '<div class="mm-cv2-desc">' + e(t.desc) + '</div>';

    h += '<div class="mm-cv2-meta">';
    if (t.zone) h += '<span class="mm-meta-it"><i class="fas fa-location-dot"></i>' + e(t.zone) + (t.subZone ? ' · ' + e(t.subZone) : '') + '</span>';
    if (t.estimatedDuration) h += '<span class="mm-meta-it"><i class="fas fa-clock"></i>' + e(t.estimatedDuration) + '</span>';
    if (t.note) h += '<span class="mm-meta-it"><i class="fas fa-note-sticky"></i>' + e(t.note) + '</span>';
    h += '</div>';

    h += '<div class="mm-cv2-actions">'
      + '<button class="mm-act-v2 mm-act-v2--icon" onclick="MX.MM.photo(\'' + e(t.checkKey) + '\')" title="Photo"><i class="fas fa-camera"></i></button>'
      + '<button class="mm-act-v2 mm-act-v2--icon" onclick="MX.MM.signal(\'' + e(t.checkKey) + '\')" title="Signaler"><i class="fas fa-triangle-exclamation"></i></button>';
    if (t.done) {
      h += '<button class="mm-act-v2 mm-act-v2--done" onclick="MX.MM.toggle(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')">'
        + '<i class="fas fa-circle-check"></i><span>Validée</span></button>';
    } else {
      h += '<button class="mm-act-v2 mm-act-v2--validate" onclick="MX.MM.toggle(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')">'
        + '<i class="fas fa-circle-check"></i><span>Valider</span></button>';
    }
    h += '</div></div></div>';
    return h;
  }

  function _interventionCard(t) {
    var e     = MX.esc;
    var isUrg = t.priority === 'haute' || t.priority === 'critique';
    var lc    = isUrg ? TC.urgence : TC.intervention;
    var today = new Date().toISOString().slice(0, 10);
    var isLate = t.dueDate && t.dueDate < today;

    var h = '<div class="mm-card mm-card-v2' + (t.done ? ' mm-card-v2--done' : '') + (isLate || isUrg ? ' mm-card-v2--urgent' : '') + '">'
      + '<div class="mm-cv2-bar" style="background:' + lc + '"></div>'
      + '<div class="mm-cv2-body">'
      + '<div class="mm-cv2-top">'
      + '<div class="mm-cv2-top-l"><span class="mm-type-bdg mm-type-bdg--int">🔧 Intervention</span>';
    if (isLate) h += '<span class="mm-pri-bdg mm-pri-bdg--crit">RETARD</span>';
    else if (t.priority === 'critique') h += '<span class="mm-pri-bdg mm-pri-bdg--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="mm-pri-bdg mm-pri-bdg--urg">URGENT</span>';
    h += '</div>'
      + '<div class="mm-cv2-top-r">';
    if (t.dueDate) h += '<span class="mm-due-bdg' + (isLate ? ' mm-due-bdg--late' : '') + '"><i class="fas fa-calendar"></i>' + _fmtDate(t.dueDate) + '</span>';
    if (t.done) h += '<span class="mm-status-bdg mm-status-bdg--done"><i class="fas fa-check"></i> Terminé</span>';
    h += '</div></div>';

    h += '<div class="mm-cv2-title">' + e(t.text) + '</div>';
    if (t.desc) h += '<div class="mm-cv2-desc">' + e(t.desc) + '</div>';

    h += '<div class="mm-cv2-meta">';
    if (t.zone) h += '<span class="mm-meta-it"><i class="fas fa-location-dot"></i>' + e(t.zone) + (t.subZone ? ' · ' + e(t.subZone) : '') + '</span>';
    if (t.estimatedDuration) h += '<span class="mm-meta-it"><i class="fas fa-clock"></i>' + e(t.estimatedDuration) + '</span>';
    h += '</div>';

    h += '<div class="mm-cv2-actions">'
      + '<button class="mm-act-v2 mm-act-v2--open-int" onclick="MX.MM._openInterventionDetail(\'' + e(t.firestoreId || t.id) + '\')">'
      + '<i class="fas fa-folder-open"></i><span>Ouvrir</span></button>'
      + '</div></div></div>';
    return h;
  }

  function _pmpCard(t) {
    var e      = MX.esc;
    var pd     = t.pmpData || {};
    var isUrg  = t.priority === 'haute' || t.priority === 'critique';
    var today  = new Date().toISOString().slice(0, 10);
    var isLate = pd.dueDate && pd.dueDate < today;
    var lc     = isLate ? TC.urgence : (isUrg ? TC.urgence : TC.pmp);
    var items  = pd.checklistItems || [];
    var done   = Object.keys(t.completedChecklist || {}).filter(function (k) { return t.completedChecklist[k]; }).length;

    var h = '<div class="mm-card mm-card-v2' + (isLate ? ' mm-card-v2--urgent' : '') + '">'
      + '<div class="mm-cv2-bar" style="background:' + lc + '"></div>'
      + '<div class="mm-cv2-body">'
      + '<div class="mm-cv2-top">'
      + '<div class="mm-cv2-top-l"><span class="mm-type-bdg mm-type-bdg--pmp">🛠️ Préventif</span>';
    if (isLate) h += '<span class="mm-pri-bdg mm-pri-bdg--crit">RETARD</span>';
    else if (t.priority === 'critique') h += '<span class="mm-pri-bdg mm-pri-bdg--crit">CRITIQUE</span>';
    else if (t.priority === 'haute') h += '<span class="mm-pri-bdg mm-pri-bdg--urg">URGENT</span>';
    h += '</div>'
      + '<div class="mm-cv2-top-r">';
    if (pd.dueDate) h += '<span class="mm-due-bdg' + (isLate ? ' mm-due-bdg--late' : '') + '"><i class="fas fa-calendar"></i>' + _fmtDate(pd.dueDate) + '</span>';
    h += '</div></div>';

    h += '<div class="mm-cv2-title">' + e(pd.equipmentName || t.text) + '</div>';

    h += '<div class="mm-cv2-meta">';
    if (pd.zone) h += '<span class="mm-meta-it"><i class="fas fa-location-dot"></i>' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</span>';
    if (pd.estimatedDuration) h += '<span class="mm-meta-it"><i class="fas fa-clock"></i>' + e(pd.estimatedDuration) + '</span>';
    h += '</div>';

    if (items.length) {
      var pct = Math.round(done / items.length * 100);
      h += '<div class="mm-cv2-prog">'
        + '<div class="mm-cv2-prog-track"><div class="mm-cv2-prog-fill" style="width:' + pct + '%;background:' + TC.pmp + '"></div></div>'
        + '<span class="mm-cv2-prog-lbl">' + done + '/' + items.length + ' tâches</span></div>';
    }

    h += '<div class="mm-cv2-actions">'
      + '<button class="mm-act-v2 mm-act-v2--open-pmp" onclick="MX.MM._openPmpDetail(\'' + e(t.missionId || t.id) + '\')">'
      + '<i class="fas fa-folder-open"></i><span>Ouvrir</span></button>'
      + '</div></div></div>';
    return h;
  }

  function _newMissionCard(m) {
    var e   = MX.esc;
    var tc  = m.missionType === 'pmp' ? TC.pmp : m.missionType === 'intervention' ? TC.intervention : TC.checklist;
    var lbl = m.missionType === 'pmp' ? '🛠️ Préventif' : m.missionType === 'intervention' ? '🔧 Intervention' : '✅ Checklist';
    var fid = e(m.firestoreId || m.id);
    return '<div class="mm-new-card">'
      + '<div class="mm-new-card-type" style="color:' + tc + ';border:1px solid ' + tc + '40;background:' + tc + '15">' + lbl + '</div>'
      + '<div class="mm-new-card-title">' + e(m.text) + '</div>'
      + (m.zone ? '<div class="mm-new-card-meta"><i class="fas fa-location-dot"></i>' + e(m.zone) + '</div>' : '')
      + (m.estimatedDuration ? '<div class="mm-new-card-meta"><i class="fas fa-clock"></i>' + e(m.estimatedDuration) + '</div>' : '')
      + '<button class="mm-new-accept-btn" onclick="MX.MM._acceptMission(\'' + fid + '\')">'
      + '<i class="fas fa-circle-plus"></i> Accepter</button>'
      + '</div>';
  }

  function _availableCard(t) {
    var e  = MX.esc;
    var si = SLOT_INFO[t.slot] || { l: t.slot, icon: '' };
    return '<div class="mm-card mm-card--avail">'
      + '<div class="mm-card-top"><span class="mm-slot-tag mm-slot-tag--' + e(t.slot) + '">' + e(si.l) + '</span>'
      + '<span style="font-size:10px;color:var(--text3);margin-left:auto">Non assigné</span></div>'
      + '<div class="mm-card-title">' + e(t.text) + '</div>'
      + '<div class="mm-card-actions">'
      + '<button class="mm-act mm-act--take" onclick="MX.MM.prendre(\'' + e(t.dayId) + '\',\'' + e(t.slot) + '\',\'' + e(t.id) + '\')">'
      + '<i class="fas fa-hand-pointer"></i><span>Prendre</span></button>'
      + '</div></div>';
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
    var elapsed = m.elapsedSeconds || 0;
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

    // Temps passé / chrono
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-stopwatch"></i> Temps passé</div>'
      + '<div class="pmp-chrono" id="int-chrono-' + missionId + '">'
      + '<div class="pmp-chrono-display" id="int-cd-' + missionId + '">' + _fmtDur(elapsed) + '</div>'
      + '<div class="pmp-chrono-btns" id="int-cb-' + missionId + '">'
      + (m.chronoRunning
          ? '<button class="pmp-chrono-btn pmp-chrono-btn--pause" onclick="MX.MM._pauseIntChrono(\'' + missionId + '\')"><i class="fas fa-pause"></i> Pause</button>'
          : '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._startIntChrono(\'' + missionId + '\')"><i class="fas fa-play"></i> Démarrer</button>')
      + '</div></div></div>';

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

    if (m.chronoRunning && m.chronoStart) _resumeIntChronoUI(missionId, m.chronoStart, elapsed);
  }

  function _closeInterventionDetail() {
    if (_chronoTimer) { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    var ov = document.getElementById('mm-detail-ov');
    if (ov) ov.remove();
  }

  function _startIntChrono(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    var now = Date.now();
    db.collection('missions').doc(missionId).update({ chronoRunning: true, chronoStart: now })
      .catch(function (err) { console.warn('[MM] int chrono start:', err.message); });
    if (m) { m.chronoRunning = true; m.chronoStart = now; }
    _resumeIntChronoUI(missionId, now, m ? (m.elapsedSeconds || 0) : 0);
  }

  function _pauseIntChrono(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (_chronoTimer) { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    var prev    = m ? (m.elapsedSeconds || 0) : 0;
    var start   = m ? (m.chronoStart || Date.now()) : Date.now();
    var elapsed = prev + Math.floor((Date.now() - start) / 1000);
    db.collection('missions').doc(missionId).update({ chronoRunning: false, elapsedSeconds: elapsed })
      .catch(function (err) { console.warn('[MM] int chrono pause:', err.message); });
    if (m) { m.chronoRunning = false; m.elapsedSeconds = elapsed; }
    var display = document.getElementById('int-cd-' + missionId);
    if (display) display.textContent = _fmtDur(elapsed);
    var btns = document.getElementById('int-cb-' + missionId);
    if (btns) btns.innerHTML = '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._startIntChrono(\'' + missionId + '\')"><i class="fas fa-play"></i> Reprendre</button>';
  }

  function _resumeIntChronoUI(missionId, start, prevElapsed) {
    if (_chronoTimer) clearInterval(_chronoTimer);
    _chronoMId = missionId;
    var btns = document.getElementById('int-cb-' + missionId);
    if (btns) btns.innerHTML = '<button class="pmp-chrono-btn pmp-chrono-btn--pause" onclick="MX.MM._pauseIntChrono(\'' + missionId + '\')"><i class="fas fa-pause"></i> Pause</button>';
    _chronoTimer = setInterval(function () {
      var elapsed = prevElapsed + Math.floor((Date.now() - start) / 1000);
      var display = document.getElementById('int-cd-' + missionId);
      if (display) display.textContent = _fmtDur(elapsed);
      else { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    }, 1000);
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
    var elapsed = m.elapsedSeconds || 0;
    if (m.chronoRunning && m.chronoStart) elapsed += Math.floor((Date.now() - m.chronoStart) / 1000);
    if (_chronoTimer && _chronoMId === missionId) { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    try {
      await db.collection('missions').doc(missionId).update({
        done: true, status: 'terminee',
        completedAt: FV.serverTimestamp(),
        completedBy: m.assignedTo || '',
        elapsedSeconds: elapsed,
        chronoRunning: false,
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

  function _openPmpDetail(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m) return;
    var e  = MX.esc;
    var pd = m.pmpData || {};
    var items     = pd.checklistItems || [];
    var completed = m.completedChecklist || {};
    var doneCnt   = Object.keys(completed).filter(function (k) { return completed[k]; }).length;
    var elapsed   = m.elapsedSeconds || 0;
    var pmpComments = m.pmpComments || [];
    var parts       = m.usedParts || [];
    var history     = m.interventionHistory || [];

    var checklist = items.map(function (it, idx) {
      var ck = completed[String(idx)] || completed[idx];
      return '<label class="pmp-ck-item' + (ck ? ' pmp-ck-item--done' : '') + '">'
        + '<input type="checkbox"' + (ck ? ' checked' : '')
        + ' onchange="MX.MM._toggleCheck(\'' + missionId + '\',' + idx + ',this.checked)">'
        + '<span>' + e(it.text || it) + '</span></label>';
    }).join('');

    var h = '<div class="pmp-detail-overlay" id="pmp-detail-ov">'
      + '<div class="pmp-detail-modal">'
      + '<div class="pmp-detail-header">'
      + '<div class="pmp-detail-header-l">'
      + '<div class="pmp-detail-badge">🛠️ Préventif</div>'
      + '<div class="pmp-detail-ttl">' + e(pd.equipmentName || '—') + '</div>'
      + (pd.zone ? '<div class="pmp-detail-sub"><i class="fas fa-location-dot" style="font-size:9px"></i> ' + e(pd.zone) + (pd.subZone ? ' · ' + e(pd.subZone) : '') + '</div>' : '')
      + '</div>'
      + '<button class="pmp-detail-close" onclick="MX.MM._closePmpDetail()"><i class="fas fa-times"></i></button>'
      + '</div>'
      + '<div class="pmp-detail-body">';

    // Équipement info
    var infoItems = [];
    if (pd.ref)               infoItems.push({ l: 'Référence',       v: pd.ref });
    if (pd.family)            infoItems.push({ l: 'Famille',         v: pd.family });
    if (pd.frequency)         infoItems.push({ l: 'Fréquence',       v: pd.frequency + ' jours' });
    if (pd.lastDone)          infoItems.push({ l: 'Dernière inter.',  v: _fmtDate(pd.lastDone) });
    if (pd.dueDate)           infoItems.push({ l: 'Date prévue',     v: _fmtDate(pd.dueDate) });
    if (pd.estimatedDuration) infoItems.push({ l: 'Durée estimée',   v: pd.estimatedDuration });
    if (m.assignedTo)         infoItems.push({ l: 'Technicien',      v: m.assignedTo });
    if (infoItems.length) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-info-circle"></i> Équipement</div>'
        + '<div class="pmp-detail-info-grid">'
        + infoItems.map(function (it) {
            return '<div class="pmp-detail-info-item"><span class="pmp-detail-info-lbl">' + e(it.l) + '</span><span>' + e(it.v) + '</span></div>';
          }).join('')
        + '</div></div>';
    }

    // Consignes techniques
    if (pd.technicalNotes) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-note-sticky"></i> Consignes techniques</div>'
        + '<div class="pmp-detail-notes">' + e(pd.technicalNotes) + '</div></div>';
    }

    // Checklist interactive
    if (items.length) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-list-check"></i> Checklist (' + doneCnt + '/' + items.length + ')</div>'
        + '<div class="pmp-ck-list">' + checklist + '</div></div>';
    }

    // Chrono
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-stopwatch"></i> Chrono</div>'
      + '<div class="pmp-chrono" id="pmp-chrono-' + missionId + '">'
      + '<div class="pmp-chrono-display" id="pmp-cd-' + missionId + '">' + _fmtDur(elapsed) + '</div>'
      + (pd.estimatedDuration ? '<div class="pmp-chrono-ref">Estimé: ' + e(pd.estimatedDuration) + '</div>' : '')
      + '<div class="pmp-chrono-btns" id="pmp-cb-' + missionId + '">'
      + (m.chronoRunning
          ? '<button class="pmp-chrono-btn pmp-chrono-btn--pause" onclick="MX.MM._pauseChrono(\'' + missionId + '\')"><i class="fas fa-pause"></i> Pause</button>'
          : '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._startChrono(\'' + missionId + '\')"><i class="fas fa-play"></i> Démarrer</button>')
      + '</div></div></div>';

    // Commentaires horodatés
    h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-comment"></i> Commentaires terrain</div>';
    if (pmpComments.length) {
      h += '<div class="int-comments-list">';
      pmpComments.forEach(function (c) {
        h += '<div class="int-comment"><div class="int-comment-meta"><span class="int-comment-by">' + e(c.by || '') + '</span>'
          + '<span class="int-comment-ts">' + (c.ts ? new Date(c.ts).toLocaleString('fr-FR') : '') + '</span></div>'
          + '<div class="int-comment-text">' + e(c.text || '') + '</div></div>';
      });
      h += '</div>';
    }
    h += '<div class="int-comment-add">'
      + '<textarea class="fi" id="pmp-obs-' + missionId + '" rows="2" placeholder="Observations, anomalies, travaux effectués…" style="resize:vertical;width:100%;box-sizing:border-box;margin-bottom:5px">' + e(m.observations || '') + '</textarea>'
      + '<button class="pmp-chrono-btn pmp-chrono-btn--start" style="width:100%" onclick="MX.MM._addPmpComment(\'' + missionId + '\')">'
      + '<i class="fas fa-paper-plane"></i> Ajouter</button>'
      + '</div></div>';

    // Photos avant/pendant/après
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
      + '<input class="fi" id="pmp-p-name-' + missionId + '" placeholder="Pièce" style="flex:1;min-width:0">'
      + '<input class="fi" id="pmp-p-qty-'  + missionId + '" placeholder="Qté" type="number" min="1" style="width:64px">'
      + '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._addPmpPart(\'' + missionId + '\')" style="flex-shrink:0"><i class="fas fa-plus"></i></button>'
      + '</div></div>';

    // Historique des interventions précédentes
    if (history.length) {
      h += '<div class="pmp-detail-section"><div class="pmp-detail-section-ttl"><i class="fas fa-history"></i> Historique</div>'
        + '<div class="int-comments-list">';
      history.slice(-3).reverse().forEach(function (hx) {
        h += '<div class="int-comment"><div class="int-comment-meta"><span class="int-comment-by">' + e(hx.by || '') + '</span>'
          + '<span class="int-comment-ts">' + e(hx.date || '') + '</span></div>'
          + '<div class="int-comment-text">Durée: ' + _fmtDur(hx.realDuration || 0) + (hx.observations ? ' · ' + e(hx.observations) : '') + '</div></div>';
      });
      h += '</div></div>';
    }

    // Validate footer
    h += '<div class="pmp-detail-footer">'
      + '<button class="pmp-validate-btn' + (m.done ? ' pmp-validate-btn--done' : '') + '" onclick="MX.MM._validatePmpMission(\'' + missionId + '\')">'
      + (m.done ? '<i class="fas fa-circle-check"></i> Mission validée' : '<i class="fas fa-check"></i> Valider la mission')
      + '</button></div>';

    h += '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);

    if (m.chronoRunning && m.chronoStart) _resumeChronoUI(missionId, m.chronoStart, elapsed);
  }

  function _closePmpDetail() {
    if (_chronoTimer) { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
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
      pmpComments: FV.arrayUnion(comment), observations: text,
    }).then(function () {
      ta.value = '';
      MX.toast('Commentaire ajouté ✓');
      var m = _allMissions.find(function (x) { return x.id === missionId; });
      if (m) { if (!m.pmpComments) m.pmpComments = []; m.pmpComments.push(comment); }
      var listEl = document.querySelector('#pmp-detail-ov .int-comments-list');
      if (!listEl) {
        var addEl = document.querySelector('#pmp-detail-ov .int-comment-add');
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
        nameEl.value = ''; if (qtyEl) qtyEl.value = '';
        MX.toast('Pièce ajoutée ✓');
        var m = _allMissions.find(function (x) { return x.id === missionId; });
        if (m) { if (!m.usedParts) m.usedParts = []; m.usedParts.push(part); }
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
        var cap = ph.category.charAt(0).toUpperCase() + ph.category.slice(1);
        upd['photo' + cap] = dataUrl;
        db.collection('missions').doc(ph.missionId).update(upd).then(function () {
          var cell = document.querySelector('.pmp-photo-cell[data-cat="' + ph.category + '"]');
          if (cell) cell.innerHTML = '<img src="' + dataUrl + '" class="pmp-photo-thumb">';
          MX.toast('Photo jointe ✓');
        }).catch(function (err) { MX.toast('Erreur photo: ' + err.message, true); });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
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
  // PMP CHRONO
  // ══════════════════════════════════════════════

  function _startChrono(missionId) {
    var m   = _allMissions.find(function (x) { return x.id === missionId; });
    var now = Date.now();
    db.collection('missions').doc(missionId).update({ chronoRunning: true, chronoStart: now })
      .catch(function (err) { console.warn('[MM] chrono start:', err.message); });
    if (m) { m.chronoRunning = true; m.chronoStart = now; }
    _resumeChronoUI(missionId, now, m ? (m.elapsedSeconds || 0) : 0);
  }

  function _pauseChrono(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (_chronoTimer) { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    var prev    = m ? (m.elapsedSeconds || 0) : 0;
    var start   = m ? (m.chronoStart || Date.now()) : Date.now();
    var elapsed = prev + Math.floor((Date.now() - start) / 1000);
    db.collection('missions').doc(missionId).update({ chronoRunning: false, elapsedSeconds: elapsed })
      .catch(function (err) { console.warn('[MM] chrono pause:', err.message); });
    if (m) { m.chronoRunning = false; m.elapsedSeconds = elapsed; }
    var display = document.getElementById('pmp-cd-' + missionId);
    if (display) display.textContent = _fmtDur(elapsed);
    var btns = document.getElementById('pmp-cb-' + missionId);
    if (btns) btns.innerHTML = '<button class="pmp-chrono-btn pmp-chrono-btn--start" onclick="MX.MM._startChrono(\'' + missionId + '\')"><i class="fas fa-play"></i> Reprendre</button>';
  }

  function _resumeChronoUI(missionId, start, prevElapsed) {
    if (_chronoTimer) clearInterval(_chronoTimer);
    _chronoMId = missionId;
    var btns = document.getElementById('pmp-cb-' + missionId);
    if (btns) btns.innerHTML = '<button class="pmp-chrono-btn pmp-chrono-btn--pause" onclick="MX.MM._pauseChrono(\'' + missionId + '\')"><i class="fas fa-pause"></i> Pause</button>';
    _chronoTimer = setInterval(function () {
      var elapsed = prevElapsed + Math.floor((Date.now() - start) / 1000);
      var display = document.getElementById('pmp-cd-' + missionId);
      if (display) display.textContent = _fmtDur(elapsed);
      else { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    }, 1000);
  }

  // ══════════════════════════════════════════════
  // VALIDATE PMP MISSION
  // ══════════════════════════════════════════════

  async function _validatePmpMission(missionId) {
    var m = _allMissions.find(function (x) { return x.id === missionId; });
    if (!m || m.done) return;
    var obsEl   = document.getElementById('pmp-obs-' + missionId);
    var obs     = obsEl ? obsEl.value.trim() : (m.observations || '');
    var today   = new Date().toISOString().slice(0, 10);
    var elapsed = m.elapsedSeconds || 0;
    if (m.chronoRunning && m.chronoStart) elapsed += Math.floor((Date.now() - m.chronoStart) / 1000);
    if (_chronoTimer && _chronoMId === missionId) { clearInterval(_chronoTimer); _chronoTimer = null; _chronoMId = null; }
    try {
      await db.collection('missions').doc(missionId).update({
        done: true, observations: obs,
        completedAt: FV.serverTimestamp(),
        completedBy: m.assignedTo || '',
        elapsedSeconds: elapsed, chronoRunning: false,
      });
      if (m.pmpIntId) {
        var histEntry = {
          date: today, by: m.assignedTo || '',
          realDuration: elapsed, observations: obs,
          completedChecklist: m.completedChecklist || {},
        };
        await db.collection('pmp_interventions').doc(m.pmpIntId).update({
          status: 'terminee', doneDate: today, observations: obs,
          doneBy: m.assignedTo || '', realDuration: elapsed,
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
            var freq    = eqData.frequency || 30;
            var nextDue = _addDaysMM(today, freq);
            await db.collection('pmp_equipments').doc(intData.equipmentId).update({
              lastDone: today, nextDue: nextDue, updatedAt: FV.serverTimestamp(),
            });
          }
        }
      }
      MX.toast('Mission PMP validée ✓');
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

  function setTab(tab) {
    _activeTab = tab;
    _markTabSeen(tab);
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
    toggle: toggle, prendre: prendre,
    photo: photo, _onPh: _onPh, signal: signal, _doSignal: _doSignal,
    _acceptMission: _acceptMission,
    _openPmpDetail: _openPmpDetail, _closePmpDetail: _closePmpDetail,
    _openInterventionDetail: _openInterventionDetail, _closeInterventionDetail: _closeInterventionDetail,
    _triggerPmpPhoto: _triggerPmpPhoto, _onPmpPh: _onPmpPh,
    _toggleCheck: _toggleCheck,
    _startChrono: _startChrono, _pauseChrono: _pauseChrono,
    _startIntChrono: _startIntChrono, _pauseIntChrono: _pauseIntChrono,
    _addPmpComment: _addPmpComment, _addIntComment: _addIntComment,
    _addPmpPart: _addPmpPart, _addIntPart: _addIntPart,
    _validatePmpMission: _validatePmpMission, _validateIntMission: _validateIntMission,
  };
  window.MX.MM = window.MX.Pages.MesMissions;
})();
