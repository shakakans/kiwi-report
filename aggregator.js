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

// --- Ranking balance ------------------------------------------------
// Each story's rank blends two things, both scaled 0–1 so neither can
// run away: how RECENT it is, and how WIDELY it's covered across
// independent outlets. Raise RECENCY_WEIGHT to push fresh news up;
// raise COVERAGE_WEIGHT to keep big shared stories up even as they age.
// (The two weights don't have to add to 1, but it's tidy if they do.)
const RECENCY_WEIGHT = 0.6;
const COVERAGE_WEIGHT = 0.4;
// Hours for the recency score to halve. Smaller = the page churns to
// fresh news faster; larger = important stories linger longer.
const RECENCY_HALFLIFE_H = 8;

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

// Offset of Pacific/Auckland from UTC at instant t (handles NZST/NZDT).
function aucklandOffsetMs(t) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', timeZoneName: 'shortOffset' });
  const name = dtf.formatToParts(t).find(p => p.type === 'timeZoneName').value; // e.g. "GMT+12"
  const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 12 * 3600000;
  return (+m[1]) * 3600000 + (m[2] ? Math.sign(+m[1]) * (+m[2]) * 60000 : 0);
}

// Parses non-standard NZ-style dates like "13th Jul 26, 5:20pm"
// (interest.co.nz), treated as Pacific/Auckland wall-clock time.
function parseNZDate(str) {
  const m = String(str).trim().match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\s+(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i
  );
  if (!m) return null;
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const mon = months[m[2].slice(0, 3).toLowerCase()];
  if (mon === undefined) return null;
  let year = +m[3];
  if (year < 100) year += 2000;
  let hour = (+m[4]) % 12;
  if (/pm/i.test(m[6])) hour += 12;
  const wall = Date.UTC(year, mon, +m[1], hour, +m[5]);
  // Convert Auckland wall time to UTC; second pass settles DST edges.
  let utc = wall - aucklandOffsetMs(wall);
  utc = wall - aucklandOffsetMs(utc);
  return utc;
}

// When a feed gives no usable date at all, remember when WE first saw the
// link and use that — a one-time stamp is honest; re-stamping "now" on
// every refresh (the old behaviour) made stale items look forever fresh.
const firstSeen = new Map();

function itemTime(item, now) {
  if (item.isoDate) {
    const t = Date.parse(item.isoDate);
    if (!isNaN(t)) return t;
  }
  if (item.pubDate) {
    const t = Date.parse(item.pubDate);
    if (!isNaN(t)) return t;
    const nz = parseNZDate(item.pubDate);
    if (nz !== null) return nz;
  }
  const key = item.link || item.guid || item.title;
  if (!firstSeen.has(key)) firstSeen.set(key, now);
  return firstSeen.get(key);
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

// Is this article behind a paywall? True when the whole source is
// flagged `paywall: true` in feeds.js, or when the article URL carries
// a premium marker (NZ Herald puts /premium/ in paid-article URLs).
function isPremium(feed, link) {
  return feed.paywall === true || /\/premium\//i.test(link);
}

async function fetchFeed(feed) {
  const parsed = await parser.parseURL(feed.url);
  const now = Date.now();
  return (parsed.items || []).map(item => {
    const title = (item.title || '').trim();
    const time = itemTime(item, now);
    return {
      title,
      link: item.link || '',
      tag: feed.tag,
      time,
      premium: isPremium(feed, item.link || ''),
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

// How much do two headlines overlap in significant words?
function tokenOverlap(a, b) {
  if (!a.length || !b.length) return { shared: 0, jac: 0 };
  const setB = new Set(b);
  let shared = 0;
  for (const t of a) if (setB.has(t)) shared++;
  const union = a.length + b.length - shared;
  return { shared, jac: union ? shared / union : 0 };
}

// Same real-world event? True when two headlines share most of their
// keywords, even if the wording differs ("drug overdose" vs "GHB
// overdose"). Tuned to merge re-tellings without merging different
// stories that happen to share a word or two.
function sameEvent(a, b) {
  const { shared, jac } = tokenOverlap(a.tokens, b.tokens);
  return shared >= 2 && (jac >= 0.55 || shared >= 4);
}

// Collapse near-duplicate headlines of the same event into one line.
// MUST run AFTER scoring so cross-source trend detection still sees
// every outlet's wording. Keeps the highest-ranked version as the
// headline (input is score-sorted) and records the other outlets in
// `also` so the survivor can credit them and show true coverage breadth.
function mergeSimilar(items) {
  const kept = [];
  for (const item of items) {
    const rep = kept.find(k => sameEvent(k, item));
    if (rep) {
      if (item.tag !== rep.tag && !rep.also.includes(item.tag)) rep.also.push(item.tag);
      rep.heat = Math.max(rep.heat, 1 + rep.also.length); // badge reflects real outlet count
    } else {
      item.also = [];
      kept.push(item);
    }
  }
  return kept;
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

  // Pass 1: measure how widely each story is covered across outlets.
  // A story is "trending" when several independent outlets share its nouns.
  let maxCross = 0;
  for (const item of items) {
    const counts = item.tokens
      .map(t => tokenSources.get(t).size)
      .sort((a, b) => b - a)
      .slice(0, 3);
    item.cross = counts.reduce((s, c) => s + (c - 1) * (c - 1), 0);
    // Heat = second-best keyword overlap, so one ubiquitous name
    // ("trump") doesn't mark every story as breaking.
    item.heat = counts.length >= 2 ? counts[1] : (counts[0] || 1);
    if (item.cross > maxCross) maxCross = item.cross;
  }

  // Pass 2: blend recency and coverage on the same 0–1 scale. This is
  // the balance: fresh-but-quiet and older-but-widely-covered both get a
  // fair shot, while genuinely old + lightly covered stories sink.
  const crossNorm = Math.log(1 + maxCross) || 1;
  for (const item of items) {
    const ageHours = (now - item.time) / 3600000;
    const recencyScore = Math.pow(0.5, ageHours / RECENCY_HALFLIFE_H); // 1 (now) -> 0 (old)
    const coverageScore = Math.log(1 + item.cross) / crossNorm;        // 0 (solo) -> 1 (most covered)
    item.score = RECENCY_WEIGHT * recencyScore + COVERAGE_WEIGHT * coverageScore;
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
  const trendingTokens = score(items);   // trending uses every outlet's wording
  items.sort((a, b) => b.score - a.score);
  items = mergeSimilar(items);           // then collapse same-event re-tellings

  const main = items.find(i => i.heat >= 3) || items[0];
  const rel = related(main, items, 6);
  const used = new Set([main, ...rel]);

  state = {
    updatedAt: Date.now(),
    main: { ...main, related: rel.map(({ title, link, tag, premium }) => ({ title, link, tag, premium })) },
    items: items.filter(i => !used.has(i)).slice(0, 90),
    trendingTokens,
    sourceCount: new Set(items.map(i => i.tag)).size,
    errors
  };
  // Stop the firstSeen cache growing forever.
  const cutoff = Date.now() - MAX_AGE_HOURS * 2 * 3600000;
  for (const [k, t] of firstSeen) if (t < cutoff) firstSeen.delete(k);

  console.log(`[refresh] ${items.length} stories from ${state.sourceCount} sources; main: "${main.title}"${errors.length ? '; errors: ' + errors.join(' | ') : ''}`);
  return state;
}

function getState() { return state; }

module.exports = { refresh, getState, REFRESH_MS };
