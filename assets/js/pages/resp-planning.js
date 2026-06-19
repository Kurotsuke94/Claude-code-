(function () {
  const COLORS = [
    { bg: "#003B35", border: "#00F5D4", l: "Cyan"    },
    { bg: "#052E16", border: "#22C55E", l: "Vert"    },
    { bg: "#071228", border: "#3B82F6", l: "Bleu"    },
    { bg: "#1C0A00", border: "#F97316", l: "Orange"  },
    { bg: "#120D1F", border: "#A78BFA", l: "Violet"  },
    { bg: "#1F0707", border: "#EF4444", l: "Rouge"   },
    { bg: "#1A2540", border: "#6B88CC", l: "Indigo"  },
    { bg: "#0A1E1E", border: "#2DD4BF", l: "Teal"    },
  ];

  let _addDay    = null;
  let _editId    = null;
  let _selColor  = COLORS[0].bg;

  function _borderFor(bg) {
    return (COLORS.find(c => c.bg === bg) || COLORS[0]).border;
  }

  function _colorPicker(prefix, selected) {
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 2px">
      ${COLORS.map(c => `
        <button type="button"
          data-rp-picker="${prefix}" data-color="${c.bg}"
          title="${c.l}"
          onclick="MX.Pages.RespPlan._setColor('${prefix}','${c.bg}')"
          style="width:28px;height:28px;border-radius:7px;background:${c.bg};
                 border:2px solid ${selected===c.bg ? c.border : '#2D3F6E'};
                 cursor:pointer;flex-shrink:0;transition:border-color 0.15s">
        </button>`).join('')}
    </div>`;
  }

  function _addForm(dayId) {
    const users = MX.state.users || [];
    const day   = MX.DAYS.find(d => d.id === dayId);
    return `
      <div style="background:var(--bg4);border:1px solid var(--border3);border-radius:12px;padding:14px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:600;color:var(--cyan);margin-bottom:10px">
          <i class="fas fa-plus"></i> Nouvelle tâche — ${MX.esc(day?.l || dayId)}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <input class="fi fi-sm" id="rp-text" placeholder="Description de la tâche…" maxlength="120">
          <input class="fi fi-sm" id="rp-person" placeholder="Prénom(s) ex : Kevin, Alban &amp; Kevin…"
            maxlength="60" list="rp-ul">
          <datalist id="rp-ul">${users.map(u => `<option value="${MX.esc(u.name)}">`).join('')}</datalist>
          <div style="font-size:11px;color:var(--text2)">Couleur :</div>
          ${_colorPicker('add', _selColor)}
          <input type="hidden" id="rp-color" value="${_selColor}">
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="save-btn" style="flex:1;margin:0" onclick="MX.Pages.RespPlan.saveAdd('${dayId}')">
              <i class="fas fa-check"></i> Ajouter
            </button>
            <button class="icon-btn" onclick="MX.Pages.RespPlan.cancelAdd()">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  function _editForm(t) {
    const users = MX.state.users || [];
    const col   = _selColor || t.color || COLORS[0].bg;
    return `
      <div style="background:var(--bg4);border:1px solid var(--border3);border-radius:12px;padding:14px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;color:var(--orange);margin-bottom:10px">
          <i class="fas fa-pen"></i> Modifier la tâche
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <input class="fi fi-sm" id="rp-edit-text" value="${MX.esc(t.text||'')}" maxlength="120">
          <input class="fi fi-sm" id="rp-edit-person" value="${MX.esc(t.person||'')}"
            maxlength="60" list="rp-ul2">
          <datalist id="rp-ul2">${users.map(u => `<option value="${MX.esc(u.name)}">`).join('')}</datalist>
          <div style="font-size:11px;color:var(--text2)">Couleur :</div>
          ${_colorPicker('edit', col)}
          <input type="hidden" id="rp-edit-color" value="${col}">
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="save-btn" style="flex:1;margin:0" onclick="MX.Pages.RespPlan.saveEdit('${MX.esc(t.id)}')">
              <i class="fas fa-check"></i> Enregistrer
            </button>
            <button class="icon-btn" onclick="MX.Pages.RespPlan.cancelEdit()">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      </div>`;
  }

  function render() {
    const el       = document.getElementById("main-content");
    const { state, DAYS, esc, Auth } = MX;
    const canEdit  = Auth.canSeeAll();
    const todayId  = MX.todayId();

    // Group & sort tasks by day
    const byDay = {};
    DAYS.forEach(d => { byDay[d.id] = []; });
    (state.respTasks || []).forEach(t => {
      if (byDay[t.dayId]) byDay[t.dayId].push(t);
    });
    DAYS.forEach(d => byDay[d.id].sort((a, b) => (a.order || 0) - (b.order || 0)));

    const allTasks  = state.respTasks || [];
    const totalAll  = allTasks.length;
    const doneAll   = allTasks.filter(t => !!state.checks["resp_" + t.id]).length;
    const pctAll    = totalAll ? Math.round(doneAll / totalAll * 100) : 0;
    const clsAll    = MX.progressClass(pctAll);

    let h = `
      <div class="ph">
        <div class="ph-eye">RESPONSABLE</div>
        <div class="ph-row">
          <div style="flex:1">
            <div class="ph-title">Planning équipe</div>
            <div class="ph-sub">Vue réservée aux responsables et administrateurs</div>
          </div>
          ${totalAll ? `<div style="text-align:right">
            <div style="font-size:22px;font-weight:700;color:var(--cyan)">${pctAll}%</div>
            <div style="font-size:11px;color:var(--text3)">${doneAll}/${totalAll} réalisées</div>
          </div>` : ''}
        </div>
      </div>
      <div class="page-body" style="max-width:760px">`;

    DAYS.forEach(day => {
      const tasks   = byDay[day.id] || [];
      const isToday = day.id === todayId;
      const dayDone = tasks.filter(t => !!state.checks["resp_" + t.id]).length;
      const dayPct  = tasks.length ? Math.round(dayDone / tasks.length * 100) : 0;
      const dayCls  = MX.progressClass(dayPct);

      h += `<div style="margin-bottom:28px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;color:${isToday ? 'var(--cyan)' : 'var(--text3)'};text-transform:uppercase;letter-spacing:0.1em;display:flex;align-items:center;gap:8px">
            ${esc(day.l)}
            ${isToday ? `<span style="font-size:10px;background:var(--cyan-dim);color:var(--cyan);border:1px solid var(--cyan-border);border-radius:10px;padding:1px 7px;font-weight:600">Aujourd'hui</span>` : ''}
            ${tasks.length ? `<span class="slot-chip ${dayCls}" style="font-size:10px">${dayDone}/${tasks.length}</span>` : `<span style="background:var(--bg4);color:var(--text3);border-radius:10px;padding:1px 7px;font-size:10px">0</span>`}
          </div>
          ${canEdit ? `<button class="dash-btn" style="font-size:11px;padding:4px 10px" onclick="MX.Pages.RespPlan.startAdd('${day.id}')">
            <i class="fas fa-plus"></i> Ajouter
          </button>` : ''}
        </div>`;

      if (_addDay === day.id) h += _addForm(day.id);

      if (!tasks.length && _addDay !== day.id) {
        h += `<div style="padding:14px;background:var(--bg3);border-radius:10px;border:1px dashed var(--border2);text-align:center;font-size:12px;color:var(--text3)">Aucune tâche planifiée</div>`;
      }

      tasks.forEach((t, i) => {
        if (_editId === t.id) {
          h += _editForm(t);
          return;
        }
        const bg        = t.color || COLORS[0].bg;
        const border    = _borderFor(bg);
        const isChecked = !!state.checks["resp_" + t.id];
        const comment   = state.checks["resp_comment_" + t.id] || "";
        const byWho     = state.checks["resp_by_" + t.id] || "";

        h += `<div style="background:${bg};border-left:3px solid ${border};border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:10px">
          <div class="tcb ${isChecked ? 'done' : ''}" onclick="MX.Pages.RespPlan.toggleRespTask('${esc(t.id)}')" style="cursor:pointer;margin-top:2px;flex-shrink:0">
            ${isChecked ? '<i class="fas fa-check"></i>' : ''}
          </div>
          <div style="flex:1;min-width:0" onclick="MX.Pages.RespPlan.toggleRespTask('${esc(t.id)}')" style="cursor:pointer">
            <div style="font-size:13px;font-weight:600;color:#F1F5F9${isChecked ? ';text-decoration:line-through;opacity:0.6' : ''}">${esc(t.text)}</div>
            ${isChecked && comment ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px;font-style:italic">"${esc(comment)}"${byWho ? ` <span style="color:var(--cyan);font-style:normal;font-weight:600">— ${esc(byWho)}</span>` : ''}</div>` : ''}
          </div>
          ${t.person ? `<span style="background:rgba(255,255,255,0.12);color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;flex-shrink:0">${esc(t.person)}</span>` : ''}
          ${canEdit ? `
            <button data-move title="Monter" onclick="MX.Pages.RespPlan.moveTask('${esc(t.id)}',-1)" style="background:rgba(255,255,255,0.06);border:none;color:rgba(255,255,255,0.5);width:26px;height:26px;border-radius:6px;cursor:pointer;flex-shrink:0;font-size:10px${i===0?';opacity:0.2;pointer-events:none':''}"><i class="fas fa-chevron-up"></i></button>
            <button data-move title="Descendre" onclick="MX.Pages.RespPlan.moveTask('${esc(t.id)}',1)" style="background:rgba(255,255,255,0.06);border:none;color:rgba(255,255,255,0.5);width:26px;height:26px;border-radius:6px;cursor:pointer;flex-shrink:0;font-size:10px${i===tasks.length-1?';opacity:0.2;pointer-events:none':''}"><i class="fas fa-chevron-down"></i></button>
            <button title="Modifier" onclick="MX.Pages.RespPlan.startEdit('${esc(t.id)}')" style="background:rgba(255,255,255,0.08);border:none;color:#fff;width:26px;height:26px;border-radius:6px;cursor:pointer;flex-shrink:0;font-size:10px"><i class="fas fa-pen"></i></button>
            <button title="Supprimer" onclick="MX.Pages.RespPlan.delTask('${esc(t.id)}')" style="background:rgba(239,68,68,0.15);border:none;color:var(--red);width:26px;height:26px;border-radius:6px;cursor:pointer;flex-shrink:0;font-size:10px"><i class="fas fa-trash"></i></button>
          ` : ''}
        </div>`;
      });

      h += `</div>`;
    });

    h += `</div>`;
    el.innerHTML = h;
  }

  function toggleRespTask(taskId) {
    const key     = "resp_" + taskId;
    const current = !!MX.state.checks[key];

    if (current) {
      Promise.all([
        MX.DB.setCheck(key, false),
        MX.DB.setCheck("resp_comment_" + taskId, false),
        MX.DB.setCheck("resp_by_" + taskId, false)
      ]).catch(() => MX.toast("Erreur", true));
      return;
    }

    const t     = (MX.state.respTasks || []).find(x => x.id === taskId);
    const label = t ? t.text : "tâche";
    const esc   = MX.esc;

    document.getElementById("m-title").textContent = "Valider la tâche";
    document.getElementById("m-sub").innerHTML = `
      <div style="font-size:13px;color:var(--text2);margin-bottom:12px">${esc(label)}</div>
      <textarea id="resp-task-comment"
        placeholder="Commentaire obligatoire…"
        style="width:100%;min-height:90px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;color:var(--text);font-size:13px;font-family:var(--ffs);resize:vertical;box-sizing:border-box;outline:none"
      ></textarea>
      <div id="resp-task-err" style="color:var(--red);font-size:12px;margin-top:6px;display:none">Un commentaire est requis.</div>`;
    document.getElementById("m-actions").innerHTML = `
      <button class="modal-btn cancel" onclick="document.getElementById('modal-bg').classList.remove('show')">Annuler</button>
      <button class="modal-btn confirm" onclick="MX.Pages.RespPlan._confirmRespTask('${esc(taskId)}')">
        <i class="fas fa-check"></i> Valider
      </button>`;
    document.getElementById("modal-bg").classList.add("show");
    setTimeout(() => { const ta = document.getElementById("resp-task-comment"); if (ta) ta.focus(); }, 150);
  }

  async function _confirmRespTask(taskId) {
    const ta      = document.getElementById("resp-task-comment");
    const errEl   = document.getElementById("resp-task-err");
    const comment = ta ? ta.value.trim() : "";
    if (!comment) {
      if (errEl) errEl.style.display = "block";
      if (ta)    ta.focus();
      return;
    }
    document.getElementById("modal-bg").classList.remove("show");
    const u         = MX.state.currentUser || MX.state.adminUser;
    const actorName = u ? (u.name || u.email || "Responsable") : "Responsable";
    try {
      await Promise.all([
        MX.DB.setCheck("resp_" + taskId, true),
        MX.DB.setCheck("resp_comment_" + taskId, comment),
        MX.DB.setCheck("resp_by_" + taskId, actorName)
      ]);
    } catch(e) { MX.toast("Erreur", true); }
  }

  // ── ACTIONS ──
  function startAdd(dayId) {
    _addDay   = dayId;
    _editId   = null;
    _selColor = COLORS[0].bg;
    render();
  }
  function cancelAdd() { _addDay = null; render(); }

  function startEdit(id) {
    const t  = (MX.state.respTasks || []).find(x => x.id === id);
    _editId  = id;
    _addDay  = null;
    _selColor = t?.color || COLORS[0].bg;
    render();
  }
  function cancelEdit() { _editId = null; render(); }

  function _setColor(prefix, color) {
    _selColor = color;
    const hiddenId = prefix === 'add' ? 'rp-color' : 'rp-edit-color';
    const inp = document.getElementById(hiddenId);
    if (inp) inp.value = color;
    document.querySelectorAll(`[data-rp-picker="${prefix}"]`).forEach(btn => {
      const border = _borderFor(btn.dataset.color);
      btn.style.borderColor = btn.dataset.color === color ? border : '#2D3F6E';
    });
  }

  async function saveAdd(dayId) {
    const text   = (document.getElementById("rp-text")   || {}).value?.trim() || "";
    const person = (document.getElementById("rp-person") || {}).value?.trim() || "";
    const color  = (document.getElementById("rp-color")  || {}).value || COLORS[0].bg;
    if (!text) return MX.toast("Entrez une description", true);
    const dayTasks = (MX.state.respTasks || []).filter(t => t.dayId === dayId);
    const order    = dayTasks.length ? Math.max(...dayTasks.map(t => t.order || 0)) + 1 : 0;
    try {
      await MX.DB.addRespTask({ dayId, text, person, color, order });
      _addDay = null;
      MX.toast("Tâche ajoutée ✓");
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function saveEdit(id) {
    const text   = (document.getElementById("rp-edit-text")   || {}).value?.trim() || "";
    const person = (document.getElementById("rp-edit-person") || {}).value?.trim() || "";
    const color  = (document.getElementById("rp-edit-color")  || {}).value || COLORS[0].bg;
    if (!text) return MX.toast("Entrez une description", true);
    try {
      await MX.DB.updateRespTask(id, { text, person, color });
      _editId = null;
      MX.toast("Modifié ✓");
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function delTask(id) {
    MX.showModal("Supprimer cette tâche ?", "Cette action est irréversible.", [
      { label: "Supprimer", cls: "danger", fn: async () => {
        try { await MX.DB.deleteRespTask(id); MX.toast("Supprimée ✓"); }
        catch(e) { MX.toast("Erreur", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }

  async function moveTask(id, dir) {
    const tasks  = MX.state.respTasks || [];
    const t      = tasks.find(x => x.id === id);
    if (!t) return;
    const dayTasks = tasks.filter(x => x.dayId === t.dayId)
                          .sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx    = dayTasks.findIndex(x => x.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= dayTasks.length) return;
    const other  = dayTasks[swapIdx];
    const oA     = t.order     ?? idx;
    const oB     = other.order ?? swapIdx;
    try {
      await MX.DB.updateRespTask(id,       { order: oB });
      await MX.DB.updateRespTask(other.id, { order: oA });
    } catch(e) { MX.toast("Erreur", true); }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.RespPlan = {
    render, startAdd, cancelAdd, saveAdd,
    startEdit, cancelEdit, saveEdit,
    delTask, moveTask, _setColor,
    toggleRespTask, _confirmRespTask
  };
})();
