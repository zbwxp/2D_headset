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
import { rotate, screenAxes, toCamera } from '../src/view'
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
const USED = new Set<string>()
const run = (n: string, from: string): P3[] => { USED.add(n); const l = lineOf(n), f = idOf(from); if (l.a === f) return l.c; if (l.b === f) return [...l.c].reverse(); throw Error(`${n} does not start at ${from}`) }

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
const LENS = new WeakMap<Chain, number[]>()
const lens = (c: Chain) => { let L = LENS.get(c); if (!L) { L = [0]; for (let i = 1; i < c.length; i++) L.push(L[i - 1]! + len(sub(c[i]!, c[i - 1]!))); LENS.set(c, L) } return L }
function at(c: Chain, u: number): P3 { const L = lens(c), s = u * L[L.length - 1]!; let i = 1; while (i < L.length - 1 && L[i]! < s) i++; const f = (s - L[i - 1]!) / ((L[i]! - L[i - 1]!) || 1); return mix(c[i - 1]!, c[i]!, Math.max(0, Math.min(1, f))) }
const nearestIdx = (c: Chain, q: P3) => c.reduce((m, p, i) => (len(sub(p, q)) < len(sub(c[m]!, q)) ? i : m), 0)

// ---- the nets ----
interface Net { name: string; edge: 1 | -1; top?: P3; bottom?: P3 | 'free'; cols: (Chain | null)[][]; rails: { name: string; pieces: { c: Chain; from: number }[] }[] }
const autos: { name: string; c: Chain }[] = []
const auto = (name: string, c: Chain) => { autos.push({ name, c }); return c }
const profile = join(sample(run('眉心—颅顶', '颅顶')), sample(run('鼻尖—眉心', '眉心')), sample(run('上唇—鼻尖', '鼻尖')), sample(run('下唇—上唇', '上唇')), sample(run('下巴—下唇', '下唇')), sample(run('下巴底拐点—下巴', '下巴')))
// (the side-face line runs on under the chin to 下巴底拐点: turned side-on the outline follows it there; the other columns end at
// 下巴, so the outline's lower end is left where the columns put it)
const atHeight = (y: number) => { let bi = 0, bz = -Infinity; for (let i = 1; i < profile.length; i++) { const a = profile[i - 1]!, c = profile[i]!; if ((a[1] - y) * (c[1] - y) <= 0 && Math.max(a[2], c[2]) > bz) { bz = Math.max(a[2], c[2]); bi = i } } return bi }
const iF = nearestIdx(profile, P('额前')), i2 = atHeight(P('右太阳穴')[1]), i3 = atHeight(P('右颧骨')[1])
const face: Net = { name: '脸那一侧', edge: 1, top: P('颅顶'), bottom: 'free',
  cols: [[profile.slice(0, iF + 1), profile.slice(iF, i2 + 1), profile.slice(i2, i3 + 1), profile.slice(i3)],
    [sample(run('右线2前', '颅顶')), sample(run('右线2后', '右交点1')), sample(run('右线1', '右太阳穴')), sample(run('右线3', '右颧骨'))],
    [sample(run('右线5后', '颅顶')), sample(run('右线5前', '右交点2')), sample(run('右线2', '右上耳根')), sample(run('右线4', '右下耳根'))],
    [sample(run('颅顶—后脑', '颅顶')), null, null, null]],
  rails: [{ name: '额头那圈', pieces: [{ c: sample(run('纬线右半前·纬线', '额前')), from: 0 }, { c: sample(run('纬线右半后前·纬线', '右交点1')), from: 1 }, { c: sample(run('纬线右半后后·纬线', '右交点2')), from: 2 }] },
    { name: '太阳穴那层', pieces: [{ c: auto('侧脸线→右太阳穴', hugLink(profile[i2]!, P('右太阳穴'))), from: 0 }, { c: sample(run('右耳根太阳穴·纬线', '右太阳穴')), from: 1 }] },
    { name: '颧骨那层', pieces: [{ c: auto('侧脸线→右颧骨', hugLink(profile[i3]!, P('右颧骨'))), from: 0 }, { c: sample(run('右下耳根颧骨·纬线', '右颧骨')), from: 1 }] }] }
/** a chain cut where it first crosses height y */
const cutY = (c: Chain, y: number): [Chain, Chain] => { const i = c.findIndex((p, k) => k > 0 && (c[k - 1]![1] - y) * (p[1] - y) <= 0); return i < 0 ? [c, [c[c.length - 1]!]] : [c.slice(0, i + 1), c.slice(i)] }
const still = (p: P3): Chain => [p, p] // a column that does not move over a stretch (its rails meet at one point there)
const joinRun = (...ns: [string, string][]) => join(...ns.map(([n, from]) => sample(run(n, from))))
// the back and the neck from bowen's own lines (bowen 1793118841 「我在下颌和颈部增添了很多线」), each patch of his net one net
// here (left side, x < 0; mirrored for the right):
// - the back of the skull: 线5后 / 线10 and the back midline, the forehead ring's back piece across, down to 头颈交界点;
const back: Net = { name: '后脑那一侧', edge: -1, top: P('颅顶'), bottom: P('头颈交界点'),
  cols: [[sample(run('线5后', '颅顶')), sample(run('线10', '交点2'))], [sample(run('颅顶—后脑', '颅顶')), sample(run('头颈交界耳后根·纬线', '后脑'))]],
  rails: [{ name: '额头那圈后段', pieces: [{ c: sample(run('纬线左半后后·纬线', '交点2')), from: 0 }] }] }
// - behind the ear: from 交点2 down the face contour (上耳根 → 下耳根) and down 线10, 线6 across at the bottom;
const behindEar: Net = { name: '耳后', edge: -1, top: P('交点2'),
  cols: [[joinRun(['线5前', '交点2'], ['线2', '左上耳根'])], [sample(run('线10', '交点2'))]],
  rails: [{ name: '线6', pieces: [{ c: sample(run('线6', '左下耳根')), from: 0 }] }] }
// - under the jaw: from 下耳根 along 线4 (to 下巴) and 线9 (to 下巴底拐点), the midline across;
const underJaw: Net = { name: '下颌底', edge: -1, top: P('左下耳根'),
  cols: [[sample(run('线4', '左下耳根'))], [sample(run('线9', '左下耳根'))]],
  rails: [{ name: '下巴→下巴底拐点', pieces: [{ c: sample(run('下巴底拐点—下巴', '下巴')), from: 0 }] }] }
// - the neck's front: the front midline and the neck's side (下耳根 → 交点4 → 交点3), 线9 / 线12前 / 线11后 across;
const neck: Net = { name: '颈前那一侧', edge: -1,
  cols: [[still(P('下巴底拐点')), sample(run('颈前—下巴底拐点', '下巴底拐点'))], [sample(run('线8后后', '左下耳根')), sample(run('线8后前', '交点4'))]],
  rails: [{ name: '线9', pieces: [{ c: sample(run('线9', '下巴底拐点')), from: 0 }] }, { name: '线12前', pieces: [{ c: sample(run('线12前', '下巴底拐点')), from: 0 }] },
    { name: '线11后', pieces: [{ c: sample(run('线11后', '颈前')), from: 0 }] }] }
