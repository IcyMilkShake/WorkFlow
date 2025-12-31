const express = require('express');
const path = require('path');
const app = express();

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

// Fallback to index.html for SPA routing (Client-side routing)
app.get('*', (req, res) => {
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
