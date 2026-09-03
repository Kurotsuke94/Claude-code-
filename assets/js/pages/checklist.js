(function () {
  var _clWsSelKey = null;

  function render(dayId) {
    const { state, DAYS, getDaySlots, esc, Widgets } = MX;
    const day    = DAYS.find(d => d.id === dayId);
    const slots  = getDaySlots(dayId);
    const el     = document.getElementById("main-content");
    const cu     = state.currentUser;
    const canAll = MX.Auth.canSeeAll();
    const worker = (!canAll && cu) ? cu.name : null;

    // Pre-load planning data for suggestion pre-fill (non-blocking; re-renders once loaded)
    if (canAll && !Object.keys(MX.state.planningEntries || {}).length) {
      _ensurePlanningForWeek(_weekKey(new Date())).then(() => {
        const mc = document.getElementById('main-content');
        if (mc && mc.dataset.dayId === dayId) render(dayId);
      }).catch(() => {});
    }

    // Today's date detection for daily claims
    const isToday              = dayId === MX.todayId();
    const dailyClaims          = isToday ? (state.dailyClaims || {}) : {};
    const todayPlanSuggestions = isToday ? (state.todayPlanSuggestions || {}) : {};

    let total = 0, done = 0;
    slots.forEach(sl => {
      const tasks = state.tasks[`${dayId}_${sl}`] || [];
      const asn   = isToday ? ((dailyClaims[sl] && dailyClaims[sl].name) || "") : (state.assignments[`${dayId}_${sl}`] || "");
      tasks.forEach(t => {
        if (canAll || !worker || asn === worker || t.assignedTo === worker) {
          total++;
          if (state.checks[MX.checkKey(dayId, sl, t.id, MX.checkOwnerId(dayId, sl, t))]) done++;
        }
      });
    });
    const pct = total ? Math.round(done / total * 100) : 0;

    let banner = '';
    if (cu && !MX.Auth.isAdmin()) {
      const nc  = MX.userColors(cu.name);
      const bg  = cu.color || nc.bg;
      const fg  = cu.color ? MX._contrastColor(cu.color) : nc.fg;
      const lbl = cu.role === "responsable" ? "Responsable · vue complète" : "Technicien · créneaux assignés";
      const _clBdg = MX.badgeBorder ? MX.badgeBorder(cu.name) : null;
      banner = `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:14px">
        <span style="width:32px;height:32px;border-radius:9px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--ffm);flex-shrink:0${_clBdg?';border:2px solid '+_clBdg:''}">${esc(cu.name.substring(0,2).toUpperCase())}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${MX.badgeTag ? MX.badgeTag(cu.name) : ''}${esc(cu.name)}</div>
          <div style="font-size:11px;color:var(--text2)">${lbl}</div>
        </div>
        <button onclick="MX.Auth.clearCurrentUser()" style="font-size:11px;color:var(--cyan);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:var(--ffs)">Changer</button>
      </div>`;
    }

    // Transfers incoming for this day
    const pendingIn  = cu ? (state.transfers || []).filter(tr => tr.toUser === cu.name && tr.status === "pending"  && tr.dayId === dayId) : [];
    const acceptedIn = cu ? (state.transfers || []).filter(tr => tr.toUser === cu.name && tr.status === "accepted" && tr.dayId === dayId) : [];

    const _currK = _weekKey(new Date());

    // ── Page header ──
    let h = '<div class="ph">';
    h += '<div class="ph-eye">' + esc(state.weekLabel) + '</div>';
    h += '<div class="ph-row">';
    h +=   '<div>';
    h +=     '<div class="ph-title">' + esc(day.l) + '</div>';
    h +=     '<div class="ph-sub">' + done + ' / ' + total + ' tâches complétées</div>';
    h +=   '</div>';
    h +=   '<div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:' + (pct>=80?'var(--green)':pct>=40?'var(--orange)':'var(--red)') + '">' + pct + '%</div>';
    h += '</div>';
    h += '<div style="margin-top:10px"><div class="prog-track"><div class="prog-fill" style="width:' + pct + '%"></div></div></div>';
    h += '</div>';

    // ── Split layout ──
    h += '<div class="cl-ws-body">';
    h += '<div class="cl-ws-left">';

    // User banner
    h += banner;

    // Stats row
    h += '<div class="cl-ws-stats">';
    h += '<div class="cl-ws-stat cl-ws-stat--g"><div class="cl-ws-stat-n">' + done + '</div><div class="cl-ws-stat-l">Faites</div></div>';
    h += '<div class="cl-ws-stat cl-ws-stat--b"><div class="cl-ws-stat-n">' + total + '</div><div class="cl-ws-stat-l">Total</div></div>';
    h += '<div class="cl-ws-stat cl-ws-stat--r"><div class="cl-ws-stat-n">' + (total - done) + '</div><div class="cl-ws-stat-l">Restantes</div></div>';
    h += '</div>';

    // ── Incoming transfers ──
    if (pendingIn.length || acceptedIn.length) {
      h += '<div class="cl-ws-xfer-hd"><i class="fas fa-share" style="margin-right:5px;color:var(--cyan)"></i>Tâches reçues (' + (pendingIn.length + acceptedIn.length) + ')</div>';
      pendingIn.forEach(function(tr) {
        const slotObj = MX.SLOTS[tr.slot];
        h += '<div class="transfer-card">' +
          '<div class="transfer-meta"><span class="transfer-from">' + esc(tr.fromUser) + '</span><span class="transfer-day">' + (slotObj ? slotObj.l : tr.slot) + '</span></div>' +
          '<div class="transfer-task">' + esc(tr.taskText) + '</div>' +
          '<div class="transfer-actions">' +
            '<button class="primary-btn" style="flex:1;padding:8px 12px;font-size:13px" onclick="MX.Pages.Checklist.acceptTransfer(\'' + esc(tr.id) + '\')">' +
              '<i class="fas fa-check"></i> Accepter</button>' +
            '<button class="danger-btn" style="flex:1;padding:8px 12px;font-size:13px" onclick="MX.Pages.Checklist.rejectTransfer(\'' + esc(tr.id) + '\')">' +
              '<i class="fas fa-times"></i> Refuser</button>' +
          '</div></div>';
      });
      acceptedIn.forEach(function(tr) {
        const isChk  = !!state.checks[MX.checkKey(tr.dayId, tr.slot, tr.taskId, cu ? cu.id : 'unassigned')];
        const slotObj = MX.SLOTS[tr.slot];
        h += '<div class="trow ' + (isChk ? 'done' : '') + '" id="trr_' + esc(tr.id) + '" onclick="MX.Pages.Checklist.toggleTransferred(\'' + esc(tr.dayId) + '\',\'' + esc(tr.slot) + '\',\'' + esc(tr.taskId) + '\',\'' + esc(tr.id) + '\')">' +
          '<div class="tcb ' + (isChk ? 'on' : '') + '"><i class="fas fa-check"></i></div>' +
          '<span class="ttext">' + esc(tr.taskText) + '</span>' +
          '<span class="twho" style="color:var(--text3);background:var(--bg4)">' + (slotObj ? slotObj.l : tr.slot) + '</span>' +
          '</div>';
      });
    }

    // ── Compact slot groups ──
    const _slotTimes = { matin: '06h – 14h', journee: '14h – 18h', soir: '18h – 22h' };
    let anyVisible = false;

    slots.forEach(function(sl) {
      const slotTasks    = state.tasks[dayId + '_' + sl] || [];
      const slAsn        = isToday ? ((dailyClaims[sl] && dailyClaims[sl].name) || '') : (state.assignments[dayId + '_' + sl] || '');
      const slDailyClaim = isToday ? (dailyClaims[sl] || null) : null;
      const slPlanSugg   = canAll ? _getPlanSuggestions(_currK, dayId, sl) : [];
      const s            = MX.SLOTS[sl] || { l: sl, e: '', c: '', icon: '' };

      // Visibility filter (mirrors slotCard logic)
      const hasPerTask = worker && slotTasks.some(function(t) { return t.assignedTo === worker; });
      if (worker && !MX.Auth.canSeeAll() && slAsn !== worker && !hasPerTask && !(isToday && !slAsn)) return;

      const visTasks = (worker && !MX.Auth.canSeeAll() && slAsn !== worker)
        ? slotTasks.filter(function(t) { return t.assignedTo === worker; })
        : slotTasks;

      let slDone = 0;
      visTasks.forEach(function(t) { if (state.checks[MX.checkKey(dayId, sl, t.id, MX.checkOwnerId(dayId, sl, t))]) slDone++; });
      const slPct = visTasks.length ? Math.round(slDone / visTasks.length * 100) : 0;
      anyVisible = true;

      h += '<div class="cl-ws-sg">';

      // Slot header
      h += '<div class="cl-ws-sg-hd">';
      h +=   '<div class="cl-ws-sg-ico ' + s.c + '">' + s.e + '</div>';
      h +=   '<div class="cl-ws-sg-info">';
      h +=     '<div class="cl-ws-sg-lbl">' + esc(s.l) + '<span class="cl-ws-sg-time">' + (_slotTimes[sl] || '') + '</span></div>';
      h +=     '<div class="cl-ws-sg-sub">' + slDone + '/' + visTasks.length + ' tâches</div>';
      h +=   '</div>';
      h +=   '<div class="cl-ws-sg-pct ' + (slPct>=80?'g':slPct>=40?'o':'r') + '">' + slPct + '%</div>';
      h += '</div>';

      // Assignment row
      if (canAll) {
        if (isToday) {
          const claimName = (slDailyClaim && slDailyClaim.name) || '';
          const lockIcon  = (slDailyClaim && slDailyClaim.lockedBy) ? '<i class="fas fa-lock" style="color:var(--orange);font-size:10px"></i> ' : '';
          if (claimName) {
            h += '<div class="cl-ws-asgn-row">' + lockIcon + '<span class="cl-ws-asgn-chip">' + esc(claimName) + '</span></div>';
          } else if (slPlanSugg.length) {
            h += '<div class="cl-ws-asgn-row"><i class="fas fa-calendar-check" style="color:var(--cyan);font-size:10px"></i>&nbsp;<span class="cl-ws-asgn-chip" style="border-color:rgba(0,245,212,.3)">' + esc(slPlanSugg[0]) + '</span></div>';
          } else {
            h += '<div class="cl-ws-asgn-row"><span style="font-size:11px;color:var(--text3)">Non assigné</span></div>';
          }
        } else {
          const slUsers  = (state.users || []).filter(function(u) { return u.name && !u.hidden; });
          const slSelId  = 'cws-sel-' + dayId + '-' + sl;
          let slOpts = '<option value="">— Non assigné —</option>';
          slUsers.forEach(function(u) {
            slOpts += '<option value="' + esc(u.name) + '"' + (u.name === slAsn ? ' selected' : '') + '>' + esc(u.name) + (slPlanSugg.includes(u.name) ? ' 📅' : '') + '</option>';
          });
          h += '<div class="cl-ws-asgn-row">' +
            '<select id="' + slSelId + '" class="cl-ws-asgn-sel" onchange="MX.Pages.Checklist.assign(\'' + esc(dayId) + '\',\'' + esc(sl) + '\',this.value)">' + slOpts + '</select>' +
            '</div>';
        }
      } else if (slAsn) {
        h += '<div class="cl-ws-asgn-row"><i class="fas fa-user" style="color:var(--text3);font-size:10px"></i>&nbsp;<span class="cl-ws-asgn-chip">' + esc(slAsn) + '</span></div>';
      }

      // Compact task rows
      if (visTasks.length) {
        h += '<div class="cl-ws-sg-tasks">';
        visTasks.forEach(function(t) {
          const tKey    = dayId + '_' + sl + '_' + t.id;
          const isChk   = !!state.checks[MX.checkKey(dayId, sl, t.id, MX.checkOwnerId(dayId, sl, t))];
          const hasNote = !!((state.notes || {})[tKey]);
          const isSel   = _clWsSelKey === tKey;
          const hasAsgn = !!(t.assignedTo || slAsn);
          const stripeC = isChk ? 'done' : (hasAsgn ? 'asgn' : 'todo');
          h += '<div class="cl-ws-tr cl-ws-tr--' + stripeC + (isSel ? ' cl-ws-tr--sel' : '') +
            '" id="cl-ws-tr-' + esc(t.id) + '" data-base="cl-ws-tr--' + (hasAsgn ? 'asgn' : 'todo') +
            '" onclick="MX.Pages.Checklist._clWsOpen(\'' + esc(dayId) + '\',\'' + esc(sl) + '\',\'' + esc(t.id) + '\',true)">';
          h +=   '<div class="cl-ws-tr-stripe"></div>';
          h +=   '<div class="cl-ws-tr-cb' + (isChk ? ' on' : '') + '"><i class="fas fa-check"></i></div>';
          h +=   '<span class="cl-ws-tr-text">' + esc(t.text) + '</span>';
          if (hasNote) h += '<i class="fas fa-note-sticky cl-ws-tr-note" title="Note"></i>';
          h +=   '<div class="cl-ws-tr-arr"><i class="fas fa-chevron-right"></i></div>';
          h += '</div>';
        });
        h += '</div>';
      } else {
        h += '<div class="cl-ws-sg-empty">Aucune tâche configurée</div>';
      }

      // Slot progress footer
      h += '<div class="cl-ws-sg-prog"><div class="cl-ws-sg-prog-fill" style="width:' + slPct + '%"></div></div>';
      h += '</div>'; // cl-ws-sg
    });

    if (!anyVisible && worker && !pendingIn.length && !acceptedIn.length) {
      h += '<div style="text-align:center;padding:40px 16px">' +
        '<div style="font-size:36px;margin-bottom:12px">✅</div>' +
        '<div style="font-size:15px;font-weight:700;margin-bottom:6px">Aucun créneau assigné</div>' +
        '<div style="font-size:12px;color:var(--text2)">Aucun créneau n\'est assigné à <strong>' + esc(worker) + '</strong> ce ' + esc(day.l) + '.</div>' +
        '</div>';
    }

    // ── Interventions summary (admin/responsable) ──
    if (canAll && window.MX.Pages && window.MX.Pages.Int) {
      const iv = MX.Pages.Int._getSummary();
      h += '<div class="slot-card" style="border-color:rgba(124,58,237,.3);margin-top:16px">' +
        '<div class="slot-head" style="background:rgba(124,58,237,.1);border-bottom-color:rgba(124,58,237,.3)">' +
          '<div class="ch-ico" style="background:rgba(124,58,237,.2);color:#a78bfa"><i class="fas fa-wrench"></i></div>' +
          '<div style="flex:1"><div style="font-size:14px;font-weight:700;color:#a78bfa">INTERVENTIONS</div><div class="slot-dl">Synthèse globale</div></div>' +
          '<div class="slot-pct" style="background:rgba(124,58,237,.2);color:#a78bfa">' + iv.total + '</div>' +
        '</div>' +
        '<div style="padding:10px 14px">' +
          '<button onclick="MX.showPage(\'interventions\')" style="width:100%;padding:9px;border:1.5px solid rgba(124,58,237,.3);border-radius:8px;background:rgba(124,58,237,.08);color:#a78bfa;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;justify-content:center;gap:6px">' +
            '<i class="fas fa-external-link-alt"></i> Voir les interventions (' + iv.total + ')' +
          '</button>' +
        '</div>' +
        '</div>';
    }

    // ── Mes interventions (technicien uniquement) ──
    if (!canAll && cu && window.MX.Pages && window.MX.Pages.Int) {
      const myIv = MX.Pages.Int._getSummary(cu.name);
      if (myIv.total > 0) {
        const ST_C = {
          planifiee: { l:'Planifiée', c:'var(--text2)',  bg:'var(--bg4)'          },
          affectee:  { l:'Affectée',  c:'var(--orange)', bg:'var(--orange-dim)'   },
          en_cours:  { l:'En cours',  c:'#F97316',       bg:'rgba(249,115,22,.13)' },
          terminee:  { l:'Terminée',  c:'#22C55E',       bg:'rgba(34,197,94,.13)' },
          en_retard: { l:'En retard', c:'var(--red)',     bg:'var(--red-dim)'      },
          annulee:   { l:'Annulée',   c:'var(--text3)',   bg:'var(--bg4)'          }
        };
        h += '<div class="slot-card" style="border-color:rgba(124,58,237,.3);margin-top:16px">' +
          '<div class="slot-head" style="background:rgba(124,58,237,.1);border-bottom-color:rgba(124,58,237,.3)">' +
            '<div class="ch-ico" style="background:rgba(124,58,237,.2);color:#a78bfa"><i class="fas fa-wrench"></i></div>' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:700;color:#a78bfa">MES INTERVENTIONS</div>' +
            '<div class="slot-dl">' + myIv.total + ' affectée' + (myIv.total!==1?'s':'') + '</div></div>' +
            '<div class="slot-pct" style="background:rgba(124,58,237,.2);color:#a78bfa">' + myIv.total + '</div>' +
          '</div>';
        myIv.items.forEach(function(iv) {
          const sc = ST_C[iv.effStatus] || ST_C.planifiee;
          h += '<div class="trow" onclick="MX.showPage(\'interventions\')" style="cursor:pointer">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:600;color:var(--text1)">' + esc(iv.title) + '</div>' +
              (iv.startDate ? '<div style="font-size:11px;color:var(--text3);margin-top:2px"><i class="fas fa-calendar-day" style="margin-right:4px"></i>' + esc(iv.startDate) + '</div>' : '') +
            '</div>' +
            '<span style="padding:2px 9px;border-radius:6px;font-size:10px;font-weight:700;font-family:var(--ffm);background:' + sc.bg + ';color:' + sc.c + ';white-space:nowrap;flex-shrink:0">' + sc.l + '</span>' +
          '</div>';
        });
        h += '<div style="padding:8px 14px">' +
          '<button onclick="MX.showPage(\'interventions\')" style="width:100%;padding:9px;border:1.5px solid rgba(124,58,237,.3);border-radius:8px;background:rgba(124,58,237,.08);color:#a78bfa;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;justify-content:center;gap:6px">' +
            '<i class="fas fa-external-link-alt"></i> Voir mes interventions' +
          '</button>' +
        '</div></div>';
      }
    }

    // Close left panel, open right panel placeholder
    h += '</div>'; // cl-ws-left
    h += '<div class="cl-ws-rp-wrap"><div id="cl-ws-rp" class="cl-ws-rp"></div></div>';
    h += '</div>'; // cl-ws-body
    el.innerHTML = h;
    el.dataset.dayId = dayId;
    _clWsRpPlaceholder();
  }

  function _clWsRpPlaceholder() {
    const rp = document.getElementById('cl-ws-rp');
    if (!rp) return;
    rp.innerHTML = '<div class="cl-ws-ph">' +
      '<div class="cl-ws-ph-icon"><i class="fas fa-clipboard-list"></i></div>' +
      '<div class="cl-ws-ph-title">Sélectionnez une tâche</div>' +
      '<div class="cl-ws-ph-sub">Cliquez sur une tâche pour accéder à l\'espace de travail</div>' +
      '<div class="cl-ws-ph-hints">' +
        '<div class="cl-ws-ph-hint"><i class="fas fa-check-circle"></i> Valider une tâche</div>' +
        '<div class="cl-ws-ph-hint"><i class="fas fa-note-sticky"></i> Ajouter une note</div>' +
        '<div class="cl-ws-ph-hint"><i class="fas fa-ban"></i> Signaler un problème</div>' +
      '</div>' +
      '</div>';
  }

  function _clWsOpen(dayId, slot, taskId, animate) {
    const { state, DAYS, SLOTS, esc } = MX;
    const key  = dayId + '_' + slot + '_' + taskId;
    const task = (state.tasks[dayId + '_' + slot] || []).find(function(t) { return t.id === taskId; });
    if (!task) return;

    _clWsSelKey = key;

    // Highlight selected row in left panel
    document.querySelectorAll('.cl-ws-tr').forEach(function(el) {
      el.classList.toggle('cl-ws-tr--sel', el.id === 'cl-ws-tr-' + taskId);
    });

    const isChecked = !!state.checks[MX.checkKey(dayId, slot, taskId, MX.checkOwnerId(dayId, slot, task))];
    const note      = (state.notes || {})[key] || '';
    const day       = DAYS.find(function(d) { return d.id === dayId; });
    const s         = SLOTS[slot] || { l: slot, e: '', c: '', icon: '' };
    const cu        = state.currentUser;
    const isToday   = dayId === MX.todayId();
    const asn       = isToday
      ? (((state.dailyClaims || {})[slot] || {}).name || '')
      : (state.assignments[dayId + '_' + slot] || '');
    const effectiveAsn = task.assignedTo || asn || '';
    const canNote   = !!(cu || MX.Auth.isAdmin());

    const rp = document.getElementById('cl-ws-rp');
    if (!rp) return;

    // Status badge
    const statusBadge = isChecked
      ? '<span class="cl-ws-status-badge cl-ws-status-badge--done"><i class="fas fa-check-circle"></i> Validée</span>'
      : '<span class="cl-ws-status-badge cl-ws-status-badge--todo"><i class="fas fa-clock"></i> À faire</span>';

    // Meta badges
    let metaHtml = '<div class="cl-ws-meta-row">';
    metaHtml += '<span class="cl-ws-mb cl-ws-mb--slot"><i class="fas ' + (s.icon || 'fa-circle') + '" style="font-size:10px;margin-right:3px"></i>' + esc(s.l) + '</span>';
    if (effectiveAsn) metaHtml += '<span class="cl-ws-mb cl-ws-mb--tech"><i class="fas fa-user" style="font-size:10px;margin-right:3px"></i>' + esc(effectiveAsn) + '</span>';
    if (day) metaHtml += '<span class="cl-ws-mb cl-ws-mb--date"><i class="fas fa-calendar-day" style="font-size:10px;margin-right:3px"></i>' + esc(day.l) + '</span>';
    metaHtml += '</div>';

    // Consigne card
    const consigneHtml = '<div class="cl-ws-card">' +
      '<div class="cl-ws-card-hd"><i class="fas fa-list-check"></i> Consigne</div>' +
      '<div class="cl-ws-card-body"><p class="cl-ws-bullet">' + esc(task.text) + '</p></div>' +
      '</div>';

    // Note card
    let noteHtml = '<div class="cl-ws-card">';
    noteHtml += '<div class="cl-ws-card-hd"><i class="fas fa-note-sticky"></i> Note</div>';
    noteHtml += '<div class="cl-ws-card-body">';
    if (note) {
      noteHtml += '<div class="cl-ws-note-text">' + esc(note) + '</div>';
    } else {
      noteHtml += '<div class="cl-ws-no-note">Aucune note pour cette tâche</div>';
    }
    noteHtml += '</div>';
    if (canNote) {
      noteHtml += '<div class="cl-ws-card-action">' +
        '<button class="cl-ws-note-btn" onclick="MX.Pages.Checklist.openNote(\'' + esc(dayId) + '\',\'' + esc(slot) + '\',\'' + esc(taskId) + '\')">' +
          '<i class="fas fa-pen"></i> ' + (note ? 'Modifier la note' : 'Ajouter une note') +
        '</button>' +
        '</div>';
    }
    noteHtml += '</div>';

    // Action buttons
    const actionsHtml = '<div class="cl-ws-actions">' +
      '<button class="cl-ws-btn-validate' + (isChecked ? ' cl-ws-btn-validate--done' : '') + '" onclick="MX.Pages.Checklist._clWsToggle(\'' + esc(dayId) + '\',\'' + esc(slot) + '\',\'' + esc(taskId) + '\')">' +
        '<i class="fas fa-' + (isChecked ? 'rotate-left' : 'check-circle') + '"></i> ' + (isChecked ? 'Dévalider' : 'Valider la tâche') +
      '</button>' +
      '<button class="cl-ws-btn-block" onclick="MX.Pages.Checklist._clWsBlockTask(\'' + esc(dayId) + '\',\'' + esc(slot) + '\',\'' + esc(taskId) + '\')">' +
        '<i class="fas fa-ban"></i> Mission impossible' +
      '</button>' +
      '</div>';

    rp.innerHTML = '<div class="cl-ws-ws' + (animate ? ' cl-ws-ws--anim' : '') + '">' +
      '<div class="cl-ws-ws-hdr">' +
        statusBadge +
        '<button class="cl-ws-close-btn" onclick="MX.Pages.Checklist._clWsClose()" title="Fermer"><i class="fas fa-xmark"></i></button>' +
      '</div>' +
      '<div class="cl-ws-ws-title">' + esc(task.text) + '</div>' +
      metaHtml +
      consigneHtml +
      noteHtml +
      actionsHtml +
      '</div>';

    // Scroll workspace into view on mobile
    if (window.innerWidth < 900) {
      rp.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function _clWsClose() {
    _clWsSelKey = null;
    document.querySelectorAll('.cl-ws-tr--sel').forEach(function(el) {
      el.classList.remove('cl-ws-tr--sel');
    });
    _clWsRpPlaceholder();
  }

  async function _clWsToggle(dayId, slot, taskId) {
    await toggle(dayId, slot, taskId);
    const key       = dayId + '_' + slot + '_' + taskId;
    const task      = (MX.state.tasks[dayId + '_' + slot] || []).find(function(t) { return t.id === taskId; });
    const isChecked = !!MX.state.checks[MX.checkKey(dayId, slot, taskId, MX.checkOwnerId(dayId, slot, task))];
    // Update left panel row stripe + checkbox
    const row = document.getElementById('cl-ws-tr-' + taskId);
    if (row) {
      const baseClass = row.dataset.base || 'cl-ws-tr--todo';
      row.classList.toggle('cl-ws-tr--done', isChecked);
      row.classList.toggle(baseClass, !isChecked);
      const cb = row.querySelector('.cl-ws-tr-cb');
      if (cb) cb.classList.toggle('on', isChecked);
    }
    // Refresh workspace panel
    if (_clWsSelKey === key) _clWsOpen(dayId, slot, taskId, false);
  }

  function _clWsBlockTask(dayId, slot, taskId) {
    const { esc } = MX;
    const task = (MX.state.tasks[dayId + '_' + slot] || []).find(function(t) { return t.id === taskId; });
    document.getElementById('m-title').textContent = 'Mission impossible';
    document.getElementById('m-sub').innerHTML =
      '<div style="font-size:13px;color:var(--text2);margin-bottom:10px">' +
        (task ? '<strong>' + esc(task.text) + '</strong>' : '') +
      '</div>' +
      '<textarea id="note-ta" class="fi" style="width:100%;min-height:80px;resize:vertical;font-size:13px;line-height:1.5;margin-top:4px" placeholder="Décrivez la raison du blocage…" maxlength="500"></textarea>';
    document.getElementById('m-actions').innerHTML =
      '<button class="modal-btn confirm" style="background:var(--orange);border-color:var(--orange)" onclick="MX.Pages.Checklist._clWsConfirmBlock(\'' + esc(dayId) + '\',\'' + esc(slot) + '\',\'' + esc(taskId) + '\')">' +
        '<i class="fas fa-ban"></i> Signaler</button>' +
      '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  async function _clWsConfirmBlock(dayId, slot, taskId) {
    const ta     = document.getElementById('note-ta');
    const reason = ta ? ta.value.trim() : '';
    MX.closeModal();
    if (!reason) return;
    const key      = dayId + '_' + slot + '_' + taskId;
    const existing = (MX.state.notes || {})[key] || '';
    const newNote  = (existing ? existing + '\n' : '') + '[BLOQUÉ] ' + reason;
    MX.state.notes = MX.state.notes || {};
    MX.state.notes[key] = newNote;
    try {
      await MX.DB.setNote(key, newNote);
      MX.toast('Mission signalée ✓');
    } catch(e) {
      MX.toast('Erreur', true);
    }
    // Add note icon to left panel row if not already there
    const row = document.getElementById('cl-ws-tr-' + taskId);
    if (row && !row.querySelector('.cl-ws-tr-note')) {
      const arr = row.querySelector('.cl-ws-tr-arr');
      if (arr) {
        const ni = document.createElement('i');
        ni.className = 'fas fa-note-sticky cl-ws-tr-note';
        ni.title = 'Note';
        row.insertBefore(ni, arr);
      }
    }
    // Refresh workspace panel
    if (_clWsSelKey === key) _clWsOpen(dayId, slot, taskId, false);
  }

  async function toggle(dayId, slot, taskId) {
    const state = MX.state;
    const task  = (state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
    const key   = MX.checkKey(dayId, slot, taskId, MX.checkOwnerId(dayId, slot, task));
    const val   = !state.checks[key];

    state.checks[key] = val;
    const row = document.getElementById("tr_" + taskId);
    if (row) {
      row.classList.toggle("done", val);
      const cb = row.querySelector(".tcb");
      if (cb) { cb.classList.toggle("on", val); cb.innerHTML = val ? '<i class="fas fa-check"></i>' : ""; }
    }

    try {
      await MX.DB.setCheck(key, val);
      const cu        = state.currentUser;
      const actorName = cu ? cu.name : (state.adminUser ? state.adminUser.email : "inconnu");
      MX.DB.addLog({ workerName: actorName, action: val ? "check" : "uncheck", taskText: task ? task.text : taskId, dayId, slot }).catch(() => {});
    } catch (e) {
      state.checks[key] = !val;
      MX.toast("Erreur de connexion", true);
    }
  }

  async function assign(dayId, slot, name) {
    MX.state.assignments[`${dayId}_${slot}`] = name;
    try {
      await MX.DB.setAssignment(dayId, slot, name);
      const actorName = MX.state.adminUser ? MX.state.adminUser.email : (MX.state.currentUser ? MX.state.currentUser.name : "inconnu");
      MX.DB.addLog({ workerName: actorName, action: "assign", taskText: `${dayId} ${slot} → ${name || "(aucun)"}`, dayId, slot }).catch(() => {});
    } catch (e) {
      MX.toast("Erreur lors de l'assignation", true);
    }
  }

  // ── PER-TASK ASSIGNMENT (current week) ──
  async function assignTask(dayId, slot, taskId, value, setCustomized) {
    const key      = `${dayId}_${slot}`;
    const tasks    = MX.state.tasks[key] || [];
    const newItems = tasks.map(t => {
      if (t.id !== taskId) return t;
      const updated = Object.assign({}, t);
      if (value) updated.assignedTo = value;
      else delete updated.assignedTo;
      if (setCustomized) updated.customized = true;
      return updated;
    });
    MX.state.tasks[key] = newItems;
    MX.syncStart();
    try {
      await MX.DB.setTasks(dayId, slot, newItems);
      MX.syncEnd();
      if (setCustomized) {
        const mc = document.getElementById('main-content');
        if (mc && mc.dataset.dayId === dayId) render(dayId);
      }
    } catch(e) {
      MX.state.tasks[key] = tasks;
      MX.syncFail();
      MX.toast('Erreur lors de l\'assignation', true);
    }
  }

  // ── SLOT-FIRST ASSIGNMENT: apply slot tech to all non-customized tasks ──
  async function applySlotTech(dayId, slot, name) {
    const key   = `${dayId}_${slot}`;
    const tasks = MX.state.tasks[key] || [];
    const newItems = tasks.map(t => {
      if (t.customized) return t;
      const u = Object.assign({}, t);
      if (name) u.assignedTo = name; else delete u.assignedTo;
      return u;
    });
    MX.syncStart();
    try {
      await MX.DB.setAssignment(dayId, slot, name);
      await MX.DB.setTasks(dayId, slot, newItems);
      MX.state.assignments[`${dayId}_${slot}`] = name;
      MX.state.tasks[key] = newItems;
      MX.syncEnd();
      const _LBL = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };
      MX.toast((_LBL[slot] || slot) + ' → ' + (name || 'non assigné') + ' ✓');
      const mc = document.getElementById('main-content');
      if (mc && mc.dataset.dayId === dayId) render(dayId);
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur lors de l\'assignation', true);
    }
  }

  // ── CLEAR TASK CUSTOMIZATION (revert to slot-level tech) ──
  async function clearTaskCustom(dayId, slot, taskId) {
    const key      = `${dayId}_${slot}`;
    const tasks    = MX.state.tasks[key] || [];
    const slotTech = MX.state.assignments[`${dayId}_${slot}`] || '';
    const newItems = tasks.map(t => {
      if (t.id !== taskId) return t;
      const u = Object.assign({}, t);
      delete u.customized;
      if (slotTech) u.assignedTo = slotTech; else delete u.assignedTo;
      return u;
    });
    MX.syncStart();
    try {
      await MX.DB.setTasks(dayId, slot, newItems);
      MX.state.tasks[key] = newItems;
      MX.syncEnd();
      MX.toast('Réinitialisé au créneau ✓');
      const mc = document.getElementById('main-content');
      if (mc && mc.dataset.dayId === dayId) render(dayId);
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur', true);
    }
  }

  // ── TOGGLE PER-TASK PICK PANEL (DOM-level, no re-render) ──
  function _togglePick(taskId) {
    const el = document.getElementById('tc-pick-' + taskId);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
  }

  // ── ASSIGN ALL TASKS IN A SLOT ──
  async function assignAllSlotTasks(dayId, slot, assigneeName) {
    const key      = `${dayId}_${slot}`;
    const tasks    = MX.state.tasks[key] || [];
    const newItems = tasks.map(t => {
      const updated = Object.assign({}, t);
      if (assigneeName) updated.assignedTo = assigneeName;
      else delete updated.assignedTo;
      return updated;
    });
    MX.state.tasks[key] = newItems;
    MX.syncStart();
    try {
      await MX.DB.setTasks(dayId, slot, newItems);
      MX.syncEnd();
      const _SLOT_LBL = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };
      MX.toast(`${_SLOT_LBL[slot] || slot} — toutes les tâches assignées à ${assigneeName} ✓`);
    } catch(e) {
      MX.state.tasks[key] = tasks;
      MX.syncFail();
      MX.toast('Erreur lors de l\'assignation', true);
    }
  }

  function promptAssignAll(dayId, slot) {
    const users = (MX.state.users || []).filter(u => u.name && !u.hidden);
    const _SLOT_LBL = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };
    document.getElementById('m-title').textContent = 'Assigner tout — ' + (_SLOT_LBL[slot] || slot);
    document.getElementById('m-sub').innerHTML =
      '<select id="assign-all-sel" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);color:var(--text1);font-size:14px;font-family:var(--ffs)">'
      + '<option value="">— Choisir un technicien —</option>'
      + users.map(u => `<option value="${MX.esc(u.name)}">${MX.esc(u.name)}</option>`).join('')
      + '</select>';
    document.getElementById('m-body').innerHTML = '';
    document.getElementById('m-actions').innerHTML =
      `<button class="modal-btn confirm" onclick="MX.Pages.Checklist._doAssignAll('${MX.esc(dayId)}','${MX.esc(slot)}')">`
      + '<i class="fas fa-user-check"></i> Assigner tout</button>'
      + '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  function _doAssignAll(dayId, slot) {
    const sel  = document.getElementById('assign-all-sel');
    const name = sel ? sel.value : '';
    if (!name) { MX.toast('Sélectionnez un technicien', true); return; }
    MX.closeModal();
    assignAllSlotTasks(dayId, slot, name);
  }

  // ── DAILY CLAIMS (auto-attribution) ──
  const _SLOT_LBL = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };

  async function claimSlot(slot) {
    const cu = MX.state.currentUser;
    if (!cu) return MX.toast("Connectez-vous pour prendre un créneau", true);
    const dateStr = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    if (existing.lockedBy) return MX.toast("Ce créneau est verrouillé par le responsable", true);
    if (existing.name && existing.name !== cu.name) return MX.toast("Ce créneau est déjà pris par " + existing.name, true);
    try {
      await MX.DB.setDailyClaim(dateStr, slot, cu.name, "");
      const todayDayId = MX.todayId();
      const key = todayDayId + '_' + slot;
      const tasks = MX.state.tasks[key] || [];
      if (tasks.length) {
        const newItems = tasks.map(t => {
          if (t.customized) return t;
          const u = Object.assign({}, t);
          u.assignedTo = cu.name;
          return u;
        });
        MX.DB.setTasks(todayDayId, slot, newItems)
          .then(() => { MX.state.tasks[key] = newItems; })
          .catch(() => {});
      }
      MX.toast("Créneau " + (_SLOT_LBL[slot] || slot) + " pris ✓");
      MX.DB.addLog({ workerName: cu.name, action: "claim", taskText: "[Aujourd'hui] " + cu.name + " a pris le créneau " + slot, dayId: todayDayId, slot }).catch(() => {});
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function unclaimSlot(slot) {
    const cu = MX.state.currentUser;
    if (!cu) return;
    const dateStr  = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    if (existing.lockedBy) return MX.toast("Créneau verrouillé — contactez un responsable", true);
    if (existing.name !== cu.name) return;
    try {
      await MX.DB.clearDailyClaim(dateStr, slot);
      const todayDayId = MX.todayId();
      const key = todayDayId + '_' + slot;
      const tasks = MX.state.tasks[key] || [];
      if (tasks.length) {
        const newItems = tasks.map(t => {
          if (t.customized) return t;
          const u = Object.assign({}, t);
          delete u.assignedTo;
          return u;
        });
        MX.DB.setTasks(todayDayId, slot, newItems)
          .then(() => { MX.state.tasks[key] = newItems; })
          .catch(() => {});
      }
      MX.toast("Créneau rendu");
      MX.DB.addLog({ workerName: cu.name, action: "unclaim", taskText: "[Aujourd'hui] " + cu.name + " a rendu le créneau " + slot, dayId: todayDayId, slot }).catch(() => {});
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function assignToday(slot, name) {
    const dateStr = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const actor   = MX.state.adminUser ? (MX.state.adminUser.email || "admin") : (MX.state.currentUser ? MX.state.currentUser.name : "resp");
    try {
      await MX.DB.setDailyClaim(dateStr, slot, name, actor);
      if (name) {
        const todayDayId = MX.todayId();
        const key = todayDayId + '_' + slot;
        const tasks = MX.state.tasks[key] || [];
        if (tasks.length) {
          const newItems = tasks.map(t => {
            if (t.customized) return t;
            const u = Object.assign({}, t);
            u.assignedTo = name;
            return u;
          });
          MX.DB.setTasks(todayDayId, slot, newItems)
            .then(() => { MX.state.tasks[key] = newItems; })
            .catch(() => {});
        }
      }
      MX.toast((_SLOT_LBL[slot] || slot) + " → " + (name || "(aucun)") + " ✓");
      MX.DB.addLog({ workerName: actor, action: "assign", taskText: "[Aujourd'hui] " + slot + " → " + (name || "(aucun)") + " (verrouillé)", dayId: MX.todayId(), slot }).catch(() => {});
    } catch(e) { MX.toast("Erreur lors de l'assignation", true); }
  }

  async function toggleLockSlot(slot) {
    const dateStr  = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    const actor    = MX.state.adminUser ? (MX.state.adminUser.email || "admin") : (MX.state.currentUser ? MX.state.currentUser.name : "resp");
    const newLock  = existing.lockedBy ? "" : actor;
    try {
      await MX.DB.setDailyClaim(dateStr, slot, existing.name || "", newLock);
      MX.toast(newLock ? "Créneau verrouillé 🔒" : "Créneau déverrouillé");
    } catch(e) { MX.toast("Erreur", true); }
  }

  // ── TRANSFER ──
  function startTransfer(dayId, slot, taskId) {
    const cu = MX.state.currentUser;
    if (!cu) return MX.toast("Connectez-vous pour transférer", true);

    const task = (MX.state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
    if (!task) return;

    const others = (MX.state.users || []).filter(u => u.name !== cu.name);
    if (!others.length) return MX.toast("Aucun autre utilisateur disponible", true);

    MX._pendingTransfer = { dayId, slot, taskId, taskText: task.text };

    const picks = others.map(u => {
      const nc = MX.userColors(u.name);
      return `<button onclick="MX.Pages.Checklist.confirmTransfer('${MX.esc(u.name)}')"
        style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3);cursor:pointer;width:100%;text-align:left;margin-bottom:8px;font-size:14px;font-weight:500;color:var(--text1);font-family:var(--ffs)">
        <span style="width:34px;height:34px;border-radius:9px;background:${nc.bg};color:${nc.fg};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${MX.esc(u.name.substring(0,2).toUpperCase())}</span>
        ${MX.esc(u.name)}
      </button>`;
    }).join('');

    document.getElementById("m-title").textContent = "Transférer à…";
    document.getElementById("m-sub").innerHTML = `
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5">"${MX.esc(task.text)}"</div>
      ${picks}`;
    document.getElementById("m-actions").innerHTML = `<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>`;
    document.getElementById("modal-bg").classList.add("show");
  }

  async function confirmTransfer(toUser) {
    MX.closeModal();
    const t  = MX._pendingTransfer;
    const cu = MX.state.currentUser;
    if (!t || !cu) return;
    delete MX._pendingTransfer;

    try {
      await MX.DB.createTransfer({ taskId: t.taskId, taskText: t.taskText, dayId: t.dayId, slot: t.slot, fromUser: cu.name, toUser });
      MX.toast("Transféré à " + toUser + " ✓");
    } catch(e) {
      MX.toast("Erreur lors du transfert", true);
    }
  }

  async function acceptTransfer(transferId) {
    try {
      await MX.DB.updateTransfer(transferId, "accepted");
      MX.toast("Tâche acceptée ✓");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  async function rejectTransfer(transferId) {
    try {
      await MX.DB.updateTransfer(transferId, "rejected");
      MX.toast("Tâche refusée");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  async function cancelTransfer(transferId) {
    try {
      await MX.DB.cancelTransfer(transferId);
      MX.toast("Transfert annulé");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  async function toggleTransferred(dayId, slot, taskId, transferId) {
    const state = MX.state;
    const cu    = state.currentUser;
    const key   = MX.checkKey(dayId, slot, taskId, cu ? cu.id : 'unassigned');
    const val   = !state.checks[key];

    state.checks[key] = val;
    const row = document.getElementById("trr_" + transferId);
    if (row) {
      row.classList.toggle("done", val);
      const cb = row.querySelector(".tcb");
      if (cb) { cb.classList.toggle("on", val); cb.innerHTML = val ? '<i class="fas fa-check"></i>' : ""; }
    }

    try {
      await MX.DB.setCheck(key, val);
      const actorName = cu ? cu.name : "inconnu";
      const tr = (state.transfers || []).find(t => t.id === transferId);
      MX.DB.addLog({ workerName: actorName, action: val ? "check" : "uncheck", taskText: tr ? tr.taskText : taskId, dayId, slot }).catch(() => {});
    } catch(e) {
      state.checks[key] = !val;
      MX.toast("Erreur de connexion", true);
    }
  }

  function openNote(dayId, slot, taskId) {
    const key  = `${dayId}_${slot}_${taskId}`;
    const task = (MX.state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
    const note = (MX.state.notes || {})[key] || "";
    const cu   = MX.state.currentUser;
    const canWrite = !!(cu || MX.Auth.isAdmin());

    document.getElementById("m-title").textContent = task ? task.text : "Note";
    if (canWrite) {
      document.getElementById("m-sub").innerHTML =
        `<textarea id="note-ta" class="fi" style="width:100%;min-height:90px;resize:vertical;font-size:13px;line-height:1.5;margin-top:6px" placeholder="Ajouter une remarque sur cette tâche…" maxlength="500">${MX.esc(note)}</textarea>`;
      document.getElementById("m-actions").innerHTML = `
        <button class="modal-btn confirm" onclick="MX.Pages.Checklist.saveNote('${MX.esc(key)}')"><i class="fas fa-check"></i> Enregistrer</button>
        <button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>`;
    } else {
      document.getElementById("m-sub").innerHTML = note
        ? `<div style="font-size:13px;line-height:1.6;color:var(--text2);padding:6px 0">${MX.esc(note)}</div>`
        : `<div style="font-size:13px;color:var(--text3);padding:6px 0">Aucune note pour cette tâche.</div>`;
      document.getElementById("m-actions").innerHTML =
        `<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>`;
    }
    document.getElementById("modal-bg").classList.add("show");
  }

  async function saveNote(key) {
    const ta   = document.getElementById("note-ta");
    const text = ta ? ta.value.trim() : "";
    MX.closeModal();
    try {
      await MX.DB.setNote(key, text);
      MX.toast(text ? "Note enregistrée ✓" : "Note supprimée");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  function toggleMission(missionId) {
    const m  = (MX.state.missions || []).find(x => x.id === missionId);
    const cu = MX.state.currentUser;
    if (!m) return;
    const isForAll = m.assignedTo === "all" || !m.assignedTo;
    if (!MX.Auth.canSeeAll() && !isForAll && cu?.name !== m.assignedTo) return MX.toast("Non autorisé", true);

    document.getElementById("m-title").textContent = "Clôturer l'intervention";
    document.getElementById("m-sub").innerHTML = `
      <div style="margin:6px 0">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--red)">
          <i class="fas fa-circle-exclamation"></i> ${MX.esc(m.text)}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px">
          Un commentaire est requis pour valider la clôture :
        </div>
        <textarea id="mission-comment" class="fi"
          style="width:100%;min-height:80px;resize:vertical;font-size:13px;line-height:1.5"
          placeholder="Ex : Carnet vérifié, aucune anomalie…" maxlength="300"></textarea>
        <div id="mission-comment-err" style="color:var(--red);font-size:11px;min-height:16px;margin-top:4px"></div>
      </div>`;
    document.getElementById("m-actions").innerHTML = `
      <button class="modal-btn confirm" onclick="MX.Pages.Checklist._confirmMissionClose('${MX.esc(missionId)}')">
        <i class="fas fa-check"></i> Valider la clôture
      </button>
      <button class="modal-btn cancel" onclick="MX.closeModal()">
        <i class="fas fa-times"></i> Annuler
      </button>`;
    document.getElementById("modal-bg").classList.add("show");
    setTimeout(() => document.getElementById("mission-comment")?.focus(), 80);
  }

  async function _confirmMissionClose(missionId) {
    const comment  = (document.getElementById("mission-comment") || {}).value?.trim() || "";
    const errEl    = document.getElementById("mission-comment-err");
    if (!comment) {
      if (errEl) errEl.textContent = "Un commentaire est obligatoire pour clôturer.";
      return;
    }
    MX.closeModal();
    const m         = (MX.state.missions || []).find(x => x.id === missionId);
    const cu        = MX.state.currentUser;
    const actorName = cu?.name || (MX.state.adminUser?.email || "inconnu");
    try {
      await MX.DB.updateMission(missionId, {
        done: true,
        completionComment: comment,
        completedBy: actorName
      });
      MX.DB.addLog({
        workerName: actorName, action: "check",
        taskText: "[Intervention] " + (m?.text || "") + " — " + comment,
        dayId: m?.dayId || "all", slot: "intervention"
      }).catch(() => {});
      MX.toast("Intervention clôturée ✓");
    } catch(e) { MX.toast("Erreur", true); }
  }

  // ── ROLE-BASED ENTRY POINT ──
  function renderForRole() {
    if (MX.Auth.canSeeAll()) {
      renderWeekSlots();
    } else {
      renderWeekly();
    }
  }

  // ── WEEK / DATE HELPERS ──
  function _isoWk(d) {
    const t = new Date(d); t.setHours(0,0,0,0);
    t.setDate(t.getDate() + 4 - (t.getDay() || 7));
    const y0 = new Date(t.getFullYear(), 0, 1);
    return { y: t.getFullYear(), n: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
  }
  function _weekKey(d) {
    const wk = _isoWk(d);
    return `${wk.y}_W${String(wk.n).padStart(2,'0')}`;
  }
  function _weekLabel(wk) {
    const p = wk.split('_W');
    return `Semaine ${parseInt(p[1], 10)} — ${p[0]}`;
  }
  function _jsDayId(jsDay) {
    return ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][jsDay];
  }
  function _getMonthWeeks(year, month) {
    const last = new Date(year, month + 1, 0);
    const rows = [];
    const start = new Date(year, month, 1);
    const jd = start.getDay() || 7;
    let curr = new Date(start);
    curr.setDate(curr.getDate() - jd + 1);
    curr.setHours(0,0,0,0);
    while (curr <= last) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(curr); d.setDate(d.getDate() + i);
        days.push({ date: new Date(d), dayId: _jsDayId(d.getDay()), inMonth: d.getMonth() === month && d.getFullYear() === year });
      }
      rows.push({ weekKey: _weekKey(curr), days });
      curr.setDate(curr.getDate() + 7);
    }
    return rows;
  }

  // ── MONTHLY VIEW MODULE STATE ──
  let _mvY = null, _mvM = null, _mvD = {};
  // ── WEEK SYSTEM STATE ──
  let _wsCurrentKey = null;

  // ── TECHNICIEN WEEKLY VIEW ──
  function renderWeekly() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { state, DAYS, getDaySlots, esc } = MX;
    const cu = state.currentUser;
    const todayId = MX.todayId ? MX.todayId() : (DAYS[0] && DAYS[0].id);

    const dayStats = DAYS.map(day => {
      let dt = 0, dd = 0;
      (getDaySlots(day.id) || []).forEach(sl => {
        const tasks = state.tasks[`${day.id}_${sl}`] || [];
        const asn = (day.id === todayId && state.dailyClaims && state.dailyClaims[sl])
          ? (state.dailyClaims[sl].name || state.assignments[`${day.id}_${sl}`] || '')
          : (state.assignments[`${day.id}_${sl}`] || '');
        if (!cu || asn === cu.name || tasks.some(t => t.assignedTo === cu.name)) {
          tasks.forEach(t => {
            if (!cu || asn === cu.name || t.assignedTo === cu.name) {
              dt++;
              if (state.checks[MX.checkKey(day.id, sl, t.id, MX.checkOwnerId(day.id, sl, t))]) dd++;
            }
          });
        }
      });
      return { day, dt, dd, pct: dt ? Math.round(dd / dt * 100) : -1 };
    });

    const wTotal = dayStats.reduce((s, d) => s + d.dt, 0);
    const wDone  = dayStats.reduce((s, d) => s + d.dd, 0);
    const wPct   = wTotal ? Math.round(wDone / wTotal * 100) : 0;
    const wPctC  = wPct >= 80 ? 'var(--green)' : wPct >= 40 ? 'var(--orange)' : 'var(--red)';

    const nc = cu ? MX.userColors(cu.name) : null;
    const bg = cu ? (cu.color || nc.bg) : 'var(--bg4)';
    const fg = cu ? (cu.color ? MX._contrastColor(cu.color) : nc.fg) : 'var(--text3)';

    let h = `<div class="ph">
      <div class="ph-eye">${esc(state.weekLabel || 'Semaine en cours')}</div>
      <div class="ph-row">
        <div>
          <div class="ph-title">Ma semaine</div>
          <div class="ph-sub">${wDone} / ${wTotal} tâches complétées</div>
        </div>
        <div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:${wPctC}">${wPct}%</div>
      </div>
      <div style="margin-top:10px"><div class="prog-track"><div class="prog-fill" style="width:${wPct}%"></div></div></div>
    </div>
    <div class="page-body" style="max-width:760px">`;

    if (cu) {
      h += `<div class="cl-user-banner">
        <span class="cl-user-av" style="background:${bg};color:${fg}">${esc(cu.name.substring(0,2).toUpperCase())}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${esc(cu.name)}</div>
          <div style="font-size:11px;color:var(--text2)">Technicien · créneaux assignés uniquement</div>
        </div>
        <button onclick="MX.Auth.clearCurrentUser()" style="font-size:11px;color:var(--cyan);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:var(--ffs)">Changer</button>
      </div>`;
    }

    h += `<div class="cl-week-grid">`;
    dayStats.forEach(({ day, dt, dd, pct }) => {
      const isT = day.id === todayId;
      const pctC = pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
      let cls = 'cl-week-day';
      if (isT) cls += ' cl-day--today';
      if (pct < 0)       cls += ' cl-day--empty';
      else if (pct >= 100) cls += ' cl-day--done';
      else if (pct > 0)  cls += ' cl-day--prog';
      else               cls += ' cl-day--todo';

      h += `<div class="${cls}" onclick="MX.showPage('${esc(day.id)}')">
        <div class="cl-day-name">${esc(day.l)}</div>
        ${isT ? '<div class="cl-day-today-b">Auj.</div>' : ''}
        ${pct >= 0
          ? `<div class="cl-day-pct" style="color:${pctC}">${pct}%</div>
             <div class="cl-day-counts">${dd}/${dt}</div>
             <div class="cl-day-bar-t"><div class="cl-day-bar-f" style="width:${pct}%;background:${pctC}"></div></div>`
          : `<div class="cl-day-noasn">—</div>`}
      </div>`;
    });
    h += `</div>`;

    const todayDayL = ((DAYS.find(d => d.id === todayId) || {}).l) || 'Aujourd\'hui';
    const todaySt = dayStats.find(d => d.day.id === todayId);
    const todayP  = todaySt ? todaySt.pct : -1;
    const todayPC = todayP >= 100 ? 'var(--green)' : todayP >= 50 ? 'var(--orange)' : 'var(--red)';

    h += `<div style="margin-top:20px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">Accès rapide — ${esc(todayDayL)}</div>
      <button onclick="MX.showPage('${esc(todayId)}')" class="cl-quick-btn" style="border-color:var(--cyan-border);background:var(--cyan-dim);color:var(--cyan)">
        <i class="fas fa-list-check"></i> Voir mes tâches d'aujourd'hui
        ${todayP >= 0 ? `<span style="margin-left:auto;font-size:13px;font-weight:700;color:${todayPC}">${todayP}%</span>` : ''}
      </button>
    </div>
    </div>`;
    mc.innerHTML = h;
  }

  // ── RESPONSABLE / ADMIN MONTHLY VIEW ──
  async function renderMonthly(year, month) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    _mvY = year; _mvM = month;
    const MNAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    mc.innerHTML = `<div class="ph"><div class="ph-eye">Vue mensuelle</div>
      <div class="ph-row"><div><div class="ph-title">${MNAMES[month]} ${year}</div></div></div></div>
      <div class="page-body" style="max-width:940px;text-align:center;padding:40px 0">
        <i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--text3)"></i>
        <div style="margin-top:12px;font-size:13px;color:var(--text3)">Chargement des données…</div>
      </div>`;

    const currKey = _weekKey(new Date());
    const weeks = _getMonthWeeks(year, month);

    await Promise.all(
      weeks.filter(w => w.weekKey !== currKey).map(w =>
        MX.DB.getWeeklyChecks(w.weekKey)
          .then(data => { if (data) _mvD[w.weekKey] = data; })
          .catch(() => {})
      )
    );

    _renderMonthlyHtml(year, month, weeks, currKey);
  }

  function _renderMonthlyHtml(year, month, weeks, currKey) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { state, DAYS, getDaySlots, esc } = MX;
    const MNAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const prevM = month === 0 ? {y:year-1,m:11} : {y:year,m:month-1};
    const nextM = month === 11 ? {y:year+1,m:0} : {y:year,m:month+1};
    const today = new Date(); today.setHours(0,0,0,0);

    let mTotal = 0, mDone = 0, mLate = 0;
    const uStats = {};

    weeks.forEach(w => {
      const isCurr = w.weekKey === currKey;
      const wd  = isCurr ? null : _mvD[w.weekKey];
      const chk = isCurr ? state.checks      : (wd ? (wd.checks      || {}) : null);
      const tsk = isCurr ? state.tasks       : (wd ? (wd.tasks       || {}) : null);
      const asn = isCurr ? state.assignments : (wd ? (wd.assignments || {}) : null);
      if (!chk || !tsk) return;
      w.days.forEach(({ dayId, inMonth, date }) => {
        if (!inMonth) return;
        getDaySlots(dayId).forEach(sl => {
          const who = asn ? (asn[`${dayId}_${sl}`] || '') : '';
          (tsk[`${dayId}_${sl}`] || []).forEach(t => {
            mTotal++;
            // Live week reads the new per-owner key; archived weeks keep the short key.
            const done = !!(isCurr
              ? state.checks[MX.checkKey(dayId, sl, t.id, MX.checkOwnerId(dayId, sl, t))]
              : chk[`${dayId}_${sl}_${t.id}`]);
            if (done) mDone++;
            else if (date < today) mLate++;
            if (who) {
              if (!uStats[who]) uStats[who] = {total:0,done:0};
              uStats[who].total++;
              if (done) uStats[who].done++;
            }
          });
        });
      });
    });

    const rate  = mTotal ? Math.round(mDone / mTotal * 100) : 0;
    const rateC = rate >= 80 ? 'var(--green)' : rate >= 40 ? 'var(--orange)' : 'var(--red)';
    const ranking = Object.entries(uStats)
      .map(([name, s]) => ({ name, ...s, pct: s.total ? Math.round(s.done/s.total*100) : 0 }))
      .sort((a,b) => b.pct - a.pct || b.done - a.done);

    let h = `<div class="ph">
      <div class="ph-eye">Vue mensuelle responsable</div>
      <div class="ph-row">
        <div><div class="ph-title">Check-lists</div><div class="ph-sub">${MNAMES[month]} ${year}</div></div>
        <div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:${rateC}">${rate}%</div>
      </div>
      <div style="margin-top:10px"><div class="prog-track"><div class="prog-fill" style="width:${rate}%"></div></div></div>
    </div>
    <div class="page-body" style="max-width:940px">

    <div class="cl-month-nav">
      <button class="cl-month-btn" onclick="MX.Pages.Checklist.renderMonthly(${prevM.y},${prevM.m})"><i class="fas fa-chevron-left"></i></button>
      <div class="cl-month-title">${MNAMES[month]} ${year}</div>
      <button class="cl-month-btn" onclick="MX.Pages.Checklist.renderMonthly(${nextM.y},${nextM.m})"><i class="fas fa-chevron-right"></i></button>
    </div>

    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-n g">${mDone}</div><div class="stat-l">Faites</div></div>
      <div class="stat-card"><div class="stat-n b">${mTotal}</div><div class="stat-l">Total</div></div>
      <div class="stat-card"><div class="stat-n r">${mLate}</div><div class="stat-l">En retard</div></div>
      <div class="stat-card"><div class="stat-n" style="color:${rateC}">${rate}%</div><div class="stat-l">Taux</div></div>
    </div>

    <div class="cl-month-cal">
      <div class="cl-cal-header">
        ${DAYS.map(d => `<div class="cl-cal-hcell">${esc(d.l.substring(0,3))}</div>`).join('')}
      </div>`;

    weeks.forEach(w => {
      const isCurr = w.weekKey === currKey;
      const wd  = isCurr ? null : _mvD[w.weekKey];
      const chk = isCurr ? state.checks : (wd ? (wd.checks || {}) : null);
      const tsk = isCurr ? state.tasks  : (wd ? (wd.tasks  || {}) : null);

      h += `<div class="cl-cal-week${isCurr ? ' cl-cal-week--curr' : ''}">`;
      if (isCurr) h += `<div class="cl-cal-week-badge">Semaine en cours</div>`;

      w.days.forEach(({ dayId, inMonth, date }) => {
        if (!inMonth) { h += `<div class="cl-cal-cell cl-cal-cell--out"></div>`; return; }
        const isT    = date.toDateString() === today.toDateString();
        const isPast = date < today;
        const dn     = date.getDate();

        if (!chk || !tsk) {
          h += `<div class="cl-cal-cell cl-cal-cell--nodata${isT ? ' cl-cal-cell--today' : ''}">
            <span class="cl-cal-dn">${dn}</span><span class="cl-cal-nd">─</span></div>`;
          return;
        }

        let dt = 0, dd = 0;
        getDaySlots(dayId).forEach(sl => {
          (tsk[`${dayId}_${sl}`] || []).forEach(t => {
            dt++;
            // Live week reads the new per-owner key; archived weeks keep the short key.
            const isDone = isCurr
              ? state.checks[MX.checkKey(dayId, sl, t.id, MX.checkOwnerId(dayId, sl, t))]
              : chk[`${dayId}_${sl}_${t.id}`];
            if (isDone) dd++;
          });
        });

        const pct = dt ? Math.round(dd / dt * 100) : -1;
        let dotC = '', cls = 'cl-cal-cell';
        if (isT) cls += ' cl-cal-cell--today';
        if (pct < 0)      cls += ' cl-cal-cell--notasks';
        else if (pct >= 100) { cls += ' cl-cal-cell--done'; dotC = 'var(--green)'; }
        else if (pct > 0)    { cls += ' cl-cal-cell--prog'; dotC = 'var(--orange)'; }
        else if (isPast)     { cls += ' cl-cal-cell--late'; dotC = 'var(--red)'; }
        else                 { cls += ' cl-cal-cell--todo'; }

        let cfn = '';
        if (isCurr) {
          cfn = ` onclick="MX.showPage('${esc(dayId)}')" style="cursor:pointer"`;
        } else if (isPast) {
          cfn = ` onclick="MX.Pages.Checklist._showHistDay('${esc(w.weekKey)}','${esc(dayId)}')" style="cursor:pointer"`;
        }
        h += `<div class="${cls}"${cfn}>
          <span class="cl-cal-dn">${dn}</span>
          ${pct >= 0 ? `<div class="cl-cal-dot" style="${dotC ? 'background:' + dotC : ''}"></div><span class="cl-cal-pct">${pct}%</span>` : ''}
        </div>`;
      });
      h += `</div>`;
    });

    h += `</div>`; // end cl-month-cal

    // Current week quick-access
    const cwk = weeks.find(w => w.weekKey === currKey);
    if (cwk) {
      h += `<div style="margin-top:20px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:10px">
          <i class="fas fa-bolt" style="color:var(--orange);margin-right:4px"></i>Semaine en cours — Accès rapide
        </div>
        <div class="cl-week-quick">`;
      cwk.days.filter(d => d.inMonth).forEach(({ dayId, date }) => {
        const dObj = DAYS.find(d => d.id === dayId);
        let dt = 0, dd = 0;
        getDaySlots(dayId).forEach(sl => {
          (state.tasks[`${dayId}_${sl}`] || []).forEach(t => {
            dt++;
            if (state.checks[MX.checkKey(dayId, sl, t.id, MX.checkOwnerId(dayId, sl, t))]) dd++;
          });
        });
        const pct = dt ? Math.round(dd / dt * 100) : -1;
        const pctC = pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
        const isT = date.toDateString() === today.toDateString();
        h += `<button class="cl-quick-btn${isT ? ' cl-quick-btn--today' : ''}" onclick="MX.showPage('${esc(dayId)}')">
          <i class="fas fa-calendar-day" style="opacity:.6;font-size:11px"></i>
          ${esc((dObj || {}).l || dayId)}
          ${pct >= 0 ? `<span style="margin-left:auto;font-size:11px;font-weight:700;color:${pctC}">${pct}%</span>` : ''}
        </button>`;
      });
      h += `</div></div>`;
    }

    // Ranking per user
    if (ranking.length) {
      h += `<div style="margin-top:24px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:12px">
          <i class="fas fa-trophy" style="color:var(--orange);margin-right:6px"></i>Classement ${MNAMES[month]}
        </div>
        <div class="cl-ranking">`;
      ranking.forEach(({ name, total, done, pct }, i) => {
        const nc    = MX.userColors ? MX.userColors(name) : {bg:'var(--bg4)',fg:'var(--text1)'};
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
        const pctC  = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
        h += `<div class="cl-rank-row">
          <span class="cl-rank-pos">${medal}</span>
          <span class="cl-rank-av" style="background:${nc.bg};color:${nc.fg}">${esc(name.substring(0,2).toUpperCase())}</span>
          <div class="cl-rank-info">
            <div class="cl-rank-name">${esc(name)}</div>
            <div class="cl-rank-bar"><div class="cl-rank-bar-fill" style="width:${pct}%;background:${pctC}"></div></div>
          </div>
          <div style="text-align:right;flex-shrink:0;min-width:52px">
            <div style="font-size:14px;font-weight:700;color:${pctC}">${pct}%</div>
            <div style="font-size:10px;color:var(--text3)">${done}/${total}</div>
          </div>
        </div>`;
      });
      h += `</div></div>`;
    }

    // Archive button (admin only)
    if (MX.Auth.isAdmin()) {
      h += `<div class="cl-archive-hint">
        <i class="fas fa-cloud-arrow-up" style="color:var(--text3);flex-shrink:0"></i>
        <span style="flex:1;font-size:12px;color:var(--text2)">Archiver la semaine en cours pour la conserver dans l'historique mensuel.</span>
        <button onclick="MX.Pages.Checklist._archiveCurrentWeek()"
          style="padding:7px 12px;border:1.5px solid var(--cyan-border);border-radius:8px;background:var(--cyan-dim);color:var(--cyan);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--ffs);white-space:nowrap;display:flex;align-items:center;gap:5px;flex-shrink:0">
          <i class="fas fa-archive"></i> Archiver
        </button>
      </div>`;
    }

    h += `</div>`;
    mc.innerHTML = h;
  }

  // ── SLOT ICON HELPER ──
  function _slotIcon(sl) {
    return sl === 'matin' ? 'fa-sun' : sl === 'soir' ? 'fa-moon' : 'fa-cloud-sun';
  }

  // ── PLANNING SUGGESTION HELPERS ──
  const _DAY_OFFSETS = { lundi:0, mardi:1, mercredi:2, jeudi:3, vendredi:4, samedi:5, dimanche:6 };
  // Maps planning shift codes → checklist slots (codes without start time = day-off, never suggested)
  const _SHIFT_SLOT  = { '1':'matin', '2':'journee', '3':'journee', '4':'soir' };
  const _OFF_CODES   = new Set(['RH','CP','RTT','JFL','EXT']);

  function _weekKeyToMonday(weekKey) {
    const parts = weekKey.split('_W');
    const year  = parseInt(parts[0], 10);
    const wn    = parseInt(parts[1], 10);
    const jan4  = new Date(year, 0, 4);
    const dow   = jan4.getDay() || 7;
    const mon   = new Date(jan4);
    mon.setDate(jan4.getDate() - dow + 1 + (wn - 1) * 7);
    return mon;
  }

  function _weekDayToDate(weekKey, dayId) {
    const mon = _weekKeyToMonday(weekKey);
    const d   = new Date(mon);
    d.setDate(mon.getDate() + (_DAY_OFFSETS[dayId] || 0));
    return d.toISOString().slice(0, 10);
  }

  // Returns shift object for a shiftCode from planningShifts (or default shifts)
  function _getPlanShift(shiftCode) {
    const shifts = (MX.state && MX.state.planningShifts) || [];
    const shift  = shifts.find(s => s.code === shiftCode);
    if (shift) return shift;
    // Fallback: map by start time from the SHIFT_SLOT default
    return null;
  }

  // Returns array of user names suggested for a slot based on planning entries for that specific day
  function _getPlanSuggestions(weekKey, dayId, slot) {
    const dateStr = _weekDayToDate(weekKey, dayId);
    const entries = (MX.state && MX.state.planningEntries) || {};

    const suggested = [];
    Object.values(entries).forEach(e => {
      if (e.date !== dateStr) return;
      if (_OFF_CODES.has(e.shiftCode)) return;
      // Use SHIFT_SLOT map first, then fall back to shift start-time heuristic
      let matchedSlot = _SHIFT_SLOT[e.shiftCode];
      if (!matchedSlot) {
        const sh = _getPlanShift(e.shiftCode);
        if (sh && sh.start) {
          const h = parseInt(sh.start.split(':')[0], 10);
          if (h <= 8)  matchedSlot = 'matin';
          else if (h <= 11) matchedSlot = 'journee';
          else matchedSlot = 'soir';
        }
      }
      if (matchedSlot === slot && e.userName) suggested.push(e.userName);
    });

    return suggested;
  }

  // Ensure planning data is loaded for the months covered by a weekKey
  async function _ensurePlanningForWeek(weekKey) {
    const mon    = _weekKeyToMonday(weekKey);
    const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);
    const months = [
      { y: mon.getFullYear(), m: mon.getMonth() },
    ];
    if (sun.getMonth() !== mon.getMonth()) months.push({ y: sun.getFullYear(), m: sun.getMonth() });

    const existing = (MX.state && MX.state.planningEntries) || {};
    for (const { y, m } of months) {
      const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
      const hasData = Object.values(existing).some(e => e.ym === ym);
      if (!hasData) {
        try {
          const map = await MX.DB.loadPlanningMonth(y, m);
          MX.state.planningEntries = Object.assign({}, MX.state.planningEntries || {}, map);
        } catch(e) { /* planning data unavailable — suggestions won't show */ }
      }
    }
  }

  // ── HISTORICAL DAY VIEW (Responsable / Admin only) ──
  async function _showHistDay(weekKey, dayId) {
    if (!MX.Auth.canSeeAll()) return;
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { DAYS, esc } = MX;
    const day = DAYS.find(d => d.id === dayId);
    const wLabel = (_mvD[weekKey] && _mvD[weekKey].weekLabel) || weekKey.replace('_W', ' S');

    mc.innerHTML = `<div class="ph">
      <div class="ph-eye">${esc(wLabel)}</div>
      <div class="ph-row"><div><div class="ph-title">${esc((day || {}).l || dayId)}</div>
      <div class="ph-sub">Chargement de l'historique…</div></div></div></div>
      <div class="page-body" style="max-width:760px;text-align:center;padding:40px 0">
        <i class="fas fa-spinner fa-spin" style="font-size:20px;color:var(--text3)"></i>
      </div>`;

    if (!_mvD[weekKey]) {
      try {
        const data = await MX.DB.getWeeklyChecks(weekKey);
        if (data) _mvD[weekKey] = data;
      } catch(e) {
        const mc2 = document.getElementById('main-content');
        if (mc2) mc2.innerHTML += `<div style="color:var(--red);padding:20px;text-align:center">Erreur de chargement</div>`;
        return;
      }
    }

    _renderHistDay(weekKey, dayId);
  }

  function _renderHistDay(weekKey, dayId) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { DAYS, getDaySlots, esc } = MX;
    const day   = DAYS.find(d => d.id === dayId);
    const data  = _mvD[weekKey] || null;
    const wLabel = (data && data.weekLabel) ? data.weekLabel : weekKey.replace('_W', ' Sem.');
    const SLOT_LABELS = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };

    const chk  = (data && data.checks)      || {};
    const tsk  = (data && data.tasks)       || {};
    const asn  = (data && data.assignments) || {};
    const slots = getDaySlots(dayId);

    let total = 0, done = 0;
    slots.forEach(sl => {
      (tsk[`${dayId}_${sl}`] || []).forEach(t => {
        total++;
        if (chk[`${dayId}_${sl}_${t.id}`]) done++;
      });
    });
    const pct  = total ? Math.round(done / total * 100) : 0;
    const pctC = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)';

    const backFn = `MX.Pages.Checklist._showWeekDayGrid('${weekKey}')`;

    let h = `<div class="ph">
      <div class="ph-eye">${esc(wLabel)}</div>
      <div class="ph-row">
        <div>
          <div class="ph-title">${esc((day || {}).l || dayId)}</div>
          <div class="ph-sub">${done} / ${total} tâches complétées — historique</div>
        </div>
        <div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:${pctC}">${pct}%</div>
      </div>
      <div style="margin-top:10px"><div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div></div>
    </div>
    <div class="page-body" style="max-width:760px">

    <button onclick="${backFn}" style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg3);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);margin-bottom:16px">
      <i class="fas fa-arrow-left"></i> Retour au calendrier
    </button>

    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--text2)">
      <i class="fas fa-clock-rotate-left" style="color:var(--cyan)"></i>
      <span>Données archivées · ${esc(wLabel)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text3)">Cliquez pour corriger</span>
    </div>

    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-n g">${done}</div><div class="stat-l">Faites</div></div>
      <div class="stat-card"><div class="stat-n b">${total}</div><div class="stat-l">Total</div></div>
      <div class="stat-card"><div class="stat-n r">${total - done}</div><div class="stat-l">Restantes</div></div>
    </div>`;

    if (!data) {
      h += `<div style="text-align:center;padding:40px 20px;color:var(--text3)">
        <i class="fas fa-box-archive" style="font-size:32px;opacity:.3;margin-bottom:12px;display:block"></i>
        <div style="font-size:14px;font-weight:600;color:var(--text2)">Aucune donnée archivée</div>
        <div style="font-size:12px;margin-top:6px">Cette semaine n'a pas encore été archivée.</div>
      </div>`;
    } else {
      slots.forEach(sl => {
        const tasks = tsk[`${dayId}_${sl}`] || [];
        if (!tasks.length) return;
        const slAsn  = asn[`${dayId}_${sl}`] || '';
        const slDone = tasks.filter(t => !!(chk[`${dayId}_${sl}_${t.id}`])).length;
        const slPct  = tasks.length ? Math.round(slDone / tasks.length * 100) : 0;
        const slC    = slPct >= 80 ? 'var(--green)' : slPct >= 40 ? 'var(--orange)' : 'var(--red)';

        h += `<div class="slot-card" style="margin-bottom:12px">
          <div class="slot-head">
            <div class="ch-ico"><i class="fas ${_slotIcon(sl)}"></i></div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700">${esc(SLOT_LABELS[sl] || sl)}</div>
              ${slAsn ? `<div class="slot-dl">${esc(slAsn)}</div>` : ''}
            </div>
            <div class="slot-pct" style="background:${slC}22;color:${slC}">${slPct}%</div>
          </div>`;

        tasks.forEach(t => {
          const key       = `${dayId}_${sl}_${t.id}`;
          const isChecked = !!(chk[key]);
          h += `<div class="trow ${isChecked ? 'done' : ''}" id="htr_${esc(key)}"
            onclick="MX.Pages.Checklist._toggleHistCheck('${esc(weekKey)}','${esc(dayId)}','${esc(sl)}','${esc(t.id)}')"
            style="cursor:pointer">
            <div class="tcb ${isChecked ? 'on' : ''}">${isChecked ? '<i class="fas fa-check"></i>' : ''}</div>
            <span class="ttext">${esc(t.text || t.id)}</span>
          </div>`;
        });

        h += `</div>`;
      });
    }

    h += `</div>`;
    mc.innerHTML = h;
  }

  async function _toggleHistCheck(weekKey, dayId, slot, taskId) {
    if (!MX.Auth.canSeeAll()) return MX.toast('Accès réservé aux responsables', true);
    const key = `${dayId}_${slot}_${taskId}`;
    if (!_mvD[weekKey]) _mvD[weekKey] = { checks: {}, tasks: {}, assignments: {} };
    const prevChk = _mvD[weekKey].checks || {};
    const newVal  = !prevChk[key];
    _mvD[weekKey].checks = { ...prevChk, [key]: newVal };

    // Optimistic UI
    const row = document.getElementById('htr_' + key);
    if (row) {
      row.classList.toggle('done', newVal);
      const cb = row.querySelector('.tcb');
      if (cb) { cb.classList.toggle('on', newVal); cb.innerHTML = newVal ? '<i class="fas fa-check"></i>' : ''; }
    }

    MX.syncStart();
    try {
      await MX.DB.saveWeeklyChecks(weekKey, _mvD[weekKey]);
      MX.syncEnd();
      const actor = (MX.state.currentUser && MX.state.currentUser.name) || (MX.state.adminUser && MX.state.adminUser.email) || 'responsable';
      MX.DB.addLog({ workerName: actor, action: newVal ? 'check' : 'uncheck', taskText: `[Historique ${weekKey}] ${taskId}`, dayId, slot }).catch(() => {});
    } catch(e) {
      _mvD[weekKey].checks = { ...prevChk, [key]: !newVal };
      MX.syncFail();
      MX.toast('Erreur de synchronisation', true);
      _renderHistDay(weekKey, dayId);
    }
  }

  // ── WEEK SYSTEM: SEED / ROTATE / ENSURE ──

  async function _seedFutureWeek(weekKey) {
    const { state, DAYS, getDaySlots } = MX;
    const tasksSnap = {};
    DAYS.forEach(day => {
      (getDaySlots(day.id) || []).forEach(sl => {
        const k = `${day.id}_${sl}`;
        tasksSnap[k] = (state.tasks[k] || []).map(t => ({ id: t.id, text: t.text, order: t.order }));
      });
    });
    const doc = {
      weekKey, weekLabel: _weekLabel(weekKey), status: 'future',
      tasks: tasksSnap, checks: {}, assignments: {},
    };
    await MX.DB.saveWeeklyChecks(weekKey, doc);
    _mvD[weekKey] = doc;
  }

  async function _runWeekRotation(oldKey, currKey) {
    const { state, DAYS, getDaySlots } = MX;

    // 1. Archive old current week if not already saved
    const existingArchive = await MX.DB.getWeeklyChecks(oldKey);
    if (!existingArchive || existingArchive.status === 'future') {
      const tasksSnap = {}, chksSnap = {};
      DAYS.forEach(day => {
        (getDaySlots(day.id) || []).forEach(sl => {
          const k = `${day.id}_${sl}`;
          tasksSnap[k] = (state.tasks[k] || []);
          (state.tasks[k] || []).forEach(t => {
            const ck = `${k}_${t.id}`;
            // Archive keeps the coarse "was it done" boolean (not per-technician) —
            // read from the live per-owner key, write under the archive's own short key.
            if (state.checks[MX.checkKey(day.id, sl, t.id, MX.checkOwnerId(day.id, sl, t))]) chksSnap[ck] = true;
          });
        });
      });
      await MX.DB.saveWeeklyChecks(oldKey, {
        weekKey: oldKey, weekLabel: _weekLabel(oldKey), status: 'archive',
        checks: chksSnap, tasks: tasksSnap, assignments: state.assignments || {},
      });
      _mvD[oldKey] = { checks: chksSnap, tasks: tasksSnap, assignments: state.assignments || {}, weekLabel: _weekLabel(oldKey) };
    }

    // 2. Promote current week (use W+1 future doc tasks if available)
    const futureDoc = _mvD[currKey] || await MX.DB.getWeeklyChecks(currKey);
    if (futureDoc && futureDoc.tasks && Object.keys(futureDoc.tasks).length > 0) {
      await MX.DB.promoteWeeklyToActive(futureDoc.tasks);
      await MX.DB.deleteWeeklyChecks(currKey);
      delete _mvD[currKey];
    } else {
      // No future prepared — reset checks/assignments only
      const batch = firebase.firestore().batch();
      batch.set(firebase.firestore().collection('config').doc('checks'), {});
      batch.set(firebase.firestore().collection('config').doc('assignments'), {});
      await batch.commit();
    }

    // 3. Update week label in config
    try {
      const wNum = parseInt(currKey.split('_W')[1], 10);
      await firebase.firestore().collection('config').doc('week').set({ label: _weekLabel(currKey), num: wNum });
    } catch(e) { console.warn('[Checklist] week label update:', e); }
  }

  async function _ensureWeekSystem() {
    const currKey = _weekKey(new Date());
    if (_wsCurrentKey === currKey) return;

    // Detect and run week rotation
    const storedKey = localStorage.getItem('mx_cl_wk');
    if (storedKey && storedKey !== currKey) {
      try { await _runWeekRotation(storedKey, currKey); } catch(e) { console.error('[Checklist] rotation:', e); }
    }

    // Seed missing future weeks W+1, W+2, W+3
    const now = new Date();
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i * 7);
      const wk = _weekKey(d);
      if (!_mvD[wk]) {
        try {
          const existing = await MX.DB.getWeeklyChecks(wk);
          if (existing) { _mvD[wk] = existing; }
          else { await _seedFutureWeek(wk); }
        } catch(e) { console.warn('[Checklist] seed W+' + i + ':', e); }
      }
    }

    // Prune archives beyond 4 (past weeks only)
    try {
      const snap = await firebase.firestore().collection('weekly_checks').get();
      const archives = snap.docs.map(d => d.id).filter(id => id < currKey).sort();
      if (archives.length > 4) {
        const toDel = archives.slice(0, archives.length - 4);
        await Promise.all(toDel.map(wk => MX.DB.deleteWeeklyChecks(wk)));
        toDel.forEach(wk => { delete _mvD[wk]; });
      }
    } catch(e) { console.warn('[Checklist] prune archives:', e); }

    _wsCurrentKey = currKey;
    localStorage.setItem('mx_cl_wk', currKey);
  }

  // ── 8-WEEK SLOTS OVERVIEW (Responsable / Admin) ──

  async function renderWeekSlots() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    _inHistory = false;

    mc.innerHTML = `<div class="ph">
      <div class="ph-eye">Vue d'ensemble</div>
      <div class="ph-row"><div><div class="ph-title">Semaines</div>
      <div class="ph-sub">Chargement…</div></div></div></div>
      <div class="page-body" style="max-width:760px;text-align:center;padding:36px 0">
        <i class="fas fa-spinner fa-spin" style="font-size:22px;color:var(--text3)"></i>
        <div style="margin-top:12px;font-size:13px;color:var(--text3)">Initialisation des semaines…</div>
      </div>`;

    await _ensureWeekSystem();

    // Pre-load planning data so suggestions are ready when a day is opened
    _ensurePlanningForWeek(_weekKey(new Date())).catch(() => {});

    const currKey = _weekKey(new Date());
    const slots = [];
    const now = new Date();
    for (let i = -4; i <= 3; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i * 7);
      const wk = _weekKey(d);
      if (wk !== currKey && !_mvD[wk]) {
        try { const data = await MX.DB.getWeeklyChecks(wk); if (data) _mvD[wk] = data; } catch(e) {}
      }
      slots.push({ wk, offset: i });
    }
    _renderWeekSlotsHtml(slots, currKey);
  }

  function _renderWeekSlotsHtml(slots, currKey) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { state, DAYS, getDaySlots, esc } = MX;

    // ── Global week progress (current week) ──
    let totalW = 0, doneW = 0;
    const currSlot = slots.find(s => s.wk === currKey);
    if (currSlot) {
      DAYS.forEach(day => {
        (getDaySlots(day.id) || []).forEach(sl => {
          const k = `${day.id}_${sl}`;
          (state.tasks[k] || []).forEach(t => {
            totalW++;
            if (state.checks[MX.checkKey(day.id, sl, t.id, MX.checkOwnerId(day.id, sl, t))]) doneW++;
          });
        });
      });
    }
    const wPct  = totalW ? Math.round(doneW / totalW * 100) : 0;
    const wPctC = wPct >= 80 ? 'var(--green)' : wPct >= 40 ? 'var(--orange)' : 'var(--red)';

    // ── Right panel: today stats ──
    const todayId = MX.todayId ? MX.todayId() : '';
    let todayTotal = 0, todayDone = 0;
    (getDaySlots(todayId) || []).forEach(sl => {
      const k = `${todayId}_${sl}`;
      (state.tasks[k] || []).forEach(t => {
        todayTotal++;
        if (state.checks[MX.checkKey(todayId, sl, t.id, MX.checkOwnerId(todayId, sl, t))]) todayDone++;
      });
    });

    // ── Right panel: planning ──
    const claims    = state.dailyClaims || {};
    const SLOT_DEFS = [
      { key: 'matin',   label: 'Matin',      icon: '☀️' },
      { key: 'journee', label: 'Après-midi',  icon: '🌤️' },
      { key: 'soir',    label: 'Soir',        icon: '🌙' }
    ];

    // ── Right panel: missions / interventions / PMP ──
    const allMissions = state.missions || [];
    const ints        = allMissions.filter(m => !(m.isPmp || m.missionType === 'pmp') && !m.done);
    const pmps        = allMissions.filter(m => m.isPmp || m.missionType === 'pmp');
    const pmpsActive  = pmps.filter(m => !m.done);
    const pmpsDone    = pmps.length - pmpsActive.length;
    const urgentInts  = ints.filter(m => m.priority === 'haute' || m.priority === 'critique');

    // ── Archive / future counts for subtitle ──
    const archiveCount = slots.filter(s => s.offset < 0).length;
    const futureCount  = slots.filter(s => s.offset > 0).length;

    // ── Pre-build right panel sections ──
    const planningRowsHtml = SLOT_DEFS.map(sd => {
      const asn     = (claims[sd.key] && claims[sd.key].name)
                    || (state.assignments && state.assignments[`${todayId}_${sd.key}`])
                    || '';
      const slTasks = state.tasks[`${todayId}_${sd.key}`] || [];
      const slDone  = slTasks.filter(t => state.checks[MX.checkKey(todayId, sd.key, t.id, MX.checkOwnerId(todayId, sd.key, t))]).length;
      return `<div class="cl-v2-rp-slot">
          <span class="cl-v2-rp-slot-ico">${sd.icon}</span>
          <div class="cl-v2-rp-slot-info">
            <span class="cl-v2-rp-slot-lbl">${sd.label}</span>
            <span class="cl-v2-rp-slot-user">${asn ? esc(asn) : '<em style="opacity:.55">Non assigné</em>'}</span>
          </div>
          <span class="cl-v2-rp-slot-ct">${slDone}/${slTasks.length}</span>
        </div>`;
    }).join('');

    const intsListHtml = ints.length === 0
      ? '<div class="cl-v2-rp-empty">Aucune intervention active</div>'
      : '<div class="cl-v2-rp-list">'
        + ints.slice(0, 3).map(m =>
            '<div class="cl-v2-rp-item">'
            + '<div class="cl-v2-rp-dot' + (urgentInts.includes(m) ? ' cl-v2-rp-dot--red' : '') + '"></div>'
            + '<span class="cl-v2-rp-item-ttl">' + esc(m.text || '—') + '</span>'
            + '</div>'
          ).join('')
        + (ints.length > 3 ? '<div class="cl-v2-rp-more">+' + (ints.length - 3) + ' de plus</div>' : '')
        + '</div>';

    const pmpsListHtml = pmpsActive.length === 0
      ? '<div class="cl-v2-rp-empty">' + (pmps.length ? 'Tous les PMP terminés ✓' : 'Aucun PMP planifié') + '</div>'
      : '<div class="cl-v2-rp-list">'
        + pmpsActive.slice(0, 3).map(m => {
            const pd = m.pmpData || {};
            return '<div class="cl-v2-rp-item">'
              + '<div class="cl-v2-rp-dot" style="background:#a855f7"></div>'
              + '<span class="cl-v2-rp-item-ttl">' + esc(pd.equipmentName || m.text || '—') + '</span>'
              + '</div>';
          }).join('')
        + (pmpsActive.length > 3 ? '<div class="cl-v2-rp-more">+' + (pmpsActive.length - 3) + ' de plus</div>' : '')
        + '</div>';

    const intsBadgeHtml = urgentInts.length
      ? '<span class="cl-v2-rp-badge cl-v2-rp-badge--red">' + urgentInts.length + ' urgent' + (urgentInts.length > 1 ? 's' : '') + '</span>'
      : '<span class="cl-v2-rp-badge cl-v2-rp-badge--blue">' + ints.length + '</span>';

    const pmpsBadgeHtml = '<span class="cl-v2-rp-badge' + (pmpsActive.length ? ' cl-v2-rp-badge--purple' : '') + '">' + pmpsDone + '/' + pmps.length + '</span>';

    // ── Build HTML ──
    let h = `<div class="ph">
      <div class="ph-eye">Vue d'ensemble</div>
      <div class="ph-row">
        <div>
          <div class="ph-title">Check-lists</div>
          <div class="ph-sub">${archiveCount} archive${archiveCount !== 1 ? 's' : ''} · semaine en cours · ${futureCount} à venir</div>
        </div>
        <div class="cl-v2-pct" style="color:${wPctC}">${wPct}%</div>
      </div>
      <div class="cl-v2-ph-prog-wrap">
        <div class="cl-v2-ph-prog-track"><div class="cl-v2-ph-prog-fill" style="width:${wPct}%"></div></div>
      </div>
    </div>
    <div class="cl-v2-layout">
      <div class="cl-v2-list">
        <div class="cl-v2-cards">`;

    slots.reverse().forEach(({ wk, offset }) => {
      const isCurr   = wk === currKey;
      const isFuture = offset > 0;
      const data = isCurr ? null : (_mvD[wk] || null);
      const chk  = isCurr ? state.checks : (data ? (data.checks || {}) : {});
      const tsk  = isCurr ? state.tasks  : (data ? (data.tasks  || {}) : {});

      let total = 0, done = 0;
      DAYS.forEach(day => {
        (getDaySlots(day.id) || []).forEach(sl => {
          const k = `${day.id}_${sl}`;
          (tsk[k] || []).forEach(t => {
            total++;
            // Live week reads the new per-owner key; archived weeks keep the short key.
            if (isCurr
              ? state.checks[MX.checkKey(day.id, sl, t.id, MX.checkOwnerId(day.id, sl, t))]
              : chk[`${k}_${t.id}`]) done++;
          });
        });
      });
      const pct    = total ? Math.round(done / total * 100) : (isFuture ? -1 : 0);
      const pctC   = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)';
      const wLabel = (data && data.weekLabel) || _weekLabel(wk);

      let statusLabel, statusCls;
      if (isCurr)        { statusLabel = 'En cours'; statusCls = 'cl-v2-badge--curr'; }
      else if (isFuture) { statusLabel = 'À venir';  statusCls = 'cl-v2-badge--future'; }
      else               { statusLabel = 'Archive';  statusCls = 'cl-v2-badge--arch'; }

      // Team avatars — current week from dailyClaims + assignments
      let avatarsHtml = '';
      if (isCurr) {
        const weekUsers = {};
        DAYS.forEach(day => {
          (getDaySlots(day.id) || []).forEach(sl => {
            const dc  = state.dailyClaims[sl];
            const asn = (dc && dc.name) || (state.assignments && state.assignments[`${day.id}_${sl}`]) || '';
            if (asn) weekUsers[asn] = true;
          });
        });
        const userList = Object.keys(weekUsers);
        const showList = userList.slice(0, 4);
        const overflow = userList.length - showList.length;
        if (showList.length) {
          avatarsHtml = '<div class="cl-v2-avatars">';
          showList.forEach(name => {
            const nc = MX.userColors ? MX.userColors(name) : { bg: '#4338CA', fg: '#fff' };
            avatarsHtml += `<span class="cl-v2-av" style="background:${nc.bg};color:${nc.fg}" title="${esc(name)}">${esc(name.substring(0, 2).toUpperCase())}</span>`;
          });
          if (overflow > 0) avatarsHtml += `<span class="cl-v2-av cl-v2-av--more">+${overflow}</span>`;
          avatarsHtml += '</div>';
        }
      }

      // Count chips — current week only
      let countsHtml = '';
      if (isCurr && (ints.length || pmpsActive.length)) {
        countsHtml = '<div class="cl-v2-counts">';
        if (ints.length)       countsHtml += '<span class="cl-v2-cnt cl-v2-cnt--int"><i class="fas fa-wrench"></i>' + ints.length + ' interv.</span>';
        if (pmpsActive.length) countsHtml += '<span class="cl-v2-cnt cl-v2-cnt--pmp"><i class="fas fa-screwdriver-wrench"></i>' + pmpsActive.length + ' PMP</span>';
        countsHtml += '</div>';
      }

      const subText = isFuture
        ? (total + ' tâche' + (total !== 1 ? 's' : '') + ' programmée' + (total !== 1 ? 's' : ''))
        : pct >= 0
          ? ('<span class="cl-v2-done-n">' + done + '</span><span class="cl-v2-sep">/</span>' + total + ' · <span style="color:' + pctC + ';font-weight:700">' + pct + '%</span>')
          : 'Aucune donnée';

      const progBar = (!isFuture && pct >= 0)
        ? '<div class="cl-v2-card-prog-track"><div class="cl-v2-card-prog-fill" style="width:' + pct + '%"></div></div>'
        : '';

      h += `<div class="cl-v2-card${isCurr ? ' cl-v2-card--curr' : isFuture ? ' cl-v2-card--future' : ' cl-v2-card--arch'}"
          onclick="MX.Pages.Checklist._showWeekDayGrid('${esc(wk)}')">
        <div class="cl-v2-card-body">
          <div class="cl-v2-card-left">
            <div class="cl-v2-card-label">${esc(wLabel)}</div>
            <div class="cl-v2-card-sub">${subText}</div>
            ${countsHtml}
          </div>
          <div class="cl-v2-card-right">
            ${avatarsHtml}
            <span class="cl-v2-badge ${statusCls}">${statusLabel}</span>
            <i class="fas fa-chevron-right cl-v2-chev"></i>
          </div>
        </div>
        ${progBar}
      </div>`;
    });

    h += '</div>';

    if (MX.Auth.isAdmin()) {
      h += `<div class="cl-archive-hint" style="margin-top:16px">
        <i class="fas fa-cloud-arrow-up" style="color:var(--text3);flex-shrink:0"></i>
        <span style="flex:1;font-size:12px;color:var(--text2)">Archiver manuellement la semaine en cours.</span>
        <button onclick="MX.Pages.Checklist._archiveCurrentWeek()"
          style="padding:7px 12px;border:1.5px solid var(--cyan-border);border-radius:8px;background:var(--cyan-dim);color:var(--cyan);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--ffs);white-space:nowrap;display:flex;align-items:center;gap:5px;flex-shrink:0">
          <i class="fas fa-archive"></i> Archiver
        </button>
      </div>`;
    }

    // ── Right panel ──
    h += `</div>
      <aside class="cl-v2-rp">
        <div class="cl-v2-rp-section">
          <div class="cl-v2-rp-hd"><i class="fas fa-calendar-day cl-v2-rp-ico"></i><span>Journée du jour</span></div>
          <div class="cl-v2-rp-stats">
            <div class="cl-v2-rps"><strong style="color:var(--green)">${todayDone}</strong><span>Terminées</span></div>
            <div class="cl-v2-rps"><strong style="color:var(--red)">${todayTotal - todayDone}</strong><span>Restantes</span></div>
            <div class="cl-v2-rps"><strong>${todayTotal}</strong><span>Total</span></div>
          </div>
        </div>
        <div class="cl-v2-rp-section">
          <div class="cl-v2-rp-hd"><i class="fas fa-clock cl-v2-rp-ico"></i><span>Planning</span></div>
          <div class="cl-v2-rp-slots">${planningRowsHtml}</div>
        </div>
        <div class="cl-v2-rp-section">
          <div class="cl-v2-rp-hd">
            <i class="fas fa-wrench cl-v2-rp-ico" style="color:#3b82f6"></i><span>Interventions</span>${intsBadgeHtml}
          </div>
          ${intsListHtml}
        </div>
        <div class="cl-v2-rp-section">
          <div class="cl-v2-rp-hd">
            <i class="fas fa-screwdriver-wrench cl-v2-rp-ico" style="color:#a855f7"></i><span>Maintenance PMP</span>${pmpsBadgeHtml}
          </div>
          ${pmpsListHtml}
        </div>
      </aside>
    </div>`;

    mc.innerHTML = h;
  }

  // ── WEEK DAY GRID (any week) ──

  async function _showWeekDayGrid(weekKey) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { esc } = MX;
    const wLabel = (_mvD[weekKey] && _mvD[weekKey].weekLabel) || _weekLabel(weekKey);
    mc.innerHTML = `<div class="ph">
      <div class="ph-eye">${esc(wLabel)}</div>
      <div class="ph-row"><div><div class="ph-title">Chargement…</div></div></div></div>
      <div class="page-body" style="text-align:center;padding:36px 0">
        <i class="fas fa-spinner fa-spin" style="font-size:20px;color:var(--text3)"></i>
      </div>`;

    const currKey = _weekKey(new Date());
    if (weekKey !== currKey && !_mvD[weekKey]) {
      try { const data = await MX.DB.getWeeklyChecks(weekKey); if (data) _mvD[weekKey] = data; } catch(e) {}
    }
    _renderWeekDayGrid(weekKey);
  }

  function _renderWeekDayGrid(weekKey) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { state, DAYS, getDaySlots, esc } = MX;

    const currKey  = _weekKey(new Date());
    const isCurr   = weekKey === currKey;
    const isFuture = weekKey > currKey;
    const data  = isCurr ? null : (_mvD[weekKey] || null);
    const chk   = isCurr ? state.checks : (data ? (data.checks || {}) : {});
    const tsk   = isCurr ? state.tasks  : (data ? (data.tasks  || {}) : {});
    const wLabel = (data && data.weekLabel) || _weekLabel(weekKey);
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const todayId = MX.todayId ? MX.todayId() : '';

    let totalW = 0, doneW = 0;
    const dayStats = DAYS.map(day => {
      let dt = 0, dd = 0;
      (getDaySlots(day.id) || []).forEach(sl => {
        const k = `${day.id}_${sl}`;
        (tsk[k] || []).forEach(t => {
          totalW++; dt++;
          // Live week reads the new per-owner key; archived weeks keep the short key.
          const isDone = isCurr
            ? state.checks[MX.checkKey(day.id, sl, t.id, MX.checkOwnerId(day.id, sl, t))]
            : chk[`${k}_${t.id}`];
          if (isDone) { doneW++; dd++; }
        });
      });
      return { day, dt, dd, pct: dt ? Math.round(dd / dt * 100) : (isFuture ? -2 : -1) };
    });

    const pctW = totalW ? Math.round(doneW / totalW * 100) : 0;
    const pctC = pctW >= 80 ? 'var(--green)' : pctW >= 40 ? 'var(--orange)' : 'var(--red)';

    let h = `<div class="ph">
      <div class="ph-eye">${esc(wLabel)}</div>
      <div class="ph-row">
        <div>
          <div class="ph-title">${isCurr ? 'Semaine en cours' : isFuture ? 'Semaine à venir' : 'Archive'}</div>
          <div class="ph-sub">${isFuture ? totalW + ' tâche' + (totalW!==1?'s':'') + ' programmée' + (totalW!==1?'s':'') : doneW + ' / ' + totalW + ' complétées'}</div>
        </div>
        ${!isFuture ? `<div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:${pctC}">${pctW}%</div>` : ''}
      </div>
      ${!isFuture ? `<div style="margin-top:10px"><div class="prog-track"><div class="prog-fill" style="width:${pctW}%"></div></div></div>` : ''}
    </div>
    <div class="page-body" style="max-width:760px">

    <button onclick="MX.Pages.Checklist.renderWeekSlots()"
      style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg3);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);margin-bottom:16px">
      <i class="fas fa-arrow-left"></i> Toutes les semaines
    </button>

    ${isFuture ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--text2)">
      <i class="fas fa-wand-sparkles" style="color:#A78BFA"></i>
      <span>Semaine à venir — cliquez sur un jour pour configurer les tâches</span>
    </div>` : ''}

    ${MX.Auth.canSeeAll() && (isCurr || isFuture) ? `
    <button onclick="MX.Pages.Checklist._addFutureTask('${esc(weekKey)}',null,null)"
      style="width:100%;padding:10px 14px;margin-bottom:16px;border:1.5px solid var(--cyan-border);border-radius:10px;background:var(--cyan-dim);color:var(--cyan);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;justify-content:center;gap:8px">
      <i class="fas fa-plus"></i> Ajouter une tâche
    </button>` : ''}

    <div class="cl-week-grid">`;

    dayStats.forEach(({ day, dt, dd, pct }) => {
      const isT  = isCurr && day.id === todayId;
      const pC   = pct >= 100 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
      let cls    = 'cl-week-day';
      if (isT)          cls += ' cl-day--today';
      else if (pct === -2) cls += ' cl-day--future';
      else if (pct < 0) cls += ' cl-day--empty';
      else if (pct >= 100) cls += ' cl-day--done';
      else if (pct > 0) cls += ' cl-day--prog';
      else              cls += ' cl-day--todo';

      const fn = isCurr
        ? `MX.showPage('${esc(day.id)}')`
        : isFuture
          ? `MX.Pages.Checklist._showFutureDay('${esc(weekKey)}','${esc(day.id)}')`
          : `MX.Pages.Checklist._showHistDay('${esc(weekKey)}','${esc(day.id)}')`;

      h += `<div class="${cls}" onclick="${fn}">
        <div class="cl-day-name">${esc(day.l)}</div>
        ${isT ? '<div class="cl-day-today-b">Auj.</div>' : ''}
        ${pct >= 0
          ? `<div class="cl-day-pct" style="color:${pC}">${pct}%</div>
             <div class="cl-day-counts">${dd}/${dt}</div>
             <div class="cl-day-bar-t"><div class="cl-day-bar-f" style="width:${pct}%;background:${pC}"></div></div>`
          : `<div class="cl-day-noasn">${dt > 0 ? dt + ' tâche' + (dt > 1 ? 's' : '') : '—'}</div>`}
      </div>`;
    });

    h += `</div></div>`;
    mc.innerHTML = h;
  }

  // ── FUTURE WEEK DAY VIEW ──

  async function _showFutureDay(weekKey, dayId) {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    const { DAYS, getDaySlots, esc } = MX;
    const data   = _mvD[weekKey] || null;
    const tsk    = data ? (data.tasks || {}) : {};
    const day    = DAYS.find(d => d.id === dayId);
    const wLabel = (data && data.weekLabel) || _weekLabel(weekKey);
    const SLOT_LABELS = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };
    const slots  = getDaySlots(dayId);

    // Load planning data for this week's months (non-blocking if already loaded)
    await _ensurePlanningForWeek(weekKey);

    const users    = (MX.state.users || []).filter(u => u.name && !u.hidden);
    const PRIO_COLOR = { critique: 'var(--red)', haute: 'var(--orange)', faible: 'var(--text3)' };
    const PRIO_LABEL = { critique: '🔴 Critique', haute: '🟠 Haute', faible: '⚪ Faible' };

    let h = `<div class="ph">
      <div class="ph-eye">${esc(wLabel)}</div>
      <div class="ph-row"><div>
        <div class="ph-title">${esc((day || {}).l || dayId)}</div>
        <div class="ph-sub">Configuration · Semaine à venir</div>
      </div></div>
    </div>
    <div class="page-body" style="max-width:760px">

    <button onclick="MX.Pages.Checklist._showWeekDayGrid('${esc(weekKey)}')"
      style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg3);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);margin-bottom:16px">
      <i class="fas fa-arrow-left"></i> Retour à la semaine
    </button>

    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--text2)">
      <i class="fas fa-circle-info" style="color:#A78BFA"></i>
      <span>Configurez les tâches et assignez les techniciens — actif à partir de ${esc(wLabel)}.</span>
    </div>`;

    slots.forEach(sl => {
      const tasks       = tsk[`${dayId}_${sl}`] || [];
      const suggestions = _getPlanSuggestions(weekKey, dayId, sl);

      h += `<div class="slot-card" style="margin-bottom:12px">
        <div class="slot-head">
          <div class="ch-ico"><i class="fas ${_slotIcon(sl)}"></i></div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700">${esc(SLOT_LABELS[sl] || sl)}</div>
            <div class="slot-dl">${tasks.length} tâche${tasks.length!==1?'s':''}</div>
          </div>`;

      // Planning suggestion badge in slot header
      if (suggestions.length) {
        h += `<div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--cyan);background:rgba(0,245,212,.07);border:1px solid rgba(0,245,212,.2);border-radius:6px;padding:3px 8px;margin-right:8px;flex-shrink:0">
          <i class="fas fa-calendar-check" style="font-size:10px"></i>
          ${suggestions.map(n => esc(n)).join(', ')}
        </div>`;
      }

      h += `<button onclick="MX.Pages.Checklist._addFutureTask('${esc(weekKey)}','${esc(dayId)}','${esc(sl)}')"
            style="padding:6px 10px;border:1px solid var(--cyan-border);border-radius:7px;background:var(--cyan-dim);color:var(--cyan);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;gap:5px;flex-shrink:0">
            <i class="fas fa-plus"></i> Ajouter
          </button>
        </div>`;

      if (!tasks.length) {
        h += `<div style="padding:14px;text-align:center;color:var(--text3);font-size:12px">
          <i class="fas fa-circle-plus" style="opacity:.3;font-size:20px;display:block;margin-bottom:4px"></i>
          Aucune tâche — cliquez sur Ajouter
        </div>`;
      } else {
        tasks.forEach(t => {
          const isPlanSugg = t.assignedTo && suggestions.includes(t.assignedTo);

          // Build user <select> options — pre-select current assignedTo
          const taskUserOpts = `<option value="">— Non assigné —</option>` +
            users.map(u => `<option value="${esc(u.name)}"${u.name === t.assignedTo ? ' selected' : ''}>${esc(u.name)}</option>`).join('');

          h += `<div class="trow" style="flex-direction:column;align-items:stretch;gap:6px;cursor:default;padding:10px 12px">
            <div style="display:flex;align-items:center;gap:8px">
              <div class="tcb" style="opacity:.25;flex-shrink:0"><i class="fas fa-circle"></i></div>
              <span class="ttext" style="flex:1">${esc(t.text || t.id)}</span>
              <button onclick="MX.Pages.Checklist._deleteFutureTask('${esc(weekKey)}','${esc(dayId)}','${esc(sl)}','${esc(t.id)}')"
                style="padding:4px 8px;border:none;background:var(--red-dim);color:var(--red);border-radius:6px;cursor:pointer;font-size:11px;flex-shrink:0">
                <i class="fas fa-trash"></i>
              </button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;padding-left:32px;flex-wrap:wrap">
              <i class="fas fa-user" style="font-size:10px;color:var(--text3);flex-shrink:0;margin-top:1px"></i>
              <select class="fi fi-sm" style="flex:1;min-width:130px;max-width:200px;height:30px;font-size:12px;padding:0 8px"
                onchange="MX.Pages.Checklist._updateFutureTaskAssign('${esc(weekKey)}','${esc(dayId)}','${esc(sl)}','${esc(t.id)}',this.value)">
                ${taskUserOpts}
              </select>
              <span id="ft-pbadge-${esc(t.id)}">${isPlanSugg ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(0,245,212,.1);color:var(--cyan);font-weight:600;border:1px solid rgba(0,245,212,.2)">📅 Planning</span>` : ''}</span>
              ${t.type === 'unique'
                ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(99,102,241,.12);color:#818CF8;font-weight:600">📌 Unique</span>`
                : `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(0,194,209,.08);color:var(--cyan);font-weight:600">🔄 Récurrente</span>`
              }
              ${t.priority && t.priority !== 'normale'
                ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600;color:${PRIO_COLOR[t.priority] || 'var(--text2)'}">${PRIO_LABEL[t.priority] || t.priority}</span>`
                : ''
              }
            </div>
          </div>`;
        });
      }
      h += `</div>`;
    });

    h += `</div>`;
    mc.innerHTML = h;
  }

  function _addFutureTask(weekKey, dayId, slot) {
    if (!MX.Auth.canSeeAll()) return MX.toast('Accès réservé aux responsables', true);
    const { DAYS, esc } = MX;
    const users = (MX.state.users || []).filter(u => u.name && !u.hidden);

    // Planning suggestion for initial day/slot
    const initSugg = _getPlanSuggestions(weekKey, dayId, slot);
    const initAssign = initSugg[0] || '';

    function _buildUserOpts(selVal) {
      return `<option value="">— Non assigné —</option>` +
        users.map(u => `<option value="${esc(u.name)}"${u.name === selVal ? ' selected' : ''}>${esc(u.name)}</option>`).join('');
    }

    const dayOpts = DAYS.map(d =>
      `<option value="${esc(d.id)}"${d.id === dayId ? ' selected' : ''}>${esc(d.l)}</option>`
    ).join('');

    const SLOT_DEFS = [['matin','🌅 Matin'],['journee','☀️ Journée'],['soir','🌙 Soir']];
    const slotOpts = SLOT_DEFS.map(([k,l]) =>
      `<option value="${k}"${k === slot ? ' selected' : ''}>${l}</option>`
    ).join('');

    const currKey = _weekKey(new Date());
    const sub = weekKey === currKey ? 'Semaine en cours' : esc(_weekLabel(weekKey));
    const suggHint = initSugg.length
      ? `<div id="ft-assign-sugg" style="font-size:11px;color:var(--cyan);display:flex;align-items:center;gap:5px;margin-top:4px"><i class="fas fa-calendar-check" style="font-size:10px"></i>Suggestion planning : ${initSugg.map(n => esc(n)).join(', ')}</div>`
      : `<div id="ft-assign-sugg" style="font-size:11px;color:var(--text3);display:none"></div>`;

    MX.showModal({
      title: 'Nouvelle tâche',
      sub,
      body: `<div style="display:flex;flex-direction:column;gap:12px">
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Titre *</label>
          <input id="ft-title" class="fi" placeholder="Nom de la tâche" maxlength="150" style="width:100%">
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Description</label>
          <input id="ft-desc" class="fi" placeholder="Détails optionnels" maxlength="300" style="width:100%">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Jour</label>
            <select id="ft-day" class="fi" onchange="MX.Pages.Checklist._refreshAddTaskSugg('${esc(weekKey)}')">${dayOpts}</select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Période</label>
            <select id="ft-slot" class="fi" onchange="MX.Pages.Checklist._refreshAddTaskSugg('${esc(weekKey)}')">${slotOpts}</select>
          </div>
        </div>
        <div>
          <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Technicien assigné</label>
          <select id="ft-assign" class="fi">${_buildUserOpts(initAssign)}</select>
          ${suggHint}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Type</label>
            <div style="display:flex;flex-direction:column;gap:6px">
              <label id="ft-type-rec-lbl" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--cyan);background:rgba(0,194,209,.08);border-radius:8px;cursor:pointer;font-size:12px;color:var(--cyan);font-weight:500">
                <input type="radio" name="ft-type" value="hebdomadaire" checked style="accent-color:var(--cyan)" onchange="document.getElementById('ft-type-rec-lbl').style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--cyan);background:rgba(0,194,209,.08);border-radius:8px;cursor:pointer;font-size:12px;color:var(--cyan);font-weight:500';document.getElementById('ft-type-uni-lbl').style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--border2);background:var(--bg3);border-radius:8px;cursor:pointer;font-size:12px;color:var(--text1);font-weight:500'">
                🔄 Récurrente
              </label>
              <label id="ft-type-uni-lbl" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--border2);background:var(--bg3);border-radius:8px;cursor:pointer;font-size:12px;color:var(--text1);font-weight:500">
                <input type="radio" name="ft-type" value="unique" style="accent-color:var(--cyan)" onchange="document.getElementById('ft-type-uni-lbl').style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--cyan);background:rgba(0,194,209,.08);border-radius:8px;cursor:pointer;font-size:12px;color:var(--cyan);font-weight:500';document.getElementById('ft-type-rec-lbl').style.cssText='display:flex;align-items:center;gap:8px;padding:8px 10px;border:1.5px solid var(--border2);background:var(--bg3);border-radius:8px;cursor:pointer;font-size:12px;color:var(--text1);font-weight:500'">
                📌 Unique
              </label>
            </div>
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Priorité</label>
            <select id="ft-priority" class="fi">
              <option value="normale">🔵 Normale</option>
              <option value="faible">⚪ Faible</option>
              <option value="haute">🟠 Haute</option>
              <option value="critique">🔴 Critique</option>
            </select>
          </div>
        </div>
      </div>`,
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAddFutureTask(weekKey) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('ft-title')?.focus(), 50);
  }

  function _refreshAddTaskSugg(weekKey) {
    const dayId = document.getElementById('ft-day')?.value;
    const slot  = document.getElementById('ft-slot')?.value;
    if (!dayId || !slot) return;
    const sugg     = _getPlanSuggestions(weekKey, dayId, slot);
    const users    = (MX.state.users || []).filter(u => u.name && !u.hidden);
    const assignEl = document.getElementById('ft-assign');
    const suggEl   = document.getElementById('ft-assign-sugg');
    if (!assignEl) return;
    const current = assignEl.value;
    // Rebuild options; keep current selection unless it's empty and there's a new suggestion
    const newVal = current || (sugg[0] || '');
    assignEl.innerHTML = `<option value="">— Non assigné —</option>` +
      users.map(u => `<option value="${u.name}"${u.name === newVal ? ' selected' : ''}>${u.name}</option>`).join('');
    if (suggEl) {
      if (sugg.length) {
        suggEl.innerHTML = `<i class="fas fa-calendar-check" style="font-size:10px"></i>Suggestion planning : ${sugg.map(n => MX.esc(n)).join(', ')}`;
        suggEl.style.display = '';
      } else {
        suggEl.style.display = 'none';
      }
    }
  }

  async function _doAddFutureTask(weekKey) {
    const text     = (document.getElementById('ft-title')?.value   || '').trim();
    if (!text) { MX.toast('Le titre est obligatoire', true); return; }
    const desc     = (document.getElementById('ft-desc')?.value    || '').trim();
    const assign   = document.getElementById('ft-assign')?.value   || '';
    const dayId    = document.getElementById('ft-day')?.value      || ((MX.DAYS[0] && MX.DAYS[0].id) || 'lundi');
    const slot     = document.getElementById('ft-slot')?.value     || 'matin';
    const priority = document.getElementById('ft-priority')?.value || 'normale';
    const typeEl   = document.querySelector('input[name="ft-type"]:checked');
    const type     = typeEl ? typeEl.value : 'hebdomadaire';
    MX.closeModal();

    const currKey = _weekKey(new Date());
    const isCurr  = weekKey === currKey;
    const key     = `${dayId}_${slot}`;
    const existing = isCurr
      ? (MX.state.tasks[key] || [])
      : ((_mvD[weekKey] && _mvD[weekKey].tasks && _mvD[weekKey].tasks[key]) || []);
    const newItem = { id: MX.uuid(), text, order: existing.length };
    if (desc)               newItem.description = desc;
    if (assign)             newItem.assignedTo  = assign;
    if (type)               newItem.type        = type;
    if (priority)           newItem.priority    = priority;
    const newItems = [...existing, newItem];

    MX.syncStart();
    try {
      if (isCurr) {
        await MX.DB.setTasks(dayId, slot, newItems);
        MX.state.tasks[key] = newItems;
        MX.syncEnd();
        MX.toast('Tâche ajoutée ✓');
        MX.showPage(dayId);
      } else {
        if (!_mvD[weekKey]) _mvD[weekKey] = { tasks: {}, checks: {}, assignments: {} };
        await MX.DB.updateWeeklyTasks(weekKey, dayId, slot, newItems);
        if (!_mvD[weekKey].tasks) _mvD[weekKey].tasks = {};
        _mvD[weekKey].tasks[key] = newItems;
        MX.syncEnd();
        MX.toast('Tâche ajoutée ✓');
        _showFutureDay(weekKey, dayId);
      }
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _deleteFutureTask(weekKey, dayId, slot, taskId) {
    if (!_mvD[weekKey]) return;
    const existing = (_mvD[weekKey].tasks || {})[`${dayId}_${slot}`] || [];
    const newItems = existing.filter(t => t.id !== taskId);
    MX.syncStart();
    try {
      await MX.DB.updateWeeklyTasks(weekKey, dayId, slot, newItems);
      _mvD[weekKey].tasks[`${dayId}_${slot}`] = newItems;
      MX.syncEnd();
      MX.toast('Tâche supprimée');
      _showFutureDay(weekKey, dayId);
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _updateFutureTaskAssign(weekKey, dayId, slot, taskId, value) {
    if (!_mvD[weekKey] || !_mvD[weekKey].tasks) return;
    const key      = `${dayId}_${slot}`;
    const existing = (_mvD[weekKey].tasks[key] || []);
    const newItems = existing.map(t => {
      if (t.id !== taskId) return t;
      const updated = Object.assign({}, t);
      if (value) updated.assignedTo = value;
      else delete updated.assignedTo;
      return updated;
    });
    // Optimistic local update
    _mvD[weekKey].tasks[key] = newItems;
    // Redraw only the badge next to the select (no full re-render to preserve focus)
    const suggestions = _getPlanSuggestions(weekKey, dayId, slot);
    const isPlanSugg  = value && suggestions.includes(value);
    const badgeId     = `ft-pbadge-${taskId}`;
    const badgeEl     = document.getElementById(badgeId);
    if (badgeEl) {
      badgeEl.innerHTML = isPlanSugg
        ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(0,245,212,.1);color:var(--cyan);font-weight:600;border:1px solid rgba(0,245,212,.2)">📅 Planning</span>`
        : '';
    }
    MX.syncStart();
    try {
      await MX.DB.updateWeeklyTasks(weekKey, dayId, slot, newItems);
      MX.syncEnd();
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur lors de l\'assignation', true);
    }
  }

  async function _archiveCurrentWeek() {
    const { state, DAYS, getDaySlots } = MX;
    const key = _weekKey(new Date());
    const tasksSnap = {}, chksSnap = {};
    DAYS.forEach(day => {
      (getDaySlots(day.id) || []).forEach(sl => {
        const k = `${day.id}_${sl}`;
        tasksSnap[k] = state.tasks[k] || [];
        (state.tasks[k] || []).forEach(t => {
          const ck = `${k}_${t.id}`;
          // Archive keeps the coarse "was it done" boolean (not per-technician) —
          // read from the live per-owner key, write under the archive's own short key.
          if (state.checks[MX.checkKey(day.id, sl, t.id, MX.checkOwnerId(day.id, sl, t))]) chksSnap[ck] = true;
        });
      });
    });
    try {
      await MX.DB.saveWeeklyChecks(key, {
        weekKey:     key,
        weekLabel:   state.weekLabel || key,
        checks:      chksSnap,
        tasks:       tasksSnap,
        assignments: state.assignments || {}
      });
      _mvD[key] = { checks: chksSnap, tasks: tasksSnap, assignments: state.assignments || {} };
      MX.toast('Semaine archivée ✓');
      if (_mvY !== null) renderMonthly(_mvY, _mvM !== null ? _mvM : new Date().getMonth());
    } catch(e) {
      MX.toast('Erreur lors de l\'archivage', true);
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Checklist = { render, toggle, assign, assignTask, assignAllSlotTasks, applySlotTech, clearTaskCustom, _togglePick, promptAssignAll, _doAssignAll, claimSlot, unclaimSlot, assignToday, toggleLockSlot, toggleMission, _confirmMissionClose, startTransfer, confirmTransfer, acceptTransfer, rejectTransfer, cancelTransfer, toggleTransferred, openNote, saveNote, renderForRole, renderWeekly, renderMonthly, _showHistDay, _renderHistDay, _toggleHistCheck, _archiveCurrentWeek, renderWeekSlots, _showWeekDayGrid, _showFutureDay, _addFutureTask, _doAddFutureTask, _deleteFutureTask, _updateFutureTaskAssign, _refreshAddTaskSugg, _clWsOpen, _clWsClose, _clWsToggle, _clWsBlockTask, _clWsConfirmBlock };
})();
