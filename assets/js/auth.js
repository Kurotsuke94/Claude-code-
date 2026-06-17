(function () {
  let _onLogin  = null;
  let _onLogout = null;

  auth.onAuthStateChanged(user => {
    window.MX.state.adminUser = user || null;
    if (user) { _onLogin  && _onLogin(user); }
    else       { _onLogout && _onLogout(); }
    updateSidebarFooter();
  });

  function onLogin(cb)  { _onLogin  = cb; }
  function onLogout(cb) { _onLogout = cb; }

  function isAdmin() { return !!window.MX.state.adminUser; }

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
    const user = window.MX.state.adminUser;
    if (user) {
      el.innerHTML = `
        <button class="nav-item" onclick="MX.Auth.logout()">
          <span class="nav-icon"><i class="fas fa-lock-open"></i></span>
          <span class="nav-label" style="font-size:12px">${MX.esc(user.email)}</span>
          <span style="font-size:10px;color:var(--red)"><i class="fas fa-sign-out-alt"></i></span>
        </button>`;
    } else {
      el.innerHTML = `
        <button class="nav-item" onclick="MX.showPage('admin')">
          <span class="nav-icon"><i class="fas fa-shield-halved"></i></span>
          <span class="nav-label">Administration</span>
        </button>`;
    }
  }

  window.MX = window.MX || {};
  window.MX.Auth = { login, logout, requireAdmin, showLogin, hideLogin, cancelLogin, isAdmin, onLogin, onLogout };
})();
