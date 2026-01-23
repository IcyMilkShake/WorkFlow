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
      
      <div style="margin-bottom: 1rem;">
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Title</label>
        <input type="text" id="eventTitle" value="${event.title}" style="width: 100%; padding: 0.75rem; background: var(--dark); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-family: 'Poppins', sans-serif;">
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Start Time</label>
          <input type="time" id="eventStart" value="${event.startTime}" style="width: 100%; padding: 0.75rem; background: var(--dark); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-family: 'Poppins', sans-serif;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">End Time</label>
          <input type="time" id="eventEnd" value="${event.endTime}" style="width: 100%; padding: 0.75rem; background: var(--dark); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-family: 'Poppins', sans-serif;">
        </div>
      </div>

      <div style="margin-bottom: 1.5rem;">
        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Alert Before (minutes)</label>
        <select id="eventAlert" style="width: 100%; padding: 0.75rem; background: var(--dark); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-family: 'Poppins', sans-serif;">
          <option value="0" ${event.alertBefore === 0 ? 'selected' : ''}>No Alert</option>
          <option value="15" ${event.alertBefore === 15 ? 'selected' : ''}>15 minutes</option>
          <option value="30" ${event.alertBefore === 30 ? 'selected' : ''}>30 minutes</option>
          <option value="60" ${event.alertBefore === 60 ? 'selected' : ''}>1 hour</option>
          <option value="120" ${event.alertBefore === 120 ? 'selected' : ''}>2 hours</option>
          <option value="1440" ${event.alertBefore === 1440 ? 'selected' : ''}>1 day</option>
        </select>
      </div>

      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-primary" onclick="saveScheduleEvent('${dateKey}', '${eventId}')" style="flex: 1;">Save</button>
        <button class="btn btn-danger" onclick="deleteScheduleEvent('${dateKey}', '${eventId}')" style="flex: 1;">Delete</button>
        <button class="btn" onclick="document.querySelector('.edit-event-modal').remove()" style="flex: 1; background: var(--dark); color: var(--text-primary);">Cancel</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

window.saveScheduleEvent = function(dateKey, eventId) {
  const events = scheduleEvents[dateKey];
  if (!events) return;

  const event = events.find(e => e.id === eventId);
  if (!event) return;

  event.title = byId('eventTitle').value;
  event.startTime = byId('eventStart').value;
  event.endTime = byId('eventEnd').value;
  event.alertBefore = parseInt(byId('eventAlert').value);

  renderScheduleCalendar();
  
  document.querySelector('.edit-event-modal').remove();
  showToast('✅ Event updated');
}

window.deleteScheduleEvent = function(dateKey, eventId) {
  scheduleEvents[dateKey] = scheduleEvents[dateKey].filter(e => e.id !== eventId);
  if (scheduleEvents[dateKey].length === 0) delete scheduleEvents[dateKey];
  
  renderScheduleCalendar();
  renderUnscheduledAssignments();
  
  document.querySelector('.edit-event-modal').remove();
  showToast('🗑️ Event deleted');
}

// ==========================================
// MOBILE SCHEDULE DRAWER
// ==========================================

function createMobileDrawer() {
    const schedulePage = document.getElementById('schedulePage');
    if (!schedulePage) return;

    // Check if drawer already exists
    let drawer = document.getElementById('mobileDrawer');
    if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'mobileDrawer';
        drawer.className = 'mobile-assignment-drawer';
        
        drawer.innerHTML = `
            <div class="mobile-drawer-toggle" onclick="toggleMobileDrawer()">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i class="ph ph-list" style="font-size: 1.5rem; color: var(--primary);"></i>
                    <div>
                        <div style="font-weight: 600;">Pending Assignments</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);" id="mobileDrawerCount">0 assignments</div>
                    </div>
                </div>
                <i class="ph ph-caret-down" id="mobileDrawerIcon" style="font-size: 1.25rem; color: var(--primary); transition: transform 0.3s;"></i>
            </div>
            <div class="mobile-drawer-content" id="mobileDrawerContent">
                <div id="mobileUnscheduledList" style="padding: 0.5rem;"></div>
            </div>
        `;
        
        // Insert at the top of schedule page
        const scheduleContainer = schedulePage.querySelector('.schedule-container');
        if (scheduleContainer) {
            scheduleContainer.parentNode.insertBefore(drawer, scheduleContainer);
        }
    }
    
    renderMobileUnscheduledList();
}

