// AI / scripting API (docs/design/architecture/11 §6). It calls the same Editor.apply/preview as the
// UI does, so results, errors and undo are identical by construction. Read-only helpers never write.
// Pattern: Figma plugins mutate only through the document API, one run = one undo step
//   https://www.figma.com/plugin-docs/how-plugins-run/
import type { Command } from './commands'
import type { Editor } from './editor'
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
      nodes.push({ address: f.id, kind: 'fill', name: f.name, tags: [], parent: f.parentId, locked: !!lockedBy(store, f.parentId), visible: effectivelyVisible(store, f.parentId) })
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
    preview: (cmd: Command) => editor.preview(cmd),
    apply: (cmd: Command) => editor.apply(cmd),
    /** A batch of commands = one undo step; any failure leaves nothing written. */
    applyBatch(label: string, cmds: Command[]) {
      try {
        return editor.batch(label, () =>
          cmds.map((c) => {
            const r = editor.apply(c)
            if (!r.ok) throw Object.assign(new Error(r.error.message), { editError: r.error })
            return r
          }),
        )
      } catch (e: any) {
        return { ok: false as const, written: false as const, error: e.editError ?? { code: 'INTERNAL', message: String(e), objects: [], fixes: [] } }
      }
    },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    save: () => editor.save(),
  }
}
