// VRoid's own outline at each turn, drawn as simply as bowen's 太阳穴·颧骨·下巴 line (bowen 1793120445 「根据我的头壳标注，在vroid
// 轮廓线里，你能先做到像我画的太阳穴·颧骨·下巴点一样简洁清晰的各个角度轮廓线在模型上的绘制吗？你先尝试一下只yaw」). For each turn
// (pitch 0): the curve on the skin where it turns edge-on to the view (the zero line of normal · view direction, from the
// file's vertex normals), kept where it is the outermost outline (next to the background on the screen; the ears left out —
// they are their own lines); chained into one line from the neck's back round over the crown to the neck's front, cut off
// below the neck's base ring 线11. It is split where it crosses bowen's lines running across (the forehead ring, the 太阳穴
// and 颧骨 layers, 线9 under the jaw, 线12 round the upper neck, 线6 to the nape, the midline at the crown / chin): those are
// this turn's 太阳穴点, 颧骨点 …; each piece between two of them one cubic Bézier (ends fixed, least squares) on the model.
// Writes face3d/viewer/vrm-yaw-outline.json (+ a check sheet). Run: npx vite-node face3d/fit/vrm-yaw-outline.ts <doc-sym.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { type V3, rotate, screenAxes, toCamera } from '../src/view'

type P3 = [number, number, number]
const doc = JSON.parse(readFileSync(process.argv[2] ?? 'face3d/viewer/ref-shell/bowen-1793118841-sym.json', 'utf8')) as { points: { id: number; name: string; p: P3 }[]; lines: { name: string; a: number; b: number; c: P3[] }[] }
const buf = readFileSync('face3d/fit/ref/test.vrm'), ab = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
// the head with its neck, in the usual head space (as the 头壳标注 page: the two loads matched at the crown and the nose tip)
const d0 = loadVrmHead(ab()), D = loadVrmHead(ab(), 1.3)
const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(D.P, 1), b1 = ext(D.P, 2)
const sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
const P = D.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as P3)
// no arms; no ears (their own lines)
const isEar = (p: P3) => Math.abs(p[0]) > 0.78 && p[2] > -0.45 && p[2] < 0.22 && p[1] < -0.28 && p[1] > -1.0
const keepV = (p: P3) => (p[1] > -1.2 || Math.abs(p[0]) < 1.0)
const parts = D.parts.map(pt => { const tris: number[] = [], cornerN: number[] = []
  if (pt.kind !== 'skin') return { ...pt, tris: [], cornerN: [] } // the skin only: brows and lashes stick out past it
  for (let i = 0; i < pt.tris.length; i += 3) { const v = [pt.tris[i]!, pt.tris[i + 1]!, pt.tris[i + 2]!]; if (!v.every(k => keepV(P[k]!))) continue; tris.push(...v); cornerN.push(...pt.cornerN.slice(3 * i, 3 * i + 9)) }
  return { ...pt, tris, cornerN } })
const H = { ...D, P: P as unknown as V3[], parts, skinTris: parts.filter(p => p.kind === 'skin').flatMap(p => p.tris) }
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = (v: P3) => Math.hypot(v[0], v[1], v[2]), lerp = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const sample = (c: P3[], n = 200) => Array.from({ length: n + 1 }, (_, i) => cubic(c, i / n))
const pt = (n: string) => doc.points.find(p => p.name === n)!.p
const yBase = Math.max(pt('后颈')[1], pt('颈前')[1]) + 0.03, EDGE = Number(process.env.EDGE ?? 8)

/** the outermost outline at a turn, in order, on the model: the head drawn (no ears), its outer edge traced once round on the
 * screen, each edge pixel taken back onto the model by its depth; cut below the neck's base ring (the neck's cut is no
 * outline), so it runs from the neck's back round over the crown to the neck's front; lightly smoothed (pixel steps) */
