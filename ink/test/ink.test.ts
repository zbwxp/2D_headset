// ink P1 (docs/ink-p1-checklist.md §7): the construction against the analytic stroke, the flattening bound, the output
// checks (planted defects must be caught), the vertex band (a planted outlier must be caught), zero-length lines, a
// tight curve, hidden lines, and that building ink writes nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { union, FillRule } from 'clipper2-ts'
import { Core, type Vec } from '../../src'
import { sk } from '../../test/sketch'
import { band, build, createInkCache, cuspTip, flatten, lineInk, outputDefect, segmentDistance, vertexBand, type Cubic } from '..'

const P = (x: number, y = 0): Vec => ({ x, y })
const line = (a: Vec, b: Vec): Cubic => [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + 2 * (b.x - a.x) / 3, y: a.y + 2 * (b.y - a.y) / 3 }, b]
const bez = (c: Cubic, t: number): Vec => { const u = 1 - t; return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y } }
const area = (l: readonly Vec[]) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]!; return s + p.x * q.y - q.x * p.y }, 0) / 2
const polylineDistance = (p: Vec, poly: readonly Vec[]) => Math.min(...poly.slice(1).map((q, i) => segmentDistance(p, poly[i]!, q)))

describe('ink — one line', () => {
  it('a straight line is the stroke: area L·2h + πh², every vertex on the edge, status unproven (the arc tolerance is a configuration)', () => {
    const r = lineInk('l', line(P(0), P(100)), 4)
    expect(r.piece).toBeDefined()
    const loops = r.piece!.loops
    expect(loops.length).toBe(1)
    expect(Math.abs(Math.abs(area(loops[0]!)) - (100 * 4 + Math.PI * 4))).toBeLessThan(0.5)
    expect(r.diagnostic.status).toBe('unproven')
    expect(r.diagnostic.evidence!.checks).toEqual({ simple: true, band: true, area: true })
  })
  it('a curved line: every output vertex within ε of the stroke edge', () => {
    const c: Cubic = [P(0), P(30, 40), P(70, -40), P(100)]
    const r = lineInk('c', c, 6)
    expect(r.piece).toBeDefined()
    expect(r.diagnostic.evidence!.bandError).toBeLessThanOrEqual(r.diagnostic.evidence!.epsilon)
  })
  it('a zero-length line is a disc of radius h, built by us, and verified', () => {
    const r = lineInk('z', [P(5, 5), P(5, 5), P(5, 5), P(5, 5)], 4)
    expect(r.diagnostic.status).toBe('verified')
    // an inscribed polygon: every vertex on the circle, and the area short by at most the perimeter × the sag tolerance
    const l = r.piece!.loops[0]!, eps = r.diagnostic.evidence!.epsilon
    for (const v of l) expect(Math.abs(Math.hypot(v.x - 5, v.y - 5) - 2)).toBeLessThanOrEqual(eps)
    expect(Math.PI * 4 - Math.abs(area(l))).toBeLessThanOrEqual(2 * Math.PI * 2 * eps)
  })
  it('a tight curve (radius of curvature below h) is drawn — a flagged defect stays drawn with its reason, never hidden', () => {
    const c: Cubic = [P(0), P(10, 0), P(10, 3), P(0, 3)]
    const r = lineInk('t', c, 8)
    expect(r.piece).toBeDefined()
    expect(['unproven', 'verified', 'defect']).toContain(r.diagnostic.status)
    if (r.diagnostic.status === 'defect') expect(r.diagnostic.reason).toBeTruthy()
    else expect(r.diagnostic.evidence!.checks.area).toBe('n/a')
  })
})

describe('flattening — the bound holds against a dense measurement', () => {
  for (const [name, c] of [
    ['an S-curve', [P(0), P(40, 60), P(60, -60), P(100)]],
    ['a cubic folding back along its chord (collinear)', [P(0), P(30), P(30), P(10)]],
    ['a loop', [P(0), P(100, 80), P(-100, 80), P(10)]],
  ] as [string, Cubic][]) {
    it(name, () => {
      const tol = 0.01, f = flatten(c, tol)
      let worst = 0
      for (let i = 0; i <= 2000; i++) worst = Math.max(worst, polylineDistance(bez(c, i / 2000), f.points))
      expect(f.floorHit).toBe(false)
      expect(worst).toBeLessThanOrEqual(tol + 1e-12)
    })
  }
  it('the folding-back cubic is not flattened to its chord (the segment, not the infinite line, is measured)', () => {
    const c: Cubic = [P(0), P(30), P(30), P(10)], f = flatten(c, 0.01)
    expect(Math.max(...f.points.map(p => p.x))).toBeGreaterThan(19) // the curve reaches x = 20.0 before turning back
  })
})

