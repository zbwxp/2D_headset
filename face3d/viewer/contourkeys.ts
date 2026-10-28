// The keyframe outline f(yaw, pitch) beside VRoid's live outline (face3d/fit/contour-keys.ts → contour-keys.json; bowen 1793153948).
import vrmUrl from '../fit/ref/test.vrm?url'
import data from './contour-keys.json'
import { F, type P2, PS, STEP, W, YS, buildHead, contourAt, mixAt } from '../fit/contour-keys-core'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
const D = data as unknown as { yBase: number; keys: P2[][][] }
const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!, yawI = $<HTMLInputElement>('yaw'), pitchI = $<HTMLInputElement>('pitch')
let head: ReturnType<typeof buildHead> | null = null, yaw = 22.5, pitch = 10, zoom = 1
const img = new Uint8ClampedArray(W * W * 4), off = document.createElement('canvas'); off.width = off.height = W
// the per-step move of the matched points while sweeping (one series each)
let moves: { mix: number[]; live: number[]; mixS: number[]; liveS: number[]; label: string } | null = null
function step(a: P2[], b: P2[]) { return a.reduce((s, q, k) => s + Math.hypot(q[0] - b[k]![0], q[1] - b[k]![1]), 0) / a.length }
/** the shape's change alone (points sliding along the same line don't count): mean nearest distance, both ways */
function shapeStep(A: P2[], B: P2[]) { const f = (X: P2[], Y: P2[]) => X.reduce((s, a) => s + Math.min(...Y.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))), 0) / X.length; return (f(A, B) + f(B, A)) / 2 }
function draw(live?: P2[]) {
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect(), Wc = Math.round(r.width * dpr), Hc = Math.round(r.height * dpr)
  if (cv.width !== Wc || cv.height !== Hc) { cv.width = Wc; cv.height = Hc }
  $('view').textContent = `转 ${yaw}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch)}°`; yawI.value = String(yaw); pitchI.value = String(pitch)
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, Wc, Hc)
  const half = Math.round(Wc * 0.6), s = Math.min(half, Hc) / W * zoom, ox = (half - W * s) / 2, oy = (Hc - W * s) / 2
  const T = (p: P2) => [ox + (F.cx + p[0] * F.S) * s, oy + (F.cy - p[1] * F.S) * s] as const
  if (!live && head) live = contourAt(head, yaw, pitch, img.fill(0))
  if (on('sHead') && head) { for (let k = 3; k < img.length; k += 4) img[k] = img[k - 1]! || img[k - 2]! || img[k - 3]! ? 255 : 0; off.getContext('2d')!.putImageData(new ImageData(img, W, W), 0, 0); g.globalAlpha = 0.35; g.drawImage(off, ox, oy, W * s, W * s); g.globalAlpha = 1 }
  const line = (pts: P2[], col: string, w: number, dash: number[] = []) => { g.beginPath(); pts.forEach((p, k) => { const [x, y] = T(p); k ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = w * dpr; g.stroke(); g.setLineDash([]) }
  if (on('sKeys')) { const i = Math.min(11, Math.floor((yaw + 90) / STEP)), j = Math.min(11, Math.floor((pitch + 90) / STEP))
    for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]] as const) { line(D.keys[a]![b]!, 'rgba(215,100,100,.55)', 1, [4, 3]) }
    g.fillStyle = '#c55'; g.font = `${11 * dpr}px system-ui`; g.fillText(`红虚线 = 关键帧 转${YS[i]}/${YS[i + 1]} × 俯仰${PS[j]}/${PS[j + 1]}`, 12 * dpr, 20 * dpr) }
  const mix = mixAt(D.keys, yaw, pitch)
  if (on('sTrue') && live) line(live, '#000', 1.4)
  if (on('sMix')) { line(mix, '#1a9a3a', 2); const [x, y] = T(mix[0]!); g.fillStyle = '#1a9a3a'; g.beginPath(); g.arc(x, y, 3 * dpr, 0, 7); g.fill(); const [bx, by] = T(mix[180]!); g.beginPath(); g.arc(bx, by, 3 * dpr, 0, 7); g.fill() }
  if (live) { const d = mix.map(a => Math.min(...live!.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])))).sort((x, y) => x - y)
    $('stat').textContent = `混合离实时轮廓：中位 ${d[90]!.toFixed(4)} · 九成 ${d[162]!.toFixed(4)} · 最大 ${d[179 * 2 - 1]!.toFixed(4)}（头高约 2.4）` }
  // the sweep plots on the right: matched points' move per step, and the shape's change alone
  const px = half + 20 * dpr, pw = Wc - px - 20 * dpr, ph = Math.min(Hc * 0.3, 220 * dpr)
  const plot = (py: number, title: string, live: number[] | undefined, mix: number[] | undefined) => {
    g.fillStyle = '#333'; g.font = `${12 * dpr}px system-ui`; g.fillText(title, px, py - 10 * dpr); g.strokeStyle = '#ccc'; g.lineWidth = 1; g.strokeRect(px, py, pw, ph)
    if (!live || !mix) return; const mx = Math.max(...live, ...mix, 1e-6)
    for (const [ser, col] of [[live, '#000'], [mix, '#1a9a3a']] as const) { g.beginPath(); ser.forEach((v, k) => { const x = px + (k / Math.max(1, ser.length - 1)) * pw, y = py + ph - (v / mx) * ph; k ? g.lineTo(x, y) : g.moveTo(x, y) }); g.strokeStyle = col; g.lineWidth = 1.3 * dpr; g.stroke() }
    const st = (a: number[]) => { const d = a.slice(1).map((v, k) => Math.abs(v - a[k]!)); return `平均每步 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4)}，最大 ${Math.max(...a).toFixed(4)}，相邻步之差 ${(d.reduce((x, y) => x + y, 0) / Math.max(1, d.length)).toFixed(4)}` }
    g.fillStyle = '#666'; g.fillText(`最高 ${mx.toFixed(4)}`, px + 4, py + 14 * dpr)
    g.fillStyle = '#000'; g.fillText(`实时：${st(live)}`, px, py + ph + 18 * dpr); g.fillStyle = '#1a9a3a'; g.fillText(`混合：${st(mix)}`, px, py + ph + 34 * dpr) }
  const lab = moves ? `（${moves.label}，每 0.5° 一步）` : '（按「扫一遍」）'
  plot(40 * dpr, `对应点平均移动${lab}`, moves?.live, moves?.mix)
  plot(40 * dpr + ph + 80 * dpr, `只看形状的变化（点沿线滑动不算）${lab}`, moves?.liveS, moves?.mixS)
}
let sweeping = false
async function sweep(axis: 'yaw' | 'pitch') {
  if (!head || sweeping) return; sweeping = true
  const vals = axis === 'yaw' ? Array.from({ length: 181 }, (_, k) => k * 0.5) : Array.from({ length: 361 }, (_, k) => -90 + k * 0.5)
  moves = { mix: [], live: [], mixS: [], liveS: [], label: axis === 'yaw' ? `转 0→90，俯仰 ${pitch}°` : `俯仰 −90→90，转 ${yaw}°` }
  let pm: P2[] | null = null, pl: P2[] | null = null
  for (const v of vals) { if (axis === 'yaw') yaw = v; else pitch = v
    const live = contourAt(head, yaw, pitch, img.fill(0)), mix = mixAt(D.keys, yaw, pitch)
    if (pm && pl) { moves.mix.push(step(mix, pm)); moves.live.push(step(live, pl)); moves.mixS.push(shapeStep(mix, pm)); moves.liveS.push(shapeStep(live, pl)) } pm = mix; pl = live
    draw(live); await new Promise(r => setTimeout(r, 0)) }
  sweeping = false
}
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => { head = buildHead(() => b.slice(0), D.yBase); draw() })
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (!drag || sweeping) return; yaw = Math.max(-90, Math.min(90, Math.round((drag.yaw + (e.clientX - drag.x) * 0.4) * 2) / 2)); pitch = Math.max(-90, Math.min(90, Math.round((drag.pitch - (e.clientY - drag.y) * 0.4) * 2) / 2)); draw() }
cv.onpointerup = () => { drag = null }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.002))); draw() }
yawI.oninput = () => { yaw = +yawI.value; draw() }; pitchI.oninput = () => { pitch = +pitchI.value; draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
for (const id of ['sMix', 'sTrue', 'sKeys', 'sHead']) $(id).onchange = () => draw()
$('sweep').onclick = () => sweep('yaw'); $('sweepP').onclick = () => sweep('pitch')
addEventListener('resize', () => draw())
