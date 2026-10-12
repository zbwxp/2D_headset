// ink — the ink of each line as a filled outline (docs/ink-joins-plan.md; P1: docs/ink-p1-checklist.md). P1 draws
// single lines only: each line's ink is what a round-capped SVG stroke of its width paints — the centre curve swept by
// a disc of radius h = width / 2 — built with the library's own round offset (clipper2-ts, bowen 1791800851). No join
// changes shape in P1. Pure: reads a view's geometry and snapshot, returns the ink and one diagnostic per line, writes
// nothing.
//
// Statuses per line: 'verified' (every error bounded), 'unproven' (the checks pass, not every error has a complete
// bound), 'defect' (a check flags a rare geometric defect — the ink is still drawn, so the defect stays visible and can
// be reproduced, and the caller marks it; never hidden by an automatic fallback: bowen 1791801560 / 1791801629, dot
// 1791801801), 'fallback' (nothing to draw — no usable width, or the library returned no outline — the caller draws
// today's stroke so the line is never blank). The evidence is kept per kind of error (dot 1791801420).
import { inflatePaths, JoinType, EndType, type Paths64, type Point64 } from 'clipper2-ts'

export interface Vec { readonly x: number; readonly y: number }
export type Cubic = readonly [Vec, Vec, Vec, Vec]

/** What `build` reads: a view's drawn centre lines and its lines' stroke and visibility. */
export interface InkInput {
  readonly lines: readonly { readonly id: string; readonly curve: Cubic }[]
}
export interface InkLines {
  readonly lines: readonly { readonly id: string; readonly stroke: { readonly width: number }; readonly state: { readonly visible: boolean } }[]
}

/** One line's ink: closed loops in drawing units — outer loops and holes, in opposite orientations. */
export interface InkPiece { readonly source: { readonly kind: 'line'; readonly id: string }; readonly loops: readonly (readonly Vec[])[] }

export type InkStatus = 'verified' | 'unproven' | 'defect' | 'fallback'
export interface InkEvidence {
  /** ε for this line (drawing units) and its split. */
  readonly epsilon: number
  /** Flattening: the bound reached (max over pieces), and whether the depth floor stopped a piece first. */
  readonly flattening: { readonly bound: number; readonly floorHit: boolean }
  /** The arc tolerance passed to the library — a configuration, not a proven bound (dot 1791801420). */
  readonly arcTolerance: number
  /** The grid: units per drawing unit, and the input rounding √2 / (2s). */
  readonly scale: number
  readonly inputRounding: number
  /** Measured on the result: the largest |distance to the true centre curve − h| over every output vertex; null when
   *  the check stopped at its work limit (diagnosis incomplete — the ink is drawn all the same). */
  readonly bandError: number | null
  /** The output checks (§2b): loops simple, no bridge; the vertex band; the area check where it applies. */
  readonly checks: { readonly simple: boolean; readonly band: boolean | 'incomplete'; readonly area: boolean | 'n/a' }
}
export interface InkDiagnostic { readonly line: string; readonly status: InkStatus; readonly reason?: string; readonly evidence?: InkEvidence }
export interface Ink { readonly pieces: readonly InkPiece[]; readonly diagnostics: readonly InkDiagnostic[] }

export interface InkOptions {
  /** ε = clamp(relative × full width, min, max) per line. */
  readonly relative?: number
  readonly min?: number
  readonly max?: number
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const len = (a: Vec) => Math.hypot(a.x, a.y)
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Distance from p to the finite segment [a, b]; a zero-length segment is a point (dot 1791801420). */
export function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const d = sub(b, a), L2 = d.x * d.x + d.y * d.y
  if (L2 === 0) return len(sub(p, a))
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L2))
  return len(sub(p, { x: a.x + d.x * t, y: a.y + d.y * t }))
}

const split = (c: Cubic): [Cubic, Cubic] => {
  const ab = lerp(c[0], c[1], 0.5), bc = lerp(c[1], c[2], 0.5), cd = lerp(c[2], c[3], 0.5), abc = lerp(ab, bc, 0.5), bcd = lerp(bc, cd, 0.5), m = lerp(abc, bcd, 0.5)
  return [[c[0], ab, abc, m], [m, bcd, cd, c[3]]]
}

/**
 * The centre curve as a polyline whose distance to the curve is ≤ tol: a piece is split until both inner control
 * points lie within tol of the piece's chord *segment* — the curve lies in the control points' convex hull, so this
 * bounds the curve's distance to the chord (a curve folding back along its chord is caught, as the segment, not the
 * infinite line, is measured). The depth floor stops a piece that does not get there; the bound reached is returned.
 */
