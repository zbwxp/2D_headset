// ink P1 (docs/ink-p1-checklist.md §7): the construction against the analytic stroke, the flattening bound, the output
// checks (planted defects must be caught), the vertex band (a planted outlier must be caught), zero-length lines, a
// tight curve, hidden lines, and that building ink writes nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { union, FillRule } from 'clipper2-ts'
import { Core, type Vec } from '../../src'
import { sk } from '../../test/sketch'
import { build, createInkCache, flatten, lineInk, outputDefect, segmentDistance, vertexBand, type Cubic } from '..'

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
  it('unequal widths: drawn at the narrower width, and marked for the next step', () => {
    const d = doc()
    d.edit(e => e.lineStroke('bc', { width: 8, profile: 'uniform' } as never))
    const ink = build(d.geometry(), d.snapshot()), arc = ink.diagnostics.find(x => x.source.kind === 'arc')!
    expect(arc.status).toBe('unproven')
    expect(arc.reason).toMatch(/differ in width/)
  })
  it('a hidden line leaves the arc and the other line; both hidden — no arc ink', () => {
    const d = doc()
    d.edit(e => e.lineState('bc', { visible: false }))
    expect(build(d.geometry(), d.snapshot()).pieces.map(p => p.source.kind).sort()).toEqual(['arc', 'line'])
    d.edit(e => e.lineState('ab', { visible: false }))
    expect(build(d.geometry(), d.snapshot()).pieces).toEqual([])
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
