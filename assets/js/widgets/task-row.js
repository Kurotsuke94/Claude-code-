(function () {
  function taskRow({ task, dayId, slot, isChecked, assigneeName, canTransfer, transfer, canAssign, planSuggestions }) {
    const { esc, avatarBg, avatarFg } = MX;
    const isPending     = transfer && transfer.status === "pending";
    const isTransferred = transfer && transfer.status === "accepted";

    if (isTransferred) {
      const nc = MX.userColors(transfer.toUser);
      return `<div class="trow transferred" id="tr_${esc(task.id)}">
        <div class="tcb" style="border-color:var(--border)"><i class="fas fa-share" style="opacity:0.5;font-size:10px"></i></div>
        <span class="ttext">${esc(task.text)}</span>
        <span class="twho" style="background:${nc.bg};color:${nc.fg}">${esc(transfer.toUser)}</span>
      </div>`;
    }

    const click = `onclick="MX.Pages.Checklist.toggle('${esc(dayId)}','${esc(slot)}','${esc(task.id)}')"`;

    // Note button
    const noteKey = `${dayId}_${slot}_${task.id}`;
    const hasNote = !!((MX.state.notes || {})[noteKey]);
    const cu      = MX.state.currentUser;
    const canNote = !!(cu || MX.Auth.isAdmin());
    let noteEl = '';
    if (canNote || hasNote) {
      noteEl = `<button class="note-btn${hasNote ? ' has-note' : ''}"
        title="${hasNote ? 'Voir la note' : 'Ajouter une note'}"
        onclick="event.stopPropagation();MX.Pages.Checklist.openNote('${esc(dayId)}','${esc(slot)}','${esc(task.id)}')">
        <i class="fas fa-note-sticky"></i>
      </button>`;
    }

    let transferEl = '';
    if (!isChecked) {
      if (isPending) {
        transferEl = `<button class="transfer-pending-btn" onclick="event.stopPropagation();MX.Pages.Checklist.cancelTransfer('${esc(transfer.id)}')">
          <i class="fas fa-clock"></i>${esc(transfer.toUser)}&nbsp;<i class="fas fa-xmark"></i>
        </button>`;
      } else if (canTransfer) {
        transferEl = `<button class="transfer-btn" title="Transférer" onclick="event.stopPropagation();MX.Pages.Checklist.startTransfer('${esc(dayId)}','${esc(slot)}','${esc(task.id)}')">
          <i class="fas fa-share"></i>
        </button>`;
      }
    }

    if (canAssign) {
      // Responsable mode: lighter row with optional per-task override
      const isCustom = !!task.customized;
      const custWho  = task.assignedTo || '';
      const inhWho   = assigneeName    || '';  // slot-level tech
      const pickId   = `tc-pick-${task.id}`;

      const users  = (MX.state.users || []).filter(u => u.name && !u.hidden);
      const suggs  = planSuggestions || [];
      const _SLOT_LBL = { matin: 'Matin', journee: 'Journée', soir: 'Soir' };

      const opts = `<option value="">— Hérité (${esc(inhWho || 'non assigné')}) —</option>` +
        users.map(u => {
          let lbl = esc(u.name);
          if (suggs.includes(u.name)) lbl += ` (${_SLOT_LBL[slot] || slot})`;
          return `<option value="${esc(u.name)}"${u.name === custWho ? ' selected' : ''}>${lbl}</option>`;
        }).join('');

      let assignBadge = '';
      if (isCustom) {
        assignBadge = `<span class="sc-custom-bdg"><i class="fas fa-user-pen" style="font-size:9px"></i> ${esc(custWho || '—')}</span>
          <button class="sc-uncustom-btn" title="Réinitialiser au créneau"
            onclick="event.stopPropagation();MX.Pages.Checklist.clearTaskCustom('${esc(dayId)}','${esc(slot)}','${esc(task.id)}')">
            <i class="fas fa-xmark"></i>
          </button>`;
      } else if (inhWho) {
        assignBadge = `<span class="sc-inh-bdg">👤 ${esc(inhWho)}</span>`;
      }

      return `<div class="trow ${isChecked ? 'done' : ''}" id="tr_${esc(task.id)}" style="flex-direction:column;align-items:stretch;cursor:default;padding:0;gap:0">
        <div ${click} style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:8px 12px 6px 12px">
          <div class="tcb ${isChecked ? 'on' : ''}"><i class="fas fa-check"></i></div>
          <span class="ttext" style="flex:1">${esc(task.text)}</span>
          ${assignBadge}
          <button class="sc-pen-btn${isCustom ? ' active' : ''}" title="${isCustom ? 'Personnalisation active' : 'Personnaliser'}"
            onclick="event.stopPropagation();MX.Pages.Checklist._togglePick('${esc(task.id)}')">
            <i class="fas fa-pen"></i>
          </button>
          ${noteEl}
          ${transferEl}
        </div>
        <div id="${pickId}" onclick="event.stopPropagation()"
          style="display:${isCustom ? 'flex' : 'none'};align-items:center;gap:6px;padding:2px 12px 8px 40px">
          <i class="fas fa-user" style="font-size:10px;color:var(--text3);flex-shrink:0"></i>
          <select style="font-size:11px;height:26px;padding:0 6px;border-radius:6px;background:var(--bg3);border:1px solid var(--border2);color:var(--text1);min-width:140px;cursor:pointer;font-family:var(--ffs)"
            onchange="MX.Pages.Checklist.assignTask('${esc(dayId)}','${esc(slot)}','${esc(task.id)}',this.value,true)">
            ${opts}
          </select>
        </div>
      </div>`;
    }

    const perAssignee = task.assignedTo && task.assignedTo !== assigneeName ? task.assignedTo : null;
    return `<div class="trow ${isChecked ? 'done' : ''}" id="tr_${esc(task.id)}" ${click}>
      <div class="tcb ${isChecked ? 'on' : ''}"><i class="fas fa-check"></i></div>
      <span class="ttext">${esc(task.text)}</span>
      ${perAssignee ? `<span class="twho" style="background:${avatarBg(perAssignee)};color:${avatarFg(perAssignee)}" title="Assigné à ${esc(perAssignee)}">👤 ${esc(perAssignee)}</span>` : assigneeName ? `<span class="twho" style="background:${avatarBg(assigneeName)};color:${avatarFg(assigneeName)}">${esc(assigneeName)}</span>` : ''}
      ${noteEl}
      ${transferEl}
    </div>`;
  }

  window.MX = window.MX || {};
  window.MX.Widgets = window.MX.Widgets || {};
  window.MX.Widgets.taskRow = taskRow;
})();
