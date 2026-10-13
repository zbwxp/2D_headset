// masks — the 显隐 module's relations, stored in the drawing (graph "显隐 — masks", preliminary; Q33; docs/mask-p2-checklist.md).
// A mask: source fills that, while on, hide (inverse) or keep only (normal) part of a target line or fill. This module
// keeps the relations and their references right; what they hide is computed in `visibility/` from each view's geometry.
// Encapsulation (as the other modules): the state is opaque outside; reads return copies.
import * as net from '../network'

type Id = net.Id
export type Target = { readonly kind: 'line' | 'fill'; readonly id: Id }
export type Mode = 'inverse' | 'normal'
export interface Mask { readonly id: Id; readonly sources: readonly Id[]; readonly target: Target; readonly mode: Mode }

declare const opaque: unique symbol
export type MasksState = { readonly [opaque]: 'masks' }
interface Store { masks: { id: Id; sources: Id[]; target: { kind: 'line' | 'fill'; id: Id }; mode: Mode }[] }
const S = (s: MasksState) => s as unknown as Store

export const create = (): MasksState => ({ masks: [] }) as Store as unknown as MasksState
export const list = (s: MasksState): Mask[] => S(s).masks.map(m => ({ id: m.id, sources: [...m.sources], target: { ...m.target }, mode: m.mode }))

const MODES: readonly Mode[] = ['inverse', 'normal']
/**
 * A new mask, checked against the drawing: `filled` = the ids of its filled loops. Refused: an id in use, no source,
 * a repeated source, a source that is not a filled loop, an unknown target, a fill target that is not filled, a fill
 * masking itself, an unknown mode.
 */
export function add(s: MasksState, n: net.NetworkState, filled: ReadonlySet<Id>, m: Mask) {
  const id = String(m.id), sources = [...(m.sources ?? [])].map(String)
  if (S(s).masks.some(x => x.id === id)) throw new Error(`Mask ${id} already exists`)
  if (!sources.length) throw new Error(`Mask ${id} needs a source fill`)
  if (new Set(sources).size !== sources.length) throw new Error(`Mask ${id} names a source twice`)
  for (const f of sources) if (!filled.has(f)) throw new Error(`Mask ${id}: ${f} is not a filled closed curve`)
  if (!MODES.includes(m.mode)) throw new Error(`Mask ${id}: unknown mode ${String(m.mode)}`)
  const kind = m.target?.kind, tid = String(m.target?.id)
  if (kind === 'line') { if (!net.hasLine(n, tid)) throw new Error(`Mask ${id}: no line ${tid}`) }
  else if (kind === 'fill') {
    if (!filled.has(tid)) throw new Error(`Mask ${id}: ${tid} is not a filled closed curve`)
    if (sources.includes(tid)) throw new Error(`Mask ${id}: a fill cannot mask itself`)
  } else throw new Error(`Mask ${id}: the target must be a line or a fill`)
  S(s).masks.push({ id, sources, target: { kind, id: tid }, mode: m.mode })
}
/** One mask by id. */
export function get(s: MasksState, id: Id): Mask {
  const m = list(s).find(x => x.id === id)
  if (!m) throw new Error(`No mask ${id}`)
  return m
}
export function remove(s: MasksState, id: Id) {
  if (!S(s).masks.some(m => m.id === id)) throw new Error(`No mask ${id}`)
  S(s).masks = S(s).masks.filter(m => m.id !== id)
}

/**
 * After a network operation, by the same record as the other modules: a split target line keeps the mask on every
 * piece (the first keeps the id, each other piece a new mask `id/<piece>`, made unique); a target line deleted or
 * collapsed takes its masks. Fills keep their ids through a split (fills.update), so masks on fills need nothing here.
 */
export function update(s: MasksState, ch: net.Changes) {
  for (const r of ch.replaced) {
    const out: Store['masks'] = []
    for (const m of S(s).masks) {
      if (m.target.kind !== 'line' || m.target.id !== r.line) { out.push(m); continue }
      r.pieces.forEach((piece, k) => out.push({ ...m, id: k ? fresh(s, out, `${m.id}/${piece}`) : m.id, sources: [...m.sources], target: { kind: 'line', id: piece } }))
    }
    S(s).masks = out
  }
  const gone = new Set([...ch.deletedLines, ...ch.collapsedLines])
  S(s).masks = S(s).masks.filter(m => !(m.target.kind === 'line' && gone.has(m.target.id)))
}
/**
 * With the drawing settled: `filled` = the ids of its filled loops. A source fill gone (cleared, its loop broken) leaves
 * the sources; a mask left with none goes; a fill target gone takes its masks; a target line gone takes its masks.
 */
