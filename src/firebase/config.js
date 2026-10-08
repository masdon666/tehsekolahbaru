import { initializeApp } from '@firebase/app';
import { getAuth } from '@firebase/auth';
import { getFirestore } from '@firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.appId &&
    firebaseConfig.messagingSenderId,
);

let app = null;
let auth = null;
let db = null;
let firebaseConfigError = '';

if (hasFirebaseConfig) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    app = null;
    auth = null;
    db = null;
    firebaseConfigError = 'Firebase gagal diinisialisasi. Periksa konfigurasi aplikasi.';
  }
}

export { auth, db, firebaseConfigError };
export const isFirebaseConfigured = Boolean(auth && db);
export const configuredBusinessId = import.meta.env.VITE_BUSINESS_ID || '';
