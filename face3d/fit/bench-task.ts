// One bench task per modelling view (bowen 1792514344 / 1792514364 / 1792514440; dot 1792514373 / 1792514469): a NEW
// bench archive (current format, bench's meta-lines untouched) for bowen to fine-tune the face outline at one B view
// (camera yaw / pitch) against a generated line drawing, plus a notes file beside it.
//   reference picture (view 0,0): the drawing, registered to the exact-angle VRoid render by its lower face, redrawn:
//     the strokes to match (the drawing's cheek / jaw / chin lines next to the render's contour) RED, the rest of the
//     drawing light grey, the render's cranium outline (hidden under the drawing's hair) BLUE as a guide, the head ball
//     faint; placed so the head-ball centre is the canvas origin at 82 canvas px per head-ball radius;
//   face outline (layer 脸轮廓, its 4 lines 左颅 / 右颅 / 左下颌 / 右下颌 and 4 points): a first automatic match to the red
//     strokes and the blue cranium guide (cubics fitted with their end points fixed), the same in all nine views;
//     points drawn wider; every other line hidden. Template: bowen's 123.json (read only); its playback responses of
//     the four controls dropped so the outline does not change while scrubbing.
// Run: npx vite-node face3d/fit/bench-task.ts <drawing.png> <yaw> <pitch> <out-dir> [template.json]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { open, save } from '../../../headset-core/src/archive/index'
import { rotate } from '../src/view'
import { controlsAt, LINES } from './outline-sym'
import { C, CX, CY, S, darkDT, readBmp, register, renderContour, toDrawing, writeBmp } from './lineart'

type P = [number, number]
const [drawing, yawA, pitchA, outDir, template] = process.argv.slice(2)
const yaw = Number(yawA), pitch = Number(pitchA), name = `B-yaw${yaw}-pitch${pitch}`
// never overwrite an archive (bowen may have fine-tuned it; dot 1792518618): a rebuild goes to a new folder
if (existsSync(`${outDir}/${name}.json`)) { console.error(`refused: ${outDir}/${name}.json exists — use a new out-dir`); process.exit(1) }
mkdirSync(outDir!, { recursive: true })
const tmp = `${outDir}/.${name}-drawing.bmp`
execFileSync('sips', ['-s', 'format', 'bmp', drawing!, '--out', tmp], { stdio: 'ignore' })
const D = readBmp(tmp), dt = darkDT(D), { segs, band, redLow, redLowFront, chin } = renderContour({ yaw, pitch }), reg = register(D, dt, band, process.env.SCALE ? Number(process.env.SCALE) : undefined, process.env.SHIFT ? (process.env.SHIFT.split(',').map(Number) as [number, number]) : undefined)

