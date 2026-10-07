// The layers panel's model (editor skeleton block 1). Mature layout (Illustrator Layers panel / Figma layers list):
// a tree of layers → groups → objects, the FRONT-most item at the TOP of each level (reverse paint order), each row
// with its own visibility / lock. Here only containers carry visible / locked (schema), so only their rows toggle.
import { childrenOf, type Queryable } from '../indexes'
import type { BaseReader, ContainerRecord, CurveRecord, FillRecord, ReferenceRecord } from '../schema'

export type LayerKind = 'container' | 'curve' | 'fill' | 'reference'
export type LayerRow = {
  id: string
  kind: LayerKind
  name: string
  depth: number
  /** containers only (schema): own flags; `hiddenBy` / `lockedBy` = an enclosing container's */
  visible?: boolean
  locked?: boolean
  hiddenBy?: string
  lockedBy?: string
  hasChildren: boolean
  /** a shape group (doc 18 §30.22): its faces are its properties, not rows */
  shape?: true
}

type Item = ContainerRecord | CurveRecord | FillRecord | ReferenceRecord
const KINDS: LayerKind[] = ['container', 'curve', 'fill', 'reference']

/** children of a container (or the root), front first: the reverse of the paint order (index, then id) */
export function childrenFrontFirst(reader: BaseReader, parentId: string | null): Item[] {
  const q = reader as unknown as Queryable
  const kids = KINDS.flatMap((t) => childrenOf(q, parentId, t as any).map((id) => reader.get(id as any) as Item)).filter(Boolean)
  return kids.sort((a, b) => (a.index > b.index ? -1 : a.index < b.index ? 1 : a.id > b.id ? -1 : a.id < b.id ? 1 : 0))
}

/** The visible rows: depth-first, front first; a collapsed container hides its rows. */
export function layerRows(reader: BaseReader, expanded: (id: string) => boolean): LayerRow[] {
  const out: LayerRow[] = []
  const walk = (parentId: string | null, depth: number, hiddenBy?: string, lockedBy?: string) => {
    const parent = parentId ? (reader.get(parentId as any) as ContainerRecord | undefined) : undefined
    for (const r of rowsOf(reader, parent)) {
      const isC = r.typeName === 'container'
      const kids = isC ? rowsOf(reader, r) : []
      out.push({
        id: r.id,
        kind: r.typeName,
        name: r.name,
        depth,
        ...(isC ? { visible: r.visible, locked: r.locked } : {}),
        ...(isC && r.shape ? { shape: true as const } : {}),
        ...(hiddenBy ? { hiddenBy } : {}),
        ...(lockedBy ? { lockedBy } : {}),
        hasChildren: kids.length > 0,
      })
      if (isC && kids.length && expanded(r.id)) walk(r.id, depth + 1, hiddenBy ?? (r.visible ? undefined : r.id), lockedBy ?? (r.locked ? r.id : undefined))
    }
  }
  walk(null, 0)
  return out
}
/** the children shown as rows: a shape group's faces and a path's own fill are not rows (they are listed in the shape's /
 *  path's properties) */
const rowsOf = (reader: BaseReader, c: ContainerRecord | undefined): Item[] =>
  childrenFrontFirst(reader, c?.id ?? null).filter((k) => !(k.typeName === 'fill' && (c?.shape || (k as FillRecord).owner)))

/** Shift+click in the list: the rows between the anchor row and this one (Figma / Finder range selection) */
export function rangeOf(rows: LayerRow[], from: string, to: string): string[] {
  const i = rows.findIndex((r) => r.id === from), j = rows.findIndex((r) => r.id === to)
  if (i < 0 || j < 0) return [to]
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((r) => r.id)
}
