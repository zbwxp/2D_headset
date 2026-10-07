// KF-3 experiment (doc 18 §26.1 v3): instance entries follow membership, observable as soon as the write returns —
// never by first reading the whole table. Independent module `src/experiments/instanceLifecycle.ts`.
import { transaction } from '@tldraw/state'
import { reverseRecordsDiff } from '@tldraw/store'
import { describe, expect, it } from 'vitest'
import { InstanceTable, lifecycleCounters } from '../src/experiments/instanceLifecycle'
import { exampleRecords, ids } from '../src/fixture'
import { Container, createDocStore, Curve, Reference, type DocRecord } from '../src/schema'

const setup = () => {
  const s = createDocStore()
  s.put(exampleRecords())
  let made = 0
  const t = new InstanceTable(s, (r, c) => ({ n: ++made, ref: r.id, curve: c.id }))
  return { s, t }
}
const ref = (name: string, sourceId = ids.L3) => Reference.create({ id: Reference.createId(name), name: 'x', parentId: ids.L1, sourceId, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } })
const curveIn = (name: string, parentId: any) => ({ ...(exampleRecords().find((r) => r.id === ids.E1) as any), id: Curve.createId(name), parentId })

describe('KF-3 experiment: instance entries follow membership', () => {
  it('the original KF-3 scenario: 20 put / read / remove cycles never leave historical entries (no whole read)', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    for (let i = 0; i < 20; i++) {
      const r = ref(`dot${i}`)
      s.put([r])
      t.get(r.id, ids.E1)
      expect(t.size).toBe(2)
      s.remove([r.id])
      expect(t.size).toBe(1)
    }
    expect(t.keys()).toEqual([`${ids.R1}/${ids.E1}`])
  })

  it('changing a reference’s source drops the entries that are no longer members', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    s.put([{ ...(s.get(ids.R1) as any), sourceId: ids.L2 }])
    expect(t.size).toBe(0)
  })

  it('a curve moved out of the source drops its entry; moving back does not resurrect anything by itself', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    s.put([{ ...(s.get(ids.E1) as any), parentId: ids.L2 }])
    expect(t.size).toBe(0)
    s.put([{ ...(s.get(ids.E1) as any), parentId: ids.L3 }])
    expect(t.size).toBe(0)
  })

  it('a sub-container moved out of the source drops the entries of the curves inside it (their parentId did not change)', () => {
    const { s, t } = setup()
    const X = Container.create({ id: Container.createId('X'), name: 'X', parentId: ids.L3, index: 'a9' } as any)
    const cx = curveIn('CX', X.id)
    s.put([X, cx as any])
    t.get(ids.R1, ids.E1)
    t.get(ids.R1, cx.id)
    expect(t.size).toBe(2)
    s.put([{ ...(s.get(X.id) as any), parentId: null }])
    expect(t.keys()).toEqual([`${ids.R1}/${ids.E1}`])
  })

  it('one transaction: added then removed, and added → read → removed — nothing is left', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    transaction(() => {
      const a = ref('a')
      s.put([a])
      s.remove([a.id])
    })
    transaction(() => {
      const b = ref('b')
      s.put([b])
      t.get(b.id, ids.E1)
      s.remove([b.id])
    })
    expect(t.keys()).toEqual([`${ids.R1}/${ids.E1}`])
  })

  it('the same id deleted and recreated gets a fresh entry (the old value is not reused)', () => {
    const { s, t } = setup()
    const r = ref('same')
    s.put([r])
    const first = t.get(r.id, ids.E1)
    s.remove([r.id])
    s.put([r])
    const second = t.get(r.id, ids.E1)
    expect(second).not.toBe(first)
    expect(t.keys()).toEqual([`${r.id}/${ids.E1}`]) // R1 was never read here
  })

  it('a rolled-back transaction restores the table with the records (side effects do not run on rollback)', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    expect(() =>
      transaction(() => {
        const r = ref('rolled')
        s.put([r])
        t.get(r.id, ids.E1)
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(s.get(Reference.createId('rolled'))).toBeUndefined()
    expect(t.keys()).toEqual([`${ids.R1}/${ids.E1}`])
    // and a rolled-back delete keeps the entry
    expect(() =>
      transaction(() => {
        s.remove([ids.R1])
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(s.get(ids.R1)).toBeDefined()
    expect(t.keys()).toEqual([`${ids.R1}/${ids.E1}`])
  })

  it('undo / redo applied with applyDiff run the same side effects', () => {
    const { s, t } = setup()
    const r = ref('u')
    const diff = s.extractingChanges(() => s.put([r]))
    t.get(r.id, ids.E1)
    t.get(ids.R1, ids.E1)
    s.applyDiff(reverseRecordsDiff(diff)) // undo the create
    expect(t.keys()).toEqual([`${ids.R1}/${ids.E1}`])
    s.applyDiff(diff) // redo: the record is back, its entry is created on the next read only
    expect(t.size).toBe(1)
    t.get(r.id, ids.E1)
    expect(t.size).toBe(2)
  })

  it('loading a snapshot turns side effects off: the table is reconciled explicitly afterwards', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    const snap = s.getStoreSnapshot()
    const without = { ...snap, store: Object.fromEntries(Object.entries(snap.store).filter(([id]) => id !== ids.R1)) }
    s.loadStoreSnapshot(without as any)
    expect(t.size).toBe(1) // stale: no callback ran during the load (tldraw disables side effects)
    t.reconcile()
    expect(t.size).toBe(0)
  })

  it('a change under a container no reference reads does not re-check any membership', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    const before = lifecycleCounters.membershipChecks
    s.put([{ ...(s.get(ids.C1) as any), parentId: ids.L2 }]) // L1 → L2: neither is a source
    expect(lifecycleCounters.membershipChecks - before).toBe(0)
    expect(t.size).toBe(1)
  })

  it('dispose unregisters every callback', () => {
    const { s, t } = setup()
    t.get(ids.R1, ids.E1)
    t.dispose()
    s.remove([ids.R1])
    expect(t.size).toBe(1) // no callback ran any more
  })
})

// not covered here (the product integration step, after review): preview overlays never write this table — the
// product preview reads through an overlay reader and evaluates changed instances without the cache.
void ([] as DocRecord[])
