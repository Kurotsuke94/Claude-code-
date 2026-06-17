(function () {
  function render() {
    const { state, DAYS, SLOTS, getDaySlots, esc, todayId, progressClass, chipHtml, mkWeekLabel } = MX;
    const el = document.getElementById("main-content");
    const today = todayId();

    let totalAll = 0, doneAll = 0;
    DAYS.forEach(d => {
      getDaySlots(d.id).forEach(sl => {
        const tasks = (state.tasks[`${d.id}_${sl}`] || []);
        tasks.forEach(t => {
          totalAll++;
          if (state.checks[`${d.id}_${sl}_${t.id}`]) doneAll++;
        });
      });
    });
    const pct = totalAll ? Math.round(doneAll / totalAll * 100) : 0;
    const lowProds = (state.products || []).filter(p => parseInt(p.qty || 0) < parseInt(p.minQty || 0));
    const msgCount = (state.messages || []).length;

    let h = `
      <div class="ph">
        <div class="ph-eye">TABLEAU DE BORD</div>
        <div class="ph-row">
          <div>
            <div class="ph-title">Semaine</div>
            <div class="ph-sub">${esc(state.weekLabel)}</div>
          </div>
          <div class="week-badge"><i class="fas fa-calendar-week" style="font-size:10px"></i> ${esc(state.weekLabel)}</div>
        </div>
      </div>
      <div class="page-body">`;

    // Stats
    h += `<div class="stats-grid">
      <div class="stat-card"><div class="stat-n g">${doneAll}</div><div class="stat-l">Tâches faites</div></div>
      <div class="stat-card"><div class="stat-n b">${totalAll}</div><div class="stat-l">Total tâches</div></div>
      <div class="stat-card"><div class="stat-n r">${totalAll - doneAll}</div><div class="stat-l">Restantes</div></div>
      <div class="stat-card"><div class="stat-n ${lowProds.length ? 'r' : 'g'}">${lowProds.length}</div><div class="stat-l">Stock critique</div></div>
    </div>`;

    // Weekly progress
    h += `<div class="prog-wrap">
      <div class="prog-meta"><span>Avancement semaine</span><span>${pct}%</span></div>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>`;

    // Low stock banner
    if (lowProds.length) {
      h += `<div class="alert-banner danger" style="cursor:pointer" onclick="MX.showPage('orders')">
        <div class="dot red"></div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--red)">${lowProds.length} produit${lowProds.length > 1 ? 's' : ''} à commander</div>
          <div style="font-size:11px;color:var(--text2)">${lowProds.map(p => esc(p.name)).join(", ")}</div>
        </div>
      </div>`;
    }

    // Day cards grid
    h += `<div class="section-label">Jours de la semaine</div>`;
    h += `<div class="page-grid">`;

    DAYS.forEach(d => {
      const slots = getDaySlots(d.id);
      let dTotal = 0, dDone = 0;
      const slotData = slots.map(sl => {
        const tasks = state.tasks[`${d.id}_${sl}`] || [];
        let sDone = 0;
        tasks.forEach(t => {
          dTotal++;
          if (state.checks[`${d.id}_${sl}_${t.id}`]) { dDone++; sDone++; }
        });
        const sPct = tasks.length ? Math.round(sDone / tasks.length * 100) : 0;
        return { sl, tasks: tasks.length, done: sDone, pct: sPct };
      });
      const dPct = dTotal ? Math.round(dDone / dTotal * 100) : 0;
      const isToday = d.id === today;

      h += `<div class="day-card ${isToday ? 'today' : ''}" onclick="MX.showPage('${d.id}')">
        <div class="day-card-head">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div class="day-card-title">${esc(d.l)}</div>
              <div class="day-card-sub">${dDone} / ${dTotal} tâches${isToday ? ' · <span style="color:var(--cyan)">Aujourd\'hui</span>' : ''}</div>
            </div>
            <div class="day-pct ${dPct >= 80 ? 'g' : dPct >= 40 ? 'o' : 'r'}">${dPct}%</div>
          </div>
          <div class="prog-track" style="margin-top:10px"><div class="prog-fill" style="width:${dPct}%"></div></div>
        </div>
        <div class="day-card-body">
          <div class="day-slots">`;

      slotData.forEach(({ sl, pct: sPct }) => {
        const s = SLOTS[sl];
        const cls = sPct >= 80 ? 'ok' : sPct >= 40 ? 'warn' : 'alert';
        h += `<span class="day-slot-chip slot-chip ${cls}">${s.e} ${s.l} ${sPct}%</span>`;
      });

      h += `</div></div></div>`;
    });

    h += `</div>`;

    // Messages teaser
    h += `<div class="section-label">Communications</div>
      <div class="day-card" style="margin-bottom:16px" onclick="MX.showPage('msgs')">
        <div style="padding:14px 16px;display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:10px;background:var(--cyan-dim);border:1px solid var(--cyan-border);display:flex;align-items:center;justify-content:center;font-size:18px">💬</div>
          <div>
            <div style="font-size:14px;font-weight:600">Messages</div>
            <div style="font-size:12px;color:var(--text2)">${msgCount} message${msgCount !== 1 ? 's' : ''} dans le tableau d'affichage</div>
          </div>
          <i class="fas fa-chevron-right" style="margin-left:auto;color:var(--text3)"></i>
        </div>
      </div>`;

    h += `</div>`;
    el.innerHTML = h;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Home = { render };
})();
