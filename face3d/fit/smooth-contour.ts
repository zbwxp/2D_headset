// The outline straight from the model's surface (bowen 1793202978 「这个轮廓线从3D模型上就是难以优雅地获得…你任何办法想想吧」): not
// traced on a picture but found on the mesh, the way cartoon line renderers do — each vertex gets g = (its smooth normal) · (the
// direction to the eye); the outline is where g = 0, found on every edge whose two ends have opposite signs (at the point where
// g, taken linearly along the edge, is 0) and joined triangle by triangle into lines. A line on the head itself (3D), moving
// smoothly as the view turns; which parts show is then a depth test. (The method as remembered from Hertzmann & Zorin 2000,
// "Illustrating smooth surfaces"; not checked against the paper here.) Drawing glue, browser-safe.
import { type V3, type View, rotate, toCamera } from '../src/view'

type M3 = [number, number, number]
export interface Surf { P: V3[]; N: V3[]; tris: number[] }
/** the surface to outline: positions, triangles (counter-clockwise from outside), and smooth vertex normals (area-weighted face
 * normals, then `smooth` rounds of averaging with the neighbours — a coarse mesh's normals jump from vertex to vertex) */
export function surface(P: readonly (readonly number[])[], tris: readonly number[], smooth = 0): Surf {
  const used = [...new Set(tris)], map = new Map(used.map((v, i) => [v, i])), Q = used.map(v => [P[v]![0]!, P[v]![1]!, P[v]![2]!] as V3), T = tris.map(v => map.get(v)!)
  let N: M3[] = Q.map(() => [0, 0, 0])
  for (let i = 0; i < T.length; i += 3) { const a = Q[T[i]!]!, b = Q[T[i + 1]!]!, c = Q[T[i + 2]!]!, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n: V3 = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]; for (const k of [0, 1, 2]) { const m = N[T[i + k]!]!; m[0] += n[0]; m[1] += n[1]; m[2] += n[2] } }
  const nb = Q.map(() => new Set<number>()); for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { nb[T[i + k]!]!.add(T[i + ((k + 1) % 3)]!); nb[T[i + ((k + 1) % 3)]!]!.add(T[i + k]!) }
  const unit = (n: M3): M3 => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l] }
  N = N.map(unit)
  for (let r = 0; r < smooth; r++) N = N.map((n, i) => { const s: M3 = [n[0], n[1], n[2]]; for (const j of nb[i]!) { s[0] += N[j]![0]; s[1] += N[j]![1]; s[2] += N[j]![2] } return unit(s) })
  return { P: Q, N, tris: T }
}
/** the outline at a view: lines of points on the head (3D), each from one end to the other (closed when it comes round), each
 * point with the surface's normal there */
export function outlineLines(S: Surf, v: View): { p: V3; n: V3 }[][] {
  const d = toCamera(v), g = S.N.map(n => n[0] * d[0] + n[1] * d[1] + n[2] * d[2])
  const key = (a: number, b: number) => (a < b ? a * 1e6 + b : b * 1e6 + a)
  const at = new Map<number, { p: V3; n: V3 }>(), cross = (a: number, b: number) => { const k = key(a, b); if (!at.has(k)) { const t = g[a]! / (g[a]! - g[b]!), A = S.P[a]!, B = S.P[b]!, NA = S.N[a]!, NB = S.N[b]!
    at.set(k, { p: [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], n: [NA[0] + (NB[0] - NA[0]) * t, NA[1] + (NB[1] - NA[1]) * t, NA[2] + (NB[2] - NA[2]) * t] }) } return k }
  // each triangle the outline passes through gives one piece, from one crossed edge to the other
  const link = new Map<number, number[]>()
  for (let i = 0; i < S.tris.length; i += 3) { const v3 = [S.tris[i]!, S.tris[i + 1]!, S.tris[i + 2]!], e: number[] = []
    for (let k = 0; k < 3; k++) { const a = v3[k]!, b = v3[(k + 1) % 3]!; if ((g[a]! > 0) !== (g[b]! > 0)) e.push(cross(a, b)) }
    if (e.length === 2) for (const [x, y] of [[e[0]!, e[1]!], [e[1]!, e[0]!]]) (link.get(x!) ?? link.set(x!, []).get(x!)!).push(y!) }
  const seen = new Set<number>(), lines: { p: V3; n: V3 }[][] = []
  for (const s of link.keys()) { if (seen.has(s)) continue
    // walk both ways from s
    const walk = (from: number, first: number) => { const out: number[] = []; let prev = from, cur: number | undefined = first; while (cur !== undefined && !seen.has(cur)) { seen.add(cur); out.push(cur); const nx: number | undefined = link.get(cur)!.find(x => x !== prev && !seen.has(x)); prev = cur; cur = nx } return out }
    seen.add(s); const nb = link.get(s)!, a = nb[0] !== undefined ? walk(s, nb[0]) : [], b = nb[1] !== undefined ? walk(s, nb[1]) : []
    lines.push([...b.reverse(), s, ...a].map(k => at.get(k)!)) }
  return lines
}
/** whether a point of the outline shows: taken a little off the surface along its normal (outward — on the outline that is
 * sideways on the screen, off the head's edge), nothing in the depth buffer there is in front of it (right at the edge the
 * depth changes too fast from pixel to pixel to test the point itself) */
export function shows(q: { p: V3; n: V3 }, v: View, zb: Float32Array, f: { W: number; H: number; S: number; cx: number; cy: number }, off = 0.025, tol = 0.02) {
  const l = Math.hypot(q.n[0], q.n[1], q.n[2]) || 1, r = rotate([q.p[0] + (q.n[0] / l) * off, q.p[1] + (q.n[1] / l) * off, q.p[2] + (q.n[2] / l) * off], v), i = Math.floor(f.cx + r[0] * f.S), j = Math.floor(f.cy - r[1] * f.S)
  if (i < 0 || j < 0 || i >= f.W || j >= f.H) return true
  return r[2] >= zb[j * f.W + i]! - tol
}
