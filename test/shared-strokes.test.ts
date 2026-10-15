// Every stroke value on the meta-curve, one for all views (bowen 1792057240 / 1792057731; docs/shared-strokes-checklist.md §6):
// a point's width, a line's profile, a point's end stroke and a join's manual zone are set from any view and read the same
// in every view and at every pose; an old file (version 13) takes the front's, after version 13's own checks.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'
import { strokesPerView } from './old-files'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45'
const POSES = [{ yaw: 30, pitch: 0 }, { yaw: -60, pitch: 45 }, { yaw: 17, pitch: -20 }]
const KEY = JSON.stringify(['b', 'ab', 'bc'])

/** ab and bc at b (a smooth join), with the side view's curves moved so views and poses differ. */
function corner() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(30, 10) }) })
  d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
  d.editIn(SIDE, e => e.move([{ id: 'c', target: P(14, 30) }]))
  return d
}
/** The four values as a reader shows them: every point's width and end stroke, every line's stroke, every join's zone. */
const strokes = (s: ReturnType<Core['snapshot']>) => ({
  points: s.points.map(p => [p.id, p.width, p.endStroke ?? null]),
  lines: s.lines.map(l => [l.id, l.stroke]),
  zones: s.joins.map(j => [j.point, j.lines, j.zone ?? null]),
})
/** The values read in every view and at the poses: all equal to `want`. */
function everywhere(d: Core, want: ReturnType<typeof strokes>) {
  for (const k of d.views()) expect([k, strokes(d.in(k).snapshot())]).toEqual([k, want])
  for (const p of POSES) expect([p, strokes(d.atPose(p).snapshot())]).toEqual([p, want])
}

describe('one value for every view and pose', () => {
  it('each of the four, set in the side view: the nine views and the poses read it; one undo step restores all', () => {
    const d = corner(), before = save(d), was = strokes(d.snapshot())
    d.editIn(SIDE, e => {
      e.pointWidth('a', 3)
      e.lineStroke('bc', { width: 2, widthB: 5, profile: 'taper' })
      e.endStroke('c', { taper: 4 })
      e.zone('b', 'ab', 'bc', 7)
    })
    const now = strokes(d.in(SIDE).snapshot())
    expect(now).toEqual({
      points: [['a', 3, null], ['b', 2, null], ['c', 5, { taper: 4 }]],
      lines: [['ab', { width: 3, widthB: 2, profile: 'uniform' }], ['bc', { width: 2, widthB: 5, profile: 'taper' }]],
      zones: [['b', ['ab', 'bc'], 7]],
    })
    everywhere(d, now)
    d.undo()
    expect(save(d)).toBe(before)
    everywhere(d, was)
  })

  it('a line\'s widths from view 0,45: its two points change everywhere, and so does the other line at the shared point', () => {
    const d = corner()
    d.editIn(UP, e => e.lineStroke('ab', { width: 4, widthB: 6, profile: 'uniform' }))
    for (const k of d.views()) {
      const s = d.in(k).snapshot()
      expect([k, s.lines.find(l => l.id === 'ab')!.stroke, s.lines.find(l => l.id === 'bc')!.stroke]).toEqual([k, { width: 4, widthB: 6, profile: 'uniform' }, { width: 6, widthB: 1, profile: 'uniform' }])
    }
  })

  it('automatic and manual zones from any view: null in the up view makes it automatic everywhere', () => {
    const d = corner()
    d.editIn(SIDE, e => e.zone('b', 'ab', 'bc', 7))
    d.editIn(UP, e => e.zone('b', 'ab', 'bc', null))
    everywhere(d, strokes(d.snapshot()))
    expect(d.snapshot().joins[0]!.zone).toBeUndefined()
  })

  it('a locked line: a width at its point is refused from any view, and nothing is written', () => {
    const d = corner()
    d.edit(e => e.lineState('ab', { locked: true }))
    const before = save(d)
    expect(() => d.editIn(SIDE, e => e.pointWidth('b', 9))).toThrow(/Locked lines would change \(ab\)/)
    expect(save(d)).toBe(before)
  })
})

