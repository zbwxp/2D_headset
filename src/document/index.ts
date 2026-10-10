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
import * as names from '../names'
import * as clipboard from '../clipboard'
import * as views from '../views'
import type { Vec } from '../geometry'

type Id = net.Id

interface State {
  /** Bound to the front view: the single-view compatibility entry (docs/architecture-multiview.md §2, package 6). */
  network: net.NetworkState
  groups: groups.GroupsState
  joins: joins.JoinsState
  links: links.LinksState
  fills: fills.FillsState
  /** A pre-edit, part of the state so it is undoable (bowen 1791465011). */
  selection: editing.SelectionState
  /** The symmetry axis and the mirror-link pairs. */
  apply: apply.ApplyState
  /** Names of continuous curves and lines (layer names live on the layer). */
  names: names.NamesState
}

/** A drawing has its nine view layers from the start (graph "Views"; step 3, Claude 1791653309). */
function viewedNetwork(): net.NetworkState {
  const n = net.create({ key: views.FRONT, kind: 'view' })
  for (const k of views.ALL) if (k !== views.FRONT) net.addShapeLayer(n, k, 'view', views.FRONT)
  return n
}
const createState = (axis = 0): State => ({
  network: viewedNetwork(), groups: groups.create(), joins: joins.create(), links: links.create(), fills: fills.create(), selection: editing.create(),
  apply: apply.create(axis), names: names.create(),
})

export interface Snapshot {
  /** Layers bottom → top. */
  layers: net.Layer[]
  points: { id: Id; layer: Id; position: Vec; links: Id[]; endStroke?: joins.EndStroke }[]
  lines: { id: Id; name: string; a: Id; b: Id; ha: Vec; hb: Vec; state: net.ElementState; stroke: net.Stroke }[]
  groups: (groups.Group & { name: string })[]
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
  /** The shape layer this edit writes geometry into; `state.network` is bound to it during the edit. */
  readonly layer: string
  /** For each line an apply locked in this edit: a copy of the state right after that apply (for the lock check). */
  readonly appliedFrom: Map<Id, locks.View>
}
const transactions = new WeakMap<Editor, Transaction>()

