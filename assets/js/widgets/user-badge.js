(function () {
  function userBadge(name, opts) {
    opts = opts || {};
    const { esc, avatarBg, avatarFg, avatarTxt, TEAM_COLORS } = MX;
    const nc  = TEAM_COLORS[name] || { bg: avatarBg(name), fg: avatarFg(name) };
    const sz  = opts.size || 34;
    const rx  = Math.round(sz / 3.5);
    const fsz = Math.round(sz * 0.36);
    return `<span class="user-badge-wrap" style="display:inline-flex;align-items:center;gap:7px;vertical-align:middle">
      <span style="width:${sz}px;height:${sz}px;border-radius:${rx}px;background:${nc.bg};color:${nc.fg};display:inline-flex;align-items:center;justify-content:center;font-size:${fsz}px;font-weight:700;font-family:var(--ffm);flex-shrink:0">${esc(avatarTxt(name))}</span>
      ${opts.showName !== false ? `<span style="font-size:13px;font-weight:600">${esc(name)}</span>` : ''}
    </span>`;
  }

  window.MX = window.MX || {};
  window.MX.Widgets = window.MX.Widgets || {};
  window.MX.Widgets.userBadge = userBadge;
})();
