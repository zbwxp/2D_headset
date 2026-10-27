// The outline from bowen's head wire at any angle (bowen 1793114785 「你把现在这一套给我开个html让我能任意角度拖拽观察」): the
// nets of face3d/fit/shell-outline.ts (exported to shell-nets.json) evaluated live — on every rail its tangent points (its
// bulges toward each screen side), one outline line per tangent point down the columns, the outer one on each side shown and
// the covered parts faint; the ears, jawline and eyelids drawn where VRoid's head does not hide them (the depth buffer); the
// wire and the automatic lines on the head. Drawing glue only.
import vrmUrl from '../fit/ref/test.vrm?url'
import data from './shell-nets.json'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate, toCamera } from '../src/view'

type P3 = [number, number, number]
type Chain = P3[]
interface NetJ { name: string; kind: number; top: P3 | null; bottom: P3 | 'free' | null; cols: (Chain | null)[][]; rails: { name: string; pieces: { from: number; c: Chain }[] }[] }
const D = data as unknown as { nets: NetJ[]; tnets: NetJ[]; cap: { c: P3; r: P3 }; ring: P3[]; fitLines: { name: string; noTan: boolean; c: P3[] }[]; autos: { name: string; c: Chain }[]; detail: { name: string; c: P3[] }[]; wire: { name: string; c: P3[] }[] }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const on = (id: string) => $<HTMLInputElement>(id).checked
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
gl.getExtension('OES_element_index_uint')
let yaw = 35, pitch = 10, zoom = 1

// ---- geometry helpers ----
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mix = (a: P3, b: P3, f: number): P3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], len = (v: P3) => Math.hypot(v[0], v[1], v[2])
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const sample = (c: P3[], n = 40): Chain => Array.from({ length: n + 1 }, (_, i) => cubic(c, i / n))
const LENS = new WeakMap<Chain, number[]>()
const lens = (c: Chain) => { let L = LENS.get(c); if (!L) { L = [0]; for (let i = 1; i < c.length; i++) L.push(L[i - 1]! + len(sub(c[i]!, c[i - 1]!))); LENS.set(c, L) } return L }
function at(c: Chain, u: number): P3 { const L = lens(c), s = u * L[L.length - 1]!; let i = 1; while (i < L.length - 1 && L[i]! < s) i++; const f = (s - L[i - 1]!) / ((L[i]! - L[i - 1]!) || 1); return mix(c[i - 1]!, c[i]!, Math.max(0, Math.min(1, f))) }

