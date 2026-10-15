// Inside a cell, the edges' results are blended, not their ratios (docs/cell-blend-checklist.md; bowen 1791989710):
// the Coons patch of the four edges' own blends. Edges and views stay exactly as before; with no responses it is 3a's
// bilinear blend; the case of 161.json (a −0.82 span with a −4 response) no longer throws the point the wrong way.
import { describe, it, expect } from 'vitest'
import { evaluate, onEdge, respond, type Model, type ViewShape } from '../src/evaluate'

const YAWS = [-90, 0, 90], PITCHES = [-45, 0, 45]
type K = [number, number][]
/** One point p whose x per view is given; y follows yaw and pitch so every edge has a span. */
function model(x: (yaw: number, pitch: number) => number, responses?: Record<string, { x?: K }>): Model {
  const view = (yaw: number, pitch: number): ViewShape => ({ yaw, pitch, points: { p: { x: x(yaw, pitch), y: yaw / 9 + pitch / 4.5 } }, lines: {} })
  return { views: YAWS.flatMap(y => PITCHES.map(p => view(y, p))), ...(responses ? { responses: { points: { p: responses }, handles: {} } } : {}) }
}
const X = (yaw: number, pitch: number) => 10 + yaw / 7 + pitch / 3 + (yaw * pitch) / 500
const at = (m: Model, yaw: number, pitch: number) => evaluate(m, { yaw, pitch }).points.p!.x

