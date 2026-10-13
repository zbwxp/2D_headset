// Package 2 of the 四角 / 曲边 deform (docs/deform-p2-checklist.md §3): deformOp on a real Core — shared end
// points, handle directions, locks, links, preview = commit, one undo step.
import { describe, it, expect } from 'vitest'
import { Core, save, type Vec } from '../../src'
import { deformField, fitDeformedCubic, neutralHandles, rectQuad, type Bend, type BendHandles, type Cubic, type Quad } from '../../deform'
import { deformOp } from '../flows/deform'

const P = (x: number, y: number): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'
const rect = { min: P(0, 0), max: P(100, 60) }
const quad: Quad = [P(-5, 5), P(110, -6), P(95, 70), P(8, 58)]
const bend: Bend = { enabled: true, handles: neutralHandles().map((e, i) => e.map(p => (i === 2 ? P(p.x, p.y + 0.15) : p))) as unknown as BendHandles }

/** Layer L: ab (a→b) and bc (b→c) meeting at b, curved; cd separate, sharing c with bc; layer M: mn apart. */
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.layer('M', 'M')
    e.line('ab', { id: 'a', layer: 'L', position: P(10, 10) }, { id: 'b', layer: 'L', position: P(50, 30) }, { ha: P(10, 15), hb: P(-15, -5) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(90, 20) }, { ha: P(15, 5), hb: P(-10, 10) })
    e.line('cd', 'c', { id: 'x', layer: 'L', position: P(95, 55) }, { ha: P(3, 10), hb: P(-5, -8) })
    e.line('mn', { id: 'm', layer: 'M', position: P(20, 50) }, { id: 'n', layer: 'M', position: P(60, 50) })
  })
  return d
}
const curve = (d: Core, k: string, id: string): Cubic => {
  const s = d.in(k).snapshot(), l = s.lines.find(x => x.id === id)!, at = (p: string) => s.points.find(x => x.id === p)!.position
  const a = at(l.a), b = at(l.b)
  return [a, P(a.x + l.ha.x, a.y + l.ha.y), P(b.x + l.hb.x, b.y + l.hb.y), b]
}
const near = (p: Vec, q: Vec, tol = 1e-9) => Math.hypot(p.x - q.x, p.y - q.y) <= tol
const every = (d: Core) => JSON.stringify(d.views().map(k => d.in(k).snapshot()))

