// Outlines of the rough head at a view (PLAN §4).
// Candidates: loops where the surface normal is perpendicular to the view direction, traced on the (u, y) grid.
// Visible: the head projected to a depth buffer of fixed resolution in head units (dot 1792488325: never tied to the
// window); a candidate point is visible when nothing of the head lies in front of it there. Not "on the outer
// boundary": looking up from below, the jaw's outline sits inside the skull's outer edge yet is the line one draws.
import { type Head } from './head'
import { type V3, type View, dot, norm, rotate, toCamera } from './view'

export interface OutlinePoint { readonly u: number; readonly y: number; readonly p: V3 }
export interface Grid { readonly nu: number; readonly ny: number }
export const GRID: Grid = { nu: 240, ny: 160 }
/** mask pixel size in head units (R = 1) */
export const MASK_PX = 0.01

const TAU = Math.PI * 2
const uOf = (i: number, nu: number) => -Math.PI + (i / nu) * TAU
// rows uniform in a polar angle from crown to chin (dense at both poles): where an outline skims past a pole the
// pole fans are then tiny, so their linear interpolation does not misplace it (dot 1792491357)
const yOf = (j: number, ny: number, head: Head) => head.shape.yMax - ((1 - Math.cos((Math.PI * (j + 0.5)) / ny)) / 2) * (head.shape.yMax - head.shape.yMin)

/** Candidate outline loops (open polylines when they reach the grid's top or bottom row). */
export function candidates(head: Head, view: View, grid: Grid = GRID): Loop[] {
  const { nu, ny } = grid, d = toCamera(view)
  const g: number[][] = []
  for (let j = 0; j < ny; j++) { const row: number[] = []; for (let i = 0; i < nu; i++) row.push(dot(head.normal(uOf(i, nu), yOf(j, ny, head)), d)); g.push(row) }
  // marching squares: one crossing point per grid edge with a sign change, keyed by the edge
  const pt = new Map<string, OutlinePoint>()
  const edge = (i0: number, j0: number, i1: number, j1: number): string | undefined => {
    const a = g[j0]![((i0 % nu) + nu) % nu]!, b = g[j1]![((i1 % nu) + nu) % nu]!
    if ((a < 0) === (b < 0)) return undefined
    const key = i0 === i1 ? `v${((i0 % nu) + nu) % nu},${j0}` : `h${((Math.min(i0, i1) % nu) + nu) % nu},${j0}`
    if (!pt.has(key)) {
      const t = a / (a - b), u = uOf(i0, nu) + (uOf(i1, nu) - uOf(i0, nu)) * t, y = yOf(j0, ny, head) + (yOf(j1, ny, head) - yOf(j0, ny, head)) * t
      const uu = ((u + Math.PI) % TAU + TAU) % TAU - Math.PI
      pt.set(key, { u: uu, y, p: head.at(uu, y) })
    }
    return key
  }
  const links = new Map<string, string[]>()
  const link = (a: string, b: string) => { links.set(a, [...(links.get(a) ?? []), b]); links.set(b, [...(links.get(b) ?? []), a]) }
  // the poles (dot 1792490943): the grid stops half a row short of the crown and of the chin, so an outline passing
  // over a pole used to leave the grid there as two open ends. Each pole closes its ring of cells with a fan of
  // triangles meeting at the pole point; marching triangles through the fan connects the outline across the pole by
  // the sign of n · d — never by how close two ends are. The pole's normal is the mean of the normals round it.
  const fan = (row: number, yPole: number, tag: string) => {
    // the pole's normal: the mean of the unit normals round it, normalised (dot 1792491357: unnormalised, its n · d grew
    // with the number of cells round the ring and shifted every spoke crossing). On a smooth tip this is the tip's
    // normal; where the tip is a corner (the default head's chin, see poles.test.ts) it is a convention.
    let nm: V3 = [0, 0, 0]
    for (let i = 0; i < nu; i++) { const n = head.normal(uOf(i, nu), yPole); nm = [nm[0] + n[0], nm[1] + n[1], nm[2] + n[2]] }
    const gp = dot(norm(nm), d), yr = yOf(row, ny, head)
    const spoke = (i: number): string | undefined => {
      const ii = ((i % nu) + nu) % nu, a = g[row]![ii]!
      if ((a < 0) === (gp < 0)) return undefined
      const key = `s${tag}${ii}`
      if (!pt.has(key)) { const t = a / (a - gp), u = uOf(ii, nu), y = yr + (yPole - yr) * t; pt.set(key, { u, y, p: head.at(u, y) }) }
      return key
    }
    for (let i = 0; i < nu; i++) {
      const e = [edge(i, row, i + 1, row), spoke(i + 1), spoke(i)].filter((k): k is string => !!k)
      if (e.length === 2) link(e[0]!, e[1]!)
    }
  }
  fan(0, head.shape.yMax, 't')
  fan(ny - 1, head.shape.yMin, 'b')
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nu; i++) {
    const e = [edge(i, j, i + 1, j), edge(i + 1, j, i + 1, j + 1), edge(i, j + 1, i + 1, j + 1), edge(i, j, i, j + 1)].filter((k): k is string => !!k)
    if (e.length === 2) link(e[0]!, e[1]!)
    else if (e.length === 4) { // saddle: decide by the cell centre
      const c = (g[j]![i]! + g[j]![(i + 1) % nu]! + g[j + 1]![i]! + g[j + 1]![(i + 1) % nu]!) / 4
      if ((c < 0) === (g[j]![i]! < 0)) { link(e[0]!, e[1]!); link(e[2]!, e[3]!) } else { link(e[0]!, e[3]!); link(e[1]!, e[2]!) }
    }
  }
  // chains: open ones start at a degree-1 node; what is left are closed loops
  const seen = new Set<string>(), loops: Loop[] = []
  const collect = (start: string) => {
    const chain: string[] = []
    let cur: string | undefined = start, p: string | undefined
    while (cur && !seen.has(cur)) { seen.add(cur); chain.push(cur); const nx: string | undefined = (links.get(cur) ?? []).find(k => k !== p && !seen.has(k)); p = cur; cur = nx }
    const closed = chain.length > 2 && (links.get(chain[chain.length - 1]!) ?? []).includes(chain[0]!)
    if (chain.length > 2) loops.push({ pts: chain.map(k => pt.get(k)!), closed })
  }
  for (const [k, n] of links) if (n.length === 1 && !seen.has(k)) collect(k)
  for (const k of links.keys()) if (!seen.has(k)) collect(k)
  return loops
}
export interface Loop { readonly pts: OutlinePoint[]; readonly closed: boolean }