export function flatten(c: Cubic, tol: number, floor = 24): { points: Vec[]; bound: number; floorHit: boolean } {
  const points: Vec[] = [c[0]]
  let bound = 0, floorHit = false
  const go = (q: Cubic, depth: number) => {
    const e = Math.max(segmentDistance(q[1], q[0], q[3]), segmentDistance(q[2], q[0], q[3]))
    if (e <= tol || depth >= floor) { if (e > tol) floorHit = true; bound = Math.max(bound, e); points.push(q[3]); return }
    const [l, r] = split(q); go(l, depth + 1); go(r, depth + 1)
  }
  go(c, 0)
  return { points, bound, floorHit }
}

/** Distance from p to the cubic, within `tol` (the curve flattened to tol, then the nearest segment). */
function curveDistance(p: Vec, poly: readonly Vec[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < poly.length; i++) best = Math.min(best, segmentDistance(p, poly[i]!, poly[i + 1]!))
  if (poly.length === 1) best = len(sub(p, poly[0]!))
  return best
}

/**
 * The largest |distance to the true centre curve − h| over every vertex of the loops (the curve flattened to ε/16 for
 * the distance, so a vertex passes when this is ≤ ε − ε/16). For a zero-length line, the distance to its point.
 * The work is proportional to the line's length / (h + ε) and the vertex count, never to its bounding box (dot
 * 1791802464), and capped: past `budget` steps the check stops and returns null — "diagnosis incomplete"; the ink is
 * drawn all the same.
 */
export function vertexBand(loops: readonly (readonly Vec[])[], curve: Cubic | null, point: Vec, h: number, eps: number, budget = 200_000): number | null {
  const fine = curve ? flatten(curve, eps / 16).points : [point]
  if (fine.length < 2) { let w = 0; for (const l of loops) for (const v of l) w = Math.max(w, Math.abs(len(sub(v, fine[0]!)) - h)); return w }
  // a grid of the curve's segments (cell r = h + ε), each segment entered in the cells of points spaced ≤ r along it:
  // a vertex within r of a segment is within 1.5 r of one of those points, so the cells within 2 of the vertex's cell
  // are searched; a vertex with no segment there is measured against all (it fails the band anyway)
  const r = h + eps, key = (i: number, j: number) => i * 73856093 ^ j * 19349663, grid = new Map<number, number[]>()
  let work = 0
  for (let k = 0; k + 1 < fine.length; k++) {
    const a = fine[k]!, b = fine[k + 1]!, n = Math.max(1, Math.ceil(len(sub(b, a)) / r))
    if ((work += n + 1) > budget) return null
    let last = NaN
    for (let i = 0; i <= n; i++) {
      const p = lerp(a, b, i / n), q = key(Math.floor(p.x / r), Math.floor(p.y / r))
      if (q === last) continue
      last = q
      const cell = grid.get(q) ?? grid.set(q, []).get(q)!
      if (cell[cell.length - 1] !== k) cell.push(k)
    }
  }
  let worst = 0
  for (const l of loops) for (const v of l) {
    let best = Infinity
    const ci = Math.floor(v.x / r), cj = Math.floor(v.y / r)
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) for (const k of grid.get(key(i, j)) ?? []) { work++; best = Math.min(best, segmentDistance(v, fine[k]!, fine[k + 1]!)) }
    if (best > r) { work += fine.length; best = curveDistance(v, fine) }
    if (work > budget) return null
    worst = Math.max(worst, Math.abs(best - h))
  }
  return worst
}

// --- exact checks on integer coordinates (BigInt: coordinates that fit a Number do not make their products exact)
type I = { x: bigint; y: bigint }
const big = (p: Point64): I => ({ x: BigInt(p.x), y: BigInt(p.y) })
const orient = (a: I, b: I, c: I) => { const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); return v > 0n ? 1 : v < 0n ? -1 : 0 }
const onSeg = (a: I, b: I, p: I) => (p.x >= (a.x < b.x ? a.x : b.x) && p.x <= (a.x > b.x ? a.x : b.x) && p.y >= (a.y < b.y ? a.y : b.y) && p.y <= (a.y > b.y ? a.y : b.y))
/** Do segments ab and cd meet at all (crossing, touching, or overlapping)? */
function meet(a: I, b: I, c: I, d: I): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b))
}
const eq = (a: I, b: I) => a.x === b.x && a.y === b.y

/**
 * The output checks (§2b of the checklist; dot 1791800973, 1791801420): every loop simple — no two edges of one loop
 * meet except adjacent edges at their shared vertex (which also rejects a vertex visited twice, an edge folding back
 * onto the previous one, and a zero-width bridge); edges of different loops never cross or overlap, a touch at a
 * single shared vertex between different loops is allowed (a legitimate point contact). Exact, on the integers.
 */
