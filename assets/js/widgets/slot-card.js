(function () {
  function slotCard({ dayId, slot, tasks, assignment, checks, showAssign, workerFilter }) {
    const { SLOTS, esc, chipHtml, alertLevel, state } = MX;
    const s  = SLOTS[slot];
    const cu = state.currentUser;

    if (workerFilter && !MX.Auth.canSeeAll() && assignment !== workerFilter) return '';

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

    if (showAssign) {
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
        assigneeName: assignment,
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
