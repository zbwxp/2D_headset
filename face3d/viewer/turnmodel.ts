// 转头模型 viewer (bowen 1792849247): draws face3d/turnmodel at a yaw — nothing is computed here. Reference pictures
// cross-fade between the neighbouring keyframes (only a comparison); the parameters can be tried in the boxes (not saved).
import { evaluate, params, ModelRefusal, type ModelData, type Frame, type Cubic, type V, type Show, type Params } from '../turnmodel'

// the data and pictures by paths relative to this file (dot 1792856044: no machine path), resolved by the dev server
import model from '../../bench-tasks/转头模型/model.json'
const PICS = import.meta.glob('../../bench-tasks/转头模型/ref-*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const M = model as unknown as ModelData & { refs: { yaw: number; file: string; x: number; y: number; w: number; h: number }[] }
const imgs = await Promise.all(M.refs.map(r => new Promise<HTMLImageElement>(res => { const i = new Image(); i.onload = () => res(i); i.src = PICS['../../bench-tasks/转头模型/' + r.file]! })))
const cv = document.getElementById('c') as HTMLCanvasElement, g = cv.getContext('2d')!
const Z = 3.4, OX = cv.width / 2, OY = cv.height * 0.55, P = (p: V): V => [OX + p[0] * Z, OY + p[1] * Z]
const $ = (id: string) => document.getElementById(id) as HTMLInputElement
const P0 = params(M), LABEL: Record<keyof Params, string> = { eyeAlpha: '眼 0° 转开', eyeRate: '眼 转速', eyeKappa: '近大远小', earFacing0: '耳 0° 转开', earUp: '上耳点高', earLow: '下耳点高', fakePush: '假线耳根外推' }
$('params').innerHTML = (Object.keys(P0) as (keyof Params)[]).map(k => `<label title="${M.params[k].source}">${LABEL[k]} <input id="p-${k}" type="number" step="any" value="${P0[k]}"></label>`).join(' ') + ' <button id="reset">参数复原</button>'

const path = (c: Cubic) => { const p = new Path2D(), q = c.map(P); p.moveTo(...q[0]!); p.bezierCurveTo(...q[1]!, ...q[2]!, ...q[3]!); return p }
/** A closed region from lines that join end to end (the face outline, the side face). */
function region(cs: Cubic[]): Path2D | null {
  const left = [...cs], first = left.shift()!, p = new Path2D(), q0 = first.map(P), close = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5
  p.moveTo(...q0[0]!); p.bezierCurveTo(...q0[1]!, ...q0[2]!, ...q0[3]!)
  let end = first[3]
  while (left.length) { const i = left.findIndex(c => close(c[0], end) || close(c[3], end)); if (i < 0) return null
    const c = left.splice(i, 1)[0]!, d = close(c[0], end) ? c : ([...c].reverse() as Cubic), q = d.map(P); p.bezierCurveTo(...q[1]!, ...q[2]!, ...q[3]!); end = d[3] }
  p.closePath(); return close(end, first[0]) ? p : null
}
/** Stroke `p` where `show` lets it be seen; the rest thin grey (when 被挡部分 is on). */
function stroke(p: Path2D, show: Show, R: Record<string, Path2D | null>, colour: string, width: number) {
  if ($('hidden').checked) { g.strokeStyle = '#c8c8c8'; g.lineWidth = 1; g.stroke(p) }
  const ins = (show.inside ?? []).map(r => R[r]).filter((x): x is Path2D => !!x)
  for (const clipIn of ins.length ? ins : [null]) {
    g.save()
    if (clipIn) g.clip(clipIn)
    for (const r of show.outside ?? []) { const o = R[r]; if (!o) continue; const out = new Path2D(); out.rect(0, 0, cv.width, cv.height); out.addPath(o); g.clip(out, 'evenodd') }
    g.strokeStyle = colour; g.lineWidth = width; g.stroke(p); g.restore()
  }
}

function draw() {
  const yaw = +$('yaw').value, ay = Math.abs(yaw), flip = yaw < 0
  // an empty box is no value (dot 1792856126), not 0: refused like any other value with no answer
  const p = Object.fromEntries((Object.keys(P0) as (keyof Params)[]).map(k => [k, $('p-' + k).value.trim() === '' ? NaN : +$('p-' + k).value])) as unknown as Params
  let f: Frame
  try { f = evaluate(M, yaw, p) } catch (e) {
    // a parameter with no solution is refused (dot 1792855783): the last good view stays, the reason is shown
    if (!(e instanceof ModelRefusal)) throw e
    document.getElementById('info')!.textContent = '✗ 参数无解：' + e.message; document.getElementById('info')!.style.color = '#c00'; return }
  document.getElementById('info')!.style.color = '#555'
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height)
  if ($('ref').checked) {
    const i = Math.max(0, Math.min(M.refs.length - 2, M.refs.findIndex(r => r.yaw >= ay) - 1)), A = M.refs[i]!, B = M.refs[i + 1]!, t = (ay - A.yaw) / (B.yaw - A.yaw)
    for (const [k, a] of [[i, 1 - t], [i + 1, t]] as const) { if (a < 0.02) continue
      const r = M.refs[k]!; g.save(); g.globalAlpha = 0.5 * a; g.translate(OX + (flip ? -r.x : r.x) * Z, OY + r.y * Z); if (flip) g.scale(-1, 1)
      g.drawImage(imgs[k]!, (-r.w / 2) * Z, (-r.h / 2) * Z, r.w * Z, r.h * Z); g.restore() }
  }
  const R = { face: region(f.outline.map(l => l.c)), side: region(f.side.map(l => l.c)) }
  for (const l of f.outline) stroke(path(l.c), l.show, R, '#111', 2.5)
  for (const l of f.side) stroke(path(l.c), l.show, R, '#111', 2.5)
  for (const e of [...f.eyes.near, ...f.eyes.far]) {
    const all = new Path2D(), seen = new Path2D()
    e.pts.forEach((q, i) => { const s = P(q); i ? all.lineTo(...s) : all.moveTo(...s); if (e.seen[i]) (i && e.seen[i - 1] ? seen.lineTo(...s) : seen.moveTo(...s)) })
    if ($('hidden').checked) { g.strokeStyle = '#c8c8c8'; g.lineWidth = 1; g.stroke(all) }
    stroke(seen, e.show, R, '#7a3b00', 1.8)
  }
  for (const l of [...f.ears.near, ...f.ears.far]) stroke(path(l.c), l.show, R, '#c2185b', 2.2)
  if ($('fake').checked) { g.setLineDash([4, 4]); g.strokeStyle = '#999'; g.lineWidth = 1; for (const l of f.ears.fake) g.stroke(path(l.c)); g.setLineDash([]) }
  if ($('marks').checked) {
    const MARK: [string, string, string][] = [['crown', '#7a00ff', '颅顶'], ['chin', '#00a651', '下巴'], ['nearRoot', '#e00078', '耳根'], ['zyg', '#333', '颧骨点'], ['temple', '#3a7bd5', '太阳穴点']]
    for (const [id, c, lab] of MARK) { const q = f.points[id]; if (!q) continue; const [x, y] = P(q); g.fillStyle = c; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); g.font = '12px system-ui'; g.fillText(lab, x + 7, y - 6) }
  }
  $('yv').textContent = `${yaw}°`
  const sheetDeg = ay <= 45 ? (ay * M.sheet.theta45) / 45 : M.sheet.theta45 + ((ay - 45) * (90 - M.sheet.theta45)) / 45
  document.getElementById('info')!.textContent = `侧脸平片 θ ${sheetDeg.toFixed(1)}°${flip ? ' · 镜像' : ''} · 关键帧 0 / 45 / 90°（你画的）`
}
$('yaw').oninput = draw
for (const id of ['ref', 'marks', 'fake', 'hidden']) $(id).onchange = draw
for (const k of Object.keys(P0)) $('p-' + k).oninput = draw
$('reset').onclick = () => { for (const [k, v] of Object.entries(P0)) $('p-' + k).value = String(v); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-k]')) b.onclick = () => { $('yaw').value = b.dataset.k!; draw() }
;(window as unknown as { __frame: () => Frame }).__frame = () => evaluate(M, +$('yaw').value)
draw()
