// Paint-order contract (PAINT-ORDER.md): the evaluation core's ONE paint list.
// 1. The contract's small cases (src/paintCases.ts): the expected "a is painted above b" pairs.
// 2. Property over random container trees (nesting, mixed-case fractional indexes, references): the
//    paint list is a permutation of all items, the maker (cached Derived), the full recompute and the
//    runtime entry give the same list, and it agrees with an independent oracle written as an
//    element-wise comparison of index PATHS (not the joined-string key the implementation uses).
// 3. The order is identities + order only: a geometry edit does not rebuild it, a preview reads
//    current geometry, a structural edit does rebuild it.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { counters, resetCounters } from '../src/counters'
import { Editor } from '../src/editor'
import { evaluate, unappliedContainerOpacity, unappliedDepthOffsets, type Evaluated } from '../src/evaluate'
import { paintCases } from '../src/paintCases'
import { evaluateSaved } from '../src/runtime'
import { Container, Curve, Fill, Reference, type Anchor, type DocRecord } from '../src/schema'

const order = (ev: Evaluated) => ev.paint.map((p) => p.item.address)

describe('contract cases: painted-above pairs', () => {
  for (const [name, c] of Object.entries(paintCases))
    it(`${name}: ${c.rule}`, () => {
      const e = new Editor(c.records())
      const list = order(e.derived.evaluated())
      for (const [above, below] of c.above ?? []) {
        expect(list.indexOf(above), `${above} in list`).toBeGreaterThanOrEqual(0)
        expect(list.indexOf(below), `${below} in list`).toBeGreaterThanOrEqual(0)
        expect(list.indexOf(above), `${above} painted above ${below}`).toBeGreaterThan(list.indexOf(below))
      }
      expect(list).toEqual(order(evaluate(e.reader)))
      expect(list).toEqual(order(evaluateSaved(c.records())))
    })
})

// ---- random trees -------------------------------------------------------------------------------
const anchor = (id: string, x: number, y: number): Anchor => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
// includes mixed case, prefixes of each other and (often) EQUAL sibling indexes (dot: equal ancestor
// indexes interleaved their contents before ties were broken per level)
const idx = fc.oneof(fc.constantFrom('a0', 'a1', 'a1V'), fc.stringMatching(/^[0-9A-Za-z]{1,3}$/))
type Spec = { containers: { parent: number; index: string }[]; items: { kind: 'curve' | 'fill' | 'reference'; parent: number; index: string; other: number }[] }
const spec: fc.Arbitrary<Spec> = fc.record({
  containers: fc.array(fc.record({ parent: fc.nat(), index: idx }), { minLength: 1, maxLength: 7 }),
  items: fc.array(fc.record({ kind: fc.constantFrom('curve', 'fill', 'reference'), parent: fc.nat(), index: idx, other: fc.nat() }), { minLength: 1, maxLength: 14 }),
})

function build(s: Spec): DocRecord[] {
  const out: DocRecord[] = []
  const kid = (i: number) => Container.createId(`K${i}`)
  const parentOf: (number | null)[] = []
  s.containers.forEach((c, i) => {
    const parent = i === 0 || c.parent % (i + 1) === i ? null : c.parent % i // only earlier containers: no cycles
    parentOf.push(parent)
    out.push(Container.create({ id: kid(i), name: `K${i}`, index: c.index, parentId: parent === null ? null : kid(parent) }))
  })
  const insideOf = (k: number, src: number) => {
    for (let x: number | null = k; x !== null; x = parentOf[x]) if (x === src) return true
    return false
  }
  const n = s.containers.length
  s.items.forEach((it, i) => {
    const parent = kid(it.parent % n)
    if (it.kind === 'curve')
      out.push(Curve.create({ id: Curve.createId(`C${i}`), name: `C${i}`, parentId: parent, index: it.index, anchors: { p: anchor('p', i, 0), q: anchor('q', i, 9) }, segments: [{ id: 's', from: 'p', to: 'q' }] }))
    else if (it.kind === 'fill') {
      // its own closed boundary curve, placed in any container (cross-layer boundaries are allowed, R7)
      const b = Curve.create({
        id: Curve.createId(`B${i}`),
        name: `B${i}`,
        parentId: kid(it.other % n),
        index: it.index,
        anchors: { a: anchor('a', 0, 0), b: anchor('b', 5, 0), c: anchor('c', 5, 5) },
        segments: [
          { id: 'ab', from: 'a', to: 'b' },
          { id: 'bc', from: 'b', to: 'c' },
          { id: 'ca', from: 'c', to: 'a' },
        ],
      })
      out.push(b, Fill.create({ id: Fill.createId(`F${i}`), name: `F${i}`, parentId: parent, index: it.index, boundary: ['ab', 'bc', 'ca'].map((segmentId) => ({ curveId: b.id, segmentId, dir: 1 as const })) }))
    } else {
      const src = it.other % n
      if (insideOf(it.parent % n, src)) return // a reference may not sit inside its own source
      out.push(Reference.create({ id: Reference.createId(`R${i}`), name: `R${i}`, parentId: parent, index: it.index, sourceId: kid(src), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }))
    }
  })
  return out
}

