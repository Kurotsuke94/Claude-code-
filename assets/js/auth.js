(function () {
  let _onLogin  = null;
  let _onLogout = null;
  let _pendingUserId = null;

  // ── DEV BYPASS (temporaire — supprimer avant production) ──
  var DEV_ADMIN_EMAIL = 'keyzeur94460@hotmail.fr';
  function _isDevAdmin() {
    try { var u = auth.currentUser; return !!(u && u.email === DEV_ADMIN_EMAIL); } catch(e) { return false; }
  }

  auth.onAuthStateChanged(user => {
    const prevAdmin = !!window.MX.state.adminUser;
    window.MX.state.adminUser = user || null;

    // ── DEBUG AUTH (temporaire) ──
    var _cu  = window.MX.state.currentUser;
    var _roles = window.MX.state.roles || [];
    var _roleDef = _cu && _cu.roleId ? _roles.find(function(r){ return r.id === _cu.roleId; }) : null;
    console.group('%c[Maintix] 🔐 Auth State Changed', 'color:#60A5FA;font-weight:700');
    console.log('Utilisateur connecté :', user ? 'Oui (Firebase Admin)' : 'Non');
    console.log('Email :', user ? user.email : '—');
    console.log('UID :', user ? user.uid : '—');
    console.log('DEV BYPASS actif :', _isDevAdmin());
    console.log('adminUser :', !!window.MX.state.adminUser);
    console.log('currentUser (PIN) :', _cu ? _cu.name : '—');
    console.log('Role détecté :', user ? 'Administrateur Firebase' : (_cu ? (_roleDef ? _roleDef.name : _cu.role) : 'Non connecté'));
    console.log('isAdmin() :', !!(window.MX.state.adminUser || _isDevAdmin()));
    console.log('canSeeAll() :', !!(window.MX.state.adminUser || _isDevAdmin() || (_cu && _cu.role === 'responsable')));
    console.groupEnd();

    if (user) {
      _onLogin && _onLogin(user);
      _registerFcmToken("admin");
      MX.DB && MX.DB.updatePresence && MX.DB.updatePresence(user.email ? user.email.split("@")[0] : "admin");
      // Rebuild nav with admin sections now that auth is confirmed
      if (window.MX && window.MX.buildNav) {
        try { window.MX.buildNav(); } catch(e) {}
      }
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
  function isAdmin()    { return !!window.MX.state.adminUser || _isDevAdmin(); }
  function canSeeAll()  { return isAdmin() || (window.MX.state.currentUser && window.MX.state.currentUser.role === "responsable"); }

  // ── FCM TOKEN REGISTRATION ──
  async function _registerFcmToken(userName) {
    const m = window.MX.messaging;
    const v = window.MX.VAPID_KEY;
    if (!m || !v || v.startsWith('REMPLACER')) {
      console.log('[FCM] Messaging non disponible — token non enregistré');
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      console.log('[FCM] Permission notifications non accordée — token non enregistré');
      return;
    }
    try {
      const platform = /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios'
        : /android/i.test(navigator.userAgent) ? 'android' : 'desktop';
      const reg   = await navigator.serviceWorker.getRegistration('/sw.js');
      const token = await m.getToken({ vapidKey: v, serviceWorkerRegistration: reg });
      if (token) {
        await MX.DB.saveFcmToken(token, userName, platform);
        window._fcmToken = token;
        console.log('[FCM] ✅ Token enregistré (' + platform + ') :', token.slice(0, 20) + '…');
        m.onTokenRefresh(async function() {
          try {
            const newToken = await m.getToken({ vapidKey: v, serviceWorkerRegistration: reg });
            if (newToken && newToken !== window._fcmToken) {
              await MX.DB.saveFcmToken(newToken, userName, platform);
              window._fcmToken = newToken;
              console.log('[FCM] 🔄 Token rafraîchi :', newToken.slice(0, 20) + '…');
            }
          } catch(refreshErr) {
            console.error('[FCM] Erreur refresh token :', refreshErr);
          }
        });
      } else {
        console.warn('[FCM] getToken() a renvoyé null — vérifier APNs (iOS) ou permissions');
      }
    } catch(e) { console.error('[FCM] ❌ Erreur enregistrement token :', e.code || '', e.message || e); }
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

    // ── DEBUG PIN USER (temporaire) ──
    var _cu = window.MX.state.currentUser;
    var _roles = window.MX.state.roles || [];
    var _roleDef = _cu && _cu.roleId ? _roles.find(function(r){ return r.id === _cu.roleId; }) : null;
    console.group('%c[Maintix] 👤 Utilisateur PIN Changed', 'color:#4ADE80;font-weight:700');
    console.log('Utilisateur connecté :', _cu ? _cu.name : 'Déconnecté');
    console.log('Role :', _cu ? (_roleDef ? _roleDef.name : _cu.role) : '—');
    console.log('RoleId :', _cu ? (_cu.roleId || 'aucun') : '—');
    console.log('isAdmin() :', isAdmin());
    console.log('canSeeAll() :', canSeeAll());
    console.log('Permissions :', _roleDef ? JSON.stringify(_roleDef.permissions || {}) : (_cu && _cu.role === 'responsable' ? 'tout (responsable)' : 'standard technicien'));
    console.log('Menus affichés :', canSeeAll() ? 'TOUS (admin/responsable)' : 'Filtrés par rôle');
    console.groupEnd();

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
    if (window._fcmToken && MX.DB && MX.DB.deleteFcmToken) {
      MX.DB.deleteFcmToken(window._fcmToken).catch(function(e) {
        console.warn('[FCM] Erreur suppression token :', e);
      });
      window._fcmToken = null;
    }
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
    _updateSidebarTrigger();
    _buildAccountPanel();
  }

  function _updateSidebarTrigger() {
    const avatarEl = document.getElementById("sxap-trigger-avatar");
    const nameEl   = document.getElementById("sxap-trigger-name");
    const roleEl   = document.getElementById("sxap-trigger-role");
    if (!avatarEl) return;
    const admin = window.MX.state.adminUser;
    const cu    = window.MX.state.currentUser;

    if (admin) {
      const email    = admin.email || "";
      const initials = email.substring(0, 2).toUpperCase();
      avatarEl.className        = "sxap-trigger-avatar sxap-trigger-avatar--admin";
      avatarEl.innerHTML        = MX.esc(initials);
      avatarEl.style.background = "";
      avatarEl.style.color      = "";
      if (nameEl) nameEl.textContent = email.split("@")[0];
      if (roleEl) roleEl.textContent = "Administrateur";
    } else if (cu) {
      const nc       = MX.userColors ? MX.userColors(cu.name) : { bg: MX.avatarBg(cu.name), fg: MX.avatarFg(cu.name) };
      const bg       = cu.color || nc.bg;
      const fg       = cu.color ? _contrastColor(cu.color) : nc.fg;
      const fullUser = (MX.state.users || []).find(u => u.id === cu.id) || cu;
      const _cuRole  = (window.MX.state.roles || []).find(r => r.id === cu.roleId);
      const lbl      = _cuRole ? (_cuRole.emoji ? _cuRole.emoji + " " + _cuRole.name : _cuRole.name) : (cu.role === "responsable" ? "Responsable" : "Technicien");
      avatarEl.className        = "sxap-trigger-avatar";
      avatarEl.style.background = bg;
      avatarEl.style.color      = fg;
      if (fullUser.avatarUrl) {
        avatarEl.innerHTML = '<img src="' + MX.esc(fullUser.avatarUrl) + '" class="sxap-trigger-img" alt="">';
      } else {
        avatarEl.textContent = cu.name.substring(0, 2).toUpperCase();
      }
      if (nameEl) nameEl.textContent = cu.name;
      if (roleEl) roleEl.textContent = lbl;
    } else {
      avatarEl.className        = "sxap-trigger-avatar sxap-trigger-avatar--anon";
      avatarEl.innerHTML        = '<i class="fas fa-user" aria-hidden="true"></i>';
      avatarEl.style.background = "";
      avatarEl.style.color      = "";
      if (nameEl) nameEl.textContent = "Se connecter";
      if (roleEl) roleEl.textContent = "";
    }
  }

  function _buildAccountPanel() {
    const panel = document.getElementById("sxap-panel");
    if (!panel) return;
    const admin = window.MX.state.adminUser;
    const cu    = window.MX.state.currentUser;
    let html = '<div class="sxap-items">';

    if (admin) {
      const email    = admin.email || "";
      const initials = email.substring(0, 2).toUpperCase();
      html += '<div class="sxap-head">'
            + '<div class="sxap-head-avatar sxap-head-avatar--admin">' + MX.esc(initials) + '</div>'
            + '<div class="sxap-head-info">'
            + '<div class="sxap-head-name">' + MX.esc(email.split("@")[0]) + '</div>'
            + '<div class="sxap-head-role"><span class="sxap-dot sxap-dot--on"></span>Administrateur</div>'
            + '</div></div>';
      html += '<div class="sxap-sep"></div>';
      html += '<button class="sxap-item" onclick="MX.showPage(\'admin\');MX.closeAccountPanel()"><i class="fas fa-shield-halved"></i><span>Administration</span></button>';
      html += '<button class="sxap-item" onclick="MX.showPage(\'ios-diag\');MX.closeAccountPanel()"><i class="fas fa-mobile-screen-button"></i><span>Diagnostic Push</span></button>';
      html += '<div class="sxap-sep"></div>';
      html += '<button class="sxap-item sxap-item--danger" onclick="MX.Auth.logout()"><i class="fas fa-sign-out-alt"></i><span>Déconnexion</span></button>';
    } else if (cu) {
      const nc           = MX.userColors ? MX.userColors(cu.name) : { bg: MX.avatarBg(cu.name), fg: MX.avatarFg(cu.name) };
      const bg           = cu.color || nc.bg;
      const fg           = cu.color ? _contrastColor(cu.color) : nc.fg;
      const fullUser     = (MX.state.users || []).find(u => u.id === cu.id) || cu;
      const _cuRole      = (window.MX.state.roles || []).find(r => r.id === cu.roleId);
      const lbl          = _cuRole ? (_cuRole.emoji ? _cuRole.emoji + " " + _cuRole.name : _cuRole.name) : (cu.role === "responsable" ? "Responsable" : "Technicien");
      const gradeBadge   = (MX.Rewards && MX.Rewards.getUserGradeBadge) ? MX.Rewards.getUserGradeBadge(cu.name, { small: true }) : "";
      const rUser        = (MX.state.rewardsUsers || {})[cu.name] || {};
      const pts          = rUser.points || 0;
      const _sfBdgBorder = MX.badgeBorder ? MX.badgeBorder(cu.name) : null;
      const borderStyle  = _sfBdgBorder ? ";border:2px solid " + _sfBdgBorder : "";
      const avatarInner  = fullUser.avatarUrl
        ? '<img src="' + MX.esc(fullUser.avatarUrl) + '" class="sxap-head-img" alt="">'
        : MX.esc(cu.name.substring(0, 2).toUpperCase());
      html += '<div class="sxap-head">'
            + '<div class="sxap-head-avatar" style="background:' + bg + ';color:' + fg + borderStyle + '">' + avatarInner + '</div>'
            + '<div class="sxap-head-info">'
            + '<div class="sxap-head-name">' + (MX.badgeTag ? MX.badgeTag(cu.name) : "") + MX.esc(cu.name) + '</div>'
            + '<div class="sxap-head-role"><span class="sxap-dot sxap-dot--on"></span>' + lbl + (pts ? ' <span class="sxap-pts">' + pts + ' pts</span>' : "") + '</div>'
            + (gradeBadge ? '<div class="sxap-head-grade">' + gradeBadge + '</div>' : "")
            + '</div></div>';
      html += '<div class="sxap-sep"></div>';
      html += '<button class="sxap-item" onclick="MX.showPage(\'settings\');MX.closeAccountPanel()"><i class="fas fa-sliders"></i><span>Paramètres</span></button>';
      html += '<div class="sxap-sep"></div>';
      html += '<button class="sxap-item" onclick="MX.Auth.clearCurrentUser();MX.closeAccountPanel()"><i class="fas fa-exchange-alt"></i><span>Changer de profil</span></button>';
    } else {
      html += '<div class="sxap-head sxap-head--anon">'
            + '<div class="sxap-head-avatar sxap-head-avatar--anon"><i class="fas fa-user" aria-hidden="true"></i></div>'
            + '<div class="sxap-head-info">'
            + '<div class="sxap-head-name">Non connecté</div>'
            + '<div class="sxap-head-role">Visiteur</div>'
            + '</div></div>';
      html += '<div class="sxap-sep"></div>';
      html += '<button class="sxap-item sxap-item--primary" onclick="MX.Auth.showUserPicker();MX.closeAccountPanel()"><i class="fas fa-user-circle"></i><span>Se connecter</span></button>';
      html += '<button class="sxap-item" onclick="MX.showPage(\'utilisateurs\');MX.closeAccountPanel()"><i class="fas fa-shield-halved"></i><span>Administration</span></button>';
    }

    if ("Notification" in window && Notification.permission !== "granted") {
      html += '<div class="sxap-sep"></div>';
      html += '<button class="sxap-item" onclick="MX.enableNotifications()"><i class="fas fa-bell-slash"></i><span>Activer les notifications</span></button>';
    }
    if (MX._canInstall) {
      html += '<button class="sxap-item sxap-item--install" onclick="MX.tryInstall()"><i class="fas fa-download"></i><span>Installer l\'appli</span></button>';
    }
    html += '</div>';
    panel.innerHTML = html;
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