describe('the output checks catch planted defects', () => {
  const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]
  it('a simple square passes', () => expect(outputDefect([sq(0, 0, 10)])).toBeNull())
  it('a bow-tie (non-adjacent edges cross) is caught', () => expect(outputDefect([[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]])).toMatch(/not simple/))
  it('a vertex visited twice in one loop is caught', () => expect(outputDefect([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }, { x: 0, y: 10 }, { x: 5, y: 5 }]])).toBeTruthy())
  it('an edge folding back onto the next (a zero-width bridge) is caught', () => expect(outputDefect([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }]])).toBeTruthy())
  it('two loops touching at one vertex are allowed (a point contact)', () => expect(outputDefect([sq(0, 0, 10), sq(10, 10, 10)])).toBeNull())
  it('two loops sharing an edge stretch are caught', () => expect(outputDefect([sq(0, 0, 10), sq(10, 2, 5)])).toMatch(/cross or overlap/))
  it('crossing loops are caught', () => expect(outputDefect([sq(0, 0, 10), sq(5, 5, 10)])).toMatch(/cross or overlap/))
  it('exact on large coordinates (products beyond 2^53)', () => {
    const big = 2 ** 40
    expect(outputDefect([[{ x: 0, y: 0 }, { x: big, y: 1 }, { x: big, y: big }, { x: 0, y: big }]])).toBeNull()
  })
})

describe('the vertex band catches a planted outlier', () => {
  it('a vertex moved off the edge by 2ε fails', () => {
    const c = line(P(0), P(100)), r = lineInk('l', c, 4), eps = r.diagnostic.evidence!.epsilon
    const loops = r.piece!.loops.map(l => l.map(v => ({ ...v })))
    expect(vertexBand(loops, c, c[0], 2, eps)).toBeLessThanOrEqual(eps)
    loops[0]![3] = { x: loops[0]![3]!.x, y: loops[0]![3]!.y + 2 * eps * Math.sign(loops[0]![3]!.y || 1) }
    expect(vertexBand(loops, c, c[0], 2, eps)).toBeGreaterThan(eps)
  })
})

describe('the vertex band costs the line\'s length, not its bounding box (dot 1791802464)', () => {
  it('a width-1 line at 45°, spans 100 / 200 / 300: checked in full, time growing with the length', () => {
    const ms: number[] = []
    for (const span of [100, 200, 300]) {
      const t0 = performance.now(), r = lineInk('d', line(P(0), P(span, span)), 1)
      ms.push(performance.now() - t0)
      expect(r.diagnostic.evidence!.checks.band).toBe(true)
    }
    expect(ms[2]!).toBeLessThan(50) // was ≈ 164 ms for the band check alone at span 300
  })
  it('past its work limit the check stops — "diagnosis incomplete" — and returns no number', () => {
    const c = line(P(0), P(300, 300)), r = lineInk('d', c, 1)
    expect(vertexBand(r.piece!.loops, c, c[0], 0.5, r.diagnostic.evidence!.epsilon, 10)).toBeNull()
  })
})

describe('build — over a document', () => {
  const doc = () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(50)); sk(e).point('c', 'L', P(50, 40))
      sk(e).line('ab', 'a', 'b'); sk(e).line('bc', 'b', 'c')
    })
    return d
  }
  it('every visible line gets a piece and a diagnostic; snapshot and geometry are untouched', () => {
    const d = doc(), before = JSON.stringify([d.snapshot(), d.geometry()])
    const ink = build(d.geometry(), d.snapshot())
    expect(ink.pieces.map(p => p.source.id).sort()).toEqual(['ab', 'bc'])
    expect(ink.diagnostics.length).toBe(2)
    expect(JSON.stringify([d.snapshot(), d.geometry()])).toBe(before)
  })
  it('a hidden line has no ink (its decoration is drawn from the centre line)', () => {
    const d = doc()
    d.edit(e => e.lineState('bc', { visible: false }))
    const ink = build(d.geometry(), d.snapshot())
    expect(ink.pieces.map(p => p.source.id)).toEqual(['ab'])
  })
})

