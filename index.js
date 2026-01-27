// ==========================================
// SERVICE WORKER UPDATE DETECTION
// ==========================================
if ('serviceWorker' in navigator) {
  let refreshing = false;
  
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    console.log('🔄 New version detected, reloading...');
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('✅ Service Worker registered');
        
        // Check for updates every 60 seconds
        setInterval(() => {
          registration.update();
        }, 60000);
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              showUpdateNotification();
            }
          });
        });
      })
      .catch(error => console.error('Service Worker registration failed:', error));
  });
}

function showUpdateNotification() {
  const updateBanner = document.createElement('div');
  updateBanner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #b66dff 0%, #9946e6 100%);
    color: white;
    padding: 1rem;
    text-align: center;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  updateBanner.innerHTML = `
    <strong>🎉 New version available!</strong>
    <button onclick="window.location.reload()" style="margin-left: 1rem; padding: 0.5rem 1rem; background: white; color: #b66dff; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">
      Update Now
    </button>
  `;
  document.body.prepend(updateBanner);
}
// ==========================================
// CONFIGURATION & UTILS
// ==========================================
const USE_MOCK_DATA = false;
const GOOGLE_CLIENT_ID = '204169741443-lrnat59d7ob8ae63srsbg2ojefn1f51h.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/userinfo.profile';

const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);

const pLimit = (concurrency) => {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      queue.shift()();
    }
  };

  const run = async (fn, resolve, reject) => {
    activeCount++;
    const result = (async () => fn())();
    try {
      const value = await result;
      resolve(value);
    } catch (err) {
      reject(err);
    }
    next();
  };

  const enqueue = (fn, resolve, reject) => {
    queue.push(run.bind(null, fn, resolve, reject));
    if (activeCount < concurrency && queue.length > 0) {
      queue.shift()();
    }
  };

  return (fn) => new Promise((resolve, reject) => enqueue(fn, resolve, reject));
};

