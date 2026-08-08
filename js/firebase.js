// Firebase Service Layer - نظام إدارة مصنع الألبان
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import {
  getDatabase, ref, push, set, update, remove, get, onValue, off,
  serverTimestamp, query, orderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBZOqmEoIiWMV5FDw3YIxQ3hdOdkcPQByc",
  authDomain: "labn-79595.firebaseapp.com",
  databaseURL: "https://labn-79595-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "labn-79595",
  storageBucket: "labn-79595.firebasestorage.app",
  messagingSenderId: "446803964753",
  appId: "1:446803964753:web:03c378553e060496725970",
  measurementId: "G-W6WDMESEGN"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const db = getDatabase(app);

// ─── Analytics Tracking ───────────────────────────────────────────────
export function track(event, params = {}) {
  try { logEvent(analytics, event, params); } catch {}
}

// ─── Connection State ─────────────────────────────────────────────────
let isOnline = navigator.onLine;
window.addEventListener('online',  () => { isOnline = true;  syncOfflineQueue(); });
window.addEventListener('offline', () => { isOnline = false; });
export const getOnlineState = () => isOnline;

// ─── Offline Queue (IndexedDB) ────────────────────────────────────────
const IDB_NAME = 'dairy_offline';
const IDB_STORE = 'queue';
let idb = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    if (idb) return resolve(idb);
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { autoIncrement: true });
    req.onsuccess = e => { idb = e.target.result; resolve(idb); };
    req.onerror = () => reject(req.error);
  });
}

async function queueOffline(op) {
  const db_ = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db_.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).add(op);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function syncOfflineQueue() {
  const db_ = await openIDB();
  const tx = db_.transaction(IDB_STORE, 'readwrite');
  const store = tx.objectStore(IDB_STORE);
  const all = await new Promise(r => { const req = store.getAll(); req.onsuccess = () => r(req.result); });
  const keys = await new Promise(r => { const req = store.getAllKeys(); req.onsuccess = () => r(req.result); });

  for (let i = 0; i < all.length; i++) {
    const op = all[i];
    try {
      if (op.type === 'set')    await set(ref(db, op.path), op.data);
      if (op.type === 'push')   await push(ref(db, op.path), op.data);
      if (op.type === 'update') await update(ref(db, op.path), op.data);
      if (op.type === 'remove') await remove(ref(db, op.path));
      store.delete(keys[i]);
    } catch {}
  }
}

// ─── CRUD Helpers ─────────────────────────────────────────────────────
export async function dbPush(path, data) {
  data.createdAt = Date.now();
  if (!isOnline) { await queueOffline({ type: 'push', path, data }); return { key: 'offline_' + Date.now() }; }
  return push(ref(db, path), data);
}

export async function dbSet(path, data) {
  if (!isOnline) { await queueOffline({ type: 'set', path, data }); return; }
  return set(ref(db, path), data);
}

export async function dbUpdate(path, data) {
  data.updatedAt = Date.now();
  if (!isOnline) { await queueOffline({ type: 'update', path, data }); return; }
  return update(ref(db, path), data);
}

export async function dbRemove(path) {
  if (!isOnline) { await queueOffline({ type: 'remove', path }); return; }
  return remove(ref(db, path));
}

export async function dbGet(path) {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}

export function dbListen(path, cb) {
  const r = ref(db, path);
  onValue(r, snap => cb(snap.exists() ? snap.val() : null));
  return () => off(r);
}

// ─── Backup ──────────────────────────────────────────────────────────
export async function exportBackup() {
  const data = await dbGet('/');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `dairy_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  track('backup_export');
}

export async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  await dbSet('/', data);
  track('backup_import');
}