// - the neck's back: the back midline (头颈交界点 → 后颈) and the neck's side, 线6 / 线12后 / 线11前 across
const nape: Net = { name: '颈后', edge: -1,
  cols: [[still(P('头颈交界点')), sample(run('线7', '头颈交界点'))], [sample(run('线8后后', '左下耳根')), sample(run('线8后前', '交点4'))]],
  rails: [{ name: '线6', pieces: [{ c: sample(run('线6', '头颈交界点')), from: 0 }] }, { name: '线12后', pieces: [{ c: sample(run('线12后', '头颈交界点')), from: 0 }] },
    { name: '线11前', pieces: [{ c: sample(run('线11前', '后颈')), from: 0 }] }] }
// a ring round the top of the head (bowen 1793117292 「头顶先补一圈，让bezier曲线扭转尽量简单，尽量水平的圈」; 1793118922 「你补的线
// …都应该是bezier曲线…一长段bezier曲线能大致拟合很多交点的就都用一条线拟合」): level at height Y_TOP (halfway between the crown and
// the forehead ring), one cubic for each half from the front midline to the back (every point of its path at that height,
// pressed straight out from the head's upright axis); the columns are cut where they meet it
const Y_TOP = (P('颅顶')[1] + P('额前')[1]) / 2
const ringHalf = (() => { const c: P3 = [0, Y_TOP, -0.05], n = 48
  const path = Array.from({ length: n + 1 }, (_, i) => { const a = (Math.PI * i) / n; return farHit(c, [Math.sin(a), 0, Math.cos(a)]) ?? c })
  return sample(fitCubic(path), 120) })() // x > 0 half, front (z > 0) to back
auto('头顶那圈（右半）', ringHalf); auto('头顶那圈（左半）', ringHalf.map(p => [-p[0], p[1], p[2]] as P3))
function addRing(net: Net, name: string) {
  const ring = net.edge > 0 || net.name === '脸那一侧' ? ringHalf : ringHalf.map(p => [-p[0], p[1], p[2]] as P3)
  const az = (p: P3) => Math.atan2(Math.abs(p[0]), p[2])
  const at2 = net.cols.map(cs => { const c0 = cs[0]; if (!c0) return -1; const [up] = cutY(c0, Y_TOP), q = up[up.length - 1]!
    return ring.reduce((m, p, i) => (Math.abs(az(p) - az(q)) < Math.abs(az(ring[m]!) - az(q)) ? i : m), 0) })
  net.cols.forEach((cs, i) => { const c0 = cs[0]; if (!c0 || at2[i]! < 0) { cs.splice(0, 0, null); return }
    const p = ring[at2[i]!]!, [up, low] = cutY(c0, Y_TOP); up[up.length - 1] = p; low[0] = p; cs.splice(0, 1, up, low) })
  const pieces: { c: Chain; from: number }[] = []
  for (let i = 0; i + 1 < at2.length; i++) if (at2[i]! >= 0 && at2[i + 1]! >= 0) { const [x, y] = [at2[i]!, at2[i + 1]!]; pieces.push({ from: i, c: x <= y ? ring.slice(x, y + 1) : ring.slice(y, x + 1).reverse() }) }
  net.rails.splice(0, 0, { name, pieces })
}
addRing(face, '头顶那圈'); addRing(back, '头顶那圈（后）')
// every net on both sides (bowen 1793114494: at 0° the two sides came out different — the right had only the face's net, the
// left only the back's): each mirrored across the midline, outlining the other screen side; each screen side shows the outer
const mirrorNet = (n: Net): Net => { const m = (c: Chain): Chain => c.map(p => [-p[0], p[1], p[2]] as P3)
  return { ...n, name: n.name, edge: (-n.edge) as 1 | -1, top: n.top && [-n.top[0], n.top[1], n.top[2]], bottom: n.bottom === 'free' ? 'free' : n.bottom && [-n.bottom[0], n.bottom[1], n.bottom[2]],
    cols: n.cols.map(cs => cs.map(c => c && m(c))), rails: n.rails.map(r => ({ ...r, pieces: r.pieces.map(pc => ({ ...pc, c: m(pc.c) })) })) } }
// and each net outlines whichever screen side it comes to: both edges (bowen 1793114547: turned to the back, a net fixed to
// one screen side outlined the wrong one); a line inside the head on a side is never the outer one there
/** the same net crosswise (bowen 1793115000, pitch): its columns become the rails (tangent points sliding up and down them,
 * for the outline's top and bottom on the screen) and its rails the columns (their pieces give the bend between); the top
 * and bottom ends become a column each (the straight step between the columns' own ends) */
function transpose(n: Net): Net {
  const R = n.rails.length, hasTop = !!n.top, nC = n.cols.length, stretches = (hasTop ? 1 : 0) + R - 1 + (n.bottom ? 1 : 0)
  // (only a column that itself reaches the top / bottom stretch has an end there: the back midline ends at 后脑, which is no
  // bottom — bridged to 下巴 it ran straight through the head and the line flew out, bowen 1793117610)
  const endOf = (i: number, first: boolean): P3 | null => { const cs = n.cols[i]!, c = first ? cs[0] : cs[cs.length - 1]; if (!c) return null; return first ? c[0]! : c[c.length - 1]! }
  const newCols: (Chain | null)[][] = []
  if (hasTop) newCols.push(Array.from({ length: nC - 1 }, (_, m) => { const a = endOf(m, true), b = endOf(m + 1, true); return a && b ? [a, b] : null }))
  for (const r of n.rails) newCols.push(Array.from({ length: nC - 1 }, (_, m) => r.pieces.find(pc => pc.from === m)?.c ?? null))
  if (n.bottom) newCols.push(Array.from({ length: nC - 1 }, (_, m) => { const a = endOf(m, false), b = endOf(m + 1, false); return a && b ? [a, b] : null }))
  void stretches
  const rails = n.cols.map((cs, i) => ({ name: `竖线 ${i}`, pieces: cs.map((c, k) => (c ? { c, from: k } : null)).filter(Boolean) as { c: Chain; from: number }[] })).filter(r => r.pieces.length)
  return { name: n.name, edge: n.edge, cols: newCols, rails }
}
// colour groups: 0 the face (green), 1 the back of the head (purple), 2 under the jaw and the neck (brown); 3 the ears, 4 the cap
const BASE = [face, back, behindEar, underJaw, neck, nape], GROUP = [0, 1, 1, 2, 2, 2], KINDS = [...BASE, ...BASE.map(mirrorNet)].map((n, i) => ({ n, kind: GROUP[i % BASE.length]! }))
const NETS = KINDS.flatMap(({ n, kind }) => ([1, -1] as const).map(edge => Object.assign({ ...n, edge }, { kind })))
const KIND = (n: Net) => (n as Net & { kind: number }).kind
// the inner lines drawn wherever they are not hidden
// what can hide a line: the skin and the eyeballs (white, iris: the skin has holes at the eyes); not lashes, brows, mouth
const isEye = (c: number[]) => (c[0] === 245 && c[1] === 245) || (c[0] === 70 && c[1] === 110)
const SKIN = { ...D, parts: D.parts.filter(p => p.kind === 'skin' || isEye(p.color)) }
const DETAIL = doc.lines.filter(l => /耳根—耳尖|耳尖—耳垂|耳垂—下耳根|^右?线4$|眼睑/.test(l.name))