// ---- targets (render px): the drawing's dark pixels next to the render's lower contour; the render's cranium contour
// the drawing's strokes are matched only along the render's jaw band (cheek under the eyes → chin, on the head; the far
// eye, hair and neck are not in it); the cranium and the back of the head are hair in the drawing, so the render's
// contour outside the band is the guide there (blue)
// near: render px within 6 of the band contour → the direction of the nearest contour piece (radians, mod π)
const near = new Map<number, { a: number; d: number }>(), bandKeys = new Set<string>(band.map(s => s.join(',')))
// turned views (yaw ≥ 30): the far side behind the ear is left blank (hair tips there), marked 待判断 in the notes
const redBand = yaw >= 30 ? redLowFront : redLow
for (const [x0, y0, x1, y1] of redBand) { const a = Math.atan2(y1 - y0, x1 - x0); for (let i = 0; i <= 6; i++) { const x = x0 + ((x1 - x0) * i) / 6, y = y0 + ((y1 - y0) * i) / 6; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const k = Math.round(y + dy) * C + Math.round(x + dx), d = dx * dx + dy * dy, o = near.get(k); if (!o || d < o.d) near.set(k, { a, d }) } } }
// a stroke counts only if it runs along the contour next to it (within 30°): bowen's 01 followed the real cheek line,
// while the red had also taken the ear lobe (across) and the neck lines (down) (bowen 1792552021, dot 1792552296).
// The drawing's stroke direction = across its darkness gradient, from the structure tensor over 7×7 drawing px
const lum = (X: number, Y: number) => { const [r, g, b] = D.px(Math.max(0, Math.min(D.W - 1, X)), Math.max(0, Math.min(D.H - 1, Y))); return 0.299 * r + 0.587 * g + 0.114 * b }
const strokeDir = (X: number, Y: number) => {
  let xx = 0, yy = 0, xy = 0; const cx = Math.round(X), cy = Math.round(Y)
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const gx = lum(cx + i + 1, cy + j) - lum(cx + i - 1, cy + j), gy = lum(cx + i, cy + j + 1) - lum(cx + i, cy + j - 1); xx += gx * gx; yy += gy * gy; xy += gx * gy }
  return 0.5 * Math.atan2(2 * xy, xx - yy) + Math.PI / 2 // gradient orientation + 90° = along the stroke
}
const along = (a: number, b: number) => { let d = Math.abs(a - b) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d; return d < Math.PI / 6 }
const redAt = (x: number, y: number) => {
  const o = near.get(Math.floor(y) * C + Math.floor(x)); if (!o) return false
  const [X, Y] = toDrawing(reg, x, y); return dt.at(X, Y) < 0.5 && along(strokeDir(X, Y), o.a)
}
// looking up (pitch > 0): no red at all — the strokes next to the render's jaw are the neck lines, ear lobes and hair
// tips there, while the drawing's own chin arc and cheek lines lie apart from it (dot 1792552759); the jaw lines are not
// refit either
const noRed = pitch > 0
const lowerT: P[] = [], craniumT: P[] = []
if (!noRed) for (const k of near.keys()) { const x = k % C, y = Math.floor(k / C); if (x >= 0 && x < C && redAt(x + 0.5, y + 0.5)) lowerT.push([x, y]) }
// the guide: the render's contour outside the band, above the jaw (the neck below the chin left out)
for (const sg of segs) { if (bandKeys.has(sg.join(','))) continue; const [x0, y0, x1, y1] = sg; for (let i = 0; i <= 3; i++) { const x = x0 + ((x1 - x0) * i) / 3, y = y0 + ((y1 - y0) * i) / 3; if (y < chin[1] - 4 || Math.hypot(x - CX, y - CY) < S * 1.05) craniumT.push([x, y]) } }

// ---- the highlighted reference picture, 3× the render frame plus a margin of C/4 all round (the frame alone cut the
// drawing ~25 canvas px under the chin; bowen 1792550374)
const UP = 3, M = C / 4, W = (C + 2 * M) * UP
const segPix = new Set<number>()
for (const sg of segs) { if (bandKeys.has(sg.join(','))) continue; const [x0, y0, x1, y1] = sg; if (Math.max(y0, y1) >= chin[1] - 4 && Math.hypot((x0 + x1) / 2 - CX, (y0 + y1) / 2 - CY) >= S * 1.05) continue; const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * UP * 2) + 1; for (let i = 0; i <= n; i++) { const X = Math.round((x0 + ((x1 - x0) * i) / n + M) * UP), Y = Math.round((y0 + ((y1 - y0) * i) / n + M) * UP); for (let d = -1; d <= 1; d++) { segPix.add(Y * W + X + d); segPix.add((Y + d) * W + X) } } }
const nearUp = (x: number, y: number) => x >= 0 && y >= 0 && x < C && y < C && redAt(x, y)
const pic = writeBmp(W, W, (X, Y) => {
  const x = (X + 0.5) / UP - M, y = (Y + 0.5) / UP - M, r = Math.hypot(x - CX, y - CY)
  if (segPix.has(Y * W + X)) return [30, 110, 230]
  const [dX, dY] = toDrawing(reg, x, y)
  if (dt.at(dX, dY) < 0.6) return !noRed && nearUp(x, y) ? [225, 30, 30] : [140, 140, 140]
  // light lines (luminance 110 … 200) too, in a lighter grey that still reads: the looking-up drawings draw the chin's
  // outer edge thin and light, and the dark-only picture had dropped it (dot 1792552701 / 1792552759; checked on the
  // unfaded originals at pitch +15 / +30)
  { const v = lum(dX, dY); if (v < 200) return [170, 170, 170] }
  // looking up: no head ball / cross — at +30 the ball sits right on the drawing's thin chin arc (dot 1792552968)
  if (!noRed && (Math.abs(r - S) < 0.35 || (Math.abs(x - CX) < 0.2 && Math.abs(y - CY) < S * 1.3) || (Math.abs(y - CY) < 0.2 && Math.abs(x - CX) < S * 1.3))) return [235, 180, 215]
  return [255, 255, 255]
})
writeFileSync(`${outDir}/.${name}-ref.bmp`, pic)
execFileSync('sips', ['-s', 'format', 'png', `${outDir}/.${name}-ref.bmp`, '--out', `${outDir}/${name}-reference.png`], { stdio: 'ignore' })

