// The single write entry ("the door"): plan → validate → write atomically → record one undo step.
// - Atomic write: @tldraw/state `transaction` rolls back every signal if the body throws (MIT):
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/state/src/lib/transactions.ts
// - Diffs for undo/redo: @tldraw/store `extractingChanges`, `reverseRecordsDiff`, `squashRecordDiffs`,
//   `applyDiff` (MIT): https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts
// - Named, nestable undo groups; no-op edits stay out of history; revision ids for dirty tracking:
//   idea ported from Compositor @ 11d8d7a (MIT), Compositor/Document/DocumentHistory.swift.
// The store itself is private: callers get a read-only view, so nothing can bypass history or locks
// by calling `store.put` (dot's review of 11ca75d).
//
// Transaction contract (dot's review of 90692ad):
// - Undo/redo stacks and revisions are @tldraw/state atoms, i.e. they live in the SAME transactional
//   state as the document. Any rollback — ours, or an outer `transaction` the caller wraps around
//   us — restores document and history together. Calling the editor inside an outer transaction is
//   therefore consistent (see the last point).
// - Subscribers (`react`, views) run after a root transaction has committed (tldraw flushes effects
//   in `commit`). An exception thrown by a subscriber does not undo the write, so the result reports
//   the write as done, plus an OBSERVER_FAILED warning — the result always describes the document.
//   If `onWarning` itself throws, that is added as WARNING_HANDLER_FAILED; nothing escapes to the caller.
//   Whether a write committed is decided by whether the transaction body finished, never assumed.
// - Supported grouping is `batch` / `applyBatch`. An outer `transaction` around the editor is not part
//   of the contract (tldraw exposes no public "is a transaction active" check to refuse it), but
//   because history lives in the same atoms, its rollback still leaves document and history consistent.
import { atom, transaction } from '@tldraw/state'
import { isRecordsDiffEmpty, reverseRecordsDiff, squashRecordDiffs, type RecordsDiff, type StoreSnapshot } from '@tldraw/store'
import { isEqual } from '@tldraw/utils'
import { plan, type Command, type EditError } from './commands'
import { graphProblems } from './model'
import { createDocStore, deepFreeze, type DocReader, type DocRecord, type DocStore } from './schema'

/** Something went wrong outside the write itself (e.g. a subscriber threw); the write stands. */
export type EditWarning = { code: 'OBSERVER_FAILED' | 'WARNING_HANDLER_FAILED'; message: string }

export type ApplyResult =
  | { ok: true; written: true; revision: number; affected: string[]; warnings?: EditWarning[] }
  | { ok: true; written: false; revision: number; affected: string[] } // valid but changed nothing
  | { ok: false; written: false; revision: number; error: EditError }

export type PreviewResult = { ok: true; affected: string[]; puts: DocRecord[] } | { ok: false; error: EditError }

type Entry = { label: string; diff: RecordsDiff<DocRecord>; revision: number }
type Group = { label: string; diffs: RecordsDiff<DocRecord>[] }

export class Editor {
  readonly #store: DocStore
  /** Read-only view for evaluation, views and the API. */
  readonly reader: DocReader
  // History state is transactional (atoms): rolled back together with the document.
  readonly #undo = atom<Entry[]>('undo', [])
  readonly #redo = atom<Entry[]>('redo', [])
  readonly #revision = atom('revision', 0)
  readonly #saved = atom('savedRevision', 0)
  private group: Group | null = null
  /**
   * Monotonic: a revision id is never reused, so "saved" can't match a different edit (dot #1).
   * Deliberately NOT an atom: an aborted transaction must not hand its revision id out again.
   */
  private nextRevision = 1
  /** Called for subscriber failures after a committed write/undo/redo (default: console.warn). */
  onWarning: (w: EditWarning) => void = (w) => console.warn(`[contour] ${w.code}: ${w.message}`)

  get revision() {
    return this.#revision.get()
  }
  get savedRevision() {
    return this.#saved.get()
  }

  constructor(initial: DocRecord[] = []) {
    this.#store = createDocStore()
    if (initial.length) this.#store.put(initial.map((r) => deepFreeze(structuredClone(r))), 'initialize')
    const s = this.#store
    this.reader = {
      get: s.get.bind(s) as DocStore['get'],
      allRecords: s.allRecords.bind(s),
      getStoreSnapshot: s.getStoreSnapshot.bind(s),
      serialize: s.serialize.bind(s),
    }
  }

  get isDirty() {
    return this.revision !== this.savedRevision
  }

  /** Plan without writing. Same validation as `apply`. */
  preview(cmd: Command): PreviewResult {
    const p = plan(this.reader, cmd)
    // Planned records are fresh objects; freeze them so a preview can't be mistaken for a writable doc.
    return p.ok ? { ok: true, affected: p.affected, puts: p.puts.map(deepFreeze) } : { ok: false, error: p.error }
  }

