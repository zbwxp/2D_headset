// Fabric.js 7.4.0 (MIT) used ONLY as the display / interaction shell (route B, docs/design/architecture/14, 15).
// Fabric objects are disposable projections of our document: after every gesture we re-project from
// the document, so anything Fabric mutated (drag, scaling, ActiveSelection exit baking) is discarded.
//   Canvas / Group / Path / getScenePoint / calcTransformMatrix:
//   https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/canvas/SelectableCanvas.ts
//   Group transform kept as an attribute (we read its matrix, we never trust its children):
//   https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/shapes/Group.ts
// A-mode hits use OUR hit test on the evaluated geometry (src/evaluate.ts), not Fabric's bbox test.
import { Canvas2DRef } from './canvas2dRef'
import { childrenOf } from '../indexes'
import { counters } from '../counters'
import { ActiveSelection, Canvas, Circle, Group, Path, util, type FabricObject, type TMat2D } from 'fabric'
import { Store } from '@tldraw/store'
import type { Command, EditError } from '../commands'
import type { Editor, Operation } from '../editor'
import { cubicsToCommands, evaluate, FILL_RULE, hitTest, inkStyle, unappliedContainerOpacity, unappliedDepthOffsets, type EvalCurve, type EvalFill, type Evaluated, type Hit, type PaintItem } from '../evaluate'
import { cubicsPath2D, ownInkPath2D } from './ownInk'
import { OwnInkFill } from './ownInkFill'
import { all } from '../model'
import { topContainerOfHit } from '../select'
import { schema, type Affine, type ContainerRecord, type DocRecord, type Vec } from '../schema'

export type UiLogEntry = { source: 'ui'; cmd: Command; ok: boolean; written: boolean; error?: EditError }

const toAffine = (m: TMat2D): Affine => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] })

export class FabricView {
  readonly canvas: Canvas
  mode: 'A' | 'V' = 'A'
  /** In A mode, editing an anchor seen through a reference writes an override unless this is true. */
  editSource = false
  readonly log: UiLogEntry[] = []
  /** Gestures refused before any command could be formed (e.g. unsupported reference handle edits). */
  readonly rejections: { address: string; error: EditError }[] = []
  status = ''
  /** one drag = one prepared operation: fixed start generation and new ids, re-planned on every move */
  private drag: { hit: Extract<Hit, { kind: 'anchor' | 'handle' }>; start: Vec; op: Operation; cmd?: Command; ok: boolean; rejected?: EditError; error?: EditError } | null = null
  private groupStart = new Map<FabricObject, TMat2D>()
  /** True while we re-project. Fabric fires `object:modified` again when we remove an object that
   *  is still the current transform target (endCurrentTransform → _finalizeCurrentTransform), which
   *  would write the same transform twice. Found by the e2e slice; see 15 §4 risk 1 of route B. */
  private projecting = false
  /** Number of re-entrant `object:modified` events ignored (evidence for the risk report). */
  ignoredReentrantEvents = 0
  private vTransforming = false
  private vCancelled = false
  /** Onion skins: faint projections of the same drawing at other yaws (benchmark input, 15 §2). */
  /** onion skins: the document at these yaws (forms come from the curves' pose records) */
  onion: { yaws: number[] } | null = null
  /** Input→display latency samples (ms): pointermove timeStamp → first animation frame after our render. */
  readonly latencies: number[] = []
  /** Drawing-path phase timings in ms, accumulated (dot: measure before deciding how the canvas changes). */
  readonly timing = { plan: 0, previewChanges: 0, assemble: 0, containerScan: 0, buildObjects: 0, attach: 0, renderAll: 0, renders: 0, moves: 0, inputToDrawDone: 0, drawsAfterInput: 0 }
  resetTiming() {
    for (const k of Object.keys(this.timing) as (keyof FabricView['timing'])[]) this.timing[k] = 0
  }
  private lastInputTs = 0

