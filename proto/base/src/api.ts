// AI / scripting API (docs/design/architecture/11 §6). It calls the same Editor.apply/preview as the
// UI does, so results, errors and undo are identical by construction. Read-only helpers never write.
// Pattern: Figma plugins mutate only through the document API, one run = one undo step
//   https://www.figma.com/plugin-docs/how-plugins-run/
import type { Command, EditError } from './commands'
import type { ApplyResult, Editor, EditWarning, OpResult } from './editor'
import { all, effectivelyVisible, lockedBy } from './model'
import type { ConnectionRecord, ContainerRecord, CurveRecord, FillRecord, ReferenceRecord } from './schema'

export type InspectNode = {
  address: string
  kind: 'container' | 'curve' | 'fill' | 'reference'
  name: string
  tags: string[]
  parent: string | null
  locked: boolean // effective (inherited)
  visible: boolean // effective (inherited)
  connections?: string[]
}

/**
 * The whole batch's outcome. ok/written/revision describe the FINAL commit of the batch; `results`
 * (per command, as evaluated inside the batch) are only present when the batch committed, so a
 * command's success is never mistaken for the batch's (dot). On failure `failedAt` is the index of
 * the rejected command, if the failure came from one.
 */
export type BatchResult =
  | { ok: true; written: boolean; revision: number; results: ApplyResult[]; warnings?: EditWarning[] }
  | { ok: false; written: false; revision: number; error: EditError; failedAt?: number; warnings?: EditWarning[] }

class Rejected extends Error {
  constructor(
    readonly editError: EditError,
    readonly index: number,
  ) {
    super(editError.message)
  }
}

export function createApi(editor: Editor) {
  const store = editor.reader

  function inspect(): { nodes: InspectNode[]; connections: { address: string; ends: string[] }[]; revision: number } {
    const connections = all(store, 'connection') as ConnectionRecord[]
    const conOf = (curveId: string) => connections.filter((c) => c.ends.some((e) => e.curveId === curveId)).map((c) => c.id).sort()
    const nodes: InspectNode[] = []
    for (const c of all(store, 'container') as ContainerRecord[]) {
      nodes.push({ address: c.id, kind: 'container', name: c.name, tags: c.tags, parent: c.parentId, locked: !!lockedBy(store, c.id), visible: effectivelyVisible(store, c.id) })
    }
    for (const c of all(store, 'curve') as CurveRecord[]) {
      nodes.push({ address: c.id, kind: 'curve', name: c.name, tags: c.tags, parent: c.parentId, locked: !!lockedBy(store, c.parentId), visible: effectivelyVisible(store, c.parentId), connections: conOf(c.id) })
    }
    for (const f of all(store, 'fill') as FillRecord[]) {
      nodes.push({ address: f.id, kind: 'fill', name: f.name, tags: [], parent: f.parentId, locked: !!lockedBy(store, f.parentId), visible: f.color !== 'none' && effectivelyVisible(store, f.parentId) })
    }
    for (const r of all(store, 'reference') as ReferenceRecord[]) {
      nodes.push({ address: r.id, kind: 'reference', name: r.name, tags: [], parent: r.parentId, locked: !!lockedBy(store, r.parentId), visible: effectivelyVisible(store, r.parentId) })
    }
    // Deterministic output so AI callers and tests can diff results.
    nodes.sort((a, b) => a.address.localeCompare(b.address))
    return {
      nodes,
      connections: connections.map((c) => ({ address: c.id, ends: c.ends.map((e) => `${e.curveId}#${e.anchorId}`) })).sort((a, b) => a.address.localeCompare(b.address)),
      revision: editor.revision,
    }
  }

  /** Find by semantic name or tag. Ambiguous queries return every candidate; empty tags stay empty. */
  function find(query: { name?: string; tag?: string }) {
    return inspect().nodes.filter((n) => (query.name ? n.name.includes(query.name) : true) && (query.tag ? n.tags.includes(query.tag) : true))
  }

  return {
    inspect,
    find,
    /**
     * `preview` and `apply` are TWO INDEPENDENT plans: a create without an explicit id gets a different new
     * id in each. To preview and then commit the same new records, use `prepare`.
     */
    preview: (cmd: Command) => editor.preview(cmd),
    apply: (cmd: Command) => editor.apply(cmd),
    /**
     * One prepared operation (KF-1): every `preview` of it re-plans the latest command with the SAME new ids,
     * `commit` plans once more on the current document and writes once; STALE if the document changed
     * since `prepare` (even if undone again); `cancel` writes nothing. Another operation never shares its ids.
     */
    prepare() {
      const op = editor.prepare()
      return {
        preview: (cmd: Command) => op.preview(cmd),
        commit: (cmd?: Command): ApplyResult => op.commit(cmd),
        cancel: () => op.cancel(),
        get state() {
          return op.state
        },
      }
    },
    /** A batch of commands = one undo step; any failure leaves nothing written. */
    applyBatch(label: string, cmds: Command[]): BatchResult {
      const r = editor.batchRun(label, () =>
        cmds.map((c, i) => {
          const res = editor.apply(c)
          if (!res.ok) throw new Rejected(res.error, i)
          return res
        }),
      )
      const w = r.warnings ? { warnings: r.warnings } : {}
      if (r.ok) return { ok: true, written: r.written, revision: r.revision, results: r.value, ...w }
      if (r.thrown instanceof Rejected) return { ok: false, written: false, revision: r.revision, error: r.thrown.editError, failedAt: r.thrown.index, ...w }
      return { ok: false, written: false, revision: r.revision, error: { code: 'INTERNAL', message: String((r.thrown as Error)?.message ?? r.thrown), objects: [], fixes: [] }, ...w }
    },
    undo: (): OpResult => editor.undoResult(),
    redo: (): OpResult => editor.redoResult(),
    save: () => editor.save(),
  }
}
