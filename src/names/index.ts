// names — the names of continuous curves (groups) and lines (graph "Names"; bowen
// 1791478346, 1791478561, 1791478697). Layer names live on the layer (network) and are
// only read here: every name, of any kind, is unique and never empty. Points carry none.
// Defaults, copy names and names following identity are notes, not rules (docs/names-plan.md).
import * as net from '../network'
import * as groups from '../groups'

type Id = net.Id
export type Kind = 'line' | 'group'

declare const opaque: unique symbol
/** Opaque handle; read through `of` (copies). */
export type NamesState = { readonly [opaque]: 'names' }
interface Store { line: [Id, string][]; group: [Id, string][] }
const S = (s: NamesState) => s as unknown as Store

export const create = (): NamesState => ({ line: [], group: [] }) as Store as unknown as NamesState

const DEFAULT: Record<Kind, string> = { line: '曲线', group: '连续曲线' }
const COPY = '副本'

/** Every name in use, with who holds it. */
function holders(st: NamesState, n: net.NetworkState): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of net.layerRecords(n)) m.set(l.name, `layer ${l.id}`)
  for (const kind of ['group', 'line'] as const) for (const [id, name] of S(st)[kind]) m.set(name, `${kind} ${id}`)
  return m
}

export function of(st: NamesState, kind: Kind, id: Id): string | undefined {
  return S(st)[kind].find(e => e[0] === id)?.[1]
}

function set(st: NamesState, kind: Kind, id: Id, name: string) {
  const list = S(st)[kind], e = list.find(x => x[0] === id)
  if (e) e[1] = name
  else list.push([id, name])
}

/** Refuses an empty name or one held by anything else (`self`: the holder being renamed). */
export function assertFree(st: NamesState, n: net.NetworkState, name: string, self?: string) {
  if (!name.trim()) throw new Error('A name cannot be empty')
  const holder = holders(st, n).get(name)
  if (holder !== undefined && holder !== self) throw new Error(`Name "${name}" is already used by ${holder}`)
}

/** Works on a line or group made earlier in the same edit too (defaults are given only at settling). */
export function rename(st: NamesState, n: net.NetworkState, g: groups.GroupsState, kind: Kind, id: Id, name: string) {
  const exists = kind === 'line' ? net.hasLine(n, id) : groups.list(g, n).some(x => x.id === id)
  if (!exists) throw new Error(`No ${kind} ${id}`)
  assertFree(st, n, name, `${kind} ${id}`)
  set(st, kind, id, name)
}

/** After a topology step: a split line's name moves to its first piece (the a end). */
export function follow(st: NamesState, ch: Pick<net.Changes, 'replaced'>) {
  for (const r of ch.replaced) {
    const name = of(st, 'line', r.line)
    S(st).line = S(st).line.filter(e => e[0] !== r.line)
    if (name !== undefined) set(st, 'line', r.pieces[0], name)
  }
}

/** The free "<base>副本", then "<base>副本2", "<base>副本3", … */
export function copyName(st: NamesState, n: net.NetworkState, base: string): string {
  const used = holders(st, n)
  for (let k = 1; ; k++) { const name = base + COPY + (k > 1 ? k : ''); if (!used.has(name)) return name }
}

/** After every topology step and at the end of settling: names of what is gone are dropped; anything unnamed gets the next free default. */
export function update(st: NamesState, n: net.NetworkState, g: groups.GroupsState) {
  const lines = net.lines(n).map(l => l.id), list = groups.list(g, n).map(x => x.id)
  S(st).line = S(st).line.filter(e => lines.includes(e[0]))
  S(st).group = S(st).group.filter(e => list.includes(e[0]))
  for (const [kind, ids] of [['line', lines], ['group', list]] as const) {
    let k = 1
    for (const id of ids) {
      if (of(st, kind, id) !== undefined) continue
      const used = holders(st, n)
      while (used.has(DEFAULT[kind] + k)) k++
      set(st, kind, id, DEFAULT[kind] + k)
    }
  }
}

/** After a layer copy: every copied line and group is named after its original, "<name>副本" (then 副本2, …). */
export function copy(st: NamesState, n: net.NetworkState, g: groups.GroupsState, lineMap: ReadonlyMap<Id, Id>, sourceGroups: readonly groups.Group[]) {
  for (const [from, to] of lineMap) {
    const name = of(st, 'line', from)
    if (name !== undefined) set(st, 'line', to, copyName(st, n, name))
  }
  const after = groups.list(g, n)
  for (const src of sourceGroups) {
    const name = of(st, 'group', src.id), first = lineMap.get(src.lines[0]!)
    const target = first && after.find(x => x.lines.includes(first))
    if (name !== undefined && target) set(st, 'group', target.id, copyName(st, n, name))
  }
}

/** At commit: every name unique and non-empty (catches a layer renamed onto a curve's or line's name). */
export function check(st: NamesState, n: net.NetworkState) {
  const seen = new Map<string, string>()
  const all: [string, string][] = [
    ...net.layerRecords(n).map(l => [l.name, `layer ${l.id}`] as [string, string]),
    ...S(st).group.map(([id, name]) => [name, `group ${id}`] as [string, string]),
    ...S(st).line.map(([id, name]) => [name, `line ${id}`] as [string, string]),
  ]
  for (const [name, who] of all) {
    if (!name.trim()) throw new Error(`${who} has an empty name`)
    const other = seen.get(name)
    if (other) throw new Error(`Name "${name}" is used by both ${other} and ${who}`)
    seen.set(name, who)
  }
}
