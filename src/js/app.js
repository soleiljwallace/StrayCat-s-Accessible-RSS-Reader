import * as db from './db.js';
import * as native from './native.js';
import * as player from './player.js';
import { parseFeed, discoverFeeds, NotAFeedError, COMMON_FEED_PATHS } from './parse.js';
import { cleanHtml, extractArticle, wordCount } from './extract.js';
import { parseOpml, buildOpml } from './opml.js';
import { CATALOG } from './catalog.js';

// ---------------------------------------------------------------- state

const DEFAULT_SETTINGS = {
  interval: 60,          // minutes between automatic refreshes, 0 = manual only
  refreshOnStart: true,
  notify: false,
  fullText: 'auto',      // auto | always | never
  markOnOpen: true,
  sort: 'newest',
  keepDays: 30,
  speed: 1,
  home: 'all',          // 'feeds', 'all', or a feed id
  closeToTray: true,     // Windows
  startWithWindows: false,
};
const SHORT_TEXT_WORDS = 150;  // feed text shorter than this counts as "only a summary"
const FETCH_TIMEOUT_MS = 25000;

const feeds = new Map();
const articles = new Map();
let settings = { ...DEFAULT_SETTINGS };

const state = {
  view: 'feeds',
  feedId: 'all',            // current list: a feed id or 'all'
  unreadOnly: true,
  listOrder: [],            // article ids in the current list, for next and previous
  sticky: new Set(),        // read during this visit to the list; stay visible until you leave it
  articleId: null,
  showFeedVersion: false,
  returnTo: 'feeds',
  refreshing: false,
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

// ---------------------------------------------------------------- announcements and views

let announceTimer;
function announce(message) {
  const region = $('status');
  region.textContent = '';
  clearTimeout(announceTimer);
  // A short gap makes screen readers announce the same message twice in a row.
  announceTimer = setTimeout(() => { region.textContent = message; }, 60);
}

const VIEWS = ['feeds', 'list', 'article', 'add', 'feed-edit', 'settings', 'catalog'];
function show(view, focusTarget) {
  state.view = view;
  for (const v of VIEWS) $('view-' + v).hidden = v !== view;
  window.scrollTo(0, 0);
  const target = focusTarget || $('view-' + view).querySelector('h1');
  requestAnimationFrame(() => target?.focus());
}

// ---------------------------------------------------------------- helpers

const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const feedTitle = (f) => f?.title || f?.url || 'Unknown feed';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function unreadCount(feedId) {
  let n = 0;
  for (const a of articles.values()) if (!a.read && !a.hidden && (feedId === 'all' || a.feedId === feedId)) n++;
  return n;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relativeDate(ms) {
  if (!ms) return '';
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
  const d = new Date(ms);
  const opts = { month: 'long', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
const fullDate = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : '');

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); })])
    .finally(() => clearTimeout(t));
}

async function getUrl(url) {
  const res = await withTimeout(native.fetchText(url), FETCH_TIMEOUT_MS, 'The site took too long to answer.');
  if (res.status >= 400) throw new Error(`The site answered with error ${res.status}.`);
  return res;
}

function normalizeUrl(input) {
  let s = input.trim();
  if (!s) return '';
  if (s.startsWith('feed://')) s = 'https://' + s.slice(7);
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

const saveSettings = () => db.setKV('settings', settings);
const saveFeed = (f) => db.put('feeds', f);
const saveArticle = (a) => db.put('articles', a);

function setRead(article, read) {
  if (article.read === read) return;
  article.read = read;
  article.readAt = read ? Date.now() : null;
  saveArticle(article);
}

// ---------------------------------------------------------------- feeds view

function folderNames() {
  return [...new Set([...feeds.values()].map((f) => f.folder).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function renderFolderOptions() {
  $('folder-options').replaceChildren(...folderNames().map((n) => el('option', { value: n })));
}

function feedButton(f) {
  const unread = unreadCount(f.id);
  let label = `${feedTitle(f)}, ${unread ? unread + ' unread' : 'no unread'}`;
  if (f.lastError) label += ', last refresh failed';
  const b = el('button', { type: 'button', textContent: label, className: unread ? 'unread' : '' });
  b.dataset.feedId = f.id;
  return el('li', {}, b);
}

function renderFeeds() {
  const focusedId = document.activeElement?.dataset?.feedId;
  const all = [...feeds.values()].sort((a, b) => feedTitle(a).localeCompare(feedTitle(b), undefined, { sensitivity: 'base' }));
  const totalUnread = unreadCount('all');

  $('feeds-summary').textContent = all.length
    ? `${plural(totalUnread, 'unread article')} in ${plural(all.length, 'feed')}.`
    : 'No feeds yet. Use Add feed, or import an OPML file in Settings.';

  const groups = [];
  if (all.length) {
    const allBtn = el('button', { type: 'button', textContent: `All articles, ${totalUnread ? totalUnread + ' unread' : 'no unread'}` });
    allBtn.dataset.feedId = 'all';
    groups.push(el('ul', { className: 'item-list' }, el('li', {}, allBtn)));
  }
  const folders = folderNames();
  for (const name of folders) {
    groups.push(el('h2', { textContent: name }));
    groups.push(el('ul', { className: 'item-list' }, ...all.filter((f) => f.folder === name).map(feedButton)));
  }
  const loose = all.filter((f) => !f.folder);
  if (loose.length) {
    if (folders.length) groups.push(el('h2', { textContent: 'Other feeds' }));
    groups.push(el('ul', { className: 'item-list' }, ...loose.map(feedButton)));
  }
  $('feed-groups').replaceChildren(...groups);
  renderFolderOptions();
  renderNowPlaying();
  if (focusedId && state.view === 'feeds') $('feed-groups').querySelector(`[data-feed-id="${CSS.escape(focusedId)}"]`)?.focus();
}

$('feed-groups').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.dataset.feedId;
  if (id) openList(id);
});

// ---------------------------------------------------------------- article list view

function listArticles() {
  const list = [...articles.values()].filter((a) => !a.hidden &&
    (state.feedId === 'all' || a.feedId === state.feedId) && (!state.unreadOnly || !a.read || state.sticky.has(a.id)));
  const dir = settings.sort === 'oldest' ? 1 : -1;
  return list.sort((a, b) => dir * ((a.published || a.added) - (b.published || b.added)));
}

function articleButton(a) {
  const parts = [];
  if (state.feedId === 'all') parts.push(feedTitle(feeds.get(a.feedId)));
  if (a.published) parts.push(relativeDate(a.published));
  if (a.enclosure) parts.push('podcast');
  if (!a.read) parts.push('unread');
  const b = el('button', { type: 'button', className: a.read ? '' : 'unread' },
    a.title || 'Untitled',
    el('span', { className: 'visually-hidden', textContent: ', ' }),
    el('br'),
    el('span', { className: 'meta', textContent: parts.join(', ') }));
  b.dataset.articleId = a.id;
  return el('li', {}, b);
}

function renderList(focusArticleId) {
  const feed = feeds.get(state.feedId);
  $('list-heading').textContent = state.feedId === 'all' ? 'All articles' : feedTitle(feed);
  $('btn-feed-settings').hidden = state.feedId === 'all';
  $('btn-toggle-unread').setAttribute('aria-pressed', String(state.unreadOnly));

  const list = listArticles();
  state.listOrder = list.map((a) => a.id);
  const unread = unreadCount(state.feedId);
  let summary = `${unread} unread`;
  if (!state.unreadOnly) summary += `, ${list.length} total`;
  summary += '.';
  if (!list.length) {
    summary = state.unreadOnly
      ? 'No unread articles. Press the Unread only button to show read articles too.'
      : 'No articles yet. Try Refresh.';
  }
  if (feed?.lastError) summary += ` Last refresh failed: ${feed.lastError}`;
  $('list-summary').textContent = summary;
  $('article-list').replaceChildren(...list.map(articleButton));
  if (focusArticleId) $('article-list').querySelector(`[data-article-id="${CSS.escape(focusArticleId)}"]`)?.focus();
}

function openList(feedId) {
  state.feedId = feedId;
  state.sticky.clear();
  renderList();
  show('list');
}

$('article-list').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.dataset.articleId;
  if (id) openArticle(id);
});