// ---- first match: 4 cubics through the targets, end points fixed (canvas px: centre 0, 82 px per head-ball radius, y down)
// the render (VRoid head units, ball = its cranium) → bowen's bench frame (his head ball: 82 px, centre 0): canvas =
// 82·K·(rot(p) − rot(Q)). K and Q calibrated on bowen's own 脸轮廓 in 123.json: at 0,0 crown −82 / chin +65 against the
// VRoid crown (+0.976) and chin tip (−1.492) → K = 0.7266, Qy = −0.40; at 90,0 his chin and face front both sit at x 75,
// which the VRoid head (chin further back) cannot meet with one depth: Qz = −0.46 from the chin, −0.19 from the face
// front, the middle −0.32 taken (±8 px left at 90). Without this the references were 1/K ≈ 1.38× too large below the
// crown (chin at 117 instead of 65)
const PX = 82, K = 0.7266, rq = rotate([0, -0.4, -0.32], { yaw, pitch })
const toCanvas = ([x, y]: P): P => [PX * K * ((x - CX) / S - rq[0]), PX * K * ((y - CY) / S + rq[1])]
const T = [...lowerT, ...craniumT].map(toCanvas)
// the first match starts from bowen's own outline at this view (123.json, the same frame now): points and handles; the
// red jaw strokes then refit the two jaw lines' handles (end points kept) where that brings the line closer to them.
// (Fitting all four lines from scratch folded back at 60 … 90 and looped at large pitch — dot 1792518360)
const fixMatch = process.env.CANDIDATE ? process.env.CANDIDATE === 'fix' : Math.abs(pitch) >= 45
// bowen's keyframes reach pitch ±45 only: beyond, his ±45 outline is the start
const basePitch = Math.max(-45, Math.min(45, pitch)), base = controlsAt({ yaw, pitch: basePitch })
// the crown point (颅顶点): level views take bowen's 01 height (y −82.2) and keep their own x; tilted views keep the
// starting outline's crown (bowen 1792553320, dot 1792553438 — only the height is unified; x = 0 and a cos(pitch) drop
// would assume a fixed 3D point the 2D drawings do not ask for)
const crownId = LINES.find(l => l.name === '左颅')!.b, CROWN = 82.2
const crownAt: P = pitch === 0 ? [base.points[crownId]!.x, -CROWN] : [base.points[crownId]!.x, base.points[crownId]!.y]
const bp = (id: string): P => (id === crownId ? crownAt : [base.points[id]!.x, base.points[id]!.y])
const red = lowerT.map(toCanvas)
const ang = (p: P) => Math.atan2(p[1], p[0]) // y down: L ≈ 0, crown ≈ −90°, chin ≈ +90°, R ≈ ±180°
const inArc = (p: P, a0: number, a1: number) => { let t = ang(p); if (a1 < a0) { if (t < a0) t += 2 * Math.PI; return t >= a0 && t <= a1 + 2 * Math.PI } return t >= a0 && t <= a1 }
function fit(A: P, B: P, pts: P[]): { ha: P; hb: P } {
  const chord = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1
  let ha: P = [(B[0] - A[0]) / 3, (B[1] - A[1]) / 3], hb: P = [(A[0] - B[0]) / 3, (A[1] - B[1]) / 3]
  if (pts.length < 4) return { ha, hb }
  const at = (t: number): P => { const u = 1 - t, P1 = [A[0] + ha[0], A[1] + ha[1]], P2 = [B[0] + hb[0], B[1] + hb[1]]; return [u * u * u * A[0] + 3 * u * u * t * P1[0]! + 3 * u * t * t * P2[0]! + t * t * t * B[0], u * u * u * A[1] + 3 * u * u * t * P1[1]! + 3 * u * t * t * P2[1]! + t * t * t * B[1]] }
  // initial parameters by projection on the chord; then alternate least squares for the handles / nearest-t updates
  let ts = pts.map(p => Math.max(0, Math.min(1, ((p[0] - A[0]) * (B[0] - A[0]) + (p[1] - A[1]) * (B[1] - A[1])) / (chord * chord))))
  for (let it = 0; it < 8; it++) {
    let a11 = 0, a12 = 0, a22 = 0; const bx = [0, 0], by = [0, 0]
    pts.forEach((p, i) => { const t = ts[i]!, u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, base = [(u * u * u + b1) * A[0] + (b2 + t * t * t) * B[0], (u * u * u + b1) * A[1] + (b2 + t * t * t) * B[1]]; a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2; for (let k = 0; k < 2; k++) { const r = p[k]! - base[k]!; (k ? by : bx)[0] += b1 * r; (k ? by : bx)[1] += b2 * r } })
    const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-9) break
    ha = [(a22 * bx[0]! - a12 * bx[1]!) / det, (a22 * by[0]! - a12 * by[1]!) / det]; hb = [(a11 * bx[1]! - a12 * bx[0]!) / det, (a11 * by[1]! - a12 * by[0]!) / det]
    ts = pts.map(p => { let best = 0, bd = Infinity; for (let k = 0; k <= 100; k++) { const q = at(k / 100), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; best = k / 100 } } return best })
  }
  return { ha, hb }
}
const curveCost = (A: P, B: P, h: { ha: P; hb: P }, pts: P[]) => {
  const q = Array.from({ length: 61 }, (_, k) => { const t = k / 60, u = 1 - t; return [0, 1].map(c => u * u * u * A[c]! + 3 * u * u * t * (A[c]! + h.ha[c]!) + 3 * u * t * t * (B[c]! + h.hb[c]!) + t * t * t * B[c]!) })
  return pts.reduce((a, p) => a + Math.min(...q.map(r => Math.hypot(r[0]! - p[0], r[1]! - p[1]))), 0) / Math.max(1, pts.length)
}
const refit: Record<string, { before: number; after: number; used: boolean }> = {}
const segFit = Object.fromEntries(LINES.map(l => {
  const A = bp(l.a), B = bp(l.b), h0 = { ha: [base.lines[l.id]!.ha.x, base.lines[l.id]!.ha.y] as P, hb: [base.lines[l.id]!.hb.x, base.lines[l.id]!.hb.y] as P }
  if (fixMatch || !l.name.endsWith('下颌')) return [l.name, { a: A, b: B, ...h0 }]
  // the line's red strokes: between its end points by angle about the centre
  const a0 = ang(A), a1 = ang(B), pts = red.filter(p => (l.name.startsWith('左') ? inArc(p, a0, a1) : inArc(p, a1, a0)))
  const h1 = fit(A, B, pts), chord = Math.hypot(B[0] - A[0], B[1] - A[1])
  const before = curveCost(A, B, h0, pts), after = curveCost(A, B, h1, pts)
  // the strokes must run along most of the line (≥ 60 % of its parameter): a short piece left after blanking the part
  // behind the ear bent the whole line into a hook at 45 (r3 preview)
  const tOf = (p: P) => { let best = 0, bd = Infinity; for (let k = 0; k <= 100; k++) { const t = k / 100, u = 1 - t, x = u * u * u * A[0] + 3 * u * u * t * (A[0] + h1.ha[0]) + 3 * u * t * t * (B[0] + h1.hb[0]) + t * t * t * B[0], y = u * u * u * A[1] + 3 * u * u * t * (A[1] + h1.ha[1]) + 3 * u * t * t * (B[1] + h1.hb[1]) + t * t * t * B[1], d = (x - p[0]) ** 2 + (y - p[1]) ** 2; if (d < bd) { bd = d; best = t } } return best }
  const ts = pts.map(tOf), span = ts.length ? Math.max(...ts) - Math.min(...ts) : 0
  const used = pts.length >= 8 && span >= 0.6 && after < before && Math.hypot(...h1.ha) < chord && Math.hypot(...h1.hb) < chord
  refit[l.name] = { before: +before.toFixed(1), after: +after.toFixed(1), span: +span.toFixed(2), used }
  return [l.name, { a: A, b: B, ...(used ? h1 : h0) }]
})) as Record<string, { a: P; b: P; ha: P; hb: P }>
// fit() solves for the handle VECTORS (P1 − A, P2 − B), which is what bench stores as ha (from a) and hb (from b)

