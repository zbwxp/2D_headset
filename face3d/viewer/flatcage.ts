// The flat birdcage beside the VRoid head (face3d/fit/vrm-flat-cage.ts → vrm-flat-cage.json; bowen 1793152656). Drawing only.
import vrmUrl from '../fit/ref/test.vrm?url'
import data from './vrm-flat-cage.json'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'
import { flattenEars } from '../fit/flatten-ears'

type P3 = [number, number, number]
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
const C = data as unknown as { cages: { yaw: number; flat: P3[]; ears: P3[] }[]; pitches: { yaw: number; pitch: number; flat: P3[]; ears: P3[] }[] }
// the cages to pick from (bowen 1793153501 「上面这些笼子都可以任意叠加（你搞个复选机制吧）」): the turn cage, and a tilt cage at each turn
interface Bar { a: number; flat: P3[]; ears: P3[] }
const SETS: { id: string; name: string; col: number[]; bars: Bar[]; on: boolean; range: [number, number]; look: (a: number) => [number, number] }[] = [
  { id: 'yaw', name: '转头笼子（俯仰 0）', col: [0.25, 0.48, 0.8], bars: C.cages.map(c => ({ a: c.yaw, flat: c.flat, ears: c.ears })), on: true, range: [0, 175], look: a => [a, 0] },
  ...[...new Set(C.pitches.map(p => p.yaw))].map((y, i) => ({ id: `p${y}`, name: `俯仰笼子@转${y}°`, col: [[0.92, 0.55, 0.12], [0.2, 0.62, 0.3], [0.6, 0.3, 0.75], [0.85, 0.3, 0.45], [0.4, 0.55, 0.55], [0.6, 0.5, 0.2], [0.3, 0.3, 0.3]][i % 7]!,
    bars: C.pitches.filter(p => p.yaw === y).map(p => ({ a: p.pitch, flat: p.flat, ears: p.ears })), on: y === 0 || y === 15, range: [-90, 90] as [number, number], look: (a: number) => [y, a] as [number, number] }))]
const setsBar = $('sets'), hiSet = $<HTMLSelectElement>('hiSet')
for (const st of SETS) { const l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.checked = st.on; c.onchange = () => { st.on = c.checked; draw() }
  const sw = document.createElement('span'); sw.style.cssText = `display:inline-block;width:14px;height:4px;vertical-align:middle;margin:0 3px;background:rgb(${st.col.map(v => Math.round(v * 255)).join(',')})`
  l.append(c, sw, st.name); setsBar.appendChild(l); const o = document.createElement('option'); o.value = st.id; o.textContent = st.name; hiSet.appendChild(o) }
const curSet = () => SETS.find(st => st.id === hiSet.value)!
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
gl.getExtension('OES_element_index_uint')
let yaw = 30, pitch = 15, zoom = 1
const S0 = 0.34, CY = 0.1
const clip = (p: P3, aspect: number) => { const q = rotate(p, { yaw, pitch }), s = S0 * zoom; return [q[0] * s * aspect, q[1] * s + CY, -q[2] * 0.3] }
function matrix(aspect: number): Float32Array {
  const ex = rotate([1, 0, 0], { yaw, pitch }), ey = rotate([0, 1, 0], { yaw, pitch }), ez = rotate([0, 0, 1], { yaw, pitch }), s = S0 * zoom
  return new Float32Array([ex[0] * s * aspect, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s * aspect, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s * aspect, ez[1] * s, -ez[2] * 0.3, 0, 0, CY, 0, 1])
}
function program(vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!); gl.attachShader(p, s) }
  gl.linkProgram(p); return p
}
const meshProg = program(`attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ gl_Position = m * vec4(p, 1.0); vn = (m * vec4(n, 0.0)).xyz; }`,
  `precision mediump float; varying vec3 vn; void main(){ vec3 N = normalize(vec3(vn.xy, -vn.z)); float l = 0.45 + 0.55 * max(0.0, dot(N, normalize(vec3(-0.35, 0.55, 0.76)))); gl_FragColor = vec4(vec3(0.88, 0.87, 0.85) * l, 1.0); }`)
