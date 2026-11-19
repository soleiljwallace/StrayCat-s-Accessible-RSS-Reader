// Checks every feed in the Popular feeds list. Broken ones show up as
// warnings on the build, without stopping it.
import { CATALOG } from '../../src/js/catalog.js';

const UA = 'Mozilla/5.0 (compatible; StrayCatRSS-catalog-check; +https://github.com/soleiljwallace/StrayCat-s-Accessible-RSS-Reader)';
const all = CATALOG.flatMap((c) => c.feeds.map((f) => ({ ...f, category: c.category })));
let bad = 0;

await Promise.all(all.map(async (f) => {
  let problem = '';
  try {
    const res = await fetch(f.url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    if (!res.ok) problem = `HTTP ${res.status}`;
    else if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 5000))) problem = 'not a feed';
    else if (res.url !== f.url) console.log(`moved: ${f.name}: ${f.url} -> ${res.url}`);
  } catch (e) {
    problem = e.name === 'TimeoutError' ? 'timed out' : e.message;
  }
  if (problem) {
    bad++;
    // Some sites turn away cloud servers like GitHub's but work fine from a phone or PC.
    if (/HTTP (403|419|429)|timed out/.test(problem)) { console.log(`::notice title=Catalog feed blocked GitHub::${f.category} / ${f.name} (${f.url}): ${problem}`); return; }
    console.log(`::warning title=Catalog feed broken::${f.category} / ${f.name} (${f.url}): ${problem}`);
  }
}));
console.log(`${all.length - bad} of ${all.length} catalog feeds OK.`);
