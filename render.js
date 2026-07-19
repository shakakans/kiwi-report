// Server-side HTML rendering. Front page, article pages, and the
// /admin control room (login + writer).
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(t) {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.round(mins / 60);
  return `${hrs}H AGO`;
}

// Only ever emit http(s) URLs into the page — blocks javascript: etc.
function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? u : null;
}

function headlineClass(item) {
  const ageHours = (Date.now() - item.time) / 3600000;
  // Red is reserved for the handful of top-ranked, fresh, multi-source
  // stories (rank is the item's position in the score-sorted list).
  if (item.rank < 8 && item.heat >= 5 && ageHours < 5) return 'hl red';
  if (item.heat >= 4) return 'hl hot';
  return 'hl';
}

// Small "$ PAYWALL" chip for articles behind a subscription.
function payBadge(item) {
  return item.premium ? ' <span class="pay">$ PAYWALL</span>' : '';
}

// Credits other outlets running the same story (from the merge step),
// or falls back to a numeric trending badge for keyword-trending stories.
function sourceLine(item) {
  if (item.also && item.also.length) {
    const names = item.also.slice(0, 3).map(esc).join(', ');
    const extra = item.also.length > 3 ? ' +' + (item.also.length - 3) : '';
    return ` &middot; <b class="flame">&#9650;</b> ALSO ${names}${extra}`;
  }
  if (item.heat >= 4) return ` &middot; <b class="flame">&#9650; ${item.heat} SOURCES</b>`;
  return '';
}

function renderItem(item) {
  return `<li>
    ${item.showImage && item.image ? `<a href="${esc(item.link)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(item.image)}" alt="" loading="lazy"></a>` : ''}
    <a class="${headlineClass(item)}" href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.title)}</a>
    <span class="meta">${esc(item.tag)} &middot; ${timeAgo(item.time)}${sourceLine(item)}${payBadge(item)}</span>
  </li>`;
}

// Where an editor article's headline points: its external link if one
// was given, otherwise its own /post page.
function postHref(a) {
  return safeUrl(a.link) || '/post/' + a.id;
}

// An editor article shaped like a feed item for the columns.
function postAsItem(a) {
  return {
    title: a.title, link: postHref(a), tag: 'KIWI REPORT', time: a.time,
    image: safeUrl(a.image), heat: 1, premium: false, also: []
  };
}

// The editor's siren header, shown instead of the algorithm's pick.
// Highlighter-yellow treatment so a pinned story is unmissably ours.
function renderEditorSiren(a) {
  const href = postHref(a);
  const image = safeUrl(a.image);
  return `<div class="siren">
    ${image ? `<a href="${esc(href)}" target="_blank" rel="noopener"><img class="mainimg" src="${esc(image)}" alt=""></a>` : ''}
    <div class="hltwrap"><a class="mainhl hlt" href="${esc(href)}" target="_blank" rel="noopener">${esc(a.title)}</a></div>
    <div class="mainmeta"><span class="kiwitag">&#9733; KIWI REPORT &#9733;</span></div>
  </div>`;
}

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">`;

