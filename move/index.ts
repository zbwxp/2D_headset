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

/** Arrow keys: 1 unit; Shift ×10; Option (Alt) or Ctrl ×0.1 — the factors multiply (bowen 1791733125, 1791733775). */
export const STEP = 1
/** A step in tenths of a unit, a whole number, so a run that comes back to its start sums to exactly zero. */
const tenthsOf = (mods: { shift?: boolean; alt?: boolean; ctrl?: boolean }) => STEP * 10 * (mods.shift ? 10 : 1) / (mods.alt || mods.ctrl ? 10 : 1)
export const stepOf = (mods: { shift?: boolean; alt?: boolean; ctrl?: boolean }): number => tenthsOf(mods) / 10
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
   * `target()`; a press or a repeat adds a step to a running key run. True if the key was taken.
   */
  keyDown(target: () => Target | undefined, k: KeyInput): boolean
  /** An arrow key came up: when no arrow is held any more, the key run commits (nothing for a net zero). */
  keyUp(key: string): void
  /** Ends the running session without writing (Esc, blur, a tool or view change, …). */
  cancel(): void
  /** What runs: nothing, a drag or a key run. */
  readonly running: 'drag' | 'keys' | null
}

export function createMover(): Mover {
  /** A key run counts in whole tenths (`tenths`); a drag's offset is the pointer's displacement. */
  let session: null | { kind: 'drag' | 'keys'; target: Target; start: Vec; offset: Vec; tenths: { x: number; y: number }; held: Set<string> } = null
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
      session = { kind: 'drag', target, start: { x: at.x, y: at.y }, offset: { x: 0, y: 0 }, tenths: { x: 0, y: 0 }, held: new Set() }
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
    keyDown(target, k) {
      if (!isArrow(k.key)) return false
      if (session?.kind === 'drag') return true // one session at a time: keys during a drag are taken and ignored
      if (!session) {
        if (k.repeat) return true // a repeat never starts a session: after a cancel a real press is needed (dot 1791733489)
        const t = target()
        if (!t || !t.begin()) return false
        session = { kind: 'keys', target: t, start: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, tenths: { x: 0, y: 0 }, held: new Set() }
      }
      const d = DIRECTION[k.key]!, step = tenthsOf(k)
      session.held.add(k.key)
      session.tenths = { x: session.tenths.x + d.x * step, y: session.tenths.y + d.y * step }
      session.offset = { x: session.tenths.x / 10 || 0, y: session.tenths.y / 10 || 0 }
      session.target.preview(session.offset)
      return true
    },
    keyUp(key) {
      if (session?.kind !== 'keys' || !isArrow(key)) return
      session.held.delete(key)
      if (session.held.size === 0) finish(true)
    },
    cancel() { finish(false) },
  }
}
