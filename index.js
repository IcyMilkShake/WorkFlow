// ==========================================
// CONFIGURATION & UTILS
// ==========================================
const USE_MOCK_DATA = false;
const GOOGLE_CLIENT_ID = '204169741443-lrnat59d7ob8ae63srsbg2ojefn1f51h.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/userinfo.profile';

const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);

// ==========================================
// STATE MANAGEMENT
// ==========================================
let googleTokenClient;
let googleAccessToken = localStorage.getItem('googleAccessToken') || null;
let tokenExpiry = localStorage.getItem('tokenExpiry') || null;
let allAssignmentsData = [];
let allCoursesData = [];
let ignoredCourses = new Set(JSON.parse(localStorage.getItem('ignoredCourses') || '[]'));
let currentTheme = localStorage.getItem('theme') || 'dark';
let previousAssignmentStates = JSON.parse(localStorage.getItem('previousStates') || '{}');
let completionHistory = JSON.parse(localStorage.getItem('completionHistory') || '{}');
let isLoading = false;
let conversationHistory = [];

let statusChartInstance = null;
let courseChartInstance = null;
let productivityChartInstance = null;
let currentProductivityView = 'today';

// ==========================================
// SERVICE WORKER
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        setInterval(() => registration.update(), 60000);
      })
      .catch((error) => console.error('Service Worker registration failed:', error));
  });
}

// ==========================================
// NOTIFICATIONS
// ==========================================
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
  dueSoonRandom: [ 
    "👋 Just a friendly check-in: '{title}' is due in {days} days.", 
    "👀 Peeking in to remind you about '{title}'. It's due in {days} days!", 
    "Plan ahead! '{title}' is coming up in {days} days.", 
    "Might want to start thinking about '{title}'. {days} days left!", 
    "✨ You got this! '{title}' is due in {days} days. Don't leave it for the last minute." 
  ] 
};

window.requestNotificationPermission = async function() {
  if (!('Notification' in window)) {
    showToast('❌ This browser does not support notifications');
    return;
  }

  const permission = await Notification.requestPermission();
  
  if (permission === 'granted') {
    byId('notificationPermission').style.display = 'none';
    localStorage.setItem('notificationsEnabled', 'true');

    // Subscribe to Web Push
    subscribeToPush();

    showToast('🎉 Notifications enabled! You\'ll get comedic reminders for deadlines.');
  } else {
    showToast('❌ Notifications permission denied');
  }
}

// ==========================================
// PUSH NOTIFICATION SUBSCRIPTION
// ==========================================
async function subscribeToPush() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;

    // Get VAPID Key from Server
    const response = await fetch('/api/vapidPublicKey');
    const { publicKey } = await response.json();

    const convertedVapidKey = urlBase64ToUint8Array(publicKey);

    // Subscribe user
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey
    });

    console.log('✅ Push Subscribed:', subscription);

    // Send subscription + data to server
    syncWithServer(subscription);

  } catch (error) {
    console.error('❌ Failed to subscribe to push:', error);
  }
}