// Up and down arrows move between articles in the list.
$('article-list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (moveListFocus(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
});

function moveListFocus(step) {
  const buttons = [...$('article-list').querySelectorAll('button')];
  if (!buttons.length) return false;
  const i = buttons.indexOf(document.activeElement);
  const next = i === -1 ? (step > 0 ? 0 : buttons.length - 1) : i + step;
  if (next < 0 || next >= buttons.length) { announce(step > 0 ? 'End of list' : 'Start of list'); return true; }
  buttons[next].focus();
  return true;
}

function markAllRead() {
  const list = [...articles.values()].filter((a) => !a.read && (state.feedId === 'all' || a.feedId === state.feedId));
  const now = Date.now();
  for (const a of list) { a.read = true; a.readAt = now; }
  db.putMany('articles', list);
  state.sticky.clear();
  renderList();
  $('list-heading').focus();
  announce(list.length ? `Marked ${plural(list.length, 'article')} read.` : 'Nothing to mark.');
}

// ---------------------------------------------------------------- article view

function fullTextMode(feed) {
  return !feed || feed.fullText === 'default' || !feed.fullText ? settings.fullText : feed.fullText;
}

function needsFullText(a) {
  const mode = fullTextMode(feeds.get(a.feedId));
  if (!a.link || mode === 'never') return false;
  if (mode === 'always') return true;
  return !a.enclosure && wordCount(a.html) < SHORT_TEXT_WORDS;
}

async function loadFullText(a) {
  const res = await getUrl(a.link);
  const out = extractArticle(res.body, res.url);
  a.fullHtml = out.html;
  a.fullFailed = false;
  saveArticle(a);
}

function openArticle(id) {
  const a = articles.get(id);
  if (!a) return;
  state.articleId = id;
  state.showFeedVersion = false;
  if (settings.markOnOpen && !a.read) {
    setRead(a, true);
    state.sticky.add(id);
  }
  renderArticle();
  show('article');
}

async function renderArticle() {
  const a = articles.get(state.articleId);
  if (!a) return;
  const feed = feeds.get(a.feedId);
  $('article-heading').textContent = a.title || 'Untitled';
  $('article-meta').textContent = [feedTitle(feed), a.author, fullDate(a.published)].filter(Boolean).join(', ');
  $('btn-toggle-read').textContent = a.read ? 'Mark unread' : 'Mark read';
  $('btn-open').hidden = !a.link;
  $('btn-share').hidden = !a.link;
  $('btn-toggle-source').hidden = !a.link;
  updatePlayer();

  const content = $('article-content');
  const wantFull = !state.showFeedVersion && (a.fullHtml || (needsFullText(a) && !a.fullFailed));
  $('btn-toggle-source').textContent = wantFull ? 'Show feed version' : 'Show full article';

  if (!wantFull) {
    content.innerHTML = cleanHtml(a.html, a.link || feed?.url) || '<p>This article has no text in the feed.</p>';
    return;
  }
  if (a.fullHtml) { content.innerHTML = a.fullHtml; return; }

  content.replaceChildren(el('p', { textContent: 'Loading the full article…' }));
  try {
    await loadFullText(a);
  } catch (err) {
    a.fullFailed = true;
    if (state.articleId === a.id) {
      content.innerHTML = cleanHtml(a.html, a.link);
      content.prepend(el('p', { textContent: `Couldn't load the full article (${err.message}) Showing the feed text.` }));
      $('btn-toggle-source').textContent = 'Show full article';
      announce("Couldn't load the full article. Showing the feed text.");
    }
    return;
  }
  if (state.articleId === a.id && state.view === 'article') {
    content.innerHTML = a.fullHtml;
    announce('Full article loaded.');
  }
}

