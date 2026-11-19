// Local storage in IndexedDB. Everything about feeds lives behind this module,
// so a sync service (FreshRSS, Miniflux) can be added later as a second
// backend without touching the interface code.

const DB_NAME = 'straycat-rss';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('feeds')) db.createObjectStore('feeds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('articles')) {
          const s = db.createObjectStore('articles', { keyPath: 'id' });
          s.createIndex('feedId', 'feedId');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function putMany(store, items) {
  if (!items.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const item of items) s.put(item);
  return done(tx);
}

export const put = (store, item) => putMany(store, [item]);

export async function deleteMany(store, ids) {
  if (!ids.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const id of ids) s.delete(id);
  return done(tx);
}

export async function getKV(key) {
  const db = await open();
  return request(db.transaction('kv').objectStore('kv').get(key));
}

export async function setKV(key, value) {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return done(tx);
}
