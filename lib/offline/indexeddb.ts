// VidiaForge — IndexedDB persistence layer (offline snapshots + project recovery).
// Uses the raw IndexedDB API (no Dexie dependency). Provides:
// - projectSnapshots: periodic local snapshots for crash recovery
// - preferences: local user preferences (theme, snap, timecode format)
// - pendingSync: queued operations to sync when back online

const DB_NAME = 'vidiaforge';
const DB_VERSION = 1;

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  name: string;
  data: string; // serialized timeline state JSON
  duration: number;
  savedAt: number;
  isRecovery?: boolean;
}

export interface PendingSyncOp {
  id: string;
  projectId: string;
  type: 'patch-project';
  payload: unknown;
  createdAt: number;
}

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('projectSnapshots')) {
        const store = db.createObjectStore('projectSnapshots', { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('pendingSync')) {
        const store = db.createObjectStore('pendingSync', { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };
  });
}

// === Project Snapshots ===

export async function saveProjectSnapshot(snapshot: ProjectSnapshot): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projectSnapshots', 'readwrite');
      const store = tx.objectStore('projectSnapshots');
      store.put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB not available — silently skip
  }
}

export async function getLatestSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projectSnapshots', 'readonly');
      const store = tx.objectStore('projectSnapshots');
      const index = store.index('projectId');
      const req = index.getAll(projectId);
      req.onsuccess = () => {
        const results = req.result as ProjectSnapshot[];
        if (results.length === 0) { resolve(null); return; }
        results.sort((a, b) => b.savedAt - a.savedAt);
        resolve(results[0]);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getRecoverySnapshots(projectId: string): Promise<ProjectSnapshot[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projectSnapshots', 'readonly');
      const store = tx.objectStore('projectSnapshots');
      const index = store.index('projectId');
      const req = index.getAll(projectId);
      req.onsuccess = () => {
        const results = (req.result as ProjectSnapshot[]).sort((a, b) => b.savedAt - a.savedAt);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function clearSnapshots(projectId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projectSnapshots', 'readwrite');
      const store = tx.objectStore('projectSnapshots');
      const index = store.index('projectId');
      const req = index.openCursor(projectId);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function pruneOldSnapshots(projectId: string, keepCount: number = 10): Promise<void> {
  try {
    const snapshots = await getRecoverySnapshots(projectId);
    if (snapshots.length <= keepCount) return;
    const toDelete = snapshots.slice(keepCount);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projectSnapshots', 'readwrite');
      const store = tx.objectStore('projectSnapshots');
      toDelete.forEach((s) => store.delete(s.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

// === Preferences ===

export async function setPreference(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('preferences', 'readwrite');
      tx.objectStore('preferences').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function getPreference<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('preferences', 'readonly');
      const req = tx.objectStore('preferences').get(key);
      req.onsuccess = () => {
        const result = req.result;
        resolve(result ? (result.value as T) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// === Pending Sync Queue ===

export async function enqueueSyncOp(op: PendingSyncOp): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pendingSync', 'readwrite');
      tx.objectStore('pendingSync').put(op);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function getPendingSyncOps(projectId?: string): Promise<PendingSyncOp[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pendingSync', 'readonly');
      const store = tx.objectStore('pendingSync');
      const req = projectId ? store.index('projectId').getAll(projectId) : store.getAll();
      req.onsuccess = () => resolve(req.result as PendingSyncOp[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeSyncOp(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pendingSync', 'readwrite');
      tx.objectStore('pendingSync').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !('storage' in navigator) || !navigator.storage.estimate) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return null;
  }
}