/** mixing two points of the shell the way the shell runs between them, not straight through it: round the head's centre
 * (the direction swung, the distance mixed) (bowen 1793117292 follow-up: mixed straight,
 * the outline between two columns cut inside the head and ran in straight pieces near the crown) */
function mixRound(a: P3, b2: P3, w: number): P3 {
  // round on the skull, straight lower down (jaw and nape are far from round about the centre), eased between heights -0.4
  // and -0.8 (a switch at one height left a step in the outline, bowen's viewer at yaw 45 pitch 30)
  const lowY = Math.min(a[1], b2[1]), k = Math.max(0, Math.min(1, (lowY + 0.8) / 0.4)), straight = mix(a, b2, w)
  if (k <= 0) return straight
  const c: P3 = [0, -0.3, 0], da = sub(a, c), db = sub(b2, c)
  const ra = len(da), rb = len(db); if (ra < 1e-6 || rb < 1e-6) return mix(a, b2, w)
  const ua = unit(da), ub = unit(db), cos = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2])), om = Math.acos(cos)
  const u: P3 = om < 1e-4 ? mix(ua, ub, w) : ([0, 1, 2].map(k => (Math.sin((1 - w) * om) * ua[k]! + Math.sin(w * om) * ub[k]!) / Math.sin(om)) as P3)
  const r = ra + (rb - ra) * w, p: P3 = add(c, [u[0] * r, u[1] * r, u[2] * r])
  return k >= 1 ? p : mix(straight, p, k * k * (3 - 2 * k))
}
/** a rail's tangent points in a view: every bulge toward the outline's side (a sample farther out than all within ±W, or an
 * end farther out than its neighbours), standing out by more than a hair from the dip to the next */
function tangents(r: Net['rails'][number], X: (p: P3) => number) {
  const s: { p: P3; g: number; x: number }[] = []
  for (const pc of r.pieces) { const L = lens(pc.c), tot = L[L.length - 1]!; pc.c.forEach((p, i) => { if (s.length && i === 0) return; s.push({ p, g: pc.from + L[i]! / (tot || 1), x: X(p) }) }) }
  const Wn = 3, peaks = s.map((q, i) => ({ q, i })).filter(({ q, i }) => { for (let j = Math.max(0, i - Wn); j <= Math.min(s.length - 1, i + Wn); j++) if (j !== i && s[j]!.x > q.x) return false; return true })
  // drop a bulge that hardly rises above the dip between it and a taller one (noise, flat stretches)
  const keep = peaks.filter(({ q, i }) => peaks.every(o => { if (o.i === i || o.q.x <= q.x) return true; const [a, c] = o.i < i ? [o.i, i] : [i, o.i]; let dip = Infinity; for (let j = a; j <= c; j++) dip = Math.min(dip, s[j]!.x); return q.x - dip > 0.01 }))
  // one per bulge (flat tops give several neighbours)
  return keep.filter(({ i }, k) => k === 0 || i - keep[k - 1]!.i > Wn).map(({ q }) => q)
}
/** one view, one net: its outline lines (one per tangent point, in order across the rails) */
/** dir: the screen direction the tangent points are farthest out in (by default the net's edge across the screen, or up
 * the screen with axis 1) */
function outlines(net: Net, yaw: number, pitch = 0, axis: 0 | 1 = 0, dir?: readonly [number, number]) {
  const d = dir ?? (axis ? [0, net.edge] : [net.edge, 0]), v = { yaw, pitch }, X = (p: P3) => { const q = rotate(p, v); return d[0] * q[0] + d[1] * q[1] }, tan = net.rails.map(r => tangents(r, X))
  const n = Math.max(...tan.map(t => t.length)), lines: { tan: { p: P3; g: number }[]; pts: P3[] }[] = []
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
      // between the two nearest columns that reach this stretch (a column missing here is stepped over)
      const base = (u: number) => { const g = Math.max(lo, Math.min(hi, top.g + (bot.g - top.g) * u)), i0 = Math.max(...have.filter(i => i <= g)), i1 = Math.min(...have.filter(i => i >= g)), w = i1 === i0 ? 0 : (g - i0) / (i1 - i0)
        return w <= 0 ? at(net.cols[i0]![k]!, u) : mixRound(at(net.cols[i0]![k]!, u), at(net.cols[i1]![k]!, u), w) }
      const dTop = top.p ? sub(top.p, base(0)) : [0, 0, 0] as P3, dBot = bot.p ? sub(bot.p, base(1)) : [0, 0, 0] as P3
      for (let j = pts.length ? 1 : 0; j <= 60; j++) { const u = j / 60; pts.push(add(base(u), add(mix([0, 0, 0], dTop, 1 - u), mix([0, 0, 0], dBot, u)))) }
    }
    if (pts.length > 1) lines.push({ tan: pick, pts })
  }
  return lines
}

// ---- compare with VRoid's outline: each net's outer line per row, on its side, over the rows it spans ----
const crossing = (poly: (readonly number[])[], y: number, edge: number) => { let best = -Infinity; for (let i = 0; i + 1 < poly.length; i++) { const a = poly[i]!, c = poly[i + 1]!; if ((a[1]! - y) * (c[1]! - y) > 0 || a[1] === c[1]) continue; best = Math.max(best, edge * (a[0]! + ((y - a[1]!) / (c[1]! - a[1]!)) * (c[0]! - a[0]!))) } return edge * best }
function compare(yaw: number, pitch = 0) {
  const v = { yaw, pitch }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4)), on = (x: number, y: number) => ras.zb[y * W + x]! > -Infinity
  const rows: { y: number; l: number; r: number }[] = []
  for (let j = 0; j < W; j++) { let l = -1, r = -1; for (let i = 0; i < W; i++) if (on(i, j)) { if (l < 0) l = i; r = i } if (r >= 0) rows.push({ y: (F.cy - (j + 0.5)) / F.S, l: (l + 0.5 - F.cx) / F.S, r: (r + 0.5 - F.cx) / F.S }) }
  const yMin = rows[rows.length - 1]!.y + 0.03 // above the neck's cut
  const res = NETS.map(net => { const ls = outlines(net, yaw, pitch).map(l => ({ ...l, q: l.pts.map(p => rotate(p, v)) })), ys = ls.flatMap(l => l.q.map(p => p[1])), top = Math.max(...ys), bot = Math.max(Math.min(...ys), yMin)
    const outer = (y: number) => net.edge * Math.max(...ls.map(l => net.edge * crossing(l.q, y, net.edge)))
    const g = rows.filter(r => r.y <= top && r.y >= bot).map(r => ({ y: r.y, true: net.edge > 0 ? r.r : r.l, built: outer(r.y) }))
    const d = g.map(r => Math.abs(r.true - r.built)).filter(Number.isFinite).sort((a, c) => a - c)
    return { net, ls, outer, med: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN, max: d[d.length - 1] ?? NaN } })
  // each side as a whole (the face and the neck's front together on the right): the outer of its nets per row
  const sides = ([1, -1] as const).map(edge => { const mine = res.filter(x => x.net.edge === edge), ys = mine.flatMap(x => x.ls.flatMap(l => l.q.map(p => p[1]))), top = Math.max(...ys), bot = Math.max(Math.min(...ys), yMin)
    const d = rows.filter(r => r.y <= top && r.y >= bot).map(r => { const o = edge * Math.max(...mine.map(x => edge * x.outer(r.y)).filter(Number.isFinite)); return Math.abs((edge > 0 ? r.r : r.l) - o) }).filter(Number.isFinite).sort((a, c) => a - c)
    return { name: edge > 0 ? '画面右边' : '画面左边', med: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN, max: d[d.length - 1] ?? NaN } })
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
  const sideOuter = (edge: number, y: number) => edge * Math.max(...res.filter(x => x.net.edge === edge).map(x => edge * x.outer(y)).filter(Number.isFinite))
  return { yaw, rows, res, sides, detail, sideOuter }
}

