// deform — the 四角 / 曲边 transform (docs/deform-p2-checklist.md, docs/deform-p3-checklist.md): the given lines
// refitted under the frame's field (deform/), written as one edit through core's own move and handle operations;
// and the tool's session — a frame over the selected lines whose corners, edge handles and edge midpoints are
// dragged (v103 7205381 src/ui/drawing/{cageEditorController.ts, DeformCageOverlay.tsx}). The same operation is
// previewed (core.preview) and committed (core.editIn), so the preview is the commit's pipeline.
import {
  bendEdges, deformField, deformPlan, inverse3, map3, neutralBend, quadProjection, rectQuad,
  type Bend, type BendHandles, type Cubic, type Plan, type PlanLine, type Quad, type Rect,
} from '../../deform'
import type { Core, Editor, Vec } from '../../src'
import type { Ctx, Flow, Owned, Preview } from '../base'
import { fromError, note } from '../feedback'

export interface DeformOp {
  /** The edit: every end point moved, then every handle set. */
  readonly run: (e: Editor) => void
  /** The sampled fit error before any constraint (input units): mirror, links, springs or a bind at commit may move the result away from the fit (dot 1791892720). */
  readonly maxError: number
}

/** The given lines' stored curves in `view` — from the snapshot, never geometry(), whose lines arc joins trim. Refused for no line or an unknown one. */
export function planLines(core: Core, view: string, lines: readonly string[]): PlanLine[] {
  if (!lines.length) throw Error('deform-no-lines: select lines to deform')
  const s = core.in(view).snapshot(), at = new Map(s.points.map(p => [p.id, p.position]))
  return [...new Set(lines)].map(id => {
    const l = s.lines.find(x => x.id === id)
    if (!l) throw Error(`deform-unknown-line: no line ${id}`)
    const a = at.get(l.a)!, b = at.get(l.b)!
    return { id, a: l.a, b: l.b, curve: [a, { x: a.x + l.ha.x, y: a.y + l.ha.y }, { x: b.x + l.hb.x, y: b.y + l.hb.y }, b] }
  })
}
/** The deform of these frozen curves: the field of `rect` taken to `quad` and bent by `bend`; the plan is computed here, once. */
export function deformOpFrom(lines: readonly PlanLine[], rect: Rect, quad: Quad, bend?: Bend): DeformOp {
  const plan: Plan = deformPlan(lines, deformField(rect, quad, bend))
  return {
    run: e => {
      e.move(plan.points)
      for (const h of plan.handles) e.moveHandle(h.line, h.end, h.offset)
    },
    maxError: plan.maxError,
  }
}
/**
 * The deform of `lines` in `view` (package 2): their stored curves read now and frozen with the plan, so previewing
 * and committing the op run the same writes, never on an earlier preview's result; preview = commit holds for the
 * same document state. The field's own refusals (a crossed quad, a fold, the horizon) pass through.
 */
export function deformOp(core: Core, view: string, lines: readonly string[], rect: Rect, quad: Quad, bend?: Bend): DeformOp {
  return deformOpFrom(planLines(core, view, lines), rect, quad, bend)
}

// ---- the tool's session (package 3) ------------------------------------------------------------------

/** What a press can take: a corner, an edge handle (0, 1) or an edge midpoint (2). */
export type FrameControl = { corner: number } | { edge: number; handle: 0 | 1 | 2 }
/** The frame as drawn and hit, in document units (one rule for both). */
export interface Frame {
  corners: Vec[]
  handles: { edge: number; handle: 0 | 1; at: Vec; anchor: Vec }[]
  midpoints: { edge: number; at: Vec }[]
  edges: Vec[][]
  grid: Vec[][]
}
/** In screen pixels: v103's sizes; the reach is the selection box's. */
export const FRAME = Object.freeze({ corner: 12, handle: 4.5, diamond: 10, reach: 7 })