function renderPage(state, editorial) {
  const siren = editorial && editorial.siren;
  const posts = (editorial && editorial.posts) || [];

  if (!state.updatedAt) {
    return `<!doctype html><html><head>${HEAD}<meta http-equiv="refresh" content="5">
      <title>THE KIWI REPORT</title></head>
      <body><div class="loading">PULLING THE KIWI WIRES&hellip;<br><span>first fetch in progress, page reloads automatically</span></div></body></html>`;
  }

  const { main, trendingTokens, sourceCount, updatedAt } = state;
  // Editor posts lead the first column; with a siren article up, the
  // algorithm's top story joins them rather than disappearing.
  const items = [...posts.map(postAsItem), ...(siren ? [main] : []), ...state.items];
  items.forEach((item, rank) => { item.rank = rank; });
  const third = Math.ceil(items.length / 3);
  const cols = [items.slice(0, third), items.slice(third, third * 2), items.slice(third * 2)];

  // Sprinkle photos through the columns: up to 3 per column, spaced out.
  for (const col of cols) {
    let shown = 0, lastIdx = -10;
    col.forEach((item, idx) => {
      if (shown < 3 && item.image && idx - lastIdx >= 6) {
        item.showImage = true;
        shown++;
        lastIdx = idx;
      }
    });
  }

  const updated = new Date(updatedAt).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' });

  return `<!doctype html>
<html lang="en">
<head>
${HEAD}
<meta http-equiv="refresh" content="300">
<title>THE KIWI REPORT</title>
</head>
<body>
<header>
  <div class="topbar">
    <span class="updated">UPDATED ${esc(updated)} &middot; ${sourceCount} NZ WIRES LIVE &middot; AUTO-REFRESH 5 MIN</span>
    <button id="themeToggle" title="toggle dark mode">&#9681;</button>
  </div>

  ${siren ? renderEditorSiren(siren) : `<div class="siren">
    ${main.image ? `<a href="${esc(main.link)}" target="_blank" rel="noopener"><img class="mainimg" src="${esc(main.image)}" alt=""></a>` : ''}
    <a class="mainhl" href="${esc(main.link)}" target="_blank" rel="noopener">${esc(main.title)}</a>
    <div class="mainmeta">${esc(main.tag)}${main.also && main.also.length ? ' &middot; ALSO ' + main.also.slice(0, 4).map(esc).join(', ') : ''} &middot; ${main.heat} SOURCES ON THIS STORY${payBadge(main)}</div>
    ${main.related.length ? `<ul class="relatedlist">${main.related.map(r =>
      `<li><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="meta">${esc(r.tag)}${payBadge(r)}</span></li>`).join('')}</ul>` : ''}
  </div>`}

  <h1 class="logo">THE KIWI REPORT</h1>

  ${trendingTokens.length ? `<div class="trendbar">TRENDING:
    ${trendingTokens.slice(0, 8).map(t => `<span class="trend">${esc(t.token.toUpperCase())}<sup>${t.sources}</sup></span>`).join(' ')}
  </div>` : ''}
</header>

<main class="columns">
  ${cols.map(col => `<ul class="col">${col.map(renderItem).join('\n')}</ul>`).join('\n')}
</main>

<footer>
  <hr>
  <p>THE KIWI REPORT &middot; FULLY AUTOMATED &middot; HEADLINES BELONG TO THEIR PUBLISHERS &middot; RANKED BY CROSS-SOURCE TREND DETECTION</p>
  <p class="meta">REFRESHES ITSELF EVERY 10 MINUTES &middot; ${new Date(updatedAt).toUTCString()}</p>
</footer>

<script>
(function () {
  var btn = document.getElementById('themeToggle');
  var saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.classList.add('dark');
  btn.addEventListener('click', function () {
    var dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });
})();
</script>
</body>
</html>`;
}

