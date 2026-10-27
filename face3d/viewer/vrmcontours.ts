// VRoid head with its outlines from every 15° (bowen 1793075586): the plain head (no texture), on it the outline curve of each
// view (face3d/fit/vrm-contours.ts → vrm-contours.json), one colour per turn or per pitch, the semantic points at 0,0; drag to
// look from anywhere. WebGL, nothing computed here but the drawing.
import vrmUrl from '../fit/ref/test.vrm?url'
import data from './vrm-contours.json'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true })!
const C = data as unknown as { points: Record<string, [number, number, number] | null>; contours: { yaw: number; pitch: number; seg: number[]; outer: number[] }[] }
const YAWS = [...new Set(C.contours.map(c => c.yaw))], PITCHES = [...new Set(C.contours.map(c => c.pitch))]
let yaw = 30, pitch = 10, zoom = 1

// ---- the camera: face3d's rotate (x right, y up, z toward the viewer), parallel projection ----
/** column-major 4×4 for rotate() then scale into clip space (depth flipped: nearer = smaller) */
function matrix(): Float32Array {
  const ex = rotate([1, 0, 0], { yaw, pitch }), ey = rotate([0, 1, 0], { yaw, pitch }), ez = rotate([0, 0, 1], { yaw, pitch }), s = 0.42 * zoom, cy = 0.25
  return new Float32Array([ex[0] * s, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s, ez[1] * s, -ez[2] * 0.3, 0, 0, cy, 0, 1])
}
function program(vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!); gl.attachShader(p, s) }
  gl.linkProgram(p); return p
}
const meshProg = program(`attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ gl_Position = m * vec4(p, 1.0); vn = (m * vec4(n, 0.0)).xyz; }`,
  `precision mediump float; varying vec3 vn; void main(){ vec3 N = normalize(vec3(vn.xy, -vn.z)); float l = 0.45 + 0.55 * max(0.0, dot(N, normalize(vec3(-0.35, 0.55, 0.76)))); gl_FragColor = vec4(vec3(0.86, 0.85, 0.83) * l, 1.0); }`)
const lineProg = program(`attribute vec3 p; attribute vec3 c; uniform mat4 m; uniform float a; varying vec4 vc; void main(){ gl_Position = m * vec4(p, 1.0); gl_Position.z -= 0.004; gl_PointSize = 9.0; vc = vec4(c, a); }`,
  `precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }`)
const buf = (arr: Float32Array | Uint16Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
gl.getExtension('OES_element_index_uint')

let mesh: { pos: WebGLBuffer; nor: WebGLBuffer; idx: WebGLBuffer; n: number } | undefined
const hsl = (h: number, s: number, l: number): [number, number, number] => { const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) as [number, number, number] }
const colourOf = (c: { yaw: number; pitch: number }) => $<HTMLSelectElement>('by').value === 'yaw' ? hsl(((c.yaw + 90) / 180) * 300, 0.85, 0.45) : hsl(((c.pitch + 45) / 90) * 240, 0.85, 0.45)
const chip = (box: string, vals: number[], name: string) => { $(box).innerHTML += vals.map(v => `<label><input type="checkbox" data-${name}="${v}" checked> ${v}°</label>`).join(' ') + ` <button data-all="${name}">全选</button><button data-none="${name}">全不选</button>` }
chip('yaws', YAWS, 'yaw'); chip('pitches', PITCHES, 'pitch')
const shown = (name: string) => new Set([...document.querySelectorAll<HTMLInputElement>(`input[data-${name}]`)].filter(i => i.checked).map(i => +i.dataset[name]!))

function draw() {
  $('view').textContent = `转 ${yaw.toFixed(0)}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch).toFixed(0)}°`
  gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST)
  const m = matrix()
  if (mesh) {
    gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, m)
    const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx); gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_INT, 0)
    gl.disableVertexAttribArray(an)
  }
  // the outlines (and the points) as coloured lines
  const ys = shown('yaw'), ps = shown('pitch'), pos: number[] = [], col: number[] = []
  const outerOnly = $<HTMLInputElement>('outer').checked
  for (const c of C.contours) { if (!ys.has(c.yaw) || !ps.has(c.pitch)) continue; const k = colourOf(c); for (let i = 0; i < c.seg.length; i += 6) { if (outerOnly && !c.outer[i / 6]) continue; pos.push(...c.seg.slice(i, i + 6)); col.push(...k, ...k) } }
  gl.useProgram(lineProg); gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'm'), false, m)
  const ap = gl.getAttribLocation(lineProg, 'p'), ac = gl.getAttribLocation(lineProg, 'c'), ua = gl.getUniformLocation(lineProg, 'a')
  const lines = (P: number[], K: number[], mode: number) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf(new Float32Array(P))); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf(new Float32Array(K))); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(mode, 0, P.length / 3) }
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  if ($<HTMLInputElement>('hidden').checked) { gl.depthFunc(gl.ALWAYS); gl.uniform1f(ua, 0.18); lines(pos, col, gl.LINES); gl.depthFunc(gl.LESS) }
  gl.uniform1f(ua, 1); lines(pos, col, gl.LINES)
  // semantic points
  const L = $('labels'); L.innerHTML = ''
  if ($<HTMLInputElement>('pts').checked) {
    const pts = Object.entries(C.points).filter((e): e is [string, [number, number, number]] => !!e[1])
    gl.depthFunc(gl.ALWAYS); lines(pts.flatMap(([, p]) => p), pts.flatMap(() => [0, 0, 0]), gl.POINTS); gl.depthFunc(gl.LESS)
    for (const [name, p] of pts) { const r = rotate(p, { yaw, pitch }), x = (0.5 + (r[0] * 0.42 * zoom) / 2) * cv.width, y = (0.5 - (r[1] * 0.42 * zoom + 0.25) / 2) * cv.height
      const d = document.createElement('div'); d.textContent = name; d.style.left = `${x + 7}px`; d.style.top = `${y - 8}px`; d.style.opacity = r[2] > -0.2 ? '1' : '0.4'; L.appendChild(d) }
  }
  $('status').textContent = `${C.contours.filter(c => ys.has(c.yaw) && ps.has(c.pitch)).length} 个角度的轮廓线（每个角度 = 从那里看时能看到的轮廓，画在头的表面上；勾「只看最外圈」= 只留头的外边缘）`
}

// ---- interaction ----
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing' }
cv.onpointermove = e => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw() }
cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab' }
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(4, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
document.body.addEventListener('change', draw)
document.body.addEventListener('click', e => { const t = e.target as HTMLElement, all = t.dataset.all, none = t.dataset.none; if (!all && !none) return
  for (const i of document.querySelectorAll<HTMLInputElement>(`input[data-${all ?? none}]`)) i.checked = !!all; draw() })
;(window as unknown as { __view: (y: number, p: number) => void }).__view = (y, p) => { yaw = y; pitch = p; draw() }

$('status').textContent = '正在读 test.vrm…'
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d = loadVrmHead(b), P = new Float32Array(d.P.flat()), Nn = new Float32Array(d.N.flat()), idx = new Uint32Array(d.parts.flatMap(p => p.tris))
  mesh = { pos: buf(P), nor: buf(Nn), idx: buf(idx, gl.ELEMENT_ARRAY_BUFFER), n: idx.length }; draw()
}).catch(e => { $('status').textContent = '读取失败：' + e })
draw()