// Links in articles open in the system browser, never inside the app.
$('article-content').addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  e.preventDefault();
  native.openExternal(link.href);
});

function stepArticle(step) {
  const i = state.listOrder.indexOf(state.articleId);
  const next = state.listOrder[i + step];
  if (!next) { announce(step > 0 ? 'No more articles in this list.' : 'This is the first article.'); return; }
  openArticle(next);
}

function backFromArticle() {
  renderList();
  show('list', $('article-list').querySelector(`[data-article-id="${CSS.escape(state.articleId)}"]`));
}

function toggleArticleRead(a) {
  setRead(a, !a.read);
  if (!a.read) state.sticky.add(a.id);
  if (state.view === 'article') $('btn-toggle-read').textContent = a.read ? 'Mark unread' : 'Mark read';
  announce(a.read ? 'Marked read.' : 'Marked unread.');
}

function currentArticle() {
  if (state.view === 'article') return articles.get(state.articleId);
  if (state.view === 'list') return articles.get(document.activeElement?.dataset?.articleId);
  return null;
}

// ---------------------------------------------------------------- podcast player

function updatePlayer() {
  const a = articles.get(state.articleId);
  const section = $('player');
  if (!a?.enclosure) { section.hidden = true; return; }
  section.hidden = false;
  const isThis = player.playingArticle()?.id === a.id;
  $('pl-toggle').textContent = isThis && player.isPlaying() ? 'Pause' : 'Play';
  $('pl-speed').textContent = `Speed ${isThis ? player.speed() : settings.speed} times`;
  const range = $('pl-pos');
  const dur = isThis ? player.duration() : (a.enclosure.duration || 0);
  const pos = isThis ? player.position() : (a.position || 0);
  // Don't move the slider while it has focus, or the screen reader would keep reading it.
  if (document.activeElement !== range) {
    range.max = String(Math.floor(dur));
    range.step = '15';
    range.value = String(Math.floor(pos));
    range.setAttribute('aria-valuetext', dur ? `${player.spokenTime(pos)} of ${player.spokenTime(dur)}` : player.spokenTime(pos));
  }
}

function renderNowPlaying() {
  const a = player.playingArticle();
  $('now-playing').hidden = !a;
  if (!a) return;
  $('now-playing-title').textContent = `${a.title} (${feedTitle(feeds.get(a.feedId))})`;
  $('np-toggle').textContent = player.isPlaying() ? 'Pause' : 'Play';
}

async function togglePlay(article) {
  const a = article || player.playingArticle();
  if (!a?.enclosure) { announce('Nothing to play.'); return; }
  if (player.playingArticle()?.id !== a.id) player.load(a, settings.speed);
  const playing = await player.toggle();
  announce(playing ? 'Playing.' : 'Paused.');
}

// Earbud, headset, lock screen and notification buttons.
function syncMedia() {
  const a = player.playingArticle();
  if (!a) return;
  const info = {
    title: a.title || 'Untitled',
    artist: feedTitle(feeds.get(a.feedId)),
    playing: player.isPlaying(),
    stopped: false,
    position: Math.floor(player.position() * 1000),
    duration: Math.floor(player.duration() * 1000),
    speed: player.speed(),
  };
  native.mediaUpdate(info);
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: info.title, artist: info.artist });
      navigator.mediaSession.playbackState = info.playing ? 'playing' : 'paused';
    } catch { /* not supported here */ }
  }
}

function mediaButton(action, value) {
  const a = player.playingArticle();
  if (!a) return;
  if (action === 'play' && !player.isPlaying()) player.toggle();
  else if (action === 'pause' && player.isPlaying()) player.toggle();
  else if (action === 'forward') player.skip(30);
  else if (action === 'back') player.skip(-15);
  else if (action === 'seek' && value >= 0) { player.seek(value / 1000); syncMedia(); }
}
window.__strayMedia = mediaButton;

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => mediaButton('play'),
    pause: () => mediaButton('pause'),
    seekforward: () => mediaButton('forward'),
    seekbackward: () => mediaButton('back'),
    nexttrack: () => mediaButton('forward'),
    previoustrack: () => mediaButton('back'),
    seekto: (d) => mediaButton('seek', Math.floor((d.seekTime || 0) * 1000)),
  };
  for (const [name, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* unsupported action */ }
  }
}

player.setHandlers({
  change(err) {
    if (err) announce("Couldn't play this episode.");
    syncMedia();
    if (state.view === 'article') updatePlayer();
    if (state.view === 'feeds') renderNowPlaying();
  },
  position(article, seconds) {
    const a = articles.get(article.id);
    if (a) { a.position = seconds; saveArticle(a); }
  },
});
setInterval(() => { if (state.view === 'article' && player.isPlaying()) updatePlayer(); }, 5000);

$('pl-toggle').addEventListener('click', () => togglePlay(articles.get(state.articleId)));
$('pl-back').addEventListener('click', () => { ensureLoaded(); player.skip(-15); announce('Back 15 seconds.'); });
$('pl-fwd').addEventListener('click', () => { ensureLoaded(); player.skip(30); announce('Forward 30 seconds.'); });
$('pl-speed').addEventListener('click', () => { ensureLoaded(); announce(`Speed ${player.cycleSpeed()} times.`); });
$('pl-pos').addEventListener('change', (e) => {
  ensureLoaded();
  const v = Number(e.target.value);
  player.seek(v);
  e.target.setAttribute('aria-valuetext', `${player.spokenTime(v)} of ${player.spokenTime(player.duration() || Number(e.target.max))}`);
});
$('np-toggle').addEventListener('click', () => togglePlay());
$('np-goto').addEventListener('click', () => {
  const a = player.playingArticle();
  if (!a) return;
  state.feedId = a.feedId;
  state.sticky.clear();
  state.sticky.add(a.id);
  renderList();
  openArticle(a.id);
});
function ensureLoaded() {
  const a = articles.get(state.articleId);
  if (a?.enclosure && player.playingArticle()?.id !== a.id) player.load(a, settings.speed);
}

