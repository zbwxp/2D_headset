// Incremental evaluation: the same results as `evaluate()`, recomputed only where something changed.
// Mechanism (no home-made invalidation): @tldraw/store `createComputedCache` (MIT) gives one
// @tldraw/state `computed` per record; a computed records exactly which atoms/computeds it READ and is
// recomputed only when one of those changed.
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts (createComputedCache)
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/state/src/lib/Computed.ts
// Rules that keep it local (dot: a computed that reads the whole table, a global revision or a whole
// track is invalidated by everything):
// - a curve reads only its own record and its container chain (visibility/lock);
// - a fill reads only its own record, its container chain and the cached curves of its boundary;
// - a reference instance of one source curve reads only the reference, that curve and the chain;
// - membership (which curves a reference shows) comes from the parent index, whose value changes
//   only when membership changes.
// Caches are per store: a reopened document (Editor.open) is a new store with new caches; a record
// removed and re-added (undo/redo, same id) gets a new atom, and createComputedCache keys by atom.
import { computed, type Computed } from '@tldraw/state'
import { isEqual } from '@tldraw/utils'
import { counters } from './counters'
import { boundaryRefsOf, byKey, evalCurve, evaluate, fromPaint, IDENTITY, KEY_SEP, paintKey, type Cubic, type EvalCurve, type EvalFill, type Evaluated, type PaintInput } from './evaluate'
import { fillsUsing, referencesOf, within } from './indexes'
import { containerChain, effectivelyVisible, lockedBy } from './model'
import { curveAtYaw, evaluateAtYaw, fillAtYaw } from './pose'
import { poseIdOf, type BaseReader, type ContainerRecord, type CurveRecord, type DocReader, type DocRecord, type DocStore, type FillRecord, type PoseRecord, type ReferenceRecord } from './schema'

/**
 * A limit on RETAINED RESULT ITEMS shared by several keyed caches (dot, reviews of 2a48719 and
 * c9553b7). The unit is result items, NOT bytes or memory: one result can hold very different numbers
 * of segments, control points and references; byte / GPU budgets are to be measured with the drawing
 * workload. Each entry has a weight (default 1), re-read on every access; the sum stays ≤ `limit`;
 * over it, entries are evicted least-recently-used in cache registration order. An entry heavier than
 * the whole limit is returned but not kept. The limit covers what the caches retain only because no
 * evictable entry depends on another evictable entry (see Derived): a tldraw computed keeps its
 * parents' values alive, so a dependency on an evicted entry would retain it outside the count.
 */
export class SharedBudget {
  used = 0
  evictions = 0
  private readonly caches: KeyedComputedCache<unknown>[] = []
  constructor(
    readonly limit: number,
    private readonly onEvict: () => void = () => {},
  ) {}
  register(c: KeyedComputedCache<unknown>) {
    this.caches.push(c)
  }
  enforce(keep: { cache: KeyedComputedCache<unknown>; key: string }) {
    for (const c of this.caches) while (this.used > this.limit && c.evictOldest(keep, this.limit)) {
      this.evictions++
      this.onEvict()
    }
  }
  /** Bookkeeping invariant (for tests): every weighed entry is in its map, and `used` = Σ weights. */
  consistent(): boolean {
    let sum = 0
    for (const c of this.caches) {
      const { keys, weights } = c.bookkeeping()
      if (weights.size !== keys.size || [...weights.keys()].some((k) => !keys.has(k))) return false
      for (const w of weights.values()) sum += w
    }
    return sum === this.used
  }
  /** The distinct result objects currently held by all caches (for tests). */
  retainedObjects(): Set<unknown> {
    const out = new Set<unknown>()
    for (const c of this.caches) for (const v of c.values()) {
      if (v && typeof v === 'object' && 'curves' in (v as object)) {
        for (const x of (v as Evaluated).curves) out.add(x)
        for (const x of (v as Evaluated).fills) out.add(x)
      } else out.add(v)
    }
    return out
  }
}

