// document — the single authoritative state, one atomic transaction per edit,
// undo / redo, and the fixed pipeline (README). The Editor is thin: each method
// calls the owning module's operation; it holds no rules of its own.
import * as net from '../network'
import * as groups from '../groups'
import * as joins from '../joins'
import * as links from '../links'
import * as fills from '../fills'
import * as derived from '../derived'
import * as locks from '../locks'
import * as editing from '../editing'
import * as apply from '../apply'
import type { Vec } from '../geometry'

type Id = net.Id

interface State {
  network: net.NetworkState
  groups: groups.GroupsState
  joins: joins.JoinsState
  links: links.LinksState
  fills: fills.FillsState
  /** A pre-edit, part of the state so it is undoable (bowen 1791465011). */
  selection: editing.SelectionState
  /** The symmetry axis and the mirror-link pairs. */
  apply: apply.ApplyState
}

const createState = (axis = 0): State => ({
  network: net.create(), groups: groups.create(), joins: joins.create(), links: links.create(), fills: fills.create(), selection: editing.create(),
  apply: apply.create(axis),
})

export interface Snapshot {
  /** Layers bottom → top. */
  layers: net.Layer[]
  points: { id: Id; layer: Id; position: Vec; links: Id[]; endStroke?: joins.EndStroke }[]
  lines: { id: Id; a: Id; b: Id; ha: Vec; hb: Vec; state: net.ElementState; stroke: net.Stroke }[]
  groups: groups.Group[]
  joins: joins.JoinRow[]
  links: { a: Id; b: Id }[]
  linkJoins: links.LinkJoin[]
  /** Every closed curve, each tagged with the continuous curve (group) it belongs to. */
  loops: (fills.LoopView & { group: Id })[]
  fillOrder: Id[]
  selection: editing.Unit[]
  /** The document's vertical symmetry axis, x = axis. */
  axis: number
  mirrorPairs: apply.Pair[]
}
export type Geometry = derived.Geometry

class Cancelled extends Error {}

/**
 * Transaction lifecycle (dot 1791427515). One mechanism covers every case:
 * - an Editor is valid only while its own edit is running; any later call throws;
 * - while an edit runs, edit / undo / redo on the same document throw (no re-entry);
 * - the edit works on a private copy that is published only after the pipeline
 *   succeeds; a throw or cancel publishes nothing;
 * - modules copy every input they store, so no caller object is shared with the state.
 */
interface Transaction {
  open: boolean; cancelled: boolean; failed: boolean; readonly state: State; readonly changes: net.Changes
  /** For each line an apply locked in this edit: a copy of the state right after that apply (for the lock check). */
  readonly appliedFrom: Map<Id, locks.View>
}
const transactions = new WeakMap<Editor, Transaction>()

export class Editor {
  private constructor() {}
  /** @internal */ static open(state: State): Editor {
    const e = new Editor()
    transactions.set(e, { open: true, cancelled: false, failed: false, state, changes: net.emptyChanges(), appliedFrom: new Map() })
    return e
  }

  private get tx(): Transaction {
    const tx = transactions.get(this)
    if (!tx?.open) throw new Error('This editor belongs to a finished edit')
    return tx
  }
  private get s(): State { return this.tx.state }

  private topology(op: (ch: net.Changes) => void) {
    const { state, changes } = this.tx
    applyTopology(state, changes, op)
  }

