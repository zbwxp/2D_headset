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
/** own: the line keeps its own handles (moved with their ends, or dragged), else it is pressed onto the shell again whenever an end moves */
interface Ln { id: number; name: string; a: number; b: number; c: P3[]; own?: boolean }
interface Doc { version: 1; next: number; points: Pt[]; lines: Ln[] }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const cv = $<HTMLCanvasElement>('c'), gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true })!
gl.getExtension('OES_element_index_uint')
const KEY = 'shelledit-doc-v1'
const stored = load()
let doc: Doc = stored ?? { version: 1, next: 1, points: [], lines: [] }
let sel: { points: number[]; line: number | null } = { points: [], line: null }
const undo: string[] = []
let yaw = 35, pitch = 10, zoom = 1, panX = 0, panY = 0 // pan: the camera point at the canvas centre

// ---- camera: head space → camera (rotate) → clip ----
const S0 = 0.42, CY = 0.2
const axes = () => ({ ex: rotate([1, 0, 0], { yaw, pitch }), ey: rotate([0, 1, 0], { yaw, pitch }), ez: rotate([0, 0, 1], { yaw, pitch }) })
const aspect = () => cv.height / cv.width
function matrix(): Float32Array {
  const { ex, ey, ez } = axes(), s = S0 * zoom, a = aspect()
  return new Float32Array([ex[0] * s * a, ex[1] * s, -ex[2] * 0.3, 0, ey[0] * s * a, ey[1] * s, -ey[2] * 0.3, 0, ez[0] * s * a, ez[1] * s, -ez[2] * 0.3, 0, -panX * s * a, CY - panY * s, 0, 1])
}
const cam = (p: P3) => rotate(p, { yaw, pitch })
/** camera → css pixels on the canvas */
const toScreen = (q: readonly number[]) => { const r = cv.getBoundingClientRect(), s = S0 * zoom; return [(0.5 + ((q[0]! - panX) * s * aspect()) / 2) * r.width, (0.5 - ((q[1]! - panY) * s + CY) / 2) * r.height] as const }
/** css pixel → the line of sight in head space (origin far in front, direction into the screen) */
/** camera → head space */
const back = (q: readonly number[]): P3 => { const { ex, ey, ez } = axes(); return [ex[0] * q[0]! + ex[1] * q[1]! + ex[2] * q[2]!, ey[0] * q[0]! + ey[1] * q[1]! + ey[2] * q[2]!, ez[0] * q[0]! + ez[1] * q[1]! + ez[2] * q[2]!] }
/** css pixel → camera x, y */
const fromScreen = (x: number, y: number) => { const r = cv.getBoundingClientRect(), s = S0 * zoom; return [((x / r.width) * 2 - 1) / (s * aspect()) + panX, ((1 - (y / r.height) * 2) - CY) / s + panY] as const }
/** zoom keeping the camera point under (x, y) where it is */
function zoomAt(x: number, y: number, z: number) { const [q0, q1] = fromScreen(x, y); zoom = Math.max(0.4, Math.min(12, z)); const [n0, n1] = fromScreen(x, y); panX += q0 - n0; panY += q1 - n1; draw() }
function sight(x: number, y: number): { o: P3; d: P3 } { const [q0, q1] = fromScreen(x, y); return { o: back([q0, q1, 10]), d: back([0, 0, -1]) } }

