// interaction — the tools and every unfinished operation (graph "Interaction": one owner
// per state; cancellable, atomic commit; explicit targets. doc 22; docs/interaction-plan.md).
//
// Inside (bowen 1791543548; dot 1791543638): one shared base and one shared feedback,
// written once, and one flow per user task — select-transform, pen, steps, mirror,
// clipboard. Each flow holds only its own temporary state; the drawing, the selection and
// the history are core's, and every change goes through core's public operations as one
// edit. Nothing here draws: `preview()` describes what to show, as plain data.
import type { Snapshot, Vec } from '../src'
import { createCtx, POINT_TOOLS, type Env, type Flow, type Mods, type Options, type Preview, type Tool } from './base'
import { fromError } from './feedback'
import { isArrow } from '../move'
import { selectTransform } from './flows/select-transform'
import { pen } from './flows/pen'
import { steps } from './flows/steps'
import { mirror } from './flows/mirror'
import { clipboard } from './flows/clipboard'
import { deformFlow } from './flows/deform'

export type { Env, Mods, Options, Preview, Tool } from './base'
export { REACH, SCOPE, POINT_TOOLS } from './base'
export type { Feedback } from './feedback'

export interface Interaction {
  readonly tool: Tool
  setTool(tool: Tool): void
  setOptions(o: Partial<Options>): void
  options(): Options
  /** Returns false when nothing was hit and the tool did nothing, so the app may pan. */
  pointerDown(at: Vec, mods?: Mods): boolean
  /** `mods` during a press are read live by a box handle's drag (Option, Shift; docs/selection-box-plan.md §5). */
  pointerMove(at: Vec, mods?: Mods): void
  pointerUp(at: Vec, mods?: Mods): void
  /** The pointer moved with no button held: updates what it is over on the selection box (the hover cursor). */
  /** The pointer resting over the canvas (no button), or `null` when it leaves; the box's hot handle follows. */
  pointerHover(at: Vec | null, mods?: Mods): void
  pointerCancel(): void
  key(name: string, mods?: Mods): boolean
  cancel(): void
  deleteSelection(): void
  /** The selection units on the selected layers: what is shown selected, and what anything acts on. */
  selection(): Snapshot['selection']
  copy(): void
  cut(): void
  paste(): void
  setMirrorSource(): void
  mirrorApply(): void
  mirrorLink(): void
  undo(): void
  redo(): void
  /** Stroke broadcast (step 6): the selected lines' strokes, as in the current view, to every other view. */
  broadcastStroke(): void
  /** Shape broadcast (stage 2): the selected lines' pending change from the front to every other view (front view only). */
  broadcastShape(): void
  /** Fit (stage 2): the selected lines' baseline takes the front; no view changes. */
  fit(): void
  /** Diagonal draft (stage 2): the selected lines' four corner views from the front, yaw and pitch views. */
  draftCorners(): void
  /**
   * The app switched the current view (step 7): what belongs to one view ends (a drag, picks,
   * the pen chain, the mirror source); the selection, the clipboard and a pending cut stay.
   * Not an edit.
   */
  viewChanged(): void
  /** Ends every unfinished operation at every level, the pending cut included (bench playback, stage 3a). Not an edit. */
  cancelAll(): void
  /** The app tells interaction about changes it made elsewhere (doc 22 §3.5). */
  drawingChanged(): void
  historyChanged(): void
  /**
   * The outcome of a one-shot command the app ran on core (a panel button): a refusal to show,
   * or nothing on success. Feedback has one owner, here, whichever path the last action took
   * (dot 1791551067).
   */
  outcome(err?: unknown): void
  /** The 四角 / 曲边 session: the frame back to the rest rect (restoring the original curves), or 完成 (ends it). */
  deformReset(): void
  deformDone(): void
  preview(): Preview
  /**
   * What the last press with V or A picked: 'line', 'point', 'handle', or null when it picked nothing
   * (it started a box). Read only; the app's name labels switch on a line only (dot 1791732824).
   */
  lastPress(): 'line' | 'point' | 'handle' | 'fill' | null
  /** An arrow key released (always given, even from a field): a key run of the selection commits when no arrow is held. */
  keyUp(name: string): void
  /** What move session runs: a drag of the selection, a key run, or nothing (docs/move-plan.md). */
  moving(): 'drag' | 'keys' | null
  subscribe(listener: () => void): () => void
}

const KEY_TOOLS: Record<string, Tool> = { v: 'V', a: 'A', p: 'pen', s: 'split', b: 'bind', m: 'merge', l: 'link', u: 'unbind', j: 'join', f: 'fill' }

