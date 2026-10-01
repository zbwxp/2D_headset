/** Full-project autosave. This module deliberately has no store/UI imports. */
export const PROJECT_DATABASE_NAME = 'contour.project-storage.v1';
export const PROJECT_DATABASE_VERSION = 1;
export const PROJECT_AUTOSAVE_STORE = 'autosave';
export const PROJECT_RECOVERY_STORE = 'recovery';
export const PROJECT_AUTOSAVE_KEY = 'current';
export const LEGACY_PROJECT_KEYS = [
  'contour.landmarks.v039', 'contour.landmarks.v038', 'contour.landmarks.v036',
  'contour.landmarks.v035', 'contour.landmarks.v03', 'contour.landmarks.v02',
  'contour.landmarks.v01',
] as const;

export interface ProjectStorageStatus {
  state: 'idle' | 'loading' | 'saving' | 'saved' | 'error';
  /** localStorage is a read-only recovery source, never a fallback write target. */
  backend: 'indexeddb' | 'localStorage' | 'none';
  pendingWrites: number;
  error?: string;
  warning?: string;
  recoveryAvailable?: boolean;
  updatedAt?: number;
}

/** Small test seam. write must resolve on transaction completion, not put success. */
export interface ProjectStorageDatabase {
  read(): Promise<unknown>;
  write(serialized: string, preservePrevious: boolean): Promise<void>;
  close(): void;
}
export interface ProjectStorageOptions {
  openDatabase?: () => Promise<ProjectStorageDatabase>;
  legacyStorage?: () => Pick<Storage, 'getItem'> | undefined;
  now?: () => number;
}

function storageError(error: unknown): Error {
  const value = error as {name?: string; message?: string} | null;
  const detail = value?.message || String(error);
  if (value?.name === 'QuotaExceededError') return new Error('Browser storage is full. Export JSON to preserve your work.');
  return new Error(`Project autosave is unavailable: ${detail}. Export JSON to preserve your work.`);
}
function readableProject(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(value);
    // Domain/schema validation belongs to the project loader. Preserve any JSON
    // object here so a newer or older project format is never silently discarded.
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch { return false; }
}
function sameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** IndexedDB adapter, also exported for request/transaction lifecycle tests. */
export function openProjectDatabase(factory: IDBFactory | undefined, timeoutMs = 4000): Promise<ProjectStorageDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB is not available in this browser')); return; }
    let settled = false;
    let request: IDBOpenDBRequest;
    const timer = setTimeout(() => finish(new Error('Opening browser storage timed out; close other tabs and retry')), timeoutMs);
    const finish = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    try { request = factory.open(PROJECT_DATABASE_NAME, PROJECT_DATABASE_VERSION); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
    request.onerror = () => finish(request.error ?? new Error('Browser storage could not be opened'));
    request.onblocked = () => finish(new Error('Browser storage is blocked by another tab; close it and retry'));
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECT_AUTOSAVE_STORE)) db.createObjectStore(PROJECT_AUTOSAVE_STORE);
        if (!db.objectStoreNames.contains(PROJECT_RECOVERY_STORE)) db.createObjectStore(PROJECT_RECOVERY_STORE, {autoIncrement: true});
      } catch (error) {
        request.transaction?.abort();
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => db.close();
      const database: ProjectStorageDatabase = {
        close: () => db.close(),
        read: () => new Promise((done, fail) => {
          let transaction: IDBTransaction;
          try { transaction = db.transaction(PROJECT_AUTOSAVE_STORE, 'readonly'); }
          catch (error) { fail(error); return; }
          let value: unknown;
          let error: DOMException | null = null;
          transaction.oncomplete = () => done(value);
          transaction.onabort = () => fail(transaction.error ?? error ?? new Error('Reading browser storage was aborted'));
          transaction.onerror = () => { error = transaction.error; };
          const read = transaction.objectStore(PROJECT_AUTOSAVE_STORE).get(PROJECT_AUTOSAVE_KEY);
          read.onsuccess = () => { value = read.result; };
          read.onerror = () => { error = read.error; };
        }),
        write: (serialized, preservePrevious) => new Promise((done, fail) => {
          let transaction: IDBTransaction;
          try { transaction = db.transaction([PROJECT_AUTOSAVE_STORE, PROJECT_RECOVERY_STORE], 'readwrite'); }
          catch (error) { fail(error); return; }
          let error: unknown;
          transaction.oncomplete = () => done();
          transaction.onabort = () => fail(transaction.error ?? error ?? new Error('Saving browser storage was aborted'));
          transaction.onerror = () => { error = transaction.error; };
          const store = transaction.objectStore(PROJECT_AUTOSAVE_STORE);
          const put = () => {
            try {
              const request = store.put(serialized, PROJECT_AUTOSAVE_KEY);
              request.onerror = () => { error = request.error; };
            } catch (reason) { error = reason; transaction.abort(); }
          };
          if (!preservePrevious) { put(); return; }
          // Recovery and replacement commit atomically. Failed backup or quota
          // abort leaves the original primary intact; legacy localStorage is
          // never touched by this service.
          const previous = store.get(PROJECT_AUTOSAVE_KEY);
          previous.onerror = () => { error = previous.error; };
          previous.onsuccess = () => {
            try {
              if (previous.result !== undefined) {
                const backup = transaction.objectStore(PROJECT_RECOVERY_STORE).put({value: previous.result, createdAt: Date.now()});
                backup.onerror = () => { error = backup.error; };
              }
              put();
            } catch (reason) { error = reason; transaction.abort(); }
          };
        }),
      };
      resolve(database);
    };
  });
}