export interface Mask { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number; readonly px: number; readonly on: Uint8Array; readonly depth: Float32Array }

/** The head projected at this view, rasterised at MASK_PX per pixel (screen coordinates in head units, y up). */
export function mask(head: Head, view: View, grid: Grid = { nu: 120, ny: 90 }): Mask {
  const { nu, ny } = grid, px = MASK_PX
  const P: [number, number, number][][] = []
  for (let j = 0; j <= ny; j++) {
    const y = head.shape.yMax - (j / ny) * (head.shape.yMax - head.shape.yMin), row: [number, number, number][] = []
    for (let i = 0; i < nu; i++) { const r = rotate(head.at(uOf(i, nu), y), view); row.push([r[0], r[1], r[2]]) }
    P.push(row)
  }
  const x0 = -2, y0 = -2.2, w = Math.ceil(4 / px), h = Math.ceil(4 / px), on = new Uint8Array(w * h), depth = new Float32Array(w * h).fill(-Infinity)
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    const xs = [a, b, c].map(q => (q[0] - x0) / px), ys = [a, b, c].map(q => (q[1] - y0) / px)
    const minx = Math.max(0, Math.floor(Math.min(...xs))), maxx = Math.min(w - 1, Math.ceil(Math.max(...xs)))
    const miny = Math.max(0, Math.floor(Math.min(...ys))), maxy = Math.min(h - 1, Math.ceil(Math.max(...ys)))
    const area = (xs[1]! - xs[0]!) * (ys[2]! - ys[0]!) - (xs[2]! - xs[0]!) * (ys[1]! - ys[0]!)
    if (Math.abs(area) < 1e-12) return
    for (let yy = miny; yy <= maxy; yy++) for (let xx = minx; xx <= maxx; xx++) {
      const X = xx + 0.5, Y = yy + 0.5
      const w0 = ((xs[1]! - X) * (ys[2]! - Y) - (xs[2]! - X) * (ys[1]! - Y)) / area
      const w1 = ((xs[2]! - X) * (ys[0]! - Y) - (xs[0]! - X) * (ys[2]! - Y)) / area
      if (w0 >= -1e-9 && w1 >= -1e-9 && 1 - w0 - w1 >= -1e-9) {
        const z = w0 * a[2] + w1 * b[2] + (1 - w0 - w1) * c[2], k = yy * w + xx
        on[k] = 1; if (z > depth[k]!) depth[k] = z
      }
    }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nu; i++) {
    const a = P[j]![i]!, b = P[j]![(i + 1) % nu]!, c = P[j + 1]![i]!, d = P[j + 1]![(i + 1) % nu]!
    tri(a, b, d); tri(a, d, c)
  }
  return { x0, y0, w, h, px, on, depth }
}

