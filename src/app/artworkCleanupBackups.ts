import type {LandmarkProject} from '../domain/landmarks/model';

/** Recovery bytes live outside both the project schema and ordinary autosave. */
export const ARTWORK_CLEANUP_DATABASE_NAME = 'contour.artwork-cleanup.v1';
export const ARTWORK_CLEANUP_DATABASE_VERSION = 1;
export const ARTWORK_CLEANUP_BACKUP_STORE = 'backups';

export type ArtworkCleanupBackupReason = 'cleanup' | 'before-restore';
export interface ArtworkCleanupBackupMetadata {
  id: string;
  createdAt: number;
  reason: ArtworkCleanupBackupReason;
  projectName: string;
  artworkCount: number;
}
export interface ArtworkCleanupBackup extends ArtworkCleanupBackupMetadata {
  serialized: string;
}

/** Injectable adapter. write must insert without replacing and resolve on commit. */
export interface ArtworkCleanupBackupDatabase {
  write(backup: ArtworkCleanupBackup): Promise<void>;
  read(id: string): Promise<unknown>;
  list(): Promise<unknown[]>;
  close(): void;
}
export interface ArtworkCleanupBackupOptions {
  openDatabase?: () => Promise<ArtworkCleanupBackupDatabase>;
  now?: () => number;
  createId?: () => string;
}

function backupError(reason: unknown): Error {
  const error = reason as {name?: string; message?: string} | null;
  if (error?.name === 'QuotaExceededError') {
    return new Error('Browser storage is full. The recovery backup could not be saved; cleanup or restore was not started.');
  }
  return new Error(`Artwork recovery backup is unavailable: ${error?.message || String(reason)}. Cleanup or restore was not started.`);
}

function checkedBackup(value: unknown): ArtworkCleanupBackup {
  const entry = value as Partial<ArtworkCleanupBackup> | null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)
    || typeof entry.id !== 'string' || !entry.id
    || typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)
    || (entry.reason !== 'cleanup' && entry.reason !== 'before-restore')
    || typeof entry.projectName !== 'string'
    || typeof entry.artworkCount !== 'number' || !Number.isInteger(entry.artworkCount) || entry.artworkCount < 0
    || typeof entry.serialized !== 'string') {
    throw new Error('The stored artwork recovery backup cannot be read');
  }
  return {...metadata(entry as ArtworkCleanupBackup), serialized: entry.serialized};
}

function metadata(entry: ArtworkCleanupBackupMetadata): ArtworkCleanupBackupMetadata {
  const {id, createdAt, reason, projectName, artworkCount} = entry;
  return {id, createdAt, reason, projectName, artworkCount};
}

