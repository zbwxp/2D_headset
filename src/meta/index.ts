// meta — the 元组件 structure (graph "Models and 元组件"; docs/step5-names-meta.md).
// A 元组件 is a layer with a type (眼睛) and a name (眼睛1, the layer's own name). A
// 元线条 is found by (layer, line name); its identity is its id, so a rename keeps it
// and only the lookup key follows (bowen 1791648678; dot 1791655027).
//
// No second state (dot 1791650999): the types are this module's part of the one document
// state, under the same draft, rollback, undo and save as every module. Names stay in
// `names`; meta only reads them.
import * as net from '../network'
import * as names from '../names'

type Id = net.Id

declare const opaque: unique symbol
/** Opaque handle; read through `typeOf`. */
export type MetaState = { readonly [opaque]: 'meta' }
/** Layer id → type, kept sorted by layer id (one stored form). An absent entry means no type (""). */
interface Store { types: [Id, string][] }
const S = (m: MetaState) => m as unknown as Store

export const create = (): MetaState => ({ types: [] }) as Store as unknown as MetaState

/** A layer's type; "" when it has none. */
export function typeOf(m: MetaState, layer: Id): string { return S(m).types.find(e => e[0] === layer)?.[1] ?? '' }

/** Set a layer's type (an edit); "" removes it. The layer must exist. */
export function setType(m: MetaState, n: net.NetworkState, layer: Id, type: string) {
  if (!net.hasLayer(n, layer)) throw new Error(`No layer ${layer}`)
  if (typeof type !== 'string') throw new Error('A type is text')
  S(m).types = S(m).types.filter(e => e[0] !== layer)
  if (type) S(m).types.push([layer, type])
  S(m).types.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** A copied 元组件 keeps its type. */
export function copyType(m: MetaState, n: net.NetworkState, from: Id, to: Id) { setType(m, n, to, typeOf(m, from)) }

/** At settling: a layer that is gone takes its type with it. */
export function follow(m: MetaState, n: net.NetworkState) { S(m).types = S(m).types.filter(e => net.hasLayer(n, e[0])) }

/** The 元线条 with this name in this layer: its line id, or undefined (a read). */
export function lineByName(n: net.NetworkState, st: names.NamesState, layer: Id, name: string): Id | undefined {
  return net.lines(n).find(l => net.layerOfLine(n, l.id) === layer && names.of(st, 'line', l.id) === name)?.id
}

/** Types from saved data, checked: text, on existing layers, each layer once, in the stored order. */
export function restore(v: unknown, n: net.NetworkState): MetaState {
  const d = net.data, o = d.obj(v, 'meta')
  const types = d.arr(o.types, 'types').map((x, i): [Id, string] => {
    const e = d.arr(x, `type ${i}`), layer = d.str(e[0], `type ${i} layer`), type = d.str(e[1], `type ${i}`)
    if (!net.hasLayer(n, layer)) d.fail(`type ${i} is on a missing layer ${layer}`)
    if (!type) d.fail(`type ${i} is empty (no type is stored as no entry)`)
    return [layer, type]
  })
  d.unique(types.map(e => e[0]), 'type for layer')
  const sorted = [...types].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  if (JSON.stringify(sorted) !== JSON.stringify(types)) d.fail('types are not in their stored order')
  return { types } as Store as unknown as MetaState
}
