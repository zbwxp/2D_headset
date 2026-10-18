// names — the names of continuous curves (groups) and lines (graph "Names"; bowen
// 1791478346, 1791478561, 1791478697, scope 1791649036 甲 and 1791651929). Layer names
// live on the layer (network): unique among layers. A line's true name is 图层·连续曲线·线
// (bowen 1792308208, docs/names-scope.md): a curve's name is unique among its layer's
// curves, a line's among its curve's lines; never empty; a line name never collides with
// a curve name. Points carry none. Defaults, copy names and names following identity are
// notes, not rules (docs/names-plan.md).
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
/**
 * Where each name lives (docs/names-scope.md): a curve among its layer's curves (`curves <layer>`), a line among its
 * curve's lines (`lines <curve>`). Keyed by `<kind> <id>`.
 */
function scopes(n: net.NetworkState, g: groups.GroupsState): Map<string, string> {
  const m = new Map<string, string>()
  for (const x of groups.list(g, n)) { m.set(`group ${x.id}`, `curves ${x.layer}`); for (const l of x.lines) m.set(`line ${l}`, `lines ${x.id}`) }
  return m
}
const scopeOf = (n: net.NetworkState, g: groups.GroupsState, kind: Kind, id: Id) => scopes(n, g).get(`${kind} ${id}`)
/** Every name in use in one scope, with who holds it. */
function holdersIn(st: NamesState, n: net.NetworkState, g: groups.GroupsState, scope: string): Map<string, net.RefusalObject> {
  const m = new Map<string, net.RefusalObject>(), sc = scopes(n, g)
  for (const kind of ['group', 'line'] as const) for (const [id, name] of S(st)[kind]) if (sc.get(`${kind} ${id}`) === scope) m.set(name, { kind, id })
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

/** Refuses an empty name or one held in `scope` by another line or curve (`self`: the holder being renamed). */
function assertFreeIn(st: NamesState, n: net.NetworkState, g: groups.GroupsState, scope: string, name: string, self?: string) {
  if (!name.trim()) throw new Error('A name cannot be empty')
  // 「·」 joins the parts of a true name (图层·连续曲线·线): never inside one (bowen 1792308620)
  if (name.includes('·')) throw new net.Refusal('name-dot', `name-dot: a name cannot contain 「·」 (it joins 图层·连续曲线·线)`)
  const holder = holdersIn(st, n, g, scope).get(name)
  const where = scope.startsWith('lines ') ? `curve ${scope.slice(6)}` : `layer ${scope.slice(7)}`
  if (holder !== undefined && `${holder.kind} ${holder.id}` !== self) throw new net.Refusal('name-taken', `Name "${name}" is already used by ${holder.kind} ${holder.id} in ${where}`, [holder])
}

/**
 * Rename a line (free among its curve's lines) or a curve (free among its layer's curves). Its
 * id does not change, so everything attached to it stays; only the lookup key follows (dot
 * 1791655027). Works on a line or group made earlier in the same edit too.
 */
export function rename(st: NamesState, n: net.NetworkState, g: groups.GroupsState, kind: Kind, id: Id, name: string) {
  if (layerOfEntry(n, g, kind, id) === undefined) throw new Error(`No ${kind} ${id}`)
  const scope = scopeOf(n, g, kind, id)
  if (scope === undefined) throw new Error(`No ${kind} ${id}`)
  assertFreeIn(st, n, g, scope, name, `${kind} ${id}`)
  set(st, kind, id, name)
}

/**
 * The names a curve takes when moved to another layer keeping its ids (moveGroup): its name
 * free among the target layer's curves, else "<name>副本…" (dot 1791655253). Its lines stay in
 * their curve, so their names stay (docs/names-scope.md rule 8). Planned before the move;
 * applied right after it, in the same edit.
 */
export function planMove(st: NamesState, n: net.NetworkState, g: groups.GroupsState, group: Id, lines: readonly Id[], target: Id): [Kind, Id, string][] {
  void lines
  const used = new Set(holdersIn(st, n, g, `curves ${target}`).keys()), name = of(st, 'group', group)
  return name === undefined || !used.has(name) ? [] : [['group', group, copyNameFrom(used, name)]]
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
  dedupe(st, n, g)
}
/**
 * One name per scope: where two hold one name (two curves joined, or 「·」 removed from old names), the one earlier in
 * order keeps it — a curve's lines in curve order, a layer's curves in layer order — and the later becomes
 * "<name>副本…" (docs/names-scope.md rule 6).
 */
function dedupe(st: NamesState, n: net.NetworkState, g: groups.GroupsState) {
  const list = groups.list(g, n)
  const one = (kind: Kind, ids: readonly Id[]) => {
    const seen = new Set<string>(), all = new Set(ids.map(id => of(st, kind, id)!))
    for (const id of ids) {
      const name = of(st, kind, id)!
      if (!seen.has(name)) { seen.add(name); continue }
      const next = copyNameFrom({ has: (q: string) => all.has(q) || seen.has(q) }, name)
      set(st, kind, id, next); seen.add(next); all.add(next)
    }
  }
  for (const layer of net.layers(n)) one('group', list.filter(x => x.layer === layer).map(x => x.id))
  for (const x of list) one('line', x.lines)
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
  // `layer` here is the name's scope (docs/names-scope.md): a curve's layer's curves, a line's curve
  const wanted: { kind: Kind; id: Id; layer: string; name: string }[] = []
  const sc = scopes(n, g)
  for (const [from, name] of data.lines) { const to = lineMap.get(from); if (to && net.hasLine(n, to)) wanted.push({ kind: 'line', id: to, layer: sc.get(`line ${to}`)!, name }) }
  for (const src of data.groups) {
    const first = lineMap.get(src.lines[0]!)
    const target = first && after.find(x => x.lines.includes(first))
    if (target && target.lines.every(l => copied.has(l))) wanted.push({ kind: 'group', id: target.id, layer: `curves ${target.layer}`, name: src.name })
  }
  // clear the temporary names of everything that is purely pasted — every new line and every
  // curve made only of new lines, wanted here or not — so no temporary default takes a name
  // that could be kept; names of existing objects stay (dot 1791655586)
  const fresh = new Set(after.filter(x => x.lines.every(l => copied.has(l))).map(x => x.id))
  S(st).line = S(st).line.filter(e => !copied.has(e[0]))
  S(st).group = S(st).group.filter(e => !fresh.has(e[0]))
  const usedIn = (layer: Id) => holdersIn(st, n, g, layer)
  const late: typeof wanted = []
  for (const w of wanted) { if (usedIn(w.layer).has(w.name)) late.push(w); else set(st, w.kind, w.id, w.name) }
  for (const w of late) set(st, w.kind, w.id, copyNameFrom(usedIn(w.layer), w.name))
  update(st, n, g)
}

/**
 * At commit: layer names unique among layers; curve names among their layer's curves; line
 * names among their curve's lines; none empty (docs/names-scope.md).
 */
export function check(st: NamesState, n: net.NetworkState, g: groups.GroupsState) {
  const seenIn = new Map<string, Map<string, string>>()
  const add = (scope: string, name: string, who: string) => {
    if (!name.trim()) throw new Error(`${who} has an empty name`)
    let seen = seenIn.get(scope)
    if (!seen) { seen = new Map(); seenIn.set(scope, seen) }
    const other = seen.get(name)
    if (other) throw new Error(`Name "${name}" is used by both ${other} and ${who}`)
    seen.set(name, who)
  }
  for (const l of net.layerRecords(n)) add('layers', l.name, `layer ${l.id}`)
  const sc = scopes(n, g)
  for (const kind of ['group', 'line'] as const) for (const [id, name] of S(st)[kind]) add(sc.get(`${kind} ${id}`) ?? '?', name, `${kind} ${id}`)
}

/** Names from saved data, checked: every line and every group has exactly one name, and no name repeats in its scope. */
export function restore(v: unknown, n: net.NetworkState, g: groups.GroupsState): NamesState {
  const d = net.data, o = d.obj(v, 'names')
  let stripped = false
  const entries = (kind: Kind, ids: Id[]) => {
    const list = d.arr(o[kind], `${kind} names`).map((x, i): [Id, string] => {
      const e = d.arr(x, `${kind} name ${i}`)
      // 「·」 joins the parts of a true name: removed from names saved before (bowen 1792308685); empty → the default
      const name = d.str(e[1], `${kind} name ${i}`), clean = name.replaceAll('·', '')
      if (clean !== name) stripped = true
      return [d.str(e[0], `${kind} name ${i} id`), clean.trim() ? clean : DEFAULT[kind]]
    })
    d.unique(list.map(e => e[0]), `${kind} name for`)
    const have = new Set(list.map(e => e[0]))
    for (const id of ids) if (!have.has(id)) d.fail(`${kind} ${id} has no name`)
    if (list.length !== ids.length) d.fail(`a ${kind} name belongs to a missing ${kind}`)
    return list
  }
  const st = { line: entries('line', net.lines(n).map(l => l.id)), group: entries('group', groups.list(g, n).map(x => x.id)) } as Store as unknown as NamesState
  // only names changed by removing 「·」 may collide here and are repaired; any other repeat is a bad file (refused)
  if (stripped) dedupe(st, n, g)
  try { check(st, n, g) } catch (err) { d.fail((err as Error).message) }
  return st
}