export function createInteraction(env: Env): Interaction {
  let tool: Tool = 'pen'
  let opts: Options = { joinMode: 'smooth', radius: 10, color: '#f2c94c' }
  const ctx = createCtx(env, { tool: () => tool, options: () => ({ ...opts }) })
  const st = selectTransform(ctx), pn = pen(ctx), sp = steps(ctx), mr = mirror(ctx), cb = clipboard(ctx), df = deformFlow(ctx)
  const flows: Flow[] = [st, pn, sp, mr, cb, df]
  ctx.afterCommit = () => { for (const f of flows) f.historyChanged() }
  const listeners = new Set<() => void>()
  const changed = () => { for (const f of listeners) f() }
  /** Run one user action, then tell the listeners once. */
  const act = <T>(f: () => T): T => { try { return f() } finally { changed() } }

  /** Innermost first (an interaction default): drag, then picks / pen chain / mirror source, then the pending cut. */
  function cancel() {
    for (const level of [1, 2, 3] as const) {
      const hit = flows.filter(f => f.cancelLevel === level).map(f => f.cancel()).some(Boolean)
      if (hit) break
    }
    ctx.feedback = undefined
  }
  // feedback cleared first, so a note a flow gives on starting (deform: nothing selected) is shown
  function setTool(t: Tool) { tool = t; ctx.feedback = undefined; for (const f of flows) f.toolChanged() }
  function historyChanged() { for (const f of flows) f.historyChanged() }
  // during a key run, undo / redo end the run and write nothing — it was never committed, so nothing earlier is
  // undone with it (docs/move-plan.md; dot 1791733489); during a mouse drag they wait, as before
  function undo() { if (st.moving === 'keys') { st.cancel(); return } if (!st.dragging && !df.dragging) { env.core().undo(); historyChanged() } }
  function redo() { if (st.moving === 'keys') { st.cancel(); return } if (!st.dragging && !df.dragging) { env.core().redo(); historyChanged() } }

  function pointerDown(at: Vec, mods: Mods = {}): boolean {
    ctx.feedback = undefined
    if (tool === 'V' || tool === 'A') return st.pointerDown(at, mods)
    // the 四角 / 曲边 frame takes a press on its controls only; anything else is the app's (a pan)
    if (tool === 'deform') return df.pointerDown(at)
    if (tool === 'pen') pn.click(at) // the pen uses every press, blank ones too: no selection box
    // a step tool's press on nothing it takes starts a selection box (bowen 1791559014)
    else if (!sp.click(at, mods)) st.startBox(at, mods, false)
    return true
  }

  function key(name: string, mods: Mods = {}): boolean {
    const k = name.toLowerCase()
    if (k === 'escape') { cancel(); return true }
    // arrows move the selection with V / A (docs/move-plan.md): Ctrl + arrow is the slow move, ⌘ + arrow is not a move
    if (isArrow(name)) return mods.meta && !mods.ctrl ? false : st.keyDown(name, mods)
    if (mods.meta) {
      if (k === 'z') { mods.shift ? redo() : undo(); return true }
      if (k === 'c') { cb.copy(); return true }
      if (k === 'x') { cb.cut(); return true }
      if (k === 'v') { cb.paste(); return true }
      return false
    }
    if (k === 'delete' || k === 'backspace') { ctx.commit(e => e.deleteSelection(ctx.selection())); return true }
    if (KEY_TOOLS[k]) { setTool(KEY_TOOLS[k]!); return true }
    return false
  }

  return {
    get tool() { return tool },
    setTool: t => act(() => setTool(t)),
    setOptions: o => act(() => { opts = { ...opts, ...o } }),
    options: () => ({ ...opts }),
    pointerDown: (at, mods) => act(() => pointerDown(at, mods)),
    pointerMove: (at, mods) => { if (df.dragging) act(() => df.pointerMove(at)); else if (st.dragging) act(() => st.pointerMove(at, mods)) },
    pointerUp: (at, mods) => act(() => { if (df.dragging) df.pointerUp(at); else st.pointerUp(at, mods) }),
    pointerHover: (at, mods) => { if (st.hover(at, mods)) act(() => {}) },
    pointerCancel: () => act(() => { df.pointerCancel(); st.pointerCancel() }),
    key: (name, mods) => act(() => key(name, mods)),
    cancel: () => act(cancel),
    deleteSelection: () => act(() => { ctx.commit(e => e.deleteSelection(ctx.selection())) }),
    selection: () => structuredClone(ctx.selection()),
    copy: () => act(() => cb.copy()),
    cut: () => act(() => cb.cut()),
    paste: () => act(() => cb.paste()),
    setMirrorSource: () => act(() => mr.setSource()),
    mirrorApply: () => act(() => mr.apply(false)),
    mirrorLink: () => act(() => mr.apply(true)),
    undo: () => act(undo),
    redo: () => act(redo),
    broadcastStroke: () => act(() => { ctx.commit(e => e.broadcastStroke(ctx.selection())) }),
    broadcastShape: () => act(() => { ctx.commit(e => e.broadcastShape(ctx.selection())) }),
    fit: () => act(() => { ctx.commit(e => e.fit(ctx.selection())) }),
    draftCorners: () => act(() => { ctx.commit(e => e.draftCorners(ctx.selection())) }),
    // the deform session belongs to its view and ends with it (dot 1791893262), as with playback
    viewChanged: () => act(() => { for (const f of flows) if (f.cancelLevel < 3) f.cancel(); df.end(); ctx.feedback = undefined }),
    cancelAll: () => act(() => { for (const f of flows) f.cancel(); df.end(); ctx.feedback = undefined }),
    drawingChanged: () => act(() => { for (const f of flows) f.drawingChanged(); ctx.feedback = undefined }),
    historyChanged: () => act(historyChanged),
    outcome: err => act(() => { ctx.feedback = err === undefined ? undefined : fromError(err); historyChanged() }),
    deformReset: () => act(() => df.reset()),
    deformDone: () => act(() => df.end()),
    lastPress: () => st.lastPress,
    keyUp: name => act(() => st.keyUp(name)),
    moving: () => st.moving,
    preview() {
      const p: Preview = { cut: [], mirrorSource: [], handles: [], points: [] }
      if (POINT_TOOLS.has(tool)) {
        // a point is shown when one of its lines is (core's nearby), and when its layer is in scope
        const s = ctx.snap(), shownPts = new Set(s.lines.filter(l => l.state.visible).flatMap(l => [l.a, l.b]))
        p.points = s.points.filter(x => shownPts.has(x.id) && ctx.inScope(x.layer)).map(x => x.id)
      }
      for (const f of flows) f.preview(p)
      if (ctx.feedback) p.refusal = structuredClone(ctx.feedback)
      return p
    },
    subscribe: f => { listeners.add(f); return () => listeners.delete(f) },
  }
}