describe('an edit of strokes alone settles nothing (dot, after 5a2a6c2)', () => {
  /** Two mirror-linked lines; in the side view a is moved onto an unrelated line's end drawn later at the front: a legal coincidence there. */
  function mirroredWithCoincidence() {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('l', { id: 'a', layer: 'L', position: P(-20) }, { id: 'b', layer: 'L', position: P(-10, 5) })
      e.line('r', { id: 's', layer: 'L', position: P(20) }, { id: 't', layer: 'L', position: P(10, 5) })
    })
    const g = (id: string) => d.snapshot().groups.find(x => x.lines.includes(id))!.id
    d.edit(e => e.mirrorLink([g('l')], [g('r')]))
    d.editIn(SIDE, e => e.move([{ id: 'a', target: P(-70, 40) }]))
    d.edit(e => e.line('x', { id: 'x0', layer: 'L', position: P(-70, 40) }, { id: 'x1', layer: 'L', position: P(-90, 60) }))
    return d
  }
  const at = (d: Core, k: string, id: string) => d.in(k).snapshot().points.find(p => p.id === id)!.position

  it('each of the five calls in the side view: written for both mirror sides, no bind of the coincident points', () => {
    type E = Parameters<Parameters<Core['edit']>[0]>[0]
    const calls: [string, (d: Core) => (e: E) => unknown][] = [
      ['pointWidth', () => e => e.pointWidth('a', 4)],
      ['lineStroke', () => e => e.lineStroke('l', { width: 4, profile: 'uniform' })],
      ['stroke', d => { const g = d.snapshot().groups.find(x => x.lines.includes('l'))!.id; return e => e.stroke(g, { width: 4, profile: 'uniform' }) }],
      ['endStroke', () => e => e.endStroke('a', { taper: 5 })],
    ]
    for (const [name, fn] of calls) {
      const d = mirroredWithCoincidence()
      expect(at(d, SIDE, 'a')).toEqual(at(d, SIDE, 'x0')) // the coincidence, not bound
      d.editIn(SIDE, fn(d))
      const s = d.in(FRONT).snapshot(), pa = s.points.find(p => p.id === 'a')!, ps = s.points.find(p => p.id === 's')!
      expect([name, pa.width, ps.width, pa.endStroke ?? null, ps.endStroke ?? null]).toEqual(name === 'endStroke' ? [name, 1, 1, { taper: 5 }, { taper: 5 }] : [name, 4, 4, null, null])
      expect([name, d.in(SIDE).snapshot().points.map(p => p.id).sort()]).toEqual([name, ['a', 'b', 's', 't', 'x0', 'x1']])
    }
    // the zone, on a join at a mirror-linked point (the new line l2 has no mirror partner, so its join is this side's only)
    const d = mirroredWithCoincidence()
    d.edit(e => e.line('l2', 'b', { id: 'c', layer: 'L', position: P(-5, 20) }))
    d.edit(e => e.join('b', 'l', 'l2', { mode: 'smooth' }))
    d.editIn(SIDE, e => e.zone('b', 'l', 'l2', 6))
    expect(d.snapshot().joins.filter(j => j.zone === 6).map(j => j.point)).toEqual(['b'])
    expect(d.in(SIDE).snapshot().points.map(p => p.id)).toContain('x0')
  })

  it('a stroke together with a move still settles fully (the move\'s bind applies); a locked line still refuses its width', () => {
    const d = mirroredWithCoincidence()
    d.edit(e => e.lineState('x', { locked: true }))
    const before = save(d)
    expect(() => d.editIn(SIDE, e => e.pointWidth('x0', 3))).toThrow(/Locked lines would change \(x\)/)
    expect(save(d)).toBe(before)
    // geometry in the same edit: the full flow as before (a side-view bind of a mirror-linked point is refused there)
    expect(() => d.editIn(SIDE, e => { e.pointWidth('a', 4); e.move([{ id: 'b', target: P(-12, 7) }]) })).toThrow(/mirror-front-only/)
    expect(save(d)).toBe(before)
  })
})

