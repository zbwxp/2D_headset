// 头壳标注 (bowen 1793106702): bowen's own points and lines on the VRoid head shell, seen from any angle. Double-click the shell
// to add a point, drag a point to slide it over the shell, pick two points and join them with a cubic Bézier that keeps to the
// shell (the shell path between them: from the head's centre, the way round from one to the other, pressed onto the outermost
// skin and pulled straight a few times; then one cubic through that path, ends fixed). Points and lines carry names; saved in the
// browser and to / from a json file. Drawing glue only: nothing here enters the model.
import vrmUrl from '../fit/ref/test.vrm?url'
import wire from './vrm-wire.json'
import { loadVrmHead } from '../mesh/vrmhead'
import { rotate } from '../src/view'

type P3 = [number, number, number]
interface Pt { id: number; name: string; p: P3 }
interface Ln { id: number; name: string; a: number; b: number; c: P3[] }
interface Doc { version: 1; next: number; points: Pt[]; lines: Ln[] }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
gl.getExtension('OES_element_index_uint')
const KEY = 'shelledit-doc-v1'
let doc: Doc = load() ?? { version: 1, next: 1, points: [], lines: [] }
let sel: { points: number[]; line: number | null } = { points: [], line: null }
const undo: string[] = []
let yaw = 35, pitch = 10, zoom = 1

// ---- camera: head space → camera (rotate) → clip ----
const S0 = 0.42, CY = 0.2
const axes = () => ({ ex: rotate([1, 0, 0], { yaw, pitch }), ey: rotate([0, 1, 0], { yaw, pitch }), ez: rotate([0, 0, 1], { yaw, pitch }) })
const aspect = () => cv.height / cv.width
function matrix(): Float32Array {
  const { ex, ey, ez } = axes(), s = S0 * zoom, a = aspect()
  return new Float32Array([ex[0] * s * a, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s * a, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s * a, ez[1] * s, -ez[2] * 0.3, 0, 0, CY, 0, 1])
}
const cam = (p: P3) => rotate(p, { yaw, pitch })
/** camera → css pixels on the canvas */
const toScreen = (q: readonly number[]) => { const r = cv.getBoundingClientRect(), s = S0 * zoom; return [(0.5 + (q[0]! * s * aspect()) / 2) * r.width, (0.5 - (q[1]! * s + CY) / 2) * r.height] as const }
/** css pixel → the line of sight in head space (origin far in front, direction into the screen) */
function sight(x: number, y: number): { o: P3; d: P3 } {
  const r = cv.getBoundingClientRect(), s = S0 * zoom, q0 = ((x / r.width) * 2 - 1) / (s * aspect()), q1 = ((1 - (y / r.height) * 2) - CY) / s
  const { ex, ey, ez } = axes(), back = (q: number[]): P3 => [ex[0] * q[0]! + ex[1] * q[1]! + ex[2] * q[2]!, ey[0] * q[0]! + ey[1] * q[1]! + ey[2] * q[2]!, ez[0] * q[0]! + ez[1] * q[1]! + ez[2] * q[2]!]
  return { o: back([q0, q1, 10]), d: back([0, 0, -1]) }
}

