(function () {
  let _planUploading = false;

  async function _compressImage(file) {
    const MAX_PX = 1400, QUALITY = 0.80;
    return new Promise(function(resolve) {
      var timer = setTimeout(function() { resolve(file); }, 12000);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w <= MAX_PX && h <= MAX_PX && file.size < 400000) { clearTimeout(timer); resolve(file); return; }
        var scale = Math.min(1, MAX_PX / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) { clearTimeout(timer); resolve(blob || file); }, "image/jpeg", QUALITY);
      };
      img.onerror = function() { clearTimeout(timer); resolve(file); };
      img.src = url;
    });
  }

  async function uploadPlan(input) {
    if (_planUploading) return;
    const file = input.files[0];
    if (!file) return;
    _planUploading = true;
    MX.toast("Compression…");
    try {
      const compressed = await _compressImage(file);
      MX.toast("Upload en cours…");
      const imageUrl = await MX.DB.uploadPlanningImage(compressed);
      await MX.DB.savePlanning(imageUrl);
      MX.toast("Planning mis à jour ✓");
    } catch(e) {
      console.error(e);
      MX.toast("Erreur lors de l'upload", true);
    } finally {
      _planUploading = false;
      input.value = "";
    }
  }

  function clearPlan() {
    MX.showModal("Supprimer le planning ?", "L'image sera supprimée pour tous.", [
      { label: "Supprimer", cls: "danger", fn: async function() {
        try { await MX.DB.clearPlanning(); MX.toast("Planning supprimé"); }
        catch(e) { MX.toast("Erreur suppression", true); }
      }},
      { label: "Annuler", cls: "cancel" }
    ]);
  }

  function openPlan() {
    const url = MX.state.planningUrl;
    if (url) window.open(url, "_blank");
  }

  function _svgDonut(done, total) {
    const R = 34, CX = 50, CY = 50;
    const C = 2 * Math.PI * R;
    const pct   = total ? Math.min(1, done / total) : 0;
    const dashD  = pct * C;
    const dashR  = C - dashD;
    const pctTxt = Math.round(pct * 100);
    return `<svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--bg4)" stroke-width="10"/>
      ${total > 0 ? `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--cyan)" stroke-width="10"
        stroke-dasharray="${dashD.toFixed(1)} ${dashR.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 ${CX} ${CY})"
        style="filter:drop-shadow(0 0 4px rgba(0,245,212,0.4))"/>` : ''}
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)" font-family="var(--ffm)">${pctTxt}</text>
      <text x="${CX}" y="${CY + 11}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="var(--ffm)">%</text>
    </svg>`;
  }

  function render() {
    const { state, DAYS, getDaySlots, esc, todayId } = MX;
    const el = document.getElementById("main-content");

    // ── Date ──
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    const [ty, tm, td] = todayISO.split('-');
    const dateFr = `${td}/${tm}/${ty}`;
    const DAY_NAMES = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const dayFr = DAY_NAMES[now.getDay()];
    const hr = now.getHours();
    const greeting = hr < 12 ? 'Bonjour' : hr < 18 ? 'Bon après-midi' : 'Bonsoir';

    // ── User/role ──
    const currentUser = state.currentUser;
    const displayName = currentUser ? (currentUser.name || 'Utilisateur') : 'Utilisateur';
    const firstName = displayName.split(/[\s@]/)[0];
    const isAdmin = MX.Auth && MX.Auth.isAdmin && MX.Auth.isAdmin();
    const isResp  = MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll();
    const hotelName = (state.hotelConfig && (state.hotelConfig.commercialName || state.hotelConfig.name)) || 'Mon Hôtel';
    const weekLabel = state.weekLabel || (MX.mkWeekLabel ? MX.mkWeekLabel() : '');

    // ── KPI: Tâches ──
    let totalAll = 0, doneAll = 0;
    DAYS.forEach(d => {
      getDaySlots(d.id).forEach(sl => {
        (state.tasks[`${d.id}_${sl}`] || []).forEach(t => {
          totalAll++;
          if (state.checks[`${d.id}_${sl}_${t.id}`]) doneAll++;
        });
      });
    });
    const pctTasks = totalAll ? Math.round(doneAll / totalAll * 100) : 0;
    const pctColor = pctTasks >= 80 ? 'var(--green)' : pctTasks >= 50 ? 'var(--orange)' : 'var(--red)';

    // ── KPI: Interventions (admin missions: { text, done: boolean, priority, deadline }) ──
    const missions = (state.missions || []).filter(m => m && m.id && (m.text || m.title));
    const mOpen      = missions.filter(m => !m.done).length;
    const mInProg    = missions.filter(m => !m.done && m.assignedTo && m.assignedTo !== 'all');
    const mLate      = missions.filter(m => {
      if (m.done) return false;
      return m.deadline && m.deadline < todayISO;
    });
    const mUrgent    = missions.filter(m => m.priority === 'urgent' && !m.done);
    const mDoneToday = missions.filter(m => {
      if (!m.done) return false;
      const raw = m.doneAt || m.completedAt || m.ts;
      if (!raw) return false;
      const d2 = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      return d2.toISOString().slice(0, 10) === todayISO;
    });

    // ── KPI: Stock ──
    const lowProds = (state.products || []).filter(p => parseInt(p.qty || 0) < parseInt(p.minQty || 0));

    // ── KPI: Consommations ──
    const Conso = MX.Pages && MX.Pages.Conso;
    let csoData = null, cliToday = 0, efToday = 0, ecToday = 0;
    if (Conso) {
      Conso._load();
      csoData = Conso._getCsoState();
      cliToday = (csoData.clients && csoData.clients[todayISO]) || 0;
      const _csoSum = function(type, date) {
        const ids = (csoData.meters || []).filter(m => m.type === type).map(m => m.id);
        return (csoData.readings || []).filter(r => ids.includes(r.meterId) && r.date === date)
          .reduce((s, r) => s + (r.consumption || 0), 0);
      };
      efToday = _csoSum('eau_froide', todayISO);
      ecToday = _csoSum('eau_chaude', todayISO);
    }

    // ── Alertes ──
    const urgentAnns = (state.announcements || [])
      .filter(a => a.pinned || a.type === 'urgent' || a.type === 'important')
      .sort((a, b) => { const w = x => x.type === 'urgent' ? 3 : x.pinned ? 2 : 1; return w(b) - w(a); })
      .slice(0, 4);
    const hasAlerts = urgentAnns.length > 0 || mLate.length > 0 || lowProds.length > 0;

    // ── Activité récente (feed enrichi) ──
    const _tval = x => x ? (typeof x.toDate === 'function' ? x.toDate().getTime() : new Date(x).getTime()) : 0;
    const twoDaysAgo = new Date(now); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const feed = [];
    (state.messages || []).slice(0, 8).forEach(m => {
      feed.push({ type:'msg', name: m.authorName || m.author || 'Utilisateur', action:'a publié', what: m.content || m.text || 'un message', at: m.createdAt, icon:'fas fa-comment', color:'var(--jour)' });
    });
    missions.forEach(m => {
      if (!m.done) return;
      const raw = m.doneAt || m.completedAt || m.ts;
      if (!raw) return;
      const dt = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      if (dt < twoDaysAgo) return;
      const who = Array.isArray(m.assignedTo) ? m.assignedTo[0] : (m.assignedTo || m.createdBy || 'Technicien');
      feed.push({ type:'mission', name: who, action:'a clôturé', what: m.text || m.title || 'une intervention', at: raw, icon:'fas fa-check-circle', color:'var(--green)' });
    });
    missions.forEach(m => {
      if (m.done || !m.assignedTo || m.assignedTo === 'all') return;
      const raw = m.updatedAt || m.createdAt || m.ts;
      if (!raw) return;
      const dt = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      if (dt < twoDaysAgo) return;
      const who = Array.isArray(m.assignedTo) ? m.assignedTo[0] : m.assignedTo;
      feed.push({ type:'mission_prog', name: who, action:'a pris en charge', what: m.text || m.title || 'une intervention', at: raw, icon:'fas fa-spinner', color:'var(--jour)' });
    });
    feed.sort((a, b) => _tval(b.at) - _tval(a.at));
    const recentFeed = feed.slice(0, 10);

    // ── Helpers ──
    const _f = n => (n === null || n === undefined || isNaN(n)) ? '—' : n.toFixed(2).replace('.', ',');
    const msgCount = (state.messages || []).length;

    // ── BUILD HTML ──
    let h = `<div class="ph">
      <div class="ph-eye">ACCUEIL</div>
      <div class="ph-row">
        <div>
          <div class="ph-title">${esc(hotelName)}</div>
          <div class="ph-sub">${esc(weekLabel)}</div>
        </div>
      </div>
    </div>
    <div class="page-body home-cockpit">`;

    // ── HEADER CARD ──
    h += `<div class="home-header-card hc-header">
      <div class="home-header-left">
        <div class="home-header-greeting">${greeting}, ${esc(firstName)} 👋</div>
        <div class="home-header-sub">${dayFr} ${dateFr} · ${esc(weekLabel)}</div>
        ${isAdmin ? `<div class="home-hotel-selector" onclick="MX.showAdminTab('superadmin')">
          <i class="fas fa-hotel"></i> ${esc(hotelName)} <i class="fas fa-chevron-down" style="font-size:9px"></i>
        </div>` : ''}
      </div>
      <div class="home-header-right">
        <div class="home-header-kpi">
          <span class="home-header-kpi-n" style="color:${pctColor}">${pctTasks}%</span>
          <span class="home-header-kpi-l">avancement</span>
        </div>
        ${mLate.length > 0 ? `<div class="home-header-badge home-badge-danger">${mLate.length} retard${mLate.length > 1 ? 's' : ''}</div>` : ''}
        ${lowProds.length > 0 ? `<div class="home-header-badge home-badge-warn">${lowProds.length} stock</div>` : ''}
      </div>
    </div>`;

    // ── AUJOURD'HUI — Synthèse ──
    const todaySlots = getDaySlots(todayId());
    let clTotal = 0, clDone = 0;
    todaySlots.forEach(function(sl) {
      (state.tasks[todayId() + '_' + sl] || []).forEach(function(t) {
        clTotal++;
        if (state.checks[todayId() + '_' + sl + '_' + t.id]) clDone++;
      });
    });
    const clLate        = clTotal > 0 && clDone < clTotal;
    const mUrgentCount  = mUrgent.length;
    const notifUnread   = (state.notifications || []).filter(function(n) { return !n.read; }).length;
    if (mUrgentCount > 0 || clLate || mLate.length > 0 || lowProds.length > 0 || notifUnread > 0) {
      h += '<div class="hc-today-strip">';
      if (mUrgentCount > 0) h += '<button class="hcs-pill hcs-pill--red" onclick="MX.showPage(\'interventions\')">'
        + '<i class="fas fa-circle-exclamation"></i> ' + mUrgentCount + ' mission' + (mUrgentCount > 1 ? 's' : '') + ' urgente' + (mUrgentCount > 1 ? 's' : '') + '</button>';
      if (clLate) h += '<button class="hcs-pill hcs-pill--orange" onclick="MX.showPage(\'checklists\')">'
        + '<i class="fas fa-square-check"></i> ' + (clTotal - clDone) + ' tâche' + (clTotal - clDone > 1 ? 's' : '') + ' restante' + (clTotal - clDone > 1 ? 's' : '') + '</button>';
      if (mLate.length > 0) h += '<button class="hcs-pill hcs-pill--yellow" onclick="MX.showPage(\'interventions\')">'
        + '<i class="fas fa-clock"></i> ' + mLate.length + ' en retard</button>';
      if (lowProds.length > 0) h += '<button class="hcs-pill hcs-pill--blue" onclick="MX.showPage(\'orders\')">'
        + '<i class="fas fa-box-open"></i> ' + lowProds.length + ' stock critique</button>';
      if (notifUnread > 0) h += '<button class="hcs-pill hcs-pill--purple" onclick="MX.showPage(\'notifs\')">'
        + '<i class="fas fa-bell"></i> ' + notifUnread + ' notification' + (notifUnread > 1 ? 's' : '') + '</button>';
      h += '</div>';
    }

    // ── KPI CARDS ──
    const efFmt = efToday > 0 ? efToday.toFixed(2).replace('.', ',') : '—';
    h += `<div class="hc-kpis">
      <div class="home-kpi-grid">
        <div class="home-kpi-card" onclick="MX.showPage('checklists')">
          <div class="home-kpi-icon" style="background:var(--green-dim);color:var(--green)"><i class="fas fa-check-circle"></i></div>
          <div class="home-kpi-value" style="color:var(--green)">${doneAll}<span class="home-kpi-total">/${totalAll}</span></div>
          <div class="home-kpi-label">Tâches faites</div>
          <div class="home-kpi-sub">${pctTasks}% cette semaine</div>
        </div>
        <div class="home-kpi-card" onclick="MX.showPage('interventions')">
          <div class="home-kpi-icon" style="background:var(--jour-dim);color:var(--jour)"><i class="fas fa-wrench"></i></div>
          <div class="home-kpi-value" style="color:var(--jour)">${mOpen}</div>
          <div class="home-kpi-label">Interventions</div>
          <div class="home-kpi-sub">${mInProg.length} en cours</div>
        </div>
        <div class="home-kpi-card${mLate.length > 0 ? ' home-kpi-card--alert' : ''}" onclick="MX.showPage('interventions')">
          <div class="home-kpi-icon" style="background:${mLate.length > 0 ? 'var(--red-dim)' : 'var(--green-dim)'};color:${mLate.length > 0 ? 'var(--red)' : 'var(--green)'}"><i class="fas fa-clock"></i></div>
          <div class="home-kpi-value" style="color:${mLate.length > 0 ? 'var(--red)' : 'var(--green)'}">${mLate.length}</div>
          <div class="home-kpi-label">En retard</div>
          <div class="home-kpi-sub">${mLate.length === 0 ? 'Tout à jour' : 'Action requise'}</div>
        </div>
        <div class="home-kpi-card${lowProds.length > 0 ? ' home-kpi-card--warn' : ''}" onclick="MX.showPage('orders')">
          <div class="home-kpi-icon" style="background:${lowProds.length > 0 ? 'var(--orange-dim)' : 'var(--green-dim)'};color:${lowProds.length > 0 ? 'var(--orange)' : 'var(--green)'}"><i class="fas fa-box-open"></i></div>
          <div class="home-kpi-value" style="color:${lowProds.length > 0 ? 'var(--orange)' : 'var(--green)'}">${lowProds.length}</div>
          <div class="home-kpi-label">Stock critique</div>
          <div class="home-kpi-sub">${lowProds.length === 0 ? 'Stock OK' : 'À commander'}</div>
        </div>
        <div class="home-kpi-card" onclick="MX.showPage('consommations')">
          <div class="home-kpi-icon" style="background:rgba(59,130,246,0.12);color:#3B82F6"><i class="fas fa-droplet"></i></div>
          <div class="home-kpi-value" style="color:#3B82F6">${efFmt}${efToday > 0 ? '<span class="home-kpi-unit"> m³</span>' : ''}</div>
          <div class="home-kpi-label">Eau froide</div>
          <div class="home-kpi-sub">${efToday > 0 ? dateFr : 'Aucun relevé'}</div>
        </div>
        <div class="home-kpi-card" onclick="MX.showPage('consommations')">
          <div class="home-kpi-icon" style="background:rgba(249,115,22,0.12);color:#F97316"><i class="fas fa-fire-flame-curved"></i></div>
          <div class="home-kpi-value" style="color:#F97316">${ecToday > 0 ? ecToday.toFixed(2).replace('.', ',') : '—'}${ecToday > 0 ? '<span class="home-kpi-unit"> m³</span>' : ''}</div>
          <div class="home-kpi-label">Eau chaude</div>
          <div class="home-kpi-sub">${ecToday > 0 ? dateFr : 'Aucun relevé'}</div>
        </div>
        <div class="home-kpi-card" onclick="MX.Pages.Conso && MX.Pages.Conso._editCli('${todayISO}',${cliToday})">
          <div class="home-kpi-icon" style="background:var(--cyan-dim);color:var(--cyan)"><i class="fas fa-users"></i></div>
          <div class="home-kpi-value" style="color:var(--cyan)">${cliToday || '—'}</div>
          <div class="home-kpi-label">Clients présents</div>
          <div class="home-kpi-sub">${cliToday > 0 ? dateFr : 'Non saisi'}</div>
        </div>
      </div>
    </div>`;

    // ── SECTION CONSOMMATIONS ──
    h += `<div class="hc-conso">
      <div class="home-section-head">
        <div class="home-section-title"><i class="fas fa-droplet" style="color:#3B82F6"></i> Consommations</div>
        <button class="home-section-btn" onclick="window._csoStartTab='releves';MX.showPage('consommations')"><i class="fas fa-camera"></i> Relevé</button>
      </div>`;

    if (!Conso || !csoData || !csoData.loaded) {
      h += `<div class="home-state-box"><i class="fas fa-spinner fa-spin"></i> Chargement…</div>`;
    } else if (!csoData.meters || !csoData.meters.length) {
      h += `<div class="home-state-box" onclick="MX.showPage('consommations')" style="cursor:pointer">
        <div style="font-size:24px;margin-bottom:6px">💧</div>
        <div style="font-size:13px;font-weight:600">Aucun compteur configuré</div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px">Appuyez pour configurer</div>
      </div>`;
    } else {
      const yestISO = (() => { const d2 = new Date(now); d2.setDate(d2.getDate() - 1); return d2.toISOString().slice(0, 10); })();
      const _cs = function(type, date) {
        const ids = csoData.meters.filter(m => m.type === type).map(m => m.id);
        return csoData.readings.filter(r => ids.includes(r.meterId) && r.date === date).reduce((s, r) => s + (r.consumption || 0), 0);
      };
      const efY   = _cs('eau_froide', yestISO);
      const ecY   = _cs('eau_chaude', yestISO);
      const efIdx = (() => { const ids = csoData.meters.filter(m => m.type === 'eau_froide').map(m => m.id); const r = csoData.readings.find(r2 => ids.includes(r2.meterId) && r2.date === todayISO); return r ? r.index : null; })();
      const ecIdx = (() => { const ids = csoData.meters.filter(m => m.type === 'eau_chaude').map(m => m.id); const r = csoData.readings.find(r2 => ids.includes(r2.meterId) && r2.date === todayISO); return r ? r.index : null; })();

      const efEvo = efToday > 0 && efY > 0 ? efToday - efY : null;
      const ecEvo = ecToday > 0 && ecY > 0 ? ecToday - ecY : null;
      const _evoStr = v => v === null ? '' : `<span style="color:${v > 0 ? 'var(--red)' : 'var(--green)'}">${v > 0 ? '▲' : '▼'} ${_f(Math.abs(v))} m³</span>`;

      h += `<div class="home-cso-grid">
        <div class="home-cso-meter" onclick="MX.showPage('consommations')">
          <div class="home-cso-meter-head"><span>💧</span><span class="home-cso-meter-label" style="color:#3B82F6">Eau froide</span></div>
          <div class="home-cso-meter-val">${efIdx !== null ? _f(efIdx) : '—'}<span class="home-cso-meter-unit">${efIdx !== null ? ' m³' : ''}</span></div>
          <div class="home-cso-meter-rows">
            <div class="home-cso-meter-row"><span>Auj.</span><span style="color:#3B82F6;font-weight:700">${efToday > 0 ? _f(efToday) + ' m³' : '—'}</span></div>
            <div class="home-cso-meter-row"><span>Hier</span><span>${efY > 0 ? _f(efY) + ' m³' : '—'}</span></div>
            ${efEvo !== null ? `<div class="home-cso-meter-row"><span>Évolution</span>${_evoStr(efEvo)}</div>` : ''}
          </div>
        </div>
        <div class="home-cso-meter" onclick="MX.showPage('consommations')">
          <div class="home-cso-meter-head"><span>🔥</span><span class="home-cso-meter-label" style="color:#F97316">Eau chaude</span></div>
          <div class="home-cso-meter-val">${ecIdx !== null ? _f(ecIdx) : '—'}<span class="home-cso-meter-unit">${ecIdx !== null ? ' m³' : ''}</span></div>
          <div class="home-cso-meter-rows">
            <div class="home-cso-meter-row"><span>Auj.</span><span style="color:#F97316;font-weight:700">${ecToday > 0 ? _f(ecToday) + ' m³' : '—'}</span></div>
            <div class="home-cso-meter-row"><span>Hier</span><span>${ecY > 0 ? _f(ecY) + ' m³' : '—'}</span></div>
            ${ecEvo !== null ? `<div class="home-cso-meter-row"><span>Évolution</span>${_evoStr(ecEvo)}</div>` : ''}
          </div>
        </div>
        <div class="home-cso-meter" onclick="MX.Pages.Conso && MX.Pages.Conso._editCli('${todayISO}',${cliToday})">
          <div class="home-cso-meter-head"><span>👥</span><span class="home-cso-meter-label" style="color:var(--cyan)">Clients</span></div>
          <div class="home-cso-meter-val" style="color:${cliToday > 0 ? 'var(--text)' : 'var(--text3)'}">${cliToday || '—'}</div>
          <div class="home-cso-meter-rows">
            <div class="home-cso-meter-row"><span style="color:var(--cyan);font-size:10px"><i class="fas fa-pen"></i> ${cliToday > 0 ? 'Modifier' : 'Saisir'}</span><span></span></div>
          </div>
        </div>
      </div>`;
    }
    h += `</div>`;

    // ── SECTION ACTIVITÉ RÉCENTE ──
    h += `<div class="hc-activity">
      <div class="home-section-head">
        <div class="home-section-title"><i class="fas fa-bolt" style="color:var(--cyan)"></i> Activité récente</div>
        <button class="home-section-btn" onclick="MX.showPage('msgs')">Tout voir</button>
      </div>`;

    if (!recentFeed.length) {
      h += `<div class="home-state-box"><i class="fas fa-comment-slash"></i> Aucune activité récente</div>`;
    } else {
      h += `<div class="home-activity-list">`;
      recentFeed.forEach(item => {
        const initials = item.name.slice(0, 2).toUpperCase();
        const what = item.what.length > 55 ? item.what.slice(0, 55) + '…' : item.what;
        const avatarBg = item.type === 'mission' ? 'rgba(74,222,128,0.15)' : item.type === 'mission_prog' ? 'rgba(251,191,36,0.15)' : 'rgba(99,102,241,0.15)';
        h += `<div class="home-activity-item" onclick="MX.showPage('msgs')">
          <div class="home-activity-avatar" style="background:${avatarBg};color:${item.color}">${esc(initials)}</div>
          <div class="home-activity-body">
            <div class="home-activity-author"><strong>${esc(item.name)}</strong> <span class="home-activity-verb">${esc(item.action)}</span></div>
            <div class="home-activity-text"><i class="${item.icon}" style="color:${item.color};font-size:10px;margin-right:4px"></i>${esc(what)}</div>
            <div class="home-activity-time">${MX.fmtTime(item.at)}</div>
          </div>
        </div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;

    // ── SECTION ALERTES (always rendered) ──
    h += `<div class="hc-alerts">
      <div class="home-section-head">
        <div class="home-section-title"><i class="fas fa-triangle-exclamation" style="color:var(--orange)"></i> Alertes</div>
      </div>`;

    if (!hasAlerts) {
      h += `<div class="home-state-box" style="color:var(--green)">
        <i class="fas fa-check-circle" style="font-size:22px;margin-bottom:5px;color:var(--green)"></i>
        <div style="font-weight:600;font-size:13px">Aucune alerte active</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">Tout est nominal</div>
      </div>`;
    } else {
      const _ANN = { urgent: { icon: '🚨', cls: 'danger' }, important: { icon: '⚠️', cls: 'warn' }, info: { icon: '📢', cls: '' }, suggestion: { icon: '💡', cls: '' }, technique: { icon: '🔧', cls: '' } };
      h += `<div class="home-alerts-list">`;
      if (mLate.length > 0) {
        h += `<div class="home-alert-item home-alert-item--danger" onclick="MX.showPage('interventions')">
          <div class="home-alert-ico"><i class="fas fa-clock"></i></div>
          <div class="home-alert-body">
            <div class="home-alert-title">${mLate.length} intervention${mLate.length > 1 ? 's' : ''} en retard</div>
            <div class="home-alert-sub">Nécessite une action immédiate</div>
          </div>
          <i class="fas fa-chevron-right home-alert-arrow"></i>
        </div>`;
      }
      if (lowProds.length > 0) {
        const prodNames = lowProds.slice(0, 2).map(p => esc(p.name)).join(', ');
        h += `<div class="home-alert-item home-alert-item--warn" onclick="MX.showPage('orders')">
          <div class="home-alert-ico"><i class="fas fa-box-open"></i></div>
          <div class="home-alert-body">
            <div class="home-alert-title">${lowProds.length} produit${lowProds.length > 1 ? 's' : ''} à commander</div>
            <div class="home-alert-sub">${prodNames}${lowProds.length > 2 ? ` +${lowProds.length - 2} autres` : ''}</div>
          </div>
          <i class="fas fa-chevron-right home-alert-arrow"></i>
        </div>`;
      }
      urgentAnns.forEach(a => {
        const at = _ANN[a.type] || _ANN.info;
        const txt = a.content ? a.content.slice(0, 70) + (a.content.length > 70 ? '…' : '') : '';
        h += `<div class="home-alert-item${at.cls ? ' home-alert-item--' + at.cls : ''}" onclick="MX.showPage('msgs')">
          <div class="home-alert-ico">${at.icon}</div>
          <div class="home-alert-body">
            <div class="home-alert-title">${a.pinned ? '📌 ' : ''}${esc(txt)}</div>
            <div class="home-alert-sub">${esc(a.authorName || '')} · ${MX.fmtTime(a.createdAt)}</div>
          </div>
          <i class="fas fa-chevron-right home-alert-arrow"></i>
        </div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;

    // ── SECTION INTERVENTIONS (admin/resp only) ──
    if (isResp || isAdmin) {
      h += `<div class="hc-interventions">
        <div class="home-section-head">
          <div class="home-section-title"><i class="fas fa-wrench" style="color:var(--accent-int)"></i> Interventions</div>
          <button class="home-section-btn" onclick="MX.showPage('interventions')">Tout voir</button>
        </div>`;

      if (!missions.length) {
        h += `<div class="home-state-box" style="color:var(--green)">
          <i class="fas fa-circle-check" style="font-size:22px;margin-bottom:6px;color:var(--green)"></i>
          <div style="font-weight:600;font-size:13px">Aucune intervention active</div>
          <div style="font-size:11px;color:var(--text2);margin-top:3px">Toutes les demandes sont traitées</div>
        </div>`;
      } else {
        h += `<div class="home-int-grid">
          <div class="home-int-stat${mUrgent.length > 0 ? ' home-int-stat--alert' : ''}" onclick="MX.showPage('interventions')">
            <div class="home-int-stat-ico" style="color:var(--red)"><i class="fas fa-fire"></i></div>
            <div class="home-int-stat-n" style="color:var(--red)">${mUrgent.length}</div>
            <div class="home-int-stat-l">Urgentes</div>
          </div>
          <div class="home-int-stat${mLate.length > 0 ? ' home-int-stat--alert' : ''}" onclick="MX.showPage('interventions')">
            <div class="home-int-stat-ico" style="color:var(--orange)"><i class="fas fa-clock"></i></div>
            <div class="home-int-stat-n" style="color:var(--orange)">${mLate.length}</div>
            <div class="home-int-stat-l">En retard</div>
          </div>
          <div class="home-int-stat" onclick="MX.showPage('interventions')">
            <div class="home-int-stat-ico" style="color:var(--jour)"><i class="fas fa-spinner"></i></div>
            <div class="home-int-stat-n" style="color:var(--jour)">${mInProg.length}</div>
            <div class="home-int-stat-l">En cours</div>
          </div>
          <div class="home-int-stat" onclick="MX.showPage('interventions')">
            <div class="home-int-stat-ico" style="color:var(--green)"><i class="fas fa-check"></i></div>
            <div class="home-int-stat-n" style="color:var(--green)">${mDoneToday.length}</div>
            <div class="home-int-stat-l">Réalisées auj.</div>
          </div>
        </div>`;

        const recentMissions = missions
          .filter(m => m.status !== 'done' && m.status !== 'annule')
          .sort((a, b) => { const pw = x => x.priority === 'urgent' ? 3 : x.priority === 'haute' ? 2 : 1; return pw(b) - pw(a); })
          .slice(0, 4);

        if (recentMissions.length) {
          h += `<div class="home-int-list">`;
          recentMissions.forEach(m => {
            const isLate = m.deadline && m.deadline < todayISO;
            const dotColor = (isLate || m.priority === 'urgent') ? 'var(--red)' : m.priority === 'haute' ? 'var(--orange)' : 'var(--text3)';
            const statusLbl = m.status === 'en_cours' ? 'En cours' : (m.status === 'pending' || m.status === 'en_attente') ? 'En attente' : esc(m.status || '');
            const statusColor = m.status === 'en_cours' ? 'var(--jour)' : isLate ? 'var(--red)' : 'var(--text3)';
            h += `<div class="home-int-item" onclick="MX.showPage('interventions')">
              <div class="home-int-item-left">
                <div class="home-int-item-dot" style="background:${dotColor}"></div>
                <div style="min-width:0">
                  <div class="home-int-item-title">${esc(m.title || m.description || 'Intervention')}</div>
                  <div class="home-int-item-sub">${esc(m.location || m.room || '')}${m.deadline ? ' · ' + m.deadline : ''}</div>
                </div>
              </div>
              <div class="home-int-item-status" style="color:${statusColor}">${statusLbl}</div>
            </div>`;
          });
          h += `</div>`;
        }
      }
      h += `</div>`;

      // ── SECTION STOCK ──
      h += `<div class="hc-stock">
        <div class="home-section-head">
          <div class="home-section-title"><i class="fas fa-boxes-stacked" style="color:var(--accent-res)"></i> Ressources &amp; Stock</div>
          <button class="home-section-btn" onclick="MX.showPage('orders')">Gérer</button>
        </div>`;

      if (!lowProds.length) {
        h += `<div class="home-state-box" style="color:var(--green)">
          <i class="fas fa-circle-check" style="font-size:22px;margin-bottom:6px;color:var(--green)"></i>
          <div style="font-weight:600;font-size:13px">Stock opérationnel</div>
          <div style="font-size:11px;color:var(--text2);margin-top:3px">Aucun produit critique</div>
        </div>`;
      } else {
        h += `<div class="home-stock-list">`;
        lowProds.slice(0, 6).forEach(p => {
          const qty = parseInt(p.qty || 0);
          const min = parseInt(p.minQty || 0);
          const pctB = min > 0 ? Math.min(100, Math.round(qty / min * 100)) : 0;
          const critColor = pctB < 30 ? 'var(--red)' : 'var(--orange)';
          h += `<div class="home-stock-item" onclick="MX.showPage('orders')">
            <div class="home-stock-name">${esc(p.name)}</div>
            <div class="home-stock-bar-wrap">
              <div class="home-stock-bar"><div class="home-stock-fill" style="width:${pctB}%;background:${critColor}"></div></div>
              <span class="home-stock-val" style="color:${critColor}">${qty}/${min}</span>
            </div>
          </div>`;
        });
        if (lowProds.length > 6) h += `<div style="text-align:center;font-size:11px;color:var(--text3);padding:8px 0">+${lowProds.length - 6} autres produits critiques</div>`;
        h += `</div>`;
      }
      h += `</div>`;
    }

    // ── SECTION COMMUNICATIONS ──
    h += `<div class="hc-comms">
      <div class="home-section-head">
        <div class="home-section-title"><i class="fas fa-comments" style="color:var(--accent-msgs)"></i> Communications</div>
      </div>
      <div class="home-comms-grid">
        <div class="home-comms-card" onclick="MX.showPage('msgs')">
          <div class="home-comms-ico" style="background:var(--jour-dim);color:var(--jour)"><i class="fas fa-comments"></i></div>
          <div class="home-comms-body">
            <div class="home-comms-title">Messages</div>
            <div class="home-comms-sub">${msgCount} message${msgCount !== 1 ? 's' : ''}</div>
          </div>
          <i class="fas fa-chevron-right" style="color:var(--text3);font-size:12px;flex-shrink:0"></i>
        </div>
        <div class="home-comms-card" onclick="MX.showPage('planning')">
          <div class="home-comms-ico" style="background:rgba(67,56,202,0.15);color:#818CF8"><i class="fas fa-calendar-days"></i></div>
          <div class="home-comms-body">
            <div class="home-comms-title">Planning</div>
            <div class="home-comms-sub">Horaires de l'équipe</div>
          </div>
          <i class="fas fa-chevron-right" style="color:var(--text3);font-size:12px;flex-shrink:0"></i>
        </div>
      </div>
    </div>`;

    h += `</div>`; // end .page-body.home-cockpit
    el.innerHTML = h;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Home = { render, uploadPlan, clearPlan, openPlan };
})();
