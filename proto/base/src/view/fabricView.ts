// Fabric.js 7.4.0 (MIT) used ONLY as the display / interaction shell (route B, docs/design/architecture/14, 15).
// Fabric objects are disposable projections of our document: after every gesture we re-project from
// the document, so anything Fabric mutated (drag, scaling, ActiveSelection exit baking) is discarded.
//   Canvas / Group / Path / getScenePoint / calcTransformMatrix:
//   https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/canvas/SelectableCanvas.ts
//   Group transform kept as an attribute (we read its matrix, we never trust its children):
//   https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/shapes/Group.ts
// A-mode hits use OUR hit test on the evaluated geometry (src/evaluate.ts), not Fabric's bbox test.
import { ActiveSelection, Canvas, Circle, Group, Path, util, type FabricObject, type TMat2D } from 'fabric'
import { Store } from '@tldraw/store'
import type { Command, EditError } from '../commands'
import type { Editor } from '../editor'
import { cubicsToPath, evaluate, hitTest, type Evaluated, type Hit } from '../evaluate'
import { evaluateAtYaw, type PoseTrack } from '../pose'
import { all } from '../model'
import { schema, type Affine, type ContainerRecord, type DocRecord, type Vec } from '../schema'

export type UiLogEntry = { source: 'ui'; cmd: Command; ok: boolean; written: boolean; error?: EditError }

const toAffine = (m: TMat2D): Affine => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] })

export class FabricView {
  readonly canvas: Canvas
  mode: 'A' | 'V' = 'A'
  /** In A mode, editing an anchor seen through a reference writes an override unless this is true. */
  editSource = false
  readonly log: UiLogEntry[] = []
  status = ''
  private drag: { hit: Extract<Hit, { kind: 'anchor' | 'handle' }>; start: Vec; cmd?: Command; ok: boolean } | null = null
  private groupStart = new Map<FabricObject, TMat2D>()
  /** True while we re-project. Fabric fires `object:modified` again when we remove an object that
   *  is still the current transform target (endCurrentTransform → _finalizeCurrentTransform), which
   *  would write the same transform twice. Found by the e2e slice; see 15 §4 risk 1 of route B. */
  private projecting = false
  /** Number of re-entrant `object:modified` events ignored (evidence for the risk report). */
  ignoredReentrantEvents = 0
  /** Onion skins: faint projections of the same drawing at other yaws (benchmark input, 15 §2). */
  onion: { track: PoseTrack; yaws: number[] } | null = null
  /** Input→display latency samples (ms): pointermove timeStamp → first animation frame after our render. */
  readonly latencies: number[] = []
  private lastInputTs = 0

  constructor(
    el: HTMLCanvasElement,
    readonly editor: Editor,
    private onStatus: (s: string) => void = () => {},
  ) {
    this.canvas = new Canvas(el, { selection: true, preserveObjectStacking: true })
    this.canvas.setViewportTransform([3, 0, 0, 3, 150, 60])
    // Fabric caches its target before 'mouse:down:before' fires, so we route V-mode targets in a
    // capture-phase listener on Fabric's wrapper element (public `wrapperEl`), which runs first.
    for (const type of ['pointerdown', 'mousedown'] as const) {
      this.canvas.wrapperEl.addEventListener(type, (e) => this.routeVTarget(e as PointerEvent), { capture: true })
    }
    this.canvas.wrapperEl.addEventListener('pointermove', (e) => (this.lastInputTs = e.timeStamp), { capture: true })
    this.canvas.on('mouse:down', (o) => this.onDown(o.e as PointerEvent))
    this.canvas.on('mouse:move', (o) => this.onMove(o.e as PointerEvent))
    this.canvas.on('mouse:up', () => this.onUp())
    this.canvas.on('object:modified', (o) => this.onModified(o.target as FabricObject))
    // Whatever Fabric does when a multi-selection ends, the document is the only truth: re-project.
    this.canvas.on('selection:cleared', () => {
      if (!this.projecting) queueMicrotask(() => this.render())
    })
    this.render()
  }

  setMode(mode: 'A' | 'V') {
    this.mode = mode
    this.canvas.discardActiveObject()
    this.render()
  }

  cancelGesture() {
    if (!this.drag) return false
    this.drag = null
    this.setStatus('已取消')
    this.render()
    return true
  }

  private setStatus(s: string) {
    this.status = s
    this.onStatus(s)
  }

