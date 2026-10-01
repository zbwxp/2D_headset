import {describe, expect, it, vi} from 'vitest';
import {createProjectStorage, openProjectDatabase, LEGACY_PROJECT_KEYS, PROJECT_AUTOSAVE_STORE, PROJECT_RECOVERY_STORE, type ProjectStorageDatabase} from '../app/projectStorage';

const json = (name: string) => JSON.stringify({name});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function flush() {for (let i = 0; i < 12; i++) await Promise.resolve();}
function harness(initial: unknown = undefined, legacy: Record<string, string> = {}) {
  let saved = initial;
  const backups: unknown[] = [];
  const db: ProjectStorageDatabase = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value, preserve) => {if (preserve && saved !== undefined) backups.push(saved); saved = value;}),
    close: vi.fn(),
  };
  const open = vi.fn(async () => db);
  const getItem = vi.fn((key: string) => legacy[key] ?? null);
  const service = createProjectStorage({openDatabase: open, legacyStorage: () => ({getItem}), now: () => 12345});
  return {service, db, open, getItem, backups, saved: () => saved, legacy};
}

describe('durable project storage service', () => {
  it('preloads IndexedDB ahead of a stale legacy save and prepares only once', async () => {
    const h = harness(json('current'), {[LEGACY_PROJECT_KEYS[0]]: json('old')});
    expect(h.service.getStorageStatus()).toMatchObject({state: 'idle', backend: 'none'});
    await Promise.all([h.service.prepareProjectStorage(), h.service.prepareProjectStorage()]);
    expect(h.service.getInitialAutosave()).toBe(json('current'));
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.getItem).not.toHaveBeenCalled();
    expect(h.db.write).not.toHaveBeenCalled();
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saved', backend: 'indexeddb'});
  });

  it('migrates a legacy save only after verified completion and never deletes legacy bytes', async () => {
    const h = harness(undefined, {[LEGACY_PROJECT_KEYS[2]]: json('legacy')});
    const commit = deferred();
    vi.mocked(h.db.write).mockImplementationOnce(() => commit.promise);
    let finished = false;
    const preparation = h.service.prepareProjectStorage().then(() => {finished = true;});
    await flush();
    expect(h.service.getInitialAutosave()).toBe(json('legacy'));
    expect(h.service.getStorageStatus().state).toBe('saving');
    expect(finished).toBe(false);
    expect(h.legacy[LEGACY_PROJECT_KEYS[2]]).toBe(json('legacy'));
    commit.resolve(); await preparation;
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saved', backend: 'indexeddb', updatedAt: 12345});
    expect(h.db.write).toHaveBeenCalledWith(json('legacy'), false);
  });

  it('keeps startup usable after blocked/unavailable DB, exposes fallback and rejects writes', async () => {
    const h = harness(undefined, {[LEGACY_PROJECT_KEYS[0]]: json('recoverable')});
    h.open.mockRejectedValue(new Error('blocked by another tab'));
    await expect(h.service.prepareProjectStorage()).resolves.toBeUndefined();
    expect(h.service.getInitialAutosave()).toBe(json('recoverable'));
    expect(h.service.getStorageStatus()).toMatchObject({state: 'error', backend: 'localStorage'});
    await expect(h.service.saveDurableProject(json('new'))).rejects.toThrow('Export JSON');
    expect(h.db.write).not.toHaveBeenCalled();
    expect(h.legacy[LEGACY_PROJECT_KEYS[0]]).toBe(json('recoverable'));
  });

  it('does not overwrite a primary that cannot be read, even when legacy fallback is readable', async () => {
    const h = harness(json('primary'), {[LEGACY_PROJECT_KEYS[0]]: json('fallback')});
    vi.mocked(h.db.read).mockRejectedValue(new Error('read transaction aborted'));
    await h.service.prepareProjectStorage();
    expect(h.service.getInitialAutosave()).toBe(json('fallback'));
    expect(h.db.close).toHaveBeenCalled();
    await expect(h.service.saveDurableProject(json('new'))).rejects.toThrow('read transaction aborted');
    expect(h.db.write).not.toHaveBeenCalled(); expect(h.saved()).toBe(json('primary'));
  });

  it('can save before explicit preload without manufacturing a legacy value', async () => {
    const h = harness();
    expect(h.service.getInitialAutosave()).toBeUndefined();
    await h.service.saveDurableProject(json('first'));
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.db.write).toHaveBeenCalledTimes(1);
    expect(h.saved()).toBe(json('first'));
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saved', backend: 'indexeddb', pendingWrites: 0});
  });

  it('reports migration quota errors while retaining readable initial and original data', async () => {
    const h = harness(undefined, {[LEGACY_PROJECT_KEYS[0]]: json('large')});
    vi.mocked(h.db.write).mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
    await h.service.prepareProjectStorage();
    expect(h.service.getInitialAutosave()).toBe(json('large'));
    expect(h.service.getStorageStatus().error).toContain('storage is full');
    expect(h.legacy[LEGACY_PROJECT_KEYS[0]]).toBe(json('large'));
    expect(h.saved()).toBeUndefined();
  });

  it('preserves corrupt primary text for loader recovery, never silently rolls back to older data', async () => {
    const h = harness('{broken', {[LEGACY_PROJECT_KEYS[0]]: json('older')});
    await h.service.prepareProjectStorage();
    expect(h.service.getInitialAutosave()).toBe('{broken');
    expect(h.service.getStorageStatus()).toMatchObject({state: 'error', recoveryAvailable: true});
    expect(h.db.write).not.toHaveBeenCalled();
    await h.service.saveDurableProject(json('explicit later save'));
    expect(h.db.write).toHaveBeenCalledWith(json('explicit later save'), true);
    expect(h.backups).toEqual(['{broken']);
    expect(h.saved()).toBe(json('explicit later save'));
  });

  it('returns corrupt legacy presence unchanged without migrating or deleting it', async () => {
    const h = harness(undefined, {[LEGACY_PROJECT_KEYS[0]]: '{broken', [LEGACY_PROJECT_KEYS[1]]: json('older')});
    await h.service.prepareProjectStorage();
    expect(h.service.getInitialAutosave()).toBe('{broken');
    expect(h.db.write).not.toHaveBeenCalled();
    expect(h.service.getStorageStatus()).toMatchObject({state: 'error', recoveryAvailable: true});
  });

  it('retains schema-invalid JSON identified by the domain loader, including after a failed save reconnect', async () => {
    const original = json('schema-invalid'), h = harness(original);
    await h.service.prepareProjectStorage();
    h.service.markInitialAutosaveUnreadable();
    expect(h.service.getStorageStatus()).toMatchObject({state: 'error', recoveryAvailable: true});
    vi.mocked(h.db.write).mockRejectedValueOnce(new Error('transaction aborted'));
    await expect(h.service.saveDurableProject(json('new'))).rejects.toThrow('aborted');
    expect(h.saved()).toBe(original);
    await h.service.saveDurableProject(json('retry'));
    expect(h.db.write).toHaveBeenNthCalledWith(1, json('new'), true);
    expect(h.db.write).toHaveBeenNthCalledWith(2, json('retry'), true);
    expect(h.backups).toEqual([original]);
  });

  it('backs up a malformed non-string primary atomically before valid legacy migration', async () => {
    const invalid = {unexpected: 'stored type'}, h = harness(invalid, {[LEGACY_PROJECT_KEYS[0]]: json('legacy')});
    await h.service.prepareProjectStorage();
    expect(h.backups).toEqual([invalid]);
    expect(h.saved()).toBe(json('legacy'));
    expect(h.service.getInitialAutosave()).toBe(json('legacy'));
  });

  it('serializes concurrent saves through completion so the newest requested value wins', async () => {
    const h = harness(json('base')), first = deferred(), second = deferred();
    await h.service.prepareProjectStorage();
    vi.mocked(h.db.write).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const a = h.service.saveDurableProject(json('A')), b = h.service.saveDurableProject(json('B'));
    await flush();
    expect(h.db.write).toHaveBeenCalledTimes(1);
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saving', pendingWrites: 2});
    first.resolve(); await a; await flush();
    expect(h.db.write).toHaveBeenNthCalledWith(2, json('B'), false);
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saving', pendingWrites: 1});
    second.resolve(); await b;
    expect(h.service.getInitialAutosave()).toBe(json('B'));
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saved', pendingWrites: 0});
  });

  it('a failed earlier transaction rejects its caller without poisoning the next save', async () => {
    const h = harness(json('base')), first = deferred();
    await h.service.prepareProjectStorage();
    vi.mocked(h.db.write).mockImplementationOnce(() => first.promise);
    const a = h.service.saveDurableProject(json('A'));
    const rejected = expect(a).rejects.toThrow('aborted');
    const b = h.service.saveDurableProject(json('B'));
    await flush(); first.reject(new Error('aborted'));
    await rejected; await b;
    expect(h.saved()).toBe(json('B'));
    expect(h.open).toHaveBeenCalledTimes(2);
    expect(h.service.getStorageStatus()).toMatchObject({state: 'saved', pendingWrites: 0, error: undefined});
  });

  it('rejects malformed outgoing JSON before any write and tolerates denied legacy access', async () => {
    const h = harness(json('good'));
    await expect(h.service.saveDurableProject('null')).rejects.toThrow('valid JSON object');
    await expect(h.service.saveDurableProject('{bad')).rejects.toThrow('valid JSON object');
    expect(h.open).not.toHaveBeenCalled(); expect(h.saved()).toBe(json('good'));
    const denied = createProjectStorage({openDatabase: h.open, legacyStorage: () => {throw new Error('denied');}});
    await expect(denied.prepareProjectStorage()).resolves.toBeUndefined();
  });

  it('status snapshots are stable and immutable, with isolated unsubscribable observers', async () => {
    const h = harness(json('base')), listener = vi.fn();
    const unsubscribe = h.service.subscribeStorageStatus(listener);
    h.service.subscribe(() => {throw new Error('UI error');});
    const snapshot = h.service.getStorageStatus();
    expect(h.service.getStorageStatus()).toBe(snapshot); expect(Object.isFrozen(snapshot)).toBe(true);
    await h.service.prepareProjectStorage(); unsubscribe();
    const calls = listener.mock.calls.length;
    await h.service.saveDurableProject(json('next'));
    expect(listener).toHaveBeenCalledTimes(calls); expect(h.saved()).toBe(json('next'));
  });
});

