// Outlines from bowen's head wire at any turn (bowen 1793112590 「将语义点沿着这些纬线移动…将这些点用它临近的语义线以及临近的bezier
// 线的handle的曲率，就能定义出轮廓」; 1793112794 「任意角度稳定平滑合理的线框」; 1793113218 the side-face line counts; 1793113631
// the back of the head and the neck's side by the same logic; 1793113726/1793113772 「这个外轮廓有好几处切点，只是有些切点和切点的
// 线没有全部显露被更外侧的线覆盖了而已」— every tangent point makes its own outline line, whichever is outside shows).
// One rule for every outline: columns (lines running down) and rails (lines running across, bowen's ·纬线). In a view, each
// rail's tangent points are its bulges toward the outline's side (every local farthest-out point, not only the farthest);
// where each sits across the columns is g (column 0, column 1, … and the fractions between). Tangent points taken in order
// across the rails (the k-th from the midline on each rail) make one outline line each, running down through them; a stretch
// between two rails = the two columns it lies between, mixed by g (g sliding from the upper point's to the lower's), nudged
// through the points. Where the lines overlap on the screen the outer one shows; the covered part is drawn dashed.
// Three nets (head turning to yaw > 0; the other way is the mirror):
// - the face side (screen right, x > 0): columns side-face line, 外侧脸, 脸轮廓, midline back; rails the forehead ring,
//   太阳穴 → 上耳根, 颧骨 → 下耳根; 颅顶 → … → 下巴;
// - the back (screen left, x < 0): columns 脸轮廓 then down behind the ear and the neck's side, the back midline
//   (颅顶 → 后脑 → 头颈交界点 → 后颈); rails the forehead ring's back piece, 线8 (耳后根 → 头颈交界点), the neck's base;
// - the neck's front (screen right below the chin, x > 0): columns the front midline (下巴底拐点 → 颈前) and the neck's side;
//   rails under the jaw and the neck's base.
// Where bowen has not drawn a line a net needs, an automatic one keeps to the shell (listed, drawn dashed); his own can take
// its place. Compared with VRoid's outline row by row (head radius = 1).
// Writes face3d/viewer/ref-shell/outline-<doc><TAG>.svg/.json. Run: npx vite-node face3d/fit/shell-outline.ts <doc-sym.json>
//   env YAWS=0,15,… COLS=4 LEGEND=1 TAG=… SWEEP=1
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate, toCamera } from '../src/view'
type P3 = [number, number, number]
interface Ln { id: number; name: string; a: number; b: number; c: P3[] }
interface Doc { points: { id: number; name: string; p: P3 }[]; lines: Ln[] }
const file = process.argv[2]!, doc = JSON.parse(readFileSync(file, 'utf8')) as Doc
const b = readFileSync('face3d/fit/ref/test.vrm'), D = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const W = 400, F = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.42 }
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mix = (a: P3, b: P3, f: number): P3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], len = (v: P3) => Math.hypot(v[0], v[1], v[2])
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const P = (n: string) => { const p = doc.points.find(q => q.name === n); if (!p) throw Error(`no point ${n}`); return p.p }
const lineOf = (n: string) => { const l = doc.lines.find(k => k.name === n); if (!l) throw Error(`no line ${n}`); return l }
const idOf = (n: string) => doc.points.find(q => q.name === n)!.id
/** a line as a cubic running from point `from` to its other end */
const run = (n: string, from: string): P3[] => { const l = lineOf(n), f = idOf(from); if (l.a === f) return l.c; if (l.b === f) return [...l.c].reverse(); throw Error(`${n} does not start at ${from}`) }

