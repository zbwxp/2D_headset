// Fit ONE symmetric head to bowen's drawn face outline (bench archive layer 脸轮廓) at several poses (bowen
// 1792503785 / 1792503971; dot 1792504023: symmetry is a property of the 3D head — one half fitted, the other its
// mirror — and the outlines at the poses are matched by the same head turned there, never paired point by point).
// The head: the loft of head.ts (superellipse sections, symmetric in x by construction), every section height free —
// half-width a, front f, back b, roundness n at the heights LV, the chin height and depth; the crown stays at (0, 1, 0).
// Per pose the drawing's placement on the canvas is not calibrated, so each pose's outline is moved (not scaled) to
// the model's: bounding-box centres matched. One scale for all poses, from the front view's crown–chin height.
// Cost per pose: mean distance drawn outline → model outer boundary + model outer boundary → drawn outline.
// Run: FIT_RUN=1 npx vite-node face3d/fit/bench-fit.ts <archive.json>
import { writeFileSync } from 'node:fs'
import { type HeadShape, type Knot, makeHead, pchip } from '../src/head'
import { boundaryPoints, mask } from '../src/outline'
import { type View, rotate, toCamera } from '../src/view'
import { type P2, outlineAt, readBench } from './bench'
import { type BParams, LV, shapeOf, shapeOfB } from './shape'
export { type BParams, LV, shapeOfB }
import fitted from './ref/fit-level.json'

export function initB(): BParams {
  const s = shapeOf(fitted), A = pchip(s.a), F = pchip(s.f), B = pchip(s.b), N = pchip(s.n)
  return { yMin: s.yMin, a: LV.map(A), f: LV.map(F), b: LV.map(B), n: LV.map(N), fChin: F(s.yMin) }
}

const near = (p: P2, set: P2[]) => { let d = Infinity; for (const q of set) { const e = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (e < d) d = e } return Math.sqrt(d) }
const box = (ps: P2[]) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of ps) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) } return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } }

/** the drawn outline at the poses, in head units before placement (x right, y up), with the shared scale */
export function drawn(file: string, poses: View[], pitchSign = 1) {
  const bench = readBench(file, '脸轮廓'), side = readBench(file, '侧脸')
  const lines = poses.map(v => outlineAt(bench, { yaw: v.yaw, pitch: pitchSign * v.pitch }).map(l => l.pts)), raw = lines.map(ls => ls.flat())
  // the face's middle line (layer 侧脸: a vertical line at the front, the nose–lips–chin profile at 90°)
  const mid = poses.map(v => outlineAt(side, { yaw: v.yaw, pitch: pitchSign * v.pitch }).flatMap(l => l.pts))
  const front = raw[poses.findIndex(v => v.yaw === 0 && v.pitch === 0)]!, fb = box(front)
  return { poses, raw, lines, mid, scale: (fb.y1 - fb.y0) }
}
/** `view`: the camera the model is seen from (default: the drawing's nominal pose) — the angle search (angles.ts) moves it */
export function placed(D: ReturnType<typeof drawn>, shape: HeadShape, i: number, view: View = D.poses[i]!) {
  const s = D.scale / (shape.yMax - shape.yMin), d = D.raw[i]!.map(([x, y]): P2 => [x / s, -y / s])
  const model = boundaryPoints(mask(makeHead(shape), view)) as P2[]
  const bd = box(d), bm = box(model), dx = bm.cx - bd.cx, dy = bm.cy - bd.cy
  const to = ([x, y]: P2): P2 => [x / s + dx, -y / s + dy]
  return { drawn: d.map(([x, y]): P2 => [x + dx, y + dy]), lines: D.lines[i]!.map(l => l.map(to)), mid: D.mid[i]!.map(to), model, offset: [dx, dy] as P2 }
}
/** the head's front middle line (u = 0, crown to chin) at a view, the part facing the camera, screen points */
export function modelMid(shape: HeadShape, v: View): P2[] {
  const head = makeHead(shape), d = toCamera(v), out: P2[] = []
  for (let k = 0; k <= 80; k++) {
    const y = shape.yMax - (k / 80) * (shape.yMax - shape.yMin), n = head.normal(0, y)
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < -0.02) continue
    const r = rotate(head.at(0, y), v); out.push([r[0], r[1]])
  }
  return out
}
/** `mid`: also match the drawn middle line to the head's (each point's distance clipped at 0.1, so the nose and lips
 *  the head does not model only count so far) */
