// How few outline keyframes are enough (face3d/fit/contour-adaptive.ts → contour-adaptive.json; bowen 1793155191 / 1793155230):
// the keyframes of a tolerance on the turn × tilt plane, and the mix at any view against VRoid's live outline.
import vrmUrl from '../fit/ref/test.vrm?url'
import { F, HALF, type P2, W, buildHead, contourAt } from '../fit/contour-keys-core'
import { type Pt, bary, delaunay } from '../fit/delaunay'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
// ?a=8: the keyframes with 8 anchors round the outline (default 2: top and bottom)
const A = +(new URLSearchParams(location.search).get('a') ?? 8)
const D = (await (await fetch(`./contour-adaptive-a${A}.json`)).json()) as { yBase: number; table: { tol: number; keys: number }[]; keys: { v: Pt; c: number[] }[] }
const M = 2 * HALF, tierS = $<HTMLSelectElement>('tier')
for (const [i, t] of D.table.entries()) { const o = document.createElement('option'); o.value = String(i); o.textContent = `≤ ${t.tol}（${t.keys} 个关键帧）`; tierS.appendChild(o) }
tierS.value = String(D.table.findIndex(t => t.tol === 0.02) >= 0 ? D.table.findIndex(t => t.tol === 0.02) : 0)
let tris: [number, number, number][] = [], nKeys = 0
function build() { nKeys = D.table[+tierS.value]!.keys; const d = delaunay(D.keys.slice(0, 4).map(k => k.v)); for (const k of D.keys.slice(4, nKeys)) d.insert(k.v); tris = d.triangles() }
/** the mix at a view: the triangle it lies in, its three keyframes by barycentric weights */
function mixAt(y: number, p: number) {
  for (const t of tris) { const [a, b, c] = t.map(i => D.keys[i]!) as [typeof D.keys[0], typeof D.keys[0], typeof D.keys[0]], w = bary(a.v, b.v, c.v, [y, p]); if (w.every(x => x >= -1e-9))
    return { t, pts: Array.from({ length: M }, (_, k) => [0, 1].map(m => w[0] * a.c[2 * k + m]! + w[1] * b.c[2 * k + m]! + w[2] * c.c[2 * k + m]!) as P2) } }
  throw Error('outside')
}
/** the miss as the script measures it: the farthest point either way, each against the other's line near the same index; the
 * points at the neck's cut (of VRoid's outline, and the mix's of the same index) left out */
function miss(P: P2[], B: P2[], cut: number[]) { let worst = 0
  for (const [X, Y] of [[P, B], [B, P]] as [P2[], P2[]][]) for (let k = 0; k < M; k++) { if (cut[k]) continue; let best = Infinity; const [x, y] = X[k]!
    for (let d = -15; d < 15; d++) { const a = Y[(k + d + M) % M]!, b = Y[(k + d + 1 + M) % M]!, bx = b[0] - a[0], by = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by) / (bx * bx + by * by || 1))); best = Math.min(best, Math.hypot(x - a[0] - t * bx, y - a[1] - t * by)) }
    worst = Math.max(worst, best) } return worst }