// ---- the outline (as in face3d/fit/shell-outline.ts) ----
function tangents(r: NetJ['rails'][number], X: (p: P3) => number) {
  const s: { p: P3; g: number; x: number }[] = []
  for (const pc of r.pieces) { const L = lens(pc.c), tot = L[L.length - 1]!; pc.c.forEach((p, i) => { if (s.length && i === 0) return; s.push({ p, g: pc.from + L[i]! / (tot || 1), x: X(p) }) }) }
  const Wn = 3, peaks = s.map((q, i) => ({ q, i })).filter(({ q, i }) => { for (let j = Math.max(0, i - Wn); j <= Math.min(s.length - 1, i + Wn); j++) if (j !== i && s[j]!.x > q.x) return false; return true })
  const keep = peaks.filter(({ q, i }) => peaks.every(o => { if (o.i === i || o.q.x <= q.x) return true; const [a, c] = o.i < i ? [o.i, i] : [i, o.i]; let dip = Infinity; for (let j = a; j <= c; j++) dip = Math.min(dip, s[j]!.x); return q.x - dip > 0.01 }))
  return keep.filter(({ i }, k) => k === 0 || i - keep[k - 1]!.i > Wn).map(({ q }) => q)
}
const unit = (v: P3): P3 => { const m = len(v) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
/** two shell points mixed round the head's centre on the skull, straight lower down (as in shell-outline.ts) */
function mixRound(a: P3, b: P3, w: number): P3 {
  const lowY = Math.min(a[1], b[1]), k = Math.max(0, Math.min(1, (lowY + 0.8) / 0.4)), straight = mix(a, b, w) // round on the skull, straight lower, eased
  if (k <= 0) return straight
  const c: P3 = [0, -0.3, 0], da = sub(a, c), db = sub(b, c), ra = len(da), rb = len(db); if (ra < 1e-6 || rb < 1e-6) return mix(a, b, w)
  const ua = unit(da), ub = unit(db), om = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2])))
  const u: P3 = om < 1e-4 ? mix(ua, ub, w) : ([0, 1, 2].map(k => (Math.sin((1 - w) * om) * ua[k]! + Math.sin(w * om) * ub[k]!) / Math.sin(om)) as P3)
  const r = ra + (rb - ra) * w, p = add(c, [u[0] * r, u[1] * r, u[2] * r]); return k >= 1 ? p : mix(straight, p, k * k * (3 - 2 * k))
}
function outlines(net: NetJ, d: readonly [number, number], v: { yaw: number; pitch: number }) {
  const X = (p: P3) => { const q = rotate(p, v); return d[0] * q[0] + d[1] * q[1] }, tan = net.rails.map(r => tangents(r, X))
  const n = Math.max(...tan.map(t => t.length)), lines: { tan: { p: P3 }[]; pts: P3[] }[] = []
  for (let bI = 0; bI < n; bI++) {
    const pick = tan.map(t => t[Math.min(bI, t.length - 1)]!)
    const ends: { p: P3 | null; g: number }[] = [...(net.top ? [{ p: net.top, g: pick[0]!.g }] : []), ...pick, ...(net.bottom ? [{ p: net.bottom === 'free' ? null : net.bottom, g: pick[pick.length - 1]!.g }] : [])]
    let pts: P3[] = []
    for (let k = 0; k < ends.length - 1; k++) {
      const top = ends[k]!, bot = ends[k + 1]!, have = net.cols.map((c, i) => (c[k] ? i : -1)).filter(i => i >= 0), lo = Math.min(...have), hi = Math.max(...have)
      // a stretch whose ends sit beyond the columns it has (a tangent point far down one line, the next line not reaching
      // that far: bowen 1793117610 「转45 俯60 的后脑绿色线为什么会飞出去」) is not bridged: the line stops there
      // nor a stretch whose two tangent points sit more than one cell apart across the lines (bowen 1793117971 「转90 仰30 的鼻子
      // 那部分支出去的绿线…我没有网是这样的」: a point low on the side-face line joined to one high on the next line cut across
      // the face, mixed out of lines that are not there)
      if (!have.length || top.g < lo - 0.01 || top.g > hi + 0.01 || bot.g < lo - 0.01 || bot.g > hi + 0.01 || Math.abs(top.g - bot.g) > 1.001) { if (pts.length > 1) lines.push({ tan: pick, pts }); pts = []; continue }
      const base = (u: number) => { const g = Math.max(lo, Math.min(hi, top.g + (bot.g - top.g) * u)), i0 = Math.max(...have.filter(i => i <= g)), i1 = Math.min(...have.filter(i => i >= g)), w = i1 === i0 ? 0 : (g - i0) / (i1 - i0)
        return w <= 0 ? at(net.cols[i0]![k]!, u) : mixRound(at(net.cols[i0]![k]!, u), at(net.cols[i1]![k]!, u), w) }
      const dTop: P3 = top.p ? sub(top.p, base(0)) : [0, 0, 0], dBot: P3 = bot.p ? sub(bot.p, base(1)) : [0, 0, 0]
      for (let j = pts.length ? 1 : 0; j <= 40; j++) { const u = j / 40; pts.push(add(base(u), add(mix([0, 0, 0], dTop, 1 - u), mix([0, 0, 0], dBot, u)))) }
    }
    if (pts.length > 1) lines.push({ tan: pick, pts })
  }
  return lines
}

