/**
 * FocusFlow Service Worker (PWA Core)
 * Version: 2.0.0
 * * Objectives:
 * 1. Implement Resource Caching for Offline Availability.
 * 2. Manage Asynchronous Background Notifications via IndexedDB.
 * 3. Handle Edge-Case Fetching to ensure API reliability.
 */

const CACHE_NAME = 'focusflow-v2';
const DB_NAME = 'focusflow-notif-db';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';
let timers = [];

/* --- LOCAL PERSISTENCE LAYER (IndexedDB) --- */

/**
 * Initializes the IndexedDB store for client-side notification queuing.
 * This allows the app to schedule alerts without an active internet connection.
 */
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

/**
 * Commits upcoming reminders to the local database for background execution.
 */
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

/* --- NOTIFICATION SCHEDULING LOGIC --- */

/**
 * Calculates time offsets for scheduled events and initializes timers.
 */
function scheduleItem(item) {
  const scheduledTime = new Date(item.scheduledAt).getTime();
  const delay = scheduledTime - Date.now();
  if (delay <= 0) {
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

/**
 * Triggers the OS-level notification and cleans up the database queue.
 */
async function fireAndDelete(item) {
  await self.registration.showNotification(item.title, {
    body: item.body,
    icon: '/logo192.png',
    badge: '/logo192.png',
    tag: item.id,
  });
  await deleteNotification(item.id);
}

async function rescheduleAll() {
  clearTimers();
  const items = await loadNotifications();
  items.forEach(scheduleItem);
}

/* --- SERVICE WORKER LIFECYCLE EVENTS --- */

// Listener for main thread messages (e.g., triggering a sync)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    saveNotifications(event.data.notifications).then(rescheduleAll);
  }
});

/**
 * Activation Phase: Performs cache purging of legacy versions
 * to ensure the user is always on the latest design build.
 */
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

/**
 * Installation Phase: Pre-caches critical UI assets for instant loading.
 */
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

/* --- NETWORK INTERCEPTION (FETCH HANDLER) --- */

/**
 * Implements a "Stale-While-Revalidate" caching strategy.
 * This prioritizes speed while ensuring dynamic API calls (Groq/OpenAI)
 * bypass the cache to maintain real-time data integrity.
 */
self.addEventListener('fetch', (event) => {
  const isApiRequest = event.request.url.includes('groq.com') || 
                       event.request.url.includes('/functions/') || 
                       event.request.method !== 'GET';

  // API calls must always be live to avoid 'stale' chat responses
  if (isApiRequest) {
    return; 
  }

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