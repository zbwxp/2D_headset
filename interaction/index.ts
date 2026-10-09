// interaction — the tools and every unfinished operation (graph "Interaction": one owner
// per state; cancellable, atomic commit; explicit targets. doc 22; docs/interaction-plan.md).
//
// Inside (bowen 1791543548; dot 1791543638): one shared base and one shared feedback,
// written once, and one flow per user task — select-transform, pen, steps, mirror,
// clipboard. Each flow holds only its own temporary state; the drawing, the selection and
// the history are core's, and every change goes through core's public operations as one
// edit. Nothing here draws: `preview()` describes what to show, as plain data.
import type { Vec } from '../src'
import { createCtx, type Env, type Flow, type Mods, type Options, type Preview, type Tool } from './base'
import { selectTransform } from './flows/select-transform'
import { pen } from './flows/pen'
import { steps } from './flows/steps'
import { mirror } from './flows/mirror'
import { clipboard } from './flows/clipboard'

export type { Env, Mods, Options, Preview, Tool } from './base'
export type { Feedback } from './feedback'

export interface Interaction {
  readonly tool: Tool
  setTool(tool: Tool): void
  setOptions(o: Partial<Options>): void
  options(): Options
  /** Returns false when nothing was hit and the tool did nothing, so the app may pan. */
  pointerDown(at: Vec, mods?: Mods): boolean
  pointerMove(at: Vec): void
  pointerUp(at: Vec): void
  pointerCancel(): void
  key(name: string, mods?: Mods): boolean
  cancel(): void
  deleteSelection(): void
  copy(): void
  cut(): void
  paste(): void
  setMirrorSource(): void
  mirrorApply(): void
  mirrorLink(): void
  undo(): void
  redo(): void
  /** The app tells interaction about changes it made elsewhere (doc 22 §3.5). */
  drawingChanged(): void
  historyChanged(): void
  preview(): Preview
  subscribe(listener: () => void): () => void
}

const KEY_TOOLS: Record<string, Tool> = { v: 'V', a: 'A', p: 'pen', s: 'split', b: 'bind', m: 'merge', l: 'link', u: 'unbind', j: 'join', f: 'fill' }

export function createInteraction(env: Env): Interaction {
  let tool: Tool = 'pen'
  let opts: Options = { joinMode: 'smooth', radius: 10, color: '#f2c94c' }
  const ctx = createCtx(env, { tool: () => tool, options: () => ({ ...opts }) })
  const st = selectTransform(ctx), pn = pen(ctx), sp = steps(ctx), mr = mirror(ctx), cb = clipboard(ctx)
  const flows: Flow[] = [st, pn, sp, mr, cb]
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
  function setTool(t: Tool) { tool = t; for (const f of flows) f.toolChanged(); ctx.feedback = undefined }
  function historyChanged() { for (const f of flows) f.historyChanged() }
  function undo() { if (!st.dragging) { env.core().undo(); historyChanged() } }
  function redo() { if (!st.dragging) { env.core().redo(); historyChanged() } }

  function pointerDown(at: Vec, mods: Mods = {}): boolean {
    ctx.feedback = undefined
    if (tool === 'V' || tool === 'A') return st.pointerDown(at, mods)
    if (tool === 'pen') pn.click(at)
    else sp.click(at, mods)
    return true
  }

  function key(name: string, mods: Mods = {}): boolean {
    const k = name.toLowerCase()
    if (k === 'escape') { cancel(); return true }
    if (mods.meta) {
      if (k === 'z') { mods.shift ? redo() : undo(); return true }
      if (k === 'c') { cb.copy(); return true }
      if (k === 'x') { cb.cut(); return true }
      if (k === 'v') { cb.paste(); return true }
      return false
    }
    if (k === 'delete' || k === 'backspace') { ctx.commit(e => e.deleteSelection()); return true }
    if (KEY_TOOLS[k]) { setTool(KEY_TOOLS[k]!); return true }
    return false
  }

  return {
    get tool() { return tool },
    setTool: t => act(() => setTool(t)),
    setOptions: o => act(() => { opts = { ...opts, ...o } }),
    options: () => ({ ...opts }),
    pointerDown: (at, mods) => act(() => pointerDown(at, mods)),
    pointerMove: at => { if (st.dragging) act(() => st.pointerMove(at)) },
    pointerUp: at => act(() => st.pointerUp(at)),
    pointerCancel: () => act(() => st.pointerCancel()),
    key: (name, mods) => act(() => key(name, mods)),
    cancel: () => act(cancel),
    deleteSelection: () => act(() => { ctx.commit(e => e.deleteSelection()) }),
    copy: () => act(() => cb.copy()),
    cut: () => act(() => cb.cut()),
    paste: () => act(() => cb.paste()),
    setMirrorSource: () => act(() => mr.setSource()),
    mirrorApply: () => act(() => mr.apply(false)),
    mirrorLink: () => act(() => mr.apply(true)),
    undo: () => act(undo),
    redo: () => act(redo),
    drawingChanged: () => act(() => { for (const f of flows) f.drawingChanged(); ctx.feedback = undefined }),
    historyChanged: () => act(historyChanged),
    preview() {
      const p: Preview = { cut: [], mirrorSource: [] }
      for (const f of flows) f.preview(p)
      if (ctx.feedback) p.refusal = structuredClone(ctx.feedback)
      return p
    },
    subscribe: f => { listeners.add(f); return () => listeners.delete(f) },
  }
}