// ---- the cap above the forehead ring: one ellipsoid, its outline the exact ellipse, the part above the ring ----
const az = (p: readonly number[]) => Math.atan2(p[0]!, p[2]!)
const ringAt = (p: readonly number[]) => { const a = az(p); let best = D.ring[0]!, bd = Infinity; for (const q of D.ring) { let d = Math.abs(az(q) - a); if (d > Math.PI) d = 2 * Math.PI - d; if (d < bd) { bd = d; best = q } } return best[1] }
function capOutline(v: { yaw: number; pitch: number }): P3[][] {
  const { c, r } = D.cap, d = toCamera(v), du = unit([d[0] * r[0], d[1] * r[1], d[2] * r[2]])
  const t: P3 = Math.abs(du[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], e1 = unit([du[1] * t[2] - du[2] * t[1], du[2] * t[0] - du[0] * t[2], du[0] * t[1] - du[1] * t[0]]), e2: P3 = [du[1] * e1[2] - du[2] * e1[1], du[2] * e1[0] - du[0] * e1[2], du[0] * e1[1] - du[1] * e1[0]]
  const ring = Array.from({ length: 181 }, (_, i) => { const a = (i * Math.PI) / 90; return [0, 1, 2].map(k => c[k]! + (Math.cos(a) * e1[k]! + Math.sin(a) * e2[k]!) * r[k]!) as P3 })
  const runs: P3[][] = []; let cur: P3[] = []
  for (const p of ring) { if (p[1] >= ringAt(p)) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = [] } }
  if (cur.length > 1) { if (runs.length && ring[0]![1] >= ringAt(ring[0]!)) runs[0] = [...cur, ...runs[0]!]; else runs.push(cur) }
  return runs
}
const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const)
// ---- the outline fitted to tangent points (as in face3d/fit/shell-outline.ts fitOutline; bowen 1793119514): one tangent point
// per line — the middle of its stretch on the outer edge of all the lines — and as few smooth cubics through them as fit,
// from one end of the cap's ellipse round to the other; open at the neck's cut ----
const FW = 400, FS = FW / 3.4, FCX = FW / 2, FCY = FW * 0.42, CLOSE = 0.1, TOL = 0.012
function outerEdge(pts: number[][]) {
  const G = FW, R = CLOSE * FS, dil = new Uint8Array(G * G)
  for (const q of pts) { const x = FCX + q[0]! * FS, y = FCY - q[1]! * FS; for (let j = Math.max(0, Math.floor(y - R)); j <= Math.min(G - 1, Math.ceil(y + R)); j++) for (let i = Math.max(0, Math.floor(x - R)); i <= Math.min(G - 1, Math.ceil(x + R)); i++) if ((i - x) ** 2 + (j - y) ** 2 <= R * R) dil[j * G + i] = 1 }
  const dist = new Float32Array(G * G).fill(1e9)
  for (let k = 0; k < G * G; k++) if (!dil[k]) dist[k] = 0
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const k = j * G + i; if (i > 0) dist[k] = Math.min(dist[k]!, dist[k - 1]! + 1); if (j > 0) dist[k] = Math.min(dist[k]!, dist[k - G]! + 1); if (i > 0 && j > 0) dist[k] = Math.min(dist[k]!, dist[k - G - 1]! + 1.414); if (i < G - 1 && j > 0) dist[k] = Math.min(dist[k]!, dist[k - G + 1]! + 1.414) }
  for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--) { const k = j * G + i; if (i < G - 1) dist[k] = Math.min(dist[k]!, dist[k + 1]! + 1); if (j < G - 1) dist[k] = Math.min(dist[k]!, dist[k + G]! + 1); if (i < G - 1 && j < G - 1) dist[k] = Math.min(dist[k]!, dist[k + G + 1]! + 1.414); if (i > 0 && j < G - 1) dist[k] = Math.min(dist[k]!, dist[k + G - 1]! + 1.414) }
  const inS = (i: number, j: number) => i >= 0 && j >= 0 && i < G && j < G && dist[j * G + i]! >= R - 0.5
  let s0: [number, number] | null = null
  for (let j = 0; j < G && !s0; j++) for (let i = 0; i < G && !s0; i++) if (inS(i, j)) s0 = [i, j]
  if (!s0) return []
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0]
  for (let cur = s0, back: [number, number] = [s0[0] - 1, s0[1]], n = 0; n < 20000; n++) {
    const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (inS(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0[0] && cur[1] === s0[1])) break; cells.push(cur) }
  return cells.map(([i, j]) => [(i + 0.5 - FCX) / FS, (FCY - (j + 0.5)) / FS])
}
const nrm2 = (v: number[]) => { const m = Math.hypot(v[0]!, v[1]!) || 1; return [v[0]! / m, v[1]! / m] }
const t2 = (a: number[], b: number[]) => nrm2([b[0]! - a[0]!, b[1]! - a[1]!])
const cub2 = (c: number[][], t: number) => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1].map(k => w.reduce((s2, wi, j) => s2 + wi * c[j]![k]!, 0)) }
function fitTan(q: number[][], ta: number[], tb: number[]): number[][] {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + Math.hypot(q[i]![0]! - q[i - 1]![0]!, q[i]![1]! - q[i - 1]![1]!))
  const P0 = q[0]!, P3_ = q[n]!, chord = Math.hypot(P3_[0]! - P0[0]!, P3_[1]! - P0[1]!); let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0
  for (let i = 0; i <= n; i++) { const t = L[i]! / (L[n]! || 1), u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t
    const A1 = [ta[0]! * b1, ta[1]! * b1], A2 = [tb[0]! * b2, tb[1]! * b2], r = [q[i]![0]! - (b0 + b1) * P0[0]! - (b2 + b3) * P3_[0]!, q[i]![1]! - (b0 + b1) * P0[1]! - (b2 + b3) * P3_[1]!]
    c00 += A1[0]! ** 2 + A1[1]! ** 2; c01 += A1[0]! * A2[0]! + A1[1]! * A2[1]!; c11 += A2[0]! ** 2 + A2[1]! ** 2; x0 += A1[0]! * r[0]! + A1[1]! * r[1]!; x1 += A2[0]! * r[0]! + A2[1]! * r[1]! }
  const det = c00 * c11 - c01 * c01; let a1 = det ? (x0 * c11 - x1 * c01) / det : chord / 3, a2 = det ? (c00 * x1 - c01 * x0) / det : chord / 3
  if (!(a1 > chord * 0.02) || !(a2 > chord * 0.02) || a1 > chord * 1.5 || a2 > chord * 1.5) { a1 = chord / 3; a2 = chord / 3 }
  return [P0, [P0[0]! + ta[0]! * a1, P0[1]! + ta[1]! * a1], [P3_[0]! + tb[0]! * a2, P3_[1]! + tb[1]! * a2], P3_]
}
function fitRun(pts: number[][], tans: number[][], i: number, j: number, out: number[][][]) {
  const seg = pts.slice(i, j + 1), c = fitTan(seg, tans[i]!, tans[j]!.map(v => -v))
  const S = Array.from({ length: 81 }, (_, k) => cub2(c, k / 80)), err = seg.map(p => Math.min(...S.map(q => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!))))
  const w = err.reduce((m, e, k) => (k > 0 && k < seg.length - 1 && e > err[m]! ? k : m), 1)
  if (j - i >= 2 && err[w]! > TOL) { fitRun(pts, tans, i, i + w, out); fitRun(pts, tans, i + w, j, out) } else out.push(c)
}
function fitOutline(v: { yaw: number; pitch: number }) {
  const Ls = D.fitLines.map(l => ({ ...l, q: l.c.map(p => rotate(p, v) as unknown as number[]) }))
  const capQ = on('cap') ? capOutline(v).map(r => r.map(p => rotate(p, v) as unknown as number[])) : []
  const edge = outerEdge([...Ls.flatMap(L => L.q), ...capQ.flat()]), nE = edge.length
  const near = (q: number[]) => { let bi = 0, bd = Infinity; for (let i = 0; i < nE; i++) { const d = (edge[i]![0]! - q[0]!) ** 2 + (edge[i]![1]! - q[1]!) ** 2; if (d < bd) { bd = d; bi = i } } return { i: bi, d: Math.sqrt(bd) } }
  const EPS = 2.5 / FS, cutAt = new Uint8Array(nE)
  for (const L of Ls) if (L.noTan) for (const q of L.q) { const n = near(q); if (n.d < EPS * 1.6) cutAt[n.i] = 1 }
  const tan: { q: number[]; at: number }[] = []
  for (const L of Ls) { if (L.noTan) continue; let best: [number, number] | null = null, s0 = -1
    const hit = L.q.map((q, i) => { const n = near(q); return n.d < EPS && !(capQ.length && L.c[i]![1] >= ringAt(L.c[i]!)) ? n.i : -1 })
    for (let i = 0; i <= L.q.length; i++) { const e = i < L.q.length && hit[i]! >= 0; if (e && s0 < 0) s0 = i; if (!e && s0 >= 0) { if (!best || i - 1 - s0 > best[1] - best[0]) best = [s0, i - 1]; s0 = -1 } }
    if (best) { const m = Math.round((best[0] + best[1]) / 2); tan.push({ q: L.q[m]!, at: hit[m]! }) } }
  for (let i = tan.length - 1; i >= 0; i--) if (tan.some((t, j) => j < i && Math.hypot(t.q[0]! - tan[i]!.q[0]!, t.q[1]! - tan[i]!.q[1]!) < 0.01)) tan.splice(i, 1)
  const cap = capQ.slice().sort((a, b) => b.length - a.length)[0], pieces: number[][][] = []
  let seq: number[][] = [], tans: number[][] = [], ats: number[] = []
  if (cap && cap.length > 2 && nE > 10) {
    const iA = near(cap[cap.length - 1]!).i, iB = near(cap[0]!).i, iM = near(cap[Math.floor(cap.length / 2)]!).i
    const fwd = (x: number) => ((x - iA) % nE + nE) % nE, capFwd = fwd(iM) < fwd(iB)
    const startEnd = capFwd ? cap[0]! : cap[cap.length - 1]!, startIdx = capFwd ? iB : iA, stopEnd = capFwd ? cap[cap.length - 1]! : cap[0]!, stopIdx = capFwd ? iA : iB
    const span = ((stopIdx - startIdx) % nE + nE) % nE, key = (i: number) => ((i - startIdx) % nE + nE) % nE
    const midT = tan.filter(t => key(t.at) > 2 && key(t.at) < span - 2).sort((a, b) => key(a.at) - key(b.at))
    const tStart = capFwd ? t2(cap[1]!, cap[0]!) : t2(cap[cap.length - 2]!, cap[cap.length - 1]!), tStop = capFwd ? t2(cap[cap.length - 1]!, cap[cap.length - 2]!) : t2(cap[0]!, cap[1]!)
    seq = [startEnd, ...midT.map(t => t.q), stopEnd]; tans = seq.map((_, i) => (i === 0 ? tStart : i === seq.length - 1 ? tStop.map(x => -x) : t2(seq[i - 1]!, seq[i + 1]!)))
    ats = [startIdx, ...midT.map(t => t.at), stopIdx]
  } else { const st = tan.slice().sort((a, b) => a.at - b.at); seq = st.map(t => t.q); ats = st.map(t => t.at); tans = seq.map((_, i) => t2(seq[Math.max(0, i - 1)]!, seq[Math.min(seq.length - 1, i + 1)]!)) }
  const cuts: number[] = []; for (let k = 0; k + 1 < ats.length; k++) { for (let x = ats[k]!; ((x - ats[k + 1]!) % nE + nE) % nE !== 0; x = (x + 1) % nE) if (cutAt[x]) { cuts.push(k); break } }
  if (seq.length >= 2) { let i0 = 0; for (const k of [...cuts, seq.length - 1]) { if (k > i0) { if (cuts.includes(k)) tans[k] = t2(seq[k - 1]!, seq[k]!); if (cuts.includes(i0 - 1)) tans[i0] = t2(seq[i0]!, seq[i0 + 1]!); fitRun(seq, tans, i0, k, pieces) } i0 = k + 1 } }
  return { pieces, tan: tan.map(t => t.q), cap: capQ }
}
// ---- the face side's outline below the cap, by bowen's rule (1793121297 「yaw 0 度时靠耳朵到下巴那根脸轮廓0度时候的投影，yaw
// 30度时太阳穴，颧骨那根线在30度时候的投影。在0-30度之间是这两个角度的线的加权混合」): two chains of his lines from the forehead
// ring to 下巴 — the face contour (交点2 → 上耳根 → 下耳根 → 下巴) and the 太阳穴·颧骨 line (交点1 → 太阳穴 → 颧骨 → 下巴) — piece
// for piece (交点2↔交点1, 上耳根↔太阳穴, 下耳根↔颧骨), the cubics' control points mixed by the turn / 30°; the face side only
// (screen right for a turn > 0, both sides facing front) ----
const wireByName = (n: string) => D.wire.find(l => l.name === n)!.c
/** pieces joined end to start, each turned the way that joins */
function chainOf(names: string[]): P3[][] {
  const cs = names.map(n => wireByName(n).map(p => [...p] as P3)), d = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const first = cs[0]!, second = cs[1]!; if (Math.min(d(first[0]!, second[0]!), d(first[0]!, second[3]!)) < Math.min(d(first[3]!, second[0]!), d(first[3]!, second[3]!))) first.reverse()
  for (let i = 1; i < cs.length; i++) if (d(cs[i]![3]!, cs[i - 1]![3]!) < d(cs[i]![0]!, cs[i - 1]![3]!)) cs[i]!.reverse()
  return cs
}
const RULE = ([1, -1] as const).map(side => { const pre = side > 0 ? '右' : ''; return { side, contour: chainOf([`${pre}线5前`, `${pre}线2`, `${pre}线4`]), temple: chainOf([`${pre}线2后`, `${pre}线1`, `${pre}线3`]) } })
/** the rule's line for this turn on one side, or null outside 0–30° toward that side */
function ruleLine(side: 1 | -1, turn: number): P3[][] | null {
  const t = side * turn; if (t < -1e-9 || t > 30 + 1e-9) return null
  const w = t / 30, r = RULE.find(x => x.side === side)!
  return r.contour.map((c, i) => c.map((p, k) => [0, 1, 2].map(j => p[j]! + (r.temple[i]![k]![j]! - p[j]!) * w) as P3))
}
const EARS = D.detail.filter(l => /耳/.test(l.name)).map(l => sample(l.c, 60))

