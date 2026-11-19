// Bridge to the native side (Rust, via Tauri). When the page runs in a plain
// browser for testing, falls back to web APIs, which can't fetch most feeds
// because of CORS, so the real app always goes through Rust.

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;

export const isNative = typeof invoke === 'function';

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

export async function appVersion() {
  try {
    if (isNative) return await tauri.app.getVersion();
  } catch { /* fall through */ }
  return null;
}
