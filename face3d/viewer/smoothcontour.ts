// VRoid's outline found on the model's surface (face3d/fit/smooth-contour.ts; bowen 1793202978), over the head, against the old
// picture-traced outline.
import vrmUrl from '../fit/ref/test.vrm?url'
import { type P2, buildHead, contourAt } from '../fit/contour-keys-core'
import { type Surf, outlineLines, shows, surface } from '../fit/smooth-contour'
import { rasterHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
const yBase = (await (await fetch('./contour-keys.json')).json() as { yBase: number }).yBase
const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!, W = 800, F = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.42 }, img = new Uint8ClampedArray(W * W * 4), off = document.createElement('canvas'); off.width = off.height = W
let yaw = 30, pitch = 10, head: ReturnType<typeof buildHead> | null = null, S: Surf | null = null
function build() { if (head) S = surface(head.P, head.skinTris, +$<HTMLSelectElement>('smooth').value) }
function draw() {
  if (!head || !S) return
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  $('view').textContent = `转 ${yaw}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch)}°`
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); const s = Math.min(w, h) / W, ox = (w - W * s) / 2, oy = (h - W * s) / 2, v = { yaw, pitch }
  const ras = rasterHead(head, v, F, img.fill(0))
  if (on('sImg')) { for (let k = 3; k < img.length; k += 4) img[k] = img[k - 1]! || img[k - 2]! || img[k - 3]! ? 255 : 0; off.getContext('2d')!.putImageData(new ImageData(img, W, W), 0, 0); g.globalAlpha = 0.45; g.drawImage(off, ox, oy, W * s, W * s); g.globalAlpha = 1 }
  const T = (q: readonly number[]) => [ox + (F.cx + q[0]! * F.S) * s, oy + (F.cy - q[1]! * F.S) * s] as const
  if (on('sPix')) { const o: P2[] = contourAt(head, yaw, pitch, undefined, 8); g.beginPath(); o.forEach((q, k) => { const [x, y] = T(q); k ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath(); g.strokeStyle = '#000'; g.lineWidth = 1.2 * dpr; g.stroke() }
  for (const L of outlineLines(S, v)) { const pts = L.map(p => ({ q: rotate(p.p, v), vis: shows(p, v, ras.zb, F) }))
    for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k]!, b = pts[k + 1]!, vis = a.vis && b.vis; if (vis ? !on('sLine') : !on('sHid')) continue
      const [x0, y0] = T(a.q), [x1, y1] = T(b.q); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = vis ? '#1a9a3a' : 'rgba(120,170,220,.6)'; g.lineWidth = (vis ? 2.2 : 1) * dpr; g.stroke() } }
}
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => { head = buildHead(() => b.slice(0), yBase); build(); draw() })
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null, sweeping = false
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (!drag || sweeping) return; yaw = Math.round(drag.yaw + (e.clientX - drag.x) * 0.4); pitch = Math.max(-90, Math.min(90, Math.round(drag.pitch - (e.clientY - drag.y) * 0.4))); draw() }
cv.onpointerup = () => { drag = null }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
for (const id of ['sLine', 'sHid', 'sPix', 'sImg']) $(id).onchange = () => draw()
$('smooth').onchange = () => { build(); draw() }
$('sweep').onclick = async () => { if (sweeping) return; sweeping = true; for (let k = 0; k <= 180; k++) { yaw = k * 0.5; draw(); await new Promise(r => setTimeout(r, 0)) } sweeping = false }
addEventListener('resize', () => draw())
