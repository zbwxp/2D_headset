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
import { counters } from './counters'
import { evalCurve, IDENTITY, orderKey, type Cubic, type EvalCurve, type EvalFill, type Evaluated } from './evaluate'
import { within } from './indexes'
import { effectivelyVisible, lockedBy } from './model'
import type { CurveRecord, DocRecord, DocStore, FillRecord, ReferenceRecord } from './schema'

/**
 * Computeds keyed by a string, with a capacity limit (least recently used are dropped). Used where a
 * key is not one record: reference × source curve now, curve × angle for onion skins later (dot: those
 * caches must not grow without bound while the angle is dragged).
 */
export class KeyedComputedCache<T> {
  private map = new Map<string, Computed<T>>()
  evictions = 0
  constructor(
    readonly capacity: number,
    private readonly create: (key: string) => Computed<T>,
  ) {}
  get(key: string): T {
    let c = this.map.get(key)
    if (c) this.map.delete(key) // re-insert = most recently used
    else c = this.create(key)
    this.map.set(key, c)
    while (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value!)
      this.evictions++
    }
    return c.get()
  }
  get size() {
    return this.map.size
  }
}

export class Derived {
  private readonly curves
  private readonly fills
  private readonly instances: KeyedComputedCache<EvalCurve>
  private readonly all: Computed<Evaluated>

  constructor(private readonly store: DocStore) {
    this.curves = store.createComputedCache<EvalCurve, CurveRecord>('evalCurve', (c) => {
      counters.curveEvals++
      return {
        address: c.id,
        curveId: c.id,
        name: c.name,
        ...evalCurve(c, IDENTITY, {}, c.id),
        stroke: c.stroke,
        visible: effectivelyVisible(store, c.parentId),
        locked: !!lockedBy(store, c.parentId),
        depth: c.depthOffset,
      }
    })
    this.fills = store.createComputedCache<EvalFill, FillRecord>('evalFill', (f) => {
      counters.fillEvals++
      return {
        address: f.id,
        color: f.color,
        // the SAME cached curve geometry the strokes use
        cubics: f.boundary.map((step) => {
          const seg = this.curve(step.curveId)!.segments.find((s) => s.id === step.segmentId)!
          const [p0, c1, c2, p3] = seg.cubic
          return step.dir === 1 ? seg.cubic : ([p3, c2, c1, p0] as Cubic)
        }),
        visible: effectivelyVisible(store, f.parentId),
        locked: !!lockedBy(store, f.parentId),
        depth: f.depthOffset,
      }
    })
    this.instances = new KeyedComputedCache<EvalCurve>(10_000, (key) => {
      const [refId, curveId] = key.split('/') as [ReferenceRecord['id'], CurveRecord['id']]
      return computed(`instance:${key}`, () => {
        counters.instanceEvals++
        const r = store.get(refId) as ReferenceRecord
        const c = store.get(curveId) as CurveRecord
        return {
          address: key,
          curveId: c.id,
          referenceId: r.id,
          name: c.name,
          ...evalCurve(c, r.transform, r.overrides, key),
          stroke: c.stroke,
          visible: effectivelyVisible(store, r.parentId),
          locked: !!lockedBy(store, r.parentId),
          depth: c.depthOffset,
        }
      })
    })
    // The assembled list: a computed too, so asking again without a change costs nothing. After a
    // change it re-collects references to the cached items (O(items), no re-evaluation).
    this.all = computed('evaluated', () => {
      const curves: EvalCurve[] = [...store.query.ids('curve').get()].map((id) => this.curve(id)!)
      for (const refId of store.query.ids('reference').get()) {
        const r = store.get(refId) as ReferenceRecord
        for (const cid of within(store, r.sourceId, 'curve')) curves.push(this.instance(r.id, cid))
      }
      const fills: EvalFill[] = [...store.query.ids('fill').get()].map((id) => this.fill(id)!)
      const order = (addr: string) => {
        const rec = store.get(addr.split('/')[0] as any) as (DocRecord & { parentId: any; index: string }) | undefined
        return rec ? orderKey(store, rec.parentId, rec.index) : ''
      }
      const cmp = (a: { address: string; depth: number }, b: { address: string; depth: number }) =>
        order(a.address).localeCompare(order(b.address)) || a.depth - b.depth || a.address.localeCompare(b.address)
      counters.assembledItems += curves.length + fills.length
      return { curves: curves.sort(cmp), fills: fills.sort(cmp) }
    })
  }

  curve(id: CurveRecord['id']) {
    return this.curves.get(id)
  }
  fill(id: FillRecord['id']) {
    return this.fills.get(id)
  }
  instance(refId: ReferenceRecord['id'], curveId: CurveRecord['id']) {
    return this.instances.get(`${refId}/${curveId}`)
  }
  /** Same value as `evaluate(reader)`, incrementally maintained. */
  evaluated(): Evaluated {
    return this.all.get()
  }
  get instanceCacheSize() {
    return this.instances.size
  }
}
