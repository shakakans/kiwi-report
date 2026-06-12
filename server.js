const http = require('http');
const fs = require('fs');
const path = require('path');
const { refresh, getState, REFRESH_MS } = require('./aggregator');
const { renderPage } = require('./render');

const PORT = process.env.PORT || 3100;

// Self-running: refresh on boot, then on an interval forever.
refresh().catch(err => console.error('[refresh] failed:', err.message));
setInterval(() => refresh().catch(err => console.error('[refresh] failed:', err.message)), REFRESH_MS);

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getState()));
    return;
  }

  if (url === '/style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'style.css')));
    return;
  }

  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage(getState()));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('NOT FOUND');
});

server.listen(PORT, () => console.log(`THE KIWI REPORT running at http://localhost:${PORT}`));