// ---- the shell, for the automatic links: pressed onto the outermost skin (from the head's centre; on the neck, straight out
// from its axis), the ears left out (a link behind the ear must not climb over it) ----
const T: number[] = []
for (let t = 0; t < D.skinTris.length; t += 3) { const v = [0, 1, 2].map(k => D.P[D.skinTris[t + k]!]!); if (v.every(p => Math.abs(p[0]) > 0.75 && p[2] > -0.4 && p[2] < 0.15 && p[1] < -0.25 && p[1] > -1.0)) continue; T.push(D.skinTris[t]!, D.skinTris[t + 1]!, D.skinTris[t + 2]!) }
function farHit(o: P3, d: P3): P3 | null {
  let best = -Infinity
  for (let t = 0; t < T.length; t += 3) { const a = D.P[T[t]!]! as P3, e1 = sub(D.P[T[t + 1]!]! as P3, a), e2 = sub(D.P[T[t + 2]!]! as P3, a)
    const p: P3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-12) continue
    const tv = sub(o, a), u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det; if (u < 0 || u > 1) continue
    const q: P3 = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det; if (w < 0 || u + w > 1) continue
    const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det; if (tt > 1e-9 && tt > best) best = tt } // ahead of o only
  return Number.isFinite(best) ? add(o, [d[0] * best, d[1] * best, d[2] * best]) : null
}
const unit = (v: P3): P3 => { const m = len(v) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
const NECK_Y = -1.1
// where the ray finds no skin (it leaves through the hole the ear leaves), the nearest skin corner instead; under the jaw
// (a hollow the rays from inside would jump over, onto the jaw) the nearest skin corner too
const VS = [...new Set(T)].map(i => D.P[i]! as P3), nearestV = (q: P3) => VS.reduce((m, p) => (len(sub(p, q)) < len(sub(m, q)) ? p : m))
const press = (q: P3): P3 => { const c: P3 = q[1] < NECK_Y ? [0, q[1], -0.05] : [0, -0.3, 0]; return farHit(c, unit(sub(q, c))) ?? nearestV(q) }
/** least-squares cubic through q at chord-length t, ends fixed */
function fitCubic(q: P3[]): P3[] {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + len(sub(q[i]!, q[i - 1]!)))
  const P0 = q[0]!, P3_ = q[n]!; let a11 = 0, a12 = 0, a22 = 0; const r1 = [0, 0, 0], r2 = [0, 0, 0]
  for (let i = 0; i <= n; i++) { const t = L[i]! / L[n]!, u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (let k = 0; k < 3; k++) { const r = q[i]![k]! - b0 * P0[k]! - b3 * P3_[k]!; r1[k]! += b1 * r; r2[k]! += b2 * r } }
  const det = a11 * a22 - a12 * a12
  return [P0, [0, 1, 2].map(k => (r1[k]! * a22 - r2[k]! * a12) / det) as P3, [0, 1, 2].map(k => (a11 * r2[k]! - a12 * r1[k]!) / det) as P3, P3_]
}
/** an automatic link from a to b kept to the shell: pressed on, pulled straight a few times, then one cubic through it (a
 * Bézier like bowen's own lines, without the pressing's ripples) */
function hugLink(a: P3, b2: P3, n = 30, on: (q: P3) => P3 = press): P3[] {
  let path = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? a : i === n ? b2 : on(mix(a, b2, i / n))))
  for (let r = 0; r < 6; r++) path = path.map((p, i) => (i === 0 || i === n ? p : on(mix(path[i - 1]!, path[i + 1]!, 0.5))))
  return sample(fitCubic(path))
}
/** the neck's side at height y on side s (-1 left, +1 right): the skin farthest out there */
const neckSide = (y: number, s: number): P3 => press([s * 0.6, y, -0.05])

// ---- chains: a run of samples, walked by length ----
type Chain = P3[]
const sample = (c: P3[], n = 40): Chain => Array.from({ length: n + 1 }, (_, i) => cubic(c, i / n))
const join = (...cs: Chain[]): Chain => cs.flatMap((c, i) => (i ? c.slice(1) : c))
const lens = (c: Chain) => { const L = [0]; for (let i = 1; i < c.length; i++) L.push(L[i - 1]! + len(sub(c[i]!, c[i - 1]!))); return L }
function at(c: Chain, u: number): P3 { const L = lens(c), s = u * L[L.length - 1]!; let i = 1; while (i < L.length - 1 && L[i]! < s) i++; const f = (s - L[i - 1]!) / ((L[i]! - L[i - 1]!) || 1); return mix(c[i - 1]!, c[i]!, Math.max(0, Math.min(1, f))) }
const nearestIdx = (c: Chain, q: P3) => c.reduce((m, p, i) => (len(sub(p, q)) < len(sub(c[m]!, q)) ? i : m), 0)

