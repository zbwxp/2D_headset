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

  it('in another view: only that view changes', () => {
    const d = doc(), front = JSON.stringify(d.snapshot())
    d.editIn(SIDE, deformOp(d, SIDE, ['ab'], rect, quad, bend).run)
    expect(JSON.stringify(d.snapshot())).toBe(front)
    expect(curve(d, SIDE, 'ab')[0]).toEqual(deformField(rect, quad, bend).map(P(10, 10)))
  })
})
