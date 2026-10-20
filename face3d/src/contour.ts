// Contour bones (PLAN §4): per key view, the face contour of each side as three segments chin → jaw angle → cheek →
// temple, found on the head's candidate outline; between key views the corresponding samples are mixed on the surface.
import { CHIN_Y, type Head } from './head'
import { type Loop, type OutlinePoint, candidates, mask, visible } from './outline'
import { type V3, type View, add, len, mirror, rotate, scale, screenAxes, sub } from './view'

export const YAW_KEYS = [0, 30, 60, 90] as const
export const PITCH_KEYS = [-45, -30, 0, 30, 45] as const
/** anchor heights in head space: jaw angle, cheek, temple (the chin is found by nearness) */
export const ANCHOR_Y = [-0.95, -0.55, 0] as const
/** points per segment, both ends included: chin–jaw, jaw–cheek, cheek–temple */
export const COUNTS = [13, 11, 9] as const
/** the face region: sections below the jaw angle belong to the jaw whole (their back half is the jaw's underside);
 *  above it, up to this angle round the section from the front (a rule by depth fails: seen from above, the cheeks'
 *  outline sits behind the ears' depth). */
export const FACE_U = (135 * Math.PI) / 180, JAW_BASE_Y = -0.91
/** the jaw-angle anchor is reached by height or, looking up at the jaw, by spreading this far to the side */
export const JAW_X = 0.55
/** a side's walk must move this far toward its side on screen within TOWARD_LEN of arc (head units) */
export const TOWARD_LEN = 0.08, TOWARD_MIN = 0.01
/** outline loops smaller than this (largest extent, head units) are ignored */
export const MIN_LOOP = 0.15
const inFace = (p: OutlinePoint) => p.y < JAW_BASE_Y || Math.abs(p.u) <= FACE_U

export interface Sample { readonly u: number; readonly y: number }
export interface Segment { readonly present: boolean; readonly samples: Sample[]; readonly vis: boolean[] }
export type Side = 'pos' | 'neg'
export interface KeyContour { readonly view: View; readonly pos: Segment[]; readonly neg: Segment[]; readonly chinLoop: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Resample a polyline of surface points to n points evenly by 3D arc length. */
function resample(head: Head, path: OutlinePoint[], n: number): Sample[] {
  const L = [0]
  for (let i = 1; i < path.length; i++) L.push(L[i - 1]! + len(sub(path[i]!.p, path[i - 1]!.p)))
  const total = L[L.length - 1]!, out: Sample[] = []
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1)
    let i = 1
    while (i < path.length - 1 && L[i]! < s) i++
    const t = L[i]! - L[i - 1]! > 0 ? (s - L[i - 1]!) / (L[i]! - L[i - 1]!) : 0
    out.push({ u: lerp(path[i - 1]!.u, path[i]!.u, t), y: lerp(path[i - 1]!.y, path[i]!.y, t) })
  }
  void head
  return out
}

/** Walk a loop from index i0 in direction dir while inside the face region. */
export function walk(loop: Loop, i0: number, dir: 1 | -1): OutlinePoint[] {
  const n = loop.pts.length, out = [loop.pts[i0]!]
  let i = i0
  for (let step = 0; step < n - 1; step++) {
    let j = i + dir
    if (j < 0 || j >= n) { if (!loop.closed) break; j = (j + n) % n }
    if (j === i0) break
    const q = loop.pts[j]!
    if (!inFace(q)) break
    // u unwrapped along the walk (dot 1792489423): anchors and resampling interpolate u, which must not jump at ±π
    const prev = out[out.length - 1]!
    out.push({ ...q, u: q.u + 2 * Math.PI * Math.round((prev.u - q.u) / (2 * Math.PI)) }); i = j
  }
  return out
}