const VIEWS: [number, number][] = (process.env.YAWS ?? '').split(',').filter(Boolean).map(t => t.split(':').map(Number) as [number, number])
const YAWS = VIEWS.length ? VIEWS.map(v => v[0]) : [0, 15, 30, 45, 60, 63, 66, 70, 75, 90, 105, 120], Pn = 400, COLS = Number(process.env.COLS ?? 4), LEGEND = !!process.env.LEGEND, out: unknown[] = []
const COLOR = ['#13a05a', '#7b3fb5', '#c47a00', '#1d3c8f', '#d0342c']
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS * Pn} ${COLS * Pn}" width="${COLS * Pn}" height="${COLS * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
YAWS.forEach((yaw, k) => {
  const pitch = VIEWS[k]?.[1] ?? 0, R = compare(yaw, pitch), v = { yaw, pitch }, ox = (k % COLS) * Pn, oy = Math.floor(k / COLS) * Pn, X = (x: number) => ox + F.cx + x * F.S, Y = (y: number) => oy + F.cy - y * F.S
  const pl = (pts: (readonly number[])[], st: string) => `<polyline fill="none" ${st} points="${pts.map(p => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>`
  for (const l of doc.lines) svg += pl(sample(l.c, 60).map(p => rotate(p, v)), 'stroke="#d9a0a0" stroke-width="0.6"')
  for (const a of autos) svg += pl(a.c.map(p => rotate(p, v)), 'stroke="#d9a0a0" stroke-width="0.8" stroke-dasharray="3 2"')
  svg += pl(R.rows.map(r => [r.r, r.y]), 'stroke="#111" stroke-width="1"') + pl(R.rows.map(r => [r.l, r.y]), 'stroke="#111" stroke-width="1"')
  R.res.forEach(x => { const i = KIND(x.net)
    for (const l of x.ls) { // the shown parts solid, the covered parts dashed (covered by any line on that side)
      const runs: { shown: boolean; pts: (readonly number[])[] }[] = []
      for (const q of l.q) { const o = R.sideOuter(x.net.edge, q[1]!), shown = !Number.isFinite(o) || x.net.edge * (q[0]! - o) >= -0.004; const last = runs[runs.length - 1]; if (last && last.shown === shown) last.pts.push(q); else runs.push({ shown, pts: last ? [last.pts[last.pts.length - 1]!, q] : [q] }) }
      if (!runs.some(r => r.shown && r.pts.length > 3)) continue // a line that never shows is not drawn at all
      for (const r of runs) svg += pl(r.pts, r.shown ? `stroke="${COLOR[i]}" stroke-width="2"` : `stroke="${COLOR[i]}" stroke-width="1" stroke-dasharray="4 3" opacity="0.7"`)
      if (runs.some(r => r.shown && r.pts.length > 3)) for (const t of l.tan) { const q = rotate(t.p, v); svg += `<circle cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="3.5" fill="#e08a2c" stroke="#fff"/>` }
    } })
  for (const d of R.detail) { let runP: (readonly number[])[] = []; const flush = () => { if (runP.length > 1) svg += pl(runP, 'stroke="#1d3c8f" stroke-width="1.6"'); runP = [] }
    for (const p of d.pts) { if (p.z) runP.push(p.q); else flush() } flush() }
  const all = R.detail.flatMap(d => d.pts), agree = all.filter(p => p.z === p.r).length / all.length
  svg += `<text x="${ox + 8}" y="${oy + 20}" font-size="15">转 ${yaw}°${pitch ? (pitch > 0 ? ' 仰' : ' 俯') + Math.abs(pitch) + '°' : ''}</text><text x="${ox + Pn - 8}" y="${oy + 20}" font-size="12" text-anchor="end" fill="#1d3c8f">两种遮挡算法一致 ${(agree * 100).toFixed(0)}%</text>`
  console.log(yaw, 'visibility agree', (agree * 100).toFixed(1) + '%', R.detail.map(d => `${d.l.name}:${d.pts.filter(p => p.z).length}/${d.pts.filter(p => p.r).length}`).join(' '))
  R.sides.forEach((x, i) => { svg += `<text x="${ox + 8}" y="${oy + Pn - 28 + i * 18}" font-size="12" fill="#333">${x.name}：中位 ${x.med.toFixed(3)} · 九成 ${x.p90.toFixed(3)} · 最大 ${x.max.toFixed(3)}</text>` })
  out.push({ yaw, sides: R.sides, nets: R.res.map(x => ({ net: x.net.name, lines: x.ls.length, med: +x.med.toFixed(4), p90: +x.p90.toFixed(4), max: +x.max.toFixed(4), g: x.ls.map(l => l.tan.map(t => +t.g.toFixed(3))) })) })
  console.log(`${yaw}:${pitch}`, R.sides.map(x => `${x.name} ${[x.med, x.p90, x.max].map(n => n.toFixed(3)).join('/')}`).join(' | '), '| lines', R.res.map(x => x.ls.length).join('/'))
})
if (LEGEND) { const lg: [string, string][] = [['#111', '黑线 = VRoid 真轮廓'], ['#1d3c8f', '深蓝 = 耳朵、下颌线（线4）、眼睑：没被挡住的部分（用 VRoid 头的遮挡算）'], ['#13a05a', '绿 = 脸那一侧拼出的轮廓线（实 = 露在外面，虚 = 被更外的线盖住）'], ['#7b3fb5', '紫 = 后脑那一侧（带颈侧）'], ['#c47a00', '橙褐 = 颈前那一侧'], ['#e08a2c', '橙点 = 纬线上和视线相切的点'], ['#d9a0a0', '浅红 = 你的线框；浅红虚线 = 我自动补的线']]
  const oy = Math.ceil(YAWS.length / COLS) * Pn; lg.forEach(([c, t], i) => { svg += `<rect x="20" y="${oy + 14 + i * 22}" width="16" height="12" fill="${c}"/><text x="44" y="${oy + 25 + i * 22}" font-size="14">${t}</text>` }) }
const base = file.replace(/\.json$/, '').replace(/.*\//, '') + (process.env.TAG ?? '')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.svg`, svg + '</svg>')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.json`, JSON.stringify({ note: 'outline lines built from tangent points on the rails + the columns between (face3d/fit/shell-outline.ts)', autos: autos.map(a => a.name), views: out }, null, 1))
if (process.env.SWEEP) for (const net of NETS) { const counts: string[] = []
  for (let yaw = 0; yaw <= 120; yaw += 3) counts.push(`${yaw}:${outlines(net, yaw).length}`)
  console.log(net.name, '轮廓线条数', counts.join(' ')) }
if (process.env.USED) { for (const l of DETAIL) USED.add(l.name)
  const mirrorOf = (n: string) => (n.includes('左') ? n.replace(/左/g, '右') : n.startsWith('右') ? n.slice(1) : n.includes('右') ? n.replace(/右/g, '左') : `右${n}`)
  const used = (n: string) => USED.has(n) || USED.has(mirrorOf(n)) // a net is used on both sides (mirrored)
  console.log('unused lines:', doc.lines.filter(l => !used(l.name)).map(l => l.name).join(' '))
  console.log('used lines:', doc.lines.filter(l => used(l.name)).length, '/', doc.lines.length) }
// ---- the cap (bowen 1793117444 「头壳就直接设定成椭圆」, 1793117490 「圆环上部就是椭圆拟合一下」): above the forehead ring the
// head is one ellipsoid, fitted to VRoid's skin there (left-right symmetric: centred on the midline, axes along the head's);
// its outline in any view is an ellipse, worked out exactly (the ellipsoid squeezed to a ball, the ball's outline circle,
// stretched back); only the part above the ring counts ----
const ringC = join(...['纬线右半前·纬线', '纬线右半后前·纬线', '纬线右半后后·纬线', '纬线左半前·纬线', '纬线左半后前·纬线', '纬线左半后后·纬线'].map(n => sample(lineOf(n).c)))
const az = (p: readonly number[]) => Math.atan2(p[0]!, p[2]!)
const ringAt = (p: readonly number[]) => { const a = az(p); let best = ringC[0]!, bd = Infinity; for (const q of ringC) { let d = Math.abs(az(q) - a); if (d > Math.PI) d = 2 * Math.PI - d; if (d < bd) { bd = d; best = q } } return best[1] }
const CAP = (() => {
  const pts = [...new Set(D.skinTris)].map(i => D.P[i]! as P3).filter(p => p[1] > ringAt(p) + 0.02)
  // A x² + B y² + C z² + D y + E z = 1, least squares
  const M = Array.from({ length: 5 }, () => new Array<number>(6).fill(0))
  for (const p of pts) { const f = [p[0] * p[0], p[1] * p[1], p[2] * p[2], p[1], p[2]]; for (let i = 0; i < 5; i++) { for (let j = 0; j < 5; j++) M[i]![j]! += f[i]! * f[j]!; M[i]![5]! += f[i]! } }
  for (let i = 0; i < 5; i++) { let m = i; for (let r = i + 1; r < 5; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[m]![i]!)) m = r; [M[i], M[m]] = [M[m]!, M[i]!]
    for (let r = 0; r < 5; r++) if (r !== i) { const k = M[r]![i]! / M[i]![i]!; for (let c = i; c < 6; c++) M[r]![c]! -= k * M[i]![c]! } }
  const [A, B, C, Dd, E] = M.map((r, i) => r[5]! / r[i]!) as [number, number, number, number, number]
  const cy = -Dd / (2 * B), cz = -E / (2 * C), K = 1 + (Dd * Dd) / (4 * B) + (E * E) / (4 * C)
  const r = [Math.sqrt(K / A), Math.sqrt(K / B), Math.sqrt(K / C)] as P3, c: P3 = [0, cy, cz]
  const res = pts.map(p => Math.abs(Math.hypot(p[0] / r[0], (p[1] - cy) / r[1], (p[2] - cz) / r[2]) - 1) * Math.min(...r)), rms = Math.sqrt(res.reduce((a, v) => a + v * v, 0) / res.length)
  console.log('cap ellipsoid centre', c.map(v => v.toFixed(3)).join(','), 'radii', r.map(v => v.toFixed(3)).join(','), 'points', pts.length, 'rms', rms.toFixed(4))
  return { c, r }
})()
/** the cap's outline in a view: the ellipse on the screen, the part above the forehead ring */
function capOutline(v: { yaw: number; pitch: number }): P3[][] {
  const d = toCamera(v), du = unit([d[0] * CAP.r[0], d[1] * CAP.r[1], d[2] * CAP.r[2]] as P3)
  const t = Math.abs(du[1]) < 0.9 ? ([0, 1, 0] as P3) : ([1, 0, 0] as P3), e1 = unit([du[1] * t[2] - du[2] * t[1], du[2] * t[0] - du[0] * t[2], du[0] * t[1] - du[1] * t[0]] as P3)
  const e2: P3 = [du[1] * e1[2] - du[2] * e1[1], du[2] * e1[0] - du[0] * e1[2], du[0] * e1[1] - du[1] * e1[0]]
  const ring = Array.from({ length: 361 }, (_, i) => { const a = (i * Math.PI) / 180, u = [0, 1, 2].map(k => Math.cos(a) * e1[k]! + Math.sin(a) * e2[k]!); return [0, 1, 2].map(k => CAP.c[k]! + u[k]! * CAP.r[k]!) as P3 })
  const runs: P3[][] = []; let cur: P3[] = []
  for (const p of ring) { if (p[1] >= ringAt(p)) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = [] } }
  if (cur.length > 1) { if (runs.length && ring[0]![1] >= ringAt(ring[0]!)) runs[0] = [...cur, ...runs[0]!]; else runs.push(cur) }
  return runs
}
// ---- every direction (bowen 1793115000): the outline lines across (rails, the screen's sides) and up and down (the nets
// crosswise, the screen's top and bottom) together; round the head's middle on the screen, in every direction the outer
// line shows; compared with VRoid's outline the same way (distance from the middle, per degree) ----
const USE_CAP = !process.env.NOCAP
const TNETS = KINDS.flatMap(({ n, kind }) => { const t = transpose(n); return ([1, -1] as const).map(edge => Object.assign({ ...t, edge }, { kind })) })
// ---- the outline fitted to tangent points (bowen 1793119514 「一条线就只提供一个切点，然后这个位置就一条线（比如后脑勺位置）去拟合
// 这些切点，而不是接一部分曲线再接一部分点」): in a view every line gives at most one tangent point — the middle of its stretch that
// lies on the outer edge of all the lines (seen round the head's middle on the screen); a line wholly inside the others gives
// none. The cap above the forehead ring is the ellipsoid's ellipse; from one end of it round the rest of the head to the other,
// as few cubics as fit those points (one, split at the worst point while any point is off by more than TOL), smooth at the
// joints (the tangent there along the neighbours) and running on from the ellipse at its ends ----
const TOL = Number(process.env.TOL ?? 0.012), CORNERS = !!process.env.CORNERS, CY0 = Number(process.env.CY0 ?? -0.45), CZ0 = Number(process.env.CZ0 ?? 0)
const FIT_LINES = (() => { const yBase = Math.max(P('后颈')[1], P('颈前')[1])
  // (not the ears, nor the eyelids; the neck's base ring 线11 closes the shape but gives no tangent point: below it the neck
  // is cut, no outline)
  const own = doc.lines.filter(l => !/耳根—耳尖|耳尖—耳垂|耳垂—下耳根|眼睑/.test(l.name)).map(l => ({ name: l.name, c: sample(l.c, 60), noTan: /^右?线11/.test(l.name) }))
  return [...own, ...autos.map(a => ({ name: a.name, c: a.c, noTan: false }))].filter(l => l.noTan || Math.max(...l.c.map(p => p[1])) > yBase + 0.02) })()
