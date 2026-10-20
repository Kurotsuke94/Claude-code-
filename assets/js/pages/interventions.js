(function () {
  'use strict';

  // ── STATE ──
  let _curTab         = 'gestion';
  let _gestionFilter  = '';   // pill active: '' | 'a_prendre_en_charge' | 'en_pause' | 'en_cours' | 'terminee' | 'en_retard'
  let _calView   = 'semaine';
  let _calDate   = '';
  let _filterTech   = '';
  let _filterStatus = '';
  let _filterPrio   = '';
  let _interventions = [];
  let _transfers     = [];
  let _users         = [];
  let _loaded    = false;
  let _ready     = false;
  let _readyCbs  = [];
  let _unsubInt  = {};
  let _pickerSel  = [];
  let _intPhotoB64 = null;

  // ── FIRESTORE ──
  const DB = {
    int: () => db.collection('interventions'),
    xfr: () => db.collection('int_transfers'),
  };
  const FV = firebase.firestore.FieldValue;

  // ── FIRESTORE ERROR HANDLER ──
  function _fsErr(coll) {
    return function (err) {
      const code = err.code || '';
      const link = (err.message || '').match(/https:\/\/\S+/)?.[0] || '';
      if (code === 'failed-precondition') {
        console.warn('────────────────────────\n⚠ Firestore\n\nCollection : ' + coll + '\n\nIndex manquant.\n' + (link ? 'Lien Firebase :\n' + link + '\n' : '') + '────────────────────────');
      } else if (code === 'permission-denied') {
        console.warn('[Firestore] ' + coll + ' — permission refusée :', err.message);
      } else if (code === 'unavailable') {
        console.warn('[Firestore] ' + coll + ' — service indisponible.');
      } else {
        console.error('[Firestore] ' + coll + ' — erreur listener :', err);
      }
    };
  }

  // ── METADATA ──
  // Système de statuts par couleurs (4 états simples pour les techniciens) :
  // ROUGE = pas encore commencée · JAUNE = en pause/en attente ·
  // VERT = en cours · BLEU = terminée. "annulee" reste un état orthogonal
  // (pas une couleur de progression). Le retard n'est PLUS un statut — voir
  // _isLate() — pour ne jamais confondre avancement réel et échéance.
  const STATUS = {
    a_prendre_en_charge: { l: 'À prendre en charge', col: '#EF4444', bg: 'rgba(239,68,68,.13)'  },
    en_pause:            { l: 'En pause',             col: '#F59E0B', bg: 'rgba(245,158,11,.13)' },
    en_cours:            { l: 'En cours',              col: '#22C55E', bg: 'rgba(34,197,94,.13)'  },
    terminee:            { l: 'Terminée',               col: '#3B82F6', bg: 'rgba(59,130,246,.13)' },
    annulee:             { l: 'Annulée',                 col: '#6B7280', bg: 'rgba(107,114,128,.13)' },
  };

  const PRIO = {
    urgente: { l: 'Urgente',  col: '#EF4444', icon: 'fa-fire' },
    haute:   { l: 'Haute',    col: '#F97316', icon: 'fa-circle-exclamation' },
    normale: { l: 'Normale',  col: '#3B82F6', icon: 'fa-circle-dot' },
    basse:   { l: 'Basse',    col: '#6B7280', icon: 'fa-minus' },
  };

  const TABS = [
    { id: 'gestion',    icon: 'fa-list',          l: 'Gestion',    mob: 'Gestion'    },
    { id: 'calendrier', icon: 'fa-calendar-days', l: 'Calendrier', mob: 'Calendrier' },
  ];

  const DOW_FR  = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const MOIS_SH = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const CAL_START = 6;   // First hour shown
  const CAL_HRS   = 17;  // Hours displayed (06:00 – 22:00)
  const HR_H      = 64;  // px per hour in week view
  const HR_H_DAY  = 72;  // px per hour in day view

  // ── HELPERS ──
  function _today() { return new Date().toISOString().slice(0, 10); }
  function _addDays(ds, n) {
    const d = new Date(ds + 'T12:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function _dateFmt(ds) {
    if (!ds) return '';
    const [y, m, d] = ds.split('-');
    return `${d}/${m}/${y}`;
  }
  function _dtFmt(ds, ts) { return `${_dateFmt(ds)}${ts ? ' à ' + ts : ''}`; }
  function _tsMs(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds)  return ts.seconds * 1000;
    return 0;
  }
  function _tsDate(ts) { const ms = _tsMs(ts); return ms ? new Date(ms) : null; }
  function _author() {
    const cu = MX.state.currentUser, ad = MX.state.adminUser;
    return cu ? cu.name : (ad ? (ad.email || 'Admin').split('@')[0] : 'Anonyme');
  }
  function _canAll() { return MX.Auth.canSeeAll(); }
  function esc(s) {
    return MX.esc ? MX.esc(s)
      : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function _weekStartOf(ds) {
    const d = new Date(ds + 'T12:00');
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  // Bucket de couleur effectif — compatible avec les anciennes valeurs de
  // statut (jamais de migration destructive : le document Firestore garde sa
  // valeur brute tant qu'il n'est pas explicitement modifié par un clic ou
  // une édition). "planifiee"/"affectee" (anciens statuts "pas commencée")
  // et "en_retard" (ancien statut écrasé par l'ex-_autoRetard — on ne peut
  // pas reconstruire son état antérieur réel, donc on le traite comme "à
  // prendre en charge", jamais comme "terminée") retombent tous sur ROUGE.
  function _effStatus(iv) {
    const s = iv.status;
    if (s === 'terminee' || s === 'annulee' || s === 'en_pause' || s === 'en_cours') return s;
    return 'a_prendre_en_charge';
  }

  // L'ex-_autoRetard() pouvait écraser silencieusement N'IMPORTE QUEL statut
  // non terminal (y compris "en_cours", une intervention déjà démarrée) par
  // "en_retard", sans jamais conserver la valeur d'origine. Un document avec
  // ce statut brut peut donc avoir été démarré ou non — c'est indécidable à
  // partir des données actuelles. On le classe ROUGE par défaut (plus sûr :
  // garantit qu'un humain la reprend en main), mais on le signale pour ne
  // jamais laisser croire à tort que sa progression d'origine est connue.
  function _isLegacyRetardAmbiguous(iv) { return iv.status === 'en_retard'; }

  // Une intervention est "planifiée" si startDate existe — vrai pour les
  // interventions créées en mode planifié ET pour les anciennes interventions
  // (qui avaient toujours startDate rempli avant l'ajout du mode immédiat).
  function _isPlanned(iv) { return !!(iv && iv.startDate); }

  function _statusBadge(iv) {
    const st = _effStatus(iv);
    const s  = STATUS[st] || STATUS.a_prendre_en_charge;
    return `<span class="int-badge" style="background:${s.bg};color:${s.col};border:1px solid ${s.col}40">${s.l}</span>`;
  }

  function _prioBadge(prio) {
    const p = PRIO[prio] || PRIO.normale;
    return `<span class="int-prio" style="color:${p.col}"><i class="fas ${p.icon}"></i> ${p.l}</span>`;
  }

  function _techAvatars(assignedTo) {
    if (!assignedTo || !assignedTo.length) {
      return '<span class="int-unassigned"><i class="fas fa-user-slash"></i> Non affectée</span>';
    }
    return assignedTo.map(name => {
      const u = _users.find(u => u.name === name);
      const color = u?.color || '#7C3AED';
      const initials = name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
      const border = MX.badgeBorder ? MX.badgeBorder(name) : null;
      return `<span class="int-avatar" style="background:${color}${border ? ';border:2px solid ' + border : ''}" title="${esc(name)}">${esc(initials)}</span>`;
    }).join('') + assignedTo.map(n => `<span class="int-avatar-name">${MX.badgeTag ? MX.badgeTag(n) : ''}${esc(n)}</span>`).join('');
  }

  // ── NOTIFICATIONS ──
  const _notifSentIds = new Set();

  function _sendIntNotifs(next) {
    if (!window.MX || !MX.Notifs || !MX.DB || !MX.DB.createNotification) return;
    next.forEach(iv => {
      if (_notifSentIds.has(iv.id)) return;
      const eff = _effStatus(iv);
      // New urgent intervention
      if (iv.priority === 'urgente' && eff === 'a_prendre_en_charge') {
        _notifSentIds.add(iv.id);
        const who = Array.isArray(iv.assignedTo) ? iv.assignedTo[0] : (iv.assignedTo || 'all');
        MX.DB.createNotification({
          key: `int_urgent_${iv.id}`,
          type: 'intervention',
          title: '🔧 Intervention urgente',
          description: iv.title || iv.location || 'Chambre non spécifiée',
          icon: '🔧',
          author: iv.createdBy || '',
          userId: who || 'all',
        }).catch(() => {});
      }
      // Late intervention (purement informatif, calculé — jamais un statut)
      if (_isLate(iv) && !_notifSentIds.has(iv.id + '_late')) {
        _notifSentIds.add(iv.id + '_late');
        MX.DB.createNotification({
          key: `int_retard_${iv.id}`,
          type: 'intervention',
          title: '🔧 Intervention en retard',
          description: iv.title || iv.location || 'Délai dépassé',
          icon: '🔧',
          author: '',
          userId: 'all',
        }).catch(() => {});
      }
    });
  }

  // ── DATA LAYER ──
  function _load() {
    if (_loaded) return;
    _loaded = true;

    // BUGFIX : trié par 'createdAt' (toujours présent, même sur une
    // intervention non planifiée), jamais par 'startDate' — Firestore exclut
    // silencieusement de orderBy() tout document où le champ trié est absent.
    // Une intervention sans date (startDate absent par design) disparaissait
    // donc entièrement de ce listener, et de toute la liste Gestion/
    // Calendrier qui en dépend, sans jamais remonter d'erreur.
    _unsubInt.int = DB.int()
      .orderBy('createdAt', 'desc')
      .limit(300)
      .onSnapshot(snap => {
        _interventions = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !x.inTrash);
        _sendIntNotifs(_interventions);
        if (!_ready) { _ready = true; const cbs = _readyCbs; _readyCbs = []; cbs.forEach(cb => { try { cb(); } catch (e) {} }); }
        _rerender();
      }, _fsErr('interventions'));

    _unsubInt.xfr = DB.xfr()
      .where('status', '==', 'pending')
      .onSnapshot(snap => {
        _transfers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _rerender();
      }, _fsErr('int_transfers'));

    _users = MX.state.users || [];
  }

  // Le retard est une information PUREMENT calculée à la lecture — jamais
  // écrite en base, jamais confondue avec le statut métier (couleur).
  // Remplace l'ancien _autoRetard() qui écrasait silencieusement le statut
  // réel par "en_retard" (perte de l'état métier réel, et toute intervention
  // non planifiée — sans endDate — ne doit jamais être considérée en retard).
  function _isLate(iv) {
    if (iv.status === 'terminee' || iv.status === 'annulee') return false;
    if (!iv.endDate) return false;
    const endDt = new Date(`${iv.endDate}T${iv.endTime || '23:59'}:00`);
    return endDt < new Date();
  }

  // ── RENDER ──
  const _PILL_MAP = { en_attente:'a_prendre_en_charge', en_cours:'en_cours', terminees:'terminee', retards:'en_retard' };

  function render() {
    if (window._intStartTab) {
      const st = window._intStartTab; window._intStartTab = null;
      if (st === 'calendrier') { _curTab = 'calendrier'; }
      else { _curTab = 'gestion'; _gestionFilter = _PILL_MAP[st] || ''; }
    }
    _load();
    const mc = document.getElementById('main-content');
    if (!mc) return;

    const cu = MX.state.currentUser;
    const myPending = _transfers.filter(t => t.toTech === cu?.name).length;
    const retardCount = _interventions.filter(iv => _isLate(iv)).length;

    mc.innerHTML = `<div class="int-page">
      <div class="int-tabs">
        ${TABS.map(t => {
          const cnt = t.id === 'gestion' ? retardCount : 0;
          return `<button class="int-tab${_curTab === t.id ? ' active' : ''}" data-tab="${t.id}" onclick="MX.Pages.Int._tab('${t.id}')">
            <i class="fas ${t.icon}"></i>
            <span class="int-tab-full">${t.l}</span>
            <span class="int-tab-mob">${t.mob}</span>
            ${cnt > 0 ? `<span class="int-tab-badge">${cnt}</span>` : ''}
          </button>`;
        }).join('')}
      </div>
      ${myPending > 0 ? `<div class="int-xfr-global-banner" onclick="MX.Pages.Int._tab('en_attente')">
        <i class="fas fa-bell"></i> ${myPending} demande${myPending > 1 ? 's' : ''} de prise en charge en attente
      </div>` : ''}
      <div class="int-body" id="int-body">${_body()}</div>
      <button class="int-fab" id="int-fab" onclick="MX.Pages.Int._newInt()" aria-label="Nouvelle intervention"
        style="${_curTab === 'calendrier' ? 'display:none' : ''}">
        <i class="fas fa-plus"></i>
      </button>
    </div>`;
  }

  function _rerender() {
    const el = document.getElementById('int-body');
    if (el) el.innerHTML = _body();
  }

  function _tab(id) {
    if (_PILL_MAP[id]) { _curTab = 'gestion'; _gestionFilter = _PILL_MAP[id]; }
    else if (id === 'toutes' || id === 'stats') { _curTab = 'gestion'; _gestionFilter = ''; }
    else { _curTab = id; }
    document.querySelectorAll('.int-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === _curTab));
    const el = document.getElementById('int-body');
    if (el) el.innerHTML = _body();
    const fab = document.getElementById('int-fab');
    if (fab) fab.style.display = _curTab === 'calendrier' ? 'none' : '';
  }

  function _body() {
    switch (_curTab) {
      case 'calendrier': return _tCalendrier();
      default:           return _tGestion();
    }
  }

  // ── TAB: GESTION (unique page avec KPI + pills + liste + stats) ──
  function _tGestion() {
    const cu     = MX.state.currentUser;
    const canAll = _canAll();

    // Base list filtered by role
    const base = canAll
      ? [..._interventions]
      : _interventions.filter(iv => (iv.assignedTo || []).includes(cu?.name));

    // KPI counts always computed from full base — 4 couleurs, jamais
    // confondues avec le retard (purement informatif, voir _isLate()).
    const nTodo  = base.filter(iv => _effStatus(iv) === 'a_prendre_en_charge').length;
    const nPause = base.filter(iv => _effStatus(iv) === 'en_pause').length;
    const nEC    = base.filter(iv => _effStatus(iv) === 'en_cours').length;
    const nT     = base.filter(iv => _effStatus(iv) === 'terminee').length;
    const nTot   = base.length;

    // Apply pill filter — 'en_retard' reste un filtre à part (_isLate),
    // jamais un des 4 états de couleur.
    let list = [...base];
    if      (_gestionFilter === 'en_retard') list = base.filter(iv => _isLate(iv));
    else if (_gestionFilter)                 list = base.filter(iv => _effStatus(iv) === _gestionFilter);

    // Apply toolbar filters
    if (_filterPrio) list = list.filter(iv => iv.priority === _filterPrio);
    if (_filterTech) list = list.filter(iv => (iv.assignedTo || []).includes(_filterTech));

    const techOpts = canAll && _users.length
      ? `<select class="int-filter-sel" onchange="MX.Pages.Int._setFilter('tech',this.value)">
           <option value="">Tous techniciens</option>
           ${_users.filter(u => u.role === 'technicien').map(u =>
             `<option value="${esc(u.name)}"${_filterTech === u.name ? ' selected' : ''}>${esc(u.name)}</option>`
           ).join('')}
         </select>`
      : '';

    // ── KPI bar — Total / À prendre en charge / En attente / En cours / Terminées ──
    const kpiDef = [
      { f: '',                   val: nTot,   lbl: 'Total',               col: 'var(--text1)' },
      { f: 'a_prendre_en_charge',val: nTodo,  lbl: 'À prendre en charge', col: '#EF4444'       },
      { f: 'en_pause',           val: nPause, lbl: 'En attente',          col: '#F59E0B'       },
      { f: 'en_cours',           val: nEC,    lbl: 'En cours',            col: '#22C55E'       },
      { f: 'terminee',           val: nT,     lbl: 'Terminées',           col: '#3B82F6'       },
    ];
    let html = `<div class="int-inner">
      <div class="int-kpis">
        ${kpiDef.map(k => `
          <div class="int-kpi-card${_gestionFilter === k.f ? ' int-kpi-active' : ''}" onclick="MX.Pages.Int._setGestionFilter('${k.f}')">
            <div class="int-kpi-val" style="color:${k.col}">${k.val}</div>
            <div class="int-kpi-lbl">${k.lbl}</div>
          </div>`).join('')}
      </div>`;

    // ── Filter pills — les 4 couleurs + "Toutes" ; "En retard" préservé
    // comme filtre SÉPARÉ et informatif (_isLate), jamais un 5ᵉ état. ──
    const pillDef = [
      { f: '',                    l: 'Toutes',               emo: '🔘' },
      { f: 'a_prendre_en_charge', l: 'À prendre en charge',  emo: '🔴' },
      { f: 'en_pause',            l: 'En attente',           emo: '🟡' },
      { f: 'en_cours',            l: 'En cours',             emo: '🟢' },
      { f: 'terminee',            l: 'Terminées',            emo: '🔵' },
      { f: 'en_retard',           l: 'En retard',             emo: '⏰' },
    ];
    html += `<div class="int-pills">
      ${pillDef.map(p => `<button class="int-pill${_gestionFilter === p.f ? ' active' : ''}" onclick="MX.Pages.Int._setGestionFilter('${p.f}')">${p.emo} ${p.l}</button>`).join('')}
    </div>`;

    // ── Toolbar ──
    if (techOpts || _filterPrio) {
      html += `<div class="int-toolbar">
        <span class="int-count">${list.length} intervention${list.length !== 1 ? 's' : ''}</span>
        <div class="int-toolbar-filters">
          ${techOpts}
          <select class="int-filter-sel" onchange="MX.Pages.Int._setFilter('prio',this.value)">
            <option value="">Toutes priorités</option>
            ${Object.entries(PRIO).map(([k, p]) =>
              `<option value="${k}"${_filterPrio === k ? ' selected' : ''}>${p.l}</option>`
            ).join('')}
          </select>
        </div>
      </div>`;
    } else {
      html += `<div class="int-toolbar"><span class="int-count">${list.length} intervention${list.length !== 1 ? 's' : ''}</span></div>`;
    }

    // ── List ──
    if (!list.length) {
      html += _emptyState('fa-screwdriver-wrench',
        'Aucune intervention',
        _gestionFilter
          ? 'Aucune intervention dans cette catégorie.'
          : (canAll ? 'Créez votre première intervention.' : 'Aucune intervention ne vous est affectée.'),
        (!_gestionFilter && canAll)
          ? `<button class="int-btn-primary" onclick="MX.Pages.Int._newInt()"><i class="fas fa-plus"></i> Nouvelle intervention</button>`
          : ''
      );
    } else {
      list.forEach(iv => { html += _intCard(iv); });
    }

    // ── Stats section (Resp/Admin only, inline at bottom) ──
    if (canAll && _interventions.length) {
      const done    = _interventions.filter(iv => iv.status === 'terminee' && iv.timeSpentMin);
      const avgMin  = done.length ? Math.round(done.reduce((s, iv) => s + (iv.timeSpentMin || 0), 0) / done.length) : null;
      const byTech  = {};
      _interventions.forEach(iv => { (iv.assignedTo || []).forEach(n => { byTech[n] = (byTech[n] || 0) + 1; }); });
      const topTechs = Object.entries(byTech).sort((a, b) => b[1] - a[1]).slice(0, 8);

      if (topTechs.length || avgMin !== null) {
        html += `<div class="int-sec-ttl" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border2)">
          <i class="fas fa-chart-bar" style="margin-right:6px;color:var(--text3)"></i>Statistiques
        </div>`;
        if (avgMin !== null) {
          html += `<div class="int-stats-grid">
            <div class="int-stat-card">
              <div class="int-stat-v">${avgMin < 60 ? avgMin + 'min' : (Math.round(avgMin / 60 * 10) / 10) + 'h'}</div>
              <div class="int-stat-l">Temps moyen</div>
            </div>
            <div class="int-stat-card">
              <div class="int-stat-v">${done.length}</div>
              <div class="int-stat-l">Terminées chronométrées</div>
            </div>
          </div>`;
        }
        if (topTechs.length) {
          const maxVal = topTechs[0][1];
          html += `<div class="int-tech-bars">`;
          topTechs.forEach(([name, count]) => {
            const u   = _users.find(u => u.name === name);
            const col = u?.color || '#7C3AED';
            html += `<div class="int-tech-bar-row">
              <div class="int-tech-bar-name">${MX.badgeTag ? MX.badgeTag(name) : ''}${esc(name)}</div>
              <div class="int-tech-bar-track">
                <div class="int-tech-bar-fill" style="width:${Math.round(count / maxVal * 100)}%;background:${col}"></div>
              </div>
              <span class="int-tech-bar-val">${count}</span>
            </div>`;
          });
          html += `</div>`;
        }
      }
    }

    return html + '</div>';
  }

  function _setGestionFilter(f) {
    _gestionFilter = f;
    const el = document.getElementById('int-body');
    if (el) el.innerHTML = _body();
  }

  // ── INTERVENTION CARD ──
  function _intCard(iv) {
    const st  = _effStatus(iv);
    const sm  = STATUS[st] || STATUS.a_prendre_en_charge;
    const canAll = _canAll();
    const cu     = MX.state.currentUser;
    const isMine = (iv.assignedTo || []).includes(cu?.name);
    const pendingXfr = _transfers.find(t => t.interventionId === iv.id && t.toTech === cu?.name);

    // Boutons selon l'état de couleur — un technicien assigné (isMine) peut
    // toujours faire progresser son intervention depuis son téléphone, sans
    // passer par l'admin. "Terminer" ne demande ni chronomètre ni date.
    let acts = '';
    if ((canAll || isMine) && st === 'a_prendre_en_charge') {
      acts += `<button class="int-act-btn int-act-btn--green" onclick="event.stopPropagation();MX.Pages.Int._startInt('${iv.id}')"><i class="fas fa-play"></i><span class="int-act-txt"> Prendre en charge</span></button>`;
    }
    if ((canAll || isMine) && st === 'en_pause') {
      acts += `<button class="int-act-btn int-act-btn--green" onclick="event.stopPropagation();MX.Pages.Int._startInt('${iv.id}')"><i class="fas fa-play"></i><span class="int-act-txt"> Reprendre</span></button>`;
      acts += `<button class="int-act-btn int-act-btn--blue" onclick="event.stopPropagation();MX.Pages.Int._closeInt('${iv.id}')"><i class="fas fa-check"></i><span class="int-act-txt"> Terminer</span></button>`;
    }
    if ((canAll || isMine) && st === 'en_cours') {
      acts += `<button class="int-act-btn int-act-btn--warn" onclick="event.stopPropagation();MX.Pages.Int._pauseInt('${iv.id}')"><i class="fas fa-pause"></i><span class="int-act-txt"> Mettre en pause</span></button>`;
      acts += `<button class="int-act-btn int-act-btn--blue" onclick="event.stopPropagation();MX.Pages.Int._closeInt('${iv.id}')"><i class="fas fa-check"></i><span class="int-act-txt"> Terminer</span></button>`;
    }
    if (canAll) {
      acts += `<button class="int-act-btn" onclick="event.stopPropagation();MX.Pages.Int._editInt('${iv.id}')"><i class="fas fa-pen"></i></button>`;
      if (st !== 'terminee' && st !== 'annulee') {
        acts += `<button class="int-act-btn int-act-btn--warn" onclick="event.stopPropagation();MX.Pages.Int._cancelInt('${iv.id}')"><i class="fas fa-ban"></i></button>`;
      }
      acts += `<button class="int-act-btn int-act-btn--del" onclick="event.stopPropagation();MX.Pages.Int._delInt('${iv.id}')"><i class="fas fa-trash"></i></button>`;
    } else if (isMine && st !== 'terminee' && st !== 'annulee') {
      acts += `<button class="int-act-btn" onclick="event.stopPropagation();MX.Pages.Int._transferInt('${iv.id}')"><i class="fas fa-share"></i><span class="int-act-txt"> Transférer</span></button>`;
    }

    const late = _isLate(iv);

    return `<div class="int-card" onclick="MX.Pages.Int._viewInt('${iv.id}')" style="border-left:4px solid ${sm.col}">
      <div class="int-card-top">
        <div class="int-card-title">${esc(iv.title)}</div>
        <div class="int-card-badges">
          ${_statusBadge(iv)}
          ${late ? `<span class="int-badge int-badge--late"><i class="fas fa-clock"></i> En retard</span>` : ''}
          ${_isLegacyRetardAmbiguous(iv) ? `<span class="int-badge int-badge--legacy" title="Ancien retard automatique (fonctionnalité supprimée) : sa progression d'origine ne peut pas être reconstituée."><i class="fas fa-circle-question"></i> Progression d'origine inconnue</span>` : ''}
          ${_prioBadge(iv.priority)}
        </div>
      </div>
      ${iv.description ? `<div class="int-card-desc">${esc(iv.description)}</div>` : ''}
      <div class="int-card-meta">
        ${iv.location ? `<span><i class="fas fa-location-dot"></i> ${esc(iv.location)}</span>` : ''}
        ${iv.startDate ? `<span><i class="fas fa-calendar"></i> ${_dtFmt(iv.startDate, iv.startTime)}</span>` : `<span><i class="fas fa-bolt"></i> Aucune date planifiée</span>`}
        ${iv.endDate ? `<span><i class="fas fa-flag-checkered"></i> ${_dtFmt(iv.endDate, iv.endTime)}</span>` : ''}
        <span><i class="fas fa-user"></i> ${esc(iv.createdBy || '—')}</span>
      </div>
      <div class="int-card-footer">
        <div class="int-card-techs">${_techAvatars(iv.assignedTo)}</div>
        <div class="int-card-acts" onclick="event.stopPropagation()">${acts}</div>
      </div>
      ${pendingXfr ? `<div class="int-xfr-row">
        <i class="fas fa-bell"></i> Demande de <b>${esc(pendingXfr.fromTech)}</b>
        <button class="int-xfr-btn int-xfr-btn--ok" onclick="event.stopPropagation();MX.Pages.Int._acceptXfr('${pendingXfr.id}','${iv.id}')">✓ Accepter</button>
        <button class="int-xfr-btn int-xfr-btn--no" onclick="event.stopPropagation();MX.Pages.Int._refuseXfr('${pendingXfr.id}')">✗ Refuser</button>
      </div>` : ''}
    </div>`;
  }

  // ── TAB: CALENDRIER ──
  function _tCalendrier() {
    const viewDate = _calDate || _today();
    let html = `<div class="int-cal-wrap">
      <div class="int-cal-hdr">
        <div class="int-cal-nav">
          <button class="int-cal-nav-btn" onclick="MX.Pages.Int._calPrev()"><i class="fas fa-chevron-left"></i></button>
          <span class="int-cal-period">${_calPeriodLabel(viewDate)}</span>
          <button class="int-cal-nav-btn" onclick="MX.Pages.Int._calNext()"><i class="fas fa-chevron-right"></i></button>
          <button class="int-cal-today-btn" onclick="MX.Pages.Int._calToday()">Aujourd'hui</button>
        </div>
        <div class="int-cal-view-btns">
          <button class="int-cal-vbtn${_calView==='jour'?' active':''}" onclick="MX.Pages.Int._calSetView('jour')">Jour</button>
          <button class="int-cal-vbtn${_calView==='semaine'?' active':''}" onclick="MX.Pages.Int._calSetView('semaine')">Semaine</button>
          <button class="int-cal-vbtn${_calView==='mois'?' active':''}" onclick="MX.Pages.Int._calSetView('mois')">Mois</button>
        </div>
      </div>
      <button class="int-cal-fab" onclick="MX.Pages.Int._newInt()"><i class="fas fa-plus"></i> Nouvelle</button>`;

    if (_calView === 'semaine') html += _calWeekView(viewDate);
    else if (_calView === 'jour') html += _calDayView(viewDate);
    else html += _calMonthView(viewDate);

    return html + '</div>';
  }

  function _calPeriodLabel(ds) {
    const d = new Date(ds + 'T12:00');
    if (_calView === 'jour') return _dateFmt(ds);
    if (_calView === 'mois') return `${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`;
    const ws = _weekStartOf(ds), we = _addDays(ws, 6);
    const wd = new Date(ws + 'T12:00'), wde = new Date(we + 'T12:00');
    if (wd.getMonth() === wde.getMonth())
      return `${wd.getDate()}–${wde.getDate()} ${MOIS_SH[wd.getMonth()]} ${wd.getFullYear()}`;
    return `${wd.getDate()} ${MOIS_SH[wd.getMonth()]} – ${wde.getDate()} ${MOIS_SH[wde.getMonth()]} ${wde.getFullYear()}`;
  }

  function _calWeekView(viewDate) {
    const today = _today();
    const ws   = _weekStartOf(viewDate);
    const days = Array.from({ length: 7 }, (_, i) => _addDays(ws, i));
    const DOW  = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    const totalH = CAL_HRS * HR_H;

    let h = `<div class="int-cal-week-hdr">
      <div class="int-cal-gutter"></div>
      ${days.map((ds, i) => {
        const d = new Date(ds + 'T12:00');
        return `<div class="int-cal-day-head${ds === today ? ' today' : ''}">
          <div class="int-cal-dow">${DOW[i]}</div>
          <div class="int-cal-dom${ds === today ? ' today' : ''}">${d.getDate()}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="int-cal-scroll">
      <div class="int-cal-grid" style="height:${totalH}px">
        <div class="int-cal-time-col">`;

    for (let hr = CAL_START; hr < CAL_START + CAL_HRS; hr++) {
      h += `<div class="int-cal-time-lbl" style="height:${HR_H}px">${hr.toString().padStart(2,'0')}:00</div>`;
    }
    h += `</div>`;

    days.forEach((ds, di) => {
      const isToday = ds === today;
      const dayIvs = _interventions.filter(iv =>
        iv.startDate && iv.startDate <= ds && (iv.endDate || iv.startDate) >= ds
      );

      const yOf = ts => {
        const [hh, mm] = (ts || '08:00').split(':').map(Number);
        return ((hh - CAL_START) + mm / 60) * HR_H;
      };
      const hOf = (sTs, eTs) => {
        const [sh, sm] = (sTs || '08:00').split(':').map(Number);
        const [eh, em] = (eTs || '09:00').split(':').map(Number);
        return Math.max(((eh * 60 + em) - (sh * 60 + sm)) / 60 * HR_H, 20);
      };

      h += `<div class="int-cal-col${isToday ? ' today' : ''}">`;
      for (let i = 0; i < CAL_HRS; i++) {
        const hr = CAL_START + i;
        h += `<div class="int-cal-slot" style="height:${HR_H}px"
          onclick="MX.Pages.Int._newInt('${ds}','${hr.toString().padStart(2,'0')}:00')"></div>`;
      }
      dayIvs.forEach(iv => {
        const st  = _effStatus(iv);
        const sm  = STATUS[st] || STATUS.a_prendre_en_charge;
        const sTs = iv.startDate === ds ? (iv.startTime || '08:00') : `${CAL_START.toString().padStart(2,'0')}:00`;
        const eTs = (iv.endDate || iv.startDate) === ds ? (iv.endTime || '09:00') : `${(CAL_START + CAL_HRS - 1).toString().padStart(2,'0')}:00`;
        const top = Math.max(0, yOf(sTs));
        const hgt = Math.max(20, hOf(sTs, eTs));
        h += `<div class="int-cal-ev" style="top:${top}px;height:${hgt}px;background:${sm.bg};border-left:3px solid ${sm.col};color:${sm.col}"
          onclick="event.stopPropagation();MX.Pages.Int._viewInt('${iv.id}')">
          <div class="int-cal-ev-title">${esc(iv.title)}</div>
          ${hgt > 32 ? `<div class="int-cal-ev-time">${sTs}–${eTs}</div>` : ''}
        </div>`;
      });
      h += `</div>`;
    });

    // Current time line
    const now  = new Date();
    const nowDs = now.toISOString().slice(0, 10);
    if (days.includes(nowDs)) {
      const nowY = ((now.getHours() - CAL_START) + now.getMinutes() / 60) * HR_H;
      const col  = days.indexOf(nowDs) + 1;
      h += `<div class="int-cal-now" style="top:${nowY}px;grid-column:${col + 1}"></div>`;
    }

    h += `</div></div>`;
    return h;
  }

  function _calDayView(viewDate) {
    const today  = _today();
    const isToday = viewDate === today;
    const totalH = CAL_HRS * HR_H_DAY;
    const dayIvs = _interventions.filter(iv =>
      iv.startDate && iv.startDate <= viewDate && (iv.endDate || iv.startDate) >= viewDate
    );

    const yOf = ts => {
      const [hh, mm] = (ts || '08:00').split(':').map(Number);
      return Math.max(0, ((hh - CAL_START) + mm / 60) * HR_H_DAY);
    };
    const hOf = (sTs, eTs) => {
      const [sh, sm] = (sTs || '08:00').split(':').map(Number);
      const [eh, em] = (eTs || '09:00').split(':').map(Number);
      return Math.max(24, ((eh * 60 + em) - (sh * 60 + sm)) / 60 * HR_H_DAY);
    };

    let h = `<div class="int-cal-day-label${isToday ? ' today' : ''}">${_dateFmt(viewDate)}${isToday ? ' — Aujourd\'hui' : ''}</div>
    <div class="int-cal-scroll">
      <div class="int-cal-day-grid" style="height:${totalH}px">
        <div class="int-cal-time-col">`;
    for (let hr = CAL_START; hr < CAL_START + CAL_HRS; hr++) {
      h += `<div class="int-cal-time-lbl" style="height:${HR_H_DAY}px">${hr.toString().padStart(2,'0')}:00</div>`;
    }
    h += `</div><div class="int-cal-day-events">`;
    for (let i = 0; i < CAL_HRS; i++) {
      const hr = CAL_START + i;
      h += `<div class="int-cal-slot" style="height:${HR_H_DAY}px"
        onclick="MX.Pages.Int._newInt('${viewDate}','${hr.toString().padStart(2,'0')}:00')"></div>`;
    }
    dayIvs.forEach(iv => {
      const st  = _effStatus(iv);
      const sm  = STATUS[st] || STATUS.a_prendre_en_charge;
      const pr  = PRIO[iv.priority] || PRIO.normale;
      const sTs = iv.startDate === viewDate ? (iv.startTime || '08:00') : `${CAL_START.toString().padStart(2,'0')}:00`;
      const eTs = (iv.endDate || iv.startDate) === viewDate ? (iv.endTime || '09:00') : '22:00';
      const top = yOf(sTs);
      const hgt = hOf(sTs, eTs);
      h += `<div class="int-cal-ev int-cal-ev--day" style="top:${top}px;height:${hgt}px;background:${sm.bg};border-left:4px solid ${sm.col};color:${sm.col}"
        onclick="event.stopPropagation();MX.Pages.Int._viewInt('${iv.id}')">
        <div class="int-cal-ev-title">${esc(iv.title)}</div>
        ${hgt > 40 ? `<div class="int-cal-ev-time">${sTs}–${eTs}${iv.location ? ' · ' + esc(iv.location) : ''}</div>` : ''}
        ${hgt > 60 ? `<div class="int-cal-ev-techs">${_techAvatars(iv.assignedTo)}</div>` : ''}
      </div>`;
    });
    // Current time line
    if (isToday) {
      const now  = new Date();
      const nowY = ((now.getHours() - CAL_START) + now.getMinutes() / 60) * HR_H_DAY;
      h += `<div class="int-cal-now int-cal-now--day" style="top:${nowY}px"></div>`;
    }
    h += `</div></div></div>`;
    return h;
  }

  function _calMonthView(viewDate) {
    const today = _today();
    const d     = new Date(viewDate + 'T12:00');
    const year  = d.getFullYear(), month = d.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow    = new Date(year, month, 1).getDay();
    const backDays    = firstDow === 0 ? 6 : firstDow - 1;
    const gridStart   = new Date(year, month, 1 - backDays);

    let h = `<div class="int-cal-month">
      <div class="int-cal-month-hdr">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d=>`<div>${d}</div>`).join('')}</div>
      <div class="int-cal-month-grid">`;

    for (let i = 0; i < 42; i++) {
      const cell = new Date(gridStart);
      cell.setDate(gridStart.getDate() + i);
      const ds         = cell.toISOString().slice(0, 10);
      const inMonth    = cell.getMonth() === month;
      const isToday    = ds === today;
      const cellIvs    = _interventions.filter(iv => iv.startDate && iv.startDate <= ds && (iv.endDate || iv.startDate) >= ds);
      const shown      = cellIvs.slice(0, 3);
      const overflow   = cellIvs.length - shown.length;

      h += `<div class="int-cal-cell${!inMonth ? ' out-month' : ''}${isToday ? ' today' : ''}" onclick="MX.Pages.Int._calDayClick('${ds}')">
        <div class="int-cal-cell-dom${isToday ? ' today' : ''}">${cell.getDate()}</div>
        ${shown.map(iv => {
          const st = _effStatus(iv);
          const sm = STATUS[st] || STATUS.a_prendre_en_charge;
          return `<div class="int-cal-cell-ev" style="background:${sm.bg};border-left:2px solid ${sm.col};color:${sm.col}"
            onclick="event.stopPropagation();MX.Pages.Int._viewInt('${iv.id}')">${esc(iv.title)}</div>`;
        }).join('')}
        ${overflow > 0 ? `<div class="int-cal-cell-more">+${overflow}</div>` : ''}
      </div>`;
    }
    h += `</div></div>`;
    return h;
  }

  // ── EMPTY STATE ──
  function _emptyState(icon, title, sub, extra) {
    return `<div class="int-empty">
      <i class="fas ${icon} int-empty-ico"></i>
      <div class="int-empty-ttl">${title}</div>
      ${sub ? `<div class="int-empty-sub">${sub}</div>` : ''}
      ${extra || ''}
    </div>`;
  }

  // ── CALENDAR NAVIGATION ──
  function _calPrev() {
    const base = _calDate || _today();
    if (_calView === 'jour')    _calDate = _addDays(base, -1);
    else if (_calView === 'semaine') _calDate = _addDays(_weekStartOf(base), -7);
    else {
      const d = new Date(base + 'T12:00');
      d.setMonth(d.getMonth() - 1);
      _calDate = d.toISOString().slice(0, 10);
    }
    _rerender();
  }
  function _calNext() {
    const base = _calDate || _today();
    if (_calView === 'jour')    _calDate = _addDays(base, 1);
    else if (_calView === 'semaine') _calDate = _addDays(_weekStartOf(base), 7);
    else {
      const d = new Date(base + 'T12:00');
      d.setMonth(d.getMonth() + 1);
      _calDate = d.toISOString().slice(0, 10);
    }
    _rerender();
  }
  function _calToday() { _calDate = ''; _rerender(); }
  function _calSetView(v) { _calView = v; _rerender(); }
  function _calDayClick(ds) { _calDate = ds; _calView = 'jour'; _rerender(); }

  // ── FILTERS ──
  function _setFilter(type, val) {
    if (type === 'tech')   _filterTech   = val;
    if (type === 'status') _filterStatus = val;
    if (type === 'prio')   _filterPrio   = val;
    _rerender();
  }

  // ── TECHNICIAN PICKER HTML ──
  function _techPicker(selected) {
    _pickerSel = [...(selected || [])];
    if (!_users.length) return '';
    const techs = _users.filter(u => u.role === 'technicien' || u.role === 'responsable');
    if (!techs.length) return '';
    return `<div class="int-form-label">Techniciens affectés</div>
      <div class="int-tech-picker" id="int-tp">
        ${techs.map(u => {
          const isSel = _pickerSel.includes(u.name);
          const initials = (u.name || '?').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
          return `<button type="button"
            class="int-tech-pick-item${isSel ? ' selected' : ''}"
            data-tech="${esc(u.name)}"
            onclick="MX.Pages.Int._toggleTech(this)">
            ${isSel ? '<i class="fas fa-check int-tp-ck"></i>' : ''}
            <span class="int-avatar" style="background:${u.color || '#7C3AED'}${MX.badgeBorder && MX.badgeBorder(u.name) ? ';border:2px solid ' + MX.badgeBorder(u.name) : ''}">${initials}</span>
            ${esc(u.name)}
          </button>`;
        }).join('')}
      </div>`;
  }

  // ── PLANIFICATION (optionnelle) ──
  function _schedFieldsHtml(checked, sd, st, ed, et) {
    return `<div class="int-sched-toggle${checked ? ' checked' : ''}" id="int-sched-toggle">
      <label class="int-sched-toggle-row">
        <input type="checkbox" id="int-f-sched" ${checked ? 'checked' : ''} onchange="MX.Pages.Int._toggleSched(this)">
        <span class="int-sched-toggle-txt">
          <strong>Planifier cette intervention</strong>
          <small>Programmer une date et une heure</small>
        </span>
      </label>
      <div class="int-sched-fields" id="int-sched-fields" style="${checked ? '' : 'display:none'}">
        <div class="int-form-date-col">
          <div class="int-form-label">Début</div>
          <input type="date" id="int-f-sd" class="fi" value="${sd}">
          <input type="time" id="int-f-st" class="fi" value="${st}">
        </div>
        <div class="int-form-date-col">
          <div class="int-form-label">Fin prévue</div>
          <input type="date" id="int-f-ed" class="fi" value="${ed}">
          <input type="time" id="int-f-et" class="fi" value="${et}">
        </div>
      </div>
    </div>`;
  }

  function _toggleSched(cb) {
    const wrap = document.getElementById('int-sched-fields');
    const toggle = document.getElementById('int-sched-toggle');
    if (wrap) wrap.style.display = cb.checked ? '' : 'none';
    if (toggle) toggle.classList.toggle('checked', cb.checked);
  }

  function _toggleTech(btn) {
    const name = btn.dataset.tech;
    if (!name) return;
    const isSel = _pickerSel.includes(name);
    if (isSel) {
      _pickerSel = _pickerSel.filter(n => n !== name);
      btn.classList.remove('selected');
      btn.querySelector('.int-tp-ck')?.remove();
    } else {
      _pickerSel.push(name);
      btn.classList.add('selected');
      const ck = document.createElement('i');
      ck.className = 'fas fa-check int-tp-ck';
      btn.insertBefore(ck, btn.firstChild);
    }
  }

  // ── PHOTO HELPERS ──
  function _intPhotoHtml(existing) {
    const prev = existing ? `<img id="int-ph-prev" class="mob-photo-preview" src="${esc(existing)}" alt="Photo">` : `<img id="int-ph-prev" class="mob-photo-preview" style="display:none" alt="Photo">`;
    return `<div>
      <div class="int-form-label"><i class="fas fa-camera"></i> Photo (optionnel)</div>
      <label class="mob-camera-btn">
        <i class="fas fa-camera"></i>
        <span>Prendre / choisir une photo</span>
        <input type="file" accept="image/*" capture="environment" onchange="MX.Pages.Int._onIntPhoto(this)" style="display:none">
      </label>
      ${prev}
    </div>`;
  }

  function _onIntPhoto(input) {
    const file = input.files?.[0];
    if (!file) return;
    _compressInt(file, 800, 800, 0.72).then(b64 => {
      _intPhotoB64 = b64;
      const prev = document.getElementById('int-ph-prev');
      if (prev) { prev.src = b64; prev.style.display = 'block'; }
    }).catch(() => MX.toast('Erreur lecture photo', true));
  }

  function _compressInt(file, mW, mH, q) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > mW) { h = Math.round(h * mW / w); w = mW; }
        if (h > mH) { w = Math.round(w * mH / h); h = mH; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ── ACTIONS ──
  function _newInt(defaultDate, defaultTime) {
    _intPhotoB64 = null;
    const today = _today();
    const ds = defaultDate || today;
    const ts = defaultTime || '09:00';
    const eh = Math.min((parseInt(ts.split(':')[0]) || 9) + 1, 22);
    const et = eh.toString().padStart(2, '0') + ':00';
    // Ouverte depuis un créneau du calendrier → la planification est déjà
    // l'intention explicite de l'utilisateur, on la pré-coche. Ouverte depuis
    // le bouton "+" générique → intervention immédiate par défaut (décochée).
    const planPrechecked = !!(defaultDate || defaultTime);

    MX.showModal({
      title: '🔧 Nouvelle intervention',
      sub: '',
      body: `<div class="int-form">
        <input id="int-f-title" class="fi" placeholder="Titre *" maxlength="120">
        <textarea id="int-f-desc" class="fi" placeholder="Description" rows="3" style="resize:vertical"></textarea>
        <input id="int-f-loc" class="fi" placeholder="Localisation" maxlength="80">
        <select id="int-f-prio" class="fi">
          ${Object.entries(PRIO).map(([k, p]) => `<option value="${k}"${k === 'normale' ? ' selected' : ''}>${p.l}</option>`).join('')}
        </select>
        ${_canAll() ? _techPicker([]) : ''}
        ${_schedFieldsHtml(planPrechecked, ds, ts, ds, et)}
        ${_intPhotoHtml(null)}
      </div>`,
      actions: [
        { label: 'Créer', cls: 'confirm', fn: async () => {
          const title = document.getElementById('int-f-title')?.value?.trim();
          if (!title) { MX.toast('Le titre est requis', true); return; }
          const isPlanned = !!document.getElementById('int-f-sched')?.checked;
          let schedFields = {};
          if (isPlanned) {
            const sd = document.getElementById('int-f-sd')?.value;
            const st = document.getElementById('int-f-st')?.value;
            if (!sd || !st) { MX.toast('Date et heure de début requises', true); return; }
            schedFields = {
              startDate: sd,
              startTime: st,
              endDate:   document.getElementById('int-f-ed')?.value || sd,
              endTime:   document.getElementById('int-f-et')?.value || '',
            };
          }
          const assigned = [..._pickerSel];
          const data = {
            title,
            description: document.getElementById('int-f-desc')?.value?.trim() || '',
            location:    document.getElementById('int-f-loc')?.value?.trim() || '',
            priority:    document.getElementById('int-f-prio')?.value || 'normale',
            // ROUGE — statut initial de toute nouvelle intervention, quels
            // que soient la planification ou les techniciens déjà affectés.
            status:      'a_prendre_en_charge',
            ...schedFields,
            assignedTo:  assigned,
            photo:       _intPhotoB64 || null,
            createdBy:   _author(),
            createdAt:   FV.serverTimestamp(),
            updatedAt:   FV.serverTimestamp(),
          };
          try {
            await DB.int().add(data);
            assigned.forEach(n => _notifyTech(n, data.title, data.startDate, data.startTime, data.location, data.priority));
            MX.toast('Intervention créée');
          } catch(e) { MX.toast('Erreur création', true); console.error(e); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('int-f-title')?.focus(), 80);
  }

  function _editInt(id) {
    _intPhotoB64 = null;
    const iv = _interventions.find(x => x.id === id);
    if (!iv) return;
    const today = _today();
    const wasPlanned = _isPlanned(iv);
    MX.showModal({
      title: '✏️ Modifier l\'intervention',
      sub: esc(iv.title),
      body: `<div class="int-form">
        <input id="int-f-title" class="fi" value="${esc(iv.title)}" maxlength="120">
        <textarea id="int-f-desc" class="fi" rows="3" style="resize:vertical">${esc(iv.description || '')}</textarea>
        <input id="int-f-loc" class="fi" value="${esc(iv.location || '')}" maxlength="80">
        <select id="int-f-prio" class="fi">
          ${Object.entries(PRIO).map(([k, p]) => `<option value="${k}"${iv.priority === k ? ' selected' : ''}>${p.l}</option>`).join('')}
        </select>
        <select id="int-f-status" class="fi">
          ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${_effStatus(iv) === k ? ' selected' : ''}>${s.l}</option>`).join('')}
        </select>
        ${_techPicker(iv.assignedTo)}
        ${_schedFieldsHtml(wasPlanned, iv.startDate || today, iv.startTime || '09:00', iv.endDate || iv.startDate || today, iv.endTime || '10:00')}
        ${_intPhotoHtml(iv.photo || null)}
      </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'confirm', fn: async () => {
          const title = document.getElementById('int-f-title')?.value?.trim();
          if (!title) { MX.toast('Titre requis', true); return; }
          const assigned   = [..._pickerSel];
          const newTechs   = assigned.filter(t => !(iv.assignedTo || []).includes(t));
          const newStatus  = document.getElementById('int-f-status')?.value || iv.status;
          const isPlanned  = !!document.getElementById('int-f-sched')?.checked;
          let schedFields, notifDate = null, notifTime = null;
          if (isPlanned) {
            const sd = document.getElementById('int-f-sd')?.value;
            const st = document.getElementById('int-f-st')?.value;
            if (!sd || !st) { MX.toast('Date et heure de début requises', true); return; }
            const ed = document.getElementById('int-f-ed')?.value || sd;
            const et = document.getElementById('int-f-et')?.value || '';
            schedFields = { startDate: sd, startTime: st, endDate: ed, endTime: et };
            notifDate = sd; notifTime = st;
          } else {
            // Décochée : on retire les champs de planification existants
            // (compatibilité — une ancienne intervention planifiée peut
            // redevenir non planifiée), jamais de valeur inventée.
            schedFields = {
              startDate: FV.delete(), startTime: FV.delete(),
              endDate: FV.delete(), endTime: FV.delete(),
            };
          }
          const data = {
            title,
            description: document.getElementById('int-f-desc')?.value?.trim() || '',
            location:    document.getElementById('int-f-loc')?.value?.trim() || '',
            priority:    document.getElementById('int-f-prio')?.value || iv.priority,
            status:      newStatus,
            ...schedFields,
            assignedTo:  assigned,
            photo:       _intPhotoB64 !== null ? _intPhotoB64 : (iv.photo || null),
            updatedAt:   FV.serverTimestamp(),
          };
          try {
            await DB.int().doc(id).update(data);
            newTechs.forEach(n => _notifyTech(n, title, notifDate, notifTime, data.location, data.priority));
            MX.toast('Intervention mise à jour');
          } catch(e) { MX.toast('Erreur', true); console.error(e); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('int-f-title')?.focus(), 80);
  }

  function _viewInt(id) {
    const iv = _interventions.find(x => x.id === id);
    if (!iv) return;
    const st     = _effStatus(iv);
    const sm     = STATUS[st] || STATUS.a_prendre_en_charge;
    const pr     = PRIO[iv.priority] || PRIO.normale;
    const canAll = _canAll();
    const cu     = MX.state.currentUser;
    const isMine = (iv.assignedTo || []).includes(cu?.name);
    const createdD = _tsDate(iv.createdAt);

    const acts = [];
    if (canAll) acts.push({ label: '✏️ Modifier', cls: 'confirm', fn: () => _editInt(id) });
    if ((canAll || isMine) && st === 'a_prendre_en_charge') {
      acts.push({ label: '▶ Prendre en charge', cls: 'confirm', fn: () => _startInt(id) });
    }
    if ((canAll || isMine) && st === 'en_pause') {
      acts.push({ label: '▶ Reprendre', cls: 'confirm', fn: () => _startInt(id) });
      acts.push({ label: '✓ Terminer', cls: 'confirm', fn: () => _closeInt(id) });
    }
    if ((canAll || isMine) && st === 'en_cours') {
      acts.push({ label: '⏸ Mettre en pause', cls: 'cancel', fn: () => _pauseInt(id) });
      acts.push({ label: '✓ Terminer', cls: 'confirm', fn: () => _closeInt(id) });
    }
    acts.push({ label: 'Fermer', cls: 'cancel' });

    MX.showModal({
      title: `${esc(iv.title)}`,
      sub: `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${_statusBadge(iv)} ${_isLate(iv) ? `<span class="int-badge int-badge--late"><i class="fas fa-clock"></i> En retard</span>` : ''} ${_isLegacyRetardAmbiguous(iv) ? `<span class="int-badge int-badge--legacy" title="Ancien retard automatique (fonctionnalité supprimée) : sa progression d'origine ne peut pas être reconstituée."><i class="fas fa-circle-question"></i> Progression d'origine inconnue</span>` : ''} ${_prioBadge(iv.priority)}</div>`,
      body: `<div class="int-view-body">
        ${iv.description ? `<div class="int-view-desc">${esc(iv.description)}</div>` : ''}
        ${iv.location ? `<div class="int-view-row"><i class="fas fa-location-dot"></i> ${esc(iv.location)}</div>` : ''}
        ${_isPlanned(iv) ? `<div class="int-view-dates">
          <div class="int-view-date-blk">
            <div class="int-view-date-lbl">Début</div>
            <div class="int-view-date-val">${_dtFmt(iv.startDate, iv.startTime)}</div>
          </div>
          <div class="int-view-date-blk">
            <div class="int-view-date-lbl">Fin prévue</div>
            <div class="int-view-date-val">${iv.endDate ? _dtFmt(iv.endDate, iv.endTime) : '—'}</div>
          </div>
        </div>` : `<div class="int-view-row"><i class="fas fa-bolt"></i> Aucune date planifiée (intervention ouverte)</div>`}
        <div class="int-view-techs">
          <div class="int-form-label">Techniciens</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${_techAvatars(iv.assignedTo)}</div>
        </div>
        ${iv.pauseReason ? `<div class="int-view-row"><i class="fas fa-pause"></i> Motif de pause : ${esc(iv.pauseReason)}</div>` : ''}
        ${iv.completionNotes ? `<div class="int-view-report">
          <div class="int-form-label">Rapport de clôture</div>
          <div class="int-view-desc">${esc(iv.completionNotes)}</div>
          ${iv.timeSpentMin ? `<div class="int-view-row"><i class="fas fa-clock"></i> ${iv.timeSpentMin < 60 ? iv.timeSpentMin + ' min' : (Math.round(iv.timeSpentMin / 60 * 10) / 10) + ' h'} · ${esc(iv.completedBy || '')}</div>` : ''}
        </div>` : ''}
        ${iv.photo ? `<div>
          <div class="int-form-label"><i class="fas fa-camera"></i> Photo</div>
          <img src="${esc(iv.photo)}" alt="Photo intervention" class="mob-photo-preview">
        </div>` : ''}
        <div class="int-view-meta">Créée par ${esc(iv.createdBy || '')}${createdD ? ' · ' + createdD.toLocaleDateString('fr-FR') : ''}</div>
      </div>`,
      actions: acts
    });
  }

  // ROUGE → VERT ("Prendre en charge") ET JAUNE → VERT ("Reprendre") — même
  // transition de statut, seul le libellé change selon l'état de départ.
  function _startInt(id) {
    const iv = _interventions.find(x => x.id === id);
    const wasPaused = iv && _effStatus(iv) === 'en_pause';
    MX.showModal({
      title: wasPaused ? '▶ Reprendre l\'intervention' : '▶ Prendre en charge',
      sub: 'Elle sera marquée "En cours".',
      body: '',
      actions: [
        { label: wasPaused ? 'Reprendre' : 'Démarrer', cls: 'confirm', fn: async () => {
          try {
            await DB.int().doc(id).update({ status: 'en_cours', updatedAt: FV.serverTimestamp() });
            MX.toast(wasPaused ? 'Intervention reprise' : 'Intervention démarrée');
          } catch(e) { MX.toast('Erreur', true); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  // VERT → JAUNE — motif facultatif, conservé et consultable (voir
  // _viewInt : "Motif de pause"). Jamais de chronomètre, jamais de blocage.
  function _pauseInt(id) {
    const iv = _interventions.find(x => x.id === id);
    MX.showModal({
      title: '⏸ Mettre en pause',
      sub: esc(iv?.title || ''),
      body: `<div class="int-form">
        <textarea id="int-pause-reason" class="fi" placeholder="Motif (optionnel) : pièce en attente, accès bloqué, prestataire…" rows="3" style="resize:vertical"></textarea>
      </div>`,
      actions: [
        { label: '⏸ Mettre en pause', cls: 'confirm', fn: async () => {
          const reason = document.getElementById('int-pause-reason')?.value?.trim() || '';
          try {
            await DB.int().doc(id).update({
              status: 'en_pause',
              pauseReason: reason || null,
              pausedAt: FV.serverTimestamp(),
              pausedBy: _author(),
              updatedAt: FV.serverTimestamp(),
            });
            MX.toast('Intervention mise en pause');
          } catch(e) { MX.toast('Erreur', true); console.error(e); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('int-pause-reason')?.focus(), 80);
  }

  // VERT ou JAUNE → BLEU — jamais de chronomètre, jamais de date de fin
  // obligatoire ; rapport et temps passé restent facultatifs (un seul écran).
  function _closeInt(id) {
    const iv = _interventions.find(x => x.id === id);
    MX.showModal({
      title: '✅ Terminer l\'intervention',
      sub: esc(iv?.title || ''),
      body: `<div class="int-form">
        <textarea id="int-close-notes" class="fi" placeholder="Rapport de clôture (optionnel)" rows="4" style="resize:vertical"></textarea>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:13px;color:var(--text2)">Temps passé :</label>
          <input type="number" id="int-close-time" class="fi" min="0" max="9999" placeholder="minutes" style="width:100px;text-align:center">
        </div>
      </div>`,
      actions: [
        { label: '✓ Terminer', cls: 'confirm', fn: async () => {
          const notes   = document.getElementById('int-close-notes')?.value?.trim() || '';
          const timeVal = parseInt(document.getElementById('int-close-time')?.value || '');
          try {
            await DB.int().doc(id).update({
              status: 'terminee',
              completionNotes: notes,
              timeSpentMin: isNaN(timeVal) ? null : timeVal,
              completedBy: _author(),
              completedAt: FV.serverTimestamp(),
              updatedAt:   FV.serverTimestamp(),
            });
            MX.toast('Intervention terminée ✓');
          } catch(e) { MX.toast('Erreur', true); console.error(e); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
    setTimeout(() => document.getElementById('int-close-notes')?.focus(), 80);
  }

  function _cancelInt(id) {
    const iv = _interventions.find(x => x.id === id);
    MX.showModal({
      title: 'Annuler l\'intervention',
      sub: `"${esc(iv?.title || '')}" sera marquée Annulée.`,
      body: '',
      actions: [
        { label: 'Annuler l\'intervention', cls: 'danger', fn: async () => {
          try {
            await DB.int().doc(id).update({ status: 'annulee', cancelledBy: _author(), updatedAt: FV.serverTimestamp() });
            MX.toast('Intervention annulée');
          } catch(e) { MX.toast('Erreur', true); }
        }},
        { label: 'Retour', cls: 'cancel' }
      ]
    });
  }

  function _delInt(id) {
    const iv = _interventions.find(x => x.id === id);
    MX.showModal({
      title: 'Mettre à la corbeille',
      sub: `"${esc(iv?.title || '')}" sera placée en corbeille.`,
      body: '<div style="margin-bottom:4px"><label style="font-size:12px;color:var(--text3)">Raison (optionnel)</label><input class="fi" id="int-del-reason" placeholder="Motif de suppression…" style="margin-top:4px"></div>',
      actions: [
        { label: 'Mettre à la corbeille', cls: 'danger', fn: async () => {
          try {
            const reason = (document.getElementById('int-del-reason') || {}).value || '';
            await MX.Trash.sendToTrash('interventions', id, { name: iv?.title || '', type: 'Intervention', reason });
            MX.toast('Intervention placée en corbeille');
          } catch(e) { MX.toast('Erreur : ' + (e.message || ''), true); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  // ── TRANSFER (Tech → Tech, validation required) ──
  function _transferInt(id) {
    const iv = _interventions.find(x => x.id === id);
    if (!iv) return;
    const cu = MX.state.currentUser;
    const others = _users.filter(u => (u.role === 'technicien') && u.name !== cu?.name);
    if (!others.length) { MX.toast('Aucun autre technicien disponible', true); return; }

    MX.showModal({
      title: '↪ Transférer l\'intervention',
      sub: esc(iv.title),
      body: `<div class="int-form">
        <div style="font-size:13px;color:var(--text2);margin-bottom:8px">
          Le technicien destinataire devra <b>accepter</b> la prise en charge. L'intervention restera affectée tant que la demande n'est pas acceptée.
        </div>
        <select id="int-xfr-to" class="fi">
          <option value="">Choisir un technicien…</option>
          ${others.map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('')}
        </select>
      </div>`,
      actions: [
        { label: 'Envoyer la demande', cls: 'confirm', fn: async () => {
          const toTech = document.getElementById('int-xfr-to')?.value;
          if (!toTech) { MX.toast('Sélectionnez un technicien', true); return; }
          try {
            await DB.xfr().add({
              interventionId: id,
              fromTech: cu.name,
              toTech,
              status: 'pending',
              requestedAt: FV.serverTimestamp(),
            });
            MX.toast(`Demande envoyée à ${toTech}`);
          } catch(e) { MX.toast('Erreur', true); console.error(e); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _acceptXfr(xfrId, intId) {
    const xfr = _transfers.find(t => t.id === xfrId);
    if (!xfr) return;
    const iv = _interventions.find(x => x.id === intId);
    if (!iv) return;
    const newAssigned = [...new Set([...(iv.assignedTo || []).filter(t => t !== xfr.fromTech), xfr.toTech])];
    try {
      const batch = db.batch();
      batch.update(DB.int().doc(intId), { assignedTo: newAssigned, updatedAt: FV.serverTimestamp() });
      batch.update(DB.xfr().doc(xfrId), { status: 'accepted' });
      await batch.commit();
      MX.toast('Prise en charge acceptée');
    } catch(e) { MX.toast('Erreur', true); console.error(e); }
  }

  async function _refuseXfr(xfrId) {
    try {
      await DB.xfr().doc(xfrId).update({ status: 'refused' });
      MX.toast('Demande refusée');
    } catch(e) { MX.toast('Erreur', true); }
  }

  // ── NOTIFICATIONS ──
  function _notifyTech(techName, title, date, time, location, priority) {
    const cu = MX.state.currentUser;
    if (cu?.name === techName) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(`🔧 Nouvelle intervention — ${title}`, {
        body: [date ? _dtFmt(date, time) : '', location, PRIO[priority]?.l].filter(Boolean).join(' · '),
        icon:  '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-192.png',
        vibrate: [200, 100, 200],
        data: { url: '/' },
      });
    } catch(_) {}
  }

  // ── PUBLIC API ──
  window.MX       = window.MX       || {};
  window.MX.Pages = window.MX.Pages || {};
  function _getSummary(forUser) {
    _load();
    const ints = forUser
      ? _interventions.filter(iv => (iv.assignedTo || []).includes(forUser))
      : _interventions;
    const eff = iv => _effStatus(iv);
    return {
      // "en_attente" regroupe les 2 états "pas encore en cours" (rouge +
      // jaune) — le retard ("en_retard" ci-dessous) reste calculé séparément
      // via _isLate(), jamais confondu avec l'avancement réel.
      en_attente: ints.filter(iv => { const s = eff(iv); return s === 'a_prendre_en_charge' || s === 'en_pause'; }).length,
      en_cours:   ints.filter(iv => eff(iv) === 'en_cours').length,
      en_retard:  ints.filter(iv => _isLate(iv)).length,
      terminee:   ints.filter(iv => eff(iv) === 'terminee').length,
      total:      ints.length,
      items:      ints.map(iv => ({ ...iv, effStatus: eff(iv), isLate: _isLate(iv) }))
    };
  }

  window.MX.Pages.Int = {
    render, _tab, _getSummary, _setGestionFilter,
    _newInt, _editInt, _viewInt, _startInt, _pauseInt, _closeInt, _cancelInt, _delInt,
    _transferInt, _acceptXfr, _refuseXfr,
    _setFilter, _toggleTech, _toggleSched, _onIntPhoto,
    _calPrev, _calNext, _calToday, _calSetView, _calDayClick,
    // Déclenche le chargement (idempotent, _load() est déjà gardé par
    // _loaded) et prévient l'appelant une fois les données disponibles.
    ensureLoaded: function (cb) {
      _load();
      if (_ready) { if (cb) cb(); return; }
      if (cb) _readyCbs.push(cb);
    },
    isReady: function () { return _ready; },
  };
})();
