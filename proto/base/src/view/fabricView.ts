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
import { Canvas, Circle, Path, Point, Rect, util, type FabricObject, type TMat2D } from 'fabric'
import { atom, react, unsafe__withoutCapture } from '@tldraw/state'
import { Store } from '@tldraw/store'
import type { Command, EditError } from '../commands'
import type { Editor, Operation } from '../editor'
import { cubicsToCommands, evaluate, FILL_RULE, hitTest, inkStyle, unappliedContainerOpacity, unappliedDepthOffsets, type EvalCurve, type EvalFill, type Evaluated, type Hit, type PaintItem } from '../evaluate'
import { cubicsPath2D, ownInkPath2D, paintFillLeavingOwnInk } from './ownInk'
import { MaskedPath } from './masks'
import { OwnInkFill } from './ownInkFill'
import { all } from '../model'
import { boundsOf, deletionSetOf, drawnOf, isInside, layerOf, pickAt, Selection, unitsInRect, allUnits, type Rect as SelRect } from '../selection'
import { schema, type Affine, type ContainerRecord, type DocRecord, type Vec } from '../schema'
import { lockedBy } from '../model'

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
  /** V-mode gestures (selection.ts): moving the selection by its body, a marquee, or Fabric's handle box */
  private vGesture:
    | { kind: 'move'; start: Vec; op: Operation; ids: string[]; cmd?: Command; ok: boolean; error?: EditError }
    | { kind: 'marquee'; start: Vec; now: Vec; additive: boolean; enclosed: boolean }
    | { kind: 'box'; op: Operation; ids: string[]; start: TMat2D; cmd?: Command; ok: boolean; error?: EditError }
    | null = null
  /** the handle box of the selection (Fabric's controls: scale / rotate); its body is NOT a drag target */
  private box: FabricObject | null = null
  /** identity of the current box (selection + its drawn bounds): kept while a gesture previews, rebuilt otherwise */
  private boxItem: { ids: readonly string[]; bounds: SelRect; locked: boolean } | null = null
  /** the canvas zoom, for the toolbar (set on every render) */
  readonly zoom = atom('canvas zoom', 1)
  /** space held: the hand tool (pan) */
  private spaceDown = false
  private pan: { x: number; y: number } | null = null
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
    /** the editor's selection (shared with the panels); not part of the document, not an undo step */
    readonly selection: Selection = new Selection(),
  ) {
    // Fabric's own marquee and object picking are off: selection is decided by OUR picking (selection.ts); Fabric draws
    // and provides the handle box. Illustrator scaling: free by default, Shift keeps proportions.
    this.canvas = new Canvas(el, { selection: false, preserveObjectStacking: true, uniformScaling: false, uniScaleKey: 'shiftKey' })
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
    // Fabric caches its target before 'mouse:down:before' fires, so V-mode picking runs in a capture-phase listener on
    // Fabric's wrapper element (public `wrapperEl`), which runs first; the hand tool (space) stops the event there.
    this.canvas.wrapperEl.addEventListener('pointerdown', (e) => this.onCapturedDown(e), { capture: true })
    this.canvas.wrapperEl.addEventListener('pointermove', (e) => ((this.lastInputTs = e.timeStamp), this.onPanMove(e)), { capture: true })
    window.addEventListener('pointerup', () => (this.pan = null))
    this.canvas.wrapperEl.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
    this.canvas.on('mouse:down', (o) => this.onDown(o.e as PointerEvent))
    this.canvas.on('mouse:move', (o) => this.onMove(o.e as PointerEvent))
    this.canvas.on('mouse:up', () => this.onUp())
    this.canvas.on('object:modified', (o) => this.onModified(o.target as FabricObject))
    this.canvas.on('before:transform', (o) => {
      this.vTransforming = true
      this.vCancelled = false
      const tr = (o as { transform?: { target?: FabricObject; corner?: string } }).transform
      if (tr?.target && tr.target === this.box && tr.corner && this.boxItem) this.vGesture = { kind: 'box', op: this.editor.prepare(), ids: [...this.boxItem.ids], start: this.box.calcTransformMatrix(), ok: false }
    })
    for (const ev of ['object:scaling', 'object:rotating', 'object:skewing'] as const) this.canvas.on(ev, (o) => this.onBoxChanging(o.target as FabricObject))
    this.canvas.on('mouse:up', () => {
      // a cancelled transform may end without object:modified (nothing changed): clear the flags
      if (this.vCancelled) queueMicrotask(() => ((this.vCancelled = false), (this.vTransforming = false)))
    })
    // Whatever Fabric does when a multi-selection ends, the document is the only truth: re-project.
    this.canvas.on('selection:cleared', () => {
      if (!this.projecting) queueMicrotask(() => this.render())
    })
    // the canvas follows the selection and the document (panels change both)
    react('view follows selection / document', () => {
      this.selection.ids.get()
      void this.editor.revision
      unsafe__withoutCapture(() => {
        if (!this.projecting && !this.drag && !this.vGesture) this.render()
      })
    })
  }

  setMode(mode: 'A' | 'V') {
    this.mode = mode
    this.canvas.discardActiveObject()
    this.scene = null
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
    const g = this.vGesture
    if (g) {
      // V-mode cancel: drop the preview by re-projecting the document. A Fabric transform still running on the handle
      // box ends when the box is removed (rebuilt below); `vCancelled` makes us ignore its last object:modified.
      if (g.kind !== 'marquee') g.op.cancel()
      if (g.kind === 'box') this.vCancelled = true
      this.vGesture = null
      this.boxItem = null
      this.scene = null
      this.setStatus('已取消')
      this.render()
      return true
    }
    if (this.vTransforming) {
      this.vCancelled = true
      this.setStatus('已取消')
      this.scene = null
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
      if (this.zoom.get() !== this.canvas.getZoom()) this.zoom.set(this.canvas.getZoom())
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
      const masks = ev.masks?.get(f.address)
      if (masks?.length) {
        const fillPath = cubicsPath2D(f.cubics, true)
        const own = p.ownInk.map((r) => ({ curve: byAddress.get(r.curve)!, path: ownInkPath2D(byAddress.get(r.curve)!, r.segments), masks: ev.masks?.get(r.curve) }))
        return new MaskedPath(cubicsToCommands(f.cubics, true), masks, f.cubics.flat(), 0, (l) => {
          if (own.length) paintFillLeavingOwnInk(l, f, fillPath, own)
          else {
            l.fillStyle = f.color
            l.fill(fillPath, FILL_RULE)
          }
        })
      }
      if (!p.ownInk.length) return new Path(cubicsToCommands(f.cubics, true), { fill: f.color, fillRule: FILL_RULE, stroke: '', selectable: false, evented: false, objectCaching: false })
      return new OwnInkFill(cubicsToCommands(f.cubics, true), f, cubicsPath2D(f.cubics, true), p.ownInk.map((r) => ({ curve: byAddress.get(r.curve)!, path: ownInkPath2D(byAddress.get(r.curve)!, r.segments), masks: ev.masks?.get(r.curve) })))
    }
    const pathOf = (c: EvalCurve) => {
      const st = inkStyle(c)
      const masks = ev.masks?.get(c.address)
      if (masks?.length) {
        const path = cubicsPath2D(c.segments.map((s) => s.cubic))
        return new MaskedPath(cubicsToCommands(c.segments.map((s) => s.cubic)), masks, c.segments.flatMap((s) => s.cubic), (st.width / 2) * Math.max(1, st.miterLimit), (l) => {
          l.strokeStyle = c.locked ? '#999' : c.stroke.color
          l.lineWidth = st.width
          l.lineCap = st.cap
          l.lineJoin = st.join
          l.miterLimit = st.miterLimit
          l.stroke(path)
        })
      }
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
    // the scene this render should show, in z-order: onion yaws (editor aid, E1) → the core's ONE paint list (lines and
    // fills interleaved, PAINT-ORDER.md) → A: anchor dots (editor aid, E1); V: the selection's highlight, its handle
    // box and the marquee (editor aids). A and V share the incremental scene.
    const want: { key: string; item: unknown; make: () => FabricObject[] }[] = []
    onions.forEach((o, i) => o.curves.filter((c) => c.visible).forEach((c) => want.push({ key: `o${i}:${c.address}`, item: c, make: () => [pathOfOnion(c)] })))
    for (const p of ev.paint)
      if (p.item.visible) {
        // a masked item depends on its sources' geometry too (so does a fill whose own boundary stroke is masked: its
        // cut follows that stroke's masks): compared by this evaluation's mask list
        const ownMasked = p.kind === 'fill' && p.ownInk.some((r) => ev.masks?.get(r.curve)?.length)
        const item = ev.masks?.get(p.item.address)?.length || ownMasked ? ({ masked: p.item, masks: ev.masks!.get(p.item.address), own: p.kind === 'fill' ? p.ownInk.map((r) => ev.masks!.get(r.curve)) : null } as any) : p.item
        want.push(
          p.kind === 'fill'
            ? { key: `f:${p.item.address}`, item, make: () => [pathOfFill(p)] }
            : { key: `c:${p.item.address}`, item, make: () => [pathOf(p.item)] },
        )
      }
    if (this.mode === 'A') for (const c of curves.filter((c) => !c.locked)) want.push({ key: `d:${c.address}`, item: c, make: () => dotsOf(c) })
    this.overlays(ev, want)
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
      this.activateBox()
      this.canvas.requestRenderAll()
      return
    }
    // full build (first render, or membership / order changed)
    const scene = want.map((w) => ({ key: w.key, item: w.item, objs: w.make() }))
    const objs = scene.flatMap((e) => e.objs)
    counters.fabricObjectsCreated += objs.length
    this.timing.buildObjects += performance.now() - t
    t = performance.now()
    this.canvas.discardActiveObject()
    this.canvas.remove(...this.canvas.getObjects())
    this.canvas.add(...objs)
    this.timing.attach += performance.now() - t
    this.scene = scene
    this.activateBox()
    this.canvas.requestRenderAll()
  }

  /** the handle box is Fabric's active object while it exists (Fabric draws its border and controls) */
  private activateBox() {
    const active = this.canvas.getActiveObject()
    if (this.box && this.canvas.getObjects().includes(this.box)) {
      if (active !== this.box) this.canvas.setActiveObject(this.box)
    } else if (active) this.canvas.discardActiveObject()
  }

  /**
   * Editor aids over the drawing: the selected items' outlines (A and V), in V the handle box of the selection
   * (Illustrator's bounding box: scale / rotate by its handles) and the marquee while dragging one.
   */
  private overlays(ev: Evaluated, want: { key: string; item: unknown; make: () => FabricObject[] }[]) {
    const reader = this.editor.reader
    const z = this.canvas.getZoom()
    const ids = this.selection.get().filter((id) => reader.get(id as any))
    const items = new Set(drawnOf(reader, ev, ids))
    for (const p of ev.paint) {
      if (!items.has(p.item.address)) continue
      const cubics = p.kind === 'curve' ? p.item.segments.map((s) => s.cubic) : p.item.cubics
      want.push({ key: `s:${p.item.address}`, item: p.item, make: () => [new Path(cubicsToCommands(cubics, p.kind === 'fill'), { fill: '', stroke: '#1e88e5', strokeWidth: 1.5 / z, selectable: false, evented: false, objectCaching: false })] })
    }
    const g = this.vGesture
    if (this.mode === 'V' && ids.length && !(g && g.kind !== 'marquee')) {
      // outside a move / transform the box follows the document's geometry (not a preview)
      const bounds = boundsOf(reader, this.editor.derived.evaluated(), ids)
      const locked = ids.some((id) => this.isLocked(id))
      const same = this.boxItem && bounds && this.boxItem.locked === locked && this.boxItem.ids.length === ids.length && this.boxItem.ids.every((x, i) => x === ids[i]) && (['x0', 'y0', 'x1', 'y1'] as const).every((k) => this.boxItem!.bounds[k] === bounds[k])
      if (!same) this.boxItem = bounds ? { ids, bounds, locked } : null
    } else if (this.mode !== 'V' || !ids.length) this.boxItem = null
    if (this.mode === 'V' && this.boxItem) {
      const bi = this.boxItem
      want.push({ key: 'box', item: bi, make: () => [(this.box = this.makeBox(bi))] })
    } else this.box = null
    if (g?.kind === 'marquee') {
      const r = { x0: Math.min(g.start.x, g.now.x), y0: Math.min(g.start.y, g.now.y), x1: Math.max(g.start.x, g.now.x), y1: Math.max(g.start.y, g.now.y) }
      want.push({
        key: 'marquee',
        item: { ...r, enclosed: g.enclosed },
        make: () => [new Rect({ left: r.x0, top: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0, originX: 'left', originY: 'top', fill: 'rgba(30,136,229,0.08)', stroke: '#1e88e5', strokeWidth: 1 / z, strokeDashArray: g.enclosed ? [4 / z, 3 / z] : undefined, selectable: false, evented: false, objectCaching: false })],
      })
    }
  }

  private makeBox(bi: { bounds: SelRect; locked: boolean }) {
    const b = bi.bounds
    const w = b.x1 - b.x0, h = b.y1 - b.y0
    // a straight horizontal / vertical line has no extent on one axis: that axis does not scale (Illustrator)
    return new Rect({
      left: b.x0, top: b.y0, width: w, height: h, originX: 'left', originY: 'top', fill: '', stroke: '', strokeWidth: 0,
      selectable: true, evented: false, objectCaching: false, hasBorders: true, hasControls: !bi.locked,
      lockMovementX: true, lockMovementY: true, lockScalingX: w < 1e-9, lockScalingY: h < 1e-9,
      borderColor: '#1e88e5', cornerColor: '#ffffff', cornerStrokeColor: '#1e88e5', transparentCorners: false, cornerSize: 8,
    })
  }

  /** a record is locked, or inside a locked container */
  private isLocked(id: string) {
    const r = this.editor.reader.get(id as any) as (DocRecord & { locked?: boolean; parentId?: string | null }) | undefined
    if (!r) return false
    if (r.typeName === 'container' && r.locked) return true
    return !!lockedBy(this.editor.reader, ('parentId' in r ? r.parentId : null) as any)
  }

  // ---- A mode: our own hit test + preview, apply once on release ----
  private onDown(e: PointerEvent) {
    if (this.mode !== 'A' || this.pan) return
    const p = this.canvas.getScenePoint(e)
    const hit = hitTest(this.editor.derived.evaluated(), p, { mode: 'A', tolerance: 6 / this.canvas.getZoom() })
    if (hit && (hit.kind === 'anchor' || hit.kind === 'handle')) this.drag = { hit, start: { x: p.x, y: p.y }, op: this.editor.prepare(), ok: false }
    // Direct Selection (Illustrator A): a click on a path selects that object itself, never its group
    else if (hit) this.selection.set([hit.address.split('/')[0]])
    else if (!e.shiftKey) this.selection.clear()
  }

  // ---- V mode (Illustrator Selection tool; selection.ts): our picking decides, Fabric only draws the handle box ----
  private onCapturedDown(e: PointerEvent) {
    // only presses on the drawing surface (Fabric's upper canvas) — not on the wrapper's edge, which Fabric never sees
    if (e.target !== this.canvas.upperCanvasEl) return
    if (this.spaceDown || e.button === 1) {
      // the hand tool: space + drag (Illustrator / Figma), or the middle button
      this.pan = { x: e.clientX, y: e.clientY }
      e.stopPropagation()
      e.preventDefault()
      return
    }
    if (this.mode !== 'V' || e.button !== 0) return
    const vp = this.canvas.getViewportPoint(e)
    // Fabric's handles: the box is a Fabric target only while the press is on one of them (Fabric drops a target that
    // is not `evented`); a press on its body or inside it is ours (move / marquee)
    const onHandle = !!(this.box && this.boxItem && !this.boxItem.locked && this.box.findControl(vp, e.pointerType === 'touch'))
    if (this.box) this.box.evented = onHandle
    if (onHandle) return
    const p = this.canvas.getScenePoint(e)
    const reader = this.editor.reader
    const now = this.selection.get()
    const behind = e.metaKey || e.ctrlKey
    const unit = pickAt(reader, this.editor.derived.evaluated(), p, 6 / this.canvas.getZoom(), behind ? now : undefined)
    if (unit) {
      if (e.shiftKey) this.selection.toggle(unit)
      else if (behind || !now.includes(unit)) this.selection.set([unit])
      const ids = this.selection.get()
      // the canvas has re-rendered for the new selection (react): the box is current
      if (ids.includes(unit) && !this.boxItem?.locked) this.vGesture = { kind: 'move', start: { x: p.x, y: p.y }, op: this.editor.prepare(), ids: [...ids], ok: false }
    } else {
      if (!e.shiftKey) this.selection.clear()
      this.vGesture = { kind: 'marquee', start: { x: p.x, y: p.y }, now: { x: p.x, y: p.y }, additive: e.shiftKey, enclosed: false }
    }
  }

  /** E while dragging a marquee: switch between touching and enclosed (Illustrator) */
  toggleMarqueeMode() {
    const g = this.vGesture
    if (g?.kind !== 'marquee') return false
    g.enclosed = !g.enclosed
    this.render()
    return true
  }

  /** preview a V command inside the gesture's prepared operation (like the A drag) */
  private previewV(g: { op: Operation; cmd?: Command; ok: boolean; error?: EditError }, cmd: Command) {
    const pv = g.op.preview(cmd)
    g.cmd = cmd
    g.ok = pv.ok
    g.error = pv.ok ? undefined : pv.error
    if (pv.ok) {
      this.setStatus('')
      const d = this.editor.derived
      const ch = d.previewChanges(pv.puts, pv.removals)
      this.render(d.preview(pv.puts, ch), this.onion ? this.onion.yaws.map((y) => d.previewAtYaw(pv.puts, y, ch)) : [])
    } else {
      this.setStatus(`${pv.error.code}: ${pv.error.message}`)
      this.render()
    }
  }

  private onBoxChanging(target: FabricObject) {
    const g = this.vGesture
    if (target !== this.box || g?.kind !== 'box' || this.vCancelled) return
    this.previewV(g, this.boxCommand(g))
  }

  private boxCommand(g: { ids: string[]; start: TMat2D }): Command {
    const m = toAffine(util.multiplyTransformMatrices(this.box!.calcTransformMatrix(), util.invertTransform(g.start)).map(round) as TMat2D)
    return { type: 'transformItems', ids: g.ids, matrix: m }
  }

  private finishV(g: { op: Operation; cmd?: Command; ok: boolean; error?: EditError }) {
    const identity = g.cmd?.type === 'transformItems' && g.cmd.matrix.a === 1 && g.cmd.matrix.b === 0 && g.cmd.matrix.c === 0 && g.cmd.matrix.d === 1 && g.cmd.matrix.e === 0 && g.cmd.matrix.f === 0
    if (!g.cmd || identity) return g.op.cancel()
    if (g.ok) {
      const r = g.op.commit(g.cmd)
      this.log.push({ source: 'ui', cmd: g.cmd, ok: r.ok, written: r.written, error: r.ok ? undefined : r.error })
      this.setStatus(r.ok ? '' : `${r.error.code}: ${r.error.message}`)
    } else {
      g.op.cancel()
      this.log.push({ source: 'ui', cmd: g.cmd, ok: false, written: false, error: g.error })
    }
  }

  private onPanMove(e: PointerEvent) {
    if (!this.pan) return
    this.canvas.relativePan(new Point(e.clientX - this.pan.x, e.clientY - this.pan.y))
    this.pan = { x: e.clientX, y: e.clientY }
    e.stopPropagation()
    this.render()
  }

  /** wheel: scroll (Shift: sideways); Cmd / Ctrl + wheel and trackpad pinch: zoom at the cursor (Illustrator / Figma) */
  private onWheel(e: WheelEvent) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const vp = this.canvas.getViewportPoint(e as unknown as PointerEvent)
      this.zoomAt(vp, this.canvas.getZoom() * Math.pow(0.99, e.deltaY))
      return
    }
    const sideways = e.shiftKey && !e.deltaX
    this.canvas.relativePan(new Point(-(sideways ? e.deltaY : e.deltaX), -(sideways ? 0 : e.deltaY)))
    this.render()
  }

  zoomAt(viewportPoint: { x: number; y: number }, zoom: number) {
    this.canvas.zoomToPoint(new Point(viewportPoint.x, viewportPoint.y), Math.min(64, Math.max(0.05, zoom)))
    this.scene = null // editor aids are drawn at a screen width
    this.render()
  }
  /** Cmd + = / − : zoom around the centre of the canvas */
  zoomBy(factor: number) {
    this.zoomAt({ x: this.canvas.getWidth() / 2, y: this.canvas.getHeight() / 2 }, this.canvas.getZoom() * factor)
  }
  /** Cmd + 1: actual size (100 %) */
  actualSize() {
    this.zoomAt({ x: this.canvas.getWidth() / 2, y: this.canvas.getHeight() / 2 }, 1)
  }
  setSpace(down: boolean) {
    this.spaceDown = down
    this.canvas.wrapperEl.style.cursor = down ? 'grab' : ''
    this.canvas.defaultCursor = down ? 'grab' : 'default'
  }

  /** arrow keys: move the selection by the keyboard increment (Illustrator: 1, Shift: 10) — one undo step each */
  nudge(dx: number, dy: number) {
    const ids = this.selection.get().filter((id) => this.editor.reader.get(id as any))
    if (!ids.length || this.vGesture || this.drag) return null
    return this.applyAndLog({ type: 'transformItems', ids, matrix: { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy } })
  }
  /** Delete / Backspace: remove the selection (selection.ts `deletionSetOf`); a refusal names what still depends */
  deleteSelection() {
    const ids = this.selection.get().filter((id) => this.editor.reader.get(id as any))
    if (!ids.length || this.vGesture || this.drag) return null
    const r = this.applyAndLog({ type: 'deleteRecords', ids: deletionSetOf(this.editor.reader, ids) })
    if (r.ok) this.selection.clear()
    return r
  }
  /** Cmd + A: every visible, unlocked object (Illustrator Select All) */
  selectAll() {
    this.selection.set(allUnits(this.editor.reader, this.editor.derived.evaluated()))
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
    const g = this.vGesture
    if (g?.kind === 'marquee') {
      const p = this.canvas.getScenePoint(e)
      g.now = { x: p.x, y: p.y }
      this.render()
      return
    }
    if (g?.kind === 'move') {
      const p = this.canvas.getScenePoint(e)
      let dx = p.x - g.start.x, dy = p.y - g.start.y
      if (e.shiftKey) {
        // Shift while moving: constrain to multiples of 45° (Illustrator)
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy)
        dx = len * Math.cos(a)
        dy = len * Math.sin(a)
      }
      dx = round(dx)
      dy = round(dy)
      this.timing.moves++
      this.previewV(g, { type: 'transformItems', ids: g.ids, matrix: { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy } })
      if (this.box && this.boxItem) {
        this.box.set({ left: this.boxItem.bounds.x0 + dx, top: this.boxItem.bounds.y0 + dy })
        this.box.setCoords()
        this.canvas.requestRenderAll()
      }
      return
    }
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
    const g = this.vGesture
    if (g?.kind === 'move') {
      this.vGesture = null
      this.finishV(g)
      this.render()
      return
    }
    if (g?.kind === 'marquee') {
      this.vGesture = null
      const z = this.canvas.getZoom()
      // a click without a drag only deselects (done on press)
      if (Math.abs(g.now.x - g.start.x) * z >= 2 || Math.abs(g.now.y - g.start.y) * z >= 2) {
        const units = unitsInRect(this.editor.reader, this.editor.derived.evaluated(), { x0: g.start.x, y0: g.start.y, x1: g.now.x, y1: g.now.y }, g.enclosed)
        if (g.additive) this.selection.add(units)
        else this.selection.set(units)
      }
      this.render()
      return
    }
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
  // ---- V mode: the handle box (Fabric's controls); we read its matrix change and apply it to the document ----
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
    const g = this.vGesture
    if (target === this.box && g?.kind === 'box') {
      this.vGesture = null
      g.cmd = this.boxCommand(g)
      const pv = g.op.preview(g.cmd)
      g.ok = pv.ok
      g.error = pv.ok ? undefined : pv.error
      this.finishV(g)
    }
    this.boxItem = null
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
