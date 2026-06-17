(function () {
  function taskRow({ task, dayId, slot, isChecked, assigneeName, canToggle }) {
    const { esc, avatarBg, avatarFg } = MX;
    const click = canToggle !== false
      ? `onclick="MX.Pages.Checklist.toggle('${esc(dayId)}','${esc(slot)}','${esc(task.id)}')"` : '';
    return `<div class="trow ${isChecked ? 'done' : ''}" id="tr_${esc(task.id)}" ${click}>
      <div class="tcb ${isChecked ? 'on' : ''}"><i class="fas fa-check"></i></div>
      <span class="ttext">${esc(task.text)}</span>
      ${assigneeName
        ? `<span class="twho" style="background:${avatarBg(assigneeName)};color:${avatarFg(assigneeName)}">${esc(assigneeName)}</span>`
        : ''}
    </div>`;
  }

  window.MX = window.MX || {};
  window.MX.Widgets = window.MX.Widgets || {};
  window.MX.Widgets.taskRow = taskRow;
})();
