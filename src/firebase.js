import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

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

// Initialize Realtime Database and Auth
export const db = getDatabase(app);
export const auth = getAuth(app);

// Note: For the Web SDK of Realtime Database, basic offline 
// caching is enabled by default for the current session.