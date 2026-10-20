// face3d viewer (PLAN §5): a fixed address; rotate by drag / sliders; the 25-cell master grid drawn from the model.
import { type DrawnBone, bonesAt, contourAt, makeModel, outerBoundary, visibleOutline } from '../src/model'
import { type V3, type View, rotate } from '../src/view'
import { defaultShape } from '../src/head'
import { type Params, shapeOf } from '../fit/shape'
import fitted from '../fit/ref/fit-level.json'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = $('status')
status.textContent = '正在建模型（约 2 秒）…'
const t0 = performance.now()
// the head: fitted to the reference sheet's level row (bowen 1792498982) unless ?head=old asks for the earlier one
const oldHead = new URLSearchParams(location.search).get('head') === 'old'
const model = makeModel(oldHead ? defaultShape : shapeOf(fitted as Params))
status.textContent = `模型就绪（${oldHead ? '旧头型' : '按画稿拟合的头型'}）：${(performance.now() - t0).toFixed(0)} ms`

const PART: Record<DrawnBone['part'], string> = { eye: '#8e24aa', brow: '#8e24aa', nose: '#1565c0', mouth: '#ef6c00', chin: '#c62828', ear: '#2e7d32', neck: '#2e7d32' }
const SIDE = { pos: '#d32f2f', neg: '#1976d2' }

interface Opts { mix: boolean; raw: boolean; outer: boolean; ghost: boolean; bones: boolean; anchors: boolean; w: number }
function draw(g: CanvasRenderingContext2D, view: View, cx: number, cy: number, S: number, o: Opts) {
  const P = (p: V3) => { const r = rotate(p, view); return [cx + r[0] * S, cy - r[1] * S] as const }
  const line = (pts: V3[], close = false) => { g.beginPath(); pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]) }); if (close) g.closePath(); g.stroke() }
  g.lineJoin = g.lineCap = 'round'
  if (o.outer) { g.fillStyle = '#c8c8c8'; for (const [x, y] of outerBoundary(model, view)) g.fillRect(cx + x * S - o.w, cy - y * S - o.w, o.w * 2, o.w * 2) }
  if (o.raw) { g.strokeStyle = o.mix ? '#a0a0a0' : '#444'; g.lineWidth = o.w * 1.6; g.setLineDash([]); g.globalAlpha = 0.8; for (const run of visibleOutline(model, view)) line(run); g.globalAlpha = 1 }
  if (o.bones) for (const b of bonesAt(model, view)) {
    g.strokeStyle = PART[b.part]
    for (let i = 0; i < b.pts.length - (b.closed ? 0 : 1); i++) {
      const j = (i + 1) % b.pts.length, f = b.facing[i]! && b.facing[j]!
      g.globalAlpha = f ? 1 : 0.3; g.lineWidth = o.w * (f ? 2 : 1); g.setLineDash(f && b.part !== 'neck' ? [] : [o.w * 4, o.w * 3])
      line([b.pts[i]!, b.pts[j]!])
    }
    g.globalAlpha = 1; g.setLineDash([])
  }
  if (o.mix) for (const c of contourAt(model, view)) {
    g.strokeStyle = SIDE[c.side]; g.lineWidth = o.w * 2.6
    // a segment's opacity is its mixed visibility: 0 draws nothing (the ghost switch shows hidden parts faintly, debug)
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const v = Math.min(c.vis[i]!, c.vis[i + 1]!)
      g.globalAlpha = o.ghost ? 0.12 + 0.88 * v : v
      if (g.globalAlpha > 0.001) line([c.pts[i]!, c.pts[i + 1]!])
    }
    g.globalAlpha = 1
    if (o.anchors) { g.fillStyle = SIDE[c.side]; for (const k of [0, ...c.anchors]) { const q = P(c.pts[k]!); g.beginPath(); g.arc(q[0], q[1], o.w * 4, 0, 7); g.fill() } }
  }
}

