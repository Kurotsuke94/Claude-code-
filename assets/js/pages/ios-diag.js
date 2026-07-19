(function () {
  'use strict';

  // ── State ──
  var _mc = null;
  var _running = false;
  var _logs = [];
  var _diagData = {};

  // ── Admin gate ──
  function _isAdmin() {
    return !!(window.MX && window.MX.Auth && window.MX.Auth.isAdmin && MX.Auth.isAdmin());
  }

  // ── Timestamp ──
  function _ts() {
    return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── Log ──
  function _log(msg, level) {
    var entry = { ts: _ts(), msg: msg, level: level || 'info' };
    _logs.push(entry);
    var el = document.getElementById('iosd-log');
    if (!el) return;
    var line = document.createElement('div');
    line.className = 'iosd-log-line iosd-log-' + (level || 'info');
    line.textContent = '[' + entry.ts + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // ── Status dot HTML ──
  function _dot(state) {
    // state: ok | warn | error | idle
    return '<span class="iosd-dot iosd-dot--' + state + '"></span>';
  }

  function _badge(state, label) {
    return '<span class="iosd-badge iosd-badge--' + state + '">' + label + '</span>';
  }

  // ── Section card builder ──
  function _card(id, icon, title, rows) {
    return '<div class="iosd-card" id="iosd-card-' + id + '">'
      + '<div class="iosd-section-title"><i class="fas ' + icon + '"></i> ' + title + '</div>'
      + '<div class="iosd-check-list">' + rows + '</div>'
      + '</div>';
  }

  function _check(label, state, detail, extra) {
    return '<div class="iosd-check">'
      + _dot(state)
      + '<span class="iosd-check-label">' + label + '</span>'
      + '<span class="iosd-check-val">' + (detail || '—') + '</span>'
      + (extra ? '<div class="iosd-check-extra">' + extra + '</div>' : '')
      + '</div>';
  }

  // ── Main render ──
  function render() {
    _mc = document.getElementById('main-content');
    if (!_mc) return;

    if (!_isAdmin()) {
      _mc.innerHTML = '<div class="iosd-denied">'
        + '<i class="fas fa-lock iosd-denied-icon"></i>'
        + '<div class="iosd-denied-title">Accès refusé</div>'
        + '<div class="iosd-denied-sub">Cette page est réservée aux administrateurs.</div>'
        + '<button class="iosd-btn iosd-btn-primary" style="margin-top:20px" onclick="MX.showPage(\'home\')">'
        + '<i class="fas fa-home"></i> Retour à l\'accueil</button>'
        + '</div>';
      return;
    }

    _logs = [];
    _diagData = {};
    _mc.innerHTML = _buildShell();
    setTimeout(_runDiag, 80);
  }

  // ── Shell ──
  function _buildShell() {
    var skeleton = CHECK_SECTIONS.map(function(s) {
      return '<div class="iosd-card iosd-card--loading" id="iosd-card-' + s.id + '">'
        + '<div class="iosd-section-title"><i class="fas ' + s.icon + '"></i> ' + s.label + '</div>'
        + '<div class="iosd-check-list"><div class="iosd-check-loading">Analyse en cours…</div></div>'
        + '</div>';
    }).join('');

    return '<div class="iosd-page">'

      + '<div class="iosd-topbar">'
      + '<div class="iosd-topbar-left">'
      + '<i class="fas fa-stethoscope iosd-topbar-icon"></i>'
      + '<div>'
      + '<div class="iosd-page-title">Diagnostic Push</div>'
      + '<div class="iosd-page-sub">Centre de diagnostic FCM · Réservé aux administrateurs</div>'
      + '</div>'
      + '</div>'
      + '<button class="iosd-btn iosd-btn-sm" id="iosd-btn-refresh" onclick="MX.Pages.IosDiag._refresh()">'
      + '<i class="fas fa-rotate-right"></i> Actualiser</button>'
      + '</div>'

      + '<div class="iosd-grid">'

      + '<div class="iosd-col-main">' + skeleton + '</div>'

      + '<div class="iosd-col-side">'
      + '<div class="iosd-card">'
      + '<div class="iosd-section-title"><i class="fas fa-flask"></i> Tests</div>'
      + '<div class="iosd-tests-grid">'
      + '<button class="iosd-test-btn" onclick="MX.Pages.IosDiag._testLocal()"><i class="fas fa-bell"></i><span>Notification locale</span></button>'
      + '<button class="iosd-test-btn" onclick="MX.Pages.IosDiag._testSystem()"><i class="fas fa-mobile-screen"></i><span>Notification système</span></button>'
      + '<button class="iosd-test-btn" onclick="MX.Pages.IosDiag._testFCM()"><i class="fas fa-satellite-dish"></i><span>Notification FCM</span></button>'
      + '<button class="iosd-test-btn" onclick="MX.Pages.IosDiag._recreateToken()"><i class="fas fa-key"></i><span>Recréer le token FCM</span></button>'
      + '<button class="iosd-test-btn" onclick="MX.Pages.IosDiag._reregisterSW()"><i class="fas fa-arrows-rotate"></i><span>Réenregistrer le SW</span></button>'
      + '<button class="iosd-test-btn" onclick="MX.Pages.IosDiag._refresh()"><i class="fas fa-rotate-right"></i><span>Actualiser</span></button>'
      + '</div>'
      + '</div>'

      + '<div class="iosd-card">'
      + '<div class="iosd-section-title"><i class="fas fa-terminal"></i> Journal'
      + '<div class="iosd-log-actions">'
      + '<button class="iosd-log-btn" onclick="MX.Pages.IosDiag._copyLogs()" title="Copier"><i class="fas fa-copy"></i></button>'
      + '<button class="iosd-log-btn" onclick="MX.Pages.IosDiag._exportJSON()" title="JSON"><i class="fas fa-file-code"></i></button>'
      + '<button class="iosd-log-btn" onclick="MX.Pages.IosDiag._exportTXT()" title="TXT"><i class="fas fa-file-lines"></i></button>'
      + '</div>'
      + '</div>'
      + '<div class="iosd-log" id="iosd-log"></div>'
      + '</div>'
      + '</div>'

      + '</div>'
      + '</div>';
  }

  var CHECK_SECTIONS = [
    { id: 'env',       icon: 'fa-display',          label: 'Environnement' },
    { id: 'ios-ctx',   icon: 'fa-mobile-screen',    label: 'Contexte iOS' },
    { id: 'notif',     icon: 'fa-bell',             label: 'Notifications' },
    { id: 'sw',        icon: 'fa-gears',            label: 'Service Worker' },
    { id: 'firebase',  icon: 'fa-fire',             label: 'Firebase' },
    { id: 'token',     icon: 'fa-key',              label: 'Token FCM' },
    { id: 'firestore', icon: 'fa-database',         label: 'Firestore' },
    { id: 'cf',        icon: 'fa-cloud',            label: 'Cloud Functions' },
    { id: 'debug',     icon: 'fa-bug',              label: 'Debug iOS' },
  ];

  // ── Render a section ──
  function _setSection(id, html) {
    var el = document.getElementById('iosd-card-' + id);
    if (!el) return;
    el.classList.remove('iosd-card--loading');
    el.querySelector('.iosd-check-list').innerHTML = html;
  }

  // ── Main diagnostic runner ──
  async function _runDiag() {
    if (_running) return;
    _running = true;
    _log('Démarrage du diagnostic…');

    // ── 1. Environnement ──
    try {
      var ua = navigator.userAgent;
      var isIOS = /iphone|ipad|ipod/i.test(ua);
      var isAndroid = /android/i.test(ua);
      var platform = isIOS ? 'iOS' : isAndroid ? 'Android' : 'Desktop';

      var iosVerStr = '—', iosOk = true;
      if (isIOS) {
        var m = ua.match(/OS (\d+)[_.](\d+)/);
        if (m) {
          var maj = parseInt(m[1], 10), min = parseInt(m[2], 10);
          iosVerStr = maj + '.' + min;
          iosOk = maj > 16 || (maj === 16 && min >= 4);
        }
      } else if (isAndroid) {
        var am = ua.match(/Android (\d+\.?\d*)/);
        iosVerStr = am ? am[1] : '—';
      }

      var browserName = 'Inconnu';
      if (/safari/i.test(ua) && !/chrome/i.test(ua)) browserName = 'Safari';
      else if (/chrome/i.test(ua)) browserName = 'Chrome';
      else if (/firefox/i.test(ua)) browserName = 'Firefox';
      else if (/edg/i.test(ua)) browserName = 'Edge';

      var isStandalone = window.navigator.standalone === true
        || window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches;

      var pwaState = isIOS ? (isStandalone ? 'ok' : 'error') : (isStandalone ? 'ok' : 'warn');
      var pwaLabel = isStandalone ? 'Standalone (installée)' : (isIOS ? 'Non installée — requis sur iOS' : 'Navigateur standard');

      _diagData.env = { platform, browser: browserName, version: iosVerStr, pwa: isStandalone, url: location.href };

      _setSection('env',
        _check('Plateforme', 'ok', platform)
        + _check('Navigateur', 'ok', browserName)
        + _check(isIOS ? 'Version iOS' : (isAndroid ? 'Version Android' : 'Système'), isIOS && !iosOk ? 'error' : 'ok', iosVerStr + (isIOS ? (iosOk ? ' ✓ ≥16.4' : ' ✗ <16.4') : ''))
        + _check('PWA installée', pwaState, pwaLabel)
        + _check('URL courante', 'idle', location.hostname + location.pathname)
      );

      _log('Plateforme : ' + platform + ' | Navigateur : ' + browserName + ' | PWA : ' + (isStandalone ? 'oui' : 'non'));
      if (isIOS && !iosOk) _log('⚠ iOS ' + iosVerStr + ' — Web Push nécessite iOS 16.4+', 'warn');
    } catch(e) { _log('Erreur section Environnement : ' + e.message, 'error'); }

    // ── 1b. Contexte iOS ──
    try {
      var ctxPwa      = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
      var ctxNotif    = 'Notification' in window;
      var ctxPush     = 'PushManager' in window;
      var ctxCtrl     = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      var ctxMsg      = !!(window.MX && window.MX.messaging);
      var ctxVapid    = !!(window.MX && window.MX.VAPID_KEY && window.MX.VAPID_KEY.length > 10);
      var ctxPerm     = ctxNotif ? Notification.permission : 'unsupported';
      var ctxReady    = '—';
      try {
        ctxReady = await Promise.race([
          navigator.serviceWorker.ready.then(function(r) { return r.active ? 'actif ✓' : 'registré mais inactif'; }),
          new Promise(function(res) { setTimeout(function() { res('timeout 2s'); }, 2000); })
        ]);
      } catch(er) { ctxReady = 'erreur : ' + er.message; }

      _setSection('ios-ctx',
        _check('Mode PWA (standalone)',     ctxPwa  ? 'ok'    : 'error',  ctxPwa   ? 'Oui — requis pour Push iOS' : '⚠ Non — push iOS impossibles hors PWA installée')
        + _check('SW contrôle la page',    ctxCtrl ? 'ok'    : 'warn',   ctxCtrl  ? 'Oui (controller actif)' : 'Non — recharger après installation SW')
        + _check('SW ready state',         ctxReady.includes('actif') ? 'ok' : 'warn', ctxReady)
        + _check('API Notification',       ctxNotif ? 'ok'   : 'error',  ctxNotif  ? 'Disponible' : 'Indisponible — iOS < 16.4 ou hors PWA')
        + _check('API PushManager',        ctxPush  ? 'ok'   : 'error',  ctxPush   ? 'Disponible' : 'Indisponible — iOS < 16.4 ou hors PWA')
        + _check('Firebase Messaging',     ctxMsg   ? 'ok'   : 'error',  ctxMsg    ? 'Initialisé (MX.messaging)' : '⚠ null — getToken() impossible')
        + _check('Clé VAPID',              ctxVapid ? 'ok'   : 'error',  ctxVapid  ? ((window.MX.VAPID_KEY || '').slice(0, 14) + '… (' + (window.MX.VAPID_KEY || '').length + ' chars)') : 'Absente ou invalide')
        + _check('Permission actuelle',    ctxPerm === 'granted' ? 'ok' : ctxPerm === 'denied' ? 'error' : 'warn', ctxPerm)
      );

      _log('Contexte iOS — PWA:' + ctxPwa + ' SWctrl:' + ctxCtrl + ' SWready:' + ctxReady + ' Notif:' + ctxNotif + ' Push:' + ctxPush + ' Msg:' + ctxMsg + ' VAPID:' + ctxVapid + ' perm:' + ctxPerm);
      if (!ctxPwa)   _log('⛔ App NON en mode standalone — Web Push iOS nécessite une PWA installée depuis Safari', 'error');
      if (!ctxCtrl)  _log('⚠ SW ne contrôle pas encore la page (controller=null) — rechargez après 1ère install', 'warn');
      if (!ctxMsg)   _log('⛔ MX.messaging=null — getToken() échouera', 'error');
      if (!ctxVapid) _log('⛔ Clé VAPID absente — getToken() échouera', 'error');
    } catch(e) { _log('Erreur Contexte iOS : ' + e.message, 'error'); }

    // ── 2. Notifications ──
    try {
      var notifSupported = 'Notification' in window;
      var perm = notifSupported ? Notification.permission : 'unsupported';
      var permState = perm === 'granted' ? 'ok' : perm === 'denied' ? 'error' : 'warn';
      var hasBadge = 'setAppBadge' in navigator;
      var hasVibrate = 'vibrate' in navigator;
      var hasPush = 'PushManager' in window;

      _diagData.notif = { supported: notifSupported, permission: perm, badge: hasBadge, vibration: hasVibrate, push: hasPush };

      _log('Notification.permission = "' + perm + '"');
      _setSection('notif', _buildNotifSection(perm, hasBadge, hasVibrate, hasPush, notifSupported));

      _log('PushAPI : ' + (hasPush ? 'oui' : 'non') + ' | Badge : ' + (hasBadge ? 'oui' : 'non'));
      if (perm === 'denied')  _log('⛔ Notifications bloquées — Réglages iPhone → Notifications → Maintix', 'error');
      if (perm === 'default') _log('⚠ Permission jamais demandée — cliquez "Demander l\'autorisation"', 'warn');
      if (!notifSupported)    _log('⛔ API Notification indisponible dans ce contexte', 'error');
    } catch(e) { _log('Erreur section Notifications : ' + e.message, 'error'); }

    // ── 3. Service Worker ──
    var _swReg = null;
    try {
      if (!('serviceWorker' in navigator)) {
        _setSection('sw', _check('Service Worker', 'error', 'Non supporté dans ce navigateur'));
        _log('⚠ Service Worker non supporté', 'error');
      } else {
        _swReg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!_swReg) {
          _setSection('sw',
            _check('Enregistré', 'error', 'Aucun SW sur /sw.js')
            + _check('Actif', 'error', 'Non')
            + _check('Scope', 'idle', '—')
            + _check('Version (cache)', 'idle', '—')
          );
          _log('⚠ Aucun Service Worker enregistré sur /sw.js', 'error');
        } else {
          var swActive = !!_swReg.active;
          var swState = _swReg.active ? _swReg.active.state : (_swReg.installing ? 'installing' : (_swReg.waiting ? 'waiting' : 'absent'));
          var swScope = _swReg.scope || '—';

          // Get cache version
          var cacheVer = '—';
          try {
            var cacheKeys = await caches.keys();
            var mxCache = cacheKeys.find(function(k) { return k.startsWith('maintix-'); });
            cacheVer = mxCache || '—';
          } catch(_) {}

          _diagData.sw = { registered: true, active: swActive, scope: swScope, state: swState, cache: cacheVer };

          _setSection('sw',
            _check('Enregistré', 'ok', 'Oui')
            + _check('Actif', swActive ? 'ok' : 'warn', swActive ? 'Oui' : 'Non — état : ' + swState)
            + _check('Scope', 'ok', swScope)
            + _check('Cache actif', cacheVer !== '—' ? 'ok' : 'warn', cacheVer)
            + (_swReg.waiting ? _check('En attente', 'warn', 'Un SW est en waiting — SKIP_WAITING nécessaire') : '')
          );

          _log('SW : enregistré | actif : ' + swActive + ' | scope : ' + swScope + ' | cache : ' + cacheVer);
          if (!swActive) _log('⚠ SW non actif — état : ' + swState, 'warn');
        }
      }
    } catch(e) {
      _setSection('sw', _check('Service Worker', 'error', e.message));
      _log('Erreur SW : ' + e.message, 'error');
    }

    // ── 4. Firebase ──
    try {
      var fbLoaded = typeof firebase !== 'undefined';
      var fbApp = fbLoaded && firebase.apps && firebase.apps.length > 0;
      var fbAuth = fbLoaded && typeof firebase.auth !== 'undefined';
      var fbStore = fbLoaded && typeof firebase.firestore !== 'undefined';
      var fbMsg = fbLoaded && typeof firebase.messaging !== 'undefined';
      var mxMsg = !!(window.MX && window.MX.messaging);

      _diagData.firebase = { loaded: fbLoaded, appInit: fbApp, auth: fbAuth, firestore: fbStore, messagingSDK: fbMsg, messagingInit: mxMsg };

      _setSection('firebase',
        _check('SDK chargé', fbLoaded ? 'ok' : 'error', fbLoaded ? 'Oui' : 'Non')
        + _check('App initialisée', fbApp ? 'ok' : 'error', fbApp ? 'Oui (' + firebase.apps.length + ' app)' : 'Non')
        + _check('Auth', fbAuth ? 'ok' : 'warn', fbAuth ? 'Disponible' : 'Non disponible')
        + _check('Firestore', fbStore ? 'ok' : 'error', fbStore ? 'Disponible' : 'Non disponible')
        + _check('Messaging SDK', fbMsg ? 'ok' : 'warn', fbMsg ? 'Disponible' : 'Non disponible (iOS < 16.4?)')
        + _check('Messaging initialisé', mxMsg ? 'ok' : 'warn', mxMsg ? 'Oui — MX.messaging actif' : 'Non — null')
      );

      _log('Firebase : SDK=' + (fbLoaded ? 'oui' : 'non') + ' | app=' + (fbApp ? 'oui' : 'non') + ' | messaging=' + (mxMsg ? 'oui' : 'non'));
      if (!mxMsg) _log('⚠ MX.messaging est null — FCM non disponible sur cette plateforme', 'warn');
    } catch(e) {
      _setSection('firebase', _check('Firebase', 'error', e.message));
      _log('Erreur Firebase : ' + e.message, 'error');
    }

    // ── 5. Token FCM ──
    await _fetchToken(_swReg);

    // ── 6. Firestore ──
    var _fsToken = _diagData.token && _diagData.token.value;
    try {
      if (!_fsToken) {
        _setSection('firestore', _check('Vérification', 'idle', 'Pas de token — ignoré'));
        _log('Firestore : vérification ignorée (pas de token)');
      } else {
        _log('Vérification token dans Firestore…');
        var t1 = Date.now();
        var snap = await firebase.firestore().collection('fcmTokens').doc(_fsToken).get();
        var latency = Date.now() - t1;
        _log('Firestore répondu en ' + latency + ' ms');

        if (snap.exists) {
          var d = snap.data();
          var createdAt = d.ts && d.ts.toDate ? d.ts.toDate().toLocaleString('fr-FR') : (d.ts || '—');
          _diagData.firestore = { exists: true, data: d };
          _setSection('firestore',
            _check('Document existant', 'ok', 'fcmTokens/{token}')
            + _check('Utilisateur (uid)', 'ok', d.userName || '—')
            + _check('Plateforme', 'ok', d.platform || '—')
            + _check('Device (UA abrégé)', 'idle', (navigator.userAgent || '').slice(0, 40) + '…')
            + _check('createdAt / updatedAt', 'ok', createdAt)
            + _check('Latence Firestore', latency < 500 ? 'ok' : 'warn', latency + ' ms')
          );
          _log('✅ Token dans Firestore — user: ' + (d.userName || '—') + ' | platform: ' + (d.platform || '—'));
        } else {
          _diagData.firestore = { exists: false };
          _setSection('firestore',
            _check('Document existant', 'error', 'Token absent de fcmTokens')
            + _check('Latence Firestore', latency < 500 ? 'ok' : 'warn', latency + ' ms')
          );
          _log('⚠ Token non présent dans Firestore', 'warn');
        }
      }
    } catch(e) {
      _setSection('firestore', _check('Firestore', 'error', e.message));
      _log('Erreur Firestore : ' + e.message, 'error');
    }

    // ── 7. Cloud Functions ──
    try {
      _log('Test connectivité Cloud Functions…');
      var cf_t0 = Date.now();
      var cfSnap = await firebase.firestore().collection('fcmTokens').get();
      var cf_lat = Date.now() - cf_t0;
      var cfCount = cfSnap.size;

      _diagData.cf = { reachable: true, tokenCount: cfCount, latency: cf_lat };

      var cfTokensState = cfCount > 0 ? 'ok' : 'warn';
      _setSection('cf',
        _check('Firestore accessible', 'ok', 'Oui — ' + cf_lat + ' ms')
        + _check('Tokens enregistrés', cfTokensState, cfCount + ' token(s) dans fcmTokens')
        + _check('onNewMission', 'idle', 'CF existante — à vérifier : Firebase Console → Functions')
        + _check('slotReminders', 'idle', 'CF existante — à vérifier : Firebase Console → Functions')
        + _check('Région', 'ok', 'europe-west1')
        + _check('Déploiement', 'warn', 'Exécuter : firebase deploy --only functions')
      );

      _log('Cloud Functions : Firestore accessible en ' + cf_lat + ' ms | ' + cfCount + ' token(s)');
      if (cfCount === 0) _log('⚠ Aucun token FCM enregistré — les CF n\'enverront rien', 'warn');
    } catch(e) {
      _diagData.cf = { reachable: false, error: e.message };
      _setSection('cf', _check('Cloud Functions', 'error', e.message));
      _log('Erreur Cloud Functions : ' + e.message, 'error');
    }

    // ── 8. Debug iOS ──
    try {
      var dbgPerm  = 'Notification' in window ? Notification.permission : 'API indisponible';
      var dbgCtrl  = navigator.serviceWorker
        ? (navigator.serviceWorker.controller ? 'Actif (contrôle la page)' : 'null — page non contrôlée')
        : 'SW non supporté';
      var dbgSw    = _swReg
        ? (_swReg.active ? 'actif — ' + _swReg.active.state : (_swReg.waiting ? 'waiting' : (_swReg.installing ? 'installing' : 'absent')))
        : 'aucune registration';
      var dbgPush  = 'PushManager' in window ? 'Disponible' : 'Non disponible';
      var dbgMsg   = window.MX && window.MX.messaging ? 'Initialisé' : 'null';
      var dbgGetT  = window.MX && window.MX.messaging && typeof window.MX.messaging.getToken === 'function' ? 'Oui' : 'Non';
      var dbgVapid = window.MX && window.MX.VAPID_KEY
        ? (window.MX.VAPID_KEY.length + ' chars — ' + window.MX.VAPID_KEY.slice(0, 16) + '…')
        : 'Absent';
      var dbgCached = window._fcmToken ? ('Oui — ' + window._fcmToken.slice(0, 20) + '…') : 'Absent';
      var dbgMode   = (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches) ? 'standalone' : 'browser';

      _setSection('debug',
        _check('Notification.permission',  dbgPerm === 'granted' ? 'ok' : dbgPerm === 'denied' ? 'error' : 'warn', dbgPerm)
        + _check('SW controller',          navigator.serviceWorker && navigator.serviceWorker.controller ? 'ok' : 'warn', dbgCtrl)
        + _check('SW state',               _swReg && _swReg.active ? 'ok' : 'warn', dbgSw)
        + _check('PushManager',            'PushManager' in window ? 'ok' : 'error', dbgPush)
        + _check('Firebase Messaging',     window.MX && window.MX.messaging ? 'ok' : 'error', dbgMsg)
        + _check('getToken() disponible',  dbgGetT === 'Oui' ? 'ok' : 'error', dbgGetT)
        + _check('Clé VAPID',              window.MX && window.MX.VAPID_KEY ? 'ok' : 'error', dbgVapid)
        + _check('Token FCM (cache)',       window._fcmToken ? 'ok' : 'idle', dbgCached)
        + _check('Mode d\'affichage',      dbgMode === 'standalone' ? 'ok' : 'warn', dbgMode)
      );
      _log('Debug — perm:' + dbgPerm + ' ctrl:' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'oui' : 'non') + ' sw:' + dbgSw + ' msg:' + dbgMsg + ' getToken:' + dbgGetT + ' vapid:' + (window.MX && window.MX.VAPID_KEY ? 'oui' : 'non') + ' mode:' + dbgMode);
    } catch(e) { _log('Erreur Debug : ' + e.message, 'error'); }

    // ── Summary ──
    _log('');
    _log('── Diagnostic terminé ──');
    var hasCritical = !_diagData.token || !_diagData.token.value;
    if (hasCritical) {
      _log('⛔ Token FCM non obtenu — vérifier APNs dans Firebase Console et permission notifications', 'error');
    } else if (_diagData.notif && _diagData.notif.permission !== 'granted') {
      _log('⚠ Permission notifications non accordée', 'warn');
    } else {
      _log('✅ Diagnostic OK — chaîne push opérationnelle côté client', 'ok');
    }

    _running = false;
  }

  // ── Test buttons ──

  function _testLocal() {
    _log('Test notification locale…');
    if (window.MX && window.MX.Notifs && window.MX.Notifs.push) {
      MX.Notifs.push({ title: 'Test diagnostic', description: 'Notification locale — canal MX.Notifs.push().', type: 'system', level: 'info' });
      _log('✅ Notification locale envoyée via MX.Notifs.push()');
    } else {
      _log('⚠ MX.Notifs.push non disponible', 'error');
    }
  }

  function _testSystem() {
    _log('Test notification système…');
    if (!('Notification' in window)) { _log('⚠ API Notification indisponible', 'error'); return; }
    if (Notification.permission !== 'granted') {
      _log('⚠ Permission requise. Demande en cours…', 'warn');
      Notification.requestPermission().then(function(p) {
        _log('Permission : ' + p);
        if (p === 'granted') _testSystem();
      });
      return;
    }
    navigator.serviceWorker.getRegistration('/sw.js').then(function(reg) {
      var opts = {
        body:    'Notification système via Service Worker — diagnostic push.',
        icon:    '/assets/icons/icon-192.png',
        badge:   '/assets/icons/icon-192.png',
        vibrate: [200, 100, 200],
        tag:     'mx-diag-sys-' + Date.now(),
        data:    { url: '/?page=ios-diag', type: 'system', level: 'info' },
      };
      if (reg && reg.active) {
        reg.showNotification('Maintix — Test système', opts);
        _log('✅ Notification système envoyée via SW.showNotification()');
      } else {
        new Notification('Maintix — Test système', { body: opts.body, icon: opts.icon });
        _log('✅ Notification système envoyée (sans SW)');
      }
    }).catch(function(e) { _log('Erreur notification système : ' + e.message, 'error'); });
  }

  async function _testFCM() {
    _log('Test notification FCM — création d\'une mission test…');
    if (!firebase || !firebase.firestore) { _log('⚠ Firestore non disponible', 'error'); return; }
    try {
      var ref = await firebase.firestore().collection('missions').add({
        text:        '[Test Diagnostic Push]',
        assignedTo:  'all',
        createdBy:   'diagnostic',
        status:      'test',
        priority:    'info',
        _diag:       true,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });
      _log('✅ Mission test créée (' + ref.id + ') — onNewMission CF devrait se déclencher');
      _log('Si les Cloud Functions sont déployées et APNs configuré, une notification FCM arrivera dans quelques secondes.');
      // Auto-delete after 5s
      setTimeout(function() {
        ref.delete().then(function() {
          _log('Mission test supprimée (' + ref.id + ')');
        }).catch(function(e) { _log('Erreur suppression mission test : ' + e.message, 'error'); });
      }, 5000);
    } catch(e) {
      _log('Erreur création mission test : ' + e.message, 'error');
    }
  }

  async function _recreateToken() {
    _log('Recréation du token FCM…');
    var msg = window.MX && window.MX.messaging;
    var vk  = window.MX && window.MX.VAPID_KEY;
    if (!msg || !vk) { _log('⚠ FCM non disponible', 'error'); return; }
    try {
      if (window._fcmToken) {
        _log('Suppression de l\'ancien token dans Firestore…');
        await firebase.firestore().collection('fcmTokens').doc(window._fcmToken).delete();
        try { await msg.deleteToken(); } catch(_) {}
        window._fcmToken = null;
        _log('Ancien token supprimé');
      }
      var reg = null;
      try { reg = await navigator.serviceWorker.getRegistration('/sw.js'); } catch(_) {}
      var newToken = await msg.getToken({ vapidKey: vk, serviceWorkerRegistration: reg || undefined });
      if (newToken) {
        window._fcmToken = newToken;
        var ua3 = navigator.userAgent;
        var pl2 = /iphone|ipad|ipod/i.test(ua3) ? 'ios' : /android/i.test(ua3) ? 'android' : 'desktop';
        var cu = window.MX && window.MX.state && window.MX.state.currentUser;
        var uname = cu ? (cu.name || '') : 'admin';
        if (window.MX && window.MX.DB && window.MX.DB.saveFcmToken) {
          await MX.DB.saveFcmToken(newToken, uname, pl2);
        }
        _log('✅ Nouveau token FCM : ' + newToken.slice(0, 20) + '…');
        var el = document.getElementById('iosd-token-val');
        if (el) el.textContent = newToken;
      } else {
        _log('⚠ getToken() a retourné null', 'warn');
      }
    } catch(e) { _log('Erreur recréation token : ' + e.message, 'error'); }
  }

  async function _reregisterSW() {
    _log('Réenregistrement du Service Worker…');
    if (!('serviceWorker' in navigator)) { _log('⚠ Service Worker non supporté', 'error'); return; }
    try {
      var reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (reg) {
        await reg.unregister();
        _log('SW désenregistré');
      }
      var newReg = await navigator.serviceWorker.register('/sw.js');
      _log('✅ SW réenregistré — scope : ' + (newReg.scope || ''));
      setTimeout(_runDiag, 1500);
    } catch(e) { _log('Erreur réenregistrement SW : ' + e.message, 'error'); }
  }

  // ── Builder HTML section Notifications (réutilisé par _runDiag + _onPermResult) ──
  function _buildNotifSection(perm, hasBadge, hasVibrate, hasPush, notifSup) {
    var permState = perm === 'granted' ? 'ok' : perm === 'denied' ? 'error' : 'warn';
    var permExtra = '';
    if (perm !== 'granted') {
      permExtra += '<button class="iosd-btn iosd-btn-primary iosd-btn-sm" style="margin-top:8px" onclick="MX.Pages.IosDiag._requestPermission()">'
        + '<i class="fas fa-bell"></i> Demander l\'autorisation</button>';
    }
    if (perm === 'denied') {
      permExtra += '<div class="iosd-perm-guide iosd-perm-guide--error">'
        + '<i class="fas fa-circle-exclamation"></i> '
        + 'Permission refusée. Réactiver dans :<br>'
        + '<b>Réglages iPhone → Notifications → Maintix → Autoriser les notifications</b>'
        + '</div>';
    }
    if (perm === 'default') {
      permExtra += '<div class="iosd-perm-guide iosd-perm-guide--warn">'
        + '<i class="fas fa-triangle-exclamation"></i> '
        + 'La boîte de dialogue système ne s\'est pas affichée.<br>'
        + 'Causes possibles : app non en mode standalone · SW non contrôleur · geste non reconnu par iOS.'
        + '</div>';
    }
    return _check('Notification.permission', permState, perm)
      + _check('Permission accordée', perm === 'granted' ? 'ok' : 'error', perm === 'granted' ? 'Oui' : 'Non', permExtra)
      + _check('Badge API',    hasBadge   ? 'ok' : 'warn', hasBadge   ? 'Disponible' : 'Non disponible')
      + _check('Vibration API', hasVibrate ? 'ok' : 'idle', hasVibrate ? 'Disponible' : 'Non disponible')
      + _check('Push API',     hasPush    ? 'ok' : 'error', hasPush    ? 'Disponible' : 'Non disponible')
      + (!notifSup ? _check('API Notification', 'error', 'Non supportée dans ce contexte') : '');
  }

  // ── Callback après résolution de requestPermission() ──
  function _onPermResult(perm) {
    _log('Notification.permission APRÈS : ' + (('Notification' in window) ? Notification.permission : 'indisponible'));
    if (_diagData.notif) _diagData.notif.permission = perm;
    _setSection('notif', _buildNotifSection(perm, 'setAppBadge' in navigator, 'vibrate' in navigator, 'PushManager' in window, 'Notification' in window));

    if (perm === 'granted') {
      _log('✅ Permission accordée — lancement de _fetchToken()…');
      _fetchToken(null);
    } else if (perm === 'denied') {
      _log('⛔ Permission refusée — Réglages iPhone → Notifications → Maintix → Autoriser', 'error');
    } else {
      _log('⚠ Permission "default" — la boîte de dialogue iOS ne s\'est pas affichée', 'warn');
      _log('Vérifiez : mode standalone (PWA installée) · SW controller actif · iOS ≥ 16.4', 'warn');
    }
  }

  // ── Demande de permission : NON-async, appel DIRECT à requestPermission() ──
  function _requestPermission() {
    _log('── Demande d\'autorisation ──');
    _log('Notification.permission AVANT : ' + (('Notification' in window) ? Notification.permission : 'API indisponible'));

    if (!('Notification' in window)) {
      _log('⛔ API Notification indisponible dans ce contexte', 'error');
      _onPermResult('unsupported');
      return;
    }

    _log('Appel direct : Notification.requestPermission() …');
    var p;
    try {
      // APPEL DIRECT — aucun await ni async avant cette ligne
      p = Notification.requestPermission();
    } catch (syncErr) {
      _log('⛔ Exception synchrone lors de requestPermission() : ' + syncErr.message, 'error');
      return;
    }

    if (!p || typeof p.then !== 'function') {
      // API callback (ancienne) — résultat immédiat
      _log('API callback détectée — Notification.permission = ' + Notification.permission, 'warn');
      _onPermResult(Notification.permission);
      return;
    }

    p.then(function (perm) {
      _log('Résultat : ' + perm);
      _onPermResult(perm);
    }).catch(function (e) {
      _log('⛔ Promise requestPermission() rejetée : ' + e.message, 'error');
      _log('Notification.permission APRÈS erreur : ' + Notification.permission);
    });
  }

  // ── Helper : obtenir et afficher le token FCM ──
  async function _fetchToken(swReg) {
    var msg = window.MX && window.MX.messaging;
    var vk  = window.MX && window.MX.VAPID_KEY;
    var token = null;

    try {
      if (window._fcmToken) {
        token = window._fcmToken;
        _log('Token FCM (cache) : ' + token.slice(0, 20) + '…');
      } else if (msg && vk) {
        _log('Demande de token FCM…');
        var reg = swReg;
        if (!reg) { try { reg = await navigator.serviceWorker.getRegistration('/sw.js'); } catch(_) {} }
        token = await msg.getToken({ vapidKey: vk, serviceWorkerRegistration: reg || undefined });
        if (token) {
          window._fcmToken = token;
          window._fcmTokenTs = new Date().toLocaleString('fr-FR');
          _log('✅ Token FCM obtenu : ' + token.slice(0, 20) + '… (' + token.length + ' chars)');
        } else {
          _log('⚠ getToken() a retourné null — APNs non configuré dans Firebase Console?', 'warn');
        }
      } else if (!msg) {
        _log('⛔ FCM non disponible (MX.messaging=null) — initialisez Firebase Messaging avant d\'appeler getToken()', 'error');
      } else {
        _log('⛔ Clé VAPID absente (MX.VAPID_KEY vide) — nécessaire pour getToken()', 'error');
      }

      var ua = navigator.userAgent;
      var pl = /iphone|ipad|ipod/i.test(ua) ? 'ios' : /android/i.test(ua) ? 'android' : 'desktop';
      _diagData.token = { value: token, platform: pl, ts: window._fcmTokenTs || null };

      _setSection('token',
        _check('Token obtenu',   token ? 'ok' : 'error', token ? token.slice(0, 28) + '…' : 'Aucun')
        + _check('Longueur',     token ? 'ok' : 'idle',  token ? token.length + ' caractères' : '—')
        + _check('Généré le',    token && window._fcmTokenTs ? 'ok' : 'idle', window._fcmTokenTs || '—')
        + _check('Plateforme',   'ok', pl)
      );

      if (token) {
        var tokenCard = document.getElementById('iosd-card-token');
        if (tokenCard) {
          tokenCard.querySelector('.iosd-check-list').insertAdjacentHTML('beforeend',
            '<div class="iosd-token-box">'
            + '<div class="iosd-token-label">Token FCM complet</div>'
            + '<div class="iosd-token-val" id="iosd-token-val">' + token + '</div>'
            + '<div class="iosd-token-actions">'
            + '<button class="iosd-log-btn" onclick="MX.Pages.IosDiag._copyToken()" title="Copier le token"><i class="fas fa-copy"></i> Copier</button>'
            + '</div>'
            + '</div>'
          );
        }
      }
    } catch(e) {
      _setSection('token', _check('Token FCM', 'error', e.message));
      _log('Erreur token FCM : ' + e.message, 'error');
    }
    return token;
  }

  function _refresh() {
    if (_running) return;
    var logEl = document.getElementById('iosd-log');
    if (logEl) logEl.innerHTML = '';
    _logs = [];
    _diagData = {};
    CHECK_SECTIONS.forEach(function(s) {
      var el = document.getElementById('iosd-card-' + s.id);
      if (el) {
        el.classList.add('iosd-card--loading');
        el.querySelector('.iosd-check-list').innerHTML = '<div class="iosd-check-loading">Analyse en cours…</div>';
      }
    });
    setTimeout(_runDiag, 80);
  }

  // ── Token copy ──
  function _copyToken() {
    var el = document.getElementById('iosd-token-val');
    var val = el ? el.textContent : (window._fcmToken || '');
    if (val) {
      navigator.clipboard.writeText(val).then(function() {
        _log('Token FCM copié dans le presse-papiers');
        MX.toast && MX.toast('Token copié ✓');
      }).catch(function(e) { _log('Erreur copie : ' + e.message, 'error'); });
    }
  }

  // ── Export ──
  function _copyLogs() {
    var txt = _logs.map(function(l) { return '[' + l.ts + '] ' + l.msg; }).join('\n');
    navigator.clipboard.writeText(txt).then(function() {
      _log('Logs copiés dans le presse-papiers');
      MX.toast && MX.toast('Logs copiés ✓');
    }).catch(function(e) { _log('Erreur copie : ' + e.message, 'error'); });
  }

  function _exportJSON() {
    var data = {
      exportedAt: new Date().toISOString(),
      diagnostic: _diagData,
      logs: _logs,
    };
    _download('maintix-diag-' + Date.now() + '.json', JSON.stringify(data, null, 2), 'application/json');
    _log('Export JSON téléchargé');
  }

  function _exportTXT() {
    var lines = [
      'Maintix — Diagnostic Push',
      'Exporté le : ' + new Date().toLocaleString('fr-FR'),
      '',
      '── Données ──',
      JSON.stringify(_diagData, null, 2),
      '',
      '── Journal ──',
    ].concat(_logs.map(function(l) { return '[' + l.ts + '] ' + l.msg; }));
    _download('maintix-diag-' + Date.now() + '.txt', lines.join('\n'), 'text/plain');
    _log('Export TXT téléchargé');
  }

  function _download(filename, content, mime) {
    var a = document.createElement('a');
    a.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content);
    a.download = filename;
    a.click();
  }

  // ── Export public API ──
  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.IosDiag = {
    render:              render,
    _requestPermission:  _requestPermission,
    _onPermResult:       _onPermResult,
    _buildNotifSection:  _buildNotifSection,
    _fetchToken:         _fetchToken,
    _testLocal:          _testLocal,
    _testSystem:        _testSystem,
    _testFCM:           _testFCM,
    _recreateToken:     _recreateToken,
    _reregisterSW:      _reregisterSW,
    _refresh:           _refresh,
    _copyToken:         _copyToken,
    _copyLogs:          _copyLogs,
    _exportJSON:        _exportJSON,
    _exportTXT:         _exportTXT,
  };
})();
