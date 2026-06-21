(function () {
  'use strict';

  // ── CONSTANTS ──

  const DEF_SHIFTS = [
    { code:'1',   name:'Matin',     color:'#FDE047', textColor:'#1a1a1a', start:'08:00', end:'16:33', bold:false, order:0 },
    { code:'2',   name:'Journée',   color:'#9CA3AF', textColor:'#1a1a1a', start:'09:00', end:'17:33', bold:false, order:1 },
    { code:'3',   name:'Ap-Midi',   color:'#3B82F6', textColor:'#ffffff', start:'10:00', end:'18:33', bold:false, order:2 },
    { code:'4',   name:'Soir',      color:'#EF4444', textColor:'#ffffff', start:'13:00', end:'21:33', bold:false, order:3 },
    { code:'RH',  name:'Repos',     color:'#22C55E', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:4 },
    { code:'CP',  name:'Congé',     color:'#F97316', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:5 },
    { code:'JFL', name:'J.Férié',   color:'#F97316', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:6 },
    { code:'EXT', name:'Extérieur', color:'#FFFFFF', textColor:'#1a1a1a', start:'',      end:'',      bold:true,  order:7 },
  ];

  const DAY_LABELS  = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  // ── STATE ──

  let _view        = 'month';
  let _year        = new Date().getFullYear();
  let _month       = new Date().getMonth();
  let _day         = new Date().toISOString().slice(0, 10);
  let _filterUser  = '';
  let _filterShift = '';
  let _clipboard   = null;
  let _loading     = false;

  // Selection state
  let _selected             = new Set();  // 'userId_YYYY-MM-DD'
  let _shiftAnchor          = null;
  let _mouseDown            = false;
  let _dragRect             = null;       // {startUid, startDate, endUid, endDate}
  let _tableMouseUpHandler  = null;

  // ── HELPERS ──

  function _shifts() {
    const s = MX.state.planningShifts;
    return (s && s.length) ? s : DEF_SHIFTS;
  }

  function _shiftByCode(code) {
    return _shifts().find(s => s.code === code) || null;
  }

  function _entries() { return MX.state.planningEntries || {}; }

  function _entry(userId, dateStr) {
    return _entries()[userId + '_' + dateStr] || null;
  }

  function _users() {
    return (MX.state.users || []).filter(u => u.name && u.role !== 'admin' && !u.hidden);
  }

  function _visibleUsers() {
    const all = _users();
    return _filterUser ? all.filter(u => u.id === _filterUser) : all;
  }

  function _canEdit() { return MX.Auth.canSeeAll(); }

  function _isWeekend(dateStr) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return dow === 0 || dow === 6;
  }

  function _todayStr() { return new Date().toISOString().slice(0, 10); }

  function _pad(n) { return String(n).padStart(2, '0'); }

  function _dateStr(y, m, d) { return y + '-' + _pad(m + 1) + '-' + _pad(d); }

  function _daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  function _weekStart(dateStr) {
    const d   = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const diff = (dow === 0) ? -6 : 1 - dow;
    return new Date(d.getTime() + diff * 86400000).toISOString().slice(0, 10);
  }

  function _addDays(dateStr, n) {
    return new Date(new Date(dateStr + 'T00:00:00').getTime() + n * 86400000).toISOString().slice(0, 10);
  }

  function _weekDays(baseDate) {
    const mon = _weekStart(baseDate);
    return Array.from({ length: 7 }, (_, i) => _addDays(mon, i));
  }

  function _fmtMonthTitle() { return MONTH_NAMES[_month] + ' ' + _year; }

  function _fmtWeekTitle() {
    const days = _weekDays(_day);
    const d0   = new Date(days[0] + 'T00:00:00');
    const d6   = new Date(days[6] + 'T00:00:00');
    const m0   = MONTH_NAMES[d0.getMonth()].slice(0, 3);
    const m6   = MONTH_NAMES[d6.getMonth()].slice(0, 3);
    if (d0.getMonth() === d6.getMonth())
      return d0.getDate() + '–' + d6.getDate() + ' ' + m0 + ' ' + d0.getFullYear();
    return d0.getDate() + ' ' + m0 + ' – ' + d6.getDate() + ' ' + m6 + ' ' + d6.getFullYear();
  }

  function _fmtDayTitle() {
    const d = new Date(_day + 'T00:00:00');
    return DAY_LABELS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ── NAVIGATION ──

  function _prev() {
    if (_view === 'month') { _month--; if (_month < 0) { _month = 11; _year--; } }
    else if (_view === 'week') { _day = _addDays(_weekStart(_day), -7); }
    else { _day = _addDays(_day, -1); }
    _loadAndRender();
  }

  function _next() {
    if (_view === 'month') { _month++; if (_month > 11) { _month = 0; _year++; } }
    else if (_view === 'week') { _day = _addDays(_weekStart(_day), 7); }
    else { _day = _addDays(_day, 1); }
    _loadAndRender();
  }

  function _today() {
    const now = new Date();
    _year = now.getFullYear(); _month = now.getMonth();
    _day  = now.toISOString().slice(0, 10);
    _loadAndRender();
  }

  function _setView(v) { _view = v; _selected.clear(); _loadAndRender(); }

  // ── DATA LOADING ──

  async function _loadAndRender() {
    if (_loading) return;
    _loading = true;
    try {
      if (_view === 'week') {
        const days = _weekDays(_day);
        const d0   = new Date(days[0] + 'T00:00:00');
        const d6   = new Date(days[6] + 'T00:00:00');
        const p1   = MX.DB.loadPlanningMonth(d0.getFullYear(), d0.getMonth());
        if (d0.getMonth() !== d6.getMonth()) {
          const [m1, m2] = await Promise.all([p1, MX.DB.loadPlanningMonth(d6.getFullYear(), d6.getMonth())]);
          MX.state.planningEntries = Object.assign({}, m1, m2);
        } else {
          MX.state.planningEntries = await p1;
        }
      } else if (_view === 'day') {
        const d = new Date(_day + 'T00:00:00');
        MX.state.planningEntries = await MX.DB.loadPlanningMonth(d.getFullYear(), d.getMonth());
      } else {
        MX.state.planningEntries = await MX.DB.loadPlanningMonth(_year, _month);
      }
    } catch (e) {
      MX.toast('Erreur chargement planning', true);
    } finally {
      _loading = false;
    }
    render();
  }

  // ── SELECTION SYSTEM ──

  function _keyToUserDate(key) {
    const dateStr = key.slice(-10);
    const userId  = key.slice(0, -11);
    return { userId, dateStr };
  }

  function _cellMouseDown(e, uid, date) {
    if (!_canEdit()) return;
    e.preventDefault();

    const key = uid + '_' + date;

    if (e.ctrlKey || e.metaKey) {
      if (_selected.has(key)) _selected.delete(key);
      else _selected.add(key);
      _shiftAnchor = key;
    } else if (e.shiftKey && _shiftAnchor) {
      _selectRectangle(_shiftAnchor, uid, date);
    } else {
      _selected.clear();
      _selected.add(key);
      _shiftAnchor = key;
      _mouseDown   = true;
      _dragRect    = { startUid: uid, startDate: date, endUid: uid, endDate: date };
    }

    _updateSelectionHighlight();
  }

  function _selectRectangle(anchorKey, endUid, endDate) {
    const { userId: aUid, dateStr: aDate } = _keyToUserDate(anchorKey);
    const users    = _visibleUsers();
    const aIdx     = users.findIndex(u => u.id === aUid);
    const eIdx     = users.findIndex(u => u.id === endUid);
    const minRow   = Math.min(aIdx < 0 ? 0 : aIdx, eIdx < 0 ? 0 : eIdx);
    const maxRow   = Math.max(aIdx < 0 ? 0 : aIdx, eIdx < 0 ? 0 : eIdx);
    const minDate  = aDate < endDate ? aDate : endDate;
    const maxDate  = aDate < endDate ? endDate : aDate;

    _selected.clear();

    const viewDays = _view === 'week' ? _weekDays(_day)
      : Array.from({ length: _daysInMonth(_year, _month) }, (_, i) => _dateStr(_year, _month, i + 1));

    for (let r = minRow; r <= maxRow; r++) {
      const u = users[r];
      if (!u) continue;
      viewDays.forEach(ds => {
        if (ds >= minDate && ds <= maxDate) _selected.add(u.id + '_' + ds);
      });
    }
  }

  function _applyDragRect() {
    if (!_dragRect) return;
    const { startUid, startDate, endUid, endDate } = _dragRect;
    const users   = _visibleUsers();
    const idx1    = Math.max(0, users.findIndex(u => u.id === startUid));
    const idx2    = Math.max(0, users.findIndex(u => u.id === endUid));
    const minRow  = Math.min(idx1, idx2);
    const maxRow  = Math.max(idx1, idx2);
    const minDate = startDate < endDate ? startDate : endDate;
    const maxDate = startDate < endDate ? endDate : startDate;

    _selected.clear();

    const viewDays = _view === 'week' ? _weekDays(_day)
      : Array.from({ length: _daysInMonth(_year, _month) }, (_, i) => _dateStr(_year, _month, i + 1));

    for (let r = minRow; r <= maxRow; r++) {
      const u = users[r];
      if (!u) continue;
      viewDays.forEach(ds => {
        if (ds >= minDate && ds <= maxDate) _selected.add(u.id + '_' + ds);
      });
    }

    _updateSelectionHighlight();
  }

  function _updateSelectionHighlight() {
    document.querySelectorAll('.plng-cell[data-uid][data-date]').forEach(td => {
      if (_selected.has(td.dataset.uid + '_' + td.dataset.date)) td.classList.add('plng-sel');
      else td.classList.remove('plng-sel');
    });

    const counter = document.getElementById('plng-sel-count');
    if (!counter) return;
    const n = _selected.size;
    counter.textContent = n ? n + ' case' + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : '') : '';
    counter.style.display = n ? 'inline-flex' : 'none';
  }

  function _clearSelection() {
    _selected.clear();
    _shiftAnchor = null;
    _updateSelectionHighlight();
  }

  // Attach drag-to-select on the rendered table
  function _attachTableEvents() {
    const wrap = document.querySelector('.plng-month-wrap');
    if (!wrap || !_canEdit()) return;

    wrap.addEventListener('mouseover', e => {
      if (!_mouseDown || !_dragRect) return;
      const td = e.target.closest('.plng-cell[data-uid][data-date]');
      if (!td) return;
      _dragRect.endUid  = td.dataset.uid;
      _dragRect.endDate = td.dataset.date;
      _applyDragRect();
    });

    if (_tableMouseUpHandler) document.removeEventListener('mouseup', _tableMouseUpHandler);
    _tableMouseUpHandler = () => { _mouseDown = false; _dragRect = null; };
    document.addEventListener('mouseup', _tableMouseUpHandler);
  }

  // ── BATCH APPLY ──

  async function _applyCodeToSelected(shiftCode) {
    if (!_selected.size) return MX.toast('Sélectionnez des cases d\'abord', true);
    if (!_canEdit()) return;

    const pairs    = Array.from(_selected).map(k => _keyToUserDate(k));
    const allUsers = _users();

    try {
      await Promise.all(pairs.map(({ userId, dateStr }) =>
        MX.DB.setPlanningEntry(userId, dateStr, shiftCode)));

      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      pairs.forEach(({ userId, dateStr }) => {
        const u  = allUsers.find(u => u.id === userId);
        const d  = new Date(dateStr + 'T00:00:00');
        const ym = d.getFullYear() + '-' + _pad(d.getMonth() + 1);
        MX.state.planningEntries[userId + '_' + dateStr] =
          { userId, userName: u ? u.name : '', date: dateStr, shiftCode, ym };
      });

      const n = pairs.length;
      MX.toast(shiftCode + ' appliqué (' + n + ' case' + (n > 1 ? 's' : '') + ')');
      _selected.clear();
      render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  async function _clearCodeFromSelected() {
    if (!_selected.size) return MX.toast('Sélectionnez des cases d\'abord', true);
    if (!_canEdit()) return;

    const pairs = Array.from(_selected).map(k => _keyToUserDate(k));

    try {
      await Promise.all(pairs.map(({ userId, dateStr }) =>
        MX.DB.deletePlanningEntry(userId, dateStr)));

      if (MX.state.planningEntries) {
        pairs.forEach(({ userId, dateStr }) =>
          delete MX.state.planningEntries[userId + '_' + dateStr]);
      }

      const n = pairs.length;
      MX.toast('Effacé (' + n + ' case' + (n > 1 ? 's' : '') + ')');
      _selected.clear();
      render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  // ── AVATAR ──

  function _avatar(user, size) {
    const sz = size || 26;
    const c  = MX.userColors(user.name);
    const ltr = (user.name || '?')[0].toUpperCase();
    return `<span class="plng-user-avatar" style="width:${sz}px;height:${sz}px;min-width:${sz}px;background:${c.bg};color:${c.fg};font-size:${Math.round(sz * 0.42)}px">${MX.esc(ltr)}</span>`;
  }

  // ── QUICK BAR (shift assignment strip) ──

  function _renderQuickBar(shifts) {
    const n = _selected.size;
    return `<div class="plng-quick-bar">
      <span class="plng-sel-count" id="plng-sel-count" style="display:${n ? 'inline-flex' : 'none'}">${n} case${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}</span>
      <div class="plng-quick-shifts">
        ${shifts.map(s => {
          const border = s.color === '#FFFFFF' ? '1px solid rgba(255,255,255,0.3)' : 'none';
          return `<button class="plng-qshift" style="background:${s.color};color:${s.textColor};outline:${border}"
            onmousedown="event.preventDefault()" onclick="MX.Pages.Planning._applyCodeToSelected('${MX.esc(s.code)}')"
            title="${MX.esc(s.name)}${s.start ? ' · ' + s.start + '–' + s.end : ''}">
            <span class="plng-qshift-code" style="font-weight:${s.bold ? 700 : 600}">${MX.esc(s.code)}</span>
            ${s.start ? `<span class="plng-qshift-time">${s.start.replace(':','h')}–${s.end.replace(':','h')}</span>` : ''}
          </button>`;
        }).join('')}
        <button class="plng-qshift plng-qshift-erase" onmousedown="event.preventDefault()" onclick="MX.Pages.Planning._clearCodeFromSelected()" title="Effacer la sélection">
          <span class="plng-qshift-code"><i class="fas fa-eraser"></i></span>
        </button>
      </div>
      <button class="plng-sel-clear" onmousedown="event.preventDefault()" onclick="MX.Pages.Planning._clearSelection()" title="Désélectionner tout">
        <i class="fas fa-times"></i>
      </button>
    </div>`;
  }

  // ── MONTH TABLE ──

  function _renderMonthTable(users, today, canEdit) {
    const days    = _daysInMonth(_year, _month);
    const esc     = MX.esc;
    const entries = _entries();
    const shifts  = _shifts();
    const visible = _filterUser ? users.filter(u => u.id === _filterUser) : users;

    let h = `<div class="plng-month-wrap"><table class="plng-month-tbl"><thead><tr>
      <th class="plng-user-col-hd">Agent</th>`;

    for (let d = 1; d <= days; d++) {
      const ds  = _dateStr(_year, _month, d);
      const dow = new Date(ds + 'T00:00:00').getDay();
      const isWE    = dow === 0 || dow === 6;
      const isToday = ds === today;
      h += `<th class="plng-th-day${isWE ? ' plng-we' : ''}${isToday ? ' plng-today' : ''}" data-date="${ds}">
        <div class="plng-th-dow">${DAY_LABELS[dow]}</div>
        <div class="plng-th-num">${d}</div>
      </th>`;
    }

    h += `</tr></thead><tbody>`;

    visible.forEach(user => {
      if (_filterShift) {
        let has = false;
        for (let d = 1; d <= days; d++) {
          const e = entries[user.id + '_' + _dateStr(_year, _month, d)];
          if (e && e.shiftCode === _filterShift) { has = true; break; }
        }
        if (!has) return;
      }

      h += `<tr class="plng-user-row" data-uid="${esc(user.id)}">
        <td class="plng-user-cell">
          ${_avatar(user, 26)}
          <span class="plng-user-name">${esc(user.name)}</span>
          ${canEdit ? `<span class="plng-user-actions">
            <button class="plng-user-btn" title="Copier le mois" onclick="MX.Pages.Planning._copyMonth('${esc(user.id)}')"><i class="fas fa-copy"></i></button>
            <button class="plng-user-btn" title="Coller le mois" onclick="MX.Pages.Planning._pasteMonth('${esc(user.id)}')"><i class="fas fa-paste"></i></button>
          </span>` : ''}
        </td>`;

      for (let d = 1; d <= days; d++) {
        const ds      = _dateStr(_year, _month, d);
        const dow     = new Date(ds + 'T00:00:00').getDay();
        const isWE    = dow === 0 || dow === 6;
        const isToday = ds === today;
        const entry   = entries[user.id + '_' + ds];
        const shift   = entry ? _shiftByCode(entry.shiftCode) : null;
        const selKey  = user.id + '_' + ds;
        const isSel   = _selected.has(selKey);
        const isDim   = _filterShift && entry && entry.shiftCode !== _filterShift;

        const cellClass = 'plng-cell'
          + (isWE    ? ' plng-we'     : '')
          + (isToday ? ' plng-today'  : '')
          + (isSel   ? ' plng-sel'    : '')
          + (isDim   ? ' plng-dimmed' : '');

        h += `<td class="${cellClass}" data-uid="${esc(user.id)}" data-date="${ds}"
          ${canEdit ? `onmousedown="MX.Pages.Planning._cellMouseDown(event,'${esc(user.id)}','${ds}')"` : ''}>`;

        if (shift) {
          const needBorder = shift.color === '#FFFFFF';
          h += `<div class="plng-cell-in" style="background:${shift.color};color:${shift.textColor}${needBorder ? ';border:1px solid rgba(0,0,0,0.15)' : ''}">
            <span class="plng-cell-code" style="font-weight:${shift.bold ? 700 : 600}">${esc(shift.code)}</span>
          </div>`;
        } else {
          h += `<div class="plng-cell-in plng-cell-empty-in"></div>`;
        }

        h += `</td>`;
      }

      h += `</tr>`;
    });

    h += `</tbody></table></div>`;
    return h;
  }

  // ── WEEK TABLE ──

  function _renderWeekTable(users, today, canEdit) {
    const days    = _weekDays(_day);
    const esc     = MX.esc;
    const entries = _entries();
    const visible = _filterUser ? users.filter(u => u.id === _filterUser) : users;

    let h = `<div class="plng-month-wrap"><table class="plng-month-tbl"><thead><tr>
      <th class="plng-user-col-hd">Agent</th>`;

    days.forEach(ds => {
      const d   = new Date(ds + 'T00:00:00');
      const dow = d.getDay();
      const isWE    = dow === 0 || dow === 6;
      const isToday = ds === today;
      h += `<th class="plng-th-day plng-th-week${isWE ? ' plng-we' : ''}${isToday ? ' plng-today' : ''}">
        <div class="plng-th-dow">${DAY_LABELS[dow]}</div>
        <div class="plng-th-num">${d.getDate()}</div>
        <div class="plng-th-mo">${MONTH_NAMES[d.getMonth()].slice(0, 3)}</div>
      </th>`;
    });

    h += `</tr></thead><tbody>`;

    visible.forEach(user => {
      if (_filterShift) {
        const has = days.some(ds => {
          const e = entries[user.id + '_' + ds];
          return e && e.shiftCode === _filterShift;
        });
        if (!has) return;
      }

      h += `<tr class="plng-user-row" data-uid="${esc(user.id)}">
        <td class="plng-user-cell">
          ${_avatar(user, 26)}
          <span class="plng-user-name">${esc(user.name)}</span>
          ${canEdit ? `<span class="plng-user-actions">
            <button class="plng-user-btn" title="Copier la semaine" onclick="MX.Pages.Planning._copyWeek('${esc(user.id)}')"><i class="fas fa-copy"></i></button>
            <button class="plng-user-btn" title="Coller la semaine" onclick="MX.Pages.Planning._pasteWeek('${esc(user.id)}')"><i class="fas fa-paste"></i></button>
          </span>` : ''}
        </td>`;

      days.forEach(ds => {
        const dow     = new Date(ds + 'T00:00:00').getDay();
        const isWE    = dow === 0 || dow === 6;
        const isToday = ds === today;
        const entry   = entries[user.id + '_' + ds];
        const shift   = entry ? _shiftByCode(entry.shiftCode) : null;
        const selKey  = user.id + '_' + ds;
        const isSel   = _selected.has(selKey);
        const isDim   = _filterShift && entry && entry.shiftCode !== _filterShift;

        const cellClass = 'plng-cell plng-cell-week'
          + (isWE    ? ' plng-we'     : '')
          + (isToday ? ' plng-today'  : '')
          + (isSel   ? ' plng-sel'    : '')
          + (isDim   ? ' plng-dimmed' : '');

        h += `<td class="${cellClass}" data-uid="${esc(user.id)}" data-date="${ds}"
          ${canEdit ? `onmousedown="MX.Pages.Planning._cellMouseDown(event,'${esc(user.id)}','${ds}')"` : ''}>`;

        if (shift) {
          const needBorder = shift.color === '#FFFFFF';
          h += `<div class="plng-cell-in plng-cell-in-week" style="background:${shift.color};color:${shift.textColor}${needBorder ? ';border:1px solid rgba(0,0,0,0.15)' : ''}">
            <span class="plng-cell-code" style="font-weight:${shift.bold ? 700 : 600}">${esc(shift.code)}</span>
            ${shift.start ? `<span class="plng-cell-time">${shift.start}–${shift.end}</span>` : ''}
          </div>`;
        } else {
          h += `<div class="plng-cell-in plng-cell-in-week plng-cell-empty-in"></div>`;
        }

        h += `</td>`;
      });

      h += `</tr>`;
    });

    h += `</tbody></table></div>`;
    return h;
  }

  // ── DAY LIST ──

  function _renderDayList(users, today, canEdit) {
    const esc     = MX.esc;
    const entries = _entries();
    const visible = _filterUser ? users.filter(u => u.id === _filterUser) : users;

    let h = `<div class="plng-day-wrap">`;

    visible.forEach(user => {
      const entry = entries[user.id + '_' + _day];
      const shift = entry ? _shiftByCode(entry.shiftCode) : null;
      if (_filterShift && entry && entry.shiftCode !== _filterShift) return;

      h += `<div class="plng-day-row${canEdit ? ' plng-day-row-edit' : ''}"
        ${canEdit ? `onclick="MX.Pages.Planning._openShiftPicker('${esc(user.id)}','${esc(user.name)}','${_day}')"` : ''}>
        <div class="plng-day-user">${_avatar(user, 36)}<span class="plng-user-name">${esc(user.name)}</span></div>
        <div class="plng-day-shift">`;

      if (shift) {
        const nb = shift.color === '#FFFFFF';
        h += `<span style="display:inline-flex;align-items:center;gap:10px;background:${shift.color};color:${shift.textColor};padding:6px 14px;border-radius:8px;font-weight:${shift.bold?700:600}${nb?';border:1px solid rgba(0,0,0,0.15)':''}">
          <span style="font-size:14px;font-family:var(--ffm)">${esc(shift.code)}</span>
          <span>
            <div style="font-size:12px;font-weight:600">${esc(shift.name)}</div>
            ${shift.start ? `<div style="font-size:10px;opacity:0.8">${shift.start} – ${shift.end}</div>` : ''}
          </span>
        </span>`;
      } else {
        h += `<span class="plng-no-shift">${canEdit ? '<i class="fas fa-plus"></i> Assigner' : '—'}</span>`;
      }

      h += `</div></div>`;
    });

    if (!visible.length) h += `<div class="plng-empty"><i class="fas fa-users" style="font-size:24px"></i><span>Aucun agent</span></div>`;

    h += `</div>`;
    return h;
  }

  // ── SIDEBAR (légende + actions) ──

  function _renderSidebar(canEdit, isAdmin) {
    const shifts = _shifts();
    let h = `<div class="plng-legend">
      <div class="plng-legend-title">Légende</div>`;

    shifts.forEach(s => {
      const nb = s.color === '#FFFFFF';
      h += `<div class="plng-legend-row">
        <span class="plng-legend-chip" style="background:${s.color};color:${s.textColor};font-weight:${s.bold ? 700 : 600}${nb ? ';border:1px solid var(--border2)' : ''}">${MX.esc(s.code)}</span>
        <div class="plng-legend-info">
          <span class="plng-legend-name">${MX.esc(s.name)}</span>
          ${s.start ? `<span class="plng-legend-time">${s.start} – ${s.end}</span>` : ''}
        </div>
      </div>`;
    });

    if (isAdmin) {
      h += `<button class="plng-legend-btn" onclick="MX.Pages.Planning._openShiftMgmt()">
        <i class="fas fa-pen"></i> Gérer les codes
      </button>`;
    }

    if (canEdit) {
      h += `<div class="plng-legend-sep"></div>
        <div class="plng-legend-title">Actions rapides</div>
        <button class="plng-qa-btn" onclick="MX.Pages.Planning._openRangeApply('RH')"><i class="fas fa-moon"></i> Absence / Repos</button>
        <button class="plng-qa-btn" onclick="MX.Pages.Planning._openRangeApply('CP')"><i class="fas fa-plane-departure"></i> Congé payé</button>
        <button class="plng-qa-btn" onclick="MX.Pages.Planning._openRangeApply('JFL')"><i class="fas fa-star"></i> Jour férié</button>
        <button class="plng-qa-btn" onclick="MX.Pages.Planning._openAutoGenModal()"><i class="fas fa-wand-magic-sparkles"></i> Horaire récurrent</button>
        <div class="plng-legend-sep"></div>
        <button class="plng-qa-btn plng-qa-export" onclick="MX.Pages.Planning._exportCsv()"><i class="fas fa-file-excel"></i> Export Excel</button>
        <button class="plng-qa-btn plng-qa-export" onclick="window.print()"><i class="fas fa-file-pdf"></i> Export PDF</button>
        <button class="plng-qa-btn plng-qa-export" onclick="window.print()"><i class="fas fa-print"></i> Imprimer</button>`;
    }

    h += `</div>`;
    return h;
  }

  // ── SHIFT PICKER MODAL (day view) ──

  function _openShiftPicker(userId, userName, dateStr) {
    const shifts  = _shifts();
    const entry   = _entry(userId, dateStr);
    const current = entry ? entry.shiftCode : null;
    const esc     = MX.esc;
    const d       = new Date(dateStr + 'T00:00:00');
    const lbl     = DAY_LABELS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];

    MX.showModal('Assigner un poste', esc(userName) + ' — ' + esc(lbl), []);

    const body = document.getElementById('m-body') || document.getElementById('m-sub');
    if (body) {
      let bh = `<div class="plng-picker-grid">`;
      shifts.forEach(s => {
        const active = s.code === current;
        const nb     = s.color === '#FFFFFF';
        bh += `<button class="plng-picker-btn${active ? ' plng-picker-active' : ''}"
          style="background:${s.color};color:${s.textColor};border:2px solid ${active ? '#00F5D4' : 'transparent'}${nb ? ';outline:1px solid rgba(0,0,0,0.15)' : ''}"
          onclick="MX.Pages.Planning._applyShift('${esc(userId)}','${esc(dateStr)}','${esc(s.code)}')">
          <div class="plng-picker-code" style="font-weight:${s.bold ? 700 : 600}">${esc(s.code)}</div>
          <div class="plng-picker-name">${esc(s.name)}</div>
          ${s.start ? `<div class="plng-picker-time">${s.start}–${s.end}</div>` : ''}
        </button>`;
      });
      bh += `</div>`;

      if (current) {
        bh += `<button class="plng-picker-clear" onclick="MX.Pages.Planning._clearShift('${esc(userId)}','${esc(dateStr)}')">
          <i class="fas fa-times"></i> Effacer
        </button>`;
      }

      bh += `<div class="plng-picker-range">
        <button class="plng-range-btn" onclick="MX.Pages.Planning._applyToWeek('${esc(userId)}','${esc(dateStr)}')">
          <i class="fas fa-calendar-week"></i> Appliquer à la semaine
        </button>
        <button class="plng-range-btn" onclick="MX.Pages.Planning._applyToMonth('${esc(userId)}','${esc(dateStr)}')">
          <i class="fas fa-calendar"></i> Appliquer au mois
        </button>
      </div>`;

      body.innerHTML = bh;
    }

    const actEl = document.getElementById('m-actions');
    if (actEl) actEl.innerHTML = `<button class="modal-btn cancel" onclick="MX.closeModal()">Fermer</button>`;
  }

  async function _applyShift(userId, dateStr, shiftCode) {
    MX.closeModal();
    try {
      await MX.DB.setPlanningEntry(userId, dateStr, shiftCode);
      const u  = _users().find(u => u.id === userId);
      const d  = new Date(dateStr + 'T00:00:00');
      const ym = d.getFullYear() + '-' + _pad(d.getMonth() + 1);
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      MX.state.planningEntries[userId + '_' + dateStr] = { userId, userName: u ? u.name : '', date: dateStr, shiftCode, ym };
      render();
    } catch (e) { MX.toast('Erreur enregistrement', true); }
  }

  async function _clearShift(userId, dateStr) {
    MX.closeModal();
    try {
      await MX.DB.deletePlanningEntry(userId, dateStr);
      if (MX.state.planningEntries) delete MX.state.planningEntries[userId + '_' + dateStr];
      render();
    } catch (e) { MX.toast('Erreur suppression', true); }
  }

  async function _applyToWeek(userId, dateStr) {
    const entry = _entry(userId, dateStr);
    if (!entry) return MX.toast('Sélectionnez un poste d\'abord', true);
    MX.closeModal();
    const days = _weekDays(dateStr);
    try {
      await Promise.all(days.map(ds => MX.DB.setPlanningEntry(userId, ds, entry.shiftCode)));
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      const u = _users().find(u => u.id === userId);
      days.forEach(ds => {
        const d  = new Date(ds + 'T00:00:00');
        MX.state.planningEntries[userId + '_' + ds] = {
          userId, userName: u ? u.name : '', date: ds,
          shiftCode: entry.shiftCode, ym: d.getFullYear() + '-' + _pad(d.getMonth() + 1)
        };
      });
      MX.toast('Semaine mise à jour'); render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  async function _applyToMonth(userId, dateStr) {
    const entry = _entry(userId, dateStr);
    if (!entry) return MX.toast('Sélectionnez un poste d\'abord', true);
    MX.closeModal();
    const d0  = new Date(dateStr + 'T00:00:00');
    const y   = d0.getFullYear(), m = d0.getMonth();
    const days = Array.from({ length: _daysInMonth(y, m) }, (_, i) => _dateStr(y, m, i + 1));
    try {
      await Promise.all(days.map(ds => MX.DB.setPlanningEntry(userId, ds, entry.shiftCode)));
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      const u = _users().find(u => u.id === userId);
      days.forEach(ds => {
        MX.state.planningEntries[userId + '_' + ds] = {
          userId, userName: u ? u.name : '', date: ds,
          shiftCode: entry.shiftCode, ym: y + '-' + _pad(m + 1)
        };
      });
      MX.toast('Mois mis à jour'); render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  // ── COPY / PASTE ──

  function _copyWeek(userId) {
    const days = _weekDays(_day), data = {};
    days.forEach(ds => { const e = _entry(userId, ds); if (e) data[ds] = e.shiftCode; });
    _clipboard = { type: 'week', data };
    MX.toast('Semaine copiée');
  }

  async function _pasteWeek(userId) {
    if (!_clipboard || _clipboard.type !== 'week') return MX.toast('Rien à coller', true);
    const srcDays = Object.keys(_clipboard.data).sort();
    if (!srcDays.length) return MX.toast('Semaine source vide', true);
    const days  = _weekDays(_day);
    const pairs = days.map((ds, i) => ({ ds, code: _clipboard.data[srcDays[i]] })).filter(p => p.code);
    try {
      await Promise.all(pairs.map(p => MX.DB.setPlanningEntry(userId, p.ds, p.code)));
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      const u = _users().find(u => u.id === userId);
      pairs.forEach(p => {
        const d  = new Date(p.ds + 'T00:00:00');
        MX.state.planningEntries[userId + '_' + p.ds] = {
          userId, userName: u ? u.name : '', date: p.ds,
          shiftCode: p.code, ym: d.getFullYear() + '-' + _pad(d.getMonth() + 1)
        };
      });
      MX.toast('Semaine collée'); render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  function _copyMonth(userId) {
    const total = _daysInMonth(_year, _month), data = {};
    for (let d = 1; d <= total; d++) {
      const ds = _dateStr(_year, _month, d);
      const e  = _entry(userId, ds);
      if (e) data[ds] = e.shiftCode;
    }
    _clipboard = { type: 'month', data };
    MX.toast('Mois copié (' + Object.keys(data).length + ' entrées)');
  }

  async function _pasteMonth(userId) {
    if (!_clipboard || _clipboard.type !== 'month') return MX.toast('Rien à coller (copiez d\'abord un mois)', true);
    const srcDays = Object.keys(_clipboard.data).sort();
    if (!srcDays.length) return MX.toast('Mois source vide', true);
    const total   = _daysInMonth(_year, _month);
    const tgtDays = Array.from({ length: total }, (_, i) => _dateStr(_year, _month, i + 1));
    const pairs   = tgtDays.map((ds, i) => ({ ds, code: _clipboard.data[srcDays[i]] })).filter(p => p.code);
    try {
      await Promise.all(pairs.map(p => MX.DB.setPlanningEntry(userId, p.ds, p.code)));
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      const u = _users().find(u => u.id === userId);
      pairs.forEach(p => {
        MX.state.planningEntries[userId + '_' + p.ds] = {
          userId, userName: u ? u.name : '', date: p.ds,
          shiftCode: p.code, ym: _year + '-' + _pad(_month + 1)
        };
      });
      MX.toast('Mois collé'); render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  // ── RANGE APPLY MODAL ──

  function _openRangeApply(shiftCode) {
    const shift = _shiftByCode(shiftCode);
    const users = _users();
    const esc   = MX.esc;
    const today = _todayStr();

    MX.showModal('Appliquer ' + (shift ? shift.name : shiftCode), 'Sur une plage de dates', []);

    const body = document.getElementById('m-body') || document.getElementById('m-sub');
    if (body) {
      body.innerHTML = `<div class="plng-range-form">
        <label class="plng-form-label">Agent</label>
        <select id="plng-ra-user" class="fi" style="width:100%">
          <option value="">Tous les agents</option>
          ${users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>
        <label class="plng-form-label" style="margin-top:10px">Du</label>
        <input type="date" id="plng-ra-from" class="fi" value="${today}" style="width:100%">
        <label class="plng-form-label" style="margin-top:10px">Au</label>
        <input type="date" id="plng-ra-to" class="fi" value="${today}" style="width:100%">
        <label class="plng-form-label" style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="plng-ra-no-we"> Exclure les week-ends
        </label>
      </div>`;
    }

    const actEl = document.getElementById('m-actions');
    if (actEl) {
      actEl.innerHTML = `
        <button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>
        <button class="modal-btn confirm" onclick="MX.Pages.Planning._confirmRangeApply('${esc(shiftCode)}')">
          <i class="fas fa-check"></i> Appliquer
        </button>`;
    }
  }

  async function _confirmRangeApply(shiftCode) {
    const userId = (document.getElementById('plng-ra-user') || {}).value || '';
    const from   = (document.getElementById('plng-ra-from') || {}).value || '';
    const to     = (document.getElementById('plng-ra-to')   || {}).value || '';
    const noWE   = (document.getElementById('plng-ra-no-we') || {}).checked;

    if (!from || !to || from > to) return MX.toast('Dates invalides', true);
    MX.closeModal();

    const allUsers = _users();
    const targets  = userId ? allUsers.filter(u => u.id === userId) : allUsers;
    const days = [];
    let cur = from;
    while (cur <= to) { if (!noWE || !_isWeekend(cur)) days.push(cur); cur = _addDays(cur, 1); }
    if (!days.length) return MX.toast('Aucun jour sélectionné', true);

    try {
      const ops = [];
      targets.forEach(u => days.forEach(ds => ops.push({ userId: u.id, user: u, ds })));
      await Promise.all(ops.map(o => MX.DB.setPlanningEntry(o.userId, o.ds, shiftCode)));
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      ops.forEach(o => {
        const d  = new Date(o.ds + 'T00:00:00');
        MX.state.planningEntries[o.userId + '_' + o.ds] = {
          userId: o.userId, userName: o.user.name, date: o.ds,
          shiftCode, ym: d.getFullYear() + '-' + _pad(d.getMonth() + 1)
        };
      });
      MX.toast(shiftCode + ' appliqué (' + ops.length + ' entrée(s))'); render();
    } catch (e) { MX.toast('Erreur', true); }
  }

  // ── AUTO GENERATE MODAL ──

  function _openAutoGenModal() {
    const users  = _users();
    const shifts = _shifts();
    const esc    = MX.esc;
    const today  = _todayStr();
    const endDef = _dateStr(_year, _month, _daysInMonth(_year, _month));

    MX.showModal('Génération automatique', 'Appliquer un planning en masse', []);

    const body = document.getElementById('m-body') || document.getElementById('m-sub');
    if (body) {
      body.innerHTML = `<div class="plng-gen-form">
        <label class="plng-form-label">Agents</label>
        <div class="plng-gen-users">${users.map(u => `<label class="plng-gen-user-chk">
          <input type="checkbox" class="plng-gen-uid" value="${esc(u.id)}" checked> ${esc(u.name)}
        </label>`).join('')}</div>
        <label class="plng-form-label" style="margin-top:10px">Code poste</label>
        <select id="plng-gen-shift" class="fi" style="width:100%">
          ${shifts.map(s => `<option value="${esc(s.code)}">${esc(s.code)} — ${esc(s.name)}</option>`).join('')}
        </select>
        <label class="plng-form-label" style="margin-top:10px">Du</label>
        <input type="date" id="plng-gen-from" class="fi" value="${today}" style="width:100%">
        <label class="plng-form-label" style="margin-top:10px">Au</label>
        <input type="date" id="plng-gen-to" class="fi" value="${endDef}" style="width:100%">
        <label class="plng-form-label" style="margin-top:10px;display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="plng-gen-no-sat" checked> Exclure samedis
        </label>
        <label class="plng-form-label" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="plng-gen-no-sun" checked> Exclure dimanches
        </label>
      </div>`;
    }

    const actEl = document.getElementById('m-actions');
    if (actEl) {
      actEl.innerHTML = `
        <button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>
        <button class="modal-btn confirm" onclick="MX.Pages.Planning._confirmAutoGen()">
          <i class="fas fa-wand-magic-sparkles"></i> Générer
        </button>`;
    }
  }

  async function _confirmAutoGen() {
    const shiftCode = (document.getElementById('plng-gen-shift')  || {}).value || '';
    const from      = (document.getElementById('plng-gen-from')   || {}).value || '';
    const to        = (document.getElementById('plng-gen-to')     || {}).value || '';
    const noSat     = (document.getElementById('plng-gen-no-sat') || {}).checked;
    const noSun     = (document.getElementById('plng-gen-no-sun') || {}).checked;
    const userIds   = Array.from(document.querySelectorAll('.plng-gen-uid:checked')).map(b => b.value);

    if (!from || !to || from > to) return MX.toast('Dates invalides', true);
    if (!userIds.length)           return MX.toast('Sélectionnez au moins un agent', true);
    if (!shiftCode)                return MX.toast('Sélectionnez un code poste', true);
    MX.closeModal();

    const days = [];
    let cur = from;
    while (cur <= to) {
      const dow = new Date(cur + 'T00:00:00').getDay();
      if (!(noSat && dow === 6) && !(noSun && dow === 0)) days.push(cur);
      cur = _addDays(cur, 1);
    }
    if (!days.length) return MX.toast('Aucun jour sélectionné', true);

    const allUsers = _users();
    try {
      const ops = [];
      userIds.forEach(uid => {
        const user = allUsers.find(u => u.id === uid);
        days.forEach(ds => ops.push({ userId: uid, user, ds }));
      });
      await Promise.all(ops.map(o => MX.DB.setPlanningEntry(o.userId, o.ds, shiftCode)));
      if (!MX.state.planningEntries) MX.state.planningEntries = {};
      ops.forEach(o => {
        if (!o.user) return;
        const d  = new Date(o.ds + 'T00:00:00');
        MX.state.planningEntries[o.userId + '_' + o.ds] = {
          userId: o.userId, userName: o.user.name, date: o.ds,
          shiftCode, ym: d.getFullYear() + '-' + _pad(d.getMonth() + 1)
        };
      });
      MX.toast('Planning généré (' + ops.length + ' entrée(s))'); render();
    } catch (e) { MX.toast('Erreur génération', true); }
  }

  // ── SHIFT MANAGEMENT MODAL (admin) ──

  function _openShiftMgmt() {
    MX.showModal('Gérer les codes poste', 'Modifier, ajouter ou supprimer des codes', []);
    _renderShiftMgmtBody();
  }

  function _renderShiftMgmtBody() {
    const shifts = _shifts();
    const esc    = MX.esc;
    const body   = document.getElementById('m-body') || document.getElementById('m-sub');
    if (!body) return;

    let h = `<div class="plng-mgmt-list" id="plng-mgmt-list">`;
    shifts.forEach((s, i) => {
      h += `<div class="plng-mgmt-row" data-idx="${i}">
        <input type="text" class="fi fi-sm plng-mgmt-code" placeholder="Code" maxlength="6" value="${esc(s.code)}" style="width:60px">
        <input type="text" class="fi fi-sm plng-mgmt-name" placeholder="Nom" maxlength="20" value="${esc(s.name)}" style="flex:1">
        <input type="time" class="fi fi-sm plng-mgmt-start" value="${esc(s.start || '')}" style="width:80px">
        <input type="time" class="fi fi-sm plng-mgmt-end"   value="${esc(s.end   || '')}" style="width:80px">
        <input type="color" class="plng-mgmt-color" value="${esc(s.color)}">
        <label title="Gras"><input type="checkbox" class="plng-mgmt-bold"${s.bold ? ' checked' : ''}> G</label>
        <button class="plng-icon-btn" onclick="MX.Pages.Planning._removeMgmtRow(${i})"><i class="fas fa-times"></i></button>
      </div>`;
    });
    h += `</div>
      <button class="plng-qa-btn" style="margin-top:8px" onclick="MX.Pages.Planning._addMgmtRow()">
        <i class="fas fa-plus"></i> Ajouter un code
      </button>`;
    body.innerHTML = h;

    const actEl = document.getElementById('m-actions');
    if (actEl) {
      actEl.innerHTML = `
        <button class="modal-btn cancel" onclick="MX.closeModal()">Annuler</button>
        <button class="modal-btn confirm" onclick="MX.Pages.Planning._saveShiftMgmt()">
          <i class="fas fa-save"></i> Enregistrer
        </button>`;
    }
  }

  function _addMgmtRow() {
    const list = document.getElementById('plng-mgmt-list');
    if (!list) return;
    const idx = list.querySelectorAll('.plng-mgmt-row').length;
    const row = document.createElement('div');
    row.className  = 'plng-mgmt-row';
    row.dataset.idx = idx;
    row.innerHTML = `
      <input type="text" class="fi fi-sm plng-mgmt-code" placeholder="Code" maxlength="6" style="width:60px">
      <input type="text" class="fi fi-sm plng-mgmt-name" placeholder="Nom" maxlength="20" style="flex:1">
      <input type="time" class="fi fi-sm plng-mgmt-start" style="width:80px">
      <input type="time" class="fi fi-sm plng-mgmt-end"   style="width:80px">
      <input type="color" class="plng-mgmt-color" value="#6B7280">
      <label title="Gras"><input type="checkbox" class="plng-mgmt-bold"> G</label>
      <button class="plng-icon-btn" onclick="this.closest('.plng-mgmt-row').remove()"><i class="fas fa-times"></i></button>`;
    list.appendChild(row);
  }

  function _removeMgmtRow(idx) {
    const list = document.getElementById('plng-mgmt-list');
    if (!list) return;
    const row = list.querySelector(`.plng-mgmt-row[data-idx="${idx}"]`);
    if (row) row.remove();
  }

  async function _saveShiftMgmt() {
    const list = document.getElementById('plng-mgmt-list');
    if (!list) return;
    const newShifts = [];
    let order = 0, valid = true;
    list.querySelectorAll('.plng-mgmt-row').forEach(row => {
      const code  = (row.querySelector('.plng-mgmt-code')  || {}).value?.trim() || '';
      const name  = (row.querySelector('.plng-mgmt-name')  || {}).value?.trim() || '';
      const start = (row.querySelector('.plng-mgmt-start') || {}).value || '';
      const end   = (row.querySelector('.plng-mgmt-end')   || {}).value || '';
      const color = (row.querySelector('.plng-mgmt-color') || {}).value || '#6B7280';
      const bold  = !!(row.querySelector('.plng-mgmt-bold') || {}).checked;
      if (!code || !name) { valid = false; return; }
      const textColor = MX._contrastColor ? MX._contrastColor(color) : '#000000';
      newShifts.push({ code, name, color, textColor, start, end, bold, order: order++ });
    });
    if (!valid) return MX.toast('Code et nom requis pour chaque ligne', true);
    MX.closeModal();
    try {
      await MX.DB.savePlanningShifts(newShifts);
      MX.state.planningShifts = newShifts;
      MX.toast('Codes enregistrés'); render();
    } catch (e) { MX.toast('Erreur sauvegarde', true); }
  }

  // ── EXPORT CSV ──

  function _exportCsv() {
    const users   = _users();
    const entries = _entries();
    const shifts  = _shifts();
    let dates = [];
    if (_view === 'week') dates = _weekDays(_day);
    else if (_view === 'day') dates = [_day];
    else dates = Array.from({ length: _daysInMonth(_year, _month) }, (_, i) => _dateStr(_year, _month, i + 1));

    const rows = [['Agent'].concat(dates)];
    users.forEach(u => {
      rows.push([u.name].concat(dates.map(ds => {
        const e = entries[u.id + '_' + ds]; return e ? e.shiftCode : '';
      })));
    });
    rows.push([]); rows.push(['Code', 'Nom', 'Début', 'Fin']);
    shifts.forEach(s => rows.push([s.code, s.name, s.start, s.end]));

    const csv  = rows.map(r => r.map(c => '"' + String(c || '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'planning_' + (_view === 'month' ? _fmtMonthTitle().replace(' ', '_') : _day) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    MX.toast('Export téléchargé');
  }

  // ── FILTERS ──

  function _setFilterUser(v)  { _filterUser  = v; render(); }
  function _setFilterShift(v) { _filterShift = v; render(); }

  // ── MAIN RENDER ──

  function render() {
    const el = document.getElementById('main-content');
    if (!el) return;

    const users   = _users();
    const shifts  = _shifts();
    const today   = _todayStr();
    const canEdit = _canEdit();
    const isAdmin = MX.Auth.isAdmin();

    let title = _view === 'month' ? _fmtMonthTitle() : _view === 'week' ? _fmtWeekTitle() : _fmtDayTitle();

    const titleEl = document.getElementById('topbar-title');
    if (titleEl) titleEl.textContent = 'Planning';

    let h = `
<div class="ph">
  <div class="ph-eye">PLANNING</div>
  <div class="ph-row">
    <div style="flex:1">
      <div class="ph-title">${MX.esc(title)}</div>
      <div class="ph-sub">Planification des horaires d'équipe</div>
    </div>
  </div>
</div>
<div class="plng-page">
  <div class="plng-toolbar">
    <div class="plng-view-toggle">
      <button class="plng-vbtn${_view==='day'?' active':''}"   onclick="MX.Pages.Planning._setView('day')">Jour</button>
      <button class="plng-vbtn${_view==='week'?' active':''}"  onclick="MX.Pages.Planning._setView('week')">Semaine</button>
      <button class="plng-vbtn${_view==='month'?' active':''}" onclick="MX.Pages.Planning._setView('month')">Mois</button>
    </div>
    <div class="plng-nav">
      <button class="plng-nav-btn" onclick="MX.Pages.Planning._prev()"><i class="fas fa-chevron-left"></i></button>
      <span class="plng-nav-lbl">${MX.esc(title)}</span>
      <button class="plng-nav-btn" onclick="MX.Pages.Planning._next()"><i class="fas fa-chevron-right"></i></button>
      <button class="plng-nav-btn plng-nav-today" onclick="MX.Pages.Planning._today()">Auj.</button>
    </div>
    <div class="plng-filters">
      <select class="fi fi-sm plng-sel" onchange="MX.Pages.Planning._setFilterUser(this.value)">
        <option value="">Tous les agents</option>
        ${users.map(u => `<option value="${MX.esc(u.id)}"${_filterUser===u.id?' selected':''}>${MX.esc(u.name)}</option>`).join('')}
      </select>
      <select class="fi fi-sm plng-sel" onchange="MX.Pages.Planning._setFilterShift(this.value)">
        <option value="">Tous les codes</option>
        ${shifts.map(s => `<option value="${MX.esc(s.code)}"${_filterShift===s.code?' selected':''}>${MX.esc(s.code)} — ${MX.esc(s.name)}</option>`).join('')}
      </select>
    </div>
  </div>
  ${canEdit && _view !== 'day' ? _renderQuickBar(shifts) : ''}
  <div class="plng-body">
    <div class="plng-main">`;

    if (_loading) {
      h += `<div class="plng-empty"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:var(--cyan)"></i><span>Chargement…</span></div>`;
    } else if (_view === 'month') {
      h += _renderMonthTable(users, today, canEdit);
    } else if (_view === 'week') {
      h += _renderWeekTable(users, today, canEdit);
    } else {
      h += _renderDayList(users, today, canEdit);
    }

    h += `</div>
    ${_renderSidebar(canEdit, isAdmin)}
  </div>
</div>`;

    el.innerHTML = h;

    if (_view !== 'day' && !_loading) _attachTableEvents();
  }

  // ── ENTRY POINT ──

  async function renderPage() {
    const now = new Date();
    _year  = now.getFullYear();
    _month = now.getMonth();
    _day   = now.toISOString().slice(0, 10);
    _selected.clear();
    await _loadAndRender();
  }

  // ── EXPORT ──

  window.MX             = window.MX || {};
  window.MX.Pages       = window.MX.Pages || {};
  window.MX.Pages.Planning = {
    render: renderPage,
    _prev, _next, _today, _setView,
    _setFilterUser, _setFilterShift,
    _cellMouseDown,
    _applyCodeToSelected, _clearCodeFromSelected, _clearSelection,
    _openShiftPicker, _applyShift, _clearShift, _applyToWeek, _applyToMonth,
    _copyWeek, _pasteWeek, _copyMonth, _pasteMonth,
    _openRangeApply, _confirmRangeApply,
    _openAutoGenModal, _confirmAutoGen,
    _openShiftMgmt, _addMgmtRow, _removeMgmtRow, _saveShiftMgmt,
    _exportCsv,
  };
})();
