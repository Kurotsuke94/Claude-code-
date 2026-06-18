(function () {
  const NAV = [
    { id: "msgs",     icon: "fa-comments",     l: "Messages",  badge: true },
    { id: "home",     icon: "fa-house",         l: "Accueil" },
    null,
    { id: "lundi",    icon: "fa-1",             l: "Lundi",    day: true },
    { id: "mardi",    icon: "fa-2",             l: "Mardi",    day: true },
    { id: "mercredi", icon: "fa-3",             l: "Mercredi", day: true },
    { id: "jeudi",    icon: "fa-4",             l: "Jeudi",    day: true },
    { id: "vendredi", icon: "fa-5",             l: "Vendredi", day: true },
    { id: "samedi",   icon: "fa-6",             l: "Sam",      day: true },
    { id: "dimanche", icon: "fa-7",             l: "Dim",      day: true },
    null,
    { id: "orders",   icon: "fa-box",           l: "Stock",    badge: false },
    { id: "admin",    icon: "fa-shield-halved", l: "Admin" }
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
    document.getElementById("topbar-title").textContent = NAV.find(n => n && n.id === id)?.l || "Maintix";
    document.querySelectorAll(".nav-item[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === id));
    document.querySelectorAll(".bn[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === id));
    MX.closeSidebar();
    renderPage(id);
  };

  function renderPage(id) {
    const { Pages, DAYS } = MX;
    if (id === "home")   return Pages.Home.render();
    if (id === "msgs")   return Pages.Messages.render();
    if (id === "orders") return Pages.Orders.render();
    if (id === "admin")  return Pages.Admin.render();
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

  // ── BUILD NAVIGATION ──
  function buildNav() {
    const sideNav  = document.getElementById("sidebar-nav");
    const botNav   = document.getElementById("bottom-nav");
    const { DAYS, SLOTS, getDaySlots, state } = MX;

    let sideHtml = "";
    let botHtml  = `<div class="bottom-nav-inner">`;

    sideHtml += `<div class="nav-section-label">PRINCIPAL</div>`;
    let sepCount = 0;

    NAV.forEach(item => {
      if (!item) {
        sideHtml += `<div class="nav-section-label">${SECTION_LABELS[sepCount] || ''}</div>`;
        sepCount++;
        return;
      }
      const isActive = item.id === state.currentPage;

      let prog = "", progCls = "";
      if (item.day) {
        const day = DAYS.find(d => d.id === item.id);
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

      sideHtml += `<button class="nav-item ${isActive?'active':''}" data-page="${item.id}" onclick="MX.showPage('${item.id}')">
        <span class="nav-icon"><i class="fas ${item.icon}"></i></span>
        <span class="nav-label">${item.l}</span>
        ${item.badge ? `<span class="nav-badge" id="nb_${item.id}"></span>` : ''}
        ${prog ? `<span class="nav-prog ${progCls}" id="np_${item.id}">${prog}</span>` : ''}
      </button>`;

      botHtml += `<button class="bn ${isActive?'active':''}" data-page="${item.id}" onclick="MX.showPage('${item.id}')">
        <div class="bn-bar"></div>
        <i class="fas ${item.icon}"></i>
        ${item.badge ? `<span class="nav-badge" id="bnb_${item.id}"></span>` : ''}
        <span>${item.l}</span>
      </button>`;
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
          new Notification("Nouvelle mission", { body: m.text + (m.createdBy ? " — de " + m.createdBy : ""), icon: "/assets/icons/icon-192.png" });
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
      if (state.currentPage === "home")   MX.Pages.Home.render();
      if (state.currentPage === "orders") MX.Pages.Orders.render();
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

  window.MX.buildNav          = buildNav;
  window.MX.buildDeskHeader   = buildDeskHeader;
  window.MX.updateNavProgress = updateNavProgress;

  document.addEventListener("DOMContentLoaded", init);
})();