// ---- camera: head space → clip ----
const S0 = 0.42, CY = 0.2, aspect = () => cv.height / cv.width
const clip = (p: P3): P3 => { const q = rotate(p, { yaw, pitch }), s = S0 * zoom; return [q[0] * s * aspect(), q[1] * s + CY, -q[2] * 0.3] }
function matrix(): Float32Array {
  const ex = rotate([1, 0, 0], { yaw, pitch }), ey = rotate([0, 1, 0], { yaw, pitch }), ez = rotate([0, 0, 1], { yaw, pitch }), s = S0 * zoom, a = aspect()
  return new Float32Array([ex[0] * s * a, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s * a, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s * a, ez[1] * s, -ez[2] * 0.3, 0, 0, CY, 0, 1])
}

// ---- GL ----
function program(vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!); gl.attachShader(p, s) }
  gl.linkProgram(p); return p
}
const meshProg = program(`attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ gl_Position = m * vec4(p, 1.0); vn = (m * vec4(n, 0.0)).xyz; }`,
  `precision mediump float; varying vec3 vn; void main(){ vec3 N = normalize(vec3(vn.xy, -vn.z)); float l = 0.45 + 0.55 * max(0.0, dot(N, normalize(vec3(-0.35, 0.55, 0.76)))); gl_FragColor = vec4(vec3(0.88, 0.87, 0.85) * l, 1.0); }`)
