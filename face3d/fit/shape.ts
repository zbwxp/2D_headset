// The fitted head's parametrisation (sheet-fit.ts): the sections below y = −0.3 at the heights L, the ball above kept
// from defaultShape. Browser-safe (the viewer imports it); the fitted values are in ref/fit-level.json.
import { type HeadShape, type Knot, defaultShape } from '../src/head'

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

// The head fitted to bowen's bench outlines (bench-fit.ts): every section height free, crown at (0, 1, 0).
export const LV = [0.8, 0.55, 0.3, 0.05, -0.2, -0.45, -0.65, -0.82, -0.97, -1.1]
export interface BParams { yMin: number; a: number[]; f: number[]; b: number[]; n: number[]; fChin: number }
export function shapeOfB(p: BParams): HeadShape {
  const at = (vs: number[]) => LV.map((y, i) => ({ y, v: vs[i]! }))
  // the crown: above the first free height the sections follow an ellipse through it (∝ √(1 − y²)), so the top is
  // round, not the cone a single knot at y = 1 gives
  const circ = (y: number) => Math.sqrt(1 - y * y), crown = (v0: number) => [{ y: 1, v: 0 }, ...[0.995, 0.98, 0.95, 0.9].map(y => ({ y, v: (v0 * circ(y)) / circ(LV[0]!) }))]
  return {
    yMin: p.yMin, yMax: 1, cap: 0.06,
    a: [...crown(p.a[0]!), ...at(p.a), { y: p.yMin, v: 0.05 }],
    f: [...crown(p.f[0]!), ...at(p.f), { y: p.yMin, v: p.fChin }],
    b: [...crown(p.b[0]!), ...at(p.b), { y: p.yMin, v: p.fChin }],
    n: [{ y: 1, v: 2 }, ...at(p.n), { y: p.yMin, v: 2 }],
  }
}
