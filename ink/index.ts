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
import { inflatePaths, union, difference, JoinType, EndType, FillRule, type Paths64, type Point64 } from 'clipper2-ts'

export interface Vec { readonly x: number; readonly y: number }
export type Cubic = readonly [Vec, Vec, Vec, Vec]

/** What `build` reads: a view's drawn centre lines and arcs, and its lines' stroke and visibility. */
export interface InkInput {
  readonly lines: readonly { readonly id: string; readonly curve: Cubic }[]
  readonly arcs: readonly { readonly key: string; readonly lines: readonly [string, string]; readonly curve: Cubic }[]
}
export interface InkLines {
  readonly lines: readonly { readonly id: string; readonly a: string; readonly b: string; readonly stroke: { readonly width: number; readonly widthB?: number }; readonly state: { readonly visible: boolean } }[]
  /** The joins; smooth and bound ones join their lines' ink and ease unequal widths, cusp ones add a tip. */
  readonly joins?: readonly { readonly point: string; readonly lines: readonly [string, string]; readonly mode: string }[]
  /** The joins' zones of this view (core `zones()`): a smooth / bound join eases over half its 限长后长度 each side. */
  readonly zones?: readonly { readonly point: string; readonly lines: readonly [string, string]; readonly limited: number }[]
  /** Points' end strokes: `taper` = a free end's taper length as a multiple of its width (absent 3, 0 none). */
  readonly points?: readonly { readonly id: string; readonly endStroke?: { readonly taper?: number | string } }[]
}

/**
 * A half-width along a centre curve: `h`, except where an end eases — from `joint` at that end to `h` over `length`
 * of arc length (measured along the flattened curve; 'all' = the whole curve), by smoothstep (slope 0 at both ends of
 * the span). `centred`: the end is one half of a single S-curve centred on the joint (principle §1.3; bowen 1791817874 —
 * two smoothsteps meeting flat at the joint read as a lump): h = h + 2 (joint − h) · smoothstep((1 − s / length) / 2),
 * so the joint is the S-curve's middle (steepest, the same slope from both lines) and the far end meets h flat.
 * `tip`: a free end tapering to a point (bowen 1791853511; joint 0): h − h_end · (1 − s / length)², reaching 0 at the end.
 */
export interface EndEase { readonly joint: number; readonly centred?: boolean; readonly tip?: boolean }
export interface Profile {
  /** The half-width at the start; `hEnd` the half-width at the end, linear in between along the arc length (two end
   *  widths, bowen 1791818995); absent = `h`. The ends' easing is added on top, relative to that end's own width. */
  readonly h: number
  readonly hEnd?: number
  readonly start?: EndEase & { readonly length: number | 'all' }
  readonly end?: EndEase & { readonly length: number }
}

/** What a piece of ink is drawn for: a line, or an arc join's arc (which belongs to both its lines). */
export type InkSource = { readonly kind: 'line'; readonly id: string } | { readonly kind: 'arc' | 'tip'; readonly id: string; readonly lines: readonly [string, string] }
/** One piece of ink: closed loops in drawing units — outer loops and holes, in opposite orientations — exactly on the
 *  integer grid of `scale` (units per drawing unit, a power of two). */
export interface InkPiece { readonly source: InkSource; readonly loops: readonly (readonly Vec[])[]; readonly scale: number }
/**
 * Pieces joined by arcs — a line, its arc, the next line… — and their union as one outline: drawn as one filled path
 * when they share a paint, so no hairline seam shows between them (dot 1791802438). The union is the same set as the
 * pieces together, so drawing it or the pieces gives the same shape — selection never changes a join's shape.
 */
