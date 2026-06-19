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
  }
} catch(e) { console.warn('FCM not supported:', e); }
window.MX.VAPID_KEY = VAPID_KEY;
window.MX.messaging = messaging;
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
  planningUrl:   null,
  notes:         {},
  history:       [],
  currentUser:   JSON.parse(localStorage.getItem("mx_user") || "null")
};
