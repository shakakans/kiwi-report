# THE KIWI REPORT

A self-running, Drudge Report–style news aggregator. No database, no build
step, no manual curation — it pulls RSS from New Zealand outlets (RNZ, NZ Herald, Stuff, 1News, ODT, Newsroom, The Spinoff, Interest, Scoop), detects what's
trending across them, and renders the page itself.

## Run it

```sh
npm install
npm start          # http://localhost:3100
```

That's it. The server:

- fetches all feeds on boot and every **10 minutes** after
- the page **auto-reloads every 5 minutes** in the browser (classic Drudge meta-refresh)
- keeps serving the last good data if some feeds go down

## How trending works

Headlines from the last 36 hours are tokenized (stopwords stripped). For each
keyword, it counts how many *distinct outlets* are using it right now. A
story's score is the squared cross-source overlap of its top keywords, decayed
by age. The highest-scoring multi-source story becomes the big siren headline,
with related coverage from other outlets linked beneath it.

- **Red headline** = 5+ outlets on it and under 4 hours old
- **▲ N SOURCES** badge = trending across N outlets
- **TRENDING:** bar = the hottest keywords on the wires right now

## Files

- [feeds.js](feeds.js) — the feed list; add/remove sources here
- [aggregator.js](aggregator.js) — fetching, dedupe, trend scoring
- [render.js](render.js) — server-side HTML
- [public/style.css](public/style.css) — Courier, all-caps, three columns, dark mode

## Keep it running forever (optional)

```sh
# simple: pm2
npm i -g pm2 && pm2 start server.js --name kiwi-report && pm2 save
```
