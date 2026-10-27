// The VRoid head and its copy sculpted to the old turn model's face outline (face3d/fit/sculpt-to-model.ts →
// sculpt-to-model.json; bowen 1793122560), side by side, turned together. Drawing only.
import vrmUrl from '../fit/ref/test.vrm?url'
import data from './sculpt-to-model.json'
import modelJson from '../../bench-tasks/转头模型/model.json'
import { cutNeck, loadVrmHead } from '../mesh/vrmhead'
import { evaluate } from '../turnmodel'
import { rotate } from '../src/view'
import { flattenEars } from '../fit/flatten-ears'

type P3 = [number, number, number]
const S = data as unknown as { align: { scale: number; heightShift: number; axisShift: number }; P: P3[] }
const M = modelJson as unknown as Parameters<typeof evaluate>[0]
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T, on = (id: string) => $<HTMLInputElement>(id).checked
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
gl.getExtension('OES_element_index_uint')
let yaw = 30, pitch = 0, zoom = 1
const S0 = 0.36, CY = 0.12
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
const lineProg = program(`attribute vec2 p; void main(){ gl_Position = vec4(p, -0.99, 1.0); }`, `precision mediump float; uniform vec4 col; void main(){ gl_FragColor = col; }`)
const buf = (arr: Float32Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
let heads: { pos: WebGLBuffer; nor: WebGLBuffer; P: P3[] }[] = [], idxB: WebGLBuffer | undefined, nIdx = 0
const lb = gl.createBuffer()!
/** the model's outline at this turn (only 0–90°, no pitch), on the screen */
function target(): number[][][] {
  if (pitch !== 0 || yaw < 0 || yaw > 90) return []
  const f = evaluate(M, yaw), { scale: s, heightShift: ty, axisShift: ax } = S.align
  const cub = (c: number[][], t: number) => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1].map(k => w.reduce((a, wi, j) => a + wi * c[j]![k]!, 0)) }
  return f.outline.map(l => Array.from({ length: 41 }, (_, i) => { const q = cub(l.c as unknown as number[][], i / 40); return [q[0]! * s - ax * Math.sin((yaw * Math.PI) / 180), -q[1]! * s + ty] }))
}
function drawLines(L: number[][][], aspect: number, col: number[]) {
  gl.useProgram(lineProg); gl.uniform4fv(gl.getUniformLocation(lineProg, 'col'), col); const ap = gl.getAttribLocation(lineProg, 'p'), s = S0 * zoom
  for (const l of L) { const P: number[] = []; for (const q of l) P.push(q[0]! * s * aspect, q[1]! * s + CY)
    gl.bindBuffer(gl.ARRAY_BUFFER, lb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.LINE_STRIP, 0, l.length) }
}
/** a head's outline on the screen as seen now: its silhouette edges (triangle pairs facing apart) */
function silhouette(P: P3[], T: number[]): number[][][] {
  const v = { yaw, pitch }, R = P.map(p => rotate(p, v)), face = (t: number) => { const a = R[T[t]!]!, b = R[T[t + 1]!]!, c = R[T[t + 2]!]!; return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0 }
  const edges = new Map<string, boolean[]>(); for (let t = 0; t < T.length; t += 3) { const f = face(t); for (let e = 0; e < 3; e++) { const i = T[t + e]!, j = T[t + ((e + 1) % 3)]!, k = i < j ? `${i},${j}` : `${j},${i}`; (edges.get(k) ?? edges.set(k, []).get(k)!).push(f) } }
  const out: number[][][] = []; for (const [k, fs] of edges) if (fs.length === 2 && fs[0] !== fs[1]) { const [i, j] = k.split(',').map(Number) as [number, number]; out.push([[R[i]![0], R[i]![1]], [R[j]![0], R[j]![1]]]) }
  return out
}
let skinT: number[] = []
function draw() {
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect(), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr)
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
  $('view').textContent = `转 ${Math.round(yaw)}° · 俯仰 ${Math.round(pitch)}°`
  gl.clearColor(1, 1, 1, 1); gl.viewport(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST)
  const half = Math.floor(W / 2), aspect = H / half, T = target()
  heads.forEach((h, k) => { gl.viewport(k * half, 0, half, H); gl.clear(gl.DEPTH_BUFFER_BIT); if (!idxB) return
    gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, matrix(aspect))
    const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
    gl.bindBuffer(gl.ARRAY_BUFFER, h.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, h.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxB); gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0); gl.disableVertexAttribArray(an)
    if (k === 1 && on('ghost')) drawLines(silhouette(heads[0]!.P, skinT), aspect, [0.4, 0.4, 0.4, 1])
    if (on('target')) drawLines(T, aspect, [0.82, 0.2, 0.17, 1]) })
}
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; yaw = Math.round(drag.yaw + (e.clientX - drag.x) * 0.5); pitch = Math.round(Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5))); draw() }
cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab' }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
document.body.addEventListener('change', draw); window.addEventListener('resize', draw)
;(window as unknown as { __view: (y: number, p: number, z?: number) => void }).__view = (y, p, z) => { yaw = y; pitch = p; if (z) zoom = z; draw() }
/** vertex normals from the triangles (the sculpted copy has no file normals) */
function normals(P: P3[], tris: number[]) { const N = P.map(() => [0, 0, 0])
  for (let t = 0; t < tris.length; t += 3) { const [i, j, k] = [tris[t]!, tris[t + 1]!, tris[t + 2]!], a = P[i]!, b = P[j]!, c = P[k]!, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]; for (const q of [i, j, k]) for (let d = 0; d < 3; d++) N[q]![d]! += n[d]! }
  return N.map(n => { const m = Math.hypot(n[0]!, n[1]!, n[2]!) || 1; return [n[0]! / m, n[1]! / m, n[2]! / m] }) }
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d = cutNeck(loadVrmHead(b)), P = d.P.map(p => [...p] as P3), N = d.N.map(n => [...n]); flattenEars(P, N, d.skinTris)
  const tris = d.parts.flatMap(p => p.tris); skinT = d.skinTris; idxB = buf(new Uint32Array(tris), gl.ELEMENT_ARRAY_BUFFER); nIdx = tris.length
  heads = [{ P, pos: buf(new Float32Array(P.flat())), nor: buf(new Float32Array(normals(P, tris).flat())) }, { P: S.P, pos: buf(new Float32Array(S.P.flat())), nor: buf(new Float32Array(normals(S.P, tris).flat())) }]
  draw()
})
draw()
