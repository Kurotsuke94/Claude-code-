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

  // ── PAGE ROUTING ──
  window.MX.showPage = function (id) {
    MX.state.currentPage = id;
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

    NAV.forEach(item => {
      if (!item) {
        sideHtml += `<div style="height:1px;background:var(--border);margin:6px 8px"></div>`;
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

    const cnt     = (state.messages || []).length;
    const badge   = document.getElementById("nb_msgs");
    if (badge) { badge.textContent = cnt > 9 ? "9+" : cnt; badge.className = "nav-badge" + (cnt ? " show" : ""); }
    const bnBadge = document.getElementById("bnb_msgs");
    if (bnBadge) { bnBadge.textContent = cnt > 9 ? "9+" : cnt; bnBadge.className = "nav-badge" + (cnt ? " show" : ""); }
  }

  // ── FIRESTORE LISTENERS ──
  function setupListeners() {
    const { DB, state } = MX;

    DB.listenWeek(data => {
      state.weekLabel = data.label || "";
      state.weekNum   = data.num   || 1;
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
  }

  // ── INIT ──
  async function init() {
    const loadingTimeout = setTimeout(hideLoading, 4000);

    document.getElementById("modal-bg").addEventListener("click", e => {
      if (e.target === e.currentTarget) MX.closeModal();
    });

    MX.Auth.onLogin(() => {
      if (MX.state.currentPage === "admin") MX.Pages.Admin.render();
    });
    MX.Auth.onLogout(() => {
      if (MX.state.currentPage === "admin") MX.Pages.Admin.render();
    });

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

    // Prompt user login after data loads
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

  window.MX.buildNav          = buildNav;
  window.MX.updateNavProgress = updateNavProgress;

  document.addEventListener("DOMContentLoaded", init);
})();