// ---------------------------------------------------------------- refreshing

function mergeItems(feed, parsed) {
  const now = Date.now();
  const firstFetch = !feed.lastFetched;
  const added = [];
  const changed = [];
  // Articles seen in the last fetch. Old read articles get cleared out after a
  // while; this stops them coming back as new while the feed still lists them.
  const seenBefore = new Set(feed.seen || []);
  const seenNow = [];
  for (const item of parsed.items) {
    const guid = item.guid || item.link || item.title;
    if (!guid) continue;
    seenNow.push(guid);
    const id = feed.id + '|' + guid;
    const existing = articles.get(id);
    if (!existing && seenBefore.has(guid)) continue;
    if (existing) {
      if (existing.title !== item.title || existing.html !== item.html) {
        Object.assign(existing, { title: item.title, html: item.html, link: item.link, enclosure: existing.enclosure || item.enclosure });
        changed.push(existing);
      }
      continue;
    }
    const a = {
      id, feedId: feed.id, guid,
      title: item.title, link: item.link, author: item.author,
      published: item.published || now, added: now,
      html: item.html, enclosure: item.enclosure, read: false,
    };
    articles.set(id, a);
    added.push(a);
  }
  db.putMany('articles', [...added, ...changed]);
  feed.seen = seenNow;
  if (!feed.customTitle && parsed.title) feed.title = parsed.title;
  if (parsed.siteUrl) feed.siteUrl = parsed.siteUrl;
  feed.lastFetched = now;
  feed.lastError = null;
  return firstFetch ? 0 : added.length;
}

async function refreshFeed(feed) {
  try {
    const res = await getUrl(feed.url);
    const parsed = parseFeed(res.body, res.url);
    return mergeItems(feed, parsed);
  } catch (err) {
    feed.lastError = err instanceof NotAFeedError ? 'The address is a web page, not a feed.' : (err.message || String(err));
    return 0;
  } finally {
    saveFeed(feed);
  }
}

function pruneOld() {
  const cutoff = Date.now() - settings.keepDays * 86400000;
  const doomed = [];
  for (const a of articles.values()) {
    if (a.read && (a.readAt || a.added) < cutoff && player.playingArticle()?.id !== a.id) doomed.push(a.id);
  }
  for (const id of doomed) articles.delete(id);
  db.deleteMany('articles', doomed);
}

async function refresh(feedList, { auto = false } = {}) {
  if (state.refreshing) { if (!auto) announce('Already refreshing.'); return; }
  if (!feedList.length) { if (!auto) announce('No feeds to refresh.'); return; }
  state.refreshing = true;
  if (!auto) announce(`Refreshing ${plural(feedList.length, 'feed')}…`);
  const newByFeed = new Map();
  const queue = [...feedList];
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      const n = await refreshFeed(f);
      if (n) newByFeed.set(f, n);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(4, feedList.length) }, worker));
  } finally {
    state.refreshing = false;
  }
  if (feedList.length === feeds.size) db.setKV('lastRefreshAll', Date.now());
  pruneOld();

  const total = [...newByFeed.values()].reduce((s, n) => s + n, 0);
  const failed = feedList.filter((f) => f.lastError).length;
  let msg = total ? `${plural(total, 'new article')}.` : 'No new articles.';
  if (failed) msg += ` ${plural(failed, 'feed')} couldn't be refreshed.`;
  if (!auto || total) announce(auto ? msg : 'Refreshed. ' + msg);

  if (state.view === 'feeds') renderFeeds();
  if (state.view === 'list' && !auto) renderList(document.activeElement?.dataset?.articleId);

  scheduleBackgroundSync();
  // On Android the background checker posts the notifications (one per article).
  if (!native.isAndroid && settings.notify && total && (document.hidden || !document.hasFocus())) {
    const top = [...newByFeed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([f, n]) => `${feedTitle(f)} (${n})`).join(', ');
    native.notify(`${plural(total, 'new article')}`, top);
  }
}

const refreshAll = (opts) => refresh([...feeds.values()], opts);
const refreshCurrent = () => (state.view === 'list' && state.feedId !== 'all'
  ? refresh([feeds.get(state.feedId)]) : refreshAll());

// Automatic refreshing. Checked every minute and whenever the app comes back to the front.
async function refreshIfDue() {
  if (!settings.interval || !feeds.size) return;
  const last = (await db.getKV('lastRefreshAll')) || 0;
  if (Date.now() - last >= settings.interval * 60000) refreshAll({ auto: true });
}
setInterval(refreshIfDue, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfDue(); });

// ---------------------------------------------------------------- adding feeds

async function findFeed(url) {
  const res = await getUrl(url);
  try {
    return [{ url: res.url, parsed: parseFeed(res.body, res.url) }];
  } catch (err) {
    if (!(err instanceof NotAFeedError)) throw err;
    const found = discoverFeeds(err.html, res.url);
    if (found.length) return found;
    // The page doesn't advertise a feed. Try the usual places.
    const origin = new URL(res.url).origin;
    for (const path of COMMON_FEED_PATHS) {
      try {
        const r = await getUrl(origin + path);
        return [{ url: r.url, parsed: parseFeed(r.body, r.url) }];
      } catch { /* try the next one */ }
    }
    throw new Error("Couldn't find a feed on that page.");
  }
}