describe('the cell blend', () => {
  const knots: Record<string, { x: K }> = {
    '0,0>90,0': { x: [[0.3, -0.4], [0.7, 1.6]] }, '0,-45>90,-45': { x: [[1 / 3, -4]] },
    '0,0>0,-45': { x: [[0.5, 0.8]] }, '90,0>90,-45': { x: [[0.2, 0.5], [0.9, 1.1]] },
  }
  it('on every edge it is exactly that edge\'s own blend (`onEdge`); at the views exactly the view', () => {
    const m = model(X, knots)
    for (const t of [0.1, 1 / 3, 0.5, 0.77]) {
      expect(at(m, 90 * t, 0)).toBe(onEdge(knots['0,0>90,0']!.x, t, X(0, 0), X(90, 0)))
      expect(at(m, 90 * t, -45)).toBe(onEdge(knots['0,-45>90,-45']!.x, t, X(0, -45), X(90, -45)))
      expect(at(m, 0, -45 * t)).toBe(onEdge(knots['0,0>0,-45']!.x, t, X(0, 0), X(0, -45)))
      expect(at(m, 90, -45 * t)).toBe(onEdge(knots['90,0>90,-45']!.x, t, X(90, 0), X(90, -45)))
    }
    for (const y of YAWS) for (const p of PITCHES) expect(at(m, y, p)).toBe(X(y, p))
  })

  it('inside: the Coons patch of the four edges, written out; with responses that are linear it is the bilinear blend', () => {
    const m = model(X, knots), u = 50 / 90, v = 20 / 45
    const r = (k: string, t: number) => respond(knots[k]!.x, t)
    const F = X(0, 0), Y = X(90, 0), P = X(0, -45), C = X(90, -45)
    const Eb = (1 - r('0,0>90,0', u)) * F + r('0,0>90,0', u) * Y, Et = (1 - r('0,-45>90,-45', u)) * P + r('0,-45>90,-45', u) * C
    const El = (1 - r('0,0>0,-45', v)) * F + r('0,0>0,-45', v) * P, Er = (1 - r('90,0>90,-45', v)) * Y + r('90,0>90,-45', v) * C
    const B = (1 - u) * (1 - v) * F + u * (1 - v) * Y + (1 - u) * v * P + u * v * C
    expect(at(m, 50, -20)).toBeCloseTo((1 - v) * Eb + v * Et + (1 - u) * El + u * Er - B, 12)
    // knots on the diagonal (kept, never dropped) respond linearly: the bilinear blend, as with no responses
    const diagonal = model(X, Object.fromEntries(Object.keys(knots).map(k => [k, { x: [[0.5, 0.5]] as K }])))
    for (const [y, p] of [[50, -20], [10, -40], [85, -5]] as const) expect(at(diagonal, y, p)).toBeCloseTo(at(model(X), y, p), 12)
  })

  it('all four edges corrected, x and y differently (dot 1791989928): each axis is its own expanded Coons formula', () => {
    const kx: Record<string, K> = { '0,0>90,0': [[0.3, -0.4]], '0,-45>90,-45': [[0.6, 1.8]], '0,0>0,-45': [[0.5, 0.2]], '90,0>90,-45': [[0.25, 0.9]] }
    const ky: Record<string, K> = { '0,0>90,0': [[0.8, 0.5]], '0,-45>90,-45': [[0.2, -0.7]], '0,0>0,-45': [[0.4, 1.4]], '90,0>90,-45': [[0.7, 0.1]] }
    const Yv = (yaw: number, pitch: number) => 3 - yaw / 11 + pitch / 5 + (yaw * pitch) / 300
    const view = (yaw: number, pitch: number): ViewShape => ({ yaw, pitch, points: { p: { x: X(yaw, pitch), y: Yv(yaw, pitch) } }, lines: {} })
    const m: Model = { views: YAWS.flatMap(y => PITCHES.map(p => view(y, p))), responses: { points: { p: Object.fromEntries(Object.keys(kx).map(e => [e, { x: kx[e]!, y: ky[e]! }])) }, handles: {} } }
    const coons = (f: (yaw: number, pitch: number) => number, k: Record<string, K>, u: number, v: number) => {
      const F = f(0, 0), Y = f(90, 0), P = f(0, -45), C = f(90, -45), r = (e: string, t: number) => respond(k[e], t)
      const Eb = (1 - r('0,0>90,0', u)) * F + r('0,0>90,0', u) * Y, Et = (1 - r('0,-45>90,-45', u)) * P + r('0,-45>90,-45', u) * C
      const El = (1 - r('0,0>0,-45', v)) * F + r('0,0>0,-45', v) * P, Er = (1 - r('90,0>90,-45', v)) * Y + r('90,0>90,-45', v) * C
      return (1 - v) * Eb + v * Et + (1 - u) * El + u * Er - ((1 - u) * (1 - v) * F + u * (1 - v) * Y + (1 - u) * v * P + u * v * C)
    }
    for (const [yaw, pitch] of [[28, -35], [60, -10], [5, -44], [89, -1]] as const) {
      const got = evaluate(m, { yaw, pitch }).points.p!, u = yaw / 90, v = -pitch / 45
      expect(got.x).toBeCloseTo(coons(X, kx, u, v), 12)
      expect(got.y).toBeCloseTo(coons(Yv, ky, u, v), 12)
    }
  })

  it('continuous (in position; not promised smooth in speed across an edge, dot 1791989928) across the cell borders, 0° included, with responses on the shared edges', () => {
    const all: Record<string, { x: K }> = {}
    for (const y of [-90, 90]) for (const p of [-45, 0, 45]) all[`0,${p}>${y},${p}`] = { x: [[0.4, -1.5]] }
    for (const y of [-90, 0, 90]) for (const p of [-45, 45]) all[`${y},0>${y},${p}`] = { x: [[0.6, 2]] }
    const m = model(X, all), e = 1e-9
    for (const [a, b] of [[[-e, 20], [e, 20]], [[40, -e], [40, e]], [[-e, -e], [e, e]]] as const) expect(Math.abs(at(m, a[0], a[1]) - at(m, b[0], b[1]))).toBeLessThan(1e-6)
  })

  it('161.json\'s case: a −0.82 span with a −4 response on the −45 edge no longer throws the point the wrong way inside the cell', () => {
    // the outer eye corner: at pitch 0 the yaw views are 15.67 apart, at pitch −45 only −0.82 apart; a correction at
    // (30, −45) stored −4 there; the pitch 0 and the yaw edges are linear
    const x = (yaw: number, pitch: number) => (pitch === 0 ? (yaw === 0 ? 0 : 15.67) : yaw === 0 ? 10 : 9.18)
    const m = model(x, { '0,-45>90,-45': { x: [[1 / 3, -4]] } })
    const u = 28 / 90, v = 35 / 45, rt = respond([[1 / 3, -4]], u)
    const Eb = u * 15.67, Et = (1 - rt) * 10 + rt * 9.18 // each edge with its own two views
    // the ratio formula: one ratio u' mixed from the edges, then applied to the bilinear blend of all four views
    const u2 = (1 - v) * u + v * rt
    const ratio = (1 - u2) * ((1 - v) * 0 + v * 10) + u2 * ((1 - v) * 15.67 + v * 9.18)
    const now = at(m, 28, -35)
    expect(now).toBeCloseTo((1 - v) * Eb + v * Et, 12) // linear side edges: the edges' results blended by v
    expect(now).toBeGreaterThanOrEqual(Math.min(Eb, Et)); expect(now).toBeLessThanOrEqual(Math.max(Eb, Et))
    expect(ratio).toBeLessThan(Math.min(Eb, Et) - 5) // the old formula: several units outside both edges, the wrong way
  })
})
