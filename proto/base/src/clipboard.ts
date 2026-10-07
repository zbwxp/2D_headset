// Copy / paste (editor skeleton block 3, doc 18 §30.3). Mature model: tldraw — copy serializes the selected content
// (shapes with their descendants and the bindings wholly inside it, with the schema versions); paste migrates and
// validates that content, gives it new ids and puts it on the page (`putContentOntoCurrentPage`). Placement follows
// Illustrator: ⌘V = at the centre of the view, ⇧⌘V = in place; into the current layer, on top, then selected.
// The copy rules are the duplicate's (duplicate.ts `planCopyInto`): one place for what crosses the boundary.
import { Store, type RecordId, type SerializedSchema } from '@tldraw/store'
import type { EditError, IdSource, Plan } from './commands'
import { planCopyInto } from './duplicate'
import { connectionsAt, containersWithin, familiesOf, within } from './indexes'
import { anchorKey, getAs } from './model'
import { isBridge, poseIdOf, schema, type BaseReader, type ContainerRecord, type CurveRecord, type DocRecord, type FillRecord, type ReferenceRecord, type Vec } from './schema'

export const CONTENT_KIND = 'contour/content'
export type Content = { kind: typeof CONTENT_KIND; schema: SerializedSchema; records: DocRecord[] }
export type PasteCommand = { type: 'pasteContent'; content: Content; parentId: RecordId<ContainerRecord>; offset?: Vec }

const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })

/**
 * The content a copy puts on the clipboard: the selected containers / curves / fills / references, everything inside a
 * selected container, a copied curve's head-turn track, and the connections with every end copied. Refused (named) as
 * duplicate refuses: a fill whose boundary reads a curve left out, a preset-form curve.
 */
export function contentOf(reader: BaseReader, ids: readonly string[]): Content | { error: EditError } {
  const sel = new Set<string>()
  for (const id of ids) {
    const r = reader.get(id as any) as DocRecord | undefined
    if (!r || !['container', 'curve', 'fill', 'reference'].includes(r.typeName)) return { error: { code: 'NOT_FOUND', message: `${id} is not a container, curve, fill or reference`, objects: [id], fixes: [] } }
    sel.add(id)
    if (r.typeName === 'container')
      for (const c of containersWithin(reader, r.id)) {
        sel.add(c)
        for (const t of ['curve', 'fill', 'reference'] as const) for (const x of within(reader, c, t)) sel.add(x)
      }
  }
  const recs = [...sel].sort().map((id) => reader.get(id as any) as DocRecord)
  const curves = recs.filter((r): r is CurveRecord => r.typeName === 'curve')
  const fam = curves.filter((c) => familiesOf(reader, c.id).length)
  if (fam.length) return { error: { code: 'INVALID', message: `${fam.map((c) => c.id).join(', ')} belong to a preset family: copying preset-form curves is not supported yet`, objects: fam.map((c) => c.id), fixes: [] } }
  for (const f of recs.filter((r): r is FillRecord => r.typeName === 'fill')) {
    const reads = f.boundary.flatMap((b) => (isBridge(b) ? [b.bridge.from.curveId, b.bridge.to.curveId] : [b.curveId]))
    const outside = [...new Set(reads.filter((c) => !sel.has(c)))]
    if (outside.length) return { error: { code: 'INVALID', message: `fill ${f.id} reads ${outside.join(', ')}, which is not being copied: include it or leave the fill out`, objects: [f.id, ...outside], fixes: [] } }
  }
  const extra: DocRecord[] = []
  for (const c of curves) {
    const track = reader.get(poseIdOf(c.id) as any) as DocRecord | undefined
    if (track) extra.push(track)
  }
  const conns = new Set(curves.flatMap((c) => Object.keys(c.anchors).flatMap((a) => connectionsAt(reader as any, anchorKey({ curveId: c.id, anchorId: a })))))
  for (const id of [...conns].sort()) {
    const cn = getAs(reader, id, 'connection')
    if (cn && cn.ends.every((e) => sel.has(e.curveId))) extra.push(cn)
  }
  // the top-level copies have no parent inside the content: they are re-parented on paste
  return { kind: CONTENT_KIND, schema: schema.serialize(), records: structuredClone([...recs, ...extra]) }
}

/** Parse what the clipboard holds; null when it is not our content. */
export function parseContent(text: string): Content | null {
  try {
    const c = JSON.parse(text)
    return c && c.kind === CONTENT_KIND && Array.isArray(c.records) && c.schema ? (c as Content) : null
  } catch {
    return null
  }
}

/** The drawn bounds of a content's own geometry (curve anchors), for placing it at the centre of the view. */
export function contentCentre(content: Content): Vec | null {
  const pts = content.records.filter((r): r is CurveRecord => r.typeName === 'curve').flatMap((c) => Object.values(c.anchors).map((a) => a.p))
  if (!pts.length) return null
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/**
 * Paste: the content is loaded into a store of its own through the schema (migrated from its schema versions and
 * validated, as a file is opened), then copied into the document by the duplicate's rules; the copies are moved by
 * `offset` (anchors of the copied curves, placements of the copied references).
 */
export function planPaste(store: BaseReader, cmd: PasteCommand, ids: IdSource): Plan {
  const content = cmd.content
  if (!content || content.kind !== CONTENT_KIND || !Array.isArray(content.records) || !content.records.length) return fail('INVALID', 'nothing to paste', [])
  const src = new Store<DocRecord>({ schema, props: {} })
  try {
    src.loadStoreSnapshot({ store: Object.fromEntries(structuredClone(content.records).map((r: DocRecord) => [r.id, r])) as any, schema: content.schema })
  } catch (e) {
    return fail('INVALID', `the clipboard content cannot be read: ${String((e as Error)?.message ?? e)}`, [])
  }
  const reader = { get: src.get.bind(src), allRecords: src.allRecords.bind(src), getStoreSnapshot: src.getStoreSnapshot.bind(src), serialize: src.serialize.bind(src), query: src.query } as unknown as BaseReader
  const all = src.allRecords() as DocRecord[]
  const inContent = new Set(all.map((r) => r.id as string))
  const roots = all.filter((r) => ['container', 'curve', 'fill', 'reference'].includes(r.typeName) && !inContent.has(((r as { parentId?: string | null }).parentId ?? '') as string)).map((r) => r.id as string)
  const plan = planCopyInto(reader, store, { type: 'duplicate', ids: roots, parentId: cmd.parentId }, ids, 'pasteContent')
  if (!plan.ok) return plan
  const d = cmd.offset ?? { x: 0, y: 0 }
  if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return fail('INVALID', 'offset must be finite', [])
  if (d.x || d.y)
    plan.puts = plan.puts.map((r) => {
      if (r.typeName === 'curve') return { ...r, anchors: Object.fromEntries(Object.entries(r.anchors).map(([k, a]) => [k, { ...a, p: { x: a.p.x + d.x, y: a.p.y + d.y } }])) }
      if (r.typeName === 'reference') {
        const t = (r as ReferenceRecord).transform
        // its instance moves by `offset` too: placing a pasted (moved) source, T' = move(d) ∘ T ∘ move(−d); placing a
        // container that stays where it is, T' = move(d) ∘ T
        const withSource = plan.puts.some((x) => x.id === (r as ReferenceRecord).sourceId)
        const e = withSource ? t.e + d.x - (t.a * d.x + t.c * d.y) : t.e + d.x
        const f = withSource ? t.f + d.y - (t.b * d.x + t.d * d.y) : t.f + d.y
        return { ...r, transform: { ...t, e, f } }
      }
      return r
    })
  return plan
}
