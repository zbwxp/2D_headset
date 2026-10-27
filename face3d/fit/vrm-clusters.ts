// The crossing clusters of the outlines (bowen 1793077048 「眉毛上方有一整圈交点…头顶或者下半脸…交点蔟…提取出来」): every crossing
// between two outlines of different views (vrm-contours.json, outermost only), found where two segments on the skin come within
// a hair of each other; crossings grouped when they lie close together (union of neighbours within R); groups with many
// crossings kept, each as its centre, its size and spread, and which views meet there. Writes face3d/viewer/vrm-clusters.json.
// Run: npx vite-node face3d/fit/vrm-clusters.ts
import { readFileSync, writeFileSync } from 'node:fs'
type V3 = [number, number, number]
const C = JSON.parse(readFileSync('face3d/viewer/vrm-contours.json', 'utf8')) as { contours: { yaw: number; pitch: number; seg: number[]; outer: number[] }[] }
const EPS = 0.01, R = 0.03, MIN = 40
interface Seg { a: V3; b: V3; v: number }
const segs: Seg[] = []
C.contours.forEach((c, v) => { for (let i = 0; i < c.seg.length; i += 6) if (c.outer[i / 6]) segs.push({ a: c.seg.slice(i, i + 3) as V3, b: c.seg.slice(i + 3, i + 6) as V3, v }) })
// spatial hash of the segments
const CELL = 0.05, key = (x: number, y: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`, grid = new Map<string, number[]>()
segs.forEach((s, i) => { const lo = [0, 1, 2].map(k => Math.min(s.a[k]!, s.b[k]!) - EPS), hi = [0, 1, 2].map(k => Math.max(s.a[k]!, s.b[k]!) + EPS)
  for (let x = Math.floor(lo[0]! / CELL); x <= Math.floor(hi[0]! / CELL); x++) for (let y = Math.floor(lo[1]! / CELL); y <= Math.floor(hi[1]! / CELL); y++) for (let z = Math.floor(lo[2]! / CELL); z <= Math.floor(hi[2]! / CELL); z++) { const k = `${x},${y},${z}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i) } })
/** closest points of two segments: the midpoint and the distance */
function closest(s: Seg, t: Seg): [V3, number] | null {
  const d1 = [0, 1, 2].map(k => s.b[k]! - s.a[k]!), d2 = [0, 1, 2].map(k => t.b[k]! - t.a[k]!), r = [0, 1, 2].map(k => s.a[k]! - t.a[k]!)
  const dot = (u: number[], w: number[]) => u[0]! * w[0]! + u[1]! * w[1]! + u[2]! * w[2]!, a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b
  if (a < 1e-12 || e < 1e-12 || Math.abs(den) < 1e-14) return null
  const sp = Math.max(0, Math.min(1, (b * f - c * e) / den)), tp = Math.max(0, Math.min(1, (b * sp + f) / e))
  const p = [0, 1, 2].map(k => s.a[k]! + d1[k]! * sp), q = [0, 1, 2].map(k => t.a[k]! + d2[k]! * tp)
  return [[0, 1, 2].map(k => (p[k]! + q[k]!) / 2) as V3, Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!)]
}
const hits: { p: V3; v: [number, number] }[] = [], seen = new Set<string>()
for (const ids of grid.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const s = segs[ids[i]!]!, t = segs[ids[j]!]!; if (s.v === t.v) continue
  const pk = ids[i]! < ids[j]! ? `${ids[i]},${ids[j]}` : `${ids[j]},${ids[i]}`; if (seen.has(pk)) continue; seen.add(pk)
  const r = closest(s, t); if (r && r[1] < EPS) hits.push({ p: r[0], v: [s.v, t.v] })
}
// the clusters: density peaks (single-link grouping chains everything into a few blobs). Each crossing's density = crossings
// within R; peaks taken densest first, none within 2R of a taken one, at least MIN crossings; a cluster = the crossings within R
// of its peak, its centre their mean
const hk = new Map<string, number[]>(), G = R; hits.forEach((h, i) => { const k = `${Math.floor(h.p[0] / G)},${Math.floor(h.p[1] / G)},${Math.floor(h.p[2] / G)}`; (hk.get(k) ?? hk.set(k, []).get(k)!).push(i) })
const around = (p: V3, r: number) => { const out: number[] = [], cx = Math.floor(p[0] / G), cy = Math.floor(p[1] / G), cz = Math.floor(p[2] / G), m = Math.ceil(r / G)
  for (let x = cx - m; x <= cx + m; x++) for (let y = cy - m; y <= cy + m; y++) for (let z = cz - m; z <= cz + m; z++) for (const j of hk.get(`${x},${y},${z}`) ?? []) { const q = hits[j]!.p; if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < r) out.push(j) }
  return out }
const dens = hits.map(h => around(h.p, R).length), order = hits.map((_, i) => i).sort((x, y) => dens[y]! - dens[x]!), peaks: V3[] = []
for (const i of order) { if (dens[i]! < MIN) break; const p = hits[i]!.p; if (peaks.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 2 * R)) continue; peaks.push(p) }
const clusters = peaks.map(pk => {
  const g = around(pk, R), c = [0, 1, 2].map(k => g.reduce((a, i) => a + hits[i]!.p[k]!, 0) / g.length) as V3
  const spread = Math.sqrt(g.reduce((a, i) => a + (hits[i]!.p[0] - c[0]) ** 2 + (hits[i]!.p[1] - c[1]) ** 2 + (hits[i]!.p[2] - c[2]) ** 2, 0) / g.length)
  const views = new Set(g.flatMap(i => hits[i]!.v)), vs = [...views].map(v => C.contours[v]!)
  const yaws = [...new Set(vs.map(v => v.yaw))].sort((a, b) => a - b), pitches = [...new Set(vs.map(v => v.pitch))].sort((a, b) => a - b)
  return { p: c.map(v => +v.toFixed(4)), n: g.length, spread: +spread.toFixed(4), views: views.size, yaws, pitches }
})
writeFileSync('face3d/viewer/vrm-clusters.json', JSON.stringify({ note: `crossing clusters of the outermost outlines (face3d/fit/vrm-clusters.ts, bowen 1793077048): crossings within ${EPS}, density peaks: ${MIN}+ crossings within ${R}, peaks at least ${2 * R} apart`, crossings: hits.length, clusters }))
console.log('segments', segs.length, 'crossings', hits.length, 'clusters', clusters.length)
for (const c of clusters.slice(0, 40)) console.log(c.n, c.spread, JSON.stringify(c.p), 'yaws', c.yaws.join(' '), '| pitches', c.pitches.join(' '))