// thick lines: triangles already in clip space, a colour with alpha
const stripProg = program(`attribute vec3 p; attribute vec4 c; varying vec4 vc; void main(){ gl_Position = vec4(p.xy, p.z - 0.004, 1.0); gl_PointSize = 8.0; vc = c; }`,
  `precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }`)
const buf = (arr: Float32Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
let mesh: { pos: WebGLBuffer; nor: WebGLBuffer; idx: WebGLBuffer; n: number } | undefined
const pb = gl.createBuffer()!, cb = gl.createBuffer()!
/** a polyline (head space) as a band px wide on the screen: triangles in clip space */
function band(pts: P3[], px: number, rgba: number[], P: number[], C: number[]) {
  const cs = pts.map(clip), wx = (px / cv.width) * window.devicePixelRatio, wy = (px / cv.height) * window.devicePixelRatio
  for (let i = 0; i + 1 < cs.length; i++) { const a = cs[i]!, b = cs[i + 1]!, dx = (b[0] - a[0]) / wx, dy = (b[1] - a[1]) / wy, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * wx, ny = (dx / l) * wy
    const q = [[a[0] + nx, a[1] + ny, a[2]], [a[0] - nx, a[1] - ny, a[2]], [b[0] + nx, b[1] + ny, b[2]], [b[0] - nx, b[1] - ny, b[2]]]
    for (const k of [0, 1, 2, 1, 3, 2]) { P.push(...q[k]!); C.push(...rgba) } }
}
function drawTris(P: number[], C: number[], mode: number = gl.TRIANGLES) {
  if (!P.length) return; gl.useProgram(stripProg)
  const ap = gl.getAttribLocation(stripProg, 'p'), ac = gl.getAttribLocation(stripProg, 'c')
  gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(C), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 0, 0)
  gl.drawArrays(mode, 0, P.length / 3)
}
const WIRE = D.wire.map(l => sample(l.c, 48)), INNER = D.detail.map(l => sample(l.c, 60))
const COLORS = [[0.075, 0.63, 0.35], [0.48, 0.25, 0.71], [0.77, 0.48, 0], [0.11, 0.24, 0.56], [0.82, 0.2, 0.17]]