  // layers (Q29, Q30)
  /** New empty layer, directly above `above` (or on top). The name defaults to the id and must be unique. */
  layer(id: Id, name?: string, above?: Id) { net.addLayer(this.s.network, id, name, above) }
  renameLayer(id: Id, name: string) { net.renameLayer(this.s.network, id, name) }
  /** A state change: move a layer to `index` (bottom → top). */
  reorderLayer(id: Id, index: number) { net.reorderLayer(this.s.network, id, index) }
  /**
   * New-identity copy directly above the original (Q30). Every new id is
   * `${newId}/${old id}`. Joins, end strokes, fills and element states are copied;
   * endpoint links never are. The name defaults to a unique "name · k".
   */
  copyLayer(id: Id, newId: Id, name?: string) {
    const { state: s } = this.tx
    const base = net.layerRecords(s.network).find(l => l.id === id)
    if (!base) throw new Error(`No layer ${id}`)
    net.addLayer(s.network, newId, name ?? net.uniqueLayerName(s.network, base.name), id)
    const idOf = (old: Id) => `${newId}/${old}`
    // lines in their groups' order, so the copied groups keep the same order
    const lineIds = groups.list(s.groups, s.network).filter(g => g.layer === id).flatMap(g => g.lines)
    let map: net.CopyMap = { points: new Map(), lines: new Map() }
    this.topology(() => { map = net.copyLines(s.network, lineIds, newId, idOf) })
    joins.copy(s.joins, map)
    fills.copy(s.fills, map, idOf)
  }
  /** Batch delete (Q30): unlocked lines and fills go; the layer goes once it holds nothing. */
  deleteLayer(id: Id) {
    const { state: s } = this.tx
    if (!net.hasLayer(s.network, id)) throw new Error(`No layer ${id}`)
    fills.clearUnlocked(s.fills, fills.inLayer(s.fills, s.network, id))
    // a paired delete may already have removed a later line of this list
    for (const l of this.linesIn(id)) if (!l.state.locked && net.hasLine(s.network, l.id)) this.deleteLine(l.id)
    this.topology(ch => { net.removeIsolated(s.network, ch); net.removeLayerIfEmpty(s.network, ch, id) })
  }

  // element state (Q29): a state change, allowed on locked elements; batches for groups and layers
  lineState(line: Id, state: { visible?: boolean; locked?: boolean }) {
    for (const id of apply.pairedLines(this.s.apply, this.s.network, line)) net.changeLineState(this.s.network, this.tx.changes, id, state)
  }
  fillState(loop: Id, state: { visible?: boolean; locked?: boolean }) { for (const id of this.loops(loop)) fills.setState(this.s.fills, id, state) }
  /** A batch over the group's own lines; its fills keep their own switch (bowen 1791433646). */
  groupState(group: Id, state: { visible?: boolean; locked?: boolean }) {
    for (const id of groups.get(this.s.groups, group).lines) this.lineState(id, state)
  }
  layerState(layer: Id, state: { visible?: boolean; locked?: boolean }) {
    for (const l of this.linesIn(layer)) this.lineState(l.id, state)
    this.layerFills(layer, state)
  }
  /** Fills only (backlog 3, dot 1791435501). */
  layerFills(layer: Id, state: { visible?: boolean; locked?: boolean }) {
    if (!net.hasLayer(this.s.network, layer)) throw new Error(`No layer ${layer}`)
    for (const id of fills.inLayer(this.s.fills, this.s.network, layer)) this.fillState(id, state)
  }

  // network: one-time edits
  /** Pen: each end is an existing point id, or { id, layer, position } for a new point made with the line. */
  line(id: Id, a: net.EndSpec, b: net.EndSpec, handles?: { ha: Vec; hb: Vec }) { this.topology(ch => net.addLine(this.s.network, ch, id, a, b, handles)) }
  move(targets: { id: Id; target: Vec }[]) { net.move(this.s.network, this.tx.changes, targets) }
  /** One-time snap of `moving` onto `target`; no lasting relation (bowen 1791424844). */
  mergePosition(target: Id, moving: Id) { this.move([{ id: moving, target: net.point(this.s.network, target).position }]) }
  moveHandle(line: Id, end: net.End, offset: Vec) { net.moveHandle(this.s.network, this.tx.changes, line, end, offset) }
  // Each operation below runs on every item apply's paired plan lists (graph "Mirror link").
  split(line: Id, t: number, mid: Id, first: Id, second: Id) {
    const ops = apply.pairedSplits(this.s.apply, line, t, mid, first, second)
    this.topology(ch => { for (const o of ops) net.splitLine(this.s.network, ch, o.line, o.t, o.mid, o.first, o.second) })
  }
  deleteLine(id: Id) {
    const ids = apply.pairedLines(this.s.apply, this.s.network, id)
    this.topology(ch => { for (const x of ids) net.deleteLine(this.s.network, ch, x) })
  }
  bind(keep: Id, remove: Id) {
    const plan = apply.pairedBinds(this.s.apply, this.s.network, keep, remove)
    this.topology(ch => { for (const [k, r] of plan.binds) net.bind(this.s.network, ch, k, r) })
    this.move(plan.settle.map(id => ({ id, target: net.point(this.s.network, id).position })))
  }
  unbind(point: Id, lines: Id[], newPoint: Id) {
    const ops = apply.pairedUnbinds(this.s.apply, this.s.network, point, lines, newPoint)
    this.topology(ch => { for (const o of ops) net.unbind(this.s.network, ch, o.point, o.lines, o.newPoint) })
    // the unbind placed its new points; they go through the same position solve as any
    // other placed point (links, mirror), so a new point that is its own counterpart
    // lands on the axis (dot, review of 39b192a)
    this.move(ops.map(o => ({ id: o.newPoint, target: net.point(this.s.network, o.newPoint).position })))
  }

