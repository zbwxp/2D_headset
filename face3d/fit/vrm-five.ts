// Our turn model's outline (outer side 3 lines: 颅顶 → 太阳穴点 → 颧骨点 → 下巴; inner side 2: 颅顶 → 耳根点 → down) fitted to
// VRoid's outline every 10° (bowen 1793121965 「模型的头部外轮廓（包括下巴和脖子外侧）…求出contour，然后把我们之前那套内2，外3条线的
// 建模方案去fit到vroid提供的contour上去，每10度fit一次」). The outline: the head (skin, ears pressed flat, with its neck down to
// the neck's base ring) drawn at the turn, its outer edge traced once round on the screen and opened at the neck's cut, from
// the neck's back up over the crown to the neck's front. Its neck: the outer side gets one more line 下巴 → the neck front's
// end; the inner side's second line runs on to the neck back's end. Joints start at heights (bowen's 太阳穴, 颧骨, 下耳根) and at
// the outline point nearest his 下巴, then slide along the outline while the total error falls; each piece one cubic Bézier
// fitted on the screen (ends fixed). Writes face3d/viewer/vrm-five.json and face3d/viewer/ref-shell/vrm-five.svg.
// Run: npx vite-node face3d/fit/vrm-five.ts [doc-sym.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate, screenAxes, toCamera } from '../src/view'
import { flattenEars } from './flatten-ears'
type P3 = [number, number, number]
type P2 = [number, number]
const doc = JSON.parse(readFileSync(process.argv[2] ?? 'face3d/viewer/ref-shell/bowen-1793118841-sym.json', 'utf8')) as { points: { name: string; p: P3 }[]; lines: { name: string; c: P3[] }[] }
const pt = (n: string) => doc.points.find(p => p.name === n)!.p
const buf = readFileSync('face3d/fit/ref/test.vrm'), ab = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
// the head with its neck in the usual head space (as the 头壳标注 page), skin only, no arms, ears pressed flat
const d0 = loadVrmHead(ab()), D = loadVrmHead(ab(), 1.3)
const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(D.P, 1), b1 = ext(D.P, 2)
const sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
const P = D.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as P3), N = D.N.map(n => [...n])
const parts = D.parts.filter(p => p.kind === 'skin').map(pt2 => { const tris: number[] = [], cornerN: number[] = []
  for (let i = 0; i < pt2.tris.length; i += 3) { const v = [pt2.tris[i]!, pt2.tris[i + 1]!, pt2.tris[i + 2]!]; if (!v.every(k => P[k]![1] > -1.2 || Math.abs(P[k]![0]) < 1.0)) continue; tris.push(...v); cornerN.push(...pt2.cornerN.slice(3 * i, 3 * i + 9)) }
  return { ...pt2, tris, cornerN } })
const skinTris = parts.flatMap(p => p.tris)
flattenEars(P, N, skinTris)
const H = { ...D, P, N, parts, skinTris } as unknown as Parameters<typeof rasterHead>[0]
const yBase = Math.max(pt('后颈')[1], pt('颈前')[1]) + 0.03
const W = 640, F = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.4 }

