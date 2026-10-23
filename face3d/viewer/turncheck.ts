// 转头检视 (dot 1792555714, bowen 1792555645): drag yaw −90 → 90 (the negative side mirrored) over bowen's level keyframes (0 / 45 / 90, the
// references re-aligned to one scale and 01's eye line, his lines carried over); in between the outline is the linear
// blend of the neighbouring keyframes and their references cross-fade. Fixed lines: 01's eye line, chin, crown — eyes and
// face must not jump up and down while turning. Data: bench-tasks/迁移/turncheck.json (made from the archives).
type V = [number, number]
type Key = { yaw: number; pts: Record<string, V>; lines: { name: string; a: string; b: string; ha: V; hb: V; side?: boolean }[]; ref: { src: string; x: number; y: number; w: number; h: number } }
// 眼睛 (bowen 1792682066): the 0° eye (near, x < 0) moved along its track and shaped by the sphere frame; per eye a table
// head yaw → [sphere yaw φ, track angle ψ]
type Eyes = { base: [V, V, V, V][]; anchor: V; z: number; r: number; near: [number, number, number][]; far: [number, number, number][] }
const all: { eye: number; chin: number; crown: number; ear?: number; temple?: number; variants: Record<string, Key[]>; circ?: Record<string, Record<string, [number, number, number]>>; circErr?: Record<string, Record<string, [number, number]>>; sheet?: Record<string, { theta45: number; pts: Record<string, V>; table?: [number, number][] }>; eyes?: Eyes; eyesBy?: Record<string, { near: [number, number, number][]; far: [number, number, number][] }> } = await (await fetch('/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/%E8%BF%81%E7%A7%BB/turncheck.json')).json()
// 远侧眼手调 (bowen 1792687412, dot 1792687438): the far eye's table can be hand-tuned here — only its track yaw ψ and
// sphere-frame yaw φ, per head yaw; saved as bench-tasks/迁移/far-eye-keys.json (rows [head yaw, φ, ψ]) through the local
// receiver, which backs the previous file up. Everything else stays locked.
const FARKEYS = '/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/%E8%BF%81%E7%A7%BB/far-eye-keys.json'
// (bowen 1792688292) the far eye moves sideways freely — rows [head yaw, sphere yaw φ, centre x]; a table or file still
// in track form ([.., ψ]) is converted with the track (x = −anchor.x·cos ψ + z·sin ψ), so it looks the same
const trackX = (psi: number) => (all.eyes ? -all.eyes.anchor[0] * Math.cos((psi * Math.PI) / 180) + all.eyes.z * Math.sin((psi * Math.PI) / 180) : 0)
const toX = (rows: [number, number, number][]) => rows.map(r => [r[0], r[1], +trackX(r[2]).toFixed(2)] as [number, number, number])
const saved = await fetch(FARKEYS + '?t=' + Date.now()).then(r => (r.ok ? r.json() : null)).catch(() => null)
let farRows: [number, number, number][] = saved?.rows ? (saved.mode === 'x' ? saved.rows : toX(saved.rows)) : all.eyes ? toX(all.eyes.far) : []
const farUndo: [number, number, number][][] = []
let farPreview: [number, number] | null = null   // slider values at the current head yaw, not yet recorded
// variants: 原始迁移 (the migrated copies) and 颅顶统一到 01 (level crowns at 01's height, x / cheeks / jaw kept; dot 1792556341)
const varSel = document.getElementById('var') as HTMLSelectElement
for (const n of Object.keys(all.variants)) varSel.add(new Option(n, n))
let data = { ...all, keys: all.variants[varSel.value]! }
// each variant brings its own references (the shared-scale version re-aligned them): images per variant
const load = (keys: Key[]) => Promise.all(keys.map(k => new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = k.ref.src })))
const imgsBy: Record<string, HTMLImageElement[]> = {}
for (const [n, keys] of Object.entries(all.variants)) imgsBy[n] = await load(keys)
let imgs = imgsBy[varSel.value]!
const cv = document.getElementById('c') as HTMLCanvasElement, g = cv.getContext('2d')!
const outerIn = document.getElementById('outer') as HTMLInputElement, yawIn = document.getElementById('yaw') as HTMLInputElement, refIn = document.getElementById('ref') as HTMLInputElement, marksIn = document.getElementById('marks') as HTMLInputElement
const Z = 3.4, OX = cv.width / 2, OY = cv.height * 0.55 // canvas units → screen
const P = (p: V): V => [OX + p[0] * Z, OY + p[1] * Z]
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
// −90 … 90 (bowen 1792603165, 1792634536): a turn to the other side is the mirror of the same turn — near (the ear side,
// two lines) and far (three lines) change sides at 0°, where the symmetric 01 makes them meet
const MX = (p: V): V => [-p[0], p[1]]
// 平滑插值 (bowen 1792761917, 1792762034: like a turn — each stretch eases into the next one's speed): per coordinate a cubic
// through the keyframes whose speed is continuous; at an inner keyframe the speed is the next stretch's mean speed (0 where the
// direction changes), the last stretch keeps its mean speed, and the first stretch starts at 2·its mean − that speed — so
// 0 → 45° goes fast then slow and meets 45 → 90° exactly. Keyframes stay as drawn; off = piecewise linear
function smoothAt(ys: number[], vs: number[], x: number): number {
  const n = ys.length; if (n < 3) { const t = (x - ys[0]!) / (ys[1]! - ys[0]!); return vs[0]! + (vs[1]! - vs[0]!) * t }
  const h = ys.slice(1).map((y, j) => y - ys[j]!), s = h.map((hj, j) => (vs[j + 1]! - vs[j]!) / hj), m = new Array<number>(n)
  m[n - 1] = s[n - 2]!
  for (let j = n - 2; j >= 1; j--) m[j] = s[j - 1]! * s[j]! > 0 ? s[j]! : 0
  m[0] = 2 * s[0]! - m[1]!
  if (s[0]! === 0) m[0] = 0; else if (m[0]! / s[0]! < 0) m[0] = 0; else if (m[0]! / s[0]! > 3) m[0] = 3 * s[0]!
  let i = ys.findIndex(y => y >= x) - 1; i = Math.max(0, Math.min(n - 2, i))
  const t = (x - ys[i]!) / h[i]!, t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * vs[i]! + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * vs[i + 1]! + (t3 - t2) * h[i]! * m[i + 1]!
}
const smoothV = (keys: Key[], get: (k: Key) => V, x: number): V => { const ys = keys.map(k => k.yaw), a = keys.map(get); return [smoothAt(ys, a.map(p => p[0]), x), smoothAt(ys, a.map(p => p[1]), x)] }
function draw() {
  // any number of keyframes (粗调: 0 / 25 / 34 / 45 / 50 / 61 / 75 / 90): the pair around the yaw
  const yaw = +yawIn.value, ay = Math.abs(yaw), flip = yaw < 0, i = Math.max(0, Math.min(data.keys.length - 2, data.keys.findIndex(k => k.yaw >= ay) - 1)), A = data.keys[i]!, B = data.keys[i + 1]!, t = (ay - A.yaw) / (B.yaw - A.yaw)
  const F = (p: V): V => (flip ? MX(p) : p)
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height)
  if (refIn.checked) for (const [k, a] of [[i, 1 - t], [i + 1, t]] as const) {
    if (a < 0.02) continue
    const r = data.keys[k]!.ref, x = F([r.x, r.y])[0]
    g.save(); g.globalAlpha = 0.55 * a; g.translate(OX + x * Z, OY + r.y * Z); if (flip) g.scale(-1, 1)
    g.drawImage(imgs[k]!, (-r.w / 2) * Z, (-r.h / 2) * Z, r.w * Z, r.h * Z); g.restore()
  }
  g.globalAlpha = 1
  const fixed: [number, string, string][] = [[data.crown, '#7a00ff', '颅顶 −82.2'], [data.eye, '#e07000', '01 眼线'], [data.chin, '#00a651', '下巴 65']]
  if (all.ear !== undefined) fixed.push([all.ear, '#e00078', `耳根 / 颧骨点 ${all.ear}`])
  if (all.temple !== undefined) fixed.push([all.temple, '#3a7bd5', `太阳穴点 ${all.temple.toFixed(1)}`])
  for (const [y, c, lab] of fixed) { g.strokeStyle = c; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, OY + y * Z); g.lineTo(cv.width, OY + y * Z); g.stroke(); g.fillStyle = c; g.fillText(lab, 6, OY + y * Z - 4) }
  g.setLineDash([]); g.strokeStyle = '#111'; g.lineWidth = 2.5
  const smooth = (document.getElementById('smooth') as HTMLInputElement | null)?.checked ?? true
  const pts: Record<string, V> = {}; for (const k in A.pts) pts[k] = smooth ? smoothV(data.keys, key => key.pts[k]!, ay) : lerp(A.pts[k]!, B.pts[k]!, t)
  // the circular variant (bowen 1792601957, dot 1792602067): a point at front offset x0 and depth R turning about the
  // vertical axis: x = x0·cos + R·sin, its height kept (dot 1792602159) — instead of the piecewise blend
  for (const [id, [x0, R, y]] of Object.entries(all.circ?.[varSel.value] ?? {})) { const r = (ay * Math.PI) / 180; pts[id] = [x0 * Math.cos(r) + R * Math.sin(r), y] }
  // 侧脸平片 (bowen 1792674653): the side face is one flat sheet in the middle plane — a sheet point is its depth d (its x at
  // 90°) and its height; at yaw it sits at x = d·sin θ, θ the sheet's angle (θ45 from bowen's 45°, piecewise linear 0 → θ45 → 90);
  // a handle at a sheet point is 90°'s handle with its x squeezed the same way. Crown and chin follow the outline
  let eyeText = ''
  const sh = data.sheet?.[varSel.value]
  // the sheet's angle: its own table when it has one (粗调), else 0 → θ45 → 90
  const thAt = (a: number) => !sh ? 0 : sh.table ? (() => { const tb = sh.table!, k = Math.max(1, tb.findIndex(r => r[0] >= a)), p = tb[k - 1]!, q = tb[k]!; return p[1] + ((q[1] - p[1]) * (a - p[0])) / (q[0] - p[0]) })()
    : a <= 45 ? (a * sh.theta45) / 45 : sh.theta45 + ((a - 45) * (90 - sh.theta45)) / 45
  const thDeg = thAt(ay)
  const th = (thDeg * Math.PI) / 180
  const K90 = data.keys[data.keys.length - 1]!
  // 刚性平片 (bowen 1792762758): the side face is one rigid sheet through the turning axis — every sheet point, the crown and the
  // chin included (shared with the outline, which takes them from here), and every sheet handle at x = d·sin θ, d its x at 90°,
  // height kept. Replaces the crown / chin progress and the per-frame plane (bowen 1792762417 / 1792762575)
  const SHEET: Record<string, V> = sh ? { ...sh.pts, 'pmv6kklw1-11': K90.pts['pmv6kklw1-11']!, 'pmv6kklw1-2': K90.pts['pmv6kklw1-2']! } : {}
  const OUTLINE_SHARED: Record<string, string> = { 'cmv3m1am1-6/pmv3m1am1-4': 'pmv6kklw1-11', 'cmv3m1am1-6/pmv3m1am1-2': 'pmv6kklw1-2' }
  if (sh) { for (const [id, [d, y]] of Object.entries(SHEET)) pts[id] = [d * Math.sin(th), y]; for (const [o, sid] of Object.entries(OUTLINE_SHARED)) if (pts[o]) pts[o] = pts[sid]! }
  // 山根 at 90° (bowen 1792767860): the deepest point (smallest depth d) of the side face line 眉心 (pmv6kklw1-9) – 鼻尖 (pmv6kklw1-7)
  const bridge90 = (() => { const l = sh && K90.lines.find(x => [x.a, x.b].sort().join() === 'pmv6kklw1-7,pmv6kklw1-9'); if (!l) return null
    const a = SHEET[l.a]!, b = SHEET[l.b]!, c: V[] = [a, [a[0] + l.ha[0], a[1] + l.ha[1]], [b[0] + l.hb[0], b[1] + l.hb[1]], b]
    let mn = Infinity; for (let i = 0; i <= 200; i++) { const t = i / 200, u = 1 - t; mn = Math.min(mn, u * u * u * c[0]![0] + 3 * u * u * t * c[1]![0] + 3 * u * t * t * c[2]![0] + t * t * t * c[3]![0]) }
    return mn })()
  const thirdsOn = () => !!(document.getElementById('thirds') as HTMLInputElement | null)?.checked
  // lines matched by their end points across the keys (the names follow the files); each as its screen Bézier
  type Bz = { side: boolean; a: string; b: string; c: [V, V, V, V] }
  const bz: Bz[] = A.lines.map(l => { const m = B.lines.find(x => x.a === l.a && x.b === l.b)!, n = K90.lines.find(x => x.a === l.a && x.b === l.b)!, a = pts[l.a]!, b = pts[l.b]!
    const onSheet = (id: string) => !!sh && id in SHEET, sq = (h: V): V => [h[0] * Math.sin(th), h[1]]
    const same = (key: Key) => key.lines.find(x => x.a === l.a && x.b === l.b)!
    const ha = onSheet(l.a) && l.side ? sq(n.ha) : smooth ? smoothV(data.keys, key => same(key).ha, ay) : lerp(l.ha, m.ha, t)
    const hb = onSheet(l.b) && l.side ? sq(n.hb) : smooth ? smoothV(data.keys, key => same(key).hb, ay) : lerp(l.hb, m.hb, t)
    return { side: !!l.side, a: l.a, b: l.b, c: [P(F(a)), P(F([a[0] + ha[0], a[1] + ha[1]])), P(F([b[0] + hb[0], b[1] + hb[1]])), P(F(b))] } })
  const stroke = (q: Bz) => { g.beginPath(); g.moveTo(...q.c[0]); g.bezierCurveTo(...q.c[1], ...q.c[2], ...q.c[3]); g.stroke() }
  // 真·外轮廓 (bowen 1792671397, 1792675303): the same implicit rule as bench — the outline's lines and the side face's lines
  // each closed into a region; each is drawn only outside the other's region, the hidden part thin grey
  const near = (p: V, q: V) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5
  const region = (ls: Bz[]): Path2D | null => {
    if (ls.length < 2) return null
    const left = [...ls], first = left.shift()!, path = new Path2D(); path.moveTo(...first.c[0]); path.bezierCurveTo(...first.c[1], ...first.c[2], ...first.c[3])
    let end = first.c[3]
    while (left.length) { const i = left.findIndex(q => near(q.c[0], end) || near(q.c[3], end)); if (i < 0) return null
      const q = left.splice(i, 1)[0]!, c = near(q.c[0], end) ? q.c : ([...q.c].reverse() as Bz['c']); path.bezierCurveTo(...c[1], ...c[2], ...c[3]); end = c[3] }
    path.closePath(); return near(end, first.c[0]) ? path : null
  }
  const faceR = region(bz.filter(q => !q.side)), sideR = region(bz.filter(q => q.side)), outer = outerIn.checked && faceR && sideR
  // 眼睛 (bowen 1792682066): position = the eye centre on its track (x = x0·cos ψ + z·sin ψ, height kept), shape = the bench
  // sphere frame (deform/index.ts sphereField, yaw only) on the 0° eye; φ, ψ linear in head yaw between the table's rows.
  // The far eye is hidden where it lies inside the side face's region (bench 隐式遮挡), drawn thin grey there
  const E = all.eyes && { ...all.eyes, ...(all.eyesBy?.[varSel.value] ?? {}), ...(varSel.value.startsWith('侧脸平片') ? { far: farRows } : {}) }
  if (E) {
    const at = (tab: [number, number, number][]) => { const k = tab.findIndex(r => r[0] >= ay); if (k <= 0) return tab[0]!.slice(1) as [number, number]
      const a = tab[k - 1]!, b = tab[k]!, u = (ay - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u] as [number, number] }
    const eyePath = (far: boolean) => {
      // the far eye of 侧脸平片 by its hand-tuned table: [φ, centre x]; the others by their track [φ, ψ]
      const freeX = far && varSel.value.startsWith('侧脸平片')
      // 拟合公式（对照, bowen 01:09 keys, 2026-10-23）: |φ| = 9.69·√yaw (0–75°, ±2.5), x = 28.56 + 47.8·sin yaw (0–90°, ±2.4)
      const fitted: [number, number] = [-9.69 * Math.sqrt(ay), 28.56 + 47.8 * Math.sin((ay * Math.PI) / 180)]
      // the hand-tuned far eye eases between its keyframes like the outline (平滑插值, bowen 1792762956)
      const farSmooth = (): [number, number] => { const r = E.far, ys = r.map(q => q[0]); return [smoothAt(ys, r.map(q => q[1]), ay), smoothAt(ys, r.map(q => q[2]), ay)] }
      const [phi, psi] = freeX && farPreview ? farPreview : freeX && (document.getElementById('ffit') as HTMLInputElement | null)?.checked ? fitted : freeX && smooth ? farSmooth() : at(far ? E.far : E.near), f = (phi * Math.PI) / 180, w = (psi * Math.PI) / 180, m = far ? -1 : 1
      const ax = freeX ? psi : m * E.anchor[0] * Math.cos(w) + E.z * Math.sin(w)
      const map = (p: V): V => { const qx = m * (p[0] - E.anchor[0]), qy = p[1] - E.anchor[1], z2 = Math.max(0, E.r * E.r - qx * qx - qy * qy)
        return [ax + Math.cos(f) * qx + Math.sin(f) * (Math.sqrt(z2) - E.r), p[1]] }
      const samples: V[][] = (E.base as [V, V, V, V][]).map(c => Array.from({ length: 31 }, (_, i) => { const t = i / 30, u = 1 - t
        return [u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0], u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1]] as V }))
      let pts2 = samples.map(row => row.map(map))
      // 眼睛：透视三等分 (bowen 1792765123, 1792765388, 1792767860): 0° near eye : gap : far eye = 1 : 1 : 1 (third L = 28.38, his
      // 0°); turning, the four corners stay perspective thirds — x = c + u·a / (1 + u·b), u = −1.5 … 1.5, b = k·L·sin ψ with
      // k = 0.009 (his 45°; dot's 12 free pictures give 0.0091). Up to 50° the eye line turns: c = D·sin ψ (D = 70.34, his 45°),
      // a = L·cos ψ. That spacing would close to 0 at 90°, but at 90° bowen draws the near eye one part wide with its inner corner
      // half a part from 山根 (the deepest point of the side face between 眉心 and 鼻尖) — his hand-tuned 90° near eye is exactly
      // that with the same k: c = 山根, a = 10.49 (corners 73.2 / 53.7 vs his 73.1 / 53.7). So 50 → 90° c and a ease (cubic,
      // speed kept at 50°, standing still at 90°, the turn's extreme) into those values. Each eye: the 0° eye bent by the sphere
      // frame (near with the head, far against), its yaw solved so that the eye scaled by its perspective (width b, height b/3)
      // spans exactly its two corners (dot 1792765449: not a second narrowing), put on the corners' middle. The eyes keep
      // their thirds even outside the face; the outer silhouette clips what shows (below)
      let solved: number | null = null
      if (thirdsOn()) {
        const L = 28.38, K = 0.009, D = 70.34, A90 = 10.49, P0 = 50, ps = (ay * Math.PI) / 180, b = K * L * Math.sin(ps)
        const law = (d: number): [number, number] => { const r = (d * Math.PI) / 180; return [D * Math.sin(r), L * Math.cos(r)] }
        const herm = (v0: number, m0: number, v1: number, t: number) => (2 * t ** 3 - 3 * t ** 2 + 1) * v0 + (t ** 3 - 2 * t ** 2 + t) * m0 + (-2 * t ** 3 + 3 * t ** 2) * v1
        const [cx, sp] = ay <= P0 || bridge90 === null ? law(ay) : (() => { const t = (ay - P0) / (90 - P0), h = ((90 - P0) * Math.PI) / 180, [c0v, a0v] = law(P0), r0 = (P0 * Math.PI) / 180
          return [herm(c0v, D * Math.cos(r0) * h, bridge90, t), herm(a0v, -L * Math.sin(r0) * h, A90, t)] as [number, number] })()
        const X = (u: number) => cx + (u * sp) / (1 + u * b)
        const [uo, ui] = far ? [1.5, 0.5] : [-1.5, -0.5], mid = (X(uo) + X(ui)) / 2, uc = (uo + ui) / 2
        const sw = 1 / (1 + uc * b), sh2 = 1 / (1 + (uc * b) / 3)
        const c0 = (E.base as [V, V, V, V][])[0]!, target = Math.abs(X(uo) - X(ui)) / sw
        const relAt = (f2: number) => (p: V): V => { const qx = m * (p[0] - E.anchor[0]), qy = p[1] - E.anchor[1], z2 = Math.max(0, E.r * E.r - qx * qx - qy * qy); return [Math.cos(f2) * qx + Math.sin(f2) * (Math.sqrt(z2) - E.r), qy] }
        const width = (f2: number) => { const r = relAt(f2); return Math.abs(r(c0[3]!)[0] - r(c0[0]!)[0]) }
        let lo = 0, hi = Math.PI / 2 - 1e-3
        for (let it = 0; it < 40; it++) { const md = (lo + hi) / 2; if (width(far ? -md : md) > target) lo = md; else hi = md }
        const rel = relAt(far ? -lo : lo), cm = (rel(c0[0]!)[0] + rel(c0[3]!)[0]) / 2
        pts2 = samples.map(row => row.map(p => { const r2 = rel(p); return [mid + (r2[0] - cm) * sw, E.anchor[1] + r2[1] * sh2] as V }))
        solved = ((far ? -lo : lo) * 180) / Math.PI
      }
      const path = new Path2D()
      for (const row of pts2) row.forEach((q, i) => { const s2 = P(F(q)); i ? path.lineTo(...s2) : path.moveTo(...s2) })
      return { path, phi: solved ?? phi, psi, thirds: solved !== null }
    }
    const near = eyePath(false), far = eyePath(true)
    if (near.thirds && outerIn.checked && (faceR || sideR)) {
      // the eyes keep their thirds layout; what shows is clipped by the outer silhouette — the face outline and the side face
      // together (bowen 1792767860), the rest thin grey
      for (const e of [near, far]) { g.strokeStyle = '#b8b8b8'; g.lineWidth = 1; g.stroke(e.path)
        for (const R of [faceR, sideR]) if (R) { g.save(); g.clip(R); g.strokeStyle = '#7a3b00'; g.lineWidth = 1.8; g.stroke(e.path); g.restore() } }
    } else if (near.thirds) { g.strokeStyle = '#7a3b00'; g.lineWidth = 1.8; g.stroke(near.path); g.stroke(far.path) }
    else { g.strokeStyle = '#7a3b00'; g.lineWidth = 1.8; g.stroke(near.path) }
    if (near.thirds) { /* drawn above */ } else if (outerIn.checked && sideR) {
      g.strokeStyle = '#b8b8b8'; g.lineWidth = 1; g.stroke(far.path)
      // shown only inside the face outline (bowen 1792686822: the part poking out is not drawn) and outside the side face
      const clip = new Path2D(); clip.rect(0, 0, cv.width, cv.height); clip.addPath(sideR)
      g.save(); if (faceR) g.clip(faceR); g.clip(clip, 'evenodd'); g.strokeStyle = '#7a3b00'; g.lineWidth = 1.8; g.stroke(far.path); g.restore()
    } else { g.strokeStyle = '#7a3b00'; g.lineWidth = 1.8; g.stroke(far.path) }
    eyeText = ` · 眼睛 近 球${near.phi.toFixed(0)}° 轨${near.psi.toFixed(1)}° / 远 球${far.phi.toFixed(0)}° ${varSel.value.startsWith('侧脸平片') ? 'x ' + far.psi.toFixed(1) : '轨' + far.psi.toFixed(1) + '°'}`
  }
  for (const q of bz) {
    const other = q.side ? faceR : sideR, colour = q.side && !outer ? '#1565ff' : '#111'
    if (!outer || !other) { g.strokeStyle = colour; g.lineWidth = q.side ? 1.8 : 2.5; stroke(q); continue }
    g.strokeStyle = '#b8b8b8'; g.lineWidth = 1; stroke(q)
    // outside the other region: a clip of the whole canvas minus that region (even-odd)
    const clip = new Path2D(); clip.rect(0, 0, cv.width, cv.height); clip.addPath(other)
    g.save(); g.clip(clip, 'evenodd'); g.strokeStyle = colour; g.lineWidth = 2.5; stroke(q); g.restore()
  }
  g.strokeStyle = '#111'; g.lineWidth = 2.5
  // the endpoints (bowen 1792602867; names bowen 1792634536): crown, chin, near ear root; far 颧骨点, 太阳穴点
  const marks: [string, string, string][] = [['cmv3m1am1-6/pmv3m1am1-4', '#7a00ff', '颅顶'], ['cmv3m1am1-6/pmv3m1am1-2', '#00a651', '下巴'], ['cmv3m1am1-6/pmv3m1am1-1', '#e00078', '耳根'], ['pmv3m1am1-1', '#333', '颧骨点'], ['pm03-skf', '#3a7bd5', '太阳穴点'], ['pm03-skb', '#e00', '后切点']]
  if (marksIn.checked) for (const [id, c, lab] of marks) { const p = pts[id]; if (!p) continue; const [x, y] = P(F(p)); g.fillStyle = c; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.font = '12px system-ui'; g.fillText(lab, x + 7, y - 6) }
  const cr = pts['cmv3m1am1-6/pmv3m1am1-4']!, ch = pts['cmv3m1am1-6/pmv3m1am1-2']!
  const sheetText = sh ? ` · 侧脸平片 θ ${((th * 180) / Math.PI).toFixed(1)}°` : ''
  const err = all.circErr?.[varSel.value], errText = err ? ' · 圆周与关键帧之差（45° / 90°）' + Object.entries(err).map(([n, [a, b]]) => `${n} ${a.toFixed(1)} / ${b.toFixed(1)}`).join('，') : ''
  document.getElementById('yv')!.textContent = `${yaw}°`
  document.getElementById('info')!.textContent = `颅顶 y ${cr[1].toFixed(1)} · 下巴 y ${ch[1].toFixed(1)} · 关键帧 ${flip ? '−' : ''}${A.yaw}° / ${flip ? '−' : ''}${B.yaw}°（${(t * 100).toFixed(0)}%${flip ? '，镜像' : ''}）${sheetText}${eyeText}${errText}`
}
yawIn.oninput = draw; refIn.onchange = draw; marksIn.onchange = draw; outerIn.onchange = draw; (document.getElementById("smooth") as HTMLInputElement).onchange = draw
varSel.onchange = () => { data = { ...all, keys: all.variants[varSel.value]! }; imgs = imgsBy[varSel.value]!; draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-k]')) b.onclick = () => { yawIn.value = b.dataset.k!; draw() }
draw()

