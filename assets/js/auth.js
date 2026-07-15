(function () {
  let _onLogin  = null;
  let _onLogout = null;
  let _pendingUserId = null;

  auth.onAuthStateChanged(user => {
    const prevAdmin = !!window.MX.state.adminUser;
    window.MX.state.adminUser = user || null;
    if (user) {
      _onLogin && _onLogin(user);
      _registerFcmToken("admin");
      MX.DB && MX.DB.updatePresence && MX.DB.updatePresence(user.email ? user.email.split("@")[0] : "admin");
    } else {
      if (prevAdmin) {
        // Admin logout → full session teardown: clear PIN user + destroy UI
        _pendingUserId = null;
        window.MX.state.currentUser = null;
        localStorage.removeItem('mx_user');
        _destroyUI();
        // Reset admin login form (email/password/error)
        const lf = document.getElementById('login-form');
        if (lf) lf.reset();
        const le = document.getElementById('login-error');
        if (le) le.classList.add('hidden');
      }
      _onLogout && _onLogout();
    }
    updateSidebarFooter();
  });

  function onLogin(cb)  { _onLogin  = cb; }
  function onLogout(cb) { _onLogout = cb; }
  function isAdmin()    { return !!window.MX.state.adminUser; }
  function canSeeAll()  { return isAdmin() || (window.MX.state.currentUser && window.MX.state.currentUser.role === "responsable"); }

  // ── FCM TOKEN REGISTRATION ──
  async function _registerFcmToken(userName) {
    const m = window.MX.messaging;
    const v = window.MX.VAPID_KEY;
    if (!m || !v || v.startsWith('REMPLACER')) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg   = await navigator.serviceWorker.getRegistration('/sw.js');
      const token = await m.getToken({ vapidKey: v, serviceWorkerRegistration: reg });
      if (token) {
        await MX.DB.saveFcmToken(token, userName);
        window._fcmToken = token;
      }
    } catch(e) { console.warn('FCM token:', e); }
  }

  // ── USER IDENTITY (PIN) ──
  function isResponsable() {
    const cu = window.MX.state.currentUser;
    return !!cu && (cu.rank === 'responsable' || cu.role === 'responsable');
  }

  // Permission check — works for role-system users (roleId) and legacy users
  function can(module, action) {
    if (isAdmin()) return true;
    const cu = window.MX.state.currentUser;
    if (!cu) return false;
    if (cu.roleId) {
      const role = (window.MX.state.roles || []).find(r => r.id === cu.roleId);
      if (role && role.permissions) return !!(role.permissions[module] && role.permissions[module][action]);
      return false;
    }
    // Legacy fallback: no roleId assigned → use old role field
    if (cu.role === 'responsable') return true;
    const TECH = { checklist: ['view','check'], planning: ['view'], counters: ['view','enter'], interventions: ['view'], messages: ['view','send'], resources: ['view'] };
    return !!(TECH[module] && TECH[module].includes(action));
  }

  function setCurrentUser(user) {
    window.MX.state.currentUser = user ? {
      id:     user.id,
      name:   user.name,
      role:   user.role   || "technicien",
      rank:   user.rank   || (user.role === 'responsable' ? 'responsable' : 'utilisateur'),
      roleId: user.roleId || null,
      color:  user.color  || null,
    } : null;
    if (user) localStorage.setItem("mx_user", JSON.stringify(window.MX.state.currentUser));
    else      localStorage.removeItem("mx_user");
    localStorage.removeItem("mx_worker"); // clean up old key
    updateSidebarFooter();
    MX.buildNav && MX.buildNav();
    const page = MX.state.currentPage;
    if (page && MX.DAYS && MX.DAYS.find(d => d.id === page)) MX.Pages.Checklist.render(page);
    if (user) {
      _registerFcmToken(user.name);
      MX.DB && MX.DB.updatePresence && MX.DB.updatePresence(user.name);
      setTimeout(() => MX.showNotifOnboarding && MX.showNotifOnboarding(), 1500);
    }
  }

  function clearCurrentUser() {
    _destroyUI();         // close modals, destroy page listeners — before state is wiped
    setCurrentUser(null); // clear MX.state.currentUser + localStorage
    showUserPicker();
  }

  function promptLogin() {
    if (isAdmin()) return;
    const users = MX.state.users || [];
    if (!users.length) return; // no profiles yet, let admin set up first
    const cu = MX.state.currentUser;
    if (cu && users.find(u => u.id === cu.id)) return; // already logged in
    showUserPicker();
  }

  function showUserPicker() {
    const users = MX.state.users || [];
    const list  = document.getElementById("user-picker-list");
    if (!list) return;

    if (!users.length) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text2);font-size:13px">
        Aucun profil configuré.<br>Un administrateur doit créer les profils dans le panneau Admin.
      </div>`;
    } else {
      list.innerHTML = users.map(u => {
        const nc  = MX.userColors ? MX.userColors(u.name) : { bg: MX.avatarBg(u.name), fg: MX.avatarFg(u.name) };
        const bg  = u.color || nc.bg;
        const fg  = u.color ? MX._contrastColor(u.color) : nc.fg;
        const lbl = u.role === "responsable" ? "Responsable" : "Technicien";
        return `<button onclick="MX.Auth.selectUser('${u.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg3);border:1px solid var(--border2);border-radius:12px;cursor:pointer;width:100%;text-align:left;transition:var(--t)" onmouseover="this.style.borderColor='var(--cyan)'" onmouseout="this.style.borderColor='var(--border2)'">
          <span style="width:42px;height:42px;border-radius:12px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${MX.esc(u.name.substring(0,2).toUpperCase())}</span>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">${MX.esc(u.name)}</div>
            <div style="font-size:11px;color:var(--text2)">${lbl}</div>
          </div>
          <i class="fas fa-chevron-right" style="color:var(--text3);font-size:12px"></i>
        </button>`;
      }).join('');
    }

    document.getElementById("user-picker").classList.remove("hidden");
  }

  function hidePicker() {
    document.getElementById("user-picker").classList.add("hidden");
  }

  function selectUser(userId) {
    const user = (MX.state.users || []).find(u => u.id === userId);
    if (!user) return;
    hidePicker();
    _pendingUserId = userId;

    // Wipe the shared modal completely — any previously open task form must not bleed through
    MX.closeModal && MX.closeModal();
    ['m-body', 'm-title', 'm-sub', 'm-actions'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Show PIN entry in modal
    const nc  = MX.userColors ? MX.userColors(user.name) : { bg: MX.avatarBg(user.name), fg: MX.avatarFg(user.name) };
    const bg  = user.color || nc.bg;
    const fg  = user.color ? _contrastColor(user.color) : nc.fg;

    document.getElementById("m-title").textContent = "";
    document.getElementById("m-sub").innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0 4px">
        <div style="width:56px;height:56px;border-radius:16px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;font-family:var(--ffm)">${MX.esc(user.name.substring(0,2).toUpperCase())}</div>
        <div style="font-size:16px;font-weight:700">${MX.esc(user.name)}</div>
        <div style="font-size:12px;color:var(--text2)">Entrez votre code PIN</div>
      </div>`;

    const ac = document.getElementById("m-actions");
    ac.innerHTML = `
      <input id="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="10" class="fi"
        placeholder="••••" autocomplete="one-time-code"
        style="text-align:center;letter-spacing:8px;font-size:22px;font-family:var(--ffm);margin-bottom:4px">
      <div id="pin-error" style="font-size:12px;color:var(--red);text-align:center;min-height:18px;margin-bottom:6px"></div>
      <button class="modal-btn confirm" onclick="MX.Auth.confirmPin()"><i class="fas fa-check"></i> Confirmer</button>
      <button class="modal-btn cancel" onclick="MX.Auth.backToPicker()"><i class="fas fa-arrow-left"></i> Retour</button>`;

    document.getElementById("modal-bg").classList.add("show");

    setTimeout(() => {
      const inp = document.getElementById("pin-input");
      if (inp) {
        inp.focus();
        inp.addEventListener("keydown", e => { if (e.key === "Enter") MX.Auth.confirmPin(); });
      }
    }, 80);
  }

  async function confirmPin() {
    const user = (MX.state.users || []).find(u => u.id === _pendingUserId);
    if (!user) return;
    const entered   = (document.getElementById("pin-input") || {}).value || "";
    const errEl     = document.getElementById("pin-error");
    const storedPin = String(user.pin || "");

    let match;
    if (/^[0-9a-f]{64}$/.test(storedPin)) {
      const hash = await MX.hashPin(entered);
      match = hash === storedPin;
    } else {
      // Legacy: plain-text PIN (auto-migrated next time admin saves)
      match = entered === storedPin;
    }

    if (match) {
      MX.closeModal();
      _pendingUserId = null;
      setCurrentUser(user);
      MX.toast("Bienvenue " + user.name + " !");
    } else {
      if (errEl) errEl.textContent = "PIN incorrect. Réessayez.";
      const inp = document.getElementById("pin-input");
      if (inp) { inp.value = ""; inp.focus(); }
    }
  }

  function backToPicker() {
    _pendingUserId = null;
    MX.closeModal();
    showUserPicker();
  }

  function skipPicker() {
    hidePicker();
    setCurrentUser(null);
  }

  function _contrastColor(hex) {
    if (!hex || hex.length < 7) return "#FFFFFF";
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return (r*299 + g*587 + b*114) / 1000 > 128 ? "#0C0C0E" : "#FFFFFF";
  }
  // Expose for helpers.js
  window.MX._contrastColor = _contrastColor;

  // ── SESSION TEARDOWN ──
  function _destroyUI() {
    // 1. Close any open modal and wipe all modal content slots
    MX.closeModal && MX.closeModal();
    ['m-body', 'm-title', 'm-sub', 'm-actions'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    // 2. Hide user picker overlay
    hidePicker();
    // 3. Destroy page-level Firestore listeners
    const P = window.MX && window.MX.Pages;
    try { P && P.OrgResp     && P.OrgResp._destroy     && P.OrgResp._destroy();     } catch(e) {}
    try { P && P.MesMissions && P.MesMissions._destroy && P.MesMissions._destroy(); } catch(e) {}
    try { P && P.Bible       && P.Bible._destroy       && P.Bible._destroy();       } catch(e) {}
    try { P && P.Planning    && P.Planning._destroy    && P.Planning._destroy();    } catch(e) {}
    try { P && P.Equipe      && P.Equipe._destroy      && P.Equipe._destroy();      } catch(e) {}
    try { P && P.MxDoc       && P.MxDoc._destroy       && P.MxDoc._destroy();       } catch(e) {}
    // 4. Stop alerts engine
    try { window.MX.AlertsEngine && window.MX.AlertsEngine.stop && window.MX.AlertsEngine.stop(); } catch(e) {}
  }

  // ── FIREBASE ADMIN AUTH ──
  async function login(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const pass  = document.getElementById("login-password").value;
    const btn   = document.getElementById("login-btn");
    const err   = document.getElementById("login-error");

    btn.disabled = true;
    btn.textContent = "Connexion…";
    err.classList.add("hidden");

    try {
      await auth.signInWithEmailAndPassword(email, pass);
      hideLogin();
      MX.toast("Connecté en tant qu'administrateur ✓");
      MX.showPage("admin");
    } catch (ex) {
      err.textContent = "Email ou mot de passe incorrect.";
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
    }
  }

  function logout() {
    MX.showModal("Déconnexion", "Quitter le mode administrateur ?", [
      { label: "Se déconnecter", cls: "danger", fn: () => auth.signOut() },
      { label: "Annuler",       cls: "cancel" }
    ]);
  }

  function requireAdmin(cb) {
    if (isAdmin()) { cb(); return; }
    showLogin(cb);
  }

  let _afterLogin = null;
  function showLogin(afterLoginCb) {
    _afterLogin = afterLoginCb || null;
    document.getElementById("login-overlay").classList.remove("hidden");
    setTimeout(() => document.getElementById("login-email").focus(), 100);
  }
  function hideLogin() {
    document.getElementById("login-overlay").classList.add("hidden");
    if (_afterLogin) { _afterLogin(); _afterLogin = null; }
  }
  function cancelLogin() { hideLogin(); }

  function updateSidebarFooter() {
    const el = document.getElementById("sidebar-footer");
    if (!el) return;
    const admin = window.MX.state.adminUser;
    const cu    = window.MX.state.currentUser;

    if (admin) {
      const email    = admin.email || "";
      const initials = email.substring(0, 2).toUpperCase();
      el.innerHTML = `
        <button class="sxf-btn" onclick="MX.Auth.logout()">
          <div class="sxf-avatar sxf-avatar--admin">${MX.esc(initials)}</div>
          <div class="sxf-info">
            <div class="sxf-name">${MX.esc(email.split("@")[0])}</div>
            <div class="sxf-role"><span class="sxf-dot sxf-dot--on"></span><span class="sxf-role-lbl">Administrateur</span></div>
          </div>
          <i class="fas fa-sign-out-alt sxf-logout"></i>
        </button>`;
    } else if (cu) {
      const nc       = MX.userColors ? MX.userColors(cu.name) : { bg: MX.avatarBg(cu.name), fg: MX.avatarFg(cu.name) };
      const bg       = cu.color || nc.bg;
      const fg       = cu.color ? _contrastColor(cu.color) : nc.fg;
      const _cuRole  = (window.MX.state.roles || []).find(r => r.id === cu.roleId);
      const lbl      = _cuRole ? (_cuRole.emoji ? _cuRole.emoji + ' ' + _cuRole.name : _cuRole.name) : (cu.role === "responsable" ? "Responsable" : "Technicien");
      const fullUser = (MX.state.users || []).find(u => u.id === cu.id) || cu;
      const gradeBadge = (MX.Rewards && MX.Rewards.getUserGradeBadge) ? MX.Rewards.getUserGradeBadge(cu.name, { small: true }) : "";
      const rUser    = (MX.state.rewardsUsers || {})[cu.name] || {};
      const pts      = rUser.points || 0;
      const _sfBdgBorder = MX.badgeBorder ? MX.badgeBorder(cu.name) : null;
      el.innerHTML = `
        <button class="sxf-btn" onclick="MX.Auth.clearCurrentUser()">
          <div class="sxf-avatar" style="background:${bg};color:${fg}${_sfBdgBorder?';border:2px solid '+_sfBdgBorder:''}">${
            fullUser.avatarUrl
              ? `<img src="${MX.esc(fullUser.avatarUrl)}" class="sxf-avatar-img">`
              : MX.esc(cu.name.substring(0, 2).toUpperCase())
          }</div>
          <div class="sxf-info">
            <div class="sxf-name">${MX.badgeTag ? MX.badgeTag(cu.name) : ''}${MX.esc(cu.name)}</div>
            <div class="sxf-role">
              <span class="sxf-dot sxf-dot--on"></span>
              <span class="sxf-role-lbl">${lbl}</span>
              ${pts ? `<span class="sxf-pts">${pts} pts</span>` : ""}
            </div>
            ${gradeBadge ? `<div class="sxf-grade">${gradeBadge}</div>` : ""}
          </div>
          <i class="fas fa-exchange-alt sxf-logout"></i>
        </button>`;
    } else {
      el.innerHTML = `
        <div class="sxf-anon">
          <button class="sxf-anon-btn sxf-anon-btn--primary" onclick="MX.Auth.showUserPicker()"><i class="fas fa-user-circle"></i> Se connecter</button>
          <button class="sxf-anon-btn" onclick="MX.showPage('utilisateurs')"><i class="fas fa-shield-halved"></i> Administration</button>
        </div>`;
    }
    if ("Notification" in window && Notification.permission !== "granted") {
      const d = document.createElement("div");
      d.style.cssText = "padding:4px 0 0";
      d.innerHTML = `<button onclick="MX.enableNotifications()" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--border2);border-radius:8px;background:var(--bg4);color:var(--text2);cursor:pointer;font-size:11px;font-family:var(--ffs);width:100%;justify-content:center"><i class="fas fa-bell-slash"></i> Activer les notifications</button>`;
      el.appendChild(d);
    }
    if (MX._canInstall) {
      const d = document.createElement("div");
      d.style.cssText = "padding:4px 0 0";
      d.innerHTML = `<button onclick="MX.tryInstall()" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--cyan-border);border-radius:8px;background:var(--cyan-dim);color:var(--cyan);cursor:pointer;font-size:11px;font-family:var(--ffs);width:100%;justify-content:center"><i class="fas fa-download"></i> Installer l'appli</button>`;
      el.appendChild(d);
    }
  }

  window.MX = window.MX || {};
  window.MX.Auth = {
    login, logout, requireAdmin, showLogin, hideLogin, cancelLogin,
    isAdmin, canSeeAll, isResponsable, can, onLogin, onLogout,
    setCurrentUser, clearCurrentUser, promptLogin,
    showUserPicker, hidePicker, selectUser, confirmPin, backToPicker, skipPicker,
    updateSidebarFooter
  };
})();
