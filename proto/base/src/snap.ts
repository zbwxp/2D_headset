// Snapping (editor skeleton, doc 18 §30.13) — Illustrator Smart Guides (View › Smart Guides, ⌘U) and Snap to Point:
// a point being placed or dragged lands exactly on another anchor within a few pixels; otherwise its x and / or y
// align with other anchors (a guide line is shown). Only anchors of drawn (visible) curves count; the moving ones are
// excluded by the caller. Exact positions matter here: two lines whose ends were snapped together meet at the same
// place, so the K tool can fill what they enclose (fills.ts joins anchors at the same place).
import { visibleThroughMasks, type Evaluated } from './evaluate'
import type { Vec } from './schema'

export type Snap = { p: Vec; kind: 'point' | 'align' | 'none'; target?: Vec; guides: { x?: number; y?: number } }

/**
 * Snap `p` (world coordinates). `tolerance` in world units (pixels / zoom). `exclude(curveId, anchorId)` drops anchors
 * that move with the point. Point snap wins over alignment; alignment snaps x and y independently.
 */
export function snapPoint(ev: Evaluated, p: Vec, tolerance: number, exclude: (curveId: string, anchorId: string, referenceId?: string) => boolean = () => false): Snap {
  let best: { q: Vec; d: number } | null = null
  let bx: { x: number; d: number } | null = null
  let by: { y: number; d: number } | null = null
  for (const c of ev.curves) {
    if (!c.visible) continue
    const masked = !!ev.masks?.get(c.address)?.length
    for (const a of Object.values(c.anchors)) {
      // what moves with the point is no target — also the instances of a moving source curve and of a moving reference
      // (review of 63a0efc S6: an instance snapped to itself)
      if (exclude(c.curveId, a.id, c.referenceId)) continue
      // only where the line is drawn: an anchor a mask hides is no target (review of 63a0efc S5)
      if (masked && !visibleThroughMasks(ev, c.address, a.p)) continue
      const q = a.p
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d <= tolerance && (!best || d < best.d)) best = { q, d }
      const dx = Math.abs(q.x - p.x), dy = Math.abs(q.y - p.y)
      if (dx <= tolerance && (!bx || dx < bx.d)) bx = { x: q.x, d: dx }
      if (dy <= tolerance && (!by || dy < by.d)) by = { y: q.y, d: dy }
    }
  }
  if (best) return { p: { x: best.q.x, y: best.q.y }, kind: 'point', target: { ...best.q }, guides: {} }
  if (bx || by) return { p: { x: bx ? bx.x : p.x, y: by ? by.y : p.y }, kind: 'align', guides: { ...(bx ? { x: bx.x } : {}), ...(by ? { y: by.y } : {}) } }
  return { p, kind: 'none', guides: {} }
}
