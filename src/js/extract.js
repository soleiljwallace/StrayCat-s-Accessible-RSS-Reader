// Turning feed HTML and web pages into clean, screen-reader-friendly article text.

const PURIFY_CONFIG = {
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'select', 'textarea',
    'svg', 'math', 'video', 'audio', 'object', 'embed', 'canvas', 'noscript', 'nav', 'aside', 'footer'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope', 'headers', 'lang', 'dir', 'datetime', 'cite'],
};

/** Words of plain text in an HTML fragment. Used to decide if a feed only sends a summary. */
export function wordCount(html) {
  const div = document.createElement('div');
  div.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html || '') : '';
  const t = div.textContent.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Sanitize and tidy HTML for reading:
 * - removes scripts, styles, layout clutter and attributes
 * - drops images with no description (they'd only be read as "graphic")
 * - makes links absolute
 * - shifts headings down so the article's own headings sit under the page's h1
 * - removes empty blocks left behind
 */
export function cleanHtml(html, baseUrl) {
  if (!window.DOMPurify) {
    const p = document.createElement('p');
    p.textContent = new DOMParser().parseFromString(html || '', 'text/html').body.textContent;
    return p.outerHTML;
  }
  // Remove clutter along with its text (DOMPurify alone would keep the text of removed tags).
  // DOMParser documents are inert: nothing in them runs or loads.
  const pre = new DOMParser().parseFromString(html || '', 'text/html');
  for (const el of pre.querySelectorAll('nav, aside, footer, form, iframe, script, style, noscript, svg, math, button, select, video, object, embed, canvas')) el.remove();
  const frag = window.DOMPurify.sanitize(pre.body.innerHTML, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
  const root = document.createElement('div');
  root.appendChild(frag);

  const abs = (v) => { try { return new URL(v, baseUrl).href; } catch { return null; } };

  for (const a of root.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href'));
    if (!href || !/^(https?|mailto):/i.test(href)) a.removeAttribute('href');
    else a.setAttribute('href', href);
  }
  for (const img of root.querySelectorAll('img')) {
    const alt = (img.getAttribute('alt') || '').trim();
    const src = abs(img.getAttribute('src') || '');
    // Tracking pixels and undescribed images add nothing for a screen reader user.
    if (!alt || !src || /^(image|photo|picture|img)$/i.test(alt)) { img.remove(); continue; }
    img.setAttribute('src', src);
    img.setAttribute('loading', 'lazy');
  }
  // Demote headings: h1 -> h2, h2 -> h3 and so on.
  for (const h of Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).reverse()) {
    const level = Math.min(6, Number(h.tagName[1]) + 1);
    const n = document.createElement('h' + level);
    n.append(...h.childNodes);
    h.replaceWith(n);
  }
  // Unwrap figures/spans/divs that only add noise, and drop empty blocks.
  for (const el of root.querySelectorAll('span, font')) el.replaceWith(...el.childNodes);
  for (const el of Array.from(root.querySelectorAll('p, div, section, figure, li, h2, h3, h4, h5, h6')).reverse()) {
    if (!el.textContent.trim() && !el.querySelector('img')) el.remove();
  }
  return root.innerHTML;
}

/** Pull the main article out of a full web page (Mozilla Readability). */
export function extractArticle(pageHtml, url) {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
  // Readability needs a base so relative links resolve.
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  if (window.Readability) {
    const result = new window.Readability(doc, { charThreshold: 300 }).parse();
    if (result?.content && result.textContent.trim().length > 200) {
      return { html: cleanHtml(result.content, url), title: result.title || '', byline: result.byline || '' };
    }
  }
  const main = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  return { html: cleanHtml(main ? main.innerHTML : '', url), title: '', byline: '' };
}
