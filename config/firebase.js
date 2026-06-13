import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBgOzPPOegNPV3EQ-3dcN0ydSVIeE1Kr44",
  authDomain: "project-feed-github.firebaseapp.com",
  projectId: "project-feed-github",
  storageBucket: "project-feed-github.firebasestorage.app",
  messagingSenderId: "375549586123",
  appId: "1:375549586123:web:a0c0b3070f16cb473f894e",
  measurementId: "G-F5HZYGDZF4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
