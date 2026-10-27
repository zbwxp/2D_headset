// The birdcage (bowen 1793076475): the VRoid head (no neck) seen from every 15°; its outer outline on the picture, cut at the
// semantic points the way our model cuts it (颅顶 → 太阳穴点 → 颧骨点 → 下巴 on the far side, 下巴 → 耳根 → 颅顶 on the near side) and
// fitted with one cubic Bézier per piece (the picture only, depth ignored); the depth taken only at those points (their true 3D
// depth) and kept straight between them (the strongest smoothing); then put back into 3D. Turn < 0 is the mirror of turn > 0.
// Writes face3d/viewer/vrm-cage.json. Run: npx vite-node face3d/fit/vrm-cage.ts [face3d/fit/ref/test.vrm]
import { readFileSync, writeFileSync } from 'node:fs'
import { cutNeck, loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { type V3, rotate } from '../src/view'

const file = process.argv[2] ?? 'face3d/fit/ref/test.vrm'
const b = readFileSync(file), D = cutNeck(loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
const SK = [...new Set(D.skinTris)].map(i => D.P[i]!)
type V2 = [number, number]

// ---- the anchors (head space, near side x < 0) ----
const crown = SK.reduce((a, p) => (p[1] > a[1] ? p : a))
const chin = SK.filter(p => Math.abs(p[0]) < 0.03 && p[2] > 0.8).reduce((a, p) => (p[1] < a[1] ? p : a))
const E = SK.filter(p => p[0] < -0.92 && p[2] > -0.6 && p[2] < 0.15 && p[1] < 0 && p[1] > -1.1), yLow = Math.min(...E.map(p => p[1]))
const nearRoot = E.filter(p => p[1] < yLow + 0.08).reduce((a, p) => (Math.abs(p[0]) < Math.abs(a[0]) ? p : a))
const midFront = SK.filter(p => Math.abs(p[0]) < 0.03 && p[2] > 0.5), nose = midFront.reduce((a, p) => (p[2] > a[2] && p[1] > -1.1 ? p : a))
const glabellaY = midFront.filter(p => p[1] > nose[1] + 0.3 && p[1] < nose[1] + 0.8).reduce((a, p) => (p[2] > a[2] ? p : a))[1] // 眉心's height
const outermostAt = (y: number) => SK.filter(p => p[0] > 0 && Math.abs(p[1] - y) < 0.05 && p[2] > 0 && p[2] < 0.7).reduce((a, p) => (p[0] > a[0] ? p : a))
const zyg = outermostAt(nearRoot[1]), temple = outermostAt(glabellaY)
const ANCHORS: Record<string, V3> = { crown, temple, zyg, chin, nearRoot }
// the face outline leaves the ears out (they are their own lines in our model): ear triangles are not drawn when tracing
const isEar = (p: V3) => Math.abs(p[0]) > 0.92 && p[2] > -0.6 && p[2] < 0.15 && p[1] < 0 && p[1] > -1.1
const NOEAR = { ...D, parts: D.parts.map(pt => { if (pt.kind !== 'skin') return pt; const tris: number[] = [], cornerN: number[] = []
  for (let i = 0; i < pt.tris.length / 3; i++) { const v = [pt.tris[3 * i]!, pt.tris[3 * i + 1]!, pt.tris[3 * i + 2]!]; if (v.some(k => isEar(D.P[k]!))) continue; tris.push(...v); cornerN.push(...pt.cornerN.slice(9 * i, 9 * i + 9)) }
  return { ...pt, tris, cornerN } }) }
console.log(JSON.stringify(Object.fromEntries(Object.entries(ANCHORS).map(([k, p]) => [k, p.map(v => +v.toFixed(3))]))))

// ---- the outer outline of one view, traced on the picture (Moore neighbour tracing, clockwise on screen) ----
const W = 700, F = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.45 }
function outline(yaw: number, pitch: number): { px: V2[]; depth: number[] } {
  const ras = rasterHead(NOEAR, { yaw, pitch }, F, new Uint8ClampedArray(W * W * 4)), on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < W && ras.zb[y * W + x]! > -Infinity
  let s: V2 | null = null
  for (let y = 0; y < W && !s; y++) for (let x = 0; x < W && !s; x++) if (on(x, y)) s = [x, y]
  const dirs: V2[] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]]
  const px: V2[] = [s!]; let cur = s!, back: V2 = [s![0] - 1, s![1]]
  for (let n = 0; n < 40000; n++) {
    const bi = dirs.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = dirs[(bi + k) % 8]!, c: V2 = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = dirs[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s![0] && cur[1] === s![1])) break
    px.push(cur)
  }
  return { px, depth: px.map(([x, y]) => ras.zb[y * W + x]!) }
}
const toUnits = ([x, y]: V2): V2 => [(x + 0.5 - F.cx) / F.S, (F.cy - (y + 0.5)) / F.S]
/** least-squares cubic through the points at chord-length t, ends fixed */
function fit(q: V2[]): [V2, V2, V2, V2] {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + Math.hypot(q[i]![0] - q[i - 1]![0], q[i]![1] - q[i - 1]![1]))
  const P0 = q[0]!, P3 = q[n]!; let a11 = 0, a12 = 0, a22 = 0; const r1: V2 = [0, 0], r2: V2 = [0, 0]
  for (let i = 0; i <= n; i++) { const t = L[i]! / (L[n]! || 1), u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (const k of [0, 1] as const) { const r = q[i]![k] - b0 * P0[k] - b3 * P3[k]; r1[k] += b1 * r; r2[k] += b2 * r } }
  const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-12) return [P0, [P0[0] + (P3[0] - P0[0]) / 3, P0[1] + (P3[1] - P0[1]) / 3], [P0[0] + (2 * (P3[0] - P0[0])) / 3, P0[1] + (2 * (P3[1] - P0[1])) / 3], P3]
  const P1: V2 = [0, 0], P2: V2 = [0, 0]; for (const k of [0, 1] as const) { P1[k] = (r1[k] * a22 - r2[k] * a12) / det; P2[k] = (a11 * r2[k] - a12 * r1[k]) / det }
  return [P0, P1, P2, P3]
}
const ORDER = ['crown', 'temple', 'zyg', 'chin', 'nearRoot'], NAMES: Record<string, string> = { crown: 'farSkull', temple: 'farCheek', zyg: 'farJaw', chin: 'nearJaw', nearRoot: 'nearSkull' }

