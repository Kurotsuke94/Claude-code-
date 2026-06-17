(function () {
  function render(dayId) {
    const { state, DAYS, getDaySlots, esc, Widgets } = MX;
    const day     = DAYS.find(d => d.id === dayId);
    const slots   = getDaySlots(dayId);
    const el      = document.getElementById("main-content");
    const cu      = state.currentUser;
    const canAll  = MX.Auth.canSeeAll();
    const worker  = (!canAll && cu) ? cu.name : null;

    // Progress counts
    let total = 0, done = 0;
    slots.forEach(sl => {
      const tasks = state.tasks[`${dayId}_${sl}`] || [];
      const asn   = state.assignments[`${dayId}_${sl}`] || "";
      if (canAll || !worker || asn === worker) {
        tasks.forEach(t => {
          total++;
          if (state.checks[`${dayId}_${sl}_${t.id}`]) done++;
        });
      }
    });
    const pct = total ? Math.round(done / total * 100) : 0;

    // Identity banner
    let banner = '';
    if (cu && !MX.Auth.isAdmin()) {
      const nc  = MX.userColors(cu.name);
      const bg  = cu.color || nc.bg;
      const fg  = cu.color ? MX._contrastColor(cu.color) : nc.fg;
      const lbl = cu.role === "responsable" ? "Responsable · vue complète" : "Technicien · créneaux assignés";
      banner = `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:14px">
        <span style="width:32px;height:32px;border-radius:9px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${esc(cu.name.substring(0,2).toUpperCase())}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${esc(cu.name)}</div>
          <div style="font-size:11px;color:var(--text2)">${lbl}</div>
        </div>
        <button onclick="MX.Auth.clearCurrentUser()" style="font-size:11px;color:var(--cyan);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:var(--ffs)">Changer</button>
      </div>`;
    }

    let h = `
      <div class="ph">
        <div class="ph-eye">${esc(state.weekLabel)}</div>
        <div class="ph-row">
          <div>
            <div class="ph-title">${esc(day.l)}</div>
            <div class="ph-sub">${done} / ${total} tâches complétées</div>
          </div>
          <div style="font-size:28px;font-weight:700;font-family:var(--ffm);color:${pct>=80?'var(--green)':pct>=40?'var(--orange)':'var(--red)'}">${pct}%</div>
        </div>
        <div style="margin-top:10px">
          <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
      <div class="page-body" style="max-width:760px">
        ${banner}
        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
          <div class="stat-card"><div class="stat-n g">${done}</div><div class="stat-l">Faites</div></div>
          <div class="stat-card"><div class="stat-n b">${total}</div><div class="stat-l">Total</div></div>
          <div class="stat-card"><div class="stat-n r">${total - done}</div><div class="stat-l">Restantes</div></div>
        </div>`;

    let anyVisible = false;
    slots.forEach(sl => {
      const tasks = state.tasks[`${dayId}_${sl}`] || [];
      const asn   = state.assignments[`${dayId}_${sl}`] || "";
      const html  = Widgets.slotCard({
        dayId, slot: sl,
        tasks, assignment: asn,
        checks:       state.checks,
        showAssign:   canAll,
        workerFilter: worker
      });
      if (html) { anyVisible = true; h += html; }
    });

    if (!anyVisible && worker) {
      h += `<div style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:16px">✅</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">Aucun créneau assigné</div>
        <div style="font-size:13px;color:var(--text2)">Aucun créneau n'est assigné à <strong>${esc(worker)}</strong> ce ${esc(day.l)}.</div>
      </div>`;
    }

    h += `</div>`;
    el.innerHTML = h;
  }

  async function toggle(dayId, slot, taskId) {
    const key   = `${dayId}_${slot}_${taskId}`;
    const state = MX.state;
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
      const task     = (state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
      const cu       = state.currentUser;
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

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Checklist = { render, toggle, assign };
})();