describe('arc joins — the arc inked at its lines\' width, the lines and the arc one outline (dot 1791802438)', () => {
  const doc = () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(50)); sk(e).point('c', 'L', P(50, 40))
      sk(e).line('ab', 'a', 'b'); sk(e).line('bc', 'b', 'c')
      e.lineStroke('ab', { width: 4, profile: 'uniform' } as never); e.lineStroke('bc', { width: 4, profile: 'uniform' } as never)
      e.join('b', 'ab', 'bc', { mode: 'arc', radius: 10 })
    })
    return d
  }
  it('equal widths: an arc piece at that width, and one group whose union is one loop — the swept region of the whole turn', () => {
    const d = doc(), before = JSON.stringify([d.snapshot(), d.geometry()])
    const ink = build(d.geometry(), d.snapshot())
    const arc = ink.pieces.find(p => p.source.kind === 'arc')!
    expect(arc.source).toMatchObject({ lines: ['ab', 'bc'] })
    expect(ink.groups.length).toBe(1)
    const gr = ink.groups[0]!
    expect(gr.pieces.length).toBe(3)
    expect(gr.status).toBe('unproven')
    expect(gr.loops.length).toBe(1)
    // the turn's centre line has length L = 40 + 30 + 10·π/2; its sweep (no fold: radius 10 > h 2) is L·2h + πh², within
    // the outline's perimeter × ε (ε = 1 % of the width)
    const L = 40 + 30 + 10 * Math.PI / 2
    expect(Math.abs(Math.abs(area(gr.loops[0]!)) - (L * 4 + Math.PI * 4))).toBeLessThan((2 * L + 4 * Math.PI) * 0.04)
    expect(JSON.stringify([d.snapshot(), d.geometry()])).toBe(before)
  })
  it('the arc follows a changed radius and width; the unchanged pieces are reused', () => {
    const d = doc(), cache = createInkCache(), first = cache.build(d.geometry(), d.snapshot())
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 20 }))
    const r20 = cache.build(d.geometry(), d.snapshot())
    expect(r20.groups[0]!.loops).not.toEqual(first.groups[0]!.loops)
    d.edit(e => { e.lineStroke('ab', { width: 8, profile: 'uniform' } as never); e.lineStroke('bc', { width: 8, profile: 'uniform' } as never) })
    const w8 = cache.build(d.geometry(), d.snapshot()), L = 30 + 20 + 20 * Math.PI / 2
    expect(Math.abs(Math.abs(area(w8.groups[0]!.loops[0]!)) - (L * 8 + Math.PI * 16))).toBeLessThan((2 * L + 8 * Math.PI) * 0.08)
    const again = cache.build(d.geometry(), d.snapshot())
    expect(again.groups[0]).toBe(w8.groups[0])
  })
  it('unequal widths: the width eases along the arc — one loop, each end as wide as its line, the band within ε', () => {
    const d = doc()
    d.edit(e => e.lineStroke('bc', { width: 8, profile: 'uniform' } as never))
    const g = d.geometry(), ink = build(g, d.snapshot()), arc = ink.pieces.find(p => p.source.kind === 'arc')!
    const dg = ink.diagnostics.find(x => x.source.kind === 'arc')!
    expect(dg.status).toBe('unproven')
    expect(dg.evidence!.checks).toMatchObject({ simple: true, band: true })
    expect(ink.groups[0]!.loops.length).toBe(1)
    // across the arc's ends, normal to its direction: the ink is 4 wide at the start (ab) and 8 wide at the end (bc)
    const c = g.arcs[0]!.curve, across = (p: Vec, t: Vec) => {
      const n = { x: -t.y / Math.hypot(t.x, t.y), y: t.x / Math.hypot(t.x, t.y) }
      const off = arc.loops[0]!.map(v => (v.x - p.x) * n.x + (v.y - p.y) * n.y).filter((_, i) => Math.abs((arc.loops[0]![i]!.x - p.x) * n.y - (arc.loops[0]![i]!.y - p.y) * n.x) < 0.3)
      return Math.max(...off) - Math.min(...off)
    }
    expect(Math.abs(across(c[0], { x: c[1].x - c[0].x, y: c[1].y - c[0].y }) - 4)).toBeLessThan(0.2)
    expect(Math.abs(across(c[3], { x: c[3].x - c[2].x, y: c[3].y - c[2].y }) - 8)).toBeLessThan(0.2)
    // an everyday edit: a new width at one end → a new arc piece, the other line's piece reused
    const cache = createInkCache(), before = cache.build(d.geometry(), d.snapshot())
    d.edit(e => e.lineStroke('bc', { width: 6, profile: 'uniform' } as never))
    const after = cache.build(d.geometry(), d.snapshot()), of = (i: typeof after, k: string) => i.pieces.find(p => p.source.kind === k && (k === 'arc' || p.source.id === 'ab'))
    expect(of(after, 'arc')).not.toBe(of(before, 'arc'))
    expect(of(after, 'line')).toBe(of(before, 'line'))
  })
  it('the band against a tapered reference catches a vertex moved off by 2ε', () => {
    // one segment, radii 2 → 4 over length 50: the hull's edge is the tangent line, across = (2 + 25·0.04)/√(1 − 0.04²) at the middle
    const pts = [P(0), P(50)], radii = [2, 4], eps = 0.04, y = 3 / Math.sqrt(1 - 0.04 ** 2)
    expect(band([[P(25, y), P(25, -y), P(-2, 0), P(54, 0)]], pts, radii, eps)).toBeLessThanOrEqual(1e-9)
    expect(band([[P(25, y + 2 * eps)]], pts, radii, eps)).toBeGreaterThan(eps)
  })
  it('a hidden line leaves the arc and the other line; both hidden — no arc ink', () => {
    const d = doc()
    d.edit(e => e.lineState('bc', { visible: false }))
    expect(build(d.geometry(), d.snapshot()).pieces.map(p => p.source.kind).sort()).toEqual(['arc', 'line'])
    d.edit(e => e.lineState('ab', { visible: false }))
    expect(build(d.geometry(), d.snapshot()).pieces).toEqual([])
  })
})