/** Exported separately so request success and transaction completion can be tested. */
export function openArtworkCleanupBackupDatabase(factory: IDBFactory | undefined, timeoutMs = 4000): Promise<ArtworkCleanupBackupDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {reject(new Error('IndexedDB is not available in this browser')); return;}
    let settled = false;
    let request: IDBOpenDBRequest;
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(reason);
    };
    const timer = setTimeout(() => fail(new Error('Opening recovery storage timed out; close other tabs and retry')), timeoutMs);
    try {request = factory.open(ARTWORK_CLEANUP_DATABASE_NAME, ARTWORK_CLEANUP_DATABASE_VERSION);}
    catch (error) {fail(error); return;}
    request.onerror = () => fail(request.error ?? new Error('Recovery storage could not be opened'));
    request.onblocked = () => fail(new Error('Recovery storage is blocked by another tab; close it and retry'));
    request.onupgradeneeded = () => {
      // A timed-out or blocked open must not leave a late upgrade holding a lock.
      if (settled) {request.transaction?.abort(); return;}
      try {
        if (!request.result.objectStoreNames.contains(ARTWORK_CLEANUP_BACKUP_STORE)) {
          request.result.createObjectStore(ARTWORK_CLEANUP_BACKUP_STORE, {keyPath: 'id'});
        }
      } catch (error) {
        try {request.transaction?.abort();} finally {fail(error);}
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {db.close(); return;}
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => db.close();
      const transact = <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => new Promise((done, rejectTransaction) => {
        let transaction: IDBTransaction;
        try {transaction = db.transaction(ARTWORK_CLEANUP_BACKUP_STORE, mode);}
        catch (error) {rejectTransaction(error); return;}
        let value: T;
        let failure: unknown;
        transaction.oncomplete = () => failure ? rejectTransaction(failure) : done(value);
        transaction.onabort = () => rejectTransaction(transaction.error ?? failure ?? new Error('Recovery storage transaction was aborted'));
        transaction.onerror = () => {failure ??= transaction.error;};
        try {
          const operationRequest = operation(transaction.objectStore(ARTWORK_CLEANUP_BACKUP_STORE));
          operationRequest.onsuccess = () => {value = operationRequest.result;};
          operationRequest.onerror = () => {failure = operationRequest.error;};
        } catch (error) {
          failure = error;
          try {transaction.abort();} catch { /* The transaction may already have ended. */ }
          rejectTransaction(error);
        }
      });
      resolve({
        // add is deliberate: even an ID collision cannot overwrite an old backup.
        write: async entry => {await transact('readwrite', store => store.add(entry));},
        read: id => transact('readonly', store => store.get(id)),
        list: () => transact('readonly', store => store.getAll()),
        close: () => db.close(),
      });
    };
  });
}

export function createArtworkCleanupBackupStorage(options: ArtworkCleanupBackupOptions = {}) {
  const open = options.openDatabase ?? (() => openArtworkCleanupBackupDatabase(globalThis.indexedDB));
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => globalThis.crypto?.randomUUID?.()
    ?? `backup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(operation: (database: ArtworkCleanupBackupDatabase) => Promise<T>): Promise<T> => {
    const result = tail.then(async () => {
      let database: ArtworkCleanupBackupDatabase | undefined;
      try {database = await open(); return await operation(database);}
      catch (error) {throw backupError(error);}
      finally {database?.close();}
    });
    // Serialize callers through verification. A failure does not poison a retry.
    tail = result.catch(() => undefined);
    return result;
  };

  const createArtworkCleanupBackup = async (project: LandmarkProject, reason: ArtworkCleanupBackupReason): Promise<ArtworkCleanupBackupMetadata> => {
    // Capture immediately, before any asynchronous work or subsequent project edits.
    // Do not normalize/filter through autosave: every original project field belongs
    // in this recovery snapshot, including inactive working copies and legacy data.
    const entry = checkedBackup({id: createId(), createdAt: now(), reason, projectName: project.meta.name,
      artworkCount: project.drawingSnapshots?.items.length ?? 0, serialized: JSON.stringify(project)});
    return run(async database => {
      await database.write(entry);
      const saved = checkedBackup(await database.read(entry.id));
      if (saved.serialized !== entry.serialized || JSON.stringify(metadata(saved)) !== JSON.stringify(metadata(entry))) {
        throw new Error('Recovery backup verification failed; the saved data does not match the original project');
      }
      return metadata(saved);
    });
  };
  const listArtworkCleanupBackups = (): Promise<ArtworkCleanupBackupMetadata[]> => run(async database => {
    const entries = (await database.list()).map(value => metadata(checkedBackup(value)));
    // getAll may read full records internally; callers only receive small metadata.
    return entries.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  });
  const readArtworkCleanupBackup = (id: string): Promise<ArtworkCleanupBackup | undefined> => run(async database => {
    const stored = await database.read(id);
    if (stored === undefined) return undefined;
    const entry = checkedBackup(stored);
    if (entry.id !== id) throw new Error('Recovery backup verification failed; the stored identifier does not match');
    return entry;
  });
  return {createArtworkCleanupBackup, listArtworkCleanupBackups, readArtworkCleanupBackup};
}

const backups = createArtworkCleanupBackupStorage();
export const {createArtworkCleanupBackup, listArtworkCleanupBackups, readArtworkCleanupBackup} = backups;
