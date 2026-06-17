// ── FIREBASE CONFIGURATION ──
// Replace these values with your Firebase project credentials.
// Get them from: https://console.firebase.google.com
// Project Settings → Your apps → Web app → SDK setup and configuration

const FIREBASE_CONFIG = {
  apiKey:            "VOTRE_API_KEY",
  authDomain:        "VOTRE_PROJECT_ID.firebaseapp.com",
  projectId:         "VOTRE_PROJECT_ID",
  storageBucket:     "VOTRE_PROJECT_ID.appspot.com",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId:             "VOTRE_APP_ID"
};

firebase.initializeApp(FIREBASE_CONFIG);

const db      = firebase.firestore();
const auth    = firebase.auth();
const storage = firebase.storage();
