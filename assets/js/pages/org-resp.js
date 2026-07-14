(function () {
  'use strict';
  const FV = firebase.firestore.FieldValue;

  // ── SLOT INFO ──
  const SLOT_INFO = {
    matin:   { l: 'Matin',   icon: 'fa-sun',       color: '#F59E0B', bg: 'rgba(245,158,11,.10)', time: '06h – 14h' },
    journee: { l: 'Journée', icon: 'fa-cloud-sun',  color: '#3B82F6', bg: 'rgba(59,130,246,.10)', time: '09h – 17h' },
    soir:    { l: 'Soir',    icon: 'fa-moon',       color: '#8B5CF6', bg: 'rgba(139,92,246,.10)', time: '14h – 22h' },
  };

  // ── DEFAULT ORG TASKS ──
  const DEFAULT_ORG_TASKS = [
    { title: 'Contrôle carnets sécurité',          category: 'sécurité',      description: '', type: 'hebdomadaire' },
    { title: 'Vérification registre piscine',       category: 'réglementaire', description: '', type: 'hebdomadaire' },
    { title: 'Contrôle stock EPI',                  category: 'stock',         description: '', type: 'hebdomadaire' },
    { title: 'Contrôle affichages réglementaires',  category: 'réglementaire', description: '', type: 'hebdomadaire' },
    { title: 'Vérification contrats prestataires',  category: 'administratif', description: '', type: 'hebdomadaire' },
    { title: 'Contrôle chambres PMR',               category: 'hébergement',   description: '', type: 'hebdomadaire' },
  ];

  // ── STATE ──
  let _tasks      = [];
  let _unsub      = null;
  let _unsubCfg   = null;
  let _weekKey    = null;
  let _inHistory  = false;
  let _tab        = 'planning'; // 'planning' | 'tasks'
  let _slotConfig = {};         // { dayId: string[] } — active slots per day this week
  let _templates  = [];         // org_templates docs
  let _dayExpanded  = {};       // { dayId: bool }
  let _dragData     = null;     // { taskId, srcDayId, srcSlot }
  let _weekOffset   = 0;        // 0 = current week, -1 = last week, +1 = next week
  let _slotNames    = {};       // { 'dayId_slot': customName } — persisted in org_config

  // ── WEEK HELPERS ──
  function _isoWk(d) {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return { y: tmp.getUTCFullYear(), n: Math.ceil((((tmp - ys) / 86400000) + 1) / 7) };
  }
  function _getWeekKey(d) {
    const wk = _isoWk(d || new Date());
    return `${wk.y}_W${String(wk.n).padStart(2, '0')}`;
  }
  function _weekKeyToDates(weekKey) {
    const [year, wStr] = weekKey.split('_W');
    const y = parseInt(year), w = parseInt(wStr);
    const jan4 = new Date(y, 0, 4);
    const dayOfWeek = (jan4.getDay() + 6) % 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + (w - 1) * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days; // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  }
  function _weekLabel(weekKey) {
    const parts = weekKey.split('_W');
    const wn = parseInt(parts[1]);
    try {
      const dates = _weekKeyToDates(weekKey);
      const fmt = x => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      return `S.${wn} — ${fmt(dates[0])} au ${fmt(dates[6])} ${parts[0]}`;
    } catch(e) {
      return `Semaine ${wn} — ${parts[0]}`;
    }
  }
  function _offsetWeekKey(baseKey, offset) {
    const dates = _weekKeyToDates(baseKey);
    const ref = new Date(dates[0]);
    ref.setDate(ref.getDate() + offset * 7);
    return _getWeekKey(ref);
  }
  function _todayDayId() {
    const idx = new Date().getDay();
    return MX.DAYS[idx === 0 ? 6 : idx - 1].id;
  }
  function _isCurrentWeek() { return _weekOffset === 0; }
  function _getDateForDay(weekKey, dayId) {
    const dates = _weekKeyToDates(weekKey);
    const idx = MX.DAYS.findIndex(d => d.id === dayId);
    return idx >= 0 ? dates[idx] : null;
  }
  function _fmtDate(d) {
    if (!d) return '';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function _isToday(weekKey, dayId) {
    if (!_isCurrentWeek()) return false;
    return dayId === _todayDayId();
  }

  // ── SLOT CONFIG HELPERS ──
  function _getDefaultSlots(dayId) {
    return MX.getDaySlots(dayId); // hardcoded defaults
  }
  function _getActiveSlots(dayId) {
    if (_slotConfig[dayId]) return _slotConfig[dayId];
    return _getDefaultSlots(dayId);
  }
  function _getSlotName(dayId, slot) {
    return _slotNames[dayId + '_' + slot] || SLOT_INFO[slot]?.l || slot;
  }

  // ── USER / DISPLAY HELPERS ──
  function _fmtDT(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
           ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function _initials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }
  function _ucolor(name) {
    if (!name) return '#6B7280';
    const cols = ['#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B','#EF4444','#06B6D4'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
    return cols[Math.abs(h) % cols.length];
  }
  function _catConfig(cat) {
    const m = {
      'sécurité':      { color: '#EF4444', icon: 'fa-shield-halved' },
      'réglementaire': { color: '#F59E0B', icon: 'fa-scale-balanced' },
      'stock':         { color: '#3B82F6', icon: 'fa-boxes-stacked' },
      'administratif': { color: '#06B6D4', icon: 'fa-file-lines' },
      'hébergement':   { color: '#8B5CF6', icon: 'fa-bed' },
    };
    return m[cat] || { color: '#6B7280', icon: 'fa-tag' };
  }
  function _prioConfig(prio) {
    if (prio === 'critique') return { label: 'Critique', color: '#DC2626', bg: 'rgba(220,38,38,.12)', icon: '🚨' };
    if (prio === 'urgente')  return { label: 'Urgente',  color: '#EF4444', bg: 'rgba(239,68,68,.10)', icon: '🔴' };
    if (prio === 'haute')    return { label: 'Haute',    color: '#F59E0B', bg: 'rgba(245,158,11,.10)', icon: '🟠' };
    return null;
  }
  function _currentUserName() {
    const cu = MX.state.currentUser;
    const ad = MX.state.adminUser;
    if (cu) return cu.name;
    if (ad) return (ad.email || 'admin').split('@')[0];
    return 'Inconnu';
  }
  function _getUserOptions(selected) {
    const users = (MX.state.users || []);
    let opts = `<option value="">— Non assigné —</option>`;
    users.forEach(u => {
      const n = u.name || '';
      opts += `<option value="${MX.esc(n)}"${n === selected ? ' selected' : ''}>${MX.esc(n)}</option>`;
    });
    return opts;
  }
  function _typeBadge(type) {
    if (type === 'unique')    return `<span class="or-badge or-badge--type-uni">📌 Unique</span>`;
    if (type === 'mensuelle') return `<span class="or-badge or-badge--type-men">🗓 Mensuelle</span>`;
    return `<span class="or-badge or-badge--type-rec">♻️ Récurrente</span>`;
  }

  // ── ERROR HANDLER ──
  function _onFirestoreError(err, ctx) {
    console.error(`[OrgResp] Firestore (${ctx}):`, err.message || err);
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page">
      <div class="or-header"><div class="or-header-left"><div class="or-title">Centre de Pilotage</div></div></div>
      <div class="or-empty-state">
        <i class="fas fa-triangle-exclamation" style="font-size:36px;color:var(--red)"></i>
        <div style="font-size:15px;font-weight:700">Erreur de chargement</div>
        <div style="font-size:13px;color:var(--text2)">${MX.esc(err.message || String(err))}</div>
        <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-rotate-right"></i> Réessayer</button>
      </div>
    </div>`;
  }

  // ── SEED ──
  async function _seedWeek(weekKey) {
    try {
      const snap = await db.collection('org_tasks').where('weekKey', '==', weekKey).limit(1).get();
      if (!snap.empty) return;
      const name = _currentUserName();
      const batch = db.batch();
      DEFAULT_ORG_TASKS.forEach((t, i) => {
        batch.set(db.collection('org_tasks').doc(), {
          ...t, weekKey, done: false, status: 'todo',
          doneBy: null, doneAt: null, comment: null,
          assignedTo: null, priority: 'normale',
          createdBy: name, createdAt: FV.serverTimestamp(), order: i, isDefault: true,
        });
      });
      await batch.commit();
    } catch(e) { console.warn('[OrgResp] seed init:', e.message); return; }
    try {
      const prevDate = new Date(); prevDate.setDate(prevDate.getDate() - 7);
      const prevKey  = _getWeekKey(prevDate);
      const prevSnap = await db.collection('org_tasks')
        .where('weekKey', '==', prevKey).where('isDefault', '==', false).get();
      const recurring = prevSnap.docs.map(d => d.data()).filter(t => t.type === 'hebdomadaire');
      if (recurring.length > 0) {
        const name = _currentUserName();
        const b2   = db.batch();
        recurring.forEach((t, i) => {
          b2.set(db.collection('org_tasks').doc(), {
            title: t.title, description: t.description || '', category: t.category || 'autre',
            type: 'hebdomadaire', weekKey, done: false, status: 'todo',
            doneBy: null, doneAt: null, comment: null,
            assignedTo: t.assignedTo || null, priority: t.priority || 'normale',
            createdBy: t.createdBy || name, createdAt: FV.serverTimestamp(),
            order: DEFAULT_ORG_TASKS.length + i, isDefault: false,
          });
        });
        await b2.commit();
      }
    } catch(e) { console.warn('[OrgResp] carry-over:', e.message); }
  }

  // ── SUBSCRIPTIONS ──
  function _subscribe(weekKey) {
    if (_unsub) { _unsub(); _unsub = null; }
    if (_unsubCfg) { _unsubCfg(); _unsubCfg = null; }

    // Listen to tasks
    try {
      _unsub = db.collection('org_tasks')
        .where('weekKey', '==', weekKey)
        .onSnapshot(
          snap => {
            _tasks = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            if (!_inHistory) _doRender();
          },
          err => _onFirestoreError(err, 'subscribe-tasks')
        );
    } catch(e) { _onFirestoreError(e, 'subscribe-tasks-setup'); }

    // Listen to slot config
    try {
      _unsubCfg = db.collection('org_config').doc(weekKey)
        .onSnapshot(
          snap => {
            const cfgData = snap.exists ? snap.data() : {};
            _slotConfig = cfgData.slotConfig || {};
            _slotNames  = cfgData.slotNames  || {};
            if (!_inHistory) _doRender();
          },
          err => console.warn('[OrgResp] cfg:', err.message)
        );
    } catch(e) { console.warn('[OrgResp] cfg-setup:', e.message); }

    // Load templates once
    db.collection('org_templates').get()
      .then(snap => { _templates = snap.docs.map(d => ({ id: d.id, ...d.data() })); })
      .catch(e => console.warn('[OrgResp] templates:', e.message));

    _seedWeek(weekKey).catch(e => console.warn('[OrgResp] seed:', e.message));
  }

  // ── ENTRY POINT ──
  function render() {
    if (!MX.Auth.canSeeAll()) {
      const mc = document.getElementById('main-content');
      if (mc) mc.innerHTML = `<div class="or-page"><div class="or-empty-state"><i class="fas fa-lock" style="font-size:32px;color:var(--text3)"></i><div>Accès réservé aux responsables</div></div></div>`;
      return;
    }
    _inHistory  = false;
    _weekOffset = 0;
    _weekKey    = _getWeekKey(new Date());
    if (!_tab) _tab = 'planning';
    _subscribe(_weekKey);
  }

  function _doRender() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    try {
      if (_tab === 'tasks') _renderKanban(mc);
      else _renderPlanning(mc);
    } catch(e) {
      console.error('[OrgResp] render error:', e);
      mc.innerHTML = `<div class="or-page"><div class="or-empty-state"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PLANNING VIEW
  // ═══════════════════════════════════════════════════════
  function _renderPlanning(mc) {
    const weekDates = _weekKeyToDates(_weekKey);
    const isCurrentWk = _isCurrentWeek();
    const todayDayId  = _todayDayId();

    // Global stats
    const planTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId);
    const planDone  = planTasks.filter(t => t.done).length;
    const planTotal = planTasks.length;
    const pct       = planTotal ? Math.round(planDone / planTotal * 100) : 0;
    const pctC      = pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';

    let h = `<div class="or-page or-page--planning">
      <div class="or-header">
        <div class="or-header-left">
          <div class="or-title">Centre de Pilotage</div>
          <div class="or-week-label">${_weekLabel(_weekKey)}</div>
        </div>
        <div class="or-header-right">
          <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.renderHistory()">
            <i class="fas fa-clock-rotate-left"></i><span class="or-btn-lbl"> Historique</span>
          </button>
          <button class="or-btn-primary" onclick="MX.Pages.OrgResp.openDuplicateWeek()">
            <i class="fas fa-calendar-week"></i><span class="or-btn-lbl"> Dupliquer semaine</span>
          </button>
        </div>
      </div>

      <!-- Week navigation -->
      <div class="or-week-nav">
        <button class="or-week-nav-btn" onclick="MX.Pages.OrgResp._prevWeek()" title="Semaine précédente">
          <i class="fas fa-chevron-left"></i>
        </button>
        <div class="or-week-nav-info">
          ${isCurrentWk ? '<span class="or-week-cur-badge">Semaine en cours</span>' : ''}
          ${!isCurrentWk ? `<button class="or-week-nav-today" onclick="MX.Pages.OrgResp._goToCurrentWeek()"><i class="fas fa-house"></i> Aujourd'hui</button>` : ''}
        </div>
        <button class="or-week-nav-btn" onclick="MX.Pages.OrgResp._nextWeek()" title="Semaine suivante">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>

      <!-- Tabs -->
      <div class="or-tabs">
        <button class="or-tab or-tab--active" onclick="MX.Pages.OrgResp._setTab('planning')">
          <i class="fas fa-calendar-days"></i> Planning
          ${planTotal > 0 ? `<span class="or-tab-cnt">${planDone}/${planTotal}</span>` : ''}
        </button>
        <button class="or-tab" onclick="MX.Pages.OrgResp._setTab('tasks')">
          <i class="fas fa-list-check"></i> Tâches hebdo
          ${(() => { const kt = _tasks.filter(t => !t.archivedFromActive && !t.dayId); const kd = kt.filter(t => t.done).length; return kt.length > 0 ? `<span class="or-tab-cnt">${kd}/${kt.length}</span>` : ''; })()}
        </button>
      </div>`;

    // Progress bar if tasks exist
    if (planTotal > 0) {
      h += `<div class="or-progress-bar" style="margin-bottom:16px">
        <div class="or-progress-track"><div class="or-progress-fill" style="width:${pct}%;background:${pctC}"></div></div>
        <span class="or-progress-lbl" style="color:${pctC}">${pct}% — ${planDone}/${planTotal}</span>
      </div>`;
    }

    h += `<div class="or-planning-days">`;

    MX.DAYS.forEach((day, idx) => {
      const dayId    = day.id;
      const date     = weekDates[idx];
      const dateStr  = _fmtDate(date);
      const isToday  = isCurrentWk && dayId === todayDayId;
      const expanded = _dayExpanded[dayId] !== false; // default expanded
      const activeSlots = _getActiveSlots(dayId);
      const defaultSlots = _getDefaultSlots(dayId);

      // Stats for this day
      const dayTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
      const dayDone  = dayTasks.filter(t => t.done).length;
      const dayTotal = dayTasks.length;
      const dayPct   = dayTotal ? Math.round(dayDone / dayTotal * 100) : 0;
      const dayPctC  = dayPct >= 80 ? '#10B981' : dayPct >= 40 ? '#F59E0B' : '#EF4444';

      // Slot previews (pills)
      const allSlots = ['matin', 'journee', 'soir'];
      const slotPreviews = allSlots.map(s => {
        const active = activeSlots.includes(s);
        const info   = SLOT_INFO[s];
        const cnt    = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId && t.slot === s).length;
        return `<span class="or-slot-pill${active ? '' : ' or-slot-pill--off'}" style="${active ? `color:${info.color}` : ''}">
          <i class="fas ${info.icon}"></i> ${info.l}${cnt > 0 ? ` <b>${cnt}</b>` : ''}
        </span>`;
      }).join('');

      h += `<div class="or-day-card${isToday ? ' or-day-card--today' : ''}" id="or-day-${dayId}">
        <div class="or-day-hdr" onclick="MX.Pages.OrgResp._toggleDay('${dayId}')">
          <div class="or-day-info">
            <div class="or-day-name">
              ${day.l}
              ${isToday ? '<span class="or-day-today-badge">Aujourd\'hui</span>' : ''}
            </div>
            <div class="or-day-date">${dateStr}</div>
          </div>
          <div class="or-day-center">
            <div class="or-day-slots-preview">${slotPreviews}</div>
          </div>
          <div class="or-day-right">
            ${dayTotal > 0 ? `<span class="or-day-stat" style="color:${dayPctC}">${dayDone}/${dayTotal}</span>` : ''}
            <div class="or-day-actions" onclick="event.stopPropagation()">
              <button class="or-day-btn" onclick="MX.Pages.OrgResp.openDuplicateDay('${dayId}')" title="Dupliquer cette journée">
                <i class="fas fa-copy"></i>
              </button>
              <button class="or-day-btn" onclick="MX.Pages.OrgResp.openDayMenu('${dayId}', this)" title="Actions">
                <i class="fas fa-ellipsis-vertical"></i>
              </button>
            </div>
            <i class="fas fa-chevron-${expanded ? 'up' : 'down'} or-day-chev" id="or-day-chev-${dayId}"></i>
          </div>
        </div>`;

      if (expanded) {
        h += `<div class="or-day-body" id="or-day-body-${dayId}">`;

        if (activeSlots.length === 0) {
          h += `<div class="or-day-empty"><i class="fas fa-ban"></i> Tous les créneaux sont désactivés pour cette journée.
            <button class="or-link-btn" onclick="MX.Pages.OrgResp.openSlotConfig('${dayId}')">Configurer</button>
          </div>`;
        } else {
          // Show all defined slots, mark disabled ones
          ['matin', 'journee', 'soir'].forEach(slot => {
            // Only show slot if it's in the default for this day OR in the active list
            if (!defaultSlots.includes(slot) && !activeSlots.includes(slot)) return;
            const disabled  = !activeSlots.includes(slot);
            const info      = SLOT_INFO[slot];
            const slotKey   = `${dayId}_${slot}`;
            const slotTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId && t.slot === slot);
            const doneCnt   = slotTasks.filter(t => t.done).length;
            const total     = slotTasks.length;

            h += `<div class="or-slot${disabled ? ' or-slot--disabled' : ''}" id="or-slot-${slotKey}">
              <div class="or-slot-hdr">
                <i class="fas ${info.icon} or-slot-ico${disabled ? ' or-slot-ico--disabled' : ''}" style="${!disabled ? `color:${info.color}` : ''}"></i>
                <span class="or-slot-label${disabled ? ' or-slot-label--disabled' : ''}">${_getSlotName(dayId, slot)}</span>
                <span class="or-slot-time">${info.time}</span>
                ${total > 0 ? `<span class="or-slot-cnt" style="color:${doneCnt===total?'#10B981':'var(--text3)'}">${doneCnt}/${total}</span>` : ''}
                <div class="or-slot-hdr-actions">
                  ${!disabled ? `<button class="or-slot-add-btn" onclick="MX.Pages.OrgResp.openAddDayTask('${dayId}','${slot}')" title="Ajouter une tâche"><i class="fas fa-plus"></i></button>` : ''}
                  <button class="or-slot-menu-btn" onclick="MX.Pages.OrgResp.openSlotMenu('${dayId}','${slot}',this)" title="Options"><i class="fas fa-ellipsis-vertical"></i></button>
                </div>
              </div>`;

            if (disabled) {
              h += `<div class="or-slot-disabled-lbl"><i class="fas fa-eye-slash"></i> Créneau désactivé
                <button class="or-link-btn" onclick="MX.Pages.OrgResp._reactivateSlot('${dayId}','${slot}')">Réactiver</button>
              </div>`;
            } else {
              h += `<div class="or-slot-body" id="or-slot-body-${slotKey}"
                ondragover="event.preventDefault();MX.Pages.OrgResp._onDragOver(event,'${dayId}','${slot}')"
                ondrop="MX.Pages.OrgResp._onDrop(event,'${dayId}','${slot}')"
                ondragleave="MX.Pages.OrgResp._onDragLeave(event)">`;

              if (slotTasks.length === 0) {
                h += `<div class="or-slot-empty"><i class="fas fa-inbox"></i> Aucune tâche — <button class="or-link-btn" onclick="MX.Pages.OrgResp.openAddDayTask('${dayId}','${slot}')">Ajouter</button></div>`;
              } else {
                slotTasks.forEach(t => { h += _planTaskCard(t, dayId, slot); });
              }
              h += `</div>`;
            }

            h += `</div>`; // .or-slot
          });
        }

        h += `</div>`; // .or-day-body
      }

      h += `</div>`; // .or-day-card
    });

    h += `</div></div>`; // .or-planning-days, .or-page

    mc.innerHTML = h;
  }

  function _planTaskCard(t, dayId, slot) {
    const prio     = _prioConfig(t.priority);
    const cat      = _catConfig(t.category);
    const aCol     = _ucolor(t.assignedTo || '');
    const isDone   = t.done;
    const isInProg = !isDone && t.status === 'inprogress';

    const prioHtml = prio
      ? `<span class="or-plan-task-prio" style="background:${prio.bg};color:${prio.color}">${prio.icon} ${prio.label}</span>`
      : '';
    const assignHtml = t.assignedTo
      ? `<span class="or-plan-av" style="background:${aCol}" title="${MX.esc(t.assignedTo)}">${_initials(t.assignedTo)}</span>`
      : '';
    const statusDot = isDone
      ? `<span class="or-plan-status or-plan-status--done" title="Terminé"><i class="fas fa-circle-check"></i></span>`
      : isInProg
        ? `<span class="or-plan-status or-plan-status--prog" title="En cours"><i class="fas fa-circle-play"></i></span>`
        : `<span class="or-plan-status or-plan-status--todo" title="À faire"><i class="fas fa-circle-dot"></i></span>`;

    return `<div class="or-plan-task${isDone ? ' or-plan-task--done' : isInProg ? ' or-plan-task--prog' : ''}"
      data-id="${t.id}" draggable="true"
      ondragstart="MX.Pages.OrgResp._onDragStart(event,'${t.id}','${dayId}','${slot}')"
      ondragend="MX.Pages.OrgResp._onDragEnd(event)">
      <div class="or-plan-task-grab"><i class="fas fa-grip-vertical"></i></div>
      <div class="or-plan-task-body">
        <div class="or-plan-task-top">
          ${statusDot}
          <div class="or-plan-task-title">${MX.esc(t.title)}</div>
          ${prioHtml}
          ${assignHtml}
        </div>
        ${t.description ? `<div class="or-plan-task-desc">${MX.esc(t.description)}</div>` : ''}
      </div>
      <div class="or-plan-task-actions">
        ${!isDone ? `<button class="or-icon-btn or-icon-btn--ok" onclick="MX.Pages.OrgResp.openValidate('${t.id}')" title="Marquer terminé"><i class="fas fa-check"></i></button>` : ''}
        <button class="or-icon-btn or-icon-btn--edit" onclick="MX.Pages.OrgResp.openEdit('${t.id}')" title="Modifier"><i class="fas fa-pen"></i></button>
        <button class="or-icon-btn or-icon-btn--del" onclick="MX.Pages.OrgResp.openDelete('${t.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }

  // ── WEEK NAVIGATION ──
  function _prevWeek() {
    _weekOffset--;
    _weekKey = _offsetWeekKey(_getWeekKey(new Date()), _weekOffset);
    _subscribe(_weekKey);
  }
  function _nextWeek() {
    _weekOffset++;
    _weekKey = _offsetWeekKey(_getWeekKey(new Date()), _weekOffset);
    _subscribe(_weekKey);
  }
  function _goToCurrentWeek() {
    _weekOffset = 0;
    _weekKey = _getWeekKey(new Date());
    _subscribe(_weekKey);
  }

  // ── TABS ──
  function _setTab(tab) {
    _tab = tab;
    _doRender();
  }

  // ── DAY TOGGLE ──
  function _toggleDay(dayId) {
    _dayExpanded[dayId] = _dayExpanded[dayId] === false ? true : false;
    // Update DOM without full re-render
    const body = document.getElementById('or-day-body-' + dayId);
    const chev = document.getElementById('or-day-chev-' + dayId);
    const card = document.getElementById('or-day-' + dayId);
    if (!body || !chev) { _doRender(); return; }
    const expanded = _dayExpanded[dayId] !== false;
    if (!expanded) {
      body.style.display = 'none';
      chev.className = 'fas fa-chevron-down or-day-chev';
    } else {
      body.style.display = '';
      chev.className = 'fas fa-chevron-up or-day-chev';
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SLOT CONFIGURATION
  // ═══════════════════════════════════════════════════════
  function openSlotConfig(dayId) {
    const day   = MX.DAYS.find(d => d.id === dayId);
    const defSlots = _getDefaultSlots(dayId);
    const actSlots = _getActiveSlots(dayId);
    const allSlots = ['matin', 'journee', 'soir'];

    let checksHtml = allSlots.map(slot => {
      const info     = SLOT_INFO[slot];
      const inDef    = defSlots.includes(slot);
      const isActive = actSlots.includes(slot);
      if (!inDef) return ''; // skip slots not available for this day type
      return `<label class="or-slot-check${isActive ? ' or-slot-check--on' : ''}">
        <input type="checkbox" name="or-slot-chk" value="${slot}" ${isActive ? 'checked' : ''}
          onchange="this.closest('label').classList.toggle('or-slot-check--on', this.checked)">
        <i class="fas ${info.icon} or-slot-check-ico" style="color:${info.color}"></i>
        <span>${info.l}</span>
        <span style="font-size:11px;color:var(--text3);margin-left:auto">${info.time}</span>
      </label>`;
    }).join('');

    MX.showModal({
      title: `Configurer ${day ? day.l : dayId}`,
      sub:   'Activez ou désactivez les créneaux pour cette journée (cette semaine uniquement)',
      body:  `<div class="or-slot-checks">${checksHtml}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:12px;padding:8px 10px;background:var(--bg3);border-radius:8px">
          <i class="fas fa-info-circle"></i> Désactiver un créneau masque ses tâches sans les supprimer.
        </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doSaveSlotConfig(dayId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doSaveSlotConfig(dayId) {
    const checked = [...document.querySelectorAll('input[name="or-slot-chk"]:checked')].map(el => el.value);
    MX.closeModal();
    MX.syncStart();
    try {
      const newCfg = Object.assign({}, _slotConfig, { [dayId]: checked });
      await db.collection('org_config').doc(_weekKey).set({ slotConfig: newCfg }, { merge: true });
      MX.syncEnd();
      MX.toast('Configuration enregistrée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _reactivateSlot(dayId, slot) {
    MX.syncStart();
    try {
      const current = _getActiveSlots(dayId);
      if (!current.includes(slot)) {
        const updated = [...current, slot];
        const newCfg  = Object.assign({}, _slotConfig, { [dayId]: updated });
        await db.collection('org_config').doc(_weekKey).set({ slotConfig: newCfg }, { merge: true });
      }
      MX.syncEnd();
      MX.toast('Créneau réactivé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  SLOT MENU (... per slot)
  // ═══════════════════════════════════════════════════════
  function openSlotMenu(dayId, slot, btn) {
    _closeDropdowns();
    const actSlots = _getActiveSlots(dayId);
    const isActive = actSlots.includes(slot);

    const menu = document.createElement('div');
    menu.className = 'or-dropdown-menu';
    menu.innerHTML = `
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openAddDayTask('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-plus"></i> Ajouter une tâche
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openRenameSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-pen-to-square"></i> Renommer ce créneau
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openDuplicateSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-copy"></i> Dupliquer ce créneau
      </div>
      <div class="or-dropdown-sep"></div>
      ${isActive
        ? `<div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp._disableSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
            <i class="fas fa-eye-slash"></i> Désactiver ce créneau
          </div>`
        : `<div class="or-dropdown-item" onclick="MX.Pages.OrgResp._reactivateSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
            <i class="fas fa-eye"></i> Réactiver ce créneau
          </div>`
      }
      <div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp._resetSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-rotate-left"></i> Réinitialiser ce créneau
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp._clearSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-broom"></i> Vider ce créneau
      </div>
    `;
    _attachDropdown(btn, menu);
  }

  function openDayMenu(dayId, btn) {
    _closeDropdowns();
    const day = MX.DAYS.find(d => d.id === dayId);
    const menu = document.createElement('div');
    menu.className = 'or-dropdown-menu';
    menu.innerHTML = `
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openSlotConfig('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-gear"></i> Configurer les créneaux
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openDuplicateDay('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-copy"></i> Dupliquer cette journée
      </div>
      <div class="or-dropdown-sep"></div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openTemplateSave('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-bookmark"></i> Sauvegarder comme modèle
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openTemplateApply('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-wand-magic-sparkles"></i> Appliquer un modèle
      </div>
    `;
    _attachDropdown(btn, menu);
  }

  function _attachDropdown(btn, menu) {
    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.zIndex   = '9999';
    const menuW = 200;
    let left = rect.right - menuW;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.dataset.orDropdown = '1';
    setTimeout(() => {
      document.addEventListener('click', _closeDropdowns, { once: true });
    }, 10);
  }

  function _closeDropdowns() {
    document.querySelectorAll('[data-or-dropdown]').forEach(el => el.remove());
  }

  async function _disableSlot(dayId, slot) {
    const current = _getActiveSlots(dayId);
    const updated = current.filter(s => s !== slot);
    MX.syncStart();
    try {
      const newCfg = Object.assign({}, _slotConfig, { [dayId]: updated });
      await db.collection('org_config').doc(_weekKey).set({ slotConfig: newCfg }, { merge: true });
      MX.syncEnd();
      MX.toast('Créneau désactivé');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _clearSlot(dayId, slot) {
    const slotTasks = _tasks.filter(t => t.dayId === dayId && t.slot === slot);
    if (slotTasks.length === 0) { MX.toast('Ce créneau est déjà vide'); return; }
    MX.showModal({
      title: 'Vider le créneau',
      sub:   `${SLOT_INFO[slot].l} — ${MX.DAYS.find(d => d.id === dayId)?.l || dayId}`,
      body:  `<div style="color:var(--text2);font-size:13px">Supprimer les <strong>${slotTasks.length}</strong> tâche(s) de ce créneau ?</div>`,
      actions: [
        { label: 'Vider', cls: 'danger-btn', fn: async () => {
          MX.syncStart();
          try {
            const batch = db.batch();
            slotTasks.forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
            await batch.commit();
            MX.syncEnd(); MX.toast('Créneau vidé');
          } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  // ── SLOT RENAME ──
  function openRenameSlot(dayId, slot) {
    const info    = SLOT_INFO[slot];
    const current = _getSlotName(dayId, slot);
    const day     = MX.DAYS.find(d => d.id === dayId);
    MX.showModal({
      title: 'Renommer le créneau',
      sub:   `${day?.l || dayId} — ${info?.l || slot}`,
      body:  `<div class="or-form">
        <div class="or-form-row">
          <label class="or-form-lbl">Nom affiché <span style="color:var(--red)">*</span></label>
          <input id="or-ren-name" class="fi" value="${MX.esc(current)}" placeholder="${MX.esc(info?.l || slot)}" maxlength="60">
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:8px">
          <i class="fas fa-info-circle"></i> Le nom personnalisé s'applique à cette semaine uniquement.
        </div>
      </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doRenameSlot(dayId, slot) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => { const el = document.getElementById('or-ren-name'); if (el) { el.focus(); el.select(); } }, 50);
  }

  async function _doRenameSlot(dayId, slot) {
    const name = (document.getElementById('or-ren-name')?.value || '').trim();
    if (!name) { MX.toast('Le nom ne peut pas être vide', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      const key     = dayId + '_' + slot;
      const updated = Object.assign({}, _slotNames, { [key]: name });
      await db.collection('org_config').doc(_weekKey).set({ slotNames: updated }, { merge: true });
      MX.syncEnd();
      MX.toast('Créneau renommé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── SLOT DUPLICATION ──
  function openDuplicateSlot(srcDayId, srcSlot) {
    const srcName = _getSlotName(srcDayId, srcSlot);
    const srcDay  = MX.DAYS.find(d => d.id === srcDayId);
    const dstOptions = MX.DAYS.flatMap(day => {
      if (day.id === srcDayId) return [];
      return MX.getDaySlots(day.id).map(s =>
        `<option value="${day.id}:${s}">${MX.esc(day.l)} — ${MX.esc(_getSlotName(day.id, s))}</option>`
      );
    }).join('');

    MX.showModal({
      title: 'Dupliquer le créneau',
      sub:   `${srcDay?.l || srcDayId} — ${srcName}`,
      body:  `<div class="or-form">
        <div class="or-form-row">
          <label class="or-form-lbl">Destination</label>
          <select id="or-sdup-dst" class="fi">
            <option value="">— Choisir un créneau —</option>
            ${dstOptions}
          </select>
        </div>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:8px">
          <input type="checkbox" id="or-sdup-replace">
          <span>Remplacer les tâches existantes à la destination</span>
        </label>
      </div>`,
      actions: [
        { label: 'Dupliquer', cls: 'primary-btn', fn: () => _doDuplicateSlot(srcDayId, srcSlot) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDuplicateSlot(srcDayId, srcSlot) {
    const val = document.getElementById('or-sdup-dst')?.value;
    if (!val) { MX.toast('Sélectionnez un créneau de destination', true); return; }
    const [dstDayId, dstSlot] = val.split(':');
    const replace = document.getElementById('or-sdup-replace')?.checked;
    MX.closeModal();
    MX.syncStart();
    try {
      const srcTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === srcDayId && t.slot === srcSlot);
      const name     = _currentUserName();
      const batch    = db.batch();

      if (replace) {
        _tasks.filter(t => t.dayId === dstDayId && t.slot === dstSlot)
          .forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
      }
      const existing    = replace ? [] : _tasks.filter(t => !t.archivedFromActive && t.dayId === dstDayId && t.slot === dstSlot);
      const existTitles = existing.map(t => t.title.trim().toLowerCase());
      let copied = 0;

      srcTasks.forEach((t, i) => {
        if (!replace && existTitles.includes(t.title.trim().toLowerCase())) return;
        batch.set(db.collection('org_tasks').doc(), {
          title: t.title, description: t.description || '',
          category: t.category || 'autre', type: t.type || 'unique',
          priority: t.priority || 'normale',
          assignedTo: t.assignedTo || null,
          weekKey: _weekKey, dayId: dstDayId, slot: dstSlot,
          done: false, status: 'todo',
          doneBy: null, doneAt: null, comment: null,
          archivedFromActive: false, isDefault: false,
          createdBy: name, createdAt: FV.serverTimestamp(),
          order: existing.length + i,
        });
        copied++;
      });

      await batch.commit();
      MX.syncEnd();
      MX.toast(`${copied} tâche(s) copiée(s) ✓`);
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── SLOT RESET ──
  function _resetSlot(dayId, slot) {
    const slotTasks = _tasks.filter(t => t.dayId === dayId && t.slot === slot);
    const day       = MX.DAYS.find(d => d.id === dayId);
    const slotName  = _getSlotName(dayId, slot);
    MX.showModal({
      title: 'Réinitialiser le créneau',
      sub:   `${day?.l || dayId} — ${slotName}`,
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Cela va <strong style="color:var(--red)">supprimer les ${slotTasks.length} tâche(s)</strong> de ce créneau,
          le réactiver et effacer son nom personnalisé.<br>Cette action est irréversible.
        </div>
      </div>`,
      actions: [
        { label: 'Réinitialiser', cls: 'danger-btn', fn: () => _doResetSlot(dayId, slot) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doResetSlot(dayId, slot) {
    MX.closeModal();
    MX.syncStart();
    try {
      const batch = db.batch();
      _tasks.filter(t => t.dayId === dayId && t.slot === slot)
        .forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
      await batch.commit();

      // Re-enable slot and clear custom name
      const defaultSlots = _getDefaultSlots(dayId);
      const current = _getActiveSlots(dayId);
      const updated = [...new Set([...current, slot])].filter(s => defaultSlots.includes(s));
      const newCfg  = Object.assign({}, _slotConfig, { [dayId]: updated });
      const newNames = Object.assign({}, _slotNames);
      delete newNames[dayId + '_' + slot];

      await db.collection('org_config').doc(_weekKey).set(
        { slotConfig: newCfg, slotNames: newNames },
        { merge: true }
      );
      MX.syncEnd();
      MX.toast('Créneau réinitialisé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  DAY DUPLICATION
  // ═══════════════════════════════════════════════════════
  function openDuplicateDay(srcDayId) {
    const srcDay    = MX.DAYS.find(d => d.id === srcDayId);
    const otherDays = MX.DAYS.filter(d => d.id !== srcDayId);

    const body = `<div>
      <div class="or-form-2col" style="margin-bottom:12px">
        <div class="or-form-row">
          <label class="or-form-lbl">Source</label>
          <div class="fi" style="background:var(--bg3);opacity:.8">${srcDay ? srcDay.l : srcDayId}</div>
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Destination</label>
          <select id="or-dup-dst" class="fi" onchange="MX.Pages.OrgResp._updateDupPreview('${srcDayId}',this.value)">
            <option value="">— Choisir un jour —</option>
            ${otherDays.map(d => `<option value="${d.id}">${d.l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="or-dup-options" style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Options de copie</div>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-titles" checked><span>Titres et descriptions</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-assign"><span>Affectations</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-prio"><span>Priorités</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-cat"><span>Catégories</span></label>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:8px">
          <input type="checkbox" id="or-dup-replace">
          <span>Remplacer les tâches existantes (sinon : fusionner)</span>
        </label>
        <label class="or-checkbox" id="or-dup-skip-wrap" style="display:none;margin-top:4px">
          <input type="checkbox" id="or-dup-skip-uncovered">
          <span>Ignorer les créneaux non couverts à la destination</span>
        </label>
      </div>
      <div class="or-dup-preview" id="or-dup-preview">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Aperçu</div>
        <div style="color:var(--text3);font-size:12px">Sélectionnez un jour de destination</div>
      </div>
    </div>`;

    MX.showModal({
      title:   'Dupliquer une journée',
      sub:     `Copie les tâches de ${srcDay ? srcDay.l : srcDayId} vers un autre jour`,
      body,
      actions: [
        { label: 'Dupliquer', cls: 'primary-btn', fn: () => _doDuplicateDay(srcDayId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _updateDupPreview(srcDayId, dstDayId) {
    const preview = document.getElementById('or-dup-preview');
    if (!preview) return;
    const skipWrap = document.getElementById('or-dup-skip-wrap');

    if (!dstDayId) {
      preview.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Aperçu</div>
        <div style="color:var(--text3);font-size:12px">Sélectionnez un jour de destination</div>`;
      if (skipWrap) skipWrap.style.display = 'none';
      return;
    }

    preview.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text3);font-size:12px"><i class="fas fa-spinner fa-spin"></i> Analyse en cours…</div>`;

    const srcTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === srcDayId);
    const dstTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dstDayId);
    const srcDay   = MX.DAYS.find(d => d.id === srcDayId);
    const dstDay   = MX.DAYS.find(d => d.id === dstDayId);

    // Load absences from Firestore
    let absentUsers = [];
    try {
      const date    = _getDateForDay(_weekKey, dstDayId);
      const dateStr = date ? date.toISOString().slice(0, 10) : '';
      if (dateStr) {
        const absSnap = await db.collection('absences').where('to', '>=', dateStr).get();
        absentUsers = absSnap.docs.map(d => d.data())
          .filter(a => (a.from || '').slice(0, 10) <= dateStr)
          .map(a => a.userId || a.name).filter(Boolean);
      }
    } catch(e) { /* non-critical */ }

    // Slot coverage analysis
    const dstActiveSlots  = _getActiveSlots(dstDayId);
    const srcSlots        = [...new Set(srcTasks.map(t => t.slot).filter(Boolean))];
    const uncoveredSlots  = srcSlots.filter(s => !dstActiveSlots.includes(s));
    const uncoveredCount  = srcTasks.filter(t => t.slot && uncoveredSlots.includes(t.slot)).length;

    // Absence conflicts
    const assigned  = srcTasks.map(t => t.assignedTo).filter(Boolean);
    const conflicts = [...new Set(assigned.filter(n => absentUsers.includes(n)))];

    let warnings = '';
    if (conflicts.length > 0) {
      warnings += `<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;font-size:12px;color:#EF4444">
        <i class="fas fa-triangle-exclamation"></i> <strong>${MX.esc(conflicts.join(', '))}</strong> ${conflicts.length > 1 ? 'sont absents' : 'est absent(e)'} ce jour-là.
      </div>`;
    }
    if (uncoveredSlots.length > 0) {
      if (skipWrap) skipWrap.style.display = '';
      warnings += `<div style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;font-size:12px;color:#F59E0B">
        <i class="fas fa-triangle-exclamation"></i> ${uncoveredCount} tâche(s) dans des créneaux inactifs à la destination (${uncoveredSlots.map(s => SLOT_INFO[s]?.l || s).join(', ')}).
      </div>`;
    } else {
      if (skipWrap) skipWrap.style.display = 'none';
    }

    preview.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Aperçu</div>
      <div class="or-dup-preview-grid">
        <div class="or-dup-preview-col">
          <div class="or-dup-preview-label">${srcDay ? srcDay.l : srcDayId}</div>
          <div class="or-dup-preview-cnt">${srcTasks.length} tâche(s)</div>
        </div>
        <div class="or-dup-preview-arrow"><i class="fas fa-arrow-right"></i></div>
        <div class="or-dup-preview-col">
          <div class="or-dup-preview-label">${dstDay ? dstDay.l : dstDayId}</div>
          <div class="or-dup-preview-cnt">${dstTasks.length} tâche(s) existante(s)</div>
        </div>
      </div>
      ${warnings}`;
  }

  async function _doDuplicateDay(srcDayId) {
    const dstDayId   = document.getElementById('or-dup-dst')?.value;
    if (!dstDayId)   { MX.toast('Sélectionnez un jour de destination', true); return; }
    const copyAssign  = document.getElementById('or-dup-assign')?.checked;
    const copyPrio    = document.getElementById('or-dup-prio')?.checked;
    const copyCat     = document.getElementById('or-dup-cat')?.checked;
    const replace     = document.getElementById('or-dup-replace')?.checked;
    const skipUncov   = document.getElementById('or-dup-skip-uncovered')?.checked;
    MX.closeModal();
    MX.syncStart();
    try {
      const dstActiveSlots = _getActiveSlots(dstDayId);
      let srcTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === srcDayId);

      if (skipUncov) {
        srcTasks = srcTasks.filter(t => !t.slot || dstActiveSlots.includes(t.slot));
      }

      const name  = _currentUserName();
      const batch = db.batch();

      if (replace) {
        _tasks.filter(t => t.dayId === dstDayId)
          .forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
      }

      const dstExisting = replace ? [] : _tasks.filter(t => !t.archivedFromActive && t.dayId === dstDayId);
      const existTitles = dstExisting.map(t => t.title.trim().toLowerCase());
      let copied = 0, skipped = 0;

      srcTasks.forEach((t, i) => {
        if (!replace && existTitles.includes(t.title.trim().toLowerCase())) { skipped++; return; }
        batch.set(db.collection('org_tasks').doc(), {
          title:       t.title,
          description: t.description || '',
          category:    copyCat  ? (t.category || 'autre')   : 'autre',
          type:        t.type || 'unique',
          priority:    copyPrio ? (t.priority || 'normale')  : 'normale',
          assignedTo:  copyAssign ? (t.assignedTo || null)   : null,
          weekKey:     _weekKey,
          dayId:       dstDayId,
          slot:        t.slot || null,
          done:        false, status: 'todo',
          doneBy:      null, doneAt: null, comment: null,
          archivedFromActive: false,
          isDefault:   false,
          createdBy:   name, createdAt: FV.serverTimestamp(),
          order:       (dstExisting.length + i),
        });
        copied++;
      });

      await batch.commit();
      db.collection('admin_journal').add({
        action: 'duplicate_day', by: name, at: FV.serverTimestamp(),
        weekKey: _weekKey, from: srcDayId, to: dstDayId, count: copied,
      }).catch(() => {});
      MX.syncEnd();
      const srcDay = MX.DAYS.find(d => d.id === srcDayId);
      const dstDay = MX.DAYS.find(d => d.id === dstDayId);
      const msg = skipped > 0
        ? `${copied} tâche(s) copiée(s), ${skipped} déjà présente(s) ✓`
        : `${srcDay?.l || srcDayId} → ${dstDay?.l || dstDayId} : ${copied} tâche(s) copiée(s) ✓`;
      MX.toast(msg);
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  WEEK DUPLICATION
  // ═══════════════════════════════════════════════════════
  function openDuplicateWeek() {
    const nextKey = _offsetWeekKey(_weekKey, 1);
    const body = `<div>
      <div style="background:var(--bg3);border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Source</div>
        <div style="font-size:14px;font-weight:600;color:var(--text1)">${_weekLabel(_weekKey)}</div>
      </div>
      <div style="background:var(--bg3);border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Destination</div>
        <div style="font-size:14px;font-weight:600;color:var(--cyan)">${_weekLabel(nextKey)}</div>
      </div>
      <div class="or-dup-options">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Options</div>
        <label class="or-checkbox"><input type="checkbox" id="or-wdup-tasks" checked><span>Tâches planning (avec jour/créneau)</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-wdup-kanban" checked><span>Tâches hebdomadaires (Kanban)</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-wdup-assign"><span>Conserver les affectations</span></label>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:8px">
          <input type="checkbox" id="or-wdup-replace">
          <span>Remplacer les tâches existantes de la semaine suivante</span>
        </label>
      </div>
    </div>`;

    MX.showModal({
      title:   'Dupliquer la semaine',
      sub:     `Copier vers ${_weekLabel(nextKey)}`,
      body,
      actions: [
        { label: 'Dupliquer', cls: 'primary-btn', fn: () => _doDuplicateWeek(nextKey) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDuplicateWeek(nextKey) {
    const copyTasks  = document.getElementById('or-wdup-tasks')?.checked;
    const copyKanban = document.getElementById('or-wdup-kanban')?.checked;
    const copyAssign = document.getElementById('or-wdup-assign')?.checked;
    const replace    = document.getElementById('or-wdup-replace')?.checked;
    MX.closeModal();
    MX.syncStart();
    try {
      const name = _currentUserName();

      // Fetch next week existing
      const nextSnap = await db.collection('org_tasks').where('weekKey', '==', nextKey).get();
      const nextExisting = nextSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const toDelete = replace ? nextExisting : [];
      const toCopy   = _tasks.filter(t => {
        if (t.archivedFromActive) return false;
        if (t.dayId && copyTasks) return true;
        if (!t.dayId && copyKanban) return true;
        return false;
      });

      const existTitles = replace ? [] : nextExisting.map(t => (t.title || '').trim().toLowerCase());

      // Batch (split at 499)
      const ops = [...toDelete.map(t => ({ type: 'del', id: t.id })),
                   ...toCopy.map((t, i) => ({ type: 'set', t, i }))];

      for (let chunk = 0; chunk < ops.length; chunk += 490) {
        const batch = db.batch();
        ops.slice(chunk, chunk + 490).forEach(op => {
          if (op.type === 'del') {
            batch.delete(db.collection('org_tasks').doc(op.id));
          } else {
            const t = op.t;
            if (!replace && existTitles.includes(t.title.trim().toLowerCase())) return;
            batch.set(db.collection('org_tasks').doc(), {
              title: t.title, description: t.description || '',
              category: t.category || 'autre', type: t.type || 'hebdomadaire',
              priority: t.priority || 'normale',
              assignedTo: copyAssign ? (t.assignedTo || null) : null,
              weekKey: nextKey,
              dayId:  t.dayId || null,
              slot:   t.slot  || null,
              done: false, status: 'todo',
              doneBy: null, doneAt: null, comment: null,
              archivedFromActive: false, isDefault: false,
              createdBy: name, createdAt: FV.serverTimestamp(),
              order: (nextExisting.length + op.i),
            });
          }
        });
        await batch.commit();
      }

      db.collection('admin_journal').add({
        action: 'duplicate_week', by: name, at: FV.serverTimestamp(),
        from: _weekKey, to: nextKey, count: toCopy.length,
      }).catch(() => {});
      MX.syncEnd();
      MX.toast('Semaine dupliquée vers ' + _weekLabel(nextKey) + ' ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  TEMPLATES
  // ═══════════════════════════════════════════════════════
  function openTemplateSave(dayId) {
    const day      = MX.DAYS.find(d => d.id === dayId);
    const dayTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
    if (dayTasks.length === 0) { MX.toast('Aucune tâche à sauvegarder dans ce modèle', true); return; }

    MX.showModal({
      title: 'Sauvegarder comme modèle',
      sub:   `${dayTasks.length} tâche(s) de ${day?.l || dayId}`,
      body:  `<div class="or-form">
        <div class="or-form-row">
          <label class="or-form-lbl">Nom du modèle <span style="color:var(--red)">*</span></label>
          <input id="or-tpl-name" class="fi" placeholder="ex: Samedi Standard, Jour Férié…" maxlength="80">
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Description</label>
          <input id="or-tpl-desc" class="fi" placeholder="Optionnel" maxlength="200">
        </div>
      </div>`,
      actions: [
        { label: 'Sauvegarder', cls: 'primary-btn', fn: () => _doSaveTemplate(dayId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-tpl-name')?.focus(), 50);
  }

  async function _doSaveTemplate(dayId) {
    const name = (document.getElementById('or-tpl-name')?.value || '').trim();
    if (!name) { MX.toast('Le nom du modèle est obligatoire', true); return; }
    const desc  = (document.getElementById('or-tpl-desc')?.value || '').trim();
    const tasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
    MX.closeModal();
    MX.syncStart();
    try {
      const user = _currentUserName();
      await db.collection('org_templates').add({
        name, description: desc,
        dayId,
        createdBy: user, createdAt: FV.serverTimestamp(),
        tasks: tasks.map(t => ({
          title: t.title, description: t.description || '',
          category: t.category || 'autre', type: t.type || 'unique',
          priority: t.priority || 'normale', slot: t.slot || null,
          assignedTo: t.assignedTo || null,
        })),
      });
      // Refresh templates
      const snap = await db.collection('org_templates').get();
      _templates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      MX.syncEnd();
      MX.toast('Modèle "' + name + '" sauvegardé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  function openTemplateApply(dayId) {
    if (_templates.length === 0) {
      MX.toast('Aucun modèle disponible. Sauvegardez d\'abord une journée comme modèle.', true);
      return;
    }
    const day = MX.DAYS.find(d => d.id === dayId);
    const tplList = _templates.map((tpl, i) => `
      <div class="or-tpl-item" onclick="document.querySelectorAll('.or-tpl-item').forEach(x=>x.classList.remove('or-tpl-item--sel'));this.classList.add('or-tpl-item--sel');document.getElementById('or-tpl-sel').value='${tpl.id}'">
        <div class="or-tpl-name">${MX.esc(tpl.name)}</div>
        <div class="or-tpl-meta">${tpl.tasks ? tpl.tasks.length : 0} tâche(s)${tpl.description ? ' — ' + MX.esc(tpl.description) : ''}</div>
        <button class="or-tpl-del" onclick="event.stopPropagation();MX.Pages.OrgResp._deleteTemplate('${tpl.id}')" title="Supprimer ce modèle"><i class="fas fa-trash"></i></button>
      </div>`).join('');

    MX.showModal({
      title: 'Appliquer un modèle',
      sub:   `Sur ${day?.l || dayId}`,
      body:  `<input type="hidden" id="or-tpl-sel" value="">
        <div class="or-tpl-list">${tplList}</div>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:10px">
          <input type="checkbox" id="or-tpl-replace">
          <span>Remplacer les tâches existantes</span>
        </label>`,
      actions: [
        { label: 'Appliquer', cls: 'primary-btn', fn: () => _doApplyTemplate(dayId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doApplyTemplate(dayId) {
    const tplId   = document.getElementById('or-tpl-sel')?.value;
    const replace = document.getElementById('or-tpl-replace')?.checked;
    const tpl     = _templates.find(t => t.id === tplId);
    if (!tpl) { MX.toast('Sélectionnez un modèle', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      const name  = _currentUserName();
      const batch = db.batch();
      if (replace) {
        _tasks.filter(t => t.dayId === dayId).forEach(t => {
          batch.delete(db.collection('org_tasks').doc(t.id));
        });
      }
      const existing = replace ? [] : _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
      const existTitles = existing.map(t => t.title.trim().toLowerCase());

      (tpl.tasks || []).forEach((t, i) => {
        if (!replace && existTitles.includes(t.title.trim().toLowerCase())) return;
        batch.set(db.collection('org_tasks').doc(), {
          title: t.title, description: t.description || '',
          category: t.category || 'autre', type: t.type || 'unique',
          priority: t.priority || 'normale',
          slot: t.slot || null, assignedTo: t.assignedTo || null,
          weekKey: _weekKey, dayId,
          done: false, status: 'todo',
          doneBy: null, doneAt: null, comment: null,
          archivedFromActive: false, isDefault: false,
          createdBy: name, createdAt: FV.serverTimestamp(),
          order: (existing.length + i),
        });
      });
      await batch.commit();
      MX.syncEnd();
      MX.toast('Modèle "' + tpl.name + '" appliqué ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _deleteTemplate(tplId) {
    if (!confirm('Supprimer ce modèle ?')) return;
    try {
      await db.collection('org_templates').doc(tplId).delete();
      _templates = _templates.filter(t => t.id !== tplId);
      MX.toast('Modèle supprimé');
      MX.closeModal();
    } catch(e) { MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  DRAG AND DROP
  // ═══════════════════════════════════════════════════════
  function _onDragStart(event, taskId, srcDayId, srcSlot) {
    _dragData = { taskId, srcDayId, srcSlot };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
    const el = event.currentTarget;
    setTimeout(() => el && el.classList.add('or-plan-task--dragging'), 0);
  }

  function _onDragEnd(event) {
    const el = event.currentTarget;
    if (el) el.classList.remove('or-plan-task--dragging');
    _dragData = null;
  }

  function _onDragOver(event, dstDayId, dstSlot) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const el = document.getElementById('or-slot-body-' + dstDayId + '_' + dstSlot);
    if (el) el.classList.add('or-slot-body--drag-over');
  }

  function _onDragLeave(event) {
    const el = event.currentTarget;
    if (el) el.classList.remove('or-slot-body--drag-over');
  }

  async function _onDrop(event, dstDayId, dstSlot) {
    event.preventDefault();
    const el = document.getElementById('or-slot-body-' + dstDayId + '_' + dstSlot);
    if (el) el.classList.remove('or-slot-body--drag-over');

    if (!_dragData) return;
    const { taskId, srcDayId, srcSlot } = _dragData;
    _dragData = null;

    if (srcDayId === dstDayId && srcSlot === dstSlot) return; // same slot

    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        dayId: dstDayId, slot: dstSlot,
      });
      MX.syncEnd();
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  TASK FORM (Planning-aware)
  // ═══════════════════════════════════════════════════════
  function openAddDayTask(dayId, slot) {
    const day  = MX.DAYS.find(d => d.id === dayId);
    const info = SLOT_INFO[slot] || {};
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     `${day?.l || dayId} — ${info.l || slot}`,
      body:    _taskFormBody({ dayId, slot }),
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  function _taskFormBody(defaults) {
    const d    = defaults || {};
    const prio = d.priority || 'normale';
    const type = d.type || (d.dayId ? 'unique' : 'hebdomadaire');
    const cats = ['sécurité','réglementaire','stock','administratif','hébergement','autre'];
    const hiddenDaySlot = d.dayId
      ? `<input type="hidden" id="or-f-dayid" value="${MX.esc(d.dayId)}">
         <input type="hidden" id="or-f-slot"  value="${MX.esc(d.slot || '')}">` : '';
    return `<div class="or-form">${hiddenDaySlot}
      <div class="or-form-row">
        <label class="or-form-lbl">Titre <span style="color:var(--red)">*</span></label>
        <input id="or-f-title" class="fi" value="${MX.esc(d.title || '')}" placeholder="Nom de la tâche" maxlength="150">
      </div>
      <div class="or-form-row">
        <label class="or-form-lbl">Description</label>
        <input id="or-f-desc" class="fi" value="${MX.esc(d.description || '')}" placeholder="Détails optionnels" maxlength="300">
      </div>
      <div class="or-form-2col">
        <div class="or-form-row">
          <label class="or-form-lbl">Responsable</label>
          <select id="or-f-assign" class="fi">${_getUserOptions(d.assignedTo || '')}</select>
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Catégorie</label>
          <select id="or-f-cat" class="fi">
            ${cats.map(c => `<option value="${c}"${c === (d.category || 'autre') ? ' selected' : ''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="or-form-2col">
        <div class="or-form-row">
          <label class="or-form-lbl">Priorité</label>
          <select id="or-f-prio" class="fi">
            <option value="normale"${prio==='normale'?' selected':''}>Normale</option>
            <option value="haute"${prio==='haute'?' selected':''}>🟠 Haute</option>
            <option value="urgente"${prio==='urgente'?' selected':''}>🔴 Urgente</option>
            <option value="critique"${prio==='critique'?' selected':''}>🚨 Critique</option>
          </select>
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Type</label>
          <div class="or-type-pills">
            ${[
              { v:'hebdomadaire', l:'♻️ Récurrente' },
              { v:'mensuelle',    l:'🗓 Mensuelle'  },
              { v:'unique',       l:'📌 Unique'     },
            ].map(({ v, l }) => `<label class="or-type-pill${v===type?' or-type-pill--on':''}">
              <input type="radio" name="or-f-type" value="${v}" ${v===type?'checked':''} style="display:none"
                onchange="this.closest('.or-type-pills').querySelectorAll('.or-type-pill').forEach(x=>x.classList.remove('or-type-pill--on'));this.closest('.or-type-pill').classList.add('or-type-pill--on')">
              ${l}
            </label>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  function _readForm() {
    const typeEl = document.querySelector('input[name="or-f-type"]:checked');
    return {
      title:       (document.getElementById('or-f-title')?.value  || '').trim(),
      description: (document.getElementById('or-f-desc')?.value   || '').trim(),
      assignedTo:  document.getElementById('or-f-assign')?.value  || null,
      category:    document.getElementById('or-f-cat')?.value     || 'autre',
      priority:    document.getElementById('or-f-prio')?.value    || 'normale',
      type:        typeEl ? typeEl.value : 'hebdomadaire',
      dayId:       document.getElementById('or-f-dayid')?.value   || null,
      slot:        document.getElementById('or-f-slot')?.value    || null,
    };
  }

  // ── ADD ──
  function openAdd() {
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     _weekLabel(_weekKey),
      body:    _taskFormBody(),
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doAdd() {
    const data = _readForm();
    if (!data.title) { MX.toast('Le titre est obligatoire', true); return; }
    const name = _currentUserName();
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').add({
        ...data,
        assignedTo: data.assignedTo || null,
        dayId: data.dayId || null,
        slot:  data.slot  || null,
        weekKey: _weekKey,
        done: false, status: 'todo',
        doneBy: null, doneAt: null, comment: null,
        archivedFromActive: false,
        createdBy: name, createdAt: FV.serverTimestamp(),
        order: _tasks.filter(t => !t.done).length, isDefault: false,
      });
      MX.syncEnd();
      MX.toast('Tâche créée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── EDIT ──
  function openEdit(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Modifier la tâche',
      sub:     MX.esc(t.title),
      body:    _taskFormBody(t),
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doEdit(taskId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doEdit(taskId) {
    const data = _readForm();
    if (!data.title) { MX.toast('Le titre est obligatoire', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        title: data.title, description: data.description,
        assignedTo: data.assignedTo || null, category: data.category,
        priority: data.priority, type: data.type,
      });
      MX.syncEnd();
      MX.toast('Tâche modifiée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── DELETE ──
  function openDelete(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title: 'Supprimer la tâche',
      sub:   MX.esc(t.title),
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Cette tâche sera <strong style="color:var(--red)">définitivement supprimée</strong>.<br>Cette action est irréversible.
        </div>
      </div>`,
      actions: [
        { label: 'Supprimer', cls: 'danger-btn', fn: () => _doDelete(taskId) },
        { label: 'Annuler',   cls: 'cancel' }
      ]
    });
  }

  async function _doDelete(taskId) {
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).delete();
      MX.syncEnd();
      MX.toast('Tâche supprimée');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── COLUMN MOVES ──
  async function moveToInProgress(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({ status: 'inprogress', done: false });
      MX.syncEnd();
    } catch(e) { MX.syncFail(); MX.toast('Erreur', true); }
  }

  async function moveToTodo(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({ status: 'todo', done: false, doneBy: null, doneAt: null, comment: null });
      MX.syncEnd();
    } catch(e) { MX.syncFail(); MX.toast('Erreur', true); }
  }

  // ── VALIDATE ──
  function openValidate(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    const isRec = t.type !== 'unique';
    MX.showModal({
      title: 'Marquer terminée',
      sub:   MX.esc(t.title),
      body:  `<div>
        <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Commentaire (optionnel)</label>
        <textarea id="or-val-cmt" class="fi" style="min-height:72px;resize:vertical" placeholder="Tout était OK, rien à signaler…"></textarea>
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isRec?'rgba(0,194,209,.07)':'var(--bg3)'};border-radius:8px;font-size:12px;color:var(--text2)">
          <i class="fas ${isRec?'fa-rotate':'fa-archive'}" style="color:${isRec?'var(--cyan)':'var(--text3)'}"></i>
          ${isRec ? 'Tâche récurrente — recréée automatiquement la semaine suivante' : 'Tâche unique — archivée après validation'}
        </div>
      </div>`,
      actions: [
        { label: 'Terminer', cls: 'primary-btn', fn: () => _doValidate(taskId) },
        { label: 'Annuler',  cls: 'cancel' }
      ]
    });
  }

  async function _doValidate(taskId) {
    const task    = _tasks.find(x => x.id === taskId);
    const name    = _currentUserName();
    const comment = (document.getElementById('or-val-cmt')?.value || '').trim() || null;
    MX.closeModal();
    MX.syncStart();
    try {
      const update = { done: true, status: 'done', doneBy: name, doneAt: FV.serverTimestamp(), comment };
      if (task && task.type === 'unique') update.archivedFromActive = true;
      await db.collection('org_tasks').doc(taskId).update(update);
      MX.syncEnd();
      MX.toast('Tâche terminée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function unvalidate(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        done: false, status: 'todo', doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
      });
      MX.syncEnd();
      MX.toast('Validation annulée');
    } catch(e) { MX.syncFail(); MX.toast('Erreur', true); }
  }

  // ═══════════════════════════════════════════════════════
  //  KANBAN TAB (unchanged logic, new header)
  // ═══════════════════════════════════════════════════════
  function _renderKanban(mc) {
    const active = _tasks.filter(t => !t.archivedFromActive && !t.dayId);
    const cols = {
      todo:       active.filter(t => !t.done && t.status !== 'inprogress'),
      inprogress: active.filter(t => !t.done && t.status === 'inprogress'),
      done:       active.filter(t => t.done),
    };
    const total  = active.length;
    const doneCnt = cols.done.length;
    const pct    = total ? Math.round(doneCnt / total * 100) : 0;
    const pctC   = pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';

    // Count planning tasks for tab badge
    const planTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId);
    const planDone  = planTasks.filter(t => t.done).length;

    let h = `<div class="or-page">
      <div class="or-header">
        <div class="or-header-left">
          <div class="or-title">Centre de Pilotage</div>
          <div class="or-week-label">${_weekLabel(_weekKey)}</div>
        </div>
        <div class="or-header-right">
          <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.renderHistory()">
            <i class="fas fa-clock-rotate-left"></i><span class="or-btn-lbl"> Historique</span>
          </button>
          <button class="or-btn-primary" onclick="MX.Pages.OrgResp.openAdd()">
            <i class="fas fa-plus"></i><span class="or-btn-lbl"> Ajouter</span>
          </button>
        </div>
      </div>

      <!-- Week navigation -->
      <div class="or-week-nav">
        <button class="or-week-nav-btn" onclick="MX.Pages.OrgResp._prevWeek()"><i class="fas fa-chevron-left"></i></button>
        <div class="or-week-nav-info">
          ${_isCurrentWeek() ? '<span class="or-week-cur-badge">Semaine en cours</span>' : `<button class="or-week-nav-today" onclick="MX.Pages.OrgResp._goToCurrentWeek()"><i class="fas fa-house"></i> Aujourd'hui</button>`}
        </div>
        <button class="or-week-nav-btn" onclick="MX.Pages.OrgResp._nextWeek()"><i class="fas fa-chevron-right"></i></button>
      </div>

      <!-- Tabs -->
      <div class="or-tabs">
        <button class="or-tab" onclick="MX.Pages.OrgResp._setTab('planning')">
          <i class="fas fa-calendar-days"></i> Planning
          ${planTasks.length > 0 ? `<span class="or-tab-cnt">${planDone}/${planTasks.length}</span>` : ''}
        </button>
        <button class="or-tab or-tab--active" onclick="MX.Pages.OrgResp._setTab('tasks')">
          <i class="fas fa-list-check"></i> Tâches hebdo
          ${total > 0 ? `<span class="or-tab-cnt">${doneCnt}/${total}</span>` : ''}
        </button>
      </div>

      <div class="or-progress-bar">
        <div class="or-progress-track"><div class="or-progress-fill" style="width:${pct}%;background:${pctC}"></div></div>
        <span class="or-progress-lbl" style="color:${pctC}">${pct}% — ${doneCnt}/${total} tâches</span>
      </div>

      <div class="or-kanban">`;

    const colDefs = [
      { key: 'todo',       label: 'À faire',   dot: '#6B7280', ico: 'fa-circle-dot' },
      { key: 'inprogress', label: 'En cours',  dot: '#3B82F6', ico: 'fa-circle-play' },
      { key: 'done',       label: 'Terminé',   dot: '#10B981', ico: 'fa-circle-check' },
    ];

    colDefs.forEach(({ key, label, dot, ico }) => {
      const cards = cols[key];
      h += `<div class="or-kcol" data-col="${key}">
        <div class="or-kcol-hdr">
          <span class="or-kcol-dot" style="background:${dot}"></span>
          <span class="or-kcol-label">${label}</span>
          <span class="or-kcol-cnt">${cards.length}</span>
          ${key !== 'done' ? `<button class="or-kcol-add" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter"><i class="fas fa-plus"></i></button>` : ''}
        </div>
        <div class="or-kcol-body" id="or-kcol-${key}">`;
      if (cards.length === 0) {
        h += `<div class="or-kcol-empty">
          <i class="fas ${ico}" style="font-size:20px;color:${dot};opacity:.3"></i>
          <span>${key === 'done' ? 'Aucune tâche terminée' : 'Aucune tâche'}</span>
        </div>`;
      } else {
        cards.forEach(t => { h += _kanbanCard(t, key); });
      }
      h += `</div></div>`;
    });

    h += `</div></div>`;
    h += `<button class="or-fab" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter une tâche"><i class="fas fa-plus"></i></button>`;
    mc.innerHTML = h;
  }

  function _kanbanCard(t, col) {
    const esc    = MX.esc;
    const cat    = _catConfig(t.category);
    const prio   = _prioConfig(t.priority);
    const aCol   = _ucolor(t.assignedTo || '');
    const isDone = col === 'done';

    let tags = '';
    if (t.category && t.category !== 'autre') {
      tags += `<span class="or-badge" style="background:${cat.color}18;color:${cat.color}"><i class="fas ${cat.icon}"></i> ${esc(t.category)}</span>`;
    }
    if (prio) tags += `<span class="or-badge or-badge--prio" style="background:${prio.bg};color:${prio.color}">${prio.icon} ${prio.label}</span>`;
    tags += _typeBadge(t.type);

    const assignHtml = t.assignedTo
      ? `<span class="or-av" style="background:${aCol}" title="${esc(t.assignedTo)}">${_initials(t.assignedTo)}</span>
         <span class="or-av-name">${esc(t.assignedTo)}</span>`
      : `<span class="or-av-none"><i class="fas fa-user-slash"></i> Non assigné</span>`;

    let actionsHtml = '';
    if (!isDone) {
      actionsHtml += `<button class="or-icon-btn or-icon-btn--edit" onclick="MX.Pages.OrgResp.openEdit('${t.id}')" title="Modifier"><i class="fas fa-pen"></i></button>`;
      actionsHtml += `<button class="or-icon-btn or-icon-btn--del" onclick="MX.Pages.OrgResp.openDelete('${t.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`;
      if (col === 'todo') {
        actionsHtml += `<button class="or-icon-btn or-icon-btn--play" onclick="MX.Pages.OrgResp.moveToInProgress('${t.id}')" title="Démarrer"><i class="fas fa-play"></i></button>`;
      } else {
        actionsHtml += `<button class="or-icon-btn" onclick="MX.Pages.OrgResp.moveToTodo('${t.id}')" title="Remettre à faire"><i class="fas fa-rotate-left"></i></button>`;
      }
      actionsHtml += `<button class="or-icon-btn or-icon-btn--ok" onclick="MX.Pages.OrgResp.openValidate('${t.id}')" title="Terminer"><i class="fas fa-check"></i></button>`;
    } else {
      const dt = t.doneAt ? _fmtDT(t.doneAt) : '';
      actionsHtml += `<span class="or-done-meta">${t.doneBy ? esc(t.doneBy) : ''}${dt ? ' · ' + dt : ''}</span>`;
      actionsHtml += `<button class="or-icon-btn" onclick="MX.Pages.OrgResp.unvalidate('${t.id}')" title="Annuler validation"><i class="fas fa-rotate-left"></i></button>`;
    }

    return `<div class="or-kcard${isDone ? ' or-kcard--done' : ''}" data-id="${t.id}">
      <div class="or-kcard-tags">${tags}</div>
      <div class="or-kcard-title">${esc(t.title)}</div>
      ${t.description ? `<div class="or-kcard-desc">${esc(t.description)}</div>` : ''}
      ${t.comment && isDone ? `<div class="or-kcard-comment"><i class="fas fa-quote-left" style="font-size:9px;opacity:.5"></i> ${esc(t.comment)}</div>` : ''}
      <div class="or-kcard-foot">
        <div class="or-kcard-assign">${assignHtml}</div>
        <div class="or-kcard-actions">${actionsHtml}</div>
      </div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════
  //  HISTORY
  // ═══════════════════════════════════════════════════════
  async function renderHistory() {
    _inHistory = true;
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page"><div class="or-loading"><i class="fas fa-spinner fa-spin"></i> Chargement…</div></div>`;
    try {
      const weeks = [];
      const now = new Date();
      for (let i = 0; i < 8; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i * 7);
        weeks.push(_getWeekKey(d));
      }
      const snap = await db.collection('org_tasks').where('weekKey', 'in', weeks).get();
      const byWeek = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!byWeek[data.weekKey]) byWeek[data.weekKey] = [];
        byWeek[data.weekKey].push({ id: d.id, ...data });
      });

      let h = `<div class="or-page">
        <div class="or-header">
          <div class="or-header-left">
            <div class="or-title">Historique</div>
            <div class="or-week-label">8 dernières semaines</div>
          </div>
          <div class="or-header-right">
            <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i><span class="or-btn-lbl"> Retour</span></button>
          </div>
        </div>`;

      let hasAny = false;
      weeks.forEach(wk => {
        const tasks   = (byWeek[wk] || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        const total   = tasks.length;
        const doneCnt = tasks.filter(t => t.done).length;
        if (total === 0) return;
        hasAny = true;
        const pct    = Math.round(doneCnt / total * 100);
        const isCur  = wk === _getWeekKey(new Date());
        const pctCls = pct >= 80 ? 'or-hist-bar-fill--done' : pct >= 40 ? 'or-hist-bar-fill--prog' : '';
        h += `<div class="or-hist-week${isCur?' or-hist-week--current':''}" onclick="MX.Pages.OrgResp._histToggle('${wk}')">
          <div class="or-hist-row">
            <div class="or-hist-wlabel">${_weekLabel(wk)}${isCur?' <span class="or-hist-cur">en cours</span>':''}</div>
            <div class="or-hist-stat">${doneCnt}/${total} — ${pct}%</div>
          </div>
          <div class="or-hist-bar"><div class="or-hist-bar-fill ${pctCls}" style="width:${pct}%"></div></div>
        </div>
        <div class="or-hist-detail" id="or-hd-${wk}" style="display:none">`;
        tasks.forEach(t => {
          const asgn = t.assignedTo ? ` · <span style="color:var(--cyan)">↗ ${MX.esc(t.assignedTo)}</span>` : '';
          const loc  = t.dayId ? ` · <span style="color:var(--text3)">${MX.DAYS.find(d=>d.id===t.dayId)?.l||t.dayId}${t.slot ? ' / '+SLOT_INFO[t.slot]?.l : ''}</span>` : '';
          h += `<div class="or-hist-task${t.done?' or-hist-task--done':''}">
            <i class="fas fa-${t.done?'circle-check':'circle'}" style="color:${t.done?'var(--green)':'var(--text3)'}"></i>
            <div class="or-hist-task-body">
              <div class="or-hist-task-title">${MX.esc(t.title)} ${_typeBadge(t.type)}${asgn}${loc}</div>
              ${t.done&&t.doneBy?`<div class="or-hist-task-meta">Par <strong>${MX.esc(t.doneBy)}</strong>${t.doneAt?` — ${_fmtDT(t.doneAt)}`:''}${t.comment?` — "${MX.esc(t.comment)}"`:''}</div>`:''}
            </div>
          </div>`;
        });
        h += `</div>`;
      });

      if (!hasAny) h += `<div class="or-empty-state"><i class="fas fa-clock-rotate-left"></i><div>Aucun historique disponible</div></div>`;
      h += `</div>`;
      mc.innerHTML = h;
    } catch(e) {
      console.error('[OrgResp] history:', e);
      mc.innerHTML = `<div class="or-page">
        <div class="or-header">
          <div class="or-header-left"><div class="or-title">Historique</div></div>
          <div class="or-header-right"><button class="or-btn-secondary" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i> Retour</button></div>
        </div>
        <div class="or-empty-state"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i><div>Erreur de chargement</div></div>
      </div>`;
    }
  }

  function _histToggle(wk) {
    const el = document.getElementById('or-hd-' + wk);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // ── EXPORT ──
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.OrgResp = {
    render, renderHistory,
    openAdd, openEdit, openDelete, openValidate,
    _doAdd, _doEdit, _doDelete, _doValidate,
    moveToInProgress, moveToTodo,
    unvalidate, _histToggle,
    // Planning navigation
    _setTab, _toggleDay,
    _prevWeek, _nextWeek, _goToCurrentWeek,
    // Slot config
    openSlotConfig, _reactivateSlot,
    _disableSlot, _clearSlot,
    openSlotMenu, openDayMenu, _closeDropdowns,
    // Slot rename
    openRenameSlot, _doRenameSlot,
    // Slot duplication
    openDuplicateSlot, _doDuplicateSlot,
    // Slot reset
    _resetSlot, _doResetSlot,
    // Task add (planning-aware)
    openAddDayTask,
    // Day duplication
    openDuplicateDay, _updateDupPreview,
    // Week duplication
    openDuplicateWeek,
    // Templates
    openTemplateSave, openTemplateApply, _deleteTemplate,
    // Drag and drop
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
  };
})();