/** cubic through q (chord-length t), ends fixed, end tangents along t0 / t1 (unit, pointing into the curve), lengths by least squares */
function fitTan(q: number[][], t0: number[], t1: number[]): number[][] {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + Math.hypot(q[i]![0]! - q[i - 1]![0]!, q[i]![1]! - q[i - 1]![1]!))
  const P0 = q[0]!, P3_ = q[n]!, chord = Math.hypot(P3_[0]! - P0[0]!, P3_[1]! - P0[1]!)
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0
  for (let i = 0; i <= n; i++) { const t = L[i]! / (L[n]! || 1), u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t
    const A1 = [t0[0]! * b1, t0[1]! * b1], A2 = [t1[0]! * b2, t1[1]! * b2], r = [q[i]![0]! - (b0 + b1) * P0[0]! - (b2 + b3) * P3_[0]!, q[i]![1]! - (b0 + b1) * P0[1]! - (b2 + b3) * P3_[1]!]
    c00 += A1[0]! * A1[0]! + A1[1]! * A1[1]!; c01 += A1[0]! * A2[0]! + A1[1]! * A2[1]!; c11 += A2[0]! * A2[0]! + A2[1]! * A2[1]!; x0 += A1[0]! * r[0]! + A1[1]! * r[1]!; x1 += A2[0]! * r[0]! + A2[1]! * r[1]! }
  const det = c00 * c11 - c01 * c01; let a1 = det ? (x0 * c11 - x1 * c01) / det : chord / 3, a2 = det ? (c00 * x1 - c01 * x0) / det : chord / 3
  if (!(a1 > chord * 0.02) || !(a2 > chord * 0.02) || a1 > chord * 1.5 || a2 > chord * 1.5) { a1 = chord / 3; a2 = chord / 3 } // degenerate: thirds
  return [P0, [P0[0]! + t0[0]! * a1, P0[1]! + t0[1]! * a1], [P3_[0]! + t1[0]! * a2, P3_[1]! + t1[1]! * a2], P3_]
}
const cub2 = (c: number[][], t: number) => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1].map(k => w.reduce((s2, wi, j) => s2 + wi * c[j]![k]!, 0)) }
const nrm2 = (v: number[]) => { const m = Math.hypot(v[0]!, v[1]!) || 1; return [v[0]! / m, v[1]! / m] }
/** pieces through pts[i..j] (screen points), tangents given at the ends; split at the worst point while it is off by > TOL */
function fitRun(pts: number[][], tans: number[][], i: number, j: number, out: number[][][]) {
  const seg = pts.slice(i, j + 1), c = fitTan(seg, tans[i]!, tans[j]!.map(v => -v))
  const S = Array.from({ length: 81 }, (_, k) => cub2(c, k / 80)), err = seg.map(p => Math.min(...S.map(q => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!))))
  const w = err.reduce((m, e, k) => (k > 0 && k < seg.length - 1 && e > err[m]! ? k : m), 1)
  if (j - i >= 2 && err[w]! > TOL) { fitRun(pts, tans, i, i + w, out); fitRun(pts, tans, i + w, j, out) } else out.push(c)
}
/** the outer edge of the lines on the screen, in order: the line samples (and the cap's ellipse) stamped as discs of radius
 * CLOSE, the gaps between them closed (dilated, then eroded by the same radius), the shape's outline traced once round */
