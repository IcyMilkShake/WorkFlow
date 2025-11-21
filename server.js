const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();

// Serve static files
app.use(express.static(__dirname));

// Start server
const PORT = 3443;

// Self-signed certificate for HTTPS
const selfsigned = require('selfsigned');
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

const httpsOptions = {
  key: pems.private,
  cert: pems.cert
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`🔒 Server running at https://localhost:${PORT}`);
  console.log(`⚠️  You'll see a security warning - click "Advanced" then "Proceed to localhost"`);
});