async function subscribe(url, folder, parsed, { stay = false, title = '' } = {}) {
  const existing = [...feeds.values()].find((f) => f.url === url);
  if (existing) { announce(`You already follow ${feedTitle(existing)}.`); return; }
  const feed = { id: newId(), url, title, folder: folder.trim(), fullText: 'default', customTitle: false, lastFetched: null, lastError: null };
  feeds.set(feed.id, feed);
  if (parsed) { mergeItems(feed, parsed); saveFeed(feed); } else await refreshFeed(feed);
  scheduleBackgroundSync();
  const count = [...articles.values()].filter((a) => a.feedId === feed.id).length;
  if (stay) {
    announce(feed.lastError
      ? `Added ${feedTitle(feed)}, but it couldn't be read right now: ${feed.lastError}`
      : `Added ${feedTitle(feed)}, ${plural(count, 'article')}.`);
    return feed;
  }
  $('add-form').reset();
  $('add-choices').hidden = true;
  renderFeeds();
  show('feeds', $('feed-groups').querySelector(`[data-feed-id="${feed.id}"]`));
  announce(feed.lastError
    ? `Added ${feedTitle(feed)}, but it couldn't be read: ${feed.lastError}`
    : `Added ${feedTitle(feed)}, ${plural(count, 'article')}.`);
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = normalizeUrl($('add-url').value);
  const folder = $('add-folder').value;
  if (!url) return;
  announce('Checking the address…');
  $('add-choices').hidden = true;
  try {
    const found = await findFeed(url);
    if (found.length === 1) {
      await subscribe(found[0].url, folder, found[0].parsed);
    } else {
      $('add-choice-list').replaceChildren(...found.map((f) => {
        const b = el('button', { type: 'button', textContent: f.title });
        b.dataset.url = f.url;
        return el('li', {}, b);
      }));
      $('add-choices').hidden = false;
      $('add-choices-heading').focus();
    }
  } catch (err) {
    announce(err.message || String(err));
  }
});
$('add-choice-list').addEventListener('click', (e) => {
  const url = e.target.closest('button')?.dataset.url;
  if (url) { announce('Adding…'); subscribe(url, $('add-folder').value); }
});

// ---------------------------------------------------------------- feed settings

let unsubscribeArmed = null;
function openFeedEdit() {
  const f = feeds.get(state.feedId);
  if (!f) return;
  $('edit-title').value = feedTitle(f);
  $('edit-folder').value = f.folder || '';
  $('edit-fulltext').value = f.fullText || 'default';
  $('edit-url').textContent = f.url;
  $('edit-error').textContent = f.lastError ? `Last refresh failed: ${f.lastError}` : '';
  $('btn-unsubscribe').textContent = 'Unsubscribe';
  show('feed-edit');
}

$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = feeds.get(state.feedId);
  const title = $('edit-title').value.trim();
  if (title && title !== f.title) { f.title = title; f.customTitle = true; }
  f.folder = $('edit-folder').value.trim();
  f.fullText = $('edit-fulltext').value;
  saveFeed(f);
  renderList();
  show('list');
  announce('Saved.');
});

$('btn-unsubscribe').addEventListener('click', () => {
  const f = feeds.get(state.feedId);
  if (unsubscribeArmed !== f.id) {
    unsubscribeArmed = f.id;
    $('btn-unsubscribe').textContent = 'Press again to unsubscribe';
    announce(`Press again to unsubscribe from ${feedTitle(f)}.`);
    setTimeout(() => { unsubscribeArmed = null; $('btn-unsubscribe').textContent = 'Unsubscribe'; }, 6000);
    return;
  }
  unsubscribeArmed = null;
  const ids = [...articles.values()].filter((a) => a.feedId === f.id).map((a) => a.id);
  for (const id of ids) articles.delete(id);
  db.deleteMany('articles', ids);
  db.deleteMany('feeds', [f.id]);
  feeds.delete(f.id);
  scheduleBackgroundSync();
  renderFeeds();
  show('feeds');
  announce(`Unsubscribed from ${feedTitle(f)}.`);
});

// ---------------------------------------------------------------- settings and OPML

function renderSettings() {
  const home = $('set-home');
  home.replaceChildren(
    el('option', { value: 'all', textContent: 'All articles' }),
    el('option', { value: 'feeds', textContent: 'Feeds list' }),
    ...[...feeds.values()].sort((a, b) => feedTitle(a).localeCompare(feedTitle(b)))
      .map((f) => el('option', { value: f.id, textContent: feedTitle(f) })));
  home.value = settings.home === 'feeds' || settings.home === 'all' || feeds.has(settings.home) ? settings.home : 'all';
  $('set-interval').value = String(settings.interval);
  $('set-refresh-start').checked = settings.refreshOnStart;
  $('set-notify').checked = settings.notify;
  $('set-fulltext').value = settings.fullText;
  $('set-mark-on-open').checked = settings.markOnOpen;
  $('set-sort').value = settings.sort;
  $('set-keep').value = String(settings.keepDays);
  $('set-speed').value = String(settings.speed);
  $('set-tray').checked = settings.closeToTray;
  $('set-autostart').checked = settings.startWithWindows;
  $('windows-settings').hidden = !native.isNative || native.isAndroid;
  $('notify-help').textContent = native.isAndroid
    ? 'Checks happen in the background even when the app is closed, using the schedule above (at least every 15 minutes). Each new article gets its own notification; tap one to open that article.'
    : 'Notifications come while the app is open or running in the notification area.';
}

