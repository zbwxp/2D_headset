// Viewing the face outline the VTuber / Live2D way (bowen 1792514171: "检视的时候一般是按照Vtuber live2d的方案"; modelling
// stays in B, 1792514145 / 1792514214): the camera never moves; the head turns (AngleX), then nods about its own
// ear-to-ear axis (AngleY, + = looking up), then tilts (AngleZ), pivoting at the neck (VRoid test.vrm's neck joint,
// (0, −2.079, 0.324) head-ball radii from the ball centre; fit/pose.ts). Internally the head's rotation M_A = Ry(X)·Rx(Y)·Rz(Z) is
// split into the modelling view B (yaw′, pitch′ — face3d's camera: yaw, then tilt about the screen's horizontal) and an
// in-picture roll r: M_A = Rz(r)·M_B(yaw′, pitch′) — the depth row of M_A gives yaw′ and pitch′, its first two rows the
// roll. The outline is taken at (yaw′, pitch′) from the modelling keyframes (for now bowen's bench outline made
// symmetric, fit/outline-sym.ts), rolled by r and moved by the pivot's shift.
import { type Controls, cubicsOf, sample, symmetricAt } from '../fit/outline-sym'
import { split } from '../fit/pose'

const D = Math.PI / 180, PX = 82 // bench canvas px per head-ball radius (front outline: crown ≈ 82 px above the centre)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!
let X = 30, Y = 0, Z = 0, pending = false
function render() {
  pending = false
  const W = cv.width, H = cv.height, S = 2.6, cx = W / 2, cy = H * 0.42
  g.fillStyle = '#fafaf8'; g.fillRect(0, 0, W, H)
  const sp = split(X, Y, Z), clampedYaw = Math.max(-90, Math.min(90, sp.yaw)), clampedPitch = Math.max(-45, Math.min(45, sp.pitch))
  const outside = clampedYaw !== sp.yaw || clampedPitch !== sp.pitch
  const ctl: Controls = symmetricAt({ yaw: clampedYaw, pitch: clampedPitch })
  // bench px (y down) → screen: roll about the ball centre (y up maths), then the pivot's shift
  const cr = Math.cos(sp.roll * D), sr = Math.sin(sp.roll * D)
  const to = (p: { x: number; y: number }) => { const x = p.x, y = -p.y, rx = x * cr - y * sr, ry = x * sr + y * cr; return [cx + (rx + sp.shift[0]! * PX) * S, cy - (ry + sp.shift[1]! * PX) * S] as const }
  // the head ball (moves with the pivot) and the fixed camera's frame centre
  g.strokeStyle = '#e8e8e8'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, 30); g.lineTo(cx, H - 30); g.moveTo(30, cy); g.lineTo(W - 30, cy); g.stroke()
  const [bx, by] = to({ x: 0, y: 0 }); g.strokeStyle = 'rgba(230,60,160,0.45)'; g.beginPath(); g.arc(bx, by, PX * S, 0, 7); g.stroke()
  g.strokeStyle = outside ? '#b26a00' : '#111'; g.lineWidth = 3.2; g.lineCap = 'round'; g.beginPath()
  for (const q of cubicsOf(ctl)) sample(q).forEach((p, i) => { const [x, y] = to(p); i ? g.lineTo(x, y) : g.moveTo(x, y) })
  g.stroke()
  g.fillStyle = '#333'; g.font = '24px sans-serif'; g.fillText(`转头 ${X}° · 点头 ${Y}° · 歪头 ${Z}°`, 18, 34)
  g.font = '17px sans-serif'; g.fillStyle = '#666'; g.fillText(`= 建模视角 B：yaw ${sp.yaw.toFixed(1)}°，pitch ${sp.pitch.toFixed(1)}°；画面内旋转 ${sp.roll.toFixed(1)}°；支点带来的平移 (${(sp.shift[0]! * PX).toFixed(0)}, ${(sp.shift[1]! * PX).toFixed(0)}) px`, 18, 62)
  if (outside) { g.fillStyle = '#b26a00'; g.fillText('超出关键帧范围（yaw ±90 / pitch ±45），按边界取轮廓', 18, 88) }
  for (const [id, v] of [['xv', X], ['yv', Y], ['zv', Z]] as const) $(id).textContent = `${v}°`
  history.replaceState(null, '', `#x=${X}&y=${Y}&z=${Z}`)
}
const set = () => { if (!pending) { pending = true; requestAnimationFrame(render) } }
const m = /x=(-?\d+).*y=(-?\d+).*z=(-?\d+)/.exec(location.hash); if (m) { X = +m[1]!; Y = +m[2]!; Z = +m[3]! }
for (const [id, f] of [['x', (v: number) => { X = v }], ['y', (v: number) => { Y = v }], ['z', (v: number) => { Z = v }]] as const) { const el = $<HTMLInputElement>(id); el.value = String(id === 'x' ? X : id === 'y' ? Y : Z); el.oninput = () => { f(+el.value); set() } }
let drag: { x: number; y: number; X: number; Y: number } | undefined
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, X, Y }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (drag) { const k = 180 / cv.clientWidth; X = Math.max(-90, Math.min(90, Math.round(drag.X + (e.clientX - drag.x) * k))); Y = Math.max(-60, Math.min(60, Math.round(drag.Y - (e.clientY - drag.y) * k))); ($<HTMLInputElement>('x')).value = String(X); ($<HTMLInputElement>('y')).value = String(Y); set() } }
cv.onpointerup = () => { drag = undefined }
render()
