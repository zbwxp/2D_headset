// Arrange / group / layers (editor skeleton, doc 18 §30.6) — Illustrator Object › Arrange and Group, the Layers panel's
// New Layer. Only `parentId` / `index` change (the paint order is the index order, PAINT-ORDER.md); geometry never.
// - arrange: within each object's own parent — front / back = the top / bottom of its siblings, forward / backward = one
//   place past the next sibling that is not selected; several selected keep their order (Illustrator).
// - group (⌘G): a new group in the parent of the FRONT-most selected object, at its place; the members keep their paint
//   order. ungroup (⇧⌘G): the children take the group's place in its parent; the group record goes (refused, by name,
//   while a reference places it or a mask names it). A layer (top-level container) is not ungrouped.
// - createContainer: a new layer (or group) on top of its parent.
import type { RecordId } from '@tldraw/store'
import { getIndexAbove, getIndexBetween, getIndicesBetween, type IndexKey } from '@tldraw/utils'
import type { EditError, IdSource, Plan } from './commands'
import { paintKey } from './evaluate'
import { childrenOf, referencesOf } from './indexes'
import { getAs, lockedBy } from './model'
import { Container, type BaseReader, type ContainerRecord, type DocRecord } from './schema'

export type ArrangeCommand =
  | { type: 'arrange'; ids: string[]; to: 'front' | 'forward' | 'backward' | 'back' }
  | { type: 'group'; ids: string[]; id?: RecordId<ContainerRecord>; name?: string }
  | { type: 'ungroup'; ids: string[] }
  | { type: 'createContainer'; id?: RecordId<ContainerRecord>; parentId: RecordId<ContainerRecord> | null; name?: string }

type Item = DocRecord & { parentId: string | null; index: string }
const KINDS = ['container', 'curve', 'fill', 'reference'] as const
const fail = (code: EditError['code'], message: string, objects: string[], fixes: string[] = []): Plan => ({ ok: false, error: { code, message, objects, fixes } })
const byOrder = (a: Item, b: Item) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
/** the ordered siblings; a path's own fill is not one (it is drawn with its path, doc 18 §30.18 — its index is unused) */
const siblings = (store: BaseReader, parent: string | null): Item[] =>
  KINDS.flatMap((t) => childrenOf(store as any, parent, t).map((id) => store.get(id as any) as Item)).filter((r) => r && !(r.typeName === 'fill' && r.owner)).sort(byOrder)
const isItem = (r: DocRecord | undefined): r is Item => !!r && (KINDS as readonly string[]).includes(r.typeName)

/** the items, each refused when it (or its container chain) is locked; nested selections drop the inner one */
function itemsOf(store: BaseReader, ids: string[]): Item[] | Plan {
  const out: Item[] = []
  for (const id of ids) {
    const r = store.get(id as any) as DocRecord | undefined
    if (!isItem(r)) return fail('NOT_FOUND', `${id} is not a container, curve, fill or reference`, [id])
    const locker = r.typeName === 'container' && (r as ContainerRecord).locked ? r : lockedBy(store, r.parentId as any)
    if (locker) return fail('LOCKED', `${id} is in locked container ${locker.id}`, [id, locker.id], [`unlock ${locker.id}`])
    out.push(r)
  }
  const sel = new Set(out.map((r) => r.id as string))
  const insideSelected = (r: Item) => {
    for (let p = r.parentId; p; p = (store.get(p as any) as Item | undefined)?.parentId ?? null) if (sel.has(p)) return true
    return false
  }
  return out.filter((r) => !insideSelected(r))
}

