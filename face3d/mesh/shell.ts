// A head shell given as a triangle mesh (e.g. a VRoid head, bowen 1792509381): put in head space, its outline at a view
// (the projected mesh's outer edge, rasterised like outline.ts `mask`), and a smooth symmetric reshaping fitted to
// bowen's drawn outline (bowen 1792509381: VRoid's sliders cannot make his round face; the overall shape comes from his
// bench outlines, the mesh keeps its local forms).
//   head space: the ball fitted to the cranium (vertices above the brow) → centre 0, radius 1; y up, z to the face
//   reshaping: every vertex scaled radially about the vertical axis by s(y, θ) — a smooth field on a grid of heights
//   and directions, the same on both sides (θ and −θ), so the shell stays symmetric
import { type V3, type View, rotate } from '../src/view'

export interface Mesh { positions: Float32Array; indices: Uint32Array }
export type P2 = [number, number]

/** move / scale a mesh so its cranium ball is the unit ball at the origin (least-squares sphere through the vertices
 *  whose height is in the top fraction `top` of the mesh) */
export function toHeadSpace(m: Mesh, top = 0.35): Mesh {
  const P = m.positions, n = P.length / 3
  let ymin = Infinity, ymax = -Infinity
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, P[3 * i + 1]!); ymax = Math.max(ymax, P[3 * i + 1]!) }
  const cut = ymax - top * (ymax - ymin), pts: V3[] = []
  for (let i = 0; i < n; i++) if (P[3 * i + 1]! >= cut) pts.push([P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!])
  // sphere: x² + y² + z² = 2 a x + 2 b y + 2 c z + d, linear least squares (4 × 4 normal equations)
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]), B = [0, 0, 0, 0]
  for (const [x, y, z] of pts) { const row = [2 * x, 2 * y, 2 * z, 1], r = x * x + y * y + z * z; for (let i = 0; i < 4; i++) { B[i]! += row[i]! * r; for (let j = 0; j < 4; j++) A[i]![j]! += row[i]! * row[j]! } }
  const s = solve4(A, B), c: V3 = [s[0]!, s[1]!, s[2]!], R = Math.sqrt(s[3]! + c[0] * c[0] + c[1] * c[1] + c[2] * c[2])
  const out = new Float32Array(P.length)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[3 * i + k] = (P[3 * i + k]! - c[k]!) / R
  return { positions: out, indices: m.indices }
}
function solve4(A: number[][], b: number[]): number[] {
  const M = A.map((r, i) => [...r, b[i]!])
  for (let i = 0; i < 4; i++) {
    let p = i; for (let r = i + 1; r < 4; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[p]![i]!)) p = r
    ;[M[i], M[p]] = [M[p]!, M[i]!]
    for (let r = 0; r < 4; r++) if (r !== i) { const f = M[r]![i]! / M[i]![i]!; for (let k = i; k < 5; k++) M[r]![k]! -= f * M[i]![k]! }
  }
  return M.map((r, i) => r[4]! / r[i]!)
}

/** the projected mesh's outer edge at a view: boundary pixel centres of its rasterised silhouette (head units) */
export function meshBoundary(m: Mesh, view: View, px = 0.01): P2[] {
  const P = m.positions, n = P.length / 3, x0 = -2.2, y0 = -2.6, w = Math.ceil(4.4 / px), h = Math.ceil(4.8 / px), on = new Uint8Array(w * h)
  const sx = new Float32Array(n), sy = new Float32Array(n)
  for (let i = 0; i < n; i++) { const r = rotate([P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!], view); sx[i] = (r[0] - x0) / px; sy[i] = (r[1] - y0) / px }
  const I = m.indices
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!, xs = [sx[a]!, sx[b]!, sx[c]!], ys = [sy[a]!, sy[b]!, sy[c]!]
    const area = (xs[1]! - xs[0]!) * (ys[2]! - ys[0]!) - (xs[2]! - xs[0]!) * (ys[1]! - ys[0]!)
    if (Math.abs(area) < 1e-12) continue
    const minx = Math.max(0, Math.floor(Math.min(...xs))), maxx = Math.min(w - 1, Math.ceil(Math.max(...xs))), miny = Math.max(0, Math.floor(Math.min(...ys))), maxy = Math.min(h - 1, Math.ceil(Math.max(...ys)))
    for (let yy = miny; yy <= maxy; yy++) for (let xx = minx; xx <= maxx; xx++) {
      const X = xx + 0.5, Y = yy + 0.5, w0 = ((xs[1]! - X) * (ys[2]! - Y) - (xs[2]! - X) * (ys[1]! - Y)) / area, w1 = ((xs[2]! - X) * (ys[0]! - Y) - (xs[0]! - X) * (ys[2]! - Y)) / area
      if (w0 >= -1e-9 && w1 >= -1e-9 && 1 - w0 - w1 >= -1e-9) on[yy * w + xx] = 1
    }
  }
  const f = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && on[y * w + x] === 1, out: P2[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f(x, y) && (!f(x + 1, y) || !f(x - 1, y) || !f(x, y + 1) || !f(x, y - 1))) out.push([x0 + (x + 0.5) * px, y0 + (y + 0.5) * px])
  return out
}

/** the reshaping field: scale factors on a grid of heights YS × directions TH (0 = front … π = back, one side) */
export interface Field { ys: number[]; th: number[]; s: number[][] }
export const identityField = (ys: number[], th: number[]): Field => ({ ys, th, s: ys.map(() => th.map(() => 1)) })
const lerpIn = (xs: number[], x: number) => { if (x <= xs[0]!) return { i: 0, t: 0 }; if (x >= xs[xs.length - 1]!) return { i: xs.length - 2, t: 1 }; let i = 0; while (x > xs[i + 1]!) i++; return { i, t: (x - xs[i]!) / (xs[i + 1]! - xs[i]!) } }
export function scaleAt(F: Field, y: number, theta: number): number {
  const a = lerpIn(F.ys, y), b = lerpIn(F.th, Math.abs(theta))
  // smoothstep weights so the field has no creases at the grid lines
  const sm = (t: number) => t * t * (3 - 2 * t), ta = sm(a.t), tb = sm(b.t), s = F.s
  return (1 - ta) * ((1 - tb) * s[a.i]![b.i]! + tb * s[a.i]![b.i + 1]!) + ta * ((1 - tb) * s[a.i + 1]![b.i]! + tb * s[a.i + 1]![b.i + 1]!)
}
export function reshape(m: Mesh, F: Field): Mesh {
  const P = m.positions, out = new Float32Array(P.length)
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!, k = scaleAt(F, y, Math.atan2(x, z))
    out[i] = x * k; out[i + 1] = y; out[i + 2] = z * k
  }
  return { positions: out, indices: m.indices }
}