/** Computeds keyed by a string, least-recently-used, counted against a shared budget. */
export class KeyedComputedCache<T> {
  private map = new Map<string, Computed<T>>()
  private weights = new Map<string, number>()
  private last = new Map<string, T>()
  constructor(
    private readonly budget: SharedBudget,
    private readonly create: (key: string) => Computed<T>,
    private readonly weightOf: (value: T) => number = () => 1,
  ) {
    budget.register(this as KeyedComputedCache<unknown>)
  }
  get(key: string): T {
    const c = this.map.get(key) ?? this.create(key)
    // Compute FIRST: computing a list reads items, which can evict entries — including this key. Only
    // then (re-)insert it as most recently used and weigh it, so an entry can never be weighed while
    // missing from the map (an orphan that holds results but cannot be evicted).
    const v = c.get()
    this.map.delete(key)
    this.map.set(key, c)
    const w = this.weightOf(v)
    this.budget.used += w - (this.weights.get(key) ?? 0)
    this.weights.set(key, w)
    this.last.set(key, v)
    this.budget.enforce({ cache: this as KeyedComputedCache<unknown>, key })
    return v
  }
  /** Drop the least-recently-used entry (not `keep`, unless `keep` alone exceeds the budget). */
  evictOldest(keep: { cache: KeyedComputedCache<unknown>; key: string }, limit: number): boolean {
    for (const key of this.map.keys()) {
      if (keep.cache === (this as KeyedComputedCache<unknown>) && key === keep.key && (this.weights.get(key) ?? 0) <= limit) continue
      this.map.delete(key)
      this.budget.used -= this.weights.get(key) ?? 0
      this.weights.delete(key)
      this.last.delete(key)
      return true
    }
    return false
  }
  values() {
    return this.last.values()
  }
  bookkeeping() {
    return { keys: new Set(this.map.keys()), weights: this.weights }
  }
  get size() {
    return this.map.size
  }
}

type Get = Pick<DocStore, 'get'>

// Per-item evaluation, shared by the caches and by the drag preview so both use one meaning.
// `get` is the store, or (preview) the store with the planned records layered over it.
function curveItem(get: Get, c: CurveRecord): EvalCurve {
  return {
    address: c.id,
    curveId: c.id,
    name: c.name,
    ...evalCurve(c, IDENTITY, {}, c.id),
    stroke: c.stroke,
    visible: effectivelyVisible(get as DocStore, c.parentId),
    locked: !!lockedBy(get as DocStore, c.parentId),
    depth: c.depthOffset,
  }
}

function instanceItem(get: Get, r: ReferenceRecord, c: CurveRecord): EvalCurve {
  const key = `${r.id}/${c.id}`
  return {
    address: key,
    curveId: c.id,
    referenceId: r.id,
    name: c.name,
    ...evalCurve(c, r.transform, r.overrides, key),
    stroke: c.stroke,
    visible: effectivelyVisible(get as DocStore, r.parentId),
    locked: !!lockedBy(get as DocStore, r.parentId),
    depth: c.depthOffset,
  }
}

function fillItem(get: Get, f: FillRecord, curveOf: (id: CurveRecord['id']) => EvalCurve | undefined): EvalFill {
  return {
    address: f.id,
    color: f.color,
    // the SAME curve geometry the strokes use
    cubics: f.boundary.map((step) => {
      const seg = curveOf(step.curveId)!.segments.find((s) => s.id === step.segmentId)!
      const [p0, c1, c2, p3] = seg.cubic
      return step.dir === 1 ? seg.cubic : ([p3, c2, c1, p0] as Cubic)
    }),
    boundaryRefs: boundaryRefsOf(f.boundary),
    visible: effectivelyVisible(get as DocStore, f.parentId),
    locked: !!lockedBy(get as DocStore, f.parentId),
    depth: f.depthOffset,
  }
}

/**
 * A reader that sees `puts` layered over `reader` and `removals` taken out (used by the preview; never
 * writes). It is ONLY a BaseReader: reads by id and enumeration, both over the final state (a removed
 * record is a tombstone for both). It deliberately has no `query`, `serialize` or snapshot — those would
 * silently answer with the underlying store — so membership lookups on it scan its final records
 * (indexes.ts), and it can never reach (or seed) the underlying store's indexes (doc 18 §22.1; dot,
 * review of 3729d27).
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
 * Fields a preview may change on the fast path: geometry and appearance only. It is an ALLOW-list
 * (dot, review of 8373b9b: a sourceId change kept the old instances because the old guard listed only
 * parent/index/depth). Any other field — parent, order, depth, reference source, and any field added
 * later — can change membership, dependencies or paint order, so the preview falls back to a full
 * overlay evaluation. Segment ids must stay the same (fills name segments by id).
 */
const FAST_FIELDS: Partial<Record<DocRecord['typeName'], Set<string>>> = {
  curve: new Set(['name', 'tags', 'anchors', 'segments', 'closed', 'stroke']),
  reference: new Set(['name', 'tags', 'transform', 'overrides']),
}
function fastPathChange(old: DocRecord, next: DocRecord) {
  const allowed = FAST_FIELDS[next.typeName]
  if (!allowed) return false
  const keys = new Set([...Object.keys(old), ...Object.keys(next)])
  for (const k of keys) {
    const a = (old as any)[k]
    const b = (next as any)[k]
    if (isEqual(a, b)) continue
    if (!allowed.has(k)) return false
    if (k === 'segments' && !isEqual((a as { id: string }[]).map((x) => x.id), (b as { id: string }[]).map((x) => x.id))) return false
  }
  return true
}