// Retry fetch with backoff for 429 errors
async function fetchWithBackoff(url, options, retries = 3, backoff = 1000) {
  try {
    const response = await fetch(url, options);
    if (response.status === 429 && retries > 0) {
      console.warn(`429 Rate Limited. Retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithBackoff(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Fetch error. Retrying in ${backoff}ms...`, error);
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithBackoff(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}

// ==========================================
// LOADING OVERLAY FUNCTIONS
// ==========================================
function showLoadingOverlay(status = 'Initializing...') {
  const overlay = byId('loadingOverlay');
  const statusText = byId('loadingStatus');
  const loadingBar = byId('loadingBar');
  
  if (overlay) {
    overlay.style.display = 'flex';
    if (statusText) statusText.textContent = status;
    if (loadingBar) loadingBar.style.width = '0%';
  }
}

function updateLoadingProgress(percent, status) {
  const loadingBar = byId('loadingBar');
  const statusText = byId('loadingStatus');
  
  if (loadingBar) loadingBar.style.width = `${percent}%`;
  if (statusText) statusText.textContent = status;
}

function hideLoadingOverlay() {
  const overlay = byId('loadingOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

// ==========================================
// STATE MANAGEMENT
// ==========================================
let googleTokenClient;
let googleAccessToken = localStorage.getItem('googleAccessToken') || null;
let googleUserId = null;
let tokenExpiry = localStorage.getItem('tokenExpiry') || null;
let allAssignmentsData = [];
let allCoursesData = [];
let ignoredCourses = new Set(JSON.parse(localStorage.getItem('ignoredCourses') || '[]'));
let currentTheme = localStorage.getItem('theme') || 'dark';
let previousAssignmentStates = JSON.parse(localStorage.getItem('previousStates') || '{}');
let completionHistory = JSON.parse(localStorage.getItem('completionHistory') || '{}');
let scheduleEvents = {};
let isLoading = false;
let loadingError = null;
let conversationHistory = [];

let statusChartInstance = null;
let courseChartInstance = null;
let productivityChartInstance = null;
let currentProductivityView = 'today';
let currentScheduleDate = new Date();
let draggedAssignment = null;
let draggedScheduleEvent = null;

// ==========================================
// SCHEDULE EDITOR - COMPLETE SECTION
// Replace everything from "// SCHEDULE EDITOR" to "// NOTIFICATIONS"
// ==========================================

let draggedElement = null;
let ghostElement = null;

window.showScheduleEditor = function() {
  showPage('schedule');
  renderScheduleCalendar();
  renderUnscheduledAssignments();
}

function renderScheduleCalendar() {
  const container = byId('scheduleCalendar');
  if (!container) return;

  const year = currentScheduleDate.getFullYear();
  const month = currentScheduleDate.getMonth();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <button class="btn btn-primary" onclick="changeScheduleMonth(-1)" style="padding: 0.5rem 1rem;">
        <i class="ph ph-caret-left"></i>
      </button>
      <h3 style="margin: 0;">${monthNames[month]} ${year}</h3>
      <button class="btn btn-primary" onclick="changeScheduleMonth(1)" style="padding: 0.5rem 1rem;">
        <i class="ph ph-caret-right"></i>
      </button>
    </div>
    
    <div class="calendar-grid">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => 
        `<div class="calendar-header-cell">${day}</div>`
      ).join('')}
      
      ${Array(startingDayOfWeek).fill(null).map(() => 
        `<div class="calendar-day calendar-day-empty"></div>`
      ).join('')}
      
      ${Array.from({length: daysInMonth}, (_, i) => {
        const day = i + 1;
        const dateObj = new Date(year, month, day);
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        const events = scheduleEvents[dateKey] || [];
        const isToday = new Date().toDateString() === dateObj.toDateString();
        
      return `
        <div 
          class="calendar-day" 
          data-date="${dateKey}"
          style="border-color: ${isToday ? 'var(--primary)' : 'transparent'};"
          ondrop="handleScheduleDrop(event)"
          ondragover="event.preventDefault(); event.currentTarget.style.background = 'rgba(182, 109, 255, 0.1)';"
          ondragleave="event.currentTarget.style.background = 'var(--card-bg)';"
          data-touch-drop="true"
        >
            <div class="calendar-day-header-wrapper" style="font-weight: 600; margin-bottom: 0.5rem; color: ${isToday ? 'var(--primary)' : 'var(--text-primary)'};">
              <span class="mobile-day-label">${dayOfWeek}</span>
              ${day}
            </div>
            <div class="schedule-events">
              ${events.map(event => `
                <div 
                  class="schedule-event" 
                  draggable="true"
                  ondragstart="handleScheduledEventDragStart(event, '${dateKey}', '${event.id}')"
                  onclick="editScheduleEvent('${dateKey}', '${event.id}')"
                  style="background: rgba(182, 109, 255, 0.2); border-left: 3px solid var(--primary); padding: 0.25rem 0.5rem; margin-bottom: 0.25rem; border-radius: 4px; font-size: 0.75rem; cursor: grab;"
                  title="${event.title}"
                >
                  <div style="font-weight: 600;" class="schedule-event-content">${event.title}</div>
                  ${event.startTime ? `<div style="color: var(--text-secondary); font-size: 0.7rem;">${event.startTime} - ${event.endTime}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  if (window.innerWidth <= 767) {
    createMobileDrawer();
  }
}

function renderUnscheduledAssignments() {
  const container = byId('unscheduledList');
  const header = byId('unscheduledHeader');
  
  if (!container || !header) return;

  const scheduled = new Set();
  Object.values(scheduleEvents).forEach(dayEvents => {
    dayEvents.forEach(event => {
      if (event.assignmentId) scheduled.add(event.assignmentId);
    });
  });

  const filtered = allAssignmentsData.filter(a => 
    !ignoredCourses.has(a.courseName) && 
    a.status !== 'submitted' &&
    !scheduled.has(a.title + '_' + a.courseName)
  );
  
  const existingBtn = header.querySelector('#autoScheduleBtn');
  if (existingBtn) existingBtn.remove();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 2rem;">
        <div class="empty-state-icon"><i class="ph ph-check-circle"></i></div>
        <h4>All scheduled!</h4>
        <p style="font-size: 0.875rem;">All assignments have been added to your calendar.</p>
      </div>`;
    return;
  }

  const btnDiv = document.createElement('div');
  btnDiv.id = 'autoScheduleBtn';
  btnDiv.style.width = '100%';
  btnDiv.style.marginTop = '1rem';
  btnDiv.innerHTML = `
    <button class="btn btn-primary" onclick="autoScheduleAll()" style="width: 100%; padding: 0.75rem; border-radius: 8px; font-weight: 600; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <i class="ph ph-magic-wand" style="font-size: 1.1rem;"></i> Auto-Schedule All
    </button>
  `;
  header.appendChild(btnDiv);

  container.innerHTML = filtered.map(assignment => {
      const dueDate = formatDueDate(assignment);
      return `
        <div 
          class="unscheduled-assignment"
          data-assignment='${JSON.stringify(assignment).replace(/'/g, "&#39;")}'
          style="background: var(--card-bg); border: 1px solid var(--border-color); border-left: 3px solid ${assignment.status === 'late' ? 'var(--danger)' : 'var(--warning)'}; padding: 1rem; margin-bottom: 0.75rem; border-radius: 8px; cursor: grab; transition: all 0.2s;"
        >
          <div style="font-weight: 600; margin-bottom: 0.25rem;">${assignment.title}</div>
          <div style="font-size: 0.875rem; color: var(--text-secondary);">${assignment.courseName}</div>
          <div style="font-size: 0.75rem; color: ${assignment.status === 'late' ? 'var(--danger)' : 'var(--warning)'}; margin-top: 0.5rem;">
            <i class="ph ph-calendar"></i> ${dueDate}
          </div>
        </div>
      `;
    }).join('');

  // Attach new drag handlers
  container.querySelectorAll('.unscheduled-assignment').forEach(el => {
    el.draggable = true;
    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragend', handleDragEnd);
    
    // Add touch support for mobile/tablet (iPad)
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
  });
  if (window.innerWidth <= 767) {
    renderMobileUnscheduledList();
  }
}

function handleDragStart(e) {
  draggedElement = e.currentTarget;
  draggedAssignment = JSON.parse(e.currentTarget.dataset.assignment);
  
  draggedElement.style.cursor = 'grabbing';
  draggedElement.style.opacity = '0.5';
  
  // Create custom drag ghost
  ghostElement = draggedElement.cloneNode(true);
  ghostElement.style.position = 'absolute';
  ghostElement.style.top = '-9999px';
  ghostElement.style.left = '-9999px';
  ghostElement.style.width = draggedElement.offsetWidth + 'px';
  ghostElement.style.opacity = '0.9';
  ghostElement.style.transform = 'rotate(-2deg)';
  ghostElement.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
  ghostElement.style.pointerEvents = 'none';
  ghostElement.style.zIndex = '9999';
  document.body.appendChild(ghostElement);
  
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setDragImage(ghostElement, ghostElement.offsetWidth / 2, ghostElement.offsetHeight / 2);
}

function handleDragEnd(e) {
  if (draggedElement) {
    draggedElement.style.opacity = '1';
    draggedElement.style.cursor = 'grab';
  }
  
  if (ghostElement) {
    ghostElement.remove();
    ghostElement = null;
  }
  
  document.querySelectorAll('.calendar-day').forEach(day => {
    day.style.background = 'var(--card-bg)';
    day.style.transform = '';
  });
  
  draggedElement = null;
}
window.handleAssignmentDragStart = function(event, assignment) {
  draggedAssignment = assignment;
  draggedScheduleEvent = null;
  event.dataTransfer.effectAllowed = 'move';
  
  // Use the actual element as drag image
  event.dataTransfer.setDragImage(event.currentTarget, event.currentTarget.offsetWidth / 2, 20);
}

window.handleScheduledEventDragStart = function(event, dateKey, eventId) {
  event.stopPropagation(); // Prevent bubbling if needed
  
  const dayEvents = scheduleEvents[dateKey];
  if (!dayEvents) return;
  
  const existingEvent = dayEvents.find(e => e.id === eventId);
  if (!existingEvent) return;

  draggedScheduleEvent = {
    event: existingEvent,
    oldDateKey: dateKey
  };
  draggedAssignment = null;

  event.dataTransfer.effectAllowed = 'move';
  
  // Create drag ghost if desired, or use default
  // Just setting opacity for visual feedback
  event.currentTarget.style.opacity = '0.5';
}

window.handleDragOver = function(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  
  const target = event.currentTarget;
  target.style.background = 'rgba(182, 109, 255, 0.1)';
  target.style.transform = 'scale(1.02)';
}

window.handleDragLeave = function(event) {
  const target = event.currentTarget;
  target.style.background = 'var(--card-bg)';
  target.style.transform = '';
}

// Find and replace this function:
window.handleScheduleDrop = function(event) {
  event.preventDefault();
  
  // IMPORTANT: Clear the gray background immediately
  event.currentTarget.style.background = 'var(--card-bg)';
  const dateKey = event.currentTarget.dataset.date;

  if (draggedScheduleEvent) {
    // Handle moving existing event
    if (draggedScheduleEvent.oldDateKey === dateKey) {
      // Dropped on same day, just refresh to clear drag styles
      draggedScheduleEvent = null;
      renderScheduleCalendar();
      return;
    }

    if (!scheduleEvents[dateKey]) scheduleEvents[dateKey] = [];
    
    // Remove from old date
    scheduleEvents[draggedScheduleEvent.oldDateKey] = scheduleEvents[draggedScheduleEvent.oldDateKey]
      .filter(e => e.id !== draggedScheduleEvent.event.id);
      
    if (scheduleEvents[draggedScheduleEvent.oldDateKey].length === 0) {
      delete scheduleEvents[draggedScheduleEvent.oldDateKey];
    }
    
    // Add to new date
    scheduleEvents[dateKey].push(draggedScheduleEvent.event);
    
    draggedScheduleEvent = null;
    
    renderScheduleCalendar();
    showToast(`✅ Moved to ${dateKey}`);
    return;
  }

  if (!draggedAssignment) return;

  if (!scheduleEvents[dateKey]) scheduleEvents[dateKey] = [];

  const eventId = Date.now().toString();
  scheduleEvents[dateKey].push({
    id: eventId,
    title: draggedAssignment.title,
    assignmentId: draggedAssignment.title + '_' + draggedAssignment.courseName,
    courseName: draggedAssignment.courseName,
    startTime: '09:00',
    endTime: '10:00',
    alertBefore: 60,
    link: draggedAssignment.link
  });

  draggedAssignment = null;
  
  renderScheduleCalendar();
  renderUnscheduledAssignments();
  showToast(`✅ Added to ${dateKey}`);
}

window.changeScheduleMonth = function(delta) {
  const today = new Date();
  const oneYearFromToday = new Date(today.getFullYear() + 1, today.getMonth(), 1);
  
  const newDate = new Date(currentScheduleDate.getFullYear(), currentScheduleDate.getMonth() + delta, 1);
  
  if (newDate < new Date(today.getFullYear(), today.getMonth(), 1)) {
    showToast('⚠️ Cannot go to past months');
    return;
  }
  
  if (newDate >= oneYearFromToday) {
    showToast('⚠️ Cannot schedule beyond one year');
    return;
  }
  
  currentScheduleDate = newDate;
  renderScheduleCalendar();
}

window.autoScheduleAll = function() {
  const scheduled = new Set();
  Object.values(scheduleEvents).forEach(dayEvents => {
    dayEvents.forEach(event => {
      if (event.assignmentId) scheduled.add(event.assignmentId);
    });
  });

  const unscheduled = allAssignmentsData.filter(a => 
    !ignoredCourses.has(a.courseName) && 
    a.status !== 'submitted' &&
    !scheduled.has(a.title + '_' + a.courseName) &&
    a.dueDate
  );

  unscheduled.forEach(assignment => {
    const dueDate = parseGoogleDate(assignment.dueDate);
    if (!dueDate) return;

    const dateKey = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
    
    if (!scheduleEvents[dateKey]) scheduleEvents[dateKey] = [];

    scheduleEvents[dateKey].push({
      id: Date.now().toString() + Math.random(),
      title: assignment.title,
      assignmentId: assignment.title + '_' + assignment.courseName,
      courseName: assignment.courseName,
      startTime: '14:00',
      endTime: '16:00',
      alertBefore: 120,
      link: assignment.link
    });
  });

  renderScheduleCalendar();
  renderUnscheduledAssignments();
  showToast(`✅ Auto-scheduled ${unscheduled.length} assignments`);
}

window.editScheduleEvent = function(dateKey, eventId) {
  const events = scheduleEvents[dateKey];
  if (!events) return;

  const event = events.find(e => e.id === eventId);
  if (!event) return;

  const modal = document.createElement('div');
  modal.className = 'edit-event-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100vh;
    background: rgba(0,0,0,0.7); z-index: 1000; display: flex;
    align-items: center; justify-content: center; padding: 1rem;
  `;
  
  modal.innerHTML = `
    <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; max-width: 500px; width: 100%;">
      <h3 style="margin-bottom: 1.5rem;">Edit Event</h3>
      
    