async function syncWithServer(subscription = null) {
  try {
    if (!subscription) {
      const registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
    }

    if (!subscription) return; // User hasn't enabled push yet

    // Determine refresh token (only send if we just got it)
    // Note: We don't store refresh token in localStorage for security (usually),
    // but here we are relying on the one-time exchange or if we decide to store it.
    // Ideally, we send it once right after login.
    // For now, let's assume the backend handles the persistence, and we just send assignment data updates.
    // If we have a stored refresh token in memory (from immediate login), send it.

    const payload = {
      clientId: subscription.endpoint, // Use endpoint as unique ID
      subscription: subscription,
      assignments: allAssignmentsData,
      refreshToken: window.tempRefreshToken || null
    };

    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Clear temp token after sending
    if (window.tempRefreshToken) window.tempRefreshToken = null;

    console.log('✅ Synced data with server');

  } catch (error) {
    console.error('❌ Sync failed:', error);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function scheduleNotificationChecks() {
  // Local checks (deprecated in favor of server push, but kept for fallback)
  checkAndSendNotifications();
  setInterval(checkAndSendNotifications, 60 * 60 * 1000);
}

function checkAndSendNotifications() {
  if (Notification.permission !== 'granted') return;
  if (localStorage.getItem('notificationsEnabled') !== 'true') return;
  
  const now = new Date();
  const filteredAssignments = allAssignmentsData.filter(a => !ignoredCourses.has(a.courseName));
  
  filteredAssignments.forEach(assignment => {
    if (!assignment.dueDate) return;
    
    const dueDate = new Date(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day);
    const diffTime = dueDate - now;
    const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (daysUntilDue < 0 && assignment.status === 'late') {
      sendNotification(assignment, 'overdue', Math.abs(daysUntilDue));
    } else if (daysUntilDue === 1 && assignment.status === 'pending') {
      sendNotification(assignment, 'dueTomorrow', daysUntilDue);
    } else if (daysUntilDue >= 2 && daysUntilDue <= 7 && assignment.status === 'pending') {
      const count = getNotificationCount(assignment.title, 'dueSoonRandom');
      if (count < 2 && Math.random() < 0.1) {
        sendNotification(assignment, 'dueSoonRandom', daysUntilDue);
      }
    }
  });
}

function sendNotification(assignment, type, days) {
  if (!shouldShowNotification(assignment.title, type)) return;
  
  const messages = COMEDIC_MESSAGES[type];
  const message = messages[Math.floor(Math.random() * messages.length)]
    .replace('{title}', assignment.title)
    .replace('{days}', days);
  
  const titles = {
    dueTomorrow: '⏰ Due Tomorrow!',
    overdue: '🚨 Assignment Overdue!',
    dueSoonRandom: '📅 Assignment Reminder'
  };

  new Notification(titles[type], {
    body: message,
    icon: '/icons/icon-192x192.png',
    tag: `${type}-${assignment.title}`,
    requireInteraction: type === 'overdue'
  });
  
  recordNotification(assignment.title, type);
  if (type === 'dueSoonRandom') {
    incrementNotificationCount(assignment.title, type);
  }
}

function shouldShowNotification(assignmentTitle, type) {
  const key = `notif_time_${assignmentTitle}_${type}`;
  const lastShown = localStorage.getItem(key);
  if (!lastShown) return true;
  const hoursSinceLastShown = (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60);
  return hoursSinceLastShown >= 24;
}

function recordNotification(assignmentTitle, type) {
  localStorage.setItem(`notif_time_${assignmentTitle}_${type}`, Date.now().toString());
}

function getNotificationCount(assignmentTitle, type) {
  return parseInt(localStorage.getItem(`notif_count_${assignmentTitle}_${type}`) || '0');
}

function incrementNotificationCount(assignmentTitle, type) {
  const key = `notif_count_${assignmentTitle}_${type}`;
  const count = getNotificationCount(assignmentTitle, type);
  localStorage.setItem(key, (count + 1).toString());
}

// ==========================================
// PRODUCTIVITY TRACKING
// ==========================================
window.recalculateProductivityFromHistory = function(assignments) {
  const freshHistory = {};
  
  assignments.forEach(assignment => {
    const key = assignment.title + '_' + assignment.courseName;
    const previousState = previousAssignmentStates[key];
    
    if (previousState && previousState !== 'submitted' && assignment.status === 'submitted') {
      showToast(`🎉 Great job completing "${assignment.title}"!`);
    }
    previousAssignmentStates[key] = assignment.status;

    if (assignment.status === 'submitted' && assignment.completionTime) {
      const date = new Date(assignment.completionTime);
      const dateKey = date.toLocaleDateString('en-CA'); 
      freshHistory[dateKey] = (freshHistory[dateKey] || 0) + 1;
    }
  });

  completionHistory = freshHistory;
  localStorage.setItem('previousStates', JSON.stringify(previousAssignmentStates));
  localStorage.setItem('completionHistory', JSON.stringify(completionHistory));
  updateProductivityStats();
}

function trackCompletion(assignmentTitle, date = null) {
  const dateKey = date || new Date().toISOString().split('T')[0];
  completionHistory[dateKey] = (completionHistory[dateKey] || 0) + 1;
  localStorage.setItem('completionHistory', JSON.stringify(completionHistory));
  updateProductivityStats();
}

function updateProductivityStats() {
  const totalCompleted = Object.values(completionHistory).reduce((a, b) => a + b, 0);
  byId('totalCompleted').textContent = totalCompleted;
  
  byId('currentStreak').textContent = calculateStreak();
  byId('weeklyAvg').textContent = calculateWeeklyAverage().toFixed(1);
  
  const today = new Date().toISOString().split('T')[0];
  byId('completedToday').textContent = completionHistory[today] || 0;
}

function calculateStreak() {
  const today = new Date();
  let streak = 0;
  
  for (let i = 0; i < 365; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    
    if (completionHistory[dateKey] && completionHistory[dateKey] > 0) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

function calculateWeeklyAverage() {
  const today = new Date();
  let totalLast7Days = 0;
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    totalLast7Days += completionHistory[dateKey] || 0;
  }
  return totalLast7Days / 7;
}

window.generateProductivityChart = function(view = 'week') {
  const ctx = byId('productivityChart');
  if (!ctx) return;
  
  if (productivityChartInstance) {
    productivityChartInstance.destroy();
  }

  let labels = [];
  let data = [];
  const today = new Date();

  let chartType = 'line';
  let tension = 0.4;
  let backgroundColor = 'rgba(182, 109, 255, 0.1)';

  if (view === 'today') {
    chartType = 'bar';
    tension = 0;
    backgroundColor = 'rgba(182, 109, 255, 0.5)';
    labels = Array.from({length: 24}, (_, i) => `${i}:00`);
    data = new Array(24).fill(0);
    
    const todayStr = today.toLocaleDateString('en-CA');
    
    allAssignmentsData.forEach(assignment => {
      if (assignment.status === 'submitted' && assignment.completionTime) {
        const d = new Date(assignment.completionTime);
        if (d.toLocaleDateString('en-CA') === todayStr) {
          data[d.getHours()]++;
        }
      }
    });
  } else {
    const daysToCheck = view === 'week' ? 7 : 30;
    for (let i = daysToCheck - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const dateKey = date.toLocaleDateString('en-CA');
      data.push(completionHistory[dateKey] || 0);
    }
  }

  productivityChartInstance = new Chart(ctx, {
    type: chartType,
    data: {
      labels: labels,
      datasets: [{
        label: 'Assignments Completed',
        data: data,
        borderColor: '#b66dff',
        backgroundColor: backgroundColor,
        borderWidth: chartType === 'bar' ? 0 : 3,
        borderRadius: 4,
        fill: true,
        tension: tension,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: '#b66dff',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(31, 33, 40, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#b66dff',
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (context) => `${context.parsed.y} assignment${context.parsed.y !== 1 ? 's' : ''} completed`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#adb5bd', stepSize: 1, font: { family: 'Poppins' } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        x: {
          ticks: { color: '#adb5bd', maxRotation: 45, minRotation: 45, font: { family: 'Poppins', size: 10 } },
          grid: { display: false }
        }
      }
    }
  });
}

window.changeProductivityView = function(view) {
  currentProductivityView = view;
  qsa('.time-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.view === view) btn.classList.add('active');
  });
  generateProductivityChart(view);
}

// ==========================================
// STATISTICS
// ==========================================
function generateStatistics() {
  const assignments = allAssignmentsData.filter(a => !ignoredCourses.has(a.courseName));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const thisWeek = assignments.filter(a => {
    const date = parseGoogleDate(a.dueDate);
    if (!date) return false;
    return date >= today && date <= weekFromNow && a.status !== 'submitted';
  });
  byId('upcomingWeek').textContent = thisWeek.length;

  const overdue = assignments.filter(a => a.status === 'late');
  byId('overdueTotal').textContent = overdue.length;

  const pendingAssignments = assignments.filter(a => a.status !== 'submitted');
  const uniqueCourses = [...new Set(pendingAssignments.map(a => a.courseName))];
  byId('totalCourses').textContent = uniqueCourses.length;

  const avgPerCourse = uniqueCourses.length > 0 
    ? (pendingAssignments.length / uniqueCourses.length).toFixed(1)
    : 0;
  byId('avgPerCourse').textContent = avgPerCourse;

  generateStatusChart(assignments);
  generateCourseChart(assignments);
  generateUpcomingDeadlines(thisWeek);
  
  updateProductivityStats();
  generateProductivityChart(currentProductivityView);
}

function generateStatusChart(assignments) {
  const container = byId('statusChartCard');
  if (!container) return;

  const pending = assignments.filter(a => a.status === 'pending').length;
  const late = assignments.filter(a => a.status === 'late').length;

  // Handle Empty State
  if (pending === 0 && late === 0) {
    container.innerHTML = `
      <div class="card-title">Assignment Status Distribution</div>
      <div class="empty-state">
        <div class="empty-state-icon"><i class="ph ph-confetti"></i></div>
        <h3>No pending assignments!</h3>
        <p>You're all caught up.</p>
      </div>`;
    return;
  }

  // Restore Canvas if missing (recovering from empty state)
  let ctx = byId('statusChart');
  if (!ctx) {
    container.innerHTML = `
      <div class="card-title">Assignment Status Distribution</div>
      <canvas id="statusChart" style="max-height: 300px;"></canvas>`;
    ctx = byId('statusChart');
  }

  if (statusChartInstance) statusChartInstance.destroy();

  statusChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pending', 'Late'],
      datasets: [{
        data: [pending, late],
        backgroundColor: ['#ffab00', '#fc424a'],
        borderWidth: 0,
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#ffffff', padding: 15, font: { family: 'Poppins', size: 12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(31, 33, 40, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#b66dff',
          borderWidth: 1,
          padding: 12
        }
      }
    }
  });
}

