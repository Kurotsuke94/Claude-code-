const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC1GlZHiIpUf8dpWBn3WKFGu59zP11xxq8",
  authDomain:        "maintix-c9dbd.firebaseapp.com",
  projectId:         "maintix-c9dbd",
  storageBucket:     "maintix-c9dbd.firebasestorage.app",
  messagingSenderId: "98524288307",
  appId:             "1:98524288307:web:681d2df0c7ac216caf9a46",
  measurementId:     "G-JBX99DHW9N"
};

firebase.initializeApp(FIREBASE_CONFIG);

const db   = firebase.firestore();
const auth = firebase.auth();

// Connexion anonyme Firebase Auth — nécessaire car les techniciens et
// responsables s'authentifient uniquement par PIN Firestore (jamais via
// Firebase Auth). Sans ceci, request.auth est TOUJOURS null pour eux côté
// règles Firestore, qui ne peuvent alors plus distinguer "session app" de
// "requête anonyme sur Internet" sans ouvrir complètement l'écriture.
// Cette connexion anonyme ne donne AUCUN droit admin : voir isAdmin() dans
// firestore.rules, qui exclut explicitement le provider "anonymous".
auth.onAuthStateChanged(function(user) {
  if (!user) {
    auth.signInAnonymously().catch(function(e) {
      console.error('[Auth] Échec de la connexion anonyme Firebase :', e);
    });
  }
});

// Storage — guarded init (fails silently if SDK not loaded on some iOS/browsers)
let storage = null;
try {
  if (typeof firebase.storage !== 'undefined') storage = firebase.storage();
} catch(e) { console.warn('Storage init:', e); }

// Initialise le namespace global avant tous les autres scripts
window.MX = window.MX || {};

// FCM Messaging
const VAPID_KEY = "BBeBP8S8P2V4TrJmyz2wV1NgYLIW4qj1IQRCHR53NJuObX7FMKzXyjo_1pfLUlRBbF9u1Uh6HycddmgnGHUbudM";
let messaging = null;
try {
  if (typeof firebase.messaging !== 'undefined' && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
    messaging = firebase.messaging();
    console.log('[FCM] Messaging SDK initialisé');
  } else {
    console.log('[FCM] firebase.messaging non disponible sur cette plateforme');
  }
} catch(e) { console.warn('[FCM] Erreur init messaging :', e); }
window.MX.VAPID_KEY = VAPID_KEY;
window.MX.messaging = messaging;

// Handler foreground (app ouverte) — délégué à MX.Notifs.push quand disponible
if (messaging) {
  messaging.onMessage(function(payload) {
    console.log('[FCM] Message foreground reçu :', payload);
    var n = payload.notification || {};
    var d = payload.data || {};
    if (window.MX && window.MX.Notifs && window.MX.Notifs.push) {
      window.MX.Notifs.push({
        title:       n.title || 'Maintix',
        description: n.body  || d.description || '',
        type:        d.type  || 'system',
        level:       d.level || 'info',
        url:         d.url   || '',
      });
    }
  });
}
window.MX.state = {
  adminUser:     null,
  currentPage:   null,
  weekLabel:     "",
  weekNum:       1,
  tasks:         {},
  checks:        {},
  assignments:   {},
  teams:         { matin: [], journee: [], soir: [] },
  products:      [],
  messages:      [],
  alerts:        {},
  users:         [],
  logs:          [],
  transfers:     [],
  missions:      [],
  respTasks:     [],
  announcements: [],
  orders:        [],
  absences:      [],
  planningUrl:   null,
  notes:         {},
  history:       [],
  currentUser:   JSON.parse(localStorage.getItem("mx_user") || "null"),
  rewardsRules:  [],
  rewardsGrades: [],
  rewardsItems:  [],
  rewardsHistory:[],
  rewardsUsers:  {},
  dailyClaims:        {},
  csoAlerts:          [],
  todayDateStr:       new Date().toISOString().slice(0, 10),
  todayPlanSuggestions: {}
};
