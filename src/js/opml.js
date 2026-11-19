// OPML import and export, for moving subscriptions between devices and apps.

export function parseOpml(text) {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, '').trim(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'opml') {
    throw new Error('That is not an OPML file.');
  }
  const feeds = [];
  for (const o of doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]')) {
    const url = o.getAttribute('xmlUrl') || o.getAttribute('xmlurl');
    const parent = o.parentElement;
    const folder = parent && parent.localName === 'outline' && !parent.getAttribute('xmlUrl')
      ? (parent.getAttribute('title') || parent.getAttribute('text') || '') : '';
    feeds.push({ url, title: o.getAttribute('title') || o.getAttribute('text') || '', folder });
  }
  return feeds;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildOpml(feeds) {
  const line = (f, indent) =>
    `${indent}<outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" xmlUrl="${esc(f.url)}"${f.siteUrl ? ` htmlUrl="${esc(f.siteUrl)}"` : ''}/>`;
  const folders = new Map();
  const loose = [];
  for (const f of feeds) {
    if (f.folder) {
      if (!folders.has(f.folder)) folders.set(f.folder, []);
      folders.get(f.folder).push(f);
    } else loose.push(f);
  }
  const body = [];
  for (const [name, list] of folders) {
    body.push(`    <outline text="${esc(name)}" title="${esc(name)}">`);
    for (const f of list) body.push(line(f, '      '));
    body.push('    </outline>');
  }
  for (const f of loose) body.push(line(f, '    '));
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>StrayCat's Accessible RSS Reader subscriptions</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${body.join('\n')}
  </body>
</opml>
`;
}