// ---- the archive, from the template
const T0 = JSON.parse(readFileSync(template ?? '/Users/bowen/Desktop/123.json', 'utf8')), doc = T0.document
const layer = doc.network.layers.find((l: { name: string }) => l.name === '脸轮廓')
const names: Record<string, string> = Object.fromEntries(doc.names.line)
const faceLines = doc.network.lines.filter((l: { a: string; b: string }) => doc.network.points.some((p: { id: string; layer: string }) => p.id === l.a && p.layer === layer.id))
const byName = (n: string) => faceLines.find((l: { id: string }) => names[l.id] === n)
const pointsAt: Record<string, P> = {}, handles: Record<string, { ha: { x: number; y: number }; hb: { x: number; y: number } }> = {}
for (const [n, s] of Object.entries(segFit)) {
  const l = byName(n); if (!l) throw new Error(`no line ${n} in the template`)
  pointsAt[l.a] = s.a; pointsAt[l.b] = s.b
  handles[l.id] = { ha: { x: s.ha[0], y: s.ha[1] }, hb: { x: s.hb[0], y: s.hb[1] } }
}
// linked points (links: one point in two layers, e.g. the chin / crown shared with 侧脸) move with them
for (const pr of doc.links.pairs as { a: string; b: string }[]) { if (pointsAt[pr.a] && !pointsAt[pr.b]) pointsAt[pr.b] = pointsAt[pr.a]!; else if (pointsAt[pr.b] && !pointsAt[pr.a]) pointsAt[pr.a] = pointsAt[pr.b]! }
for (const sh of doc.network.shapes.layers) {
  for (const [id, p] of Object.entries(pointsAt)) if (sh.points[id]) sh.points[id] = { x: p[0], y: p[1] }
  for (const [id, h] of Object.entries(handles)) if (sh.lines?.[id]) sh.lines[id] = h
}
for (const l of doc.network.lines) l.state = { ...l.state, visible: faceLines.includes(l) }
for (const p of doc.network.points) if (p.layer === layer.id) p.width = 3
for (const id of Object.keys(pointsAt)) delete doc.animation.points[id] // includes the linked partners
for (const id of Object.keys(handles)) delete doc.animation.handles[id]
const png = readFileSync(`${outDir}/${name}-reference.png`).toString('base64'), scale = (PX * K) / (S * UP), Ic = toCanvas([C / 2, C / 2]) // the picture's centre on the canvas
{ // preview: the first match over the reference picture (canvas → picture px: centre + p / scale)
  const ox = W / 2 - Ic[0] / scale, oy = W / 2 - Ic[1] / scale, X = (p: P) => `${(ox + p[0] / scale).toFixed(1)},${(oy + p[1] / scale).toFixed(1)}`
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${W}"><image width="${W}" height="${W}" xlink:href="data:image/png;base64,${png}"/>`
  for (const s of Object.values(segFit)) { const P1: P = [s.a[0] + s.ha[0], s.a[1] + s.ha[1]], P2: P = [s.b[0] + s.hb[0], s.b[1] + s.hb[1]]; svg += `<path d="M${X(s.a)} C${X(P1)} ${X(P2)} ${X(s.b)}" fill="none" stroke="#00a651" stroke-width="5"/>` }
  for (const q of Object.values(segFit).flatMap(f => [f.a, f.b])) { const [x, y] = X(q).split(','); svg += `<circle cx="${x}" cy="${y}" r="10" fill="#00a651"/>` }
  writeFileSync(`${outDir}/.${name}-preview.svg`, svg + '</svg>')
}
doc.reference = {
  library: [{ id: `ref-${name}`, name: `${name}（生成线稿，已按渲染配准；红 = 要贴的线，蓝 = 头顶参考）`, src: `data:image/png;base64,${png}`, width: W, height: W }],
  images: [{ id: `img-${name}`, view: 'view:0,0', asset: `ref-${name}`, width: W, height: W, x: Ic[0], y: Ic[1], scale, angle: 0, opacity: 0.85, visible: true, flipped: false, slots: [] }],
}
const text = save(open(JSON.stringify(T0)))
writeFileSync(`${outDir}/${name}.json`, text)
const notes = {
  task: `${name}: 在 bench 里打开，正面视图（0,0）里把「脸轮廓」4 根线（左颅 / 右颅 / 左下颌 / 右下颌）贴到参考图的红线上；头顶被头发挡住，照蓝线；改完另存`,
  view: { convention: 'B（建模视角）：相机先绕头 yaw，再绕屏幕水平线 pitch，正交投影；只做右转一侧，左侧由镜像得到', yaw, pitch },
  lines: { 左颅: '左侧点 → 头顶', 左下颌: '左侧点 → 下巴', 右下颌: '右侧点 → 下巴', 右颅: '右侧点 → 头顶', note: '「左」= 画面 +x 一侧（转头后是脸的前侧）；四条线都在 0,0 视图里编辑，九个视图起始相同' },
  reference: { drawing, original: `${name}-original.png`, registration: { scale: reg.sc, shiftRenderPx: [reg.dx, reg.dy], lowerFaceMeanRenderPx: +reg.mean.toFixed(2) }, renderFrame: { cellPx: C, headBallRadiusPx: S, ballCentrePx: [CX, CY] }, canvas: { headBallRadiusPx: PX, ballCentre: [0, 0], imageScale: scale, imageCentre: Ic, renderToBench: { K, Q: [0, -0.4, -0.32], from: 'bowen 123.json 脸轮廓 0,0 头顶/下巴 + 90,0 下巴/脸前' } } },
  crown: pitch === 0 ? `颅顶点：平视统一到 01 的高度 y −82.2，x 沿用初稿 (${crownAt[0].toFixed(1)})（bowen 1792553320, dot 1792553438）` : `颅顶点：俯仰视角保留初稿位置 (${crownAt[0].toFixed(1)}, ${crownAt[1].toFixed(1)})（dot 1792553438）`,
  firstMatch: { from: basePitch === pitch ? 'bowen 123.json 同视角的脸轮廓（点和手柄）' : `bowen 123.json 的 pitch ${basePitch} 脸轮廓（他的关键帧只到 ±45，钳到 ${basePitch} 回放）：只是起稿，不是已有的 ${pitch}° 骨线`, jawRefitToRed: fixMatch ? '待修：不重拟' : refit, targetsRed: lowerT.length, targetsBlue: craniumT.length },
  status: '生成线稿是候选，角度未校准（dot 1792513207）；配准只用下半张脸',
  // large pitch: the generated drawings weaken the angle (dot 1792515820) and the jaw registers onto the eyes (checked
  // on the previews 2026-10-21) — not to be traced
  // CANDIDATE=ok / fix overrides the rule after looking at the preview; NOTE adds a line (e.g. the drawing's version)
  ...(process.env.NOTE ? { note: process.env.NOTE } : {}),
  // two separate marks (dot 1792518737): the drawing's angle, and whether the first match can be fine-tuned
  angle: Math.abs(pitch) >= 45 ? '未校准；大俯仰角度被生成图弱化（dot 1792515820）' : '未校准（生成线稿是候选，dot 1792513207）',
  // MATCH=<text> sets the status outright (e.g. 姿态待核对 for the combined-view trial, dot 1792525242)
  match: process.env.MATCH ? process.env.MATCH : fixMatch ? '粗匹配待修：配准把下颌落到了眼睛上，先不要照着描；轮廓先用 123.json 原样' : '可细调',
  limits: [
    ...(yaw > 0 ? ['远侧点（右）沿用 123.json：在耳前，转头时跟着头走（来源：123.json 各视角的点位；它是不是脸轮廓的最终含义，待 bowen 确认）'] : []),
    ...(yaw >= 30 ? ['耳前缘往后那段（头部 z < 0.1：耳下、后颈）不高亮、不拟合：生成图那里是发梢，下颌在哪待判断（dot 1792520014）'] : []),
    ...(pitch > 0 ? ['仰视：不标红线（贴近渲染下颌的是脖子线、耳垂和发梢）。线稿里中间那条细弧是下巴线，也是脸和脖子的分界，不一定是整张头颈图的最外边；两侧颊线到细弧之间的留白 = 待推定连接，别用耳垂或脖子补（dot 1792552759）'] : []),
    '参考图按 123.json 的 0,0 头顶 / 下巴和 90,0 下巴 / 脸前定比例；VRoid 下巴比 bowen 的头更靠后，90 度附近差约 8 px',
    '发际线高亮还没做',
  ],
  sources: { template: template ?? '/Users/bowen/Desktop/123.json（只读）', renderer: 'face3d/fit/vrm-renders.ts + mesh/vrmhead.ts（VRoid test.vrm）', builder: 'face3d/fit/bench-task.ts' },
}
copyFileSync(drawing!, `${outDir}/${name}-original.png`) // the candidate drawing itself travels with the archive (dot 1792518737)
writeFileSync(`${outDir}/${name}.notes.json`, JSON.stringify(notes, null, 1))
console.log('ok', name, JSON.stringify(notes.reference.registration), 'targets', lowerT.length, craniumT.length)