// ---- 远侧眼手调 panel ---------------------------------------------------------------------------------------------
const panel = document.getElementById('fareye')!
panel.innerHTML = `<b>远侧眼手调</b>（只对「侧脸平片」版本；只改远侧眼的两个量：眼睛中心的横向位置、球面 yaw；关键帧之间线性插值）<br>
  横向位置 x <input id="fpsi" type="range" min="0" max="110" step="0.1" style="width:260px"> <input id="fpsiN" type="number" step="0.1" style="width:70px">
  球面 yaw <input id="fphi" type="range" min="-180" max="0" step="0.5" style="width:260px"> <input id="fphiN" type="number" step="0.5" style="width:70px"><br>
  <button id="frec">记为这个角度的关键帧</button> <button id="fdel">删掉这个角度的关键帧</button> <button id="fundo">撤销</button> <button id="fsave">保存到文件</button>
  <label title="不改你的关键帧，只是显示用拟合公式算的远侧眼：|球面 yaw| = 9.69·√头yaw，x = 28.56 + 47.8·sin 头yaw"><input id="ffit" type="checkbox"> 显示拟合公式（对照）</label>
  <label title="两只眼按透视三等分摆放（0–90°），远近眼按透视放大缩小，眼形用球面框；脸轮廓 + 侧脸的外轮廓裁剪；不勾 = 原来的表和手调"><input id="thirds" type="checkbox" checked> 眼睛：透视三等分</label>
  <span id="fmsg" style="color:#555"></span><div id="ftab" style="color:#333;margin-top:4px"></div>`
