const CACHE  = "maintix-v1";
const SHELL  = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/css/variables.css",
  "/assets/css/main.css",
  "/assets/css/components.css",
  "/assets/js/firebase-config.js",
  "/assets/js/utils/helpers.js",
  "/assets/js/utils/uuid.js",
  "/assets/js/db.js",
  "/assets/js/auth.js",
  "/assets/js/pages/home.js",
  "/assets/js/pages/checklist.js",
  "/assets/js/pages/messages.js",
  "/assets/js/pages/orders.js",
  "/assets/js/pages/admin.js",
  "/assets/js/app.js"
];

// Firebase domains — never intercept, let Firebase SDK handle
const BYPASS = [
  "firebaseio.com",
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "emailjs.com",
  "fonts.gstatic.com"
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

  // App shell — cache first
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
