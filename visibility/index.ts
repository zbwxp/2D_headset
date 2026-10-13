// visibility — the 显隐 module (bowen 1791901097; docs/mask-p1-checklist.md): what of a line or a fill stays visible.
// Masks for now (walkthrough Q33): a relation's source fills, united, hide its target inside (inverse) or keep only
// the inside (normal). Line display intervals join this module later. Plain geometry on plain data; the only import
// is the polygon library the ink uses.
import { unionD, differenceD, intersectD, FillRule, type PathsD } from 'clipper2-ts'

export interface Vec { readonly x: number; readonly y: number }
export type Cubic = readonly [Vec, Vec, Vec, Vec]
/** A region as closed polygons, read with the non-zero rule. */
export type Area = readonly (readonly Vec[])[]
/** One mask relation as it acts on one target: its mode, and each source's area — `null` for a source that is off. */
export interface Relation { readonly mode: 'inverse' | 'normal'; readonly sources: readonly (Area | null)[] }

/** Decimal places the polygon library keeps (its documented range is 0–8). */
const PRECISION = 6
const toD = (a: Area): PathsD => a.map(l => l.map(v => ({ x: v.x, y: v.y })))
const fromD = (p: PathsD): Area => p.map(l => l.map(v => ({ x: v.x, y: v.y })))
const point = (c: Cubic, t: number): Vec => { const u = 1 - t; return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y } }

/**
 * A filled loop's area: its boundary cubics, in order and end to end (a fill's `parts` as drawn in a view), flattened
 * so that no chord strays more than `tolerance` (drawing units) from its cubic — a cubic's control polygon bounds it,
 * so `n` chords with n² ≥ (3/4)·(its second differences) / tolerance are enough.
 */
export function area(parts: readonly Cubic[], tolerance = 0.02): Area {
  if (!(tolerance > 0)) throw Error('visibility: the tolerance must be positive')
  const loop: Vec[] = []
  for (const c of parts) {
    if (!c.every(v => Number.isFinite(v.x) && Number.isFinite(v.y))) throw Error('visibility: a boundary is not finite')
    const d = Math.max(Math.hypot(c[0].x - 2 * c[1].x + c[2].x, c[0].y - 2 * c[1].y + c[2].y), Math.hypot(c[1].x - 2 * c[2].x + c[3].x, c[1].y - 2 * c[2].y + c[3].y))
    const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * d) / tolerance)))
    for (let i = 0; i < n; i++) loop.push(point(c, i / n))
  }
  return loop.length >= 3 ? [loop] : []
}

/**
 * What of `target` stays visible under its relations (Q33; dot 1791901708): per relation, the union of its sources that
 * are on (each source a region of its own first) — with none on, the relation is skipped, never read as an empty area; inverse = the target minus that union,
 * normal = the target within it. Each relation only removes, so their order does not matter. Sources are areas read
 * before any mask (the caller's duty: a source fill's own boundary), so mutual masks cannot loop.
 */
export function apply(target: Area, relations: readonly Relation[]): Area {
  let visible: PathsD = toD(target)
  for (const r of relations) {
    const on = r.sources.filter((s): s is Area => s !== null)
    if (!on.length) continue
    // each source made a region by its own non-zero rule first, then the regions united — raw paths of different
    // sources winding opposite ways must not cancel (dot 1791903159)
    const sources = unionD(on.flatMap(a => unionD(toD(a), [], FillRule.NonZero, PRECISION)), [], FillRule.NonZero, PRECISION)
    visible = r.mode === 'inverse' ? differenceD(visible, sources, FillRule.NonZero, PRECISION) : intersectD(visible, sources, FillRule.NonZero, PRECISION)
  }
  return fromD(visible)
}

/** The area of a region (non-zero), for tests and checks. */
/** Whether `p` is inside an area (the non-zero rule, as areas are read). */
export function contains(a: Area, p: Vec): boolean {
  let winding = 0
  for (const l of a) for (let i = 0; i < l.length; i++) {
    const u = l[i]!, v = l[(i + 1) % l.length]!
    if (u.y <= p.y) { if (v.y > p.y && (v.x - u.x) * (p.y - u.y) - (p.x - u.x) * (v.y - u.y) > 0) winding++ }
    else if (v.y <= p.y && (v.x - u.x) * (p.y - u.y) - (p.x - u.x) * (v.y - u.y) < 0) winding--
  }
  return winding !== 0
}
/** How far `p` is from an area: 0 inside, else the distance to its nearest edge; Infinity for an empty area. */
export function distance(a: Area, p: Vec): number {
  if (contains(a, p)) return 0
  let best = Infinity
  for (const l of a) for (let i = 0; i < l.length; i++) {
    const u = l[i]!, v = l[(i + 1) % l.length]!, dx = v.x - u.x, dy = v.y - u.y, len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(p.x - u.x - t * dx, p.y - u.y - t * dy))
  }
  return best
}

export function size(a: Area): number {
  const u = unionD(toD(a), [], FillRule.NonZero, PRECISION)
  return u.reduce((s, l) => { let t = 0; for (let i = 0; i < l.length; i++) { const p = l[i]!, q = l[(i + 1) % l.length]!; t += p.x * q.y - q.x * p.y } return s + t / 2 }, 0)
}
