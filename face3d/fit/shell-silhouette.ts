// Does bowen's head wire give the outline at every angle? (bowen 1793112590 「这些线，任何角度，我现在给的网格应该都能有个与视线
// 相切的最大轮廓切点…将语义点沿着这些纬线移动…就能定义出轮廓」). For each view:
// - the true outline: the VRoid head drawn (software raster), its outer edge row by row (left and right);
// - the wire's outline: all wire lines projected, their outer edge row by row (the envelope: where some line is tangent to the
//   line of sight, the wire touches the outline);
// - on each ·纬线 line, its tangent points: where it is farthest out across the screen (left and right) — the points that slide
//   along the latitude as the head turns;
// the gap between the two outlines, row by row, in head units (head radius = 1).
// Writes face3d/viewer/ref-shell/silhouette-<doc>.svg/.json. Run: npx vite-node face3d/fit/shell-silhouette.ts <doc-sym.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
type P3 = [number, number, number]
interface Doc { points: { id: number; name: string; p: P3 }[]; lines: { id: number; name: string; a: number; b: number; c: P3[] }[] }
const file = process.argv[2]!, doc = JSON.parse(readFileSync(file, 'utf8')) as Doc
const b = readFileSync('face3d/fit/ref/test.vrm'), D = loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const W = 400, F = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.42 }
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const TOP = -1.5 // compare from the crown down to about the chin's underside (the neck's sides are not in the wire)
const VIEWS: [number, number][] = [[0, 0], [15, 0], [30, 0], [45, 0], [60, 0], [75, 0], [90, 0], [45, -45], [0, 30], [30, 30], [60, 30], [90, 30], [0, -30], [30, -30], [60, -30], [90, -30]]

function view(yaw: number, pitch: number) {
  const v = { yaw, pitch }, ras = rasterHead(D, v, F, new Uint8ClampedArray(W * W * 4))
  const on = (x: number, y: number) => ras.zb[y * W + x]! > -Infinity
  // the true outline: per row the leftmost and rightmost drawn pixel (screen units: x right, y up, head radius = 1)
  const rows: { y: number; l: number; r: number }[] = []
  for (let j = 0; j < W; j++) { let l = -1, r = -1; for (let i = 0; i < W; i++) if (on(i, j)) { if (l < 0) l = i; r = i }
    if (l >= 0) rows.push({ y: (F.cy - (j + 0.5)) / F.S, l: (l + 0.5 - F.cx) / F.S, r: (r + 0.5 - F.cx) / F.S }) }
  // the wire: every line sampled and projected
  const proj = doc.lines.map(l => ({ l, q: Array.from({ length: 121 }, (_, i) => rotate(cubic(l.c, i / 120), v)) }))
  // the wire's outline per row: the outer crossing of any projected line with the row
  const env = rows.map(({ y }) => { let lo = Infinity, hi = -Infinity
    for (const { q } of proj) for (let i = 0; i + 1 < q.length; i++) { const a = q[i]!, c = q[i + 1]!; if ((a[1] - y) * (c[1] - y) > 0 || a[1] === c[1]) continue
      const x = a[0] + ((y - a[1]) / (c[1] - a[1])) * (c[0] - a[0]); lo = Math.min(lo, x); hi = Math.max(hi, x) }
    return { lo, hi } })
  // the gap, rows above TOP of the true outline's own height (rows of the head the wire spans)
  const ys = proj.flatMap(p => p.q.map(q => q[1])), wTop = Math.max(...ys), wBot = Math.min(...ys)
  const gaps = rows.map((r, i) => ({ y: r.y, gl: Number.isFinite(env[i]!.lo) ? env[i]!.lo - r.l : NaN, gr: Number.isFinite(env[i]!.hi) ? r.r - env[i]!.hi : NaN }))
    .filter(g => g.y <= wTop && g.y >= Math.max(wBot, rotate([0, TOP, 0.4], v)[1] - 0.05))
  // tangent points on each ·纬线 line: its farthest-out sample to the left and to the right, kept where it is not an end
  const tangents = proj.filter(p => p.l.name.includes('纬线')).flatMap(({ l, q }) => {
    const iR = q.reduce((m, p, i) => (p[0] > q[m]![0] ? i : m), 0), iL = q.reduce((m, p, i) => (p[0] < q[m]![0] ? i : m), 0)
    return ([[iR, 'r'], [iL, 'l']] as const).filter(([i]) => i > 0 && i < q.length - 1).map(([i, s]) => ({ line: l.name, side: s, t: i / 120, q: q[i]! })) })
  const pct = (a: number[], p: number) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN }
  // the two sides apart (for yaw > 0 the right side is the face side), each only down to the chin's underside
  const chinY = rotate(doc.points.find(p => p.name === '下巴底拐点')!.p, v)[1], head = gaps.filter(g => g.y >= chinY)
  const all = gaps.flatMap(g => [g.gl, g.gr]), R = head.map(g => g.gr), L = head.map(g => g.gl)
  return { yaw, pitch, rows, env, proj, gaps, tangents, med: pct(all, 0.5), p90: pct(all, 0.9), max: pct(all, 1),
    right: { med: pct(R, 0.5), p90: pct(R, 0.9), max: pct(R, 1) }, left: { med: pct(L, 0.5), p90: pct(L, 0.9), max: pct(L, 1) } }
}