export interface InkGroup { readonly pieces: readonly InkPiece[]; readonly loops: readonly (readonly Vec[])[]; readonly status: 'unproven' | 'defect'; readonly reason?: string }

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
export interface InkDiagnostic { readonly source: InkSource; readonly status: InkStatus; readonly reason?: string; readonly evidence?: InkEvidence }
export interface Ink { readonly pieces: readonly InkPiece[]; readonly diagnostics: readonly InkDiagnostic[]; readonly groups: readonly InkGroup[] }

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
 * Signed distance from p to the convex hull of two discs (centres a, b; radii ra, rb) — the stroke of a segment whose
 * width changes linearly along it (iq's uneven capsule, exact). Equal radii: the distance to the segment − r. When one
 * disc holds the other, the hull is the larger disc.
 */
export function capsuleDistance(p: Vec, a: Vec, b: Vec, ra: number, rb: number): number {
  const d = sub(b, a), L = len(d)
  if (L <= Math.abs(ra - rb)) return Math.min(len(sub(p, a)) - ra, len(sub(p, b)) - rb)
  const ux = d.x / L, uy = d.y / L, q = sub(p, a), along = q.x * ux + q.y * uy, across = Math.abs(q.x * -uy + q.y * ux)
  const k = (ra - rb) / L, c = Math.sqrt(1 - k * k), proj = along * c - across * k
  if (proj > 0 && proj < L * c) return along * k + across * c - ra
  return proj <= 0 ? len(q) - ra : len(sub(p, b)) - rb
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
  return band(loops, fine, fine.map(() => h), eps, budget)
}

/**
 * The band against a reference polyline whose radius changes along it (per point): the largest |signed distance to the
 * union of the segments' capsules| over every vertex — 0 on the reference boundary. Constant radii give `vertexBand`.
 */
export function band(loops: readonly (readonly Vec[])[], pts: readonly Vec[], radii: readonly number[], eps: number, budget = 200_000): number | null {
  // a grid of the segments (cell r = the largest radius + ε), each segment entered in the cells of points spaced ≤ r
  // along it: a vertex within r of a segment is within 1.5 r of one of those points, so the cells within 2 of the
  // vertex's cell are searched; a vertex with no segment there is measured against all (it fails the band anyway)
  const r = Math.max(...radii) + eps, key = (i: number, j: number) => i * 73856093 ^ j * 19349663, grid = new Map<number, number[]>()
  const dist = (v: Vec, k: number) => capsuleDistance(v, pts[k]!, pts[k + 1]!, radii[k]!, radii[k + 1]!)
  let work = 0
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!, b = pts[k + 1]!, n = Math.max(1, Math.ceil(len(sub(b, a)) / r))
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
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) for (const k of grid.get(key(i, j)) ?? []) { work++; best = Math.min(best, dist(v, k)) }
    if (best === Infinity) { work += pts.length; for (let k = 0; k + 1 < pts.length; k++) best = Math.min(best, dist(v, k)) }
    if (work > budget) return null
    worst = Math.max(worst, Math.abs(best))
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
  if (h <= 0) return [c]
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / h))))
  return Array.from({ length: n }, (_, i) => ({ x: c.x + h * Math.cos(2 * Math.PI * i / n), y: c.y + h * Math.sin(2 * Math.PI * i / n) }))
}

const smoothstep = (u: number) => u * u * (3 - 2 * u)
const hullOf = (ps: Vec[]): Vec[] => {
  const q = [...ps].sort((a, b) => a.x - b.x || a.y - b.y), cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Vec[] = [], upper: Vec[] = []
  for (const p of q) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p) }
  for (const p of q.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}
/**
 * A polyline's points with the profile's half-width at each, split exactly at each span's end (s = λ) and, inside a
 * span, so that between two points h is within `tol` of its linear interpolation (|h″| ≤ 6|Δh|/λ², so the error over
 * a step δs is ≤ δs²·6|Δh|/(8λ²)).
 */
function radiiAlong(points: readonly Vec[], pr: Profile, tol: number): { pts: Vec[]; radii: number[] } {
  const L = points.slice(1).reduce((t, p, i) => t + len(sub(p, points[i]!)), 0)
  const spans: { s0: number; s1: number; d: number }[] = []
  const ls = pr.start ? (pr.start.length === 'all' ? L : Math.min(pr.start.length, L)) : 0, le = pr.end ? Math.min(pr.end.length, L) : 0
  const h0 = pr.h, h1 = pr.hEnd ?? pr.h
  if (pr.start && ls > 0) spans.push({ s0: 0, s1: ls, d: Math.abs(h0 - pr.start.joint) })
  if (pr.end && le > 0) spans.push({ s0: L - le, s1: L, d: Math.abs(h1 - pr.end.joint) })
  const hAt = (at: number) => {
    let h = L > 0 ? h0 + (h1 - h0) * Math.min(1, at / L) : h0 // linear between the two end widths (exact between points)
    // a free end's tip (bowen 1791853511): h · (2u − u²) — slope 0 into the body, a pointed tip with a finite angle
    const ease = (e: EndEase, base: number, u: number) => e.tip ? -base * (1 - u) * (1 - u) : e.centred ? 2 * (e.joint - base) * smoothstep((1 - u) / 2) : (e.joint - base) * (1 - smoothstep(u))
    if (pr.start && ls > 0 && at < ls) h += ease(pr.start, h0, at / ls)
    if (pr.end && le > 0 && at > L - le) h += ease(pr.end, h1, (L - at) / le)
    return h
  }
  const pts: Vec[] = [points[0]!], radii = [hAt(0)]
  let at = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!, l = len(sub(b, a))
    const cuts = new Set<number>([1])
    // only the part of the segment inside a span is subdivided (dot 1791804706: a long straight segment is not
    // densified as a whole for a short easing at its end)
    for (const sp of spans) {
      const lo = Math.max(at, sp.s0), hi = Math.min(at + l, sp.s1)
      if (hi <= lo || !sp.d) continue
      const step = Math.sqrt(8 * tol / (6 * sp.d)) * (sp.s1 - sp.s0), n = Math.max(1, Math.ceil((hi - lo) / step))
      for (let j = 1; j < n; j++) cuts.add((lo - at + (hi - lo) * j / n) / l)
    }
    for (const sp of spans) for (const x of [sp.s0, sp.s1]) if (l > 0 && x > at && x < at + l) cuts.add((x - at) / l)
    for (const f of [...cuts].sort((x, y) => x - y)) { pts.push(lerp(a, b, f)); radii.push(hAt(Math.min(L, at + l * f))) }
    at += l
  }
  return { pts, radii }
}

