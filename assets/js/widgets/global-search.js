(function () {
  var _open = false;
  var _selIdx = -1;
  var _results = [];

  function _inject() {
    if (document.getElementById('gs-overlay')) return;
    var div = document.createElement('div');
    div.innerHTML = '<div id="gs-overlay" class="gs-overlay" role="dialog" aria-label="Recherche globale" style="display:none">' +
      '<div class="gs-box">' +
        '<div class="gs-search">' +
          '<i class="fas fa-magnifying-glass gs-search-ico"></i>' +
          '<input id="gs-input" class="gs-input" type="text" placeholder="Rechercher dans Maintix…" autocomplete="off">' +
          '<button class="gs-close" onclick="MX.GlobalSearch.close()">Esc</button>' +
        '</div>' +
        '<div id="gs-body" class="gs-body"></div>' +
        '<div class="gs-footer">' +
          '<span><kbd>↑↓</kbd> Naviguer</span>' +
          '<span><kbd>↵</kbd> Ouvrir</span>' +
          '<span><kbd>Esc</kbd> Fermer</span>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(div.firstChild);

    var overlay = document.getElementById('gs-overlay');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    var input = document.getElementById('gs-input');
    input.addEventListener('input', function () {
      _selIdx = -1;
      _search(input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); _move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); _confirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }

  function open() {
    _inject();
    var overlay = document.getElementById('gs-overlay');
    overlay.style.display = 'flex';
    _open = true;
    _selIdx = -1;
    _results = [];
    var input = document.getElementById('gs-input');
    input.value = '';
    document.getElementById('gs-body').innerHTML = _emptyPrompt();
    setTimeout(function () { input.focus(); }, 50);
  }

  function close() {
    var overlay = document.getElementById('gs-overlay');
    if (overlay) overlay.style.display = 'none';
    _open = false;
    _selIdx = -1;
    _results = [];
  }

  function _emptyPrompt() {
    return '<div class="gs-empty"><i class="fas fa-magnifying-glass"></i><span>Tapez au moins 2 caractères pour rechercher</span></div>';
  }

  function _noResults() {
    return '<div class="gs-empty"><i class="fas fa-face-meh"></i><span>Aucun résultat</span></div>';
  }

  function _matches(str, q) {
    if (!str) return false;
    return String(str).toLowerCase().indexOf(q) !== -1;
  }

  function _search(raw) {
    var q = (raw || '').trim().toLowerCase();
    if (q.length < 2) {
      document.getElementById('gs-body').innerHTML = _emptyPrompt();
      _results = [];
      return;
    }

    var esc = MX.esc;
    var state = MX.state;
    var i;

    // 1. Interventions (missions)
    var missions = state.missions || [];
    var missionHits = [];
    for (i = 0; i < missions.length; i++) {
      var m = missions[i];
      if (_matches(m.text, q) || _matches(m.assignedTo, q) || _matches(m.createdBy, q)) {
        missionHits.push({ label: m.text || '', sub: m.assignedTo || '', page: 'utilisateurs', tab: 'missions', id: m.id });
        if (missionHits.length >= 5) break;
      }
    }

    // 2. Stock & Commandes (products)
    var products = state.products || [];
    var productHits = [];
    for (i = 0; i < products.length; i++) {
      var p = products[i];
      if (_matches(p.name, q) || _matches(p.ref, q) || _matches(p.category, q) || _matches(p.supplier, q) || _matches(p.location, q)) {
        productHits.push({ label: p.name || '', sub: [p.ref, p.category].filter(Boolean).join(' · '), page: 'orders', id: p.id });
        if (productHits.length >= 5) break;
      }
    }

    // 3. Messages (announcements)
    var announcements = state.announcements || [];
    var annHits = [];
    for (i = 0; i < announcements.length; i++) {
      var a = announcements[i];
      if (_matches(a.content, q) || _matches(a.authorName, q)) {
        var label = a.content ? (a.content.length > 60 ? a.content.slice(0, 60) + '…' : a.content) : '';
        annHits.push({ label: label, sub: a.authorName || '', page: 'msgs', id: a.id });
        if (annHits.length >= 5) break;
      }
    }

    // 4. Taches
    var taskHits = [];
    var DAYS = MX.DAYS || [];
    var SLOTS = MX.SLOTS || {};
    var done = false;
    for (var di = 0; di < DAYS.length && !done; di++) {
      var day = DAYS[di];
      var slots = MX.getDaySlots ? MX.getDaySlots(day.id) : [];
      for (var si = 0; si < slots.length && !done; si++) {
        var sl = slots[si];
        var key = day.id + '_' + sl;
        var dayTasks = (state.tasks && state.tasks[key]) || [];
        for (var ti = 0; ti < dayTasks.length; ti++) {
          var t = dayTasks[ti];
          if (_matches(t.text, q)) {
            var slotLabel = SLOTS[sl] ? SLOTS[sl].l : sl;
            taskHits.push({ label: t.text || '', sub: day.l + ' · ' + slotLabel, page: day.id, id: t.id });
            if (taskHits.length >= 5) { done = true; break; }
          }
        }
      }
    }

    // 5. Absences
    var absences = state.absences || [];
    var absHits = [];
    for (i = 0; i < absences.length; i++) {
      var ab = absences[i];
      if (_matches(ab.userName, q)) {
        absHits.push({ label: ab.userName || '', sub: (ab.from || '') + ' → ' + (ab.to || ''), page: 'utilisateurs', tab: 'absences', id: ab.id });
        if (absHits.length >= 5) break;
      }
    }

    // Build results list
    _results = [];
    var sections = [];

    if (missionHits.length) {
      sections.push({ title: 'Interventions', icon: 'fa-clipboard-list', items: missionHits });
    }
    if (productHits.length) {
      sections.push({ title: 'Stock &amp; Commandes', icon: 'fa-box', items: productHits });
    }
    if (annHits.length) {
      sections.push({ title: 'Messages', icon: 'fa-comments', items: annHits });
    }
    if (taskHits.length) {
      sections.push({ title: 'Tâches', icon: 'fa-list-check', items: taskHits });
    }
    if (absHits.length) {
      sections.push({ title: 'Absences', icon: 'fa-calendar-xmark', items: absHits });
    }

    if (!sections.length) {
      document.getElementById('gs-body').innerHTML = _noResults();
      return;
    }

    var h = '';
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      h += '<div class="gs-section"><i class="fas ' + sec.icon + '"></i> ' + sec.title + '</div>';
      for (var r = 0; r < sec.items.length; r++) {
        var item = sec.items[r];
        var idx = _results.length;
        _results.push(item);
        h += '<button class="gs-item" data-gs-idx="' + idx + '" onclick="MX.GlobalSearch._pick(' + idx + ')">' +
          '<div class="gs-ico"><i class="fas ' + sec.icon + '"></i></div>' +
          '<div class="gs-txt">' +
            '<span class="gs-lbl">' + esc(item.label) + '</span>' +
            (item.sub ? '<span class="gs-sub">' + esc(item.sub) + '</span>' : '') +
          '</div>' +
          '<i class="fas fa-arrow-right gs-arrow"></i>' +
        '</button>';
      }
    }

    document.getElementById('gs-body').innerHTML = h;
  }

  function _move(dir) {
    var items = document.querySelectorAll('#gs-body .gs-item');
    if (!items.length) return;
    _selIdx += dir;
    if (_selIdx < 0) _selIdx = items.length - 1;
    if (_selIdx >= items.length) _selIdx = 0;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('gs-sel', i === _selIdx);
    }
    if (items[_selIdx]) items[_selIdx].scrollIntoView({ block: 'nearest' });
  }

  function _confirm() {
    if (_selIdx >= 0 && _selIdx < _results.length) {
      _pick(_selIdx);
    } else if (_results.length > 0) {
      _pick(0);
    }
  }

  function _pick(idx) {
    var item = _results[idx];
    if (!item) return;
    close();
    if (item.page) {
      MX.showPage(item.page);
      if (item.tab && MX.Pages && MX.Pages.Admin) {
        setTimeout(function () { MX.Pages.Admin.setTab(item.tab); }, 100);
      }
    }
  }

  // Keyboard shortcut
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (_open) close(); else open();
    }
    if (e.key === 'Escape' && _open) {
      close();
    }
  });

  window.MX = window.MX || {};
  window.MX.GlobalSearch = { open: open, close: close, _pick: _pick };
})();
