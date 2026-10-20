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
const D = readBmp(tmp), dt = darkDT(D), { segs, band, chin } = renderContour({ yaw, pitch }), reg = register(D, dt, band)

// ---- targets (render px): the drawing's dark pixels next to the render's lower contour; the render's cranium contour
// the drawing's strokes are matched only along the render's jaw band (cheek under the eyes → chin, on the head; the far
// eye, hair and neck are not in it); the cranium and the back of the head are hair in the drawing, so the render's
// contour outside the band is the guide there (blue)
const near = new Set<number>(), bandKeys = new Set<string>(band.map(s => s.join(',')))
for (const [x0, y0, x1, y1] of band) for (let i = 0; i <= 6; i++) { const x = x0 + ((x1 - x0) * i) / 6, y = y0 + ((y1 - y0) * i) / 6; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) near.add(Math.round(y + dy) * C + Math.round(x + dx)) }
const darkAt = (x: number, y: number) => { const [X, Y] = toDrawing(reg, x, y); return dt.at(X, Y) < 0.5 }
const lowerT: P[] = [], craniumT: P[] = []
for (const k of near) { const x = k % C, y = Math.floor(k / C); if (darkAt(x, y)) lowerT.push([x, y]) }
// the guide: the render's contour outside the band, above the jaw (the neck below the chin left out)
for (const sg of segs) { if (bandKeys.has(sg.join(','))) continue; const [x0, y0, x1, y1] = sg; for (let i = 0; i <= 3; i++) { const x = x0 + ((x1 - x0) * i) / 3, y = y0 + ((y1 - y0) * i) / 3; if (y < chin[1] - 4 || Math.hypot(x - CX, y - CY) < S * 1.05) craniumT.push([x, y]) } }

// ---- the highlighted reference picture, 3× the render frame
const UP = 3, W = C * UP
const segPix = new Set<number>()
for (const sg of segs) { if (bandKeys.has(sg.join(','))) continue; const [x0, y0, x1, y1] = sg; if (Math.max(y0, y1) >= chin[1] - 4 && Math.hypot((x0 + x1) / 2 - CX, (y0 + y1) / 2 - CY) >= S * 1.05) continue; const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * UP * 2) + 1; for (let i = 0; i <= n; i++) { const X = Math.round((x0 + ((x1 - x0) * i) / n) * UP), Y = Math.round((y0 + ((y1 - y0) * i) / n) * UP); for (let d = -1; d <= 1; d++) { segPix.add(Y * W + X + d); segPix.add((Y + d) * W + X) } } }
const nearUp = (x: number, y: number) => near.has(Math.floor(y) * C + Math.floor(x))
const pic = writeBmp(W, W, (X, Y) => {
  const x = (X + 0.5) / UP, y = (Y + 0.5) / UP, r = Math.hypot(x - CX, y - CY)
  if (segPix.has(Y * W + X)) return [30, 110, 230]
  const [dX, dY] = toDrawing(reg, x, y)
  if (dt.at(dX, dY) < 0.6) return nearUp(x, y) ? [225, 30, 30] : [185, 185, 185]
  if (Math.abs(r - S) < 0.35 || (Math.abs(x - CX) < 0.2 && Math.abs(y - CY) < S * 1.3) || (Math.abs(y - CY) < 0.2 && Math.abs(x - CX) < S * 1.3)) return [235, 180, 215]
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
const basePitch = Math.max(-45, Math.min(45, pitch)), base = controlsAt({ yaw, pitch: basePitch }), bp = (id: string): P => [base.points[id]!.x, base.points[id]!.y]
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
  const used = pts.length >= 8 && after < before && Math.hypot(...h1.ha) < chord && Math.hypot(...h1.hb) < chord
  refit[l.name] = { before: +before.toFixed(1), after: +after.toFixed(1), used }
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
  firstMatch: { from: basePitch === pitch ? 'bowen 123.json 同视角的脸轮廓（点和手柄）' : `bowen 123.json 的 pitch ${basePitch} 脸轮廓（他的关键帧只到 ±45）`, jawRefitToRed: fixMatch ? '待修：不重拟' : refit, targetsRed: lowerT.length, targetsBlue: craniumT.length },
  status: '生成线稿是候选，角度未校准（dot 1792513207）；配准只用下半张脸',
  // large pitch: the generated drawings weaken the angle (dot 1792515820) and the jaw registers onto the eyes (checked
  // on the previews 2026-10-21) — not to be traced
  // CANDIDATE=ok / fix overrides the rule after looking at the preview; NOTE adds a line (e.g. the drawing's version)
  ...(process.env.NOTE ? { note: process.env.NOTE } : {}),
  // two separate marks (dot 1792518737): the drawing's angle, and whether the first match can be fine-tuned
  angle: Math.abs(pitch) >= 45 ? '未校准；大俯仰角度被生成图弱化（dot 1792515820）' : '未校准（生成线稿是候选，dot 1792513207）',
  match: fixMatch ? '粗匹配待修：配准把下颌落到了眼睛上，先不要照着描；轮廓先用 123.json 原样' : '可细调',
  limits: [
    ...(yaw > 0 ? ['远侧点（右）沿用 123.json：在耳前，转头时跟着头走，后脑勺不算脸轮廓（照现有存档推的，待 bowen 确认）'] : []),
    '参考图按 123.json 的 0,0 头顶 / 下巴和 90,0 下巴 / 脸前定比例；VRoid 下巴比 bowen 的头更靠后，90 度附近差约 8 px',
    '发际线高亮还没做',
  ],
  sources: { template: template ?? '/Users/bowen/Desktop/123.json（只读）', renderer: 'face3d/fit/vrm-renders.ts + mesh/vrmhead.ts（VRoid test.vrm）', builder: 'face3d/fit/bench-task.ts' },
}
copyFileSync(drawing!, `${outDir}/${name}-original.png`) // the candidate drawing itself travels with the archive (dot 1792518737)
writeFileSync(`${outDir}/${name}.notes.json`, JSON.stringify(notes, null, 1))
console.log('ok', name, JSON.stringify(notes.reference.registration), 'targets', lowerT.length, craniumT.length)
