(function () {
  const FV = firebase.firestore.FieldValue;

  const DEFAULT_ORG_TASKS = [
    { title: 'Contrôle carnets sécurité',          category: 'sécurité',      description: '' },
    { title: 'Vérification registre piscine',       category: 'réglementaire', description: '' },
    { title: 'Contrôle stock EPI',                  category: 'stock',         description: '' },
    { title: 'Contrôle affichages réglementaires',  category: 'réglementaire', description: '' },
    { title: 'Vérification contrats prestataires',  category: 'administratif', description: '' },
    { title: 'Contrôle chambres PMR',               category: 'hébergement',   description: '' },
  ];

  let _tasks   = [];
  let _unsub   = null;
  let _weekKey = null;
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
  function _currentUserName() {
    const cu = MX.state.currentUser;
    const ad = MX.state.adminUser;
    if (cu) return cu.name;
    if (ad) return (ad.email || 'admin').split('@')[0];
    return 'Inconnu';
  }

  // ── SEED ──
  async function _seedWeek(weekKey) {
    const snap = await db.collection('org_tasks').where('weekKey', '==', weekKey).limit(1).get();
    if (!snap.empty) return;
    const name = _currentUserName();
    const batch = db.batch();
    DEFAULT_ORG_TASKS.forEach((t, i) => {
      batch.set(db.collection('org_tasks').doc(), {
        ...t,
        weekKey,
        done: false,
        doneBy: null,
        doneAt: null,
        comment: null,
        createdBy: name,
        createdAt: FV.serverTimestamp(),
        order: i,
        isDefault: true,
      });
    });
    await batch.commit();
  }

  // ── SUBSCRIPTION ──
  function _subscribe(weekKey) {
    if (_unsub) { _unsub(); _unsub = null; }
    _unsub = db.collection('org_tasks')
      .where('weekKey', '==', weekKey)
      .orderBy('order')
      .onSnapshot(snap => {
        _tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!_inHistory) _doRender();
      });
    _seedWeek(weekKey).catch(e => console.error('[OrgResp] seed:', e));
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
      mc.innerHTML = `<div class="or-page"><div class="or-empty"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  function _renderMain(mc) {
    const todo  = _tasks.filter(t => !t.done);
    const done  = _tasks.filter(t =>  t.done);

    const byUser = {};
    done.forEach(t => { const n = t.doneBy || '?'; byUser[n] = (byUser[n] || 0) + 1; });

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
      h += `<div class="or-alert or-alert--info"><i class="fas fa-spinner fa-spin"></i> Chargement…</div>`;
    } else if (todo.length > 0) {
      h += `<div class="or-alert"><i class="fas fa-triangle-exclamation"></i> <strong>${todo.length} tâche${todo.length > 1 ? 's' : ''}</strong> encore à réaliser cette semaine</div>`;
    } else {
      h += `<div class="or-alert or-alert--ok"><i class="fas fa-circle-check"></i> Toutes les tâches sont réalisées cette semaine !</div>`;
    }

    // Répartition
    if (done.length > 0) {
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

  function _todoCard(t) {
    const col = _catColor(t.category);
    return `<div class="or-todo-card">
      <div class="or-todo-left">
        <span class="or-cat" style="background:${col}22;color:${col}">${MX.esc(t.category || '')}</span>
        <div class="or-todo-title">${MX.esc(t.title)}</div>
        ${t.description ? `<div class="or-todo-desc">${MX.esc(t.description)}</div>` : ''}
      </div>
      <button class="or-ok-btn" onclick="MX.Pages.OrgResp.openValidate('${t.id}')">
        <i class="fas fa-check"></i>
      </button>
    </div>`;
  }

  function _doneCard(t) {
    const col = _ucolor(t.doneBy || '');
    const dt  = t.doneAt ? _fmtDT(t.doneAt) : '';
    return `<div class="or-done-card">
      <div class="or-done-av" style="background:${col}">${_initials(t.doneBy || '?')}</div>
      <div class="or-done-body">
        <div class="or-done-title">${MX.esc(t.title)}</div>
        <div class="or-done-meta">Réalisé par <strong>${MX.esc(t.doneBy || '?')}</strong>${dt ? ` — ${dt}` : ''}</div>
        ${t.comment ? `<div class="or-done-comment">"${MX.esc(t.comment)}"</div>` : ''}
      </div>
      <button class="or-undo-btn" onclick="MX.Pages.OrgResp.unvalidate('${t.id}')" title="Annuler la validation"><i class="fas fa-rotate-left"></i></button>
    </div>`;
  }

  // ── VALIDATE ──
  function openValidate(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal(
      'Valider la tâche',
      MX.esc(t.title),
      [
        { label: 'Valider', cls: 'primary-btn', fn: `MX.Pages.OrgResp._doValidate('${taskId}')` },
        { label: 'Annuler', cls: 'cancel' }
      ],
      `<div style="margin-bottom:4px">
        <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:6px">Commentaire (optionnel)</label>
        <textarea id="or-val-cmt" class="fi" style="min-height:64px;resize:vertical" placeholder="Tout était OK, rien à signaler…"></textarea>
      </div>`
    );
  }

  async function _doValidate(taskId) {
    const name    = _currentUserName();
    const comment = (document.getElementById('or-val-cmt')?.value || '').trim() || null;
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        done: true, doneBy: name, doneAt: FV.serverTimestamp(), comment: comment || null,
      });
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
        done: false, doneBy: null, doneAt: null, comment: null,
      });
      MX.syncEnd();
      MX.toast('Validation annulée');
    } catch(e) {
      MX.syncFail();
      MX.toast('Erreur: ' + e.message, true);
    }
  }

  // ── ADD TASK ──
  function openAdd() {
    MX.showModal(
      'Nouvelle tâche',
      'Ajouter une tâche pour cette semaine',
      [
        { label: 'Ajouter', cls: 'primary-btn', fn: 'MX.Pages.OrgResp._doAdd()' },
        { label: 'Annuler', cls: 'cancel' }
      ],
      `<div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Titre *</label>
          <input id="or-add-title" class="fi" placeholder="Nom de la tâche">
        </div>
        <div>
          <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Description</label>
          <input id="or-add-desc" class="fi" placeholder="Détails optionnels">
        </div>
        <div>
          <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px">Catégorie</label>
          <select id="or-add-cat" class="fi">
            <option value="sécurité">Sécurité</option>
            <option value="réglementaire">Réglementaire</option>
            <option value="stock">Stock</option>
            <option value="administratif">Administratif</option>
            <option value="hébergement">Hébergement</option>
            <option value="autre">Autre</option>
          </select>
        </div>
      </div>`
    );
    setTimeout(() => { const el = document.getElementById('or-add-title'); if (el) el.focus(); }, 50);
  }

  async function _doAdd() {
    const title = (document.getElementById('or-add-title')?.value || '').trim();
    if (!title) { MX.toast('Le titre est obligatoire', true); return; }
    const desc = (document.getElementById('or-add-desc')?.value || '').trim();
    const cat  = document.getElementById('or-add-cat')?.value || 'autre';
    const name = _currentUserName();
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').add({
        title, description: desc, category: cat,
        weekKey: _weekKey,
        done: false, doneBy: null, doneAt: null, comment: null,
        createdBy: name,
        createdAt: FV.serverTimestamp(),
        order: _tasks.length,
        isDefault: false,
      });
      MX.syncEnd();
      MX.toast('Tâche ajoutée ✓');
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

      weeks.forEach(wk => {
        const tasks = (byWeek[wk] || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        const total = tasks.length;
        const doneCnt = tasks.filter(t => t.done).length;
        if (total === 0) return;

        const pct  = total ? Math.round(doneCnt / total * 100) : 0;
        const isCur = wk === _weekKey;
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
          h += `<div class="or-hist-task${t.done ? ' or-hist-task--done' : ''}">
            <i class="fas fa-${t.done ? 'circle-check' : 'circle'}" style="color:${t.done ? 'var(--green)' : 'var(--text3)'}"></i>
            <div class="or-hist-task-body">
              <div class="or-hist-task-title">${MX.esc(t.title)}</div>
              ${t.done && t.doneBy ? `<div class="or-hist-task-meta">Par <strong>${MX.esc(t.doneBy)}</strong>${t.doneAt ? ` — ${_fmtDT(t.doneAt)}` : ''}</div>` : ''}
            </div>
          </div>`;
        });

        h += `</div>`;
      });

      h += `</div>`;
      mc.innerHTML = h;
    } catch(e) {
      mc.innerHTML = `<div class="or-page"><div class="or-empty"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  function _histToggle(wk) {
    const el = document.getElementById('or-hd-' + wk);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // ── EXPORT ──
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.OrgResp = {
    render,
    renderHistory,
    openValidate,
    _doValidate,
    unvalidate,
    openAdd,
    _doAdd,
    _histToggle,
  };
})();
