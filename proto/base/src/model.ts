// Read helpers over the document: lookups, effective lock/visibility, connection linkage.
// Lock/visibility inheritance follows Illustrator/Figma layer semantics (docs/design/architecture/11 §3).
import type { RecordId } from '@tldraw/store'
import { connectionsAt } from './indexes'
import { offsetAt } from './pose'
import { poseIdOf, type ConnectionRecord, type ContainerRecord, type CurveRecord, type DocRecord, type DocReader, type FillRecord, type ReferenceRecord } from './schema'

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
  // via the connection index: cost follows the linked anchors, not the number of connections
  const result = new Map<string, { ref: AnchorRef; via?: RecordId<ConnectionRecord> }>()
  const queue = [...seeds]
  for (const s of seeds) result.set(anchorKey(s), { ref: s })
  while (queue.length) {
    const cur = queue.shift()!
    for (const id of connectionsAt(store, anchorKey(cur))) {
      const c = store.get(id) as ConnectionRecord
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
/** Typed lookup: the record only if it exists AND has the expected type (dot: a curve id passed as a parent). */
export function getAs<T extends DocRecord['typeName']>(store: Pick<DocReader, 'get'>, id: unknown, type: T) {
  const r = typeof id === 'string' ? (store.get(id as any) as DocRecord | undefined) : undefined
  return r?.typeName === type ? (r as Extract<DocRecord, { typeName: T }>) : undefined
}

/** What a missing/wrong-typed id actually is, for error messages: "missing" or its real type. */
export const actualKind = (store: Pick<DocReader, 'get'>, id: unknown) =>
  (typeof id === 'string' && (store.get(id as any) as DocRecord | undefined)?.typeName) || 'missing'

/** One broken relation, addressed so a UI or an AI can point at it. */
export type RelationProblem = { object: string; field: string; target: string; message: string }

/**
 * THE relation rules of a document, per record (outgoing references only). The same function runs
 * on every record when a document is opened, and on each candidate record before a write is
 * published (`plan`), so the editor can never write something it would refuse to open (dot).
 * Analogous to foreign-key constraints in a database: checked per written row, not by a full scan.
 */
export function recordProblems(store: Pick<DocReader, 'get'>, r: DocRecord): RelationProblem[] {
  const out: RelationProblem[] = []
  const need = (field: string, id: unknown, type: DocRecord['typeName']) => {
    if (!getAs(store, id, type)) out.push({ object: r.id, field, target: String(id), message: `${r.id}.${field}: ${id} is not a ${type} (${actualKind(store, id)})` })
  }
  if (r.typeName === 'container' && r.parentId) need('parentId', r.parentId, 'container')
  if (r.typeName === 'curve' || r.typeName === 'fill' || r.typeName === 'reference') need('parentId', r.parentId, 'container')
  if (r.typeName === 'reference') need('sourceId', r.sourceId, 'container')
  if (r.typeName === 'connection')
    r.ends.forEach((e, i) => {
      const c = getAs(store, e.curveId, 'curve')
      if (!c) need(`ends[${i}].curveId`, e.curveId, 'curve')
      else if (!c.anchors[e.anchorId]) out.push({ object: r.id, field: `ends[${i}].anchorId`, target: anchorKey(e), message: `${r.id}: end ${anchorKey(e)} missing` })
    })
  if (r.typeName === 'connection' && r.ends.every((e) => getAs(store, e.curveId, 'curve')?.anchors[e.anchorId])) {
    // Head-turn forms must keep the ends together at every yaw. Checking the union of the end curves'
    // key yaws is EXACT only for per-curve piecewise-linear interpolation clamped to a common domain
    // (pose.offsetAt): between consecutive checked yaws both offsets are linear, outside they are
    // constant. A non-linear or per-anchor response would need a different check (dot).
    const keysOf = (e: { curveId: string }) => getAs(store, poseIdOf(e.curveId), 'pose')?.keys ?? []
    const yaws = [...new Set(r.ends.flatMap((e) => keysOf(e).map((k) => k.yaw)))].sort((x, y) => x - y)
    for (const yaw of yaws) {
      const offs = r.ends.map((e) => offsetAt(keysOf(e), e.anchorId, yaw))
      if (offs.some((o) => o.x !== offs[0].x || o.y !== offs[0].y)) {
        out.push({ object: r.id, field: 'ends', target: r.ends.map(anchorKey).join(' / '), message: `${r.id}: ends separate at yaw ${yaw} (${offs.map((o) => `(${o.x}, ${o.y})`).join(' vs ')})` })
        break
      }
    }
  }
  if (r.typeName === 'fill')
    r.boundary.forEach((b, i) => {
      const c = getAs(store, b.curveId, 'curve')
      if (!c) need(`boundary[${i}].curveId`, b.curveId, 'curve')
      else if (!c.segments.some((s) => s.id === b.segmentId))
        out.push({ object: r.id, field: `boundary[${i}].segmentId`, target: `${b.curveId}/${b.segmentId}`, message: `${r.id}: boundary ${b.curveId}/${b.segmentId} missing` })
    })
  if (r.typeName === 'pose') {
    const c = getAs(store, r.curveId, 'curve')
    if (!c) need('curveId', r.curveId, 'curve')
    else {
      if (r.id !== poseIdOf(c.id)) out.push({ object: r.id, field: 'id', target: c.id, message: `${r.id}: a pose's id must be ${poseIdOf(c.id)} (one pose per curve)` })
      r.keys.forEach((k, i) => {
        for (const a of Object.keys(k.offsets)) if (!c.anchors[a]) out.push({ object: r.id, field: `keys[${i}].offsets.${a}`, target: `${c.id}#${a}`, message: `${r.id}: offset for missing anchor ${c.id}#${a}` })
      })
    }
  }
  if (r.typeName === 'container') {
    // a container's own chain must end (no cycle through it)
    const seen = new Set<string>([r.id])
    for (let p = r.parentId ? getAs(store, r.parentId, 'container') : undefined; p; p = p.parentId ? getAs(store, p.parentId, 'container') : undefined) {
      if (seen.has(p.id)) {
        out.push({ object: r.id, field: 'parentId', target: p.id, message: `${r.id}: container cycle through ${p.id}` })
        break
      }
      seen.add(p.id)
    }
  }
  return out
}

/** Whole-document check used on open: the same per-record rules over every record. */
export function graphProblems(store: DocReader): string[] {
  return store.allRecords().flatMap((r) => recordProblems(store, r).map((p) => p.message))
}

/** True if `parentId` is `containerId` or below it. */
export function isWithin(store: DocReader, parentId: RecordId<ContainerRecord> | null, containerId: RecordId<ContainerRecord>) {
  return containerChain(store, parentId).some((c) => c.id === containerId)
}
