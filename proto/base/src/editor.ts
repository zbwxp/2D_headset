// The single write entry ("the door"): plan → validate → write atomically → record one undo step.
// - Atomic write: @tldraw/state `transaction` rolls back every signal if the body throws (MIT):
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/state/src/lib/transactions.ts
// - Diffs for undo/redo: @tldraw/store `extractingChanges`, `reverseRecordsDiff`, `squashRecordDiffs`,
//   `applyDiff` (MIT): https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts
// - Named, nestable undo groups; no-op edits stay out of history; revision ids for dirty tracking:
//   idea ported from Compositor @ 11d8d7a (MIT), Compositor/Document/DocumentHistory.swift.
import { transaction } from '@tldraw/state'
import { isRecordsDiffEmpty, reverseRecordsDiff, squashRecordDiffs, type RecordsDiff, type StoreSnapshot } from '@tldraw/store'
import { plan, type Command, type EditError } from './commands'
import { createDocStore, type DocRecord, type DocStore } from './schema'

export type ApplyResult =
  | { ok: true; written: true; revision: number; affected: string[] }
  | { ok: true; written: false; revision: number; affected: string[] } // valid but changed nothing
  | { ok: false; written: false; revision: number; error: EditError }

export type PreviewResult = { ok: true; affected: string[]; puts: DocRecord[] } | { ok: false; error: EditError }

type Entry = { label: string; diff: RecordsDiff<DocRecord>; revision: number }

export class Editor {
  readonly store: DocStore
  private undoStack: Entry[] = []
  private redoStack: Entry[] = []
  private group: { label: string; diffs: RecordsDiff<DocRecord>[]; depth: number } | null = null
  revision = 0
  savedRevision = 0

  constructor(store: DocStore = createDocStore()) {
    this.store = store
  }

  get isDirty() {
    return this.revision !== this.savedRevision
  }

  /** Plan without writing. Used for drag previews and the API's `preview`. */
  preview(cmd: Command): PreviewResult {
    const p = plan(this.store, cmd)
    return p.ok ? { ok: true, affected: p.affected, puts: p.puts } : { ok: false, error: p.error }
  }

  /** The only path that writes author data. */
  apply(cmd: Command): ApplyResult {
    const p = plan(this.store, cmd)
    if (!p.ok) return { ok: false, written: false, revision: this.revision, error: p.error }
    let diff: RecordsDiff<DocRecord> | undefined
    try {
      transaction(() => {
        diff = this.store.extractingChanges(() => this.store.put(p.puts))
      })
    } catch (e) {
      // Unexpected (planning should have caught it); the transaction rolled everything back.
      return {
        ok: false,
        written: false,
        revision: this.revision,
        error: { code: 'INVALID', message: String((e as Error).message ?? e), objects: p.affected, fixes: [] },
      }
    }
    if (!diff || isRecordsDiffEmpty(diff)) return { ok: true, written: false, revision: this.revision, affected: p.affected }
    this.record(p.label, diff)
    return { ok: true, written: true, revision: this.revision, affected: p.affected }
  }

  /** Several commands → one undo step (one gesture or one API batch). Nestable; outermost wins. */
  batch<T>(label: string, fn: () => T): T {
    const outer = !this.group
    if (outer) this.group = { label, diffs: [], depth: 0 }
    this.group!.depth++
    const before = this.store.getStoreSnapshot()
    try {
      return fn()
    } catch (e) {
      // Failure inside a batch: restore the exact pre-batch state, record nothing.
      this.store.loadStoreSnapshot(before)
      if (outer) this.group = null
      throw e
    } finally {
      if (this.group) {
        this.group.depth--
        if (outer) {
          const g = this.group
          this.group = null
          const squashed = squashRecordDiffs(g.diffs)
          if (!isRecordsDiffEmpty(squashed)) this.pushEntry(g.label, squashed)
        }
      }
    }
  }

  private record(label: string, diff: RecordsDiff<DocRecord>) {
    if (this.group) this.group.diffs.push(diff)
    else this.pushEntry(label, diff)
  }

  private pushEntry(label: string, diff: RecordsDiff<DocRecord>) {
    this.revision++
    this.undoStack.push({ label, diff, revision: this.revision })
    this.redoStack = []
  }

  undo() {
    const e = this.undoStack.pop()
    if (!e) return false
    this.store.applyDiff(reverseRecordsDiff(e.diff))
    this.redoStack.push(e)
    this.revision = this.undoStack.at(-1)?.revision ?? 0
    return true
  }

  redo() {
    const e = this.redoStack.pop()
    if (!e) return false
    this.store.applyDiff(e.diff)
    this.undoStack.push(e)
    this.revision = e.revision
    return true
  }

  get history() {
    return { undo: this.undoStack.map((e) => e.label), redo: this.redoStack.map((e) => e.label) }
  }

  /** Save = author data only (no evaluated geometry), with schema versions for migration. */
  save(): StoreSnapshot<DocRecord> {
    const snap = this.store.getStoreSnapshot('document')
    this.savedRevision = this.revision
    return snap
  }

  static open(snapshot: StoreSnapshot<DocRecord>) {
    const editor = new Editor()
    // Migrates to the current schema; throws without touching anything if it can't.
    editor.store.loadStoreSnapshot(snapshot)
    return editor
  }
}
