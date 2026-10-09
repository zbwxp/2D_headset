// base — the shared mechanism every flow uses (graph "Interaction", written once here):
// which Core an unfinished operation belongs to, commits through core (core keeps them
// atomic), the feedback of the last refusal, and picking from core's read-only distance
// query with interaction's own rules (tolerance, shown only, order).
import type { Core, Snapshot, Vec, Editor } from '../src'
import { fromError, type Feedback } from './feedback'

export type Id = string
export type Unit = Snapshot['selection'][number]
export type Tool = 'pen' | 'V' | 'A' | 'split' | 'bind' | 'merge' | 'link' | 'unbind' | 'join' | 'fill'
export interface Options { joinMode: 'smooth' | 'cusp' | 'arc'; radius: number; color: string }
export interface Mods { shift?: boolean; alt?: boolean; meta?: boolean }

/** What the app gives: the open drawing, a source of new ids, the layer to draw into, and the size of one screen pixel in document units (from the camera). */
export interface Env {
  core: () => Core
  newId: (prefix: string) => Id
  layer: () => Id | undefined
  pixel: () => number
}

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
  /** Groups of a pending cut, shown grey. */
  cut: Id[]
  /** A step-by-step tool's first pick. */
  pick?: { kind: 'point' | 'line'; id: Id }
  /** The pen's last point, or the position of its first click before any line exists. */
  pen?: { point: Id } | { at: Vec }
  /** Lines picked as the mirror source. */
  mirrorSource: Id[]
  /** The last refusal: its code, message and objects (kind + id). */
  refusal?: Feedback
}

/** Every unfinished operation records the Core it started on (explicit targets; dot 1791543494). */
export interface Owned { core: Core }

/** The shared context a flow works with. */
export interface Ctx {
  readonly env: Env
  core(): Core
  snap(): Snapshot
  /** True when the operation still belongs to the open drawing. */
  mine(op: Owned | null): boolean
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
  /** What is shown and within reach, points first, then handles, then lines (nearest first within each). */
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
    snap: () => env.core().snapshot(),
    mine: op => !!op && op.core === env.core(),
    commit(fn) {
      try { env.core().edit(fn); ctx.feedback = undefined }
      catch (err) { ctx.feedback = fromError(err); return false }
      ctx.afterCommit()
      return true
    },
    afterCommit: () => {},
    feedback: undefined,
    options: state.options,
    tool: state.tool,
    shown: at => {
      const px = env.pixel()
      return env.core().nearby(at, Math.max(REACH.point, REACH.handle, REACH.line) * px)
        .filter(x => x.visible && x.distance <= REACH[x.kind] * px)
        .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.distance - b.distance)
    },
    hitPoint: at => { const h = ctx.shown(at).find(x => x.kind === 'point'); return h && h.kind === 'point' ? h.id : undefined },
    hitLine: at => { const h = ctx.shown(at).find(x => x.kind === 'line'); return h && h.kind === 'line' ? h.id : undefined },
  }
  return ctx
}
