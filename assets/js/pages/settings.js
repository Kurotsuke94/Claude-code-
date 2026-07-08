(function () {
  // ── PREFS HELPERS ──
  function _getPrefs() {
    try { return JSON.parse(localStorage.getItem('mx_user_prefs') || '{}'); } catch(e) { return {}; }
  }
  function _setPrefs(data) {
    const cur = _getPrefs();
    localStorage.setItem('mx_user_prefs', JSON.stringify(Object.assign(cur, data)));
  }
  function _getPref(key, def) {
    const p = _getPrefs();
    return (key in p) ? p[key] : def;
  }

  // ── CURRENT SECTION STATE ──
  let _section = 'profil';

  const SECTIONS = [
    { id: 'profil',        icon: 'fa-user-circle',    l: 'Mon profil' },
    { id: 'securite',      icon: 'fa-shield-halved',  l: 'Sécurité' },
    { id: 'notifications', icon: 'fa-bell',            l: 'Notifications' },
    { id: 'apparence',     icon: 'fa-palette',         l: 'Apparence' },
    { id: 'planning',      icon: 'fa-calendar-days',   l: 'Planning' },
    { id: 'application',   icon: 'fa-sliders',         l: 'Application' },
    { id: 'permissions',   icon: 'fa-lock',            l: 'Permissions', adminOnly: true },
    { id: 'journal',       icon: 'fa-clock-rotate-left', l: 'Journal' },
    { id: 'nouveautes',    icon: 'fa-rocket',           l: 'Nouveautés' },
    { id: 'informations',  icon: 'fa-shield-halved',    l: 'Informations' },
    { id: 'apropos',       icon: 'fa-circle-info',      l: 'À propos' },
    { id: 'maintenance',   icon: 'fa-wrench',           l: 'Maintenance', adminOnly: true },
    { id: 'energie', icon: 'fa-bolt-lightning', l: 'Performance énergie', adminOnly: true },
  ];

  // ── AVATAR CANVAS CROP ──
  let _cropCanvas, _cropCtx, _cropImg, _cropOffX = 0, _cropOffY = 0, _cropScale = 1, _cropRot = 0;
  let _cropDragging = false, _cropDragStart = null;

  function _renderCropCanvas() {
    if (!_cropCtx || !_cropImg) return;
    const s = 256;
    _cropCtx.clearRect(0, 0, s, s);
    _cropCtx.save();
    _cropCtx.translate(s / 2 + _cropOffX, s / 2 + _cropOffY);
    _cropCtx.rotate(_cropRot * Math.PI / 180);
    const w = _cropImg.naturalWidth * _cropScale;
    const h = _cropImg.naturalHeight * _cropScale;
    _cropCtx.drawImage(_cropImg, -w / 2, -h / 2, w, h);
    _cropCtx.restore();
    // Circular clip overlay
    _cropCtx.save();
    _cropCtx.fillStyle = 'rgba(8,11,20,0.55)';
    _cropCtx.fillRect(0, 0, s, s);
    _cropCtx.globalCompositeOperation = 'destination-out';
    _cropCtx.beginPath();
    _cropCtx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
    _cropCtx.fill();
    _cropCtx.restore();
    // Border ring
    _cropCtx.save();
    _cropCtx.strokeStyle = 'rgba(0,245,212,0.6)';
    _cropCtx.lineWidth = 2;
    _cropCtx.beginPath();
    _cropCtx.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
    _cropCtx.stroke();
    _cropCtx.restore();
  }

  function _cropCommit() {
    const s = 256;
    const out = document.createElement('canvas');
    out.width = s; out.height = s;
    const ctx = out.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.translate(s / 2 + _cropOffX, s / 2 + _cropOffY);
    ctx.rotate(_cropRot * Math.PI / 180);
    const w = _cropImg.naturalWidth * _cropScale;
    const h = _cropImg.naturalHeight * _cropScale;
    ctx.drawImage(_cropImg, -w / 2, -h / 2, w, h);
    ctx.restore();
    return out.toDataURL('image/jpeg', 0.80);
  }

  function _bindCropEvents(canvas) {
    canvas.addEventListener('mousedown', e => {
      _cropDragging = true;
      _cropDragStart = { x: e.clientX - _cropOffX, y: e.clientY - _cropOffY };
    });
    canvas.addEventListener('mousemove', e => {
      if (!_cropDragging) return;
      _cropOffX = e.clientX - _cropDragStart.x;
      _cropOffY = e.clientY - _cropDragStart.y;
      _renderCropCanvas();
    });
    canvas.addEventListener('mouseup', () => { _cropDragging = false; });
    canvas.addEventListener('mouseleave', () => { _cropDragging = false; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      _cropScale = Math.max(0.3, Math.min(5, _cropScale - e.deltaY * 0.001));
      const zoomEl = document.getElementById('stt-crop-zoom');
      if (zoomEl) zoomEl.value = Math.round(_cropScale * 100);
      _renderCropCanvas();
    }, { passive: false });
    // Touch
    let _lastTouchDist = null;
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        _cropDragging = true;
        _cropDragStart = { x: e.touches[0].clientX - _cropOffX, y: e.touches[0].clientY - _cropOffY };
      } else if (e.touches.length === 2) {
        _lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && _cropDragging) {
        _cropOffX = e.touches[0].clientX - _cropDragStart.x;
        _cropOffY = e.touches[0].clientY - _cropDragStart.y;
      } else if (e.touches.length === 2 && _lastTouchDist) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        _cropScale = Math.max(0.3, Math.min(5, _cropScale * (d / _lastTouchDist)));
        _lastTouchDist = d;
        const zoomEl = document.getElementById('stt-crop-zoom');
        if (zoomEl) zoomEl.value = Math.round(_cropScale * 100);
      }
      _renderCropCanvas();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { _cropDragging = false; _lastTouchDist = null; });
  }

  function _openAvatarPicker() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => _openCropModal(ev.target.result);
      reader.readAsDataURL(file);
    };
    inp.click();
  }

  function _openCropModal(dataUrl) {
    _cropOffX = 0; _cropOffY = 0; _cropScale = 1; _cropRot = 0;
    _cropImg = new Image();
    _cropImg.onload = () => {
      const s = 256;
      _cropScale = Math.min(s / _cropImg.naturalWidth, s / _cropImg.naturalHeight) * 0.9;
      _renderCropCanvas();
    };
    _cropImg.src = dataUrl;

    // Remove any stale overlay
    const prev = document.getElementById('mx-crop-overlay');
    if (prev) prev.remove();

    // Build dedicated overlay (not the generic modal) so the footer is always anchored
    const overlay = document.createElement('div');
    overlay.id = 'mx-crop-overlay';
    overlay.innerHTML = `
      <div class="mx-crop-sheet">
        <div class="mx-crop-header">
          <div class="mx-crop-handle"></div>
          <div class="mx-crop-title">Recadrer la photo</div>
          <div class="mx-crop-sub">Faites glisser · Molette pour zoomer · Boutons pour rotation</div>
        </div>
        <div class="mx-crop-body">
          <div class="stt-crop-wrap">
            <canvas id="stt-crop-canvas" width="256" height="256" class="stt-crop-canvas"></canvas>
            <div class="stt-crop-controls">
              <button class="stt-crop-rot" onclick="MX.Pages.Settings._cropRotate(-90)"><i class="fas fa-rotate-left"></i></button>
              <input type="range" id="stt-crop-zoom" min="30" max="500" value="100" class="stt-crop-slider"
                oninput="MX.Pages.Settings._cropZoom(this.value)">
              <button class="stt-crop-rot" onclick="MX.Pages.Settings._cropRotate(90)"><i class="fas fa-rotate-right"></i></button>
            </div>
          </div>
        </div>
        <div class="mx-crop-footer">
          <button id="mx-crop-cancel" class="modal-btn cancel" style="flex:1">Annuler</button>
          <button id="mx-crop-save"   class="modal-btn confirm" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px">
            <i class="fas fa-check"></i> Valider
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Bind canvas
    _cropCanvas = document.getElementById('stt-crop-canvas');
    _cropCtx   = _cropCanvas.getContext('2d');
    _bindCropEvents(_cropCanvas);
    if (_cropImg.complete) _renderCropCanvas();

    function _close() {
      const el = document.getElementById('mx-crop-overlay');
      if (el) el.remove();
    }

    document.getElementById('mx-crop-cancel').addEventListener('click', _close);
    // Tap backdrop to cancel
    overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });

    document.getElementById('mx-crop-save').addEventListener('click', async () => {
      const btn = document.getElementById('mx-crop-save');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Enregistrement…'; }
      const base64 = _cropCommit();
      _close();
      await _saveAvatar(base64);
    });
  }

  async function _saveAvatar(base64) {
    const cu = MX.state.currentUser;
    if (!cu) return;
    try {
      MX.syncStart && MX.syncStart();
      await MX.DB.updateUser(cu.id, { avatarUrl: base64 });
      // Update local state
      const u = (MX.state.users || []).find(u => u.id === cu.id);
      if (u) u.avatarUrl = base64;
      cu.avatarUrl = base64;
      localStorage.setItem('mx_user', JSON.stringify(cu));
      MX.syncEnd && MX.syncEnd();
      MX.toast('Photo de profil mise à jour avec succès ✓');
      _showSection(_section);
      MX.Auth.updateSidebarFooter && MX.Auth.updateSidebarFooter();
    } catch(err) {
      MX.syncFail && MX.syncFail();
      MX.toast('Erreur lors de la mise à jour', true);
    }
  }

  async function _removeAvatar() {
    const cu = MX.state.currentUser;
    if (!cu) return;
    try {
      MX.syncStart && MX.syncStart();
      await MX.DB.updateUser(cu.id, { avatarUrl: '' });
      const u = (MX.state.users || []).find(u => u.id === cu.id);
      if (u) u.avatarUrl = '';
      cu.avatarUrl = '';
      localStorage.setItem('mx_user', JSON.stringify(cu));
      MX.syncEnd && MX.syncEnd();
      MX.toast('Photo supprimée');
      _showSection(_section);
      MX.Auth.updateSidebarFooter && MX.Auth.updateSidebarFooter();
    } catch(err) {
      MX.syncFail && MX.syncFail();
      MX.toast('Erreur lors de la suppression', true);
    }
  }

  // ── PROFILE EDIT ──
  async function _saveProfile() {
    const cu = MX.state.currentUser;
    if (!cu) return;
    const nameEl  = document.getElementById('stt-name');
    const pseudoEl = document.getElementById('stt-pseudo');
    if (!nameEl) return;
    const name   = nameEl.value.trim();
    const pseudo = pseudoEl ? pseudoEl.value.trim() : '';
    if (!name) return MX.toast('Le nom ne peut pas être vide', true);
    try {
      MX.syncStart && MX.syncStart();
      await MX.DB.updateUser(cu.id, { name, pseudo });
      const u = (MX.state.users || []).find(u => u.id === cu.id);
      if (u) { u.name = name; u.pseudo = pseudo; }
      cu.name = name; cu.pseudo = pseudo;
      localStorage.setItem('mx_user', JSON.stringify(cu));
      MX.syncEnd && MX.syncEnd();
      MX.toast('Profil mis à jour');
      MX.Auth.updateSidebarFooter && MX.Auth.updateSidebarFooter();
    } catch(err) {
      MX.syncFail && MX.syncFail();
      MX.toast('Erreur lors de la mise à jour', true);
    }
  }

  // ── PIN CHANGE ──
  function _openChangePinModal() {
    const cu = MX.state.currentUser;
    if (!cu) return;
    MX.showModal({ title: 'Changer mon PIN', sub: 'Entrez votre PIN actuel puis le nouveau PIN', noAutoClose: true }, '', [
      { label: '<i class="fas fa-check"></i> Confirmer', cls: 'primary-btn', fn: _confirmChangePin },
      { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
    ]);
    setTimeout(() => {
      const body = document.getElementById('m-body');
      if (!body) return;
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <div class="form-group">
            <label>PIN actuel</label>
            <input type="password" id="stt-pin-cur" class="fi" placeholder="PIN actuel" maxlength="8" inputmode="numeric">
          </div>
          <div class="form-group">
            <label>Nouveau PIN</label>
            <input type="password" id="stt-pin-new" class="fi" placeholder="Nouveau PIN (4-8 chiffres)" maxlength="8" inputmode="numeric">
          </div>
          <div class="form-group">
            <label>Confirmer le nouveau PIN</label>
            <input type="password" id="stt-pin-conf" class="fi" placeholder="Confirmer le nouveau PIN" maxlength="8" inputmode="numeric">
          </div>
          <div id="stt-pin-err" style="color:var(--red);font-size:12px;display:none"></div>
        </div>`;
      document.getElementById('stt-pin-cur').focus();
    }, 60);
  }

  async function _confirmChangePin() {
    const cu = MX.state.currentUser;
    if (!cu) return;
    const curVal  = (document.getElementById('stt-pin-cur')?.value  || '').trim();
    const newVal  = (document.getElementById('stt-pin-new')?.value  || '').trim();
    const confVal = (document.getElementById('stt-pin-conf')?.value || '').trim();
    const errEl   = document.getElementById('stt-pin-err');
    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };

    const stored = cu.pin || '';
    const isHashed = stored.length === 64;
    const curHash = await MX.hashPin(curVal);
    const valid   = isHashed ? (curHash === stored) : (curVal === stored);
    if (!valid) { showErr('PIN actuel incorrect'); return; }
    if (newVal.length < 4) { showErr('Le nouveau PIN doit avoir au moins 4 chiffres'); return; }
    if (newVal !== confVal) { showErr('Les deux nouveaux PIN ne correspondent pas'); return; }

    const newHash = await MX.hashPin(newVal);
    try {
      MX.syncStart && MX.syncStart();
      await MX.DB.updateUser(cu.id, { pin: newHash });
      const u = (MX.state.users || []).find(u => u.id === cu.id);
      if (u) u.pin = newHash;
      cu.pin = newHash;
      localStorage.setItem('mx_user', JSON.stringify(cu));
      MX.syncEnd && MX.syncEnd();
      MX.closeModal();
      MX.toast('PIN modifié avec succès');
    } catch(err) {
      MX.syncFail && MX.syncFail();
      showErr('Erreur lors de la mise à jour');
    }
  }

  function _openAdminResetPinModal() {
    const users = (MX.state.users || []).filter(u => u.id);
    const opts = users.map(u => `<option value="${MX.esc(u.id)}">${MX.esc(u.name)}</option>`).join('');
    MX.showModal({ title: 'Réinitialiser un PIN', sub: 'Sélectionnez un utilisateur et définissez son nouveau PIN', noAutoClose: true }, '', [
      { label: '<i class="fas fa-check"></i> Réinitialiser', cls: 'primary-btn', fn: _confirmAdminResetPin },
      { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
    ]);
    setTimeout(() => {
      const body = document.getElementById('m-body');
      if (!body) return;
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <div class="form-group">
            <label>Utilisateur</label>
            <select id="stt-rpin-user" class="fi">${opts}</select>
          </div>
          <div class="form-group">
            <label>Nouveau PIN</label>
            <input type="password" id="stt-rpin-new" class="fi" placeholder="Nouveau PIN (4-8 chiffres)" maxlength="8" inputmode="numeric">
          </div>
          <div id="stt-rpin-err" style="color:var(--red);font-size:12px;display:none"></div>
        </div>`;
    }, 60);
  }

  async function _confirmAdminResetPin() {
    const uid    = document.getElementById('stt-rpin-user')?.value;
    const newVal = (document.getElementById('stt-rpin-new')?.value || '').trim();
    const errEl  = document.getElementById('stt-rpin-err');
    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
    if (!uid) { showErr('Sélectionnez un utilisateur'); return; }
    if (newVal.length < 4) { showErr('Le PIN doit avoir au moins 4 chiffres'); return; }
    const newHash = await MX.hashPin(newVal);
    try {
      MX.syncStart && MX.syncStart();
      await MX.DB.updateUser(uid, { pin: newHash });
      const u = (MX.state.users || []).find(u => u.id === uid);
      if (u) u.pin = newHash;
      MX.syncEnd && MX.syncEnd();
      MX.closeModal();
      MX.toast('PIN réinitialisé');
    } catch(err) {
      MX.syncFail && MX.syncFail();
      showErr('Erreur lors de la mise à jour');
    }
  }

  // ── AVATAR HTML HELPER ──
  function _avatarHtml(user, size) {
    size = size || 80;
    const avatarUrl = user?.avatarUrl || (MX.state.users || []).find(u => u.id === user?.id)?.avatarUrl;
    if (avatarUrl) {
      return `<img src="${avatarUrl}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block" alt="avatar">`;
    }
    const nc = MX.userColors ? MX.userColors(user?.name || '') : { bg: '#334155', fg: '#fff' };
    const bg = user?.color || nc.bg;
    const fg = user?.color ? (MX._contrastColor ? MX._contrastColor(bg) : '#fff') : nc.fg;
    const initials = (user?.name || '?').substring(0, 2).toUpperCase();
    const fs = Math.round(size * 0.35);
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:${fs}px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${MX.esc(initials)}</div>`;
  }

  // ── SECTION RENDERERS ──
  function _renderProfil() {
    const cu = MX.state.currentUser;
    if (!cu) return `<div class="stt-empty"><i class="fas fa-user-slash"></i><p>Connectez-vous pour accéder à votre profil.</p></div>`;
    const fullUser = (MX.state.users || []).find(u => u.id === cu.id) || cu;
    const lbl = cu.role === 'responsable' ? 'Responsable' : cu.role === 'admin' ? 'Administrateur' : 'Technicien';
    const nc = MX.userColors ? MX.userColors(cu.name) : { bg: '#334155', fg: '#fff' };
    const bg = cu.color || nc.bg;

    return `
      <div class="stt-section-head"><i class="fas fa-user-circle"></i> Mon profil</div>
      <div class="stt-card">
        <div class="stt-avatar-row">
          <div class="stt-avatar-wrap" id="stt-av-wrap">
            ${_avatarHtml(fullUser, 80)}
          </div>
          <div class="stt-avatar-info">
            <div style="font-size:17px;font-weight:700;line-height:1.2">${MX.esc(cu.name)}</div>
            <div style="font-size:12px;color:var(--text3);margin:2px 0 8px">${lbl}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="stt-btn-sm" onclick="MX.Pages.Settings._openAvatarPicker()">
                <i class="fas fa-camera"></i> Changer la photo
              </button>
              ${fullUser.avatarUrl ? `<button class="stt-btn-sm stt-btn-danger" onclick="MX.Pages.Settings._removeAvatar()"><i class="fas fa-trash"></i> Supprimer</button>` : ''}
            </div>
          </div>
        </div>
        <div class="stt-divider"></div>
        <div class="stt-field-group">
          <div class="form-group">
            <label>Nom complet</label>
            <input type="text" id="stt-name" class="fi" value="${MX.esc(cu.name)}" placeholder="Nom complet">
          </div>
          <div class="form-group">
            <label>Pseudo <span style="color:var(--text3);font-size:10px">(optionnel)</span></label>
            <input type="text" id="stt-pseudo" class="fi" value="${MX.esc(fullUser.pseudo || '')}" placeholder="Surnom affiché">
          </div>
          <div class="form-group">
            <label>Couleur personnelle</label>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:28px;height:28px;border-radius:6px;background:${bg};border:1px solid var(--border2);flex-shrink:0"></div>
              <span style="font-size:12px;color:var(--text3)">${bg}</span>
              <span style="font-size:11px;color:var(--text3);margin-left:auto">Modifiable depuis l'administration</span>
            </div>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="primary-btn" style="flex:1" onclick="MX.Pages.Settings._saveProfile()">
            <i class="fas fa-save"></i> Enregistrer les modifications
          </button>
        </div>
      </div>`;
  }

  function _renderSecurite() {
    const cu  = MX.state.currentUser;
    const adm = MX.state.adminUser;
    const isAdmin = MX.Auth.isAdmin && MX.Auth.isAdmin();

    let loginInfo = '';
    if (cu) {
      const lastLogin = cu.lastLogin ? new Date(cu.lastLogin).toLocaleString('fr-FR') : 'Inconnue';
      loginInfo = `<div class="stt-info-row"><span class="stt-info-label"><i class="fas fa-clock"></i> Dernière connexion</span><span class="stt-info-val">${lastLogin}</span></div>`;
    }

    return `
      <div class="stt-section-head"><i class="fas fa-shield-halved"></i> Sécurité</div>
      ${cu ? `
      <div class="stt-card">
        <div class="stt-card-title"><i class="fas fa-key"></i> Code PIN</div>
        <p style="font-size:12px;color:var(--text3);margin:0 0 12px">Votre PIN permet d'accéder rapidement à l'application. Il est stocké de manière sécurisée (SHA-256).</p>
        ${loginInfo}
        <button class="stt-btn" onclick="MX.Pages.Settings._openChangePinModal()">
          <i class="fas fa-key"></i> Changer mon PIN
        </button>
      </div>` : ''}
      ${isAdmin ? `
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title"><i class="fas fa-user-shield"></i> Administration</div>
        <p style="font-size:12px;color:var(--text3);margin:0 0 12px">Réinitialisez le PIN d'un utilisateur en cas d'oubli.</p>
        <button class="stt-btn" onclick="MX.Pages.Settings._openAdminResetPinModal()">
          <i class="fas fa-rotate-right"></i> Réinitialiser le PIN d'un utilisateur
        </button>
      </div>` : ''}
      ${!cu && !adm ? `<div class="stt-empty"><i class="fas fa-lock"></i><p>Connectez-vous pour accéder aux paramètres de sécurité.</p></div>` : ''}`;
  }

  function _renderNotifications() {
    const toggles = [
      { key: 'notif_tasks',     label: 'Tâches assignées',  icon: 'fa-list-check', def: true },
      { key: 'notif_messages',  label: 'Messages & annonces', icon: 'fa-comments', def: true },
      { key: 'notif_planning',  label: 'Modifications planning', icon: 'fa-calendar-days', def: true },
      { key: 'notif_stock',     label: 'Stock & commandes', icon: 'fa-box', def: false },
      { key: 'notif_suppliers', label: 'Fournisseurs', icon: 'fa-truck', def: false },
      { key: 'notif_rewards',   label: 'Récompenses & points', icon: 'fa-trophy', def: true },
      { key: 'notif_system',    label: 'Mises à jour système', icon: 'fa-rocket', def: false },
    ];
    const channel = _getPref('notif_channel', 'app');
    const notifPerm = ("Notification" in window) ? Notification.permission : 'unsupported';

    const rows = toggles.map(t => {
      const val = _getPref(t.key, t.def);
      return `<div class="stt-toggle-row">
        <span class="stt-toggle-icon"><i class="fas ${t.icon}"></i></span>
        <span class="stt-toggle-label">${t.label}</span>
        <label class="stt-switch">
          <input type="checkbox" ${val ? 'checked' : ''} onchange="MX.Pages.Settings._togglePref('${t.key}', this.checked)">
          <span class="stt-switch-track"></span>
        </label>
      </div>`;
    }).join('');

    const permBadge = notifPerm === 'granted'
      ? `<span class="stt-badge stt-badge-green"><i class="fas fa-check"></i> Autorisées</span>`
      : notifPerm === 'denied'
      ? `<span class="stt-badge stt-badge-red"><i class="fas fa-ban"></i> Bloquées</span>`
      : `<span class="stt-badge stt-badge-warn"><i class="fas fa-circle-question"></i> En attente</span>`;

    const sndPrefs = MX.Notifs && MX.Notifs.getSoundPrefs ? MX.Notifs.getSoundPrefs() : { enabled: true };
    const sndEnabled = sndPrefs.enabled !== false;

    const SND_TYPES = [
      { key: 'critical',  icon: 'fa-circle-exclamation',  label: 'Critique',  color: '#EF4444' },
      { key: 'important', icon: 'fa-triangle-exclamation', label: 'Important', color: '#F97316' },
      { key: 'warning',   icon: 'fa-bell',                 label: 'Attention', color: '#EAB308' },
      { key: 'info',      icon: 'fa-circle-info',          label: 'Info',      color: '#06B6D4' },
      { key: 'success',   icon: 'fa-circle-check',         label: 'Succès',    color: '#22C55E' },
    ];

    const sndRows = SND_TYPES.map(function(s) {
      const on = sndPrefs[s.key] !== false;
      return '<div class="stt-toggle-row">'
        + '<span class="stt-toggle-icon" style="color:' + s.color + '"><i class="fas ' + s.icon + '"></i></span>'
        + '<span class="stt-toggle-label">' + s.label + '</span>'
        + '<button class="stt-icon-btn" style="margin-right:8px;color:var(--text3)" onclick="MX.Pages.Settings._previewSound(\'' + s.key + '\')" title="Aperçu">'
        + '<i class="fas fa-play"></i></button>'
        + '<label class="stt-switch">'
        + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="MX.Pages.Settings._toggleSound(\'' + s.key + '\', this.checked)">'
        + '<span class="stt-switch-track"></span>'
        + '</label>'
        + '</div>';
    }).join('');

    return '<div class="stt-section-head"><i class="fas fa-bell"></i> Notifications</div>'
      + '<div class="stt-card">'
      + '<div class="stt-card-title">Statut navigateur ' + permBadge + '</div>'
      + (notifPerm !== 'granted'
        ? '<button class="stt-btn" style="margin-bottom:10px" onclick="MX.enableNotifications()">'
          + '<i class="fas fa-bell"></i> Activer les notifications push</button>'
        : '')
      + '</div>'
      + '<div class="stt-card" style="margin-top:12px">'
      + '<div class="stt-card-title">Catégories</div>'
      + '<div class="stt-toggle-list">' + rows + '</div>'
      + '</div>'
      + '<div class="stt-card" style="margin-top:12px">'
      + '<div class="stt-card-title">Sons</div>'
      + '<div class="stt-toggle-row">'
      + '<span class="stt-toggle-icon"><i class="fas fa-volume-high"></i></span>'
      + '<span class="stt-toggle-label">Sons activés</span>'
      + '<label class="stt-switch">'
      + '<input type="checkbox" ' + (sndEnabled ? 'checked' : '') + ' onchange="MX.Pages.Settings._toggleSound(\'enabled\', this.checked)">'
      + '<span class="stt-switch-track"></span>'
      + '</label>'
      + '</div>'
      + (sndEnabled ? '<div class="stt-toggle-list" style="margin-top:8px">' + sndRows + '</div>' : '')
      + '</div>'
      + '<div class="stt-card" style="margin-top:12px">'
      + '<div class="stt-card-title">Canal de réception</div>'
      + '<div class="stt-radio-group">'
      + ['app', 'email', 'both'].map(function(c) {
          const labels = { app: 'Application uniquement', email: 'Email uniquement', both: 'Application + Email' };
          const icons  = { app: 'fa-mobile-screen', email: 'fa-envelope', both: 'fa-layer-group' };
          return '<label class="stt-radio-opt ' + (channel === c ? 'active' : '') + '" onclick="MX.Pages.Settings._setChannel(\'' + c + '\')">'
            + '<i class="fas ' + icons[c] + '"></i>'
            + '<span>' + labels[c] + '</span>'
            + '<span class="stt-radio-dot ' + (channel === c ? 'on' : '') + '"></span>'
            + '</label>';
        }).join('')
      + '</div>'
      + '</div>';
  }

  function _toggleSound(key, val) {
    if (!(MX.Notifs && MX.Notifs.getSoundPrefs && MX.Notifs.saveSoundPrefs)) return;
    const p = MX.Notifs.getSoundPrefs();
    p[key] = val;
    MX.Notifs.saveSoundPrefs(p);
    _showSection('notifications');
  }

  function _previewSound(key) {
    if (MX.Notifs && MX.Notifs.playSound) MX.Notifs.playSound(key);
  }

  function _renderApparence() {
    const tm         = MX.ThemeManager;
    const curTheme   = tm ? tm.getTheme()   : _getPref('theme', 'dark');
    const curAccent  = tm ? tm.getAccent()  : _getPref('accent', 'cyan');
    const curSize    = tm ? tm.getSize()    : _getPref('text_size', 'normal');
    const curCompact = tm ? tm.getCompact() : _getPref('compact', false);
    const isLight    = curTheme === 'light';

    // Mini mockup sidebar+body HTML pour les aperçus thème
    function _themeMockup(t) {
      return t === 'dark'
        ? `<div class="stt-theme-preview-wrap">
            <div class="stt-tp-sidebar-dark">
              <div class="stt-tp-logo-dark"></div>
              <div class="stt-tp-nav-active-dark"></div>
              <div class="stt-tp-nav-dark"></div>
              <div class="stt-tp-nav-dark"></div>
            </div>
            <div class="stt-tp-body-dark">
              <div class="stt-tp-header-dark"></div>
              <div class="stt-tp-card-dark"></div>
              <div class="stt-tp-card-dark"></div>
              <div class="stt-tp-card-dark"></div>
            </div>
          </div>`
        : `<div class="stt-theme-preview-wrap">
            <div class="stt-tp-sidebar-light">
              <div class="stt-tp-logo-light"></div>
              <div class="stt-tp-nav-active-light"></div>
              <div class="stt-tp-nav-light"></div>
              <div class="stt-tp-nav-light"></div>
            </div>
            <div class="stt-tp-body-light">
              <div class="stt-tp-header-light"></div>
              <div class="stt-tp-card-light"></div>
              <div class="stt-tp-card-light"></div>
              <div class="stt-tp-card-light"></div>
            </div>
          </div>`;
    }

    // ── Cartes Thème ──
    const themeCards = [
      { v:'dark',  icon:'🌙', label:'Sombre' },
      { v:'light', icon:'☀️', label:'Clair'  },
    ].map(({ v, icon, label }) => {
      const active = curTheme === v;
      return `<button class="app-sel-card app-theme-card ${active ? 'active' : ''}"
          onclick="MX.Pages.Settings._setTheme('${v}')">
        <div class="app-check"><i class="fas fa-check"></i></div>
        ${_themeMockup(v)}
        <div class="app-theme-footer">
          <span class="app-theme-icon">${icon}</span>
          <span class="app-clabel">${label}</span>
        </div>
      </button>`;
    }).join('');

    // ── Cartes Couleur ──
    const accentSwatches = {
      cyan:   isLight ? '#00897B' : '#00F5D4',
      blue:   isLight ? '#2563EB' : '#60A5FA',
      violet: isLight ? '#7C3AED' : '#A78BFA',
      pink:   isLight ? '#DB2777' : '#F472B6',
      orange: isLight ? '#EA580C' : '#FB923C',
      green:  isLight ? '#16A34A' : '#4ADE80',
    };
    const accentNames = {
      cyan:'Cyan', blue:'Bleu', violet:'Violet',
      pink:'Rose', orange:'Orange', green:'Vert',
    };
    const accentCards = Object.keys(accentSwatches).map(a => {
      const active = curAccent === a;
      return `<button class="app-sel-card app-accent-card ${active ? 'active' : ''}"
          onclick="MX.Pages.Settings._setAccent('${a}')">
        <div class="app-check"><i class="fas fa-check"></i></div>
        <div class="app-accent-swatch" style="background:${accentSwatches[a]}"></div>
        <span class="app-clabel">${accentNames[a]}</span>
      </button>`;
    }).join('');

    // ── Cartes Taille ──
    const sizeCards = [
      { v:'small',  label:'Petite',  fs:'18px' },
      { v:'normal', label:'Normale', fs:'26px' },
      { v:'large',  label:'Grande',  fs:'33px' },
    ].map(s => `<button class="app-sel-card app-size-card ${curSize === s.v ? 'active' : ''}"
        onclick="MX.Pages.Settings._setTextSize('${s.v}')">
      <div class="app-check"><i class="fas fa-check"></i></div>
      <span class="app-size-sample" style="font-size:${s.fs}">Aa</span>
      <span class="app-size-sub">${s.label}</span>
    </button>`).join('');

    // ── Cartes Affichage ──
    const displayCards = [
      { v:false, label:'Confortable', cls:'comfortable', rows:3 },
      { v:true,  label:'Compact',     cls:'compact',     rows:5 },
    ].map(d => {
      const active = curCompact === d.v;
      const rows   = Array(d.rows).fill('<div class="app-dp-row"></div>').join('');
      return `<button class="app-sel-card app-display-card ${d.cls} ${active ? 'active' : ''}"
          onclick="MX.Pages.Settings._setCompactMode(${d.v})">
        <div class="app-check"><i class="fas fa-check"></i></div>
        <div class="app-display-mockup">${rows}</div>
        <div class="app-display-footer">
          <span class="app-clabel">${d.label}</span>
        </div>
      </button>`;
    }).join('');

    return `
      <div class="stt-section-head"><i class="fas fa-palette"></i> Apparence</div>

      <div class="stt-card">
        <div class="stt-card-title">Thème de l'application</div>
        <div class="app-theme-grid">${themeCards}</div>
      </div>

      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Couleur principale</div>
        <div class="app-accent-grid">${accentCards}</div>
      </div>

      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Taille du texte</div>
        <div class="app-size-grid">${sizeCards}</div>
      </div>

      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Affichage</div>
        <div class="app-display-grid">${displayCards}</div>
      </div>`;
  }

  function _renderPlanning() {
    const defView    = _getPref('plan_default_view', 'month');
    const showWe     = _getPref('plan_show_we', true);
    const showMine   = _getPref('plan_show_mine', false);
    const showConges = _getPref('plan_show_conges', true);

    return `
      <div class="stt-section-head"><i class="fas fa-calendar-days"></i> Préférences Planning</div>
      <div class="stt-card">
        <div class="stt-card-title">Vue par défaut</div>
        <div class="stt-radio-group">
          ${['day', 'week', 'month'].map(v => {
            const labels = { day: 'Jour', week: 'Semaine', month: 'Mois' };
            const icons  = { day: 'fa-calendar-day', week: 'fa-calendar-week', month: 'fa-calendar' };
            return `<label class="stt-radio-opt ${defView === v ? 'active' : ''}" onclick="MX.Pages.Settings._setPlanView('${v}')">
              <i class="fas ${icons[v]}"></i>
              <span>${labels[v]}</span>
              <span class="stt-radio-dot ${defView === v ? 'on' : ''}"></span>
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Options d'affichage</div>
        <div class="stt-toggle-list">
          ${[
            { key: 'plan_show_we',     val: showWe,     label: 'Afficher les week-ends',    icon: 'fa-umbrella-beach' },
            { key: 'plan_show_mine',   val: showMine,   label: 'Afficher uniquement mes horaires', icon: 'fa-user' },
            { key: 'plan_show_conges', val: showConges, label: 'Afficher les congés',        icon: 'fa-plane-departure' },
          ].map(t => `<div class="stt-toggle-row">
            <span class="stt-toggle-icon"><i class="fas ${t.icon}"></i></span>
            <span class="stt-toggle-label">${t.label}</span>
            <label class="stt-switch">
              <input type="checkbox" ${t.val ? 'checked' : ''} onchange="MX.Pages.Settings._togglePref('${t.key}', this.checked)">
              <span class="stt-switch-track"></span>
            </label>
          </div>`).join('')}
        </div>
      </div>`;
  }

  function _renderApplication() {
    const lang     = _getPref('lang', 'fr');
    const dateFmt  = _getPref('date_fmt', 'dd/mm/yyyy');
    const timeFmt  = _getPref('time_fmt', '24h');

    return `
      <div class="stt-section-head"><i class="fas fa-sliders"></i> Application</div>
      <div class="stt-card">
        <div class="stt-card-title">Langue</div>
        <div class="stt-radio-group">
          ${[['fr', '🇫🇷 Français'], ['en', '🇬🇧 English']].map(([v, l]) => `
            <label class="stt-radio-opt ${lang === v ? 'active' : ''}" onclick="MX.Pages.Settings._setPref('lang','${v}')">
              <span>${l}</span>
              <span class="stt-radio-dot ${lang === v ? 'on' : ''}"></span>
            </label>`).join('')}
        </div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Format de date</div>
        <div class="stt-radio-group">
          ${[['dd/mm/yyyy', 'JJ/MM/AAAA'], ['mm/dd/yyyy', 'MM/JJ/AAAA'], ['yyyy-mm-dd', 'AAAA-MM-JJ']].map(([v, l]) => `
            <label class="stt-radio-opt ${dateFmt === v ? 'active' : ''}" onclick="MX.Pages.Settings._setPref('date_fmt','${v}')">
              <span>${l}</span>
              <span class="stt-radio-dot ${dateFmt === v ? 'on' : ''}"></span>
            </label>`).join('')}
        </div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Format d'heure</div>
        <div class="stt-radio-group">
          ${[['24h', '24h (14:30)'], ['12h', '12h (2:30 PM)']].map(([v, l]) => `
            <label class="stt-radio-opt ${timeFmt === v ? 'active' : ''}" onclick="MX.Pages.Settings._setPref('time_fmt','${v}')">
              <span>${l}</span>
              <span class="stt-radio-dot ${timeFmt === v ? 'on' : ''}"></span>
            </label>`).join('')}
        </div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Cache & données</div>
        <button class="stt-btn" onclick="MX.Pages.Settings._clearCache()">
          <i class="fas fa-trash-can"></i> Vider le cache de l'application
        </button>
      </div>`;
  }

  function _renderPermissions() {
    if (!MX.Auth.isAdmin || !MX.Auth.isAdmin()) {
      return `<div class="stt-empty"><i class="fas fa-lock"></i><p>Section réservée aux administrateurs.</p></div>`;
    }
    const users = MX.state.users || [];
    const ROLES = { admin: 'Administrateur', responsable: 'Responsable', technicien: 'Technicien' };
    const ROLE_COLORS = { admin: 'var(--red)', responsable: 'var(--cyan)', technicien: 'var(--green)' };

    return `
      <div class="stt-section-head"><i class="fas fa-lock"></i> Permissions & Rôles</div>
      <div class="stt-card">
        <div class="stt-card-title">Rôles des utilisateurs</div>
        <div class="stt-user-list">
          ${users.map(u => {
            const role = u.role || 'technicien';
            const nc   = MX.userColors ? MX.userColors(u.name) : { bg: '#334155', fg: '#fff' };
            const bg   = u.color || nc.bg;
            const fg   = u.color ? (MX._contrastColor ? MX._contrastColor(bg) : '#fff') : nc.fg;
            return `<div class="stt-user-row">
              <div style="width:32px;height:32px;border-radius:8px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${MX.esc(u.name.substring(0,2).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600">${MX.esc(u.name)}</div>
                <div style="font-size:11px;color:var(--text3)">${MX.esc(u.email || '')}</div>
              </div>
              <span class="stt-role-badge" style="color:${ROLE_COLORS[role]||'var(--text3)'}">
                ${ROLES[role] || role}
              </span>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:12px">
          <button class="stt-btn" onclick="MX.showPage('utilisateurs')">
            <i class="fas fa-arrow-right"></i> Gérer les utilisateurs
          </button>
        </div>
      </div>`;
  }

  function _renderJournal() {
    const cu = MX.state.currentUser;
    const logs = (MX.state.logs || [])
      .filter(l => !cu || l.user === cu.name)
      .slice(0, 50);

    return `
      <div class="stt-section-head"><i class="fas fa-clock-rotate-left"></i> Journal d'activité</div>
      <div class="stt-card">
        ${logs.length === 0
          ? `<div style="text-align:center;padding:24px;color:var(--text3)"><i class="fas fa-scroll" style="font-size:32px;opacity:0.3;margin-bottom:8px;display:block"></i>Aucune activité enregistrée</div>`
          : `<div class="stt-log-list">
              ${logs.map(l => {
                const d = l.ts ? new Date(l.ts.seconds ? l.ts.seconds * 1000 : l.ts).toLocaleString('fr-FR') : '';
                return `<div class="stt-log-row">
                  <span class="stt-log-icon"><i class="fas fa-circle-dot"></i></span>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:500">${MX.esc(l.action || l.type || 'Activité')}</div>
                    <div style="font-size:10px;color:var(--text3)">${MX.esc(l.user || '')} · ${d}</div>
                  </div>
                </div>`;
              }).join('')}
            </div>`
        }
      </div>`;
  }

  function _renderApropos() {
    const ver   = (window.MX && MX.appVer) ? MX.appVer : (window.MX_VERSION || '1.0.34');
    const build = window.MX_BUILD || 134;
    const isOnline  = navigator.onLine;
    const users     = MX.state.users || [];
    const lastSync  = MX.state._lastSync ? new Date(MX.state._lastSync).toLocaleString('fr-FR') : 'Maintenant';
    const lastVer   = localStorage.getItem('mx_last_ver');
    const isUpToDate = lastVer === ver;

    const statusBadge = isOnline
      ? '<span style="color:var(--green);font-size:11px;font-weight:700"><i class="fas fa-circle" style="font-size:7px"></i> Application à jour</span>'
      : '<span style="color:var(--orange);font-size:11px;font-weight:700"><i class="fas fa-circle" style="font-size:7px"></i> Hors ligne</span>';

    return `
      <div class="stt-section-head"><i class="fas fa-circle-info"></i> À propos</div>
      <div class="stt-card">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <img src="/assets/icons/maintix-logo.png" style="width:52px;height:52px;object-fit:contain;border-radius:12px" alt="Maintix">
          <div>
            <div style="font-size:18px;font-weight:800;letter-spacing:-0.5px">Maintix</div>
            <div style="font-size:12px;color:var(--text3)">Gestion de maintenance industrielle</div>
            <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span class="stt-badge stt-badge-green" style="cursor:pointer;user-select:none" onclick="MX.Pages.Settings._diagVersionTap()" title="Appuyez 5× pour ouvrir le diagnostic">v${ver}</span>
              <span class="stt-badge" style="background:var(--bg3);color:var(--text3);border-color:var(--border1)">Build ${build}</span>
            </div>
            <div style="margin-top:6px">${statusBadge}</div>
          </div>
        </div>
        <div class="stt-info-list">
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-server"></i> État du serveur</span>
            <span class="stt-info-val" style="color:${isOnline ? 'var(--green)' : 'var(--red)'}">
              <i class="fas fa-circle" style="font-size:8px"></i> ${isOnline ? 'Opérationnel' : 'Hors ligne'}
            </span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-users"></i> Utilisateurs</span>
            <span class="stt-info-val">${users.length} enregistré${users.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-rotate"></i> Dernière sync.</span>
            <span class="stt-info-val">${lastSync}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-database"></i> Base de données</span>
            <span class="stt-info-val">Firebase Firestore</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-shield"></i> Réseau</span>
            <span class="stt-info-val">Fermé (Intranet)</span>
          </div>
        </div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">PWA</div>
        <div class="stt-info-list">
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-mobile-screen"></i> Mode d'affichage</span>
            <span class="stt-info-val">${window.matchMedia('(display-mode: standalone)').matches ? 'Application installée' : 'Navigateur'}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-bell"></i> Notifications</span>
            <span class="stt-info-val">${("Notification" in window) ? Notification.permission : 'Non supportées'}</span>
          </div>
        </div>
        ${MX._canInstall ? `
        <button class="stt-btn" style="margin-top:10px" onclick="MX.tryInstall()">
          <i class="fas fa-download"></i> Installer l'application
        </button>` : ''}
      </div>`;
  }

  // ── NOUVEAUTÉS ──
  function _renderNouveautes() {
    if (window.MX && MX.Updates) MX.Updates.markSeen();
    const cl = (window.MX && MX.CHANGELOG) ? MX.CHANGELOG : [];
    const ver = (window.MX && MX.appVer) ? MX.appVer : '1.0.31';

    const entriesHtml = cl.map((e, i) => `
      <div class="vcl-hist-entry${i === 0 ? ' vcl-hist-entry-latest' : ''}">
        <div class="vcl-hist-head">
          <span class="vcl-hist-ver">${e.emoji || '📦'} v${MX.esc(e.ver)}</span>
          <span class="vcl-hist-date">${MX.esc(e.date || '')}</span>
          ${i === 0 ? '<span class="stt-badge stt-badge-green" style="margin-left:6px">Actuelle</span>' : ''}
        </div>
        ${e.title ? `<div class="vcl-hist-title">${MX.esc(e.title)}</div>` : ''}
        <ul class="vcl-changes-list">
          ${(e.changes || []).map(c => `<li class="vcl-change-item"><i class="fas fa-check" style="color:var(--cyan);font-size:10px;margin-right:8px"></i>${MX.esc(c)}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    return `
      <div class="stt-section-head"><i class="fas fa-rocket"></i> Nouveautés Maintix</div>
      <div class="stt-card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="width:44px;height:44px;border-radius:12px;background:var(--cyan-dim);border:1px solid var(--cyan-border);display:flex;align-items:center;justify-content:center;color:var(--cyan);font-size:18px;flex-shrink:0">
            <i class="fas fa-rocket"></i>
          </div>
          <div>
            <div style="font-size:15px;font-weight:700">Version actuelle : v${MX.esc(ver)}</div>
            <div style="font-size:12px;color:var(--text3);margin-top:2px">Historique complet des mises à jour</div>
          </div>
        </div>
        ${entriesHtml || '<div style="color:var(--text3);font-size:13px;padding:8px 0">Aucune information disponible</div>'}
      </div>`;
  }

  // ── INFORMATIONS PWA ──
  function _renderInformations() {
    const st = (window.MX && MX.UpdateManager) ? MX.UpdateManager.getStatus() : {};
    const ver   = st.localVersion || (window.MX_VERSION || '—');
    const build = st.localBuild   || (window.MX_BUILD   || '—');
    const swCtrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    const swStateLabel = swCtrl ? 'Actif' : 'Inactif';
    const swStateColor = swCtrl ? 'var(--green)' : 'var(--text3)';
    const lastUpdateRaw = st.lastUpdate;
    const lastUpdate = lastUpdateRaw
      ? new Date(parseInt(lastUpdateRaw, 10)).toLocaleString('fr-FR')
      : '—';
    const lastCheckRaw = st.lastCheck;
    const lastCheck = lastCheckRaw
      ? new Date(parseInt(lastCheckRaw, 10)).toLocaleTimeString('fr-FR')
      : '—';
    const serverVerDisplay = st.serverVersion
      ? 'v' + MX.esc(String(st.serverVersion)) + ' (build ' + st.serverBuild + ')'
      : (navigator.onLine ? 'Vérification…' : 'Hors ligne');
    const serverBadge = (st.serverBuild > 0 && st.serverBuild > st.localBuild)
      ? ' <span class="pwa-new-badge">Nouvelle version</span>' : '';
    const statusHtml = st.serverBuild > 0
      ? (st.upToDate
          ? '<i class="fas fa-check-circle" style="color:var(--green)"></i> <span style="color:var(--green);font-weight:600">À jour</span>'
          : '<i class="fas fa-triangle-exclamation" style="color:var(--orange)"></i> <span style="color:var(--orange);font-weight:600">Mise à jour disponible</span>')
      : '—';
    const cacheName = 'maintix-' + (window.MX_VERSION || '?');
    const waitingRow = st.hasWaiting
      ? `<div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-hourglass-half"></i> En attente</span>
            <span class="stt-info-val" style="color:var(--orange)">SW en attente d'activation</span>
          </div>` : '';

    return `
      <div class="stt-section-head"><i class="fas fa-shield-halved"></i> Informations système</div>
      <div class="stt-card">
        <div class="stt-card-title">Version application</div>
        <div class="stt-info-list">
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-tag"></i> Version locale</span>
            <span class="stt-info-val" style="color:var(--cyan);font-weight:700">v${MX.esc(String(ver))} (build ${MX.esc(String(build))})</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-cloud"></i> Version serveur</span>
            <span class="stt-info-val" id="pwa-server-ver" style="font-size:12px">${serverVerDisplay}${serverBadge}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-circle-check"></i> État</span>
            <span class="stt-info-val" id="pwa-upd-status">${statusHtml}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-rotate"></i> Dernière vérification</span>
            <span class="stt-info-val" id="pwa-last-check">${lastCheck}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-clock-rotate-left"></i> Dernière mise à jour</span>
            <span class="stt-info-val">${lastUpdate}</span>
          </div>
        </div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Service Worker</div>
        <div class="stt-info-list">
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-circle-dot"></i> État</span>
            <span class="stt-info-val" style="color:${swStateColor}">${swStateLabel}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-code-branch"></i> Version SW</span>
            <span class="stt-info-val">v${MX.esc(String(ver))}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-hard-drive"></i> Nom du cache</span>
            <span class="stt-info-val">${MX.esc(cacheName)}</span>
          </div>
          ${waitingRow}
        </div>
        <button class="stt-btn" style="margin-top:12px" onclick="if(window.MX&&MX.UpdateManager)MX.UpdateManager.checkVersion();MX.Pages.Settings._refreshInfos()">
          <i class="fas fa-rotate"></i> Actualiser
        </button>
        <button class="stt-btn" style="margin-top:8px;background:var(--red-dim);color:var(--red);border-color:var(--red)" onclick="MX.Pages.Settings._confirmForceUpdate()">
          <i class="fas fa-fire"></i> Forcer la mise à jour
        </button>
      </div>`;
  }

  function _confirmForceUpdate() {
    MX.showModal(
      'Forcer la mise à jour',
      'Ceci va vider tous les caches, désinscrire le service worker et recharger l\'application. L\'opération peut prendre quelques secondes.',
      [
        { label: 'Forcer', cls: 'danger', cb: function() { if (window.MX && MX.UpdateManager) MX.UpdateManager.forceUpdate(); else window.location.reload(true); } },
        { label: 'Annuler', cls: 'cancel' }
      ]
    );
  }

  // ── DIAGNOSTIC PANEL ──
  let _diagTaps = 0, _diagTimer = null;

  function _diagVersionTap() {
    _diagTaps++;
    clearTimeout(_diagTimer);
    _diagTimer = setTimeout(() => { _diagTaps = 0; }, 2000);
    if (_diagTaps >= 5) {
      _diagTaps = 0;
      _showSection('diagnostic');
    }
  }

  function _renderDiagnostic() {
    const cu = MX.state.currentUser || MX.state.adminUser;
    const userName = cu ? (cu.name || cu.email || '—') : 'Invité';
    const isOnline = navigator.onLine;
    const lastSync = MX.state._lastSync ? new Date(MX.state._lastSync).toLocaleTimeString('fr-FR') : '—';

    // Count active onSnapshot listeners (tracked in DB if available)
    let listenerCount = '—';
    if (window.MX && MX.DB && MX.DB._listenerCount !== undefined) {
      listenerCount = MX.DB._listenerCount;
    } else if (window.MX && MX._snapshotCount !== undefined) {
      listenerCount = MX._snapshotCount;
    }

    const reads  = (window.MX && MX._dbReads)  || 0;
    const writes = (window.MX && MX._dbWrites) || 0;
    const avgSync = (window.MX && MX._avgSyncMs) ? MX._avgSyncMs.toFixed(0) + ' ms' : '—';

    const firestoreState = isOnline ? 'Connecté' : 'Hors ligne';
    const ua = navigator.userAgent;
    const isMob = /Mobi|Android/i.test(ua) ? 'Mobile' : 'Desktop';
    const appVer   = (window.MX && MX.appVer)  || (window.MX_VERSION || '—');
    const buildNum = window.MX_BUILD || '—';

    // Cache SW actif (async — affiché après rendu via micro-update)
    let swCache = '…';
    caches.keys().then(keys => {
      const found = keys.find(k => k.startsWith('maintix-')) || '—';
      const el = document.getElementById('diag-sw-cache');
      if (el) el.textContent = found;
    }).catch(() => {});
    const swScriptUrl = (navigator.serviceWorker && navigator.serviceWorker.controller)
      ? navigator.serviceWorker.controller.scriptURL.replace(location.origin, '') : '—';

    return `
      <div class="stt-section-head"><i class="fas fa-bug"></i> Diagnostic développeur <span class="stt-badge stt-badge-green" style="margin-left:8px;font-size:10px">DEV</span></div>
      <div class="stt-card" style="font-family:var(--ffm);font-size:12px">
        <div class="stt-info-list">
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-rocket"></i> Version application</span>
            <span class="stt-info-val" style="color:var(--cyan);font-weight:700">v${MX.esc(appVer)} (build ${MX.esc(String(buildNum))})</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-gear"></i> Cache Service Worker</span>
            <span class="stt-info-val" id="diag-sw-cache">${MX.esc(swCache)}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-file-code"></i> Script SW</span>
            <span class="stt-info-val">${MX.esc(swScriptUrl)}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-user"></i> Utilisateur connecté</span>
            <span class="stt-info-val">${MX.esc(userName)}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-database"></i> État Firestore</span>
            <span class="stt-info-val" style="color:${isOnline ? 'var(--green)' : 'var(--red)'}">
              <i class="fas fa-circle" style="font-size:8px"></i> ${firestoreState}
            </span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-rotate"></i> Dernière synchronisation</span>
            <span class="stt-info-val">${lastSync}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-stopwatch"></i> Temps de sync moyen</span>
            <span class="stt-info-val">${avgSync}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-tower-broadcast"></i> Listeners actifs</span>
            <span class="stt-info-val">${listenerCount}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-arrow-down"></i> Lectures Firestore</span>
            <span class="stt-info-val">${reads}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-arrow-up"></i> Écritures Firestore</span>
            <span class="stt-info-val">${writes}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-mobile-screen"></i> Type d'appareil</span>
            <span class="stt-info-val">${isMob}</span>
          </div>
          <div class="stt-info-row">
            <span class="stt-info-label"><i class="fas fa-wifi"></i> Connexion</span>
            <span class="stt-info-val">${(navigator.connection && navigator.connection.effectiveType) || '—'}</span>
          </div>
        </div>
        <button class="stt-btn" style="margin-top:12px" onclick="MX.Pages.Settings._refreshDiag()">
          <i class="fas fa-refresh"></i> Actualiser
        </button>
        <button class="stt-btn" style="margin-top:8px;background:var(--red-dim);color:var(--red);border-color:var(--red)" onclick="if(confirm('Réinitialiser les compteurs ?')){if(window.MX){MX._dbReads=0;MX._dbWrites=0;}MX.Pages.Settings._refreshDiag();}">
          <i class="fas fa-trash"></i> Réinitialiser les compteurs
        </button>
      </div>`;
  }

  // ── MAINTENANCE ADMIN ──
  var _maintData = null;
  var _maintUnsub = null;
  var _deployLog = [];


  // ── PERFORMANCE ÉNERGIE — Paramètres des seuils ──
  function _renderEnergie() {
    const isAdmin = MX.Auth.canSeeAll();
    if (!isAdmin) return '<div class="stt-card"><p>Accès réservé à l\'administrateur.</p></div>';

    const db = firebase.firestore();
    const DEFAULTS = {
      thresholds: {
        eau_froide:  { excellent: 120, bon: 145, correct: 170, moyen: 190, mauvais: 220 },
        eau_chaude:  { excellent:  45, bon:  60, correct:  75, moyen:  90, mauvais: 110 },
        electricite: { excellent:   3, bon:   4, correct:   5, moyen:   6, mauvais:   7 },
        gaz:         { excellent:   2, bon:   3, correct:   4, moyen:   5, mauvais:   6 },
      },
      classes: {
        excellent: { l: 'Excellent', color: '#22c55e', scoreCenter: 95 },
        bon:       { l: 'Bon',       color: '#86efac', scoreCenter: 82 },
        correct:   { l: 'Correct',   color: '#fbbf24', scoreCenter: 67 },
        moyen:     { l: 'Moyen',     color: '#f97316', scoreCenter: 52 },
        mauvais:   { l: 'Mauvais',   color: '#ef4444', scoreCenter: 37 },
        critique:  { l: 'Critique',  color: '#991b1b', scoreCenter: 15 },
      },
    };
    const CLASS_ORDER = ['excellent','bon','correct','moyen','mauvais','critique'];
    const TYPE_META = {
      eau_froide:  { label: 'Eau froide',  unit: 'L/client', icon: '💧' },
      eau_chaude:  { label: 'Eau chaude',  unit: 'L/client', icon: '🔥' },
      electricite: { label: 'Électricité', unit: 'kWh/client', icon: '⚡' },
      gaz:         { label: 'Gaz',         unit: 'kWh/client', icon: '🌬' },
    };

    const OBJ_TYPES = ['eau_froide', 'eau_chaude', 'electricite'];

    // Threshold type sections
    const typeHtml = Object.entries(TYPE_META).map(function(_entry) {
      var type = _entry[0], meta = _entry[1];
      var label = meta.label, unit = meta.unit, icon = meta.icon;
      const def = DEFAULTS.thresholds[type] || {};
      return '<div class="stt-card pe-stt-card" id="pe-thr-' + type + '">' +
        '<div class="stt-section-head">' + icon + ' ' + label + ' <span class="pe-unit-lbl">' + unit + '</span></div>' +
        '<div class="pe-thr-grid">' +
        CLASS_ORDER.filter(function(k){return k!=='critique';}).map(function(k) {
          return '<div class="pe-thr-row">' +
            '<label class="pe-thr-lbl" id="lbl-' + type + '-' + k + '">' + (k.charAt(0).toUpperCase()+k.slice(1)) + '</label>' +
            '<span class="pe-thr-op">≤</span>' +
            '<input class="pe-thr-inp fi" id="pe-inp-' + type + '-' + k + '" type="number" min="0" step="0.5"' +
              ' value="' + (def[k] || '') + '" placeholder="' + (def[k] || '') + '">' +
            '<span class="pe-thr-unit">' + unit + '</span>' +
            '</div>';
        }).join('') +
        '<div class="pe-thr-row pe-thr-row--critique">' +
          '<label class="pe-thr-lbl">Critique</label>' +
          '<span class="pe-thr-op">&gt; seuil Mauvais</span>' +
        '</div>' +
        '</div></div>';
    }).join('');

    // Class colors & score
    const classHtml = '<div class="stt-card pe-stt-card">' +
      '<div class="stt-section-head">🎨 Couleurs &amp; scores des classes</div>' +
      '<div class="pe-cls-grid">' +
      CLASS_ORDER.map(function(k) {
        const def = DEFAULTS.classes[k];
        return '<div class="pe-cls-row">' +
          '<input class="pe-cls-color" id="pe-col-' + k + '" type="color" value="' + def.color + '">' +
          '<span class="pe-cls-name">' + def.l + '</span>' +
          '<label class="pe-cls-sc-lbl">Score centre</label>' +
          '<input class="pe-cls-score fi" id="pe-sc-' + k + '" type="number" min="0" max="100" value="' + def.scoreCenter + '" style="width:64px">' +
          '</div>';
      }).join('') +
      '</div></div>';

    // Compteurs de reference (populated async)
    const refMetersHtml = '<div class="stt-card pe-stt-card" id="pe-ref-meters-card">' +
      '<div class="stt-section-head"><i class="fas fa-crosshairs"></i> Compteurs de référence</div>' +
      '<div class="pe-ref-intro">Sélectionnez les compteurs inclus dans le calcul des ratios officiels. Si tous sont cochés (défaut), tous les compteurs du type sont utilisés.</div>' +
      '<div id="pe-ref-meters-content" class="pe-ref-loading"><i class="fas fa-spinner fa-spin"></i> Chargement…</div>' +
      '</div>';

    // Objectifs energetiques
    const objHtml = '<div class="stt-card pe-stt-card">' +
      '<div class="stt-section-head"><i class="fas fa-bullseye"></i> Objectifs énergétiques annuels</div>' +
      '<div class="pe-ref-intro">Définissez un objectif de ratio par client et une tolérance (%). Au-delà de la tolérance, l\'objectif est considéré dépassé.</div>' +
      '<div class="pe-obj-stt-grid">' +
      OBJ_TYPES.map(function(ot) {
        const mt = TYPE_META[ot] || {};
        return '<div class="pe-obj-stt-row">' +
          '<span class="pe-obj-stt-lbl">' + (mt.icon||'') + ' ' + (mt.label||ot) + '</span>' +
          '<label class="pe-obj-stt-field">Objectif' +
            '<input class="pe-obj-stt-inp fi" id="pe-obj-' + ot + '" type="number" min="0" step="0.5" placeholder="—">' +
            '<span class="pe-obj-stt-unit">' + (mt.unit||'') + '</span>' +
          '</label>' +
          '<label class="pe-obj-stt-field">Tolérance' +
            '<input class="pe-obj-stt-inp fi" id="pe-tol-' + ot + '" type="number" min="0" max="100" step="1" value="10" placeholder="10">' +
            '<span class="pe-obj-stt-unit">%</span>' +
          '</label>' +
          '</div>';
      }).join('') +
      '</div></div>';

    // Alertes configurables
    const alertRuleTypeLbl = { total: 'Total (m³)', ratio: 'Ratio (L/client)', variation: 'Variation (%)' };
    const alertResourceLbl = { eau_froide: '💧 Eau froide', eau_chaude: '🔥 Eau chaude', electricite: '⚡ Électricité' };
    const alertHtml = '<div class="stt-card pe-stt-card">' +
      '<div class="stt-section-head"><i class="fas fa-bell"></i> Règles d\'alertes</div>' +
      '<div class="pe-ref-intro">Définissez les seuils qui déclenchent une alerte. Les alertes apparaissent dans l\'historique 14 jours et le détail de chaque journée.</div>' +
      '<div id="pe-alert-rules-list" class="pe-alert-rules-list"><div class="pe-ref-loading"><i class="fas fa-spinner fa-spin"></i> Chargement…</div></div>' +
      '<div class="pe-alert-add-form">' +
        '<select class="fi pe-alert-sel" id="pe-alert-type">' +
          '<option value="total">Total &gt;</option>' +
          '<option value="ratio">Ratio &gt;</option>' +
          '<option value="variation">Variation &gt;</option>' +
        '</select>' +
        '<select class="fi pe-alert-sel" id="pe-alert-resource">' +
          '<option value="eau_froide">💧 Eau froide</option>' +
          '<option value="eau_chaude">🔥 Eau chaude</option>' +
          '<option value="electricite">⚡ Électricité</option>' +
        '</select>' +
        '<input class="fi pe-alert-val" id="pe-alert-value" type="number" min="0" step="0.1" placeholder="Valeur seuil">' +
        '<button class="cso-ibtn pe-alert-add-btn" onclick="window._sttAddAlertRule()"><i class="fas fa-plus"></i> Ajouter</button>' +
      '</div>' +
      '</div>';

    const saveBtn = '<div class="pe-stt-actions">' +
      '<button class="primary-btn" onclick="window._sttSaveEnergie()">' +
        '<i class="fas fa-save"></i> Sauvegarder' +
      '</button>' +
      '<button class="cso-ibtn" onclick="window._sttResetEnergie()">' +
        '<i class="fas fa-rotate-left"></i> Rétablir les valeurs par défaut' +
      '</button>' +
    '</div>';

    // In-memory alert rules for this settings session
    window._sttAlertRules = [];

    window._sttRenderAlertRules = function() {
      const el = document.getElementById('pe-alert-rules-list');
      if (!el) return;
      const rules = window._sttAlertRules;
      if (!rules.length) {
        el.innerHTML = '<div class="pe-ref-loading" style="color:var(--text3)">Aucune règle définie — utilisez le formulaire ci-dessous pour en ajouter.</div>';
        return;
      }
      el.innerHTML = rules.map(function(r, i) {
        const tLbl = alertRuleTypeLbl[r.type] || r.type;
        const rLbl = alertResourceLbl[r.resource] || r.resource;
        return '<div class="pe-alert-rule-row">' +
          '<span class="pe-alert-rule-lbl">' + rLbl + ' — ' + tLbl + ' &gt; <strong>' + r.value + '</strong></span>' +
          '<button class="pe-alert-rule-del cso-ibtn" onclick="window._sttDelAlertRule(' + i + ')" title="Supprimer"><i class="fas fa-trash"></i></button>' +
          '</div>';
      }).join('');
    };

    window._sttAddAlertRule = function() {
      const type     = (document.getElementById('pe-alert-type') || {}).value;
      const resource = (document.getElementById('pe-alert-resource') || {}).value;
      const valueEl  = document.getElementById('pe-alert-value');
      const value    = parseFloat(valueEl && valueEl.value);
      if (!type || !resource || isNaN(value) || value <= 0) {
        MX.toast('Renseignez un type, une ressource et une valeur > 0', true); return;
      }
      window._sttAlertRules.push({ type: type, resource: resource, value: value });
      if (valueEl) valueEl.value = '';
      window._sttRenderAlertRules();
    };

    window._sttDelAlertRule = function(i) {
      window._sttAlertRules.splice(i, 1);
      window._sttRenderAlertRules();
    };

    // Load all config + meters async after render
    setTimeout(function() {
      Promise.all([
        db.collection('cso_perf_config').get(),
        db.collection('cso_meters').get(),
      ]).then(function(results) {
        const cfgSnap = results[0], meterSnap = results[1];
        let fsThresholds = {}, fsClasses = {}, fsRefMeters = {}, fsObjectifs = {}, fsAlertRules = {};
        cfgSnap.docs.forEach(function(d) {
          if (d.id === 'thresholds')  fsThresholds  = d.data();
          if (d.id === 'classes')     fsClasses     = d.data();
          if (d.id === 'ref_meters')  fsRefMeters   = d.data();
          if (d.id === 'objectifs')   fsObjectifs   = d.data();
          if (d.id === 'alert_rules') fsAlertRules  = d.data();
        });
        const allMeters = meterSnap.docs
          .map(function(d) { return Object.assign({ id: d.id }, d.data()); })
          .filter(function(m) { return !m.archived; });

        // Populate threshold inputs
        Object.keys(TYPE_META).forEach(function(type) {
          const typeT = fsThresholds[type] || {};
          CLASS_ORDER.filter(function(k){return k!=='critique';}).forEach(function(k) {
            const inp = document.getElementById('pe-inp-'+type+'-'+k);
            if (inp && typeT[k] !== undefined) inp.value = typeT[k];
          });
        });
        // Populate class color/score inputs
        CLASS_ORDER.forEach(function(k) {
          const colInp = document.getElementById('pe-col-'+k);
          const scInp  = document.getElementById('pe-sc-'+k);
          if (fsClasses[k]) {
            if (colInp && fsClasses[k].color) colInp.value = fsClasses[k].color;
            if (scInp  && fsClasses[k].scoreCenter !== undefined) scInp.value = fsClasses[k].scoreCenter;
          }
        });
        // Populate objectifs inputs
        OBJ_TYPES.forEach(function(ot) {
          const obj = fsObjectifs[ot] || {};
          const inpT   = document.getElementById('pe-obj-'+ot);
          const inpTol = document.getElementById('pe-tol-'+ot);
          if (inpT && obj.target !== undefined) inpT.value = obj.target;
          if (inpTol && obj.tolerance !== undefined) inpTol.value = obj.tolerance;
        });
        // Render ref meters checkboxes
        const el = document.getElementById('pe-ref-meters-content');
        if (el) {
          const REF_TYPES = ['eau_froide','eau_chaude','electricite','gaz'];
          let refHtml = '';
          REF_TYPES.forEach(function(type) {
            const mt = TYPE_META[type]; if (!mt) return;
            const typeMeters = allMeters.filter(function(m) { return m.type === type; });
            if (!typeMeters.length) return;
            const savedIds = Array.isArray(fsRefMeters[type]) ? fsRefMeters[type] : [];
            const useAll = !savedIds.length;
            refHtml += '<div class="pe-ref-type-block">' +
              '<div class="pe-ref-type-hd">' + mt.icon + ' ' + mt.label + '</div>' +
              '<div class="pe-ref-meter-list">';
            typeMeters.forEach(function(m) {
              const checked = useAll || savedIds.indexOf(m.id) !== -1;
              refHtml += '<label class="pe-ref-meter-item">' +
                '<input type="checkbox" class="pe-ref-chk" data-type="' + type + '" data-id="' + m.id + '"' + (checked ? ' checked' : '') + '> ' +
                (m.name || m.id) + (m.zone ? ' <span class="pe-day-zone">' + m.zone + '</span>' : '') +
                '</label>';
            });
            refHtml += '</div></div>';
          });
          el.innerHTML = refHtml || '<div class="pe-ref-loading">Aucun compteur trouvé</div>';
        }
        // Load alert rules into memory and render
        window._sttAlertRules = Array.isArray(fsAlertRules.rules) ? fsAlertRules.rules.slice() : [];
        window._sttRenderAlertRules();
      }).catch(function(err) { console.warn('[Energie settings] Load error:', err); });
    }, 100);

    window._sttSaveEnergie = async function() {
      const thresholds = {};
      Object.keys(TYPE_META).forEach(function(type) {
        thresholds[type] = {};
        CLASS_ORDER.filter(function(k){return k!=='critique';}).forEach(function(k) {
          const inp = document.getElementById('pe-inp-'+type+'-'+k);
          const v = parseFloat(inp && inp.value);
          if (!isNaN(v)) thresholds[type][k] = v;
        });
      });
      const classes = {};
      CLASS_ORDER.forEach(function(k) {
        classes[k] = {};
        const colEl = document.getElementById('pe-col-'+k);
        const scEl  = document.getElementById('pe-sc-'+k);
        const col = colEl && colEl.value;
        const sc  = parseInt(scEl && scEl.value);
        if (col) classes[k].color = col;
        if (!isNaN(sc)) classes[k].scoreCenter = sc;
      });
      // Ref meters: only store types where a strict SUBSET is selected
      const refMeters = {};
      const chks = document.querySelectorAll('.pe-ref-chk');
      const byType = {};
      chks.forEach(function(chk) {
        const t = chk.dataset.type, id = chk.dataset.id;
        if (!byType[t]) byType[t] = { all: [], checked: [] };
        byType[t].all.push(id);
        if (chk.checked) byType[t].checked.push(id);
      });
      Object.keys(byType).forEach(function(type) {
        const info = byType[type];
        if (info.checked.length && info.checked.length < info.all.length) {
          refMeters[type] = info.checked;
        }
      });
      // Objectifs
      const objectifs = {};
      OBJ_TYPES.forEach(function(ot) {
        const inpT   = document.getElementById('pe-obj-'+ot);
        const inpTol = document.getElementById('pe-tol-'+ot);
        const target = parseFloat(inpT && inpT.value);
        const tol    = parseFloat(inpTol && inpTol.value);
        if (!isNaN(target) && target > 0) {
          objectifs[ot] = { target: target, tolerance: isNaN(tol) ? 10 : tol };
        }
      });
      // Alert rules
      const alertRules = { rules: (window._sttAlertRules || []).filter(function(r) { return r.type && r.resource && r.value > 0; }) };
      try {
        await db.collection('cso_perf_config').doc('thresholds').set(thresholds);
        await db.collection('cso_perf_config').doc('classes').set(classes);
        await db.collection('cso_perf_config').doc('ref_meters').set(refMeters);
        await db.collection('cso_perf_config').doc('objectifs').set(objectifs);
        await db.collection('cso_perf_config').doc('alert_rules').set(alertRules);
        MX.toast('Paramètres énergétiques sauvegardés');
      } catch(err) { MX.toast('Erreur sauvegarde', true); console.error(err); }
    };

    window._sttResetEnergie = async function() {
      if (!confirm('Rétablir tous les seuils par défaut ?')) return;
      try {
        await db.collection('cso_perf_config').doc('thresholds').set(DEFAULTS.thresholds);
        await db.collection('cso_perf_config').doc('classes').set(DEFAULTS.classes);
        MX.toast('Valeurs par défaut restaurées');
        MX.Pages.Settings._showSection('energie');
      } catch(err) { MX.toast('Erreur', true); console.error(err); }
    };

    return '<div class="pe-stt-wrap">' +
      '<div class="stt-section-intro">' +
        'Configurez les seuils de performance énergétique propres à votre établissement.<br>' +
        'Ces valeurs sont stockées dans Firestore et s\'appliquent à tous les calculs de ratios et de score.' +
      '</div>' +
      typeHtml +
      classHtml +
      refMetersHtml +
      objHtml +
      alertHtml +
      saveBtn +
      '</div>';
  }


  function _renderMaintenance() {
    const d = _maintData || {};
    const active = !!d.active;
    const logHtml = _deployLog.length === 0
      ? '<div style="color:var(--text3);font-size:12px;padding:8px 0">Aucun déploiement enregistré.</div>'
      : _deployLog.map(function(e) {
          const tsVal = e.ts && e.ts.toDate ? e.ts.toDate().toLocaleString('fr-FR') : (e.ts || '—');
          const action = e.action === 'on' ? '<span style="color:var(--orange);font-weight:700">Activé</span>' :
                         e.action === 'off' ? '<span style="color:var(--green);font-weight:700">Désactivé</span>' : MX.esc(e.action || '—');
          return '<div class="stt-info-row"><span class="stt-info-label">' + tsVal + '</span><span class="stt-info-val">' + action + (e.by ? ' — ' + MX.esc(e.by) : '') + '</span></div>';
        }).join('');

    return '<div class="stt-section-head"><i class="fas fa-wrench"></i> Mode Maintenance</div>' +
      '<div class="stt-card">' +
        '<div class="stt-card-title">Activation</div>' +
        '<div class="stt-info-row" style="margin-bottom:10px">' +
          '<span class="stt-info-label"><i class="fas fa-toggle-' + (active ? 'on' : 'off') + '" style="color:' + (active ? 'var(--orange)' : 'var(--text3)') + '"></i> Mode maintenance</span>' +
          '<label class="stt-toggle">' +
            '<input type="checkbox" id="maint-toggle" ' + (active ? 'checked' : '') + ' onchange="MX.Pages.Settings._maintToggle(this.checked)">' +
            '<span class="stt-toggle-track"></span>' +
          '</label>' +
        '</div>' +
        '<div class="stt-info-row" style="margin-bottom:10px">' +
          '<span class="stt-info-label"><i class="fas fa-comment"></i> Message</span>' +
          '<input class="fi" id="maint-msg" style="max-width:240px;font-size:12px" value="' + MX.esc(d.message || 'Maintenance en cours. Merci de patienter.') + '" placeholder="Message affiché aux techniciens">' +
        '</div>' +
        '<div class="stt-info-row" style="margin-bottom:10px">' +
          '<span class="stt-info-label"><i class="fas fa-clock"></i> Durée estimée (min)</span>' +
          '<input class="fi" id="maint-mins" type="number" min="1" max="120" style="max-width:80px;font-size:12px" value="' + (d.estimatedMinutes || '') + '" placeholder="—">' +
        '</div>' +
        '<div class="stt-info-row" style="margin-bottom:14px">' +
          '<span class="stt-info-label"><i class="fas fa-rocket"></i> Prochaine version</span>' +
          '<input class="fi" id="maint-ver" style="max-width:100px;font-size:12px" value="' + MX.esc(d.nextVersion || '') + '" placeholder="ex: 1.0.35">' +
        '</div>' +
        '<button class="stt-btn" onclick="MX.Pages.Settings._maintSave()">' +
          '<i class="fas fa-floppy-disk"></i> Enregistrer les paramètres' +
        '</button>' +
      '</div>' +
      '<div class="stt-card" style="margin-top:12px">' +
        '<div class="stt-card-title">Historique de déploiement</div>' +
        '<div class="stt-info-list">' + logHtml + '</div>' +
      '</div>';
  }

  function _maintInit() {
    if (_maintUnsub) return;
    _maintUnsub = MX.DB.listenMaintenance(function(data) {
      _maintData = data;
      const sec = document.getElementById('stt-content');
      if (sec && document.querySelector('.stt-nav-item[data-sec="maintenance"]') &&
          document.querySelector('.stt-nav-item[data-sec="maintenance"]').classList.contains('active')) {
        sec.innerHTML = _renderMaintenance();
      }
    });
    MX.DB.listenDeployLog(function(log) {
      _deployLog = log;
    });
  }

  function _maintToggle(checked) {
    const admin = MX.state.adminUser;
    const by = admin ? (admin.email || 'admin') : 'admin';
    MX.DB.saveMaintenance({ active: checked }).then(function() {
      MX.DB.logDeploy({ action: checked ? 'on' : 'off', by: by });
      MX.toast(checked ? '🔴 Maintenance activée' : '🟢 Maintenance désactivée');
    }).catch(function() { MX.toast('Erreur lors de la mise à jour', true); });
  }

  function _maintSave() {
    const msg  = (document.getElementById('maint-msg')  || {}).value || '';
    const mins = parseInt((document.getElementById('maint-mins') || {}).value, 10) || null;
    const ver  = (document.getElementById('maint-ver')  || {}).value || '';
    const data = { message: msg };
    if (mins) data.estimatedMinutes = mins;
    if (ver) data.nextVersion = ver;
    MX.DB.saveMaintenance(data).then(function() {
      MX.toast('Paramètres enregistrés');
    }).catch(function() { MX.toast('Erreur lors de la sauvegarde', true); });
  }

  // ── SECTION SWITCHER ──
  function _showSection(id) {
    _section = id;
    // Update nav active state
    document.querySelectorAll('.stt-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.sec === id);
    });
    const content = document.getElementById('stt-content');
    if (!content) return;
    const renderers = {
      profil:        _renderProfil,
      securite:      _renderSecurite,
      notifications: _renderNotifications,
      apparence:     _renderApparence,
      planning:      _renderPlanning,
      application:   _renderApplication,
      permissions:   _renderPermissions,
      journal:       _renderJournal,
      nouveautes:    _renderNouveautes,
      informations:  _renderInformations,
      apropos:       _renderApropos,
      diagnostic:    _renderDiagnostic,
      maintenance:   _renderMaintenance,
      energie:        _renderEnergie,
    };
    if (id === 'maintenance') _maintInit();
    content.innerHTML = (renderers[id] || (() => ''))();
  }

  // ── PREF SETTERS ──
  function _togglePref(key, val) { _setPrefs({ [key]: val }); }
  function _setPref(key, val) {
    _setPrefs({ [key]: val });
    _showSection(_section);
  }
  function _setChannel(val) { _setPref('notif_channel', val); }
  function _setTheme(val) {
    if (MX.ThemeManager) MX.ThemeManager.setTheme(val);
    _setPrefs({ theme: val });
    _showSection(_section);
  }
  function _setAccent(val) {
    if (MX.ThemeManager) MX.ThemeManager.setAccent(val);
    _setPrefs({ accent: val });
    _showSection(_section);
  }
  function _setTextSize(val) {
    if (MX.ThemeManager) MX.ThemeManager.setTextSize(val);
    _setPrefs({ text_size: val });
    _showSection(_section);
  }
  function _setCompactMode(val) {
    const compact = val === true || val === 'true';
    if (MX.ThemeManager) MX.ThemeManager.setCompact(compact);
    _setPrefs({ compact });
    _showSection(_section);
  }
  function _setPlanView(val) { _setPref('plan_default_view', val); }
  function _clearCache() {
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
        MX.toast('Cache vidé — rechargement…');
        setTimeout(() => location.reload(), 1000);
      });
    } else {
      MX.toast('Cache non accessible dans ce contexte', true);
    }
  }

  // ── PAGE RENDER ──
  function renderPage() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    if (window._settingsTab) {
      _section = window._settingsTab;
      window._settingsTab = null;
    }
    const isAdmin = MX.Auth.isAdmin && MX.Auth.isAdmin();

    const navItems = SECTIONS.filter(s => !s.adminOnly || isAdmin).map(s => `
      <button class="stt-nav-item ${_section === s.id ? 'active' : ''}" data-sec="${s.id}"
        onclick="MX.Pages.Settings._showSection('${s.id}')">
        <i class="fas ${s.icon}"></i>
        <span>${s.l}</span>
      </button>`).join('');

    mc.innerHTML = `
      <div class="ph">
        <div class="ph-left">
          <div class="ph-title"><i class="fas fa-gear"></i> Paramètres</div>
          <div class="ph-sub">Personnalisez votre expérience Maintix</div>
        </div>
      </div>
      <div class="stt-layout">
        <aside class="stt-nav">
          ${navItems}
        </aside>
        <div class="stt-content" id="stt-content"></div>
      </div>`;

    _showSection(_section);
  }

  // ── EXPORT ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Settings = {
    render: renderPage,
    _showSection,
    _openAvatarPicker,
    _removeAvatar,
    _saveProfile,
    _openChangePinModal,
    _openAdminResetPinModal,
    _togglePref,
    _setPref,
    _setChannel,
    _setTheme,
    _setAccent,
    _setTextSize,
    _setCompactMode,
    _setPlanView,
    _clearCache,
    _cropRotate: (deg) => { _cropRot = (_cropRot + deg + 360) % 360; _renderCropCanvas(); },
    _cropZoom:   (val) => { _cropScale = parseInt(val, 10) / 100; _renderCropCanvas(); },
    _avatarHtml,
    _diagVersionTap,
    _refreshDiag: () => _showSection('diagnostic'),
    _refreshInfos: () => _showSection('informations'),
    _confirmForceUpdate,
    _toggleSound,
    _previewSound,
    _maintToggle,
    _maintSave,
  };
})();