/** Remove out-and-back spurs on screen: where an outline curve has a cusp it runs out past the visible edge and comes
 *  back (that stretch is behind the surface but grazing, so the depth test can miss it). A later point returning within
 *  SPUR_EPS of an earlier one, after more than 3 × SPUR_EPS and at most SPUR_MAX_ARC of arc in between (a spur is short; a
 *  walk that comes round near its start is not one), cuts that stretch out. Depends only on the
 *  view, so the result is the same however the view was reached. */
export const SPUR_EPS = 0.02, SPUR_MAX_ARC = 0.7
export function pruneSpurs(path: OutlinePoint[], view: View): OutlinePoint[] {
  const P = path.map(q => rotate(q.p, view))
  const keep: number[] = []
  let i = 0
  while (i < path.length) {
    keep.push(i)
    // the furthest later point that comes back next to point i after a long enough excursion
    let jump = -1, arc = 0
    for (let j = i + 1; j < path.length; j++) {
      arc += Math.hypot(P[j]![0] - P[j - 1]![0], P[j]![1] - P[j - 1]![1])
      if (arc > SPUR_MAX_ARC) break
      if (arc > 3 * SPUR_EPS && Math.hypot(P[j]![0] - P[i]![0], P[j]![1] - P[i]![1]) < SPUR_EPS) jump = j
    }
    i = jump > 0 ? jump : i + 1
  }
  return keep.map(k => path[k]!)
}

/** Split a side's walk (starting at the chin) at the first crossing of each anchor height. */
function segmentsOf(head: Head, path: OutlinePoint[], anchors: readonly number[] = ANCHOR_Y, jawFirst = true): (OutlinePoint[] | undefined)[] {
  const segs: (OutlinePoint[] | undefined)[] = []
  let from = 0, start: OutlinePoint = path[0]!
  anchors.forEach((h, n) => {
    if (segs.length < n) return
    const isJaw = jawFirst && n === 0
    // the first point of the walk at this anchor's height (the jaw angle: or spread JAW_X to the side)
    const reached = (q: OutlinePoint) => q.y >= h || (isJaw && Math.abs(q.p[0]) >= JAW_X)
    let k = from + 1
    while (k < path.length && !reached(path[k]!)) k++
    // the jaw angle only: a walk that leaves the face before reaching it ends the chin–jaw segment where it leaves
    // (the near side's jaw line turning under the ear); still the first event on the walk, so still unique
    if (k >= path.length && isJaw && path.length - 1 > from + 3) {
      const end = path[path.length - 1]!
      segs.push([start, ...path.slice(from + 1)]); from = path.length - 1; start = end
      return
    }
    if (k >= path.length) return
    const a = path[k - 1]!, b = path[k]!
    // the crossing between the last point short of it and the first at it
    const t = b.y >= h && b.y !== a.y ? Math.max(0, Math.min(1, (h - a.y) / (b.y - a.y))) : isJaw && Math.abs(b.p[0]) !== Math.abs(a.p[0]) ? Math.max(0, Math.min(1, (JAW_X - Math.abs(a.p[0])) / (Math.abs(b.p[0]) - Math.abs(a.p[0])))) : 1
    const u = lerp(a.u, b.u, t), y = lerp(a.y, b.y, t), cross: OutlinePoint = { u, y, p: head.at(u, y) }
    segs.push([start, ...path.slice(from + 1, k), cross])
    from = k - 1; start = cross
  })
  while (segs.length < anchors.length) segs.push(undefined)
  return segs
}