const bind = (id, key, read) => $(id).addEventListener('change', (e) => {
  settings[key] = read(e.target);
  saveSettings();
});
bind('set-interval', 'interval', (t) => Number(t.value));
$('set-interval').addEventListener('change', () => scheduleBackgroundSync());
async function applyDesktopOptions() {
  try { await native.setDesktopOptions(settings.closeToTray, settings.startWithWindows); }
  catch (err) { announce(`Couldn't change that Windows setting: ${err.message || err}`); }
}
$('set-tray').addEventListener('change', (e) => { settings.closeToTray = e.target.checked; saveSettings(); applyDesktopOptions(); });
$('set-autostart').addEventListener('change', (e) => { settings.startWithWindows = e.target.checked; saveSettings(); applyDesktopOptions(); });
bind('set-refresh-start', 'refreshOnStart', (t) => t.checked);
bind('set-fulltext', 'fullText', (t) => t.value);
bind('set-mark-on-open', 'markOnOpen', (t) => t.checked);
bind('set-sort', 'sort', (t) => t.value);
bind('set-keep', 'keepDays', (t) => Number(t.value));
bind('set-speed', 'speed', (t) => Number(t.value));
bind('set-home', 'home', (t) => t.value);
$('set-notify').addEventListener('change', async (e) => {
  if (e.target.checked && !(await native.notificationsAllowed())) {
    e.target.checked = false;
    announce('Notifications are turned off for this app in your system settings.');
  }
  settings.notify = e.target.checked;
  saveSettings();
  scheduleBackgroundSync();
});

async function importOpml(text) {
  let list;
  try { list = parseOpml(text); } catch (err) { announce(err.message); return; }
  const known = new Set([...feeds.values()].map((f) => f.url));
  const fresh = [];
  for (const item of list) {
    if (!item.url || known.has(item.url)) continue;
    known.add(item.url);
    const f = { id: newId(), url: item.url, title: item.title, folder: item.folder, fullText: 'default', customTitle: !!item.title, lastFetched: null, lastError: null };
    feeds.set(f.id, f);
    fresh.push(f);
  }
  await db.putMany('feeds', fresh);
  const skipped = list.length - fresh.length;
  announce(`Imported ${plural(fresh.length, 'feed')}${skipped ? `, ${skipped} already there` : ''}. Fetching articles…`);
  renderFeeds();
  if (fresh.length) setTimeout(() => refresh(fresh), 1500);
}

// A file can be OPML (from another feed reader) or plain text with one address per line.
async function importFeedsText(text) {
  if (/<opml[\s>]/i.test(text)) return importOpml(text);
  const urls = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(https?|feed):\/\/\S+$/i.test(l)).map(normalizeUrl);
  if (!urls.length) { announce("That file doesn't contain any feed addresses or OPML."); return; }
  const outlines = urls.map((u) => `<outline type="rss" text="" xmlUrl="${u.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"/>`).join('');
  return importOpml(`<opml version="2.0"><body>${outlines}</body></opml>`);
}

async function importFromFile() {
  let text;
  try { text = await native.pickTextFile(); } catch (err) { announce(`Couldn't open the file: ${err.message || err}`); return; }
  if (text == null) return;
  await importFeedsText(text);
}
$('btn-import-file').addEventListener('click', importFromFile);
$('btn-import-file-feeds').addEventListener('click', importFromFile);
$('btn-opml-import').addEventListener('click', () => {
  const text = $('opml-text').value.trim();
  if (!text) { announce('Paste OPML text or feed addresses into the box first.'); $('opml-text').focus(); return; }
  importFeedsText(text);
  $('opml-text').value = '';
});
$('btn-opml-save').addEventListener('click', async () => {
  try {
    const path = await native.saveTextFile('straycat-rss-subscriptions.opml', buildOpml([...feeds.values()]));
    announce(`Saved to ${path}`);
  } catch (err) {
    announce(`Couldn't save the file (${err.message || err}). Try Copy export to clipboard instead.`);
  }
});
$('btn-opml-copy').addEventListener('click', async () => {
  const opml = buildOpml([...feeds.values()]);
  try {
    await navigator.clipboard.writeText(opml);
    announce(`Copied ${plural(feeds.size, 'feed')} to the clipboard.`);
  } catch {
    $('opml-text').value = opml;
    $('opml-text').focus();
    $('opml-text').select();
    announce("Couldn't reach the clipboard. The export is in the text box, selected, so you can copy it.");
  }
});

// ---------------------------------------------------------------- keyboard shortcuts

const SHORTCUTS = [
  { key: 'j', label: 'J', desc: 'Next article', run: () => (state.view === 'article' ? stepArticle(1) : state.view === 'list' && moveListFocus(1)) },
  { key: 'k', label: 'K', desc: 'Previous article', run: () => (state.view === 'article' ? stepArticle(-1) : state.view === 'list' && moveListFocus(-1)) },
  { key: 'r', label: 'R', desc: 'Refresh this feed, or all feeds', run: () => refreshCurrent() },
  { key: 'm', label: 'M', desc: 'Mark the current article read or unread', run: () => { const a = currentArticle(); if (a) { toggleArticleRead(a); if (state.view === 'list') renderList(a.id); } } },
  { key: 'A', label: 'Shift+A', desc: 'Mark all articles in this list read', run: () => state.view === 'list' && markAllRead() },
  { key: 'o', label: 'O', desc: 'Open the current article in your browser', run: () => { const a = currentArticle(); if (a?.link) native.openExternal(a.link); } },
  { key: 'u', label: 'U, or Alt+Left Arrow', desc: 'Go back', run: () => goBack() },
  { key: 'f', label: 'F', desc: 'Go to the feeds list', run: () => { renderFeeds(); show('feeds'); } },
  { key: 'p', label: 'P', desc: 'Play or pause the podcast', run: () => togglePlay(state.view === 'article' && articles.get(state.articleId)?.enclosure ? articles.get(state.articleId) : null) },
  { key: ',', label: 'Comma', desc: 'Podcast back 15 seconds', run: () => { if (player.playingArticle()) { player.skip(-15); announce('Back 15 seconds.'); } } },
  { key: '.', label: 'Period', desc: 'Podcast forward 30 seconds', run: () => { if (player.playingArticle()) { player.skip(30); announce('Forward 30 seconds.'); } } },
  { key: '?', label: 'Question mark', desc: 'Show this list of shortcuts', run: () => { openSettings(); $('shortcuts-heading').focus(); } },
];

$('shortcut-list').replaceChildren(...SHORTCUTS.map((s) => el('li', { textContent: `${s.label}: ${s.desc}` })));