describe('structure carries the one value', () => {
  it('split in the side view: the new point\'s width is linear in arc length measured on the side view\'s curve, one width for every view', () => {
    const d = corner()
    d.edit(e => e.lineStroke('bc', { width: 2, widthB: 8, profile: 'uniform' }))
    // a curved side: handles that bend bc there only, so the arc-length ratio at t differs from the front's
    d.editIn(SIDE, e => { e.moveHandle('bc', 'a', P(20, 0)); e.moveHandle('bc', 'b', P(0, -2)) })
    const curveIn = (k: string) => { const s = d.in(k).snapshot(), l = s.lines.find(x => x.id === 'bc')!, at = (id: string) => s.points.find(p => p.id === id)!.position; const a = at(l.a), b = at(l.b); return [a, { x: a.x + l.ha.x, y: a.y + l.ha.y }, { x: b.x + l.hb.x, y: b.y + l.hb.y }, b] }
    const len = (c: Vec[], t0: number, t1: number) => {
      let L = 0, prev: Vec | undefined
      for (let i = 0; i <= 4096; i++) {
        const t = t0 + (t1 - t0) * i / 4096, u = 1 - t
        const p = { x: u * u * u * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t * t * t * c[3]!.x, y: u * u * u * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t * t * t * c[3]!.y }
        if (prev) L += Math.hypot(p.x - prev.x, p.y - prev.y)
        prev = p
      }
      return L
    }
    const side = curveIn(SIDE), front = curveIn(FRONT), f = (c: Vec[]) => len(c, 0, 0.5) / len(c, 0, 1)
    expect(Math.abs(f(side) - f(front))).toBeGreaterThan(0.05)
    d.editIn(SIDE, e => e.split('bc', 0.5, 'm', 'b1', 'b2'))
    for (const k of d.views()) expect(d.in(k).snapshot().points.find(p => p.id === 'm')!.width).toBeCloseTo(2 + 6 * f(side), 3)
  })

  it('copy / paste carries the four values, the same in every view', () => {
    const d = corner()
    d.editIn(SIDE, e => { e.pointWidth('a', 3); e.lineStroke('bc', { width: 2, widthB: 5, profile: 'taper' }); e.endStroke('c', { taper: 4 }); e.zone('b', 'ab', 'bc', 7) })
    const clip = d.in(SIDE).copy(['ab', 'bc'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'p'))
    const pasted = (k: string) => {
      const s = d.in(k).snapshot()
      return { points: s.points.filter(p => p.id.startsWith('p/')).map(p => [p.id, p.width, p.endStroke ?? null]), lines: s.lines.filter(l => l.id.startsWith('p/')).map(l => [l.id, l.stroke]), zones: s.joins.filter(j => j.point.startsWith('p/')).map(j => j.zone) }
    }
    for (const k of d.views()) expect([k, pasted(k)]).toEqual([k, {
      points: [['p/a', 3, null], ['p/b', 2, null], ['p/c', 5, { taper: 4 }]],
      lines: [['p/ab', { width: 3, widthB: 2, profile: 'uniform' }], ['p/bc', { width: 2, widthB: 5, profile: 'taper' }]],
      zones: [7],
    }])
  })

  it('mirror apply from the front: the target takes the source\'s widths, profile and end stroke in every view', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('s', { id: 'a', layer: 'L', position: P(-20) }, { id: 'b', layer: 'L', position: P(-10, 5) })
      e.line('t', { id: 'c', layer: 'L', position: P(20) }, { id: 'e', layer: 'L', position: P(10, 5) })
    })
    d.editIn(SIDE, e => { e.lineStroke('s', { width: 2, widthB: 6, profile: 'taper' }); e.endStroke('a', { taper: 5 }) })
    d.edit(e => e.mirrorApply(['s'], ['t']))
    for (const k of d.views()) {
      const s = d.in(k).snapshot()
      expect([k, s.lines.find(l => l.id === 't')!.stroke, s.points.find(p => p.id === 'c')!.endStroke]).toEqual([k, { width: 2, widthB: 6, profile: 'taper' }, { taper: 5 }])
    }
  })
})

