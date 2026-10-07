// Copy / paste (editor skeleton block 3, doc 18 §30.3). Mature model: tldraw — copy serializes the selected content
// (shapes with their descendants and the bindings wholly inside it, with the schema versions); paste migrates and
// validates that content, gives it new ids and puts it on the page (`putContentOntoCurrentPage`). Placement follows
// Illustrator: ⌘V = at the centre of the view, ⇧⌘V = in place; into the current layer, on top, then selected.
// The copy rules are the duplicate's (duplicate.ts `planCopyInto`): one place for what crosses the boundary.
import { Store, type RecordId, type SerializedSchema } from '@tldraw/store'
import type { EditError, IdSource, Plan } from './commands'
import { planCopyInto } from './duplicate'
import { connectionsAt, containersWithin, familiesOf, ownFillsOf, within } from './indexes'
import { anchorKey, getAs } from './model'
import { isBridge, poseIdOf, schema, type BaseReader, type ContainerRecord, type CurveRecord, type DocRecord, type FillRecord, type MaskRecord, type ReferenceRecord, type Vec } from './schema'

export const CONTENT_KIND = 'contour/content'
/**
 * `origin`: the open document the content was copied from (Editor.documentToken). `context`: the records of every
 * source a copied reference places but that was not copied itself, as they were — a paste into ANOTHER document keeps
 * such a reference only when that document has the same source, record for record (review of 6c59e19 C4). `masks`:
 * the masks whose targets and sources are all copied (review of 6c59e19 C5).
 */
export type Content = { kind: typeof CONTENT_KIND; schema: SerializedSchema; records: DocRecord[]; origin?: string; context?: DocRecord[]; masks?: MaskRecord[] }
export type PasteCommand = { type: 'pasteContent'; content: Content; parentId: RecordId<ContainerRecord>; offset?: Vec; /** the destination's Editor.documentToken */ origin?: string }

const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })

/**
 * The content a copy puts on the clipboard: the selected containers / curves / fills / references, everything inside a
 * selected container, a copied curve's head-turn track, and the connections with every end copied. Refused (named) as
 * duplicate refuses: a fill whose boundary reads a curve left out, a preset-form curve.
 */