/** The key contour at a view with yaw ≥ 0, before absent segments are filled (PLAN §4). */
export function traceKey(head: Head, view: View, ref: Partial<Record<Side, V3>> = {}): { pos: (Sample[] | undefined)[]; neg: (Sample[] | undefined)[]; vis: { pos: boolean[][]; neg: boolean[][] }; chinLoop: number } {
  // tiny loops (the rounded chin cap makes a small one of its own) are not face outlines
  const extent = (l: Loop) => { const ps = l.pts.map(q => q.p); return Math.max(...[0, 1, 2].map(k => Math.max(...ps.map(p => p[k]!)) - Math.min(...ps.map(p => p[k]!)))) }
  const loops = candidates(head, view).filter(l => extent(l) >= MIN_LOOP), m = mask(head, view)
  const chin: V3 = head.at(0, CHIN_Y)
  const sides: Record<Side, OutlinePoint[]> = { pos: [], neg: [] }
  let chinLoop = -1
  // sides by the screen: the x+ side is the one on the screen's right for yaw ≥ 0 (the far side once the face turns)
  const sx = (p: V3) => rotate(p, view)[0], chinX = sx(chin)
  for (const s of ['pos', 'neg'] as const) {
    const sg = s === 'pos' ? 1 : -1
    // this side's chin anchor: the candidate point nearest the chin landmark from which a walk moves toward this side
    // on screen (two open chains can end at the chin; the nearest point alone may belong to the other side's chain)
    const near: { l: number; i: number; d: number }[] = []
    // nearest to the neighbouring key's chin anchor when building the key table (branch continuity, a fixed build
    // order — never the viewer's previous frame, dot 1792489303); otherwise to the chin landmark
    const target = ref[s] ?? chin
    loops.forEach((loop, l) => loop.pts.forEach((q, i) => near.push({ l, i, d: len(sub(q.p, target)) })))
    near.sort((a, b) => a.d - b.d)
    // a walk's direction: where it is on screen after a fixed arc length (near the chin the grid is dense, so a fixed
    // count of points barely moves)
    const toward = (w: OutlinePoint[]) => {
      let L = 0, j = 1
      for (; j < w.length && L < TOWARD_LEN; j++) L += len(sub(w[j]!.p, w[j - 1]!.p))
      return L < TOWARD_LEN ? -Infinity : sg * (sx(w[j - 1]!.p) - sx(w[0]!.p))
    }
    const taken = s === 'neg' ? sides.pos : []
    const overlaps = (w: OutlinePoint[]) => taken.length > 0 && w.slice(0, 6).filter(p => taken.some(q => len(sub(p.p, q.p)) < 1e-6)).length >= 3
    for (const c of near.slice(0, 80)) {
      const loop = loops[c.l]!, A = walk(loop, c.i, 1), B = walk(loop, c.i, -1)
      const w = [A, B].filter(x => toward(x) > TOWARD_MIN && !overlaps(x)).sort((x, y) => toward(y) - toward(x))[0]
      if (w) { sides[s] = pruneSpurs(w, view); if (s === 'pos') chinLoop = c.l; break }
    }
  }
  const out = { pos: [] as (Sample[] | undefined)[], neg: [] as (Sample[] | undefined)[], vis: { pos: [] as boolean[][], neg: [] as boolean[][] }, chinLoop }
  for (const s of ['pos', 'neg'] as const) {
    const segs = sides[s].length ? segmentsOf(head, sides[s]) : [undefined, undefined, undefined]
    segs.forEach((seg, i) => {
      const samples = seg && seg.length >= 2 ? resample(head, seg, COUNTS[i]!) : undefined
      out[s].push(samples)
      out.vis[s].push(samples ? samples.map(q => visible(m, head.at(q.u, q.y), view, head.normal(q.u, q.y))) : [])
    })
  }
  return out
}

export interface KeyTable { readonly keys: KeyContour[]; readonly at: (yaw: number, pitch: number) => KeyContour }

/** All key contours for yaw 0 … 90; absent segments take the level key's positions, not visible (PLAN §4). */
/** How the chin–jaw segment is made: traced on each key's outline, or one fixed line on the head (the level key's
 *  chin–jaw outline — the jaw's lower edge as seen from the front) with cheek and temple traced up from its jaw angle.
 *  The fixed one is an alternative under comparison (dot 1792489731), not a decided definition. */
export type JawMode = 'traced' | 'fixed'

