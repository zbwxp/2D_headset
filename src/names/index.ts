// names — the names of continuous curves (groups) and lines (graph "Names"; bowen
// 1791478346, 1791478561, 1791478697, scope 1791649036 甲 and 1791651929). Layer names
// live on the layer (network): unique among layers. Inside one layer, line names and
// continuous-curve names share one occupancy check: unique within the layer, never empty
// (docs/step5-names-meta.md; dot 1791655027). Points carry none. Defaults, copy names and
// names following identity are notes, not rules (docs/names-plan.md).
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

/** The layer a named line or group is in (a name of something already gone has none). */
function layerOfEntry(n: net.NetworkState, g: groups.GroupsState, kind: Kind, id: Id): Id | undefined {
  if (kind === 'line') return net.hasLine(n, id) ? net.layerOfLine(n, id) : undefined
  return groups.list(g, n).find(x => x.id === id)?.layer
}
/** Every line and curve name in use in one layer, with who holds it. */
function holdersIn(st: NamesState, n: net.NetworkState, g: groups.GroupsState, layer: Id): Map<string, net.RefusalObject> {
  const m = new Map<string, net.RefusalObject>()
  for (const kind of ['group', 'line'] as const) for (const [id, name] of S(st)[kind]) if (layerOfEntry(n, g, kind, id) === layer) m.set(name, { kind, id })
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

/** Refuses an empty name or one held in `layer` by another line or curve (`self`: the holder being renamed). */
export function assertFreeIn(st: NamesState, n: net.NetworkState, g: groups.GroupsState, layer: Id, name: string, self?: string) {
  if (!name.trim()) throw new Error('A name cannot be empty')
  const holder = holdersIn(st, n, g, layer).get(name)
  if (holder !== undefined && `${holder.kind} ${holder.id}` !== self) throw new net.Refusal('name-taken', `Name "${name}" is already used by ${holder.kind} ${holder.id} in layer ${layer}`, [holder])
}

/**
 * Rename a line or a curve: free within its layer. Its id does not change, so everything
 * attached to it stays; only the lookup key (layer, name) follows (dot 1791655027). Works
 * on a line or group made earlier in the same edit too.
 */
export function rename(st: NamesState, n: net.NetworkState, g: groups.GroupsState, kind: Kind, id: Id, name: string) {
  const layer = layerOfEntry(n, g, kind, id)
  if (layer === undefined) throw new Error(`No ${kind} ${id}`)
  assertFreeIn(st, n, g, layer, name, `${kind} ${id}`)
  set(st, kind, id, name)
}

/**
 * The names a curve and its lines take when moved to another layer keeping their ids
 * (moveGroup): decided by the target layer, like a paste (dot 1791655253). First every
 * name free there is reserved for its mover, then the movers whose names are taken get
 * "<name>副本…", so a 副本 name never takes a name a later mover could keep. Lines and
 * the curve share one occupancy check. Planned before the move; applied right after it,
 * in the same edit (any merge after that follows the merge rules).
 */
export function planMove(st: NamesState, n: net.NetworkState, g: groups.GroupsState, group: Id, lines: readonly Id[], target: Id): [Kind, Id, string][] {
  const used = new Set(holdersIn(st, n, g, target).keys())
  const movers: [Kind, Id, string][] = ([['group', group], ...lines.map(id => ['line', id] as [Kind, Id])] as [Kind, Id][])
    .flatMap(([kind, id]) => { const name = of(st, kind, id); return name === undefined ? [] : [[kind, id, name] as [Kind, Id, string]] })
  const late: [Kind, Id, string][] = []
  for (const m of movers) { if (used.has(m[2])) late.push(m); else used.add(m[2]) }
  return late.map(([kind, id, name]) => { const next = copyNameFrom(used, name); used.add(next); return [kind, id, next] })
}
/** Apply a move plan (after the move). */
export function applyPlan(st: NamesState, plan: readonly [Kind, Id, string][]) { for (const [kind, id, name] of plan) set(st, kind, id, name) }

/** After a topology step: a split line's name moves to its first piece (the a end). */
export function follow(st: NamesState, ch: Pick<net.Changes, 'replaced'>) {
  for (const r of ch.replaced) {
    const name = of(st, 'line', r.line)
    S(st).line = S(st).line.filter(e => e[0] !== r.line)
    if (name !== undefined) set(st, 'line', r.pieces[0], name)
  }
}

const copyNameFrom = (used: { has(name: string): boolean }, base: string): string => {
  for (let k = 1; ; k++) { const name = base + COPY + (k > 1 ? k : ''); if (!used.has(name)) return name }
}
/** The free layer name "<base>副本", then "<base>副本2", … (layer names are unique among layers). */
export function layerCopyName(n: net.NetworkState, base: string): string {
  return copyNameFrom(new Set(net.layerRecords(n).map(l => l.name)), base)
}

/**
 * After every topology step and at the end of settling: names of what is gone are dropped;
 * anything unnamed gets "曲线N" / "连续曲线N" with N the smallest free positive integer
 * within its layer (dot 1791655027).
 */
export function update(st: NamesState, n: net.NetworkState, g: groups.GroupsState) {
  const lines = net.lines(n).map(l => l.id), list = groups.list(g, n)
  const lineSet = new Set(lines), groupSet = new Set(list.map(x => x.id))
  S(st).line = S(st).line.filter(e => lineSet.has(e[0]))
  S(st).group = S(st).group.filter(e => groupSet.has(e[0]))
  const layerOf = new Map<string, Id>([...lines.map(id => [`line ${id}`, net.layerOfLine(n, id)] as [string, Id]), ...list.map(x => [`group ${x.id}`, x.layer] as [string, Id])])
  const used = new Map<Id, Set<string>>()
  const usedIn = (layer: Id) => { let u = used.get(layer); if (!u) { u = new Set(); used.set(layer, u) } return u }
  for (const kind of ['line', 'group'] as const) for (const [id, name] of S(st)[kind]) usedIn(layerOf.get(`${kind} ${id}`)!).add(name)
  for (const [kind, ids] of [['line', lines], ['group', list.map(x => x.id)]] as const) {
    for (const id of ids) {
      if (of(st, kind, id) !== undefined) continue
      const u = usedIn(layerOf.get(`${kind} ${id}`)!)
      let k = 1
      while (u.has(DEFAULT[kind] + k)) k++
      set(st, kind, id, DEFAULT[kind] + k)
      u.add(DEFAULT[kind] + k)
    }
  }
}

/** Names of the given lines and of the groups entirely inside them, as plain data. */
export function rangeData(st: NamesState, g: groups.GroupsState, n: net.NetworkState, lines: readonly Id[]): { lines: [Id, string][]; groups: { name: string; lines: Id[] }[] } {
  const set = new Set(lines)
  return {
    lines: lines.flatMap(id => { const name = of(st, 'line', id); return name === undefined ? [] : [[id, name] as [Id, string]] }),
    groups: groups.list(g, n).filter(x => x.lines.every(l => set.has(l))).flatMap(x => { const name = of(st, 'group', x.id); return name === undefined ? [] : [{ name, lines: [...x.lines] }] }),
  }
}

/**
 * After a paste or a layer copy: decided by the target layer only (docs/step5-names-meta.md
 * rule 5; dot 1791655027). Every copied line, and every curve made only of copied lines,
 * keeps its original's name if that name is free in its layer, else gets "<name>副本"
 * (then 副本2, …). The temporary defaults the copies got while being inserted are cleared
 * first, so they never push out a name that could be kept; kept names are given before
 * 副本 names; anything still unnamed then gets its default. A curve that merged with an
 * existing one keeps the name the merge rules gave it.
 */
export function copyFrom(st: NamesState, n: net.NetworkState, g: groups.GroupsState, lineMap: ReadonlyMap<Id, Id>, data: { lines: [Id, string][]; groups: { name: string; lines: Id[] }[] }) {
  const copied = new Set(lineMap.values())
  const after = groups.list(g, n)
  const wanted: { kind: Kind; id: Id; layer: Id; name: string }[] = []
  for (const [from, name] of data.lines) { const to = lineMap.get(from); if (to && net.hasLine(n, to)) wanted.push({ kind: 'line', id: to, layer: net.layerOfLine(n, to), name }) }
  for (const src of data.groups) {
    const first = lineMap.get(src.lines[0]!)
    const target = first && after.find(x => x.lines.includes(first))
    if (target && target.lines.every(l => copied.has(l))) wanted.push({ kind: 'group', id: target.id, layer: target.layer, name: src.name })
  }
  // clear the temporaries of exactly what is renamed here
  for (const w of wanted) S(st)[w.kind] = S(st)[w.kind].filter(e => e[0] !== w.id)
  const usedIn = (layer: Id) => holdersIn(st, n, g, layer)
  const late: typeof wanted = []
  for (const w of wanted) { if (usedIn(w.layer).has(w.name)) late.push(w); else set(st, w.kind, w.id, w.name) }
  for (const w of late) set(st, w.kind, w.id, copyNameFrom(usedIn(w.layer), w.name))
  update(st, n, g)
}

/**
 * At commit: layer names unique among layers; inside each layer, line and curve names
 * unique together; none empty.
 */
export function check(st: NamesState, n: net.NetworkState, g: groups.GroupsState) {
  const scopes = new Map<string, Map<string, string>>()
  const add = (scope: string, name: string, who: string) => {
    if (!name.trim()) throw new Error(`${who} has an empty name`)
    let seen = scopes.get(scope)
    if (!seen) { seen = new Map(); scopes.set(scope, seen) }
    const other = seen.get(name)
    if (other) throw new Error(`Name "${name}" is used by both ${other} and ${who}`)
    seen.set(name, who)
  }
  for (const l of net.layerRecords(n)) add('layers', l.name, `layer ${l.id}`)
  for (const kind of ['group', 'line'] as const) for (const [id, name] of S(st)[kind]) add(`in ${layerOfEntry(n, g, kind, id) ?? '?'}`, name, `${kind} ${id}`)
}

/** Names from saved data, checked: every line and every group has exactly one name, and no name repeats (layers included). */
export function restore(v: unknown, n: net.NetworkState, g: groups.GroupsState): NamesState {
  const d = net.data, o = d.obj(v, 'names')
  const entries = (kind: Kind, ids: Id[]) => {
    const list = d.arr(o[kind], `${kind} names`).map((x, i): [Id, string] => {
      const e = d.arr(x, `${kind} name ${i}`)
      return [d.str(e[0], `${kind} name ${i} id`), d.str(e[1], `${kind} name ${i}`)]
    })
    d.unique(list.map(e => e[0]), `${kind} name for`)
    const have = new Set(list.map(e => e[0]))
    for (const id of ids) if (!have.has(id)) d.fail(`${kind} ${id} has no name`)
    if (list.length !== ids.length) d.fail(`a ${kind} name belongs to a missing ${kind}`)
    return list
  }
  const st = { line: entries('line', net.lines(n).map(l => l.id)), group: entries('group', groups.list(g, n).map(x => x.id)) } as Store as unknown as NamesState
  try { check(st, n, g) } catch (err) { d.fail((err as Error).message) }
  return st
}
