(function () {
  // ── CONSTANTS ──
  const SLOTS = {
    matin:   { l: "Matin",    e: "☀️",  c: "matin", icon: "fa-sun"  },
    journee: { l: "Journée",  e: "🌤",  c: "jour",  icon: "fa-cloud-sun" },
    soir:    { l: "Soir",     e: "🌙",  c: "soir",  icon: "fa-moon" }
  };

  const DAYS = [
    { id: "lundi",    l: "Lundi",    s: "Lun", we: false },
    { id: "mardi",    l: "Mardi",    s: "Mar", we: false },
    { id: "mercredi", l: "Mercredi", s: "Mer", we: false },
    { id: "jeudi",    l: "Jeudi",    s: "Jeu", we: false },
    { id: "vendredi", l: "Vendredi", s: "Ven", we: false },
    { id: "samedi",   l: "Samedi",   s: "Sam", we: true  },
    { id: "dimanche", l: "Dimanche", s: "Dim", we: true  }
  ];

  const DEFT = {
    matin:   ["Ouverture du local","Allumage des équipements","Vérification des stocks","Préparation des postes","Nettoyage des surfaces","Accueil clients / équipe","Check sécurité"],
    journee: ["Suivi des commandes","Gestion des appels","Réassort des fournitures","Contrôle qualité","Mise à jour des données","Réunion de point","Communication interne"],
    soir:    ["Bilan de journée","Nettoyage des postes","Mise sous clé du matériel","Vérification des fermetures","Rapport activité","Coupure des équipements","Clôture de caisse"]
  };

  const TEAM_COLORS = {
    Jordan:  { bg: "#2D1B69", fg: "#A78BFA" },
    Bryan:   { bg: "#0D2D5C", fg: "#60A5FA" },
    Dorian:  { bg: "#052010", fg: "#4ADE80" },
    Kevin:   { bg: "#3A1A00", fg: "#FB923C" },
    Aurelien:{ bg: "#3B0A0A", fg: "#F87171" }
  };

  // ── HELPERS ──
  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = (ts.toDate ? ts.toDate() : new Date(ts));
    const now = new Date();
    const diff = now - d;
    if (diff < 60000)    return "À l'instant";
    if (diff < 3600000)  return Math.floor(diff / 60000) + " min";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  function mkWeekLabel() {
    const d = new Date();
    const dow = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - ((dow + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt = x => x.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const tmp = new Date(d.getFullYear(), 0, 4);
    const wn  = 1 + Math.round(((d - tmp) / 86400000 - 3 + (tmp.getDay() + 6) % 7) / 7);
    return "S." + wn + " | " + fmt(mon) + " – " + fmt(sun);
  }

  function todayId() {
    const idx = new Date().getDay();
    return DAYS[idx === 0 ? 6 : idx - 1].id;
  }

  function getDaySlots(dayId) {
    const day = DAYS.find(d => d.id === dayId);
    return day && day.we ? ["soir"] : ["matin", "journee", "soir"];
  }

  function avatarBg(name) {
    const cols = ["#2D1B69","#0D2D5C","#052010","#3A1A00","#3B0A0A","#1E1400","#0A1628"];
    let h = 0;
    for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) % cols.length;
    return cols[h];
  }
  function avatarFg(name) {
    const cols = ["#A78BFA","#60A5FA","#4ADE80","#FB923C","#F87171","#F5A623","#4F8EF7"];
    let h = 0;
    for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) % cols.length;
    return cols[h];
  }
  function avatarTxt(name) { return (name || "?").substring(0, 2).toUpperCase(); }

  function userColors(name) {
    // Check for custom color in user profiles
    const profile = (window.MX && window.MX.state && window.MX.state.users || []).find(u => u.name === name);
    if (profile && profile.color) return { bg: profile.color, fg: _contrastColor(profile.color) };
    return TEAM_COLORS[name] || { bg: avatarBg(name), fg: avatarFg(name) };
  }

  function _contrastColor(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return (r*299 + g*587 + b*114) / 1000 > 128 ? "#0C0C0E" : "#FFFFFF";
  }

  function chipHtml(name) {
    const nc = userColors(name);
    return `<span class="chip" style="background:${nc.bg};color:${nc.fg}">${esc(name)}</span>`;
  }

  function progressClass(pct) {
    if (pct >= 80) return "done";
    if (pct >= 40) return "warn";
    return "alert";
  }

  function alertLevel(slot, pct, alerts) {
    const cfg = (alerts || {})[slot];
    if (!cfg || !cfg.active) return "ok";
    const now   = new Date();
    const parts = (cfg.deadline || "23:59").split(":");
    const dl    = new Date(); dl.setHours(+parts[0], +parts[1], 0, 0);
    if (now < dl) return "ok";
    if (pct >= 100) return "ok";
    return pct >= 50 ? "warn" : "alert";
  }

  // ── TOAST ──
  let _toastTimer = null;
  function toast(msg, err) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast show" + (err ? " err" : "");
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.classList.remove("show"); }, 2600);
  }

  // ── MODAL ──
  function showModal(title, sub, actions) {
    document.getElementById("m-title").textContent = title;
    document.getElementById("m-sub").textContent   = sub;
    const ac = document.getElementById("m-actions");
    ac.innerHTML = "";
    (actions || []).forEach(a => {
      const b = document.createElement("button");
      b.className  = "modal-btn " + (a.cls || "cancel");
      b.textContent = a.label;
      b.onclick = () => { closeModal(); if (a.fn) a.fn(); };
      ac.appendChild(b);
    });
    document.getElementById("modal-bg").classList.add("show");
  }
  function closeModal() { document.getElementById("modal-bg").classList.remove("show"); }

  // ── EXPORT ──
  window.MX = window.MX || {};
  Object.assign(window.MX, {
    SLOTS, DAYS, DEFT, TEAM_COLORS,
    esc, fmtTime, mkWeekLabel, todayId, getDaySlots,
    avatarBg, avatarFg, avatarTxt, chipHtml, userColors, progressClass, alertLevel,
    toast, showModal, closeModal
  });
})();