const $ = (id: string) => document.getElementById(id) as HTMLInputElement
const curYaw = () => Math.round(Math.abs(+yawIn.value) * 2) / 2
const interp = (ay: number): [number, number] => { const ys = farRows.map(r => r[0]); return farRows.length < 2 ? [farRows[0]![1], farRows[0]![2]] : [smoothAt(ys, farRows.map(r => r[1]), ay), smoothAt(ys, farRows.map(r => r[2]), ay)] }
const showTab = () => { $('ftab').textContent = '关键帧（头 yaw：球面 yaw / 横向 x）　' + farRows.map(r => `${r[0]}°：${r[1]} / ${r[2]}`).join('　') }
const syncSliders = () => { const [phi, psi] = farPreview ?? interp(curYaw()); $('fphi').value = $('fphiN').value = String(+phi.toFixed(2)); $('fpsi').value = $('fpsiN').value = String(+psi.toFixed(2)) }
const preview = (phi: number, psi: number) => { farPreview = [phi, psi]; $('fphi').value = $('fphiN').value = String(phi); $('fpsi').value = $('fpsiN').value = String(psi); $('fmsg').textContent = `预览 ${curYaw()}°（还没记录）`; draw() }
for (const id of ['fphi', 'fphiN']) $(id).oninput = () => preview(+$(id).value, +$('fpsi').value)
for (const id of ['fpsi', 'fpsiN']) $(id).oninput = () => preview(+$('fphi').value, +$(id).value)
const push = () => { farUndo.push(farRows.map(r => [...r] as [number, number, number])) }
$('frec').onclick = () => { const ay = curYaw(), [phi, psi] = farPreview ?? interp(ay); push(); farRows = [...farRows.filter(r => r[0] !== ay), [ay, +phi.toFixed(2), +psi.toFixed(2)] as [number, number, number]].sort((x, y) => x[0] - y[0]); farPreview = null; $('fmsg').textContent = `已记录 ${ay}°（没保存）`; showTab(); draw() }
$('fdel').onclick = () => { const ay = curYaw(); if (ay === 0 || ay === 90 || !farRows.some(r => r[0] === ay)) { $('fmsg').textContent = ay === 0 || ay === 90 ? '0° 和 90° 不能删' : `${ay}° 没有关键帧`; return } push(); farRows = farRows.filter(r => r[0] !== ay); farPreview = null; $('fmsg').textContent = `已删掉 ${ay}°（没保存）`; showTab(); syncSliders(); draw() }
$('fundo').onclick = () => { const prev = farUndo.pop(); if (!prev) { $('fmsg').textContent = '没有可撤销的'; return } farRows = prev; farPreview = null; $('fmsg').textContent = '已撤销（没保存）'; showTab(); syncSliders(); draw() }
$('fsave').onclick = async () => { const r = await fetch('http://127.0.0.1:5199/save?name=far-eye-keys.json', { method: 'POST', body: JSON.stringify({ note: '远侧眼手调 rows [head yaw, sphere yaw φ, centre x]', mode: 'x', saved: new Date().toISOString(), rows: farRows }, null, 1) }).then(x => x.text()).catch(e => 'error ' + e)
  $('fmsg').textContent = r === 'ok' ? '已保存（如有旧文件，已备份到 bench-tasks/备份/）' : '保存失败：' + r }
yawIn.addEventListener('input', () => { farPreview = null; syncSliders(); draw() })
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-k]')) b.addEventListener('click', () => { farPreview = null; syncSliders(); draw() })
showTab(); syncSliders()

$('ffit').onchange = () => { farPreview = null; draw() }
$('thirds').onchange = () => { farPreview = null; draw() }