/** Independent oracle: the (index, id) path of a painted item, from the root. */
function pathOf(records: Map<string, any>, address: string): [string, string][] {
  const up = (id: string | null, stop?: string): [string, string][] => {
    const path: [string, string][] = []
    for (let r = id ? records.get(id) : undefined; r && r.id !== stop; r = r.parentId ? records.get(r.parentId) : undefined) path.unshift([r.index, r.id])
    return path
  }
  const [head, tail] = address.split('/')
  if (!tail) return up(head)
  const ref = records.get(head)
  // inside an instance the source's containers are COPIES: identified per reference
  return [...up(head), ...up(tail, ref.sourceId).map(([index, id]): [string, string] => [index, `${head}/${id}`])]
}
/** Order of two painted items: at the first level where their paths differ, by index (code unit), then
 *  — equal indexes — by the record id at THAT level, so each subtree stays contiguous. */
function rule(a: [string, string][], b: [string, string][]) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i][1] === b[i][1]) continue
    if (a[i][0] !== b[i][0]) return a[i][0] < b[i][0] ? -1 : 1
    return a[i][1] < b[i][1] ? -1 : 1
  }
  return 0
}

describe('random trees', () => {
  it('one list: permutation of all items, maker = full = runtime, agrees with the path oracle', () => {
    fc.assert(
      fc.property(spec, (s) => {
        const records = build(s)
        const e = new Editor(records)
        const ev = e.derived.evaluated()
        const list = order(ev)
        const all = [...ev.curves, ...ev.fills].map((x) => x.address)
        expect([...list].sort()).toEqual([...all].sort())
        expect(new Set(list).size).toBe(list.length)
        expect(list).toEqual(order(evaluate(e.reader)))
        expect(list).toEqual(order(evaluateSaved(records)))
        const byId = new Map(records.map((r) => [r.id as string, r]))
        const paths = list.map((a) => pathOf(byId, a))
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) expect(rule(paths[i], paths[j]), `${list[i]} before ${list[j]}`).toBe(-1)
        // and directly: every container's painted content is one contiguous block of the list
        for (const k of records.filter((r) => r.typeName === 'container')) {
          const at = list.flatMap((a, i) => (pathOf(byId, a).some(([, id]) => id === k.id) ? [i] : []))
          if (at.length) expect(at[at.length - 1] - at[0] + 1, `${k.id} contiguous`).toBe(at.length)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('order caches identities and order only (dot)', () => {
  const doc = () => paintCases['P7-others'].records()
  it('a geometry edit does not rebuild the order; the list shows the new geometry', () => {
    const e = new Editor(doc())
    e.derived.evaluated()
    resetCounters()
    const r = e.apply({ type: 'moveAnchors', targets: [{ curveId: Curve.createId('U'), anchorId: 'p' }], delta: { x: 3, y: 0 } })
    expect(r.ok).toBe(true)
    const ev = e.derived.evaluated()
    expect(counters.paintOrderBuilds).toBe(0)
    expect((ev.paint.find((p) => p.item.address === 'curve:U')!.item as any).anchors.p.p.x).toBe(3)
    expect(ev).toEqual(evaluate(e.reader))
  })
  it('a drag preview keeps the order and reads the planned geometry', () => {
    const e = new Editor(doc())
    const base = e.derived.evaluated()
    const u = e.reader.get(Curve.createId('U'))!
    const moved = { ...u, anchors: { ...u.anchors, p: anchor('p', 7, 40) } }
    resetCounters()
    const pv = e.derived.preview([moved as DocRecord])
    expect(counters.paintOrderBuilds).toBe(0)
    expect(order(pv)).toEqual(order(base))
    expect((pv.paint.find((p) => p.item.address === 'curve:U')!.item as any).anchors.p.p.x).toBe(7)
  })
  it('a structural change (layer index) rebuilds the order and moves the items', () => {
    const records = doc()
    const e = new Editor(records)
    const before = order(e.derived.evaluated())
    resetCounters()
    const swapped = records.map((r) => (r.id === Container.createId('L1') ? { ...r, index: 'a9' } : r))
    const e2 = new Editor(swapped)
    expect(order(e2.derived.evaluated())).not.toEqual(before)
    expect(order(e2.derived.evaluated())).toEqual(order(evaluate(e2.reader)))
  })
})

describe('depth offsets are reported, not applied (D1 open)', () => {
  it('a stored non-zero depth offset leaves the order unchanged and is listed', () => {
    const records = paintCases['P2-fill-layer-in-front'].records()
    const plain = order(evaluate(new Editor(records).reader))
    const withOffset = records.map((r) => (r.id === Curve.createId('C') ? { ...r, depthOffset: 5 } : r))
    const ev = new Editor(withOffset).derived.evaluated()
    expect(order(ev)).toEqual(plain)
    expect(unappliedDepthOffsets(ev)).toEqual(['curve:C'])
  })
})

describe('own ink (S2): decided once by the core', () => {
  const ownOf = (ev: Evaluated, fill: string) => (ev.paint.find((p) => p.item.address === fill) as any).ownInk
  it('a fill after its visible own boundary lists it; before it, nothing', () => {
    expect(ownOf(new Editor(paintCases['P6-own-boundary'].records()).derived.evaluated(), 'fill:F')).toEqual(['curve:F-boundary'])
    expect(ownOf(new Editor(paintCases['P6-cross-layer'].records()).derived.evaluated(), 'fill:F')).toEqual(['curve:F-boundary'])
    // move the boundary after the fill (index a9 > a2): nothing to leave out
    const recs = paintCases['P6-own-boundary'].records().map((r) => (r.id === Curve.createId('F-boundary') ? { ...r, index: 'a9' } : r))
    expect(ownOf(new Editor(recs).derived.evaluated(), 'fill:F')).toEqual([])
  })
  it('a hidden own boundary protects nothing (no hidden line is revived)', () => {
    const recs = paintCases['P6-cross-layer'].records().map((r) => (r.id === Container.createId('L1') ? { ...r, visible: false } : r))
    expect(ownOf(new Editor(recs).derived.evaluated(), 'fill:F')).toEqual([])
  })
  it('maker, full recompute, runtime, preview and a yaw all carry the same ownInk', () => {
    const recs = paintCases['P6-third-party-between'].records()
    const e = new Editor(recs)
    const want = ownOf(e.derived.evaluated(), 'fill:F')
    expect(ownOf(evaluate(e.reader), 'fill:F')).toEqual(want)
    expect(ownOf(evaluateSaved(recs), 'fill:F')).toEqual(want)
    expect(ownOf(e.derived.atYaw(30), 'fill:F')).toEqual(want)
    const b = e.reader.get(Curve.createId('F-boundary'))!
    expect(ownOf(e.derived.preview([{ ...b, anchors: { ...(b as any).anchors, a: anchor('a', 21, 10) } } as DocRecord]), 'fill:F')).toEqual(want)
  })
})

describe('picking a fill obeys the same protected area (S2)', () => {
  it('a point on the own ink inside the fill is not the fill; the interior is', async () => {
    const { hitTest } = await import('../src/evaluate')
    const ev = new Editor(paintCases['P6-own-boundary'].records()).derived.evaluated()
    // tolerance below the half-width so the segment rule does not decide: only the fill test runs
    expect(hitTest(ev, { x: 40, y: 11 }, { mode: 'V', tolerance: 0.1 })).toBeNull()
    expect(hitTest(ev, { x: 40, y: 30 }, { mode: 'V', tolerance: 0.1 })).toMatchObject({ kind: 'fill', address: 'fill:F' })
    // without protection (boundary after the fill) the same point IS the fill
    const recs = paintCases['P6-own-boundary'].records().map((r) => (r.id === Curve.createId('F-boundary') ? { ...r, index: 'a9' } : r))
    expect(hitTest(new Editor(recs).derived.evaluated(), { x: 40, y: 11 }, { mode: 'V', tolerance: 0.1 })).toMatchObject({ kind: 'fill' })
  })
})

describe('container opacity is reported, not applied (current scope limit, D7)', () => {
  it('a stored opacity below 1 leaves the picture data unchanged and is listed', () => {
    const records = paintCases['P2-fill-layer-in-front'].records()
    const plain = new Editor(records).derived.evaluated()
    const faded = records.map((r) => (r.id === Container.createId('L2') ? { ...r, opacity: 0.5 } : r))
    const e = new Editor(faded)
    expect(e.derived.evaluated()).toEqual(plain)
    expect(unappliedContainerOpacity(e.reader as any)).toEqual(['container:L2'])
    expect(unappliedContainerOpacity(new Editor(records).reader as any)).toEqual([])
  })
})