window.toggleMobileDrawer = function() {
    const content = document.getElementById('mobileDrawerContent');
    const icon = document.getElementById('mobileDrawerIcon');
    
    if (content && icon) {
        content.classList.toggle('open');
        icon.style.transform = content.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
    }
}

function renderMobileUnscheduledList() {
    const container = document.getElementById('mobileUnscheduledList');
    const countDiv = document.getElementById('mobileDrawerCount');
    
    if (!container) return;

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
    
    if (countDiv) {
        countDiv.textContent = `${filtered.length} assignment${filtered.length !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;"><i class="ph ph-check-circle"></i></div>
                <div>All scheduled!</div>
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(assignment => {
        const dueDate = formatDueDate(assignment);
        return `
            <div 
                class="unscheduled-assignment"
                data-assignment='${JSON.stringify(assignment).replace(/'/g, "&#39;")}'
                style="background: var(--card-bg); border: 1px solid var(--border-color); border-left: 3px solid ${assignment.status === 'late' ? 'var(--danger)' : 'var(--warning)'}; padding: 0.75rem; margin-bottom: 0.5rem; border-radius: 8px; cursor: grab; transition: all 0.2s;"
            >
                <div style="font-weight: 600; margin-bottom: 0.25rem; font-size: 0.875rem;">${assignment.title}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${assignment.courseName}</div>
                <div style="font-size: 0.7rem; color: ${assignment.status === 'late' ? 'var(--danger)' : 'var(--warning)'}; margin-top: 0.5rem;">
                    <i class="ph ph-calendar"></i> ${dueDate}
                </div>
            </div>
        `;
    }).join('');

    // Attach drag handlers
    container.querySelectorAll('.unscheduled-assignment').forEach(el => {
        el.draggable = true;
        el.addEventListener('dragstart', handleDragStart);
        el.addEventListener('dragend', handleDragEnd);
        
        // Add touch support for mobile
        el.addEventListener('touchstart', handleTouchStart, { passive: false });
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        el.addEventListener('touchend', handleTouchEnd, { passive: false });
    });
}

// ==========================================
// TOUCH SUPPORT FOR MOBILE DRAG & DROP
// ==========================================

let touchStartX, touchStartY;
let touchElement = null;
let touchClone = null;

function handleTouchStart(e) {
    touchElement = e.currentTarget;
    draggedAssignment = JSON.parse(touchElement.dataset.assignment);
    
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    
    // Create visual clone
    touchClone = touchElement.cloneNode(true);
    touchClone.style.position = 'fixed';
    touchClone.style.zIndex = '9999';
    touchClone.style.opacity = '0.8';
    touchClone.style.pointerEvents = 'none';
    touchClone.style.width = touchElement.offsetWidth + 'px';
    touchClone.style.left = touch.clientX - (touchElement.offsetWidth / 2) + 'px';
    touchClone.style.top = touch.clientY - 30 + 'px';
    touchClone.style.transform = 'rotate(-2deg) scale(1.05)';
    touchClone.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
    document.body.appendChild(touchClone);
    
    touchElement.style.opacity = '0.3';
}

function handleTouchMove(e) {
    e.preventDefault();
    
    if (!touchClone) return;
    
    const touch = e.touches[0];
    touchClone.style.left = touch.clientX - (touchElement.offsetWidth / 2) + 'px';
    touchClone.style.top = touch.clientY - 30 + 'px';
    
    // Highlight calendar days under touch
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
    const calendarDay = elementUnderTouch?.closest('.calendar-day');
    
    document.querySelectorAll('.calendar-day').forEach(day => {
        day.style.background = 'var(--card-bg)';
    });
    
    if (calendarDay) {
        calendarDay.style.background = 'rgba(182, 109, 255, 0.1)';
    }
}

function handleTouchEnd(e) {
  if (touchClone) {
    touchClone.remove();
    touchClone = null;
  }
  
  if (touchElement) {
    touchElement.style.opacity = '1';
  }
  
  // Find drop target - CRITICAL FIX FOR iPAD
  const touch = e.changedTouches[0];
  
  // iPad Safari fix: temporarily hide the clone to get element underneath
  if (touchClone) touchClone.style.display = 'none';
  
  const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
  
  if (touchClone) touchClone.style.display = 'block';
  
  const calendarDay = elementUnderTouch?.closest('.calendar-day[data-touch-drop="true"]') || 
                      elementUnderTouch?.closest('.calendar-day');
  
  if (calendarDay && draggedAssignment) {
    const dateKey = calendarDay.dataset.date;
    
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

    renderScheduleCalendar();
    renderUnscheduledAssignments();
    renderMobileUnscheduledList();
    showToast(`✅ Added to ${dateKey}`);
  }
  
  // Reset highlights
  document.querySelectorAll('.calendar-day').forEach(day => {
    day.style.background = 'var(--card-bg)';
  });
  
  draggedAssignment = null;
  touchElement = null;
}

window.exportToICS = async function() {
  let icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WorkFlow//Assignment Tracker//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:WorkFlow Assignments
X-WR-TIMEZONE:UTC
`;

  Object.entries(scheduleEvents).forEach(([dateKey, events]) => {
    events.forEach(event => {
      const [year, month, day] = dateKey.split('-');
      const [startHour, startMin] = event.startTime.split(':');
      const [endHour, endMin] = event.endTime.split(':');
      
      const startDate = new Date(year, month - 1, day, startHour, startMin);
      const endDate = new Date(year, month - 1, day, endHour, endMin);
      
      const formatICSDate = (date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      const uid = `${event.id}@workflow.app`;
      
      icsContent += `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(startDate)}
DTEND:${formatICSDate(endDate)}
SUMMARY:${event.title}
DESCRIPTION:Course: ${event.courseName}${event.link ? `\\nLink: ${event.link}` : ''}
LOCATION:${event.courseName}
STATUS:CONFIRMED
SEQUENCE:0
`;

      if (event.alertBefore > 0) {
        icsContent += `BEGIN:VALARM
TRIGGER:-PT${event.alertBefore}M
ACTION:DISPLAY
DESCRIPTION:${event.title}
END:VALARM
`;
      }

      icsContent += `END:VEVENT
`;
    });
  });

  icsContent += `END:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const file = new File([blob], 'workflow-assignments.ics', { type: 'text/calendar' });

  // Try native sharing first (Mobile/Safari)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'WorkFlow Assignments',
        text: 'Import these assignments to your calendar app.'
      });
      showToast('✅ Calendar shared!');
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Share failed, falling back to download:', err);
      } else {
        return; // User cancelled
      }
    }
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'workflow-assignments.ics';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('📅 Calendar exported! Import to Apple Calendar, Google Calendar, or Outlook.');
}

// ==========================================
// NOTIFICATIONS (Updated to respect ignored courses)
// ==========================================
const COMEDIC_MESSAGES = {
  dueTomorrow: [
    "Bad news twin 😬 '{title}' is due TOMORROW.",
    "Tomorrow. '{title}'. That's it. That's the message.",
    "'{title}' is due tomorrow. This is not a drill. Lock. In.",
    "You have exactly one (1) day left for '{title}'. Choose wisely.",
    "Not to ruin your vibe, but '{title}' is due tomorrow 👀"
  ],

  overdue: [
    "So… '{title}' is {days} day(s) overdue 😭 Let's pretend it's fine and start now.",
    "Yeahhh '{title}' was past due already by {days} day.",
    "'{title}' is late. It happens. But atleast... let's fix it.",
    "Respectfully… '{title}' is {days} day(s) overdue.",
    "Forgot about '{title}' and now it's overdue 💀"
  ],

  dueSoonRandom: [
    "Just popping in to remind you that '{title}' exists. {days} days left.",
    "No panic yet, but '{title}' is due in {days} days.",
    "This is your casual reminder that '{title}' is due in {days} days 👋",
    "Future you is begging you to start '{title}'. {days} days remaining.",
    "You're still chilling, but '{title}' is due in {days} days. Just saying."
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
    await subscribeToPush();
    showToast('🎉 Notifications enabled!');
  } else {
    showToast(`❌ Permission result: ${permission}`);
  }
}

// ==========================================
// PUSH NOTIFICATION SUBSCRIPTION
// ==========================================
async function subscribeToPush() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    
    const response = await fetch('/api/vapidPublicKey');
    const { publicKey } = await response.json();
    
    const convertedVapidKey = urlBase64ToUint8Array(publicKey);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey
    });

    console.log('✅ Push Subscribed:', subscription);
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
    
    if (!subscription) return;

    // Only send non-ignored assignments
    const filteredAssignments = allAssignmentsData.filter(a => !ignoredCourses.has(a.courseName));

    const payload = {
      clientId: subscription.endpoint,
      subscription: subscription,
      assignments: filteredAssignments,
      refreshToken: window.tempRefreshToken || null,
      userId: googleUserId
    };

    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
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
// ASSIGNMENT FILTERS
// ==========================================
let currentFilters = {
  dueDate: '',
  sort: 'dueDate',
  status: 'all'
};

window.applyFilters = function() {
  const daysInput = byId('dueDateFilter').value;
  currentFilters.dueDate = daysInput ? parseInt(daysInput) : '';
  currentFilters.sort = byId('sortFilter').value;
  currentFilters.status = byId('statusFilter').value;
  
  displayAssignments(allAssignmentsData);
}

window.resetFilters = function() {
  byId('dueDateFilter').value = '';
  byId('sortFilter').value = 'dueDate';
  byId('statusFilter').value = 'all';
  
  currentFilters = {
    dueDate: '',
    sort: 'dueDate',
    status: 'all'
  };
  
  displayAssignments(allAssignmentsData);
}

function filterAssignments(assignments) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let filtered = assignments.filter(a => !ignoredCourses.has(a.courseName));
  
  // Filter by status (pending/late)
  filtered = filtered.filter(a => a.status !== 'submitted');
  
  if (currentFilters.status !== 'all') {
    filtered = filtered.filter(a => a.status === currentFilters.status);
  }
  
  // Filter by custom days input
  if (currentFilters.dueDate !== '') {
    const daysAhead = currentFilters.dueDate;
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);
    
    filtered = filtered.filter(a => {
      const dueDate = parseGoogleDate(a.dueDate);
      if (!dueDate) return false;
      
      // Show assignments due within the specified number of days
      return dueDate >= today && dueDate <= futureDate;
    });
  }
  
  // Sort assignments (rest stays the same)
  filtered.sort((a, b) => {
    const dateA = parseGoogleDate(a.dueDate);
    const dateB = parseGoogleDate(b.dueDate);
    
    switch(currentFilters.sort) {
      case 'dueDate':
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA - dateB;
        
      case 'dueDateDesc':
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB - dateA;
        
      case 'points':
        const pointsA = a.maxPoints || 0;
        const pointsB = b.maxPoints || 0;
        return pointsB - pointsA;
        
      case 'pointsAsc':
        const pointsA2 = a.maxPoints || 0;
        const pointsB2 = b.maxPoints || 0;
        return pointsA2 - pointsB2;
        
      case 'course':
        return a.courseName.localeCompare(b.courseName);
        
      case 'title':
        return a.title.localeCompare(b.title);
        
      default:
        return 0;
    }
  });
  
  return filtered;
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
    IMPORTANTLY , NEVER GIVE THEM STRAIGHT ANSWERS TO AN ASSIGNMENT QUESTION. INSTEAD, GUIDE THEM ON HOW TO APPROACH THE PROBLEM. Example: On users request of writing an essay for them, you will refuse and instead help you plan their story.
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
  
  // Wait for Google API to fully load
  const initGoogle = () => {
    if (typeof google === 'undefined' || !google.accounts) {
      console.log('⏳ Waiting for Google API...');
      setTimeout(initGoogle, 100);
      return;
    }
    
    try {
      googleTokenClient = google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        ux_mode: 'popup',
        select_account: true,
        callback: handleGoogleAuthResponse,
      });
      console.log('✅ Google Auth initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Google Auth:', error);
      setTimeout(initGoogle, 500); // Retry after 500ms
    }
  };
  
  initGoogle();
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
  const assignmentsList = byId('assignmentsList');
  
  isLoading = true;
  showLoadingOverlay('Loading your courses...');
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
          description: 'Write a full lab report on the projectile motion experiment.',
          maxPoints: 100,
          dueDate: { year: 2024, month: 11, day: 20 },
          status: 'late',
          link: '#'
        }
      ];

      await new Promise(resolve => setTimeout(resolve, 800));
      recalculateProductivityFromHistory(allAssignmentsData);
      displayAssignments(allAssignmentsData);
      updateStats(allAssignmentsData);
      return;
    }

    // Fetch user info
    const userinfo = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (userinfo.status === 401) {
      showLoginScreen();
      return;
    }

if (userinfo.ok) {
      const pfp = await userinfo.json();
      googleUserId = pfp.sub;
      
      // Cache profile picture in localStorage to avoid repeated requests
      const cachedPic = localStorage.getItem('userProfilePic');
      const cachedName = localStorage.getItem('userName');
      
      const avatarDiv = qs('.user-avatar');
      const nameDiv = qs('.user-name');
      
      // Helper function to load image with fallback
      const loadProfilePicture = (url) => {
        if (!url) {
          avatarDiv.innerHTML = '<i class="ph ph-user-circle" style="font-size: 2rem;"></i>';
          return;
        }
        
        // Preload image to check if it loads successfully
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => {
          avatarDiv.style.backgroundImage = `url(${url})`;
          avatarDiv.innerHTML = ''; // Clear fallback icon
          localStorage.setItem('userProfilePic', url);
        };
        img.onerror = () => {
          console.warn('Failed to load profile picture, using fallback icon');
          avatarDiv.innerHTML = '<i class="ph ph-user-circle" style="font-size: 2rem;"></i>';
          avatarDiv.style.backgroundImage = 'none';
          localStorage.removeItem('userProfilePic'); // Clear bad cache
        };
        img.src = url;
      };
      
      // Prioritize fresh picture from Google, fall back to cache only if needed
      if (pfp.picture) {
        loadProfilePicture(pfp.picture);
      } else if (cachedPic) {
        loadProfilePicture(cachedPic);
      } else {
        avatarDiv.innerHTML = '<i class="ph ph-user-circle" style="font-size: 2rem;"></i>';
      }
      
      if (pfp.name && pfp.name !== cachedName) {
        localStorage.setItem('userName', pfp.name);
        nameDiv.textContent = pfp.name;
      } else if (cachedName) {
        nameDiv.textContent = cachedName;
      }
    }

    // Fetch courses
    const coursesResponse = await fetchWithBackoff(
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
    
    // Calculate cutoff: 365 days ago
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const allAssignments = [];

    // SEQUENTIAL processing with small delays to avoid rate limits
    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      
      // Update loading progress
      const percent = Math.round(((i + 1) / courses.length) * 100);
      updateLoadingProgress(percent, `Fetching ${course.name}...`);
      
      try {
        // Small delay between courses
        if (i > 0) await new Promise(r => setTimeout(r, 200));
        
        const courseworkResponse = await fetchWithBackoff(
          `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
          { headers: { 'Authorization': `Bearer ${googleAccessToken}` }}
        );

        if (!courseworkResponse.ok) continue;

        const courseworkData = await courseworkResponse.json();
        const coursework = courseworkData.courseWork || [];

        // Fetch ALL submissions for this course in one go (using wildcard '-')
        // This dramatically reduces API calls from N+1 to 2 per course
        const allSubmissions = await fetchAllCourseSubmissions(course.id, googleAccessToken);
        const submissionsMap = new Map();
        
        allSubmissions.forEach(sub => {
          // Map courseWorkId -> submission object
          // Note: studentSubmissions list can contain multiple submissions for same work if multiple students (for teachers)
          // but we are fetching as student ('me'), so usually one per work.
          // However, the list returns objects that have 'courseWorkId'.
          submissionsMap.set(sub.courseWorkId, sub);
        });

        // Filter and map assignments
        const processedAssignments = coursework.map(work => {
          // 1. Check Age Filter
          if (work.dueDate) {
            const dueDate = new Date(work.dueDate.year, work.dueDate.month - 1, work.dueDate.day);
            const daysSinceDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
            // Skip if older than 1 year OR overdue by 365+ days
            if (dueDate < oneYearAgo || daysSinceDue >= 365) return null;
          }

          // 2. Match Submission
          const submission = submissionsMap.get(work.id);
          let status = 'pending';
          let completionTime = null;

          if (submission) {
            const isSubmitted = submission.state === 'TURNED_IN' || submission.state === 'RETURNED';
            status = isSubmitted ? 'submitted' : submission.late ? 'late' : 'pending';
            if (isSubmitted) completionTime = submission.updateTime;
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
        }).filter(a => a !== null); // Remove filtered items
        
        allAssignments.push(...processedAssignments);

      } catch (error) {
        console.error(`Error loading coursework for ${course.name}:`, error);
      }
    }
    
    // FINAL FILTER: Remove 365+ day overdue assignments
    allAssignmentsData = allAssignments.filter(assignment => {
      if (!assignment.dueDate) return true;
      
      const dueDate = new Date(assignment.dueDate.year, assignment.dueDate.month - 1, assignment.dueDate.day);
      const daysSinceDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      
      return daysSinceDue < 365;
    });
    
    recalculateProductivityFromHistory(allAssignmentsData);
    displayAssignments(allAssignmentsData);
    updateStats(allAssignmentsData);
    
    // Sync with Server for Push Notifications
    if (localStorage.getItem('notificationsEnabled') === 'true') {
      syncWithServer();
    }

  } finally {
    isLoading = false;
    hideLoadingOverlay();
    updateAIViewIfActive();
  }
}

