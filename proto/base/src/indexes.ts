// Dependency indexes, maintained incrementally from the store's change history.
// Port of @tldraw/store v5.5.2 `StoreQueries.index` (MIT,
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreQueries.ts),
// generalised from one property value to SEVERAL keys per record (a connection has two ends, a fill
// reads several curves). Same mechanism: a `computed` over `query.filterHistory(type)` that applies
// only the diffs since it last ran, and rebuilds from scratch only on first use or a history reset.
// An index value changes only when a key's membership changes, so computeds that read it are not
// invalidated by geometry edits (dot: dependency indexes; continuous drags must not rescan).
// Only public tldraw APIs are used (its IncrementalSetConstructor is internal): a small copy-on-write
// set update replaces it.
import { computed, isUninitialized, RESET_VALUE, unsafe__withoutCapture, type Computed } from '@tldraw/state'
import type { StoreQueries } from '@tldraw/store'
import { counters } from './counters'
import type { ConnectionRecord, ContainerRecord, CurveRecord, DocRecord, FamilyRecord, FillRecord, HelperDomainRecord, ReferenceRecord, ExpressionParamRecord, VisibilityRecord } from './schema'

type Type = DocRecord['typeName']
type Rec<T extends Type> = Extract<DocRecord, { typeName: T }>

/**
 * The kinds of object a container holds in its paint order — the ONE list (doc 18 §31.4). Every place that walks a
 * container's children reads it; whether each place supports a kind is still decided (and tested) there.
 */
export const PLACED_KINDS = ['container', 'curve', 'fill', 'reference', 'image'] as const
export type PlacedKind = (typeof PLACED_KINDS)[number]
/** the placed kinds that are not containers — what a container's content is made of */
export const CONTENT_KINDS = PLACED_KINDS.filter((k): k is Exclude<PlacedKind, 'container'> => k !== 'container')
export const isPlaced = (typeName: string): typeName is PlacedKind => (PLACED_KINDS as readonly string[]).includes(typeName)
type KeyIndex = Computed<Map<string, Set<string>>>
/** A reader with the store's incremental indexes (`query`), or without them (overlay / plain reader → scan). */
export type Queryable = { query?: StoreQueries<DocRecord>; get: (id: any) => unknown; allRecords?: () => DocRecord[] }
type Indexed = Queryable & { query: StoreQueries<DocRecord> }

function multiIndex<T extends Type>(store: Indexed, type: T, keysOf: (r: Rec<T>) => Iterable<string>): KeyIndex {
  const query = store.query
  const history = query.filterHistory(type)
  const keys = (r: DocRecord) => new Set(r.typeName === type ? keysOf(r as Rec<T>) : [])
  const fromScratch = () => {
    counters.indexBuilds++
    history.get() // deref early so the next run gets a diff instead of rebuilding (as in tldraw)
    // Read the records WITHOUT capturing them as dependencies: the index must depend only on the
    // type's history, or every geometry edit of any record would re-trigger it.
    return unsafe__withoutCapture(() => {
      const res = new Map<string, Set<string>>()
      for (const id of query.ids(type).get()) {
        const r = store.get(id) as DocRecord | undefined
        if (!r) continue
        for (const k of keys(r)) {
          if (!res.has(k)) res.set(k, new Set())
          res.get(k)!.add(r.id)
        }
      }
      return res
    })
  }
  return computed<Map<string, Set<string>>>(`index:${type}`, (prev, lastEpoch) => {
    if (isUninitialized(prev)) return fromScratch()
    const diffs = history.getDiffSince(lastEpoch)
    if (diffs === RESET_VALUE) return fromScratch()
    counters.indexSteps++
    // copy-on-write: only keys whose membership is touched get a new Set
    const touched = new Map<string, Set<string>>()
    const set = (k: string) => {
      let s = touched.get(k)
      if (!s) touched.set(k, (s = new Set(prev.get(k) ?? [])))
      return s
    }
    for (const d of diffs) {
      for (const r of Object.values(d.added) as DocRecord[]) for (const k of keys(r)) set(k).add(r.id)
      for (const [from, to] of Object.values(d.updated) as [DocRecord, DocRecord][]) {
        const a = keys(from)
        const b = keys(to)
        for (const k of a) if (!b.has(k)) set(k).delete(to.id)
        for (const k of b) if (!a.has(k)) set(k).add(to.id)
      }
      for (const r of Object.values(d.removed) as DocRecord[]) for (const k of keys(r)) set(k).delete(r.id)
    }
    let next: Map<string, Set<string>> | undefined
    for (const [k, s] of touched) {
      const old = prev.get(k)
      if (old && old.size === s.size && [...s].every((x) => old.has(x))) continue // same membership
      if (!old && !s.size) continue
      next ??= new Map(prev)
      if (s.size) next.set(k, s)
      else next.delete(k)
    }
    // unchanged membership → the SAME map: readers of the index are not invalidated
    return next ?? prev
  })
}

