(function () {
  const FV = firebase.firestore.FieldValue;

  const DEFAULT_ORG_TASKS = [
    { title: 'Contrôle carnets sécurité',          category: 'sécurité',      description: '', type: 'hebdomadaire' },
    { title: 'Vérification registre piscine',       category: 'réglementaire', description: '', type: 'hebdomadaire' },
    { title: 'Contrôle stock EPI',                  category: 'stock',         description: '', type: 'hebdomadaire' },
    { title: 'Contrôle affichages réglementaires',  category: 'réglementaire', description: '', type: 'hebdomadaire' },
    { title: 'Vérification contrats prestataires',  category: 'administratif', description: '', type: 'hebdomadaire' },
    { title: 'Contrôle chambres PMR',               category: 'hébergement',   description: '', type: 'hebdomadaire' },
  ];

  let _tasks     = [];
  let _unsub     = null;
  let _weekKey   = null;
  let _inHistory = false;
  let _dragId    = null;
  let _dragOver  = null;

  // ── HELPERS ──
  function _isoWk(d) {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return { y: tmp.getUTCFullYear(), n: Math.ceil((((tmp - ys) / 86400000) + 1) / 7) };
  }
  function _getWeekKey(d) {
    const wk = _isoWk(d || new Date());
    return `${wk.y}_W${String(wk.n).padStart(2, '0')}`;
  }
  function _weekLabel(weekKey) {
    const parts = weekKey.split('_W');
    return `Semaine ${parseInt(parts[1])} — ${parts[0]}`;
  }
  function _fmtDT(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
           ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function _initials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }
  function _ucolor(name) {
    if (!name) return '#6B7280';
    const cols = ['#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B','#EF4444','#06B6D4'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
    return cols[Math.abs(h) % cols.length];
  }
  function _catColor(cat) {
    const m = {
      'sécurité':      '#EF4444',
      'réglementaire': '#F59E0B',
      'stock':         '#3B82F6',
      'administratif': '#06B6D4',
      'hébergement':   '#8B5CF6',
    };
    return m[cat] || '#6B7280';
  }
  function _catIcon(cat) {
    const m = {
      'sécurité':      'fa-shield-halved',
      'réglementaire': 'fa-scale-balanced',
      'stock':         'fa-boxes-stacked',
      'administratif': 'fa-file-lines',
      'hébergement':   'fa-bed',
    };
    return m[cat] || 'fa-tag';
  }
  function _prioConfig(prio) {
    if (prio === 'critique') return { label: 'Critique', color: '#DC2626', bg: 'rgba(220,38,38,.15)',  icon: '🚨' };
    if (prio === 'urgente')  return { label: 'Urgente',  color: '#EF4444', bg: 'rgba(239,68,68,.12)',  icon: '🔴' };
    if (prio === 'haute')    return { label: 'Haute',    color: '#F59E0B', bg: 'rgba(245,158,11,.12)', icon: '🟠' };
    return null;
  }
  function _currentUserName() {
    const cu = MX.state.currentUser;
    const ad = MX.state.adminUser;
    if (cu) return cu.name;
    if (ad) return (ad.email || 'admin').split('@')[0];
    return 'Inconnu';
  }
  function _getUserOptions(selected) {
    const users = (MX.state.users || []);
    let opts = `<option value="">— Non assigné —</option>`;
    users.forEach(u => {
      const n = u.name || '';
      opts += `<option value="${MX.esc(n)}"${n === selected ? ' selected' : ''}>${MX.esc(n)}</option>`;
    });
    return opts;
  }

  // ── FIRESTORE ERROR HANDLER ──
  function _onFirestoreError(err, ctx) {
    const isIndex = err.code === 'failed-precondition' || (err.message && err.message.includes('index'));
    const linkMatch = err.message && err.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
    const link = linkMatch ? linkMatch[0] : null;
    console.error(`[Maintix] Firestore erreur (${ctx}):`, err.message || err);
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page">
      <div class="or-header"><div class="or-header-left"><div class="or-title">Organisation Responsable</div></div></div>
      <div class="or-empty" style="gap:12px;padding:40px 20px">
        <i class="fas fa-${isIndex ? 'database' : 'triangle-exclamation'}" style="font-size:36px;color:var(--${isIndex?'orange':'red'})"></i>
        <div style="font-size:15px;font-weight:700">${isIndex ? 'Index Firestore manquant' : 'Erreur Firestore'}</div>
        <div style="font-size:13px;color:var(--text2);text-align:center;max-width:340px">
          ${isIndex ? 'Déployez <strong>firestore.indexes.json</strong> via Firebase CLI.' : MX.esc(err.message || String(err))}
        </div>
        ${link ? `<a href="${link}" target="_blank" rel="noopener" class="or-sec-btn"><i class="fas fa-external-link-alt"></i> Créer l'index →</a>` : ''}
        <button class="or-sec-btn" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-rotate-right"></i> Réessayer</button>
      </div>
    </div>`;
  }

  // ── SEED ──
  async function _seedWeek(weekKey) {
    try {
      const snap = await db.collection('org_tasks').where('weekKey', '==', weekKey).limit(1).get();
      if (!snap.empty) return;
      const name = _currentUserName();
      const batch = db.batch();
      DEFAULT_ORG_TASKS.forEach((t, i) => {
        batch.set(db.collection('org_tasks').doc(), {
          ...t,
          weekKey, done: false, doneBy: null, doneAt: null, comment: null,
          archivedFromActive: false, assignedTo: null, priority: 'normale',
          createdBy: name, createdAt: FV.serverTimestamp(), order: i, isDefault: true,
        });
      });
      await batch.commit();
    } catch(e) { console.warn('[OrgResp] seed init:', e.message); return; }

    try {
      const prevDate = new Date(); prevDate.setDate(prevDate.getDate() - 7);
      const prevKey  = _getWeekKey(prevDate);
      const prevSnap = await db.collection('org_tasks')
        .where('weekKey', '==', prevKey).where('isDefault', '==', false).get();
      const recurring = prevSnap.docs.map(d => d.data()).filter(t => t.type === 'hebdomadaire');
      if (recurring.length > 0) {
        const name = _currentUserName();
        const b2   = db.batch();
        recurring.forEach((t, i) => {
          b2.set(db.collection('org_tasks').doc(), {
            title: t.title, description: t.description || '', category: t.category || 'autre',
            type: 'hebdomadaire', weekKey, done: false, doneBy: null, doneAt: null,
            comment: null, archivedFromActive: false, assignedTo: t.assignedTo || null,
            priority: t.priority || 'normale', createdBy: t.createdBy || name,
            createdAt: FV.serverTimestamp(), order: DEFAULT_ORG_TASKS.length + i, isDefault: false,
          });
        });
        await b2.commit();
      }
    } catch(e) { console.warn('[OrgResp] carry-over:', e.message); }
  }

  // ── SUBSCRIPTION ──
  function _subscribe(weekKey) {
    if (_unsub) { _unsub(); _unsub = null; }
    try {
      _unsub = db.collection('org_tasks')
        .where('weekKey', '==', weekKey)
        .onSnapshot(
          snap => {
            _tasks = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            if (!_inHistory) _doRender();
          },
          err => _onFirestoreError(err, 'subscribe')
        );
    } catch(e) { _onFirestoreError(e, 'subscribe-setup'); }
    _seedWeek(weekKey).catch(e => console.warn('[OrgResp] seed:', e.message));
  }

  // ── ENTRY POINT ──
  function render() {
    if (!MX.Auth.canSeeAll()) {
      const mc = document.getElementById('main-content');
      if (mc) mc.innerHTML = '<div class="or-empty"><i class="fas fa-lock"></i><div>Accès réservé aux responsables</div></div>';
      return;
    }
    _inHistory = false;
    _weekKey   = _getWeekKey(new Date());
    _subscribe(_weekKey);
  }

  function _doRender() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    try { _renderMain(mc); }
    catch(e) {
      console.error('[OrgResp] render error:', e);
      mc.innerHTML = `<div class="or-page"><div class="or-empty"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  // ── BADGES ──
  function _typeBadge(type) {
    if (type === 'unique') return `<span class="or-type-badge or-type-badge--uni">📌 Unique</span>`;
    return `<span class="or-type-badge or-type-badge--heb">🔄 Récurrente</span>`;
  }

  // ── STATS PANEL ──
  function _renderStats(todo, done) {
    const total   = todo.length + done.length;
    const recCnt  = _tasks.filter(t => !t.archivedFromActive && t.type === 'hebdomadaire').length;
    const pct     = total ? Math.round(done.length / total * 100) : 0;
    const pctC    = pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';

    return `<div class="or-stats">
      <div class="or-stat or-stat--todo">
        <div class="or-stat-ico"><i class="fas fa-circle-dot"></i></div>
        <div><div class="or-stat-n">${todo.length}</div><div class="or-stat-l">À faire</div></div>
      </div>
      <div class="or-stat or-stat--done">
        <div class="or-stat-ico"><i class="fas fa-circle-check"></i></div>
        <div><div class="or-stat-n">${done.length}</div><div class="or-stat-l">Réalisées</div></div>
      </div>
      <div class="or-stat or-stat--rec">
        <div class="or-stat-ico"><i class="fas fa-rotate"></i></div>
        <div><div class="or-stat-n">${recCnt}</div><div class="or-stat-l">Récurrentes</div></div>
      </div>
      <div class="or-stat or-stat--total">
        <div class="or-stat-ico"><i class="fas fa-list-check"></i></div>
        <div><div class="or-stat-n">${total}</div><div class="or-stat-l">Total</div></div>
      </div>
    </div>
    <div class="or-progress">
      <div class="or-progress-track"><div class="or-progress-fill" style="width:${pct}%;background:${pctC}"></div></div>
      <div class="or-progress-lbl" style="color:${pctC}">${pct}% complété</div>
    </div>`;
  }

  // ── MAIN RENDER ──
  function _renderMain(mc) {
    const todo = _tasks.filter(t => !t.done && !t.archivedFromActive);
    const done = _tasks.filter(t =>  t.done && !t.archivedFromActive);

    let h = `<div class="or-page">`;

    h += `<div class="or-header">
      <div class="or-header-left">
        <div class="or-title"><i class="fas fa-users" style="color:var(--cyan);font-size:17px;margin-right:8px"></i>Organisation Responsable</div>
        <div class="or-week-label">${_weekLabel(_weekKey)}</div>
      </div>
      <div class="or-header-right">
        <button class="or-sec-btn" onclick="MX.Pages.OrgResp.renderHistory()">
          <i class="fas fa-clock-rotate-left"></i><span class="or-btn-lbl"> Historique</span>
        </button>
        <button class="or-sec-btn or-sec-btn--primary" onclick="MX.Pages.OrgResp.openAdd()">
          <i class="fas fa-plus"></i><span class="or-btn-lbl"> Ajouter</span>
        </button>
      </div>
    </div>`;

    h += _renderStats(todo, done);

    // À FAIRE
    h += `<div class="or-section">
      <div class="or-sec-hd">
        <div class="or-sec-title"><span class="or-sec-dot or-sec-dot--todo"></span>À FAIRE <span class="or-sec-badge">${todo.length}</span></div>
        ${todo.length > 0 ? '<div class="or-sec-hint"><i class="fas fa-grip-vertical" style="font-size:10px;margin-right:4px"></i>Glisser pour réordonner</div>' : ''}
      </div>`;

    if (todo.length === 0) {
      h += `<div class="or-empty-sec">
        <i class="fas fa-circle-check" style="color:var(--green);font-size:22px"></i>
        <div>Toutes les tâches sont réalisées !</div>
      </div>`;
    } else {
      h += `<div class="or-list" id="or-todo-list">`;
      todo.forEach(t => { h += _todoCard(t); });
      h += `</div>`;
    }
    h += `</div>`;

    // RÉALISÉES
    if (done.length > 0) {
      h += `<div class="or-section">
        <div class="or-sec-hd">
          <div class="or-sec-title"><span class="or-sec-dot or-sec-dot--done"></span>RÉALISÉES <span class="or-sec-badge or-sec-badge--done">${done.length}</span></div>
        </div>
        <div class="or-list">`;
      done.forEach(t => { h += _doneCard(t); });
      h += `</div></div>`;
    }

    h += `</div>`;
    h += `<button class="or-fab" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter une tâche"><i class="fas fa-plus"></i></button>`;

    mc.innerHTML = h;
    _initDragDrop();
  }

  // ── CARD: À FAIRE ──
  function _todoCard(t) {
    const col    = _catColor(t.category);
    const catIco = _catIcon(t.category);
    const prio   = _prioConfig(t.priority);
    const aCol   = _ucolor(t.assignedTo || '');

    return `<div class="or-card" draggable="true" data-id="${t.id}" id="orc-${t.id}">
      <div class="or-drag-handle"><i class="fas fa-grip-vertical"></i></div>
      <div class="or-card-inner">
        <div class="or-card-badges">
          <span class="or-cat-badge" style="background:${col}18;color:${col};border-color:${col}35">
            <i class="fas ${catIco}"></i> ${MX.esc(t.category || 'autre')}
          </span>
          ${_typeBadge(t.type)}
          ${prio ? `<span class="or-prio-badge" style="background:${prio.bg};color:${prio.color}">${prio.icon} ${prio.label}</span>` : ''}
        </div>
        <div class="or-card-title">${MX.esc(t.title)}</div>
        ${t.description ? `<div class="or-card-desc">${MX.esc(t.description)}</div>` : ''}
        <div class="or-card-foot">
          <div class="or-card-assign">
            ${t.assignedTo
              ? `<span class="or-av" style="background:${aCol}">${_initials(t.assignedTo)}</span>
                 <span class="or-av-name">${MX.esc(t.assignedTo)}</span>`
              : `<span class="or-av-none"><i class="fas fa-user-slash"></i> Non assigné</span>`
            }
          </div>
          <div class="or-card-actions">
            <button class="or-act-btn or-act-btn--edit" onclick="MX.Pages.OrgResp.openEdit('${t.id}')"     title="Modifier"><i class="fas fa-pen"></i></button>
            <button class="or-act-btn or-act-btn--del"  onclick="MX.Pages.OrgResp.openDelete('${t.id}')"   title="Supprimer"><i class="fas fa-trash"></i></button>
            <button class="or-act-btn or-act-btn--ok"   onclick="MX.Pages.OrgResp.openValidate('${t.id}')" title="Valider"><i class="fas fa-check"></i></button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── CARD: RÉALISÉE ──
  function _doneCard(t) {
    const col = _ucolor(t.doneBy || '');
    const dt  = t.doneAt ? _fmtDT(t.doneAt) : '';
    return `<div class="or-card or-card--done">
      <div class="or-done-row">
        <span class="or-av or-av--done" style="background:${col}">${_initials(t.doneBy || '?')}</span>
        <div class="or-done-info">
          <div class="or-card-title or-card-title--done">${MX.esc(t.title)}</div>
          <div class="or-done-meta">${MX.esc(t.doneBy || '?')}${dt ? ` · ${dt}` : ''}${t.comment ? ` · "${MX.esc(t.comment)}"` : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${_typeBadge(t.type)}
          <button class="or-act-btn" onclick="MX.Pages.OrgResp.unvalidate('${t.id}')" title="Annuler"><i class="fas fa-rotate-left"></i></button>
        </div>
      </div>
    </div>`;
  }

  // ── DRAG & DROP ──
  function _initDragDrop() {
    const list = document.getElementById('or-todo-list');
    if (!list) return;

    list.addEventListener('dragstart', e => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      _dragId = card.dataset.id;
      requestAnimationFrame(() => card.classList.add('or-card--dragging'));
      e.dataTransfer.effectAllowed = 'move';
    });

    list.addEventListener('dragend', () => {
      list.querySelectorAll('.or-card--dragging, .or-card--drag-over').forEach(c => {
        c.classList.remove('or-card--dragging', 'or-card--drag-over');
      });
      _dragId = null; _dragOver = null;
    });

    list.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const card = e.target.closest('[data-id]');
      if (!card || card.dataset.id === _dragId) return;
      if (_dragOver !== card.dataset.id) {
        list.querySelectorAll('.or-card--drag-over').forEach(c => c.classList.remove('or-card--drag-over'));
        card.classList.add('or-card--drag-over');
        _dragOver = card.dataset.id;
      }
    });

    list.addEventListener('drop', e => {
      e.preventDefault();
      if (_dragId && _dragOver && _dragId !== _dragOver) _reorderTasks(_dragId, _dragOver);
    });

    // Touch support for mobile
    let _tCard = null, _tY = 0;
    list.addEventListener('touchstart', e => {
      const handle = e.target.closest('.or-drag-handle');
      if (!handle) return;
      const card = handle.closest('[data-id]');
      if (!card) return;
      _tCard = card; _dragId = card.dataset.id; _tY = e.touches[0].clientY;
      card.classList.add('or-card--dragging');
    }, { passive: true });

    list.addEventListener('touchmove', e => {
      if (!_tCard) return;
      e.preventDefault();
      const ty = e.touches[0].clientY;
      const cards = [...list.querySelectorAll('[data-id]:not(.or-card--dragging)')];
      list.querySelectorAll('.or-card--drag-over').forEach(c => c.classList.remove('or-card--drag-over'));
      let target = null;
      cards.forEach(c => {
        const r = c.getBoundingClientRect();
        if (ty >= r.top && ty <= r.bottom) target = c;
      });
      if (target) { target.classList.add('or-card--drag-over'); _dragOver = target.dataset.id; }
    }, { passive: false });

    list.addEventListener('touchend', () => {
      if (_tCard && _dragId && _dragOver && _dragId !== _dragOver) _reorderTasks(_dragId, _dragOver);
      if (_tCard) _tCard.classList.remove('or-card--dragging');
      list.querySelectorAll('.or-card--drag-over').forEach(c => c.classList.remove('or-card--drag-over'));
      _tCard = null; _dragId = null; _dragOver = null;
    });
  }

  async function _reorderTasks(fromId, toId) {
    const todo    = _tasks.filter(t => !t.done && !t.archivedFromActive);
    const fromIdx = todo.findIndex(t => t.id === fromId);
    const toIdx   = todo.findIndex(t => t.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = [...todo];
    const [moved]   = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reordered.forEach((t, i) => { t.order = i; });

    const rest  = _tasks.filter(t => t.done || t.archivedFromActive);
    _tasks = [...reordered, ...rest];
    _doRender();

    try {
      const batch = db.batch();
      reordered.forEach((t, i) => batch.update(db.collection('org_tasks').doc(t.id), { order: i }));
      await batch.commit();
    } catch(e) { MX.toast('Erreur lors du tri', true); }
  }

  // ── FORM ──
  function _taskFormBody(defaults) {
    const d    = defaults || {};
    const prio = d.priority || 'normale';
    const type = d.type || 'hebdomadaire';
    return `<div class="or-form">
      <div class="or-form-row">
        <label>Titre *</label>
        <input id="or-f-title" class="fi" value="${MX.esc(d.title || '')}" placeholder="Nom de la tâche" maxlength="150">
      </div>
      <div class="or-form-row">
        <label>Description</label>
        <input id="or-f-desc" class="fi" value="${MX.esc(d.description || '')}" placeholder="Détails optionnels" maxlength="300">
      </div>
      <div class="or-form-2col">
        <div class="or-form-row">
          <label>Responsable</label>
          <select id="or-f-assign" class="fi">${_getUserOptions(d.assignedTo || '')}</select>
        </div>
        <div class="or-form-row">
          <label>Catégorie</label>
          <select id="or-f-cat" class="fi">
            ${['sécurité','réglementaire','stock','administratif','hébergement','autre'].map(c =>
              `<option value="${c}"${c === (d.category || 'autre') ? ' selected' : ''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="or-form-2col">
        <div class="or-form-row">
          <label>Priorité</label>
          <select id="or-f-prio" class="fi">
            <option value="normale"${prio==='normale'?' selected':''}>Normale</option>
            <option value="haute"${prio==='haute'?' selected':''}>🟠 Haute</option>
            <option value="urgente"${prio==='urgente'?' selected':''}>🔴 Urgente</option>
            <option value="critique"${prio==='critique'?' selected':''}>🚨 Critique</option>
          </select>
        </div>
        <div class="or-form-row">
          <label>Type</label>
          <div class="or-type-radios">
            <label class="or-radio${type==='hebdomadaire'?' or-radio--on':''}">
              <input type="radio" name="or-f-type" value="hebdomadaire" ${type==='hebdomadaire'?'checked':''} onchange="this.closest('.or-type-radios').querySelectorAll('.or-radio').forEach(l=>l.classList.remove('or-radio--on'));this.closest('.or-radio').classList.add('or-radio--on')">
              🔄 Récurrente
            </label>
            <label class="or-radio${type==='unique'?' or-radio--on':''}">
              <input type="radio" name="or-f-type" value="unique" ${type==='unique'?'checked':''} onchange="this.closest('.or-type-radios').querySelectorAll('.or-radio').forEach(l=>l.classList.remove('or-radio--on'));this.closest('.or-radio').classList.add('or-radio--on')">
              📌 Unique
            </label>
          </div>
        </div>
      </div>
    </div>`;
  }

  function _readForm() {
    const typeEl = document.querySelector('input[name="or-f-type"]:checked');
    return {
      title:       (document.getElementById('or-f-title')?.value  || '').trim(),
      description: (document.getElementById('or-f-desc')?.value   || '').trim(),
      assignedTo:  document.getElementById('or-f-assign')?.value  || null,
      category:    document.getElementById('or-f-cat')?.value     || 'autre',
      priority:    document.getElementById('or-f-prio')?.value    || 'normale',
      type:        typeEl ? typeEl.value : 'hebdomadaire',
    };
  }

  // ── ADD ──
  function openAdd() {
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     _weekLabel(_weekKey),
      body:    _taskFormBody(),
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doAdd() {
    const data = _readForm();
    if (!data.title) { MX.toast('Le titre est obligatoire', true); return; }
    const name = _currentUserName();
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').add({
        ...data,
        assignedTo: data.assignedTo || null,
        weekKey: _weekKey,
        done: false, doneBy: null, doneAt: null, comment: null,
        archivedFromActive: false,
        createdBy: name, createdAt: FV.serverTimestamp(),
        order: _tasks.filter(t => !t.done && !t.archivedFromActive).length, isDefault: false,
      });
      MX.syncEnd();
      MX.toast('Tâche créée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── EDIT ──
  function openEdit(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Modifier la tâche',
      sub:     MX.esc(t.title),
      body:    _taskFormBody(t),
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doEdit(taskId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doEdit(taskId) {
    const data = _readForm();
    if (!data.title) { MX.toast('Le titre est obligatoire', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        title: data.title, description: data.description,
        assignedTo: data.assignedTo || null, category: data.category,
        priority: data.priority, type: data.type,
      });
      MX.syncEnd();
      MX.toast('Tâche modifiée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── DELETE ──
  function openDelete(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title: 'Supprimer la tâche',
      sub:   MX.esc(t.title),
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Cette tâche sera <strong style="color:var(--red)">définitivement supprimée</strong>.<br>
          Cette action est irréversible.
        </div>
      </div>`,
      actions: [
        { label: 'Supprimer', cls: 'danger-btn', fn: () => _doDelete(taskId) },
        { label: 'Annuler',   cls: 'cancel' }
      ]
    });
  }

  async function _doDelete(taskId) {
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).delete();
      MX.syncEnd();
      MX.toast('Tâche supprimée');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── VALIDATE ──
  function openValidate(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    const isRec = t.type !== 'unique';
    MX.showModal({
      title: 'Valider la tâche',
      sub:   MX.esc(t.title),
      body:  `<div>
        <label style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px">Commentaire (optionnel)</label>
        <textarea id="or-val-cmt" class="fi" style="min-height:72px;resize:vertical" placeholder="Tout était OK, rien à signaler…"></textarea>
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isRec?'rgba(0,194,209,.07)':'var(--bg3)'};border-radius:8px;font-size:12px;color:var(--text2)">
          <i class="fas ${isRec?'fa-rotate':'fa-archive'}" style="color:${isRec?'var(--cyan)':'var(--text3)'}"></i>
          ${isRec ? 'Tâche récurrente — recréée automatiquement la semaine suivante' : 'Tâche unique — archivée après validation'}
        </div>
      </div>`,
      actions: [
        { label: 'Valider', cls: 'primary-btn', fn: () => _doValidate(taskId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doValidate(taskId) {
    const task    = _tasks.find(x => x.id === taskId);
    const name    = _currentUserName();
    const comment = (document.getElementById('or-val-cmt')?.value || '').trim() || null;
    MX.closeModal();
    MX.syncStart();
    try {
      const update = { done: true, doneBy: name, doneAt: FV.serverTimestamp(), comment };
      if (task && task.type === 'unique') update.archivedFromActive = true;
      await db.collection('org_tasks').doc(taskId).update(update);
      MX.syncEnd();
      MX.toast('Tâche validée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function unvalidate(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        done: false, doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
      });
      MX.syncEnd();
      MX.toast('Validation annulée');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── HISTORY ──
  async function renderHistory() {
    _inHistory = true;
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page"><div class="or-loading"><i class="fas fa-spinner fa-spin"></i> Chargement…</div></div>`;
    try {
      const weeks = [];
      const now = new Date();
      for (let i = 0; i < 8; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i * 7);
        weeks.push(_getWeekKey(d));
      }
      const snap = await db.collection('org_tasks').where('weekKey', 'in', weeks).get();
      const byWeek = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!byWeek[data.weekKey]) byWeek[data.weekKey] = [];
        byWeek[data.weekKey].push({ id: d.id, ...data });
      });

      let h = `<div class="or-page">
        <div class="or-header">
          <div class="or-header-left">
            <div class="or-title">Historique</div>
            <div class="or-week-label">8 dernières semaines</div>
          </div>
          <div class="or-header-right">
            <button class="or-sec-btn" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i><span class="or-btn-lbl"> Retour</span></button>
          </div>
        </div>`;

      let hasAny = false;
      weeks.forEach(wk => {
        const tasks   = (byWeek[wk] || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        const total   = tasks.length;
        const doneCnt = tasks.filter(t => t.done).length;
        if (total === 0) return;
        hasAny = true;
        const pct    = Math.round(doneCnt / total * 100);
        const isCur  = wk === _weekKey;
        const pctCls = pct >= 80 ? 'or-hist-bar-fill--done' : pct >= 40 ? 'or-hist-bar-fill--prog' : '';
        h += `<div class="or-hist-week${isCur?' or-hist-week--current':''}" onclick="MX.Pages.OrgResp._histToggle('${wk}')">
          <div class="or-hist-row">
            <div class="or-hist-wlabel">${_weekLabel(wk)}${isCur?' <span class="or-hist-cur">en cours</span>':''}</div>
            <div class="or-hist-stat">${doneCnt}/${total} — ${pct}%</div>
          </div>
          <div class="or-hist-bar"><div class="or-hist-bar-fill ${pctCls}" style="width:${pct}%"></div></div>
        </div>
        <div class="or-hist-detail" id="or-hd-${wk}" style="display:none">`;
        tasks.forEach(t => {
          const asgn = t.assignedTo ? ` · <span style="color:var(--cyan)">↗ ${MX.esc(t.assignedTo)}</span>` : '';
          h += `<div class="or-hist-task${t.done?' or-hist-task--done':''}">
            <i class="fas fa-${t.done?'circle-check':'circle'}" style="color:${t.done?'var(--green)':'var(--text3)'}"></i>
            <div class="or-hist-task-body">
              <div class="or-hist-task-title">${MX.esc(t.title)} ${_typeBadge(t.type)}${asgn}</div>
              ${t.done&&t.doneBy?`<div class="or-hist-task-meta">Par <strong>${MX.esc(t.doneBy)}</strong>${t.doneAt?` — ${_fmtDT(t.doneAt)}`:''}${t.comment?` — "${MX.esc(t.comment)}"`:''}</div>`:''}
            </div>
          </div>`;
        });
        h += `</div>`;
      });

      if (!hasAny) h += `<div class="or-empty"><i class="fas fa-clock-rotate-left"></i><div>Aucun historique disponible</div></div>`;
      h += `</div>`;
      mc.innerHTML = h;
    } catch(e) {
      console.error('[OrgResp] history:', e);
      mc.innerHTML = `<div class="or-page">
        <div class="or-header">
          <div class="or-header-left"><div class="or-title">Historique</div></div>
          <div class="or-header-right"><button class="or-sec-btn" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i> Retour</button></div>
        </div>
        <div class="or-empty"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i><div>Erreur de chargement</div></div>
      </div>`;
    }
  }

  function _histToggle(wk) {
    const el = document.getElementById('or-hd-' + wk);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // ── EXPORT ──
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.OrgResp = {
    render, renderHistory,
    openAdd, openEdit, openDelete, openValidate,
    _doAdd, _doEdit, _doDelete, _doValidate,
    unvalidate, _histToggle,
  };
})();