// ---- the shell: skin triangles for picking and pressing lines onto ----
let TRI: Float64Array = new Float64Array(), ALL: Float64Array = new Float64Array() // skin; everything (eyes too, for what hides what)
let nTri = 0
/** nearest hit along o + t·d (t > 0) on the skin; the farthest when `far`; the one nearest t = `near` when given */
function hit(o: P3, d: P3, far = false, tri = TRI, near?: number): { t: number; p: P3 } | null {
  let best = far ? -Infinity : Infinity, TRI_ = tri
  for (let i = 0; i < TRI_.length / 9; i++) {
    const k = 9 * i, ax = TRI_[k]!, ay = TRI_[k + 1]!, az = TRI_[k + 2]!
    const e1x = TRI_[k + 3]! - ax, e1y = TRI_[k + 4]! - ay, e1z = TRI_[k + 5]! - az, e2x = TRI_[k + 6]! - ax, e2y = TRI_[k + 7]! - ay, e2z = TRI_[k + 8]! - az
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-12) continue
    const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az, u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t <= 1e-9) continue
    if (near !== undefined ? Math.abs(t - near) < Math.abs(best - near) : far ? t > best : t < best) best = t
  }
  return Number.isFinite(best) ? { t: best, p: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] } : null
}
/** the skin point nearest to q (closest point on each triangle, Ericson's regions) */
function nearestOnSkin(q: P3): P3 {
  let best = Infinity, bp: P3 = q
  const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!], dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  for (let i = 0; i < nTri; i++) {
    const k = 9 * i, a = [TRI[k]!, TRI[k + 1]!, TRI[k + 2]!], b = [TRI[k + 3]!, TRI[k + 4]!, TRI[k + 5]!], c = [TRI[k + 6]!, TRI[k + 7]!, TRI[k + 8]!]
    let box = 0; for (let j = 0; j < 3; j++) { const lo = Math.min(a[j]!, b[j]!, c[j]!), hi = Math.max(a[j]!, b[j]!, c[j]!), e = q[j]! < lo ? lo - q[j]! : q[j]! > hi ? q[j]! - hi : 0; box += e * e }
    if (box >= best) continue // its box is already farther than the best
    const ab = sub(b, a), ac = sub(c, a), ap = sub(q, a), d1 = dot(ab, ap), d2 = dot(ac, ap); let r: number[]
    if (d1 <= 0 && d2 <= 0) r = a
    else { const bp_ = sub(q, b), d3 = dot(ab, bp_), d4 = dot(ac, bp_)
      if (d3 >= 0 && d4 <= d3) r = b
      else { const vc = d1 * d4 - d3 * d2
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); r = [a[0]! + v * ab[0]!, a[1]! + v * ab[1]!, a[2]! + v * ab[2]!] }
        else { const cp = sub(q, c), d5 = dot(ab, cp), d6 = dot(ac, cp)
          if (d6 >= 0 && d5 <= d6) r = c
          else { const vb = d5 * d2 - d1 * d6
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); r = [a[0]! + w * ac[0]!, a[1]! + w * ac[1]!, a[2]! + w * ac[2]!] }
            else { const va = d3 * d6 - d5 * d4
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); r = [b[0]! + w * (c[0]! - b[0]!), b[1]! + w * (c[1]! - b[1]!), b[2]! + w * (c[2]! - b[2]!)] }
              else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; r = [a[0]! + ab[0]! * v + ac[0]! * w, a[1]! + ab[1]! * v + ac[1]! * w, a[2]! + ab[2]! * v + ac[2]! * w] } } } } } }
    const d = (r[0]! - q[0]) ** 2 + (r[1]! - q[1]) ** 2 + (r[2]! - q[2]) ** 2; if (d < best) { best = d; bp = [r[0]!, r[1]!, r[2]!] }
  }
  return bp
}
/** the shell's outward normal at p: the triangles round it (within r), area-weighted */
function shellNormal(p: P3, r = 0.08): P3 {
  const n = [0, 0, 0]
  for (let i = 0; i < nTri; i++) { const k = 9 * i
    if (![0, 3, 6].some(o => Math.hypot(TRI[k + o]! - p[0], TRI[k + o + 1]! - p[1], TRI[k + o + 2]! - p[2]) < r)) continue
    const ux = TRI[k + 3]! - TRI[k]!, uy = TRI[k + 4]! - TRI[k + 1]!, uz = TRI[k + 5]! - TRI[k + 2]!, vx = TRI[k + 6]! - TRI[k]!, vy = TRI[k + 7]! - TRI[k + 1]!, vz = TRI[k + 8]! - TRI[k + 2]!
    let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    const mx = (TRI[k]! + TRI[k + 3]! + TRI[k + 6]!) / 3 - C[0], my = (TRI[k + 1]! + TRI[k + 4]! + TRI[k + 7]!) / 3 - C[1], mz = (TRI[k + 2]! + TRI[k + 5]! + TRI[k + 8]!) / 3 - C[2]
    if (cx * mx + cy * my + cz * mz < 0) { cx = -cx; cy = -cy; cz = -cz } // outward (VRoid's skin winds both ways at seams)
    n[0]! += cx; n[1]! += cy; n[2]! += cz }
  return norm(n.every(v => v === 0) ? [p[0] - C[0], p[1] - C[1], p[2] - C[2]] : n)
}
/** how far a point is off the shell (to the nearest skin) */
const off = (q: P3) => { const s = nearestOnSkin(q); return Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]) }
/** how far the line gets from the shell (the farthest of its samples) */
function lift(c: P3[], n = 16) { let m = 0; for (let i = 1; i < n; i++) m = Math.max(m, off(cubic(c, i / n))); return m }
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
function refit(ids?: Set<number>) { for (const l of doc.lines) if (!l.own && (!ids || ids.has(l.a) || ids.has(l.b))) { const a = pt(l.a), b = pt(l.b); if (a && b) l.c = hug(a.p, b.p) } }
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
  // the selected line's two handles (drawn over everything, so they can be reached behind the shell too)
  const L = doc.lines.find(l => l.id === sel.line)
  if (L) { gl.clear(gl.DEPTH_BUFFER_BIT); const H2 = [...L.c[0]!, ...L.c[1]!, ...L.c[3]!, ...L.c[2]!]; put(H2, H2.map((_, i) => [0.55, 0.55, 0.6][i % 3]!), gl.LINES); put([...L.c[1]!, ...L.c[2]!], [1, 0.55, 0, 1, 0.55, 0], gl.POINTS, 9) }
  labels()
  const sl = doc.lines.find(l => l.id === sel.line); $('lift').textContent = sl ? `「${sl.name}」离头壳最远 ${lift(sl.c).toFixed(3)}（头半径 = 1）` : ''
}
/** is the point hidden behind the shell from here? */
function hidden(p: P3) { const q = cam(p), [x, y] = toScreen(q), s = sight(x, y), h = hit(s.o, s.d, false, ALL); return !!h && cam(h.p)[2] > q[2] + 0.02 }
function labels() {
  const L = $('labels'); L.innerHTML = ''; const xray = $<HTMLInputElement>('xray').checked
  const add = (p: P3, name: string) => { const back = hidden(p); if (back && !xray) return; const [x, y] = toScreen(cam(p)), d = document.createElement('div'); d.textContent = name; d.style.left = `${x + 7}px`; d.style.top = `${y - 9}px`; if (back) d.className = 'back'; L.appendChild(d) }
  for (const p of doc.points) add(p.p, p.name)
  for (const l of doc.lines) if (sel.line === l.id || $<HTMLInputElement>('lnames').checked) add(cubic(l.c, 0.5), l.name)
}