export class Editor {
  private constructor() {}
  /** @internal */ static open(state: State, layer: string): Editor {
    const e = new Editor()
    transactions.set(e, { open: true, cancelled: false, failed: false, state, changes: net.emptyChanges(), appliedFrom: new Map(), layer })
    return e
  }
  /**
   * Mirror links act only at 0,0 (bowen 1791650323). In another view an operation that
   * would act on a mirror pair is not defined yet, so it is refused (dot 1791653374).
   */
  private paired<T>(items: T[]): T[] {
    if (this.tx.layer !== views.FRONT && items.length > 1) throw new net.Refusal('mirror-front-only', `mirror-front-only: mirror-linked lines are edited together only in the front view (this edit is in ${this.tx.layer})`)
    return items
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
  renameLayer(id: Id, name: string) {
    names.assertFree(this.s.names, this.s.network, name, `layer ${id}`)
    net.renameLayer(this.s.network, id, name)
  }
  /** A locked line's name is something it owns alone (graph rows "Names", "Locked element"). */
  renameLine(id: Id, name: string) {
    if (net.line(this.s.network, id).state.locked) throw new net.Refusal('locked', `Line ${id} is locked`, net.lineObjects([id]))
    names.rename(this.s.names, this.s.network, this.s.groups, 'line', id, name)
  }
  /** A group has no lock of its own (a lock does not lock the parent). */
  renameGroup(id: Id, name: string) { names.rename(this.s.names, this.s.network, this.s.groups, 'group', id, name) }
  /** A state change: move a layer to `index` (bottom → top). */
  reorderLayer(id: Id, index: number) { net.reorderLayer(this.s.network, id, index) }
  /**
   * New-identity copy directly above the original (Q30). Every new id is
   * `${newId}/${old id}`. Joins, end strokes, fills and element states are copied;
   * endpoint links never are. Names default to "<name>副本", then 副本2, … (graph "Names", note).
   */
  copyLayer(id: Id, newId: Id, name?: string) {
    const { state: s } = this.tx
    const base = net.layerRecords(s.network).find(l => l.id === id)
    if (!base) throw new Error(`No layer ${id}`)
    if (name !== undefined) names.assertFree(s.names, s.network, name)
    net.addLayer(s.network, newId, name ?? names.copyName(s.names, s.network, base.name), id)
    // a layer copy is a clip of all its lines (in their groups' order), pasted in place
    const lineIds = groups.list(s.groups, s.network).filter(g => g.layer === id).flatMap(g => g.lines)
    if (!lineIds.length) return
    this.insertClip(clipboard.extract({ ...s, network: this.view().network }, lineIds), newId, { x: 0, y: 0 }, old => `${newId}/${old}`)
  }
  /**
   * Paste (graph "Cut, paste / copy"; docs/clipboard-plan.md): the clip's lines, joins,
   * end strokes and fills into `layer`, moved by `offset`, with new ids `<prefix>/<old id>`
   * and names "<name>副本". Locks come along; coincident end points bind as usual. The
   * pasted lines become the selection.
   */
  paste(clip: clipboard.Clip, layer: Id, offset: Vec, prefix: string) {
    const { changes } = this.tx, before = new Set(changes.appliedLocks)
    const map = this.insertClip(clipboard.check(clip), layer, offset, old => `${prefix}/${old}`)
    // a pasted lock protects from the moment of the paste, as a lock an apply copies does
    // (net.applyLineState; dot 1791513520): later changes in this edit are compared with
    // the state right after the paste
    for (const id of map.lines.values()) if (net.line(this.s.network, id).state.locked) changes.appliedLocks.push(id)
    this.afterApply(before)
    this.select([...map.lines.values()].map(id => ({ kind: 'line' as const, id })))
  }
  private insertClip(clip: clipboard.Clip, layer: Id, offset: Vec, idOf: (old: Id) => Id): net.CopyMap {
    const { state: s } = this.tx
    let map: net.CopyMap = { points: new Map(), lines: new Map() }
    let layers: Map<string, string> = new Map()
    this.topology(ch => { ({ map, layers } = clipboard.insert(s, ch, clip, layer, offset, idOf)) })
    clipboard.attach(s, clip, map, idOf, layers)
    return map
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
    for (const id of this.paired(apply.pairedLines(this.s.apply, this.s.network, line))) {
      const wasLocked = net.line(this.s.network, id).state.locked
      net.changeLineState(this.s.network, this.tx.changes, id, state)
      // a real unlock ends a protection phase an apply or a paste started (dot, review of
      // 05938ea); locking an already locked line keeps it (dot 1791514309)
      if (state.locked === false && wasLocked) this.tx.appliedFrom.delete(id)
    }
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
  line(id: Id, a: net.EndSpec, b: net.EndSpec, handles?: { ha: Vec; hb: Vec }) {
    const read = handles ? this.s.network : this.view().network
    this.topology(ch => net.addLine(this.s.network, ch, id, a, b, handles, read))
  }
  move(targets: { id: Id; target: Vec }[]) { net.move(this.s.network, this.tx.changes, targets) }
  /** One-time snap of `moving` onto `target`; no lasting relation (bowen 1791424844). */
  mergePosition(target: Id, moving: Id) { this.move([{ id: moving, target: net.point(this.view().network, target).position }]) }
  moveHandle(line: Id, end: net.End, offset: Vec) { net.moveHandle(this.s.network, this.tx.changes, line, end, offset) }
  // Each operation below runs on every item apply's paired plan lists (graph "Mirror link").
  split(line: Id, t: number, mid: Id, first: Id, second: Id) {
    const ops = this.paired(apply.pairedSplits(this.s.apply, line, t, mid, first, second)), read = this.view().network
    this.topology(ch => { for (const o of ops) net.splitLine(this.s.network, ch, o.line, o.t, o.mid, o.first, o.second, read) })
  }
  deleteLine(id: Id) {
    const ids = this.paired(apply.pairedLines(this.s.apply, this.s.network, id))
    this.topology(ch => { for (const x of ids) net.deleteLine(this.s.network, ch, x) })
  }
  bind(keep: Id, remove: Id) {
    const plan = apply.pairedBinds(this.s.apply, this.s.network, keep, remove)
    this.paired(plan.binds)
    this.topology(ch => { for (const [k, r] of plan.binds) net.bind(this.s.network, ch, k, r) })
    this.move(plan.settle.map(id => ({ id, target: net.point(this.s.network, id).position })))
  }
  unbind(point: Id, lines: Id[], newPoint: Id) {
    const ops = this.paired(apply.pairedUnbinds(this.s.apply, this.s.network, point, lines, newPoint)), read = this.view().network
    this.topology(ch => { for (const o of ops) net.unbind(this.s.network, ch, o.point, o.lines, o.newPoint, read) })
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
    for (const [p, a, b] of this.paired(apply.pairedJoins(state.apply, state.network, point, l1, l2))) {
      joins.setJoin(state.joins, state.network, p, a, b, opts)
      net.touch(changes, p)
      // the first-clicked side is held in every view: the join is shared, so its springs settle in each view (dot 1791653374)
      if (opts.mode === 'smooth') this.holdEverywhere(a, net.line(state.network, a).a === p ? 'a' : 'b')
    }
  }
  removeJoin(point: Id, l1: Id, l2: Id) {
    for (const [p, a, b] of this.paired(apply.pairedJoins(this.s.apply, this.s.network, point, l1, l2))) { joins.removeJoin(this.s.joins, this.s.network, p, a, b); net.touch(this.tx.changes, p) }
  }
  endStroke(point: Id, stroke: joins.EndStroke) {
    for (const p of this.paired(apply.pairedPoints(this.s.apply, this.s.network, point))) joins.setEndStroke(this.s.joins, this.s.network, p, stroke)
  }

  // links (cross-layer relation)
  link(a: Id, b: Id) {
    const read = this.view().network
    for (const [x, y] of this.paired(apply.pairedPointPairs(this.s.apply, this.s.network, a, b))) {
      this.move([links.link(this.s.links, this.s.network, x, y, read)])
      // the second point is moved onto the first in every view (a default, Claude 1791653309),
      // read from the edit's settled trial in that view (dot 1791653958)
      for (const k of viewKeys(this.s)) if (k !== this.tx.layer) {
        net.move(net.of(this.s.network, k), this.tx.changes, [{ id: y, target: net.point(net.of(read, k), x).position }])
      }
    }
  }
  /** Removing a link is a constraint change at both points (dot 1791431139). */
  unlink(a: Id, b: Id) {
    for (const [x, y] of this.paired(apply.pairedPointPairs(this.s.apply, this.s.network, a, b))) { links.unlink(this.s.links, x, y); net.touch(this.tx.changes, x); net.touch(this.tx.changes, y) }
  }
  /** Join across a link: la ends at a (clicked first), lb at b. Smooth: lb turns to la. */
  linkJoin(a: Id, b: Id, la: Id, lb: Id, opts: { mode: 'smooth' }) {
    const { state, changes } = this.tx
    for (const [x, y, lx, ly] of this.paired(apply.pairedLinkJoins(state.apply, state.network, a, b, la, lb))) {
      const held = links.setJoin(state.links, state.network, x, y, lx, ly, opts)
      net.touch(changes, x); net.touch(changes, y)
      this.holdEverywhere(held.line, held.end)
    }
  }
  removeLinkJoin(a: Id, b: Id, la: Id, lb: Id) {
    for (const [x, y, lx, ly] of this.paired(apply.pairedLinkJoins(this.s.apply, this.s.network, a, b, la, lb))) { links.removeJoin(this.s.links, x, y, lx, ly); net.touch(this.tx.changes, x); net.touch(this.tx.changes, y) }
  }

  // stroke: stored on each line (bowen 1791434322)
  lineStroke(line: Id, stroke: net.Stroke) { for (const id of this.paired(apply.pairedLines(this.s.apply, this.s.network, line))) net.setLineStroke(this.s.network, id, stroke) }
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
    const lockedLines = g.lines.filter(id => net.line(s.network, id).state.locked)
    const lockedFills = fills.discover(s.fills, s.network).filter(v => v.locked && this.fillsOf(g.lines).includes(v.id)).map(v => v.id)
    const locked = [...lockedLines, ...lockedFills]
    if (locked.length) throw new net.Refusal('locked', `Group ${group} holds locked elements (${locked.join(', ')}); it cannot be cut`, [...net.lineObjects(lockedLines), ...lockedFills.map(id => ({ kind: 'fill' as const, id }))])
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
  /**
   * A transform of the selection, or of `units` when given (docs/interaction-plan.md item 2;
   * dot 1791543296): the units are expanded exactly as a selection would be, on a scratch
   * selection, so the real selection is neither read nor changed. A drag commits this way
   * on the targets it started with.
   */
  transform(m: editing.Affine, units?: readonly editing.Unit[]) {
    const { state: s, changes } = this.tx, read = this.view().network
    const plan = editing.transformPlan(this.targets(units, read), read, s.fills, m)
    net.move(s.network, changes, plan.moves)
    for (const h of plan.handles) net.aimHandle(s.network, changes, h.line, h.end, h.tip)
  }
  translate(dx: number, dy: number, units?: readonly editing.Unit[]) { this.transform(editing.translation(dx, dy), units) }
  rotate(centre: Vec, angle: number, units?: readonly editing.Unit[]) { this.transform(editing.rotation(centre, angle), units) }
  scale(centre: Vec, sx: number, sy: number, units?: readonly editing.Unit[]) { this.transform(editing.scaling(centre, sx, sy), units) }
  /** Flip in place about its own centre (an edit; no copy, bowen 1791471111): of the selection, or of `units`. */
  flip(units?: readonly editing.Unit[]) {
    const read = this.view().network
    this.transform(editing.scaling(editing.centre(this.targets(units, read), read, this.s.fills), -1, 1), units)
  }
  private targets(units: readonly editing.Unit[] | undefined, read: net.NetworkState): editing.SelectionState {
    if (!units) return this.s.selection
    const scratch = editing.create()
    editing.select(scratch, read, this.s.fills, structuredClone([...units]), 'replace')
    return scratch
  }
  /** Delete the selected lines, or the lines among `units` (explicit targets, as the transforms take); without a line it is refused. */
  deleteSelection(units?: readonly editing.Unit[]) {
    for (const id of editing.deletion(this.targets(units, this.view().network))) if (net.hasLine(this.s.network, id)) this.deleteLine(id)
  }

  // apply (graph: Editing "Apply", Mirror table)
  /** Mirror apply: reflect the source lines across the axis into different target lines (one step). */
  mirrorApply(source: Id[], target: Id[]) {
    this.frontOnly('Mirror apply')
    const { state: s, changes } = this.tx, before = new Set(changes.appliedLocks)
    apply.mirrorApply(s.apply, s, changes, source, target, this.view())
    this.afterApply(before)
  }
  /** Mirror link between whole first-level elements: a mirror apply, then the pairs are stored. */
  mirrorLink(sourceGroups: Id[], targetGroups: Id[]) {
    this.frontOnly('A mirror link')
    const { state: s, changes } = this.tx, before = new Set(changes.appliedLocks)
    apply.mirrorLink(s.apply, s, s.groups, changes, sourceGroups, targetGroups, this.view())
    this.afterApply(before)
  }
  /** Remove the mirror link of these lines; geometry stays. */
  unmirror(lines: Id[]) { this.frontOnly('Removing a mirror link'); apply.unmirror(this.s.apply, lines) }
  /** A handle held in every view (a shared constraint's rule, not one view's drag). */
  private holdEverywhere(line: Id, end: net.End) {
    for (const k of viewKeys(this.s)) net.hold(net.of(this.s.network, k), this.tx.changes, line, end)
  }
  /** Mirror apply and mirror link are view-limited to 0,0 (bowen 1791649795, 1791650323). */
  private frontOnly(what: string) {
    if (this.tx.layer !== views.FRONT) throw new net.Refusal('mirror-front-only', `mirror-front-only: ${what} happens only in the front view`)
  }

  /**
   * For every line an apply locked: the state once the edit so far has been settled by
   * the normal constraint pipeline (links, mirror, springs) — run on a scratch copy —
   * so the apply's own constraint results are allowed and only later changes count
   * (dot, reviews of 44c58b4 and d9e2247).
   */
  private afterApply(before: ReadonlySet<Id>) {
    const { state: s, changes, appliedFrom } = this.tx
    // the lines this apply locked get a fresh baseline (a re-apply after an unlock starts a new one)
    const fresh = changes.appliedLocks.filter(id => !before.has(id))
    if (!fresh.length) return
    const scratch = structuredClone(s), scratchChanges = structuredClone(changes)
    // the same rules as the commit (dot 1791653374); mirror applies are front-only
    settle(scratch, scratchChanges, this.tx.layer)
    const settled = { network: scratch.network, joins: scratch.joins, links: scratch.links } // every view; the check reads each
    for (const id of fresh) appliedFrom.set(id, settled)
  }
  /**
   * The edit so far with positions and handles settled (links, mirror, aimed tips,
   * mirrored handles, springs), on a scratch copy, for operations that read geometry
   * (docs/edit-model.md §1.3). It changes no topology, so every id stays valid, and the
   * draft and its intents are untouched: the reading operation writes back only its own
   * changes (dot, review after 6aaaee6).
   */
  private view(): State {
    const scratch = structuredClone(this.s), ch = structuredClone(this.tx.changes)
    // every view, positions only and no auto-bind: later operations read every view
    // (a split re-expresses each view's curve; a link reads each view's first point), so
    // each must be read as the commit would settle it (dot 1791653958)
    for (const k of viewKeys(scratch)) settleLayerPositions(scratch, ch, k)
    return scratch
  }
  private loops(loop: Id): Id[] { return this.paired(apply.pairedLoops(this.s.apply, this.s.fills, this.s.network, loop)) }

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
  if (!d || typeof d.value !== 'function' || ['constructor', 'topology', 'cancel', 'linesIn', 'fillsOf', 'loops', 'afterApply', 'view', 'insertClip', 'targets', 'paired', 'frontOnly', 'holdEverywhere'].includes(name)) continue
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

  /**
   * One atomic edit in the front view: the single-view compatibility entry
   * (docs/architecture-multiview.md §2, package 6). Multi-view code uses `editIn`.
   */
  edit(fn: (e: Editor) => void): void { this.editIn(views.FRONT, fn) }

  /**
   * One atomic edit whose geometry goes into `layer`, which must be a view of this
   * document; nothing defaults it (dot 1791650999). Structure reaches every layer; the
   * edited view is settled fully, every other view by positions only (Q2: auto-bind is
   * judged only here). Throws (and changes nothing) if any step fails; cancel()
   * discards silently.
   */
  editIn(layer: string, fn: (e: Editor) => void): void {
    this.idle('edit')
    if (!viewKeys(this.state).includes(layer)) throw new net.Refusal('not-a-view', `not-a-view: ${String(layer)} is not a view of this document`)
    this.editing = true
    const draft = structuredClone(this.state)
    draft.network = net.of(draft.network, layer)
    const e = Editor.open(draft, layer)
    const tx = transactions.get(e)!
    try {
      const result: unknown = fn(e)
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        // An async callback would keep running after the edit closes (dot 1791427941).
        throw new Error('edit callbacks must be synchronous; nothing was published')
      }
      if (tx.cancelled) return
      if (tx.failed) throw new Error('An operation in this edit failed; nothing was published')
      commit(draft, tx.changes, this.state, tx.appliedFrom, layer)
      draft.network = net.of(draft.network, views.FRONT) // the stored handle stays the front compatibility entry
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

  /** The view layers of this document. */
  views(): string[] { return viewKeys(this.state) }

  /** Reads in one view (read-only; the current state each call). The methods below read the front. */
  in(layer: string): LayerReader {
    if (!viewKeys(this.state).includes(layer)) throw new net.Refusal('not-a-view', `not-a-view: ${String(layer)} is not a view of this document`)
    return new LayerReader(() => this.state, layer, what => this.idle(what))
  }

  snapshot(): Snapshot { return this.in(views.FRONT).snapshot() }
  geometry(): Geometry { return this.in(views.FRONT).geometry() }
  copy(lines?: readonly Id[]): clipboard.Clip { return this.in(views.FRONT).copy(lines) }
  nearby(at: Vec, radius: number): derived.Nearby[] { return this.in(views.FRONT).nearby(at, radius) }
  pickLoop(at: Vec): Id | undefined { return this.in(views.FRONT).pickLoop(at) }
  linesInRect(a: Vec, b: Vec, whole: boolean): Id[] { return this.in(views.FRONT).linesInRect(a, b, whole) }
  loopsAt(at: Vec): Id[] { return this.in(views.FRONT).loopsAt(at) }
}

/** The document read in one view. */
export class LayerReader {
  /** @internal */ constructor(private readonly state: () => State, readonly layer: string, private readonly idle: (what: string) => void) {}
  private get n() { return net.of(this.state().network, this.layer) }

  snapshot(): Snapshot {
    const s = this.state(), n = this.n
    const groupList = groups.list(s.groups, n)
    const groupOfLine = new Map(groupList.flatMap(g => g.lines.map(l => [l, g.id] as const)))
    return structuredClone({
      layers: [...net.layerRecords(n)],
      points: net.points(n).map(p => {
        const end = joins.endStroke(s.joins, n, p.id)
        return { id: p.id, layer: p.layer, position: p.position, links: links.partners(s.links, p.id), ...(end ? { endStroke: end } : {}) }
      }),
      lines: net.lines(n).map(l => ({ ...l, name: names.of(s.names, 'line', l.id)! })),
      groups: groupList.map(g => ({ ...g, name: names.of(s.names, 'group', g.id)! })),
      joins: joins.rows(s.joins, n),
      links: links.pairs(s.links),
      linkJoins: links.joins(s.links),
      loops: fills.discover(s.fills, n).map(l => ({ ...l, group: groupOfLine.get(l.route[0]!.line)! })),
      fillOrder: fills.order(s.fills),
      selection: editing.units(s.selection),
      axis: apply.axis(s.apply),
      mirrorPairs: apply.pairs(s.apply),
    })
  }

  geometry(): Geometry { const s = this.state(); return structuredClone(derived.derive(this.n, s.joins, s.fills)) }

  /**
   * Copy (graph "Cut, paste / copy"): the lines given, or the selected lines, as a clip
   * read in this view (with every layer's shapes). Reads only. Points or handles alone
   * are refused, as delete refuses them.
   */
  copy(lines?: readonly Id[]): clipboard.Clip {
    this.idle('copy')
    const s = this.state()
    const ids = lines ?? editing.units(s.selection).flatMap(u => (u.kind === 'line' ? [u.id] : []))
    return clipboard.extract({ ...s, network: this.n }, ids)
  }

  /** Everything within `radius` of `at`, nearest first (read-only; picking rules are the interaction's). */
  nearby(at: Vec, radius: number): derived.Nearby[] { return structuredClone(derived.nearby(this.n, this.state().joins, at, radius)) }
  /** Canvas fill pick: the smallest loop containing the point. */
  pickLoop(at: Vec): Id | undefined { return this.loopsAt(at)[0] }
  /** The lines a box from `a` to `b` takes: wholly inside it (`whole`), or touched by it (read-only). */
  linesInRect(a: Vec, b: Vec, whole: boolean): Id[] { return derived.linesInRect(this.n, this.state().joins, a, b, whole) }
  /** Every loop containing the point, smallest first (read-only; which one a tool takes is the interaction's, as with `nearby`). */
  loopsAt(at: Vec): Id[] { const s = this.state(); return derived.loopsAt(this.n, s.joins, s.fills, at) }
}

// ---- for the archive module only (not exported from the package root) -----------

const PARTS = ['network', 'groups', 'joins', 'links', 'fills', 'apply', 'names'] as const

/** The document as plain data, without the selection (docs/archive-plan.md). */
export function exportState(core: Core): Record<string, unknown> {
  const s = core['state']
  return structuredClone(Object.fromEntries(PARTS.map(k => [k, k === 'network' ? net.exportData(s.network) : s[k]])))
}

/**
 * A new document from plain data, after checking it: each module restores its own part
 * (types and internal consistency, e.g. ids marked as used, group counters); the reads the
 * editor relies on run; linked points coincide; and the commit pipeline run again changes
 * nothing (a saved document is always settled, so a difference means the data was edited
 * or damaged). Nothing is published anywhere: the result is a new Core.
 */
export function importState(data: unknown): Core {
  if (!data || typeof data !== 'object') throw new Error('open-failed: no document')
  const d = data as Record<string, unknown>
  for (const k of PARTS) if (!d[k] || typeof d[k] !== 'object') throw new Error(`open-failed: missing ${k}`)
  // each module checks and copies its own part, in dependency order (dot 1791512144)
  let state: State
  try {
    const network = net.restore(d.network, views.FRONT)
    const g = groups.restore(d.groups, network)
    state = {
      network, groups: g, joins: joins.restore(d.joins, network), links: links.restore(d.links, network),
      fills: fills.restore(d.fills, network), apply: apply.restore(d.apply, network), names: names.restore(d.names, network, g),
      selection: editing.create(),
    }
  } catch (err) {
    const m = (err as Error).message
    throw new Error(m.startsWith('open-failed') ? m : `open-failed: ${m}`)
  }
  try {
    const core = new Core()
    core['state'] = state
    const snap = core.snapshot(); core.geometry()
    // what every commit leaves exactly true, checked directly: linked points coincide. (A smooth
    // join is a spring: where several pull on one handle the result is a compromise, so it is not checked.)
    void snap
    // in every view: linked points coincide, and settling the positions again changes
    // nothing. No auto-bind anywhere: a chance coincidence in a view nobody edited is two
    // points and stays so (Q2, bowen 1791650323; dot 1791650402).
    for (const k of viewKeys(state)) {
      const at = core.in(k).snapshot(), pos = new Map(at.points.map(p => [p.id, p.position]))
      for (const l of at.links) {
        const a = pos.get(l.a), b = pos.get(l.b)
        if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) throw new Error(`linked points ${l.a} and ${l.b} are apart in ${k}`)
      }
    }
    const again = structuredClone(state)
    for (const k of viewKeys(again)) settleLayerPositions(again, net.emptyChanges(), k)
    settleShared(again)
    if (JSON.stringify(again) !== JSON.stringify(state)) throw new Error('the drawing is not in a settled state')
    return core
  } catch (err) {
    const m = (err as Error).message
    throw new Error(m.startsWith('open-failed') ? m : `open-failed: ${m}`)
  }
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
  names.follow(state.names, ch)
  // names keep up within the edit: what is gone frees its name at once, anything new is named at once (dot 1791479554)
  names.update(state.names, state.network, state.groups)
  net.followReplacements(changes, ch)
  for (const k of Object.keys(ch) as (keyof net.Changes)[]) (changes[k] as unknown[]).push(...(ch[k] as unknown[]))
}

const viewKeys = (s: State): string[] => net.shapeLayers(s.network).filter(l => l.kind === 'view').map(l => l.key)

/**
 * The fixed pipeline before publishing (docs/layer-batch-plan.md), per layer
 * (docs/architecture-multiview.md §1; step 3, dot 1791653374):
 * the edited view: isolated points → position loop (overlap bind, link alignment) →
 * aimed tips → mirrored handles (front only) → smooth springs;
 * every other view: positions only;
 * then fills → groups → names → selection; then the mirror check off the front, names,
 * locks (every view).
 */
function commit(s: State, ch: net.Changes, published: State, appliedFrom: ReadonlyMap<Id, locks.View>, layer: string) {
  settle(s, ch, layer)
  // mirror links are front-only: off the front, any change to a mirror pair's lines,
  // however it came (an explicit operation or an auto-bind), is not defined yet (dot 1791653374)
  if (layer !== views.FRONT && mirrorStructure(published) !== mirrorStructure(s)) {
    throw new net.Refusal('mirror-front-only', `mirror-front-only: this edit in ${layer} would change mirror-linked lines' structure`)
  }
  names.check(s.names, s.network)
  const changed = new Set<Id>()
  for (const k of viewKeys(s)) {
    const at = (x: State) => ({ network: net.of(x.network, k), joins: x.joins, links: x.links })
    // a lock that arrived with an apply or a paste is judged from that moment, in each view (dot 1791653958)
    const from = new Map([...appliedFrom].map(([id, v]) => [id, { ...v, network: net.of(v.network, k) }]))
    for (const id of locks.changed(at(published), at(s), ch, from)) changed.add(id)
  }
  if (changed.size) { const ids = [...changed].sort(); throw new net.Refusal('locked', `Locked lines would change (${ids.join(', ')}); nothing was published`, net.lineObjects(ids)) }
}

/**
 * The mirror pairs, their lines' end points and every line meeting there: what a
 * structural change to a pair alters, including a bind onto a paired point (dot 1791653374).
 */
function mirrorStructure(s: State): string {
  const n = s.network
  const ends = (id: Id) => {
    if (!net.hasLine(n, id)) return null
    const l = net.line(n, id)
    return [l.a, l.b].map(p => [p, net.linesAt(n, p).map(e => e.line.id).sort()])
  }
  return JSON.stringify(apply.pairs(s.apply).map(p => [p.a, p.b, ends(p.a), ends(p.b)]))
}

const mirrorOf = (s: State, n: net.NetworkState) => ({ axis: apply.axis(s.apply), pairs: apply.pointPairs(s.apply, n) })

/**
 * One layer, positions and handles only (no topology change): links (with mirror pairs
 * only at the front), aimed tips, mirrored handles (front only), springs. The trial view,
 * every other view at commit, and open all use it.
 */
function settleLayerPositions(s: State, ch: net.Changes, layer: string) {
  const n = net.of(s.network, layer), front = layer === views.FRONT
  net.setPositions(n, links.align(s.links, n, ch, front ? mirrorOf(s, n) : undefined))
  net.resolveHandleTips(n, ch)
  if (front) for (const h of apply.mirroredHandles(s.apply, n, ch)) net.moveHandle(n, ch, h.line, h.end, h.offset)
  net.setHandles(n, joins.solve(s.joins, n, ch, links.smoothPairs(s.links, n)))
}

/** What follows the structure, once for all layers. */
function settleShared(s: State) {
  fills.validate(s.fills, s.network)
  groups.reconcile(s.groups, s.network, net.emptyChanges())
  names.update(s.names, s.network, s.groups)
  editing.clean(s.selection, s.network, s.fills)
}

/** The fixed pipeline up to (not including) the checks: everything the edit's constraints settle. */
function settle(s: State, ch: net.Changes, layer: string) {
  const n = net.of(s.network, layer), front = layer === views.FRONT
  applyTopology(s, ch, c => net.removeIsolated(n, c))
  // Link alignment can make new coincidences, and binding can end links, so repeat
  // until no two endpoints in one layer coincide (dot, after f9c4109). Each pass
  // removes at least one point, so it ends. Auto-bind is judged in the edited view only (Q2).
  for (;;) {
    net.setPositions(n, links.align(s.links, n, ch, front ? mirrorOf(s, n) : undefined))
    const pairs = net.overlaps(n, ch)
    if (!pairs.length) break
    for (const p of pairs) applyTopology(s, ch, c => net.bind(n, c, p.keep, p.remove))
    applyTopology(s, ch, c => net.removeIsolated(n, c))
  }
  // aimed handles take their offsets from the final point positions
  net.resolveHandleTips(n, ch)
  // mirror-linked handles: a held handle gives its counterpart the reflected handle, held too (front only)
  if (front) for (const h of apply.mirroredHandles(s.apply, n, ch)) net.moveHandle(n, ch, h.line, h.end, h.offset)
  net.setHandles(n, joins.solve(s.joins, n, ch, links.smoothPairs(s.links, n)))
  for (const k of viewKeys(s)) if (k !== layer) settleLayerPositions(s, ch, k)
  settleShared(s)
}
