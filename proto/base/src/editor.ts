// The single write entry ("the door"): plan → validate → write atomically → record one undo step.
// - Atomic write: @tldraw/state `transaction` rolls back every signal if the body throws (MIT):
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/state/src/lib/transactions.ts
// - Diffs for undo/redo: @tldraw/store `extractingChanges`, `reverseRecordsDiff`, `squashRecordDiffs`,
//   `applyDiff` (MIT): https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts
// - Named, nestable undo groups; no-op edits stay out of history; revision ids for dirty tracking:
//   idea ported from Compositor @ 11d8d7a (MIT), Compositor/Document/DocumentHistory.swift.
// The store itself is private: callers get a read-only view, so nothing can bypass history or locks
// by calling `store.put` (dot's review of 11ca75d).
import { transaction } from '@tldraw/state'
import { isRecordsDiffEmpty, reverseRecordsDiff, squashRecordDiffs, type RecordsDiff, type StoreSnapshot } from '@tldraw/store'
import { isEqual } from '@tldraw/utils'
import { plan, type Command, type EditError } from './commands'
import { graphProblems } from './model'
import { createDocStore, type DocReader, type DocRecord, type DocStore } from './schema'

export type ApplyResult =
  | { ok: true; written: true; revision: number; affected: string[] }
  | { ok: true; written: false; revision: number; affected: string[] } // valid but changed nothing
  | { ok: false; written: false; revision: number; error: EditError }

export type PreviewResult = { ok: true; affected: string[]; puts: DocRecord[] } | { ok: false; error: EditError }

type Entry = { label: string; diff: RecordsDiff<DocRecord>; revision: number }
type Group = { label: string; diffs: RecordsDiff<DocRecord>[] }

export class Editor {
  readonly #store: DocStore
  /** Read-only view for evaluation, views and the API. */
  readonly reader: DocReader
  private undoStack: Entry[] = []
  private redoStack: Entry[] = []
  private group: Group | null = null
  /** Monotonic: a revision id is never reused, so "saved" can't match a different edit (dot #1). */
  private nextRevision = 1
  revision = 0
  savedRevision = 0

  constructor(initial: DocRecord[] = []) {
    this.#store = createDocStore()
    if (initial.length) this.#store.put(initial, 'initialize')
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
    return p.ok ? { ok: true, affected: p.affected, puts: p.puts } : { ok: false, error: p.error }
  }

  /** The only path that writes author data. */
  apply(cmd: Command): ApplyResult {
    const p = plan(this.reader, cmd)
    if (!p.ok) return { ok: false, written: false, revision: this.revision, error: p.error }
    // Records equal to what is stored are not written: no-op edits never touch history (dot #3).
    const changed = p.puts.filter((r) => !isEqual(this.#store.get(r.id), r))
    if (!changed.length) return { ok: true, written: false, revision: this.revision, affected: p.affected }
    let diff: RecordsDiff<DocRecord> | undefined
    try {
      transaction(() => {
        diff = this.#store.extractingChanges(() => this.#store.put(changed))
      })
    } catch (e) {
      // Unexpected (planning should have caught it); the transaction rolled everything back.
      return { ok: false, written: false, revision: this.revision, error: { code: 'INVALID', message: String((e as Error).message ?? e), objects: p.affected, fixes: [] } }
    }
    if (!diff || isRecordsDiffEmpty(diff)) return { ok: true, written: false, revision: this.revision, affected: p.affected }
    this.record(p.label, diff)
    return { ok: true, written: true, revision: this.revision, affected: p.affected }
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
        const squashed = squashRecordDiffs(group.diffs)
        if (!isRecordsDiffEmpty(squashed)) this.pushEntry(group.label, squashed)
      }
      return result
    } catch (e) {
      const failed = group.diffs.splice(mark)
      if (failed.length) this.#store.applyDiff(reverseRecordsDiff(squashRecordDiffs(failed)))
      if (outer) this.group = null
      throw e
    }
  }

  private record(label: string, diff: RecordsDiff<DocRecord>) {
    if (this.group) this.group.diffs.push(diff)
    else this.pushEntry(label, diff)
  }

  private pushEntry(label: string, diff: RecordsDiff<DocRecord>) {
    this.revision = this.nextRevision++
    this.undoStack.push({ label, diff, revision: this.revision })
    this.redoStack = []
  }

  undo() {
    const e = this.undoStack.pop()
    if (!e) return false
    this.#store.applyDiff(reverseRecordsDiff(e.diff))
    this.redoStack.push(e)
    this.revision = this.undoStack.at(-1)?.revision ?? 0
    return true
  }

  redo() {
    const e = this.redoStack.pop()
    if (!e) return false
    this.#store.applyDiff(e.diff)
    this.undoStack.push(e)
    this.revision = e.revision
    return true
  }

  get history() {
    return { undo: this.undoStack.map((e) => e.label), redo: this.redoStack.map((e) => e.label) }
  }

  /** Save = author data only (no evaluated geometry), with schema versions for migration. */
  save(): StoreSnapshot<DocRecord> {
    const snap = this.#store.getStoreSnapshot('document')
    this.savedRevision = this.revision
    return snap
  }

  /** Migrate, validate records and structure; throw (nothing opened) if anything is wrong. */
  static open(snapshot: StoreSnapshot<DocRecord>) {
    const editor = new Editor()
    editor.#store.loadStoreSnapshot(snapshot)
    const problems = graphProblems(editor.reader)
    if (problems.length) throw new Error(`invalid document: ${problems.join('; ')}`)
    return editor
  }
}
