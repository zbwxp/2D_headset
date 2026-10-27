// A smooth outline from bowen's head wire while the head turns (bowen 1793112590 「将语义点沿着这些纬线移动…将这些点用它临近的
// 语义线以及临近的bezier线的handle的曲率，就能定义出轮廓」; 1793112794 「我只是想获得任意角度稳定平滑合理的线框」). Experiment,
// the face side (x > 0, the screen's right while yaw > 0), pitch 0:
// - columns (top to bottom, bowen's vertical lines): C0 the midline front, C1 the outer face 颅顶 → 交点1 → 太阳穴 → 颧骨 → 下巴,
//   C2 the face contour 颅顶 → 交点2 → 上耳根 → 下耳根 → 下巴, C3 the midline back 颅顶 → 后脑;
// - rails (bowen's ·纬线 lines, across the columns): R1 the forehead ring (额前 → 交点1 → 交点2 → 后脑), R2 太阳穴 → 上耳根,
//   R3 颧骨 → 下耳根;
// - in a view, on each rail its tangent point (farthest right on the screen), at a fraction f between the two columns it lies
//   between; the outline = 颅顶 → R1's point → R2's → R3's → 下巴, each piece one cubic whose handles are the two columns'
//   handles over that stretch, mixed by f (the outline runs between the columns as the point sits between them);
// - compared with VRoid's outline (its right edge) and with the wire's envelope, row by row, crown to chin.
// Writes face3d/viewer/ref-shell/outline-<doc>.svg/.json. Run: npx vite-node face3d/fit/shell-outline.ts <doc-sym.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
type P3 = [number, number, number]
interface Ln { id: number; name: string; a: number; b: number; c: P3[] }
interface Doc { points: { id: number; name: string; p: P3 }[]; lines: Ln[] }
const file = process.argv[2]!, doc = JSON.parse(readFileSync(file, 'utf8')) as Doc
const b = readFileSync('face3d/fit/ref/test.vrm'), D = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const W = 400, F = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.42 }
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const P = (n: string) => doc.points.find(p => p.name === n)!
const lineOf = (n: string) => { const l = doc.lines.find(k => k.name === n); if (!l) throw Error(`no line ${n}`); return l }
/** a line as a cubic running from point `from` to the other end */
const run = (n: string, from: string): P3[] => { const l = lineOf(n), f = P(from).id; if (l.a === f) return l.c; if (l.b === f) return [...l.c].reverse(); throw Error(`${n} does not start at ${from}`) }
const split = (c: P3[], t: number): [P3[], P3[]] => { const L = (a: P3, b: P3): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const a = L(c[0]!, c[1]!), q = L(c[1]!, c[2]!), d = L(c[2]!, c[3]!), e = L(a, q), f = L(q, d), g = L(e, f); return [[c[0]!, a, e, g], [g, f, d, c[3]!]] }
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mix = (a: P3, b: P3, f: number): P3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]

// ---- the shell, for the automatic links (pressed onto the outermost skin seen from the head's centre) ----
const T = D.skinTris, PT = D.P, CEN: P3 = [0, -0.3, 0]
function farHit(o: P3, d: P3): P3 | null {
  let best = -Infinity
  for (let t = 0; t < T.length; t += 3) { const a = PT[T[t]!]!, b2 = PT[T[t + 1]!]!, c = PT[T[t + 2]!]!
    const e1 = sub(b2 as P3, a as P3), e2 = sub(c as P3, a as P3), p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0]! + e1[1] * p[1]! + e1[2] * p[2]!
    if (Math.abs(det) < 1e-12) continue
    const tv = sub(o, a as P3), u = (tv[0] * p[0]! + tv[1] * p[1]! + tv[2] * p[2]!) / det; if (u < 0 || u > 1) continue
    const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], w = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) / det; if (w < 0 || u + w > 1) continue
    const tt = (e2[0] * q[0]! + e2[1] * q[1]! + e2[2] * q[2]!) / det; if (tt > best) best = tt }
  return Number.isFinite(best) ? add(o, [d[0] * best, d[1] * best, d[2] * best]) : null
}
const unit = (v: P3): P3 => { const m = Math.hypot(...v) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
const press = (q: P3) => farHit(CEN, unit(sub(q, CEN))) ?? q
/** a link from a to b kept to the shell: round from the head's centre, pressed onto the outermost skin, pulled straight */
function hugLink(a: P3, b2: P3, n = 30): P3[] {
  let path = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? a : i === n ? b2 : press(mix(a, b2, i / n))))
  for (let r = 0; r < 6; r++) path = path.map((p, i) => (i === 0 || i === n ? p : press(mix(path[i - 1]!, path[i + 1]!, 0.5))))
  return path
}