function draw() {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr)
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
  $('view').textContent = `转 ${Math.round(yaw)}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(Math.round(pitch))}°`
  gl.viewport(0, 0, W, H); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  // the head: drawn, or only into the depth buffer (it still hides the inner lines)
  if (mesh) { gl.colorMask(on('head'), on('head'), on('head'), on('head')); gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, matrix())
    const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx); gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_INT, 0); gl.disableVertexAttribArray(an); gl.colorMask(true, true, true, true) }
  // the inner lines, hidden where the head is in front (the depth test)
  if (on('inner')) { const P: number[] = [], C: number[] = []; for (const c of INNER) band(c, 2.2, [0.11, 0.24, 0.56, 1], P, C); drawTris(P, C) }
  // the wire and the automatic lines on the head (seen through it when the head is off)
  if (!on('head')) gl.clear(gl.DEPTH_BUFFER_BIT)
  { const P: number[] = [], C: number[] = []
    if (on('wire')) for (const c of WIRE) band(c, 1.1, [0.85, 0.5, 0.5, 0.9], P, C)
    if (on('autos')) for (const a of D.autos) band(a.c, 1.1, [0.85, 0.5, 0.5, 0.4], P, C)
    drawTris(P, C) }
  // the outline: every net, both screen sides; per side the outer line shows, the covered parts faint
  gl.disable(gl.DEPTH_TEST)
  if (on('outline') && on('rule')) { // bowen's rule for the face side, 0–30°, and the cap
    const v = { yaw, pitch }, P: number[] = [], C: number[] = []
    for (const side of [1, -1] as const) { const L = ruleLine(side, yaw); if (L) for (const c of L) band(sample(c, 40), 3, [...COLORS[0]!, 1], P, C) }
    for (const r of capOutline(v)) band(r, 3, [...COLORS[4]!, 1], P, C)
    drawTris(P, C)
  }
  if (on('outline') && !on('oldnet') && !on('rule')) {
    const v = { yaw, pitch }, fo = fitOutline(v), s = S0 * zoom, a = aspect(), P: number[] = [], C: number[] = [], T: number[] = [], TC: number[] = []
    const toClip = (q: number[]) => [q[0]! * s * a, q[1]! * s + CY, 0]
    const band2 = (q: number[][], px: number, rgba: number[]) => { const cs = q.map(toClip), wx = (px / cv.width) * window.devicePixelRatio, wy = (px / cv.height) * window.devicePixelRatio
      for (let i = 0; i + 1 < cs.length; i++) { const p0 = cs[i]!, p1 = cs[i + 1]!, dx = (p1[0]! - p0[0]!) / wx, dy = (p1[1]! - p0[1]!) / wy, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * wx, ny = (dx / l) * wy
        const qq = [[p0[0]! + nx, p0[1]! + ny, 0], [p0[0]! - nx, p0[1]! - ny, 0], [p1[0]! + nx, p1[1]! + ny, 0], [p1[0]! - nx, p1[1]! - ny, 0]]; for (const k of [0, 1, 2, 1, 3, 2]) { P.push(...qq[k]!); C.push(...rgba) } } }
    for (const c of fo.pieces) band2(Array.from({ length: 41 }, (_, i) => cub2(c, i / 40)), 3, [...COLORS[0]!, 1])
    for (const r of fo.cap) band2(r, 3, [...COLORS[4]!, 1])
    // (the ears are drawn with the inner lines, where the head does not hide them)
    if (on('tan')) for (const t of fo.tan) { T.push(...toClip(t)); TC.push(0.88, 0.54, 0.17, 1) }
    drawTris(P, C); drawTris(T, TC, gl.POINTS)
  }
  if (on('outline') && on('oldnet') && !on('rule')) {
    const v = { yaw, pitch }, all: { kind: number; pts: P3[]; scr: number[][]; tan: P3[] }[] = []
    const push = (kind: number, pts: P3[], tan: P3[]) => all.push({ kind, pts, scr: pts.map(p => rotate(p, v) as unknown as number[]), tan })
    // tangent points in eight screen directions, the nets both ways (as in shell-outline.ts)
    for (const [ni, nets] of [D.nets, D.tnets].entries()) for (const net of nets) for (const [di, d] of DIRS.entries()) for (const l of outlines(net, d, v)) { push(net.kind, l.pts, l.tan.map(t => t.p)); (all[all.length - 1] as unknown as { tag: string }).tag = `${ni ? '竖' : '横'} ${net.name} dir${di * 45}` }
    ;(window as unknown as { __all: unknown }).__all = all
    if (on('cap')) for (const run of capOutline(v)) push(4, run, [])
    for (const e of EARS) push(3, e, [])
    // in every direction round the head's middle on the screen, the farthest line shows
    const c0 = rotate([0, -0.45, 0], v), A = 360, best = new Array<number>(A).fill(-Infinity)
    const ar = (q: number[]) => ({ a: ((Math.atan2(q[1]! - c0[1], q[0]! - c0[0]) * 180) / Math.PI + 360) % 360, r: Math.hypot(q[0]! - c0[0], q[1]! - c0[1]) })
    for (const L of all) for (let i = 0; i + 1 < L.scr.length; i++) { const p = ar(L.scr[i]!), q = ar(L.scr[i + 1]!); let da = q.a - p.a; if (da > 180) da -= 360; if (da < -180) da += 360
      const n = Math.max(1, Math.ceil(Math.abs(da))); for (let s = 0; s <= n; s++) { const f = s / n, a = Math.round(p.a + da * f + 360) % 360, r = p.r + (q.r - p.r) * f; if (r > best[a]!) best[a] = r } }
    const shown = (q: number[]) => { const { a, r } = ar(q); return r >= best[Math.round(a) % 360]! - 0.01 }
    const P: number[] = [], C: number[] = [], T: number[] = [], TC: number[] = []
    for (const L of all) { let run: P3[] = [], vis = shown(L.scr[0]!), any = false
      const flush = () => { if (run.length > 1 && (vis || on('covered'))) band(run, vis ? 3 : 1.4, [...COLORS[L.kind]!, vis ? 1 : 0.28], P, C); if (vis && run.length > 3) any = true }
      L.pts.forEach((p, i) => { const s = shown(L.scr[i]!); if (s !== vis) { run.push(p); flush(); run = [p]; vis = s } else run.push(p) }); flush()
      if (any && on('tan')) for (const t of L.tan) { T.push(...clip(t)); TC.push(0.88, 0.54, 0.17, 1) } }
    drawTris(P, C); drawTris(T, TC, gl.POINTS)
  }
}

let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw() }
cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab' }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
document.body.addEventListener('change', draw)
window.addEventListener('resize', draw)
;(window as unknown as { __view: (y: number, p: number, z?: number) => void }).__view = (y, p, z) => { yaw = y; pitch = p; if (z) zoom = z; draw() }
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d = loadVrmHead(b), idx = new Uint32Array(d.parts.flatMap(p => p.tris))
  mesh = { pos: buf(new Float32Array(d.P.flat())), nor: buf(new Float32Array(d.N.flat())), idx: buf(idx, gl.ELEMENT_ARRAY_BUFFER), n: idx.length }; draw()
})
draw()