/** Ends drawn flat (J3-min, docs/j3-min-cusp-flat-checklist.md; principle §1.1: a joined end has no cap): a cusp's two
 *  ends. A flat end is generated flat — never cut out of the finished ink (dot 1791816797: a curve passing back through
 *  a cut box would be carved too). */
export interface Flat { readonly start?: boolean; readonly end?: boolean }
/** The end's outward direction (unit, away from the line) from its handle — the direction `cuspTip` uses. */
const outward = (c: Cubic, end: 'start' | 'end'): Vec | undefined => {
  const [o, ...rest] = end === 'start' ? [c[0], c[1], c[2], c[3]] : [c[3], c[2], c[1], c[0]]
  const q = rest.find(r => len(sub(r, o)) > 1e-9)
  if (!q) return undefined
  const v = sub(o, q), l = len(v)
  return { x: v.x / l, y: v.y / l }
}
/** A flat end's face lies 4 grid units past p along the end's handle direction: the line overlaps the tip (whose sides
 *  p–A lie on the face at p) by that sliver, so the union has no seam from the two grids' rounding (an edge-only
 *  contact left the tip as a separate loop on the 125.json eye corner). */
const FACE = 4

/** One line's ink and diagnostic. */
export function lineInk(id: string, curve: Cubic, width: number, opts: InkOptions = {}, flat: Flat = {}) { return sweep({ kind: 'line', id }, curve, width, opts, flat) }

/** A centre curve swept by a disc of the given width: a line's ink, or an arc's at its lines' width. */
export function sweep(source: InkSource, curve: Cubic, widths: number | readonly [number, number] | Profile, opts: InkOptions = {}, flatEnds: Flat = {}): { piece?: InkPiece; diagnostic: InkDiagnostic } {
  const pr: Profile = typeof widths === 'number' ? { h: widths / 2 } : 'h' in widths ? widths : { h: widths[1] / 2, start: { joint: widths[0] / 2, length: 'all' } }
  // a flat end (J3-min) is generated by the hull construction, whose face is exactly perpendicular to the handle (the
  // library's butt end on a short extension left a 0.15 dent on 125.json's right eye)
  if ((pr.start && pr.start.joint !== pr.h) || (pr.end && pr.end.joint !== (pr.hEnd ?? pr.h)) || (pr.hEnd !== undefined && pr.hEnd !== pr.h) || flatEnds.start || flatEnds.end) return taperedSweep(source, curve, pr, opts, flatEnds)
  const width = pr.h * 2, h = pr.h
  if (!(h > 0) || !Number.isFinite(h)) return { diagnostic: { source, status: 'fallback', reason: 'width not usable' } }
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
  if (!paths.length) return { diagnostic: { source, status: 'fallback', reason: 'the library returned no outline' } }
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
  const piece: InkPiece = { source, loops, scale: s }
  if (defect) return { piece, diagnostic: { source, status: 'defect', reason: defect, evidence } }
  if (band === false) return { piece, diagnostic: { source, status: 'defect', reason: `an output vertex is ${bandError!.toExponential(2)} off the stroke's edge (ε ${eps.toExponential(2)})`, evidence } }
  if (area === false) return { piece, diagnostic: { source, status: 'defect', reason: 'the area differs from the stroke area', evidence } }
  // the arc approximation is a configuration, not a bound (dot 1791801420): only the zero-length disc, built by us, is bounded
  if (band === 'incomplete') return { piece, diagnostic: { source, status: 'unproven', reason: 'diagnosis incomplete: the vertex band check stopped at its work limit', evidence } }
  const verified = zeroLength && !flat.floorHit
  return { piece, diagnostic: { source, status: verified ? 'verified' : 'unproven', evidence } }
}

/**
 * A centre curve whose width eases (`Profile`): an arc between lines of different widths (Slack 1791803733, dot
 * 1791803768 — over the whole arc, from lines[0]'s width to lines[1]'s), or a line's end at a smooth join with a line
 * of another width (Slack 1791804157, dot 1791804198 — over λ, to the average at the joint). s is the arc length
 * accumulated along the flattened curve (not the Bézier parameter); smoothstep has slope 0 at both ends of a span, so
 * locally the ink meets the constant part tangentially (a larger disc nearby may still cover the joint: no claim of
 * "no step" for every input). A piecewise approximation of that variable-disc sweep — the union of the convex hulls of
 * consecutive discs — so the status stays 'unproven'. ε from the narrowest width, split as flattening, the easing's
 * interpolation, the discs' polygons ε/4 each, rounding ε/8. Checked by the output checks and the band against a finer
 * reference (flattening and interpolation each ≤ ε/16).
 */
