// Popular feeds that can be added with one tap.
// GitHub's build checks every address here and flags any that stop working
// (see .github/scripts/check-catalog.mjs).

export const CATALOG = [
  {
    category: 'News',
    feeds: [
      { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', desc: 'US and world headlines' },
      { name: 'BBC News: Top stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
      { name: 'BBC News: World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { name: 'The Guardian: World', url: 'https://www.theguardian.com/world/rss' },
      { name: 'The Guardian: US', url: 'https://www.theguardian.com/us-news/rss' },
      { name: 'The New York Times: Home page', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
      { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
      { name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
      { name: 'CBC News: Top stories', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
      { name: 'ProPublica', url: 'https://feeds.propublica.org/propublica/main', desc: 'Investigative journalism' },
      { name: 'The Conversation (US)', url: 'https://theconversation.com/us/articles.atom', desc: 'Academics writing for the public' },
    ],
  },
  {
    category: 'Seattle and Washington',
    feeds: [
      { name: 'The Seattle Times', url: 'https://www.seattletimes.com/feed/' },
      { name: 'GeekWire', url: 'https://www.geekwire.com/feed/', desc: 'Pacific Northwest tech and business' },
      { name: 'PubliCola', url: 'https://publicola.com/feed/', desc: 'Seattle politics' },
      { name: 'The Stranger', url: 'https://www.thestranger.com/feed' },
      { name: 'Washington State Standard', url: 'https://washingtonstatestandard.com/feed/', desc: 'State government and politics' },
      { name: 'Cascade PBS', url: 'https://www.cascadepbs.org/feed/' },
    ],
  },
  {
    category: 'Technology',
    feeds: [
      { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
      { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
      { name: 'Hacker News: Front page', url: 'https://news.ycombinator.com/rss' },
      { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
      { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
      { name: '404 Media', url: 'https://www.404media.co/rss/' },
      { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
      { name: 'Android Police', url: 'https://www.androidpolice.com/feed/' },
      { name: '9to5Google', url: 'https://9to5google.com/feed/' },
      { name: 'SamMobile', url: 'https://www.sammobile.com/feed/', desc: 'Samsung phones' },
      { name: 'Windows Central', url: 'https://www.windowscentral.com/feeds.xml' },
      { name: 'The GitHub Blog', url: 'https://github.blog/feed/' },
    ],
  },
  {
    category: 'Accessibility and blindness',
    feeds: [
      { name: 'NV Access (NVDA) news', url: 'https://www.nvaccess.org/feed/' },
      { name: 'AppleVis', url: 'https://www.applevis.com/rss.xml', desc: 'Blind and low vision Apple users' },
      { name: 'Blind Bargains', url: 'https://www.blindbargains.com/rss.xml' },
      { name: 'WebAIM blog', url: 'https://webaim.org/blog/feed' },
      { name: 'Deque blog', url: 'https://www.deque.com/feed/' },
      { name: 'TPGi blog', url: 'https://www.tpgi.com/feed/' },
      { name: 'Can I Play That?', url: 'https://caniplaythat.com/feed/', desc: 'Accessibility in video games' },
      { name: 'Disability Visibility Project', url: 'https://disabilityvisibilityproject.com/feed/' },
      { name: 'Hadley', url: 'https://hadleyhelps.org/feed', desc: 'Learning for people with vision loss' },
    ],
  },
  {
    category: 'Science',
    feeds: [
      { name: 'Quanta Magazine', url: 'https://api.quantamagazine.org/feed/' },
      { name: 'ScienceDaily: Top news', url: 'https://www.sciencedaily.com/rss/top.xml' },
      { name: 'Nature', url: 'https://www.nature.com/nature.rss' },
      { name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/' },
      { name: 'NASA news releases', url: 'https://www.nasa.gov/news-release/feed/' },
      { name: 'Scientific American', url: 'http://rss.sciam.com/ScientificAmerican-Global' },
    ],
  },
  {
    category: 'History',
    feeds: [
      { name: 'Smithsonian Magazine: History', url: 'https://www.smithsonianmag.com/rss/history/' },
      { name: 'JSTOR Daily', url: 'https://daily.jstor.org/feed/' },
      { name: 'The Public Domain Review', url: 'https://publicdomainreview.org/rss.xml' },
      { name: 'Medievalists.net', url: 'https://www.medievalists.net/feed/' },
      { name: 'History Today', url: 'https://www.historytoday.com/feed/rss.xml' },
      { name: 'Atlas Obscura', url: 'https://www.atlasobscura.com/feeds/latest' },
    ],
  },
  {
    category: 'Games',
    feeds: [
      { name: 'Wowhead news', url: 'https://www.wowhead.com/news/rss/all', desc: 'World of Warcraft' },
      { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml' },
      { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed' },
      { name: 'Kotaku', url: 'https://kotaku.com/rss' },
      { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
    ],
  },
  {
    category: 'Sports',
    feeds: [
      { name: 'ESPN: Top headlines', url: 'https://www.espn.com/espn/rss/news' },
      { name: 'ESPN: MLB', url: 'https://www.espn.com/espn/rss/mlb/news' },
      { name: 'MLB.com news', url: 'https://www.mlb.com/feeds/news/rss.xml' },
      { name: 'Seattle Mariners (MLB.com)', url: 'https://www.mlb.com/mariners/feeds/news/rss.xml' },
      { name: 'FanGraphs', url: 'https://blogs.fangraphs.com/feed/', desc: 'Baseball analysis and stats' },
      { name: 'Lookout Landing', url: 'https://www.lookoutlanding.com/rss/index.xml', desc: 'Mariners fan site' },
    ],
  },
  {
    category: 'Culture and LGBTQ+',
    feeds: [
      { name: 'them.', url: 'https://www.them.us/feed/rss' },
      { name: 'Erin in the Morning', url: 'https://www.erininthemorning.com/feed', desc: 'Transgender news' },
      { name: 'Autostraddle', url: 'https://www.autostraddle.com/feed/' },
      { name: 'The Advocate', url: 'https://www.advocate.com/rss.xml' },
      { name: 'Pitchfork: News', url: 'https://pitchfork.com/feed/feed-news/rss' },
    ],
  },
  {
    category: 'Podcasts',
    feeds: [
      { name: 'Up First (NPR)', url: 'https://feeds.npr.org/510318/podcast.xml', desc: 'Daily news in 15 minutes' },
      { name: 'The Daily (New York Times)', url: 'https://feeds.simplecast.com/54nAGcIl' },
      { name: '99% Invisible', url: 'https://feeds.simplecast.com/BqbsxVfO' },
      { name: 'Radiolab', url: 'https://feeds.simplecast.com/EmVW7VGp' },
      { name: 'Darknet Diaries', url: 'https://feeds.megaphone.fm/darknetdiaries' },
      { name: 'Hardcore History (Dan Carlin)', url: 'https://feeds.feedburner.com/dancarlin/history' },
      { name: 'Throughline (NPR)', url: 'https://feeds.npr.org/510333/podcast.xml', desc: 'History behind the headlines' },
      { name: 'Planet Money (NPR)', url: 'https://feeds.npr.org/510289/podcast.xml' },
    ],
  },
];
