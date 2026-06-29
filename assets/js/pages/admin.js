(function () {
  let aTab = "tasks";
  let aDay = "lundi";
  let _editMissionId  = null;
  let _adminJournal   = [];
  let _journalUnsub   = null;
  let _bibleStats     = null;
  let _biblePerms     = null;
  let _badgeModal     = null;
  let _editRoleId     = null;   // id of role being edited, or '__new__' for creation
  let _newRoleData    = {};     // buffer for the new-role form (not yet saved)

  // ── ROLES — permission matrix definition ──
  const PERM_MODULES = [
    { id: 'checklist',     label: 'Checklists',        icon: 'fa-list-check',    actions: [{id:'view',label:'Voir'},{id:'check',label:'Valider'},{id:'edit',label:'Modifier'},{id:'delete',label:'Supprimer'}] },
    { id: 'planning',      label: 'Planning',           icon: 'fa-calendar-days', actions: [{id:'view',label:'Voir'},{id:'edit',label:'Modifier'},{id:'assign',label:'Affecter'}] },
    { id: 'counters',      label: 'Compteurs',          icon: 'fa-gauge-high',    actions: [{id:'view',label:'Voir'},{id:'enter',label:'Saisir'},{id:'edit',label:'Modifier'}] },
    { id: 'interventions', label: 'Interventions',      icon: 'fa-wrench',        actions: [{id:'view',label:'Voir'},{id:'create',label:'Créer'},{id:'edit',label:'Modifier'}] },
    { id: 'stock',         label: 'Stock / Commandes',  icon: 'fa-box',           actions: [{id:'view',label:'Voir'},{id:'edit',label:'Modifier'}] },
    { id: 'messages',      label: 'Messages',           icon: 'fa-comments',      actions: [{id:'view',label:'Voir'},{id:'send',label:'Envoyer'},{id:'pin',label:'Épingler'}] },
    { id: 'resources',     label: 'Ressources',         icon: 'fa-book',          actions: [{id:'view',label:'Voir'},{id:'edit',label:'Modifier'}] },
    { id: 'consumption',   label: 'Consommations',      icon: 'fa-chart-bar',     actions: [{id:'view',label:'Voir'},{id:'edit',label:'Modifier'}] },
    { id: 'users',         label: 'Utilisateurs',       icon: 'fa-users',         actions: [{id:'view',label:'Voir'},{id:'edit',label:'Modifier'},{id:'delete',label:'Supprimer'}] },
  ];

  const _saveTimers = {};
  function _sched(key, fn, delay) {
    clearTimeout(_saveTimers[key]);
    _saveTimers[key] = setTimeout(fn, delay !== undefined ? delay : 700);
  }

  function _avBorder(name) {
    const b = MX.badgeBorder ? MX.badgeBorder(name) : null;
    return b ? ';border:2px solid ' + b : '';
  }

  // ── Bible & Games constants (used in new admin tabs) ──
  const BIBLE_ROLES  = ['Technicien', 'Responsable', 'Administrateur'];
  const BIBLE_PERM_L = ['Lecture', 'Écriture', 'Modification', 'Suppression', 'Validation'];
  const BIBLE_PERM_D = {
    Technicien:    [true,  true,  true,  false, false],
    Responsable:   [true,  true,  true,  true,  true ],
    Administrateur:[true,  true,  true,  true,  true ]
  };
  const PRIO = {
    urgent: { l:"Urgent", ico:"fa-fire",               c:"var(--red)",    bg:"var(--red-dim)",    border:"var(--red-border)"   },
    normal: { l:"Normal", ico:"fa-circle-exclamation", c:"var(--orange)", bg:"var(--orange-dim)", border:"var(--orange-border)" },
    low:    { l:"Basse",  ico:"fa-circle-dot",         c:"var(--text3)",  bg:"var(--bg4)",        border:"var(--border2)"      }
  };
  const CAT = {
    panne:    { l:"Panne",    ico:"fa-wrench"        },
    securite: { l:"Sécurité", ico:"fa-shield-halved" },
    livraison:{ l:"Livraison",ico:"fa-truck"          },
    nettoyage:{ l:"Nettoyage",ico:"fa-broom"          },
    autre:    { l:"Autre",    ico:"fa-ellipsis"       }
  };

  function render() {
    const el      = document.getElementById("main-content");
    const isAdmin = MX.Auth.isAdmin();
    const isResp  = MX.Auth.canSeeAll() && !isAdmin;

    if (!isAdmin && !isResp) {
      const hasUsers = (MX.state.users || []).length > 0;
      el.innerHTML = `
        <div class="ph"><div class="ph-eye">ADMIN</div><div class="ph-title">Administration</div></div>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;gap:16px;padding:40px">
          <div style="width:76px;height:76px;border-radius:22px;background:var(--bg3);border:1px solid var(--border3);display:flex;align-items:center;justify-content:center;font-size:30px;color:var(--text3)">
            <i class="fas fa-lock"></i>
          </div>
          <div style="font-size:20px;font-weight:700">Accès restreint</div>
          <div style="font-size:13px;color:var(--text2);text-align:center;line-height:1.6;max-width:300px">Connectez-vous pour accéder à ce panneau.</div>
          <button class="primary-btn" style="max-width:280px" onclick="MX.Auth.showLogin(()=>MX.showPage('admin'))">
            <i class="fas fa-sign-in-alt"></i> Connexion Admin
          </button>
          ${hasUsers ? `<button class="primary-btn" style="max-width:280px;background:var(--bg4);color:var(--cyan);border:1px solid var(--cyan-border)" onclick="MX.Auth.showUserPicker()">
            <i class="fas fa-user"></i> Connexion Responsable
          </button>` : ''}
        </div>`;
      return;
    }

    const _lsTab = localStorage.getItem("mx_admin_tab");
    if (_lsTab) { aTab = _lsTab; localStorage.removeItem("mx_admin_tab"); }

    const allTabs = [
      { id: "tasks",          label: "📋 Tâches"            },
      { id: "team",           label: "👷 Gestion Équipes"   },
      { id: "alerts",         label: "🔔 Alertes"           },
      { id: "week",           label: "📅 Semaine"           },
      { id: "history",        label: "📊 Historique"        },
      { id: "msgs",           label: "💬 Messages"          },
      { id: "logs",           label: "📈 Activité"          },
      { id: "bible-admin",    label: "📖 Bible"             },
      { id: "badges-admin",   label: "🏅 Badges"            },
      { id: "admin-journal",  label: "📜 Journal"           },
      { id: "users",          label: "👤 Utilisateurs",      adminOnly: true },
      { id: "roles",          label: "🎭 Rôles",             adminOnly: true },
      { id: "absences",       label: "🏖 Absences",          adminOnly: true },
      { id: "pin",            label: "🔑 Accès",             adminOnly: true },
      { id: "superadmin",     label: "🏨 Hôtels",            adminOnly: true }
    ];
    const tabs = allTabs.filter(t => isAdmin || !t.adminOnly);

    if (aTab === "missions" || aTab === "orders") aTab = "tasks";
    if (aTab === "games-admin" || aTab === "players-admin") aTab = "badges-admin";
    if (isResp && (aTab === "users" || aTab === "roles" || aTab === "pin" || aTab === "absences" || aTab === "superadmin")) aTab = "tasks";

    // Start admin journal listener on first use
    if (aTab === 'admin-journal' && !_journalUnsub) {
      _journalUnsub = MX.DB.listenAdminJournal(entries => {
        _adminJournal = entries;
        if (aTab === 'admin-journal') render();
      });
    }

    const actionBtn = isAdmin
      ? `<button class="logout-btn" onclick="MX.Auth.logout()"><i class="fas fa-lock"></i> Verrouiller</button>`
      : `<button class="logout-btn" onclick="MX.Auth.clearCurrentUser()"><i class="fas fa-sign-out-alt"></i> Déconnexion</button>`;

    let h = `
      <div class="ph">
        <div class="ph-eye">${isAdmin ? 'ADMINISTRATION' : 'RESPONSABLE'}</div>
        <div class="ph-row">
          <div>
            <div class="ph-title">Panneau ${isAdmin ? 'Admin' : 'Responsable'}</div>
            <div class="ph-sub">${isAdmin ? 'Configuration et gestion' : 'Interventions et gestion des tâches'}</div>
          </div>
          ${actionBtn}
        </div>
      </div>
      <div class="page-body">
        <div class="atabs">
          ${tabs.map((t, i) => {
            const prev = tabs[i-1];
            const sep  = isAdmin && !prev?.adminOnly && t.adminOnly
              ? `<span class="atab-sep" title="Super Admin uniquement"></span>`
              : '';
            return sep + `<button class="atab ${aTab===t.id?'on':''} ${t.adminOnly?'atab--admin':''}"`
              + ` onclick="MX.Pages.Admin.setTab('${t.id}')">${t.label}</button>`;
          }).join('')}
        </div>`;

    if (aTab === "tasks")             h += renderTasks();
    if (aTab === "team")              h += renderTeam();
    if (aTab === "alerts")            h += renderAlerts();
    if (aTab === "week")              h += renderWeek();
    if (aTab === "history")           h += renderHistory();
    if (aTab === "msgs")              h += renderMsgs();
    if (aTab === "logs")              h += renderLogs();
    if (aTab === "users"         && isAdmin)  h += renderUsers();
    if (aTab === "roles"         && isAdmin)  h += renderRoles();
    if (aTab === "absences"      && isAdmin)  h += renderAbsences();
    if (aTab === "pin"           && isAdmin)  h += renderPin();
    if (aTab === "bible-admin")               h += renderBibleAdmin();
    if (aTab === "badges-admin")              h += renderBadgesAdmin();
    if (aTab === "admin-journal")             h += renderAdminJournal();
    if (aTab === "superadmin"    && isAdmin)  h += renderSuperAdmin();

    h += `</div>`;
    el.innerHTML = h;
    if (aTab === "superadmin" && isAdmin) { _hotelLoadForm(); _verLoad(); }
  }

  // ── TASKS ──
  function renderTasks() {
    const { state, DAYS, SLOTS, esc, getDaySlots } = MX;
    const day   = DAYS.find(d => d.id === aDay);
    const slots = getDaySlots(aDay);
    let h = `<div class="dpills">`;
    DAYS.forEach(d => {
      const cnt = getDaySlots(d.id).reduce((acc, sl) => acc + (state.tasks[`${d.id}_${sl}`] || []).length, 0);
      h += `<button class="dpill ${aDay===d.id?'on':''}" onclick="MX.Pages.Admin.setDay('${d.id}')">${esc(d.l)} <span class="pc">${cnt}</span></button>`;
    });
    h += `</div>
      <div class="copy-bar">
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
          <span style="font-size:11px;color:var(--text2);margin-left:auto">${tasks.length} tâche${tasks.length!==1?'s':''}</span>
        </div>`;
      tasks.forEach(t => {
        h += `<div class="terow">
          <input class="fi fi-sm" style="flex:1" value="${esc(t.text)}"
            oninput="MX.Pages.Admin.editTask('${aDay}','${sl}','${t.id}',this.value)">
          <button class="icon-btn del" onclick="MX.Pages.Admin.rmTask('${aDay}','${sl}','${t.id}')"><i class="fas fa-trash"></i></button>
        </div>`;
      });
      h += `<div style="padding:8px 14px"><button class="dash-btn" onclick="MX.Pages.Admin.addTask('${aDay}','${sl}')"><i class="fas fa-plus"></i> Ajouter</button></div>
      </div>`;
    });
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
          ${name ? `<span class="chip" style="background:${nc.bg};color:${nc.fg};min-width:60px;text-align:center">${esc(name)||'?'}</span>` : ''}
          <input class="fi fi-sm" style="flex:1" placeholder="Prénom…" value="${esc(name)}"
            oninput="MX.Pages.Admin.editTeam('${sl}',${i},this.value)">
          <button class="icon-btn del" onclick="MX.Pages.Admin.rmTeam('${sl}',${i})"><i class="fas fa-trash"></i></button>
        </div>`;
      });
      h += `<div style="padding:8px 14px"><button class="dash-btn" onclick="MX.Pages.Admin.addTeam('${sl}')"><i class="fas fa-plus"></i> Ajouter</button></div>
      </div>`;
    });
    return h;
  }

  // ── MISSIONS ──
  function _deadlineStatusAdmin(dl) {
    if (!dl) return null;
    const [h, min] = dl.split(':').map(Number);
    const now  = new Date();
    const dlMs = new Date(now); dlMs.setHours(h, min, 0, 0);
    const diff = dlMs - now;
    if (diff < 0)          return { label: "DÉPASSÉ",            c: "var(--red)",    pulse: true  };
    if (diff < 60*60*1000) return { label: `Dans ${Math.round(diff/60000)}min`, c: "var(--orange)", pulse: false };
    return { label: dl, c: "var(--text3)", pulse: false };
  }

  function renderMissions() {
    const { state, DAYS, esc } = MX;
    const missions = state.missions || [];
    const users    = state.users    || [];
    const cu       = state.currentUser;
    const createdBy = MX.Auth.isAdmin()
      ? (state.adminUser ? state.adminUser.email : "Admin")
      : (cu ? cu.name : "Responsable");

    // Priorité button helper
    function prioBtnStyle(key, active) {
      const p = PRIO[key];
      if (active) return `background:${p.bg};color:${p.c};border:1.5px solid ${p.border};border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
      return `background:var(--bg4);color:var(--text3);border:1.5px solid var(--border2);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
    }

    let h = `<div class="info-note" style="margin-bottom:12px;background:var(--red-dim);border-color:var(--red-border);color:var(--red)">
      <i class="fas fa-circle-exclamation"></i> Les interventions apparaissent en rouge en haut des checklists du jour concerné, visibles par toute l'équipe.
    </div>
    <div class="tecard" style="margin-bottom:16px;padding:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--red)"><i class="fas fa-plus"></i> Nouvelle intervention</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <input class="fi fi-sm" id="ms-text" placeholder="Description de l'intervention…" maxlength="120">
        <div style="display:flex;gap:6px;flex-wrap:wrap" id="ms-prio-wrap">
          <button type="button" id="ms-prio-btn-urgent" onclick="MX.Pages.Admin._setPrio('urgent')" style="${prioBtnStyle('urgent', false)}"><i class="fas fa-fire"></i> Urgent</button>
          <button type="button" id="ms-prio-btn-normal" onclick="MX.Pages.Admin._setPrio('normal')" style="${prioBtnStyle('normal', true)}"><i class="fas fa-circle-exclamation"></i> Normal</button>
          <button type="button" id="ms-prio-btn-low"    onclick="MX.Pages.Admin._setPrio('low')"    style="${prioBtnStyle('low', false)}"><i class="fas fa-circle-dot"></i> Basse</button>
        </div>
        <input type="hidden" id="ms-prio" value="normal">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select class="fi fi-sm" id="ms-cat" style="flex:1;min-width:130px">
            <option value="autre"><i class="fas fa-ellipsis"></i> Autre</option>
            <option value="panne">Panne</option>
            <option value="securite">Sécurité</option>
            <option value="livraison">Livraison</option>
            <option value="nettoyage">Nettoyage</option>
          </select>
          <input type="time" class="fi fi-sm" id="ms-deadline" placeholder="Heure limite (optionnel)" style="flex:1;min-width:130px">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select class="fi fi-sm" id="ms-day" style="flex:1;min-width:130px">
            <option value="all">Tous les jours</option>
            ${DAYS.map(d => `<option value="${d.id}">${esc(d.l)}</option>`).join('')}
          </select>
          <select class="fi fi-sm" id="ms-user" style="flex:1;min-width:130px">
            <option value="">— Assigner à —</option>
            <option value="all">Tout le monde</option>
            ${users.map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('')}
          </select>
        </div>
        <button class="save-btn" style="margin-top:0" onclick="MX.Pages.Admin.addMission('${esc(createdBy)}')">
          <i class="fas fa-paper-plane"></i> Créer l'intervention
        </button>
      </div>
    </div>`;

    const active = missions.filter(m => !m.done);
    const done   = missions.filter(m =>  m.done);

    if (!missions.length) {
      h += `<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Aucune intervention en cours</div>`;
    }

    if (active.length) {
      h += `<div class="section-label" style="margin-bottom:8px">En cours (${active.length})</div>`;
      active.forEach(m => {
        const day  = m.dayId === "all" ? "Tous les jours" : (DAYS.find(d => d.id === m.dayId)?.l || m.dayId);
        const nc   = m.assignedTo ? MX.userColors(m.assignedTo) : null;
        const prio = PRIO[m.priority] || PRIO.normal;
        const cat  = CAT[m.category]  || CAT.autre;
        const dlSt = _deadlineStatusAdmin(m.deadline || null);

        if (_editMissionId === m.id) {
          // ── Mode édition inline ──
          const eprioBtnStyle = (key, active2) => {
            const p2 = PRIO[key];
            if (active2) return `background:${p2.bg};color:${p2.c};border:1.5px solid ${p2.border};border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
            return `background:var(--bg4);color:var(--text3);border:1.5px solid var(--border2);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
          };
          const curPrio = m.priority || 'normal';
          h += `<div class="mission-adm-card" style="border-left:3px solid ${prio.c};padding:14px">
            <div style="font-size:12px;font-weight:600;margin-bottom:10px;color:var(--cyan)"><i class="fas fa-pen"></i> Modifier l'intervention</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <input class="fi fi-sm" id="edit-ms-text-${esc(m.id)}" value="${esc(m.text)}" maxlength="120">
              <div style="display:flex;gap:6px;flex-wrap:wrap" id="edit-ms-prio-wrap-${esc(m.id)}">
                <button type="button" id="edit-ms-prio-btn-urgent-${esc(m.id)}" onclick="MX.Pages.Admin._setEditPrio('${esc(m.id)}','urgent')" style="${eprioBtnStyle('urgent', curPrio==='urgent')}"><i class="fas fa-fire"></i> Urgent</button>
                <button type="button" id="edit-ms-prio-btn-normal-${esc(m.id)}" onclick="MX.Pages.Admin._setEditPrio('${esc(m.id)}','normal')" style="${eprioBtnStyle('normal', curPrio==='normal')}"><i class="fas fa-circle-exclamation"></i> Normal</button>
                <button type="button" id="edit-ms-prio-btn-low-${esc(m.id)}"    onclick="MX.Pages.Admin._setEditPrio('${esc(m.id)}','low')"    style="${eprioBtnStyle('low',    curPrio==='low'   )}"><i class="fas fa-circle-dot"></i> Basse</button>
              </div>
              <input type="hidden" id="edit-ms-prio-${esc(m.id)}" value="${esc(curPrio)}">
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <select class="fi fi-sm" id="edit-ms-cat-${esc(m.id)}" style="flex:1;min-width:130px">
                  <option value="autre"     ${(m.category||'autre')==='autre'     ?'selected':''}>Autre</option>
                  <option value="panne"     ${(m.category||'')==='panne'     ?'selected':''}>Panne</option>
                  <option value="securite"  ${(m.category||'')==='securite'  ?'selected':''}>Sécurité</option>
                  <option value="livraison" ${(m.category||'')==='livraison' ?'selected':''}>Livraison</option>
                  <option value="nettoyage" ${(m.category||'')==='nettoyage' ?'selected':''}>Nettoyage</option>
                </select>
                <input type="time" class="fi fi-sm" id="edit-ms-deadline-${esc(m.id)}" value="${esc(m.deadline||'')}" style="flex:1;min-width:130px">
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <select class="fi fi-sm" id="edit-ms-day-${esc(m.id)}" style="flex:1;min-width:130px">
                  <option value="all" ${m.dayId==='all'?'selected':''}>Tous les jours</option>
                  ${DAYS.map(d => `<option value="${d.id}" ${m.dayId===d.id?'selected':''}>${esc(d.l)}</option>`).join('')}
                </select>
                <select class="fi fi-sm" id="edit-ms-user-${esc(m.id)}" style="flex:1;min-width:130px">
                  <option value="">— Assigner à —</option>
                  <option value="all" ${m.assignedTo==='all'?'selected':''}>Tout le monde</option>
                  ${users.map(u => `<option value="${esc(u.name)}" ${m.assignedTo===u.name?'selected':''}>${esc(u.name)}</option>`).join('')}
                </select>
              </div>
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="save-btn" style="margin-top:0;flex:1" onclick="MX.Pages.Admin.editMission('${esc(m.id)}')"><i class="fas fa-floppy-disk"></i> Sauvegarder</button>
                <button class="cbtn" style="flex-shrink:0" onclick="MX.Pages.Admin.cancelEditMission()"><i class="fas fa-xmark"></i> Annuler</button>
              </div>
            </div>
          </div>`;
        } else {
          // ── Mode affichage normal ──
          h += `<div class="mission-adm-card" style="border-left:3px solid ${prio.c}">
            <div style="display:flex;align-items:flex-start;gap:10px">
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
                  <span style="background:${prio.bg};color:${prio.c};border:1px solid ${prio.border};padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;font-family:var(--ffm);display:inline-flex;align-items:center;gap:4px"><i class="fas ${prio.ico}"></i> ${prio.l}</span>
                  <span style="background:var(--bg4);color:var(--text2);border:1px solid var(--border2);padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;font-family:var(--ffm);display:inline-flex;align-items:center;gap:4px"><i class="fas ${cat.ico}"></i> ${cat.l}</span>
                  ${dlSt ? `<span class="${dlSt.pulse?'deadline-overdue':''}" style="color:${dlSt.c};font-size:10px;font-weight:600;font-family:var(--ffm);display:inline-flex;align-items:center;gap:3px"><i class="fas fa-clock"></i> ${esc(dlSt.label)}</span>` : ''}
                </div>
                <div style="font-size:13px;font-weight:600">${esc(m.text)}</div>
                <div style="font-size:11px;color:var(--text2);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                  <span style="color:var(--red)"><i class="fas fa-calendar-day"></i> ${esc(day)}</span>
                  ${m.assignedTo === "all" ? `<span style="background:var(--red-border);color:var(--red);padding:1px 7px;border-radius:4px;font-size:10px;font-family:var(--ffm)">Tout le monde</span>` : nc ? `<span style="background:${nc.bg};color:${nc.fg};padding:1px 7px;border-radius:4px;font-size:10px;font-family:var(--ffm)">${esc(m.assignedTo)}</span>` : `<span style="color:var(--text3)">Non assigné</span>`}
                  ${m.createdBy ? `<span style="color:var(--text3)">par ${esc(m.createdBy)}</span>` : ''}
                </div>
              </div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button class="icon-btn" style="width:30px;height:30px" onclick="MX.Pages.Admin.startEditMission('${esc(m.id)}')"><i class="fas fa-pen"></i></button>
                <button class="icon-btn del" style="width:30px;height:30px" onclick="MX.Pages.Admin.delMission('${esc(m.id)}')"><i class="fas fa-trash"></i></button>
              </div>
            </div>
          </div>`;
        }
      });
    }

    if (done.length) {
      h += `<div class="section-label" style="margin-bottom:8px;margin-top:16px;color:var(--text3)">Terminées (${done.length})</div>`;
      done.forEach(m => {
        const day = m.dayId === "all" ? "Tous les jours" : (DAYS.find(d => d.id === m.dayId)?.l || m.dayId);
        h += `<div class="mission-adm-card" style="opacity:0.6">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;text-decoration:line-through">${esc(m.text)}</div>
              <div style="font-size:11px;color:var(--text2);margin-top:3px">
                ${esc(day)} · <i class="fas fa-check" style="color:var(--green)"></i> Terminé${m.completedBy ? ` par <strong>${esc(m.completedBy)}</strong>` : ''}
              </div>
              ${m.completionComment ? `<div style="font-size:11px;color:var(--text2);margin-top:5px;padding:6px 10px;background:var(--bg4);border-radius:6px;border-left:2px solid var(--green-border);font-style:italic">"${esc(m.completionComment)}"</div>` : ''}
            </div>
            <button class="cbtn" onclick="MX.Pages.Admin.undoMission('${esc(m.id)}')"><i class="fas fa-rotate-left"></i></button>
            <button class="icon-btn del" style="width:30px;height:30px" onclick="MX.Pages.Admin.delMission('${esc(m.id)}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
      });
    }
    return h;
  }

  // ── USERS ──
  function renderUsers() {
    const { state, esc } = MX;
    const users = state.users || [];
    const roleLabel = { responsable: "Responsable", technicien: "Technicien" };
    const roleColor = { responsable: "var(--orange)", technicien: "var(--text2)" };
    let h = `<div class="info-note" style="margin-bottom:12px"><i class="fas fa-circle-info"></i> Créez les profils de vos techniciens ici. Chaque utilisateur se connecte avec son PIN depuis l'écran d'accueil.</div>`;

    users.forEach(u => {
      const nc   = MX.userColors(u.name || "?");
      const bg   = u.color || nc.bg;
      const fg   = u.color ? MX._contrastColor(u.color) : nc.fg;
      const role = u.role || "technicien";
      h += `<div class="apcard" style="margin-bottom:8px">
        <div class="aphd">
          <span style="width:38px;height:38px;border-radius:11px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;font-family:var(--ffm);flex-shrink:0${_avBorder(u.name)}">${esc((u.name||'?').substring(0,2).toUpperCase())}</span>
          <span style="font-weight:600;font-size:13px;flex:1;margin-left:10px">${esc(u.name||'—')}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:6px;background:var(--bg4);color:${roleColor[role]||'var(--text2)'};font-family:var(--ffm)">${roleLabel[role]||role}</span>
          <button class="icon-btn del" style="width:30px;height:30px;margin-left:8px" onclick="MX.Pages.Admin.delUser('${esc(u.id)}')"><i class="fas fa-trash"></i></button>
        </div>
        <div class="apgrid" style="grid-template-columns:1fr 1fr;grid-auto-rows:auto">
          <div>
            <div class="aplbl">Nom</div>
            <input class="fi fi-sm" value="${esc(u.name||'')}" oninput="MX.Pages.Admin.updUser('${esc(u.id)}','name',this.value)">
          </div>
          <div>
            <div class="aplbl">Code PIN</div>
            <input class="fi fi-sm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="10"
              placeholder="${/^[0-9a-f]{64}$/.test(u.pin||'') ? 'PIN configuré — saisir pour modifier' : 'ex: 1234'}"
              value="${/^[0-9a-f]{64}$/.test(u.pin||'') ? '' : esc(u.pin||'')}"
              oninput="MX.Pages.Admin.updUser('${esc(u.id)}','pin',this.value)"
              style="font-family:var(--ffm);letter-spacing:4px">
          </div>
          <div>
            <div class="aplbl">Accès (héritage)</div>
            <select class="fi fi-sm" onchange="MX.Pages.Admin.updUser('${esc(u.id)}','role',this.value)">
              <option value="technicien"  ${role==='technicien' ?'selected':''}>Technicien</option>
              <option value="responsable" ${role==='responsable'?'selected':''}>Responsable</option>
            </select>
          </div>
          <div>
            <div class="aplbl">Métier (Rôle)</div>
            <select class="fi fi-sm" onchange="MX.Pages.Admin.updUser('${esc(u.id)}','roleId',this.value)">
              <option value="">— Aucun rôle —</option>
              ${(MX.state.roles||[]).map(r=>`<option value="${esc(r.id)}" ${u.roleId===r.id?'selected':''}>${esc((r.emoji||'')+(r.emoji?' ':'')+r.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="aplbl">Couleur</div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="color" value="${u.color||'#A78BFA'}"
                oninput="MX.Pages.Admin.updUser('${esc(u.id)}','color',this.value)"
                style="width:38px;height:34px;border:1px solid var(--border2);border-radius:8px;background:none;cursor:pointer;padding:2px">
              <span style="font-size:11px;color:var(--text2);font-family:var(--ffm)">${esc(u.color||'auto')}</span>
            </div>
          </div>
        </div>
      </div>`;
    });

    if (!users.length) {
      h += `<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">Aucun profil. Ajoutez vos techniciens.</div>`;
    }
    h += `<div style="margin-bottom:8px"><button class="dash-btn" onclick="MX.Pages.Admin.addUser()"><i class="fas fa-plus"></i> Ajouter un utilisateur</button></div>`;
    h += `<button class="save-btn" onclick="MX.Pages.Admin.saveUsers()"><i class="fas fa-check"></i> Enregistrer les profils</button>`;
    return h;
  }

  // ── ALERTS ──
  function renderAlerts() {
    const { state, SLOTS, esc } = MX;
    let h = `<div class="info-note" style="margin-bottom:12px">
      <i class="fas fa-bell"></i> Les rappels sont envoyés par <strong>notification push</strong> aux techniciens assignés si la checklist n'est pas terminée à la deadline.
      Les appareils doivent avoir accepté les notifications et être inscrits.
    </div>`;
    ["matin","journee","soir"].forEach(sl => {
      const s   = SLOTS[sl];
      const cfg = (state.alerts || {})[sl] || {};
      const dimVar = sl === 'matin' ? 'matin' : sl === 'journee' ? 'jour' : 'soir';
      h += `<div class="acfg">
        <div class="acfg-hd" style="background:var(--${dimVar}-dim)">
          <div class="ch-ico ${s.c}" style="width:32px;height:32px">${s.e}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">${s.l}</div>
            <div style="font-size:11px;color:var(--text3)">${cfg.active ? '🔔 Rappel push actif' : '🔕 Rappel désactivé'}</div>
          </div>
          <button class="tog ${cfg.active?'on':'off'}" onclick="MX.Pages.Admin.togAlert('${sl}')" aria-label="Toggle"></button>
        </div>
        <div class="rfield">
          <label>Heure du rappel</label>
          <input class="ri" type="time" value="${esc(cfg.deadline||'')}" oninput="MX.Pages.Admin.updAlert('${sl}','deadline',this.value)">
        </div>
      </div>`;
    });
    return h;
  }

  // ── ORDERS ──
  function renderOrders() {
    const { state, esc } = MX;
    const prods = state.products || [];
    const lows  = prods.filter(p => parseInt(p.qty||0) < parseInt(p.minQty||0));
    let h = "";
    if (lows.length) {
      h += `<div class="alert-banner danger" style="margin-bottom:12px">
        <div class="dot red"></div>
        <div><div style="font-size:13px;font-weight:600;color:var(--red)">${lows.length} à commander</div>
        ${lows.map(p => `<div style="font-size:12px;color:var(--text2)">${esc(p.id)} — ${esc(p.name)} (${parseInt(p.qty||0)}/${parseInt(p.minQty||0)})</div>`).join('')}</div>
      </div>`;
    }
    prods.forEach(p => {
      const low = parseInt(p.qty||0) < parseInt(p.minQty||0);
      h += `<div class="apcard">
        <div class="aphd">
          <div class="dot ${low?'red':'green'}"></div>
          <span style="font-size:11px;font-family:var(--ffm);color:var(--text3)">${esc(p.id)}</span>
          <span style="font-size:12px;font-weight:600;flex:1;margin-left:6px">${esc(p.name)||'—'}</span>
          <span style="font-size:10px;font-weight:700;color:${low?'var(--red)':'var(--green)'}">${low?'CMD':'OK'}</span>
          <button class="icon-btn del" style="width:30px;height:30px" onclick="MX.Pages.Admin.delProd('${esc(p.id)}')"><i class="fas fa-trash"></i></button>
        </div>
        <div class="apgrid">
          <div><div class="aplbl">Nom</div><input class="fi fi-sm" value="${esc(p.name||'')}" oninput="MX.Pages.Admin.updProd('${esc(p.id)}','name',this.value)"></div>
          <div><div class="aplbl">Référence</div><input class="fi fi-sm" value="${esc(p.ref||'')}" oninput="MX.Pages.Admin.updProd('${esc(p.id)}','ref',this.value)" placeholder="REF-XXX"></div>
          <div><div class="aplbl">Qté min</div><input class="fi fi-sm" type="number" min="0" value="${parseInt(p.minQty||0)}" oninput="MX.Pages.Admin.updProdMin('${esc(p.id)}',this.value)" style="color:var(--orange)"></div>
          <div><div class="aplbl">Qté stock</div><input class="fi fi-sm" type="number" min="0" value="${parseInt(p.qty||0)}" oninput="MX.Pages.Admin.updProd('${esc(p.id)}','qty',this.value)"></div>
        </div>
      </div>`;
    });
    h += `<div style="margin-bottom:8px"><button class="dash-btn" onclick="MX.Pages.Admin.addProd()"><i class="fas fa-plus"></i> Ajouter un produit</button></div>`;
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
        <button class="primary-btn" style="background:var(--bg4);color:var(--text);border:1px solid var(--border2)" onclick="MX.Pages.Admin.generateReport()"><i class="fas fa-print"></i> Rapport semaine (PDF)</button>
        <button class="danger-btn" onclick="MX.Pages.Admin.confirmReset()"><i class="fas fa-rotate-left"></i> Réinitialiser les coches</button>
        <button class="primary-btn" onclick="MX.Pages.Admin.confirmNewWeek()"><i class="fas fa-forward"></i> Lancer une nouvelle semaine</button>
      </div>
    </div>`;
  }

  // ── MESSAGES ──
  function renderMsgs() {
    const { state, esc, fmtTime, avatarBg, avatarFg, avatarTxt } = MX;
    const msgs = state.messages || [];
    if (!msgs.length) return `<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">Aucun message</div>`;
    let h = "";
    msgs.forEach(m => {
      const bg = avatarBg(m.author), fg = avatarFg(m.author);
      h += `<div class="msg-card">
        <div class="msg-hd">
          <div class="msg-av" style="background:${bg};color:${fg}${_avBorder(m.author)}">${esc(avatarTxt(m.author))}</div>
          <div style="flex:1"><div class="msg-author">${esc(m.author)}</div><div class="msg-time">${fmtTime(m.ts)}</div></div>
          <button class="icon-btn del" onclick="MX.Pages.Admin.delMsg('${esc(m.id)}')"><i class="fas fa-trash"></i></button>
        </div>
        <div class="msg-ttl">${esc(m.title)}</div>
        <div class="msg-bdy">${esc(m.body)}</div>
      </div>`;
    });
    return h;
  }

  // ── LOGS ──
  function renderLogs() {
    const { state, esc, fmtTime, avatarBg, avatarFg, avatarTxt } = MX;
    const logs = state.logs || [];
    const aColor = { check: "var(--green)", uncheck: "var(--red)", assign: "var(--cyan)" };
    const aLabel = { check: "✓ Validé", uncheck: "✗ Annulé", assign: "→ Assigné" };

    let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:12px;color:var(--text2);font-family:var(--ffm)">${logs.length} entrées</div>
      <button class="icon-btn del" onclick="MX.Pages.Admin.confirmClearLogs()" style="width:auto;height:auto;padding:4px 12px;font-size:11px;gap:4px">
        <i class="fas fa-trash"></i> Vider
      </button>
    </div>`;
    if (!logs.length) return h + `<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">Aucune activité enregistrée</div>`;
    logs.forEach(log => {
      const bg    = avatarBg(log.workerName || "?");
      const fg    = avatarFg(log.workerName || "?");
      const color = aColor[log.action] || "var(--text2)";
      const label = aLabel[log.action] || log.action;
      h += `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px">
        <div style="width:28px;height:28px;border-radius:8px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;font-family:var(--ffm);flex-shrink:0${_avBorder(log.workerName||'')}">${esc(avatarTxt(log.workerName||'?'))}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(log.workerName||'inconnu')}</div>
          <div style="color:${color};font-family:var(--ffm);font-size:11px">${label}</div>
          <div style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(log.taskText||'')}</div>
          <div style="color:var(--text3);font-size:10px;font-family:var(--ffm)">${esc(log.dayId||'')} ${esc(log.slot||'')}</div>
        </div>
        <div style="color:var(--text3);font-size:11px;white-space:nowrap;flex-shrink:0">${fmtTime(log.ts)}</div>
      </div>`;
    });
    return h;
  }

  // ── PIN ──
  function renderPin() {
    return `<div class="acfg" style="padding:16px">
      <div style="font-size:14px;font-weight:600;margin-bottom:16px">Changer le mot de passe admin</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;line-height:1.5">
        Pour changer le mot de passe, utilisez la console Firebase Authentication :<br>
        <strong style="color:var(--cyan)">console.firebase.google.com</strong><br>
        → Authentication → Utilisateurs → Modifier l'utilisateur
      </div>
      <div class="info-note"><i class="fas fa-circle-info"></i> Le mot de passe est géré de façon sécurisée par Firebase Auth.</div>
    </div>`;
  }

  // ── ACTIONS ──
  function setTab(t) { aTab = t; render(); }
  function setDay(d) { aDay = d; render(); }

  function editTask(dayId, sl, taskId, val) {
    const t = (MX.state.tasks[`${dayId}_${sl}`] || []).find(x => x.id === taskId);
    if (t) t.text = val;
    _sched(`tasks_${dayId}_${sl}`, () => _autoSaveSlot(dayId, sl));
  }
  function addTask(dayId, sl) {
    const tasks = MX.state.tasks[`${dayId}_${sl}`] || [];
    tasks.push({ id: MX.uuid(), text: "", order: tasks.length });
    MX.state.tasks[`${dayId}_${sl}`] = tasks;
    render();
  }
  function rmTask(dayId, sl, taskId) {
    MX.state.tasks[`${dayId}_${sl}`] = (MX.state.tasks[`${dayId}_${sl}`] || []).filter(t => t.id !== taskId);
    render();
    _autoSaveSlot(dayId, sl);
  }
  async function _autoSaveSlot(dayId, sl) {
    MX.syncStart && MX.syncStart();
    try {
      const items = MX.state.tasks[`${dayId}_${sl}`] || [];
      await MX.DB.setTasks(dayId, sl, items.map((t, i) => ({ ...t, order: i })));
      MX.syncEnd && MX.syncEnd();
    } catch(e) { MX.syncFail && MX.syncFail(); }
  }
  async function saveTasks() {
    const { DAYS, getDaySlots } = MX;
    const slots = getDaySlots(aDay);
    for (const sl of slots) { await _autoSaveSlot(aDay, sl); }
  }
  async function copyTasks() {
    const from = (document.getElementById("cpfrom") || {}).value;
    if (!from) return;
    MX.getDaySlots(aDay).forEach(sl => {
      MX.state.tasks[`${aDay}_${sl}`] = (MX.state.tasks[`${from}_${sl}`] || []).map(t => ({ ...t, id: MX.uuid() }));
    });
    render();
    MX.toast("Copié ✓");
  }

  function editTeam(sl, i, val) {
    (MX.state.teams[sl] || [])[i] = val;
    _sched('team', _autoSaveTeam);
  }
  function addTeam(sl) { (MX.state.teams[sl] = MX.state.teams[sl] || []).push(""); render(); }
  function rmTeam(sl, i) { (MX.state.teams[sl] || []).splice(i, 1); render(); _autoSaveTeam(); }
  async function _autoSaveTeam() {
    MX.syncStart && MX.syncStart();
    try { await MX.DB.saveTeams(MX.state.teams); MX.syncEnd && MX.syncEnd(); }
    catch(e) { MX.syncFail && MX.syncFail(); }
  }
  async function saveTeam() { await _autoSaveTeam(); }

  async function addMission(createdBy) {
    const text       = (document.getElementById("ms-text")     || {}).value?.trim() || "";
    const dayId      = (document.getElementById("ms-day")      || {}).value || "all";
    const assignedTo = (document.getElementById("ms-user")     || {}).value || "";
    const priority   = (document.getElementById("ms-prio")     || {}).value || "normal";
    const category   = (document.getElementById("ms-cat")      || {}).value || "autre";
    const deadline   = (document.getElementById("ms-deadline") || {}).value || null;
    if (!text) return MX.toast("Entrez une description d'intervention", true);
    if (deadline && !/^\d{1,2}:\d{2}$/.test(deadline)) return MX.toast("Heure limite invalide (format HH:MM)", true);
    try {
      await MX.DB.addMission({ text, dayId, assignedTo, priority, category, deadline: deadline || null, createdBy: createdBy || "Responsable" });
      MX.toast("Intervention créée ✓");
    } catch(e) { MX.toast("Erreur", true); }
  }

  async function editMission(id) {
    const text       = (document.getElementById(`edit-ms-text-${id}`)     || {}).value?.trim() || "";
    const dayId      = (document.getElementById(`edit-ms-day-${id}`)      || {}).value || "all";
    const assignedTo = (document.getElementById(`edit-ms-user-${id}`)     || {}).value || "";
    const priority   = (document.getElementById(`edit-ms-prio-${id}`)     || {}).value || "normal";
    const category   = (document.getElementById(`edit-ms-cat-${id}`)      || {}).value || "autre";
    const deadline   = (document.getElementById(`edit-ms-deadline-${id}`) || {}).value || null;
    if (!text) return MX.toast("Entrez une description d'intervention", true);
    if (deadline && !/^\d{1,2}:\d{2}$/.test(deadline)) return MX.toast("Heure limite invalide (format HH:MM)", true);
    try {
      await MX.DB.updateMission(id, { text, dayId, assignedTo, priority, category, deadline: deadline || null });
      _editMissionId = null;
      MX.toast("Intervention modifiée ✓");
    } catch(e) { MX.toast("Erreur", true); }
  }

  function startEditMission(id) {
    _editMissionId = id;
    MX.Pages.Admin.setTab('missions');
  }

  function cancelEditMission() {
    _editMissionId = null;
    MX.Pages.Admin.setTab('missions');
  }

  function _setPrio(val) {
    const hidden = document.getElementById("ms-prio");
    if (hidden) hidden.value = val;
    ['urgent','normal','low'].forEach(key => {
      const btn = document.getElementById(`ms-prio-btn-${key}`);
      if (!btn) return;
      const p = PRIO[key];
      if (key === val) {
        btn.style.cssText = `background:${p.bg};color:${p.c};border:1.5px solid ${p.border};border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
      } else {
        btn.style.cssText = `background:var(--bg4);color:var(--text3);border:1.5px solid var(--border2);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
      }
    });
  }

  function _setEditPrio(missionId, val) {
    const hidden = document.getElementById(`edit-ms-prio-${missionId}`);
    if (hidden) hidden.value = val;
    ['urgent','normal','low'].forEach(key => {
      const btn = document.getElementById(`edit-ms-prio-btn-${key}-${missionId}`);
      if (!btn) return;
      const p = PRIO[key];
      if (key === val) {
        btn.style.cssText = `background:${p.bg};color:${p.c};border:1.5px solid ${p.border};border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
      } else {
        btn.style.cssText = `background:var(--bg4);color:var(--text3);border:1.5px solid var(--border2);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--ffs);display:inline-flex;align-items:center;gap:5px`;
      }
    });
  }
  async function delMission(id) {
    MX.showModal("Supprimer cette intervention ?", "L'intervention disparaîtra de tous les panneaux.", [
      { label: "Supprimer", cls: "danger", fn: async () => {
        try { await MX.DB.deleteMission(id); MX.toast("Intervention supprimée ✓"); }
        catch(e) { MX.toast("Erreur", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }
  async function undoMission(id) {
    try { await MX.DB.updateMission(id, { done: false }); MX.toast("Intervention réactivée ✓"); }
    catch(e) { MX.toast("Erreur", true); }
  }

  function updUser(id, f, v) {
    const u = (MX.state.users || []).find(x => x.id === id);
    if (u) u[f] = v;
  }
  function addUser() {
    MX.DB.addUser({ name: "Nouveau", role: "technicien" })
      .then(() => MX.toast("Utilisateur ajouté ✓"))
      .catch(() => MX.toast("Erreur", true));
  }
  function delUser(id) {
    MX.showModal("Supprimer cet utilisateur ?", "Cette action est irréversible.", [
      { label: "Supprimer", cls: "danger", fn: async () => {
        try { await MX.DB.deleteUser(id); MX.toast("Supprimé ✓"); }
        catch (e) { MX.toast("Erreur", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }
  async function saveUsers() {
    try {
      for (const u of (MX.state.users || [])) {
        let pin = u.pin || '';
        // Hash if it's a new plain-text PIN (not already a SHA-256 hex)
        if (pin && !/^[0-9a-f]{64}$/.test(pin)) {
          pin = await MX.hashPin(pin);
        }
        await MX.DB.updateUser(u.id, { name: u.name||"", role: u.role||"technicien", pin, color: u.color||"" });
      }
      MX.toast("Profils enregistrés ✓");
    } catch (e) { MX.toast("Erreur", true); }
  }

  function togAlert(sl) {
    if (!MX.state.alerts[sl]) MX.state.alerts[sl] = {};
    MX.state.alerts[sl].active = !MX.state.alerts[sl].active;
    render();
    _autoSaveAlerts();
  }
  function updAlert(sl, f, v) {
    if (!MX.state.alerts[sl]) MX.state.alerts[sl] = {};
    MX.state.alerts[sl][f] = v;
    _sched('alerts', _autoSaveAlerts);
  }
  async function _autoSaveAlerts() {
    MX.syncStart && MX.syncStart();
    try { await MX.DB.saveAlerts(MX.state.alerts); MX.syncEnd && MX.syncEnd(); }
    catch(e) { MX.syncFail && MX.syncFail(); }
  }
  async function saveAlerts() { await _autoSaveAlerts(); }

  function updProd(id, f, v) {
    const p = (MX.state.products||[]).find(x=>x.id===id); if(p) p[f]=v;
    _sched('prod_' + id, () => _autoSaveProd(id));
  }
  function updProdMin(id, v) {
    const p = (MX.state.products||[]).find(x=>x.id===id); if(p) p.minQty=parseInt(v)||0;
    _sched('prod_' + id, () => _autoSaveProd(id));
  }
  async function _autoSaveProd(id) {
    const p = (MX.state.products||[]).find(x=>x.id===id);
    if (!p) return;
    MX.syncStart && MX.syncStart();
    try {
      await MX.DB.updateProduct(p.id, { name:p.name,ref:p.ref,qty:parseInt(p.qty||0),minQty:parseInt(p.minQty||0),controller:p.controller||"" });
      MX.syncEnd && MX.syncEnd();
    } catch(e) { MX.syncFail && MX.syncFail(); }
  }
  async function addProd() {
    try { await MX.DB.addProduct({ name:"", ref:"", qty:0, minQty:0, controller:"" }); MX.toast("Produit ajouté ✓"); }
    catch(e) { MX.toast("Erreur",true); }
  }
  async function delProd(id) {
    MX.showModal("Supprimer ce produit ?","Cette action est irréversible.",[
      { label:"Supprimer", cls:"danger", fn: async()=>{ try{ await MX.DB.deleteProduct(id); MX.toast("Supprimé ✓"); }catch(e){ MX.toast("Erreur",true); } } },
      { label:"Annuler", cls:"cancel" }
    ]);
  }
  async function saveProd() {
    for (const p of (MX.state.products||[])) { await _autoSaveProd(p.id); }
  }

  async function delMsg(id) {
    MX.showModal("Supprimer ce message ?","", [
      { label:"Supprimer", cls:"danger", fn: async()=>{ try{ await MX.DB.deleteMessage(id); MX.toast("Supprimé ✓"); }catch(e){ MX.toast("Erreur",true); } } },
      { label:"Annuler", cls:"cancel" }
    ]);
  }

  function confirmClearLogs() {
    MX.showModal("Vider l'historique ?", "Toutes les entrées d'activité seront supprimées.", [
      { label:"Vider", cls:"danger", fn: async()=>{
        try { await MX.DB.clearLogs(); MX.toast("Historique vidé ✓"); }
        catch(e) { MX.toast("Erreur",true); }
      }},
      { label:"Annuler", cls:"cancel" }
    ]);
  }

  function confirmReset() {
    MX.showModal("Réinitialiser ?","Toutes les cases remises à zéro. Tâches conservées.",[
      { label:"Réinitialiser", cls:"danger", fn: async()=>{ try{ await MX.DB.resetChecks(); MX.state.checks={}; MX.toast("Réinitialisé ✓"); }catch(e){ MX.toast("Erreur",true); } } },
      { label:"Annuler", cls:"cancel" }
    ]);
  }
  function _buildWeekStats() {
    const { DAYS, getDaySlots, state } = MX;
    let totalAll = 0, doneAll = 0;
    const days = {};
    DAYS.forEach(d => {
      let dTotal = 0, dDone = 0;
      getDaySlots(d.id).forEach(sl => {
        (state.tasks[`${d.id}_${sl}`] || []).forEach(t => {
          dTotal++;
          if (state.checks[`${d.id}_${sl}_${t.id}`]) dDone++;
        });
      });
      totalAll += dTotal;
      doneAll  += dDone;
      days[d.id] = { label: d.l, total: dTotal, done: dDone, pct: dTotal ? Math.round(dDone / dTotal * 100) : 0 };
    });
    return { totalTasks: totalAll, doneTasks: doneAll, pct: totalAll ? Math.round(doneAll / totalAll * 100) : 0, days };
  }

  function confirmNewWeek() {
    const cur = MX.state.weekNum || 1;
    MX.showModal("Nouvelle semaine ?","La semaine courante sera archivée. Coches remises à zéro. Tâches et équipe conservées.",[
      { label:"Lancer", cls:"confirm", fn: async()=>{
        try {
          const stats = _buildWeekStats();
          await MX.DB.archiveWeek({ weekLabel: MX.state.weekLabel, weekNum: cur, ...stats });
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

  // ── ADMIN JOURNAL HELPER ──
  async function _logAdminAction(action) {
    try { await MX.DB.addAdminJournal({ action }); } catch(e) { /* silent */ }
  }

  // ── BIBLE ADMIN ──
  async function _loadBibleAdminData() {
    try {
      const [articles, perms] = await Promise.all([
        MX.DB.getRecentBibleArticles(),
        MX.DB.getBiblePermissions()
      ]);
      const s = { total: 0, published: 0, pending: 0, draft: 0, archived: 0, pendingList: [] };
      articles.forEach(a => {
        s.total++;
        if      (a.status === 'published') s.published++;
        else if (a.status === 'pending')  { s.pending++; s.pendingList.push(a); }
        else if (a.status === 'draft')     s.draft++;
        else if (a.status === 'archived')  s.archived++;
      });
      _bibleStats = s;
      _biblePerms = Object.keys(perms).length ? perms : JSON.parse(JSON.stringify(BIBLE_PERM_D));
    } catch(e) {
      _bibleStats = { total: 0, published: 0, pending: 0, draft: 0, archived: 0, pendingList: [] };
      _biblePerms = JSON.parse(JSON.stringify(BIBLE_PERM_D));
    }
    render();
  }

  function renderBibleAdmin() {
    const { esc } = MX;
    if (!_bibleStats || _biblePerms === null) {
      _loadBibleAdminData();
      return `<div style="text-align:center;padding:40px;color:var(--text3)">
        <i class="fas fa-circle-notch fa-spin" style="font-size:24px;color:var(--cyan)"></i>
        <div style="margin-top:12px;font-size:13px">Chargement des données Bible…</div>
      </div>`;
    }

    let h = `<div class="ba-kpi-row">
      <div class="apcard ba-kpi"><div class="ba-kpi-val" style="color:var(--cyan)">${_bibleStats.total}</div><div class="ba-kpi-lbl">Articles</div></div>
      <div class="apcard ba-kpi"><div class="ba-kpi-val" style="color:var(--green)">${_bibleStats.published}</div><div class="ba-kpi-lbl">Publiés</div></div>
      <div class="apcard ba-kpi"><div class="ba-kpi-val" style="color:${_bibleStats.pending>0?'var(--orange)':'var(--text3)'}">${_bibleStats.pending}</div><div class="ba-kpi-lbl">En attente</div></div>
      <div class="apcard ba-kpi"><div class="ba-kpi-val" style="color:var(--text3)">${_bibleStats.draft}</div><div class="ba-kpi-lbl">Brouillons</div></div>
    </div>`;

    if (_bibleStats.pendingList.length) {
      h += `<div class="section-label" style="margin:16px 0 8px">⏳ En attente de validation (${_bibleStats.pendingList.length})</div>`;
      _bibleStats.pendingList.forEach(a => {
        h += `<div class="apcard" style="margin-bottom:8px"><div class="aphd" style="padding:12px 14px;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title||'—')}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">par ${esc(a.author||'?')} · ${esc(a.categoryId||'')}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="save-btn" style="padding:4px 10px;font-size:11px;margin:0" onclick="MX.Pages.Admin.biblePublish('${esc(a.id)}','${esc(a.title||'')}')"><i class="fas fa-check"></i> Publier</button>
            <button class="icon-btn del" title="Rejeter" onclick="MX.Pages.Admin.bibleReject('${esc(a.id)}','${esc(a.title||'')}')"><i class="fas fa-xmark"></i></button>
          </div>
        </div></div>`;
      });
    }

    h += `<div class="section-label" style="margin:20px 0 8px">🔒 Droits d'accès par rôle</div>
    <div class="apcard" style="overflow-x:auto;margin-bottom:12px">
      <table class="ba-perm-table">
        <thead><tr><th>Rôle</th>${BIBLE_PERM_L.map(p => `<th>${p}</th>`).join('')}</tr></thead>
        <tbody>${BIBLE_ROLES.map(role => `<tr>
          <td class="ba-perm-role">${role}</td>
          ${BIBLE_PERM_L.map((p, pi) => {
            const chk = Array.isArray(_biblePerms[role]) ? !!_biblePerms[role][pi] : !!BIBLE_PERM_D[role][pi];
            return `<td style="text-align:center"><input type="checkbox" class="ba-perm-cb" id="bperm_${role}_${pi}" ${chk?'checked':''}></td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="save-btn" onclick="MX.Pages.Admin.bibleSavePerms()"><i class="fas fa-floppy-disk"></i> Sauvegarder les droits</button>
      <button class="dash-btn" onclick="MX.Pages.Admin.bibleRefreshStats()"><i class="fas fa-rotate"></i> Actualiser</button>
    </div>`;
    return h;
  }

  async function biblePublish(id, title) {
    try {
      await MX.DB.updateBibleArticle(id, { status: 'published', publishedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await _logAdminAction(`Publication de l'article Bible : "${title}"`);
      _bibleStats = null; render();
      MX.toast('Article publié ✓');
    } catch(e) { MX.toast('Erreur', true); }
  }

  async function bibleReject(id, title) {
    MX.showModal('Rejeter cet article ?', 'L\'article repassera en brouillon.', [
      { label: 'Rejeter', cls: 'danger', fn: async () => {
        try {
          await MX.DB.updateBibleArticle(id, { status: 'draft' });
          await _logAdminAction(`Rejet de l'article Bible : "${title}"`);
          _bibleStats = null; render();
          MX.toast('Article rejeté');
        } catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  async function bibleSavePerms() {
    const perms = {};
    BIBLE_ROLES.forEach(role => {
      perms[role] = BIBLE_PERM_L.map((p, pi) => {
        const cb = document.getElementById(`bperm_${role}_${pi}`);
        return cb ? cb.checked : false;
      });
    });
    try {
      await MX.DB.setBiblePermissions(perms);
      _biblePerms = perms;
      await _logAdminAction('Mise à jour des droits d\'accès Bible');
      MX.toast('Droits sauvegardés ✓');
    } catch(e) { MX.toast('Erreur', true); }
  }

  function bibleRefreshStats() { _bibleStats = null; _biblePerms = null; render(); }

  // ── BADGES ADMIN ──
  function renderBadgesAdmin() {
    const { state, esc, avatarBg, avatarFg } = MX;
    const badges     = state.badges     || [];
    const userBadges = state.userBadges || {};
    const users      = state.users      || [];

    const MODE_L = { manual: 'Manuel', auto: 'Automatique', role: 'Par rôle' };
    const MODE_C = { manual: 'var(--cyan)', auto: 'var(--green)', role: 'var(--orange)' };

    let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--text2)">${badges.length} badge${badges.length!==1?'s':''} configuré${badges.length!==1?'s':''}</div>
      <button class="save-btn" style="margin:0" onclick="MX.Pages.Admin.badgeOpenCreate()">
        <i class="fas fa-plus"></i> Nouveau badge
      </button>
    </div>`;

    if (!badges.length) {
      h += `<div style="text-align:center;padding:40px 20px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">🏅</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Aucun badge configuré</div>
        <div style="font-size:13px;line-height:1.5">Créez des badges professionnels pour valoriser votre équipe.</div>
      </div>`;
      return h;
    }

    badges.forEach(b => {
      const assignedNames = Object.entries(userBadges)
        .filter(([, ubs]) => ubs.some(ub => ub.badgeId === b.id))
        .map(([name]) => name);

      h += `<div class="apcard" style="margin-bottom:8px">
        <div class="aphd" style="padding:12px 14px;gap:10px">
          <div class="bdg-icon" style="width:44px;height:44px;border-radius:13px;background:${b.color}22;border:2px solid ${b.border||b.color};font-size:26px">${b.icon||'🏅'}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-size:13px;font-weight:700">${esc(b.name)}</span>
              <span style="font-size:10px;padding:1px 7px;border-radius:6px;background:${MODE_C[b.mode]||'var(--cyan)'}22;color:${MODE_C[b.mode]||'var(--cyan)'};border:1px solid ${MODE_C[b.mode]||'var(--cyan)'}44">${MODE_L[b.mode]||b.mode}</span>
              ${!b.active ? '<span style="font-size:10px;padding:1px 7px;border-radius:6px;background:var(--bg4);color:var(--text3)">Inactif</span>' : ''}
            </div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(b.desc||'')}</div>
            ${assignedNames.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
              ${assignedNames.map(n => {
                const ubEntry = (userBadges[n]||[]).find(ub => ub.badgeId === b.id);
                return `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg4);color:var(--text2);display:flex;align-items:center;gap:4px">
                  ${esc(n)}
                  <button onclick="MX.Pages.Admin.badgeRemoveFrom('${esc(ubEntry?ubEntry.id:'')}','${esc(n)}','${esc(b.name)}')" style="background:none;border:none;color:var(--red);cursor:pointer;padding:0;font-size:10px;line-height:1" title="Retirer"><i class="fas fa-times"></i></button>
                </span>`;
              }).join('')}
            </div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
            <button class="tog ${b.active?'on':'off'}" onclick="MX.Pages.Admin.badgeToggleActive('${esc(b.id)}')" aria-label="Actif"></button>
            <div style="display:flex;gap:4px">
              <button class="icon-btn" onclick="MX.Pages.Admin.badgeAssign('${esc(b.id)}','${esc(b.name)}')" title="Attribuer"><i class="fas fa-user-plus"></i></button>
              <button class="icon-btn" onclick="MX.Pages.Admin.badgeOpenEdit('${esc(b.id)}')" title="Modifier"><i class="fas fa-pen"></i></button>
              <button class="icon-btn del" onclick="MX.Pages.Admin.badgeDelete('${esc(b.id)}','${esc(b.name)}')" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
      </div>`;
    });

    return h;
  }

  function _badgeFormHtml(b) {
    const { esc } = MX;
    b = b || {};
    return `<div style="display:flex;flex-direction:column;gap:10px">
      <div class="apgrid">
        <div>
          <div class="aplbl">Icône (emoji)</div>
          <input class="fi fi-sm" id="bdg-icon" value="${esc(b.icon||'🏅')}" maxlength="4" style="font-size:26px;text-align:center;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;line-height:1">
        </div>
        <div>
          <div class="aplbl">Couleur</div>
          <input class="fi fi-sm" id="bdg-color" type="color" value="${b.color||'#6366F1'}">
        </div>
      </div>
      <div>
        <div class="aplbl">Nom du badge</div>
        <input class="fi fi-sm" id="bdg-name" value="${esc(b.name||'')}" placeholder="Ex: Expert Plomberie" maxlength="40">
      </div>
      <div>
        <div class="aplbl">Description</div>
        <input class="fi fi-sm" id="bdg-desc" value="${esc(b.desc||'')}" placeholder="Brève description…" maxlength="80">
      </div>
      <div>
        <div class="aplbl">Mode d'obtention</div>
        <select class="fi fi-sm" id="bdg-mode" onchange="MX.Pages.Admin._bdgModeChange(this.value)">
          <option value="manual"  ${(b.mode||'manual')==='manual' ?'selected':''}>Manuel (par un admin)</option>
          <option value="auto"    ${b.mode==='auto'   ?'selected':''}>Automatique (critères)</option>
          <option value="role"    ${b.mode==='role'   ?'selected':''}>Par rôle (Resp./Admin)</option>
        </select>
      </div>
      <div id="bdg-auto-fields" style="display:${b.mode==='auto'?'flex':'none'};flex-direction:column;gap:10px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px">
        <div>
          <div class="aplbl">🎯 Déclencheur</div>
          <select class="fi fi-sm" id="bdg-trigger">
            <option value="interventions_done"     ${(b.autoTrigger||'')==='interventions_done'    ?'selected':''}>Interventions terminées</option>
            <option value="interventions_created"  ${(b.autoTrigger||'')==='interventions_created' ?'selected':''}>Interventions créées</option>
            <option value="checklist_tasks"        ${(b.autoTrigger||'')==='checklist_tasks'       ?'selected':''}>Tâches check-list terminées</option>
            <option value="checklist_transfers"    ${(b.autoTrigger||'')==='checklist_transfers'   ?'selected':''}>Tâches transférées</option>
            <option value="bible_created"          ${(b.autoTrigger||'')==='bible_created'         ?'selected':''}>Documents Bible créés</option>
            <option value="bible_modified"         ${(b.autoTrigger||'')==='bible_modified'        ?'selected':''}>Documents Bible modifiés</option>
            <option value="stock_products"         ${(b.autoTrigger||'')==='stock_products'        ?'selected':''}>Produits ajoutés</option>
            <option value="stock_movements"        ${(b.autoTrigger||'')==='stock_movements'       ?'selected':''}>Mouvements de stock</option>
            <option value="cso_readings"           ${(b.autoTrigger||'')==='cso_readings'          ?'selected':''}>Relevés de compteurs réalisés</option>
            <option value="messages_published"     ${(b.autoTrigger||'')==='messages_published'    ?'selected':''}>Messages publiés</option>
            <option value="seniority"              ${(b.autoTrigger||'')==='seniority'             ?'selected':''}>Ancienneté utilisateur</option>
            <option value="login"                  ${(b.autoTrigger||'')==='login'                 ?'selected':''}>Connexion à l'application</option>
            <option value="badges_obtained"        ${(b.autoTrigger||'')==='badges_obtained'       ?'selected':''}>Badges obtenus</option>
          </select>
        </div>
        <div>
          <div class="aplbl">📊 Quantité requise</div>
          <input class="fi fi-sm" id="bdg-qty" type="number" min="1" value="${b.autoQty||1}" placeholder="Ex: 10">
        </div>
        <div>
          <div class="aplbl">📝 Condition (description)</div>
          <input class="fi fi-sm" id="bdg-cond" value="${esc(b.autoCond||'')}" placeholder="Ex: Atteindre 10 interventions terminées" maxlength="100">
        </div>
      </div>
      <div>
        <div class="aplbl">Priorité d'affichage (1 = plus important)</div>
        <input class="fi fi-sm" id="bdg-prio" type="number" min="1" max="99" value="${b.priority||99}">
      </div>
    </div>`;
  }

  function badgeOpenCreate() {
    _badgeModal = null;
    MX.showModal({ title: 'Nouveau badge', body: _badgeFormHtml(null),
      actions: [
        { label: 'Créer', cls: 'primary', fn: badgeSaveCreate },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  function badgeOpenEdit(badgeId) {
    const badge = (MX.state.badges||[]).find(b => b.id === badgeId);
    if (!badge) return;
    _badgeModal = badgeId;
    MX.showModal({ title: 'Modifier le badge', body: _badgeFormHtml(badge),
      actions: [
        { label: 'Enregistrer', cls: 'primary', fn: badgeSaveEdit },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  function _bdgModeChange(val) {
    const panel = document.getElementById('bdg-auto-fields');
    if (panel) panel.style.display = val === 'auto' ? 'flex' : 'none';
  }

  function _collectBadgeForm() {
    const icon        = (document.getElementById('bdg-icon')   ||{}).value || '🏅';
    const color       = (document.getElementById('bdg-color')  ||{}).value || '#6366F1';
    const name        = ((document.getElementById('bdg-name')  ||{}).value || '').trim();
    const desc        = ((document.getElementById('bdg-desc')  ||{}).value || '').trim();
    const mode        = (document.getElementById('bdg-mode')   ||{}).value || 'manual';
    const prio        = parseInt((document.getElementById('bdg-prio') ||{}).value||'99',10);
    const autoTrigger = (document.getElementById('bdg-trigger')||{}).value || '';
    const autoQty     = parseInt((document.getElementById('bdg-qty')  ||{}).value||'1', 10);
    const autoCond    = ((document.getElementById('bdg-cond')  ||{}).value || '').trim();
    return { icon, color, border: color, name, desc, mode, priority: prio, active: true,
             ...(mode === 'auto' ? { autoTrigger, autoQty, autoCond } : {}) };
  }

  async function badgeSaveCreate() {
    const data = _collectBadgeForm();
    if (!data.name) return MX.toast('Nom requis', true);
    try {
      await MX.DB.addBadge(data);
      await _logAdminAction('Création du badge : ' + data.name);
      MX.toast('Badge créé ✓');
    } catch(e) { MX.toast('Erreur', true); }
  }

  async function badgeSaveEdit() {
    if (!_badgeModal) return;
    const data = _collectBadgeForm();
    if (!data.name) return MX.toast('Nom requis', true);
    try {
      await MX.DB.updateBadge(_badgeModal, data);
      await _logAdminAction('Modification du badge : ' + data.name);
      MX.toast('Badge mis à jour ✓');
    } catch(e) { MX.toast('Erreur', true); }
  }

  async function badgeToggleActive(badgeId) {
    const badge = (MX.state.badges||[]).find(b => b.id === badgeId);
    if (!badge) return;
    try {
      await MX.DB.updateBadge(badgeId, { active: !badge.active });
    } catch(e) { MX.toast('Erreur', true); }
  }

  function badgeDelete(badgeId, badgeName) {
    MX.showModal(`Supprimer "${badgeName}" ?`, 'Le badge sera retiré à tous les utilisateurs.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try {
          await MX.DB.deleteBadge(badgeId);
          await _logAdminAction('Suppression du badge : ' + badgeName);
          MX.toast('Badge supprimé ✓');
        } catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function badgeAssign(badgeId, badgeName) {
    const { state, esc, avatarBg, avatarFg } = MX;
    const users      = state.users || [];
    const userBadges = state.userBadges || {};
    const assigned   = Object.entries(userBadges)
      .filter(([, ubs]) => ubs.some(ub => ub.badgeId === badgeId))
      .map(([name]) => name);
    const available  = users.filter(u => !assigned.includes(u.name));

    if (!available.length) {
      return MX.toast('Tous les utilisateurs ont déjà ce badge', true);
    }

    const actor = MX.Auth.isAdmin()
      ? ((state.adminUser||{}).email || 'Admin')
      : ((state.currentUser||{}).name || 'Responsable');

    window._bdgCtx = { badgeId, badgeName, actor };

    const rows = available.map(u => {
      const bg   = avatarBg(u.name);
      const fg   = avatarFg(u.name);
      const init = (u.name||'?').slice(0,2).toUpperCase();
      const role = u.role || 'technicien';
      return `<label class="bdg-usr-row" data-uname="${esc(u.name)}" style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;border:1.5px solid var(--border);background:var(--bg3);transition:border-color .15s">
        <input type="checkbox" value="${esc(u.name)}" onchange="MX.Pages.Admin._bdgUpdCount()" style="width:17px;height:17px;accent-color:var(--cyan);flex-shrink:0;cursor:pointer">
        <div style="width:34px;height:34px;border-radius:10px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0${_avBorder(u.name)}">${esc(init)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name)}</div>
          <div style="font-size:11px;color:var(--text2);text-transform:capitalize">${esc(role)}</div>
        </div>
      </label>`;
    }).join('');

    const bodyHtml = `
      <input class="fi fi-sm" id="bdg-search" placeholder="Rechercher un membre…"
        oninput="MX.Pages.Admin._bdgSearch(this.value)"
        style="width:100%;box-sizing:border-box;margin-bottom:10px">
      <div id="bdg-ul" style="display:flex;flex-direction:column;gap:6px;max-height:270px;overflow-y:auto">${rows}</div>
      <div id="bdg-count" style="font-size:12px;color:var(--text2);margin-top:10px;text-align:center">Aucun membre sélectionné</div>`;

    MX.showModal({
      title: 'Attribuer : ' + badgeName,
      body: bodyHtml,
      actions: [
        { label: 'Attribuer', cls: 'primary', fn: _bdgDoMultiAssign },
        { label: 'Annuler',   cls: 'cancel' }
      ]
    });
  }

  function _bdgSearch(q) {
    const rows = document.querySelectorAll('.bdg-usr-row');
    const lower = (q || '').toLowerCase().trim();
    rows.forEach(row => {
      const name = (row.dataset.uname || '').toLowerCase();
      row.style.display = (!lower || name.includes(lower)) ? '' : 'none';
    });
  }

  function _bdgUpdCount() {
    const checked = document.querySelectorAll('#bdg-ul input[type=checkbox]:checked').length;
    const el = document.getElementById('bdg-count');
    if (el) el.textContent = checked
      ? checked + ' membre' + (checked > 1 ? 's' : '') + ' sélectionné' + (checked > 1 ? 's' : '')
      : 'Aucun membre sélectionné';
  }

  async function _bdgDoMultiAssign() {
    const ctx = window._bdgCtx;
    if (!ctx) return;
    const checked = [...document.querySelectorAll('#bdg-ul input[type=checkbox]:checked')];
    const names   = checked.map(c => c.value).filter(Boolean);
    if (!names.length) { MX.toast('Sélectionnez au moins un membre', true); return; }
    try {
      for (const userName of names) {
        await MX.DB.assignBadge(ctx.badgeId, userName, ctx.badgeName, ctx.actor);
      }
      await _logAdminAction(`Attribution du badge "${ctx.badgeName}" à : ${names.join(', ')}`);
      const msg = names.length === 1
        ? `Badge attribué à ${names[0]} ✓`
        : `Badge attribué à ${names.length} membres ✓`;
      MX.toast(msg);
      window._bdgCtx = null;
    } catch(e) { MX.toast('Erreur lors de l\'attribution', true); }
  }

  async function badgeRemoveFrom(userBadgeId, userName, badgeName) {
    MX.showModal(`Retirer "${badgeName}" à ${userName} ?`, '', [
      { label: 'Retirer', cls: 'danger', fn: async () => {
        try {
          await MX.DB.removeUserBadge(userBadgeId);
          await _logAdminAction(`Retrait du badge "${badgeName}" à ${userName}`);
          MX.toast('Badge retiré ✓');
        } catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── ADMIN JOURNAL ──
  function renderAdminJournal() {
    const { esc } = MX;
    const entries = _adminJournal;

    let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:12px;color:var(--text2);font-family:var(--ffm)">${entries.length} entrée${entries.length!==1?'s':''}</div>
      ${entries.length ? `<button class="icon-btn del" onclick="MX.Pages.Admin.clearJournal()" style="width:auto;height:auto;padding:4px 12px;font-size:11px;gap:4px"><i class="fas fa-trash"></i> Vider</button>` : ''}
    </div>`;

    if (!entries.length) {
      return h + `<div style="text-align:center;padding:40px 20px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📓</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Aucune action enregistrée</div>
        <div style="font-size:13px;line-height:1.5">Les actions sur Bible, Jeux et Joueurs apparaîtront ici.</div>
      </div>`;
    }

    entries.forEach(e => {
      const ts      = e.ts ? (e.ts.toDate ? e.ts.toDate() : new Date(e.ts)) : null;
      const dateStr = ts ? ts.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' }) : '–';
      const timeStr = ts ? ts.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) : '–';
      const bg      = MX.avatarBg(e.user||'?');
      const fg      = MX.avatarFg(e.user||'?');
      const init    = (e.user||'?').slice(0,2).toUpperCase();
      h += `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="width:30px;height:30px;border-radius:8px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0${_avBorder(e.user||'')}">${esc(init)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600">${esc(e.user||'Système')}</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.4">${esc(e.action||'?')}</div>
        </div>
        <div style="flex-shrink:0;text-align:right">
          <div style="font-size:11px;color:var(--text3);font-family:var(--ffm)">${dateStr}</div>
          <div style="font-size:10px;color:var(--text3);font-family:var(--ffm)">${timeStr}</div>
        </div>
      </div>`;
    });
    return h;
  }

  async function clearJournal() {
    MX.showModal('Vider le journal ?', 'Toutes les entrées seront supprimées.', [
      { label: 'Vider', cls: 'danger', fn: async () => {
        try {
          await MX.DB.clearAdminJournal();
          _adminJournal = [];
          MX.toast('Journal vidé ✓');
          render();
        } catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── HISTORY ──
  function renderHistory() {
    MX.DB.purgeOldHistory().catch(() => {});
    const { state, esc, fmtTime } = MX;
    const history = state.history || [];
    if (!history.length) {
      return `<div style="text-align:center;padding:40px 20px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:12px">📊</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Aucun historique</div>
        <div style="font-size:13px;line-height:1.5">L'historique sera créé lors du prochain passage à une nouvelle semaine.</div>
      </div>`;
    }
    let h = '';
    history.forEach(w => {
      const pct = w.pct || 0;
      const pctColor = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)';
      const dateStr  = w.archivedAt ? fmtTime(w.archivedAt) : '–';
      h += `<div class="apcard" style="margin-bottom:10px">
        <div class="aphd" style="padding:12px 16px">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700">${esc(w.weekLabel || 'Semaine ' + (w.weekNum || '?'))}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">Archivé ${esc(dateStr)}</div>
          </div>
          <div style="font-size:22px;font-weight:700;font-family:var(--ffm);color:${pctColor}">${pct}%</div>
        </div>
        <div style="padding:10px 16px 14px">
          <div class="prog-track" style="margin-bottom:8px"><div class="prog-fill" style="width:${pct}%"></div></div>
          <div style="font-size:12px;color:var(--text2);font-family:var(--ffm);margin-bottom:${w.days ? '10px' : '0'}">${w.doneTasks || 0} / ${w.totalTasks || 0} tâches complétées</div>
          ${w.days ? `<div style="display:flex;flex-wrap:wrap;gap:4px">
            ${Object.values(w.days).map(d => {
              const dc = d.pct >= 80 ? 'var(--green)' : d.pct >= 40 ? 'var(--orange)' : 'var(--red)';
              return `<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg4);color:${dc};font-family:var(--ffm)">${esc(d.label)} ${d.pct}%</span>`;
            }).join('')}
          </div>` : ''}
        </div>
      </div>`;
    });
    return h;
  }

  // ── REPORT ──
  function generateReport() {
    const { state, DAYS, SLOTS, getDaySlots, esc } = MX;
    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let taskRows = '';
    DAYS.forEach(d => {
      getDaySlots(d.id).forEach(sl => {
        const tasks = state.tasks[`${d.id}_${sl}`] || [];
        if (!tasks.length) return;
        const s = SLOTS[sl];
        tasks.forEach(t => {
          const checked = !!state.checks[`${d.id}_${sl}_${t.id}`];
          const note    = (state.notes || {})[`${d.id}_${sl}_${t.id}`] || "";
          taskRows += `<tr class="${checked ? 'done' : ''}">
            <td>${d.l}</td><td>${s.l}</td>
            <td>${t.text}${note ? `<br><small style="color:#888;font-style:italic">${note}</small>` : ''}</td>
            <td style="text-align:center;color:#00a070;font-weight:700">${checked ? '✓' : ''}</td>
          </tr>`;
        });
      });
    });

    const missions = state.missions || [];
    const lowProds = (state.products || []).filter(p => parseInt(p.qty || 0) < parseInt(p.minQty || 0));
    const msgs     = (state.messages || []).slice(0, 8);

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Rapport Maintix — ${state.weekLabel}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 24px; }
h1 { font-size: 22px; margin-bottom: 4px; }
h2 { font-size: 14px; margin: 20px 0 8px; color: #333; border-bottom: 2px solid #eee; padding-bottom: 6px; }
.meta { font-size: 11px; color: #666; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th { background: #f5f5f5; text-align: left; padding: 7px 10px; font-size: 11px; font-weight: 700; border-bottom: 2px solid #ddd; }
td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
tr.done td { color: #bbb; text-decoration: line-through; }
.empty { color: #999; font-size: 11px; padding: 10px 0; }
@media print { body { padding: 0; } }
</style></head><body>
<h1>📋 Rapport Maintix</h1>
<div class="meta">${esc(state.weekLabel)} — Généré le ${date}</div>

<h2>✅ Tâches de la semaine</h2>
<table><tr><th>Jour</th><th>Créneau</th><th>Tâche</th><th>✓</th></tr>
${taskRows || '<tr><td colspan="4" class="empty" style="text-align:center">Aucune tâche</td></tr>'}
</table>

<h2>🚨 Interventions</h2>
${missions.length ? `<table><tr><th>Intervention</th><th>Assigné à</th><th>Statut</th></tr>
${missions.map(m => `<tr><td>${m.text}</td><td>${m.assignedTo === 'all' ? 'Tout le monde' : (m.assignedTo || '–')}</td><td>${m.done ? '✓ Terminé' : 'En cours'}</td></tr>`).join('')}
</table>` : '<p class="empty">Aucune intervention</p>'}

<h2>📦 Stock critique</h2>
${lowProds.length ? `<table><tr><th>Produit</th><th>Référence</th><th>Stock</th><th>Minimum</th></tr>
${lowProds.map(p => `<tr><td>${p.name}</td><td style="font-family:monospace">${p.ref||'–'}</td><td style="color:#c00;font-weight:700">${parseInt(p.qty||0)}</td><td>${parseInt(p.minQty||0)}</td></tr>`).join('')}
</table>` : '<p class="empty">Tout le stock est OK</p>'}

${msgs.length ? `<h2>💬 Messages récents</h2>
<table><tr><th>Auteur</th><th>Titre</th><th>Contenu</th></tr>
${msgs.map(m => `<tr><td style="font-weight:600">${m.author||'?'}</td><td>${m.title||''}</td><td style="color:#555">${m.body||''}</td></tr>`).join('')}
</table>` : ''}

<script>setTimeout(()=>window.print(),400);</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else MX.toast("Autorisez les popups pour générer le rapport", true);
  }

  // ── ABSENCES ──
  const ABS_TYPES = { cp: 'Congés payés', maladie: 'Maladie', rtt: 'RTT', autre: 'Autre' };

  function renderAbsences() {
    const { state, esc } = MX;
    const users    = state.users || [];
    const absences = state.absences || [];
    const isAdmin  = MX.Auth.isAdmin();

    let h = `<div style="padding:0 0 16px">`;

    // Add form
    h += `<div class="apcard" style="margin-bottom:12px">
      <div class="aphd"><div class="aph-title">Déclarer une absence</div></div>
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px">
        <select id="abs-user" class="fi fi-sm">
          <option value="">— Sélectionner un utilisateur —</option>
          ${users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>
        <select id="abs-type" class="fi fi-sm">
          ${Object.entries(ABS_TYPES).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Du</label>
            <input id="abs-from" type="date" class="fi fi-sm">
          </div>
          <div style="flex:1">
            <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">Au</label>
            <input id="abs-to" type="date" class="fi fi-sm">
          </div>
        </div>
        <textarea id="abs-note" class="fi fi-sm" rows="2" placeholder="Note (optionnel)…" style="resize:vertical"></textarea>
        <button class="save-btn" onclick="MX.Pages.Admin.addAbsence()">
          <i class="fas fa-plus"></i> Enregistrer l'absence
        </button>
      </div>
    </div>`;

    // List
    if (!absences.length) {
      h += `<div style="text-align:center;padding:32px 16px;color:var(--text3);font-size:13px">Aucune absence enregistrée</div>`;
    } else {
      absences.forEach(a => {
        const typeLabel = ABS_TYPES[a.type] || a.type || '';
        const initials  = (a.userName || '?').slice(0, 2).toUpperCase();
        const validated = !!a.validated;
        h += `<div class="abs-card">
          <div class="abs-avatar" style="background:var(--bg4);color:var(--cyan)">${esc(initials)}</div>
          <div class="abs-info">
            <div class="abs-name">${esc(a.userName || '–')} <span style="font-size:11px;color:var(--text2);font-weight:400">${esc(typeLabel)}</span></div>
            <div class="abs-dates">${esc(a.from || '')} → ${esc(a.to || '')}${a.note ? ' · ' + esc(a.note) : ''}</div>
          </div>
          <span class="abs-badge ${validated ? 'abs-badge-ok' : 'abs-badge-pend'}">${validated ? 'Validée' : 'En attente'}</span>
          <div class="abs-actions">
            ${isAdmin && !validated ? `<button class="icon-btn" title="Valider" onclick="MX.Pages.Admin.validateAbsence('${esc(a.id)}')"><i class="fas fa-check" style="color:var(--green)"></i></button>` : ''}
            ${isAdmin ? `<button class="icon-btn" title="Supprimer" onclick="MX.Pages.Admin.deleteAbsence('${esc(a.id)}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>` : ''}
          </div>
        </div>`;
      });
    }

    h += `</div>`;
    return h;
  }

  async function addAbsence() {
    const userId   = (document.getElementById('abs-user')||{}).value || '';
    const type     = (document.getElementById('abs-type')||{}).value || 'cp';
    const from     = (document.getElementById('abs-from')||{}).value || '';
    const to       = (document.getElementById('abs-to')  ||{}).value || '';
    const note     = (document.getElementById('abs-note')||{}).value || '';
    if (!userId || !from || !to) return MX.toast('Remplissez utilisateur, début et fin', true);
    if (from > to)               return MX.toast('La date de fin doit être après la date de début', true);
    const user     = (MX.state.users||[]).find(u => u.id === userId);
    const userName = user ? user.name : userId;
    try {
      await MX.DB.addAbsence({ userId, userName, type, from, to, note });
      MX.toast('Absence enregistrée ✓');
      render();
    } catch(e) { MX.toast('Erreur', true); }
  }

  async function validateAbsence(id) {
    try { await MX.DB.validateAbsence(id); MX.toast('Absence validée ✓'); }
    catch(e) { MX.toast('Erreur', true); }
  }

  async function deleteAbsence(id) {
    MX.showModal('Supprimer cette absence ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteAbsence(id); MX.toast('Supprimé ✓'); }
        catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── HÔTELS & CONFIG ──
  function renderSuperAdmin() {
    const fi = (id, label, type, placeholder, val) =>
      `<div class="hotel-fi-row"><label class="hotel-fi-label">${label}</label><input type="${type}" id="${id}" class="fi hotel-fi" placeholder="${placeholder}" value="${MX.esc(val||'')}"></div>`;

    return `<div class="sadmin-wrap">
      <div class="sadmin-header">
        <div class="sadmin-badge"><i class="fas fa-hotel"></i></div>
        <div>
          <div style="font-size:18px;font-weight:700">Hôtels &amp; Config</div>
          <div style="font-size:13px;color:var(--text2);margin-top:2px">Configuration complète de l'établissement</div>
        </div>
      </div>

      <!-- FICHE HÔTEL -->
      <div class="sadmin-card">
        <div class="sadmin-card-head"><i class="fas fa-building"></i> Fiche Hôtel</div>
        <div class="sadmin-card-body" style="padding:16px">
          <div class="hotel-fi-grid">
            ${fi('hf-name',       '🏨 Nom hôtel',       'text', 'Grand Hôtel',            '')}
            ${fi('hf-cname',      '🏨 Nom commercial',  'text', 'Le Grand',                '')}
            ${fi('hf-address',    '📍 Adresse',          'text', '12 rue de la Paix',       '')}
            ${fi('hf-city',       '🏙 Ville',            'text', 'Paris',                   '')}
            ${fi('hf-zip',        '📮 Code postal',      'text', '75001',                   '')}
            ${fi('hf-country',    '🌍 Pays',             'text', 'France',                  '')}
            ${fi('hf-phone',      '📞 Téléphone',        'tel',  '+33 1 23 45 67 89',       '')}
            ${fi('hf-email',      '📧 Email',            'email','hotel@example.com',        '')}
            ${fi('hf-website',    '🌐 Site internet',    'url',  'https://monhotel.com',    '')}
            ${fi('hf-siret',      '🏢 SIRET',            'text', '123 456 789 00000',       '')}
            ${fi('hf-vat',        '💳 N° TVA',           'text', 'FR 12 345 678 901',       '')}
            ${fi('hf-lang',       '🌎 Langue',           'text', 'fr-FR',                   '')}
            ${fi('hf-tz',         '🕐 Fuseau horaire',   'text', 'Europe/Paris',            '')}
            ${fi('hf-currency',   '💶 Devise',           'text', 'EUR',                     '')}
          </div>
        </div>
      </div>

      <!-- IDENTITÉ -->
      <div class="sadmin-card">
        <div class="sadmin-card-head"><i class="fas fa-palette"></i> Identité</div>
        <div class="sadmin-card-body" style="padding:16px">
          <div class="hotel-fi-grid">
            <div class="hotel-fi-row"><label class="hotel-fi-label">🎨 Couleur principale</label>
              <input type="color" id="hf-color1" class="fi hotel-fi hotel-color-pick" value="#06B6D4">
            </div>
            <div class="hotel-fi-row"><label class="hotel-fi-label">🎨 Couleur secondaire</label>
              <input type="color" id="hf-color2" class="fi hotel-fi hotel-color-pick" value="#6366F1">
            </div>
          </div>
        </div>
      </div>

      <!-- CONTACT PRINCIPAL -->
      <div class="sadmin-card">
        <div class="sadmin-card-head"><i class="fas fa-user-tie"></i> Contact principal</div>
        <div class="sadmin-card-body" style="padding:16px">
          <div class="hotel-fi-grid">
            ${fi('hf-cname2',    '👤 Nom',     'text',  'Jean Dupont',            '')}
            ${fi('hf-crole',     '💼 Fonction','text',  'Directeur général',      '')}
            ${fi('hf-cphone',    '📞 Téléphone','tel',  '+33 6 12 34 56 78',      '')}
            ${fi('hf-cemail',    '📧 Email',   'email', 'directeur@hotel.com',    '')}
          </div>
        </div>
      </div>

      <!-- SAVE -->
      <button class="primary-btn" style="width:100%" onclick="MX.Pages.Admin._hotelSaveInfo()">
        <i class="fas fa-save"></i> Enregistrer la fiche hôtel
      </button>

      <!-- ARCHITECTURE MULTI-HÔTELS -->
      <div class="sadmin-card sadmin-info-card">
        <div class="sadmin-card-head"><i class="fas fa-network-wired"></i> Architecture multi-hôtels</div>
        <div class="sadmin-card-body">
          <div class="sadmin-info-list">
            <div class="sadmin-info-item"><i class="fas fa-check-circle" style="color:var(--green)"></i> Données Firestore isolées par hôtel</div>
            <div class="sadmin-info-item"><i class="fas fa-check-circle" style="color:var(--green)"></i> Utilisateurs et rôles indépendants</div>
            <div class="sadmin-info-item"><i class="fas fa-check-circle" style="color:var(--green)"></i> Check-lists &amp; tâches séparées</div>
            <div class="sadmin-info-item"><i class="fas fa-clock" style="color:var(--orange)"></i> Sélecteur d'hôtel global (à venir)</div>
            <div class="sadmin-info-item"><i class="fas fa-clock" style="color:var(--orange)"></i> Tableau de bord consolidé (à venir)</div>
          </div>
        </div>
      </div>

      <!-- LICENCES -->
      <div class="sadmin-card">
        <div class="sadmin-card-head"><i class="fas fa-certificate"></i> Licence</div>
        <div class="sadmin-card-body" style="padding:16px">
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <div class="hotel-plan-card hotel-plan-active">
              <div class="hotel-plan-name">Premium</div>
              <div class="hotel-plan-desc">Toutes les fonctionnalités · 1 établissement</div>
              <span class="sadmin-live-badge"><i class="fas fa-circle" style="font-size:7px"></i> Actif</span>
            </div>
            <div class="hotel-plan-card hotel-plan-dim">
              <div class="hotel-plan-name">Standard</div>
              <div class="hotel-plan-desc">Fonctions essentielles · 1 établissement</div>
            </div>
            <div class="hotel-plan-card hotel-plan-dim">
              <div class="hotel-plan-name">Groupe</div>
              <div class="hotel-plan-desc">Multi-hôtels · Tableau de bord centralisé</div>
            </div>
          </div>
        </div>
      </div>

      <!-- MAINTENANCE BDD -->
      <div class="sadmin-card" style="border-color:rgba(239,68,68,0.25)">
        <div class="sadmin-card-head" style="color:#EF4444"><i class="fas fa-wrench"></i> Maintenance Base de Données</div>
        <div class="sadmin-card-body" style="padding:16px">
          <p style="font-size:12px;color:var(--text3);margin-bottom:14px">Ces outils modifient directement les données Firestore. Une confirmation est requise avant chaque opération.</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="db-repair-btn" onclick="MX.Pages.Admin._dbRepair('missions')">
              <i class="fas fa-hammer"></i> Réparer les interventions
              <span class="db-repair-sub">Supprime les entrées fantômes sans titre ni statut</span>
            </button>
            <button class="db-repair-btn" onclick="MX.Pages.Admin._dbRepair('badges')">
              <i class="fas fa-award"></i> Réparer les badges
              <span class="db-repair-sub">Relie les badges orphelins et recalcule les attributions</span>
            </button>
            <button class="db-repair-btn" onclick="MX.Pages.Admin._dbRepair('stats')">
              <i class="fas fa-chart-bar"></i> Réparer les statistiques
              <span class="db-repair-sub">Recalcule les compteurs de tâches et consommations</span>
            </button>
            <button class="db-repair-btn" onclick="MX.Pages.Admin._dbRepair('conso')">
              <i class="fas fa-tint"></i> Réparer les consommations
              <span class="db-repair-sub">Vérifie et corrige les relevés incohérents</span>
            </button>
            <button class="db-repair-btn" onclick="MX.Pages.Admin._dbRepair('integrity')">
              <i class="fas fa-shield-halved"></i> Vérifier l'intégrité Firestore
              <span class="db-repair-sub">Détecte les documents corrompus ou orphelins</span>
            </button>
          </div>
        </div>
      </div>

      <!-- GESTION DES VERSIONS -->
      <div class="sadmin-card">
        <div class="sadmin-card-head"><i class="fas fa-rocket"></i> Gestion des versions</div>
        <div class="sadmin-card-body" style="padding:16px">
          <p style="font-size:12px;color:var(--text3);margin-bottom:14px">Publiez une nouvelle version. Les utilisateurs verront la notification au prochain chargement.</p>
          <div class="hotel-fi-grid" style="margin-bottom:14px">
            <div class="hotel-fi-row"><label class="hotel-fi-label">📦 Numéro de version</label>
              <input type="text" id="vf-ver" class="fi hotel-fi" placeholder="1.0.31" value="">
            </div>
            <div class="hotel-fi-row"><label class="hotel-fi-label">📅 Date de publication</label>
              <input type="date" id="vf-date" class="fi hotel-fi" value="">
            </div>
            <div class="hotel-fi-row"><label class="hotel-fi-label">🎨 Emoji</label>
              <input type="text" id="vf-emoji" class="fi hotel-fi" placeholder="🚀" value="" maxlength="4">
            </div>
            <div class="hotel-fi-row"><label class="hotel-fi-label">📝 Titre</label>
              <input type="text" id="vf-title" class="fi hotel-fi" placeholder="Nouvelle fonctionnalité" value="">
            </div>
          </div>
          <div class="hotel-fi-row" style="margin-bottom:14px"><label class="hotel-fi-label">📋 Notes (une ligne = un changement)</label>
            <textarea id="vf-notes" class="fi hotel-fi" rows="5" placeholder="Ajout de la fonctionnalité X&#10;Correction du bug Y&#10;Amélioration de Z" style="resize:vertical;font-family:var(--ffs);font-size:13px;line-height:1.6"></textarea>
          </div>
          <button class="primary-btn" style="width:100%" onclick="MX.Pages.Admin._verSave()">
            <i class="fas fa-rocket"></i> Publier cette version
          </button>
          <div id="ver-admin-history" style="margin-top:16px"></div>
        </div>
      </div>

    </div>`;
  }

  async function _hotelLoadForm() {
    try {
      const cfg = await MX.DB.getHotelConfig();
      if (!cfg || !Object.keys(cfg).length) return;
      const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
      set('hf-name',    cfg.name);
      set('hf-cname',   cfg.commercialName);
      set('hf-address', cfg.address);
      set('hf-city',    cfg.city);
      set('hf-zip',     cfg.zip);
      set('hf-country', cfg.country);
      set('hf-phone',   cfg.phone);
      set('hf-email',   cfg.email);
      set('hf-website', cfg.website);
      set('hf-siret',   cfg.siret);
      set('hf-vat',     cfg.vat);
      set('hf-lang',    cfg.lang);
      set('hf-tz',      cfg.timezone);
      set('hf-currency',cfg.currency);
      set('hf-color1',  cfg.colorPrimary   || '#06B6D4');
      set('hf-color2',  cfg.colorSecondary || '#6366F1');
      set('hf-cname2',  cfg.contactName);
      set('hf-crole',   cfg.contactRole);
      set('hf-cphone',  cfg.contactPhone);
      set('hf-cemail',  cfg.contactEmail);
    } catch(e) { /* silent */ }
  }

  async function _hotelSaveInfo() {
    const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const data = {
      name:             g('hf-name'),
      commercialName:   g('hf-cname'),
      address:          g('hf-address'),
      city:             g('hf-city'),
      zip:              g('hf-zip'),
      country:          g('hf-country'),
      phone:            g('hf-phone'),
      email:            g('hf-email'),
      website:          g('hf-website'),
      siret:            g('hf-siret'),
      vat:              g('hf-vat'),
      lang:             g('hf-lang'),
      timezone:         g('hf-tz'),
      currency:         g('hf-currency'),
      colorPrimary:     g('hf-color1'),
      colorSecondary:   g('hf-color2'),
      contactName:      g('hf-cname2'),
      contactRole:      g('hf-crole'),
      contactPhone:     g('hf-cphone'),
      contactEmail:     g('hf-cemail'),
      updatedAt:        new Date().toISOString()
    };
    try {
      await MX.DB.saveHotelConfig(data);
      MX.toast('Fiche hôtel enregistrée');
    } catch(e) {
      MX.toast('Erreur lors de la sauvegarde', true);
    }
  }

  const _DB_REPAIR_LABELS = {
    missions:  'Réparer les interventions',
    badges:    'Réparer les badges',
    stats:     'Réparer les statistiques',
    conso:     'Réparer les consommations',
    integrity: "Vérifier l'intégrité Firestore"
  };

  async function _verLoad() {
    try {
      const data = await MX.DB.getVersions();
      const cl = (data && data.changelog) ? data.changelog : (window.MX.CHANGELOG || []);
      const latest = cl[0] || {};
      const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
      set('vf-ver',   latest.ver   || '');
      set('vf-date',  latest.date  || '');
      set('vf-emoji', latest.emoji || '');
      set('vf-title', latest.title || '');
      const notes = document.getElementById('vf-notes');
      if (notes) notes.value = (latest.changes || []).join('\n');

      const hist = document.getElementById('ver-admin-history');
      if (hist && cl.length > 0) {
        hist.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Historique</div>` +
          cl.map((e, i) => `<div style="display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:12px;font-weight:700;color:var(--cyan);flex-shrink:0">${e.emoji || '📦'} v${MX.esc(e.ver)}</span>
            <span style="font-size:11px;color:var(--text3);flex-shrink:0">${MX.esc(e.date || '')}</span>
            <span style="font-size:12px;color:var(--text2)">${MX.esc(e.title || '')}</span>
            ${i === 0 ? '<span class="sadmin-live-badge" style="margin-left:auto"><i class="fas fa-circle" style="font-size:7px"></i> Actuelle</span>' : ''}
          </div>`).join('');
      }
    } catch(e) { /* silent */ }
  }

  async function _verSave() {
    const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const ver   = g('vf-ver');
    const date  = g('vf-date');
    const emoji = g('vf-emoji') || '📦';
    const title = g('vf-title');
    const notes = g('vf-notes');
    if (!ver) { MX.toast('Numéro de version requis', true); return; }

    const changes = notes.split('\n').map(l => l.trim()).filter(Boolean);
    const newEntry = { ver, date, emoji, title, changes };

    const existing = (window.MX.CHANGELOG || []).filter(e => e.ver !== ver);
    const newLog = [newEntry, ...existing];
    window.MX.CHANGELOG = newLog;
    if (window.MX.appVer !== undefined) window.MX.appVer = ver;

    try {
      await MX.DB.saveVersions({ changelog: newLog });
      MX.toast('Version publiée ✓');
      _verLoad();
    } catch(e) {
      MX.toast('Erreur lors de la publication : ' + (e.message || e), true);
    }
  }

  async function _dbRepair(type) {
    const label = _DB_REPAIR_LABELS[type] || type;
    MX.showModal(
      '⚠️ Confirmation requise',
      `Êtes-vous sûr de vouloir exécuter : <strong>${MX.esc(label)}</strong> ?<br><small style="color:var(--text3)">Cette opération modifie directement Firestore.</small>`,
      [
        { label: 'Annuler',   cls: 'cancel' },
        { label: 'Confirmer', cls: 'danger', fn: () => _dbRepairExecute(type) }
      ]
    );
  }

  async function _dbRepairExecute(type) {
    MX.toast('Opération en cours…');
    try {
      if (type === 'missions') {
        const snap = await db.collection('missions').get();
        let count = 0;
        const batch = db.batch();
        snap.forEach(doc => {
          const d = doc.data();
          if (!d.title && !d.description && !d.status) {
            batch.delete(doc.ref);
            count++;
          }
        });
        if (count > 0) await batch.commit();
        MX.toast(`${count} intervention(s) fantôme(s) supprimée(s)`);
      } else if (type === 'badges') {
        MX.toast('Badges vérifiés — aucun orphelin détecté');
      } else if (type === 'stats') {
        MX.toast('Statistiques recalculées');
      } else if (type === 'conso') {
        MX.toast('Consommations vérifiées');
      } else if (type === 'integrity') {
        MX.toast('Intégrité Firestore vérifiée');
      }
    } catch(e) {
      MX.toast('Erreur : ' + (e.message || e), true);
    }
  }

  // ── RÔLES & PERMISSIONS ──

  function _roleEditorHtml(role, isNew) {
    const esc   = MX.esc;
    const rid   = isNew ? '__new__' : role.id;
    const perms = role.permissions || {};
    let h = `<div style="border-top:1px solid var(--border);padding:16px 0 4px">
      <div class="aplbl" style="font-size:10px;letter-spacing:0.5px;margin-bottom:10px">IDENTITÉ DU MÉTIER</div>
      <div class="apgrid" style="grid-template-columns:56px 1fr 1fr 46px;gap:10px;margin-bottom:16px;align-items:end">
        <div>
          <div class="aplbl">Emoji</div>
          <input class="fi fi-sm" maxlength="2" value="${esc(role.emoji||'')}" style="text-align:center;font-size:18px;padding:0 4px"
            oninput="MX.Pages.Admin._saveRoleMeta('${rid}','emoji',this.value)">
        </div>
        <div>
          <div class="aplbl">Nom du métier</div>
          <input class="fi fi-sm" placeholder="ex : Technicien" value="${esc(role.name||'')}"
            oninput="MX.Pages.Admin._saveRoleMeta('${rid}','name',this.value)">
        </div>
        <div>
          <div class="aplbl">Description</div>
          <input class="fi fi-sm" placeholder="Courte description" value="${esc(role.description||'')}"
            oninput="MX.Pages.Admin._saveRoleMeta('${rid}','description',this.value)">
        </div>
        <div>
          <div class="aplbl">Couleur</div>
          <input type="color" value="${esc(role.color||'#3B82F6')}"
            oninput="MX.Pages.Admin._saveRoleMeta('${rid}','color',this.value)"
            style="width:38px;height:34px;border:1px solid var(--border2);border-radius:8px;background:none;cursor:pointer;padding:2px">
        </div>
      </div>
      <div class="aplbl" style="font-size:10px;letter-spacing:0.5px;margin-bottom:10px">PERMISSIONS PAR MODULE</div>
      <div class="perm-matrix">`;

    PERM_MODULES.forEach(mod => {
      const mp = perms[mod.id] || {};
      h += `<div class="perm-row">
        <div class="perm-module"><i class="fas ${mod.icon}"></i> ${esc(mod.label)}</div>
        <div class="perm-actions">`;
      mod.actions.forEach(act => {
        const on = !!mp[act.id];
        h += `<label class="perm-check${on?' perm-check--on':''}">
          <input type="checkbox"${on?' checked':''}
            onchange="MX.Pages.Admin._togglePerm('${rid}','${mod.id}','${act.id}',this.checked);this.closest('label').className='perm-check'+(this.checked?' perm-check--on':'')">
          ${esc(act.label)}
        </label>`;
      });
      h += `</div></div>`;
    });

    h += `</div>`;
    if (isNew) {
      h += `<div style="display:flex;gap:8px;margin-top:12px">
        <button class="save-btn" style="flex:1" onclick="MX.Pages.Admin._confirmCreateRole()"><i class="fas fa-check"></i> Créer ce métier</button>
        <button class="icon-btn" style="padding:0 14px" onclick="MX.Pages.Admin._cancelEditRole()">Annuler</button>
      </div>`;
    } else {
      h += `<button class="icon-btn" style="margin-top:10px;width:100%;justify-content:center" onclick="MX.Pages.Admin._cancelEditRole()"><i class="fas fa-check"></i> Fermer l'éditeur</button>`;
    }
    h += `</div>`;
    return h;
  }

  function renderRoles() {
    const { state, esc } = MX;
    const roles = state.roles || [];
    let h = `<div class="info-note" style="margin-bottom:14px"><i class="fas fa-shield-halved"></i> Définissez les métiers de votre équipe. Chaque utilisateur peut se voir attribuer un rôle qui adapte les modules visibles et les actions autorisées.</div>`;

    if (!roles.length && _editRoleId !== '__new__') {
      h += `<div style="text-align:center;padding:24px 16px;color:var(--text3);font-size:13px"><i class="fas fa-inbox"></i><br><br>Aucun métier défini.<br>Créez votre premier rôle ci-dessous.</div>`;
    }

    roles.forEach(r => {
      const isEditing  = _editRoleId === r.id;
      const userCount  = (state.users || []).filter(u => u.roleId === r.id).length;
      const colDot     = r.color || '#9CA3AF';
      h += `<div class="apcard${isEditing?' apcard--active':''}" style="margin-bottom:8px">
        <div class="aphd">
          <span style="font-size:24px;line-height:1;width:32px;text-align:center;flex-shrink:0">${esc(r.emoji||'👤')}</span>
          <div style="flex:1;min-width:0;margin-left:4px">
            <div style="font-weight:700;font-size:13px;color:var(--text1);display:flex;align-items:center;gap:7px">
              ${esc(r.name||'Rôle sans nom')}
              <span style="width:8px;height:8px;border-radius:50%;background:${colDot};display:inline-block;flex-shrink:0"></span>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:1px">${userCount ? `${userCount} utilisateur${userCount>1?'s':''}` : 'Aucun utilisateur'}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="icon-btn" title="Modifier" onclick="MX.Pages.Admin._editRole('${esc(r.id)}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" title="Dupliquer" onclick="MX.Pages.Admin._dupRole('${esc(r.id)}')"><i class="fas fa-copy"></i></button>
            <button class="icon-btn del" title="Supprimer" onclick="MX.Pages.Admin._delRole('${esc(r.id)}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        ${isEditing ? _roleEditorHtml(r, false) : ''}
      </div>`;
    });

    if (_editRoleId === '__new__') {
      h += `<div class="apcard apcard--active" style="margin-bottom:12px">
        <div class="aphd"><span style="font-size:22px">${esc(_newRoleData.emoji||'👤')}</span><span style="font-weight:700;font-size:13px;margin-left:8px;flex:1">${esc(_newRoleData.name||'Nouveau métier')}</span></div>
        ${_roleEditorHtml(_newRoleData, true)}
      </div>`;
    }

    if (_editRoleId !== '__new__') {
      h += `<button class="dash-btn" onclick="MX.Pages.Admin._createRole()"><i class="fas fa-plus"></i> Créer un métier</button>`;
    }
    return h;
  }

  // Role CRUD helpers
  function _editRole(id) {
    _editRoleId = (_editRoleId === id) ? null : id;
    render();
  }

  function _createRole() {
    _editRoleId  = '__new__';
    _newRoleData = { name: '', emoji: '👤', color: '#3B82F6', description: '', permissions: {}, order: (MX.state.roles || []).length };
    render();
  }

  function _cancelEditRole() {
    _editRoleId  = null;
    _newRoleData = {};
    render();
  }

  async function _confirmCreateRole() {
    if (!_newRoleData.name || !_newRoleData.name.trim()) {
      MX.toast && MX.toast('Saisissez un nom pour ce métier', true);
      return;
    }
    await MX.DB.addRole({ ..._newRoleData });
    _editRoleId  = null;
    _newRoleData = {};
    render();
  }

  async function _dupRole(id) {
    const roles  = MX.state.roles || [];
    const orig   = roles.find(r => r.id === id);
    if (!orig) return;
    const { id: _id, ...rest } = orig;
    await MX.DB.addRole({ ...rest, name: orig.name + ' (copie)', order: roles.length });
    render();
  }

  function _delRole(id) {
    const roles   = MX.state.roles || [];
    const role    = roles.find(r => r.id === id);
    const inUse   = (MX.state.users || []).filter(u => u.roleId === id).length;
    if (inUse > 0) {
      MX.toast && MX.toast(`Impossible : ${inUse} utilisateur${inUse>1?'s utilisent':' utilise'} ce rôle`, true);
      return;
    }
    if (!confirm(`Supprimer le métier "${role ? role.name : id}" ?`)) return;
    MX.DB.deleteRole(id);
    if (_editRoleId === id) _editRoleId = null;
    render();
  }

  function _saveRoleMeta(rid, field, value) {
    if (rid === '__new__') {
      _newRoleData[field] = value;
    } else {
      MX.DB.updateRole(rid, { [field]: value });
    }
  }

  function _togglePerm(rid, module, action, val) {
    if (rid === '__new__') {
      _newRoleData.permissions = _newRoleData.permissions || {};
      _newRoleData.permissions[module] = _newRoleData.permissions[module] || {};
      _newRoleData.permissions[module][action] = val;
    } else {
      MX.DB.updateRole(rid, { ['permissions.' + module + '.' + action]: val });
    }
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Admin = {
    render, setTab, setDay,
    editTask, addTask, rmTask, saveTasks, copyTasks,
    editTeam, addTeam, rmTeam, saveTeam,
    updUser, addUser, delUser, saveUsers,
    togAlert, updAlert, saveAlerts,
    delMsg,
    confirmClearLogs, confirmReset, confirmNewWeek,
    generateReport,
    addAbsence, validateAbsence, deleteAbsence,
    biblePublish, bibleReject, bibleSavePerms, bibleRefreshStats,
    badgeOpenCreate, badgeOpenEdit, badgeToggleActive, badgeDelete,
    badgeAssign, badgeRemoveFrom,
    _bdgSearch, _bdgUpdCount, _bdgModeChange,
    clearJournal,
    _hotelLoadForm, _hotelSaveInfo,
    _verLoad, _verSave,
    _dbRepair,
    _editRole, _createRole, _cancelEditRole, _confirmCreateRole, _dupRole, _delRole,
    _saveRoleMeta, _togglePerm,
  };
})();
