(function () {
  // ── Local state ──
  let _filter        = 'all';
  let _selectedType  = 'info';
  let _expandedSet   = new Set();
  let _replyListeners = {};
  let _replies       = {};

  const T = {
    info:       { icon: '📢', label: 'Information', c: 'var(--cyan)',   cd: 'var(--cyan-dim)',   cb: 'var(--cyan-border)' },
    important:  { icon: '⚠️', label: 'Important',   c: 'var(--orange)', cd: 'var(--orange-dim)', cb: 'var(--orange-border)' },
    urgent:     { icon: '🚨', label: 'Urgent',      c: 'var(--red)',    cd: 'var(--red-dim)',    cb: 'var(--red-border)' },
    suggestion: { icon: '💡', label: 'Suggestion',  c: 'var(--jour)',   cd: 'var(--jour-dim)',   cb: 'var(--jour-border)' },
    technique:  { icon: '🔧', label: 'Technique',   c: 'var(--green)',  cd: 'var(--green-dim)',  cb: 'var(--green-border)' }
  };
  const EMOJIS = ['👍', '✅', '⚠️'];

  // ── Permissions ──
  function _author() {
    if (MX.Auth.isAdmin()) return MX.state.adminUser?.displayName || 'Admin';
    return MX.state.currentUser?.name || null;
  }
  function _role() {
    if (MX.Auth.isAdmin()) return 'admin';
    return MX.state.currentUser?.role || null;
  }
  function _allowedTypes() {
    const r = _role();
    if (!r) return [];
    if (r === 'admin' || r === 'responsable') return Object.keys(T);
    if (r === 'technicien') return ['info', 'suggestion'];
    return [];
  }
  function _canPin()     { return MX.Auth.isAdmin() || MX.state.currentUser?.role === 'responsable'; }
  function _canDel(ann) {
    if (MX.Auth.isAdmin()) return true;
    const cu = MX.state.currentUser;
    if (!cu) return false;
    if (cu.role === 'responsable') return true;
    return ann.authorName === cu.name;
  }
  function _canDelReply(r) {
    if (MX.Auth.isAdmin()) return true;
    const cu = MX.state.currentUser;
    if (!cu) return false;
    if (cu.role === 'responsable') return true;
    return r.authorName === cu.name;
  }

  // ── Helpers ──
  function _tsMs(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds)  return ts.seconds * 1000;
    return 0;
  }
  function _relTime(ts) { return MX.fmtTime(ts) || ''; }

  function _renderContent(text) {
    return MX.esc(text || '').replace(/@([\wÀ-ž]+)/g,
      '<span class="ann-mention">@$1</span>');
  }

  function _sorted(list) {
    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return _tsMs(b.createdAt) - _tsMs(a.createdAt);
    });
  }

  function _filtered(list) {
    const author = _author();
    const seen   = parseInt(localStorage.getItem('mx_msgs_seen') || '0', 10);
    const sorted = _sorted(list);
    if (_filter === 'important') return sorted.filter(a => a.type === 'important');
    if (_filter === 'urgent')    return sorted.filter(a => a.type === 'urgent');
    if (_filter === 'pinned')    return sorted.filter(a => a.pinned);
    if (_filter === 'unread')    return sorted.filter(a => {
      if (author && (a.readBy || []).includes(author)) return false;
      return _tsMs(a.createdAt) > seen;
    });
    return sorted;
  }

  // ── Render ──
  function render() {
    const el     = document.getElementById('main-content');
    const author = _author();
    const anns   = MX.state.announcements || [];

    // Ensure selected type is allowed
    const allowed = _allowedTypes();
    if (allowed.length && !allowed.includes(_selectedType)) _selectedType = allowed[0];

    // Mark visible as read
    if (author) {
      anns.forEach(a => {
        if (!(a.readBy || []).includes(author)) {
          MX.DB.markReadAnnouncement(a.id, author).catch(() => {});
        }
      });
    }

    const filtered = _filtered(anns);
    const seen     = parseInt(localStorage.getItem('mx_msgs_seen') || '0', 10);
    const unreadN  = anns.filter(a => {
      if (author && (a.readBy || []).includes(author)) return false;
      return _tsMs(a.createdAt) > seen;
    }).length;

    let h = `
      <div class="ph">
        <div class="ph-eye">COMMUNICATIONS</div>
        <div class="ph-row">
          <div>
            <div class="ph-title">Messages</div>
            <div class="ph-sub">Espace de communication d'équipe</div>
          </div>
        </div>
      </div>
      <div class="page-body">`;

    // Compose
    h += _composeHtml(author, allowed);

    // Filters
    h += `<div class="ann-filters">`;
    [
      { id: 'all',       l: 'Tout',          n: anns.length },
      { id: 'important', l: '⚠️ Important',   n: null },
      { id: 'urgent',    l: '🚨 Urgent',      n: null },
      { id: 'unread',    l: 'Non lus',        n: unreadN || null },
      { id: 'pinned',    l: '📌 Épinglé',     n: null }
    ].forEach(f => {
      h += `<button class="ann-filter-btn${_filter === f.id ? ' active' : ''}" onclick="MX.Pages.Messages._setFilter('${f.id}')">
        ${MX.esc(f.l)}${f.n ? `<span class="ann-filter-count">${f.n}</span>` : ''}
      </button>`;
    });
    h += `</div>`;

    // Cards
    if (!filtered.length) {
      h += `<div class="ann-empty">
        <div style="font-size:36px;margin-bottom:12px">💬</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">Aucune publication</div>
        <div style="font-size:13px;color:var(--text2)">
          ${_filter !== 'all' ? 'Aucun message dans ce filtre' : 'Soyez le premier à partager une information'}
        </div>
      </div>`;
    } else {
      filtered.forEach(a => { h += _cardHtml(a, author); });
    }

    h += `</div>`;
    el.innerHTML = h;

    // Restore expanded replies
    _expandedSet.forEach(id => _renderRepliesEl(id));

    // Set active type pill
    _highlightTypePill(_selectedType);
  }

  function _composeHtml(author, allowed) {
    if (!author || !allowed.length) {
      return `<div class="ann-compose-locked">
        <div style="font-size:28px;margin-bottom:10px">🔒</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Connexion requise</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:14px">Connectez-vous pour publier une annonce</div>
        <button onclick="MX.Auth.showUserPicker()" class="primary-btn" style="margin:0 auto;width:auto;padding:10px 24px">
          <i class="fas fa-user-circle"></i> Se connecter
        </button>
      </div>`;
    }
    const { esc, avatarBg, avatarFg } = MX;
    const isAdm    = MX.Auth.isAdmin();
    const bg       = isAdm ? 'var(--cyan)'   : avatarBg(author);
    const fg       = isAdm ? '#0C0C0E'       : avatarFg(author);
    const roleMap  = { admin: 'Administrateur', responsable: 'Responsable', technicien: 'Technicien' };
    const roleLabel = roleMap[_role()] || 'Utilisateur';

    let pills = '';
    Object.entries(T).forEach(([key, t]) => {
      if (!allowed.includes(key)) return;
      pills += `<button type="button" class="ann-type-pill" id="atp_${key}" onclick="MX.Pages.Messages._setType('${key}')"
        style="--pill-c:${t.c};--pill-cd:${t.cd};--pill-cb:${t.cb}">
        ${t.icon} ${t.label}
      </button>`;
    });

    return `<div class="ann-compose">
      <div class="ann-compose-who">
        ${isAdm ? `<div class="ann-av" style="background:${bg};color:${fg}">${esc(author.substring(0,2).toUpperCase())}</div>` : MX.userAvatarHtml(author, {size:36,radius:10})}
        <div>
          <div style="font-size:13px;font-weight:600">${esc(author)}</div>
          <div style="font-size:11px;color:var(--text2)">${roleLabel}</div>
        </div>
        <span style="margin-left:auto;color:var(--cyan);font-size:12px"><i class="fas fa-check-circle"></i> Connecté</span>
      </div>
      <div class="ann-type-row" id="ann-type-row">${pills}</div>
      <textarea class="fi ann-ta" id="ann-content"
        placeholder="Quoi de neuf ? Utilisez @nom pour mentionner quelqu'un…"
        rows="3" maxlength="500"
        oninput="MX.Pages.Messages._onInput(this)"></textarea>
      <div class="ann-compose-foot">
        <span class="ann-char" id="ann-char">0 / 500</span>
        <button class="primary-btn" onclick="MX.Pages.Messages.send()" style="width:auto;padding:10px 22px">
          <i class="fas fa-paper-plane"></i> Publier
        </button>
      </div>
    </div>`;
  }

  function _cardHtml(ann, author) {
    const { esc, avatarBg, avatarFg } = MX;
    const t       = T[ann.type] || T.info;
    const isAdm   = ann.authorRole === 'admin';
    const bg      = isAdm ? 'var(--cyan)' : avatarBg(ann.authorName || '');
    const fg      = isAdm ? '#0C0C0E'     : avatarFg(ann.authorName || '');
    const rLabel  = { admin: 'Admin', responsable: 'Resp.', technicien: 'Tech.' }[ann.authorRole] || '';
    const reads   = (ann.readBy || []).length;
    const replies = ann.replyCount || 0;
    const isUnread = author ? !(ann.readBy || []).includes(author) : false;
    const isExpanded = _expandedSet.has(ann.id);
    const canPin = _canPin();
    const canDel = _canDel(ann);

    const reactionBtns = EMOJIS.map(e => {
      const users  = ann.reactions?.[e] || [];
      const active = author && users.includes(author);
      return `<button class="ann-rxn${active ? ' active' : ''}"
        onclick="MX.Pages.Messages._react('${ann.id}','${e}',${active})" title="${users.slice(0,5).join(', ')}">
        ${e}<span>${users.length || ''}</span>
      </button>`;
    }).join('');

    return `<div class="ann-card${ann.pinned ? ' pinned' : ''}${isUnread ? ' unread' : ''}" id="ann_${ann.id}">
      ${ann.pinned ? `<div class="ann-pin-bar" style="background:${t.cd};border-color:${t.cb};color:${t.c}">
        <i class="fas fa-thumbtack"></i> Épinglé
      </div>` : ''}
      <div class="ann-card-top">
        <div class="ann-badge" style="background:${t.cd};color:${t.c};border-color:${t.cb}">${t.icon} ${t.label}</div>
        <span style="flex:1"></span>
        ${isUnread ? '<div class="ann-dot"></div>' : ''}
        <span class="ann-ts">${_relTime(ann.createdAt)}</span>
      </div>
      <div class="ann-card-mid">
        <div class="ann-av-wrap">
          ${isAdm ? `<div class="ann-av" style="background:${bg};color:${fg}">${esc((ann.authorName||'?').substring(0,2).toUpperCase())}</div>` : MX.userAvatarHtml(ann.authorName||'?', {size:36,radius:10})}
          <div>
            <div style="font-size:13px;font-weight:600">${esc(ann.authorName || '?')}</div>
            <div class="ann-role" style="color:${t.c};background:${t.cd};border-color:${t.cb}">${rLabel}</div>
          </div>
        </div>
        <div class="ann-body">${_renderContent(ann.content || '')}</div>
      </div>
      <div class="ann-card-bot">
        <div class="ann-rxns">${reactionBtns}</div>
        <div class="ann-actions">
          <button class="ann-act" onclick="MX.Pages.Messages._toggleReplies('${ann.id}')">
            <i class="fas fa-comment-dots"></i>
            ${replies ? replies + (replies === 1 ? ' réponse' : ' réponses') : 'Répondre'}
          </button>
          <button class="ann-act" onclick="MX.Pages.Messages._readers('${ann.id}')" title="Lecteurs">
            <i class="fas fa-eye"></i> ${reads}
          </button>
          ${canPin ? `<button class="ann-act${ann.pinned ? ' ann-act--on' : ''}" onclick="MX.Pages.Messages._pin('${ann.id}',${ann.pinned})" title="${ann.pinned ? 'Désépingler' : 'Épingler'}">
            <i class="fas fa-thumbtack"></i>
          </button>` : ''}
          ${canDel ? `<button class="ann-act ann-act--del" onclick="MX.Pages.Messages._del('${ann.id}')">
            <i class="fas fa-trash"></i>
          </button>` : ''}
        </div>
      </div>
      <div class="ann-replies-wrap" id="rpl_${ann.id}" style="display:${isExpanded ? 'block' : 'none'}"></div>
    </div>`;
  }

  function _renderRepliesEl(annId) {
    const wrap = document.getElementById('rpl_' + annId);
    if (!wrap) return;
    const { esc, avatarBg, avatarFg } = MX;
    const list   = _replies[annId] || [];
    const author = _author();

    let h = `<div class="ann-replies-box">`;

    if (!list.length) {
      h += `<div class="ann-replies-empty">Aucune réponse pour l'instant</div>`;
    } else {
      list.forEach(r => {
        const isAdm = r.authorRole === 'admin';
        const bg = isAdm ? 'var(--cyan)' : avatarBg(r.authorName || '');
        const fg = isAdm ? '#0C0C0E'     : avatarFg(r.authorName || '');
        const rLbl = { admin: 'Admin', responsable: 'Resp.', technicien: 'Tech.' }[r.authorRole] || '';
        const canDel = _canDelReply(r);
        h += `<div class="ann-reply">
          ${isAdm ? `<div class="ann-av sm" style="background:${bg};color:${fg}">${esc((r.authorName||'?').substring(0,2).toUpperCase())}</div>` : MX.userAvatarHtml(r.authorName||'?', {size:28,radius:8})}
          <div style="flex:1;min-width:0">
            <div class="ann-reply-meta">
              <span class="ann-reply-author">${esc(r.authorName||'?')}</span>
              <span class="ann-reply-role">${rLbl}</span>
              <span class="ann-reply-ts">${_relTime(r.createdAt)}</span>
              ${canDel ? `<button onclick="MX.Pages.Messages._delReply('${annId}','${r.id}')" class="ann-reply-del"><i class="fas fa-times"></i></button>` : ''}
            </div>
            <div class="ann-reply-body">${_renderContent(r.content || '')}</div>
          </div>
        </div>`;
      });
    }

    if (author) {
      h += `<div class="ann-reply-compose">
        <textarea class="fi" id="rpl_ta_${annId}" placeholder="Votre réponse…" rows="2" style="font-size:13px;resize:none"></textarea>
        <button class="primary-btn" onclick="MX.Pages.Messages._sendReply('${annId}')" style="width:auto;padding:8px 16px;font-size:13px;margin-top:6px;align-self:flex-end">
          <i class="fas fa-paper-plane"></i> Répondre
        </button>
      </div>`;
    }

    h += `</div>`;
    wrap.innerHTML = h;
  }

  // ── Actions ──
  function _setType(type) {
    _selectedType = type;
    _highlightTypePill(type);
  }

  function _highlightTypePill(type) {
    Object.keys(T).forEach(k => {
      const el = document.getElementById('atp_' + k);
      if (el) el.classList.toggle('active', k === type);
    });
  }

  function _onInput(ta) {
    const n = (ta.value || '').length;
    const el = document.getElementById('ann-char');
    if (el) { el.textContent = n + ' / 500'; el.style.color = n > 450 ? 'var(--orange)' : 'var(--text3)'; }
  }

  function _setFilter(f) {
    _filter = f;
    render();
  }

  async function send() {
    const author  = _author();
    if (!author) return MX.toast('Connectez-vous pour publier', true);
    const content = ((document.getElementById('ann-content') || {}).value || '').trim();
    if (!content) return MX.toast('Écrivez quelque chose', true);
    if (content.length > 500) return MX.toast('Maximum 500 caractères', true);
    const allowed = _allowedTypes();
    if (!allowed.includes(_selectedType)) return MX.toast('Type non autorisé pour votre rôle', true);

    const btn = document.querySelector('.ann-compose .primary-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
      await MX.DB.sendAnnouncement({ type: _selectedType, content, authorName: author, authorRole: _role() });
      MX.toast('Annonce publiée ✓');
      const ta = document.getElementById('ann-content');
      if (ta) ta.value = '';
      const ch = document.getElementById('ann-char');
      if (ch) ch.textContent = '0 / 500';
    } catch (e) {
      console.error(e);
      MX.toast('Erreur lors de la publication', true);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Publier'; }
    }
  }

  function _toggleReplies(annId) {
    if (_expandedSet.has(annId)) {
      _expandedSet.delete(annId);
      if (_replyListeners[annId]) { _replyListeners[annId](); delete _replyListeners[annId]; }
      const w = document.getElementById('rpl_' + annId);
      if (w) w.style.display = 'none';
    } else {
      _expandedSet.add(annId);
      const w = document.getElementById('rpl_' + annId);
      if (w) {
        w.style.display = 'block';
        w.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3)"><i class="fas fa-spinner fa-spin"></i></div>';
      }
      _replyListeners[annId] = MX.DB.listenReplies(annId, list => {
        _replies[annId] = list;
        _renderRepliesEl(annId);
      });
    }
  }

  async function _react(annId, emoji, isActive) {
    const author = _author();
    if (!author) return MX.toast('Connectez-vous pour réagir', true);
    try { await MX.DB.toggleReaction(annId, emoji, author, isActive); }
    catch (e) { console.error(e); }
  }

  async function _pin(annId, currentlyPinned) {
    try {
      await MX.DB.togglePin(annId, currentlyPinned);
      MX.toast(currentlyPinned ? 'Désépinglé' : 'Épinglé 📌');
    } catch (e) { MX.toast('Erreur', true); }
  }

  function _del(annId) {
    MX.showModal('Supprimer cette annonce ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteAnnouncement(annId); MX.toast('Annonce supprimée'); }
        catch (e) { MX.toast('Erreur suppression', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  async function _sendReply(annId) {
    const author = _author();
    if (!author) return MX.toast('Connectez-vous pour répondre', true);
    const ta = document.getElementById('rpl_ta_' + annId);
    const content = (ta?.value || '').trim();
    if (!content) return MX.toast('Écrivez quelque chose', true);
    try {
      await MX.DB.sendReply({ annId, content, authorName: author, authorRole: _role() });
      if (ta) ta.value = '';
      MX.toast('Réponse envoyée ✓');
    } catch (e) { MX.toast('Erreur lors de la réponse', true); }
  }

  function _delReply(annId, replyId) {
    MX.showModal('Supprimer cette réponse ?', '', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteReply(annId, replyId); MX.toast('Réponse supprimée'); }
        catch (e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _readers(annId) {
    const ann = (MX.state.announcements || []).find(a => a.id === annId);
    if (!ann) return;
    const r = ann.readBy || [];
    if (!r.length) return MX.toast('Personne n\'a encore lu ce message');
    MX.showModal(
      `Lu par ${r.length} personne${r.length > 1 ? 's' : ''}`,
      r.join(', '),
      [{ label: 'Fermer', cls: 'cancel' }]
    );
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Messages = {
    render, send,
    _setType, _setFilter, _onInput,
    _react, _pin, _del,
    _toggleReplies, _sendReply, _delReply,
    _readers
  };
})();
