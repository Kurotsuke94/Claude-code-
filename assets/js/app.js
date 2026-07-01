(function () {
  const NAV = [
    { id: "home",          icon: "fa-house",          l: "Accueil" },
    { id: "msgs",          icon: "fa-comments",       l: "Messages",        badge: true },
    null,
    { id: "today-cl",      icon: "fa-list-check",     l: "Aujourd'hui",     todayShortcut: true },
    { id: "lundi",         icon: "fa-1",              l: "Lundi",           day: true },
    { id: "mardi",         icon: "fa-2",              l: "Mardi",           day: true },
    { id: "mercredi",      icon: "fa-3",              l: "Mercredi",        day: true },
    { id: "jeudi",         icon: "fa-4",              l: "Jeudi",           day: true },
    { id: "vendredi",      icon: "fa-5",              l: "Vendredi",        day: true },
    { id: "samedi",        icon: "fa-6",              l: "Sam",             day: true },
    { id: "dimanche",      icon: "fa-7",              l: "Dim",             day: true },
    null,
    { id: "orders",        icon: "fa-box",            l: "Stock & Commandes" },
    { id: "fournisseurs",  icon: "fa-truck",          l: "Fournisseurs",    noBot: true },
    { id: "documents",     icon: "fa-book",           l: "Bible Maintix",   noBot: true },
    null,
    { id: "utilisateurs",  icon: "fa-users",          l: "Admin" },
    { id: "parametres",    icon: "fa-gear",           l: "Paramètres",      noBot: true },
    { id: "badges",        icon: "fa-medal",          l: "Badges",          noBot: true },
    { id: "notifs",        icon: "fa-bell",            l: "Notifications", noBot: true },
    { id: "planning",      icon: "fa-calendar-days",  l: "Planning" },
    { id: "org-resp",      icon: "fa-users",          l: "Organisation Responsable", respOnly: true },
  ];

  const BIBLE_CATS = [
    { id:"electricite", icon:"fa-bolt",               l:"Électricité" },
    { id:"mecanique",   icon:"fa-gears",              l:"Mécanique" },
    { id:"automatisme", icon:"fa-robot",              l:"Automatisme" },
    { id:"hydraulique", icon:"fa-droplet",            l:"Hydraulique" },
    { id:"pneumatique", icon:"fa-wind",               l:"Pneumatique" },
    { id:"procedures",  icon:"fa-clipboard-list",     l:"Procédures" },
    { id:"depannages",  icon:"fa-screwdriver-wrench", l:"Dépannages" },
    { id:"tutoriels",   icon:"fa-film",               l:"Tutoriels" },
    { id:"ressources",  icon:"fa-globe",              l:"Ressources Ext." },
  ];

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
    const _prevPage = MX.state.currentPage;
    MX.state.currentPage = id;
    if (_prevPage === 'documents' && id !== 'documents') {
      MX.Pages.Bible && MX.Pages.Bible._destroy && MX.Pages.Bible._destroy();
    }
    if (_prevPage === 'planning' && id !== 'planning') {
      MX.Pages.Planning && MX.Pages.Planning._destroy && MX.Pages.Planning._destroy();
    }
    if (id === "msgs") { _markMsgsSeen(); updateNavProgress(); }
    const navItem = NAV.find(n => n && n.id === id);
    const navInfo = NAV_INFO[id] || {};
    const title   = id === "today-cl"
      ? (MX.DAYS.find(d => d.id === MX.todayId())?.l || "Aujourd'hui")
      : id === "mes-missions" ? "Mes missions"
      : (navItem?.l || navInfo.l || "Maintix");
    document.getElementById("topbar-title").textContent = title;
    document.querySelectorAll(".sx-item[data-page],.bn[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === id));
    MX.closeSidebar();
    renderPage(id);
  };

  function renderPage(id) {
    const { Pages, DAYS } = MX;
    if (id === "home")         return Pages.Home.render();
    if (id === "msgs")         return Pages.Messages.render();
    if (id === "orders")       return Pages.Orders.render();
    if (id === "utilisateurs") return Pages.Admin.render();
    if (id === "parametres")   return Pages.Settings ? Pages.Settings.render() : null;
    if (id === "admin")        return Pages.Admin.render();
    if (id === "badges")       return Pages.Badges ? Pages.Badges.render() : null;
    if (id === "planning")      return Pages.Planning ? Pages.Planning.render() : null;
    if (id === "consommations") return Pages.Conso ? Pages.Conso.render() : _renderStub("Consommations", "fa-droplet", "Chargement…");
    if (id === "interventions") return Pages.Int  ? Pages.Int.render()  : _renderStub("Interventions", "fa-wrench", "Chargement…");
    if (id === "org-resp")      return Pages.OrgResp ? Pages.OrgResp.render() : null;
    if (id === "mes-missions")  return Pages.MesMissions ? Pages.MesMissions.render() : (Pages.Checklist.renderForRole ? Pages.Checklist.renderForRole() : null);
    if (id === "today-cl")     return Pages.Checklist.renderForRole ? Pages.Checklist.renderForRole() : Pages.Checklist.render(MX.todayId());
    if (id === "notifs")       return Pages.Notifications ? Pages.Notifications.render() : _renderStub("Notifications", "fa-bell", "Chargement…");
    if (id === "fournisseurs") return _renderStub("Fournisseurs", "fa-truck", "La gestion des fournisseurs sera disponible prochainement.");
    if (id === "equipe")       return Pages.Equipe ? Pages.Equipe.render() : null;
    if (id === "documents")    return Pages.Bible ? Pages.Bible.render() : _renderStub("Bible Maintix", "fa-book", "Chargement…");
    if (DAYS.find(d => d.id === id)) return Pages.Checklist.render(id);
  }

  function _renderStub(title, icon, msg) {
    const mc = document.getElementById("main-content");
    if (!mc) return;
    mc.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;color:var(--text3);padding:40px">
      <i class="fas ${MX.esc(icon)}" style="font-size:48px;opacity:0.3"></i>
      <div style="font-size:18px;font-weight:700;color:var(--text2)">${MX.esc(title)}</div>
      <div style="font-size:13px;text-align:center;max-width:300px">${MX.esc(msg)}</div>
    </div>`;
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

  // ── NAV ACCORDION STATE ──
  let _plngOpen  = localStorage.getItem("mx_sx_plng")  !== "0";
  let _maintOpen = localStorage.getItem("mx_sx_maint") !== "0";
  let _gestOpen  = localStorage.getItem("mx_sx_gest")  === "1";
  let _anlyOpen  = localStorage.getItem("mx_sx_anly")  === "1";
  let _adminOpen = localStorage.getItem("mx_sx_adm")   === "1";
  let _compact   = localStorage.getItem("mx_sx_compact") === "1";

  function _sx(k, v) { localStorage.setItem(k, v ? "1" : "0"); }

  function _toggleSec(which) {
    const mob = window.innerWidth <= 900;
    if (mob) {
      const wasPlng = _plngOpen, wasMaint = _maintOpen, wasGest = _gestOpen,
            wasAnly = _anlyOpen, wasAdm = _adminOpen;
      _plngOpen = false; _maintOpen = false; _gestOpen = false;
      _anlyOpen = false; _adminOpen = false;
      if (which === "plng") _plngOpen  = !wasPlng;
      if (which === "maint") _maintOpen = !wasMaint;
      if (which === "gest") _gestOpen  = !wasGest;
      if (which === "anly") _anlyOpen  = !wasAnly;
      if (which === "adm")  _adminOpen = !wasAdm;
    } else {
      if (which === "plng") _plngOpen  = !_plngOpen;
      if (which === "maint") _maintOpen = !_maintOpen;
      if (which === "gest") _gestOpen  = !_gestOpen;
      if (which === "anly") _anlyOpen  = !_anlyOpen;
      if (which === "adm")  _adminOpen = !_adminOpen;
    }
    _sx("mx_sx_plng",  _plngOpen);
    _sx("mx_sx_maint", _maintOpen);
    _sx("mx_sx_gest",  _gestOpen);
    _sx("mx_sx_anly",  _anlyOpen);
    _sx("mx_sx_adm",   _adminOpen);
    buildNav();
  }

  window.MX.toggleNavPlng  = function() { _toggleSec("plng"); };
  window.MX.toggleNavMaint = function() { _toggleSec("maint"); };
  window.MX.toggleNavGest  = function() { _toggleSec("gest"); };
  window.MX.toggleNavAnly  = function() { _toggleSec("anly"); };
  window.MX.toggleNavAdmin = function() { _toggleSec("adm"); };
  window.MX.showCsoTab     = function(tab) { window._csoStartTab = tab; MX.showPage('consommations'); };
  window.MX.showIntTab     = function(tab) { window._intStartTab = tab; MX.showPage('interventions'); };

  window.MX.toggleCompact = function() {
    if (window.innerWidth <= 900) {
      MX.closeSidebar();
      return;
    }
    _compact = !_compact;
    _sx("mx_sx_compact", _compact);
    const sb = document.getElementById("sidebar");
    if (sb) sb.classList.toggle("sx-compact", _compact);
    buildNav();
  };

  // ── FAVORITES (Accès Rapide) ──
  const NAV_INFO = {
    'home':          { icon: 'fa-house',           l: 'Accueil' },
    'msgs':          { icon: 'fa-comments',        l: 'Messages' },
    'planning':      { icon: 'fa-calendar-days',   l: 'Planning' },
    'today-cl':      { icon: 'fa-list-check',      l: 'Checklists' },
    'mes-missions':  { icon: 'fa-list-check',      l: 'Mes missions' },
    'org-resp':      { icon: 'fa-users-gear',      l: 'Organisation' },
    'orders':        { icon: 'fa-box',             l: 'Stock' },
    'documents':     { icon: 'fa-book',            l: 'Bibliothèque' },
    'consommations': { icon: 'fa-gauge-high',       l: 'Compteurs' },
    'interventions': { icon: 'fa-wrench',          l: 'Interventions' },
    'utilisateurs':  { icon: 'fa-users',           l: 'Utilisateurs' },
    'equipe':        { icon: 'fa-users-gear',      l: 'Équipe' },
    'badges':        { icon: 'fa-medal',           l: 'Badges' },
  };

  let _favsCache = null;

  function _userId() {
    const cu = MX.state.currentUser;
    const ad = MX.state.adminUser;
    if (cu) return (cu.name || cu.id || 'user').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    if (ad) return (ad.email || 'admin').split('@')[0].replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return null;
  }
  function _favLsKey() { return 'mx_favs_' + (_userId() || 'default'); }
  function _getFavsLocal() {
    try { return JSON.parse(localStorage.getItem(_favLsKey()) || '[]'); } catch(e) { return []; }
  }
  function _getFavs() {
    return _favsCache !== null ? _favsCache : _getFavsLocal();
  }
  async function _loadFavsFromFirestore() {
    const uid = _userId();
    if (!uid) { _favsCache = _getFavsLocal(); return; }
    try {
      const doc = await db.collection('user_prefs').doc(uid).get();
      const data = doc.exists ? doc.data() : null;
      _favsCache = (data && Array.isArray(data.favs)) ? data.favs : _getFavsLocal();
    } catch(e) {
      console.warn('[Favs] load:', e.message);
      _favsCache = _getFavsLocal();
    }
  }
  async function _saveFavsToFirestore(arr) {
    localStorage.setItem(_favLsKey(), JSON.stringify(arr));
    const uid = _userId();
    if (!uid) return;
    try {
      await db.collection('user_prefs').doc(uid).set({ favs: arr }, { merge: true });
    } catch(e) { console.warn('[Favs] save:', e.message); }
  }

  window.MX.toggleFav = function(pageId, label) {
    const favs = _getFavs().slice();
    const idx  = favs.findIndex(f => f.id === pageId);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      if (favs.length >= 4) { MX.toast('Maximum 4 favoris atteint'); return; }
      favs.push({ id: pageId, label });
    }
    _favsCache = favs;
    buildNav();
    _saveFavsToFirestore(favs);
  };

  window.MX.reloadFavs = async function() {
    _favsCache = null;
    await _loadFavsFromFirestore();
    buildNav();
  };

  // ── PLANNING VIEW NAVIGATION ──
  window.MX.showPlanningView = function(view, filter) {
    if (MX.Pages.Planning && MX.Pages.Planning._setViewExternal) {
      MX.Pages.Planning._setViewExternal(view, filter || '');
    }
    MX.showPage('planning');
  };

  window.MX.showBibleCat = function(catId) {
    MX.state._bibleStartCat = catId;
    MX.showPage("documents");
  };
  window.MX.showAdminTab = function(tabId) {
    localStorage.setItem("mx_admin_tab", tabId);
    MX.showPage("utilisateurs");
  };

  // ── BUILD NAVIGATION ──
  function buildNav() {
    const sideNav = document.getElementById("sidebar-nav");
    const botNav  = document.getElementById("bottom-nav");
    if (!sideNav) return;
    const { DAYS, state } = MX;
    const cur    = state.currentPage || "";
    const canAll = MX.Auth.canSeeAll();

    // Role-based nav filter: only apply when a PIN user has a roleId assigned
    const _cu  = state.currentUser;
    const _see = (!MX.Auth.isAdmin() && _cu && _cu.roleId)
      ? (mod) => MX.Auth.can(mod, 'view')
      : () => true;

    function _item(id, icon, label, opts) {
      const o   = opts || {};
      const act = cur === id || (o.matchPages && o.matchPages.includes(cur));
      const cls = ["sx-item", o.sub ? "sx-sub" : "", act ? "active" : ""].filter(Boolean).join(" ");
      const fn  = o.fn || `MX.showPage('${id}')`;
      let r = "";
      if (o.badge)    r += `<span class="sx-badge" id="sxb_${id}"></span>`;
      if (o.dynBadge) r += `<span class="sx-dyn-badge" id="sxdb_${o.dynBadge}"></span>`;
      let star = '';
      if (o.favable && id) {
        const isFav = _getFavs().some(f => f.id === id);
        star = `<span class="sx-fav-star${isFav ? ' sx-fav-star--on' : ''}" onclick="event.stopPropagation();MX.toggleFav('${id}','${label}')" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}"><i class="fas fa-star"></i></span>`;
      }
      return `<button class="${cls}"${id ? ` data-page="${id}"` : ""} onclick="${fn}" title="${label}"><i class="fas ${icon} sx-ico${act ? " sx-ico--on" : ""}"></i><span class="sx-lbl">${label}</span>${r}${star}</button>`;
    }
    function _group(icon, icoCls, label, key, toggleFn, open, items, favId, favLabel) {
      let star = '';
      if (favId) {
        const isFav = _getFavs().some(f => f.id === favId);
        star = `<span class="sx-fav-star${isFav ? ' sx-fav-star--on' : ''}" onclick="event.stopPropagation();MX.toggleFav('${favId}','${favLabel || favId}')" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}"><i class="fas fa-star"></i></span>`;
      }
      return `<div class="sx-group">
    <button class="sx-group-hdr${open ? ' sx-group-hdr--open' : ''}" onclick="MX.${toggleFn}()" title="${label}">
      <i class="fas fa-chevron-right sx-group-chev"></i>
      <span class="sx-group-ico ${icoCls}"><i class="fas ${icon}"></i></span>
      <span class="sx-group-lbl">${label}</span>
      ${star}
    </button>
    ${open ? `<div class="sx-group-body">${items}</div>` : ''}
  </div>`;
    }

    let h = "";

    // ── Compact toggle ──
    h += `<button class="sx-compact-btn" onclick="MX.toggleCompact()" title="${_compact ? "Étendre" : "Réduire"}">
      <i class="fas fa-${_compact ? "angles-right" : "angles-left"}"></i><span class="sx-lbl">${_compact ? "" : "Réduire"}</span>
    </button>`;

    // ── 🏠 Accueil ──
    h += `<div class="sx-top">`;
    h += _item("home", "fa-house", "Accueil", { favable: true });
    h += `</div>`;

    // ── ⭐ Accès Rapide (favorites) ──
    const favs = _getFavs();
    h += `<div class="sx-quick">`;
    h += `<div class="sx-quick-hdr"><i class="fas fa-star sx-quick-star"></i><span class="sx-lbl">Accès Rapide</span>${favs.length > 0 ? `<span class="sx-quick-cnt">${favs.length}/4</span>` : ''}</div>`;
    if (favs.length > 0) {
      favs.forEach(f => {
        const fInfo = NAV_INFO[f.id] || {};
        const fAct  = cur === f.id;
        h += `<div class="sx-fav-row">
          <button class="sx-item sx-sub${fAct ? " active" : ""}" data-page="${f.id}" onclick="MX.showPage('${f.id}')" title="${f.label}" style="flex:1;min-width:0">
            <i class="fas ${fInfo.icon || "fa-circle"} sx-ico${fAct ? " sx-ico--on" : ""}"></i>
            <span class="sx-lbl">${f.label}</span>
          </button>
          <span class="sx-fav-rm" onclick="MX.toggleFav('${f.id}','${f.label}')" title="Retirer des favoris"><i class="fas fa-times"></i></span>
        </div>`;
      });
    } else {
      h += `<div class="sx-quick-empty"><span class="sx-lbl">Cliquez ⭐ sur un module pour l'épingler</span></div>`;
    }
    h += `</div>`;

    // ── 📋 PRIMARY MODULES (flat nav, no accordion) ──
    const clPages = ["today-cl", "mes-missions", ...DAYS.map(d => d.id)];
    h += `<div class="sx-modules">`;
    h += `<div class="sx-mod-sep"><span class="sx-lbl">Modules</span></div>`;
    if (_see('checklist'))    h += _item("mes-missions",  "fa-list-check",    "Missions",      { favable: true, matchPages: clPages });
    if (_see('counters'))     h += _item("consommations", "fa-gauge-high",    "Compteurs",     { favable: true, fn: "MX.showCsoTab('compteurs')" });
    if (_see('interventions'))h += _item("interventions", "fa-wrench",        "Interventions", { favable: true, dynBadge: "int" });
    if (_see('planning'))     h += _item("planning",      "fa-calendar-days", "Planning",      { favable: true });
    h += `</div>`;

    // ── DIVIDER ──
    h += `<div class="sx-divider" aria-hidden="true"></div>`;

    // ── 📦 Gestion ──
    let gestItems = "";
    if (_see('stock'))     gestItems += _item("orders",    "fa-box",      "Stock",       { sub: true, dynBadge: "stock", favable: true });
    if (_see('resources')) gestItems += _item("documents", "fa-book",     "Ressources",  { sub: true, favable: true });
    if (_see('messages'))  gestItems += _item("msgs",      "fa-comments", "Messages",    { sub: true, badge: true, favable: true });
    if (gestItems)
      h += _group("fa-cube", "sx-group-ico--cyan", "Gestion", "gest", "toggleNavGest", _gestOpen, gestItems, "orders", "Stock");

    // ── 📊 Analyses ──
    if (_see('counters') || _see('consumption')) {
      let anlyItems = "";
      [
        { tab: "dashboard", icon: "fa-gauge",       l: "Tableau de bord" },
        { tab: "releves",   icon: "fa-camera",      l: "Relevés" },
        { tab: "analyses",  icon: "fa-percent",     l: "Ratios" },
        { tab: "alertes",   icon: "fa-bell",        l: "Alertes" },
        { tab: "exports",   icon: "fa-file-export", l: "Exportations" },
      ].forEach(t => {
        anlyItems += `<button class="sx-item sx-sub" onclick="MX.showCsoTab('${t.tab}')" title="${t.l}"><i class="fas ${t.icon} sx-ico"></i><span class="sx-lbl">${t.l}</span></button>`;
      });
      h += _group("fa-chart-bar", "sx-group-ico--green", "Analyses", "anly", "toggleNavAnly", _anlyOpen, anlyItems, "consommations", "Analyses");
    }

    // ── 🎯 Centre de Pilotage (respOnly) ──
    if (canAll) {
      const isAdmin = MX.Auth.isAdmin();
      function _tabBtn(tabId, icon, label) {
        return `<button class="sx-item sx-sub" onclick="MX.showAdminTab('${tabId}')" title="${label}"><i class="fas ${icon} sx-ico"></i><span class="sx-lbl">${label}</span></button>`;
      }
      function _pageBtn(pageId, icon, label) {
        return `<button class="sx-item sx-sub" onclick="MX.showPage('${pageId}')" title="${label}"><i class="fas ${icon} sx-ico"></i><span class="sx-lbl">${label}</span></button>`;
      }
      function _sec(label) {
        return `<div class="sx-sec-sep"><span>${label}</span></div>`;
      }
      let aItems = "";
      aItems += _sec("PILOTAGE");
      aItems += _tabBtn("tasks",          "fa-chart-bar",        "Tableau Responsable");
      aItems += _pageBtn("org-resp",      "fa-clipboard-list",   "Organisation Responsable");
      aItems += _tabBtn("week",           "fa-calendar-week",    "Gestion Semaines");

      aItems += _sec("ÉQUIPE");
      aItems += _tabBtn("team",           "fa-users-gear",       "Gestion Équipe");
      aItems += _tabBtn("users",          "fa-users",            "Utilisateurs");
      aItems += _tabBtn("roles",          "fa-shield-halved",    "Rôles");

      aItems += _sec("SUPERVISION");
      aItems += _tabBtn("alerts",         "fa-bell",             "Alertes");
      aItems += _tabBtn("alertes-config", "fa-bell-concierge",   "Config Alertes");
      aItems += _tabBtn("logs",           "fa-chart-line",       "Activité");
      aItems += _tabBtn("history",        "fa-clock-rotate-left","Historique");

      aItems += _sec("CONNAISSANCES");
      aItems += _tabBtn("bible-admin",    "fa-book-open",        "Validation Bible");
      aItems += _tabBtn("badges-admin",   "fa-medal",            "Badges");

      if (isAdmin) {
        aItems += `<div class="sx-admin-sep"><span>Super Admin</span></div>`;
        aItems += _tabBtn("superadmin",   "fa-hotel",           "Hôtels & Config");
        aItems += _tabBtn("pin",          "fa-key",             "Codes PIN & Accès");
      }
      const _alertCnt = (MX.state.triggeredAlerts || []).filter(a => !a.acknowledged).length;
      const _alertBadge = _alertCnt ? `<span class="sx-dyn-badge" id="sxdb_alert-badge" style="display:inline-flex">${_alertCnt}</span>` : `<span class="sx-dyn-badge" id="sxdb_alert-badge" style="display:none"></span>`;
      h += _group("fa-crosshairs", "sx-group-ico--cyan", "Centre de Pilotage" + _alertBadge, "adm", "toggleNavAdmin", _adminOpen, aItems, "utilisateurs", "Centre de Pilotage");
    }

    // ── Paramètres (standalone) ──
    h += `<div class="sx-params">`;
    h += _item("parametres", "fa-gear", "Paramètres");
    h += `</div>`;

    sideNav.innerHTML = h;

    // Apply compact class — never on mobile (no compact mode on mobile)
    const sidebar = document.getElementById("sidebar");
    const isMob = window.innerWidth <= 900;
    if (sidebar) sidebar.classList.toggle("sx-compact", _compact && !isMob);

    // ── Bottom nav (mobile) — floating bar: Accueil | Missions | Compteurs | ➕ | Planning | Pilotage ──
    const dayIds = DAYS.map(d => d.id);
    const allCl  = ["today-cl", "mes-missions", ...dayIds];
    let bot = `<div class="mbn-bar">`;
    bot += `<button class="mbn-btn${cur==="home"?" mbn-act":""}" onclick="MX.showPage('home')"><i class="fas fa-house"></i><span>Accueil</span></button>`;
    bot += `<button class="mbn-btn${allCl.includes(cur)?" mbn-act":""}" onclick="MX.showPage('mes-missions')"><i class="fas fa-list-check"></i><span>Missions</span></button>`;
    bot += `<button class="mbn-fab" id="mbn-fab-btn" onclick="MX.openFabMenu()"><i class="fas fa-plus"></i></button>`;
    bot += `<button class="mbn-btn${cur==="consommations"?" mbn-act":""}" onclick="MX.showCsoTab('compteurs')"><i class="fas fa-gauge-high"></i><span>Compteurs</span></button>`;
    bot += `<button class="mbn-btn${cur==="planning"?" mbn-act":""}" onclick="MX.showPage('planning')"><i class="fas fa-calendar-days"></i><span>Planning</span></button>`;
    bot += `</div>`;
    botNav.innerHTML = bot;

    _updBadges();
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
      const _cuRoleDef = (MX.state.roles || []).find(r => r.id === cu.roleId);
      const lbl = _cuRoleDef ? (_cuRoleDef.emoji ? _cuRoleDef.emoji + ' ' + _cuRoleDef.name : _cuRoleDef.name) : (cu.role === 'responsable' ? 'Responsable' : 'Technicien');
      const _dhBorder = MX.badgeBorder ? MX.badgeBorder(cu.name) : null;
      userHtml = `<div class="dh-user" onclick="MX.Auth.clearCurrentUser()">
        <div class="dh-avatar" style="background:${bg};color:${fg}${_dhBorder?';border:2px solid '+_dhBorder:''}">${MX.esc(cu.name.substring(0,2).toUpperCase())}</div>
        <div>
          <div style="font-size:12px;font-weight:600;line-height:1.2">${MX.badgeTag ? MX.badgeTag(cu.name) : ''}${MX.esc(cu.name)}</div>
          <div style="font-size:10px;color:var(--text3);line-height:1.2">${lbl}</div>
        </div>
      </div>`;
    } else {
      userHtml = `<div class="dh-user" onclick="MX.Auth.showUserPicker()">
        <div class="dh-avatar" style="background:var(--bg4);color:var(--text3)"><i class="fas fa-user" style="font-size:10px"></i></div>
        <span style="font-size:12px;color:var(--text3)">Connexion</span>
      </div>`;
    }

    const seen      = _getMsgsSeen();
    const unread    = (state.announcements || []).filter(a => _tsMs(a.createdAt) > seen).length;
    const _hasNewVer = localStorage.getItem('mx_last_ver') !== _APP_VER;

    el.innerHTML = `
      <div class="dh-week" id="dh-week-label">
        <i class="fas fa-calendar-week" style="font-size:10px"></i>
        ${MX.esc(state.weekLabel || MX.mkWeekLabel())}
      </div>
      <div class="dh-spacer"></div>
      ${_hasNewVer ? `<button class="dh-btn dh-ver-btn" id="dh-ver-badge" onclick="MX.Updates.showModal()" title="Nouvelle version disponible">
        <i class="fas fa-rocket"></i>
        <span class="nav-badge show" style="background:var(--cyan);color:#0C0C0E;font-size:9px;font-weight:800">NEW</span>
      </button>` : ''}
      <button class="dh-btn" id="notif-bell-btn" onclick="MX.Notifs.toggleDrop()" title="Notifications">
        <i class="fas fa-bell"></i>
        <span class="nav-badge" id="notif-bell-badge"></span>
      </button>
      <button class="dh-btn" onclick="MX.showPage('msgs')" title="Messages">
        <i class="fas fa-comments"></i>
        <span class="nav-badge${unread ? ' show' : ''}" id="dh-bell-badge">${unread > 9 ? '9+' : unread || ''}</span>
      </button>
      ${userHtml}
    `;
  }

  function _updAlertBadge() {
    const alerts = MX.state.triggeredAlerts || [];
    const cnt    = alerts.filter(a => !a.acknowledged).length;
    const el     = document.getElementById('sxdb_alert-badge');
    if (el) { el.textContent = cnt || ''; el.style.display = cnt ? '' : 'none'; }
    MX.Notifs && MX.Notifs.checkNewAlerts && MX.Notifs.checkNewAlerts(alerts);
  }

  function _updBadges() {
    const seen   = _getMsgsSeen();
    const unread = (MX.state.announcements || []).filter(a => _tsMs(a.createdAt) > seen).length;
    const val    = unread > 9 ? "9+" : (unread || "");
    const sxb = document.getElementById("sxb_msgs");
    if (sxb) { sxb.textContent = val; sxb.style.display = unread ? "" : "none"; }
    const bnb = document.getElementById("bnb_msgs");
    if (bnb) { bnb.textContent = val; bnb.className = "nav-badge" + (unread ? " show" : ""); }
    const dhb = document.getElementById("dh-bell-badge");
    if (dhb) { dhb.textContent = val; dhb.className = "nav-badge" + (unread ? " show" : ""); }
  }

  let _navRaf = null;
  function updateNavProgress() {
    if (_navRaf) return;
    _navRaf = requestAnimationFrame(() => { _navRaf = null; _doUpdateNavProgress(); });
  }
  function _doUpdateNavProgress() {
    _lastSyncTime = new Date();
    renderStatusBar();
    const { DAYS, state, getDaySlots } = MX;

    function _upd(id, pct) {
      const c  = pct >= 80 ? "done" : pct >= 40 ? "warn" : "low";
      const pf = document.getElementById("sxpf_" + id);
      const pp = document.getElementById("sxpp_" + id);
      if (pf) { pf.style.width = pct + "%"; pf.className = "sx-fill sx-fill--" + c; }
      if (pp) { pp.textContent = pct + "%";  pp.className = "sx-pct sx-pct--" + c; }
    }

    const todayId = MX.todayId ? MX.todayId() : "lundi";
    DAYS.forEach(day => {
      let t = 0, d = 0;
      getDaySlots(day.id).forEach(sl => {
        (state.tasks[`${day.id}_${sl}`] || []).forEach(task => {
          t++;
          if (state.checks[`${day.id}_${sl}_${task.id}`]) d++;
        });
      });
      const pct = t ? Math.round(d / t * 100) : 0;
      _upd(day.id, pct);
      if (day.id === todayId) _upd("today-cl", pct);
    });

    _updBadges();
  }

  // ── CHANGELOG ──
  window.MX.CHANGELOG = [
    {
      ver: '1.0.33', date: '2026-06-26', emoji: '🔔',
      title: 'Centre de notifications unifié',
      changes: [
        'Icône 🔔 avec compteur dans la barre supérieure',
        'Panneau rapide : 10 dernières notifications par catégorie',
        'Page complète avec filtres : Messages, Interventions, Stock, Badges, Mises à jour, Système',
        'Notifications automatiques : nouveau message, stock faible, badge obtenu, version',
        'Actions : marquer lu, tout marquer lu, archiver, supprimer',
        'Activité récente de l\'accueil synchronisée avec le centre',
      ]
    },
    {
      ver: '1.0.32', date: '2026-06-26', emoji: '🔧',
      title: 'Corrections Sprint 1 & 2',
      changes: [
        'KPI missions cockpit corrigés (schéma admin vs interventions)',
        'Toasts admin corrigés (format boolean)',
        'Optimisation _autoRetard() — batch Firestore + early return',
        'Libération listener Firestore Bible à la navigation',
        'Nom hôtel et utilisateur corrects dans l\'accueil',
      ]
    },
    {
      ver: '1.0.31', date: '2026-06-26', emoji: '🚀',
      title: 'Système de gestion des versions',
      changes: [
        'Notification automatique lors d\'une nouvelle version',
        'Section "Nouveautés" dans Paramètres avec historique complet',
        'Badge "Nouvelle version" dans la barre supérieure',
        'Bannière PWA de mise à jour améliorée',
        'Gestion des versions dans Super Admin (Firestore)',
      ]
    },
    {
      ver: '1.0.30', date: '2026-06-20', emoji: '📊',
      title: 'Dashboard ultrawide & cockpit redesign',
      changes: [
        'Grille cockpit responsive (mobile → 2560px+)',
        'Fil d\'activité enrichi avec missions et messages',
        'Indicateurs d\'évolution des consommations (▲/▼)',
        'KPIs adaptés aux écrans 2560px et 3200px+',
        'Suppression des limitations de largeur ultrawide',
      ]
    },
    {
      ver: '1.0.29', date: '2026-06-10', emoji: '🏨',
      title: 'Configuration hôtel & maintenance BDD',
      changes: [
        'Panel Super Admin avec fiche hôtel complète (14 champs)',
        'Sélecteurs de couleur pour l\'identité visuelle',
        'Outils de maintenance Base de Données (5 opérations)',
        'Suppression du fond industriel/blueprint',
        'Fonctions getHotelConfig / saveHotelConfig en Firestore',
      ]
    },
    {
      ver: '1.0.28', date: '2026-05-15', emoji: '⭐',
      title: 'Badges professionnels & présence temps réel',
      changes: [
        'Système de badges professionnels assignables',
        'Indicateur de présence en temps réel',
        'Heartbeat de présence toutes les 2 minutes',
        'Affichage des badges dans le header utilisateur',
      ]
    },
  ];
  window.MX.appVer = window.MX_VERSION || "1.0.33";

  // ── STATUS BAR ──
  const _APP_VER = window.MX_VERSION || "1.0.33";
  let _lastSyncTime = null;
  let _presenceCount = 0;
  let _pendingSaves  = 0;
  let _isOffline     = !navigator.onLine;

  // Diagnostic counters (dev panel)
  window.MX._dbReads  = 0;
  window.MX._dbWrites = 0;
  window.MX._avgSyncMs = 0;
  let _syncSamples = 0;
  let _syncStart   = 0;

  window.addEventListener('online',  () => { _isOffline = false; renderStatusBar(); MX.toast('🟢 Connexion rétablie — données synchronisées'); });
  window.addEventListener('offline', () => { _isOffline = true;  renderStatusBar(); MX.toast('⚠️ Mode hors ligne', true); });

  // On resize between mobile and desktop: close sidebar + clear overlay to avoid stuck state
  window.addEventListener('resize', (function() {
    var _lastMob = window.innerWidth <= 900;
    return function() {
      var mob = window.innerWidth <= 900;
      if (mob !== _lastMob) {
        _lastMob = mob;
        MX.closeSidebar();
        buildNav();
      }
    };
  })());

  window.MX.syncStart = function () {
    _pendingSaves++;
    if (_pendingSaves === 1) _syncStart = performance.now();
    window.MX._dbWrites++;
    renderStatusBar();
  };
  window.MX.syncEnd   = function () {
    _pendingSaves = Math.max(0, _pendingSaves - 1);
    _lastSyncTime = new Date();
    MX.state._lastSync = _lastSyncTime.getTime();
    if (_pendingSaves === 0 && _syncStart > 0) {
      const elapsed = performance.now() - _syncStart;
      _syncSamples++;
      window.MX._avgSyncMs = window.MX._avgSyncMs + (elapsed - window.MX._avgSyncMs) / _syncSamples;
      _syncStart = 0;
    }
    renderStatusBar();
  };
  window.MX.syncFail  = function (retryFn) {
    _pendingSaves = Math.max(0, _pendingSaves - 1);
    _syncStart = 0;
    renderStatusBar();
    if (retryFn) {
      MX.toast('🔴 Échec de synchronisation', true);
    }
  };
  window.MX.snapshotReceived = function () {
    window.MX._dbReads++;
    _lastSyncTime = new Date();
    MX.state._lastSync = _lastSyncTime.getTime();
    renderStatusBar();
  };

  function _fmtTime(d) {
    if (!d) return "--:--";
    return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
  }

  function renderStatusBar() {
    const el = document.getElementById("status-bar");
    const t = _fmtTime(_lastSyncTime);
    const n = _presenceCount;
    const usersLabel = n + " utilisateur" + (n !== 1 ? "s" : "") + " connecté" + (n !== 1 ? "s" : "");

    let syncItem;
    if (_isOffline) {
      syncItem = `<span class="sb-item sb-offline"><i class="fas fa-wifi-slash"></i> Hors ligne</span>`;
    } else if (_pendingSaves > 0) {
      syncItem = `<span class="sb-item sb-syncing"><i class="fas fa-rotate fa-spin"></i> Synchronisation…</span>`;
    } else {
      syncItem = `<span class="sb-item"><i class="fas fa-cloud-arrow-up" style="color:var(--green)"></i> Synchronisé à ${t}</span>`;
    }

    if (el) {
      el.innerHTML =
        `<span class="sb-item"><span class="sb-dot${_isOffline ? ' sb-dot-red' : ''}"></span>${_isOffline ? 'Hors ligne' : 'Serveur opérationnel'}</span>` +
        `<span class="sb-sep">│</span>` +
        syncItem +
        `<span class="sb-sep">│</span>` +
        `<span class="sb-item" id="sb-users"><i class="fas fa-users"></i> ${usersLabel}</span>` +
        `<span class="sb-sep">│</span>` +
        `<span class="sb-item sb-ver"><i class="fas fa-rocket"></i> Maintix v${_APP_VER}</span>`;
    }

    // Mobile topbar sync dot
    const dot = document.getElementById("topbar-sync-dot");
    if (dot) {
      if (_isOffline) {
        dot.className = "topbar-sync-dot topbar-sync-offline";
        dot.title = "Hors ligne";
      } else if (_pendingSaves > 0) {
        dot.className = "topbar-sync-dot topbar-sync-pending";
        dot.title = "Synchronisation en cours…";
      } else {
        dot.className = "topbar-sync-dot topbar-sync-ok";
        dot.title = "Synchronisé à " + t;
      }
    }
  }

  // ── ANN BANNER ──
  let _bannerIdx = 0;
  const _bannerDismissed = new Set(
    JSON.parse(sessionStorage.getItem("mx_ann_dismissed") || "[]")
  );

  function _getBannerAnns() {
    const cu = MX.state.currentUser || MX.state.adminUser;
    const userName = cu
      ? (cu.name || (cu.email ? cu.email.split("@")[0] : null))
      : null;
    return (MX.state.announcements || [])
      .filter(a => a.pinned || a.type === "urgent" || a.type === "important")
      .filter(a => !_bannerDismissed.has(a.id))
      .filter(a => !userName || !(a.readBy || []).includes(userName))
      .sort((a, b) => {
        const w = x => x.type === "urgent" ? 3 : x.pinned ? 2 : 1;
        return w(b) - w(a);
      });
  }

  function updateAnnBanner() {
    const el = document.getElementById("ann-banner");
    if (!el) return;
    const list = _getBannerAnns();
    if (!list.length) { el.classList.add("hidden"); return; }
    if (_bannerIdx >= list.length) _bannerIdx = 0;
    const ann   = list[_bannerIdx];
    const total = list.length;
    const LABELS = { urgent: "MESSAGE URGENT", important: "MESSAGE IMPORTANT", info: "INFORMATION", suggestion: "SUGGESTION", technique: "TECHNIQUE" };
    const COLORS = { urgent: "var(--red)", important: "var(--orange)", info: "var(--cyan)", suggestion: "var(--jour)", technique: "var(--green)" };
    const label = LABELS[ann.type] || "MESSAGE";
    const color = COLORS[ann.type] || "var(--cyan)";
    el.style.setProperty("--banner-color", color);
    el.innerHTML = `
      <div class="ann-banner-inner">
        <span class="ann-banner-icon" style="color:${color}"><i class="fas fa-megaphone"></i></span>
        <div class="ann-banner-body">
          <span class="ann-banner-label" style="color:${color}">${label}</span>
          <span class="ann-banner-text">${MX.esc(ann.content)}</span>
          ${ann.authorName ? `<span class="ann-banner-author">— ${MX.esc(ann.authorName)}</span>` : ""}
        </div>
        ${total > 1 ? `
          <div class="ann-banner-nav">
            <button onclick="MX.bannerPrev()" class="ann-banner-nav-btn"><i class="fas fa-chevron-left"></i></button>
            <span class="ann-banner-counter">${_bannerIdx + 1}/${total}</span>
            <button onclick="MX.bannerNext()" class="ann-banner-nav-btn"><i class="fas fa-chevron-right"></i></button>
          </div>
        ` : ""}
        <div class="ann-banner-actions">
          <button onclick="MX.bannerMarkRead('${ann.id}')" class="ann-banner-read" style="border-color:${color};color:${color}"><i class="fas fa-check"></i> <span>Marquer comme lu</span></button>
          <button onclick="MX.bannerClose('${ann.id}')" class="ann-banner-close" title="Fermer"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    el.classList.remove("hidden");
  }

  window.MX.bannerNext = function () {
    const list = _getBannerAnns();
    if (!list.length) return;
    _bannerIdx = (_bannerIdx + 1) % list.length;
    updateAnnBanner();
  };
  window.MX.bannerPrev = function () {
    const list = _getBannerAnns();
    if (!list.length) return;
    _bannerIdx = (_bannerIdx - 1 + list.length) % list.length;
    updateAnnBanner();
  };
  window.MX.bannerClose = function (id) {
    _bannerDismissed.add(id);
    sessionStorage.setItem("mx_ann_dismissed", JSON.stringify([..._bannerDismissed]));
    _bannerIdx = 0;
    updateAnnBanner();
  };
  window.MX.bannerMarkRead = async function (id) {
    const cu = MX.state.currentUser || MX.state.adminUser;
    const userName = cu
      ? (cu.name || (cu.email ? cu.email.split("@")[0] : "Admin"))
      : null;
    if (userName) await MX.DB.markReadAnnouncement(id, userName);
    MX.bannerClose(id);
  };

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
    const { DB, state, Pages } = MX;

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
      if (state.currentPage === "mes-missions") Pages.MesMissions && Pages.MesMissions.render();
      if (state.currentPage === "home")      MX.Pages.Home.render();
      if (state.currentPage === "orders")    MX.Pages.Orders.render();
    });

    DB.listenAllTasks((dayId, sl, items) => {
      state.tasks[`${dayId}_${sl}`] = items;
      updateNavProgress();
      if (state.currentPage === dayId)             MX.Pages.Checklist.render(dayId);
      if (state.currentPage === "mes-missions")    Pages.MesMissions && Pages.MesMissions.render();
      if (state.currentPage === "home")            MX.Pages.Home.render();
      if (state.currentPage === "admin")           MX.Pages.Admin.render();
    });

    DB.listenProducts(list => {
      MX.Notifs._checkStock(list);
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

    DB.listenRoles(list => {
      state.roles = list;
      buildNav();
    });

    DB.listenAlertRules(list => {
      console.log('[App] listenAlertRules callback:', list.length, 'alert rule(s) loaded into state');
      state.alertRules = list;
      if (MX.AlertsEngine && !MX.AlertsEngine._started) {
        MX.AlertsEngine._started = true;
        MX.AlertsEngine.start();
      }
      if (state.currentPage === 'utilisateurs' || state.currentPage === 'admin') {
        MX.Pages.Admin && MX.Pages.Admin.render();
      }
    });

    DB.listenTriggeredAlerts(state.todayDateStr, list => {
      state.triggeredAlerts = list;
      _updAlertBadge();
      if (state.currentPage === 'utilisateurs' || state.currentPage === 'admin') {
        MX.Pages.Admin && MX.Pages.Admin.render();
      }
    });

    DB.listenLogs(list => {
      state.logs = list;
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenTransfers(list => {
      state.transfers = list;
      updateNavProgress();
      if (MX.DAYS.find(d => d.id === state.currentPage)) MX.Pages.Checklist.render(state.currentPage);
      if (state.currentPage === "mes-missions") Pages.MesMissions && Pages.MesMissions.render();
    });

    DB.listenMissions(list => {
      _notifyNewMissions(MX.state.missions || [], list);
      state.missions = list;
      updateNavProgress();
      if (MX.DAYS.find(d => d.id === state.currentPage)) MX.Pages.Checklist.render(state.currentPage);
      if (state.currentPage === "admin") MX.Pages.Admin.render();
    });

    DB.listenAnnouncements(list => {
      MX.Notifs._checkAnnouncements(list);
      state.announcements = list;
      if (state.currentPage === "msgs") _markMsgsSeen();
      updateNavProgress();
      updateAnnBanner();
      if (state.currentPage === "msgs") MX.Pages.Messages.render();
      if (state.currentPage === "home") MX.Pages.Home.render();
    });

    DB.listenAbsences(list => {
      state.absences = list;
      if (state.currentPage === 'utilisateurs') MX.Pages.Admin.render();
    });

    DB.listenPlanningShifts(list => {
      state.planningShifts = list;
      if (state.currentPage === 'planning' && Pages.Planning) Pages.Planning.render();
    });

    DB.listenBadges(list => {
      state.badges = list;
      if (state.currentPage === 'badges') Pages.Badges && Pages.Badges.render();
      if (state.currentPage === 'utilisateurs') Pages.Admin.render();
    });
    DB.listenUserBadges(map => {
      MX.Notifs._checkUserBadges(map);
      state.userBadges = map;
      buildNav();
      buildDeskHeader();
      MX.Auth.updateSidebarFooter && MX.Auth.updateSidebarFooter();
      const cp = state.currentPage;
      if (cp === 'badges')       { Pages.Badges  && Pages.Badges.render(); }
      else if (cp === 'msgs')    { Pages.Messages && Pages.Messages.render(); }
      else if (cp === 'missions'){ Pages.Missions && Pages.Missions.render(); }
      else if (cp === 'bible')   { Pages.Bible    && Pages.Bible.render(); }
      else if (cp === 'home')    { Pages.Home     && Pages.Home.render(); }
      else if (cp === 'planning'){ Pages.Planning && Pages.Planning.render(); }
      else if (cp === 'utilisateurs') { Pages.Admin && Pages.Admin.render(); }
      else if (cp === 'consommations') { Pages.Conso && Pages.Conso.render(); }
      else if (MX.DAYS && MX.DAYS.find(d => d.id === cp)) { Pages.Checklist && Pages.Checklist.render(cp); }
    });

    DB.listenPresence(count => {
      _presenceCount = count;
      renderStatusBar();
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

    DB.listenOrders(list => {
      state.orders = list;
      if (state.currentPage === "orders") MX.Pages.Orders.render();
    });

    // ── Daily claims listener (today only) ──
    DB.listenDailyClaims(state.todayDateStr, data => {
      state.dailyClaims = data;
      const tid = MX.todayId ? MX.todayId() : null;
      if (tid && (state.currentPage === "today-cl" || state.currentPage === tid)) {
        MX.Pages.Checklist.render(tid);
      }
      if (state.currentPage === "mes-missions") Pages.MesMissions && Pages.MesMissions.render();
    });

    // ── Planning suggestions for today ──
    const _SHIFT_TO_SLOT = { '1': 'matin', '2': 'journee', '3': 'journee', '4': 'soir' };
    DB.loadPlanningMonth(new Date().getFullYear(), new Date().getMonth()).then(entries => {
      const sugg = {};
      Object.values(entries).forEach(e => {
        if (e.date === state.todayDateStr && _SHIFT_TO_SLOT[e.shiftCode]) {
          if (!sugg[e.userName]) sugg[e.userName] = _SHIFT_TO_SLOT[e.shiftCode];
        }
      });
      state.todayPlanSuggestions = sugg;
    }).catch(() => {});

    // ── Notifications listener (single global, filter client-side by user) ──
    DB.listenNotifications(list => {
      MX.Notifs.onUpdate(list);
    });

    // ── Hotel config (nom, couleurs) ──
    DB.getHotelConfig().then(cfg => {
      if (cfg) state.hotelConfig = cfg;
    }).catch(() => {});
  }

  // ── INIT ──
  const _splashStart = performance.now();

  // Logs de version au démarrage
  console.log(
    '%c Maintix v' + _APP_VER + ' %c build ' + (window.MX_BUILD || '—'),
    'background:#8B5CF6;color:#fff;padding:3px 8px;border-radius:4px 0 0 4px;font-weight:700',
    'background:#1e1b4b;color:#a78bfa;padding:3px 8px;border-radius:0 4px 4px 0'
  );
  caches.keys().then(keys => {
    const swCache = keys.find(k => k.startsWith('maintix-')) || '—';
    console.log('[Maintix] Version app     :', _APP_VER);
    console.log('[Maintix] Cache SW actif  :', swCache);
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      console.log('[Maintix] SW scriptURL    :', navigator.serviceWorker.controller.scriptURL);
    }
  }).catch(() => {});

  async function init() {
    MX.ThemeManager && MX.ThemeManager.init();
    const loadingTimeout = setTimeout(hideLoading, 4500);

    document.getElementById("modal-bg").addEventListener("click", e => {
      if (e.target === e.currentTarget) MX.closeModal();
    });

    MX.Auth.onLogin(() => {
      buildDeskHeader();
      MX.reloadFavs();
      if (MX.state.currentPage === "admin") MX.Pages.Admin.render();
      if (MX.state.currentPage === "home")  MX.Pages.Home.render();
      setTimeout(() => MX.showNotifOnboarding && MX.showNotifOnboarding(), 1500);
    });
    MX.Auth.onLogout(() => {
      _favsCache = null;
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
      await MX.DB.initDefaultBadges();
      setupListeners();
      const _elapsed = performance.now() - _splashStart;
      await new Promise(r => setTimeout(r, Math.max(0, 2400 - _elapsed)));
    } catch (e) {
      console.error("Firebase init error:", e);
    }

    clearTimeout(loadingTimeout);
    hideLoading();

    _lastSyncTime = new Date();
    renderStatusBar();
    await _loadFavsFromFirestore().catch(() => {});
    buildNav();
    const _urlPage = new URLSearchParams(window.location.search).get("page");
    const _extraPages = new Set(["mes-missions","consommations","interventions","equipe","org-resp"]);
    MX.showPage(_urlPage && (NAV.some(n => n && n.id === _urlPage) || _extraPages.has(_urlPage)) ? _urlPage : "home");

    // Presence heartbeat every 2 minutes
    setInterval(() => {
      const cu = MX.state.currentUser;
      const ad = MX.state.adminUser;
      const name = cu ? cu.name : (ad ? (ad.email || "admin").split("@")[0] : null);
      if (name) MX.DB.updatePresence(name);
    }, 120000);

    setTimeout(() => { MX.Auth.promptLogin && MX.Auth.promptLogin(); }, 600);

    if ("serviceWorker" in navigator) {
      const _swHadController = !!navigator.serviceWorker.controller;
      let _swReg = null;
      navigator.serviceWorker.register("/sw.js").then(reg => {
        _swReg = reg;
        // Vérification toutes les 5 minutes (au lieu de 1 heure)
        setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
      }).catch(() => {});
      // Vérification au retour au premier plan (swipe-back, alt-tab, etc.)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && _swReg) {
          _swReg.update().catch(() => {});
        }
      });
      // Rechargement automatique silencieux à chaque nouveau SW
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_swHadController) {
          MX.toast('Mise à jour automatique en cours…', false);
          setTimeout(() => window.location.reload(), 2500);
        }
      });
      // Écoute du message SW_UPDATED (envoyé par activate → clients.claim)
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'SW_UPDATED') {
          console.log('[Maintix] SW mis à jour → v' + e.data.version);
        }
      });
    }

    MX.Notifs.init();
    MX.Updates.init();
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

  function _primaryBadge(userName) {
    if (!userName) return null;
    const userBadges = MX.state.userBadges || {};
    const badges     = MX.state.badges || [];
    const ub = userBadges[userName] || [];
    if (!ub.length) return null;
    const badgeIds = ub.map(b => b.badgeId);
    return badges
      .filter(b => b.active && badgeIds.includes(b.id))
      .sort((a, b) => a.priority - b.priority)[0] || null;
  }

  window.MX.primaryBadge = _primaryBadge;

  // ── NOTIFICATIONS MODULE ──
  window.MX.Notifs = (function() {
    let _dropOpen = false;
    let _prevAnnIds = new Set();
    let _prevMsgIds = new Set();
    let _prevStockLow = new Set();
    let _prevUserBadgeIds = new Set();
    let _initialized = false;

    function _catColor(type) {
      const m = {
        message:      'var(--cyan)',
        intervention: 'var(--orange)',
        stock:        'var(--jour)',
        badge:        'var(--green)',
        update:       '#8B5CF6',
        system:       'var(--text3)',
      };
      return m[type] || 'var(--cyan)';
    }

    function _catIcon(type) {
      const m = {
        message:      '📩',
        intervention: '🔧',
        stock:        '📦',
        badge:        '🏆',
        update:       '🚀',
        system:       '⚙️',
      };
      return m[type] || '🔔';
    }

    function _fmtDate(ts) {
      if (!ts) return '';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'À l\'instant';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
             ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    function updateBell(notifications) {
      const unread = (notifications || []).filter(n => !n.read).length;
      const badge = document.getElementById('notif-bell-badge');
      if (!badge) return;
      badge.textContent = unread > 99 ? '99+' : (unread || '');
      badge.className = 'nav-badge' + (unread ? ' show' : '');
    }

    function _renderItemHtml(n, compact) {
      const color = _catColor(n.type);
      const icon  = n.icon || _catIcon(n.type);
      const time  = _fmtDate(n.createdAt);
      return `<div class="notif-item${n.read ? '' : ' notif-item--unread'}"
        onclick="MX.Notifs.onItemClick('${MX.esc(n.id)}')" data-id="${MX.esc(n.id)}">
        <div class="notif-item-icon" style="color:${color};background:${color}22">${icon}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${MX.esc(n.title)}</div>
          ${!compact && n.description ? `<div class="notif-item-desc">${MX.esc(n.description)}</div>` : ''}
          <div class="notif-item-meta">
            <span style="color:${color};font-size:10px;font-weight:600">${_catIcon(n.type)} ${n.type}</span>
            ${n.author ? `<span class="notif-meta-sep">·</span><span>${MX.esc(n.author)}</span>` : ''}
            ${time ? `<span class="notif-meta-sep">·</span><span>${time}</span>` : ''}
          </div>
        </div>
        ${!n.read ? '<div class="notif-dot"></div>' : ''}
      </div>`;
    }

    function _renderDropHtml(notifs, unread) {
      const items = notifs.length
        ? notifs.map(n => _renderItemHtml(n, true)).join('')
        : '<div class="notif-empty"><i class="fas fa-bell-slash"></i><div>Aucune notification</div></div>';
      return `<div class="notif-drop-header">
          <span class="notif-drop-title">Notifications${unread ? `<span class="notif-count">${unread}</span>` : ''}</span>
          ${unread ? `<button class="notif-mark-all" onclick="MX.Notifs.markAllRead()">Tout lire</button>` : ''}
        </div>
        <div class="notif-drop-list">${items}</div>
        <div class="notif-drop-footer">
          <button class="notif-see-all" onclick="MX.Notifs._closeDrop();MX.showPage('notifs')">
            Voir toutes les notifications
          </button>
        </div>`;
    }

    function toggleDrop() {
      if (_dropOpen) _closeDrop();
      else _openDrop();
    }

    function _openDrop() {
      _closeDrop();
      const notifs = (MX.state.notifications || []).slice(0, 10);
      const unread = notifs.filter(n => !n.read).length;
      const drop = document.createElement('div');
      drop.id = 'notif-drop';
      drop.className = 'notif-drop';
      drop.innerHTML = _renderDropHtml(notifs, unread);
      document.body.appendChild(drop);
      const bell = document.getElementById('notif-bell-btn');
      if (bell) {
        const rect = bell.getBoundingClientRect();
        drop.style.top  = (rect.bottom + 8) + 'px';
        drop.style.right = (window.innerWidth - rect.right) + 'px';
      }
      _dropOpen = true;
      setTimeout(() => { document.addEventListener('click', _outsideClick); }, 0);
    }

    function _closeDrop() {
      const el = document.getElementById('notif-drop');
      if (el) el.remove();
      _dropOpen = false;
      document.removeEventListener('click', _outsideClick);
    }

    function _outsideClick(e) {
      const drop = document.getElementById('notif-drop');
      const bell = document.getElementById('notif-bell-btn');
      if (drop && !drop.contains(e.target) && bell && !bell.contains(e.target)) {
        _closeDrop();
      }
    }

    function onItemClick(id) {
      MX.DB.markNotificationRead(id).catch(() => {});
      const n = (MX.state.notifications || []).find(x => x.id === id);
      if (n) n.read = true;
      updateBell(MX.state.notifications || []);
      if (_dropOpen) {
        const items = (MX.state.notifications || []).slice(0, 10);
        const unread = items.filter(n => !n.read).length;
        const drop = document.getElementById('notif-drop');
        if (drop) drop.innerHTML = _renderDropHtml(items, unread);
      }
    }

    function markAllRead() {
      const cu = MX.state.currentUser;
      const userId = cu ? cu.name : 'all';
      MX.DB.markAllNotificationsRead(userId).catch(() => {});
      (MX.state.notifications || []).forEach(n => { n.read = true; });
      updateBell(MX.state.notifications || []);
      _closeDrop();
      if (MX.state.currentPage === 'notifs' && MX.Pages.Notifications) {
        MX.Pages.Notifications.render();
      }
    }

    function onUpdate(allNotifications) {
      // Filter by current user (or 'all' for broadcasts)
      const cu  = MX.state.currentUser;
      const ad  = MX.state.adminUser;
      const uid = cu ? cu.name : (ad ? (ad.email || 'admin').split('@')[0] : null);
      const notifications = allNotifications.filter(n =>
        n.userId === 'all' || (uid && n.userId === uid)
      );
      MX.state.notifications = notifications;
      updateBell(notifications);
      if (MX.state.currentPage === 'notifs' && MX.Pages.Notifications) {
        MX.Pages.Notifications.render();
      }
      if (_dropOpen) {
        const items = notifications.slice(0, 10);
        const unread = items.filter(n => !n.read).length;
        const drop = document.getElementById('notif-drop');
        if (drop) drop.innerHTML = _renderDropHtml(items, unread);
      }
    }

    // Called from setupListeners to detect new announcements
    function _checkAnnouncements(list) {
      if (!_initialized) { _prevAnnIds = new Set(list.map(a => a.id)); return; }
      list.forEach(a => {
        if (!_prevAnnIds.has(a.id)) {
          _prevAnnIds.add(a.id);
          MX.DB.createNotification({
            key: `ann_${a.id}`,
            type: 'message',
            title: '📩 Nouveau message',
            description: a.content ? a.content.slice(0, 80) : '',
            icon: '📩',
            author: a.authorName || '',
            userId: 'all',
          }).catch(() => {});
        }
      });
    }

    // Called from setupListeners to detect low-stock products
    function _checkStock(list) {
      const lowNow = new Set();
      list.forEach(p => {
        if (p.minQty > 0 && p.qty <= p.minQty) {
          lowNow.add(p.id);
          if (!_prevStockLow.has(p.id)) {
            MX.DB.createNotification({
              key: `stock_${p.id}`,
              type: 'stock',
              title: '📦 Stock faible',
              description: `${p.name} — Stock restant : ${p.qty}`,
              icon: '📦',
              author: '',
              userId: 'all',
            }).catch(() => {});
          }
        }
      });
      _prevStockLow = lowNow;
    }

    // Called from setupListeners to detect new badges for current user
    function _checkUserBadges(map) {
      const cu = MX.state.currentUser;
      if (!cu) return;
      const myBadges = map[cu.name] || [];
      if (!_initialized) {
        _prevUserBadgeIds = new Set(myBadges.map(b => b.id));
        return;
      }
      myBadges.forEach(b => {
        if (!_prevUserBadgeIds.has(b.id)) {
          _prevUserBadgeIds.add(b.id);
          MX.DB.createNotification({
            key: `badge_${b.id}`,
            type: 'badge',
            title: '🏆 Badge obtenu',
            description: b.badgeName || 'Nouveau badge',
            icon: '🏆',
            author: b.assignedBy || '',
            userId: cu.name,
          }).catch(() => {});
        }
      });
    }

    // Create version update notification
    function createVersionNotif(version) {
      MX.DB.createNotification({
        key: `update_${version}`,
        type: 'update',
        title: `🚀 Maintix v${version}`,
        description: 'Nouvelle version disponible.',
        icon: '🚀',
        author: 'Système',
        userId: 'all',
      }).catch(() => {});
    }

    // Create system notification
    function createSystemNotif(key, title, description) {
      MX.DB.createNotification({
        key: `system_${key}`,
        type: 'system',
        title,
        description,
        icon: '⚙️',
        author: 'Système',
        userId: 'all',
      }).catch(() => {});
    }

    function init() {
      // Mark current user's notifications listener as started
      setTimeout(() => { _initialized = true; }, 3000);
    }

    // ── Sound engine (Web Audio API) ──
    let _audioCtx = null;
    const _SND_KEY = 'mx_notif_sounds';

    function _getCtx() {
      try {
        if (!_audioCtx || _audioCtx.state === 'closed') {
          _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') _audioCtx.resume();
        return _audioCtx;
      } catch(_e) { return null; }
    }

    function _beep(freqs, dur, wave, vol) {
      const ctx = _getCtx(); if (!ctx) return;
      try {
        const master = ctx.createGain();
        master.gain.setValueAtTime(vol || 0.3, ctx.currentTime);
        master.connect(ctx.destination);
        freqs.forEach(function(f, i) {
          const osc = ctx.createOscillator(), gn = ctx.createGain();
          osc.connect(gn); gn.connect(master);
          osc.type = wave || 'sine';
          osc.frequency.setValueAtTime(f, ctx.currentTime + i * dur);
          gn.gain.setValueAtTime(1, ctx.currentTime + i * dur);
          gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * dur + dur * 0.88);
          osc.start(ctx.currentTime + i * dur);
          osc.stop(ctx.currentTime + i * dur + dur + 0.05);
        });
      } catch(_e) {}
    }

    const _SND = {
      critical:  function() { _beep([880, 660, 880], 0.14, 'square',   0.50); },
      important: function() { _beep([660, 550],       0.20, 'sawtooth', 0.36); },
      warning:   function() { _beep([523, 493],       0.24, 'triangle', 0.28); },
      info:      function() { _beep([523, 659],       0.18, 'sine',     0.22); },
      success:   function() { _beep([523, 659, 784],  0.12, 'sine',     0.28); },
    };

    const _TYPE_SND = {
      mission:'critical', checklist:'important', counter:'warning', intervention:'info',
      absence:'important', planning:'info', alert:'warning', message:'info',
      stock:'warning', badge:'success', update:'info', system:'info',
    };

    function getSoundPrefs() {
      try { return JSON.parse(localStorage.getItem(_SND_KEY) || '{"enabled":true}'); }
      catch(_e) { return { enabled: true }; }
    }
    function saveSoundPrefs(p) { localStorage.setItem(_SND_KEY, JSON.stringify(p)); }

    function playSound(key) {
      const p = getSoundPrefs(); if (!p.enabled) return;
      const sndKey = _TYPE_SND[key] || key;
      if (p[sndKey] === false) return;
      const fn = _SND[sndKey]; if (fn) fn();
    }

    // ── Floating toasts ──
    const _FLOAT_DUR = 5200;
    let _floatIds = new Set(), _floatQ = [];
    const _MAX_FLT = 4;

    const _LVL = {
      critical:  { color:'#EF4444', icon:'fa-circle-exclamation',  lbl:'CRITIQUE'  },
      important: { color:'#F97316', icon:'fa-triangle-exclamation', lbl:'IMPORTANT' },
      warning:   { color:'#EAB308', icon:'fa-bell',                 lbl:'ATTENTION' },
      info:      { color:'#06B6D4', icon:'fa-circle-info',          lbl:'INFO'      },
      success:   { color:'#22C55E', icon:'fa-circle-check',         lbl:'SUCCÈS'    },
    };

    const _FA_CAT = {
      mission:'fa-list-check', checklist:'fa-square-check', counter:'fa-gauge-high',
      intervention:'fa-wrench', absence:'fa-user-clock', planning:'fa-calendar-days',
      alert:'fa-bell', message:'fa-comments', stock:'fa-box', badge:'fa-medal', system:'fa-gear',
    };

    function showFloat(n) {
      if (_floatIds.size >= _MAX_FLT) { _floatQ.push(n); return; }
      const container = document.getElementById('float-notifs');
      if (!container) return;
      const lv  = _LVL[n.level] || _LVL.info;
      const ico = _FA_CAT[n.type] || lv.icon;
      const dur = (n.duration != null) ? n.duration : _FLOAT_DUR;
      const id  = 'flt_' + Date.now() + '_' + (Math.random() * 999 | 0);
      const el  = document.createElement('div');
      el.className = 'fn-toast'; el.id = id;
      const esc = MX.esc || function(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
          return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
      };
      el.innerHTML = '<div class="fn-accent" style="background:' + lv.color + '"></div>'
        + '<div class="fn-ico" style="color:' + lv.color + ';background:' + lv.color + '1A"><i class="fas ' + ico + '"></i></div>'
        + '<div class="fn-body">'
        + '<div class="fn-lbl" style="color:' + lv.color + '">' + lv.lbl + (n.type && n.type !== 'system' ? ' · ' + n.type.toUpperCase() : '') + '</div>'
        + '<div class="fn-ttl">' + esc(n.title || '') + '</div>'
        + (n.description ? '<div class="fn-dsc">' + esc(n.description) + '</div>' : '')
        + '</div>'
        + '<button class="fn-cls" onclick="MX.Notifs.closeFloat(\'' + id + '\')" aria-label="Fermer"><i class="fas fa-times"></i></button>'
        + (dur > 0 ? '<div class="fn-bar" style="background:' + lv.color + ';animation-duration:' + dur + 'ms"></div>' : '');
      container.appendChild(el);
      _floatIds.add(id);
      requestAnimationFrame(function() { el.classList.add('fn-toast--in'); });
      if (dur > 0) setTimeout(function() { closeFloat(id); }, dur);
    }

    function closeFloat(id) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('fn-toast--out');
        setTimeout(function() { el.remove(); _floatIds.delete(id); _nextFloat(); }, 320);
      } else { _floatIds.delete(id); _nextFloat(); }
    }
    function _nextFloat() { if (_floatQ.length && _floatIds.size < _MAX_FLT) showFloat(_floatQ.shift()); }

    // ── Bell flash ──
    function flashBell() {
      const badge = document.getElementById('notif-bell-badge');
      if (badge && badge.classList.contains('show')) {
        badge.classList.remove('nb-pop'); void badge.offsetWidth; badge.classList.add('nb-pop');
        setTimeout(function() { badge.classList.remove('nb-pop'); }, 600);
      }
      const btn = document.getElementById('notif-bell-btn');
      if (btn) {
        btn.classList.remove('bell-shake'); void btn.offsetWidth; btn.classList.add('bell-shake');
        setTimeout(function() { btn.classList.remove('bell-shake'); }, 700);
      }
    }

    // ── Main push API ──
    let _prevAlertIds = new Set();

    function _lvlForType(t) {
      const m = { mission:'critical', checklist:'important', counter:'warning', intervention:'info',
                  absence:'important', planning:'info', alert:'warning', message:'info',
                  stock:'warning', badge:'success', update:'info', system:'info' };
      return m[t] || 'info';
    }

    function push(n) {
      const level = n.level || _lvlForType(n.type);
      if (!n.silent) playSound(n.type || level);
      if (!n.noFloat) showFloat(Object.assign({}, n, { level: level }));
      flashBell();
      if (MX.DB && MX.DB.createNotification) {
        MX.DB.createNotification({
          key: n.key || null, type: n.type || 'system', level: level,
          title: n.title || '', description: n.description || '',
          icon: n.icon || null, author: n.author || '',
          userId: n.userId || 'all', data: n.data || {},
        }).catch(function() {});
      }
    }

    function checkNewAlerts(alertList) {
      if (!_initialized) { _prevAlertIds = new Set(alertList.map(function(a) { return a.id; })); return; }
      const lvlMap = { info:'info', warning:'warning', important:'important', critical:'critical' };
      alertList.forEach(function(a) {
        if (!_prevAlertIds.has(a.id) && !a.acknowledged) {
          _prevAlertIds.add(a.id);
          push({
            title: a.ruleName || 'Alerte', description: a.message || '',
            type: 'alert', level: lvlMap[a.level] || 'warning',
            userId: 'all', key: 'alert_' + a.id,
          });
        }
      });
      _prevAlertIds = new Set(alertList.map(function(a) { return a.id; }));
    }

    return {
      init, onUpdate, updateBell, toggleDrop, _closeDrop, onItemClick, markAllRead,
      _checkAnnouncements, _checkStock, _checkUserBadges,
      createVersionNotif, createSystemNotif,
      _catColor, _catIcon, _fmtDate,
      push, showFloat, closeFloat, flashBell, playSound,
      getSoundPrefs, saveSoundPrefs, checkNewAlerts,
    };
  })();

  // ── VERSION UPDATES MODULE ──
  window.MX.Updates = (function() {
    function init() {
      if (localStorage.getItem('mx_last_ver') !== _APP_VER) {
        buildDeskHeader();
        setTimeout(showModal, 2500);
        // Create Firestore notification for new version
        MX.Notifs.createVersionNotif(_APP_VER);
      }
    }

    function showModal() {
      if (document.getElementById('ver-modal-overlay')) return;
      const cl = window.MX.CHANGELOG || [];
      const latest = cl[0] || {};
      const changesList = (latest.changes || []).map(c =>
        `<li class="vcl-change-item"><i class="fas fa-check" style="color:var(--cyan);font-size:10px;margin-right:8px"></i>${MX.esc(c)}</li>`
      ).join('');

      const overlay = document.createElement('div');
      overlay.id = 'ver-modal-overlay';
      overlay.className = 'ver-modal-overlay';
      overlay.innerHTML = `<div class="ver-modal">
        <div style="text-align:center;margin-bottom:22px">
          <div style="font-size:32px;margin-bottom:10px">🚀</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-0.5px;line-height:1.2">Nouvelle version disponible</div>
          <div style="font-size:13px;color:var(--cyan);margin-top:6px;font-weight:700;letter-spacing:0.5px">Maintix v${_APP_VER}</div>
        </div>
        ${latest.title ? `<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text2)">${MX.esc(latest.title)}</div>` : ''}
        ${changesList ? `<ul class="vcl-changes-list">${changesList}</ul>` : ''}
        <div class="ver-modal-actions">
          <button class="primary-btn" style="width:100%" onclick="MX.Updates._goNouveautes()">
            <i class="fas fa-scroll"></i> Voir les nouveautés
          </button>
          <button class="sec-btn" style="width:100%;margin-top:8px" onclick="MX.Updates._doUpdate()">
            <i class="fas fa-rotate"></i> Mettre à jour maintenant
          </button>
          <button class="ver-modal-later" onclick="MX.Updates.dismiss()">Plus tard</button>
        </div>
      </div>`;
      overlay.addEventListener('click', e => { if (e.target === overlay) MX.Updates.dismiss(); });
      document.body.appendChild(overlay);
    }

    function markSeen() {
      localStorage.setItem('mx_last_ver', _APP_VER);
      const badge = document.getElementById('dh-ver-badge');
      if (badge) badge.remove();
    }

    function dismiss() {
      const el = document.getElementById('ver-modal-overlay');
      if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }
    }

    function _goNouveautes() {
      dismiss();
      markSeen();
      window._settingsTab = 'nouveautes';
      MX.showPage('settings');
    }

    function _doUpdate() {
      dismiss();
      markSeen();
      if ('caches' in window) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
          window.location.reload(true);
        });
      } else {
        window.location.reload(true);
      }
    }

    return { init, showModal, markSeen, dismiss, _goNouveautes, _doUpdate };
  })();

  window.MX.badgeBorder = function(userName) {
    const b = _primaryBadge(userName);
    return b ? (b.border || b.color || null) : null;
  };

  // ── MOBILE DRAWER ──
  function openMobileDrawer() {
    closeMobileDrawer();
    const { state } = MX;
    const cu    = state.currentUser;
    const admin = state.adminUser;
    const canAll = MX.Auth.canSeeAll();
    const name  = cu ? (cu.name || cu.id || '') : (admin ? (admin.email || 'Admin') : '');
    const role  = cu ? (cu.role || '') : (admin ? 'Admin' : '');
    const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

    const favs = _getFavs();
    let favsHtml = '';
    if (favs.length > 0) {
      favsHtml = `<div class="mob-drw-favs">`;
      favs.forEach(function(f) {
        const fInfo = NAV_INFO[f.id] || {};
        favsHtml += `<button class="mob-drw-fav" onclick="MX.closeMobileDrawer();MX.showPage('${f.id}')"><i class="fas ${fInfo.icon || 'fa-circle'}"></i><span>${f.label}</span></button>`;
      });
      favsHtml += `</div>`;
    } else {
      favsHtml = `<div class="mob-drw-fav-empty">Épinglez des modules avec ⭐ dans le menu principal</div>`;
    }

    const navItems = [
      { id: 'planning',     icon: 'fa-calendar-days',  label: 'Planning',      fn: "MX.closeMobileDrawer();MX.showPage('planning')" },
      { id: 'msgs',         icon: 'fa-comments',       label: 'Messages',      fn: "MX.closeMobileDrawer();MX.showPage('msgs')" },
      { id: 'orders',       icon: 'fa-box',            label: 'Stock',         fn: "MX.closeMobileDrawer();MX.showPage('orders')" },
      { id: 'documents',    icon: 'fa-book',           label: 'Ressources',    fn: "MX.closeMobileDrawer();MX.showPage('documents')" },
      { id: 'parametres',   icon: 'fa-gear',           label: 'Paramètres',    fn: "MX.closeMobileDrawer();MX.showPage('parametres')" },
    ];
    if (canAll) {
      navItems.splice(2, 0,
        { id: 'org-resp',     icon: 'fa-users-gear',    label: 'Organisation',   fn: "MX.closeMobileDrawer();MX.showPage('org-resp')" },
        { id: 'utilisateurs', icon: 'fa-crosshairs', label: 'Centre de Pilotage', fn: "MX.closeMobileDrawer();MX.showPage('utilisateurs')" }
      );
    }
    const gridHtml = navItems.map(function(item) {
      return `<button class="mob-drw-item" onclick="${item.fn}"><i class="fas ${item.icon}"></i><span>${item.label}</span></button>`;
    }).join('');

    const html = `<div class="mob-drw" id="mob-drw">
      <div class="mob-drw-overlay" onclick="MX.closeMobileDrawer()"></div>
      <div class="mob-drw-panel">
        <div class="mob-drw-handle"></div>
        <div class="mob-drw-profile">
          <div class="mob-drw-avatar">${initials}</div>
          <div class="mob-drw-userinfo">
            <div class="mob-drw-username">${name || 'Utilisateur'}</div>
            ${role ? `<div class="mob-drw-userrole">${role}</div>` : ''}
          </div>
        </div>
        <div class="mob-drw-section">
          <div class="mob-drw-section-title"><i class="fas fa-star"></i>Accès Rapide</div>
          ${favsHtml}
        </div>
        <div class="mob-drw-section">
          <div class="mob-drw-section-title"><i class="fas fa-grip" style="color:var(--text3)"></i>Navigation</div>
          <div class="mob-drw-grid">${gridHtml}</div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    requestAnimationFrame(function() {
      const drw = document.getElementById('mob-drw');
      if (drw) drw.classList.add('mob-drw--open');
    });
  }

  function closeMobileDrawer() {
    const drw = document.getElementById('mob-drw');
    if (!drw) return;
    drw.classList.remove('mob-drw--open');
    setTimeout(function() { if (drw.parentNode) drw.parentNode.removeChild(drw); }, 310);
  }

  function openFabMenu() {
    closeFabMenu();
    const html = '<div class="mbn-fmenu" id="mbn-fmenu">' +
      '<div class="mbn-fmenu-ov" onclick="MX.closeFabMenu()"></div>' +
      '<div class="mbn-fmenu-panel">' +
        '<button class="mbn-fitem" onclick="MX.closeFabMenu();MX.showPage(\'mes-missions\')"><i class="fas fa-list-check"></i><span>Nouvelle mission</span></button>' +
        '<button class="mbn-fitem" onclick="MX.closeFabMenu();MX.showCsoTab(\'compteurs\')"><i class="fas fa-gauge-high"></i><span>Nouveau relevé</span></button>' +
        '<button class="mbn-fitem" onclick="MX.closeFabMenu();MX.showPage(\'interventions\')"><i class="fas fa-wrench"></i><span>Nouvelle intervention</span></button>' +
        '<button class="mbn-fitem" onclick="MX.closeFabMenu();MX.showPage(\'documents\')"><i class="fas fa-book"></i><span>Nouvelle fiche Bible</span></button>' +
      '</div>' +
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    const fab = document.getElementById('mbn-fab-btn');
    if (fab) fab.classList.add('open');
    requestAnimationFrame(function() {
      const el = document.getElementById('mbn-fmenu');
      if (el) el.classList.add('mbn-fmenu--open');
    });
  }

  function closeFabMenu() {
    const el = document.getElementById('mbn-fmenu');
    if (el) {
      el.classList.remove('mbn-fmenu--open');
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }
    const fab = document.getElementById('mbn-fab-btn');
    if (fab) fab.classList.remove('open');
  }

  function openPilotageMenu() {
    closePilotageMenu();
    const canAll = MX.Auth.canSeeAll();
    let items = '';
    items += '<div class="mbn-pmenu-sec">PILOTAGE</div>';
    items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'tasks\')"><i class="fas fa-chart-bar"></i><span>Tableau Responsable</span></button>';
    items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showPage(\'org-resp\')"><i class="fas fa-clipboard-list"></i><span>Organisation Responsable</span></button>';
    items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'week\')"><i class="fas fa-calendar-week"></i><span>Gestion Semaines</span></button>';
    if (canAll) {
      items += '<div class="mbn-pmenu-sec">ÉQUIPE</div>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'team\')"><i class="fas fa-users-gear"></i><span>Gestion Équipe</span></button>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'users\')"><i class="fas fa-users"></i><span>Utilisateurs</span></button>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'roles\')"><i class="fas fa-shield-halved"></i><span>Rôles</span></button>';
      items += '<div class="mbn-pmenu-sec">SUPERVISION</div>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'alerts\')"><i class="fas fa-bell"></i><span>Alertes</span></button>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'alertes-config\')"><i class="fas fa-bell-concierge"></i><span>Config Alertes</span></button>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'logs\')"><i class="fas fa-chart-line"></i><span>Activité</span></button>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'history\')"><i class="fas fa-clock-rotate-left"></i><span>Historique</span></button>';
      items += '<div class="mbn-pmenu-sec">CONNAISSANCES</div>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'bible-admin\')"><i class="fas fa-book-open"></i><span>Validation Bible</span></button>';
      items += '<button class="mbn-pitem" onclick="MX.closePilotageMenu();MX.showAdminTab(\'badges-admin\')"><i class="fas fa-medal"></i><span>Badges</span></button>';
    }
    const html = '<div class="mbn-pmenu" id="mbn-pmenu">' +
      '<div class="mbn-pmenu-ov" onclick="MX.closePilotageMenu()"></div>' +
      '<div class="mbn-pmenu-panel">' +
        '<div class="mbn-pmenu-handle"></div>' +
        '<div class="mbn-pmenu-title"><i class="fas fa-crosshairs"></i>Centre de Pilotage</div>' +
        items +
      '</div>' +
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    requestAnimationFrame(function() {
      const el = document.getElementById('mbn-pmenu');
      if (el) el.classList.add('mbn-pmenu--open');
    });
  }

  function closePilotageMenu() {
    const el = document.getElementById('mbn-pmenu');
    if (!el) return;
    el.classList.remove('mbn-pmenu--open');
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 310);
  }

  window.MX.buildNav           = buildNav;
  window.MX.buildDeskHeader    = buildDeskHeader;
  window.MX.updateNavProgress  = updateNavProgress;
  window.MX.updateAnnBanner    = updateAnnBanner;
  window.MX.renderStatusBar    = renderStatusBar;
  window.MX.openMobileDrawer   = openMobileDrawer;
  window.MX.closeMobileDrawer  = closeMobileDrawer;
  window.MX.openFabMenu        = openFabMenu;
  window.MX.closeFabMenu       = closeFabMenu;
  window.MX.openPilotageMenu   = openPilotageMenu;
  window.MX.closePilotageMenu  = closePilotageMenu;

  document.addEventListener("DOMContentLoaded", init);
})();
