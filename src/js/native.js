// Bridge to the native side (Rust, via Tauri). When the page runs in a plain
// browser for testing, falls back to web APIs, which can't fetch most feeds
// because of CORS, so the real app always goes through Rust.

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;

export const isNative = typeof invoke === 'function';
export const isAndroid = /Android/i.test(navigator.userAgent);

/** Fetch a URL as text. Returns { status, url, contentType, body }. */
export async function fetchText(url) {
  if (isNative) return invoke('fetch_text', { url });
  const res = await fetch(url);
  return {
    status: res.status,
    url: res.url || url,
    contentType: res.headers.get('content-type') || '',
    body: await res.text(),
  };
}

export async function openExternal(url) {
  if (isNative) return invoke('open_external', { url });
  window.open(url, '_blank', 'noopener');
}

/** Ask for notification permission if needed. Resolves to true if allowed. */
export async function notificationsAllowed() {
  try {
    if (isNative) return await invoke('notification_permission');
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted';
  } catch {
    return false;
  }
}

export async function notify(title, body) {
  try {
    if (isNative) return await invoke('notify', { title, body });
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch (e) {
    console.warn('notify failed', e);
  }
}

/** Save a text file to the Downloads folder. Resolves to the saved path. */
export async function saveTextFile(filename, contents) {
  if (isNative) return invoke('save_text_file', { filename, contents });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contents], { type: 'text/xml' }));
  a.download = filename;
  a.click();
  return filename;
}

/**
 * Share a link. Android opens the system share sheet. Elsewhere, uses the
 * system share dialog if there is one, or copies the link.
 * Resolves to 'shared', 'copied' or 'failed'.
 */
export async function share(title, url) {
  try {
    if (isNative && (await invoke('share', { title, url }))) return 'shared';
  } catch (e) {
    console.warn('native share failed', e);
  }
  try {
    if (navigator.share) { await navigator.share({ title, url }); return 'shared'; }
  } catch (e) {
    if (e?.name === 'AbortError') return 'shared';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Tell Android what the podcast player is doing (earbud buttons, lock screen). */
export async function mediaUpdate(info) {
  if (!isNative) return false;
  try { return await invoke('media_update', { info }); } catch (e) { console.warn('media update failed', e); return false; }
}

/**
 * Let the person choose a text file and return its contents, or null if they cancel.
 * Android uses the system picker; elsewhere a hidden file input.
 */
export async function pickTextFile() {
  if (isNative) {
    const res = await invoke('pick_text_file');
    if (res) return res.cancelled ? null : res.text;
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.opml,.xml,.txt,text/xml,application/xml,text/plain,text/x-opml' });
    input.addEventListener('change', async () => resolve(input.files?.[0] ? await input.files[0].text() : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Android: give the background checker the feed list and schedule it. */
export async function backgroundSync(info) {
  if (!isNative || !isAndroid) return false;
  try { return await invoke('background_sync', { info }); } catch (e) { console.warn('background sync failed', e); return false; }
}

/** Android: the article whose notification opened the app, as { id, link, title }, or null. */
export async function takePendingArticle() {
  if (!isNative || !isAndroid) return null;
  try {
    const res = await invoke('take_pending_article');
    return res?.article ? JSON.parse(res.article) : null;
  } catch { return null; }
}

/** Windows: keep running in the notification area, and start with Windows. */
export async function setDesktopOptions(closeToTray, startWithWindows) {
  if (!isNative || isAndroid) return false;
  return invoke('set_desktop_options', { closeToTray, startWithWindows });
}

export async function appVersion() {
  try {
    if (isNative) return await tauri.app.getVersion();
  } catch { /* fall through */ }
  return null;
}
