import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import OpenAI from "openai";

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

  // ---------- localStorage helpers (stable) ----------
  const saveToLocal = useCallback((key, data) => {
    if (!user) return;
    try {
      localStorage.setItem(`focusflow_${user.uid}_${key}`, JSON.stringify(data));
    } catch (e) {
      console.warn('localStorage save failed', e);
    }
  }, [user]);

  const loadFromLocal = useCallback((key) => {
    if (!user) return null;
    try {
      const raw = localStorage.getItem(`focusflow_${user.uid}_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [user]);

  // ---------- SMART MERGE FUNCTIONS (now use loadFromLocal directly) ----------
  const mergeArrayWithTimestamps = useCallback((remoteData, path) => {
    const localData = loadFromLocal(path) || [];
    const merged = [];
    const localMap = new Map(localData.map(item => [item.id, item]));
    const remoteMap = new Map(remoteData.map(item => [item.id, item]));

    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    allIds.forEach(id => {
      const localItem = localMap.get(id);
      const remoteItem = remoteMap.get(id);

      if (localItem && remoteItem) {
        const localTime = localItem.lastUpdated || 0;
        const remoteTime = remoteItem.lastUpdated || 0;
        merged.push(localTime > remoteTime ? localItem : remoteItem);
      } else if (localItem && !remoteItem) {
        merged.push(localItem);
      } else if (!localItem && remoteItem) {
        merged.push(remoteItem);
      }
    });
    // If merged differs from remote, push the merged data to Firebase
    if (JSON.stringify(merged) !== JSON.stringify(remoteData)) {
      set(ref(db, `users/${user.uid}/${path}`), merged);
    }
    return merged;
  }, [user, loadFromLocal]);

  const mergeObjectWithTimestamp = useCallback((remoteData, path) => {
    const localData = loadFromLocal(path);
    if (!localData) return remoteData;
    if (!remoteData) return localData;

    const localTime = localData.lastUpdated || 0;
    const remoteTime = remoteData.lastUpdated || 0;
    if (localTime > remoteTime) {
      set(ref(db, `users/${user.uid}/${path}`), localData);
      return localData;
    }
    return remoteData;
  }, [user, loadFromLocal]);

  // ---------- USER-SPECIFIC FIREBASE SYNC (stable dependencies) ----------
  useEffect(() => {
    if (!user) return;

    const userRef = (path) => ref(db, `users/${user.uid}/${path}`);

    // Pre-load cached data
    const cachedTasks = loadFromLocal('tasks');
    if (cachedTasks) setTasks(cachedTasks);
    const cachedLectures = loadFromLocal('lectures');
    if (cachedLectures) setLectures(cachedLectures);
    const cachedRevisions = loadFromLocal('revisions');
    if (cachedRevisions) setRevisions(cachedRevisions);
    const cachedExams = loadFromLocal('exams');
    if (cachedExams) setExams(cachedExams);
    const cachedCoursework = loadFromLocal('coursework');
    if (cachedCoursework) setCoursework(cachedCoursework);
    const cachedTimerState = loadFromLocal('timerState');
    if (cachedTimerState) setFocusGoal(cachedTimerState.currentFocus || '');
    const cachedStats = loadFromLocal('stats');
    if (cachedStats) {
      setSessionsCompleted(cachedStats.total || 0);
      setSessionsToday(cachedStats.today || 0);
      setLastActiveDate(cachedStats.lastDate || '');
    }
    const cachedFocusHistory = loadFromLocal('focusHistory');
    if (cachedFocusHistory) {
      setFocusHistory(cachedFocusHistory);
      const sorted = cachedFocusHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRecentFocusHistory(sorted.slice(0, 3));
    }

    // Set up listeners – they use merge functions that pull local data from storage
    const unsubTasks = onValue(userRef('tasks'), (snapshot) => {
      const remote = snapshot.val() || [];
      const merged = mergeArrayWithTimestamps(remote, 'tasks');
      setTasks(merged);
      saveToLocal('tasks', merged);
    });
    const unsubLectures = onValue(userRef('lectures'), (snapshot) => {
      const remote = snapshot.val() || [];
      const merged = mergeArrayWithTimestamps(remote, 'lectures');
      setLectures(merged);
      saveToLocal('lectures', merged);
    });
    const unsubRevisions = onValue(userRef('revisions'), (snapshot) => {
      const remote = snapshot.val() || [];
      const merged = mergeArrayWithTimestamps(remote, 'revisions');
      setRevisions(merged);
      saveToLocal('revisions', merged);
    });
    const unsubExams = onValue(userRef('exams'), (snapshot) => {
      const remote = snapshot.val() || [];
      const merged = mergeArrayWithTimestamps(remote, 'exams');
      setExams(merged);
      saveToLocal('exams', merged);
    });
    const unsubCoursework = onValue(userRef('coursework'), (snapshot) => {
      const remote = snapshot.val() || [];
      const merged = mergeArrayWithTimestamps(remote, 'coursework');
      setCoursework(merged);
      saveToLocal('coursework', merged);
    });
    const unsubTimerState = onValue(userRef('timerState'), (snapshot) => {
      const remote = snapshot.val() || {};
      const merged = mergeObjectWithTimestamp(remote, 'timerState');
      setFocusGoal(merged.currentFocus || '');
      saveToLocal('timerState', merged);
    });
    const unsubStats = onValue(userRef('stats'), (snapshot) => {
      const remote = snapshot.val() || {};
      const merged = mergeObjectWithTimestamp(remote, 'stats');
      if (merged) {
        setSessionsCompleted(merged.total || 0);
        setSessionsToday(merged.today || 0);
        setLastActiveDate(merged.lastDate || '');
        saveToLocal('stats', merged);
      }
    });
    const unsubFocusHistory = onValue(userRef('focusHistory'), (snapshot) => {
      const remote = snapshot.val() || {};
      const remoteEntries = Object.values(remote);
      const localHistory = loadFromLocal('focusHistory') || [];
      const remoteTimestamps = new Set(remoteEntries.map(e => e.timestamp));
      const newLocal = localHistory.filter(e => !remoteTimestamps.has(e.timestamp));
      const combined = [...remoteEntries, ...newLocal].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setFocusHistory(combined);
      saveToLocal('focusHistory', combined);
      setRecentFocusHistory(combined.slice(0, 3));
      newLocal.forEach(entry => push(userRef('focusHistory'), entry));
    });

    return () => {
      unsubTasks();
      unsubLectures();
      unsubRevisions();
      unsubExams();
      unsubCoursework();
      unsubTimerState();
      unsubStats();
      unsubFocusHistory();
    };
  }, [user, loadFromLocal, saveToLocal, mergeArrayWithTimestamps, mergeObjectWithTimestamp]);

  // Build subject dropdown options
  useEffect(() => {
    const lectureSubjects = lectures.map(l => l.subject);
    const cwSubjects = coursework.map(c => c.text);
    const allSubjects = [...lectureSubjects, ...cwSubjects].filter(Boolean);
    const uniqueSubjects = [...new Set(allSubjects)].sort();
    setSubjectOptions(uniqueSubjects);
  }, [lectures, coursework]);

  const todayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
  const todayISO = new Date().toISOString().split('T')[0];

  // --- TODAY'S ACTIVITIES (including Tests from Academic) ---
  const todaysActivities = useMemo(() => {
    const combined = [
      ...lectures.filter(f => f.day === todayName).map(i => ({...i, category: 'LECTURE'})),
      ...revisions.filter(r => r.day === todayName).map(i => ({...i, category: 'REVISION'})),
      ...exams.filter(e => e.date === todayISO).map(i => ({...i, category: 'EXAM'}))
    ];

    const todayTests = coursework
      .filter(cw => cw.type === 'Test' && cw.deadline === todayISO)
      .map(cw => ({
        id: cw.id,
        subject: cw.text,
        startTime: cw.dueTime || '23:59',
        endTime: cw.dueTime || '23:59',
        venue: 'Test Deadline',
        category: 'TEST',
        dueTime: cw.dueTime,
      }));

    return [...combined, ...todayTests].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [lectures, revisions, exams, coursework, todayName, todayISO]);

  // --- AUTH HANDLERS (unchanged) ---
  const isSignupValid = useCallback(() => {
    if (authMode !== 'signup') return true;
    if (authPassword.length < 8) return false;
    if (!/\d/.test(authPassword)) return false;
    if (authPassword !== authConfirmPassword) return false;
    return true;
  }, [authMode, authPassword, authConfirmPassword]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!authEmail || !authPassword) { setAuthError('Email and password required'); return; }
    if (authMode === 'signup') {
      if (authPassword.length < 8) { setAuthError('Password must be at least 8 characters'); return; }
      if (!/\d/.test(authPassword)) { setAuthError('Password must contain at least one number'); return; }
      if (authPassword !== authConfirmPassword) { setAuthError('Passwords do not match'); return; }
    }
    try {
      if (authMode === 'signup') await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      else await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (error) { setAuthError(error.message); }
  };

  const handleLogout = async () => {
    try { await signOut(auth); setShowProfile(false); } catch (error) { console.error('Logout error:', error); }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const confirmed = window.confirm('⚠️ PERMANENTLY DELETE YOUR ACCOUNT?\n\nThis will erase all your data. This action cannot be undone.');
    if (!confirmed) return;
    try {
      await remove(ref(db, `users/${user.uid}`));
      const keys = Object.keys(localStorage).filter(k => k.startsWith(`focusflow_${user.uid}_`));
      keys.forEach(k => localStorage.removeItem(k));
      await deleteUser(user);
      setShowProfile(false);
    } catch (error) {
      console.error('Delete account error:', error);
      alert('Failed to delete account. You may need to re-authenticate. ' + error.message);
    }
  };

  // --- AI RECOMMENDATION ENGINE (Groq) – unchanged ---
  const generateRecommendations = async () => {
    if (!user) return;
    setIsGenerating(true);
    setRecommendations([]);
    try {
      const apiKey = process.env.REACT_APP_GROQ_KEY;
      const groq = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.groq.com/openai/v1",
        dangerouslyAllowBrowser: true
      });
      const currentTime = new Date();
      const currentTimeStr = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const todayStr = currentTime.toLocaleDateString();
      const todaysSchedule = todaysActivities.map(act => ({
        subject: act.subject, start: act.startTime, end: act.endTime || act.startTime, category: act.category
      }));
      const courseworkItems = coursework.map(cw => ({
        subject: cw.text, deadline: cw.deadline, type: cw.type
      }));
      const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const recentHistory = focusHistory.filter(entry => new Date(entry.timestamp) >= twoWeeksAgo);
      const prompt = `
You are an AI study planner. Based on the following data, create a personalized revision timetable for TODAY.
Current time: ${currentTimeStr} on ${todayStr}. Only suggest slots that start AFTER the current time.
Today's existing schedule: ${JSON.stringify(todaysSchedule, null, 2)}
Coursework and deadlines: ${JSON.stringify(courseworkItems, null, 2)}
Recent focus history (last 14 days): ${JSON.stringify(recentHistory, null, 2)}
Instructions:
- Identify free time gaps (day ends at 22:00).
- Prioritize subjects with upcoming deadlines (within 7 days) or neglected.
- Generate 1 to 3 revision sessions.
- Each session must include: subject, startTime (HH:MM), endTime (HH:MM), reasoning.
- Return ONLY a JSON array of objects with keys: subject, startTime, endTime, reasoning.`;
      const completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are a helpful study planner. Respond only with valid JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
      });
      const responseText = completion.choices[0].message.content;
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("Invalid AI response format");
      const parsed = JSON.parse(jsonMatch[0]);
      const validated = parsed.filter(rec => rec.subject && rec.startTime && rec.endTime && rec.reasoning)
        .map((rec, idx) => ({ ...rec, id: Date.now() + idx }));
      setRecommendations(validated);
    } catch (error) {
      console.error("AI generation error:", error);
      alert("AI service unavailable. Please try again later.");
    } finally { setIsGenerating(false); }
  };

  const handleAddRecommendation = (rec) => {
    if (!user) return;
    const newEntry = {
      id: Date.now(),
      subject: rec.subject,
      startTime: rec.startTime,
      endTime: rec.endTime,
      venue: 'AI Recommended',
      day: todayName,
      lastUpdated: Date.now()
    };
    const updatedRevisions = [newEntry, ...revisions];
    setRevisions(updatedRevisions);
    saveToLocal('revisions', updatedRevisions);
    set(ref(db, `users/${user.uid}/revisions`), updatedRevisions);
    alert(`Added "${rec.subject}" revision at ${rec.startTime}`);
    setRecommendations(prev => prev.filter(r => r.id !== rec.id));
  };

  const dismissRecommendation = (id) => { setRecommendations(prev => prev.filter(r => r.id !== id)); };

  // --- FOCUS TIMER LOGIC (with localStorage backup) ---
  useEffect(() => {
    if (!user) return;
    const today = new Date().toLocaleDateString();
    if (lastActiveDate && lastActiveDate !== today) {
      const newStats = { total: sessionsCompleted, today: 0, lastDate: today, lastUpdated: Date.now() };
      update(ref(db, `users/${user.uid}/stats`), newStats);
      saveToLocal('stats', newStats);
    }
  }, [lastActiveDate, user, sessionsCompleted, saveToLocal]);

  const handleFocusChange = (e) => {
    const val = e.target.value;
    if (val === 'custom') {
      setIsCustomFocus(true);
      setFocusGoal('');
    } else {
      setIsCustomFocus(false);
      setFocusGoal(val);
      if (user) {
        const newTimerState = { currentFocus: val, lastUpdated: Date.now() };
        set(ref(db, `users/${user.uid}/timerState`), newTimerState);
        saveToLocal('timerState', newTimerState);
      }
    }
  };
  const handleCustomFocusChange = (e) => {
    const val = e.target.value;
    setCustomFocusInput(val);
    setFocusGoal(val);
    if (user) {
      const newTimerState = { currentFocus: val, lastUpdated: Date.now() };
      set(ref(db, `users/${user.uid}/timerState`), newTimerState);
      saveToLocal('timerState', newTimerState);
    }
  };
  const handleMinutesChange = (e) => {
    const mins = parseInt(e.target.value, 10);
    if (!isNaN(mins) && mins > 0) {
      setCustomMinutes(mins);
      setTotalTime(mins * 60);
      setSeconds(mins * 60);
    }
  };

  useEffect(() => {
    let interval = null;
    if (isActive && seconds > 0) {
      interval = setInterval(() => setSeconds(s => s - 1), 1000);
    } else if (seconds === 0 && isActive) {
      setIsActive(false);
      new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(() => {});
      if (totalTime === customMinutes * 60 && user) {
        const sessionLog = {
          subjectName: focusGoal || 'Untitled Session',
          duration: customMinutes,
          timestamp: new Date().toISOString(),
          lastUpdated: Date.now()
        };
        push(ref(db, `users/${user.uid}/focusHistory`), sessionLog);

        const newDailyCount = sessionsToday + 1;
        const newTotalCount = sessionsCompleted + 1;
        const newStats = {
          total: newTotalCount,
          today: newDailyCount,
          lastDate: new Date().toLocaleDateString(),
          lastUpdated: Date.now()
        };
        set(ref(db, `users/${user.uid}/stats`), newStats);
        saveToLocal('stats', newStats);

        const updatedHistory = [...focusHistory, sessionLog];
        saveToLocal('focusHistory', updatedHistory);
        setRecentFocusHistory(updatedHistory.slice(-3));
        if (newDailyCount % 4 === 0) {
          alert("4 Sessions Done! Take a long 15-minute break.");
          setTotalTime(900); setSeconds(900);
        } else {
          alert("Session Complete! 5-minute break starts now.");
          setTotalTime(300); setSeconds(300);
        }
      } else {
        alert("Break over! Ready to focus?");
        setTotalTime(customMinutes * 60);
        setSeconds(customMinutes * 60);
        setFocusGoal('');
        setIsCustomFocus(false);
        setCustomFocusInput('');
        if (user) {
          const newTimerState = { currentFocus: '', lastUpdated: Date.now() };
          set(ref(db, `users/${user.uid}/timerState`), newTimerState);
          saveToLocal('timerState', newTimerState);
        }
      }
    }
    return () => clearInterval(interval);
  }, [isActive, seconds, totalTime, sessionsToday, sessionsCompleted, focusGoal, customMinutes, user, focusHistory, saveToLocal]);

  const progressOffset = (2 * Math.PI * 140) - (seconds / totalTime) * (2 * Math.PI * 140);

  const getStatus = (start, end) => {
    const now = new Date();
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end ? end.split(':').map(Number) : [sH + 1, sM];
    const startDate = new Date(); startDate.setHours(sH, sM, 0);
    const endDate = new Date(); endDate.setHours(eH, eM, 0);
    if (now > endDate) return 'PAST';
    if (now >= startDate && now <= endDate) return 'LIVE';
    return 'UPCOMING';
  };

  // ---------- CRUD OPERATIONS (optimistic + localStorage + timestamp) ----------
  const clearForm = () => {
    setSubject(''); setVenue(''); setStartTime(''); setEndTime(''); setDate(''); setDay('Monday'); setEditingId(null);
  };
  const saveEntry = () => {
    if (!user || !subject || !startTime) return;
    const entry = {
      id: editingId || Date.now(),
      subject, startTime, endTime, venue, day, date,
      lastUpdated: Date.now()
    };
    let path = ttTab === 'LECTURES' ? 'lectures' : ttTab === 'REVISION' ? 'revisions' : 'exams';
    let currentList = ttTab === 'LECTURES' ? lectures : ttTab === 'REVISION' ? revisions : exams;
    const updatedList = editingId
      ? currentList.map(item => item.id === editingId ? entry : item)
      : [entry, ...currentList];
    if (ttTab === 'LECTURES') setLectures(updatedList);
    else if (ttTab === 'REVISION') setRevisions(updatedList);
    else setExams(updatedList);
    saveToLocal(path, updatedList);
    set(ref(db, `users/${user.uid}/${path}`), updatedList);
    clearForm();
  };
  const handleEdit = (item) => {
    setEditingId(item.id); setSubject(item.subject); setVenue(item.venue);
    setStartTime(item.startTime); setEndTime(item.endTime); setDay(item.day || 'Monday'); setDate(item.date || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const confirmDelete = (id, type) => {
    if (!user || !window.confirm("Are you sure you want to delete this?")) return;
    const paths = { LECTURES: 'lectures', REVISION: 'revisions', EXAMS: 'exams', TASK: 'tasks', CW: 'coursework' };
    const lists = { LECTURES: lectures, REVISION: revisions, EXAMS: exams, TASK: tasks, CW: coursework };
    const path = paths[type];
    const currentList = lists[type];
    const updatedList = currentList.filter(x => x.id !== id);
    if (type === 'LECTURES') setLectures(updatedList);
    else if (type === 'REVISION') setRevisions(updatedList);
    else if (type === 'EXAMS') setExams(updatedList);
    else if (type === 'TASK') setTasks(updatedList);
    else if (type === 'CW') setCoursework(updatedList);
    saveToLocal(path, updatedList);
    set(ref(db, `users/${user.uid}/${path}`), updatedList);
  };
  const saveAcademic = () => {
    if(!user || !cwInput) return;
    const newCw = {
      id: Date.now(), text: cwInput, type: cwType, deadline: cwDeadline,
      dueTime: cwDueTime, completed: false, lastUpdated: Date.now()
    };
    const updatedCoursework = [newCw, ...coursework];
    setCoursework(updatedCoursework);
    saveToLocal('coursework', updatedCoursework);
    set(ref(db, `users/${user.uid}/coursework`), updatedCoursework);
    setCwInput(''); setCwDeadline(''); setCwDueTime('');
  };
  const toggleCw = (id) => {
    if (!user) return;
    const updated = coursework.map(x => x.id === id ? { ...x, completed: !x.completed, lastUpdated: Date.now() } : x);
    setCoursework(updated);
    saveToLocal('coursework', updated);
    set(ref(db, `users/${user.uid}/coursework`), updated);
  };
  const addTask = () => {
    if (!user || !taskInput) return;
    const newTask = { id: Date.now(), text: taskInput, completed: false, lastUpdated: Date.now() };
    const updatedTasks = [newTask, ...tasks];
    setTasks(updatedTasks);
    saveToLocal('tasks', updatedTasks);
    set(ref(db, `users/${user.uid}/tasks`), updatedTasks);
    setTaskInput('');
  };
  const toggleTask = (id) => {
    if (!user) return;
    const updated = tasks.map(x => x.id === id ? { ...x, completed: !x.completed, lastUpdated: Date.now() } : x);
    setTasks(updated);
    saveToLocal('tasks', updated);
    set(ref(db, `users/${user.uid}/tasks`), updated);
  };
  const clearCompletedTasks = () => {
    if (!user) return;
    const updated = tasks.filter(t => !t.completed);
    setTasks(updated);
    saveToLocal('tasks', updated);
    set(ref(db, `users/${user.uid}/tasks`), updated);
  };

  // --- RENDER AUTH SCREEN OR MAIN APP ---
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="pulse-icon">⏳</div>
        <p>Loading...</p>
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
              <div className="password-wrapper">
                <input type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirm Password" value={authConfirmPassword} onChange={(e) => setAuthConfirmPassword(e.target.value)} className="auth-input" autoComplete="new-password" />
                <button type="button" className="toggle-password" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>{showConfirmPassword ? '🔒' : '👁️'}</button>
              </div>
            )}
            {authError && <div className="auth-error">{authError}</div>}
            <button type="submit" className="auth-submit-btn" disabled={authMode === 'signup' && !isSignupValid()}>
              {authMode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}
            </button>
          </form>
          <p className="auth-switch-text">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
              {authMode === 'login' ? 'Sign Up' : 'Login'}
            </button>
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
          .auth-submit-btn { width: 100%; background: #00fff9; color: #000; border: none; padding: 16px; border-radius: 14px; font-weight: 900; font-size: 1rem; letter-spacing: 1px; margin-top: 20px; cursor: pointer; box-shadow: 0 0 20px #00fff9; transition: all 0.2s; }
          .auth-submit-btn:disabled { opacity: 0.5; box-shadow: none; cursor: not-allowed; }
          .auth-error { color: #ff3a6f; font-size: 0.8rem; margin-top: 10px; text-align: center; text-shadow: 0 0 8px #ff3a6f; }
          .auth-switch-text { text-align: center; margin-top: 20px; color: #888; font-size: 0.8rem; }
          .auth-switch-text button { background: none; border: none; color: #00fff9; font-weight: 700; cursor: pointer; text-decoration: underline; }
        `}</style>
      </div>
    );
  }

  // --- MAIN AUTHENTICATED APP (identical UI) ---
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
                    {item.category === 'TEST' && item.dueTime && (
                      <span className="test-due-badge">Due: {item.dueTime}</span>
                    )}
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
            <button className="back-btn" onClick={() => setCurrentScreen('TIMETABLE')} style={{ alignSelf: 'flex-start', marginBottom: '10px' }}>
              ← Back to Schedule
            </button>
            <h4 className="section-label">GENERATE WITH AI</h4>
            {!isGenerating && recommendations.length === 0 && (
              <div className="ai-intro-card">
                <p style={{color: '#aaa', marginBottom: '20px'}}>
                  Let AI analyze your schedule, deadlines, and study habits to suggest perfect revision slots for today.
                </p>
                <button className="ai-gen-btn" onClick={generateRecommendations}>
                  🚀 GENERATE REVISION TIMETABLE
                </button>
              </div>
            )}
            {isGenerating && (
              <div className="scanning-animation card-styled">
                <div className="pulse-icon">🧠</div>
                <div className="shimmer-text">Generating Revision Timetable...</div>
                <div className="progress-bar">
                  <div className="progress-fill shimmer"></div>
                </div>
                <p style={{color: '#666', fontSize: '0.7rem', marginTop: '15px'}}>
                  Analyzing free slots, deadlines, and focus history...
                </p>
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
                <button className="cancel-btn" onClick={generateRecommendations} style={{marginTop: '20px'}}>
                  🔄 Regenerate
                </button>
              </div>
            )}
          </div>
        )}

        {currentScreen === 'ACADEMIC' && (
          <div className="center-view">
            <h4 className="section-label">ACADEMIC / COURSEWORK</h4>
            <div className="form-container" style={{marginBottom: '25px'}}>
              <div className="input-group">
                <label>TYPE</label>
                <select value={cwType} onChange={e => setCwType(e.target.value)} className="neon-input">
                  <option>Assignment</option>
                  <option>Coursework</option>
                  <option>Test</option>
                  <option>Discussion</option>
                </select>
              </div>
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
              <button className={`timer-btn start ${isActive ? 'pause' : ''}`} onClick={() => {if(!isActive && !focusGoal && totalTime === customMinutes * 60) { alert("Please enter a focus goal first!"); return; } setIsActive(!isActive);}}>
                {isActive ? 'PAUSE' : (seconds < totalTime ? 'RESUME' : 'START SESSION')}
              </button>
              <button className="timer-btn restart" onClick={() => {setIsActive(false); setTotalTime(customMinutes * 60); setSeconds(customMinutes * 60);}}>RESET</button>
            </div>

            <div className="sessions-center-container">
                <p className="sessions-center-text">SESSIONS TODAY: <strong>{sessionsToday}</strong></p>
                <p className="sessions-center-text" style={{fontSize: '0.6rem', opacity: 0.8, marginTop: '5px'}}>TOTAL SESSIONS: {sessionsCompleted}</p>
            </div>

            <div className="history-toggle-wrapper">
              <button className="history-toggle-btn" onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? 'Hide' : 'View'} Recent Sessions
              </button>
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
        <button onClick={() => setCurrentScreen('TIMETABLE')} className={currentScreen === 'TIMETABLE' || currentScreen === 'AI_GEN' ? 'active' : ''}>📅<span>Schedule</span></button>
        <button onClick={() => setCurrentScreen('ACADEMIC')} className={currentScreen === 'ACADEMIC' ? 'active' : ''}>📄<span>Academic</span></button>
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
        .nav-bar { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: rgba(10,10,10,0.95); border: 1px solid #222; padding: 12px 20px; border-radius: 50px; display: flex; gap: 10px; backdrop-filter: blur(15px); z-index: 100; }
        .nav-bar button { background: none; border: none; color: #444; display: flex; flex-direction: column; align-items: center; min-width: 60px; cursor: pointer; }
        .nav-bar button.active { color: var(--neon); text-shadow: 0 0 8px var(--neon); }
        .nav-bar button span { font-size: 0.55rem; font-weight: 800; margin-top: 5px; text-transform: uppercase; }
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
        .profile-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
        .profile-modal { width: 100%; max-width: 380px; padding: 30px 25px; text-align: center; position: relative; border: 1px solid var(--neon); box-shadow: 0 0 30px rgba(0, 255, 249, 0.3); }
        .close-modal { position: absolute; top: 15px; right: 15px; background: none; border: none; color: #888; font-size: 1.2rem; cursor: pointer; }
        .profile-modal h3 { color: var(--neon); margin-bottom: 20px; font-size: 1.4rem; text-shadow: 0 0 10px var(--neon); }
        .profile-email { color: var(--neon); margin-bottom: 30px; word-break: break-all; font-size: 1rem; text-shadow: 0 0 5px var(--neon); }
        .profile-btn { width: 100%; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 14px; border-radius: 12px; font-weight: 700; margin-bottom: 12px; cursor: pointer; transition: all 0.2s; letter-spacing: 1px; }
        .profile-btn.logout { border-color: #f44; color: #f44; box-shadow: 0 0 10px rgba(255, 68, 68, 0.3); }
        .profile-btn.logout:hover { background: #f44; color: #000; box-shadow: 0 0 20px #f44; }
        .profile-btn.danger { border-color: #ff3a6f; color: #ff3a6f; box-shadow: 0 0 10px rgba(255, 58, 111, 0.3); }
        .profile-btn.danger:hover { background: #ff3a6f; color: #000; box-shadow: 0 0 20px #ff3a6f; }
        .auth-loading { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--neon); }
      `}</style>
    </div>
  );
}

export default App;