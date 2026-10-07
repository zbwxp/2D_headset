// Masks (doc 18 §1.7b / §29.2b; bowen 1791280741, 1791342631): the one write command. A mask names its sources
// (fill areas and stroked curves — the union of their regions), its targets (curves, fills or containers) and a mode
// (`inside`: the targets show only inside the region; `outside`: they are hidden inside it). Creating, changing and
// switching a mask off go through here; removing it is `deleteRecords`. Evaluation and drawing: evaluate.ts
// (`maskDefsOf`, `visibleThroughMasks`) and view/masks.ts.
import type { RecordId } from '@tldraw/store'
import type { EditError, IdSource, Plan } from './commands'
import { getAs } from './model'
import type { BaseReader, CurveRecord, DocRecord, FillRecord, MaskRecord } from './schema'

export type MaskCommand = {
  type: 'setMask'
  /** an existing mask to change; omitted → a new one (prepared id) */
  id?: RecordId<MaskRecord>
  name?: string
  sources: { fills: RecordId<FillRecord>[]; strokes: RecordId<CurveRecord>[] }
  targets: string[]
  mode: 'inside' | 'outside'
  enabled?: boolean
}
const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })

export function planMask(store: BaseReader, cmd: MaskCommand, ids: IdSource): Plan {
  const fills = cmd.sources?.fills ?? [], strokes = cmd.sources?.strokes ?? []
  if (!fills.length && !strokes.length) return fail('INVALID', 'a mask needs at least one source (a fill or a stroked curve)', [])
  for (const f of fills) if (!getAs(store, f, 'fill')) return fail('NOT_FOUND', `${f} is not a fill`, [String(f)])
  for (const c of strokes) if (!getAs(store, c, 'curve')) return fail('NOT_FOUND', `${c} is not a curve`, [String(c)])
  if (!cmd.targets?.length) return fail('INVALID', 'a mask needs at least one target', [])
  for (const t of cmd.targets) {
    const r = store.get(t as any) as DocRecord | undefined
    if (!r || !['curve', 'fill', 'container'].includes(r.typeName)) return fail('NOT_FOUND', `${t} is not a curve, fill or container`, [t])
  }
  if (cmd.mode !== 'inside' && cmd.mode !== 'outside') return fail('INVALID', `mode must be inside or outside (got ${cmd.mode})`, [])
  const old = cmd.id ? (getAs(store, cmd.id, 'mask') as MaskRecord | undefined) : undefined
  if (cmd.id && !old) return fail('NOT_FOUND', `no mask ${cmd.id}`, [String(cmd.id)])
  const id = (old?.id ?? ids.take('mask', () => {
    let n = 'mask:1'
    for (let k = 1; store.get(`mask:${k}` as any); k++) n = `mask:${k + 1}`
    return n
  })) as RecordId<MaskRecord>
  if (!old && store.get(id as any)) return fail('ID_CONFLICT', `the prepared new id ${id} is already used: prepare a new operation`, [id])
  const rec: MaskRecord = {
    typeName: 'mask',
    id,
    name: cmd.name ?? old?.name ?? 'mask',
    sources: { fills: [...new Set(fills)], strokes: [...new Set(strokes)] },
    targets: [...new Set(cmd.targets)],
    mode: cmd.mode,
    enabled: cmd.enabled ?? old?.enabled ?? true,
  } as MaskRecord
  return { ok: true, label: old ? 'setMask' : 'createMask', puts: [rec], affected: [id], ...(old ? {} : { creates: [id] }) }
}