// ---- the nets ----
interface Net { name: string; edge: 1 | -1; top?: P3; bottom?: P3; cols: (Chain | null)[][]; rails: { name: string; pieces: { c: Chain; from: number }[] }[] }
const autos: { name: string; c: Chain }[] = []
const auto = (name: string, c: Chain) => { autos.push({ name, c }); return c }
const profile = join(sample(run('眉心—颅顶', '颅顶')), sample(run('鼻尖—眉心', '眉心')), sample(run('上唇—鼻尖', '鼻尖')), sample(run('下唇—上唇', '上唇')), sample(run('下巴—下唇', '下唇')))
const atHeight = (y: number) => { let bi = 0, bz = -Infinity; for (let i = 1; i < profile.length; i++) { const a = profile[i - 1]!, c = profile[i]!; if ((a[1] - y) * (c[1] - y) <= 0 && Math.max(a[2], c[2]) > bz) { bz = Math.max(a[2], c[2]); bi = i } } return bi }
const iF = nearestIdx(profile, P('额前')), i2 = atHeight(P('右太阳穴')[1]), i3 = atHeight(P('右颧骨')[1])
const face: Net = { name: '脸那一侧', edge: 1, top: P('颅顶'), bottom: P('下巴'),
  cols: [[profile.slice(0, iF + 1), profile.slice(iF, i2 + 1), profile.slice(i2, i3 + 1), profile.slice(i3)],
    [sample(run('右线2前', '颅顶')), sample(run('右线2后', '右交点1')), sample(run('右线1', '右太阳穴')), sample(run('右线3', '右颧骨'))],
    [sample(run('右线5后', '颅顶')), sample(run('右线5前', '右交点2')), sample(run('右线2', '右上耳根')), sample(run('右线4', '右下耳根'))],
    [sample(run('颅顶—后脑', '颅顶')), null, null, null]],
  rails: [{ name: '额头那圈', pieces: [{ c: sample(run('纬线右半前·纬线', '额前')), from: 0 }, { c: sample(run('纬线右半后前·纬线', '右交点1')), from: 1 }, { c: sample(run('纬线右半后后·纬线', '右交点2')), from: 2 }] },
    { name: '太阳穴那层', pieces: [{ c: auto('侧脸线→右太阳穴', hugLink(profile[i2]!, P('右太阳穴'))), from: 0 }, { c: sample(run('右耳根太阳穴·纬线', '右太阳穴')), from: 1 }] },
    { name: '颧骨那层', pieces: [{ c: auto('侧脸线→右颧骨', hugLink(profile[i3]!, P('右颧骨'))), from: 0 }, { c: sample(run('右下耳根颧骨·纬线', '右颧骨')), from: 1 }] }] }