function outlineOnModel(yaw: number): P3[] {
  const v = { yaw, pitch: 0 }, W = 640, f = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.4 }, ras = rasterHead(H as unknown as Parameters<typeof rasterHead>[0], v, f, new Uint8ClampedArray(W * W * 4))
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity
  let s0: [number, number] | null = null
  for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 40000; n++) {
    const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  const ax = screenAxes(v), fw = toCamera(v)
  const loop = cells.map(([i, j]) => { const x = (i + 0.5 - f.cx) / f.S, y = (f.cy - (j + 0.5)) / f.S, z = ras.zb[j * W + i]!; return [0, 1, 2].map(k => ax.right[k]! * x + ax.up[k]! * y + fw[k]! * z) as P3 })
  // open it at the neck's cut: the longest run above the base ring, in loop order
  const keep = loop.map(p => p[1] > yBase), n = loop.length; let start = keep.findIndex((k, i) => k && !keep[(i - 1 + n) % n]); if (start < 0) start = 0
  const run: P3[] = []; for (let k = 0; k < n; k++) { const i = (start + k) % n; if (!keep[i]) break; run.push(loop[i]!) }
  const sm0 = run.map((_, i) => { const w = run.slice(Math.max(0, i - 3), i + 4); return [0, 1, 2].map(k => w.reduce((s2, p) => s2 + p[k]!, 0) / w.length) as P3 })
  // the ears are their own lines: where the outline runs round an ear it is left out (the piece there is fitted across the gap)
  const sm = sm0.filter(p => !isEar(p))
  // from the back to the front
  return sm.length && sm[0]![2] > sm[sm.length - 1]![2] ? sm.reverse() : sm
}
/** least-squares cubic through q (chord-length t), ends fixed */
function fitCubic(q: P3[]): { c: P3[]; rms: number; max: number } {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + len(sub(q[i]!, q[i - 1]!)))
  const P0 = q[0]!, P3_ = q[n]!; let a11 = 0, a12 = 0, a22 = 0; const r1 = [0, 0, 0], r2 = [0, 0, 0]
  for (let i = 0; i <= n; i++) { const t = L[i]! / (L[n]! || 1), u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (let k = 0; k < 3; k++) { const r = q[i]![k]! - b0 * P0[k]! - b3 * P3_[k]!; r1[k]! += b1 * r; r2[k]! += b2 * r } }
  const det = a11 * a22 - a12 * a12
  const c: P3[] = Math.abs(det) < 1e-12 || n < 3 ? [P0, lerp(P0, P3_, 1 / 3), lerp(P0, P3_, 2 / 3), P3_] : [P0, [0, 1, 2].map(k => (r1[k]! * a22 - r2[k]! * a12) / det) as P3, [0, 1, 2].map(k => (a11 * r2[k]! - a12 * r1[k]!) / det) as P3, P3_]
  const S = sample(c, 80), e = q.map(p => Math.min(...S.map(s => len(sub(s, p)))))
  return { c, rms: Math.sqrt(e.reduce((a, x) => a + x * x, 0) / e.length), max: Math.max(...e) }
}
// bowen's lines running across, by the layer they mark (both sides)
const LAYERS: [string, RegExp][] = [['额头圈', /纬线.*半.*·纬线/], ['太阳穴层', /耳根太阳穴·纬线/], ['颧骨层', /下耳根颧骨·纬线/], ['下颌底', /^右?线9$/], ['颈上圈', /^右?线12/], ['耳后颈', /^右?线6$/], ['中线', /^(眉心—颅顶|颅顶—后脑|鼻尖—眉心|上唇—鼻尖|下唇—上唇|下巴—下唇|下巴底拐点—下巴|颈前—下巴底拐点|头颈交界耳后根·纬线|线7)$/]]
const RAILS = LAYERS.flatMap(([layer, re]) => doc.lines.filter(l => re.test(l.name)).map(l => ({ layer, name: l.name, s: sample(l.c) })))
// the 太阳穴 and 颧骨 layers carried on to the side-face line by the two automatic links (shell-outline.ts, each one cubic), both sides
{ const nets = JSON.parse(readFileSync('face3d/viewer/shell-nets.json', 'utf8')) as { autos: { name: string; c: P3[] }[] }
  for (const a of nets.autos.filter(x => x.name.startsWith('头顶那圈'))) RAILS.push({ layer: '头顶圈', name: a.name, s: a.c })
  for (const a of nets.autos.filter(x => x.name.startsWith('侧脸线→'))) { const layer = a.name.includes('太阳穴') ? '太阳穴层' : '颧骨层'
    RAILS.push({ layer, name: a.name, s: a.c }, { layer, name: a.name.replace('右', '左'), s: a.c.map(p => [-p[0], p[1], p[2]] as P3) }) } }

