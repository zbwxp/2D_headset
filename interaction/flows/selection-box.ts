// selection-box — the box around a selection and what its handles do (docs/selection-box-plan.md; bowen
// 1791733125, 1791734097; dot 1791735216, 1791735431): which handles exist, what a point hits, and the pointer
// turned into one scale or one rotation. Plain maths on plain data; picking order and sessions are
// select-transform's.
import type { Vec } from '../../src'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'
export interface Bounds { readonly min: Vec; readonly max: Vec }
/** In screen pixels: a handle's reach, the margin around the box that still grabs it, the rotation handle's stem. */
export const BOX = Object.freeze({ reach: 7, margin: 6, stem: 22 })
/** Core refuses a transform whose determinant is below 1e-12 (editing.transformPlan): factors stay above √ of it, with room. */
const DET_MIN = 1e-12, FACTOR_MIN = Math.sqrt(DET_MIN) * 1.01

const centre = (b: Bounds): Vec => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })

/**
 * The handles a box has (§4): a side thinner than one screen pixel has none that would scale it — zero width:
 * no left / right edges and no corners; zero height: no top / bottom edges and no corners; both: no scale
 * handles. The rotation handle exists when either side has length, above the top edge's middle.
 */
export function handlesOf(b: Bounds, px: number): { id: HandleId; at: Vec }[] {
  const w = b.max.x - b.min.x, h = b.max.y - b.min.y, zw = w < px, zh = h < px, c = centre(b)
  const out: { id: HandleId; at: Vec }[] = []
  if (!zw && !zh) out.push({ id: 'nw', at: b.min }, { id: 'ne', at: { x: b.max.x, y: b.min.y } }, { id: 'se', at: b.max }, { id: 'sw', at: { x: b.min.x, y: b.max.y } })
  if (!zh) out.push({ id: 'n', at: { x: c.x, y: b.min.y } }, { id: 's', at: { x: c.x, y: b.max.y } })
  if (!zw) out.push({ id: 'e', at: { x: b.max.x, y: c.y } }, { id: 'w', at: { x: b.min.x, y: c.y } })
  if (!(zw && zh)) out.push({ id: 'rotate', at: { x: c.x, y: b.min.y - BOX.stem * px } })
  return out
}

/** What a point hits: the nearest handle within reach, else the box with its margin ('inside'), else nothing. */
export function hitBox(b: Bounds, at: Vec, px: number): HandleId | 'inside' | null {
  let best: { id: HandleId; d: number } | null = null
  for (const h of handlesOf(b, px)) {
    const d = Math.hypot(at.x - h.at.x, at.y - h.at.y)
    if (d <= BOX.reach * px && (!best || d < best.d)) best = { id: h.id, d }
  }
  if (best) return best.id
  const m = BOX.margin * px
  return at.x >= b.min.x - m && at.x <= b.max.x + m && at.y >= b.min.y - m && at.y <= b.max.y + m ? 'inside' : null
}

export type BoxOp = { kind: 'scale'; anchor: Vec; sx: number; sy: number } | { kind: 'rotate'; centre: Vec; angle: number }

/** A handle drag's fixed basis (§5): the box, the handle, the grab offset; and what it remembers between frames. */
export interface HandleDrag {
  readonly handle: HandleId
  readonly box: Bounds
  readonly px: number
  /** The press point's offset from the handle, kept so a press slightly off the handle does not jump. */
  readonly grab: Vec
  readonly h0: Vec
  /** The sign a factor had on its last frame that was not 0 (+ at the start). */
  sign: { s: number; x: number; y: number }
  /** The rotation so far, unwrapped across ±180°, and the pointer's last angle about the centre. */
  turn: { total: number; last: number }
}

export function startHandleDrag(handle: HandleId, box: Bounds, press: Vec, px: number): HandleDrag {
  const h0 = handlesOf(box, px).find(h => h.id === handle)!.at, c = centre(box)
  return { handle, box, px, grab: sub(press, h0), h0, sign: { s: 1, x: 1, y: 1 }, turn: { total: 0, last: Math.atan2(press.y - c.y, press.x - c.x) } }
}

/** A factor held away from 0 by `min`, keeping its sign; exactly 0 takes the last sign it had (§4). */
function hold(f: number, min: number, last: number): { f: number; sign: number } {
  const sign = f > 0 ? 1 : f < 0 ? -1 : last
  return { f: Math.abs(f) < min ? sign * min : f, sign }
}

/**
 * The pointer as one operation (§4). Corners: proportional, s = ((H − A)·(H0 − A)) / |H0 − A|² about the opposite
 * corner (Option: the centre), one s held by both sides' one-pixel minimum and core's determinant. Edges: one axis,
 * about the opposite edge (Option: the centre). Rotation: about the box's centre, unwrapped, Shift in 15° steps,
 * the last angle kept while the pointer is within a pixel of the centre. Mutates the drag's memory (signs, turn).
 */
export function opAt(d: HandleDrag, pointer: Vec, mods: { alt?: boolean; shift?: boolean }): BoxOp {
  const b = d.box, c = centre(b), w = b.max.x - b.min.x, h = b.max.y - b.min.y
  const H = sub(pointer, d.grab)
  if (d.handle === 'rotate') {
    if (Math.hypot(pointer.x - c.x, pointer.y - c.y) >= d.px) {
      const a = Math.atan2(pointer.y - c.y, pointer.x - c.x)
      let step = a - d.turn.last
      while (step > Math.PI) step -= 2 * Math.PI
      while (step <= -Math.PI) step += 2 * Math.PI
      d.turn.total += step; d.turn.last = a
    }
    const k = Math.PI / 12
    return { kind: 'rotate', centre: c, angle: mods.shift ? Math.round(d.turn.total / k) * k || 0 : d.turn.total }
  }
  const opposite: Record<Exclude<HandleId, 'rotate'>, Vec> = {
    nw: b.max, ne: { x: b.min.x, y: b.max.y }, se: b.min, sw: { x: b.max.x, y: b.min.y },
    n: { x: c.x, y: b.max.y }, s: { x: c.x, y: b.min.y }, e: { x: b.min.x, y: c.y }, w: { x: b.max.x, y: c.y },
  }
  const A = mods.alt ? c : opposite[d.handle]
  if (d.handle.length === 2) { // a corner
    const v0 = sub(d.h0, A), v = sub(H, A)
    const s = (v.x * v0.x + v.y * v0.y) / (v0.x * v0.x + v0.y * v0.y)
    const held = hold(s, Math.max(d.px / w, d.px / h, FACTOR_MIN), d.sign.s)
    d.sign.s = held.sign
    return { kind: 'scale', anchor: A, sx: held.f, sy: held.f }
  }
  if (d.handle === 'e' || d.handle === 'w') {
    const held = hold((H.x - A.x) / (d.h0.x - A.x), Math.max(d.px / w, FACTOR_MIN), d.sign.x)
    d.sign.x = held.sign
    return { kind: 'scale', anchor: { x: A.x, y: c.y }, sx: held.f, sy: 1 }
  }
  const held = hold((H.y - A.y) / (d.h0.y - A.y), Math.max(d.px / h, FACTOR_MIN), d.sign.y)
  d.sign.y = held.sign
  return { kind: 'scale', anchor: { x: c.x, y: A.y }, sx: 1, sy: held.f }
}
