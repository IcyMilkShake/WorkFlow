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
  
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    scheduleNotifications(event.data.assignments);
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
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Schedule notifications for assignments
function scheduleNotifications(assignments) {
  const now = new Date();
  
  assignments.forEach(assignment => {
    if (!assignment.dueDate) return;
    
    const dueDate = new Date(
      assignment.dueDate.year,
      assignment.dueDate.month - 1,
      assignment.dueDate.day
    );
    
    const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
    
    // Check if assignment is late
    if (daysUntilDue < 0 && assignment.status === 'late') {
      if (shouldShowNotification(assignment, 'late')) {
        showNotification(assignment, 'late', Math.abs(daysUntilDue));
      }
    }
    // Check if due in 1-3 days
    else if (daysUntilDue >= 1 && daysUntilDue <= 3 && assignment.status === 'pending') {
      if (shouldShowNotification(assignment, 'dueSoon')) {
        showNotification(assignment, 'dueSoon', daysUntilDue);
      }
    }
  });
}

// Check if we should show notification (don't spam)
function shouldShowNotification(assignment, type) {
  const key = `notif_${assignment.title}_${type}`;
  const lastShown = localStorage.getItem(key);
  
  if (!lastShown) return true;
  
  const hoursSinceLastShown = (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60);
  
  // Show at most once every 24 hours for the same assignment
  return hoursSinceLastShown >= 24;
}

// Show notification with comedic message
function showNotification(assignment, type, days) {
  const messages = NOTIFICATION_MESSAGES[type];
  const message = messages[Math.floor(Math.random() * messages.length)]
    .replace('{title}', assignment.title)
    .replace('{days}', days);
  
  const icon = type === 'late' ? '😱' : '⏰';
  
  self.registration.showNotification('WorkFlow Assignment Alert', {
    body: message,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: `assignment-${assignment.title}`,
    requireInteraction: type === 'late',
    data: {
      url: assignment.link || '/',
      assignmentId: assignment.title
    },
    actions: [
      {
        action: 'view',
        title: 'View Assignment'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  });
  
  // Record that we showed this notification
  const key = `notif_${assignment.title}_${type}`;
  localStorage.setItem(key, Date.now().toString());
}

// Periodic check for notifications (when app is in background)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-assignments') {
    event.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  try {
    const response = await fetch('/api/assignments-check');
    const assignments = await response.json();
    scheduleNotifications(assignments);
  } catch (error) {
    console.error('Failed to check assignments:', error);
  }
}