// ---- the shell: skin triangles for picking and pressing lines onto ----
let TRI: Float64Array = new Float64Array()
let nTri = 0
/** nearest hit along o + t·d (t > 0) on the skin, or the farthest when `far` */
function hit(o: P3, d: P3, far = false): { t: number; p: P3 } | null {
  let best = far ? -Infinity : Infinity
  for (let i = 0; i < nTri; i++) {
    const k = 9 * i, ax = TRI[k]!, ay = TRI[k + 1]!, az = TRI[k + 2]!
    const e1x = TRI[k + 3]! - ax, e1y = TRI[k + 4]! - ay, e1z = TRI[k + 5]! - az, e2x = TRI[k + 6]! - ax, e2y = TRI[k + 7]! - ay, e2z = TRI[k + 8]! - az
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-12) continue
    const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az, u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t <= 1e-9) continue
    if (far ? t > best : t < best) best = t
  }
  return Number.isFinite(best) ? { t: best, p: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] } : null
}
// pressing onto the shell: along the ray from the head's centre, the outermost skin
const C: P3 = [0, -0.3, 0]
const norm = (v: number[]): P3 => { const m = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / m, v[1]! / m, v[2]! / m] }
const press = (q: P3): P3 => hit(C, norm([q[0] - C[0], q[1] - C[1], q[2] - C[2]]), true)?.p ?? q
/** the shell path from a to b, and one cubic through it (ends fixed) */
function hug(a: P3, b: P3, n = 40, rounds = 6): P3[] {
  const ua = norm([a[0] - C[0], a[1] - C[1], a[2] - C[2]]), ub = norm([b[0] - C[0], b[1] - C[1], b[2] - C[2]]), om = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2])))
  let path: P3[] = Array.from({ length: n + 1 }, (_, i) => { const t = i / n
    if (i === 0) return a; if (i === n) return b
    const u = om < 1e-6 ? ua : ([0, 1, 2].map(k => (Math.sin((1 - t) * om) * ua[k]! + Math.sin(t * om) * ub[k]!) / Math.sin(om)) as P3)
    return press([C[0] + u[0], C[1] + u[1], C[2] + u[2]]) })
  for (let r = 0; r < rounds; r++) path = path.map((p, i) => (i === 0 || i === n ? p : press([0, 1, 2].map(k => (path[i - 1]![k]! + path[i + 1]![k]!) / 2) as P3)))
  return fitCubic(path)
}
function fitCubic(q: P3[]): P3[] {
  const n = q.length - 1, L = [0]; for (let i = 1; i <= n; i++) L.push(L[i - 1]! + Math.hypot(q[i]![0] - q[i - 1]![0], q[i]![1] - q[i - 1]![1], q[i]![2] - q[i - 1]![2]))
  const P0 = q[0]!, P3_ = q[n]!; let a11 = 0, a12 = 0, a22 = 0; const r1 = [0, 0, 0], r2 = [0, 0, 0]
  for (let i = 0; i <= n; i++) { const t = L[i]! / (L[n]! || 1), u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b0 = u * u * u, b3 = t * t * t; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
    for (let k = 0; k < 3; k++) { const r = q[i]![k]! - b0 * P0[k]! - b3 * P3_[k]!; r1[k]! += b1 * r; r2[k]! += b2 * r } }
  const det = a11 * a22 - a12 * a12
  if (Math.abs(det) < 1e-12) return [P0, [0, 1, 2].map(k => P0[k]! + (P3_[k]! - P0[k]!) / 3) as P3, [0, 1, 2].map(k => P0[k]! + (2 * (P3_[k]! - P0[k]!)) / 3) as P3, P3_]
  return [P0, [0, 1, 2].map(k => (r1[k]! * a22 - r2[k]! * a12) / det) as P3, [0, 1, 2].map(k => (a11 * r2[k]! - a12 * r1[k]!) / det) as P3, P3_]
}
const cubic = (c: P3[], t: number): P3 => { const u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return [0, 1, 2].map(k => w.reduce((s, wi, j) => s + wi * c[j]![k]!, 0)) as P3 }

// ---- the document ----
function load(): Doc | null { try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Doc) : null } catch { return null } }
function store() { try { localStorage.setItem(KEY, JSON.stringify(doc)) } catch { /* private window: the file still works */ } }
const snapshot = () => { undo.push(JSON.stringify(doc)); if (undo.length > 200) undo.shift() }
const pt = (id: number) => doc.points.find(p => p.id === id)
function refit(ids?: Set<number>) { for (const l of doc.lines) if (!ids || ids.has(l.a) || ids.has(l.b)) { const a = pt(l.a), b = pt(l.b); if (a && b) l.c = hug(a.p, b.p) } }
function changed() { store(); list(); draw() }

// ---- drawing ----
function program(vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!); gl.attachShader(p, s) }
  gl.linkProgram(p); return p
}
const meshProg = program(`attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; void main(){ gl_Position = m * vec4(p, 1.0); vn = (m * vec4(n, 0.0)).xyz; }`,
  `precision mediump float; varying vec3 vn; void main(){ vec3 N = normalize(vec3(vn.xy, -vn.z)); float l = 0.45 + 0.55 * max(0.0, dot(N, normalize(vec3(-0.35, 0.55, 0.76)))); gl_FragColor = vec4(vec3(0.86, 0.85, 0.83) * l, 1.0); }`)
