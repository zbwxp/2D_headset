// Minimal showroom for a head shell mesh (bowen 1792509609: "load进一个最小的展示间然后我们看能对它做什么"): bowen's
// VRoid export (fit/ref/test.vrm, a local copy, not committed), the head's skin cut at the neck, put in head space (its
// cranium ball = the unit ball), drawn with a depth buffer and Lambert shading; on it the TRUE contour at this view —
// the skin's edges between a triangle facing the camera and one facing away, kept where the depth buffer shows them —
// and the face parts (eyes, brows, lashes, mouth) as flat colours. Drag to turn (yaw / pitch, same camera as index.html).
import vrmUrl from '../fit/ref/test.vrm?url'
import { type VrmHead, contourSegments, loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { type View } from '../src/view'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = $('status')

const cv = $<HTMLCanvasElement>('c'), g = cv.getContext('2d')!
let zoom = Number(new URLSearchParams(location.search).get('zoom') ?? 1), view: View = { yaw: 30, pitch: 0 }, data: VrmHead | undefined, pending = false
function render() {
  pending = false
  if (!data) return
  const W = cv.width, H = cv.height, S = (W / 3.9) * zoom, cx = W / 2, cy = H * 0.4, img = g.createImageData(W, H), f = { W, H, S, cx, cy }
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 246; img.data[i + 1] = 246; img.data[i + 2] = 244; img.data[i + 3] = 255 }
  const ras = rasterHead(data, view, f, img.data, (new URLSearchParams(location.search).get('normals') ?? 'file') as 'file' | 'computed'), { zb, r, facing } = ras
  g.putImageData(img, 0, 0)
  // the mesh itself (bowen 1792510580): every skin edge of a triangle facing the camera, kept where the depth buffer
  // shows its midpoint
  if ($<HTMLInputElement>('wire').checked) {
    g.strokeStyle = 'rgba(30,60,140,0.55)'; g.lineWidth = 1; g.beginPath()
    for (const e of data.edges) {
      if (!(facing(data.skinTris, e.t[0]) > 0 || facing(data.skinTris, e.t[1]) > 0)) continue
      const a = r[e.a]!, b = r[e.b]!, x = Math.round(cx + ((a[0] + b[0]) / 2) * S), y = Math.round(cy - ((a[1] + b[1]) / 2) * S)
      if (x < 0 || y < 0 || x >= W || y >= H || (a[2] + b[2]) / 2 < zb[y * W + x]! - 0.01) continue
      g.moveTo(cx + a[0] * S, cy - a[1] * S); g.lineTo(cx + b[0] * S, cy - b[1] * S)
    }
    g.stroke()
  }
  // the mesh-contour preview: skin edges between a front- and a back-facing triangle, where the depth buffer shows them
  if ($<HTMLInputElement>('contour').checked) {
    g.strokeStyle = '#111'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath()
    for (const [x0, y0, x1, y1] of contourSegments(data, f, ras)) { g.moveTo(x0, y0); g.lineTo(x1, y1) }
    g.stroke()
  }
  g.fillStyle = '#333'; g.font = '26px sans-serif'; g.fillText(`yaw ${view.yaw}° · pitch ${view.pitch}°`, 16, 34)
  $('yv').textContent = `${view.yaw}°`; $('pv').textContent = `${view.pitch}°`
  $<HTMLInputElement>('yaw').value = String(view.yaw); $<HTMLInputElement>('pitch').value = String(view.pitch)
  history.replaceState(null, '', `${location.search}#yaw=${view.yaw}&pitch=${view.pitch}`)
}
const set = (yaw: number, pitch: number) => { view = { yaw: Math.max(-180, Math.min(180, Math.round(yaw))), pitch: Math.max(-80, Math.min(80, Math.round(pitch))) }; if (!pending) { pending = true; requestAnimationFrame(render) } }
const m = /yaw=(-?\d+).*pitch=(-?\d+)/.exec(location.hash); if (m) view = { yaw: +m[1]!, pitch: +m[2]! }
$<HTMLInputElement>('yaw').oninput = e => set(+(e.target as HTMLInputElement).value, view.pitch)
$<HTMLInputElement>('pitch').oninput = e => set(view.yaw, +(e.target as HTMLInputElement).value)
$('contour').onchange = $('wire').onchange = () => set(view.yaw, view.pitch)
let drag: { x: number; y: number; v: View } | undefined
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, v: view }; cv.setPointerCapture(e.pointerId) }
cv.onpointermove = e => { if (drag) { const k = 180 / cv.clientWidth; set(drag.v.yaw + (e.clientX - drag.x) * k, drag.v.pitch - (e.clientY - drag.y) * k) } }
cv.onpointerup = () => { drag = undefined }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0015))); set(view.yaw, view.pitch) }
status.textContent = '正在读 test.vrm…'
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => loadVrmHead(b, Number(new URLSearchParams(location.search).get('neck') ?? 1.47), (new URLSearchParams(location.search).get('normals') ?? 'file') as 'file' | 'computed')).then(d => { data = d; status.textContent = `test.vrm：${d.P.length} 个顶点，皮肤 ${d.skinTris.length / 3} 个三角面；头球半径 ${d.ball.R.toFixed(3)} m`; render() }).catch(e => { status.textContent = `读取失败：${e}` })
