// VRoid's outline at each turn as simple Béziers on the model (face3d/fit/vrm-yaw-outline.ts → vrm-yaw-outline.json; bowen
// 1793120445): pick the turn; see it from any angle, or from that turn itself. Drawing only.
import vrmUrl from '../fit/ref/test.vrm?url'
import data from './vrm-yaw-outline.json'
import shell from './ref-shell/bowen-1793118841-sym.json'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'

type P3 = [number, number, number]
const D = data as unknown as { views: { yaw: number; raw: P3[]; curves: { c: P3[] }[]; points: { name: string; p: P3 }[] }[] }
const W = shell as unknown as { lines: { c: P3[] }[] }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
gl.getExtension('OES_element_index_uint')
let yaw = 35, pitch = 10, zoom = 1
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }
const sample = (c: P3[], n = 40) => Array.from({ length: n + 1 }, (_, i) => cubic(c, i / n))
const S0 = 0.36, CY = 0.12, aspect = () => cv.height / cv.width
const clip = (p: P3) => { const q = rotate(p, { yaw, pitch }), s = S0 * zoom; return [q[0] * s * aspect(), q[1] * s + CY, -q[2] * 0.3] }
function matrix(): Float32Array {
  const ex = rotate([1, 0, 0], { yaw, pitch }), ey = rotate([0, 1, 0], { yaw, pitch }), ez = rotate([0, 0, 1], { yaw, pitch }), s = S0 * zoom, a = aspect()
  return new Float32Array([ex[0] * s * a, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s * a, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s * a, ez[1] * s, -ez[2] * 0.3, 0, 0, CY, 0, 1])
}
function program(vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!); gl.attachShader(p, s) }
  gl.linkProgram(p); return p
}
const meshProg = program(`attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ gl_Position = m * vec4(p, 1.0); vn = (m * vec4(n, 0.0)).xyz; }`,
  `precision mediump float; varying vec3 vn; void main(){ vec3 N = normalize(vec3(vn.xy, -vn.z)); float l = 0.45 + 0.55 * max(0.0, dot(N, normalize(vec3(-0.35, 0.55, 0.76)))); gl_FragColor = vec4(vec3(0.88, 0.87, 0.85) * l, 1.0); }`)
const stripProg = program(`attribute vec3 p; attribute vec4 c; varying vec4 vc; void main(){ gl_Position = vec4(p.xy, p.z - 0.006, 1.0); gl_PointSize = 8.0; vc = c; }`,
  `precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }`)
const buf = (arr: Float32Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
let mesh: { pos: WebGLBuffer; nor: WebGLBuffer; idx: WebGLBuffer; n: number } | undefined
const pb = gl.createBuffer()!, cb = gl.createBuffer()!
function band(pts: P3[], px: number, rgba: number[], P: number[], C: number[]) {
  const cs = pts.map(clip), wx = (px / cv.width) * devicePixelRatio, wy = (px / cv.height) * devicePixelRatio
  for (let i = 0; i + 1 < cs.length; i++) { const a = cs[i]!, b = cs[i + 1]!, dx = (b[0]! - a[0]!) / wx, dy = (b[1]! - a[1]!) / wy, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * wx, ny = (dx / l) * wy
    const q = [[a[0]! + nx, a[1]! + ny, a[2]!], [a[0]! - nx, a[1]! - ny, a[2]!], [b[0]! + nx, b[1]! + ny, b[2]!], [b[0]! - nx, b[1]! - ny, b[2]!]]
    for (const k of [0, 1, 2, 1, 3, 2]) { P.push(...q[k]!); C.push(...rgba) } }
}
function drawTris(P: number[], C: number[], mode: number = gl.TRIANGLES) {
  if (!P.length) return; gl.useProgram(stripProg); const ap = gl.getAttribLocation(stripProg, 'p'), ac = gl.getAttribLocation(stripProg, 'c')
  gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(C), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 0, 0); gl.drawArrays(mode, 0, P.length / 3)
}
const WIRE = W.lines.map(l => sample(l.c, 32))
const hue = (t: number) => [0.9 - 0.8 * t, 0.35 + 0.3 * t, 0.2 + 0.7 * t]
function draw() {
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect(), Wd = Math.round(r.width * dpr), Hd = Math.round(r.height * dpr)
  if (cv.width !== Wd || cv.height !== Hd) { cv.width = Wd; cv.height = Hd }
  const oy = +$<HTMLInputElement>('yaw').value; $('yawv').textContent = `${oy}°`
  $('view').textContent = `看：转 ${Math.round(yaw)}° · 俯仰 ${Math.round(pitch)}°`
  gl.viewport(0, 0, Wd, Hd); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  if (mesh && on('head')) { gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, matrix())
    const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx); gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_INT, 0); gl.disableVertexAttribArray(an) }
  const P: number[] = [], C: number[] = [], T: number[] = [], TC: number[] = []
  if (on('lines')) for (const w of WIRE) band(w, 0.8, [0.85, 0.55, 0.55, 0.7], P, C)
  const views = on('all') ? D.views.filter(v => v.yaw % 15 === 0) : D.views.filter(v => v.yaw === oy)
  for (const v of views) { const k = on('all') && v.yaw !== oy ? [...hue(v.yaw / 90), 0.9] : [0.075, 0.63, 0.35, 1], wpx = v.yaw === oy ? 3 : 1.8
    if (on('raw') && v.yaw === oy) band(v.raw, 2.5, [0.2, 0.2, 0.2, 0.35], P, C)
    for (const c of v.curves) band(sample(c.c), wpx, k, P, C)
    if (v.yaw === oy) for (const p of v.points) { T.push(...clip(p.p)); TC.push(0.88, 0.54, 0.17, 1) } }
  drawTris(P, C); gl.disable(gl.DEPTH_TEST); drawTris(T, TC, gl.POINTS)
  const L = $('labels'); L.innerHTML = ''
  if (on('names')) { const cur = D.views.find(v => v.yaw === oy); for (const p of cur?.points ?? []) { const c = clip(p.p), x = (c[0]! / 2 + 0.5) * r.width, y = (0.5 - c[1]! / 2) * r.height, d = document.createElement('div'); d.textContent = p.name; d.style.left = `${x + 6}px`; d.style.top = `${y - 8}px`; L.appendChild(d) } }
}
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw() }
cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab' }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
$('follow').onclick = () => { yaw = +$<HTMLInputElement>('yaw').value; pitch = 0; draw() }
document.body.addEventListener('input', draw); document.body.addEventListener('change', draw); window.addEventListener('resize', draw)
;(window as unknown as { __view: (y: number, p: number, z?: number) => void }).__view = (y, p, z) => { yaw = y; pitch = p; if (z) zoom = z; draw() }
// the head with its neck in the usual head space (as face3d/fit/vrm-yaw-outline.ts)
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d0 = loadVrmHead(b.slice(0)), d = loadVrmHead(b.slice(0), 1.3)
  const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
  const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(d.P, 1), b1 = ext(d.P, 2), sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
  const Pp = d.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)))
  const idx = new Uint32Array(d.parts.flatMap(p => { const t: number[] = []; for (let i = 0; i < p.tris.length; i += 3) { const v = [p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!]; if (v.every(k => Pp[k]![1]! > -1.2 || Math.abs(Pp[k]![0]!) < 1.0)) t.push(...v) } return t }))
  mesh = { pos: buf(new Float32Array(Pp.flat())), nor: buf(new Float32Array(d.N.flat())), idx: buf(idx, gl.ELEMENT_ARRAY_BUFFER), n: idx.length }; draw()
})
draw()
