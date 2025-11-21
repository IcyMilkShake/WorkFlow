// server.js
const express = require('express');
const path = require('path');
const app = express();

// Serve 'node_modules' as static files
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

// Serve your frontend files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '/')));

// Start the server
app.listen(8080, () => {
  console.log('Server is running on 8080');
});
