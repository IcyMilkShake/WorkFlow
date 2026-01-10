require('dotenv').config();
const express = require('express');
const path = require('path');
const webPush = require('web-push');
const fs = require('fs');
const app = express();

app.use(express.json());

// ==========================================
// PUSH NOTIFICATION CONFIGURATION
// ==========================================
const VAPID_FILE = path.join(__dirname, 'vapid.json');
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');

let vapidKeys;

// Load or Generate VAPID Keys
try {
  if (fs.existsSync(VAPID_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  } else {
    vapidKeys = webPush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
    console.log('✨ Generated new VAPID keys');
  }

  webPush.setVapidDetails(
    'mailto:admin@workflow.app',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('✅ Web Push initialized');
} catch (error) {
  console.error('❌ Failed to initialize Web Push:', error);
}

// Load Subscriptions (Simple file-based DB)
let subscriptions = {};
try {
  if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
    subscriptions = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
  }
} catch (error) {
  console.error('⚠️ Failed to load subscriptions:', error);
  subscriptions = {};
}

function saveSubscriptions() {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
  } catch (error) {
    console.error('❌ Failed to save subscriptions:', error);
  }
}

// Comedic Messages
const COMEDIC_MESSAGES = {
  dueTomorrow: [
    "Tomorrow is the day! '{title}' is due. No pressure, ...maybe a little pressure.",
    "One day left for '{title}'. Start doing it now!",
    "Deadline incoming! '{title}' is due tomorrow. Lock in!",
    "'{title}' is due tomorrow! Time to panic... I mean, get to work!",
    "24 hours (roughly) until '{title}' is due. Let's get this done!"
  ],
  overdue: [
    "🙄 Seriously? '{title}' is overdue by {days} day(s). Do you enjoy living dangerously?",
    "😑 '{title}' is still not done. I'm not mad, just disappointed. Okay, maybe a little mad.",
    "💀 '{title}' is late. Save your teacher some energy and start doing it!",
    "😤 Hey! '{title}' is {days} day(s) late. Stop ignoring me and do your work!",
    "📉 '{title}' is overdue. Your grade is crying right now. Go save it!"
  ]
};

// Trust proxy (crucial for AWS/Nginx/Load Balancers to get correct IP/Protocol)
app.enable('trust proxy');

// Security Middleware: Prevent access to backend files
app.use((req, res, next) => {
  const forbiddenFiles = [
    '/server.js',
    '/package.json',
    '/package-lock.json',
    '/.env',
    '/.git'
  ];
  if (forbiddenFiles.some(file => req.url.startsWith(file))) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// Set proper MIME types
app.use((req, res, next) => {
  if (req.url.endsWith('.js')) {
    res.type('application/javascript');
  } else if (req.url.endsWith('.json')) {
    res.type('application/json');
  }
  next();
});

// Serve service worker explicitly from root (required for PWA scope)
app.get('/service-worker.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'service-worker.js'));
});

// Serve manifest explicitly
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Serve offline page explicitly
app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'offline.html'));
});

// Serve 'node_modules' as static files (Note: only if needed by frontend)
// Kept for compatibility with your setup, but recommend removing if not used.
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Serve static files (HTML, CSS, JS, icons)
app.use(express.static(path.join(__dirname, '/')));
  console.log(process.env.OPENAI_KEY)

// ==========================================
// PUSH NOTIFICATION ROUTES
// ==========================================

// Get Public Key
app.get('/api/vapidPublicKey', (req, res) => {
  if (!vapidKeys) return res.status(500).json({ error: 'VAPID keys not initialized' });
  res.json({ publicKey: vapidKeys.publicKey });
});

// Save Subscription & Assignments Snapshot
app.post('/api/subscribe', (req, res) => {
  const { subscription, assignments, clientId } = req.body;

  if (!subscription || !clientId) {
    return res.status(400).json({ error: 'Missing subscription or clientId' });
  }

  // Store/Update subscription
  subscriptions[clientId] = {
    subscription,
    assignments: assignments || [],
    lastNotified: subscriptions[clientId]?.lastNotified || {}
  };

  saveSubscriptions();
  res.status(201).json({ message: 'Subscription saved' });
});

// ==========================================
// BACKGROUND NOTIFICATION WORKER
// ==========================================
function checkAssignmentsAndPush() {
  console.log('🔍 Checking assignments for push notifications...');
  const now = new Date();

  Object.keys(subscriptions).forEach(clientId => {
    const user = subscriptions[clientId];
    const { subscription, assignments, lastNotified } = user;

    if (!subscription || !assignments) return;

    assignments.forEach(assignment => {
      // Parse Date
      if (!assignment.dueDate) return;
      const dueDate = new Date(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day);

      const diffTime = dueDate - now;
      const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let type = null;
      if (daysUntilDue < 0 && assignment.status === 'late') type = 'overdue';
      else if (daysUntilDue <= 1 && daysUntilDue >= 0 && assignment.status === 'pending') type = 'dueTomorrow';

      if (!type) return;

      // Check cooldown (24 hours)
      const notifKey = `${assignment.title}_${type}`;
      const lastSent = lastNotified[notifKey] || 0;

      if (Date.now() - lastSent > 24 * 60 * 60 * 1000) {
        // Send Notification
        const messages = COMEDIC_MESSAGES[type];
        const message = messages[Math.floor(Math.random() * messages.length)]
          .replace('{title}', assignment.title)
          .replace('{days}', Math.abs(daysUntilDue));

        const payload = JSON.stringify({
          title: type === 'overdue' ? '🚨 Assignment Overdue!' : '⏰ Due Soon!',
          body: message,
          url: assignment.link || '/',
          type: type
        });

        webPush.sendNotification(subscription, payload)
          .then(() => {
            console.log(`✅ Push sent to ${clientId} for ${assignment.title}`);
            user.lastNotified[notifKey] = Date.now();
            saveSubscriptions();
          })
          .catch(err => {
            console.error(`❌ Push failed for ${clientId}:`, err.statusCode);
            if (err.statusCode === 410 || err.statusCode === 404) {
              // Subscription expired
              delete subscriptions[clientId];
              saveSubscriptions();
            }
          });
      }
    });
  });
}

// Run check every 30 minutes
setInterval(checkAssignmentsAndPush, 30 * 60 * 1000);
// Also run on startup after a delay
setTimeout(checkAssignmentsAndPush, 5000);


// Proxy endpoint for OpenAI Chat
app.post('/api/chat', async (req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_KEY}`
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API Error:', response.status, errorText);
      return res.status(response.status).send(errorText);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fallback to index.html for SPA routing (Client-side routing)
app.get('', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 8080;
// Bind to 0.0.0.0 to allow external access (AWS requirement)
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 PWA ready for installation`);
  console.log(`\n✅ Features enabled:`);
  console.log(`  - Offline support`);
  console.log(`  - Auto-updates`);
  console.log(`  - Install prompts`);
});