function taperedSweep(source: InkSource, curve: Cubic, pr: Profile, opts: InkOptions, flatEnds: Flat = {}): { piece?: InkPiece; diagnostic: InkDiagnostic } {
  // a pinch eases to 0 at the joint: ε from the narrowest positive width
  const hs = [pr.h, pr.hEnd ?? pr.h, pr.start?.joint ?? pr.h, pr.end?.joint ?? pr.hEnd ?? pr.h], width = 2 * Math.min(...hs.filter(h => h > 0)), hMax = Math.max(...hs)
  if (!(pr.h > 0) || !(width > 0) || !hs.every(h => Number.isFinite(h) && h >= 0)) return { diagnostic: { source, status: 'fallback', reason: 'width not usable' } }
  const eps = Math.min(opts.max ?? 0.05, Math.max(opts.min ?? 1e-4, (opts.relative ?? 0.01) * width))
  const flat = flatten(curve, eps / 4), t = radiiAlong(flat.points, pr, eps / 4)
  const maxAbs = Math.max(...t.pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))) + hMax
  const s = Math.min(Math.pow(2, Math.floor(Math.log2(2 ** 50 / Math.max(1, maxAbs)))), Math.pow(2, Math.ceil(Math.log2(4 * Math.SQRT2 / eps))))
  const toI = (p: Vec): Point64 => ({ x: Math.round(p.x * s), y: Math.round(p.y * s) })
  // flat ends (J3-min): the centre extended by the face offset along the handle; the hulls of the end's own last
  // stretch (2 × its widest radius) are cut at the face, then joined with the rest — only the end is generated flat,
  // nothing else of the line can be cut (dot 1791816797)
  const faces: { o: Vec; d: Vec; R: number; at: 'start' | 'end' }[] = []
  for (const end of ['start', 'end'] as const) {
    const d = flatEnds[end] && t.pts.length >= 2 ? outward(curve, end) : undefined
    if (!d) continue
    const q = t.pts[end === 'start' ? 0 : t.pts.length - 1]!
    faces.push({ o: { x: q.x + d.x * FACE / s, y: q.y + d.y * FACE / s }, d, R: 0, at: end })
  }
  for (const f of faces) if (f.at === 'start') { t.pts.unshift(f.o); t.radii.unshift(t.radii[0]!) } else { t.pts.push(f.o); t.radii.push(t.radii[t.radii.length - 1]!) }
  const hulls = t.pts.length < 2 ? [disc(t.pts[0]!, hMax, eps / 4)]
    : t.pts.slice(1).map((b, i) => hullOf([...disc(t.pts[i]!, t.radii[i]!, eps / 4), ...disc(b, t.radii[i + 1]!, eps / 4)]))
  const boxesOf = new Map<number, Point64[][]>()
  for (const f of faces) {
    // the end's own stretch: hulls from this end while within 2 × the widest radius met so far (arc length from the face)
    let run = 0, rMax = 0
    const idx: number[] = []
    for (let k = 0; k < hulls.length; k++) {
      const i = f.at === 'start' ? k : hulls.length - 1 - k
      rMax = Math.max(rMax, t.radii[i]!, t.radii[i + 1]!)
      if (run > 2 * rMax) break
      idx.push(i); run += len(sub(t.pts[i + 1]!, t.pts[i]!))
    }
    f.R = 1.05 * rMax + eps
    const n = { x: -f.d.y * f.R, y: f.d.x * f.R }, g = { x: f.d.x * f.R, y: f.d.y * f.R }
    const box = [{ x: f.o.x + n.x, y: f.o.y + n.y }, { x: f.o.x + n.x + g.x, y: f.o.y + n.y + g.y }, { x: f.o.x - n.x + g.x, y: f.o.y - n.y + g.y }, { x: f.o.x - n.x, y: f.o.y - n.y }].map(toI)
    for (const i of idx) (boxesOf.get(i) ?? boxesOf.set(i, []).get(i)!).push(box)
  }
  const pieces = hulls.flatMap((h, i) => { const hp = [h.map(toI)], bs = boxesOf.get(i); return bs ? difference(hp, bs, FillRule.NonZero) : hp })
  const paths = union(pieces, FillRule.NonZero)
  if (!paths.length) return { diagnostic: { source, status: 'fallback', reason: 'the library returned no outline' } }
  const loops = paths.map(p => p.map(q => ({ x: q.x / s, y: q.y / s })))
  const defect = outputDefect(paths)
  const ref = radiiAlong(flatten(curve, eps / 16).points, pr, eps / 16)
  // a vertex on a flat end's face is not on the swept edge: left out of the band (the face itself is the construction)
  const onFace = (v: Vec) => faces.some(f => { const w = sub(v, f.o); return Math.abs(w.x * f.d.x + w.y * f.d.y) <= eps && Math.abs(w.x * f.d.y - w.y * f.d.x) <= f.R })
  const bandError = ref.pts.length < 2 ? 0 : band(faces.length ? loops.map(l => l.filter(v => !onFace(v))) : loops, ref.pts, ref.radii, eps)
  const ok = bandError === null ? 'incomplete' as const : bandError <= eps - eps / 8
  const evidence: InkEvidence = { epsilon: eps, flattening: { bound: flat.bound, floorHit: flat.floorHit }, arcTolerance: eps / 4, scale: s, inputRounding: Math.SQRT2 / (2 * s), bandError, checks: { simple: !defect, band: ok, area: 'n/a' } }
  const piece: InkPiece = { source, loops, scale: s }
  if (defect) return { piece, diagnostic: { source, status: 'defect', reason: defect, evidence } }
  if (ok === false) return { piece, diagnostic: { source, status: 'defect', reason: `an output vertex is ${bandError!.toExponential(2)} off the tapered stroke's edge (ε ${eps.toExponential(2)})`, evidence } }
  if (ok === 'incomplete') return { piece, diagnostic: { source, status: 'unproven', reason: 'diagnosis incomplete: the vertex band check stopped at its work limit', evidence } }
  return { piece, diagnostic: { source, status: 'unproven', evidence } }
}

