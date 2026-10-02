import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ARTWORK_CLEANUP_DATABASE_NAME, ARTWORK_CLEANUP_DATABASE_VERSION, ARTWORK_CLEANUP_BACKUP_STORE,
  createArtworkCleanupBackupStorage, openArtworkCleanupBackupDatabase,
  type ArtworkCleanupBackup, type ArtworkCleanupBackupDatabase,
} from '../app/artworkCleanupBackups';
import type {LandmarkProject} from '../domain/landmarks/model';
import {emptyDrawing} from '../domain/drawing/model';

function project(name = 'Untouched project'): LandmarkProject {
  const drawing = emptyDrawing();
  return {
    version: 'landmarks-0.9.7', meta: {name, createdAt: 1, updatedAt: 2}, curves: [], centerlineOrder: [], landmarks: [], views: [],
    drawing, drawingSnapshots: {version: 1, activeId: 'art', items: [{id: 'art', name: 'Artwork', drawing}], images: []},
    drawingWorkingCopies: {art: {...drawing, mirrorAxisX: 12}},
    legacyWorkspaces: {hairstyle: {original: ['full', 'recovery', 'data']}},
  };
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function flush() {for (let i = 0; i < 12; i++) await Promise.resolve();}
function harness(records = new Map<string, ArtworkCleanupBackup>()) {
  let sequence = 0;
  const database: ArtworkCleanupBackupDatabase = {
    write: vi.fn(async entry => {
      if (records.has(entry.id)) throw new DOMException('Duplicate backup identifier', 'ConstraintError');
      records.set(entry.id, structuredClone(entry));
    }),
    read: vi.fn(async id => records.has(id) ? structuredClone(records.get(id)) : undefined),
    list: vi.fn(async () => [...records.values()].map(entry => structuredClone(entry))),
    close: vi.fn(),
  };
  const openDatabase = vi.fn(async () => database);
  const service = createArtworkCleanupBackupStorage({openDatabase, now: () => 100 + sequence, createId: () => `backup-${++sequence}`});
  return {records, database, openDatabase, service};
}
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});

