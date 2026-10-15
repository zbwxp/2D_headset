// sphere — the 球面变形框 session (docs/sphere-frame-checklist.md §3): a frame like the selection box over the selected
// lines (move, uniform scale at the corners, rotate), sliders yaw / pitch / 「弧度」; the sphere itself is not drawn.
// One session = one frozen source: every change recomputes the op from the curves read when it opened. Nothing commits
// by itself; only apply() writes, once, one undo step (dot 1792054665).
import { isRestSphere, type PlanLine, type Rect, type Sphere } from '../../deform'
import type { Vec } from '../../src'
import type { Ctx, Flow, Owned, Preview } from '../base'
import { fromError, note } from '../feedback'
import { planLines, sphereOpFrom, type DeformOp } from './deform'

/** The values the panel and the frame set; the anchor and the source are the session's. */
export interface SphereValues { yaw: number; pitch: number; r: number; roll: number; scale: number; offset: Vec }
export type SphereControl = 'move' | 'rotate' | { corner: number }
/** In screen pixels: the corners as the selection box's, the rotate handle above the top edge. */
export const SPHERE_FRAME = Object.freeze({ corner: 10, rotate: 24, reach: 7 })
/** 「弧度」's range as multiples of the largest distance of the source curves from the anchor (§3). */
export const SPHERE_R = Object.freeze({ min: 1.05, max: 20, start: 1.5 })
export const SPHERE_TURN = 85

const point = (c: readonly Vec[], t: number): Vec => { const u = 1 - t; return { x: u * u * u * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t * t * t * c[3]!.x, y: u * u * u * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t * t * t * c[3]!.y } }
/** The largest distance from `anchor` over the curves' end points and 128 samples each (the same samples the checks use, §1). */
export function reachOf(lines: readonly PlanLine[], anchor: Vec): number {
  let d = 0
  for (const l of lines) for (let i = 0; i <= 128; i++) { const p = point(l.curve, i / 128); d = Math.max(d, Math.hypot(p.x - anchor.x, p.y - anchor.y)) }
  return d
}
/** The frame as drawn and hit: the box's corners under offset / scale / roll about the anchor, and the rotate handle. */
export function sphereFrame(box: Rect, anchor: Vec, v: SphereValues, pixel: number): { corners: Vec[]; rotate: Vec; rotateBase: Vec } {
  const c = Math.cos(v.roll * Math.PI / 180), s = Math.sin(v.roll * Math.PI / 180)
  const put = (p: Vec): Vec => { const x = (p.x - anchor.x) * v.scale, y = (p.y - anchor.y) * v.scale; return { x: anchor.x + v.offset.x + c * x - s * y, y: anchor.y + v.offset.y + s * x + c * y } }
  const corners = [box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y }].map(put)
  const rotateBase = put({ x: (box.min.x + box.max.x) / 2, y: box.min.y })
  const up = { x: s, y: -c } // the box's own "up" after roll
  return { corners, rotate: { x: rotateBase.x + up.x * SPHERE_FRAME.rotate * pixel, y: rotateBase.y + up.y * SPHERE_FRAME.rotate * pixel }, rotateBase }
}
/** A frame drag from `from` to `at`, from the values as the drag began. */
export function dragSphere(anchor: Vec, start: SphereValues, control: SphereControl, from: Vec, at: Vec): SphereValues {
  const centre = { x: anchor.x + start.offset.x, y: anchor.y + start.offset.y }
  if (control === 'move') return { ...start, offset: { x: start.offset.x + at.x - from.x, y: start.offset.y + at.y - from.y } }
  if (control === 'rotate') {
    const a0 = Math.atan2(from.y - centre.y, from.x - centre.x), a1 = Math.atan2(at.y - centre.y, at.x - centre.x)
    let roll = start.roll + (a1 - a0) * 180 / Math.PI
    roll = ((roll + 180) % 360 + 360) % 360 - 180
    return { ...start, roll }
  }
  const d0 = Math.hypot(from.x - centre.x, from.y - centre.y), d1 = Math.hypot(at.x - centre.x, at.y - centre.y)
  return d0 > 1e-9 && d1 > 1e-9 ? { ...start, scale: start.scale * d1 / d0 } : start
}

interface Session {
  owned: Owned
  ids: string[]
  lines: PlanLine[]
  box: Rect
  anchor: Vec
  reach: number
  values: SphereValues
  /** The values' op when they are valid; otherwise why they are refused (the ghost then keeps the last valid one). */
  op: DeformOp | null
  refused?: string
  ghost: { lines: { id: string; curve: Vec[] }[]; arcs: { key: string; curve: Vec[] }[] } | null
  mark: string
  drag?: { control: SphereControl; from: Vec; start: SphereValues }
}