const lineProg = program(`attribute vec3 p; attribute vec3 c; uniform mat4 m; uniform float ps; varying vec3 vc; void main(){ gl_Position = m * vec4(p, 1.0); gl_Position.z -= 0.008; gl_PointSize = ps; vc = c; }`,
  `precision mediump float; varying vec3 vc; void main(){ gl_FragColor = vec4(vc, 1.0); }`)
const buf = (arr: Float32Array | Uint32Array, target: number = gl.ARRAY_BUFFER) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b }
let mesh: { pos: WebGLBuffer; nor: WebGLBuffer; idx: WebGLBuffer; n: number } | undefined
const scratch = { p: gl.createBuffer()!, c: gl.createBuffer()! }
function draw() {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr)
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
  $('view').textContent = `转 ${yaw.toFixed(0)}° · 俯仰 ${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch).toFixed(0)}°`
  const m = matrix()
  gl.viewport(0, 0, W, H); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST)
  if (mesh) {
    gl.useProgram(meshProg); gl.uniformMatrix4fv(gl.getUniformLocation(meshProg, 'm'), false, m)
    const ap = gl.getAttribLocation(meshProg, 'p'), an = gl.getAttribLocation(meshProg, 'n')
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nor); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx); gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_INT, 0); gl.disableVertexAttribArray(an)
  }
  gl.useProgram(lineProg); gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'm'), false, m)
  const ap = gl.getAttribLocation(lineProg, 'p'), ac = gl.getAttribLocation(lineProg, 'c')
  const put = (P: number[], K: number[], mode: number, size = 1) => { if (!P.length) return; gl.uniform1f(gl.getUniformLocation(lineProg, 'ps'), size * dpr)
    gl.bindBuffer(gl.ARRAY_BUFFER, scratch.p); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, scratch.c); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(K), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(mode, 0, P.length / 3) }
  if ($<HTMLInputElement>('xray').checked) gl.clear(gl.DEPTH_BUFFER_BIT)
  if ($<HTMLInputElement>('wire').checked) { const W2 = wire as unknown as Record<string, { curves: P3[][] }>, P: number[] = []
    for (const k of ['meridian', 'latitude', 'ear', 'eyes']) for (const c of W2[k]!.curves) for (let i = 0; i < 32; i++) P.push(...cubic(c, i / 32), ...cubic(c, (i + 1) / 32))
    put(P, P.map((_, i) => (i % 3 === 2 ? 0.75 : 0.6)), gl.LINES) }
  for (const l of doc.lines) { const P: number[] = []; for (let i = 0; i < 48; i++) P.push(...cubic(l.c, i / 48), ...cubic(l.c, (i + 1) / 48))
    const k = sel.line === l.id ? [0.1, 0.45, 1] : [0.85, 0.15, 0.2]; put(P, P.map((_, i) => k[i % 3]!), gl.LINES) }
  for (const p of doc.points) { const k = sel.points.includes(p.id) ? [0.1, 0.45, 1] : [0.05, 0.05, 0.05]; put([...p.p], k, gl.POINTS, sel.points.includes(p.id) ? 11 : 8) }
  labels()
}
/** is the point hidden behind the shell from here? */
function hidden(p: P3) { const q = cam(p), [x, y] = toScreen(q), s = sight(x, y), h = hit(s.o, s.d); return !!h && cam(h.p)[2] > q[2] + 0.02 }
function labels() {
  const L = $('labels'); L.innerHTML = ''; const xray = $<HTMLInputElement>('xray').checked
  const add = (p: P3, name: string) => { const back = hidden(p); if (back && !xray) return; const [x, y] = toScreen(cam(p)), d = document.createElement('div'); d.textContent = name; d.style.left = `${x + 7}px`; d.style.top = `${y - 9}px`; if (back) d.className = 'back'; L.appendChild(d) }
  for (const p of doc.points) add(p.p, p.name)
  for (const l of doc.lines) add(cubic(l.c, 0.5), l.name)
}

