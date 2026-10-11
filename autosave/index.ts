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
  /** The drawing may have changed: a new text is saved, in order; the same text again does nothing. */
  want(): void
  /** Try the newest text again after a failure (an explicit retry, not a re-render). */
  retry(): void
  status(): Status
  /** Whether the newest text is not on disk (for the leave-page prompt); with autosave off, whether anything changed since. */
  unsaved(): boolean
  /** Take no new saves. Text already asked for is still written (the page's next instance waits for it). */
  dispose(): void
}

export const CURRENT = 'current'

// one writer per page (dot 1791704242, 1791705088, 1791705181): a new instance waits until the previous
// one's queue has drained (its newest text written, or failed) before it reads or writes; the previous
// one takes no new saves once replaced. So the store is never read before a pending newer text lands,
// and never written by two instances at once.
let owner: object | null = null
let previousIdle: () => Promise<void> = () => Promise.resolve()

export function createAutosave(store: Store, o: Options): Autosave {
  const me = {}
  const before = previousIdle
  owner = me
  let state: State = 'restoring', error: string | undefined, notice: string | undefined
  let disposed = false, writing = false
  /** The text last durably written; the newest text asked for; with autosave off, the text when it went off. */
  let disk: string | undefined, wanted: string | undefined, offBase: string | undefined
  let idleWaiters: (() => void)[] = []
  const idle = () => (!writing && (wanted === undefined || wanted === disk || error !== undefined) ? Promise.resolve() : new Promise<void>(r => { idleWaiters.push(r) }))
  previousIdle = idle
  const accepting = () => !disposed && owner === me
  const notify = () => { if (!disposed) o.changed() }
  const set = (s: State, e?: string) => { if (s === state && e === error) return; state = s; error = e; notify() }
  const settle = () => {
    if (state === 'off' || state === 'restoring') return
    if (error !== undefined) set('failed', error)
    else set(writing || (wanted !== undefined && wanted !== disk) ? 'saving' : 'saved')
  }
  const pump = async () => {
    if (writing) return
    // after every write, the newest wanted text is compared again with the disk (A → B → undo A writes A).
    // A replaced or disposed instance still finishes what it was asked for; the next one waits for it.
    while (wanted !== undefined && wanted !== disk) {
      const text = wanted
      writing = true; settle()
      try {
        await store.put(CURRENT, text)
        disk = text
        error = undefined
      } catch (err) {
        // a failure keeps the baseline, the newest text and the error until a write succeeds; only a
        // new text or an explicit retry tries again, never a mere re-render (dot 1791705120)
        writing = false
        set('failed', (err as Error)?.message ?? String(err))
        break
      }
      writing = false
    }
    writing = false
    settle()
    if (!writing) { const w = idleWaiters; idleWaiters = []; for (const r of w) r() }
  }
  const off = (why: string) => { if (accepting()) { offBase = o.current(); state = 'off'; error = why; notify() } }

  return {
    async start() {
      await before() // the previous instance's newest text lands first (dot 1791705181)
      if (!accepting()) return // unmounted or replaced: a late restore changes nothing
      let stored: string | undefined
      try { stored = await store.get(CURRENT) } catch (err) { off(`could not read the saved drawing: ${(err as Error)?.message ?? err}`); return }
      if (!accepting()) return
      if (stored !== undefined) {
        try { o.apply(stored); disk = stored }
        catch (err) {
          // never overwritten silently: backed up first; if the backup fails, autosave stays off
          const key = `unreadable-${(o.now ?? Date.now)()}`
          try { await store.put(key, stored) } catch (e) { off(`the saved drawing does not open and could not be backed up: ${(e as Error)?.message ?? e}`); return }
          if (!accepting()) return
          notice = `the saved drawing did not open (${(err as Error)?.message ?? err}); it was kept as ${key}`
        }
      }
      state = 'saved'; notify()
      // restoring has ended here; the first save runs on in the queue
      wanted = o.current()
      void pump()
    },
    want() {
      if (!accepting() || state === 'restoring' || state === 'off') return
      const text = o.current()
      if (text === wanted) return // nothing new: a re-render never retries a failure
      wanted = text
      void pump()
    },
    retry() { if (accepting() && state === 'failed') void pump() },
    status: () => ({ state, ...(error !== undefined ? { error } : {}), ...(notice !== undefined ? { notice } : {}) }),
    unsaved() {
      if (state === 'restoring') return false
      // autosave off is not "saved": anything drawn since it went off is unsaved (dot 1791705120)
      if (state === 'off') return offBase !== undefined && o.current() !== offBase
      return writing || (wanted !== undefined && wanted !== disk)
    },
    dispose() { disposed = true; if (owner === me) owner = null },
  }
}

/** @internal for tests: forget the page's writer. */
export function resetPage() { owner = null; previousIdle = () => Promise.resolve() }