// ---- the main view ----------------------------------------------------------------------------------------------------
const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!
const read = (): Opts => ({ mix: $<HTMLInputElement>('mix').checked, raw: $<HTMLInputElement>('raw').checked, outer: $<HTMLInputElement>('outer').checked, ghost: $<HTMLInputElement>('ghost').checked, bones: $<HTMLInputElement>('bones').checked, anchors: $<HTMLInputElement>('anchors').checked, w: 1.5 })
const fromHash = () => { const m = /yaw=(-?\d+).*pitch=(-?\d+)/.exec(location.hash); return m ? { yaw: +m[1]!, pitch: +m[2]! } : { yaw: 30, pitch: 0 } }
let view: View = fromHash(), pending = false
const pitchName = (p: number) => p === 0 ? '平视' : p > 0 ? `仰视 ${p}°` : `俯视 ${-p}°`
function render() {
  pending = false
  const W = cv.width
  g.clearRect(0, 0, W, W)
  draw(g, view, W / 2, W * 0.42, W / 3.4, read())
  g.fillStyle = '#333'; g.font = '28px "PingFang SC", sans-serif'; g.fillText(`yaw ${view.yaw}°  ·  ${pitchName(view.pitch)}`, 20, 40)
  $('yv').textContent = `${view.yaw}°`; $('pv').textContent = `${view.pitch}°（${pitchName(view.pitch)}）`
  $<HTMLInputElement>('yaw').value = String(view.yaw); $<HTMLInputElement>('pitch').value = String(view.pitch)
  history.replaceState(null, '', `#yaw=${view.yaw}&pitch=${view.pitch}`)
}
const set = (yaw: number, pitch: number) => { view = { yaw: Math.max(-90, Math.min(90, Math.round(yaw))), pitch: Math.max(-45, Math.min(45, Math.round(pitch))) }; if (!pending) { pending = true; requestAnimationFrame(render) } }
$<HTMLInputElement>('yaw').oninput = e => set(+(e.target as HTMLInputElement).value, view.pitch)
$<HTMLInputElement>('pitch').oninput = e => set(view.yaw, +(e.target as HTMLInputElement).value)
for (const id of ['mix', 'raw', 'outer', 'ghost', 'bones', 'anchors']) $(id).onchange = () => { set(view.yaw, view.pitch); drawGrid() }
let drag: { x: number; y: number; v: View } | undefined
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, v: view }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; const k = 180 / cv.clientWidth; set(drag.v.yaw + (e.clientX - drag.x) * k, drag.v.pitch - (e.clientY - drag.y) * k) }
cv.onpointerup = cv.onpointercancel = () => { drag = undefined; cv.style.cursor = 'grab' }

// ---- the 25-cell grid (master geometry: cells 320 × 300, ball centre (160, 148), R 78) ---------------------------------
const gv = $<HTMLCanvasElement>('g'), gg = gv.getContext('2d')!
const COLS = [0, 30, 45, 60, 90], ROWS = [-45, -30, 0, 30, 45]
function drawGrid() {
  gg.clearRect(0, 0, gv.width, gv.height)
  const o = { ...read(), w: 0.7 }
  ROWS.forEach((pitch, r) => COLS.forEach((yaw, c) => {
    gg.strokeStyle = '#ddd'; gg.lineWidth = 1; gg.setLineDash([]); gg.strokeRect(c * 320 + 4, r * 300 + 4, 312, 292)
    gg.fillStyle = '#333'; gg.font = '14px "PingFang SC", sans-serif'; gg.fillText(`yaw ${yaw}° · ${pitchName(pitch)}`, c * 320 + 14, r * 300 + 26)
    gg.strokeStyle = '#cfd8dc'; gg.beginPath(); gg.arc(c * 320 + 160, r * 300 + 148, 78, 0, 7); gg.stroke()
    draw(gg, { yaw, pitch }, c * 320 + 160, r * 300 + 148, 78, o)
  }))
}
gv.onclick = e => { const b = gv.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * 1600, y = ((e.clientY - b.top) / b.height) * 1500; const c = Math.floor(x / 320), r = Math.floor(y / 300); if (COLS[c] !== undefined && ROWS[r] !== undefined) { set(COLS[c]!, ROWS[r]!); window.scrollTo({ top: 0, behavior: 'smooth' }) } }
render()
setTimeout(drawGrid, 30)
