// Feed parsing: RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed.

export class NotAFeedError extends Error {
  constructor(html) {
    super('That address is a web page, not a feed.');
    this.html = html;
  }
}

const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el) => (el ? el.textContent.trim() : '');

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function resolve(href, base) {
  if (!href) return '';
  try { return new URL(href.trim(), base).href; } catch { return href.trim(); }
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isNaN(t) ? null : t;
}

/** "1:02:03", "62:03" or "3723" to seconds. */
function parseDuration(s) {
  if (!s) return null;
  const parts = s.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function isAudio(type, url) {
  return /^audio\//i.test(type || '') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|$)/i.test(url || '');
}

function atomText(el) {
  if (!el) return '';
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (type === 'xhtml') {
    const div = kid(el, 'div');
    return div ? div.innerHTML : el.innerHTML;
  }
  if (type === 'html' || type === 'text/html') return el.textContent;
  return escapeHtml(el.textContent).replace(/\n/g, '<br>');
}

function rssItem(item, base) {
  const linkEls = kids(item, 'link');
  const link = resolve(linkEls.map(txt).find(Boolean) || linkEls.map((l) => l.getAttribute('href')).find(Boolean), base);
  const guid = txt(kid(item, 'guid')) || item.getAttribute('rdf:about') || link;
  const encoded = kid(item, 'encoded');
  const description = kid(item, 'description');
  let enclosure = null;
  for (const e of kids(item, 'enclosure')) {
    const url = e.getAttribute('url');
    if (isAudio(e.getAttribute('type'), url)) { enclosure = { url: resolve(url, base), type: e.getAttribute('type') || '' }; break; }
  }
  if (!enclosure) {
    for (const m of kids(item, 'content')) {
      const url = m.getAttribute('url');
      if (url && (m.getAttribute('medium') === 'audio' || isAudio(m.getAttribute('type'), url))) {
        enclosure = { url: resolve(url, base), type: m.getAttribute('type') || '' }; break;
      }
    }
  }
  if (enclosure) enclosure.duration = parseDuration(txt(kid(item, 'duration')));
  return {
    guid,
    title: txt(kid(item, 'title')),
    link,
    author: txt(kid(item, 'creator')) || txt(kid(item, 'author')),
    published: parseDate(txt(kid(item, 'pubDate')) || txt(kid(item, 'date'))),
    html: (encoded ? encoded.textContent : '') || (description ? description.textContent : ''),
    enclosure,
  };
}

function atomEntry(entry, base) {
  const links = kids(entry, 'link');
  const alt = links.find((l) => (l.getAttribute('rel') || 'alternate') === 'alternate');
  const encl = links.find((l) => l.getAttribute('rel') === 'enclosure' && isAudio(l.getAttribute('type'), l.getAttribute('href')));
  const link = resolve(alt?.getAttribute('href'), base);
  return {
    guid: txt(kid(entry, 'id')) || link,
    title: txt(kid(entry, 'title')),
    link,
    author: txt(kid(kid(entry, 'author'), 'name')),
    published: parseDate(txt(kid(entry, 'published')) || txt(kid(entry, 'updated'))),
    html: atomText(kid(entry, 'content')) || atomText(kid(entry, 'summary')),
    enclosure: encl ? { url: resolve(encl.getAttribute('href'), base), type: encl.getAttribute('type') || '', duration: null } : null,
  };
}

function parseJsonFeed(text, base) {
  const j = JSON.parse(text);
  if (!j.version || !String(j.version).includes('jsonfeed')) throw new Error('Not a JSON feed');
  return {
    title: j.title || '',
    siteUrl: resolve(j.home_page_url, base),
    items: (j.items || []).map((it) => {
      const att = (it.attachments || []).find((a) => isAudio(a.mime_type, a.url));
      return {
        guid: String(it.id ?? it.url ?? it.title),
        title: it.title || '',
        link: resolve(it.url, base),
        author: it.authors?.[0]?.name || it.author?.name || '',
        published: parseDate(it.date_published || it.date_modified),
        html: it.content_html || (it.content_text ? escapeHtml(it.content_text).replace(/\n/g, '<br>') : '') || it.summary || '',
        enclosure: att ? { url: resolve(att.url, base), type: att.mime_type || '', duration: att.duration_in_seconds || null } : null,
      };
    }),
  };
}

/** Parse feed text. Throws NotAFeedError (with the HTML) if it is a web page. */
export function parseFeed(text, base) {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{')) return parseJsonFeed(trimmed, base);

  const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length || root.localName === 'html') {
    if (/<html[\s>]/i.test(trimmed.slice(0, 2000))) throw new NotAFeedError(trimmed);
    throw new Error('Could not read this feed. It may be broken or not a feed.');
  }

  if (root.localName === 'feed') {
    const alt = kids(root, 'link').find((l) => (l.getAttribute('rel') || 'alternate') === 'alternate');
    return {
      title: txt(kid(root, 'title')),
      siteUrl: resolve(alt?.getAttribute('href'), base),
      items: kids(root, 'entry').map((e) => atomEntry(e, base)),
    };
  }
  if (root.localName === 'rss' || root.localName === 'RDF') {
    const channel = kid(root, 'channel');
    const items = root.localName === 'rss' ? kids(channel, 'item') : kids(root, 'item');
    return {
      title: txt(kid(channel, 'title')),
      siteUrl: resolve(txt(kid(channel, 'link')), base),
      items: items.map((i) => rssItem(i, base)),
    };
  }
  throw new Error('This file is not a feed format the app knows.');
}

/** Find feed links advertised by a web page. */
export function discoverFeeds(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const types = /(rss|atom|feed)\+xml|application\/feed\+json|application\/json/i;
  const seen = new Set();
  const found = [];
  for (const l of doc.querySelectorAll('link[rel~="alternate"][href]')) {
    if (!types.test(l.getAttribute('type') || '')) continue;
    const url = resolve(l.getAttribute('href'), base);
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ url, title: l.getAttribute('title') || url });
  }
  return found;
}

export const COMMON_FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed/'];
