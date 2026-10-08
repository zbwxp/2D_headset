// document — the single authoritative state, one atomic transaction per edit,
// undo / redo, and the fixed pipeline (README). The Editor is thin: each method
// calls the owning module's operation; it holds no rules of its own.
import * as net from '../network'
import * as groups from '../groups'
import * as joins from '../joins'
import * as links from '../links'
import * as fills from '../fills'
import * as derived from '../derived'
import type { Vec } from '../geometry'

type Id = net.Id

interface State {
  network: net.NetworkState
  groups: groups.GroupsState
  joins: joins.JoinsState
  links: links.LinksState
  fills: fills.FillsState
}

const createState = (): State => ({ network: net.create(), groups: groups.create(), joins: joins.create(), links: links.create(), fills: fills.create() })

export interface Snapshot {
  layers: Id[]
  points: { id: Id; layer: Id; position: Vec; links: Id[]; endStroke?: joins.EndStroke }[]
  lines: { id: Id; a: Id; b: Id; ha: Vec; hb: Vec }[]
  groups: groups.Group[]
  joins: joins.JoinRow[]
  links: { a: Id; b: Id }[]
  linkJoins: links.LinkJoin[]
  /** Every closed curve, each tagged with the continuous curve (group) it belongs to. */
  loops: (fills.LoopView & { group: Id })[]
  fillOrder: Id[]
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
interface Transaction { open: boolean; cancelled: boolean; failed: boolean; readonly state: State; readonly changes: net.Changes }
const transactions = new WeakMap<Editor, Transaction>()

export class Editor {
  private constructor() {}
  /** @internal */ static open(state: State): Editor {
    const e = new Editor()
    transactions.set(e, { open: true, cancelled: false, failed: false, state, changes: net.emptyChanges() })
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

  // network: one-time edits
  layer(id: Id) { net.addLayer(this.s.network, id) }
  /** Pen: each end is an existing point id, or { id, layer, position } for a new point made with the line. */
  line(id: Id, a: net.EndSpec, b: net.EndSpec, handles?: { ha: Vec; hb: Vec }) { this.topology(ch => net.addLine(this.s.network, ch, id, a, b, handles)) }
  move(targets: { id: Id; target: Vec }[]) { net.move(this.s.network, this.tx.changes, targets) }
  /** One-time snap of `moving` onto `target`; no lasting relation (bowen 1791424844). */
  mergePosition(target: Id, moving: Id) { this.move([{ id: moving, target: net.point(this.s.network, target).position }]) }
  moveHandle(line: Id, end: net.End, offset: Vec) { net.moveHandle(this.s.network, this.tx.changes, line, end, offset) }
  split(line: Id, t: number, mid: Id, first: Id, second: Id) { this.topology(ch => net.splitLine(this.s.network, ch, line, t, mid, first, second)) }
  deleteLine(id: Id) { this.topology(ch => net.deleteLine(this.s.network, ch, id)) }
  bind(keep: Id, remove: Id) { this.topology(ch => net.bind(this.s.network, ch, keep, remove)) }
  unbind(point: Id, lines: Id[], newPoint: Id) { this.topology(ch => net.unbind(this.s.network, ch, point, lines, newPoint)) }

  // joins and end strokes (point attributes)
  /** Set a join between two lines at a point; l1 is clicked first. For smooth, l2 turns to l1 (bowen 1791428722). */
  join(point: Id, l1: Id, l2: Id, opts: { mode: joins.JoinMode; radius?: number }) {
    const { state, changes } = this.tx
    joins.setJoin(state.joins, state.network, point, l1, l2, opts)
    net.touch(changes, point)
    if (opts.mode === 'smooth') net.hold(state.network, changes, l1, net.line(state.network, l1).a === point ? 'a' : 'b')
  }
  removeJoin(point: Id, l1: Id, l2: Id) { joins.removeJoin(this.s.joins, point, l1, l2); net.touch(this.tx.changes, point) }
  endStroke(point: Id, stroke: joins.EndStroke) { joins.setEndStroke(this.s.joins, this.s.network, point, stroke) }

  // links (cross-layer relation)
  link(a: Id, b: Id) { this.move([links.link(this.s.links, this.s.network, a, b)]) }
  /** Removing a link is a constraint change at both points (dot 1791431139). */
  unlink(a: Id, b: Id) { links.unlink(this.s.links, a, b); net.touch(this.tx.changes, a); net.touch(this.tx.changes, b) }
  /** Join across a link: la ends at a (clicked first), lb at b. Smooth: lb turns to la. */
  linkJoin(a: Id, b: Id, la: Id, lb: Id, opts: { mode: 'smooth' }) {
    const { state, changes } = this.tx
    const held = links.setJoin(state.links, state.network, a, b, la, lb, opts)
    net.touch(changes, a); net.touch(changes, b)
    net.hold(state.network, changes, held.line, held.end)
  }
  removeLinkJoin(a: Id, b: Id, la: Id, lb: Id) { links.removeJoin(this.s.links, a, b, la, lb); net.touch(this.tx.changes, a); net.touch(this.tx.changes, b) }

  // groups (continuous curves)
  stroke(group: Id, stroke: groups.Stroke) { groups.setStroke(this.s.groups, group, stroke) }
  reorderGroup(group: Id, index: number) { groups.reorder(this.s.groups, group, index) }

  // fills (closed loops)
  fill(loop: Id, color: string) { fills.fill(this.s.fills, this.s.network, loop, color) }
  clearFill(loop: Id) { fills.clearFill(this.s.fills, loop) }
  fillVisible(loop: Id, visible: boolean) { fills.setVisible(this.s.fills, loop, visible) }
  /** Move a fill to `index` among the fills of its own group. */
  reorderFill(loop: Id, index: number) { fills.reorder(this.s.fills, this.s.network, loop, index) }

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
  if (!d || typeof d.value !== 'function' || ['constructor', 'topology', 'cancel'].includes(name)) continue
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
  private state: State = createState()
  private past: State[] = []
  private future: State[] = []
  private editing = false

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
      commit(draft, tx.changes)
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
      layers: [...net.layers(n)],
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
  net.followReplacements(changes, ch)
  for (const k of Object.keys(ch) as (keyof net.Changes)[]) (changes[k] as unknown[]).push(...(ch[k] as unknown[]))
}

/** The fixed pipeline before publishing: isolated points → links → smooth springs → fills → groups. */
function commit(s: State, ch: net.Changes) {
  applyTopology(s, ch, c => net.removeIsolated(s.network, c))
  net.setPositions(s.network, links.align(s.links, s.network, ch))
  net.setHandles(s.network, joins.solve(s.joins, s.network, ch, links.smoothPairs(s.links, s.network)))
  fills.validate(s.fills, s.network)
  groups.reconcile(s.groups, s.network, net.emptyChanges())
}
