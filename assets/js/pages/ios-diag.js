(function () {
  'use strict';

  // ── iOS Push Diagnostic Page ──

  var _mc, _checks = [], _running = false;

  var CHECK_IDS = [
    'platform', 'ios-version', 'pwa', 'permission',
    'sw', 'fcm-init', 'fcm-token', 'firestore', 'apns', 'cf'
  ];

  function render() {
    _mc = document.getElementById('main-content');
    if (!_mc) return;
    _mc.innerHTML = _buildShell();
    setTimeout(_runDiag, 100);
  }

  function _buildShell() {
    var rows = CHECK_IDS.map(function(id) {
      return '<div class="iosd-row" id="iosd-' + id + '">'
        + '<span class="iosd-status iosd-pending"><i class="fas fa-circle-notch fa-spin"></i></span>'
        + '<span class="iosd-label">' + _label(id) + '</span>'
        + '<span class="iosd-detail" id="iosd-detail-' + id + '">—</span>'
        + '</div>';
    }).join('');

    return '<div class="iosd-wrap">'
      + '<div class="iosd-header">'
      + '<i class="fas fa-stethoscope iosd-header-icon"></i>'
      + '<div>'
      + '<div class="iosd-title">Diagnostic Push</div>'
      + '<div class="iosd-subtitle">Vérification complète de la chaîne de notifications</div>'
      + '</div>'
      + '</div>'
      + '<div class="iosd-card" id="iosd-checklist">' + rows + '</div>'
      + '<div class="iosd-actions">'
      + '<button class="iosd-btn iosd-btn-primary" id="iosd-btn-refresh" onclick="MX.Pages.IosDiag._refresh()">'
      + '<i class="fas fa-rotate-right"></i> Relancer le diagnostic</button>'
      + '<button class="iosd-btn iosd-btn-secondary" id="iosd-btn-inapp" onclick="MX.Pages.IosDiag._testInApp()">'
      + '<i class="fas fa-bell"></i> Tester in-app</button>'
      + '<button class="iosd-btn iosd-btn-secondary" id="iosd-btn-system" onclick="MX.Pages.IosDiag._testSystem()">'
      + '<i class="fas fa-mobile-screen"></i> Tester système</button>'
      + '</div>'
      + '<div class="iosd-log-wrap">'
      + '<div class="iosd-log-title"><i class="fas fa-terminal"></i> Journal</div>'
      + '<div class="iosd-log" id="iosd-log"></div>'
      + '</div>'
      + '<div class="iosd-guide" id="iosd-guide"></div>'
      + '</div>';
  }

  function _label(id) {
    var map = {
      'platform':    'Plateforme',
      'ios-version': 'Version iOS',
      'pwa':         'PWA installée',
      'permission':  'Permission notifications',
      'sw':          'Service Worker actif',
      'fcm-init':    'FCM initialisé',
      'fcm-token':   'Token FCM obtenu',
      'firestore':   'Token dans Firestore',
      'apns':        'APNs (push système)',
      'cf':          'Cloud Functions déployées',
    };
    return map[id] || id;
  }

  // ── Status helpers ──

  function _setStatus(id, state, detail) {
    var row = document.getElementById('iosd-' + id);
    var det = document.getElementById('iosd-detail-' + id);
    if (!row || !det) return;
    var icons = {
      ok:      '<i class="fas fa-circle-check"></i>',
      warn:    '<i class="fas fa-triangle-exclamation"></i>',
      error:   '<i class="fas fa-circle-xmark"></i>',
      info:    '<i class="fas fa-circle-info"></i>',
      pending: '<i class="fas fa-circle-notch fa-spin"></i>',
    };
    row.querySelector('.iosd-status').className = 'iosd-status iosd-' + state;
    row.querySelector('.iosd-status').innerHTML = icons[state] || icons.info;
    det.textContent = detail || '';
  }

  function _log(msg) {
    var el = document.getElementById('iosd-log');
    if (!el) return;
    var ts = new Date().toLocaleTimeString('fr-FR');
    var line = document.createElement('div');
    line.className = 'iosd-log-line';
    line.textContent = '[' + ts + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // ── Main diagnostic runner ──

  async function _runDiag() {
    if (_running) return;
    _running = true;
    _checks = [];

    var log = _log;

    // Reset all to pending
    CHECK_IDS.forEach(function(id) { _setStatus(id, 'pending', '—'); });
    var guide = document.getElementById('iosd-guide');
    if (guide) guide.innerHTML = '';

    log('Démarrage du diagnostic…');

    // ── 1. Platform ──
    var ua = navigator.userAgent;
    var isIOS = /iphone|ipad|ipod/i.test(ua);
    var isAndroid = /android/i.test(ua);
    var platform = isIOS ? 'iOS' : isAndroid ? 'Android' : 'Desktop/Autre';
    _setStatus('platform', 'info', platform);
    log('Plateforme : ' + platform);
    _checks.push({ id: 'platform', ok: true, value: platform });

    // ── 2. iOS version ──
    if (isIOS) {
      var match = ua.match(/OS (\d+)[_.](\d+)/);
      if (match) {
        var major = parseInt(match[1], 10);
        var minor = parseInt(match[2], 10);
        var verStr = major + '.' + minor;
        var needed = major > 16 || (major === 16 && minor >= 4);
        if (needed) {
          _setStatus('ios-version', 'ok', 'iOS ' + verStr + ' (Web Push supporté)');
          log('iOS ' + verStr + ' — Web Push supporté (≥ 16.4)');
        } else {
          _setStatus('ios-version', 'error', 'iOS ' + verStr + ' — iOS 16.4+ requis');
          log('⚠ iOS ' + verStr + ' trop ancien. iOS 16.4 minimum pour Web Push.');
        }
        _checks.push({ id: 'ios-version', ok: needed, value: verStr });
      } else {
        _setStatus('ios-version', 'warn', 'Version iOS non détectée');
        log('Version iOS non parseable dans le user-agent');
        _checks.push({ id: 'ios-version', ok: false, value: null });
      }
    } else {
      _setStatus('ios-version', 'info', 'Non applicable (' + platform + ')');
      _checks.push({ id: 'ios-version', ok: true, value: null });
    }

    // ── 3. PWA installée ──
    var isStandalone = window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches;
    if (isIOS && !isStandalone) {
      _setStatus('pwa', 'error', 'Ouvert dans Safari (non installé)');
      log('⚠ iOS — PWA non installée. Web Push iOS requiert "Ajouter à l\'écran d\'accueil".');
      _checks.push({ id: 'pwa', ok: false });
    } else if (isStandalone) {
      _setStatus('pwa', 'ok', 'PWA installée (standalone)');
      log('PWA installée en mode standalone');
      _checks.push({ id: 'pwa', ok: true });
    } else {
      _setStatus('pwa', 'info', 'Non applicable (desktop/Android)');
      _checks.push({ id: 'pwa', ok: true });
    }

    // ── 4. Permission notifications ──
    if (!('Notification' in window)) {
      _setStatus('permission', 'error', 'API Notification non disponible');
      log('⚠ API Notification absente dans ce contexte');
      _checks.push({ id: 'permission', ok: false });
    } else {
      var perm = Notification.permission;
      if (perm === 'granted') {
        _setStatus('permission', 'ok', 'Autorisées');
        log('Permissions notifications : granted');
        _checks.push({ id: 'permission', ok: true });
      } else if (perm === 'denied') {
        _setStatus('permission', 'error', 'Bloquées par l\'utilisateur');
        log('⚠ Notifications bloquées. Réinitialiser dans Réglages Safari / Chrome.');
        _checks.push({ id: 'permission', ok: false });
      } else {
        _setStatus('permission', 'warn', 'Non demandées (default)');
        log('Permissions en attente — appuyer sur "Activer" dans Paramètres Notifications');
        _checks.push({ id: 'permission', ok: false });
        var reqBtn = document.getElementById('iosd-btn-inapp');
        if (reqBtn) reqBtn.textContent = 'Demander la permission';
      }
    }

    // ── 5. Service Worker ──
    if (!('serviceWorker' in navigator)) {
      _setStatus('sw', 'error', 'Service Worker non supporté');
      log('⚠ Service Worker non disponible dans ce navigateur');
      _checks.push({ id: 'sw', ok: false });
    } else {
      try {
        var reg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (reg && reg.active) {
          var swState = reg.active.state;
          _setStatus('sw', 'ok', 'Actif — ' + (reg.scope || '') + ' [' + swState + ']');
          log('Service Worker actif — scope: ' + reg.scope + ' — state: ' + swState);
          _checks.push({ id: 'sw', ok: true, reg: reg });
        } else if (reg && reg.installing) {
          _setStatus('sw', 'warn', 'En cours d\'installation');
          log('Service Worker en cours d\'installation — recharger la page');
          _checks.push({ id: 'sw', ok: false });
        } else if (reg && reg.waiting) {
          _setStatus('sw', 'warn', 'En attente d\'activation (waiting)');
          log('Service Worker en attente. L\'ancien SW est peut-être encore actif.');
          _checks.push({ id: 'sw', ok: false });
        } else {
          _setStatus('sw', 'error', 'Service Worker absent');
          log('⚠ Aucun Service Worker enregistré sur /sw.js');
          _checks.push({ id: 'sw', ok: false });
        }
      } catch(swErr) {
        _setStatus('sw', 'error', 'Erreur: ' + swErr.message);
        log('⚠ Erreur vérification SW: ' + swErr.message);
        _checks.push({ id: 'sw', ok: false });
      }
    }

    // ── 6. FCM initialisé ──
    var messaging = window.MX && window.MX.messaging;
    if (messaging) {
      _setStatus('fcm-init', 'ok', 'FCM messaging initialisé');
      log('FCM messaging SDK initialisé');
      _checks.push({ id: 'fcm-init', ok: true });
    } else {
      _setStatus('fcm-init', 'warn', 'FCM non initialisé (plateforme non supportée?)');
      log('⚠ window.MX.messaging est null — FCM non disponible sur cette plateforme');
      _checks.push({ id: 'fcm-init', ok: false });
    }

    // ── 7. Token FCM ──
    var vapidKey = window.MX && window.MX.VAPID_KEY;
    var existingToken = window._fcmToken;
    if (existingToken) {
      _setStatus('fcm-token', 'ok', existingToken.slice(0, 20) + '…');
      log('Token FCM existant (cache) : ' + existingToken.slice(0, 20) + '…');
      _checks.push({ id: 'fcm-token', ok: true, token: existingToken });
    } else if (messaging && vapidKey) {
      try {
        log('Demande d\'un token FCM…');
        var swReg = null;
        if ('serviceWorker' in navigator) {
          swReg = await navigator.serviceWorker.getRegistration('/sw.js');
        }
        var token = await messaging.getToken({ vapidKey: vapidKey, serviceWorkerRegistration: swReg });
        if (token) {
          window._fcmToken = token;
          _setStatus('fcm-token', 'ok', token.slice(0, 20) + '…');
          log('✅ Token FCM obtenu : ' + token.slice(0, 20) + '…');
          _checks.push({ id: 'fcm-token', ok: true, token: token });
        } else {
          _setStatus('fcm-token', 'error', 'getToken() retourné null');
          log('⚠ getToken() a retourné null — vérifier APNs (iOS) ou permission');
          _checks.push({ id: 'fcm-token', ok: false });
        }
      } catch(tkErr) {
        var errMsg = tkErr.code ? tkErr.code + ' ' + tkErr.message : tkErr.message;
        _setStatus('fcm-token', 'error', errMsg);
        log('⚠ Erreur getToken : ' + errMsg);
        _checks.push({ id: 'fcm-token', ok: false, err: tkErr });
      }
    } else {
      _setStatus('fcm-token', 'error', 'FCM non disponible ou VAPID manquant');
      log('⚠ Impossible de demander un token : FCM non disponible');
      _checks.push({ id: 'fcm-token', ok: false });
    }

    // ── 8. Firestore ──
    var tokenCheck = _checks.find(function(c) { return c.id === 'fcm-token'; });
    var currentToken = tokenCheck && tokenCheck.token;
    if (currentToken && window.MX && window.MX.DB) {
      try {
        log('Vérification du token dans Firestore…');
        var snap = await firebase.firestore().collection('fcmTokens').doc(currentToken).get();
        if (snap.exists) {
          var d = snap.data();
          var ts = d.ts && d.ts.toDate ? d.ts.toDate().toLocaleString('fr-FR') : '?';
          _setStatus('firestore', 'ok', 'Enregistré — ' + (d.platform || '?') + ' — ' + ts);
          log('✅ Token présent dans Firestore — plateforme: ' + (d.platform || '?') + ', ts: ' + ts);
          _checks.push({ id: 'firestore', ok: true });
        } else {
          _setStatus('firestore', 'warn', 'Token absent de Firestore');
          log('⚠ Token obtenu mais pas encore dans Firestore — sauvegarde en cours…');
          var cu = window.MX && window.MX.currentUser;
          if (cu && MX.DB.saveFcmToken) {
            var pl2 = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
            await MX.DB.saveFcmToken(currentToken, cu.name || cu, pl2);
            _setStatus('firestore', 'ok', 'Enregistré maintenant');
            log('✅ Token sauvegardé dans Firestore');
          }
          _checks.push({ id: 'firestore', ok: false });
        }
      } catch(fsErr) {
        _setStatus('firestore', 'error', fsErr.message);
        log('⚠ Erreur Firestore: ' + fsErr.message);
        _checks.push({ id: 'firestore', ok: false });
      }
    } else if (!currentToken) {
      _setStatus('firestore', 'info', 'Pas de token — vérification ignorée');
      _checks.push({ id: 'firestore', ok: false });
    } else {
      _setStatus('firestore', 'warn', 'MX.DB non disponible');
      _checks.push({ id: 'firestore', ok: false });
    }

    // ── 9. APNs (inferred) ──
    if (isIOS) {
      var tokenOk = _checks.find(function(c) { return c.id === 'fcm-token'; });
      if (tokenOk && tokenOk.ok) {
        _setStatus('apns', 'ok', 'Inféré OK (token iOS obtenu → APNs configuré)');
        log('APNs inféré OK — un token FCM iOS valide implique APNs configuré');
        _checks.push({ id: 'apns', ok: true });
      } else {
        var tkErr2 = tokenOk && tokenOk.err;
        var isApnsErr = tkErr2 && (
          (tkErr2.code && tkErr2.code.includes('messaging/')) ||
          (tkErr2.message && tkErr2.message.toLowerCase().includes('apns'))
        );
        if (isApnsErr) {
          _setStatus('apns', 'error', 'Erreur APNs probable');
          log('⚠ Erreur FCM token liée à APNs — voir guide ci-dessous');
        } else {
          _setStatus('apns', 'warn', 'Non vérifiable (token non obtenu)');
          log('APNs : non vérifiable directement — voir Firebase Console');
        }
        _checks.push({ id: 'apns', ok: false });
        _showApnsGuide();
      }
    } else {
      _setStatus('apns', 'info', 'Non applicable (' + platform + ')');
      log('APNs : non applicable sur ' + platform);
      _checks.push({ id: 'apns', ok: true });
    }

    // ── 10. Cloud Functions ──
    try {
      log('Vérification Cloud Functions (ping Firestore)…');
      var cfSnap = await firebase.firestore().collection('fcmTokens').limit(1).get();
      _setStatus('cf', 'ok', 'Firestore accessible — CF déployées (à confirmer Firebase Console)');
      log('Firestore accessible. Cloud Functions onNewMission + slotReminders existent dans le code.');
      _checks.push({ id: 'cf', ok: true });
    } catch(cfErr) {
      _setStatus('cf', 'error', cfErr.message);
      log('⚠ Firestore inaccessible — ' + cfErr.message);
      _checks.push({ id: 'cf', ok: false });
    }

    // ── Summary ──
    var failed = _checks.filter(function(c) { return !c.ok; });
    var blocking = ['permission', 'sw', 'fcm-token'];
    var hasBlocking = failed.some(function(c) { return blocking.indexOf(c.id) >= 0; });
    if (hasBlocking) {
      log('');
      log('⛔ Des problèmes bloquants ont été détectés. Voir les lignes marquées en rouge.');
    } else if (failed.length) {
      log('');
      log('⚠ Diagnostic terminé avec avertissements. Les notifications peuvent fonctionner partiellement.');
    } else {
      log('');
      log('✅ Tous les checks OK — les notifications push devraient fonctionner.');
    }

    _running = false;
  }

  function _showApnsGuide() {
    var guide = document.getElementById('iosd-guide');
    if (!guide) return;
    guide.innerHTML = '<div class="iosd-guide-inner">'
      + '<div class="iosd-guide-title"><i class="fas fa-apple"></i> Configuration APNs requise</div>'
      + '<p class="iosd-guide-intro">Les push iOS nécessitent une clé APNs (.p8) configurée dans Firebase Console. Voici les étapes exactes :</p>'
      + '<ol class="iosd-guide-steps">'
      + '<li><strong>Apple Developer Console</strong><br>'
      + 'Aller sur <code>developer.apple.com</code> → Certificates, IDs &amp; Profiles → Keys → (+)<br>'
      + 'Cocher <em>Apple Push Notifications service (APNs)</em> → Continue → Register<br>'
      + 'Télécharger le fichier <code>.p8</code> <em>(une seule chance !)</em> — noter le <strong>Key ID</strong></li>'
      + '<li><strong>Identifiants nécessaires</strong><br>'
      + '• <strong>Key ID</strong> : 10 caractères alphanumériques (ex: ABC1234DEF)<br>'
      + '• <strong>Team ID</strong> : sur developer.apple.com → Account → Membership Details<br>'
      + '• <strong>Bundle ID</strong> : App ID de l\'app (ex: com.maintix.app)<br>'
      + '• <strong>Fichier .p8</strong> : téléchargé à l\'étape précédente</li>'
      + '<li><strong>Firebase Console</strong><br>'
      + 'Aller sur <code>console.firebase.google.com</code> → projet <strong>maintix-c9dbd</strong><br>'
      + 'Project Settings → Cloud Messaging → Apple app configuration<br>'
      + 'Uploader le <code>.p8</code> → entrer Key ID, Team ID, Bundle ID → Save</li>'
      + '<li><strong>Déploiement Cloud Functions</strong><br>'
      + '<code>firebase deploy --only functions --project maintix-c9dbd</code><br>'
      + 'Les fonctions <code>onNewMission</code> et <code>slotReminders</code> sont déjà codées.</li>'
      + '</ol>'
      + '<div class="iosd-guide-note"><i class="fas fa-circle-info"></i> '
      + 'Sans clé APNs dans Firebase, getToken() retourne null sur iOS même si tout le reste est correct.</div>'
      + '</div>';
  }

  // ── Test buttons ──

  function _testInApp() {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission().then(function(p) {
          if (p === 'granted') _runDiag();
        });
        return;
      }
    }
    if (window.MX && window.MX.Notifs && window.MX.Notifs.push) {
      MX.Notifs.push({
        title:       'Maintix — Test diagnostic',
        description: 'Notification in-app générée par le diagnostic push.',
        type:        'system',
        level:       'info',
      });
      _log('✅ Notification in-app envoyée');
    } else {
      _log('⚠ MX.Notifs.push non disponible');
    }
  }

  function _testSystem() {
    if (!('Notification' in window)) {
      _log('⚠ API Notification non disponible');
      return;
    }
    if (Notification.permission !== 'granted') {
      _log('⚠ Permission requise — cliquer "Tester in-app" pour demander la permission');
      return;
    }
    navigator.serviceWorker.getRegistration('/sw.js').then(function(reg) {
      if (reg) {
        reg.showNotification('Maintix — Test système', {
          body:    'Notification système générée par le diagnostic push.',
          icon:    '/assets/icons/icon-192.png',
          badge:   '/assets/icons/icon-192.png',
          vibrate: [200, 100, 200],
          tag:     'mx-diag-test-' + Date.now(),
          data:    { url: '/?page=ios-diag', type: 'system', level: 'info' },
        });
        _log('✅ Notification système envoyée via Service Worker');
      } else {
        new Notification('Maintix — Test système', {
          body: 'Notification système générée par le diagnostic push.',
          icon: '/assets/icons/icon-192.png',
        });
        _log('✅ Notification système envoyée (sans SW)');
      }
    }).catch(function(e) {
      _log('⚠ Erreur notification système : ' + e.message);
    });
  }

  function _refresh() {
    if (_running) return;
    var log = document.getElementById('iosd-log');
    if (log) log.innerHTML = '';
    CHECK_IDS.forEach(function(id) { _setStatus(id, 'pending', '—'); });
    var guide = document.getElementById('iosd-guide');
    if (guide) guide.innerHTML = '';
    setTimeout(_runDiag, 100);
  }

  window.MX = window.MX || {};
  window.MX.Pages = window.MX.Pages || {};
  window.MX.Pages.IosDiag = { render: render, _testInApp: _testInApp, _testSystem: _testSystem, _refresh: _refresh };
})();