type PaintEntry = { kind: 'curve' | 'fill'; address: string; key: string; refId?: ReferenceRecord['id']; curveId?: CurveRecord['id'] }

export type PreviewChanges = { fallback: false; items: Map<string, EvalCurve | EvalFill> } | { fallback: true; removals?: readonly string[] }

export class Derived {
  private readonly curves
  private readonly fills
  /** reference × source curve; document-sized (not evicted), pruned to current membership by `all` */
  private readonly instances = new Map<string, Computed<EvalCurve>>()
  /** The one limit on retained result items of all angle caches; not a byte budget. */
  readonly yawRetainedItems: SharedBudget
  private readonly all: Computed<Evaluated>
  /** Paint key per record: recomputed only when its parent / index (or an ancestor's) changes. */
  private readonly keys
  /** A reference's source container: recomputed only when `sourceId` changes. */
  private readonly sources
  /** Identities and order only (dot: no geometry here, so a preview always reads current geometry). */
  private readonly order: Computed<PaintEntry[]>
  // Angle (head turn) layer — the only EVICTABLE layer. Rule (dot, review of c9553b7): an evictable
  // entry depends only on NON-evictable things (store records and the document-sized base layer:
  // curves, fills, instances, `all`), never on another evictable entry. A tldraw computed keeps its
  // parents (and their last values) alive; if a yaw fill read cached yaw curves, evicting those curves
  // from the map would not free them. So a yaw fill computes its boundary curves at the yaw inline,
  // a yaw instance reads the reference and curve records directly, and angle LISTS are not cached —
  // `atYaw` assembles them on demand from the entries. Parents never hold evicted children: tldraw
  // attaches a child to its parents only while the child is actively observed (capture.ts).
  private readonly yawCurves: KeyedComputedCache<EvalCurve>
  private readonly yawFills: KeyedComputedCache<EvalFill>

