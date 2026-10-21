(function () {
  'use strict';
  const FV = firebase.firestore.FieldValue;

  // ── SLOT INFO ──
  const SLOT_INFO = {
    matin:   { l: 'Matin',   icon: 'fa-sun',       color: '#F59E0B', bg: 'rgba(245,158,11,.10)', time: '06h – 14h' },
    journee: { l: 'Journée', icon: 'fa-cloud-sun',  color: '#3B82F6', bg: 'rgba(59,130,246,.10)', time: '09h – 17h' },
    soir:    { l: 'Soir',    icon: 'fa-moon',       color: '#8B5CF6', bg: 'rgba(139,92,246,.10)', time: '14h – 22h' },
  };

  // ── ITEM TYPES ──
  const ITEM_TYPES = {
    tache:        { l:'Tâche',        icon:'fa-check-circle',        color:'#6B7280', bg:'rgba(107,114,128,.13)' },
    mission:      { l:'Mission',       icon:'fa-briefcase',           color:'#3B82F6', bg:'rgba(59,130,246,.13)'  },
    pmp:          { l:'PMP',          icon:'fa-screwdriver-wrench',   color:'#8B5CF6', bg:'rgba(139,92,246,.13)'  },
    intervention: { l:'Intervention', icon:'fa-triangle-exclamation', color:'#EF4444', bg:'rgba(239,68,68,.13)'   },
    note:         { l:'Note',         icon:'fa-note-sticky',          color:'#F59E0B', bg:'rgba(245,158,11,.13)'  },
    reunion:      { l:'Réunion',      icon:'fa-users',                color:'#06B6D4', bg:'rgba(6,182,212,.13)'   },
    livraison:    { l:'Livraison',    icon:'fa-box-open',             color:'#10B981', bg:'rgba(16,185,129,.13)'  },
    controle:     { l:'Contrôle',     icon:'fa-clipboard-check',      color:'#EC4899', bg:'rgba(236,72,153,.13)'  },
  };

  // ── DEFAULT ORG TASKS ──
  const DEFAULT_ORG_TASKS = [
    { title: 'Contrôle carnets sécurité',          category: 'sécurité',      description: '', type: 'hebdomadaire' },
    { title: 'Vérification registre piscine',       category: 'réglementaire', description: '', type: 'hebdomadaire' },
    { title: 'Contrôle stock EPI',                  category: 'stock',         description: '', type: 'hebdomadaire' },
    { title: 'Contrôle affichages réglementaires',  category: 'réglementaire', description: '', type: 'hebdomadaire' },
    { title: 'Vérification contrats prestataires',  category: 'administratif', description: '', type: 'hebdomadaire' },
    { title: 'Contrôle chambres PMR',               category: 'hébergement',   description: '', type: 'hebdomadaire' },
  ];

  // ── STATE ──
  let _tasks      = [];
  let _unsub      = null;
  let _unsubCfg   = null;
  let _weekKey    = null;
  let _inHistory  = false;
  let _tab        = 'planning'; // 'planning' | 'tasks'
  let _slotConfig = {};         // { dayId: string[] } — active slots per day this week
  let _templates  = [];         // org_templates docs
  let _dayExpanded  = {};       // { dayId: bool }
  let _dragData     = null;     // { taskId, srcDayId, srcSlot }
  let _weekOffset   = 0;        // 0 = current week, -1 = last week, +1 = next week
  let _slotNames    = {};       // { 'dayId_slot': customName } — persisted in org_config
  let _panelDayId   = null;    // dayId whose gear panel is open, or null
  let _cpView       = 'planning'; // 'planning' | 'timeline'

  // Cross-module aggregation (interventions + PMP)
  let _interventions  = [];
  let _pmpInts        = [];
  let _unsubInts      = null;
  let _unsubPmpInts   = null;

  // Récurrence — tâches "origine" (recurrence:'daily'|'weekly'|'monthly'),
  // valables pour TOUTES les semaines, indépendamment de la semaine affichée.
  let _recurOrigins  = [];
  let _unsubRecur    = null;

  // Priorités personnalisables (org_config/priorities) — config dynamique,
  // jamais de couleur devinée pour une valeur non configurée.
  let _prioLevels    = [];
  let _unsubPrio     = null;

  // Formulaire tâche — sélection techniciens en cours (chips + dropdown)
  let _orPickerTechs = [];

  // ── WEEK HELPERS ──
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
  function _weekKeyToDates(weekKey) {
    const [year, wStr] = weekKey.split('_W');
    const y = parseInt(year), w = parseInt(wStr);
    const jan4 = new Date(y, 0, 4);
    const dayOfWeek = (jan4.getDay() + 6) % 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + (w - 1) * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days; // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  }
  function _weekLabel(weekKey) {
    const parts = weekKey.split('_W');
    const wn = parseInt(parts[1]);
    try {
      const dates = _weekKeyToDates(weekKey);
      const fmt = x => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      return `S.${wn} — ${fmt(dates[0])} au ${fmt(dates[6])} ${parts[0]}`;
    } catch(e) {
      return `Semaine ${wn} — ${parts[0]}`;
    }
  }
  function _offsetWeekKey(baseKey, offset) {
    const dates = _weekKeyToDates(baseKey);
    const ref = new Date(dates[0]);
    ref.setDate(ref.getDate() + offset * 7);
    return _getWeekKey(ref);
  }
  function _todayDayId() {
    const idx = new Date().getDay();
    return MX.DAYS[idx === 0 ? 6 : idx - 1].id;
  }
  function _isCurrentWeek() { return _weekOffset === 0; }
  function _getDateForDay(weekKey, dayId) {
    const dates = _weekKeyToDates(weekKey);
    const idx = MX.DAYS.findIndex(d => d.id === dayId);
    return idx >= 0 ? dates[idx] : null;
  }
  function _fmtDate(d) {
    if (!d) return '';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  function _isToday(weekKey, dayId) {
    if (!_isCurrentWeek()) return false;
    return dayId === _todayDayId();
  }

  // ── SLOT CONFIG HELPERS ──
  function _getDefaultSlots(dayId) {
    return MX.getDaySlots(dayId); // hardcoded defaults
  }
  function _getActiveSlots(dayId) {
    if (_slotConfig[dayId]) return _slotConfig[dayId];
    return _getDefaultSlots(dayId);
  }
  function _getSlotName(dayId, slot) {
    return _slotNames[dayId + '_' + slot] || SLOT_INFO[slot]?.l || slot;
  }

  // ── AGGREGATION HELPERS (cross-module, no data duplication) ──
  function _dateToDayId(dateStr) {
    if (!dateStr || !_weekKey) return null;
    const weekDates = _weekKeyToDates(_weekKey);
    const parts     = dateStr.split('-').map(Number);
    const idx       = weekDates.findIndex(wd =>
      wd.getFullYear() === parts[0] && wd.getMonth() === parts[1] - 1 && wd.getDate() === parts[2]
    );
    return idx >= 0 ? MX.DAYS[idx].id : null;
  }

  function _dayIdToDate(dayId) {
    if (!dayId || !_weekKey) return null;
    const dates = _weekKeyToDates(_weekKey);
    const idx   = MX.DAYS.findIndex(d => d.id === dayId);
    if (idx < 0) return null;
    const d = dates[idx];
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function _normalizeIntervention(doc) {
    const dayId    = doc.cpDayId || _dateToDayId(doc.startDate);
    const slot     = doc.cpSlot  || 'journee';
    const assignee = Array.isArray(doc.assignedTo) ? doc.assignedTo[0] : (doc.assignedTo || null);
    return {
      id:           'int_' + doc.id,
      _source:      'intervention',
      _sourceId:    doc.id,
      itemType:     'intervention',
      title:        doc.title    || '(Sans titre)',
      location:     doc.location || null,
      priority:     doc.priority || 'normale',
      status:       doc.status   || 'planifiee',
      duration:     doc.estimatedDuration || null,
      assignedTo:   assignee,
      dayId:        dayId,
      slot:         slot,
      _unscheduled: !doc.cpSlot,
      done:         doc.status === 'terminee',
    };
  }

  function _normalizePmpInt(doc) {
    const dayId = doc.cpDayId || _dateToDayId(doc.dueDate);
    const slot  = doc.cpSlot  || 'journee';
    return {
      id:           'pmp_' + doc.id,
      _source:      'pmp',
      _sourceId:    doc.id,
      itemType:     'pmp',
      title:        doc.planName || doc.equipmentName || '(Sans titre)',
      location:     doc.zone     || null,
      priority:     doc.criticite || 'normale',
      status:       doc.status   || 'planifiee',
      duration:     doc.estimatedDuration || null,
      assignedTo:   doc.technician || null,
      dayId:        dayId,
      slot:         slot,
      _unscheduled: !doc.cpSlot,
      done:         doc.status === 'terminee',
    };
  }

  function _allPlanItems() {
    // Exceptions ponctuelles (déplacement/édition/suppression d'UNE
    // occurrence) — y compris celles qui portent sur la date d'ancrage du
    // document d'origine lui-même, pour que déplacer/terminer/supprimer
    // cette carte précise ne touche jamais la règle de récurrence globale.
    const excMap = {};
    _tasks.filter(t => t.isException === true).forEach(e => { excMap[e.seriesId + '_' + e.occurrenceDate] = e; });

    const tasks = _tasks
      .filter(t => !t.archivedFromActive && !t.isException && t.dayId)
      .map(t => {
        if (!t.recurrence) return t;
        const anchorDate = _originAnchorDate(t);
        const exc = anchorDate ? excMap[t.id + '_' + anchorDate] : null;
        if (exc && exc.deleted) return null;
        const merged = exc ? Object.assign({}, t, exc, { id: t.id }) : t;
        return Object.assign({}, merged, { _recurOrigin: true });
      })
      .filter(Boolean);
    const virtual = _weekKey ? _virtualOccurrences(_weekKey) : [];
    const ints    = _interventions.map(_normalizeIntervention).filter(t => t.dayId);
    const pmps    = _pmpInts.map(_normalizePmpInt).filter(t => t.dayId);
    return [...tasks, ...virtual, ...ints, ...pmps];
  }

  // ═══════════════════════════════════════════════════════
  //  RÉCURRENCE — génération déterministe des occurrences
  // ═══════════════════════════════════════════════════════
  // Modèle additif, parallèle à l'ancien report hebdomadaire de _seedWeek()
  // (laissé intact pour les anciennes tâches "hebdomadaire" déjà
  // dupliquées semaine après semaine — voir commentaire sur _seedWeek).
  // Une tâche "origine" porte recurrence:'weekly'|'monthly' + ses règles ;
  // les occurrences des AUTRES semaines sont calculées à la volée, jamais
  // écrites en base. Une action utilisateur sur UNE occurrence (déplacer,
  // modifier, terminer) crée un document d'exception à id déterministe
  // (`${seriesId}_occ_${date}`), donc jamais de doublon même si l'action
  // est répétée ou si la semaine est revisitée plusieurs fois.
  const _DAY_JS_INDEX = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

  function _nthWeekdayOfMonth(year, monthIdx, weekdayJs, nth) {
    if (nth === 'last') {
      const last = new Date(year, monthIdx + 1, 0);
      const diff = (last.getDay() - weekdayJs + 7) % 7;
      last.setDate(last.getDate() - diff);
      return last;
    }
    const first = new Date(year, monthIdx, 1);
    const diff  = (weekdayJs - first.getDay() + 7) % 7;
    const date  = 1 + diff + (nth - 1) * 7;
    const d     = new Date(year, monthIdx, date);
    return d.getMonth() === monthIdx ? d : null; // ex: un 5ᵉ lundi qui n'existe pas ce mois-ci
  }

  function _dsOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // Date (YYYY-MM-DD) du document d'origine lui-même, tel qu'affiché sur sa
  // propre semaine de création — utilisée pour l'exclure des occurrences
  // virtuelles (déjà rendue via le vrai document) et pour construire son
  // propre id d'exception ("${origin.id}__occ_${anchorDate}") quand l'usager
  // agit (terminer/supprimer) sur CETTE occurrence précise sans toucher au
  // reste de la série.
  function _originAnchorDate(origin) {
    const originWeekDates = origin.weekKey ? _weekKeyToDates(origin.weekKey) : null;
    const originIdx       = originWeekDates && origin.dayId ? MX.DAYS.findIndex(d => d.id === origin.dayId) : -1;
    return originIdx >= 0 ? _dsOf(originWeekDates[originIdx]) : null;
  }

  function _recurrenceOccurrencesForWeek(origin, weekDates) {
    const anchorDate = _originAnchorDate(origin);
    const start = origin.recurStart || anchorDate;
    const end   = origin.recurEnd || null;
    const out = [];
    weekDates.forEach((d, idx) => {
      const dateStr = _dsOf(d);
      if (dateStr === anchorDate) return; // déjà affichée via le document origine lui-même
      if (start && dateStr < start) return;
      if (end && dateStr > end) return;
      let matches = false;
      if (origin.recurrence === 'daily') {
        matches = true; // tous les jours, seules les bornes recurStart/recurEnd limitent
      } else if (origin.recurrence === 'weekly') {
        const days = Array.isArray(origin.recurDays) && origin.recurDays.length
          ? origin.recurDays : (origin.dayId ? [origin.dayId] : []);
        matches = days.includes(MX.DAYS[idx].id);
      } else if (origin.recurrence === 'monthly') {
        const rule = origin.recurMonthly;
        if (rule && rule.weekday != null && rule.nth != null) {
          const occ = _nthWeekdayOfMonth(d.getFullYear(), d.getMonth(), _DAY_JS_INDEX[rule.weekday], rule.nth);
          matches = !!occ && _dsOf(occ) === dateStr;
        }
      }
      if (matches) out.push({ dayId: MX.DAYS[idx].id, dateStr });
    });
    return out;
  }

  function _virtualOccurrences(weekKey) {
    const weekDates  = _weekKeyToDates(weekKey);
    const exceptions = _tasks.filter(t => t.isException === true);
    const excMap = {};
    exceptions.forEach(e => { excMap[e.seriesId + '_' + e.occurrenceDate] = e; });

    const out = [];
    _recurOrigins.forEach(origin => {
      if (origin.archivedFromActive) return;
      _recurrenceOccurrencesForWeek(origin, weekDates).forEach(({ dayId, dateStr }) => {
        const exc = excMap[origin.id + '_' + dateStr];
        if (exc && exc.deleted) return; // occurrence explicitement supprimée
        const base = {
          id: origin.id + '__occ_' + dateStr,
          title: origin.title, description: origin.description || '',
          priority: origin.priority, assignedTo: origin.assignedTo,
          itemType: origin.itemType || 'tache', category: origin.category,
          location: origin.location || null, duration: origin.duration || null,
          done: false, status: 'todo',
          dayId, weekKey,
          _recurOccurrence: true, _seriesId: origin.id, _occurrenceDate: dateStr,
        };
        out.push(exc ? Object.assign({}, base, exc, { id: base.id, dayId: exc.dayId || dayId }) : base);
      });
    });
    return out;
  }

  // ── USER / DISPLAY HELPERS ──
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
  // ── PRIORITÉ — niveaux personnalisables par les Responsables/Admins
  // (org_config/priorities), jamais déduits de la couleur affichée.
  // Compatibilité : les anciennes valeurs "urgente" et "critique" (écrites
  // avant l'existence de la config dynamique) retombent sur "haute" À
  // L'AFFICHAGE SEULEMENT — jamais réécrites en base. Une valeur qui ne
  // correspond à AUCUN niveau configuré (et qui n'est pas l'un de ces deux
  // alias historiques) n'est JAMAIS interprétée comme une couleur : elle
  // s'affiche dans un état neutre explicite "Non configuré". Voir
  // _effPriority, seule porte d'entrée à utiliser pour LIRE une priorité. ──
  const DEFAULT_PRIO_LEVELS = [
    { id: 'haute',   label: 'Haute',   color: '#EF4444', description: '', order: 0 },
    { id: 'normale', label: 'Normale', color: '#22C55E', description: '', order: 1 },
    { id: 'basse',   label: 'Basse',   color: '#3B82F6', description: '', order: 2 },
  ];
  const LEGACY_PRIO_ALIAS = { urgente: 'haute', critique: 'haute' };
  const UNCONFIGURED_PRIO = { id: null, label: 'Non configuré', color: '#6B7280', bg: 'rgba(107,114,128,.12)', icon: '⚪' };

  function _prioLevelById(id) { return _prioLevels.find(l => l.id === id); }
  function _sortedPrioLevels() { return [..._prioLevels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
  function _defaultPrioId() {
    if (_prioLevelById('normale')) return 'normale';
    const sorted = _sortedPrioLevels();
    return sorted.length ? sorted[0].id : null;
  }
  function _prioBg(hex) {
    const h = (hex || '#6B7280').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) || 0, g = parseInt(h.substring(2, 4), 16) || 0, b = parseInt(h.substring(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},.12)`;
  }
  function _effPriority(t) {
    const raw = (t && typeof t === 'object') ? t.priority : t;
    if (raw == null) return _defaultPrioId(); // nouvelle tâche : pas encore de priorité choisie
    if (_prioLevelById(raw)) return raw;
    const alias = LEGACY_PRIO_ALIAS[raw];
    if (alias && _prioLevelById(alias)) return alias;
    return null; // valeur explicite mais non configurée — jamais interprétée comme une couleur
  }
  function _prioConfig(prioOrTask) {
    const id = _effPriority(prioOrTask);
    if (!id) return UNCONFIGURED_PRIO;
    const lvl = _prioLevelById(id);
    if (!lvl) return UNCONFIGURED_PRIO;
    return { id: lvl.id, label: lvl.label, color: lvl.color, bg: _prioBg(lvl.color), icon: '●' };
  }

  // ═══════════════════════════════════════════════════════
  //  CONFIGURATION DES PRIORITÉS (Responsables/Admins — même accès que le
  //  module) — stockée dans org_config/priorities, jamais écrasée une fois
  //  créée (voir _subscribe). Supprimer un niveau ne touche aucune tâche
  //  existante : elle retombera simplement sur l'état "Non configuré".
  // ═══════════════════════════════════════════════════════
  function openPriorityConfig() {
    MX.showModal({
      title:   'Configurer les priorités',
      sub:     'Visible par les Responsables et Administrateurs',
      body:    _priorityConfigBody(),
      noAutoClose: true,
      actions: [
        { label: 'Fermer', cls: 'cancel', fn: () => MX.closeModal() }
      ]
    });
  }

  function _priorityConfigBody() {
    const sorted = _sortedPrioLevels();
    return `<div class="or-prio-cfg">
      ${!sorted.length ? `<div class="or-prio-cfg-empty">Aucun niveau de priorité configuré. Les tâches existantes s'affichent comme "Non configuré".</div>` : ''}
      <div class="or-prio-cfg-list">
        ${sorted.map(lvl => `
          <div class="or-prio-cfg-row">
            <input type="color" class="or-prio-cfg-color" value="${lvl.color}" onchange="MX.Pages.OrgResp._updatePrioField('${MX.esc(lvl.id)}','color',this.value)" title="Couleur">
            <input type="text" class="fi or-prio-cfg-name" value="${MX.esc(lvl.label)}" placeholder="Nom (ex: Haute priorité)" onchange="MX.Pages.OrgResp._updatePrioField('${MX.esc(lvl.id)}','label',this.value)">
            <input type="text" class="fi or-prio-cfg-desc" value="${MX.esc(lvl.description || '')}" placeholder="Description (optionnel)" onchange="MX.Pages.OrgResp._updatePrioField('${MX.esc(lvl.id)}','description',this.value)">
            <button type="button" class="or-prio-cfg-del" onclick="MX.Pages.OrgResp.openDeletePrioLevel('${MX.esc(lvl.id)}')" title="Supprimer ce niveau">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        `).join('')}
      </div>
      <button type="button" class="or-prio-cfg-add" onclick="MX.Pages.OrgResp._doAddPrioLevel()">
        <i class="fas fa-plus"></i> Ajouter un niveau de priorité
      </button>
    </div>`;
  }

  async function _savePrioLevels(levels) {
    MX.syncStart();
    try {
      await db.collection('org_config').doc('priorities').set({ levels });
      MX.syncEnd();
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  function _updatePrioField(id, field, rawValue) {
    const value = field === 'label' || field === 'description' ? rawValue.trim() : rawValue;
    const updated = _prioLevels.map(l => l.id === id ? { ...l, [field]: value } : l);
    _savePrioLevels(updated);
  }

  function _doAddPrioLevel() {
    const existingIds = _prioLevels.map(l => l.id);
    let n = _prioLevels.length + 1, newId = 'niveau' + n;
    while (existingIds.includes(newId)) { n++; newId = 'niveau' + n; }
    const maxOrder = _prioLevels.reduce((m, l) => Math.max(m, l.order ?? 0), -1);
    const updated = [..._prioLevels, { id: newId, label: 'Nouveau niveau', color: '#6B7280', description: '', order: maxOrder + 1 }];
    _savePrioLevels(updated).then(() => openPriorityConfig());
  }

  function openDeletePrioLevel(id) {
    const lvl = _prioLevelById(id);
    MX.showModal({
      title: 'Supprimer ce niveau de priorité',
      sub:   lvl ? MX.esc(lvl.label) : '',
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Les tâches utilisant déjà ce niveau resteront enregistrées telles quelles, mais s'afficheront comme <strong>non configurées</strong> (sans couleur) tant qu'aucun niveau portant le même identifiant n'est recréé.
        </div>
      </div>`,
      actions: [
        { label: 'Supprimer', cls: 'danger-btn', fn: () => _doDeletePrioLevel(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDeletePrioLevel(id) {
    MX.closeModal();
    const updated = _prioLevels.filter(l => l.id !== id);
    await _savePrioLevels(updated);
    openPriorityConfig();
  }

  // ── TECHNICIENS AFFECTÉS — compat ancienne chaîne unique / nouveau
  // tableau. Ne perd jamais une affectation existante. ──
  function _taskTechs(t) {
    const a = t && t.assignedTo;
    if (Array.isArray(a)) return a.filter(Boolean);
    if (a) return [a];
    return [];
  }
  function _techBubblesHtml(t, max) {
    const names = _taskTechs(t);
    if (!names.length) return '';
    const shown    = max ? names.slice(0, max) : names;
    const overflow = max && names.length > max ? names.length - max : 0;
    return shown.map(n =>
      `<span class="or-av" style="background:${_ucolor(n)}" title="${MX.esc(n)}">${_initials(n)}</span>`
    ).join('') + (overflow ? `<span class="or-av or-av--more" title="${names.slice(max).map(MX.esc).join(', ')}">+${overflow}</span>` : '');
  }

  // ── SÉLECTEUR MULTI-TECHNICIENS (dropdown + chips amovibles) ──
  // Utilise exclusivement MX.state.users (jamais de nom en dur).
  function _techChipsHtml() {
    if (!_orPickerTechs.length) return `<span class="or-tech-chips-empty">Aucun technicien sélectionné</span>`;
    return _orPickerTechs.map(n => {
      const safe = MX.esc(n).replace(/'/g, "\\'");
      return `<span class="or-tech-chip" style="border-color:${_ucolor(n)}">
        <span class="or-av or-av--sm" style="background:${_ucolor(n)}">${_initials(n)}</span>
        ${MX.esc(n)}
        <button type="button" class="or-tech-chip-rm" onclick="MX.Pages.OrgResp._removeTechChip('${safe}')" title="Retirer">&times;</button>
      </span>`;
    }).join('');
  }
  // Grade "Responsable" — réutilise exactement le champ déjà utilisé par
  // MX.Auth.isResponsable()/canSeeAll() (jamais une nouvelle notion de rôle).
  function _isUserResponsable(u) {
    return !!u && (u.rank === 'responsable' || u.role === 'responsable');
  }
  function _techSelectOptionsHtml() {
    const users = (MX.state.users || []).filter(u => u.name && _isUserResponsable(u) && !_orPickerTechs.includes(u.name));
    return users.map(u => `<option value="${MX.esc(u.name)}">${MX.esc(u.name)}</option>`).join('');
  }
  function _techPickerHtml(selected) {
    _orPickerTechs = [...(selected || [])];
    return `<div class="or-tech-picker">
      <div class="or-tech-chips" id="or-f-tech-chips">${_techChipsHtml()}</div>
      <select id="or-f-tech-select" class="fi" onchange="MX.Pages.OrgResp._addTechFromSelect(this)">
        <option value="">+ Ajouter un technicien…</option>
        ${_techSelectOptionsHtml()}
      </select>
    </div>`;
  }
  function _addTechFromSelect(sel) {
    const name = sel.value;
    if (!name) return;
    if (!_orPickerTechs.includes(name)) _orPickerTechs.push(name);
    sel.value = '';
    _refreshTechPicker();
  }
  function _removeTechChip(name) {
    _orPickerTechs = _orPickerTechs.filter(n => n !== name);
    _refreshTechPicker();
  }
  function _refreshTechPicker() {
    const chips = document.getElementById('or-f-tech-chips');
    if (chips) chips.innerHTML = _techChipsHtml();
    const sel = document.getElementById('or-f-tech-select');
    if (sel) sel.innerHTML = `<option value="">+ Ajouter un technicien…</option>${_techSelectOptionsHtml()}`;
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
  function _typeBadge(type) {
    if (type === 'unique')    return `<span class="or-badge or-badge--type-uni">📌 Unique</span>`;
    if (type === 'mensuelle') return `<span class="or-badge or-badge--type-men">🗓 Mensuelle</span>`;
    return `<span class="or-badge or-badge--type-rec">♻️ Récurrente</span>`;
  }

  // ── ERROR HANDLER ──
  function _onFirestoreError(err, ctx) {
    console.error(`[OrgResp] Firestore (${ctx}):`, err.message || err);
    const mc = document.getElementById('main-content');
    if (!mc) return;
    mc.innerHTML = `<div class="or-page">
      <div class="or-header"><div class="or-header-left"><div class="or-title">Centre de Pilotage</div></div></div>
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

  // ── SUBSCRIPTIONS ──
  function _subscribe(weekKey) {
    if (_unsub)        { _unsub();        _unsub        = null; }
    if (_unsubCfg)     { _unsubCfg();     _unsubCfg     = null; }
    if (_unsubInts)    { _unsubInts();    _unsubInts    = null; }
    if (_unsubPmpInts) { _unsubPmpInts(); _unsubPmpInts = null; }
    if (_unsubRecur)   { _unsubRecur();   _unsubRecur   = null; }
    if (_unsubPrio)    { _unsubPrio();    _unsubPrio    = null; }
    _interventions = [];
    _pmpInts       = [];

    // Listen to tasks
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
          err => _onFirestoreError(err, 'subscribe-tasks')
        );
    } catch(e) { _onFirestoreError(e, 'subscribe-tasks-setup'); }

    // Listen to slot config
    try {
      _unsubCfg = db.collection('org_config').doc(weekKey)
        .onSnapshot(
          snap => {
            const cfgData = snap.exists ? snap.data() : {};
            _slotConfig = cfgData.slotConfig || {};
            _slotNames  = cfgData.slotNames  || {};
            if (!_inHistory) _doRender();
          },
          err => console.warn('[OrgResp] cfg:', err.message)
        );
    } catch(e) { console.warn('[OrgResp] cfg-setup:', e.message); }

    // Listen to interventions for this week (real-time, bidirectional)
    const weekDates = _weekKeyToDates(weekKey);
    const _toDS     = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const weekStart = _toDS(weekDates[0]);
    const weekEnd   = _toDS(weekDates[6]);

    try {
      _unsubInts = db.collection('interventions')
        .where('startDate', '>=', weekStart)
        .where('startDate', '<=', weekEnd)
        .onSnapshot(
          snap => {
            _interventions = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.inTrash);
            if (!_inHistory) _doRender();
          },
          err => console.warn('[OrgResp] interventions:', err.message)
        );
    } catch(e) { console.warn('[OrgResp] interventions-setup:', e.message); }

    try {
      _unsubPmpInts = db.collection('pmp_interventions')
        .where('dueDate', '>=', weekStart)
        .where('dueDate', '<=', weekEnd)
        .onSnapshot(
          snap => {
            _pmpInts = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !d.inTrash);
            if (!_inHistory) _doRender();
          },
          err => console.warn('[OrgResp] pmp-ints:', err.message)
        );
    } catch(e) { console.warn('[OrgResp] pmp-ints-setup:', e.message); }

    // Listen to recurrence "origin" tasks — valables pour TOUTES les semaines,
    // indépendamment de weekKey (une tâche créée semaine N doit générer ses
    // occurrences aux semaines N+1, N+2, ... à la volée, sans jamais écrire
    // de doublon en base — voir _virtualOccurrences).
    try {
      _unsubRecur = db.collection('org_tasks')
        .where('recurrence', 'in', ['daily', 'weekly', 'monthly'])
        .onSnapshot(
          snap => {
            _recurOrigins = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(t => !t.archivedFromActive);
            if (!_inHistory) _doRender();
          },
          err => console.warn('[OrgResp] recur-origins:', err.message)
        );
    } catch(e) { console.warn('[OrgResp] recur-origins-setup:', e.message); }

    // Priorités personnalisables (org_config/priorities) — doc unique,
    // indépendant de weekKey. Seedé une seule fois avec les valeurs par
    // défaut (rouge/vert/bleu) si le document n'existe pas encore du tout ;
    // une config existante, même vidée volontairement par un responsable,
    // n'est jamais réécrasée.
    try {
      _unsubPrio = db.collection('org_config').doc('priorities')
        .onSnapshot(
          snap => {
            if (!snap.exists) {
              _prioLevels = DEFAULT_PRIO_LEVELS;
              db.collection('org_config').doc('priorities')
                .set({ levels: DEFAULT_PRIO_LEVELS }, { merge: true })
                .catch(() => {});
            } else {
              const data = snap.data() || {};
              _prioLevels = Array.isArray(data.levels) ? data.levels : [];
            }
            if (!_inHistory) _doRender();
          },
          err => console.warn('[OrgResp] prio-config:', err.message)
        );
    } catch(e) { console.warn('[OrgResp] prio-config-setup:', e.message); }

    // Load templates once
    db.collection('org_templates').get()
      .then(snap => { _templates = snap.docs.map(d => ({ id: d.id, ...d.data() })); })
      .catch(e => console.warn('[OrgResp] templates:', e.message));

    _seedWeek(weekKey).catch(e => console.warn('[OrgResp] seed:', e.message));
  }

  // ── ENTRY POINT ──
  function render() {
    if (!MX.Auth.canSeeAll()) {
      const mc = document.getElementById('main-content');
      if (mc) mc.innerHTML = `<div class="or-page"><div class="or-empty-state"><i class="fas fa-lock" style="font-size:32px;color:var(--text3)"></i><div>Accès réservé aux responsables</div></div></div>`;
      return;
    }
    _inHistory  = false;
    _weekOffset = 0;
    _weekKey    = _getWeekKey(new Date());
    if (!_tab) _tab = 'planning';
    _subscribe(_weekKey);
  }

  function _doRender() {
    const mc = document.getElementById('main-content');
    if (!mc) return;
    try {
      if (_tab === 'tasks') _renderKanban(mc);
      else _renderPlanning(mc);
    } catch(e) {
      console.error('[OrgResp] render error:', e);
      mc.innerHTML = `<div class="or-page"><div class="or-empty-state"><i class="fas fa-triangle-exclamation"></i><div>Erreur: ${MX.esc(e.message)}</div></div></div>`;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PLANNING VIEW — PREMIUM GRID V2
  // ═══════════════════════════════════════════════════════
  function _renderPlanning(mc) {
    const weekDates   = _weekKeyToDates(_weekKey);
    const isCurrentWk = _isCurrentWeek();
    const todayDayId  = _todayDayId();

    const planTasks = _allPlanItems();
    const planDone  = planTasks.filter(t => t.done).length;
    const planTotal = planTasks.length;
    const kbTasks   = _tasks.filter(t => !t.archivedFromActive && !t.dayId);
    const kbDone    = kbTasks.filter(t => t.done).length;

    const wParts = _weekKey.split('_W');
    const wNum   = parseInt(wParts[1]);
    const fmt    = x => x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const wRange = `${fmt(weekDates[0])} → ${fmt(weekDates[6])} ${wParts[0]}`;

    let h = `<div class="or-cp-wrap">`;

    // ── HEADER ──
    h += `<div class="or-cp-header">
      <div class="or-cp-hdr-left">
        <i class="fas fa-users-gear or-cp-title-ico"></i>
        <div>
          <div class="or-cp-title">Organisation Responsable</div>
          <div class="or-cp-subtitle">Organisation hebdomadaire des équipes techniques</div>
        </div>
      </div>
      <div class="or-cp-hdr-center">
        <button class="or-cp-nav-btn" onclick="MX.Pages.OrgResp._prevWeek()" title="Semaine précédente"><i class="fas fa-chevron-left"></i></button>
        <div class="or-cp-week-badge">
          <div class="or-cp-week-num">Semaine ${wNum} ${isCurrentWk ? '<span class="or-cp-week-cur-tag">● En cours</span>' : ''}</div>
          <div class="or-cp-week-dates">${wRange}</div>
        </div>
        <button class="or-cp-nav-btn" onclick="MX.Pages.OrgResp._nextWeek()" title="Semaine suivante"><i class="fas fa-chevron-right"></i></button>
        ${!isCurrentWk ? `<button class="or-cp-cal-btn" onclick="MX.Pages.OrgResp._goToCurrentWeek()" title="Aujourd'hui"><i class="fas fa-house"></i></button>` : ''}
      </div>
      <div class="or-cp-hdr-right">
        <button class="or-cp-hbtn-icon" onclick="MX.Pages.OrgResp.renderHistory()" title="Historique"><i class="fas fa-clock-rotate-left"></i></button>
      </div>
    </div>`;

    // ── ACTION BAR 1 ──
    h += `<div class="or-cp-actions-bar">
      <button class="or-cp-ab-btn or-cp-ab-btn--primary" onclick="MX.Pages.OrgResp.openAddFromHeader()">
        <i class="fas fa-plus"></i> Nouvelle tâche
      </button>
      <div class="or-cp-ab-sep"></div>
      <button class="or-cp-ab-btn" onclick="MX.Pages.OrgResp.openDuplicateDay('')">
        <i class="fas fa-calendar-day"></i> Copier une journée
      </button>
      <button class="or-cp-ab-btn" onclick="MX.Pages.OrgResp.openDuplicateWeek()">
        <i class="fas fa-calendar-week"></i> Copier une semaine
      </button>
      <div class="or-cp-ab-sep"></div>
      <button class="or-cp-ab-btn" onclick="MX.Pages.OrgResp.openTemplateApply('')">
        <i class="fas fa-book-open"></i> Bibliothèque de modèles
      </button>
      <button class="or-cp-ab-btn" onclick="MX.Pages.OrgResp._openCreateTemplate()">
        <i class="fas fa-bookmark"></i> Créer un modèle
      </button>
    </div>`;

    // ── ACTION BAR 2 ──
    h += `<div class="or-cp-actions-bar or-cp-actions-bar--2">
      <button class="or-cp-ab-btn or-cp-ab-btn--launch" onclick="MX.Pages.OrgResp._doLaunchWeek()">
        <i class="fas fa-play"></i> Lancer une nouvelle semaine
      </button>
      <button class="or-cp-ab-btn or-cp-ab-btn--close" onclick="MX.Pages.OrgResp._doCloseWeek()">
        <i class="fas fa-flag-checkered"></i> Clôturer la semaine
      </button>
      <button class="or-cp-ab-btn or-cp-ab-btn--reset" onclick="MX.Pages.OrgResp._doResetValidations()">
        <i class="fas fa-rotate-left"></i> Réinitialiser validations
      </button>
      <div style="flex:1"></div>
      <span style="font-size:11px;color:var(--text3)">${planDone}/${planTotal} validées cette semaine</span>
    </div>`;

    // ── LÉGENDE PRIORITÉS + COMPTEUR ──
    h += _cpRenderPrioLegend(planTasks);

    // ── KPI ROW ──
    h += _cpRenderKpiRow(planTasks, planDone, planTotal);

    // ── VIEW TABS ──
    h += `<div class="or-cp-view-tabs">
      <button class="or-tab${_cpView === 'planning' ? ' or-tab--active' : ''}" onclick="MX.Pages.OrgResp._setCpView('planning')">
        <i class="fas fa-calendar-days"></i> Vue Planning
        ${planTotal > 0 ? `<span class="or-tab-cnt">${planDone}/${planTotal}</span>` : ''}
      </button>
      <button class="or-tab${_cpView === 'timeline' ? ' or-tab--active' : ''}" onclick="MX.Pages.OrgResp._setCpView('timeline')">
        <i class="fas fa-timeline"></i> Vue Timeline
      </button>
      <button class="or-tab" onclick="MX.Pages.OrgResp._setTab('tasks')">
        <i class="fas fa-box-archive"></i> Modèles de tâches
        ${kbTasks.length > 0 ? `<span class="or-tab-cnt">${kbTasks.length}</span>` : ''}
      </button>
    </div>`;

    // ── BODY WRAP ──
    h += `<div class="or-cp-body-wrap-v2">`;

    if (_cpView === 'timeline') {
      h += _cpRenderTimeline(weekDates, isCurrentWk, todayDayId);
    } else {
      h += `<div class="or-cp-grid-area"><div class="or-cp-grid">`;
      MX.DAYS.forEach((day, idx) => { h += _cpRenderDayColumn(day, idx, weekDates, isCurrentWk, todayDayId); });
      h += `</div></div>`;
    }

    h += _cpRenderSidebar(planTasks, planDone, planTotal);
    h += `</div>`; // .or-cp-body-wrap-v2
    h += `</div>`; // .or-cp-wrap
    mc.innerHTML = h;
  }

  // ── LÉGENDE PRIORITÉS (personnalisable) + COMPTEUR ── (maquette)
  function _cpRenderPrioLegend(planTasks) {
    const counts = {};
    planTasks.forEach(t => { const id = _effPriority(t); if (id) counts[id] = (counts[id] || 0) + 1; });
    const levels = _sortedPrioLevels();
    return `<div class="or-prio-legend">
      ${levels.map(lvl => {
        const bg = _prioBg(lvl.color);
        return `<div class="or-prio-legend-card" style="--prio-color:${lvl.color};--prio-bg:${bg}">
          <span class="or-prio-legend-dot"></span>
          <span class="or-prio-legend-lbl">${MX.esc(lvl.label)}</span>
          <span class="or-prio-legend-cnt">${counts[lvl.id] || 0}</span>
        </div>`;
      }).join('')}
      <div class="or-prio-legend-card or-prio-legend-card--total">
        <i class="fas fa-list-check"></i>
        <span class="or-prio-legend-lbl">Tâches cette semaine</span>
        <span class="or-prio-legend-cnt">${planTasks.length}</span>
      </div>
      <button type="button" class="or-prio-legend-cfg" onclick="MX.Pages.OrgResp.openPriorityConfig()" title="Configurer les priorités">
        <i class="fas fa-gear"></i>
      </button>
    </div>`;
  }

  // ── KPI ROW ──
  function _cpRenderKpiRow(planTasks, planDone, planTotal) {
    const interventions = planTasks.filter(t => t.itemType === 'intervention').length;
    const pmps          = planTasks.filter(t => t.itemType === 'pmp').length;
    const reunions      = planTasks.filter(t => t.itemType === 'reunion').length;
    const uniqueTechs   = [...new Set(planTasks.filter(t => t.assignedTo).map(t => t.assignedTo))].length;
    const totalDur      = planTasks.reduce((s, t) => s + (t.duration || 0), 0);
    // "Urgences" = tâches dont la priorité est le premier niveau configuré
    // (ordre croissant) — par convention celui de plus haute sévérité.
    const topPrioId     = _sortedPrioLevels()[0] ? _sortedPrioLevels()[0].id : null;
    const urgents       = topPrioId ? planTasks.filter(t => _effPriority(t) === topPrioId && !t.done).length : 0;
    const pct           = planTotal ? Math.round(planDone / planTotal * 100) : 0;
    const pctC          = pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';
    const durStr        = totalDur > 0 ? `${Math.floor(totalDur/60)}h${totalDur%60>0?String(totalDur%60).padStart(2,'0'):''}` : '—';
    const matinT        = planTasks.filter(t => t.slot === 'matin');

    const cards = [
      { emoji:'📋', val:planTotal,       lbl:'Feuille de route',  sub:`${planDone} éléments validés`,               c:pctC                          },
      { emoji:'🔴', val:interventions,   lbl:'Interventions',     sub:interventions>0?'à planifier':'aucune',        c:interventions>0?'#EF4444':'#10B981' },
      { emoji:'🔧', val:pmps,            lbl:'PMP',               sub:pmps>0?'planifiés':'aucun',                    c:'#8B5CF6'                     },
      { emoji:'⚡', val:urgents,         lbl:'Urgences',          sub:urgents>0?'à traiter':'aucune urgence',        c:urgents>0?'#EF4444':'#10B981' },
      { emoji:'👷', val:uniqueTechs,     lbl:'Techniciens',       sub:'planifiés cette semaine',                     c:'#F59E0B'                     },
      { emoji:'⏱',  val:durStr,          lbl:'Temps estimé',      sub:'total hebdomadaire',                          c:'#06B6D4'                     },
      { emoji:'🤝', val:reunions,        lbl:'Réunions',          sub:reunions>0?'planifiées':'aucune',              c:'#06B6D4'                     },
      { emoji:'📊', val:`${pct}%`,       lbl:'Avancement',        sub:`${planDone} sur ${planTotal}`,                c:pctC                          },
    ];

    return `<div class="or-cp-kpi-row-v2">${cards.map(c =>
      `<div class="or-cp-kpi-card-v2" style="--kpi-accent:${c.c}">
        <div class="or-cp-kpi-ico-v2">${c.emoji}</div>
        <div class="or-cp-kpi-val-v2">${c.val}</div>
        <div class="or-cp-kpi-lbl-v2">${c.lbl}</div>
        <div class="or-cp-kpi-sub-v2">${c.sub}</div>
      </div>`).join('')}</div>`;
  }

  // ── DAY COLUMN ── (refonte : plus de subdivision par créneau horaire —
  // une tâche s'affiche directement dans la colonne de son jour, empilée.
  // _getActiveSlots/_getDefaultSlots restent disponibles pour la vue
  // Timeline et la config avancée optionnelle, mais ne conditionnent plus
  // l'affichage des tâches ordinaires ici.)
  function _cpRenderDayColumn(day, idx, weekDates, isCurrentWk, todayDayId) {
    const dayId    = day.id;
    const date     = weekDates[idx];
    const dateStr  = _fmtDate(date);
    const isToday  = isCurrentWk && dayId === todayDayId;
    const dayTasks = _allPlanItems().filter(t => t.dayId === dayId);

    let h = `<div class="or-day-col${isToday ? ' or-day-col--today' : ''}">`;

    h += `<div class="or-day-col-hdr">
      <div class="or-day-col-hdr-l">
        <div class="or-day-col-name">${day.l}${isToday ? '<span class="or-day-today-dot" title="Aujourd\'hui"></span>' : ''}</div>
        <div class="or-day-col-date">${dateStr}</div>
      </div>
      <div class="or-day-col-hdr-r">
        ${dayTasks.length ? `<span class="or-day-col-count">${dayTasks.length}</span>` : ''}
        <button class="or-day-gear-btn" onclick="MX.Pages.OrgResp.openDayMenu('${dayId}',this)" title="Actions journée">
          <i class="fas fa-ellipsis-vertical"></i>
        </button>
      </div>
    </div>`;

    h += `<div class="or-day-col-body" id="or-daycol-${dayId}"
      ondragover="event.preventDefault();MX.Pages.OrgResp._onDragOver(event,'${dayId}')"
      ondrop="MX.Pages.OrgResp._onDrop(event,'${dayId}')"
      ondragleave="MX.Pages.OrgResp._onDragLeave(event)">`;
    if (!dayTasks.length) {
      h += `<div class="or-day-col-empty">Aucune tâche</div>`;
    } else {
      dayTasks.forEach(t => { h += _cpMissionCardV2(t, dayId); });
    }
    h += `</div>`;

    h += `<button class="or-day-add-btn" onclick="MX.Pages.OrgResp.openAddDayTask('${dayId}')">
      <i class="fas fa-plus"></i> Ajouter une tâche
    </button>`;

    h += `</div>`; // .or-day-col
    return h;
  }

  // ── TASK CARD ── (couleur dérivée UNIQUEMENT de la priorité métier,
  // jamais l'inverse — voir _prioConfig/_effPriority.)
  function _cpMissionCardV2(t, dayId) {
    const prio      = _prioConfig(t);
    const itype     = ITEM_TYPES[t.itemType] || ITEM_TYPES.tache;
    const isDone    = t.done;
    const isInProg  = !isDone && t.status === 'inprogress';
    const statusLbl = isDone ? 'Validée' : (isInProg ? 'En cours' : 'À faire');
    const statusCls = isDone ? 'or-tc-status--done' : isInProg ? 'or-tc-status--prog' : 'or-tc-status--todo';
    const techHtml  = _techBubblesHtml(t, 3);
    const recurIco  = t._recurOrigin ? `<i class="fas fa-rotate or-tc-recur-ico" title="Tâche récurrente"></i>` : '';
    const locHtml   = t.location ? `<span class="or-tc-loc" title="${MX.esc(t.location)}"><i class="fas fa-location-dot"></i> ${MX.esc(t.location)}</span>` : '';
    const planBadge = t._unscheduled ? `<span class="or-tc-badge"><i class="fas fa-clock"></i> À planifier</span>` : '';
    // Validation rapide en un clic : indisponible pour les éléments agrégés
    // d'un autre module (interventions/PMP), gérés par leur propre module.
    const canQuickValidate = !isDone && !t._source;
    const quickValidateBtn = canQuickValidate
      ? `<button type="button" class="or-tc-validate-btn" onclick="event.stopPropagation();MX.Pages.OrgResp._quickValidate('${t.id}',this)" title="Valider cette tâche">
          <i class="fas fa-check"></i> Valider
        </button>`
      : '';
    return `<div class="or-tc${isDone ? ' or-tc--done' : ''}"
      style="--prio-color:${prio.color};--prio-bg:${prio.bg}"
      data-id="${t.id}" draggable="true"
      ondragstart="MX.Pages.OrgResp._onDragStart(event,'${t.id}','${dayId}')"
      ondragend="MX.Pages.OrgResp._onDragEnd(event)">
      <div class="or-tc-top">
        <i class="fas ${itype.icon} or-tc-ico" style="color:${itype.color}"></i>
        <span class="or-tc-title">${MX.esc(t.title)}</span>
        ${recurIco}
        <button class="or-tc-menu" onclick="event.stopPropagation();MX.Pages.OrgResp._cpMissionMenu('${t.id}',this)" title="Actions">
          <i class="fas fa-ellipsis-vertical"></i>
        </button>
      </div>
      ${t.description ? `<div class="or-tc-desc">${MX.esc(t.description)}</div>` : ''}
      ${locHtml || planBadge ? `<div class="or-tc-meta">${locHtml}${planBadge}</div>` : ''}
      <div class="or-tc-bottom">
        <span class="or-tc-status ${statusCls}">${statusLbl}</span>
        <div class="or-tc-avs">${techHtml}</div>
      </div>
      ${quickValidateBtn}
    </div>`;
  }

  // alias for backward compat
  function _cpMissionCard(t, dayId) { return _cpMissionCardV2(t, dayId); }
  function _planTaskCard(t, dayId)  { return _cpMissionCardV2(t, dayId); }

  // ── ITEM TYPE PICKER ──
  function _itypePicker(selected) {
    const sel = selected || 'tache';
    const pills = Object.entries(ITEM_TYPES).map(([v, cfg]) => {
      const isOn = v === sel;
      return `<button type="button" class="or-itype-pill${isOn ? ' or-itype-pill--on' : ''}"
        data-icolor="${cfg.color}" data-ibg="${cfg.bg}"
        style="${isOn ? `background:${cfg.bg};color:${cfg.color};border-color:${cfg.color}` : ''}"
        onclick="MX.Pages.OrgResp._cpSelectItype(this,'${v}')">
        <i class="fas ${cfg.icon}"></i> ${cfg.l}
      </button>`;
    }).join('');
    return `<input type="hidden" id="or-f-itype" value="${MX.esc(sel)}">
    <div class="or-itype-pills">${pills}</div>`;
  }

  function _cpSelectItype(btn, val) {
    const pills = btn.closest('.or-itype-pills');
    if (!pills) return;
    pills.querySelectorAll('.or-itype-pill').forEach(p => {
      p.classList.remove('or-itype-pill--on');
      p.style.background = ''; p.style.color = ''; p.style.borderColor = '';
    });
    btn.classList.add('or-itype-pill--on');
    btn.style.background  = btn.dataset.ibg;
    btn.style.color       = btn.dataset.icolor;
    btn.style.borderColor = btn.dataset.icolor;
    const inp = btn.closest('.or-form')?.querySelector('#or-f-itype');
    if (inp) inp.value = val;
  }

  // ── EXPAND / COLLAPSE ──
  function _cpToggleExpand(expandId) {
    const el  = document.getElementById(expandId);
    const btn = document.getElementById(expandId + '-btn');
    if (!el) return;
    const isHidden = el.style.display === 'none' || el.style.display === '';
    el.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) { el.style.flexDirection = 'column'; el.style.gap = '3px'; }
    if (btn) {
      const cnt = el.querySelectorAll('.or-cp-mc').length;
      btn.innerHTML = isHidden
        ? `<i class="fas fa-chevron-up"></i>&nbsp;Réduire`
        : `<i class="fas fa-chevron-down"></i>&nbsp;${cnt} autre${cnt!==1?'s':''} mission${cnt!==1?'s':''}`;
    }
  }

  // ── MISSION CONTEXT MENU ──
  function _cpMissionMenu(taskId, btn) {
    _closeDropdowns();

    // Source items — open the origin module, no delete/validate from CP
    if (taskId.startsWith('int_')) {
      const menu = document.createElement('div');
      menu.className = 'or-dropdown-menu';
      menu.innerHTML = `<div class="or-dropdown-item" onclick="MX.navigate&&MX.navigate('interventions');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-arrow-up-right-from-square"></i> Module Interventions</div>`;
      _attachDropdown(btn, menu);
      return;
    }
    if (taskId.startsWith('pmp_')) {
      const menu = document.createElement('div');
      menu.className = 'or-dropdown-menu';
      menu.innerHTML = `<div class="or-dropdown-item" onclick="MX.navigate&&MX.navigate('pmp');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-arrow-up-right-from-square"></i> Module PMP</div>`;
      _attachDropdown(btn, menu);
      return;
    }

    // Tâche récurrente (document d'origine affiché sur son jour d'ancrage,
    // OU occurrence virtuelle d'une autre semaine) : Terminer/Rouvrir/
    // Supprimer ne doivent agir QUE sur cette occurrence précise — jamais sur
    // le document d'origine, qui piloterait alors toute la série par erreur.
    const isOccurrence = taskId.includes('__occ_');
    const origin = isOccurrence ? null : _recurOrigins.find(o => o.id === taskId);
    if (isOccurrence || origin) {
      const t = _allPlanItems().find(x => x.id === taskId);
      if (!t) return;
      const seriesId = isOccurrence ? taskId.split('__occ_')[0] : taskId;
      const occId    = isOccurrence ? taskId : (seriesId + '__occ_' + _originAnchorDate(origin));
      const menu = document.createElement('div');
      menu.className = 'or-dropdown-menu';
      menu.innerHTML = `
        <div class="or-dropdown-label">Cette occurrence</div>
        ${!t.done
          ? `<div class="or-dropdown-item" onclick="MX.Pages.OrgResp._occDoneToggle('${occId}',true);MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-check"></i> Terminer</div>`
          : `<div class="or-dropdown-item" onclick="MX.Pages.OrgResp._occDoneToggle('${occId}',false);MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-rotate-left"></i> Rouvrir</div>`
        }
        <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openEditOccurrence('${occId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-pen"></i> Modifier cette occurrence</div>
        <div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp.openDeleteOccurrence('${occId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-trash"></i> Supprimer cette occurrence</div>
        <div class="or-dropdown-sep"></div>
        <div class="or-dropdown-label">Toute la série</div>
        <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openEdit('${seriesId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-rotate"></i> Modifier la série</div>
        <div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp.openDeleteSeries('${seriesId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-trash-can"></i> Supprimer toute la série</div>
      `;
      _attachDropdown(btn, menu);
      return;
    }

    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    const menu = document.createElement('div');
    menu.className = 'or-dropdown-menu';
    menu.innerHTML = `
      ${!t.done
        ? `<div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openValidate('${taskId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-check"></i> Terminer</div>
           <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.moveToInProgress('${taskId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-spinner"></i> En cours</div>`
        : `<div class="or-dropdown-item" onclick="MX.Pages.OrgResp.unvalidate('${taskId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-rotate-left"></i> Rouvrir</div>`
      }
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openEdit('${taskId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-pen"></i> Modifier</div>
      <div class="or-dropdown-sep"></div>
      <div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp.openDelete('${taskId}');MX.Pages.OrgResp._closeDropdowns()"><i class="fas fa-trash"></i> Supprimer</div>
    `;
    _attachDropdown(btn, menu);
  }

  // ── SIDEBAR ──
  function _cpRenderSidebar(planTasks, planDone, planTotal) {
    const techMap = {};
    planTasks.forEach(t => {
      _taskTechs(t).forEach(name => {
        if (!techMap[name]) techMap[name] = { total:0, done:0, dur:0 };
        techMap[name].total++;
        if (t.done) techMap[name].done++;
        techMap[name].dur += t.duration || 0;
      });
    });
    const techList = Object.entries(techMap).sort((a,b) => b[1].total - a[1].total);
    const maxT     = techList.length ? Math.max(...techList.map(([,v]) => v.total)) : 1;

    const techHtml = techList.length === 0
      ? `<div style="font-size:11px;color:var(--text3)">Aucun technicien planifié</div>`
      : techList.slice(0,8).map(([name, s]) => {
          const col = _ucolor(name);
          return `<div class="or-cp-tech-row-v2">
            <div class="or-cp-tech-av-v2" style="background:${col}">${_initials(name)}</div>
            <div class="or-cp-tech-info-v2">
              <div class="or-cp-tech-name-v2" title="${MX.esc(name)}">${MX.esc(name)}</div>
              <div class="or-cp-tech-bar-v2">
                <div class="or-cp-tech-bar-fill-v2" style="width:${Math.round(s.total/maxT*100)}%;background:${col}"></div>
              </div>
            </div>
            <div class="or-cp-tech-cnt-v2" style="color:${col}">${s.total}</div>
          </div>`;
        }).join('');

    const topPrioId2 = _sortedPrioLevels()[0] ? _sortedPrioLevels()[0].id : null;
    const urgents    = topPrioId2 ? planTasks.filter(t => _effPriority(t) === topPrioId2 && !t.done) : [];
    const unassigned = planTasks.filter(t => !_taskTechs(t).length && !t.done);
    const alerts = [];
    if (urgents.length)    alerts.push({ c:'#EF4444', txt:`${urgents.length} mission${urgents.length>1?'s':''} urgente${urgents.length>1?'s':''}` });
    if (unassigned.length) alerts.push({ c:'#F59E0B', txt:`${unassigned.length} mission${unassigned.length>1?'s':''} sans technicien` });
    const alertHtml = alerts.length === 0
      ? `<div style="font-size:11px;color:var(--text3)">Aucune alerte active</div>`
      : alerts.map(a => `<div class="or-cp-alert-item-v2">
          <div class="or-cp-alert-dot-v2" style="background:${a.c}"></div>
          <div class="or-cp-alert-txt-v2">${a.txt}</div>
        </div>`).join('');

    const pct  = planTotal ? Math.round(planDone/planTotal*100) : 0;
    const pctC = pct>=80?'#10B981':pct>=40?'#F59E0B':'#EF4444';
    const r = 30, cx = 37, circ = 2*Math.PI*r;
    const inProg  = planTasks.filter(t => !t.done && t.status==='inprogress').length;
    const pending = planTotal - planDone - inProg;

    return `<div class="or-cp-sidebar-v2">
      <div class="or-cp-sb-section">
        <div class="or-cp-sb-ttl">Tableau de bord</div>
        <div class="or-cp-sb-mini-grid">
          <div class="or-cp-sb-mini" style="background:var(--bg3);">
            <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Total</div>
            <div style="font-size:20px;font-weight:800;font-family:var(--ffm);color:var(--text1);line-height:1.2">${planTotal}</div>
          </div>
          <div class="or-cp-sb-mini" style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.18);">
            <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Validées</div>
            <div style="font-size:20px;font-weight:800;font-family:var(--ffm);color:#10B981;line-height:1.2">${planDone}</div>
          </div>
        </div>
      </div>

      <div class="or-cp-sb-section">
        <div class="or-cp-sb-ttl">Progression <span style="color:${pctC};font-weight:800">${pct}%</span></div>
        <div class="or-cp-ring-wrap-v2">
          <svg width="${cx*2}" height="${cx*2}" viewBox="0 0 ${cx*2} ${cx*2}">
            <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="5"/>
            <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${pctC}" stroke-width="5"
              stroke-dasharray="${circ*pct/100} ${circ*(1-pct/100)}"
              stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
            <text x="${cx}" y="${cx+5}" text-anchor="middle" fill="var(--text1)" font-size="13" font-weight="800" font-family="monospace">${pct}%</text>
          </svg>
          <div class="or-cp-ring-sub-v2">${planDone}/${planTotal} missions</div>
        </div>
        <div class="or-cp-prog-row-v2"><span class="or-cp-prog-dot-v2" style="background:#10B981"></span><span class="or-cp-prog-lbl-v2">Validées</span><span class="or-cp-prog-cnt-v2">${planDone}</span></div>
        <div class="or-cp-prog-row-v2"><span class="or-cp-prog-dot-v2" style="background:#3B82F6"></span><span class="or-cp-prog-lbl-v2">En cours</span><span class="or-cp-prog-cnt-v2">${inProg}</span></div>
        <div class="or-cp-prog-row-v2"><span class="or-cp-prog-dot-v2" style="background:var(--border2)"></span><span class="or-cp-prog-lbl-v2">En attente</span><span class="or-cp-prog-cnt-v2">${pending}</span></div>
      </div>

      <div class="or-cp-sb-section">
        <div class="or-cp-sb-ttl">Techniciens planifiés</div>
        ${techHtml}
      </div>

      <div class="or-cp-sb-section">
        <div class="or-cp-sb-ttl">Alertes ${alerts.length>0?`<span style="background:#EF4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px">${alerts.length}</span>`:''}</div>
        ${alertHtml}
      </div>
    </div>`;
  }

  // ── TIMELINE VIEW ──
  function _cpRenderTimeline(weekDates, isCurrentWk, todayDayId) {
    const hours      = [0,2,4,6,8,10,12,14,16,18,20,22,24];
    const slotColors = { matin:'#F59E0B', journee:'#3B82F6', soir:'#F97316' };
    const slotTimes  = { matin:[6,14], journee:[9,17], soir:[14,22] };

    const hdrHtml = hours.map(h => `<div class="or-cp-tl-hour">${h}h</div>`).join('');

    const rowsHtml = MX.DAYS.map((day, idx) => {
      const dayId      = day.id;
      const isToday    = isCurrentWk && dayId === todayDayId;
      const actSlots   = _getActiveSlots(dayId);
      const barsHtml   = actSlots.map(slot => {
        const [start, end] = slotTimes[slot] || [6,22];
        const left   = (start/24*100).toFixed(2);
        const width  = ((end-start)/24*100).toFixed(2);
        const tasks  = _allPlanItems().filter(t => t.dayId===dayId && t.slot===slot);
        const done   = tasks.filter(t => t.done).length;
        const color  = slotColors[slot] || '#6B7280';
        const allDone = tasks.length>0 && done===tasks.length;
        return `<div class="or-cp-tl-bar" style="left:${left}%;width:${width}%;background:${color};opacity:${allDone?'.4':'.8'}"
          title="${_getSlotName(dayId,slot)} — ${tasks.length} tâche${tasks.length!==1?'s':''}, ${done} validée${done!==1?'s':''}"
          onclick="MX.Pages.OrgResp._setCpView('planning')">
          ${tasks.length} mission${tasks.length!==1?'s':''}
        </div>`;
      }).join('');

      const nowHtml = isToday ? (() => {
        const now  = new Date();
        const pct  = ((now.getHours()+now.getMinutes()/60)/24*100).toFixed(2);
        return `<div class="or-cp-tl-now" style="left:${pct}%"></div>`;
      })() : '';

      return `<div class="or-cp-tl-row">
        <div class="or-cp-tl-lbl">
          <div class="or-cp-tl-day-name${isToday?' or-cp-tl-day-name--today':''}">${day.l}</div>
          <div class="or-cp-tl-day-date">${_fmtDate(weekDates[idx])}</div>
        </div>
        <div class="or-cp-tl-track">${barsHtml}${nowHtml}</div>
      </div>`;
    }).join('');

    return `<div class="or-cp-tl-wrap">
      <div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;font-size:11px;color:var(--text3)">
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#F59E0B;display:inline-block"></span> Matin (06h–14h)</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#3B82F6;display:inline-block"></span> Journée (09h–17h)</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#F97316;display:inline-block"></span> Soir (14h–22h)</span>
        <span style="margin-left:auto">Cliquez sur une barre pour revenir en Vue Planning</span>
      </div>
      <div class="or-cp-tl-hdr">${hdrHtml}</div>
      ${rowsHtml}
    </div>`;
  }

  // ── PANEL HELPERS (kept for API compat, now call slot config modal) ──
  function _toggleDayPanel(dayId) { openSlotConfig(dayId); }
  function _closeDayPanel()       { /* no-op — was panel close */ }
  function _panelToggleSlot(lbl, dayId, slot) {
    const cb = lbl.querySelector('input[type="checkbox"]');
    if (cb) { cb.checked = !cb.checked; lbl.classList.toggle('or-cp-psc--on', cb.checked); }
  }
  async function _saveDayPanel(dayId) {
    const panel = document.getElementById('or-cp-panel');
    if (!panel) return;
    const allSlots = ['matin','journee','soir'];
    const newActive = allSlots.filter(slot => {
      for (const lbl of panel.querySelectorAll('label.or-cp-psc')) {
        if ((lbl.getAttribute('onclick')||'').includes(`'${slot}'`)) return lbl.querySelector('input')?.checked;
      }
      return false;
    });
    MX.syncStart();
    try {
      await db.collection('org_config').doc(_weekKey).set({ slotConfig: Object.assign({}, _slotConfig, { [dayId]: newActive }) }, { merge:true });
      MX.syncEnd(); MX.toast('Créneaux enregistrés ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }
  async function _applyTemplateQuick(tplId, dayId) {
    const tpl = _templates.find(t => t.id === tplId);
    if (!tpl) return MX.toast('Modèle introuvable', true);
    if (!confirm(`Appliquer le modèle "${tpl.name}" à ${dayId} ?`)) return;
    MX.syncStart();
    try {
      const name = _currentUserName(), batch = db.batch(); let ops = 0;
      (tpl.slots || []).forEach(sl => (sl.tasks||[]).forEach((td,i) => {
        if (ops>=490) return;
        batch.set(db.collection('org_tasks').doc(), {
          title:td.title||'Tâche modèle', description:td.description||'',
          category:td.category||'autre', type:td.type||'unique',
          weekKey:_weekKey, dayId, slot:sl.slot,
          done:false, status:'todo', doneBy:null, doneAt:null, comment:null,
          assignedTo:td.assignedTo||null, priority:td.priority||'normale',
          createdBy:name, createdAt:FV.serverTimestamp(), order:900+i, isDefault:false,
        }); ops++;
      }));
      await batch.commit(); MX.syncEnd(); MX.toast(`Modèle "${tpl.name}" appliqué ✓`);
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── NEW WEEK ACTIONS ──
  function _doLaunchWeek() {
    const nextKey = _offsetWeekKey(_weekKey, 1);
    const nextLabel = _weekLabel(nextKey).split('—')[0].trim();
    const undone = _tasks.filter(t => !t.archivedFromActive && t.dayId && !t.done).length;
    MX.showModal({
      title: 'Lancer une nouvelle semaine',
      sub:   nextLabel,
      body:  `<div style="font-size:13px;color:var(--text2);line-height:1.7">
        ${undone > 0 ? `<div style="display:flex;align-items:center;gap:8px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:10px;margin-bottom:12px">
          <i class="fas fa-triangle-exclamation" style="color:#F59E0B"></i>
          <div><strong style="color:var(--text1)">${undone} mission${undone>1?'s':''}</strong> non validée${undone>1?'s':''} cette semaine.</div>
        </div>` : `<div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:10px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-check-circle" style="color:#10B981"></i> Toutes les missions sont validées !
        </div>`}
        <p>Passer à la semaine suivante et commencer la planification ?</p>
      </div>`,
      actions: [
        { label: 'Lancer', cls: 'primary-btn', fn: () => { MX.closeModal(); _nextWeek(); MX.toast('Semaine suivante ouverte ✓'); } },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  function _doCloseWeek() {
    const undone = _tasks.filter(t => !t.archivedFromActive && t.dayId && !t.done).length;
    MX.showModal({
      title: 'Clôturer la semaine',
      sub:   _weekLabel(_weekKey).split('—')[0].trim(),
      body:  `<div style="font-size:13px;color:var(--text2);line-height:1.7">
        ${undone > 0 ? `<div style="display:flex;align-items:center;gap:8px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;margin-bottom:12px">
          <i class="fas fa-triangle-exclamation" style="color:#EF4444"></i>
          <div><strong style="color:var(--text1)">${undone} mission${undone>1?'s':''}</strong> non validée${undone>1?'s':''} seront ignorées.</div>
        </div>` : `<div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:10px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-check-circle" style="color:#10B981"></i> Semaine entièrement validée !
        </div>`}
        <p>Clôturer et passer à la semaine suivante ?</p>
      </div>`,
      actions: [
        { label: 'Clôturer', cls: 'primary-btn', fn: () => { MX.closeModal(); _nextWeek(); MX.toast('Semaine clôturée ✓'); } },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doResetValidations() {
    const done = _tasks.filter(t => !t.archivedFromActive && t.dayId && t.done);
    if (done.length === 0) { MX.toast('Aucune validation à réinitialiser'); return; }
    MX.showModal({
      title: 'Réinitialiser les validations',
      sub:   `${done.length} mission${done.length>1?'s':''} validée${done.length>1?'s':''}`,
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Cela va remettre <strong style="color:var(--red)">${done.length} mission${done.length>1?'s':''}</strong> en statut "À faire".<br>
          Les informations de validation seront effacées.
        </div>
      </div>`,
      actions: [
        { label: 'Réinitialiser', cls: 'danger-btn', fn: async () => {
            MX.closeModal(); MX.syncStart();
            try {
              const batch = db.batch();
              done.forEach(t => batch.update(db.collection('org_tasks').doc(t.id), { done:false, status:'todo', doneBy:null, doneAt:null, comment:null }));
              await batch.commit(); MX.syncEnd(); MX.toast('Validations réinitialisées ✓');
            } catch(e) { MX.syncFail(); MX.toast('Erreur: '+e.message, true); }
          }
        },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  function _setCpView(view) { _cpView = view; _doRender(); }

  function _openCreateTemplate() {
    MX.showModal({
      title: 'Créer un modèle',
      sub:   'Sauvegardez la configuration d\'une journée type',
      body: `<div class="or-form">
        <div style="font-size:12px;color:var(--text3);margin-bottom:10px;padding:8px 10px;background:var(--bg3);border-radius:8px">
          <i class="fas fa-info-circle"></i> Choisissez d'abord la journée à sauvegarder comme modèle.
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Journée source</label>
          <select id="or-ctpl-day" class="fi">
            ${MX.DAYS.map(d => `<option value="${d.id}">${d.l}</option>`).join('')}
          </select>
        </div>
      </div>`,
      actions: [
        { label: 'Continuer', cls: 'primary-btn', fn: () => {
            const dayId = document.getElementById('or-ctpl-day')?.value;
            MX.closeModal();
            if (dayId) openTemplateSave(dayId);
          }
        },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  // ── WEEK NAVIGATION ──
  function _prevWeek() {
    _weekOffset--;
    _weekKey = _offsetWeekKey(_getWeekKey(new Date()), _weekOffset);
    _subscribe(_weekKey);
  }
  function _nextWeek() {
    _weekOffset++;
    _weekKey = _offsetWeekKey(_getWeekKey(new Date()), _weekOffset);
    _subscribe(_weekKey);
  }
  function _goToCurrentWeek() {
    _weekOffset = 0;
    _weekKey = _getWeekKey(new Date());
    _subscribe(_weekKey);
  }

  // ── TABS ──
  function _setTab(tab) {
    _tab = tab;
    _doRender();
  }

  // ── DAY TOGGLE ──
  function _toggleDay(dayId) {
    _dayExpanded[dayId] = _dayExpanded[dayId] === false ? true : false;
    // Update DOM without full re-render
    const body = document.getElementById('or-day-body-' + dayId);
    const chev = document.getElementById('or-day-chev-' + dayId);
    const card = document.getElementById('or-day-' + dayId);
    if (!body || !chev) { _doRender(); return; }
    const expanded = _dayExpanded[dayId] !== false;
    if (!expanded) {
      body.style.display = 'none';
      chev.className = 'fas fa-chevron-down or-day-chev';
    } else {
      body.style.display = '';
      chev.className = 'fas fa-chevron-up or-day-chev';
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SLOT CONFIGURATION
  // ═══════════════════════════════════════════════════════
  function openSlotConfig(dayId) {
    const day   = MX.DAYS.find(d => d.id === dayId);
    const defSlots = _getDefaultSlots(dayId);
    const actSlots = _getActiveSlots(dayId);
    const allSlots = ['matin', 'journee', 'soir'];

    let checksHtml = allSlots.map(slot => {
      const info     = SLOT_INFO[slot];
      const inDef    = defSlots.includes(slot);
      const isActive = actSlots.includes(slot);
      if (!inDef) return ''; // skip slots not available for this day type
      return `<label class="or-slot-check${isActive ? ' or-slot-check--on' : ''}">
        <input type="checkbox" name="or-slot-chk" value="${slot}" ${isActive ? 'checked' : ''}
          onchange="this.closest('label').classList.toggle('or-slot-check--on', this.checked)">
        <i class="fas ${info.icon} or-slot-check-ico" style="color:${info.color}"></i>
        <span>${info.l}</span>
        <span style="font-size:11px;color:var(--text3);margin-left:auto">${info.time}</span>
      </label>`;
    }).join('');

    MX.showModal({
      title: `Configurer ${day ? day.l : dayId}`,
      sub:   'Activez ou désactivez les créneaux pour cette journée (cette semaine uniquement)',
      body:  `<div class="or-slot-checks">${checksHtml}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:12px;padding:8px 10px;background:var(--bg3);border-radius:8px">
          <i class="fas fa-info-circle"></i> Désactiver un créneau masque ses tâches sans les supprimer.
        </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doSaveSlotConfig(dayId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doSaveSlotConfig(dayId) {
    const checked = [...document.querySelectorAll('input[name="or-slot-chk"]:checked')].map(el => el.value);
    MX.closeModal();
    MX.syncStart();
    try {
      const newCfg = Object.assign({}, _slotConfig, { [dayId]: checked });
      await db.collection('org_config').doc(_weekKey).set({ slotConfig: newCfg }, { merge: true });
      MX.syncEnd();
      MX.toast('Configuration enregistrée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _reactivateSlot(dayId, slot) {
    MX.syncStart();
    try {
      const current = _getActiveSlots(dayId);
      if (!current.includes(slot)) {
        const updated = [...current, slot];
        const newCfg  = Object.assign({}, _slotConfig, { [dayId]: updated });
        await db.collection('org_config').doc(_weekKey).set({ slotConfig: newCfg }, { merge: true });
      }
      MX.syncEnd();
      MX.toast('Créneau réactivé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  SLOT MENU (... per slot)
  // ═══════════════════════════════════════════════════════
  function openSlotMenu(dayId, slot, btn) {
    _closeDropdowns();
    const actSlots = _getActiveSlots(dayId);
    const isActive = actSlots.includes(slot);

    const menu = document.createElement('div');
    menu.className = 'or-dropdown-menu';
    menu.innerHTML = `
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openAddDayTask('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-plus"></i> Ajouter une tâche
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openRenameSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-pen-to-square"></i> Renommer ce créneau
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openDuplicateSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-copy"></i> Dupliquer ce créneau
      </div>
      <div class="or-dropdown-sep"></div>
      ${isActive
        ? `<div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp._disableSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
            <i class="fas fa-eye-slash"></i> Désactiver ce créneau
          </div>`
        : `<div class="or-dropdown-item" onclick="MX.Pages.OrgResp._reactivateSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
            <i class="fas fa-eye"></i> Réactiver ce créneau
          </div>`
      }
      <div class="or-dropdown-item or-dropdown-item--warn" onclick="MX.Pages.OrgResp._resetSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-rotate-left"></i> Réinitialiser ce créneau
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp._clearSlot('${dayId}','${slot}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-broom"></i> Vider ce créneau
      </div>
    `;
    _attachDropdown(btn, menu);
  }

  function openDayMenu(dayId, btn) {
    _closeDropdowns();
    const day = MX.DAYS.find(d => d.id === dayId);
    const menu = document.createElement('div');
    menu.className = 'or-dropdown-menu';
    menu.innerHTML = `
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openSlotConfig('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-gear"></i> Configurer les créneaux
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openDuplicateDay('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-copy"></i> Dupliquer cette journée
      </div>
      <div class="or-dropdown-sep"></div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openTemplateSave('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-bookmark"></i> Sauvegarder comme modèle
      </div>
      <div class="or-dropdown-item" onclick="MX.Pages.OrgResp.openTemplateApply('${dayId}');MX.Pages.OrgResp._closeDropdowns()">
        <i class="fas fa-wand-magic-sparkles"></i> Appliquer un modèle
      </div>
    `;
    _attachDropdown(btn, menu);
  }

  function _attachDropdown(btn, menu) {
    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.zIndex   = '9999';
    const menuW = 200;
    let left = rect.right - menuW;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.dataset.orDropdown = '1';
    setTimeout(() => {
      document.addEventListener('click', _closeDropdowns, { once: true });
    }, 10);
  }

  function _closeDropdowns() {
    document.querySelectorAll('[data-or-dropdown]').forEach(el => el.remove());
  }

  async function _disableSlot(dayId, slot) {
    const current = _getActiveSlots(dayId);
    const updated = current.filter(s => s !== slot);
    MX.syncStart();
    try {
      const newCfg = Object.assign({}, _slotConfig, { [dayId]: updated });
      await db.collection('org_config').doc(_weekKey).set({ slotConfig: newCfg }, { merge: true });
      MX.syncEnd();
      MX.toast('Créneau désactivé');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _clearSlot(dayId, slot) {
    const slotTasks = _tasks.filter(t => t.dayId === dayId && t.slot === slot);
    if (slotTasks.length === 0) { MX.toast('Ce créneau est déjà vide'); return; }
    MX.showModal({
      title: 'Vider le créneau',
      sub:   `${SLOT_INFO[slot].l} — ${MX.DAYS.find(d => d.id === dayId)?.l || dayId}`,
      body:  `<div style="color:var(--text2);font-size:13px">Supprimer les <strong>${slotTasks.length}</strong> tâche(s) de ce créneau ?</div>`,
      actions: [
        { label: 'Vider', cls: 'danger-btn', fn: async () => {
          MX.syncStart();
          try {
            const batch = db.batch();
            slotTasks.forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
            await batch.commit();
            MX.syncEnd(); MX.toast('Créneau vidé');
          } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  // ── SLOT RENAME ──
  function openRenameSlot(dayId, slot) {
    const info    = SLOT_INFO[slot];
    const current = _getSlotName(dayId, slot);
    const day     = MX.DAYS.find(d => d.id === dayId);
    MX.showModal({
      title: 'Renommer le créneau',
      sub:   `${day?.l || dayId} — ${info?.l || slot}`,
      body:  `<div class="or-form">
        <div class="or-form-row">
          <label class="or-form-lbl">Nom affiché <span style="color:var(--red)">*</span></label>
          <input id="or-ren-name" class="fi" value="${MX.esc(current)}" placeholder="${MX.esc(info?.l || slot)}" maxlength="60">
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:8px">
          <i class="fas fa-info-circle"></i> Le nom personnalisé s'applique à cette semaine uniquement.
        </div>
      </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doRenameSlot(dayId, slot) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => { const el = document.getElementById('or-ren-name'); if (el) { el.focus(); el.select(); } }, 50);
  }

  async function _doRenameSlot(dayId, slot) {
    const name = (document.getElementById('or-ren-name')?.value || '').trim();
    if (!name) { MX.toast('Le nom ne peut pas être vide', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      const key     = dayId + '_' + slot;
      const updated = Object.assign({}, _slotNames, { [key]: name });
      await db.collection('org_config').doc(_weekKey).set({ slotNames: updated }, { merge: true });
      MX.syncEnd();
      MX.toast('Créneau renommé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── SLOT DUPLICATION ──
  function openDuplicateSlot(srcDayId, srcSlot) {
    const srcName = _getSlotName(srcDayId, srcSlot);
    const srcDay  = MX.DAYS.find(d => d.id === srcDayId);
    const dstOptions = MX.DAYS.flatMap(day => {
      if (day.id === srcDayId) return [];
      return MX.getDaySlots(day.id).map(s =>
        `<option value="${day.id}:${s}">${MX.esc(day.l)} — ${MX.esc(_getSlotName(day.id, s))}</option>`
      );
    }).join('');

    MX.showModal({
      title: 'Dupliquer le créneau',
      sub:   `${srcDay?.l || srcDayId} — ${srcName}`,
      body:  `<div class="or-form">
        <div class="or-form-row">
          <label class="or-form-lbl">Destination</label>
          <select id="or-sdup-dst" class="fi">
            <option value="">— Choisir un créneau —</option>
            ${dstOptions}
          </select>
        </div>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:8px">
          <input type="checkbox" id="or-sdup-replace">
          <span>Remplacer les tâches existantes à la destination</span>
        </label>
      </div>`,
      actions: [
        { label: 'Dupliquer', cls: 'primary-btn', fn: () => _doDuplicateSlot(srcDayId, srcSlot) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDuplicateSlot(srcDayId, srcSlot) {
    const val = document.getElementById('or-sdup-dst')?.value;
    if (!val) { MX.toast('Sélectionnez un créneau de destination', true); return; }
    const [dstDayId, dstSlot] = val.split(':');
    const replace = document.getElementById('or-sdup-replace')?.checked;
    MX.closeModal();
    MX.syncStart();
    try {
      const srcTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === srcDayId && t.slot === srcSlot);
      const name     = _currentUserName();
      const batch    = db.batch();

      if (replace) {
        _tasks.filter(t => t.dayId === dstDayId && t.slot === dstSlot)
          .forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
      }
      const existing    = replace ? [] : _tasks.filter(t => !t.archivedFromActive && t.dayId === dstDayId && t.slot === dstSlot);
      const existTitles = existing.map(t => t.title.trim().toLowerCase());
      let copied = 0;

      srcTasks.forEach((t, i) => {
        if (!replace && existTitles.includes(t.title.trim().toLowerCase())) return;
        batch.set(db.collection('org_tasks').doc(), {
          title: t.title, description: t.description || '',
          category: t.category || 'autre', type: t.type || 'unique',
          priority: t.priority || 'normale',
          assignedTo: t.assignedTo || null,
          weekKey: _weekKey, dayId: dstDayId, slot: dstSlot,
          done: false, status: 'todo',
          doneBy: null, doneAt: null, comment: null,
          archivedFromActive: false, isDefault: false,
          createdBy: name, createdAt: FV.serverTimestamp(),
          order: existing.length + i,
        });
        copied++;
      });

      await batch.commit();
      MX.syncEnd();
      MX.toast(`${copied} tâche(s) copiée(s) ✓`);
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── SLOT RESET ──
  function _resetSlot(dayId, slot) {
    const slotTasks = _tasks.filter(t => t.dayId === dayId && t.slot === slot);
    const day       = MX.DAYS.find(d => d.id === dayId);
    const slotName  = _getSlotName(dayId, slot);
    MX.showModal({
      title: 'Réinitialiser le créneau',
      sub:   `${day?.l || dayId} — ${slotName}`,
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          Cela va <strong style="color:var(--red)">supprimer les ${slotTasks.length} tâche(s)</strong> de ce créneau,
          le réactiver et effacer son nom personnalisé.<br>Cette action est irréversible.
        </div>
      </div>`,
      actions: [
        { label: 'Réinitialiser', cls: 'danger-btn', fn: () => _doResetSlot(dayId, slot) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doResetSlot(dayId, slot) {
    MX.closeModal();
    MX.syncStart();
    try {
      const batch = db.batch();
      _tasks.filter(t => t.dayId === dayId && t.slot === slot)
        .forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
      await batch.commit();

      // Re-enable slot and clear custom name
      const defaultSlots = _getDefaultSlots(dayId);
      const current = _getActiveSlots(dayId);
      const updated = [...new Set([...current, slot])].filter(s => defaultSlots.includes(s));
      const newCfg  = Object.assign({}, _slotConfig, { [dayId]: updated });
      const newNames = Object.assign({}, _slotNames);
      delete newNames[dayId + '_' + slot];

      await db.collection('org_config').doc(_weekKey).set(
        { slotConfig: newCfg, slotNames: newNames },
        { merge: true }
      );
      MX.syncEnd();
      MX.toast('Créneau réinitialisé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  DAY DUPLICATION
  // ═══════════════════════════════════════════════════════
  function openDuplicateDay(srcDayId) {
    const srcDay    = MX.DAYS.find(d => d.id === srcDayId);
    const noSrc     = !srcDayId;
    const otherDays = noSrc ? MX.DAYS : MX.DAYS.filter(d => d.id !== srcDayId);

    // Source selector (shown when called from header button with no srcDayId)
    const srcHtml = noSrc
      ? `<div class="or-form-row">
          <label class="or-form-lbl">Source</label>
          <select id="or-dup-src" class="fi" onchange="MX.Pages.OrgResp._onDupSrcChange(this.value)">
            <option value="">— Choisir la journée source —</option>
            ${MX.DAYS.map(d => `<option value="${d.id}">${d.l}</option>`).join('')}
          </select>
        </div>`
      : `<div class="or-form-row">
          <label class="or-form-lbl">Source</label>
          <div class="fi" style="background:var(--bg3);opacity:.8">${srcDay ? srcDay.l : srcDayId}</div>
        </div>`;

    const body = `<div>
      <div class="or-form-2col" style="margin-bottom:12px">
        ${srcHtml}
        <div class="or-form-row">
          <label class="or-form-lbl">Destination</label>
          <select id="or-dup-dst" class="fi" onchange="MX.Pages.OrgResp._updateDupPreview(document.getElementById('or-dup-src')?.value||'${srcDayId}',this.value)">
            <option value="">— Choisir un jour —</option>
            ${otherDays.map(d => `<option value="${d.id}">${d.l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="or-dup-options" style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Options de copie</div>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-titles" checked><span>Titres et descriptions</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-assign"><span>Affectations</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-prio"><span>Priorités</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-dup-cat"><span>Catégories</span></label>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:8px">
          <input type="checkbox" id="or-dup-replace">
          <span>Remplacer les tâches existantes (sinon : fusionner)</span>
        </label>
        <label class="or-checkbox" id="or-dup-skip-wrap" style="display:none;margin-top:4px">
          <input type="checkbox" id="or-dup-skip-uncovered">
          <span>Ignorer les créneaux non couverts à la destination</span>
        </label>
      </div>
      <div class="or-dup-preview" id="or-dup-preview">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Aperçu</div>
        <div style="color:var(--text3);font-size:12px">Sélectionnez les jours source et destination</div>
      </div>
    </div>`;

    MX.showModal({
      title:   'Dupliquer une journée',
      sub:     noSrc ? 'Copie les tâches d\'un jour vers un autre' : `Copie les tâches de ${srcDay ? srcDay.l : srcDayId} vers un autre jour`,
      body,
      actions: [
        { label: 'Dupliquer', cls: 'primary-btn', fn: () => {
            const sSrc = noSrc ? (document.getElementById('or-dup-src')?.value || '') : srcDayId;
            _doDuplicateDay(sSrc);
          }
        },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  function _onDupSrcChange(newSrc) {
    // When source changes, reset destination options to exclude the new source
    const dst = document.getElementById('or-dup-dst');
    if (!dst) return;
    const curDst = dst.value;
    dst.innerHTML = `<option value="">— Choisir un jour —</option>` +
      MX.DAYS.filter(d => d.id !== newSrc).map(d => `<option value="${d.id}"${d.id===curDst?' selected':''}>${d.l}</option>`).join('');
    // Refresh preview
    if (curDst && curDst !== newSrc) _updateDupPreview(newSrc, curDst);
  }

  async function _updateDupPreview(srcDayId, dstDayId) {
    const preview = document.getElementById('or-dup-preview');
    if (!preview) return;
    const skipWrap = document.getElementById('or-dup-skip-wrap');

    if (!dstDayId) {
      preview.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Aperçu</div>
        <div style="color:var(--text3);font-size:12px">Sélectionnez un jour de destination</div>`;
      if (skipWrap) skipWrap.style.display = 'none';
      return;
    }

    preview.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text3);font-size:12px"><i class="fas fa-spinner fa-spin"></i> Analyse en cours…</div>`;

    const srcTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === srcDayId);
    const dstTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dstDayId);
    const srcDay   = MX.DAYS.find(d => d.id === srcDayId);
    const dstDay   = MX.DAYS.find(d => d.id === dstDayId);

    // Load absences from Firestore
    let absentUsers = [];
    try {
      const date    = _getDateForDay(_weekKey, dstDayId);
      const dateStr = date ? date.toISOString().slice(0, 10) : '';
      if (dateStr) {
        const absSnap = await db.collection('absences').where('to', '>=', dateStr).get();
        absentUsers = absSnap.docs.map(d => d.data())
          .filter(a => (a.from || '').slice(0, 10) <= dateStr)
          .map(a => a.userId || a.name).filter(Boolean);
      }
    } catch(e) { /* non-critical */ }

    // Slot coverage analysis
    const dstActiveSlots  = _getActiveSlots(dstDayId);
    const srcSlots        = [...new Set(srcTasks.map(t => t.slot).filter(Boolean))];
    const uncoveredSlots  = srcSlots.filter(s => !dstActiveSlots.includes(s));
    const uncoveredCount  = srcTasks.filter(t => t.slot && uncoveredSlots.includes(t.slot)).length;

    // Absence conflicts
    const assigned  = srcTasks.map(t => t.assignedTo).filter(Boolean);
    const conflicts = [...new Set(assigned.filter(n => absentUsers.includes(n)))];

    let warnings = '';
    if (conflicts.length > 0) {
      warnings += `<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;font-size:12px;color:#EF4444">
        <i class="fas fa-triangle-exclamation"></i> <strong>${MX.esc(conflicts.join(', '))}</strong> ${conflicts.length > 1 ? 'sont absents' : 'est absent(e)'} ce jour-là.
      </div>`;
    }
    if (uncoveredSlots.length > 0) {
      if (skipWrap) skipWrap.style.display = '';
      warnings += `<div style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px;font-size:12px;color:#F59E0B">
        <i class="fas fa-triangle-exclamation"></i> ${uncoveredCount} tâche(s) dans des créneaux inactifs à la destination (${uncoveredSlots.map(s => SLOT_INFO[s]?.l || s).join(', ')}).
      </div>`;
    } else {
      if (skipWrap) skipWrap.style.display = 'none';
    }

    preview.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Aperçu</div>
      <div class="or-dup-preview-grid">
        <div class="or-dup-preview-col">
          <div class="or-dup-preview-label">${srcDay ? srcDay.l : srcDayId}</div>
          <div class="or-dup-preview-cnt">${srcTasks.length} tâche(s)</div>
        </div>
        <div class="or-dup-preview-arrow"><i class="fas fa-arrow-right"></i></div>
        <div class="or-dup-preview-col">
          <div class="or-dup-preview-label">${dstDay ? dstDay.l : dstDayId}</div>
          <div class="or-dup-preview-cnt">${dstTasks.length} tâche(s) existante(s)</div>
        </div>
      </div>
      ${warnings}`;
  }

  async function _doDuplicateDay(srcDayId) {
    const dstDayId   = document.getElementById('or-dup-dst')?.value;
    if (!dstDayId)   { MX.toast('Sélectionnez un jour de destination', true); return; }
    const copyAssign  = document.getElementById('or-dup-assign')?.checked;
    const copyPrio    = document.getElementById('or-dup-prio')?.checked;
    const copyCat     = document.getElementById('or-dup-cat')?.checked;
    const replace     = document.getElementById('or-dup-replace')?.checked;
    const skipUncov   = document.getElementById('or-dup-skip-uncovered')?.checked;
    MX.closeModal();
    MX.syncStart();
    try {
      const dstActiveSlots = _getActiveSlots(dstDayId);
      let srcTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === srcDayId);

      if (skipUncov) {
        srcTasks = srcTasks.filter(t => !t.slot || dstActiveSlots.includes(t.slot));
      }

      const name  = _currentUserName();
      const batch = db.batch();

      if (replace) {
        _tasks.filter(t => t.dayId === dstDayId)
          .forEach(t => batch.delete(db.collection('org_tasks').doc(t.id)));
      }

      const dstExisting = replace ? [] : _tasks.filter(t => !t.archivedFromActive && t.dayId === dstDayId);
      const existTitles = dstExisting.map(t => t.title.trim().toLowerCase());
      let copied = 0, skipped = 0;

      srcTasks.forEach((t, i) => {
        if (!replace && existTitles.includes(t.title.trim().toLowerCase())) { skipped++; return; }
        batch.set(db.collection('org_tasks').doc(), {
          title:       t.title,
          description: t.description || '',
          category:    copyCat  ? (t.category || 'autre')   : 'autre',
          type:        t.type || 'unique',
          priority:    copyPrio ? (t.priority || 'normale')  : 'normale',
          assignedTo:  copyAssign ? (t.assignedTo || null)   : null,
          weekKey:     _weekKey,
          dayId:       dstDayId,
          slot:        t.slot || null,
          done:        false, status: 'todo',
          doneBy:      null, doneAt: null, comment: null,
          archivedFromActive: false,
          isDefault:   false,
          createdBy:   name, createdAt: FV.serverTimestamp(),
          order:       (dstExisting.length + i),
        });
        copied++;
      });

      await batch.commit();
      db.collection('admin_journal').add({
        action: 'duplicate_day', by: name, at: FV.serverTimestamp(),
        weekKey: _weekKey, from: srcDayId, to: dstDayId, count: copied,
      }).catch(() => {});
      MX.syncEnd();
      const srcDay = MX.DAYS.find(d => d.id === srcDayId);
      const dstDay = MX.DAYS.find(d => d.id === dstDayId);
      const msg = skipped > 0
        ? `${copied} tâche(s) copiée(s), ${skipped} déjà présente(s) ✓`
        : `${srcDay?.l || srcDayId} → ${dstDay?.l || dstDayId} : ${copied} tâche(s) copiée(s) ✓`;
      MX.toast(msg);
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  WEEK DUPLICATION
  // ═══════════════════════════════════════════════════════
  function openDuplicateWeek() {
    const nextKey = _offsetWeekKey(_weekKey, 1);
    const body = `<div>
      <div style="background:var(--bg3);border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Source</div>
        <div style="font-size:14px;font-weight:600;color:var(--text1)">${_weekLabel(_weekKey)}</div>
      </div>
      <div style="background:var(--bg3);border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Destination</div>
        <div style="font-size:14px;font-weight:600;color:var(--cyan)">${_weekLabel(nextKey)}</div>
      </div>
      <div class="or-dup-options">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Options</div>
        <label class="or-checkbox"><input type="checkbox" id="or-wdup-tasks" checked><span>Tâches planning (avec jour/créneau)</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-wdup-kanban" checked><span>Tâches hebdomadaires (Kanban)</span></label>
        <label class="or-checkbox"><input type="checkbox" id="or-wdup-assign"><span>Conserver les affectations</span></label>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:8px">
          <input type="checkbox" id="or-wdup-replace">
          <span>Remplacer les tâches existantes de la semaine suivante</span>
        </label>
      </div>
    </div>`;

    MX.showModal({
      title:   'Dupliquer la semaine',
      sub:     `Copier vers ${_weekLabel(nextKey)}`,
      body,
      actions: [
        { label: 'Dupliquer', cls: 'primary-btn', fn: () => _doDuplicateWeek(nextKey) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDuplicateWeek(nextKey) {
    const copyTasks  = document.getElementById('or-wdup-tasks')?.checked;
    const copyKanban = document.getElementById('or-wdup-kanban')?.checked;
    const copyAssign = document.getElementById('or-wdup-assign')?.checked;
    const replace    = document.getElementById('or-wdup-replace')?.checked;
    MX.closeModal();
    MX.syncStart();
    try {
      const name = _currentUserName();

      // Fetch next week existing
      const nextSnap = await db.collection('org_tasks').where('weekKey', '==', nextKey).get();
      const nextExisting = nextSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const toDelete = replace ? nextExisting : [];
      const toCopy   = _tasks.filter(t => {
        if (t.archivedFromActive) return false;
        if (t.dayId && copyTasks) return true;
        if (!t.dayId && copyKanban) return true;
        return false;
      });

      const existTitles = replace ? [] : nextExisting.map(t => (t.title || '').trim().toLowerCase());

      // Batch (split at 499)
      const ops = [...toDelete.map(t => ({ type: 'del', id: t.id })),
                   ...toCopy.map((t, i) => ({ type: 'set', t, i }))];

      for (let chunk = 0; chunk < ops.length; chunk += 490) {
        const batch = db.batch();
        ops.slice(chunk, chunk + 490).forEach(op => {
          if (op.type === 'del') {
            batch.delete(db.collection('org_tasks').doc(op.id));
          } else {
            const t = op.t;
            if (!replace && existTitles.includes(t.title.trim().toLowerCase())) return;
            batch.set(db.collection('org_tasks').doc(), {
              title: t.title, description: t.description || '',
              category: t.category || 'autre', type: t.type || 'hebdomadaire',
              priority: t.priority || 'normale',
              assignedTo: copyAssign ? (t.assignedTo || null) : null,
              weekKey: nextKey,
              dayId:  t.dayId || null,
              slot:   t.slot  || null,
              done: false, status: 'todo',
              doneBy: null, doneAt: null, comment: null,
              archivedFromActive: false, isDefault: false,
              createdBy: name, createdAt: FV.serverTimestamp(),
              order: (nextExisting.length + op.i),
            });
          }
        });
        await batch.commit();
      }

      db.collection('admin_journal').add({
        action: 'duplicate_week', by: name, at: FV.serverTimestamp(),
        from: _weekKey, to: nextKey, count: toCopy.length,
      }).catch(() => {});
      MX.syncEnd();
      MX.toast('Semaine dupliquée vers ' + _weekLabel(nextKey) + ' ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  TEMPLATES
  // ═══════════════════════════════════════════════════════
  function openTemplateSave(dayId) {
    const day      = MX.DAYS.find(d => d.id === dayId);
    const dayTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
    if (dayTasks.length === 0) { MX.toast('Aucune tâche à sauvegarder dans ce modèle', true); return; }

    MX.showModal({
      title: 'Sauvegarder comme modèle',
      sub:   `${dayTasks.length} tâche(s) de ${day?.l || dayId}`,
      body:  `<div class="or-form">
        <div class="or-form-row">
          <label class="or-form-lbl">Nom du modèle <span style="color:var(--red)">*</span></label>
          <input id="or-tpl-name" class="fi" placeholder="ex: Samedi Standard, Jour Férié…" maxlength="80">
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Description</label>
          <input id="or-tpl-desc" class="fi" placeholder="Optionnel" maxlength="200">
        </div>
      </div>`,
      actions: [
        { label: 'Sauvegarder', cls: 'primary-btn', fn: () => _doSaveTemplate(dayId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('or-tpl-name')?.focus(), 50);
  }

  async function _doSaveTemplate(dayId) {
    const name = (document.getElementById('or-tpl-name')?.value || '').trim();
    if (!name) { MX.toast('Le nom du modèle est obligatoire', true); return; }
    const desc  = (document.getElementById('or-tpl-desc')?.value || '').trim();
    const tasks = _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
    MX.closeModal();
    MX.syncStart();
    try {
      const user = _currentUserName();
      await db.collection('org_templates').add({
        name, description: desc,
        dayId,
        createdBy: user, createdAt: FV.serverTimestamp(),
        tasks: tasks.map(t => ({
          title: t.title, description: t.description || '',
          category: t.category || 'autre', type: t.type || 'unique',
          priority: t.priority || 'normale', slot: t.slot || null,
          assignedTo: t.assignedTo || null,
        })),
      });
      // Refresh templates
      const snap = await db.collection('org_templates').get();
      _templates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      MX.syncEnd();
      MX.toast('Modèle "' + name + '" sauvegardé ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  function openTemplateApply(dayId) {
    if (_templates.length === 0) {
      MX.toast('Aucun modèle disponible. Sauvegardez d\'abord une journée comme modèle.', true);
      return;
    }
    const day   = MX.DAYS.find(d => d.id === dayId);
    const noDst = !dayId;

    const dstHtml = noDst
      ? `<div class="or-form-row" style="margin-bottom:10px">
          <label class="or-form-lbl">Appliquer sur</label>
          <select id="or-tpl-dst-day" class="fi">
            <option value="">— Choisir un jour —</option>
            ${MX.DAYS.map(d => `<option value="${d.id}">${d.l}</option>`).join('')}
          </select>
        </div>`
      : '';

    const tplList = _templates.map((tpl, i) => `
      <div class="or-tpl-item" onclick="document.querySelectorAll('.or-tpl-item').forEach(x=>x.classList.remove('or-tpl-item--sel'));this.classList.add('or-tpl-item--sel');document.getElementById('or-tpl-sel').value='${tpl.id}'">
        <div class="or-tpl-name">${MX.esc(tpl.name)}</div>
        <div class="or-tpl-meta">${tpl.tasks ? tpl.tasks.length : 0} tâche(s)${tpl.description ? ' — ' + MX.esc(tpl.description) : ''}</div>
        <button class="or-tpl-del" onclick="event.stopPropagation();MX.Pages.OrgResp._deleteTemplate('${tpl.id}')" title="Supprimer ce modèle"><i class="fas fa-trash"></i></button>
      </div>`).join('');

    MX.showModal({
      title: 'Appliquer un modèle',
      sub:   noDst ? 'Choisissez un modèle et un jour cible' : `Sur ${day?.l || dayId}`,
      body:  `<input type="hidden" id="or-tpl-sel" value="">
        ${dstHtml}
        <div class="or-tpl-list">${tplList}</div>
        <label class="or-checkbox or-checkbox--warn" style="margin-top:10px">
          <input type="checkbox" id="or-tpl-replace">
          <span>Remplacer les tâches existantes</span>
        </label>`,
      actions: [
        { label: 'Appliquer', cls: 'primary-btn', fn: () => {
            const dst = noDst ? (document.getElementById('or-tpl-dst-day')?.value || '') : dayId;
            if (!dst) { MX.toast('Sélectionnez un jour de destination', true); return; }
            _doApplyTemplate(dst);
          }
        },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doApplyTemplate(dayId) {
    const tplId   = document.getElementById('or-tpl-sel')?.value;
    const replace = document.getElementById('or-tpl-replace')?.checked;
    const tpl     = _templates.find(t => t.id === tplId);
    if (!tpl) { MX.toast('Sélectionnez un modèle', true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      const name  = _currentUserName();
      const batch = db.batch();
      if (replace) {
        _tasks.filter(t => t.dayId === dayId).forEach(t => {
          batch.delete(db.collection('org_tasks').doc(t.id));
        });
      }
      const existing = replace ? [] : _tasks.filter(t => !t.archivedFromActive && t.dayId === dayId);
      const existTitles = existing.map(t => t.title.trim().toLowerCase());

      (tpl.tasks || []).forEach((t, i) => {
        if (!replace && existTitles.includes(t.title.trim().toLowerCase())) return;
        batch.set(db.collection('org_tasks').doc(), {
          title: t.title, description: t.description || '',
          category: t.category || 'autre', type: t.type || 'unique',
          priority: t.priority || 'normale',
          slot: t.slot || null, assignedTo: t.assignedTo || null,
          weekKey: _weekKey, dayId,
          done: false, status: 'todo',
          doneBy: null, doneAt: null, comment: null,
          archivedFromActive: false, isDefault: false,
          createdBy: name, createdAt: FV.serverTimestamp(),
          order: (existing.length + i),
        });
      });
      await batch.commit();
      MX.syncEnd();
      MX.toast('Modèle "' + tpl.name + '" appliqué ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  async function _deleteTemplate(tplId) {
    if (!confirm('Supprimer ce modèle ?')) return;
    try {
      await db.collection('org_templates').doc(tplId).delete();
      _templates = _templates.filter(t => t.id !== tplId);
      MX.toast('Modèle supprimé');
      MX.closeModal();
    } catch(e) { MX.toast('Erreur: ' + e.message, true); }
  }

  // ═══════════════════════════════════════════════════════
  //  DRAG AND DROP
  // ═══════════════════════════════════════════════════════
  // ── GLISSER-DÉPOSER — jour à jour uniquement (plus de créneau). Pas de
  // mise à jour optimiste : la carte ne bouge visuellement qu'une fois
  // Firestore confirmé, donc rien à restaurer en cas d'échec — elle reste
  // simplement à sa place, avec un message clair. ──
  function _onDragStart(event, taskId, srcDayId) {
    _dragData = { taskId, srcDayId };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
    const el = event.currentTarget;
    setTimeout(() => el && el.classList.add('or-tc--dragging'), 0);
  }

  function _onDragEnd(event) {
    const el = event.currentTarget;
    if (el) el.classList.remove('or-tc--dragging');
    _dragData = null;
  }

  function _onDragOver(event, dstDayId) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const el = document.getElementById('or-daycol-' + dstDayId);
    if (el) el.classList.add('or-day-col-body--drag-over');
  }

  function _onDragLeave(event) {
    const el = event.currentTarget;
    if (el) el.classList.remove('or-day-col-body--drag-over');
  }

  async function _onDrop(event, dstDayId) {
    event.preventDefault();
    const el = document.getElementById('or-daycol-' + dstDayId);
    if (el) el.classList.remove('or-day-col-body--drag-over');

    if (!_dragData) return;
    const { taskId, srcDayId } = _dragData;
    _dragData = null;

    if (srcDayId === dstDayId) return; // même jour, rien à faire

    MX.syncStart();
    try {
      if (taskId.startsWith('int_')) {
        const srcId   = taskId.slice(4);
        const newDate = _dayIdToDate(dstDayId);
        const upd     = { cpDayId: dstDayId };
        if (newDate) upd.startDate = newDate;
        await db.collection('interventions').doc(srcId).update(upd);
      } else if (taskId.startsWith('pmp_')) {
        const srcId   = taskId.slice(4);
        const newDate = _dayIdToDate(dstDayId);
        const upd     = { cpDayId: dstDayId };
        if (newDate) upd.dueDate = newDate;
        await db.collection('pmp_interventions').doc(srcId).update(upd);
      } else if (taskId.includes('__occ_')) {
        // Occurrence d'une tâche récurrente : le déplacement ne concerne
        // QUE cette occurrence (document d'exception à id déterministe,
        // jamais de duplication) — la règle de récurrence d'origine (et
        // donc toute la série) n'est jamais modifiée par ce geste.
        const [seriesId, occurrenceDate] = taskId.split('__occ_');
        const excId = seriesId + '_occ_' + occurrenceDate;
        await db.collection('org_tasks').doc(excId).set({
          seriesId, occurrenceDate, weekKey: _weekKey, dayId: dstDayId,
          isException: true, deleted: false,
          updatedBy: _currentUserName(), updatedAt: FV.serverTimestamp(),
        }, { merge: true });
      } else if (_recurOrigins.some(o => o.id === taskId)) {
        // Carte du document d'origine lui-même, sur sa semaine d'ancrage :
        // on ne déplace QUE cette occurrence (document d'exception), jamais
        // le document d'origine — un déplacement ne doit pas changer la
        // règle de récurrence de toute la série par erreur.
        const origin = _recurOrigins.find(o => o.id === taskId);
        const anchorDate = _originAnchorDate(origin);
        const excId = taskId + '_occ_' + anchorDate;
        await db.collection('org_tasks').doc(excId).set({
          seriesId: taskId, occurrenceDate: anchorDate, weekKey: _weekKey, dayId: dstDayId,
          isException: true, deleted: false,
          updatedBy: _currentUserName(), updatedAt: FV.serverTimestamp(),
        }, { merge: true });
      } else {
        await db.collection('org_tasks').doc(taskId).update({ dayId: dstDayId });
      }
      MX.syncEnd();
      MX.toast('Tâche déplacée ✓');
    } catch(e) {
      MX.syncFail();
      MX.toast('Déplacement impossible (' + e.message + ') — la tâche reste à sa place.', true);
    }
  }

  // ── SESSION TEARDOWN ──
  function _destroy() {
    if (_unsub)        { _unsub();        _unsub        = null; }
    if (_unsubCfg)     { _unsubCfg();     _unsubCfg     = null; }
    if (_unsubInts)    { _unsubInts();    _unsubInts    = null; }
    if (_unsubPmpInts) { _unsubPmpInts(); _unsubPmpInts = null; }
    if (_unsubRecur)   { _unsubRecur();   _unsubRecur   = null; }
    if (_unsubPrio)    { _unsubPrio();    _unsubPrio    = null; }
    _tasks         = [];
    _interventions = [];
    _pmpInts       = [];
    _recurOrigins  = [];
    _prioLevels    = [];
    _weekKey       = null;
    _inHistory     = false;
  }

  // ═══════════════════════════════════════════════════════
  //  TASK FORM (Planning-aware)
  // ═══════════════════════════════════════════════════════
  function openAddDayTask(dayId) {
    const day = MX.DAYS.find(d => d.id === dayId);
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     day?.l || dayId,
      body:    _taskFormBody({ dayId }),
      noAutoClose: true,
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  // ── FORMULAIRE TÂCHE ── (création ET édition, origine ET occurrence)
  // Le jour (ou les jours, en récurrence hebdomadaire) est TOUJOURS demandé
  // — jamais de champ caché/absent — pour qu'une tâche ne puisse plus être
  // enregistrée sans jour valide et donc ne plus jamais disparaître
  // silencieusement de la grille (voir _doAdd/_doEdit, qui revalident en
  // profondeur avant écriture).
  function _taskFormBody(defaults) {
    const d     = defaults || {};
    const prio  = _effPriority(d);
    const cats  = ['sécurité','réglementaire','stock','administratif','hébergement','autre'];
    const recur = d.recurrence || '';

    const selectedDays = recur === 'weekly' && Array.isArray(d.recurDays) && d.recurDays.length
      ? d.recurDays : (d.dayId ? [d.dayId] : []);
    const isMultiDay = recur === 'weekly';
    const daypickHtml = `<div class="or-daypick" id="or-f-daypick" data-multi="${isMultiDay}">
      ${MX.DAYS.map(dy => `<button type="button" class="or-daypick-btn${selectedDays.includes(dy.id) ? ' on' : ''}" data-day="${dy.id}" onclick="MX.Pages.OrgResp._toggleDayPick(this)">${dy.s}</button>`).join('')}
    </div>`;

    const prioHtml = `<div class="or-prio-pills">
      ${_sortedPrioLevels().map(lvl => {
        const isOn = lvl.id === prio;
        const bg   = _prioBg(lvl.color);
        return `<label class="or-prio-pill${isOn ? ' or-prio-pill--on' : ''}" style="--prio-color:${lvl.color};--prio-bg:${bg}">
          <input type="radio" name="or-f-prio" value="${MX.esc(lvl.id)}" ${isOn ? 'checked' : ''} style="display:none" onchange="MX.Pages.OrgResp._onPrioChange(this)">
          <span class="or-prio-pill-dot"></span>${MX.esc(lvl.label)}
        </label>`;
      }).join('')}
    </div>`;

    const monthlyDisplay    = recur === 'monthly' ? '' : 'style="display:none"';
    const recurRangeDisplay = recur ? '' : 'style="display:none"';
    const recurHtml = `
      <div class="or-form-row">
        <label class="or-form-lbl">Récurrence</label>
        <div class="or-recur-pills" id="or-f-recur-pills">
          ${[
            { v: '',        l: 'Aucune' },
            { v: 'daily',   l: 'Tous les jours' },
            { v: 'weekly',  l: 'Toutes les semaines' },
            { v: 'monthly', l: 'Tous les mois' },
          ].map(({ v, l }) => `<label class="or-recur-pill${v===recur?' or-recur-pill--on':''}" data-val="${v}">
            <input type="radio" name="or-f-recur" value="${v}" ${v===recur?'checked':''} style="display:none" onchange="MX.Pages.OrgResp._onRecurChange(this)">
            ${l}
          </label>`).join('')}
        </div>
      </div>
      <div class="or-form-row" id="or-f-monthly-rule" ${monthlyDisplay}>
        <label class="or-form-lbl">Règle mensuelle</label>
        <select id="or-f-monthly-nth" class="fi">
          ${[['1','1ère'],['2','2e'],['3','3e'],['4','4e'],['last','Dernière']].map(([v,l]) => `<option value="${v}"${d.recurMonthly && String(d.recurMonthly.nth)===v?' selected':''}>${l}</option>`).join('')}
        </select>
        <div class="or-form-hint">semaine du mois, pour le jour sélectionné ci-dessus</div>
      </div>
      <div class="or-form-2col" id="or-f-recur-range" ${recurRangeDisplay}>
        <div class="or-form-row">
          <label class="or-form-lbl">Début (optionnel)</label>
          <input type="date" id="or-f-recur-start" class="fi" value="${MX.esc(d.recurStart || '')}">
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Fin (optionnel)</label>
          <input type="date" id="or-f-recur-end" class="fi" value="${MX.esc(d.recurEnd || '')}">
        </div>
      </div>`;

    return `<div class="or-form">
      <div class="or-form-row">
        <label class="or-form-lbl">Titre <span class="or-req">*</span></label>
        <input id="or-f-title" class="fi" value="${MX.esc(d.title || '')}" placeholder="Nom de la tâche" maxlength="150">
      </div>
      <div class="or-form-row">
        <label class="or-form-lbl">Description</label>
        <input id="or-f-desc" class="fi" value="${MX.esc(d.description || '')}" placeholder="Détails optionnels" maxlength="300">
      </div>
      <div class="or-form-row">
        <label class="or-form-lbl">Priorité</label>
        ${prioHtml}
      </div>
      <div class="or-form-row">
        <label class="or-form-lbl">Techniciens affectés</label>
        ${_techPickerHtml(_taskTechs(d))}
      </div>
      <div class="or-form-row">
        <label class="or-form-lbl">Jour <span class="or-req">*</span></label>
        ${daypickHtml}
      </div>
      ${recurHtml}
      <details class="or-form-advanced">
        <summary class="or-form-advanced-toggle">
          <i class="fas fa-sliders"></i>
          <span>Options avancées</span>
          <i class="fas fa-chevron-right or-form-advanced-chevron"></i>
        </summary>
        <div class="or-form-row">
          <label class="or-form-lbl">Type d'élément</label>
          ${_itypePicker(d.itemType)}
        </div>
        <div class="or-form-2col">
          <div class="or-form-row">
            <label class="or-form-lbl">Catégorie</label>
            <select id="or-f-cat" class="fi">
              ${cats.map(c => `<option value="${c}"${c === (d.category || 'autre') ? ' selected' : ''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
            </select>
          </div>
          <div class="or-form-row">
            <label class="or-form-lbl">Local / Zone</label>
            <input id="or-f-location" class="fi" value="${MX.esc(d.location || '')}" placeholder="ex: Hall, Étage 1…" maxlength="100">
          </div>
        </div>
        <div class="or-form-row">
          <label class="or-form-lbl">Durée (min)</label>
          <input id="or-f-duration" type="number" class="fi" value="${d.duration || ''}" placeholder="ex: 30" min="5" max="480">
        </div>
      </details>
    </div>`;
  }

  // ── Interactions du formulaire (jour / priorité / récurrence) ──
  function _toggleDayPick(btn) {
    const container = btn.closest('.or-daypick');
    if (!container) return;
    if (container.dataset.multi === 'true') {
      btn.classList.toggle('on');
    } else {
      container.querySelectorAll('.or-daypick-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    }
  }

  function _onPrioChange(radio) {
    const container = radio.closest('.or-prio-pills');
    if (!container) return;
    container.querySelectorAll('.or-prio-pill').forEach(p => p.classList.remove('or-prio-pill--on'));
    radio.closest('.or-prio-pill')?.classList.add('or-prio-pill--on');
  }

  function _onRecurChange(radio) {
    const val = radio.value;
    document.querySelectorAll('#or-f-recur-pills .or-recur-pill').forEach(p => {
      p.classList.toggle('or-recur-pill--on', p.dataset.val === val);
    });
    const daypick = document.getElementById('or-f-daypick');
    if (daypick) {
      const wasMulti = daypick.dataset.multi === 'true';
      daypick.dataset.multi = (val === 'weekly') ? 'true' : 'false';
      if (val !== 'weekly' && wasMulti) {
        // on repasse en sélection unique : on garde seulement le premier jour coché
        const selected = Array.from(daypick.querySelectorAll('.or-daypick-btn.on'));
        selected.forEach((b, i) => { if (i > 0) b.classList.remove('on'); });
      }
    }
    const monthlyRule = document.getElementById('or-f-monthly-rule');
    if (monthlyRule) monthlyRule.style.display = (val === 'monthly') ? '' : 'none';
    const range = document.getElementById('or-f-recur-range');
    if (range) range.style.display = val ? '' : 'none';
  }

  function _readForm() {
    const daypick  = document.getElementById('or-f-daypick');
    const dayBtns  = daypick ? Array.from(daypick.querySelectorAll('.or-daypick-btn.on')).map(b => b.dataset.day) : [];
    const recurEl  = document.querySelector('input[name="or-f-recur"]:checked');
    const recurrence = recurEl ? (recurEl.value || null) : null;
    const dayId    = dayBtns[0] || null;
    const recurDays = recurrence === 'weekly' && dayBtns.length ? dayBtns : null;
    let recurMonthly = null;
    if (recurrence === 'monthly') {
      const nthRaw = document.getElementById('or-f-monthly-nth')?.value;
      recurMonthly = { nth: nthRaw === 'last' ? 'last' : parseInt(nthRaw), weekday: dayId };
    }
    return {
      title:        (document.getElementById('or-f-title')?.value  || '').trim(),
      description:  (document.getElementById('or-f-desc')?.value   || '').trim(),
      assignedTo:   [..._orPickerTechs],
      category:     document.getElementById('or-f-cat')?.value     || 'autre',
      priority:     document.querySelector('input[name="or-f-prio"]:checked')?.value || _defaultPrioId(),
      type:         'unique',
      dayId,
      recurrence:   recurrence || null,
      recurDays,
      recurMonthly,
      recurStart:   document.getElementById('or-f-recur-start')?.value || null,
      recurEnd:     document.getElementById('or-f-recur-end')?.value   || null,
      location:     (document.getElementById('or-f-location')?.value || '').trim() || null,
      duration:     parseInt(document.getElementById('or-f-duration')?.value) || null,
      itemType:     document.getElementById('or-f-itype')?.value   || 'tache',
    };
  }

  // Validation commune à la création et à l'édition : jamais d'écriture sans
  // jour valide, jamais de récurrence incomplète enregistrée silencieusement.
  function _validateFormData(data) {
    if (!data.title) return 'Le titre est obligatoire';
    if (!data.dayId) return 'Choisissez un jour pour cette tâche';
    if (data.recurrence === 'weekly' && !data.recurDays) return 'Choisissez au moins un jour de récurrence';
    if (data.recurrence === 'monthly' && (!data.recurMonthly || !data.recurMonthly.nth || !data.recurMonthly.weekday)) return 'Choisissez la règle de récurrence mensuelle';
    return null;
  }

  // ── ADD ──
  function openAdd() {
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     _weekLabel(_weekKey),
      body:    _taskFormBody(),
      noAutoClose: true,
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  // ── "+ Nouvelle tâche" (bouton d'en-tête du planning) ──
  function openAddFromHeader() {
    MX.showModal({
      title:   'Nouvelle tâche',
      sub:     _weekLabel(_weekKey),
      body:    _taskFormBody(),
      noAutoClose: true,
      actions: [
        { label: 'Créer', cls: 'primary-btn', fn: () => _doAdd() },
        { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doAdd() {
    const data = _readForm();
    const err  = _validateFormData(data);
    if (err) { MX.toast(err, true); return; }
    const name = _currentUserName();
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').add({
        title: data.title, description: data.description,
        assignedTo: data.assignedTo, category: data.category,
        priority: data.priority, type: data.type,
        dayId: data.dayId, slot: null,
        recurrence: data.recurrence, recurDays: data.recurDays,
        recurMonthly: data.recurMonthly, recurStart: data.recurStart, recurEnd: data.recurEnd,
        location: data.location, duration: data.duration, itemType: data.itemType,
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

  // ── EDIT (série / tâche unique) ──
  function openEdit(taskId) {
    const t = _tasks.find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Modifier la tâche',
      sub:     MX.esc(t.title),
      body:    _taskFormBody(t),
      noAutoClose: true,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doEdit(taskId) },
        { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doEdit(taskId) {
    const data = _readForm();
    const err  = _validateFormData(data);
    if (err) { MX.toast(err, true); return; }
    MX.closeModal();
    MX.syncStart();
    try {
      const upd = {
        title: data.title, description: data.description,
        assignedTo: data.assignedTo, category: data.category,
        priority: data.priority, type: data.type,
        dayId: data.dayId,
        recurrence: data.recurrence, recurDays: data.recurDays,
        recurMonthly: data.recurMonthly, recurStart: data.recurStart, recurEnd: data.recurEnd,
        location: data.location, duration: data.duration, itemType: data.itemType,
      };
      await db.collection('org_tasks').doc(taskId).update(upd);
      MX.syncEnd();
      MX.toast('Tâche modifiée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── DELETE (tâche unique, ou série entière) ──
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

  // ── OCCURRENCES D'UNE TÂCHE RÉCURRENTE ──
  // Terminer / modifier / supprimer UNE occurrence n'écrit JAMAIS dans le
  // document d'origine (qui pilote toutes les occurrences futures) : ces
  // actions créent ou mettent à jour un document d'exception à id
  // déterministe ("${seriesId}_occ_${date}"), via set(...,{merge:true}), donc
  // jamais de doublon même répété. Seule "Modifier/Supprimer toute la série"
  // touche le document d'origine, en toute connaissance de cause.
  function _occIds(taskId) {
    const [seriesId, occurrenceDate] = taskId.split('__occ_');
    return { seriesId, occurrenceDate, excId: seriesId + '_occ_' + occurrenceDate };
  }

  async function _occDoneToggle(taskId, done) {
    const { seriesId, occurrenceDate, excId } = _occIds(taskId);
    MX.syncStart();
    try {
      // Le jour de CETTE occurrence est déterminé par sa propre date dans la
      // semaine actuellement affichée — jamais par le jour d'ancrage de la
      // tâche d'origine (sans quoi valider une occurrence la ferait sauter
      // visuellement sur le jour de l'origine, un bug réel découvert lors de
      // l'ajout de la validation rapide).
      const occDayId = _dateToDayId(occurrenceDate) || _tasks.concat(_recurOrigins).find(x => x.id === seriesId)?.dayId || null;
      await db.collection('org_tasks').doc(excId).set({
        seriesId, occurrenceDate, weekKey: _weekKey, dayId: occDayId,
        isException: true, deleted: false,
        done, status: done ? 'done' : 'todo',
        doneBy: done ? _currentUserName() : null, doneAt: done ? FV.serverTimestamp() : null,
        updatedAt: FV.serverTimestamp(),
      }, { merge: true });
      MX.syncEnd();
      MX.toast(done ? 'Occurrence terminée ✓' : 'Occurrence rouverte');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  // ── VALIDATION RAPIDE EN UN CLIC (bouton "✓ Valider" sur la carte) ──
  // Jamais de volet/formulaire supplémentaire. Pour une tâche récurrente,
  // seule l'occurrence affichée est validée (document d'exception à id
  // déterministe, comme _occDoneToggle) — jamais toute la série. Idempotent :
  // une occurrence déjà validée n'est pas réécrite une deuxième fois.
  // Contrairement à l'ancien "Terminer" (menu ···, avec commentaire), cette
  // action ne archive JAMAIS la tâche : elle doit rester visible sur son
  // jour, avec son statut visuel mis à jour — cohérent avec le comportement
  // déjà existant des occurrences récurrentes.
  async function _quickValidate(taskId, btn) {
    if (taskId.startsWith('int_') || taskId.startsWith('pmp_')) return; // géré par leur propre module
    if (btn) btn.disabled = true;
    try {
      if (taskId.includes('__occ_')) {
        await _occDoneToggle(taskId, true);
      } else if (_recurOrigins.some(o => o.id === taskId)) {
        const origin = _recurOrigins.find(o => o.id === taskId);
        const anchorDate = _originAnchorDate(origin);
        await _occDoneToggle(taskId + '__occ_' + anchorDate, true);
      } else {
        await _doQuickValidatePlain(taskId);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _doQuickValidatePlain(taskId) {
    const task = _tasks.find(x => x.id === taskId);
    if (task && task.done) return; // déjà validée — idempotent, aucune écriture
    const name = _currentUserName();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(taskId).update({
        done: true, status: 'done', doneBy: name, doneAt: FV.serverTimestamp(),
      });
      MX.syncEnd();
      MX.toast('Tâche validée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur : la validation a échoué — réessayez (' + e.message + ')', true); }
  }

  function openEditOccurrence(taskId) {
    const t = _allPlanItems().find(x => x.id === taskId);
    if (!t) return;
    MX.showModal({
      title:   'Modifier cette occurrence',
      sub:     MX.esc(t.title),
      body:    _taskFormBody(t),
      noAutoClose: true,
      actions: [
        { label: 'Enregistrer', cls: 'primary-btn', fn: () => _doEditOccurrence(taskId) },
        { label: 'Annuler', cls: 'cancel', fn: () => MX.closeModal() }
      ]
    });
    setTimeout(() => document.getElementById('or-f-title')?.focus(), 50);
  }

  async function _doEditOccurrence(taskId) {
    const data = _readForm();
    if (!data.title) { MX.toast('Le titre est obligatoire', true); return; }
    if (!data.dayId) { MX.toast('Choisissez un jour pour cette tâche', true); return; }
    const { seriesId, occurrenceDate, excId } = _occIds(taskId);
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(excId).set({
        seriesId, occurrenceDate, weekKey: _weekKey, isException: true, deleted: false,
        title: data.title, description: data.description,
        assignedTo: data.assignedTo, priority: data.priority,
        dayId: data.dayId, location: data.location, duration: data.duration, itemType: data.itemType,
        updatedAt: FV.serverTimestamp(),
      }, { merge: true });
      MX.syncEnd();
      MX.toast('Occurrence modifiée ✓');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  function openDeleteOccurrence(taskId) {
    MX.showModal({
      title: 'Supprimer cette occurrence',
      sub:   'Tâche récurrente',
      body:  `<div style="font-size:13px;color:var(--text2);line-height:1.6">
        Seule <strong>cette occurrence</strong> sera supprimée. Les autres dates de la série restent inchangées.
      </div>`,
      actions: [
        { label: 'Supprimer', cls: 'danger-btn', fn: () => _doDeleteOccurrence(taskId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDeleteOccurrence(taskId) {
    const { seriesId, occurrenceDate, excId } = _occIds(taskId);
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(excId).set({
        seriesId, occurrenceDate, weekKey: _weekKey, isException: true, deleted: true,
        updatedAt: FV.serverTimestamp(),
      }, { merge: true });
      MX.syncEnd();
      MX.toast('Occurrence supprimée');
    } catch(e) { MX.syncFail(); MX.toast('Erreur: ' + e.message, true); }
  }

  function openDeleteSeries(seriesId) {
    const t = _recurOrigins.find(o => o.id === seriesId) || _tasks.find(x => x.id === seriesId);
    MX.showModal({
      title: 'Supprimer toute la série récurrente',
      sub:   t ? MX.esc(t.title) : '',
      body:  `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
        <i class="fas fa-triangle-exclamation" style="color:var(--red);font-size:20px;margin-top:2px;flex-shrink:0"></i>
        <div style="font-size:13px;color:var(--text2);line-height:1.6">
          <strong style="color:var(--red)">Toutes les occurrences</strong> de cette tâche récurrente seront supprimées, pas seulement celle-ci. Cette action est irréversible.
        </div>
      </div>`,
      actions: [
        { label: 'Supprimer la série', cls: 'danger-btn', fn: () => _doDeleteSeries(seriesId) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _doDeleteSeries(seriesId) {
    MX.closeModal();
    MX.syncStart();
    try {
      await db.collection('org_tasks').doc(seriesId).delete();
      MX.syncEnd();
      MX.toast('Série supprimée');
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

  // ═══════════════════════════════════════════════════════
  //  KANBAN TAB (unchanged logic, new header)
  // ═══════════════════════════════════════════════════════
  function _renderKanban(mc) {
    const active = _tasks.filter(t => !t.archivedFromActive && !t.dayId);
    const cols = {
      todo:       active.filter(t => !t.done && t.status !== 'inprogress'),
      inprogress: active.filter(t => !t.done && t.status === 'inprogress'),
      done:       active.filter(t => t.done),
    };
    const total  = active.length;
    const doneCnt = cols.done.length;
    const pct    = total ? Math.round(doneCnt / total * 100) : 0;
    const pctC   = pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';

    // Count planning tasks for tab badge
    const planTasks = _tasks.filter(t => !t.archivedFromActive && t.dayId);
    const planDone  = planTasks.filter(t => t.done).length;

    let h = `<div class="or-page">
      <div class="or-header">
        <div class="or-header-left">
          <div class="or-title">Modèles de tâches</div>
          <div class="or-week-label">Bibliothèque — ${_weekLabel(_weekKey)}</div>
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

      <!-- Week navigation -->
      <div class="or-week-nav">
        <button class="or-week-nav-btn" onclick="MX.Pages.OrgResp._prevWeek()"><i class="fas fa-chevron-left"></i></button>
        <div class="or-week-nav-info">
          ${_isCurrentWeek() ? '<span class="or-week-cur-badge">Semaine en cours</span>' : `<button class="or-week-nav-today" onclick="MX.Pages.OrgResp._goToCurrentWeek()"><i class="fas fa-house"></i> Aujourd'hui</button>`}
        </div>
        <button class="or-week-nav-btn" onclick="MX.Pages.OrgResp._nextWeek()"><i class="fas fa-chevron-right"></i></button>
      </div>

      <!-- Tabs -->
      <div class="or-tabs">
        <button class="or-tab" onclick="MX.Pages.OrgResp._setTab('planning')">
          <i class="fas fa-calendar-days"></i> Planning
          ${planTasks.length > 0 ? `<span class="or-tab-cnt">${planDone}/${planTasks.length}</span>` : ''}
        </button>
        <button class="or-tab or-tab--active" onclick="MX.Pages.OrgResp._setTab('tasks')">
          <i class="fas fa-box-archive"></i> Modèles de tâches
          ${total > 0 ? `<span class="or-tab-cnt">${total}</span>` : ''}
        </button>
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
          ${key !== 'done' ? `<button class="or-kcol-add" onclick="MX.Pages.OrgResp.openAdd()" title="Ajouter"><i class="fas fa-plus"></i></button>` : ''}
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

  function _kanbanCard(t, col) {
    const esc    = MX.esc;
    const cat    = _catConfig(t.category);
    const prio   = _prioConfig(t.priority);
    const aCol   = _ucolor(t.assignedTo || '');
    const isDone = col === 'done';

    let tags = '';
    if (t.category && t.category !== 'autre') {
      tags += `<span class="or-badge" style="background:${cat.color}18;color:${cat.color}"><i class="fas ${cat.icon}"></i> ${esc(t.category)}</span>`;
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
      actionsHtml += `<button class="or-icon-btn or-icon-btn--ok" onclick="MX.Pages.OrgResp.openValidate('${t.id}')" title="Terminer"><i class="fas fa-check"></i></button>`;
    } else {
      const dt = t.doneAt ? _fmtDT(t.doneAt) : '';
      actionsHtml += `<span class="or-done-meta">${t.doneBy ? esc(t.doneBy) : ''}${dt ? ' · ' + dt : ''}</span>`;
      actionsHtml += `<button class="or-icon-btn" onclick="MX.Pages.OrgResp.unvalidate('${t.id}')" title="Annuler validation"><i class="fas fa-rotate-left"></i></button>`;
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

  // ═══════════════════════════════════════════════════════
  //  HISTORY
  // ═══════════════════════════════════════════════════════
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
        const isCur  = wk === _getWeekKey(new Date());
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
          const loc  = t.dayId ? ` · <span style="color:var(--text3)">${MX.DAYS.find(d=>d.id===t.dayId)?.l||t.dayId}${t.slot ? ' / '+SLOT_INFO[t.slot]?.l : ''}</span>` : '';
          h += `<div class="or-hist-task${t.done?' or-hist-task--done':''}">
            <i class="fas fa-${t.done?'circle-check':'circle'}" style="color:${t.done?'var(--green)':'var(--text3)'}"></i>
            <div class="or-hist-task-body">
              <div class="or-hist-task-title">${MX.esc(t.title)} ${_typeBadge(t.type)}${asgn}${loc}</div>
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
    // Planning navigation
    _setTab, _toggleDay,
    _prevWeek, _nextWeek, _goToCurrentWeek,
    // Slot config
    openSlotConfig, _reactivateSlot,
    _disableSlot, _clearSlot,
    openSlotMenu, openDayMenu, _closeDropdowns,
    // Slot rename
    openRenameSlot, _doRenameSlot,
    // Slot duplication
    openDuplicateSlot, _doDuplicateSlot,
    // Slot reset
    _resetSlot, _doResetSlot,
    // Task add (planning-aware)
    openAddDayTask,
    // Day duplication
    openDuplicateDay, _updateDupPreview, _onDupSrcChange,
    // Week duplication
    openDuplicateWeek,
    // Templates
    openTemplateSave, openTemplateApply, _deleteTemplate,
    // Drag and drop
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    // Side panel (new grid layout)
    _toggleDayPanel, _closeDayPanel, _panelToggleSlot, _saveDayPanel, _applyTemplateQuick,
    // V2 week actions & view control
    _doLaunchWeek, _doCloseWeek, _doResetValidations, _setCpView, _openCreateTemplate,
    // V3 planning interactions
    _cpToggleExpand, _cpMissionMenu, _cpSelectItype,
    // Header quick-add
    openAddFromHeader,
    // Formulaire tâche — interactions (jour / priorité / récurrence / techniciens)
    _toggleDayPick, _onPrioChange, _onRecurChange,
    _addTechFromSelect, _removeTechChip,
    // Récurrence — actions par occurrence / par série
    _occDoneToggle, openEditOccurrence, _doEditOccurrence,
    openDeleteOccurrence, _doDeleteOccurrence,
    openDeleteSeries, _doDeleteSeries,
    // Validation rapide en un clic
    _quickValidate,
    // Priorités personnalisables
    openPriorityConfig, _updatePrioField, _doAddPrioLevel,
    openDeletePrioLevel, _doDeletePrioLevel,
    // Session teardown (called by auth._destroyUI on logout)
    _destroy,
  };
})();
