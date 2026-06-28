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
  self.registration.showNotification(notif.title || 'Maintix', {
    body:  notif.body  || '',
    icon:  '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    vibrate: [200, 100, 200],
    data:  { url: (payload.fcmOptions && payload.fcmOptions.link) || '/' }
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if (c.url === url && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});

const CACHE  = "maintix-v77";
const SHELL  = [
  "/",
  "/index.html",
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
  "/assets/css/variables.css",
  "/assets/css/variables.css?v=77",
  "/assets/css/main.css",
  "/assets/css/main.css?v=77",
  "/assets/css/components.css",
  "/assets/css/components.css?v=77",
  "/assets/fontawesome/css/all.min.css",
  "/assets/fontawesome/webfonts/fa-solid-900.woff2",
  "/assets/fontawesome/webfonts/fa-regular-400.woff2",
  "/assets/fontawesome/webfonts/fa-brands-400.woff2",
  "/assets/fontawesome/webfonts/fa-v4compatibility.woff2",
  "/assets/js/firebase-config.js",
  "/assets/js/utils/helpers.js",
  "/assets/js/utils/uuid.js",
  "/assets/js/db.js",
  "/assets/js/auth.js",
  "/assets/js/widgets/task-row.js",
  "/assets/js/widgets/user-badge.js",
  "/assets/js/widgets/progress-widget.js",
  "/assets/js/widgets/slot-card.js",
  "/assets/js/widgets/global-search.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/checklist.js",
  "/assets/js/pages/messages.js",
  "/assets/js/pages/orders.js",
  "/assets/js/pages/admin.js",
  "/assets/js/pages/resp-planning.js",
  "/assets/js/pages/badges.js",
  "/assets/js/pages/planning.js",
  "/assets/js/pages/settings.js",
  "/assets/js/pages/bible.js",
  "/assets/js/pages/consommations.js",
  "/assets/js/pages/interventions.js",
  "/assets/js/app.js"
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

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Skip non-http(s) schemes (chrome-extension://, data:, etc.)
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  // Skip non-GET and bypass domains
  if (e.request.method !== "GET") return;
  if (BYPASS.some(d => url.hostname.includes(d))) return;

  // Navigation requests — network first, fallback to cached index
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Versioned JS/CSS — network first (always get fresh code), cache as offline fallback
  if (/\.(js|css)\?v=/.test(url.href)) {
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

  // App shell (icons, fonts, etc.) — cache first
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