// A full article page for an editor post. Body paragraphs are split on
// blank lines; a line that is only an image URL becomes an image.
function renderArticle(a) {
  const image = safeUrl(a.image);
  const bodyHtml = String(a.body || '').split(/\n\s*\n/).map(par => {
    const line = par.trim();
    if (!line) return '';
    if (/^https?:\/\/\S+$/i.test(line) && safeUrl(line)) {
      return `<img class="postimg" src="${esc(line)}" alt="">`;
    }
    return `<p>${esc(line).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  const when = new Date(a.time).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland', dateStyle: 'long', timeStyle: 'short'
  });

  return `<!doctype html>
<html lang="en">
<head>
${HEAD}
<title>${esc(a.title)} &middot; THE KIWI REPORT</title>
</head>
<body>
<div class="post">
  <p class="postbrand"><a href="/">THE KIWI REPORT</a></p>
  <h1 class="posthl">${esc(a.title)}</h1>
  <p class="meta postmeta">KIWI REPORT &middot; ${esc(when)}</p>
  ${image ? `<img class="postimg" src="${esc(image)}" alt="">` : ''}
  ${bodyHtml}
  <p class="postback"><a href="/">&larr; BACK TO THE FRONT PAGE</a></p>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------
// /admin — control room

function renderLogin(opts) {
  const { error, keyConfigured } = opts || {};
  return `<!doctype html>
<html lang="en">
<head>
${HEAD}
<title>CONTROL ROOM &middot; THE KIWI REPORT</title>
</head>
<body>
<h1 class="logo">CONTROL ROOM</h1>
<div class="adminbox loginbox">
  ${keyConfigured ? `
  <form method="POST" action="/admin/login">
    <label>PASSWORD</label>
    <input type="password" name="password" autofocus autocomplete="current-password">
    ${error ? `<p class="adminerror">WRONG PASSWORD &mdash; TRY AGAIN</p>` : ''}
    <div class="adminbtns"><button type="submit" class="btn-on">ENTER</button></div>
  </form>` : `
  <p class="adminstatus">NO PASSWORD CONFIGURED</p>
  <p>The control room only works on localhost until a password is set.
  On Render: open your service &rarr; <b>Environment</b> &rarr; add
  <code>ADMIN_KEY</code> with your chosen password &rarr; Save.</p>`}
</div>
</body>
</html>`;
}

function articleRow(a) {
  return `<li class="postrow">
    <div class="postrowtop">
      <b>${esc(a.title)}</b>
      <span class="chips">
        ${a.active ? '<span class="chip live">LIVE</span>' : '<span class="chip">HIDDEN</span>'}
        ${a.siren ? '<span class="chip siren">&#9733; SIREN</span>' : ''}
      </span>
    </div>
    <span class="meta">${timeAgo(a.time)} &middot; ${a.body ? 'ARTICLE PAGE' : 'HEADLINE ONLY'}${safeUrl(a.link) ? ' &middot; LINKS OUT' : ''}</span>
    <div class="rowbtns">
      <a class="rowbtn" href="/admin?edit=${esc(a.id)}">EDIT</a>
      <a class="rowbtn" href="${esc(postHref(a))}" target="_blank" rel="noopener">VIEW</a>
      <form method="POST" action="/admin/toggle"><input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="field" value="active"><button class="rowbtn">${a.active ? 'HIDE' : 'GO LIVE'}</button></form>
      <form method="POST" action="/admin/toggle"><input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="field" value="siren"><button class="rowbtn">${a.siren ? 'DROP SIREN' : 'MAKE SIREN'}</button></form>
      <form method="POST" action="/admin/delete" onsubmit="return confirm('Delete this article for good?')"><input type="hidden" name="id" value="${esc(a.id)}"><button class="rowbtn danger">DELETE</button></form>
    </div>
  </li>`;
}

function renderAdmin(articles, opts) {
  const { editing, saved } = opts || {};
  const a = editing || { id: '', title: '', body: '', image: '', link: '', active: true, siren: false };
  return `<!doctype html>
<html lang="en">
<head>
${HEAD}
<title>CONTROL ROOM &middot; THE KIWI REPORT</title>
</head>
<body>
<h1 class="logo">CONTROL ROOM</h1>

<div class="adminbox">
  <p class="adminstatus">${editing ? 'EDITING ARTICLE' : 'WRITE'}${saved ? ' &middot; <b class="live">SAVED</b>' : ''}</p>
  <form method="POST" action="/admin/save">
    <input type="hidden" name="id" value="${esc(a.id)}">
    <label>HEADLINE (required)</label>
    <textarea name="title" rows="2" maxlength="200" placeholder="YOUR HEADLINE HERE...">${esc(a.title)}</textarea>
    <label>STORY (optional &mdash; gets its own page on the site; blank line = new paragraph; a line that is just an image URL becomes a picture)</label>
    <textarea name="body" rows="12" maxlength="50000" placeholder="Write the story...">${esc(a.body)}</textarea>
    <label>HEADER IMAGE URL (optional, https://...)</label>
    <input type="url" name="image" value="${esc(a.image)}" placeholder="https://">
    <label>EXTERNAL LINK (optional &mdash; if set, the headline links there instead of your article page)</label>
    <input type="url" name="link" value="${esc(a.link)}" placeholder="https://">
    <div class="adminchecks">
      <label><input type="checkbox" name="active"${a.active ? ' checked' : ''}> LIVE IN THE FEED</label>
      <label><input type="checkbox" name="siren"${a.siren ? ' checked' : ''}> &#9733; SIREN HEADER (replaces the big headline)</label>
    </div>
    <div class="adminbtns">
      <button type="submit" class="btn-on">${editing ? 'SAVE CHANGES' : 'PUBLISH'}</button>
      ${editing ? `<a class="btn-off rowbtn cancel" href="/admin">CANCEL</a>` : ''}
    </div>
  </form>
</div>

<div class="adminbox">
  <p class="adminstatus">YOUR ARTICLES (${articles.length})</p>
  ${articles.length ? `<ul class="postlist">${articles.map(articleRow).join('\n')}</ul>`
    : `<p class="adminnote">Nothing yet. Write your first story above &mdash; publish it, and it appears at the top of the first column. Tick SIREN to take over the big header.</p>`}
  <p class="adminnote"><a href="/" target="_blank">View the front page &rarr;</a></p>
</div>

<form method="POST" action="/admin/logout" class="logoutform"><button class="rowbtn">LOG OUT</button></form>
</body>
</html>`;
}

module.exports = { renderPage, renderArticle, renderAdmin, renderLogin };
