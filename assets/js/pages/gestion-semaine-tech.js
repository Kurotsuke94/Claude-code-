(function () {
  'use strict';

  // ── GESTION SEMAINE TECH ────────────────────────────────────────────────
  // Écran de préparation à l'avance des créneaux/checklists par le
  // responsable ou l'admin. Remplace la "prise de créneau" technicien par
  // une affectation DATE + CRÉNEAU + TECHNICIEN + MODÈLE préparée en amont
  // (voir assets/js/db.js — collections shift_templates / week_slots).
  //
  // SÉCURITÉ : chaque fonction qui écrit des données vérifie elle-même
  // MX.Auth.canSeeAll() (admin OU responsable) en tout début de fonction,
  // même quand le bouton qui l'appelle n'est déjà rendu que pour ces
  // rôles — un appel direct depuis la console (ou un bouton resté affiché
  // par erreur) ne doit jamais pouvoir écrire quoi que ce soit pour un
  // technicien. Ceci reste une protection CÔTÉ CLIENT : firestore.rules
  // n'a volontairement pas été modifié dans cette phase (hors scope
  // explicitement validé) — voir le rapport final pour le détail de ce
  // risque résiduel, non masqué ici.

  const PALETTE = ['#FDE047', '#3B82F6', '#EF4444', '#F97316', '#22C55E', '#A78BFA', '#EC4899', '#6B7280', '#06B6D4', '#F43F5E'];
  const ICONS   = ['☀️', '🌤', '🌙', '🎉', '🟢', '🚨', '🔧', '⭐', '🏖️', '🌡️', '📦', '🏨'];

  let _viewWeekKey   = null;   // weekKey actuellement affiché
  let _tab           = 'week'; // 'week' | 'templates' | 'shifts'
  let _weekData       = null;  // doc week_slots courant (ou null si jamais préparé)
  let _weekLoading     = false;
  let _weekUnsub        = null; // abonnement propre à cet écran, indépendant de celui d'app.js
  let _templatesLoaded = false;
  let _editingTplId    = null; // id du modèle en cours d'édition (modal), 'new' pour création
  let _editTasks        = [];  // tâches du modèle en cours d'édition (état local du formulaire)
  let _resizeBound      = false;
  let _showMissions     = false; // affichage détaillé des tâches (répartition temporaire) — non persisté, réinitialisé à chaque visite
  let _dragTask         = null;  // { dayId, fromInstanceId, taskId } — drag & drop desktop en cours

  function _canEdit() { return !!(window.MX && MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll()); }

  function _users() {
    return (MX.state.users || []).filter(u => u.name && !u.hidden && u.role !== 'admin');
  }

  function _templates() { return MX.state.shiftTemplates || []; }
  function _tplById(id) { return _templates().find(t => t.id === id) || null; }

  function _isActive() { return MX.state.currentPage === 'gestion-semaine-tech'; }
  function _rerenderIfActive() { if (_isActive()) render(); }

  // ── DATA LOADING ─────────────────────────────────────────────────────────
  function _ensureTemplatesLoaded() {
    if (_templatesLoaded) return;
    _templatesLoaded = true;
    MX.DB.listenShiftTemplates(list => {
      MX.state.shiftTemplates = list;
      _rerenderIfActive();
    });
  }

  function _loadWeek(weekKey) {
    if (_weekUnsub) { _weekUnsub(); _weekUnsub = null; }
    _weekLoading = true;
    _weekUnsub = MX.DB.listenWeekSlots(weekKey, data => {
      // Ignore une réponse tardive pour une semaine qu'on a déjà quittée
      if (weekKey !== _viewWeekKey) return;
      _weekData    = data;
      _weekLoading = false;
      _rerenderIfActive();
    });
  }

  function _switchWeek(weekKey) {
    _viewWeekKey = weekKey;
    _weekData    = null;
    _loadWeek(weekKey);
    render();
  }

  // ── ENTRY POINT ──────────────────────────────────────────────────────────
  function render() {
    if (!_canEdit()) { MX.showPage('home'); return; }
    const mc = document.getElementById('main-content');
    if (!mc) return;

    if (!_resizeBound) {
      _resizeBound = true;
      let t = null;
      window.addEventListener('resize', function () {
        clearTimeout(t);
        t = setTimeout(function () { _rerenderIfActive(); }, 200);
      });
    }

    _ensureTemplatesLoaded();
    if (!_viewWeekKey) { _viewWeekKey = MX.weekKeyOf(new Date()); _loadWeek(_viewWeekKey); }

    const esc = MX.esc;
    const currKey = MX.weekKeyOf(new Date());
    const isCurrent = _viewWeekKey === currKey;
    const weekLabel = (_weekData && _weekData.weekLabel) || MX.weekLabelOf(_viewWeekKey);

    let h = '<div class="ph">';
    h += '<div class="ph-eye">Responsable · préparation des créneaux</div>';
    h += '<div class="ph-row"><div><div class="ph-title">Gestion semaine tech</div>';
    h += '<div class="ph-sub">Préparez et attribuez les créneaux et checklists pour les semaines à venir.</div></div></div>';
    h += '</div>';

    h += '<div class="page-body">';

    // ── Tabs ──
    h += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
    h += _tabBtn('week',      '<i class="fas fa-user-clock"></i> Planning semaine');
    h += _tabBtn('templates', '<i class="fas fa-layer-group"></i> Modèles de créneaux');
    h += _tabBtn('shifts',    '<i class="fas fa-gear"></i> Configuration des horaires');
    h += '</div>';

    if (_tab === 'week') {
      // ── Week nav ──
      h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">';
      h += '<button class="cl-quick-btn" style="width:auto;padding:8px 12px" onclick="MX.Pages.GestSemaine._prevWeek()"><i class="fas fa-chevron-left"></i></button>';
      h += '<div style="flex:1;min-width:200px;text-align:center;font-size:13px;font-weight:600;padding:8px 12px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px"><i class="fas fa-calendar-days" style="margin-right:6px;color:var(--cyan)"></i>' + esc(weekLabel) + '</div>';
      h += '<button class="cl-quick-btn" style="width:auto;padding:8px 12px" onclick="MX.Pages.GestSemaine._nextWeek()"><i class="fas fa-chevron-right"></i></button>';
      if (!isCurrent) h += '<button class="cl-quick-btn" style="width:auto;padding:8px 12px" onclick="MX.Pages.GestSemaine._goToday()">Aujourd\'hui</button>';
      h += '</div>';

      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">';
      if (!_weekData) {
        h += '<button class="primary-btn" style="width:auto;background:var(--orange);border-color:var(--orange)" onclick="MX.Pages.GestSemaine._newWeek()"><i class="fas fa-plus"></i> Nouvelle semaine</button>';
      }
      h += '<button class="cl-quick-btn" style="width:auto" onclick="MX.Pages.GestSemaine._openCopyWeekModal()"><i class="fas fa-copy"></i> Copier la semaine</button>';
      if (_weekData) {
        h += '<button class="cl-quick-btn gst-repart-btn' + (_showMissions ? ' gst-repart-btn--active' : '') + '" style="width:auto' + (_showMissions ? ';background:var(--cyan-dim);color:var(--cyan);border-color:var(--cyan-border)' : '') + '" onclick="MX.Pages.GestSemaine._toggleShowMissions()"><i class="fas ' + (_showMissions ? 'fa-square-check' : 'fa-square') + '"></i> Répartition des missions</button>';
      }
      h += '</div>';

      // ── Indicateur de mode — le mode Répartition doit être clairement
      // identifiable (point 1 de la demande), pas seulement via l'état du
      // bouton lui-même. ──
      if (_weekData && _showMissions) {
        h += '<div class="gst-mode-chip" style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--cyan);background:var(--cyan-dim);border:1px solid var(--cyan-border);border-radius:10px;padding:8px 14px;margin-bottom:16px">' +
          '<i class="fas fa-arrows-up-down-left-right"></i> Mode Répartition des missions' +
          '<span style="font-weight:400;color:var(--text2)">— glissez une mission ou cliquez dessus pour la déplacer</span>' +
          '</div>';
      }

      if (_weekLoading && !_weekData) {
        h += '<div style="text-align:center;padding:30px;color:var(--text3)"><i class="fas fa-spinner fa-spin"></i> Chargement…</div>';
      } else if (!_weekData) {
        h += '<div style="text-align:center;padding:40px 16px;background:var(--bg3);border:1px dashed var(--border2);border-radius:12px">' +
          '<div style="font-size:32px;margin-bottom:10px">🗓️</div>' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:6px">Cette semaine n\'a pas encore été préparée</div>' +
          '<div style="font-size:12px;color:var(--text2)">Cliquez sur « Nouvelle semaine » pour commencer à y affecter des créneaux.</div>' +
          '</div>';
      } else {
        h += (window.innerWidth <= 900) ? _renderWeekGridMobile() : _renderWeekGridDesktop();
      }
    } else if (_tab === 'templates') {
      h += _renderTemplatesTab();
    } else if (_tab === 'shifts') {
      h += _renderShiftsConfigTab();
    }

    h += '</div>';
    mc.innerHTML = h;
    mc.dataset.dayId = '';
  }

  function _tabBtn(id, label) {
    const act = _tab === id;
    return '<button class="mis-tab' + (act ? ' mis-tab--active' : '') +
      '" style="' + (act ? 'background:var(--cyan-dim);color:var(--cyan);border-color:var(--cyan-border)' : '') +
      '" onclick="MX.Pages.GestSemaine._setTab(\'' + id + '\')">' + label + '</button>';
  }
  function _setTab(t) { _tab = t; render(); }
  function _toggleShowMissions() { _showMissions = !_showMissions; render(); }

  // ── WEEK NAVIGATION ──────────────────────────────────────────────────────
  function _prevWeek() {
    const mon = MX.mondayOfWeekKey(_viewWeekKey);
    mon.setDate(mon.getDate() - 7);
    _switchWeek(MX.weekKeyOf(mon));
  }
  function _nextWeek() {
    const mon = MX.mondayOfWeekKey(_viewWeekKey);
    mon.setDate(mon.getDate() + 7);
    _switchWeek(MX.weekKeyOf(mon));
  }
  function _goToday() { _switchWeek(MX.weekKeyOf(new Date())); }

  // Filet de sécurité : _viewWeekKey n'est initialisé que par render() (donc
  // seulement quand l'écran a réellement été ouvert) — si une fonction
  // d'écriture était néanmoins appelée avant tout rendu (ex. depuis la
  // console), on retombe sur la semaine réelle en cours plutôt que
  // d'écrire dans un document "null".
  function _wk() { return _viewWeekKey || MX.weekKeyOf(new Date()); }

  // ── VERROU SEMAINES PASSÉES ──────────────────────────────────────────────
  // week_slots n'est PAS immuable par construction — rien n'empêche
  // techniquement setWeekSlotAssignee/loadTemplateIntoWeekDay/etc. d'écrire
  // sur n'importe quel weekKey, y compris une semaine déjà terminée (voir
  // audit Phase 3, point 9). _prevWeek()/_nextWeek() n'ont aucune borne :
  // un admin peut naviguer vers une semaine passée dans cet écran. Ce verrou
  // empêche toute écriture (affectation, chargement de modèle, nouvelle
  // semaine, copie) sur une semaine strictement antérieure à la semaine
  // réelle en cours — la seule façon de garantir que l'historique reste
  // fiable tant qu'aucun mécanisme d'archivage séparé n'existe.
  function _isPastWeek(weekKey) { return weekKey < MX.weekKeyOf(new Date()); }
  function _blockIfPastWeek(weekKey) {
    if (_isPastWeek(weekKey)) {
      MX.toast('Semaine passée — modification impossible (historique verrouillé)', true);
      return true;
    }
    return false;
  }

  async function _newWeek() {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    try {
      const actor = _actorName();
      const data = await MX.DB.ensureWeekSlots(_wk(), MX.weekLabelOf(_wk()), actor);
      _weekData = data;
      MX.toast('Semaine créée ✓');
      render();
    } catch (e) { MX.toast('Erreur lors de la création de la semaine', true); }
  }

  function _actorName() {
    return MX.state.adminUser ? (MX.state.adminUser.email || 'admin') : (MX.state.currentUser ? MX.state.currentUser.name : 'resp');
  }

  // Nombre de tâches "personnalisées" (déplacées manuellement, movedFrom
  // présent) sur une journée — calculé depuis les données déjà chargées,
  // aucune lecture supplémentaire. Sert à l'indicateur ⚡ et à activer le
  // bouton "Réinitialiser les modifications".
  function _dayMovedCount(list) {
    return (list || []).reduce((n, inst) => n + (inst.tasks || []).filter(t => t.movedFrom).length, 0);
  }

  function _dayMovedBadge(list, dayId) {
    const n = _dayMovedCount(list);
    if (!n) return '';
    return ' <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--orange);background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.3);border-radius:8px;padding:4px 9px;white-space:nowrap;cursor:pointer" title="Réinitialiser les déplacements de cette journée" onclick="event.stopPropagation();MX.Pages.GestSemaine._confirmResetDayMoves(\'' + dayId + '\')">⚡ ' + n + ' personnalisée' + (n > 1 ? 's' : '') + '</span>';
  }

  // ── WEEK GRID — DESKTOP ──────────────────────────────────────────────────
  function _renderWeekGridDesktop() {
    const esc  = MX.esc;
    const days = (_weekData && _weekData.days) || {};
    let h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:separate;border-spacing:6px;min-width:900px">';
    h += '<thead><tr>';
    MX.DAYS.forEach(day => {
      const dateStr = MX.dateForWeekDay(_viewWeekKey, day.id);
      const dLbl = new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const list = (days[day.id] || []);
      h += '<th style="text-align:left;padding:8px;font-size:12px;color:var(--text2);font-weight:700">' + esc(day.l) + '<div style="font-size:10px;color:var(--text3);font-weight:400">' + esc(dLbl) + '</div>' + _dayMovedBadge(list, day.id) + '</th>';
    });
    h += '</tr></thead><tbody><tr style="vertical-align:top">';
    MX.DAYS.forEach(day => {
      const list = (days[day.id] || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      h += '<td style="padding:0 4px;min-width:150px">';
      list.forEach(inst => { h += _renderInstanceCard(day.id, inst); });
      h += _addCellBtn(day.id);
      h += '</td>';
    });
    h += '</tr></tbody></table></div>';
    return h;
  }

  // ── WEEK GRID — MOBILE ───────────────────────────────────────────────────
  function _renderWeekGridMobile() {
    const esc  = MX.esc;
    const days = (_weekData && _weekData.days) || {};
    let h = '<div style="display:flex;flex-direction:column;gap:14px">';
    MX.DAYS.forEach(day => {
      const dateStr = MX.dateForWeekDay(_viewWeekKey, day.id);
      const dLbl = new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      const list = (days[day.id] || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      h += '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:10px">';
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:8px">' + esc(day.l) + ' <span style="font-weight:400;color:var(--text3);font-size:11px">' + esc(dLbl) + '</span>' + _dayMovedBadge(list, day.id) + '</div>';
      if (!list.length) h += '<div style="font-size:11px;color:var(--text3);padding:4px 0 8px">Aucun créneau</div>';
      list.forEach(inst => { h += _renderInstanceCard(day.id, inst); });
      h += _addCellBtn(day.id);
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function _renderInstanceCard(dayId, inst) {
    const esc   = MX.esc;
    const color = inst.color || '#6B7280';
    const taskCount = (inst.tasks || []).length;
    const doneCount = (inst.tasks || []).filter(t => t.done).length;
    const movedInCount = (inst.tasks || []).filter(t => t.movedFrom).length;
    const userOpts = _users().map(u =>
      '<option value="' + esc(u.id) + '"' + (u.id === inst.userId ? ' selected' : '') + '>' + esc(u.name) + '</option>'
    ).join('');
    const cardId = 'gst-card-' + esc(dayId) + '_' + esc(inst.id);
    // Mode Répartition : cartes légèrement agrandies (point 2 de la demande)
    // pour rester lisibles avec des lignes de mission plus grandes en dessous.
    const pad     = _showMissions ? '14px' : '9px';
    const nameFs  = _showMissions ? '15px' : '12px';
    const iconFs  = _showMissions ? '20px' : '14px';
    return '<div id="' + cardId + '" data-day-id="' + esc(dayId) + '" data-inst-id="' + esc(inst.id) + '" class="gst-inst-card" style="background:var(--bg4);border:1px solid var(--border2);border-left:4px solid ' + esc(color) + ';border-radius:10px;padding:' + pad + ';margin-bottom:10px;transition:opacity .15s,outline .1s"' +
      (_showMissions ? (
        ' ondragover="event.preventDefault();MX.Pages.GestSemaine._onCardDragOver(event,\'' + cardId + '\')"' +
        ' ondragleave="MX.Pages.GestSemaine._onCardDragLeave(event,\'' + cardId + '\')"' +
        ' ondrop="MX.Pages.GestSemaine._onCardDrop(event,\'' + esc(dayId) + '\',\'' + esc(inst.id) + '\',\'' + cardId + '\')"'
      ) : '') + '>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
        '<span style="font-size:' + iconFs + '">' + esc(inst.icon || '') + '</span>' +
        '<span style="font-size:' + nameFs + ';font-weight:700;flex:1;' + (_showMissions ? 'text-transform:uppercase;letter-spacing:.02em' : '') + '">' + esc(inst.name) + '</span>' +
        '<button title="Retirer" onclick="MX.Pages.GestSemaine._removeInstance(\'' + esc(dayId) + '\',\'' + esc(inst.id) + '\')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;padding:4px"><i class="fas fa-xmark"></i></button>' +
      '</div>' +
      '<div style="font-size:' + (_showMissions ? '12px' : '10px') + ';color:var(--text3);margin-bottom:6px;font-family:var(--ffm)">' + esc(inst.start || '') + (inst.start || inst.end ? ' – ' : '') + esc(inst.end || '') + '</div>' +
      '<select style="width:100%;font-size:11px;padding:' + (_showMissions ? '7px 8px' : '4px 6px') + ';border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--text1);margin-bottom:8px;min-height:' + (_showMissions ? '36px' : 'auto') + '" onchange="MX.Pages.GestSemaine._setAssignee(\'' + esc(dayId) + '\',\'' + esc(inst.id) + '\',this.value)">' +
        '<option value="">— Non assigné —</option>' + userOpts +
      '</select>' +
      (_showMissions ? _renderMissionsList(dayId, inst) :
        '<div style="font-size:10px;color:var(--text3)">' + doneCount + '/' + taskCount + ' tâches</div>' +
        (movedInCount ? '<div style="font-size:10px;font-weight:700;color:var(--orange);margin-top:3px">⚡ ' + movedInCount + ' personnalisée' + (movedInCount > 1 ? 's' : '') + '</div>' : '')
      ) +
      '</div>';
  }

  // Liste détaillée des tâches d'une instance, affichée uniquement en mode
  // "Afficher les missions". Chaque tâche est draggable (desktop) ET
  // cliquable (ouvre le panneau de déplacement — seule méthode utilisable
  // au doigt sur mobile/tablette, voir _openMoveTaskModal). Une tâche
  // marquée movedFrom affiche en plus un bouton de restauration directe.
  // Nom du créneau d'origine d'une tâche déplacée (movedFrom), pour la
  // sous-ligne "⚡ Déplacé depuis {origine}". Le créneau d'origine peut avoir
  // été retiré entre-temps (voir tests 26.x sur copyWeekSlots) — dans ce cas
  // on retombe sur un libellé générique plutôt que de planter l'affichage.
  function _originInstanceName(dayId, instanceId) {
    const days = (_weekData && _weekData.days) || {};
    const list = days[dayId] || [];
    const origin = list.find(i => i.id === instanceId);
    return origin ? (origin.icon ? origin.icon + ' ' : '') + origin.name : 'un autre créneau';
  }

  function _renderMissionsList(dayId, inst) {
    const esc   = MX.esc;
    const tasks = (inst.tasks || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!tasks.length) return '<div style="font-size:11px;color:var(--text3);padding:6px 2px">Aucune tâche dans ce créneau</div>';
    let h = '<div style="display:flex;flex-direction:column;gap:6px">';
    tasks.forEach(t => {
      const moved = !!t.movedFrom;
      const subtitle = moved ? '⚡ Déplacé depuis ' + esc(_originInstanceName(dayId, t.movedFrom)) : 'Mission technique';
      h += '<div draggable="true"' +
        ' data-task-row="1"' +
        ' ondragstart="MX.Pages.GestSemaine._onTaskDragStart(event,\'' + esc(dayId) + '\',\'' + esc(inst.id) + '\',\'' + esc(t.id) + '\')"' +
        ' ondragend="MX.Pages.GestSemaine._onTaskDragEnd(event)"' +
        ' onclick="MX.Pages.GestSemaine._openMoveTaskModal(\'' + esc(dayId) + '\',\'' + esc(inst.id) + '\',\'' + esc(t.id) + '\')"' +
        ' style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:9px;cursor:grab;min-height:44px;border:1px solid ' + (moved ? 'rgba(249,115,22,.35)' : 'var(--border2)') + (moved ? ';background:rgba(249,115,22,.10)' : ';background:var(--bg3)') + '"' +
        ' title="Cliquer ou glisser pour déplacer cette mission">' +
        '<i class="fas fa-grip-vertical" style="color:var(--text3);font-size:13px;flex-shrink:0" title="Glisser pour déplacer"></i>' +
        '<i class="fas ' + (t.done ? 'fa-square-check' : 'fa-square') + '" style="color:' + (t.done ? 'var(--green)' : 'var(--text3)') + ';font-size:14px;flex-shrink:0"></i>' +
        '<span style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:700;' + (t.done ? 'text-decoration:line-through;color:var(--text3)' : '') + '">' + (moved ? '⚡ ' : '') + esc(t.text) + '</div>' +
          '<div style="font-size:11px;color:' + (moved ? 'var(--orange)' : 'var(--text3)') + ';font-weight:' + (moved ? '700' : '400') + ';margin-top:2px">' + subtitle + '</div>' +
        '</span>';
      if (moved) {
        h += '<button title="Restaurer l\'emplacement d\'origine" onclick="event.stopPropagation();MX.Pages.GestSemaine._confirmRestoreTask(\'' + esc(dayId) + '\',\'' + esc(t.id) + '\',\'' + esc(t.text) + '\')" style="background:none;border:1px solid rgba(249,115,22,.4);color:var(--orange);cursor:pointer;font-size:11px;font-weight:700;flex-shrink:0;border-radius:7px;padding:8px 10px;min-height:36px;white-space:nowrap"><i class="fas fa-rotate-left"></i> Restaurer</button>';
      }
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  // ── DRAG & DROP (desktop) ────────────────────────────────────────────────
  // Retour visuel demandé (étape 4) : au démarrage du glisser, les créneaux
  // du même jour autres que la source sont mis en évidence (cible
  // compatible) et tout le reste (autre jour) est atténué. Un survol
  // affiche en plus une zone "Déposer la mission ici" généreuse à l'intérieur
  // du créneau ciblé. La miniature sous le curseur est celle générée
  // nativement par le navigateur pour tout élément draggable — aucune
  // image de glisser personnalisée n'est nécessaire.
  function _onTaskDragStart(event, dayId, fromInstanceId, taskId) {
    _dragTask = { dayId, fromInstanceId, taskId };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
    document.querySelectorAll('.gst-inst-card').forEach(el => {
      const sameDay  = el.getAttribute('data-day-id') === dayId;
      const isSource = sameDay && el.getAttribute('data-inst-id') === fromInstanceId;
      if (isSource) {
        el.style.opacity = '.5';
      } else if (sameDay) {
        el.style.outline = '2px dashed var(--cyan-border)';
        el.style.outlineOffset = '-2px';
      } else {
        el.style.opacity = '.35';
      }
    });
  }
  function _onTaskDragEnd() {
    _dragTask = null;
    document.querySelectorAll('.gst-inst-card').forEach(el => {
      el.style.opacity = '';
      el.style.outline = '';
      el.style.background = '';
      const ph = el.querySelector('.gst-drop-placeholder');
      if (ph) ph.remove();
    });
  }
  function _onCardDragOver(event, cardId) {
    event.preventDefault();
    const el = document.getElementById(cardId);
    if (!el || !_dragTask) return;
    if (el.getAttribute('data-inst-id') === _dragTask.fromInstanceId) return; // pas de dépôt sur sa propre carte
    el.style.outline = '2px dashed var(--cyan)';
    el.style.outlineOffset = '-2px';
    el.style.background = 'var(--cyan-dim)';
    if (!el.querySelector('.gst-drop-placeholder')) {
      const ph = document.createElement('div');
      ph.className = 'gst-drop-placeholder';
      ph.style.cssText = 'margin-top:6px;padding:12px;border:2px dashed var(--cyan);border-radius:9px;text-align:center;font-size:12px;font-weight:700;color:var(--cyan);background:var(--cyan-dim)';
      ph.textContent = '↓ Déposer la mission ici';
      el.appendChild(ph);
    }
  }
  function _onCardDragLeave(event, cardId) {
    const el = document.getElementById(cardId);
    if (!el) return;
    if (event.relatedTarget && el.contains(event.relatedTarget)) return; // reste dans la même carte (survol d'un enfant)
    const compatible = !!(_dragTask && el.getAttribute('data-day-id') === _dragTask.dayId && el.getAttribute('data-inst-id') !== _dragTask.fromInstanceId);
    el.style.outline = compatible ? '2px dashed var(--cyan-border)' : '';
    el.style.background = '';
    const ph = el.querySelector('.gst-drop-placeholder');
    if (ph) ph.remove();
  }
  async function _onCardDrop(event, dayId, toInstanceId, cardId) {
    event.preventDefault();
    const drag = _dragTask;
    _onTaskDragEnd(); // nettoie tout le retour visuel (atténuation, contours, placeholder)
    if (!drag || drag.dayId !== dayId) return; // sécurité : jamais de déplacement inter-jours depuis cette interface
    if (drag.fromInstanceId === toInstanceId) return; // déposé sur son propre créneau
    await _performMove(dayId, drag.fromInstanceId, toInstanceId, drag.taskId);
  }

  function _addCellBtn(dayId) {
    return '<button style="width:100%;padding:8px;border:1.5px dashed var(--border2);border-radius:10px;background:none;color:var(--text3);cursor:pointer;font-size:11px;margin-bottom:8px" onclick="MX.Pages.GestSemaine._openLoadTemplateModal(\'' + dayId + '\')"><i class="fas fa-plus"></i> Ajouter un créneau</button>';
  }

  async function _setAssignee(dayId, instanceId, userId) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    const user = _users().find(u => u.id === userId) || null;
    try {
      await MX.DB.setWeekSlotAssignee(_wk(), dayId, instanceId, user ? user.id : null, user ? user.name : '', _actorName());
      MX.toast('Technicien affecté ✓');
    } catch (e) { MX.toast('Erreur lors de l\'affectation', true); render(); }
  }

  async function _removeInstance(dayId, instanceId) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    MX.showModal('Retirer ce créneau ?', 'Cette action supprime ce créneau de la semaine (les tâches/coches associées seront perdues).', [
      { label: 'Retirer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteWeekSlotInstance(_wk(), dayId, instanceId, _actorName()); MX.toast('Créneau retiré'); }
        catch (e) { MX.toast('Erreur', true); }
      } },
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── RÉPARTITION TEMPORAIRE DES MISSIONS ─────────────────────────────────
  // Panneau de déplacement — méthode UNIQUE utilisable au doigt (mobile/
  // tablette), et méthode secondaire toujours disponible sur desktop en
  // complément du drag & drop natif (voir étape 4 de la demande : le drag
  // & drop ne doit jamais être la seule méthode). Toujours réservé
  // admin/responsable — _canEdit() revérifié avant toute écriture, jamais
  // uniquement parce que le bouton qui l'ouvre n'est déjà rendu que pour
  // ces rôles.
  // Panneau custom (PAS le petit modal générique MX.showModal — étape 5/6 de
  // la demande) : racine persistante créée à la volée au premier usage,
  // backdrop en frère (pas parent) du panneau pour que les clics dans le
  // panneau ne remontent jamais jusqu'au backdrop et ne le ferment pas.
  // Bascule desktop (panneau latéral droit) / mobile (feuille du bas) selon
  // window.innerWidth AU MOMENT DE L'OUVERTURE — cohérent avec le reste du
  // fichier qui n'utilise jamais de media queries CSS.
  const MVP_BREAKPOINT = 760;

  function _ensureMovePanelRoot() {
    if (document.getElementById('gst-move-panel-root')) return;
    const root = document.createElement('div');
    root.id = 'gst-move-panel-root';
    root.style.cssText = 'display:none;position:fixed;inset:0;z-index:2000';
    root.innerHTML =
      '<div id="gst-mvp-backdrop" onclick="MX.Pages.GestSemaine._closeMovePanel()" style="position:absolute;inset:0;background:rgba(0,0,0,.55)"></div>' +
      '<div id="gst-mvp-panel" role="dialog" aria-label="Déplacer une mission"></div>';
    document.body.appendChild(root);
  }

  function _closeMovePanel() {
    const root = document.getElementById('gst-move-panel-root');
    if (root) root.style.display = 'none';
  }

  function _selectMoveDest(instId) {
    document.querySelectorAll('#gst-mvp-panel [data-mvp-option]').forEach(el => {
      const selected = el.getAttribute('data-mvp-option') === instId;
      el.style.borderColor = selected ? 'var(--cyan)' : 'var(--border2)';
      el.style.background  = selected ? 'var(--cyan-dim)' : 'transparent';
      const radio = el.querySelector('input[type="radio"]');
      if (radio) radio.checked = selected;
    });
  }

  function _openMoveTaskModal(dayId, fromInstanceId, taskId) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    const esc  = MX.esc;
    const days = (_weekData && _weekData.days) || {};
    const list = days[dayId] || [];
    const fromInst = list.find(i => i.id === fromInstanceId);
    const task     = fromInst && (fromInst.tasks || []).find(t => t.id === taskId);
    if (!fromInst || !task) return;
    const others = list.filter(i => i.id !== fromInstanceId);
    if (!others.length) { MX.toast('Aucun autre créneau ce jour-là pour déplacer cette mission', true); return; }

    _ensureMovePanelRoot();
    const mobile = window.innerWidth < MVP_BREAKPOINT;
    const panel = document.getElementById('gst-mvp-panel');
    panel.style.cssText = (mobile
      ? 'position:absolute;left:0;right:0;bottom:0;max-height:85vh;border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.4)'
      : 'position:absolute;top:0;right:0;bottom:0;width:min(440px,92vw);box-shadow:-8px 0 30px rgba(0,0,0,.4)') +
      ';background:var(--bg2);display:flex;flex-direction:column;overflow:hidden';

    let optionsHtml = '';
    others.forEach((inst, i) => {
      optionsHtml +=
        '<label data-mvp-option="' + esc(inst.id) + '" style="display:flex;align-items:center;gap:12px;padding:14px;border:2px solid var(--border2);border-radius:12px;cursor:pointer;margin-bottom:10px;min-height:44px" onclick="MX.Pages.GestSemaine._selectMoveDest(\'' + esc(inst.id) + '\')">' +
          '<input type="radio" name="mtm-dest" value="' + esc(inst.id) + '"' + (i === 0 ? ' checked' : '') + ' style="width:20px;height:20px;flex-shrink:0">' +
          '<span style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:700">' + esc(inst.icon || '') + ' ' + esc(inst.name) + '</div>' +
            '<div style="font-size:12px;color:var(--text3);margin-top:2px">' + esc(inst.userName || 'Non assigné') + ' · ' + esc(inst.start || '') + (inst.start || inst.end ? ' – ' : '') + esc(inst.end || '') + '</div>' +
          '</span>' +
        '</label>';
    });

    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border2);flex-shrink:0">' +
        '<div style="font-size:13px;font-weight:800;letter-spacing:.04em;color:var(--text2)">DÉPLACER UNE MISSION</div>' +
        '<button onclick="MX.Pages.GestSemaine._closeMovePanel()" title="Fermer" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:22px;line-height:1;width:44px;height:44px;flex-shrink:0">×</button>' +
      '</div>' +
      '<div style="padding:20px;overflow-y:auto;flex:1">' +
        '<div style="font-size:17px;font-weight:800;margin-bottom:18px">' + esc(task.text) + '</div>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--text3);margin-bottom:6px">ACTUELLEMENT</div>' +
        '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3);margin-bottom:24px">' +
          '<span style="font-size:18px">' + esc(fromInst.icon || '') + '</span>' +
          '<span style="flex:1"><div style="font-size:13px;font-weight:700">' + esc(fromInst.name) + '</div><div style="font-size:11px;color:var(--text3);margin-top:2px">' + esc(fromInst.start || '') + (fromInst.start || fromInst.end ? ' – ' : '') + esc(fromInst.end || '') + '</div></span>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--text3);margin-bottom:8px">DÉPLACER VERS</div>' +
        optionsHtml +
      '</div>' +
      '<div style="display:flex;gap:10px;padding:16px 20px;border-top:1px solid var(--border2);flex-shrink:0">' +
        '<button class="modal-btn cancel" onclick="MX.Pages.GestSemaine._closeMovePanel()" style="flex:1;min-height:46px">Annuler</button>' +
        '<button class="modal-btn confirm" onclick="MX.Pages.GestSemaine._doMoveTaskFromModal(\'' + esc(dayId) + '\',\'' + esc(fromInstanceId) + '\',\'' + esc(taskId) + '\')" style="flex:1;min-height:46px"><i class="fas fa-arrow-right-arrow-left"></i> Déplacer</button>' +
      '</div>';

    document.getElementById('gst-move-panel-root').style.display = 'block';
    _selectMoveDest(others[0].id);
  }

  function _doMoveTaskFromModal(dayId, fromInstanceId, taskId) {
    const sel = document.querySelector('#gst-mvp-panel input[name="mtm-dest"]:checked');
    if (!sel) return;
    const toInstanceId = sel.value;
    _closeMovePanel();
    _performMove(dayId, fromInstanceId, toInstanceId, taskId);
  }

  // Cœur du déplacement, partagé par le drag & drop (desktop) et le panneau
  // (mobile/desktop). Si le créneau destination appartient à un AUTRE
  // technicien que la source, l'affectation n'est JAMAIS transférée
  // silencieusement : confirmation explicite requise avant d'écrire quoi
  // que ce soit (étape 8 de la demande).
  async function _performMove(dayId, fromInstanceId, toInstanceId, taskId) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    const days = (_weekData && _weekData.days) || {};
    const list = days[dayId] || [];
    const fromInst = list.find(i => i.id === fromInstanceId);
    const toInst   = list.find(i => i.id === toInstanceId);
    const task     = fromInst && (fromInst.tasks || []).find(t => t.id === taskId);
    if (!fromInst || !toInst || !task) { MX.toast('Erreur : créneau ou tâche introuvable', true); return; }

    const run = async () => {
      try {
        await MX.DB.moveWeekSlotTask(_wk(), dayId, fromInstanceId, toInstanceId, taskId, _actorName());
        MX.DB.addLog({
          workerName: _actorName(), action: 'assign',
          taskText: '« ' + task.text + ' » : ' + fromInst.name + ' → ' + toInst.name,
          dayId, slot: toInstanceId,
        }).catch(() => {});
        MX.toast('✓ Mission déplacée — « ' + task.text + ' » ' + fromInst.name + ' → ' + toInst.name);
      } catch (e) {
        MX.toast('Erreur lors du déplacement — la mission n\'a pas bougé', true);
        render(); // ré-affiche l'état réel (celui de _weekData, jamais modifié en local avant confirmation Firestore)
      }
    };

    if (toInst.userName && fromInst.userName && toInst.userName !== fromInst.userName) {
      MX.showModal(
        'Créneau destination attribué à un autre technicien',
        'Le créneau « ' + toInst.name + ' » est attribué à ' + toInst.userName + '. Déplacer cette mission vers ce créneau ?',
        [
          { label: 'Confirmer', cls: 'confirm', fn: run },
          { label: 'Annuler', cls: 'cancel' }
        ]
      );
      return;
    }
    await run();
  }

  function _confirmRestoreTask(dayId, taskId, taskText) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    MX.showModal('Restaurer l\'emplacement d\'origine ?', '« ' + taskText + ' » retournera dans son créneau d\'origine.', [
      { label: 'Restaurer', cls: 'confirm', fn: async () => {
        try {
          await MX.DB.restoreWeekSlotTask(_wk(), dayId, taskId, _actorName());
          MX.toast('✓ Mission restaurée à son emplacement d\'origine');
        } catch (e) { MX.toast('Erreur lors de la restauration', true); render(); }
      } },
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _confirmResetDayMoves(dayId) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    const day = MX.DAYS.find(d => d.id === dayId);
    MX.showModal('Réinitialiser les modifications ?', 'Les déplacements manuels de ' + (day ? day.l : dayId) + ' seront annulés — chaque mission déplacée retournera dans son créneau d\'origine. Les coches et affectations ne sont pas affectées.', [
      { label: 'Réinitialiser', cls: 'confirm', fn: async () => {
        try {
          await MX.DB.resetWeekSlotDayMoves(_wk(), dayId, _actorName());
          MX.toast('✓ Journée réinitialisée');
        } catch (e) { MX.toast('Erreur lors de la réinitialisation', true); render(); }
      } },
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── CHARGER UN MODÈLE ────────────────────────────────────────────────────
  function _openLoadTemplateModal(dayId) {
    if (!_canEdit()) return;
    const esc  = MX.esc;
    const tpls = _templates().filter(t => t.active !== false);
    if (!tpls.length) { MX.toast('Créez d\'abord un modèle de créneau', true); return; }
    const day  = MX.DAYS.find(d => d.id === dayId);

    const tplOpts  = tpls.map(t => '<option value="' + esc(t.id) + '">' + esc(t.icon || '') + ' ' + esc(t.name) + ' (' + esc(t.start || '') + '–' + esc(t.end || '') + ')</option>').join('');
    const userOpts = '<option value="">— Non assigné —</option>' + _users().map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join('');

    document.getElementById('m-title').textContent = 'Charger un modèle — ' + (day ? day.l : dayId);
    document.getElementById('m-sub').innerHTML =
      '<div style="display:flex;flex-direction:column;gap:12px;margin-top:6px">' +
        '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Modèle</label>' +
        '<select id="lgm-tpl" class="fi" style="width:100%">' + tplOpts + '</select></div>' +
        '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Technicien</label>' +
        '<select id="lgm-user" class="fi" style="width:100%">' + userOpts + '</select></div>' +
      '</div>';
    document.getElementById('m-actions').innerHTML =
      '<button class="modal-btn confirm" onclick="MX.Pages.GestSemaine._doLoadTemplate(\'' + esc(dayId) + '\')"><i class="fas fa-check"></i> Charger</button>' +
      '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  async function _doLoadTemplate(dayId) {
    if (!_canEdit()) return;
    if (_blockIfPastWeek(_wk())) return;
    const tplId  = (document.getElementById('lgm-tpl')  || {}).value;
    const userId = (document.getElementById('lgm-user') || {}).value;
    if (!tplId) return;
    MX.closeModal();
    const user = _users().find(u => u.id === userId) || null;
    try {
      if (!_weekData) await MX.DB.ensureWeekSlots(_wk(), MX.weekLabelOf(_wk()), _actorName());
      await MX.DB.loadTemplateIntoWeekDay(_wk(), MX.weekLabelOf(_wk()), dayId, tplId, user ? user.id : null, user ? user.name : '', _actorName());
      MX.toast('Créneau chargé ✓');
    } catch (e) { MX.toast('Erreur lors du chargement du modèle', true); }
  }

  // ── COPIER LA SEMAINE ────────────────────────────────────────────────────
  function _openCopyWeekModal() {
    if (!_canEdit()) return;
    if (!_weekData) { MX.toast('Rien à copier — cette semaine est vide', true); return; }
    document.getElementById('m-title').textContent = 'Copier la semaine';
    document.getElementById('m-sub').innerHTML =
      '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Dupliquer le contenu de la semaine affichée vers :</div>' +
      '<select id="cwm-target" class="fi" style="width:100%">' +
        '<option value="1">La semaine suivante</option>' +
        '<option value="2">Dans 2 semaines</option>' +
        '<option value="3">Dans 3 semaines</option>' +
        '<option value="4">Dans 4 semaines</option>' +
      '</select>';
    document.getElementById('m-actions').innerHTML =
      '<button class="modal-btn confirm" onclick="MX.Pages.GestSemaine._doCopyWeek()"><i class="fas fa-copy"></i> Copier</button>' +
      '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  async function _doCopyWeek() {
    if (!_canEdit()) return;
    const n = parseInt((document.getElementById('cwm-target') || {}).value || '1', 10);
    MX.closeModal();
    const mon = MX.mondayOfWeekKey(_wk());
    mon.setDate(mon.getDate() + n * 7);
    const targetKey = MX.weekKeyOf(mon);
    if (_blockIfPastWeek(targetKey)) return;
    try {
      await MX.DB.copyWeekSlots(_wk(), targetKey, MX.weekLabelOf(targetKey), _actorName());
      MX.toast('Semaine copiée ✓');
      _switchWeek(targetKey);
    } catch (e) { MX.toast('Erreur lors de la copie', true); }
  }

  // ── MODÈLES DE CRÉNEAUX ──────────────────────────────────────────────────
  function _renderTemplatesTab() {
    const esc = MX.esc;
    let h = '<div style="display:flex;justify-content:flex-end;margin-bottom:14px">' +
      '<button class="primary-btn" style="width:auto" onclick="MX.Pages.GestSemaine._openTemplateEditor(\'new\')"><i class="fas fa-plus"></i> Créer un modèle</button>' +
      '</div>';
    const tpls = _templates().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!tpls.length) {
      h += '<div style="text-align:center;padding:30px;color:var(--text3)">Aucun modèle pour le moment.</div>';
      return h;
    }
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">';
    tpls.forEach(t => {
      const inactive = t.active === false;
      h += '<div style="background:var(--bg3);border:1px solid var(--border2);border-left:4px solid ' + esc(t.color || '#6B7280') + ';border-radius:12px;padding:12px' + (inactive ? ';opacity:.55' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
          '<span style="font-size:18px">' + esc(t.icon || '') + '</span>' +
          '<span style="font-size:14px;font-weight:700;flex:1">' + esc(t.name) + '</span>' +
          (inactive ? '<span style="font-size:9px;color:var(--text3);background:var(--bg4);padding:2px 6px;border-radius:5px">INACTIF</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--text3);font-family:var(--ffm);margin-bottom:6px">' + esc(t.start || '') + (t.start || t.end ? ' – ' : '') + esc(t.end || '') + '</div>' +
        '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">' + ((t.tasks || []).length) + ' tâche' + ((t.tasks || []).length !== 1 ? 's' : '') + '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button style="flex:1;font-size:11px;padding:6px;border-radius:7px;border:1px solid var(--border2);background:var(--bg4);color:var(--text1);cursor:pointer" onclick="MX.Pages.GestSemaine._openTemplateEditor(\'' + esc(t.id) + '\')"><i class="fas fa-pen"></i></button>' +
          '<button style="flex:1;font-size:11px;padding:6px;border-radius:7px;border:1px solid var(--border2);background:var(--bg4);color:var(--text1);cursor:pointer" onclick="MX.Pages.GestSemaine._duplicateTemplateAction(\'' + esc(t.id) + '\')"><i class="fas fa-copy"></i></button>' +
          '<button style="flex:1;font-size:11px;padding:6px;border-radius:7px;border:1px solid var(--red-dim,#7f1d1d);background:var(--bg4);color:var(--red);cursor:pointer" onclick="MX.Pages.GestSemaine._deleteTemplateConfirm(\'' + esc(t.id) + '\')"><i class="fas fa-trash"></i></button>' +
        '</div>' +
        '</div>';
    });
    h += '</div>';
    return h;
  }

  // ── CONFIGURATION DES HORAIRES (vue compacte des mêmes modèles) ─────────
  function _renderShiftsConfigTab() {
    const esc = MX.esc;
    let h = '<div style="font-size:12px;color:var(--text2);margin-bottom:12px">Horaires utilisés par les modèles de créneaux — modifiez-les ici, ou depuis l\'onglet « Modèles de créneaux ».</div>';
    const tpls = _templates().slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    tpls.forEach(t => {
      h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + esc(t.color || '#6B7280') + ';flex-shrink:0"></span>' +
        '<span style="font-size:16px">' + esc(t.icon || '') + '</span>' +
        '<span style="font-size:13px;font-weight:600;flex:1">' + esc(t.name) + '</span>' +
        '<span style="font-size:12px;color:var(--text2);font-family:var(--ffm)">' + esc(t.start || '—') + ' – ' + esc(t.end || '—') + '</span>' +
        '<button style="background:none;border:none;color:var(--cyan);cursor:pointer;font-size:12px;padding:4px 8px" onclick="MX.Pages.GestSemaine._openTemplateEditor(\'' + esc(t.id) + '\')"><i class="fas fa-pen"></i></button>' +
        '<button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:4px 8px" onclick="MX.Pages.GestSemaine._deleteTemplateConfirm(\'' + esc(t.id) + '\')"><i class="fas fa-trash"></i></button>' +
        '</div>';
    });
    h += '</div>';
    h += '<button class="primary-btn" style="width:auto;margin-top:14px" onclick="MX.Pages.GestSemaine._openTemplateEditor(\'new\')"><i class="fas fa-plus"></i> Nouvel horaire</button>';
    return h;
  }

  // ── ÉDITEUR DE MODÈLE (création / modification) ─────────────────────────
  function _openTemplateEditor(id) {
    if (!_canEdit()) return;
    const esc = MX.esc;
    _editingTplId = id;
    const isNew = id === 'new';
    const t = isNew ? { name: '', icon: ICONS[0], color: PALETTE[0], start: '', end: '', active: true, tasks: [] } : (_tplById(id) || {});
    _editTasks = (t.tasks || []).map(x => Object.assign({}, x));

    document.getElementById('m-title').textContent = isNew ? 'Nouveau modèle de créneau' : 'Modifier — ' + (t.name || '');
    document.getElementById('m-sub').innerHTML = _templateEditorFormHtml(t);
    document.getElementById('m-actions').innerHTML =
      '<button class="modal-btn confirm" onclick="MX.Pages.GestSemaine._saveTemplateFromEditor()"><i class="fas fa-save"></i> Valider</button>' +
      '<button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>';
    document.getElementById('modal-bg').classList.add('show');
  }

  function _templateEditorFormHtml(t) {
    const esc = MX.esc;
    const colorSwatches = PALETTE.map(c =>
      '<button type="button" onclick="document.getElementById(\'tef-color\').value=\'' + c + '\'" style="width:26px;height:26px;border-radius:7px;background:' + c + ';border:2px solid ' + (t.color === c ? 'var(--text1)' : 'transparent') + ';cursor:pointer"></button>'
    ).join('');
    const iconBtns = ICONS.map(i =>
      '<button type="button" onclick="document.getElementById(\'tef-icon\').value=\'' + i + '\'" style="font-size:16px;padding:5px 7px;border-radius:7px;border:1px solid var(--border2);background:var(--bg4);cursor:pointer">' + i + '</button>'
    ).join('');

    return '<div style="display:flex;flex-direction:column;gap:12px;margin-top:6px;max-height:55vh;overflow-y:auto;padding-right:4px">' +
      '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Nom du créneau</label>' +
        '<input id="tef-name" class="fi" style="width:100%" maxlength="30" value="' + esc(t.name || '') + '" placeholder="Ex: Jour férié"></div>' +
      '<div style="display:flex;gap:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Heure de début</label>' +
          '<input id="tef-start" type="time" class="fi" style="width:100%" value="' + esc(t.start || '') + '"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Heure de fin</label>' +
          '<input id="tef-end" type="time" class="fi" style="width:100%" value="' + esc(t.end || '') + '"></div>' +
      '</div>' +
      '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Couleur</label>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + colorSwatches +
        '<input id="tef-color" type="color" value="' + esc(t.color || '#6B7280') + '" style="width:30px;height:26px;padding:0;border:none;background:none"></div></div>' +
      '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px">Icône</label>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + iconBtns +
        '<input id="tef-icon" type="text" maxlength="4" value="' + esc(t.icon || '') + '" style="width:44px;text-align:center;font-size:16px;padding:5px;border-radius:7px;border:1px solid var(--border2);background:var(--bg4);color:var(--text1)"></div></div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);cursor:pointer">' +
        '<input id="tef-active" type="checkbox"' + (t.active !== false ? ' checked' : '') + '> Actif (disponible pour de nouvelles affectations)</label>' +
      '<div><label style="font-size:11px;color:var(--text2);display:block;margin-bottom:6px">Tâches (' + _editTasks.length + ')</label>' +
        '<div id="tef-tasks">' + _renderEditTasksList() + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<input id="tef-newtask" class="fi" style="flex:1" placeholder="Nouvelle tâche…" maxlength="200">' +
          '<button type="button" class="cl-quick-btn" style="width:auto;padding:8px 12px" onclick="MX.Pages.GestSemaine._addEditTask()"><i class="fas fa-plus"></i></button>' +
        '</div></div>' +
      '</div>';
  }

  function _renderEditTasksList() {
    const esc = MX.esc;
    if (!_editTasks.length) return '<div style="font-size:11px;color:var(--text3);padding:6px 0">Aucune tâche — ajoutez-en ci-dessous.</div>';
    return _editTasks.map((task, i) =>
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:12px;flex:1">' + esc(task.text) + '</span>' +
        '<button type="button" onclick="MX.Pages.GestSemaine._removeEditTask(' + i + ')" style="background:none;border:none;color:var(--text3);cursor:pointer"><i class="fas fa-xmark"></i></button>' +
      '</div>'
    ).join('');
  }

  function _refreshEditTasksList() {
    const el = document.getElementById('tef-tasks');
    if (el) el.innerHTML = _renderEditTasksList();
  }

  function _addEditTask() {
    const inp = document.getElementById('tef-newtask');
    const text = inp ? inp.value.trim() : '';
    if (!text) return;
    _editTasks.push({ id: MX.uuid ? MX.uuid() : ('t' + Date.now() + Math.random().toString(36).slice(2)), text, order: _editTasks.length });
    if (inp) inp.value = '';
    _refreshEditTasksList();
  }
  function _removeEditTask(idx) {
    _editTasks.splice(idx, 1);
    _editTasks.forEach((t, i) => { t.order = i; });
    _refreshEditTasksList();
  }

  async function _saveTemplateFromEditor() {
    if (!_canEdit()) return;
    const name  = ((document.getElementById('tef-name')  || {}).value || '').trim();
    const start = (document.getElementById('tef-start') || {}).value || '';
    const end   = (document.getElementById('tef-end')   || {}).value || '';
    const color = (document.getElementById('tef-color') || {}).value || '#6B7280';
    const icon  = ((document.getElementById('tef-icon')  || {}).value || '').trim();
    const active = !!(document.getElementById('tef-active') || {}).checked;
    if (!name) { MX.toast('Le nom est requis', true); return; }

    const data = { name, start, end, color, icon, active, tasks: _editTasks.map((t, i) => ({ id: t.id, text: t.text, order: i })) };
    MX.closeModal();
    try {
      if (_editingTplId === 'new') { await MX.DB.addShiftTemplate(data); MX.toast('Modèle créé ✓'); }
      else { await MX.DB.updateShiftTemplate(_editingTplId, data); MX.toast('Modèle mis à jour ✓'); }
    } catch (e) { MX.toast('Erreur lors de l\'enregistrement', true); }
  }

  function _deleteTemplateConfirm(id) {
    if (!_canEdit()) return;
    const t = _tplById(id);
    MX.showModal('Supprimer ce modèle ?', (t ? '« ' + t.name + ' » ' : '') + 'ne sera plus disponible pour de nouvelles semaines. Les semaines déjà préparées avec ce modèle ne sont pas affectées (copie indépendante).', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteShiftTemplate(id); MX.toast('Modèle supprimé'); }
        catch (e) { MX.toast('Erreur', true); }
      } },
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  async function _duplicateTemplateAction(id) {
    if (!_canEdit()) return;
    try { await MX.DB.duplicateShiftTemplate(id); MX.toast('Modèle dupliqué ✓'); }
    catch (e) { MX.toast('Erreur lors de la duplication', true); }
  }

  // ── ACCÈS EXTERNE (pour mes-missions.js / app.js — lecture seule) ───────
  // Retourne l'instance de créneau du jour attribuée à un technicien donné,
  // ou null si aucune (semaine non préparée OU pas d'affectation ce jour).
  function getTodayAssignmentFor(userName) {
    const wk = MX.state.weekSlots;
    if (!wk || !userName) return null;
    const dayId = MX.todayId();
    const list  = (wk.days && wk.days[dayId]) || [];
    return list.find(inst => inst.userName === userName) || null;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.GestSemaine = {
    render, _setTab, _prevWeek, _nextWeek, _goToday, _newWeek,
    _openLoadTemplateModal, _doLoadTemplate, _setAssignee, _removeInstance,
    _openCopyWeekModal, _doCopyWeek,
    _openTemplateEditor, _saveTemplateFromEditor, _deleteTemplateConfirm, _duplicateTemplateAction,
    _addEditTask, _removeEditTask,
    getTodayAssignmentFor,
    _toggleShowMissions,
    _onTaskDragStart, _onTaskDragEnd, _onCardDragOver, _onCardDragLeave, _onCardDrop,
    _openMoveTaskModal, _doMoveTaskFromModal, _closeMovePanel, _selectMoveDest,
    _confirmRestoreTask, _confirmResetDayMoves,
  };
})();