function generateMockData() {
  const mockCourses = [
    { id: '1', name: 'Biology' },
    { id: '2', name: 'Calculus' },
    { id: '3', name: 'English' },
    { id: '4', name: 'Chemistry' },
    { id: '5', name: 'History' },
    { id: '6', name: 'Technology' },
    { id: '7', name: 'Creative Writing' }
  ];

  const today = new Date();
  const mockAssignments = [
    // Late assignments
    {
      source: 'google',
      title: 'Cell Lab Report',
      courseName: 'Biology',
      description: 'Complete lab report on mitosis and meiosis observations',
      maxPoints: 100,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() - 3 
      },
      status: 'late',
      link: '#'
    },
    {
      source: 'google',
      title: 'Practice Problems',
      courseName: 'Calculus',
      description: 'Complete problems 1-25',
      maxPoints: 50,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() - 5 
      },
      status: 'late',
      link: '#'
    },
    // Due tomorrow
    {
      source: 'google',
      title: 'English Essay',
      courseName: 'English',
      description: 'Submit first draft of the essay of your choosing',
      maxPoints: 150,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() + 1 
      },
      status: 'pending',
      link: '#'
    },
    // Due in 2 days
    {
      source: 'google',
      title: 'Lab Kink',
      courseName: 'Chemistry',
      description: 'Submit lab kink score',
      maxPoints: 75,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() + 2 
      },
      status: 'pending',
      link: '#'
    },
    // Due in 5 days
    {
      source: 'google',
      title: 'World War II Event Infographic',
      courseName: 'History',
      description: 'Research and make an infographic on a major WWII event of your choosing',
      maxPoints: 200,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() + 5 
      },
      status: 'pending',
      link: '#'
    },
    {
      source: 'google',
      title: 'Photosynthesis Worksheet',
      courseName: 'Biology',
      maxPoints: 25,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() + 6 
      },
      status: 'pending',
      link: '#'
    },
    // Submitted (for productivity tracking)
    {
      source: 'google',
      title: '6DOF Arm Robot Video',
      courseName: 'Technology',
      description: 'Submit video of your 6DOF robotic arm picking a cube with your arduino code',
      maxPoints: 100,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() - 1 
      },
      status: 'submitted',
      completionTime: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      link: '#'
    },
    {
      source: 'google',
      title: 'Show Don\'t Tell Paragraph',
      courseName: 'Creative Writing',
      maxPoints: 50,
      dueDate: { 
        year: today.getFullYear(), 
        month: today.getMonth() + 1, 
        day: today.getDate() - 2 
      },
      status: 'submitted',
      completionTime: new Date(today.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      link: '#'
    }
  ];

  // Generate mock completion history (past 30 days)
  const mockHistory = {};
  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    // Random completions (0-3 per day)
    mockHistory[dateKey] = Math.floor(Math.random() * 4);
  }

  return { courses: mockCourses, assignments: mockAssignments, history: mockHistory };
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
  
  // Use centralized filter function which handles sorting, ignored courses, and current filter state
  const pendingAssignments = filterAssignments(assignments);
  
  // Update result count in the filter bar
  const countEl = byId('filterResultCount');
  if (countEl) countEl.textContent = pendingAssignments.length;

  if (pendingAssignments.length === 0) {
    assignmentsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="ph ph-confetti"></i></div>
        <h3>No assignments found</h3>
        <p>Try adjusting your filters.</p>
      </div>`;
    return;
  }

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

async function fetchAllCourseSubmissions(courseId, accessToken) {
  let submissions = [];
  let pageToken = null;
  
  do {
    const url = new URL(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork/-/studentSubmissions`);
    if (pageToken) url.searchParams.append('pageToken', pageToken);
    
    // We only need the latest submission state, usually.
    // 'courseWorkId' is '-' which means ALL course work.
    
    try {
      const response = await fetchWithBackoff(url.toString(), {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!response.ok) {
        if (response.status === 403) return []; // Permission denied or no access
        console.error(`Failed to fetch submissions for course ${courseId}: ${response.status}`);
        return submissions; 
      }
      
      const data = await response.json();
      if (data.studentSubmissions) {
        submissions.push(...data.studentSubmissions);
      }
      
      pageToken = data.nextPageToken;
    } catch (err) {
      console.error('Error fetching submissions page:', err);
      break;
    }
  } while (pageToken);
  
  return submissions;
}

