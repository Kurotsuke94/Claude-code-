importScripts('/version.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyC1GlZHiIpUf8dpWBn3WKFGu59zP11xxq8",
  authDomain:        "maintix-c9dbd.firebaseapp.com",
  projectId:         "maintix-c9dbd",
  storageBucket:     "maintix-c9dbd.firebasestorage.app",
  messagingSenderId: "98524288307",
  appId:             "1:98524288307:web:681d2df0c7ac216caf9a46"
});

const _msg = firebase.messaging();

_msg.onBackgroundMessage(payload => {
  const notif = payload.notification || {};
  const data  = payload.data || {};
  const level = data.level || 'info';
  const type  = data.type  || 'system';

  const vibrateProfiles = {
    critical:  [400, 100, 400, 100, 400],
    important: [200, 100, 200],
    warning:   [150],
    info:      [100],
    success:   [80, 60, 80],
  };

  const targetUrl = (payload.fcmOptions && payload.fcmOptions.link) || data.url || '/';

  self.registration.showNotification(notif.title || 'Maintix', {
    body:    notif.body || data.description || '',
    icon:    '/assets/icons/icon-192.png',
    badge:   '/assets/icons/icon-192.png',
    vibrate: vibrateProfiles[level] || [200, 100, 200],
    tag:     type + '_' + (data.key || Date.now()),
    renotify: false,
    actions: [
      { action: 'view',  title: 'Voir' },
      { action: 'later', title: 'Plus tard' },
    ],
    data: { url: targetUrl, type, level }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'later') return; // dismissed
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if (c.url === url && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});

// ── VERSION — source unique : version.js ──
const CACHE = "maintix-" + MX_VERSION;
const V     = "?v=" + MX_BUILD;

// ── APP SHELL — tous les assets chargés par index.html ──
const SHELL = [
  "/",
  "/index.html",
  "/version.js",
  "/manifest.json",
  "/browserconfig.xml",
  "/favicon.ico",
  "/assets/icons/maintix-logo.png",
  "/assets/icons/icon-72.png",
  "/assets/icons/icon-96.png",
  "/assets/icons/icon-128.png",
  "/assets/icons/icon-144.png",
  "/assets/icons/icon-152.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-192-maskable.png",
  "/assets/icons/icon-256.png",
  "/assets/icons/icon-384.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-512-maskable.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/icons/favicon-16.png",
  "/assets/icons/favicon-32.png",
  "/assets/icons/favicon-48.png",
  "/assets/fontawesome/css/all.min.css",
  "/assets/fontawesome/webfonts/fa-solid-900.woff2",
  "/assets/fontawesome/webfonts/fa-regular-400.woff2",
  "/assets/fontawesome/webfonts/fa-brands-400.woff2",
  "/assets/fontawesome/webfonts/fa-v4compatibility.woff2",
  "/assets/css/variables.css"  + V,
  "/assets/css/main.css"       + V,
  "/assets/css/components.css" + V,
  "/assets/js/firebase-config.js"            + V,
  "/assets/js/utils/helpers.js"              + V,
  "/assets/js/utils/uuid.js"                 + V,
  "/assets/js/db.js"                         + V,
  "/assets/js/auth.js"                       + V,
  "/assets/js/widgets/task-row.js"           + V,
  "/assets/js/widgets/user-badge.js"         + V,
  "/assets/js/widgets/progress-widget.js"    + V,
  "/assets/js/widgets/slot-card.js"          + V,
  "/assets/js/widgets/global-search.js"      + V,
  "/assets/js/pages/home.js"                 + V,
  "/assets/js/pages/checklist.js"            + V,
  "/assets/js/pages/mes-missions.js"         + V,
  "/assets/js/pages/messages.js"             + V,
  "/assets/js/pages/orders.js"               + V,
  "/assets/js/pages/admin.js"                + V,
  "/assets/js/pages/org-resp.js"             + V,
  "/assets/js/pages/badges.js"               + V,
  "/assets/js/pages/planning.js"             + V,
  "/assets/js/pages/settings.js"             + V,
  "/assets/js/pages/bible.js"                + V,
  "/assets/js/pages/consommations.js"        + V,
  "/assets/js/pages/interventions.js"        + V,
  "/assets/js/pages/notifications.js"        + V,
  "/assets/js/pages/equipe.js"               + V,
  "/assets/js/pages/pmp.js"                  + V,
  "/assets/js/alerts-engine.js"              + V,
  "/assets/js/app.js"                        + V,
];

// Firebase domains — never intercept, let Firebase SDK handle
const BYPASS = [
  "firebaseio.com",
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "emailjs.com",
  "fonts.gstatic.com",
  "fcm.googleapis.com"
];

// ── INSTALL — préchargement du shell complet ──
self.addEventListener("install", e => {
  console.log("[PWA] install — Maintix v" + MX_VERSION + " build " + MX_BUILD + " — cache: " + CACHE);
  e.waitUntil(
    caches.open(CACHE)
      .then(c => {
        console.log("[PWA] install — caching " + SHELL.length + " SHELL assets…");
        return c.addAll(SHELL);
      })
      .then(() => {
        console.log("[PWA] install complete — new SW installed and waiting for activation signal");
        // skipWaiting() not called here — app sends SKIP_WAITING when user approves the update
      })
  );
});

// ── MESSAGE — SKIP_WAITING déclenché par l'app au clic 'Mettre à jour' ──
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    console.log("[PWA] SKIP_WAITING received — activating new SW immediately");
    self.skipWaiting();
  }
});

// ── ACTIVATE — nettoyage des anciens caches + rechargement automatique ──
self.addEventListener("activate", e => {
  console.log("[PWA] activate — Maintix v" + MX_VERSION + " — keeping cache: " + CACHE);
  e.waitUntil(
    caches.keys()
      .then(keys => {
        const old = keys.filter(k => k !== CACHE);
        if (old.length) console.log("[PWA] activate — deleting old caches:", old);
        return Promise.all(old.map(k => caches.delete(k)));
      })
      .then(() => {
        console.log("[PWA] activate — claiming all clients");
        return self.clients.claim();
      })
      .then(() => self.clients.matchAll({ type: "window" }).then(list => {
        console.log("[PWA] activate — notifying " + list.length + " window client(s)");
        list.forEach(client => client.postMessage({ type: "SW_UPDATED", version: MX_VERSION, build: MX_BUILD }));
      }))
  );
});

// ── FETCH — stratégie hybride ──
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (e.request.method !== "GET") return;
  if (BYPASS.some(d => url.hostname.includes(d))) return;

  // Navigation (HTML) — Network First → fallback index.html offline
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Icônes, logos, images — Cache First (actifs statiques, changent rarement)
  if (/\.(png|jpg|jpeg|webp|svg|ico|gif)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Polices (woff2, woff, ttf) — Cache First (jamais modifiées en release)
  if (/\.(woff2?|ttf|eot|otf)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // JS et CSS versionnés — Network First (toujours le code le plus récent)
  // Couvre : checklist, missions, planning, alertes, utilisateurs, org-resp, etc.
  if (/\.(js|css)(\?v=|$)/.test(url.href)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Tout le reste — Cache First avec fallback réseau
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
