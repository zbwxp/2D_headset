// Read helpers over the document: lookups, effective lock/visibility, connection linkage.
// Lock/visibility inheritance follows Illustrator/Figma layer semantics (docs/design/architecture/11 §3).
import type { RecordId } from '@tldraw/store'
import { counters } from './counters'
import { connectionsAt } from './indexes'
import { newRecordProblems, presetConnectionProblems } from './forms'
import { legacy3Keys, legacyKeys, offset3At, offsetAt } from './pose'
import { poseIdOf, type BoundaryStep, type ConnectionRecord, type ContainerRecord, type CurveRecord, type DocRecord, type BaseReader, type FillRecord, type ReferenceRecord } from './schema'

export type AnchorRef = { curveId: RecordId<CurveRecord>; anchorId: string }
export const anchorKey = (r: AnchorRef) => `${r.curveId}#${r.anchorId}`

export function all<T extends DocRecord['typeName']>(store: BaseReader, type: T) {
  const rows = store.allRecords()
  counters.scannedRows += rows.length // a whole-table read: counted wherever it happens
  return rows.filter((r) => r.typeName === type) as Extract<DocRecord, { typeName: T }>[]
}

export function containerChain(store: BaseReader, id: RecordId<ContainerRecord> | null): ContainerRecord[] {
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
export function lockedBy(store: BaseReader, parentId: RecordId<ContainerRecord> | null) {
  return containerChain(store, parentId).find((c) => c.locked)
}

export const effectivelyVisible = (store: BaseReader, parentId: RecordId<ContainerRecord> | null) =>
  containerChain(store, parentId).every((c) => c.visible)

/**
 * All anchors that must move together with the given ones, following connections transitively.
 * Returns each linked anchor with the connection that pulled it in (for error reporting).
 */
export function linkedAnchors(store: BaseReader, seeds: AnchorRef[]) {
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

export const fillsOf = (store: BaseReader) => all(store, 'fill') as FillRecord[]
export const referencesOf = (store: BaseReader) => all(store, 'reference') as ReferenceRecord[]
export const curvesIn = (store: BaseReader, containerId: RecordId<ContainerRecord>) =>
  (all(store, 'curve') as CurveRecord[]).filter((c) => containerChain(store, c.parentId).some((k) => k.id === containerId))

/** Structural checks a loaded document must pass (references resolve, no container cycles). */
/** Typed lookup: the record only if it exists AND has the expected type (dot: a curve id passed as a parent). */
export function getAs<T extends DocRecord['typeName']>(store: Pick<BaseReader, 'get'>, id: unknown, type: T) {
  const r = typeof id === 'string' ? (store.get(id as any) as DocRecord | undefined) : undefined
  return r?.typeName === type ? (r as Extract<DocRecord, { typeName: T }>) : undefined
}

/** What a missing/wrong-typed id actually is, for error messages: "missing" or its real type. */
export const actualKind = (store: Pick<BaseReader, 'get'>, id: unknown) =>
  (typeof id === 'string' && (store.get(id as any) as DocRecord | undefined)?.typeName) || 'missing'

/** One broken relation, addressed so a UI or an AI can point at it. */
export type RelationProblem = { object: string; field: string; target: string; message: string }

/**
 * THE relation rules of a document, per record (outgoing references only). The same function runs
 * on every record when a document is opened, and on each candidate record before a write is
 * published (`plan`), so the editor can never write something it would refuse to open (dot).
 * Analogous to foreign-key constraints in a database: checked per written row, not by a full scan.
 */
/**
 * Relation rules of one record. `store` needs `get`; checks that must see other records of a type (rules of a
 * family, presets sharing a connection, connected groups) also need `allRecords` and are skipped without it.
 */
export function recordProblems(store: Pick<BaseReader, 'get'> & Partial<Pick<BaseReader, 'allRecords'>>, r: DocRecord): RelationProblem[] {
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
    const formsOf = (e: { curveId: string }) => getAs(store, poseIdOf(e.curveId), 'forms')
    const yaws = [...new Set(r.ends.flatMap((e) => [...legacyKeys(formsOf(e)), ...legacy3Keys(formsOf(e))].map((k) => k.yaw)))].sort((x, y) => x - y)
    // the anchor positions' offsets (dp for a promoted track)
    const at = (e: { curveId: string; anchorId: string }, yaw: number) => {
      const f = formsOf(e)
      return f?.encoding === 'legacy-delta3' ? offset3At(legacy3Keys(f), e.anchorId, 'dp', yaw) : offsetAt(legacyKeys(f), e.anchorId, yaw)
    }
    for (const yaw of yaws) {
      const offs = r.ends.map((e) => at(e, yaw))
      if (offs.some((o) => o.x !== offs[0].x || o.y !== offs[0].y)) {
        out.push({ object: r.id, field: 'ends', target: r.ends.map(anchorKey).join(' / '), message: `${r.id}: ends separate at yaw ${yaw} (${offs.map((o) => `(${o.x}, ${o.y})`).join(' vs ')})` })
        break
      }
    }
  }
  // the whole boundary must be one continuous loop (each step starts where the previous ended, or at an anchor
  // connected to it) — the same rule as createFill; checked whenever the reader can enumerate (open, structural
  // writes), so no saved fill can be drawn from a wrong start point (dot, review of 71f36d3)
  if (r.typeName === 'fill' && store.allRecords && r.boundary.every((b) => ('bridge' in b ? [b.bridge.from, b.bridge.to].every((e) => getAs(store, e.curveId, 'curve')?.anchors[e.anchorId]) : getAs(store, b.curveId, 'curve')?.segments.some((s) => s.id === b.segmentId)))) {
    const gap = boundaryGap(store as BaseReader, r.boundary)
    if (gap) out.push({ object: r.id, field: 'boundary', target: gap.join(' / '), message: `${r.id}: boundary is not continuous between ${gap[0]} and ${gap[1]}` })
  }
  // a path's own fill lives with its curve and reads only it (doc 18 §30.18)
  if (r.typeName === 'fill' && r.owner) {
    const c = getAs(store, r.owner.curveId, 'curve')
    if (!c) need('owner.curveId', r.owner.curveId, 'curve')
    else {
      if (c.parentId !== r.parentId) out.push({ object: r.id, field: 'parentId', target: c.id, message: `${r.id}: a path's fill must be in its path's container (${c.parentId}, not ${r.parentId})` })
      const other = r.boundary.flatMap((b) => ('bridge' in b ? [b.bridge.from.curveId, b.bridge.to.curveId] : [b.curveId])).find((id) => id !== c.id)
      if (other) out.push({ object: r.id, field: 'boundary', target: other, message: `${r.id}: a path's fill reads only its path ${c.id} (not ${other})` })
    }
  }
  if (r.typeName === 'fill')
    r.boundary.forEach((b, i) => {
      if ('bridge' in b) {
        // a bridge's two ends must exist (it reads their current positions)
        for (const [k, e] of [['from', b.bridge.from], ['to', b.bridge.to]] as const) {
          const c = getAs(store, e.curveId, 'curve')
          if (!c) need(`boundary[${i}].bridge.${k}.curveId`, e.curveId, 'curve')
          else if (!c.anchors[e.anchorId]) out.push({ object: r.id, field: `boundary[${i}].bridge.${k}`, target: anchorKey(e as AnchorRef), message: `${r.id}: bridge end ${anchorKey(e as AnchorRef)} missing` })
        }
        return
      }
      const c = getAs(store, b.curveId, 'curve')
      if (!c) need(`boundary[${i}].curveId`, b.curveId, 'curve')
      else if (!c.segments.some((s) => s.id === b.segmentId))
        out.push({ object: r.id, field: `boundary[${i}].segmentId`, target: `${b.curveId}/${b.segmentId}`, message: `${r.id}: boundary ${b.curveId}/${b.segmentId} missing` })
    })
  if (r.typeName === 'forms' && (r.encoding === 'legacy-delta' || r.encoding === 'legacy-delta3')) {
    const c = getAs(store, r.curveId, 'curve')
    if (!c) need('curveId', r.curveId, 'curve')
    else {
      if (r.id !== poseIdOf(c.id)) out.push({ object: r.id, field: 'id', target: c.id, message: `${r.id}: a legacy forms record's id must be ${poseIdOf(c.id)} (one per curve)` })
      ;[...legacyKeys(r), ...legacy3Keys(r)].forEach((k, i) => {
        for (const a of Object.keys(k.offsets)) if (!c.anchors[a]) out.push({ object: r.id, field: `yaw[${i}].offsets.${a}`, target: `${c.id}#${a}`, message: `${r.id}: offset for missing anchor ${c.id}#${a}` })
      })
    }
  }
  // the new records (stage 1): references, family registration, rules, characters; shared nodes of presets
  out.push(...newRecordProblems(store, r))
  if (r.typeName === 'connection' && r.ends.every((e) => getAs(store, e.curveId, 'curve')?.anchors[e.anchorId])) out.push(...presetConnectionProblems(store, r))
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
export function graphProblems(store: BaseReader): string[] {
  return store.allRecords().flatMap((r) => recordProblems(store, r).map((p) => p.message))
}

/** True if `parentId` is `containerId` or below it. */
export function isWithin(store: BaseReader, parentId: RecordId<ContainerRecord> | null, containerId: RecordId<ContainerRecord>) {
  return containerChain(store, parentId).some((c) => c.id === containerId)
}

/**
 * A reader that sees `puts` layered over `reader` and `removals` taken out (previews and plan checks; never
 * writes). ONLY a BaseReader: reads by id and enumeration, both over the final state (a removed record is a
 * tombstone for both). No `query`, `serialize` or snapshot — those would silently answer with the underlying
 * store — so membership lookups on it scan its final records (indexes.ts) and it never reaches the store's
 * indexes (doc 18 §22.1; dot, review of 3729d27).
 */
export function overlayReader(reader: BaseReader, puts: DocRecord[], removals: readonly string[] = []): BaseReader {
  const overlay = new Map<string, DocRecord>(puts.map((r) => [r.id, r]))
  const gone = new Set(removals)
  return {
    get: ((id: string) => (gone.has(id) ? undefined : (overlay.get(id) ?? reader.get(id as any)))) as BaseReader['get'],
    allRecords: () => {
      const out = reader.allRecords().filter((r) => !gone.has(r.id)).map((r) => overlay.get(r.id) ?? r)
      for (const r of puts) if (!reader.get(r.id as any) && !gone.has(r.id)) out.push(r)
      return out
    },
  }
}

/**
 * A boundary is closed when each step's end anchor is the next step's start anchor (same curve), or the two are
 * joined by a connection; a bridge starts and ends at its two anchors. Gaps are never silently bridged (11 §1).
 * Returns the first gap, or null.
 */
export function boundaryGap(store: BaseReader, boundary: BoundaryStep[]): [string, string] | null {
  const label = (step: BoundaryStep | undefined) => (!step ? 'undefined' : 'bridge' in step ? `bridge ${anchorKey(step.bridge.from as AnchorRef)}→${anchorKey(step.bridge.to as AnchorRef)}` : String(step.segmentId))
  const ends = boundary.map((step) => {
    if ('bridge' in step) {
      const ok = [step.bridge.from, step.bridge.to].every((e) => getAs(store, e.curveId, 'curve')?.anchors[e.anchorId])
      return ok ? { start: step.bridge.from as AnchorRef, end: step.bridge.to as AnchorRef } : null
    }
    const c = getAs(store, step.curveId, 'curve')
    const seg = c?.segments.find((s) => s.id === step.segmentId)
    if (!seg) return null
    const [from, to] = step.dir === 1 ? [seg.from, seg.to] : [seg.to, seg.from]
    return { start: { curveId: step.curveId, anchorId: from }, end: { curveId: step.curveId, anchorId: to } }
  })
  for (let i = 0; i < ends.length; i++) {
    const a = ends[i]
    const b = ends[(i + 1) % ends.length]
    if (!a || !b) return [label(boundary[i]), label(boundary[(i + 1) % ends.length])]
    if (anchorKey(a.end) === anchorKey(b.start)) continue
    const joined = linkedAnchors(store, [a.end]).some((m) => anchorKey(m.ref) === anchorKey(b.start))
    if (!joined) return [anchorKey(a.end), anchorKey(b.start)]
  }
  return null
}
