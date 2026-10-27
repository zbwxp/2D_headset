// The simplest head wireframe beside the VRoid head (bowen 1793100382): one meridian (the plane of symmetry, 9 cubics) and one
// latitude (the forehead ring, 2 cubics), from face3d/fit/vrm-wire.ts → vrm-wire.json; drag to turn both together. Drawing only.
import vrmUrl from '../fit/ref/test.vrm?url'
import wire from './vrm-wire.json'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
type P3 = number[]
const Wd = wire as unknown as { ear: { names: string[]; joints: P3[]; curves: P3[][]; rms: number; raw: P3[]; clusterDistance: { median: number } }; meridian: { names: string[]; joints: P3[]; curves: P3[][]; rms: number; raw: P3[] }; latitude: { joints: P3[]; curves: P3[][]; rms: number; raw: P3[]; orangeDistance: { median: number } } }
let yaw = 35, pitch = 15, zoom = 1
function matrix(): Float32Array {
  const ex = rotate([1, 0, 0], { yaw, pitch }), ey = rotate([0, 1, 0], { yaw, pitch }), ez = rotate([0, 0, 1], { yaw, pitch }), s = 0.4 * zoom, cy = 0.22
  return new Float32Array([ex[0] * s, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s, ez[1] * s, -ez[2] * 0.3, 0, 0, cy, 0, 1])
}
function program(vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!); gl.attachShader(p, s) }
  gl.linkProgram(p); return p
}
const meshProg = program(`attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ gl_Position = m * vec4(p, 1.0); vn = (m * vec4(n, 0.0)).xyz; }`,
  `precision mediump float; varying vec3 vn; void main(){ vec3 N = normalize(vec3(vn.xy, -vn.z)); float l = 0.45 + 0.55 * max(0.0, dot(N, normalize(vec3(-0.35, 0.55, 0.76)))); gl_FragColor = vec4(vec3(0.86, 0.85, 0.83) * l, 1.0); }`)
const lineProg = program(`attribute vec3 p; attribute vec3 c; uniform mat4 m; varying vec3 vc; void main(){ gl_Position = m * vec4(p, 1.0); gl_Position.z -= 0.006; gl_PointSize = 8.0; vc = c; }`,
  `precision mediump float; varying vec3 vc; void main(){ gl_FragColor = vec4(vc, 1.0); }`)
const buf = (arr: Float32Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
gl.getExtension('OES_element_index_uint')
let mesh: { pos: WebGLBuffer; nor: WebGLBuffer; idx: WebGLBuffer; n: number } | undefined

const cubic = (c: P3[], t: number) => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((a, wi, j) => a + wi * c[j]![k]!, 0)) }
/** the wire as line segments: meridian red, latitude orange; each curve's samples */
function wireLines() {
  const pos: number[] = [], col: number[] = []
  for (const [curves, k] of [[Wd.meridian.curves, [0.85, 0.1, 0.2]], [Wd.latitude.curves, [0.95, 0.5, 0.05]], [Wd.ear.curves, [0.1, 0.6, 0.25]]] as const)
    for (const c of curves) for (let i = 0; i < 32; i++) { pos.push(...cubic(c, i / 32), ...cubic(c, (i + 1) / 32)); col.push(...k, ...k) }
  return { pos, col }
}
function rawLines() { const pos: number[] = [], col: number[] = []
  for (const r of [Wd.meridian.raw, Wd.latitude.raw, Wd.ear.raw]) for (let i = 0; i + 1 < r.length; i++) { pos.push(...r[i]!, ...r[i + 1]!); col.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6) }
  return { pos, col } }

function draw() {
  $('view').textContent = `转 ${yaw.toFixed(0)}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch).toFixed(0)}°`
  const H = cv.height, half = cv.width / 2, m = matrix()
  gl.viewport(0, 0, cv.width, H); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST)
  gl.viewport(0, 0, half, H)
  if (mesh) {
    gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, m)
    const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx); gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_INT, 0); gl.disableVertexAttribArray(an)
  }
  gl.useProgram(lineProg); gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'm'), false, m)
  const ap = gl.getAttribLocation(lineProg, 'p'), ac = gl.getAttribLocation(lineProg, 'c')
  const lines = (P: number[], K: number[], mode: number) => { if (!P.length) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf(new Float32Array(P))); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf(new Float32Array(K))); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(mode, 0, P.length / 3) }
  const w = wireLines(), r = rawLines(), J = [...Wd.meridian.joints, ...Wd.latitude.joints, ...Wd.ear.joints, ...Wd.ear.joints.map(p => [-p[0]!, p[1]!, p[2]!])]
  if ($<HTMLInputElement>('onHead').checked) lines(w.pos, w.col, gl.LINES)
  // right: the wire alone (depth-tested against itself only)
  gl.viewport(half, 0, half, H); gl.clear(gl.DEPTH_BUFFER_BIT)
  if ($<HTMLInputElement>('raw').checked) lines(r.pos, r.col, gl.LINES)
  lines(w.pos, w.col, gl.LINES)
  if ($<HTMLInputElement>('joints').checked) lines(J.flat(), J.flatMap(() => [0, 0, 0]), gl.POINTS)
  gl.viewport(0, 0, half, H)
  // joint names on the right panel
  const L = $('labels'); L.innerHTML = ''
  const named: [P3, string][] = [...Wd.meridian.joints.map((p, i) => [p, Wd.meridian.names[i]!] as [P3, string]), ...Wd.ear.joints.map((p, i) => [p, Wd.ear.names[i]!] as [P3, string])]
  if ($<HTMLInputElement>('joints').checked) named.forEach(([p, name]) => { const q = rotate(p as [number, number, number], { yaw, pitch }), x = half + (0.5 + (q[0] * 0.4 * zoom) / 2) * half, y = (0.5 - (q[1] * 0.4 * zoom + 0.22) / 2) * H
    const d = document.createElement('div'); d.textContent = name; d.style.left = `${x + 6}px`; d.style.top = `${y - 8}px`; L.appendChild(d) })
}
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw() }
cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab' }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(4, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
document.body.addEventListener('change', draw)
;(window as unknown as { __view: (y: number, p: number) => void }).__view = (y, p) => { yaw = y; pitch = p; draw() }
$('status').textContent = `经线 9 条，整体误差 ${Wd.meridian.rms}（头球半径 = 1）· 纬线 2 条，误差 ${Wd.latitude.rms}（橘黄交点到它的中位距离 ${Wd.latitude.orangeDistance.median}）· 耳朵每边 3 条，误差 ${Wd.ear.rms}（蓝色交点到耳轮 ${Wd.ear.clusterDistance.median}）`
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d = loadVrmHead(b), idx = new Uint32Array(d.parts.flatMap(p => p.tris))
  mesh = { pos: buf(new Float32Array(d.P.flat())), nor: buf(new Float32Array(d.N.flat())), idx: buf(idx, gl.ELEMENT_ARRAY_BUFFER), n: idx.length }; draw()
})
draw()
