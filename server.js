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
  ],
  dueSoon: [
    "📅 Heads up! '{title}' is due in {days} days. Easy start?",
    "👀 '{title}' is coming up in {days} days. Don't let it sneak up on you.",
    "🗓️ Just a reminder: '{title}' is due in {days} days. Plan ahead!",
    "🧘 '{title}' is due in {days} days. Be zen and finish it early.",
    "🚀 '{title}' launches in {days} days. Prepare for liftoff!"
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

// Auth Callback: Exchange Code for Tokens
app.post('/api/auth/google/callback', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const params = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID, // Ensure these are set in .env or environment
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: req.headers.origin, // Dynamic redirect based on origin
      grant_type: 'authorization_code'
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error('Token exchange failed:', errorText);
      return res.status(tokenRes.status).send(errorText);
    }

    const tokens = await tokenRes.json();
    res.json(tokens);
  } catch (err) {
    console.error('Auth Callback Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Save Subscription & Assignments Snapshot
app.post('/api/subscribe', (req, res) => {
  const { subscription, assignments, clientId, refreshToken, userId } = req.body;

  if (!subscription || !clientId) {
    return res.status(400).json({ error: 'Missing subscription or clientId' });
  }

  // Preserve existing data if partial update
  const existingUser = subscriptions[clientId] || {};
  
  // Check for account switch
  let lastNotified = existingUser.lastNotified || {};
  let notificationQueue = existingUser.notificationQueue || [];
  let lastQueueProcessingTime = existingUser.lastQueueProcessingTime || 0;
  
  if (userId && existingUser.userId && existingUser.userId !== userId) {
      console.log(`🔄 Account switch detected for ${clientId}. Clearing queue.`);
      lastNotified = {};
      notificationQueue = [];
      lastQueueProcessingTime = 0;
  }

  subscriptions[clientId] = {
    subscription,
    assignments: assignments || existingUser.assignments || [],
    lastNotified: lastNotified,
    notificationQueue: notificationQueue,
    lastQueueProcessingTime: lastQueueProcessingTime,
    refreshToken: refreshToken || existingUser.refreshToken, // Only update if provided
    userId: userId || existingUser.userId // Store User ID
  };

  saveSubscriptions();
  res.status(201).json({ message: 'Subscription saved' });
});

// ==========================================
// BACKGROUND SYNC & NOTIFICATION WORKER
// ==========================================

async function refreshAccessToken(refreshToken) {
  try {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.access_token;
  } catch (err) {
    console.error('Failed to refresh token:', err);
    return null;
  }
}

async function fetchCourseWork(accessToken) {
  try {
    // 1. Get Courses
    const coursesRes = await fetch(
      'https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE',
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!coursesRes.ok) return [];
    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];

    const allAssignments = [];

    // 2. Get Work for each course (Sequential to avoid rate limits)
    for (const course of courses) {
      // 2a. Get Assignments
      const workRes = await fetch(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (!workRes.ok) continue;
      const workData = await workRes.json();
      const works = workData.courseWork || [];

      // 2b. Get ALL Submissions (Batch)
      const submissionsMap = new Map();
      let pageToken = null;
      let fetchNext = true;

      while (fetchNext) {
        const url = new URL(`https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/-/studentSubmissions`);
        if (pageToken) url.searchParams.append('pageToken', pageToken);

        const subRes = await fetch(url.toString(), { 
            headers: { 'Authorization': `Bearer ${accessToken}` } 
        });

        if (subRes.ok) {
            const subData = await subRes.json();
            if (subData.studentSubmissions) {
                subData.studentSubmissions.forEach(sub => {
                    submissionsMap.set(sub.courseWorkId, sub);
                });
            }
            pageToken = subData.nextPageToken;
            if (!pageToken) fetchNext = false;
        } else {
            console.error(`Failed to fetch submissions for course ${course.id}`);
            fetchNext = false;
        }
      }

      // 3. Match Assignments with Submissions
      for (const work of works) {
        let status = 'pending';
        let completionTime = null;

        const submission = submissionsMap.get(work.id);
        
        if (submission) {
          const isSubmitted = submission.state === 'TURNED_IN' || submission.state === 'RETURNED';
          status = isSubmitted ? 'submitted' : submission.late ? 'late' : 'pending';
           if (isSubmitted) completionTime = submission.updateTime;
        }

        allAssignments.push({
          title: work.title,
          courseName: course.name,
          dueDate: work.dueDate, // { year, month, day }
          status: status,
          link: work.alternateLink,
          completionTime: completionTime
        });
      }
    }
    return allAssignments;
  } catch (err) {
    console.error('Error fetching course work:', err);
    return [];
  }
}

async function checkAssignmentsAndPush() {
  console.log('🔍 Checking assignments for push notifications...');
  const now = new Date();

  // Iterate async to handle network calls
  for (const clientId of Object.keys(subscriptions)) {
    const user = subscriptions[clientId];
    
    // 1. Try Background Sync if Token Exists
    if (user.refreshToken && process.env.GOOGLE_CLIENT_ID) {
        console.log(`🔄 Syncing data for ${clientId}...`);
        const accessToken = await refreshAccessToken(user.refreshToken);
        if (accessToken) {
            const freshAssignments = await fetchCourseWork(accessToken);
            if (freshAssignments.length > 0) {
                user.assignments = freshAssignments; // Update store
                console.log(`✅ Synced ${freshAssignments.length} assignments for ${clientId}`);
            }
        } else {
            console.log(`⚠️ Could not refresh token for ${clientId}`);
        }
    }

    const { subscription, assignments, lastNotified, notificationQueue } = user;

    if (!subscription || !assignments) continue;

    // Ensure queue exists
    if (!user.notificationQueue) user.notificationQueue = [];

    assignments.forEach(assignment => {
      // Parse Date
      if (!assignment.dueDate) return;
      const dueDate = new Date(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day);

      const diffTime = dueDate - now;
      const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let type = null;
      if (daysUntilDue < 0 && assignment.status === 'late') type = 'overdue';
      else if (daysUntilDue <= 1 && daysUntilDue >= 0 && assignment.status === 'pending') type = 'dueTomorrow';
      else if (daysUntilDue > 1 && daysUntilDue <= 7 && assignment.status === 'pending') type = 'dueSoon';

      if (!type) return;

      // Check cooldown (24 hours)
      const notifKey = `${assignment.title}_${type}`;
      const lastSent = lastNotified[notifKey] || 0;
      
      // Check if already in queue
      const alreadyQueued = user.notificationQueue.some(n => n.notifKey === notifKey);

      if (Date.now() - lastSent > 24 * 60 * 60 * 1000 && !alreadyQueued) {
        // Add to Queue instead of sending immediately
        const messages = COMEDIC_MESSAGES[type];
        const message = messages[Math.floor(Math.random() * messages.length)]
          .replace('{title}', assignment.title)
          .replace('{days}', Math.abs(daysUntilDue));

        let title = '⏰ Due Soon!';
        if (type === 'overdue') title = '🚨 Assignment Overdue!';
        else if (type === 'dueSoon') title = '📅 Upcoming Assignment';

        const payload = JSON.stringify({
          title: title,
          body: message,
          url: assignment.link || '/',
          type: type
        });

        console.log(`📥 Queuing notification for ${clientId}: ${assignment.title} (${type})`);
        
        user.notificationQueue.push({
          payload: payload,
          notifKey: notifKey,
          addedAt: Date.now()
        });
        
        saveSubscriptions();
      }
    });
  };
}

function processNotificationQueues() {
  const now = Date.now();
  const MIN_INTERVAL = 30 * 60 * 1000; // 30 Minutes between notifications per user

  Object.keys(subscriptions).forEach(clientId => {
    const user = subscriptions[clientId];
    
    // Skip if no queue or empty queue
    if (!user.notificationQueue || user.notificationQueue.length === 0) return;

    // THROTTLE CHECK: Ensure we don't send too frequently to the same user
    // If we sent one recently, skip this cycle.
    if (user.lastQueueProcessingTime && (now - user.lastQueueProcessingTime) < MIN_INTERVAL) {
        return;
    }

    // Get the first item (FIFO)
    const item = user.notificationQueue[0];
    
    console.log(`📤 Processing queue for ${clientId}: Sending ${item.notifKey}`);

    webPush.sendNotification(user.subscription, item.payload)
      .then(() => {
        console.log(`✅ Push sent to ${clientId} for ${item.notifKey}`);
        user.lastNotified[item.notifKey] = now;
        user.lastQueueProcessingTime = now; // Update throttle timestamp
        
        // Remove from queue
        user.notificationQueue.shift();
        saveSubscriptions();
      })
      .catch(err => {
        console.error(`❌ Push failed for ${clientId}:`, err.statusCode);
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired
          delete subscriptions[clientId];
          saveSubscriptions();
        } else {
           // If it's a transient error, maybe we keep it? 
           // For now, let's remove it to prevent clogging if it's a payload issue, 
           // or keep it if it's a connection issue? 
           // Let's shift it to be safe and not block others.
           user.notificationQueue.shift();
           saveSubscriptions();
        }
      });
  });
}

// Run check every 30 minutes (Fetch new data & queue items)
setInterval(checkAssignmentsAndPush, 10 * 60 * 1000); 
setTimeout(checkAssignmentsAndPush, 5000); // Initial check

// Process Queue Interval (Check if we should send the next item)
// We run this frequently (e.g. every minute) so we can catch the moment the 30min window opens,
// but the 'lastQueueProcessingTime' check inside ensures we don't spam.
setInterval(processNotificationQueues, 60 * 1000); // Check queue every minute


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
const PORT = process.env.PORT || 8000;
// Bind to 0.0.0.0 to allow external access (AWS requirement)
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 PWA ready for installation`);
  console.log(`\n✅ Features enabled:`);
  console.log(`  - Offline support`);
  console.log(`  - Auto-updates`);
  console.log(`  - Install prompts`);
});