const point = (c: Cubic, t: number): Vec => { const u = 1 - t; return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y } }
/** The frame of a rest rect, its quad and its bend (v103 DeformCageOverlay): the bent edges under the homography, the handles, midpoints and a grid at ¼ ½ ¾. */
export function frameOf(rect: Rect, quad: Quad, bend: Bend): Frame {
  const project = quadProjection(rect, quad), field = deformField(rect, quad, bend), w = rect.max.x - rect.min.x, h = rect.max.y - rect.min.y
  const source = (p: Vec): Vec => ({ x: rect.min.x + p.x * w, y: rect.min.y + p.y * h }), map = (p: Vec) => project.map(source(p))
  const poly = (f: (t: number) => Vec) => Array.from({ length: 33 }, (_, i) => f(i / 32))
  const edges = bendEdges(bend)
  return {
    corners: quad.map(p => ({ ...p })),
    handles: edges.flatMap((e, i) => ([0, 1] as const).map(handle => ({ edge: i, handle, at: map(e[handle + 1]!), anchor: map(e[handle ? 3 : 0]!) }))),
    midpoints: edges.map((e, i) => ({ edge: i, at: map(point(e, 0.5)) })),
    edges: edges.map(e => poly(t => map(point(e, t)))),
    grid: [0.25, 0.5, 0.75].flatMap(n => [poly(v => field.map(source({ x: n, y: v }))), poly(u => field.map(source({ x: u, y: n })))]),
  }
}
/** A drag from `start` to `at` on a control, from the frame as the drag began (v103 updateDrawingCageGesture / moveDeformBoundary). */
export function dragFrame(rect: Rect, quad: Quad, bend: Bend, control: FrameControl, start: Vec, at: Vec): { quad: Quad; bend: Bend } {
  if ('corner' in control) {
    const q = quad.map(p => ({ ...p }))
    q[control.corner] = { x: quad[control.corner]!.x + at.x - start.x, y: quad[control.corner]!.y + at.y - start.y }
    return { quad: q as unknown as Quad, bend }
  }
  // the pointer's motion taken back into the rest frame, then into the unit square
  const inverse = inverse3(quadProjection(rect, quad).matrix), a = map3(inverse, start), b = map3(inverse, at)
  const delta = { x: (b.x - a.x) / (rect.max.x - rect.min.x), y: (b.y - a.y) / (rect.max.y - rect.min.y) }
  const handles = bend.handles.map(e => e.map(p => ({ ...p })))
  const move = (i: 0 | 1, k: number) => { const p = handles[control.edge]![i]!; handles[control.edge]![i] = { x: p.x + delta.x * k, y: p.y + delta.y * k } }
  if (control.handle === 2) { move(0, 4 / 3); move(1, 4 / 3) } else move(control.handle, 1)
  return { quad, bend: { enabled: bend.enabled, handles: handles as unknown as BendHandles } }
}

interface Session {
  owned: Owned
  lines: PlanLine[]
  rect: Rect
  quad: Quad
  bend: Bend
  maxError: number
  /** The session's lines as its last own write left them (or as they were at the start): anything else ends it. */
  mark: string
  start: string
  drag?: { control: FrameControl; from: Vec; quad: Quad; bend: Bend; op?: DeformOp; lines?: { id: string; curve: Vec[] }[]; arcs?: { key: string; curve: Vec[] }[]; refused?: string }
}

export interface DeformFlow extends Flow {
  readonly dragging: boolean
  readonly active: boolean
  pointerDown(at: Vec): boolean
  pointerMove(at: Vec): void
  pointerUp(at: Vec): void
  pointerCancel(): void
  /** The frame back to the rest rect and a neutral bend; one commit restores the original curves if the drawing differs. */
  reset(): void
  /** 完成, another view, playback: the session ends; nothing written. */
  end(): void
}