/**
 * A sharp (cusp) joint at p between a line arriving along u0 (unit, into p) and one leaving along u1 (Slack 1791804643,
 * dot 1791804679). The tip is v103's `cuspCorner` (7205381, inkJoin.ts:11–23): the quadrilateral [p, A0, p + tip, A1],
 * A_i = p + the outer offset of line i, tip = the meeting point of the two outer edges extended forward, shortened to
 * (h0 + h1) · (3 − smoothstep(θ / 30°)) — twice the average width at 30° and above, three times at 0° (bowen
 * 1791817399 / 1791818040; v103: 5 ×) — when longer, never inside the bevel A0–A1 (straight sides, the apex kept pointed). Only that tip comes from v103 — the ink is the two lines' own ink, their ends at p drawn flat (J3-min,
 * `Flat`), plus this tip, not v103's whole outline.
 * - 'ease' (O3): the forward extensions do not meet — decided on both extension parameters, not on the miter's
 *   direction — or the lines run straight on with unequal widths: the widths ease to the average (as a smooth join).
 * - folding back (0°): the limit of the tip as θ → 0 — a spike of 3 × the average width straight ahead of p, between the
 *   lines' two outer edges (bowen 1791818040 replaces v103's pinch, which jumped from a long tip to none).
 * - 'none': straight on, equal widths.
 * - I2b — the wider line's end showing past the thinner one near the tip (h_w·cos θ > h_t) — is known and not handled
 *   yet: it is flagged on the tip, not left for the self-crossing or band checks to find.
 */
export function cuspTip(p: Vec, u0: Vec, u1: Vec, h0: number, h1: number): { kind: 'tip'; polygon: Vec[]; h0: number; h1: number; i2b: boolean } | { kind: 'ease' | 'none' } {
  const dot = u0.x * u1.x + u0.y * u1.y, turn = u0.x * u1.y - u0.y * u1.x
  if (1 + dot < 1e-10) {
    const n = { x: -u0.y, y: u0.x }, L = 3 * (h0 + h1)
    return { kind: 'tip', polygon: [p, { x: p.x + n.x * h0, y: p.y + n.y * h0 }, { x: p.x + u0.x * L, y: p.y + u0.y * L }, { x: p.x - n.x * h1, y: p.y - n.y * h1 }], h0, h1, i2b: h0 !== h1 }
  }
  if (Math.abs(turn) < 1e-10) return { kind: h0 === h1 ? 'none' : 'ease' }
  const side = turn > 0 ? -1 : 1, o0 = { x: -u0.y * side * h0, y: u0.x * side * h0 }, o1 = { x: -u1.y * side * h1, y: u1.x * side * h1 }
  // A0 + t·u0 = A1 − s·u1: both edges extended forward (t, s ≥ 0) meet; otherwise O3
  const d = sub(o1, o0), t = (d.x * u1.y - d.y * u1.x) / turn, s = (u0.x * d.y - u0.y * d.x) / turn
  if (t < 0 || s < 0) return { kind: 'ease' }
  // the tip's length (bowen 1791817399 / 1791818040): the natural miter, at most the average width × (3 − smoothstep(θ /
  // 30°)) — 2 × at 30° and above (the natural tip is shorter there), growing to 3 × at 0° (θ = the angle between the
  // lines; the tip always points out of the corner, away from the angle below 180°); never inside the bevel A0–A1
  const miter = { x: o0.x + t * u0.x, y: o0.y + t * u0.y }, ml = len(miter) || 1, m = { x: miter.x / ml, y: miter.y / ml }
  const theta = Math.acos(Math.max(-1, Math.min(1, -dot))) * 180 / Math.PI, limit = (h0 + h1) * (3 - smoothstep(Math.min(1, theta / 30)))
  const bevel = Math.max(o0.x * m.x + o0.y * m.y, o1.x * m.x + o1.y * m.y), k = Math.max(bevel, Math.min(ml, limit)) / ml
  const cosTheta = -dot, i2b = cosTheta > 0 && Math.max(h0, h1) * cosTheta > Math.min(h0, h1)
  return { kind: 'tip', polygon: [p, { x: p.x + o0.x, y: p.y + o0.y }, { x: p.x + miter.x * k, y: p.y + miter.y * k }, { x: p.x + o1.x, y: p.y + o1.y }], h0, h1, i2b }
}

