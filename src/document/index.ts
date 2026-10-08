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
  loops: fills.LoopView[]
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
interface Transaction { open: boolean; readonly state: State; readonly changes: net.Changes }
const transactions = new WeakMap<Editor, Transaction>()

export class Editor {
  private constructor() {}
  /** @internal */ static open(state: State): Editor {
    const e = new Editor()
    transactions.set(e, { open: true, state, changes: net.emptyChanges() })
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
    const ch = net.emptyChanges()
    op(ch)
    joins.update(state.joins, state.network, ch)
    links.update(state.links, ch)
    fills.update(state.fills, ch)
    groups.reconcile(state.groups, state.network, ch)
    net.followReplacements(changes, ch)
    for (const k of Object.keys(ch) as (keyof net.Changes)[]) (changes[k] as unknown[]).push(...(ch[k] as unknown[]))
  }

  // network: one-time edits
  layer(id: Id) { net.addLayer(this.s.network, id) }
  point(id: Id, layer: Id, position: Vec) { net.addPoint(this.s.network, id, layer, position) }
  line(id: Id, a: Id, b: Id, handles?: { ha: Vec; hb: Vec }) { this.topology(ch => net.addLine(this.s.network, ch, id, a, b, handles)) }
  move(targets: { id: Id; target: Vec }[]) { net.move(this.s.network, this.tx.changes, targets) }
  /** One-time snap of `moving` onto `target`; no lasting relation (bowen 1791424844). */
  mergePosition(target: Id, moving: Id) { this.move([{ id: moving, target: net.point(this.s.network, target).position }]) }
  moveHandle(line: Id, end: net.End, offset: Vec) { net.moveHandle(this.s.network, this.tx.changes, line, end, offset) }
  split(line: Id, t: number, mid: Id, first: Id, second: Id) { this.topology(ch => net.splitLine(this.s.network, ch, line, t, mid, first, second)) }
  deleteLine(id: Id) { this.topology(ch => net.deleteLine(this.s.network, ch, id)) }
  bind(keep: Id, remove: Id) { this.topology(ch => net.bind(this.s.network, ch, keep, remove)) }
  unbind(point: Id, lines: Id[], newPoint: Id) { this.topology(ch => net.unbind(this.s.network, ch, point, lines, newPoint)) }

  // joins and end strokes (point attributes)
  join(point: Id, l1: Id, l2: Id, opts: { mode: joins.JoinMode; radius?: number }) { joins.setJoin(this.s.joins, this.s.network, point, l1, l2, opts) }
  removeJoin(point: Id, l1: Id, l2: Id) { joins.removeJoin(this.s.joins, point, l1, l2) }
  endStroke(point: Id, stroke: joins.EndStroke) { joins.setEndStroke(this.s.joins, this.s.network, point, stroke) }

  // links (cross-layer relation)
  link(a: Id, b: Id) { this.move([links.link(this.s.links, this.s.network, a, b)]) }
  unlink(a: Id, b: Id) { links.unlink(this.s.links, a, b) }

  // groups (continuous curves)
  stroke(group: Id, stroke: groups.Stroke) { groups.setStroke(this.s.groups, group, stroke) }
  reorderGroup(group: Id, index: number) { groups.reorder(this.s.groups, group, index) }

  // fills (closed loops)
  fill(loop: Id, color: string) { fills.fill(this.s.fills, this.s.network, loop, color) }
  clearFill(loop: Id) { fills.clearFill(this.s.fills, loop) }
  fillVisible(loop: Id, visible: boolean) { fills.setVisible(this.s.fills, loop, visible) }
  /** Move a fill to `index` among the fills of its own group. */
  reorderFill(loop: Id, index: number) { fills.reorder(this.s.fills, this.s.network, loop, index) }

  cancel(): never { this.tx; throw new Cancelled('cancelled') }
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
      fn(e)
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
    return structuredClone({
      layers: [...net.layers(n)],
      points: net.points(n).map(p => {
        const end = joins.endStroke(s.joins, p.id)
        return { id: p.id, layer: p.layer, position: p.position, links: links.partners(s.links, p.id), ...(end ? { endStroke: end } : {}) }
      }),
      lines: net.lines(n).map(l => ({ ...l })),
      groups: groups.list(s.groups, n),
      joins: joins.rows(s.joins),
      links: links.pairs(s.links),
      loops: fills.discover(s.fills, n),
      fillOrder: fills.order(s.fills),
    })
  }

  geometry(): Geometry { return structuredClone(derived.derive(this.state.network, this.state.joins, this.state.fills)) }

  /** Canvas fill pick: the smallest loop containing the point. */
  pickLoop(at: Vec): Id | undefined { return derived.pickLoop(this.state.network, this.state.joins, this.state.fills, at) }
}

/** The fixed pipeline before publishing: links → smooth springs → fills → groups. */
function commit(s: State, ch: net.Changes) {
  net.setPositions(s.network, links.align(s.links, s.network, ch))
  net.setHandles(s.network, joins.solve(s.joins, s.network, ch))
  fills.validate(s.fills, s.network)
  groups.reconcile(s.groups, s.network, net.emptyChanges())
}
