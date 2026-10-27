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

// ---- the net (face side = the right: names 右…) ----
// C0 from the crown down to 额前: the midline line 眉心—颅顶 cut where it passes 额前
const mFront = run('眉心—颅顶', '颅顶'), cut = (() => { let bt = 0, bd = Infinity; for (let i = 0; i <= 400; i++) { const q = cubic(mFront, i / 400), d = Math.hypot(...sub(q, P('额前').p)); if (d < bd) { bd = d; bt = i / 400 } } return bt })()
const C0top = split(mFront, cut)[0]
// columns per stretch (between rails), each a cubic from the upper rail to the lower one
const COL: Record<'C0' | 'C1' | 'C2' | 'C3', (P3[] | null)[]> = {
  C0: [C0top, null, null, null],
  C1: [run('右线2前', '颅顶'), run('右线2后', '右交点1'), run('右线1', '右太阳穴'), run('右线3', '右颧骨')],
  C2: [run('右线5后', '颅顶'), run('右线5前', '右交点2'), run('右线2', '右上耳根'), run('右线4', '右下耳根')],
  C3: [run('颅顶—后脑', '颅顶'), null, null, null],
}
// rails: pieces, each from one column to the next
const RAILS: { name: string; pieces: { c: P3[]; from: keyof typeof COL; to: keyof typeof COL }[] }[] = [
  { name: 'R1 额前→交点1→交点2→后脑', pieces: [{ c: run('纬线右半前·纬线', '额前'), from: 'C0', to: 'C1' }, { c: run('纬线右半后前·纬线', '右交点1'), from: 'C1', to: 'C2' }, { c: run('纬线右半后后·纬线', '右交点2'), from: 'C2', to: 'C3' }] },
  { name: 'R2 太阳穴→上耳根', pieces: [{ c: run('右耳根太阳穴·纬线', '右太阳穴'), from: 'C1', to: 'C2' }] },
  { name: 'R3 颧骨→下耳根', pieces: [{ c: run('右下耳根颧骨·纬线', '右颧骨'), from: 'C1', to: 'C2' }] },
]
/** a column's handle over stretch k at its top (down) or bottom (up), falling back to the nearest column that has it */
const ORDER = ['C0', 'C1', 'C2', 'C3'] as const
function handle(col: keyof typeof COL, k: number, end: 'top' | 'bottom'): P3 {
  const i = ORDER.indexOf(col), tryCols = [i, i + 1, i - 1, i + 2, i - 2].filter(j => j >= 0 && j < 4).map(j => ORDER[j]!)
  for (const c of tryCols) { const s = COL[c][k]; if (s) return end === 'top' ? sub(s[1]!, s[0]!) : sub(s[2]!, s[3]!) }
  return [0, 0, 0]
}
/** one view: the tangent point on each rail, the outline through them */
function outline(yaw: number, pitch = 0) {
  const v = { yaw, pitch }, X = (p: P3) => rotate(p, v)[0]
  const tan = RAILS.map(r => { let best = { x: -Infinity, p: [0, 0, 0] as P3, from: r.pieces[0]!.from, to: r.pieces[0]!.to, f: 0 }
    for (const pc of r.pieces) for (let i = 0; i <= 200; i++) { const p = cubic(pc.c, i / 200), x = X(p); if (x > best.x) best = { x, p, from: pc.from, to: pc.to, f: i / 200 } }
    return best })
  const crown = P('颅顶').p, chin = P('下巴').p, pts = [crown, ...tan.map(t => t.p), chin]
  // stretch k: from pts[k] (k = 0 the crown) to pts[k + 1]; handles mixed from the columns that bracket each end
  const segs: P3[][] = []
  for (let k = 0; k < 4; k++) {
    const top = k === 0 ? tan[0]! : tan[k - 1]!, bot = k === 3 ? tan[2]! : tan[k]! // the crown and chin take the f of the rail next to them
    const h0 = mix(handle(top.from, k, 'top'), handle(top.to, k, 'top'), top.f), h1 = mix(handle(bot.from, k, 'bottom'), handle(bot.to, k, 'bottom'), bot.f)
    segs.push([pts[k]!, add(pts[k]!, h0), add(pts[k + 1]!, h1), pts[k + 1]!])
  }
  return { tan, segs }
}

// ---- compare: right edge of VRoid's outline vs the built outline vs the wire's envelope ----
function compare(yaw: number) {
  const v = { yaw, pitch: 0 }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4)), on = (x: number, y: number) => ras.zb[y * W + x]! > -Infinity
  const rows: { y: number; r: number }[] = []
  for (let j = 0; j < W; j++) { let r = -1; for (let i = 0; i < W; i++) if (on(i, j)) r = i; if (r >= 0) rows.push({ y: (F.cy - (j + 0.5)) / F.S, r: (r + 0.5 - F.cx) / F.S }) }
  const o = outline(yaw), q = o.segs.flatMap(s => Array.from({ length: 61 }, (_, i) => rotate(cubic(s, i / 60), v)))
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
  out.push({ yaw, built: R.built, env: R.env, tangents: R.o.tan.map((t, i) => ({ rail: RAILS[i]!.name, between: `${t.from}-${t.to}`, f: +t.f.toFixed(3) })) })
  console.log(yaw, 'built', [R.built.med, R.built.p90, R.built.max].map(v => v.toFixed(3)).join('/'), 'env', [R.env.med, R.env.p90, R.env.max].map(v => v.toFixed(3)).join('/'), R.o.tan.map(t => `${t.from}-${t.to}@${t.f.toFixed(2)}`).join(' '))
})
if (LEGEND) { const lg: [string, string][] = [['#e9e7e3', 'VRoid 头'], ['#111', '黑线 = VRoid 真轮廓'], ['#13a05a', '绿线 = 用你的线框拼出的轮廓'], ['#e08a2c', '橙点 = 纬线上和视线相切的点（转头时沿纬线滑动）'], ['#d9a0a0', '浅红 = 你的线框']]
  const oy = Math.ceil(YAWS.length / COLS) * Pn; lg.forEach(([c, t], i) => { svg += `<rect x="20" y="${oy + 14 + i * 22}" width="16" height="12" fill="${c}" stroke="#999" stroke-width="0.5"/><text x="44" y="${oy + 25 + i * 22}" font-size="14">${t}</text>` }) }
const base = file.replace(/\.json$/, '').replace(/.*\//, '') + (process.env.TAG ?? '')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.svg`, svg + '</svg>')
writeFileSync(`face3d/viewer/ref-shell/outline-${base}.json`, JSON.stringify({ note: 'face-side outline built from tangent points on the rails + column handles (face3d/fit/shell-outline.ts)', views: out }, null, 1))
