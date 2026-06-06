// Best-effort IndexedDB cache for per-game MoveAnalysis so a reload doesn't throw
// away expensive Stockfish work (a 525-game dataset is ~20k positions). Hand-rolled
// wrapper, zero deps. If IndexedDB is unavailable (SSR/tests/privacy mode) every op
// fails soft: load resolves to an empty Map, save/clear resolve void — never throws.
import type { MoveAnalysis } from '../engine/types';

export type AnalysisCache = Map<string, Map<number, MoveAnalysis>>; // gameKey -> (plyIndex -> analysis)

const DB_NAME = 'chess-vision-studio';
const DB_VERSION = 1;
const STORE = 'analyses';

interface StoredRecord {
  key: string;
  plies: Array<[number, MoveAnalysis]>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// Open (and memoize) the DB. Rejects if IndexedDB is missing or the open fails.
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // Don't poison the module-level cache if the open rejected.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

// Wrap an IDBRequest in a Promise so callers can await it.
function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function loadAnalysisCache(): Promise<AnalysisCache> {
  const cache: AnalysisCache = new Map();
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const records = await reqToPromise(tx.objectStore(STORE).getAll() as IDBRequest<StoredRecord[]>);
    for (const rec of records) cache.set(rec.key, new Map(rec.plies));
  } catch {
    // Fail soft — return whatever we have (an empty Map on total failure).
  }
  return cache;
}

export async function saveGameAnalysis(key: string, plies: Map<number, MoveAnalysis>): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const record: StoredRecord = { key, plies: [...plies.entries()] };
    await reqToPromise(tx.objectStore(STORE).put(record));
  } catch {
    // Fail soft — persistence is an optimization, not a requirement.
  }
}

export async function clearAnalysisCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    await reqToPromise(tx.objectStore(STORE).clear());
  } catch {
    // Fail soft.
  }
}
