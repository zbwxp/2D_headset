// Stage 4 (doc 18 §21.3): independent copy. The copied AUTHOR objects get new ids and their internal dependencies are
// re-pointed to the copies; what crosses the selection boundary is handled by kind (dot 1791304613; tldraw
// `withIsolatedShapes`, packages/editor/src/lib/editor/Editor.ts v5.5.2 — bindings with one end outside are removed):
// - a connection with BOTH ends copied is copied (re-pointed); one end outside → not copied (never re-bound to the
//   original);
// - a required geometric dependency outside the selection (a copied fill whose boundary reads a curve that is not
//   copied) → refused, naming it; a reference keeps its source when the source is not copied (it is a placement);
// - a copied curve's legacy head-turn track is copied with it.
// Limit (stated): preset-form (family) curves are not duplicated yet — refused (their family registration, every
// preset's forms and the characters' data would all need copying).
import type { RecordId } from '@tldraw/store'
import type { EditError, IdSource, Plan } from './commands'
import { connectionsAt, containersWithin, familiesOf, within } from './indexes'
import { anchorKey, getAs } from './model'
import { isBridge, poseIdOf, type BaseReader, type BoundaryStep, type ConnectionRecord, type ContainerRecord, type CurveRecord, type DocRecord, type FillRecord, type FormsRecord, type ReferenceRecord } from './schema'

export type DuplicateCommand = { type: 'duplicate'; ids: string[]; parentId?: RecordId<ContainerRecord> }
const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })

export function planDuplicate(store: BaseReader, cmd: DuplicateCommand, ids: IdSource): Plan {
  if (!Array.isArray(cmd.ids) || !cmd.ids.length) return fail('INVALID', 'nothing to duplicate', [])
  if (cmd.parentId && !getAs(store, cmd.parentId, 'container')) return fail('NOT_FOUND', `no container ${cmd.parentId}`, [String(cmd.parentId)])
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
  const exists = (id: string) => !!store.get(id as any)
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
  const puts: DocRecord[] = []
  for (const r of recs) {
    const id = map.get(r.id)! as any
    if (r.typeName === 'container') puts.push({ ...r, id, parentId: top(r.parentId) as any })
    else if (r.typeName === 'curve') {
      puts.push({ ...structuredClone(r), id, parentId: top(r.parentId) as any })
      const track = getAs(store, poseIdOf(r.id), 'forms') as FormsRecord | undefined
      if (track) puts.push({ ...structuredClone(track), id: poseIdOf(id), curveId: id })
    } else if (r.typeName === 'fill')
      puts.push({ ...structuredClone(r), id, parentId: top(r.parentId) as any, boundary: r.boundary.map((b) => (isBridge(b) ? { bridge: { from: { ...b.bridge.from, curveId: to(b.bridge.from.curveId) }, to: { ...b.bridge.to, curveId: to(b.bridge.to.curveId) } } } : { ...b, curveId: to(b.curveId) })) })
    else if (r.typeName === 'reference') {
      const src = to(r.sourceId)
      const overrides = Object.fromEntries(Object.entries(r.overrides).map(([k, p]) => {
        const i = k.lastIndexOf('#')
        return [`${to(k.slice(0, i))}#${k.slice(i + 1)}`, { ...p }]
      }))
      puts.push({ ...(r as ReferenceRecord), id, parentId: top(r.parentId) as any, sourceId: src, overrides })
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
  return { ok: true, label: 'duplicate', puts, affected: creates, creates }
}