export function planArrange(store: BaseReader, cmd: ArrangeCommand, ids: IdSource): Plan {
  if (cmd.type === 'createContainer') {
    if (cmd.parentId !== null && !getAs(store, cmd.parentId, 'container')) return fail('NOT_FOUND', `no container ${cmd.parentId}`, [String(cmd.parentId)])
    const top = siblings(store, cmd.parentId).at(-1)?.index ?? null
    const id = (cmd.id ?? ids.take('container', () => Container.createId())) as RecordId<ContainerRecord>
    const c = Container.create({ id, name: cmd.name?.trim() || (cmd.parentId ? '组' : '图层'), parentId: cmd.parentId, index: getIndexAbove(top as IndexKey | null) })
    return { ok: true, label: 'createContainer', puts: [c], affected: [id], creates: [id] }
  }
  if (!Array.isArray(cmd.ids) || !cmd.ids.length) return fail('INVALID', 'nothing selected', [])
  const items = itemsOf(store, cmd.ids)
  if (!Array.isArray(items)) return items

  if (cmd.type === 'arrange') {
    if (!['front', 'forward', 'backward', 'back'].includes(cmd.to)) return fail('INVALID', `to must be front, forward, backward or back (got ${cmd.to})`, [])
    const puts: DocRecord[] = []
    const parents = [...new Set(items.map((r) => r.parentId))]
    for (const parent of parents) {
      const all = siblings(store, parent)
      const moving = new Set(items.filter((r) => r.parentId === parent).map((r) => r.id as string))
      // the new order of this parent's children, then fresh indices only where the order changed
      let order = [...all]
      if (cmd.to === 'front' || cmd.to === 'back') {
        const stay = order.filter((r) => !moving.has(r.id)), go = order.filter((r) => moving.has(r.id))
        order = cmd.to === 'front' ? [...stay, ...go] : [...go, ...stay]
      } else if (cmd.to === 'forward') {
        for (let i = order.length - 2; i >= 0; i--) if (moving.has(order[i].id) && !moving.has(order[i + 1].id)) [order[i], order[i + 1]] = [order[i + 1], order[i]]
      } else {
        for (let i = 1; i < order.length; i++) if (moving.has(order[i].id) && !moving.has(order[i - 1].id)) [order[i], order[i - 1]] = [order[i - 1], order[i]]
      }
      if (order.every((r, i) => r.id === all[i].id)) continue
      const fresh = getIndicesBetween(null, null, order.length)
      order.forEach((r, i) => {
        if (r.index !== fresh[i]) puts.push({ ...r, index: fresh[i] } as DocRecord)
      })
    }
    return { ok: true, label: 'arrange', puts, affected: items.map((r) => r.id as string) }
  }

  if (cmd.type === 'group') {
    // the group goes where the front-most selected object is, in its parent
    const front = [...items].sort((a, b) => (paintKey(store as any, a as any) < paintKey(store as any, b as any) ? -1 : 1)).at(-1)!
    const parent = front.parentId
    if (parent === null) return fail('INVALID', 'layers are not grouped (select objects inside layers)', items.map((r) => r.id))
    const sibs = siblings(store, parent)
    const above = sibs.find((r) => byOrder(r, front) > 0 && !items.some((x) => x.id === r.id))
    const id = (cmd.id ?? ids.take('container', () => Container.createId())) as RecordId<ContainerRecord>
    const group = Container.create({ id, name: cmd.name?.trim() || '组', parentId: parent as any, index: getIndexBetween(front.index as IndexKey, (above?.index ?? null) as IndexKey | null) })
    const members = [...items].sort((a, b) => (paintKey(store as any, a as any) < paintKey(store as any, b as any) ? -1 : 1))
    const fresh = getIndicesBetween(null, null, members.length)
    return { ok: true, label: 'group', puts: [group, ...members.map((r, i) => ({ ...r, parentId: id, index: fresh[i] }) as DocRecord)], affected: [id, ...members.map((r) => r.id as string)], creates: [id] }
  }

  // ungroup
  const puts: DocRecord[] = []
  const removals: string[] = []
  for (const g of items) {
    if (g.typeName !== 'container') return fail('INVALID', `${g.id} is not a group`, [g.id])
    if (g.parentId === null) return fail('INVALID', `${g.id} is a layer: a layer is not ungrouped`, [g.id])
    // a shape group's faces are its own (Illustrator: a Live Paint group is not simply ungrouped, only released /
    // expanded — not here yet): ungrouping is refused while it has a face
    const faces = (g as ContainerRecord).shape ? childrenOf(store as any, g.id as any, 'fill') : []
    if (faces.length) return fail('INVALID', `形状组 ${(g as ContainerRecord).name || g.id} 还有面的颜色：先在属性里清除它们，再取消编组`, [g.id, ...faces])
    const refs = referencesOf(store as any, g.id as any)
    if (refs.length) return fail('BAD_REFERENCE', `${g.id} is placed by ${refs.join(', ')}: ungrouping would remove what they place`, [g.id, ...refs])
    const masks = store.allRecords().filter((m: any) => m.typeName === 'mask' && m.targets.includes(g.id)).map((m) => m.id as string)
    if (masks.length) return fail('BAD_REFERENCE', `${g.id} is a target of ${masks.join(', ')}: ungrouping would leave the mask without it`, [g.id, ...masks])
    const kids = siblings(store, g.id)
    // the children take the group's place: between the group's index and the next sibling above it
    const above = siblings(store, g.parentId).find((r) => byOrder(r, g) > 0)
    const fresh = kids.length ? getIndicesBetween(g.index as IndexKey, (above?.index ?? null) as IndexKey | null, kids.length) : []
    kids.forEach((k, i) => puts.push({ ...k, parentId: g.parentId, index: fresh[i] } as DocRecord))
    removals.push(g.id)
  }
  return { ok: true, label: 'ungroup', puts, removals, affected: [...removals, ...puts.map((r) => r.id as string)] }
}