describe('the deform edit (package 2)', () => {
  it('two given lines sharing a point: one mapped position, both fitted ends on it; each line\'s curve is its fit', () => {
    const d = doc(), field = deformField(rect, quad, bend), before = { ab: curve(d, FRONT, 'ab'), bc: curve(d, FRONT, 'bc') }
    const op = deformOp(d, FRONT, ['ab', 'bc'], rect, quad, bend)
    d.edit(op.run)
    for (const id of ['ab', 'bc'] as const) {
      const want = fitDeformedCubic(before[id], field).shape, got = curve(d, FRONT, id)
      got.forEach((p, i) => expect(near(p, want[i]!, 1e-9)).toBe(true))
    }
    expect(near(curve(d, FRONT, 'ab')[3], field.map(P(50, 30)))).toBe(true)
    expect(curve(d, FRONT, 'ab')[3]).toEqual(curve(d, FRONT, 'bc')[0])
    expect(op.maxError).toBeGreaterThan(0)
  })

  it('an affine frame maps the control points exactly', () => {
    const d = doc(), before = curve(d, FRONT, 'ab'), sq = rectQuad({ min: P(20, 10), max: P(220, 130) })
    d.edit(deformOp(d, FRONT, ['ab'], rect, sq).run)
    const m = (p: Vec) => P(20 + p.x * 2, 10 + p.y * 2)
    curve(d, FRONT, 'ab').forEach((p, i) => expect(near(p, m(before[i]!))).toBe(true))
  })

  it('preview = commit; one undo step; the other views unchanged', () => {
    const d = doc(), start = every(d), side = JSON.stringify(d.in(SIDE).snapshot())
    const op = deformOp(d, FRONT, ['ab', 'bc'], rect, quad, bend)
    const shown = d.preview(FRONT, op.run)!.snapshot()
    expect(every(d)).toBe(start) // a preview writes nothing
    d.edit(op.run)
    expect(d.snapshot()).toEqual(shown)
    expect(JSON.stringify(d.in(SIDE).snapshot())).toBe(side)
    d.undo()
    expect(every(d)).toBe(start)
  })

  it('a line not given that shares a moved point keeps its far end and its handle offsets', () => {
    const d = doc(), s0 = d.snapshot(), cd0 = s0.lines.find(l => l.id === 'cd')!
    d.edit(deformOp(d, FRONT, ['ab', 'bc'], rect, quad, bend).run)
    const s = d.snapshot(), cd = s.lines.find(l => l.id === 'cd')!
    expect([cd.ha, cd.hb]).toEqual([cd0.ha, cd0.hb])
    expect(s.points.find(p => p.id === 'x')!.position).toEqual(P(95, 55))
    expect(s.points.find(p => p.id === 'c')!.position).not.toEqual(P(90, 20))
  })

  it('a smooth join with both lines given stays smooth: the two handles at b stay opposite', () => {
    const d = doc()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(deformOp(d, FRONT, ['ab', 'bc'], rect, quad, bend).run)
    const s = d.snapshot(), hb = s.lines.find(l => l.id === 'ab')!.hb, ha = s.lines.find(l => l.id === 'bc')!.ha
    expect(Math.abs(hb.x * ha.y - hb.y * ha.x) / (Math.hypot(hb.x, hb.y) * Math.hypot(ha.x, ha.y))).toBeLessThan(1e-9)
    expect(hb.x * ha.x + hb.y * ha.y).toBeLessThan(0)
  })

  it('a locked line given, or a locked line a moved point would change: refused, nothing changes, the preview refused alike', () => {
    const d = doc()
    d.edit(e => e.lineState('bc', { locked: true }))
    const before = every(d)
    for (const lines of [['bc'], ['ab']]) { // ab moves b, the end of the locked bc
      const op = deformOp(d, FRONT, lines, rect, quad, bend)
      expect(() => d.edit(op.run)).toThrow(/Locked lines would change/)
      expect(() => d.preview(FRONT, op.run)).toThrow(/Locked lines would change/)
    }
    expect(every(d)).toBe(before)
  })

  it('a point of another layer linked to a moved point follows it', () => {
    const d = doc()
    d.edit(e => e.link('a', 'm'))
    d.edit(deformOp(d, FRONT, ['ab'], rect, quad, bend).run)
    const s = d.snapshot(), at = (p: string) => s.points.find(x => x.id === p)!.position
    expect(at('m')).toEqual(at('a'))
  })

  it('no line, or an unknown one: refused before anything is written', () => {
    const d = doc(), before = every(d)
    expect(() => deformOp(d, FRONT, [], rect, quad)).toThrow(/deform-no-lines/)
    expect(() => deformOp(d, FRONT, ['zz'], rect, quad)).toThrow(/deform-unknown-line/)
    expect(every(d)).toBe(before)
    expect(save(d)).toBe(save(d))
  })

  it('an arc join between two given lines: the real points go to map(position), not to the trimmed ends of geometry()', () => {
    const d = doc()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 6 }))
    const trimmed = d.geometry().lines.find(l => l.id === 'ab')!.curve[3]
    expect(near(trimmed, P(50, 30), 1e-6)).toBe(false) // geometry's end is trimmed by the arc
    const field = deformField(rect, quad, bend)
    d.edit(deformOp(d, FRONT, ['ab', 'bc'], rect, quad, bend).run)
    expect(d.snapshot().points.find(p => p.id === 'b')!.position).toEqual(field.map(P(50, 30)))
  })

  it('building the op freezes its plan: previewing it twice, then committing, gives one result', () => {
    const d = doc(), op = deformOp(d, FRONT, ['ab', 'bc'], rect, quad, bend)
    const one = d.preview(FRONT, op.run)!.snapshot(), two = d.preview(FRONT, op.run)!.snapshot()
    d.edit(op.run)
    expect([two, d.snapshot()]).toEqual([one, one])
  })

  it('in another view: only that view changes', () => {
    const d = doc(), front = JSON.stringify(d.snapshot())
    d.editIn(SIDE, deformOp(d, SIDE, ['ab'], rect, quad, bend).run)
    expect(JSON.stringify(d.snapshot())).toBe(front)
    expect(curve(d, SIDE, 'ab')[0]).toEqual(deformField(rect, quad, bend).map(P(10, 10)))
  })
})

