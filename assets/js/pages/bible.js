(function () {
  // ── STATE ──
  let _view = 'list';
  let _selectedCategory = 'all';
  let _selectedTag = null;
  let _searchQuery = '';
  let _currentArticle = null;
  let _articles = [];
  let _categories = [];
  let _comments = [];
  let _editLinks = [];
  let _editTags  = [];
  let _unsubArticles   = null;
  let _unsubComments   = null;
  let _unsubCategories = null;
  let _migrationDone   = false;

  // ── DEFAULT CATEGORIES (migration vers Firestore) ──
  const _DEFAULT_CATS = [
    { id: 'electricite', name: 'Électricité',                  icon: 'fa-bolt',               color: '#FDE047', order: 0  },
    { id: 'mecanique',   name: 'Mécanique',                    icon: 'fa-gears',              color: '#94A3B8', order: 1  },
    { id: 'automatisme', name: 'Automatisme',                  icon: 'fa-robot',              color: '#60A5FA', order: 2  },
    { id: 'hydraulique', name: 'Hydraulique',                  icon: 'fa-droplet',            color: '#38BDF8', order: 3  },
    { id: 'pneumatique', name: 'Pneumatique',                  icon: 'fa-wind',               color: '#A78BFA', order: 4  },
    { id: 'procedures',  name: 'Procédures',                   icon: 'fa-clipboard-list',     color: '#4ADE80', order: 5  },
    { id: 'depannages',  name: 'Dépannages',                   icon: 'fa-screwdriver-wrench', color: '#FB923C', order: 6  },
    { id: 'rex',         name: 'REX',                          icon: 'fa-lightbulb',          color: '#F472B6', order: 7  },
    { id: 'tutoriels',   name: 'Tutoriels Vidéo',              icon: 'fa-film',               color: '#F87171', order: 8  },
    { id: 'docs-const',  name: 'Documentation Constructeurs',  icon: 'fa-book',               color: '#34D399', order: 9  },
    { id: 'ressources',  name: 'Ressources Externes',          icon: 'fa-globe',              color: '#22D3EE', order: 10 },
  ];

  // Catégories virtuelles (non stockées dans Firestore)
  const _VIRTUAL_ALL     = { id: 'all',      icon: 'fa-layer-group', name: 'Tous les articles', color: 'var(--text2)', virtual: true };
  const _VIRTUAL_FAVS    = { id: 'favoris',  icon: 'fa-star',        name: 'Favoris',           color: '#FBBF24',      virtual: true };
  const _VIRTUAL_ARCH    = { id: 'archives', icon: 'fa-box-archive', name: 'Archives',          color: '#6B7280',      virtual: true };

  function _getDynCats() {
    const sorted = [..._categories].filter(c => !c.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
    return [_VIRTUAL_ALL, ...sorted, _VIRTUAL_FAVS, _VIRTUAL_ARCH];
  }

  // ── CONTENT TYPES / STATUS META ──
  const CONTENT_TYPES = [
    { id: 'depannage', l: 'Dépannage',         icon: 'fa-screwdriver-wrench' },
    { id: 'procedure', l: 'Procédure',         icon: 'fa-clipboard-list' },
    { id: 'tutoriel',  l: 'Tutoriel',          icon: 'fa-graduation-cap' },
    { id: 'doc',       l: 'Documentation',     icon: 'fa-file-alt' },
    { id: 'rex',       l: 'REX',               icon: 'fa-lightbulb' },
    { id: 'ressource', l: 'Ressource externe', icon: 'fa-globe' },
    { id: 'galerie',   l: 'Galerie photo',     icon: 'fa-images' },
    { id: 'dossier',   l: 'Dossier technique', icon: 'fa-folder-open' },
  ];

  const STATUS_META = {
    draft:     { l: 'Brouillon',  cls: 'bl-s-draft',     icon: 'fa-pencil' },
    pending:   { l: 'En attente', cls: 'bl-s-pending',   icon: 'fa-clock' },
    published: { l: 'Publié',     cls: 'bl-s-published', icon: 'fa-check-circle' },
    archived:  { l: 'Archivé',   cls: 'bl-s-archived',  icon: 'fa-box-archive' },
  };

  // ── PERMISSIONS ──
  function _role()         { const a=MX.state.adminUser,c=MX.state.currentUser; return a?'admin':c&&c.role==='responsable'?'validateur':c?'contributeur':'lecteur'; }
  function _canEdit()      { const r=_role(); return r==='admin'||r==='validateur'||r==='contributeur'; }
  function _canValid()     { const r=_role(); return r==='admin'||r==='validateur'; }
  function _canAdmin()     { return _role()==='admin'; }
  function _canManageCats(){ const r=_role(); return r==='admin'||r==='validateur'; }
  function _author()       { const a=MX.state.adminUser,c=MX.state.currentUser; return a?(a.email?a.email.split('@')[0]:'Admin'):c?c.name:'Anonyme'; }

  // ── MIGRATION ──
  async function _migrateDefaultCategories() {
    if (_migrationDone) return;
    _migrationDone = true;
    for (const cat of _DEFAULT_CATS) {
      try {
        await MX.DB.addBibleCategory({ id: cat.id, name: cat.name, icon: cat.icon, color: cat.color, description: '', order: cat.order, createdBy: 'migration' });
      } catch(e) { /* ignore */ }
    }
  }

  // ── VIDEO ──
  function _parseVideo(url) {
    if (!url) return null;
    let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (m) return { type:'youtube', id:m[1], thumb:`https://img.youtube.com/vi/${m[1]}/mqdefault.jpg`, embed:`https://www.youtube.com/embed/${m[1]}?rel=0` };
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) return { type:'vimeo', id:m[1], embed:`https://player.vimeo.com/video/${m[1]}` };
    m = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    if (m) return { type:'dailymotion', id:m[1], embed:`https://www.dailymotion.com/embed/video/${m[1]}` };
    return null;
  }

  function _videoPreviewHtml(url) {
    const v = _parseVideo(url);
    if (!v) return '<div class="bl-video-no-match">URL non reconnue — format YouTube, Vimeo ou Dailymotion attendu</div>';
    const thumb = v.thumb ? `<img src="${v.thumb}" class="bl-vp-thumb" loading="lazy" alt="Miniature">` : '';
    return `<div class="bl-video-preview-inner"><i class="fas fa-check-circle" style="color:var(--green)"></i> Vidéo <strong>${v.type}</strong> détectée${thumb}</div>`;
  }

  // ── FILTER ──
  function _filtered() {
    const me = _author();
    let items = [..._articles];
    if (_selectedCategory === 'favoris') {
      items = items.filter(a => (a.likes||[]).includes(me));
    } else if (_selectedCategory === 'archives') {
      items = items.filter(a => a.status === 'archived');
    } else {
      if (_selectedCategory !== 'all') items = items.filter(a => a.category === _selectedCategory);
      items = items.filter(a => a.status !== 'archived');
    }
    if (_selectedTag) items = items.filter(a => (a.tags||[]).includes(_selectedTag));
    if (_searchQuery.trim()) {
      const q = _searchQuery.toLowerCase().trim();
      items = items.filter(a =>
        (a.title||'').toLowerCase().includes(q) ||
        (a.content||'').toLowerCase().includes(q) ||
        (a.authorName||'').toLowerCase().includes(q) ||
        (a.tags||[]).some(t => t.toLowerCase().includes(q))
      );
    }
    const r = _role();
    if (r !== 'admin' && r !== 'validateur') {
      const me2 = _author();
      items = items.filter(a => a.status === 'published' || a.authorName === me2);
    }
    return items;
  }

  function _allTags() {
    const s = new Set();
    _articles.forEach(a => (a.tags||[]).forEach(t => s.add(t)));
    return [...s].sort();
  }

  function _truncate(s, n) { return s.length > n ? s.substring(0,n)+'…' : s; }

  // ── CONTENT RENDERING ──
  function _renderContent(text) {
    return MX.esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="bl-inline-code">$1</code>')
      .replace(/\n/g, '<br>');
  }

  // ── LIST VIEW ──
  function _renderList(mc) {
    const filtered    = _filtered();
    const allCats     = _getDynCats();
    const catObj      = allCats.find(c => c.id === _selectedCategory) || allCats[0];
    const me          = _author();
    const canManage   = _canManageCats();

    const counts = {};
    _articles.forEach(a => { if (a.status !== 'archived') counts[a.category] = (counts[a.category]||0)+1; });

    const catNav = allCats.map(c => {
      const cnt = c.id==='all'      ? _articles.filter(a=>a.status!=='archived').length
                : c.id==='favoris'  ? _articles.filter(a=>(a.likes||[]).includes(me)).length
                : c.id==='archives' ? _articles.filter(a=>a.status==='archived').length
                : (counts[c.id]||0);
      const editBtn = (canManage && !c.virtual)
        ? `<button class="bl-cat-edit" title="Modifier" onclick="event.stopPropagation();MX.Pages.Bible._openCatModal('${MX.esc(c.id)}')"><i class="fas fa-pen"></i></button>`
        : '';
      return `<button class="bl-cat-item${_selectedCategory===c.id?' active':''}" onclick="MX.Pages.Bible._setCat('${MX.esc(c.id)}')">
        <i class="fas ${MX.esc(c.icon)}" style="color:${MX.esc(c.color)};width:16px;text-align:center;flex-shrink:0"></i>
        <span class="bl-cat-label">${MX.esc(c.name)}</span>
        ${cnt>0?`<span class="bl-cat-count">${cnt}</span>`:''}
        ${editBtn}
      </button>`;
    }).join('');

    const addCatBtn = canManage
      ? `<button class="bl-cat-add" onclick="MX.Pages.Bible._openCatModal(null)"><i class="fas fa-plus"></i> Nouvelle catégorie</button>`
      : '';

    const tags = _allTags();
    const tagCloud = tags.length ? `<div class="bl-sidebar-sec"><div class="bl-sidebar-title">Tags populaires</div><div class="bl-tag-cloud">
      ${tags.slice(0,25).map(t=>`<button class="bl-tag${_selectedTag===t?' active':''}" onclick="MX.Pages.Bible._setTag('${MX.esc(t)}')">#${MX.esc(t)}</button>`).join('')}
    </div></div>` : '';

    const grid = filtered.length === 0
      ? `<div class="bl-empty"><i class="fas fa-book-open"></i><div class="bl-empty-title">Aucun article trouvé</div><div class="bl-empty-sub">Essayez de modifier votre recherche ou de changer de catégorie.</div>
          ${_canEdit()?`<button class="primary-btn" onclick="MX.Pages.Bible._newArticle()" style="margin-top:12px"><i class="fas fa-plus"></i> Créer le premier article</button>`:''}</div>`
      : filtered.map(_articleCard).join('');

    mc.innerHTML = `
      <div class="ph bl-page">
        <div class="bl-header">
          <div class="bl-brand">
            <div class="bl-brand-icon"><i class="fas fa-book"></i></div>
            <div>
              <div class="bl-brand-title">Bible Maintix</div>
              <div class="bl-brand-sub">La mémoire technique de votre entreprise</div>
            </div>
          </div>
          <div class="bl-header-actions">
            ${_canAdmin()?`<button class="bl-admin-btn" onclick="MX.Pages.Bible._showAdmin()"><i class="fas fa-chart-bar"></i> <span class="bl-btn-label">Tableau de bord</span></button>`:''}
            ${_canEdit()?`<button class="primary-btn bl-new-btn" onclick="MX.Pages.Bible._newArticle()"><i class="fas fa-plus"></i> <span class="bl-btn-label">Nouvel article</span></button>`:''}
          </div>
        </div>

        <div class="bl-search-bar">
          <i class="fas fa-magnifying-glass bl-search-icon"></i>
          <input type="text" class="bl-search-input" placeholder="Rechercher un article, tag, auteur…" value="${MX.esc(_searchQuery)}" oninput="MX.Pages.Bible._onSearch(this.value)">
          ${_searchQuery?`<button class="bl-search-clear" onclick="MX.Pages.Bible._clearSearch()"><i class="fas fa-times"></i></button>`:''}
        </div>

        <div class="bl-layout">
          <aside class="bl-sidebar">
            <div class="bl-sidebar-sec">
              <div class="bl-sidebar-title">Catégories</div>
              <nav class="bl-cat-nav">${catNav}</nav>
              ${addCatBtn}
            </div>
            ${tagCloud}
          </aside>

          <div class="bl-content">
            <div class="bl-content-head">
              <div class="bl-result-info">
                <span class="bl-cat-cur"><i class="fas ${MX.esc(catObj.icon)}" style="color:${MX.esc(catObj.color)}"></i> ${MX.esc(catObj.name)}</span>
                <span class="bl-result-count">${filtered.length} article${filtered.length!==1?'s':''}</span>
              </div>
              ${_selectedTag?`<button class="bl-tag active" onclick="MX.Pages.Bible._setTag(null)" title="Effacer le filtre tag"><i class="fas fa-times"></i> #${MX.esc(_selectedTag)}</button>`:''}
            </div>
            <div class="bl-articles-grid">${grid}</div>
          </div>
        </div>

        ${_canEdit()?`<button class="bl-fab" onclick="MX.Pages.Bible._newArticle()" title="Nouvel article"><i class="fas fa-plus"></i></button>`:''}
      </div>`;
  }

  function _articleCard(a) {
    const cat    = _getDynCats().find(c=>c.id===a.category);
    const type   = CONTENT_TYPES.find(t=>t.id===a.type);
    const status = STATUS_META[a.status] || STATUS_META.draft;
    const video  = _parseVideo(a.videoUrl);
    const nc       = MX.userColors(a.authorName||'');
    const initials = (a.authorName||'?').substring(0,2).toUpperCase();
    const _blBdg   = MX.badgeBorder ? MX.badgeBorder(a.authorName||'') : null;

    const thumb = video && video.thumb
      ? `<div class="bl-card-thumb" style="background-image:url('${video.thumb}')"><div class="bl-card-play"><i class="fas fa-play"></i></div></div>`
      : '';
    const tags = (a.tags||[]).slice(0,4).map(t=>
      `<button class="bl-tag sm" onclick="event.stopPropagation();MX.Pages.Bible._setTag('${MX.esc(t)}')">#${MX.esc(t)}</button>`
    ).join('');

    return `<div class="bl-article-card" onclick="MX.Pages.Bible._openArticle('${a.id}')">
      ${thumb}
      <div class="bl-card-body">
        <div class="bl-card-meta">
          ${cat&&!cat.virtual?`<span class="bl-cat-badge" style="color:${MX.esc(cat.color)}"><i class="fas ${MX.esc(cat.icon)}"></i> ${MX.esc(cat.name)}</span>`:''}
          ${type?`<span class="bl-type-badge"><i class="fas ${type.icon}"></i> ${MX.esc(type.l)}</span>`:''}
          <span class="bl-status-badge ${status.cls}"><i class="fas ${status.icon}"></i> ${status.l}</span>
        </div>
        <div class="bl-card-title">${MX.esc(a.title||'Sans titre')}</div>
        <div class="bl-card-preview">${MX.esc(_truncate(a.content||'',110))}</div>
        ${tags?`<div class="bl-card-tags">${tags}</div>`:''}
        <div class="bl-card-footer">
          <div class="bl-card-author">
            <div class="bl-mini-avatar" style="background:${nc.bg};color:${nc.fg}${_blBdg?';border:2px solid '+_blBdg:''}">${MX.esc(initials)}</div>
            <span>${MX.badgeTag ? MX.badgeTag(a.authorName||'') : ''}${MX.esc(a.authorName||'Anonyme')}</span>
          </div>
          <div class="bl-card-stats">
            ${(a.viewCount)?`<span><i class="fas fa-eye"></i> ${a.viewCount}</span>`:''}
            ${(a.likes||[]).length?`<span><i class="fas fa-heart"></i> ${(a.likes||[]).length}</span>`:''}
          </div>
          <div class="bl-card-date">${MX.fmtTime(a.updatedAt||a.createdAt)}</div>
        </div>
      </div>
    </div>`;
  }

  // ── DETAIL VIEW ──
  function _renderDetail(mc) {
    const a = _currentArticle;
    if (!a) { _view='list'; _renderList(mc); return; }

    const cat    = _getDynCats().find(c=>c.id===a.category);
    const type   = CONTENT_TYPES.find(t=>t.id===a.type);
    const status = STATUS_META[a.status] || STATUS_META.draft;
    const video  = _parseVideo(a.videoUrl);
    const me     = _author();
    const nc     = MX.userColors(a.authorName||'');
    const isLiked = (a.likes||[]).includes(me);
    const isAuthor = a.authorName === me;

    const videoHtml = video ? `<div class="bl-video-wrap">
      <div class="bl-video-header"><i class="fas fa-film"></i> Vidéo associée</div>
      <div class="bl-video-container">
        <iframe src="${video.embed}" frameborder="0" allowfullscreen loading="lazy" class="bl-video-iframe"></iframe>
      </div>
    </div>` : '';

    const linksHtml = (a.externalLinks||[]).length ? `<div class="bl-links-section">
      <div class="bl-section-title"><i class="fas fa-external-link-alt"></i> Liens externes</div>
      <div class="bl-links-grid">
        ${(a.externalLinks||[]).map(l=>`<a href="${MX.esc(l.url)}" target="_blank" rel="noopener noreferrer" class="bl-ext-link">
          <i class="fas fa-link bl-ext-icon"></i>
          <div class="bl-ext-body"><div class="bl-ext-label">${MX.esc(l.label||l.url)}</div>${l.desc?`<div class="bl-ext-desc">${MX.esc(l.desc)}</div>`:''}</div>
          <i class="fas fa-external-link-alt bl-ext-arr"></i>
        </a>`).join('')}
      </div>
    </div>` : '';

    const TRANSITIONS = {
      draft:     [{ to:'pending',   l:'Soumettre pour validation', cls:'primary-btn' }],
      pending:   _canValid() ? [{ to:'published', l:'Publier', cls:'primary-btn' }, { to:'draft', l:'Retour brouillon', cls:'cancel' }] : [],
      published: _canValid() ? [{ to:'archived',  l:'Archiver', cls:'cancel' }] : [],
      archived:  _canValid() ? [{ to:'published', l:'Republier', cls:'primary-btn' }] : [],
    };
    const wfBtns = ((isAuthor||_canValid()) ? (TRANSITIONS[a.status]||[]) : [])
      .map(t=>`<button class="modal-btn ${t.cls}" onclick="MX.Pages.Bible._setStatus('${a.id}','${t.to}')">${MX.esc(t.l)}</button>`)
      .join('');

    const tagsHtml = (a.tags||[]).map(t=>
      `<button class="bl-tag" onclick="MX.Pages.Bible._backToListWithTag('${MX.esc(t)}')">#${MX.esc(t)}</button>`
    ).join('');

    const cmts = _buildCommentsHtml(me);

    mc.innerHTML = `
      <div class="ph bl-detail-page">
        <div class="bl-detail-nav">
          <button class="bl-back-btn" onclick="MX.Pages.Bible._backToList()"><i class="fas fa-arrow-left"></i> Retour</button>
          <div class="bl-detail-actions">
            ${(isAuthor||_canValid())?`<button class="dh-btn" onclick="MX.Pages.Bible._editArticle('${a.id}')" title="Modifier l'article"><i class="fas fa-pencil"></i></button>`:''}
            ${_canAdmin()?`<button class="dh-btn" style="color:var(--red)" onclick="MX.Pages.Bible._confirmDelete('${a.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`:''}
          </div>
        </div>

        <div class="bl-detail-header">
          <div class="bl-detail-badges">
            ${cat&&!cat.virtual?`<span class="bl-cat-badge lg" style="color:${MX.esc(cat.color)}"><i class="fas ${MX.esc(cat.icon)}"></i> ${MX.esc(cat.name)}</span>`:''}
            ${type?`<span class="bl-type-badge lg"><i class="fas ${type.icon}"></i> ${MX.esc(type.l)}</span>`:''}
            <span class="bl-status-badge ${status.cls}"><i class="fas ${status.icon}"></i> ${status.l}</span>
          </div>
          <h1 class="bl-detail-title">${MX.esc(a.title||'Sans titre')}</h1>
          <div class="bl-detail-info">
            <div class="bl-detail-author">
              <div class="bl-author-avatar" style="background:${nc.bg};color:${nc.fg}">${(a.authorName||'?').substring(0,2).toUpperCase()}</div>
              <div>
                <div class="bl-author-name">${MX.esc(a.authorName||'Anonyme')}</div>
                <div class="bl-detail-date">Modifié ${MX.fmtTime(a.updatedAt||a.createdAt)}</div>
              </div>
            </div>
            <div class="bl-detail-stats">
              <button class="bl-like-btn${isLiked?' active':''}" onclick="MX.Pages.Bible._toggleLike('${a.id}')">
                <i class="fas fa-heart"></i> <span id="bl-like-count">${(a.likes||[]).length||''}</span>
              </button>
              <span class="bl-view-count"><i class="fas fa-eye"></i> ${a.viewCount||0}</span>
            </div>
          </div>
          ${wfBtns?`<div class="bl-workflow">${wfBtns}</div>`:''}
        </div>

        ${videoHtml}
        <div class="bl-detail-content">${_renderContent(a.content||'')}</div>
        ${linksHtml}
        ${tagsHtml?`<div class="bl-detail-tags">${tagsHtml}</div>`:''}

        <div class="bl-comments-section">
          <div class="bl-section-title"><i class="fas fa-comments"></i> Commentaires (<span id="bl-cmt-count">${_comments.length}</span>)</div>
          <div class="bl-comments-list" id="bl-comments-list">${cmts}</div>
          <div class="bl-comment-form">
            <textarea class="fi bl-comment-input" id="bl-comment-input" placeholder="Ajouter un commentaire…" rows="3"></textarea>
            <button class="primary-btn" onclick="MX.Pages.Bible._submitComment('${a.id}')"><i class="fas fa-paper-plane"></i> Envoyer</button>
          </div>
        </div>
      </div>`;
  }

  function _buildCommentsHtml(me) {
    if (!_comments.length) return `<div class="bl-no-comments"><i class="fas fa-comment-slash"></i> Aucun commentaire — soyez le premier !</div>`;
    return _comments.map(c => {
      const cnc = MX.userColors(c.authorName||'');
      const canDel = _canAdmin() || c.authorName === me;
      return `<div class="bl-comment">
        <div class="bl-comment-avatar" style="background:${cnc.bg};color:${cnc.fg}">${(c.authorName||'?').substring(0,2).toUpperCase()}</div>
        <div class="bl-comment-body">
          <div class="bl-comment-header">
            <span class="bl-comment-author">${MX.esc(c.authorName||'Anonyme')}</span>
            <span class="bl-comment-date">${MX.fmtTime(c.createdAt)}</span>
            ${canDel?`<button class="bl-comment-del" onclick="MX.Pages.Bible._deleteComment('${c.id}')"><i class="fas fa-trash"></i></button>`:''}
          </div>
          <div class="bl-comment-content">${MX.esc(c.content)}</div>
        </div>
      </div>`;
    }).join('');
  }

  // ── EDIT VIEW ──
  function _renderEdit(mc) {
    const a    = _currentArticle || {};
    const isNew = !a.id;

    const sorted = [..._categories].filter(c => !c.archived).sort((a, b) => (a.order||0) - (b.order||0));
    const catOpts = sorted.map(c=>`<option value="${MX.esc(c.id)}"${a.category===c.id?' selected':''}>${MX.esc(c.name)}</option>`).join('');
    const typeOpts = CONTENT_TYPES
      .map(t=>`<option value="${t.id}"${a.type===t.id?' selected':''}>${MX.esc(t.l)}</option>`).join('');
    const statusOpts = Object.entries(STATUS_META)
      .filter(([k])=>_canValid()||k==='draft'||k==='pending')
      .map(([k,v])=>`<option value="${k}"${(a.status||'draft')===k?' selected':''}>${MX.esc(v.l)}</option>`).join('');

    mc.innerHTML = `
      <div class="ph bl-edit-page">
        <div class="bl-detail-nav">
          <button class="bl-back-btn" onclick="MX.Pages.Bible._cancelEdit()"><i class="fas fa-arrow-left"></i> Annuler</button>
          <h2 class="bl-edit-title">${isNew?'Nouvel article':'Modifier l\'article'}</h2>
        </div>

        <div class="bl-edit-form">
          <div class="stt-card">
            <div class="stt-card-title">Informations générales</div>
            <div class="form-group">
              <label>Titre *</label>
              <input type="text" class="fi" id="bl-f-title" placeholder="Titre de l'article" value="${MX.esc(a.title||'')}" maxlength="140">
            </div>
            <div class="bl-edit-row2">
              <div class="form-group">
                <label>Catégorie *</label>
                <select class="fi" id="bl-f-cat"><option value="">— Choisir —</option>${catOpts}</select>
              </div>
              <div class="form-group">
                <label>Type de contenu</label>
                <select class="fi" id="bl-f-type">${typeOpts}</select>
              </div>
            </div>
            <div class="form-group">
              <label>Statut</label>
              <select class="fi" id="bl-f-status">${statusOpts}</select>
            </div>
          </div>

          <div class="stt-card">
            <div class="stt-card-title">Contenu</div>
            <div class="bl-edit-hints">
              Astuce : <code class="bl-inline-code">**texte**</code> pour gras, <code class="bl-inline-code">\`code\`</code> pour code en ligne
            </div>
            <div class="form-group">
              <label>Contenu *</label>
              <textarea class="fi bl-content-area" id="bl-f-content" rows="16" placeholder="Rédigez le contenu de l'article…">${MX.esc(a.content||'')}</textarea>
            </div>
          </div>

          <div class="stt-card">
            <div class="stt-card-title">Vidéo associée</div>
            <div class="form-group">
              <label>URL vidéo (YouTube, Vimeo, Dailymotion)</label>
              <input type="url" class="fi" id="bl-f-video" placeholder="https://www.youtube.com/watch?v=…" value="${MX.esc(a.videoUrl||'')}" oninput="MX.Pages.Bible._previewVideo(this.value)">
              <div id="bl-video-preview" class="bl-video-preview-box">${a.videoUrl?_videoPreviewHtml(a.videoUrl):''}</div>
            </div>
          </div>

          <div class="stt-card">
            <div class="stt-card-title">Liens externes</div>
            <div id="bl-links-list" class="bl-links-edit-list"></div>
            <div class="bl-add-link-row">
              <input type="text" class="fi" id="bl-link-label" placeholder="Libellé" style="flex:1;min-width:0">
              <input type="url"  class="fi" id="bl-link-url"   placeholder="https://…" style="flex:2;min-width:0">
              <button class="modal-btn primary-btn bl-add-link-btn" onclick="MX.Pages.Bible._addLink()"><i class="fas fa-plus"></i></button>
            </div>
          </div>

          <div class="stt-card">
            <div class="stt-card-title">Tags</div>
            <div class="bl-tag-input-wrap">
              <div id="bl-tags-list" class="bl-tags-current"></div>
              <div class="bl-tag-add-row">
                <input type="text" class="fi bl-tag-input" id="bl-f-tag" placeholder="Ajouter un tag…" onkeydown="if(event.key==='Enter'){event.preventDefault();MX.Pages.Bible._addTag();}">
                <button class="modal-btn cancel bl-add-link-btn" onclick="MX.Pages.Bible._addTag()"><i class="fas fa-plus"></i></button>
              </div>
            </div>
          </div>

          <div class="bl-edit-actions">
            <button class="modal-btn cancel" onclick="MX.Pages.Bible._cancelEdit()">Annuler</button>
            <button class="primary-btn" onclick="MX.Pages.Bible._saveArticle()"><i class="fas fa-save"></i> ${isNew?'Créer l\'article':'Enregistrer'}</button>
          </div>
        </div>
      </div>`;

    _editLinks = JSON.parse(JSON.stringify(a.externalLinks||[]));
    _editTags  = JSON.parse(JSON.stringify(a.tags||[]));
    _renderEditLinks();
    _renderEditTags();
  }

  function _renderEditLinks() {
    const el = document.getElementById('bl-links-list');
    if (!el) return;
    el.innerHTML = _editLinks.length
      ? _editLinks.map((l,i)=>`<div class="bl-link-edit-item">
          <i class="fas fa-link" style="color:var(--text3)"></i>
          <span class="bl-link-edit-label">${MX.esc(l.label||l.url)}</span>
          <span class="bl-link-edit-url">${MX.esc(l.url)}</span>
          <button class="bl-comment-del" onclick="MX.Pages.Bible._removeLink(${i})"><i class="fas fa-times"></i></button>
        </div>`).join('')
      : `<div class="bl-empty-links">Aucun lien ajouté</div>`;
  }

  function _renderEditTags() {
    const el = document.getElementById('bl-tags-list');
    if (!el) return;
    el.innerHTML = _editTags.map((t,i)=>
      `<span class="bl-tag active">#${MX.esc(t)} <button class="bl-tag-rm" onclick="MX.Pages.Bible._removeTag(${i})"><i class="fas fa-times"></i></button></span>`
    ).join('');
  }

  // ── ADMIN VIEW ──
  function _renderAdmin(mc) {
    const total     = _articles.length;
    const published = _articles.filter(a=>a.status==='published').length;
    const pending   = _articles.filter(a=>a.status==='pending').length;
    const draft     = _articles.filter(a=>a.status==='draft').length;
    const archived  = _articles.filter(a=>a.status==='archived').length;

    const byCat = {};
    _articles.forEach(a=>{ byCat[a.category]=(byCat[a.category]||0)+1; });

    const catStats = _categories
      .filter(c=>(byCat[c.id]||0)>0)
      .sort((a,b)=>(byCat[b.id]||0)-(byCat[a.id]||0))
      .map(c=>`<div class="bl-stat-row"><i class="fas ${MX.esc(c.icon)}" style="color:${MX.esc(c.color)};width:16px;text-align:center"></i><span>${MX.esc(c.name)}</span><span class="bl-stat-val">${byCat[c.id]||0}</span></div>`).join('');

    const byAuthor = {};
    _articles.forEach(a=>{ byAuthor[a.authorName||'Anonyme']=(byAuthor[a.authorName||'Anonyme']||0)+1; });
    const authorStats = Object.entries(byAuthor).sort((a,b)=>b[1]-a[1]).slice(0,8)
      .map(([name,cnt])=>{
        const nc=MX.userColors(name);
        return `<div class="bl-stat-row"><div class="bl-mini-avatar" style="background:${nc.bg};color:${nc.fg}">${name.substring(0,2).toUpperCase()}</div><span>${MX.esc(name)}</span><span class="bl-stat-val">${cnt}</span></div>`;
      }).join('');

    const recent = [..._articles].sort((a,b)=>{
      const ta=a.updatedAt?(a.updatedAt.toMillis?a.updatedAt.toMillis():a.updatedAt.seconds*1000):0;
      const tb=b.updatedAt?(b.updatedAt.toMillis?b.updatedAt.toMillis():b.updatedAt.seconds*1000):0;
      return tb-ta;
    }).slice(0,6).map(a=>{
      const s=STATUS_META[a.status]||STATUS_META.draft;
      return `<div class="bl-stat-row bl-stat-link" onclick="MX.Pages.Bible._openArticle('${a.id}')">
        <span class="bl-status-badge ${s.cls}" style="font-size:10px"><i class="fas ${s.icon}"></i></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MX.esc(a.title||'Sans titre')}</span>
        <span style="color:var(--text3);font-size:11px;white-space:nowrap">${MX.fmtTime(a.updatedAt||a.createdAt)}</span>
      </div>`;
    }).join('');

    const pendingList = _articles.filter(a=>a.status==='pending');

    // Gestion catégories (admin/responsable seulement)
    const allSorted   = [..._categories].sort((a, b) => (a.order||0) - (b.order||0));
    const activeCats  = allSorted.filter(c => !c.archived);
    const archivedCats = allSorted.filter(c => c.archived);

    const catMgmtRows = activeCats.map((c, idx) => `
      <div class="bl-cat-mgmt-row">
        <div class="bl-cat-mgmt-arrows">
          ${idx > 0 ? `<button class="bl-cat-ord-btn" title="Monter" onclick="MX.Pages.Bible._moveCatUp('${MX.esc(c.id)}')"><i class="fas fa-chevron-up"></i></button>` : '<span class="bl-cat-ord-btn" style="visibility:hidden"></span>'}
          ${idx < activeCats.length-1 ? `<button class="bl-cat-ord-btn" title="Descendre" onclick="MX.Pages.Bible._moveCatDown('${MX.esc(c.id)}')"><i class="fas fa-chevron-down"></i></button>` : '<span class="bl-cat-ord-btn" style="visibility:hidden"></span>'}
        </div>
        <i class="fas ${MX.esc(c.icon)}" style="color:${MX.esc(c.color)};width:16px;text-align:center;flex-shrink:0"></i>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MX.esc(c.name)}</span>
        ${c.description ? `<span style="font-size:11px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MX.esc(c.description)}</span>` : ''}
        <span class="bl-stat-val">${byCat[c.id]||0} art.</span>
        <button class="bl-cat-edit-btn" title="Modifier" onclick="MX.Pages.Bible._openCatModal('${MX.esc(c.id)}')"><i class="fas fa-pen"></i></button>
      </div>`).join('');

    const archivedRows = archivedCats.map(c => `
      <div class="bl-cat-mgmt-row bl-cat-mgmt-row--archived">
        <i class="fas ${MX.esc(c.icon)}" style="color:var(--text3);width:16px;text-align:center;flex-shrink:0"></i>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text3)">${MX.esc(c.name)}</span>
        <span class="bl-stat-val">${byCat[c.id]||0} art.</span>
        <button class="bl-cat-restore-btn" title="Restaurer la catégorie" onclick="MX.Pages.Bible._restoreCat('${MX.esc(c.id)}')"><i class="fas fa-rotate-left"></i> Restaurer</button>
        <button class="bl-cat-edit-btn" title="Modifier / Supprimer" onclick="MX.Pages.Bible._openCatModal('${MX.esc(c.id)}')"><i class="fas fa-pen"></i></button>
      </div>`).join('');

    const archivedSection = archivedCats.length ? `
      <div style="margin-top:14px">
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">
          <i class="fas fa-box-archive" style="margin-right:4px"></i> Archivées (${archivedCats.length})
        </div>
        <div class="bl-cat-mgmt-list">${archivedRows}</div>
      </div>` : '';

    mc.innerHTML = `
      <div class="ph bl-admin-page">
        <div class="bl-detail-nav">
          <button class="bl-back-btn" onclick="MX.Pages.Bible._backToList()"><i class="fas fa-arrow-left"></i> Retour</button>
          <h2 class="bl-edit-title">Tableau de bord Bible</h2>
        </div>

        <div class="bl-kpi-row">
          <div class="bl-kpi-card"><div class="bl-kpi-val">${total}</div><div class="bl-kpi-label">Total</div></div>
          <div class="bl-kpi-card bl-kpi-pub"><div class="bl-kpi-val">${published}</div><div class="bl-kpi-label">Publiés</div></div>
          <div class="bl-kpi-card bl-kpi-pend"><div class="bl-kpi-val">${pending}</div><div class="bl-kpi-label">En attente</div></div>
          <div class="bl-kpi-card bl-kpi-draft"><div class="bl-kpi-val">${draft}</div><div class="bl-kpi-label">Brouillons</div></div>
          <div class="bl-kpi-card bl-kpi-arch"><div class="bl-kpi-val">${archived}</div><div class="bl-kpi-label">Archivés</div></div>
        </div>

        ${pendingList.length?`<div class="stt-card" style="border-color:var(--orange)">
          <div class="stt-card-title" style="color:var(--orange)"><i class="fas fa-clock"></i> En attente de validation (${pendingList.length})</div>
          <div class="bl-stats-list">${pendingList.map(a=>`<div class="bl-stat-row bl-stat-link" onclick="MX.Pages.Bible._openArticle('${a.id}')">
            <span style="flex:1">${MX.esc(a.title||'Sans titre')}</span>
            <span style="color:var(--text3);font-size:11px">${MX.esc(a.authorName||'')}</span>
            <button class="primary-btn" style="padding:4px 10px;font-size:11px;flex-shrink:0" onclick="event.stopPropagation();MX.Pages.Bible._setStatus('${a.id}','published')">Publier</button>
          </div>`).join('')}</div>
        </div>`:''}

        <div class="bl-admin-grid">
          <div class="stt-card">
            <div class="stt-card-title">Par catégorie</div>
            <div class="bl-stats-list">${catStats||'<div style="color:var(--text3);font-size:13px">Aucun article</div>'}</div>
          </div>
          <div class="stt-card">
            <div class="stt-card-title">Par auteur</div>
            <div class="bl-stats-list">${authorStats||'<div style="color:var(--text3);font-size:13px">Aucun auteur</div>'}</div>
          </div>
          <div class="stt-card">
            <div class="stt-card-title">Activité récente</div>
            <div class="bl-stats-list">${recent||'<div style="color:var(--text3);font-size:13px">Aucune activité</div>'}</div>
          </div>
        </div>

        <div class="stt-card">
          <div class="stt-card-title" style="display:flex;align-items:center;justify-content:space-between">
            <span><i class="fas fa-tags"></i> Gestion des catégories (${activeCats.length} active${activeCats.length!==1?'s':''}${archivedCats.length?` · ${archivedCats.length} archivée${archivedCats.length!==1?'s':''}`:''} )</span>
            <button class="bl-cat-add-sm" onclick="MX.Pages.Bible._openCatModal(null)"><i class="fas fa-plus"></i> Nouvelle</button>
          </div>
          <div class="bl-cat-mgmt-list">${catMgmtRows||'<div style="color:var(--text3);font-size:13px;padding:8px 0">Aucune catégorie active</div>'}</div>
          ${archivedSection}
        </div>
      </div>`;
  }

  // ── MAIN RENDER ──
  function render() {
    const mc = document.getElementById('main-content');
    if (!mc) return;

    if (!_unsubCategories) {
      _unsubCategories = MX.DB.listenBibleCategories(list => {
        if (list.length === 0 && !_migrationDone) {
          _migrateDefaultCategories();
        } else {
          _migrationDone = true;
          _categories = list;
          if (MX.state.currentPage === 'documents') render();
        }
      });
    }

    if (!_unsubArticles) {
      _unsubArticles = MX.DB.listenBibleArticles(list => {
        _articles = list;
        if (MX.state.currentPage === 'documents') render();
      });
    }

    if (_view === 'detail' && _currentArticle) return _renderDetail(mc);
    if (_view === 'edit')  return _renderEdit(mc);
    if (_view === 'admin') return _renderAdmin(mc);
    _renderList(mc);
  }

  // ── ACTIONS ──
  function _setCat(id) { _selectedCategory=id; _selectedTag=null; _view='list'; render(); }
  function _setTag(tag) { _selectedTag=tag; _view='list'; render(); }
  function _onSearch(v) { _searchQuery=v; render(); }
  function _clearSearch() { _searchQuery=''; render(); }

  function _openArticle(id) {
    const a = _articles.find(x=>x.id===id);
    if (!a) return;
    _currentArticle = { ...a };
    _comments = [];
    _view = 'detail';
    if (_unsubComments) _unsubComments();
    _unsubComments = MX.DB.listenBibleComments(id, list => {
      _comments = list;
      if (MX.state.currentPage === 'documents' && _view === 'detail' && _currentArticle && _currentArticle.id === id) {
        const me = _author();
        const cl = document.getElementById('bl-comments-list');
        const cc = document.getElementById('bl-cmt-count');
        if (cl) cl.innerHTML = _buildCommentsHtml(me);
        if (cc) cc.textContent = list.length;
      }
    });
    MX.DB.incrementBibleViews(id);
    render();
  }

  function _backToList() {
    _view = 'list'; _currentArticle = null; _comments = [];
    if (_unsubComments) { _unsubComments(); _unsubComments = null; }
    render();
  }
  function _backToListWithTag(tag) { _selectedTag=tag; _backToList(); }

  function _newArticle() {
    _currentArticle = { status:'draft', tags:[], externalLinks:[] };
    _editLinks = []; _editTags = [];
    _view = 'edit'; render();
  }

  function _editArticle(id) {
    const a = _articles.find(x=>x.id===id);
    if (!a) return;
    _currentArticle = { ...a };
    _editLinks = JSON.parse(JSON.stringify(a.externalLinks||[]));
    _editTags  = JSON.parse(JSON.stringify(a.tags||[]));
    _view = 'edit'; render();
  }

  function _cancelEdit() {
    if (_currentArticle && _currentArticle.id) { _view='detail'; }
    else { _view='list'; _currentArticle=null; }
    render();
  }

  async function _saveArticle() {
    const title   = (document.getElementById('bl-f-title')?.value||'').trim();
    const cat     = document.getElementById('bl-f-cat')?.value||'';
    const type    = document.getElementById('bl-f-type')?.value||'';
    const status  = document.getElementById('bl-f-status')?.value||'draft';
    const content = (document.getElementById('bl-f-content')?.value||'').trim();
    const video   = (document.getElementById('bl-f-video')?.value||'').trim();

    if (!title)   { MX.toast('Le titre est obligatoire', true); return; }
    if (!cat)     { MX.toast('Sélectionnez une catégorie', true); return; }
    if (!content) { MX.toast('Le contenu est obligatoire', true); return; }

    const data = {
      title, category:cat, type, status, content,
      videoUrl: video||null,
      externalLinks: _editLinks,
      tags: _editTags,
      authorName: _author(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      MX.syncStart();
      if (_currentArticle && _currentArticle.id) {
        await MX.DB.updateBibleArticle(_currentArticle.id, data);
        MX.toast('Article mis à jour');
      } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        data.viewCount = 0;
        data.likes = [];
        await MX.DB.addBibleArticle(data);
        MX.toast('Article créé');
      }
      MX.syncEnd();
      _view = 'list'; _currentArticle = null; render();
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur lors de la sauvegarde', true);
    }
  }

  function _confirmDelete(id) {
    const a = _articles.find(x=>x.id===id);
    MX.showModal({
      title: 'Supprimer cet article ?',
      sub: `<span style="color:var(--red)">"${MX.esc(a?a.title:'')}"</span> — cette action est irréversible.`,
      actions: [
        { label:'Supprimer', cls:'danger', fn: async ()=>{ try { await MX.DB.deleteBibleArticle(id); MX.toast('Article supprimé'); _backToList(); } catch(e){ MX.toast('Erreur',true); } }},
        { label:'Annuler', cls:'cancel' }
      ]
    });
  }

  async function _setStatus(id, status) {
    const msgs = { published:'Article publié', archived:'Article archivé', draft:'Retour en brouillon', pending:'Soumis pour validation' };
    try {
      await MX.DB.updateBibleArticle(id, { status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (_currentArticle && _currentArticle.id===id) { _currentArticle.status=status; }
      const a = _articles.find(x=>x.id===id);
      if (a) a.status = status;
      MX.toast(msgs[status]||'Statut mis à jour');
      render();
    } catch(e) { MX.toast('Erreur', true); }
  }

  async function _toggleLike(id) {
    const me = _author();
    if (me==='Anonyme') { MX.toast('Connectez-vous pour aimer un article', true); return; }
    const a = _articles.find(x=>x.id===id);
    if (!a) return;
    const liked = (a.likes||[]).includes(me);
    try {
      await MX.DB.toggleBibleLike(id, me, liked);
      if (!liked) {
        a.likes = [...(a.likes||[]), me];
        if (_currentArticle && _currentArticle.id===id) _currentArticle.likes = a.likes;
      } else {
        a.likes = (a.likes||[]).filter(x=>x!==me);
        if (_currentArticle && _currentArticle.id===id) _currentArticle.likes = a.likes;
      }
      const btn = document.querySelector('.bl-like-btn');
      if (btn) {
        btn.classList.toggle('active', !liked);
        const cnt = document.getElementById('bl-like-count');
        if (cnt) cnt.textContent = (a.likes||[]).length||'';
      }
    } catch(e) { MX.toast('Erreur', true); }
  }

  async function _submitComment(articleId) {
    const inp = document.getElementById('bl-comment-input');
    if (!inp) return;
    const content = inp.value.trim();
    if (!content) return;
    const me = _author();
    if (me==='Anonyme') { MX.toast('Connectez-vous pour commenter', true); return; }
    const btn = inp.nextElementSibling;
    if (btn) btn.disabled = true;
    try {
      await MX.DB.addBibleComment({ articleId, content, authorName: me });
      inp.value = '';
      MX.toast('Commentaire ajouté');
    } catch(e) { MX.toast('Erreur lors de l\'envoi', true); }
    finally { if (btn) btn.disabled = false; }
  }

  async function _deleteComment(cid) {
    try { await MX.DB.deleteBibleComment(cid); MX.toast('Commentaire supprimé'); }
    catch(e) { MX.toast('Erreur', true); }
  }

  function _addLink() {
    const label = (document.getElementById('bl-link-label')?.value||'').trim();
    const url   = (document.getElementById('bl-link-url')?.value||'').trim();
    if (!url) { MX.toast('URL requise', true); return; }
    try { new URL(url); } catch(e) { MX.toast('URL invalide', true); return; }
    _editLinks.push({ label: label||url, url });
    document.getElementById('bl-link-label').value = '';
    document.getElementById('bl-link-url').value   = '';
    _renderEditLinks();
  }

  function _removeLink(i) { _editLinks.splice(i,1); _renderEditLinks(); }

  function _addTag() {
    const inp = document.getElementById('bl-f-tag');
    if (!inp) return;
    const raw = inp.value.trim();
    if (!raw) return;
    const tag = raw.toLowerCase()
      .replace(/[^a-z0-9àâäéèêëîïôùûüç_-\s]/g,'')
      .trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    if (!tag || _editTags.includes(tag) || _editTags.length >= 10) { inp.value=''; return; }
    _editTags.push(tag);
    inp.value = '';
    _renderEditTags();
  }

  function _removeTag(i) { _editTags.splice(i,1); _renderEditTags(); }

  function _previewVideo(url) {
    const el = document.getElementById('bl-video-preview');
    if (!el) return;
    el.innerHTML = url ? _videoPreviewHtml(url) : '';
  }

  function _showAdmin() { _view='admin'; render(); }

  // ── CATEGORY MANAGEMENT ──
  const _CAT_ICON_PRESETS = [
    'fa-bolt','fa-gears','fa-robot','fa-droplet','fa-wind','fa-clipboard-list',
    'fa-screwdriver-wrench','fa-lightbulb','fa-film','fa-book','fa-globe',
    'fa-fire-flame-curved','fa-snowflake','fa-car','fa-bed','fa-lock',
    'fa-box','fa-utensils','fa-broom','fa-wifi','fa-building','fa-wrench',
    'fa-shield-halved','fa-plug','fa-water','fa-fan','fa-temperature-high',
    'fa-swimming-pool','fa-spa','fa-key',
  ];

  const _CAT_COLOR_PRESETS = [
    '#FDE047','#94A3B8','#60A5FA','#38BDF8','#A78BFA','#4ADE80',
    '#FB923C','#F472B6','#F87171','#34D399','#22D3EE','#FBBF24',
    '#E879F9','#2DD4BF','#F97316','#8B5CF6','#EC4899','#06B6D4',
    '#84CC16','#EF4444',
  ];

  function _openCatModal(id) {
    const cat  = id ? _categories.find(c => c.id === id) : null;
    const isNew = !cat;
    const defIcon  = cat ? (cat.icon  || 'fa-folder') : 'fa-folder';
    const defColor = cat ? (cat.color || '#60A5FA')   : '#60A5FA';

    const iconPresets = _CAT_ICON_PRESETS.map(ic =>
      `<button class="bl-icon-preset${defIcon===ic?' active':''}" title="${ic}" onclick="MX.Pages.Bible._pickCatIcon('${ic}')"><i class="fas ${ic}"></i></button>`
    ).join('');

    const colorPresets = _CAT_COLOR_PRESETS.map(col =>
      `<button class="bl-color-preset${defColor===col?' active':''}" style="background:${col}" title="${col}" onclick="MX.Pages.Bible._pickCatColor('${col}')"></button>`
    ).join('');

    const body = `<div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label>Nom *</label>
        <input id="bl-cat-name" class="fi" type="text" placeholder="ex: Piscine, Chaufferie, Parking…" value="${MX.esc(cat?cat.name:'')}">
      </div>
      <div class="form-group">
        <label>Icône</label>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <div class="bl-cat-icon-preview" id="bl-cat-icon-prev"><i class="fas ${MX.esc(defIcon)}" style="color:${MX.esc(defColor)}"></i></div>
          <input id="bl-cat-icon" class="fi" type="text" placeholder="fa-bolt, fa-fire…" value="${MX.esc(defIcon)}" oninput="MX.Pages.Bible._previewCatIcon(this.value)" style="flex:1">
        </div>
        <div class="bl-icon-presets">${iconPresets}</div>
      </div>
      <div class="form-group">
        <label>Couleur</label>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <input id="bl-cat-color" type="color" value="${MX.esc(defColor)}" oninput="MX.Pages.Bible._previewCatColor(this.value)" style="width:36px;height:32px;border:none;background:none;cursor:pointer;padding:0;border-radius:4px">
          <span id="bl-cat-color-txt" style="font-size:12px;color:var(--text2);font-family:var(--ffm)">${MX.esc(defColor)}</span>
        </div>
        <div class="bl-color-presets">${colorPresets}</div>
      </div>
      <div class="form-group">
        <label>Description <span style="color:var(--text3);font-weight:400">(optionnel)</span></label>
        <input id="bl-cat-desc" class="fi" type="text" placeholder="Décrit le contenu de cette catégorie…" value="${MX.esc(cat?cat.description||'':'')}">
      </div>
    </div>`;

    MX.showModal({
      title: isNew ? 'Nouvelle catégorie' : 'Modifier la catégorie',
      body,
      actions: [
        ...(cat ? [{ label: 'Supprimer', cls: 'danger', fn: () => _deleteCat(id) }] : []),
        { label: 'Annuler', cls: 'cancel' },
        { label: isNew ? 'Créer' : 'Enregistrer', cls: 'confirm', fn: () => _saveCat(id) },
      ]
    });
  }

  function _previewCatIcon(icon) {
    const prev  = document.getElementById('bl-cat-icon-prev');
    const color = document.getElementById('bl-cat-color')?.value || '#60A5FA';
    if (prev) prev.innerHTML = `<i class="fas ${MX.esc(icon)}" style="color:${MX.esc(color)}"></i>`;
  }

  function _pickCatIcon(icon) {
    const inp = document.getElementById('bl-cat-icon');
    if (inp) inp.value = icon;
    _previewCatIcon(icon);
    document.querySelectorAll('.bl-icon-preset').forEach(b => b.classList.toggle('active', b.title === icon));
  }

  function _previewCatColor(color) {
    const txt = document.getElementById('bl-cat-color-txt');
    if (txt) txt.textContent = color;
    const prev = document.getElementById('bl-cat-icon-prev');
    if (prev) {
      const icon = document.getElementById('bl-cat-icon')?.value || 'fa-folder';
      prev.innerHTML = `<i class="fas ${MX.esc(icon)}" style="color:${MX.esc(color)}"></i>`;
    }
  }

  function _pickCatColor(color) {
    const inp = document.getElementById('bl-cat-color');
    if (inp) inp.value = color;
    _previewCatColor(color);
    document.querySelectorAll('.bl-color-preset').forEach(b => b.classList.toggle('active', b.title === color));
  }

  async function _saveCat(id) {
    const name  = (document.getElementById('bl-cat-name')?.value  || '').trim();
    const icon  = (document.getElementById('bl-cat-icon')?.value  || '').trim() || 'fa-folder';
    const color = (document.getElementById('bl-cat-color')?.value || '#60A5FA');
    const desc  = (document.getElementById('bl-cat-desc')?.value  || '').trim();

    if (!name) { MX.toast('Le nom est obligatoire', true); return; }

    const maxOrder = _categories.reduce((m, c) => Math.max(m, c.order || 0), -1);

    try {
      if (id) {
        await MX.DB.updateBibleCategory(id, { name, icon, color, description: desc });
        MX.toast('Catégorie mise à jour ✓');
      } else {
        await MX.DB.addBibleCategory({ name, icon, color, description: desc, order: maxOrder + 1, createdBy: _author() });
        MX.toast('Catégorie créée ✓');
      }
      MX.closeModal();
    } catch(e) {
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  async function _deleteCat(id) {
    const cat = _categories.find(c => c.id === id);
    if (!cat) return;
    try {
      const count = await MX.DB.countBibleCategoryArticles(id);
      if (count === 0) {
        MX.showModal(
          `Supprimer "${cat.name}" ?`,
          'Aucun article dans cette catégorie. La suppression est irréversible.',
          [
            { label: 'Supprimer', cls: 'danger', fn: async () => {
              try {
                await MX.DB.deleteBibleCategory(id);
                if (_selectedCategory === id) _selectedCategory = 'all';
                MX.toast('Catégorie supprimée');
              } catch(e) { MX.toast('Erreur: ' + e.message, true); }
            }},
            { label: 'Annuler', cls: 'cancel' }
          ]
        );
      } else {
        const others = _categories.filter(c => c.id !== id && !c.archived);
        const opts   = others.map(c => `<option value="${MX.esc(c.id)}">${MX.esc(c.name)}</option>`).join('');
        const moveSection = others.length
          ? `<div class="form-group" style="margin-top:12px">
               <label>Déplacer les articles vers</label>
               <select class="fi" id="bl-cat-move-to"><option value="">— Choisir une catégorie —</option>${opts}</select>
             </div>`
          : `<p style="font-size:12px;color:var(--text3);margin:10px 0 0">Aucune autre catégorie disponible — créez-en une d'abord, ou archivez.</p>`;
        MX.showModal({
          title: `La catégorie "${cat.name}" contient ${count} article${count > 1 ? 's' : ''}`,
          sub: 'Les articles ne seront jamais supprimés automatiquement.',
          body: moveSection,
          actions: [
            ...(others.length ? [{ label: 'Déplacer et supprimer', cls: 'danger', fn: () => _doMoveCatAndDelete(id) }] : []),
            { label: 'Archiver la catégorie', cls: 'confirm', fn: () => _archiveCat(id) },
            { label: 'Annuler', cls: 'cancel' },
          ]
        });
      }
    } catch(e) {
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  async function _archiveCat(id) {
    try {
      await MX.DB.updateBibleCategory(id, { archived: true });
      if (_selectedCategory === id) _selectedCategory = 'all';
      MX.closeModal();
      MX.toast('Catégorie archivée — les articles sont conservés');
    } catch(e) { MX.toast('Erreur: ' + e.message, true); }
  }

  async function _restoreCat(id) {
    try {
      await MX.DB.updateBibleCategory(id, { archived: false });
      MX.toast('Catégorie restaurée');
    } catch(e) { MX.toast('Erreur: ' + e.message, true); }
  }

  async function _doMoveCatAndDelete(fromId) {
    const toId = document.getElementById('bl-cat-move-to')?.value;
    if (!toId) { MX.toast('Sélectionnez une catégorie de destination', true); return; }
    try {
      const n = await MX.DB.moveBibleCategoryArticles(fromId, toId);
      await MX.DB.deleteBibleCategory(fromId);
      if (_selectedCategory === fromId) _selectedCategory = 'all';
      MX.closeModal();
      MX.toast(`${n} article${n>1?'s':''} déplacé${n>1?'s':''}. Catégorie supprimée.`);
    } catch(e) {
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  async function _moveCatUp(id) {
    const sorted = [..._categories].sort((a, b) => (a.order||0) - (b.order||0));
    const idx = sorted.findIndex(c => c.id === id);
    if (idx <= 0) return;
    const ca = sorted[idx], cb = sorted[idx - 1];
    try {
      await Promise.all([
        MX.DB.updateBibleCategory(ca.id, { order: cb.order || 0 }),
        MX.DB.updateBibleCategory(cb.id, { order: ca.order || 0 }),
      ]);
    } catch(e) { MX.toast('Erreur: ' + e.message, true); }
  }

  async function _moveCatDown(id) {
    const sorted = [..._categories].sort((a, b) => (a.order||0) - (b.order||0));
    const idx = sorted.findIndex(c => c.id === id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const ca = sorted[idx], cb = sorted[idx + 1];
    try {
      await Promise.all([
        MX.DB.updateBibleCategory(ca.id, { order: cb.order || 0 }),
        MX.DB.updateBibleCategory(cb.id, { order: ca.order || 0 }),
      ]);
    } catch(e) { MX.toast('Erreur: ' + e.message, true); }
  }

  // ── EXPORT ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};

  function _destroy() {
    if (_unsubArticles)   { _unsubArticles();   _unsubArticles   = null; }
    if (_unsubComments)   { _unsubComments();   _unsubComments   = null; }
    if (_unsubCategories) { _unsubCategories(); _unsubCategories = null; }
  }

  window.MX.Pages.Bible = {
    render, _destroy,
    _setCat, _setTag, _onSearch, _clearSearch,
    _openArticle, _backToList, _backToListWithTag,
    _newArticle, _editArticle, _cancelEdit, _saveArticle,
    _confirmDelete, _setStatus, _toggleLike,
    _submitComment, _deleteComment,
    _addLink, _removeLink, _addTag, _removeTag,
    _previewVideo, _showAdmin,
    _openCatModal, _saveCat, _deleteCat, _doMoveCatAndDelete,
    _archiveCat, _restoreCat,
    _previewCatIcon, _pickCatIcon, _previewCatColor, _pickCatColor,
    _moveCatUp, _moveCatDown,
  };
})();