// ---- chains: a run of cubics (or a sampled path), walked by length ----
type Chain = P3[] // samples, top to bottom / left to right
const sample = (c: P3[], n = 40): Chain => Array.from({ length: n + 1 }, (_, i) => cubic(c, i / n))
const join = (...cs: Chain[]): Chain => cs.flatMap((c, i) => (i ? c.slice(1) : c))
const lens = (c: Chain) => { const L = [0]; for (let i = 1; i < c.length; i++) L.push(L[i - 1]! + Math.hypot(...sub(c[i]!, c[i - 1]!))); return L }
function at(c: Chain, u: number): P3 { const L = lens(c), s = u * L[L.length - 1]!; let i = 1; while (i < L.length - 1 && L[i]! < s) i++; const f = (s - L[i - 1]!) / ((L[i]! - L[i - 1]!) || 1); return mix(c[i - 1]!, c[i]!, Math.max(0, Math.min(1, f))) }
/** a chain cut at its sample nearest q (or, by height, at y): [before, after] */
const cutAt = (c: Chain, i: number): [Chain, Chain] => [c.slice(0, i + 1), c.slice(i)]
const nearestIdx = (c: Chain, q: P3) => c.reduce((m, p, i) => (Math.hypot(...sub(p, q)) < Math.hypot(...sub(c[m]!, q)) ? i : m), 0)

// ---- the net (face side = the right: names 右…). The side-face line (bowen 1793113218 「我提供的侧脸线也应该算作线条」) is
// column C0 at every level ----
const profile = join(sample(run('眉心—颅顶', '颅顶')), sample(run('鼻尖—眉心', '眉心')), sample(run('上唇—鼻尖', '鼻尖')), sample(run('下唇—上唇', '上唇')), sample(run('下巴—下唇', '下唇')))
// where the 太阳穴 and 颧骨 levels meet the side-face line: its frontmost point at their height
const atHeight = (y: number) => { let bi = 0, bz = -Infinity; for (let i = 1; i < profile.length; i++) { const a = profile[i - 1]!, c = profile[i]!; if ((a[1] - y) * (c[1] - y) <= 0 && Math.max(a[2], c[2]) > bz) { bz = Math.max(a[2], c[2]); bi = i } } return bi }
const iF = nearestIdx(profile, P('额前').p), i2 = atHeight(P('右太阳穴').p[1]), i3 = atHeight(P('右颧骨').p[1])
const [p0, r0] = cutAt(profile, iF), [p1, r1] = cutAt(r0, i2 - iF), [p2, p3] = cutAt(r1, i3 - i2)
const M2 = profile[i2]!, M3 = profile[i3]!
// columns per stretch, each from the upper rail to the lower one (null: that column does not reach this stretch)
const COL: Record<'C0' | 'C1' | 'C2' | 'C3', (Chain | null)[]> = {
  C0: [p0, p1, p2, p3],
  C1: [sample(run('右线2前', '颅顶')), sample(run('右线2后', '右交点1')), sample(run('右线1', '右太阳穴')), sample(run('右线3', '右颧骨'))],
  C2: [sample(run('右线5后', '颅顶')), sample(run('右线5前', '右交点2')), sample(run('右线2', '右上耳根')), sample(run('右线4', '右下耳根'))],
  C3: [sample(run('颅顶—后脑', '颅顶')), null, null, null],
}
const ORDER = ['C0', 'C1', 'C2', 'C3'] as const
// rails: pieces from one column to the next; the links from the side-face line to 太阳穴 and 颧骨 are automatic (bowen has not
// drawn them; his own lines can take their place)
const RAILS: { name: string; pieces: { c: Chain; from: number; auto?: boolean }[] }[] = [
  { name: 'R1 额头那圈', pieces: [{ c: sample(run('纬线右半前·纬线', '额前')), from: 0 }, { c: sample(run('纬线右半后前·纬线', '右交点1')), from: 1 }, { c: sample(run('纬线右半后后·纬线', '右交点2')), from: 2 }] },
  { name: 'R2 太阳穴那层', pieces: [{ c: hugLink(M2, P('右太阳穴').p), from: 0, auto: true }, { c: sample(run('右耳根太阳穴·纬线', '右太阳穴')), from: 1 }] },
  { name: 'R3 颧骨那层', pieces: [{ c: hugLink(M3, P('右颧骨').p), from: 0, auto: true }, { c: sample(run('右下耳根颧骨·纬线', '右颧骨')), from: 1 }] },
]
/** one view: on each rail its tangent point (farthest right) and where it sits across the columns (g: C0 = 0 … C3 = 3); the
 * outline down each stretch = the two columns it lies between, mixed by g (g sliding from the upper point's to the lower's),
 * nudged so it passes through the tangent points exactly */