  constructor(
    private readonly store: DocStore,
    private readonly reader: DocReader,
    opts: { yawRetainedItems?: number } = {},
  ) {
    this.yawRetainedItems = new SharedBudget(opts.yawRetainedItems ?? 262_144, () => counters.yawEvictions++)
    this.yawCurves = new KeyedComputedCache<EvalCurve>(
      this.yawRetainedItems,
      (key) => {
        const at = key.lastIndexOf('@')
        const address = key.slice(0, at)
        const yaw = Number(key.slice(at + 1))
        return computed(`yawCurve:${key}`, () => {
          counters.yawCurveEvals++
          const slash = address.indexOf('/')
          if (slash < 0) {
            const base = this.curve(address as CurveRecord['id'])! // base layer: not evictable
            return curveAtYaw(base, store.get(poseIdOf(base.curveId) as any) as PoseRecord | undefined, yaw)
          }
          // an instance at a yaw reads the records directly (the instance map is base layer too, but
          // reading records keeps this entry's parents free of other caches entirely)
          const ref = store.get(address.slice(0, slash) as any) as ReferenceRecord
          const c = store.get(address.slice(slash + 1) as any) as CurveRecord
          counters.instanceEvals++ // the instance geometry is rebuilt here, not read from the instance cache
          return curveAtYaw(instanceItem(store, ref, c), store.get(poseIdOf(c.id) as any) as PoseRecord | undefined, yaw, ref.transform)
        })
      },
    )
    this.yawFills = new KeyedComputedCache<EvalFill>(
      this.yawRetainedItems,
      (key) => {
        const at = key.lastIndexOf('@')
        const id = key.slice(0, at) as FillRecord['id']
        const yaw = Number(key.slice(at + 1))
        return computed(`yawFill:${key}`, () => {
          counters.yawFillEvals++
          // boundary curves at this yaw computed inline from the base layer — not from cached yaw curves —
          // once per DISTINCT curve, and counted like any other curve-at-yaw computation (dot)
          const inline = new Map<string, EvalCurve>()
          return fillAtYaw(this.fill(id)!, store.get(id) as FillRecord, (cid) => {
            let c = inline.get(cid)
            if (!c) {
              counters.yawCurveEvals++
              inline.set(cid, (c = curveAtYaw(this.curve(cid as CurveRecord['id'])!, store.get(poseIdOf(cid) as any) as PoseRecord | undefined, yaw)))
            }
            return c
          })
        })
      },
    )
    this.curves = store.createComputedCache<EvalCurve, CurveRecord>('evalCurve', (c) => {
      counters.curveEvals++
      return curveItem(store, c)
    })
    this.fills = store.createComputedCache<EvalFill, FillRecord>('evalFill', (f) => {
      counters.fillEvals++
      return fillItem(store, f, (id) => this.curve(id))
    })
    // Paint order (PAINT-ORDER.md §4 S1): identities and order only. It reads each item's paint key
    // through `keys` (whose value changes only when parent / index of the item or an ancestor change),
    // the id lists and reference membership — never geometry — so a drag does not rebuild it.
    this.keys = store.createComputedCache<string, CurveRecord | FillRecord | ReferenceRecord | ContainerRecord>(
      'paintKey',
      (r) => paintKey(store, r),
      { areRecordsEqual: (a, b) => a.parentId === b.parentId && a.index === b.index },
    )
    this.sources = store.createComputedCache<ContainerRecord['id'], ReferenceRecord>('referenceSource', (r) => r.sourceId, {
      areRecordsEqual: (a, b) => a.sourceId === b.sourceId,
    })
    this.order = computed('paintOrder', () => {
      counters.paintOrderBuilds++
      const entries: PaintEntry[] = []
      for (const id of store.query.ids('curve').get()) entries.push({ kind: 'curve', address: id, key: this.keys.get(id)! })
      for (const id of store.query.ids('fill').get()) entries.push({ kind: 'fill', address: id, key: this.keys.get(id)! })
      for (const refId of store.query.ids('reference').get()) {
        const src = this.sources.get(refId)!
        const refKey = this.keys.get(refId)!
        const srcKey = this.keys.get(src)! // a source curve's key starts with its source's key + KEY_SEP
        for (const cid of within(store, src, 'curve'))
          entries.push({ kind: 'curve', address: `${refId}/${cid}`, key: refKey + KEY_SEP + this.keys.get(cid)!.slice(srcKey.length + 1), refId, curveId: cid })
      }
      return entries.sort(byKey)
    })
    // The assembled list: maps the order to the CURRENT cached items. After a geometry change it
    // re-collects references to the cached items (the order is reused); nothing is sorted here.
    this.all = computed('evaluated', () => {
      const used = new Set<string>()
      const paint: PaintInput[] = this.order.get().map((e) => {
        if (e.kind === 'fill') return { kind: 'fill', item: this.fill(e.address as FillRecord['id'])! }
        if (!e.refId) return { kind: 'curve', item: this.curve(e.address as CurveRecord['id'])! }
        used.add(e.address)
        return { kind: 'curve', item: this.instance(e.refId, e.curveId!) }
      })
      // prune instance entries no longer in the document (membership is document-sized)
      for (const k of [...this.instances.keys()]) if (!used.has(k)) this.instances.delete(k)
      counters.assembledItems += paint.length
      return fromPaint(paint)
    })
  }

  curve(id: CurveRecord['id']) {
    return this.curves.get(id)
  }
  fill(id: FillRecord['id']) {
    return this.fills.get(id)
  }
  instance(refId: ReferenceRecord['id'], curveId: CurveRecord['id']) {
    const key = `${refId}/${curveId}`
    let c = this.instances.get(key)
    if (!c) {
      const store = this.store
      c = computed(`instance:${key}`, () => {
        counters.instanceEvals++
        return instanceItem(store, store.get(refId) as ReferenceRecord, store.get(curveId) as CurveRecord)
      })
      this.instances.set(key, c)
    }
    return c.get()
  }
  /** One curve (base address or `reference/curve` instance address) at `yaw`. Cached, bounded. */
  curveAt(address: string, yaw: number) {
    return this.yawCurves.get(`${address}@${yaw}`)
  }
  fillAt(id: string, yaw: number) {
    return this.yawFills.get(`${id}@${yaw}`)
  }
  /** Same value as `pose.evaluateAtYaw(reader, yaw)`, incrementally maintained. Playing never writes. */
  atYaw(yaw: number): Evaluated {
    // assembled on demand (not cached: a cached list would hold results outside the budget)
    const base = this.evaluated()
    return fromPaint(base.paint.map((p) => (p.kind === 'curve' ? { kind: 'curve', item: this.curveAt(p.item.address, yaw) } : { kind: 'fill', item: this.fillAt(p.item.address, yaw) })))
  }
  get yawCacheSize() {
    return { curves: this.yawCurves.size, fills: this.yawFills.size, budgetUsed: this.yawRetainedItems.used, budget: this.yawRetainedItems.limit }
  }

