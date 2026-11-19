# StrayCat's Accessible RSS Reader

An RSS reader built for screen readers first: NVDA on Windows and TalkBack on Android.

## Download

Open the repo's Releases page and choose the release called "Latest build". It's rebuilt after every change.

- StrayCatRSS.apk: the Android app. You may need to allow installing from your browser or file manager the first time.
- StrayCatRSS-Setup.exe: the Windows installer. Installs for your user only, with no admin prompt.
- StrayCatRSS-Portable.exe: runs on Windows without installing. Notifications only work in the installed version.

Every Android build is signed with the same key, so a new version installs over the old one and keeps your feeds.

## How it's laid out

The app shows one screen at a time. Each screen starts with a level 1 heading, and that heading gets focus when the screen opens.

- Feeds: buttons for "All articles" and each feed, with unread counts. If you use folders, each folder is a level 2 heading.
- Articles: the articles in a feed, one button each. Tap or double-tap an article to open it. Long press it (with TalkBack, double-tap and hold) for Open, Mark read, Share, Hide and Open in browser. On Windows, the Applications key or Shift+F10 opens the same menu. In focus mode, Up and Down arrows move between articles.
- Article: the cleaned-up story comes first, and the actions (Next, Previous, Mark unread, Share, and so on) follow it. Headings inside the article start at level 2. Images with no description are removed. Links open in your browser.
- Popular feeds: about 70 well-known feeds by category, each added with one tap.
- Settings: refreshing, reading, podcasts, OPML import and export, and the shortcut list.

The app opens to All articles. You can change that in Settings under "Open the app to": choose All articles, the Feeds list, or any one feed. On Android, the back button or gesture goes back one screen.

Status messages such as "Refreshed. 5 new articles." are announced without moving focus.

## Full article text

Many feeds only send a summary. When a feed's text is short, the app downloads the web page and keeps only the article itself, using Mozilla's Readability (the same engine as Firefox Reader View). You can change this in Settings, and for each feed under Feed settings:

- Fetch when the feed text is short (the default)
- Always fetch
- Never fetch

In an article, "Show feed version" and "Show full article" switch between the two.

## Keyboard shortcuts (Windows)

NVDA's browse mode uses single letters for quick navigation, so plain-letter shortcuts only reach the app in focus mode. Hold Alt with any letter to use it from either mode, for example Alt+J.

- J: next article
- K: previous article
- R: refresh this feed, or all feeds
- M: mark the current article read or unread
- Shift+A: mark everything in the list read
- O: open the article in your browser
- U, or Alt+Left Arrow: go back
- F: go to the feeds list
- P: play or pause the podcast
- Comma: podcast back 15 seconds
- Period: podcast forward 30 seconds
- Question mark: show the shortcut list

## Podcasts

Episodes have Play, Back 15 seconds, Forward 30 seconds, and Speed buttons, plus a position slider that moves in 15-second steps. Playback keeps going while you browse. The Feeds screen shows what's playing, and each episode remembers where you stopped.

## Moving feeds between devices

Under Settings, "Move feeds between devices (OPML)":

- Export to a file saves to your Downloads folder.
- Copy export to clipboard copies the OPML text instead.
- Import an OPML file, or paste OPML text into the box and choose "Import pasted text".

## Building it yourself

GitHub Actions builds both versions; see `.github/workflows/build.yml`. To build locally, install Node.js, Rust and the Tauri prerequisites, then run:

```
npm install
npx tauri icon app-icon.png
npx tauri build
```

The Android signing key in `android-signing/` is deliberately public. It only exists so updates install over each other. Don't reuse it for anything else.

## Planned

- Sync with FreshRSS or Miniflux (for example, running on a NAS, reachable from anywhere through Tailscale).
- Checking for new articles on Android after the system has closed the app.

## License

GNU General Public License, version 3. See LICENSE.

## Credits

- Mozilla Readability (Apache 2.0): `src/vendor/Readability.js`
- DOMPurify (Apache 2.0 or MPL 2.0): `src/vendor/purify.min.js`
- Tauri (MIT or Apache 2.0)
