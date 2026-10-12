// move — one input for moving things (bowen 1791733125; docs/move-plan.md; dot 1791733234, 1791733296,
// 1791733489): a mouse drag or a run of arrow keys becomes one *session* with a start, a preview, one
// commit and a cancel. It knows nothing of what moves: a caller hands it a target, which decides what
// moves, whether it may, and how it is undone. No imports.

export interface Vec { readonly x: number; readonly y: number }

/** What a session moves. `begin` captures what it needs (drawing, view, units, start) and may refuse. */
export interface Target {
  begin(): boolean
  /** The accumulated offset since the start; shown, never written. */
  preview(offset: Vec): void
  /** The one write, one undo step; called after the session has ended. */
  commit(offset: Vec): void
  /** Nothing written. */
  cancel(): void
}

/**
 * A key run's sizes, passed in by its caller (bowen 1791769146): the single step, the long one (Shift) and the
 * short one (Option / Ctrl). `move/` knows the three kinds, never what they measure; Shift with Option / Ctrl
 * together is the single step.
 */
export interface Steps { readonly step: number; readonly long: number; readonly short: number }
const kindOf = (mods: { shift?: boolean; alt?: boolean; ctrl?: boolean }): keyof Steps =>
  mods.shift && (mods.alt || mods.ctrl) ? 'step' : mods.shift ? 'long' : mods.alt || mods.ctrl ? 'short' : 'step'
/** The decimal places of a size (at most 10), or a refusal: sizes are finite, > 0, and decimal (dot 1791769354). */
function decimalsOf(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error(`A move step must be a finite number above 0, not ${String(n)}`)
  for (let d = 0; d <= 10; d++) if (Number(n.toFixed(d)) === n) return d
  throw new Error(`A move step has at most 10 decimal places, not ${n}`)
}
const DIRECTION: Record<string, Vec> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
export const isArrow = (key: string) => Object.hasOwn(DIRECTION, key)

export interface KeyInput { readonly key: string; readonly repeat?: boolean; readonly shift?: boolean; readonly alt?: boolean; readonly ctrl?: boolean }

/** A mover runs at most one session at a time, a drag or a key run. */
export interface Mover {
  /** A press starts a drag session; false if a session runs already or the target refuses. */
  press(target: Target, at: Vec): boolean
  /** The pointer moved (a drag session only). */
  drag(at: Vec): void
  /** The pointer was released: the drag commits (nothing if it never moved away). */
  release(at: Vec): void
  /**
   * An arrow key went down. A first, real press (not a repeat) with no session running starts a key run on
   * `target()` with the sizes `steps` (fixed for the run, checked here: a bad size throws); a real press, or a
   * repeat of a key whose real press this run took, adds a step. True if the key was taken.
   */
  keyDown(target: () => Target | undefined, k: KeyInput, steps: Steps): boolean
  /** An arrow key came up: when no arrow is held any more, the key run commits (nothing for a net zero). */
  keyUp(key: string): void
  /** Ends the running session without writing (Esc, blur, a tool or view change, …). */
  cancel(): void
  /** What runs: nothing, a drag or a key run. */
  readonly running: 'drag' | 'keys' | null
}

export function createMover(): Mover {
  /**
   * A key run counts in whole units of 10^-d (`count`), d the most decimal places of its sizes, so mixed sizes
   * that come back to the start sum to exactly zero (dot 1791769354); a drag's offset is the pointer's displacement.
   */
  type Run = { per: number; units: Record<keyof Steps, number>; count: { x: number; y: number }; held: Set<string> }
  let session: null | { kind: 'drag' | 'keys'; target: Target; start: Vec; offset: Vec; run: Run | null } = null
  /** Ends the session first, then commits: a commit that re-enters or throws finds it ended (dot 1791733489). */
  const finish = (write: boolean) => {
    const s = session
    if (!s) return
    session = null
    if (write && (s.offset.x !== 0 || s.offset.y !== 0)) s.target.commit(s.offset)
    else s.target.cancel()
  }
  return {
    get running() { return session?.kind ?? null },
    press(target, at) {
      if (session || !target.begin()) return false
      session = { kind: 'drag', target, start: { x: at.x, y: at.y }, offset: { x: 0, y: 0 }, run: null }
      return true
    },
    drag(at) {
      if (session?.kind !== 'drag') return
      session.offset = { x: at.x - session.start.x, y: at.y - session.start.y }
      session.target.preview(session.offset)
    },
    release(at) {
      if (session?.kind !== 'drag') return
      session.offset = { x: at.x - session.start.x, y: at.y - session.start.y }
      finish(true)
    },
    keyDown(target, k, steps) {
      if (!isArrow(k.key)) return false
      if (session?.kind === 'drag') return true // one session at a time: keys during a drag are taken and ignored
      if (!session) {
        if (k.repeat) return true // a repeat never starts a session: after a cancel a real press is needed (dot 1791733489)
        // the sizes are fixed and checked as the run begins (dot 1791769354)
        const d = Math.max(decimalsOf(steps.step), decimalsOf(steps.long), decimalsOf(steps.short)), per = 10 ** d
        const units = { step: Math.round(steps.step * per), long: Math.round(steps.long * per), short: Math.round(steps.short * per) }
        // whole units must stay exact: a size whose count is beyond the safe integers is refused (dot 1791769551)
        for (const u of Object.values(units)) if (!Number.isSafeInteger(u)) throw new Error(`A move step is too large to count exactly: ${steps.step} / ${steps.long} / ${steps.short}`)
        const t = target()
        if (!t || !t.begin()) return false
        session = { kind: 'keys', target: t, start: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, run: { per, units, count: { x: 0, y: 0 }, held: new Set() } }
      }
      const run = session.run!
      // a repeat moves only for a key whose real press this run took: an old key's repeats are not this run's (dot 1791769354)
      if (k.repeat && !run.held.has(k.key)) return true
      const d = DIRECTION[k.key]!, n = run.units[kindOf(k)]
      run.held.add(k.key)
      const count = { x: run.count.x + d.x * n, y: run.count.y + d.y * n }
      if (!Number.isSafeInteger(count.x) || !Number.isSafeInteger(count.y)) return true // past exact counting: the step is not taken
      run.count = count
      session.offset = { x: run.count.x / run.per || 0, y: run.count.y / run.per || 0 }
      session.target.preview(session.offset)
      return true
    },
    keyUp(key) {
      if (session?.kind !== 'keys' || !isArrow(key)) return
      session.run!.held.delete(key)
      if (session.run!.held.size === 0) finish(true)
    },
    cancel() { finish(false) },
  }
}
