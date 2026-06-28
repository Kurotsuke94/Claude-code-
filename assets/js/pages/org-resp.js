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

  let _tasks    = [];
  let _unsub    = null;
  let _weekKey  = null;
  let _inHistory = false;

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
      'sécurité':      'var(--red)',
      'réglementaire': 'var(--orange)',
      'stock':         'var(--jour)',
      'administratif': 'var(--cyan)',
      'hébergement':   '#8B5CF6',
    };
    return m[cat] || 'var(--text3)';
  }
  function _prioColor(prio) {
    if (prio === 'urgente') return 'var(--red)';
    if (prio === 'haute')   return 'var(--orange)';
    return 'var(--text3)';
  }
  function _prioIcon(prio) {
    if (prio === 'urgente') return '🔴';
    if (prio === 'haute')   return '🟠';
    return '';
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
    if (isIndex) {
      console.warn(
        '[Maintix] Firestore index manquant :\n' +
        '  Collection : org_tasks\n' +
        '  Champs     : weekKey, order (ou isDefault)\n' +
        (link ? '  Lien       : ' + link : '  → Déployez firestore.indexes.json via Firebase CLI')
      );
    }

    const mc = document.getElementById('main-content');
    if (!mc) return;

    mc.innerHTML = `<div class="or-page">
      <div class="or-header">
        <div class="or-header-left"><div class="or-title">Organisation Responsable</div></div>
      </div>
      <div class="or-empty" style="gap:12px;padding:40px 20px">
        <i class="fas fa-${isIndex ? 'database' : 'triangle-exclamation'}" style="font-size:36px;color:var(--${isIndex ? 'orange' : 'red'})"></i>
        <div style="font-size:15px;font-weight:700;color:var(--text1)">${isIndex ? 'Configuration Firestore incomplète' : 'Erreur Firestore'}</div>
        <div style="font-size:13px;color:var(--text2);text-align:center;max-width:340px">
          ${isIndex
            ? 'Un index Firestore doit être créé sur <code>org_tasks</code>.<br>Déployez <strong>firestore.indexes.json</strong> via la Firebase CLI.'
            : MX.esc(err.message || String(err))
          }
        </div>
        ${link ? `<a href="${link}" target="_blank" rel="noopener" class="or-sec-btn" style="margin-top:4px"><i class="fas fa-external-link-alt"></i> Créer l'index →</a>` : ''}
        <button class="or-sec-btn" onclick="MX.Pages.OrgResp.render()" style="margin-top:4px">
          <i class="fas fa-rotate-right"></i> Réessayer
        </button>
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
    } catch(e) {
      console.warn('[OrgResp] seed init:', e.message);
      return;
    }

    // Carry over previous week's custom recurring tasks
    try {
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 7);
      const prevKey = _getWeekKey(prevDate);
      const prevSnap = await db.collection('org_tasks')
        .where('weekKey', '==', prevKey)
        .where('isDefault', '==', false)
        .get();
      const recurring = prevSnap.docs.map(d => d.data()).filter(t => t.type === 'hebdomadaire');
      if (recurring.length > 0) {
        const batch2 = db.batch();
        const name = _currentUserName();
        const baseOrder = DEFAULT_ORG_TASKS.length;
        recurring.forEach((t, i) => {
          batch2.set(db.collection('org_tasks').doc(), {
            title: t.title, description: t.description || '', category: t.category || 'autre',
            type: 'hebdomadaire', weekKey, done: false, doneBy: null, doneAt: null,
            comment: null, archivedFromActive: false, assignedTo: t.assignedTo || null,
            priority: t.priority || 'normale', createdBy: t.createdBy || name,
            createdAt: FV.serverTimestamp(), order: baseOrder + i, isDefault: false,
          });
        });
        await batch2.commit();
      }
    } catch(e) {
      console.warn('[OrgResp] carry-over (index requis weekKey+isDefault):', e.message);
    }
  }

  // ── SUBSCRIPTION ──
  // No .orderBy() on Firestore — sort client-side to avoid composite index requirement.
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
          err => { _onFirestoreError(err, 'subscribe'); }
        );
    } catch(e) {
      _onFirestoreError(e, 'subscribe-setup');
    }
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

  // ── MAIN RENDER ──
  function _doRender() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    try { _renderMain(mc); }
    catch(e) {
      console.error('[OrgResp] render error:', e);
      mc.innerHTML = `<div class="or-page"><div class="or-empty"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  function _typeBadge(type) {
    if (type === 'unique') return `<span class="or-type-badge or-type-badge--uni">📌 Unique</span>`;
    return `<span class="or-type-badge or-type-badge--heb">🔄 Récurrente</span>`;
  }

  function _renderMain(mc) {
    const todo    = _tasks.filter(t => !t.done && !t.archivedFromActive);
    const done    = _tasks.filter(t =>  t.done && !t.archivedFromActive);
    const allDone = _tasks.filter(t =>  t.done);

    const byUser = {};
    allDone.forEach(t => { const n = t.doneBy || '?'; byUser[n] = (byUser[n] || 0) + 1; });

    let h = `<div class="or-page">`;

    // Header
    h += `<div class="or-header">
      <div class="or-header-left">
        <div class="or-title">Organisation Responsable</div>
        <div class="or-week-label">${_weekLabel(_weekKey)}</div>
      </div>
      <div class="or-header-right">
        <button class="or-sec-btn" onclick="MX.Pages.OrgResp.renderHistory()">
          <i class="fas fa-clock-rotate-left"></i> Historique
        </button>
      </div>
    </div>`;

    // Alert
    if (_tasks.length === 0) {
      h += `<div class="or-alert or-alert--info"><i class="fas fa-circle-info"></i> Aucune tâche disponible pour cette semaine.</div>`;
    } else if (todo.length > 0) {
      h += `<div class="or-alert"><i class="fas fa-triangle-exclamation"></i> <strong>${todo.length} tâche${todo.length > 1 ? 's' : ''}</strong> encore à réaliser cette semaine</div>`;
    } else {
      h += `<div class="or-alert or-alert--ok"><i class="fas fa-circle-check"></i> Toutes les tâches sont réalisées cette semaine !</div>`;
    }

    // Répartition
    if (allDone.length > 0) {
      const maxC = Math.max(...Object.values(byUser), 1);
      h += `<div class="or-rep">
        <div class="or-rep-title">Répartition cette semaine</div>`;
      Object.entries(byUser).sort((a, b) => b[1] - a[1]).forEach(([name, cnt]) => {
        const col = _ucolor(name);
        const pct = Math.round(cnt / maxC * 100);
        h += `<div class="or-rep-row">
          <div class="or-rep-av" style="background:${col}">${_initials(name)}</div>
          <div class="or-rep-info">
            <div class="or-rep-name">${MX.esc(name)}</div>
            <div class="or-rep-bar"><div class="or-rep-bar-fill" style="width:${pct}%;background:${col}"></div></div>
          </div>
          <div class="or-rep-count">${cnt}</div>
        </div>`;
      });
      h += `</div>`;
    }

    // À FAIRE
    h += `<div class="or-sec-title">À FAIRE <span class="or-sec-badge">${todo.length}</span></div>`;
    if (todo.length === 0) {
      h += `<div class="or-empty-sec"><i class="fas fa-circle-check" style="color:var(--green)"></i> Aucune tâche en attente</div>`;
    } else {
      h += `<div class="or-list">`;
      todo.forEach(t => { h += _todoCard(t); });
      h += `</div>`;
    }

    // RÉALISÉES
    if (done.length > 0) {
      h += `<div class="or-sec-title">RÉALISÉES <span class="or-sec-badge or-sec-badge--done">${done.length}</span></div>`;
      h += `<div class="or-list">`;
      done.forEach(t => { h += _doneCard(t); });
      h += `</div>`;
    }

    h += `</div>`;
    h += `<button class="or-fab" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter une tâche"><i class="fas fa-plus"></i></button>`;

    mc.innerHTML = h;
  }

  // ── CARD TEMPLATES ──
  function _todoCard(t) {
    const col     = _catColor(t.category);
    const prioClr = _prioColor(t.priority);
    const prioIco = _prioIcon(t.priority);
    const asgn    = t.assignedTo ? `<span class="or-card-assign"><i class="fas fa-user" style="font-size:9px"></i> ${MX.esc(t.assignedTo)}</span>` : '';
    return `<div class="or-card">
      <div class="or-card-meta">
        <span class="or-cat" style="background:${col}22;color:${col}">${MX.esc(t.category || 'autre')}</span>
        ${_typeBadge(t.type)}
        ${asgn}
        ${prioIco ? `<span style="font-size:11px;color:${prioClr};font-weight:600">${prioIco} ${MX.esc(t.priority)}</span>` : ''}
      </div>
      <div class="or-card-row">
        <div class="or-card-title">${MX.esc(t.title)}</div>
        <div class="or-card-actions">
          <button class="or-act-btn or-act-btn--edit"  onclick="MX.Pages.OrgResp.openEdit('${t.id}')"   title="Modifier"><i class="fas fa-pen"></i></button>
          <button class="or-act-btn or-act-btn--del"   onclick="MX.Pages.OrgResp.openDelete('${t.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>
          <button class="or-act-btn or-act-btn--ok"    onclick="MX.Pages.OrgResp.openValidate('${t.id}')" title="Valider"><i class="fas fa-check"></i></button>
        </div>
      </div>
      ${t.description ? `<div class="or-card-desc">${MX.esc(t.description)}</div>` : ''}
    </div>`;
  }

  function _doneCard(t) {
    const col = _ucolor(t.doneBy || '');
    const dt  = t.doneAt ? _fmtDT(t.doneAt) : '';
    return `<div class="or-card or-card--done">
      <div class="or-card-row">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          <div class="or-done-av" style="background:${col};flex-shrink:0">${_initials(t.doneBy || '?')}</div>
          <div style="min-width:0">
            <div class="or-card-title or-card-title--done">${MX.esc(t.title)} ${_typeBadge(t.type)}</div>
            <div class="or-card-done-meta">
              Par <strong>${MX.esc(t.doneBy || '?')}</strong>${dt ? ` — ${dt}` : ''}
              ${t.comment ? ` — <em>"${MX.esc(t.comment)}"</em>` : ''}
            </div>
          </div>
        </div>
        <button class="or-act-btn" onclick="MX.Pages.OrgResp.unvalidate('${t.id}')" title="Annuler la validation"><i class="fas fa-rotate-left"></i></button>
      </div>
    </div>`;
  }

  // ── MODAL FORM HELPERS ──
  function _taskFormBody(defaults) {
    const d = defaults || {};
    return `<div class="or-form">
      <div class="or-form-row">
        <label>Titre *</label>
        <input id="or-f-title" class="fi" value="${MX.esc(d.title || '')}" placeholder="Nom de la tâche">
      </div>
      <div class="or-form-row">
        <label>Description</label>
        <input id="or-f-desc" class="fi" value="${MX.esc(d.description || '')}" placeholder="Détails optionnels">
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
            <option value="normale"${(d.priority||'normale')==='normale'?' selected':''}>Normale</option>
            <option value="haute"${d.priority==='haute'?' selected':''}>🟠 Haute</option>
            <option value="urgente"${d.priority==='urgente'?' selected':''}>🔴 Urgente</option>
          </select>
        </div>
        <div class="or-form-row">
          <label>Type</label>
          <select id="or-f-type" class="fi">
            <option value="hebdomadaire"${(d.type||'hebdomadaire')==='hebdomadaire'?' selected':''}>🔄 Récurrente</option>
            <option value="unique"${d.type==='unique'?' selected':''}>📌 Unique</option>
          </select>
        </div>
      </div>
    </div>`;
  }

  function _readForm() {
    return {
      title:      (document.getElementById('or-f-title')?.value || '').trim(),
      description:(document.getElementById('or-f-desc')?.value  || '').trim(),
      assignedTo: document.getElementById('or-f-assign')?.value || null,
      category:   document.getElementById('or-f-cat')?.value    || 'autre',
      priority:   document.getElementById('or-f-prio')?.value   || 'normale',
      type:       document.getElementById('or-f-type')?.value   || 'hebdomadaire',
    };
  }

  // ── ADD TASK ──
  function openAdd() {
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     'Ajouter une tâche pour cette semaine',
      body:    _taskFormBody(),
      actions: [
        { label: 'Ajouter', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => { const el = document.getElementById('or-f-title'); if (el) el.focus(); }, 50);
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
        order: _tasks.length, isDefault: false,
      });
      MX.syncEnd();
      MX.toast('Tâche ajoutée ✓');
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  // ── EDIT TASK ──
  function openEdit(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Modifier la tâche',
      sub:     '',
      body:    _taskFormBody(t),
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doEdit(taskId) },
        { label: 'Annuler',     cls: 'cancel' }
      ]
    });
    setTimeout(() => { const el = document.getElementById('or-f-title'); if (el) el.focus(); }, 50);
  }

  async function _doEdit(taskId) {
    const data = _readForm();
    if (!data.title) { MX.toast('Le titre est obligatoire', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        title:       data.title,
        description: data.description,
        assignedTo:  data.assignedTo || null,
        category:    data.category,
        priority:    data.priority,
        type:        data.type,
      });
      MX.syncEnd();
      MX.toast('Tâche modifiée ✓');
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  // ── DELETE TASK ──
  function openDelete(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Supprimer la tâche',
      sub:     MX.esc(t.title),
      body:    `<div style="font-size:13px;color:var(--text2);padding:4px 0">Cette tâche sera définitivement supprimée. Cette action est irréversible.</div>`,
      actions: [
        { label: 'Supprimer', cls: 'primary-btn', fn: () => _doDelete(taskId) },
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
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  // ── VALIDATE ──
  function openValidate(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Valider la tâche',
      sub:     MX.esc(t.title),
      body:    `<div style="margin-bottom:4px">
        <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:6px">Commentaire (optionnel)</label>
        <textarea id="or-val-cmt" class="fi" style="min-height:64px;resize:vertical" placeholder="Tout était OK, rien à signaler…"></textarea>
      </div>`,
      actions: [
        { label: 'Valider',  cls: 'primary-btn', fn: () => _doValidate(taskId) },
        { label: 'Annuler',  cls: 'cancel' }
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
      const update = { done: true, doneBy: name, doneAt: FV.serverTimestamp(), comment: comment || null };
      if (task && task.type === 'unique') update.archivedFromActive = true;
      await db.collection('org_tasks').doc(taskId).update(update);
      MX.syncEnd();
      MX.toast('Tâche validée ✓');
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  async function unvalidate(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        done: false, doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
      });
      MX.syncEnd();
      MX.toast('Validation annulée');
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  // ── HISTORY ──
  async function renderHistory() {
    _inHistory = true;
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page"><div class="or-loading"><i class="fas fa-spinner fa-spin"></i> Chargement de l'historique…</div></div>`;

    try {
      const weeks = [];
      const now   = new Date();
      for (let i = 0; i < 8; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        weeks.push(_getWeekKey(d));
      }

      const snap = await db.collection('org_tasks').where('weekKey', 'in', weeks).get();
      const byWeek = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (!byWeek[data.weekKey]) byWeek[data.weekKey] = [];
        byWeek[data.weekKey].push({ id: d.id, ...data });
      });

      let h = `<div class="or-page">`;
      h += `<div class="or-header">
        <div class="or-header-left">
          <div class="or-title">Historique</div>
          <div class="or-week-label">8 dernières semaines</div>
        </div>
        <div class="or-header-right">
          <button class="or-sec-btn" onclick="MX.Pages.OrgResp.render()">
            <i class="fas fa-arrow-left"></i> Retour
          </button>
        </div>
      </div>`;

      let hasAny = false;
      weeks.forEach(wk => {
        const tasks    = (byWeek[wk] || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        const total    = tasks.length;
        const doneCnt  = tasks.filter(t => t.done).length;
        if (total === 0) return;
        hasAny = true;

        const pct    = total ? Math.round(doneCnt / total * 100) : 0;
        const isCur  = wk === _weekKey;
        const pctCls = pct >= 80 ? 'or-hist-bar-fill--done' : pct >= 40 ? 'or-hist-bar-fill--prog' : '';

        h += `<div class="or-hist-week${isCur ? ' or-hist-week--current' : ''}" onclick="MX.Pages.OrgResp._histToggle('${wk}')">
          <div class="or-hist-row">
            <div class="or-hist-wlabel">${_weekLabel(wk)}${isCur ? ' <span class="or-hist-cur">en cours</span>' : ''}</div>
            <div class="or-hist-stat">${doneCnt}/${total} — ${pct}%</div>
          </div>
          <div class="or-hist-bar"><div class="or-hist-bar-fill ${pctCls}" style="width:${pct}%"></div></div>
        </div>
        <div class="or-hist-detail" id="or-hd-${wk}" style="display:none">`;

        tasks.forEach(t => {
          const asgn = t.assignedTo ? ` · <span style="color:var(--text3)">↗ ${MX.esc(t.assignedTo)}</span>` : '';
          h += `<div class="or-hist-task${t.done ? ' or-hist-task--done' : ''}">
            <i class="fas fa-${t.done ? 'circle-check' : 'circle'}" style="color:${t.done ? 'var(--green)' : 'var(--text3)'}"></i>
            <div class="or-hist-task-body">
              <div class="or-hist-task-title">${MX.esc(t.title)} ${_typeBadge(t.type)}${asgn}</div>
              ${t.done && t.doneBy ? `<div class="or-hist-task-meta">Par <strong>${MX.esc(t.doneBy)}</strong>${t.doneAt ? ` — ${_fmtDT(t.doneAt)}` : ''}${t.comment ? ` — "${MX.esc(t.comment)}"` : ''}</div>` : ''}
            </div>
          </div>`;
        });

        h += `</div>`;
      });

      if (!hasAny) {
        h += `<div class="or-empty"><i class="fas fa-clock-rotate-left"></i><div>Aucun historique disponible</div></div>`;
      }

      h += `</div>`;
      mc.innerHTML = h;
    } catch(e) {
      console.error('[OrgResp] renderHistory:', e.message || e);
      const isIndex  = e.code === 'failed-precondition' || (e.message && e.message.includes('index'));
      const linkMatch = e.message && e.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
      const link = linkMatch ? linkMatch[0] : null;
      if (isIndex) console.warn('[Maintix] Index manquant org_tasks (weekKey in)' + (link ? '\n  Lien: ' + link : ''));
      mc.innerHTML = `<div class="or-page">
        <div class="or-header">
          <div class="or-header-left"><div class="or-title">Historique</div></div>
          <div class="or-header-right">
            <button class="or-sec-btn" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i> Retour</button>
          </div>
        </div>
        <div class="or-empty" style="gap:12px;padding:40px 20px">
          <i class="fas fa-${isIndex ? 'database' : 'triangle-exclamation'}" style="color:var(--${isIndex ? 'orange' : 'red'})"></i>
          <div style="font-weight:700">${isIndex ? 'Index Firestore manquant' : 'Erreur de chargement'}</div>
          <div style="font-size:13px;color:var(--text2);text-align:center;max-width:320px">
            ${isIndex ? 'Déployez <strong>firestore.indexes.json</strong> via la Firebase CLI.' : MX.esc(e.message || String(e))}
          </div>
          ${link ? `<a href="${link}" target="_blank" rel="noopener" class="or-sec-btn"><i class="fas fa-external-link-alt"></i> Créer l'index →</a>` : ''}
        </div>
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
