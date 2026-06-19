(function () {
  let _onLogin  = null;
  let _onLogout = null;
  let _pendingUserId = null;

  auth.onAuthStateChanged(user => {
    window.MX.state.adminUser = user || null;
    if (user) { _onLogin  && _onLogin(user); }
    else       { _onLogout && _onLogout(); }
    updateSidebarFooter();
    if (user) {
      _registerFcmToken("admin");
      MX.DB && MX.DB.updatePresence && MX.DB.updatePresence(user.email ? user.email.split("@")[0] : "admin");
    }
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
  function setCurrentUser(user) {
    window.MX.state.currentUser = user ? { id: user.id, name: user.name, role: user.role || "technicien", color: user.color || null } : null;
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
    setCurrentUser(null);
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
      <input id="pin-input" type="password" inputmode="numeric" maxlength="10" class="fi"
        placeholder="••••" autocomplete="off"
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

  function confirmPin() {
    const user = (MX.state.users || []).find(u => u.id === _pendingUserId);
    if (!user) return;
    const entered = (document.getElementById("pin-input") || {}).value || "";
    const errEl   = document.getElementById("pin-error");

    if (entered === String(user.pin || "")) {
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
    const admin  = window.MX.state.adminUser;
    const cu     = window.MX.state.currentUser;

    if (admin) {
      el.innerHTML = `
        <button class="nav-item" onclick="MX.Auth.logout()">
          <span class="nav-icon"><i class="fas fa-lock-open"></i></span>
          <span class="nav-label" style="font-size:12px">${MX.esc(admin.email)}</span>
          <span style="font-size:10px;color:var(--red)"><i class="fas fa-sign-out-alt"></i></span>
        </button>`;
    } else if (cu) {
      const nc  = MX.userColors ? MX.userColors(cu.name) : { bg: MX.avatarBg(cu.name), fg: MX.avatarFg(cu.name) };
      const bg  = cu.color || nc.bg;
      const fg  = cu.color ? _contrastColor(cu.color) : nc.fg;
      const lbl = cu.role === "responsable" ? "Responsable" : "Technicien";
      el.innerHTML = `
        <button class="nav-item" onclick="MX.Auth.clearCurrentUser()">
          <span class="nav-icon" style="background:${bg};color:${fg};border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:var(--ffm)">${MX.esc(cu.name.substring(0,2).toUpperCase())}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MX.esc(cu.name)}</div>
            <div style="font-size:10px;color:var(--text2)">${lbl}</div>
            <div class="user-online"><span class="user-online-dot"></span>En ligne</div>
          </div>
          <span style="font-size:10px;color:var(--cyan)"><i class="fas fa-exchange-alt"></i></span>
        </button>`;
    } else {
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;padding:4px 8px">
          <button class="nav-item" onclick="MX.Auth.showUserPicker()">
            <span class="nav-icon"><i class="fas fa-user-circle"></i></span>
            <span class="nav-label" style="font-size:12px;color:var(--cyan)">Se connecter</span>
          </button>
          <button class="nav-item" onclick="MX.showPage('admin')">
            <span class="nav-icon"><i class="fas fa-shield-halved"></i></span>
            <span class="nav-label">Administration</span>
          </button>
        </div>`;
    }
    // Notification permission button (visible until granted)
    if ("Notification" in window && Notification.permission !== "granted") {
      const notifDiv = document.createElement("div");
      notifDiv.style.cssText = "padding:2px 8px";
      notifDiv.innerHTML = `<button onclick="MX.enableNotifications()" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--border2);border-radius:8px;background:var(--bg4);color:var(--text2);cursor:pointer;font-size:11px;font-family:var(--ffs);width:100%;justify-content:center"><i class="fas fa-bell-slash"></i> Activer les notifications</button>`;
      el.appendChild(notifDiv);
    }
    // PWA install button
    if (MX._canInstall) {
      const installDiv = document.createElement("div");
      installDiv.style.cssText = "padding:2px 8px";
      installDiv.innerHTML = `<button onclick="MX.tryInstall()" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--cyan-border);border-radius:8px;background:var(--cyan-dim);color:var(--cyan);cursor:pointer;font-size:11px;font-family:var(--ffs);width:100%;justify-content:center"><i class="fas fa-download"></i> Installer l'appli</button>`;
      el.appendChild(installDiv);
    }
  }

  window.MX = window.MX || {};
  window.MX.Auth = {
    login, logout, requireAdmin, showLogin, hideLogin, cancelLogin,
    isAdmin, canSeeAll, onLogin, onLogout,
    setCurrentUser, clearCurrentUser, promptLogin,
    showUserPicker, hidePicker, selectUser, confirmPin, backToPicker, skipPicker,
    updateSidebarFooter
  };
})();