function cage(yaw: number, pitch: number) {
  const view = { yaw, pitch }, { px, depth } = outline(yaw, pitch), n = px.length
  const cam = Object.fromEntries(Object.entries(ANCHORS).map(([k, p]) => [k, rotate(p, view)])) as Record<string, V3>
  const near: Record<string, number> = {}
  const idx = (k: string) => { const c = cam[k]!, x = F.cx + c[0] * F.S, y = F.cy - c[1] * F.S; let bi = 0, bd = Infinity; px.forEach((q, i) => { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; bi = i } }); near[k] = Math.sqrt(bd); return bi }
  // depth at a cut: the anchor's own when it sits on the outline (within 4 % of the head's size), else the outline's there
  // (a hidden anchor, e.g. the far 太阳穴点 seen side-on, says nothing about the outline's depth)
  const zAt = (k: string) => { const i = idx(k); return near[k]! < 0.04 * 2 * F.S ? cam[k]![2] : depth[i]! }
  // the cuts in clockwise order from the crown; one that falls out of order (hidden behind the face, say) is left out
  const i0 = idx('crown'), at = (k: string) => (idx(k) - i0 + n) % n, cuts: string[] = ['crown']; let last = 0
  for (const k of ORDER.slice(1)) { const a = at(k); if (a > last) { cuts.push(k); last = a } }
  const curves: { name: string; from: string; to: string; c: number[][] }[] = []
  // ⟨x, y⟩ from the picture; depth only at the cuts (the anchor's own depth), straight between them; back into head space
  const ex = rotate([1, 0, 0], view), ey = rotate([0, 1, 0], view), ez = rotate([0, 0, 1], view), toHead = (c: V3): number[] => [ex, ey, ez].map(e => +(e[0] * c[0] + e[1] * c[1] + e[2] * c[2]).toFixed(4))
  cuts.forEach((k, j) => {
    const k2 = cuts[(j + 1) % cuts.length]!, a = (idx(k) - i0 + n) % n, e = j + 1 < cuts.length ? at(k2) : n
    const arc = Array.from({ length: e - a + 1 }, (_, t) => toUnits(px[(i0 + a + t) % n]!)), c2 = fit(arc), z0 = zAt(k), z1 = zAt(k2)
    curves.push({ name: NAMES[k]!, from: k, to: k2, c: c2.map((p, m) => toHead([p[0], p[1], z0 + ((z1 - z0) * m) / 3])) })
  })
  return { yaw, pitch, curves }
}
const out = [] as ReturnType<typeof cage>[]
for (let pitch = -45; pitch <= 45; pitch += 15) for (let yaw = 0; yaw <= 90; yaw += 15) {
  const c = cage(yaw, pitch); out.push(c)
  if (yaw > 0) out.push({ yaw: -yaw, pitch, curves: c.curves.map(k => ({ ...k, c: k.c.map(p => [-p[0]!, p[1]!, p[2]!]) })) }) // the mirror
}
writeFileSync('face3d/viewer/vrm-cage.json', JSON.stringify({ note: 'birdcage: the VRoid head outline per 15° view, cut at the semantic points, one cubic Bézier per piece, depth straight between the cuts (face3d/fit/vrm-cage.ts, bowen 1793076475)', anchors: ANCHORS, cages: out }))
console.log('views', out.length, 'curves per view', out.map(c => c.curves.length).join(','))
