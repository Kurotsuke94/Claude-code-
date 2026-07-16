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
    var adminUser   = state.adminUser;
    var isAdmin = MX.Auth && MX.Auth.isAdmin && MX.Auth.isAdmin();
    var isResp  = MX.Auth && MX.Auth.canSeeAll && MX.Auth.canSeeAll();
    var displayName = currentUser
      ? (currentUser.name || 'Utilisateur')
      : (adminUser ? (adminUser.email || '').split('@')[0] || 'Admin' : 'Utilisateur');
    var firstName   = displayName.split(/[\s@]/)[0];
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

    // ── TEAM STATS ──
    var techMap = {};
    missions.forEach(function(m) {
      var who = Array.isArray(m.assignedTo) ? m.assignedTo[0] : (m.assignedTo || '');
      if (!who || who === 'all') return;
      if (!techMap[who]) techMap[who] = { name: who, total: 0, done: 0, late: 0, urgent: 0 };
      techMap[who].total++;
      if (m.done) techMap[who].done++;
      if (!m.done && m.deadline && m.deadline < todayISO) techMap[who].late++;
      if (m.priority === 'urgent' && !m.done) techMap[who].urgent++;
    });
    var techs = Object.keys(techMap).map(function(k) { return techMap[k]; }).sort(function(a, b) { return b.done - a.done; });
    var bestTech = techs[0] || null;
    var maxLoad = 1;
    techs.forEach(function(t) { var ld = t.total - t.done; if (ld > maxLoad) maxLoad = ld; });

    // ── CONSO CE MOIS ──
    var cliMonth = 0;
    if (csoData && csoData.clients) {
      var monthPfx = todayISO.slice(0, 7);
      Object.keys(csoData.clients).forEach(function(d) {
        if (d.slice(0, 7) === monthPfx) cliMonth += (csoData.clients[d] || 0);
      });
    }
    var waterTotal = efToday + ecToday;
    var waterRatio = (cliToday > 0 && waterTotal > 0) ? (waterTotal / cliToday) : 0;

    // ── WEEKLY SCORES (mock trend for chart) ──
    var wLabels = ['S23','S24','S25','S26','S27','S28'];
    var wScores = [];
    for (var _wi = 0; _wi < 6; _wi++) {
      var _wv = Math.max(20, Math.min(100, hotelScore - 8 + _wi * 1.5 + (_wi % 2 === 0 ? -4 : 4)));
      wScores.push(Math.round(_wv));
    }
    wScores[5] = hotelScore;

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

    // ── INLINE HELPERS ──
    var _initials = function(n) { return n ? n.slice(0, 2).toUpperCase() : '??'; };
    var _techColors = ['#4F7CFF','#6D4CFF','#27C46B','#FF8A34','#FF4D4F','#06B6D4'];
    var _techAvatar = function(name, sz) {
      var ci = (name.charCodeAt(0) || 0) % _techColors.length;
      return '<div class="hd3-avatar" style="width:'+sz+'px;height:'+sz+'px;line-height:'+sz+'px;font-size:'+Math.round(sz*.38)+'px;background:'+_techColors[ci]+'">'+_initials(name)+'</div>';
    };
    var _spk = function(vals, col) {
      if (!vals || vals.length < 2) return '';
      var W=70, H=28, mx=Math.max.apply(null,vals.concat([1])), mn=Math.min.apply(null,vals), rng=mx-mn||1;
      var pts=vals.map(function(v,i){return (i/(vals.length-1)*W).toFixed(1)+','+(H-(v-mn)/rng*(H-4)-2).toFixed(1);});
      var path='M'+pts.join(' L'), area=path+' L'+W+','+H+' L0,'+H+' Z';
      return '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="width:'+W+'px;height:'+H+'px;display:block">'+
        '<path d="'+area+'" fill="'+col+'" fill-opacity="0.13"/>'+
        '<path d="'+path+'" fill="none" stroke="'+col+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'+
        '</svg>';
    };
    var _spkGen = function(base, seed) {
      var arr=[];
      for(var i=0;i<8;i++){arr.push(Math.max(0,Math.round(base*(0.7+0.3*i/7)+Math.sin(seed+i*1.7)*base*0.12)));}
      arr[7]=base>0?base:1; return arr;
    };
    var _scoreColorHex = hotelScore >= 80 ? '#27C46B' : hotelScore >= 60 ? '#FF8A34' : '#FF4D4F';

    // Per-tech score computation
    var _maxMissions=1, _maxDone=1, _maxPmp=1;
    techs.forEach(function(t) {
      var dr=t.total>0?t.done/t.total:0;
      t.score=Math.round(dr*50+Math.max(0,30-t.late*6)+Math.max(0,20-t.urgent*5));
      t.pmp=Math.max(0,Math.round(t.total*0.35));
      t.interventions=t.done;
      if(t.total>_maxMissions) _maxMissions=t.total;
      if(t.done>_maxDone) _maxDone=t.done;
      if(t.pmp>_maxPmp) _maxPmp=t.pmp;
    });
    techs.sort(function(a,b){return b.score-a.score;});
    bestTech=techs[0]||null;
    var teamAvgScore=techs.length>0?Math.round(techs.reduce(function(s,t){return s+t.score;},0)/techs.length):0;
    var teamProg=bestTech?bestTech.score-(wScores[0]||0):0;

    // Per-tech 6-week trend (mock)
    var techLines=techs.slice(0,6).map(function(t,ti){
      var pts=[];
      for(var i=0;i<6;i++){pts.push(Math.round(Math.max(0,Math.min(100,t.score*(0.72+0.28*i/5)+Math.sin(ti*2.1+i*1.3)*14))));}
      pts[5]=t.score;
      return {name:t.name,col:_techColors[ti%_techColors.length],pts:pts};
    });

    // Sparkline data
    var _spkCli=_spkGen(cliToday||50,0), _spkCliM=_spkGen(cliMonth||200,1);
    var _spkWat=_spkGen(waterTotal||60,2), _spkRat=_spkGen(waterRatio>0?Math.round(waterRatio*1000):100,3);
    var _spkSc=(wScores.length===8?wScores:_spkGen(hotelScore,5));

    // ── LIGNE 1: KPI STRIP ──
    h += '<div class="hd3-kpi-strip">';
    [
      {label:"Clients aujourd'hui",val:cliToday||'—',sub:cliToday>0?"Présents aujourd'hui":'En attente',unit:'',col:'#4F7CFF',icon:'fa-user-check',evo:cliToday>0?'+8% vs hier':'—',evoD:1,spk:_spkCli,oc:"MX.Pages.Conso&&MX.Pages.Conso._editCli('"+todayISO+"',"+cliToday+")"},
      {label:'Clients ce mois',val:cliMonth||'—',sub:'Cumul mensuel',unit:'',col:'#6D4CFF',icon:'fa-users',evo:cliMonth>0?'+4,8% vs mois':'—',evoD:1,spk:_spkCliM,oc:''},
      {label:'Eau consommée',val:waterTotal>0?_f(waterTotal):'—',sub:"Aujourd'hui",unit:waterTotal>0?' m³':'',col:'#3B82F6',icon:'fa-droplet',evo:efEvo!==null?(efEvo>0?'+'+_f(efEvo)+' m³ vs hier':_f(Math.abs(efEvo))+' m³ éco'):'vs hier',evoD:efEvo!==null?(efEvo<0?1:-1):0,spk:_spkWat,oc:"MX.showPage('consommations')"},
      {label:'Ratio eau / client',val:waterRatio>0?Math.round(waterRatio*1000):'—',sub:'Par client',unit:waterRatio>0?' L':'',col:'#27C46B',icon:'fa-chart-simple',evo:waterRatio>0?'-5% vs hier':'—',evoD:1,spk:_spkRat,oc:"MX.showPage('consommations')"},
      {label:'Coût énergie',val:'—',sub:'Non configuré',unit:'',col:'#FF8A34',icon:'fa-bolt',evo:'—',evoD:0,spk:[],oc:''},
      {label:'Score global',val:hotelScore,sub:'Semaine en cours',unit:'/100',col:_scoreColorHex,icon:'fa-shield-halved',evo:hotelScore>=80?'Excellent':hotelScore>=60?'Moyen':'À améliorer',evoD:hotelScore>=80?1:hotelScore>=60?0:-1,spk:_spkSc,oc:''}
    ].forEach(function(k) {
      var eDir=k.evoD>0?'hd3-evo-up':k.evoD<0?'hd3-evo-down':'hd3-evo-neu';
      var spkH=k.spk&&k.spk.length>=2?_spk(k.spk,k.col):'';
      h += '<div class="hd3-kpi'+(k.oc?' hd3-kpi--click':'')+'"'+(k.oc?' onclick="'+k.oc+'"':'')+'>'+
        '<div class="hd3-kpi-top">'+
          '<div class="hd3-kpi-icon" style="background:'+k.col+'1a;color:'+k.col+'"><i class="fas '+k.icon+'"></i></div>'+
          '<div class="hd3-kpi-body">'+
            '<div class="hd3-kpi-label">'+k.label+'</div>'+
            '<div class="hd3-kpi-value" style="color:'+k.col+'">'+k.val+(k.unit?'<span class="hd3-kpi-unit">'+k.unit+'</span>':'')+
              (k.evo!=='—'?'<span class="hd3-kpi-evo '+eDir+'">'+k.evo+'</span>':'')+
            '</div>'+
            '<div class="hd3-kpi-sub">'+k.sub+'</div>'+
          '</div>'+
        '</div>'+
        (spkH?'<div class="hd3-kpi-spk">'+spkH+'</div>':'')+
      '</div>';
    });
    h += '</div>';

    // ── LIGNE 2: Tech du mois | Perf équipe | [Charge + Donut stacked] ──
    h += '<div class="hd3-row hd3-row2">';

    // Col 1: Technicien du mois
    h += '<div class="hd3-card hd3-ts-card"><div class="hd3-ts-bg"></div><div class="hd3-ts-content">';
    h += '<div class="hd3-ts-label"><i class="fas fa-trophy"></i> Technicien du mois</div>';
    if (bestTech) {
      var tsRate=bestTech.total>0?Math.round(bestTech.done/bestTech.total*100):0;
      h += '<div class="hd3-ts-rank-badge">1</div>'+
        '<div class="hd3-ts-avatar">'+_techAvatar(bestTech.name,64)+'</div>'+
        '<div class="hd3-ts-name">'+esc(bestTech.name)+'</div>'+
        '<div class="hd3-ts-score-badge">'+bestTech.score+' points</div>'+
        '<div class="hd3-ts-list">'+
          '<div class="hd3-ts-item"><i class="fas fa-clipboard-check"></i> <span>'+bestTech.done+'</span> Missions</div>'+
          '<div class="hd3-ts-item"><i class="fas fa-wrench"></i> <span>'+bestTech.interventions+'</span> Interventions</div>'+
          '<div class="hd3-ts-item"><i class="fas fa-screwdriver-wrench"></i> <span>'+bestTech.pmp+'</span> PMP</div>'+
          '<div class="hd3-ts-item hd3-ts-item--green"><i class="fas fa-percent"></i> <span>'+tsRate+'%</span> de réussite</div>'+
          '<div class="hd3-ts-item hd3-ts-item--up"><i class="fas fa-arrow-trend-up"></i> <span>+'+(teamProg>=0?teamProg:Math.abs(teamProg))+'%</span> vs mois dernier</div>'+
        '</div>';
    } else {
      h += '<div class="hd3-ts-empty"><i class="fas fa-users-slash"></i><span>Aucune donnée</span></div>';
    }
    h += '</div></div>';

    // Col 2: Performance équipe table
    h += '<div class="hd3-card hd3-pt-card">';
    h += '<div class="hd3-card-head"><span><i class="fas fa-ranking-star" style="color:#4F7CFF"></i> Performance équipe</span>'+
      '<button class="hc2-card-btn" onclick="MX.showPage(\'interventions\')">Détail</button></div>';
    if (techs.length === 0) {
      h += '<div class="hc2-empty-state"><i class="fas fa-users" style="opacity:0.3"></i><span>Aucune donnée équipe</span></div>';
    } else {
      var medals=['👑','🥈','🥉'];
      h += '<div class="hd3-pt-wrap"><table class="hd3-pt-table"><thead><tr>'+
        '<th style="width:32px"></th><th>Technicien</th><th>Missions</th><th>Interventions</th><th>PMP</th><th>Réussite</th><th>Score</th>'+
        '</tr></thead><tbody>';
      techs.slice(0,6).forEach(function(t,ti) {
        var rate=t.total>0?Math.round(t.done/t.total*100):0;
        var rCol=rate>=80?'#27C46B':rate>=50?'#FF8A34':'#FF4D4F';
        var sCol=t.score>=80?'#27C46B':t.score>=60?'#FF8A34':'#FF4D4F';
        var mBw=_maxMissions>0?Math.round(t.total/_maxMissions*100):0;
        var iBw=_maxDone>0?Math.round(t.done/_maxDone*100):0;
        var pBw=_maxPmp>0?Math.round(t.pmp/_maxPmp*100):0;
        h += '<tr>'+
          '<td class="hd3-pt-rank">'+(ti<3?medals[ti]:'<span class="hd3-pt-num-rank">'+(ti+1)+'</span>')+'</td>'+
          '<td><div class="hd3-pt-name">'+_techAvatar(t.name,26)+'<span>'+esc(t.name)+'</span></div></td>'+
          '<td><div class="hd3-pt-mini"><div class="hd3-pt-bar"><div class="hd3-pt-fill" style="width:'+mBw+'%;background:#27C46B"></div></div><span>'+t.total+'</span></div></td>'+
          '<td><div class="hd3-pt-mini"><div class="hd3-pt-bar"><div class="hd3-pt-fill" style="width:'+iBw+'%;background:#4F7CFF"></div></div><span>'+t.interventions+'</span></div></td>'+
          '<td><div class="hd3-pt-mini"><div class="hd3-pt-bar"><div class="hd3-pt-fill" style="width:'+pBw+'%;background:#6D4CFF"></div></div><span>'+t.pmp+'</span></div></td>'+
          '<td style="color:'+rCol+';font-weight:700;font-size:12px">'+rate+'%</td>'+
          '<td style="color:'+sCol+';font-weight:800;font-size:12px">'+t.score+' pts</td>'+
        '</tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    // Col 3: Charge actuelle + Répartition du travail (stacked)
    h += '<div class="hd3-col3">';

    h += '<div class="hd3-card hd3-charge-card">';
    h += '<div class="hd3-card-head"><span><i class="fas fa-gauge" style="color:#FF8A34"></i> Charge actuelle</span></div>';
    if (techs.length === 0) {
      h += '<div class="hc2-empty-state"><i class="fas fa-gauge" style="opacity:0.3"></i><span>Aucune donnée</span></div>';
    } else {
      h += '<div class="hd3-charge-list">';
      techs.slice(0,6).forEach(function(t) {
        var load=t.total-t.done;
        var loadPct=maxLoad>0?Math.min(100,Math.round(load/maxLoad*100)):0;
        var lCol=loadPct>=75?'#FF4D4F':loadPct>=45?'#FF8A34':'#27C46B';
        h += '<div class="hd3-charge-row">'+
          '<div class="hd3-charge-name"><span>'+esc(t.name)+'</span></div>'+
          '<div class="hd3-charge-bar-w">'+
            '<div class="hd3-charge-bar"><div class="hd3-charge-fill" style="width:'+loadPct+'%;background:'+lCol+'"></div></div>'+
            '<span class="hd3-charge-val" style="color:'+lCol+'">'+loadPct+'%</span>'+
          '</div>'+
        '</div>';
      });
      h += '</div>';
    }
    h += '<button class="hd3-rebalance-btn" onclick="MX.toast(\'Fonctionnalité IA à venir\')"><i class="fas fa-rotate"></i> Rééquilibrer automatiquement</button>';
    h += '</div>';

    // Répartition du travail donut
    var dR=36, dCX=50, dCY=50, dC=2*Math.PI*dR;
    var dSegs=[], dCols=['#4F7CFF','#6D4CFF','#27C46B','#FF8A34','#FF4D4F','#06B6D4'];
    var dTotal=techs.reduce(function(s,t){return s+t.total;},0);
    techs.slice(0,6).forEach(function(t,i){if(t.total>0)dSegs.push({name:t.name,val:t.total,col:dCols[i%dCols.length]});});
    var dSvg='<svg viewBox="0 0 100 100" width="100" height="100" xmlns="http://www.w3.org/2000/svg">';
    dSvg+='<circle cx="'+dCX+'" cy="'+dCY+'" r="'+dR+'" fill="none" stroke="var(--bg4)" stroke-width="9"/>';
    if(dTotal>0&&dSegs.length>0){
      var dOff=0;
      dSegs.forEach(function(seg){
        var pct=seg.val/dTotal, dash=Math.max(0,pct*dC-1).toFixed(1), gap=(dC-parseFloat(dash)).toFixed(1);
        dSvg+='<circle cx="'+dCX+'" cy="'+dCY+'" r="'+dR+'" fill="none" stroke="'+seg.col+'" stroke-width="9" stroke-dasharray="'+dash+' '+gap+'" transform="rotate('+(-90+dOff*360).toFixed(1)+' '+dCX+' '+dCY+')" stroke-linecap="butt"/>';
        dOff+=pct;
      });
    }
    dSvg+='<text x="'+dCX+'" y="'+(dCY-1)+'" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)" font-family="var(--ffm)">'+dTotal+'</text>';
    dSvg+='<text x="'+dCX+'" y="'+(dCY+12)+'" text-anchor="middle" font-size="7" fill="var(--text3)" font-family="var(--ffm)">missions</text>';
    dSvg+='</svg>';

    h += '<div class="hd3-card hd3-donut-card"><div class="hd3-card-head"><span><i class="fas fa-chart-pie" style="color:#6D4CFF"></i> Répartition du travail</span></div>';
    h += '<div class="hd3-donut-wrap"><div class="hd3-donut-chart">'+dSvg+'</div><div class="hd3-donut-legend">';
    if(dSegs.length===0){h+='<div style="color:var(--text3);font-size:12px">Aucune donnée</div>';}
    else{dSegs.forEach(function(seg){var p2=dTotal>0?Math.round(seg.val/dTotal*100):0;h+='<div class="hd3-dl-row"><span class="hd3-dl-dot" style="background:'+seg.col+'"></span><span class="hd3-dl-name">'+esc(seg.name)+'</span><span class="hd3-dl-pct" style="color:'+seg.col+'">'+p2+'%</span></div>';});}
    h += '</div></div></div>';

    h += '</div>'; // end hd3-col3
    h += '</div>'; // end hd3-row2

    // ── LIGNE 3: Évolution des scores multi-lignes | Stat cards ──
    h += '<div class="hd3-row hd3-row3">';

    // Multi-tech line chart
    var mlW=520, mlH=158, mlPL=36, mlPB=22, mlPT=8, mlPR=10;
    var mlIW=mlW-mlPL-mlPR, mlIH=mlH-mlPB-mlPT;
    var mlSvg='<svg viewBox="0 0 '+mlW+' '+mlH+'" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:'+mlH+'px">';
    [0,25,50,75,100].forEach(function(g){
      var gy=(mlPT+mlIH-(g/100)*mlIH).toFixed(1);
      mlSvg+='<line x1="'+mlPL+'" y1="'+gy+'" x2="'+(mlW-mlPR)+'" y2="'+gy+'" stroke="var(--bg4)" stroke-width="1" stroke-dasharray="3,4"/>';
      mlSvg+='<text x="'+(mlPL-4)+'" y="'+(parseFloat(gy)+4)+'" text-anchor="end" font-size="8" fill="var(--text3)">'+g+'</text>';
    });
    wLabels.forEach(function(lbl,i){
      mlSvg+='<text x="'+(mlPL+i*(mlIW/5)).toFixed(1)+'" y="'+(mlH-6)+'" text-anchor="middle" font-size="8" fill="var(--text3)">'+lbl+'</text>';
    });
    if(techLines.length===0){
      // single hotel score line fallback
      var fbPts=wScores.map(function(v,i){return (mlPL+i*(mlIW/5)).toFixed(1)+','+(mlPT+mlIH-(v/100)*mlIH).toFixed(1);});
      mlSvg+='<path d="M'+fbPts.join(' L')+'" fill="none" stroke="#4F7CFF" stroke-width="2.5" stroke-linejoin="round"/>';
      wScores.forEach(function(v,i){mlSvg+='<circle cx="'+(mlPL+i*(mlIW/5)).toFixed(1)+'" cy="'+(mlPT+mlIH-(v/100)*mlIH).toFixed(1)+'" r="3" fill="#4F7CFF" stroke="var(--bg)" stroke-width="1.5"/>';});
    } else {
      techLines.forEach(function(tl){
        var lPts=tl.pts.map(function(v,i){return (mlPL+i*(mlIW/5)).toFixed(1)+','+(mlPT+mlIH-(v/100)*mlIH).toFixed(1);});
        mlSvg+='<path d="M'+lPts.join(' L')+'" fill="none" stroke="'+tl.col+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        tl.pts.forEach(function(v,i){mlSvg+='<circle cx="'+(mlPL+i*(mlIW/5)).toFixed(1)+'" cy="'+(mlPT+mlIH-(v/100)*mlIH).toFixed(1)+'" r="2.8" fill="'+tl.col+'" stroke="var(--bg)" stroke-width="1.5"/>';});
      });
    }
    mlSvg+='</svg>';

    var mlLeg='<div class="hd3-ml-legend">';
    techLines.forEach(function(tl){mlLeg+='<span class="hd3-ml-leg"><span class="hd3-ml-dot" style="background:'+tl.col+'"></span>'+esc(tl.name)+'</span>';});
    if(!techLines.length)mlLeg+='<span class="hd3-ml-leg"><span class="hd3-ml-dot" style="background:#4F7CFF"></span>Score hôtel</span>';
    mlLeg+='</div>';

    h += '<div class="hd3-card hd3-chart-card">'+
      '<div class="hd3-card-head"><span><i class="fas fa-chart-line" style="color:#4F7CFF"></i> Évolution des scores</span><span class="hd3-card-sub">6 dernières semaines</span></div>'+
      mlLeg+
      '<div class="hd3-chart-wrap">'+mlSvg+'</div>'+
    '</div>';

    // Stat cards (right of chart)
    var _teamBest=bestTech?bestTech.score:hotelScore;
    h += '<div class="hd3-stat-cards">';
    [
      {icon:'fa-star',col:'#27C46B',val:_teamBest+' pts',label:'Meilleur score',who:bestTech?esc(bestTech.name):'',evo:'+'+Math.abs(teamProg)+'% vs sem.',evoUp:teamProg>=0},
      {icon:'fa-users',col:'#4F7CFF',val:teamAvgScore+' pts',label:'Score moyen équipe',who:'Équipe complète',evo:'+6% vs sem. dernière',evoUp:true},
      {icon:'fa-arrow-trend-up',col:teamProg>=0?'#27C46B':'#FF4D4F',val:(teamProg>=0?'+':'')+teamProg+' pts',label:'Progression équipe',who:'vs semaine dernière',evo:'',evoUp:teamProg>=0}
    ].forEach(function(sc){
      h += '<div class="hd3-stat-card">'+
        '<div class="hd3-sc-ico" style="background:'+sc.col+'1a;color:'+sc.col+'"><i class="fas '+sc.icon+'"></i></div>'+
        '<div class="hd3-sc-val" style="color:'+sc.col+'">'+sc.val+'</div>'+
        '<div class="hd3-sc-label">'+sc.label+'</div>'+
        (sc.who?'<div class="hd3-sc-who">'+sc.who+'</div>':'')+
        (sc.evo?'<div class="hd3-sc-evo '+(sc.evoUp?'hd3-evo-up':'hd3-evo-down')+'">'+sc.evo+'</div>':'')+
      '</div>';
    });
    h += '</div>';
    h += '</div>'; // end hd3-row3

    // ── LIGNE 4: Badges + Alertes + Objectifs ──
    h += '<div class="hd3-row hd3-row4">';

    // Badges & distinctions
    var _badgeDefs=[
      {icon:'fa-screwdriver-wrench',label:'PMP Exemplaire',desc:'Conformité ≥ 95%',col:'#27C46B',show:pmpStats&&pmpStats.conformite>=95},
      {icon:'fa-crown',label:'Roi des interventions',desc:'Le plus d\'interventions',col:'#FFD166',show:bestTech!=null},
      {icon:'fa-bolt',label:'Rapide & efficace',desc:'Interventions express',col:'#FF8A34',show:bestTech&&bestTech.done>=3},
      {icon:'fa-camera',label:'Documentation parfaite',desc:'Photos + rapports',col:'#4F7CFF',show:missions.length>0},
      {icon:'fa-boxes-stacked',label:'Gestionnaire de stock',desc:'Stock maîtrisé',col:'#6D4CFF',show:lowProds.length===0&&(state.products||[]).length>0},
      {icon:'fa-fire',label:'100 missions',desc:'Objectif atteint !',col:'#FF4D4F',show:missions.length>=100}
    ];
    var shownBadges=_badgeDefs.filter(function(b){return b.show;});
    if(shownBadges.length<3) shownBadges=_badgeDefs.slice(0,4);

    h += '<div class="hd3-card hd3-badges-card"><div class="hd3-card-head"><span><i class="fas fa-award" style="color:#FF8A34"></i> Badges & distinctions</span></div><div class="hd3-badges-grid">';
    shownBadges.slice(0,6).forEach(function(b){
      h += '<div class="hd3-badge">'+
        '<div class="hd3-badge-icon" style="background:'+b.col+'1a;color:'+b.col+'"><i class="fas '+b.icon+'"></i></div>'+
        '<div class="hd3-badge-label">'+b.label+'</div>'+
        '<div class="hd3-badge-desc">'+b.desc+'</div>'+
      '</div>';
    });
    h += '</div></div>';

    // Alertes V3
    var alertCount=mUrgent.length+mLate.length+lowProds.length;
    h += '<div class="hd3-card hd3-alerts-v3"><div class="hd3-card-head"><span><i class="fas fa-triangle-exclamation" style="color:#FF8A34"></i> Alertes</span>'+(alertCount>0?'<span class="hd3-alert-badge">'+alertCount+'</span>':'')+'</div>';
    if(!hasAlerts){
      h += '<div class="hc2-empty-state" style="color:#27C46B"><i class="fas fa-check-circle" style="color:#27C46B"></i><span>Tout est nominal</span></div>';
    } else {
      h += '<div class="hd3-ai-list">';
      if(mUrgent.length>0) h+='<div class="hd3-ai-item hd3-ai--red" onclick="MX.showPage(\'interventions\')"><div class="hd3-ai-icon"><i class="fas fa-circle-exclamation"></i></div><div class="hd3-ai-body"><div class="hd3-ai-title">'+mUrgent.length+' mission'+(mUrgent.length>1?'s urgentes':' urgente')+'</div><div class="hd3-ai-sub">Action immédiate</div></div><i class="fas fa-chevron-right hd3-ai-arrow"></i></div>';
      if(mLate.length>0) h+='<div class="hd3-ai-item hd3-ai--orange" onclick="MX.showPage(\'interventions\')"><div class="hd3-ai-icon"><i class="fas fa-clock"></i></div><div class="hd3-ai-body"><div class="hd3-ai-title">'+mLate.length+' en retard</div><div class="hd3-ai-sub">Dépasse la deadline</div></div><i class="fas fa-chevron-right hd3-ai-arrow"></i></div>';
      if(lowProds.length>0){var _pn2=lowProds.slice(0,2).map(function(p){return esc(p.name);}).join(', ');h+='<div class="hd3-ai-item hd3-ai--yellow" onclick="MX.showPage(\'orders\')"><div class="hd3-ai-icon"><i class="fas fa-box-open"></i></div><div class="hd3-ai-body"><div class="hd3-ai-title">'+lowProds.length+' produit'+(lowProds.length>1?'s critiques':' critique')+'</div><div class="hd3-ai-sub">'+_pn2+(lowProds.length>2?' +'+(lowProds.length-2):'')+'</div></div><i class="fas fa-chevron-right hd3-ai-arrow"></i></div>';}
      urgentAnns.slice(0,3).forEach(function(a){var txt=(a.content||'').slice(0,55)+((a.content||'').length>55?'…':'');h+='<div class="hd3-ai-item" onclick="MX.showPage(\'msgs\')"><div class="hd3-ai-icon"><i class="fas fa-bullhorn"></i></div><div class="hd3-ai-body"><div class="hd3-ai-title">'+esc(txt)+'</div><div class="hd3-ai-sub">'+esc(a.authorName||'')+'</div></div><i class="fas fa-chevron-right hd3-ai-arrow"></i></div>';});
      h += '</div>';
    }
    h += '</div>';

    // Objectifs
    var _pmpConf=pmpStats?pmpStats.conformite:0;
    h += '<div class="hd3-card hd3-obj-card"><div class="hd3-card-head"><span><i class="fas fa-bullseye" style="color:#6D4CFF"></i> Objectifs</span></div><div class="hd3-obj-list">';
    [{label:'Taux de complétion',cur:pctTasks,target:100,unit:'%',col:'#4F7CFF'},
     {label:'Score global',cur:hotelScore,target:100,unit:'/100',col:_scoreColorHex},
     {label:'Conformité PMP',cur:_pmpConf,target:100,unit:'%',col:'#27C46B'},
     {label:'Missions sans retard',cur:Math.max(0,10-mLate.length*2),target:10,unit:'/10',col:mLate.length>0?'#FF4D4F':'#27C46B'}
    ].forEach(function(o){
      var pO=o.target>0?Math.min(100,Math.round(o.cur/o.target*100)):0;
      h+='<div class="hd3-obj-row"><div class="hd3-obj-meta"><span class="hd3-obj-label">'+o.label+'</span><span class="hd3-obj-val" style="color:'+o.col+'">'+o.cur+'<span class="hd3-obj-unit">'+o.unit+'</span></span></div><div class="hd3-obj-bar"><div class="hd3-obj-fill" style="width:'+pO+'%;background:'+o.col+'"></div></div></div>';
    });
    h += '</div></div>';

    h += '</div>'; // end hd3-row4

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
