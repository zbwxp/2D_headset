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
