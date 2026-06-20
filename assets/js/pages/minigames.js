(function () {
  // ── MODULE STATE ──
  let _scene = 'hub';
  let _lbGame = 'all';
  let _loop = null, _loopType = null;

  // ── GAME METADATA (3 games only) ──
  const META = [
    { id: 'quiz',  icon: '📡', name: 'Quiz Technique',   desc: 'Questions de maintenance industrielle.',  unlockPts: 0,    dailyMp: 15, diff: 2 },
    { id: 'snake', icon: '🔌', name: 'Snake Industriel', desc: 'Collecte les outils, évite les pannes.', unlockPts: 500,  dailyMp: 15, diff: 3 },
    { id: 'stock', icon: '📦', name: 'Tri du Stock',     desc: 'Range les produits dans les bons rayons.', unlockPts: 1000, dailyMp: 20, diff: 3 }
  ];

  const ACHIEVEMENTS_DEF = [
    { id: 'quiz_perfect',  gameId: 'quiz',  icon: '📡', name: 'Quiz Parfait',    desc: 'Score parfait au Quiz (10/10).' },
    { id: 'quiz_streak5',  gameId: 'quiz',  icon: '🔥', name: 'Série de 5',      desc: '5 bonnes réponses consécutives.' },
    { id: 'snake_100',     gameId: 'snake', icon: '🔌', name: 'Câbleur Élite',   desc: 'Atteignez 100 pts au Snake.' },
    { id: 'snake_combo5',  gameId: 'snake', icon: '⚡', name: 'Combo ×5',        desc: '5 collectes consécutives sans panne.' },
    { id: 'stock_50',      gameId: 'stock', icon: '📦', name: 'Magasinier Pro',  desc: 'Rangez 50 produits correctement.' },
    { id: 'arcade_all',    gameId: 'quiz',  icon: '🏆', name: 'Maître Arcade',   desc: 'Jouez aux 3 jeux de l\'Arcade.' }
  ];

  // ── HELPERS ──
  function _uid()   { const cu = MX.state.currentUser, ad = MX.state.adminUser; return cu ? cu.id : (ad ? 'admin_' + (ad.email||'admin').replace(/[^a-z0-9]/gi,'_') : null); }
  function _uname() { const cu = MX.state.currentUser, ad = MX.state.adminUser; return cu ? cu.name : (ad ? (ad.email||'Admin').split('@')[0] : null); }
  function _fmt(s)  { return Math.floor(s/60).toString().padStart(2,'0') + ':' + (s%60).toString().padStart(2,'0'); }

  // ── DAILY MP CAP ──
  function _todayKey(uid, gid) { return 'mx_gmp_' + uid + '_' + gid + '_' + new Date().toISOString().slice(0,10); }
  function _dailyEarned(uid, gid) { return parseInt(localStorage.getItem(_todayKey(uid, gid)) || '0'); }
  function _addDaily(uid, gid, pts) { localStorage.setItem(_todayKey(uid, gid), _dailyEarned(uid, gid) + pts); }

  async function _awardMp(gid, mp, desc) {
    const uid = _uid(), un = _uname();
    if (!uid || !un || mp <= 0) return 0;
    const m    = META.find(x => x.id === gid);
    const cap  = m ? m.dailyMp : 5;
    const give = Math.min(mp, cap - _dailyEarned(uid, gid));
    if (give <= 0) return 0;
    try {
      await MX.DB.awardPoints(uid, un, 'game_' + gid, give, desc || 'Arcade : ' + (m ? m.name : gid));
      _addDaily(uid, gid, give);
      return give;
    } catch(e) { return 0; }
  }

  async function _save(gid, score, extra) {
    const uid = _uid(), un = _uname();
    if (!uid) return;
    try { await MX.DB.saveGameScore({ userId: uid, userName: un, gameId: gid, score, ...(extra||{}) }); }
    catch(e) { console.warn('saveGameScore', e); }
    _checkAch(gid, score, extra);
  }

  async function _checkAch(gid, score, extra) {
    const uid = _uid(), un = _uname();
    if (!uid || !un) return;
    const userAch  = ((MX.state.gameAchievements || {})[uid]) || {};
    const myScores = (MX.state.gameScores || []).filter(s => s.userId === uid);
    const gamesPlayed = new Set(myScores.map(s => s.gameId));

    for (const a of ACHIEVEMENTS_DEF) {
      if (a.gameId !== gid || userAch[a.id]) continue;
      let unlock = false;
      if (a.id === 'quiz_perfect'  && score >= 10)                   unlock = true;
      if (a.id === 'quiz_streak5'  && (extra&&extra.maxStreak||0) >= 5) unlock = true;
      if (a.id === 'snake_100'     && score >= 100)                   unlock = true;
      if (a.id === 'snake_combo5'  && (extra&&extra.maxCombo||0) >= 5)  unlock = true;
      if (a.id === 'stock_50'      && (extra&&extra.totalCorrect||0) >= 50) unlock = true;
      if (a.id === 'arcade_all')   { gamesPlayed.add(gid); unlock = META.every(m => gamesPlayed.has(m.id)); }
      if (unlock) {
        try {
          await MX.DB.saveGameAchievement({ userId: uid, userName: un, achievementId: a.id, name: a.name, icon: a.icon });
          MX.toast(`${a.icon} Succès débloqué : ${a.name} !`);
        } catch(e) {}
      }
    }
  }

  function _best(gid) {
    const uid = _uid();
    return (MX.state.gameScores || []).filter(s => s.userId === uid && s.gameId === gid)
      .reduce((b, s) => s.score > b ? s.score : b, 0);
  }

  function _stopLoop() {
    if (_loop !== null) {
      if (_loopType === 'raf') cancelAnimationFrame(_loop);
      else clearInterval(_loop);
      _loop = null; _loopType = null;
    }
  }

  function _destroy() {
    _stopLoop();
    document.removeEventListener('keydown', _snakeKey);
  }

  // ─────────────────────────────────────────────
  //  HUB — ARCADE RENDER
  // ─────────────────────────────────────────────
  function render() {
    _destroy();
    _scene = 'hub';
    _renderHub();
  }

  function _renderHub() {
    const el = document.getElementById('main-content');
    if (!el) return;
    const uid      = _uid();
    const pts      = uid ? ((MX.state.rewardsUsers||{})[uid]||{}).points||0 : 0;
    const canAdmin = MX.Auth.canSeeAll();
    const isAdmin  = MX.Auth.isAdmin();
    const unlocked = META.filter(g => pts >= g.unlockPts).length;
    const scores   = MX.state.gameScores || [];
    const myScores = uid ? scores.filter(s => s.userId === uid) : [];
    const gamesPlayed = new Set(myScores.map(s => s.gameId)).size;

    const TABS = [
      { id:'hub',          l:'🎮 Jeux' },
      { id:'leaderboard',  l:'🏆 Classement' },
      { id:'achievements', l:'🥇 Succès' },
      ...(canAdmin ? [{ id:'admin', l:'⚙️ Admin' }] : [])
    ];

    let h = `
    <div class="arc-header">
      <div class="arc-header-top">
        <div>
          <div class="arc-header-title">🎮 Arcade Maintix</div>
          <div class="arc-header-sub">Débloque des jeux avec tes MP · gagne des récompenses</div>
        </div>
        <button class="arc-back-btn" onclick="MX.showPage('rewards')" title="Récompenses">
          <i class="fas fa-arrow-left"></i>
        </button>
      </div>
      <div class="arc-kpis">
        <div class="arc-kpi">
          <div class="arc-kpi-val">${unlocked}<span class="arc-kpi-tot">/${META.length}</span></div>
          <div class="arc-kpi-lbl">Débloqués</div>
        </div>
        <div class="arc-kpi-div"></div>
        <div class="arc-kpi">
          <div class="arc-kpi-val arc-kpi-mp">${pts}</div>
          <div class="arc-kpi-lbl">MP dispo</div>
        </div>
        <div class="arc-kpi-div"></div>
        <div class="arc-kpi">
          <div class="arc-kpi-val">${gamesPlayed}</div>
          <div class="arc-kpi-lbl">Joués</div>
        </div>
      </div>
    </div>
    <div class="arc-tabs-wrap">
      <div class="arc-tabs">`;

    TABS.forEach(t => {
      h += `<button class="arc-tab${_scene===t.id?' active':''}" onclick="MX.Pages.MiniGames._scn('${t.id}')">${t.l}</button>`;
    });
    h += `</div></div><div class="arc-body">`;

    if (_scene === 'hub')          h += _renderGrid(uid, pts);
    if (_scene === 'leaderboard')  h += _renderLB();
    if (_scene === 'achievements') h += _renderAch(uid, pts);
    if (_scene === 'admin')        h += _renderAdmin(isAdmin);

    h += `</div>`;
    el.innerHTML = h;
  }

  // ── SVG ILLUSTRATIONS ──
  function _artSvg(id) {
    const C = '#00C2D1', BG = '#080f1a', BG2 = '#0d1e2e', G = '#10B981', O = '#F59E0B', R = '#EF4444', P = '#8B5CF6';
    const svgs = {
      quiz: `<svg viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="56" fill="${BG}"/>
        <rect x="5" y="4" width="90" height="48" rx="6" fill="${BG2}" stroke="${C}" stroke-width="1"/>
        <text x="22" y="34" font-size="22" font-weight="bold" fill="${C}" font-family="monospace">Q?</text>
        <rect x="38" y="10" width="50" height="7" rx="3" fill="rgba(0,194,209,0.12)" stroke="${C}" stroke-width="0.8"/>
        <rect x="38" y="22" width="40" height="7" rx="3" fill="rgba(16,185,129,0.18)" stroke="${G}" stroke-width="0.8"/>
        <rect x="38" y="34" width="45" height="7" rx="3" fill="rgba(0,194,209,0.06)" stroke="rgba(0,194,209,0.3)" stroke-width="0.6"/>
        <rect x="38" y="46" width="35" height="7" rx="3" fill="rgba(0,194,209,0.06)" stroke="rgba(0,194,209,0.3)" stroke-width="0.6"/>
        <text x="41" y="27" font-size="5.5" fill="${G}" font-family="sans-serif">✓ Bonne réponse</text>
        <circle cx="92" cy="8" r="2.5" fill="${C}" opacity="0.5"/>
        <path d="M8 51 L18 51 M22 51 L30 51" stroke="${C}" stroke-width="1" stroke-linecap="round" opacity="0.35"/>
      </svg>`,

      snake: `<svg viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="56" fill="${BG}"/>
        ${Array.from({length:40},(_,i)=>`<circle cx="${(i%8)*12+6}" cy="${Math.floor(i/8)*13+6}" r="1" fill="rgba(0,194,209,0.1)"/>`).join('')}
        <circle cx="16" cy="6" r="6" fill="${C}"/>
        <circle cx="13" cy="4" r="1.8" fill="${BG}"/><circle cx="19" cy="4" r="1.8" fill="${BG}"/>
        <circle cx="28" cy="6" r="5.5" fill="${C}" opacity="0.85"/>
        <circle cx="40" cy="6" r="5.5" fill="${C}" opacity="0.7"/>
        <circle cx="52" cy="6" r="5.5" fill="${C}" opacity="0.55"/>
        <circle cx="52" cy="19" r="5.5" fill="${C}" opacity="0.4"/>
        <circle cx="40" cy="19" r="5.5" fill="${C}" opacity="0.3"/>
        <text x="73" y="18" font-size="13" text-anchor="middle">🔧</text>
        <text x="20" y="46" font-size="11" text-anchor="middle">🚨</text>
        <text x="73" y="46" font-size="11" text-anchor="middle">⚙️</text>
        <text x="47" y="46" font-size="11" text-anchor="middle">💡</text>
      </svg>`,

      stock: `<svg viewBox="0 0 100 56" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="56" fill="${BG}"/>
        <rect x="4" y="4" width="3" height="50" rx="1" fill="${BG2}" stroke="rgba(0,194,209,0.25)" stroke-width="0.5"/>
        <rect x="93" y="4" width="3" height="50" rx="1" fill="${BG2}" stroke="rgba(0,194,209,0.25)" stroke-width="0.5"/>
        <rect x="4" y="17" width="92" height="2" rx="1" fill="rgba(0,194,209,0.3)"/>
        <rect x="4" y="34" width="92" height="2" rx="1" fill="rgba(0,194,209,0.3)"/>
        <rect x="4" y="50" width="92" height="2" rx="1" fill="rgba(0,194,209,0.3)"/>
        <rect x="9" y="36" width="13" height="14" rx="2" fill="${C}" opacity="0.8"/>
        <rect x="24" y="36" width="13" height="14" rx="2" fill="${O}" opacity="0.8"/>
        <rect x="39" y="36" width="13" height="14" rx="2" fill="${G}" opacity="0.8"/>
        <rect x="9" y="19" width="13" height="14" rx="2" fill="${O}" opacity="0.7"/>
        <rect x="24" y="19" width="13" height="14" rx="2" fill="${C}" opacity="0.7"/>
        <rect x="39" y="23" width="13" height="10" rx="2" fill="${P}" opacity="0.7"/>
        <rect x="60" y="5" width="32" height="22" rx="4" fill="${BG2}" stroke="${C}" stroke-width="1"/>
        <text x="76" y="20" font-size="11" text-anchor="middle">📦</text>
        <path d="M76 27 L76 36" stroke="${C}" stroke-width="1.5" stroke-dasharray="2,2" opacity="0.6"/>
        <path d="M73 34 L76 38 L79 34" fill="none" stroke="${C}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
    };
    return svgs[id] || `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:28px">${META.find(m=>m.id===id)?.icon||'🎮'}</div>`;
  }

  // ── GAME GRID (compact — 3 games fit on one iPhone screen) ──
  function _renderGrid(uid, pts) {
    const scores = MX.state.gameScores || [];
    let h = `<div class="arc-grid-3">`;

    META.forEach(g => {
      const locked   = pts < g.unlockPts;
      const myScores = uid ? scores.filter(s => s.userId === uid && s.gameId === g.id) : [];
      const best     = myScores.reduce((b,s) => Math.max(b, s.score), 0);
      const plays    = myScores.length;
      const earned   = uid ? _dailyEarned(uid, g.id) : 0;
      const left     = Math.max(0, g.dailyMp - earned);
      const stars    = '★'.repeat(g.diff) + '☆'.repeat(5 - g.diff);

      h += `<div class="arc-card3${locked?' arc-locked':''}">
        <div class="arc-art3">
          ${_artSvg(g.id)}
          ${!locked && best > 0 ? `<div class="arc-art-best"><i class="fas fa-trophy"></i> ${best}</div>` : ''}
          ${locked ? `<div class="arc-art-lock"><i class="fas fa-lock"></i> ${g.unlockPts} MP</div>` : ''}
        </div>
        <div class="arc-card3-body">
          <div class="arc-card3-top">
            <div>
              <div class="arc-card3-name">${MX.esc(g.name)}</div>
              <div class="arc-card3-meta">
                <span class="arc-diff3">${stars}</span>
                ${!locked && plays > 0 ? `<span class="arc-plays3">${plays}<i class="fas fa-gamepad"></i></span>` : ''}
              </div>
            </div>
            <div class="arc-card3-right">
              <div class="arc-card3-mp">+${g.dailyMp}<span>MP</span></div>
              ${!locked && left <= 0 ? '<div class="arc-card3-max"><i class="fas fa-check-circle"></i> Max</div>' : ''}
            </div>
          </div>`;

      if (locked) {
        const pct = Math.min(100, Math.round(pts / g.unlockPts * 100));
        h += `<div class="arc-lock-bar">
          <div class="arc-lock-track"><div class="arc-lock-fill" style="width:${pct}%"></div></div>
          <div class="arc-lock-txt">${pts} / ${g.unlockPts} MP</div>
        </div>`;
      } else {
        h += `${uid ? `<button class="arc-play3-btn" onclick="MX.Pages.MiniGames._go('${g.id}')"><i class="fas fa-play"></i> Jouer</button>` : ''}`;
      }

      h += `</div></div>`;
    });

    h += `</div>`;
    return h;
  }

  // ── LEADERBOARD ──
  function _renderLB() {
    const scores = MX.state.gameScores || [];
    const uid    = _uid();
    const games  = [['all','🎮 Tous'], ...META.map(m => [m.id, m.icon + ' ' + m.name])];
    const MEDALS = ['🥇','🥈','🥉'];

    let h = `<div class="arc-lb-filter">`;
    games.forEach(([id,l]) => {
      h += `<button class="arc-lb-pill${_lbGame===id?' active':''}" onclick="MX.Pages.MiniGames._lb('${id}')">${l}</button>`;
    });
    h += `</div>`;

    const pool = _lbGame === 'all' ? scores : scores.filter(s => s.gameId === _lbGame);
    const byKey = {};
    pool.forEach(s => {
      const k = s.userId + '_' + s.gameId;
      if (!byKey[k] || s.score > byKey[k].score) byKey[k] = s;
    });
    const ranked = Object.values(byKey).sort((a,b) => b.score - a.score).slice(0, 50);

    if (!ranked.length) {
      h += `<div class="arc-empty"><i class="fas fa-trophy"></i><p>Aucun score enregistré</p></div>`;
    } else {
      h += `<div class="arc-lb-list">`;
      ranked.forEach((s, i) => {
        const isMe = s.userId === uid;
        const nc   = MX.userColors ? MX.userColors(s.userName||'?') : { bg: '#1a2a3a', fg: '#00C2D1' };
        const meta = META.find(m => m.id === s.gameId);
        h += `<div class="arc-lb-row${isMe?' arc-lb-me':''}">
          <div class="arc-lb-rank">${MEDALS[i] || '#'+(i+1)}</div>
          <div class="arc-lb-avatar" style="background:${nc.bg};color:${nc.fg}">${MX.esc((s.userName||'?').substring(0,2).toUpperCase())}</div>
          <div class="arc-lb-info">
            <div class="arc-lb-name">${MX.esc(s.userName||s.userId)}${isMe ? ' <span class="arc-me-tag">Moi</span>' : ''}</div>
            <div class="arc-lb-game">${meta ? meta.icon+' '+meta.name : s.gameId}</div>
          </div>
          <div class="arc-lb-score">${s.score}<span>pts</span></div>
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  // ── ACHIEVEMENTS ──
  function _renderAch(uid, pts) {
    const userAch = uid ? ((MX.state.gameAchievements||{})[uid]||{}) : {};
    const unlockedCount = ACHIEVEMENTS_DEF.filter(a => userAch[a.id]).length;
    let h = `<div class="arc-ach-header">
      <span class="arc-ach-progress">${unlockedCount} / ${ACHIEVEMENTS_DEF.length} succès débloqués</span>
      <div class="arc-ach-progbar"><div class="arc-ach-progfill" style="width:${Math.round(unlockedCount/ACHIEVEMENTS_DEF.length*100)}%"></div></div>
    </div>
    <div class="arc-badge-grid">`;

    ACHIEVEMENTS_DEF.forEach(a => {
      const ok     = !!userAch[a.id];
      const locked = !ok && (META.find(m => m.id === a.gameId)?.unlockPts||0) > pts;
      h += `<div class="arc-badge${ok ? ' arc-badge-ok' : locked ? ' arc-badge-hidden' : ''}">
        <div class="arc-badge-icon">${a.icon}</div>
        <div class="arc-badge-name">${MX.esc(a.name)}</div>
        <div class="arc-badge-desc">${MX.esc(a.desc)}</div>
        <div class="arc-badge-status">${ok ? '<i class="fas fa-check-circle"></i> Débloqué' : locked ? '<i class="fas fa-lock"></i> Verrouillé' : '<i class="fas fa-circle-dot"></i> En cours'}</div>
      </div>`;
    });
    h += `</div>`;
    return h;
  }

  // ── ADMIN ──
  function _renderAdmin(isAdmin) {
    const questions = MX.state.gameQuestions || [];
    let h = ``;
    if (isAdmin) {
      h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="section-label" style="margin:0">Questions Quiz</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="primary-btn" style="width:auto;padding:8px 14px;background:none;border-color:var(--border2);color:var(--red)" onclick="MX.Pages.MiniGames._resetScores()">
            <i class="fas fa-trash"></i> Reset scores
          </button>
          <button class="primary-btn" style="width:auto;padding:8px 14px" onclick="MX.Pages.MiniGames._qModal()">
            <i class="fas fa-plus"></i> Ajouter question
          </button>
        </div>
      </div>`;
    }
    if (!questions.length) {
      h += `<div class="arc-empty"><i class="fas fa-question-circle"></i><p>Aucune question personnalisée. Les questions par défaut sont utilisées.</p></div>`;
    } else {
      h += `<div class="rw-list">`;
      questions.forEach(q => {
        h += `<div class="rw-list-item">
          <div class="rw-li-body">
            <div class="rw-li-name">${MX.esc(q.question)}</div>
            <div class="rw-li-sub">${MX.esc(q.category||'Général')}</div>
          </div>
          ${isAdmin ? `<div class="rw-li-acts">
            <button class="icon-btn" onclick="MX.Pages.MiniGames._qModal('${q.id}')"><i class="fas fa-pen"></i></button>
            <button class="icon-btn" onclick="MX.Pages.MiniGames._qDel('${q.id}')"><i class="fas fa-trash" style="color:var(--red)"></i></button>
          </div>` : ''}
        </div>`;
      });
      h += `</div>`;
    }
    return h;
  }

  function _qModal(id) {
    const q = id ? (MX.state.gameQuestions||[]).find(x => x.id === id) : null;
    const CATS = ['Général','Électricité','Hydraulique','Mécanique','Sécurité','Instrumentation'];
    const ans = q ? q.answers : ['','','',''];
    MX.showModal({
      title: id ? 'Modifier la question' : 'Nouvelle question',
      body: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="form-group"><label>Question</label><input class="fi" id="mgq-q" value="${MX.esc(q?q.question:'')}"></div>
        <div class="form-group"><label>Catégorie</label>
          <select class="fi" id="mgq-cat">${CATS.map(c=>`<option value="${c}"${q&&q.category===c?' selected':''}>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label>Réponse A</label><input class="fi" id="mgq-a0" value="${MX.esc(ans[0]||'')}"></div>
        <div class="form-group"><label>Réponse B</label><input class="fi" id="mgq-a1" value="${MX.esc(ans[1]||'')}"></div>
        <div class="form-group"><label>Réponse C</label><input class="fi" id="mgq-a2" value="${MX.esc(ans[2]||'')}"></div>
        <div class="form-group"><label>Réponse D</label><input class="fi" id="mgq-a3" value="${MX.esc(ans[3]||'')}"></div>
        <div class="form-group"><label>Bonne réponse (0=A, 1=B, 2=C, 3=D)</label>
          <input class="fi" id="mgq-ok" type="number" min="0" max="3" value="${q?q.correct:0}"></div>
      </div>`,
      actions: [
        { label: id?'Enregistrer':'Créer', cls:'confirm', fn: () => _qSave(id) },
        { label:'Annuler', cls:'cancel' }
      ]
    });
  }
  async function _qSave(id) {
    const question = (document.getElementById('mgq-q')||{}).value?.trim();
    const category = (document.getElementById('mgq-cat')||{}).value;
    const answers  = [0,1,2,3].map(i => (document.getElementById('mgq-a'+i)||{}).value?.trim());
    const correct  = parseInt((document.getElementById('mgq-ok')||{}).value)||0;
    if (!question || answers.some(a => !a)) { MX.toast('Remplissez tous les champs', true); return; }
    try {
      if (id) await MX.DB.updateGameQuestion(id, { question, category, answers, correct });
      else    await MX.DB.addGameQuestion({ question, category, answers, correct });
      MX.toast('Question enregistrée ✓');
    } catch(e) { MX.toast('Erreur : ' + e.message, true); }
  }
  function _qDel(id) {
    MX.showModal('Supprimer la question ?', '', [
      { label:'Supprimer', cls:'danger', fn: async () => { try { await MX.DB.deleteGameQuestion(id); MX.toast('Supprimée'); } catch(e) { MX.toast('Erreur',true); } } },
      { label:'Annuler', cls:'cancel' }
    ]);
  }
  function _resetScores() {
    MX.showModal('Réinitialiser tous les scores ?', 'Cette action est irréversible.', [
      { label:'Réinitialiser', cls:'danger', fn: async () => { try { await MX.DB.resetGameScores(); MX.toast('Scores réinitialisés'); } catch(e) { MX.toast('Erreur',true); } } },
      { label:'Annuler', cls:'cancel' }
    ]);
  }

  // ─────────────────────────────────────────────
  //  GAME LAUNCHER
  // ─────────────────────────────────────────────
  function _go(gameId) {
    _destroy();
    const el = document.getElementById('main-content');
    if (!el) return;
    const m = META.find(x => x.id === gameId);
    if (!m) return;

    el.innerHTML = `<div class="arc-game-header">
      <button class="arc-back-btn" onclick="MX.Pages.MiniGames._back()">
        <i class="fas fa-arrow-left"></i>
      </button>
      <div class="arc-game-title">
        <div class="arc-game-name">${m.icon} ${MX.esc(m.name)}</div>
        <div class="arc-game-sub">${MX.esc(m.desc)}</div>
      </div>
      <div class="arc-game-mp">+${m.dailyMp}<span>MP</span></div>
    </div>
    <div class="page-body" style="padding:0"><div id="mg-area" style="padding:12px 14px"></div></div>`;

    if (gameId === 'quiz')  _quizInit();
    if (gameId === 'snake') _snakeInit();
    if (gameId === 'stock') _stockInit();
  }

  function _back() { _destroy(); render(); }

  // ─────────────────────────────────────────────
  //  QUIZ — Kahoot style
  // ─────────────────────────────────────────────
  let _qz = {};

  const _QZ_DEF = [
    { q:'Que signifie GMAO ?', a:['Gestion de la Maintenance Assistée par Ordinateur','Grande Machine À Outils','Guide de Maintenance des Appareils Outil','Gestion des Matériels et Actifs Organisés'], ok:0, cat:'Général' },
    { q:'Quelle est la tension secteur en France ?', a:['110V','230V','380V','400V'], ok:1, cat:'Électricité' },
    { q:'Quelle est la fréquence du courant alternatif en France ?', a:['50 Hz','60 Hz','220 Hz','110 Hz'], ok:0, cat:'Électricité' },
    { q:'Quelle est l\'unité du courant électrique ?', a:['Volt','Ohm','Ampère','Watt'], ok:2, cat:'Électricité' },
    { q:'Quel composant protège un circuit contre les surintensités ?', a:['Relais','Fusible','Résistance','Condensateur'], ok:1, cat:'Électricité' },
    { q:'À quoi sert un manomètre ?', a:['Mesurer la température','Mesurer la pression','Mesurer le débit','Mesurer la viscosité'], ok:1, cat:'Hydraulique' },
    { q:'Quelle est la fonction d\'un clapet anti-retour ?', a:['Réguler la pression','Filtrer le fluide','Autoriser l\'écoulement dans un seul sens','Refroidir le fluide'], ok:2, cat:'Hydraulique' },
    { q:'Qu\'est-ce que la maintenance prédictive ?', a:['Basée sur l\'état réel de l\'équipement','Effectuée après une panne','À intervalles fixes','Externalisée'], ok:0, cat:'Général' },
    { q:'Quel outil mesure la résistance électrique ?', a:['Oscilloscope','Voltmètre','Ohmmètre','Ampèremètre'], ok:2, cat:'Électricité' },
    { q:'Que signifie LOTO en sécurité industrielle ?', a:['Loto d\'usine en France','Lockout/Tagout','Liste des opérations techniques','Logiciel de traçabilité'], ok:1, cat:'Sécurité' },
    { q:'Quelle est la fonction principale d\'un roulement à billes ?', a:['Guider et supporter une charge rotative','Lubrifier un arbre','Transmettre un couple','Absorber les vibrations'], ok:0, cat:'Mécanique' },
    { q:'Qu\'est-ce qu\'un couple de serrage ?', a:['La vitesse de rotation d\'un boulon','La force de torsion lors du serrage','L\'épaisseur d\'un joint','La résistance d\'un matériau'], ok:1, cat:'Mécanique' },
    { q:'Quel instrument mesure les vibrations d\'une machine ?', a:['Thermomètre','Accéléromètre','Débitmètre','Hygromètre'], ok:1, cat:'Instrumentation' },
    { q:'Qu\'est-ce que la dilatation thermique ?', a:['La corrosion d\'un métal','L\'augmentation de volume avec la chaleur','La réduction de pression','La condensation'], ok:1, cat:'Mécanique' },
    { q:'Quel EPI lors de travaux électriques BT ?', a:['Casque antibruit','Gants isolants et lunettes','Combinaison chimique','Harnais anti-chute'], ok:1, cat:'Sécurité' },
    { q:'Qu\'est-ce qu\'un variateur de fréquence ?', a:['Un appareil mesurant la fréquence','Un dispositif faisant varier la vitesse d\'un moteur','Un transformateur de tension','Un compteur d\'énergie'], ok:1, cat:'Électricité' },
    { q:'Différence entre maintenance corrective et préventive ?', a:['Corrective avant panne, préventive après','Préventive avant panne, corrective après','Elles sont identiques','Corrective planifiée, préventive urgente'], ok:1, cat:'Général' },
    { q:'Quel est le rôle d\'un filtre hydraulique ?', a:['Augmenter la pression','Retenir les particules contaminantes','Réguler le débit','Convertir l\'énergie'], ok:1, cat:'Hydraulique' },
    { q:'Qu\'est-ce que l\'habilitation électrique B1V ?', a:['Travaux hors tension','Travaux sous tension','Vérifications en présence de tension','Consignation d\'un circuit'], ok:2, cat:'Sécurité' },
    { q:'Quelle loi donne U = R × I ?', a:['Loi de Newton','Loi d\'Ohm','Loi de Faraday','Loi de Joule'], ok:1, cat:'Électricité' }
  ];

  const _QZ_DIFF = {
    facile:  { label:'🟩 Facile',  count:5,  timer:15, mpTable:[5,3,1,0,0,0] },
    moyen:   { label:'🟧 Moyen',   count:8,  timer:12, mpTable:[10,7,5,3,1,0,0,0,0] },
    expert:  { label:'🟥 Expert',  count:10, timer:8,  mpTable:[15,12,10,7,5,3,1,0,0,0,0] }
  };

  const _QZ_ANS_COLORS = ['#E74C3C','#3498DB','#F39C12','#27AE60'];
  const _QZ_ANS_LABELS = ['A','B','C','D'];

  function _quizInit() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `<div class="qz-diff-screen">
      <div class="qz-diff-title">📡 Quiz Technique</div>
      <div class="qz-diff-sub">Testez vos connaissances en maintenance industrielle</div>
      <div class="qz-diff-btns">
        <button class="qz-diff-btn qz-easy"  onclick="MX.Pages.MiniGames._quizStart('facile')">
          <div class="qz-diff-icon">🟩</div>
          <div class="qz-diff-name">Facile</div>
          <div class="qz-diff-info">5 questions · 15s/q · jusqu'à +5 MP</div>
        </button>
        <button class="qz-diff-btn qz-med"   onclick="MX.Pages.MiniGames._quizStart('moyen')">
          <div class="qz-diff-icon">🟧</div>
          <div class="qz-diff-name">Moyen</div>
          <div class="qz-diff-info">8 questions · 12s/q · jusqu'à +10 MP</div>
        </button>
        <button class="qz-diff-btn qz-hard"  onclick="MX.Pages.MiniGames._quizStart('expert')">
          <div class="qz-diff-icon">🟥</div>
          <div class="qz-diff-name">Expert</div>
          <div class="qz-diff-info">10 questions · 8s/q · jusqu'à +15 MP</div>
        </button>
      </div>
    </div>`;
  }

  function _quizStart(diff) {
    const cfg  = _QZ_DIFF[diff];
    const fsQ  = MX.state.gameQuestions || [];
    const pool = fsQ.length >= cfg.count
      ? fsQ.map(q => ({ q: q.question, a: q.answers, ok: q.correct, cat: q.category||'Général' }))
      : [..._QZ_DEF, ...fsQ.map(q => ({ q: q.question, a: q.answers, ok: q.correct, cat: q.category||'Général' }))];
    const qs   = pool.sort(() => Math.random()-0.5).slice(0, cfg.count);
    _qz = { qs, cfg, diff, cur:0, score:0, streak:0, maxStreak:0, start:Date.now(), answered:false, timer:null, timeLeft:cfg.timer };
    _quizQuestion();
  }

  function _quizQuestion() {
    if (_qz.cur >= _qz.qs.length) { _quizEnd(); return; }
    _qz.answered = false;
    _qz.timeLeft = _qz.cfg.timer;
    const q   = _qz.qs[_qz.cur];
    const num = _qz.cur + 1, tot = _qz.qs.length;
    const pct = Math.round((_qz.cur / tot) * 100);

    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `
      <div class="qz-top">
        <div class="qz-progress-wrap">
          <div class="qz-progress-bar"><div class="qz-progress-fill" style="width:${pct}%"></div></div>
          <span class="qz-counter">${num}/${tot}</span>
        </div>
        <div class="qz-stats-row">
          <span class="qz-score-live">⭐ ${_qz.score}</span>
          <span class="qz-timer-badge" id="qz-timer">${_qz.timeLeft}s</span>
          ${_qz.streak >= 2 ? `<span class="qz-streak-badge">🔥 ×${_qz.streak}</span>` : ''}
        </div>
      </div>
      <div class="qz-card">
        <div class="qz-cat">${MX.esc(q.cat||'Général')}</div>
        <div class="qz-question">${MX.esc(q.q)}</div>
      </div>
      <div class="qz-answers">
        ${(q.a||[]).map((ans,i) => `
          <button class="qz-ans-btn" style="--ans-color:${_QZ_ANS_COLORS[i]}" onclick="MX.Pages.MiniGames._quizAns(${i})" id="qz-ans-${i}">
            <span class="qz-ans-lbl">${_QZ_ANS_LABELS[i]}</span>
            <span class="qz-ans-txt">${MX.esc(ans)}</span>
          </button>`).join('')}
      </div>`;

    clearInterval(_qz.timer);
    _qz.timer = setInterval(() => {
      _qz.timeLeft--;
      const tb = document.getElementById('qz-timer');
      if (tb) { tb.textContent = _qz.timeLeft + 's'; if (_qz.timeLeft <= 3) tb.classList.add('urgent'); }
      if (_qz.timeLeft <= 0 && !_qz.answered) _quizAns(-1);
    }, 1000);
  }

  function _quizAns(idx) {
    if (_qz.answered) return;
    _qz.answered = true;
    clearInterval(_qz.timer);
    const q  = _qz.qs[_qz.cur];
    const ok = idx === q.ok;
    const mult = Math.max(1, _qz.streak);
    if (ok) {
      const pts = mult >= 3 ? 3 : mult >= 2 ? 2 : 1;
      _qz.score += pts;
      _qz.streak++;
      _qz.maxStreak = Math.max(_qz.maxStreak, _qz.streak);
    } else {
      _qz.streak = 0;
    }

    document.querySelectorAll('.qz-ans-btn').forEach((b, i) => {
      b.disabled = true;
      if (i === q.ok)         b.classList.add('qz-correct');
      else if (i === idx)     b.classList.add('qz-wrong');
      else                    b.classList.add('qz-dim');
    });

    const fb = document.createElement('div');
    fb.className = 'qz-feedback ' + (ok ? 'qz-fb-ok' : 'qz-fb-no');
    fb.innerHTML = ok
      ? `<span>✓ Correct${_qz.streak >= 2 ? ` 🔥 Série de ${_qz.streak}` : ''}${mult >= 2 ? ` ×${mult}` : ''}</span>`
      : (idx === -1 ? '<span>⏱ Temps écoulé !</span>' : '<span>✗ Raté</span>');
    const area = document.getElementById('mg-area');
    if (area) area.appendChild(fb);

    setTimeout(() => { _qz.cur++; _quizQuestion(); }, ok ? 900 : 1200);
  }

  async function _quizEnd() {
    clearInterval(_qz.timer);
    const sec   = Math.floor((Date.now()-_qz.start)/1000);
    const score = _qz.score;
    const tot   = _qz.qs.length;
    const cfg   = _qz.cfg;
    const mp    = cfg.mpTable[Math.max(0, tot - score)] || 0;
    const medal = score >= tot ? '🥇' : score >= tot*0.8 ? '🥈' : score >= tot*0.5 ? '🥉' : '';
    const em    = score >= tot ? '🎉' : score >= tot*0.6 ? '😊' : '😅';
    const col   = score >= tot ? 'var(--green)' : score >= tot*0.6 ? 'var(--jour)' : 'var(--red)';

    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `<div class="qz-end">
      <div class="qz-end-em">${em}</div>
      <div class="qz-end-title">Quiz terminé !</div>
      ${medal ? `<div class="qz-end-medal">${medal}</div>` : ''}
      <div class="qz-end-score" style="color:${col}">${score} / ${tot}</div>
      ${_qz.maxStreak >= 2 ? `<div class="qz-end-streak">🔥 Meilleure série : ${_qz.maxStreak}</div>` : ''}
      <div class="qz-end-time">${_fmt(sec)}</div>
      <div id="qz-mp-result" style="font-size:14px;color:var(--green);min-height:22px;margin-bottom:4px"></div>
      <div class="qz-end-btns">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._quizStart('${_qz.diff}')"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._quizInit()">Difficulté</button>
      </div>
    </div>`;

    await _save('quiz', score, { time: sec, total: tot, diff: _qz.diff, maxStreak: _qz.maxStreak });
    const awarded = await _awardMp('quiz', mp, `Quiz ${_qz.diff} : ${score}/${tot}${medal ? ' ' + medal : ''}`);
    const el = document.getElementById('qz-mp-result');
    if (el) el.innerHTML = awarded > 0
      ? `<i class="fas fa-coins" style="color:var(--jour)"></i> +${awarded} MP gagnés${medal ? ' ' + medal : ''} !`
      : (mp > 0 ? 'Limite journalière atteinte' : '');
  }

  // ─────────────────────────────────────────────
  //  SNAKE — canvas arcade, mobile-first
  // ─────────────────────────────────────────────
  let _sn = {};
  const _SN_FOOD = [
    { e:'🔧', p:1 }, { e:'🔧', p:1 }, { e:'🔧', p:1 },
    { e:'💡', p:3 }, { e:'💡', p:3 },
    { e:'⚙️', p:5 }
  ];
  const _SN_HAZARDS = ['🚨','⚡','🔥'];

  function _snakeKey(ev) {
    const map = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] };
    const d = map[ev.key];
    if (!d) return;
    ev.preventDefault();
    if (d[0]===-_sn.dir[0] && d[1]===-_sn.dir[1]) return;
    _sn.nd = d;
  }

  function _snakeInit() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    const W=18, H=18;
    const px  = Math.min(320, window.innerWidth - 28);
    const cs  = Math.floor(px / W);
    const cw  = cs * W, ch = cs * H;

    a.innerHTML = `
      <div class="sn-topbar">
        <span class="sn-stat">Score : <b id="sn-s">0</b></span>
        <span class="sn-combo" id="sn-combo"></span>
        <span class="sn-stat">Record : <b>${_best('snake')}</b></span>
      </div>
      <canvas id="mg-canvas" width="${cw}" height="${ch}"
        style="display:block;margin:0 auto;border:1.5px solid var(--border2);border-radius:10px;touch-action:none;max-width:100%"></canvas>
      <div class="sn-dpad">
        <div class="sn-dpad-row">
          <button class="sn-btn sn-btn-dir" ontouchstart="MX.Pages.MiniGames._snDir(0,-1)" onclick="MX.Pages.MiniGames._snDir(0,-1)"><i class="fas fa-chevron-up"></i></button>
        </div>
        <div class="sn-dpad-row">
          <button class="sn-btn sn-btn-dir" ontouchstart="MX.Pages.MiniGames._snDir(-1,0)" onclick="MX.Pages.MiniGames._snDir(-1,0)"><i class="fas fa-chevron-left"></i></button>
          <button class="sn-btn sn-btn-pause" ontouchstart="MX.Pages.MiniGames._snPause()" onclick="MX.Pages.MiniGames._snPause()"><i class="fas fa-pause"></i></button>
          <button class="sn-btn sn-btn-dir" ontouchstart="MX.Pages.MiniGames._snDir(1,0)" onclick="MX.Pages.MiniGames._snDir(1,0)"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="sn-dpad-row">
          <button class="sn-btn sn-btn-dir" ontouchstart="MX.Pages.MiniGames._snDir(0,1)" onclick="MX.Pages.MiniGames._snDir(0,1)"><i class="fas fa-chevron-down"></i></button>
        </div>
      </div>
      <div class="sn-legend">🔧=1pt · 💡=3pts · ⚙️=5pts · évite 🚨⚡🔥</div>`;

    const canvas = document.getElementById('mg-canvas');
    let tx=0, ty=0;
    canvas.addEventListener('touchstart', e => { tx=e.touches[0].clientX; ty=e.touches[0].clientY; e.preventDefault(); }, {passive:false});
    canvas.addEventListener('touchend',   e => {
      const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
      if (Math.abs(dx) < 15 && Math.abs(dy) < 15) { _sn.paused = !_sn.paused; return; }
      if (Math.abs(dx) > Math.abs(dy)) _sn.nd = dx > 0 ? [1,0] : [-1,0];
      else _sn.nd = dy > 0 ? [0,1] : [0,-1];
    }, {passive:true});

    document.addEventListener('keydown', _snakeKey);

    const cx=Math.floor(W/2), cy=Math.floor(H/2);
    _sn = { cs, W, H, body:[[cx,cy],[cx-1,cy],[cx-2,cy]], dir:[1,0], nd:[1,0],
            food:null, hazards:[], score:0, combo:0, maxCombo:0, paused:false, over:false };
    _snFood();

    let last=0;
    const spd = () => Math.max(90, 250 - _sn.score * 3);
    function loop(ts) {
      if (_sn.over) return;
      if (!_sn.paused && ts - last > spd()) { last=ts; _snTick(); }
      _snDraw(canvas);
      _loop = requestAnimationFrame(loop);
      _loopType = 'raf';
    }
    _loop = requestAnimationFrame(loop);
    _loopType = 'raf';
  }

  function _snDir(dx, dy) {
    if (dx === -_sn.dir[0] && dy === -_sn.dir[1]) return;
    _sn.nd = [dx, dy];
  }
  function _snPause() { if (!_sn.over) _sn.paused = !_sn.paused; }

  function _snFood() {
    const {W,H,body,hazards} = _sn;
    const used = new Set([...body.map(([x,y])=>x+','+y), ...hazards.map(h=>h.x+','+h.y)]);
    let x, y;
    do { x=Math.floor(Math.random()*W); y=Math.floor(Math.random()*H); } while(used.has(x+','+y));
    _sn.food = { x, y, t: _SN_FOOD[Math.floor(Math.random()*_SN_FOOD.length)] };
  }

  function _snAddHazard() {
    const {W,H,body,food,hazards} = _sn;
    const used = new Set([...body.map(([x,y])=>x+','+y), food?[food.x+','+food.y]:[], ...hazards.map(h=>h.x+','+h.y)].flat());
    let x, y, tries=0;
    do { x=Math.floor(Math.random()*W); y=Math.floor(Math.random()*H); tries++; } while(used.has(x+','+y) && tries<50);
    if (tries < 50) _sn.hazards.push({ x, y, e: _SN_HAZARDS[Math.floor(Math.random()*_SN_HAZARDS.length)] });
  }

  function _snTick() {
    _sn.dir = _sn.nd;
    const [hx,hy] = _sn.body[0];
    const nx = (hx + _sn.dir[0] + _sn.W) % _sn.W;
    const ny = (hy + _sn.dir[1] + _sn.H) % _sn.H;
    if (_sn.body.slice(1).some(([x,y])=>x===nx&&y===ny)) { _snOver(); return; }
    if (_sn.hazards.some(h=>h.x===nx&&h.y===ny)) { _snOver(); return; }
    _sn.body.unshift([nx,ny]);
    if (_sn.food && nx===_sn.food.x && ny===_sn.food.y) {
      _sn.score += _sn.food.t.p;
      _sn.combo++;
      _sn.maxCombo = Math.max(_sn.maxCombo, _sn.combo);
      const sc = document.getElementById('sn-s');
      if (sc) sc.textContent = _sn.score;
      const cb = document.getElementById('sn-combo');
      if (cb) cb.textContent = _sn.combo >= 3 ? `🔥 Combo ×${_sn.combo}` : '';
      _snFood();
      if (_sn.score % 8 === 0 && _sn.hazards.length < 5) _snAddHazard();
    } else {
      _sn.body.pop();
    }
  }

  function _snDraw(cv) {
    const ctx = cv.getContext('2d');
    const {cs,W,H,body,food,hazards,paused} = _sn;
    const cw = cs*W, ch = cs*H;
    ctx.fillStyle = '#0D1117'; ctx.fillRect(0,0,cw,ch);
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for(let x=0;x<W;x++) for(let y=0;y<H;y++) ctx.fillRect(x*cs+cs/2-1,y*cs+cs/2-1,2,2);
    body.forEach(([x,y],i) => {
      const alpha = Math.max(0.2, 1 - i * 0.05);
      ctx.fillStyle = i===0 ? '#00F5D4' : `rgba(0,245,212,${alpha})`;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x*cs+1,y*cs+1,cs-2,cs-2,i===0?5:2);
      else ctx.rect(x*cs+1,y*cs+1,cs-2,cs-2);
      ctx.fill();
    });
    ctx.font = `${cs-3}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    if (food) ctx.fillText(food.t.e, food.x*cs+cs/2, food.y*cs+cs/2);
    hazards.forEach(h => ctx.fillText(h.e, h.x*cs+cs/2, h.y*cs+cs/2));
    if (paused) {
      ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,cw,ch);
      ctx.fillStyle='#fff'; ctx.font=`bold ${cs+6}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('PAUSE',cw/2,ch/2);
    }
  }

  async function _snOver() {
    _sn.over = true; _stopLoop(); document.removeEventListener('keydown', _snakeKey);
    const score = _sn.score, best = _best('snake'), isNew = score > best;
    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `<div class="game-end">
      <div class="game-end-em">🔌</div>
      <div class="game-end-title">Game Over !</div>
      <div class="game-end-score">${score} points</div>
      ${isNew ? '<div class="game-end-new">🏆 Nouveau record !</div>' : `<div class="game-end-sub">Record : ${best}</div>`}
      ${_sn.maxCombo >= 3 ? `<div class="game-end-combo">🔥 Meilleur combo : ×${_sn.maxCombo}</div>` : ''}
      <div id="sn-mp-result" style="font-size:14px;color:var(--green);min-height:22px"></div>
      <div class="game-end-btns">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._snakeInit()"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._back()"><i class="fas fa-home"></i> Accueil</button>
      </div>
    </div>`;
    await _save('snake', score, { maxCombo: _sn.maxCombo });
    const mp = await _awardMp('snake', Math.min(score, 15), `Snake : ${score} pts${_sn.maxCombo>=3?' combo×'+_sn.maxCombo:''}`);
    const el = document.getElementById('sn-mp-result');
    if (el && mp > 0) el.innerHTML = `<i class="fas fa-coins" style="color:var(--jour)"></i> +${mp} MP gagnés !`;
  }

  // ─────────────────────────────────────────────
  //  STOCK — Product sorting (tap correct shelf)
  // ─────────────────────────────────────────────
  let _sk = {};

  const _SK_PRODUCTS = [
    { name:'Ampoule E27',       shelf:'RAY-01', icon:'💡' },
    { name:'Ampoule LED T8',    shelf:'RAY-01', icon:'💡' },
    { name:'Fusible 16A',       shelf:'RAY-02', icon:'⚡' },
    { name:'Fusible 63A',       shelf:'RAY-02', icon:'⚡' },
    { name:'Disjoncteur 20A',   shelf:'RAY-03', icon:'🔌' },
    { name:'Disjoncteur 32A',   shelf:'RAY-03', icon:'🔌' },
    { name:'Joint torique 20',  shelf:'RAY-04', icon:'⭕' },
    { name:'Joint plat DN50',   shelf:'RAY-04', icon:'⭕' },
    { name:'Filtre à huile',    shelf:'RAY-05', icon:'🛢️' },
    { name:'Huile 15W40',       shelf:'RAY-05', icon:'🛢️' },
    { name:'Roulement 6205',    shelf:'RAY-06', icon:'⚙️' },
    { name:'Roulement 6207',    shelf:'RAY-06', icon:'⚙️' },
    { name:'Courroie B42',      shelf:'RAY-07', icon:'🔧' },
    { name:'Courroie trapèz.',  shelf:'RAY-07', icon:'🔧' },
    { name:'Filtre air G3',     shelf:'RAY-08', icon:'💨' },
    { name:'Filtre clim EU4',   shelf:'RAY-08', icon:'💨' },
    { name:'Vanne 1/2"',        shelf:'RAY-09', icon:'🚿' },
    { name:'Robinet bille 3/4', shelf:'RAY-09', icon:'🚿' },
    { name:'Câble H07 1.5mm²',  shelf:'RAY-10', icon:'🔵' },
    { name:'Câble U1000 2.5mm²',shelf:'RAY-10', icon:'🔵' }
  ];

  function _stockInit() {
    const ROUNDS = 12;
    const products = [..._SK_PRODUCTS].sort(() => Math.random()-0.5).slice(0, ROUNDS);
    _sk = { products, cur:0, score:0, correct:0, wrong:0, totalCorrect:0, start:Date.now(), timer:null, timeLeft:6, answered:false };
    _skQuestion();
  }

  function _skQuestion() {
    if (_sk.cur >= _sk.products.length) { _skEnd(); return; }
    _sk.answered = false;
    _sk.timeLeft = 6;

    const p   = _sk.products[_sk.cur];
    const num = _sk.cur + 1, tot = _sk.products.length;
    const pct = Math.round((_sk.cur / tot) * 100);

    const allShelves = [...new Set(_SK_PRODUCTS.map(x => x.shelf))];
    const wrong3 = allShelves.filter(s => s !== p.shelf).sort(() => Math.random()-0.5).slice(0,3);
    const opts   = [...wrong3, p.shelf].sort(() => Math.random()-0.5);

    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `
      <div class="sk-top">
        <div class="sk-progress-bar"><div class="sk-progress-fill" style="width:${pct}%"></div></div>
        <div class="sk-stats">
          <span class="sk-stat-ok">✓ ${_sk.correct}</span>
          <span class="sk-counter">${num}/${tot}</span>
          <span class="sk-timer-badge" id="sk-timer">${_sk.timeLeft}s</span>
        </div>
      </div>
      <div class="sk-product-card">
        <div class="sk-product-icon">${p.icon}</div>
        <div class="sk-product-name">${MX.esc(p.name)}</div>
        <div class="sk-product-sub">Glissez vers le bon rayon</div>
      </div>
      <div class="sk-shelves">
        ${opts.map(s => `
          <button class="sk-shelf-btn" onclick="MX.Pages.MiniGames._skAns('${s}','${p.shelf}')" id="sk-shelf-${s.replace('-','_')}">
            <span class="sk-shelf-icon">🗄️</span>
            <span class="sk-shelf-label">${s}</span>
          </button>`).join('')}
      </div>`;

    clearInterval(_sk.timer);
    _sk.timer = setInterval(() => {
      _sk.timeLeft--;
      const tb = document.getElementById('sk-timer');
      if (tb) { tb.textContent = _sk.timeLeft + 's'; if (_sk.timeLeft <= 2) tb.classList.add('urgent'); }
      if (_sk.timeLeft <= 0 && !_sk.answered) _skAns('__timeout__', _SK_PRODUCTS.find(x=>x.name===_sk.products[_sk.cur]?.name)?.shelf||'');
    }, 1000);
  }

  function _skAns(chosen, correct) {
    if (_sk.answered) return;
    _sk.answered = true;
    clearInterval(_sk.timer);
    const ok = chosen === correct;
    if (ok) { _sk.score += 10; _sk.correct++; _sk.totalCorrect++; }
    else    { _sk.score  = Math.max(0, _sk.score - 3); _sk.wrong++; }

    document.querySelectorAll('.sk-shelf-btn').forEach(b => {
      b.disabled = true;
      const lbl = b.querySelector('.sk-shelf-label').textContent;
      if (lbl === correct)        b.classList.add('sk-correct');
      else if (lbl === chosen && !ok) b.classList.add('sk-wrong');
    });

    const fb = document.createElement('div');
    fb.className = 'sk-feedback ' + (ok ? 'sk-fb-ok' : 'sk-fb-no');
    fb.innerHTML = ok ? `✓ Bonne rayon !` : (chosen === '__timeout__' ? '⏱ Temps !' : `✗ C'était ${correct}`);
    const area = document.getElementById('mg-area');
    if (area) area.appendChild(fb);

    setTimeout(() => { _sk.cur++; _skQuestion(); }, ok ? 800 : 1200);
  }

  async function _skEnd() {
    clearInterval(_sk.timer);
    const sec  = Math.floor((Date.now()-_sk.start)/1000);
    const score = _sk.score, tot = _sk.products.length;
    const pct  = Math.round(_sk.correct / tot * 100);
    const medal = pct >= 90 ? '🥇' : pct >= 70 ? '🥈' : pct >= 50 ? '🥉' : '';
    const em   = pct >= 80 ? '📦' : pct >= 50 ? '😊' : '😅';
    const mp   = pct >= 90 ? 20 : pct >= 70 ? 14 : pct >= 50 ? 8 : 3;

    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `<div class="game-end">
      <div class="game-end-em">${em}</div>
      <div class="game-end-title">Tri terminé !</div>
      ${medal ? `<div class="game-end-new">${medal} ${pct >= 90 ? 'Or' : pct >= 70 ? 'Argent' : 'Bronze'}</div>` : ''}
      <div class="game-end-score">${score} pts</div>
      <div class="game-end-sub">✓ ${_sk.correct} / ${tot} · ✗ ${_sk.wrong} · ${_fmt(sec)}</div>
      <div id="sk-mp-result" style="font-size:14px;color:var(--green);min-height:22px"></div>
      <div class="game-end-btns">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._stockInit()"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._back()"><i class="fas fa-home"></i> Accueil</button>
      </div>
    </div>`;

    await _save('stock', score, { time: sec, correct: _sk.correct, total: tot, totalCorrect: _sk.totalCorrect });
    const awarded = await _awardMp('stock', mp, `Tri du Stock : ${_sk.correct}/${tot}${medal ? ' ' + medal : ''}`);
    const el = document.getElementById('sk-mp-result');
    if (el) el.innerHTML = awarded > 0
      ? `<i class="fas fa-coins" style="color:var(--jour)"></i> +${awarded} MP gagnés !`
      : (mp > 0 ? 'Limite journalière atteinte' : '');
  }

  // ── EXPORTS ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.MiniGames = {
    render,
    META,
    _scn:  function(s){ _scene=s; _renderHub(); },
    _lb:   function(g){ _lbGame=g; _renderHub(); },
    _go,
    _back,
    // Quiz
    _quizInit, _quizStart, _quizAns,
    // Snake
    _snakeInit, _snDir, _snPause,
    // Stock
    _stockInit, _skAns,
    // Admin
    _qModal, _qDel, _resetScores
  };
})();
