(function () {
  // ── MODULE STATE ──
  let _scene = 'hub';   // 'hub' | 'leaderboard' | 'achievements' | 'admin'
  let _lbGame = 'all';
  let _loop = null, _loopType = null;

  // ── GAME METADATA ──
  const META = [
    { id: 'puzzle', icon: '⚡', name: 'Puzzle Électrique',  desc: 'Reconstituez le schéma contre la montre.', unlockPts: 100,  dailyMp: 5,  diff: 2 },
    { id: 'memory', icon: '🃏', name: 'Memory Maintenance',  desc: 'Retrouvez les paires équipements.',         unlockPts: 250,  dailyMp: 10, diff: 2 },
    { id: 'quiz',   icon: '📡', name: 'Quiz Technique',      desc: 'Questions sur la maintenance industrielle.', unlockPts: 500,  dailyMp: 10, diff: 3 },
    { id: 'snake',  icon: '🔌', name: 'Snake Industriel',    desc: 'Collectez les outils, évitez les alarmes.', unlockPts: 1000, dailyMp: 15, diff: 3 },
    { id: 'stock',  icon: '📦', name: 'Gestion du Stock',    desc: 'Empilez les caisses, videz le dépôt.',      unlockPts: 2000, dailyMp: 20, diff: 4 }
  ];

  const ACHIEVEMENTS_DEF = [
    { id: 'first_puzzle',  gameId: 'puzzle', icon: '⚡', name: 'Premier Câblage',    desc: 'Terminez votre premier Puzzle Électrique.' },
    { id: 'memory_10',     gameId: 'memory', icon: '🃏', name: 'Expert Mémoire',     desc: 'Gagnez 10 parties de Memory.', count: 10 },
    { id: 'quiz_perfect',  gameId: 'quiz',   icon: '📡', name: 'Quiz Parfait',       desc: 'Score parfait au Quiz Technique (10/10).' },
    { id: 'snake_100',     gameId: 'snake',  icon: '🔌', name: 'Câbleur Élite',      desc: 'Atteignez 100 points au Snake Industriel.' },
    { id: 'stock_lines10', gameId: 'stock',  icon: '📦', name: 'Gestionnaire Stock', desc: 'Effacez 10 lignes en Gestion du Stock.' },
    { id: 'arcade_all',    gameId: 'puzzle', icon: '🏆', name: 'Maître Arcade',      desc: 'Jouez à tous les jeux de l\'Arcade.' }
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

  // ── SAVE SCORE + ACHIEVEMENTS ──
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
    const userAch = ((MX.state.gameAchievements || {})[uid]) || {};
    const myScores = (MX.state.gameScores || []).filter(s => s.userId === uid && s.gameId === gid);

    for (const a of ACHIEVEMENTS_DEF) {
      if (a.gameId !== gid || userAch[a.id]) continue;
      let unlock = false;
      if (a.id === 'first_puzzle'  && gid === 'puzzle')                   unlock = true;
      if (a.id === 'memory_10'     && gid === 'memory')                   unlock = (myScores.length + 1) >= 10;
      if (a.id === 'quiz_perfect'  && gid === 'quiz'   && score >= 10)    unlock = true;
      if (a.id === 'snake_100'     && gid === 'snake'  && score >= 100)   unlock = true;
      if (a.id === 'stock_lines10' && gid === 'stock'  && (extra&&extra.lines||0) >= 10) unlock = true;
      if (unlock) {
        try {
          await MX.DB.saveGameAchievement({ userId: uid, userName: un, achievementId: a.id, name: a.name, icon: a.icon });
          MX.toast(`${a.icon} Succès débloqué : ${a.name} !`);
        } catch(e) {}
      }
    }
  }

  // ── BEST SCORE ──
  function _best(gid) {
    const uid = _uid();
    return (MX.state.gameScores || []).filter(s => s.userId === uid && s.gameId === gid)
      .reduce((b, s) => s.score > b ? s.score : b, 0);
  }

  // ── STOP LOOP ──
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
    document.removeEventListener('keydown', _stockKey);
    document.removeEventListener('keydown', _stockSpaceKey);
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
          <div class="arc-kpi-lbl">MP disponibles</div>
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
    const C = '#00C2D1', C2 = 'rgba(0,194,209,0.15)', BG = '#080f1a', BG2 = '#0d1e2e', G = '#10B981', O = '#F59E0B', R = '#EF4444', P = '#8B5CF6';
    const svgs = {
      puzzle: `<svg viewBox="0 0 100 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="64" fill="${BG}"/>
        <rect x="6" y="5" width="26" height="26" rx="4" fill="${BG2}" stroke="${C}" stroke-width="1.2"/>
        <rect x="37" y="5" width="26" height="26" rx="4" fill="${BG2}" stroke="${C}" stroke-width="1.2"/>
        <rect x="68" y="5" width="26" height="26" rx="4" fill="${BG2}" stroke="${C}" stroke-width="1.2"/>
        <rect x="6" y="36" width="26" height="26" rx="4" fill="${BG2}" stroke="${C}" stroke-width="1.2"/>
        <rect x="37" y="36" width="26" height="26" rx="4" fill="${BG2}" stroke="rgba(0,194,209,0.25)" stroke-width="1" stroke-dasharray="3,2"/>
        <rect x="68" y="36" width="26" height="26" rx="4" fill="${BG2}" stroke="${C}" stroke-width="1.2"/>
        <path d="M52 10 L47 24 L51 24 L46 42 L55 26 L51 26 Z" fill="${C}" opacity="0.9"/>
        <path d="M16 40 L20 44 L24 40" stroke="${G}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M10 48 L28 48" stroke="${G}" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
        <circle cx="19" cy="14" r="5" fill="none" stroke="${O}" stroke-width="1.5" opacity="0.7"/>
        <path d="M79 14 L81 18 L83 14 L85 18" stroke="${C}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>`,

      memory: `<svg viewBox="0 0 100 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="64" fill="${BG}"/>
        <rect x="5" y="6" width="26" height="36" rx="4" fill="${C2}" stroke="${C}" stroke-width="1.5"/>
        <text x="18" y="30" font-size="16" text-anchor="middle" fill="${C}">🔧</text>
        <rect x="37" y="6" width="26" height="36" rx="4" fill="${BG2}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <path d="M43 18 L63 18 M43 24 L57 24 M43 30 L60 30" stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-linecap="round"/>
        <rect x="69" y="6" width="26" height="36" rx="4" fill="rgba(245,158,11,0.12)" stroke="${O}" stroke-width="1.5"/>
        <text x="82" y="30" font-size="16" text-anchor="middle" fill="${O}">⚡</text>
        <rect x="5" y="48" width="26" height="14" rx="3" fill="${BG2}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <rect x="37" y="48" width="26" height="14" rx="3" fill="rgba(245,158,11,0.12)" stroke="${O}" stroke-width="1.5"/>
        <text x="50" y="58" font-size="8" text-anchor="middle" fill="${O}">⚡</text>
        <rect x="69" y="48" width="26" height="14" rx="3" fill="${BG2}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      </svg>`,

      quiz: `<svg viewBox="0 0 100 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="64" fill="${BG}"/>
        <rect x="5" y="5" width="90" height="54" rx="6" fill="${BG2}" stroke="${C}" stroke-width="1.2"/>
        <rect x="5" y="5" width="90" height="54" rx="6" fill="none" stroke="${C}" stroke-width="0.5" opacity="0.3"/>
        <rect x="5" y="22" width="90" height="1" fill="${C}" opacity="0.15"/>
        <rect x="5" y="43" width="90" height="1" fill="${C}" opacity="0.15"/>
        <text x="26" y="38" font-size="22" font-weight="bold" fill="${C}" opacity="0.95" font-family="monospace">Q?</text>
        <rect x="50" y="12" width="38" height="5" rx="2" fill="rgba(0,194,209,0.1)" stroke="${C}" stroke-width="0.8"/>
        <rect x="50" y="26" width="30" height="5" rx="2" fill="rgba(16,185,129,0.15)" stroke="${G}" stroke-width="0.8"/>
        <rect x="50" y="33" width="34" height="5" rx="2" fill="rgba(0,194,209,0.06)"/>
        <text x="53" y="30" font-size="5" fill="${G}" font-family="monospace">✓ Ampère</text>
        <circle cx="92" cy="9" r="2.5" fill="${C}" opacity="0.6"/>
        <path d="M8 52 L16 52" stroke="${C}" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
        <path d="M20 52 L28 52" stroke="${C}" stroke-width="1" stroke-linecap="round" opacity="0.3"/>
      </svg>`,

      snake: `<svg viewBox="0 0 100 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="64" fill="${BG}"/>
        ${Array.from({length:45},(_,i)=>`<circle cx="${(i%9)*11+7}" cy="${Math.floor(i/9)*14+7}" r="1.2" fill="rgba(0,194,209,0.12)"/>`).join('')}
        <circle cx="18" cy="7" r="6" fill="${C}"/>
        <circle cx="15" cy="5" r="1.8" fill="${BG}"/>
        <circle cx="21" cy="5" r="1.8" fill="${BG}"/>
        <circle cx="29" cy="7" r="5.5" fill="${C}" opacity="0.85"/>
        <circle cx="40" cy="7" r="5.5" fill="${C}" opacity="0.75"/>
        <circle cx="51" cy="7" r="5.5" fill="${C}" opacity="0.65"/>
        <circle cx="51" cy="21" r="5.5" fill="${C}" opacity="0.55"/>
        <circle cx="40" cy="21" r="5.5" fill="${C}" opacity="0.45"/>
        <circle cx="29" cy="21" r="5.5" fill="${C}" opacity="0.35"/>
        <text x="73" y="19" font-size="14" text-anchor="middle" fill="${O}">🔧</text>
        <text x="18" y="52" font-size="12" text-anchor="middle" fill="${R}">🚨</text>
        <text x="73" y="52" font-size="12" text-anchor="middle" fill="${C}">💡</text>
      </svg>`,

      stock: `<svg viewBox="0 0 100 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="64" fill="${BG}"/>
        <rect x="4" y="5" width="3" height="57" rx="1" fill="${BG2}" stroke="rgba(0,194,209,0.2)" stroke-width="0.5"/>
        <rect x="93" y="5" width="3" height="57" rx="1" fill="${BG2}" stroke="rgba(0,194,209,0.2)" stroke-width="0.5"/>
        <rect x="4" y="19" width="92" height="2" rx="1" fill="rgba(0,194,209,0.25)"/>
        <rect x="4" y="38" width="92" height="2" rx="1" fill="rgba(0,194,209,0.25)"/>
        <rect x="4" y="57" width="92" height="2" rx="1" fill="rgba(0,194,209,0.25)"/>
        <rect x="10" y="40" width="14" height="17" rx="2" fill="${C}" opacity="0.8"/>
        <rect x="26" y="40" width="14" height="17" rx="2" fill="${O}" opacity="0.8"/>
        <rect x="42" y="40" width="14" height="17" rx="2" fill="${G}" opacity="0.8"/>
        <rect x="58" y="40" width="14" height="17" rx="2" fill="${C}" opacity="0.7"/>
        <rect x="74" y="44" width="14" height="13" rx="2" fill="${O}" opacity="0.7"/>
        <rect x="10" y="21" width="14" height="17" rx="2" fill="${O}" opacity="0.7"/>
        <rect x="26" y="21" width="14" height="17" rx="2" fill="${C}" opacity="0.7"/>
        <rect x="42" y="25" width="14" height="13" rx="2" fill="${R}" opacity="0.7"/>
        <rect x="58" y="28" width="14" height="10" rx="2" fill="${P}" opacity="0.7"/>
        <rect x="65" y="6" width="14" height="12" rx="2" fill="${P}" opacity="0.85" stroke="${P}" stroke-width="0.8"/>
        <path d="M65 14 L79 14" stroke="${P}" stroke-width="1" stroke-dasharray="2,1" opacity="0.6"/>
      </svg>`
    };
    return svgs[id] || `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px">${META.find(m=>m.id===id)?.icon||'🎮'}</div>`;
  }

  // ── GAME GRID ──
  function _renderGrid(uid, pts) {
    const scores = MX.state.gameScores || [];
    let h = `<div class="arc-grid">`;

    META.forEach(g => {
      const locked   = pts < g.unlockPts;
      const myScores = uid ? scores.filter(s => s.userId === uid && s.gameId === g.id) : [];
      const best     = myScores.reduce((b,s) => Math.max(b, s.score), 0);
      const plays    = myScores.length;
      const earned   = uid ? _dailyEarned(uid, g.id) : 0;
      const left     = Math.max(0, g.dailyMp - earned);
      const stars    = '★'.repeat(g.diff) + '☆'.repeat(5 - g.diff);

      h += `<div class="arc-card${locked?' arc-locked':''}">
        <div class="arc-art arc-art-${g.id}">
          ${_artSvg(g.id)}
          <div class="arc-art-overlay">
            ${locked
              ? `<span class="arc-badge-pill arc-badge-lock"><i class="fas fa-lock"></i> ${g.unlockPts} MP</span>`
              : `<span class="arc-badge-pill arc-badge-ok"><i class="fas fa-circle" style="font-size:5px"></i> Dispo</span>`
            }
          </div>
          ${!locked && best > 0 ? `<div class="arc-art-best"><i class="fas fa-trophy"></i> ${best}</div>` : ''}
        </div>
        <div class="arc-card-body">
          <div class="arc-card-row">
            <span class="arc-card-name">${MX.esc(g.name)}</span>
            <span class="arc-card-mp">+${g.dailyMp}<span>MP</span></span>
          </div>
          <div class="arc-card-desc">${MX.esc(g.desc)}</div>
          <div class="arc-card-meta">
            <span class="arc-diff" title="Difficulté">${stars}</span>
            ${!locked && plays > 0 ? `<span class="arc-plays">${plays}<i class="fas fa-gamepad"></i></span>` : ''}
          </div>`;

      if (locked) {
        const pct = Math.min(100, Math.round(pts / g.unlockPts * 100));
        h += `<div class="arc-lock-bar">
          <div class="arc-lock-track"><div class="arc-lock-fill" style="width:${pct}%"></div></div>
          <div class="arc-lock-txt">${pts} / ${g.unlockPts} MP</div>
        </div>`;
      } else {
        h += `<div class="arc-card-footer">
          <span class="arc-mp-left${left <= 0 ? ' exhausted' : ''}">
            ${left > 0 ? `<i class="fas fa-coins"></i> ${left}/${g.dailyMp}` : `<i class="fas fa-check-circle"></i> Max`}
          </span>
          ${uid ? `<button class="arc-play-btn" onclick="MX.Pages.MiniGames._go('${g.id}')"><i class="fas fa-play"></i> Jouer</button>` : ''}
        </div>`;
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
      const ok = !!userAch[a.id];
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

  // ── QUESTION MODAL ──
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
    <div class="page-body"><div id="mg-area"></div></div>`;

    if (gameId === 'puzzle') _pzInit();
    if (gameId === 'memory') _memInit();
    if (gameId === 'quiz')   _quizInit();
    if (gameId === 'snake')  _snakeInit();
    if (gameId === 'stock')  _stockInit();
  }

  function _back() { _destroy(); render(); }

  // ─────────────────────────────────────────────
  //  PUZZLE — sliding 8/15/24-puzzle
  // ─────────────────────────────────────────────
  let _pz = {};

  function _pzInit() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `<div style="text-align:center;padding:20px 0">
      <div class="section-label">Choisir la difficulté</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:12px">
        <button class="primary-btn" style="width:130px" onclick="MX.Pages.MiniGames._pzStart(3)">🟩 3×3<br><small>Facile</small></button>
        <button class="primary-btn" style="width:130px;background:var(--orange-dim);border-color:var(--orange);color:var(--orange)" onclick="MX.Pages.MiniGames._pzStart(4)">🟧 4×4<br><small>Moyen</small></button>
        <button class="primary-btn" style="width:130px;background:var(--red-dim);border-color:var(--red);color:var(--red)" onclick="MX.Pages.MiniGames._pzStart(5)">🟥 5×5<br><small>Difficile</small></button>
      </div>
    </div>`;
  }

  function _pzStart(n) {
    _pz = { n, tiles: Array.from({length:n*n},(_,i)=>i), empty: n*n-1, moves:0, start: Date.now(), iv: null, done: false };
    _pzShuffle();
    _pz.iv = setInterval(() => {
      const e = document.getElementById('mg-pz-t');
      if (e) e.textContent = _fmt(Math.floor((Date.now()-_pz.start)/1000));
    }, 1000);
    _pzDraw();
  }

  function _pzShuffle() {
    const n = _pz.n, dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (let i = 0; i < 400; i++) {
      const er = Math.floor(_pz.empty/n), ec = _pz.empty%n;
      const ok = dirs.filter(([dr,dc]) => { const nr=er+dr,nc=ec+dc; return nr>=0&&nr<n&&nc>=0&&nc<n; });
      const [dr,dc] = ok[Math.floor(Math.random()*ok.length)];
      const si = (er+dr)*n+(ec+dc);
      [_pz.tiles[_pz.empty],_pz.tiles[si]] = [_pz.tiles[si],_pz.tiles[_pz.empty]];
      _pz.empty = si;
    }
  }

  function _pzDraw() {
    const a = document.getElementById('mg-area');
    if (!a || _pz.done) return;
    const n  = _pz.n;
    const sz = Math.min(340, window.innerWidth - 56);
    const cs = Math.floor(sz / n);
    const COLS = ['#10B981','#F59E0B','#EF4444'];
    const col  = COLS[n-3] || COLS[0];
    const sec  = Math.floor((Date.now()-_pz.start)/1000);

    let h = `<div style="display:flex;justify-content:space-between;margin-bottom:12px;align-items:center">
      <span id="mg-pz-t" style="font-family:var(--ffm);font-size:16px;color:var(--cyan)">${_fmt(sec)}</span>
      <span style="font-size:13px;color:var(--text2)">${_pz.moves} coups</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${n},1fr);gap:4px;width:${sz}px;margin:0 auto">`;

    _pz.tiles.forEach((v,i) => {
      const emp = i === _pz.empty;
      h += `<div onclick="MX.Pages.MiniGames._pzTap(${i})" style="width:${cs}px;height:${cs}px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:var(--ffm);font-size:${Math.max(14,cs/3)}px;font-weight:700;cursor:${emp?'default':'pointer'};transition:all 0.12s;
        ${emp?'opacity:0':'background:'+col+'22;border:2px solid '+col+'55;color:'+col+';'}">${emp?'':v+1}</div>`;
    });

    h += `</div>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
      <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._pzInit()">Changer difficulté</button>
    </div>`;
    a.innerHTML = h;
  }

  function _pzTap(idx) {
    if (_pz.done) return;
    const n = _pz.n;
    const er=Math.floor(_pz.empty/n), ec=_pz.empty%n;
    const tr=Math.floor(idx/n),      tc=idx%n;
    if (Math.abs(er-tr)+Math.abs(ec-tc) !== 1) return;
    [_pz.tiles[_pz.empty],_pz.tiles[idx]] = [_pz.tiles[idx],_pz.tiles[_pz.empty]];
    _pz.empty = idx; _pz.moves++;
    if (_pz.tiles.every((v,i) => i===_pz.n*_pz.n-1 ? v===_pz.n*_pz.n-1 : v===i)) {
      _pz.done = true; clearInterval(_pz.iv); _pzWin();
    } else { _pzDraw(); }
  }

  async function _pzWin() {
    const sec   = Math.floor((Date.now()-_pz.start)/1000);
    const score = Math.max(1, Math.round(1000/(sec+_pz.moves)));
    document.getElementById('mg-area').innerHTML = `<div style="text-align:center;padding:32px 16px">
      <div style="font-size:56px;margin-bottom:12px">🎉</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:6px">Puzzle résolu !</div>
      <div style="color:var(--text2);margin-bottom:4px">${_fmt(sec)} · ${_pz.moves} coups</div>
      <div style="font-size:18px;font-weight:700;color:var(--cyan);margin-bottom:12px">Score : ${score}</div>
      <div id="mg-rwd" style="font-size:14px;color:var(--green);margin-bottom:16px"></div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._pzStart(${_pz.n})"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._pzInit()">Difficulté</button>
      </div>
    </div>`;
    await _save('puzzle', score, { time: sec, moves: _pz.moves, size: _pz.n });
    const mp = await _awardMp('puzzle', 5, `Puzzle ${_pz.n}×${_pz.n} résolu en ${_fmt(sec)}`);
    const el = document.getElementById('mg-rwd');
    if (el) el.innerHTML = mp > 0 ? `<i class="fas fa-coins" style="color:var(--jour)"></i> +${mp} MP gagnés !` : 'Limite journalière atteinte';
  }

  // ─────────────────────────────────────────────
  //  MEMORY — card pairs
  // ─────────────────────────────────────────────
  let _mem = {};
  const _EMOJIS = ['🔧','🔌','💡','🔩','🛠️','🔋','⚙️','🚧','🔦','🧰','🪛','🔨','⚠️','🏭','🎛️','💨'];

  function _memInit() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    a.innerHTML = `<div style="text-align:center;padding:20px 0">
      <div class="section-label">Choisir la difficulté</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:12px">
        <button class="primary-btn" style="width:130px" onclick="MX.Pages.MiniGames._memStart(4,4)">🟩 4×4<br><small>8 paires</small></button>
        <button class="primary-btn" style="width:130px;background:var(--orange-dim);border-color:var(--orange);color:var(--orange)" onclick="MX.Pages.MiniGames._memStart(5,4)">🟧 5×4<br><small>10 paires</small></button>
        <button class="primary-btn" style="width:130px;background:var(--red-dim);border-color:var(--red);color:var(--red)" onclick="MX.Pages.MiniGames._memStart(6,4)">🟥 6×4<br><small>12 paires</small></button>
      </div>
    </div>`;
  }

  function _memStart(cols, rows) {
    const pairs = (cols * rows) / 2;
    const icons = _EMOJIS.slice(0, pairs);
    const deck  = [...icons,...icons].sort(() => Math.random()-0.5);
    _mem = { cols, rows, deck, up:[], matched: new Set(), moves:0, start: Date.now(), busy:false, iv:null, done:false };
    _mem.iv = setInterval(() => {
      const e = document.getElementById('mg-mem-t');
      if (e) e.textContent = _fmt(Math.floor((Date.now()-_mem.start)/1000));
    }, 1000);
    _memDraw();
  }

  function _memDraw() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    const { cols, rows, deck, up, matched } = _mem;
    const total = deck.length;
    const sec   = Math.floor((Date.now()-_mem.start)/1000);
    const sz    = Math.min(360, window.innerWidth - 48);
    const cw    = Math.floor(sz / cols) - 4;
    const ch    = Math.min(cw, 80);

    let h = `<div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <span id="mg-mem-t" style="font-family:var(--ffm);color:var(--cyan)">${_fmt(sec)}</span>
      <span style="color:var(--text2)">${_mem.moves} coups</span>
      <span style="color:var(--text2)">${matched.size/2|0}/${total/2} paires</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;max-width:${sz}px;margin:0 auto">`;

    for (let i = 0; i < total; i++) {
      const face = up.includes(i) || matched.has(i);
      const ok   = matched.has(i);
      h += `<div class="mg-mc${face?' mg-mc-up':''}${ok?' mg-mc-ok':''}" style="height:${ch}px" onclick="MX.Pages.MiniGames._memTap(${i})">
        <div class="mg-mc-front">${deck[i]}</div>
        <div class="mg-mc-back"><i class="fas fa-question" style="opacity:0.3;font-size:14px"></i></div>
      </div>`;
    }
    h += `</div>
    <button class="primary-btn" style="margin-top:16px;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._memInit()">Recommencer</button>`;
    a.innerHTML = h;
  }

  function _memTap(idx) {
    if (_mem.busy || _mem.matched.has(idx) || _mem.up.includes(idx) || _mem.done) return;
    _mem.up.push(idx);
    _memDraw();
    if (_mem.up.length === 2) {
      _mem.moves++;
      _mem.busy = true;
      const [a,b] = _mem.up;
      if (_mem.deck[a] === _mem.deck[b]) {
        _mem.matched.add(a); _mem.matched.add(b);
        _mem.up = []; _mem.busy = false;
        _memDraw();
        if (_mem.matched.size === _mem.deck.length) { _mem.done = true; clearInterval(_mem.iv); _memWin(); }
      } else {
        setTimeout(() => { _mem.up = []; _mem.busy = false; _memDraw(); }, 900);
      }
    }
  }

  async function _memWin() {
    const sec   = Math.floor((Date.now()-_mem.start)/1000);
    const pairs = _mem.deck.length/2;
    const score = Math.max(1, Math.round(pairs*100/(sec+_mem.moves)));
    document.getElementById('mg-area').innerHTML = `<div style="text-align:center;padding:32px 16px">
      <div style="font-size:56px;margin-bottom:12px">🧠</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:6px">Memory résolu !</div>
      <div style="color:var(--text2);margin-bottom:4px">${_fmt(sec)} · ${_mem.moves} coups</div>
      <div style="font-size:18px;font-weight:700;color:var(--cyan);margin-bottom:12px">Score : ${score}</div>
      <div id="mg-rwd" style="font-size:14px;color:var(--green);margin-bottom:16px"></div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._memStart(${_mem.cols},${_mem.rows})"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._memInit()">Difficulté</button>
      </div>
    </div>`;
    await _save('memory', score, { time: sec, moves: _mem.moves, pairs });
    const mp = await _awardMp('memory', 10, `Memory résolu en ${_fmt(sec)}`);
    const el = document.getElementById('mg-rwd');
    if (el) el.innerHTML = mp > 0 ? `<i class="fas fa-coins" style="color:var(--jour)"></i> +${mp} MP gagnés !` : 'Limite journalière atteinte';
  }

  // ─────────────────────────────────────────────
  //  QUIZ — multiple choice
  // ─────────────────────────────────────────────
  let _qz = {};

  const _QZ_DEF = [
    { q:'Que signifie GMAO ?', a:['Gestion de la Maintenance Assistée par Ordinateur','Grande Machine À Outils','Guide de Maintenance des Appareils Outil','Gestion des Matériels et Actifs Organisés'], ok:0, cat:'Général' },
    { q:'Quelle est la fonction d\'un plan de maintenance préventive ?', a:['Intervenir après panne','Planifier des interventions régulières','Rédiger des rapports d\'incident','Gérer les stocks de pièces'], ok:1, cat:'Général' },
    { q:'Quelle est l\'unité du courant électrique ?', a:['Volt','Ohm','Ampère','Watt'], ok:2, cat:'Électricité' },
    { q:'Quel composant protège un circuit contre les surintensités ?', a:['Relais','Fusible','Résistance','Condensateur'], ok:1, cat:'Électricité' },
    { q:'Quelle est la fréquence du courant alternatif en France ?', a:['50 Hz','60 Hz','220 Hz','110 Hz'], ok:0, cat:'Électricité' },
    { q:'À quoi sert un manomètre ?', a:['Mesurer la température','Mesurer la pression','Mesurer le débit','Mesurer la viscosité'], ok:1, cat:'Hydraulique' },
    { q:'Quel fluide est utilisé dans les circuits hydrauliques industriels ?', a:['Eau distillée','Huile minérale','Air comprimé','Glycérine'], ok:1, cat:'Hydraulique' },
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
    { q:'Qu\'est-ce que l\'habilitation électrique B1V ?', a:['Travaux hors tension','Travaux sous tension','Vérifications en présence de tension','Consignation d\'un circuit'], ok:2, cat:'Sécurité' }
  ];

  function _quizInit() {
    const fsQ = MX.state.gameQuestions || [];
    const pool = fsQ.length >= 10
      ? fsQ.map(q => ({ q: q.question, a: q.answers, ok: q.correct, cat: q.category||'Général' }))
      : [..._QZ_DEF, ...fsQ.map(q => ({ q: q.question, a: q.answers, ok: q.correct, cat: q.category||'Général' }))];
    const qs = pool.sort(() => Math.random()-0.5).slice(0, 10);
    _qz = { qs, cur: 0, score: 0, start: Date.now(), done: false };
    _quizDraw();
  }

  function _quizDraw() {
    if (_qz.done) { _quizEnd(); return; }
    const a   = document.getElementById('mg-area');
    if (!a) return;
    const q   = _qz.qs[_qz.cur];
    const num = _qz.cur + 1, tot = _qz.qs.length;
    const pct = Math.round((_qz.cur / tot) * 100);
    a.innerHTML = `<div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;color:var(--text2)">${MX.esc(q.cat||'Général')}</span>
        <span style="font-size:12px;color:var(--text2)">${num}/${tot}</span>
      </div>
      <div class="rw-prog-track"><div class="rw-prog-fill" style="width:${pct}%;background:var(--cyan)"></div></div>
    </div>
    <div class="mg-quiz-q">${MX.esc(q.q)}</div>
    <div class="mg-quiz-opts">
      ${(q.a||[]).map((ans,i) => `<button class="mg-quiz-opt" onclick="MX.Pages.MiniGames._quizAns(${i})">${String.fromCharCode(65+i)}. ${MX.esc(ans)}</button>`).join('')}
    </div>`;
  }

  function _quizAns(idx) {
    const q  = _qz.qs[_qz.cur];
    const ok = idx === q.ok;
    if (ok) _qz.score++;
    const a = document.getElementById('mg-area');
    if (a) {
      a.querySelectorAll('.mg-quiz-opt').forEach((b,i) => {
        b.disabled = true;
        if (i === q.ok)  b.style.background = 'var(--green-dim)';
        if (i === idx && !ok) b.style.background = 'var(--red-dim)';
      });
    }
    setTimeout(() => { _qz.cur++; if (_qz.cur >= _qz.qs.length) _qz.done = true; _quizDraw(); }, 700);
  }

  async function _quizEnd() {
    const sec   = Math.floor((Date.now()-_qz.start)/1000);
    const score = _qz.score;
    const tot   = _qz.qs.length;
    const pct   = Math.round(score/tot*100);
    const em    = pct >= 80 ? '🎉' : pct >= 50 ? '😊' : '😅';
    const col   = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--jour)' : 'var(--red)';
    document.getElementById('mg-area').innerHTML = `<div style="text-align:center;padding:32px 16px">
      <div style="font-size:56px;margin-bottom:12px">${em}</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:6px">Quiz terminé !</div>
      <div style="font-size:32px;font-weight:700;color:${col};margin-bottom:4px">${score} / ${tot}</div>
      <div style="color:var(--text2);margin-bottom:12px">${pct}% de bonnes réponses · ${_fmt(sec)}</div>
      <div id="mg-rwd" style="font-size:14px;color:var(--green);margin-bottom:16px"></div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._quizInit()"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._back()"><i class="fas fa-home"></i> Accueil</button>
      </div>
    </div>`;
    await _save('quiz', score, { time: sec, total: tot });
    const mp = await _awardMp('quiz', score, `Quiz : ${score}/${tot} bonnes réponses`);
    const el = document.getElementById('mg-rwd');
    if (el) el.innerHTML = mp > 0 ? `<i class="fas fa-coins" style="color:var(--jour)"></i> +${mp} MP gagnés !` : (score <= 0 ? '' : 'Limite journalière atteinte');
  }

  // ─────────────────────────────────────────────
  //  SNAKE — canvas arcade
  // ─────────────────────────────────────────────
  let _sn = {};
  const _SN_FOOD = [
    { e:'🔧', p:1 }, { e:'🔧', p:1 }, { e:'🔧', p:1 },
    { e:'💡', p:3 }, { e:'💡', p:3 },
    { e:'🔌', p:5 }
  ];

  function _snakeKey(ev) {
    const map = { ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0] };
    const d = map[ev.key];
    if (!d) return;
    ev.preventDefault();
    if (d[0]===-_sn.dir[0] && d[1]===-_sn.dir[1]) return;
    _sn.nd = d;
  }

  function _snakeInit() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    const C=20, W=20, H=20;
    const px = Math.min(360, window.innerWidth-32);
    const cs = Math.floor(px / W);

    a.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:8px;align-items:center">
      <span>Score : <b id="mg-sn-s">0</b></span>
      <span style="font-size:12px;color:var(--text3)">Espace = pause</span>
      <span>Record : <b>${_best('snake')}</b></span>
    </div>
    <canvas id="mg-canvas" width="${cs*W}" height="${cs*H}" style="display:block;margin:0 auto;border:1px solid var(--border2);border-radius:8px;touch-action:none;max-width:100%"></canvas>
    <div style="display:grid;grid-template-columns:repeat(3,48px);gap:4px;margin:12px auto 0;width:fit-content">
      <div></div>
      <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._snDir(0,-1)"><i class="fas fa-chevron-up"></i></button>
      <div></div>
      <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._snDir(-1,0)"><i class="fas fa-chevron-left"></i></button>
      <button class="mg-dpad" style="background:var(--bg4);color:var(--text3)" ontouchstart="MX.Pages.MiniGames._snPause()"><i class="fas fa-pause"></i></button>
      <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._snDir(1,0)"><i class="fas fa-chevron-right"></i></button>
      <div></div>
      <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._snDir(0,1)"><i class="fas fa-chevron-down"></i></button>
      <div></div>
    </div>
    <div style="font-size:11px;color:var(--text3);text-align:center;margin-top:6px">🔧=1pt · 💡=3pts · 🔌=5pts · 🚨=danger</div>`;

    const canvas = document.getElementById('mg-canvas');
    let tx=0, ty=0;
    canvas.addEventListener('touchstart', e => { tx=e.touches[0].clientX; ty=e.touches[0].clientY; }, {passive:true});
    canvas.addEventListener('touchend', e => {
      const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
      if (Math.abs(dx)>Math.abs(dy)) _sn.nd = dx>0?[1,0]:[-1,0];
      else _sn.nd = dy>0?[0,1]:[0,-1];
    }, {passive:true});

    document.addEventListener('keydown', _snakeKey);
    document.addEventListener('keydown', function _sp(e) { if(e.key===' '){e.preventDefault();_sn.paused=!_sn.paused;} });

    const cx=Math.floor(W/2), cy=Math.floor(H/2);
    _sn = { cs, W, H, body:[[cx,cy],[cx-1,cy],[cx-2,cy]], dir:[1,0], nd:[1,0], food:null, alarm:null, score:0, paused:false, over:false };
    _snFood(); _snAlarm();

    let last=0;
    const spd = () => Math.max(80, 220-_sn.score*4);
    function loop(ts) {
      if (_sn.over) return;
      if (!_sn.paused && ts-last > spd()) { last=ts; _snTick(); }
      _snDraw(canvas);
      _loop = requestAnimationFrame(loop);
      _loopType = 'raf';
    }
    _loop = requestAnimationFrame(loop);
    _loopType = 'raf';
  }

  function _snDir(dx,dy) { if(dx===-_sn.dir[0]&&dy===-_sn.dir[1])return; _sn.nd=[dx,dy]; }
  function _snPause()    { _sn.paused=!_sn.paused; }

  function _snFood() {
    const {W,H,body} = _sn, bs = new Set(body.map(([x,y])=>x+','+y));
    let x,y; do { x=Math.floor(Math.random()*W); y=Math.floor(Math.random()*H); } while(bs.has(x+','+y));
    _sn.food = { x, y, t: _SN_FOOD[Math.floor(Math.random()*_SN_FOOD.length)] };
  }

  function _snAlarm() {
    if (_sn.score < 8) { _sn.alarm=null; return; }
    const {W,H,body,food} = _sn, bs = new Set(body.map(([x,y])=>x+','+y));
    let x,y;
    do { x=Math.floor(Math.random()*W); y=Math.floor(Math.random()*H); }
    while(bs.has(x+','+y)||(food&&x===food.x&&y===food.y));
    _sn.alarm = {x,y};
  }

  function _snTick() {
    _sn.dir = _sn.nd;
    const [hx,hy] = _sn.body[0];
    const nx = (hx + _sn.dir[0] + _sn.W) % _sn.W;
    const ny = (hy + _sn.dir[1] + _sn.H) % _sn.H;
    if (_sn.body.slice(1).some(([x,y])=>x===nx&&y===ny)) { _snOver(); return; }
    if (_sn.alarm && _sn.alarm.x===nx && _sn.alarm.y===ny) { _snOver(); return; }
    _sn.body.unshift([nx,ny]);
    if (_sn.food && nx===_sn.food.x && ny===_sn.food.y) {
      _sn.score += _sn.food.t.p;
      const sc = document.getElementById('mg-sn-s');
      if (sc) sc.textContent = _sn.score;
      _snFood();
      if (_sn.score % 10 === 0) _snAlarm();
    } else { _sn.body.pop(); }
    if (_sn.alarm && Math.random() < 0.25) {
      const dirs=[[0,1],[0,-1],[1,0],[-1,0]], d=dirs[Math.floor(Math.random()*4)];
      _sn.alarm.x=(_sn.alarm.x+d[0]+_sn.W)%_sn.W;
      _sn.alarm.y=(_sn.alarm.y+d[1]+_sn.H)%_sn.H;
    }
  }

  function _snDraw(cv) {
    const ctx=cv.getContext('2d'), {cs,W,H,body,food,alarm,paused}=_sn, cw=cs*W, ch=cs*H;
    ctx.fillStyle='#0D1117'; ctx.fillRect(0,0,cw,ch);
    ctx.fillStyle='rgba(255,255,255,0.025)';
    for(let x=0;x<W;x++) for(let y=0;y<H;y++) ctx.fillRect(x*cs+cs/2-1,y*cs+cs/2-1,2,2);
    body.forEach(([x,y],i) => {
      ctx.fillStyle = i===0?'#00F5D4':`rgba(0,245,212,${Math.max(0.25,1-i*0.04)})`;
      ctx.beginPath(); ctx.roundRect(x*cs+1,y*cs+1,cs-2,cs-2,i===0?6:3); ctx.fill();
    });
    if (food) { ctx.font=`${cs-2}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(food.t.e,food.x*cs+cs/2,food.y*cs+cs/2); }
    if (alarm){ ctx.font=`${cs}px serif`;   ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('🚨',alarm.x*cs+cs/2,alarm.y*cs+cs/2); }
    if (paused){ ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,cw,ch); ctx.fillStyle='#fff'; ctx.font=`bold ${cs+4}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('PAUSE',cw/2,ch/2); }
  }

  async function _snOver() {
    _sn.over=true; _stopLoop(); document.removeEventListener('keydown',_snakeKey);
    const score=_sn.score, best=_best('snake'), isNew=score>best;
    document.getElementById('mg-area').innerHTML = `<div style="text-align:center;padding:32px 16px">
      <div style="font-size:56px;margin-bottom:12px">🐍</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:6px">Game Over !</div>
      <div style="font-size:32px;font-weight:700;color:var(--cyan);margin-bottom:4px">${score} points</div>
      ${isNew?'<div style="color:var(--jour);margin-bottom:8px">🏆 Nouveau record !</div>':`<div style="color:var(--text3);margin-bottom:8px">Record : ${best}</div>`}
      <div id="mg-rwd" style="font-size:14px;color:var(--green);margin-bottom:16px"></div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._snakeInit()"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._back()"><i class="fas fa-home"></i> Accueil</button>
      </div>
    </div>`;
    await _save('snake', score, {});
    const mp = await _awardMp('snake', Math.min(score, 15), `Snake : ${score} points`);
    const el = document.getElementById('mg-rwd');
    if (el && mp>0) el.innerHTML = `<i class="fas fa-coins" style="color:var(--jour)"></i> +${mp} MP gagnés !`;
  }

  // ─────────────────────────────────────────────
  //  STOCK (Tetris-inspired)
  // ─────────────────────────────────────────────
  let _st = {};
  const _ST_PIECES = [[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[0,1,1],[1,1,0]],[[1,1,0],[0,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]]];
  const _ST_COLS   = ['#06B6D4','#FBBF24','#8B5CF6','#10B981','#EF4444','#3B82F6','#F97316'];

  function _stockKey(ev) {
    if (!_st.run || _st.paused) return;
    if (ev.key==='ArrowLeft') { ev.preventDefault(); _stMove(-1); }
    if (ev.key==='ArrowRight'){ ev.preventDefault(); _stMove(1);  }
    if (ev.key==='ArrowDown') { ev.preventDefault(); _stDrop();   }
    if (ev.key==='ArrowUp')   { ev.preventDefault(); _stRot();    }
  }
  function _stockSpaceKey(ev) { if(ev.key===' '){ ev.preventDefault(); if(_st.run) _st.paused=!_st.paused; } }

  function _stockInit() {
    const a = document.getElementById('mg-area');
    if (!a) return;
    const COLS=10, ROWS=20;
    const cs = Math.min(26, Math.floor((Math.min(360,window.innerWidth-80))/COLS));
    const W=cs*COLS, H=cs*ROWS;

    a.innerHTML = `<div style="display:flex;gap:8px;justify-content:center;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;width:${W}px">
          <span style="font-size:12px">Score : <b id="mg-st-s">0</b></span>
          <span style="font-size:12px">Niv : <b id="mg-st-l">1</b></span>
          <span style="font-size:12px">Lignes : <b id="mg-st-n">0</b></span>
        </div>
        <canvas id="mg-canvas" width="${W}" height="${H}" style="display:block;border:1px solid var(--border2);border-radius:4px;touch-action:none"></canvas>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:center">
        <span style="font-size:11px;color:var(--text3)">Suivant</span>
        <canvas id="mg-st-nx" width="${cs*4}" height="${cs*4}" style="border:1px solid var(--border2);border-radius:4px"></canvas>
        <div style="display:grid;grid-template-columns:repeat(3,44px);gap:4px;margin-top:8px">
          <div></div>
          <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._stRot()"><i class="fas fa-rotate"></i></button>
          <div></div>
          <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._stMove(-1)"><i class="fas fa-chevron-left"></i></button>
          <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._stDrop()"><i class="fas fa-chevron-down"></i></button>
          <button class="mg-dpad" ontouchstart="MX.Pages.MiniGames._stMove(1)"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div style="font-size:10px;color:var(--text3);text-align:center;max-width:120px">Flèches clavier ou D-pad · Espace = pause</div>
      </div>
    </div>`;

    document.addEventListener('keydown', _stockKey);
    document.addEventListener('keydown', _stockSpaceKey);

    const cv = document.getElementById('mg-canvas');
    let tx=0,ty=0,tt=0;
    cv.addEventListener('touchstart', e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;tt=Date.now();},{passive:true});
    cv.addEventListener('touchend', e=>{
      const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty, dt=Date.now()-tt;
      if(Math.abs(dx)<12&&Math.abs(dy)<12&&dt<200){_stRot();return;}
      if(Math.abs(dx)>Math.abs(dy)) _stMove(dx>0?1:-1);
      else if(dy>20) _stDrop();
    },{passive:true});

    _stNew(COLS, ROWS, cs);
  }

  function _stNew(C, R, cs) {
    _st = {
      C, R, cs,
      grid: Array.from({length:R},()=>new Array(C).fill(0)),
      gclr: Array.from({length:R},()=>new Array(C).fill(null)),
      p:null, pc:null, px:0, py:0,
      nx:null, nxc:null,
      score:0, lvl:1, lines:0,
      paused:false, run:true, over:false
    };
    _stNext(); _stSpawn();
    let last=0;
    const spd=()=>Math.max(80,600-(_st.lvl-1)*55);
    function loop(ts) {
      if(_st.over) return;
      if(!_st.paused&&ts-last>spd()){last=ts;if(!_stFall())_stLock();}
      _stDraw();
      _loop=requestAnimationFrame(loop); _loopType='raf';
    }
    _loop=requestAnimationFrame(loop); _loopType='raf';
  }

  function _stNext() {
    const i=Math.floor(Math.random()*_ST_PIECES.length);
    _st.nx=_ST_PIECES[i]; _st.nxc=_ST_COLS[i];
  }
  function _stSpawn() {
    _st.p=_st.nx; _st.pc=_st.nxc;
    _st.px=Math.floor((_st.C-_st.p[0].length)/2); _st.py=0;
    _stNext();
    if(!_stOk(_st.p,_st.px,_st.py)) _stOver();
  }
  function _stOk(p,px,py) {
    for(let r=0;r<p.length;r++) for(let c=0;c<p[r].length;c++) {
      if(!p[r][c]) continue;
      const nx=px+c,ny=py+r;
      if(nx<0||nx>=_st.C||ny>=_st.R) return false;
      if(ny>=0&&_st.grid[ny][nx]) return false;
    }
    return true;
  }
  function _stFall() { if(_stOk(_st.p,_st.px,_st.py+1)){_st.py++;return true;} return false; }
  function _stLock() {
    for(let r=0;r<_st.p.length;r++) for(let c=0;c<_st.p[r].length;c++) {
      if(!_st.p[r][c]) continue;
      const ny=_st.py+r,nx=_st.px+c;
      if(ny>=0){_st.grid[ny][nx]=1;_st.gclr[ny][nx]=_st.pc;}
    }
    let cl=0;
    for(let r=_st.R-1;r>=0;r--) {
      if(_st.grid[r].every(v=>v)) {
        _st.grid.splice(r,1); _st.grid.unshift(new Array(_st.C).fill(0));
        _st.gclr.splice(r,1); _st.gclr.unshift(new Array(_st.C).fill(null));
        cl++; r++;
      }
    }
    if(cl){
      _st.score+=[0,100,300,500,800][cl]*_st.lvl||800*_st.lvl;
      _st.lines+=cl; _st.lvl=Math.floor(_st.lines/10)+1;
      const s=document.getElementById('mg-st-s'),l=document.getElementById('mg-st-l'),n=document.getElementById('mg-st-n');
      if(s)s.textContent=_st.score; if(l)l.textContent=_st.lvl; if(n)n.textContent=_st.lines;
    }
    _stSpawn();
  }
  function _stMove(dx) { if(_st.run&&!_st.paused&&_stOk(_st.p,_st.px+dx,_st.py))_st.px+=dx; }
  function _stDrop()   { if(!_st.run||_st.paused)return; while(_stFall()){} _stLock(); }
  function _stRot()    {
    if(!_st.run||_st.paused) return;
    const rot=_st.p[0].map((_,i)=>_st.p.map(r=>r[i]).reverse());
    for(const dx of [0,-1,1,-2,2]) { if(_stOk(rot,_st.px+dx,_st.py)){_st.p=rot;_st.px+=dx;return;} }
  }

  function _stDraw() {
    const cv=document.getElementById('mg-canvas'), nx=document.getElementById('mg-st-nx');
    if(!cv) return;
    const ctx=cv.getContext('2d'), {cs,C,R,grid,gclr,p,pc,px,py,paused}=_st;
    const W=cs*C, H=cs*R;
    ctx.fillStyle='#0D1117'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
    for(let r=0;r<=R;r++){ctx.beginPath();ctx.moveTo(0,r*cs);ctx.lineTo(W,r*cs);ctx.stroke();}
    for(let c=0;c<=C;c++){ctx.beginPath();ctx.moveTo(c*cs,0);ctx.lineTo(c*cs,H);ctx.stroke();}
    for(let r=0;r<R;r++) for(let c=0;c<C;c++) {
      if(!grid[r][c]) continue;
      ctx.fillStyle=gclr[r][c]||'#3B82F6'; ctx.fillRect(c*cs+1,r*cs+1,cs-2,cs-2);
      ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(c*cs+1,r*cs+1,cs-2,3);
    }
    if(p) {
      let gy=py; while(_stOk(p,px,gy+1))gy++;
      for(let r=0;r<p.length;r++) for(let c=0;c<p[r].length;c++) {
        if(!p[r][c]) continue;
        ctx.fillStyle=pc+'33'; ctx.fillRect((px+c)*cs+1,(gy+r)*cs+1,cs-2,cs-2);
      }
      for(let r=0;r<p.length;r++) for(let c=0;c<p[r].length;c++) {
        if(!p[r][c]) continue;
        ctx.fillStyle=pc; ctx.fillRect((px+c)*cs+1,(py+r)*cs+1,cs-2,cs-2);
        ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.fillRect((px+c)*cs+1,(py+r)*cs+1,cs-2,3);
      }
    }
    if(paused){ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff';ctx.font=`bold ${cs+2}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('PAUSE',W/2,H/2);}
    if(nx&&_st.nx) {
      const nc=nx.getContext('2d'),np=_st.nx,npcs=_st.nxc,nw=nx.width,nh=nx.height;
      nc.fillStyle='#0D1117'; nc.fillRect(0,0,nw,nh);
      const ox=Math.floor((4-np[0].length)/2)*cs, oy=Math.floor((4-np.length)/2)*cs;
      for(let r=0;r<np.length;r++) for(let c=0;c<np[r].length;c++) {
        if(!np[r][c]) continue;
        nc.fillStyle=npcs; nc.fillRect(ox+c*cs+1,oy+r*cs+1,cs-2,cs-2);
      }
    }
  }

  async function _stOver() {
    _st.over=true; _st.run=false; _stopLoop();
    document.removeEventListener('keydown',_stockKey);
    document.removeEventListener('keydown',_stockSpaceKey);
    const score=_st.score, best=_best('stock'), isNew=score>best;
    document.getElementById('mg-area').innerHTML = `<div style="text-align:center;padding:32px 16px">
      <div style="font-size:56px;margin-bottom:12px">🏭</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:6px">Dépôt plein !</div>
      <div style="font-size:32px;font-weight:700;color:var(--cyan);margin-bottom:4px">${score} points</div>
      <div style="color:var(--text2);margin-bottom:8px">${_st.lines} lignes · Niveau ${_st.lvl}</div>
      ${isNew?'<div style="color:var(--jour);margin-bottom:8px">🏆 Nouveau record !</div>':`<div style="color:var(--text3);margin-bottom:8px">Record : ${best}</div>`}
      <div id="mg-rwd" style="font-size:14px;color:var(--green);margin-bottom:16px"></div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <button class="primary-btn" style="width:auto" onclick="MX.Pages.MiniGames._stockInit()"><i class="fas fa-rotate"></i> Rejouer</button>
        <button class="primary-btn" style="width:auto;background:none;border-color:var(--border2);color:var(--text2)" onclick="MX.Pages.MiniGames._back()"><i class="fas fa-home"></i> Accueil</button>
      </div>
    </div>`;
    await _save('stock', score, { lines: _st.lines, level: _st.lvl });
    const mp = await _awardMp('stock', Math.min(Math.floor(score/100), 20), `Gestion du Stock : ${score} pts`);
    const el = document.getElementById('mg-rwd');
    if (el && mp>0) el.innerHTML = `<i class="fas fa-coins" style="color:var(--jour)"></i> +${mp} MP gagnés !`;
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
    // Puzzle
    _pzInit, _pzStart, _pzTap,
    // Memory
    _memInit, _memStart, _memTap,
    // Quiz
    _quizInit, _quizAns,
    // Snake
    _snakeInit, _snDir, _snPause,
    // Stock
    _stockInit, _stMove, _stRot, _stDrop,
    // Admin
    _qModal, _qDel, _resetScores
  };
})();