  // joins and end strokes (point attributes)
  /** Set a join between two lines at a point; l1 is clicked first. For smooth, l2 turns to l1 (bowen 1791428722). */
  /** Under a mirror link a join among paired lines is set on the counterpart too (graph "Mirror link"). */
  join(point: Id, l1: Id, l2: Id, opts: { mode: joins.JoinMode; radius?: number }) {
    const { state, changes } = this.tx
    for (const [p, a, b] of apply.pairedJoins(state.apply, state.network, point, l1, l2)) {
      joins.setJoin(state.joins, state.network, p, a, b, opts)
      net.touch(changes, p)
      if (opts.mode === 'smooth') net.hold(state.network, changes, a, net.line(state.network, a).a === p ? 'a' : 'b')
    }
  }
  removeJoin(point: Id, l1: Id, l2: Id) {
    for (const [p, a, b] of apply.pairedJoins(this.s.apply, this.s.network, point, l1, l2)) { joins.removeJoin(this.s.joins, p, a, b); net.touch(this.tx.changes, p) }
  }
  endStroke(point: Id, stroke: joins.EndStroke) {
    for (const p of apply.pairedPoints(this.s.apply, this.s.network, point)) joins.setEndStroke(this.s.joins, this.s.network, p, stroke)
  }

  // links (cross-layer relation)
  link(a: Id, b: Id) {
    for (const [x, y] of apply.pairedPointPairs(this.s.apply, this.s.network, a, b)) this.move([links.link(this.s.links, this.s.network, x, y)])
  }
  /** Removing a link is a constraint change at both points (dot 1791431139). */
  unlink(a: Id, b: Id) {
    for (const [x, y] of apply.pairedPointPairs(this.s.apply, this.s.network, a, b)) { links.unlink(this.s.links, x, y); net.touch(this.tx.changes, x); net.touch(this.tx.changes, y) }
  }
  /** Join across a link: la ends at a (clicked first), lb at b. Smooth: lb turns to la. */
  linkJoin(a: Id, b: Id, la: Id, lb: Id, opts: { mode: 'smooth' }) {
    const { state, changes } = this.tx
    for (const [x, y, lx, ly] of apply.pairedLinkJoins(state.apply, state.network, a, b, la, lb)) {
      const held = links.setJoin(state.links, state.network, x, y, lx, ly, opts)
      net.touch(changes, x); net.touch(changes, y)
      net.hold(state.network, changes, held.line, held.end)
    }
  }
  removeLinkJoin(a: Id, b: Id, la: Id, lb: Id) {
    for (const [x, y, lx, ly] of apply.pairedLinkJoins(this.s.apply, this.s.network, a, b, la, lb)) { links.removeJoin(this.s.links, x, y, lx, ly); net.touch(this.tx.changes, x); net.touch(this.tx.changes, y) }
  }

  // stroke: stored on each line (bowen 1791434322)
  lineStroke(line: Id, stroke: net.Stroke) { for (const id of apply.pairedLines(this.s.apply, this.s.network, line)) net.setLineStroke(this.s.network, id, stroke) }
  /** A group's width change is a batch over its unlocked lines (Q29 D). */
  stroke(group: Id, stroke: net.Stroke) {
    for (const id of groups.get(this.s.groups, group).lines) if (!net.line(this.s.network, id).state.locked) this.lineStroke(id, stroke)
  }

