const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');
const { refresh, getState, REFRESH_MS } = require('./aggregator');
const { renderPage, renderArticle, renderAdmin, renderLogin } = require('./render');
const articles = require('./articles');

const PORT = process.env.PORT || 3100;

// --- Control room auth ----------------------------------------------
// With ADMIN_KEY set (Render -> Environment), /admin shows a password
// form; a correct password sets a session cookie. Without ADMIN_KEY,
// /admin only works on localhost so a fresh deploy is never left open.
const ADMIN_KEY = process.env.ADMIN_KEY || null;
const SESSION = ADMIN_KEY
  ? crypto.createHmac('sha256', ADMIN_KEY).update('kiwi-session').digest('hex')
  : null;

function isLocalhost(req) {
  const host = String(req.headers.host || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

function isAuthed(req) {
  if (!ADMIN_KEY) return isLocalhost(req);
  const cookies = String(req.headers.cookie || '').split(/;\s*/);
  return cookies.includes('kr_admin=' + SESSION);
}

function sessionCookie(clear) {
  return `kr_admin=${clear ? '' : SESSION}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 60 * 60 * 24 * 30}`;
}

function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
  req.on('end', () => cb(querystring.parse(body)));
}

function redirect(res, to, cookie) {
  const headers = { Location: to };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}

function html(res, code, page) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}

// Self-running: refresh on boot, then on an interval forever.
refresh().catch(err => console.error('[refresh] failed:', err.message));
setInterval(() => refresh().catch(err => console.error('[refresh] failed:', err.message)), REFRESH_MS);

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const query = querystring.parse((req.url || '').split('?')[1] || '');

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

  // Editor article pages.
  if (url.startsWith('/post/')) {
    const a = articles.get(url.slice('/post/'.length));
    if (a && (a.active || isAuthed(req))) { html(res, 200, renderArticle(a)); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('NOT FOUND');
    return;
  }

  // --- Control room ---------------------------------------------------

  if (url === '/admin/login' && req.method === 'POST') {
    readBody(req, q => {
      if (ADMIN_KEY && String(q.password || '') === ADMIN_KEY) {
        redirect(res, '/admin', sessionCookie(false));
      } else {
        html(res, 403, renderLogin({ error: true, keyConfigured: !!ADMIN_KEY }));
      }
    });
    return;
  }

  if (url === '/admin/logout' && req.method === 'POST') {
    redirect(res, '/admin', sessionCookie(true));
    return;
  }

  if (url === '/admin' && req.method === 'GET') {
    // The old bookmark style (?key=...) still logs you in once.
    if (!isAuthed(req) && ADMIN_KEY && String(query.key || '') === ADMIN_KEY) {
      redirect(res, '/admin', sessionCookie(false));
      return;
    }
    if (!isAuthed(req)) {
      html(res, ADMIN_KEY ? 200 : 403, renderLogin({ keyConfigured: !!ADMIN_KEY }));
      return;
    }
    const editing = query.edit ? articles.get(String(query.edit)) : null;
    html(res, 200, renderAdmin(articles.list(), { editing, saved: !!query.saved }));
    return;
  }

  if ((url === '/admin/save' || url === '/admin/toggle' || url === '/admin/delete') && req.method === 'POST') {
    if (!isAuthed(req)) {
      html(res, 403, renderLogin({ keyConfigured: !!ADMIN_KEY }));
      return;
    }
    readBody(req, q => {
      if (url === '/admin/save') {
        const title = String(q.title || '').trim().slice(0, 200);
        if (!title) { redirect(res, '/admin'); return; }
        const a = articles.upsert({
          id: String(q.id || '').trim() || null,
          title,
          body: String(q.body || '').trim().slice(0, 50000),
          image: String(q.image || '').trim().slice(0, 500),
          link: String(q.link || '').trim().slice(0, 500),
          active: q.active === 'on',
          siren: q.siren === 'on',
          emergency: q.emergency === 'on'
        });
        console.log(`[articles] saved "${a.title}"${a.emergency ? ' (EMERGENCY)' : a.siren ? ' (SIREN)' : ''}${a.active ? '' : ' (hidden)'}`);
      } else if (url === '/admin/toggle') {
        const field = ['siren', 'emergency'].includes(q.field) ? q.field : 'active';
        articles.toggle(String(q.id || ''), field);
      } else {
        articles.remove(String(q.id || ''));
      }
      redirect(res, '/admin?saved=1');
    });
    return;
  }

  if (url === '/') {
    html(res, 200, renderPage(getState(), { siren: articles.siren(), posts: articles.activePosts() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('NOT FOUND');
});

server.listen(PORT, () => console.log(`THE KIWI REPORT running at http://localhost:${PORT}`));
