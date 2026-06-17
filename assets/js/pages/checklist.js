(function () {
  function render(dayId) {
    const { state, DAYS, SLOTS, getDaySlots, esc, chipHtml, alertLevel, toast } = MX;
    const day   = DAYS.find(d => d.id === dayId);
    const slots = getDaySlots(dayId);
    const el    = document.getElementById("main-content");

    let total = 0, done = 0;
    slots.forEach(sl => {
      const tasks = state.tasks[`${dayId}_${sl}`] || [];
      tasks.forEach(t => {
        total++;
        if (state.checks[`${dayId}_${sl}_${t.id}`]) done++;
      });
    });
    const pct = total ? Math.round(done / total * 100) : 0;

    let h = `
      <div class="ph">
        <div class="ph-eye">${esc(state.weekLabel)}</div>
        <div class="ph-row">
          <div>
            <div class="ph-title">${esc(day.l)}</div>
            <div class="ph-sub">${done} / ${total} tâches complétées</div>
          </div>
          <div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:${pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)'}">${pct}%</div>
        </div>
        <div style="margin-top:10px">
          <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="page-body" style="max-width:760px">`;

    // Stats
    h += `<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-n g">${done}</div><div class="stat-l">Faites</div></div>
      <div class="stat-card"><div class="stat-n b">${total}</div><div class="stat-l">Total</div></div>
      <div class="stat-card"><div class="stat-n r">${total - done}</div><div class="stat-l">Restantes</div></div>
    </div>`;

    // Slots
    slots.forEach(sl => {
      const s     = SLOTS[sl];
      const tasks = state.tasks[`${dayId}_${sl}`] || [];
      const asn   = state.assignments[`${dayId}_${sl}`] || "";
      let sDone   = 0;
      tasks.forEach(t => { if (state.checks[`${dayId}_${sl}_${t.id}`]) sDone++; });
      const sPct  = tasks.length ? Math.round(sDone / tasks.length * 100) : 0;
      const level = alertLevel(sl, sPct, state.alerts);

      h += `<div class="slot-card">
        <div class="slot-head ${s.c}">
          <div class="ch-ico ${s.c}">${s.e}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700">${s.l}</div>
            <div class="slot-dl">${sDone}/${tasks.length} tâches</div>
            <span class="slot-chip ${level}">
              <i class="fas fa-${level === 'ok' ? 'check' : level === 'warn' ? 'triangle-exclamation' : 'circle-exclamation'}"></i>
              ${level === 'ok' ? 'En ordre' : level === 'warn' ? 'Attention' : 'Urgent'}
            </span>
          </div>
          <div class="slot-pct ${sPct >= 80 ? 'g' : sPct >= 40 ? 'o' : 'r'}">${sPct}%</div>
        </div>`;

      // Assignee row
      const names = allNames();
      h += `<div class="arow">
        <span class="arow-lbl">Assigné à</span>
        <select class="asel" onchange="MX.Pages.Checklist.assign('${dayId}','${sl}',this.value)">
          <option value="">— Choisir —</option>
          ${names.map(n => `<option value="${esc(n)}" ${n === asn ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        ${asn ? chipHtml(asn) : ''}
      </div>`;

      // Task list
      tasks.forEach(t => {
        const key    = `${dayId}_${sl}_${t.id}`;
        const isChk  = !!state.checks[key];
        h += `<div class="trow ${isChk ? 'done' : ''}" id="tr_${t.id}" onclick="MX.Pages.Checklist.toggle('${dayId}','${sl}','${t.id}')">
          <div class="tcb ${isChk ? 'on' : ''}"><i class="fas fa-check"></i></div>
          <span class="ttext">${esc(t.text)}</span>
          ${asn ? `<span class="twho" style="background:${MX.avatarBg(asn)};color:${MX.avatarFg(asn)}">${esc(asn)}</span>` : ''}
        </div>`;
      });

      if (!tasks.length) {
        h += `<div style="padding:20px 16px;text-align:center;font-size:13px;color:var(--text3)">Aucune tâche configurée</div>`;
      }

      h += `</div>`; // slot-card
    });

    h += `</div>`;
    el.innerHTML = h;
  }

  function allNames() {
    const { state } = MX;
    const set = new Set();
    ["matin","journee","soir"].forEach(sl => {
      (state.teams[sl] || []).forEach(n => { if (n.trim()) set.add(n.trim()); });
    });
    return Array.from(set).sort();
  }

  async function toggle(dayId, slot, taskId) {
    const key   = `${dayId}_${slot}_${taskId}`;
    const state = MX.state;
    const val   = !state.checks[key];

    // Optimistic UI update
    state.checks[key] = val;
    const row = document.getElementById("tr_" + taskId);
    if (row) {
      row.classList.toggle("done", val);
      const cb = row.querySelector(".tcb");
      if (cb) { cb.classList.toggle("on", val); cb.innerHTML = val ? '<i class="fas fa-check"></i>' : ""; }
    }

    try {
      await MX.DB.setCheck(key, val);
    } catch (e) {
      // Revert on error
      state.checks[key] = !val;
      MX.toast("Erreur de connexion", true);
    }
  }

  async function assign(dayId, slot, name) {
    MX.state.assignments[`${dayId}_${slot}`] = name;
    try {
      await MX.DB.setAssignment(dayId, slot, name);
    } catch (e) {
      MX.toast("Erreur lors de l'assignation", true);
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Checklist = { render, toggle, assign };
})();