  // groups (continuous curves)
  reorderGroup(group: Id, index: number) { groups.reorder(this.s.groups, group, index) }
  /**
   * Cut and paste a whole group into another layer, keeping every id (Q31). Refused
   * if any of its elements is locked. It lands on top of the target layer; links
   * whose partner is still there stay, and coincident points in one layer bind.
   */
  moveGroup(group: Id, layer: Id) {
    const { state: s } = this.tx
    const g = groups.get(s.groups, group)
    if (g.layer === layer) return
    const locked = [...g.lines.filter(id => net.line(s.network, id).state.locked),
      ...fills.discover(s.fills, s.network).filter(v => v.locked && this.fillsOf(g.lines).includes(v.id)).map(v => v.id)]
    if (locked.length) throw new Error(`Group ${group} holds locked elements (${locked.join(', ')}); it cannot be cut`)
    this.topology(ch => net.moveLinesToLayer(s.network, ch, g.lines, layer))
  }

  // fills (closed loops)
  fill(loop: Id, color: string) { for (const id of this.loops(loop)) fills.fill(this.s.fills, this.s.network, id, color) }
  clearFill(loop: Id) { for (const id of this.loops(loop)) fills.clearFill(this.s.fills, id) }
  fillVisible(loop: Id, visible: boolean) { this.fillState(loop, { visible }) }
  /** Move a fill to `index` among the fills of its own group. */
  reorderFill(loop: Id, index: number) { fills.reorder(this.s.fills, this.s.network, loop, index) }

  private linesIn(layer: Id) {
    if (!net.hasLayer(this.s.network, layer)) throw new Error(`No layer ${layer}`)
    return net.lines(this.s.network).filter(l => net.layerOfLine(this.s.network, l.id) === layer)
  }
  /** Filled loops whose boundary lies in the given lines. */
  private fillsOf(lineIds: readonly Id[]): Id[] {
    const set = new Set(lineIds)
    return fills.discover(this.s.fills, this.s.network).filter(v => v.filled && v.route.every(u => set.has(u.line))).map(v => v.id)
  }

  // editing (graph: Editing table)
  /** Change the selection; one undoable step when it changes anything. */
  select(units: editing.Unit[], mode: editing.Mode = 'replace') { editing.select(this.s.selection, this.s.network, this.s.fills, units, mode) }
  /** V: select the whole continuous curve of a line. */
  selectGroup(line: Id, mode: editing.Mode = 'replace') { this.select(editing.groupUnits(this.s.groups, this.s.network, line), mode) }
  /** One geometric transform of what the selection expands to. */
  transform(m: editing.Affine) {
    const { state: s, changes } = this.tx
    const plan = editing.transformPlan(s.selection, s.network, s.fills, m)
    net.move(s.network, changes, plan.moves)
    for (const h of plan.handles) net.aimHandle(s.network, changes, h.line, h.end, h.tip)
  }
  translate(dx: number, dy: number) { this.transform(editing.translation(dx, dy)) }
  rotate(centre: Vec, angle: number) { this.transform(editing.rotation(centre, angle)) }
  scale(centre: Vec, sx: number, sy: number) { this.transform(editing.scaling(centre, sx, sy)) }
  /** Flip in place about the selection's own centre (an edit; no copy, bowen 1791471111). */
  flip() { this.transform(editing.scaling(editing.centre(this.s.selection, this.s.network, this.s.fills), -1, 1)) }
  /** Delete the selected lines; without a selected line it is refused. */
  deleteSelection() {
    for (const id of editing.deletion(this.s.selection)) if (net.hasLine(this.s.network, id)) this.deleteLine(id)
  }

  // apply (graph: Editing "Apply", Mirror table)
  /** Mirror apply: reflect the source lines across the axis into different target lines (one step). */
  mirrorApply(source: Id[], target: Id[]) { const { state: s, changes } = this.tx; apply.mirrorApply(s.apply, s, changes, source, target); this.afterApply() }
  /** Mirror link between whole first-level elements: a mirror apply, then the pairs are stored. */
  mirrorLink(sourceGroups: Id[], targetGroups: Id[]) { const { state: s, changes } = this.tx; apply.mirrorLink(s.apply, s, s.groups, changes, sourceGroups, targetGroups); this.afterApply() }
  /** Remove the mirror link of these lines; geometry stays. */
  unmirror(lines: Id[]) { apply.unmirror(this.s.apply, lines) }