function generateCourseChart(assignments) {
  const container = byId('courseChartCard');
  if (!container) return;

  const pendingAssignments = assignments.filter(a => a.status !== 'submitted');
  const courseCounts = {};
  pendingAssignments.forEach(a => courseCounts[a.courseName] = (courseCounts[a.courseName] || 0) + 1);

  const courses = Object.keys(courseCounts);
  const counts = Object.values(courseCounts);

  // Handle Empty State
  if (courses.length === 0) {
    container.innerHTML = `
      <div class="card-title">Assignments by Course</div>
      <div class="empty-state">
        <div class="empty-state-icon"><i class="ph ph-confetti"></i></div>
        <h3>No pending assignments!</h3>
        <p>You're all caught up.</p>
      </div>`;
    return;
  }

  // Restore Canvas if missing
  let ctx = byId('courseChart');
  if (!ctx) {
    container.innerHTML = `
      <div class="card-title">Assignments by Course</div>
      <canvas id="courseChart" style="max-height: 300px;"></canvas>`;
    ctx = byId('courseChart');
  }

  if (courseChartInstance) courseChartInstance.destroy();

  courseChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: courses,
      datasets: [{
        label: 'Assignments',
        data: counts,
        backgroundColor: '#b66dff',
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(31, 33, 40, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#b66dff',
          borderWidth: 1,
          padding: 12
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#adb5bd', stepSize: 1, font: { family: 'Poppins' } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        x: {
          ticks: { color: '#adb5bd', font: { family: 'Poppins', size: 10 } },
          grid: { display: false }
        }
      }
    }
  });
}