const anchorKeyOf = (e: { curveId: string; anchorId: string }) => `${e.curveId}#${e.anchorId}`

type Indexes = {
  connectionsByAnchor: KeyIndex
  childrenByParent: Record<PlacedKind, KeyIndex>
  fillsByCurve: KeyIndex
  referencesBySource: KeyIndex
  familiesByCurve: KeyIndex
  helpersByPreset: KeyIndex
  paramsByFamily: KeyIndex
  visibilityByCurve: KeyIndex
}
const cache = new WeakMap<object, Indexes>()

/** The indexes of one store (created on first use, then maintained incrementally). */
export function indexesOf(store: Indexed): Indexes {
  let ix = cache.get(store.query)
  if (!ix) {
    const byParent = <T extends PlacedKind>(t: T) => multiIndex(store, t, (r) => [String((r as { parentId: unknown }).parentId)])
    ix = {
      connectionsByAnchor: multiIndex(store, 'connection', (c: ConnectionRecord) => c.ends.map(anchorKeyOf)),
      childrenByParent: Object.fromEntries(PLACED_KINDS.map((t) => [t, byParent(t)])) as Record<PlacedKind, KeyIndex>,
      // a fill depends on every curve its boundary reads: segment steps and both ends of each bridge
      fillsByCurve: multiIndex(store, 'fill', (f: FillRecord) => f.boundary.flatMap((b) => ('bridge' in b ? [b.bridge.from.curveId, b.bridge.to.curveId] : [b.curveId]) as string[])),
      referencesBySource: multiIndex(store, 'reference', (r: ReferenceRecord) => [r.sourceId as string]),
      familiesByCurve: multiIndex(store, 'family', (f: FamilyRecord) => f.curves.map(String)),
      helpersByPreset: multiIndex(store, 'helperDomain', (h: HelperDomainRecord) => [h.presetId as string]),
      paramsByFamily: multiIndex(store, 'expressionParam', (r: ExpressionParamRecord) => [r.familyId as string]),
      visibilityByCurve: multiIndex(store, 'visibility', (v: VisibilityRecord) => [v.curveId as string]),
    }
    cache.set(store.query, ix)
  }
  return ix
}

/**
 * Membership of ONE key as its own computed (equal arrays keep the old value): a reader of it re-runs only when THAT
 * key's membership changes, not when any key of the index does (dot, review of 819dd22: a helper domain of another
 * family rebuilt this character). Used by the character preparation.
 */
const perKey = new WeakMap<KeyIndex, Map<string, Computed<string[]>>>()
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
function lookupKey(ix: KeyIndex, key: string): string[] {
  let m = perKey.get(ix)
  if (!m) perKey.set(ix, (m = new Map()))
  let c = m.get(key)
  if (!c) m.set(key, (c = computed(`index-key:${key}`, () => [...(ix.get().get(key) ?? [])].sort(), { isEqual: sameList })))
  counters.indexQueries++
  return c.get()
}

const lookup = (ix: KeyIndex, key: string): string[] => {
  counters.indexQueries++
  return [...(ix.get().get(key) ?? [])]
}

/** Membership on a reader without indexes: one scan of its final records (counted like any whole-table read). */
function scan<T extends Type>(store: Queryable, type: T): Rec<T>[] {
  if (!store.allRecords) throw new Error('reader has neither indexes nor allRecords')
  const rows = store.allRecords()
  counters.scannedRows += rows.length
  return rows.filter((r) => r.typeName === type) as Rec<T>[]
}
const indexed = (store: Queryable): store is Indexed => !!store.query

