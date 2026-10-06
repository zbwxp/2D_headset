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
//   us — restores document and history together (see the last point for what is promised).
// - Subscribers (`react`, views) run after a root transaction has committed (tldraw flushes effects
//   in `commit`). An exception thrown by a subscriber does not undo the write, so the result reports
//   the write as done, plus an OBSERVER_FAILED warning — the result always describes the document.
//   If `onWarning` itself throws, that is added as WARNING_HANDLER_FAILED; nothing escapes to the caller.
//   Whether a write committed is decided by whether the transaction body finished, never assumed.
// - Notification is isolated from state (dot's review of 8875a57): `commit` only describes what
//   happened; `report` is the single caller of `onWarning`, runs after the operation's state is final
//   (including batch cleanup, which is in `finally`), and records a throwing handler as
//   WARNING_HANDLER_FAILED. A batch is one transaction, so subscribers never see its intermediate states.
// - The official grouping entry is `batch` / `applyBatch`. Consistency after an outer `transaction`
//   rolls back is a TESTED COMPATIBILITY BOUNDARY (property I10, kept as a regression test), not a
//   promise about arbitrary external nesting or about notification behaviour inside it. It holds
//   because history lives in the same atoms; refusing outer transactions up front is not attempted,
//   since tldraw exposes no public "is a transaction active" check.
import { atom, transaction } from '@tldraw/state'
import { isRecordsDiffEmpty, reverseRecordsDiff, squashRecordDiffs, type RecordsDiff, type StoreSnapshot } from '@tldraw/store'
import { isEqual } from '@tldraw/utils'
import { plan, type Command, type EditError } from './commands'
import { Derived } from './derived'
import { graphProblems } from './model'
import { createDocStore, deepFreeze, type DocReader, type DocRecord, type DocStore } from './schema'

/** Something went wrong outside the write itself (e.g. a subscriber threw); the write stands. */
export type EditWarning = { code: 'OBSERVER_FAILED' | 'WARNING_HANDLER_FAILED'; message: string }

export type ApplyResult =
  | { ok: true; written: true; revision: number; affected: string[]; warnings?: EditWarning[] }
  | { ok: true; written: false; revision: number; affected: string[] } // valid but changed nothing
  | { ok: false; written: false; revision: number; error: EditError; warnings?: EditWarning[] }

/**
 * Result of undo/redo and of a whole batch — same fields as ApplyResult (dot's review: AI callers
 * need the outcome of the WHOLE operation in the return value, not only through onWarning).
 * written = this call changed the document and history (for a batch: created its one undo step).
 */
export type OpResult =
  | { ok: true; written: boolean; revision: number; warnings?: EditWarning[] }
  | { ok: false; written: false; revision: number; error: EditError; warnings?: EditWarning[] }

/** A batch's outcome. `thrown` is the body's own exception (rethrown as-is by `batch`). */
export type BatchRun<T> =
  | { ok: true; written: boolean; revision: number; value: T; warnings?: EditWarning[] }
  | { ok: false; written: false; revision: number; thrown: unknown; warnings?: EditWarning[] }

export type PreviewResult = { ok: true; affected: string[]; puts: DocRecord[] } | { ok: false; error: EditError }

type Entry = { label: string; diff: RecordsDiff<DocRecord>; revision: number }
type Group = { label: string; diffs: RecordsDiff<DocRecord>[] }

