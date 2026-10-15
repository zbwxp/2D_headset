// The sphere frame's edit (docs/sphere-frame-checklist.md §2, §4): 四角 package 2's rules, run with the sphere's field —
// shared end points, handle directions, locks, links, mirror, auto-bind, preview = commit, one undo step.
import { describe, it, expect } from 'vitest'
import { Core, save, type Editor, type Vec } from '../../src'
import { fitDeformedCubic, sphereField, type Cubic, type Sphere } from '../../deform'
import { sphereOp } from '../flows/deform'

const P = (x: number, y: number): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'
const sphere: Sphere = { anchor: P(50, 32), r: 75, yaw: 30, pitch: 10, roll: 5, scale: 1.1, offset: P(3, -2) }

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
function sameOutcome(d: Core, view: string, run: (e: Editor) => void) {
  let shown: unknown, refused: string | undefined
  try { shown = d.preview(view, run)!.snapshot() } catch (err) { refused = String(err) }
  const before = every(d)
  try { d.editIn(view, run) } catch (err) {
    expect(String(err)).toBe(refused)
    expect(every(d)).toBe(before)
    return 'refused'
  }
  expect(refused).toBeUndefined()
  expect(d.in(view).snapshot()).toEqual(shown)
  return 'applied'
}

describe('the sphere frame edit', () => {
  it('two given lines sharing a point: one mapped position, both fitted ends on it; each curve is its fit', () => {
    const d = doc(), field = sphereField(sphere), before = { ab: curve(d, FRONT, 'ab'), bc: curve(d, FRONT, 'bc') }
    const op = sphereOp(d, FRONT, ['ab', 'bc'], sphere)
    d.edit(op.run)
    for (const id of ['ab', 'bc'] as const) {
      const want = fitDeformedCubic(before[id], field).shape, got = curve(d, FRONT, id)
      got.forEach((p, i) => expect(near(p, want[i]!, 1e-9)).toBe(true))
    }
    expect(near(curve(d, FRONT, 'ab')[3], field.map(P(50, 30)))).toBe(true)
    expect(curve(d, FRONT, 'ab')[3]).toEqual(curve(d, FRONT, 'bc')[0])
    expect(op.maxError).toBeGreaterThan(0)
  })

  it('at rest (no turn, scale 1, no offset, no roll) the lines stay where they are', () => {
    const d = doc(), before = ['ab', 'bc'].map(id => curve(d, FRONT, id))
    d.edit(sphereOp(d, FRONT, ['ab', 'bc'], { ...sphere, yaw: 0, pitch: 0, roll: 0, scale: 1, offset: P(0, 0) }).run)
    ;['ab', 'bc'].forEach((id, k) => curve(d, FRONT, id).forEach((p, i) => expect(near(p, before[k]![i]!, 1e-6)).toBe(true)))
  })

  it('preview = commit; one undo step; the other views unchanged', () => {
    const d = doc(), start = every(d), side = JSON.stringify(d.in(SIDE).snapshot())
    const op = sphereOp(d, FRONT, ['ab', 'bc'], sphere)
    const shown = d.preview(FRONT, op.run)!.snapshot()
    expect(every(d)).toBe(start)
    d.edit(op.run)
    expect(d.snapshot()).toEqual(shown)
    expect(JSON.stringify(d.in(SIDE).snapshot())).toBe(side)
    d.undo()
    expect(every(d)).toBe(start)
  })

  it('a line not given that shares a moved point keeps its far end and its handle offsets', () => {
    const d = doc(), cd0 = d.snapshot().lines.find(l => l.id === 'cd')!
    d.edit(sphereOp(d, FRONT, ['ab', 'bc'], sphere).run)
    const s = d.snapshot(), cd = s.lines.find(l => l.id === 'cd')!
    expect([cd.ha, cd.hb]).toEqual([cd0.ha, cd0.hb])
    expect(s.points.find(p => p.id === 'x')!.position).toEqual(P(95, 55))
    expect(s.points.find(p => p.id === 'c')!.position).not.toEqual(P(90, 20))
  })

  it('a smooth join with both lines given stays smooth', () => {
    const d = doc()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
    d.edit(sphereOp(d, FRONT, ['ab', 'bc'], sphere).run)
    const s = d.snapshot(), hb = s.lines.find(l => l.id === 'ab')!.hb, ha = s.lines.find(l => l.id === 'bc')!.ha
    expect(Math.abs(hb.x * ha.y - hb.y * ha.x) / (Math.hypot(hb.x, hb.y) * Math.hypot(ha.x, ha.y))).toBeLessThan(1e-9)
    expect(hb.x * ha.x + hb.y * ha.y).toBeLessThan(0)
  })

  it('locks: a locked line given, or reached through a moved point or a link — refused by preview and commit alike', () => {
    const d = doc()
    d.edit(e => e.lineState('bc', { locked: true }))
    const before = every(d)
    for (const lines of [['bc'], ['ab']]) {
      const op = sphereOp(d, FRONT, lines, sphere)
      expect(() => d.edit(op.run)).toThrow(/Locked lines would change/)
      expect(() => d.preview(FRONT, op.run)).toThrow(/Locked lines would change/)
    }
    expect(every(d)).toBe(before)
    const e2 = doc()
    e2.edit(e => e.link('a', 'm')); e2.edit(e => e.lineState('mn', { locked: true }))
    expect(sameOutcome(e2, FRONT, sphereOp(e2, FRONT, ['ab'], sphere).run)).toBe('refused')
  })

  it('a point of another layer linked to a moved point follows it', () => {
    const d = doc()
    d.edit(e => e.link('a', 'm'))
    d.edit(sphereOp(d, FRONT, ['ab'], sphere).run)
    const s = d.snapshot(), at = (p: string) => s.points.find(x => x.id === p)!.position
    expect(at('m')).toEqual(at('a'))
  })

  it('no line, an unknown one, or a sphere that does not hold the lines: refused before anything is written', () => {
    const d = doc(), before = every(d)
    expect(() => sphereOp(d, FRONT, [], sphere)).toThrow(/deform-no-lines/)
    expect(() => sphereOp(d, FRONT, ['zz'], sphere)).toThrow(/deform-unknown-line/)
    expect(() => sphereOp(d, FRONT, ['ab'], { ...sphere, r: 20 })).toThrow('超出了球面')
    expect(() => sphereOp(d, FRONT, ['ab', 'bc'], { ...sphere, r: 46, yaw: 80 })).toThrow('背面')
    expect(every(d)).toBe(before)
    expect(save(d)).toBe(save(d))
  })

  it('an arc join between two given lines: the real point goes to map(position)', () => {
    const d = doc()
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 6 }))
    d.edit(sphereOp(d, FRONT, ['ab', 'bc'], sphere).run)
    expect(d.snapshot().points.find(p => p.id === 'b')!.position).toEqual(sphereField(sphere).map(P(50, 30)))
  })

  it('building the op freezes its plan: two previews and the commit give one result', () => {
    const d = doc(), op = sphereOp(d, FRONT, ['ab', 'bc'], sphere)
    const one = d.preview(FRONT, op.run)!.snapshot(), two = d.preview(FRONT, op.run)!.snapshot()
    d.edit(op.run)
    expect([two, d.snapshot()]).toEqual([one, one])
  })

  it('in another view: only that view changes', () => {
    const d = doc(), front = JSON.stringify(d.snapshot())
    d.editIn(SIDE, sphereOp(d, SIDE, ['ab'], sphere).run)
    expect(JSON.stringify(d.snapshot())).toBe(front)
    expect(curve(d, SIDE, 'ab')[0]).toEqual(sphereField(sphere).map(P(10, 10)))
  })

  it('mirror (front): one side or both given, preview = commit', () => {
    const make = () => {
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
    const s2: Sphere = { ...sphere, anchor: P(0, 20), r: 70 }
    const one = make()
    expect(sameOutcome(one, FRONT, sphereOp(one, FRONT, ['l'], s2).run)).toBe('applied')
    const at = (p: string) => one.snapshot().points.find(x => x.id === p)!.position
    expect(near(at('q2'), P(-at('p2').x, at('p2').y), 1e-9)).toBe(true)
    const both = make()
    sameOutcome(both, FRONT, sphereOp(both, FRONT, ['l', 'r'], s2).run)
  })

  it('an end landing on another point of its layer: the commit binds, and the preview shows the same bind', () => {
    const d = doc()
    // at rest but moved by (50, 35): a (10, 10) lands exactly on w (60, 45)
    d.edit(e => e.line('loose', { id: 'u', layer: 'L', position: P(10, 70) }, { id: 'w', layer: 'L', position: P(60, 45) }))
    const points = d.snapshot().points.length
    const moved: Sphere = { ...sphere, yaw: 0, pitch: 0, roll: 0, scale: 1, offset: P(50, 35) }
    expect(sameOutcome(d, FRONT, sphereOp(d, FRONT, ['ab'], moved).run)).toBe('applied')
    expect(d.snapshot().points.length).toBeLessThan(points)
  })
})
