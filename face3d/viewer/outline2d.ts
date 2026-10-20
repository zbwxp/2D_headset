// bowen's face outline from the bench, made symmetric in 2D only (bowen 1792511024: "把多个视角的手调先给提取出来，
// 然后求平均，给出一个对称的脸轮廓，能够yaw pitch检视的…这次只平面"). No 3D: at any pose the outline O(yaw, pitch) is
// evaluated by headset-core's own `evaluate` (nine views + bowen's playback corrections, fit/ref/outline-123.json);
// its mirror is O(−yaw, pitch) flipped about x = 0 with left and right exchanged (左颅 ↔ 右颅, 左下颌 ↔ 右下颌; chin and
// crown map to themselves); the symmetric outline averages the two, control point by control point (a cubic's average
// is the average of its controls). Drawn: the symmetric outline thick, the original and the mirrored one thin.
import data from '../fit/ref/outline-123.json'
import { type Model, type Pose, evaluate } from '../../../headset-core/src/evaluate/index'

type V = { x: number; y: number }
type Cubic = [V, V, V, V]
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replaceAll('view:', ''), v]))
const model = {
  views: data.views.map(v => { const [yaw, pitch] = v.key.slice('view:'.length).split(',').map(Number); return { yaw: yaw!, pitch: pitch!, points: v.points, lines: v.lines } }),
  responses: { points: Object.fromEntries(Object.entries(data.responses.points).map(([k, v]) => [k, strip(v as Record<string, unknown>)])), handles: Object.fromEntries(Object.entries(data.responses.handles).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as Record<string, Record<string, unknown>>).map(([e, r]) => [e, strip(r)]))])) },
} as unknown as Model
const LINES = data.lines
// left ↔ right: lines by name (左X ↔ 右X), their endpoints a ↔ a, b ↔ b
const partner: Record<string, string> = {}
for (const l of LINES) { const m = /^([左右])(.*)$/.exec(l.name); if (!m) { partner[l.id] = l.id; continue } const other = LINES.find(o => o.name === (m[1] === '左' ? '右' : '左') + m[2]); partner[l.id] = other ? other.id : l.id }

function cubics(pose: Pose): Record<string, Cubic> {
  const g = evaluate(model, pose), out: Record<string, Cubic> = {}
  for (const l of LINES) { const A = g.points[l.a]!, B = g.points[l.b]!, h = g.lines[l.id] ?? { ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } }; out[l.id] = [A, { x: A.x + h.ha.x, y: A.y + h.ha.y }, { x: B.x + h.hb.x, y: B.y + h.hb.y }, B] }
  return out
}
const flip = (c: Cubic): Cubic => c.map(p => ({ x: -p.x, y: p.y })) as Cubic
function outlines(pose: Pose) {
  const o = cubics(pose), other = cubics({ yaw: -pose.yaw, pitch: pose.pitch }), mirrored: Record<string, Cubic> = {}, sym: Record<string, Cubic> = {}
  for (const l of LINES) { mirrored[l.id] = flip(other[partner[l.id]!]!); sym[l.id] = o[l.id]!.map((p, k) => ({ x: (p.x + mirrored[l.id]![k]!.x) / 2, y: (p.y + mirrored[l.id]![k]!.y) / 2 })) as Cubic }
  return { o, mirrored, sym }
}
const sample = (c: Cubic, n = 48) => Array.from({ length: n + 1 }, (_, k) => { const t = k / n, u = 1 - t; return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y } })
/** largest distance between the original and the mirrored outline, sampled (canvas px) — how much averaging moved */
const gap = (a: Record<string, Cubic>, b: Record<string, Cubic>) => Math.max(...LINES.flatMap(l => { const p = sample(a[l.id]!), q = sample(b[l.id]!); return p.map((s, i) => Math.hypot(s.x - q[i]!.x, s.y - q[i]!.y)) }))

const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!
let pose: Pose = { yaw: 30, pitch: 0 }, pending = false
function drawSet(ctx: CanvasRenderingContext2D, set: Record<string, Cubic>, cx: number, cy: number, S: number, style: string, w: number, dash: number[] = []) {
  ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath()
  for (const l of LINES) sample(set[l.id]!).forEach((p, i) => (i ? ctx.lineTo(cx + p.x * S, cy + p.y * S) : ctx.moveTo(cx + p.x * S, cy + p.y * S)))
  ctx.stroke(); ctx.setLineDash([])
}
function render() {
  pending = false
  const W = cv.width, H = cv.height
  g.fillStyle = '#fafaf8'; g.fillRect(0, 0, W, H)
  // the main pose, large
  const S = 2.6, cx = W / 2, cy = H * 0.36, sets = outlines(pose)
  g.strokeStyle = '#e4e4e4'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, 20); g.lineTo(cx, H * 0.72); g.stroke()
  if ($<HTMLInputElement>('orig').checked) { drawSet(g, sets.o, cx, cy, S, '#d32f2f', 1.6); drawSet(g, sets.mirrored, cx, cy, S, '#1976d2', 1.6, [6, 4]) }
  drawSet(g, sets.sym, cx, cy, S, '#111', 3.2)
  g.fillStyle = '#333'; g.font = '26px sans-serif'; g.fillText(`yaw ${pose.yaw}° · pitch ${pose.pitch}°`, 18, 36)
  g.font = '18px sans-serif'; g.fillStyle = '#666'; g.fillText(`原轮廓与镜像那侧最大相差 ${gap(sets.o, sets.mirrored).toFixed(1)} px（平均后各移一半）`, 18, 64)
  // the strip: yaw −90 … 90 every 30 at this pitch, symmetric outline only
  const yaws = [-90, -60, -30, 0, 30, 60, 90], sw = W / yaws.length, s2 = 0.95
  yaws.forEach((y, i) => { const x0 = sw * i + sw / 2, y0 = H * 0.86; drawSet(g, outlines({ yaw: y, pitch: pose.pitch }).sym, x0, y0, s2, y === pose.yaw ? '#111' : '#777', y === pose.yaw ? 2 : 1.2); g.fillStyle = '#555'; g.font = '15px sans-serif'; g.fillText(`${y}°`, x0 - 12, H - 10) })
  $('yv').textContent = `${pose.yaw}°`; $('pv').textContent = `${pose.pitch}°`
  $<HTMLInputElement>('yaw').value = String(pose.yaw); $<HTMLInputElement>('pitch').value = String(pose.pitch)
  history.replaceState(null, '', `#yaw=${pose.yaw}&pitch=${pose.pitch}`)
}
const set = (yaw: number, pitch: number) => { pose = { yaw: Math.max(-90, Math.min(90, Math.round(yaw))), pitch: Math.max(-45, Math.min(45, Math.round(pitch))) }; if (!pending) { pending = true; requestAnimationFrame(render) } }
const m = /yaw=(-?\d+).*pitch=(-?\d+)/.exec(location.hash); if (m) pose = { yaw: +m[1]!, pitch: +m[2]! }
$<HTMLInputElement>('yaw').oninput = e => set(+(e.target as HTMLInputElement).value, pose.pitch)
$<HTMLInputElement>('pitch').oninput = e => set(pose.yaw, +(e.target as HTMLInputElement).value)
$('orig').onchange = () => set(pose.yaw, pose.pitch)
let drag: { x: number; y: number; p: Pose } | undefined
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, p: pose }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (drag) { const k = 180 / cv.clientWidth; set(drag.p.yaw + (e.clientX - drag.x) * k, drag.p.pitch - (e.clientY - drag.y) * k) } }
cv.onpointerup = () => { drag = undefined }
render()
