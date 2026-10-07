// Shape groups (doc 18 §30.19 / §30.22; dot 1791354232) — Illustrator's Live Paint group, adapted: painting an area the
// lines enclose gives the group of those lines a face of that colour. Illustrator ("Create Live Paint groups"): select
// one or more paths and Object › Live Paint › Make, or click them with the Live Paint Bucket; the colours belong to the
// group, the paths stay editable.
// - one command (`paintRegion`), one write, one undo: the group (new or reused), the lines moved into it, the face;
// - an area one path encloses by itself is that path's own fill instead (doc 18 §30.18, `FillRecord.owner`): no group;
// - the lines keep their ids (fills, masks, connections, families, characters name them by id) and their order;
// - they only ever move into a group INSIDE their own parent, so every container that held them still holds them
//   (masks on those containers, references placing them, locks: unchanged — the generic write check sees both places);
// - inside a shape group the faces are drawn below its other children (evaluate.paintKey);
// - a path with its own fill cut into two pieces becomes a shape group of the pieces (structure.ts breakAt,
//   `pathFillToShape`), so the whole shape keeps its colour — never only the first piece;
// - adaptation (stated): areas are closed by lines meeting at anchors (fills.ts), not split at crossings; lines from
//   different parents (layers / groups) and lines of two shape groups are refused (Illustrator would pull them into one
//   group / merge the groups — not supported yet).
import type { RecordId } from '@tldraw/store'
import { getIndexAbove, getIndexBetween, getIndicesBetween, type IndexKey } from '@tldraw/utils'
import type { EditError, IdSource, Plan } from './commands'
import { paintKey } from './evaluate'
import { sameFill } from './fills'
import { childrenOf } from './indexes'
import { boundaryGap, getAs } from './model'
import { Container, Fill, isBridge, validateRecord, type BaseReader, type BoundaryStep, type ContainerRecord, type CurveRecord, type DocRecord, type FillRecord } from './schema'

export type ShapeCommand = { type: 'paintRegion'; boundary: BoundaryStep[]; color: string; groupId?: RecordId<ContainerRecord>; fillId?: RecordId<FillRecord> }

const fail = (code: EditError['code'], message: string, objects: string[], fixes: string[] = []): Plan => ({ ok: false, error: { code, message, objects, fixes } })
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** the nearest shape group holding `id` (itself excluded), or undefined */
export function shapeGroupOf(store: BaseReader, id: string): ContainerRecord | undefined {
  const r = store.get(id as any) as { parentId?: string | null } | undefined
  for (let p = r?.parentId ? getAs(store, r.parentId as any, 'container') : undefined; p; p = p.parentId ? getAs(store, p.parentId, 'container') : undefined) if (p.shape) return p
  return undefined
}

/** the curves a boundary uses: its segments' curves and its bridges' end curves, in first-use order */
export function boundaryCurves(boundary: BoundaryStep[]): string[] {
  return [...new Set(boundary.flatMap((b) => (isBridge(b) ? [b.bridge.from.curveId, b.bridge.to.curveId] : [b.curveId]) as string[]))]
}

const byPaint = (store: BaseReader) => (a: DocRecord, b: DocRecord) => {
  const ka = paintKey(store as any, a as any), kb = paintKey(store as any, b as any)
  return ka < kb ? -1 : ka > kb ? 1 : 0
}
type Item = DocRecord & { parentId: string | null; index: string }
const siblingsOf = (store: BaseReader, parent: string | null): Item[] =>
  (['container', 'curve', 'fill', 'reference'] as const).flatMap((t) => childrenOf(store as any, parent, t).map((id) => store.get(id as any) as Item)).filter((r) => r && !(r.typeName === 'fill' && r.owner))