/** Cheek and temple segments at a view, traced upward from a fixed jaw-angle point on each side. */
export function traceFromJaw(head: Head, view: View, jaw: Record<Side, Sample>): { pos: (Sample[] | undefined)[]; neg: (Sample[] | undefined)[]; vis: { pos: boolean[][]; neg: boolean[][] } } {
  const extent = (l: Loop) => { const ps = l.pts.map(q => q.p); return Math.max(...[0, 1, 2].map(k => Math.max(...ps.map(p => p[k]!)) - Math.min(...ps.map(p => p[k]!)))) }
  const loops = candidates(head, view).filter(l => extent(l) >= MIN_LOOP), m = mask(head, view)
  const out = { pos: [] as (Sample[] | undefined)[], neg: [] as (Sample[] | undefined)[], vis: { pos: [] as boolean[][], neg: [] as boolean[][] } }
  for (const s of ['pos', 'neg'] as const) {
    const j = jaw[s], jp = head.at(j.u, j.y)
    const near: { l: number; i: number; d: number }[] = []
    loops.forEach((loop, l) => loop.pts.forEach((q, i) => near.push({ l, i, d: len(sub(q.p, jp)) })))
    near.sort((a, b) => a.d - b.d)
    // from the outline point nearest the fixed jaw angle, the walk that climbs (gains height within TOWARD_LEN of arc)
    const climb = (w: OutlinePoint[]) => { let L = 0, k = 1; for (; k < w.length && L < TOWARD_LEN; k++) L += len(sub(w[k]!.p, w[k - 1]!.p)); return L < TOWARD_LEN ? -Infinity : w[k - 1]!.y - w[0]!.y }
    let path: OutlinePoint[] = []
    for (const c of near.slice(0, 40)) {
      const loop = loops[c.l]!, w = [walk(loop, c.i, 1), walk(loop, c.i, -1)].filter(x => climb(x) > 0.005).sort((x, y) => climb(y) - climb(x))[0]
      if (w) { path = pruneSpurs(w, view); break }
    }
    // the segments start at the fixed jaw angle itself (shared anchor); the bridge to the outline is part of segment 1
    const start: OutlinePoint = { u: j.u, y: j.y, p: jp }
    const segs = path.length ? segmentsOf(head, [start, ...path.map(q => ({ ...q, u: q.u + 2 * Math.PI * Math.round((j.u - q.u) / (2 * Math.PI)) }))], ANCHOR_Y.slice(1), false) : [undefined, undefined]
    segs.forEach((seg, i) => {
      const samples = seg && seg.length >= 2 ? resample(head, seg, COUNTS[i + 1]!) : undefined
      out[s].push(samples)
      out.vis[s].push(samples ? samples.map(q => visible(m, head.at(q.u, q.y), view, head.normal(q.u, q.y))) : [])
    })
  }
  return out
}

