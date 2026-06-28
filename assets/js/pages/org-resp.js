(function () {
  'use strict';
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
  function _catConfig(cat) {
    const m = {
      'sécurité':      { color: '#EF4444', icon: 'fa-shield-halved' },
      'réglementaire': { color: '#F59E0B', icon: 'fa-scale-balanced' },
      'stock':         { color: '#3B82F6', icon: 'fa-boxes-stacked' },
      'administratif': { color: '#06B6D4', icon: 'fa-file-lines' },
      'hébergement':   { color: '#8B5CF6', icon: 'fa-bed' },
    };
    return m[cat] || { color: '#6B7280', icon: 'fa-tag' };
  }
  function _prioConfig(prio) {
    if (prio === 'critique') return { label: 'Critique', color: '#DC2626', bg: 'rgba(220,38,38,.12)', icon: '🚨' };
    if (prio === 'urgente')  return { label: 'Urgente',  color: '#EF4444', bg: 'rgba(239,68,68,.10)', icon: '🔴' };
    if (prio === 'haute')    return { label: 'Haute',    color: '#F59E0B', bg: 'rgba(245,158,11,.10)', icon: '🟠' };
    return null;
  }
  function _taskStatus(t) {
    if (t.done) return 'done';
    if (t.status === 'inprogress') return 'inprogress';
    return 'todo';
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
    console.error(`[OrgResp] Firestore (${ctx}):`, err.message || err);
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page">
      <div class="or-header"><div class="or-header-left"><div class="or-title">Organisation Responsable</div></div></div>
      <div class="or-empty-state">
        <i class="fas fa-triangle-exclamation" style="font-size:36px;color:var(--red)"></i>
        <div style="font-size:15px;font-weight:700">Erreur de chargement</div>
        <div style="font-size:13px;color:var(--text2)">${MX.esc(err.message || String(err))}</div>
        <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-rotate-right"></i> Réessayer</button>
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
          ...t, weekKey, done: false, status: 'todo',
          doneBy: null, doneAt: null, comment: null,
          assignedTo: null, priority: 'normale',
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
            type: 'hebdomadaire', weekKey, done: false, status: 'todo',
            doneBy: null, doneAt: null, comment: null,
            assignedTo: t.assignedTo || null, priority: t.priority || 'normale',
            createdBy: t.createdBy || name, createdAt: FV.serverTimestamp(),
            order: DEFAULT_ORG_TASKS.length + i, isDefault: false,
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
      if (mc) mc.innerHTML = `<div class="or-page"><div class="or-empty-state"><i class="fas fa-lock" style="font-size:32px;color:var(--text3)"></i><div>Accès réservé aux responsables</div></div></div>`;
      return;
    }
    _inHistory = false;
    _weekKey   = _getWeekKey(new Date());
    _subscribe(_weekKey);
  }

  function _doRender() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    try { _renderKanban(mc); }
    catch(e) {
      console.error('[OrgResp] render error:', e);
      mc.innerHTML = `<div class="or-page"><div class="or-empty-state"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  // ── BADGE HELPERS ──
  function _typeBadge(type) {
    if (type === 'unique')   return `<span class="or-badge or-badge--type-uni">📌 Unique</span>`;
    if (type === 'mensuelle')return `<span class="or-badge or-badge--type-men">🗓 Mensuelle</span>`;
    return `<span class="or-badge or-badge--type-rec">♻️ Récurrente</span>`;
  }

  // ── KANBAN CARD ──
  function _kanbanCard(t, col) {
    const esc    = MX.esc;
    const cat    = _catConfig(t.category);
    const prio   = _prioConfig(t.priority);
    const aCol   = _ucolor(t.assignedTo || '');
    const isDone = col === 'done';

    let tags = ``;
    if (t.category && t.category !== 'autre') {
      tags += `<span class="or-badge" style="background:${cat.color}18;color:${cat.color}">
        <i class="fas ${cat.icon}"></i> ${esc(t.category)}
      </span>`;
    }
    if (prio) tags += `<span class="or-badge or-badge--prio" style="background:${prio.bg};color:${prio.color}">${prio.icon} ${prio.label}</span>`;
    tags += _typeBadge(t.type);

    const assignHtml = t.assignedTo
      ? `<span class="or-av" style="background:${aCol}" title="${esc(t.assignedTo)}">${_initials(t.assignedTo)}</span>
         <span class="or-av-name">${esc(t.assignedTo)}</span>`
      : `<span class="or-av-none"><i class="fas fa-user-slash"></i> Non assigné</span>`;

    let actionsHtml = '';
    if (!isDone) {
      actionsHtml += `<button class="or-icon-btn or-icon-btn--edit" onclick="MX.Pages.OrgResp.openEdit('${t.id}')" title="Modifier"><i class="fas fa-pen"></i></button>`;
      actionsHtml += `<button class="or-icon-btn or-icon-btn--del" onclick="MX.Pages.OrgResp.openDelete('${t.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>`;
      if (col === 'todo') {
        actionsHtml += `<button class="or-icon-btn or-icon-btn--play" onclick="MX.Pages.OrgResp.moveToInProgress('${t.id}')" title="Démarrer"><i class="fas fa-play"></i></button>`;
      } else {
        actionsHtml += `<button class="or-icon-btn" onclick="MX.Pages.OrgResp.moveToTodo('${t.id}')" title="Remettre à faire"><i class="fas fa-rotate-left"></i></button>`;
      }
      actionsHtml += `<button class="or-icon-btn or-icon-btn--ok" onclick="MX.Pages.OrgResp.openValidate('${t.id}')" title="Marquer terminé"><i class="fas fa-check"></i></button>`;
    } else {
      const dt = t.doneAt ? _fmtDT(t.doneAt) : '';
      actionsHtml += `<span class="or-done-meta">${t.doneBy ? esc(t.doneBy) : ''}${dt ? ' · ' + dt : ''}</span>`;
      actionsHtml += `<button class="or-icon-btn" onclick="MX.Pages.OrgResp.unvalidate('${t.id}')" title="Annuler la validation"><i class="fas fa-rotate-left"></i></button>`;
    }

    return `<div class="or-kcard${isDone ? ' or-kcard--done' : ''}" data-id="${t.id}">
      <div class="or-kcard-tags">${tags}</div>
      <div class="or-kcard-title">${esc(t.title)}</div>
      ${t.description ? `<div class="or-kcard-desc">${esc(t.description)}</div>` : ''}
      ${t.comment && isDone ? `<div class="or-kcard-comment"><i class="fas fa-quote-left" style="font-size:9px;opacity:.5"></i> ${esc(t.comment)}</div>` : ''}
      <div class="or-kcard-foot">
        <div class="or-kcard-assign">${assignHtml}</div>
        <div class="or-kcard-actions">${actionsHtml}</div>
      </div>
    </div>`;
  }

  // ── MAIN KANBAN RENDER ──
  function _renderKanban(mc) {
    const active = _tasks.filter(t => !t.archivedFromActive);
    const cols = {
      todo:       active.filter(t => !t.done && t.status !== 'inprogress'),
      inprogress: active.filter(t => !t.done && t.status === 'inprogress'),
      done:       active.filter(t => t.done),
    };
    const total = active.length;
    const doneCnt = cols.done.length;
    const pct   = total ? Math.round(doneCnt / total * 100) : 0;
    const pctC  = pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';

    let h = `<div class="or-page">
      <div class="or-header">
        <div class="or-header-left">
          <div class="or-title">Organisation Responsable</div>
          <div class="or-week-label">${_weekLabel(_weekKey)}</div>
        </div>
        <div class="or-header-right">
          <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.renderHistory()">
            <i class="fas fa-clock-rotate-left"></i><span class="or-btn-lbl"> Historique</span>
          </button>
          <button class="or-btn-primary" onclick="MX.Pages.OrgResp.openAdd()">
            <i class="fas fa-plus"></i><span class="or-btn-lbl"> Ajouter</span>
          </button>
        </div>
      </div>

      <div class="or-progress-bar">
        <div class="or-progress-track"><div class="or-progress-fill" style="width:${pct}%;background:${pctC}"></div></div>
        <span class="or-progress-lbl" style="color:${pctC}">${pct}% — ${doneCnt}/${total} tâches</span>
      </div>

      <div class="or-kanban">`;

    const colDefs = [
      { key: 'todo',       label: 'À faire',   dot: '#6B7280', ico: 'fa-circle-dot' },
      { key: 'inprogress', label: 'En cours',  dot: '#3B82F6', ico: 'fa-circle-play' },
      { key: 'done',       label: 'Terminé',   dot: '#10B981', ico: 'fa-circle-check' },
    ];

    colDefs.forEach(({ key, label, dot, ico }) => {
      const cards = cols[key];
      h += `<div class="or-kcol" data-col="${key}">
        <div class="or-kcol-hdr">
          <span class="or-kcol-dot" style="background:${dot}"></span>
          <span class="or-kcol-label">${label}</span>
          <span class="or-kcol-cnt">${cards.length}</span>
          ${key !== 'done' ? `<button class="or-kcol-add" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter une tâche"><i class="fas fa-plus"></i></button>` : ''}
        </div>
        <div class="or-kcol-body" id="or-kcol-${key}">`;
      if (cards.length === 0) {
        h += `<div class="or-kcol-empty">
          <i class="fas ${ico}" style="font-size:20px;color:${dot};opacity:.3"></i>
          <span>${key === 'done' ? 'Aucune tâche terminée' : 'Aucune tâche'}</span>
        </div>`;
      } else {
        cards.forEach(t => { h += _kanbanCard(t, key); });
      }
      h += `</div></div>`;
    });

    h += `</div></div>`;
    h += `<button class="or-fab" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter une tâche"><i class="fas fa-plus"></i></button>`;

    mc.innerHTML = h;
  }

  // ── FORM ──
  function _taskFormBody(defaults) {
    const d    = defaults || {};
    const prio = d.priority || 'normale';
    const type = d.type || 'hebdomadaire';
    const cats = ['sécurité','réglementaire','stock','administratif','hébergement','autre'];
    return `<div class="or-form">
      <div class="or-form-row">
        <label class="or-form-lbl">Titre <span style="color:var(--red)">*</span></label>
        <input id="or-f-title" class="fi" value="${MX.esc(d.title || '')}" placeholder="Nom de la tâche" maxlength="150">
      </div>
      <div class="or-form-row">
        <label class="or-form-lbl">Description</label>
        <input id="or-f-desc" class="fi" value="${MX.esc(d.description || '')}" placeholder="Détails optionnels" maxlength="300">
      </div>
      <div class="or-form-2col">
        <div class="or-form-row">
          <label class="or-form-lbl">Responsable</label>
          <select id="or-f-assign" class="fi">${_getUserOptions(d.assignedTo || '')}</select>
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Catégorie</label>
          <select id="or-f-cat" class="fi">
            ${cats.map(c => `<option value="${c}"${c === (d.category || 'autre') ? ' selected' : ''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="or-form-2col">
        <div class="or-form-row">
          <label class="or-form-lbl">Priorité</label>
          <select id="or-f-prio" class="fi">
            <option value="normale"${prio==='normale'?' selected':''}>Normale</option>
            <option value="haute"${prio==='haute'?' selected':''}>🟠 Haute</option>
            <option value="urgente"${prio==='urgente'?' selected':''}>🔴 Urgente</option>
            <option value="critique"${prio==='critique'?' selected':''}>🚨 Critique</option>
          </select>
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Type</label>
          <div class="or-type-pills">
            ${[
              { v:'hebdomadaire', l:'♻️ Récurrente' },
              { v:'mensuelle',    l:'🗓 Mensuelle'  },
              { v:'unique',       l:'📌 Unique'      },
            ].map(({ v, l }) => `<label class="or-type-pill${v===type?' or-type-pill--on':''}">
              <input type="radio" name="or-f-type" value="${v}" ${v===type?'checked':''} style="display:none"
                onchange="this.closest('.or-type-pills').querySelectorAll('.or-type-pill').forEach(x=>x.classList.remove('or-type-pill--on'));this.closest('.or-type-pill').classList.add('or-type-pill--on')">
              ${l}
            </label>`).join('')}
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
        done: false, status: 'todo',
        doneBy: null, doneAt: null, comment: null,
        archivedFromActive: false,
        createdBy: name, createdAt: FV.serverTimestamp(),
        order: _tasks.filter(t => !t.done).length, isDefault: false,
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
          Cette tâche sera <strong style="color:var(--red)">définitivement supprimée</strong>.<br>Cette action est irréversible.
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

  // ── COLUMN MOVES ──
  async function moveToInProgress(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({ status: 'inprogress', done: false });
      MX.syncEnd();
    } catch(e) { MX.syncFail(); MX.toast('Erreur', true); }
  }

  async function moveToTodo(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({ status: 'todo', done: false, doneBy: null, doneAt: null, comment: null });
      MX.syncEnd();
    } catch(e) { MX.syncFail(); MX.toast('Erreur', true); }
  }

  // ── VALIDATE ──
  function openValidate(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    const isRec = t.type !== 'unique';
    MX.showModal({
      title: 'Marquer terminée',
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
        { label: 'Terminer', cls: 'primary-btn', fn: () => _doValidate(taskId) },
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
      const update = { done: true, status: 'done', doneBy: name, doneAt: FV.serverTimestamp(), comment };
      if (task && task.type === 'unique') update.archivedFromActive = true;
      await db.collection('org_tasks').doc(taskId).update(update);
      MX.syncEnd();
      MX.toast('Tâche terminée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function unvalidate(taskId) {
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        done: false, status: 'todo', doneBy: null, doneAt: null, comment: null, archivedFromActive: false,
      });
      MX.syncEnd();
      MX.toast('Validation annulée');
    } catch(e) { MX.syncFail(); MX.toast('Erreur', true); }
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
            <button class="or-btn-secondary" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i><span class="or-btn-lbl"> Retour</span></button>
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

      if (!hasAny) h += `<div class="or-empty-state"><i class="fas fa-clock-rotate-left"></i><div>Aucun historique disponible</div></div>`;
      h += `</div>`;
      mc.innerHTML = h;
    } catch(e) {
      console.error('[OrgResp] history:', e);
      mc.innerHTML = `<div class="or-page">
        <div class="or-header">
          <div class="or-header-left"><div class="or-title">Historique</div></div>
          <div class="or-header-right"><button class="or-btn-secondary" onclick="MX.Pages.OrgResp.render()"><i class="fas fa-arrow-left"></i> Retour</button></div>
        </div>
        <div class="or-empty-state"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i><div>Erreur de chargement</div></div>
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
    moveToInProgress, moveToTodo,
    unvalidate, _histToggle,
  };
})();