describe('smooth joins — one outline; unequal widths ease to the average at the joint (Slack 1791804157, dot 1791804198)', () => {
  // the ink's vertical extent at x: where the loops' edges cross the vertical line x
  const section = (loops: readonly (readonly Vec[])[], x: number) => {
    const ys: number[] = []
    for (const l of loops) l.forEach((a, i) => { const b = l[(i + 1) % l.length]!; if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) ys.push(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)) })
    return Math.max(...ys) - Math.min(...ys)
  }
  /** Collinear lines along y = 0 through x = 0, 60, 120, 180, with the given widths, smooth joins between neighbours. */
  const chain = (widths: number[]) => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      widths.forEach((_, i) => sk(e).point('p' + i, 'L', P(60 * i))); sk(e).point('p' + widths.length, 'L', P(60 * widths.length))
      widths.forEach((w, i) => { sk(e).line('l' + i, 'p' + i, 'p' + (i + 1)); e.lineStroke('l' + i, { width: w, profile: 'uniform' } as never) })
      for (let i = 1; i < widths.length; i++) e.join('p' + i, 'l' + (i - 1), 'l' + i, { mode: 'smooth' })
    })
    return d
  }
  const of = (ink: ReturnType<typeof build>, id: string) => ink.pieces.find(p => p.source.id === id)!
  it('equal widths: the two lines are one group, one loop', () => {
    const ink = build(chain([4, 4]).geometry(), chain([4, 4]).snapshot())
    expect(ink.groups.length).toBe(1)
    expect(ink.groups[0]!.loops.length).toBe(1)
  })
  it('4 and 8: both 6 wide at the joint, one S-curve centred there — 4 + 4·σ(¼) = 4.625 at s = λ/2 on the narrow side (bowen 1791817874), back to 4 and 8 beyond λ (λ = min(24, 20, 20) = 20)', () => {
    const d = chain([4, 8]), ink = build(d.geometry(), d.snapshot())
    expect(ink.diagnostics.every(x => x.status === 'unproven')).toBe(true)
    expect(section(of(ink, 'l0').loops, 60)).toBeCloseTo(6, 1)
    expect(section(of(ink, 'l1').loops, 60)).toBeCloseTo(6, 1)
    expect(section(of(ink, 'l0').loops, 50)).toBeCloseTo(4.625, 1)
    // the joint is the steepest point, the same slope from both lines (no flat step there): widths just either side
    expect(section(of(ink, 'l1').loops, 61) - 6).toBeCloseTo(6 - section(of(ink, 'l0').loops, 59), 1)
    expect(section(of(ink, 'l1').loops, 61) - 6).toBeGreaterThan(0.1) // ≈ 0.15 (slope 2 · 1.5 · 1 / 20); the old flat meeting gave ≈ 0.015
    expect(section(of(ink, 'l0').loops, 30)).toBeCloseTo(4, 1)
    expect(section(of(ink, 'l1').loops, 90)).toBeCloseTo(8, 1)
    expect(ink.groups[0]!.loops.length).toBe(1)
  })
  it('a chain 4 – 8 – 4: the middle line eases at both ends and is back to 8 in its middle', () => {
    const d = chain([4, 8, 4]), ink = build(d.geometry(), d.snapshot()), mid = of(ink, 'l1').loops
    expect(section(mid, 60)).toBeCloseTo(6, 1)
    expect(section(mid, 90)).toBeCloseTo(8, 1)
    expect(section(mid, 120)).toBeCloseTo(6, 1)
    expect(ink.groups.length).toBe(1)
  })
  it('a neighbour\'s new width or visibility rebuilds this line\'s ink (the easing rule is in its cache key)', () => {
    const d = chain([4, 8]), cache = createInkCache(), first = cache.build(d.geometry(), d.snapshot())
    d.edit(e => e.lineStroke('l1', { width: 6, profile: 'uniform' } as never))
    const wider = cache.build(d.geometry(), d.snapshot())
    expect(of(wider, 'l0')).not.toBe(of(first, 'l0'))
    expect(section(of(wider, 'l0').loops, 60)).toBeCloseTo(5, 1)
    d.edit(e => e.lineState('l1', { visible: false }))
    const hidden = cache.build(d.geometry(), d.snapshot())
    expect(section(of(hidden, 'l0').loops, 59)).toBeCloseTo(4, 1)
  })
  it('a smooth join and an arc join on one line: one group', () => {
    const d = chain([4, 4, 4])
    d.edit(e => { e.removeJoin('p2', 'l1', 'l2'); e.move([{ id: 'p3', target: P(120, 60) }]); e.join('p2', 'l1', 'l2', { mode: 'arc', radius: 10 }) })
    const ink = build(d.geometry(), d.snapshot())
    expect(ink.groups.length).toBe(1)
    expect(ink.groups[0]!.pieces.map(p => p.source.kind).sort()).toEqual(['arc', 'line', 'line', 'line'])
  })
})