const baseY = (P('后颈')[1] + P('颈前')[1]) / 2, nsL = neckSide(baseY, -1), nsR = neckSide(baseY, 1)
/** a chain cut where it first crosses height y */
const cutY = (c: Chain, y: number): [Chain, Chain] => { const i = c.findIndex((p, k) => k > 0 && (c[k - 1]![1] - y) * (p[1] - y) <= 0); return i < 0 ? [c, [c[c.length - 1]!]] : [c.slice(0, i + 1), c.slice(i)] }
// behind the ear the back of the skull bulges between the forehead ring and 线8 with no line across it: an automatic one at
// the ear's height (上耳根), from behind the ear to the back midline
const behindEar = auto('交点2→耳后根（耳朵后面）', hugLink(P('交点2'), P('耳后根'))), backMid = sample(run('头颈交界耳后根·纬线', '后脑')), yEar = P('左上耳根')[1]
const [be1, be2] = cutY(behindEar, yEar), [bm1, bm2] = cutY(backMid, yEar)
const back: Net = { name: '后脑那一侧', edge: -1, top: P('颅顶'),
  cols: [[sample(run('线5后', '颅顶')), be1, be2, auto('耳后根→颈侧底', hugLink(P('耳后根'), nsL))],
    [sample(run('颅顶—后脑', '颅顶')), bm1, bm2, sample(run('线7', '头颈交界点'))]],
  rails: [{ name: '额头那圈后段', pieces: [{ c: sample(run('纬线左半后后·纬线', '交点2')), from: 0 }] },
    { name: '耳朵高度（后脑）', pieces: [{ c: auto('耳后→后脑中线（耳朵高度）', hugLink(be1[be1.length - 1]!, bm1[bm1.length - 1]!)), from: 0 }] },
    { name: '线8 耳后根→头颈交界点', pieces: [{ c: sample(run('线8', '耳后根')), from: 0 }] },
    { name: '颈根（后）', pieces: [{ c: auto('颈侧底→后颈', hugLink(nsL, P('后颈'))), from: 0 }] }] }
const neck: Net = { name: '颈前那一侧', edge: 1,
  cols: [[sample(run('颈前—下巴底拐点', '下巴底拐点'))], [auto('右耳后根→颈侧底', hugLink(P('右耳后根'), nsR))]],
  rails: [{ name: '下颌底', pieces: [{ c: auto('下巴底拐点→右耳后根（下颌底）', hugLink(P('下巴底拐点'), P('右耳后根'), 30, nearestV)), from: 0 }] },
    { name: '颈根（前）', pieces: [{ c: auto('颈前→颈侧底', hugLink(P('颈前'), nsR)), from: 0 }] }] }
const NETS = [face, back, neck]
// the inner lines drawn wherever they are not hidden
// what can hide a line: the skin and the eyeballs (white, iris: the skin has holes at the eyes); not lashes, brows, mouth
const isEye = (c: number[]) => (c[0] === 245 && c[1] === 245) || (c[0] === 70 && c[1] === 110)
const SKIN = { ...D, parts: D.parts.filter(p => p.kind === 'skin' || isEye(p.color)) }
const DETAIL = doc.lines.filter(l => /耳根—耳尖|耳尖—耳垂|耳垂—下耳根|^右?线4$|眼睑/.test(l.name))

/** a rail's tangent points in a view: every bulge toward the outline's side (a sample farther out than all within ±W, or an
 * end farther out than its neighbours), standing out by more than a hair from the dip to the next */
function tangents(r: Net['rails'][number], X: (p: P3) => number) {
  const s: { p: P3; g: number; x: number }[] = []
  for (const pc of r.pieces) { const L = lens(pc.c), tot = L[L.length - 1]!; pc.c.forEach((p, i) => { if (s.length && i === 0) return; s.push({ p, g: pc.from + L[i]! / tot, x: X(p) }) }) }
  const Wn = 3, peaks = s.map((q, i) => ({ q, i })).filter(({ q, i }) => { for (let j = Math.max(0, i - Wn); j <= Math.min(s.length - 1, i + Wn); j++) if (j !== i && s[j]!.x > q.x) return false; return true })
  // drop a bulge that hardly rises above the dip between it and a taller one (noise, flat stretches)
  const keep = peaks.filter(({ q, i }) => peaks.every(o => { if (o.i === i || o.q.x <= q.x) return true; const [a, c] = o.i < i ? [o.i, i] : [i, o.i]; let dip = Infinity; for (let j = a; j <= c; j++) dip = Math.min(dip, s[j]!.x); return q.x - dip > 0.01 }))
  // one per bulge (flat tops give several neighbours)
  return keep.filter(({ i }, k) => k === 0 || i - keep[k - 1]!.i > Wn).map(({ q }) => q)
}
/** one view, one net: its outline lines (one per tangent point, in order across the rails) */
function outlines(net: Net, yaw: number, pitch = 0) {
  const v = { yaw, pitch }, X = (p: P3) => net.edge * rotate(p, v)[0], tan = net.rails.map(r => tangents(r, X))
  const n = Math.max(...tan.map(t => t.length)), lines: { tan: { p: P3; g: number }[]; pts: P3[] }[] = []
  for (let bI = 0; bI < n; bI++) {
    const pick = tan.map(t => t[Math.min(bI, t.length - 1)]!)
    const ends = [...(net.top ? [{ p: net.top, g: pick[0]!.g }] : []), ...pick, ...(net.bottom ? [{ p: net.bottom, g: pick[pick.length - 1]!.g }] : [])]
    const pts: P3[] = []
    for (let k = 0; k < ends.length - 1; k++) {
      const top = ends[k]!, bot = ends[k + 1]!, have = net.cols.map((c, i) => (c[k] ? i : -1)).filter(i => i >= 0), lo = Math.min(...have), hi = Math.max(...have)
      const base = (u: number) => { const g = Math.max(lo, Math.min(hi, top.g + (bot.g - top.g) * u)), i = Math.max(lo, Math.min(hi - 1, Math.floor(g))), w = hi === lo ? 0 : g - i
        return w <= 0 ? at(net.cols[i]![k]!, u) : mix(at(net.cols[i]![k]!, u), at(net.cols[i + 1]![k]!, u), w) }
      const dTop = sub(top.p, base(0)), dBot = sub(bot.p, base(1))
      for (let j = k ? 1 : 0; j <= 60; j++) { const u = j / 60; pts.push(add(base(u), add(mix([0, 0, 0], dTop, 1 - u), mix([0, 0, 0], dBot, u)))) }
    }
    lines.push({ tan: pick, pts })
  }
  return lines
}

