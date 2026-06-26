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
    { id: 'apropos',       icon: 'fa-circle-info',    l: 'À propos' },
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

    return `
      <div class="stt-section-head"><i class="fas fa-bell"></i> Notifications</div>
      <div class="stt-card">
        <div class="stt-card-title">Statut navigateur ${permBadge}</div>
        ${notifPerm !== 'granted' ? `
        <button class="stt-btn" style="margin-bottom:10px" onclick="MX.enableNotifications()">
          <i class="fas fa-bell"></i> Activer les notifications push
        </button>` : ''}
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Catégories</div>
        <div class="stt-toggle-list">${rows}</div>
      </div>
      <div class="stt-card" style="margin-top:12px">
        <div class="stt-card-title">Canal de réception</div>
        <div class="stt-radio-group">
          ${['app', 'email', 'both'].map(c => {
            const labels = { app: 'Application uniquement', email: 'Email uniquement', both: 'Application + Email' };
            const icons  = { app: 'fa-mobile-screen', email: 'fa-envelope', both: 'fa-layer-group' };
            return `<label class="stt-radio-opt ${channel === c ? 'active' : ''}" onclick="MX.Pages.Settings._setChannel('${c}')">
              <i class="fas ${icons[c]}"></i>
              <span>${labels[c]}</span>
              <span class="stt-radio-dot ${channel === c ? 'on' : ''}"></span>
            </label>`;
          }).join('')}
        </div>
      </div>`;
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
    const ver = '1.0.27';
    const isOnline = navigator.onLine;
    const users = MX.state.users || [];
    const lastSync = MX.state._lastSync ? new Date(MX.state._lastSync).toLocaleString('fr-FR') : 'Maintenant';

    return `
      <div class="stt-section-head"><i class="fas fa-circle-info"></i> À propos</div>
      <div class="stt-card">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <img src="/assets/icons/maintix-logo.png" style="width:52px;height:52px;object-fit:contain;border-radius:12px" alt="Maintix">
          <div>
            <div style="font-size:18px;font-weight:800;letter-spacing:-0.5px">Maintix</div>
            <div style="font-size:12px;color:var(--text3)">Gestion de maintenance industrielle</div>
            <div style="margin-top:4px"><span class="stt-badge stt-badge-green">v${ver}</span></div>
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
      apropos:       _renderApropos,
    };
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
  };
})();
