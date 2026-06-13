// Best-effort IndexedDB cache for per-game MoveAnalysis so a reload doesn't throw
// away expensive Stockfish work (a 525-game dataset is ~20k positions). Hand-rolled
// wrapper, zero deps. If IndexedDB is unavailable (SSR/tests/privacy mode) every op
// fails soft: load resolves to an empty Map, save/clear resolve void — never throws.
import type { MoveAnalysis } from '../engine/types';
import { isRecordFresh, type TeachingRecordV1 } from '../engine/teaching/record';

export type AnalysisCache = Map<string, Map<number, MoveAnalysis>>; // gameKey -> (plyIndex -> analysis)
export type TeachingCache = Map<string, Map<number, TeachingRecordV1>>; // gameKey -> (plyIndex -> record)

const DB_NAME = 'chess-vision-studio';
// v2 adds the `teaching` store: per-ply teaching corpus records, the durable
// local training-data store. Stale records (validator/registry/compiler change)
// are filtered on load via isRecordFresh, not on write.
const DB_VERSION = 2;
const STORE = 'analyses';
const STORE_TEACHING = 'teaching';

interface StoredRecord {
  key: string;
  plies: Array<[number, MoveAnalysis]>;
}

interface StoredTeachingRecord {
  key: string;
  records: Array<[number, TeachingRecordV1]>;
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
      if (!db.objectStoreNames.contains(STORE_TEACHING)) {
        db.createObjectStore(STORE_TEACHING, { keyPath: 'key' });
      }
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

// Load persisted teaching records, dropping any produced by an older compiler/
// schema (isRecordFresh) so stale topics never survive a validator change.
export async function loadTeachingCache(): Promise<TeachingCache> {
  const cache: TeachingCache = new Map();
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_TEACHING, 'readonly');
    const records = await reqToPromise(
      tx.objectStore(STORE_TEACHING).getAll() as IDBRequest<StoredTeachingRecord[]>,
    );
    for (const rec of records) {
      const fresh = rec.records.filter(([, r]) => isRecordFresh(r));
      if (fresh.length) cache.set(rec.key, new Map(fresh));
    }
  } catch {
    // Fail soft — return whatever we have.
  }
  return cache;
}

export async function saveGameTeaching(
  key: string,
  records: Map<number, TeachingRecordV1>,
): Promise<void> {
  if (records.size === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_TEACHING, 'readwrite');
    const record: StoredTeachingRecord = { key, records: [...records.entries()] };
    await reqToPromise(tx.objectStore(STORE_TEACHING).put(record));
  } catch {
    // Fail soft — persistence is an optimization, not a requirement.
  }
}