  /**
   * For every line an apply locked: the state once the edit so far has been settled by
   * the normal constraint pipeline (links, mirror, springs) — run on a scratch copy —
   * so the apply's own constraint results are allowed and only later changes count
   * (dot, reviews of 44c58b4 and d9e2247).
   */
  private afterApply() {
    const { state: s, changes, appliedFrom } = this.tx
    const fresh = changes.appliedLocks.filter(id => !appliedFrom.has(id))
    if (!fresh.length) return
    const scratch = structuredClone(s), scratchChanges = structuredClone(changes)
    settle(scratch, scratchChanges)
    const settled = { network: scratch.network, joins: scratch.joins, links: scratch.links }
    for (const id of fresh) appliedFrom.set(id, settled)
  }
  private loops(loop: Id): Id[] { return apply.pairedLoops(this.s.apply, this.s.fills, this.s.network, loop) }

  /** Cancel the edit. Recorded on the transaction, so it holds even if the callback catches the throw (dot 1791428573). */
  cancel(): never {
    const tx = this.tx
    tx.cancelled = true
    tx.open = false
    throw new Cancelled('cancelled')
  }
}

/**
 * Atomicity for every public editor operation (dot 1791429209): if any operation
 * throws, the transaction is marked failed and closed, so the edit publishes
 * nothing even if the callback catches the error. One wrapper, applied to all
 * public methods, instead of per-operation handling.
 */
for (const name of Object.getOwnPropertyNames(Editor.prototype)) {
  const d = Object.getOwnPropertyDescriptor(Editor.prototype, name)
  if (!d || typeof d.value !== 'function' || ['constructor', 'topology', 'cancel', 'linesIn', 'fillsOf', 'loops', 'afterApply'].includes(name)) continue
  const original = d.value as (...args: unknown[]) => unknown
  Object.defineProperty(Editor.prototype, name, {
    ...d,
    value(this: Editor, ...args: unknown[]) {
      try { return original.apply(this, args) }
      catch (err) {
        const tx = transactions.get(this)
        if (tx?.open) { tx.failed = true; tx.open = false }
        throw err
      }
    },
  })
}

export class Core {
  private state: State
  /** `axis`: the document's vertical symmetry axis, a fixed setting (graph "Symmetry axis"). */
  constructor(options: { axis?: number } = {}) { this.state = createState(options.axis) }
  private past: State[] = []
  private future: State[] = []
  private editing = false

  /**
   * A new document: one empty layer (bowen 1791435000). `new Core()` is the bare
   * model, which may hold zero layers; this is the entry a "new document" uses.
   * The default layer is part of the starting state, not an undo step.
   */
  static newDocument(options: { layer?: { id: Id; name: string }; axis?: number } = {}): Core {
    const layer = options.layer ?? { id: 'layer-1', name: 'Layer 1' }
    const d = new Core({ axis: options.axis })
    d.edit(e => e.layer(layer.id, layer.name))
    d.past = []
    return d
  }

  private idle(what: string) {
    if (this.editing) throw new Error(`${what} cannot run while an edit is in progress`)
  }