function goBack() {
  switch (state.view) {
    case 'article': backFromArticle(); break;
    case 'list': renderFeeds(); show('feeds', $('feed-groups').querySelector(`[data-feed-id="${CSS.escape(state.feedId)}"]`)); break;
    case 'feed-edit': show('list'); break;
    case 'add':
    case 'catalog':
    case 'settings': renderFeeds(); show('feeds'); break;
    default: break;
  }
}

const CODE_KEYS = { Comma: ',', Period: '.', Slash: '/' };
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) return;
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
  const inField = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (inField && !e.altKey) return;
  // Use the physical key so Alt combinations work the same on any keyboard layout.
  let key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : CODE_KEYS[e.code];
  if (!key) return;
  if (e.shiftKey) key = key === '/' ? '?' : key.toUpperCase();
  const s = SHORTCUTS.find((x) => x.key === key);
  if (!s) return;
  e.preventDefault();
  s.run();
});

// ---------------------------------------------------------------- buttons

function openSettings() {
  if (state.view !== 'settings') state.returnTo = state.view;
  renderSettings();
  show('settings');
}

$('btn-refresh-all').addEventListener('click', () => refreshAll());
$('btn-add-feed').addEventListener('click', () => { $('add-choices').hidden = true; show('add', $('add-url')); });
$('btn-add-cancel').addEventListener('click', () => { $('add-form').reset(); show('feeds'); });
$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-back').addEventListener('click', () => { renderFeeds(); show('feeds'); });
$('btn-list-back').addEventListener('click', goBack);
$('btn-list-refresh').addEventListener('click', refreshCurrent);
$('btn-mark-all').addEventListener('click', markAllRead);
$('btn-toggle-unread').addEventListener('click', () => {
  state.unreadOnly = !state.unreadOnly;
  renderList();
  announce(state.unreadOnly ? 'Showing unread articles only.' : 'Showing all articles.');
});
$('btn-feed-settings').addEventListener('click', openFeedEdit);
$('btn-edit-cancel').addEventListener('click', () => show('list'));
$('btn-article-back').addEventListener('click', backFromArticle);
$('btn-prev').addEventListener('click', () => stepArticle(-1));
$('btn-next').addEventListener('click', () => stepArticle(1));
$('btn-open').addEventListener('click', () => { const a = articles.get(state.articleId); if (a?.link) native.openExternal(a.link); });
$('btn-share').addEventListener('click', () => shareArticle(articles.get(state.articleId)));
$('btn-toggle-read').addEventListener('click', () => toggleArticleRead(articles.get(state.articleId)));
$('btn-toggle-source').addEventListener('click', async () => {
  const a = articles.get(state.articleId);
  const showingFull = $('btn-toggle-source').textContent === 'Show feed version';
  state.showFeedVersion = showingFull;
  if (!showingFull) a.fullFailed = false;   // asking for the full article again retries it
  await renderArticle();
  if (state.showFeedVersion) announce('Showing the feed version.');
  else if (a.fullHtml) announce('Showing the full article.');
});

// ---------------------------------------------------------------- article actions (long press)

async function shareArticle(a) {
  if (!a?.link) { announce('This article has no link to share.'); return; }
  const result = await native.share(a.title || '', a.link);
  if (result === 'copied') announce('Link copied to the clipboard.');
  else if (result === 'failed') announce("Couldn't share this article.");
}

function hideArticle(a) {
  a.hidden = true;
  setRead(a, true);
  saveArticle(a);
  state.sticky.delete(a.id);
  announce('Hidden.');
}

const dialog = $('actions-dialog');
let dialogArticleId = null;

function openActions(articleId) {
  const a = articles.get(articleId);
  if (!a || dialog.open) return;
  dialogArticleId = articleId;
  $('actions-title').textContent = a.title || 'Untitled';
  dialog.querySelector('[data-action="read"]').textContent = a.read ? 'Mark unread' : 'Mark read';
  dialog.querySelector('[data-action="share"]').hidden = !a.link;
  dialog.querySelector('[data-action="browser"]').hidden = !a.link;
  dialog.showModal();
  dialog.querySelector('[data-action="open"]').focus();
}

function closeActions(focusId) {
  dialog.close();
  const target = focusId && $('article-list').querySelector(`[data-article-id="${CSS.escape(focusId)}"]`);
  (target || $('list-heading')).focus();
}

dialog.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  const a = articles.get(dialogArticleId);
  if (!a) { closeActions(); return; }
  switch (action) {
    case 'open': dialog.close(); openArticle(a.id); return;
    case 'read':
      setRead(a, !a.read);
      state.sticky.add(a.id);
      renderList();
      closeActions(a.id);
      announce(a.read ? 'Marked read.' : 'Marked unread.');
      return;
    case 'share': closeActions(a.id); shareArticle(a); return;
    case 'hide': {
      // Focus moves to the next article, since this one disappears.
      const i = state.listOrder.indexOf(a.id);
      hideArticle(a);
      renderList();
      closeActions(state.listOrder[i] || state.listOrder[i - 1]);
      return;
    }
    case 'browser': closeActions(a.id); if (a.link) native.openExternal(a.link); return;
    default: closeActions(a.id);
  }
});
// Escape closes the dialog; put focus back on the article it was opened from.
dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeActions(dialogArticleId); });