export function keyTable(head: Head, jawMode: JawMode = 'traced'): KeyTable {
  if (jawMode === 'fixed') return fixedJawTable(head)
  const raw = new Map<string, ReturnType<typeof traceKey>>()
  // fixed build order: the level key from the chin landmark; then up / down the yaw-0 column, each key starting from
  // the previous key's chin anchors; then along each pitch row in yaw. Each key's anchors continue a neighbour's branch.
  const anchorOf = (r: ReturnType<typeof traceKey>): Partial<Record<Side, V3>> => {
    const o: Partial<Record<Side, V3>> = {}
    for (const s of ['pos', 'neg'] as const) { const q = r[s][0]?.[0]; if (q) o[s] = head.at(q.u, q.y) }
    return o
  }
  raw.set('0,0', traceKey(head, { yaw: 0, pitch: 0 }))
  for (const dir of [1, -1]) {
    const col = PITCH_KEYS.filter(p => p * dir > 0).sort((a, b) => Math.abs(a) - Math.abs(b))
    let prev = raw.get('0,0')!
    for (const pitch of col) { prev = traceKey(head, { yaw: 0, pitch }, anchorOf(prev)); raw.set(`0,${pitch}`, prev) }
  }
  for (const pitch of PITCH_KEYS) {
    let prev = raw.get(`0,${pitch}`)!
    for (const yaw of YAW_KEYS.slice(1)) { prev = traceKey(head, { yaw, pitch }, anchorOf(prev)); raw.set(`${yaw},${pitch}`, prev) }
  }
  const level = raw.get('0,0')!
  // an absent segment borrows the level key's (u, y), re-attached so it starts at this key's own previous anchor (dot
  // 1792489423: never a jump between segments): the start difference fades linearly to zero along the segment, so the
  // segment ends at the level's anchor, where the next borrowed segment begins
  const fillSide = (r: ReturnType<typeof traceKey>, s: Side): Segment[] => {
    const out: Segment[] = []
    for (let i = 0; i < 3; i++) {
      const own = r[s][i]
      if (own) { out.push({ present: true, samples: own, vis: r.vis[s][i]! }); continue }
      const lv = level[s][i]
      if (!lv) throw new Error(`level key has no ${s} segment ${i}: the head's front outline is incomplete`)
      const prevEnd = i > 0 ? out[i - 1]!.samples[out[i - 1]!.samples.length - 1]! : undefined
      const du = prevEnd ? prevEnd.u - lv[0]!.u : 0, dy = prevEnd ? prevEnd.y - lv[0]!.y : 0
      const n = lv.length - 1
      out.push({ present: false, samples: lv.map((q, k) => ({ u: q.u + du * (1 - k / n), y: q.y + dy * (1 - k / n) })), vis: lv.map(() => false) })
    }
    return out
  }
  // yaw 0 keys are symmetric views of a symmetric head: the x− side is the x+ side mirrored (u → −u), so tracing noise
  // cannot make the two sides differ there
  for (const pitch of PITCH_KEYS) {
    const r = raw.get(`0,${pitch}`)!
    raw.set(`0,${pitch}`, { ...r, neg: r.pos.map(sg => sg?.map(q => ({ u: -q.u, y: q.y }))), vis: { pos: r.vis.pos, neg: r.vis.pos.map(v => [...v]) } })
  }
  const keys: KeyContour[] = []
  for (const yaw of YAW_KEYS) for (const pitch of PITCH_KEYS) {
    const r = raw.get(`${yaw},${pitch}`)!
    keys.push({ view: { yaw, pitch }, pos: fillSide(r, 'pos'), neg: fillSide(r, 'neg'), chinLoop: r.chinLoop })
  }
  return { keys, at: (yaw, pitch) => keys.find(k => k.view.yaw === yaw && k.view.pitch === pitch)! }
}

function fixedJawTable(head: Head): KeyTable {
  const level = keyTable(head, 'traced').at(0, 0)
  const keys: KeyContour[] = []
  for (const yaw of YAW_KEYS) for (const pitch of PITCH_KEYS) {
    const view = { yaw, pitch }, m = mask(head, view)
    const jawSeg = (s: Side) => level[s][0]!.samples
    const jawEnd = (s: Side) => jawSeg(s)[jawSeg(s).length - 1]!
    const up = traceFromJaw(head, view, { pos: jawEnd('pos'), neg: jawEnd('neg') })
    const side = (s: Side): Segment[] => {
      const fixed = jawSeg(s)
      const segs: Segment[] = [{ present: true, samples: fixed, vis: fixed.map(q => visible(m, head.at(q.u, q.y), view, head.normal(q.u, q.y))) }]
      for (let i = 0; i < 2; i++) {
        const own = up[s][i]
        if (own) { segs.push({ present: true, samples: own, vis: up.vis[s][i]! }); continue }
        const lv = level[s][i + 1]!.samples, prevEnd = segs[i]!.samples[segs[i]!.samples.length - 1]!
        const du = prevEnd.u - lv[0]!.u, dy = prevEnd.y - lv[0]!.y, n = lv.length - 1
        segs.push({ present: false, samples: lv.map((q, k) => ({ u: q.u + du * (1 - k / n), y: q.y + dy * (1 - k / n) })), vis: lv.map(() => false) })
      }
      return segs
    }
    keys.push({ view, pos: side('pos'), neg: side('neg'), chinLoop: -1 })
  }
  return { keys, at: (yaw, pitch) => keys.find(k => k.view.yaw === yaw && k.view.pitch === pitch)! }
}