export function validate(s: MasksState, n: net.NetworkState, filled: ReadonlySet<Id>) {
  S(s).masks = S(s).masks
    .map(m => ({ ...m, sources: m.sources.filter(f => filled.has(f)) }))
    .filter(m => m.sources.length && (m.target.kind === 'line' ? net.hasLine(n, m.target.id) : filled.has(m.target.id)))
}

/** `base`, or `base~2`, `base~3`… — the first id neither in the store nor in `more`. */
function fresh(s: MasksState, more: readonly { id: Id }[], base: Id): Id {
  const used = new Set([...S(s).masks, ...more].map(m => m.id))
  let id = base
  for (let k = 2; used.has(id); k++) id = `${base}~${k}`
  return id
}

/** The masks a clip carries: its target in the range (a line of it, or a fill of it) and every source a fill of it. */
export function rangeData(s: MasksState, lines: ReadonlySet<Id>, fills: ReadonlySet<Id>): Mask[] {
  return list(s).filter(m => (m.target.kind === 'line' ? lines.has(m.target.id) : fills.has(m.target.id)) && m.sources.every(f => fills.has(f)))
}
/** A clip's masks onto the pasted lines and fills: new ids by `idOf`, as the clip's other records; a mask whose references did not all arrive is left out. */
export function insert(s: MasksState, data: readonly Mask[], lines: ReadonlyMap<Id, Id>, fills: ReadonlyMap<Id, Id>, idOf: (old: Id) => Id) {
  for (const m of data) {
    const target = m.target.kind === 'line' ? lines.get(m.target.id) : fills.get(m.target.id), sources = m.sources.map(f => fills.get(f))
    if (!target || sources.some(f => !f)) continue
    const id = idOf(m.id)
    if (S(s).masks.some(x => x.id === id)) throw new Error(`Mask ${id} already exists`)
    S(s).masks.push({ id, sources: sources as Id[], target: { kind: m.target.kind, id: target }, mode: m.mode })
  }
}

/** A clip's masks as plain data, checked: types, and every reference inside the clip (`lines`, `fills`); a bad one refuses the paste. */
export function checkData(v: unknown, lines: ReadonlySet<Id>, fills: ReadonlySet<Id>, what: string): Mask[] {
  const d = net.data
  const out = d.arr(v, what).map((x, i): Mask => {
    const M = d.obj(x, `${what} ${i}`), id = d.str(M.id, `${what} ${i} id`), T = d.obj(M.target, `${what} ${id} target`)
    const kind = d.str(T.kind, `${what} ${id} target kind`), tid = d.str(T.id, `${what} ${id} target id`), mode = d.str(M.mode, `${what} ${id} mode`) as Mode
    const sources = d.arr(M.sources, `${what} ${id} sources`).map((f, k) => d.str(f, `${what} ${id} source ${k}`))
    if (!MODES.includes(mode)) d.fail(`${what} ${id}: unknown mode`)
    if (!sources.length || new Set(sources).size !== sources.length || sources.some(f => !fills.has(f))) d.fail(`${what} ${id}: its sources must be distinct fills of the clip`)
    if (kind === 'line' ? !lines.has(tid) : kind === 'fill' ? !fills.has(tid) || sources.includes(tid) : true) d.fail(`${what} ${id}: its target must be a line or another fill of the clip`)
    return { id, sources, target: { kind: kind as 'line' | 'fill', id: tid }, mode }
  })
  d.unique(out.map(m => m.id), what)
  return out
}

/** Masks from saved data, checked: each reference exists (`filled` = the filled loops' ids); a bad file is refused, never repaired. */
export function restore(v: unknown, n: net.NetworkState, filled: ReadonlySet<Id>): MasksState {
  const d = net.data, o = d.obj(v, 'masks')
  const s = create()
  d.arr(o.masks, 'masks').forEach((x, i) => {
    const M = d.obj(x, `mask ${i}`), id = d.str(M.id, `mask ${i} id`), T = d.obj(M.target, `mask ${id} target`)
    const kind = d.str(T.kind, `mask ${id} target kind`)
    if (kind !== 'line' && kind !== 'fill') d.fail(`mask ${id}: the target must be a line or a fill`)
    try {
      add(s, n, filled, { id, sources: d.arr(M.sources, `mask ${id} sources`).map((f, k) => d.str(f, `mask ${id} source ${k}`)), target: { kind: kind as 'line' | 'fill', id: d.str(T.id, `mask ${id} target id`) }, mode: d.str(M.mode, `mask ${id} mode`) as Mode })
    } catch (err) { d.fail((err as Error).message) }
  })
  return s
}
