// Stage 4 (doc 18 §21.3): independent copy. The copied AUTHOR objects get new ids and their internal dependencies are
// re-pointed to the copies; what crosses the selection boundary is handled by kind (dot 1791304613; tldraw
// `withIsolatedShapes`, packages/editor/src/lib/editor/Editor.ts v5.5.2 — bindings with one end outside are removed):
// - a connection with BOTH ends copied is copied (re-pointed); one end outside → not copied (never re-bound to the
//   original);
// - a required geometric dependency outside the selection (a copied fill whose boundary reads a curve that is not
//   copied) → refused, naming it; a reference keeps its source when the source is not copied (it is a placement);
// - a copied curve's legacy head-turn track is copied with it.
// - paint order (one explicit policy; ids carry identity only, never order — dot 1791317344): the copied top-level
//   objects go as ONE block on top of their destination container, in the originals' total paint order (`paintKey`:
//   index, then id at every level); inside a copied container the copies get fresh indices in the originals' total
//   order, so two originals sharing an index can never swap through the new ids' tie-break.
// Limit (stated): preset-form (family) curves are not duplicated yet — refused (their family registration, every
// preset's forms and the characters' data would all need copying).
import type { RecordId } from '@tldraw/store'
import { getIndicesBetween, type IndexKey } from '@tldraw/utils'
import type { EditError, IdSource, Plan } from './commands'
import { connectionsAt, containersWithin, familiesOf, ownFillsOf, within } from './indexes'
import { paintKey } from './evaluate'
import { anchorKey, getAs } from './model'
import { isBridge, poseIdOf, type BaseReader, type BoundaryStep, type ConnectionRecord, type ContainerRecord, type CurveRecord, type DocRecord, type FillRecord, type FormsRecord, type ReferenceRecord } from './schema'

export type DuplicateCommand = { type: 'duplicate'; ids: string[]; parentId?: RecordId<ContainerRecord> }
const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })

export function planDuplicate(store: BaseReader, cmd: DuplicateCommand, ids: IdSource): Plan {
  return planCopyInto(store, store, cmd, ids, 'duplicate')
}

/**
 * The copy itself, reading the originals from `src` and placing the copies into `dst` (the same store for duplicate;
 * the clipboard content's own store for paste, clipboard.ts). Same rules either way.
 */