export function outputDefect(paths: Paths64): string | null {
  const loops = paths.map(p => p.map(big))
  const edges: { a: I; b: I; loop: number; i: number; n: number; x0: bigint; x1: bigint }[] = []
  loops.forEach((l, k) => l.forEach((a, i) => { const b = l[(i + 1) % l.length]!; edges.push({ a, b, loop: k, i, n: l.length, x0: a.x < b.x ? a.x : b.x, x1: a.x > b.x ? a.x : b.x }) }))
  for (const l of loops) if (l.length < 3) return 'a loop with fewer than 3 vertices'
  edges.sort((e, f) => (e.x0 < f.x0 ? -1 : e.x0 > f.x0 ? 1 : 0))
  for (let m = 0; m < edges.length; m++) {
    const e = edges[m]!
    for (let q = m + 1; q < edges.length && edges[q]!.x0 <= e.x1; q++) {
      const f = edges[q]!
      if (!meet(e.a, e.b, f.a, f.b)) continue
      if (e.loop === f.loop) {
        const adjacent = (e.i + 1) % e.n === f.i || (f.i + 1) % f.n === e.i
        if (adjacent) {
          // adjacent edges share exactly one vertex; anything more (folding back, overlapping) is a defect
          const shared = eq(e.b, f.a) ? e.b : f.b
          const other = eq(e.b, f.a) ? f.b : f.a, mine = eq(e.b, f.a) ? e.a : e.b
          if (orient(mine, shared, other) === 0 && !(onSeg(mine, other, shared))) return 'an edge folds back onto the next (a zero-width bridge)'
          continue
        }
        return 'a loop is not simple (non-adjacent edges meet)'
      }
      // different loops: only a touch at one shared vertex is allowed — edges meeting end to end there, even when
      // collinear, as long as neither runs along the other
      const touch = [e.a, e.b].some(p => eq(p, f.a) || eq(p, f.b))
      const inside = (a: I, b: I, p: I) => !eq(p, a) && !eq(p, b) && orient(a, b, p) === 0 && onSeg(a, b, p)
      const overlap = inside(e.a, e.b, f.a) || inside(e.a, e.b, f.b) || inside(f.a, f.b, e.a) || inside(f.a, f.b, e.b)
      if (!touch || overlap) return 'two loops cross or overlap'
    }
  }
  return null
}

const polyArea = (l: readonly Vec[]) => l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]!; return s + p.x * q.y - q.x * p.y }, 0) / 2

/** A zero-length line: a disc of radius h, built by us (never left to the library's one-point input; dot 1791801420). */
function disc(c: Vec, h: number, tol: number): Vec[] {
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / h))))
  return Array.from({ length: n }, (_, i) => ({ x: c.x + h * Math.cos(2 * Math.PI * i / n), y: c.y + h * Math.sin(2 * Math.PI * i / n) }))
}