  /** The only path that writes author data. */
  apply(cmd: Command): ApplyResult {
    const p = plan(this.reader, cmd)
    if (!p.ok) return { ok: false, written: false, revision: this.revision, error: p.error }
    // Records equal to what is stored are not written: no-op edits never touch history (dot #3).
    const changed = p.puts.filter((r) => !isEqual(this.#store.get(r.id), r)).map(deepFreeze)
    if (!changed.length) return { ok: true, written: false, revision: this.revision, affected: p.affected }
    let diff: RecordsDiff<DocRecord> | undefined
    const run = this.commit(() => {
      diff = this.#store.extractingChanges(() => this.#store.put(changed))
      // recorded INSIDE the transaction: document and history commit or roll back together
      if (!isRecordsDiffEmpty(diff)) this.record(p.label, diff)
    })
    if (!run.committed)
      // Unexpected (planning should have caught it); the transaction rolled back document AND history.
      return { ok: false, written: false, revision: this.revision, error: { code: 'INTERNAL', message: run.error, objects: p.affected, fixes: [] } }
    if (!diff || isRecordsDiffEmpty(diff)) return { ok: true, written: false, revision: this.revision, affected: p.affected }
    return { ok: true, written: true, revision: this.revision, affected: p.affected, ...(run.warnings.length && { warnings: run.warnings }) }
  }

  /**
   * Run `body` in a transaction. committed = the body finished (so the transaction committed);
   * an exception after that came from a subscriber during the flush and is a warning, not a failure.
   */
  private commit(body: () => void): { committed: true; warnings: EditWarning[] } | { committed: false; error: string } {
    let finished = false
    try {
      transaction(() => {
        body()
        finished = true
      })
      return { committed: true, warnings: [] }
    } catch (e) {
      const message = String((e as Error)?.message ?? e)
      if (!finished) return { committed: false, error: message }
      const warnings: EditWarning[] = [{ code: 'OBSERVER_FAILED', message }]
      try {
        this.onWarning(warnings[0])
      } catch (h) {
        // The report channel itself failed: still return the truth, with both failures in the result.
        warnings.push({ code: 'WARNING_HANDLER_FAILED', message: String((h as Error)?.message ?? h) })
      }
      return { committed: true, warnings }
    }
  }

  /**
   * Several commands → one undo step (one gesture or one API batch). Nestable; outermost records.
   * If any level throws, exactly that level's changes are reverted and dropped from the group, so
   * they can never come back through redo (dot #2).
   */
  batch<T>(label: string, fn: () => T): T {
    const outer = !this.group
    if (outer) this.group = { label, diffs: [] }
    const group = this.group!
    const mark = group.diffs.length
    try {
      const result = fn()
      if (outer) {
        this.group = null
        const net = netDiff(squashRecordDiffs(group.diffs))
        // A batch whose net effect is nothing (e.g. +1 then −1) leaves history and redo alone (dot).
        if (!isRecordsDiffEmpty(net)) this.commit(() => this.pushEntry(group.label, net))
      }
      return result
    } catch (e) {
      const failed = group.diffs.splice(mark)
      if (failed.length) {
        const run = this.commit(() => this.#store.applyDiff(reverseRecordsDiff(squashRecordDiffs(failed))))
        if (!run.committed) throw new Error(`batch revert failed: ${run.error}`)
      }
      if (outer) this.group = null
      throw e
    }
  }

  private record(label: string, diff: RecordsDiff<DocRecord>) {
    if (this.group) this.group.diffs.push(diff)
    else this.pushEntry(label, diff)
  }

  private pushEntry(label: string, diff: RecordsDiff<DocRecord>) {
    const revision = this.nextRevision++
    this.#undo.update((u) => [...u, { label, diff, revision }])
    this.#redo.set([])
    this.#revision.set(revision)
  }

  undo() {
    const e = this.#undo.get().at(-1)
    if (!e) return false
    const run = this.commit(() => {
      this.#store.applyDiff(reverseRecordsDiff(e.diff))
      this.#undo.update((u) => u.slice(0, -1))
      this.#redo.update((r) => [...r, e])
      this.#revision.set(this.#undo.get().at(-1)?.revision ?? 0)
    })
    if (!run.committed) throw new Error(`undo failed and was rolled back: ${run.error}`)
    return true
  }

  redo() {
    const e = this.#redo.get().at(-1)
    if (!e) return false
    const run = this.commit(() => {
      this.#store.applyDiff(e.diff)
      this.#redo.update((r) => r.slice(0, -1))
      this.#undo.update((u) => [...u, e])
      this.#revision.set(e.revision)
    })
    if (!run.committed) throw new Error(`redo failed and was rolled back: ${run.error}`)
    return true
  }

  get history() {
    return { undo: this.#undo.get().map((e) => e.label), redo: this.#redo.get().map((e) => e.label) }
  }

  /** Save = author data only (no evaluated geometry), with schema versions for migration. */
  save(): StoreSnapshot<DocRecord> {
    const snap = this.#store.getStoreSnapshot('document')
    this.#saved.set(this.revision)
    return snap
  }

  /** Migrate, validate records and structure; throw (nothing opened) if anything is wrong. */
  static open(snapshot: StoreSnapshot<DocRecord>) {
    const editor = new Editor()
    editor.#store.loadStoreSnapshot(snapshot)
    for (const r of editor.#store.allRecords()) deepFreeze(r)
    const problems = graphProblems(editor.reader)
    if (problems.length) throw new Error(`invalid document: ${problems.join('; ')}`)
    return editor
  }
}

/** Drop updates whose before and after are equal, and records added then removed within the diff. */
function netDiff(d: RecordsDiff<DocRecord>): RecordsDiff<DocRecord> {
  const updated: RecordsDiff<DocRecord>['updated'] = {}
  for (const [id, [from, to]] of Object.entries(d.updated)) if (!isEqual(from, to)) (updated as any)[id] = [from, to]
  return { added: d.added, removed: d.removed, updated }
}
