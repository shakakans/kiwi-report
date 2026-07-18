const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { refresh, getState, REFRESH_MS } = require('./aggregator');
const { renderPage, renderAdmin } = require('./render');

const PORT = process.env.PORT || 3100;

// --- Editor's override (the /admin control room) --------------------
// Persisted to a small json file so it survives a process restart.
// Note: on Render's free tier the disk is wiped on redeploy, so the
// override also clears then — acceptable for a breaking-news banner.
const OVERRIDE_PATH = path.join(__dirname, 'override.json');
let override = { active: false, title: '', link: '', image: '' };
try { override = { ...override, ...JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8')) } } catch {}

function saveOverride() {
  try { fs.writeFileSync(OVERRIDE_PATH, JSON.stringify(override, null, 2)); }
  catch (err) { console.error('[override] could not persist:', err.message); }
}

// With ADMIN_KEY set (Render -> Environment), the key gates /admin.
// Without it, /admin only works from localhost so a fresh deploy is
// never left open to defacement.
const ADMIN_KEY = process.env.ADMIN_KEY || null;
function adminAllowed(req, key) {
  if (ADMIN_KEY) return key === ADMIN_KEY;
  const host = String(req.headers.host || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

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

  if (url === '/favicon.svg' || url === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'favicon.svg')));
    return;
  }

  if (url === '/admin' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      const q = querystring.parse(body);
      const key = String(q.key || '').trim();
      if (!adminAllowed(req, key)) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAdmin(override, { allowed: false, keyConfigured: !!ADMIN_KEY, key: '', saved: false }));
        return;
      }
      override.title = String(q.title || '').trim().slice(0, 200);
      override.link = String(q.link || '').trim().slice(0, 500);
      override.image = String(q.image || '').trim().slice(0, 500);
      override.active = q.action === 'on' && override.title.length > 0;
      saveOverride();
      console.log(`[override] ${override.active ? 'LIVE' : 'off'}: "${override.title}"`);
      res.writeHead(302, { Location: '/admin?saved=1&key=' + encodeURIComponent(key) });
      res.end();
    });
    return;
  }

  if (url === '/admin') {
    const q = querystring.parse((req.url || '').split('?')[1] || '');
    const key = String(q.key || '').trim();
    const allowed = adminAllowed(req, key);
    res.writeHead(allowed ? 200 : 403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAdmin(override, { allowed, keyConfigured: !!ADMIN_KEY, key, saved: !!q.saved }));
    return;
  }

  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage(getState(), override));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('NOT FOUND');
});

server.listen(PORT, () => console.log(`THE KIWI REPORT running at http://localhost:${PORT}`));