  /** One atomic edit. Throws (and changes nothing) if any step fails; cancel() discards silently. */
  edit(fn: (e: Editor) => void): void {
    this.idle('edit')
    this.editing = true
    const draft = structuredClone(this.state)
    const e = Editor.open(draft)
    const tx = transactions.get(e)!
    try {
      const result: unknown = fn(e)
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        // An async callback would keep running after the edit closes (dot 1791427941).
        throw new Error('edit callbacks must be synchronous; nothing was published')
      }
      if (tx.cancelled) return
      if (tx.failed) throw new Error('An operation in this edit failed; nothing was published')
      commit(draft, tx.changes, this.state, tx.appliedFrom)
    } catch (err) {
      if (err instanceof Cancelled) return
      throw err
    } finally {
      tx.open = false
      this.editing = false
    }
    if (JSON.stringify(draft) === JSON.stringify(this.state)) return
    this.past.push(this.state)
    this.future = []
    this.state = draft
  }

  undo() { this.idle('undo'); const s = this.past.pop(); if (s) { this.future.push(this.state); this.state = s } }
  redo() { this.idle('redo'); const s = this.future.pop(); if (s) { this.past.push(this.state); this.state = s } }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }

  snapshot(): Snapshot {
    const s = this.state, n = s.network
    const groupList = groups.list(s.groups, n)
    const groupOfLine = new Map(groupList.flatMap(g => g.lines.map(l => [l, g.id] as const)))
    return structuredClone({
      layers: [...net.layerRecords(n)],
      points: net.points(n).map(p => {
        const end = joins.endStroke(s.joins, p.id)
        return { id: p.id, layer: p.layer, position: p.position, links: links.partners(s.links, p.id), ...(end ? { endStroke: end } : {}) }
      }),
      lines: net.lines(n).map(l => ({ ...l })),
      groups: groupList,
      joins: joins.rows(s.joins),
      links: links.pairs(s.links),
      linkJoins: links.joins(s.links),
      loops: fills.discover(s.fills, n).map(l => ({ ...l, group: groupOfLine.get(l.route[0]!.line)! })),
      fillOrder: fills.order(s.fills),
      selection: editing.units(s.selection),
      axis: apply.axis(s.apply),
      mirrorPairs: apply.pairs(s.apply),
    })
  }

  geometry(): Geometry { return structuredClone(derived.derive(this.state.network, this.state.joins, this.state.fills)) }

  /** Canvas fill pick: the smallest loop containing the point. */
  pickLoop(at: Vec): Id | undefined { return derived.pickLoop(this.state.network, this.state.joins, this.state.fills, at) }
}

/** One network operation, then every attribute module updates its own references. */
function applyTopology(state: State, changes: net.Changes, op: (ch: net.Changes) => void) {
  const ch = net.emptyChanges()
  op(ch)
  joins.update(state.joins, state.network, ch)
  links.update(state.links, state.network, ch)
  fills.update(state.fills, ch)
  groups.reconcile(state.groups, state.network, ch)
  apply.update(state.apply, ch)
  net.followReplacements(changes, ch)
  for (const k of Object.keys(ch) as (keyof net.Changes)[]) (changes[k] as unknown[]).push(...(ch[k] as unknown[]))
}

/**
 * The fixed pipeline before publishing (docs/layer-batch-plan.md):
 * isolated points → position loop (overlap bind, link alignment) → smooth springs
 * → fills → groups → locks.
 */
function commit(s: State, ch: net.Changes, published: State, appliedFrom: ReadonlyMap<Id, locks.View> = new Map()) {
  settle(s, ch)
  const changed = locks.changed(published, s, ch, appliedFrom)
  if (changed.length) throw new Error(`Locked lines would change (${changed.join(', ')}); nothing was published`)
}

/** The fixed pipeline up to (not including) the lock check: everything the edit's constraints settle. */
function settle(s: State, ch: net.Changes) {
  applyTopology(s, ch, c => net.removeIsolated(s.network, c))
  // Link alignment can make new coincidences, and binding can end links, so repeat
  // until no two endpoints in one layer coincide (dot, after f9c4109). Each pass
  // removes at least one point, so it ends.
  for (;;) {
    net.setPositions(s.network, links.align(s.links, s.network, ch, { axis: apply.axis(s.apply), pairs: apply.pointPairs(s.apply, s.network) }))
    const pairs = net.overlaps(s.network, ch)
    if (!pairs.length) break
    for (const p of pairs) applyTopology(s, ch, c => net.bind(s.network, c, p.keep, p.remove))
    applyTopology(s, ch, c => net.removeIsolated(s.network, c))
  }
  // aimed handles take their offsets from the final point positions
  net.resolveHandleTips(s.network, ch)
  // mirror-linked handles: a held handle gives its counterpart the reflected handle, held too
  for (const h of apply.mirroredHandles(s.apply, s.network, ch)) net.moveHandle(s.network, ch, h.line, h.end, h.offset)
  net.setHandles(s.network, joins.solve(s.joins, s.network, ch, links.smoothPairs(s.links, s.network)))
  fills.validate(s.fills, s.network)
  groups.reconcile(s.groups, s.network, net.emptyChanges())
  editing.clean(s.selection, s.network, s.fills)
}
