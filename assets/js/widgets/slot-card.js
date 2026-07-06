(function () {
  function slotCard({ dayId, slot, tasks, assignment, checks, showAssign, workerFilter, isToday, dailyClaim, todayPlanSuggestions, planSuggestions }) {
    const { SLOTS, esc, chipHtml, alertLevel, state } = MX;
    const s  = SLOTS[slot];
    const cu = state.currentUser;

    // Effective assignment: daily claim for today, weekly assignment for other days
    const effectiveAsn = isToday ? ((dailyClaim && dailyClaim.name) || "") : (assignment || "");

    // Visibility filter: show if slot is assigned to worker OR any task is assigned to worker
    const hasPerTaskForWorker = workerFilter && tasks.some(t => t.assignedTo === workerFilter);
    if (workerFilter && !MX.Auth.canSeeAll() && effectiveAsn !== workerFilter && !hasPerTaskForWorker && !(isToday && !effectiveAsn)) return '';

    // When filtering by worker, only show tasks assigned to them (unless slot-level assignment matches)
    const visibleTasks = (workerFilter && !MX.Auth.canSeeAll() && effectiveAsn !== workerFilter)
      ? tasks.filter(t => t.assignedTo === workerFilter)
      : tasks;

    const canTransfer = !!(cu && !MX.Auth.isAdmin());
    const transfers   = state.transfers || [];

    let done = 0;
    visibleTasks.forEach(t => { if (checks[`${dayId}_${slot}_${t.id}`]) done++; });
    const pct   = visibleTasks.length ? Math.round(done / visibleTasks.length * 100) : 0;
    const level = alertLevel(slot, pct, state.alerts);

    const _slotTimes = { matin: '06h – 14h', journee: '14h – 18h', soir: '18h – 22h' };

    let h = `<div class="slot-card">
      <div class="slot-head ${s.c}">
        <div class="ch-ico ${s.c}">${s.e}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700">${s.l}<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:7px">${_slotTimes[slot] || ''}</span></div>
          <div class="slot-dl">${done}/${visibleTasks.length} tâches</div>
          <span class="slot-chip ${level}">
            <i class="fas fa-${level==='ok'?'check':level==='warn'?'triangle-exclamation':'circle-exclamation'}"></i>
            ${level==='ok'?'En ordre':level==='warn'?'Attention':'Urgent'}
          </span>
        </div>
        <div class="slot-pct ${pct>=80?'g':pct>=40?'o':'r'}">${pct}%</div>
      </div>`;

    if (isToday) {
      h += _dailyClaimRow(slot, dailyClaim, cu, showAssign, todayPlanSuggestions || {}, s, esc, chipHtml, planSuggestions || []);
    } else if (showAssign) {
      // Slot-first assignment header: single tech selector + "Appliquer aux tâches"
      const suggs  = planSuggestions || [];
      const _users = (state.users || []).filter(u => u.name && !u.hidden);
      const _selId = `sc-sel-${dayId}-${slot}`;

      const _planRow = suggs.length
        ? `<div class="sc-plan-sugg"><i class="fas fa-calendar-check" style="color:var(--cyan);font-size:10px"></i>${suggs.map(n => chipHtml(n)).join('')}</div>`
        : `<div class="sc-plan-warn"><i class="fas fa-triangle-exclamation"></i> Aucun technicien planifié sur ce créneau</div>`;

      const _opts = `<option value="">— Non assigné —</option>` +
        _users.map(u => {
          const lbl = esc(u.name) + (suggs.includes(u.name) ? ' 📅' : '');
          return `<option value="${esc(u.name)}"${u.name === assignment ? ' selected' : ''}>${lbl}</option>`;
        }).join('');

      h += `<div class="sc-assign-hdr">
        ${_planRow}
        <div class="sc-assign-row">
          <select id="${_selId}" class="sc-tech-sel"
            onchange="MX.Pages.Checklist.assign('${esc(dayId)}','${esc(slot)}',this.value)">
            ${_opts}
          </select>
          <button class="sc-apply-btn"
            onclick="MX.Pages.Checklist.applySlotTech('${esc(dayId)}','${esc(slot)}',document.getElementById('${_selId}').value)">
            <i class="fas fa-user-check"></i> Appliquer aux tâches
          </button>
        </div>
      </div>`;
    } else if (assignment) {
      h += `<div class="arow"><span class="arow-lbl">Assigné à</span>${chipHtml(assignment)}</div>`;
    }

    visibleTasks.forEach(t => {
      const tr = transfers.find(x =>
        x.taskId === t.id && x.dayId === dayId && x.slot === slot &&
        (x.status === "pending" || x.status === "accepted")
      );
      h += MX.Widgets.taskRow({
        task: t, dayId, slot,
        isChecked:    !!checks[`${dayId}_${slot}_${t.id}`],
        assigneeName: effectiveAsn,
        canTransfer,
        transfer: tr ? { id: tr.id, status: tr.status, toUser: tr.toUser } : null,
        canAssign: showAssign,
        planSuggestions: showAssign ? (planSuggestions || []) : []
      });
    });

    if (!visibleTasks.length) {
      h += `<div style="padding:20px;text-align:center;font-size:13px;color:var(--text3)">Aucune tâche configurée</div>`;
    }

    h += `</div>`;
    return h;
  }

  function _dailyClaimRow(slot, claim, cu, showAssign, suggestions, s, esc, chipHtml, planSuggestions) {
    const name     = (claim && claim.name)     || "";
    const lockedBy = (claim && claim.lockedBy) || "";

    if (showAssign) {
      // Responsable / Admin : planning info + today selector + lock button
      const lockBtn = lockedBy
        ? `<button class="slot-lock-btn on" title="Déverrouiller" onclick="MX.Pages.Checklist.toggleLockSlot('${esc(slot)}')"><i class="fas fa-lock"></i></button>`
        : `<button class="slot-lock-btn" title="Verrouiller" onclick="MX.Pages.Checklist.toggleLockSlot('${esc(slot)}')"><i class="fas fa-lock-open"></i></button>`;

      const _todayId = MX.todayId ? MX.todayId() : '';
      const _aaBtn   = `<button onclick="event.stopPropagation();MX.Pages.Checklist.promptAssignAll('${esc(_todayId)}','${esc(slot)}')" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 9px;border-radius:6px;background:var(--cyan-dim);border:1px solid var(--cyan-border);color:var(--cyan);cursor:pointer;font-family:var(--ffs);white-space:nowrap;flex-shrink:0"><i class="fas fa-user-check" style="font-size:10px"></i>Assigner tout</button>`;

      const _users    = (MX.state.users || []).filter(u => u.name && !u.hidden);
      const _todaySel = `<select class="sc-today-sel" title="Assigner aujourd'hui (verrouille le créneau)" onchange="if(this.value){MX.Pages.Checklist.assignToday('${esc(slot)}',this.value);this.value=''}">`
        + `<option value="">${name ? 'Changer…' : 'Assigner aujourd\'hui…'}</option>`
        + _users.map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('')
        + `</select>`;

      const suggs = planSuggestions || [];
      if (name) {
        const extraPlan = suggs.length && !suggs.includes(name)
          ? `<span style="font-size:10px;color:var(--cyan);background:rgba(0,245,212,.07);border:1px solid rgba(0,245,212,.2);border-radius:4px;padding:2px 5px;flex-shrink:0"><i class="fas fa-calendar-check" style="font-size:9px;margin-right:2px"></i>${suggs.map(n => esc(n)).join(', ')}</span>`
          : '';
        return `<div class="arow">
          <span class="arow-lbl">Créneau pris par</span>
          ${chipHtml(name)}
          ${extraPlan}
          ${_todaySel}
          ${_aaBtn}
          ${lockBtn}
        </div>`;
      } else if (suggs.length) {
        return `<div class="arow">
          <span class="arow-lbl"><i class="fas fa-calendar-check" style="color:var(--cyan);font-size:10px;margin-right:3px"></i>Planning</span>
          ${suggs.map(n => chipHtml(n)).join('')}
          ${_todaySel}
          ${_aaBtn}
          ${lockBtn}
        </div>`;
      } else {
        return `<div class="arow">
          <span class="arow-lbl">Créneau</span>
          <span style="font-size:12px;color:var(--text3)">Disponible</span>
          ${_todaySel}
          ${_aaBtn}
          ${lockBtn}
        </div>`;
      }
    }

    // ── Technicien ──

    if (lockedBy) {
      return `<div class="daily-claim">
        <div class="dc-assigned dc-locked">
          <i class="fas fa-lock" style="font-size:11px;color:var(--orange)"></i>
          <span class="arow-lbl">Assigné</span>
          ${name ? chipHtml(name) : '<span style="color:var(--text3);font-size:13px">—</span>'}
          <span class="dc-lock-badge">Verrouillé</span>
        </div>
      </div>`;
    }

    if (name && cu && name === cu.name) {
      return `<div class="daily-claim">
        <div class="dc-assigned dc-mine">
          <span class="arow-lbl">Créneau pris par vous</span>
          ${chipHtml(name)}
          <button class="dc-unclaim-btn" onclick="MX.Pages.Checklist.unclaimSlot('${esc(slot)}')">
            <i class="fas fa-right-from-bracket"></i> Rendre le créneau
          </button>
        </div>
      </div>`;
    }

    if (name) {
      return `<div class="daily-claim">
        <div class="dc-assigned">
          <span class="arow-lbl">Pris par</span>
          ${chipHtml(name)}
        </div>
      </div>`;
    }

    // Disponible — vérifier suggestion planning
    const myName    = cu ? cu.name : null;
    const suggested = myName && suggestions[myName] === slot;

    if (suggested) {
      return `<div class="daily-claim dc-suggest">
        <div class="dc-suggest-badge">
          <i class="fas fa-${s.icon}"></i> ${esc(s.l)} suggéré pour vous
        </div>
        <button class="dc-claim-btn" onclick="MX.Pages.Checklist.claimSlot('${esc(slot)}')">
          <i class="fas fa-hand-pointer"></i> Prendre le créneau
        </button>
      </div>`;
    }

    return `<div class="daily-claim dc-empty">
      <span class="dc-unassigned">
        <i class="fas fa-circle-dot"></i> Disponible
      </span>
      <button class="dc-claim-btn" onclick="MX.Pages.Checklist.claimSlot('${esc(slot)}')">
        <i class="fas fa-hand-pointer"></i> Prendre le créneau
      </button>
    </div>`;
  }

  function _allNames() {
    const set = new Set();
    ["matin","journee","soir"].forEach(sl => {
      (MX.state.teams[sl] || []).forEach(n => { if (n && n.trim()) set.add(n.trim()); });
    });
    return Array.from(set).sort();
  }

  window.MX = window.MX || {};
  window.MX.Widgets = window.MX.Widgets || {};
  window.MX.Widgets.slotCard = slotCard;
})();