// Long press on Android (also double-tap-and-hold with TalkBack), and the
// context menu key or Shift+F10 on Windows, open the actions menu.
let suppressClick = false;
$('article-list').addEventListener('contextmenu', (e) => {
  const id = e.target.closest('button')?.dataset.articleId;
  if (!id) return;
  e.preventDefault();
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 700);
  openActions(id);
});
// Backup timer, for WebViews that don't send contextmenu on a long touch.
let pressTimer = null;
$('article-list').addEventListener('touchstart', (e) => {
  const id = e.target.closest('button')?.dataset.articleId;
  if (!id) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 700); openActions(id); }, 600);
}, { passive: true });
for (const ev of ['touchend', 'touchmove', 'touchcancel']) {
  $('article-list').addEventListener(ev, () => clearTimeout(pressTimer), { passive: true });
}
$('article-list').addEventListener('click', (e) => {
  if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);

// ---------------------------------------------------------------- popular feeds

function renderCatalog() {
  const filter = $('catalog-filter').value.trim().toLowerCase();
  const subscribed = new Set([...feeds.values()].map((f) => f.url));
  const groups = [];
  for (const group of CATALOG) {
    const matches = group.feeds.filter((f) => !filter
      || `${f.name} ${f.desc || ''} ${group.category}`.toLowerCase().includes(filter));
    if (!matches.length) continue;
    groups.push(el('h2', { textContent: group.category }));
    groups.push(el('ul', { className: 'item-list' }, ...matches.map((f) => {
      const added = subscribed.has(f.url);
      const b = el('button', { type: 'button' },
        added ? `${f.name}, added` : `Add ${f.name}`,
        ...(f.desc ? [el('span', { className: 'visually-hidden', textContent: ', ' }),
          el('span', { className: 'catalog-desc', textContent: f.desc })] : []));
      if (added) b.setAttribute('aria-disabled', 'true');
      Object.assign(b.dataset, { url: f.url, name: f.name, folder: group.category });
      return el('li', {}, b);
    })));
  }
  if (!groups.length) groups.push(el('p', { textContent: 'No feeds match that filter.' }));
  $('catalog-groups').replaceChildren(...groups);
}

$('catalog-filter').addEventListener('input', renderCatalog);
$('catalog-groups').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.getAttribute('aria-disabled') === 'true') { announce(`${b.dataset.name} is already in your feeds.`); return; }
  b.setAttribute('aria-disabled', 'true');
  announce(`Adding ${b.dataset.name}…`);
  await subscribe(b.dataset.url, b.dataset.folder, null, { stay: true, title: b.dataset.name });
  // Rebuild the list, keeping focus on the same button (now labelled "added").
  renderCatalog();
  $('catalog-groups').querySelector(`[data-url="${CSS.escape(b.dataset.url)}"]`)?.focus();
});

function openCatalog() {
  $('catalog-filter').value = '';
  renderCatalog();
  show('catalog');
}
$('btn-catalog').addEventListener('click', openCatalog);
$('btn-add-catalog').addEventListener('click', openCatalog);
$('btn-catalog-back').addEventListener('click', goBack);

// ---------------------------------------------------------------- Android back button

// Android's back button or gesture is handled natively (StrayPlugin.kt) and
// sent here. It goes back one screen and never closes the app.
window.__strayBack = () => {
  if (dialog.open) { closeActions(dialogArticleId); return; }
  if (state.view === 'feeds') { announce('Feeds list. This is the first screen.'); return; }
  goBack();
};

// ---------------------------------------------------------------- background checks and notification taps

// Android checks feeds in the background (FeedCheckWorker.kt). It needs the
// feed list, and what the app already has so it only reports new articles.
let syncTimer = null;
function scheduleBackgroundSync() {
  if (!native.isAndroid) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const known = new Map();
    for (const a of articles.values()) {
      if (!known.has(a.feedId)) known.set(a.feedId, new Set());
      const k = known.get(a.feedId);
      for (const v of [a.guid, a.link, a.title]) if (v) k.add(v);
    }
    const list = [...feeds.values()].map((f) => {
      const k = known.get(f.id) || new Set();
      for (const g of f.seen || []) if (g) k.add(g);
      return { id: f.id, url: f.url, title: feedTitle(f), known: [...k] };
    });
    const enabled = settings.notify && settings.interval > 0;
    native.backgroundSync({ enabled, interval: settings.interval, json: JSON.stringify({ enabled, feeds: list }) });
  }, 1500);
}

function waitForRefresh() {
  return new Promise((resolve) => {
    const check = () => (state.refreshing ? setTimeout(check, 300) : resolve());
    check();
  });
}

function findArticle({ id, link, title }) {
  if (articles.has(id)) return articles.get(id);
  const feedId = id.split('|')[0];
  return [...articles.values()].find((a) => a.feedId === feedId && ((link && a.link === link) || (title && a.title === title)));
}

// Tapping a new-article notification lands here.
async function openFromNotification(info) {
  if (!info?.id) return;
  await waitForRefresh();
  let a = findArticle(info);
  const feed = feeds.get(info.id.split('|')[0]);
  if (!a && feed) {
    announce('Loading the article…');
    await refresh([feed], { auto: true });
    a = findArticle(info);
  }
  if (!a) {
    announce("Couldn't find that article any more.");
    if (feed) openList(feed.id);
    return;
  }
  state.feedId = a.feedId;
  state.sticky.clear();
  state.sticky.add(a.id);
  renderList();
  openArticle(a.id);
}
window.__strayOpenArticle = openFromNotification;
window.__strayTrayRefresh = () => refreshAll();

// ---------------------------------------------------------------- start

async function start() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...((await db.getKV('settings')) || {}) };
    for (const f of await db.getAll('feeds')) feeds.set(f.id, f);
    for (const a of await db.getAll('articles')) articles.set(a.id, a);
  } catch (err) {
    announce(`Couldn't open saved data: ${err.message || err}`);
  }
  const v = await native.appVersion();
  if (v) $('app-version').textContent = v;
  renderFeeds();
  if (feeds.size && settings.home !== 'feeds' && (settings.home === 'all' || feeds.has(settings.home))) openList(settings.home);
  else show('feeds');
  native.setDesktopOptions(settings.closeToTray, settings.startWithWindows).catch(() => {});
  scheduleBackgroundSync();
  const pending = await native.takePendingArticle();
  if (pending) openFromNotification(pending);
  else if (settings.refreshOnStart && feeds.size) refreshAll({ auto: true });
}

start();