describe('a version 13 file (bowen: 旧稿按照0，0 的为准)', () => {
  type Layer = { key: string; widths: Record<string, number>; lines: Record<string, { stroke: { profile: string } }>; zone: Record<string, number>; end: Record<string, Record<string, unknown>> }
  type V13 = { version: number; document: { network: { shapes: { layers: Layer[] } } } }
  const asV13 = (d: Core): V13 => { const f = strokesPerView(JSON.parse(save(d))) as V13; f.version = 13; return f }
  const layer = (f: V13, k: string) => f.document.network.shapes.layers.find(L => L.key === k)!
  /** A drawing with values at the front: a, b, c widths 2 / 3 / 1; bc taper profile; a's end stroke; zone 3. */
  const drawn = () => {
    const d = corner()
    d.edit(e => { e.pointWidth('a', 2); e.lineStroke('bc', { width: 3, widthB: 1, profile: 'taper' }); e.endStroke('a', { taper: 2 }); e.zone('b', 'ab', 'bc', 3) })
    return d
  }

  it('views that agree: opens as the same drawing', () => {
    const d = drawn()
    expect(save(open(JSON.stringify(asV13(d))))).toBe(save(d))
  })

  it('views that disagree: every view and pose takes the front\'s values; values set only in a side view are dropped', () => {
    const d = drawn(), f = asV13(d), side = layer(f, SIDE), up = layer(f, UP)
    side.widths.a = 5; side.lines.bc!.stroke = { profile: 'uniform' }; side.zone[KEY] = 7; side.end.a = { taper: 4 }
    side.end.c = { taper: 9 } // side only
    delete layer(f, FRONT).zone[KEY]; up.zone[KEY] = 11 // the front automatic, the up view manual: automatic everywhere
    const o = open(JSON.stringify(f))
    expect(JSON.parse(save(o)).version).toBe(14)
    const want = {
      points: [['a', 2, { taper: 2 }], ['b', 3, null], ['c', 1, null]],
      lines: [['ab', { width: 2, widthB: 3, profile: 'uniform' }], ['bc', { width: 3, widthB: 1, profile: 'taper' }]],
      zones: [['b', ['ab', 'bc'] as [string, string], null]],
    }
    everywhere(o, want)
  })

  it('invalid data in a side layer, or a missing front, refuses the file; nothing is filled in', () => {
    const bad = (f: (x: V13) => void) => { const x = asV13(drawn()); f(x); return () => open(JSON.stringify(x)) }
    expect(bad(x => { layer(x, SIDE).widths.a = -1 })).toThrow(/open-failed: point a has a width that is not a finite number above zero in view:90,0/)
    expect(bad(x => { delete layer(x, SIDE).widths.b })).toThrow(/view:90,0 has no width for point b/)
    expect(bad(x => { layer(x, SIDE).widths.ghost = 1 })).toThrow(/widths for points that do not exist/)
    expect(bad(x => { (layer(x, SIDE).lines.ab!.stroke as Record<string, unknown>).width = 2 })).toThrow(/holds more than its profile/)
    expect(bad(x => { layer(x, SIDE).zone[KEY] = 0 })).toThrow(/zone .* in view:90,0 is not a finite number above zero/)
    expect(bad(x => { layer(x, SIDE).zone['["c","ab","bc"]'] = 2 })).toThrow(/belongs to no join/)
    expect(bad(x => { layer(x, SIDE).end.ghost = { taper: 1 } })).toThrow(/end stroke in view:90,0 is on a missing point ghost/)
    expect(bad(x => { layer(x, SIDE).end.c = { taper: -1 } })).toThrow(/end stroke c in view:90,0: .*0 or more/)
    expect(bad(x => { layer(x, 'base:angle').widths.a = 0 })).toThrow(/point a has a width that is not a finite number above zero in base:angle/)
    expect(bad(x => { layer(x, FRONT).key = 'view:9,9' })).toThrow(/no front view/)
    // values a version 13 file could not hold are not taken over the front's
    expect(bad(x => { (x.document as unknown as { network: { points: Record<string, unknown>[] } }).network.points[0]!.width = 7 })).toThrow(/carries an extra value/)
  })
})