function yawOutline(yaw: number) {
  const line = outlineOnModel(yaw)
  // resample evenly (0.01)
  const q: P3[] = [line[0]!]; let acc = 0
  for (let i = 1; i < line.length; i++) { const dd = len(sub(line[i]!, line[i - 1]!)); acc += dd; if (acc >= 0.01) { q.push(line[i]!); acc = 0 } }
  if (q[q.length - 1] !== line[line.length - 1]) q.push(line[line.length - 1]!)
  // crossings with the rails: the outline sample nearest a rail, within 0.035, where the two cross (not running side by side);
  // where the outline runs along a rail (the side-face line at 90°) the rail's own ends on it split it instead (鼻尖, 上唇 …)
  const cross: { i: number; layer: string; rail: string; d: number }[] = []
  const dirQ = (i: number) => { const a2 = q[Math.max(0, i - 3)]!, b2 = q[Math.min(q.length - 1, i + 3)]!, d = sub(b2, a2), l = len(d) || 1; return d.map(x => x / l) as P3 }
  for (const r of RAILS) { const near = q.map(p => { let bi = 0, bd = Infinity; r.s.forEach((s2, k) => { const dd = len(sub(s2, p)); if (dd < bd) { bd = dd; bi = k } }); return { d: bd, k: bi } })
    for (let i = 1; i + 1 < q.length; i++) { const n = near[i]!; if (!(n.d < 0.035 && n.d <= near[i - 1]!.d && n.d <= near[i + 1]!.d)) continue
      const rd = sub(r.s[Math.min(r.s.length - 1, n.k + 2)]!, r.s[Math.max(0, n.k - 2)]!), cos = Math.abs(rd[0] * dirQ(i)[0] + rd[1] * dirQ(i)[1] + rd[2] * dirQ(i)[2]) / (len(rd) || 1)
      if (cos < 0.85) cross.push({ i, layer: r.layer, rail: r.name, d: n.d }) }
    // running along: the rail's ends where they lie on the outline
    for (const e of [r.s[0]!, r.s[r.s.length - 1]!]) { let bi = -1, bd = 0.03; q.forEach((p, i) => { const dd = len(sub(p, e)); if (dd < bd) { bd = dd; bi = i } })
      if (bi > 0) { const nm = doc.points.find(pp => len(sub(pp.p, e)) < 1e-3)?.name; cross.push({ i: bi, layer: nm ?? r.layer, rail: r.name, d: bd }) } } }
  // one split per place: closer than 0.08 along the outline merge (the nearer rail names it)
  cross.sort((a, b) => a.i - b.i)
  const splits: typeof cross = []; for (const c of cross) { const last = splits[splits.length - 1]; if (last && c.i - last.i < 8) { if (c.d < last.d) splits[splits.length - 1] = c } else splits.push(c) }
  const idx = [0, ...splits.map(s => s.i).filter(i => i > 2 && i < q.length - 3), q.length - 1]
  const curves = idx.slice(0, -1).map((a, k) => { const b = idx[k + 1]!, f = fitCubic(q.slice(a, b + 1)); return { c: f.c.map(p => p.map(x => +x.toFixed(4)) as P3), rms: f.rms, max: f.max } })
  const points = idx.map((i, k) => ({ name: k === 0 ? '颈后端' : k === idx.length - 1 ? '颈前端' : (l => (/层|圈|底|颈|线$/.test(l) ? `${l}点` : l))(splits.find(s => s.i === i)!.layer), rail: k === 0 || k === idx.length - 1 ? '' : splits.find(s => s.i === i)!.rail, p: q[i]!.map(x => +x.toFixed(4)) }))
  return { yaw, raw: q.map(p => p.map(x => +x.toFixed(4))), curves, points, rms: Math.sqrt(curves.reduce((a, c) => a + c.rms * c.rms, 0) / Math.max(1, curves.length)), max: Math.max(...curves.map(c => c.max)) }
}

const YAWS = (process.env.YAWS ?? '0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90').split(',').map(Number)
const out = YAWS.map(y => { const r = yawOutline(y); console.log(y, 'pts', r.raw.length, 'pieces', r.curves.length, 'rms', r.rms.toFixed(4), 'max', r.max.toFixed(4), r.points.map(p => p.name).join(' ')); return r })
writeFileSync('face3d/viewer/vrm-yaw-outline.json', JSON.stringify({ note: "VRoid's outline per turn, split at bowen's lines across, one cubic per piece (face3d/fit/vrm-yaw-outline.ts, bowen 1793120445)", views: out }))
// check sheet: each turn seen from itself and from the front
const Pn = 360, C = 4, rows = Math.ceil(YAWS.length / C)
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${C * Pn} ${rows * Pn}" width="${C * Pn}" height="${rows * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
out.forEach((r, k) => { const v = { yaw: r.yaw, pitch: 0 }, ox = (k % C) * Pn, oy = Math.floor(k / C) * Pn, S = Pn / 3.4, X = (p: P3) => ox + Pn / 2 + rotate(p, v)[0] * S, Y = (p: P3) => oy + Pn * 0.4 - rotate(p, v)[1] * S
  const pl = (ps: P3[], st: string) => `<polyline fill="none" ${st} points="${ps.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ddd"/>`
  for (const l of doc.lines) svg += pl(sample(l.c, 40), 'stroke="#ecc" stroke-width="0.6"')
  svg += pl(r.raw as P3[], 'stroke="#111" stroke-width="2.4" stroke-opacity="0.35"')
  for (const c of r.curves) svg += pl(sample(c.c, 40), 'stroke="#13a05a" stroke-width="1.6"')
  for (const p of r.points) svg += `<circle cx="${X(p.p as P3).toFixed(1)}" cy="${Y(p.p as P3).toFixed(1)}" r="3" fill="#e08a2c"/><text x="${(X(p.p as P3) + 4).toFixed(1)}" y="${(Y(p.p as P3) - 3).toFixed(1)}" font-size="9" fill="#a05a10">${p.name}</text>`
  svg += `<text x="${ox + 6}" y="${oy + 16}" font-size="13">转 ${r.yaw}° · ${r.curves.length} 段 · 偏差均方 ${r.rms.toFixed(3)} 最大 ${r.max.toFixed(3)}</text>` })
writeFileSync('face3d/viewer/ref-shell/vrm-yaw-outline.svg', svg + '</svg>')