// ---- compare with VRoid's outline: each net's outer line per row, on its side, over the rows it spans ----
const crossing = (poly: (readonly number[])[], y: number, edge: number) => { let best = -Infinity; for (let i = 0; i + 1 < poly.length; i++) { const a = poly[i]!, c = poly[i + 1]!; if ((a[1]! - y) * (c[1]! - y) > 0 || a[1] === c[1]) continue; best = Math.max(best, edge * (a[0]! + ((y - a[1]!) / (c[1]! - a[1]!)) * (c[0]! - a[0]!))) } return edge * best }
function compare(yaw: number) {
  const v = { yaw, pitch: 0 }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4)), on = (x: number, y: number) => ras.zb[y * W + x]! > -Infinity
  const rows: { y: number; l: number; r: number }[] = []
  for (let j = 0; j < W; j++) { let l = -1, r = -1; for (let i = 0; i < W; i++) if (on(i, j)) { if (l < 0) l = i; r = i } if (r >= 0) rows.push({ y: (F.cy - (j + 0.5)) / F.S, l: (l + 0.5 - F.cx) / F.S, r: (r + 0.5 - F.cx) / F.S }) }
  const yMin = rows[rows.length - 1]!.y + 0.03 // above the neck's cut
  const res = NETS.map(net => { const ls = outlines(net, yaw).map(l => ({ ...l, q: l.pts.map(p => rotate(p, v)) })), ys = ls.flatMap(l => l.q.map(p => p[1])), top = Math.max(...ys), bot = Math.max(Math.min(...ys), yMin)
    const outer = (y: number) => net.edge * Math.max(...ls.map(l => net.edge * crossing(l.q, y, net.edge)))
    const g = rows.filter(r => r.y <= top && r.y >= bot).map(r => ({ y: r.y, true: net.edge > 0 ? r.r : r.l, built: outer(r.y) }))
    const d = g.map(r => Math.abs(r.true - r.built)).filter(Number.isFinite).sort((a, c) => a - c)
    return { net, ls, outer, med: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN, max: d[d.length - 1] ?? NaN } })
  // each side as a whole (the face and the neck's front together on the right): the outer of its nets per row
  const sides = ([1, -1] as const).map(edge => { const mine = res.filter(x => x.net.edge === edge), ys = mine.flatMap(x => x.ls.flatMap(l => l.q.map(p => p[1]))), top = Math.max(...ys), bot = Math.max(Math.min(...ys), yMin)
    const d = rows.filter(r => r.y <= top && r.y >= bot).map(r => { const o = edge * Math.max(...mine.map(x => edge * x.outer(r.y)).filter(Number.isFinite)); return Math.abs((edge > 0 ? r.r : r.l) - o) }).filter(Number.isFinite).sort((a, c) => a - c)
    return { name: edge > 0 ? '右边（脸 + 颈前）' : '左边（后脑 + 颈后）', med: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN, max: d[d.length - 1] ?? NaN } })
  // the inner lines (bowen 1793114358/1793114371: ears, the jawline, the eyes — drawn wherever not hidden), each sample's
  // visibility two ways: (z) VRoid's head in front of it (its depth buffer); (r) the wire alone, the head taken as round: the
  // point faces the viewer when its direction from the head's centre does
  // (the skin and eyeballs only: lashes and brows do not hide the lines drawn round them)
  const toCam = toCamera(v), skinZ = rasterHead(SKIN, v, F, new Uint8ClampedArray(W * W * 4)).zb
  const detail = DETAIL.map(l => { const pts = sample(l.c, 60).map(p => { const q = rotate(p, v), i = Math.floor(F.cx + q[0] * F.S), j = Math.floor(F.cy - q[1] * F.S)
      // hidden when the head's surface at its pixel lies in front of it; at the outline's edge (a background pixel next to it)
      // never hidden
      let edge = false; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= W || skinZ[jj * W + ii]! === -Infinity) edge = true }
      const zc = i >= 0 && j >= 0 && i < W && j < W ? skinZ[j * W + i]! : -Infinity, z = edge || !(q[2] < zc - 0.04)
      const dir = unit(sub(p, [0, -0.3, 0])), r = dir[0] * toCam[0] + dir[1] * toCam[1] + dir[2] * toCam[2] > -0.05
      return { q, z, r } }); return { l, pts } })
  return { yaw, rows, res, sides, detail }
}