/** Minimal IDB request harness: deliberately separates request success and commit. */
function idbHarness() {
  const transactions: any[] = [], openRequest: any = {};
  const db: any = {close: vi.fn(), objectStoreNames: {contains: () => true}, transaction: vi.fn(() => {
    const requests: any[] = [], tx: any = {error: null, requests, abort: vi.fn(() => tx.onabort?.())};
    tx.objectStore = (name: string) => ({
      get: vi.fn(() => {const request: any = {kind: 'get', store: name}; requests.push(request); return request;}),
      put: vi.fn((value: unknown, key?: string) => {const request: any = {kind: 'put', store: name, value, key}; requests.push(request); return request;}),
    });
    transactions.push(tx); return tx;
  })};
  openRequest.result = db;
  const factory = {open: vi.fn(() => openRequest)} as unknown as IDBFactory;
  return {factory, openRequest, db, transactions};
}
describe('IndexedDB transaction adapter', () => {
  it('waits for commit after put success and propagates a subsequent abort', async () => {
    const h = idbHarness(), pending = openProjectDatabase(h.factory); h.openRequest.onsuccess(); const db = await pending;
    let completed = false;
    const save = db.write(json('next'), false).then(() => {completed = true;});
    const tx = h.transactions[0]; tx.requests[0].onsuccess?.(); await flush();
    expect(completed).toBe(false);
    tx.oncomplete(); await save; expect(completed).toBe(true);
    const aborted = db.write(json('lost'), false), check = expect(aborted).rejects.toThrow('quota');
    const next = h.transactions[1]; next.requests[0].onsuccess?.(); next.error = new DOMException('quota', 'QuotaExceededError'); next.onabort(); await check;
  });

  it('reads only on transaction completion and writes backup in the same replacement transaction', async () => {
    const h = idbHarness(), pending = openProjectDatabase(h.factory); h.openRequest.onsuccess(); const db = await pending;
    let loaded = false; const read = db.read().then(value => {loaded = true; return value;});
    const reading = h.transactions[0]; reading.requests[0].result = json('old'); reading.requests[0].onsuccess(); await flush();
    expect(loaded).toBe(false); reading.oncomplete(); expect(await read).toBe(json('old'));
    const writing = db.write(json('new'), true), tx = h.transactions[1];
    tx.requests[0].result = '{broken'; tx.requests[0].onsuccess();
    expect(tx.requests.map((r: any) => [r.kind, r.store])).toEqual([['get', PROJECT_AUTOSAVE_STORE], ['put', PROJECT_RECOVERY_STORE], ['put', PROJECT_AUTOSAVE_STORE]]);
    expect(tx.requests[1].value.value).toBe('{broken'); tx.oncomplete(); await writing;
  });

  it('fails promptly for blocked/unavailable storage and closes late successful opens', async () => {
    await expect(openProjectDatabase(undefined)).rejects.toThrow('not available');
    const h = idbHarness(), pending = openProjectDatabase(h.factory), failed = expect(pending).rejects.toThrow('blocked');
    h.openRequest.onblocked(); await failed; h.openRequest.onsuccess(); expect(h.db.close).toHaveBeenCalledTimes(1);
  });

  it('propagates synchronous open/transaction/request exceptions instead of leaving a pending promise', async () => {
    const denied = {open: () => {throw new DOMException('denied', 'SecurityError');}} as unknown as IDBFactory;
    await expect(openProjectDatabase(denied)).rejects.toThrow('denied');
    const h = idbHarness(), pending = openProjectDatabase(h.factory); h.openRequest.onsuccess(); const db = await pending;
    h.db.transaction.mockImplementationOnce(() => {throw new Error('connection closed');});
    await expect(db.read()).rejects.toThrow('connection closed');
    h.db.transaction.mockImplementationOnce(() => ({objectStore: () => ({get: () => {throw new Error('read denied');}})}));
    await expect(db.read()).rejects.toThrow('read denied');
    h.db.transaction.mockImplementationOnce(() => {throw new Error('write unavailable');});
    await expect(db.write(json('new'), false)).rejects.toThrow('write unavailable');
  });

  it('times out a hung open and closes it if it later succeeds', async () => {
    vi.useFakeTimers();
    try {
      const h = idbHarness(), pending = openProjectDatabase(h.factory, 100), failed = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(100); await failed;
      h.openRequest.onsuccess(); expect(h.db.close).toHaveBeenCalledTimes(1);
    } finally {vi.useRealTimers();}
  });
});