  constructor(
    el: HTMLCanvasElement,
    readonly editor: Editor,
    private onStatus: (s: string) => void = () => {},
  ) {
    this.canvas = new Canvas(el, { selection: true, preserveObjectStacking: true })
    this.canvas.setViewportTransform([3, 0, 0, 3, 150, 60])
    // Time the MAIN canvas render only: Fabric also fires after:render for the top layer (renderTop,
    // ctx = contextTop) — counting those doubled the renders and mis-timed them (found 2026-10-06).
    let renderStart = 0
    let paintedInput = 0
    this.canvas.on('before:render', (e) => {
      if ((e as { ctx?: unknown }).ctx !== this.canvas.contextTop) renderStart = performance.now()
    })
    this.canvas.on('after:render', (e) => {
      // while B draws (A mode with B set) Fabric's main canvas is empty and B times its own draws; in
      // V mode Fabric draws and is timed even when B is set (dot 0264deb: V renders were not counted)
      if ((e as { ctx?: unknown }).ctx === this.canvas.contextTop || this.refDraws) return
      const now = performance.now()
      this.timing.renderAll += now - renderStart
      this.timing.renders++
      // input → draw call done: from the latest pointer event to the end of the main canvas render it
      // caused. This does NOT prove the pixels are on screen (compositing / display not included; dot).
      if (this.lastInputTs > paintedInput) {
        this.timing.inputToDrawDone += now - this.lastInputTs
        this.timing.drawsAfterInput++
        paintedInput = this.lastInputTs
      }
    })
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
    this.canvas.on('before:transform', () => {
      this.vTransforming = true
      this.vCancelled = false
    })
    this.canvas.on('mouse:up', () => {
      // a cancelled transform may end without object:modified (nothing changed): clear the flags
      if (this.vCancelled) queueMicrotask(() => ((this.vCancelled = false), (this.vTransforming = false)))
    })
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
    if (this.drag) {
      this.drag.op.cancel()
      this.drag = null
      this.setStatus('已取消')
      this.render()
      return true
    }
    if (this.vTransforming) {
      // V-mode cancel: drop Fabric's in-progress transform by re-projecting the document. Fabric
      // fires object:modified when the transform ends; `vCancelled` makes us ignore it.
      this.vCancelled = true
      this.setStatus('已取消')
      this.render()
      return true
    }
    return false
  }

  private setStatus(s: string) {
    this.status = s
    this.onStatus(s)
  }

  /** Re-project the document (or a preview of it) into Fabric objects. */
  render(ev: Evaluated = this.editor.derived.evaluated(), onions: Evaluated[] = this.onion ? this.onion.yaws.map((y) => this.editor.derived.atYaw(y)) : []) {
    this.projecting = true
    try {
      // depth offsets are stored but not applied yet (PAINT-ORDER.md D1): say so, never silently
      const ignored = unappliedDepthOffsets(ev)
      const opacity = unappliedContainerOpacity(this.editor.reader as any)
      if (ignored.length !== this.unappliedDepthOffsets.length || opacity.length !== this.unappliedContainerOpacity.length) {
        const notes = [ignored.length ? `深度偏移尚未生效（D1 未定）：${ignored.length} 个对象` : '', opacity.length ? `图层不透明度当前不支持（未生效）：${opacity.length} 个图层` : '']
        this.setStatus(notes.filter(Boolean).join('；'))
      }
      this.unappliedDepthOffsets = ignored
      this.unappliedContainerOpacity = opacity
      this.project(ev, onions)
      // every render rebuilds the whole scene today: count what was rebuilt (dot: canvas rebuild counts)
      counters.canvasObjects += this.canvas.getObjects().length
    } finally {
      this.projecting = false
    }
  }

  /** Addresses whose stored depth offset the paint order does not apply yet (D1). */
  unappliedDepthOffsets: string[] = []
  /** Containers whose stored opacity the current base does not apply (scope limit, D7). */
  unappliedContainerOpacity: string[] = []

