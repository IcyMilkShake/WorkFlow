const CACHE_VERSION = '2.0.5'; // INCREMENT THIS ON EVERY DEPLOY
const CACHE_NAME = `workflow-v${CACHE_VERSION}`;
const RUNTIME_CACHE = `workflow-runtime-v${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json'
];

// Comedic notification messages
const NOTIFICATION_MESSAGES = {
  dueSoon: [
    "⏰ Hey procrastinator! '{title}' is due in {days} days. Time to panic? 🙃",
    "🚨 Assignment alert! '{title}' is coming up in {days} days. Netflix can wait!",
    "⚡ Friendly reminder: '{title}' due in {days} days. Your future self will thank you!",
    "🎯 '{title}' needs attention in {days} days. Let's not make it a last-minute miracle!",
    "📚 Psst... '{title}' is due in {days} days. Coffee up and let's do this!"
  ],
  late: [
    "😱 Uh oh! '{title}' is now OVERDUE. Time to channel your inner superhero! 🦸",
    "🔥 DEFCON 1: '{title}' is late! But hey, better late than never, right?",
    "⚠️ Houston, we have a problem. '{title}' crossed the deadline. Damage control time!",
    "💀 '{title}' has entered the danger zone. Quick, before your teacher notices!",
    "🚀 Emergency! '{title}' is overdue. Activate turbo mode NOW!"
  ]
};

// Install event
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${CACHE_VERSION}...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // Activate immediately
  );
});


// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${CACHE_VERSION}...`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete ANY cache that doesn't match current version
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log(`[SW] Version ${CACHE_VERSION} is now active`);
      return self.clients.claim(); // Take control immediately
    })
  );
});

// Fetch event - Network First for HTML/JS, Cache First for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip external requests
  if (!url.origin.startsWith(self.location.origin)) {
    if (url.hostname.includes('googleapis.com') || 
        url.hostname.includes('accounts.google.com') ||
        url.hostname.includes('openai.com')) {
      return;
    }
  }

  // Network First for HTML and JavaScript (always get latest)
  if (event.request.mode === 'navigate' || 
      url.pathname.endsWith('.js') || 
      url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Update cache with fresh version
          return caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(event.request, { ignoreSearch: true })
            .then(cached => {
              // If found in cache, return it
              if (cached) return cached;

              // If not, try offline.html
              return caches.match('/offline.html').then(offline => {
                 if (offline) return offline;

                 // Absolute fallback for Safari to prevent "Cannot Connect" errors
                 return new Response(
                   '<body style="font-family:sans-serif; text-align:center; padding:2rem;"><h1>You are offline</h1><p>Please check your connection.</p></body>',
                   {
                     status: 200,
                     headers: { 'Content-Type': 'text/html' }
                   }
                 );
              });
            });
        })
    );
    return;
  }

  // Cache First for static assets (CSS, images, fonts)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        
        return fetch(event.request)
          .then((response) => {
            if (event.request.method === 'GET' && response.status === 200) {
              return caches.open(RUNTIME_CACHE).then((cache) => {
                cache.put(event.request, response.clone());
                return response;
              });
            }
            return response;
          })
          .catch(err => {
             // Optional: Return a placeholder image if it's an image request
             console.log('Fetch failed for asset:', event.request.url);
             // Return nothing to let the browser handle the failure (broken image icon)
             // or return new Response('', { status: 404 }) to suppress network error logging
          });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Manual cache clear command
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(names => {
        return Promise.all(names.map(name => caches.delete(name)));
      }).then(() => {
        return self.clients.matchAll();
      }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'CACHE_CLEARED' });
        });
      })
    );
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    console.log('[SW] Push received:', data);

    const title = data.title || 'WorkFlow Alert';
    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: `assignment-${data.type}-${Date.now()}`,
      data: {
        url: data.url || '/'
      },
      requireInteraction: data.type === 'overdue'
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus().then(focusedClient => {
              if (focusedClient.navigate) {
                return focusedClient.navigate(url);
              }
            });
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});