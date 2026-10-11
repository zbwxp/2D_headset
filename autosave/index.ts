// autosave — the bench's drawing kept in the browser across a refresh (docs/autosave-plan.md; bowen
// 1791703721, 1791703731: a separate package, to be refactored later; dot 1791703953, 1791704170,
// 1791704242, 1791704319). It stores and returns text; what the text means (save / open) is the bench's.

/** Where the text lives. `put` resolves only when the write is durable (an IndexedDB transaction's `complete`). */
export interface Store {
  get(key: string): Promise<string | undefined>
  put(key: string, value: string): Promise<void>
}

/** The browser's IndexedDB, one object store of text records. `put` resolves on the transaction's complete, and rejects on abort or error. */
export function indexedDbStore(dbName = 'headset-bench'): Store {
  let db: Promise<IDBDatabase> | undefined
  const open = () => (db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(dbName, 1)
    r.onupgradeneeded = () => { r.result.createObjectStore('kv') }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('indexedDB open failed'))
  }))
  return {
    async get(key) {
      const d = await open()
      return new Promise((resolve, reject) => {
        const tx = d.transaction('kv', 'readonly'), q = tx.objectStore('kv').get(key)
        tx.oncomplete = () => resolve(q.result as string | undefined)
        tx.onabort = () => reject(tx.error ?? new Error('read aborted'))
        tx.onerror = () => reject(tx.error ?? new Error('read failed'))
      })
    },
    async put(key, value) {
      const d = await open()
      return new Promise((resolve, reject) => {
        const tx = d.transaction('kv', 'readwrite')
        tx.objectStore('kv').put(value, key)
        // durable only when the transaction completes: a request's success is not enough (dot 1791704242)
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('write aborted'))
        tx.onerror = () => reject(tx.error ?? new Error('write failed'))
      })
    },
  }
}

export type State = 'restoring' | 'saved' | 'saving' | 'failed' | 'off'
/** `notice`: an unreadable saved drawing was kept as a backup (shown, not an error). */
export interface Status { readonly state: State; readonly error?: string; readonly notice?: string }

export interface Options {
  /** Replace the drawing with a stored text; throws if the text does not open. */
  apply(text: string): void
  /** The drawing's text now. */
  current(): string
  /** Called whenever the status changes. */
  changed(): void
  /** The time for a backup record's name (tests fix it). */
  now?(): number
}

export interface Autosave {
  /** Restore, then start saving; resolves when restoring has ended (whatever its outcome). */
  start(): Promise<void>
  /** The drawing changed: save its current text, in order. */
  want(): void
  status(): Status
  /** Whether the newest text is not yet on disk (for the leave-page prompt). */
  unsaved(): boolean
  /** Stop: no restore applied, no new saves taken, no further writes. */
  dispose(): void
}

export const CURRENT = 'current'

// one write queue per page (dot 1791704242): the newest instance owns the store; an older one stops
// writing once replaced, and the new one waits for the old one's write in flight
let owner: object | null = null
let inFlight: Promise<unknown> = Promise.resolve()

export function createAutosave(store: Store, o: Options): Autosave {
  const me = {}
  owner = me
  let state: State = 'restoring', error: string | undefined, notice: string | undefined
  let disposed = false, writing = false
  /** The text last durably written, and the newest text asked for. */
  let disk: string | undefined, wanted: string | undefined
  // the bench re-renders on every notice and asks to save on every render: notify only a real change
  const set = (s: State, e?: string) => { if (s === state && e === error) return; state = s; error = e; if (!disposed) o.changed() }
  const mine = () => !disposed && owner === me

  const settle = () => {
    if (state === 'off' || state === 'restoring') return
    if (error !== undefined) set('failed', error)
    else set(writing || (wanted !== undefined && wanted !== disk) ? 'saving' : 'saved')
  }
  const pump = async () => {
    if (writing) return
    // after every write, the newest wanted text is compared again with the disk (A → B → undo A writes A)
    while (mine() && wanted !== undefined && wanted !== disk) {
      const text = wanted
      writing = true; error = undefined; settle()
      try {
        await inFlight
        if (!mine()) break
        const w = store.put(CURRENT, text)
        inFlight = w.catch(() => undefined)
        await w
        disk = text
      } catch (err) {
        // a failure keeps the baseline and the newest text; the next change or write retries
        writing = false
        error = (err as Error)?.message ?? String(err)
        settle()
        return
      }
      writing = false
    }
    writing = false
    settle()
  }

  return {
    async start() {
      const off = (why: string) => { if (mine()) { state = 'off'; error = why; o.changed() } }
      let stored: string | undefined
      try { stored = await store.get(CURRENT) } catch (err) { off(`could not read the saved drawing: ${(err as Error)?.message ?? err}`); return }
      if (!mine()) return // unmounted or replaced: a late restore changes nothing
      if (stored !== undefined) {
        try { o.apply(stored); disk = stored }
        catch (err) {
          // never overwritten silently: backed up first; if the backup fails, autosave stays off
          const key = `unreadable-${(o.now ?? Date.now)()}`
          try { await store.put(key, stored) } catch (e) { off(`the saved drawing does not open and could not be backed up: ${(e as Error)?.message ?? e}`); return }
          if (!mine()) return
          notice = `the saved drawing did not open (${(err as Error)?.message ?? err}); it was kept as ${key}`
        }
      }
      state = 'saved'; o.changed()
      // restoring has ended here; the first save runs on in the queue
      wanted = o.current()
      void pump()
    },
    want() {
      if (!mine() || state === 'restoring' || state === 'off') return
      const text = o.current()
      if (text === wanted && (error === undefined || writing)) return // nothing new to ask for
      wanted = text
      void pump()
    },
    status: () => ({ state, ...(error !== undefined ? { error } : {}), ...(notice !== undefined ? { notice } : {}) }),
    unsaved: () => state !== 'off' && state !== 'restoring' && (writing || (wanted !== undefined && wanted !== disk) || error !== undefined),
    dispose() { disposed = true; if (owner === me) owner = null },
  }
}

/** @internal for tests: forget the page's owner and in-flight write. */
export function resetPage() { owner = null; inFlight = Promise.resolve() }