describe('artwork cleanup recovery storage', () => {
  it('captures exact full project JSON without adding recovery data to the source project', async () => {
    const h = harness(), source = project(), before = JSON.stringify(source);
    Object.freeze(source.meta); Object.freeze(source);
    const saved = await h.service.createArtworkCleanupBackup(source, 'cleanup');
    expect(saved).toEqual({id: 'backup-1', createdAt: 101, reason: 'cleanup', projectName: 'Untouched project', artworkCount: 1});
    expect(Object.keys(saved)).not.toContain('serialized');
    expect(await h.service.readArtworkCleanupBackup(saved.id)).toEqual({...saved, serialized: before});
    expect(JSON.stringify(source)).toBe(before);
    expect(h.database.close).toHaveBeenCalledTimes(2);
  });

  it('does not release dependent cleanup until commit and exact readback both finish', async () => {
    const h = harness(), source = project(), commit = deferred(), readback = deferred<unknown>();
    vi.mocked(h.database.write).mockImplementationOnce(() => commit.promise);
    vi.mocked(h.database.read).mockImplementationOnce(() => readback.promise);
    const cleanup = vi.fn();
    const pending = h.service.createArtworkCleanupBackup(source, 'cleanup').then(cleanup);
    await flush();
    expect(h.database.write).toHaveBeenCalledTimes(1);
    expect(h.database.read).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
    commit.resolve(); await flush();
    expect(h.database.read).toHaveBeenCalledWith('backup-1'); expect(cleanup).not.toHaveBeenCalled();
    readback.resolve(structuredClone(vi.mocked(h.database.write).mock.calls[0][0]));
    await pending; expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'different bytes', 'different metadata'])('rejects %s readback without running dependent cleanup', async mismatch => {
    const h = harness(), source = project(), before = JSON.stringify(source), cleanup = vi.fn();
    vi.mocked(h.database.read).mockImplementationOnce(async id => {
      const entry = h.records.get(id)!;
      if (mismatch === 'missing') return undefined;
      if (mismatch === 'different metadata') return {...entry, projectName: 'Other project'};
      return {...entry, serialized: `${entry.serialized} `};
    });
    await expect(h.service.createArtworkCleanupBackup(source, 'cleanup').then(cleanup)).rejects.toThrow(/cannot be read|verification failed/);
    expect(cleanup).not.toHaveBeenCalled(); expect(JSON.stringify(source)).toBe(before);
    expect(h.database.close).toHaveBeenCalledTimes(1);
  });

  it('rejects quota and read failures, leaves prior backups intact, and permits a later retry', async () => {
    const h = harness(), source = project(), cleanup = vi.fn();
    const original = await h.service.createArtworkCleanupBackup(source, 'cleanup');
    vi.mocked(h.database.write).mockRejectedValueOnce(new DOMException('Quota exceeded', 'QuotaExceededError'));
    await expect(h.service.createArtworkCleanupBackup(source, 'cleanup').then(cleanup)).rejects.toThrow('storage is full');
    expect(h.records.size).toBe(1);
    vi.mocked(h.database.read).mockRejectedValueOnce(new Error('Read transaction aborted'));
    await expect(h.service.createArtworkCleanupBackup(source, 'before-restore').then(cleanup)).rejects.toThrow('Read transaction aborted');
    expect(cleanup).not.toHaveBeenCalled();
    await h.service.createArtworkCleanupBackup(project('Retry'), 'cleanup');
    expect((await h.service.readArtworkCleanupBackup(original.id))?.serialized).toBe(JSON.stringify(source));
    expect(h.records.size).toBe(3); // Even an unverified write is never pruned.
  });

  it.each(['IndexedDB unavailable', 'Storage blocked by another tab'])('fails closed on %s with no localStorage fallback', async message => {
    const h = harness(), localStorage = {setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn()};
    vi.stubGlobal('localStorage', localStorage);
    h.openDatabase.mockRejectedValue(new Error(message));
    const cleanup = vi.fn();
    await expect(h.service.createArtworkCleanupBackup(project(), 'cleanup').then(cleanup)).rejects.toThrow(message);
    expect(cleanup).not.toHaveBeenCalled(); expect(h.database.write).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled(); expect(localStorage.getItem).not.toHaveBeenCalled(); expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('queues overlapping backups through verification and captures each invocation before subsequent edits', async () => {
    const h = harness(), firstCommit = deferred(), source = project('First');
    vi.mocked(h.database.write).mockImplementationOnce(async entry => {await firstCommit.promise; h.records.set(entry.id, structuredClone(entry));});
    const first = h.service.createArtworkCleanupBackup(source, 'cleanup');
    source.meta.name = 'Second'; const secondBytes = JSON.stringify(source);
    const second = h.service.createArtworkCleanupBackup(source, 'before-restore');
    source.meta.name = 'Newer edit';
    const listed = h.service.listArtworkCleanupBackups();
    await flush(); expect(h.database.write).toHaveBeenCalledTimes(1); expect(h.database.list).not.toHaveBeenCalled();
    firstCommit.resolve(); await Promise.all([first, second]);
    expect(h.records.get('backup-1')?.projectName).toBe('First');
    expect(h.records.get('backup-2')?.serialized).toBe(secondBytes);
    expect((await listed).map(item => item.id)).toEqual(['backup-2', 'backup-1']);
  });

  it('lists metadata newest first and reads retained backup bytes from a fresh service', async () => {
    const h = harness();
    await h.service.createArtworkCleanupBackup(project('Older'), 'cleanup');
    await h.service.createArtworkCleanupBackup(project('Newer'), 'before-restore');
    const reloaded = createArtworkCleanupBackupStorage({openDatabase: h.openDatabase});
    const entries = await reloaded.listArtworkCleanupBackups();
    expect(entries.map(entry => [entry.projectName, entry.reason])).toEqual([['Newer', 'before-restore'], ['Older', 'cleanup']]);
    expect(entries.every(entry => !Object.hasOwn(entry, 'serialized'))).toBe(true);
    entries[0].projectName = 'UI changed metadata';
    expect((await reloaded.readArtworkCleanupBackup('backup-2'))?.projectName).toBe('Newer');
    expect((await reloaded.readArtworkCleanupBackup('backup-1'))?.serialized).toBe(JSON.stringify(project('Older')));
    expect(await reloaded.readArtworkCleanupBackup('missing')).toBeUndefined();
    expect(h.records.size).toBe(2);
  });

  it('never replaces an existing backup on identifier collision', async () => {
    const h = harness();
    const saved = await h.service.createArtworkCleanupBackup(project('Original'), 'cleanup');
    const colliding = createArtworkCleanupBackupStorage({openDatabase: h.openDatabase, createId: () => saved.id});
    await expect(colliding.createArtworkCleanupBackup(project('Replacement'), 'cleanup')).rejects.toThrow('Duplicate backup identifier');
    expect(h.records.size).toBe(1);
    expect((await h.service.readArtworkCleanupBackup(saved.id))?.projectName).toBe('Original');
  });

  it('rejects unserializable source before opening storage or mutating the project', async () => {
    const h = harness(), source = project();
    source.legacyWorkspaces = {recording: source};
    await expect(h.service.createArtworkCleanupBackup(source, 'cleanup')).rejects.toThrow(/circular/i);
    expect(h.openDatabase).not.toHaveBeenCalled(); expect(source.legacyWorkspaces.recording).toBe(source);
  });
});

/** Small lifecycle fake: request success deliberately does not commit the transaction. */
function idbHarness() {
  const transactions: any[] = [], request: any = {};
  const db: any = {
    close: vi.fn(), createObjectStore: vi.fn(), objectStoreNames: {contains: () => false},
    transaction: vi.fn(() => {
      const requests: any[] = [], tx: any = {error: null, requests, abort: vi.fn(() => tx.onabort?.())};
      tx.objectStore = (store: string) => ({
        add: (value: unknown) => {const entry = {kind: 'add', store, value}; requests.push(entry); return entry;},
        get: (key: string) => {const entry = {kind: 'get', store, key}; requests.push(entry); return entry;},
        getAll: () => {const entry = {kind: 'getAll', store}; requests.push(entry); return entry;},
      });
      transactions.push(tx); return tx;
    }),
  };
  request.result = db;
  const factory = {open: vi.fn(() => request)} as unknown as IDBFactory;
  return {factory, request, db, transactions};
}
const backup: ArtworkCleanupBackup = {id: 'safe', createdAt: 123, reason: 'cleanup', projectName: 'Original', artworkCount: 0, serialized: '{"project":"unchanged"}'};

describe('artwork cleanup IndexedDB lifecycle', () => {
  it('uses an isolated database and an id-keyed, insert-only store', async () => {
    const h = idbHarness(), pending = openArtworkCleanupBackupDatabase(h.factory);
    expect(h.factory.open).toHaveBeenCalledWith(ARTWORK_CLEANUP_DATABASE_NAME, ARTWORK_CLEANUP_DATABASE_VERSION);
    h.request.onupgradeneeded();
    expect(h.db.createObjectStore).toHaveBeenCalledWith(ARTWORK_CLEANUP_BACKUP_STORE, {keyPath: 'id'});
    h.request.onsuccess(); const db = await pending;
    const writing = db.write(backup);
    expect(h.transactions[0].requests[0]).toMatchObject({kind: 'add', store: ARTWORK_CLEANUP_BACKUP_STORE, value: backup});
    h.transactions[0].oncomplete(); await writing;
    h.db.onversionchange(); expect(h.db.close).toHaveBeenCalledTimes(1);
  });

  it('waits for transaction completion and rejects an abort after insert success', async () => {
    const h = idbHarness(), opening = openArtworkCleanupBackupDatabase(h.factory); h.request.onsuccess(); const db = await opening;
    let complete = false; const writing = db.write(backup).then(() => {complete = true;});
    const tx = h.transactions[0]; tx.requests[0].result = backup.id; tx.requests[0].onsuccess(); await flush();
    expect(complete).toBe(false); tx.oncomplete(); await writing; expect(complete).toBe(true);
    const rejected = db.write({...backup, id: 'later'}), check = expect(rejected).rejects.toThrow('quota');
    const failed = h.transactions[1]; failed.requests[0].onsuccess(); failed.error = new DOMException('quota', 'QuotaExceededError'); failed.onabort(); await check;
  });

  it('waits for read and list transactions to complete before exposing results', async () => {
    const h = idbHarness(), opening = openArtworkCleanupBackupDatabase(h.factory); h.request.onsuccess(); const db = await opening;
    let complete = false; const reading = db.read('safe').then(value => {complete = true; return value;});
    const tx = h.transactions[0]; tx.requests[0].result = backup; tx.requests[0].onsuccess(); await flush();
    expect(complete).toBe(false); tx.oncomplete(); expect(await reading).toEqual(backup);
    const listing = db.list(), listTx = h.transactions[1];
    expect(listTx.requests[0].kind).toBe('getAll'); listTx.requests[0].result = [backup]; listTx.requests[0].onsuccess(); listTx.oncomplete();
    expect(await listing).toEqual([backup]);
  });

  it('fails blocked or unavailable opens and closes a late successful connection', async () => {
    await expect(openArtworkCleanupBackupDatabase(undefined)).rejects.toThrow('not available');
    const h = idbHarness(), pending = openArtworkCleanupBackupDatabase(h.factory), check = expect(pending).rejects.toThrow('blocked');
    h.request.onblocked(); await check; h.request.onsuccess(); expect(h.db.close).toHaveBeenCalledTimes(1);
  });

  it('times out a hung connection and aborts a late upgrade', async () => {
    vi.useFakeTimers();
    const h = idbHarness(), pending = openArtworkCleanupBackupDatabase(h.factory, 100), check = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100); await check;
    h.request.transaction = {abort: vi.fn()}; h.request.onupgradeneeded();
    expect(h.request.transaction.abort).toHaveBeenCalledTimes(1); expect(h.db.createObjectStore).not.toHaveBeenCalled();
    h.request.onsuccess(); expect(h.db.close).toHaveBeenCalledTimes(1);
  });

  it('propagates synchronous open, transaction, and request failures without pending promises', async () => {
    const denied = {open: () => {throw new DOMException('denied', 'SecurityError');}} as unknown as IDBFactory;
    await expect(openArtworkCleanupBackupDatabase(denied)).rejects.toThrow('denied');
    const h = idbHarness(), pending = openArtworkCleanupBackupDatabase(h.factory); h.request.onsuccess(); const db = await pending;
    h.db.transaction.mockImplementationOnce(() => {throw new Error('closed connection');});
    await expect(db.read('safe')).rejects.toThrow('closed connection');
    const abort = vi.fn();
    h.db.transaction.mockImplementationOnce(() => ({abort, objectStore: () => ({add: () => {throw new Error('insert denied');}})}));
    await expect(db.write(backup)).rejects.toThrow('insert denied'); expect(abort).toHaveBeenCalledTimes(1);
  });
});