/** A polygon as a piece on the grid of its width (checked like a line's output); a known, unhandled case is flagged. */
function polygonPiece(source: InkSource, polygon: readonly Vec[], width: number, known: string | undefined, opts: InkOptions): { piece?: InkPiece; diagnostic: InkDiagnostic } {
  const eps = Math.min(opts.max ?? 0.05, Math.max(opts.min ?? 1e-4, (opts.relative ?? 0.01) * width))
  const maxAbs = Math.max(...polygon.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))
  const s = Math.min(Math.pow(2, Math.floor(Math.log2(2 ** 50 / Math.max(1, maxAbs)))), Math.pow(2, Math.ceil(Math.log2(4 * Math.SQRT2 / eps))))
  const paths = union([polygon.map(p => ({ x: Math.round(p.x * s), y: Math.round(p.y * s) }))], FillRule.NonZero)
  if (!paths.length) return { diagnostic: { source, status: 'fallback', reason: 'the tip is empty' } }
  const piece: InkPiece = { source, loops: paths.map(p => p.map(q => ({ x: q.x / s, y: q.y / s }))), scale: s }, defect = outputDefect(paths)
  if (defect) return { piece, diagnostic: { source, status: 'defect', reason: defect } }
  if (known) return { piece, diagnostic: { source, status: 'defect', reason: known } }
  return { piece, diagnostic: { source, status: 'unproven' } }
}

/**
 * The union of pieces as one outline, on one integer grid: the finest of the pieces' grids (each piece is exact on it —
 * the grids are powers of two), coarsened only if the coordinates would leave the library's range. Checked like a
 * single line's output (§2b); a defect is reported and the union drawn all the same.
 */
export function merge(pieces: readonly InkPiece[]): Omit<InkGroup, 'pieces'> {
  const maxAbs = Math.max(1, ...pieces.flatMap(p => p.loops.flatMap(l => l.map(v => Math.max(Math.abs(v.x), Math.abs(v.y))))))
  const s = Math.min(Math.max(...pieces.map(p => p.scale)), Math.pow(2, Math.floor(Math.log2(2 ** 50 / maxAbs))))
  const out = union(pieces.flatMap(p => p.loops.map(l => l.map(v => ({ x: Math.round(v.x * s), y: Math.round(v.y * s) })))), FillRule.NonZero)
  const loops = out.map(p => p.map(q => ({ x: q.x / s, y: q.y / s }))), defect = out.length ? outputDefect(out) : 'the union is empty'
  return defect ? { loops, status: 'defect', reason: defect } : { loops, status: 'unproven' }
}

/** The ink of a view: every visible line's piece (hidden lines have none — their decoration is drawn from the centre
 *  line), each arc's piece, and the groups the arcs join. */
export function build(geometry: InkInput, snapshot: InkLines, opts: InkOptions = {}): Ink {
  return createInkCache(opts).build(geometry, snapshot)
}

/**
 * A cache of ink, owned by its caller (one per canvas): a piece is rebuilt only when its curve or width changed, a
 * group's union only when one of its pieces did, so an edit rebuilds what it touched and a re-render with nothing
 * changed rebuilds none. Entries for what is gone are dropped on the next build.
 *
 * An arc is inked when either of its lines is visible, at its lines' width ("按圆弧两端对应的原线取宽度", dot
 * 1791802438); where the widths differ, the width eases along the arc from one line's to the other's (`taperedSweep`).
 */
