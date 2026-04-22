// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth"; // 1. Import Auth

const firebaseConfig = {
  apiKey: "AIzaSyBLnkfNDo7h4OGCfbAixw8KPNQUQqFK3HM",
  authDomain: "focusflow-2675c.firebaseapp.com",
  databaseURL: "https://focusflow-2675c-default-rtdb.firebaseio.com",
  projectId: "focusflow-2675c",
  storageBucket: "focusflow-2675c.firebasestorage.app",
  messagingSenderId: "417068401313",
  appId: "1:417068401313:web:e9c6bb6e38e594ff3ce6e0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// 2. Initialize Realtime Database and Auth
export const db = getDatabase(app);
export const auth = getAuth(app); // 3. Export Auth so App.js can use it