/** Preview and commit of the same op on the same document: the same snapshot, or the same refusal. */
function sameOutcome(d: Core, view: string, run: (e: import('../../src').Editor) => void) {
  let shown: unknown, refused: string | undefined
  try { shown = d.preview(view, run)!.snapshot() } catch (err) { refused = String(err) }
  const before = JSON.stringify(d.views().map(k => d.in(k).snapshot()))
  try { d.editIn(view, run) } catch (err) {
    expect(String(err)).toBe(refused)
    expect(JSON.stringify(d.views().map(k => d.in(k).snapshot()))).toBe(before)
    return 'refused'
  }
  expect(refused).toBeUndefined()
  expect(d.in(view).snapshot()).toEqual(shown)
  return 'applied'
}

describe('preview against commit under the commit\'s own rules (dot 1791892720)', () => {
  /** Layers L and R, mirror-linked in the front: l (p1→p2) and its reflection r (q1→q2). */
  function mirrored() {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.layer('R', 'R')
      e.line('l', { id: 'p1', layer: 'L', position: P(-40, 10) }, { id: 'p2', layer: 'L', position: P(-10, 30) }, { ha: P(5, 10), hb: P(-8, 2) })
      e.line('r', { id: 'q1', layer: 'R', position: P(40, 10) }, { id: 'q2', layer: 'R', position: P(10, 30) }, { ha: P(-5, 10), hb: P(8, 2) })
    })
    const g = (line: string) => d.snapshot().groups.find(x => x.lines.includes(line))!.id
    d.edit(e => e.mirrorLink([g('l')], [g('r')]))
    return d
  }
  const box = { min: P(-50, 0), max: P(50, 40) }, skew: Quad = [P(-52, 3), P(55, -4), P(48, 44), P(-46, 39)]

  it('front, one mirror side given: preview = commit (the partner mirrored by the link)', () => {
    const d = mirrored()
    expect(sameOutcome(d, FRONT, deformOp(d, FRONT, ['l'], box, skew).run)).toBe('applied')
    const s = d.snapshot(), at = (p: string) => s.points.find(x => x.id === p)!.position
    expect(near(at('q2'), P(-at('p2').x, at('p2').y), 1e-9)).toBe(true)
  })

  it('front, both mirror sides given: preview = commit', () => {
    const d = mirrored()
    sameOutcome(d, FRONT, deformOp(d, FRONT, ['l', 'r'], box, skew).run)
  })

  it('an end landing on another point of its layer: the commit binds, and the preview shows the same bind', () => {
    const d = doc()
    // a loose line ending at w (60, 45); a translation by (50, 35) takes a (10, 10) exactly onto w
    d.edit(e => e.line('loose', { id: 'u', layer: 'L', position: P(10, 70) }, { id: 'w', layer: 'L', position: P(60, 45) }))
    const moved = rectQuad({ min: P(50, 35), max: P(150, 95) })
    const points = d.snapshot().points.length
    expect(sameOutcome(d, FRONT, deformOp(d, FRONT, ['ab'], rect, moved).run)).toBe('applied')
    expect(d.snapshot().points.length).toBeLessThan(points)
  })

  it('a lock reached through a link: refused by both, nothing changes', () => {
    const d = doc()
    d.edit(e => e.link('a', 'm')); d.edit(e => e.lineState('mn', { locked: true }))
    expect(sameOutcome(d, FRONT, deformOp(d, FRONT, ['ab'], rect, quad, bend).run)).toBe('refused')
  })
})
