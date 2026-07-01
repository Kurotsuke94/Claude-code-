(function () {
  'use strict';

  var FV             = firebase.firestore.FieldValue;
  var _curFilter     = 'all';
  var _pendingPhKey  = null;
  var _pendingSignal = null;

  var SLOT_INFO = {
    matin:   { l: 'Matin',       sub: 'avant 13h',      icon: '☀️'  },
    journee: { l: 'Après-midi',  sub: '13h – 18h',      icon: '🌤'  },
    soir:    { l: 'Soir',        sub: 'fin de service',  icon: '🌙'  }
  };

  var PRI_INFO = {
    critique: { l: 'CRITIQUE', cls: 'mm-pri--crit' },
    haute:    { l: 'URGENT',   cls: 'mm-pri--urg'  },
    normale:  { l: '',         cls: ''             },
    faible:   { l: 'Faible',   cls: 'mm-pri--low'  }
  };

  // ── Gather tasks assigned to the current technician today ──
  function _getMyTasks() {
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

      tasks.forEach(function (task) {
        var mine = task.assignedTo === cu.name
                || (!task.assignedTo && slotAssignee === cu.name);
        var unassigned = !task.assignedTo && !slotAssignee;
        if (!mine && !unassigned) return;
        var ck = key + '_' + task.id;
        result.push({
          id:         task.id,
          text:       task.text || '',
          desc:       task.description || '',
          priority:   task.priority || 'normale',
          slot:       slot,
          dayId:      todayId,
          checkKey:   ck,
          done:       !!(state.checks[ck]),
          note:       (state.notes && state.notes[ck]) || '',
          fromUser:   null,
          mine:       mine,
          unassigned: unassigned
        });
      });
    });

    // Include accepted transfers to this user for today
    (state.transfers || []).forEach(function (tr) {
      if (tr.toUser !== cu.name || tr.status !== 'accepted' || tr.dayId !== todayId) return;
      var ck = tr.dayId + '_' + tr.slot + '_' + tr.taskId;
      if (result.some(function (t) { return t.checkKey === ck; })) return;
      result.push({
        id:       tr.taskId,
        text:     tr.taskText || '',
        desc:     '',
        priority: 'normale',
        slot:     tr.slot,
        dayId:    tr.dayId,
        checkKey: ck,
        done:     !!(state.checks[ck]),
        note:     '',
        fromUser: tr.fromUser
      });
    });

    return result;
  }

  function _applyFilter(tasks, f) {
    if (f === 'prio')    return tasks.filter(function (t) { return t.priority === 'haute' || t.priority === 'critique'; });
    if (f === 'todo')    return tasks.filter(function (t) { return !t.done; });
    if (f === 'matin')   return tasks.filter(function (t) { return t.slot === 'matin'; });
    if (f === 'journee') return tasks.filter(function (t) { return t.slot === 'journee'; });
    if (f === 'soir')    return tasks.filter(function (t) { return t.slot === 'soir'; });
    return tasks;
  }

  // ── Build a single task card ──
  function _card(t) {
    var e   = MX.esc;
    var pri = PRI_INFO[t.priority] || PRI_INFO.normale;
    var si  = SLOT_INFO[t.slot]   || { l: t.slot };
    var ck  = e(t.checkKey);

    var badges = '';
    if (pri.l) badges += '<span class="mm-pri ' + e(pri.cls) + '">' + e(pri.l) + '</span>';
    if (t.category === 'pmp' || t.isPmp) badges += '<span class="mm-pri mm-pri--pmp">🛠️ PMP</span>';
    if (t.fromUser) badges += '<span class="mm-pri mm-pri--xfer">Transféré</span>';

    var descH = t.desc ? '<div class="mm-card-desc">' + e(t.desc) + '</div>' : '';
    var noteH = t.note
      ? '<div class="mm-card-note"><i class="fas fa-note-sticky"></i> ' + e(t.note) + '</div>'
      : '';
    var fromH = t.fromUser
      ? '<div class="mm-card-meta"><span class="mm-card-meta-item"><i class="fas fa-arrow-right-arrow-left"></i> De ' + e(t.fromUser) + '</span></div>'
      : '';

    var dayE  = e(t.dayId);
    var slotE = e(t.slot);
    var idE   = e(t.id);

    if (t.unassigned) {
      return '<div class="mm-card mm-card--avail" data-ck="' + ck + '">'
        + '<div class="mm-card-top">'
        + '<span class="mm-slot-tag mm-slot-tag--' + e(t.slot) + '">' + e(si.l) + '</span>'
        + '<span style="font-size:10px;color:var(--text3);margin-left:auto">Non assigné</span>'
        + '</div>'
        + '<div class="mm-card-title">' + e(t.text) + '</div>'
        + descH
        + '<div class="mm-card-actions">'
        + '<button class="mm-act mm-act--take" onclick="MX.MM.prendre(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')" title="Prendre cette mission"><i class="fas fa-hand-pointer"></i><span>Prendre</span></button>'
        + '</div>'
        + '</div>';
    }

    var valBtn = t.done
      ? '<button class="mm-act mm-act--val mm-act--vdone" onclick="MX.MM.toggle(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')" title="Annuler la validation"><i class="fas fa-circle-check"></i><span>Validée</span></button>'
      : '<button class="mm-act mm-act--val" onclick="MX.MM.toggle(\'' + dayE + '\',\'' + slotE + '\',\'' + idE + '\')" title="Valider la mission"><i class="fas fa-circle-check"></i><span>Valider</span></button>';

    return '<div class="mm-card' + (t.done ? ' mm-card--done' : '') + '" data-ck="' + ck + '">'
      + '<div class="mm-card-top">' + badges
      + '<span class="mm-slot-tag mm-slot-tag--' + e(t.slot) + '">' + e(si.l) + '</span>'
      + '</div>'
      + '<div class="mm-card-title">' + e(t.text) + '</div>'
      + descH + noteH + fromH
      + '<div class="mm-card-actions">'
      + '<button class="mm-act mm-act--photo" onclick="MX.MM.photo(\'' + ck + '\')" title="Joindre une photo"><i class="fas fa-camera"></i><span>Photo</span></button>'
      + '<button class="mm-act mm-act--signal" onclick="MX.MM.signal(\'' + ck + '\')" title="Signaler un problème"><i class="fas fa-triangle-exclamation"></i><span>Signaler</span></button>'
      + valBtn
      + '</div>'
      + '</div>';
  }

  // ── Build the full technician view HTML ──
  function _renderTech(allTasks) {
    var e     = MX.esc;
    var cu    = MX.state.currentUser;
    var today = new Date();
    var JOURS  = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    var MOIS   = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    var dateStr = JOURS[today.getDay()] + ' ' + today.getDate() + ' ' + MOIS[today.getMonth()];

    var myTasks        = allTasks.filter(function (t) { return t.mine; });
    var availableTasks = allTasks.filter(function (t) { return t.unassigned; });

    var done  = myTasks.filter(function (t) { return t.done; }).length;
    var total = myTasks.length;
    var pct   = total ? Math.round(done / total * 100) : 0;
    var pctCol = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--cyan)';
    var status = (done === total && total > 0)
      ? '🎉 Toutes les missions complètes !'
      : total === 0
        ? 'Aucune mission assignée aujourd\'hui'
        : ((total - done) + ' mission' + (total - done > 1 ? 's' : '') + ' restante' + (total - done > 1 ? 's' : ''));

    var nc    = MX.userColors ? MX.userColors(cu.name) : { bg: 'var(--cyan)', fg: '#fff' };
    var avBg  = cu.color || nc.bg;
    var avFg  = cu.color ? (MX._contrastColor ? MX._contrastColor(cu.color) : '#fff') : nc.fg;
    var inits = cu.name.substring(0, 2).toUpperCase();
    var fname = cu.name.split(' ')[0];
    var hour  = today.getHours();
    var greet = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

    var counts = {
      all:     myTasks.length,
      prio:    myTasks.filter(function (t) { return t.priority === 'haute' || t.priority === 'critique'; }).length,
      todo:    myTasks.filter(function (t) { return !t.done; }).length,
      matin:   myTasks.filter(function (t) { return t.slot === 'matin'; }).length,
      journee: myTasks.filter(function (t) { return t.slot === 'journee'; }).length,
      soir:    myTasks.filter(function (t) { return t.slot === 'soir'; }).length
    };

    var filtered = _applyFilter(myTasks, _curFilter);

    // Gamification (reads from rewards module state if available)
    var ru  = (MX.state.rewardsUsers || {})[cu.name] || {};
    var pts = ru.points || 0;
    var str = ru.streak || 0;

    var h = '<div class="mm-wrap">';

    // ── Hero header ──
    h += '<div class="mm-hero"><div class="mm-hero-row">'
      + '<div class="mm-hero-id">'
      + '<div class="mm-hero-av" style="background:' + avBg + ';color:' + avFg + '">' + e(inits) + '</div>'
      + '<div><div class="mm-hero-greet">' + e(greet) + ', <strong>' + e(fname) + '</strong> 👋</div>'
      + '<div class="mm-hero-date">' + e(dateStr) + '</div></div>'
      + '</div>';

    if (pts || str) {
      h += '<div class="mm-hero-chips">';
      if (pts) h += '<div class="mm-chip">🏆 <strong>' + pts + '</strong><span>pts</span></div>';
      if (str) h += '<div class="mm-chip">🔥 <strong>' + str + '</strong><span>j</span></div>';
      h += '</div>';
    }

    h += '</div>'  // mm-hero-row
      + '<div class="mm-hero-prog">'
      + '<div class="mm-prog-labels"><span class="mm-prog-status">' + e(status) + '</span>'
      + '<span class="mm-prog-pct" style="color:' + pctCol + '">' + pct + '%</span></div>'
      + '<div class="mm-prog-track"><div class="mm-prog-fill" style="width:' + pct + '%;background:' + pctCol + '"></div></div>'
      + '<div class="mm-prog-sub">' + done + ' / ' + total + ' missions aujourd\'hui</div>'
      + '</div></div>'; // mm-hero-prog, mm-hero

    // ── Quick filter chips ──
    var FILTERS = [
      { id: 'all',     l: 'Toutes',       icon: '' },
      { id: 'prio',    l: 'Prioritaires', icon: '🔥 ' },
      { id: 'todo',    l: 'À faire',      icon: '⏰ ' },
      { id: 'matin',   l: 'Matin',        icon: '☀️ ' },
      { id: 'journee', l: 'Après-midi',   icon: '🌤 ' },
      { id: 'soir',    l: 'Soir',         icon: '🌙 ' }
    ];

    h += '<div class="mm-filters-bar"><div class="mm-filters">';
    FILTERS.forEach(function (f) {
      var ct  = counts[f.id] !== undefined ? counts[f.id] : '';
      var act = _curFilter === f.id ? ' mm-f--on' : '';
      h += '<button class="mm-f' + act + '" onclick="MX.MM.setFilter(\'' + f.id + '\')">'
         + f.icon + e(f.l)
         + (ct !== '' ? '<span class="mm-f-ct">' + ct + '</span>' : '')
         + '</button>';
    });
    h += '</div></div>';

    // ── Task sections ──
    h += '<div class="mm-sections">';

    if (filtered.length === 0) {
      h += '<div class="mm-empty">'
        + '<div class="mm-empty-ico">' + (total === 0 ? '📋' : '🎯') + '</div>'
        + '<div class="mm-empty-ttl">' + (total === 0 ? 'Aucune mission assignée' : 'Aucune mission dans ce filtre') + '</div>'
        + '<div class="mm-empty-sub">' + (total === 0
            ? 'Votre responsable n\'a pas encore assigné de créneaux pour aujourd\'hui.'
            : 'Essayez un autre filtre ou sélectionnez "Toutes".')
        + '</div></div>';
    } else {
      ['matin', 'journee', 'soir'].forEach(function (slot) {
        var sts = filtered.filter(function (t) { return t.slot === slot; });
        if (!sts.length) return;
        var si      = SLOT_INFO[slot];
        var slDone  = sts.filter(function (t) { return t.done; }).length;
        var allDone = slDone === sts.length;

        h += '<div class="mm-section' + (allDone ? ' mm-section--done' : '') + '">'
          + '<div class="mm-sec-hd">'
          + '<div class="mm-sec-hd-l">'
          + '<span class="mm-sec-dot mm-sec-dot--' + slot + '"></span>'
          + '<span class="mm-sec-ttl">' + si.icon + ' ' + e(si.l) + '</span>'
          + '<span class="mm-sec-sub">' + e(si.sub) + '</span>'
          + '</div>'
          + '<span class="mm-sec-ct' + (allDone ? ' mm-sec-ct--done' : '') + '">' + slDone + '/' + sts.length + '</span>'
          + '</div>'
          + '<div class="mm-cards">';
        sts.forEach(function (task) { h += _card(task); });
        h += '</div></div>';
      });
    }

    if (total > 0 && done === total) {
      h += '<div class="mm-congrats">'
        + '<div class="mm-congrats-ico">🏆</div>'
        + '<div class="mm-congrats-ttl">Missions du jour terminées !</div>'
        + '<div class="mm-congrats-sub">Félicitations ' + e(fname) + ', toutes vos missions sont validées !</div>'
        + '</div>';
    }

    if (availableTasks.length) {
      h += '<div class="mm-section" style="margin-top:8px">'
        + '<div class="mm-sec-hd">'
        + '<div class="mm-sec-hd-l">'
        + '<span class="mm-sec-dot" style="background:var(--text3)"></span>'
        + '<span class="mm-sec-ttl">Missions disponibles</span>'
        + '<span class="mm-sec-sub">Non assignées — cliquez pour prendre</span>'
        + '</div>'
        + '<span class="mm-sec-ct">' + availableTasks.length + '</span>'
        + '</div>'
        + '<div class="mm-cards">';
      availableTasks.forEach(function (task) { h += _card(task); });
      h += '</div></div>';
    }

    h += '</div>'; // mm-sections

    // Hidden file input for photo capture
    h += '<input type="file" id="mm-ph-in" accept="image/*" capture="environment" style="display:none" onchange="MX.MM._onPh(this)">';

    h += '</div>'; // mm-wrap
    return h;
  }

  // ══════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════

  function render() {
    var el = document.getElementById('main-content');
    if (!el) return;
    // Managers & admins get the existing management view
    if (MX.Auth.canSeeAll()) {
      return MX.Pages.Checklist.renderForRole
        ? MX.Pages.Checklist.renderForRole()
        : MX.Pages.Checklist.render(MX.todayId());
    }
    // No user selected yet — show existing daily view (contains user picker)
    if (!MX.state.currentUser) {
      return MX.Pages.Checklist.render(MX.todayId());
    }
    el.innerHTML = _renderTech(_getMyTasks());
  }

  function setFilter(f) {
    _curFilter = f;
    render();
  }

  // Delegates to existing Checklist toggle — writes to Firestore, triggers re-render via listener
  function toggle(dayId, slot, taskId) {
    MX.Pages.Checklist.toggle(dayId, slot, taskId);
  }

  function prendre(dayId, slot, taskId) {
    var cu = MX.state.currentUser;
    if (!cu) return MX.toast('Connectez-vous pour prendre une mission', true);
    MX.Pages.Checklist.assignTask(dayId, slot, taskId, cu.name);
    MX.toast('Mission prise ✓');
  }

  // ── Photo attachment ──
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
    input.value = ''; // reset so same file can be re-selected
  }

  // ── Signaler un problème ──
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
    var s  = _pendingSignal;
    _pendingSignal = null;
    MX.closeModal();
    MX.syncStart && MX.syncStart();
    db.collection('logs').add({
      workerName: MX.state.currentUser ? MX.state.currentUser.name : '?',
      action:     'report',
      taskText:   s.taskText,
      issue:      msg,
      dayId:      s.dayId,
      slot:       s.slot,
      taskId:     s.taskId,
      ts:         FV.serverTimestamp()
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
    render: render, setFilter: setFilter, toggle: toggle,
    prendre: prendre,
    photo: photo, _onPh: _onPh, signal: signal, _doSignal: _doSignal
  };
  window.MX.MM = window.MX.Pages.MesMissions;
})();
