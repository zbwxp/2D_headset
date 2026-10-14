// Throwaway test bench (bowen 1791477975): drawing, camera, panels, files and the log.
// The tools and every unfinished operation are the interaction package's (graph
// "Interaction", doc 22); one-shot panel commands call core's public operations and then
// tell interaction (doc 22 §3.5). Uses core's public entry only.
import { useEffect, useReducer, useRef, useState } from 'react'
import { Core, save, open, correctionEdge, Refusal, type Vec, type Snapshot, type Editor, type PoseReader, type ReferenceImage, type ReferenceProps, type ReferenceSlot, type AssetUse } from '../../src'
import { createInteraction, REACH, type Tool, type Preview } from '../../interaction'
import { createAutosave, indexedDbStore, type Autosave, type Store } from '../../autosave'
import eyeFixture from '../../test/fixtures/v2-right-eye.json'
import { LayersPanel } from '../../visual'
import { Rename } from '../../rename'
import { cursorFor } from '../../cursor'
import { PosePad } from '../../pose-pad'
import { labelsFor, middleOf, type Kind as LabelKind } from '../../name-labels'
import { createMover, isArrow, type Target } from '../../move'
// playback batches reuse editing's pure pieces (docs/playback-tools-checklist.md §2)
import { followHandles } from '../../interaction/flows/follow'
import { handlesOf, hitBox, opAt, startHandleDrag, type BoxOp, type Bounds } from '../../interaction/flows/selection-box'
import { frameOf, dragFrame, FRAME, type FrameControl } from '../../interaction/flows/deform'
import { deformPlan, deformField, rectQuad, neutralBend, type PlanLine, type Quad, type Bend, type Rect } from '../../deform'
import { Slider } from '../../slider'
import { createInkCache } from '../../ink'
import { apply as maskApply, area as maskArea, contains as maskContains, distance as maskDistance, type Area, type Relation as MaskRelation } from '../../visibility'

type Id = string
type Unit = Snapshot['selection'][number]

let core = Core.newDocument({ axis: 0 })
let seq = 0
// New ids carry a per-session prefix: an opened file may hold ids used by an earlier session,
// including deleted ones that core still keeps reserved (dot 1791512144); existing ones are skipped too.
const session = Date.now().toString(36)
const nid = (p: string) => {
  const s = core.snapshot(), used = new Set([...s.points.map(x => x.id), ...s.lines.map(x => x.id), ...s.layers.map(x => x.id)])
  let id: string
  do id = `${p}${session}-${++seq}`; while (used.has(id))
  return id
}
const P = (x: number, y: number): Vec => ({ x, y })
const add = (a: Vec, b: Vec) => P(a.x + b.x, a.y + b.y)
const path = (c: readonly Vec[]) => `M${c[0]!.x},${c[0]!.y} C${c[1]!.x},${c[1]!.y} ${c[2]!.x},${c[2]!.y} ${c[3]!.x},${c[3]!.y}`
const mid = (c: readonly Vec[]) => P((c[0]!.x + 3 * c[1]!.x + 3 * c[2]!.x + c[3]!.x) / 8, (c[0]!.y + 3 * c[1]!.y + 3 * c[2]!.y + c[3]!.y) / 8)