export function deformFlow(ctx: Ctx): DeformFlow {
  let s: Session | null = null, committing = false
  const fingerprint = (sess: { owned: Owned; lines: PlanLine[] }) => {
    const snap = sess.owned.core.in(sess.owned.view).snapshot(), ids = new Set(sess.lines.map(l => l.id))
    const lines = snap.lines.filter(l => ids.has(l.id)), pts = new Set(lines.flatMap(l => [l.a, l.b]))
    return JSON.stringify([lines.map(l => [l.id, l.a, l.b, l.ha, l.hb, l.state]), snap.points.filter(p => pts.has(p.id)).map(p => [p.id, p.position])])
  }
  /** Still the open drawing, the same view and the lines as the session left them; otherwise it ends, for good. */
  const alive = () => {
    if (!s) return false
    if (!ctx.mine(s.owned) || fingerprint(s) !== s.mark) { s = null; return false }
    return true
  }
  function begin() {
    s = null
    const units = ctx.selection().filter(u => u.kind === 'line')
    const owned = ctx.owned(), b = units.length ? owned.core.in(owned.view).selectionBounds(units) : null
    if (!b) { ctx.feedback = note('deform-select-lines', '先用 V 或 A 选中要变形的线'); return }
    // v103 resolveDrawingCage: a side thinner than 5 % of the larger one (at least 0.01) is widened by that much each way
    const pad = Math.max(0.01, Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 0.05), min = { ...b.min }, max = { ...b.max }
    if (max.x - min.x < pad) { min.x -= pad; max.x += pad }
    if (max.y - min.y < pad) { min.y -= pad; max.y += pad }
    const rect = { min, max }
    try {
      const sess = { owned, lines: planLines(owned.core, owned.view, units.map(u => u.id)) }, mark = fingerprint(sess)
      s = { ...sess, rect, quad: rectQuad(rect), bend: neutralBend(), maxError: 0, mark, start: mark }
    } catch (err) { ctx.feedback = fromError(err) }
  }
  const frame = () => frameOf(s!.rect, s!.quad, s!.bend)
  function hit(at: Vec): FrameControl | null {
    const f = frame(), r = FRAME.reach * ctx.env.pixel()
    const near = <T extends { at: Vec }>(xs: T[]) => xs.map(x => ({ x, d: Math.hypot(x.at.x - at.x, x.at.y - at.y) })).filter(c => c.d <= r).sort((p, q) => p.d - q.d)[0]?.x
    const c = near(f.corners.map((p, i) => ({ i, at: p })))
    if (c) return { corner: c.i }
    const h = near(f.handles)
    if (h) return { edge: h.edge, handle: h.handle }
    const m = near(f.midpoints)
    return m ? { edge: m.edge, handle: 2 } : null
  }
  /** The frame for the pointer at `at`: a valid one is shown and previewed; an invalid one keeps the last valid (v103). */
  function drag(at: Vec) {
    const g = s!.drag!
    let next: { quad: Quad; bend: Bend }, op: DeformOp
    try {
      next = dragFrame(s!.rect, g.quad, g.bend, g.control, g.from, at)
      op = deformOpFrom(s!.lines, s!.rect, next.quad, next.bend)
      frameOf(s!.rect, next.quad, next.bend)
    } catch (err) { ctx.feedback = fromError(err); return }
    ctx.feedback = undefined
    s!.quad = next.quad; s!.bend = next.bend; g.op = op; g.refused = undefined; g.lines = undefined; g.arcs = undefined
    try {
      const shown = s!.owned.core.preview(s!.owned.view, op.run)
      if (shown) {
        // everything the release changes, as the box's scale and rotate show it (dot 1791894345): every line and every
        // join's arc that is new or moved — the given lines, and those mirror or links carry along
        const g0 = s!.owned.core.in(s!.owned.view).geometry(), g1 = shown.geometry(), key = (c: readonly Vec[]) => JSON.stringify(c)
        const before = new Map(g0.lines.map(l => [l.id, key(l.curve)])), arcsBefore = new Map(g0.arcs.map(a => [a.key, key(a.curve)]))
        g.lines = g1.lines.filter(l => before.get(l.id) !== key(l.curve)).map(l => ({ id: l.id, curve: l.curve.map(v => ({ ...v })) }))
        g.arcs = g1.arcs.filter(a => arcsBefore.get(a.key) !== key(a.curve)).map(a => ({ key: a.key, curve: a.curve.map(v => ({ ...v })) }))
      }
    } catch (err) { g.refused = (err as Error).message }
  }
  /** Its own commit: the history change it causes (synchronously, inside core's commit) is not one that ends the session. */
  function write(op: DeformOp) {
    committing = true
    try { return ctx.commit(op.run) } finally { committing = false }
  }
  /** After its own commit: its lines must still be there with the same end points (a bind at commit can merge them); otherwise the frozen targets are void and it ends (dot 1791893524). */
  function settled(): boolean {
    const snap = s!.owned.core.in(s!.owned.view).snapshot()
    if (s!.lines.every(l => snap.lines.some(x => x.id === l.id && x.a === l.a && x.b === l.b))) { s!.mark = fingerprint(s!); return true }
    s = null
    return false
  }

  return {
    cancelLevel: 1,
    get dragging() { return !!s?.drag },
    get active() { return alive() },
    pointerDown(at) {
      if (!alive()) return false
      const control = hit(at)
      if (!control) return false
      s!.drag = { control, from: at, quad: s!.quad, bend: s!.bend }
      return true
    },
    pointerMove(at) { if (s?.drag && alive()) drag(at) },
    pointerUp(at) {
      if (!s?.drag || !alive()) return
      drag(at)
      const g = s!.drag!
      s!.drag = undefined
      if (!g.op || g.refused) { s!.quad = g.quad; s!.bend = g.bend; if (g.refused) ctx.feedback = note('deform-refused', g.refused); return }
      // the frame back where the drag began: nothing to write (dot 1791894345 — not left to core's no-change check)
      if (JSON.stringify([s!.quad, s!.bend]) === JSON.stringify([g.quad, g.bend])) return
      if (!write(g.op)) { s!.quad = g.quad; s!.bend = g.bend; return }
      if (settled()) s!.maxError = g.op.maxError
    },
    pointerCancel() { if (s?.drag) { s.quad = s.drag.quad; s.bend = s.drag.bend; s.drag = undefined } },
    reset() {
      if (!alive()) return
      const quad = rectQuad(s!.rect)
      // a refused commit leaves frame and drawing as they were (dot 1791893524)
      if (s!.mark !== s!.start && (!write(deformOpFrom(s!.lines, s!.rect, quad)) || !settled())) return
      s!.quad = quad; s!.bend = neutralBend(); s!.maxError = 0; s!.mark = fingerprint(s!)
    },
    end() { s = null },
    /** Esc: while dragging, the frame goes back to where the drag began; otherwise the session ends. */
    cancel() {
      if (!s) return false
      if (s.drag) { s.quad = s.drag.quad; s.bend = s.drag.bend; s.drag = undefined; return true }
      s = null
      return true
    },
    toolChanged() { if (ctx.tool() === 'deform') begin(); else s = null },
    drawingChanged() { s = null },
    historyChanged() { if (!committing) s = null },
    preview(p: Preview) {
      if (!alive()) return
      const g = s!.drag
      p.deform = { frame: frame(), maxError: g?.op?.maxError ?? s!.maxError, lines: g?.lines ?? null, arcs: g?.arcs ?? null, dragging: !!g, ...(g?.refused ? { refused: g.refused } : {}) }
    },
  }
}