export function createProjectStorage(options: ProjectStorageOptions = {}) {
  const now = options.now ?? Date.now;
  const open = options.openDatabase ?? (() => {
    try { return openProjectDatabase(globalThis.indexedDB); }
    catch (error) { return Promise.reject(error); }
  });
  const legacy = options.legacyStorage ?? (() => {
    try { return globalThis.localStorage; } catch { return undefined; }
  });
  let database: ProjectStorageDatabase | undefined;
  let initialAutosave: string | undefined;
  let rejectedInitialAutosave: string | undefined;
  let prepared: Promise<void> | undefined;
  let preservePrevious = false;
  let hasObservedPrimary = false;
  let observedPrimary: unknown;
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let status: ProjectStorageStatus = Object.freeze({state: 'idle', backend: 'none', pendingWrites: 0});
  const listeners = new Set<() => void>();
  const publish = (update: Partial<ProjectStorageStatus>) => {
    status = Object.freeze({...status, ...update, pendingWrites: pending});
    // A UI subscriber must not turn a successfully committed save into a failure.
    for (const listener of listeners) { try { listener(); } catch { /* isolated observer */ } }
  };
  const warn = (message: string) => publish({warning: status.warning ? `${status.warning} ${message}` : message, recoveryAvailable: true});
  const readLegacy = () => {
    let storage: Pick<Storage, 'getItem'> | undefined;
    try { storage = legacy(); } catch { /* Storage can be denied independently of IDB. */ }
    if (!storage) return undefined;
    for (const key of LEGACY_PROJECT_KEYS) {
      let value: string | null;
      try { value = storage.getItem(key); }
      catch { warn('Legacy browser storage could not be read; existing data was not changed.'); return undefined; }
      if (value === null) continue;
      if (!readableProject(value)) warn(`An unreadable legacy save (${key}) was preserved for recovery.`);
      // Presence is significant to startup: returning the first raw string
      // prevents an unreadable authored project being mistaken for no project.
      return value;
    }
    return undefined;
  };
  const connect = async (protectBaseline = false) => {
    const candidate = await open();
    try {
      const value = await candidate.read();
      // A legacy fallback may be older than a temporarily inaccessible primary.
      // Reconnection must not turn that fallback into a silent destructive save.
      if (protectBaseline && (hasObservedPrimary
        ? !sameStoredValue(value, observedPrimary)
        : value !== undefined && value !== initialAutosave)) {
        throw new Error('A different saved project was found after reconnecting. Export the current work and reopen the app before saving over it');
      }
      observedPrimary = value; hasObservedPrimary = true;
      database = candidate;
      preservePrevious = value !== undefined && (!readableProject(value) || value === rejectedInitialAutosave);
      if (preservePrevious) warn('An unreadable IndexedDB save will be retained in recovery storage before replacement.');
      return value;
    } catch (error) { candidate.close(); throw error; }
  };
  const prepareProjectStorage = (): Promise<void> => {
    if (prepared) return prepared;
    prepared = (async () => {
      publish({state: pending ? 'saving' : 'loading', error: undefined});
      try {
        const value = await connect();
        publish({backend: 'indexeddb'});
        if (typeof value === 'string') {
          initialAutosave = value;
          publish(readableProject(value)
            ? {state: pending ? 'saving' : 'saved'}
            : {state: pending ? 'saving' : 'error', error: 'The saved project cannot be read. Its original data has been preserved for recovery.'});
          return;
        }
        initialAutosave = readLegacy();
        if (initialAutosave !== undefined) {
          if (!readableProject(initialAutosave)) {
            publish({state: pending ? 'saving' : 'error', error: 'The legacy project cannot be read. Its original data has been preserved for recovery.'});
            return;
          }
          publish({state: 'saving'});
          await database!.write(initialAutosave, preservePrevious);
          preservePrevious = false;
          observedPrimary = initialAutosave;
          publish({state: pending ? 'saving' : 'saved', updatedAt: now()});
        } else publish({state: pending ? 'saving' : 'idle'});
      } catch (error) {
        // Keep startup and JSON export usable. Every failed save still rejects;
        // prepare communicates its recoverable failure through the status.
        database?.close(); database = undefined;
        initialAutosave ??= readLegacy();
        publish({state: pending ? 'saving' : 'error', backend: initialAutosave === undefined ? 'none' : 'localStorage', error: storageError(error).message});
      }
    })();
    return prepared;
  };
  const saveDurableProject = (serialized: string): Promise<void> => {
    if (!readableProject(serialized)) {
      const error = new Error('Project autosave requires a valid JSON object; the previous save was not changed.');
      publish({state: pending ? 'saving' : 'error', error: error.message});
      return Promise.reject(error);
    }
    pending++;
    publish({state: 'saving'});
    // FIFO includes transaction completion, not merely request enqueueing. A
    // rejection never poisons later saves; an older request cannot finish last.
    const operation = tail.then(async () => {
      await prepareProjectStorage();
      try {
        if (!database) await connect(true);
        publish({backend: 'indexeddb'});
        await database!.write(serialized, preservePrevious);
        preservePrevious = false;
        rejectedInitialAutosave = undefined;
        initialAutosave = serialized;
        observedPrimary = serialized;
        pending--;
        publish({state: pending ? 'saving' : 'saved', error: undefined, updatedAt: now()});
      } catch (reason) {
        database?.close(); database = undefined;
        pending--;
        const error = storageError(reason);
        publish({state: pending ? 'saving' : 'error', error: error.message});
        throw error;
      }
    });
    tail = operation.catch(() => undefined);
    return operation;
  };
  /** The domain loader calls this if syntactically valid JSON fails its schema.
   * Its exact original value remains protected even if a failed write reconnects. */
  const markInitialAutosaveUnreadable = () => {
    if (initialAutosave === undefined) return;
    rejectedInitialAutosave = initialAutosave;
    preservePrevious = true;
    publish({state: pending ? 'saving' : 'error', recoveryAvailable: true,
      error: 'The saved project format cannot be read. Its original data will be preserved before replacement.'});
  };
  const subscribeStorageStatus = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
  return {
    prepareProjectStorage,
    getInitialAutosave: () => initialAutosave,
    saveDurableProject,
    markInitialAutosaveUnreadable,
    getStorageStatus: () => status,
    subscribeStorageStatus,
    subscribe: subscribeStorageStatus,
  };
}

const projectStorage = createProjectStorage();
export const {prepareProjectStorage, getInitialAutosave, saveDurableProject, markInitialAutosaveUnreadable, getStorageStatus, subscribeStorageStatus, subscribe} = projectStorage;
