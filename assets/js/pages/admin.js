(function () {
  let aTab    = "tasks";
  let aDay    = "lundi";

  function render() {
    const el = document.getElementById("main-content");
    if (!MX.Auth.isAdmin()) {
      el.innerHTML = `
        <div class="ph"><div class="ph-eye">ADMIN</div><div class="ph-title">Administration</div></div>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;gap:20px;padding:40px">
          <div style="width:76px;height:76px;border-radius:22px;background:var(--bg3);border:1px solid var(--border3);display:flex;align-items:center;justify-content:center;font-size:30px;color:var(--text3)">
            <i class="fas fa-lock"></i>
          </div>
          <div style="font-size:20px;font-weight:700">Accès restreint</div>
          <div style="font-size:13px;color:var(--text2);text-align:center;line-height:1.6;max-width:300px">Connectez-vous avec votre compte administrateur pour accéder à ce panneau.</div>
          <button class="primary-btn" style="max-width:280px" onclick="MX.Auth.showLogin(()=>MX.showPage('admin'))">
            <i class="fas fa-sign-in-alt"></i> Se connecter
          </button>
        </div>`;
      return;
    }

    const tabs = [
      { id: "tasks",   label: "📋 Tâches"    },
      { id: "team",    label: "👥 Équipe"     },
      { id: "alerts",  label: "🔔 Alertes"    },
      { id: "orders",  label: "📦 Stock"      },
      { id: "week",    label: "📅 Semaine"    },
      { id: "msgs",    label: "💬 Messages"   },
      { id: "pin",     label: "🔑 Accès"      }
    ];

    let h = `
      <div class="ph">
        <div class="ph-eye">ADMINISTRATION</div>
        <div class="ph-row">
          <div><div class="ph-title">Panneau Admin</div><div class="ph-sub">Configuration et gestion</div></div>
          <button class="logout-btn" onclick="MX.Auth.logout()"><i class="fas fa-lock"></i> Verrouiller</button>
        </div>
      </div>
      <div class="page-body">
        <div class="atabs">
          ${tabs.map(t => `<button class="atab ${aTab === t.id ? 'on' : ''}" onclick="MX.Pages.Admin.setTab('${t.id}')">${t.label}</button>`).join('')}
        </div>`;

    if (aTab === "tasks")   h += renderTasks();
    if (aTab === "team")    h += renderTeam();
    if (aTab === "alerts")  h += renderAlerts();
    if (aTab === "orders")  h += renderOrders();
    if (aTab === "week")    h += renderWeek();
    if (aTab === "msgs")    h += renderMsgs();
    if (aTab === "pin")     h += renderPin();

    h += `</div>`;
    el.innerHTML = h;
  }

  // ── TASKS ──
  function renderTasks() {
    const { state, DAYS, SLOTS, esc, getDaySlots } = MX;
    const day   = DAYS.find(d => d.id === aDay);
    const slots = getDaySlots(aDay);
    let h = `<div class="dpills">`;
    DAYS.forEach(d => {
      const cnt = getDaySlots(d.id).reduce((acc, sl) => acc + (state.tasks[`${d.id}_${sl}`] || []).length, 0);
      h += `<button class="dpill ${aDay === d.id ? 'on' : ''}" onclick="MX.Pages.Admin.setDay('${d.id}')">${esc(d.l)} <span class="pc">${cnt}</span></button>`;
    });
    h += `</div>`;

    h += `<div class="copy-bar">
      <label>Copier depuis</label>
      <select class="csel" id="cpfrom">
        ${DAYS.filter(d => d.id !== aDay).map(d => `<option value="${d.id}">${esc(d.l)}</option>`).join('')}
      </select>
      <button class="cbtn" onclick="MX.Pages.Admin.copyTasks()"><i class="fas fa-arrow-right"></i> Copier</button>
    </div>`;

    slots.forEach(sl => {
      const s     = SLOTS[sl];
      const tasks = state.tasks[`${aDay}_${sl}`] || [];
      h += `<div class="tecard">
        <div class="tehd ${s.c}">
          <span class="sbadge ${s.c}">${s.e} ${s.l}</span>
          <span style="font-size:11px;color:var(--text2);margin-left:auto">${tasks.length} tâche${tasks.length !== 1 ? 's' : ''}</span>
        </div>`;
      tasks.forEach((t, i) => {
        h += `<div class="terow">
          <input class="fi fi-sm" style="flex:1" value="${esc(t.text)}"
            oninput="MX.Pages.Admin.editTask('${aDay}','${sl}','${t.id}',this.value)">
          <button class="icon-btn del" onclick="MX.Pages.Admin.rmTask('${aDay}','${sl}','${t.id}')"><i class="fas fa-trash"></i></button>
        </div>`;
      });
      h += `<div style="padding:8px 14px"><button class="dash-btn" onclick="MX.Pages.Admin.addTask('${aDay}','${sl}')"><i class="fas fa-plus"></i> Ajouter</button></div>
      </div>`;
    });
    h += `<button class="save-btn" onclick="MX.Pages.Admin.saveTasks()"><i class="fas fa-check"></i> Enregistrer ${esc(day.l)}</button>`;
    return h;
  }

  // ── TEAM ──
  function renderTeam() {
    const { state, SLOTS, esc, TEAM_COLORS, avatarBg, avatarFg } = MX;
    let h = "";
    ["matin","journee","soir"].forEach(sl => {
      const s = SLOTS[sl];
      h += `<div class="tecard">
        <div class="tehd ${s.c}"><span class="sbadge ${s.c}">${s.e} ${s.l}</span></div>`;
      (state.teams[sl] || []).forEach((name, i) => {
        const nc = TEAM_COLORS[name] || { bg: avatarBg(name), fg: avatarFg(name) };
        h += `<div class="terow">
          ${name ? `<span class="chip" style="background:${nc.bg};color:${nc.fg};min-width:60px;text-align:center">${esc(name) || '?'}</span>` : ''}
          <input class="fi fi-sm" style="flex:1" placeholder="Prénom…" value="${esc(name)}"
            oninput="MX.Pages.Admin.editTeam('${sl}',${i},this.value)">
          <button class="icon-btn del" onclick="MX.Pages.Admin.rmTeam('${sl}',${i})"><i class="fas fa-trash"></i></button>
        </div>`;
      });
      h += `<div style="padding:8px 14px"><button class="dash-btn" onclick="MX.Pages.Admin.addTeam('${sl}')"><i class="fas fa-plus"></i> Ajouter</button></div>
      </div>`;
    });
    h += `<button class="save-btn" onclick="MX.Pages.Admin.saveTeam()"><i class="fas fa-check"></i> Enregistrer</button>`;
    return h;
  }

  // ── ALERTS ──
  function renderAlerts() {
    const { state, SLOTS, esc } = MX;
    const bgMap = { matin: "var(--matin-dim)", journee: "var(--jour-dim)", soir: "var(--soir-dim)" };
    let h = `<div class="info-note" style="margin-bottom:12px"><i class="fas fa-circle-info"></i> Si la checklist n'est pas terminée à la deadline, un email est envoyé via EmailJS.</div>`;
    ["matin","journee","soir"].forEach(sl => {
      const s   = SLOTS[sl];
      const cfg = (state.alerts || {})[sl] || {};
      h += `<div class="acfg">
        <div class="acfg-hd" style="background:${bgMap[sl]}">
          <div class="ch-ico ${s.c}" style="width:32px;height:32px">${s.e}</div>
          <div style="flex:1"><div style="font-size:14px;font-weight:600">${s.l}</div>
          <div style="font-size:11px;color:var(--text3)">${cfg.active ? 'Alerte active' : 'Alerte inactive'}</div></div>
          <button class="tog ${cfg.active ? 'on' : 'off'}" onclick="MX.Pages.Admin.togAlert('${sl}')" aria-label="Toggle"></button>
        </div>
        <div class="rfield"><label>Deadline</label><input class="ri" type="time" value="${esc(cfg.deadline || '')}" oninput="MX.Pages.Admin.updAlert('${sl}','deadline',this.value)"></div>
        <div class="rfield"><label>Email</label><input class="ri" type="email" placeholder="responsable@…" value="${esc(cfg.email || '')}" oninput="MX.Pages.Admin.updAlert('${sl}','email',this.value)"></div>
        <div class="rfield"><label>EmailJS Key</label><input class="ri" type="text" placeholder="clé publique…" value="${esc(cfg.key || '')}" oninput="MX.Pages.Admin.updAlert('${sl}','key',this.value)"></div>
        <div class="rfield"><label>Service ID</label><input class="ri" type="text" placeholder="service_xxxxx" value="${esc(cfg.svc || '')}" oninput="MX.Pages.Admin.updAlert('${sl}','svc',this.value)"></div>
        <div class="rfield"><label>Template ID</label><input class="ri" type="text" placeholder="template_xxxxx" value="${esc(cfg.tpl || '')}" oninput="MX.Pages.Admin.updAlert('${sl}','tpl',this.value)"></div>
      </div>`;
    });
    h += `<button class="save-btn" onclick="MX.Pages.Admin.saveAlerts()"><i class="fas fa-check"></i> Enregistrer les alertes</button>`;
    return h;
  }

  // ── ORDERS (ADMIN) ──
  function renderOrders() {
    const { state, esc } = MX;
    const prods = state.products || [];
    const lows  = prods.filter(p => parseInt(p.qty || 0) < parseInt(p.minQty || 0));
    let h = "";
    if (lows.length) {
      h += `<div class="alert-banner danger" style="margin-bottom:12px">
        <div class="dot red"></div>
        <div><div style="font-size:13px;font-weight:600;color:var(--red)">${lows.length} à commander</div>
        ${lows.map(p => `<div style="font-size:12px;color:var(--text2)">${esc(p.id)} — ${esc(p.name)} (${parseInt(p.qty||0)}/${parseInt(p.minQty||0)})</div>`).join('')}</div>
      </div>`;
    }
    prods.forEach(p => {
      const low = parseInt(p.qty || 0) < parseInt(p.minQty || 0);
      h += `<div class="apcard">
        <div class="aphd">
          <div class="dot ${low ? 'red' : 'green'}"></div>
          <span style="font-size:11px;font-family:var(--ffm);color:var(--text3)">${esc(p.id)}</span>
          <span style="font-size:12px;font-weight:600;flex:1;margin-left:6px">${esc(p.name) || '—'}</span>
          <span style="font-size:10px;font-weight:700;color:${low ? 'var(--red)' : 'var(--green)'}">${low ? 'CMD' : 'OK'}</span>
          <button class="icon-btn del" style="width:30px;height:30px" onclick="MX.Pages.Admin.delProd('${esc(p.id)}')"><i class="fas fa-trash"></i></button>
        </div>
        <div class="apgrid">
          <div><div class="aplbl">Nom</div><input class="fi fi-sm" value="${esc(p.name || '')}" oninput="MX.Pages.Admin.updProd('${esc(p.id)}','name',this.value)"></div>
          <div><div class="aplbl">Référence</div><input class="fi fi-sm" value="${esc(p.ref || '')}" oninput="MX.Pages.Admin.updProd('${esc(p.id)}','ref',this.value)" placeholder="REF-XXX"></div>
          <div><div class="aplbl">Qté min 🔒</div><input class="fi fi-sm" type="number" min="0" value="${parseInt(p.minQty||0)}" oninput="MX.Pages.Admin.updProdMin('${esc(p.id)}',this.value)" style="color:var(--orange)"></div>
          <div><div class="aplbl">Qté stock</div><input class="fi fi-sm" type="number" min="0" value="${parseInt(p.qty||0)}" oninput="MX.Pages.Admin.updProd('${esc(p.id)}','qty',this.value)"></div>
        </div>
      </div>`;
    });
    h += `<div style="margin-bottom:8px"><button class="dash-btn" onclick="MX.Pages.Admin.addProd()"><i class="fas fa-plus"></i> Ajouter un produit</button></div>`;
    h += `<button class="save-btn" onclick="MX.Pages.Admin.saveProd()"><i class="fas fa-check"></i> Enregistrer</button>`;
    return h;
  }

  // ── WEEK ──
  function renderWeek() {
    const { state, DAYS, getDaySlots, esc } = MX;
    let totalAll = 0, doneAll = 0;
    DAYS.forEach(d => {
      getDaySlots(d.id).forEach(sl => {
        (state.tasks[`${d.id}_${sl}`] || []).forEach(t => {
          totalAll++;
          if (state.checks[`${d.id}_${sl}_${t.id}`]) doneAll++;
        });
      });
    });
    const pct = totalAll ? Math.round(doneAll / totalAll * 100) : 0;
    return `<div class="week-ctrl">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">Gestion de la semaine</div>
      <div class="wc-badge"><i class="fas fa-calendar-week"></i> ${esc(state.weekLabel)}</div>
      <div class="prog-track" style="margin-bottom:8px"><div class="prog-fill" style="width:${pct}%"></div></div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:16px;font-family:var(--ffm)">${doneAll}/${totalAll} (${pct}%)</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="danger-btn" onclick="MX.Pages.Admin.confirmReset()"><i class="fas fa-rotate-left"></i> Réinitialiser les coches</button>
        <button class="primary-btn" onclick="MX.Pages.Admin.confirmNewWeek()"><i class="fas fa-forward"></i> Lancer une nouvelle semaine</button>
      </div>
    </div>`;
  }

  // ── MESSAGES (ADMIN) ──
  function renderMsgs() {
    const { state, esc, fmtTime, avatarBg, avatarFg, avatarTxt } = MX;
    const msgs = state.messages || [];
    if (!msgs.length) return `<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">Aucun message</div>`;
    let h = "";
    msgs.forEach(m => {
      const bg = avatarBg(m.author), fg = avatarFg(m.author);
      h += `<div class="msg-card">
        <div class="msg-hd">
          <div class="msg-av" style="background:${bg};color:${fg}">${esc(avatarTxt(m.author))}</div>
          <div style="flex:1"><div class="msg-author">${esc(m.author)}</div><div class="msg-time">${fmtTime(m.ts)}</div></div>
          <button class="icon-btn del" onclick="MX.Pages.Admin.delMsg('${esc(m.id)}')"><i class="fas fa-trash"></i></button>
        </div>
        <div class="msg-ttl">${esc(m.title)}</div>
        <div class="msg-bdy">${esc(m.body)}</div>
      </div>`;
    });
    return h;
  }

  // ── PIN ──
  function renderPin() {
    return `<div class="acfg" style="padding:16px">
      <div style="font-size:14px;font-weight:600;margin-bottom:16px">Changer le mot de passe admin</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5">
        Pour changer le mot de passe, utilisez la console Firebase Authentication à l'adresse :<br>
        <strong style="color:var(--cyan)">console.firebase.google.com</strong><br>
        → Authentication → Utilisateurs → Modifier l'utilisateur
      </div>
      <div class="info-note"><i class="fas fa-circle-info"></i> Le mot de passe est géré de façon sécurisée par Firebase Auth. Il n'est jamais stocké dans la base de données.</div>
    </div>`;
  }

  // ── ACTIONS ──
  function setTab(t) { aTab = t; render(); }
  function setDay(d) { aDay = d; render(); }

  function editTask(dayId, sl, taskId, val) {
    const tasks = MX.state.tasks[`${dayId}_${sl}`] || [];
    const t = tasks.find(x => x.id === taskId);
    if (t) t.text = val;
  }
  function addTask(dayId, sl) {
    const tasks = MX.state.tasks[`${dayId}_${sl}`] || [];
    tasks.push({ id: MX.uuid(), text: "", order: tasks.length });
    MX.state.tasks[`${dayId}_${sl}`] = tasks;
    render();
  }
  function rmTask(dayId, sl, taskId) {
    const tasks = MX.state.tasks[`${dayId}_${sl}`] || [];
    MX.state.tasks[`${dayId}_${sl}`] = tasks.filter(t => t.id !== taskId);
    render();
  }
  async function saveTasks() {
    const { DAYS, getDaySlots } = MX;
    const day   = DAYS.find(d => d.id === aDay);
    const slots = getDaySlots(aDay);
    try {
      for (const sl of slots) {
        const items = MX.state.tasks[`${aDay}_${sl}`] || [];
        await MX.DB.setTasks(aDay, sl, items.map((t, i) => ({ ...t, order: i })));
      }
      MX.toast(day.l + " enregistré ✓");
    } catch (e) { MX.toast("Erreur de sauvegarde", true); }
  }
  async function copyTasks() {
    const from  = (document.getElementById("cpfrom") || {}).value;
    if (!from) return;
    const { getDaySlots } = MX;
    getDaySlots(aDay).forEach(sl => {
      const src = (MX.state.tasks[`${from}_${sl}`] || []).map(t => ({ ...t, id: MX.uuid() }));
      MX.state.tasks[`${aDay}_${sl}`] = src;
    });
    render();
    MX.toast("Copié ✓");
  }

  function editTeam(sl, i, val) { (MX.state.teams[sl] || [])[i] = val; }
  function addTeam(sl)          { (MX.state.teams[sl] = MX.state.teams[sl] || []).push(""); render(); }
  function rmTeam(sl, i)        { (MX.state.teams[sl] || []).splice(i, 1); render(); }
  async function saveTeam() {
    try { await MX.DB.saveTeams(MX.state.teams); MX.toast("Équipe enregistrée ✓"); }
    catch (e) { MX.toast("Erreur", true); }
  }

  function togAlert(sl) {
    if (!MX.state.alerts[sl]) MX.state.alerts[sl] = {};
    MX.state.alerts[sl].active = !MX.state.alerts[sl].active;
    render();
  }
  function updAlert(sl, f, v) { if (!MX.state.alerts[sl]) MX.state.alerts[sl] = {}; MX.state.alerts[sl][f] = v; }
  async function saveAlerts() {
    try { await MX.DB.saveAlerts(MX.state.alerts); MX.toast("Alertes enregistrées ✓"); }
    catch (e) { MX.toast("Erreur", true); }
  }

  function updProd(id, f, v)   { const p = (MX.state.products||[]).find(x=>x.id===id); if(p) p[f]=v; }
  function updProdMin(id, v)   { const p = (MX.state.products||[]).find(x=>x.id===id); if(p) p.minQty=parseInt(v)||0; }
  async function addProd() {
    try {
      const id = "P" + String((MX.state.products||[]).length + 1).padStart(3,"0");
      await MX.DB.addProduct({ name:"", ref:"", qty:0, minQty:0, controller:"" });
      MX.toast("Produit ajouté ✓");
    } catch(e) { MX.toast("Erreur",true); }
  }
  async function delProd(id) {
    MX.showModal("Supprimer ce produit ?","Cette action est irréversible.",[
      { label:"Supprimer", cls:"danger", fn: async()=>{ try{ await MX.DB.deleteProduct(id); MX.toast("Supprimé ✓"); }catch(e){ MX.toast("Erreur",true); } } },
      { label:"Annuler",   cls:"cancel" }
    ]);
  }
  async function saveProd() {
    try {
      for (const p of (MX.state.products||[])) {
        await MX.DB.updateProduct(p.id, { name:p.name,ref:p.ref,qty:parseInt(p.qty||0),minQty:parseInt(p.minQty||0),controller:p.controller||"" });
      }
      MX.toast("Catalogue enregistré ✓");
    } catch(e) { MX.toast("Erreur",true); }
  }

  async function delMsg(id) {
    MX.showModal("Supprimer ce message ?","", [
      { label:"Supprimer", cls:"danger", fn: async()=>{ try{ await MX.DB.deleteMessage(id); MX.toast("Supprimé ✓"); }catch(e){ MX.toast("Erreur",true); } } },
      { label:"Annuler",   cls:"cancel" }
    ]);
  }

  function confirmReset() {
    MX.showModal("Réinitialiser ?","Toutes les cases remises à zéro. Tâches conservées.",[
      { label:"Réinitialiser", cls:"danger", fn: async()=>{ try{ await MX.DB.resetChecks(); MX.state.checks={}; MX.toast("Réinitialisé ✓"); }catch(e){ MX.toast("Erreur",true); } } },
      { label:"Annuler", cls:"cancel" }
    ]);
  }
  function confirmNewWeek() {
    const cur = MX.state.weekNum || 1;
    MX.showModal("Nouvelle semaine ?","Coches remises à zéro. Tâches et équipe conservées.",[
      { label:"Lancer", cls:"confirm", fn: async()=>{
        try {
          const label = MX.mkWeekLabel();
          await MX.DB.newWeek(label, cur + 1);
          MX.state.weekNum   = cur + 1;
          MX.state.weekLabel = label;
          MX.state.checks    = {};
          MX.toast("Nouvelle semaine lancée ✓");
        } catch(e) { MX.toast("Erreur",true); }
      }},
      { label:"Annuler", cls:"cancel" }
    ]);
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Admin = {
    render, setTab, setDay,
    editTask, addTask, rmTask, saveTasks, copyTasks,
    editTeam, addTeam, rmTeam, saveTeam,
    togAlert, updAlert, saveAlerts,
    updProd, updProdMin, addProd, delProd, saveProd,
    delMsg, confirmReset, confirmNewWeek
  };
})();
