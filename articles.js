// Editor-authored articles: stored in a small json file next to the app.
// Note: Render's free-tier disk resets on each deploy, so posts written
// on the live site vanish when new code ships. With an uptime pinger the
// service rarely sleeps, so day-to-day they stick around.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'articles.json');

let articles = [];
try { articles = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

function persist() {
  try { fs.writeFileSync(FILE, JSON.stringify(articles, null, 2)); }
  catch (err) { console.error('[articles] could not persist:', err.message); }
}

function list() {
  return articles.slice().sort((a, b) => b.time - a.time);
}

function get(id) {
  return articles.find(a => a.id === id);
}

// Only one siren at a time: promoting an article demotes the others.
function clearSiren() {
  for (const a of articles) a.siren = false;
}

function upsert(data) {
  let a = data.id ? get(data.id) : null;
  if (!a) {
    a = { id: crypto.randomBytes(5).toString('hex'), time: Date.now() };
    articles.push(a);
  }
  a.title = data.title;
  a.body = data.body;
  a.image = data.image;
  a.link = data.link;
  a.active = data.active;
  if (data.siren) clearSiren();
  a.siren = data.siren;
  persist();
  return a;
}

function toggle(id, field) {
  const a = get(id);
  if (!a) return;
  if (field === 'siren' && !a.siren) clearSiren();
  a[field] = !a[field];
  persist();
}

function remove(id) {
  articles = articles.filter(a => a.id !== id);
  persist();
}

function siren() {
  return articles.find(a => a.active && a.siren) || null;
}

function activePosts() {
  return list().filter(a => a.active && !a.siren);
}

module.exports = { list, get, upsert, toggle, remove, siren, activePosts };
