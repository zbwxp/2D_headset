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
import { evalCurve, evaluate, IDENTITY, type Cubic, type EvalCurve, type EvalFill, type Evaluated } from './evaluate'
import { fillsUsing, referencesOf, within } from './indexes'
import { containerChain, effectivelyVisible, lockedBy } from './model'
import { curveAtYaw, evaluateAtYaw, fillAtYaw } from './pose'
import { poseIdOf, type ContainerRecord, type CurveRecord, type DocReader, type DocRecord, type DocStore, type FillRecord, type PoseRecord, type ReferenceRecord } from './schema'

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
    visible: effectivelyVisible(get as DocStore, f.parentId),
    locked: !!lockedBy(get as DocStore, f.parentId),
    depth: f.depthOffset,
  }
}

/** A reader that sees `puts` layered over `reader` (used by the preview; never writes). */
export function overlayReader(reader: DocReader, puts: DocRecord[]): DocReader {
  const overlay = new Map<string, DocRecord>(puts.map((r) => [r.id, r]))
  return {
    ...reader,
    get: ((id: string) => overlay.get(id) ?? reader.get(id as any)) as DocReader['get'],
    allRecords: () => {
      const out = reader.allRecords().map((r) => overlay.get(r.id) ?? r)
      for (const r of puts) if (!reader.get(r.id as any)) out.push(r)
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

export type PreviewChanges = { fallback: false; items: Map<string, EvalCurve | EvalFill> } | { fallback: true }

export class Derived {
  private readonly curves
  private readonly fills
  /** reference × source curve; document-sized (not evicted), pruned to current membership by `all` */
  private readonly instances = new Map<string, Computed<EvalCurve>>()
  /** The one limit on retained result items of all angle caches; not a byte budget. */
  readonly yawRetainedItems: SharedBudget
  private readonly all: Computed<Evaluated>
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
    // The assembled list: a computed too, so asking again without a change costs nothing. After a
    // change it re-collects references to the cached items and sorts them; each item's order key is
    // computed ONCE (decorate-sort), not inside the comparator (dot: comparator re-read records).
    this.all = computed('evaluated', () => {
      const curves: EvalCurve[] = [...store.query.ids('curve').get()].map((id) => this.curve(id)!)
      const used = new Set<string>()
      for (const refId of store.query.ids('reference').get()) {
        const r = store.get(refId) as ReferenceRecord
        for (const cid of within(store, r.sourceId, 'curve')) {
          used.add(`${r.id}/${cid}`)
          curves.push(this.instance(r.id, cid))
        }
      }
      // prune instance entries no longer in the document (membership is document-sized)
      for (const k of [...this.instances.keys()]) if (!used.has(k)) this.instances.delete(k)
      const fills: EvalFill[] = [...store.query.ids('fill').get()].map((id) => this.fill(id)!)
      const parentKey = new Map<string, string>()
      const order = (addr: string) => {
        const rec = store.get(addr.split('/')[0] as any) as (DocRecord & { parentId: any; index: string }) | undefined
        if (!rec) return ''
        let pk = parentKey.get(rec.parentId)
        if (pk === undefined) parentKey.set(rec.parentId, (pk = (store.get(rec.parentId) as ContainerRecord | undefined)?.index ?? ''))
        return `${pk}/${rec.index}` // same key as evaluate.orderKey, parent looked up once per parent
      }
      const sorted = <T extends { address: string; depth: number }>(xs: T[]) =>
        xs
          .map((x) => ({ x, k: order(x.address) }))
          .sort((a, b) => a.k.localeCompare(b.k) || a.x.depth - b.x.depth || a.x.address.localeCompare(b.x.address))
          .map((d) => d.x)
      counters.assembledItems += curves.length + fills.length
      return { curves: sorted(curves), fills: sorted(fills) }
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
    return { curves: base.curves.map((c) => this.curveAt(c.address, yaw)), fills: base.fills.map((f) => this.fillAt(f.address, yaw)) }
  }
  get yawCacheSize() {
    return { curves: this.yawCurves.size, fills: this.yawFills.size, budgetUsed: this.yawRetainedItems.used, budget: this.yawRetainedItems.limit }
  }

  /** Drag preview at `yaw` (onion skins): only the items the plan changes are re-done at that yaw. */
  previewAtYaw(puts: DocRecord[], yaw: number, ch: PreviewChanges = this.previewChanges(puts)): Evaluated {
    if (ch.fallback) {
      counters.previewFallbacks++
      return evaluateAtYaw(overlayReader(this.reader, puts), yaw)
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
    counters.previewItems += base.curves.length + base.fills.length
    return { curves: base.curves.map((c) => curves.get(c.address) ?? c), fills: base.fills.map((f) => fills.get(f.address) ?? f) }
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
  previewChanges(puts: DocRecord[]): PreviewChanges {
    counters.previews++
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
      return evaluate(overlayReader(this.reader, puts))
    }
    const base = this.evaluated()
    counters.previewItems += base.curves.length + base.fills.length
    return {
      curves: base.curves.map((x) => (ch.items.get(x.address) as EvalCurve | undefined) ?? x),
      fills: base.fills.map((x) => (ch.items.get(x.address) as EvalFill | undefined) ?? x),
    }
  }
}
