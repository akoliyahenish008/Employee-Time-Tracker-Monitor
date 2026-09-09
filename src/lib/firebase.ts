import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  Auth,
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  deleteDoc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { AppUser, PendingSignup, StorageSettings, ScreenshotLog } from '../types';

let auth: Auth | null = null;
let db: Firestore | null = null;
let provider: GoogleAuthProvider | null = null;

try {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  provider.setCustomParameters({ prompt: 'select_account' });
} catch (e) {
  console.warn('Firebase initialization notice:', e);
}

export { auth, db };

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Test server connection to Firestore as mandated by skill
export async function testFirestoreConnection() {
  if (!db) return false;
  try {
    await getDocFromServer(doc(db, 'settings', 'storage'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or pending connection.');
    }
    return false;
  }
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (!auth) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (!auth || !provider) {
    throw new Error('Google Authentication is not configured or initialized.');
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google access token with requested scopes.');
    }

    cachedAccessToken = credential.accessToken;
    // Persist to session storage so refresh retains Google Sheets/Drive connectivity
    try {
      sessionStorage.setItem('wm_google_access_token', cachedAccessToken);
    } catch {}

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    try {
      cachedAccessToken = sessionStorage.getItem('wm_google_access_token');
    } catch {}
  }
  return cachedAccessToken;
};

export const setCachedToken = (token: string) => {
  cachedAccessToken = token;
  try {
    sessionStorage.setItem('wm_google_access_token', token);
  } catch {}
};

export const logoutGoogle = async () => {
  if (auth) {
    await signOut(auth);
  }
  cachedAccessToken = null;
  try {
    sessionStorage.removeItem('wm_google_access_token');
  } catch {}
};

// ==========================================
// REAL-TIME FIRESTORE DATA SYNC HELPERS
// Enables shared links where employees register,
// admin gets real-time alerts, logs sync to Sheets & Drive
// ==========================================

export function subscribeToUsers(callback: (users: AppUser[]) => void) {
  if (!db) return () => {};
  const q = collection(db, 'users');
  return onSnapshot(q, (snapshot) => {
    const users: AppUser[] = [];
    snapshot.forEach((docSnap) => {
      users.push(docSnap.data() as AppUser);
    });
    callback(users);
  }, (err) => {
    console.warn('Users sync note:', err.message);
  });
}

export async function syncUserToFirestore(user: AppUser) {
  if (!db) return;
  try {
    await setDoc(doc(db, 'users', user.id), user, { merge: true });
  } catch (e) {
    console.warn('Failed to sync user to Firestore:', e);
  }
}

export function subscribeToPendingSignups(callback: (signups: PendingSignup[]) => void) {
  if (!db) return () => {};
  const q = collection(db, 'pendingSignups');
  return onSnapshot(q, (snapshot) => {
    const list: PendingSignup[] = [];
    snapshot.forEach((docSnap) => {
      list.push(docSnap.data() as PendingSignup);
    });
    callback(list);
  }, (err) => {
    console.warn('Pending signups sync note:', err.message);
  });
}

export async function addPendingSignupToFirestore(signup: PendingSignup) {
  if (!db) return;
  try {
    await setDoc(doc(db, 'pendingSignups', signup.id), signup);
  } catch (e) {
    console.warn('Failed to add pending signup to Firestore:', e);
  }
}

export async function removePendingSignupFromFirestore(signupId: string) {
  if (!db) return;
  try {
    await deleteDoc(doc(db, 'pendingSignups', signupId));
  } catch (e) {
    console.warn('Failed to remove pending signup:', e);
  }
}

export function subscribeToStorageSettings(callback: (settings: StorageSettings) => void) {
  if (!db) return () => {};
  const ref = doc(db, 'settings', 'storage');
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as StorageSettings);
    }
  }, (err) => {
    console.warn('Storage settings sync note:', err.message);
  });
}

export async function saveStorageSettingsToFirestore(settings: StorageSettings) {
  if (!db) return;
  try {
    await setDoc(doc(db, 'settings', 'storage'), settings, { merge: true });
  } catch (e) {
    console.warn('Failed to save storage settings to Firestore:', e);
  }
}

export function subscribeToScreenshots(callback: (screenshots: ScreenshotLog[]) => void) {
  if (!db) return () => {};
  const q = query(collection(db, 'screenshots'), orderBy('timestamp', 'desc'), limit(100));
  return onSnapshot(q, (snapshot) => {
    const list: ScreenshotLog[] = [];
    snapshot.forEach((docSnap) => {
      list.push(docSnap.data() as ScreenshotLog);
    });
    callback(list);
  }, (err) => {
    console.warn('Screenshots sync note:', err.message);
  });
}

export async function logScreenshotToFirestore(screen: ScreenshotLog) {
  if (!db) return;
  try {
    // Only store thumbnail/preview if small, plus Google Drive links
    const record = { ...screen };
    // If previewDataUrl is heavy base64, keep it clipped for database efficiency while Drive has the full raw image
    if (record.previewDataUrl && record.previewDataUrl.length > 50000) {
      record.previewDataUrl = record.previewDataUrl.slice(0, 50000);
    }
    await setDoc(doc(db, 'screenshots', screen.id), record);
  } catch (e) {
    console.warn('Failed to log screenshot to Firestore:', e);
  }
}