function outline(yaw: number, pitch = 0) {
  const v = { yaw, pitch }, X = (p: P3) => rotate(p, v)[0]
  const tan = RAILS.map(r => { let best = { x: -Infinity, p: [0, 0, 0] as P3, g: 0 }
    for (const pc of r.pieces) { const L = lens(pc.c), tot = L[L.length - 1]!; pc.c.forEach((p, i) => { const x = X(p); if (x > best.x) best = { x, p, g: pc.from + L[i]! / tot } }) }
    return best })
  const ends = [{ p: P('颅顶').p, g: tan[0]!.g }, ...tan, { p: P('下巴').p, g: tan[2]!.g }]
  const pts: P3[] = []
  for (let k = 0; k < 4; k++) {
    const top = ends[k]!, bot = ends[k + 1]!, have = ORDER.map((c, i) => (COL[c][k] ? i : -1)).filter(i => i >= 0), lo = Math.min(...have), hi = Math.max(...have)
    const base = (u: number) => { const g = Math.max(lo, Math.min(hi, top.g + (bot.g - top.g) * u)), i = Math.min(hi - 1, Math.floor(g)), w = g - i
      return w <= 0 ? at(COL[ORDER[i]!][k]!, u) : mix(at(COL[ORDER[i]!][k]!, u), at(COL[ORDER[i + 1]!][k]!, u), w) }
    const dTop = sub(top.p, base(0)), dBot = sub(bot.p, base(1))
    for (let j = k ? 1 : 0; j <= 60; j++) { const u = j / 60; pts.push(add(base(u), add(mix([0, 0, 0], dTop, 1 - u), mix([0, 0, 0], dBot, u)))) }
  }
  return { tan, pts }
}

// ---- compare: right edge of VRoid's outline vs the built outline vs the wire's envelope ----
function compare(yaw: number) {
  const v = { yaw, pitch: 0 }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4)), on = (x: number, y: number) => ras.zb[y * W + x]! > -Infinity
  const rows: { y: number; r: number }[] = []
  for (let j = 0; j < W; j++) { let r = -1; for (let i = 0; i < W; i++) if (on(i, j)) r = i; if (r >= 0) rows.push({ y: (F.cy - (j + 0.5)) / F.S, r: (r + 0.5 - F.cx) / F.S }) }
  const o = outline(yaw), q = o.pts.map(p => rotate(p, v))
  const wire = doc.lines.map(l => Array.from({ length: 121 }, (_, i) => rotate(cubic(l.c, i / 120), v)))
  const at = (poly: (readonly number[])[], y: number) => { let hi = -Infinity; for (let i = 0; i + 1 < poly.length; i++) { const a = poly[i]!, c = poly[i + 1]!; if ((a[1]! - y) * (c[1]! - y) > 0 || a[1] === c[1]) continue; hi = Math.max(hi, a[0]! + ((y - a[1]!) / (c[1]! - a[1]!)) * (c[0]! - a[0]!)) } return hi }
  const yTop = rotate(P('颅顶').p, v)[1], yBot = rotate(P('下巴').p, v)[1]
  const g = rows.filter(r => r.y <= yTop && r.y >= yBot).map(r => ({ y: r.y, true: r.r, built: at(q, r.y), env: Math.max(...wire.map(w => at(w, r.y))) }))
  const st = (k: 'built' | 'env') => { const d = g.map(r => r.true - r[k]).filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b); return { med: d[Math.floor(d.length / 2)] ?? NaN, p90: d[Math.floor(d.length * 0.9)] ?? NaN, max: d[d.length - 1] ?? NaN } }
  return { yaw, o, q, wire, rows, g, built: st('built'), env: st('env') }
}

