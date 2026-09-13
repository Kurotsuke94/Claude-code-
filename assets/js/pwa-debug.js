/* ══════════════════════════════════════════════════════════════════════
   PANNEAU DE DIAGNOSTIC TEMPORAIRE — bottom nav / PWA standalone iOS
   ------------------------------------------------------------------
   Deux déclenchements possibles, tous deux affichant le même panneau :
     1) URL : ?pwa-debug=1 (secours, inchangé)
     2) Bouton "Diagnostic PWA" dans le menu Super Admin, qui appelle
        MX.PwaDebug.open()
   N'exécute rien, ne modifie rien, ne s'affiche rien tant qu'aucun des
   deux déclencheurs n'est activé. Aucune logique métier, aucune donnée
   Firestore, aucune règle d'authentification touchée — ce fichier ne
   fait que LIRE des valeurs runtime déjà présentes dans le DOM/CSS et
   les afficher à l'écran.
   À SUPPRIMER (ce fichier + la ligne <script> qui le charge dans
   index.html, + le bouton "Diagnostic PWA" dans app.js) une fois le
   diagnostic terminé.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) { return null; }
  }

  function fmt(v) {
    if (v === undefined) return '(undefined)';
    if (v === null) return '(null)';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return String(v);
  }

  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right, width: r.width };
  }

  function computedOf(el, props) {
    if (!el) return null;
    var s = getComputedStyle(el);
    var out = {};
    props.forEach(function (p) { out[p] = s[p]; });
    return out;
  }

  function line(label, value) {
    return '<div class="pwadbg-row"><span class="pwadbg-lbl">' + label + '</span>' +
      '<span class="pwadbg-val">' + fmt(value) + '</span></div>';
  }

  function section(title, html) {
    return '<div class="pwadbg-sec"><div class="pwadbg-sec-ttl">' + title + '</div>' + html + '</div>';
  }

  function measureSafeAreaBottom() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;' +
      'padding-bottom:env(safe-area-inset-bottom, -1px);visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    var val = parseFloat(getComputedStyle(probe).paddingBottom);
    probe.remove();
    return val;
  }

  function build() {
    var bottomNav = document.getElementById('bottom-nav');
    var mbnBar    = document.querySelector('.mbn-bar');
    var mbnBtn    = document.querySelector('.mbn-btn');
    var mbnFab    = document.querySelector('.mbn-fab');
    var appShell  = document.getElementById('app-shell');
    var mainContent = document.getElementById('main-content');

    var bottomNavRect = rectOf(bottomNav);
    var mbnBarRect    = rectOf(mbnBar);
    var safeArea      = measureSafeAreaBottom();
    var bottomNavHVar = getComputedStyle(document.documentElement).getPropertyValue('--bottomnav-h').trim();

    var vv = window.visualViewport;

    var html = '';

    html += section('EXPECTED vs ACTUAL', '' +
      line('EXPECTED bottom-nav', bottomNavHVar + ' + safe-area(' + fmt(safeArea) + 'px) = ' +
        (parseFloat(bottomNavHVar) + safeArea) + 'px') +
      line('ACTUAL #bottom-nav height', bottomNavRect ? bottomNavRect.height + 'px' : 'introuvable') +
      line('ACTUAL .mbn-bar height', mbnBarRect ? mbnBarRect.height + 'px' : 'introuvable') +
      line('ACTUAL safe-area-inset-bottom', safeArea + 'px'));

    html += section('1. ENVIRONNEMENT', '' +
      line('window.innerWidth', window.innerWidth) +
      line('window.innerHeight', window.innerHeight) +
      line('document.documentElement.clientWidth', document.documentElement.clientWidth) +
      line('document.documentElement.clientHeight', document.documentElement.clientHeight) +
      line('visualViewport.width', vv ? vv.width : 'non supporté') +
      line('visualViewport.height', vv ? vv.height : 'non supporté') +
      line('visualViewport.offsetTop', vv ? vv.offsetTop : 'non supporté') +
      line('visualViewport.offsetLeft', vv ? vv.offsetLeft : 'non supporté') +
      line('visualViewport.scale', vv ? vv.scale : 'non supporté') +
      line('navigator.standalone', window.navigator.standalone) +
      line("matchMedia display-mode:standalone", window.matchMedia('(display-mode: standalone)').matches) +
      line('window.devicePixelRatio', window.devicePixelRatio));

    if (bottomNav) {
      var bnStyle = computedOf(bottomNav, ['position','display','height','minHeight','maxHeight',
        'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom',
        'boxSizing','bottom','top','inset','transform']);
      html += section('2. #bottom-nav', '' +
        line('rect.top', bottomNavRect.top) + line('rect.bottom', bottomNavRect.bottom) +
        line('rect.height', bottomNavRect.height) + line('rect.left', bottomNavRect.left) +
        line('rect.right', bottomNavRect.right) + line('rect.width', bottomNavRect.width) +
        Object.keys(bnStyle).map(function (k) { return line('computed.' + k, bnStyle[k]); }).join(''));
    } else {
      html += section('2. #bottom-nav', line('statut', 'ÉLÉMENT INTROUVABLE DANS LE DOM'));
    }

    if (mbnBar) {
      var barStyle = computedOf(mbnBar, ['height','minHeight','paddingTop','paddingBottom','boxSizing','display','position']);
      html += section('3. .mbn-bar', '' +
        line('rect.top', mbnBarRect.top) + line('rect.bottom', mbnBarRect.bottom) +
        line('rect.height', mbnBarRect.height) + line('rect.width', mbnBarRect.width) +
        Object.keys(barStyle).map(function (k) { return line('computed.' + k, barStyle[k]); }).join(''));
    } else {
      html += section('3. .mbn-bar', line('statut', 'ÉLÉMENT INTROUVABLE'));
    }

    if (mbnBtn) {
      var btnRect = rectOf(mbnBtn);
      var btnStyle = computedOf(mbnBtn, ['height','minHeight','paddingTop','paddingBottom','boxSizing']);
      html += section('4. .mbn-btn (premier)', '' +
        line('rect.top', btnRect.top) + line('rect.bottom', btnRect.bottom) +
        line('rect.height', btnRect.height) + line('rect.width', btnRect.width) +
        Object.keys(btnStyle).map(function (k) { return line('computed.' + k, btnStyle[k]); }).join(''));
    } else {
      html += section('4. .mbn-btn', line('statut', 'ÉLÉMENT INTROUVABLE'));
    }

    if (mbnFab) {
      var fabRect = rectOf(mbnFab);
      var fabStyle = computedOf(mbnFab, ['height','width','bottom','position','transform']);
      html += section('5. .mbn-fab', '' +
        line('rect.top', fabRect.top) + line('rect.bottom', fabRect.bottom) +
        line('rect.height', fabRect.height) + line('rect.width', fabRect.width) +
        Object.keys(fabStyle).map(function (k) { return line('computed.' + k, fabStyle[k]); }).join(''));
    } else {
      html += section('5. .mbn-fab', line('statut', 'ÉLÉMENT INTROUVABLE'));
    }

    html += section('6. VARIABLE CSS', line('--bottomnav-h (calculée)', bottomNavHVar));
    html += section('7. SAFE AREA', line('safeAreaBottom (mesurée)', safeArea + 'px'));

    var elems = [
      ['document.body', document.body],
      ['#app-shell', appShell],
      ['#main-content', mainContent],
      ['#bottom-nav', bottomNav],
    ];
    var elHtml = '';
    elems.forEach(function (pair) {
      var name = pair[0], el = pair[1];
      if (!el) { elHtml += line(name, 'introuvable'); return; }
      var r = rectOf(el);
      var s = computedOf(el, ['position','display','overflow','zIndex']);
      elHtml += '<div class="pwadbg-subsec">' + name + '</div>' +
        line('top/bottom/height', r.top.toFixed(0) + ' / ' + r.bottom.toFixed(0) + ' / ' + r.height.toFixed(0)) +
        line('position', s.position) + line('display', s.display) +
        line('overflow', s.overflow) + line('z-index', s.zIndex);
    });
    html += section('8. ÉLÉMENTS SUSCEPTIBLES D\'OCCUPER LA ZONE', elHtml);

    var sheets = [];
    try {
      Array.prototype.forEach.call(document.styleSheets, function (ss) {
        sheets.push(ss.href || '(inline)');
      });
    } catch (e) { sheets.push('Erreur lecture styleSheets: ' + e.message); }
    html += section('9. FEUILLES CSS CHARGÉES (document.styleSheets)',
      sheets.map(function (h, i) { return line('[' + i + ']', h); }).join(''));

    html += section('10. INFOS SESSION', '' +
      line('Date/heure', new Date().toString()) +
      line('navigator.userAgent', navigator.userAgent));

    return html;
  }

  function render() {
    var old = document.getElementById('pwadbg-panel');
    if (old) old.remove();

    var panel = document.createElement('div');
    panel.id = 'pwadbg-panel';
    panel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(5,8,15,0.97)', 'color:#7CFC7C',
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'font-size:12px', 'line-height:1.5',
      'overflow-y:auto', '-webkit-overflow-scrolling:touch',
      'padding:16px', 'box-sizing:border-box',
    ].join(';');

    var style = document.createElement('style');
    style.textContent =
      '#pwadbg-panel .pwadbg-sec{margin-bottom:14px;border:1px solid #234;border-radius:8px;padding:8px 10px;background:rgba(255,255,255,0.03)}' +
      '#pwadbg-panel .pwadbg-sec-ttl{color:#fff;font-weight:700;margin-bottom:6px;font-size:12.5px;letter-spacing:.02em}' +
      '#pwadbg-panel .pwadbg-subsec{color:#9cf;font-weight:700;margin:6px 0 2px}' +
      '#pwadbg-panel .pwadbg-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px dashed #223}' +
      '#pwadbg-panel .pwadbg-lbl{color:#9aa;flex-shrink:0}' +
      '#pwadbg-panel .pwadbg-val{color:#fff;text-align:right;word-break:break-all}' +
      '#pwadbg-panel .pwadbg-btn{position:sticky;top:0;display:flex;gap:8px;margin-bottom:12px;z-index:2}' +
      '#pwadbg-panel .pwadbg-btn button{flex:1;padding:10px;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer}';
    panel.appendChild(style);

    var btnBar = document.createElement('div');
    btnBar.className = 'pwadbg-btn';
    btnBar.innerHTML =
      '<button id="pwadbg-refresh" style="background:#334;color:#fff">↻ Rafraîchir</button>' +
      '<button id="pwadbg-close" style="background:#a33;color:#fff">✕ Fermer le diagnostic</button>';
    panel.appendChild(btnBar);

    var content = document.createElement('div');
    content.innerHTML = build();
    panel.appendChild(content);

    document.body.appendChild(panel);

    document.getElementById('pwadbg-close').onclick = function () { panel.remove(); };
    document.getElementById('pwadbg-refresh').onclick = function () {
      var c = panel.querySelector('div:last-child');
      content.innerHTML = build();
    };

    // Log console également (utile si un jour l'inspection à distance est possible)
    console.log('[PWA-DEBUG] Panneau de diagnostic affiché — voir écran.');
  }

  // #bottom-nav existe dès le HTML statique (balise <nav> vide), mais reste
  // sans contenu ni hauteur tant que app.js n'a pas fini son boot (~2-3s,
  // après l'authentification Firebase) et peuplé .mbn-bar dedans. On attend
  // ce contenu réel (et une hauteur non nulle) avant de mesurer quoi que ce
  // soit, pour ne jamais capturer un état transitoire à 0px. Utilisé par les
  // deux déclencheurs (URL et bouton Super Admin) afin de ne pas dupliquer
  // le diagnostic.
  function openPanel() {
    var attempts = 0;
    var maxAttempts = 80; // ~20s à 250ms
    var poll = setInterval(function () {
      attempts++;
      var bar = document.querySelector('.mbn-bar');
      var ready = bar && bar.getBoundingClientRect().height > 0;
      if (ready || attempts >= maxAttempts) {
        clearInterval(poll);
        render();
      }
    }, 250);
  }

  // Déclencheur 2 : bouton "Diagnostic PWA" (Super Admin uniquement, géré
  // côté app.js — ce fichier ne fait qu'exposer la fonction d'ouverture).
  window.MX = window.MX || {};
  window.MX.PwaDebug = { open: openPanel };

  // Déclencheur 1 : URL ?pwa-debug=1 (secours, comportement inchangé).
  if (getParam('pwa-debug') === '1') openPanel();
})();