function generateUpcomingDeadlines(upcomingAssignments) {
  const container = byId('upcomingDeadlines');
  if (!container) return;
  
  if (upcomingAssignments.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
        <div style="font-size: 3rem; margin-bottom: 0.5rem; color: var(--primary);"><i class="ph ph-confetti"></i></div>
        <div>No assignments due in the next 7 days!</div>
      </div>`;
    return;
  }

  upcomingAssignments.sort((a, b) => parseGoogleDate(a.dueDate) - parseGoogleDate(b.dueDate));

  container.innerHTML = upcomingAssignments.map(assignment => {
    const dueDate = formatDueDate(assignment);
    const statusColor = assignment.status === 'late' ? 'var(--danger)' : 'var(--warning)';
    
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(182, 109, 255, 0.05); border-radius: 8px; border-left: 3px solid ${statusColor}; margin-bottom: 0.75rem; cursor: pointer;" onclick="window.open('${assignment.link}', '_blank')">
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 0.25rem;">${assignment.title}</div>
          <div style="font-size: 0.875rem; color: var(--text-secondary);">${assignment.courseName}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 600; color: ${statusColor};">${dueDate}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${assignment.status === 'late' ? 'Overdue' : 'Upcoming'}</div>
        </div>
      </div>`;
  }).join('');
}

// ==========================================
// AI ASSISTANT
// ==========================================
function updateAIPendingCount() {
  const countElement = byId('aiPendingCount');
  if (!countElement) return;
  
  const filtered = allAssignmentsData.filter(a => a.status !== 'submitted' && !ignoredCourses.has(a.courseName));
  countElement.textContent = `${filtered.length} pending assignment${filtered.length !== 1 ? 's' : ''}`;
}

function initAIAssistant() {
  const chatInterface = byId('chatInterface');
  
  if (isLoading) {
    chatInterface.style.display = 'none';
    const container = byId('aiAssistantPage');
    let loader = byId('aiLoadingIndicator');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'aiLoadingIndicator';
      loader.className = 'loading';
      loader.innerHTML = '🔮 Analyzing assignments...';
      container.appendChild(loader);
    }
    loader.style.display = 'block';
    return;
  }

  const loader = byId('aiLoadingIndicator');
  if (loader) loader.style.display = 'none';

  chatInterface.style.display = 'block';
  updateAIPendingCount();
  
  if (!window.hasGeneratedGreeting) {
    window.hasGeneratedGreeting = true;
    generateProactiveGreeting();
  }
}

async function generateProactiveGreeting() {
  if (isLoading) return;

  const chatMessages = byId('chatMessages');
  if (chatMessages.children.length > 0) chatMessages.innerHTML = '';

  const typingDiv = addTypingIndicator();

  try {
    const filtered = allAssignmentsData.filter(a => a.status !== 'submitted' && !ignoredCourses.has(a.courseName));

    if (filtered.length === 0) {
      typingDiv.remove();
      addChatMessage("🎉 You're all caught up! No pending assignments.", 'assistant');
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const lateCount = filtered.filter(a => a.status === 'late').length;
    const pendingCount = filtered.filter(a => a.status === 'pending').length;

    const assignmentsContext = filtered.map(a => ({
      title: a.title,
      course: a.courseName,
      description: a.description || 'No description provided',
      points: a.maxPoints || 'Ungraded',
      dueDate: a.dueDate ? `${a.dueDate.year}-${a.dueDate.month}-${a.dueDate.day}` : 'No due date',
      status: a.status
    }));

    const systemPrompt = `TODAY IS ${todayStr}
WORKLOAD: ${lateCount} late, ${pendingCount} pending.
Generate ONE sentence greeting telling the user what to focus on first. Be urgent if something is late.
Assignments: ${JSON.stringify(assignmentsContext)}`;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Give me a brief greeting and tell me what to focus on first." }
        ],
        max_tokens: 100
      })
    });

    if (!response.ok) throw new Error("API request failed");
    const data = await response.json();
    const greeting = data.choices[0].message.content;

    conversationHistory.push({ role: "assistant", content: greeting });
    typingDiv.remove();
    addChatMessage(greeting, "assistant");

  } catch (error) {
    typingDiv.remove();
    const fallback = "Hey there! Let's take a look at what you need to work on today.";
    addChatMessage(fallback, "assistant");
    conversationHistory.push({ role: 'assistant', content: fallback });
  }
}

