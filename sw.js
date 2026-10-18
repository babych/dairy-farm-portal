// DairyERP Service Worker (PWA Offline & Instant Cache)
const CACHE_VERSION = 'dairy-erp-v09aa8e2-mvdm9xy0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/lib/petite-vue.es.js',
  '/src/main.js',
  '/src/app.js',
  '/src/state/store.js',
  '/src/api/client.js',
  '/src/modules/farms.js',
  '/src/modules/herd.js',
  '/src/modules/dashboard.js',
  '/src/locales/i18n.js',
  '/src/locales/uk.js',
  '/src/locales/en.js',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Install: precache essential shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Use addAll with error tolerance so third-party CDN issues don't abort install
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW Precache Warning]', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches automatically on version bump
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_VERSION && key.startsWith('dairy-erp-')) {
            console.log('[SW Cache Cleanup] Removing obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy:
// 1. Static UI & CDN Assets -> Cache-First with Network Fallback
// 2. Read-only API (/api/animals, /api/dashboard/stats) -> Stale-While-Revalidate with offline fallback
// 3. Mutating API (POST, PUT, DELETE) & Auth -> Network-Only
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET requests (mutations always require live connection or local queues)
  if (req.method !== 'GET') {
    return;
  }

  // API endpoints: Network-First with Offline Cache Fallback
  // Guarantees newly created/edited cows, events, and stats are immediately fresh when online
  if (url.pathname.startsWith('/api/animals') || url.pathname.startsWith('/api/dashboard/stats')) {
    event.respondWith(
      fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      }).catch(async (err) => {
        console.warn('[SW Offline] Network failed, serving cached fallback for', url.pathname);
        const cache = await caches.open(CACHE_VERSION);
        const cachedResponse = await cache.match(req);
        if (cachedResponse) return cachedResponse;
        throw err;
      })
    );
    return;
  }

  // Auth endpoints: always Network-Only
  if (url.pathname.startsWith('/api/auth/')) {
    return;
  }

  // Static Assets & App Shell
  // For HTML documents (navigation): use Network-First so users instantly see new deployments, with Cache Fallback for offline!
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      }).catch(async () => {
        console.warn('[SW Offline] Network failed, serving cached shell for navigation');
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req)) || (await cache.match('/')) || (await cache.match('/index.html'));
      })
    );
    return;
  }

  // Other Static Assets (CSS, JS, Fonts, Images): Cache-First
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          !networkResponse.redirected &&
          (url.origin === self.location.origin || url.hostname.includes('cdn') || url.hostname.includes('googleapis') || url.hostname.includes('cdnjs'))
        ) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      }).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return await cache.match(req);
      });
    })
  );
});

// Push Notifications Listener (Ready for Paid Pro Tier & Telegram alerts)
self.addEventListener('push', (event) => {
  let data = { title: 'DairyERP Сповіщення', body: 'Оновлення статусу стада або каренції ліків.' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 'dairy-alert',
      url: data.url || '/portal.html'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('portal.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/portal.html');
      }
    })
  );
});
