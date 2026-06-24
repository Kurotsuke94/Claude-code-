(function () {
  function render(dayId) {
    const { state, DAYS, getDaySlots, esc, Widgets } = MX;
    const day    = DAYS.find(d => d.id === dayId);
    const slots  = getDaySlots(dayId);
    const el     = document.getElementById("main-content");
    const cu     = state.currentUser;
    const canAll = MX.Auth.canSeeAll();
    const worker = (!canAll && cu) ? cu.name : null;

    // Today's date detection for daily claims
    const isToday              = dayId === MX.todayId();
    const dailyClaims          = isToday ? (state.dailyClaims || {}) : {};
    const todayPlanSuggestions = isToday ? (state.todayPlanSuggestions || {}) : {};

    let total = 0, done = 0;
    slots.forEach(sl => {
      const tasks = state.tasks[`${dayId}_${sl}`] || [];
      const asn   = isToday ? ((dailyClaims[sl] && dailyClaims[sl].name) || "") : (state.assignments[`${dayId}_${sl}`] || "");
      if (canAll || !worker || asn === worker) {
        tasks.forEach(t => {
          total++;
          if (state.checks[`${dayId}_${sl}_${t.id}`]) done++;
        });
      }
    });
    const pct = total ? Math.round(done / total * 100) : 0;

    let banner = '';
    if (cu && !MX.Auth.isAdmin()) {
      const nc  = MX.userColors(cu.name);
      const bg  = cu.color || nc.bg;
      const fg  = cu.color ? MX._contrastColor(cu.color) : nc.fg;
      const lbl = cu.role === "responsable" ? "Responsable · vue complète" : "Technicien · créneaux assignés";
      const _clBdg = MX.badgeBorder ? MX.badgeBorder(cu.name) : null;
      banner = `<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;margin-bottom:14px">
        <span style="width:32px;height:32px;border-radius:9px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--ffm);flex-shrink:0${_clBdg?';border:2px solid '+_clBdg:''}">${esc(cu.name.substring(0,2).toUpperCase())}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${MX.badgeTag ? MX.badgeTag(cu.name) : ''}${esc(cu.name)}</div>
          <div style="font-size:11px;color:var(--text2)">${lbl}</div>
        </div>
        <button onclick="MX.Auth.clearCurrentUser()" style="font-size:11px;color:var(--cyan);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:var(--ffs)">Changer</button>
      </div>`;
    }

    // Transfers incoming for this day
    const pendingIn  = cu ? (state.transfers || []).filter(tr => tr.toUser === cu.name && tr.status === "pending"  && tr.dayId === dayId) : [];
    const acceptedIn = cu ? (state.transfers || []).filter(tr => tr.toUser === cu.name && tr.status === "accepted" && tr.dayId === dayId) : [];

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

    // ── Incoming transfers section ──
    if (pendingIn.length || acceptedIn.length) {
      h += `<div class="section-label" style="margin-bottom:8px">
        <i class="fas fa-share" style="margin-right:6px;color:var(--cyan)"></i>
        Tâches reçues (${pendingIn.length + acceptedIn.length})
      </div>`;

      pendingIn.forEach(tr => {
        const slotObj = MX.SLOTS[tr.slot];
        h += `<div class="transfer-card">
          <div class="transfer-meta">
            <span class="transfer-from">${esc(tr.fromUser)}</span>
            <span class="transfer-day">${slotObj ? slotObj.l : tr.slot}</span>
          </div>
          <div class="transfer-task">${esc(tr.taskText)}</div>
          <div class="transfer-actions">
            <button class="primary-btn" style="flex:1;padding:8px 12px;font-size:13px" onclick="MX.Pages.Checklist.acceptTransfer('${esc(tr.id)}')">
              <i class="fas fa-check"></i> Accepter
            </button>
            <button class="danger-btn" style="flex:1;padding:8px 12px;font-size:13px" onclick="MX.Pages.Checklist.rejectTransfer('${esc(tr.id)}')">
              <i class="fas fa-times"></i> Refuser
            </button>
          </div>
        </div>`;
      });

      acceptedIn.forEach(tr => {
        const isChecked = !!state.checks[`${tr.dayId}_${tr.slot}_${tr.taskId}`];
        const slotObj   = MX.SLOTS[tr.slot];
        h += `<div class="trow ${isChecked ? 'done' : ''}" id="trr_${esc(tr.id)}" onclick="MX.Pages.Checklist.toggleTransferred('${esc(tr.dayId)}','${esc(tr.slot)}','${esc(tr.taskId)}','${esc(tr.id)}')">
          <div class="tcb ${isChecked ? 'on' : ''}"><i class="fas fa-check"></i></div>
          <span class="ttext">${esc(tr.taskText)}</span>
          <span class="twho" style="color:var(--text3);background:var(--bg4)">${slotObj ? slotObj.l : tr.slot}</span>
        </div>`;
      });

      h += `<div style="height:12px"></div>`;
    }

    let anyVisible = false;
    slots.forEach(sl => {
      const tasks      = state.tasks[`${dayId}_${sl}`] || [];
      const asn        = isToday ? ((dailyClaims[sl] && dailyClaims[sl].name) || "") : (state.assignments[`${dayId}_${sl}`] || "");
      const dailyClaim = isToday ? (dailyClaims[sl] || null) : null;
      const html  = Widgets.slotCard({
        dayId, slot: sl,
        tasks, assignment: asn,
        checks:       state.checks,
        showAssign:   canAll,
        workerFilter: worker,
        isToday,
        dailyClaim,
        todayPlanSuggestions
      });
      if (html) { anyVisible = true; h += html; }
    });

    if (!anyVisible && worker && !pendingIn.length && !acceptedIn.length) {
      h += `<div style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:16px">✅</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">Aucun créneau assigné</div>
        <div style="font-size:13px;color:var(--text2)">Aucun créneau n'est assigné à <strong>${esc(worker)}</strong> ce ${esc(day.l)}.</div>
      </div>`;
    }

    // ── Interventions summary (Responsable / Admin only) ──
    if (canAll && window.MX.Pages && window.MX.Pages.Int) {
      const iv = MX.Pages.Int._getSummary();
      h += `<div class="slot-card" style="border-color:rgba(124,58,237,.3);margin-top:20px">
        <div class="slot-head" style="background:rgba(124,58,237,.1);border-bottom-color:rgba(124,58,237,.3)">
          <div class="ch-ico" style="background:rgba(124,58,237,.2);color:#a78bfa"><i class="fas fa-wrench"></i></div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:#a78bfa">INTERVENTIONS</div>
            <div class="slot-dl">Synthèse globale</div>
          </div>
          <div class="slot-pct" style="background:rgba(124,58,237,.2);color:#a78bfa">${iv.total}</div>
        </div>
        <div style="padding:12px 14px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--orange-dim);border-radius:8px;border:1px solid var(--orange-border)">
            <span style="font-size:18px">🟡</span>
            <div>
              <div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.04em">En attente</div>
              <div style="font-size:20px;font-weight:700;color:var(--orange);line-height:1.1">${iv.en_attente}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(249,115,22,.1);border-radius:8px;border:1px solid rgba(249,115,22,.3)">
            <span style="font-size:18px">🟢</span>
            <div>
              <div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.04em">En cours</div>
              <div style="font-size:20px;font-weight:700;color:#F97316;line-height:1.1">${iv.en_cours}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--red-dim);border-radius:8px;border:1px solid var(--red-border)">
            <span style="font-size:18px">🔴</span>
            <div>
              <div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.04em">En retard</div>
              <div style="font-size:20px;font-weight:700;color:var(--red);line-height:1.1">${iv.en_retard}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg4);border-radius:8px;border:1px solid var(--border2)">
            <span style="font-size:18px">⚪</span>
            <div>
              <div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.04em">Terminées</div>
              <div style="font-size:20px;font-weight:700;color:var(--text1);line-height:1.1">${iv.terminee}</div>
            </div>
          </div>
        </div>
        <div style="padding:0 14px 14px">
          <div style="margin-bottom:10px;padding:6px 12px;background:var(--bg3);border-radius:8px;font-size:12px;color:var(--text2);display:flex;align-items:center;justify-content:space-between">
            <span><i class="fas fa-list" style="color:var(--text3);margin-right:5px"></i>Total</span>
            <strong style="color:var(--text1)">${iv.total} intervention${iv.total!==1?'s':''}</strong>
          </div>
          <button onclick="MX.showPage('interventions')"
            style="width:100%;padding:11px;border:1.5px solid rgba(124,58,237,.5);border-radius:10px;background:rgba(124,58,237,.12);color:#a78bfa;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;justify-content:center;gap:8px">
            <i class="fas fa-wrench"></i> Ouvrir les interventions
          </button>
        </div>
      </div>`;
    }

    // ── Mes interventions (technicien uniquement) ──
    if (!canAll && cu && window.MX.Pages && window.MX.Pages.Int) {
      const myIv = MX.Pages.Int._getSummary(cu.name);
      if (myIv.total > 0) {
        const ST_C = {
          planifiee: { l:'Planifiée', c:'var(--text2)',   bg:'var(--bg4)'                 },
          affectee:  { l:'Affectée',  c:'var(--orange)',  bg:'var(--orange-dim)'           },
          en_cours:  { l:'En cours',  c:'#F97316',        bg:'rgba(249,115,22,.13)'        },
          terminee:  { l:'Terminée',  c:'#22C55E',        bg:'rgba(34,197,94,.13)'         },
          en_retard: { l:'En retard', c:'var(--red)',      bg:'var(--red-dim)'             },
          annulee:   { l:'Annulée',   c:'var(--text3)',   bg:'var(--bg4)'                 }
        };
        h += `<div class="slot-card" style="border-color:rgba(124,58,237,.3);margin-top:20px">
          <div class="slot-head" style="background:rgba(124,58,237,.1);border-bottom-color:rgba(124,58,237,.3)">
            <div class="ch-ico" style="background:rgba(124,58,237,.2);color:#a78bfa"><i class="fas fa-wrench"></i></div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700;color:#a78bfa">MES INTERVENTIONS</div>
              <div class="slot-dl">${myIv.total} affectée${myIv.total!==1?'s':''}</div>
            </div>
            <div class="slot-pct" style="background:rgba(124,58,237,.2);color:#a78bfa">${myIv.total}</div>
          </div>`;
        myIv.items.forEach(iv => {
          const sc = ST_C[iv.effStatus] || ST_C.planifiee;
          h += `<div class="trow" onclick="MX.showPage('interventions')" style="cursor:pointer">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--text1)">${esc(iv.title)}</div>
              ${iv.startDate ? `<div style="font-size:11px;color:var(--text3);margin-top:2px"><i class="fas fa-calendar-day" style="margin-right:4px"></i>${esc(iv.startDate)}</div>` : ''}
            </div>
            <span style="padding:2px 9px;border-radius:6px;font-size:10px;font-weight:700;font-family:var(--ffm);background:${sc.bg};color:${sc.c};white-space:nowrap;flex-shrink:0">${sc.l}</span>
          </div>`;
        });
        h += `<div style="padding:8px 14px">
          <button onclick="MX.showPage('interventions')"
            style="width:100%;padding:9px;border:1.5px solid rgba(124,58,237,.3);border-radius:8px;background:rgba(124,58,237,.08);color:#a78bfa;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:flex;align-items:center;justify-content:center;gap:6px">
            <i class="fas fa-external-link-alt"></i> Voir mes interventions
          </button>
        </div>
        </div>`;
      }
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
      const task      = (state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
      const cu        = state.currentUser;
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

  // ── DAILY CLAIMS (auto-attribution) ──
  async function claimSlot(slot) {
    const cu = MX.state.currentUser;
    if (!cu) return MX.toast("Connectez-vous pour prendre un créneau", true);
    const dateStr = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    if (existing.lockedBy) return MX.toast("Ce créneau est verrouillé par le responsable", true);
    if (existing.name && existing.name !== cu.name) return MX.toast("Ce créneau est déjà pris par " + existing.name, true);
    try {
      await MX.DB.setDailyClaim(dateStr, slot, cu.name, "");
      MX.toast("Créneau pris ✓");
      MX.DB.addLog({ workerName: cu.name, action: "claim", taskText: "[Aujourd'hui] " + cu.name + " a pris le créneau " + slot, dayId: MX.todayId(), slot }).catch(() => {});
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function unclaimSlot(slot) {
    const cu = MX.state.currentUser;
    if (!cu) return;
    const dateStr  = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    if (existing.lockedBy) return MX.toast("Créneau verrouillé — contactez un responsable", true);
    if (existing.name !== cu.name) return;
    try {
      await MX.DB.clearDailyClaim(dateStr, slot);
      MX.toast("Créneau libéré");
      MX.DB.addLog({ workerName: cu.name, action: "unclaim", taskText: "[Aujourd'hui] " + cu.name + " a quitté le créneau " + slot, dayId: MX.todayId(), slot }).catch(() => {});
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function assignToday(slot, name) {
    const dateStr  = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    try {
      await MX.DB.setDailyClaim(dateStr, slot, name, existing.lockedBy || "");
      const actor = MX.state.adminUser ? MX.state.adminUser.email : (MX.state.currentUser ? MX.state.currentUser.name : "inconnu");
      MX.DB.addLog({ workerName: actor, action: "assign", taskText: "[Aujourd'hui] " + slot + " → " + (name || "(aucun)"), dayId: MX.todayId(), slot }).catch(() => {});
    } catch(e) { MX.toast("Erreur lors de l'assignation", true); }
  }

  async function toggleLockSlot(slot) {
    const dateStr  = MX.state.todayDateStr || new Date().toISOString().slice(0, 10);
    const existing = (MX.state.dailyClaims || {})[slot] || {};
    const actor    = MX.state.adminUser ? (MX.state.adminUser.email || "admin") : (MX.state.currentUser ? MX.state.currentUser.name : "resp");
    const newLock  = existing.lockedBy ? "" : actor;
    try {
      await MX.DB.setDailyClaim(dateStr, slot, existing.name || "", newLock);
      MX.toast(newLock ? "Créneau verrouillé 🔒" : "Créneau déverrouillé");
    } catch(e) { MX.toast("Erreur", true); }
  }

  // ── TRANSFER ──
  function startTransfer(dayId, slot, taskId) {
    const cu = MX.state.currentUser;
    if (!cu) return MX.toast("Connectez-vous pour transférer", true);

    const task = (MX.state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
    if (!task) return;

    const others = (MX.state.users || []).filter(u => u.name !== cu.name);
    if (!others.length) return MX.toast("Aucun autre utilisateur disponible", true);

    MX._pendingTransfer = { dayId, slot, taskId, taskText: task.text };

    const picks = others.map(u => {
      const nc = MX.userColors(u.name);
      return `<button onclick="MX.Pages.Checklist.confirmTransfer('${MX.esc(u.name)}')"
        style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3);cursor:pointer;width:100%;text-align:left;margin-bottom:8px;font-size:14px;font-weight:500;color:var(--text1);font-family:var(--ffs)">
        <span style="width:34px;height:34px;border-radius:9px;background:${nc.bg};color:${nc.fg};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${MX.esc(u.name.substring(0,2).toUpperCase())}</span>
        ${MX.esc(u.name)}
      </button>`;
    }).join('');

    document.getElementById("m-title").textContent = "Transférer à…";
    document.getElementById("m-sub").innerHTML = `
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.5">"${MX.esc(task.text)}"</div>
      ${picks}`;
    document.getElementById("m-actions").innerHTML = `<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>`;
    document.getElementById("modal-bg").classList.add("show");
  }

  async function confirmTransfer(toUser) {
    MX.closeModal();
    const t  = MX._pendingTransfer;
    const cu = MX.state.currentUser;
    if (!t || !cu) return;
    delete MX._pendingTransfer;

    try {
      await MX.DB.createTransfer({ taskId: t.taskId, taskText: t.taskText, dayId: t.dayId, slot: t.slot, fromUser: cu.name, toUser });
      MX.toast("Transféré à " + toUser + " ✓");
    } catch(e) {
      MX.toast("Erreur lors du transfert", true);
    }
  }

  async function acceptTransfer(transferId) {
    try {
      await MX.DB.updateTransfer(transferId, "accepted");
      MX.toast("Tâche acceptée ✓");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  async function rejectTransfer(transferId) {
    try {
      await MX.DB.updateTransfer(transferId, "rejected");
      MX.toast("Tâche refusée");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  async function cancelTransfer(transferId) {
    try {
      await MX.DB.cancelTransfer(transferId);
      MX.toast("Transfert annulé");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  async function toggleTransferred(dayId, slot, taskId, transferId) {
    const key   = `${dayId}_${slot}_${taskId}`;
    const state = MX.state;
    const val   = !state.checks[key];
    const cu    = state.currentUser;

    state.checks[key] = val;
    const row = document.getElementById("trr_" + transferId);
    if (row) {
      row.classList.toggle("done", val);
      const cb = row.querySelector(".tcb");
      if (cb) { cb.classList.toggle("on", val); cb.innerHTML = val ? '<i class="fas fa-check"></i>' : ""; }
    }

    try {
      await MX.DB.setCheck(key, val);
      const actorName = cu ? cu.name : "inconnu";
      const tr = (state.transfers || []).find(t => t.id === transferId);
      MX.DB.addLog({ workerName: actorName, action: val ? "check" : "uncheck", taskText: tr ? tr.taskText : taskId, dayId, slot }).catch(() => {});
    } catch(e) {
      state.checks[key] = !val;
      MX.toast("Erreur de connexion", true);
    }
  }

  function openNote(dayId, slot, taskId) {
    const key  = `${dayId}_${slot}_${taskId}`;
    const task = (MX.state.tasks[`${dayId}_${slot}`] || []).find(t => t.id === taskId);
    const note = (MX.state.notes || {})[key] || "";
    const cu   = MX.state.currentUser;
    const canWrite = !!(cu || MX.Auth.isAdmin());

    document.getElementById("m-title").textContent = task ? task.text : "Note";
    if (canWrite) {
      document.getElementById("m-sub").innerHTML =
        `<textarea id="note-ta" class="fi" style="width:100%;min-height:90px;resize:vertical;font-size:13px;line-height:1.5;margin-top:6px" placeholder="Ajouter une remarque sur cette tâche…" maxlength="500">${MX.esc(note)}</textarea>`;
      document.getElementById("m-actions").innerHTML = `
        <button class="modal-btn confirm" onclick="MX.Pages.Checklist.saveNote('${MX.esc(key)}')"><i class="fas fa-check"></i> Enregistrer</button>
        <button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>`;
    } else {
      document.getElementById("m-sub").innerHTML = note
        ? `<div style="font-size:13px;line-height:1.6;color:var(--text2);padding:6px 0">${MX.esc(note)}</div>`
        : `<div style="font-size:13px;color:var(--text3);padding:6px 0">Aucune note pour cette tâche.</div>`;
      document.getElementById("m-actions").innerHTML =
        `<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>`;
    }
    document.getElementById("modal-bg").classList.add("show");
  }

  async function saveNote(key) {
    const ta   = document.getElementById("note-ta");
    const text = ta ? ta.value.trim() : "";
    MX.closeModal();
    try {
      await MX.DB.setNote(key, text);
      MX.toast(text ? "Note enregistrée ✓" : "Note supprimée");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  function toggleMission(missionId) {
    const m  = (MX.state.missions || []).find(x => x.id === missionId);
    const cu = MX.state.currentUser;
    if (!m) return;
    const isForAll = m.assignedTo === "all" || !m.assignedTo;
    if (!MX.Auth.canSeeAll() && !isForAll && cu?.name !== m.assignedTo) return MX.toast("Non autorisé", true);

    document.getElementById("m-title").textContent = "Clôturer l'intervention";
    document.getElementById("m-sub").innerHTML = `
      <div style="margin:6px 0">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--red)">
          <i class="fas fa-circle-exclamation"></i> ${MX.esc(m.text)}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px">
          Un commentaire est requis pour valider la clôture :
        </div>
        <textarea id="mission-comment" class="fi"
          style="width:100%;min-height:80px;resize:vertical;font-size:13px;line-height:1.5"
          placeholder="Ex : Carnet vérifié, aucune anomalie…" maxlength="300"></textarea>
        <div id="mission-comment-err" style="color:var(--red);font-size:11px;min-height:16px;margin-top:4px"></div>
      </div>`;
    document.getElementById("m-actions").innerHTML = `
      <button class="modal-btn confirm" onclick="MX.Pages.Checklist._confirmMissionClose('${MX.esc(missionId)}')">
        <i class="fas fa-check"></i> Valider la clôture
      </button>
      <button class="modal-btn cancel" onclick="MX.closeModal()">
        <i class="fas fa-times"></i> Annuler
      </button>`;
    document.getElementById("modal-bg").classList.add("show");
    setTimeout(() => document.getElementById("mission-comment")?.focus(), 80);
  }

  async function _confirmMissionClose(missionId) {
    const comment  = (document.getElementById("mission-comment") || {}).value?.trim() || "";
    const errEl    = document.getElementById("mission-comment-err");
    if (!comment) {
      if (errEl) errEl.textContent = "Un commentaire est obligatoire pour clôturer.";
      return;
    }
    MX.closeModal();
    const m         = (MX.state.missions || []).find(x => x.id === missionId);
    const cu        = MX.state.currentUser;
    const actorName = cu?.name || (MX.state.adminUser?.email || "inconnu");
    try {
      await MX.DB.updateMission(missionId, {
        done: true,
        completionComment: comment,
        completedBy: actorName
      });
      MX.DB.addLog({
        workerName: actorName, action: "check",
        taskText: "[Intervention] " + (m?.text || "") + " — " + comment,
        dayId: m?.dayId || "all", slot: "intervention"
      }).catch(() => {});
      MX.toast("Intervention clôturée ✓");
    } catch(e) { MX.toast("Erreur", true); }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Checklist = { render, toggle, assign, claimSlot, unclaimSlot, assignToday, toggleLockSlot, toggleMission, _confirmMissionClose, startTransfer, confirmTransfer, acceptTransfer, rejectTransfer, cancelTransfer, toggleTransferred, openNote, saveNote };
})();
