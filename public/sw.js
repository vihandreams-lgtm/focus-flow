// public/sw.js

const CACHE_NAME = 'focusflow-v2';
const DB_NAME = 'focusflow-notif-db';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';
let timers = [];  // store active timers to clear on update

// ------ IndexedDB helpers (unchanged) ------
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveNotifications(data) {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    data.forEach(item => store.put(item));
    return new Promise(resolve => { tx.oncomplete = resolve; });
  });
}

function loadNotifications() {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise(resolve => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });
  });
}

function deleteNotification(id) {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise(resolve => { tx.oncomplete = resolve; });
  });
}

// ------ Schedule individual timers ------
function scheduleItem(item) {
  const scheduledTime = new Date(item.scheduledAt).getTime();
  const delay = scheduledTime - Date.now();
  if (delay <= 0) {
    // Already due → fire immediately
    fireAndDelete(item);
  } else {
    const timer = setTimeout(() => fireAndDelete(item), delay);
    timers.push(timer);
  }
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

async function fireAndDelete(item) {
  await self.registration.showNotification(item.title, {
    body: item.body,
    icon: '/logo192.png',
    badge: '/logo192.png',
    tag: item.id,
  });
  await deleteNotification(item.id);
}

// On new schedule from App.js or on activation, reschedule
async function rescheduleAll() {
  clearTimers();
  const items = await loadNotifications();
  items.forEach(scheduleItem);
}

// ------ Message from App.js ------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    saveNotifications(event.data.notifications).then(rescheduleAll);
  }
});

// ------ Activate event ------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      rescheduleAll()
    ])
  );
});

// ------ Install & cache (unchanged) ------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/manifest.json',
        '/favicon.ico',
        '/logo192.png',
        '/logo512.png'
      ]);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).then((response) => {
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});