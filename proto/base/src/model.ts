// Read helpers over the document: lookups, effective lock/visibility, connection linkage.
// Lock/visibility inheritance follows Illustrator/Figma layer semantics (docs/design/architecture/11 §3).
import type { RecordId } from '@tldraw/store'
import type { ConnectionRecord, ContainerRecord, CurveRecord, DocRecord, DocStore, FillRecord, ReferenceRecord } from './schema'

export type AnchorRef = { curveId: RecordId<CurveRecord>; anchorId: string }
export const anchorKey = (r: AnchorRef) => `${r.curveId}#${r.anchorId}`

export function all<T extends DocRecord['typeName']>(store: DocStore, type: T) {
  return store.allRecords().filter((r) => r.typeName === type) as Extract<DocRecord, { typeName: T }>[]
}

export function containerChain(store: DocStore, id: RecordId<ContainerRecord> | null): ContainerRecord[] {
  const out: ContainerRecord[] = []
  let cur = id ? (store.get(id) as ContainerRecord | undefined) : undefined
  while (cur) {
    out.push(cur)
    cur = cur.parentId ? (store.get(cur.parentId) as ContainerRecord | undefined) : undefined
  }
  return out
}

/** The nearest locked container above (or at) `parentId`, if any. */
export function lockedBy(store: DocStore, parentId: RecordId<ContainerRecord> | null) {
  return containerChain(store, parentId).find((c) => c.locked)
}

export const effectivelyVisible = (store: DocStore, parentId: RecordId<ContainerRecord> | null) =>
  containerChain(store, parentId).every((c) => c.visible)

/**
 * All anchors that must move together with the given ones, following connections transitively.
 * Returns each linked anchor with the connection that pulled it in (for error reporting).
 */
export function linkedAnchors(store: DocStore, seeds: AnchorRef[]) {
  const connections = all(store, 'connection') as ConnectionRecord[]
  const result = new Map<string, { ref: AnchorRef; via?: RecordId<ConnectionRecord> }>()
  const queue = [...seeds]
  for (const s of seeds) result.set(anchorKey(s), { ref: s })
  while (queue.length) {
    const cur = queue.shift()!
    for (const c of connections) {
      if (!c.ends.some((e) => anchorKey(e) === anchorKey(cur))) continue
      for (const e of c.ends) {
        if (result.has(anchorKey(e))) continue
        result.set(anchorKey(e), { ref: e, via: c.id })
        queue.push(e)
      }
    }
  }
  return [...result.values()]
}

export const fillsOf = (store: DocStore) => all(store, 'fill') as FillRecord[]
export const referencesOf = (store: DocStore) => all(store, 'reference') as ReferenceRecord[]
export const curvesIn = (store: DocStore, containerId: RecordId<ContainerRecord>) =>
  (all(store, 'curve') as CurveRecord[]).filter((c) => containerChain(store, c.parentId).some((k) => k.id === containerId))