const shapeStep = (A: P2[], B: P2[]) => { const f = (X: P2[], Y: P2[]) => X.reduce((s, a) => s + Math.min(...Y.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))), 0) / X.length; return (f(A, B) + f(B, A)) / 2 }
const mapC = $<HTMLCanvasElement>('map'), mg = mapC.getContext('2d')!, cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!
let head: ReturnType<typeof buildHead> | null = null, yaw = 67, pitch = 37
const img = new Uint8ClampedArray(W * W * 4), off = document.createElement('canvas'); off.width = off.height = W
let plot: { live: number[]; mix: number[]; label: string } | null = null
const fit = (c: HTMLCanvasElement) => { const dpr = devicePixelRatio || 1, r = c.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (c.width !== w || c.height !== h) { c.width = w; c.height = h } return [w, h, dpr] as const }
const mapBox = () => { const [w, h] = [mapC.width, mapC.height], s = Math.min(w, h) - 60 * (devicePixelRatio || 1); return { s, ox: (w - s) / 2, oy: (h - s) / 2 } }
function drawMap(tri?: [number, number, number]) {
  const [w, h, dpr] = fit(mapC), { s, ox, oy } = mapBox(), X = (y: number) => ox + ((y + 90) / 180) * s, Y = (p: number) => oy + ((90 - p) / 180) * s
  mg.fillStyle = '#fff'; mg.fillRect(0, 0, w, h); mg.strokeStyle = '#bbb'; mg.strokeRect(ox, oy, s, s)
  mg.font = `${11 * dpr}px system-ui`; mg.fillStyle = '#888'; for (const a of [-90, -45, 0, 45, 90]) { mg.fillText(`转${a}`, X(a) - 12 * dpr, oy + s + 16 * dpr); mg.fillText(a > 0 ? `仰${a}` : a < 0 ? `俯${-a}` : '0', ox - 34 * dpr, Y(a) + 4 * dpr) }
  mg.strokeStyle = 'rgba(0,0,0,.13)'; mg.lineWidth = 1; mg.beginPath(); for (const t of tris) { const P = t.map(i => D.keys[i]!.v); mg.moveTo(X(P[0]![0]), Y(P[0]![1])); mg.lineTo(X(P[1]![0]), Y(P[1]![1])); mg.lineTo(X(P[2]![0]), Y(P[2]![1])); mg.closePath() } mg.stroke()
  if (tri) { mg.fillStyle = 'rgba(215,100,100,.18)'; mg.beginPath(); tri.forEach((i, k) => { const v = D.keys[i]!.v; k ? mg.lineTo(X(v[0]), Y(v[1])) : mg.moveTo(X(v[0]), Y(v[1])) }); mg.fill() }
  mg.fillStyle = '#1a6ad0'; for (const k of D.keys.slice(0, nKeys)) { mg.beginPath(); mg.arc(X(k.v[0]), Y(k.v[1]), 2.2 * dpr, 0, 7); mg.fill() }
  mg.strokeStyle = '#d33'; mg.lineWidth = 1.5 * dpr; mg.beginPath(); mg.arc(X(yaw), Y(pitch), 5 * dpr, 0, 7); mg.stroke()
}
function draw(live?: P2[]) {
  $('view').textContent = `看：转 ${yaw}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch)}°`; $('count').textContent = `${nKeys} 个关键帧`
  const mix = mixAt(yaw, pitch); drawMap(mix.t)
  const [w, h, dpr] = fit(cv); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h)
  const top = plot ? h * 0.62 : h, s = Math.min(w, top) / W, ox = (w - W * s) / 2, oy = (top - W * s) / 2, T = (p: P2) => [ox + (F.cx + p[0] * F.S) * s, oy + (F.cy - p[1] * F.S) * s] as const
  let cut: number[] = []
  if (!live && head) live = contourAt(head, yaw, pitch, img.fill(0), A, cut); else if (live && head) contourAt(head, yaw, pitch, img.fill(0), A, cut)
  if (on('sHead') && head) { for (let k = 3; k < img.length; k += 4) img[k] = img[k - 1]! || img[k - 2]! || img[k - 3]! ? 255 : 0; off.getContext('2d')!.putImageData(new ImageData(img, W, W), 0, 0); g.globalAlpha = 0.35; g.drawImage(off, ox, oy, W * s, W * s); g.globalAlpha = 1 }
  const line = (pts: P2[], col: string, lw: number, dash: number[] = []) => { g.beginPath(); pts.forEach((p, k) => { const [x, y] = T(p); k ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = lw * dpr; g.stroke(); g.setLineDash([]) }
  if (on('sKeys')) for (const i of mix.t) { const k = D.keys[i]!; line(Array.from({ length: M }, (_, m) => [k.c[2 * m]!, k.c[2 * m + 1]!] as P2), 'rgba(215,100,100,.6)', 1, [4, 3]) }
  if (on('sTrue') && live) line(live, '#000', 1.4)
  if (on('sMix')) line(mix.pts, '#1a9a3a', 2)
  if (live) $('stat').textContent = `这个角度：混合离 VRoid 最远 ${miss(mix.pts, live, cut).toFixed(4)}（不算脖子截口）（三个关键帧 ${mix.t.map(i => D.keys[i]!.v.join('/')).join('，')}）`
  if (plot) { const px = 40 * dpr, pw = w - 80 * dpr, py = top + 24 * dpr, ph = h - top - 70 * dpr, mx = Math.max(...plot.live, ...plot.mix, 1e-6)
    g.fillStyle = '#333'; g.font = `${12 * dpr}px system-ui`; g.fillText(`只看形状的变化，每 0.5° 一步（${plot.label}）　最高 ${mx.toFixed(4)}`, px, py - 8 * dpr); g.strokeStyle = '#ccc'; g.lineWidth = 1; g.strokeRect(px, py, pw, ph)
    for (const [ser, col] of [[plot.live, '#000'], [plot.mix, '#1a9a3a']] as const) { g.beginPath(); ser.forEach((v, k) => { const x = px + (k / Math.max(1, ser.length - 1)) * pw, y = py + ph - (v / mx) * ph; k ? g.lineTo(x, y) : g.moveTo(x, y) }); g.strokeStyle = col; g.lineWidth = 1.3 * dpr; g.stroke() }
    const st = (a: number[]) => { const d = a.slice(1).map((v, k) => Math.abs(v - a[k]!)); return `平均每步 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4)}，最大 ${Math.max(...a).toFixed(4)}，相邻步之差 ${(d.reduce((x, y) => x + y, 0) / Math.max(1, d.length)).toFixed(4)}` }
    g.fillStyle = '#000'; g.fillText(`实时：${st(plot.live)}`, px, py + ph + 18 * dpr); g.fillStyle = '#1a9a3a'; g.fillText(`混合：${st(plot.mix)}`, px, py + ph + 34 * dpr) }
}
let sweeping = false
async function sweep() {
  if (!head || sweeping) return; sweeping = true; plot = { live: [], mix: [], label: `转 0→90，俯仰 ${pitch}°，${nKeys} 个关键帧` }; let pm: P2[] | null = null, pl: P2[] | null = null
  for (let k = 0; k <= 180; k++) { yaw = k * 0.5; const live = contourAt(head, yaw, pitch, img.fill(0), A), mix = mixAt(yaw, pitch).pts
    if (pm && pl) { plot.mix.push(shapeStep(mix, pm)); plot.live.push(shapeStep(live, pl)) } pm = mix; pl = live; draw(live); await new Promise(r => setTimeout(r, 0)) }
  sweeping = false
}
build(); draw()
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => { head = buildHead(() => b.slice(0), D.yBase); draw() })
const pick = (e: PointerEvent) => { const r = mapC.getBoundingClientRect(), dpr = devicePixelRatio || 1, { s, ox, oy } = mapBox(), x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr
  yaw = Math.max(-90, Math.min(90, Math.round(((x - ox) / s) * 180 - 90))); pitch = Math.max(-90, Math.min(90, Math.round(90 - ((y - oy) / s) * 180))); draw() }
let down = false
mapC.onpointerdown = e => { if (sweeping) return; down = true; mapC.setPointerCapture(e.pointerId); pick(e) }
mapC.onpointermove = e => { if (down && !sweeping) pick(e) }
mapC.onpointerup = () => { down = false }
tierS.onchange = () => { build(); plot = null; draw() }
for (const id of ['sMix', 'sTrue', 'sKeys', 'sHead']) $(id).onchange = () => draw()
$('sweep').onclick = () => sweep()
addEventListener('resize', () => draw())