const CLOSE = Number(process.env.CLOSE ?? 0.1)
function outerEdge(pts: number[][]) {
  const G = W, S2 = F.S, toPx = (q: number[]) => [F.cx + q[0]! * S2, F.cy - q[1]! * S2], R = CLOSE * S2
  const dil = new Uint8Array(G * G)
  for (const q of pts) { const [x, y] = toPx(q) as [number, number]; for (let j = Math.max(0, Math.floor(y - R)); j <= Math.min(G - 1, Math.ceil(y + R)); j++) for (let i = Math.max(0, Math.floor(x - R)); i <= Math.min(G - 1, Math.ceil(x + R)); i++) if ((i - x) ** 2 + (j - y) ** 2 <= R * R) dil[j * G + i] = 1 }
  // erode: distance (chamfer) to outside the dilated shape, keep ≥ R
  const dist = new Float32Array(G * G).fill(1e9)
  for (let k = 0; k < G * G; k++) if (!dil[k]) dist[k] = 0
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const k = j * G + i; if (i > 0) dist[k] = Math.min(dist[k]!, dist[k - 1]! + 1); if (j > 0) dist[k] = Math.min(dist[k]!, dist[k - G]! + 1); if (i > 0 && j > 0) dist[k] = Math.min(dist[k]!, dist[k - G - 1]! + 1.414); if (i < G - 1 && j > 0) dist[k] = Math.min(dist[k]!, dist[k - G + 1]! + 1.414) }
  for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--) { const k = j * G + i; if (i < G - 1) dist[k] = Math.min(dist[k]!, dist[k + 1]! + 1); if (j < G - 1) dist[k] = Math.min(dist[k]!, dist[k + G]! + 1); if (i < G - 1 && j < G - 1) dist[k] = Math.min(dist[k]!, dist[k + G + 1]! + 1.414); if (i > 0 && j < G - 1) dist[k] = Math.min(dist[k]!, dist[k + G - 1]! + 1.414) }
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < G && j < G && dist[j * G + i]! >= R - 0.5
  let s0: [number, number] | null = null
  for (let j = 0; j < G && !s0; j++) for (let i = 0; i < G && !s0; i++) if (on(i, j)) s0 = [i, j]
  if (!s0) return []
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0]
  for (let cur = s0, back: [number, number] = [s0[0] - 1, s0[1]], n = 0; n < 20000; n++) {
    const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0[0] && cur[1] === s0[1])) break; cells.push(cur) }
  return cells.map(([i, j]) => [(i + 0.5 - F.cx) / S2, (F.cy - (j + 0.5)) / S2])
}
function fitOutline(v: { yaw: number; pitch: number }) {
  const Ls = FIT_LINES.map(l => ({ name: l.name, noTan: l.noTan, p: l.c, q: l.c.map(p => rotate(p, v) as unknown as number[]) }))
  const capRuns = USE_CAP ? capOutline(v) : [], capQ = capRuns.map(r => r.map(p => rotate(p, v) as unknown as number[]))
  // the edge, in order round the shape
  const edge = outerEdge([...Ls.flatMap(L => L.q), ...capQ.flat()]), nE = edge.length
  const near = (q: number[]) => { let bi = 0, bd = Infinity; for (let i = 0; i < nE; i++) { const d = (edge[i]![0]! - q[0]!) ** 2 + (edge[i]![1]! - q[1]!) ** 2; if (d < bd) { bd = d; bi = i } } return { i: bi, d: Math.sqrt(bd) } }
  const EPS = 2.5 / F.S
  // the edge along the neck's base ring is the neck's cut: the outline is not carried across it (it stops on either side)
  const cutAt = new Uint8Array(nE); for (const L of Ls) if (L.noTan) for (const q of L.q) { const n = near(q); if (n.d < EPS * 1.6) cutAt[n.i] = 1 }
  // one tangent point per line: the middle of its longest stretch on the edge; none above the forehead ring (the cap's)
  const tan: { name: string; q: number[]; p: P3; at: number }[] = []
  for (const L of Ls) { if (L.noTan) continue; let best: [number, number] | null = null, s0 = -1
    const hit = L.q.map((q, i) => { const n = near(q); return n.d < EPS && !(capRuns.length && L.p[i]![1] >= ringAt(L.p[i]!)) ? n.i : -1 })
    for (let i = 0; i <= L.q.length; i++) { const e = i < L.q.length && hit[i]! >= 0; if (e && s0 < 0) s0 = i; if (!e && s0 >= 0) { if (!best || i - 1 - s0 > best[1] - best[0]) best = [s0, i - 1]; s0 = -1 } }
    if (best) { const m = Math.round((best[0] + best[1]) / 2); tan.push({ name: L.name, q: L.q[m]!, p: L.p[m]!, at: hit[m]! })
      if (CORNERS && best[1] - best[0] >= 0.75 * (L.q.length - 1)) for (const e of [0, L.q.length - 1]) if (hit[e]! >= 0) tan.push({ name: `${L.name} 端`, q: L.q[e]!, p: L.p[e]!, at: hit[e]! }) } }
  for (let i = tan.length - 1; i >= 0; i--) if (tan.some((t, j) => j < i && Math.hypot(t.q[0]! - tan[i]!.q[0]!, t.q[1]! - tan[i]!.q[1]!) < 0.01)) tan.splice(i, 1)
  // from one end of the cap round the edge (the way not under the cap) to the other end; with no cap, all round
  const cap = capQ.slice().sort((a, b) => b.length - a.length)[0]
  let seq: number[][], tans: number[][], cuts: number[] = []
  const t2 = (a: number[], b: number[]) => nrm2([b[0]! - a[0]!, b[1]! - a[1]!])
  if (cap && cap.length > 2 && nE > 10) {
    const iA = near(cap[cap.length - 1]!).i, iB = near(cap[0]!).i, iM = near(cap[Math.floor(cap.length / 2)]!).i
    const fwd = (x: number) => ((x - iA) % nE + nE) % nE, capFwd = fwd(iM) < fwd(iB) // the cap runs iA → iB forwards along the edge?
    // walk from the cap's end away from it: the cap's end (A) on the side it ends, round to its start (B)
    const startEnd = capFwd ? cap[0]! : cap[cap.length - 1]!, startIdx = capFwd ? iB : iA, stopEnd = capFwd ? cap[cap.length - 1]! : cap[0]!, stopIdx = capFwd ? iA : iB
    const span = ((stopIdx - startIdx) % nE + nE) % nE, key = (i: number) => ((i - startIdx) % nE + nE) % nE
    const mid = tan.filter(t => key(t.at) > 2 && key(t.at) < span - 2).sort((a, b) => key(a.at) - key(b.at)).map(t => t.q)
    const tStart = capFwd ? t2(cap[1]!, cap[0]!) : t2(cap[cap.length - 2]!, cap[cap.length - 1]!), tStop = capFwd ? t2(cap[cap.length - 1]!, cap[cap.length - 2]!) : t2(cap[0]!, cap[1]!)
    const midT = tan.filter(t => key(t.at) > 2 && key(t.at) < span - 2).sort((a, b) => key(a.at) - key(b.at))
    seq = [startEnd, ...mid, stopEnd]; tans = seq.map((_, i) => (i === 0 ? tStart : i === seq.length - 1 ? tStop.map(x => -x) : t2(seq[i - 1]!, seq[i + 1]!)))
    // breaks: between two neighbours whose stretch of edge runs over the cut
    const ats = [startIdx, ...midT.map(t => t.at), stopIdx]
    cuts = []; for (let k = 0; k + 1 < ats.length; k++) { let crossed = false; for (let x = ats[k]!; ((x - ats[k + 1]!) % nE + nE) % nE !== 0; x = (x + 1) % nE) if (cutAt[x]) { crossed = true; break } if (crossed) cuts.push(k) }
  } else { seq = tan.slice().sort((a, b) => a.at - b.at).map(t => t.q); if (seq.length) seq.push(seq[0]!); const m = seq.length - 1; tans = seq.map((_, i) => t2(seq[(i - 1 + m) % m]!, seq[(i + 1) % m]!)) }
  // fitted run by run (a break at the cut: there the ends' tangents are along their neighbours only)
  const pieces: number[][][] = []
  if (seq.length >= 2) { let i0 = 0; for (const k of [...cuts, seq.length - 1]) { const i1 = k; if (i1 > i0) {
      if (cuts.includes(i1)) tans[i1] = t2(seq[Math.max(i0, i1 - 1)]!, seq[i1]!)
      if (cuts.includes(i0 - 1)) tans[i0] = t2(seq[i0]!, seq[Math.min(i1, i0 + 1)]!)
      fitRun(seq, tans, i0, i1, pieces) } i0 = k + 1 } }
  return { tan, pieces, cap: capQ, edge }
}
function polar(yaw: number, pitch: number) {
  const v = { yaw, pitch }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4)), inside = (x: number, y: number) => { const i = Math.round(F.cx + x * F.S), j = Math.round(F.cy - y * F.S); return i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity }
  const c0 = rotate([0, -0.45, 0], v), cx = c0[0], cy = c0[1], A = 360
  // VRoid: per degree the farthest inside point along the ray (the outline), and whether it is the neck's cut (bottom rows)
  let yLow = Infinity; for (let j = W - 1; j >= 0; j--) { let any = false; for (let i = 0; i < W; i++) if (ras.zb[j * W + i]! > -Infinity) { any = true; break } if (any) { yLow = (F.cy - (j + 0.5)) / F.S; break } }
  // (the neck's cut is no outline: where the outline point lies on the head below the neck's base ring, 线11, it is left out)
  const ax = screenAxes(v), fw = toCamera(v), yBase = Math.max(P('后颈')[1], P('颈前')[1]) + 0.04
  const headY = (x: number, y: number) => { const i = Math.round(F.cx + x * F.S), j = Math.round(F.cy - y * F.S), z = ras.zb[j * W + i]!; return ax.right[1] * x + ax.up[1] * y + fw[1] * z }
  const truth = Array.from({ length: A }, (_, a) => { const t = (a * Math.PI) / 180, dx = Math.cos(t), dy = Math.sin(t); let r = 0; for (let s = 0; s < 3; s += 0.004) if (inside(cx + dx * s, cy + dy * s)) r = s; return { r, cut: cy + dy * r < yLow + 0.06 || headY(cx + dx * r, cy + dy * r) < yBase } })
  // tangent points in eight directions (bowen 1793117729: looking down 60°, the face's lower outline runs slanting to the chin;
  // farthest out across the screen fell on 下耳根 and the outline went down the jawline, while slanting-farthest lies on the
  // cheek line 太阳穴 → 颧骨 → 下巴), each with the nets both ways (rails and crosswise)
  const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const)
  const FIT = !process.env.OLDNET, fo = FIT ? fitOutline(v) : null
  const lines = FIT ? fo!.pieces.map(c => { const q = Array.from({ length: 61 }, (_, i) => [...cub2(c, i / 60), 0] as unknown as P3); return { kind: 0, axis: 0, tan: [] as { p: P3; g: number }[], pts: q, q } }) : KINDS.flatMap(({ n, kind }) => { const t = transpose(n); return DIRS.flatMap(dv => [n, t].flatMap((net, axis) => outlines(net, yaw, pitch, axis as 0 | 1, dv).map(l => ({ kind, axis, tan: l.tan, pts: l.pts, q: l.pts.map(p => rotate(p, v)) })))) })
  if (USE_CAP) for (const run of capOutline(v)) lines.push({ kind: 4, axis: 0, tan: [], pts: run, q: run.map(p => rotate(p, v)) })
  // the ears' own lines take part too: where an ear is outside the head it is the outline (whichever is outer shows)
  for (const l of DETAIL.filter(d => /耳/.test(d.name))) { const pts = sample(l.c, 60); lines.push({ kind: 3, axis: 0, tan: [], pts, q: pts.map(p => rotate(p, v)) }) }
  // the built outline per degree: the farthest crossing of any line with the ray
  const best = new Array<number>(A).fill(-Infinity), headBest = new Array<number>(A).fill(-Infinity)
  const angR = (q: readonly number[]) => ({ a: ((Math.atan2(q[1]! - cy, q[0]! - cx) * 180) / Math.PI + 360) % 360, r: Math.hypot(q[0]! - cx, q[1]! - cy) })
  for (const L of lines) for (let i = 0; i + 1 < L.q.length; i++) { const p = angR(L.q[i]!), q = angR(L.q[i + 1]!); let da = q.a - p.a; if (da > 180) da -= 360; if (da < -180) da += 360
    const steps = Math.max(1, Math.ceil(Math.abs(da))); for (let s = 0; s <= steps; s++) { const f = s / steps, a = Math.round(p.a + da * f + 360) % 360, r = p.r + (q.r - p.r) * f; if (r > best[a]!) best[a] = r; if (L.kind !== 3 && r > headBest[a]!) headBest[a] = r } }
  // (where only an ear's line is there — the open neck's cut seen past it — nothing is compared)
  for (let a = 0; a < A; a++) if (!Number.isFinite(headBest[a]!)) best[a] = -Infinity
  const d = truth.map((t, a) => (t.cut || !Number.isFinite(best[a]!) ? NaN : Math.abs(t.r - best[a]!))).filter(Number.isFinite).sort((x, y) => x - y)
  const shown = (q: readonly number[]) => { const { a, r } = angR(q); return r >= best[Math.round(a) % 360]! - 0.01 }
  return { lines, shown, fo, med: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN, max: d[d.length - 1] ?? NaN, truth, cx, cy }
}
if (process.env.POLAR) {
  const Vs = (process.env.POLAR === '1' ? '0:0,45:0,90:0,0:30,45:30,90:30,0:-30,45:-30,90:-30,0:-60,45:-60,90:-60,0:60,45:60,90:60,135:-30' : process.env.POLAR).split(',').map(t => t.split(':').map(Number) as [number, number])
  const C2 = 4; let sv = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${C2 * Pn} ${C2 * Pn}" width="${C2 * Pn}" height="${C2 * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
  Vs.forEach(([yaw, pitch], k) => {
    const R = polar(yaw, pitch), v = { yaw, pitch }, ox = (k % C2) * Pn, oy = Math.floor(k / C2) * Pn, X = (x: number) => ox + F.cx + x * F.S, Y = (y: number) => oy + F.cy - y * F.S
    const pl = (pts: (readonly number[])[], st: string) => `<polyline fill="none" ${st} points="${pts.map(p => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' ')}"/>`
    sv += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>`
    for (const l of doc.lines) sv += pl(sample(l.c, 60).map(p => rotate(p, v)), 'stroke="#e3b5b5" stroke-width="0.6"')
    sv += pl([...R.truth.map((t, a) => [R.cx + Math.cos((a * Math.PI) / 180) * t.r, R.cy + Math.sin((a * Math.PI) / 180) * t.r]), [R.cx + R.truth[0]!.r, R.cy]], 'stroke="#111" stroke-width="1"')
    for (const L of R.lines) { let run: (readonly number[])[] = []; const flush = () => { if (run.length > 1) sv += pl(run, `stroke="${COLOR[L.kind]}" stroke-width="2.2"${L.axis ? ' stroke-opacity="0.85"' : ''}`); run = [] }
      for (const q of L.q) { if (R.shown(q)) run.push(q); else flush() } flush() }
    if (R.fo && process.env.SHOWEDGE) sv += pl(R.fo.edge.map(q => [q[0]!, q[1]!]), 'stroke="#3aa0ff" stroke-width="0.8" stroke-dasharray="2 2"')
    if (R.fo) for (const t of R.fo.tan) sv += `<circle cx="${X(t.q[0]!).toFixed(1)}" cy="${Y(t.q[1]!).toFixed(1)}" r="3" fill="#e08a2c" stroke="#fff" stroke-width="0.8"/>`
    sv += `<text x="${ox + 8}" y="${oy + 20}" font-size="15">转 ${yaw}°${pitch ? (pitch > 0 ? ' 仰' : ' 俯') + Math.abs(pitch) + '°' : ''}</text><text x="${ox + 8}" y="${oy + Pn - 10}" font-size="12" fill="#333">绕一圈 vs 真轮廓：中位 ${R.med.toFixed(3)} · 九成 ${R.p90.toFixed(3)} · 最大 ${R.max.toFixed(3)}</text>`
    console.log(`${yaw}:${pitch}`, 'polar', [R.med, R.p90, R.max].map(n => n.toFixed(3)).join('/'))
  })
  writeFileSync(`face3d/viewer/ref-shell/outline-${file.replace(/\.json$/, '').replace(/.*\//, '')}-polar.svg`, sv + '</svg>')
}
// ---- for the 3D viewer (face3d/viewer/shelloutline.html): the nets (each once per side; both edges are taken there), the
// automatic lines, the inner lines and the wire, all as samples / cubics ----
if (process.env.EXPORT) {
  const r4 = (c: Chain) => c.map(p => p.map(v => +v.toFixed(4)))
  writeFileSync(process.env.EXPORT, JSON.stringify({
    note: `bowen's head wire (${file}) as outline nets for the viewer (face3d/fit/shell-outline.ts)`,
    nets: KINDS.map(({ n, kind }) => ({ name: n.name, kind, top: n.top ?? null, bottom: n.bottom ?? null, cols: n.cols.map(cs => cs.map(c => c && r4(c))), rails: n.rails.map(r => ({ name: r.name, pieces: r.pieces.map(pc => ({ from: pc.from, c: r4(pc.c) })) })) })),
    tnets: KINDS.map(({ n, kind }) => { const t = transpose(n); return { name: t.name, kind, top: null, bottom: null, cols: t.cols.map(cs => cs.map(c => c && r4(c))), rails: t.rails.map(r => ({ name: r.name, pieces: r.pieces.map(pc => ({ from: pc.from, c: r4(pc.c) })) })) } }),
    cap: { c: CAP.c, r: CAP.r }, ring: r4(ringC), fitLines: FIT_LINES.map(l => ({ name: l.name, noTan: l.noTan, c: r4(l.c) })),
    autos: autos.map(a => ({ name: a.name, c: r4(a.c) })), detail: DETAIL.map(l => ({ name: l.name, c: l.c })), wire: doc.lines.map(l => ({ name: l.name, c: l.c })),
  }))
  console.log('exported', process.env.EXPORT)
}
