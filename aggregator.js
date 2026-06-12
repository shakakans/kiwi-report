// Pulls all feeds, scores stories by how many independent sources are
// covering the same nouns right now, and picks the siren headline.
const Parser = require('rss-parser');
const FEEDS = require('./feeds');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WireReport/1.0)' },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }]
    ]
  }
});

const MAX_AGE_HOURS = 36;
const REFRESH_MS = 10 * 60 * 1000;

const STOPWORDS = new Set((
  'a an the and or but nor for yet so of in on at to from by with about into over after before ' +
  'under between during without within along across behind beyond near above below off out up down ' +
  'is are was were be been being am do does did doing have has had having will would shall should ' +
  'can could may might must this that these those it its they them their he she his her him you your ' +
  'we our us i me my as if then than when while where who whom whose which what why how not no more ' +
  'most some any all both each few other such only own same just also too very still even ever never ' +
  'now here there again once new news says said say take takes top live latest update updates report ' +
  'reports breaking watch video photos amid among against because get gets got make makes made first ' +
  'year years day days week weeks month months time times man woman people city state country world ' +
  'today tonight back set sets way ways big small long large many much call calls calling face faces ' +
  'plan plans show shows see seen look looks find finds found give given know known need needs help ' +
  'reveals revealed could-be opinion analysis exclusive his her one two three thing things ' +
  'inside outside dont wont cant whats heres ' +
  'monday tuesday wednesday thursday friday saturday sunday january february march april june july ' +
  'august september october november december daily weekly morning evening briefing recap quiz '
).split(/\s+/));

let state = {
  updatedAt: null,
  main: null,          // siren headline { title, link, tag, image, related: [] }
  items: [],           // everything else, scored & sorted
  trendingTokens: [],  // [{ token, sources }]
  sourceCount: 0,
  errors: []
};

function tokenize(title) {
  return [...new Set(
    title.toLowerCase()
      .replace(/[’']/g, '')
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
  )];
}

function extractImage(item) {
  const fromArr = arr => {
    if (!Array.isArray(arr)) return null;
    for (const m of arr) {
      const url = m && m.$ && m.$.url;
      if (url && /^https?:/.test(url)) return url;
    }
    return null;
  };
  return (item.enclosure && /^https?:/.test(item.enclosure.url || '') && item.enclosure.url)
    || fromArr(item.mediaContent)
    || fromArr(item.mediaThumbnail)
    || null;
}

async function fetchFeed(feed) {
  const parsed = await parser.parseURL(feed.url);
  const now = Date.now();
  return (parsed.items || []).map(item => {
    const title = (item.title || '').trim();
    const time = item.isoDate ? Date.parse(item.isoDate) : now;
    return {
      title,
      link: item.link || '',
      tag: feed.tag,
      time,
      image: extractImage(item),
      tokens: tokenize(title)
    };
  }).filter(i =>
    i.title && i.link &&
    (now - i.time) < MAX_AGE_HOURS * 3600 * 1000 &&
    i.time < now + 3600 * 1000
  );
}

function dedupe(items) {
  const seen = new Map();
  const out = [];
  for (const item of items.sort((a, b) => b.time - a.time)) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (key && !seen.has(key)) {
      seen.set(key, true);
      out.push(item);
    }
  }
  return out;
}

function score(items) {
  // token -> set of source tags mentioning it
  const tokenSources = new Map();
  for (const item of items) {
    for (const t of item.tokens) {
      if (!tokenSources.has(t)) tokenSources.set(t, new Set());
      tokenSources.get(t).add(item.tag);
    }
  }

  const now = Date.now();
  for (const item of items) {
    // A story is "trending" when several independent outlets share its nouns.
    const counts = item.tokens
      .map(t => tokenSources.get(t).size)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const cross = counts.reduce((s, c) => s + (c - 1) * (c - 1), 0);
    const ageHours = (now - item.time) / 3600000;
    // Heat = second-best keyword overlap, so one ubiquitous name
    // ("trump") doesn't mark every story as breaking.
    item.heat = counts.length >= 2 ? counts[1] : (counts[0] || 1);
    item.score = (1 + cross) * Math.exp(-ageHours / 10);
  }

  const trendingTokens = [...tokenSources.entries()]
    .map(([token, sources]) => ({ token, sources: sources.size }))
    .filter(t => t.sources >= 3)
    .sort((a, b) => b.sources - a.sources)
    .slice(0, 12);

  return trendingTokens;
}

function related(main, items, limit) {
  return items
    .filter(i => i !== main && i.tokens.filter(t => main.tokens.includes(t)).length >= 2)
    .slice(0, limit);
}

async function refresh() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const errors = [];
  let all = [];
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') all = all.concat(r.value);
    else errors.push(`${FEEDS[idx].tag}: ${r.reason && r.reason.message}`);
  });

  if (all.length === 0) {
    state.errors = errors;
    return state; // keep last good state
  }

  let items = dedupe(all);
  const trendingTokens = score(items);
  items.sort((a, b) => b.score - a.score);

  const main = items.find(i => i.heat >= 3) || items[0];
  const rel = related(main, items, 6);
  const used = new Set([main, ...rel]);

  state = {
    updatedAt: Date.now(),
    main: { ...main, related: rel.map(({ title, link, tag }) => ({ title, link, tag })) },
    items: items.filter(i => !used.has(i)).slice(0, 90),
    trendingTokens,
    sourceCount: new Set(items.map(i => i.tag)).size,
    errors
  };
  console.log(`[refresh] ${items.length} stories from ${state.sourceCount} sources; main: "${main.title}"${errors.length ? '; errors: ' + errors.join(' | ') : ''}`);
  return state;
}

function getState() { return state; }

module.exports = { refresh, getState, REFRESH_MS };