export const connectionsAt = (store: Queryable, key: string) =>
  (indexed(store) ? lookup(indexesOf(store).connectionsByAnchor, key) : scan(store, 'connection').filter((c) => c.ends.some((e) => anchorKeyOf(e) === key)).map((c) => c.id)) as ConnectionRecord['id'][]
export const childrenOf = <T extends PlacedKind>(store: Queryable, parentId: string | null, type: T) =>
  (indexed(store)
    ? lookup(indexesOf(store).childrenByParent[type], String(parentId))
    : scan(store, type).filter((r) => String((r as { parentId: unknown }).parentId) === String(parentId)).map((r) => (r as { id: string }).id)) as Rec<T>['id'][]
export const fillsUsing = (store: Queryable, curveId: string) =>
  (indexed(store) ? lookup(indexesOf(store).fillsByCurve, curveId) : scan(store, 'fill').filter((f) => f.boundary.some((b) => ('bridge' in b ? b.bridge.from.curveId === curveId || b.bridge.to.curveId === curveId : b.curveId === curveId))).map((f) => f.id)) as FillRecord['id'][]
/** Helper domains of a preset / expression parameters of a family / visibility records of a curve (keyed membership). */
export const helperDomainsOf = (store: Queryable, presetId: string) =>
  (indexed(store) ? lookupKey(indexesOf(store).helpersByPreset, presetId) : scan(store, 'helperDomain').filter((h) => h.presetId === presetId).map((h) => h.id)) as string[]
export const paramsOfFamily = (store: Queryable, familyId: string) =>
  (indexed(store) ? lookupKey(indexesOf(store).paramsByFamily, familyId) : scan(store, 'expressionParam').filter((r) => r.familyId === familyId).map((r) => r.id)) as string[]
export const visibilityOfCurve = (store: Queryable, curveId: string) =>
  (indexed(store) ? lookupKey(indexesOf(store).visibilityByCurve, curveId) : scan(store, 'visibility').filter((v) => v.curveId === curveId).map((v) => v.id)) as string[]
/** Families registering a curve (a family curve has preset forms: the new mode). */
export const familiesOf = (store: Queryable, curveId: string) =>
  (indexed(store) ? lookup(indexesOf(store).familiesByCurve, curveId) : scan(store, 'family').filter((f) => f.curves.includes(curveId as any)).map((f) => f.id)) as FamilyRecord['id'][]
export const referencesOf = (store: Queryable, sourceId: string) =>
  (indexed(store) ? lookup(indexesOf(store).referencesBySource, sourceId) : scan(store, 'reference').filter((r) => r.sourceId === sourceId).map((r) => r.id)) as ReferenceRecord['id'][]

/** Containers at or below `containerId` (cycle-safe), via the parent index. */
export function containersWithin(store: Queryable, containerId: ContainerRecord['id']): ContainerRecord['id'][] {
  const out: ContainerRecord['id'][] = []
  const seen = new Set<string>()
  const queue: ContainerRecord['id'][] = [containerId]
  while (queue.length) {
    const c = queue.shift()!
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
    queue.push(...childrenOf(store, c, 'container'))
  }
  return out
}

/** every child of a container (or the root), of every placed kind */
export const placedChildren = (store: Queryable, parentId: string | null): string[] => PLACED_KINDS.flatMap((t) => childrenOf(store, parentId, t) as string[])

/** Records of `type` placed at or below `containerId`, via the parent index (no full scan). */
export const within = <T extends Exclude<PlacedKind, 'container'>>(store: Queryable, containerId: ContainerRecord['id'], type: T) =>
  containersWithin(store, containerId).flatMap((c) => childrenOf(store, c, type))

export type { CurveRecord }

/** connections at an anchor, as a per-key computed (for the character preparation; see lookupKey) */
export const connectionsAtKeyed = (store: Queryable, key: string) =>
  (indexed(store) ? lookupKey(indexesOf(store).connectionsByAnchor, key) : connectionsAt(store, key)) as ConnectionRecord['id'][]

/** the fills that are `curveId`'s own (a path's fill, doc 18 §30.18) */
export function ownFillsOf(store: Queryable, curveId: string): string[] {
  return fillsUsing(store as any, curveId as any).filter((id) => (store.get(id as any) as FillRecord | undefined)?.owner?.curveId === curveId)
}
