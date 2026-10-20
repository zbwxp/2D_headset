// Minimal showroom for a head shell mesh (bowen 1792509609: "load进一个最小的展示间然后我们看能对它做什么"): bowen's
// VRoid export (fit/ref/test.vrm, a local copy, not committed), the head's skin cut at the neck, put in head space (its
// cranium ball = the unit ball), drawn with a depth buffer and Lambert shading; on it the TRUE contour at this view —
// the skin's edges between a triangle facing the camera and one facing away, kept where the depth buffer shows them —
// and the face parts (eyes, brows, lashes, mouth) as flat colours. Drag to turn (yaw / pitch, same camera as index.html).
import vrmUrl from '../fit/ref/test.vrm?url'
import { readGlb } from '../mesh/glb'
import { type Mesh, toHeadSpace } from '../mesh/shell'
import { type V3, type View, rotate } from '../src/view'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = $('status')

interface Part { kind: 'skin' | 'feature'; color: [number, number, number]; tris: number[]; cornerN: number[] }
async function load() {
  const parts = readGlb(await (await fetch(vrmUrl)).arrayBuffer())
  const NECK = Number(new URLSearchParams(location.search).get('neck') ?? 1.47)
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
  if (new URLSearchParams(location.search).get('normals') !== 'computed') N.forEach((n, i) => { if (!Number.isNaN(fileN[3 * i]!)) { n[0] = fileN[3 * i]!; n[1] = fileN[3 * i + 1]!; n[2] = fileN[3 * i + 2]! } })
  // skin edges with their two triangles, for the contour
  const edges = new Map<string, number[]>()
  for (let t = 0; t < skinTris.length; t += 3) for (let e = 0; e < 3; e++) {
    const p0 = skinTris[t + e]!, p1 = skinTris[t + ((e + 1) % 3)]!, k = p0 < p1 ? `${p0},${p1}` : `${p1},${p0}`
    ;(edges.get(k) ?? edges.set(k, []).get(k)!).push(t / 3)
  }
  return { P, N: N as V3[], parts: out, skinTris, edges: [...edges.entries()].filter(([, ts]) => ts.length === 2).map(([k, ts]) => ({ a: +k.split(',')[0]!, b: +k.split(',')[1]!, t: ts as [number, number] })), ball: { c, R } }
}

const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!
let zoom = Number(new URLSearchParams(location.search).get('zoom') ?? 1), view: View = { yaw: 30, pitch: 0 }, data: Awaited<ReturnType<typeof load>> | undefined, pending = false
function render() {
  pending = false
  if (!data) return
  const W = cv.width, H = cv.height, S = (W / 3.9) * zoom, cx = W / 2, cy = H * 0.4, img = g.createImageData(W, H), zb = new Float32Array(W * H).fill(-Infinity)
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 246; img.data[i + 1] = 246; img.data[i + 2] = 244; img.data[i + 3] = 255 }
  const r = data.P.map(p => rotate(p, view)), L = [-0.35, 0.55, 0.76], useFile = new URLSearchParams(location.search).get('normals') !== 'computed'
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
        img.data[q] = part.color[0] * shade; img.data[q + 1] = part.color[1] * shade; img.data[q + 2] = part.color[2] * shade
      }
    }
  }
  g.putImageData(img, 0, 0)
  // the mesh itself (bowen 1792510580): every skin edge of a triangle facing the camera, kept where the depth buffer
  // shows its midpoint
  if ($<HTMLInputElement>('wire').checked) {
    g.strokeStyle = 'rgba(30,60,140,0.55)'; g.lineWidth = 1; g.beginPath()
    for (const e of data.edges) {
      if (!(facing(data.skinTris, e.t[0]) > 0 || facing(data.skinTris, e.t[1]) > 0)) continue
      const a = r[e.a]!, b = r[e.b]!, x = Math.round(cx + ((a[0] + b[0]) / 2) * S), y = Math.round(cy - ((a[1] + b[1]) / 2) * S)
      if (x < 0 || y < 0 || x >= W || y >= H || (a[2] + b[2]) / 2 < zb[y * W + x]! - 0.01) continue
      g.moveTo(cx + a[0] * S, cy - a[1] * S); g.lineTo(cx + b[0] * S, cy - b[1] * S)
    }
    g.stroke()
  }
  // the true contour: skin edges between a front- and a back-facing triangle, drawn where the depth buffer shows them
  if ($<HTMLInputElement>('contour').checked) {
    g.strokeStyle = '#111'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath()
    for (const e of data.edges) {
      const f0 = facing(data.skinTris, e.t[0]), f1 = facing(data.skinTris, e.t[1])
      if (f0 > 0 === f1 > 0) continue
      const a = r[e.a]!, b = r[e.b]!, mx = cx + ((a[0] + b[0]) / 2) * S, my = cy - ((a[1] + b[1]) / 2) * S, mz = (a[2] + b[2]) / 2
      let vis = false
      for (let dy = -1; dy <= 1 && !vis; dy++) for (let dx = -1; dx <= 1 && !vis; dx++) { const x = Math.round(mx) + dx, y = Math.round(my) + dy; if (x >= 0 && y >= 0 && x < W && y < H && mz >= zb[y * W + x]! - 0.02) vis = true }
      if (!vis) continue
      g.moveTo(cx + a[0] * S, cy - a[1] * S); g.lineTo(cx + b[0] * S, cy - b[1] * S)
    }
    g.stroke()
  }
  g.fillStyle = '#333'; g.font = '26px sans-serif'; g.fillText(`yaw ${view.yaw}° · pitch ${view.pitch}°`, 16, 34)
  $('yv').textContent = `${view.yaw}°`; $('pv').textContent = `${view.pitch}°`
  $<HTMLInputElement>('yaw').value = String(view.yaw); $<HTMLInputElement>('pitch').value = String(view.pitch)
  history.replaceState(null, '', `${location.search}#yaw=${view.yaw}&pitch=${view.pitch}`)
}
const set = (yaw: number, pitch: number) => { view = { yaw: Math.max(-180, Math.min(180, Math.round(yaw))), pitch: Math.max(-80, Math.min(80, Math.round(pitch))) }; if (!pending) { pending = true; requestAnimationFrame(render) } }
const m = /yaw=(-?\d+).*pitch=(-?\d+)/.exec(location.hash); if (m) view = { yaw: +m[1]!, pitch: +m[2]! }
$<HTMLInputElement>('yaw').oninput = e => set(+(e.target as HTMLInputElement).value, view.pitch)
$<HTMLInputElement>('pitch').oninput = e => set(view.yaw, +(e.target as HTMLInputElement).value)
$('contour').onchange = $('wire').onchange = () => set(view.yaw, view.pitch)
let drag: { x: number; y: number; v: View } | undefined
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, v: view }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (drag) { const k = 180 / cv.clientWidth; set(drag.v.yaw + (e.clientX - drag.x) * k, drag.v.pitch - (e.clientY - drag.y) * k) } }
cv.onpointerup = () => { drag = undefined }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0015))); set(view.yaw, view.pitch) }
status.textContent = '正在读 test.vrm…'
load().then(d => { data = d; status.textContent = `test.vrm：${d.P.length} 个顶点，皮肤 ${d.skinTris.length / 3} 个三角面；头球半径 ${d.ball.R.toFixed(3)} m`; render() }).catch(e => { status.textContent = `读取失败：${e}` })