// ---- the list ----
function list() {
  const P = $('points'), Lw = $('lines'); P.innerHTML = ''; Lw.innerHTML = ''
  const row = (box: HTMLElement, on: boolean, name: string, rename: (s: string) => void, del: () => void, pick: (e: MouseEvent) => void, note = '') => {
    const r = document.createElement('div'); r.className = 'row' + (on ? ' sel' : '')
    const i = document.createElement('input'); i.value = name; i.onchange = () => { snapshot(); rename(i.value.trim() || name); changed() }; i.onfocus = e => pick(e as unknown as MouseEvent)
    const s = document.createElement('span'); s.textContent = note
    const x = document.createElement('button'); x.textContent = '×'; x.title = '删除'; x.onclick = () => { snapshot(); del(); changed() }
    r.onclick = e => { if (e.target === r || e.target === s) pick(e) }; r.append(i, s, x); box.appendChild(r)
  }
  for (const p of doc.points) row(P, sel.points.includes(p.id), p.name, s => { p.name = s }, () => removePoints([p.id]), e => { selectPoint(p.id, e.shiftKey); draw(); list() })
  for (const l of doc.lines) row(Lw, sel.line === l.id, l.name, s => { l.name = s }, () => { doc.lines = doc.lines.filter(k => k !== l) }, () => { sel = { points: [], line: l.id }; draw(); list() }, `${pt(l.a)?.name} → ${pt(l.b)?.name}`)
  $('status').textContent = `${doc.points.length} 个点 · ${doc.lines.length} 条线`
}
function selectPoint(id: number, add: boolean) { sel.line = null; if (add) { if (!sel.points.includes(id)) sel.points.push(id) } else sel.points = [id] }
function removePoints(ids: number[]) { doc.points = doc.points.filter(p => !ids.includes(p.id)); doc.lines = doc.lines.filter(l => !ids.includes(l.a) && !ids.includes(l.b)); sel = { points: [], line: null } }
function uniqueName(base: string, taken: string[]) { let i = 1; while (taken.includes(`${base}${i}`)) i++; return `${base}${i}` }

// ---- interaction ----
const nearPoint = (x: number, y: number) => { let best: Pt | null = null, bd = 10; const xray = $<HTMLInputElement>('xray').checked
  for (const p of doc.points) { const [sx, sy] = toScreen(cam(p.p)), d = Math.hypot(sx - x, sy - y); if (d < bd && (xray || !hidden(p.p))) { bd = d; best = p } }
  return best }
const nearLine = (x: number, y: number) => { let best: Ln | null = null, bd = 7
  for (const l of doc.lines) for (let i = 0; i <= 48; i++) { const [sx, sy] = toScreen(cam(cubic(l.c, i / 48))), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = l } }
  return best }
