const CACHE_NAME = 'workflow-v2.0.0';
const RUNTIME_CACHE = 'workflow-runtime';

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
  console.log('Service Worker: Installing v2.0.0...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith(self.location.origin)) {
    if (event.request.url.includes('googleapis.com') || 
        event.request.url.includes('accounts.google.com') ||
        event.request.url.includes('openai.com')) {
      return;
    }
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          return caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
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
          });
      })
  );
});

// Handle notification scheduling
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push event (triggered by backend)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    console.log('Push received:', data);

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
        // If the window is already open, focus it
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus().then(focusedClient => {
              if (focusedClient.navigate) {
                return focusedClient.navigate(url);
              }
            });
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});