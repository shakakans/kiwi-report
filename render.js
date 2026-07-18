// Server-side HTML rendering. One page, Drudge-style.
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

// Only ever emit http(s) URLs into the page — blocks javascript: etc.
function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? u : null;
}

// The editor's override siren, shown instead of the algorithm's pick.
function renderOverrideSiren(ov) {
  const link = safeUrl(ov.link);
  const image = safeUrl(ov.image);
  const headline = link
    ? `<a class="mainhl ovr" href="${esc(link)}" target="_blank" rel="noopener">${esc(ov.title)}</a>`
    : `<span class="mainhl ovr">${esc(ov.title)}</span>`;
  return `<div class="siren">
    ${image ? (link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener"><img class="mainimg" src="${esc(image)}" alt=""></a>`
      : `<img class="mainimg" src="${esc(image)}" alt="">`) : ''}
    ${headline}
    <div class="mainmeta">&#9733; EDITOR'S PICK &#9733;</div>
  </div>`;
}

function renderPage(state, override) {
  const ovActive = !!(override && override.active && override.title);
  if (!state.updatedAt) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
      <title>THE KIWI REPORT</title><link rel="stylesheet" href="/style.css">
      <link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>
      <body><div class="loading">PULLING THE KIWI WIRES&hellip;<br><span>first fetch in progress, page reloads automatically</span></div></body></html>`;
  }

  const { main, trendingTokens, sourceCount, updatedAt } = state;
  // When the override siren is up, the algorithm's top story still
  // deserves the page — it leads the first column instead.
  const items = ovActive ? [main, ...state.items] : state.items;
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
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>THE KIWI REPORT</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<header>
  <div class="topbar">
    <span class="updated">UPDATED ${esc(updated)} &middot; ${sourceCount} NZ WIRES LIVE &middot; AUTO-REFRESH 5 MIN</span>
    <button id="themeToggle" title="toggle dark mode">&#9681;</button>
  </div>

  ${ovActive ? renderOverrideSiren(override) : `<div class="siren">
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

// The /admin control room: publish or clear the override siren.
function renderAdmin(override, { allowed, keyConfigured, key, saved }) {
  const body = !allowed
    ? `<div class="adminbox">
        <p class="adminstatus">ACCESS DENIED</p>
        ${keyConfigured
          ? `<p>Add your passcode to the address: <code>/admin?key=YOUR-PASSCODE</code></p>`
          : `<p>No passcode is configured, so the control room only works on localhost.</p>
             <p>To use it on the live site: in Render open your service &rarr; <b>Environment</b> &rarr; add
             <code>ADMIN_KEY</code> with a passcode you choose &rarr; Save (it redeploys itself).
             Then visit <code>/admin?key=YOUR-PASSCODE</code>.</p>`}
      </div>`
    : `<div class="adminbox">
        <p class="adminstatus">OVERRIDE IS ${override.active ? '<b class="live">&#9679; LIVE</b>' : '<b>OFF</b>'}${saved ? ' &middot; SAVED' : ''}</p>
        <form method="POST" action="/admin">
          <input type="hidden" name="key" value="${esc(key)}">
          <label>HEADLINE (required)</label>
          <textarea name="title" rows="2" maxlength="200" placeholder="MASSIVE STORY BREAKS ACROSS NZ...">${esc(override.title)}</textarea>
          <label>LINK (optional, https://...)</label>
          <input type="url" name="link" value="${esc(override.link)}" placeholder="https://">
          <label>IMAGE URL (optional, https://...)</label>
          <input type="url" name="image" value="${esc(override.image)}" placeholder="https://">
          <div class="adminbtns">
            <button type="submit" name="action" value="on" class="btn-on">PUBLISH OVERRIDE</button>
            <button type="submit" name="action" value="off" class="btn-off">TURN OFF</button>
          </div>
        </form>
        <p class="adminnote">Publish replaces the big siren headline with yours; the wires' own top story
        moves to the first column. Turn off hands the siren back to the algorithm. Values are kept for next time.
        <a href="/" target="_blank">View the front page &rarr;</a></p>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CONTROL ROOM &middot; THE KIWI REPORT</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<h1 class="logo">CONTROL ROOM</h1>
${body}
</body>
</html>`;
}

module.exports = { renderPage, renderAdmin };