const local = (e: PointerEvent | MouseEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
let drag: { kind: 'turn'; x: number; y: number; yaw: number; pitch: number; moved: boolean } | { kind: 'point'; id: number; moved: boolean } | null = null
cv.onpointerdown = e => {
  const [x, y] = local(e), p = nearPoint(x, y); cv.setPointerCapture(e.pointerId)
  if (p) { selectPoint(p.id, e.shiftKey); drag = { kind: 'point', id: p.id, moved: false }; list(); draw(); return }
  drag = { kind: 'turn', x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; cv.style.cursor = 'grabbing'
}
cv.onpointermove = e => {
  if (!drag) return
  if (drag.kind === 'turn') { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true
    yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw(); return }
  const [x, y] = local(e), s = sight(x, y), h = hit(s.o, s.d), p = pt(drag.id); if (!h || !p) return
  if (!drag.moved) { snapshot(); drag.moved = true }
  p.p = h.p; for (const l of doc.lines) if (l.a === p.id || l.b === p.id) { const a = pt(l.a)!, b = pt(l.b)!; l.c = hug(a.p, b.p, 24, 3) } // light while dragging
  draw()
}
cv.onpointerup = e => {
  if (drag?.kind === 'point' && drag.moved) { refit(new Set([drag.id])); changed() }
  else if (drag?.kind === 'turn' && !drag.moved) { const [x, y] = local(e), l = nearLine(x, y); sel = l ? { points: [], line: l.id } : { points: [], line: null }; list(); draw() }
  drag = null; cv.style.cursor = 'grab'
}
cv.ondblclick = e => {
  const [x, y] = local(e); if (nearPoint(x, y)) return // a double-click on a point only selects it
  const s = sight(x, y), h = hit(s.o, s.d); if (!h) return
  snapshot(); const id = doc.next++; doc.points.push({ id, name: uniqueName('点', doc.points.map(p => p.name)), p: h.p.map(v => +v.toFixed(5)) as P3 }); sel = { points: [id], line: null }; changed()
}
cv.onwheel = e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.001))); draw() }
$('link').onclick = () => {
  if (sel.points.length !== 2) { alert('先选两个点：点一个，再按住 Shift 点另一个'); return }
  const [a, b] = sel.points as [number, number], A = pt(a)!, B = pt(b)!
  snapshot(); const id = doc.next++; doc.lines.push({ id, name: uniqueName('线', doc.lines.map(l => l.name)), a, b, c: hug(A.p, B.p) }); sel = { points: [], line: id }; changed()
}
const doUndo = () => { const s = undo.pop(); if (!s) return; doc = JSON.parse(s) as Doc; sel = { points: [], line: null }; changed() }
$('undo').onclick = doUndo
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (!sel.points.length && sel.line === null) return; snapshot()
    if (sel.points.length) removePoints(sel.points); else { doc.lines = doc.lines.filter(l => l.id !== sel.line); sel.line = null } changed() }
})
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
for (const id of ['xray', 'wire']) $(id).addEventListener('change', draw)
$('save').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })); a.download = '头壳标注.json'; a.click(); URL.revokeObjectURL(a.href) }
$('openBtn').onclick = () => $('open').click()
$<HTMLInputElement>('open').onchange = async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; snapshot(); doc = JSON.parse(await f.text()) as Doc; sel = { points: [], line: null }; changed() }
window.addEventListener('resize', draw)
;(window as unknown as { __shell: unknown }).__shell = { view: (y: number, p: number, z?: number) => { yaw = y; pitch = p; if (z) zoom = z; draw() }, doc: () => doc, sight, hit, hug, changed: () => changed(), set: (d: Doc) => { doc = d; changed() } }

// the neck as well (bowen 1793106912 「颈部也都给出来」): the skin kept down to NECK, but in the usual head space (the one every
// other line here and in vrm-wire.json is in): the same raw vertices loaded both ways, matched at the crown and the nose tip
const NECK = Number(new URLSearchParams(location.search).get('neck') ?? 1.3)
fetch(vrmUrl).then(r => r.arrayBuffer()).then(b => {
  const d0 = loadVrmHead(b.slice(0)), d = loadVrmHead(b.slice(0), NECK)
  const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
  const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(d.P, 1), b1 = ext(d.P, 2) // the crown and the nose tip
  const sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
  d.P = d.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as unknown as typeof p)
  // the arms (VRoid stands with them out at shoulder height) left out: below the head, only what lies near the neck
  const nearNeck = (i: number) => { const p = d.P[i]!; return p[1] > -1.2 || Math.abs(p[0]) < 1.0 }
  for (const part of d.parts) { const t: number[] = []; for (let i = 0; i < part.tris.length; i += 3) if ([0, 1, 2].every(k => nearNeck(part.tris[i + k]!))) t.push(part.tris[i]!, part.tris[i + 1]!, part.tris[i + 2]!); part.tris = t }
  d.skinTris = d.parts.filter(p => p.kind === 'skin').flatMap(p => p.tris)
  const idx = new Uint32Array(d.parts.flatMap(p => p.tris))
  mesh = { pos: buf(new Float32Array(d.P.flat())), nor: buf(new Float32Array(d.N.flat())), idx: buf(idx, gl.ELEMENT_ARRAY_BUFFER), n: idx.length }
  nTri = d.skinTris.length / 3; TRI = new Float64Array(nTri * 9)
  for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) TRI[9 * t + 3 * k + j] = d.P[d.skinTris[3 * t + k]!]![j]!
  changed()
})
list(); draw()
