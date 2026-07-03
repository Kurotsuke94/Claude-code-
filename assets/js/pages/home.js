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
    var R = 34, CX = 50, CY = 50;
    var C = 2 * Math.PI * R;
    var pct   = total ? Math.min(1, done / total) : 0;
    var dashD = pct * C;
    var dashR = C - dashD;
    var pctTxt = Math.round(pct * 100);
    return '<svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--bg4)" stroke-width="10"/>' +
      (total > 0 ? '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--cyan)" stroke-width="10"' +
        ' stroke-dasharray="' + dashD.toFixed(1) + ' ' + dashR.toFixed(1) + '"' +
        ' stroke-linecap="round" transform="rotate(-90 ' + CX + ' ' + CY + ')"' +
        ' style="filter:drop-shadow(0 0 4px rgba(139,92,246,0.4))"/>' : '') +
      '<text x="' + CX + '" y="' + (CY - 4) + '" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)" font-family="var(--ffm)">' + pctTxt + '</text>' +
      '<text x="' + CX + '" y="' + (CY + 11) + '" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="var(--ffm)">%</text>' +
      '</svg>';
  }

  function _scoreRing(score, size) {
    var R = 38, CX = 50, CY = 50;
    var C = 2 * Math.PI * R;
    var pct = Math.min(1, Math.max(0, score / 100));
    var dashD = (pct * C).toFixed(1);
    var dashR = ((1 - pct) * C).toFixed(1);
    var color = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--orange)' : 'var(--red)';
    var glow  = score >= 80 ? 'rgba(34,197,94,0.4)' : score >= 60 ? 'rgba(249,115,22,0.4)' : 'rgba(239,68,68,0.4)';
    return '<svg viewBox="0 0 100 100" width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="var(--bg4)" stroke-width="10"/>' +
      '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" stroke="' + color + '" stroke-width="10"' +
      ' stroke-dasharray="' + dashD + ' ' + dashR + '"' +
      ' stroke-linecap="round" transform="rotate(-90 ' + CX + ' ' + CY + ')"' +
      ' style="filter:drop-shadow(0 0 6px ' + glow + ')"/>' +
      '<text x="' + CX + '" y="' + (CY - 3) + '" text-anchor="middle" font-size="20" font-weight="800" fill="' + color + '" font-family="var(--ffm)">' + Math.round(score) + '</text>' +
      '<text x="' + CX + '" y="' + (CY + 13) + '" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="var(--ffs)">/100</text>' +
      '</svg>';
  }

  function _evoSpan(v, fmtAbs) {
    if (v === null || v === undefined) return '';
    var col   = v > 0 ? 'var(--red)' : 'var(--green)';
    var arrow = v > 0 ? '▲' : '▼';
    return '<span style="color:' + col + ';font-size:10px">' + arrow + ' ' + fmtAbs + '</span>';
  }

  function render() {
    var state     = MX.state;
    var DAYS      = MX.DAYS;
    var getDaySlots = MX.getDaySlots;
    var esc       = MX.esc;
    var todayId   = MX.todayId;
    var el        = document.getElementById("main-content");

    // ── Date & time ──
    var now      = new Date();
    var todayISO = now.toISOString().slice(0, 10);
    var parts    = todayISO.split('-');
    var dateFr   = parts[2] + '/' + parts[1] + '/' + parts[0];
    var DAY_NAMES = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    var dayFr    = DAY_NAMES[now.getDay()];
    var hr       = now.getHours();
    var greeting = hr < 12 ? 'Bonjour' : hr < 18 ? 'Bon après-midi' : 'Bonsoir';

    // ── User ──
    var currentUser = state.currentUser;
    var displayName = currentUser ? (currentUser.name || 'Utilisateur') : 'Utilisateur';
    var firstName   = displayName.split(/[\s@]/)[0];
    var isAdmin = MX.Auth && MX.Auth.isAdmin && MX.Auth.isAdmin();
    var isResp  = MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll();
    var weekLabel = state.weekLabel || (MX.mkWeekLabel ? MX.mkWeekLabel() : '');

    // ── KPI: Tasks (week) ──
    var totalAll = 0, doneAll = 0;
    DAYS.forEach(function(d) {
      getDaySlots(d.id).forEach(function(sl) {
        (state.tasks[d.id + '_' + sl] || []).forEach(function(t) {
          totalAll++;
          if (state.checks[d.id + '_' + sl + '_' + t.id]) doneAll++;
        });
      });
    });
    var pctTasks = totalAll ? Math.round(doneAll / totalAll * 100) : 0;

    // ── KPI: Today tasks ──
    var tid = todayId();
    var todaySlots = getDaySlots(tid);
    var clTotal = 0, clDone = 0;
    todaySlots.forEach(function(sl) {
      (state.tasks[tid + '_' + sl] || []).forEach(function(t) {
        clTotal++;
        if (state.checks[tid + '_' + sl + '_' + t.id]) clDone++;
      });
    });

    // ── KPI: Missions ──
    var missions = (state.missions || []).filter(function(m) { return m && m.id && (m.text || m.title); });
    var mOpen    = missions.filter(function(m) { return !m.done; }).length;
    var mInProg  = missions.filter(function(m) { return !m.done && m.assignedTo && m.assignedTo !== 'all'; });
    var mLate    = missions.filter(function(m) {
      if (m.done) return false;
      return m.deadline && m.deadline < todayISO;
    });
    var mUrgent  = missions.filter(function(m) { return m.priority === 'urgent' && !m.done; });
    var mDoneToday = missions.filter(function(m) {
      if (!m.done) return false;
      var raw = m.doneAt || m.completedAt || m.ts;
      if (!raw) return false;
      var d2 = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      return d2.toISOString().slice(0, 10) === todayISO;
    });

    // ── KPI: Stock ──
    var lowProds = (state.products || []).filter(function(p) { return parseInt(p.qty || 0) < parseInt(p.minQty || 0); });

    // ── KPI: Conso ──
    var Conso = MX.Pages && MX.Pages.Conso;
    var csoData = null, cliToday = 0, efToday = 0, ecToday = 0;
    if (Conso) {
      Conso._load();
      csoData = Conso._getCsoState();
      cliToday = (csoData.clients && csoData.clients[todayISO]) || 0;
      var _csoSum = function(type, date) {
        var ids = (csoData.meters || []).filter(function(m) { return m.type === type; }).map(function(m) { return m.id; });
        return (csoData.readings || []).filter(function(r) { return ids.indexOf(r.meterId) >= 0 && r.date === date; })
          .reduce(function(s, r) { return s + (r.consumption || 0); }, 0);
      };
      efToday = _csoSum('eau_froide', todayISO);
      ecToday = _csoSum('eau_chaude', todayISO);
    }

    // ── Conso yesterday (evo) ──
    var efY = 0, ecY = 0;
    if (csoData && csoData.meters && csoData.readings) {
      var yestD = new Date(now); yestD.setDate(yestD.getDate() - 1);
      var yestISO = yestD.toISOString().slice(0, 10);
      var _cs = function(type, date) {
        var ids = csoData.meters.filter(function(m) { return m.type === type; }).map(function(m) { return m.id; });
        return csoData.readings.filter(function(r) { return ids.indexOf(r.meterId) >= 0 && r.date === date; })
          .reduce(function(s, r) { return s + (r.consumption || 0); }, 0);
      };
      efY = _cs('eau_froide', yestISO);
      ecY = _cs('eau_chaude', yestISO);
    }
    var efEvo = (efToday > 0 && efY > 0) ? efToday - efY : null;
    var ecEvo = (ecToday > 0 && ecY > 0) ? ecToday - ecY : null;

    // ── Alerts ──
    var urgentAnns = (state.announcements || [])
      .filter(function(a) { return a.pinned || a.type === 'urgent' || a.type === 'important'; })
      .sort(function(a, b) { var w = function(x) { return x.type === 'urgent' ? 3 : x.pinned ? 2 : 1; }; return w(b) - w(a); })
      .slice(0, 4);
    var hasAlerts   = urgentAnns.length > 0 || mLate.length > 0 || lowProds.length > 0;
    var notifUnread = (state.notifications || []).filter(function(n) { return !n.read; }).length;

    // ── PMP ──
    var Pmp      = MX.Pages && MX.Pages.PMP;
    var pmpStats = Pmp ? Pmp.getStats() : null;

    // ── Hotel score ──
    var scoreTask  = totalAll > 0 ? (doneAll / totalAll) * 40 : 40;
    var scoreInt   = mLate.length === 0 && mUrgent.length === 0 ? 30 : Math.max(0, 30 - mLate.length * 6 - mUrgent.length * 4);
    var scorePmp   = pmpStats ? (pmpStats.conformite / 100) * 20 : 20;
    var scoreStock = lowProds.length === 0 ? 10 : Math.max(0, 10 - lowProds.length * 2);
    var hotelScore = Math.round(scoreTask + scoreInt + scorePmp + scoreStock);
    var scoreColor = hotelScore >= 80 ? 'var(--green)' : hotelScore >= 60 ? 'var(--orange)' : 'var(--red)';

    // ── Activity feed ──
    var _tval = function(x) { return x ? (typeof x.toDate === 'function' ? x.toDate().getTime() : new Date(x).getTime()) : 0; };
    var twoDaysAgo = new Date(now); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    var feed = [];
    (state.messages || []).slice(0, 8).forEach(function(m) {
      feed.push({ type:'msg', name: m.authorName || m.author || 'Utilisateur', action:'a publié', what: m.content || m.text || 'un message', at: m.createdAt, icon:'fas fa-comment', color:'var(--jour)' });
    });
    missions.forEach(function(m) {
      if (!m.done) return;
      var raw = m.doneAt || m.completedAt || m.ts;
      if (!raw) return;
      var dt = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      if (dt < twoDaysAgo) return;
      var who = Array.isArray(m.assignedTo) ? m.assignedTo[0] : (m.assignedTo || m.createdBy || 'Technicien');
      feed.push({ type:'mission', name: who, action:'a clôturé', what: m.text || m.title || 'une intervention', at: raw, icon:'fas fa-check-circle', color:'var(--green)' });
    });
    missions.forEach(function(m) {
      if (m.done || !m.assignedTo || m.assignedTo === 'all') return;
      var raw = m.updatedAt || m.createdAt || m.ts;
      if (!raw) return;
      var dt = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
      if (dt < twoDaysAgo) return;
      var who = Array.isArray(m.assignedTo) ? m.assignedTo[0] : m.assignedTo;
      feed.push({ type:'mission_prog', name: who, action:'a pris en charge', what: m.text || m.title || 'une intervention', at: raw, icon:'fas fa-spinner', color:'var(--jour)' });
    });
    feed.sort(function(a, b) { return _tval(b.at) - _tval(a.at); });
    var recentFeed = feed.slice(0, 10);

    // ── Daily claims (team) ──
    var claims     = state.dailyClaims || {};
    var claimMatin = claims.matin   ? (claims.matin.name   || claims.matin.lockedBy   || '') : '';
    var claimJour  = claims.journee ? (claims.journee.name || claims.journee.lockedBy  || '') : '';
    var claimSoir  = claims.soir    ? (claims.soir.name    || claims.soir.lockedBy    || '') : '';

    // ── Slot stats for today ──
    var SLOT_INFO = [
      { key: 'matin',   label: 'Matin',   color: 'var(--matin)', icon: 'fas fa-sun' },
      { key: 'journee', label: 'Journée', color: 'var(--jour)',  icon: 'fas fa-cloud-sun' },
      { key: 'soir',    label: 'Soir',    color: 'var(--soir)',  icon: 'fas fa-moon' }
    ];
    var slotStats = SLOT_INFO.map(function(si) {
      var tasks2 = state.tasks[tid + '_' + si.key] || [];
      var done2  = tasks2.filter(function(t) { return state.checks[tid + '_' + si.key + '_' + t.id]; }).length;
      return { key: si.key, label: si.label, color: si.color, icon: si.icon, total: tasks2.length, done: done2 };
    });

    // ── Day progress ──
    var dayPct     = Math.min(100, Math.round(((hr * 60 + now.getMinutes()) / (24 * 60)) * 100));
    var currentSlot = hr < 12 ? 'Matin' : hr < 17 ? 'Journée' : 'Soir';

    // ── Misc ──
    var _f = function(n) { return (n === null || n === undefined || isNaN(n)) ? '—' : n.toFixed(2).replace('.', ','); };
    var mUrgentCount = mUrgent.length;
    var clLate = clTotal > 0 && clDone < clTotal;
    var msgCount = (state.messages || []).length;

    // ════════════════════════════════════════
    // BUILD HTML
    // ════════════════════════════════════════
    var h = '<div class="page-body hc2-page">';

    // ── HEADER BAR ──
    h += '<div class="hc2-header">' +
      '<div class="hc2-header-greet">' +
        '<div class="hc2-greeting">' + greeting + ', <strong>' + esc(firstName) + '</strong></div>' +
        '<div class="hc2-header-date">' + dayFr + ' ' + dateFr + ' · ' + esc(weekLabel) + '</div>' +
      '</div>' +
      '<div class="hc2-header-progress">' +
        '<div class="hc2-day-label"><i class="fas fa-clock" style="color:var(--cyan)"></i> ' + currentSlot + ' · ' + dayPct + '% de la journée</div>' +
        '<div class="hc2-day-bar"><div class="hc2-day-fill" style="width:' + dayPct + '%"></div></div>' +
        '<div class="hc2-day-slots">' +
          '<span class="hc2-ds' + (hr < 12 ? ' hc2-ds--active' : '') + '">Matin</span>' +
          '<span class="hc2-ds' + (hr >= 12 && hr < 17 ? ' hc2-ds--active' : '') + '">Journée</span>' +
          '<span class="hc2-ds' + (hr >= 17 ? ' hc2-ds--active' : '') + '">Soir</span>' +
        '</div>' +
      '</div>' +
      '<div class="hc2-header-minikpis">' +
        '<div class="hc2-mkpi" onclick="MX.showPage(\'checklists\')">' +
          '<div class="hc2-mkpi-v" style="color:' + (pctTasks >= 80 ? 'var(--green)' : pctTasks >= 50 ? 'var(--orange)' : 'var(--red)') + '">' + pctTasks + '<span class="hc2-mkpi-unit">%</span></div>' +
          '<div class="hc2-mkpi-l">Tâches</div>' +
        '</div>' +
        '<div class="hc2-mkpi hc2-mkpi--divider" onclick="MX.showPage(\'interventions\')">' +
          '<div class="hc2-mkpi-v" style="color:' + (mLate.length > 0 ? 'var(--red)' : 'var(--text)') + '">' + mOpen + '</div>' +
          '<div class="hc2-mkpi-l">Missions</div>' +
        '</div>' +
        '<div class="hc2-mkpi hc2-mkpi--divider" onclick="MX.showPage(\'orders\')">' +
          '<div class="hc2-mkpi-v" style="color:' + (lowProds.length > 0 ? 'var(--orange)' : 'var(--green)') + '">' + lowProds.length + '</div>' +
          '<div class="hc2-mkpi-l">Stock</div>' +
        '</div>' +
        '<div class="hc2-mkpi hc2-mkpi--divider" onclick="MX.Pages.Conso && MX.Pages.Conso._editCli(\'' + todayISO + '\',' + cliToday + ')">' +
          '<div class="hc2-mkpi-v" style="color:var(--cyan)">' + (cliToday || '—') + '</div>' +
          '<div class="hc2-mkpi-l">Clients</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // ── ALERT STRIP ──
    if (mUrgentCount > 0 || clLate || mLate.length > 0 || lowProds.length > 0 || notifUnread > 0) {
      h += '<div class="hc2-strip">';
      if (mUrgentCount > 0) h += '<button class="hcs-pill hcs-pill--red" onclick="MX.showPage(\'interventions\')">' +
        '<i class="fas fa-circle-exclamation"></i> ' + mUrgentCount + ' mission' + (mUrgentCount > 1 ? 's urgentes' : ' urgente') + '</button>';
      if (clLate) h += '<button class="hcs-pill hcs-pill--orange" onclick="MX.showPage(\'checklists\')">' +
        '<i class="fas fa-square-check"></i> ' + (clTotal - clDone) + ' tâche' + (clTotal - clDone > 1 ? 's' : '') + ' restante' + (clTotal - clDone > 1 ? 's' : '') + '</button>';
      if (mLate.length > 0) h += '<button class="hcs-pill hcs-pill--yellow" onclick="MX.showPage(\'interventions\')">' +
        '<i class="fas fa-clock"></i> ' + mLate.length + ' en retard</button>';
      if (lowProds.length > 0) h += '<button class="hcs-pill hcs-pill--blue" onclick="MX.showPage(\'orders\')">' +
        '<i class="fas fa-box-open"></i> ' + lowProds.length + ' stock critique</button>';
      if (notifUnread > 0) h += '<button class="hcs-pill hcs-pill--purple" onclick="MX.showPage(\'notifs\')">' +
        '<i class="fas fa-bell"></i> ' + notifUnread + ' notification' + (notifUnread > 1 ? 's' : '') + '</button>';
      h += '</div>';
    }

    // ── KPI ROW ──
    var taskColor = pctTasks >= 80 ? 'var(--green)' : pctTasks >= 50 ? 'var(--orange)' : 'var(--red)';
    h += '<div class="hc2-kpis">';
    // Score hôtel
    h += '<div class="hc2-kpi" style="cursor:default">' +
      '<div class="hc2-kpi-ico" style="background:' + (hotelScore >= 80 ? 'var(--green-dim)' : hotelScore >= 60 ? 'var(--orange-dim)' : 'var(--red-dim)') + ';color:' + scoreColor + '"><i class="fas fa-hotel"></i></div>' +
      '<div class="hc2-kpi-val" style="color:' + scoreColor + '">' + hotelScore + '<span class="hc2-kpi-unit">/100</span></div>' +
      '<div class="hc2-kpi-lbl">Score hôtel</div>' +
    '</div>';
    // Tâches
    h += '<div class="hc2-kpi" onclick="MX.showPage(\'checklists\')">' +
      '<div class="hc2-kpi-ico" style="background:var(--green-dim);color:var(--green)"><i class="fas fa-check-circle"></i></div>' +
      '<div class="hc2-kpi-val" style="color:' + taskColor + '">' + doneAll + '<span class="hc2-kpi-unit">/' + totalAll + '</span></div>' +
      '<div class="hc2-kpi-lbl">Tâches faites</div>' +
    '</div>';
    // Interventions ouvertes
    h += '<div class="hc2-kpi" onclick="MX.showPage(\'interventions\')">' +
      '<div class="hc2-kpi-ico" style="background:var(--jour-dim);color:var(--jour)"><i class="fas fa-wrench"></i></div>' +
      '<div class="hc2-kpi-val" style="color:var(--jour)">' + mOpen + '</div>' +
      '<div class="hc2-kpi-lbl">Missions ouvertes</div>' +
    '</div>';
    // Retards
    h += '<div class="hc2-kpi' + (mLate.length > 0 ? ' hc2-kpi--alert' : '') + '" onclick="MX.showPage(\'interventions\')">' +
      '<div class="hc2-kpi-ico" style="background:' + (mLate.length > 0 ? 'var(--red-dim)' : 'var(--green-dim)') + ';color:' + (mLate.length > 0 ? 'var(--red)' : 'var(--green)') + '"><i class="fas fa-clock"></i></div>' +
      '<div class="hc2-kpi-val" style="color:' + (mLate.length > 0 ? 'var(--red)' : 'var(--green)') + '">' + mLate.length + '</div>' +
      '<div class="hc2-kpi-lbl">En retard</div>' +
    '</div>';
    // Stock
    h += '<div class="hc2-kpi' + (lowProds.length > 0 ? ' hc2-kpi--warn' : '') + '" onclick="MX.showPage(\'orders\')">' +
      '<div class="hc2-kpi-ico" style="background:' + (lowProds.length > 0 ? 'var(--orange-dim)' : 'var(--green-dim)') + ';color:' + (lowProds.length > 0 ? 'var(--orange)' : 'var(--green)') + '"><i class="fas fa-box-open"></i></div>' +
      '<div class="hc2-kpi-val" style="color:' + (lowProds.length > 0 ? 'var(--orange)' : 'var(--green)') + '">' + lowProds.length + '</div>' +
      '<div class="hc2-kpi-lbl">Stock critique</div>' +
    '</div>';
    // Clients
    h += '<div class="hc2-kpi" onclick="MX.Pages.Conso && MX.Pages.Conso._editCli(\'' + todayISO + '\',' + cliToday + ')">' +
      '<div class="hc2-kpi-ico" style="background:var(--cyan-dim);color:var(--cyan)"><i class="fas fa-users"></i></div>' +
      '<div class="hc2-kpi-val" style="color:var(--cyan)">' + (cliToday || '—') + '</div>' +
      '<div class="hc2-kpi-lbl">Clients présents</div>' +
    '</div>';
    // Eau froide
    h += '<div class="hc2-kpi" onclick="MX.showPage(\'consommations\')">' +
      '<div class="hc2-kpi-ico" style="background:rgba(59,130,246,0.12);color:#3B82F6"><i class="fas fa-droplet"></i></div>' +
      '<div class="hc2-kpi-val" style="color:#3B82F6">' + (efToday > 0 ? _f(efToday) : '—') + (efToday > 0 ? '<span class="hc2-kpi-unit"> m³</span>' : '') + '</div>' +
      '<div class="hc2-kpi-lbl">Eau froide</div>' +
    '</div>';
    h += '</div>'; // end .hc2-kpis

    // ── MAIN BODY (two columns) ──
    h += '<div class="hc2-body">';

    // ══ LEFT COLUMN ══
    h += '<div class="hc2-col-l">';

    // Score card
    h += '<div class="hc2-card hc2-score-card">' +
      '<div class="hc2-card-head"><span><i class="fas fa-gauge-high" style="color:' + scoreColor + '"></i> Score hôtel</span><span class="hc2-card-sub">Cette semaine</span></div>' +
      '<div class="hc2-score-body">' +
        '<div class="hc2-score-ring">' + _scoreRing(hotelScore, 108) + '</div>' +
        '<div class="hc2-score-breakdown">' +
          '<div class="hc2-sb-row">' +
            '<span class="hc2-sb-lbl"><i class="fas fa-check"></i> Tâches</span>' +
            '<div class="hc2-sb-bar"><div class="hc2-sb-fill" style="width:' + Math.round(scoreTask / 40 * 100) + '%;background:var(--green)"></div></div>' +
            '<span class="hc2-sb-val">' + Math.round(scoreTask) + '/40</span>' +
          '</div>' +
          '<div class="hc2-sb-row">' +
            '<span class="hc2-sb-lbl"><i class="fas fa-wrench"></i> Missions</span>' +
            '<div class="hc2-sb-bar"><div class="hc2-sb-fill" style="width:' + Math.round(scoreInt / 30 * 100) + '%;background:var(--jour)"></div></div>' +
            '<span class="hc2-sb-val">' + Math.round(scoreInt) + '/30</span>' +
          '</div>' +
          '<div class="hc2-sb-row">' +
            '<span class="hc2-sb-lbl"><i class="fas fa-screwdriver-wrench"></i> PMP</span>' +
            '<div class="hc2-sb-bar"><div class="hc2-sb-fill" style="width:' + Math.round(scorePmp / 20 * 100) + '%;background:var(--orange)"></div></div>' +
            '<span class="hc2-sb-val">' + Math.round(scorePmp) + '/20</span>' +
          '</div>' +
          '<div class="hc2-sb-row">' +
            '<span class="hc2-sb-lbl"><i class="fas fa-box-open"></i> Stock</span>' +
            '<div class="hc2-sb-bar"><div class="hc2-sb-fill" style="width:' + Math.round(scoreStock / 10 * 100) + '%;background:var(--cyan)"></div></div>' +
            '<span class="hc2-sb-val">' + Math.round(scoreStock) + '/10</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Today timeline
    h += '<div class="hc2-card hc2-timeline-card">' +
      '<div class="hc2-card-head"><span><i class="fas fa-calendar-day" style="color:var(--cyan)"></i> Aujourd\'hui</span><span class="hc2-card-sub">' + dateFr + '</span></div>' +
      '<div class="hc2-timeline-slots">';
    slotStats.forEach(function(ss) {
      var pct2  = ss.total ? Math.round(ss.done / ss.total * 100) : 0;
      var sCol  = (ss.done === ss.total && ss.total > 0) ? 'var(--green)' : ss.total > 0 ? ss.color : 'var(--text3)';
      h += '<div class="hc2-tslot' + (ss.total === 0 ? ' hc2-tslot--empty' : '') + '">' +
        '<div class="hc2-tslot-head">' +
          '<div class="hc2-tslot-icon" style="color:' + ss.color + '"><i class="' + ss.icon + '"></i></div>' +
          '<div class="hc2-tslot-lbl">' + ss.label + '</div>' +
          '<div class="hc2-tslot-count" style="color:' + sCol + '">' + ss.done + '/' + ss.total + '</div>' +
        '</div>' +
        '<div class="hc2-tslot-bar"><div class="hc2-tslot-fill" style="width:' + pct2 + '%;background:' + ss.color + '"></div></div>' +
      '</div>';
    });
    h += '</div></div>';

    // Team card
    h += '<div class="hc2-card hc2-team-card">' +
      '<div class="hc2-card-head"><span><i class="fas fa-users-gear" style="color:var(--soir)"></i> Équipe du jour</span>' +
        '<button class="hc2-card-btn" onclick="MX.showPage(\'planning\')"><i class="fas fa-calendar-days"></i> Planning</button>' +
      '</div>' +
      '<div class="hc2-team-slots">';
    [
      { label: 'Matin',   color: 'var(--matin)', name: claimMatin },
      { label: 'Journée', color: 'var(--jour)',  name: claimJour  },
      { label: 'Soir',    color: 'var(--soir)',  name: claimSoir  }
    ].forEach(function(sl) {
      h += '<div class="hc2-trow">' +
        '<div class="hc2-trow-dot" style="background:' + sl.color + '"></div>' +
        '<div class="hc2-trow-lbl">' + sl.label + '</div>' +
        '<div class="hc2-trow-name' + (sl.name ? '' : ' hc2-trow-empty') + '">' + (sl.name ? esc(sl.name) : 'Non assigné') + '</div>' +
      '</div>';
    });
    h += '</div></div>';

    h += '</div>'; // end .hc2-col-l

    // ══ RIGHT COLUMN ══
    h += '<div class="hc2-col-r">';

    // Interventions (admin/resp)
    if (isResp || isAdmin) {
      h += '<div class="hc2-card hc2-int-card">' +
        '<div class="hc2-card-head"><span><i class="fas fa-wrench" style="color:var(--accent-int)"></i> Interventions</span>' +
          '<button class="hc2-card-btn" onclick="MX.showPage(\'interventions\')">Tout voir</button>' +
        '</div>';
      if (!missions.length) {
        h += '<div class="hc2-empty-state"><i class="fas fa-circle-check" style="color:var(--green)"></i><span>Aucune intervention active</span></div>';
      } else {
        h += '<div class="hc2-int-stats">' +
          '<div class="hc2-is" onclick="MX.showPage(\'interventions\')">' +
            '<div class="hc2-is-v" style="color:var(--red)">' + mUrgent.length + '</div><div class="hc2-is-l">Urgentes</div>' +
          '</div>' +
          '<div class="hc2-is" onclick="MX.showPage(\'interventions\')">' +
            '<div class="hc2-is-v" style="color:var(--orange)">' + mLate.length + '</div><div class="hc2-is-l">Retards</div>' +
          '</div>' +
          '<div class="hc2-is" onclick="MX.showPage(\'interventions\')">' +
            '<div class="hc2-is-v" style="color:var(--jour)">' + mInProg.length + '</div><div class="hc2-is-l">En cours</div>' +
          '</div>' +
          '<div class="hc2-is" onclick="MX.showPage(\'interventions\')">' +
            '<div class="hc2-is-v" style="color:var(--green)">' + mDoneToday.length + '</div><div class="hc2-is-l">Auj. faites</div>' +
          '</div>' +
        '</div>';
        var topMissions = missions
          .filter(function(m) { return !m.done; })
          .sort(function(a, b) { var pw = function(x) { return x.priority === 'urgent' ? 3 : x.priority === 'haute' ? 2 : 1; }; return pw(b) - pw(a); })
          .slice(0, 3);
        if (topMissions.length) {
          h += '<div class="hc2-int-list">';
          topMissions.forEach(function(m) {
            var isLate2 = m.deadline && m.deadline < todayISO;
            var dotCol  = (isLate2 || m.priority === 'urgent') ? 'var(--red)' : m.priority === 'haute' ? 'var(--orange)' : 'var(--text3)';
            h += '<div class="hc2-int-item" onclick="MX.showPage(\'interventions\')">' +
              '<div class="hc2-int-dot" style="background:' + dotCol + '"></div>' +
              '<div class="hc2-int-body">' +
                '<div class="hc2-int-title">' + esc((m.title || m.description || 'Intervention').slice(0, 45)) + '</div>' +
                ((m.deadline || m.location) ? '<div class="hc2-int-sub">' + esc(m.location || '') + (m.deadline ? ' · ' + m.deadline : '') + '</div>' : '') +
              '</div>' +
              '<i class="fas fa-chevron-right" style="color:var(--text3);font-size:10px;flex-shrink:0"></i>' +
            '</div>';
          });
          h += '</div>';
        }
      }
      h += '</div>'; // end hc2-int-card
    }

    // Conso card
    h += '<div class="hc2-card hc2-conso-card">' +
      '<div class="hc2-card-head"><span><i class="fas fa-droplet" style="color:#3B82F6"></i> Consommations</span>' +
        '<button class="hc2-card-btn" onclick="window._csoStartTab=\'releves\';MX.showPage(\'consommations\')"><i class="fas fa-camera"></i> Relevé</button>' +
      '</div>';
    if (!Conso || !csoData || !csoData.loaded) {
      h += '<div class="hc2-empty-state"><i class="fas fa-spinner fa-spin"></i><span>Chargement…</span></div>';
    } else if (!csoData.meters || !csoData.meters.length) {
      h += '<div class="hc2-empty-state" onclick="MX.showPage(\'consommations\')" style="cursor:pointer"><i class="fas fa-droplet" style="opacity:0.3"></i><span>Aucun compteur configuré</span></div>';
    } else {
      h += '<div class="hc2-conso-meters">';
      h += '<div class="hc2-cmeter" onclick="MX.showPage(\'consommations\')">' +
        '<div class="hc2-cmeter-head"><span class="hc2-cmeter-ico" style="color:#3B82F6"><i class="fas fa-droplet"></i></span><span class="hc2-cmeter-name">Eau froide</span>' +
        (efEvo !== null ? _evoSpan(efEvo, _f(Math.abs(efEvo)) + ' m³') : '') + '</div>' +
        '<div class="hc2-cmeter-val" style="color:#3B82F6">' + (efToday > 0 ? _f(efToday) : '—') + (efToday > 0 ? '<span class="hc2-cmeter-unit"> m³</span>' : '') + '</div>' +
        '<div class="hc2-cmeter-sub">Hier : ' + (efY > 0 ? _f(efY) + ' m³' : '—') + '</div>' +
      '</div>';
      h += '<div class="hc2-cmeter" onclick="MX.showPage(\'consommations\')">' +
        '<div class="hc2-cmeter-head"><span class="hc2-cmeter-ico" style="color:#F97316"><i class="fas fa-fire-flame-curved"></i></span><span class="hc2-cmeter-name">Eau chaude</span>' +
        (ecEvo !== null ? _evoSpan(ecEvo, _f(Math.abs(ecEvo)) + ' m³') : '') + '</div>' +
        '<div class="hc2-cmeter-val" style="color:#F97316">' + (ecToday > 0 ? _f(ecToday) : '—') + (ecToday > 0 ? '<span class="hc2-cmeter-unit"> m³</span>' : '') + '</div>' +
        '<div class="hc2-cmeter-sub">Hier : ' + (ecY > 0 ? _f(ecY) + ' m³' : '—') + '</div>' +
      '</div>';
      h += '<div class="hc2-cmeter" onclick="MX.Pages.Conso && MX.Pages.Conso._editCli(\'' + todayISO + '\',' + cliToday + ')">' +
        '<div class="hc2-cmeter-head"><span class="hc2-cmeter-ico" style="color:var(--cyan)"><i class="fas fa-users"></i></span><span class="hc2-cmeter-name">Clients présents</span></div>' +
        '<div class="hc2-cmeter-val" style="color:var(--cyan)">' + (cliToday || '—') + '</div>' +
        '<div class="hc2-cmeter-sub" style="color:var(--cyan);font-size:10px"><i class="fas fa-pen"></i> ' + (cliToday > 0 ? 'Modifier' : 'Saisir') + '</div>' +
      '</div>';
      h += '</div>';
    }
    h += '</div>'; // end hc2-conso-card

    // PMP widget
    if (pmpStats) {
      var pmpConf   = pmpStats.conformite;
      var confColor = pmpConf >= 80 ? 'var(--green)' : pmpConf >= 50 ? 'var(--orange)' : 'var(--red)';
      var pmpNextLbl = pmpStats.nextDue ? pmpStats.nextDue.split('-').reverse().join('/') : '—';
      h += '<div class="hc2-card hc2-pmp-card">' +
        '<div class="hc2-card-head"><span><i class="fas fa-screwdriver-wrench" style="color:var(--orange)"></i> Maintenance préventive</span>' +
          '<button class="hc2-card-btn" onclick="MX.showPage(\'pmp\')">Tout voir</button>' +
        '</div>' +
        '<div class="hc2-pmp-stats">' +
          '<div class="hc2-ps" onclick="MX.showPage(\'pmp\')">' +
            '<div class="hc2-ps-v" style="color:' + confColor + '">' + pmpConf + '%</div><div class="hc2-ps-l">Conformité</div>' +
          '</div>' +
          '<div class="hc2-ps" onclick="MX.showPage(\'pmp\')">' +
            '<div class="hc2-ps-v" style="color:var(--green)">' + pmpStats.realisees + '</div><div class="hc2-ps-l">Réalisées</div>' +
          '</div>' +
          '<div class="hc2-ps' + (pmpStats.enRetard > 0 ? ' hc2-ps--alert' : '') + '" onclick="MX.showPage(\'pmp\')">' +
            '<div class="hc2-ps-v" style="color:' + (pmpStats.enRetard > 0 ? 'var(--red)' : 'var(--text)') + '">' + pmpStats.enRetard + '</div><div class="hc2-ps-l">En retard</div>' +
          '</div>' +
          '<div class="hc2-ps" onclick="MX.showPage(\'pmp\')">' +
            '<div class="hc2-ps-v" style="font-size:13px">' + pmpNextLbl + '</div><div class="hc2-ps-l">Prochaine</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // Stock widget
    if (lowProds.length > 0) {
      h += '<div class="hc2-card hc2-stock-card">' +
        '<div class="hc2-card-head"><span><i class="fas fa-boxes-stacked" style="color:var(--orange)"></i> Stock critique</span>' +
          '<button class="hc2-card-btn" onclick="MX.showPage(\'orders\')">Commander</button>' +
        '</div>' +
        '<div class="hc2-stock-list">';
      lowProds.slice(0, 5).forEach(function(p) {
        var qty  = parseInt(p.qty  || 0);
        var min  = parseInt(p.minQty || 0);
        var pctB = min > 0 ? Math.min(100, Math.round(qty / min * 100)) : 0;
        var crit = pctB < 30 ? 'var(--red)' : 'var(--orange)';
        h += '<div class="hc2-stock-item" onclick="MX.showPage(\'orders\')">' +
          '<div class="hc2-stock-name">' + esc(p.name) + '</div>' +
          '<div class="hc2-stock-right">' +
            '<div class="hc2-stock-bar"><div class="hc2-stock-fill" style="width:' + pctB + '%;background:' + crit + '"></div></div>' +
            '<span class="hc2-stock-val" style="color:' + crit + '">' + qty + '/' + min + '</span>' +
          '</div>' +
        '</div>';
      });
      if (lowProds.length > 5) h += '<div class="hc2-stock-more">+' + (lowProds.length - 5) + ' autres produits critiques</div>';
      h += '</div></div>';
    }

    // Alerts widget
    h += '<div class="hc2-card hc2-alerts-card">' +
      '<div class="hc2-card-head"><span><i class="fas fa-triangle-exclamation" style="color:var(--orange)"></i> Alertes</span></div>';
    if (!hasAlerts) {
      h += '<div class="hc2-empty-state" style="color:var(--green)">' +
        '<i class="fas fa-check-circle" style="color:var(--green)"></i><span>Tout est nominal</span>' +
      '</div>';
    } else {
      var ANN_CFG = { urgent: { icon: '🚨', cls: 'danger' }, important: { icon: '⚠️', cls: 'warn' }, info: { icon: '📢', cls: '' }, suggestion: { icon: '💡', cls: '' }, technique: { icon: '🔧', cls: '' } };
      h += '<div class="hc2-alerts-list">';
      if (mLate.length > 0) {
        h += '<div class="hc2-alert hc2-alert--danger" onclick="MX.showPage(\'interventions\')">' +
          '<div class="hc2-alert-ico"><i class="fas fa-clock"></i></div>' +
          '<div class="hc2-alert-body"><div class="hc2-alert-title">' + mLate.length + ' intervention' + (mLate.length > 1 ? 's' : '') + ' en retard</div>' +
          '<div class="hc2-alert-sub">Action immédiate requise</div></div>' +
          '<i class="fas fa-chevron-right hc2-alert-arrow"></i>' +
        '</div>';
      }
      if (lowProds.length > 0) {
        var prodNames2 = lowProds.slice(0, 2).map(function(p) { return esc(p.name); }).join(', ');
        h += '<div class="hc2-alert hc2-alert--warn" onclick="MX.showPage(\'orders\')">' +
          '<div class="hc2-alert-ico"><i class="fas fa-box-open"></i></div>' +
          '<div class="hc2-alert-body"><div class="hc2-alert-title">' + lowProds.length + ' produit' + (lowProds.length > 1 ? 's' : '') + ' à commander</div>' +
          '<div class="hc2-alert-sub">' + prodNames2 + (lowProds.length > 2 ? ' +' + (lowProds.length - 2) + ' autres' : '') + '</div></div>' +
          '<i class="fas fa-chevron-right hc2-alert-arrow"></i>' +
        '</div>';
      }
      urgentAnns.forEach(function(a) {
        var at2 = ANN_CFG[a.type] || ANN_CFG.info;
        var txt = a.content ? a.content.slice(0, 70) + (a.content.length > 70 ? '…' : '') : '';
        h += '<div class="hc2-alert' + (at2.cls ? ' hc2-alert--' + at2.cls : '') + '" onclick="MX.showPage(\'msgs\')">' +
          '<div class="hc2-alert-ico">' + at2.icon + '</div>' +
          '<div class="hc2-alert-body"><div class="hc2-alert-title">' + (a.pinned ? '📌 ' : '') + esc(txt) + '</div>' +
          '<div class="hc2-alert-sub">' + esc(a.authorName || '') + ' · ' + MX.fmtTime(a.createdAt) + '</div></div>' +
          '<i class="fas fa-chevron-right hc2-alert-arrow"></i>' +
        '</div>';
      });
      h += '</div>';
    }
    h += '</div>'; // end hc2-alerts-card

    // Messages link
    h += '<div class="hc2-card hc2-comms-card">' +
      '<div class="hc2-comms-row" onclick="MX.showPage(\'msgs\')">' +
        '<div class="hc2-comms-ico" style="background:var(--jour-dim);color:var(--jour)"><i class="fas fa-comments"></i></div>' +
        '<div class="hc2-comms-body"><div class="hc2-comms-title">Messages</div>' +
        '<div class="hc2-comms-sub">' + msgCount + ' message' + (msgCount !== 1 ? 's' : '') + '</div></div>' +
        '<i class="fas fa-chevron-right" style="color:var(--text3);font-size:12px"></i>' +
      '</div>' +
    '</div>';

    h += '</div>'; // end .hc2-col-r
    h += '</div>'; // end .hc2-body

    // ── ACTIVITY FEED ──
    h += '<div class="hc2-card hc2-feed">' +
      '<div class="hc2-card-head"><span><i class="fas fa-bolt" style="color:var(--cyan)"></i> Activité récente</span>' +
        '<button class="hc2-card-btn" onclick="MX.showPage(\'msgs\')">Tout voir</button>' +
      '</div>';
    if (!recentFeed.length) {
      h += '<div class="hc2-empty-state"><i class="fas fa-comment-slash"></i><span>Aucune activité récente</span></div>';
    } else {
      h += '<div class="hc2-feed-list">';
      recentFeed.forEach(function(item) {
        var initials  = item.name.slice(0, 2).toUpperCase();
        var what      = item.what.length > 60 ? item.what.slice(0, 60) + '…' : item.what;
        var avatarBg  = item.type === 'mission' ? 'rgba(34,197,94,0.15)' : item.type === 'mission_prog' ? 'rgba(251,191,36,0.15)' : 'rgba(139,92,246,0.15)';
        h += '<div class="hc2-feed-item" onclick="MX.showPage(\'msgs\')">' +
          '<div class="hc2-feed-avatar" style="background:' + avatarBg + ';color:' + item.color + '">' + esc(initials) + '</div>' +
          '<div class="hc2-feed-body">' +
            '<div class="hc2-feed-author"><strong>' + esc(item.name) + '</strong> <span class="hc2-feed-verb">' + esc(item.action) + '</span></div>' +
            '<div class="hc2-feed-what"><i class="' + item.icon + '" style="color:' + item.color + ';font-size:10px;margin-right:4px"></i>' + esc(what) + '</div>' +
            '<div class="hc2-feed-time">' + MX.fmtTime(item.at) + '</div>' +
          '</div>' +
        '</div>';
      });
      h += '</div>';
    }
    h += '</div>'; // end hc2-feed

    h += '</div>'; // end .hc2-page

    el.innerHTML = h;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Home = { render, uploadPlan, clearPlan, openPlan };
})();