// ==========================================
// UI FUNCTIONS
// ==========================================
window.showPage = function(page) {
  // Update sidebar active state
  qsa('.sidebar-menu-item').forEach(item => item.classList.remove('active'));
  if (typeof event !== 'undefined' && event.target && event.target.closest) {
    const item = event.target.closest('.sidebar-menu-item');
    if (item) item.classList.add('active');
  }

  // Hide all pages
  const pages = ['assignments', 'statistics', 'aiAssistant', 'schedule', 'courses', 'settings', 'help'];
  pages.forEach(p => {
    const el = byId(p + 'Page');
    if (el) el.style.display = 'none';
  });

  // Show requested page and initialize it
  const pageElement = byId(page + 'Page');
  if (!pageElement) {
    console.error(`Page element not found: ${page}Page`);
    return;
  }

  pageElement.style.display = 'block';

  // Page-specific initialization
  switch(page) {
    case 'statistics':
      generateStatistics();
      break;
      
    case 'aiAssistant':
      initAIAssistant();
      break;
      
    case 'schedule':
      setTimeout(() => {
        renderScheduleCalendar();
        renderUnscheduledAssignments();
        
        // ADD THESE 3 NEW LINES:
        if (window.innerWidth <= 767) {
          createMobileDrawer();
        }
      }, 0);
      break;
      
    case 'courses':
      displayCourses();
      break;
      
    case 'settings':
      initializeSettings();
      break;
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
  
  // Update server immediately to stop notifications for ignored courses
  if (localStorage.getItem('notificationsEnabled') === 'true') {
    syncWithServer();
  }
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
      await subscribeToPush(); // Ensure we are subscribed and synced
    } else {
      toggle.checked = false; 
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem('notificationsEnabled', 'true');
        toggle.checked = true;
        showToast('🎉 Notifications enabled!');
        await subscribeToPush();
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
  
  // Clear persistent auth and user data
  localStorage.removeItem('googleAccessToken');
  localStorage.removeItem('tokenExpiry');
  localStorage.removeItem('userProfilePic');
  localStorage.removeItem('userName');
  
  // Clear user-specific app data
  localStorage.removeItem('completionHistory');
  localStorage.removeItem('previousStates');
  localStorage.removeItem('ignoredCourses');
  
  // Reset in-memory state
  scheduleEvents = {};
  conversationHistory = [];
  completionHistory = {};
  previousAssignmentStates = {};
  ignoredCourses = new Set();
  
  // Clear UI
  const chatMessages = byId('chatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
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

byId('mockLoginBtn')?.addEventListener('click', () => {
    console.log('🧪 Loading mock data...');
    
    // Clear any existing profile picture data
    localStorage.removeItem('userProfilePic');
    qs('.user-avatar').style.backgroundImage = 'none';

    qs('.user-name').textContent = 'Demo Account';
    qs('.user-avatar').innerHTML = '<i class="ph ph-user-circle" style="font-size: 2rem;"></i>';
    
    const mockData = generateMockData();
    allCoursesData = mockData.courses;
    allAssignmentsData = mockData.assignments;
    completionHistory = mockData.history;
    
    localStorage.setItem('completionHistory', JSON.stringify(completionHistory));
    
    googleAccessToken = 'MOCK_TOKEN';
    showDashboard();
    
    recalculateProductivityFromHistory(allAssignmentsData);
    displayAssignments(allAssignmentsData);
    updateStats(allAssignmentsData);
    
    showToast('🧪 Demo mode activated! Explore the app with sample data.');
  });

  byId('googleLoginBtn')?.addEventListener('click', () => {
    if (USE_MOCK_DATA) {
      googleAccessToken = 'MOCK_TOKEN';
      showDashboard();
      loadAssignments();
      return;
    }

    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes('YOUR_')) {
      showError('Please configure your Google Client ID first!');
      return;
    }
    
    if (!googleTokenClient) {
      showError('Google Sign-In is still loading. Please wait a moment and try again.');
      // Retry initialization
      initializeGoogleAuth();
      return;
    }
    
    try {
      googleTokenClient.requestCode();
    } catch (error) {
      console.error('Login error:', error);
      showError('Failed to open login. Please try again or reload the page.');
    }
  });

  byId('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('userProfilePic');
    localStorage.removeItem('userName');
    showLoginScreen();
  });
});