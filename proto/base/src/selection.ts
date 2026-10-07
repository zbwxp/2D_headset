// Selection — editor skeleton block 1 (doc 18 §30). Standard behaviour, taken from mature tools (sources):
// - Illustrator Selection tool: a click selects the object under the cursor; "with the Selection tool, grouped objects
//   are treated as a single unit" — the unit is the outermost group below the layer, else the object itself.
//   https://helpx.adobe.com/illustrator/using/selecting-objects.html
// - Illustrator marquee: "the default marquee selection selects any object that is partially inside the marquee";
//   pressing E while dragging switches to the enclosed mode (only objects completely inside). (same page)
// - Illustrator: Cmd / Ctrl+click selects the object BEHIND the selected one at that point ("select behind");
//   Figma: right-click "Select layer" lists the stack — here the stack is `unitsAt`.
// - Inkscape / Illustrator: selecting is not an undo step; after undo / redo the selection keeps the ids that still
//   exist (`prune`).
// Project adaptations (marked): a reference instance is selected on its PLACEMENT side (the reference record, doc 18
// §21.2); the top-level containers are the layers (Illustrator layers), picked from the layers panel, not the canvas.
import { atom, type Atom } from '@tldraw/state'
import { fillContains, hitStack, imagePixelAt, itemCubics, type Cubic, type EvalCurve, type EvalFill, type Evaluated } from './evaluate'
import { childrenOf, connectionsAt, fillsUsing, ownFillsOf, type Queryable, placedChildren } from './indexes'
import { anchorKey } from './model'
import { poseIdOf, type BaseReader, type DocRecord, type FillRecord, type MaskRecord, type Vec } from './schema'

type Reader = Pick<BaseReader, 'get'>
/** a path's own fill counts as part of its path (doc 18 §30.18): selected, grouped under and inside it */
const parentOf = (reader: Reader, id: string): string | null => {
  const r = reader.get(id as any) as (DocRecord & { parentId?: string | null }) | undefined
  if (r?.typeName === 'fill' && r.owner) return r.owner.curveId
  return r && 'parentId' in r ? (r.parentId ?? null) : null
}

/** the record a drawn item is placed by: a reference instance (`reference:R/curve:C`) → the reference */
export const placedOf = (address: string) => address.split('/')[0]

/** The selection unit of a record (Illustrator Selection tool): the outermost container below the layer that holds
 *  it, else the record itself; a layer (top-level container) is its own unit. */
export function unitOf(reader: Reader, id: string): string {
  let unit = id
  let parent = parentOf(reader, id)
  if (parent === null) return id
  while (parentOf(reader, parent) !== null) {
    unit = parent
    parent = parentOf(reader, parent)!
  }
  return unit
}

/** The layer (top-level container) a record is in, or null for a record at the root. */
export function layerOf(reader: Reader, id: string): string | null {
  let top: string | null = null
  for (let p = parentOf(reader, id); p !== null; p = parentOf(reader, p)) top = p
  return top
}

/** Selection units under `p`, front to back (paint order; masks and own ink as drawn — `hitStack`). */
export function unitsAt(reader: Reader, ev: Evaluated, p: Vec, tolerance: number): string[] {
  const out: string[] = []
  for (const h of hitStack(ev, p, tolerance)) {
    const u = unitOf(reader, placedOf(h.address))
    if (!out.includes(u)) out.push(u)
  }
  return out
}

/**
 * The unit a click selects: the topmost (plain click), or — `behind` (Cmd / Ctrl+click) — the one below the deepest
 * currently selected unit under the cursor (the topmost when none of them is there; the last one stays at the bottom).
 */
export function pickAt(reader: Reader, ev: Evaluated, p: Vec, tolerance: number, behind?: readonly string[]): string | null {
  const stack = unitsAt(reader, ev, p, tolerance)
  if (!stack.length) return null
  if (!behind?.length) return stack[0]
  const deepest = Math.max(...behind.map((id) => stack.indexOf(id)))
  return deepest < 0 ? stack[0] : stack[Math.min(deepest + 1, stack.length - 1)]
}