/** Offsets per key / side / segment / sample, in that key's picture plane (F2; zero now). */
export type Offsets = Map<string, [number, number]>
export const offsetKey = (yaw: number, pitch: number, side: Side, seg: number, i: number) => `${yaw},${pitch},${side},${seg},${i}`

/** Bilinear weights over the key grid for yaw in [0, 90], pitch clamped to the key range. */
export function weights(yaw: number, pitch: number): { yaw: number; pitch: number; w: number }[] {
  const bracket = (ks: readonly number[], x: number) => {
    const v = Math.min(ks[ks.length - 1]!, Math.max(ks[0]!, x))
    let i = 0
    while (i < ks.length - 2 && v > ks[i + 1]!) i++
    const t = (v - ks[i]!) / (ks[i + 1]! - ks[i]!)
    return [[ks[i]!, 1 - t], [ks[i + 1]!, t]] as const
  }
  const out: { yaw: number; pitch: number; w: number }[] = []
  for (const [y, wy] of bracket(YAW_KEYS, yaw)) for (const [p, wp] of bracket(PITCH_KEYS, pitch)) if (wy * wp > 0) out.push({ yaw: y, pitch: p, w: wy * wp })
  return out
}

export interface ContourLine { readonly side: Side; readonly pts: V3[]; readonly vis: number[]; readonly anchors: number[] }

/** The face contour at any view: corresponding samples of the surrounding keys mixed on the surface (PLAN §4). */
export function mixContour(head: Head, table: KeyTable, view: View, offsets: Offsets = new Map()): ContourLine[] {
  const flip = view.yaw < 0, yaw = Math.abs(view.yaw)
  const W = weights(yaw, view.pitch)
  const lines: ContourLine[] = []
  for (const side of ['pos', 'neg'] as const) {
    const pts: V3[] = [], vis: number[] = [], anchors: number[] = []
    for (let seg = 0; seg < 3; seg++) {
      for (let i = seg === 0 ? 0 : 1; i < COUNTS[seg]!; i++) {
        // mixed on the head's surface: the samples' (u, y) are mixed and the point evaluated on the current head, so an
        // in-between line lies on the head instead of cutting through it; offsets (F2) are added in 3D after
        let u = 0, y = 0, v = 0, off: V3 = [0, 0, 0], u0: number | undefined
        for (const { yaw: ky, pitch: kp, w } of W) {
          const key = table.at(ky, kp), s = key[side][seg]!, q = s.samples[i]!
          // unwrap u against the first key's (under the jaw, samples near the mid line sit at u ≈ ±π)
          u0 ??= q.u
          const uq = q.u + 2 * Math.PI * Math.round((u0 - q.u) / (2 * Math.PI))
          u += w * uq; y += w * q.y; v += w * (s.vis[i] ? 1 : 0)
          const o = offsets.get(offsetKey(ky, kp, side, seg, i))
          if (o) { const ax = screenAxes(key.view); off = add(off, scale(add(scale(ax.right, o[0]), scale(ax.up, o[1])), w)) }
        }
        const p = add(head.at(u, y), off)
        pts.push(flip ? mirror(p) : p); vis.push(v)
      }
      anchors.push(pts.length - 1)
    }
    lines.push({ side: flip ? (side === 'pos' ? 'neg' : 'pos') : side, pts, vis, anchors })
  }
  return lines
}
