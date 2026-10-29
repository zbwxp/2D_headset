// The head shell (nose and lips pressed flat) and the nose part, each outlined, against the whole head (bowen 1793155916).
import vrmUrl from '../fit/ref/test.vrm?url'
import { F, type P2, W, buildHead, contourAt } from '../fit/contour-keys-core'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
// ?neck=wire | tube | cap | cut: the head cut at bowen's head–neck ring and the neck its own part (default), the neck a long tube cut
// by the circle round the head, no neck (flat cap), or cut at its base ring
const NECK = (new URLSearchParams(location.search).get('neck') ?? 'wire') as 'wire' | 'tube' | 'cap' | 'cut'
const wire = (await (await fetch('./ref-shell/bowen-1793118841-sym.json')).json() as { lines: { name: string; c: number[][] }[] }).lines
const yBase = (await (await fetch('./contour-keys.json')).json() as { yBase: number }).yBase
const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!, img = new Uint8ClampedArray(W * W * 4), off = document.createElement('canvas'); off.width = off.height = W
let yaw = 63, pitch = 0, whole: ReturnType<typeof buildHead> | null = null, shell: ReturnType<typeof buildHead> | null = null
function draw() {
  if (!whole || !shell) return
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  $('view').textContent = `转 ${yaw}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch)}°`
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); const s = Math.min(w, h) / W, ox = (w - W * s) / 2, oy = (h - W * s) / 2, T = (p: P2) => [ox + (F.cx + p[0] * F.S) * s, oy + (F.cy - p[1] * F.S) * s] as const
  const line = (pts: P2[], col: string, lw: number, dash: number[] = []) => { g.beginPath(); pts.forEach((p, k) => { const [x, y] = T(p); k ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = lw * dpr; g.stroke(); g.setLineDash([]) }
  const sh = contourAt(shell, yaw, pitch, img.fill(0), 8)
  if (on('sImg')) { for (let k = 3; k < img.length; k += 4) img[k] = img[k - 1]! || img[k - 2]! || img[k - 3]! ? 255 : 0; off.getContext('2d')!.putImageData(new ImageData(img, W, W), 0, 0); g.globalAlpha = 0.4; g.drawImage(off, ox, oy, W * s, W * s); g.globalAlpha = 1 }
  if (on('sTrue')) line(contourAt(whole, yaw, pitch, undefined, 8), '#000', 1.2)
  if (on('sShell')) line(sh, '#2a62c9', 1.8)
  if (on('sNose')) line(contourAt(shell.nose!, yaw, pitch, undefined, 8), '#d0453a', 1.8)
  if (on('sNeck') && shell.neck) line(contourAt(shell.neck, yaw, pitch, undefined, 8), '#8a4fc2', 1.8)
}
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => { whole = buildHead(() => b.slice(0), yBase, false, NECK, wire); shell = buildHead(() => b.slice(0), yBase, true, NECK, wire); draw() })
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (!drag) return; yaw = Math.max(-90, Math.min(90, Math.round(drag.yaw + (e.clientX - drag.x) * 0.4))); pitch = Math.max(-90, Math.min(90, Math.round(drag.pitch - (e.clientY - drag.y) * 0.4))); draw() }
cv.onpointerup = () => { drag = null }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
for (const id of ['sShell', 'sNose', 'sNeck', 'sTrue', 'sImg']) $(id).onchange = () => draw()
addEventListener('resize', () => draw())