const byIndex = (a: Item, b: Item) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function planShape(store: BaseReader, cmd: ShapeCommand, ids: IdSource): Plan {
  if (!Array.isArray(cmd.boundary) || !cmd.boundary.length) return fail('FILL_NOT_CLOSED', 'boundary is empty', [])
  if (typeof cmd.color !== 'string' || !COLOR.test(cmd.color)) return fail('INVALID', `fill colour must be #rgb or #rrggbb (got ${cmd.color})`, [])
  try {
    validateRecord(Fill.create({ id: Fill.createId('probe'), name: '面', parentId: 'container:probe' as any, boundary: cmd.boundary }))
  } catch (e) {
    return fail('INVALID', String((e as Error).message ?? e), [])
  }
  const curveIds = boundaryCurves(cmd.boundary)
  const curves: CurveRecord[] = []
  for (const id of curveIds) {
    const c = getAs(store, id as any, 'curve')
    if (!c) return fail('NOT_FOUND', `no curve ${id}`, [id])
    curves.push(c)
  }
  const gap = boundaryGap(store, cmd.boundary)
  if (gap) return fail('FILL_NOT_CLOSED', `boundary is not closed between ${gap[0]} and ${gap[1]}`, gap, ['connect the two anchors'])

  // 1. the same area already has a colour: recolour it (its place and owner stay)
  const existing = sameFill(store, cmd.boundary)
  if (existing) {
    const f = getAs(store, existing as any, 'fill')!
    // put even when the colour is the same: the write check still refuses a locked face (nothing changes otherwise)
    return { ok: true, label: 'paintRegion', puts: [{ ...f, color: cmd.color }], affected: [f.owner?.curveId ?? shapeGroupOf(store, f.id)?.id ?? f.id, f.id] }
  }

  // 2. one path enclosing the area by itself (all its segments, nothing else) and not in a shape group: the path's own
  //    fill — an attribute of that path (doc 18 §30.18; bowen: a fill is the closed path's attribute; dot 1791356669:
  //    only an area of several lines needs a shape group)
  const only = curves.length === 1 ? curves[0] : undefined
  if (only && !shapeGroupOf(store, only.id)) {
    const used = new Set(cmd.boundary.flatMap((b) => (isBridge(b) ? [] : [b.segmentId])))
    if (only.segments.every((sg) => used.has(sg.id))) {
      const fill = Fill.create({
        id: (cmd.fillId ?? ids.take('fill', () => Fill.createId())) as RecordId<FillRecord>,
        name: '填充',
        parentId: only.parentId,
        // not used for the order (drawn just below its path, wherever that is); just below the path when made
        index: getIndexBetween((siblingsOf(store, only.parentId).sort(byIndex).filter((r) => byIndex(r, only as Item) < 0).at(-1)?.index ?? null) as IndexKey | null, only.index as IndexKey),
        boundary: structuredClone(cmd.boundary),
        color: cmd.color,
        owner: { kind: 'path', curveId: only.id },
      })
      return { ok: true, label: 'paintRegion', puts: [fill], affected: [only.id, fill.id], creates: [fill.id] }
    }
  }

  // 3. the shape group: the one the lines are already in, or a new one in their common parent
  const groups = [...new Set(curves.map((c) => shapeGroupOf(store, c.id)).filter((g): g is ContainerRecord => !!g))]
  if (groups.length > 1)
    return fail('INVALID', `这块区域的线分属不同的形状组（${groups.map((g) => g.name || g.id).join('、')}）：合并形状组暂不支持`, groups.map((g) => g.id))
  const puts: DocRecord[] = []
  const creates: string[] = []
  let group: ContainerRecord
  if (groups.length === 1) {
    group = groups[0]
    // lines outside it join it only from its own parent (they stay inside every container that held them)
    const outside = curves.filter((c) => shapeGroupOf(store, c.id)?.id !== group.id)
    const far = outside.filter((c) => c.parentId !== group.parentId)
    if (far.length)
      return fail('INVALID', `${far.map((c) => c.name || c.id).join('、')} 和形状组 ${group.name || group.id} 不在同一个图层 / 组里：跨层 / 跨组的形状暂不支持`, [group.id, ...far.map((c) => c.id)])
    if (outside.length) {
      // on top of the group's content, keeping their own order
      const top = siblingsOf(store, group.id).sort(byIndex).at(-1)?.index ?? null
      const fresh = getIndicesBetween(top as IndexKey | null, null, outside.length)
      ;[...outside].sort(byPaint(store)).forEach((c, i) => puts.push({ ...c, parentId: group.id, index: fresh[i] }))
    }
  } else {
    const parents = [...new Set(curves.map((c) => c.parentId as string))]
    if (parents.length > 1) return fail('INVALID', `这块区域的线在不同的图层 / 组里（${parents.join('、')}）：跨层 / 跨组的形状暂不支持，先把它们放到同一层`, parents)
    const parent = parents[0]
    // where ⌘G puts a group: the front-most line's place in its parent; the lines keep their order inside
    const members = [...curves].sort(byPaint(store))
    const front = members.at(-1)!
    const above = siblingsOf(store, parent).sort(byIndex).find((r) => byIndex(r, front as Item) > 0 && !curveIds.includes(r.id))
    const id = (cmd.groupId ?? ids.take('container', () => Container.createId())) as RecordId<ContainerRecord>
    group = Container.create({ id, name: '形状', parentId: parent as any, index: getIndexBetween(front.index as IndexKey, (above?.index ?? null) as IndexKey | null), shape: true })
    puts.push(group)
    creates.push(id)
    const fresh = getIndicesBetween(null, null, members.length)
    members.forEach((c, i) => puts.push({ ...c, parentId: id, index: fresh[i] }))
  }

  // 4. the face, in the group (faces are drawn below the lines whatever the index; new faces above older faces)
  const topFace = childrenOf(store as any, group.id, 'fill').map((id) => (store.get(id as any) as FillRecord).index).sort().at(-1) ?? null
  const fill = Fill.create({
    id: (cmd.fillId ?? ids.take('fill', () => Fill.createId())) as RecordId<FillRecord>,
    name: '面',
    parentId: group.id,
    index: getIndexAbove(topFace as IndexKey | null),
    boundary: structuredClone(cmd.boundary),
    color: cmd.color,
  })
  puts.push(fill)
  creates.push(fill.id)
  return { ok: true, label: 'paintRegion', puts, affected: [group.id, fill.id, ...curves.map((c) => c.id)], creates }
}

/**
 * A path's own fill whose path is cut into two pieces (dot 1791354232: the whole shape is carried by a shape group, not
 * by the first piece alone): a shape group takes the path's place in its parent, both pieces go into it (the first
 * piece below the second, as they were drawn), and each own fill becomes a face of the group. breakAt passes its
 * planned pieces and the fills as planned (boundaries already re-pointed); returns the records to put instead.
 */
export function pathFillToShape(first: CurveRecord, second: CurveRecord, owned: FillRecord[], ids: IdSource): DocRecord[] {
  const id = ids.take('container', () => Container.createId()) as RecordId<ContainerRecord>
  const group = Container.create({ id, name: '形状', parentId: first.parentId, index: first.index, shape: true })
  const [a, b] = getIndicesBetween(null, null, 2)
  const faces = getIndicesBetween(null, a, owned.length)
  return [
    group,
    { ...first, parentId: id, index: a },
    { ...second, parentId: id, index: b },
    ...owned.map((f, i) => {
      const { owner: _owner, ...face } = f
      return { ...face, name: '面', parentId: id, index: faces[i] } as FillRecord
    }),
  ]
}
