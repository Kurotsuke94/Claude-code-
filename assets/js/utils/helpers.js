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

  // ── CHECKLIST CHECK KEYS — per-technician, per-date, never global ──────────
  // A checklist "check" must never be shared between technicians or between
  // occurrences of the same weekday across different weeks. checkKey() builds
  // a fully-qualified key (owner, year+week, date, slot, task) so that a fresh
  // day/week for a given technician always starts unchecked, and one
  // technician's validation can never appear pre-checked for another.
  function checkDateForDay(dayId, refDate) {
    const idx = DAYS.findIndex(d => d.id === dayId);
    if (idx < 0) return (refDate || new Date()).toISOString().slice(0, 10);
    const now = refDate || new Date();
    const dow = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - ((dow + 6) % 7)); mon.setHours(0, 0, 0, 0);
    const d = new Date(mon); d.setDate(mon.getDate() + idx);
    return d.toISOString().slice(0, 10);
  }
  function checkWeekOf(dateStr) {
    const t = new Date(dateStr + "T12:00:00"); t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + 4 - (t.getDay() || 7));
    const y0 = new Date(t.getFullYear(), 0, 1);
    const wn = Math.ceil(((t - y0) / 86400000 + 1) / 7);
    return t.getFullYear() + "_W" + String(wn).padStart(2, "0");
  }
  // Resolves WHO a task-instance's check belongs to: the per-task override,
  // else whoever claimed/was assigned the slot that day, else 'unassigned'.
  // This mirrors exactly the visibility filter technicians are already subject
  // to (state.checks reads/writes always agree with what a tech can even see).
  function checkOwnerId(dayId, slot, task) {
    const state = window.MX && window.MX.state;
    if (!state) return "unassigned";
    const isToday = dayId === todayId();
    const name = (task && task.assignedTo)
      || (isToday && state.dailyClaims && state.dailyClaims[slot] && state.dailyClaims[slot].name)
      || (state.assignments && state.assignments[dayId + "_" + slot])
      || "";
    if (!name) return "unassigned";
    const u = (state.users || []).find(u => u.name === name);
    return u ? u.id : ("name:" + name);
  }
  function checkKey(dayId, slot, taskId, ownerId) {
    const dateStr = checkDateForDay(dayId);
    const wk      = checkWeekOf(dateStr);
    return (ownerId || "unassigned") + "_" + wk + "_" + dateStr + "_" + slot + "_" + taskId;
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
    const border = (window.MX && MX.badgeBorder) ? MX.badgeBorder(name) : null;
    const tag    = (window.MX && MX.badgeTag) ? MX.badgeTag(name) : '';
    return `<span class="chip" style="background:${nc.bg};color:${nc.fg}${border?';border:1.5px solid '+border:''}">${tag}${esc(name)}</span>`;
  }

  function progressClass(pct) {
    if (pct >= 80) return "done";
    if (pct >= 40) return "warn";
    return "alert";
  }

  function alertLevel(slot, pct, alerts) {
    const cfg = (alerts || {})[slot];
    if (!cfg || !cfg.active) return "ok";
    const raw = cfg.deadline || "23:59";
    if (!/^\d{1,2}:\d{2}$/.test(raw)) return "ok";
    const now   = new Date();
    const parts = raw.split(":");
    const dl    = new Date(); dl.setHours(+parts[0], +parts[1], 0, 0);
    if (isNaN(dl.getTime()) || now < dl) return "ok";
    if (pct >= 100) return "ok";
    return pct >= 50 ? "warn" : "alert";
  }

  async function hashPin(pin) {
    if (!pin) return '';
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(pin)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── THEME MANAGER ──
  const _ACCENT_DARK = {
    cyan:   '#00F5D4',
    blue:   '#60A5FA',
    violet: '#A78BFA',
    pink:   '#F472B6',
    orange: '#FB923C',
    green:  '#4ADE80'
  };
  const _ACCENT_LIGHT = {
    cyan:   '#00897B',
    blue:   '#2563EB',
    violet: '#7C3AED',
    pink:   '#DB2777',
    orange: '#EA580C',
    green:  '#16A34A'
  };
  const _ACCENT_META = {
    cyan:   { label: 'Cyan Maintix', swatch: '#00BCD4' },
    blue:   { label: 'Bleu',         swatch: '#3B82F6' },
    violet: { label: 'Violet',       swatch: '#8B5CF6' },
    pink:   { label: 'Rose',         swatch: '#EC4899' },
    orange: { label: 'Orange',       swatch: '#F97316' },
    green:  { label: 'Vert',         swatch: '#22C55E' }
  };

  function _tmGetPrefs() {
    try { return JSON.parse(localStorage.getItem('mx_user_prefs') || '{}'); } catch(e) { return {}; }
  }
  function _tmSetPref(k, v) {
    const p = _tmGetPrefs();
    p[k] = v;
    localStorage.setItem('mx_user_prefs', JSON.stringify(p));
  }

  function _tmApplyAccent(accent) {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    html.style.removeProperty('--cyan');
    html.style.removeProperty('--cyan-dim');
    html.style.removeProperty('--cyan-border');
    if (accent === 'cyan') return;
    const hex = (isLight ? _ACCENT_LIGHT : _ACCENT_DARK)[accent];
    if (!hex) return;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    html.style.setProperty('--cyan', hex);
    html.style.setProperty('--cyan-dim', `rgba(${r},${g},${b},${isLight ? 0.09 : 0.10})`);
    html.style.setProperty('--cyan-border', `rgba(${r},${g},${b},0.28)`);
  }

  function _tmApplyTheme(theme) {
    const html = document.documentElement;
    html.classList.add('theme-switching');
    html.setAttribute('data-theme', theme);
    html.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    _tmApplyAccent(_tmGetPrefs().accent || 'cyan');
    setTimeout(() => html.classList.remove('theme-switching'), 300);
  }

  function _tmApplySize(size) {
    const html = document.documentElement;
    html.removeAttribute('data-size');
    if (size && size !== 'normal') html.setAttribute('data-size', size);
  }

  function _tmApplyCompact(compact) {
    document.documentElement.setAttribute('data-compact', compact ? 'true' : 'false');
  }

  const ThemeManager = {
    ACCENT_META: _ACCENT_META,
    init() {
      const p = _tmGetPrefs();
      _tmApplyTheme(p.theme || 'dark');
      _tmApplyAccent(p.accent || 'cyan');
      _tmApplySize(p.text_size || 'normal');
      _tmApplyCompact(!!p.compact);
    },
    setTheme(t)    { _tmApplyTheme(t);    _tmSetPref('theme', t); },
    setAccent(a)   { _tmApplyAccent(a);   _tmSetPref('accent', a); },
    setTextSize(s) { _tmApplySize(s);     _tmSetPref('text_size', s); },
    setCompact(c)  { _tmApplyCompact(c);  _tmSetPref('compact', c); },
    getTheme()  { return document.documentElement.getAttribute('data-theme') || 'dark'; },
    getAccent() { return _tmGetPrefs().accent || 'cyan'; },
    getSize()   { return _tmGetPrefs().text_size || 'normal'; },
    getCompact(){ return !!_tmGetPrefs().compact; },
  };

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
  function showModal(titleOrOpts, sub, actions) {
    const bodyEl = document.getElementById("m-body");
    // Object-style call: showModal({ title, sub, body, actions, noAutoClose })
    if (titleOrOpts && typeof titleOrOpts === 'object') {
      const o = titleOrOpts;
      document.getElementById("m-title").innerHTML = o.title || '';
      document.getElementById("m-sub").innerHTML = o.sub || '';
      if (bodyEl) bodyEl.innerHTML = o.body || '';
      const ac = document.getElementById("m-actions");
      // Use o.actions if set; fall back to the `actions` parameter (3rd arg)
      const actData = (o.actions !== undefined) ? o.actions : actions;
      if (typeof actData === 'string') {
        ac.innerHTML = actData;
      } else if (Array.isArray(actData)) {
        ac.innerHTML = '';
        actData.forEach(a => {
          const b = document.createElement("button");
          b.className = "modal-btn " + (a.cls || "cancel");
          b.innerHTML = a.label;  // innerHTML for icon support
          if (a.id)       b.id       = a.id;
          if (a.disabled) b.disabled = true;
          b.onclick = () => { if (!o.noAutoClose) closeModal(); if (a.fn) a.fn(); };
          ac.appendChild(b);
        });
      } else {
        ac.innerHTML = '';
      }
      document.getElementById("modal-bg").classList.add("show");
      return;
    }
    // Legacy call: showModal(title, sub, actions[])
    document.getElementById("m-title").textContent = titleOrOpts;
    document.getElementById("m-sub").textContent   = sub;
    if (bodyEl) bodyEl.innerHTML = '';
    const ac = document.getElementById("m-actions");
    ac.innerHTML = "";
    (actions || []).forEach(a => {
      const b = document.createElement("button");
      b.className = "modal-btn " + (a.cls || "cancel");
      b.innerHTML = a.label;  // innerHTML for icon support
      b.onclick = () => { closeModal(); if (a.fn) a.fn(); };
      ac.appendChild(b);
    });
    document.getElementById("modal-bg").classList.add("show");
  }
  function closeModal() { document.getElementById("modal-bg").classList.remove("show"); }

  function userAvatarHtml(name, opts) {
    const o  = opts || {};
    const sz = o.size   !== undefined ? o.size   : 36;
    const r  = o.radius !== undefined ? o.radius : Math.round(sz * 0.28);
    const u  = (window.MX && MX.state && MX.state.users || []).find(u => u.name === name);
    const nc = userColors(name);
    const border = (window.MX && MX.badgeBorder) ? MX.badgeBorder(name) : null;
    const st = `width:${sz}px;height:${sz}px;border-radius:${r}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${nc.bg};color:${nc.fg};font-size:${Math.round(sz*0.38)}px;font-weight:700;font-family:var(--ffm);overflow:hidden${border ? ';border:2px solid ' + border : ''}`;
    return `<div style="${st}">${(u && u.avatarUrl) ? `<img src="${esc(u.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;display:block;">` : avatarTxt(name)}</div>`;
  }

  function badgeTag(userName) {
    if (!window.MX || !MX.primaryBadge) return '';
    const b = MX.primaryBadge(userName);
    if (!b) return '';
    return `<span class="bdg-tag" title="${esc(b.name)}">${b.icon || '🏅'}</span>`;
  }

  // ── EXPORT ──
  window.MX = window.MX || {};
  Object.assign(window.MX, {
    SLOTS, DAYS, DEFT, TEAM_COLORS,
    esc, fmtTime, mkWeekLabel, todayId, getDaySlots,
    checkKey, checkOwnerId, checkDateForDay, checkWeekOf,
    avatarBg, avatarFg, avatarTxt, chipHtml, userColors, userAvatarHtml, badgeTag, _contrastColor, progressClass, alertLevel, hashPin,
    toast, showModal, closeModal,
    ThemeManager
  });
})();