describe('two end widths (bowen 1791818995): a line tapers linearly from its a-end width to its b-end width', () => {
  const across = (loops: readonly (readonly Vec[])[], x: number) => { const ys = loops.flatMap(l => l.flatMap((a, i) => { const b = l[(i + 1) % l.length]!; return (a.x - x) * (b.x - x) <= 0 && a.x !== b.x ? [a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)] : [] })); return Math.max(...ys) - Math.min(...ys) }
  it('one line 4 → 1: the width linear along it, round free ends of the two radii', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(60)); sk(e).line('l', 'a', 'b'); e.lineStroke('l', { width: 4, widthB: 1, profile: 'uniform' } as never) })
    const ink = build(d.geometry(), d.snapshot()), l = ink.pieces.find(p => p.source.id === 'l')!
    for (const x of [6, 30, 54]) expect(across(l.loops, x)).toBeCloseTo(4 - 3 * x / 60, 1)
    expect(Math.min(...l.loops.flat().map(v => v.x))).toBeCloseTo(-2, 1)
    expect(Math.max(...l.loops.flat().map(v => v.x))).toBeCloseTo(60.5, 1)
    expect(ink.diagnostics.every(x => x.status === 'unproven')).toBe(true)
  })
  it('a joint\'s easing returns to the line\'s own taper at the zone\'s exit (dot 1791819133): l0 4 → 1 meets l1 at 3', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('a', 'L', P(0)); sk(e).point('p', 'L', P(30)); sk(e).point('c', 'L', P(60))
      sk(e).line('l0', 'a', 'p'); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' } as never); e.lineStroke('l1', { width: 3, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'bound' })
    })
    const l0 = build(d.geometry(), d.snapshot()).pieces.find(p => p.source.id === 'l0')!
    // no zones given: λ = min(3 × 3, 30 / 3) = 9; beyond it the taper itself, at the joint the average 2
    expect(across(l0.loops, 20)).toBeCloseTo(4 - 3 * 20 / 30, 1)
    expect(across(l0.loops, 29.9)).toBeCloseTo(2, 1)
  })
  it('an arc with one side hidden takes the visible line\'s width at the arc\'s own point (dot 1791819678)', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('a', 'L', P(0)); sk(e).point('p', 'L', P(30)); sk(e).point('c', 'L', P(30, 30))
      sk(e).line('l0', 'a', 'p'); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: 2, widthB: 8, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'arc', radius: 5 })
    })
    d.edit(e => e.lineState('l1', { visible: false }))
    const arc = build(d.geometry(), d.snapshot()).pieces.find(p => p.source.kind === 'arc')!
    // the arc is drawn at l0's width at p (8), not at its far end (2)
    const xs = arc.loops.flat(), ys = xs.map(v => v.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(7)
  })
  it('a bound chain whose widths match at the joint (2 → 4, 4 → 1) is one stroke, no easing at the joint', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); sk(e).point('a', 'L', P(0)); sk(e).point('p', 'L', P(30)); sk(e).point('c', 'L', P(60))
      sk(e).line('l0', 'a', 'p'); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: 2, widthB: 4, profile: 'uniform' } as never); e.lineStroke('l1', { width: 4, widthB: 1, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'bound' })
    })
    const ink = build(d.geometry(), d.snapshot()), g = ink.groups[0]!
    expect(ink.groups.length).toBe(1)
    expect(g.loops.length).toBe(1)
    for (const [x, w] of [[15, 3], [29, 4 - 2 / 30], [31, 4 - 3 / 30], [45, 2.5]] as const) expect(across(g.loops, x)).toBeCloseTo(w, 1)
  })
})

