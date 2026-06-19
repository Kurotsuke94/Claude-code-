(function () {
  const NAV = [
    { id: "msgs",          icon: "fa-comments",      l: "Messages",       badge: true },
    { id: "home",          icon: "fa-house",          l: "Accueil" },
    null,
    { id: "lundi",         icon: "fa-1",              l: "Lundi",          day: true },
    { id: "mardi",         icon: "fa-2",              l: "Mardi",          day: true },
    { id: "mercredi",      icon: "fa-3",              l: "Mercredi",       day: true },
    { id: "jeudi",         icon: "fa-4",              l: "Jeudi",          day: true },
    { id: "vendredi",      icon: "fa-5",              l: "Vendredi",       day: true },
    { id: "samedi",        icon: "fa-6",              l: "Sam",            day: true },
    { id: "dimanche",      icon: "fa-7",              l: "Dim",            day: true },
    { id: "today-cl",      icon: "fa-list-check",     l: "Checklist Jour", todayShortcut: true },
    null,
    { id: "orders",        icon: "fa-box",            l: "Stock" },
    { id: "resp-plan",     icon: "fa-clipboard-check",l: "Planning Resp.", respOnly: true },
    { id: "resp-lundi",    icon: "fa-circle-dot",     l: "Lundi",          respOnly: true, respDay: "lundi" },
    { id: "resp-mardi",    icon: "fa-circle-dot",     l: "Mardi",          respOnly: true, respDay: "mardi" },
    { id: "resp-mercredi", icon: "fa-circle-dot",     l: "Mercredi",       respOnly: true, respDay: "mercredi" },
    { id: "resp-jeudi",    icon: "fa-circle-dot",     l: "Jeudi",          respOnly: true, respDay: "jeudi" },
    { id: "resp-vendredi", icon: "fa-circle-dot",     l: "Vendredi",       respOnly: true, respDay: "vendredi" },
    { id: "resp-samedi",   icon: "fa-circle-dot",     l: "Sam",            respOnly: true, respDay: "samedi" },
    { id: "resp-dimanche", icon: "fa-circle-dot",     l: "Dim",            respOnly: true, respDay: "dimanche" },
    { id: "admin",         icon: "fa-shield-halved",  l: "Admin" }
  ];

  const SECTION_LABELS = ["PLANNING", "GESTION"];

  // ── UNREAD MESSAGES TRACKING ──
  function _getMsgsSeen() {
    return parseInt(localStorage.getItem("mx_msgs_seen") || "0", 10);
  }
  function _markMsgsSeen() {
    localStorage.setItem("mx_msgs_seen", Date.now());
  }
  function _tsMs(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds)  return ts.seconds * 1000;
    return 0;
  }

  // ── PAGE ROUTING ──
  window.MX.showPage = function (id) {
    MX.state.currentPage = id;
    if (id === "msgs") { _markMsgsSeen(); updateNavProgress(); }
    const navItem = NAV.find(n => n && n.id === id);
    const title   = id === "today-cl"
      ? (MX.DAYS.find(d => d.id === MX.todayId())?.l || "Aujourd'hui")
      : (navItem?.l || "Maintix");
    document.getElementById("topbar-title").textContent = title;
    document.querySelectorAll(".nav-item[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === id));
    document.querySelectorAll(".bn[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === id));
    MX.closeSidebar();
    renderPage(id);
  };

  function renderPage(id) {
    const { Pages, DAYS } = MX;
    if (id === "home")      return Pages.Home.render();
    if (id === "msgs")      return Pages.Messages.render();
    if (id === "orders")    return Pages.Orders.render();
    if (id === "admin")     return Pages.Admin.render();
    if (id === "resp-plan") return Pages.RespPlan.render();
    if (id === "today-cl")  return Pages.Checklist.render(MX.todayId());
    if (id.startsWith("resp-")) return Pages.RespPlan.renderDay(id.slice(5));
    if (DAYS.find(d => d.id === id)) return Pages.Checklist.render(id);
  }

  // ── SIDEBAR ──
  window.MX.toggleSidebar = function () {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebar-overlay").classList.toggle("show");
  };
  window.MX.closeSidebar = function () {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("show");
  };

  // ── NAV SECTION COLLAPSE ──
  let _planOpen = localStorage.getItem("mx_nav_plan") !== "0";
  let _respOpen = localStorage.getItem("mx_nav_resp") === "1";
  window.MX.toggleNavPlan = function () {
    _planOpen = !_planOpen;
    localStorage.setItem("mx_nav_plan", _planOpen ? "1" : "0");
    buildNav();
  };
  window.MX.toggleNavResp = function (e) {
    if (e) e.stopPropagation();
    _respOpen = !_respOpen;
    localStorage.setItem("mx_nav_resp", _respOpen ? "1" : "0");
    buildNav();
  };

  // ── BUILD NAVIGATION ──
  function buildNav() {
    const sideNav  = document.getElementById("sidebar-nav");
    const botNav   = document.getElementById("bottom-nav");
    const { DAYS, getDaySlots, state } = MX;

    let sideHtml = "";
    let botHtml  = `<div class="bottom-nav-inner">`;

    sideHtml += `<div class="nav-section-label">PRINCIPAL</div>`;
    let sepCount = 0;

    NAV.forEach(item => {
      if (!item) {
        const label = SECTION_LABELS[sepCount] || "";
        if (label === "PLANNING") {
          sideHtml += `<div class="nav-section-label" onclick="MX.toggleNavPlan()" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none">
            <span>${label}</span>
            <i class="fas fa-chevron-${_planOpen?'up':'down'}" style="font-size:9px;color:var(--text3);margin-right:8px;transition:transform 0.2s"></i>
          </div>`;
        } else {
          sideHtml += `<div class="nav-section-label">${label}</div>`;
        }
        sepCount++;
        return;
      }

      if (item.respOnly && !MX.Auth.canSeeAll()) return;
      if ((item.day || item.todayShortcut) && !_planOpen) return;
      if (item.respDay && !_respOpen) return;

      const isActive = item.id === state.currentPage;

      let prog = "", progCls = "";
      if (item.day || item.todayShortcut) {
        const dayId = item.todayShortcut ? MX.todayId() : item.id;
        const day   = DAYS.find(d => d.id === dayId);
        if (day) {
          let t = 0, d = 0;
          getDaySlots(day.id).forEach(sl => {
            (state.tasks[`${day.id}_${sl}`] || []).forEach(task => {
              t++;
              if (state.checks[`${day.id}_${sl}_${task.id}`]) d++;
            });
          });
          const pct = t ? Math.round(d / t * 100) : 0;
          prog    = pct + "%";
          progCls = pct >= 80 ? "done" : pct >= 40 ? "warn" : "alert";
        }
      }
      if (item.respDay) {
        const dayTasks = (state.respTasks || []).filter(t => t.dayId === item.respDay);
        const total    = dayTasks.length;
        const done     = dayTasks.filter(t => !!state.checks["resp_" + t.id]).length;
        const pct      = total ? Math.round(done / total * 100) : 0;
        prog    = pct + "%";
        progCls = pct >= 80 ? "done" : pct >= 40 ? "warn" : "alert";
      }

      // Planning Resp. — with collapse chevron on right
      if (item.id === "resp-plan" && MX.Auth.canSeeAll()) {
        sideHtml += `<button class="nav-item ${isActive?'active':''}" data-page="${item.id}" onclick="MX.showPage('${item.id}')">
          <span class="nav-icon"><i class="fas ${item.icon}"></i></span>
          <span class="nav-label">${item.l}</span>
          <span onclick="MX.toggleNavResp(event)" style="padding:4px 2px;cursor:pointer;color:var(--text3);font-size:9px;flex-shrink:0" title="${_respOpen?'Réduire':'Déplier'}">
            <i class="fas fa-chevron-${_respOpen?'up':'down'}"></i>
          </span>
        </button>`;
        botHtml += `<button class="bn ${isActive?'active':''}" data-page="${item.id}" onclick="MX.showPage('${item.id}')">
          <div class="bn-bar"></div>
          <i class="fas ${item.icon}"></i>
          <span>${item.l}</span>
        </button>`;
        return;
      }

      const subStyle = item.respDay ? 'style="padding-left:30px;font-size:12px"' : '';
      sideHtml += `<button class="nav-item ${isActive?'active':''}" data-page="${item.id}" onclick="MX.showPage('${item.id}')" ${subStyle}>
        <span class="nav-icon"><i class="fas ${item.icon}"></i></span>
        <span class="nav-label">${item.l}</span>
        ${item.badge ? `<span class="nav-badge" id="nb_${item.id}"></span>` : ''}
        ${prog ? `<span class="nav-prog ${progCls}" id="np_${item.id}">${prog}</span>` : ''}
      </button>`;

      if (!item.day && !item.todayShortcut && !item.respDay) {
        botHtml += `<button class="bn ${isActive?'active':''}" data-page="${item.id}" onclick="MX.showPage('${item.id}')">
          <div class="bn-bar"></div>
          <i class="fas ${item.icon}"></i>
          ${item.badge ? `<span class="nav-badge" id="bnb_${item.id}"></span>` : ''}
          <span>${item.l}</span>
        </button>`;
      }
    });

    botHtml += `</div>`;
    sideNav.innerHTML = sideHtml;
    botNav.innerHTML  = botHtml;

    MX.Auth.updateSidebarFooter && MX.Auth.updateSidebarFooter();
    buildDeskHeader();
  }

  // ── DESK HEADER ──
  function buildDeskHeader() {
    const el = document.getElementById("desk-header");
    if (!el) return;
    const { state } = MX;
    const cu    = state.currentUser;
    const admin = state.adminUser;

    let userHtml = '';
    if (admin) {
      const email    = admin.email || '';
      const initials = email.substring(0, 2).toUpperCase();
      userHtml = `<div class="dh-user" onclick="MX.Auth.logout()">
        <div class="dh-avatar" style="background:var(--cyan-dim);color:var(--cyan)">${MX.esc(initials)}</div>
        <span style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MX.esc(email.split('@')[0])}</span>
        <i class="fas fa-sign-out-alt" style="font-size:11px;color:var(--red);margin-left:2px"></i>
      </div>`;
    } else if (cu) {
      const nc  = MX.userColors(cu.name);
      const bg  = cu.color || nc.bg;
      const fg  = cu.color ? MX._contrastColor(cu.color) : nc.fg;
      const lbl = cu.role === 'responsable' ? 'Responsable' : 'Technicien';
      userHtml = `<div class="dh-user" onclick="MX.Auth.clearCurrentUser()">
        <div class="dh-avatar" style="background:${bg};color:${fg}">${MX.esc(cu.name.substring(0,2).toUpperCase())}</div>
        <div>
          <div style="font-size:12px;font-weight:600;line-height:1.2">${MX.esc(cu.name)}</div>
          <div style="font-size:10px;color:var(--text3);line-height:1.2">${lbl}</div>
        </div>
      </div>`;
    } else {
      userHtml = `<div class="dh-user" onclick="MX.Auth.showUserPicker()">
        <div class="dh-avatar" style="background:var(--bg4);color:var(--text3)"><i class="fas fa-user" style="font-size:10px"></i></div>
        <span style="font-size:12px;color:var(--text3)">Connexion</span>
      </div>`;
    }

    const seen   = _getMsgsSeen();
    const unread = (state.messages || []).filter(m => _tsMs(m.ts) > seen).length;

    el.innerHTML = `
      <div class="dh-week" id="dh-week-label">
        <i class="fas fa-calendar-week" style="font-size:10px"></i>
        ${MX.esc(state.weekLabel || MX.mkWeekLabel())}
      </div>
      <div class="dh-spacer"></div>
      <button class="dh-btn" onclick="MX.showPage('msgs')" title="Messages">
        <i class="fas fa-bell"></i>
        <span class="nav-badge${unread ? ' show' : ''}" id="dh-bell-badge">${unread > 9 ? '9+' : unread || ''}</span>
      </button>
      ${userHtml}
    `;
  }

  function updateNavProgress() {
    const { DAYS, state, getDaySlots } = MX;
    DAYS.forEach(day => {
      let t = 0, d = 0;
      getDaySlots(day.id).forEach(sl => {
        (state.tasks[`${day.id}_${sl}`] || []).forEach(task => {
          t++;
          if (state.checks[`${day.id}_${sl}_${task.id}`]) d++;
        });
      });
      const pct   = t ? Math.round(d / t * 100) : 0;
      const cls   = pct >= 80 ? "done" : pct >= 40 ? "warn" : "alert";
      const npEl  = document.getElementById("np_" + day.id);
      if (npEl) { npEl.textContent = pct + "%"; npEl.className = "nav-prog " + cls; }

      // Resp planning day progress
      const dayTasks = (state.respTasks || []).filter(t => t.dayId === day.id);
      const rt = dayTasks.length;
      const rd = dayTasks.filter(t => !!state.checks["resp_" + t.id]).length;
      const rpct = rt ? Math.round(rd / rt * 100) : 0;
      const rcls = rpct >= 80 ? "done" : rpct >= 40 ? "warn" : "alert";
      const rnpEl = document.getElementById("np_resp-" + day.id);
      if (rnpEl) { rnpEl.textContent = rpct + "%"; rnpEl.className = "nav-prog " + rcls; }
    });

    const seen   = _getMsgsSeen();
    const unread = (state.messages || []).filter(m => _tsMs(m.ts) > seen).length;
    const badge  = document.getElementById("nb_msgs");
    if (badge)  { badge.textContent = unread > 9 ? "9+" : unread; badge.className = "nav-badge" + (unread ? " show" : ""); }
    const bnBadge = document.getElementById("bnb_msgs");
    if (bnBadge){ bnBadge.textContent = unread > 9 ? "9+" : unread; bnBadge.className = "nav-badge" + (unread ? " show" : ""); }
    const dhBadge = document.getElementById("dh-bell-badge");
    if (dhBadge){ dhBadge.textContent = unread > 9 ? "9+" : (unread || ""); dhBadge.className = "nav-badge" + (unread ? " show" : ""); }
  }

  // ── MISSION NOTIFICATIONS ──
  const _notifiedMissions = new Set();
  function _notifyNewMissions(prev, next) {
    const cu = MX.state.currentUser;
    if (!cu) return;
    const prevIds = new Set(prev.map(m => m.id));
    next.forEach(m => {
      if (!prevIds.has(m.id) && m.assignedTo === cu.name && !m.done && !_notifiedMissions.has(m.id)) {
        _notifiedMissions.add(m.id);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Nouvelle intervention", { body: m.text + (m.createdBy ? " — de " + m.createdBy : ""), icon: "/assets/icons/icon-192.png" });
        }
      }
    });
  }

  // ── FIRESTORE LISTENERS ──
  function setupListeners() {
    const { DB, state } = MX;

    DB.listenWeek(data => {
      state.weekLabel = data.label || "";
      state.weekNum   = data.num   || 1;
      const dhWeek = document.getElementById("dh-week-label");
      if (dhWeek) dhWeek.innerHTML = `<i class="fas fa-calendar-week" style="font-size:10px"></i> ${MX.esc(state.weekLabel)}`;
      if (state.currentPage === "home") MX.Pages.Home.render();
    });

    DB.listenTeams(data => {
      state.teams = data;
    });

    DB.listenAlerts(data => {
      state.alerts = data;
    });

    DB.listenAssignments(data => {
      state.assignments = data;
      if (MX.DAYS.find(d => d.id === state.currentPage)) {
        MX.Pages.Checklist.render(state.currentPage);
      }
    });

    DB.listenChecks(data => {
      state.checks = data;
      updateNavProgress();
      if (MX.DAYS.find(d => d.id === state.currentPage)) MX.Pages.Checklist.render(state.currentPage);
      if (state.currentPage === "home")      MX.Pages.Home.render();
      if (state.currentPage === "orders")    MX.Pages.Orders.render();
      if (state.currentPage === "resp-plan") MX.Pages.RespPlan.render();
      if (state.currentPage && state.currentPage.startsWith("resp-") && state.currentPage !== "resp-plan")
        MX.Pages.RespPlan.renderDay(state.currentPage.slice(5));
    });

    DB.listenAllTasks((dayId, sl, items) => {
      state.tasks[`${dayId}_${sl}`] = items;
      updateNavProgress();
      if (state.currentPage === dayId)   MX.Pages.Checklist.render(dayId);
      if (state.currentPage === "home")  MX.Pages.Home.render();
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenProducts(list => {
      state.products = list;
      updateNavProgress();
      if (state.currentPage === "orders") MX.Pages.Orders.render();
      if (state.currentPage === "home")   MX.Pages.Home.render();
      if (state.currentPage === "admin")  MX.Pages.Admin.render();
    });

    DB.listenMessages(list => {
      state.messages = list;
      if (state.currentPage === "msgs") _markMsgsSeen();
      updateNavProgress();
      if (state.currentPage === "msgs")  MX.Pages.Messages.render();
      if (state.currentPage === "home")  MX.Pages.Home.render();
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenUsers(list => {
      state.users = list;
      // Auto-restore session from localStorage after PC restart
      if (!state.currentUser && !state.adminUser) {
        try {
          const saved = localStorage.getItem("mx_user");
          if (saved) {
            const u = JSON.parse(saved);
            const found = list.find(lu => lu.id === u.id);
            if (found) MX.Auth.setCurrentUser(found);
          }
        } catch(e) {}
      }
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenLogs(list => {
      state.logs = list;
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenTransfers(list => {
      state.transfers = list;
      updateNavProgress();
      if (MX.DAYS.find(d => d.id === state.currentPage)) MX.Pages.Checklist.render(state.currentPage);
    });

    DB.listenMissions(list => {
      _notifyNewMissions(MX.state.missions || [], list);
      state.missions = list;
      updateNavProgress();
      if (MX.DAYS.find(d => d.id === state.currentPage)) MX.Pages.Checklist.render(state.currentPage);
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenRespTasks(list => {
      state.respTasks = list;
      updateNavProgress();
      if (state.currentPage === "resp-plan") MX.Pages.RespPlan.render();
      if (state.currentPage && state.currentPage.startsWith("resp-") && state.currentPage !== "resp-plan")
        MX.Pages.RespPlan.renderDay(state.currentPage.slice(5));
    });

    DB.listenPlanning(url => {
      state.planningUrl = url;
      if (state.currentPage === "home") MX.Pages.Home.render();
    });

    DB.listenNotes(data => {
      state.notes = data;
      if (MX.DAYS.find(d => d.id === state.currentPage)) MX.Pages.Checklist.render(state.currentPage);
    });

    DB.listenHistory(list => {
      state.history = list;
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });
  }

  // ── INIT ──
  async function init() {
    const loadingTimeout = setTimeout(hideLoading, 4000);

    document.getElementById("modal-bg").addEventListener("click", e => {
      if (e.target === e.currentTarget) MX.closeModal();
    });

    MX.Auth.onLogin(() => {
      buildDeskHeader();
      if (MX.state.currentPage === "admin") MX.Pages.Admin.render();
      if (MX.state.currentPage === "home")  MX.Pages.Home.render();
      setTimeout(() => MX.showNotifOnboarding && MX.showNotifOnboarding(), 1500);
    });
    MX.Auth.onLogout(() => {
      buildDeskHeader();
      if (MX.state.currentPage === "admin") MX.Pages.Admin.render();
      if (MX.state.currentPage === "home")  MX.Pages.Home.render();
    });

    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      MX._installPrompt = e;
      MX._canInstall = true;
    });
    window.addEventListener("appinstalled", () => { MX._canInstall = false; MX._installPrompt = null; });

    try {
      await MX.DB.initDefaults();
      setupListeners();
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.error("Firebase init error:", e);
    }

    clearTimeout(loadingTimeout);
    hideLoading();

    buildNav();
    MX.showPage(MX.todayId());

    setTimeout(() => { MX.Auth.promptLogin && MX.Auth.promptLogin(); }, 600);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  function hideLoading() {
    const loading = document.getElementById("app-loading");
    const shell   = document.getElementById("app-shell");
    if (!loading || loading.classList.contains("fade-out")) return;
    loading.classList.add("fade-out");
    shell.classList.remove("hidden");
    setTimeout(() => { loading.style.display = "none"; }, 400);
  }

  window.MX.tryInstall = function() {
    if (MX._installPrompt) {
      MX._installPrompt.prompt();
      MX._installPrompt.userChoice.then(() => { MX._installPrompt = null; MX._canInstall = false; });
    }
  };

  window.MX.enableNotifications = async function() {
    if (!("Notification" in window)) {
      MX.toast("Notifications non supportées sur ce navigateur", true); return;
    }
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (isIos && !isStandalone) {
      MX.showModal(
        "Installer l'app d'abord",
        "Sur iPhone/iPad, les notifications nécessitent que l'app soit installée. Appuyez sur 📤 puis « Sur l'écran d'accueil ».",
        [{ label: "OK", cls: "cancel" }]
      );
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      MX.toast("Notifications activées ✓");
      const cu = MX.state.currentUser;
      const ad = MX.state.adminUser;
      if (cu) MX.Auth.setCurrentUser(cu);
      else if (ad) { /* FCM register triggered by auth state */ }
    } else {
      MX.toast("Notifications refusées — vérifiez les réglages", true);
    }
    MX.Auth.updateSidebarFooter && MX.Auth.updateSidebarFooter();
  };

  // ── NOTIFICATION ONBOARDING ──
  window.MX.showNotifOnboarding = function() {
    if (localStorage.getItem("mx_notif_prompted")) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") {
      localStorage.setItem("mx_notif_prompted", "1");
      return;
    }
    localStorage.setItem("mx_notif_prompted", "1");

    const isIos        = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true ||
                         window.matchMedia("(display-mode: standalone)").matches;

    const existing = document.getElementById("notif-onboard");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "notif-onboard";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(8,11,20,0.85);z-index:600;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(8px)";

    overlay.innerHTML = (isIos && !isStandalone)
      ? `<div class="nof-sheet">
          <div class="nof-handle"></div>
          <div style="text-align:center;margin-bottom:20px">
            <div class="nof-icon" style="background:var(--bg4);border:1px solid var(--border3);color:var(--text2)">
              <i class="fas fa-mobile-screen"></i>
            </div>
            <div style="font-size:19px;font-weight:700;margin-bottom:8px">Installer Maintix</div>
            <div style="font-size:13px;color:var(--text2);line-height:1.6">
              Sur iPhone/iPad, les notifications nécessitent que l'app soit installée sur votre écran d'accueil.
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
            <div class="nof-step"><div class="nof-step-n">1</div><div>Appuyez sur <i class="fas fa-arrow-up-from-bracket" style="color:var(--cyan)"></i> <strong>Partager</strong> en bas de Safari</div></div>
            <div class="nof-step"><div class="nof-step-n">2</div><div>Choisissez <strong>"Sur l'écran d'accueil"</strong></div></div>
            <div class="nof-step"><div class="nof-step-n">3</div><div>Ouvrez Maintix depuis l'icône installée</div></div>
          </div>
          <button class="nof-btn-cancel" onclick="MX._closeNotifOnboard()">
            <i class="fas fa-check"></i> Compris, j'installe !
          </button>
        </div>`
      : `<div class="nof-sheet">
          <div class="nof-handle"></div>
          <div style="text-align:center;margin-bottom:24px">
            <div class="nof-icon" style="background:var(--cyan-dim);border:1px solid var(--cyan-border);color:var(--cyan)">
              <i class="fas fa-bell"></i>
            </div>
            <div style="font-size:19px;font-weight:700;margin-bottom:8px">Activer les notifications</div>
            <div style="font-size:13px;color:var(--text2);line-height:1.6;max-width:320px;margin:0 auto">
              Soyez alerté en temps réel des nouvelles interventions et tâches qui vous sont assignées.
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button class="nof-btn-primary" onclick="MX._doNotifPermission()">
              <i class="fas fa-bell"></i> Activer les notifications
            </button>
            <button class="nof-btn-cancel" onclick="MX._closeNotifOnboard()">Plus tard</button>
          </div>
        </div>`;

    overlay.addEventListener("click", e => { if (e.target === overlay) MX._closeNotifOnboard(); });
    document.body.appendChild(overlay);
  };

  window.MX._closeNotifOnboard = function() {
    const el = document.getElementById("notif-onboard");
    if (!el) return;
    el.style.transition = "opacity 0.2s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  };

  window.MX._doNotifPermission = async function() {
    MX._closeNotifOnboard();
    await MX.enableNotifications();
  };

  window.MX.buildNav          = buildNav;
  window.MX.buildDeskHeader   = buildDeskHeader;
  window.MX.updateNavProgress = updateNavProgress;

  document.addEventListener("DOMContentLoaded", init);
})();