/** depth tolerance in head units: the buffer is built from a coarser grid than the candidates */
export const DEPTH_EPS = 0.03

/** Is this outline point visible at this view? An outline point sits on the edge of its own surface in the buffer, so
 *  it is tested a little outward along its surface normal (OUTWARD): visible unless something nearer covers that spot. */
export const OUTWARD = 0.02
export function visible(m: Mask, p: V3, view: View, n: V3): boolean {
  const q: V3 = [p[0] + n[0] * OUTWARD, p[1] + n[1] * OUTWARD, p[2] + n[2] * OUTWARD]
  const r = rotate(q, view), cx = Math.floor((r[0] - m.x0) / m.px), cy = Math.floor((r[1] - m.y0) / m.px)
  if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || !m.on[cy * m.w + cx]) return true
  return m.depth[cy * m.w + cx]! <= r[2] + DEPTH_EPS
}

const filled = (m: Mask, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.on[y * m.w + x] === 1
const boundaryPx = (m: Mask, x: number, y: number) => filled(m, x, y) && (!filled(m, x + 1, y) || !filled(m, x - 1, y) || !filled(m, x, y + 1) || !filled(m, x, y - 1))

/** Is this head point on the visible outer boundary at this view (within one mask pixel)? */
export function onBoundary(m: Mask, p: V3, view: View): boolean {
  const r = rotate(p, view), cx = Math.floor((r[0] - m.x0) / m.px), cy = Math.floor((r[1] - m.y0) / m.px)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (boundaryPx(m, cx + dx, cy + dy)) return true
  return false
}

/** The visible outer boundary as screen points (head units): boundary pixel centres, for drawing the comparison. */
export function boundaryPoints(m: Mask): [number, number][] {
  const out: [number, number][] = []
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (boundaryPx(m, x, y)) out.push([m.x0 + (x + 0.5) * m.px, m.y0 + (y + 0.5) * m.px])
  return out
}

// ---- occlusion on a fine mesh, continuous screen coordinates (dot 1792490326) -----------------------------------------
// The depth buffer above is coarse (120 × 90, pixel-quantised, tested 0.02 R outward): at the jaw's folds it called
// hidden points visible (diag-spur). Here a point is hidden when a triangle of a fine mesh covers its exact screen
// position with depth nearer than the point's by more than OCC_TOL. Triangles within OCC_OWN grid cells of the point on
// the surface are its own neighbourhood and are skipped: at a grazing angle a facet of the surface itself can sit a
// little in front of a point on the true outline. Still a discrete approximation (mesh + tolerance), checked against a
// finer mesh in the tests.
export const OCC_GRID: Grid = { nu: 360, ny: 240 }
export const OCC_TOL = 0.002, OCC_CELL = 0.02, OCC_OWN = 2
export interface Occluder { readonly view: View; readonly nu: number; readonly ny: number; readonly yMax: number; readonly yMin: number; readonly cells: Map<number, number[]>; readonly tri: Float64Array; readonly ij: Int32Array; readonly rowA: Float64Array }

export function occluder(head: Head, view: View, grid: Grid = OCC_GRID): Occluder {
  const { nu, ny } = grid, yMax = head.shape.yMax, yMin = head.shape.yMin
  const V: V3[] = []
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nu; i++) V.push(rotate(head.at(uOf(i, nu), yMax - (j / ny) * (yMax - yMin)), view))
  const at = (i: number, j: number) => V[j * nu + (((i % nu) + nu) % nu)]!
  const n = nu * ny * 2, tri = new Float64Array(n * 9), ij = new Int32Array(n * 2), cells = new Map<number, number[]>()
  let t = 0
  const key = (cx: number, cy: number) => cx * 100003 + cy
  const add = (a: V3, b: V3, c: V3, i: number, j: number) => {
    tri.set([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]], t * 9); ij[t * 2] = i; ij[t * 2 + 1] = j
    const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / OCC_CELL), x1 = Math.floor(Math.max(a[0], b[0], c[0]) / OCC_CELL)
    const y0 = Math.floor(Math.min(a[1], b[1], c[1]) / OCC_CELL), y1 = Math.floor(Math.max(a[1], b[1], c[1]) / OCC_CELL)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const k = key(cx, cy); const l = cells.get(k); if (l) l.push(t); else cells.set(k, [t]) }
    t++
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nu; i++) { const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1); add(a, b, d, i, j); add(a, d, c, i, j) }
  const rowA = new Float64Array(ny + 1)
  for (let j = 0; j <= ny; j++) rowA[j] = head.section(yMax - (j / ny) * (yMax - yMin)).a
  return { view, nu, ny, yMax, yMin, cells, tri, ij, rowA }
}

