// KF-3 (doc 18 §26.1 v3; experiment 15deba2 → ff25632, reviewed by dot; used by `Derived` for its reference-instance
// cache): reference-instance cache entries live exactly as long as their MEMBERSHIP —
// reference exists, its source container exists, the curve exists, and the curve lies (through its parent chain)
// inside that source.
//
// Mature reference: @tldraw/store `createCache` keys entries by the record's own atom in a WeakCache
// (v5.5.2 dist-cjs/lib/Store.js:703-727), so an entry dies with its record. We need a countable table
// (KF-3 and the budget count entries), so:
// - the table is an `AtomMap` (@tldraw/store), chosen HERE because this table is written from store side effects
//   and a @tldraw/state rollback restores atoms but runs no side effects — so the table rolls back with the records
//   (a choice for this design, not a general rule for caches);
// - pruning is driven by the store's SYNCHRONOUS side effects (afterCreate / afterChange / afterDelete).
//   `store.listen` is throttled to the next frame (Store.js:169 throttleToNextFrame) and cannot give
//   "pruned when the write returns";
// - `loadStoreSnapshot` turns side effects off (Store.js:484-491): after a load the caller reconciles the table;
// - undo / redo through `store.applyDiff` run the side effects (runCallbacks defaults to true, Store.js:656).
// Observable boundary: once a `put` / `remove` / `applyDiff` returns (or the enclosing transaction commits), the
// table holds only current members — no whole read is needed. `size` counts table entries only; it is not a
// memory measure (the shared budget is a separate count).
import { unsafe__withoutCapture } from '@tldraw/state'
import { AtomMap } from '@tldraw/store'
import { referencesOf, within } from './indexes'
import type { ContainerRecord, CurveRecord, DocRecord, DocStore, ReferenceRecord } from './schema'

export const lifecycleCounters = { membershipChecks: 0 }

export class InstanceTable<V> {
  /** reference id → (curve id → value); inner maps are replaced, never mutated, so a rollback restores them */
  readonly #byRef = new AtomMap<string, ReadonlyMap<string, V>>('instanceTable')
  readonly #disposers: (() => void)[] = []

  constructor(
    private readonly store: DocStore,
    private readonly create: (ref: ReferenceRecord, curve: CurveRecord) => V,
  ) {
    const fx = store.sideEffects
    this.#disposers.push(
      fx.registerAfterChangeHandler('reference', (prev, next) => {
        if ((prev as ReferenceRecord).sourceId !== (next as ReferenceRecord).sourceId) this.#check(next.id)
      }),
      fx.registerAfterDeleteHandler('reference', (r) => this.#drop(r.id)),
      fx.registerAfterChangeHandler('curve', (prev, next) => {
        const a = (prev as CurveRecord).parentId, b = (next as CurveRecord).parentId
        if (a !== b) for (const ref of this.#refsOver([a, b])) this.#check(ref)
      }),
      fx.registerAfterDeleteHandler('curve', (c) => {
        for (const ref of this.#refsOver([(c as CurveRecord).parentId])) this.#dropCurve(ref, c.id)
      }),
      // a container moved or deleted changes the membership of every source ABOVE it (old and new chain), even
      // though the curves inside keep their own parentId (dot 1791337275)
      fx.registerAfterChangeHandler('container', (prev, next) => {
        const a = (prev as ContainerRecord).parentId, b = (next as ContainerRecord).parentId
        if (a !== b) for (const ref of this.#refsOver([a, b])) this.#check(ref)
      }),
      fx.registerAfterDeleteHandler('container', (c) => {
        for (const ref of this.#refsOver([(c as ContainerRecord).parentId, c.id])) this.#check(ref)
      }),
    )
  }

  /** The cached value of one instance (created on first read). Reading never makes a caller depend on the table. */
  get(refId: string, curveId: string): V {
    return unsafe__withoutCapture(() => {
      const inner = this.#byRef.get(refId)
      const hit = inner?.get(curveId)
      if (hit !== undefined) return hit
      const v = this.create(this.store.get(refId as any) as ReferenceRecord, this.store.get(curveId as any) as CurveRecord)
      this.#byRef.set(refId, new Map([...(inner ?? []), [curveId, v]]))
      return v
    })
  }
  get size(): number {
    return unsafe__withoutCapture(() => [...this.#byRef.values()].reduce((n, m) => n + m.size, 0))
  }
  keys(): string[] {
    return unsafe__withoutCapture(() => [...this.#byRef.entries()].flatMap(([r, m]) => [...m.keys()].map((c) => `${r}/${c}`)).sort())
  }
  /** Full reconciliation — after `loadStoreSnapshot` (side effects were off), or as a fallback. */
  reconcile() {
    // never makes a caller (e.g. a computed list) depend on the membership reads done here
    unsafe__withoutCapture(() => {
      for (const ref of [...this.#byRef.keys()]) this.#check(ref)
    })
  }
  dispose() {
    for (const d of this.#disposers.splice(0)) d()
  }

  /** references whose source is any container on these parent chains (cycle-safe; a missing container ends a chain) */
  #refsOver(starts: (string | null)[]): Set<string> {
    const out = new Set<string>()
    for (const start of starts) {
      const seen = new Set<string>()
      for (let id = start; id && !seen.has(id); ) {
        seen.add(id)
        for (const r of referencesOf(this.store, id)) out.add(r)
        id = (this.store.get(id as any) as ContainerRecord | undefined)?.parentId ?? null
      }
    }
    return out
  }
  /** recompute one reference's membership; keep only current members */
  #check(refId: string) {
    const inner = unsafe__withoutCapture(() => this.#byRef.get(refId))
    if (!inner) return
    lifecycleCounters.membershipChecks++
    const ref = this.store.get(refId as any) as ReferenceRecord | undefined
    // membership needs the reference AND its source container to exist: `within` starts from the id it is given even
    // when that record is gone, and would still collect the curves whose parentId points at it (dot, review of 15deba2)
    // only validated records are expected here; a source id that names a record of another type counts as missing
    // (dot, review of ff25632: type guard)
    const src = this.store.get(ref?.sourceId as any) as DocRecord | undefined
    if (!ref || src?.typeName !== 'container') return this.#drop(refId)
    const members = new Set<string>(within(this.store, ref.sourceId, 'curve'))
    const kept = [...inner].filter(([c]) => members.has(c))
    if (kept.length === inner.size) return
    if (kept.length) this.#byRef.set(refId, new Map(kept))
    else this.#byRef.delete(refId)
  }
  #drop(refId: string) {
    if (unsafe__withoutCapture(() => this.#byRef.has(refId))) this.#byRef.delete(refId)
  }
  #dropCurve(refId: string, curveId: string) {
    const inner = unsafe__withoutCapture(() => this.#byRef.get(refId))
    if (!inner?.has(curveId)) return
    const kept = [...inner].filter(([c]) => c !== curveId)
    if (kept.length) this.#byRef.set(refId, new Map(kept))
    else this.#byRef.delete(refId)
  }
}
