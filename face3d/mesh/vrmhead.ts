// The VRoid head (bowen's test.vrm) as a renderable head shell: loading (skin cut at the neck, welded for adjacency,
// head space from the cranium ball, the file's own corner normals) and a software raster (depth buffer, per-pixel
// shading) with the mesh-contour preview edges. Shared by the showroom (viewer/shell.ts) and the reference renders
// (fit/vrm-renders.ts). A simplified base-mesh preview, not VRoid's own rendering (dot 1792509945).
import { readGlb } from './glb'
import { type Mesh, toHeadSpace } from './shell'
import { type V3, type View, rotate } from '../src/view'

export interface Part { kind: 'skin' | 'feature'; color: [number, number, number]; tris: number[]; cornerN: number[] }
export function loadVrmHead(buf: ArrayBuffer, NECK = 1.47, normals: 'file' | 'computed' = 'file') {
  const parts = readGlb(buf)
  // one welded vertex list over all parts (VRoid's face and body skins meet at a seam with separate vertices)
  const key = (x: number, y: number, z: number) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`
  const index = new Map<string, number>(), pos: number[] = [], fileN: number[] = [], out: Part[] = []
  const COLORS: [RegExp, [number, number, number]][] = [[/EyeWhite/, [245, 245, 245]], [/EyeIris/, [70, 110, 160]], [/EyeHighlight/, [255, 255, 255]], [/Brow|Eyelash|Eyeline/, [40, 30, 30]], [/Mouth/, [180, 90, 90]]]
  for (const p of parts) {
    const skin = /_SKIN/.test(p.material), color = COLORS.find(([r]) => r.test(p.material))?.[1]
    if (!skin && !color) continue
    const tris: number[] = [], cornerN: number[] = []
    for (let t = 0; t < p.indices.length; t += 3) {
      const vs = [p.indices[t]!, p.indices[t + 1]!, p.indices[t + 2]!]
      if (vs.some(v => p.positions[3 * v + 1]! < NECK)) continue
      for (const v of vs) {
        const k = key(p.positions[3 * v]!, p.positions[3 * v + 1]!, p.positions[3 * v + 2]!)
        let i = index.get(k)
        if (i === undefined) { i = pos.length / 3; index.set(k, i); pos.push(p.positions[3 * v]!, p.positions[3 * v + 1]!, p.positions[3 * v + 2]!); fileN.push(p.normals?.[3 * v] ?? NaN, p.normals?.[3 * v + 1] ?? NaN, p.normals?.[3 * v + 2] ?? NaN) }
        tris.push(i)
        // the corner's own normal from the file (a hard edge keeps its two normals; welding is only for adjacency)
        cornerN.push(p.normals?.[3 * v] ?? NaN, p.normals?.[3 * v + 1] ?? NaN, p.normals?.[3 * v + 2] ?? NaN)
      }
    }
    out.push({ kind: skin ? 'skin' : 'feature', color: color ?? [232, 222, 214], tris, cornerN })
  }
  // head space from the skin only
  const skinTris = out.filter(p => p.kind === 'skin').flatMap(p => p.tris)
  const skinMesh: Mesh = { positions: new Float32Array(pos), indices: new Uint32Array(skinTris) }
  const used = new Set(skinTris), sub = new Float32Array(used.size * 3); let j = 0
  for (const v of used) { sub.set(pos.slice(3 * v, 3 * v + 3), 3 * j); j++ }
  const hs = toHeadSpace({ positions: sub, indices: new Uint32Array() })
  // recover the transform from two points: hs maps p → (p − c) / R
  const v0 = [...used][0]!, v1 = [...used][1]!, a = sub.slice(0, 3), b = sub.slice(3, 6), A = hs.positions.slice(0, 3), B = hs.positions.slice(3, 6)
  const R = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) / Math.hypot(A[0]! - B[0]!, A[1]! - B[1]!, A[2]! - B[2]!), c = [0, 1, 2].map(k => a[k]! - A[k]! * R)
  void v0; void v1; void skinMesh
  const P: V3[] = []
  for (let i = 0; i < pos.length; i += 3) P.push([(pos[i]! - c[0]!) / R, (pos[i + 1]! - c[1]!) / R, (pos[i + 2]! - c[2]!) / R])
  // vertex normals (area-weighted, skin and parts alike) for smooth shading
  const N = P.map(() => [0, 0, 0])
  for (const part of out) for (let t = 0; t < part.tris.length; t += 3) {
    const [i, j, k] = [part.tris[t]!, part.tris[t + 1]!, part.tris[t + 2]!], a = P[i]!, b = P[j]!, c2 = P[k]!
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]], n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
    for (const q of [i, j, k]) for (let d = 0; d < 3; d++) N[q]![d]! += n[d]!
  }
  for (const n of N) { const m = Math.hypot(n[0]!, n[1]!, n[2]!) || 1; n[0]! /= m; n[1]! /= m; n[2]! /= m }
  // the file's own (authored) normals where it has them — VRoid's smoothing, not one recomputed from the triangles
  // (bowen 1792510526: the recomputed shading looked crumpled); rotation and uniform scale leave a normal's direction
  if (normals !== 'computed') N.forEach((n, i) => { if (!Number.isNaN(fileN[3 * i]!)) { n[0] = fileN[3 * i]!; n[1] = fileN[3 * i + 1]!; n[2] = fileN[3 * i + 2]! } })
  // skin edges with their two triangles, for the contour
  const edges = new Map<string, number[]>()
  for (let t = 0; t < skinTris.length; t += 3) for (let e = 0; e < 3; e++) {
    const p0 = skinTris[t + e]!, p1 = skinTris[t + ((e + 1) % 3)]!, k = p0 < p1 ? `${p0},${p1}` : `${p1},${p0}`
    ;(edges.get(k) ?? edges.set(k, []).get(k)!).push(t / 3)
  }
  return { P, N: N as unknown as V3[], parts: out, skinTris, edges: [...edges.entries()].filter(([, ts]) => ts.length === 2).map(([k, ts]) => ({ a: +k.split(',')[0]!, b: +k.split(',')[1]!, t: ts as [number, number] })), ball: { c, R } }
}

export type VrmHead = ReturnType<typeof loadVrmHead>
export interface Frame { W: number; H: number; S: number; cx: number; cy: number }
/** shade the head into an RGBA buffer (background left as given) and return the depth buffer and rotated points */
export function rasterHead(data: VrmHead, view: View, f: Frame, img: Uint8ClampedArray, normals: 'file' | 'computed' = 'file') {
  const { W, H, S, cx, cy } = f, zb = new Float32Array(W * H).fill(-Infinity)
  const r = data.P.map(p => rotate(p, view)), L = [-0.35, 0.55, 0.76], useFile = normals !== 'computed'
  const Nv = data.N.map(n => rotate(n, view))
  const facing = (t: number[], i: number) => { const a = r[t[3 * i]!]!, b = r[t[3 * i + 1]!]!, c = r[t[3 * i + 2]!]!; return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) }
  for (const part of data.parts) {
    const t = part.tris
    for (let i = 0; i < t.length / 3; i++) {
      const a = r[t[3 * i]!]!, b = r[t[3 * i + 1]!]!, c = r[t[3 * i + 2]!]!
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m
      if (part.kind === 'skin' && nz <= 0) continue
      // per-pixel (Phong) shading: the three corner normals interpolated, normalised, then lit — not brightness
      // interpolated between the corners (dot 1792510724); corner normals from the file unless ?normals=computed
      const cn = part.cornerN, ns = [0, 1, 2].map(k => useFile && !Number.isNaN(cn[9 * i + 3 * k]!) ? rotate([cn[9 * i + 3 * k]!, cn[9 * i + 3 * k + 1]!, cn[9 * i + 3 * k + 2]!], view) : Nv[t[3 * i + k]!]!)
      const xs = [cx + a[0] * S, cx + b[0] * S, cx + c[0] * S], ys = [cy - a[1] * S, cy - b[1] * S, cy - c[1] * S], zs = [a[2], b[2], c[2]]
      const area = (xs[1]! - xs[0]!) * (ys[2]! - ys[0]!) - (xs[2]! - xs[0]!) * (ys[1]! - ys[0]!)
      if (Math.abs(area) < 1e-9) continue
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const X = x + 0.5, Y = y + 0.5, w0 = ((xs[1]! - X) * (ys[2]! - Y) - (xs[2]! - X) * (ys[1]! - Y)) / area, w1 = ((xs[2]! - X) * (ys[0]! - Y) - (xs[0]! - X) * (ys[2]! - Y)) / area, w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        // face parts sit just in front of the skin: a small bias so they win the depth test
        const z = w0 * zs[0]! + w1 * zs[1]! + w2 * zs[2]! + (part.kind === 'feature' ? 0.004 : 0), k = y * W + x
        if (z <= zb[k]!) continue
        zb[k] = z; const q = 4 * k
        let shade = 1
        if (part.kind === 'skin') { const n0 = ns[0]!, n1 = ns[1]!, n2 = ns[2]!, qx = w0 * n0[0] + w1 * n1[0] + w2 * n2[0], qy = w0 * n0[1] + w1 * n1[1] + w2 * n2[1], qz = w0 * n0[2] + w1 * n1[2] + w2 * n2[2], qm = Math.hypot(qx, qy, qz) || 1; shade = 0.42 + 0.58 * Math.max(0, (qx * L[0]! + qy * L[1]! + qz * L[2]!) / qm) }
        img[q] = part.color[0] * shade; img[q + 1] = part.color[1] * shade; img[q + 2] = part.color[2] * shade
      }
    }
  }
  return { zb, r, facing }
}
/** the mesh-contour preview segments (screen px): skin edges between a front- and a back-facing triangle, kept where the
 *  depth buffer shows the midpoint (within one pixel) */
export function contourSegments(data: VrmHead, f: Frame, ras: ReturnType<typeof rasterHead>): [number, number, number, number][] {
  const { W, H, S, cx, cy } = f, out: [number, number, number, number][] = []
  for (const e of data.edges) {
    const f0 = ras.facing(data.skinTris, e.t[0]), f1 = ras.facing(data.skinTris, e.t[1])
    if (f0 > 0 === f1 > 0) continue
    const a = ras.r[e.a]!, b = ras.r[e.b]!, mx = cx + ((a[0] + b[0]) / 2) * S, my = cy - ((a[1] + b[1]) / 2) * S, mz = (a[2] + b[2]) / 2
    let vis = false
    for (let dy = -1; dy <= 1 && !vis; dy++) for (let dx = -1; dx <= 1 && !vis; dx++) { const x = Math.round(mx) + dx, y = Math.round(my) + dy; if (x >= 0 && y >= 0 && x < W && y < H && mz >= ras.zb[y * W + x]! - 0.02) vis = true }
    if (vis) out.push([cx + a[0] * S, cy - a[1] * S, cx + b[0] * S, cy - b[1] * S])
  }
  return out
}
