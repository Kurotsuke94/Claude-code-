(function () {
  let _tab = 'overview';
  let _lbPeriod = 'all';
  let _spinBusy = false;

  // ── GRADE HELPERS ──
  function _getGrade(points) {
    const grades = (MX.state.rewardsGrades || []).slice().sort((a, b) => b.minPoints - a.minPoints);
    return grades.find(g => points >= g.minPoints) || grades[grades.length - 1] || { name: 'Recrue', icon: '🔩', color: '#6B7280', minPoints: 0 };
  }
  function _getNextGrade(points) {
    const grades = (MX.state.rewardsGrades || []).slice().sort((a, b) => a.minPoints - b.minPoints);
    return grades.find(g => g.minPoints > points) || null;
  }
  function _currentUserId() {
    const cu = MX.state.currentUser;
    const ad = MX.state.adminUser;
    if (cu) return cu.id;
    if (ad) return 'admin_' + (ad.email || 'admin').replace(/[^a-z0-9]/gi, '_');
    return null;
  }
  function _currentUserName() {
    const cu = MX.state.currentUser;
    const ad = MX.state.adminUser;
    if (cu) return cu.name;
    if (ad) return (ad.email || 'Admin').split('@')[0];
    return null;
  }
  function _userPoints(userId) {
    return (MX.state.rewardsUsers[userId] || {}).points || 0;
  }

  // ── AWARD POINTS (called from hooks) ──
  async function awardForEvent(event, context) {
    const uid = _currentUserId();
    const uname = _currentUserName();
    if (!uid || !uname) return;
    const rules = (MX.state.rewardsRules || []).filter(r => r.active && r.event === event);
    if (!rules.length) return;
    const rule = rules[0];
    const pts = rule.points || 0;
    if (pts <= 0) return;
    try {
      await MX.DB.awardPoints(uid, uname, event, pts, context || rule.label);
    } catch(e) { console.warn('awardPoints:', e); }
  }

  // ── TAB SWITCH ──
  function switchTab(tab) {
    _tab = tab;
    render();
  }

  // ── MAIN RENDER ──
  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const canAdmin = MX.Auth.canSeeAll();
    const uid = _currentUserId();
    const pts = uid ? _userPoints(uid) : 0;
    const grade = _getGrade(pts);
    const nextGrade = _getNextGrade(pts);
    const pct = nextGrade ? Math.min(100, Math.round((pts - grade.minPoints) / (nextGrade.minPoints - grade.minPoints) * 100)) : 100;

    const TABS = [
      { id: 'overview',    icon: 'fa-gauge',        l: 'Aperçu' },
      { id: 'rules',       icon: 'fa-sliders',      l: 'Règles',      adminOnly: true },
      { id: 'grades',      icon: 'fa-layer-group',  l: 'Grades',      adminOnly: true },
      { id: 'items',       icon: 'fa-gift',         l: 'Récompenses' },
      { id: 'games',       icon: 'fa-gamepad',      l: 'Mini-jeux' },
      { id: 'leaderboard', icon: 'fa-ranking-star', l: 'Classement' },
      { id: 'history',     icon: 'fa-clock-rotate-left', l: 'Historique' }
    ];

    let h = `<div class="ph">
      <div class="ph-eye">GAMIFICATION</div>
      <div class="ph-row">
        <div><div class="ph-title">🏆 Récompenses Maintix</div>
        <div class="ph-sub">Gagnez des points en accomplissant vos missions</div></div>
      </div>
    </div>
    <div class="page-body">
      <div class="rw-tabs">`;

    TABS.forEach(t => {
      if (t.adminOnly && !canAdmin) return;
      h += `<button class="rw-tab${_tab === t.id ? ' active' : ''}" onclick="MX.Pages.Rewards._tab('${t.id}')">
        <i class="fas ${t.icon}"></i> <span>${t.l}</span>
      </button>`;
    });

    h += `</div>`;

    if (_tab === 'overview')    h += _renderOverview(uid, pts, grade, nextGrade, pct);
    if (_tab === 'rules')       h += _renderRules();
    if (_tab === 'grades')      h += _renderGrades();
    if (_tab === 'items')       h += _renderItems(uid, pts);
    if (_tab === 'games')       h += _renderGames(uid, pts);
    if (_tab === 'leaderboard') h += _renderLeaderboard();
    if (_tab === 'history')     h += _renderHistory(uid);

    h += `</div>`;
    el.innerHTML = h;
  }

  // ── OVERVIEW ──
  function _renderOverview(uid, pts, grade, nextGrade, pct) {
    const hist = MX.state.rewardsHistory || [];
    const users = MX.state.users || [];
    const ruMap = MX.state.rewardsUsers || {};

    // KPIs
    const totalPts = Object.values(ruMap).reduce((s, u) => s + (u.points || 0), 0);
    const activeUsers = Object.keys(ruMap).length;
    const rewardsBought = hist.filter(h => h.event === 'item_redeemed').length;
    const gamesPlayed  = hist.filter(h => h.event === 'game_spin').length;

    // Personal grade bar
    let gradeBar = '';
    if (uid) {
      gradeBar = `<div class="rw-grade-card">
        <div class="rw-grade-left">
          <div class="rw-grade-icon" style="background:${grade.color}22;border-color:${grade.color}44;font-size:28px">${grade.icon}</div>
          <div>
            <div class="rw-grade-name" style="color:${grade.color}">${MX.esc(grade.name)}</div>
            <div class="rw-grade-pts"><b>${pts}</b> MP</div>
          </div>
        </div>
        ${nextGrade ? `<div class="rw-grade-right">
          <div class="rw-grade-prog-label">
            <span>Vers ${MX.esc(nextGrade.name)} ${nextGrade.icon}</span>
            <span>${pts} / ${nextGrade.minPoints} MP</span>
          </div>
          <div class="rw-prog-track"><div class="rw-prog-fill" style="width:${pct}%;background:${grade.color}"></div></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Encore ${nextGrade.minPoints - pts} MP</div>
        </div>` : `<div class="rw-grade-right"><div style="font-size:13px;color:var(--jour);font-weight:600">🏆 Grade maximum atteint !</div></div>`}
      </div>`;
    }

    // Top 3
    const ranked = _buildRanking('all');
    let top3 = '';
    if (ranked.length) {
      const medals = ['🥇','🥈','🥉'];
      top3 = `<div class="section-label">Top du classement</div><div class="rw-top3">`;
      ranked.slice(0, 3).forEach((u, i) => {
        const g = _getGrade(u.points);
        top3 += `<div class="rw-top3-card" onclick="MX.Pages.Rewards._tab('leaderboard')">
          <div class="rw-top3-medal">${medals[i] || (i+1)}</div>
          <div class="rw-top3-avatar" style="background:${g.color}22;color:${g.color}">${MX.esc((u.name||'?').substring(0,2).toUpperCase())}</div>
          <div class="rw-top3-name">${MX.esc(u.name)}</div>
          <div class="rw-top3-pts">${u.points} <span>MP</span></div>
          <div class="rw-top3-grade">${g.icon} ${MX.esc(g.name)}</div>
        </div>`;
      });
      top3 += `</div>`;
    }

    return `${gradeBar}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--jour-dim);color:var(--jour)"><i class="fas fa-coins"></i></div>
        <div class="stat-n b">${totalPts}</div>
        <div class="stat-l">Points distribués</div>
        <span class="stat-trend neutral">Total MP</span>
      </div>
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--cyan-dim);color:var(--cyan)"><i class="fas fa-users"></i></div>
        <div class="stat-n g">${activeUsers}</div>
        <div class="stat-l">Utilisateurs actifs</div>
        <span class="stat-trend neutral">Avec des points</span>
      </div>
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--green-dim);color:var(--green)"><i class="fas fa-gift"></i></div>
        <div class="stat-n g">${rewardsBought}</div>
        <div class="stat-l">Récompenses</div>
        <span class="stat-trend neutral">Débloquées</span>
      </div>
      <div class="stat-card">
        <div class="stat-kpi-icon" style="background:var(--orange-dim);color:var(--orange)"><i class="fas fa-gamepad"></i></div>
        <div class="stat-n o">${gamesPlayed}</div>
        <div class="stat-l">Mini-jeux joués</div>
        <span class="stat-trend neutral">Total parties</span>
      </div>
    </div>
    ${top3}`;
  }

  // ── RULES ──
  function _renderRules() {
    const rules = MX.state.rewardsRules || [];
    let h = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div class="section-label" style="margin:0">Règles de points</div>
      <button class="primary-btn" style="width:auto;padding:8px 16px" onclick="MX.Pages.Rewards._openRuleModal()">
        <i class="fas fa-plus"></i> Nouvelle règle
      </button>
    </div>`;
    if (!rules.length) {
      h += `<div class="rw-empty"><i class="fas fa-sliders"></i><p>Aucune règle définie</p></div>`;
    } else {
      h += `<div class="rw-list">`;
      rules.forEach(r => {
        h += `<div class="rw-list-item">
          <div class="rw-li-icon" style="background:var(--${r.active?'cyan':'bg4'}-dim);color:var(--${r.active?'cyan':'text3'})"><i class="fas ${MX.esc(r.icon||'fa-star')}"></i></div>
          <div class="rw-li-body">
            <div class="rw-li-name">${MX.esc(r.label)}</div>
            <div class="rw-li-sub">Événement : <code>${MX.esc(r.event)}</code></div>
          </div>
          <div class="rw-li-pts">+${r.points} <span>MP</span></div>
          <div class="rw-li-acts">
            <button class="icon-btn" onclick="MX.Pages.Rewards._toggleRule('${r.id}',${r.active})" title="${r.active?'Désactiver':'Activer'}">
              <i class="fas fa-${r.active?'toggle-on':'toggle-off'}" style="color:var(--${r.active?'cyan':'text3'})"></i>
            </button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._openRuleModal('${r.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._deleteRule('${r.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
          </div>
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── GRADES ──
  function _renderGrades() {
    const grades = (MX.state.rewardsGrades || []).slice().sort((a, b) => a.minPoints - b.minPoints);
    let h = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div class="section-label" style="margin:0">Grades</div>
      <button class="primary-btn" style="width:auto;padding:8px 16px" onclick="MX.Pages.Rewards._openGradeModal()">
        <i class="fas fa-plus"></i> Nouveau grade
      </button>
    </div><div class="rw-list">`;
    grades.forEach((g, i) => {
      const next = grades[i + 1];
      h += `<div class="rw-list-item">
        <div class="rw-li-icon" style="font-size:22px;background:${g.color}22;border:1px solid ${g.color}44">${g.icon}</div>
        <div class="rw-li-body">
          <div class="rw-li-name" style="color:${g.color}">${MX.esc(g.name)}</div>
          <div class="rw-li-sub">À partir de <b>${g.minPoints} MP</b>${next ? ` · jusqu'à ${next.minPoints - 1} MP` : ' · Grade max'}</div>
        </div>
        <div class="rw-li-acts">
          <button class="icon-btn" onclick="MX.Pages.Rewards._openGradeModal('${g.id}')"><i class="fas fa-pen"></i></button>
          <button class="icon-btn" onclick="MX.Pages.Rewards._deleteGrade('${g.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
        </div>
      </div>`;
    });
    h += `</div>`;
    return h;
  }

  // ── ITEMS ──
  function _renderItems(uid, pts) {
    const items = MX.state.rewardsItems || [];
    const canAdmin = MX.Auth.canSeeAll();
    const hist = MX.state.rewardsHistory || [];
    let h = ``;
    if (canAdmin) {
      h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="section-label" style="margin:0">Catalogue de récompenses</div>
        <button class="primary-btn" style="width:auto;padding:8px 16px" onclick="MX.Pages.Rewards._openItemModal()">
          <i class="fas fa-plus"></i> Ajouter
        </button>
      </div>`;
    } else {
      h += `<div class="section-label">Catalogue de récompenses</div>`;
    }
    if (!items.length) {
      h += `<div class="rw-empty"><i class="fas fa-gift"></i><p>Aucune récompense disponible</p></div>`;
    } else {
      h += `<div class="rw-items-grid">`;
      items.forEach(it => {
        const canBuy = uid && pts >= it.cost && it.available !== false;
        const alreadyGot = hist.filter(h => h.userId === uid && h.event === 'item_redeemed' && h.description && h.description.includes(it.name)).length;
        h += `<div class="rw-item-card${it.available === false ? ' rw-item-unavailable' : ''}">
          <div class="rw-item-icon">${MX.esc(it.icon || '🎁')}</div>
          <div class="rw-item-name">${MX.esc(it.name)}</div>
          <div class="rw-item-desc">${MX.esc(it.description || '')}</div>
          <div class="rw-item-cost"><i class="fas fa-coins" style="color:var(--jour)"></i> ${it.cost} MP</div>
          ${canBuy ? `<button class="rw-item-btn" onclick="MX.Pages.Rewards._buyItem('${it.id}','${MX.esc(it.name)}',${it.cost})">
            <i class="fas fa-shopping-cart"></i> Obtenir
          </button>` : uid ? `<button class="rw-item-btn rw-item-btn-dis" disabled>
            ${pts < it.cost ? `<i class="fas fa-lock"></i> ${it.cost - pts} MP manquants` : '<i class="fas fa-times"></i> Indisponible'}
          </button>` : ''}
          ${canAdmin ? `<div class="rw-item-admin">
            <button class="icon-btn" onclick="MX.Pages.Rewards._openItemModal('${it.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._deleteItem('${it.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._toggleItem('${it.id}',${it.available!==false})" title="${it.available!==false?'Désactiver':'Activer'}">
              <i class="fas fa-${it.available!==false?'eye':'eye-slash'}"></i>
            </button>
          </div>` : ''}
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── MINI-GAMES ──
  function _renderGames(uid, pts) {
    const SPIN_COST = 5;
    const canSpin = uid && pts >= SPIN_COST;
    return `<div class="section-label">Mini-jeux</div>
    <div class="rw-games-grid">
      <div class="rw-game-card">
        <div class="rw-game-header">
          <div class="rw-game-icon">🎰</div>
          <div>
            <div class="rw-game-title">Roue Chance</div>
            <div class="rw-game-sub">Tentez votre chance, remportez des MP !</div>
          </div>
        </div>
        <div class="rw-game-meta"><i class="fas fa-coins" style="color:var(--jour)"></i> Coût : ${SPIN_COST} MP · Gain possible : 0–20 MP</div>
        <div id="rw-spin-area" class="rw-spin-area">
          <div id="rw-spin-drum" class="rw-spin-drum">
            <div class="rw-spin-cell" id="rw-spin-result">?</div>
          </div>
          <div id="rw-spin-msg" class="rw-spin-msg"></div>
        </div>
        ${uid ? (canSpin
          ? `<button class="primary-btn" id="rw-spin-btn" onclick="MX.Pages.Rewards._doSpin(${SPIN_COST})" style="margin-top:12px">
              <i class="fas fa-dice"></i> Tourner (${SPIN_COST} MP)
             </button>`
          : `<button class="primary-btn" disabled style="margin-top:12px;opacity:0.5;cursor:not-allowed">
              <i class="fas fa-lock"></i> ${SPIN_COST - pts} MP manquants
             </button>`)
          : `<div style="font-size:12px;color:var(--text3);margin-top:12px;text-align:center">Connectez-vous pour jouer</div>`}
      </div>
      <div class="rw-game-card">
        <div class="rw-game-header">
          <div class="rw-game-icon">⚡</div>
          <div>
            <div class="rw-game-title">Défi Flash</div>
            <div class="rw-game-sub">Terminez toutes les tâches d'aujourd'hui</div>
          </div>
        </div>
        <div class="rw-game-meta"><i class="fas fa-coins" style="color:var(--jour)"></i> Gratuit · Gain : +3 MP bonus</div>
        ${_renderDailyChallenge(uid)}
      </div>
      <div class="rw-game-card rw-game-coming">
        <div class="rw-game-header">
          <div class="rw-game-icon">🧠</div>
          <div>
            <div class="rw-game-title">Quiz Technique</div>
            <div class="rw-game-sub">Questions sur la maintenance industrielle</div>
          </div>
        </div>
        <div class="rw-coming-badge"><i class="fas fa-hammer"></i> Bientôt disponible</div>
      </div>
    </div>`;
  }

  function _renderDailyChallenge(uid) {
    if (!uid) return `<div style="font-size:12px;color:var(--text3);margin-top:12px;text-align:center">Connectez-vous pour participer</div>`;
    const todayId = MX.todayId();
    let total = 0, done = 0;
    MX.getDaySlots(todayId).forEach(sl => {
      (MX.state.tasks[`${todayId}_${sl}`] || []).forEach(t => {
        total++;
        if (MX.state.checks[`${todayId}_${sl}_${t.id}`]) done++;
      });
    });
    const complete = total > 0 && done === total;
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div style="margin-top:12px">
      <div class="rw-grade-prog-label">
        <span>Progression aujourd'hui</span><span>${done}/${total}</span>
      </div>
      <div class="rw-prog-track" style="margin-bottom:10px"><div class="rw-prog-fill" style="width:${pct}%;background:${complete?'var(--green)':'var(--cyan)'}"></div></div>
      ${complete
        ? `<button class="primary-btn" onclick="MX.Pages.Rewards._claimDailyBonus()" style="background:var(--green);border-color:var(--green)">
             <i class="fas fa-star"></i> Réclamer +3 MP
           </button>`
        : `<div style="font-size:12px;color:var(--text3);text-align:center">Terminez toutes les tâches pour débloquer le bonus</div>`}
    </div>`;
  }

  // ── LEADERBOARD ──
  function _buildRanking(period) {
    const ruMap = MX.state.rewardsUsers || {};
    const hist  = MX.state.rewardsHistory || [];
    const users = MX.state.users || [];
    const now   = Date.now();
    const cutoff = {
      week:  now - 7  * 86400000,
      month: now - 30 * 86400000,
      year:  now - 365* 86400000,
      all:   0
    }[period] || 0;

    if (period === 'all') {
      const result = [];
      Object.entries(ruMap).forEach(([userId, data]) => {
        const user = users.find(u => u.id === userId);
        const name = user ? user.name : data.name || userId;
        result.push({ userId, name, points: data.points || 0 });
      });
      return result.sort((a, b) => b.points - a.points);
    }

    // For time-filtered, sum from history
    const ptsMap = {};
    hist.forEach(e => {
      const ts = e.ts ? (e.ts.toMillis ? e.ts.toMillis() : e.ts.seconds * 1000) : 0;
      if (ts < cutoff) return;
      if (!ptsMap[e.userId]) ptsMap[e.userId] = { userId: e.userId, name: e.userName, points: 0 };
      ptsMap[e.userId].points += (e.points || 0);
    });
    return Object.values(ptsMap).sort((a, b) => b.points - a.points);
  }

  function _renderLeaderboard() {
    const uid = _currentUserId();
    const ranked = _buildRanking(_lbPeriod);
    const medals = ['🥇','🥈','🥉'];
    const periods = [['all','Tout temps'],['year','Cette année'],['month','Ce mois'],['week','Cette semaine']];

    let h = `<div class="rw-lb-filters">`;
    periods.forEach(([id, l]) => {
      h += `<button class="rw-tab${_lbPeriod===id?' active':''}  rw-lb-btn" onclick="MX.Pages.Rewards._lbPeriod('${id}')">${l}</button>`;
    });
    h += `</div>`;

    if (!ranked.length) {
      h += `<div class="rw-empty"><i class="fas fa-ranking-star"></i><p>Aucune donnée pour cette période</p></div>`;
    } else {
      h += `<div class="rw-lb-list">`;
      ranked.forEach((u, i) => {
        const g = _getGrade(u.points);
        const isMe = u.userId === uid;
        h += `<div class="rw-lb-row${isMe?' rw-lb-me':''}">
          <div class="rw-lb-rank">${medals[i] || '#' + (i+1)}</div>
          <div class="rw-lb-avatar" style="background:${g.color}22;color:${g.color}">${MX.esc((u.name||'?').substring(0,2).toUpperCase())}</div>
          <div class="rw-lb-info">
            <div class="rw-lb-name">${MX.esc(u.name)}${isMe?' <span class="rw-me-tag">Moi</span>':''}</div>
            <div class="rw-lb-grade" style="color:${g.color}">${g.icon} ${MX.esc(g.name)}</div>
          </div>
          <div class="rw-lb-pts">${u.points} <span>MP</span></div>
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── HISTORY ──
  function _renderHistory(uid) {
    const hist  = MX.state.rewardsHistory || [];
    const mine  = hist.filter(h => h.userId === uid);
    const canAdmin = MX.Auth.canSeeAll();
    const list = canAdmin ? hist : mine;
    const EVENT_ICONS = {
      task_done:      { i: 'fa-check',          c: 'var(--green)' },
      mission_done:   { i: 'fa-flag-checkered', c: 'var(--cyan)' },
      mission_urgent: { i: 'fa-bolt',           c: 'var(--orange)' },
      day_complete:   { i: 'fa-star',           c: 'var(--jour)' },
      stock_update:   { i: 'fa-box',            c: 'var(--text2)' },
      game_spin:      { i: 'fa-dice',           c: 'var(--soir)' },
      item_redeemed:  { i: 'fa-gift',           c: 'var(--red)' },
      daily_bonus:    { i: 'fa-sun',            c: 'var(--jour)' }
    };

    let h = `<div class="section-label">Historique des points${canAdmin?' (tous les utilisateurs)':' (mes points)'}</div>`;
    if (!list.length) {
      h += `<div class="rw-empty"><i class="fas fa-clock-rotate-left"></i><p>Aucune activité enregistrée</p></div>`;
    } else {
      h += `<div class="rw-hist-list">`;
      list.slice(0, 100).forEach(e => {
        const ic = EVENT_ICONS[e.event] || { i: 'fa-star', c: 'var(--cyan)' };
        const pts = (e.points || 0);
        const sign = pts >= 0 ? '+' : '';
        const col  = pts >= 0 ? 'var(--green)' : 'var(--red)';
        h += `<div class="rw-hist-row">
          <div class="rw-hist-icon" style="background:${ic.c}22;color:${ic.c}"><i class="fas ${ic.i}"></i></div>
          <div class="rw-hist-body">
            <div class="rw-hist-desc">${MX.esc(e.description || e.event)}</div>
            ${canAdmin ? `<div class="rw-hist-user">${MX.esc(e.userName || e.userId)}</div>` : ''}
            <div class="rw-hist-time">${MX.fmtTime(e.ts)}</div>
          </div>
          <div class="rw-hist-pts" style="color:${col}">${sign}${pts} MP</div>
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── MODALS ──
  function _openRuleModal(id) {
    const rule = id ? (MX.state.rewardsRules || []).find(r => r.id === id) : null;
    const events = [
      ['task_done','Tâche terminée'],
      ['mission_done','Intervention terminée'],
      ['mission_urgent','Intervention urgente'],
      ['day_complete','Toutes tâches du jour'],
      ['stock_update','Stock mis à jour']
    ];
    const evtOpts = events.map(([v, l]) =>
      `<option value="${v}"${rule && rule.event===v?' selected':''}>${l}</option>`
    ).join('');
    MX.showModal({
      title: id ? 'Modifier la règle' : 'Nouvelle règle',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Libellé</label>
          <input class="fi" id="rr-label" value="${MX.esc(rule ? rule.label : '')}" placeholder="Ex: Tâche terminée"></div>
        <div class="form-group"><label>Événement déclencheur</label>
          <select class="fi" id="rr-event">${evtOpts}</select></div>
        <div class="form-group"><label>Points (MP)</label>
          <input class="fi" id="rr-pts" type="number" min="0" value="${rule ? rule.points : 1}"></div>
        <div class="form-group"><label>Icône FontAwesome</label>
          <input class="fi" id="rr-icon" value="${MX.esc(rule ? (rule.icon||'fa-star') : 'fa-star')}" placeholder="fa-star"></div>
      </div>`,
      actions: [
        { label: id ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: () => _saveRule(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _saveRule(id) {
    const label = (document.getElementById('rr-label')||{}).value?.trim();
    const event = (document.getElementById('rr-event')||{}).value;
    const points = parseInt((document.getElementById('rr-pts')||{}).value) || 0;
    const icon  = (document.getElementById('rr-icon')||{}).value?.trim() || 'fa-star';
    if (!label || !event) { MX.toast('Remplissez tous les champs', true); return; }
    try {
      if (id) await MX.DB.updateRewardsRule(id, { label, event, points, icon });
      else    await MX.DB.addRewardsRule({ label, event, points, icon, active: true });
      MX.toast('Règle enregistrée ✓');
    } catch(e) { MX.toast('Erreur : ' + e.message, true); }
  }

  async function _toggleRule(id, active) {
    try { await MX.DB.updateRewardsRule(id, { active: !active }); }
    catch(e) { MX.toast('Erreur', true); }
  }

  function _deleteRule(id) {
    MX.showModal('Supprimer la règle ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteRewardsRule(id); MX.toast('Règle supprimée'); }
        catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _openGradeModal(id) {
    const g = id ? (MX.state.rewardsGrades || []).find(x => x.id === id) : null;
    MX.showModal({
      title: id ? 'Modifier le grade' : 'Nouveau grade',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Nom du grade</label>
          <input class="fi" id="rg-name" value="${MX.esc(g ? g.name : '')}" placeholder="Ex: Expert"></div>
        <div class="form-group"><label>Points minimum (MP)</label>
          <input class="fi" id="rg-pts" type="number" min="0" value="${g ? g.minPoints : 0}"></div>
        <div class="form-group"><label>Emoji / Icône</label>
          <input class="fi" id="rg-icon" value="${MX.esc(g ? g.icon : '🔧')}" placeholder="🔧"></div>
        <div class="form-group"><label>Couleur (hex)</label>
          <input class="fi" id="rg-color" type="color" value="${g ? g.color : '#3B82F6'}"></div>
      </div>`,
      actions: [
        { label: id ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: () => _saveGrade(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _saveGrade(id) {
    const name = (document.getElementById('rg-name')||{}).value?.trim();
    const minPoints = parseInt((document.getElementById('rg-pts')||{}).value) || 0;
    const icon  = (document.getElementById('rg-icon')||{}).value?.trim() || '🔧';
    const color = (document.getElementById('rg-color')||{}).value || '#3B82F6';
    if (!name) { MX.toast('Nom requis', true); return; }
    try {
      if (id) await MX.DB.updateRewardsGrade(id, { name, minPoints, icon, color });
      else    await MX.DB.addRewardsGrade({ name, minPoints, icon, color });
      MX.toast('Grade enregistré ✓');
    } catch(e) { MX.toast('Erreur : ' + e.message, true); }
  }

  function _deleteGrade(id) {
    MX.showModal('Supprimer le grade ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteRewardsGrade(id); MX.toast('Grade supprimé'); }
        catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  function _openItemModal(id) {
    const it = id ? (MX.state.rewardsItems || []).find(x => x.id === id) : null;
    MX.showModal({
      title: id ? 'Modifier la récompense' : 'Nouvelle récompense',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Nom</label>
          <input class="fi" id="ri-name" value="${MX.esc(it ? it.name : '')}" placeholder="Ex: Café offert"></div>
        <div class="form-group"><label>Description</label>
          <input class="fi" id="ri-desc" value="${MX.esc(it ? (it.description||'') : '')}" placeholder="Courte description"></div>
        <div class="form-group"><label>Coût (MP)</label>
          <input class="fi" id="ri-cost" type="number" min="0" value="${it ? it.cost : 50}"></div>
        <div class="form-group"><label>Emoji</label>
          <input class="fi" id="ri-icon" value="${MX.esc(it ? (it.icon||'🎁') : '🎁')}" placeholder="🎁"></div>
      </div>`,
      actions: [
        { label: id ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: () => _saveItem(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }

  async function _saveItem(id) {
    const name = (document.getElementById('ri-name')||{}).value?.trim();
    const description = (document.getElementById('ri-desc')||{}).value?.trim() || '';
    const cost = parseInt((document.getElementById('ri-cost')||{}).value) || 0;
    const icon = (document.getElementById('ri-icon')||{}).value?.trim() || '🎁';
    if (!name) { MX.toast('Nom requis', true); return; }
    try {
      if (id) await MX.DB.updateRewardsItem(id, { name, description, cost, icon });
      else    await MX.DB.addRewardsItem({ name, description, cost, icon, available: true });
      MX.toast('Récompense enregistrée ✓');
    } catch(e) { MX.toast('Erreur : ' + e.message, true); }
  }

  function _deleteItem(id) {
    MX.showModal('Supprimer la récompense ?', 'Cette action est irréversible.', [
      { label: 'Supprimer', cls: 'danger', fn: async () => {
        try { await MX.DB.deleteRewardsItem(id); MX.toast('Récompense supprimée'); }
        catch(e) { MX.toast('Erreur', true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  async function _toggleItem(id, available) {
    try { await MX.DB.updateRewardsItem(id, { available: !available }); }
    catch(e) { MX.toast('Erreur', true); }
  }

  // ── BUY ITEM ──
  function _buyItem(id, name, cost) {
    const uid = _currentUserId();
    const uname = _currentUserName();
    if (!uid) { MX.toast('Connectez-vous pour acheter', true); return; }
    MX.showModal(`Obtenir "${name}" ?`, `Cela coûtera ${cost} MP. Continuer ?`, [
      { label: 'Confirmer', cls: 'confirm', fn: async () => {
        try {
          await MX.DB.spendPoints(uid, cost);
          await MX.DB.awardPoints(uid, uname, 'item_redeemed', -cost, `Récompense obtenue : ${name}`);
          MX.toast('Récompense obtenue ! 🎁');
        } catch(e) {
          MX.toast(e.message === 'not_enough' ? 'Pas assez de MP' : 'Erreur', true);
        }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── SPIN GAME ──
  async function _doSpin(cost) {
    if (_spinBusy) return;
    const uid = _currentUserId();
    const uname = _currentUserName();
    if (!uid) return;
    _spinBusy = true;

    const btn = document.getElementById('rw-spin-btn');
    const drum = document.getElementById('rw-spin-drum');
    const result = document.getElementById('rw-spin-result');
    const msg = document.getElementById('rw-spin-msg');
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = '';

    try {
      await MX.DB.spendPoints(uid, cost);
    } catch(e) {
      MX.toast('Pas assez de MP', true);
      _spinBusy = false;
      if (btn) btn.disabled = false;
      return;
    }

    // Animation
    const frames = ['🎰','💫','⭐','🎲','🌟','💎','🎯','🏆','🎪','🎉'];
    let frameIdx = 0;
    const animInterval = setInterval(() => {
      if (result) result.textContent = frames[frameIdx % frames.length];
      if (drum)   drum.classList.add('rw-spin-anim');
      frameIdx++;
    }, 80);

    await new Promise(r => setTimeout(r, 2200));
    clearInterval(animInterval);
    if (drum) drum.classList.remove('rw-spin-anim');

    // Determine result
    const PRIZES = [0,0,1,1,1,2,2,3,5,5,8,10,15,20];
    const won = PRIZES[Math.floor(Math.random() * PRIZES.length)];
    const emojis = { 0:'😢', 1:'😊', 2:'😊', 3:'😄', 5:'🎉', 8:'🎉', 10:'🏆', 15:'💎', 20:'🌟' };
    const wonEmoji = emojis[won] || '⭐';

    if (result) result.textContent = won > 0 ? wonEmoji : '💀';
    if (msg) {
      msg.textContent = won > 0 ? `+${won} MP remportés !` : 'Pas de chance cette fois…';
      msg.style.color = won > 0 ? 'var(--green)' : 'var(--text3)';
    }

    if (won > 0) {
      await MX.DB.awardPoints(uid, uname, 'game_spin', won, `Roue Chance : +${won} MP remportés`);
      MX.toast(`🎰 Vous gagnez ${won} MP !`);
    } else {
      await MX.DB.awardPoints(uid, uname, 'game_spin', 0, `Roue Chance : rien cette fois`);
      MX.toast('Pas de chance cette fois…');
    }

    _spinBusy = false;
    if (btn) btn.disabled = false;
  }

  // ── DAILY BONUS ──
  async function _claimDailyBonus() {
    const uid = _currentUserId();
    const uname = _currentUserName();
    if (!uid) return;
    const todayKey = 'mx_daily_bonus_' + uid + '_' + new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(todayKey)) {
      MX.toast('Bonus déjà réclamé aujourd\'hui', true); return;
    }
    try {
      await MX.DB.awardPoints(uid, uname, 'daily_bonus', 3, 'Bonus quotidien : toutes les tâches terminées');
      localStorage.setItem(todayKey, '1');
      MX.toast('🌟 +3 MP bonus quotidien !');
      render();
    } catch(e) { MX.toast('Erreur', true); }
  }

  // ── EXPORTS ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Rewards = {
    render,
    awardForEvent,
    _tab: switchTab,
    _lbPeriod: function(p) { _lbPeriod = p; render(); },
    _openRuleModal, _toggleRule, _deleteRule,
    _openGradeModal, _deleteGrade,
    _openItemModal, _deleteItem, _toggleItem,
    _buyItem, _doSpin, _claimDailyBonus
  };
})();