describe('sharp (cusp) joins — the lines\' ink plus v103\'s tip (Slack 1791804643, dot 1791804679)', () => {
  /** Two lines meeting at p = (0, 0): l0 from (−50, 0) into p, l1 from p out at the interior angle θ (degrees). */
  const corner = (theta: number, w0: number, w1: number) => {
    const d = new Core(), t = theta * Math.PI / 180
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(-50)); sk(e).point('p', 'L', P(0)); sk(e).point('c', 'L', P(-50 * Math.cos(t), 50 * Math.sin(t)))
      sk(e).line('l0', 'a', 'p'); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: w0, profile: 'uniform' } as never); e.lineStroke('l1', { width: w1, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'cusp' })
    })
    return build(d.geometry(), d.snapshot())
  }
  const far = (loops: readonly (readonly Vec[])[]) => Math.max(...loops.flat().map(v => Math.hypot(v.x, v.y)))
  it('equal widths at 60°: one outline, the tip as long as v103\'s miter, h / sin(θ/2) = 4', () => {
    const ink = corner(60, 4, 4), tip = ink.pieces.find(p => p.source.kind === 'tip')!
    expect(far(tip.loops)).toBeCloseTo(4, 2) // within the grid's rounding (≤ ε/8)
    expect(ink.groups.length).toBe(1)
    expect(ink.groups[0]!.loops.length).toBe(1)
    expect(ink.diagnostics.every(x => x.status === 'unproven')).toBe(true)
  })
  it('the tip below 30° (bowen 1791817399 / 1791818040): 30° natural (h / sin 15°); 20°, 5°, 1° at most (h0 + h1) · (3 − smoothstep(θ / 30°)), growing to 3 × the width', () => {
    // the apex: the farthest point along the outer bisector (l0 arrives along +x, l1 leaves along (−cos θ, sin θ))
    const tipAt = (theta: number) => {
      const t = theta * Math.PI / 180, m = { x: 1 + Math.cos(t), y: -Math.sin(t) }, ml = Math.hypot(m.x, m.y)
      return Math.max(...corner(theta, 4, 4).pieces.find(p => p.source.kind === 'tip')!.loops.flat().map(v => (v.x * m.x + v.y * m.y) / ml))
    }
    const ss = (u: number) => u * u * (3 - 2 * u)
    expect(tipAt(30)).toBeCloseTo(2 / Math.sin(15 * Math.PI / 180), 2) // ≈ 7.73 < 4 · (3 − 1)
    expect(tipAt(20)).toBeCloseTo(4 * (3 - ss(20 / 30)), 2) // natural ≈ 11.5, limited to ≈ 9.04
    expect(tipAt(5)).toBeCloseTo(4 * (3 - ss(5 / 30)), 2) // natural ≈ 45.9, limited to ≈ 11.7
    expect(tipAt(1)).toBeCloseTo(4 * (3 - ss(1 / 30)), 2) // → 12 at 0°
    for (const theta of [1, 3, 10]) { const g = corner(theta, 4, 4).groups[0]!; expect(g.loops.length).toBe(1); expect(g.status).toBe('unproven') } // no notch, no defect
  })
  it('unequal widths at a blunt corner (2 and 12 at 150°, O3: the forward extensions do not meet): eased to 7 at the joint, then the tip', () => {
    expect(cuspTip(P(0), P(1), { x: -Math.cos(150 * Math.PI / 180), y: Math.sin(150 * Math.PI / 180) }, 1, 6).kind).toBe('ease')
    const ink = corner(150, 2, 12), tip = ink.pieces.find(p => p.source.kind === 'tip')!
    expect(tip.loops.flat().filter(v => Math.abs(Math.hypot(v.x, v.y) - 3.5) < 1e-3).length).toBe(2) // A0 and A1 at h_p = 3.5
    expect(ink.groups[0]!.loops.length).toBe(1)
  })
  it('folding back (0°): the limit tip — a spike of 3 × the width ahead of p (bowen 1791818040; v103 pinched to 0)', () => {
    const ink = corner(0, 4, 4)
    expect(Math.max(...ink.groups[0]!.loops.flat().map(v => v.x))).toBeCloseTo(12, 2)
    expect(ink.groups[0]!.loops.length).toBe(1)
    expect(ink.diagnostics.every(x => x.status === 'unproven')).toBe(true)
  })
  // J3-min (docs/j3-min-cusp-flat-checklist.md, bowen 1791816534): a cusp end is drawn flat at p — no round cap beside the tip
  it('J3-min: 3 and 2 at 100° (the 125.json eye corner): both ends drawn flat at p, the free ends still round, one outline', () => {
    const ink = corner(100, 3, 2), l0 = ink.pieces.find(p => p.source.id === 'l0')!
    expect(Math.max(...l0.loops.flat().map(v => v.x))).toBeLessThanOrEqual(4 / l0.scale + 1e-9) // l0 arrives along +x: nothing of its cap (radius 1.5) past p but the 4-grid-unit overlap
    expect(Math.min(...l0.loops.flat().map(v => v.x))).toBeCloseTo(-51.5, 1) // its free end keeps the round cap
    expect(ink.groups.length).toBe(1)
    expect(ink.groups[0]!.loops.length).toBe(1)
    expect(ink.groups[0]!.status).toBe('unproven')
    expect(ink.diagnostics.every(x => x.status === 'unproven')).toBe(true)
  })
  it('J3-min: a line passing back beside its own flat end keeps its ink there (generated flat, nothing cut out — dot 1791816797)', () => {
    // l0 starts at (1, −20), runs up through (0.42, 0) — just beyond p along l0's arrival direction, inside the old cut
    // box — then hooks round and arrives at p = (0, 0) along +x; l1 leaves p at 100°
    const d = new Core(), t = 100 * Math.PI / 180
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(1, -20)); sk(e).point('p', 'L', P(0)); sk(e).point('c', 'L', P(-50 * Math.cos(t), 50 * Math.sin(t)))
      sk(e).line('l0', 'a', 'p', { ha: P(0, 60), hb: P(-10, 0) }); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: 3, profile: 'uniform' } as never); e.lineStroke('l1', { width: 2, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'cusp' })
    })
    const g = d.geometry(), c = g.lines.find(l => l.id === 'l0')!.curve, l0 = build(g, d.snapshot()).pieces.find(p => p.source.id === 'l0')!
    const inside = (v: Vec) => l0.loops.reduce((w, l) => w + l.reduce((k, a, i) => { const b = l[(i + 1) % l.length]!; return k + ((a.y <= v.y) !== (b.y <= v.y) && v.x < a.x + (v.y - a.y) * (b.x - a.x) / (b.y - a.y) ? 1 : 0) }, 0), 0) % 2 === 1
    const passing = Array.from({ length: 200 }, (_, i) => bez(c, i / 400)).filter(v => v.x > 0.2 && Math.abs(v.y) < 1.5)
    expect(passing.length).toBeGreaterThan(0)
    expect(passing.every(inside)).toBe(true)
  })
  it('bound joins blend unequal widths like smooth ones (bowen 1791817201): one outline, the average at p, over half the zone', () => {
    const d = new Core(), t = 100 * Math.PI / 180
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(-50)); sk(e).point('p', 'L', P(0)); sk(e).point('c', 'L', P(-50 * Math.cos(t), 50 * Math.sin(t)))
      sk(e).line('l0', 'a', 'p'); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: 4, profile: 'uniform' } as never); e.lineStroke('l1', { width: 2, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'bound' })
    })
    // l0's half-width across x = −s: the loops' edges crossing that vertical line
    const half = (loops: readonly (readonly Vec[])[], x: number) => { const ys = loops.flatMap(l => l.flatMap((a, i) => { const b = l[(i + 1) % l.length]!; return (a.x - x) * (b.x - x) <= 0 && a.x !== b.x ? [a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x)] : [] })); return (Math.max(...ys) - Math.min(...ys)) / 2 }
    const s = d.snapshot(), zones = d.in('view:0,0').zones()
    expect(zones[0]!.limited).toBeCloseTo(8, 6) // auto: 4² / 2
    const ink = build(d.geometry(), { ...s, zones }), l0 = ink.pieces.find(p => p.source.id === 'l0')!
    expect(ink.groups.length).toBe(1)
    expect(ink.groups[0]!.loops.length).toBe(1)
    expect(half(l0.loops, -0.02)).toBeCloseTo(1.5, 1) // the average of 2 and 1 at the joint
    expect(half(l0.loops, -4.5)).toBeCloseTo(2, 2) // full width beyond λ = 8 / 2
    // a manual zone of 2: λ = 1
    d.edit(e => e.zone('p', 'l0', 'l1', 2))
    const l0b = build(d.geometry(), { ...d.snapshot(), zones: d.in('view:0,0').zones() }).pieces.find(p => p.source.id === 'l0')!
    expect(half(l0b.loops, -1.2)).toBeCloseTo(2, 2)
  })
  it('J3-min: a smooth join is not cut (its round end stays, paused J2)', () => {
    const d = new Core(), t = 100 * Math.PI / 180
    d.edit(e => {
      e.layer('L')
      sk(e).point('a', 'L', P(-50)); sk(e).point('p', 'L', P(0)); sk(e).point('c', 'L', P(-50 * Math.cos(t), 50 * Math.sin(t)))
      sk(e).line('l0', 'a', 'p'); sk(e).line('l1', 'p', 'c')
      e.lineStroke('l0', { width: 3, profile: 'uniform' } as never); e.lineStroke('l1', { width: 3, profile: 'uniform' } as never)
      e.join('p', 'l0', 'l1', { mode: 'smooth' })
    })
    const l0 = build(d.geometry(), d.snapshot()).pieces.find(p => p.source.id === 'l0')!
    expect(Math.max(...l0.loops.flat().map(v => v.x))).toBeCloseTo(1.5, 1)
  })
  it('the known, unhandled I2b case (4 and 12 at 10°) is flagged on the tip, drawn all the same', () => {
    const ink = corner(10, 4, 12), d = ink.diagnostics.find(x => x.source.kind === 'tip')!
    expect(d.status).toBe('defect')
    expect(d.reason).toMatch(/I2b/)
    expect(ink.pieces.some(p => p.source.kind === 'tip')).toBe(true)
  })
})

