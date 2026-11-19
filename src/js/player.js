// Podcast player. One audio element for the whole app, so an episode keeps
// playing while you browse other feeds and articles.

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const audio = new Audio();
audio.preload = 'none';

let current = null; // the article being played
let onChange = () => {};
let onPosition = () => {};
let lastSaved = 0;

export function setHandlers({ change, position }) {
  onChange = change || onChange;
  onPosition = position || onPosition;
}

export const playingArticle = () => current;
export const isPlaying = () => !!current && !audio.paused;
export const speed = () => audio.playbackRate;
export const position = () => audio.currentTime || 0;
export const duration = () => (Number.isFinite(audio.duration) ? audio.duration : 0);

export function load(article, defaultSpeed) {
  if (current?.id === article.id) return;
  if (current) onPosition(current, audio.currentTime);
  current = article;
  audio.src = article.enclosure.url;
  audio.playbackRate = defaultSpeed || 1;
  audio.defaultPlaybackRate = audio.playbackRate;
  if (article.position) {
    const seekTo = article.position;
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = seekTo; }, { once: true });
  }
  onChange();
}

export async function toggle() {
  if (!current) return false;
  if (audio.paused) {
    try { await audio.play(); } catch (e) { onChange(e); return false; }
  } else {
    audio.pause();
    onPosition(current, audio.currentTime);
  }
  onChange();
  return !audio.paused;
}

export function skip(seconds) {
  if (!current) return;
  audio.currentTime = Math.max(0, Math.min((duration() || Infinity), audio.currentTime + seconds));
  onChange();
}

export function seek(seconds) {
  if (current) audio.currentTime = seconds;
}

export function cycleSpeed() {
  const i = SPEEDS.indexOf(audio.playbackRate);
  audio.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
  onChange();
  return audio.playbackRate;
}

/** "1 hour 2 minutes 3 seconds", for screen readers. */
export function spokenTime(total) {
  total = Math.floor(total || 0);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const part = (n, w) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  return [part(h, 'hour'), part(m, 'minute'), part(s, 'second')].filter(Boolean).join(' ') || '0 seconds';
}

for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'error']) {
  audio.addEventListener(ev, () => onChange(ev === 'error' ? audio.error : undefined));
}
audio.addEventListener('timeupdate', () => {
  // Save the place every 15 seconds, so an episode resumes where you left off.
  if (current && Math.abs(audio.currentTime - lastSaved) > 15) {
    lastSaved = audio.currentTime;
    onPosition(current, audio.currentTime);
  }
});
audio.addEventListener('ended', () => { if (current) onPosition(current, 0); });