  /**
   * Scene of the last A-mode projection, for incremental updates (dot's option A: the SAME display,
   * reusing Fabric objects). One entry per drawn item in z-order, with the evaluated item it was built
   * from: evaluated items are cached, so an unchanged item is the same object and its Fabric objects
   * are kept. Any change of membership or order (or V mode) rebuilds everything as before.
   */
  private scene: { key: string; item: unknown; objs: FabricObject[] }[] | null = null
  /** Zoom and pan so the whole evaluated drawing is on the canvas (with a margin). */
  fitToContent(margin = 20) {
    const ev = this.editor.derived.evaluated()
    const xs: number[] = []
    const ys: number[] = []
    for (const c of ev.curves) for (const a of Object.values(c.anchors)) for (const p of [a.p, a.hIn, a.hOut]) (xs.push(p.x), ys.push(p.y))
    if (!xs.length) return
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const w = this.canvas.getWidth() - 2 * margin
    const h = this.canvas.getHeight() - 2 * margin
    const z = Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))
    this.canvas.setViewportTransform([z, 0, 0, z, margin - x0 * z, margin - y0 * z])
    this.render()
  }
  /** Reference drawing path B (canvas2dRef.ts): when set, A-mode scenes are drawn by it, not Fabric. */
  private ref: Canvas2DRef | null = null
  private refFrame = 0
  private refPaintedInput = 0
  private refPending: { ev: Evaluated; onions: Evaluated[] } | null = null
  /** B draws only A-mode scenes; V mode is always Fabric's own drawing. */
  private get refDraws() {
    return this.mode === 'A' && this.ref !== null
  }
  /** Switch A-mode drawing to the Canvas2D reference (same size, DPR, viewport and order). */
  useCanvas2DRef() {
    const lower = this.canvas.lowerCanvasEl
    const el = document.createElement('canvas')
    el.width = lower.width
    el.height = lower.height
    el.style.cssText = `position:absolute;left:0;top:0;width:${lower.style.width};height:${lower.style.height};pointer-events:none`
    lower.after(el) // between Fabric's (now empty) lower canvas and its upper (input) canvas
    this.ref = new Canvas2DRef(el)
    this.scene = null
    this.render()
  }
  get refCanvas() {
    return this.ref?.el ?? null
  }
  /** Comparison mode: rebuild every object on every render (the behaviour before option A). */
  fullRebuildEachRender = false
  /** Next render rebuilds every object (tests compare the incremental scene with this). */
  forceFullRender() {
    this.scene = null
    this.render()
  }

  private project(ev: Evaluated, onions: Evaluated[]) {
    // Phases are timed separately (dot): build objects, then attach them.
    let t = performance.now()
    const pathOfOnion = (c: EvalCurve) => new Path(cubicsToCommands(c.segments.map((s) => s.cubic)), { fill: '', stroke: 'rgba(120,120,200,0.25)', strokeWidth: 0.4, selectable: false, evented: false, objectCaching: false })
    const byAddress = new Map(ev.curves.map((c) => [c.address, c]))
    // a fill painted after its own visible strokes leaves out their ink (S2; `ownInk` decided by the core)
    const pathOfFill = (p: Extract<PaintItem, { kind: 'fill' }>) => {
      const f = p.item
      if (!p.ownInk.length) return new Path(cubicsToCommands(f.cubics, true), { fill: f.color, fillRule: FILL_RULE, stroke: '', selectable: false, evented: false, objectCaching: false })
      return new OwnInkFill(cubicsToCommands(f.cubics, true), f, cubicsPath2D(f.cubics, true), p.ownInk.map((r) => ({ curve: byAddress.get(r.curve)!, path: ownInkPath2D(byAddress.get(r.curve)!, r.segments) })))
    }
    const pathOf = (c: EvalCurve) => {
      const st = inkStyle(c)
      return new Path(cubicsToCommands(c.segments.map((s) => s.cubic)), {
        fill: '',
        stroke: c.locked ? '#999' : c.stroke.color,
        strokeWidth: st.width,
        strokeLineCap: st.cap,
        strokeLineJoin: st.join,
        strokeMiterLimit: st.miterLimit,
        selectable: false,
        evented: false,
        objectCaching: false,
      })
    }
    const dotsOf = (c: EvalCurve) => Object.values(c.anchors).flatMap((a) => [dot(a.p, '#1565c0', 1.4), dot(a.hIn, '#90caf9', 0.9), dot(a.hOut, '#90caf9', 0.9)])
    const curves = ev.curves.filter((c) => c.visible)

    if (this.fullRebuildEachRender) this.scene = null
    if (this.ref) {
      // outside A mode B's canvas must neither show its last A frame over Fabric's drawing nor draw a
      // queued A frame after the switch (dot 0264deb: after A→V the old B picture covered V)
      this.ref.el.style.display = this.refDraws ? '' : 'none'
      if (!this.refDraws && this.refFrame) {
        cancelAnimationFrame(this.refFrame)
        this.refFrame = 0
        this.refPending = null
      }
    }
    if (this.refDraws) {
      // B: nothing for Fabric to draw; the reference repaints on the next animation frame (as Fabric does)
      if (this.canvas.getObjects().length) this.canvas.remove(...this.canvas.getObjects())
      this.refPending = { ev, onions }
      if (!this.refFrame)
        this.refFrame = requestAnimationFrame(() => {
          this.refFrame = 0
          const job = this.refPending!
          this.refPending = null
          const t0 = performance.now()
          this.ref!.draw(this.canvas.viewportTransform as number[], this.canvas.getRetinaScaling(), job.ev, job.onions)
          const now = performance.now()
          this.timing.renderAll += now - t0
          this.timing.renders++
          if (this.lastInputTs > this.refPaintedInput) {
            this.timing.inputToDrawDone += now - this.lastInputTs
            this.timing.drawsAfterInput++
            this.refPaintedInput = this.lastInputTs
          }
        })
      return
    }
    if (this.mode === 'A') {
      // the scene this render should show, in z-order: onion yaws (editor aid, E1) → the core's ONE
      // paint list (lines and fills interleaved, PAINT-ORDER.md) → anchor dots (editor aid, E1)
      const want: { key: string; item: EvalCurve | EvalFill; make: () => FabricObject[] }[] = []
      onions.forEach((o, i) => o.curves.filter((c) => c.visible).forEach((c) => want.push({ key: `o${i}:${c.address}`, item: c, make: () => [pathOfOnion(c)] })))
      for (const p of ev.paint)
        if (p.item.visible)
          want.push(
            p.kind === 'fill'
              ? { key: `f:${p.item.address}`, item: p.item, make: () => [pathOfFill(p)] }
              : { key: `c:${p.item.address}`, item: p.item, make: () => [pathOf(p.item)] },
          )
      for (const c of curves.filter((c) => !c.locked)) want.push({ key: `d:${c.address}`, item: c, make: () => dotsOf(c) })
      const prev = this.scene
      if (prev && prev.length === want.length && prev.every((e, i) => e.key === want[i].key)) {
        // incremental: only entries whose evaluated item changed are touched
        const renderOnAddRemove = this.canvas.renderOnAddRemove
        this.canvas.renderOnAddRemove = false
        let built = 0
        let attachMs = 0
        for (let i = 0; i < want.length; i++) {
          const e = prev[i]
          const w = want[i]
          if (e.item === w.item) continue
          if (w.key.startsWith('d:') && Object.keys((w.item as EvalCurve).anchors).length * 3 === e.objs.length) {
            // anchor dots: move the existing circles (same objects, new positions)
            const pts = Object.values((w.item as EvalCurve).anchors).flatMap((a) => [a.p, a.hIn, a.hOut])
            e.objs.forEach((o, k) => {
              o.set({ left: pts[k].x, top: pts[k].y })
              o.setCoords()
            })
          } else {
            const fresh = w.make()
            built += fresh.length
            const a0 = performance.now()
            const objects = this.canvas.getObjects()
            const at = objects.indexOf(e.objs[0])
            this.canvas.remove(...e.objs)
            this.canvas.insertAt(at, ...fresh)
            attachMs += performance.now() - a0
            e.objs = fresh
          }
          e.item = w.item
        }
        counters.fabricObjectsCreated += built
        this.canvas.renderOnAddRemove = renderOnAddRemove
        this.timing.buildObjects += performance.now() - t - attachMs
        this.timing.attach += attachMs
        this.canvas.requestRenderAll()
        return
      }
      // full build (first render, or membership / order changed)
      const scene = want.map((w) => ({ key: w.key, item: w.item as unknown, objs: w.make() }))
      const objs = scene.flatMap((e) => e.objs)
      counters.fabricObjectsCreated += objs.length
      this.timing.buildObjects += performance.now() - t
      t = performance.now()
      this.canvas.discardActiveObject()
      this.canvas.remove(...this.canvas.getObjects())
      this.canvas.add(...objs)
      this.timing.attach += performance.now() - t
      this.scene = scene
      this.groupStart.clear()
      this.canvas.requestRenderAll()
      return
    }

    // V mode: always a full build (groups per top-level container own the transform box)
    this.scene = null
    const objs: FabricObject[] = []
    const add = (...o: FabricObject[]) => {
      counters.fabricObjectsCreated += o.length
      objs.push(...o)
    }
    for (const o of onions) for (const c of o.curves.filter((c) => c.visible)) add(pathOfOnion(c))
    this.groupStart.clear()
    this.timing.buildObjects += performance.now() - t
    t = performance.now()
    // top-level containers from the parent index (no whole-table scan)
    const tops = childrenOf(this.editor.reader, null, 'container').map((id) => this.editor.reader.get(id) as ContainerRecord)
    this.timing.containerScan += performance.now() - t
    t = performance.now()
    // one group per top-level container holding ALL its painted items (lines, fills, reference
    // instances, nested containers' items) in the core's paint order; the paint key starts with the
    // top-level container's index, so groups follow each other in paint order too
    const members = new Map<string, FabricObject[]>()
    const lockedTop = new Set<string>()
    for (const p of ev.paint) {
      if (!p.item.visible) continue
      const top = this.topOf(p.item.address)
      if (!top) continue
      if (!members.has(top)) members.set(top, [])
      members.get(top)!.push(p.kind === 'fill' ? pathOfFill(p) : pathOf(p.item))
      if (p.item.locked) lockedTop.add(top)
    }
    // groups in PAINT order (dot: they were added in creation order, so a top-level layer could cover
    // one that the common order puts in front); a top-level container's items are contiguous in the
    // paint list (its key component comes first), so first appearance = its place in the order
    const byId = new Map(tops.map((k) => [k.id as string, k]))
    for (const [kid, objsOfK] of members) {
      const k = byId.get(kid)
      if (!k || !objsOfK.length) continue
      const locked = lockedTop.has(k.id)
      const g = new Group(objsOfK, { selectable: !locked, evented: !locked, objectCaching: false })
      ;(g as any).containerId = k.id
      ;(g as any).lockedGroup = locked
      this.groupStart.set(g, g.calcTransformMatrix())
      counters.fabricObjectsCreated += objsOfK.length // the member paths inside the group
      add(g)
    }
    this.timing.buildObjects += performance.now() - t
    t = performance.now()
    this.canvas.discardActiveObject()
    this.canvas.remove(...this.canvas.getObjects())
    this.canvas.add(...objs)
    this.timing.attach += performance.now() - t
    this.canvas.requestRenderAll()
  }


  /** Top-level container of a painted item (a reference instance belongs where the reference is). */
  private topOf(address: string) {
    const reader = this.editor.reader
    let rec = reader.get(address.split('/')[0] as any) as { parentId: string | null } | undefined
    let top: string | undefined
    while (rec?.parentId) {
      top = rec.parentId
      rec = reader.get(rec.parentId as any) as { parentId: string | null } | undefined
    }
    return top
  }

  /**
   * V mode: decide the target with OUR hit test on the evaluated geometry (not Fabric's bounding
   * boxes, which overlap between layers). Only the hit container's group stays `evented`, so
   * Fabric's public target search lands on it. Groups already in the active selection stay evented.
   */
  private routeVTarget(e: PointerEvent) {
    if (this.mode !== 'V') return
    const p = this.canvas.getScenePoint(e)
    const hit = hitTest(this.editor.derived.evaluated(), p, { mode: 'V', tolerance: 6 / this.canvas.getZoom() })
    const target = hit ? this.containerOfHit(hit) : undefined
    const active = new Set(this.canvas.getActiveObjects())
    for (const g of this.groupStart.keys()) {
      const locked = (g as any).lockedGroup
      g.evented = !locked && ((g as any).containerId === target || active.has(g))
    }
  }

  /** the placement side: a hit through a reference selects where the REFERENCE is (select.ts, doc 18 §21.2) */
  private containerOfHit(hit: Hit): string | undefined {
    return topContainerOfHit(this.editor.reader, hit)
  }

  // ---- A mode: our own hit test + preview, apply once on release ----
  private onDown(e: PointerEvent) {
    if (this.mode !== 'A') return
    const p = this.canvas.getScenePoint(e)
    const hit = hitTest(this.editor.derived.evaluated(), p, { mode: 'A', tolerance: 6 / this.canvas.getZoom() })
    if (hit && (hit.kind === 'anchor' || hit.kind === 'handle')) this.drag = { hit, start: { x: p.x, y: p.y }, op: this.editor.prepare(), ok: false }
  }

  /**
   * Map a screen-space drag to a command. Seen through a reference, the delta is converted into the
   * source's local space for BOTH override and source edits (dot: mirrored drag went the wrong way).
   * Handle overrides on references are not supported in this slice and are rejected explicitly, never
   * silently written to the source (dot).
   */
  private commandFor(hit: Extract<Hit, { kind: 'anchor' | 'handle' }>, delta: Vec): Command | { error: EditError } {
    const target = { curveId: hit.curveId, anchorId: hit.anchorId }
    let local = delta
    if (hit.referenceId) {
      const r = this.editor.reader.get(hit.referenceId) as any
      const inv = util.invertTransform([r.transform.a, r.transform.b, r.transform.c, r.transform.d, 0, 0])
      local = { x: round(inv[0] * delta.x + inv[2] * delta.y), y: round(inv[1] * delta.x + inv[3] * delta.y) }
    }
    if (hit.kind === 'handle') {
      if (hit.referenceId && !this.editSource)
        return { error: { code: 'INVALID', message: 'handle overrides on a reference are not supported in this slice; tick 改源 to edit the source', objects: [hit.address], fixes: ['tick 改源'] } }
      return { type: 'moveHandle', target, handle: hit.handle, delta: local }
    }
    if (hit.referenceId && !this.editSource) return { type: 'moveOverride', referenceId: hit.referenceId, target, delta: local }
    return { type: 'moveAnchors', targets: [target], delta: local }
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) return
    const p = this.canvas.getScenePoint(e)
    const delta = { x: round(p.x - this.drag.start.x), y: round(p.y - this.drag.start.y) }
    const mapped = this.commandFor(this.drag.hit, delta)
    if ('error' in mapped) {
      this.drag.cmd = undefined
      this.drag.ok = false
      this.drag.rejected = mapped.error
      this.setStatus(`${mapped.error.code}: ${mapped.error.message}`)
      this.render()
      return
    }
    const cmd = mapped
    this.timing.moves++
    let t = performance.now()
    const pv = this.drag.op.preview(cmd)
    this.timing.plan += performance.now() - t
    this.drag.cmd = cmd
    this.drag.ok = pv.ok
    this.drag.error = pv.ok ? undefined : pv.error
    if (pv.ok) {
      this.setStatus('')
      // incremental preview: only the affected items are re-evaluated; no store copy (dot)
      const d = this.editor.derived
      t = performance.now()
      const ch = d.previewChanges(pv.puts, pv.removals) // once per move, shared by the drawing and every onion yaw
      this.timing.previewChanges += performance.now() - t
      t = performance.now()
      const main = d.preview(pv.puts, ch)
      const onions = this.onion ? this.onion.yaws.map((y) => d.previewAtYaw(pv.puts, y, ch)) : []
      this.timing.assemble += performance.now() - t
      this.render(main, onions)
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
    if (d?.rejected && !d.cmd) {
      d.op.cancel()
      this.rejections.push({ address: d.hit.address, error: d.rejected })
      this.render()
      return
    }
    if (!d) return
    if (!d.cmd) return d.op.cancel()
    if (d.ok) {
      // the operation plans once more and checks generation, locks and dependencies again; ends once
      const r = d.op.commit(d.cmd)
      this.log.push({ source: 'ui', cmd: d.cmd, ok: r.ok, written: r.written, error: r.ok ? undefined : r.error })
      this.setStatus(r.ok ? '' : `${r.error.code}: ${r.error.message}`)
    } else {
      d.op.cancel()
      this.log.push({ source: 'ui', cmd: d.cmd, ok: false, written: false, error: d.error })
    }
    this.render()
  }

  // ---- V mode: Fabric's transform box; we read the matrix change and apply it to the document ----
  private onModified(target: FabricObject) {
    if (this.projecting) {
      this.ignoredReentrantEvents++
      return
    }
    this.vTransforming = false
    if (this.vCancelled) {
      this.vCancelled = false
      queueMicrotask(() => this.render())
      return
    }
    const groups = target instanceof ActiveSelection ? (target.getObjects() as FabricObject[]) : [target]
    const containerIds: string[] = []
    let matrix: Affine | null = null
    for (const g of groups) {
      const start = this.groupStart.get(g)
      const containerId = (g as any).containerId
      if (!start || !containerId) continue
      const now = g.calcTransformMatrix() // includes the ActiveSelection's own transform, if any
      const m = toAffine(util.multiplyTransformMatrices(now, util.invertTransform(start)).map(round) as TMat2D)
      // Every member of one selection shares the selection's transform; one command moves each anchor once.
      if (matrix && Object.keys(m).some((k) => Math.abs((m as any)[k] - (matrix as any)[k]) > 1e-6)) {
        this.setStatus('INVALID: selection members disagree on the transform')
        queueMicrotask(() => this.render())
        return
      }
      matrix = m
      containerIds.push(containerId)
    }
    if (matrix && containerIds.length === 1) this.applyAndLog({ type: 'transformContainer', containerId: containerIds[0] as any, matrix })
    else if (matrix && containerIds.length > 1) this.applyAndLog({ type: 'transformContainers', containerIds: containerIds as any, matrix })
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
  // objectCaching off like every other scene object: Fabric's default per-object cache on 6,000 tiny
  // dots cost ≈ 540 of ≈ 560 ms per renderAll (e2e/dots-cache-probe.spec.ts; dot's reuse review)
  return new Circle({ left: p.x, top: p.y, radius: r, fill: color, originX: 'center', originY: 'center', selectable: false, evented: false, objectCaching: false })
}

/** Evaluate a preview without touching the document: a throwaway store with the planned records. */
/** The OLD preview path (copies the whole store); kept for the benchmark comparison, and counted. */
export function withPuts(editor: Editor, puts: DocRecord[]) {
  const tmp = new Store<DocRecord>({ schema, props: {} })
  const snap = editor.reader.getStoreSnapshot()
  counters.snapshotRows += Object.keys(snap.store).length
  tmp.loadStoreSnapshot(snap)
  tmp.put(puts)
  return tmp
}