/** Is the head point at surface parameters (u, y) hidden behind another part of the head at this occluder's view? */
export function hiddenOn(o: Occluder, p: V3, u: number, y: number): boolean {
  const r = rotate(p, o.view), k = Math.floor(r[0] / OCC_CELL) * 100003 + Math.floor(r[1] / OCC_CELL)
  const pi = ((u + Math.PI) / (2 * Math.PI)) * o.nu, pj = ((o.yMax - y) / (o.yMax - o.yMin)) * o.ny
  for (const t of o.cells.get(k) ?? []) {
    const ti = o.ij[t * 2]!, tj = o.ij[t * 2 + 1]!
    // own neighbourhood: OCC_OWN cells in height; round the section, the same physical distance — near the chin pole a
    // section is tiny, so there the whole ring of angles is next to the point
    const di = Math.abs(((ti + 0.5 - pi) % o.nu + o.nu * 1.5) % o.nu - o.nu / 2)
    const a = o.rowA[Math.min(o.ny, Math.max(0, Math.round(pj)))]!
    if (Math.abs(tj + 0.5 - pj) <= OCC_OWN + 0.5 && di * Math.max(a, 1e-3) <= OCC_OWN + 0.5) continue
    const b = t * 9, ax = o.tri[b]!, ay = o.tri[b + 1]!, bx = o.tri[b + 3]!, by = o.tri[b + 4]!, cx = o.tri[b + 6]!, cy = o.tri[b + 7]!
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(det) < 1e-14) continue
    const w1 = ((r[0] - ax) * (cy - ay) - (cx - ax) * (r[1] - ay)) / det, w2 = ((bx - ax) * (r[1] - ay) - (r[0] - ax) * (by - ay)) / det
    if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue
    const z = o.tri[b + 2]! * (1 - w1 - w2) + o.tri[b + 5]! * w1 + o.tri[b + 8]! * w2
    if (z > r[2] + OCC_TOL) return true
  }
  return false
}