  /** Re-project the document (or a preview of it) into Fabric objects. */
  render(ev: Evaluated = evaluate(this.editor.store), store = this.editor.store) {
    this.projecting = true
    try {
      this.project(ev, store)
    } finally {
      this.projecting = false
    }
  }

  private project(ev: Evaluated, store: Editor['store']) {
    this.canvas.discardActiveObject()
    this.canvas.remove(...this.canvas.getObjects())
    if (this.onion) {
      // All onion yaws share the already-prepared evaluation `ev` (no re-parse of the document).
      for (const yaw of this.onion.yaws) {
        const o = evaluateAtYaw(store, this.onion.track, yaw, ev)
        for (const c of o.curves.filter((c) => c.visible)) {
          this.canvas.add(new Path(cubicsToPath(c.segments.map((s) => s.cubic)), { fill: '', stroke: 'rgba(120,120,200,0.25)', strokeWidth: 0.4, selectable: false, evented: false, objectCaching: false }))
        }
      }
    }
    this.groupStart.clear()
    for (const f of ev.fills.filter((f) => f.visible)) {
      this.canvas.add(new Path(cubicsToPath(f.cubics, true), { fill: f.color, stroke: '', selectable: false, evented: false, objectCaching: false }))
    }
    const containers = all(this.editor.store, 'container') as ContainerRecord[]
    const curves = ev.curves.filter((c) => c.visible)
    const pathOf = (c: (typeof curves)[number]) =>
      new Path(cubicsToPath(c.segments.map((s) => s.cubic)), {
        fill: '',
        stroke: c.locked ? '#999' : c.stroke.color,
        strokeWidth: c.stroke.width / 3,
        selectable: false,
        evented: false,
        objectCaching: false,
      })
    if (this.mode === 'V') {
      // One selectable Group per top-level, unlocked container; its transform box is Fabric's.
      for (const k of containers.filter((k) => !k.parentId)) {
        const members = curves.filter((c) => !c.referenceId && this.parentOf(c.curveId) === k.id)
        if (!members.length) continue
        const locked = members.some((c) => c.locked)
        const g = new Group(members.map(pathOf), { selectable: !locked, evented: !locked, objectCaching: false })
        ;(g as any).containerId = k.id
        ;(g as any).lockedGroup = locked
        this.groupStart.set(g, g.calcTransformMatrix())
        this.canvas.add(g)
      }
      for (const c of curves.filter((c) => c.referenceId)) this.canvas.add(pathOf(c))
    } else {
      for (const c of curves) this.canvas.add(pathOf(c))
      for (const c of curves.filter((c) => !c.locked)) {
        for (const a of Object.values(c.anchors)) {
          this.canvas.add(dot(a.p, '#1565c0', 1.4), dot(a.hIn, '#90caf9', 0.9), dot(a.hOut, '#90caf9', 0.9))
        }
      }
    }
    this.canvas.requestRenderAll()
  }

  private parentOf(curveId: string) {
    return (this.editor.store.get(curveId as any) as any)?.parentId as string | undefined
  }

  /**
   * V mode: decide the target with OUR hit test on the evaluated geometry (not Fabric's bounding
   * boxes, which overlap between layers). Only the hit container's group stays `evented`, so
   * Fabric's public target search lands on it. Groups already in the active selection stay evented.
   */
  private routeVTarget(e: PointerEvent) {
    if (this.mode !== 'V') return
    const p = this.canvas.getScenePoint(e)
    const hit = hitTest(evaluate(this.editor.store), p, { mode: 'V', tolerance: 6 / this.canvas.getZoom() })
    const target = hit ? this.containerOfHit(hit) : undefined
    const active = new Set(this.canvas.getActiveObjects())
    for (const g of this.groupStart.keys()) {
      const locked = (g as any).lockedGroup
      g.evented = !locked && ((g as any).containerId === target || active.has(g))
    }
  }

  private containerOfHit(hit: Hit): string | undefined {
    const recId = hit.kind === 'fill' ? hit.address : hit.curveId
    let id = (this.editor.store.get(recId as any) as any)?.parentId as string | undefined
    // climb to the top-level container (one group per top-level container)
    for (let k = this.editor.store.get(id as any) as any; k?.parentId; k = this.editor.store.get(k.parentId)) id = k.parentId
    return id
  }