window.sendChatMessage = async function() {
  const input = byId('chatInput');
  const message = input.value.trim();
  if (!message) return;

  addChatMessage(message, 'user');
  input.value = '';

  const typingDiv = addTypingIndicator();

  try {
    const filtered = allAssignmentsData.filter(a => a.status !== 'submitted' && !ignoredCourses.has(a.courseName));
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const lateCount = filtered.filter(a => a.status === 'late').length;
    const pendingCount = filtered.filter(a => a.status === 'pending').length;

    const assignmentsContext = filtered.map(a => ({
      title: a.title,
      course: a.courseName,
      description: a.description || 'No description provided',
      points: a.maxPoints || 'Ungraded',
      dueDate: a.dueDate ? `${a.dueDate.year}-${a.dueDate.month}-${a.dueDate.day}` : 'No due date',
      status: a.status
    }));

    const systemPrompt = `You are a smart, context-aware AI study assistant. Be concise and direct - keep responses brief when should.
TODAY: ${todayStr}
Late: ${lateCount}, Pending: ${pendingCount}
Analyze the assignments below and answer user questions accurately.
Assignments: ${JSON.stringify(assignmentsContext, null, 2)}`;

    conversationHistory.push({ role: 'user', content: message });
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10)
    ];

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: 500
      })
    });

    if (!response.ok) throw new Error('OpenAI API request failed');
    const data = await response.json();
    const aiMessage = data.choices[0].message.content;

    conversationHistory.push({ role: 'assistant', content: aiMessage });
    typingDiv.remove();
    addChatMessage(aiMessage, 'assistant');

  } catch (error) {
    typingDiv.remove();
    addChatMessage('⚠️ Sorry, I encountered an error. Please check your API key and try again.', 'assistant');
  }
}