export function planCopyInto(src: BaseReader, dst: BaseReader, cmd: DuplicateCommand, ids: IdSource, label: string, idMap?: Map<string, string>): Plan {
  const store = src
  if (!Array.isArray(cmd.ids) || !cmd.ids.length) return fail('INVALID', 'nothing to duplicate', [])
  if (cmd.parentId && !getAs(dst, cmd.parentId, 'container')) return fail('NOT_FOUND', `no container ${cmd.parentId}`, [String(cmd.parentId)])
  // the selection, closed under containment (a container brings everything inside it)
  const sel = new Set<string>()
  for (const id of cmd.ids) {
    const r = store.get(id as any) as DocRecord | undefined
    if (!r || !['container', 'curve', 'fill', 'reference'].includes(r.typeName)) return fail('NOT_FOUND', `${id} is not a container, curve, fill or reference`, [id])
    sel.add(id)
    if (r.typeName === 'container') for (const c of containersWithin(store, r.id)) {
      sel.add(c)
      for (const t of ['curve', 'fill', 'reference'] as const) for (const x of within(store, c, t)) sel.add(x)
    }
  }
  // a path's own fill goes with its path (doc 18 §30.18)
  for (const id of [...sel]) for (const f of ownFillsOf(store, id)) sel.add(f)
  const recs = [...sel].sort().map((id) => store.get(id as any) as DocRecord)
  const curves = recs.filter((r): r is CurveRecord => r.typeName === 'curve')
  const fam = curves.filter((c) => familiesOf(store, c.id).length)
  if (fam.length) return fail('INVALID', `${fam.map((c) => c.id).join(', ')} belong to a preset family: duplicating preset-form curves is not supported yet`, fam.map((c) => c.id))
  // required geometric dependencies: every curve a copied fill reads must be copied too
  for (const f of recs.filter((r): r is FillRecord => r.typeName === 'fill')) {
    const reads = f.boundary.flatMap((b: BoundaryStep) => (isBridge(b) ? [b.bridge.from.curveId, b.bridge.to.curveId] : [b.curveId]))
    const outside = [...new Set(reads.filter((c) => !sel.has(c)))]
    if (outside.length) return fail('INVALID', `fill ${f.id} reads ${outside.join(', ')}, which is not being duplicated: include it or leave the fill out`, [f.id, ...outside])
  }
  // one identity plan: the n-th original (in id order) gets the n-th new id of its type
  const exists = (id: string) => !!dst.get(id as any) || (src !== dst && !!src.get(id as any))
  const map = new Map<string, string>()
  for (const r of recs) {
    const id = ids.take(`dup:${r.typeName}`, () => {
      let n = `${r.id}~copy`
      for (let k = 1; exists(n) || [...map.values()].includes(n); k++) n = `${r.id}~copy${k}`
      return n
    })
    if (exists(id) || [...map.values()].includes(id)) return fail('ID_CONFLICT', `the prepared new id ${id} is already used: prepare a new operation`, [id])
    map.set(r.id, id)
  }
  const to = <T extends string>(id: T): T => (map.get(id) ?? id) as T
  const top = (parent: string | null) => (parent && sel.has(parent) ? to(parent) : (cmd.parentId ?? parent))
  // paint order: per new parent, the originals in their total paint order get fresh indices that keep that order
  const index = new Map<string, string>()
  const groups = new Map<string | null, (DocRecord & { parentId: any; index: string })[]>()
  for (const r of recs as (DocRecord & { parentId: any; index: string })[]) {
    const parent = top(r.parentId)
    groups.set(parent, [...(groups.get(parent) ?? []), r])
  }
  for (const [parent, members] of groups) {
    const inCopy = !!parent && [...map.values()].includes(parent)
    // a new container's content starts empty; an existing destination: above its current topmost child
    const topmost = inCopy ? null : dst.allRecords().filter((x: any) => ['container', 'curve', 'fill', 'reference'].includes(x.typeName) && (x.parentId ?? null) === parent).map((x: any) => x.index as string).reduce<string | null>((m, i) => (m === null || i > m ? i : m), null)
    const order = members.map((r) => ({ r, key: paintKey(store, r) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    let fresh: IndexKey[]
    try {
      fresh = getIndicesBetween(topmost as IndexKey | null, null, order.length)
    } catch {
      return fail('INVALID', `${parent ?? 'the top level'} holds an index that is not a fractional index (${topmost}): cannot place the copies`, parent ? [parent] : [])
    }
    order.forEach(({ r }, i) => index.set(r.id, fresh[i]))
  }
  const puts: DocRecord[] = []
  for (const r of recs) {
    const id = map.get(r.id)! as any
    if (r.typeName === 'container') puts.push({ ...r, id, parentId: top(r.parentId) as any, index: index.get(r.id)! })
    else if (r.typeName === 'curve') {
      puts.push({ ...structuredClone(r), id, parentId: top(r.parentId) as any, index: index.get(r.id)! })
      const track = getAs(store, poseIdOf(r.id), 'forms') as FormsRecord | undefined
      if (track) puts.push({ ...structuredClone(track), id: poseIdOf(id), curveId: id })
    } else if (r.typeName === 'fill')
      puts.push({ ...structuredClone(r), id, parentId: top(r.parentId) as any, index: index.get(r.id)!, ...(r.owner ? { owner: { kind: 'path' as const, curveId: to(r.owner.curveId) } } : {}), boundary: r.boundary.map((b) => (isBridge(b) ? { bridge: { from: { ...b.bridge.from, curveId: to(b.bridge.from.curveId) }, to: { ...b.bridge.to, curveId: to(b.bridge.to.curveId) } } } : { ...b, curveId: to(b.curveId) })) })
    else if (r.typeName === 'reference') {
      const src = to(r.sourceId)
      // override keys name curves of the SOURCE: they follow to the copies only when the reference itself now places
      // the copied source; a copy still placing the original source keeps its keys (dot 1791317224)
      const remap = src !== r.sourceId
      const overrides = Object.fromEntries(Object.entries(r.overrides).map(([k, p]) => {
        const i = k.lastIndexOf('#')
        return [remap ? `${to(k.slice(0, i))}#${k.slice(i + 1)}` : k, { ...p }]
      }))
      puts.push({ ...(r as ReferenceRecord), id, parentId: top(r.parentId) as any, index: index.get(r.id)!, sourceId: src, overrides })
    }
  }
  // connections: copied only when every end is copied (re-pointed); a connection reaching outside is not copied
  const conns = new Set(curves.flatMap((c) => Object.keys(c.anchors).flatMap((a) => connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a })))))
  for (const cid of [...conns].sort()) {
    const cn = getAs(store, cid, 'connection') as ConnectionRecord
    if (!cn.ends.every((e) => sel.has(e.curveId))) continue
    const nid = ids.take('dup:connection', () => {
      let n = `${cn.id}~copy`
      for (let k = 1; exists(n) || [...map.values()].includes(n); k++) n = `${cn.id}~copy${k}`
      return n
    })
    if (exists(nid)) return fail('ID_CONFLICT', `the prepared new id ${nid} is already used`, [nid])
    map.set(cn.id, nid)
    puts.push({ ...cn, id: nid as any, ends: cn.ends.map((e) => ({ ...e, curveId: to(e.curveId) })) })
  }
  const creates = puts.map((r) => r.id as string)
  if (idMap) for (const [k, v] of map) idMap.set(k, v)
  return { ok: true, label, puts, affected: creates, creates }
}
