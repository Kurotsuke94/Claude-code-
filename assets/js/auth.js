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
  function isAdmin()    { return !!window.MX.state.adminUser; }

  // ── WORKER IDENTITY ──
  function setWorker(name) {
    window.MX.state.currentWorker = name || null;
    if (name) localStorage.setItem("mx_worker", name);
    else       localStorage.removeItem("mx_worker");
    updateSidebarFooter();
    MX.buildNav && MX.buildNav();
    if (MX.state.currentPage && MX.DAYS && MX.DAYS.find(d => d.id === MX.state.currentPage)) {
      MX.Pages.Checklist.render(MX.state.currentPage);
    }
  }

  function getWorker()   { return window.MX.state.currentWorker; }

  function clearWorker() {
    setWorker(null);
    promptWorker();
  }

  function _allWorkerNames() {
    const set = new Set();
    ["matin","journee","soir"].forEach(sl => {
      (MX.state.teams[sl] || []).forEach(n => { if (n && n.trim()) set.add(n.trim()); });
    });
    return Array.from(set).sort();
  }

  function promptWorker() {
    if (isAdmin()) return;
    const names = _allWorkerNames();
    if (!names.length) return;
    const cur = getWorker();
    if (cur && names.includes(cur)) return;

    // Build worker picker directly inside the modal
    document.getElementById("m-title").textContent = "Qui êtes-vous ?";
    document.getElementById("m-sub").textContent   = "Sélectionnez votre nom pour ne voir que vos tâches assignées.";

    const ac = document.getElementById("m-actions");
    ac.innerHTML = "";

    names.forEach(name => {
      const bg  = MX.avatarBg ? MX.avatarBg(name) : "#2D1B69";
      const fg  = MX.avatarFg ? MX.avatarFg(name) : "#A78BFA";
      const btn = document.createElement("button");
      btn.className = "modal-btn confirm";
      btn.innerHTML = `<span style="width:22px;height:22px;border-radius:5px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:var(--ffm);margin-right:8px;flex-shrink:0">${MX.esc(name.substring(0,2).toUpperCase())}</span>${MX.esc(name)}`;
      btn.onclick = () => { MX.closeModal(); setWorker(name); MX.toast("Bienvenue " + name + " !"); };
      ac.appendChild(btn);
    });

    const skip = document.createElement("button");
    skip.className = "modal-btn cancel";
    skip.textContent = "Vue complète (tous les créneaux)";
    skip.onclick = () => { MX.closeModal(); setWorker(null); };
    ac.appendChild(skip);

    document.getElementById("modal-bg").classList.add("show");
  }

  // ── FIREBASE AUTH ──
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
    const user   = window.MX.state.adminUser;
    const worker = window.MX.state.currentWorker;
    if (user) {
      el.innerHTML = `
        <button class="nav-item" onclick="MX.Auth.logout()">
          <span class="nav-icon"><i class="fas fa-lock-open"></i></span>
          <span class="nav-label" style="font-size:12px">${MX.esc(user.email)}</span>
          <span style="font-size:10px;color:var(--red)"><i class="fas fa-sign-out-alt"></i></span>
        </button>`;
    } else if (worker) {
      const bg = MX.avatarBg ? MX.avatarBg(worker) : "#2D1B69";
      const fg = MX.avatarFg ? MX.avatarFg(worker) : "#A78BFA";
      el.innerHTML = `
        <button class="nav-item" onclick="MX.Auth.clearWorker()">
          <span class="nav-icon" style="background:${bg};color:${fg};border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:var(--ffm)">${MX.esc(worker.substring(0,2).toUpperCase())}</span>
          <span class="nav-label" style="font-size:12px">${MX.esc(worker)}</span>
          <span style="font-size:10px;color:var(--cyan)"><i class="fas fa-exchange-alt"></i></span>
        </button>`;
    } else {
      el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;padding:4px 8px">
          <button class="nav-item" onclick="MX.Auth.promptWorker()">
            <span class="nav-icon"><i class="fas fa-user-circle"></i></span>
            <span class="nav-label" style="font-size:12px;color:var(--cyan)">Qui êtes-vous ?</span>
          </button>
          <button class="nav-item" onclick="MX.showPage('admin')">
            <span class="nav-icon"><i class="fas fa-shield-halved"></i></span>
            <span class="nav-label">Administration</span>
          </button>
        </div>`;
    }
  }

  window.MX = window.MX || {};
  window.MX.Auth = {
    login, logout, requireAdmin, showLogin, hideLogin, cancelLogin,
    isAdmin, onLogin, onLogout,
    setWorker, getWorker, clearWorker, promptWorker,
    updateSidebarFooter
  };
})();
