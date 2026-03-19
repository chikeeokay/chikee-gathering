import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

let isSigningIn = false;

export const signInWithGoogle = async () => {
  if (isSigningIn) {
    console.warn("Sign-in already in progress");
    return;
  }
  
  isSigningIn = true;
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    // Re-throw to let the UI handle specific errors like popup-blocked
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
  }
};