export function contentOf(reader: BaseReader, ids: readonly string[], origin?: string): Content | { error: EditError } {
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
  for (const id of [...sel]) for (const f of ownFillsOf(reader, id)) sel.add(f) // a path's own fill goes with its path
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
  // masks: one whose targets include a copied object travels with the copy when its sources are copied too; a copied
  // object masked by a source left out is refused, by name, as a fill without its boundary is (the copy would look
  // different) — include the source, or release the mask first
  const masks: MaskRecord[] = []
  // a copied object is masked directly (it is a target) or through a container it is in (the target is a container
  // left out: review of aa206e5 C5) — then the copied objects topmost inside that container become the copy's targets
  const under = (id: string, container: string) => {
    for (let p = (reader.get(id as any) as { parentId?: string | null } | undefined)?.parentId ?? null; p; p = (reader.get(p as any) as { parentId?: string | null } | undefined)?.parentId ?? null) if (p === container) return true
    return false
  }
  const roots = [...sel].filter((id) => ![...sel].some((o) => o !== id && under(id, o)))
  for (const m of reader.allRecords().filter((r): r is MaskRecord => r.typeName === 'mask')) {
    const direct = m.targets.filter((t) => sel.has(t))
    const inherited = m.targets.filter((t) => !sel.has(t)).flatMap((t) => roots.filter((r) => under(r, t)))
    const targets = [...new Set([...direct, ...inherited])]
    if (!targets.length) continue
    const outside = [...m.sources.fills, ...m.sources.strokes].filter((x) => !sel.has(x))
    if (outside.length) return { error: { code: 'INVALID', message: `${targets.join(', ')} is masked by ${m.id}, whose source ${outside.join(', ')} is not being copied: include it or release the mask`, objects: [m.id, ...targets, ...outside], fixes: [] } }
    masks.push({ ...structuredClone(m), targets })
  }
  // context: the sources copied references place without them, as they are now (checked when pasted elsewhere)
  const context: DocRecord[] = []
  for (const r of recs.filter((x): x is ReferenceRecord => x.typeName === 'reference')) {
    if (sel.has(r.sourceId)) continue
    const sub = new Set<string>([r.sourceId])
    for (const c of containersWithin(reader, r.sourceId)) {
      sub.add(c)
      for (const t of ['curve', 'fill', 'reference'] as const) for (const x of within(reader, c, t)) sub.add(x)
    }
    for (const id of [...sub].sort()) if (!context.some((x) => x.id === id)) context.push(structuredClone(reader.get(id as any) as DocRecord))
  }
  // the top-level copies have no parent inside the content: they are re-parented on paste
  return { kind: CONTENT_KIND, schema: schema.serialize(), records: structuredClone([...recs, ...extra]), ...(origin ? { origin } : {}), ...(context.length ? { context } : {}), ...(masks.length ? { masks } : {}) }
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
  // read defensively: the content is validated only when pasted (planPaste)
  const pts = content.records.filter((r): r is CurveRecord => r?.typeName === 'curve' && !!r.anchors && typeof r.anchors === 'object').flatMap((c) => Object.values(c.anchors).filter((a) => Number.isFinite(a?.p?.x) && Number.isFinite(a?.p?.y)).map((a) => a.p))
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
    src.loadStoreSnapshot({ store: Object.fromEntries(structuredClone([...content.records, ...(content.masks ?? [])]).map((r: DocRecord) => [r.id, r])) as any, schema: content.schema })
  } catch (e) {
    return fail('INVALID', `the clipboard content cannot be read: ${String((e as Error)?.message ?? e)}`, [])
  }
  const reader = { get: src.get.bind(src), allRecords: src.allRecords.bind(src), getStoreSnapshot: src.getStoreSnapshot.bind(src), serialize: src.serialize.bind(src), query: src.query } as unknown as BaseReader
  const all = (src.allRecords() as DocRecord[]).filter((r) => r.typeName !== 'mask')
  const inContent = new Set(all.map((r) => r.id as string))
  const roots = all.filter((r) => ['container', 'curve', 'fill', 'reference'].includes(r.typeName) && !inContent.has(((r as { parentId?: string | null }).parentId ?? '') as string)).map((r) => r.id as string)
  // a copied reference whose source was not copied: in the SAME document it keeps placing that source; elsewhere only
  // when this document's source is the same, record for record — never silently re-bound to a different one
  const sameDocument = !!content.origin && content.origin === cmd.origin
  for (const r of all.filter((x): x is ReferenceRecord => x.typeName === 'reference')) {
    if (inContent.has(r.sourceId) || sameDocument) continue
    const ctx = (content.context ?? []).filter((x) => x.id === r.sourceId || isWithin(content.context ?? [], x, r.sourceId))
    // the same source here: the same records AND no other ones in it (review of aa206e5 C4: an extra child passed)
    const here = new Set<string>([r.sourceId])
    if (store.get(r.sourceId as any))
      for (const c of containersWithin(store, r.sourceId)) {
        here.add(c)
        for (const t of ['curve', 'fill', 'reference'] as const) for (const x of within(store, c, t)) here.add(x)
      }
    const same = ctx.length > 0 && ctx.length === here.size && ctx.every((x) => here.has(x.id as string) && JSON.stringify(store.get(x.id as any) ?? null) === JSON.stringify(x))
    if (!same) return fail('BAD_REFERENCE', `${r.id} places ${r.sourceId}, which was not copied with it, and this document's ${r.sourceId} is not the same: copy the source with it`, [r.id, r.sourceId])
  }
  const idMap = new Map<string, string>()
  const plan = planCopyInto(reader, store, { type: 'duplicate', ids: roots, parentId: cmd.parentId }, ids, 'pasteContent', idMap)
  if (!plan.ok) return plan
  for (const m of src.allRecords().filter((r): r is MaskRecord => r.typeName === 'mask')) {
    const re = (x: string) => idMap.get(x) ?? x
    const id = ids.take('mask', () => {
      let k = 1
      while (store.get(`mask:${k}` as any) || plan.puts.some((p) => p.id === `mask:${k}`)) k++
      return `mask:${k}`
    }) as RecordId<MaskRecord>
    plan.puts.push({ ...m, id, sources: { fills: m.sources.fills.map(re) as any, strokes: m.sources.strokes.map(re) as any }, targets: m.targets.map(re) })
    plan.affected.push(id)
    plan.creates = [...(plan.creates ?? []), id]
  }
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

/** `x` lies inside container `root` according to the parent links among `recs` */
function isWithin(recs: DocRecord[], x: DocRecord, root: string): boolean {
  const by = new Map(recs.map((r) => [r.id as string, r]))
  for (let p = (x as { parentId?: string | null }).parentId ?? null, n = 0; p && n < 1000; p = ((by.get(p) as { parentId?: string | null } | undefined)?.parentId ?? null), n++) if (p === root) return true
  return false
}
