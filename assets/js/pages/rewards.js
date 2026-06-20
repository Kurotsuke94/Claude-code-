(function () {
  let _tab = 'overview';
  let _lbPeriod = 'all';
  let _spinBusy = false;

  // ── INSTANT GAMES (spin + daily) ──
  const GAMES = [
    { id: 'spin',  icon: '🎰', name: 'Roue Chance', desc: 'Tentez votre chance et remportez des MP !',          unlockPts: 0, costPerPlay: 5, maxPlays: null },
    { id: 'daily', icon: '⚡', name: 'Défi Flash',  desc: 'Terminez toutes les tâches du jour, gagnez +3 MP.', unlockPts: 0, costPerPlay: 0, maxPlays: 1   }
  ];

  // ── GRADE HELPERS ──
  function _getGrade(points) {
    const grades = (MX.state.rewardsGrades || []).slice().sort((a, b) => b.minPoints - a.minPoints);
    return grades.find(g => points >= g.minPoints)
      || { name: 'Recrue', icon: '🔩', color: '#6B7280', minPoints: 0 };
  }
  function _getNextGrade(points) {
    const grades = (MX.state.rewardsGrades || []).slice().sort((a, b) => a.minPoints - b.minPoints);
    return grades.find(g => g.minPoints > points) || null;
  }
  function _gradeBadgeHtml(points, opts) {
    opts = opts || {};
    const g = _getGrade(points);
    const size = opts.small ? 'font-size:10px;padding:1px 6px' : 'font-size:11px;padding:2px 8px';
    return `<span class="rw-grade-badge" style="${size};background:${g.color}22;border:1px solid ${g.color}55;color:${g.color};border-radius:20px;font-family:var(--ffm);white-space:nowrap">${g.icon} ${MX.esc(g.name)}</span>`;
  }

  // ── USER HELPERS ──
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
  function _nameToUserId(name) {
    const u = (MX.state.users || []).find(x => x.name === name);
    return u ? u.id : null;
  }
  function _userPointsByName(name) {
    const uid = _nameToUserId(name);
    return uid ? _userPoints(uid) : 0;
  }

  // ── AWARD POINTS (called from hooks in app.js) ──
  async function awardForEvent(event, context) {
    const uid   = _currentUserId();
    const uname = _currentUserName();
    if (!uid || !uname) return;
    const rules = (MX.state.rewardsRules || []).filter(r => r.active && r.event === event);
    if (!rules.length) return;
    const pts = rules[0].points || 0;
    if (pts <= 0) return;
    try {
      await MX.DB.awardPoints(uid, uname, event, pts, context || rules[0].label);
    } catch(e) { console.warn('awardPoints:', e); }
  }

  // ── TAB SWITCH ──
  function switchTab(tab) { _tab = tab; render(); }

  // ── MAIN RENDER ──
  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const canAdmin = MX.Auth.canSeeAll();
    const uid  = _currentUserId();
    const pts  = uid ? _userPoints(uid) : 0;
    const grade    = _getGrade(pts);
    const nextGrade = _getNextGrade(pts);
    const pct = nextGrade
      ? Math.min(100, Math.round((pts - grade.minPoints) / (nextGrade.minPoints - grade.minPoints) * 100))
      : 100;

    const TABS = [
      { id: 'overview',    icon: 'fa-gauge',            l: '📊 Aperçu' },
      { id: 'rules',       icon: 'fa-sliders',          l: '⚙️ Règles',    adminOnly: true },
      { id: 'grades',      icon: 'fa-layer-group',      l: '🏅 Grades',    adminOnly: true },
      { id: 'items',       icon: 'fa-gift',             l: '🎁 Récompenses' },
      { id: 'games',       icon: 'fa-gamepad',          l: '🎮 Mini-jeux' },
      { id: 'leaderboard', icon: 'fa-ranking-star',     l: '🏆 Classement' },
      { id: 'history',     icon: 'fa-clock-rotate-left',l: '📜 Historique' }
    ];

    let h = `<div class="ph">
      <div class="ph-eye">GAMIFICATION</div>
      <div class="ph-row">
        <div>
          <div class="ph-title">🏆 Récompenses Maintix</div>
          <div class="ph-sub">Gagnez des points en accomplissant vos missions</div>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div class="rw-tabs">`;

    TABS.forEach(t => {
      if (t.adminOnly && !canAdmin) return;
      h += `<button class="rw-tab${_tab === t.id ? ' active' : ''}" onclick="MX.Pages.Rewards._tab('${t.id}')">${t.l}</button>`;
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
    const hist  = MX.state.rewardsHistory || [];
    const ruMap = MX.state.rewardsUsers  || {};

    const totalPts      = Object.values(ruMap).reduce((s, u) => s + (u.points || 0), 0);
    const activeUsers   = Object.keys(ruMap).filter(k => (ruMap[k].points || 0) > 0).length;
    const rewardsBought = hist.filter(h => h.event === 'item_redeemed').length;
    const gamesPlayed   = hist.filter(h => h.event === 'game_spin' || h.event === 'daily_bonus').length;

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
        ${nextGrade
          ? `<div class="rw-grade-right">
              <div class="rw-grade-prog-label">
                <span>Vers ${MX.esc(nextGrade.name)} ${nextGrade.icon}</span>
                <span>${pts} / ${nextGrade.minPoints} MP</span>
              </div>
              <div class="rw-prog-track"><div class="rw-prog-fill" style="width:${pct}%;background:${grade.color}"></div></div>
              <div style="font-size:11px;color:var(--text3);margin-top:4px">Encore <b>${nextGrade.minPoints - pts} MP</b> pour avancer</div>
             </div>`
          : `<div class="rw-grade-right"><div style="font-size:13px;color:var(--jour);font-weight:600">🏆 Grade maximum atteint !</div></div>`}
      </div>`;
    } else {
      gradeBar = `<div class="rw-grade-card" style="justify-content:center;text-align:center">
        <div style="color:var(--text3);font-size:13px"><i class="fas fa-user-circle" style="font-size:28px;opacity:0.3;display:block;margin-bottom:8px"></i>Connectez-vous pour voir votre grade</div>
      </div>`;
    }

    // All users ranking preview
    const ranked = _buildRanking('all');
    const medals = ['🥇','🥈','🥉'];
    let top3 = '';
    if (ranked.length) {
      top3 = `<div class="section-label">Top du classement</div><div class="rw-top3">`;
      ranked.slice(0, 3).forEach((u, i) => {
        const g = _getGrade(u.points);
        top3 += `<div class="rw-top3-card" onclick="MX.Pages.Rewards._tab('leaderboard')">
          <div class="rw-top3-medal">${medals[i] || i + 1}</div>
          <div class="rw-top3-avatar" style="background:${g.color}22;color:${g.color}">${MX.esc((u.name || '?').substring(0, 2).toUpperCase())}</div>
          <div class="rw-top3-name">${MX.esc(u.name)}</div>
          <div class="rw-top3-pts">${u.points} <span>MP</span></div>
          <div class="rw-top3-grade" style="color:${g.color}">${g.icon} ${MX.esc(g.name)}</div>
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
        <span class="stat-trend neutral">Total MP cumulés</span>
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
    const isAdmin = MX.Auth.isAdmin();
    let h = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="section-label" style="margin:0">Règles de points</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isAdmin ? `<button class="primary-btn" style="width:auto;padding:8px 14px;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.Rewards._resetDefaults()">
          <i class="fas fa-rotate"></i> Réinitialiser
        </button>` : ''}
        <button class="primary-btn" style="width:auto;padding:8px 14px" onclick="MX.Pages.Rewards._openRuleModal()">
          <i class="fas fa-plus"></i> Nouvelle règle
        </button>
      </div>
    </div>`;

    const EVENT_LABELS = {
      task_done: 'Tâche terminée', mission_done: 'Intervention terminée', mission_urgent: 'Intervention urgente',
      day_complete: 'Toutes tâches du jour', stock_update: 'Stock mis à jour',
      permanence: 'Permanence prise', no_late: 'Zéro tâche en retard', suggestion: 'Amélioration validée',
      mission_resolved: 'Mission résolue', manual: 'Attribution manuelle'
    };

    if (!rules.length) {
      h += `<div class="rw-empty"><i class="fas fa-sliders"></i><p>Aucune règle définie. Cliquez sur "Réinitialiser" pour charger les défauts.</p></div>`;
    } else {
      h += `<div class="rw-list">`;
      rules.forEach(r => {
        const evLabel = EVENT_LABELS[r.event] || r.event;
        h += `<div class="rw-list-item">
          <div class="rw-li-icon" style="background:var(--${r.active ? 'cyan' : 'bg4'});background:${r.active ? 'var(--cyan-dim)' : 'var(--bg4)'};color:var(--${r.active ? 'cyan' : 'text3'})">
            <i class="fas ${MX.esc(r.icon || 'fa-star')}"></i>
          </div>
          <div class="rw-li-body">
            <div class="rw-li-name">${MX.esc(r.label)}</div>
            <div class="rw-li-sub">${MX.esc(evLabel)}</div>
          </div>
          <div class="rw-li-pts">+${r.points} <span>MP</span></div>
          <div class="rw-li-acts">
            <button class="icon-btn" onclick="MX.Pages.Rewards._toggleRule('${r.id}',${!!r.active})" title="${r.active ? 'Désactiver' : 'Activer'}">
              <i class="fas fa-${r.active ? 'toggle-on' : 'toggle-off'}" style="color:var(--${r.active ? 'cyan' : 'text3'});font-size:16px"></i>
            </button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._openRuleModal('${r.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._deleteRule('${r.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
          </div>
        </div>`;
      });
      h += `</div>`;
    }

    // Also show manual award for admin
    if (MX.Auth.isAdmin()) {
      h += `<div class="section-label" style="margin-top:16px">Attribution manuelle</div>
      <div class="rw-manual-award">
        <div class="rw-manual-row">
          <select class="fi" id="rw-man-user" style="flex:1">
            <option value="">Choisir un utilisateur…</option>
            ${(MX.state.users || []).map(u => `<option value="${u.id}|${MX.esc(u.name)}">${MX.esc(u.name)}</option>`).join('')}
          </select>
          <input class="fi" id="rw-man-pts" type="number" placeholder="MP" style="width:80px" min="-9999" max="9999">
          <input class="fi" id="rw-man-reason" placeholder="Raison…" style="flex:2">
          <button class="primary-btn" style="width:auto;padding:8px 14px;flex-shrink:0" onclick="MX.Pages.Rewards._manualAward()">
            <i class="fas fa-hand-holding-dollar"></i> Attribuer
          </button>
        </div>
      </div>`;
    }
    return h;
  }

  // ── GRADES ──
  function _renderGrades() {
    const grades = (MX.state.rewardsGrades || []).slice().sort((a, b) => a.minPoints - b.minPoints);
    const users  = MX.state.users || [];
    const ruMap  = MX.state.rewardsUsers || {};

    let h = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div class="section-label" style="margin:0">Grades &amp; Progression</div>
      <button class="primary-btn" style="width:auto;padding:8px 14px" onclick="MX.Pages.Rewards._openGradeModal()">
        <i class="fas fa-plus"></i> Nouveau grade
      </button>
    </div>`;

    if (!grades.length) {
      h += `<div class="rw-empty"><i class="fas fa-layer-group"></i><p>Aucun grade défini</p></div>`;
    } else {
      h += `<div class="rw-list">`;
      grades.forEach((g, i) => {
        const next = grades[i + 1];
        h += `<div class="rw-list-item">
          <div class="rw-li-icon" style="font-size:22px;background:${g.color}22;border:1px solid ${g.color}44">${g.icon}</div>
          <div class="rw-li-body">
            <div class="rw-li-name" style="color:${g.color}">${MX.esc(g.name)}</div>
            <div class="rw-li-sub">À partir de <b>${g.minPoints} MP</b>${next ? ` · jusqu'à ${next.minPoints - 1} MP` : ' · 🏆 Grade maximum'}</div>
          </div>
          <div class="rw-li-acts">
            <button class="icon-btn" onclick="MX.Pages.Rewards._openGradeModal('${g.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._deleteGrade('${g.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
          </div>
        </div>`;
      });
      h += `</div>`;
    }

    // User progress section
    if (users.length) {
      h += `<div class="section-label" style="margin-top:16px">Progression des utilisateurs</div><div class="rw-list">`;
      users.forEach(u => {
        const uid = u.id;
        const upts = (ruMap[uid] || {}).points || 0;
        const g = _getGrade(upts);
        const ng = _getNextGrade(upts);
        const pct = ng ? Math.min(100, Math.round((upts - g.minPoints) / (ng.minPoints - g.minPoints) * 100)) : 100;
        const nc = MX.userColors(u.name);
        const bg = u.color || nc.bg;
        const fg = u.color ? MX._contrastColor(u.color) : nc.fg;
        h += `<div class="rw-list-item" style="flex-direction:column;align-items:stretch;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="width:32px;height:32px;border-radius:9px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${MX.esc(u.name.substring(0,2).toUpperCase())}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600">${MX.esc(u.name)}</div>
              <div>${_gradeBadgeHtml(upts, { small: true })}</div>
            </div>
            <div style="font-family:var(--ffm);font-size:14px;font-weight:700;color:var(--jour)">${upts} <span style="font-size:10px;color:var(--text3);font-weight:400">MP</span></div>
          </div>
          <div class="rw-grade-prog-label">
            <span style="font-size:10px;color:var(--text3)">${g.icon} ${MX.esc(g.name)}</span>
            <span style="font-size:10px;color:var(--text3)">${ng ? upts + ' / ' + ng.minPoints + ' MP' : 'Grade max 🏆'}</span>
          </div>
          <div class="rw-prog-track" style="height:5px"><div class="rw-prog-fill" style="width:${pct}%;background:${g.color}"></div></div>
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── ITEMS ──
  function _renderItems(uid, pts) {
    const items    = MX.state.rewardsItems || [];
    const canAdmin = MX.Auth.canSeeAll();
    let h = ``;
    if (canAdmin) {
      h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="section-label" style="margin:0">Catalogue de récompenses</div>
        <button class="primary-btn" style="width:auto;padding:8px 14px" onclick="MX.Pages.Rewards._openItemModal()">
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
        const avail  = it.available !== false;
        const canBuy = uid && pts >= it.cost && avail;
        h += `<div class="rw-item-card${!avail ? ' rw-item-unavailable' : ''}">
          <div class="rw-item-icon">${MX.esc(it.icon || '🎁')}</div>
          <div class="rw-item-name">${MX.esc(it.name)}</div>
          <div class="rw-item-desc">${MX.esc(it.description || '')}</div>
          <div class="rw-item-cost"><i class="fas fa-coins" style="color:var(--jour)"></i> ${it.cost} MP</div>
          ${uid
            ? (canBuy
                ? `<button class="rw-item-btn" onclick="MX.Pages.Rewards._buyItem('${it.id}','${MX.esc(it.name)}',${it.cost})">
                     <i class="fas fa-shopping-cart"></i> Obtenir
                   </button>`
                : `<button class="rw-item-btn rw-item-btn-dis" disabled>
                     ${!avail ? '<i class="fas fa-times"></i> Indisponible' : `<i class="fas fa-lock"></i> ${it.cost - pts} MP manquants`}
                   </button>`)
            : ''}
          ${canAdmin ? `<div class="rw-item-admin">
            <button class="icon-btn" onclick="MX.Pages.Rewards._openItemModal('${it.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._deleteItem('${it.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
            <button class="icon-btn" onclick="MX.Pages.Rewards._toggleItem('${it.id}',${avail})" title="${avail ? 'Désactiver' : 'Activer'}">
              <i class="fas fa-${avail ? 'eye' : 'eye-slash'}"></i>
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
    // ── Instant games (spin + daily) ──
    let h = `<div class="section-label">Jeux instantanés</div><div class="rw-games-grid">`;
    GAMES.forEach(game => {
      const locked = pts < game.unlockPts;
      h += `<div class="rw-game-card${locked?' rw-game-locked':''}">
        <div class="rw-game-header">
          <div class="rw-game-icon">${game.icon}</div>
          <div>
            <div class="rw-game-title">${MX.esc(game.name)}</div>
            <div class="rw-game-sub">${MX.esc(game.desc)}</div>
          </div>
        </div>
        <div class="rw-game-meta">
          ${game.costPerPlay > 0 ? `<i class="fas fa-coins" style="color:var(--jour)"></i> Coût : ${game.costPerPlay} MP` : '<i class="fas fa-star" style="color:var(--jour)"></i> Gratuit'}
        </div>`;
      if (game.id === 'spin')  h += _renderSpinGame(uid, pts, game.costPerPlay);
      if (game.id === 'daily') h += _renderDailyChallenge(uid);
      h += `</div>`;
    });
    h += `</div>`;

    // ── Arcade mini-games (from minigames.js) ──
    const MG = window.MX.Pages && window.MX.Pages.MiniGames ? window.MX.Pages.MiniGames.META : [];
    if (MG.length) {
      h += `<div class="section-label" style="margin-top:20px">Jeux d'arcade <button class="icon-btn" style="font-size:11px;color:var(--text2);margin-left:8px" onclick="MX.Pages.MiniGames.render()"><i class="fas fa-arrow-up-right-from-square"></i> Ouvrir le hub</button></div>
      <div class="mg-grid">`;
      MG.forEach(g => {
        const locked   = pts < g.unlockPts;
        const scores   = (MX.state.gameScores||[]).filter(s => s.userId === uid && s.gameId === g.id);
        const best     = scores.reduce((b,s) => s.score > b ? s.score : b, 0);
        h += `<div class="mg-card${locked?' mg-locked':''}">
          <div class="mg-icon" style="${locked?'filter:grayscale(1);opacity:0.4':''}">${g.icon}</div>
          <div class="mg-name">${MX.esc(g.name)}</div>
          <div class="mg-desc">${MX.esc(g.desc)}</div>`;
        if (locked) {
          const pct = Math.round(pts/g.unlockPts*100);
          h += `<div class="rw-lock-bar" style="margin-top:8px">
            <div class="rw-prog-track"><div class="rw-prog-fill" style="width:${pct}%;background:var(--text3)"></div></div>
            <div style="font-size:11px;color:var(--text3);text-align:center;margin-top:4px"><i class="fas fa-lock"></i> Encore <b>${g.unlockPts - pts} MP</b></div>
          </div>`;
        } else {
          h += `<div class="mg-footer" style="margin-top:8px">
            ${best>0 ? `<span style="font-size:11px;color:var(--text3)"><i class="fas fa-star" style="color:var(--jour)"></i> Best: ${best}</span>` : '<span></span>'}
            ${uid ? `<button class="primary-btn mg-play-btn" onclick="MX.Pages.MiniGames._go('${g.id}')"><i class="fas fa-play"></i> Jouer</button>` : ''}
          </div>`;
        }
        h += `</div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  function _renderSpinGame(uid, pts, cost) {
    const canSpin = pts >= cost;
    return `<div id="rw-spin-area" class="rw-spin-area">
      <div id="rw-spin-drum" class="rw-spin-drum">
        <div class="rw-spin-cell" id="rw-spin-result">?</div>
      </div>
      <div id="rw-spin-msg" class="rw-spin-msg"></div>
    </div>
    ${canSpin
      ? `<button class="primary-btn" id="rw-spin-btn" onclick="MX.Pages.Rewards._doSpin(${cost})" style="margin-top:12px">
           <i class="fas fa-dice"></i> Tourner (${cost} MP)
         </button>`
      : `<button class="primary-btn" disabled style="margin-top:12px;opacity:0.5;cursor:not-allowed">
           <i class="fas fa-lock"></i> ${cost - pts} MP manquants
         </button>`}`;
  }

  function _renderDailyChallenge(uid) {
    if (!uid) return `<div style="font-size:12px;color:var(--text3);margin-top:12px;text-align:center">Connectez-vous pour participer</div>`;
    const todayId  = MX.todayId();
    let total = 0, done = 0;
    MX.getDaySlots(todayId).forEach(sl => {
      (MX.state.tasks[`${todayId}_${sl}`] || []).forEach(t => {
        total++;
        if (MX.state.checks[`${todayId}_${sl}_${t.id}`]) done++;
      });
    });
    const complete = total > 0 && done === total;
    const pct      = total ? Math.round(done / total * 100) : 0;
    const todayKey = 'mx_daily_bonus_' + uid + '_' + new Date().toISOString().slice(0, 10);
    const claimed  = !!localStorage.getItem(todayKey);

    return `<div style="margin-top:12px">
      <div class="rw-grade-prog-label">
        <span>Tâches aujourd'hui</span><span>${done} / ${total}</span>
      </div>
      <div class="rw-prog-track" style="margin-bottom:10px">
        <div class="rw-prog-fill" style="width:${pct}%;background:${complete ? 'var(--green)' : 'var(--cyan)'}"></div>
      </div>
      ${claimed
        ? `<div style="font-size:12px;color:var(--green);text-align:center"><i class="fas fa-check-circle"></i> Bonus réclamé aujourd'hui !</div>`
        : complete
          ? `<button class="primary-btn" onclick="MX.Pages.Rewards._claimDailyBonus()" style="background:var(--green);border-color:var(--green)">
               <i class="fas fa-star"></i> Réclamer +3 MP
             </button>`
          : `<div style="font-size:12px;color:var(--text3);text-align:center">Terminez toutes les tâches pour débloquer</div>`}
    </div>`;
  }

  // ── LEADERBOARD ──
  function _buildRanking(period) {
    const ruMap = MX.state.rewardsUsers  || {};
    const hist  = MX.state.rewardsHistory || [];
    const users = MX.state.users || [];
    const now   = Date.now();
    const cutoff = { week: now - 7*86400000, month: now - 30*86400000, year: now - 365*86400000, all: 0 }[period] || 0;

    if (period === 'all') {
      const result = [];
      Object.entries(ruMap).forEach(([userId, data]) => {
        const u = users.find(x => x.id === userId);
        result.push({ userId, name: u ? u.name : (data.name || userId), points: Math.max(0, data.points || 0) });
      });
      return result.filter(r => r.points > 0).sort((a, b) => b.points - a.points);
    }

    const ptsMap = {};
    hist.forEach(e => {
      if ((e.points || 0) <= 0) return;
      const ts = e.ts ? (e.ts.toMillis ? e.ts.toMillis() : e.ts.seconds * 1000) : 0;
      if (ts < cutoff) return;
      if (!ptsMap[e.userId]) ptsMap[e.userId] = { userId: e.userId, name: e.userName, points: 0 };
      ptsMap[e.userId].points += e.points;
    });
    return Object.values(ptsMap).filter(r => r.points > 0).sort((a, b) => b.points - a.points);
  }

  function _renderLeaderboard() {
    const uid     = _currentUserId();
    const ranked  = _buildRanking(_lbPeriod);
    const medals  = ['🥇','🥈','🥉'];
    const periods = [['all','Tout temps'],['year','Cette année'],['month','Ce mois'],['week','Cette semaine']];

    let h = `<div class="rw-lb-filters">`;
    periods.forEach(([id, l]) => {
      h += `<button class="rw-tab${_lbPeriod === id ? ' active' : ''} rw-lb-btn" onclick="MX.Pages.Rewards._lbPeriod('${id}')">${l}</button>`;
    });
    h += `</div>`;

    if (!ranked.length) {
      h += `<div class="rw-empty"><i class="fas fa-ranking-star"></i><p>Aucune donnée pour cette période</p></div>`;
    } else {
      h += `<div class="rw-lb-list">`;
      ranked.forEach((u, i) => {
        const g    = _getGrade(u.points);
        const isMe = u.userId === uid;
        h += `<div class="rw-lb-row${isMe ? ' rw-lb-me' : ''}">
          <div class="rw-lb-rank">${medals[i] || '#' + (i + 1)}</div>
          <div class="rw-lb-avatar" style="background:${g.color}22;color:${g.color}">${MX.esc((u.name || '?').substring(0, 2).toUpperCase())}</div>
          <div class="rw-lb-info">
            <div class="rw-lb-name">${MX.esc(u.name)}${isMe ? ' <span class="rw-me-tag">Moi</span>' : ''}</div>
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
    const hist     = MX.state.rewardsHistory || [];
    const canAdmin = MX.Auth.canSeeAll();
    const list     = canAdmin ? hist : hist.filter(h => h.userId === uid);

    const EVENT_ICONS = {
      task_done:       { i: 'fa-check',           c: 'var(--green)' },
      mission_done:    { i: 'fa-flag-checkered',  c: 'var(--cyan)' },
      mission_urgent:  { i: 'fa-bolt',            c: 'var(--orange)' },
      day_complete:    { i: 'fa-star',             c: 'var(--jour)' },
      stock_update:    { i: 'fa-box',              c: 'var(--text2)' },
      permanence:      { i: 'fa-shield',           c: 'var(--cyan)' },
      no_late:         { i: 'fa-calendar-check',   c: 'var(--green)' },
      suggestion:      { i: 'fa-lightbulb',        c: 'var(--jour)' },
      mission_resolved:{ i: 'fa-check-double',     c: 'var(--green)' },
      game_spin:       { i: 'fa-dice',             c: 'var(--soir)' },
      item_redeemed:   { i: 'fa-gift',             c: 'var(--red)' },
      daily_bonus:     { i: 'fa-sun',              c: 'var(--jour)' },
      manual:          { i: 'fa-hand-holding-dollar', c: 'var(--cyan)' }
    };

    let h = `<div class="section-label">
      Historique des points${canAdmin ? ' — tous les utilisateurs' : ' — mes points'}
    </div>`;

    if (!list.length) {
      h += `<div class="rw-empty"><i class="fas fa-clock-rotate-left"></i><p>Aucune activité enregistrée</p></div>`;
    } else {
      h += `<div class="rw-hist-list">`;
      list.slice(0, 150).forEach(e => {
        const ic   = EVENT_ICONS[e.event] || { i: 'fa-star', c: 'var(--cyan)' };
        const pts  = e.points || 0;
        const sign = pts > 0 ? '+' : '';
        const col  = pts > 0 ? 'var(--green)' : pts < 0 ? 'var(--red)' : 'var(--text3)';
        h += `<div class="rw-hist-row">
          <div class="rw-hist-icon" style="background:${ic.c}22;color:${ic.c}"><i class="fas ${ic.i}"></i></div>
          <div class="rw-hist-body">
            <div class="rw-hist-desc">${MX.esc(e.description || e.event)}</div>
            ${canAdmin ? `<div class="rw-hist-user">${MX.esc(e.userName || e.userId)}</div>` : ''}
            <div class="rw-hist-time">${MX.fmtTime(e.ts)}</div>
          </div>
          <div class="rw-hist-pts" style="color:${col}">${sign}${pts} <span style="font-size:10px;color:var(--text3);font-weight:400">MP</span></div>
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── RULE MODAL ──
  function _openRuleModal(id) {
    const rule = id ? (MX.state.rewardsRules || []).find(r => r.id === id) : null;
    const EVENTS = [
      ['task_done','Tâche terminée'],['mission_done','Intervention terminée'],
      ['mission_urgent','Intervention urgente'],['day_complete','Toutes tâches du jour'],
      ['stock_update','Stock mis à jour'],['permanence','Permanence prise'],
      ['no_late','Zéro tâche en retard'],['suggestion','Amélioration validée'],
      ['mission_resolved','Mission bloquée résolue'],['manual','Attribution manuelle']
    ];
    const opts = EVENTS.map(([v, l]) => `<option value="${v}"${rule && rule.event === v ? ' selected' : ''}>${l}</option>`).join('');
    MX.showModal({
      title: id ? 'Modifier la règle' : 'Nouvelle règle',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Libellé</label>
          <input class="fi" id="rr-label" value="${MX.esc(rule ? rule.label : '')}" placeholder="Ex: Tâche terminée"></div>
        <div class="form-group"><label>Événement déclencheur</label>
          <select class="fi" id="rr-event">${opts}</select></div>
        <div class="form-group"><label>Points (MP)</label>
          <input class="fi" id="rr-pts" type="number" min="0" value="${rule ? rule.points : 1}"></div>
        <div class="form-group"><label>Icône FontAwesome (ex: fa-star)</label>
          <input class="fi" id="rr-icon" value="${MX.esc(rule ? (rule.icon || 'fa-star') : 'fa-star')}"></div>
      </div>`,
      actions: [
        { label: id ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: () => _saveRule(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }
  async function _saveRule(id) {
    const label  = (document.getElementById('rr-label') || {}).value?.trim();
    const event  = (document.getElementById('rr-event') || {}).value;
    const points = parseInt((document.getElementById('rr-pts') || {}).value) || 0;
    const icon   = (document.getElementById('rr-icon') || {}).value?.trim() || 'fa-star';
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

  // ── GRADE MODAL ──
  function _openGradeModal(id) {
    const g = id ? (MX.state.rewardsGrades || []).find(x => x.id === id) : null;
    MX.showModal({
      title: id ? 'Modifier le grade' : 'Nouveau grade',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Nom du grade</label>
          <input class="fi" id="rg-name" value="${MX.esc(g ? g.name : '')}" placeholder="Ex: Expert"></div>
        <div class="form-group"><label>Points minimum (MP)</label>
          <input class="fi" id="rg-pts" type="number" min="0" value="${g ? g.minPoints : 0}"></div>
        <div class="form-group"><label>Emoji</label>
          <input class="fi" id="rg-icon" value="${MX.esc(g ? g.icon : '🔧')}" placeholder="🔧"></div>
        <div class="form-group"><label>Couleur</label>
          <input class="fi" id="rg-color" type="color" value="${g ? g.color : '#3B82F6'}"></div>
      </div>`,
      actions: [
        { label: id ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: () => _saveGrade(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }
  async function _saveGrade(id) {
    const name      = (document.getElementById('rg-name') || {}).value?.trim();
    const minPoints = parseInt((document.getElementById('rg-pts') || {}).value) || 0;
    const icon      = (document.getElementById('rg-icon') || {}).value?.trim() || '🔧';
    const color     = (document.getElementById('rg-color') || {}).value || '#3B82F6';
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

  // ── ITEM MODAL ──
  function _openItemModal(id) {
    const it = id ? (MX.state.rewardsItems || []).find(x => x.id === id) : null;
    const TYPES = ['cosmétique','badge','mini-jeu','personnalisée'];
    const typeOpts = TYPES.map(t => `<option value="${t}"${it && it.type === t ? ' selected' : ''}>${t}</option>`).join('');
    MX.showModal({
      title: id ? 'Modifier la récompense' : 'Nouvelle récompense',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Nom</label>
          <input class="fi" id="ri-name" value="${MX.esc(it ? it.name : '')}" placeholder="Ex: Badge Élite"></div>
        <div class="form-group"><label>Description</label>
          <input class="fi" id="ri-desc" value="${MX.esc(it ? (it.description || '') : '')}" placeholder="Courte description"></div>
        <div class="form-group"><label>Coût (MP)</label>
          <input class="fi" id="ri-cost" type="number" min="0" value="${it ? it.cost : 100}"></div>
        <div class="form-group"><label>Emoji</label>
          <input class="fi" id="ri-icon" value="${MX.esc(it ? (it.icon || '🎁') : '🎁')}" placeholder="🎁"></div>
        <div class="form-group"><label>Type</label>
          <select class="fi" id="ri-type">${typeOpts}</select></div>
      </div>`,
      actions: [
        { label: id ? 'Enregistrer' : 'Créer', cls: 'confirm', fn: () => _saveItem(id) },
        { label: 'Annuler', cls: 'cancel' }
      ]
    });
  }
  async function _saveItem(id) {
    const name        = (document.getElementById('ri-name') || {}).value?.trim();
    const description = (document.getElementById('ri-desc') || {}).value?.trim() || '';
    const cost        = parseInt((document.getElementById('ri-cost') || {}).value) || 0;
    const icon        = (document.getElementById('ri-icon') || {}).value?.trim() || '🎁';
    const type        = (document.getElementById('ri-type') || {}).value || 'personnalisée';
    if (!name) { MX.toast('Nom requis', true); return; }
    try {
      if (id) await MX.DB.updateRewardsItem(id, { name, description, cost, icon, type });
      else    await MX.DB.addRewardsItem({ name, description, cost, icon, type, available: true });
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
    const uid   = _currentUserId();
    const uname = _currentUserName();
    if (!uid) { MX.toast('Connectez-vous pour acheter', true); return; }
    MX.showModal(`Obtenir "${name}" ?`, `Cela coûtera ${cost} MP de votre solde. Continuer ?`, [
      { label: 'Confirmer', cls: 'confirm', fn: async () => {
        try {
          // spendPoints checks balance + deducts + writes history in one batch
          await MX.DB.spendPoints(uid, uname, 'item_redeemed', cost, `Récompense obtenue : ${name}`);
          MX.toast('Récompense obtenue ! 🎁');
        } catch(e) {
          MX.toast(e.message === 'not_enough' ? 'Pas assez de MP' : 'Erreur : ' + e.message, true);
        }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── SPIN GAME ──
  async function _doSpin(cost) {
    if (_spinBusy) return;
    const uid   = _currentUserId();
    const uname = _currentUserName();
    if (!uid) return;
    _spinBusy = true;

    const btn    = document.getElementById('rw-spin-btn');
    const drum   = document.getElementById('rw-spin-drum');
    const result = document.getElementById('rw-spin-result');
    const msg    = document.getElementById('rw-spin-msg');
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = '';

    try {
      await MX.DB.spendPoints(uid, uname, 'game_spin', cost, `Roue Chance : mise de ${cost} MP`);
    } catch(e) {
      MX.toast('Pas assez de MP', true);
      _spinBusy = false;
      if (btn) btn.disabled = false;
      return;
    }

    const frames = ['🎰','💫','⭐','🎲','🌟','💎','🎯','🏆','🎪','🎉'];
    let fi = 0;
    const iv = setInterval(() => {
      if (result) result.textContent = frames[fi++ % frames.length];
      if (drum)   drum.classList.add('rw-spin-anim');
    }, 80);

    await new Promise(r => setTimeout(r, 2200));
    clearInterval(iv);
    if (drum) drum.classList.remove('rw-spin-anim');

    const PRIZES  = [0, 0, 1, 1, 1, 2, 3, 3, 5, 5, 8, 10, 15, 20];
    const won     = PRIZES[Math.floor(Math.random() * PRIZES.length)];
    const EMOJIS  = { 0: '💀', 1: '😊', 2: '😊', 3: '😄', 5: '🎉', 8: '🎉', 10: '🏆', 15: '💎', 20: '🌟' };

    if (result) result.textContent = EMOJIS[won] || '⭐';
    if (msg) {
      msg.textContent = won > 0 ? `+${won} MP remportés !` : 'Pas de chance cette fois…';
      msg.style.color = won > 0 ? 'var(--green)' : 'var(--text3)';
    }

    if (won > 0) {
      await MX.DB.awardPoints(uid, uname, 'game_spin', won, `Roue Chance : gain de ${won} MP`);
      MX.toast(`🎰 Vous gagnez ${won} MP !`);
    } else {
      MX.toast('Pas de chance cette fois…');
    }

    _spinBusy = false;
    if (btn) btn.disabled = false;
  }

  // ── DAILY BONUS ──
  async function _claimDailyBonus() {
    const uid   = _currentUserId();
    const uname = _currentUserName();
    if (!uid) return;
    const todayKey = 'mx_daily_bonus_' + uid + '_' + new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(todayKey)) { MX.toast('Bonus déjà réclamé aujourd\'hui', true); return; }
    try {
      await MX.DB.awardPoints(uid, uname, 'daily_bonus', 3, 'Bonus quotidien : toutes les tâches terminées');
      localStorage.setItem(todayKey, '1');
      MX.toast('🌟 +3 MP bonus quotidien !');
      render();
    } catch(e) { MX.toast('Erreur', true); }
  }

  // ── MANUAL AWARD (admin only) ──
  async function _manualAward() {
    const sel    = (document.getElementById('rw-man-user') || {}).value || '';
    const pts    = parseInt((document.getElementById('rw-man-pts') || {}).value) || 0;
    const reason = (document.getElementById('rw-man-reason') || {}).value?.trim() || 'Attribution manuelle';
    if (!sel || pts === 0) { MX.toast('Sélectionnez un utilisateur et entrez les points', true); return; }
    const [userId, userName] = sel.split('|');
    if (!userId) return;
    try {
      if (pts > 0) {
        await MX.DB.awardPoints(userId, userName, 'manual', pts, reason);
      } else {
        await MX.DB.spendPoints(userId, userName, 'manual', Math.abs(pts), reason);
      }
      MX.toast(`${pts > 0 ? '+' : ''}${pts} MP attribués à ${userName} ✓`);
      render();
    } catch(e) { MX.toast(e.message === 'not_enough' ? 'Solde insuffisant' : 'Erreur', true); }
  }

  // ── RESET DEFAULTS ──
  async function _resetDefaults() {
    MX.showModal('Réinitialiser les défauts ?', 'Cela supprime grades et règles existants et recrée les défauts.', [
      { label: 'Réinitialiser', cls: 'danger', fn: async () => {
        try {
          await MX.DB.resetRewardsDefaults();
          MX.toast('Défauts rechargés ✓');
        } catch(e) { MX.toast('Erreur : ' + e.message, true); }
      }},
      { label: 'Annuler', cls: 'cancel' }
    ]);
  }

  // ── GLOBAL GRADE BADGE (used by auth.js and other pages) ──
  function getUserGradeBadge(userName, opts) {
    const uid  = _nameToUserId(userName);
    const pts  = uid ? _userPoints(uid) : 0;
    return _gradeBadgeHtml(pts, opts || {});
  }
  function getUserGradeData(userName) {
    const uid = _nameToUserId(userName);
    const pts = uid ? _userPoints(uid) : 0;
    return { grade: _getGrade(pts), pts };
  }

  // ── EXPORTS ──
  window.MX = window.MX || {};
  window.MX.Pages  = window.MX.Pages  || {};
  window.MX.Rewards = {
    getGrade: _getGrade,
    getNextGrade: _getNextGrade,
    gradeBadgeHtml: _gradeBadgeHtml,
    getUserGradeBadge,
    getUserGradeData,
    awardForEvent
  };
  window.MX.Pages.Rewards = {
    render,
    awardForEvent,
    _tab: switchTab,
    _lbPeriod: function(p) { _lbPeriod = p; render(); },
    _openRuleModal, _toggleRule, _deleteRule,
    _openGradeModal, _deleteGrade,
    _openItemModal, _deleteItem, _toggleItem,
    _buyItem, _doSpin, _claimDailyBonus, _manualAward, _resetDefaults
  };
})();
