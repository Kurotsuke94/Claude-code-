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

// ── ENVIRONNEMENT LOCAL — connexion aux émulateurs Firebase ──
// Actif UNIQUEMENT quand l'app est servie depuis localhost/127.0.0.1 —
// jamais le domaine réel de production (maintix-c9dbd.web.app ou domaine
// personnalisé), qui ne tourne jamais sur ce hostname. Permet de
// développer/tester MX en local (firebase emulators:start) sans jamais
// toucher au projet Firebase réel : aucune lecture, aucune écriture,
// aucune connexion ne peut atteindre maintix-c9dbd depuis ce mode.
// DOIT être appelé ICI, avant tout autre appel aux SDK Firestore/Auth
// (setPersistence, signInAnonymously ci-dessous, tout listener db.js) —
// c'est une exigence du SDK Firebase lui-même pour useEmulator().
// Fonctionne avec `firebase emulators:start` (émulateurs déclarés dans
// firebase.json : firestore:8090, auth:9099, functions:5002) ou avec
// l'ancien harnais de tests (tests/mock-firebase.js) qui redéfinit déjà
// entièrement `firebase`/`db`/`auth` avant ce fichier — ce bloc ne
// s'applique alors qu'au VRAI SDK Firebase, jamais au mock.
const MX_LOCAL_DEV = (typeof location !== 'undefined')
  && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
if (MX_LOCAL_DEV) {
  try {
    db.useEmulator('127.0.0.1', 8090);
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    console.log('[DEV] Émulateurs Firebase locaux connectés (Firestore :8090, Auth :9099) — PAS la production maintix-c9dbd.');
  } catch (e) {
    console.warn('[DEV] Échec de connexion aux émulateurs locaux :', e);
  }
}

// Persistance SESSION (et non LOCAL, le défaut) : Maintix tourne sur des
// postes potentiellement partagés (tablette/PC commun aux techniciens).
// Une session Firebase Admin survit ainsi à un F5 (même onglet/navigateur)
// mais est supprimée à la fermeture complète du navigateur — l'admin doit
// se reconnecter à la prochaine ouverture. S'applique à toute l'instance
// auth, y compris la connexion anonyme ci-dessous (sans conséquence : elle
// est automatiquement recréée au boot si absente, voir onAuthStateChanged
// juste en dessous, et aucun code ne dépend d'un UID anonyme stable).
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(function(e) {
  console.warn('[Auth] setPersistence(SESSION) a échoué :', e);
});

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
  if (typeof firebase.storage !== 'undefined') {
    storage = firebase.storage();
    // Redirection vers l'émulateur Storage local, UNIQUEMENT si useEmulator()
    // existe réellement sur cet objet — c'est le cas du vrai SDK Firebase,
    // jamais du harnais de test tests/mock-firebase.js (son storageFn() ne
    // définit volontairement que ref()/refFromURL(), aucune E/S réseau
    // réelle n'étant simulée là — voir son propre commentaire "zéro E/S
    // réseau"). Sans cette distinction, appeler une méthode absente sur le
    // mock aurait levé une erreur interceptée ci-dessous et mis storage à
    // null, cassant silencieusement tous les tests d'upload existants
    // (tests/accueil_cockpit_test.js, bannière d'accueil) alors qu'ils ne
    // risquent déjà aucune écriture réelle.
    if (MX_LOCAL_DEV && typeof storage.useEmulator === 'function') {
      // Si la redirection échoue malgré tout (émulateur non démarré, SDK
      // incomplet), storage repasse à null plutôt que de rester pointé vers
      // le vrai bucket maintix-c9dbd.firebasestorage.app : chaque fonction
      // d'upload (db.js:uploadMessageImage/uploadPlanningImage/
      // uploadHeroBanner) vérifie déjà `if (!storage) throw new Error(...)`
      // avant d'écrire — aucun chemin d'upload ne peut donc jamais
      // atteindre la production en mode local si l'émulateur Storage n'est
      // pas réellement actif.
      try {
        storage.useEmulator('127.0.0.1', 9199);
        console.log('[DEV] Émulateur Storage local connecté (:9199) — PAS la production.');
      } catch (e) {
        console.warn('[DEV] Émulateur Storage indisponible — uploads désactivés en local (aucun repli vers la production) :', e);
        storage = null;
      }
    }
  }
} catch(e) { console.warn('Storage init:', e); }

// Cloud Functions — région EXPLICITE (europe-west1, voir functions/index.js
// REGION) : firebase.functions() sans région cible us-central1 par défaut,
// où aucune fonction n'est déployée pour ce projet. Utilisée par
// MX.Auth.confirmPin() (assets/js/auth.js) pour l'appel serveur verifyPin —
// seule source fiable de vérification PIN/rôle (jamais une comparaison de
// hash côté client).
let cloudFunctions = null;
try {
  if (typeof firebase.app === 'function') {
    cloudFunctions = firebase.app().functions('europe-west1');
    if (MX_LOCAL_DEV) cloudFunctions.useEmulator('127.0.0.1', 5002);
  }
} catch(e) { console.warn('[Functions] init:', e); }

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
window.MX.Functions = cloudFunctions;

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
  stockChecks:        [],
  todayDateStr:       new Date().toISOString().slice(0, 10),
  todayPlanSuggestions: {}
};