describe('the upstream defects, reproduced on the pinned clipper2-ts, are caught by the output checks (dot 1791800973)', () => {
  const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/upstream-${n}.json`, import.meta.url), 'utf8'))
  it('Clipper2 #1085 (clipper2-ts #30): a union with a zero-width bridge', () => {
    const f = fx('1085'), out = union(f.subjects.map((s: number[][]) => s.map(([x, y]) => ({ x: x!, y: y! }))), FillRule.NonZero)
    expect(out.map(p => p.length)).toEqual([21]) // reproduced as reported
    expect(outputDefect(out)).toBeTruthy()
  })
  it('Clipper2 #1083 (clipper2-ts #29): a union whose output is not simple', () => {
    const f = fx('1083'), out = union([f.polygon.map(([x, y]: number[]) => ({ x: x!, y: y! }))], FillRule.EvenOdd)
    expect(out.length).toBe(4) // reproduced as reported
    expect(outputDefect(out)).toBeTruthy()
  })
})

describe('the cache rebuilds only what changed', () => {
  it('same input → the same pieces (no rebuild); a moved point → that line rebuilt, the other kept', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(50)); sk(e).point('c', 'L', P(50, 40)); sk(e).line('ab', 'a', 'b'); sk(e).line('bc', 'b', 'c') })
    const cache = createInkCache(), first = cache.build(d.geometry(), d.snapshot()), again = cache.build(d.geometry(), d.snapshot())
    expect(again.pieces[0]).toBe(first.pieces[0])
    d.edit(e => e.move([{ id: 'c', target: P(60, 40) }]))
    const moved = cache.build(d.geometry(), d.snapshot())
    expect(moved.pieces.find(p => p.source.id === 'ab')).toBe(first.pieces.find(p => p.source.id === 'ab'))
    expect(moved.pieces.find(p => p.source.id === 'bc')).not.toBe(first.pieces.find(p => p.source.id === 'bc'))
  })
})