export class Editor {
  readonly #store: DocStore
  /** Read-only view for evaluation, views and the API. */
  readonly reader: DocReader
  /** Incremental evaluation of this document (same results as `evaluate(reader)`). */
  readonly derived: Derived
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
      query: s.query,
    }
    this.derived = new Derived(s)
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
    // State is final here; only now is anything reported (and a failing report changes nothing above).
    const warnings = this.report(run.warnings)
    if (!run.committed)
      // Unexpected (planning should have caught it); the transaction rolled back document AND history.
      return { ok: false, written: false, revision: this.revision, error: { code: 'INTERNAL', message: errorMessage(run.error), objects: p.affected, fixes: [] }, ...(warnings.length && { warnings }) }
    if (!diff || isRecordsDiffEmpty(diff)) return { ok: true, written: false, revision: this.revision, affected: p.affected }
    return { ok: true, written: true, revision: this.revision, affected: p.affected, ...(warnings.length && { warnings }) }
  }

  /**
   * Run `body` in a transaction and describe what happened. It never throws and never calls back
   * out: it only reports. committed ⇔ the body finished (tldraw then commits). An exception that
   * still escapes `transaction` came from a subscriber during the flush that follows a commit — or
   * that follows a rollback — and becomes a warning; it never changes `committed`.
   */
  private commit(body: () => void): { committed: true; warnings: EditWarning[] } | { committed: false; error: unknown; warnings: EditWarning[] } {
    let finished = false
    let bodyError: { error: unknown } | undefined
    try {
      transaction(() => {
        try {
          body()
        } catch (error) {
          bodyError = { error }
          throw error
        }
        finished = true
      })
      return { committed: true, warnings: [] }
    } catch (thrown) {
      const observer = (e: unknown): EditWarning[] => [{ code: 'OBSERVER_FAILED', message: errorMessage(e) }]
      if (finished) return { committed: true, warnings: observer(thrown) }
      // Rolled back. If what escaped is not the body's own error, a subscriber failed during the rollback flush.
      if (!bodyError) return { committed: false, error: thrown, warnings: [] }
      return { committed: false, error: bodyError.error, warnings: thrown === bodyError.error ? [] : observer(thrown) }
    }
  }

  /**
   * The one place that calls `onWarning`, always AFTER all state changes of the operation are done.
   * A throwing handler is recorded as WARNING_HANDLER_FAILED and never propagates (dot's review of
   * 8875a57: notification failures must not alter commit, rollback or cleanup).
   */
  private report(warnings: EditWarning[]): EditWarning[] {
    const out = [...warnings]
    for (const w of warnings) {
      try {
        this.onWarning(w)
      } catch (h) {
        out.push({ code: 'WARNING_HANDLER_FAILED', message: errorMessage(h) })
      }
    }
    return out
  }

  /**
   * Several commands → one undo step (one gesture or one API batch). Nestable; outermost records.
   * The whole batch is ONE transaction (nested batches are nested transactions): if a level throws,
   * tldraw's rollback restores exactly that level's document AND history changes, and subscribers
   * see only the final state. Group bookkeeping is cleaned up in `finally`, whatever happened.
   * Warnings from the final flush go through `report` (onWarning) after cleanup.
   * Throws the body's own error if it failed; `batchRun` returns the full outcome instead.
   */
  batch<T>(label: string, fn: () => T): T {
    const r = this.batchRun(label, fn)
    if (!r.ok) throw r.thrown
    return r.value
  }

  /** `batch` without throwing: the whole batch's outcome, including warnings (used by the API). */
  batchRun<T>(label: string, fn: () => T): BatchRun<T> {
    const outer = !this.group
    if (outer) this.group = { label, diffs: [] }
    const group = this.group!
    const mark = group.diffs.length
    let value!: T
    let pushed = false
    let run: ReturnType<Editor['commit']> | undefined
    try {
      run = this.commit(() => {
        value = fn()
        if (outer) {
          const net = netDiff(squashRecordDiffs(group.diffs))
          // A batch whose net effect is nothing (e.g. +1 then −1) leaves history and redo alone (dot).
          if (!isRecordsDiffEmpty(net)) {
            this.pushEntry(group.label, net)
            pushed = true
          }
        }
      })
    } finally {
      // Runs no matter what: a failed level's diffs can never come back through redo (dot #2), and a
      // later edit can never be appended to an abandoned group (dot's review of 8875a57).
      if (!run?.committed) group.diffs.splice(mark)
      if (outer) this.group = null
    }
    const warnings = this.report(run.warnings)
    const w = warnings.length ? { warnings } : {}
    if (!run.committed) return { ok: false, written: false, revision: this.revision, thrown: run.error, ...w }
    // Only the outermost level commits a history step; an inner level's success is not final.
    return { ok: true, written: pushed, revision: this.revision, value, ...w }
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

  /** Undo one step. true = a step was undone. UI convenience; the API uses `undoResult`. */
  undo() {
    return this.unwrap(this.undoResult())
  }

  /** Redo one step. true = a step was redone. UI convenience; the API uses `redoResult`. */
  redo() {
    return this.unwrap(this.redoResult())
  }

  undoResult(): OpResult {
    const e = this.#undo.get().at(-1)
    if (!e) return { ok: true, written: false, revision: this.revision }
    return this.step('undo', () => {
      this.#store.applyDiff(reverseRecordsDiff(e.diff))
      this.#undo.update((u) => u.slice(0, -1))
      this.#redo.update((r) => [...r, e])
      this.#revision.set(this.#undo.get().at(-1)?.revision ?? 0)
    })
  }

  redoResult(): OpResult {
    const e = this.#redo.get().at(-1)
    if (!e) return { ok: true, written: false, revision: this.revision }
    return this.step('redo', () => {
      this.#store.applyDiff(e.diff)
      this.#redo.update((r) => r.slice(0, -1))
      this.#undo.update((u) => [...u, e])
      this.#revision.set(e.revision)
    })
  }

  private step(name: string, body: () => void): OpResult {
    const run = this.commit(body)
    const warnings = this.report(run.warnings)
    const w = warnings.length ? { warnings } : {}
    if (!run.committed)
      return { ok: false, written: false, revision: this.revision, error: { code: 'INTERNAL', message: `${name} failed and was rolled back: ${errorMessage(run.error)}`, objects: [], fixes: [] }, ...w }
    return { ok: true, written: true, revision: this.revision, ...w }
  }

  private unwrap(r: OpResult) {
    if (!r.ok) throw new Error(r.error.message)
    return r.written
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

const errorMessage = (e: unknown) => String((e as Error)?.message ?? e)

/** Drop updates whose before and after are equal, and records added then removed within the diff. */
function netDiff(d: RecordsDiff<DocRecord>): RecordsDiff<DocRecord> {
  const updated: RecordsDiff<DocRecord>['updated'] = {}
  for (const [id, [from, to]] of Object.entries(d.updated)) if (!isEqual(from, to)) (updated as any)[id] = [from, to]
  return { added: d.added, removed: d.removed, updated }
}
