(function () {
  'use strict';

  // ── STATE ──
  let _curTab    = 'toutes';
  let _calView   = 'semaine';
  let _calDate   = '';
  let _filterTech   = '';
  let _filterStatus = '';
  let _filterPrio   = '';
  let _interventions = [];
  let _transfers     = [];
  let _users         = [];
  let _loaded    = false;
  let _unsubInt  = {};
  let _pickerSel  = [];
  let _intPhotoB64 = null;

  // ── FIRESTORE ──
  const DB = {
    int: () => db.collection('interventions'),
    xfr: () => db.collection('int_transfers'),
  };
  const FV = firebase.firestore.FieldValue;

  // ── METADATA ──
  const STATUS = {
    planifiee: { l: 'Planifiée',  col: '#F59E0B', bg: 'rgba(245,158,11,.13)'  },
    affectee:  { l: 'Affectée',   col: '#3B82F6', bg: 'rgba(59,130,246,.13)'  },
    en_cours:  { l: 'En cours',   col: '#F97316', bg: 'rgba(249,115,22,.13)'  },
    terminee:  { l: 'Terminée',   col: '#22C55E', bg: 'rgba(34,197,94,.13)'   },
    en_retard: { l: 'En retard',  col: '#EF4444', bg: 'rgba(239,68,68,.13)'   },
    annulee:   { l: 'Annulée',    col: '#6B7280', bg: 'rgba(107,114,128,.13)' },
  };

  const PRIO = {
    urgente: { l: 'Urgente',  col: '#EF4444', icon: 'fa-fire' },
    haute:   { l: 'Haute',    col: '#F97316', icon: 'fa-circle-exclamation' },
    normale: { l: 'Normale',  col: '#3B82F6', icon: 'fa-circle-dot' },
    basse:   { l: 'Basse',    col: '#6B7280', icon: 'fa-minus' },
  };

  const TABS = [
    { id: 'toutes',     icon: 'fa-list',                  l: 'Toutes',       mob: 'Toutes'   },
    { id: 'calendrier', icon: 'fa-calendar-days',         l: 'Calendrier',   mob: 'Calendrier'},
    { id: 'en_attente', icon: 'fa-clock',                 l: 'En attente',   mob: 'Attente'  },
    { id: 'en_cours',   icon: 'fa-spinner',               l: 'En cours',     mob: 'En cours' },
    { id: 'terminees',  icon: 'fa-circle-check',          l: 'Terminées',    mob: 'Faites'   },
    { id: 'retards',    icon: 'fa-triangle-exclamation',  l: 'Retards',      mob: 'Retards'  },
    { id: 'stats',      icon: 'fa-chart-bar',             l: 'Statistiques', mob: 'Stats'    },
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

  function _effStatus(iv) {
    if (iv.status === 'terminee' || iv.status === 'annulee') return iv.status;
    const endDt = iv.endDate
      ? new Date(`${iv.endDate}T${iv.endTime || '23:59'}:00`)
      : null;
    if (endDt && endDt < new Date()) return 'en_retard';
    return iv.status || 'planifiee';
  }

  function _statusBadge(iv) {
    const st = _effStatus(iv);
    const s  = STATUS[st] || STATUS.planifiee;
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
      return `<span class="int-avatar" style="background:${color}" title="${esc(name)}">${esc(initials)}</span>`;
    }).join('') + assignedTo.map(n => `<span class="int-avatar-name">${esc(n)}</span>`).join('');
  }

  // ── DATA LAYER ──
  function _load() {
    if (_loaded) return;
    _loaded = true;

    _unsubInt.int = DB.int()
      .orderBy('startDate', 'desc')
      .limit(300)
      .onSnapshot(snap => {
        _interventions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _autoRetard();
        _rerender();
      });

    _unsubInt.xfr = DB.xfr()
      .where('status', '==', 'pending')
      .onSnapshot(snap => {
        _transfers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _rerender();
      });

    db.collection('users').get().then(snap => {
      _users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    });
  }

  function _autoRetard() {
    const now = new Date();
    _interventions.forEach(iv => {
      if (iv.status === 'terminee' || iv.status === 'annulee' || iv.status === 'en_retard') return;
      const endDt = iv.endDate ? new Date(`${iv.endDate}T${iv.endTime || '23:59'}:00`) : null;
      if (endDt && endDt < now) {
        DB.int().doc(iv.id).update({ status: 'en_retard', updatedAt: FV.serverTimestamp() }).catch(() => {});
      }
    });
  }

  // ── RENDER ──
  function render() {
    if (window._intStartTab) { _curTab = window._intStartTab; window._intStartTab = null; }
    _load();
    const mc = document.getElementById('main-content');
    if (!mc) return;

    const cu = MX.state.currentUser;
    const myPending = _transfers.filter(t => t.toTech === cu?.name).length;
    const retardCount = _interventions.filter(iv => _effStatus(iv) === 'en_retard').length;

    mc.innerHTML = `<div class="int-page">
      <div class="int-tabs">
        ${TABS.map(t => {
          const cnt = t.id === 'retards' ? retardCount : 0;
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
    _curTab = id;
    document.querySelectorAll('.int-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    const el = document.getElementById('int-body');
    if (el) el.innerHTML = _body();
    const fab = document.getElementById('int-fab');
    if (fab) fab.style.display = id === 'calendrier' ? 'none' : '';
  }

  function _body() {
    switch (_curTab) {
      case 'calendrier': return _tCalendrier();
      case 'en_attente': return _tFiltered(['planifiee', 'affectee'], 'En attente');
      case 'en_cours':   return _tFiltered(['en_cours'],  'En cours');
      case 'terminees':  return _tFiltered(['terminee'],  'Terminées');
      case 'retards':    return _tFiltered(['en_retard'], 'En retard');
      case 'stats':      return _tStats();
      default:           return _tToutes();
    }
  }

  // ── TAB: TOUTES ──
  function _tToutes() {
    const cu     = MX.state.currentUser;
    const canAll = _canAll();
    let list = canAll
      ? [..._interventions]
      : _interventions.filter(iv => (iv.assignedTo || []).includes(cu?.name));

    if (_filterStatus) list = list.filter(iv => _effStatus(iv) === _filterStatus);
    if (_filterPrio)   list = list.filter(iv => iv.priority === _filterPrio);
    if (_filterTech)   list = list.filter(iv => (iv.assignedTo || []).includes(_filterTech));

    const techOpts = canAll && _users.length
      ? `<select class="int-filter-sel" onchange="MX.Pages.Int._setFilter('tech',this.value)">
           <option value="">Tous techniciens</option>
           ${_users.filter(u => u.role === 'technicien').map(u =>
             `<option value="${esc(u.name)}"${_filterTech === u.name ? ' selected' : ''}>${esc(u.name)}</option>`
           ).join('')}
         </select>`
      : '';

    let html = `<div class="int-inner">
      <div class="int-toolbar">
        <span class="int-count">${list.length} intervention${list.length !== 1 ? 's' : ''}</span>
        <div class="int-toolbar-filters">
          ${techOpts}
          <select class="int-filter-sel" onchange="MX.Pages.Int._setFilter('status',this.value)">
            <option value="">Tous statuts</option>
            ${Object.entries(STATUS).map(([k, s]) =>
              `<option value="${k}"${_filterStatus === k ? ' selected' : ''}>${s.l}</option>`
            ).join('')}
          </select>
          <select class="int-filter-sel" onchange="MX.Pages.Int._setFilter('prio',this.value)">
            <option value="">Toutes priorités</option>
            ${Object.entries(PRIO).map(([k, p]) =>
              `<option value="${k}"${_filterPrio === k ? ' selected' : ''}>${p.l}</option>`
            ).join('')}
          </select>
        </div>
      </div>`;

    if (!list.length) {
      html += _emptyState('fa-screwdriver-wrench',
        'Aucune intervention',
        canAll ? 'Créez votre première intervention.' : 'Aucune intervention ne vous est affectée.',
        canAll ? `<button class="int-btn-primary" onclick="MX.Pages.Int._newInt()"><i class="fas fa-plus"></i> Nouvelle intervention</button>` : ''
      );
    } else {
      list.forEach(iv => { html += _intCard(iv); });
    }
    return html + '</div>';
  }

  // ── TAB: FILTERED ──
  function _tFiltered(statuses, title) {
    const cu     = MX.state.currentUser;
    const canAll = _canAll();
    const list = canAll
      ? _interventions.filter(iv => statuses.includes(_effStatus(iv)))
      : _interventions.filter(iv => statuses.includes(_effStatus(iv)) && (iv.assignedTo || []).includes(cu?.name));

    let html = `<div class="int-inner">
      <div class="int-sec-ttl">${esc(title)} <span class="int-sec-count">${list.length}</span></div>`;

    if (!list.length) {
      html += _emptyState('fa-circle-check', 'Aucune intervention dans cette catégorie', '');
    } else {
      list.forEach(iv => { html += _intCard(iv); });
    }
    return html + '</div>';
  }

  // ── INTERVENTION CARD ──
  function _intCard(iv) {
    const st  = _effStatus(iv);
    const sm  = STATUS[st] || STATUS.planifiee;
    const canAll = _canAll();
    const cu     = MX.state.currentUser;
    const isMine = (iv.assignedTo || []).includes(cu?.name);
    const pendingXfr = _transfers.find(t => t.interventionId === iv.id && t.toTech === cu?.name);

    let acts = '';
    if ((canAll || isMine) && (st === 'planifiee' || st === 'affectee' || st === 'en_retard')) {
      acts += `<button class="int-act-btn int-act-btn--blue" onclick="event.stopPropagation();MX.Pages.Int._startInt('${iv.id}')"><i class="fas fa-play"></i><span class="int-act-txt"> Démarrer</span></button>`;
    }
    if ((canAll || isMine) && st === 'en_cours') {
      acts += `<button class="int-act-btn int-act-btn--green" onclick="event.stopPropagation();MX.Pages.Int._closeInt('${iv.id}')"><i class="fas fa-check"></i><span class="int-act-txt"> Clôturer</span></button>`;
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

    return `<div class="int-card" onclick="MX.Pages.Int._viewInt('${iv.id}')" style="border-left:4px solid ${sm.col}">
      <div class="int-card-top">
        <div class="int-card-title">${esc(iv.title)}</div>
        <div class="int-card-badges">
          ${_statusBadge(iv)}
          ${_prioBadge(iv.priority)}
        </div>
      </div>
      <div class="int-card-meta">
        ${iv.location ? `<span><i class="fas fa-location-dot"></i> ${esc(iv.location)}</span>` : ''}
        <span><i class="fas fa-calendar"></i> ${_dtFmt(iv.startDate, iv.startTime)}</span>
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
        const sm  = STATUS[st] || STATUS.planifiee;
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
      const sm  = STATUS[st] || STATUS.planifiee;
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
          const sm = STATUS[st] || STATUS.planifiee;
          return `<div class="int-cal-cell-ev" style="background:${sm.bg};border-left:2px solid ${sm.col};color:${sm.col}"
            onclick="event.stopPropagation();MX.Pages.Int._viewInt('${iv.id}')">${esc(iv.title)}</div>`;
        }).join('')}
        ${overflow > 0 ? `<div class="int-cal-cell-more">+${overflow}</div>` : ''}
      </div>`;
    }
    h += `</div></div>`;
    return h;
  }

  // ── TAB: STATS ──
  function _tStats() {
    const total    = _interventions.length;
    const byStatus = {};
    Object.keys(STATUS).forEach(k => {
      byStatus[k] = _interventions.filter(iv => _effStatus(iv) === k).length;
    });
    const done     = _interventions.filter(iv => iv.status === 'terminee' && iv.timeSpentMin);
    const avgMin   = done.length ? Math.round(done.reduce((s, iv) => s + (iv.timeSpentMin || 0), 0) / done.length) : null;
    const byTech   = {};
    _interventions.forEach(iv => {
      (iv.assignedTo || []).forEach(n => { byTech[n] = (byTech[n] || 0) + 1; });
    });
    const topTechs = Object.entries(byTech).sort((a, b) => b[1] - a[1]).slice(0, 8);

    let html = `<div class="int-inner">
      <div class="int-stats-grid">
        <div class="int-stat-card">
          <div class="int-stat-v">${total}</div>
          <div class="int-stat-l">Total</div>
        </div>
        ${Object.entries(STATUS).map(([k, s]) => `
          <div class="int-stat-card" style="border-top:3px solid ${s.col}">
            <div class="int-stat-v" style="color:${s.col}">${byStatus[k] || 0}</div>
            <div class="int-stat-l">${s.l}</div>
          </div>`).join('')}
        ${avgMin !== null ? `<div class="int-stat-card">
          <div class="int-stat-v">${avgMin < 60 ? avgMin + 'min' : (Math.round(avgMin / 60 * 10) / 10) + 'h'}</div>
          <div class="int-stat-l">Temps moyen</div>
        </div>` : ''}
      </div>`;

    if (topTechs.length) {
      const maxVal = topTechs[0][1];
      html += `<div class="int-sec-ttl" style="margin-top:20px">Répartition par technicien</div>
        <div class="int-tech-bars">`;
      topTechs.forEach(([name, count]) => {
        const u   = _users.find(u => u.name === name);
        const col = u?.color || '#7C3AED';
        html += `<div class="int-tech-bar-row">
          <div class="int-tech-bar-name">${esc(name)}</div>
          <div class="int-tech-bar-track">
            <div class="int-tech-bar-fill" style="width:${Math.round(count / maxVal * 100)}%;background:${col}"></div>
          </div>
          <span class="int-tech-bar-val">${count}</span>
        </div>`;
      });
      html += `</div>`;
    }
    return html + '</div>';
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
            <span class="int-avatar" style="background:${u.color || '#7C3AED'}">${initials}</span>
            ${esc(u.name)}
          </button>`;
        }).join('')}
      </div>`;
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
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="int-form-date-col">
            <div class="int-form-label">Début</div>
            <input type="date" id="int-f-sd" class="fi" value="${ds}">
            <input type="time" id="int-f-st" class="fi" value="${ts}">
          </div>
          <div class="int-form-date-col">
            <div class="int-form-label">Fin prévue</div>
            <input type="date" id="int-f-ed" class="fi" value="${ds}">
            <input type="time" id="int-f-et" class="fi" value="${et}">
          </div>
        </div>
        ${_canAll() ? _techPicker([]) : ''}
        ${_intPhotoHtml(null)}
      </div>`,
      actions: [
        { label: 'Créer', cls: 'confirm', fn: async () => {
          const title = document.getElementById('int-f-title')?.value?.trim();
          if (!title) { MX.toast('Le titre est requis', true); return; }
          const assigned = [..._pickerSel];
          const data = {
            title,
            description: document.getElementById('int-f-desc')?.value?.trim() || '',
            location:    document.getElementById('int-f-loc')?.value?.trim() || '',
            priority:    document.getElementById('int-f-prio')?.value || 'normale',
            status:      assigned.length ? 'affectee' : 'planifiee',
            startDate:   document.getElementById('int-f-sd')?.value || today,
            startTime:   document.getElementById('int-f-st')?.value || '09:00',
            endDate:     document.getElementById('int-f-ed')?.value || today,
            endTime:     document.getElementById('int-f-et')?.value || '10:00',
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
          ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${iv.status === k ? ' selected' : ''}>${s.l}</option>`).join('')}
        </select>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="int-form-date-col">
            <div class="int-form-label">Début</div>
            <input type="date" id="int-f-sd" class="fi" value="${iv.startDate || ''}">
            <input type="time" id="int-f-st" class="fi" value="${iv.startTime || ''}">
          </div>
          <div class="int-form-date-col">
            <div class="int-form-label">Fin prévue</div>
            <input type="date" id="int-f-ed" class="fi" value="${iv.endDate || ''}">
            <input type="time" id="int-f-et" class="fi" value="${iv.endTime || ''}">
          </div>
        </div>
        ${_techPicker(iv.assignedTo)}
        ${_intPhotoHtml(iv.photo || null)}
      </div>`,
      actions: [
        { label: 'Enregistrer', cls: 'confirm', fn: async () => {
          const title = document.getElementById('int-f-title')?.value?.trim();
          if (!title) { MX.toast('Titre requis', true); return; }
          const assigned   = [..._pickerSel];
          const newTechs   = assigned.filter(t => !(iv.assignedTo || []).includes(t));
          const newStatus  = document.getElementById('int-f-status')?.value || iv.status;
          const data = {
            title,
            description: document.getElementById('int-f-desc')?.value?.trim() || '',
            location:    document.getElementById('int-f-loc')?.value?.trim() || '',
            priority:    document.getElementById('int-f-prio')?.value || iv.priority,
            status:      newStatus,
            startDate:   document.getElementById('int-f-sd')?.value || iv.startDate,
            startTime:   document.getElementById('int-f-st')?.value || iv.startTime,
            endDate:     document.getElementById('int-f-ed')?.value || iv.endDate,
            endTime:     document.getElementById('int-f-et')?.value || iv.endTime,
            assignedTo:  assigned,
            photo:       _intPhotoB64 !== null ? _intPhotoB64 : (iv.photo || null),
            updatedAt:   FV.serverTimestamp(),
          };
          try {
            await DB.int().doc(id).update(data);
            newTechs.forEach(n => _notifyTech(n, data.title, data.startDate, data.startTime, data.location, data.priority));
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
    const sm     = STATUS[st] || STATUS.planifiee;
    const pr     = PRIO[iv.priority] || PRIO.normale;
    const canAll = _canAll();
    const cu     = MX.state.currentUser;
    const isMine = (iv.assignedTo || []).includes(cu?.name);
    const createdD = _tsDate(iv.createdAt);

    const acts = [];
    if (canAll) acts.push({ label: '✏️ Modifier', cls: 'confirm', fn: () => _editInt(id) });
    if ((canAll || isMine) && (st === 'planifiee' || st === 'affectee' || st === 'en_retard')) {
      acts.push({ label: '▶ Démarrer', cls: 'confirm', fn: () => _startInt(id) });
    }
    if ((canAll || isMine) && st === 'en_cours') {
      acts.push({ label: '✓ Clôturer', cls: 'confirm', fn: () => _closeInt(id) });
    }
    acts.push({ label: 'Fermer', cls: 'cancel' });

    MX.showModal({
      title: `${esc(iv.title)}`,
      sub: `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${_statusBadge(iv)} ${_prioBadge(iv.priority)}</div>`,
      body: `<div class="int-view-body">
        ${iv.description ? `<div class="int-view-desc">${esc(iv.description)}</div>` : ''}
        ${iv.location ? `<div class="int-view-row"><i class="fas fa-location-dot"></i> ${esc(iv.location)}</div>` : ''}
        <div class="int-view-dates">
          <div class="int-view-date-blk">
            <div class="int-view-date-lbl">Début</div>
            <div class="int-view-date-val">${_dtFmt(iv.startDate, iv.startTime)}</div>
          </div>
          <div class="int-view-date-blk">
            <div class="int-view-date-lbl">Fin prévue</div>
            <div class="int-view-date-val">${iv.endDate ? _dtFmt(iv.endDate, iv.endTime) : '—'}</div>
          </div>
        </div>
        <div class="int-view-techs">
          <div class="int-form-label">Techniciens</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${_techAvatars(iv.assignedTo)}</div>
        </div>
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

  function _startInt(id) {
    MX.showModal({
      title: '▶ Démarrer l\'intervention',
      sub: 'Elle sera marquée "En cours".',
      body: '',
      actions: [
        { label: 'Démarrer', cls: 'confirm', fn: async () => {
          try {
            await DB.int().doc(id).update({ status: 'en_cours', updatedAt: FV.serverTimestamp() });
            MX.toast('Intervention démarrée');
          } catch(e) { MX.toast('Erreur', true); }
        }},
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  function _closeInt(id) {
    const iv = _interventions.find(x => x.id === id);
    MX.showModal({
      title: '✅ Clôturer l\'intervention',
      sub: esc(iv?.title || ''),
      body: `<div class="int-form">
        <textarea id="int-close-notes" class="fi" placeholder="Rapport de clôture (optionnel)" rows="4" style="resize:vertical"></textarea>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:13px;color:var(--text2)">Temps passé :</label>
          <input type="number" id="int-close-time" class="fi" min="0" max="9999" placeholder="minutes" style="width:100px;text-align:center">
        </div>
      </div>`,
      actions: [
        { label: '✓ Clôturer', cls: 'confirm', fn: async () => {
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
            MX.toast('Intervention clôturée ✓');
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
      title: 'Supprimer l\'intervention',
      sub: `Supprimer définitivement "${esc(iv?.title || '')}" ?`,
      body: '',
      actions: [
        { label: 'Supprimer', cls: 'danger', fn: async () => {
          try {
            await DB.int().doc(id).delete();
            MX.toast('Intervention supprimée');
          } catch(e) { MX.toast('Erreur', true); }
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
  window.MX.Pages.Int = {
    render, _tab,
    _newInt, _editInt, _viewInt, _startInt, _closeInt, _cancelInt, _delInt,
    _transferInt, _acceptXfr, _refuseXfr,
    _setFilter, _toggleTech, _onIntPhoto,
    _calPrev, _calNext, _calToday, _calSetView, _calDayClick,
  };
})();