// ---- the list ----
function list() {
  const P = $('points'), Lw = $('lines'); P.innerHTML = ''; Lw.innerHTML = ''
  const row = (box: HTMLElement, on: boolean, name: string, rename: (s: string) => void, del: () => void, pick: (e: MouseEvent) => void, note = '') => {
    const r = document.createElement('div'); r.className = 'row' + (on ? ' sel' : '')
    // focusing the name box selects its point / line but must not rebuild the list (that threw the focused box away:
    // bowen 1793108708 「这个框只是高亮…还是不能选中并且修改」); only the highlight moves
    const i = document.createElement('input'); i.value = name; i.onchange = () => { snapshot(); rename(i.value.trim() || name); changed() }
    i.onfocus = () => { pick(new MouseEvent('click')); for (const o of document.querySelectorAll('#side .row')) o.classList.remove('sel'); r.classList.add('sel') }
    const s = document.createElement('span'); s.textContent = note
    const x = document.createElement('button'); x.textContent = '×'; x.title = '删除'; x.onclick = () => { snapshot(); del(); changed() }
    r.onclick = e => { if (e.target === r || e.target === s) pick(e) }; r.append(i, s, x); box.appendChild(r)
  }
  for (const p of doc.points) row(P, sel.points.includes(p.id), p.name, s => { p.name = s }, () => removePoints([p.id]), e => { selectPoint(p.id, e.shiftKey); draw(); if (e.isTrusted) list() })
  for (const l of doc.lines) row(Lw, sel.line === l.id, l.name, s => { l.name = s }, () => { doc.lines = doc.lines.filter(k => k !== l) }, e => { sel = { points: [], line: l.id }; draw(); if (e.isTrusted) list() }, `${pt(l.a)?.name} → ${pt(l.b)?.name}`)
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
let drag: { kind: 'turn'; x: number; y: number; yaw: number; pitch: number; moved: boolean } | { kind: 'point'; id: number; sx: number; sy: number; moved: boolean } | { kind: 'handle'; line: number; k: 1 | 2; moved: boolean; n?: P3 } | { kind: 'zoom' | 'pan'; x: number; y: number; sx: number; sy: number; zoom: number; panX: number; panY: number; moved: boolean } | null = null
/** a handle of the selected line under the cursor */
const nearHandle = (x: number, y: number) => { const L = doc.lines.find(l => l.id === sel.line); if (!L) return null
  for (const k of [1, 2] as const) { const [sx, sy] = toScreen(cam(L.c[k]!)); if (Math.hypot(sx - x, sy - y) < 9) return { line: L.id, k } }
  return null }
cv.onpointerdown = e => {
  cv.setPointerCapture(e.pointerId)
  if (zoomTool || space) { const [x, y] = local(e); drag = { kind: zoomTool ? 'zoom' : 'pan', x, y, sy: e.clientY, sx: e.clientX, zoom, panX, panY, moved: false }; return }
  const [x, y] = local(e), p = nearPoint(x, y), hd = nearHandle(x, y)
  if (hd) { drag = { kind: 'handle', ...hd, moved: false }; return }
  if (p) { selectPoint(p.id, e.shiftKey); drag = { kind: 'point', id: p.id, sx: e.clientX, sy: e.clientY, moved: false }; list(); draw(); return }
  drag = { kind: 'turn', x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; cv.style.cursor = 'grabbing'
}
cv.onpointermove = e => {
  if (!drag) return
  if (drag.kind === 'zoom') { zoomAt(drag.x, drag.y, drag.zoom * Math.exp(-(e.clientY - drag.sy) * 0.01)); return }
  if (drag.kind === 'pan') { const s = S0 * zoom, r = cv.getBoundingClientRect(); panX = drag.panX - ((e.clientX - drag.sx) / r.width) * 2 / (s * aspect()); panY = drag.panY + ((e.clientY - drag.sy) / r.height) * 2 / s; draw(); return }
  if (drag.kind === 'turn') { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true
    yaw = drag.yaw + (e.clientX - drag.x) * 0.5; pitch = Math.max(-89, Math.min(89, drag.pitch - (e.clientY - drag.y) * 0.5)); draw(); return }
  if (drag.kind === 'handle') { const dr = drag, L = doc.lines.find(l => l.id === dr.line); if (!L) return
    // a handle stays in the shell's tangent plane at its end (bowen 1793109399 「调整handle的时候要让它尽量贴合头壳表面」): the
    // line then leaves its end along the shell, and how far it bulges out is only the handle's length. The cursor's line of
    // sight meets that plane; seen edge-on, the cursor's place at the handle's depth is pressed into the plane instead
    if (!dr.moved) { snapshot(); dr.moved = true; dr.n = shellNormal(L.c[dr.k === 1 ? 0 : 3]!) }
    const E = L.c[dr.k === 1 ? 0 : 3]!, n = dr.n!, [x, y] = local(e), s = sight(x, y), dn = n[0] * s.d[0] + n[1] * s.d[1] + n[2] * s.d[2]
    let h: P3
    if (Math.abs(dn) > 0.2) { const t = (n[0] * (E[0] - s.o[0]) + n[1] * (E[1] - s.o[1]) + n[2] * (E[2] - s.o[2])) / dn; h = [s.o[0] + s.d[0] * t, s.o[1] + s.d[1] * t, s.o[2] + s.d[2] * t] }
    else { const [q0, q1] = fromScreen(x, y), q = back([q0, q1, cam(L.c[dr.k]!)[2]]), off = n[0] * (q[0] - E[0]) + n[1] * (q[1] - E[1]) + n[2] * (q[2] - E[2]); h = [q[0] - n[0] * off, q[1] - n[1] * off, q[2] - n[2] * off] }
    L.c[dr.k] = h; L.own = true; draw(); return }
  const [x, y] = local(e)
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return // a press, not yet a drag
  const s = sight(x, y), h = hit(s.o, s.d), p = pt(drag.id); if (!h || !p) return
  if (!drag.moved) { snapshot(); drag.moved = true }
  moveTo(p, h.p, true); draw()
}
/** a point to a new place on the shell; the handles at it go with it exactly (lines with their own handles), the other
 * lines are pressed onto the shell again (lightly while dragging) */
function moveTo(p: Pt, q: P3, light = false) {
  const dv = [0, 1, 2].map(k => q[k]! - p.p[k]!); p.p = q
  for (const l of doc.lines) if (l.a === p.id || l.b === p.id) {
    if (l.own) {
      if (l.a === p.id) { l.c[0] = p.p; l.c[1] = l.c[1]!.map((v, k) => v + dv[k]!) as P3 }
      if (l.b === p.id) { l.c[3] = p.p; l.c[2] = l.c[2]!.map((v, k) => v + dv[k]!) as P3 }
    } else { const a = pt(l.a)!, b = pt(l.b)!; l.c = light ? hug(a.p, b.p, 24, 3) : hug(a.p, b.p) } }
}
/** the arrow keys (bowen 1793109026 / 1793109036): the selected points one step across the screen, kept on the shell (the
 * surface they are on); Shift = a big step, Alt = a small one */
let arrowRun = 0
function nudge(dx: number, dy: number) {
  if (!sel.points.length) return false
  if (performance.now() - arrowRun > 800) snapshot() // one undo per run of key presses
  arrowRun = performance.now()
  for (const id of sel.points) { const p = pt(id); if (!p) continue
    // the step across the screen at the point's own depth, then the nearest skin point (works on the outline too, where a
    // line of sight only grazes the shell)
    const q = cam(p.p), [x, y] = toScreen(q), [q0, q1] = fromScreen(x + dx, y + dy); moveTo(p, nearestOnSkin(back([q0, q1, q[2]]))) }
  changed(); return true
}
// a second press on the same point within a moment = rename (by hand rather than the dblclick event, which not every
// browser sends once the pointer is captured; bowen 1793108360 「这个点1 我双击也无法改」)
let lastTap: { id: number; t: number } | null = null
cv.onpointerup = e => {
  if (drag?.kind === 'point' && !drag.moved) { const now = performance.now(), id = drag.id
    if (lastTap && lastTap.id === id && now - lastTap.t < 500) { lastTap = null; drag = null; cursor(); const p = pt(id); if (p) rename(p, p.p); return }
    lastTap = { id, t: now } }
  if (drag?.kind === 'point' && drag.moved) { refit(new Set([drag.id])); changed() }
  else if (drag?.kind === 'handle' && drag.moved) changed()
  else if (drag?.kind === 'turn' && !drag.moved) { const [x, y] = local(e), l = nearLine(x, y); sel = l ? { points: [], line: l.id } : { points: [], line: null }; list(); draw() }
  drag = null; cursor()
}
cv.ondblclick = e => {
  if (zoomTool || space) return
  const [x, y] = local(e); if (nearPoint(x, y)) return // a double-click on a point: renamed on its second press (pointerup)
  const s = sight(x, y), h = hit(s.o, s.d); if (!h) return
  snapshot(); const id = doc.next++; doc.points.push({ id, name: uniqueName('点', doc.points.map(p => p.name)), p: h.p.map(v => +v.toFixed(5)) as P3 }); sel = { points: [id], line: null }; changed()
}
cv.onwheel = e => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, zoom * Math.exp(-e.deltaY * 0.001)) }
// Z = the zoom tool (bowen 1793108175): the cursor a magnifier, drag up = closer, down = farther, about where the drag began;
// Z again = back to the usual tool. Space held = the hand (drag pans), like the usual editors
let zoomTool = false, space = false
const cursor = () => { cv.style.cursor = zoomTool ? 'zoom-in' : space ? 'move' : 'grab' }
/** a name box on the canvas at the point (Enter keeps it, Esc leaves it as it was) */
let editing = false
function rename(p: { name: string }, at: P3) {
  if (editing) return; editing = true
  const [x, y] = toScreen(cam(at)), box = document.createElement('input'); box.value = p.name
  Object.assign(box.style, { position: 'absolute', left: `${x + 6}px`, top: `${y - 12}px`, font: '13px system-ui', width: '9em', zIndex: '5' })
  $('wrap').appendChild(box); box.focus(); box.select()
  let done = false; const finish = (keep: boolean) => { if (done) return; done = true; editing = false; const v = box.value.trim(); box.remove(); if (keep && v && v !== p.name) { snapshot(); p.name = v; changed() } }
  box.onkeydown = e => { e.stopPropagation(); if (e.isComposing) return; if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false) }; box.onblur = () => finish(true)
}
/** the selected line pressed onto the shell (like a shrink-wrap): its own course kept, each sample moved to the nearest
 * skin, then one cubic through those (ends fixed), a few times over. bowen 1793109786: the first try kept the handle
 * directions and only changed their lengths, and the handles shrank into their ends */
