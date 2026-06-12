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

function renderItem(item) {
  return `<li>
    ${item.showImage && item.image ? `<a href="${esc(item.link)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(item.image)}" alt="" loading="lazy"></a>` : ''}
    <a class="${headlineClass(item)}" href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.title)}</a>
    <span class="meta">${esc(item.tag)} &middot; ${timeAgo(item.time)}${item.heat >= 4 ? ' &middot; <b class="flame">&#9650; ' + item.heat + ' SOURCES</b>' : ''}</span>
  </li>`;
}

function renderPage(state) {
  if (!state.updatedAt) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
      <title>THE KIWI REPORT</title><link rel="stylesheet" href="/style.css"></head>
      <body><div class="loading">PULLING THE KIWI WIRES&hellip;<br><span>first fetch in progress, page reloads automatically</span></div></body></html>`;
  }

  const { main, items, trendingTokens, sourceCount, updatedAt } = state;
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
</head>
<body>
<header>
  <div class="topbar">
    <span class="updated">UPDATED ${esc(updated)} &middot; ${sourceCount} NZ WIRES LIVE &middot; AUTO-REFRESH 5 MIN</span>
    <button id="themeToggle" title="toggle dark mode">&#9681;</button>
  </div>

  <div class="siren">
    ${main.image ? `<a href="${esc(main.link)}" target="_blank" rel="noopener"><img class="mainimg" src="${esc(main.image)}" alt=""></a>` : ''}
    <a class="mainhl" href="${esc(main.link)}" target="_blank" rel="noopener">${esc(main.title)}</a>
    <div class="mainmeta">${esc(main.tag)} &middot; ${main.heat} SOURCES ON THIS STORY</div>
    ${main.related.length ? `<ul class="relatedlist">${main.related.map(r =>
      `<li><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="meta">${esc(r.tag)}</span></li>`).join('')}</ul>` : ''}
  </div>

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

module.exports = { renderPage };
