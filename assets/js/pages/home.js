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

  // ── SVG LINE CHART ──
  function _svgLineChart(data, labels) {
    const W = 360, H = 90, PAD = 14, PADL = 26;
    const W2 = W - PADL - PAD;
    const H2 = H - PAD * 2;
    const n  = data.length;

    if (n === 0) return `<svg viewBox="0 0 ${W} ${H+20}" width="100%" height="110" xmlns="http://www.w3.org/2000/svg"></svg>`;

    const pts = data.map((v, i) => ({
      x: PADL + (n === 1 ? W2 / 2 : (i / (n - 1)) * W2),
      y: PAD  + H2 - (v / 100) * H2
    }));

    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaD = pathD +
      ` L${pts[n-1].x.toFixed(1)},${(PAD + H2).toFixed(1)}` +
      ` L${pts[0].x.toFixed(1)},${(PAD + H2).toFixed(1)} Z`;

    const dots = pts.map(p =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#00F5D4" stroke="var(--bg3)" stroke-width="2"/>`
    ).join('');

    const xLabels = labels.map((l, i) => {
      const x = PADL + (n === 1 ? W2 / 2 : (i / (n - 1)) * W2);
      return `<text x="${x.toFixed(1)}" y="${H + 16}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="var(--ffm)">${l}</text>`;
    }).join('');

    const gridLines = [0, 50, 100].map(v => {
      const y = PAD + H2 - (v / 100) * H2;
      return `<line x1="${PADL}" y1="${y.toFixed(1)}" x2="${(W-PAD).toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>
              <text x="${(PADL-4).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="8" fill="var(--text3)" font-family="var(--ffm)">${v}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H+20}" width="100%" height="120" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
      <defs>
        <linearGradient id="lgHome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00F5D4" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#00F5D4" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaD}" fill="url(#lgHome)"/>
      <path d="${pathD}" fill="none" stroke="#00F5D4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xLabels}
    </svg>`;
  }

  // ── SVG DONUT CHART ──
  function _svgDonut(done, total) {
    const R = 34, CX = 50, CY = 50;
    const C = 2 * Math.PI * R;
    const pct  = total ? Math.min(1, done / total) : 0;
    const dashD = pct * C;
    const dashR = C - dashD;
    const pctTxt = Math.round(pct * 100);

    return `<svg viewBox="0 0 100 100" width="88" height="88" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--bg4)" stroke-width="10"/>
      ${total > 0 ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#00F5D4" stroke-width="10"
        stroke-dasharray="${dashD.toFixed(1)} ${dashR.toFixed(1)}"
        stroke-linecap="round"
        transform="rotate(-90 ${CX} ${CY})"
        style="filter:drop-shadow(0 0 4px rgba(0,245,212,0.4))"/>` : ''}
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)" font-family="var(--ffm)">${pctTxt}</text>
      <text x="${CX}" y="${CY + 11}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="var(--ffm)">%</text>
    </svg>`;
  }

  function render() {
    const { state, DAYS, SLOTS, getDaySlots, esc, todayId } = MX;
    const el    = document.getElementById("main-content");
    const today = todayId();

    // ── Global stats ──
    let totalAll = 0, doneAll = 0;
    DAYS.forEach(d => {
      getDaySlots(d.id).forEach(sl => {
        (state.tasks[`${d.id}_${sl}`] || []).forEach(t => {
          totalAll++;
          if (state.checks[`${d.id}_${sl}_${t.id}`]) doneAll++;
        });
      });
    });
    const pct      = totalAll ? Math.round(doneAll / totalAll * 100) : 0;
    const lowProds = (state.products || []).filter(p => parseInt(p.qty || 0) < parseInt(p.minQty || 0));
    const msgCount = (state.messages || []).length;

    // ── Trend vs previous week ──
    const hist     = state.history || [];
    const prevWeek = hist[0] || null;
    const prevDone = prevWeek ? (prevWeek.totalDone  || 0) : null;
    const prevRemain = prevWeek ? ((prevWeek.totalTotal || 0) - (prevWeek.totalDone || 0)) : null;

    function _trendHtml(curr, prev) {
      if (prev === null) return `<span class="stat-trend neutral">Première semaine</span>`;
      const diff = curr - prev;
      if (diff > 0)  return `<span class="stat-trend up"><i class="fas fa-arrow-up"></i> +${diff}</span>`;
      if (diff < 0)  return `<span class="stat-trend down"><i class="fas fa-arrow-down"></i> ${diff}</span>`;
      return `<span class="stat-trend neutral">= Stable</span>`;
    }

    // ── Per-day completion for line chart ──
    const dayData   = DAYS.map(d => {
      let t = 0, dn = 0;
      getDaySlots(d.id).forEach(sl => {
        (state.tasks[`${d.id}_${sl}`] || []).forEach(task => {
          t++;
          if (state.checks[`${d.id}_${sl}_${task.id}`]) dn++;
        });
      });
      return t ? Math.round(dn / t * 100) : 0;
    });
    const dayLabels = DAYS.map(d => d.s);

    // ── Per-slot stats ──
    const slotStats = Object.entries(SLOTS).map(([sl, info]) => {
      let t = 0, dn = 0;
      DAYS.forEach(d => {
        if (getDaySlots(d.id).includes(sl)) {
          (state.tasks[`${d.id}_${sl}`] || []).forEach(task => {
            t++;
            if (state.checks[`${d.id}_${sl}_${task.id}`]) dn++;
          });
        }
      });
      const spct = t ? Math.round(dn / t * 100) : 0;
      return { sl, info, total: t, done: dn, pct: spct };
    });

    const slotColors = { matin: 'var(--matin)', journee: 'var(--jour)', soir: 'var(--soir)' };

    // ── Build HTML ──
    let h = `
      <div class="ph">
        <div class="ph-eye">TABLEAU DE BORD</div>
        <div class="ph-row">
          <div>
            <div class="ph-title">Semaine</div>
            <div class="ph-sub">${esc(state.weekLabel || MX.mkWeekLabel())}</div>
          </div>
        </div>
      </div>
      <div class="page-body">`;

    // ── Urgent / Pinned banner ──
    const urgentAnns = (state.announcements || [])
      .filter(a => a.pinned || a.type === 'urgent' || a.type === 'important')
      .sort((a, b) => {
        const w = x => (x.type === 'urgent' ? 3 : x.pinned ? 2 : 1);
        return w(b) - w(a);
      })
      .slice(0, 2);

    if (urgentAnns.length) {
      const _TB = {
        urgent:    { icon: '🚨', l: 'Urgent',     c: 'var(--red)',    cd: 'var(--red-dim)',    cb: 'var(--red-border)' },
        important: { icon: '⚠️', l: 'Important',  c: 'var(--orange)', cd: 'var(--orange-dim)', cb: 'var(--orange-border)' },
        info:      { icon: '📢', l: 'Information', c: 'var(--cyan)',   cd: 'var(--cyan-dim)',   cb: 'var(--cyan-border)' },
        suggestion:{ icon: '💡', l: 'Suggestion',  c: 'var(--jour)',   cd: 'var(--jour-dim)',   cb: 'var(--jour-border)' },
        technique: { icon: '🔧', l: 'Technique',   c: 'var(--green)',  cd: 'var(--green-dim)',  cb: 'var(--green-border)' }
      };
      h += `<div class="section-label" style="display:flex;align-items:center;gap:6px">
        <i class="fas fa-bullhorn" style="color:var(--cyan)"></i> Communications internes
      </div>`;
      urgentAnns.forEach(a => {
        const tb = _TB[a.type] || _TB.info;
        h += `<div class="ann-home-card" style="border-color:${tb.cb};background:${tb.cd}" onclick="MX.showPage('msgs')">
          <span class="ann-home-ico">${tb.icon}</span>
          <div style="flex:1;min-width:0">
            <div class="ann-home-lbl" style="color:${tb.c}">${a.pinned ? '📌 Épinglé · ' : ''}${tb.l}</div>
            <div class="ann-home-txt">${esc(a.content || '')}</div>
            <div class="ann-home-meta">${esc(a.authorName || '')} · ${MX.fmtTime(a.createdAt)}</div>
          </div>
          <i class="fas fa-chevron-right" style="color:var(--text3);font-size:11px;flex-shrink:0"></i>
        </div>`;
      });
    }

    // ── KPI Cards ──
    h += `<div class="stats-grid">
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--green-dim);color:var(--green)"><i class="fas fa-check-circle"></i></div>
        <div class="stat-n g">${doneAll}</div>
        <div class="stat-l">Tâches faites</div>
        ${_trendHtml(doneAll, prevDone)}
      </div>
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--jour-dim);color:var(--jour)"><i class="fas fa-list-check"></i></div>
        <div class="stat-n b">${totalAll}</div>
        <div class="stat-l">Total tâches</div>
        <span class="stat-trend neutral">${DAYS.length} jours</span>
      </div>
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--orange-dim);color:var(--orange)"><i class="fas fa-hourglass-half"></i></div>
        <div class="stat-n o">${totalAll - doneAll}</div>
        <div class="stat-l">Restantes</div>
        ${_trendHtml(totalAll - doneAll, prevRemain)}
      </div>
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:${lowProds.length ? 'var(--red-dim)' : 'var(--green-dim)'};color:${lowProds.length ? 'var(--red)' : 'var(--green)'}"><i class="fas fa-box-open"></i></div>
        <div class="stat-n ${lowProds.length ? 'r' : 'g'}">${lowProds.length}</div>
        <div class="stat-l">Stock critique</div>
        <span class="stat-trend ${lowProds.length ? 'down' : 'neutral'}">${lowProds.length ? 'À commander' : 'Tout ok'}</span>
      </div>
    </div>`;

    // ── Progress bar ──
    h += `<div class="prog-wrap">
      <div class="prog-meta">
        <span>Avancement semaine — ${doneAll} / ${totalAll} tâches</span>
        <span class="prog-pct">${pct}%</span>
      </div>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>`;

    // ── Low stock alert ──
    if (lowProds.length) {
      h += `<div class="alert-banner danger" style="cursor:pointer" onclick="MX.showPage('orders')">
        <div class="alert-banner-ico"><i class="fas fa-triangle-exclamation"></i></div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--red)">${lowProds.length} produit${lowProds.length > 1 ? 's' : ''} à commander</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${lowProds.map(p => esc(p.name)).join(', ')}</div>
        </div>
        <button class="alert-banner-action">Voir le stock →</button>
      </div>`;
    }

    // ── Analytics section ──
    h += `<div class="section-label">Analytiques</div>
    <div class="analytics-grid">
      <div class="analytics-card">
        <div class="analytics-title"><i class="fas fa-chart-line" style="color:var(--cyan)"></i> Progression par jour</div>
        ${_svgLineChart(dayData, dayLabels)}
      </div>
      <div class="analytics-right">
        <div class="analytics-card">
          <div class="analytics-title"><i class="fas fa-circle-half-stroke" style="color:var(--cyan)"></i> Taux de complétion</div>
          <div class="donut-row">
            ${_svgDonut(doneAll, totalAll)}
            <div class="donut-legend">
              <div class="donut-leg-item">
                <div class="donut-dot" style="background:var(--cyan)"></div>
                <span style="color:var(--text2)">Faites</span>
                <span style="margin-left:auto;font-family:var(--ffm);font-weight:700;color:var(--cyan)">${doneAll}</span>
              </div>
              <div class="donut-leg-item">
                <div class="donut-dot" style="background:var(--bg4)"></div>
                <span style="color:var(--text2)">Restantes</span>
                <span style="margin-left:auto;font-family:var(--ffm);color:var(--text3)">${totalAll - doneAll}</span>
              </div>
              <div class="donut-leg-item" style="padding-top:4px;border-top:1px solid var(--border);margin-top:4px">
                <span style="color:var(--text3);font-size:11px">Total</span>
                <span style="margin-left:auto;font-family:var(--ffm);color:var(--text2)">${totalAll}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="analytics-card">
          <div class="analytics-title"><i class="fas fa-clock" style="color:var(--cyan)"></i> Par créneau</div>
          <div class="slot-breakdown">`;

    slotStats.forEach(({ sl, info, pct: spct }) => {
      const col = slotColors[sl] || 'var(--cyan)';
      h += `<div class="slot-row">
        <div class="slot-row-head">
          <span class="slot-row-lbl"><i class="fas ${info.icon}" style="color:${col};font-size:11px"></i> ${info.l}</span>
          <span class="slot-row-pct">${spct}%</span>
        </div>
        <div class="slot-mini-track"><div class="slot-mini-fill" style="width:${spct}%;background:${col}"></div></div>
      </div>`;
    });

    h += `</div></div></div></div>`;

    // ── Day cards ──
    h += `<div class="section-label">Jours de la semaine</div>
    <div class="page-grid">`;

    DAYS.forEach((d, idx) => {
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
      const dPct    = dTotal ? Math.round(dDone / dTotal * 100) : 0;
      const isToday = d.id === today;
      const stateClass = isToday ? 'today' : dPct >= 80 ? 'state-ok' : dPct >= 40 ? 'state-warn' : 'state-alert';
      const pctCls  = dPct >= 80 ? 'g' : dPct >= 40 ? 'o' : 'r';

      h += `<div class="day-card ${stateClass}" style="animation-delay:${idx * 0.04}s" onclick="MX.showPage('${d.id}')">
        <div class="day-card-head">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div class="day-card-title">${esc(d.l)}${isToday ? ' <span style="font-size:10px;font-weight:600;color:var(--cyan);font-family:var(--ffm);background:var(--cyan-dim);border:1px solid var(--cyan-border);padding:1px 7px;border-radius:10px;margin-left:6px">AUJOURD\'HUI</span>' : ''}</div>
              <div class="day-card-sub">${dDone} / ${dTotal} tâches complétées</div>
            </div>
            <div class="day-pct ${pctCls}">${dPct}%</div>
          </div>
          <div class="prog-track" style="margin-top:10px;height:5px"><div class="prog-fill" style="width:${dPct}%;box-shadow:none"></div></div>
        </div>
        <div class="day-card-body">
          <div class="day-slots">`;

      slotData.forEach(({ sl, pct: sPct }) => {
        const s   = SLOTS[sl];
        const cls = sPct >= 80 ? 'ok' : sPct >= 40 ? 'warn' : 'alert';
        h += `<span class="day-slot-chip slot-chip ${cls}">${s.l} ${sPct}%</span>`;
      });

      h += `</div></div></div>`;
    });

    h += `</div>`;

    // ── Communications card ──
    h += `<div class="section-label">Communications</div>
    <div class="day-card" style="margin-bottom:16px;animation:none" onclick="MX.showPage('msgs')">
      <div style="padding:14px 16px;display:flex;align-items:center;gap:14px">
        <div style="width:42px;height:42px;border-radius:11px;background:var(--cyan-dim);border:1px solid var(--cyan-border);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
          <i class="fas fa-comments" style="color:var(--cyan)"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600">Messages</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${msgCount} message${msgCount !== 1 ? 's' : ''} dans le tableau d'affichage</div>
        </div>
        <i class="fas fa-chevron-right" style="color:var(--text3);font-size:13px;flex-shrink:0"></i>
      </div>
    </div>`;

    // ── Planning section ──
    const canEdit = MX.Auth.canSeeAll();
    const planUrl = state.planningUrl;

    h += `<div class="section-label">Planning</div>
    <div class="day-card" style="margin-bottom:28px;animation:none">`;

    if (canEdit) {
      h += `<input type="file" id="plan-upload" accept="image/*" style="display:none" onchange="MX.Pages.Home.uploadPlan(this)">`;
    }

    if (planUrl) {
      h += `<div style="padding:14px 16px">
        <img src="${esc(planUrl)}" alt="Planning" loading="lazy"
          style="width:100%;border-radius:10px;display:block;cursor:pointer;max-height:600px;object-fit:contain;background:var(--bg2)"
          onclick="MX.Pages.Home.openPlan()">
        ${canEdit ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button type="button" onclick="document.getElementById('plan-upload').click()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--border2);border-radius:8px;background:var(--bg4);color:var(--text);cursor:pointer;font-size:13px;font-family:var(--ffs)">
            <i class="fas fa-camera"></i> Changer la photo
          </button>
          <button type="button" onclick="MX.Pages.Home.clearPlan()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--red-border);border-radius:8px;background:none;color:var(--red);cursor:pointer;font-size:13px;font-family:var(--ffs)">
            <i class="fas fa-trash"></i> Supprimer
          </button>
        </div>` : ''}
      </div>`;
    } else {
      h += `<div style="padding:32px 16px;text-align:center">
        <div style="width:56px;height:56px;border-radius:14px;background:var(--bg4);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:24px">📅</div>`;
      if (canEdit) {
        h += `<div style="font-size:14px;font-weight:600;margin-bottom:6px">Aucun planning affiché</div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:18px">Ajoutez une photo du planning hebdomadaire</div>
          <button type="button" onclick="document.getElementById('plan-upload').click()" class="primary-btn" style="margin:0 auto;width:auto;padding:10px 24px">
            <i class="fas fa-upload"></i> Ajouter une photo
          </button>`;
      } else {
        h += `<div style="font-size:13px;color:var(--text2)">Aucun planning disponible</div>`;
      }
      h += `</div>`;
    }

    h += `</div></div>`;
    el.innerHTML = h;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Home = { render, uploadPlan, clearPlan, openPlan };
})();
