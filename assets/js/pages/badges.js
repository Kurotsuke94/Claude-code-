(function () {
  'use strict';

  const MODE_L = { manual: 'Manuel', auto: 'Automatique', role: 'Par rôle' };
  const MODE_C = { manual: 'var(--cyan)', auto: 'var(--green)', role: 'var(--orange)' };

  function render() {
    const el      = document.getElementById('main-content');
    const { state, esc, avatarBg, avatarFg, Auth } = MX;
    const canAll  = Auth.canSeeAll();
    const cu      = state.currentUser;
    const badges  = state.badges     || [];
    const ubMap   = state.userBadges || {};
    const users   = state.users      || [];

    // Current viewer's name
    const viewerName = cu
      ? cu.name
      : (state.adminUser ? (state.adminUser.email||'').split('@')[0] : null);

    const myBadges = viewerName ? (ubMap[viewerName] || []) : [];

    let h = `<div class="ph">
      <div class="ph-eye">BADGES</div>
      <div class="ph-title">Badges Professionnels</div>
      <div class="ph-sub">Reconnaissances et expertises de l'équipe</div>
    </div>
    <div class="page-body">`;

    // ── Mes badges ──
    if (myBadges.length) {
      h += `<div class="section-label" style="margin-bottom:10px">Mes badges (${myBadges.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px">`;
      myBadges.forEach(ub => {
        const badge = badges.find(b => b.id === ub.badgeId);
        if (!badge || !badge.active) return;
        h += _badgeChip(badge, esc);
      });
      h += `</div>`;
    } else if (viewerName) {
      h += `<div style="padding:16px;background:var(--bg3);border:1px solid var(--border);border-radius:12px;margin-bottom:20px;text-align:center;color:var(--text3);font-size:13px">
        <i class="fas fa-medal" style="font-size:24px;margin-bottom:8px;display:block;opacity:0.3"></i>
        Aucun badge attribué pour l'instant
      </div>`;
    }

    // ── Tous les badges (catalogue) ──
    const activeBadges = badges.filter(b => b.active);
    if (activeBadges.length) {
      h += `<div class="section-label" style="margin-bottom:10px">Catalogue des badges (${activeBadges.length})</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">`;
      activeBadges.forEach(b => {
        const holders = Object.entries(ubMap)
          .filter(([, ubs]) => ubs.some(ub => ub.badgeId === b.id))
          .map(([name]) => name);
        h += `<div class="apcard">
          <div class="aphd" style="padding:12px 14px;gap:10px">
            <div style="width:44px;height:44px;border-radius:14px;background:${b.color}22;border:2px solid ${b.border||b.color};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${esc(b.icon||'🏅')}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-size:14px;font-weight:700">${esc(b.name)}</span>
                <span style="font-size:10px;padding:1px 7px;border-radius:6px;background:${MODE_C[b.mode]||'var(--cyan)'}22;color:${MODE_C[b.mode]||'var(--cyan)'};border:1px solid ${MODE_C[b.mode]||'var(--cyan)'}44">${MODE_L[b.mode]||b.mode}</span>
              </div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(b.desc||'')}</div>
              ${holders.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
                ${holders.map(n => {
                  const bg = avatarBg(n);
                  const fg = avatarFg(n);
                  const init = (n||'?').slice(0,2).toUpperCase();
                  return `<span title="${esc(n)}" style="width:26px;height:26px;border-radius:8px;background:${bg};color:${fg};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid ${b.border||b.color}">${esc(init)}</span>`;
                }).join('')}
                <span style="font-size:11px;color:var(--text3);align-self:center;margin-left:4px">${holders.length} détenteur${holders.length!==1?'s':''}</span>
              </div>` : `<div style="font-size:11px;color:var(--text3);margin-top:6px">Aucun détenteur</div>`}
            </div>
          </div>
        </div>`;
      });
      h += `</div>`;
    }

    // ── Classement par badges ──
    if (canAll && users.length) {
      h += `<div class="section-label" style="margin-bottom:10px">Équipe</div>
      <div style="display:flex;flex-direction:column;gap:8px">`;
      users.forEach(u => {
        const ubs = ubMap[u.name] || [];
        const userBadgesList = ubs.map(ub => badges.find(b => b.id === ub.badgeId)).filter(Boolean).filter(b => b.active);
        const bg   = avatarBg(u.name);
        const fg   = avatarFg(u.name);
        const init = (u.name||'?').slice(0,2).toUpperCase();
        const border = MX.badgeBorder ? MX.badgeBorder(u.name) : null;
        h += `<div class="apcard" style="padding:12px 14px">
          <div class="aphd" style="gap:10px">
            <div style="width:38px;height:38px;border-radius:10px;background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0${border?';border:2px solid '+border:''}">${esc(init)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700">${esc(u.name)}</div>
              <div style="font-size:11px;color:var(--text2)">${esc(u.role||'technicien')}</div>
              ${userBadgesList.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
                ${userBadgesList.slice(0, 6).map(b => _badgeChip(b, esc, true)).join('')}
                ${userBadgesList.length > 6 ? `<span style="font-size:11px;color:var(--text3);align-self:center">+${userBadgesList.length-6}</span>` : ''}
              </div>` : `<div style="font-size:11px;color:var(--text3);margin-top:4px">Aucun badge</div>`}
            </div>
          </div>
        </div>`;
      });
      h += `</div>`;
    }

    h += `</div>`;
    el.innerHTML = h;
  }

  function _badgeChip(b, esc, small) {
    const size = small ? '18px' : '22px';
    const pad  = small ? '3px 8px' : '4px 12px';
    return `<div title="${esc(b.name)}" style="display:inline-flex;align-items:center;gap:5px;padding:${pad};border-radius:${small?'8px':'10px'};background:${b.color}22;border:1.5px solid ${b.border||b.color}">
      <span style="font-size:${size}">${esc(b.icon||'🏅')}</span>
      ${!small ? `<span style="font-size:12px;font-weight:600;color:${b.color}">${esc(b.name)}</span>` : ''}
    </div>`;
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.Badges = { render };
})();
