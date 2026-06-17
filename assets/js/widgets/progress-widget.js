(function () {
  function progressWidget({ done, total, label, showBar }) {
    showBar = showBar !== false;
    const pct   = total ? Math.round(done / total * 100) : 0;
    const color = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)';
    return `<div class="prog-widget">
      ${label ? `<div style="font-size:11px;color:var(--text2);margin-bottom:3px;font-family:var(--ffm)">${MX.esc(label)}</div>` : ''}
      ${showBar ? `<div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>` : ''}
      <div style="font-size:11px;color:${color};font-family:var(--ffm);font-weight:700;margin-top:3px">${done}/${total} · ${pct}%</div>
    </div>`;
  }

  window.MX = window.MX || {};
  window.MX.Widgets = window.MX.Widgets || {};
  window.MX.Widgets.progressWidget = progressWidget;
})();