export type Rect = { x0: number; y0: number; x1: number; y1: number }
const norm = (r: Rect): Rect => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) })
const inside = (r: Rect, q: Vec) => q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1
const at = (c: Cubic, t: number): Vec => {
  const u = 1 - t
  return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y }
}
/** a cubic as a polyline (marquee geometry: the path, as Illustrator's marquee uses the path, not the ink) */
const SAMPLES = 24
const polyline = (cubics: Cubic[]): Vec[] => cubics.flatMap((c, i) => Array.from({ length: SAMPLES + (i === cubics.length - 1 ? 1 : 0) }, (_, k) => at(c, k / SAMPLES)))
const crosses = (a: Vec, b: Vec, r: Rect) => {
  // segment ab against the rectangle's four sides (Liang–Barsky clip)
  let t0 = 0, t1 = 1
  const dx = b.x - a.x, dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return true
}

/**
 * Units the marquee selects: touching (default) = any drawn item of the unit has path geometry in the rectangle (a fill
 * also when the rectangle lies inside it); `enclosed` = every drawn item of the unit lies completely inside. Hidden and
 * locked items are not selectable. In paint order, back to front.
 */
export function unitsInRect(reader: Reader, ev: Evaluated, rect: Rect, enclosed = false): string[] {
  const r = norm(rect)
  const touched = new Set<string>()
  const outside = new Set<string>()
  const units: string[] = []
  for (const entry of ev.paint) {
    const item = entry.item
    if (!item.visible || item.locked) continue
    const u = unitOf(reader, placedOf(item.address))
    if (!units.includes(u)) units.push(u)
    const pts = polyline(itemCubics(entry))
    if (enclosed) {
      if (pts.length && pts.every((q) => inside(r, q))) touched.add(u)
      else outside.add(u)
      continue
    }
    const hit =
      pts.some((q) => inside(r, q)) ||
      pts.some((q, i) => i > 0 && crosses(pts[i - 1], q, r)) ||
      (entry.kind === 'fill' && fillContains(entry.item, { x: r.x0, y: r.y0 })) ||
      (entry.kind === 'image' && !!imagePixelAt(entry.item, { x: r.x0, y: r.y0 }))
    if (hit) touched.add(u)
  }
  return units.filter((u) => touched.has(u) && !outside.has(u))
}

/** Every selectable unit (Cmd / Ctrl+A: Illustrator Select All — visible, unlocked objects). */
export function allUnits(reader: Reader, ev: Evaluated): string[] {
  const out: string[] = []
  for (const entry of ev.paint) {
    if (!entry.item.visible || entry.item.locked) continue
    const u = unitOf(reader, placedOf(entry.item.address))
    if (!out.includes(u)) out.push(u)
  }
  return out
}

/**
 * The selection: an ordered id list, and the selected anchors (`curve:C#a`, Direct Selection). Not part of the document
 * and not an undo step (Inkscape / Illustrator).
 */
export class Selection {
  readonly ids: Atom<readonly string[]> = atom('selection', [])
  readonly anchors: Atom<readonly string[]> = atom('selected anchors', [])
  getAnchors(): readonly string[] {
    return this.anchors.get()
  }
  setAnchors(keys: readonly string[]) {
    const next = [...new Set(keys)]
    const now = this.anchors.get()
    if (next.length !== now.length || next.some((x, i) => x !== now[i])) this.anchors.set(next)
  }
  get(): readonly string[] {
    return this.ids.get()
  }
  set(ids: readonly string[]) {
    const next = [...new Set(ids)]
    const now = this.ids.get()
    if (next.length !== now.length || next.some((x, i) => x !== now[i])) this.ids.set(next)
  }
  clear() {
    this.set([])
    this.setAnchors([])
  }
  /** Shift+click: add an unselected unit, remove a selected one */
  toggle(id: string) {
    const now = this.ids.get()
    this.set(now.includes(id) ? now.filter((x) => x !== id) : [...now, id])
  }
  add(ids: readonly string[]) {
    this.set([...this.ids.get(), ...ids])
  }
  /** after undo / redo / any edit: keep the ids that still exist */
  prune(reader: Reader) {
    this.set(this.ids.get().filter((id) => reader.get(id as any)))
    this.setAnchors(this.anchors.get().filter((k) => {
      const [c, a] = k.split('#')
      return !!(reader.get(c as any) as { anchors?: Record<string, unknown> } | undefined)?.anchors?.[a]
    }))
  }
}