// ---- the log: every edit's Editor calls and what core returned -------------------------
type LogRow = { calls: string; result: string }
const log: LogRow[] = []
/** A call argument for the log; never throws (a circular or unprintable argument is shown as such; dot 1791697642). */
const short = (x: unknown) => {
  let t: string
  try { t = JSON.stringify(x) ?? String(x) } catch { t = '‹unprintable›' }
  return t.length > 80 ? t.slice(0, 77) + '…' : t
}
/** Ids in a message shown with their names, e.g. "u1" → "u1「左上眼睑外」". */
function withNames(m: string) {
  const s = core.snapshot(), names = new Map<string, string>([...s.lines.map(l => [l.id, l.name] as const), ...s.groups.map(g => [g.id, g.name] as const)])
  return m.replace(/[^\s(),"]+/g, w => (names.has(w) ? `${w}「${names.get(w)}」` : w))
}
/**
 * The open Core seen through a logging wrapper, one per App and Core (so interaction's identity
 * checks hold). `readOnly` is that App's playback (stage 3a; dot 1791683911, 1791686247: the flag
 * and the wrapper belong to the App instance, not the module). While it is on, undo and redo are
 * refused, and an edit is allowed only if it calls `correct` exactly once and nothing else (stage
 * 3b package 5; dot 1791696773, 1791696847): a forbidden call throws and is remembered even if the
 * callback catches it; when the callback returns, before control goes back to core, a forbidden
 * call or a count other than one fails the edit; the callback's own result is returned unchanged,
 * so core still refuses an async callback.
 */
/** The App's write mode: editing, playback (one correct per edit), or locked (restoring the autosaved drawing: nothing writes). */
type WriteMode = 'edit' | 'playback' | 'locked'
/**
 * What playback lets through besides one `correct` alone (docs/playback-edit-checklist.md §1): the same data at every
 * angle — a layer's or a fill's visibility — and `uncorrect`; checked on the call's target, not its name only (dot
 * 1791976669). Undefined when allowed, else why not.
 */
function refusedInPlayback(n: string, a: readonly unknown[], atView: boolean, playbackRef: (id: unknown) => boolean, arcRow: (point: unknown, l1: unknown, l2: unknown) => boolean): string | undefined {
  const onlyVisible = (o: unknown) => !!o && typeof o === 'object' && Object.keys(o).every(k => k === 'visible')
  if (n === 'uncorrect' || n === 'clearCorrections' || n === 'fillVisible') return undefined
  // an existing arc's radius: one value for every view and pose (bowen 1791985326; docs/arc-radius-shared-checklist.md §5b,
  // dot 1791985670) — the row is an arc before the edit and stays one; a new join or a mode change is refused
  if (n === 'join' && arcRow(a[0], a[1], a[2])) {
    const o = a[3] as Record<string, unknown> | null
    if (o && typeof o === 'object' && o.mode === 'arc' && Object.keys(o).every(k => k === 'mode' || k === 'radius')) return undefined
  }
  // at a view, writing that view: what A and V do there in editing — pick, then move points, curves and handles (§2)
  if (atView && (n === 'select' || n === 'selectGroup' || n === 'translate' || n === 'moveHandle')) return undefined
  // every show / hide switch of the panels: a layer's lines or fills, a curve, a line, a fill (bowen 1791979917: layerFills was missed)
  if (['layerState', 'layerFills', 'groupState', 'lineState', 'fillState'].includes(n) && onlyVisible(a[1])) return undefined
  // playback's own pictures (§5): placed at `playback`, changed or removed only if they are playback's; the library takes new pictures
  if (n === 'placeReference' && (a[0] as { view?: unknown } | null)?.view === 'playback') return undefined
  if ((n === 'setReference' || n === 'removeReference') && playbackRef(a[0])) return undefined
  if (n === 'addAsset') return undefined
  return `${n} is not allowed during playback (only a correction, deleting one, showing or hiding, an arc's radius, playback's own pictures, and at a view moving its points and handles)`
}
type Pose = { yaw: number; pitch: number }
/** The view a pose is exactly at (yaw 0 / ±90 × pitch 0 / ±45), else null. */
const viewAtPose = (p: Pose | null): string | null =>
  p && (p.yaw === 0 || Math.abs(p.yaw) === 90) && (p.pitch === 0 || Math.abs(p.pitch) === 45) ? `view:${p.yaw + 0},${p.pitch + 0}` : null
/** Where a playback drag corrects (bowen 1791976386; docs/playback-edit-checklist.md): yaw ±30 / ±60 on the rows pitch 0 / ±45. */
const correctionPose = (p: Pose | null): boolean => !!p && [30, 60].includes(Math.abs(p.yaw)) && (p.pitch === 0 || Math.abs(p.pitch) === 45)
/** A playback write's targets: the existing `correct`'s (docs/playback-tools-checklist.md §2). */
type Targets = { points: { id: Id; position: Vec }[]; handles: { line: Id; end: 'a' | 'b'; vector: Vec }[] }
/** The picked points' box at a pose, from the posed snapshot's points (null for fewer than two distinct places). */
function boundsOf(s: Snapshot, ids: readonly Id[]): Bounds | null {
  const ps = s.points.filter(p => ids.includes(p.id)).map(p => p.position)
  if (ps.length < 2) return null
  const min = P(Math.min(...ps.map(p => p.x)), Math.min(...ps.map(p => p.y))), max = P(Math.max(...ps.map(p => p.x)), Math.max(...ps.map(p => p.y)))
  return min.x === max.x && min.y === max.y ? null : { min, max }
}
/** A box op (scale or rotate) on the picked points and on the handles at their ends (§2): the pose's stored values in, targets out. */
function boxTargets(s: Snapshot, ids: readonly Id[], op: BoxOp): Targets {
  const lin = (v: Vec): Vec => {
    if (op.kind === 'scale') return P(v.x * op.sx, v.y * op.sy)
    const c = Math.cos(op.angle), n = Math.sin(op.angle)
    return P(v.x * c - v.y * n, v.x * n + v.y * c)
  }
  const origin = op.kind === 'scale' ? op.anchor : op.centre, picked = new Set(ids)
  return {
    points: s.points.filter(p => picked.has(p.id)).map(p => { const d = lin(P(p.position.x - origin.x, p.position.y - origin.y)); return { id: p.id, position: P(origin.x + d.x, origin.y + d.y) } }),
    handles: s.lines.flatMap(l => (['a', 'b'] as const).filter(end => picked.has(l[end])).map(end => ({ line: l.id, end, vector: lin(end === 'a' ? l.ha : l.hb) }))),
  }
}
/** A move of the picked points by `o` (§2): their lines' other handles follow their chords when 手柄跟随 is on (`followHandles`). */
function moveTargets(s: Snapshot, ids: readonly Id[], o: Vec, follow: boolean): Targets {
  const picked = new Set(ids)
  return {
    points: s.points.filter(p => picked.has(p.id)).map(p => ({ id: p.id, position: P(p.position.x + o.x, p.position.y + o.y) })),
    handles: follow ? followHandles(s, ids.map(id => ({ kind: 'point' as const, id })), o).map(f => ({ line: f.line, end: f.end, vector: f.offset })) : [],
  }
}
/**
 * 四角 / 曲边 on the playback selection (docs/playback-tools-checklist.md §2): the lines with both ends picked, their curves
 * rebuilt from the posed snapshot's end points and ha / hb (as `planLines`, never `geometry()`; dot 1791981083), frozen with
 * the frame's rect (padded as editing's: 5 % of the larger side, at least 0.01).
 */
function deformStart(s: Snapshot, ids: readonly Id[]): null | { lines: PlanLine[]; rect: Rect } {
  const picked = new Set(ids), at = new Map(s.points.map(p => [p.id, p.position]))
  const lines: PlanLine[] = s.lines.filter(l => picked.has(l.a) && picked.has(l.b)).map(l => {
    const a = at.get(l.a)!, b = at.get(l.b)!
    return { id: l.id, a: l.a, b: l.b, curve: [a, P(a.x + l.ha.x, a.y + l.ha.y), P(b.x + l.hb.x, b.y + l.hb.y), b] }
  })
  if (!lines.length) return null
  const xs = lines.flatMap(l => l.curve.map(v => v.x)), ys = lines.flatMap(l => l.curve.map(v => v.y))
  const min = { x: Math.min(...xs), y: Math.min(...ys) }, max = { x: Math.max(...xs), y: Math.max(...ys) }
  const pad = Math.max(0.01, Math.max(max.x - min.x, max.y - min.y) * 0.05)
  if (max.x - min.x < pad) { min.x -= pad; max.x += pad }
  if (max.y - min.y < pad) { min.y -= pad; max.y += pad }
  return { lines, rect: { min, max } }
}
/** The deform's targets for a frame (§2): `deformPlan`'s point targets and handle offsets, as the existing correct takes them. */
function deformTargets(lines: readonly PlanLine[], rect: Rect, quad: Quad, bend: Bend): Targets {
  const plan = deformPlan(lines, deformField(rect, quad, bend))
  return { points: plan.points.map(q => ({ id: q.id, position: q.target })), handles: plan.handles.map(h => ({ line: h.line, end: h.end, vector: h.offset })) }
}
type Model = ReturnType<Core['model']>
type Knots = readonly (readonly [number, number])[]
/** The edge key a correction pose lies on, as the model names it (`0,0>90,0`), from correctionEdge's view keys. */
const modelEdge = (inner: string, outer: string) => `${inner.slice('view:'.length)}>${outer.slice('view:'.length)}`
/** The distance from p to a cubic, sampled (bench glue: the playback V pick). */
function curveDistance(c: readonly Vec[], p: Vec): number {
  let best = Infinity
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    const x = w.reduce((s, k, j) => s + k * c[j]!.x, 0), y = w.reduce((s, k, j) => s + k * c[j]!.y, 0)
    best = Math.min(best, Math.hypot(x - p.x, y - p.y))
  }
  return best
}
/**
 * What a playback write changed (docs/playback-edit-checklist.md §3), in plain words: the knots added, changed or removed
 * per control, edge and axis; every view position or handle that moved; anything else as one raw line (a check, never hidden).
 */
function changesBetween(before: Model, after: Model, s: Snapshot): string[] {
  const out: string[] = []
  const lineName = (id: string) => s.lines.find(l => l.id === id)?.name || id
  const edgeName = (k: string) => k.replace('>', ' → ')
  const knotsDiff = (what: string, a: Record<string, { x?: Knots; y?: Knots }> | undefined, b: Record<string, { x?: Knots; y?: Knots }> | undefined) => {
    for (const edge of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) for (const axis of ['x', 'y'] as const) {
      const ka = a?.[edge]?.[axis] ?? [], kb = b?.[edge]?.[axis] ?? []
      const ta = new Map(ka.map(k => [k[0], k[1]])), tb = new Map(kb.map(k => [k[0], k[1]]))
      for (const [t, v] of tb) if (!ta.has(t)) out.push(`${what} · ${edgeName(edge)} · t ${+t.toFixed(3)} · ${axis} 加修正`)
        else if (ta.get(t) !== v) out.push(`${what} · ${edgeName(edge)} · t ${+t.toFixed(3)} · ${axis} 修正改了`)
      for (const t of ta.keys()) if (!tb.has(t)) out.push(`${what} · ${edgeName(edge)} · t ${+t.toFixed(3)} · ${axis} 删除修正拐点`)
    }
  }
  const ra = before.responses ?? { points: {}, handles: {} }, rb = after.responses ?? { points: {}, handles: {} }
  for (const id of new Set([...Object.keys(ra.points), ...Object.keys(rb.points)])) knotsDiff(`点 ${id}`, ra.points[id], rb.points[id])
  for (const line of new Set([...Object.keys(ra.handles), ...Object.keys(rb.handles)])) for (const end of ['a', 'b'] as const) knotsDiff(`线 ${lineName(line)} 的 ${end} 端手柄`, ra.handles[line]?.[end], rb.handles[line]?.[end])
  let rest = false
  for (const vb of after.views) {
    const va = before.views.find(v => v.yaw === vb.yaw && v.pitch === vb.pitch)!, name = `视角 ${vb.yaw},${vb.pitch}`
    for (const [id, p] of Object.entries(vb.points)) { const q = va.points[id]; if (q && (q.x !== p.x || q.y !== p.y)) out.push(`${name} 的点 ${id} 被移动了 (${+(p.x - q.x).toFixed(3)}, ${+(p.y - q.y).toFixed(3)})`) }
    for (const [id, l] of Object.entries(vb.lines)) for (const h of ['ha', 'hb'] as const) {
      const q = va.lines[id]?.[h]
      if (q && (q.x !== l[h].x || q.y !== l[h].y)) out.push(`${name} 的线 ${lineName(id)} 的 ${h === 'ha' ? 'a' : 'b'} 端手柄变了`)
    }
    const strip = (v: typeof vb) => JSON.stringify({ ...v, points: Object.keys(v.points), lines: Object.fromEntries(Object.entries(v.lines).map(([k, l]) => [k, l.stroke])) })
    rest ||= strip(va) !== strip(vb)
  }
  if (rest) out.push('（还有别的数据变了：线宽、圆角或结构）')
  return out.length ? out : ['（没有数据变化）']
}
function loggedFor(mode: () => WriteMode, afterWrite: () => void = () => {}, poseView: () => string | null = () => null): (c: Core) => Core {
  const wrappers = new WeakMap<Core, Core>()
  return c => {
    let w = wrappers.get(c)
    if (w) return w
    w = new Proxy(c, {
      get(t, k) {
        if (k === 'edit' || k === 'editIn') return (...args: unknown[]) => {
          const [view, fn] = (k === 'edit' ? ['view:0,0', args[0]] : args) as [string, (e: Editor) => void]
          const m = mode()
          if (m === 'locked') { log.unshift({ calls: `${k}(…)`, result: '✗ restoring the autosaved drawing' }); throw new Error('restoring: nothing is written until the autosaved drawing is restored') }
          // playback at a view, writing that view: A's and V's editing of it (docs/playback-edit-checklist.md §2)
          const playback = m === 'playback', atView = playback && view === poseView()
          const calls: string[] = []
          // playback's own pictures as they are before the edit (a read inside the edit is refused by core)
          const playbackRefs = new Set(playback ? t.playbackReferences().map(r => r.id) : [])
          // the arc rows as they are before the edit (point and its two lines, in either order)
          const arcs = new Set(playback ? t.snapshot().joins.filter(r => r.mode === 'arc').map(r => JSON.stringify([r.point, ...[...r.lines].sort()])) : [])
          const arcRow = (point: unknown, l1: unknown, l2: unknown) => typeof point === 'string' && typeof l1 === 'string' && typeof l2 === 'string' && arcs.has(JSON.stringify([point, ...[l1, l2].sort()]))
          let corrects = 0, others = 0, forbidden: string | undefined
          const rec = (e: Editor) => new Proxy(e, { get: (x, n) => { const v = Reflect.get(x, n); return typeof v === 'function' ? (...a: unknown[]) => {
            // the gate first, then the log: nothing before the gate may throw (dot 1791697642)
            const why = playback && n !== 'correct' ? refusedInPlayback(String(n), a, atView, id => typeof id === 'string' && playbackRefs.has(id), arcRow) : undefined
            if (why !== undefined) forbidden ??= String(n)
            calls.push(`${String(n)}(${a.map(short).join(', ')})`)
            if (why !== undefined) throw new Error(`read-only-playback: ${why}`)
            if (playback) { if (n === 'correct') corrects++; else others++ }
            return v.apply(x, a)
          } : v } })
          const head = view === 'view:0,0' ? '' : `[${view}] `
          try {
            t.editIn(view, e => {
              const result: unknown = fn(rec(e))
              // an empty edit would still settle the drawing: refused too (dot 1791696847)
              if (playback && (forbidden !== undefined || corrects + others === 0 || (corrects > 0 && (corrects !== 1 || others > 0)))) {
                throw new Error(`read-only-playback: during playback an edit calls one correction alone, or only the operations playback allows (${forbidden !== undefined ? `it called ${forbidden}` : corrects + others === 0 ? 'it called nothing' : corrects !== 1 ? `it called correct ${corrects} times` : 'it called other operations beside a correction'})`)
              }
              return result as void
            })
            log.unshift({ calls: head + calls.join('; '), result: 'ok' })
            afterWrite() // every write through the wrapper reaches autosave, rendered or not
          }
          catch (err) { log.unshift({ calls: head + calls.join('; '), result: '✗ ' + withNames((err as Error).message) }); throw err }
          finally { log.length = Math.min(log.length, 50) }
        }
        if (k === 'undo' || k === 'redo') return () => { if (mode() !== 'edit') { log.unshift({ calls: `${k}()`, result: mode() === 'locked' ? '✗ restoring the autosaved drawing' : '✗ read only during playback' }); return } const could = k === 'undo' ? t.canUndo : t.canRedo; t[k](); log.unshift({ calls: `${k}()`, result: could ? 'ok' : `ok (nothing to ${k})` }); afterWrite() }
        const v = Reflect.get(t, k, t)
        return typeof v === 'function' ? v.bind(t) : v
      },
    })
    wrappers.set(c, w)
    return w
  }
}

// ---- demo scenes (test data, not a load feature) -----------------------------------------
/** A left eye (smooth top and bottom, an arc corner, filled, named), a copy flipped to the right and mirror-linked. */
function demo() {
  const L = core.snapshot().layers[0]?.id ?? 'layer-1', p = (id: Id, x: number, y: number) => ({ id, layer: L, position: P(x, y) })
  core.edit(e => { e.line('u1', p('a', -300, 0), p('b', -200, -60)); e.line('u2', 'b', p('c', -100, 0)); e.line('w1', 'c', p('d', -200, 40)); e.line('w2', 'd', 'a') })
  core.edit(e => { e.join('b', 'u1', 'u2', { mode: 'smooth' }); e.join('d', 'w1', 'w2', { mode: 'smooth' }); e.join('a', 'u1', 'w2', { mode: 'arc', radius: 10 }) })
  core.edit(e => e.fill(core.snapshot().loops[0]!.id, '#f2c94c'))
  core.edit(e => { e.renameGroup(core.snapshot().groups[0]!.id, '左眼'); e.renameLine('u1', '左上眼睑外'); e.renameLine('u2', '左上眼睑内') })
  core.edit(e => e.copyLayer(L, 'R'))
  core.edit(e => { e.selectGroup('R/u1'); e.translate(400, 0); e.flip() })
  const g = (line: Id) => core.snapshot().groups.find(x => x.lines.includes(line))!.id
  core.edit(e => { e.mirrorLink([g('u1')], [g('R/u1')]); e.select([]) })
}
/** The v2 right eye (test fixture from 4bc7cc2), scaled ×1000 and shifted onto the bench's axis, one layer per stroke, with its corner links. */
function v2Eye() {
  const k = 1000, S = (v: Vec) => P(v.x * k, v.y * k), at = (v: Vec) => P((v.x - eyeFixture.axis) * k, v.y * k - 200), made = new Set<string>()
  core.edit(e => {
    for (const L of eyeFixture.layers) e.layer(L.id, L.name)
    const end = (id: string, layer: string, v: Vec) => { if (made.has(id)) return id; made.add(id); return { id, layer, position: at(v) } }
    for (const l of eyeFixture.lines) e.line(l.id, end(l.a, l.layer, l.pa), end(l.b, l.layer, l.pb), { ha: S(l.ha), hb: S(l.hb) })
    for (const [a, b] of eyeFixture.links) e.link(a!, b!)
    for (const l of eyeFixture.lines) e.renameLine(l.id, l.name)
  })
}

const TOOLS: [Tool, string][] = [['pen', 'Pen P'], ['V', 'V group'], ['A', 'A direct'], ['split', 'Split'], ['bind', 'Bind B'], ['merge', 'Merge pos M'], ['link', 'Link L'], ['unbind', 'Unbind U'], ['join', 'Join J'], ['fill', 'Fill F'], ['deform', '四角/曲边']]

/** The autosave store (docs/autosave-plan.md): IndexedDB in a browser; a test may give its own; none without either. */
const autosaveStore = (): Store | undefined => (window as unknown as { benchStore?: Store }).benchStore ?? (typeof indexedDB !== 'undefined' ? indexedDbStore() : undefined)

type Snap = ReturnType<Core['snapshot']>
type Geo = ReturnType<Core['geometry']>
type MaskRules = Map<string, (MaskRelation & { key: string })[]>
const NO_MASKS = { masksOf: new Map() as MaskRules, maskCut: undefined }
/**
 * The drawing's masks as a view draws them: each relation's sources as their fills' own areas in this view, read
 * before any mask (Q33); a source counts while its fill is filled and shown (bowen 1791901604) — `null` otherwise.
 * `maskCut` is the ink's cut: a line's piece by its own relations; a join's piece (an arc, a tip) by the relations both
 * its lines have (docs/mask-p1-checklist.md §2).
 */
function masksFor(s: Snap, g: Geo) {
  const masksOf: MaskRules = new Map()
  const areaOf = new Map<string, Area | null>()
  const source = (id: string) => {
    if (!areaOf.has(id)) {
      const lp = s.loops.find(l => l.id === id), f = g.fills.find(x => x.id === id)
      areaOf.set(id, lp?.filled && lp.visible && f ? maskArea(f.parts.map(p => p.curve as unknown as [Vec, Vec, Vec, Vec])) : null)
    }
    return areaOf.get(id)!
  }
  // the drawing's own masks (package 2, docs/mask-p2-checklist.md §4)
  for (const m of s.masks) {
    const target = `${m.target.kind}:${m.target.id}`
    // a rule is its mode and its set of sources: two lines with the same rule share it (dot 1791903159)
    const key = `${m.mode}|${[...new Set(m.sources)].sort().join(',')}`
    masksOf.set(target, [...(masksOf.get(target) ?? []), { key, mode: m.mode, sources: m.sources.map(source) }])
  }
  const maskCut = !masksOf.size ? undefined : (src: { kind: string; id: string; lines?: readonly [string, string] }, loops: readonly (readonly Vec[])[]) => {
    const own = (id: string) => masksOf.get(`line:${id}`) ?? []
    const rs = src.lines ? own(src.lines[0]).filter(r => own(src.lines![1]).some(q => q.key === r.key)) : own(src.id)
    return rs.length ? maskApply(loops, rs) : undefined
  }
  return { masksOf, maskCut }
}
/** What is drawn of each masked line (its masked ink) and fill (its masked area): picking follows it (docs/mask-p3-checklist.md). */
function cutsFor(s: Snap, g: Geo, masksOf: MaskRules, inkOf: ReadonlyMap<string, { loops: readonly (readonly Vec[])[] }>) {
  return {
    lines: new Map(s.lines.filter(l => masksOf.has(`line:${l.id}`)).map(l => [l.id, (inkOf.get(l.id)?.loops ?? []) as Area])),
    fills: new Map(g.fills.filter(f => masksOf.has(`fill:${f.id}`)).map(f => [f.id, maskApply(maskArea(f.parts.map(p => p.curve as unknown as [Vec, Vec, Vec, Vec])), masksOf.get(`fill:${f.id}`)!)])),
  }
}

export function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [layer, setLayer] = useState<Id>('layer-1')
  const [layers, setLayers] = useState<Id[]>(['layer-1']) // the selected layers (docs/layer-scope-plan.md §1)
  // Z is a view tool: the camera is the app's, so it lives here, not in interaction (bowen 1791554415)
  const [zoomTool, setZoomTool] = useState(false)
  // 从视角应用 (bowen 1791878160): on, the nine view buttons pick the view to apply from; Esc cancels. It belongs
  // to the drawing and the view it was started in: another drawing or view ends it (dot 1791879488)
  const [applyFromAt, setApplyFromAt] = useState<{ core: Core; view: string } | null>(null), applyFromOn = useRef(false)
  // the one display kind of the name labels (docs/name-labels-plan.md; bowen 1791731823; dot 1791732110): set only
  // when A / V actually hit a line, a layers row is clicked or a name is found; nothing else changes it
  const [labelKind, setLabelKind] = useState<LabelKind>('line')
  const [width, setWidth] = useState(2)
  // changes with every drawing opened: the panel's own temporary state (a rename draft, a dragged
  // row) belongs to one drawing and ends with it (dot 1791551140)
  const [drawing, setDrawing] = useState(0)
  const [box, setBox] = useState({ x: -400, y: -300, w: 800, h: 600 })
  // the current view (multi-view step 7): every read and every edit is in it; the app holds it
  const [view, setView] = useState('view:0,0')
  // playback (stage 3a): the pose shown, or null when editing; `poseGen` counts entries (a file
  // read started before one is dropped), `openSeq` counts Opens (only the latest may open)
  const [pose, setPose] = useState<null | { yaw: number; pitch: number }>(null)
  // the newest pose for the key listener, which is installed once per ix (dot 1791769087); set again by each key step
  const poseRef = useRef(pose)
  poseRef.current = pose
  const poseGen = useRef(0), openSeq = useRef(0)
  // stage 3b package 5: a playback drag's refusal, shown until the next press, pose change or
  // leaving playback; the drag's ghost (the picked point and where it is dragged); the number
  // fields' own text, kept apart from the pose (dot 1791696847)
  const [corrRefusal, setCorrRefusal] = useState<null | { message: string; objects: readonly { kind: string; id: string }[] }>(null)
  // playback batches (docs/playback-tools-checklist.md): the playback selection (point ids, bound to the drawing), the
  // drag's ghost (what the previewed correct changes at the pose), the selection box being dragged
  const [pbSel, setPbSel] = useState<{ core: Core; ids: Id[] }>({ core, ids: [] })
  const [batchGhost, setBatchGhost] = useState<null | { lines: { id: Id; curve: readonly Vec[] }[]; arcs: { key: string; curve: readonly Vec[] }[]; points: { id: Id; position: Vec }[] }>(null)
  const [pbBox, setPbBox] = useState<null | { from: Vec; to: Vec }>(null)
  // 四角 / 曲边 on the playback selection: frozen at its start (drawing, pose, picked points), the frame kept across its writes
  const [pbDeform, setPbDeform] = useState<null | { core: Core; key: string; text: string; lines: PlanLine[]; rect: Rect; quad: Quad; bend: Bend }>(null)
  // the line under the resting pointer in playback with A: its handles are marked and pickable (docs/playback-edit-checklist.md §2)
  const [poseHover, setPoseHover] = useState<Id | null>(null)
  // what the last playback write changed (§3), shown until the next write or leaving playback
  const [lastChange, setLastChange] = useState<null | { pose: Pose; lines: string[] }>(null)
  // reference pictures (docs/reference-images-plan.md §7.1): this App's counter, advanced by a view change,
  // entering or leaving playback, an Open and unmounting; a picture read keeps it and writes only if unchanged
  const refGen = useRef(0)
  useEffect(() => () => { refGen.current++ }, [])
  // autosave (docs/autosave-plan.md): restoring locks every write entry until the stored drawing is back
  const store = useRef(autosaveStore()).current
  const [restoring, setRestoring] = useState(!!store)
  const restoringNow = useRef(!!store)
  const saver = useRef<Autosave | null>(null)
  // pictures that failed to draw (a stored picture that does not decode): shown in the status, nothing else changes
  // bound to the drawing and the picture's source, not the id alone: a good picture with the same id in another drawing is not marked (dot 1791703225)
  const [refBroken, setRefBroken] = useState<{ core: Core; id: string; src: string }[]>([])
  // round two (docs/reference-images-plan.md §8, §8a): a live preview of one picture's changes, the
  // Move picture mode and its active picture; each bound to the drawing, the App's counter and the picture
  type RefBind = { core: Core; gen: number; id: string; src: string }
  const [refPreview, setRefPreview] = useState<null | (RefBind & { base: ReferenceImage; props: ReferenceProps })>(null)
  const previewNow = useRef(refPreview)
  const [moveRef, setMoveRef] = useState(false)
  // ink outlines (docs/ink-p1-checklist.md): on by default since bowen 1791815311 (joins only show with it); off = the
  // old SVG strokes, kept for comparison; not saved, never in undo
  const [inkOn, setInkOn] = useState(true)
  // 蒙版（实验）, masks package 1 (docs/mask-p1-checklist.md §3): the relations come from a temporary bench store until
  // package 2 stores them in the drawing; this switch turns their drawing on
  // on by default: the masks are the drawing's (package 2); off only to compare (bowen 1791908448: a switch left off looked like broken masks)
  const [masksOn, setMasksOn] = useState(true)
  const [canvasPicks, setCanvasPicks] = useState(0)
  const inkCache = useRef(createInkCache())
  const [activeRef, setActiveRef] = useState<null | RefBind>(null)
  const keyHooks = useRef<{ nudge?: (e: KeyboardEvent) => boolean; afterArrow?: () => void; poseArrow?: (e: KeyboardEvent) => void; selArrow?: (e: KeyboardEvent) => boolean }>({})
  // moving by keyboard (docs/move-plan.md): the picture's sessions run here, the selection's in interaction;
  // a key run holds the one gesture slot as `KEYS`, so a canvas press meanwhile is ignored and every cancel path ends it
  const KEYS = -1
  /** A slider's thumb key run (docs/slider-plan.md): its own slot id; every rule for a key run applies to it too (dot 1791771773). */
  const SLIDER_KEYS = -2
  const isKeyRun = (g: null | { id: number }) => g?.id === KEYS || g?.id === SLIDER_KEYS
  const picMover = useRef(createMover()).current
  /** The picture's arrows: 1 drawing unit, Shift 10, Option / Ctrl 0.1 — this caller's sizes (bowen 1791769146). */
  const PICTURE_STEPS = { step: 1, long: 10, short: 0.1 }
  /**
   * Playback's arrows turn the view, as the coord grid's point does (bowen 1791768754; docs/keyboard-pose-pan-plan.md):
   * a `move/` key run whose steps — 1°, Shift 10°, Option / Ctrl 0.1° — each move the pose as it is now.
   */
  const poseMover = useRef(createMover()).current
  /** The playback selection's arrows (docs/playback-tools-checklist.md §2): a key run, one correct at its end. */
  const selMover = useRef(createMover()).current
  const POSE_STEPS = { step: 1, long: 10, short: 0.1 }
  const holdKeys = () => {
    if (gesture.current) return
    const cancel = (why: string) => {
      if (gesture.current?.cancel === cancel) gesture.current = null
      if (ix.moving() === 'keys') ix.cancel(); else if (picMover.running) picMover.cancel(); else if (selMover.running) selMover.cancel(); else poseMover.cancel()
      note(`key move cancelled by ${why}`); bump()
    }
    gesture.current = { id: KEYS, right: false, cancel }
  }
  // after every render: a key run that has ended (committed, or ended inside interaction by an undo or a selection change) gives the slot back
  useEffect(() => { if (gesture.current?.id === KEYS && ix.moving() !== 'keys' && picMover.running !== 'keys' && poseMover.running !== 'keys' && selMover.running !== 'keys') gesture.current = null })
  /** A press during a pose key run is not ignored: it ends the run (the pose stays) and acts (dot 1791769205). */
  const endPoseRun = () => { if (gesture.current?.id === KEYS && poseMover.running === 'keys') gesture.current.cancel('a press') }
  // this App's read-only flag and its own logged wrapper: another App mounting, posing or
  // unmounting never touches them (dot 1791686247)
  const posing = useRef(false) // set only by startPose / stopPose, with the pose state
  // picking follows the picture (docs/mask-p3-checklist.md): what the last render drew of each masked line and fill, kept
  // with its drawing and view and dropped by every write, so a click between a write and the next render never uses an
  // old cut (dot 1791907635); interaction asks through env.cut
  const cutRef = useRef<{ core: Core; view: string; lines: Map<string, Area>; fills: Map<string, Area> } | null>(null)
  // 「刚才改了什么」 (§3) for every write made in playback — a correction, a deletion, a view's own edit, a visibility switch
  // (dot 1791978385): the model before it is kept from entering playback and from each write
  const changeBase = useRef<null | { core: Core; model: Model }>(null)
  const noteChange = () => {
    if (!posing.current || !poseRef.current) return
    const now = core.model(), base = changeBase.current
    changeBase.current = { core, model: now }
    if (!base || base.core !== core) return
    const lines = changesBetween(base.model, now, core.snapshot())
    setLastChange({ pose: { ...poseRef.current }, lines: lines[0] === '（没有数据变化）' ? [`（没有改动视角或修正：${log[0]?.calls ?? ''}）`] : lines })
  }
  const logged = useRef(loggedFor(() => (restoringNow.current ? 'locked' : posing.current ? 'playback' : 'edit'), () => { cutRef.current = null; saver.current?.want(); noteChange() }, () => (posing.current ? viewAtPose(poseRef.current) : null))).current
  const svg = useRef<SVGSVGElement>(null)
  // one screen pixel in document units, from the canvas's real size (the viewBox is fitted, so the
  // larger ratio wins); the old fixed 900-pixel width made picking about half as wide as meant
  const [size, setSize] = useState({ w: 900, h: 600 })
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth || 900, h: el.clientHeight || 600 })
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const px = Math.max(box.w / size.w, box.h / size.h)

  const shown = core.views().includes(view) ? view : 'view:0,0'
  const applyFrom = applyFromAt !== null && applyFromAt.core === core && applyFromAt.view === shown
  const setApplyFrom = (on: boolean) => setApplyFromAt(on ? { core, view: shown } : null)
  applyFromOn.current = applyFrom
  // ended, not paused: coming back to that drawing or view does not bring it back (dot 1791879765)
  useEffect(() => { if (applyFromAt && !applyFrom) setApplyFromAt(null) })
  // lines whose front differs from the angle baseline (stage 2): marked on the canvas
  const pending = core.pendingLines()
  // while posing, the drawing is the pose (Core.atPose: read only, drawn through the same reads as a view)
  // at a view (docs/playback-edit-checklist.md §2) playback edits that view: it is drawn and edited as the view itself
  const poseView = viewAtPose(pose), inBetween = !!pose && !poseView
  const posed = (() => { try { return inBetween ? core.atPose(pose!) : null } catch (err) { return err as Error } })()
  // the drawing this frame shows, bound with it during playback: a press on a frame drawn before
  // another App changed the shared drawing must not start a correction (dot 1791697642)
  const frame = useRef<{ core: Core; text: string } | null>(null)
  frame.current = pose || moveRef ? { core, text: save(core) } : null
  const reader = posed && !(posed instanceof Error) ? posed : core.in(poseView ?? shown)
  const s = reader.snapshot(), g = reader.geometry(), zones = reader.zones()
  // the canvas's one selected line or point: the properties panel shows it (J1b)
  const canvasSubject = s.selection.length === 1 && (s.selection[0]!.kind === 'line' || s.selection[0]!.kind === 'point') ? { kind: s.selection[0]!.kind, id: s.selection[0]!.id } : null
  // with the switch on, each visible line's ink (P1: single lines, today's round-capped look); a line whose ink a check
  // flags is still drawn and marked red (visible, reproducible — never hidden); only a line with nothing to draw is drawn
  // as today's stroke (bowen 1791801560 / 1791801629, dot 1791801801)
  const { masksOf, maskCut } = masksOn && inkOn ? masksFor(s, g) : NO_MASKS
  const ink = inkOn ? inkCache.current.build(g, { ...s, zones }, maskCut) : null, inkOf = new Map((ink?.pieces ?? []).map(p => [p.source.id, p] as const))
  const inkDefects = new Map((ink?.diagnostics ?? []).filter(d => d.status === 'defect').map(d => [d.source.id, d.reason ?? ''] as const))
  cutRef.current = posed ? null : { core, view: shown, ...cutsFor(s, g, masksOf, inkOf) }
  // between the views, what the masks leave of each masked line in this frame: playback's picks follow it as editing's do (dot 1791978385)
  const poseCut = posed && !(posed instanceof Error) && masksOn && inkOn ? cutsFor(s, g, masksOf, inkOf).lines : null
  // one visibility rule for the playback drag's picking, its point marks and its ghost, computed once
  // per frame (dot 1791697776; docs/stage3b-pkg5-problems.md): the visible lines and the points they end at
  const shownLines = s.lines.filter(l => l.state.visible), shownEnds = new Set(shownLines.flatMap(l => [l.a, l.b]))
  // the drawing layer falls back to the top layer when the chosen one is gone (deleted, or a file was opened)
  const drawLayer = s.layers.some(l => l.id === layer) ? layer : s.layers[s.layers.length - 1]?.id ?? ''
  // the selected layers that still exist, always with the current one
  const selLayers = [...new Set([...layers.filter(id => s.layers.some(l => l.id === id)), ...(drawLayer ? [drawLayer] : [])])]
  const editView = poseView ?? shown // playback at a view edits that view (§2)
  const env = useRef({ layer: drawLayer, layers: selLayers, px, view: editView, masks: masksOn && inkOn })
  env.current = { layer: drawLayer, layers: selLayers, px, view: editView, masks: masksOn && inkOn }
  const ix = useRef(createInteraction({ core: () => logged(core), view: () => env.current.view, newId: nid, layer: () => env.current.layer || undefined, layers: () => env.current.layers, pixel: () => env.current.px,
    cut: (t, at, reach) => {
      if (!env.current.masks) return false
      let c = cutRef.current
      // dropped by a write (or another drawing or view): computed again from the drawing as it is now, never skipped
      // (dot 1791908685: a width typed and committed by the same press that picks)
      if (!c || c.core !== core || c.view !== env.current.view) {
        const r = core.in(env.current.view), s = r.snapshot(), g = r.geometry(), { masksOf, maskCut } = masksFor(s, g)
        const ink = masksOf.size ? inkCache.current.build(g, { ...s, zones: r.zones() }, maskCut) : null
        c = cutRef.current = { core, view: env.current.view, ...cutsFor(s, g, masksOf, new Map((ink?.pieces ?? []).map(p => [p.source.id, p] as const))) }
      }
      const a = (t.kind === 'line' ? c.lines : c.fills).get(t.id)
      return a !== undefined && (t.kind === 'line' ? maskDistance(a, at) > reach : !maskContains(a, at))
    } })).current
  useEffect(() => ix.subscribe(bump), [ix])
  // autosave: restore first (an Open of the stored text), then save every change in order; a late
  // restore after unmount applies nothing (the package checks its owner)
  useEffect(() => {
    if (!store) return
    const a = createAutosave(store, {
      apply: text => {
        const next = open(text)
        core = next
        const ls = core.snapshot().layers, top = ls[ls.length - 1]?.id ?? ''
        setLayer(top); setLayers([top]); refGen.current++
        ix.drawingChanged(); setDrawing(k => k + 1)
        log.unshift({ calls: 'autosave: restored the saved drawing', result: 'ok' })
      },
      current: () => save(core),
      changed: () => bump(),
    })
    saver.current = a
    let live = true
    void a.start().then(() => { if (!live) return; restoringNow.current = false; setRestoring(false); bump() })
    return () => { live = false; a.dispose(); saver.current = null }
  }, [])
  // every render may follow a change: autosave compares the text and writes only a new one
  useEffect(() => { saver.current?.want() })
  // leaving or refreshing while unsaved asks first (only the last completed save is kept)
  useEffect(() => {
    const ask = (e: BeforeUnloadEvent) => { if (saver.current?.unsaved()) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [])
  const pv: Preview = ix.preview()
  const pvPoints = new Set(pv.points) // the points interaction shows (and so can hit) for this tool

  const line = (id: Id) => s.lines.find(l => l.id === id)!
  const pos = (id: Id) => s.points.find(p => p.id === id)!.position
  // only the selection on the selected layers is shown selected and acted on (docs/layer-scope-plan.md §3)
  const sel = ix.selection()
  const selLines = sel.flatMap(u => (u.kind === 'line' ? [u.id] : []))
  const groupOf = (l: Id) => s.groups.find(gr => gr.lines.includes(l))?.id
  const opts = ix.options()

  useEffect(() => {
    ;(window as unknown as { bench: unknown }).bench = { core, ix, refresh: bump, pose: () => pose, view: () => env.current.view, chooseView: (k: string) => chooseView(k), scope: () => ({ layer: env.current.layer, layers: [...env.current.layers] }), svg: () => svg.current?.outerHTML, log, edit: (fn: (e: Editor) => void) => logged(core).edit(fn), demo: () => { demo(); ix.historyChanged(); bump() }, v2Eye: () => { v2Eye(); ix.historyChanged(); bump() } }
  })

  /** A one-shot panel command: straight to core, then interaction checks its unfinished operations (doc 22 §3.5). */
  /** The picture a binding names, if the drawing, the counter, the view's list and its source still hold. */
  /** The pictures this mode shows: playback's own while posing (§5), else the current view's. */
  const refsHere = () => (posing.current ? core.playbackReferences() : core.in(shown).references())
  const refNow = (b: RefBind | null) => (b && b.core === core && b.gen === refGen.current ? refsHere().find(r => r.id === b.id && r.src === b.src) : undefined)
  const SETTABLE = ['x', 'y', 'scale', 'angle', 'opacity', 'visible', 'flipped'] as const
  const sameBase = (a: ReferenceImage, b: ReferenceImage) => SETTABLE.every(k => a[k] === b[k])
  /** A live change of one picture, drawn but not written (§8.1). */
  const previewRef = (r: ReferenceImage, props: ReferenceProps) => {
    const p = previewNow.current
    const next = p && p.id === r.id && refNow(p) ? { ...p, props: { ...p.props, ...props } } : { core, gen: refGen.current, id: r.id, src: r.src, base: r, props }
    previewNow.current = next; setRefPreview(next)
  }
  /** The preview ends once: written if its picture is unchanged underneath, else dropped (§8a.1). */
  const commitPreview = () => {
    const p = previewNow.current
    if (!p) return
    previewNow.current = null; setRefPreview(null)
    const now = refNow(p)
    if (!now || !sameBase(now, p.base)) { note('reference change dropped: the picture changed underneath'); bump(); return }
    run(x => x.setReference(p.id, p.props))
  }
  const cancelPreview = () => { previewNow.current = null; setRefPreview(null) }
  /**
   * The one ending of a control acting on a picture (§10; dot 1791725888, ledger row 16): (1) the binding made
   * when the control was drawn — drawing, counter, picture id and source — must still find that picture,
   * otherwise the whole action is dropped (dot 1791717696); (2) a running gesture is cancelled by its one
   * cancel path, listeners and ghost with it (dot 1791717672); (3) a panel preview ends by its one ending,
   * written if unchanged underneath; (4) the picture is read again and the action done with those values
   * (so a previewed angle, then 存, saves the angle just written; dot 1791717133).
   */
  const refAct = (b: RefBind, what: string, act: (r: ReferenceImage) => void) => {
    if (!refNow(b)) { note(`${what} dropped: the picture is no longer the one shown`); bump(); return }
    endOpenField() // an open field ends by its own ending (its typed value written), never written again by a late blur
    gesture.current?.cancel(what)
    commitPreview()
    const r = refNow(b)
    if (r) act(r)
  }
  /** Mirror ⇆ (§9): what is seen, flipped left-right about the picture's centre — flipped toggled, angle negated. */
  const mirrorRef = (b: RefBind) => refAct(b, 'Mirror', r => run(x => x.setReference(r.id, { flipped: !r.flipped, angle: 0 - r.angle })))
  /** A library picture as a control drew it (§10): the same drawing and counter, the entry with the same id and content. */
  const libNow = (b: RefBind) => (b.core === core && b.gen === refGen.current ? core.library().find(a => a.id === b.id && a.src === b.src) : undefined)
  /** The same one ending for a library control, bound to its entry. */
  const libAct = (b: RefBind, what: string, act: (a: AssetUse) => void) => {
    if (!libNow(b)) { note(`${what} dropped: the library picture is no longer the one shown`); bump(); return }
    endOpenField()
    gesture.current?.cancel(what)
    commitPreview()
    const a = libNow(b)
    if (a) act(a)
  }
  /** A picture file read and decoded, then handed on only if this App's counter and the drawing still hold (§7.1). */
  const readPicture = (f: File, done: (pic: { src: string; width: number; height: number }) => void) => {
    const start = { gen: refGen.current, core, text: save(core) }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result), pic = new Image()
      pic.onload = () => {
        if (start.gen !== refGen.current || start.core !== core || save(core) !== start.text) { note(`picture ${f.name} dropped: the drawing, view or mode changed while it was read`); bump(); return }
        done({ src, width: pic.width, height: pic.height })
      }
      pic.onerror = () => { note(`picture ${f.name} not added: it does not decode`); bump() }
      pic.src = src
    }
    reader.readAsDataURL(f)
  }
  const run = (fn: (e: Editor) => void) => {
    // the outcome goes to interaction, the one owner of feedback (dot 1791551067)
    try { logged(core).editIn(env.current.view, fn); ix.outcome(); return true }
    catch (err) { ix.outcome(err); return false }
    finally { bump() }
  }
  /** The panel changed the selected layers; the selection elsewhere simply goes inert (docs/layer-scope-plan.md §3). */
  const selectLayers = (ids: Id[], current: Id) => { if (isKeyRun(gesture.current)) gesture.current!.cancel('a layer scope change'); setLayers(ids); setLayer(current); setPbSel(v => (v.ids.length ? { core, ids: [] } : v)) }
  const toDoc = (e: { clientX: number; clientY: number }) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse())
    return P(p.x, p.y)
  }
  const mods = (e: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) => ({ shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey })

  // A gesture (a tool's drag, or a pan) follows the pointer on the whole window, not pointer
  // capture: bowen's log showed capture lost before any release reached the canvas, which ended
  // the drag (inbox #7; bowen 1791552361; the root cause is not confirmed, dot 1791552536).
  // One gesture at a time, tracked on the window from press to release (start, end and unmount
  // in one place; dot 1791552536, 1791552771). It belongs to the pointer and the button that
  // started it: other pointers are ignored, and it is released when that button is no longer
  // held (its pointerup, or a move whose buttons lack it: the up was missed). pointercancel for
  // that pointer, Esc and leaving the window cancel it; so does unmounting.
  // `cancel` is the one way a gesture ends without a release: it stops the window tracking and
  // ends the drag in interaction (a pan simply stops) — never only one of the two (dot 1791552803)
  // `right` marks a right-button pan, whose own release (unmoved) is the right click (bowen 1791554290)
  const gesture = useRef<null | { id: number; right: boolean; cancel: (why: string) => void }>(null)
  // where the pointer rests over the canvas (no button held), in screen coordinates — a pan or zoom maps it anew
  // (dot 1791737579) — with its modifiers; the hover is asked again after every render and on Shift / Option
  const hoverAt = useRef<{ clientX: number; clientY: number; mods: ReturnType<typeof mods> } | null>(null)
  // a press the tool took is held: the canvas cursor asks cursor/ with it (A / V grab). Set where the
  // gesture starts, cleared in its one `stop` (release, cancel, blur, tool change, playback) (dot 1791708548)
  const [pressed, setPressed] = useState(false)
  // what a press on the canvas does, named for the cursor table in the same order as the canvas routes
  // the press: Zoom (a viewport tool) in every mode; else restoring takes none, playback drags the pose,
  // Move picture moves the picture, otherwise the tool; those three show the arrow (dot 1791710244, 1791727663)
  const boxShown = !inBetween && !restoring && !moveRef && !!pv.selectionBox
  const boxHot = boxShown ? pv.selectionBox?.hot ?? null : null
  // the resting pointer asked again — after every render (a tool, view, selection, pan or zoom change) and on Shift / Option
  const rehover = useRef(() => {})
  rehover.current = () => {
    const h = hoverAt.current
    if (h && !gesture.current && !inBetween && !restoring && !moveRef && !zoomTool) ix.pointerHover(toDoc(h), h.mods)
  }
  useEffect(() => { rehover.current() })
  const pressTakenBy = zoomTool ? 'Z' : restoring ? 'restoring' : inBetween || (pose && ix.tool !== 'A' && ix.tool !== 'V') ? 'playback' : moveRef ? 'movePicture' : boxHot ? `box:${boxHot}` : ix.tool
  const note = (what: string) => { log.unshift({ calls: what, result: 'ok (diagnostic)' }); log.length = Math.min(log.length, 50) }
  const BUTTON_BIT = [1, 4, 2] // button 0 → buttons bit 1 (left), 1 → 4 (middle), 2 → 2 (right)
  const CLICK = 2 // screen px a press may move and still be a click (v1: 7205381 DrawingRoom zoom)
  const onDown = (e: React.PointerEvent) => {
    endOpenField()
    endPoseRun()
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return // another pointer while a gesture runs: ignored
      gesture.current.cancel('a new press of the same pointer') // its earlier release was missed
    }
    const id = e.pointerId, bit = BUTTON_BIT[e.button] ?? 1, start = P(e.clientX, e.clientY), from = box, at = toDoc(e)
    // what this press is (bowen 1791554290, 1791554415): right or middle drags the canvas, and an
    // unmoved right press is the right click (cancel one level); with Z, the left button zooms;
    // otherwise the tool gets the press, and a press that hits nothing only clears the selection
    const kind = e.button === 1 || e.button === 2 ? 'pan' : zoomTool ? 'zoom' : ix.pointerDown(at, mods(e)) ? 'tool' : null
    // A or V picked a line (a line already selected included): the labels follow the tool. A point, a handle or
    // nothing picked changes nothing (dot 1791732824); what was picked is the interaction's, not decided here
    if (kind === 'tool' && (ix.tool === 'A' || ix.tool === 'V') && ix.lastPress() === 'line') setLabelKind(ix.tool === 'A' ? 'line' : 'curve')
    // every canvas pick of a line or a point counts, even of the object already picked: the properties panel shows the last pick (dot)
    if (kind === 'tool' && (ix.tool === 'A' || ix.tool === 'V') && (ix.lastPress() === 'line' || ix.lastPress() === 'point')) setCanvasPicks(n => n + 1)
    if (!kind) return
    let moved = false
    const zoomBy = (k: number) => setBox({ x: at.x - (at.x - from.x) * k, y: at.y - (at.y - from.y) * k, w: from.w * k, h: from.h * k })
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & bit) === 0) { if (kind === 'tool') note('release found by a move without the starting button held (pointerup missed)'); release(ev); return }
      if (kind === 'tool') { ix.pointerMove(toDoc(ev), mods(ev)); return }
      follow(ev)
    }
    /** Pan or zoom to where the pointer is; also run on release, so a release far away with no move between is a drag, not a click (dot 1791554963). */
    const follow = (ev: PointerEvent) => {
      moved ||= Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > CLICK
      if (!moved) return
      if (kind === 'pan') { const k = from.w / svg.current!.clientWidth; setBox({ ...from, x: from.x - (ev.clientX - start.x) * k, y: from.y - (ev.clientY - start.y) * k }) }
      else zoomBy(Math.exp((ev.clientY - start.y) * 0.008)) // up zooms in, down zooms out (v1's rate)
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      stop()
      if (kind === 'tool') { ix.pointerUp(toDoc(ev), mods(ev)); return }
      follow(ev)
      if (!moved && kind === 'zoom') zoomBy(ev.altKey || ev.ctrlKey ? 1.3 : 1 / 1.3) // a click zooms in ×1.3, Alt / Ctrl-click out (v1)
      else if (!moved && e.button === 2) ix.cancel() // the right click
    }
    // a cancelled pan or zoom puts the view back where it started (v1: cancelViewport)
    const cancelWith = (why: string) => { stop(); if (kind === 'tool') { if (ix.preview().drag) note(`drag cancelled by ${why}`); ix.pointerCancel() } else setBox(from) }
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('pointercancel') }
    const onBlur = () => cancelWith('leaving the window')
    // a new press of the same pointer anywhere on the page, another App included, ends this gesture:
    // its window listeners would otherwise still act on that press's release (dot 1791696828)
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('a new press of the same pointer') }
    const stop = () => {
      setPressed(false)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', onCancel); window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onOtherDown, true)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: e.button === 2, cancel: cancelWith }
    if (kind === 'tool') setPressed(true)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', onCancel); window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onOtherDown, true)
  }
  /**
   * A drag during playback (stage 3b package 5, docs/stage3b-pkg5-bench-drag.md): only on a line,
   * a visible point within reach; the press binds the drawing, the pose, the point and its start
   * (dot 1791696808); the target is the start plus the pointer's displacement; on release one
   * `correct` edit, unless the drawing changed meanwhile. The same one gesture slot and cancel path.
   */
  /**
   * Move picture (§8.2): a press on a visible picture of this view (topmost first, inside its rotated
   * rectangle) drags it; preview at start + displacement, one setReference on release unless the
   * drawing changed. Lines are never picked while the mode is on.
   */
  const onRefDown = (e: React.PointerEvent) => {
    endOpenField()
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return
      gesture.current.cancel('a new press of the same pointer')
    }
    if (e.button !== 0) return
    const shownFrom = frame.current
    if (!shownFrom || shownFrom.core !== core || shownFrom.text !== save(core)) { note('press ignored: the drawing changed since this frame was drawn; redrawn'); bump(); return }
    const at = toDoc(e)
    const inside = (r: ReferenceImage) => {
      const a = -r.angle * Math.PI / 180, dx = at.x - r.x, dy = at.y - r.y
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a)
      return Math.abs(lx) <= r.width * r.scale / 2 && Math.abs(ly) <= r.height * r.scale / 2
    }
    const hit = [...refsHere()].reverse().find(r => r.visible && inside(r))
    if (!hit) return
    const bind = { core: shownFrom.core, gen: refGen.current, id: hit.id, src: hit.src }
    setActiveRef(bind)
    cancelPreview()
    const id = e.pointerId, pressed = P(e.clientX, e.clientY)
    let moved = false, done = false
    // the drag is a move/ session (docs/move-plan.md): its offset the pointer's displacement, one setReference at the end;
    // it commits only if the whole drawing is still the frame pressed on (as before)
    picMover.press(pictureTarget(hit, bind, () => core === shownFrom.core && save(core) === shownFrom.text, 'picture move cancelled: the drawing changed during the drag'), at)
    const travel = (ev: PointerEvent) => { moved ||= Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & 1) === 0) { release(ev); return }
      travel(ev)
      if (moved) picMover.drag(toDoc(ev))
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      travel(ev)
      stop()
      if (!moved) { picMover.cancel(); return } // a click only makes the picture active
      picMover.release(toDoc(ev))
    }
    const cancelWith = (why: string) => { if (done) return; picMover.cancel(); stop(); note(`picture move cancelled by ${why}`); bump() }
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('pointercancel') }
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('a new press of the same pointer') }
    const onBlur = () => cancelWith('leaving the window')
    const onMenu = () => cancelWith('a right click')
    const listeners: [string, (ev: PointerEvent) => void][] = [['pointermove', move], ['pointerup', release], ['pointercancel', onCancel], ['blur', onBlur], ['contextmenu', onMenu]]
    const stop = () => {
      done = true
      for (const [t, f] of listeners) window.removeEventListener(t, f as EventListener)
      window.removeEventListener('pointerdown', onOtherDown, true)
      previewNow.current = null; setRefPreview(null)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: false, cancel: cancelWith }
    for (const [t, f] of listeners) window.addEventListener(t, f as EventListener)
    window.addEventListener('pointerdown', onOtherDown, true)
  }
  /**
   * The picture as a move target (docs/move-plan.md): bound to the picture as drawn; the preview is start +
   * offset, never written; one setReference at the end, only if `still()` holds and the picture is the one
   * bound and unchanged underneath (§8a), else dropped with `why`.
   */
  function pictureTarget(r: ReferenceImage, bind: RefBind, still: () => boolean, why: string): Target {
    const at = (o: { x: number; y: number }) => ({ x: r.x + o.x, y: r.y + o.y })
    const clear = () => { previewNow.current = null; setRefPreview(null) }
    return {
      begin: () => true,
      preview: o => { const next = { ...bind, base: r, props: at(o) }; previewNow.current = next; setRefPreview(next) },
      commit: o => {
        clear()
        const now = refNow(bind)
        if (!still() || !now || !sameBase(now, r)) { note(why); bump(); return }
        run(x => x.setReference(r.id, at(o)))
      },
      cancel: clear,
    }
  }
  /**
   * Arrow keys while Move picture is on (§8.2, §8a.2): a key run on the active picture — Shift ×10, Option or
   * Ctrl ×0.1, one undo step for the whole run (bowen 1791733125, 1791733775) — never reaching lines.
   */
  keyHooks.current.nudge = (e: KeyboardEvent) => {
    if (!moveRef || !isArrow(e.key)) return false
    if (e.metaKey && !e.ctrlKey) return false // ⌘ + arrow is not a move, as for the selection (dot 1791734673)
    e.preventDefault()
    if (gesture.current && gesture.current.id !== KEYS) return true // a drag runs: one session at a time
    if (!picMover.running && previewNow.current) return true // a panel preview is open
    picMover.keyDown(() => { const r = refNow(activeRef); return r ? pictureTarget(r, { core, gen: refGen.current, id: r.id, src: r.src }, () => true, 'picture move dropped: the picture changed underneath') : undefined },
      { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, PICTURE_STEPS)
    if (picMover.running === 'keys') holdKeys()
    return true
  }
  /** The selection's arrows (with V / A): interaction runs them; the bench gives the run the one gesture slot. */
  keyHooks.current.afterArrow = () => { if (ix.moving() === 'keys') holdKeys() }
  type PlaybackPick = { kind: 'points'; starts: Record<Id, Vec> } | { kind: 'handle'; line: Id; end: 'a' | 'b'; tip: Vec; point: Vec }
  /** The nearest visible line within the line reach, in this frame's geometry (V's press, A's hover). */
  // the hovered line, only while it is a visible line of a selected layer: a scope change drops it (dot 1791978817)
  const hoverLine = poseHover ? shownLines.find(l => l.id === poseHover && selLayers.includes(s.points.find(p => p.id === l.a)?.layer ?? '')) : undefined
  useEffect(() => { if (poseHover && !hoverLine) setPoseHover(null) })
  const shownLineAt = (at: Vec): Id | null => {
    // editing's rules (dot 1791978385): only the selected layers' visible lines; a masked line by what is drawn of it
    const layerOf = new Map(s.points.map(p => [p.id, p.layer]))
    const ids = new Set(shownLines.filter(l => selLayers.includes(layerOf.get(l.a) ?? '')).map(l => l.id))
    const dist = (G: { id: Id; curve: readonly Vec[] }) => { const cut = poseCut?.get(G.id); return cut ? maskDistance(cut, at) : curveDistance(G.curve, at) }
    const hit = g.lines.filter(G => ids.has(G.id)).map(G => ({ id: G.id, d: dist(G) })).filter(x => x.d <= REACH.line * px).sort((a, b) => a.d - b.d)[0]
    return hit?.id ?? null
  }
  /**
   * What a playback press takes (docs/playback-edit-checklist.md §2): with A, a handle of the hovered line, else a visible
   * line's end point; with V, the nearest visible line's whole curve (its group, else the line), all its end points.
   */
  const playbackPick = (at: Vec): PlaybackPick | null => {
    if (ix.tool === 'A') {
      // the nearest within reach: a visible line's end point, or a handle of the hovered line; a tie goes to the point
      // (a handle of zero length sits on its point)
      const cands: { d: number; rank: number; pick: PlaybackPick }[] = s.points.filter(p => shownEnds.has(p.id) && selLayers.includes(p.layer))
        .map(p => ({ d: Math.hypot(p.position.x - at.x, p.position.y - at.y), rank: 0, pick: { kind: 'points', starts: { [p.id]: p.position } } as PlaybackPick }))
        .filter(x => x.d <= REACH.point * px)
      const hl = hoverLine
      if (hl) for (const end of ['a', 'b'] as const) {
        const point = pos(end === 'a' ? hl.a : hl.b), tip = add(point, end === 'a' ? hl.ha : hl.hb), d = Math.hypot(tip.x - at.x, tip.y - at.y)
        if (d <= REACH.handle * px) cands.push({ d, rank: 1, pick: { kind: 'handle', line: hl.id, end, tip, point } })
      }
      return cands.sort((a, b) => a.d - b.d || a.rank - b.rank)[0]?.pick ?? null
    }
    const line = shownLineAt(at)
    if (!line) return null
    const ids = s.groups.find(gr => gr.lines.includes(line))?.lines ?? [line]
    const ends = new Set(ids.flatMap(id => { const l = s.lines.find(x => x.id === id)!; return [l.a, l.b] }))
    return { kind: 'points', starts: Object.fromEntries([...ends].map(id => [id, pos(id)])) }
  }
  /**
   * A press at a correction pose (docs/playback-tools-checklist.md §1–§4): the playback selection's box handles scale or
   * rotate it, its inside moves it; else A / V pick (Shift toggles into the selection) and drag; on nothing, a box selects
   * by editing's rules. Every drag computes `correct` targets from the pose's stored values; each frame previews the very
   * correct through `core.previewAt`; the release writes it once, unless the preview was refused or anything changed.
   */
  const onPoseDown = (e: React.PointerEvent) => {
    endOpenField()
    endPoseRun()
    if (gesture.current) {
      if (gesture.current.id !== e.pointerId) return
      gesture.current.cancel('a new press of the same pointer')
    }
    setCorrRefusal(null)
    if (e.button !== 0 || !pose || !posed || posed instanceof Error || !correctionPose(pose) || (ix.tool !== 'A' && ix.tool !== 'V' && ix.tool !== 'deform')) return
    const shownFrom = frame.current
    if (!shownFrom || shownFrom.core !== core || shownFrom.text !== save(core)) { note('playback press ignored: the drawing changed since this frame was drawn; redrawn'); bump(); return }
    const at = toDoc(e), snap = s, geo = g, poseNow = { ...pose }
    // 四角 / 曲边 (§2): a press on the frame's corner, handle or midpoint drags it, as editing's deform; the targets from the frozen curves
    let frameNext: null | { quad: Quad; bend: Bend } = null
    const dfm = ix.tool === 'deform' ? pbDeform : null
    if (ix.tool === 'deform') {
      if (!dfm || dfm.core !== core || dfm.text !== shownFrom.text) return // a frame from another drawing is never dragged
      const f = frameOf(dfm.rect, dfm.quad, dfm.bend), r = FRAME.reach * px
      const near = <T extends { at: Vec }>(xs: T[]) => xs.map(x => ({ x, d: Math.hypot(x.at.x - at.x, x.at.y - at.y) })).filter(c => c.d <= r).sort((p, q) => p.d - q.d)[0]?.x
      const c = near(f.corners.map((q, i) => ({ i, at: q }))), h = c ? undefined : near(f.handles), m = c || h ? undefined : near(f.midpoints)
      const control: FrameControl | null = c ? { corner: c.i } : h ? { edge: h.edge, handle: h.handle } : m ? { edge: m.edge, handle: 2 } : null
      if (!control) return
      startBatch(e, at, snap, geo, poseNow, shownFrom, now => { frameNext = dragFrame(dfm.rect, dfm.quad, dfm.bend, control, at, now); return deformTargets(dfm.lines, dfm.rect, frameNext.quad, frameNext.bend) },
        () => { const n = frameNext; if (n) setPbDeform(v => (v === dfm ? { ...dfm, quad: n.quad, bend: n.bend, text: save(core) } : v)) })
      return
    }
    const sel = pbSel.core === core ? pbSel.ids : [], bounds = boundsOf(snap, sel)
    const hit = bounds ? hitBox(bounds, at, px) : null
    // what this press does: a target function of the pointer, or a box selection
    // editing's order (select-transform pressHit; dot 1791982484): A's points and handles first, then a box handle, then
    // what the tool picks, then the inside of the box unless Shift / Option ask for the marquee that adds / removes
    let targetsOf: ((now: Vec, m: { alt?: boolean; shift?: boolean }) => Targets) | null = null
    const pick = playbackPick(at)
    if (!(ix.tool === 'A' && pick) && hit && hit !== 'inside') { const d = startHandleDrag(hit, bounds!, at, px); targetsOf = (now, m) => boxTargets(snap, sel, opAt(d, now, m)) }
    else if (pick) {
      if (pick.kind === 'handle') targetsOf = now => ({ points: [], handles: [{ line: pick.line, end: pick.end, vector: P(pick.tip.x + now.x - at.x - pick.point.x, pick.tip.y + now.y - at.y - pick.point.y) }] })
      else if (pick) {
        const ids = Object.keys(pick.starts)
        if (e.shiftKey || e.altKey) { // Shift toggles them in the selection, Option removes them; no drag
          const on = e.altKey || ids.every(id => sel.includes(id))
          setPbSel({ core, ids: on ? sel.filter(id => !ids.includes(id)) : [...new Set([...sel, ...ids])] }); return
        }
        const take = ids.every(id => sel.includes(id)) ? sel : ids
        if (take !== sel) setPbSel({ core, ids: take })
        targetsOf = now => moveTargets(snap, take, P(now.x - at.x, now.y - at.y), opts.follow)
      }
    }
    else if (hit === 'inside' && !e.shiftKey && !e.altKey) targetsOf = now => moveTargets(snap, sel, P(now.x - at.x, now.y - at.y), opts.follow)
    startBatch(e, at, snap, geo, poseNow, shownFrom, targetsOf, null, sel)
  }
  /** A playback batch gesture (§2–§4): a drag whose targets `targetsOf` gives, previewed by the release's own correct; or, with none, a box selection. */
  function startBatch(e: React.PointerEvent, at: Vec, snap: Snapshot, geo: ReturnType<PoseReader['geometry']>, poseNow: Pose, shownFrom: { core: Core; text: string },
    targetsOf: ((now: Vec, m: { alt?: boolean; shift?: boolean }) => Targets) | null, onWritten: (() => void) | null, sel: readonly Id[] = []) {
    const id = e.pointerId, pressed = P(e.clientX, e.clientY), tool = ix.tool
    const posedNow = posed as PoseReader
    let moved = false, done = false, last: { targets: Targets; refused: boolean } | null = null
    const travel = (ev: PointerEvent) => { moved ||= Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK }
    const modsOf = (ev: PointerEvent) => ({ alt: ev.altKey, shift: ev.shiftKey })
    /** One preview frame: the release's correct tried on a draft and read at the pose; the ghost is what differs. */
    const preview = (ev: PointerEvent) => {
      const targets = targetsOf!(toDoc(ev), modsOf(ev))
      try {
        const r = core.previewAt(poseNow, x => x.correct(poseNow, targets))
        if (!r) { last = { targets, refused: true }; setBatchGhost(null); return }
        const gg = r.geometry(), was = new Map(geo.lines.map(l => [l.id, JSON.stringify(l.curve)])), wasArc = new Map(geo.arcs.map(a => [a.key, JSON.stringify(a.curve)]))
        last = { targets, refused: false }
        setCorrRefusal(null)
        // the frame's one visibility rule (dot 1791697776): only visible lines have a ghost
        const shown = new Set(shownLines.map(l => l.id))
        setBatchGhost({ lines: gg.lines.filter(l => shown.has(l.id) && was.get(l.id) !== JSON.stringify(l.curve)).map(l => ({ id: l.id, curve: l.curve })), arcs: gg.arcs.filter(a => wasArc.get(a.key) !== JSON.stringify(a.curve)).map(a => ({ key: a.key, curve: a.curve })), points: targets.points })
      } catch (err) {
        last = { targets, refused: true }
        setBatchGhost(null)
        setCorrRefusal({ message: (err as Error).message, objects: err instanceof Refusal ? err.objects : [] })
      }
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if ((ev.buttons & 1) === 0) { release(ev); return }
      travel(ev)
      if (!moved) return
      if (targetsOf) preview(ev)
      else setPbBox({ from: at, to: toDoc(ev) })
    }
    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      travel(ev)
      stop()
      if (!targetsOf) { // a box selection, by editing's rules (dot 1791981083): right = wholly inside, left = touched; Shift adds, Alt removes
        if (!moved) { if (!ev.shiftKey) setPbSel({ core, ids: [] }); return }
        const to = toDoc(ev), layerOf = new Map(snap.points.map(q => [q.id, q.layer]))
        const lines = posedNow.linesInRect(at, to, to.x >= at.x)
          .map(lid => snap.lines.find(l => l.id === lid)!).filter(l => l.state.visible && selLayers.includes(layerOf.get(l.a) ?? ''))
        const whole = tool === 'V' ? lines.flatMap(l => snap.groups.find(gr => gr.lines.includes(l.id))?.lines ?? [l.id]) : lines.map(l => l.id)
        const ids = [...new Set(whole.flatMap(lid => { const l = snap.lines.find(x => x.id === lid)!; return [l.a, l.b] }))]
        setPbSel({ core, ids: ev.altKey ? sel.filter(x => !ids.includes(x)) : ev.shiftKey ? [...new Set([...sel, ...ids])] : ids })
        return
      }
      if (!moved) return
      if (core !== shownFrom.core || save(core) !== shownFrom.text) { note('playback drag cancelled: the drawing changed during the drag'); bump(); return }
      const p0 = poseRef.current
      if (!p0 || p0.yaw !== poseNow.yaw || p0.pitch !== poseNow.pitch) { note('playback drag cancelled: the pose changed during the drag'); bump(); return }
      preview(ev) // the release's own frame
      setBatchGhost(null) // the ghost ends with the drag
      if (!last || last.refused) { bump(); return } // a refused preview writes nothing; its reason stays in the status line
      const targets = last.targets
      try { logged(core).edit(x => x.correct(poseNow, targets)); onWritten?.() }
      catch (err) { setCorrRefusal({ message: (err as Error).message, objects: err instanceof Refusal ? err.objects : [] }) }
      setPbSel(v => ({ ...v, core })) // the same points stay picked through the write (dot 1791980846)
      bump()
    }
    const cancelWith = (why: string) => { if (done) return; stop(); note(`playback drag cancelled by ${why}`); bump() }
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('pointercancel') }
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId === id) cancelWith('a new press of the same pointer') }
    const onBlur = () => cancelWith('leaving the window')
    const onMenu = () => cancelWith('a right click')
    const listeners: [string, (ev: PointerEvent) => void][] = [['pointermove', move], ['pointerup', release], ['pointercancel', onCancel], ['blur', onBlur], ['contextmenu', onMenu]]
    const stop = () => {
      done = true
      for (const [t, f] of listeners) window.removeEventListener(t, f as EventListener)
      window.removeEventListener('pointerdown', onOtherDown, true)
      setBatchGhost(null); setPbBox(null)
      if (gesture.current?.cancel === cancelWith) gesture.current = null
    }
    gesture.current = { id, right: false, cancel: cancelWith }
    for (const [t, f] of listeners) window.addEventListener(t, f as EventListener)
    window.addEventListener('pointerdown', onOtherDown, true)
  }
  useEffect(() => () => gesture.current?.cancel('unmounting'), []) // unmounting ends any gesture
  // playback moving onto or off a view changes the view interaction edits (§2): what it holds for one view ends, as a view change does
  const lastEditView = useRef(editView)
  useEffect(() => { if (lastEditView.current !== editView) { lastEditView.current = editView; ix.viewChanged() } })
  /** A view change ends any gesture and what interaction holds for one view (step 7); not an edit. */
  const chooseView = (k: string) => {
    gesture.current?.cancel('a view change')
    env.current = { ...env.current, view: k }
    refGen.current++
    setView(k); ix.viewChanged()
  }
  /**
   * Playback (stage 3a): entering ends any gesture (its window listeners go with it) and every
   * unfinished operation in interaction, at every level; then nothing writes until leaving.
   */
  const startPose = () => {
    gesture.current?.cancel('entering playback')
    ix.cancelAll(); setApplyFrom(false)
    posing.current = true; poseGen.current++; refGen.current++
    changeBase.current = { core, model: core.model() }
    const [yaw, pitch] = shown.slice('view:'.length).split(',').map(Number)
    setPose({ yaw: yaw!, pitch: pitch! }); setCorrRefusal(null)
  }
  const stopPose = () => { gesture.current?.cancel('leaving playback'); refGen.current++; posing.current = false; changeBase.current = null; setPose(null); setCorrRefusal(null); setLastChange(null); setPoseHover(null); setPbSel({ core, ids: [] }) }
  /** A valid pose change ends a playback drag first: a target belongs to one pose (dot 1791696847). */
  /**
   * The one update of a pose that takes effect (dot 1791727663, 1791727680): the pose and both number fields
   * together, so the pad, the sliders and the fields agree. Its source decides what it cancels: the pad's own
   * updates during its drag never cancel that drag; any other source (a slider, a field) ends a running
   * gesture first — a correction drag (dot 1791696847) or a pad drag. A field being typed into keeps its text.
   */
  const changePose = (next: { yaw: number; pitch: number }, source: 'pad' | 'keys' | 'slider' | 'yaw-field' | 'pitch-field') => {
    // the pad's and the keys' own steps never end their own gesture; any other source ends a running one
    if (source !== 'pad' && source !== 'keys' && source !== 'slider') gesture.current?.cancel('a pose change')
    setCorrRefusal(null); setPose(next)
    setPbSel(v => (v.ids.length ? { core, ids: [] } : v)) // a pose change clears the playback selection (§1)
  }
  const LIMITS = { yaw: 90, pitch: 45 } as const
  /**
   * The decimal places of a number (up to 20), so a step adds without a float tail and without losing the pose's own
   * decimals; a number with more (no short decimal form) is added as it is, at plain JS precision (dot 1791770081).
   */
  const places = (n: number) => { for (let d = 0; d <= 20; d++) if (Number(n.toFixed(d)) === n) return d; return Infinity }
  const SHORT_PLACES = places(POSE_STEPS.short)
  /**
   * The pose's key run (docs/keyboard-pose-pan-plan.md §1): each preview is turned into the step it adds and applied to
   * the pose as it is now, on the moved axis only, clamped — no dead travel at a limit (dot 1791769205); ending keeps
   * the last pose (commit and cancel alike), as the grid does.
   */
  const poseTarget = (): Target | undefined => {
    if (!poseRef.current) return undefined
    let last = { x: 0, y: 0 }
    const sum = (v: number, d: number) => { const p = Math.max(places(v), SHORT_PLACES); return p <= 20 ? Number((v + d).toFixed(p)) : v + d }
    const add = (v: number, d: number, limit: number) => (d === 0 ? v : Math.max(-limit, Math.min(limit, sum(v, d))))
    return {
      begin: () => true,
      preview: o => {
        const now = poseRef.current
        const dx = Number((o.x - last.x).toFixed(SHORT_PLACES)), dy = Number((o.y - last.y).toFixed(SHORT_PLACES))
        last = o
        if (!now) return
        const next = { yaw: add(now.yaw, dx, LIMITS.yaw), pitch: add(now.pitch, -dy, LIMITS.pitch) } // ↑ is +pitch: the grid's top is +45
        if (next.yaw === now.yaw && next.pitch === now.pitch) return
        poseRef.current = next
        changePose(next, 'keys')
      },
      commit: () => {},
      cancel: () => {},
    }
  }
  keyHooks.current.selArrow = (e: KeyboardEvent) => {
    const p0 = poseRef.current
    if (!p0 || !correctionPose(p0) || pbSel.core !== core || !pbSel.ids.length) return false // no selection: the arrows turn the pose
    const ids = pbSel.ids, poseNow = { ...p0 }, start = core
    const target = (): Target => {
      const snap = core.atPose(poseNow).snapshot(), was = core.atPose(poseNow).geometry()
      const tried = (o: Vec) => { const targets = moveTargets(snap, ids, o, opts.follow); return { targets, reader: core.previewAt(poseNow, x => x.correct(poseNow, targets)) } }
      return {
        begin: () => true,
        preview: o => {
          try {
            const { reader } = tried(o), gg = reader?.geometry()
            const wl = new Map(was.lines.map(l => [l.id, JSON.stringify(l.curve)]))
            const shown = new Set(core.atPose(poseNow).snapshot().lines.filter(l => l.state.visible).map(l => l.id))
            setBatchGhost(gg ? { lines: gg.lines.filter(l => shown.has(l.id) && wl.get(l.id) !== JSON.stringify(l.curve)).map(l => ({ id: l.id, curve: l.curve })), arcs: [], points: tried(o).targets.points } : null)
          } catch (err) { setBatchGhost(null); setCorrRefusal({ message: (err as Error).message, objects: err instanceof Refusal ? err.objects : [] }) }
        },
        commit: o => {
          setBatchGhost(null)
          const p1 = poseRef.current
          if (core !== start || !p1 || p1.yaw !== poseNow.yaw || p1.pitch !== poseNow.pitch) { note('selection nudge dropped: the drawing or the pose changed'); bump(); return }
          try { const { targets } = tried(o); logged(core).edit(x => x.correct(poseNow, targets)) }
          catch (err) { setCorrRefusal({ message: (err as Error).message, objects: err instanceof Refusal ? err.objects : [] }) }
          bump()
        },
        cancel: () => setBatchGhost(null),
      }
    }
    selMover.keyDown(target, { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, PICTURE_STEPS)
    if (selMover.running === 'keys') holdKeys()
    return true
  }
  keyHooks.current.poseArrow = (e: KeyboardEvent) => {
    poseMover.keyDown(poseTarget, { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, POSE_STEPS)
    if (poseMover.running === 'keys') holdKeys()
  }
  /**
   * The sliders (docs/slider-plan.md): a slide or a thumb key run takes the one gesture slot as a pad drag does (its key
   * runs as `SLIDER_KEYS`, not `KEYS`, which the editing and picture runs own); typing is the one **open field**, ended
   * — as leaving it would — before any other input begins (dot 1791770098).
   */
  const openField = useRef<null | { end(): void }>(null)
  const endOpenField = () => { const f = openField.current; openField.current = null; f?.end() }
  const sliderHooks = {
    onStart: (d: { input: 'drag' | 'keys'; pointerId?: number; cancel(): void }) => {
      endOpenField()
      const id = d.input === 'keys' ? SLIDER_KEYS : d.pointerId!
      if (gesture.current && gesture.current.id !== id && d.input === 'drag' && gesture.current.id >= 0) return false // another pointer's gesture keeps the slot
      gesture.current?.cancel('a slider')
      gesture.current = { id, right: false, cancel: () => d.cancel() }
      sliderCancel.current = gesture.current.cancel
      return true
    },
    onEnd: () => { if (gesture.current && gesture.current.cancel === sliderCancel.current) gesture.current = null; sliderCancel.current = null },
    onField: (d: { end(): void } | null) => { if (d) { if (openField.current && openField.current !== d) endOpenField(); openField.current = d } else openField.current = null },
  }
  const sliderCancel = useRef<null | ((why: string) => void)>(null)
  /** A tool change (key or button, Z included) ends any gesture through its one cancel path (dot 1791554909). */
  const chooseTool = (t: Tool | 'Z') => {
    gesture.current?.cancel('a tool change')
    setZoomTool(t === 'Z')
    if (t !== 'Z') ix.setTool(t)
  }
  /** Zoom is a viewport tool (bowen 1791727452): Z or its button turns it on and, pressed again, off — in every mode. */
  const toggleZoom = () => { gesture.current?.cancel('a tool change'); setZoomTool(z => !z) }
  /** In playback, Move picture and restoring, a press that belongs to a viewport tool (Zoom on, the middle or right button) goes to the canvas's viewport path; none of these reaches a tool that writes. */
  const viewportPress = (e: React.PointerEvent) => zoomTool || e.button === 1 || e.button === 2
  const onWheel = (e: React.WheelEvent) => {
    const at = toDoc(e), k = Math.exp(e.deltaY * 0.001)
    setBox(b => ({ x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w: b.w * k, h: b.h * k }))
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.key === 'Shift' || e.key === 'Alt') && hoverAt.current) { hoverAt.current.mods = mods(e); rehover.current() }
      // Esc first: it cancels a gesture even in playback and with a field focused (dot 1791696958)
      if (e.key === 'Escape' && gesture.current) { gesture.current.cancel('Esc'); e.preventDefault(); return }
      if (e.key === 'Escape' && applyFromOn.current) { setApplyFrom(false); e.preventDefault(); return }
      // playback: Esc clears the playback selection (docs/playback-tools-checklist.md §1)
      if (e.key === 'Escape' && posing.current) setPbSel(v => (v.ids.length ? { core, ids: [] } : v))
      // only a field that takes typing keeps its keys (dot 1791544530), an input method its own (dot 1791727663);
      // a focused button never blocks a shortcut (bowen 1791556992: after clicking Flip or Zoom, V / A / ⌘Z still work)
      const t = e.target as HTMLElement
      const typing = e.isComposing || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
        || (t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset'].includes((t as HTMLInputElement).type))
      // an input method taking the keys ends a key run: its held key's repeats are not this run's after (dot 1791770081)
      if (typing) { if (e.isComposing && isKeyRun(gesture.current)) gesture.current!.cancel('an input method'); return }
      // an arrow on any focused field or slider is that control's own (a slider steps with it), never a move;
      // a key run already running still ends only by its own paths (dot 1791734673)
      if (isArrow(e.key) && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.getAttribute?.('role') === 'slider')) return
      // undo / redo during a key run (the selection's or the picture's) end the run, write nothing and undo nothing earlier (dot 1791734673)
      if (isKeyRun(gesture.current) && e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) { gesture.current!.cancel(e.shiftKey ? 'redo' : 'undo'); e.preventDefault(); return }
      // a plain Z is the viewport's zoom, in every mode (bowen 1791727452); ⌘Z / Ctrl-Z stays undo
      // a key held down repeats: only its first press toggles (dot 1791731833)
      if (e.key.toLowerCase() === 'z' && !e.metaKey && !e.ctrlKey && !e.altKey) { if (!e.repeat) toggleZoom(); e.preventDefault(); return }
      // then the write gates: restoring and playback take no other shortcut (dot 1791704242, 1791683911)
      if (restoringNow.current) return
      // Move picture on: the arrows move the picture, in playback too (§5)
      if (keyHooks.current.nudge?.(e)) return
      // playback: a plain arrow on the canvas turns the view; its default is prevented even when it changes nothing
      // (a limit, a gesture running), so the page never scrolls; ⌘ + arrow keeps its own behaviour (dot 1791769087)
      if (posing.current && isArrow(e.key) && !e.metaKey) { // every ⌘ combination keeps its own (⌘ + Ctrl too; dot 1791770081)
        e.preventDefault()
        if (gesture.current && gesture.current.id !== KEYS) return // a drag runs: ignored, and its repeats never start a run
        if (!keyHooks.current.selArrow?.(e)) keyHooks.current.poseArrow?.(e)
        return
      }
      // playback: A and V choose how a drag corrects (docs/playback-edit-checklist.md §2); no other tool key
      if (posing.current && /^[av]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); chooseTool(e.key.toUpperCase() as Tool); return }
      if (posing.current) return
      if (isArrow(e.key) && gesture.current && gesture.current.id !== KEYS) { e.preventDefault(); return } // a drag runs: one session at a time
      // one Esc cancels one thing: a gesture in progress (above) if there is one, else interaction's innermost (dot 1791553129)
      // a plain letter interaction takes is a tool key: it ends any gesture and leaves Z
      if (/^[a-y]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && ix.key(e.key, mods(e))) { e.preventDefault(); chooseTool(ix.tool); return }
      if (ix.key(e.key, { ...mods(e), ctrl: e.ctrlKey, repeat: e.repeat })) { e.preventDefault(); if (isArrow(e.key)) keyHooks.current.afterArrow?.() }
    }
    // a key release ends a key run wherever focus is: no typing check here (dot 1791733489)
    const up = (e: KeyboardEvent) => {
      if ((e.key === 'Shift' || e.key === 'Alt') && hoverAt.current) { hoverAt.current.mods = mods(e); rehover.current() }
      if (!isArrow(e.key)) return; ix.keyUp(e.key); picMover.keyUp(e.key); poseMover.keyUp(e.key); selMover.keyUp(e.key) }
    // a key run ends on leaving the window, and when focus moves inside the page to a field or a slider
    const blur = () => { if (isKeyRun(gesture.current)) gesture.current!.cancel('leaving the window') }
    const focus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (isKeyRun(gesture.current) && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) gesture.current!.cancel('focus moving to a field')
    }
    const composing = () => { if (isKeyRun(gesture.current)) gesture.current!.cancel('an input method') }
    window.addEventListener('keydown', key); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('focusin', focus); document.addEventListener('compositionstart', composing)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('focusin', focus); document.removeEventListener('compositionstart', composing) }
  }, [ix])

  // what the selection touches, for the rotate / scale buttons and the A handles
  const selPoints = new Set<Id>()
  for (const u of sel) {
    if (u.kind === 'point') selPoints.add(u.id)
    if (u.kind === 'line') { selPoints.add(line(u.id).a); selPoints.add(line(u.id).b) }
    if (u.kind === 'handle') selPoints.add(line(u.line)[u.end])
  }
  const ps = [...selPoints].map(pos)
  const centre = ps.length ? P((Math.min(...ps.map(p => p.x)) + Math.max(...ps.map(p => p.x))) / 2, (Math.min(...ps.map(p => p.y)) + Math.max(...ps.map(p => p.y))) / 2) : P(0, 0)
  const key = (u: Unit) => (u.kind === 'handle' ? `h:${u.line}:${u.end}` : `${u.kind}:${u.id}`)
  const isSel = (u: Unit) => sel.some(v => key(v) === key(u))

  // the drag ghost: the units the drag moves, drawn moved by its offset (a preview only)
  const ghostLines = (() => {
    const d = pv.drag
    if (!d) return []
    // what the release writes, as core previews it (handle follow, settle, links); the plain moved ghost otherwise
    if (d.lines.length || d.arcs.length) return [...d.lines, ...d.arcs].map(l => l.curve as [Vec, Vec, Vec, Vec])
    const pts = new Set<Id>(), hs = new Set<string>(), lns = new Set<Id>()
    // the view never dereferences an id that is gone (dot 1791544530)
    const has = (id: Id) => s.lines.some(l => l.id === id), hasPoint = (id: Id) => s.points.some(p => p.id === id)
    const exists = (u: Unit) => (u.kind === 'point' ? hasPoint(u.id) : u.kind === 'line' ? has(u.id) : u.kind === 'handle' ? has(u.line) : true)
    for (const u of d.units.filter(exists)) {
      if (u.kind === 'point') pts.add(u.id)
      if (u.kind === 'line') { lns.add(u.id); pts.add(line(u.id).a); pts.add(line(u.id).b) }
      if (u.kind === 'handle') hs.add(u.line + u.end)
    }
    return s.lines.filter(l => pts.has(l.a) || pts.has(l.b) || hs.has(l.id + 'a') || hs.has(l.id + 'b')).map(l => {
      const mv = (id: Id) => (pts.has(id) ? add(pos(id), d.offset) : pos(id))
      const a = mv(l.a), b = mv(l.b)
      return [a, add(a, add(l.ha, hs.has(l.id + 'a') ? d.offset : P(0, 0))), add(b, add(l.hb, hs.has(l.id + 'b') ? d.offset : P(0, 0))), b]
    })
  })()
  // the refusal mark: a red cross on each object it names
  const refusalAt = ((pose ? corrRefusal : pv.refusal)?.objects ?? []).flatMap(o => {
    if (o.kind === 'point') { const p = s.points.find(x => x.id === o.id); return p ? [p.position] : [] }
    if (o.kind === 'line') { const c = g.lines.find(x => x.id === o.id); return c ? [mid(c.curve)] : [] }
    if (o.kind === 'group') { const gr = s.groups.find(x => x.id === o.id); const c = gr && g.lines.find(x => x.id === gr.lines[0]); return c ? [mid(c.curve)] : [] }
    return []
  })
  const cutLines = new Set(s.groups.filter(x => pv.cut.includes(x.id)).flatMap(x => x.lines))

  const B = (label: string, f: () => void, title?: string) => <button title={title} onClick={f}>{label}</button>
  // where the pose lies for a correction, by core's own rule (correctionEdge; dot 1791696958)
  const where = pose ? correctionEdge(pose) : null
  const onLine = !!where && 'edge' in where
  // §2, §3: where a playback drag corrects; A's marks there (none with Z); the controls corrected at exactly this pose
  const atCorrection = !!pose && correctionPose(pose) && !!where && 'edge' in where
  // the playback selection as drawn: only while it belongs to this drawing; its box from the pose's points (§1)
  const pbIds = atCorrection && pbSel.core === core ? pbSel.ids : [], pbBounds = pbIds.length ? boundsOf(s, pbIds) : null
  // 四角 / 曲边 on the playback selection (§2): started for this drawing, pose and selection; kept through its own writes
  // only — any other write (an arrow, a move, a scale) leaves another drawing, and the frame is rebuilt from it (dot 1791982484)
  const deformKey = pose ? `${pose.yaw},${pose.pitch}|${pbIds.join(',')}` : ''
  const deformOn = atCorrection && ix.tool === 'deform' && pbIds.length > 0
  useEffect(() => {
    if (!deformOn) { if (pbDeform) setPbDeform(null); return }
    const text = frame.current?.text ?? save(core)
    if (pbDeform && pbDeform.core === core && pbDeform.key === deformKey && pbDeform.text === text) return
    const st = deformStart(s, pbIds)
    setPbDeform(st ? { core, key: deformKey, text, ...st, quad: rectQuad(st.rect), bend: neutralBend() } : null)
  })
  const pbFrame = deformOn && pbDeform && pbDeform.core === core && pbDeform.key === deformKey && pbDeform.text === frame.current?.text ? frameOf(pbDeform.rect, pbDeform.quad, pbDeform.bend) : null
  const playbackMarks = atCorrection && !zoomTool && ix.tool === 'A'
  const correctedHere = (() => {
    const out = { points: new Set<Id>(), handles: new Set<string>(), list: [] as { control: { kind: 'point'; id: Id } | { kind: 'handle'; line: Id; end: 'a' | 'b' }; label: string; axes: string }[] }
    if (!atCorrection || !where || !('edge' in where)) return out
    const r = core.model().responses, key = modelEdge(where.inner, where.outer), t = where.t
    const axesAt = (c?: Record<string, { x?: Knots; y?: Knots }>) => (['x', 'y'] as const).filter(ax => c?.[key]?.[ax]?.some(k => k[0] === t))
    for (const [id, c] of Object.entries(r?.points ?? {})) { const ax = axesAt(c); if (ax.length) { out.points.add(id); out.list.push({ control: { kind: 'point', id }, label: `点 ${id}`, axes: ax.join('、') }) } }
    for (const [line, h] of Object.entries(r?.handles ?? {})) for (const end of ['a', 'b'] as const) {
      const ax = axesAt(h[end]); if (ax.length) { out.handles.add(`${line}:${end}`); out.list.push({ control: { kind: 'handle', line, end }, label: `线 ${s.lines.find(l => l.id === line)?.name || line} 的 ${end} 端手柄`, axes: ax.join('、') }) }
    }
    return out
  })()
  type Control = (typeof correctedHere.list)[number]['control']
  /**
   * The corrections list (docs/correction-cleanup-checklist.md §3; bowen 1791993536, 1791993161): one row per curve
   * (its group, else the line alone) of the selected layers with a knot at any angle (dot 1791995359: one with none at
   * this pose is still found); a curve's controls are its lines' end points and handle ends. `shared`: a point the
   * curve shares with another curve, `linked`: a point linked to another (clearing it clears those too).
   */
  const curveRows = (() => {
    const out: { key: string; label: string; controls: Control[]; here: number; all: number; shared: boolean; linked: boolean }[] = []
    if (!atCorrection) return out
    const resp = core.model().responses, linkedPts = new Set(s.points.filter(p => p.links.length).map(p => p.id))
    const anyKnot = (c?: Record<string, { x?: Knots; y?: Knots }>) => !!c && Object.values(c).some(ax => !!(ax.x?.length || ax.y?.length))
    const layerOfPoint = new Map(s.points.map(p => [p.id, p.layer])), seen = new Set<Id>()
    for (const l of s.lines) {
      if (seen.has(l.id) || !selLayers.includes(layerOfPoint.get(l.a) ?? '')) continue
      const gr = s.groups.find(g => g.lines.includes(l.id)), ids = gr ? gr.lines : [l.id]
      for (const i of ids) seen.add(i)
      const lines = ids.map(i => s.lines.find(x => x.id === i)!), pts = [...new Set(lines.flatMap(x => [x.a, x.b]))]
      const handles = lines.flatMap(x => (['a', 'b'] as const).map(end => ({ kind: 'handle' as const, line: x.id, end })))
      const here = pts.filter(p => correctedHere.points.has(p)).length + handles.filter(h => correctedHere.handles.has(`${h.line}:${h.end}`)).length
      const all = pts.filter(p => anyKnot(resp?.points?.[p])).length + handles.filter(h => anyKnot(resp?.handles?.[h.line]?.[h.end])).length
      if (!all) continue
      const inside = new Set(ids)
      out.push({ key: gr?.id ?? l.id, label: gr?.name || l.name || l.id, controls: [...pts.map(id => ({ kind: 'point' as const, id })), ...handles], here, all, shared: pts.some(p => s.lines.some(x => !inside.has(x.id) && (x.a === p || x.b === p))), linked: pts.some(p => linkedPts.has(p)) })
    }
    return out
  })()
  /** Every control of the selected layers, for 「删除选中图层的全部修正」 (all angles). */
  const layerControls = (): Control[] => {
    const pts = s.points.filter(p => selLayers.includes(p.layer)).map(p => p.id), ptSet = new Set(pts)
    return [...pts.map(id => ({ kind: 'point' as const, id })), ...s.lines.filter(l => ptSet.has(l.a)).flatMap(l => (['a', 'b'] as const).map(end => ({ kind: 'handle' as const, line: l.id, end })))]
  }
  /** One clearCorrections (docs/correction-cleanup-checklist.md §2), all angles; its change shown as a drag's is. */
  const clearCorrections = (controls: Control[]) => {
    try { logged(core).edit(x => x.clearCorrections(controls)); setCorrRefusal(null) }
    catch (err) { setCorrRefusal({ message: (err as Error).message, objects: err instanceof Refusal ? err.objects : [] }) }
    bump()
  }
  const brokenHere = refsHere().filter(r => refBroken.some(x => x.core === core && x.id === r.id && x.src === r.src)).map(r => r.id)
  const status = pose ? (corrRefusal ? '✗ ' + withNames(corrRefusal.message)
    : `playback yaw ${pose.yaw}, pitch ${pose.pitch} · ${atCorrection && where && 'edge' in where ? `修正点：${where.inner} → ${where.outer}，t = ${+where.t.toFixed(3)} · A 拖点或手柄，V 拖整条曲线` : viewAtPose(pose) ? `视角 ${viewAtPose(pose)} · A / V 直接改这个视角` : '这里只能看；修正点在 yaw ±30 / ±60、pitch 0 / ±45'}${posed instanceof Error ? ' · ✗ ' + posed.message : ''}`)
    : pv.refusal ? '✗ ' + withNames(pv.refusal.message)
    : brokenHere.length ? `✗ reference picture ${brokenHere.join(', ')} could not be drawn (the drawing is unaffected)`
    : `view ${shown} · tool ${ix.tool} · layer ${drawLayer} · selection ${sel.map(u => u.kind[0] + ':' + ('id' in u ? u.id : u.line + '.' + u.end)).join(' ') || '—'}${pv.pick ? ' · first pick ' + pv.pick.id : ''}${pv.cut.length ? ' · cut pending (paste moves, Esc cancels)' : ''}${pv.mirrorSource.length ? ' · mirror source ' + pv.mirrorSource.length : ''}`

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 230, padding: 8, borderRight: '1px solid #ccc', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* playback (stage 3a): a pose between the views, read only; everything that writes below is disabled meanwhile */}
        <b>Playback</b>
        <div data-testid="playback" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {pose ? <>
            <button onClick={stopPose}>Leave playback</button>
            {(['yaw', 'pitch'] as const).map(axis => {
              // the pose is a view: preview and commit both set it, a cancel keeps the last (as the grid); a thumb session's
              // own updates never cancel it, typing ends any other gesture as a field always did
              const set = (v: number, input: 'drag' | 'keys' | 'typing') => { const now = poseRef.current; if (now && now[axis] !== v) changePose({ ...now, [axis]: v }, input === 'typing' ? `${axis}-field` : 'slider') }
              return <div key={axis}><Slider label={axis} value={pose[axis]} identity={`pose:${axis}`} accept={v => Math.abs(v) <= LIMITS[axis]} track={[-LIMITS[axis], LIMITS[axis]]}
                steps={POSE_STEPS} fieldAttrs={{ 'data-testid': `${axis}-text` }} thumbAttrs={{ 'data-testid': axis }} {...sliderHooks}
                onPreview={set} onCommit={set} onCancel={() => {}} /></div>
            })}
            {/* yaw and pitch on one grid (bowen 1791727397): its drag takes the one gesture slot, ending the old gesture first */}
            <PosePad yaw={pose.yaw} pitch={pose.pitch} limits={LIMITS}
              onStart={d => {
                // as on the canvas: another pointer's running gesture keeps the slot, the press is ignored (dot 1791731833);
                // a pose key run is ended instead (the pose stays), and the press acts (dot 1791769205)
                endOpenField(); endPoseRun()
                if (gesture.current && gesture.current.id !== d.pointerId) return false
                gesture.current?.cancel('a pose pad press'); gesture.current = { id: d.pointerId, right: false, cancel: d.cancel }; return true
              }}
              onChange={p => changePose(p, 'pad')}
              onEnd={cancel => { if (gesture.current?.cancel === cancel) gesture.current = null }} />
            {/* the batch tools at a correction pose (docs/playback-tools-checklist.md §2) */}
            {atCorrection && <div data-testid="playback-tools" style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
              {TOOLS.filter(([tl]) => tl === 'V' || tl === 'A' || tl === 'deform').map(([tl, label]) => { const on = !zoomTool && ix.tool === tl
                return <button key={tl} style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : undefined }} onClick={() => chooseTool(tl)}>{label}</button> })}
              <label><input type="checkbox" checked={opts.follow} onChange={e => ix.setOptions({ follow: e.target.checked })} /> 手柄跟随</label>
              <span style={{ color: '#666' }}>{pbIds.length ? `已选 ${pbIds.length} 个点` : '框选或点选要改的点'}{ix.tool === 'deform' && pbIds.length && !pbFrame ? ' · 选中的点要连成线才有四角框' : ''}</span>
            </div>}
            {/* §3: the corrections at exactly this pose, each removable; what the last playback write changed */}
            {atCorrection && <div data-testid="corrections-here" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b>有修正的曲线（{curveRows.length}，只列选中图层）</b>
              {curveRows.map(r => <div key={r.key} data-correction-curve={r.key} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{r.label} · 本角度 {r.here} 处 / 全部角度 {r.all} 处{r.shared ? ' · 含与别的曲线共用的接点（那条曲线的这个点也一起清掉）' : ''}{r.linked ? ' · 含跨图层联动的点（联动的点也一起清掉）' : ''}</span>
                <button onClick={() => clearCorrections(r.controls)}>删除这条曲线的全部修正</button></div>)}
              <button data-testid="clear-layer-corrections" onClick={() => clearCorrections(layerControls())}>删除选中图层的全部修正</button>
              <div style={{ color: '#888' }}>删除去掉所有角度的修正。共用接点、跨图层联动的点会连带别的曲线 / 图层一起清；当时被挪动的视角不会复原（要复原请离开 playback 后撤销）</div>
            </div>}
            {lastChange && <div data-testid="last-change" style={{ color: '#333', background: '#f6f6f0', padding: 3 }}>
              <b>刚才改了什么</b>（yaw {lastChange.pose.yaw}, pitch {lastChange.pose.pitch}）
              {lastChange.lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>}
          </> : <button onClick={startPose}>Playback</button>}
        </div>
        {/* viewport tools change only what the canvas shows: enabled in every mode (bowen 1791727452) */}
        <b>View</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          <button data-testid="zoom" style={{ fontWeight: zoomTool ? 700 : 400, background: zoomTool ? '#cde' : undefined }} onClick={toggleZoom}>Zoom Z</button>
        </div>
        <fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Tools</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {TOOLS.map(([t, label]) => { const on = !zoomTool && ix.tool === t; return <button key={t} style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : undefined }} onClick={() => chooseTool(t)}>{label}</button> })}
        </div>
        {/* handle follow (docs/handle-follow-checklist.md): a move's lines keep their shape along their chords; S straightens */}
        <label title="移动端点时，相连线的手柄跟着弦转动和伸缩，形状不变；S = 把选中的线拉直"><input type="checkbox" data-testid="handle-follow" checked={opts.follow} onChange={e => ix.setOptions({ follow: e.target.checked })} /> 手柄跟随 · S 拉直</label>
        {ix.tool === 'join' && <div>
          <select value={opts.joinMode} onChange={e => ix.setOptions({ joinMode: e.target.value as typeof opts.joinMode })}><option>bound</option><option>smooth</option><option>cusp</option><option>arc</option></select>
          {opts.joinMode === 'arc' && <Slider label="r" value={opts.radius} identity="join-radius" accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
            fieldAttrs={{ 'data-testid': 'radius' }} {...sliderHooks} onPreview={() => {}} onCommit={v => ix.setOptions({ radius: v })} onCancel={() => {}} />}
          <div style={{ color: '#666' }}>click two lines; alt on the second: remove join</div>
        </div>}
        {ix.tool === 'fill' && <div><input type="color" value={opts.color} onChange={e => ix.setOptions({ color: e.target.value })} /> <span style={{ color: '#666' }}>shift-click: clear</span></div>}
        {/* 四角 / 曲边 (docs/deform-p3-checklist.md §3): the readout is the fit error before constraints (dot 1791892720) */}
        {ix.tool === 'deform' && <div data-testid="deform-panel">
          {pv.deform ? <>
            <div data-testid="deform-error" style={{ color: '#555' }}>约束前采样拟合误差 {pv.deform.maxError.toFixed(3)}</div>
            <div style={{ display: 'flex', gap: 3 }}><button data-testid="deform-reset" onClick={() => ix.deformReset()}>重置变形框</button><button data-testid="deform-done" onClick={() => ix.deformDone()}>完成</button></div>
          </> : <div style={{ color: '#666' }}>先用 V 或 A 选中要变形的线，再选这个工具</div>}
        </div>}
        <b>View</b>
        {/* the nine views (step 7): columns yaw −90 / 0 / +90, rows pitch +45 / 0 / −45 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }} data-testid="views">
          {[45, 0, -45].flatMap(pitch => [-90, 0, 90].map(yaw => {
            const k = `view:${yaw},${pitch}`, on = k === shown
            return <button key={k} data-view={k} title={applyFrom ? (on ? '当前视角' : `把 ${k} 里选中图层的曲线搬到当前视角`) : k} disabled={applyFrom && on}
              style={{ fontWeight: on ? 700 : 400, background: on ? '#cde' : applyFrom ? '#fec' : undefined }}
              onClick={() => { if (!applyFrom) { chooseView(k); return } setApplyFrom(false); run(e => e.applyFromView([...env.current.layers], k)) }}>{yaw},{pitch}</button>
          }))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button data-testid="apply-from" style={{ fontWeight: applyFrom ? 700 : 400, background: applyFrom ? '#fec' : undefined, whiteSpace: 'nowrap' }} onClick={() => setApplyFrom(!applyFrom)}
            title="把另一个视角里选中图层的曲线（端点位置和两个手柄）原样搬到当前视角；宽度等其他都不动；一步可撤销">从视角应用…</button>
          {applyFrom && <span style={{ color: '#a60' }}>选一个视角，把它的曲线搬到选中的图层（Esc 取消）</span>}
        </div>
        <b>Edit</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Undo', () => (isKeyRun(gesture.current) ? gesture.current!.cancel('undo') : ix.undo()))}{B('Redo', () => (isKeyRun(gesture.current) ? gesture.current!.cancel('redo') : ix.redo()))}
          {B('Delete', () => ix.deleteSelection())}
          {B('Cut', () => ix.cut(), '⌘X: grey until pasted; Esc cancels')}{B('Copy', () => ix.copy(), '⌘C')}{B('Paste', () => ix.paste(), '⌘V: into the current layer')}
          {B('Flip', () => run(x => x.flip(sel)))}
          {B('Rot +15°', () => run(x => x.rotate(centre, Math.PI / 12, sel)))}
          {B('×1.1', () => run(x => x.scale(centre, 1.1, 1.1, sel)))}{B('×0.9', () => run(x => x.scale(centre, 0.9, 0.9, sel)))}
        </div>
        <b>Selected lines ({selLines.length})</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Lock', () => run(x => selLines.forEach(l => x.lineState(l, { locked: true }))))}
          {B('Unlock', () => run(x => selLines.forEach(l => x.lineState(l, { locked: false }))))}
          {B('Hide', () => run(x => selLines.forEach(l => x.lineState(l, { visible: false }))))}
          {B('Show all', () => run(x => s.lines.filter(l => !l.state.visible).forEach(l => x.lineState(l.id, { visible: true }))))}
          {/* a field only (bowen 1791769257); "Set width" still applies it to the selected lines (dot 1791769298) */}
          <Slider label="width" value={width} identity="stroke-width" accept={v => v > 0} track={null} steps={{ step: 1, long: 10, short: 0.1 }}
            fieldAttrs={{ 'data-testid': 'width' }} {...sliderHooks} onPreview={() => {}} onCommit={v => setWidth(v)} onCancel={() => {}} />
          {B('Set width', () => (selLines.length ? run(x => selLines.forEach(l => x.lineStroke(l, { profile: line(l).stroke.profile, width }))) : (note('Set width: no line is selected — select lines first, or set a line\'s width in its properties'), bump())))}
          {B('Broadcast stroke', () => ix.broadcastStroke(), 'this view\'s width, profile and end strokes of the selected lines → every other view')}
        </div>
        {/* stage 2: shapes between views (front → others), separate from the stroke broadcast above */}
        <b>Angle (shapes) · pending {pending.length}</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B('Broadcast shape', () => ix.broadcastShape(), 'front view only: the selected lines\' change since the last broadcast → every other view')}
          {B('Fit', () => ix.fit(), 'accept the selected lines\' front as the baseline; no view changes')}
          {B('Draft corners', () => ix.draftCorners(), 'the four corner views of the selected lines = front + yaw change + pitch change')}
        </div>
        </fieldset>
        {/* the pictures, and the ink and 蒙版 display switches, work in playback too: playback's own pictures (§1, §5) */}
        <fieldset disabled={restoring} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Reference ({pose ? 'playback' : shown})</b>
        <div data-testid="reference" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label>Place… <input type="file" data-testid="ref-file" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            // bound at the start: the view and the box it is placed into (§7.1); into the library (or the identical entry), then placed
            const view = posing.current ? 'playback' : shown, at = box
            readPicture(f, pic => {
              const k = Math.min(1, 0.9 * at.w / pic.width, 0.9 * at.h / pic.height)
              run(x => { const asset = x.addAsset({ id: nid('asset-'), name: f.name.slice(0, 100), ...pic }); x.placeReference({ id: nid('ref-'), view, asset, width: pic.width, height: pic.height, x: at.x + at.w / 2, y: at.y + at.h / 2, scale: k, angle: 0, opacity: 0.5, visible: true }) })
            })
          }} /></label>
          <label title="实验：用墨迹轮廓画线（单线，与今天的圆头描边同形）"><input type="checkbox" data-testid="ink-outline" checked={inkOn} onChange={e => setInkOn(e.target.checked)} /> 墨迹轮廓（实验）{ink && <span data-testid="ink-diagnostics"> · 已验证 {ink.diagnostics.filter(d => d.status === 'verified').length} · 未完全证明 {ink.diagnostics.filter(d => d.status === 'unproven').length} · 瑕疵 {ink.diagnostics.filter(d => d.status === 'defect').length} · 回退 {ink.diagnostics.filter(d => d.status === 'fallback').length}</span>}</label>
          <label title="画出画稿里的蒙版（默认开；需要墨迹轮廓开着）" style={{ color: inkOn ? undefined : '#999' }}><input type="checkbox" data-testid="masks" disabled={!inkOn} checked={masksOn && inkOn} onChange={e => setMasksOn(e.target.checked)} /> 蒙版（实验）{!inkOn && ' · 需要墨迹轮廓'}</label>
          <label><input type="checkbox" data-testid="move-picture" checked={moveRef} onChange={e => { if (!e.target.checked) { gesture.current?.cancel('Move picture turned off'); setActiveRef(null) } cancelPreview(); setMoveRef(e.target.checked) }} /> Move picture (drag it, or arrow keys; Shift ×10)</label>
          {refsHere().map(r => {
            const live = refPreview && refPreview.id === r.id && refNow(refPreview) ? { ...r, ...refPreview.props } : r
            const active = refNow(activeRef)?.id === r.id
            const RANGE = { x: [box.x, box.x + box.w, 1], y: [box.y, box.y + box.h, 1], scale: [-3, 2, 0.01], angle: [-180, 180, 1], opacity: [0, 1, 0.01] } as const
            // every control below acts through the one ending, bound to this picture as drawn (dot 1791725888)
            const bound: RefBind = { core, gen: refGen.current, id: r.id, src: r.src }
            const slotsOf = (what: string, next: (now: ReferenceImage) => ReferenceSlot[] | null) => refAct(bound, what, now => { const slots = next(now); if (slots) run(x => x.setReference(now.id, { slots })) })
            return <div key={r.id} data-ref={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, outline: active ? '1px solid #2a7fff' : undefined }}>
            <input type="checkbox" checked={r.visible} onChange={e => { const v = e.target.checked; refAct(bound, 'visibility', now => run(x => x.setReference(now.id, { visible: v }))) }} />
            {(['x', 'y', 'scale', 'angle', 'opacity'] as const).map(k => {
              // one slider each (docs/slider-plan.md): preview → the shared picture preview, commit → its one setReference,
              // cancel → the preview withdrawn; accepted as core accepts (src/reference), the track only the slide's range
              const SLIDE = { x: [box.x, box.x + box.w], y: [box.y, box.y + box.h], scale: [-3, 2], angle: [-180, 180], opacity: [0, 1] } as const
              const STEPS = { x: { step: 1, long: 10, short: 0.1 }, y: { step: 1, long: 10, short: 0.1 }, angle: { step: 1, long: 10, short: 0.1 }, scale: { step: 0.01, long: 0.1, short: 0.001 }, opacity: { step: 0.01, long: 0.1, short: 0.001 } }
              const accept = (v: number) => (k === 'scale' ? v > 0 && Number.isFinite(r.width * v) && Number.isFinite(r.height * v) : k === 'opacity' ? v >= 0 && v <= 1 : Number.isFinite(v))
              return <Slider key={k} label={k} value={r[k]} identity={`${r.id}:${r.src}:${k}`} version={refGen.current} accept={accept} track={SLIDE[k]} scale={k === 'scale' ? 'log' : 'linear'} steps={STEPS[k]}
                fieldAttrs={{ 'data-field': k }} thumbAttrs={{ 'data-slider': k }} {...sliderHooks}
                onStart={d => (refNow(bound) ? sliderHooks.onStart(d) : false)}
                onPreview={v => { const now = refNow(bound); if (now) previewRef(now, { [k]: v }) }}
                onCommit={v => { const now = refNow(bound); if (!now) return; previewRef(now, { [k]: v }); commitPreview() }}
                onCancel={() => cancelPreview()} />
            })}
            {B('Mirror ⇆', () => mirrorRef(bound))}
            {B('Remove', () => refAct(bound, 'Remove', now => run(x => x.removeReference(now.id))))}
            <div data-slots={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 2, width: '100%' }}>
              {r.slots.map((sl, k) => <span key={k} data-slot={k} style={{ border: '1px solid #ccc', padding: '0 3px' }}>
                <Rename key={drawing} name={sl.name || `slot ${k + 1}`} style={{ fontWeight: 700, flex: 'none' }} fieldStyle={{ width: 70 }} onRename={n => slotsOf('slot rename', now => (k < now.slots.length ? now.slots.map((x, j) => (j === k ? { ...x, name: n.slice(0, 100) } : x)) : null))} />
                <button onClick={() => slotsOf('存', now => (k < now.slots.length ? now.slots.map((x, j) => (j === k ? { ...x, placement: { x: now.x, y: now.y, scale: now.scale, angle: now.angle } } : x)) : null))}>存</button>
                <button disabled={!sl.placement} onClick={() => refAct(bound, '调出', now => { const p = now.slots[k]?.placement; if (p) run(x => x.setReference(now.id, { ...p })) })}>调出</button>
                <button onClick={() => slotsOf('slot ×', now => (k < now.slots.length ? now.slots.map((x, j) => (j === k ? { ...x, placement: null } : x)) : null))}>×</button>
              </span>)}
              <button onClick={() => slotsOf('＋ 加一格', now => [...now.slots, { name: '', placement: null }])}>＋ 加一格</button>
            </div>
          </div>
          })}
        </div>
        </fieldset>
        <fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Library</b>
        {/* each picture's content once (§10; bowen 1791725516): placed into a view by its button, removed only when no view shows it */}
        <div data-testid="library" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label>＋ 加图片 <input type="file" data-testid="lib-file" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            readPicture(f, pic => run(x => { x.addAsset({ id: nid('asset-'), name: f.name.slice(0, 100), ...pic }) }))
          }} /></label>
          {core.library().map(a => {
            const lb: RefBind = { core, gen: refGen.current, id: a.id, src: a.src }
            const k = Math.min(1, 0.9 * box.w / a.width, 0.9 * box.h / a.height)
            return <div key={a.id} data-asset={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <img src={a.src} alt="" style={{ width: 40, height: 28, objectFit: 'contain', background: '#eee', flex: 'none' }} />
              <Rename key={drawing} name={a.name} style={{ flex: 1 }} fieldStyle={{ width: 90 }} onRename={n => libAct(lb, 'library rename', now => run(x => x.renameAsset(now.id, n.slice(0, 100))))} />
              <span data-uses="" style={{ color: '#666', flex: 'none' }} title="placements · views">{a.placements} · {a.views}v</span>
              <button onClick={() => libAct(lb, '放到当前视角', now => run(x => x.placeReference({ id: nid('ref-'), view: shown, asset: now.id, x: box.x + box.w / 2, y: box.y + box.h / 2, scale: k, angle: 0, opacity: 0.5, visible: true })))}>放到当前视角</button>
              <button disabled={a.placements > 0} title={a.placements > 0 ? `shown by ${a.placements} placement(s) in ${a.views} view(s)` : 'remove from the library'} onClick={() => libAct(lb, 'library ×', now => run(x => x.removeAsset(now.id)))}>×</button>
            </div>
          })}
        </div>
        <b>Names</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {/* renaming is by double-click on the name in the layers panel (rename/, bowen 1791708333) */}
          <input placeholder="find by name" style={{ width: 110 }} onKeyDown={e => {
            if (e.key !== 'Enter') return
            const q = (e.target as HTMLInputElement).value, l = s.lines.find(x => x.name === q), gr = s.groups.find(x => x.name === q)
            if (l) { setLabelKind('line'); run(x => x.select([{ kind: 'line', id: l.id }])) }
            else if (gr) { setLabelKind('curve'); run(x => x.selectGroup(gr.lines[0]!)) }
          }} />
        </div>
        {selLines.length > 0 && <div style={{ color: '#555' }}>{[...new Set(selLines.map(groupOf))].map(gid => { const gr = s.groups.find(x => x.id === gid); return gr ? <div key={gid}><b>{gr.name}</b>: {gr.lines.map(id => line(id).name).join(' · ')}</div> : null })}</div>}
        <b>Mirror (axis x = {s.axis})</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {B(`Set source (${pv.mirrorSource.length})`, () => ix.setMirrorSource())}
          {B('Apply → selected', () => ix.mirrorApply())}
          {B('Link → selected', () => ix.mirrorLink())}
          {B('Unmirror', () => run(x => x.unmirror(selLines)))}
        </div>
        <div style={{ color: '#666' }}>pairs: {s.mirrorPairs.length}</div>
        </fieldset>
        <b>File</b>
        <div data-testid="autosave" style={{ color: saver.current?.status().state === 'failed' || saver.current?.status().state === 'off' ? '#c00' : '#666' }}>{(() => {
          const st = saver.current?.status()
          if (!store) return 'autosave: off (no browser storage)'
          if (!st || st.state === 'restoring') return 'autosave: restoring…'
          const head = st.state === 'saved' ? 'autosave: saved' : st.state === 'saving' ? 'autosave: saving…' : st.state === 'failed' ? `✗ autosave: not saved (${st.error})` : `✗ autosave off: ${st.error}`
          return st.notice ? `${head} · ${st.notice}` : head
        })()}{saver.current?.status().state === 'failed' && <> <button onClick={() => saver.current?.retry()}>Retry</button></>}</div>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          {B('Save', () => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([save(core)], { type: 'application/json' }))
            a.download = 'drawing.headset.json'; a.click(); URL.revokeObjectURL(a.href)
            log.unshift({ calls: 'save()', result: 'ok' }); bump()
          })}
          <fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0 }}>
          <label style={{ border: '1px solid #aaa', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', background: '#f4f4f4' }}>Open
            <input type="file" data-testid="open" accept=".json" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              // a read returns later: it may open only if it is still the latest Open and playback has
              // not been entered since (ledger row 8; dot 1791684079)
              const mine = ++openSeq.current, gen = poseGen.current
              // the drawing is replaced only if the file opens; only then does interaction hear of it
              try {
                const text = await f.text()
                if (mine !== openSeq.current || gen !== poseGen.current) {
                  log.unshift({ calls: `open(${f.name})`, result: `✗ dropped: ${mine !== openSeq.current ? 'a later Open was started' : 'playback was entered meanwhile'}` })
                  bump(); return
                }
                const next = open(text)
                gesture.current?.cancel('opening another drawing') // only once the file opened (dot 1791554909)
                core = next
                refGen.current++
                const ls = core.snapshot().layers, top = ls[ls.length - 1]?.id ?? ''; setLayer(top); setLayers([top])
                ix.drawingChanged(); setDrawing(k => k + 1)
                log.unshift({ calls: `open(${f.name})`, result: 'ok' })
              } catch (err) { log.unshift({ calls: `open(${f.name})`, result: '✗ ' + (err as Error).message }) }
              bump()
            }} />
          </label>
          </fieldset>
        </div>
        <div style={{ display: 'flex', gap: 3 }}><fieldset disabled={!!pose || restoring} style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 3 }}>{B('demo eyes', () => { try { demo() } catch { /* already there */ } ix.historyChanged(); bump() })}{B('v2 right eye', () => { try { v2Eye() } catch { /* already there */ } ix.historyChanged(); bump() })}</fieldset></div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* one line always, and the column never widened by it (minWidth 0): a status that wrapped would resize the canvas between a press and its release and move the press (a click on a curve with long ids nudged it) */}
        <div data-testid="status" title={status} style={{ padding: '4px 8px', borderBottom: '1px solid #ccc', height: 18, lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: (pose ? corrRefusal : pv.refusal) ? '#c00' : '#333' }}>{status}</div>
        <svg ref={svg} style={{ flex: 1, background: '#fafafa', touchAction: 'none', cursor: cursorFor(pressTakenBy, pressed) }} data-testid="canvas" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={e => (viewportPress(e) ? onDown(e) : restoring ? undefined : moveRef ? onRefDown(e) : inBetween ? onPoseDown(e) : poseView ? (ix.tool === 'A' || ix.tool === 'V' ? onDown(e) : undefined) : onDown(e))}
          // hovering tells interaction what the pointer is over on the selection box (the cursor follows; selection-box plan §6)
          // the pointer's place is kept on every move and release over the canvas, a drag's too (a pan ends where the pointer
          // is, dot 1791737940); the hover is asked only with no button and no gesture — and after every render
          onPointerMove={e => {
            hoverAt.current = { clientX: e.clientX, clientY: e.clientY, mods: mods(e) }
            if (e.buttons !== 0) return
            rehover.current()
            // playback with A at a correction pose: the line under the pointer shows its handles (§2)
            // the last line hovered keeps its handles until another line is hovered, so the pointer can travel to a handle (dot 1791978385)
            if (playbackMarks) { const h = shownLineAt(toDoc(e)); if (h && h !== poseHover) setPoseHover(h) }
          }}
          onPointerUp={e => { hoverAt.current = { clientX: e.clientX, clientY: e.clientY, mods: mods(e) } }} onPointerLeave={() => { hoverAt.current = null; ix.pointerHover(null) }} onWheel={onWheel}
          // the right click itself is the unmoved right press (onDown); a right press during a left
          // drag comes only as this event, and cancels that drag (one level)
          onContextMenu={e => { e.preventDefault(); if (gesture.current && !gesture.current.right) gesture.current.cancel('a right click') }}>
          {refsHere().filter(r => r.visible).map(r0 => {
            // a live preview of this picture, if it is still bound to what is shown (§8.1, §8a.3)
            const r = refPreview && refPreview.id === r0.id && refNow(refPreview) ? { ...r0, ...refPreview.props } : r0
            const w = r.width * r.scale, h = r.height * r.scale
            return <image key={r.id} data-reference={r.id} href={r.src} x={r.x - w / 2} y={r.y - h / 2} width={w} height={h} opacity={r.opacity} preserveAspectRatio="none"
              // the picture's own left-right mirror first, then its rotation about the centre (SVG applies the list right to left)
              transform={`rotate(${r.angle} ${r.x} ${r.y})${r.flipped ? ` translate(${r.x} ${r.y}) scale(-1 1) translate(${-r.x} ${-r.y})` : ''}`} onError={() => { const at = core; setRefBroken(b => (b.some(x => x.core === at && x.id === r.id && x.src === r.src) ? b : [...b, { core: at, id: r.id, src: r.src }])) }} />
          })}
          <line x1={s.axis} x2={s.axis} y1={box.y - 1e4} y2={box.y + 1e4} stroke="#9cf" strokeDasharray={`${6 * px} ${4 * px}`} strokeWidth={px} />
          {(() => {
            const paintOf = (id: string) => {
              const l = line(id), on = selLines.includes(l.id), picked = pv.pick?.kind === 'line' && pv.pick.id === l.id
              // while posing, no edit marks: neither selection nor picks (dot 1791686247)
              return inBetween ? (l.state.locked ? '#933' : '#111') : cutLines.has(l.id) ? '#bbb' : picked ? '#f80' : pv.mirrorSource.includes(l.id) ? '#a3c' : on ? '#06f' : l.state.locked ? '#933' : '#111'
            }
            const loopsD = (loops: readonly (readonly { x: number; y: number }[])[]) => loops.map(q => 'M' + q.map(v => `${v.x} ${v.y}`).join(' L') + ' Z').join(' ')
            const defectMark = (key: string, d: string, why: string | undefined) => why !== undefined &&
              <path key={'defect' + key} data-ink-defect={key} d={d} fill="none" stroke="#e00" strokeWidth={1.5 * px} strokeDasharray={`${3 * px} ${2 * px}`}><title>{why}</title></path>
            // pieces joined by arcs: one filled path when their lines share a paint (no hairline seam, dot 1791802438); otherwise each line
            // in its own paint and the arc in the base colour under them — the state shows in the halo (a recorded limit); the shape is the
            // same either way, so selection never changes a join's shape
            const uniform = new Map<string, { group: NonNullable<typeof ink>['groups'][number]; paint: string; first: boolean }>(), arcsAlone: NonNullable<typeof ink>['pieces'][number][] = []
            for (const gr of ink?.groups ?? []) {
              const paints = new Set(gr.pieces.flatMap(p => p.source.kind === 'line' ? [paintOf(p.source.id)] : []))
              // an empty union is nothing to draw: the group falls back to its pieces (dot 1791803549)
              if (paints.size === 1 && gr.loops.length) { let first = true; for (const G of g.lines) if (gr.pieces.some(p => p.source.kind === 'line' && p.source.id === G.id)) { uniform.set(G.id, { group: gr, paint: [...paints][0]!, first }); first = false } }
              else arcsAlone.push(...gr.pieces.filter(p => p.source.kind !== 'line'))
            }
            for (const p of ink?.pieces ?? []) if (p.source.kind !== 'line' && !(ink?.groups ?? []).some(gr => gr.pieces.includes(p))) arcsAlone.push(p)
            // the canvas paints in the panel's order (dot 1791866043): layers bottom → top, each layer's curves bottom → top
            // (s.groups is that order), each curve its fills, then the halo of its selected lines, then its lines
            const rank = new Map(s.groups.flatMap((gr, i) => gr.lines.map(l => [l, i] as const)))
            const groupOfLoop = (id: string) => rank.get(s.loops.find(l => l.id === id)?.route[0]?.line ?? '') ?? -1
            // an arc's or a cusp tip's piece belongs to the curve of its lines (dot 1791866486)
            const groupOfPiece = (p: NonNullable<typeof ink>['pieces'][number]) => rank.get(p.source.kind === 'line' ? p.source.id : p.source.lines[0]) ?? -1
            const pieceEl = (p: NonNullable<typeof ink>['pieces'][number]) => { const d = loopsD(p.loops); return <g key={p.source.id}><path data-ink={p.source.id} d={d} fill="#111" stroke="none" />{defectMark(p.source.id, d, inkDefects.get(p.source.id))}</g> }
            // the arcs' debug centre line while the ink switch is off, and for an arc with no ink to draw (its diagnostic says why)
            const arcLines = (i: number) => g.arcs.filter(a => (rank.get(a.lines[0]) ?? -1) === i && (!ink || (!inkOf.has(a.key) && ink.diagnostics.some(d => d.source.id === a.key))))
              .map(a => <path key={a.key} data-arc-fallback={ink ? a.key : undefined} d={path(a.curve)} fill="none" stroke="#a50" strokeWidth={2} />)
            const lineEl = (G: (typeof g.lines)[number]) => {
              const l = line(G.id), stroke = paintOf(G.id)
              const u = uniform.get(G.id)
              if (u) {
                if (!u.first) return null
                const d = loopsD(u.group.loops), key = u.group.pieces.map(p => p.source.id).join(' ')
                return <g key={G.id}><path data-ink-group={key} d={d} fill={u.paint} fillRule="nonzero" stroke="none" />
                  {defectMark(key, d, u.group.status === 'defect' ? u.group.reason : undefined)}
                  {u.group.pieces.map(p => defectMark(p.source.id, loopsD(p.loops), inkDefects.get(p.source.id)))}</g>
              }
              const piece = l.state.visible ? inkOf.get(l.id) : undefined
              if (piece) {
                const d = loopsD(piece.loops)
                return <g key={G.id}><path data-ink={l.id} d={d} fill={stroke} fillRule="nonzero" stroke="none" />{defectMark(l.id, d, inkDefects.get(l.id))}</g>
              }
              return <path key={G.id} d={path(G.curve)} fill="none" stroke={stroke} strokeWidth={(l.stroke.width + (l.stroke.widthB ?? l.stroke.width)) / 2}
                strokeDasharray={l.state.visible ? undefined : `${4 * px} ${4 * px}`} opacity={l.state.visible ? 1 : 0.35} strokeLinecap="round" />
            }
            return <>
              {/* nothing should lie outside a curve; if something does, it is drawn at the bottom rather than lost */}
              {arcsAlone.filter(p => groupOfPiece(p) === -1).map(pieceEl)}
              {g.lines.filter(G => !rank.has(G.id)).map(lineEl)}
              {arcLines(-1)}
              {s.groups.map((gr, i) => <g key={'paint' + gr.id} data-paint-group={gr.id}>
                {g.fills.filter(f => f.visible && groupOfLoop(f.id) === i).map(f => <path key={f.id} data-fill={f.id}
                  // a masked fill: its area as the masks leave it (docs/mask-p1-checklist.md §2)
                  data-masked={masksOf.has(`fill:${f.id}`) ? '' : undefined} fillRule="nonzero"
                  d={masksOf.has(`fill:${f.id}`) ? loopsD(maskApply(maskArea(f.parts.map(p => p.curve as unknown as [Vec, Vec, Vec, Vec])), masksOf.get(`fill:${f.id}`)!)) : f.parts.map((p, i) => (i ? path(p.curve).replace(/^M[^C]*/, '') : path(p.curve))).join(' ') + ' Z'}
                  fill={f.color} opacity={cutLines.size && s.loops.find(l => l.id === f.id)?.route.every(u => cutLines.has(u.line)) ? 0.35 : 1}
                  stroke={!inBetween && isSel({ kind: 'fill', id: f.id }) ? '#06f' : 'none'} strokeWidth={2 * px} />)}
                {/* the selection reads at a glance (bowen 1791558186): a wide blue halo under each selected line */}
                {!inBetween && g.lines.filter(G => rank.get(G.id) === i && selLines.includes(G.id)).map(G => <path key={'halo' + G.id} d={path(G.curve)} fill="none" stroke="#2a7fff" strokeOpacity={0.3}
                  strokeWidth={Math.max(line(G.id).stroke.width, line(G.id).stroke.widthB ?? 0) + 8 * px} strokeLinecap="round" />)}
                {arcsAlone.filter(p => groupOfPiece(p) === i).map(pieceEl)}
                {g.lines.filter(G => rank.get(G.id) === i).map(lineEl)}
                {arcLines(i)}
              </g>)}
            </>
          })()}
          {/* the selection box (bowen 1791558733): solid blue = wholly inside (dragged right), dashed green = touching (dragged left) */}
          {!inBetween && pv.box && <rect x={Math.min(pv.box.from.x, pv.box.to.x)} y={Math.min(pv.box.from.y, pv.box.to.y)} width={Math.abs(pv.box.to.x - pv.box.from.x)} height={Math.abs(pv.box.to.y - pv.box.from.y)}
            fill={pv.box.whole ? 'rgba(42,127,255,0.08)' : 'rgba(40,170,90,0.08)'} stroke={pv.box.whole ? '#2a7fff' : '#28aa5a'} strokeWidth={px}
            strokeDasharray={pv.box.whole ? undefined : `${5 * px} ${3 * px}`} />}
          {/* the selection reads at a glance (bowen 1791558186): a wide blue halo under each selected line (drawn with its curve), and a dashed box around it all —
              one box, one extent (dot 1791737043, 1791737260): where the selection box is drawn (V / A) it is that box; elsewhere
              (another tool, Move picture) the same frame — core's bounds of what a transform moves — without handles */}
          {!inBetween && !boxShown && (() => {
            const units = sel.filter(u => u.kind === 'line' || u.kind === 'point' || u.kind === 'handle'), b = units.length ? core.in(shown).selectionBounds(units) : null
            return b && <rect data-selection-outline="" x={b.min.x} y={b.min.y} width={b.max.x - b.min.x} height={b.max.y - b.min.y}
              fill="none" stroke="#2a7fff" strokeWidth={px} strokeDasharray={`${3 * px} ${2 * px}`} pointerEvents="none" />
          })()}
          {/* the pending mark (stage 2): an orange dot on each line whose front differs from the baseline — on the selected
              layers only: nothing is drawn on a layer that is not selected (bowen 1791899291, 1791553331) */}
          {!inBetween && g.lines.filter(G => pending.includes(G.id) && selLayers.includes(s.points.find(p => p.id === line(G.id).a)?.layer ?? '')).map(G => { const m = mid(G.curve); return <circle key={'pending' + G.id} data-pending={G.id} cx={m.x} cy={m.y} r={4 * px} fill="#f80" stroke="#fff" strokeWidth={px} /> })}
          {/* playback on a line: the drag's ghost at start + displacement (stage 3b package 5); the points are not marked
              (bowen 1791908866) — a press near one still picks it */}
          {/* playback batches (docs/playback-tools-checklist.md §1, §3): the drag's previewed correct, the box being dragged, the selection and its box */}
          {pose && batchGhost && batchGhost.lines.map(l => <path key={'bg' + l.id} data-ghost={l.id} d={path(l.curve)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {pose && batchGhost && batchGhost.points.map(q => <circle key={'gp' + q.id} data-ghost-point={q.id} cx={q.position.x} cy={q.position.y} r={4 * px} fill="#06f" />)}
          {pose && batchGhost && batchGhost.arcs.map(a => <path key={'ba' + a.key} data-ghost-arc={a.key} d={path(a.curve)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {pose && pbBox && <rect data-pb-box="" x={Math.min(pbBox.from.x, pbBox.to.x)} y={Math.min(pbBox.from.y, pbBox.to.y)} width={Math.abs(pbBox.to.x - pbBox.from.x)} height={Math.abs(pbBox.to.y - pbBox.from.y)}
            fill="rgba(0,102,255,0.06)" stroke="#06f" strokeDasharray={pbBox.to.x >= pbBox.from.x ? undefined : `${3 * px} ${3 * px}`} strokeWidth={px} />}
          {atCorrection && !batchGhost && pbIds.map(pid => { const p = s.points.find(q => q.id === pid); return p ? <circle key={'ps' + pid} data-pb-selected={pid} cx={p.position.x} cy={p.position.y} r={3.5 * px} fill="#06f" stroke="#fff" strokeWidth={px} /> : null })}
          {pbFrame && (() => {
            const f = pbFrame, c = '#a35ac0', poly = (ps: readonly Vec[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
            return <g data-testid="pb-deform-frame" pointerEvents="none">
              {f.grid.map((gr, i) => <path key={'gr' + i} d={poly(gr)} fill="none" stroke={c} strokeDasharray={`${4 * px} ${4 * px}`} opacity={0.4} strokeWidth={px} />)}
              {f.edges.map((ed, i) => <path key={'ed' + i} d={poly(ed)} fill="none" stroke={c} strokeWidth={1.5 * px} />)}
              {f.handles.map(h => <g key={'h' + h.edge + h.handle}><line x1={h.anchor.x} y1={h.anchor.y} x2={h.at.x} y2={h.at.y} stroke={c} opacity={0.65} strokeWidth={px} />
                <circle data-pb-deform-handle={`${h.edge}:${h.handle}`} cx={h.at.x} cy={h.at.y} r={4.5 * px} fill="#fff" stroke={c} strokeWidth={1.5 * px} /></g>)}
              {f.midpoints.map(m => <path key={'m' + m.edge} d={`M${m.at.x} ${m.at.y - 5 * px} l${5 * px} ${5 * px} ${-5 * px} ${5 * px} ${-5 * px} ${-5 * px} Z`} fill={c} stroke="#fff" strokeWidth={px} />)}
              {f.corners.map((q, i) => <rect key={'c' + i} data-pb-deform-corner={i} x={q.x - 6 * px} y={q.y - 6 * px} width={12 * px} height={12 * px} fill="#fff" stroke={c} strokeWidth={2 * px} />)}
            </g>
          })()}
          {atCorrection && !batchGhost && !pbFrame && pbBounds && <g data-pb-selection-box="">
            <rect x={pbBounds.min.x} y={pbBounds.min.y} width={pbBounds.max.x - pbBounds.min.x} height={pbBounds.max.y - pbBounds.min.y} fill="none" stroke="#06f" strokeWidth={px} />
            {handlesOf(pbBounds, px).map(h => <rect key={h.id} data-pb-handle={h.id} x={h.at.x - 3.5 * px} y={h.at.y - 3.5 * px} width={7 * px} height={7 * px} fill="#fff" stroke="#06f" strokeWidth={px} />)}
          </g>}
          {/* playback with A at a correction pose (§2, §3): the visible lines' end points, the hovered line's handles, a ring on a point corrected here */}
          {pose && playbackMarks && hoverLine && [hoverLine].flatMap(l => (['a', 'b'] as const).map(end => {
            const point = pos(end === 'a' ? l.a : l.b), tip = add(point, end === 'a' ? l.ha : l.hb), here = correctedHere.handles.has(`${l.id}:${end}`)
            return <g key={'ph' + l.id + end} data-pose-handle={`${l.id}:${end}`}><line x1={point.x} y1={point.y} x2={tip.x} y2={tip.y} stroke="#888" strokeWidth={px} />
              <rect x={tip.x - 3 * px} y={tip.y - 3 * px} width={6 * px} height={6 * px} fill={here ? '#f80' : '#fff'} stroke="#06f" strokeWidth={px} /></g>
          }))}
          {pose && playbackMarks && [...shownEnds].filter(pid => selLayers.includes(s.points.find(p => p.id === pid)!.layer)).map(pid => { const p = pos(pid), here = correctedHere.points.has(pid)
            return <g key={'pm' + pid} data-pose-point={pid}>{here && <circle data-corrected-here={pid} cx={p.x} cy={p.y} r={6.5 * px} fill="none" stroke="#f80" strokeWidth={1.5 * px} />}
              <circle cx={p.x} cy={p.y} r={3 * px} fill="#fff" stroke="#06f" strokeWidth={px} /></g> })}
          {!inBetween && ghostLines.map((c, i) => <path key={'g' + i} data-drag-ghost={i} d={path(c)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {/* the selection box (docs/selection-box-plan.md): not in playback, while restoring or with Move picture — nor hit there */}
          {!inBetween && !restoring && !moveRef && pv.transform && pv.transform.lines.map(l => <path key={'t' + l.id} data-transform-ghost={l.id} d={path(l.curve)} fill="none" stroke={pv.transform!.refused ? '#c00' : '#06f'} strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {!inBetween && !restoring && !moveRef && pv.transform && pv.transform.arcs.map(a => <path key={'ta' + a.key} data-transform-ghost-arc={a.key} d={path(a.curve)} fill="none" stroke="#06f" strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
          {boxShown && pv.selectionBox && (() => {
            const b = pv.transform?.box ?? pv.selectionBox, top = pv.selectionBox.handles.find(h => h.id === 'rotate')
            return <g data-selection-box="" pointerEvents="none">
              <rect x={b.min.x} y={b.min.y} width={b.max.x - b.min.x} height={b.max.y - b.min.y} fill="none" stroke={pv.transform?.refused ? '#c00' : '#2a7fff'} strokeWidth={px} strokeDasharray={`${3 * px} ${2 * px}`} />
              {top && !pv.transform && <line x1={top.at.x} y1={top.at.y} x2={top.at.x} y2={pv.selectionBox.min.y} stroke="#2a7fff" strokeWidth={px} />}
              {!pv.transform && pv.selectionBox.handles.map(h => h.id === 'rotate'
                ? <circle key={h.id} data-box-handle={h.id} cx={h.at.x} cy={h.at.y} r={4.5 * px} fill={pv.selectionBox!.hot === h.id ? '#2a7fff' : '#fff'} stroke="#2a7fff" strokeWidth={px} />
                : <rect key={h.id} data-box-handle={h.id} x={h.at.x - 3.5 * px} y={h.at.y - 3.5 * px} width={7 * px} height={7 * px} fill={pv.selectionBox!.hot === h.id ? '#2a7fff' : '#fff'} stroke="#2a7fff" strokeWidth={px} />)}
            </g>
          })()}
          {/* the 四角 / 曲边 frame, drawn from the same data interaction hits (v103 DeformCageOverlay, its sizes in screen pixels) */}
          {!inBetween && !restoring && pv.deform && (() => {
            const f = pv.deform.frame, c = '#a35ac0', poly = (ps: readonly Vec[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
            return <g data-testid="deform-frame" pointerEvents="none">
              {pv.deform.lines?.map(l => <path key={'dg' + l.id} data-deform-ghost={l.id} d={path(l.curve)} fill="none" stroke={pv.deform!.refused ? '#c00' : c} strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
              {pv.deform.arcs?.map(a => <path key={'da' + a.key} data-deform-ghost-arc={a.key} d={path(a.curve)} fill="none" stroke={c} strokeDasharray={`${4 * px} ${3 * px}`} strokeWidth={1.5 * px} />)}
              {f.grid.map((g, i) => <path key={'gr' + i} d={poly(g)} fill="none" stroke={c} strokeDasharray={`${4 * px} ${4 * px}`} opacity={0.4} strokeWidth={px} />)}
              {f.edges.map((e, i) => <path key={'ed' + i} data-deform-edge={i} d={poly(e)} fill="none" stroke={c} strokeWidth={1.5 * px} />)}
              {f.handles.map(h => <g key={'h' + h.edge + h.handle}>
                <line x1={h.anchor.x} y1={h.anchor.y} x2={h.at.x} y2={h.at.y} stroke={c} opacity={0.65} strokeWidth={px} />
                <circle data-deform-handle={`${h.edge}:${h.handle}`} cx={h.at.x} cy={h.at.y} r={4.5 * px} fill="#fff" stroke={c} strokeWidth={1.5 * px} />
              </g>)}
              {f.midpoints.map(m => <path key={'m' + m.edge} data-deform-midpoint={m.edge} d={`M${m.at.x} ${m.at.y - 5 * px} l${5 * px} ${5 * px} ${-5 * px} ${5 * px} ${-5 * px} ${-5 * px} Z`} fill={c} stroke="#fff" strokeWidth={px} />)}
              {f.corners.map((q, i) => <rect key={'c' + i} data-deform-corner={i} x={q.x - 6 * px} y={q.y - 6 * px} width={12 * px} height={12 * px} fill="#fff" stroke={c} strokeWidth={2 * px} />)}
            </g>
          })()}
          {!inBetween && pv.handles.map(({ line: id, end }) => {
            const l = line(id), p = pos(l[end]), h = add(p, end === 'a' ? l.ha : l.hb), on = isSel({ kind: 'handle', line: id, end })
            return <g key={id + end}>
              <line x1={p.x} y1={p.y} x2={h.x} y2={h.y} stroke="#888" strokeWidth={px} />
              <rect x={h.x - 3 * px} y={h.y - 3 * px} width={6 * px} height={6 * px} fill={on ? '#06f' : '#fff'} stroke="#555" strokeWidth={px} />
            </g>
          })}
          {!inBetween && s.points.filter(p => pvPoints.has(p.id)).map(p => {
            const on = isSel({ kind: 'point', id: p.id }), picked = pv.pick?.kind === 'point' && pv.pick.id === p.id
            return <circle key={p.id} cx={p.position.x} cy={p.position.y} r={(p.links.length ? 5 : 3.5) * px}
              fill={picked ? '#f80' : on ? '#06f' : p.links.length ? '#fc0' : '#fff'} stroke="#333" strokeWidth={px} />
          })}
          {!inBetween && pv.pen && 'at' in pv.pen && <circle cx={pv.pen.at.x} cy={pv.pen.at.y} r={3 * px} fill="#f80" />}
          {/* the selected lines' or curves' names (name-labels/): the scoped selection, never taking a press, not in playback */}
          {!inBetween && labelsFor(g.lines.map(G => ({ id: G.id, name: line(G.id).name, mid: middleOf(G.curve) })), s.groups.map(gr => ({ id: gr.id, name: gr.name, lines: gr.lines })), selLines, labelKind).map(lb =>
            <text key={lb.key} data-label={lb.key} x={lb.at.x + 6 * px} y={lb.at.y - 6 * px} fontSize={12 * px} fill="#123" stroke="#fff" strokeWidth={3 * px} paintOrder="stroke" pointerEvents="none" style={{ userSelect: 'none' }}>{lb.text}</text>)}
          {refusalAt.map((p, i) => <g key={'x' + i} stroke="#d00" strokeWidth={2.5 * px}>
            <line x1={p.x - 6 * px} y1={p.y - 6 * px} x2={p.x + 6 * px} y2={p.y + 6 * px} /><line x1={p.x - 6 * px} y1={p.y + 6 * px} x2={p.x + 6 * px} y2={p.y - 6 * px} />
          </g>)}
        </svg>
        <div style={{ height: 120, overflow: 'auto', padding: '2px 8px', borderTop: '1px solid #ccc', font: '11px ui-monospace, monospace' }}>
          {log.map((r, i) => <div key={log.length - i} style={{ color: r.result.startsWith('ok') ? '#333' : '#c00' }}>{r.result.startsWith('ok') ? '✓' : r.result} · {r.calls || '(no call)'}</div>)}
        </div>
        <div style={{ padding: '2px 8px', color: '#888', borderTop: '1px solid #eee' }}>
          wheel or Z (drag up / down, click) zooms · right- or middle-drag pans · Esc / right-click cancels · ⌘Z / ⇧⌘Z · ⌘C ⌘X ⌘V · Delete · window.bench = {'{ core, ix, refresh, svg, log }'}
        </div>
      </div>
      <LayersPanel key={drawing} s={s} g={g} selected={selLayers} active={drawLayer} select={selectLayers} run={run} newLayerId={() => nid('layer-')} onPick={setLabelKind}
        zones={zones} slider={sliderHooks} toolRadius={opts.radius} canvasSubject={canvasSubject} canvasPicks={canvasPicks} joinScope={`${drawing}|${shown}`} />
    </div>
  )
}