  /** Drag preview at `yaw` (onion skins): only the items the plan changes are re-done at that yaw. */
  previewAtYaw(puts: DocRecord[], yaw: number, ch: PreviewChanges = this.previewChanges(puts)): Evaluated {
    if (ch.fallback) {
      counters.previewFallbacks++
      return evaluateAtYaw(overlayReader(this.reader, puts, ch.removals), yaw)
    }
    const view = overlayReader(this.reader, puts)
    const curves = new Map<string, EvalCurve>()
    for (const [address, item] of ch.items)
      if ('segments' in item) {
        counters.previewEvals++
        const placement = item.referenceId ? (view.get(item.referenceId as any) as ReferenceRecord).transform : undefined
        curves.set(address, curveAtYaw(item, view.get(poseIdOf(item.curveId) as any) as PoseRecord | undefined, yaw, placement))
      }
    const fills = new Map<string, EvalFill>()
    for (const [address, item] of ch.items)
      if (!('segments' in item)) {
        counters.previewEvals++
        fills.set(address, fillAtYaw(item, view.get(address as any) as FillRecord, (cid) => curves.get(cid) ?? this.curveAt(cid, yaw)))
      }
    const base = this.atYaw(yaw)
    counters.previewItems += base.paint.length
    return fromPaint(base.paint.map((p) => (p.kind === 'curve' ? { kind: 'curve', item: curves.get(p.item.address) ?? p.item } : { kind: 'fill', item: fills.get(p.item.address) ?? p.item })))
  }

  /** Same value as `evaluate(reader)`, incrementally maintained. */
  evaluated(): Evaluated {
    return this.all.get()
  }
  get instanceCacheSize() {
    return this.instances.size
  }

  /**
   * Drag preview without copying the store (dot: no whole-table snapshot per move). Re-evaluates only
   * the items the planned records affect — the changed curves, the fills reading them (fill index),
   * the reference instances showing them (references of each container in the curve's chain) and all
   * instances of a changed reference — through an overlay `get`; everything else stays cached.
   * Falls back when the plan could change paint order or touches other record kinds.
   */
  previewChanges(puts: DocRecord[], removals: readonly string[] = []): PreviewChanges {
    counters.previews++
    // removals change membership: always the full overlay evaluation (tombstones)
    if (removals.length) return { fallback: true, removals }
    const store = this.store
    for (const r of puts) {
      const old = store.get(r.id as any) as DocRecord | undefined
      if (!old || old.typeName !== r.typeName || !fastPathChange(old, r)) return { fallback: true }
    }
    const view = overlayReader(this.reader, puts)
    const items = new Map<string, EvalCurve | EvalFill>()
    const changedCurves = puts.filter((r): r is CurveRecord => r.typeName === 'curve')
    const changedRefs = new Map(puts.filter((r): r is ReferenceRecord => r.typeName === 'reference').map((r) => [r.id as string, r]))
    for (const c of changedCurves) {
      counters.previewEvals++
      items.set(c.id, curveItem(view, c))
    }
    const curveOf = (id: CurveRecord['id']) => (items.get(id) as EvalCurve | undefined) ?? this.curve(id)
    for (const c of changedCurves)
      for (const fid of fillsUsing(store, c.id)) {
        if (items.has(fid)) continue
        counters.previewEvals++
        items.set(fid, fillItem(view, store.get(fid) as FillRecord, curveOf))
      }
    // instances: every curve of a changed reference; changed curves inside any referenced container
    const instance = (r: ReferenceRecord, c: CurveRecord) => {
      const key = `${r.id}/${c.id}`
      if (items.has(key)) return
      counters.previewEvals++
      items.set(key, instanceItem(view, r, c))
    }
    for (const r of changedRefs.values()) for (const cid of within(store, r.sourceId, 'curve')) instance(r, view.get(cid) as CurveRecord)
    for (const c of changedCurves)
      for (const k of containerChain(store, c.parentId))
        for (const rid of referencesOf(store, k.id)) instance((changedRefs.get(rid) ?? store.get(rid)) as ReferenceRecord, c)
    return { fallback: false, items }
  }

  /** The whole preview list: the cached list with the affected items replaced (same order). */
  preview(puts: DocRecord[], ch: PreviewChanges = this.previewChanges(puts)): Evaluated {
    if (ch.fallback) {
      counters.previewFallbacks++
      return evaluate(overlayReader(this.reader, puts, ch.removals))
    }
    const base = this.evaluated()
    counters.previewItems += base.paint.length
    // same order (the fast path never changes parent / index / membership), current geometry
    return fromPaint(base.paint.map((p) => ({ kind: p.kind, item: ch.items.get(p.item.address) ?? p.item }) as PaintInput))
  }
}
