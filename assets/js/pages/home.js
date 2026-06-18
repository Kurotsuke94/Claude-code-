(function () {
  let _planUploading = false;

  async function _compressImage(file) {
    const MAX_PX = 1400, QUALITY = 0.80;
    return new Promise(function(resolve) {
      var timer = setTimeout(function() { resolve(file); }, 12000);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w <= MAX_PX && h <= MAX_PX && file.size < 400000) { clearTimeout(timer); resolve(file); return; }
        var scale = Math.min(1, MAX_PX / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) { clearTimeout(timer); resolve(blob || file); }, "image/jpeg", QUALITY);
      };
      img.onerror = function() { clearTimeout(timer); resolve(file); };
      img.src = url;
    });
  }

  async function uploadPlan(input) {
    if (_planUploading) return;
    const file = input.files[0];
    if (!file) return;
    _planUploading = true;
    MX.toast("Compression…");
    try {
      const compressed = await _compressImage(file);
      MX.toast("Upload en cours…");
      const imageUrl = await MX.DB.uploadPlanningImage(compressed);
      await MX.DB.savePlanning(imageUrl);
      MX.toast("Planning mis à jour ✓");
    } catch(e) {
      console.error(e);
      MX.toast("Erreur lors de l'upload", true);
    } finally {
      _planUploading = false;
      input.value = "";
    }
  }

  function clearPlan() {
    MX.showModal("Supprimer le planning ?", "L'image sera supprimée pour tous.", [
      { label: "Supprimer", cls: "danger", fn: async function() {
        try { await MX.DB.clearPlanning(); MX.toast("Planning supprimé"); }
        catch(e) { MX.toast("Erreur suppression", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }

  function openPlan() {
    const url = MX.state.planningUrl;
    if (url) window.open(url, "_blank");
  }

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

    // Planning section
    const canEdit  = MX.Auth.canSeeAll();
    const planUrl  = state.planningUrl;

    h += `<div class="section-label">Planning</div>`;
    h += `<div class="day-card" style="margin-bottom:24px">`;

    if (planUrl) {
      h += `<div style="padding:14px 16px">
        <img src="${esc(planUrl)}" alt="Planning" loading="lazy"
          style="width:100%;border-radius:10px;display:block;cursor:pointer;max-height:600px;object-fit:contain;background:var(--bg2)"
          onclick="MX.Pages.Home.openPlan()">
        ${canEdit ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <label for="plan-upload" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg4);color:var(--text1);cursor:pointer;font-size:13px;font-family:var(--ffs)">
            <i class="fas fa-camera"></i> Changer la photo
          </label>
          <button onclick="MX.Pages.Home.clearPlan()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid rgba(255,80,80,.4);border-radius:8px;background:none;color:var(--red);cursor:pointer;font-size:13px;font-family:var(--ffs)">
            <i class="fas fa-trash"></i> Supprimer
          </button>
        </div>` : ''}
      </div>`;
    } else {
      h += `<div style="padding:28px 16px;text-align:center">
        <div style="font-size:36px;margin-bottom:10px">📅</div>`;
      if (canEdit) {
        h += `<div style="font-size:14px;font-weight:600;margin-bottom:6px">Aucun planning affiché</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:16px">Ajoutez une photo du planning hebdomadaire</div>
          <label for="plan-upload" class="primary-btn" style="display:inline-flex;cursor:pointer;width:auto;padding:10px 24px">
            <i class="fas fa-upload"></i> Ajouter une photo
          </label>`;
      } else {
        h += `<div style="font-size:13px;color:var(--text2)">Aucun planning disponible</div>`;
      }
      h += `</div>`;
    }

    if (canEdit) {
      h += `<input type="file" id="plan-upload" accept="image/*" style="display:none" onchange="MX.Pages.Home.uploadPlan(this)">`;
    }

    h += `</div>`;

    h += `</div>`;
    el.innerHTML = h;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Home = { render, uploadPlan, clearPlan, openPlan };
})();