const stripProg = program(`attribute vec3 p; attribute vec4 c; varying vec4 vc; void main(){ gl_Position = vec4(p, 1.0); vc = c; }`, `precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }`)
const buf = (arr: Float32Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
const pb = gl.createBuffer()!, cb = gl.createBuffer()!
let meshes: { pos: WebGLBuffer; nor: WebGLBuffer }[] = [], idxB: WebGLBuffer | undefined, nIdx = 0
function band(pts: P3[], px: number, rgba: number[], aspect: number, half: number, H: number, P: number[], Cc: number[]) {
  const cs = pts.map(p => clip(p, aspect)), wx = (px / half) * devicePixelRatio, wy = (px / H) * devicePixelRatio
  for (let i = 0; i + 1 < cs.length; i++) { const a = cs[i]!, b = cs[i + 1]!, dx = (b[0]! - a[0]!) / wx, dy = (b[1]! - a[1]!) / wy, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * wx, ny = (dx / l) * wy
    const q = [[a[0]! + nx, a[1]! + ny, a[2]! - 0.004], [a[0]! - nx, a[1]! - ny, a[2]! - 0.004], [b[0]! + nx, b[1]! + ny, b[2]! - 0.004], [b[0]! - nx, b[1]! - ny, b[2]! - 0.004]]
    for (const k of [0, 1, 2, 1, 3, 2]) { P.push(...q[k]!); Cc.push(...rgba) } }
}
function drawTris(P: number[], Cc: number[]) { if (!P.length) return; gl.useProgram(stripProg); const ap = gl.getAttribLocation(stripProg, 'p'), ac = gl.getAttribLocation(stripProg, 'c')
  gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Cc), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, P.length / 3) }
function draw() {
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect(), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr)
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
  const step = +$<HTMLSelectElement>('step').value, hi = +$<HTMLInputElement>('hi').value
  $('view').textContent = `看：转 ${Math.round(yaw)}° · 俯仰 ${Math.round(pitch)}°`; $('hiv').textContent = curSet().id === 'yaw' ? `转 ${hi}°` : `俯仰 ${hi > 0 ? '仰' : hi < 0 ? '俯' : ''}${Math.abs(hi)}°`
  gl.clearColor(1, 1, 1, 1); gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST)
  const half = Math.floor(W / 2), aspect = H / half, key = on('ears') ? 'ears' : 'flat'
  const hs = curSet(), bars = SETS.filter(st => st.on || st === hs).flatMap(st => st.bars.filter(b => (st.on && ((b.a % step) + step) % step === 0) || (st === hs && b.a === hi)).map(b => ({ ...b, st })))
  for (let side = 0; side < 2; side++) { gl.viewport(side * half, 0, half, H); gl.clear(gl.DEPTH_BUFFER_BIT)
    if (side === 0 && idxB && meshes.length) { const m = meshes[on('ears') ? 1 : 0]!; gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, matrix(aspect))
      const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB); gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0); gl.disableVertexAttribArray(an) }
    if (side === 0 && !on('onHead')) continue
    const P: number[] = [], Cc: number[] = []
    for (const b of bars) { const isHi = b.st === hs && b.a === hi; band(b[key], isHi ? 3 : 1.4, isHi ? [0.85, 0.15, 0.12, 1] : [...b.st.col, 0.85], aspect, half, H, P, Cc) }
    drawTris(P, Cc) }
}
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw() }
cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab' }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
$('look').onclick = () => { [yaw, pitch] = curSet().look(+$<HTMLInputElement>('hi').value); draw() }
hiSet.onchange = () => { const h = $<HTMLInputElement>('hi'), st = curSet(); h.min = String(st.range[0]); h.max = String(st.range[1]); h.value = st.id === 'yaw' ? '15' : '-30'; draw() }
document.body.addEventListener('input', draw); document.body.addEventListener('change', draw); window.addEventListener('resize', draw)
;(window as unknown as { __view: (y: number, p: number, z?: number) => void }).__view = (y, p, z) => { yaw = y; pitch = p; if (z) zoom = z; draw() }
// the head with its neck in the usual head space (as vrm-flat-cage.ts), ears pressed flat or kept
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d0 = loadVrmHead(b.slice(0)), d = loadVrmHead(b.slice(0), 1.3)
  const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
  const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(d.P, 1), b1 = ext(d.P, 2), sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
  const P = d.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as P3), N = d.N.map(n => [...n])
  const tris = d.parts.flatMap(p => { const t: number[] = []; for (let i = 0; i < p.tris.length; i += 3) { const v = [p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!]; if (v.every(k => P[k]![1] > -1.2 || Math.abs(P[k]![0]) < 1.0)) t.push(...v) } return t })
  const PF = P.map(p => [...p] as P3), NF = N.map(n => [...n]); flattenEars(PF, NF, d.skinTris)
  idxB = buf(new Uint32Array(tris), gl.ELEMENT_ARRAY_BUFFER); nIdx = tris.length
  meshes = [{ pos: buf(new Float32Array(PF.flat())), nor: buf(new Float32Array(NF.flat())) }, { pos: buf(new Float32Array(P.flat())), nor: buf(new Float32Array(N.flat())) }]
  draw()
})
draw()
