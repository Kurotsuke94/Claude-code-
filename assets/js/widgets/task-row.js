(function () {
  function taskRow({ task, dayId, slot, isChecked, assigneeName, canTransfer, transfer }) {
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

    return `<div class="trow ${isChecked ? 'done' : ''}" id="tr_${esc(task.id)}" ${click}>
      <div class="tcb ${isChecked ? 'on' : ''}"><i class="fas fa-check"></i></div>
      <span class="ttext">${esc(task.text)}</span>
      ${assigneeName ? `<span class="twho" style="background:${avatarBg(assigneeName)};color:${avatarFg(assigneeName)}">${esc(assigneeName)}</span>` : ''}
      ${noteEl}
      ${transferEl}
    </div>`;
  }

  window.MX = window.MX || {};
  window.MX.Widgets = window.MX.Widgets || {};
  window.MX.Widgets.taskRow = taskRow;
})();
