(function () {
  function slotCard({ dayId, slot, tasks, assignment, checks, showAssign, workerFilter, isToday, dailyClaim, todayPlanSuggestions }) {
    const { SLOTS, esc, chipHtml, alertLevel, state } = MX;
    const s  = SLOTS[slot];
    const cu = state.currentUser;

    // Effective assignment: daily claim for today, weekly assignment for other days
    const effectiveAsn = isToday ? ((dailyClaim && dailyClaim.name) || "") : (assignment || "");

    // Visibility filter: unclaimed today slots always visible (any technicien can claim)
    if (workerFilter && !MX.Auth.canSeeAll() && effectiveAsn !== workerFilter && !(isToday && !effectiveAsn)) return '';

    const canTransfer = !!(cu && !MX.Auth.isAdmin());
    const transfers   = state.transfers || [];

    let done = 0;
    tasks.forEach(t => { if (checks[`${dayId}_${slot}_${t.id}`]) done++; });
    const pct   = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const level = alertLevel(slot, pct, state.alerts);

    let h = `<div class="slot-card">
      <div class="slot-head ${s.c}">
        <div class="ch-ico ${s.c}">${s.e}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700">${s.l}</div>
          <div class="slot-dl">${done}/${tasks.length} tâches</div>
          <span class="slot-chip ${level}">
            <i class="fas fa-${level==='ok'?'check':level==='warn'?'triangle-exclamation':'circle-exclamation'}"></i>
            ${level==='ok'?'En ordre':level==='warn'?'Attention':'Urgent'}
          </span>
        </div>
        <div class="slot-pct ${pct>=80?'g':pct>=40?'o':'r'}">${pct}%</div>
      </div>`;

    if (isToday) {
      h += _dailyClaimRow(slot, dailyClaim, cu, showAssign, todayPlanSuggestions || {}, s, esc, chipHtml);
    } else if (showAssign) {
      const names = _allNames();
      h += `<div class="arow">
        <span class="arow-lbl">Assigné à</span>
        <select class="asel" onchange="MX.Pages.Checklist.assign('${dayId}','${slot}',this.value)">
          <option value="">— Choisir —</option>
          ${names.map(n => `<option value="${esc(n)}" ${n===assignment?'selected':''}>${esc(n)}</option>`).join('')}
        </select>
        ${assignment ? chipHtml(assignment) : ''}
      </div>`;
    } else if (assignment) {
      h += `<div class="arow"><span class="arow-lbl">Assigné à</span>${chipHtml(assignment)}</div>`;
    }

    tasks.forEach(t => {
      const tr = transfers.find(x =>
        x.taskId === t.id && x.dayId === dayId && x.slot === slot &&
        (x.status === "pending" || x.status === "accepted")
      );
      h += MX.Widgets.taskRow({
        task: t, dayId, slot,
        isChecked:    !!checks[`${dayId}_${slot}_${t.id}`],
        assigneeName: effectiveAsn,
        canTransfer,
        transfer: tr ? { id: tr.id, status: tr.status, toUser: tr.toUser } : null
      });
    });

    if (!tasks.length) {
      h += `<div style="padding:20px;text-align:center;font-size:13px;color:var(--text3)">Aucune tâche configurée</div>`;
    }

    h += `</div>`;
    return h;
  }

  function _dailyClaimRow(slot, claim, cu, showAssign, suggestions, s, esc, chipHtml) {
    const name     = (claim && claim.name)     || "";
    const lockedBy = (claim && claim.lockedBy) || "";

    if (showAssign) {
      // Responsable / Admin : dropdown + bouton verrou
      const names    = _allNames();
      const lockBtn  = lockedBy
        ? `<button class="slot-lock-btn on" title="Déverrouiller" onclick="MX.Pages.Checklist.toggleLockSlot('${esc(slot)}')"><i class="fas fa-lock"></i></button>`
        : `<button class="slot-lock-btn" title="Verrouiller" onclick="MX.Pages.Checklist.toggleLockSlot('${esc(slot)}')"><i class="fas fa-lock-open"></i></button>`;
      return `<div class="arow">
        <span class="arow-lbl">Assigné à</span>
        <select class="asel" onchange="MX.Pages.Checklist.assignToday('${esc(slot)}',this.value)">
          <option value="">— Choisir —</option>
          ${names.map(n => `<option value="${esc(n)}" ${n===name?'selected':''}>${esc(n)}</option>`).join('')}
        </select>
        ${name ? chipHtml(name) : ''}
        ${lockBtn}
      </div>`;
    }

    // ── Technicien ──

    if (lockedBy) {
      // Verrouillé par responsable
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
      // Créneau pris par l'utilisateur connecté — peut se retirer
      return `<div class="daily-claim">
        <div class="dc-assigned dc-mine">
          <span class="arow-lbl">Vous êtes assigné</span>
          ${chipHtml(name)}
          <button class="dc-unclaim-btn" onclick="MX.Pages.Checklist.unclaimSlot('${esc(slot)}')">
            <i class="fas fa-right-from-bracket"></i> Se retirer
          </button>
        </div>
      </div>`;
    }

    if (name) {
      // Pris par quelqu'un d'autre — lecture seule
      return `<div class="daily-claim">
        <div class="dc-assigned">
          <span class="arow-lbl">Assigné à</span>
          ${chipHtml(name)}
        </div>
      </div>`;
    }

    // Non attribué — vérifier suggestion planning
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
        <i class="fas fa-user-slash"></i> Non attribué
      </span>
      <button class="dc-claim-btn" onclick="MX.Pages.Checklist.claimSlot('${esc(slot)}')">
        <i class="fas fa-hand-pointer"></i> Je prends ce créneau
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
