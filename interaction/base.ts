// base — the shared mechanism every flow uses (graph "Interaction", written once here):
// which Core an unfinished operation belongs to, commits through core (core keeps them
// atomic), the feedback of the last refusal, and picking from core's read-only distance
// query with interaction's own rules (tolerance, shown only, order).
import type { Core, Snapshot, Vec, Editor } from '../src'
import { fromError, type Feedback } from './feedback'

export type Id = string
export type Unit = Snapshot['selection'][number]
export type Tool = 'pen' | 'V' | 'A' | 'split' | 'bind' | 'merge' | 'link' | 'unbind' | 'join' | 'fill' | 'deform'
export interface Options { joinMode: 'bound' | 'smooth' | 'cusp' | 'arc'; radius: number; color: string }
/** `meta`: ⌘ or Ctrl, for the shortcuts; `ctrl` alone and `repeat` (a held key) are read by moving with arrow keys only. */
export interface Mods { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean; repeat?: boolean }

/**
 * What the app gives: the open drawing, a source of new ids, the current layer (new lines go
 * there), the selected layers (at least the current one; omitted = only the current one), and
 * the size of one screen pixel in document units (from the camera).
 */
export interface Env {
  core: () => Core
  /** The current view (multi-view step 7): every read and every commit is in it. Required, no default. */
  view: () => string
  newId: (prefix: string) => Id
  layer: () => Id | undefined
  layers?: () => Id[]
  pixel: () => number
}

/**
 * Which layers each tool reaches: what it shows as operable and what it can hit, one set
 * (bowen 1791555800, 1791553331; docs/layer-scope-plan.md §2). Other layers stay drawn, as
 * reference only. 'selected' = the selected layers, 'current' = the current layer, 'all' =
 * every layer.
 */
export const SCOPE: Record<Tool, 'selected' | 'current' | 'all'> = {
  V: 'selected', A: 'selected', bind: 'selected', split: 'selected', unbind: 'selected', join: 'selected', fill: 'selected', deform: 'selected',
  merge: 'all', link: 'all',
  pen: 'current', // a new line goes into the current layer, and both ends of a line are in one layer
}
/** The tools that pick points, and so show them (bowen 1791555800: bind shows its points). */
export const POINT_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['A', 'pen', 'bind', 'merge', 'link', 'unbind'])

/**
 * How near the pointer must be, in screen pixels (interaction defaults, common sense; not
 * rules: bowen 1791551877, dot 1791551915). Points and handles get a wider reach than lines,
 * and the reach does not change with zoom or window size.
 */
export const REACH = { point: 10, handle: 10, line: 8 } as const
/** Among what is within reach: points first, then handles, then lines; nearest first within a kind. */
const ORDER = { point: 0, handle: 1, line: 2 } as const

/** What to show, as plain data (the view draws it). */
export interface Preview {
  /** A drag in progress: the units it moves and the offset so far. */
  drag?: { units: Unit[]; offset: Vec }
  /** A selection box being dragged: right = lines wholly inside (`whole`), left = lines it touches. */
  box?: { from: Vec; to: Vec; whole: boolean }
  /** Groups of a pending cut, shown grey. */
  cut: Id[]
  /** A step-by-step tool's first pick. */
  pick?: { kind: 'point' | 'line'; id: Id }
  /** The pen's last point, or the position of its first click before any line exists. */
  pen?: { point: Id } | { at: Vec }
  /** The handles shown, and so pickable (A: every visible line of the current layer). */
  handles: { line: Id; end: 'a' | 'b' }[]
  /** The points shown, and so pickable: those of the current tool's scope, for the tools that pick points. */
  points: Id[]
  /** Lines picked as the mirror source. */
  mirrorSource: Id[]
  /** The last refusal: its code, message and objects (kind + id). */
  refusal?: Feedback
  /**
   * The selection box (docs/selection-box-plan.md), with V / A and a selection that transforms: its bounds, the
   * handles it has, and what the pointer is over (`hot`). Drawn and hit by the same rule.
   */
  selectionBox?: { min: Vec; max: Vec; handles: { id: string; at: Vec }[]; hot: string | null }
  /** A handle drag in progress: the lines as they will be (core's preview of the same operation), the box around them, or why core refuses it. */
  transform?: { lines: { id: Id; curve: Vec[] }[]; arcs: { key: string; curve: Vec[] }[]; box: { min: Vec; max: Vec } | null; refused?: string }
  /**
   * The 四角 / 曲边 frame (docs/deform-p3-checklist.md): its corners, edge handles, midpoints, bent edges and grid (drawn and hit
   * by the same data); while dragging, the lines as core's preview of the release shows them, or why core refuses; the fit
   * error before constraints.
   */
  deform?: {
    frame: { corners: Vec[]; handles: { edge: number; handle: 0 | 1; at: Vec; anchor: Vec }[]; midpoints: { edge: number; at: Vec }[]; edges: Vec[][]; grid: Vec[][] }
    /** While dragging: every line and every join's arc the release changes (core's preview against the drawing now). */
    lines: { id: Id; curve: Vec[] }[] | null
    arcs: { key: string; curve: Vec[] }[] | null
    maxError: number
    dragging: boolean
    refused?: string
  }
}

