import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { enableIndexedDbPersistence, getFirestore } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyClASfNWa6TVGtA1naCW5-AwPo6FdqS2OE',
  authDomain: 'budget-app-6b928.firebaseapp.com',
  projectId: 'budget-app-6b928',
  storageBucket: 'budget-app-6b928.firebasestorage.app',
  messagingSenderId: '185609122187',
  appId: '1:185609122187:web:3bcbb6d5877f857b22ff8e',
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

enableIndexedDbPersistence(db).catch(error => {
  if (error.code !== 'failed-precondition' && error.code !== 'unimplemented') {
    console.warn('Offline persistence недоступна:', error);
  }
});