const YAWS = process.env.YAWS ? process.env.YAWS.split(',').map(Number) : [0, 15, 30, 45, 60, 75, 90, 105], Pn = 400, COLS = Number(process.env.COLS ?? 4), LEGEND = !!process.env.LEGEND, out: unknown[] = []
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS * Pn} ${COLS * Pn}" width="${COLS * Pn}" height="${COLS * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
YAWS.forEach((yaw, k) => {
  const R = compare(yaw), ox = (k % COLS) * Pn, oy = Math.floor(k / COLS) * Pn, X = (x: number) => ox + F.cx + x * F.S, Y = (y: number) => oy + F.cy - y * F.S
  const pl = (pts: (readonly number[])[], st: string) => `<polyline fill="none" ${st} points="${pts.map(p => `${X(p[0]!).toFixed(1)},${Y(p[1]!).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>`
  svg += `<path fill="#e9e7e3" stroke="none" d="${R.rows.map(r => `M${X(-2).toFixed(1)},${Y(r.y).toFixed(1)}H${X(r.r).toFixed(1)}`).join('')}"/>`
  for (const w of R.wire) svg += pl(w, 'stroke="#d9a0a0" stroke-width="0.6"')
  svg += pl(R.rows.map(r => [r.r, r.y]), 'stroke="#111" stroke-width="1"')
  svg += pl(R.g.filter(r => Number.isFinite(r.env)).map(r => [r.env, r.y]), 'stroke="#1f6fd1" stroke-width="1.2" stroke-dasharray="4 3"')
  svg += pl(R.q, 'stroke="#13a05a" stroke-width="2"')
  R.o.tan.forEach((t, i) => { const q = rotate(t.p, { yaw, pitch: 0 }); svg += `<circle cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="4" fill="#e08a2c" stroke="#fff"/>`; if (LEGEND) svg += `<text x="${(X(q[0]) + 7).toFixed(1)}" y="${(Y(q[1]) + 4).toFixed(1)}" font-size="11" fill="#b5651d">${['额头那圈上的切点', '太阳穴—上耳根上的切点', '颧骨—下耳根上的切点'][i]}</text>` })
  svg += `<text x="${ox + 8}" y="${oy + 20}" font-size="15">转 ${yaw}°</text><text x="${ox + 8}" y="${oy + Pn - 28}" font-size="12" fill="#13a05a">拼出的轮廓 vs 真轮廓：中位 ${R.built.med.toFixed(3)} · 九成 ${R.built.p90.toFixed(3)} · 最大 ${R.built.max.toFixed(3)}</text><text x="${ox + 8}" y="${oy + Pn - 10}" font-size="12" fill="#1f6fd1">外包轮廓 vs 真轮廓：中位 ${R.env.med.toFixed(3)} · 九成 ${R.env.p90.toFixed(3)} · 最大 ${R.env.max.toFixed(3)}</text>`
  out.push({ yaw, built: R.built, env: R.env, tangents: R.o.tan.map((t, i) => ({ rail: RAILS[i]!.name, g: +t.g.toFixed(3) })) })
  console.log(yaw, 'built', [R.built.med, R.built.p90, R.built.max].map(v => v.toFixed(3)).join('/'), 'env', [R.env.med, R.env.p90, R.env.max].map(v => v.toFixed(3)).join('/'), R.o.tan.map(t => `g${t.g.toFixed(2)}`).join(' '))
})
if (LEGEND) { const lg: [string, string][] = [['#e9e7e3', 'VRoid 头'], ['#111', '黑线 = VRoid 真轮廓'], ['#13a05a', '绿线 = 用你的线框拼出的轮廓'], ['#e08a2c', '橙点 = 纬线上和视线相切的点（转头时沿纬线滑动）'], ['#d9a0a0', '浅红 = 你的线框']]
  const oy = Math.ceil(YAWS.length / COLS) * Pn; lg.forEach(([c, t], i) => { svg += `<rect x="20" y="${oy + 14 + i * 22}" width="16" height="12" fill="${c}" stroke="#999" stroke-width="0.5"/><text x="44" y="${oy + 25 + i * 22}" font-size="14">${t}</text>` }) }
const base = file.replace(/\.json$/, '').replace(/.*\//, '') + (process.env.TAG ?? '')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.svg`, svg + '</svg>')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.json`, JSON.stringify({ note: 'face-side outline built from tangent points on the rails + column handles (face3d/fit/shell-outline.ts)', views: out }, null, 1))
// ---- how the tangent points move as the head turns (every degree): a jump = a point leaping across its rail ----
if (process.env.SWEEP) {
  const rows: string[] = []; let prev: number[] | null = null; const jumps: string[] = []
  for (let yaw = 0; yaw <= 105; yaw++) { const g = outline(yaw).tan.map(t => t.g); if (prev) g.forEach((v, i) => { if (Math.abs(v - prev![i]!) > 0.08) jumps.push(`${RAILS[i]!.name} ${yaw - 1}°→${yaw}°: ${prev![i]!.toFixed(2)}→${v.toFixed(2)}`) }); prev = g; if (yaw % 5 === 0) rows.push(`${yaw}: ${g.map(v => v.toFixed(2)).join(' ')}`) }
  console.log(rows.join('\n')); console.log('jumps:', jumps.length ? jumps.join(' | ') : 'none')
}
