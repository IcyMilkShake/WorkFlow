const express = require('express');
const path = require('path');
const app = express();

// Set proper MIME types
app.use((req, res, next) => {
  if (req.url.endsWith('.js')) {
    res.type('application/javascript');
  } else if (req.url.endsWith('.json')) {
    res.type('application/json');
  }
  next();
});

// Serve service worker from root
app.get('/service-worker.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'service-worker.js'));
});

// Serve manifest from root
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Serve offline page
app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'offline.html'));
});

// Serve 'node_modules' as static files
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Serve static files (HTML, CSS, JS, icons)
app.use(express.static(path.join(__dirname, '/')));

// Fallback to index.html for SPA routing
app.get('', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 PWA ready for installation`);
  console.log(`\n✅ Features enabled:`);
  console.log(`  - Offline support`);
  console.log(`  - Auto-updates`);
  console.log(`  - iOS optimized`);
  console.log(`  - Install prompts`);
});