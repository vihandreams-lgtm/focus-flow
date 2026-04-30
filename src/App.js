import OpenAI from "openai";
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from './firebase';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser
} from 'firebase/auth';
import { ref, set, onValue, update, push, remove } from "firebase/database";

function App() {
  // --- AUTHENTICATION STATE ---
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const auth = getAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, [auth]);

  // --- APP STATE ---
  const [currentScreen, setCurrentScreen] = useState('HOME');
  const [ttTab, setTtTab] = useState('LECTURES');
  const [seconds, setSeconds] = useState(1500);
  const [totalTime, setTotalTime] = useState(1500);
  const [isActive, setIsActive] = useState(false);

  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [sessionsToday, setSessionsToday] = useState(0);
  const [lastActiveDate, setLastActiveDate] = useState('');
  const [tasks, setTasks] = useState([]);
  const [lectures, setLectures] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [exams, setExams] = useState([]);
  const [coursework, setCoursework] = useState([]);

  const [focusGoal, setFocusGoal] = useState('');
  const [cwInput, setCwInput] = useState('');
  const [cwType, setCwType] = useState('Assignment');
  const [cwDeadline, setCwDeadline] = useState('');
  const [cwDueTime, setCwDueTime] = useState('');

  const [taskInput, setTaskInput] = useState('');
  const [subject, setSubject] = useState('');
  const [venue, setVenue] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [day, setDay] = useState('Monday');
  const [date, setDate] = useState('');
  const [editingId, setEditingId] = useState(null);

  // --- AI SCREEN STATE ---
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [focusHistory, setFocusHistory] = useState([]);

  // --- FOCUS SCREEN ENHANCEMENTS ---
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [isCustomFocus, setIsCustomFocus] = useState(false);
  const [customFocusInput, setCustomFocusInput] = useState('');
  const [recentFocusHistory, setRecentFocusHistory] = useState([]);
  const [customMinutes, setCustomMinutes] = useState(25);
  const [showHistory, setShowHistory] = useState(false);

  // ========== AI ASSISTANT AGENT STATE ==========
  const [assistantMessages, setAssistantMessages] = useState([
    { role: 'assistant', content: "Hey there! I'm your FocusFlow AI Assistant. Ask me about your timetable, add tasks, manage your schedule, or just get some study motivation! 💫" }
  ]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  // BATCH ACTIONS: array of pending action objects, each with a unique batchId
  const [pendingActions, setPendingActions] = useState([]);
  const [isListening, setIsListening] = useState(false);
  // RECORDER-STYLE: continuous + interimResults, manual stop
  const recognitionRef = useRef(null);
  const recognitionRunningRef = useRef(false);
  const interimTranscriptRef = useRef('');
  const assistantEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const typingIntervalRef = useRef(null);

  // Auto-scroll chat to bottom — streams with typing animation
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [assistantMessages, assistantLoading, pendingActions]);

  // RECORDER-STYLE SpeechRecognition: continuous + interimResults, manual stop
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;       // keeps recording until manually stopped
    recognition.interimResults = true;   // shows partial results in real time
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }
      // Show interim text live in the input box
      if (interimTranscript) {
        interimTranscriptRef.current = interimTranscript;
        setAssistantInput(interimTranscript);
      }
      // Commit final segment
      if (finalTranscript) {
        interimTranscriptRef.current = '';
        setAssistantInput(prev => {
          const base = prev.replace(interimTranscriptRef.current, '').trim();
          return base ? base + ' ' + finalTranscript.trim() : finalTranscript.trim();
        });
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
      if (event.error === 'not-allowed') {
        alert('Microphone access was denied. Please allow microphone permissions.');
      }
    };

    // onend is the single sync point — fires on stop() or natural end
    recognition.onend = () => {
      recognitionRunningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  // RECORDER-STYLE toggle: tap once to start, tap again to stop manually
  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser. Try Chrome, Edge, or Safari.');
      return;
    }
    if (recognitionRunningRef.current) {
      // Second tap: manually stop — text stays in input box, user sends it themselves
      try { recognitionRef.current.stop(); } catch (e) { console.warn('Stop error:', e); }
      // onend will sync recognitionRunningRef and isListening
    } else {
      // First tap: start recording
      try {
        setAssistantInput('');
        interimTranscriptRef.current = '';
        recognitionRef.current.start();
        recognitionRunningRef.current = true;
        setIsListening(true);
      } catch (error) {
        console.error('Start error:', error);
        recognitionRunningRef.current = false;
        setIsListening(false);
      }
    }
  }, []);

  // ========== LIVE NOW STATE ==========
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ========== SERVICE WORKER COMMUNICATION ==========
  const swRegRef = useRef(null);
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => { swRegRef.current = reg; });
    }
  }, []);

  // ========== AUDIO UNLUCK ==========
  const unlockAudio = useCallback(() => {
    const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    silent.play().then(() => {}).catch(() => {});
    document.removeEventListener('click', unlockAudio);
  }, []);
  useEffect(() => {
    document.addEventListener('click', unlockAudio);
    return () => document.removeEventListener('click', unlockAudio);
  }, [unlockAudio]);

  // ========== NOTIFICATION PERMISSION ==========
  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default')
      await Notification.requestPermission();
  }, []);
  useEffect(() => { if (user) requestNotificationPermission(); }, [user, requestNotificationPermission]);

  // ---------- localStorage helpers ----------
  const getStorageKey = (uid, key) => `focusflow_${uid}_${key}`;
  const saveToLocal = useCallback((uid, key, data) => {
    try { localStorage.setItem(getStorageKey(uid, key), JSON.stringify(data)); } catch (e) { console.warn('localStorage save failed', e); }
  }, []);
  const loadFromLocal = useCallback((uid, key) => {
    try { const raw = localStorage.getItem(getStorageKey(uid, key)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }, []);

  // ---------- SMART MERGE FUNCTIONS ----------
  const mergeArrayWithTimestamps = useCallback((remoteData, uid, path) => {
    const localData = loadFromLocal(uid, path) || [];
    const merged = [];
    const localMap = new Map(localData.map(item => [item.id, item]));
    const remoteMap = new Map(remoteData.map(item => [item.id, item]));
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    allIds.forEach(id => {
      const localItem = localMap.get(id);
      const remoteItem = remoteMap.get(id);
      if (remoteItem) {
        if (localItem && localItem.lastUpdated > remoteItem.lastUpdated) merged.push(localItem);
        else merged.push(remoteItem);
      }
    });
    if (JSON.stringify(merged) !== JSON.stringify(remoteData)) {
      set(ref(db, `users/${uid}/${path}`), merged);
    }
    return merged;
  }, [loadFromLocal]);

  const mergeObjectWithTimestamp = useCallback((remoteData, uid, path) => {
    const localData = loadFromLocal(uid, path);
    if (!localData) return remoteData;
    if (!remoteData) return localData;
    const localTime = localData.lastUpdated || 0;
    const remoteTime = remoteData.lastUpdated || 0;
    if (localTime > remoteTime) {
      set(ref(db, `users/${uid}/${path}`), localData);
      return localData;
    }
    return remoteData;
  }, [loadFromLocal]);

  // ========== MASTER SYNC ENGINE ==========
  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    const userRef = (path) => ref(db, `users/${uid}/${path}`);

    const preload = (key, setter) => { const d = loadFromLocal(uid, key); if (d) setter(d); };
    preload('tasks', setTasks); preload('lectures', setLectures); preload('revisions', setRevisions);
    preload('exams', setExams); preload('coursework', setCoursework);
    const ts = loadFromLocal(uid, 'timerState'); if (ts) setFocusGoal(ts.currentFocus || '');
    const st = loadFromLocal(uid, 'stats'); if (st) { setSessionsCompleted(st.total || 0); setSessionsToday(st.today || 0); setLastActiveDate(st.lastDate || ''); }
    const fh = loadFromLocal(uid, 'focusHistory'); if (fh) { setFocusHistory(fh); const sorted = fh.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)); setRecentFocusHistory(sorted.slice(0,3)); }

    const unsubTasks = onValue(userRef('tasks'), (snap) => { const remote = snap.val() || []; setTasks(prev => { const merged = mergeArrayWithTimestamps(remote, uid, 'tasks'); saveToLocal(uid, 'tasks', merged); return merged; }); });
    const unsubLectures = onValue(userRef('lectures'), (snap) => { const remote = snap.val() || []; setLectures(prev => { const merged = mergeArrayWithTimestamps(remote, uid, 'lectures'); saveToLocal(uid, 'lectures', merged); return merged; }); });
    const unsubRevisions = onValue(userRef('revisions'), (snap) => { const remote = snap.val() || []; setRevisions(prev => { const merged = mergeArrayWithTimestamps(remote, uid, 'revisions'); saveToLocal(uid, 'revisions', merged); return merged; }); });
    const unsubExams = onValue(userRef('exams'), (snap) => { const remote = snap.val() || []; setExams(prev => { const merged = mergeArrayWithTimestamps(remote, uid, 'exams'); saveToLocal(uid, 'exams', merged); return merged; }); });
    const unsubCoursework = onValue(userRef('coursework'), (snap) => { const remote = snap.val() || []; setCoursework(prev => { const merged = mergeArrayWithTimestamps(remote, uid, 'coursework'); saveToLocal(uid, 'coursework', merged); return merged; }); });
    const unsubTimerState = onValue(userRef('timerState'), (snap) => { const remote = snap.val() || {}; const merged = mergeObjectWithTimestamp(remote, uid, 'timerState'); setFocusGoal(merged.currentFocus || ''); saveToLocal(uid, 'timerState', merged); });
    const unsubStats = onValue(userRef('stats'), (snap) => { const remote = snap.val() || {}; const merged = mergeObjectWithTimestamp(remote, uid, 'stats'); if (merged) { setSessionsCompleted(merged.total || 0); setSessionsToday(merged.today || 0); setLastActiveDate(merged.lastDate || ''); saveToLocal(uid, 'stats', merged); } });
    const unsubFocusHistory = onValue(userRef('focusHistory'), (snap) => { const remote = snap.val() || {}; const remoteEntries = Object.values(remote); const localHistory = loadFromLocal(uid, 'focusHistory') || []; const remoteTimestamps = new Set(remoteEntries.map(e => e.timestamp)); const newLocal = localHistory.filter(e => !remoteTimestamps.has(e.timestamp)); const combined = [...remoteEntries, ...newLocal].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)); setFocusHistory(combined); saveToLocal(uid, 'focusHistory', combined); setRecentFocusHistory(combined.slice(0,3)); newLocal.forEach(entry => push(userRef('focusHistory'), entry)); });

    return () => { unsubTasks(); unsubLectures(); unsubRevisions(); unsubExams(); unsubCoursework(); unsubTimerState(); unsubStats(); unsubFocusHistory(); };
  }, [user, mergeArrayWithTimestamps, mergeObjectWithTimestamp, saveToLocal, loadFromLocal]);

  // Build subject options
  useEffect(() => {
    const subs = [...lectures.map(l => l.subject), ...coursework.map(c => c.text)].filter(Boolean);
    setSubjectOptions([...new Set(subs)].sort());
  }, [lectures, coursework]);

  const todayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
  const todayISO = new Date().toISOString().split('T')[0];

  // --- TODAY'S ACTIVITIES ---
  const todaysActivities = useMemo(() => {
    const combined = [
      ...lectures.filter(f => f.day === todayName).map(i => ({...i, category: 'LECTURE'})),
      ...revisions.filter(r => r.day === todayName).map(i => ({...i, category: 'REVISION'})),
      ...exams.filter(e => e.date === todayISO).map(i => ({...i, category: 'EXAM'}))
    ];
    const todayTests = coursework.filter(cw => cw.type === 'Test' && cw.deadline === todayISO).map(cw => ({
      id: cw.id, subject: cw.text, startTime: cw.dueTime || '23:59', endTime: cw.dueTime || '23:59',
      venue: 'Test Deadline', category: 'TEST', dueTime: cw.dueTime
    }));
    return [...combined, ...todayTests].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [lectures, revisions, exams, coursework, todayName, todayISO]);

  // ========== SEND SCHEDULE TO SERVICE WORKER ==========
  const sendScheduleToSW = useCallback(() => {
    if (!swRegRef.current || !swRegRef.current.active || !user) return;
    const nowTime = new Date();
    const notifications = [];
    todaysActivities.forEach(act => {
      if (!act.startTime) return;
      const [h, m] = act.startTime.split(':').map(Number);
      const startDate = new Date(nowTime.getFullYear(), nowTime.getMonth(), nowTime.getDate(), h, m, 0);
      const preDate = new Date(startDate.getTime() - 10 * 60 * 1000);
      notifications.push({ id: `act-pre-${act.id}`, title: `⏰ ${act.subject} ${act.category}`, body: `Starting in 10 minutes`, scheduledAt: preDate.toISOString() });
      notifications.push({ id: `act-start-${act.id}`, title: `🔔 ${act.subject} ${act.category}`, body: `Starting now`, scheduledAt: startDate.toISOString() });
    });
    coursework.forEach(cw => {
      if (cw.completed || !cw.deadline) return;
      const deadlineDate = new Date(cw.deadline + 'T09:00:00');
      if (isNaN(deadlineDate.getTime())) return;
      const twoDaysBefore = new Date(deadlineDate); twoDaysBefore.setDate(deadlineDate.getDate() - 2);
      const oneDayBefore = new Date(deadlineDate); oneDayBefore.setDate(deadlineDate.getDate() - 1);
      notifications.push({ id: `cw-2day-${cw.id}`, title: `📚 Coursework Reminder`, body: `${cw.text} due in 2 days (${cw.deadline})`, scheduledAt: twoDaysBefore.toISOString() });
      notifications.push({ id: `cw-1day-${cw.id}`, title: `📚 Coursework Reminder`, body: `${cw.text} due tomorrow! (${cw.deadline})`, scheduledAt: oneDayBefore.toISOString() });
    });
    swRegRef.current.active.postMessage({ type: 'SCHEDULE_NOTIFICATIONS', notifications });
  }, [todaysActivities, coursework, user]);
  useEffect(() => { sendScheduleToSW(); }, [sendScheduleToSW]);

  // ========== INSTANT NOTIFICATIONS ==========
  const safeNotify = useCallback((title, body) => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(() => {});
      }
    } catch (error) { console.warn('Notification error:', error); }
  }, []);
  const notifiedRef = useRef(new Set());
  useEffect(() => {
    if (!user) return;
    try {
      todaysActivities.forEach(act => {
        if (!act.startTime) return;
        const [h, m] = act.startTime.split(':').map(Number);
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
        const preDate = new Date(startDate.getTime() - 10 * 60 * 1000);
        const nowTime = now.getTime();
        if (nowTime >= preDate.getTime() && nowTime < startDate.getTime()) {
          const key = `pre-${act.id}`;
          if (!notifiedRef.current.has(key)) { safeNotify(`⏰ ${act.subject} ${act.category}`, 'Starting in 10 minutes'); notifiedRef.current.add(key); }
        }
        if (nowTime >= startDate.getTime() && nowTime < startDate.getTime() + 60000) {
          const key = `start-${act.id}`;
          if (!notifiedRef.current.has(key)) { safeNotify(`🔔 ${act.subject} ${act.category}`, 'Starting now'); notifiedRef.current.add(key); }
        }
      });
    } catch (error) { console.warn('Instant notification check error:', error); }
  }, [now, todaysActivities, user, safeNotify]);
  useEffect(() => {
    const midnight = new Date(); midnight.setHours(24,0,0,0);
    const timer = setTimeout(() => notifiedRef.current.clear(), midnight.getTime() - Date.now());
    return () => clearTimeout(timer);
  }, []);

  // --- AUTH HANDLERS ---
  const passwordLongEnough = authPassword.length >= 6;
  const passwordHasNumber = /\d/.test(authPassword);
  const isSignupValid = useCallback(() => {
    if (authMode !== 'signup') return true;
    return passwordLongEnough && passwordHasNumber && authPassword === authConfirmPassword;
  }, [authMode, passwordLongEnough, passwordHasNumber, authPassword, authConfirmPassword]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault(); setAuthError('');
    if (!authEmail || !authPassword) { setAuthError('Email and password required'); return; }
    if (authMode === 'signup') {
      if (!passwordLongEnough) { setAuthError('Password must be at least 6 characters'); return; }
      if (!passwordHasNumber) { setAuthError('Password must contain at least one number'); return; }
      if (authPassword !== authConfirmPassword) { setAuthError('Passwords do not match'); return; }
    }
    try {
      if (authMode === 'signup') await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      else await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (error) { setAuthError(error.message); }
  };
  const handleLogout = async () => { try { await signOut(auth); setShowProfile(false); } catch (error) { console.error('Logout error:', error); } };
  const handleDeleteAccount = async () => {
    if (!user) return;
    const confirmed = window.confirm('⚠️ PERMANENTLY DELETE YOUR ACCOUNT?\n\nThis will erase all your data. This action cannot be undone.');
    if (!confirmed) return;
    try {
      await remove(ref(db, `users/${user.uid}`));
      const keys = Object.keys(localStorage).filter(k => k.startsWith(`focusflow_${user.uid}_`));
      keys.forEach(k => localStorage.removeItem(k));
      await deleteUser(user); setShowProfile(false);
    } catch (error) { console.error('Delete account error:', error); alert('Failed to delete account. You may need to re-authenticate. ' + error.message); }
  };

  // --- AI RECOMMENDATION ENGINE (Groq) – for revision timetable generator ---
  const generateRecommendations = async () => {
    if (!user) return; setIsGenerating(true); setRecommendations([]);
    try {
      const apiKey = process.env.REACT_APP_GROQ_KEY;
      const groq = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1", dangerouslyAllowBrowser: true });
      const currentTime = new Date(); const currentTimeStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); const todayStr = currentTime.toLocaleDateString();
      const todaysSchedule = todaysActivities.map(act => ({ subject: act.subject, start: act.startTime, end: act.endTime || act.startTime, category: act.category }));
      const courseworkItems = coursework.map(cw => ({ subject: cw.text, deadline: cw.deadline, type: cw.type }));
      const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const recentHistory = focusHistory.filter(entry => new Date(entry.timestamp) >= twoWeeksAgo);
      const prompt = `You are an AI study planner. Based on the following data, create a personalised revision timetable for TODAY. Current time: ${currentTimeStr} on ${todayStr}. Only suggest slots that start AFTER the current time. Today's existing schedule: ${JSON.stringify(todaysSchedule, null, 2)}. Coursework and deadlines: ${JSON.stringify(courseworkItems, null, 2)}. Recent focus history (last 14 days): ${JSON.stringify(recentHistory, null, 2)}. Instructions: - Identify free time gaps (day ends at 22:00). - Prioritise subjects with upcoming deadlines (within 7 days) or neglected. - Generate 1 to 3 revision sessions. - Each session must include: subject, startTime (HH:MM), endTime (HH:MM), reasoning. - Return ONLY a JSON array of objects with keys: subject, startTime, endTime, reasoning.`;
      const completion = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: "You are a helpful study planner. Respond only with valid JSON." }, { role: "user", content: prompt }], temperature: 0.3 });
      const responseText = completion.choices[0].message.content; const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("Invalid AI response format"); const parsed = JSON.parse(jsonMatch[0]);
      const validated = parsed.filter(rec => rec.subject && rec.startTime && rec.endTime && rec.reasoning).map((rec, idx) => ({ ...rec, id: Date.now() + idx }));
      setRecommendations(validated);
    } catch (error) { console.error("AI generation error:", error); alert("AI service unavailable. Please try again later."); }
    finally { setIsGenerating(false); }
  };
  const handleAddRecommendation = (rec) => {
    if (!user) return;
    const newEntry = { id: Date.now(), subject: rec.subject, startTime: rec.startTime, endTime: rec.endTime, venue: 'AI Recommended', day: todayName, lastUpdated: Date.now() };
    const updatedRevisions = [newEntry, ...revisions]; setRevisions(updatedRevisions); saveToLocal(user.uid, 'revisions', updatedRevisions); set(ref(db, `users/${user.uid}/revisions`), updatedRevisions);
    alert(`Added "${rec.subject}" revision at ${rec.startTime}`); setRecommendations(prev => prev.filter(r => r.id !== rec.id));
  };
  const dismissRecommendation = (id) => { setRecommendations(prev => prev.filter(r => r.id !== id)); };

  // --- FOCUS TIMER LOGIC ---
  useEffect(() => {
    if (!user) return;
    const today = new Date().toLocaleDateString();
    if (lastActiveDate && lastActiveDate !== today) { const newStats = { total: sessionsCompleted, today: 0, lastDate: today, lastUpdated: Date.now() }; update(ref(db, `users/${user.uid}/stats`), newStats); saveToLocal(user.uid, 'stats', newStats); }
  }, [lastActiveDate, user, sessionsCompleted, saveToLocal]);
  const handleFocusChange = (e) => {
    const val = e.target.value;
    if (val === 'custom') { setIsCustomFocus(true); setFocusGoal(''); }
    else { setIsCustomFocus(false); setFocusGoal(val); if (user) { const newTimerState = { currentFocus: val, lastUpdated: Date.now() }; set(ref(db, `users/${user.uid}/timerState`), newTimerState); saveToLocal(user.uid, 'timerState', newTimerState); } }
  };
  const handleCustomFocusChange = (e) => { const val = e.target.value; setCustomFocusInput(val); setFocusGoal(val); if (user) { const newTimerState = { currentFocus: val, lastUpdated: Date.now() }; set(ref(db, `users/${user.uid}/timerState`), newTimerState); saveToLocal(user.uid, 'timerState', newTimerState); } };
  const handleMinutesChange = (e) => { const mins = parseInt(e.target.value, 10); if (!isNaN(mins) && mins > 0) { setCustomMinutes(mins); setTotalTime(mins * 60); setSeconds(mins * 60); } };
  useEffect(() => {
    let interval = null;
    if (isActive && seconds > 0) { interval = setInterval(() => setSeconds(s => s - 1), 1000); }
    else if (seconds === 0 && isActive) {
      setIsActive(false); new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(() => {});
      if (totalTime === customMinutes * 60 && user) {
        const sessionLog = { subjectName: focusGoal || 'Untitled Session', duration: customMinutes, timestamp: new Date().toISOString(), lastUpdated: Date.now() };
        push(ref(db, `users/${user.uid}/focusHistory`), sessionLog);
        const newDailyCount = sessionsToday + 1; const newTotalCount = sessionsCompleted + 1;
        const newStats = { total: newTotalCount, today: newDailyCount, lastDate: new Date().toLocaleDateString(), lastUpdated: Date.now() };
        set(ref(db, `users/${user.uid}/stats`), newStats); saveToLocal(user.uid, 'stats', newStats);
        const updatedHistory = [...focusHistory, sessionLog]; saveToLocal(user.uid, 'focusHistory', updatedHistory); setRecentFocusHistory(updatedHistory.slice(-3));
        if (newDailyCount % 4 === 0) { alert("4 Sessions Done! Take a long 15-minute break."); setTotalTime(900); setSeconds(900); }
        else { alert("Session Complete! 5-minute break starts now."); setTotalTime(300); setSeconds(300); }
      } else {
        alert("Break over! Ready to focus?"); setTotalTime(customMinutes * 60); setSeconds(customMinutes * 60); setFocusGoal(''); setIsCustomFocus(false); setCustomFocusInput('');
        if (user) { const newTimerState = { currentFocus: '', lastUpdated: Date.now() }; set(ref(db, `users/${user.uid}/timerState`), newTimerState); saveToLocal(user.uid, 'timerState', newTimerState); }
      }
    }
    return () => clearInterval(interval);
  }, [isActive, seconds, totalTime, sessionsToday, sessionsCompleted, focusGoal, customMinutes, user, focusHistory, saveToLocal]);

  const progressOffset = (2 * Math.PI * 140) - (seconds / totalTime) * (2 * Math.PI * 140);
  const getStatus = useCallback((start, end) => {
    const currentTime = now || new Date(); const [sH, sM] = start.split(':').map(Number); const [eH, eM] = end ? end.split(':').map(Number) : [sH + 1, sM];
    const startDate = new Date(currentTime); startDate.setHours(sH, sM, 0); const endDate = new Date(currentTime); endDate.setHours(eH, eM, 0);
    if (currentTime > endDate) return 'PAST'; if (currentTime >= startDate && currentTime <= endDate) return 'LIVE'; return 'UPCOMING';
  }, [now]);

  // ---------- CRUD OPERATIONS ----------
  const clearForm = () => { setSubject(''); setVenue(''); setStartTime(''); setEndTime(''); setDate(''); setDay('Monday'); setEditingId(null); };
  const saveEntry = () => {
    if (!user || !subject || !startTime) return;
    const entry = { id: editingId || Date.now(), subject, startTime, endTime, venue, day, date, lastUpdated: Date.now() };
    let path = ttTab === 'LECTURES' ? 'lectures' : ttTab === 'REVISION' ? 'revisions' : 'exams';
    let currentList = ttTab === 'LECTURES' ? lectures : ttTab === 'REVISION' ? revisions : exams;
    const updatedList = editingId ? currentList.map(item => item.id === editingId ? entry : item) : [entry, ...currentList];
    if (ttTab === 'LECTURES') setLectures(updatedList); else if (ttTab === 'REVISION') setRevisions(updatedList); else setExams(updatedList);
    saveToLocal(user.uid, path, updatedList); set(ref(db, `users/${user.uid}/${path}`), updatedList); clearForm();
  };
  const handleEdit = (item) => { setEditingId(item.id); setSubject(item.subject); setVenue(item.venue); setStartTime(item.startTime); setEndTime(item.endTime); setDay(item.day || 'Monday'); setDate(item.date || ''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const confirmDelete = (id, type) => {
    if (!user || !window.confirm("Are you sure you want to delete this?")) return;
    const paths = { LECTURES: 'lectures', REVISION: 'revisions', EXAMS: 'exams', TASK: 'tasks', CW: 'coursework' };
    const lists = { LECTURES: lectures, REVISION: revisions, EXAMS: exams, TASK: tasks, CW: coursework };
    const path = paths[type]; const currentList = lists[type]; const updatedList = currentList.filter(x => x.id !== id);
    if (type === 'LECTURES') setLectures(updatedList); else if (type === 'REVISION') setRevisions(updatedList); else if (type === 'EXAMS') setExams(updatedList);
    else if (type === 'TASK') setTasks(updatedList); else if (type === 'CW') setCoursework(updatedList);
    saveToLocal(user.uid, path, updatedList); set(ref(db, `users/${user.uid}/${path}`), updatedList);
  };
  const saveAcademic = () => { if(!user || !cwInput) return; const newCw = { id: Date.now(), text: cwInput, type: cwType, deadline: cwDeadline, dueTime: cwDueTime, completed: false, lastUpdated: Date.now() }; const updatedCoursework = [newCw, ...coursework]; setCoursework(updatedCoursework); saveToLocal(user.uid, 'coursework', updatedCoursework); set(ref(db, `users/${user.uid}/coursework`), updatedCoursework); setCwInput(''); setCwDeadline(''); setCwDueTime(''); };
  const toggleCw = (id) => { if (!user) return; const updated = coursework.map(x => x.id === id ? { ...x, completed: !x.completed, lastUpdated: Date.now() } : x); setCoursework(updated); saveToLocal(user.uid, 'coursework', updated); set(ref(db, `users/${user.uid}/coursework`), updated); };
  const addTask = () => { if (!user || !taskInput) return; const newTask = { id: Date.now(), text: taskInput, completed: false, lastUpdated: Date.now() }; const updatedTasks = [newTask, ...tasks]; setTasks(updatedTasks); saveToLocal(user.uid, 'tasks', updatedTasks); set(ref(db, `users/${user.uid}/tasks`), updatedTasks); setTaskInput(''); };
  const toggleTask = (id) => { if (!user) return; const updated = tasks.map(x => x.id === id ? { ...x, completed: !x.completed, lastUpdated: Date.now() } : x); setTasks(updated); saveToLocal(user.uid, 'tasks', updated); set(ref(db, `users/${user.uid}/tasks`), updated); };
  const clearCompletedTasks = () => { if (!user) return; const updated = tasks.filter(t => !t.completed); setTasks(updated); saveToLocal(user.uid, 'tasks', updated); set(ref(db, `users/${user.uid}/tasks`), updated); };

  // --- Agent helper functions (called after Safe-Way confirmation) ---
  const addTaskFromAgent = (text) => {
    if (!user || !text) return;
    const newTask = { id: Date.now(), text, completed: false, lastUpdated: Date.now() };
    const updatedTasks = [newTask, ...tasks];
    setTasks(updatedTasks);
    saveToLocal(user.uid, 'tasks', updatedTasks);
    set(ref(db, `users/${user.uid}/tasks`), updatedTasks);
  };
  const addRevisionFromAgent = (data) => {
    if (!user) return;
    const newEntry = { id: Date.now(), subject: data.subject, startTime: data.startTime, endTime: data.endTime, venue: data.venue || 'AI Suggested', day: data.day || todayName, lastUpdated: Date.now() };
    const updated = [newEntry, ...revisions];
    setRevisions(updated);
    saveToLocal(user.uid, 'revisions', updated);
    set(ref(db, `users/${user.uid}/revisions`), updated);
  };
  const addLectureFromAgent = (data) => {
    if (!user) return;
    const newEntry = { id: Date.now(), subject: data.subject, startTime: data.startTime, endTime: data.endTime, venue: data.venue || 'AI Suggested', day: data.day, lastUpdated: Date.now() };
    const updated = [newEntry, ...lectures];
    setLectures(updated);
    saveToLocal(user.uid, 'lectures', updated);
    set(ref(db, `users/${user.uid}/lectures`), updated);
  };
  // CORE LOGIC #5: add_exam — final assessments only
  const addExamFromAgent = (data) => {
    if (!user) return;
    const newEntry = { id: Date.now(), subject: data.subject, startTime: data.startTime, endTime: data.endTime, venue: data.venue || '', date: data.date, lastUpdated: Date.now() };
    const updated = [newEntry, ...exams];
    setExams(updated);
    saveToLocal(user.uid, 'exams', updated);
    set(ref(db, `users/${user.uid}/exams`), updated);
  };
  // CORE LOGIC #5: add_test — coursework with type "Test", NOT add_exam
  const addTestFromAgent = (data) => {
    if (!user) return;
    const newTest = { id: Date.now(), text: data.text, type: "Test", deadline: data.deadline, dueTime: data.dueTime || '', completed: false, lastUpdated: Date.now() };
    const updated = [newTest, ...coursework];
    setCoursework(updated);
    saveToLocal(user.uid, 'coursework', updated);
    set(ref(db, `users/${user.uid}/coursework`), updated);
  };
  const addCourseworkFromAgent = (data) => {
    if (!user) return;
    const newCw = { id: Date.now(), text: data.text, type: data.type, deadline: data.deadline, dueTime: data.dueTime || '', completed: false, lastUpdated: Date.now() };
    const updated = [newCw, ...coursework];
    setCoursework(updated);
    saveToLocal(user.uid, 'coursework', updated);
    set(ref(db, `users/${user.uid}/coursework`), updated);
  };
  const setupFocusTimerFromAgent = (subject, minutes) => {
    if (!user) return;
    setFocusGoal(subject);
    setCustomMinutes(minutes);
    setTotalTime(minutes * 60);
    setSeconds(minutes * 60);
    const newTimerState = { currentFocus: subject, lastUpdated: Date.now() };
    set(ref(db, `users/${user.uid}/timerState`), newTimerState);
    saveToLocal(user.uid, 'timerState', newTimerState);
    setCurrentScreen('FOCUS');
  };

  // FIX #3: Delete helpers for AI-driven delete actions
  const deleteTaskFromAgent = (id) => {
    if (!user) return;
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    saveToLocal(user.uid, 'tasks', updated);
    set(ref(db, `users/${user.uid}/tasks`), updated);
  };
  const deleteCourseworkFromAgent = (id) => {
    if (!user) return;
    const updated = coursework.filter(c => c.id !== id);
    setCoursework(updated);
    saveToLocal(user.uid, 'coursework', updated);
    set(ref(db, `users/${user.uid}/coursework`), updated);
  };
  const deleteExamFromAgent = (id) => {
    if (!user) return;
    const updated = exams.filter(e => e.id !== id);
    setExams(updated);
    saveToLocal(user.uid, 'exams', updated);
    set(ref(db, `users/${user.uid}/exams`), updated);
  };
  // FIX #3: Edit helpers
  const editTaskFromAgent = (id, newText) => {
    if (!user) return;
    const updated = tasks.map(t => t.id === id ? { ...t, text: newText, lastUpdated: Date.now() } : t);
    setTasks(updated);
    saveToLocal(user.uid, 'tasks', updated);
    set(ref(db, `users/${user.uid}/tasks`), updated);
  };
  const editCourseworkFromAgent = (id, fields) => {
    if (!user) return;
    const updated = coursework.map(c => c.id === id ? { ...c, ...fields, lastUpdated: Date.now() } : c);
    setCoursework(updated);
    saveToLocal(user.uid, 'coursework', updated);
    set(ref(db, `users/${user.uid}/coursework`), updated);
  };
  const editExamFromAgent = (id, fields) => {
    if (!user) return;
    const updated = exams.map(e => e.id === id ? { ...e, ...fields, lastUpdated: Date.now() } : e);
    setExams(updated);
    saveToLocal(user.uid, 'exams', updated);
    set(ref(db, `users/${user.uid}/exams`), updated);
  };
  // V5.0: edit_revision handler (Scenario C)
  const editRevisionFromAgent = (id, fields) => {
    if (!user) return;
    const updated = revisions.map(r => r.id === id ? { ...r, ...fields, lastUpdated: Date.now() } : r);
    setRevisions(updated);
    saveToLocal(user.uid, 'revisions', updated);
    set(ref(db, `users/${user.uid}/revisions`), updated);
  };
  // V5.0: delete_lecture handler (Scenario B)
  const deleteLectureFromAgent = (id) => {
    if (!user) return;
    const updated = lectures.filter(l => l.id !== id);
    setLectures(updated);
    saveToLocal(user.uid, 'lectures', updated);
    set(ref(db, `users/${user.uid}/lectures`), updated);
  };
  // V5.0: delete_revision handler (Scenario B)
  const deleteRevisionFromAgent = (id) => {
    if (!user) return;
    const updated = revisions.filter(r => r.id !== id);
    setRevisions(updated);
    saveToLocal(user.uid, 'revisions', updated);
    set(ref(db, `users/${user.uid}/revisions`), updated);
  };

  // ========== AI ASSISTANT — TYPING ANIMATION ==========
  const simulateTyping = (text) => {
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    let i = 0;
    typingIntervalRef.current = setInterval(() => {
      setAssistantMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.isSystem) {
          updated[updated.length - 1] = { ...lastMsg, content: text.slice(0, i + 1) };
        }
        return updated;
      });
      i++;
      if (i >= text.length) {
        clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null;
      }
    }, 18);
  };

  // ========== AI ASSISTANT AGENT LOGIC — V5.0 PARALLEL ARRAY MODEL ==========
  const sendAssistantMessage = async () => {
    if (!assistantInput.trim() || assistantLoading) return;

    // Stop mic if still running — text stays in box
    if (recognitionRunningRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }

    const userMessage = { role: 'user', content: assistantInput.trim() };
    // Capture full history BEFORE state update — preserves chat continuity for API
    const historyForApi = [...assistantMessages, userMessage];

    setAssistantMessages(prev => [...prev, userMessage]);
    setAssistantInput('');
    setAssistantLoading(true);

    try {
      const apiKey = process.env.REACT_APP_GROQ_KEY;
      const groq = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1", dangerouslyAllowBrowser: true });

      // Build snapshot — include IDs so AI can reference them for edits/deletes
      const pendingTasksList   = tasks.filter(t => !t.completed).map(t => `[id:${t.id}] ${t.text}`);
      const completedTasksList  = tasks.filter(t => t.completed).map(t => t.text);
      const allCourseworkList   = coursework.map(c => `[id:${c.id}] ${c.text} (${c.type}, due ${c.deadline} ${c.dueTime || ''}, done:${c.completed})`);
      const upcomingExamsList   = exams.filter(e => e.date >= todayISO).map(e => `[id:${e.id}] ${e.subject} on ${e.date} at ${e.startTime}`);
      const allLecturesList     = lectures.map(l => `[id:${l.id}] ${l.subject} ${l.day} ${l.startTime}-${l.endTime} ${l.venue}`);
      const allRevisionsList    = revisions.map(r => `[id:${r.id}] ${r.subject} ${r.day} ${r.startTime}-${r.endTime}`);
      const focusStats          = `Total sessions: ${sessionsCompleted}, today: ${sessionsToday}`;
      const recentFocusList     = focusHistory.slice(0,5).map(f => `${f.subjectName} (${f.duration}min) ${new Date(f.timestamp).toLocaleDateString()}`);

      // ── LIVE DATE CONTEXT injected fresh on every request ──────────────────
      const now_dt     = new Date();
      const todayFull  = now_dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      // Pre-compute the next 7 day names so the AI can resolve "tomorrow", "in 3 days" etc.
      const DAY_NAMES  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const dayOffsets = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now_dt); d.setDate(d.getDate() + i);
        return `+${i}d = ${DAY_NAMES[d.getDay()]} (${d.toISOString().split('T')[0]})`;
      }).join(', ');

      const systemContent = `You are FocusFlow AI Assistant — an intelligent, friendly study partner built into a student productivity PWA. You have live access to the user's full schedule data. Be concise, warm, and motivational.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIVE DATE & TIME CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Right now it is: ${todayFull}
Today (ISO):     ${todayISO}
Today (name):    ${todayName}
Day look-ahead:  ${dayOffsets}

Use this table to resolve ALL relative terms the user says:
  "today"     → ${todayName}
  "tomorrow"  → ${DAY_NAMES[new Date(now_dt.getTime() + 86400000).getDay()]}
  "next [day]" → resolve from the look-ahead table above
NEVER leave the "day" field as an ISO date string (e.g. "2026-04-29"). It MUST be a Day of the Week name.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — WHEN TO USE JSON (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ONLY output a JSON block when the user explicitly asks to ADD, EDIT, or DELETE something.
• Pure chat, questions, advice, or motivation → respond with PLAIN TEXT ONLY. No JSON, no code blocks, no exceptions.
• NEVER emit a JSON block for a normal conversational reply — it triggers a confirmation card the user didn't ask for.
• If the user's request is missing a mandatory field (e.g. no time given for a lecture), ask them for that specific detail in plain text BEFORE emitting any JSON. Do NOT guess or leave mandatory fields blank.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 2 — TESTS vs EXAMS (ABSOLUTELY CRITICAL — NEVER MIX THESE UP)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• TEST = class quiz, weekly test, mid-term, any in-class assessment
  → action: "add_test" → stored in Coursework with type "Test"
  → MANDATORY fields: text (name), deadline (YYYY-MM-DD), dueTime (HH:MM)
  ❌ NEVER use add_exam for a test. ❌ NEVER use add_test for a final exam.

• EXAM = official final examination with a calendar date (end-of-semester, board exam)
  → action: "add_exam" → stored in Exams section
  → MANDATORY fields: subject, date (YYYY-MM-DD), startTime (HH:MM), endTime (HH:MM), venue

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 2B — INTELLIGENT FEATURE MAPPING (SMART CATEGORISER — NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every student activity MUST go into the CORRECT section. Use this exact mapping:

COURSEWORK SECTION → action: "add_coursework"
  Use for: Assignments, Tests (class/weekly/mid-term), Discussions, Projects
  • "Ethics Assignment"  → action: add_coursework, type: "Assignment"
  • "Math Test"          → action: add_coursework, type: "Test"  (NOT add_exam — see RULE 2)
  • "Forum Discussion"   → action: add_coursework, type: "Discussion"
  • "Group Project"      → action: add_coursework, type: "Project"
  Mandatory fields: text ✱, type ✱, deadline (YYYY-MM-DD) ✱
  NEVER use add_lecture, add_revision, or add_task for these.

REVISION SECTION → action: "add_revision"
  Use ONLY for: personal self-study / reading sessions (the student studies alone)
  • "Study for Ethics tonight" → add_revision
  • "Read Chapter 5 on Monday" → add_revision
  Do NOT use this for official class slots or assignments.

LECTURES SECTION → action: "add_lecture"
  Use for: official university classes, timetable slots, seminars
  • "I have Graphics class on Monday at 8am" → add_lecture
  Do NOT use this for personal study.

TASKS SECTION → action: "add_task"
  Use ONLY for: general reminders and errands (no academic weight)
  • "Buy a notebook" → add_task
  • "Print assignment" → add_task
  Do NOT use this for academic activities that belong in Coursework or Revision.

EXAMS SECTION → action: "add_exam"
  Use ONLY for: official final exams / board exams (see RULE 2).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 3 — DAY-OF-WEEK IS SACRED (for lectures & revisions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The app filters the Daily Flow with: items.filter(i => i.day === currentDayName)
If the "day" field is ANYTHING other than a Day of the Week name, the item will be invisible.

✅ CORRECT:  "day": "Thursday"
❌ WRONG:    "day": "2026-05-01"   ← ISO date — item will NEVER appear on Daily Flow
❌ WRONG:    "day": "tomorrow"     ← plain text — item will NEVER appear on Daily Flow
❌ WRONG:    "day": ""             ← empty — item will NEVER appear on Daily Flow

Conversion rule: take the calendar date → look it up in the Day look-ahead table above → use ONLY the Day name string.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 4 — MANDATORY FIELDS PER ACTION (missing = ask the user, never guess)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
add_lecture   → subject ✱, day (Day of Week) ✱, startTime (HH:MM) ✱, endTime (HH:MM) ✱, venue ✱
add_revision  → subject ✱, day (Day of Week) ✱, startTime (HH:MM) ✱, endTime (HH:MM) ✱
add_exam      → subject ✱, date (YYYY-MM-DD) ✱, startTime (HH:MM) ✱, endTime (HH:MM) ✱, venue ✱
add_test      → text ✱, deadline (YYYY-MM-DD) ✱, dueTime (HH:MM) ✱
add_task      → text ✱
add_coursework→ text ✱, type ("Assignment"|"Test"|"Discussion"|"Project") ✱, deadline (YYYY-MM-DD) ✱, dueTime (HH:MM)
start_focus   → subject ✱, minutes ✱

If ANY field marked ✱ is unknown, respond in plain text asking for ONLY the missing field(s). Never emit JSON with blank/null mandatory fields.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 5 — BATCH ARRAY FORMAT (ALWAYS use an array, even for 1 item)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All actions MUST be returned inside a single JSON array. Each object must have:
  - "batchId": unique integer (1, 2, 3…)
  - "action": string (see schemas below)
  - "data": object with ALL required fields filled

Output your friendly text explanation FIRST, then the JSON array.
The app shows a separate confirmation card per item — the user can confirm or cancel each one independently. NEVER say the item was saved.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REAL-WORLD SCENARIO EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCENARIO A — Day translation (today is ${todayName}):
User: "Add a Graphics lecture tomorrow at 8am to 10am in Room J1"
→ "tomorrow" resolves to ${DAY_NAMES[new Date(now_dt.getTime() + 86400000).getDay()]} from the look-ahead table.
\`\`\`json
[
  { "batchId": 1, "action": "add_lecture", "data": { "subject": "Graphics", "day": "${DAY_NAMES[new Date(now_dt.getTime() + 86400000).getDay()]}", "startTime": "08:00", "endTime": "10:00", "venue": "Room J1" } }
]
\`\`\`

SCENARIO B — Missing mandatory field:
User: "Add a Maths lecture on Friday"
→ startTime and endTime are missing. Ask in plain text:
"Sure! What time does the Maths lecture start and end on Friday?"
(No JSON emitted until the user replies with the times.)

SCENARIO C — The Deadline Crunch (mixed Test + Exam):
User: "I have a Graphics Test tomorrow at 10am and a Science Exam on Friday at 2pm"
→ Return TWO objects: one add_test (Graphics Test → Coursework), one add_exam (Science → Exams).
\`\`\`json
[
  { "batchId": 1, "action": "add_test", "data": { "text": "Graphics Test", "deadline": "${new Date(now_dt.getTime() + 86400000).toISOString().split('T')[0]}", "dueTime": "10:00" } },
  { "batchId": 2, "action": "add_exam", "data": { "subject": "Science Exam", "date": "${DAY_NAMES[(now_dt.getDay() + (5 - now_dt.getDay() + 7) % 7) % 7] ? new Date(now_dt.getTime() + ((5 - now_dt.getDay() + 7) % 7) * 86400000).toISOString().split('T')[0] : ''}", "startTime": "14:00", "endTime": "16:00", "venue": "" } }
]
\`\`\`

SCENARIO D — The Schedule Reset (batch deletes):
User: "Clear all my Wednesday lectures"
→ Look up all Wednesday lectures from the snapshot. Return a delete action per item.
\`\`\`json
[
  { "batchId": 1, "action": "delete_lecture", "data": { "id": 1111111111, "label": "Graphics & Animation — Wednesday 08:00" } }
]
\`\`\`

SCENARIO E — The Proactive Adjustment (edit + add simultaneously):
User: "Move my 4pm Library session to 5pm and remind me to pick up my printed coursework"
\`\`\`json
[
  { "batchId": 1, "action": "edit_revision", "data": { "id": 3333333333, "fields": { "startTime": "17:00", "endTime": "18:00" } } },
  { "batchId": 2, "action": "add_task",      "data": { "text": "Pick up printed coursework" } }
]
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL ACTION SCHEMA REFERENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
add_revision:     { subject, day (Day of Week ✱), startTime, endTime }
add_lecture:      { subject, day (Day of Week ✱), startTime, endTime, venue }
add_exam:         { subject, date (YYYY-MM-DD), startTime, endTime, venue }
add_test:         { text, deadline (YYYY-MM-DD), dueTime }
add_task:         { text }
add_coursework:   { text, type ("Assignment"|"Test"|"Discussion"|"Project"), deadline, dueTime }
start_focus:      { subject, minutes }
edit_task:        { id, newText }
edit_coursework:  { id, fields: { text?, deadline?, dueTime?, type? } }
edit_exam:        { id, fields: { subject?, date?, startTime?, endTime?, venue? } }
edit_revision:    { id, fields: { subject?, startTime?, endTime?, day?, venue? } }
delete_task:      { id, label }
delete_coursework:{ id, label }
delete_exam:      { id, label }
delete_lecture:   { id, label }
delete_revision:  { id, label }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT APP SNAPSHOT (use IDs for edits/deletes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tasks pending:    ${pendingTasksList.length   ? pendingTasksList.join(' | ')   : 'None'}
Tasks completed:  ${completedTasksList.length ? completedTasksList.join(', ')  : 'None'}
Coursework:       ${allCourseworkList.length  ? allCourseworkList.join(' | ')  : 'None'}
Exams upcoming:   ${upcomingExamsList.length  ? upcomingExamsList.join(' | ')  : 'None'}
Lectures:         ${allLecturesList.length    ? allLecturesList.join(' | ')    : 'None'}
Revisions:        ${allRevisionsList.length   ? allRevisionsList.join(' | ')   : 'None'}
Focus stats:      ${focusStats}
Recent sessions:  ${recentFocusList.length   ? recentFocusList.join(' | ')    : 'None'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      const messages = [
        { role: 'system', content: systemContent },
        ...historyForApi.filter(m => m.role !== 'system')
      ];

      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.65,
        max_tokens: 1000,
      });

      const fullReply = completion.choices[0].message.content;

      // ── DUAL-PASS JSON EXTRACTION ──────────────────────────────────────────
      // Pass 1: fenced  ```json [ … ] ```   Pass 2: bare  [ … ]
      const fencedRegex = /```(?:json)?\s*(\[[\s\S]*?\])\s*```/;
      const bareRegex   = /(\[[\s\S]*?\])/;
      const fencedMatch = fullReply.match(fencedRegex);
      const bareMatch   = fullReply.match(bareRegex);
      const activeMatch = fencedMatch || bareMatch;
      const rawJson     = activeMatch ? activeMatch[1] : null;

      let parsedActions = [];
      let cleanText = fullReply;

      if (rawJson) {
        try {
          const arr = JSON.parse(rawJson);
          if (Array.isArray(arr) && arr.length > 0 && arr.every(a => a && typeof a.action === 'string')) {

            // ── AUTO-CORRECTOR: fix any data.day that slipped through as an ISO date ──
            const DAY_NAMES_LOCAL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            const sanitisedArr = arr.map(a => {
              if (!a.data || typeof a.data.day !== 'string') return a;
              const raw = a.data.day.trim();
              // If it looks like a date string (contains digits and hyphens, e.g. "2026-04-30")
              if (/\d{4}-\d{2}-\d{2}/.test(raw) || /\d{1,2}[/-]\d{1,2}/.test(raw)) {
                const parsed = new Date(raw);
                if (!isNaN(parsed.getTime())) {
                  const corrected = DAY_NAMES_LOCAL[parsed.getDay()];
                  console.info(`[FocusFlow] Auto-corrected day: "${raw}" → "${corrected}"`);
                  return { ...a, data: { ...a.data, day: corrected } };
                }
              }
              return a;
            });

            parsedActions = sanitisedArr.map((a, i) => ({ ...a, batchId: Date.now() + i }));
            // Strip the JSON block from the visible text
            cleanText = fencedMatch
              ? fullReply.replace(fencedRegex, '').trim()
              : fullReply.replace(bareRegex,   '').trim();
          }
        } catch (e) {
          console.warn('JSON parse error in AI response:', e);
          cleanText = fullReply; // show raw text on parse failure — never blank bubble
        }
      }

      if (!cleanText) cleanText = 'Got it! Review the cards below 👆';

      // Push clean text to chat IMMEDIATELY — independent of cards
      setAssistantMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      simulateTyping(cleanText);

      // Append action cards — never touches assistantMessages
      if (parsedActions.length > 0) {
        setPendingActions(prev => [...prev, ...parsedActions]);
      }

    } catch (error) {
      console.error('AI Assistant error:', error);
      setAssistantMessages(prev => [...prev, { role: 'assistant', content: 'Connection issue — please try again.' }]);
    } finally {
      // Always unblock input
      setAssistantLoading(false);
    }
  };

  const clearAssistantHistory = () => {
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    // RECORDER RESET: stop mic if running
    if (recognitionRunningRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
    setIsListening(false);
    recognitionRunningRef.current = false;
    setAssistantMessages([
      { role: 'assistant', content: "Chat cleared! How can I help you?" }
    ]);
    setPendingActions([]);
  };

  // BATCH: confirm a single action by batchId — removes only that card, chat stays intact
  const confirmAction = (batchId) => {
    const item = pendingActions.find(a => a.batchId === batchId);
    if (!item || !user) return;
    const { action, data } = item;
    switch (action) {
      case 'add_revision':      addRevisionFromAgent(data);               break;
      case 'add_lecture':       addLectureFromAgent(data);                break;
      case 'add_exam':          addExamFromAgent(data);                   break;
      case 'add_test':          addTestFromAgent(data);                   break;
      case 'add_task':          addTaskFromAgent(data.text);              break;
      case 'add_coursework':    addCourseworkFromAgent(data);             break;
      case 'start_focus':       setupFocusTimerFromAgent(data.subject, data.minutes); break;
      case 'edit_task':         editTaskFromAgent(data.id, data.newText); break;
      case 'edit_coursework':   editCourseworkFromAgent(data.id, data.fields); break;
      case 'edit_exam':         editExamFromAgent(data.id, data.fields);  break;
      case 'edit_revision':     editRevisionFromAgent(data.id, data.fields); break;
      case 'delete_task':       deleteTaskFromAgent(data.id);             break;
      case 'delete_coursework': deleteCourseworkFromAgent(data.id);       break;
      case 'delete_exam':       deleteExamFromAgent(data.id);             break;
      case 'delete_lecture':    deleteLectureFromAgent(data.id);          break;
      case 'delete_revision':   deleteRevisionFromAgent(data.id);         break;
      default: console.warn("Unknown action:", action);
    }
    // Remove only this card — all other cards and full chat history remain intact
    setPendingActions(prev => prev.filter(a => a.batchId !== batchId));
  };

  // BATCH: dismiss a single action by batchId — card vanishes, chat untouched
  const dismissAction = (batchId) => {
    setPendingActions(prev => prev.filter(a => a.batchId !== batchId));
  };

  // --- RENDER ---
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner"></div>
        <h1 className="loading-logo">FOCUS FLOW</h1>
        <p className="loading-subtext">LOADING...</p>
        <style>{`
          .auth-loading { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 30%, #0a1a1a, #000); }
          .loading-spinner { width: 60px; height: 60px; border: 4px solid rgba(0, 255, 249, 0.2); border-top: 4px solid #00fff9; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 30px; box-shadow: 0 0 15px #00fff9; }
          .loading-logo { font-size: 2.5rem; font-weight: 900; color: #00fff9; letter-spacing: 2px; text-shadow: 0 0 15px #00fff9, 0 0 30px #00fff9; animation: pulse 1.5s ease-in-out infinite; margin: 0; }
          .loading-subtext { margin-top: 15px; font-size: 0.9rem; color: #00fff9; letter-spacing: 4px; animation: pulse 1.5s ease-in-out infinite; opacity: 0.8; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          @keyframes pulse { 0% { opacity: 0.5; text-shadow: 0 0 10px #00fff9; } 50% { opacity: 1; text-shadow: 0 0 20px #00fff9, 0 0 30px #00fff9; } 100% { opacity: 0.5; text-shadow: 0 0 10px #00fff9; } }
        `}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1 className="auth-logo">FOCUS FLOW</h1>
          <div className="auth-tabs">
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError(''); }}>LOGIN</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => { setAuthMode('signup'); setAuthError(''); }}>SIGN UP</button>
          </div>
          <form onSubmit={handleAuthSubmit}>
            <input type="email" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="auth-input" autoComplete="email" />
            <div className="password-wrapper">
              <input type={showPassword ? 'text' : 'password'} placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="auth-input" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} />
              <button type="button" className="toggle-password" onClick={() => setShowPassword(!showPassword)}>{showPassword ? '🔒' : '👁️'}</button>
            </div>
            {authMode === 'signup' && (
              <>
                <div className="password-checklist">
                  <p style={{ color: passwordLongEnough ? '#00fff9' : '#555' }}>{passwordLongEnough ? '✓' : '○'} At least 6 characters</p>
                  <p style={{ color: passwordHasNumber ? '#00fff9' : '#555' }}>{passwordHasNumber ? '✓' : '○'} At least one number</p>
                </div>
                <div className="password-wrapper">
                  <input type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirm Password" value={authConfirmPassword} onChange={(e) => setAuthConfirmPassword(e.target.value)} className="auth-input" autoComplete="new-password" />
                  <button type="button" className="toggle-password" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>{showConfirmPassword ? '🔒' : '👁️'}</button>
                </div>
              </>
            )}
            {authError && <div className="auth-error">{authError}</div>}
            <button type="submit" className="auth-submit-btn" disabled={authMode === 'signup' && !isSignupValid()}>{authMode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}</button>
          </form>
          <p className="auth-switch-text">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>{authMode === 'login' ? 'Sign Up' : 'Login'}</button>
          </p>
        </div>
        <style>{`
          .auth-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 30%, #0a1a1a, #000); padding: 20px; }
          .auth-card { width: 100%; max-width: 420px; background: rgba(15, 15, 15, 0.75); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(0, 255, 249, 0.3); border-radius: 30px; padding: 40px 30px; box-shadow: 0 0 40px rgba(0, 255, 249, 0.15), inset 0 0 20px rgba(0, 255, 249, 0.05); }
          .auth-logo { font-size: 2.5rem; font-weight: 900; color: #00fff9; text-align: center; margin-bottom: 30px; letter-spacing: 2px; text-shadow: 0 0 15px #00fff9, 0 0 30px #00fff9; }
          .auth-tabs { display: flex; gap: 15px; margin-bottom: 30px; }
          .auth-tabs button { flex: 1; background: transparent; border: 1px solid rgba(0, 255, 249, 0.2); color: #aaa; padding: 14px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; letter-spacing: 1px; cursor: pointer; transition: all 0.2s; }
          .auth-tabs button.active { background: rgba(0, 255, 249, 0.1); color: #00fff9; border-color: #00fff9; box-shadow: 0 0 15px #00fff9; text-shadow: 0 0 8px #00fff9; }
          .auth-input { background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(0, 255, 249, 0.3); border-radius: 8px; padding: 15px; color: #fff; width: 100%; box-sizing: border-box; margin-bottom: 15px; font-size: 1rem; transition: all 0.2s ease; }
          .auth-input:focus { outline: none; border-color: #00fff9; box-shadow: 0 0 10px rgba(0, 255, 249, 0.5); }
          .auth-input::placeholder { color: rgba(255, 255, 255, 0.5); }
          .password-wrapper { position: relative; }
          .toggle-password { position: absolute; right: 15px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #00fff9; font-size: 1.2rem; cursor: pointer; opacity: 0.8; transition: opacity 0.2s; }
          .toggle-password:hover { opacity: 1; }
          .password-checklist { margin: -5px 0 10px 0; font-size: 0.8rem; text-align: left; padding-left: 5px; }
          .password-checklist p { margin: 4px 0; transition: color 0.2s; }
          .auth-submit-btn { width: 100%; background: #00fff9; color: #000; border: none; padding: 16px; border-radius: 14px; font-weight: 900; font-size: 1rem; letter-spacing: 1px; margin-top: 20px; cursor: pointer; box-shadow: 0 0 20px #00fff9; transition: all 0.2s; }
          .auth-submit-btn:disabled { opacity: 0.5; box-shadow: none; cursor: not-allowed; }
          .auth-error { color: #ff3a6f; font-size: 0.8rem; margin-top: 10px; text-align: center; text-shadow: 0 0 8px #ff3a6f; }
          .auth-switch-text { text-align: center; margin-top: 20px; color: #888; font-size: 0.8rem; }
          .auth-switch-text button { background: none; border: none; color: #00fff9; font-weight: 700; cursor: pointer; text-decoration: underline; }
        `}</style>
      </div>
    );
  }

  // --- MAIN AUTHENTICATED APP ---
  return (
    <div className="App">
      {showProfile && (
        <div className="profile-overlay" onClick={() => setShowProfile(false)}>
          <div className="profile-modal card-styled" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setShowProfile(false)}>✕</button>
            <h3>PROFILE</h3>
            <p className="profile-email">{user.email}</p>
            <button className="profile-btn logout" onClick={handleLogout}>🚪 SECURE LOGOUT</button>
            <button className="profile-btn danger" onClick={handleDeleteAccount}>⚠️ DELETE ACCOUNT</button>
          </div>
        </div>
      )}

      <header className="top-bar">
        {currentScreen === 'FOCUS' && (isActive || seconds < totalTime) ? (
            <h2 style={{ color: totalTime === customMinutes * 60 ? 'var(--neon)' : 'var(--revision)', textTransform: 'uppercase', fontSize: '1.2rem', fontWeight: '900', letterSpacing: '2px', margin: 0 }}>
                {totalTime !== customMinutes * 60 ? (totalTime === 900 ? '🏖️ LONG BREAK' : '☕ SHORT BREAK') : (focusGoal || 'FOCUSING')}
            </h2>
        ) : (
            <h1 className="logo">FOCUS FLOW</h1>
        )}
        <button className="settings-gear" onClick={() => setShowProfile(true)}>⚙️</button>
      </header>

      <main className="content">
        {currentScreen === 'HOME' && (
          <div className="magic-flow-container">
            <h4 className="section-label">TODAY'S FLOW ({todayName.toUpperCase()})</h4>
            {todaysActivities.length === 0 ? <p style={{textAlign:'center', opacity:0.5}}>No activities scheduled for today.</p> : 
              todaysActivities.map(item => {
                const status = getStatus(item.startTime, item.endTime);
                return (
                  <div key={item.id} className={`flow-card-new ${status.toLowerCase()} cat-${item.category.toLowerCase()}`}>
                    <div className="flow-category-tag">{item.category}</div>
                    <div className={`magic-badge ${status.toLowerCase()}`}>{status}</div>
                    <span className="flow-time">{item.startTime} - {item.endTime || '--:--'}</span>
                    <h3 className="flow-subject">{item.subject.toUpperCase()}</h3>
                    <span className="flow-venue">{item.venue || 'No Venue'}</span>
                    {item.category === 'TEST' && item.dueTime && (<span className="test-due-badge">Due: {item.dueTime}</span>)}
                  </div>
                );
            })}
          </div>
        )}

        {currentScreen === 'TIMETABLE' && (
          <div className="center-view">
            <div className="tab-pill">
              {['LECTURES', 'REVISION', 'EXAMS'].map(t => (
                <button key={t} className={ttTab === t ? 'active' : ''} onClick={() => {setTtTab(t); clearForm();}}>{t}</button>
              ))}
            </div>
            {ttTab === 'REVISION' && (
              <button className="ai-gen-btn" onClick={() => setCurrentScreen('AI_GEN')}>✨ GENERATE WITH AI</button>
            )}
            <div className="form-container">
              <h4 className="input-header">{editingId ? 'EDIT' : 'ADD NEW'} {ttTab}</h4>
              <div className="input-group">
                <label>{ttTab === 'EXAMS' ? 'DATE' : 'DAY'}</label>
                {ttTab === 'EXAMS' ? <input type="date" value={date} onChange={e => setDate(e.target.value)} className="neon-input date-picker" /> : 
                  <select value={day} onChange={e => setDay(e.target.value)} className="neon-input">
                    {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d => <option key={d}>{d}</option>)}
                  </select>}
              </div>
              <div className="row">
                <div className="input-group flex-1"><label>START</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="neon-input time-picker" /></div>
                <div className="input-group flex-1"><label>END</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="neon-input time-picker" /></div>
              </div>
              <div className="input-group"><label>SUBJECT</label><input placeholder="Subject Name" value={subject} onChange={e => setSubject(e.target.value)} className="neon-input" /></div>
              <div className="input-group"><label>VENUE / ROOM</label><input placeholder="Room J1, etc." value={venue} onChange={e => setVenue(e.target.value)} className="neon-input" /></div>
              <button className={`action-btn main ${editingId ? 'edit-mode' : ''}`} onClick={saveEntry}>{editingId ? 'UPDATE ENTRY' : `SAVE ${ttTab}`}</button>
              {editingId && <button className="cancel-btn" onClick={clearForm}>Cancel Edit</button>}
            </div>
            <div className="manage-section">
              <h4 className="section-label" style={{marginTop: '40px'}}>MANAGE {ttTab}</h4>
              {(ttTab === 'LECTURES' ? lectures : ttTab === 'REVISION' ? revisions : exams).map(item => (
                <div key={item.id} className="manage-item card-styled">
                  <div className="m-info"><b>{item.subject}</b><br/>{item.day || item.date} | {item.startTime}</div>
                  <div className="m-actions">
                    <button className="edit-btn-mini" onClick={() => handleEdit(item)}>EDIT</button>
                    <button className="del-btn-mini" onClick={() => confirmDelete(item.id, ttTab)}>REMOVE</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentScreen === 'AI_GEN' && (
          <div className="center-view">
            <button className="back-btn" onClick={() => setCurrentScreen('TIMETABLE')} style={{ alignSelf: 'flex-start', marginBottom: '10px' }}>← Back to Schedule</button>
            <h4 className="section-label">GENERATE WITH AI</h4>
            {!isGenerating && recommendations.length === 0 && (
              <div className="ai-intro-card">
                <p style={{color: '#aaa', marginBottom: '20px'}}>Let AI analyse your schedule, deadlines, and study habits to suggest perfect revision slots for today.</p>
                <button className="ai-gen-btn" onClick={generateRecommendations}>🚀 GENERATE REVISION TIMETABLE</button>
              </div>
            )}
            {isGenerating && (
              <div className="scanning-animation card-styled">
                <div className="pulse-icon">🧠</div>
                <div className="shimmer-text">Generating Revision Timetable...</div>
                <div className="progress-bar"><div className="progress-fill shimmer"></div></div>
                <p style={{color: '#666', fontSize: '0.7rem', marginTop: '15px'}}>Analysing free slots, deadlines, and focus history...</p>
              </div>
            )}
            {!isGenerating && recommendations.length > 0 && (
              <div className="recommendations-container">
                <h4 className="section-label" style={{marginBottom: '20px'}}>YOUR SMART REVISION PLAN</h4>
                {recommendations.map(rec => (
                  <div key={rec.id} className="recommendation-card neon-card">
                    <button className="rec-remove-btn" onClick={() => dismissRecommendation(rec.id)}>✕</button>
                    <div className="rec-header">
                      <span className="rec-subject">{rec.subject}</span>
                      <span className="rec-time">{rec.startTime} – {rec.endTime}</span>
                    </div>
                    <div className="rec-reasoning">{rec.reasoning}</div>
                    <button className="rec-add-btn" onClick={() => handleAddRecommendation(rec)}>+</button>
                  </div>
                ))}
                <button className="cancel-btn" onClick={generateRecommendations} style={{marginTop: '20px'}}>🔄 Regenerate</button>
              </div>
            )}
          </div>
        )}

        {/* ===== AI ASSISTANT SCREEN ===== */}
        {currentScreen === 'AI_ASSISTANT' && (
          <div className="ai-assistant-panel">
            <div className="glass-panel">

              <div className="assistant-header">
                <div className="assistant-avatar">✨</div>
                <h4>FocusFlow AI Assistant</h4>
              </div>

              <div className="chat-messages-glass" ref={chatContainerRef}>
                {assistantMessages.map((msg, idx) => (
                  <div key={idx} className={`message-wrapper ${msg.role} ${msg.isSystem ? 'system' : ''}`}>
                    <div className="message-bubble">
                      {msg.role === 'assistant' && !msg.isSystem && <span className="ai-icon">🧠</span>}
                      <span className="message-text">{msg.content}</span>
                    </div>
                  </div>
                ))}
                {assistantLoading && (assistantMessages.length === 0 || assistantMessages[assistantMessages.length - 1]?.role !== 'assistant') && (
                  <div className="message-wrapper assistant">
                    <div className="message-bubble typing-indicator">
                      <span>✨</span> Thinking...
                    </div>
                  </div>
                )}
                <div ref={assistantEndRef} />
              </div>

              {/* Input area — recorder-style mic */}
              <div className="input-area">
                <textarea
                  placeholder={isListening ? "Listening... Tap mic to stop" : "Ask me anything or say 'add a task...'"}
                  value={assistantInput}
                  rows={1}
                  onChange={e => {
                    if (!isListening) {
                      setAssistantInput(e.target.value);
                      // Auto-expand up to 5 lines
                      e.target.style.height = 'auto';
                      const lineHeight = 20;
                      const maxHeight = lineHeight * 5;
                      e.target.style.height = Math.min(e.target.scrollHeight, maxHeight) + 'px';
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !isListening) {
                      e.preventDefault();
                      sendAssistantMessage();
                      // Reset height after send
                      e.target.style.height = 'auto';
                    }
                  }}
                  className={`glass-input${isListening ? ' listening-placeholder' : ''}`}
                />
                {/* Google-style minimalist SVG mic — neon glow when listening */}
                <button
                  onClick={toggleListening}
                  className={`mic-btn${isListening ? ' listening' : ''}`}
                  title={isListening ? "Tap to stop recording" : "Tap to start voice input"}
                  disabled={assistantLoading}
                  aria-label="Voice input"
                >
                  <svg width="18" height="22" viewBox="0 0 18 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="5" y="1" width="8" height="13" rx="4" stroke="currentColor" strokeWidth="1.8" fill="none"/>
                    <path d="M1 11C1 15.418 4.582 19 9 19C13.418 19 17 15.418 17 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <line x1="9" y1="19" x2="9" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <line x1="6" y1="21" x2="12" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </button>
                <button onClick={sendAssistantMessage} className="send-btn" disabled={assistantLoading || isListening}>➤</button>
              </div>

              {/* Clear chat at very bottom */}
              <div className="clear-chat-row">
                <button onClick={clearAssistantHistory} className="clear-chat-btn">🗑️ Clear Chat</button>
              </div>
            </div>

            {/* BATCH Safe-Way cards — one card per pending action, each dismissable independently */}
            {pendingActions.length > 0 && (
              <div className="confirmation-cards-stack">
                {pendingActions.map((item) => (
                  <div key={item.batchId} className="confirmation-card">
                    <div className="confirmation-header">
                      <span className="confirm-action-type">
                        {item.action.startsWith('delete') ? '🗑️ Confirm Delete' :
                         item.action.startsWith('edit') ? '✏️ Confirm Edit' : '✨ Confirm Add'}
                      </span>
                    </div>
                    <div className="confirmation-details">
                      {item.action === 'add_revision' && (<><p><b>{item.data.subject}</b> — Revision</p><p>{item.data.day || todayName} · {item.data.startTime}–{item.data.endTime}</p>{item.data.venue && <p className="conf-meta">{item.data.venue}</p>}</>)}
                      {item.action === 'add_lecture' && (<><p><b>{item.data.subject}</b> — Lecture</p><p>{item.data.day} · {item.data.startTime}–{item.data.endTime}</p>{item.data.venue && <p className="conf-meta">{item.data.venue}</p>}</>)}
                      {item.action === 'add_exam' && (<><p><b>{item.data.subject}</b> — Exam</p><p>{item.data.date} · {item.data.startTime}–{item.data.endTime}</p></>)}
                      {item.action === 'add_test' && (<><p><b>{item.data.text}</b> — Test</p><p>Due {item.data.deadline}{item.data.dueTime ? ` at ${item.data.dueTime}` : ''}</p></>)}
                      {item.action === 'add_task' && (<p><b>Task:</b> {item.data.text}</p>)}
                      {item.action === 'add_coursework' && (<><p><b>{item.data.text}</b> — {item.data.type}</p><p>Due {item.data.deadline}{item.data.dueTime ? ` at ${item.data.dueTime}` : ''}</p></>)}
                      {item.action === 'start_focus' && (<><p><b>{item.data.subject}</b></p><p>{item.data.minutes} min focus session</p></>)}
                      {item.action === 'edit_task' && (<><p><b>Edit task</b></p><p>New: "{item.data.newText}"</p></>)}
                      {item.action === 'edit_coursework' && (<><p><b>Edit coursework</b></p><p>{JSON.stringify(item.data.fields)}</p></>)}
                      {item.action === 'edit_exam' && (<><p><b>Edit exam</b></p><p>{JSON.stringify(item.data.fields)}</p></>)}
                      {item.action === 'edit_revision' && (<><p><b>Edit revision</b></p><p>{JSON.stringify(item.data.fields)}</p></>)}
                      {item.action === 'delete_task' && (<p>Delete: <b>"{item.data.label}"</b></p>)}
                      {item.action === 'delete_coursework' && (<p>Delete: <b>"{item.data.label}"</b></p>)}
                      {item.action === 'delete_exam' && (<p>Delete exam: <b>"{item.data.label}"</b></p>)}
                      {item.action === 'delete_lecture' && (<p>Delete lecture: <b>"{item.data.label}"</b></p>)}
                      {item.action === 'delete_revision' && (<p>Delete revision: <b>"{item.data.label}"</b></p>)}
                    </div>
                    <div className="confirmation-buttons">
                      <button className="confirm-yes" onClick={() => confirmAction(item.batchId)}>✓ Confirm</button>
                      <button className="confirm-no" onClick={() => dismissAction(item.batchId)}>✗ Cancel</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {currentScreen === 'ACADEMIC' && (
          <div className="center-view">
            <h4 className="section-label">COURSEWORK</h4>
            <div className="form-container" style={{marginBottom: '25px'}}>
              <div className="input-group"><label>TYPE</label><select value={cwType} onChange={e => setCwType(e.target.value)} className="neon-input"><option>Assignment</option><option>Coursework</option><option>Test</option><option>Discussion</option></select></div>
              <div className="row" style={{gap: '10px'}}>
                <div className="input-group flex-1"><label>DEADLINE DATE</label><input type="date" value={cwDeadline} onChange={e => setCwDeadline(e.target.value)} className="neon-input date-picker" /></div>
                <div className="input-group flex-1"><label>DUE TIME</label><input type="time" value={cwDueTime} onChange={e => setCwDueTime(e.target.value)} className="neon-input time-picker" /></div>
              </div>
              <div className="input-row" style={{marginTop: '10px'}}>
                <input placeholder="Subject/Topic..." value={cwInput} onChange={e => setCwInput(e.target.value)} className="neon-input" />
                <button className="add-btn" onClick={saveAcademic}>+</button>
              </div>
            </div>
            <div className="task-list-container">
              {[...coursework].sort((a,b) => a.completed - b.completed).map(cw => (
                <div key={cw.id} className={`task-card card-styled ${cw.completed ? 'completed' : ''}`}>
                  <div className={`check-circle ${cw.completed ? 'filled' : ''}`} onClick={() => toggleCw(cw.id)}>{cw.completed && "✓"}</div>
                  <div className="task-text" style={{textAlign: 'left', display: 'flex', flexDirection: 'column'}}>
                    <span style={{fontSize: '0.6rem', color: 'var(--neon)', fontWeight: '900'}}>{cw.type?.toUpperCase()}</span>
                    <span style={{textDecoration: cw.completed ? 'line-through' : 'none'}}>{cw.text}</span>
                    <span style={{fontSize: '0.65rem', color: '#666'}}>Due: {cw.deadline || 'No Date'} | {cw.dueTime || '--:--'}</span>
                  </div>
                  <span className="del-icon" onClick={() => confirmDelete(cw.id, 'CW')}>✕</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentScreen === 'TASKS' && (
          <div className="center-view">
            <h4 className="section-label">DAILY TASKS</h4>
            <div className="input-row">
              <input placeholder="Add task..." value={taskInput} onChange={e => setTaskInput(e.target.value)} className="neon-input" onKeyPress={(e) => {if(e.key === 'Enter') addTask();}} />
              <button className="add-btn" onClick={addTask}>+</button>
            </div>
            {tasks.some(t => t.completed) && (
              <button className="cancel-btn" style={{marginBottom: '15px', textDecoration: 'none', fontSize: '0.7rem', fontWeight: '800'}} onClick={clearCompletedTasks}>🧹 CLEAR COMPLETED</button>
            )}
            <div className="task-list-container">
              {[...tasks].sort((a,b) => a.completed - b.completed).map(t => (
                <div key={t.id} className={`task-card card-styled ${t.completed ? 'completed' : ''}`}>
                  <div className={`check-circle ${t.completed ? 'filled' : ''}`} onClick={() => toggleTask(t.id)}>{t.completed && "✓"}</div>
                  <span className="task-text">{t.text}</span>
                  <span className="del-icon" onClick={() => confirmDelete(t.id, 'TASK')}>✕</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentScreen === 'FOCUS' && (
          <div className="center-view timer-screen">
            {!isActive && seconds === totalTime ? (
              <>
                <div className="focus-input-wrapper">
                  <p className="focus-label">WHAT ARE YOU FOCUSING ON?</p>
                  {!isCustomFocus ? (
                    <select className="neon-input focus-input-box" value={focusGoal} onChange={handleFocusChange}>
                      <option value="">-- Select a subject --</option>
                      {subjectOptions.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                      <option value="custom">✏️ Type custom...</option>
                    </select>
                  ) : (
                    <input placeholder="Enter custom focus goal" value={customFocusInput} onChange={handleCustomFocusChange} className="neon-input focus-input-box" autoFocus />
                  )}
                </div>
                <div className="minutes-input-wrapper">
                  <label className="minutes-label">SESSION LENGTH (MINUTES)</label>
                  <input type="number" min="1" max="120" value={customMinutes} onChange={handleMinutesChange} className="neon-input minutes-input" disabled={isActive || seconds < totalTime} />
                </div>
              </>
            ) : <div style={{height: '110px'}}></div>}

            <div className={`timer-container ${isActive ? 'timer-active' : ''}`}>
              <svg className="timer-svg" viewBox="0 0 300 300">
                <circle cx="150" cy="150" r="140" className="timer-bg" />
                <circle cx="150" cy="150" r="140" className="timer-progress" style={{ strokeDashoffset: progressOffset, stroke: totalTime === customMinutes * 60 ? 'var(--neon)' : 'var(--revision)' }} />
              </svg>
              <div style={{display:'flex', flexDirection:'column', alignItems:'center', zIndex: 2}}>
                <div className="timer-val" style={{fontSize: '5rem'}}>{Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, '0')}</div>
              </div>
            </div>

            <div className="timer-controls">
              <button className={`timer-btn start ${isActive ? 'pause' : ''}`} onClick={() => {if(!isActive && !focusGoal && totalTime === customMinutes * 60) { alert("Please enter a focus goal first!"); return; } setIsActive(!isActive);}}>{isActive ? 'PAUSE' : (seconds < totalTime ? 'RESUME' : 'START SESSION')}</button>
              <button className="timer-btn restart" onClick={() => {setIsActive(false); setTotalTime(customMinutes * 60); setSeconds(customMinutes * 60);}}>RESET</button>
            </div>

            <div className="sessions-center-container">
                <p className="sessions-center-text">SESSIONS TODAY: <strong>{sessionsToday}</strong></p>
                <p className="sessions-center-text" style={{fontSize: '0.6rem', opacity: 0.8, marginTop: '5px'}}>TOTAL SESSIONS: {sessionsCompleted}</p>
            </div>

            <div className="history-toggle-wrapper">
              <button className="history-toggle-btn" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide' : 'View'} Recent Sessions</button>
            </div>

            {showHistory && (
              <div className="recent-activity-container">
                <h4 className="section-label" style={{marginTop: '20px', marginBottom: '15px'}}>📋 RECENT ACTIVITY</h4>
                {recentFocusHistory.length === 0 ? (
                  <p style={{textAlign:'center', opacity:0.5, fontSize:'0.8rem'}}>No sessions logged yet.</p>
                ) : (
                  recentFocusHistory.map((entry, idx) => (
                    <div key={idx} className="recent-activity-card card-styled">
                      <span className="activity-subject">{entry.subjectName}</span>
                      <span className="activity-duration">{entry.duration} min</span>
                      <span className="activity-time">{new Date(entry.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="nav-bar">
        <button onClick={() => setCurrentScreen('HOME')} className={currentScreen === 'HOME' ? 'active' : ''}>🏠<span>Home</span></button>
        <button onClick={() => setCurrentScreen('TIMETABLE')} className={currentScreen === 'TIMETABLE' || currentScreen === 'AI_GEN' ? 'active' : ''}>📅<span>Timetables</span></button>
        <button onClick={() => setCurrentScreen('AI_ASSISTANT')} className={currentScreen === 'AI_ASSISTANT' ? 'active' : ''}>✨<span>AI</span></button>
        <button onClick={() => setCurrentScreen('ACADEMIC')} className={currentScreen === 'ACADEMIC' ? 'active' : ''}>📄<span>Coursework</span></button>
        <button onClick={() => setCurrentScreen('TASKS')} className={currentScreen === 'TASKS' ? 'active' : ''}>✅<span>Tasks</span></button>
        <button onClick={() => setCurrentScreen('FOCUS')} className={currentScreen === 'FOCUS' ? 'active' : ''}>⏱️<span>Focus</span></button>
      </nav>

      <style>{`
        :root { --neon: #00fff9; --revision: #c471ed; --exam: #f39c12; --bg: #000; }
        body { margin: 0; background: var(--bg); color: #fff; font-family: 'Inter', sans-serif; }
        .App { min-height: 100vh; padding-bottom: 120px; }
        .back-btn { background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #aaa; padding: 8px 16px; border-radius: 20px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; margin-bottom: 15px; align-self: flex-start; }
        .back-btn:hover { border-color: var(--neon); color: var(--neon); }
        .ai-intro-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 30px 20px; backdrop-filter: blur(8px); }
        .scanning-animation { padding: 40px 20px; text-align: center; }
        .pulse-icon { font-size: 3rem; animation: pulse 1.5s infinite; }
        .shimmer-text { font-size: 1.2rem; font-weight: 700; color: var(--neon); margin: 20px 0 10px; text-transform: uppercase; letter-spacing: 2px; }
        .progress-bar { width: 80%; height: 4px; background: rgba(255,255,255,0.1); margin: 20px auto; border-radius: 2px; overflow: hidden; }
        .progress-fill { height: 100%; width: 30%; background: linear-gradient(90deg, transparent, var(--neon), transparent); animation: shimmerMove 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); text-shadow: 0 0 15px var(--neon); } 100% { opacity: 0.5; transform: scale(1); } }
        @keyframes shimmerMove { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        .recommendations-container { margin-top: 10px; }
        .recommendation-card { padding: 20px; padding-top: 30px; margin-bottom: 15px; text-align: left; display: flex; flex-direction: column; position: relative; }
        .neon-card { background: rgba(0, 0, 0, 0.6) !important; border: 2px solid var(--neon) !important; box-shadow: 0 0 20px rgba(0, 255, 249, 0.3), inset 0 0 10px rgba(0, 255, 249, 0.1); backdrop-filter: blur(12px); transition: all 0.3s ease; border-radius: 20px !important; }
        .neon-card:hover { box-shadow: 0 0 30px var(--neon), inset 0 0 15px rgba(0, 255, 249, 0.2); transform: translateY(-2px); }
        .rec-remove-btn { position: absolute; top: 10px; right: 10px; background: transparent; border: none; color: #f44; font-size: 1.2rem; cursor: pointer; opacity: 0.6; transition: opacity 0.2s; padding: 5px; }
        .rec-remove-btn:hover { opacity: 1; color: #ff6666; }
        .rec-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .rec-subject { font-size: 1.3rem; font-weight: 800; color: var(--neon); text-transform: uppercase; }
        .rec-time { font-size: 0.8rem; font-weight: 700; color: #aaa; }
        .rec-reasoning { font-size: 0.8rem; color: #ccc; margin-bottom: 15px; line-height: 1.4; }
        .rec-add-btn { background: transparent; border: 2px solid var(--neon); color: var(--neon); width: 40px; height: 40px; border-radius: 50%; font-size: 1.8rem; font-weight: 300; display: flex; align-items: center; justify-content: center; cursor: pointer; margin-left: auto; transition: all 0.2s; }
        .rec-add-btn:hover { background: var(--neon); color: #000; box-shadow: 0 0 20px var(--neon); }
        .test-due-badge { display: block; font-size: 0.65rem; color: var(--exam); font-weight: 800; margin-top: 5px; }
        .cat-test .flow-category-tag { background: #e67e22; color: #000; }
        .flow-card-new, .task-card, .card-styled, .manage-item, .form-container { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .magic-flow-container { width: 100%; max-width: 400px; margin: 0 auto; padding: 20px; position: relative; box-sizing: border-box; }
        .magic-flow-container::before { content: ''; position: absolute; top: 80px; bottom: 40px; left: 35px; width: 2px; background: linear-gradient(to bottom, rgba(0,255,249,0), var(--neon), rgba(0,255,249,0)); z-index: 0; }
        .flow-card-new { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; padding: 20px; margin-bottom: 15px; margin-left: 35px; position: relative; text-align: left; z-index: 1; transition: all 0.3s ease; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .flow-card-new.live { border-color: var(--neon); box-shadow: 0 0 20px rgba(0,255,249,0.1); background: rgba(0, 255, 249, 0.05); transform: scale(1.02); }
        .flow-card-new.past { opacity: 0.3; filter: grayscale(1); }
        .magic-badge { float: right; font-size: 0.55rem; font-weight: 900; padding: 3px 8px; border-radius: 10px; border: 1px solid #333; text-transform: uppercase; }
        .magic-badge.live { background: var(--neon); color: #000; border: none; box-shadow: 0 0 10px var(--neon); }
        .flow-category-tag { display: inline-block; font-size: 0.5rem; font-weight: 900; padding: 2px 8px; border-radius: 4px; margin-bottom: 10px; text-transform: uppercase; }
        .cat-lecture .flow-category-tag { background: var(--neon); color: #000; }
        .cat-revision .flow-category-tag { background: var(--revision); color: #fff; }
        .cat-exam .flow-category-tag { background: var(--exam); color: #000; }
        .flow-subject { font-size: 1.4rem; font-weight: 800; margin: 5px 0; color: #fff; }
        .flow-time { font-size: 0.85rem; font-weight: 700; color: var(--neon); display: block; }
        .flow-venue { font-size: 0.75rem; color: #888; font-weight: 600; }
        .neon-input { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(0, 255, 249, 0.3); padding: 15px; border-radius: 12px; color: #fff; width: 100%; box-sizing: border-box; margin-bottom: 15px; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); transition: all 0.2s ease; }
        .neon-input:focus { outline: none; border-color: var(--neon); box-shadow: 0 0 15px rgba(0, 255, 249, 0.4); }
        .neon-input::placeholder { color: rgba(255, 255, 255, 0.3); }
        .ai-gen-btn { width: 100%; background: linear-gradient(90deg, #c471ed, #00fff9); border: none; padding: 12px; border-radius: 12px; font-weight: 900; font-size: 0.75rem; margin-bottom: 15px; cursor: pointer; color: #fff; letter-spacing: 1px; }
        .date-picker::-webkit-calendar-picker-indicator, .time-picker::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
        .task-card.completed { opacity: 0.3; filter: grayscale(1); }
        .top-bar { padding: 60px 20px 20px; position: relative; text-align: center; }
        .logo { font-size: 2.2rem; font-weight: 900; color: var(--neon); letter-spacing: -1px; margin: 0; text-shadow: 0 0 15px var(--neon); }
        .settings-gear { position: absolute; right: 25px; top: 65px; background: none; border: none; color: var(--neon); font-size: 1.5rem; cursor: pointer; opacity: 0.8; transition: all 0.2s; }
        .settings-gear:hover { opacity: 1; text-shadow: 0 0 10px var(--neon); }
        .center-view { width: 100%; max-width: 400px; margin: 0 auto; padding: 20px; box-sizing: border-box; text-align: center; }
        .section-label { color: var(--neon); font-size: 0.8rem; letter-spacing: 2px; font-weight: 800; margin-bottom: 25px; text-align: center; text-shadow: 0 0 8px var(--neon); }
        .task-card { display: flex; align-items: center; justify-content: space-between; padding: 20px; margin-bottom: 12px; min-height: 70px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .task-text { flex: 1; font-weight: 700; font-size: 1.1rem; padding: 0 15px; text-align: center; }
        .check-circle { width: 26px; height: 26px; border: 2px solid var(--neon); border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--neon); cursor: pointer; }
        .check-circle.filled { background: var(--neon); color: #000; }
        .del-icon { color: #f44; cursor: pointer; flex-shrink: 0; padding: 5px; }
        .form-container { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 25px; border-radius: 20px; text-align: left; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .input-header { color: var(--neon); font-size: 0.7rem; margin-bottom: 20px; }
        .input-group label { font-size: 0.6rem; color: #aaa; font-weight: 900; }
        .row { display: flex; gap: 10px; }
        .flex-1 { flex: 1; }
        .action-btn.main { background: var(--neon); color: #000; width: 100%; padding: 18px; border-radius: 14px; font-weight: 900; border: none; margin-top: 10px; cursor: pointer; box-shadow: 0 0 15px var(--neon); }
        .action-btn.edit-mode { background: #fff; color: #000; }
        .cancel-btn { background: none; border: none; color: #f44; width: 100%; margin-top: 10px; font-size: 0.8rem; cursor: pointer; text-decoration: underline; }
        .focus-input-wrapper { margin-top: 20px; margin-bottom: 20px; }
        .focus-label { font-size: 0.65rem; color: #888; font-weight: 900; letter-spacing: 1px; margin-bottom: 10px; text-transform: uppercase; }
        .focus-input-box { text-align: center; font-size: 1.1rem; font-weight: 700; }
        .minutes-input-wrapper { margin: 15px 0 10px; text-align: center; }
        .minutes-label { font-size: 0.6rem; color: #888; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 5px; display: block; }
        .minutes-input { width: 100px; text-align: center; margin: 0 auto; padding: 10px; font-size: 1.2rem; font-weight: 700; }
        .timer-container { position: relative; width: 260px; height: 260px; margin: 20px auto; display: flex; align-items: center; justify-content: center; }
        .timer-svg { position: absolute; transform: rotate(-90deg); width: 100%; height: 100%; }
        .timer-bg { fill: none; stroke: rgba(255, 255, 255, 0.05); stroke-width: 8; }
        .timer-progress { fill: none; stroke: var(--neon); stroke-width: 8; stroke-linecap: round; stroke-dasharray: 880; transition: stroke-dashoffset 1s linear; }
        .timer-val { font-size: 5rem; font-weight: 900; color: #fff; text-shadow: 0 0 20px var(--neon); }
        .timer-controls { display: flex; gap: 15px; justify-content: center; }
        .timer-btn { padding: 15px 35px; border-radius: 40px; font-weight: 900; border: none; cursor: pointer; }
        .timer-btn.start { background: #fff; color: #000; padding: 12px 30px; font-size: 0.9rem; border-radius: 30px; box-shadow: 0 0 15px #fff; }
        .timer-btn.start.pause { background: rgba(255, 255, 255, 0.05); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); box-shadow: none; }
        .timer-btn.restart { background: rgba(255, 255, 255, 0.05); color: #888; border: 1px solid rgba(255, 255, 255, 0.1); }
        .nav-bar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(10,10,10,0.95); border: 1px solid #222; padding: 8px 12px; border-radius: 40px; display: flex; gap: 4px; backdrop-filter: blur(15px); z-index: 100; width: auto; max-width: 90vw; justify-content: center; }
        .nav-bar button { background: none; border: none; color: #444; display: flex; flex-direction: column; align-items: center; min-width: 44px; cursor: pointer; font-size: 0.8rem; }
        .nav-bar button span { font-size: 0.45rem; font-weight: 800; margin-top: 4px; text-transform: uppercase; }
        .nav-bar button.active { color: var(--neon); text-shadow: 0 0 8px var(--neon); }
        .tab-pill { display: flex; background: rgba(255, 255, 255, 0.03); padding: 4px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(255, 255, 255, 0.08); }
        .tab-pill button { flex: 1; background: none; color: #555; padding: 10px; border-radius: 8px; border: none; font-weight: 800; font-size: 0.7rem; cursor: pointer; }
        .tab-pill button.active { background: rgba(255, 255, 255, 0.1); color: var(--neon); }
        .card-styled { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .manage-item { display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; margin-bottom: 10px; text-align: left; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .m-actions { display: flex; gap: 8px; }
        .edit-btn-mini { background: rgba(255, 255, 255, 0.1); color: var(--neon); border: 1px solid rgba(255, 255, 255, 0.1); padding: 6px 10px; border-radius: 6px; font-size: 0.6rem; font-weight: 800; cursor: pointer; }
        .del-btn-mini { background: rgba(255, 0, 0, 0.1); color: #f55; padding: 6px 10px; border-radius: 6px; font-size: 0.6rem; font-weight: 800; border: 1px solid rgba(255, 0, 0, 0.2); cursor: pointer; }
        .add-btn { background: var(--neon); color: #000; width: 60px; border-radius: 12px; font-size: 1.5rem; font-weight: 900; border: none; cursor: pointer; box-shadow: 0 0 10px var(--neon); }
        .input-row { display: flex; gap: 10px; margin-bottom: 25px; }
        .sessions-center-text { color: #888; font-size: 0.8rem; margin-top: 20px; text-align: center; }
        .history-toggle-wrapper { margin-top: 25px; text-align: center; }
        .history-toggle-btn { background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); color: #aaa; padding: 6px 16px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; cursor: pointer; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); transition: all 0.2s ease; }
        .history-toggle-btn:hover { border-color: var(--neon); color: var(--neon); }
        .recent-activity-container { margin-top: 10px; }
        .recent-activity-card { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; margin-bottom: 8px; font-size: 0.85rem; }
        .activity-subject { font-weight: 700; color: #fff; flex: 2; text-align: left; }
        .activity-duration { color: var(--neon); font-weight: 800; flex: 1; }
        .activity-time { color: #666; font-size: 0.7rem; flex: 1; text-align: right; }
        .timer-active .timer-progress { animation: timer-glow-pulse 2s ease-in-out infinite; stroke-width: 10; }
        .timer-progress { filter: drop-shadow(0 0 5px var(--neon)); transition: all 0.3s ease; }
        @keyframes timer-glow-pulse { 0% { filter: drop-shadow(0 0 5px var(--neon)); opacity: 1; } 50% { filter: drop-shadow(0 0 15px var(--neon)); opacity: 0.8; } 100% { filter: drop-shadow(0 0 5px var(--neon)); opacity: 1; } }
        .profile-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; z-index:200; padding:20px; }
        .profile-modal { width:100%; max-width:380px; padding:30px 25px; text-align:center; position:relative; border:1px solid var(--neon); box-shadow:0 0 30px rgba(0,255,249,0.3); }
        .close-modal { position:absolute; top:15px; right:15px; background:none; border:none; color:#888; font-size:1.2rem; cursor:pointer; }
        .profile-modal h3 { color:var(--neon); margin-bottom:20px; font-size:1.4rem; text-shadow:0 0 10px var(--neon); }
        .profile-email { color:var(--neon); margin-bottom:30px; word-break:break-all; font-size:1rem; text-shadow:0 0 5px var(--neon); }
        .profile-btn { width:100%; background:transparent; border:1px solid rgba(255,255,255,0.2); color:#fff; padding:14px; border-radius:12px; font-weight:700; margin-bottom:12px; cursor:pointer; transition:all 0.2s; letter-spacing:1px; }
        .profile-btn.logout { border-color:#f44; color:#f44; box-shadow:0 0 10px rgba(255,68,68,0.3); }
        .profile-btn.logout:hover { background:#f44; color:#000; box-shadow:0 0 20px #f44; }
        .profile-btn.danger { border-color:#ff3a6f; color:#ff3a6f; box-shadow:0 0 10px rgba(255,58,111,0.3); }
        .profile-btn.danger:hover { background:#ff3a6f; color:#000; box-shadow:0 0 20px #ff3a6f; }

        /* ===== AI ASSISTANT PANEL ===== */
        .ai-assistant-panel { width: 100%; max-width: 480px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
        .glass-panel { background: rgba(20, 20, 30, 0.5); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 32px; border: 1px solid rgba(0, 255, 249, 0.25); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(0, 255, 249, 0.1) inset; overflow: hidden; display: flex; flex-direction: column; height: 72vh; max-height: 620px; }
        .assistant-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid rgba(0, 255, 249, 0.2); }
        .assistant-header h4 { margin: 0; font-size: 0.95rem; font-weight: 700; letter-spacing: 0.5px; background: linear-gradient(135deg, #fff, var(--neon)); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .assistant-avatar { font-size: 1.4rem; filter: drop-shadow(0 0 6px var(--neon)); }
        .chat-messages-glass { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
        .message-wrapper { display: flex; width: 100%; }
        .message-wrapper.user { justify-content: flex-end; }
        .message-wrapper.assistant { justify-content: flex-start; }
        .message-wrapper.system { justify-content: center; }
        .message-wrapper.system .message-bubble { background: transparent; font-size: 0.68rem; color: #555; padding: 3px 10px; border-radius: 20px; box-shadow: none; backdrop-filter: none; border: none; font-style: italic; }
        .message-bubble { max-width: 85%; padding: 10px 14px; border-radius: 22px; font-size: 0.84rem; line-height: 1.45; display: flex; gap: 7px; align-items: flex-start; backdrop-filter: blur(4px); }
        .message-wrapper.user .message-bubble { background: var(--neon); color: #000; border-bottom-right-radius: 5px; box-shadow: 0 2px 8px rgba(0, 255, 249, 0.3); }
        .message-wrapper.assistant .message-bubble { background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.12); color: #e0e0e0; border-bottom-left-radius: 5px; }
        .ai-icon { font-size: 1rem; filter: drop-shadow(0 0 4px var(--neon)); flex-shrink: 0; margin-top: 1px; }
        .message-text { word-break: break-word; white-space: pre-wrap; }
        .typing-indicator { opacity: 0.6; }
        /* FIX #4: Input area */
        .input-area { display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; background: rgba(0, 0, 0, 0.3); border-top: 1px solid rgba(0, 255, 249, 0.15); width: 100%; box-sizing: border-box; }
        .glass-input { flex: 1; min-width: 0; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(0, 255, 249, 0.25); border-radius: 18px; padding: 10px 16px; color: #fff; font-size: 0.82rem; outline: none; transition: border-color 0.2s, box-shadow 0.2s; resize: none; overflow-y: hidden; line-height: 20px; font-family: inherit; min-height: 40px; max-height: 100px; box-sizing: border-box; }
        .glass-input:focus { border-color: var(--neon); box-shadow: 0 0 10px rgba(0, 255, 249, 0.25); }
        /* FIX #4: Listening placeholder style */
        .glass-input.listening-placeholder::placeholder { color: rgba(0, 255, 249, 0.5); }
        .glass-input.listening-placeholder { border-color: var(--neon); box-shadow: 0 0 10px rgba(0, 255, 249, 0.3); }
        .glass-input::placeholder { color: rgba(255,255,255,0.25); }
        /* Google-style minimalist mic — bigger outer glow when listening */
        .mic-btn { background: transparent; border: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(255,255,255,0.45); transition: all 0.2s; flex-shrink: 0; padding: 0; }
        .mic-btn:hover:not(:disabled) { color: #fff; }
        .mic-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .mic-btn.listening { color: var(--neon); box-shadow: 0 0 0 6px rgba(0,255,249,0.15), 0 0 18px rgba(0,255,249,0.4); border-radius: 50%; animation: pulseMic 1.2s ease-in-out infinite; }
        @keyframes pulseMic { 0% { box-shadow: 0 0 0 4px rgba(0,255,249,0.1), 0 0 12px rgba(0,255,249,0.3); } 50% { box-shadow: 0 0 0 8px rgba(0,255,249,0.2), 0 0 24px rgba(0,255,249,0.5); } 100% { box-shadow: 0 0 0 4px rgba(0,255,249,0.1), 0 0 12px rgba(0,255,249,0.3); } }
        .send-btn { background: var(--neon); border: none; width: 40px; height: 40px; border-radius: 50%; font-size: 1rem; font-weight: bold; color: #000; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 8px rgba(0,255,249,0.5); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .send-btn:disabled { opacity: 0.4; box-shadow: none; cursor: not-allowed; }
        .send-btn:hover:not(:disabled) { box-shadow: 0 0 14px var(--neon); transform: scale(1.05); }
        /* FIX #4: Clear chat at bottom */
        .clear-chat-row { display: flex; justify-content: center; padding: 8px; border-top: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2); }
        .clear-chat-btn { background: none; border: none; color: #444; font-size: 0.7rem; cursor: pointer; letter-spacing: 0.5px; transition: color 0.2s; padding: 4px 10px; border-radius: 20px; }
        .clear-chat-btn:hover { color: #888; }
        .chat-messages-glass::-webkit-scrollbar { width: 3px; }
        .chat-messages-glass::-webkit-scrollbar-track { background: transparent; }
        .chat-messages-glass::-webkit-scrollbar-thumb { background: rgba(0,255,249,0.3); border-radius: 3px; }
        /* FIX: Batch confirmation cards stack */
        .confirmation-cards-stack { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
        .confirmation-card { background: rgba(12, 12, 20, 0.97); border-radius: 22px; padding: 14px 16px; width: 100%; box-sizing: border-box; border: 1px solid rgba(0, 255, 249, 0.4); box-shadow: 0 0 20px rgba(0,255,249,0.15), 0 6px 24px rgba(0,0,0,0.5); backdrop-filter: blur(20px); }
        .confirmation-header { font-size: 0.68rem; font-weight: 800; color: var(--neon); margin-bottom: 8px; letter-spacing: 1px; text-transform: uppercase; }
        .confirmation-details { font-size: 0.84rem; color: #ddd; line-height: 1.5; }
        .confirmation-details p { margin: 2px 0; }
        .conf-meta { color: #666 !important; font-size: 0.74rem !important; }
        .confirmation-buttons { display: flex; gap: 10px; margin-top: 12px; }
        .confirm-yes { flex: 1; padding: 8px; border: none; border-radius: 30px; font-weight: 800; font-size: 0.8rem; cursor: pointer; background: var(--neon); color: #000; box-shadow: 0 0 10px rgba(0,255,249,0.4); transition: all 0.2s; letter-spacing: 0.5px; }
        .confirm-no { flex: 1; padding: 8px; border: 1px solid rgba(255,68,68,0.4); border-radius: 30px; font-weight: 700; font-size: 0.8rem; cursor: pointer; background: rgba(255,68,68,0.08); color: #f55; transition: all 0.2s; letter-spacing: 0.5px; }
        .confirm-yes:hover { box-shadow: 0 0 18px var(--neon); transform: scale(1.02); }
        .confirm-no:hover { background: rgba(255,68,68,0.18); }
      `}</style>
    </div>
  );
}

export default App;