  // ---- A mode: our own hit test + preview, apply once on release ----
  private onDown(e: PointerEvent) {
    if (this.mode !== 'A') return
    const p = this.canvas.getScenePoint(e)
    const hit = hitTest(evaluate(this.editor.store), p, { mode: 'A', tolerance: 6 / this.canvas.getZoom() })
    if (hit && (hit.kind === 'anchor' || hit.kind === 'handle')) this.drag = { hit, start: { x: p.x, y: p.y }, ok: false }
  }

  private commandFor(hit: Extract<Hit, { kind: 'anchor' | 'handle' }>, delta: Vec): Command {
    const target = { curveId: hit.curveId, anchorId: hit.anchorId }
    if (hit.kind === 'handle') return { type: 'moveHandle', target, handle: hit.handle, delta }
    if (hit.referenceId && !this.editSource) {
      // The reference is mirrored: convert the screen-space delta into the source's local space.
      const r = this.editor.store.get(hit.referenceId) as any
      const inv = util.invertTransform([r.transform.a, r.transform.b, r.transform.c, r.transform.d, 0, 0])
      return { type: 'moveOverride', referenceId: hit.referenceId, target, delta: { x: inv[0] * delta.x + inv[2] * delta.y, y: inv[1] * delta.x + inv[3] * delta.y } }
    }
    return { type: 'moveAnchors', targets: [target], delta }
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) return
    const p = this.canvas.getScenePoint(e)
    const delta = { x: round(p.x - this.drag.start.x), y: round(p.y - this.drag.start.y) }
    const cmd = this.commandFor(this.drag.hit, delta)
    const pv = this.editor.preview(cmd)
    this.drag.cmd = cmd
    this.drag.ok = pv.ok
    if (pv.ok) {
      this.setStatus('')
      const tmp = withPuts(this.editor, pv.puts)
      this.render(evaluate(tmp), tmp)
      const t0 = this.lastInputTs
      requestAnimationFrame(() => this.latencies.push(performance.now() - t0))
    } else {
      this.setStatus(`${pv.error.code}: ${pv.error.message}`) // whole gesture rejected; show the document unchanged
      this.render()
    }
  }

  private onUp() {
    const d = this.drag
    this.drag = null
    if (!d?.cmd) return
    if (d.ok) this.applyAndLog(d.cmd)
    else this.log.push({ source: 'ui', cmd: d.cmd, ok: false, written: false, error: this.editor.preview(d.cmd).ok ? undefined : (this.editor.preview(d.cmd) as any).error })
    this.render()
  }

  // ---- V mode: Fabric's transform box; we read the matrix change and apply it to the document ----
  private onModified(target: FabricObject) {
    if (this.projecting) {
      this.ignoredReentrantEvents++
      return
    }
    const groups = target instanceof ActiveSelection ? (target.getObjects() as FabricObject[]) : [target]
    const cmds: Command[] = []
    for (const g of groups) {
      const start = this.groupStart.get(g)
      const containerId = (g as any).containerId
      if (!start || !containerId) continue
      const now = g.calcTransformMatrix() // includes the ActiveSelection's own transform, if any
      const delta = util.multiplyTransformMatrices(now, util.invertTransform(start))
      cmds.push({ type: 'transformContainer', containerId, matrix: toAffine(delta.map(round) as TMat2D) })
    }
    if (cmds.length === 1) this.applyAndLog(cmds[0])
    else if (cmds.length > 1) {
      try {
        this.editor.batch('V transform', () => cmds.forEach((c) => this.applyAndLog(c, true)))
      } catch {
        /* failure already logged; batch restored the document */
      }
    }
    // Re-project only after Fabric has finished its own mouse-up bookkeeping.
    queueMicrotask(() => this.render())
  }

  private applyAndLog(cmd: Command, throwOnFail = false) {
    const r = this.editor.apply(cmd)
    this.log.push({ source: 'ui', cmd, ok: r.ok, written: r.written, error: r.ok ? undefined : r.error })
    this.setStatus(r.ok ? '' : `${r.error.code}: ${r.error.message}`)
    if (!r.ok && throwOnFail) throw new Error(r.error.message)
    return r
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000

function dot(p: Vec, color: string, r: number) {
  return new Circle({ left: p.x, top: p.y, radius: r, fill: color, originX: 'center', originY: 'center', selectable: false, evented: false })
}

/** Evaluate a preview without touching the document: a throwaway store with the planned records. */
export function withPuts(editor: Editor, puts: DocRecord[]) {
  const tmp = new Store<DocRecord>({ schema, props: {} })
  tmp.loadStoreSnapshot(editor.store.getStoreSnapshot())
  tmp.put(puts)
  return tmp
}
