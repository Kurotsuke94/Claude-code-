(function () {
  function render(dayId) {
    const { state, DAYS, getDaySlots, esc, Widgets } = MX;
    const day    = DAYS.find(d => d.id === dayId);
    const slots  = getDaySlots(dayId);
    const el     = document.getElementById("main-content");
    const cu     = state.currentUser;
    const canAll = MX.Auth.canSeeAll();
    const worker = (!canAll && cu) ? cu.name : null;

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

    // Active missions for this day
    const dayMissions = (state.missions || []).filter(m =>
      !m.done && (m.dayId === dayId || m.dayId === "all")
    );

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

    // ── Missions section (above everything) ──
    const _CL_PRIO = {
      urgent: { l:"Urgent", ico:"fa-fire",               c:"var(--red)",    bg:"var(--red-dim)",    border:"var(--red-border)"   },
      normal: { l:"Normal", ico:"fa-circle-exclamation", c:"var(--orange)", bg:"var(--orange-dim)", border:"var(--orange-border)" },
      low:    { l:"Basse",  ico:"fa-circle-dot",         c:"var(--text3)",  bg:"var(--bg4)",        border:"var(--border2)"      }
    };
    const _CL_CAT = {
      panne:    { l:"Panne",    ico:"fa-wrench"        },
      securite: { l:"Sécurité", ico:"fa-shield-halved" },
      livraison:{ l:"Livraison",ico:"fa-truck"          },
      nettoyage:{ l:"Nettoyage",ico:"fa-broom"          },
      autre:    { l:"Autre",    ico:"fa-ellipsis"       }
    };
    function _deadlineStatus(dl) {
      if (!dl) return null;
      const [dh, dmin] = dl.split(':').map(Number);
      const now  = new Date();
      const dlMs = new Date(now); dlMs.setHours(dh, dmin, 0, 0);
      const diff = dlMs - now;
      if (diff < 0)          return { label: "DÉPASSÉ",                             c: "var(--red)",    pulse: true  };
      if (diff < 60*60*1000) return { label: `Dans ${Math.round(diff/60000)}min`,   c: "var(--orange)", pulse: false };
      return { label: dl, c: "var(--text3)", pulse: false };
    }

    if (dayMissions.length) {
      h += `<div class="slot-card" style="border-color:var(--red-border);margin-bottom:20px">
        <div class="slot-head" style="background:var(--red-dim);border-bottom-color:var(--red-border)">
          <div class="ch-ico" style="background:var(--red-border);color:var(--red)"><i class="fas fa-circle-exclamation"></i></div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:var(--red)">INTERVENTIONS</div>
            <div class="slot-dl">${dayMissions.length} intervention${dayMissions.length > 1 ? 's' : ''} en cours</div>
            <span class="slot-chip alert"><i class="fas fa-circle-exclamation"></i> À traiter</span>
          </div>
          <div class="slot-pct r">${dayMissions.length}</div>
        </div>`;
      dayMissions.forEach(m => {
        const isForAll  = m.assignedTo === "all" || !m.assignedTo;
        const canToggle = canAll || (cu && (isForAll || cu.name === m.assignedTo));
        const clickAttr = canToggle ? `onclick="MX.Pages.Checklist.toggleMission('${esc(m.id)}')"` : '';
        const ptrStyle  = canToggle ? '' : 'cursor:default;pointer-events:none;opacity:0.6';
        const prio = _CL_PRIO[m.priority] || _CL_PRIO.normal;
        const cat  = _CL_CAT[m.category]  || _CL_CAT.autre;
        const dlSt = _deadlineStatus(m.deadline || null);
        let badge = '';
        if (isForAll) {
          badge = `<span class="twho" style="background:var(--red-border);color:var(--red)">Tous</span>`;
        } else {
          const nc = MX.userColors(m.assignedTo);
          badge = `<span class="twho" style="background:${nc.bg};color:${nc.fg}">${esc(m.assignedTo)}</span>`;
        }
        h += `<div class="trow" ${clickAttr} style="border-left:3px solid ${prio.c};${ptrStyle}">
          <div class="tcb" style="border-color:var(--red-border)"><i class="fas fa-check"></i></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px">
              <span style="background:${prio.bg};color:${prio.c};border:1px solid ${prio.border};padding:1px 6px;border-radius:5px;font-size:10px;font-weight:600;font-family:var(--ffm);display:inline-flex;align-items:center;gap:3px"><i class="fas ${prio.ico}"></i> ${prio.l}</span>
              <span style="background:var(--bg4);color:var(--text2);border:1px solid var(--border2);padding:1px 6px;border-radius:5px;font-size:10px;font-weight:600;font-family:var(--ffm);display:inline-flex;align-items:center;gap:3px"><i class="fas ${cat.ico}"></i> ${cat.l}</span>
              ${dlSt ? `<span class="${dlSt.pulse?'deadline-overdue':''}" style="color:${dlSt.c};font-size:10px;font-weight:600;font-family:var(--ffm);display:inline-flex;align-items:center;gap:3px"><i class="fas fa-clock"></i> ${esc(dlSt.label)}</span>` : ''}
            </div>
            <div class="ttext">${esc(m.text)}</div>
            ${m.createdBy ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">par ${esc(m.createdBy)}</div>` : ''}
          </div>
          ${badge}
        </div>`;
      });
      h += `</div>`;
    }

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

    if (!anyVisible && worker && !pendingIn.length && !acceptedIn.length) {
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

  async function toggleMission(missionId) {
    const m  = (MX.state.missions || []).find(x => x.id === missionId);
    const cu = MX.state.currentUser;
    if (!m) return;
    const isForAll = m.assignedTo === "all" || !m.assignedTo;
    if (!MX.Auth.canSeeAll() && !isForAll && cu?.name !== m.assignedTo) return MX.toast("Non autorisé", true);
    try {
      await MX.DB.updateMission(missionId, { done: true });
      const actorName = cu?.name || (MX.state.adminUser?.email || "inconnu");
      MX.DB.addLog({ workerName: actorName, action: "check", taskText: "[Intervention] " + m.text, dayId: m.dayId, slot: "intervention" }).catch(() => {});
      MX.toast("Intervention complétée ✓");
    } catch(e) {
      MX.toast("Erreur", true);
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Checklist = { render, toggle, assign, toggleMission, startTransfer, confirmTransfer, acceptTransfer, rejectTransfer, cancelTransfer, toggleTransferred, openNote, saveNote };
})();