/**
 * Every unfinished operation records the Core it started on (explicit targets; dot 1791543494)
 * and, when it belongs to one view (a drag, picks, the pen chain, the mirror source), that view
 * too (step 7; dot 1791656400). A pending cut belongs to its Core only.
 */
export interface Owned { core: Core; view: string }
export interface CoreOwned { core: Core }
type Reader = ReturnType<Core['in']>

/** The shared context a flow works with. */
export interface Ctx {
  readonly env: Env
  core(): Core
  /** Reads in the current view. */
  reader(): Reader
  snap(): Snapshot
  /** The owner of an operation that starts now: this Core and the current view. */
  owned(): Owned
  /** True when the operation still belongs to the open drawing and the current view. */
  mine(op: Owned | null): boolean
  /** True when the operation still belongs to the open drawing (a pending cut: any view). */
  mineCore(op: CoreOwned | null): boolean
  /**
   * One edit through core; a refusal becomes feedback, and nothing is left half done (core is
   * atomic). After a successful edit every flow checks its unfinished operation again, as after
   * an undo: an edit made here (a Delete during a drag) ends whatever it made invalid (dot 1791544530).
   */
  commit(fn: (e: Editor) => void): boolean
  /** Set by the assembly: what runs after each successful commit. */
  afterCommit: () => void
  feedback: Feedback | undefined
  options(): Options
  tool(): Tool
  /** Whether a layer is in the current tool's scope. */
  inScope(layer: Id | undefined): boolean
  /**
   * The selection units on the selected layers, the only ones anything acts on (docs/layer-scope-plan.md §3).
   * Units on other layers stay in core's selection (an undo may bring them back) but are inert.
   */
  selection(): Unit[]
  /** The layer of each point and line. */
  layerOf(s: Snapshot): { point: (id: Id) => Id | undefined; line: (id: Id) => Id | undefined }
  /** What is shown and within reach, in the current tool's scope: points first, then handles, then lines (nearest first within each). */
  shown(at: Vec): ReturnType<Core['nearby']>
  hitPoint(at: Vec): Id | undefined
  hitLine(at: Vec): Id | undefined
}

/** A user flow: its own temporary state, its preview data, and how each lifecycle moment ends it. */
export interface Flow {
  /** Esc cancels the innermost level first: 1 drag, 2 picks / pen chain / mirror source, 3 pending cut. */
  readonly cancelLevel: 1 | 2 | 3
  cancel(): boolean
  toolChanged(): void
  drawingChanged(): void
  historyChanged(): void
  preview(p: Preview): void
}

export function createCtx(env: Env, state: { tool(): Tool; options(): Options }): Ctx {
  const ctx: Ctx = {
    env,
    core: () => env.core(),
    reader: () => env.core().in(env.view()),
    snap: () => env.core().in(env.view()).snapshot(),
    owned: () => ({ core: env.core(), view: env.view() }),
    mine: op => !!op && op.core === env.core() && op.view === env.view(),
    mineCore: op => !!op && op.core === env.core(),
    commit(fn) {
      try { env.core().editIn(env.view(), fn); ctx.feedback = undefined }
      catch (err) { ctx.feedback = fromError(err); return false }
      ctx.afterCommit()
      return true
    },
    afterCommit: () => {},
    feedback: undefined,
    options: state.options,
    tool: state.tool,
    inScope: layer => {
      const scope = SCOPE[state.tool()]
      if (layer === undefined) return false
      if (scope === 'all') return true
      if (scope === 'current') return layer === env.layer()
      return (env.layers?.() ?? [env.layer()]).includes(layer)
    },
    selection: () => {
      const s = ctx.snap(), of = ctx.layerOf(s), focus = env.layers?.() ?? [env.layer()]
      const layer = (u: Unit) => u.kind === 'point' ? of.point(u.id) : u.kind === 'line' ? of.line(u.id)
        : u.kind === 'handle' ? of.line(u.line) : of.line(s.loops.find(l => l.id === u.id)?.route[0]?.line ?? '')
      return s.selection.filter(u => focus.includes(layer(u)))
    },
    layerOf: s => {
      const points = new Map(s.points.map(p => [p.id, p.layer])), lines = new Map(s.lines.map(l => [l.id, points.get(l.a)]))
      return { point: id => points.get(id), line: id => lines.get(id) }
    },
    shown: at => {
      const px = env.pixel(), of = ctx.layerOf(ctx.snap())
      const layer = (x: ReturnType<Core['nearby']>[number]) => (x.kind === 'point' ? of.point(x.id) : of.line(x.kind === 'line' ? x.id : x.line))
      return ctx.reader().nearby(at, Math.max(REACH.point, REACH.handle, REACH.line) * px)
        .filter(x => x.visible && x.distance <= REACH[x.kind] * px && ctx.inScope(layer(x)))
        .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.distance - b.distance)
    },
    hitPoint: at => { const h = ctx.shown(at).find(x => x.kind === 'point'); return h && h.kind === 'point' ? h.id : undefined },
    hitLine: at => { const h = ctx.shown(at).find(x => x.kind === 'line'); return h && h.kind === 'line' ? h.id : undefined },
  }
  return ctx
}