export interface SphereFlow extends Flow {
  readonly dragging: boolean
  readonly active: boolean
  pointerDown(at: Vec): boolean
  pointerMove(at: Vec): void
  pointerUp(at: Vec): void
  pointerCancel(): void
  /** A slider or field: preview only, never a commit. */
  set(values: Partial<Pick<SphereValues, 'yaw' | 'pitch' | 'r' | 'roll' | 'scale'>>): void
  /** Enter / 「应用」: the one commit, when the values are valid; then the frame reopens on the result. */
  apply(): void
  /** Another view, playback, 完成: the session ends; nothing written. */
  end(): void
}

export function sphereFlow(ctx: Ctx): SphereFlow {
  let s: Session | null = null, committing = false
  const selectionKey = () => JSON.stringify(ctx.selection().filter(u => u.kind === 'line').map(u => u.id).sort())
  const fingerprint = (sess: { owned: Owned; ids: string[] }) => {
    const snap = sess.owned.core.in(sess.owned.view).snapshot(), ids = new Set(sess.ids)
    const lines = snap.lines.filter(l => ids.has(l.id)), pts = new Set(lines.flatMap(l => [l.a, l.b]))
    return JSON.stringify([selectionKey(), lines.map(l => [l.id, l.a, l.b, l.ha, l.hb, l.state]), snap.points.filter(p => pts.has(p.id)).map(p => [p.id, p.position])])
  }
  /** The same drawing, view, selection and lines as the session left them; otherwise it ends, for good (dot 1792054665 #3). */
  const alive = () => {
    if (!s) return false
    if (!ctx.mine(s.owned) || fingerprint(s) !== s.mark) { s = null; return false }
    return true
  }
  function open(ids: string[]) {
    s = null
    const owned = ctx.owned()
    try {
      const lines = planLines(owned.core, owned.view, ids)
      const b = owned.core.in(owned.view).selectionBounds(ids.map(id => ({ kind: 'line' as const, id })))
      if (!b) throw Error('sphere-select-lines: 先选中要变形的线')
      const box = { min: { ...b.min }, max: { ...b.max } }, anchor = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }
      const reach = Math.max(reachOf(lines, anchor), 1e-6)
      const values: SphereValues = { yaw: 0, pitch: 0, r: SPHERE_R.start * reach, roll: 0, scale: 1, offset: { x: 0, y: 0 } }
      const sess = { owned, ids }
      s = { ...sess, lines, box, anchor, reach, values, op: null, ghost: null, mark: fingerprint(sess) }
      compute(values)
    } catch (err) { ctx.feedback = fromError(err) }
  }
  function begin() {
    const ids = ctx.selection().filter(u => u.kind === 'line').map(u => u.id)
    if (!ids.length) { s = null; ctx.feedback = note('sphere-select-lines', '先用 V 或 A 选中要变形的线'); return }
    open(ids)
  }
  const sphereOf = (v: SphereValues): Sphere => ({ anchor: s!.anchor, r: v.r, yaw: v.yaw, pitch: v.pitch, roll: v.roll, scale: v.scale, offset: v.offset })
  /** New values: always shown on the panel; the op and its ghost only when valid, else the refusal (the last valid ghost stays). */
  function compute(v: SphereValues) {
    s!.values = v
    let op: DeformOp
    try { op = sphereOpFrom(s!.lines, sphereOf(v)) } catch (err) { s!.op = null; s!.refused = (err as Error).message; return }
    try {
      const core = s!.owned.core, view = s!.owned.view, shown = core.preview(view, op.run)
      if (shown) {
        const g0 = core.in(view).geometry(), g1 = shown.geometry(), key = (c: readonly Vec[]) => JSON.stringify(c)
        const before = new Map(g0.lines.map(l => [l.id, key(l.curve)])), arcsBefore = new Map(g0.arcs.map(a => [a.key, key(a.curve)]))
        s!.ghost = {
          lines: g1.lines.filter(l => before.get(l.id) !== key(l.curve)).map(l => ({ id: l.id, curve: l.curve.map(p => ({ ...p })) })),
          arcs: g1.arcs.filter(a => arcsBefore.get(a.key) !== key(a.curve)).map(a => ({ key: a.key, curve: a.curve.map(p => ({ ...p })) })),
        }
      }
    } catch (err) { s!.op = null; s!.refused = (err as Error).message; return }
    s!.op = op; s!.refused = undefined
  }
  function hit(at: Vec): SphereControl | null {
    const f = sphereFrame(s!.box, s!.anchor, s!.values, ctx.env.pixel()), r = SPHERE_FRAME.reach * ctx.env.pixel()
    const d = (p: Vec) => Math.hypot(p.x - at.x, p.y - at.y)
    if (d(f.rotate) <= r) return 'rotate'
    const c = f.corners.map((p, i) => ({ i, d: d(p) })).filter(x => x.d <= r).sort((a, b) => a.d - b.d)[0]
    if (c) return { corner: c.i }
    // inside the (rotated) box: a point is inside when it is on the same side of all four edges
    const q = f.corners, sign = (a: Vec, b: Vec) => Math.sign((b.x - a.x) * (at.y - a.y) - (b.y - a.y) * (at.x - a.x))
    const sides = q.map((p, i) => sign(p, q[(i + 1) % 4]!))
    return sides.every(x => x >= 0) || sides.every(x => x <= 0) ? 'move' : null
  }

  return {
    cancelLevel: 1,
    get dragging() { return !!s?.drag },
    get active() { return alive() },
    pointerDown(at) {
      if (!alive()) return false
      const control = hit(at)
      if (!control) return false
      s!.drag = { control, from: at, start: { ...s!.values, offset: { ...s!.values.offset } } }
      return true
    },
    pointerMove(at) { if (s?.drag && alive()) compute(dragSphere(s.anchor, s.drag.start, s.drag.control, s.drag.from, at)) },
    // a released drag only changes the preview (dot 1792054665 #1)
    pointerUp(at) { if (s?.drag && alive()) { compute(dragSphere(s.anchor, s.drag.start, s.drag.control, s.drag.from, at)); s!.drag = undefined } },
    pointerCancel() { if (s?.drag) { compute(s.drag.start); s.drag = undefined } },
    set(values) {
      if (!alive()) return
      const v = { ...s!.values, ...values }
      v.yaw = Math.max(-SPHERE_TURN, Math.min(SPHERE_TURN, v.yaw)); v.pitch = Math.max(-SPHERE_TURN, Math.min(SPHERE_TURN, v.pitch))
      v.r = Math.max(SPHERE_R.min * s!.reach, Math.min(SPHERE_R.max * s!.reach, v.r))
      compute(v)
    },
    apply() {
      if (!alive()) return
      // an invalid value never commits an older one (dot 1792054665 #2)
      if (!s!.op || s!.refused) { ctx.feedback = note('sphere-invalid', s!.refused ?? '当前球面框的值无效'); return }
      const ids = s!.ids
      // at rest there is nothing to write: no commit, no undo step (dot 1792055264)
      if (isRestSphere(sphereOf(s!.values))) return
      committing = true
      let ok: boolean
      try { ok = ctx.commit(s!.op.run) } finally { committing = false }
      if (!ok) return
      // the frame reopens on the result: scale 1, 「弧度」 at its new default, everything else 0 (dot 1792054665 #1)
      const snap = ctx.snap()
      if (ids.every(id => snap.lines.some(l => l.id === id))) open(ids); else s = null
    },
    end() { s = null },
    /** Esc: while dragging, the values go back to where the drag began; otherwise the session ends, nothing written. */
    cancel() {
      if (!s) return false
      if (s.drag) { compute(s.drag.start); s.drag = undefined; return true }
      s = null
      return true
    },
    toolChanged() { if (ctx.tool() === 'sphere') begin(); else s = null },
    drawingChanged() { s = null },
    historyChanged() { if (!committing) s = null },
    preview(p: Preview) {
      if (!alive()) return
      const f = sphereFrame(s!.box, s!.anchor, s!.values, ctx.env.pixel())
      p.sphere = {
        frame: f, values: { ...s!.values, offset: { ...s!.values.offset } },
        range: { rMin: SPHERE_R.min * s!.reach, rMax: SPHERE_R.max * s!.reach, turn: SPHERE_TURN },
        lines: s!.ghost?.lines ?? [], arcs: s!.ghost?.arcs ?? [],
        maxError: s!.op?.maxError ?? null, valid: !!s!.op && !s!.refused, dragging: !!s!.drag,
        ...(s!.refused ? { refused: s!.refused } : {}),
      }
    },
  }
}
