// public/sw.js

const CACHE_NAME = 'focusflow-v2';
const DB_NAME = 'focusflow-notif-db';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';
let notifInterval = null;

// ------ IndexedDB helpers ------
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

// ------ Notification checker (only fires recent overdue) ------
async function checkAndFireNotifications() {
  const items = await loadNotifications();
  const now = Date.now();
  const MAX_LATE_MS = 5 * 60 * 1000;  // 5 minutes – older items are ignored

  for (const item of items) {
    const scheduledTime = new Date(item.scheduledAt).getTime();
    const lateness = now - scheduledTime;

    if (lateness >= 0 && lateness <= MAX_LATE_MS) {
      // Due within the window → fire & delete
      await self.registration.showNotification(item.title, {
        body: item.body,
        icon: '/logo192.png',
        badge: '/logo192.png',
        tag: item.id,
      });
      await deleteNotification(item.id);
    } else if (lateness > MAX_LATE_MS) {
      // Too old → just remove from DB to avoid clutter
      await deleteNotification(item.id);
    }
    // Future items (lateness < 0) are kept for later checks
  }
}

function deleteNotification(id) {
  return openDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise(resolve => { tx.oncomplete = resolve; });
  });
}

function startNotificationChecker() {
  if (notifInterval) clearInterval(notifInterval);
  notifInterval = setInterval(checkAndFireNotifications, 60000); // check every 60s
}

// ------ Cache install/activate (unchanged) ------
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
      loadNotifications().then(() => startNotificationChecker())
    ])
  );
  checkAndFireNotifications();
});

// ------ Message from App.js ------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    const { notifications } = event.data;
    saveNotifications(notifications).then(() => {
      startNotificationChecker();
      checkAndFireNotifications();
    });
  }
});

// Optional periodic sync
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'notification-check') {
    event.waitUntil(checkAndFireNotifications());
  }
});