/** the outline on the screen (head units), from the neck's back over the crown to the neck's front, and each point's 3D place */
function outline(yaw: number): { q: P2[]; p3: P3[] } {
  const v = { yaw, pitch: 0 }, ras = rasterHead(H, v, F, new Uint8ClampedArray(W * W * 4)), on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity
  let s0: [number, number] | null = null
  for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 40000; n++) {
    const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  const ax = screenAxes(v), fw = toCamera(v)
  const all = cells.map(([i, j]) => { const x = (i + 0.5 - F.cx) / F.S, y = (F.cy - (j + 0.5)) / F.S, z = ras.zb[j * W + i]!; return { q: [x, y] as P2, p: [0, 1, 2].map(k => ax.right[k]! * x + ax.up[k]! * y + fw[k]! * z) as P3 } })
  const keep = all.map(e => e.p[1] > yBase), n = all.length; let start = keep.findIndex((k, i) => k && !keep[(i - 1 + n) % n]); if (start < 0) start = 0
  const run: typeof all = []; for (let k = 0; k < n; k++) { const i = (start + k) % n; if (!keep[i]) break; run.push(all[i]!) }
  // smoothed (pixel steps), resampled every 0.01, from the back (screen left for a turn > 0, the face on the right) to the front
  const sm = run.map((_, i) => { const w = run.slice(Math.max(0, i - 3), i + 4); return { q: [w.reduce((a, e) => a + e.q[0], 0) / w.length, w.reduce((a, e) => a + e.q[1], 0) / w.length] as P2, p: run[i]!.p } })
  const ord = sm.length && sm[0]!.q[0] > sm[sm.length - 1]!.q[0] ? sm.reverse() : sm
  const out: typeof ord = [ord[0]!]; let acc = 0
  for (let i = 1; i < ord.length; i++) { acc += Math.hypot(ord[i]!.q[0] - ord[i - 1]!.q[0], ord[i]!.q[1] - ord[i - 1]!.q[1]); if (acc >= 0.01) { out.push(ord[i]!); acc = 0 } }
  if (out[out.length - 1] !== ord[ord.length - 1]) out.push(ord[ord.length - 1]!)
  return { q: out.map(e => e.q), p3: out.map(e => e.p) }
}
/** least-squares cubic through q (chord-length t), ends fixed; its squared error */
function fit(q: P2[]): { c: P2[]; err: number } {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + Math.hypot(q[i]![0] - q[i - 1]![0], q[i]![1] - q[i - 1]![1]))
  const P0 = q[0]!, P3_ = q[n]!; let a11 = 0, a12 = 0, a22 = 0; const r1 = [0, 0], r2 = [0, 0]
  for (let i = 0; i <= n; i++) { const t = L[i]! / (L[n]! || 1), u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (let k = 0; k < 2; k++) { const r = q[i]![k]! - b0 * P0[k]! - b3 * P3_[k]!; r1[k]! += b1 * r; r2[k]! += b2 * r } }
  const det = a11 * a22 - a12 * a12
  const c: P2[] = n < 3 || Math.abs(det) < 1e-12 ? [P0, [P0[0] + (P3_[0] - P0[0]) / 3, P0[1] + (P3_[1] - P0[1]) / 3], [P0[0] + (2 * (P3_[0] - P0[0])) / 3, P0[1] + (2 * (P3_[1] - P0[1])) / 3], P3_]
    : [P0, [(r1[0]! * a22 - r2[0]! * a12) / det, (r1[1]! * a22 - r2[1]! * a12) / det], [(a11 * r2[0]! - a12 * r1[0]!) / det, (a11 * r2[1]! - a12 * r1[1]!) / det], P3_]
  const S = Array.from({ length: 81 }, (_, i) => { const t = i / 80, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) })
  return { c, err: q.reduce((a, p) => a + Math.min(...S.map(s => (s[0]! - p[0]) ** 2 + (s[1]! - p[1]) ** 2)), 0) }
}
function piecewise(q: P2[], joints: number[], reach = 25) {
  const total = (js: number[]) => js.slice(0, -1).reduce((a, s, k) => a + fit(q.slice(s, js[k + 1]! + 1)).err, 0)
  let js = [...joints], best = total(js)
  for (let round = 0; round < 8; round++) { let moved = false
    for (let j = 1; j < js.length - 1; j++) for (const step of [-8, -4, -2, -1, 1, 2, 4, 8]) { const t = [...js]; t[j] = t[j]! + step
      if (Math.abs(t[j]! - joints[j]!) > reach || t[j]! <= t[j - 1]! + 2 || t[j]! >= t[j + 1]! - 2) continue
      const e = total(t); if (e < best - 1e-12) { best = e; js = t; moved = true } }
    if (!moved) break }
  return { joints: js, curves: js.slice(0, -1).map((s, k) => fit(q.slice(s, js[k + 1]! + 1)).c), rms: Math.sqrt(best / q.length) }
}
const NAMES = ['颈后底', '耳根点', '颅顶', '太阳穴点', '颧骨点', '下巴', '颈前底']
const LINES = ['内侧 2（耳根→颈后）', '内侧 1（颅顶→耳根）', '外侧 1（颅顶→太阳穴）', '外侧 2（太阳穴→颧骨）', '外侧 3（颧骨→下巴）', '颈前（下巴→颈前底）']
function fiveAt(yaw: number) {
  const { q, p3 } = outline(yaw), v = { yaw, pitch: 0 }, n = q.length
  // starting joints: crown = the top; 耳根点 = the inner (back) side at the height of 下耳根; 太阳穴 / 颧骨 = the outer (face) side
  // at their heights; 下巴 = the outline point nearest bowen's 下巴 (on the screen); each found within its stretch
  const iTop = q.reduce((m, p, i) => (p[1] > q[m]![1] ? i : m), 0)
  const atY = (y: number, lo: number, hi: number) => { let bi = lo, bd = Infinity; for (let i = lo; i <= hi; i++) { const d = Math.abs(q[i]![1] - y); if (d < bd) { bd = d; bi = i } } return bi }
  const scr = (p: P3) => { const r = rotate(p, v); return [r[0], r[1]] as P2 }
  const chin = scr(pt('下巴')), iChin = q.reduce((m, p, i) => (i > iTop && Math.hypot(p[0] - chin[0], p[1] - chin[1]) < Math.hypot(q[m]![0] - chin[0], q[m]![1] - chin[1]) ? i : m), Math.min(n - 2, iTop + 1))
  const iEar = atY(scr(pt('左下耳根'))[1], 1, iTop - 2), iTem = atY(scr(pt('右太阳穴'))[1], iTop + 2, iChin - 4), iCheek = atY(scr(pt('右颧骨'))[1], iTem + 2, iChin - 2)
  const r = piecewise(q, [0, iEar, iTop, iTem, iCheek, iChin, n - 1])
  const pts = r.joints.map((i, k) => ({ name: NAMES[k]!, q: q[i]!, p: p3[i]!.map(x => +x.toFixed(4)) }))
  return { yaw, outline: q.map(p => p.map(x => +x.toFixed(4))), curves: r.curves.map((c, k) => ({ name: LINES[k]!, c: c.map(p => p.map(x => +x.toFixed(4))) })), points: pts, rms: r.rms }
}
const YAWS = Array.from({ length: 10 }, (_, i) => i * 10), out = YAWS.map(y => { const f = fiveAt(y); console.log(y, 'outline', f.outline.length, 'rms', f.rms.toFixed(4)); return f })
writeFileSync('face3d/viewer/vrm-five.json', JSON.stringify({ note: "our turn model's outline (outer 3, inner 2, + neck) fitted to VRoid's outline every 10° on the screen (face3d/fit/vrm-five.ts, bowen 1793121965)", views: out }))
// the sheet
const Pn = 360, C = 4, COL = ['#7b3fb5', '#7b3fb5', '#13a05a', '#13a05a', '#13a05a', '#c47a00']
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${C * Pn} ${C * Pn}" width="${C * Pn}" height="${C * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
out.forEach((f, k) => { const ox = (k % C) * Pn, oy = Math.floor(k / C) * Pn, S = Pn / 3.4, X = (p: number[]) => ox + Pn / 2 + p[0]! * S, Y = (p: number[]) => oy + Pn * 0.4 - p[1]! * S
  const pl = (ps: number[][], st: string) => `<polyline fill="none" ${st} points="${ps.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>` + pl(f.outline, 'stroke="#111" stroke-width="3" stroke-opacity="0.25"')
  f.curves.forEach((c, i) => { svg += pl(Array.from({ length: 41 }, (_, j) => { const t = j / 40, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1].map(kk => w.reduce((s, wi, jj) => s + wi * c.c[jj]![kk]!, 0)) }), `stroke="${COL[i]}" stroke-width="1.8"`) })
  for (const p of f.points) svg += `<circle cx="${X(p.q).toFixed(1)}" cy="${Y(p.q).toFixed(1)}" r="3.2" fill="#e08a2c"/><text x="${(X(p.q) + 5).toFixed(1)}" y="${(Y(p.q) - 3).toFixed(1)}" font-size="9" fill="#a05a10">${p.name}</text>`
  svg += `<text x="${ox + 6}" y="${oy + 16}" font-size="13">转 ${f.yaw}° · 偏差均方 ${f.rms.toFixed(3)}</text>` })
const lg: [string, string][] = [['#111', '灰粗 = VRoid 外轮廓（无耳朵，到颈根）'], ['#13a05a', '绿 = 外侧 3 条：颅顶→太阳穴→颧骨→下巴'], ['#7b3fb5', '紫 = 内侧 2 条：颅顶→耳根点→颈后底'], ['#c47a00', '褐 = 颈前：下巴→颈前底']]
lg.forEach(([c, t], i) => { svg += `<rect x="${2 * Pn + 20}" y="${2 * Pn + 30 + i * 26}" width="18" height="4" fill="${c}"/><text x="${2 * Pn + 46}" y="${2 * Pn + 37 + i * 26}" font-size="14">${t}</text>` })
writeFileSync('face3d/viewer/ref-shell/vrm-five.svg', svg + '</svg>')