const YAWS = process.env.YAWS ? process.env.YAWS.split(',').map(Number) : [0, 15, 30, 45, 60, 63, 66, 70, 75, 90, 105, 120], Pn = 400, COLS = Number(process.env.COLS ?? 4), LEGEND = !!process.env.LEGEND, out: unknown[] = []
const COLOR = ['#13a05a', '#7b3fb5', '#c47a00']
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS * Pn} ${COLS * Pn}" width="${COLS * Pn}" height="${COLS * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
YAWS.forEach((yaw, k) => {
  const R = compare(yaw), v = { yaw, pitch: 0 }, ox = (k % COLS) * Pn, oy = Math.floor(k / COLS) * Pn, X = (x: number) => ox + F.cx + x * F.S, Y = (y: number) => oy + F.cy - y * F.S
  const pl = (pts: (readonly number[])[], st: string) => `<polyline fill="none" ${st} points="${pts.map(p => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>`
  for (const l of doc.lines) svg += pl(sample(l.c, 60).map(p => rotate(p, v)), 'stroke="#d9a0a0" stroke-width="0.6"')
  for (const a of autos) svg += pl(a.c.map(p => rotate(p, v)), 'stroke="#d9a0a0" stroke-width="0.8" stroke-dasharray="3 2"')
  svg += pl(R.rows.map(r => [r.r, r.y]), 'stroke="#111" stroke-width="1"') + pl(R.rows.map(r => [r.l, r.y]), 'stroke="#111" stroke-width="1"')
  R.res.forEach((x, i) => {
    for (const l of x.ls) { // the shown parts solid, the covered parts dashed
      const runs: { shown: boolean; pts: (readonly number[])[] }[] = []
      for (const q of l.q) { const shown = net1(x, q); const last = runs[runs.length - 1]; if (last && last.shown === shown) last.pts.push(q); else runs.push({ shown, pts: last ? [last.pts[last.pts.length - 1]!, q] : [q] }) }
      for (const r of runs) svg += pl(r.pts, r.shown ? `stroke="${COLOR[i]}" stroke-width="2"` : `stroke="${COLOR[i]}" stroke-width="1" stroke-dasharray="4 3" opacity="0.7"`)
      for (const t of l.tan) { const q = rotate(t.p, v); svg += `<circle cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="3.5" fill="#e08a2c" stroke="#fff"/>` }
    } })
  for (const d of R.detail) { let runP: (readonly number[])[] = []; const flush = () => { if (runP.length > 1) svg += pl(runP, 'stroke="#1d3c8f" stroke-width="1.6"'); runP = [] }
    for (const p of d.pts) { if (p.z) runP.push(p.q); else flush() } flush() }
  const all = R.detail.flatMap(d => d.pts), agree = all.filter(p => p.z === p.r).length / all.length
  svg += `<text x="${ox + 8}" y="${oy + 20}" font-size="15">转 ${yaw}°</text><text x="${ox + Pn - 8}" y="${oy + 20}" font-size="12" text-anchor="end" fill="#1d3c8f">两种遮挡算法一致 ${(agree * 100).toFixed(0)}%</text>`
  console.log(yaw, 'visibility agree', (agree * 100).toFixed(1) + '%', R.detail.map(d => `${d.l.name}:${d.pts.filter(p => p.z).length}/${d.pts.filter(p => p.r).length}`).join(' '))
  R.sides.forEach((x, i) => { svg += `<text x="${ox + 8}" y="${oy + Pn - 28 + i * 18}" font-size="12" fill="#333">${x.name}：中位 ${x.med.toFixed(3)} · 九成 ${x.p90.toFixed(3)} · 最大 ${x.max.toFixed(3)}</text>` })
  out.push({ yaw, sides: R.sides, nets: R.res.map(x => ({ net: x.net.name, lines: x.ls.length, med: +x.med.toFixed(4), p90: +x.p90.toFixed(4), max: +x.max.toFixed(4), g: x.ls.map(l => l.tan.map(t => +t.g.toFixed(3))) })) })
  console.log(yaw, R.sides.map(x => `${x.name} ${[x.med, x.p90, x.max].map(n => n.toFixed(3)).join('/')}`).join(' | '), '| lines', R.res.map(x => x.ls.length).join('/'))
})
/** is this point of a line the outer one on its row (within a hair)? */
function net1(x: { net: Net; outer: (y: number) => number }, q: readonly number[]) { const o = x.outer(q[1]!); return !Number.isFinite(o) || x.net.edge * (q[0]! - o) >= -0.004 }
if (LEGEND) { const lg: [string, string][] = [['#111', '黑线 = VRoid 真轮廓'], ['#1d3c8f', '深蓝 = 耳朵、下颌线（线4）、眼睑：没被挡住的部分（用 VRoid 头的遮挡算）'], ['#13a05a', '绿 = 脸那一侧拼出的轮廓线（实 = 露在外面，虚 = 被更外的线盖住）'], ['#7b3fb5', '紫 = 后脑那一侧（带颈侧）'], ['#c47a00', '橙褐 = 颈前那一侧'], ['#e08a2c', '橙点 = 纬线上和视线相切的点'], ['#d9a0a0', '浅红 = 你的线框；浅红虚线 = 我自动补的线']]
  const oy = Math.ceil(YAWS.length / COLS) * Pn; lg.forEach(([c, t], i) => { svg += `<rect x="20" y="${oy + 14 + i * 22}" width="16" height="12" fill="${c}"/><text x="44" y="${oy + 25 + i * 22}" font-size="14">${t}</text>` }) }
const base = file.replace(/\.json$/, '').replace(/.*\//, '') + (process.env.TAG ?? '')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.svg`, svg + '</svg>')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.json`, JSON.stringify({ note: 'outline lines built from tangent points on the rails + the columns between (face3d/fit/shell-outline.ts)', autos: autos.map(a => a.name), views: out }, null, 1))
if (process.env.SWEEP) for (const net of NETS) { const counts: string[] = []
  for (let yaw = 0; yaw <= 120; yaw += 3) counts.push(`${yaw}:${outlines(net, yaw).length}`)
  console.log(net.name, '轮廓线条数', counts.join(' ')) }