/** One line's ink and diagnostic. */
export function lineInk(id: string, curve: Cubic, width: number, opts: InkOptions = {}): { piece?: InkPiece; diagnostic: InkDiagnostic } {
  const h = width / 2
  if (!(h > 0) || !Number.isFinite(h)) return { diagnostic: { line: id, status: 'fallback', reason: 'width not usable' } }
  const eps = Math.min(opts.max ?? 0.05, Math.max(opts.min ?? 1e-4, (opts.relative ?? 0.01) * width))
  const flat = flatten(curve, eps / 2)
  const pts = flat.points
  const maxAbs = Math.max(...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))) + h
  // the grid: input rounding √2/(2s) ≤ ε/8, kept inside 2^50 for the library (its coordinates must stay below 2^53)
  const s = Math.min(Math.pow(2, Math.floor(Math.log2(2 ** 50 / Math.max(1, maxAbs)))), Math.pow(2, Math.ceil(Math.log2(4 * Math.SQRT2 / eps))))
  const inputRounding = Math.SQRT2 / (2 * s)
  const toI = (p: Vec): Point64 => ({ x: Math.round(p.x * s), y: Math.round(p.y * s) })
  const path = pts.map(toI).filter((p, i, a) => i === 0 || p.x !== a[i - 1]!.x || p.y !== a[i - 1]!.y)
  const arcTolerance = eps / 4
  let paths: Paths64
  const zeroLength = path.length === 1
  if (zeroLength) paths = [disc(curve[0], h, eps / 4).map(toI)]
  else paths = inflatePaths([path], h * s, JoinType.Round, EndType.Round, 2, arcTolerance * s)
  if (!paths.length) return { diagnostic: { line: id, status: 'fallback', reason: 'the library returned no outline' } }
  const loops = paths.map(p => p.map(q => ({ x: q.x / s, y: q.y / s })))
  const defect = outputDefect(paths)
  // the vertex band: every output vertex within [h − ε, h + ε] of the true centre curve (measured against a finer
  // flattening, whose own distance to the curve is ≤ ε/16 — subtracted from the tolerance)
  const bandError = vertexBand(loops, zeroLength ? null : curve, curve[0], h, eps)
  const band = bandError === null ? 'incomplete' as const : bandError <= eps - eps / 16
  // the area, only where the sweep cannot overlap itself: one loop, the polyline's turning small against h
  let area: boolean | 'n/a' = 'n/a'
  if (!zeroLength && loops.length === 1) {
    let L = 0, ok = true
    for (let i = 0; i + 1 < pts.length; i++) L += len(sub(pts[i + 1]!, pts[i]!))
    for (let i = 1; i + 1 < pts.length && ok; i++) {
      const u = sub(pts[i]!, pts[i - 1]!), w = sub(pts[i + 1]!, pts[i]!), lu = len(u), lw = len(w)
      if (!lu || !lw) continue
      const turn = Math.acos(Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y) / (lu * lw))))
      if (turn / Math.min(lu, lw) * h >= 0.5) ok = false // curvature × h well below 1: the inner side cannot fold
    }
    if (ok && L > 4 * h) {
      const expected = L * 2 * h + Math.PI * h * h, perim = loops[0]!.reduce((t, p, i, a) => t + len(sub(a[(i + 1) % a.length]!, p)), 0)
      area = Math.abs(Math.abs(polyArea(loops[0]!)) - expected) <= perim * eps
    }
  }
  const evidence: InkEvidence = { epsilon: eps, flattening: { bound: flat.bound, floorHit: flat.floorHit }, arcTolerance, scale: s, inputRounding, bandError, checks: { simple: !defect, band, area } }
  const piece: InkPiece = { source: { kind: 'line', id }, loops }
  if (defect) return { piece, diagnostic: { line: id, status: 'defect', reason: defect, evidence } }
  if (band === false) return { piece, diagnostic: { line: id, status: 'defect', reason: `an output vertex is ${bandError!.toExponential(2)} off the stroke's edge (ε ${eps.toExponential(2)})`, evidence } }
  if (area === false) return { piece, diagnostic: { line: id, status: 'defect', reason: 'the area differs from the stroke area', evidence } }
  // the arc approximation is a configuration, not a bound (dot 1791801420): only the zero-length disc, built by us, is bounded
  if (band === 'incomplete') return { piece, diagnostic: { line: id, status: 'unproven', reason: 'diagnosis incomplete: the vertex band check stopped at its work limit', evidence } }
  const verified = zeroLength && !flat.floorHit
  return { piece, diagnostic: { line: id, status: verified ? 'verified' : 'unproven', evidence } }
}

/** The ink of a view: every visible line's piece (hidden lines have none — their decoration is drawn from the centre line). */
export function build(geometry: InkInput, snapshot: InkLines, opts: InkOptions = {}): Ink {
  const byId = new Map(snapshot.lines.map(l => [l.id, l] as const))
  const pieces: InkPiece[] = [], diagnostics: InkDiagnostic[] = []
  for (const g of geometry.lines) {
    const l = byId.get(g.id)
    if (!l || !l.state.visible) continue
    const r = lineInk(g.id, g.curve, l.stroke.width, opts)
    if (r.piece) pieces.push(r.piece)
    diagnostics.push(r.diagnostic)
  }
  return { pieces, diagnostics }
}

/**
 * A cache of line ink, owned by its caller (one per canvas): a line is rebuilt only when its curve or width changed,
 * so an edit rebuilds the edited lines and a re-render with nothing changed rebuilds none. Entries for lines that are
 * gone are dropped on the next build.
 */
export function createInkCache(opts: InkOptions = {}) {
  const memo = new Map<string, { key: string; piece?: InkPiece; diagnostic: InkDiagnostic }>()
  return {
    build(geometry: InkInput, snapshot: InkLines): Ink {
      const byId = new Map(snapshot.lines.map(l => [l.id, l] as const)), seen = new Set<string>()
      const pieces: InkPiece[] = [], diagnostics: InkDiagnostic[] = []
      for (const g of geometry.lines) {
        const l = byId.get(g.id)
        if (!l || !l.state.visible) continue
        seen.add(g.id)
        const key = JSON.stringify([g.curve, l.stroke.width])
        let e = memo.get(g.id)
        if (!e || e.key !== key) { e = { key, ...lineInk(g.id, g.curve, l.stroke.width, opts) }; memo.set(g.id, e) }
        if (e.piece) pieces.push(e.piece)
        diagnostics.push(e.diagnostic)
      }
      for (const id of [...memo.keys()]) if (!seen.has(id)) memo.delete(id)
      return { pieces, diagnostics }
    },
  }
}