// ---- the sheet ----
const P = 400, COLS = 4, out: unknown[] = []
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS * P} ${COLS * P}" width="${COLS * P}" height="${COLS * P}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
VIEWS.forEach(([yaw, pitch], k) => {
  const V = view(yaw, pitch), ox = (k % COLS) * P, oy = Math.floor(k / COLS) * P, X = (x: number) => ox + F.cx + x * F.S, Y = (y: number) => oy + F.cy - y * F.S
  svg += `<g><rect x="${ox}" y="${oy}" width="${P}" height="${P}" fill="none" stroke="#ddd"/>`
  // the true head (filled from its row edges)
  svg += `<path fill="#e4e2de" d="${V.rows.map(r => `M${X(r.l).toFixed(1)},${Y(r.y).toFixed(1)}H${X(r.r).toFixed(1)}`).join('')}" stroke="#e4e2de" stroke-width="${(1 / F.S * F.S).toFixed(1)}"/>`
  for (const { l, q } of V.proj) svg += `<polyline fill="none" stroke="${l.name.includes('纬线') ? '#e08a2c' : '#c0392b'}" stroke-width="0.8" opacity="0.7" points="${q.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`
  // the wire's outline (blue) over the true outline (black)
  const edge = (f: (i: number) => number) => V.rows.map((r, i) => [f(i), r.y] as const).filter(([x]) => Number.isFinite(x))
  for (const f of [(i: number) => V.env[i]!.lo, (i: number) => V.env[i]!.hi]) svg += `<polyline fill="none" stroke="#1f6fd1" stroke-width="1.6" points="${edge(f).map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}"/>`
  for (const f of [(i: number) => V.rows[i]!.l, (i: number) => V.rows[i]!.r]) svg += `<polyline fill="none" stroke="#111" stroke-width="0.8" points="${edge(f).map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}"/>`
  for (const t of V.tangents) svg += `<circle cx="${X(t.q[0]).toFixed(1)}" cy="${Y(t.q[1]).toFixed(1)}" r="3.5" fill="#e08a2c" stroke="#fff"/>`
  svg += `<text x="${ox + 8}" y="${oy + 20}" font-size="15">转 ${yaw}° ${pitch ? (pitch > 0 ? '仰' : '俯') + Math.abs(pitch) + '°' : ''}</text><text x="${ox + 8}" y="${oy + P - 28}" font-size="12" fill="#333">下巴以上 右边：中位 ${V.right.med.toFixed(3)} · 九成 ${V.right.p90.toFixed(3)} · 最大 ${V.right.max.toFixed(3)}</text><text x="${ox + 8}" y="${oy + P - 10}" font-size="12" fill="#333">下巴以上 左边：中位 ${V.left.med.toFixed(3)} · 九成 ${V.left.p90.toFixed(3)} · 最大 ${V.left.max.toFixed(3)}</text></g>`
  out.push({ yaw, pitch, right: V.right, left: V.left, tangents: V.tangents.map(t => ({ line: t.line, side: t.side, t: +t.t.toFixed(3) })) })
  console.log(yaw, pitch, 'R', [V.right.med, V.right.p90, V.right.max].map(v => v.toFixed(3)).join('/'), 'L', [V.left.med, V.left.p90, V.left.max].map(v => v.toFixed(3)).join('/'), 'tangents', V.tangents.map(t => `${t.line}:${t.side}@${t.t.toFixed(2)}`).join(' '))
})
const base = file.replace(/\.json$/, '').replace(/.*\//, '')
writeFileSync(`face3d/viewer/ref-shell/silhouette-${base}.svg`, svg + '</svg>')
writeFileSync(`face3d/viewer/ref-shell/silhouette-${base}.json`, JSON.stringify({ note: 'wire outline vs VRoid outline per view (face3d/fit/shell-silhouette.ts); gap > 0 = the wire falls inside the head', views: out }, null, 1))
