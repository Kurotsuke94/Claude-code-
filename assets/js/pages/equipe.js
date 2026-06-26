(function () {
  // ── STATE ──
  let _roles      = [];
  let _users      = [];
  let _unsubRoles = null;
  let _unsubUsers = null;
  let _filterRole = null;
  let _searchQ    = '';
  let _migDone    = false;

  // ── DEFAULT MÉTIERS (migration) ──
  const _DEFAULT_ROLES = [
    {
      id: 'technicien-maintenance', name: 'Technicien Maintenance',
      icon: 'fa-wrench', color: '#60A5FA', order: 0,
      permissions: ['home','msgs','today-cl','orders','documents','planning','badges','notifs'],
      description: 'Maintenance technique générale',
    },
    {
      id: 'responsable-technique', name: 'Responsable Technique',
      icon: 'fa-user-tie', color: '#F59E0B', order: 1,
      permissions: ['home','msgs','today-cl','orders','documents','planning','badges','notifs','interventions','consommations'],
      description: 'Encadrement et gestion de l\'équipe technique',
    },
  ];

  // ── PERMISSIONS MODULES DISPONIBLES ──
  const ALL_PERMS = [
    { id: 'home',          l: 'Tableau de bord',   icon: 'fa-house' },
    { id: 'msgs',          l: 'Messages',          icon: 'fa-comments' },
    { id: 'today-cl',      l: 'Check-lists',       icon: 'fa-list-check' },
    { id: 'orders',        l: 'Stock & Commandes', icon: 'fa-box' },
    { id: 'documents',     l: 'Bible Maintix',     icon: 'fa-book' },
    { id: 'planning',      l: 'Planning',          icon: 'fa-calendar-days' },
    { id: 'badges',        l: 'Badges',            icon: 'fa-medal' },
    { id: 'notifs',        l: 'Notifications',     icon: 'fa-bell' },
    { id: 'interventions', l: 'Interventions',     icon: 'fa-wrench' },
    { id: 'consommations', l: 'Consommations',     icon: 'fa-droplet' },
  ];

  // ── CRÉNEAUX ──
  const SHIFTS = [
    { id: 'matin',   l: 'Matin',   icon: 'fa-sun',       color: '#FDE047' },
    { id: 'journee', l: 'Journée', icon: 'fa-cloud-sun',  color: '#94A3B8' },
    { id: 'soir',    l: 'Soir',    icon: 'fa-moon',      color: '#818CF8' },
  ];

  // ── RANGS ──
  const RANKS = {
    utilisateur: { l: 'Utilisateur', icon: 'fa-user',     cls: 'eq-rank--user' },
    responsable: { l: 'Responsable', icon: 'fa-user-tie', cls: 'eq-rank--resp' },
  };

  // ── PERMISSIONS ──
  function _canManage() { return MX.Auth.isAdmin() || MX.Auth.canSeeAll(); }
  function _isAdmin()   { return MX.Auth.isAdmin(); }

  // ── MIGRATION ──
  async function _migrateDefaultRoles() {
    if (_migDone) return;
    _migDone = true;
    for (const r of _DEFAULT_ROLES) {
      try { await MX.DB.addRole({ id: r.id, name: r.name, icon: r.icon, color: r.color, order: r.order, permissions: r.permissions, description: r.description, createdBy: 'migration' }); }
      catch(e) { /* ignore */ }
    }
  }

  // ── HELPERS ──
  function _initials(name) { return (name || '?').substring(0, 2).toUpperCase(); }
  function _userRoleObj(u) { return _roles.find(r => r.id === u.roleId) || null; }
  function _userRankKey(u) { return u.rank || (u.role === 'responsable' ? 'responsable' : 'utilisateur'); }

  // ── RENDER ──
  function render() {
    const mc = document.getElementById('main-content');
    if (!mc) return;

    if (!_unsubRoles) {
      _unsubRoles = MX.DB.listenRoles(list => {
        if (list.length === 0 && !_migDone) {
          _migrateDefaultRoles();
        } else {
          _migDone = true;
          _roles = list;
          MX.state.roles = list;
          if (MX.state.currentPage === 'equipe') render();
        }
      });
    }
    if (!_unsubUsers) {
      _unsubUsers = MX.DB.listenUsers(list => {
        _users = list;
        if (MX.state.currentPage === 'equipe') render();
      });
    }

    _renderMain(mc);
  }

  function _renderMain(mc) {
    const canManage  = _canManage();
    const isAdmin    = _isAdmin();
    const sortedRoles = [..._roles].sort((a, b) => (a.order || 0) - (b.order || 0));

    // Compte membres par métier
    const memberCounts = {};
    _users.forEach(u => {
      const rid = u.roleId || '';
      if (rid) memberCounts[rid] = (memberCounts[rid] || 0) + 1;
    });

    // Cards métiers
    const rolesHtml = sortedRoles.map(r => _roleCard(r, memberCounts[r.id] || 0, canManage)).join('');

    // Filtrage membres
    let filtered = [..._users];
    if (_filterRole) filtered = filtered.filter(u => u.roleId === _filterRole);
    if (_searchQ)    filtered = filtered.filter(u => (u.name || '').toLowerCase().includes(_searchQ.toLowerCase()));
    filtered.sort((a, b) => {
      const order = { responsable: 0, utilisateur: 1 };
      const ra = order[_userRankKey(a)] ?? 2;
      const rb = order[_userRankKey(b)] ?? 2;
      return ra !== rb ? ra - rb : (a.name || '').localeCompare(b.name || '');
    });

    // Dropdown filtre métier
    const roleFilterOpts = `<option value="">Tous les métiers</option>` +
      sortedRoles.map(r => `<option value="${MX.esc(r.id)}"${_filterRole === r.id ? ' selected' : ''}>${MX.esc(r.name)}</option>`).join('');

    mc.innerHTML = `
      <div class="ph eq-page">

        <div class="eq-header">
          <div class="eq-header-info">
            <div class="eq-title"><i class="fas fa-users-gear"></i> Gestion Équipe</div>
            <div class="eq-sub">${_users.length} membre${_users.length !== 1 ? 's' : ''} · ${_roles.length} métier${_roles.length !== 1 ? 's' : ''}</div>
          </div>
          ${canManage ? `<button class="primary-btn" onclick="MX.Pages.Equipe._openUserModal(null)"><i class="fas fa-plus"></i> <span class="eq-btn-lbl">Ajouter un membre</span></button>` : ''}
        </div>

        <div class="eq-section">
          <div class="eq-section-head">
            <div class="eq-section-title"><i class="fas fa-briefcase"></i> Métiers (${_roles.length})</div>
            ${canManage ? `<button class="bl-cat-add-sm" onclick="MX.Pages.Equipe._openRoleModal(null)"><i class="fas fa-plus"></i> Nouveau métier</button>` : ''}
          </div>
          <div class="eq-roles-grid">
            ${rolesHtml || `<div class="eq-empty"><i class="fas fa-briefcase"></i><div>Aucun métier — créez le premier</div></div>`}
          </div>
        </div>

        <div class="eq-section">
          <div class="eq-section-head">
            <div class="eq-section-title"><i class="fas fa-users"></i> Membres (${_users.length})</div>
            <div class="eq-filters">
              <input class="fi eq-search" type="text" placeholder="Rechercher…" value="${MX.esc(_searchQ)}" oninput="MX.Pages.Equipe._onSearch(this.value)">
              <select class="fi" style="font-size:12px;padding:6px 8px" onchange="MX.Pages.Equipe._onFilterRole(this.value)">${roleFilterOpts}</select>
            </div>
          </div>
          <div class="eq-members">
            ${filtered.length ? filtered.map(u => _memberCard(u, canManage)).join('') : `<div class="eq-empty"><i class="fas fa-user-slash"></i><div>Aucun membre trouvé</div></div>`}
          </div>
        </div>

      </div>`;
  }

  function _roleCard(r, count, canManage) {
    const perms = r.permissions || [];
    const shown = perms.slice(0, 5).map(pid => {
      const p = ALL_PERMS.find(x => x.id === pid);
      return p ? `<span class="eq-perm-chip" title="${MX.esc(p.l)}"><i class="fas ${MX.esc(p.icon)}"></i></span>` : '';
    }).join('');
    const more = perms.length > 5 ? `<span class="eq-perm-chip eq-perm-more">+${perms.length - 5}</span>` : '';
    return `
      <div class="eq-role-card">
        <div class="eq-role-top">
          <div class="eq-role-icon" style="background:${MX.esc(r.color)}22;color:${MX.esc(r.color)}"><i class="fas ${MX.esc(r.icon || 'fa-briefcase')}"></i></div>
          <div class="eq-role-info">
            <div class="eq-role-name">${MX.esc(r.name)}</div>
            ${r.description ? `<div class="eq-role-desc">${MX.esc(r.description)}</div>` : ''}
          </div>
        </div>
        <div class="eq-role-perms">${shown}${more}</div>
        <div class="eq-role-footer">
          <span class="eq-role-count"><i class="fas fa-users"></i> ${count} membre${count !== 1 ? 's' : ''}</span>
          ${canManage ? `
            <div class="eq-role-acts">
              <button class="eq-icon-btn" title="Modifier" onclick="MX.Pages.Equipe._openRoleModal('${MX.esc(r.id)}')"><i class="fas fa-pen"></i></button>
              <button class="eq-icon-btn eq-icon-btn--danger" title="Supprimer" onclick="MX.Pages.Equipe._deleteRole('${MX.esc(r.id)}')"><i class="fas fa-trash"></i></button>
            </div>` : ''}
        </div>
      </div>`;
  }

  function _memberCard(u, canManage) {
    const roleObj  = _userRoleObj(u);
    const rankKey  = _userRankKey(u);
    const rankInfo = RANKS[rankKey] || RANKS.utilisateur;
    const shiftObj = SHIFTS.find(s => s.id === (u.shift || ''));
    const nc = MX.userColors ? MX.userColors(u.name || '') : { bg: '#2D2D2D', fg: '#FFF' };
    const bg = u.color || nc.bg;
    const fg = u.color ? MX._contrastColor(u.color) : nc.fg;
    const statusOn = u.status !== 'inactif';
    return `
      <div class="eq-member-card">
        <div class="eq-member-avatar" style="background:${bg};color:${fg}">${_initials(u.name)}</div>
        <div class="eq-member-body">
          <div class="eq-member-name">${MX.esc(u.name || '—')}</div>
          <div class="eq-member-chips">
            ${roleObj ? `<span class="eq-chip eq-chip--role" style="color:${MX.esc(roleObj.color)};border-color:${MX.esc(roleObj.color)}40"><i class="fas ${MX.esc(roleObj.icon)}"></i> ${MX.esc(roleObj.name)}</span>` : ''}
            <span class="eq-chip ${rankInfo.cls}"><i class="fas ${rankInfo.icon}"></i> ${rankInfo.l}</span>
            ${shiftObj ? `<span class="eq-chip eq-chip--shift" style="color:${shiftObj.color}"><i class="fas ${shiftObj.icon}"></i> ${shiftObj.l}</span>` : ''}
          </div>
        </div>
        <div class="eq-member-right">
          <span class="eq-status-dot ${statusOn ? 'eq-status-dot--on' : 'eq-status-dot--off'}" title="${statusOn ? 'Actif' : 'Inactif'}"></span>
          ${canManage ? `
            <button class="eq-icon-btn" title="Modifier" onclick="MX.Pages.Equipe._openUserModal('${MX.esc(u.id)}')"><i class="fas fa-pen"></i></button>
            <button class="eq-icon-btn eq-icon-btn--danger" title="Supprimer" onclick="MX.Pages.Equipe._deleteUser('${MX.esc(u.id)}')"><i class="fas fa-trash"></i></button>
          ` : ''}
        </div>
      </div>`;
  }

  // ── SEARCH / FILTER ──
  function _onSearch(q)      { _searchQ = q;   _renderMain(document.getElementById('main-content')); }
  function _onFilterRole(v)  { _filterRole = v || null; _renderMain(document.getElementById('main-content')); }

  // ── RÔLE (MÉTIER) CRUD ──
  function _openRoleModal(id) {
    const role  = id ? _roles.find(r => r.id === id) : null;
    const isNew = !role;
    const defIcon  = role?.icon  || 'fa-briefcase';
    const defColor = role?.color || '#60A5FA';

    const permsGrid = ALL_PERMS.map(p => {
      const on = role ? (role.permissions || []).includes(p.id) : true;
      return `<label class="eq-perm-label">
        <input type="checkbox" name="eq-perm" value="${p.id}"${on ? ' checked' : ''}>
        <span><i class="fas ${p.icon}"></i> ${MX.esc(p.l)}</span>
      </label>`;
    }).join('');

    const body = `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label>Nom du métier *</label>
        <input id="eq-rn" class="fi" type="text" placeholder="ex : Plombier, Électricien, Peintre…" value="${MX.esc(role?.name || '')}">
      </div>
      <div style="display:flex;gap:10px">
        <div class="form-group" style="flex:1">
          <label>Icône FontAwesome</label>
          <input id="eq-ri" class="fi" type="text" placeholder="fa-wrench" value="${MX.esc(defIcon)}">
        </div>
        <div class="form-group">
          <label>Couleur</label>
          <input id="eq-rc" type="color" value="${MX.esc(defColor)}" style="width:46px;height:38px;border:none;background:none;cursor:pointer;padding:0;border-radius:6px">
        </div>
      </div>
      <div class="form-group">
        <label>Description <span style="font-weight:400;color:var(--text3)">(optionnel)</span></label>
        <input id="eq-rd" class="fi" type="text" placeholder="Rôle et responsabilités…" value="${MX.esc(role?.description || '')}">
      </div>
      <div class="form-group">
        <label>Accès aux modules</label>
        <div class="eq-perms-grid">${permsGrid}</div>
      </div>
    </div>`;

    MX.showModal({
      title: isNew ? 'Nouveau métier' : 'Modifier le métier',
      body,
      actions: [
        ...(role ? [{ label: 'Supprimer', cls: 'danger', fn: () => _deleteRole(id) }] : []),
        { label: 'Annuler', cls: 'cancel' },
        { label: isNew ? 'Créer' : 'Enregistrer', cls: 'confirm', fn: () => _saveRole(id) },
      ],
    });
  }

  async function _saveRole(id) {
    const name  = (document.getElementById('eq-rn')?.value || '').trim();
    const icon  = (document.getElementById('eq-ri')?.value || '').trim() || 'fa-briefcase';
    const color = document.getElementById('eq-rc')?.value || '#60A5FA';
    const desc  = (document.getElementById('eq-rd')?.value || '').trim();
    const perms = [...document.querySelectorAll('input[name="eq-perm"]:checked')].map(el => el.value);
    if (!name) { MX.toast('Le nom est obligatoire', true); return; }
    try {
      const existing = id ? _roles.find(r => r.id === id) : null;
      const payload  = { name, icon, color, description: desc, permissions: perms, order: existing ? (existing.order ?? _roles.length) : _roles.length };
      if (id) {
        await MX.DB.updateRole(id, payload);
        MX.toast('Métier mis à jour');
      } else {
        await MX.DB.addRole(payload);
        MX.toast('Métier créé');
      }
      MX.closeModal();
    } catch(e) { MX.toast('Erreur : ' + e.message, true); }
  }

  function _deleteRole(id) {
    const role  = _roles.find(r => r.id === id);
    if (!role) return;
    const count = _users.filter(u => u.roleId === id).length;
    if (count > 0) {
      MX.closeModal();
      MX.showModal('Métier non vide', `Ce métier est assigné à ${count} membre${count > 1 ? 's' : ''}. Réassignez-les avant de supprimer.`, [{ label: 'Fermer', cls: 'cancel' }]);
      return;
    }
    MX.closeModal();
    MX.showModal(`Supprimer "${role.name}" ?`, 'Ce métier sera définitivement supprimé.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteRole(id); MX.toast('Métier supprimé'); }
        catch(e) { MX.toast('Erreur : ' + e.message, true); }
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]);
  }

  // ── UTILISATEUR CRUD ──
  function _openUserModal(id) {
    const user  = id ? _users.find(u => u.id === id) : null;
    const isNew = !user;
    const isAdmin  = _isAdmin();
    const defRank  = user ? _userRankKey(user) : 'utilisateur';
    const defRoleId = user?.roleId || '';
    const defShift  = user?.shift  || '';

    const sortedRoles = [..._roles].sort((a, b) => (a.order || 0) - (b.order || 0));
    const roleOpts  = `<option value="">— Choisir un métier —</option>` +
      sortedRoles.map(r => `<option value="${MX.esc(r.id)}"${defRoleId === r.id ? ' selected' : ''}>${MX.esc(r.name)}</option>`).join('');
    const shiftOpts = `<option value="">— Créneau —</option>` +
      SHIFTS.map(s => `<option value="${s.id}"${defShift === s.id ? ' selected' : ''}>${s.l}</option>`).join('');
    const rankOpts  = `<option value="utilisateur"${defRank === 'utilisateur' ? ' selected' : ''}>Utilisateur</option>` +
      (isAdmin ? `<option value="responsable"${defRank === 'responsable' ? ' selected' : ''}>Responsable</option>` : '');

    const body = `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label>Nom *</label>
        <input id="eq-un" class="fi" type="text" placeholder="Prénom ou pseudonyme" value="${MX.esc(user?.name || '')}">
      </div>
      <div class="form-group">
        <label>${isNew ? 'Code PIN *' : 'Nouveau PIN <span style="font-weight:400;color:var(--text3)">(laisser vide = inchangé)</span>'}</label>
        <input id="eq-up" class="fi" type="password" inputmode="numeric" placeholder="••••" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label>Métier</label>
        <select id="eq-ur" class="fi">${roleOpts}</select>
      </div>
      <div class="form-group">
        <label>Rang <span style="font-size:11px;color:var(--text3)">${isAdmin ? '' : '(seul Admin peut promouvoir Responsable)'}</span></label>
        <select id="eq-uk" class="fi"${isAdmin ? '' : ' disabled'}>${rankOpts}</select>
      </div>
      <div class="form-group">
        <label>Créneau principal</label>
        <select id="eq-us" class="fi">${shiftOpts}</select>
      </div>
      <div class="form-group">
        <label>Couleur avatar</label>
        <input id="eq-uc" type="color" value="${MX.esc(user?.color || '#3B82F6')}" style="width:46px;height:38px;border:none;background:none;cursor:pointer;padding:0;border-radius:6px">
      </div>
    </div>`;

    MX.showModal({
      title: isNew ? 'Ajouter un membre' : 'Modifier le membre',
      body,
      actions: [
        ...(user ? [{ label: 'Supprimer', cls: 'danger', fn: () => _deleteUser(id) }] : []),
        { label: 'Annuler', cls: 'cancel' },
        { label: isNew ? 'Ajouter' : 'Enregistrer', cls: 'confirm', fn: () => _saveUser(id) },
      ],
    });
  }

  async function _saveUser(id) {
    const name   = (document.getElementById('eq-un')?.value || '').trim();
    const pinRaw = (document.getElementById('eq-up')?.value || '').trim();
    const roleId = document.getElementById('eq-ur')?.value || '';
    const rank   = document.getElementById('eq-uk')?.value || 'utilisateur';
    const shift  = document.getElementById('eq-us')?.value || '';
    const color  = document.getElementById('eq-uc')?.value || '';
    if (!name) { MX.toast('Le nom est obligatoire', true); return; }
    if (!id && !pinRaw) { MX.toast('Le PIN est obligatoire pour un nouveau membre', true); return; }
    try {
      const payload = {
        name, roleId, shift, color,
        rank,
        role: rank === 'responsable' ? 'responsable' : 'technicien',
      };
      if (pinRaw) payload.pin = await MX.hashPin(pinRaw);
      if (id) {
        await MX.DB.updateUser(id, payload);
        MX.toast('Membre mis à jour');
      } else {
        await MX.DB.addUser({ ...payload, status: 'actif' });
        MX.toast('Membre ajouté');
      }
      MX.closeModal();
    } catch(e) { MX.toast('Erreur : ' + e.message, true); }
  }

  function _deleteUser(id) {
    const user = _users.find(u => u.id === id);
    if (!user) return;
    MX.closeModal();
    MX.showModal(`Supprimer "${user.name}" ?`, 'Ce membre sera définitivement supprimé de l\'équipe.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteUser(id); MX.toast('Membre supprimé'); }
        catch(e) { MX.toast('Erreur : ' + e.message, true); }
      }},
      { label: 'Annuler', cls: 'cancel' },
    ]);
  }

  function _destroy() {
    if (_unsubRoles) { _unsubRoles(); _unsubRoles = null; }
    if (_unsubUsers) { _unsubUsers(); _unsubUsers = null; }
  }

  window.MX        = window.MX        || {};
  window.MX.Pages  = window.MX.Pages  || {};
  window.MX.Pages.Equipe = {
    render, _destroy,
    _openRoleModal, _saveRole, _deleteRole,
    _openUserModal, _saveUser, _deleteUser,
    _onSearch, _onFilterRole,
  };
})();