export function poseCost(D: ReturnType<typeof drawn>, shape: HeadShape, i: number, view?: View, mid = false) {
  const pl = placed(D, shape, i, view), { drawn: d, model } = pl
  const d1 = d.map(p => near(p, model)), d2 = model.map(p => near(p, d))
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
  let m = 0
  if (mid) { const mm = modelMid(shape, view ?? D.poses[i]!); if (mm.length > 1 && pl.mid.length > 1) m = mean(pl.mid.map(p => Math.min(0.1, near(p, mm)))) + mean(mm.map(p => Math.min(0.1, near(p, pl.mid)))); else m = 0.2 }
  return { d1: mean(d1), d2: mean(d2), mid: m, max: Math.max(...d1, ...d2), cost: mean(d1) + mean(d2) + m }
}
export const smoothB = (p: BParams) => {
  const d2 = (v: number[]) => v.slice(1, -1).reduce((s, x, i) => s + (v[i]! - 2 * x + v[i + 2]!) ** 2, 0)
  return 0.5 * (d2([0, ...p.a, 0.05]) + d2([0, ...p.f, p.fChin]) + d2([0, ...p.b, p.fChin])) + 0.05 * d2([2, ...p.n, 2])
}
export const validB = (p: BParams) => p.a.every(v => v > 0.03) && p.f.every((v, i) => v > p.b[i]! + 0.1) && p.n.every(v => v >= 1.5 && v <= 4) && p.yMin < -0.9 && p.yMin > -1.6 && p.yMin < LV[LV.length - 1]! - 0.03

if (process.env.FIT_RUN && !process.env.ANGLES) {
  const file = process.argv[2] ?? '/Users/bowen/Desktop/123.json'
  const poses: View[] = (process.env.POSES ?? '0,0 30,0 -30,0 60,0 -60,0 90,0 -90,0').split(' ').map(s => { const [yaw, pitch] = s.split(',').map(Number); return { yaw: yaw!, pitch: pitch! } })
  const D = drawn(file, poses, Number(process.env.PITCH_SIGN ?? 1))
  const total = (p: BParams) => poses.reduce((s, _, i) => s + poseCost(D, shapeOfB(p), i).cost, 0) + smoothB(p)
  let p = initB(), c = total(p)
  const report = (tag: string) => console.log(tag, c.toFixed(4), poses.map((v, i) => { const r = poseCost(D, shapeOfB(p), i); return `${v.yaw},${v.pitch} ${r.d1.toFixed(3)}/${r.d2.toFixed(3)} max ${r.max.toFixed(3)}` }).join(' | '))
  report('start')
  let scale = 1
  const groups: [keyof BParams, number][] = [['a', 0.04], ['f', 0.04], ['b', 0.04], ['n', 0.2]]
  while (scale > 0.06) {
    let improved = false
    const tryset = (q: BParams) => { if (!validB(q)) return false; const cq = total(q); if (cq < c - 1e-6) { p = q; c = cq; return true } return false }
    for (const [g, s] of groups) for (let i = 0; i < LV.length; i++) for (const sg of [1, -1]) { const q: BParams = JSON.parse(JSON.stringify(p)); (q[g] as number[])[i]! += sg * s * scale; if (tryset(q)) { improved = true; break } }
    for (const [g, s] of [['yMin', 0.03], ['fChin', 0.04]] as const) for (const sg of [1, -1]) { const q: BParams = { ...p, [g]: p[g] + sg * s * scale }; if (tryset(q)) { improved = true; break } }
    console.log(`scale ${scale} cost ${c.toFixed(4)}`)
    if (!improved) scale /= 2
  }
  report('end')
  writeFileSync(new URL(`./ref/${process.env.OUT ?? 'fit-bench'}.json`, import.meta.url), JSON.stringify(p, null, 1))
}