function snug(L: Ln, rounds = 3) {
  for (let r = 0; r < rounds; r++) { const q = Array.from({ length: 25 }, (_, i) => (i === 0 ? L.c[0]! : i === 24 ? L.c[3]! : nearestOnSkin(cubic(L.c, i / 24)))); L.c = fitCubic(q) }
  L.own = true
}
$('snug').onclick = () => { const L = doc.lines.find(l => l.id === sel.line); if (!L) { alert('先点一条线'); return } snapshot(); snug(L); changed() }
$('link').onclick = () => {
  if (sel.points.length !== 2) { alert('先选两个点：点一个，再按住 Shift 点另一个'); return }
  const [a, b] = sel.points as [number, number], A = pt(a)!, B = pt(b)!
  snapshot(); const id = doc.next++; doc.lines.push({ id, name: uniqueName('线', doc.lines.map(l => l.name)), a, b, c: hug(A.p, B.p) }); sel = { points: [], line: id }; changed()
}
// the lines we already have (vrm-wire.json: meridian, latitude, ears, eye sockets; bowen 1793107710 「将现有的线都放在这个头壳上」)
// as points and lines with their own handles, named (1793107717 「点和线名字都取好」): the meridian's joints by their names, the
// latitude's front joint 额前 (its back joint is 后脑), ears and eyes by side — 左 / 右 as seen from the front (左 = x < 0)
function importWire() {
  const W = wire as unknown as { meridian: { names: string[]; curves: P3[][] }; latitude: { curves: P3[][] }; ear: { names: string[]; curves: P3[][] }; eyes: { names: string[]; curves: P3[][] } }
  const pts: Pt[] = [], lns: Ln[] = [], taken = new Set(doc.points.map(p => p.name))
  const at = (p: P3, name: string) => { const q = pts.find(o => Math.hypot(o.p[0] - p[0], o.p[1] - p[1], o.p[2] - p[2]) < 0.02); if (q) return q.id
    let n = name; for (let i = 2; taken.has(n); i++) n = `${name}${i}`; taken.add(n); const id = doc.next++; pts.push({ id, name: n, p: [p[0], p[1], p[2]] }); return id }
  const line = (c: P3[], a: string, b: string, name: string) => lns.push({ id: doc.next++, name, a: at(c[0]!, a), b: at(c[3]!, b), c: c.map(p => [p[0], p[1], p[2]] as P3), own: true })
  W.meridian.curves.forEach((c, i) => line(c, W.meridian.names[i]!, W.meridian.names[i + 1]!, `${W.meridian.names[i]}—${W.meridian.names[i + 1]}`))
  W.latitude.curves.forEach(c => { const left = (c[1]![0] + c[2]![0]) / 2 < 0, front = c[0]![2] > 0; line(c, front ? '额前' : '后脑', front ? '后脑' : '额前', `纬线${left ? '左' : '右'}半`) })
  W.ear.curves.forEach((c, i) => { const side = c[0]![0] < 0 ? '左' : '右', k = i % 3, n = W.ear.names; line(c, side + n[k], side + n[k + 1], `${side}${n[k]}—${n[k + 1]}`) })
  W.eyes.curves.forEach(c => { const side = c[0]![0] < 0 ? '左' : '右', [inner, outer, mid] = W.eyes.names as [string, string, string]
    // each lid piece by its ends: 内眼角 → 外眼角 = 上眼睑, 外眼角 → 下眼睑中点 = 下眼睑外段, 下眼睑中点 → 内眼角 = 下眼睑内段
    const isIn = (p: P3) => Math.abs(p[0]) < 0.35, isMid = (p: P3) => p[1] < -0.6, nm = (p: P3) => side + (isMid(p) ? mid : isIn(p) ? inner : outer)
    const ends = [nm(c[0]!), nm(c[3]!)].map(s => s.slice(1)), piece = ends.includes(mid) ? (ends.includes(inner) ? '下眼睑内段' : '下眼睑外段') : '上眼睑'
    line(c, nm(c[0]!), nm(c[3]!), side + piece) })
  // a line's ends exactly on its points (two joints a hair apart became one point), the handles moved with them
  for (const l of lns) for (const [e, h, id] of [[0, 1, l.a], [3, 2, l.b]] as const) { const p = pts.find(q => q.id === id)!.p, dv = [0, 1, 2].map(k => p[k]! - l.c[e]![k]!); l.c[e] = [...p]; l.c[h] = l.c[h]!.map((v, k) => v + dv[k]!) as P3 }
  doc.points.push(...pts); doc.lines.push(...lns)
}
$('import').onclick = () => { snapshot(); importWire(); sel = { points: [], line: null }; changed() }
const doUndo = () => { const s = undo.pop(); if (!s) return; doc = JSON.parse(s) as Doc; sel = { points: [], line: null }; changed() }
$('undo').onclick = doUndo
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return
  if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey) { zoomTool = !zoomTool; cursor(); return }
  if (e.key === ' ') { e.preventDefault(); if (!space) { space = true; cursor() } return }
  if (e.key === 'F2' || e.key === 'Enter') { const p = sel.points.length === 1 ? pt(sel.points[0]!) : undefined, l = doc.lines.find(k => k.id === sel.line)
    if (p) { e.preventDefault(); rename(p, p.p) } else if (l) { e.preventDefault(); rename(l, cubic(l.c, 0.5)) } return }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return }
  const ARROW: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  if (ARROW[e.key]) { const step = e.shiftKey ? 10 : e.altKey ? 0.25 : 2, [dx, dy] = ARROW[e.key]!; if (nudge(dx * step, dy * step)) e.preventDefault(); return }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (!sel.points.length && sel.line === null) return; snapshot()
    if (sel.points.length) removePoints(sel.points); else { doc.lines = doc.lines.filter(l => l.id !== sel.line); sel.line = null } changed() }
})
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.onclick = () => { [yaw, pitch] = b.dataset.v!.split(',').map(Number) as [number, number]; draw() }
$('home').onclick = () => { zoom = 1; panX = 0; panY = 0; draw() }
for (const id of ['xray', 'wire', 'lnames']) $(id).addEventListener('change', draw)
$('save').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })); a.download = '头壳标注.json'; a.click(); URL.revokeObjectURL(a.href) }
$('openBtn').onclick = () => $('open').click()
$<HTMLInputElement>('open').onchange = async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; snapshot(); doc = JSON.parse(await f.text()) as Doc; sel = { points: [], line: null }; changed() }
window.addEventListener('resize', draw)
window.addEventListener('keyup', e => { if (e.key === ' ') { space = false; cursor() } })
;(window as unknown as { __shell: unknown }).__shell = { view: (y: number, p: number, z?: number) => { yaw = y; pitch = p; if (z) { zoom = z; panX = 0; panY = 0 } draw() }, doc: () => doc, sel: () => sel, nudge, snug, lift, off, nearestOnSkin, sight, hit, hug, changed: () => changed(), set: (d: Doc) => { doc = d; changed() } }

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
  const all = d.parts.flatMap(p => p.tris); ALL = new Float64Array(all.length * 3); all.forEach((v, i) => { for (let j = 0; j < 3; j++) ALL[3 * i + j] = d.P[v]![j]! })
  if (!stored) importWire() // a first visit starts from the lines we have
  changed()
})
list(); draw()
