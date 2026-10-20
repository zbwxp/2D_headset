// Fit the rough head's lower face to the reference sheet's black line art (bowen 1792498982: "照着这个为参考"; dot
// 1792499019: the black character lines, not the magenta guide, are the shape reference; front, 30°, 60°, side first).
// The drawn outline per level cell (ref/level-picks.json, picks.mjs): the jaw / chin underline (lowest dark pixel per
// column) and the face front (right-most dark pixel per row), in head screen units (the sheet's ball = the head ball).
// The model's outline: the projected head's outer boundary at the same view. Cost per view: mean distance from the
// drawn picks to the model outline + mean distance from the model outline inside the picks' box to the picks.
// Fitted: the sections below y = −0.3 at fixed heights (half-width a, front f, back b, roundness n) and the chin
// height; above, the ball is kept. Glue, not graph code (bowen 1791477975): the result goes back into head.ts.
// Run: FIT_RUN=1 npx vite-node face3d/fit/sheet-fit.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { type HeadShape, type Knot, defaultShape, makeHead, pchip } from '../src/head'
import { boundaryPoints, mask } from '../src/outline'
import { type View } from '../src/view'

type P2 = [number, number]
const picks: Record<string, { bottom: P2[]; right: P2[]; left: P2[] }> = JSON.parse(readFileSync(new URL('./ref/level-picks.json', import.meta.url), 'utf8'))
// sheet rows are camera pitch with + = from above (俯视); face3d pitch + = from below (仰视)
const viewOf = (key: string): View => { const [yaw, pitch] = key.split(',').map(Number); return { yaw: yaw!, pitch: -pitch! } }

export const L = [-0.45, -0.6, -0.72, -0.84, -0.96, -1.08]
export interface Params { yMin: number; a: number[]; f: number[]; b: number[]; n: number[]; fChin: number }
const keep = (ks: readonly Knot[]) => ks.filter(k => k.y >= -0.3)
export function shapeOf(p: Params): HeadShape {
  const at = (vs: number[]) => L.map((y, i) => ({ y, v: vs[i]! }))
  return {
    ...defaultShape,
    yMin: p.yMin,
    a: [...keep(defaultShape.a), ...at(p.a), { y: p.yMin, v: 0.05 }],
    f: [...keep(defaultShape.f), ...at(p.f), { y: p.yMin, v: p.fChin }],
    b: [...keep(defaultShape.b), ...at(p.b), { y: p.yMin, v: p.fChin }],
    n: [...keep(defaultShape.n), ...at(p.n), { y: p.yMin, v: 2 }],
  }
}
const init = (): Params => {
  const A = pchip(defaultShape.a), F = pchip(defaultShape.f), B = pchip(defaultShape.b), N = pchip(defaultShape.n)
  return { yMin: defaultShape.yMin, a: L.map(A), f: L.map(F), b: L.map(B), n: L.map(N), fChin: F(defaultShape.yMin) }
}

const near = (p: P2, set: P2[]) => { let d = Infinity; for (const q of set) { const e = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (e < d) d = e } return Math.sqrt(d) }
export function viewCost(shape: HeadShape, key: string) {
  const pk = picks[key]!, P = [...pk.bottom, ...pk.right, ...pk.left]
  const bp = boundaryPoints(mask(makeHead(shape), viewOf(key))) as P2[]
  // the model outline compared back: only inside the box of each drawn group (a part with no drawn line, e.g. the
  // profile between nose and chin where the drawing has lips the head does not model, is not compared)
  const boxes = [pk.bottom, pk.right, pk.left].filter(g => g.length).map(g => ({ x0: Math.min(...g.map(p => p[0])) - 0.03, x1: Math.max(...g.map(p => p[0])) + 0.03, y0: Math.min(...g.map(p => p[1])) - 0.03, y1: Math.max(...g.map(p => p[1])) + 0.03 }))
  const M = bp.filter(p => boxes.some(b => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1))
  const d1 = P.map(p => near(p, bp)), d2 = M.map(p => near(p, P))
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
  return { d1: mean(d1), d2: mean(d2), max1: Math.max(...d1), max2: M.length ? Math.max(...d2) : 0, cost: mean(d1) + mean(d2) }
}
const KEYS = Object.keys(picks)
// smoothness: second differences along each knot column, from the kept ball value at y = −0.3 down to the chin (the
// first unregularised fit put a shelf into b and a wiggle into a: knots move freely where no drawn line constrains them)
const smooth = (p: Params) => {
  const top = (ks: readonly Knot[]) => pchip(ks)(-0.3), d2 = (v: number[]) => v.slice(1, -1).reduce((s, x, i) => s + (v[i]! - 2 * x + v[i + 2]!) ** 2, 0)
  return 0.5 * (d2([top(defaultShape.a), ...p.a, 0.05]) + d2([top(defaultShape.f), ...p.f, p.fChin]) + d2([top(defaultShape.b), ...p.b, p.fChin])) + 0.05 * d2([top(defaultShape.n), ...p.n, 2])
}
const total = (p: Params) => KEYS.reduce((s, k) => s + viewCost(shapeOf(p), k).cost, 0) + smooth(p)
const valid = (p: Params) => p.a.every(v => v > 0.05) && p.f.every((v, i) => v > p.b[i]! + 0.1) && p.n.every(v => v >= 1.5 && v <= 4) && p.yMin < -1.06 && p.yMin > -1.5 && p.fChin > 0

if (process.env.FIT_RUN) {
  let p = init(), c = total(p)
  console.log('start', c.toFixed(4), KEYS.map(k => `${k} ${viewCost(shapeOf(p), k).cost.toFixed(4)}`).join(' | '))
  // coordinate descent: each parameter up / down by its step; steps halve after a pass without improvement
  const groups: [keyof Params, number][] = [['a', 0.04], ['f', 0.04], ['b', 0.04], ['n', 0.2]]
  let scale = 1
  while (scale > 0.06) {
    let improved = false
    const tryset = (q: Params) => { if (!valid(q)) return false; const cq = total(q); if (cq < c - 1e-6) { p = q; c = cq; return true } return false }
    for (const [g, s] of groups) for (let i = 0; i < L.length; i++) for (const sg of [1, -1]) {
      const q: Params = JSON.parse(JSON.stringify(p)); (q[g] as number[])[i]! += sg * s * scale
      if (tryset(q)) { improved = true; break }
    }
    for (const [g, s] of [['yMin', 0.03], ['fChin', 0.04]] as const) for (const sg of [1, -1]) { const q: Params = { ...p, [g]: p[g] + sg * s * scale }; if (tryset(q)) { improved = true; break } }
    console.log(`scale ${scale} cost ${c.toFixed(4)}`)
    if (!improved) scale /= 2
  }
  console.log('end', c.toFixed(4), 'smooth', smooth(p).toFixed(4), KEYS.map(k => { const v = viewCost(shapeOf(p), k); return `${k} d1 ${v.d1.toFixed(3)} d2 ${v.d2.toFixed(3)} max ${v.max1.toFixed(3)}/${v.max2.toFixed(3)}` }).join(' | '))
  writeFileSync(new URL('./ref/fit-level.json', import.meta.url), JSON.stringify(p, null, 1))
}