export function createInkCache(opts: InkOptions = {}) {
  const memo = new Map<string, { key: string; piece?: InkPiece; diagnostic: InkDiagnostic }>()
  const groupMemo = new Map<string, InkGroup>()
  return {
    build(geometry: InkInput, snapshot: InkLines): Ink {
      const byId = new Map(snapshot.lines.map(l => [l.id, l] as const)), seen = new Set<string>()
      const pieces: InkPiece[] = [], diagnostics: InkDiagnostic[] = []
      const one = (source: InkSource, curve: Cubic, width: number | readonly [number, number] | Profile, flat: Flat = {}) => {
        const at = JSON.stringify([source.kind, source.id])
        seen.add(at)
        const key = JSON.stringify([curve, width, flat])
        let e = memo.get(at)
        if (!e || e.key !== key) {
          e = { key, ...sweep(source, curve, width, opts, flat) }
          memo.set(at, e)
        }
        if (e.piece) pieces.push(e.piece)
        diagnostics.push(e.diagnostic)
        return e.piece
      }
      // smooth and bound joins between visible lines (Slack 1791804157, dot 1791804198; bound since bowen 1791817201):
      // unequal widths ease through one S-curve centred on the joint (the average there), on each line
      // h(s) = h_i + 2 (h_p − h_i)·σ((1 − s/λ) / 2), s measured from the joint's end (`centred`; bowen 1791817874), λ = half the zone's 限长后长度 when the view's zones are given (default wider² / narrower,
      // manual per view; already ≤ each line's length / 3), else min(3 × the wider full width, each line's length / 3)
      // — the same λ on both sides. The rule enters the line's cache key, so a neighbour's new width or visibility
      // rebuilds this line too. Several such joins at one end: the first rules the easing (all of them join the group).
      const visible = (id: string) => { const l = byId.get(id); return l && l.state.visible ? l : undefined }
      // a line's width at one of its points (two end widths, bowen 1791818995: a at the start, b at the end)
      const wAt = (l: InkLines['lines'][number], point: string) => (l.b === point && l.a !== point ? l.stroke.widthB ?? l.stroke.width : l.stroke.width)
      const curveOf = new Map(geometry.lines.map(g => [g.id, g.curve] as const)), lengthOf = new Map<string, number>()
      const length = (id: string) => lengthOf.get(id) ?? lengthOf.set(id, ((ps: Vec[]) => ps.slice(1).reduce((t, p, i) => t + len(sub(p, ps[i]!)), 0))(flatten(curveOf.get(id)!, 0.01).points)).get(id)!
      const smooth = (snapshot.joins ?? []).filter(j => (j.mode === 'smooth' || j.mode === 'bound') && visible(j.lines[0]) && visible(j.lines[1]) && curveOf.has(j.lines[0]) && curveOf.has(j.lines[1]))
      const ends = new Map<string, { start?: EndEase & { length: number }; end?: EndEase & { length: number } }>()
      for (const j of smooth) {
        const [p, q] = j.lines.map(id => visible(id)!), wp = wAt(p, j.point), wq = wAt(q, j.point), hp = (wp + wq) / 4
        if (wp === wq) continue
        const zone = snapshot.zones?.find(z => z.point === j.point && z.lines[0] === j.lines[0] && z.lines[1] === j.lines[1])
        const lambda = zone ? zone.limited / 2 : Math.min(3 * Math.max(wp, wq), length(p.id) / 3, length(q.id) / 3)
        if (!(lambda > 0)) continue
        for (const l of [p, q]) {
          const at = l.a === j.point ? 'start' : l.b === j.point ? 'end' : undefined, e = ends.get(l.id) ?? {}
          if (at && !e[at]) { e[at] = { joint: hp, length: lambda, centred: true }; ends.set(l.id, e) }
        }
      }
      // cusp joins (dot 1791804679): the tip from `cuspTip`; O3 / straight-on unequal widths ease like a smooth join
      const leaving = (id: string, point: string): { p: Vec; u: Vec } | undefined => {
        const l = visible(id), c = curveOf.get(id)
        if (!l || !c || l.a === l.b) return undefined
        const [o, ...rest] = l.a === point ? [c[0], c[1], c[2], c[3]] : l.b === point ? [c[3], c[2], c[1], c[0]] : []
        if (!o) return undefined
        const q = rest.find(r => len(sub(r!, o)) > 1e-9)
        return q ? { p: o, u: ((v: Vec) => ({ x: v.x / len(v), y: v.y / len(v) }))(sub(q, o)) } : undefined
      }
      const flats = new Map<string, Flat>()
      const tips: { j: NonNullable<InkLines['joins']>[number]; polygon?: Vec[]; width: number; i2b: boolean }[] = []
      const cusps = (snapshot.joins ?? []).filter(j => j.mode === 'cusp' && visible(j.lines[0]) && visible(j.lines[1]))
      for (const j of cusps) {
        const [p, q] = j.lines.map(id => visible(id)!), e0 = leaving(p.id, j.point), e1 = leaving(q.id, j.point)
        if (!e0 || !e1) continue
        const w0 = wAt(p, j.point), w1 = wAt(q, j.point)
        let r = cuspTip(e0.p, { x: -e0.u.x, y: -e0.u.y }, e1.u, w0 / 2, w1 / 2)
        const ease = (joint: number, length: number) => { for (const l of [p, q]) { const at = l.a === j.point ? 'start' : l.b === j.point ? 'end' : undefined, e = ends.get(l.id) ?? {}; if (at && !e[at]) { e[at] = { joint, length }; ends.set(l.id, e) } } }
        if (r.kind === 'ease') {
          const hp = (w0 + w1) / 4
          ease(hp, Math.min(3 * Math.max(w0, w1), length(p.id) / 3, length(q.id) / 3))
          r = cuspTip(e0.p, { x: -e0.u.x, y: -e0.u.y }, e1.u, hp, hp)
        }
        tips.push({ j, polygon: r.kind === 'tip' ? r.polygon : undefined, width: Math.min(w0, w1), i2b: r.kind === 'tip' && r.i2b })
        // J3-min (bowen 1791816534): both ends drawn flat at p, so no round cap shows beside the tip
        for (const l of [p, q]) flats.set(l.id, { ...flats.get(l.id), [l.a === j.point ? 'start' : 'end']: true })
      }
      // free ends taper to a point (bowen 1791853511, dot 1791821792 / 1791821836): an end where exactly one line end lies,
      // counting every line, hidden ones too; length = taper × the end's width (taper absent 3, 0 none), at most half the line
      const endCount = new Map<string, number>()
      for (const l of snapshot.lines) for (const p of [l.a, l.b]) endCount.set(p, (endCount.get(p) ?? 0) + 1)
      const taperOf = new Map((snapshot.points ?? []).map(p => [p.id, p.endStroke?.taper] as const))
      for (const g of geometry.lines) {
        const l = byId.get(g.id)
        if (!l || !l.state.visible) continue
        for (const at of ['start', 'end'] as const) {
          const point = at === 'start' ? l.a : l.b
          if (endCount.get(point) !== 1) continue
          const t = taperOf.get(point), k = typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : 3
          const w = at === 'start' ? l.stroke.width : l.stroke.widthB ?? l.stroke.width, len = Math.min(k * w, length(g.id) / 2)
          const e = ends.get(g.id) ?? {}
          if (len > 0 && !e[at]) { e[at] = { joint: 0, length: len, tip: true }; ends.set(g.id, e) }
        }
      }
      const pieceOf = new Map<string, InkPiece>()
      for (const g of geometry.lines) {
        const l = byId.get(g.id)
        if (!l || !l.state.visible) continue
        const e = ends.get(g.id)
        const wb = l.stroke.widthB ?? l.stroke.width
        const p = one({ kind: 'line', id: g.id }, g.curve, e || wb !== l.stroke.width ? { h: l.stroke.width / 2, ...(wb !== l.stroke.width ? { hEnd: wb / 2 } : {}), ...e } : l.stroke.width, flats.get(g.id))
        if (p) pieceOf.set(g.id, p)
      }
      // groups: the lines an arc or a smooth join joins, through as many joins as connect them (union–find over the pieces)
      const parent = new Map<InkPiece, InkPiece>()
      const find = (p: InkPiece): InkPiece => { const q = parent.get(p) ?? p; if (q === p) return p; const r = find(q); parent.set(p, r); return r }
      const join = (a: InkPiece, b: InkPiece) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
      for (const a of geometry.arcs) {
        // the arc runs from lines[0]'s end to lines[1]'s (derived); a hidden line lends no width — the arc keeps the other's
        const [l0, l1] = a.lines.map(id => byId.get(id)).map(l => l && l.state.visible ? l : undefined)
        if (!l0 && !l1) continue
        // each line's width at the arc's point — the point the arc's two lines share, found from the pair itself
        // whether or not both are visible (dot 1791819678: a hidden side made the visible line's other end count)
        const [m0, m1] = a.lines.map(id => byId.get(id))
        const shared = m0 && m1 ? [m0.a, m0.b].find(x => x === m1.a || x === m1.b) : undefined
        const at = (l: InkLines['lines'][number]) => (shared ? wAt(l, shared) : l.stroke.width)
        const w0 = at((l0 ?? l1)!), w1 = at((l1 ?? l0)!)
        const p = one({ kind: 'arc', id: a.key, lines: [a.lines[0], a.lines[1]] }, a.curve, w0 === w1 ? w0 : [w0, w1])
        if (!p) continue
        for (const id of a.lines) { const q = pieceOf.get(id); if (q) join(p, q) }
      }
      for (const j of smooth) { const p = pieceOf.get(j.lines[0]), q = pieceOf.get(j.lines[1]); if (p && q) join(p, q) }
      for (const t of tips) {
        const p = pieceOf.get(t.j.lines[0]), q = pieceOf.get(t.j.lines[1])
        if (p && q) join(p, q)
        if (!t.polygon) continue
        const source: InkSource = { kind: 'tip', id: 'tip:' + JSON.stringify([t.j.point, t.j.lines[0], t.j.lines[1]]), lines: [t.j.lines[0], t.j.lines[1]] }
        const at = JSON.stringify([source.kind, source.id]), key = JSON.stringify([t.polygon, t.width, t.i2b])
        seen.add(at)
        let e = memo.get(at)
        if (!e || e.key !== key) { e = { key, ...polygonPiece(source, t.polygon, t.width, t.i2b ? 'known, not handled yet (I2b): the wider line\'s end may show past the thinner one near the tip' : undefined, opts) }; memo.set(at, e) }
        diagnostics.push(e.diagnostic)
        if (!e.piece) continue
        pieces.push(e.piece)
        if (p) join(e.piece, p)
        if (q) join(e.piece, q)
      }
      const members = new Map<InkPiece, InkPiece[]>()
      for (const p of pieces) { const r = find(p); (members.get(r) ?? members.set(r, []).get(r)!).push(p) }
      const groups: InkGroup[] = [], live = new Set<string>()
      for (const ps of members.values()) {
        if (ps.length < 2) continue
        const key = JSON.stringify(ps.map(p => [p.source.kind, p.source.id]))
        live.add(key)
        let gr = groupMemo.get(key)
        if (!gr || gr.pieces.length !== ps.length || gr.pieces.some((p, i) => p !== ps[i])) { gr = { pieces: ps, ...merge(ps) }; groupMemo.set(key, gr) }
        groups.push(gr)
      }
      for (const id of [...memo.keys()]) if (!seen.has(id)) memo.delete(id)
      for (const k of [...groupMemo.keys()]) if (!live.has(k)) groupMemo.delete(k)
      return { pieces, diagnostics, groups }
    },
  }
}