function addChatMessage(content, sender) {
  const chatMessages = byId('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${sender}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  if (sender === 'user') {
      avatar.innerHTML = '<i class="ph ph-user"></i>';
  } else {
      avatar.innerHTML = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" version="1.1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" style="width: 24px; height: 24px;">
          <rect height="7.5" width="12.5" y="5.75" x="1.75"></rect> 
          <path d="m10.75 8.75v1.5m-5.5-1.5v1.5m-.5-7.5 3.25 3 3.25-3"></path> 
      </svg>`;
  }
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'chat-content';
  contentDiv.textContent = content;
  
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addTypingIndicator() {
  const chatMessages = byId('chatMessages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-message';
  typingDiv.innerHTML = `
    <div class="chat-avatar">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" version="1.1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" style="width: 24px; height: 24px;">
            <rect height="7.5" width="12.5" y="5.75" x="1.75"></rect> 
            <path d="m10.75 8.75v1.5m-5.5-1.5v1.5m-.5-7.5 3.25 3 3.25-3"></path> 
        </svg>
    </div>
    <div class="chat-content"><span style="opacity: 0.6;">Thinking...</span></div>`;
  
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return typingDiv;
}

// ==========================================
// GOOGLE AUTH & ASSIGNMENTS
// ==========================================
function initializeGoogleAuth() {
  if (USE_MOCK_DATA) return;
  
  // Note: For offline access (Refresh Token), we need to request 'code' flow,
  // but standard initTokenClient uses 'implicit' flow.
  // We will configure this to use 'code' flow for the initial permission grant if possible,
  // or simply add prompt: 'consent' and access_type: 'offline' equivalent if supported by the client.
  // Actually, initTokenClient is for implicit flow (access token only).
  // For offline access, we need initCodeClient.

  googleTokenClient = google.accounts.oauth2.initCodeClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    ux_mode: 'popup',
    select_account: true,
    callback: handleGoogleAuthResponse,
  });
}

function handleGoogleAuthResponse(response) {
  if (response.error) {
    showError('Google authentication failed: ' + response.error);
    return;
  }
  
  // With initCodeClient, we receive an authorization code, not an access token directly.
  // We must exchange this code for tokens on the backend OR use it just for the refresh token
  // and continue using implicit flow for the frontend?
  // Actually, if we use code flow, we get a code. We send that code to the backend.
  // The backend swaps it for (access_token, refresh_token).
  // The backend then returns the access_token to us (the frontend) so we can make calls too.
  // OR we can just use the code to get the refresh token on the server, and *also* use implicit flow?
  //
  // Better approach for this user's simple app structure:
  // 1. Send the code to the backend.
  // 2. Backend exchanges it, saves the Refresh Token.
  // 3. Backend returns the Access Token to the frontend.

  const code = response.code;
  exchangeCodeForToken(code);
}

async function exchangeCodeForToken(code) {
  try {
    const res = await fetch('/api/auth/google/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    if (!res.ok) throw new Error('Failed to exchange code');

    const data = await res.json();
    googleAccessToken = data.access_token;

    // Store refresh token temporarily to send to /api/subscribe
    if (data.refresh_token) {
        window.tempRefreshToken = data.refresh_token;
    }

    const expiryTime = Date.now() + (data.expires_in || 3600) * 1000;

    localStorage.setItem('googleAccessToken', googleAccessToken);
    localStorage.setItem('tokenExpiry', expiryTime.toString());

    showDashboard();
    loadAssignments();
  } catch (err) {
    showError('Authentication error: ' + err.message);
  }
}

async function loadAssignments() {
  const loadingMsg = byId('loadingMsg');
  const assignmentsList = byId('assignmentsList');
  
  isLoading = true;
  loadingMsg.style.display = 'block';
  assignmentsList.innerHTML = '';
  updateAIViewIfActive();

  try {
    if (USE_MOCK_DATA) {
      qs('.user-name').textContent = 'Test Student';
      
      allCoursesData = [
        { id: '1', name: 'AP Physics' },
        { id: '2', name: 'World History' },
        { id: '3', name: 'English Lit' }
      ];

      allAssignmentsData = [
        {
          source: 'google',
          title: 'Lab Report: Kinematics',
          courseName: 'AP Physics',
          description: 'Write a full lab report on the projectile motion experiment. Include error analysis and graphs.',
          maxPoints: 100,
          dueDate: { year: 2024, month: 11, day: 20 },
          status: 'late',
          link: '#'
        },
        {
          source: 'google',
          title: 'Read Chapter 4',
          courseName: 'World History',
          description: 'Read chapter 4 and answer the review questions at the end.',
          maxPoints: 10,
          dueDate: { year: 2024, month: 11, day: 25 },
          status: 'pending',
          link: '#'
        },
        {
          source: 'google',
          title: 'Essay Draft',
          courseName: 'English Lit',
          description: 'Submit your first draft of the Macbeth analysis essay. Minimum 500 words.',
          maxPoints: 50,
          dueDate: { year: 2024, month: 11, day: 26 },
          status: 'pending',
          link: '#'
        }
      ];

      await new Promise(resolve => setTimeout(resolve, 800));
      recalculateProductivityFromHistory(allAssignmentsData);
      displayAssignments(allAssignmentsData);
      updateStats(allAssignmentsData);
      return;
    }

    const userinfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (userinfo.status === 401) {
      showLoginScreen();
      return;
    }

    if (userinfo.ok) {
      const pfp = await userinfo.json();
      const avatarDiv = qs('.user-avatar');
      if (pfp.picture) avatarDiv.style.backgroundImage = `url(${pfp.picture})`;
      if (pfp.name) qs('.user-name').textContent = pfp.name;
    }

    const coursesResponse = await fetch(
      'https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE',
      { headers: { 'Authorization': `Bearer ${googleAccessToken}` }}
    );

    if (coursesResponse.status === 401) {
      showLoginScreen();
      return;
    }

    if (!coursesResponse.ok) throw new Error('Failed to fetch courses');

    const coursesData = await coursesResponse.json();
    const courses = coursesData.courses || [];
    allCoursesData = courses;
    
    const flatAssignments = [];
    
    for (const course of courses) {
      try {
        const courseworkResponse = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
          { headers: { 'Authorization': `Bearer ${googleAccessToken}` }}
        );

        if (!courseworkResponse.ok) continue;

        const courseworkData = await courseworkResponse.json();
        const coursework = courseworkData.courseWork || [];
        
        const BATCH_SIZE = 5;
        for (let i = 0; i < coursework.length; i += BATCH_SIZE) {
          const batch = coursework.slice(i, i + BATCH_SIZE);
          const assignmentPromises = batch.map(async (work) => {
            try {
              const submissionResponse = await fetch(
                `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/${work.id}/studentSubmissions`,
                { headers: { 'Authorization': `Bearer ${googleAccessToken}` }}
              );

              let status = 'pending';
              let completionTime = null;

              if (submissionResponse.ok) {
                const submissionData = await submissionResponse.json();
                const submission = submissionData.studentSubmissions?.[0];
                if (submission) {
                  const isSubmitted = submission.state === 'TURNED_IN' || submission.state === 'RETURNED';
                  status = isSubmitted ? 'submitted' : submission.late ? 'late' : 'pending';
                  if (isSubmitted) completionTime = submission.updateTime;
                }
              }

              return {
                source: 'google',
                title: work.title,
                courseName: course.name,
                description: work.description,
                maxPoints: work.maxPoints,
                dueDate: work.dueDate,
                dueTime: work.dueTime,
                status: status,
                link: work.alternateLink,
                completionTime: completionTime
              };
            } catch (error) {
              console.error(`Error loading submission:`, error);
              return null;
            }
          });
          
          const batchResults = await Promise.all(assignmentPromises);
          flatAssignments.push(...batchResults.filter(a => a !== null));
        }
      } catch (error) {
        console.error(`Error loading coursework for ${course.name}:`, error);
      }
    }
    
    allAssignmentsData = flatAssignments;
    recalculateProductivityFromHistory(flatAssignments);
    displayAssignments(flatAssignments);
    updateStats(flatAssignments);

    // Sync with Server for Push Notifications
    if (localStorage.getItem('notificationsEnabled') === 'true') {
        syncWithServer();
    }

  } finally {
    isLoading = false;
    loadingMsg.style.display = 'none';
    updateAIViewIfActive();
  }
}

function updateAIViewIfActive() {
  const aiPage = byId('aiAssistantPage');
  if (aiPage.style.display !== 'none') initAIAssistant();
}

function updateStats(assignments) {
  const filteredAssignments = assignments.filter(a => !ignoredCourses.has(a.courseName));
  const pending = filteredAssignments.filter(a => a.status !== 'submitted');
  const late = filteredAssignments.filter(a => a.status === 'late');

  byId('totalCount').textContent = pending.length;
  byId('pendingCount').textContent = pending.filter(a => a.status === 'pending').length;
  byId('lateCount').textContent = late.length;
  byId('dueToday').textContent = pending.filter(a => {
    const date = parseGoogleDate(a.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date && date.getTime() === today.getTime();
  }).length;
  
  updateProductivityStats();
}

function displayAssignments(assignments) {
  const assignmentsList = byId('assignmentsList');
  const filteredAssignments = assignments.filter(a => !ignoredCourses.has(a.courseName));
  const pendingAssignments = filteredAssignments.filter(a => a.status !== 'submitted');
  
  if (pendingAssignments.length === 0) {
    assignmentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="ph ph-confetti"></i></div>
        <h3>All caught up!</h3>
        <p>You have no pending assignments.</p>
      </div>`;
    return;
  }

  pendingAssignments.sort((a, b) => {
    const dateA = parseGoogleDate(a.dueDate);
    const dateB = parseGoogleDate(b.dueDate);
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA - dateB;
  });

  assignmentsList.innerHTML = pendingAssignments.map(assignment => {
    const dueDate = formatDueDate(assignment);
    const statusClass = assignment.status;
    const statusText = assignment.status === 'late' ? 'Late' : 'Pending';
    const statusIcon = assignment.status === 'late' ? '<i class="ph ph-warning"></i>' : '<i class="ph ph-hourglass"></i>';

    return `
      <div class="assignment-card" onclick="window.open('${assignment.link}', '_blank')">
        <div class="assignment-badge">Google Classroom</div>
        <div class="assignment-title">${assignment.title}</div>
        <div class="assignment-course">${assignment.courseName}</div>
        <div class="assignment-meta">
          <span>📅 ${dueDate}</span>
        </div>
        <div class="assignment-status ${statusClass}">
          ${statusIcon} ${statusText}
        </div>
      </div>`;
  }).join('');
}

