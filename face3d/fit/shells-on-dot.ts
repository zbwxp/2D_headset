// The two head shells — VRoid's head and its copy sculpted to the old turn model (sculpt-to-model.json) — put into dot's pictures
// (bowen 1793151412 「你把这两种头壳往dot生成过的图片里面fit，然后让我看看fit结果」). For each of the 15 pictures with landmarks
// (bench-tasks/俯仰x转头-2026-10-27/landmarks.json: eye corners and irises, nose tip, mouth, chin, read off by hand), each shell's
// own landmarks (found on the mesh; the copy's are the same vertices moved) are fitted to the picture's: turn and tilt by grid,
// then scale and shift by least squares (u = s·x + tx, v = −s·y + ty). Each shell's outline at its fitted view is drawn over the
// picture. Writes face3d/viewer/ref-shell/shells-on-dot.svg (+ .json). Run: npx vite-node face3d/fit/shells-on-dot.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { cutNeck, loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
import { flattenEars } from './flatten-ears'
type P3 = [number, number, number]
type P2 = [number, number]
const DIR = 'bench-tasks/俯仰x转头-2026-10-27/'
const LM = JSON.parse(readFileSync(DIR + 'landmarks.json', 'utf8')) as Record<string, Record<string, P2> | string>
const buf = readFileSync('face3d/fit/ref/test.vrm'), D = cutNeck(loadVrmHead(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
const S = JSON.parse(readFileSync('face3d/viewer/sculpt-to-model.json', 'utf8')) as { P: P3[] }
const PV = D.P.map(p => [...p] as P3), PS = S.P
const flat = PV.map(p => [...p] as P3); flattenEars(flat, D.N.map(n => [...n]), D.skinTris) // the copy was made from the head with its ears pressed flat
// ---- landmarks on the mesh (as face3d/fit/vrm-contours.ts) by vertex index, so the copy's are the same vertices ----
const skin = [...new Set(D.skinTris)]
const white = D.parts.find(p => p.kind === 'feature' && p.color[0] === 245)!, wv = [...new Set(white.tris)]
const eye = (side: -1 | 1) => { const vs = wv.filter(i => Math.sign(PV[i]![0]) === side), ax = (i: number) => Math.abs(PV[i]![0]); return { O: vs.reduce((a, i) => (ax(i) > ax(a) ? i : a)), I: vs.reduce((a, i) => (ax(i) < ax(a) ? i : a)) } }
const iris = D.parts.find(p => p.kind === 'feature' && p.color[0] === 70), iv = iris ? [...new Set(iris.tris)] : wv
const irisC = (side: -1 | 1) => { const vs = iv.filter(i => Math.sign(PV[i]![0]) === side); return vs } // the centre: the mean of these vertices
const mid = skin.filter(i => Math.abs(PV[i]![0]) < 0.02 && PV[i]![2] > 0)
const nose = mid.filter(i => PV[i]![1] > -0.9).reduce((a, i) => (PV[i]![2] > PV[a]![2] ? i : a))
const mouthPart = D.parts.find(p => p.kind === 'feature' && p.color[0] === 180), mv = mouthPart ? [...new Set(mouthPart.tris)] : []
const chin = skin.filter(i => Math.abs(PV[i]![0]) < 0.03 && PV[i]![2] > 0.6).reduce((a, i) => (PV[i]![1] < PV[a]![1] ? i : a))
const L3 = (P: P3[]) => { const mean = (is: number[]): P3 => [0, 1, 2].map(k => is.reduce((a, i) => a + P[i]![k]!, 0) / is.length) as P3
  const n = eye(-1), f = eye(1), m = mean(mv)
  return { nO: P[n.O]!, nI: P[n.I]!, nIris: mean(irisC(-1)), fI: P[f.I]!, fO: P[f.O]!, fIris: mean(irisC(1)), nose: P[nose]!, mouth: [0, m[1], Math.max(...mv.map(i => P[i]![2]))] as P3, chin: P[chin]! } as Record<string, P3> }
/** turn and tilt by grid (0.5°), then scale and shift by least squares */
// NOMINAL=1: the turn and tilt the picture was asked for (its name: up45 / zero / down45, yaw N), only scale and shift fitted
const NOMINAL = !!process.env.NOMINAL
function fitView(L: Record<string, P3>, obs: Record<string, P2>, nominal?: { yaw: number; pitch: number }) {
  const ks = Object.keys(obs).filter(k => L[k]); let best = { e: Infinity, yaw: 0, pitch: 0, s: 1, tx: 0, ty: 0 }
  const tryV = (yaw: number, pitch: number) => { const X = ks.map(k => { const r = rotate(L[k]!, { yaw, pitch }); return [r[0], -r[1]] as P2 }), n = ks.length
    const mx = X.reduce((a, p) => a + p[0], 0) / n, my = X.reduce((a, p) => a + p[1], 0) / n, mu = ks.reduce((a, k) => a + obs[k]![0], 0) / n, mvv = ks.reduce((a, k) => a + obs[k]![1], 0) / n
    const num = X.reduce((a, p, i) => a + (p[0] - mx) * (obs[ks[i]!]![0] - mu) + (p[1] - my) * (obs[ks[i]!]![1] - mvv), 0), den = X.reduce((a, p) => a + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0)
    const s = num / den, tx = mu - s * mx, ty = mvv - s * my, e = Math.sqrt(X.reduce((a, p, i) => a + (s * p[0] + tx - obs[ks[i]!]![0]) ** 2 + (s * p[1] + ty - obs[ks[i]!]![1]) ** 2, 0) / n)
    if (e < best.e) best = { e, yaw, pitch, s, tx, ty } }
  if (nominal) { tryV(nominal.yaw, nominal.pitch); return best }
  const lo = !obs.fI && !obs.fO ? 60 : -20
  for (let y = lo; y <= 105; y += 2) for (let p = -60; p <= 60; p += 2) tryV(y, p)
  const b0 = { ...best }; for (let y = b0.yaw - 2; y <= b0.yaw + 2; y += 0.5) for (let p = b0.pitch - 2; p <= b0.pitch + 2; p += 0.5) tryV(y, p)
  return best
}
/** the shell's outline at a view, in picture pixels */
function outlinePx(P: P3[], v: { yaw: number; pitch: number; s: number; tx: number; ty: number }) {
  const W = 360, F = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.45 }, ras = rasterHead({ ...D, P } as unknown as Parameters<typeof rasterHead>[0], { yaw: v.yaw, pitch: v.pitch }, F, new Uint8ClampedArray(W * W * 4))
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity
  let s0: [number, number] | null = null; for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 20000; n++) { const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  return cells.filter((_, k) => k % 2 === 0).map(([i, j]) => { const x = (i + 0.5 - F.cx) / F.S, y = (F.cy - (j + 0.5)) / F.S; return [v.s * x + v.tx, -v.s * y + v.ty] as P2 })
}
const names = Object.keys(LM).filter(k => !k.startsWith('_') && !k.startsWith('key'))
const SH = [{ name: 'VRoid', P: PV, col: '#1f6fd1' }, { name: '捏过的副本', P: PS, col: '#d0342c' }]
const res = names.map(n => { const obs = LM[n] as Record<string, P2>
  return { n, fits: SH.map(sh => { const L = L3(sh.P), nm = /^(up45|zero|down45)-yaw(\d+)/.exec(n)!, f = fitView(L, obs, NOMINAL ? { yaw: +nm[2]!, pitch: nm[1] === 'up45' ? 45 : nm[1] === 'down45' ? -45 : 0 } : undefined); return { ...f, out: outlinePx(sh.P, f), lm: Object.fromEntries(Object.entries(L).map(([k, p]) => { const r = rotate(p, f); return [k, [f.s * r[0] + f.tx, -f.s * r[1] + f.ty]] })) } }) } })
for (const r of res) console.log(r.n, r.fits.map((f, i) => `${SH[i]!.name} 转${f.yaw} 俯仰${f.pitch} 标点误差${f.e.toFixed(1)}px`).join(' | '))
// the sheet: 5 columns (turn 0/30/60/75/90) × 3 rows (up 45 / zero / down 45), each picture 1254 px shown at 300
const C = 5, R = 3, Pn = 300, k = Pn / 1254, order = ['up45', 'zero', 'down45'].flatMap(p => [0, 30, 60, 75, 90].map(y => `${p}-yaw${y}`))
let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${C * Pn} ${C * Pn}" width="${C * Pn}" height="${C * Pn}" font-family="system-ui"><rect width="100%" height="100%" fill="#fff"/>`
order.forEach((n, idx) => { const r = res.find(x => x.n === n); if (!r) return; const ox = (idx % C) * Pn, oy = Math.floor(idx / C) * Pn
  const img = readFileSync(`${DIR}thumbs/${n}-1.png`).toString('base64')
  svg += `<image x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" opacity="0.55" xlink:href="data:image/png;base64,${img}"/>`
  r.fits.forEach((f, i) => { svg += `<polygon fill="none" stroke="${SH[i]!.col}" stroke-width="1.6" points="${f.out.map(p => `${(ox + p[0] * k).toFixed(1)},${(oy + p[1] * k).toFixed(1)}`).join(' ')}"/>` })
  for (const [kk, p] of Object.entries(LM[n] as Record<string, P2>)) svg += `<circle cx="${(ox + p[0] * k).toFixed(1)}" cy="${(oy + p[1] * k).toFixed(1)}" r="2.2" fill="#111"/>`
  svg += `<rect x="${ox}" y="${oy}" width="${Pn}" height="${Pn}" fill="none" stroke="#ccc"/><text x="${ox + 4}" y="${oy + 14}" font-size="11">${n}</text>`
  r.fits.forEach((f, i) => { svg += `<text x="${ox + 4}" y="${oy + Pn - 20 + i * 13}" font-size="10" fill="${SH[i]!.col}">${SH[i]!.name}: 转${f.yaw} 俯仰${f.pitch} 标点 ${f.e.toFixed(0)}px</text>` }) })
svg += `<text x="20" y="${R * Pn + 30}" font-size="16"><tspan fill="#1f6fd1">蓝 = VRoid 原头</tspan>　<tspan fill="#d0342c">红 = 捏过的副本（按之前模型的脸轮廓反推）</tspan>　黑点 = 图上手标的眼角、瞳孔、鼻尖、嘴、下巴</text>`
svg += `<text x="20" y="${R * Pn + 56}" font-size="13" fill="#555">${NOMINAL ? '角度按图的名字（仰45/0/俯45、转 N°）固定，只用这些标点定缩放和位置（不变形），' : '每个头各自用这些标点定角度、缩放、位置（不变形），'}再把它在那个角度的外轮廓画上去。头发盖住的部分看不到图上的头形，只看脸的那一圈。</text>`
writeFileSync(`face3d/viewer/ref-shell/shells-on-dot${NOMINAL ? '-nominal' : ''}.svg`, svg + '</svg>')
writeFileSync(`face3d/viewer/ref-shell/shells-on-dot${NOMINAL ? '-nominal' : ''}.json`, JSON.stringify(res.map(r => ({ picture: r.n, fits: r.fits.map((f, i) => ({ shell: SH[i]!.name, yaw: f.yaw, pitch: f.pitch, scale: f.s, tx: f.tx, ty: f.ty, landmarkRms: +f.e.toFixed(2) })) })), null, 1))
