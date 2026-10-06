// Read helpers over the document: lookups, effective lock/visibility, connection linkage.
// Lock/visibility inheritance follows Illustrator/Figma layer semantics (docs/design/architecture/11 §3).
import type { RecordId } from '@tldraw/store'
import type { ConnectionRecord, ContainerRecord, CurveRecord, DocRecord, DocReader, FillRecord, ReferenceRecord } from './schema'

export type AnchorRef = { curveId: RecordId<CurveRecord>; anchorId: string }
export const anchorKey = (r: AnchorRef) => `${r.curveId}#${r.anchorId}`

export function all<T extends DocRecord['typeName']>(store: DocReader, type: T) {
  return store.allRecords().filter((r) => r.typeName === type) as Extract<DocRecord, { typeName: T }>[]
}

export function containerChain(store: DocReader, id: RecordId<ContainerRecord> | null): ContainerRecord[] {
  const out: ContainerRecord[] = []
  const seen = new Set<string>()
  let cur = id ? (store.get(id) as ContainerRecord | undefined) : undefined
  while (cur && !seen.has(cur.id)) {
    // cycle guard: documents are validated on open, but never loop forever on bad data
    seen.add(cur.id)
    out.push(cur)
    cur = cur.parentId ? (store.get(cur.parentId) as ContainerRecord | undefined) : undefined
  }
  return out
}

/** The nearest locked container above (or at) `parentId`, if any. */
export function lockedBy(store: DocReader, parentId: RecordId<ContainerRecord> | null) {
  return containerChain(store, parentId).find((c) => c.locked)
}

export const effectivelyVisible = (store: DocReader, parentId: RecordId<ContainerRecord> | null) =>
  containerChain(store, parentId).every((c) => c.visible)

/**
 * All anchors that must move together with the given ones, following connections transitively.
 * Returns each linked anchor with the connection that pulled it in (for error reporting).
 */
export function linkedAnchors(store: DocReader, seeds: AnchorRef[]) {
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

export const fillsOf = (store: DocReader) => all(store, 'fill') as FillRecord[]
export const referencesOf = (store: DocReader) => all(store, 'reference') as ReferenceRecord[]
export const curvesIn = (store: DocReader, containerId: RecordId<ContainerRecord>) =>
  (all(store, 'curve') as CurveRecord[]).filter((c) => containerChain(store, c.parentId).some((k) => k.id === containerId))

/** Structural checks a loaded document must pass (references resolve, no container cycles). */
export function graphProblems(store: DocReader): string[] {
  const problems: string[] = []
  const has = (id: string | null | undefined) => !!id && !!store.get(id as any)
  // references must also point at the right KIND of record (dot: a curve as its own parent loaded)
  const isType = (id: string | null | undefined, t: DocRecord['typeName']) => !!id && (store.get(id as any) as DocRecord | undefined)?.typeName === t
  for (const c of all(store, 'container') as ContainerRecord[]) {
    if (c.parentId && !isType(c.parentId, 'container')) problems.push(`${c.id}: parent ${c.parentId} is not a container`)
    const seen = new Set<string>([c.id])
    let p = c.parentId ? (store.get(c.parentId) as ContainerRecord | undefined) : undefined
    while (p) {
      if (seen.has(p.id)) {
        problems.push(`${c.id}: container cycle through ${p.id}`)
        break
      }
      seen.add(p.id)
      p = p.parentId ? (store.get(p.parentId) as ContainerRecord | undefined) : undefined
    }
  }
  for (const r of store.allRecords()) {
    if ((r.typeName === 'curve' || r.typeName === 'fill' || r.typeName === 'reference') && !isType(r.parentId, 'container')) problems.push(`${r.id}: parent ${r.parentId} is not a container`)
    if (r.typeName === 'reference' && !isType(r.sourceId, 'container')) problems.push(`${r.id}: source ${r.sourceId} is not a container`)
    if (r.typeName === 'connection')
      for (const e of r.ends) if (!isType(e.curveId, 'curve') || !(store.get(e.curveId) as CurveRecord).anchors[e.anchorId]) problems.push(`${r.id}: end ${anchorKey(e)} missing`)
    if (r.typeName === 'fill')
      for (const b of r.boundary)
        if (!isType(b.curveId, 'curve') || !(store.get(b.curveId) as CurveRecord).segments.some((s) => s.id === b.segmentId)) problems.push(`${r.id}: boundary ${b.curveId}/${b.segmentId} missing`)
  }
  void has
  return problems
}

/** True if `parentId` is `containerId` or below it. */
export function isWithin(store: DocReader, parentId: RecordId<ContainerRecord> | null, containerId: RecordId<ContainerRecord>) {
  return containerChain(store, parentId).some((c) => c.id === containerId)
}