function parseGoogleDate(dueDate) {
  if (!dueDate) return null;
  return new Date(dueDate.year, dueDate.month - 1, dueDate.day);
}

function formatDueDate(assignment) {
  if (!assignment.dueDate) return 'No due date';
  
  const date = parseGoogleDate(assignment.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const diffTime = date - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Due Today';
  if (diffDays === 1) return 'Due Tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)} days overdue`;
  if (diffDays < 7) return `Due in ${diffDays} days`;
  
  return `Due ${date.toLocaleDateString()}`;
}

// ==========================================
// UI FUNCTIONS
// ==========================================
window.showPage = function(page) {
  qsa('.sidebar-menu-item').forEach(item => item.classList.remove('active'));
  // Note: 'event' is available in the global scope when called from HTML inline handlers
  if (typeof event !== 'undefined' && event.target && event.target.closest) {
      const item = event.target.closest('.sidebar-menu-item');
      if (item) item.classList.add('active');
  }

  // Updated 'aiAssistant' to match HTML ID 'aiAssistantPage' (no hyphen)
  const pages = ['assignments', 'statistics', 'aiAssistant', 'courses', 'settings', 'help'];
  pages.forEach(p => {
      const el = byId(p + 'Page');
      if (el) el.style.display = 'none';
  });

  if (page === 'statistics') {
    byId('statisticsPage').style.display = 'block';
    generateStatistics();
  } else if (page === 'aiAssistant') {
    byId('aiAssistantPage').style.display = 'block';
    initAIAssistant();
  } else if (page === 'assignments') {
    byId('assignmentsPage').style.display = 'block';
  } else if (page === 'courses') {
    byId('coursesPage').style.display = 'block';
    displayCourses();
  } else if (page === 'settings') {
    byId('settingsPage').style.display = 'block';
    initializeSettings();
  } else if (page === 'help') {
    byId('helpPage').style.display = 'block';
  } else if (page === 'dashboard') {
      // Assuming dashboard falls back to assignments or similar if explicit
      byId('assignmentsPage').style.display = 'block';
  }
}

window.toggleAccordion = function(element) {
    const item = element.parentElement;
    item.classList.toggle('active');
}

function displayCourses() {
  const coursesList = byId('coursesList');
  
  if (allCoursesData.length === 0) {
    coursesList.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="ph ph-books"></i></div><h3>No courses found</h3></div>';
    return;
  }

  const assignmentCounts = {};
  allAssignmentsData.forEach(a => {
    if (a.status !== 'submitted') {
      assignmentCounts[a.courseName] = (assignmentCounts[a.courseName] || 0) + 1;
    }
  });

  coursesList.innerHTML = allCoursesData.map(course => {
    const isIgnored = ignoredCourses.has(course.name);
    const assignmentCount = assignmentCounts[course.name] || 0;
    
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: rgba(182, 109, 255, 0.05); border-radius: 8px; margin-bottom: 0.75rem; border-left: 3px solid ${isIgnored ? 'var(--text-muted)' : 'var(--primary)'};">
        <div style="display: flex; align-items: center; gap: 1rem; flex: 1;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" ${isIgnored ? '' : 'checked'} onchange="toggleCourse('${course.name.replace(/'/g, "\\'")}', this.checked)" style="width: 20px; height: 20px; cursor: pointer;">
          </label>
          <div style="flex: 1; ${isIgnored ? 'opacity: 0.5;' : ''}">
            <div style="font-weight: 600; margin-bottom: 0.25rem;">${course.name}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary);">
              ${assignmentCount} pending assignment${assignmentCount !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        ${isIgnored ? '<span style="color: var(--text-muted); font-size: 0.875rem; font-weight: 600;">IGNORED</span>' : ''}
      </div>`;
  }).join('');
}

window.toggleCourse = function(courseName, isEnabled) {
  if (isEnabled) {
    ignoredCourses.delete(courseName);
  } else {
    ignoredCourses.add(courseName);
  }
  
  localStorage.setItem('ignoredCourses', JSON.stringify([...ignoredCourses]));
  displayAssignments(allAssignmentsData);
  updateStats(allAssignmentsData);
  displayCourses();
}

function initializeSettings() {
  qsa('input[name="theme"]').forEach(radio => {
    if (radio.value === currentTheme) {
      radio.checked = true;
      radio.closest('.theme-option')?.style.setProperty('border-color', 'var(--primary)');
    }
    radio.addEventListener('change', (e) => changeTheme(e.target.value));
  });

  const notifToggle = byId('notifToggle');
  if (notifToggle) {
    notifToggle.checked = localStorage.getItem('notificationsEnabled') === 'true';
  }
}

window.toggleNotifications = async function(enabled) {
  const toggle = byId('notifToggle');
  
  if (enabled) {
    if (Notification.permission === 'granted') {
      localStorage.setItem('notificationsEnabled', 'true');
      showToast('🔔 Notifications enabled');
      scheduleNotificationChecks();
    } else {
      toggle.checked = false; 
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem('notificationsEnabled', 'true');
        toggle.checked = true;
        showToast('🎉 Notifications enabled!');
        scheduleNotificationChecks();
        byId('notificationPermission').style.display = 'none';
      } else {
        showToast('❌ Permission denied. Please enable in browser settings.');
      }
    }
  } else {
    localStorage.setItem('notificationsEnabled', 'false');
    showToast('🔕 Notifications disabled');
  }
}

function changeTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  
  document.body.classList.remove('light-theme', 'midnight-theme');
  if (theme === 'light') document.body.classList.add('light-theme');
  else if (theme === 'midnight') document.body.classList.add('midnight-theme');
  
  qsa('.theme-option').forEach(option => {
    option.style.borderColor = 'transparent';
  });
  qs(`.theme-option[data-theme="${theme}"]`)?.style.setProperty('border-color', 'var(--primary)');
}

function showDashboard() {
  byId('loginPage').style.display = 'none';
  byId('dashboardPage').style.display = 'block';
}

function showLoginScreen() {
  byId('loginPage').style.display = 'flex';
  byId('dashboardPage').style.display = 'none';
  googleAccessToken = null;
  localStorage.removeItem('googleAccessToken');
  localStorage.removeItem('tokenExpiry');
}

function showError(message) {
  const errorMsg = byId('errorMsg');
  errorMsg.textContent = message;
  errorMsg.style.display = 'block';
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initializeGoogleAuth();
  
  if (currentTheme === 'light') {
    document.body.classList.add('light-theme');
  } else if (currentTheme === 'midnight') {
    document.body.classList.add('midnight-theme');
  }
  
  if (localStorage.getItem('notificationsEnabled') !== 'true' && 'Notification' in window) {
    byId('notificationPermission').style.display = 'flex';
  }
  
  const chatInput = byId('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
  
  if (!USE_MOCK_DATA && googleAccessToken && tokenExpiry) {
    const now = Date.now();
    const expiry = parseInt(tokenExpiry);
    
    if (now < expiry) {
      showDashboard();
      loadAssignments();
    } else {
      showLoginScreen();
    }
  }
  
  updateProductivityStats();
  
  const mobileMenuBtn = byId('mobileMenuBtn');
  const sidebar = qs('.sidebar');
  const backdrop = byId('mobileBackdrop');
  
  function toggleSidebar() {
    sidebar.classList.toggle('sidebar-open');
    backdrop.classList.toggle('show');
  }
  
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleSidebar);
  if (backdrop) backdrop.addEventListener('click', toggleSidebar);
  
  qsa('.sidebar-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 991) {
        sidebar.classList.remove('sidebar-open');
        backdrop.classList.remove('show');
      }
    });
  });

  byId('googleLoginBtn')?.addEventListener('click', () => {
    if (USE_MOCK_DATA) {
      googleAccessToken = 'MOCK_TOKEN';
      showDashboard();
      loadAssignments();
      return;
    }

    if (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes('YOUR_')) {
      // requestCode() triggers the pop-up to get the auth code
      googleTokenClient.requestCode();
    } else {
      showError('Please configure your Google Client ID first!');
    }
  });

  byId('logoutBtn')?.addEventListener('click', showLoginScreen);
});