/**
 * What Delete removes (Illustrator: the selected objects with everything inside them): each id, a container's whole
 * content, and the records a removed curve owns — its own fill (doc 18 §30.18), its connections and its head-turn track (project
 * adaptation: they cannot outlive the curve). Anything else that still depends on a removed record (a fill bounded by
 * a removed line, a mask naming it) is left to `deleteRecords`, which refuses and names it.
 */
export function deletionSetOf(reader: BaseReader, ids: readonly string[]): string[] {
  const out = new Set<string>()
  const q = reader as unknown as Queryable
  const visit = (id: string) => {
    if (out.has(id)) return
    const r = reader.get(id as any) as DocRecord | undefined
    if (!r) return
    out.add(id)
    if (r.typeName === 'container') placedChildren(q, r.id).forEach(visit)
    if (r.typeName === 'curve') {
      for (const a of Object.keys(r.anchors)) connectionsAt(q, anchorKey({ curveId: r.id, anchorId: a })).forEach((c) => out.add(c))
      if (reader.get(poseIdOf(r.id) as any)) out.add(poseIdOf(r.id))
      ownFillsOf(q, r.id).forEach((f) => out.add(f)) // its own fill is part of it
      // a colourless face reading it is only a remembered area (doc 18 §30.24): it goes too; a coloured one is named
      fillsUsing(q, r.id).forEach((f) => (reader.get(f as any) as FillRecord | undefined)?.color === 'none' && out.add(f))
    }
  }
  ids.forEach(visit)
  return [...out]
}

/** The drawn bounds of the selected units (their items' path geometry, sampled), or null when nothing is drawn. */
export function boundsOf(reader: Reader, ev: Evaluated, units: readonly string[]): Rect | null {
  if (!units.length) return null
  let r: Rect | null = null
  for (const entry of ev.paint) {
    if (!entry.item.visible) continue
    if (!units.some((u) => isInside(reader, placedOf(entry.item.address), u))) continue
    for (const q of polyline(itemCubics(entry))) r = r ? { x0: Math.min(r.x0, q.x), y0: Math.min(r.y0, q.y), x1: Math.max(r.x1, q.x), y1: Math.max(r.y1, q.y) } : { x0: q.x, y0: q.y, x1: q.x, y1: q.y }
  }
  return r
}

/** `id` is `container` or lies anywhere inside it */
export function isInside(reader: Reader, id: string, container: string): boolean {
  for (let x: string | null = id; x !== null; x = parentOf(reader, x)) if (x === container) return true
  return false
}

/** The drawn items (paint addresses) a selection covers: a unit's items, or everything inside a selected container. */
export function drawnOf(reader: Reader, ev: Evaluated, units: readonly string[]): string[] {
  return ev.paint.filter((e) => e.item.visible && units.some((u) => isInside(reader, placedOf(e.item.address), u))).map((e) => e.item.address)
}

/** Direct Selection marquee: the anchors (`curve:C#a`) of visible, unlocked, directly drawn curves inside the rectangle */
export function anchorsInRect(ev: Evaluated, rect: Rect): string[] {
  const r = norm(rect)
  return ev.curves.filter((c) => c.visible && !c.locked && !c.referenceId).flatMap((c) => Object.values(c.anchors).filter((a) => inside(r, a.p)).map((a) => `${c.curveId}#${a.id}`))
}

/**
 * The masks a record takes part in: as a source or target itself, through a container it is inside (a target layer /
 * group), or — a selected container — through the sources / targets inside it (a group made a mask source is
 * recorded as its fills and lines; review of 3ef87db M1). Role: 'target' when it is (in) a target, else 'source'.
 */
export function masksOf(reader: BaseReader, id: string): { mask: MaskRecord; role: 'target' | 'source' }[] {
  const out: { mask: MaskRecord; role: 'target' | 'source' }[] = []
  const touches = (x: string) => x === id || isInside(reader, x, id) || isInside(reader, id, x)
  for (const m of reader.allRecords().filter((r): r is MaskRecord => r.typeName === 'mask')) {
    if (m.targets.some(touches)) out.push({ mask: m, role: 'target' })
    else if ([...m.sources.fills, ...m.sources.strokes].some(touches)) out.push({ mask: m, role: 'source' })
  }
  return out
}
