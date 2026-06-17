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

// Initialise le namespace global avant tous les autres scripts
window.MX = window.MX || {};
window.MX.state = {
  adminUser:   null,
  currentPage: null,
  weekLabel:   "",
  weekNum:     1,
  tasks:       {},
  checks:      {},
  assignments: {},
  teams:       { matin: [], journee: [], soir: [] },
  products:    [],
  messages:    [],
  alerts:      {}
};
