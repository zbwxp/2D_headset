// Fabric.js 7.4.0 (MIT) used ONLY as the display / interaction shell (route B, docs/design/architecture/14, 15).
// Fabric objects are disposable projections of our document: after every gesture we re-project from
// the document, so anything Fabric mutated (drag, scaling, ActiveSelection exit baking) is discarded.
//   Canvas / Group / Path / getScenePoint / calcTransformMatrix:
//   https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/canvas/SelectableCanvas.ts
//   Group transform kept as an attribute (we read its matrix, we never trust its children):
//   https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/shapes/Group.ts
// A-mode hits use OUR hit test on the evaluated geometry (src/evaluate.ts), not Fabric's bbox test.
import { Canvas2DRef } from './canvas2dRef'
import { childrenOf, ownFillsOf, within } from '../indexes'
import { counters } from '../counters'
import { Canvas, Circle, Path, Point, Rect, util, type FabricObject, type TMat2D } from 'fabric'
import { atom, react, unsafe__withoutCapture } from '@tldraw/state'
import { Store } from '@tldraw/store'
import type { Command, EditError } from '../commands'
import type { Editor, Operation } from '../editor'
import { cubicsToCommands, evaluate, FILL_RULE, hitStack, hitTest, inkStyle, unappliedContainerOpacity, unappliedDepthOffsets, type EvalCurve, type EvalFill, type Evaluated, type Hit, type PaintItem } from '../evaluate'
import { cubicsPath2D, ownInkPath2D, paintFillLeavingOwnInk } from './ownInk'
import { MaskedPath } from './masks'
import { OwnInkFill } from './ownInkFill'
import { all } from '../model'
import { anchorsInRect, boundsOf, deletionSetOf, drawnOf, isInside, layerOf, masksOf, pickAt, Selection, unitsInRect, allUnits, type Rect as SelRect } from '../selection'
import { getIndexAbove, type IndexKey } from '@tldraw/utils'
import { bucketTarget, faceAt, outlineOf } from '../fills'
import { snapPoint, type Snap } from '../snap'
import { drawingBounds, toSVG } from '../export'
import { contentCentre, contentOf, parseContent } from '../clipboard'
import { schema, type Affine, type Anchor, type ContainerRecord, type CurveRecord, type DocRecord, type Vec } from '../schema'
import { anchorKey, containerChain, linkedAnchors, lockedBy, type AnchorRef } from '../model'

export type Tool = 'A' | 'V' | 'P' | '+' | '-' | 'C' | 'K' | 'N'
export type UiLogEntry = { source: 'ui'; cmd: Command; ok: boolean; written: boolean; error?: EditError }

const toAffine = (m: TMat2D): Affine => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] })

export class FabricView {
  readonly canvas: Canvas
  /** the tool: V Selection, A Direct Selection, P Pen, + Add / − Delete Anchor Point, C Scissors (Illustrator) */
  mode: Tool = 'A'
  /** In A mode, editing an anchor seen through a reference writes an override unless this is true. */
  editSource = false
  readonly log: UiLogEntry[] = []
  /** Gestures refused before any command could be formed (e.g. unsupported reference handle edits). */
  readonly rejections: { address: string; error: EditError }[] = []
  status = ''
  /** one drag = one prepared operation: fixed start generation and new ids, re-planned on every move */
  private drag: { hit: Extract<Hit, { kind: 'anchor' | 'handle' }>; start: Vec; op: Operation; cmd?: Command; ok: boolean; rejected?: EditError; error?: EditError; targets?: AnchorRef[]; smooth?: { hIn: Vec; hOut: Vec }; convert?: 'anchor' | 'handle'; origin?: Vec; moving?: Set<string>; breakPair?: boolean } | null = null
  /** the Pen tool's path being drawn (not in the document until it ends: one createCurve, one undo step) */
  pen: { anchors: Anchor[]; dragging: boolean; closing: boolean; hover?: Vec; from?: { curveId: string; end: 'start' | 'end'; other: Vec } } | null = null
  /** V-mode gestures (selection.ts): moving the selection by its body, a marquee, or Fabric's handle box */
  private vGesture:
    | { kind: 'move'; start: Vec; op: Operation; ids: string[]; cmd?: Command; ok: boolean; error?: EditError; grab?: Vec; moving?: Set<string> }
    | { kind: 'marquee'; start: Vec; now: Vec; additive: boolean; enclosed: boolean }
    | { kind: 'box'; op: Operation; ids: string[]; start: TMat2D; cmd?: Command; ok: boolean; error?: EditError }
    | null = null
  /** the handle box of the selection (Fabric's controls: scale / rotate); its body is NOT a drag target */
  private box: FabricObject | null = null
  /** identity of the current box (selection + its drawn bounds): kept while a gesture previews, rebuilt otherwise */
  private boxItem: { ids: readonly string[]; bounds: SelRect; locked: boolean } | null = null
  /** Smart Guides (⌘U): snapping to anchors and alignment with them while placing / dragging (snap.ts) */
  readonly snapOn = atom('smart guides', (() => {
    try {
      return localStorage.getItem('contour.smartGuides') !== 'off'
    } catch {
      return true
    }
  })())
  setSnap(on: boolean) {
    this.snapOn.set(on)
    try {
      localStorage.setItem('contour.smartGuides', on ? 'on' : 'off')
    } catch {
      // not stored: still works for this page
    }
  }
  /** what the last snap found (drawn as the smart guide while a gesture runs) */
  private snapHint: Snap | null = null
  /** snap a world point (none when Smart Guides are off); `moving` = anchor keys that move with it */
  private snapAt(p: Vec, moving?: Set<string>): Snap {
    if (!this.snapOn.get()) return (this.snapHint = null), { p, kind: 'none', guides: {} }
    // an anchor key `curve#a` moving excludes that anchor everywhere it is drawn (its source and every instance of it);
    // `ref:<id>` excludes every anchor a moving reference places
    const s = snapPoint(this.editor.derived.evaluated(), p, 6 / this.canvas.getZoom(), (c, a, r) => !!moving?.has(`${c}#${a}`) || (!!r && !!moving?.has(`ref:${r}`)))
    this.snapHint = s.kind === 'none' ? null : s
    return s
  }
  /** the anchors that move with these (their connected partners too) */
  private movingSet(refs: AnchorRef[]) {
    return new Set(linkedAnchors(this.editor.reader, refs).map((m) => anchorKey(m.ref)))
  }

  /** the colour the Live Paint Bucket (K) fills with — the toolbar's fill colour well */
  readonly fillColor = atom('fill colour', '#f3d9c4')
  /** the canvas zoom, for the toolbar (set on every render) */
  readonly zoom = atom('canvas zoom', 1)
  /** what the user is in the middle of (for the hint line; set on every render) */
  readonly phase = atom<'idle' | 'pen' | 'marquee' | 'marquee-enclosed' | 'move' | 'transform' | 'drag'>('canvas phase', 'idle')
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

  setMode(mode: Tool) {
    if (this.pen) this.finishPen() // switching tools ends the path (Illustrator)
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

  /** for the UI around the canvas (shortcut handlers, panels) */
  showStatus(s: string) {
    this.setStatus(s)
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
      const g = this.vGesture
      const phase = this.pen ? 'pen' : g?.kind === 'marquee' ? (g.enclosed ? 'marquee-enclosed' : 'marquee') : g?.kind === 'move' ? 'move' : g?.kind === 'box' ? 'transform' : this.drag ? 'drag' : 'idle'
      if (this.phase.get() !== phase) this.phase.set(phase)
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
  /**
   * The canvas size in CSS pixels (the window resized): the drawing keeps its zoom and pan (Illustrator); the reference
   * canvas B follows (same size and device-pixel ratio as Fabric's lower canvas).
   */
  resize(width: number, height: number) {
    if (width === this.canvas.getWidth() && height === this.canvas.getHeight()) return
    this.canvas.setDimensions({ width, height })
    if (this.ref) {
      const lower = this.canvas.lowerCanvasEl
      this.ref.el.width = lower.width
      this.ref.el.height = lower.height
      this.ref.el.style.width = lower.style.width
      this.ref.el.style.height = lower.style.height
    }
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
    if (this.mode !== 'V' && this.mode !== 'K') for (const c of curves.filter((c) => !c.locked)) want.push({ key: `d:${c.address}`, item: c, make: () => dotsOf(c) })
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

  /** a press that SELECTED something is a move, even where the new box's handle lies under the pointer (Illustrator):
   *  the new box is not Fabric's active object (no handles to grab) until that press ends */
  private pressSelected = false
  /** the handle box is Fabric's active object while it exists (Fabric draws its border and controls) */
  private activateBox() {
    const active = this.canvas.getActiveObject()
    if (this.pressSelected) {
      if (active) this.canvas.discardActiveObject()
      return
    }
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
    // selected anchors: filled squares (Illustrator Direct Selection)
    const sa = this.selection.getAnchors()
    if (sa.length) {
      const byAddr = new Map(ev.curves.map((c) => [c.address, c]))
      const pts = sa.flatMap((k) => {
        const [c, a] = k.split('#')
        const q = byAddr.get(c)?.anchors[a]?.p
        return q ? [q] : []
      })
      want.push({ key: 'anchors', item: { pts, z }, make: () => pts.map((q) => new Rect({ left: q.x, top: q.y, width: 6 / z, height: 6 / z, originX: 'center', originY: 'center', fill: '#1e88e5', stroke: '', strokeWidth: 0, selectable: false, evented: false, objectCaching: false })) })
    }
    const sh = (this.pen || this.drag || this.vGesture?.kind === 'move') ? this.snapHint : null
    if (sh) {
      const mk: FabricObject[] = []
      const guide = { stroke: '#e0218a', strokeWidth: 1 / z, strokeDashArray: [4 / z, 3 / z], selectable: false, evented: false, objectCaching: false }
      if (sh.kind === 'point' && sh.target) mk.push(new Rect({ left: sh.target.x, top: sh.target.y, width: 8 / z, height: 8 / z, originX: 'center', originY: 'center', fill: '', stroke: '#e0218a', strokeWidth: 1.5 / z, selectable: false, evented: false, objectCaching: false }))
      if (sh.guides.x !== undefined) mk.push(new Path(`M ${sh.guides.x} -100000 L ${sh.guides.x} 100000`, { fill: '', ...guide }))
      if (sh.guides.y !== undefined) mk.push(new Path(`M -100000 ${sh.guides.y} L 100000 ${sh.guides.y}`, { fill: '', ...guide }))
      want.push({ key: 'snap', item: { ...sh, z }, make: () => mk })
    }
    if (this.mode === 'P' && this.pen) {
      const pen = this.pen
      const cubics: [Vec, Vec, Vec, Vec][] = []
      const abs = (a: Anchor, h: 'hIn' | 'hOut') => ({ x: a.p.x + a[h].x, y: a.p.y + a[h].y })
      for (let i = 1; i < pen.anchors.length; i++) cubics.push([pen.anchors[i - 1].p, abs(pen.anchors[i - 1], 'hOut'), abs(pen.anchors[i], 'hIn'), pen.anchors[i].p])
      const last = pen.anchors[pen.anchors.length - 1]
      const objs = () => {
        const out: FabricObject[] = []
        if (cubics.length) out.push(new Path(cubicsToCommands(cubics), { fill: '', stroke: '#1e88e5', strokeWidth: 1.5 / z, selectable: false, evented: false, objectCaching: false }))
        if (pen.hover && !pen.dragging) out.push(new Path(cubicsToCommands([[last.p, abs(last, 'hOut'), pen.hover, pen.hover]]), { fill: '', stroke: '#1e88e5', strokeWidth: 1 / z, strokeDashArray: [4 / z, 3 / z], selectable: false, evented: false, objectCaching: false }))
        for (const a of pen.anchors) out.push(new Rect({ left: a.p.x, top: a.p.y, width: 5 / z, height: 5 / z, originX: 'center', originY: 'center', fill: '#fff', stroke: '#1e88e5', strokeWidth: 1 / z, selectable: false, evented: false, objectCaching: false }))
        if (last.hOut.x || last.hOut.y) for (const h of ['hIn', 'hOut'] as const) out.push(dot(abs(last, h), '#1e88e5', 2 / z))
        return out
      }
      want.push({ key: 'pen', item: { ...pen, anchors: [...pen.anchors] }, make: objs })
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
    if (this.pan || e.button !== 0) return
    if (this.mode === 'P') return this.penDown(e)
    if (this.mode === '+' || this.mode === '-' || this.mode === 'C') return this.structureClick(e)
    if (this.mode === 'K') return this.bucket(this.canvas.getScenePoint(e))
    if (this.mode === 'N') {
      // Convert Anchor Point (⇧C): click an anchor = corner (handles retracted); drag from it = smooth (symmetric
      // handles pulled out); drag a handle = move that handle alone (the pair is broken)
      const p = this.canvas.getScenePoint(e)
      const hit = hitTest(this.editor.derived.evaluated(), p, { mode: 'A', tolerance: 6 / this.canvas.getZoom() })
      if (hit && (hit.kind === 'anchor' || hit.kind === 'handle')) this.drag = { hit, start: { x: p.x, y: p.y }, op: this.editor.prepare(), ok: false, convert: hit.kind }
      return
    }
    if (this.mode !== 'A') return
    const p = this.canvas.getScenePoint(e)
    const hit = hitTest(this.editor.derived.evaluated(), p, { mode: 'A', tolerance: 6 / this.canvas.getZoom() })
    if (hit && hit.kind === 'anchor' && !hit.referenceId) {
      // Direct Selection: click selects the anchor (Shift toggles); dragging a selected anchor moves every selected one
      const key = anchorKey({ curveId: hit.curveId, anchorId: hit.anchorId })
      const now = this.selection.getAnchors()
      if (e.shiftKey) this.selection.setAnchors(now.includes(key) ? now.filter((k) => k !== key) : [...now, key])
      else if (!now.includes(key)) this.selection.setAnchors([key])
      const sel = this.selection.getAnchors()
      this.selection.set([...new Set(sel.map((k) => k.split('#')[0]))])
      if (sel.includes(key)) this.drag = { hit, start: { x: p.x, y: p.y }, op: this.editor.prepare(), ok: false, targets: sel.map((k) => ({ curveId: k.split('#')[0] as any, anchorId: k.split('#')[1] })) }
      return
    }
    if (hit && (hit.kind === 'anchor' || hit.kind === 'handle')) {
      this.drag = { hit, start: { x: p.x, y: p.y }, op: this.editor.prepare(), ok: false }
      // a smooth point's handle turns the other one with it (they stay in line); ⌥ breaks them (Illustrator)
      if (hit.kind === 'handle') {
        const a = (this.editor.reader.get(hit.curveId) as CurveRecord | undefined)?.anchors[hit.anchorId]
        if (e.altKey) this.drag.breakPair = true
        else if (a && isSmooth(a)) this.drag.smooth = { hIn: { ...a.hIn }, hOut: { ...a.hOut } }
      }
    }
    // Direct Selection (Illustrator A): a click on a path selects that object itself, never its group
    else if (hit) {
      this.selection.setAnchors([])
      this.selection.set([hit.address.split('/')[0]])
    } else {
      // empty space: a marquee selects the anchors inside it (Direct Selection)
      if (!e.shiftKey) this.selection.clear()
      this.vGesture = { kind: 'marquee', start: { x: p.x, y: p.y }, now: { x: p.x, y: p.y }, additive: e.shiftKey, enclosed: false }
    }
  }

  // ---- Pen (Illustrator P): click = corner anchor, drag = smooth anchor (symmetric handles), Shift = 45°; click the
  // first anchor to close; Enter / Esc / another tool ends the path; ⌘Z while drawing removes the last anchor. Over
  // the SELECTED path the pen adds an anchor on a segment and deletes an inner anchor (Illustrator's auto add / delete).
  // Adaptation: the path enters the document when it ends (a curve needs one segment) — one createCurve, one undo step.
  private penDown(e: PointerEvent) {
    const z = this.canvas.getZoom()
    let p: Vec = this.canvas.getScenePoint(e)
    p = e.shiftKey && this.pen ? { x: round(p.x), y: round(p.y) } : this.snapAt({ x: round(p.x), y: round(p.y) }).p
    const pen = this.pen
    if (!pen) {
      const ev = this.editor.derived.evaluated()
      const selected = new Set([...this.selection.get(), ...this.selection.getAnchors().map((k) => k.split('#')[0])])
      const hit = hitTest(ev, p, { mode: 'A', tolerance: 6 / z })
      // on an END of an open path: continue that path (Illustrator)
      if (hit?.kind === 'anchor' && !hit.referenceId) {
        const c = this.editor.reader.get(hit.curveId) as CurveRecord
        const first = c.segments[0]?.from, last = c.segments[c.segments.length - 1]?.to
        if (!c.closed && first !== last && (hit.anchorId === first || hit.anchorId === last)) {
          const end = hit.anchorId === last ? 'end' : 'start'
          const a = c.anchors[hit.anchorId]
          const ea = ev.curves.find((x) => x.address === c.id)!.anchors
          const other = ea[end === 'end' ? first : last].p
          // the draft starts AT the end anchor, in drawing order (outward): at the start the curve runs the other way
          this.pen = { anchors: [{ id: hit.anchorId, p: ea[hit.anchorId].p, hIn: end === 'end' ? a.hIn : a.hOut, hOut: { x: 0, y: 0 } }], dragging: true, closing: false, from: { curveId: c.id, end, other: { ...other } } }
          this.selection.set([c.id])
          this.render()
          return
        }
      }
      if (hit && (hit.kind === 'anchor' || hit.kind === 'segment') && !hit.referenceId && selected.has(hit.curveId)) {
        if (hit.kind === 'segment') this.applyAndLog({ type: 'insertPoint', curveId: hit.curveId, segmentId: hit.segmentId, u: hit.t })
        else this.deleteAnchor(hit.curveId, hit.anchorId)
        return
      }
      this.pen = { anchors: [{ id: 'p1', p, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }], dragging: true, closing: false }
      this.render()
      return
    }
    const first = pen.from ? { p: pen.from.other } : pen.anchors[0]
    if ((pen.from ? pen.anchors.length >= 1 : pen.anchors.length >= 2) && Math.hypot(p.x - first.p.x, p.y - first.p.y) <= 6 / z) {
      pen.closing = true
      pen.dragging = true
      return
    }
    const last = pen.anchors[pen.anchors.length - 1]
    if (e.shiftKey) {
      const dx = p.x - last.p.x, dy = p.y - last.p.y
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy)
      p = { x: round(last.p.x + len * Math.cos(a)), y: round(last.p.y + len * Math.sin(a)) }
    }
    pen.anchors.push({ id: `p${pen.anchors.length + 1}`, p, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
    pen.dragging = true
    this.render()
  }

  private penMove(e: PointerEvent) {
    const pen = this.pen!
    const p = this.canvas.getScenePoint(e)
    if (!pen.dragging) {
      pen.hover = e.shiftKey ? { x: p.x, y: p.y } : this.snapAt({ x: p.x, y: p.y }).p
      this.render()
      return
    }
    // dragging out the handles of the anchor just placed (or of the first anchor when closing): symmetric, smooth
    if (pen.closing && pen.from) return // closing onto the path's other end: its handles stay as stored
    const a = pen.closing ? pen.anchors[0] : pen.anchors[pen.anchors.length - 1]
    let d = { x: round(p.x - a.p.x), y: round(p.y - a.p.y) }
    if (Math.hypot(d.x, d.y) * this.canvas.getZoom() < 2) d = { x: 0, y: 0 }
    a.hOut = d
    a.hIn = { x: 0 - d.x, y: 0 - d.y } // 0 − x: never a negative zero in the data
    // dragged out with the pen: a smooth point by choice (Illustrator); a plain click stays untyped (a corner)
    if (d.x || d.y) a.type = 'smooth'
    else delete a.type
    this.render()
  }

  private penUp() {
    const pen = this.pen
    this.snapHint = null
    if (!pen) return
    pen.dragging = false
    if (pen.closing) this.finishPen(true)
  }

  /** ⌘Z while drawing: remove the last anchor (true = handled) */
  penUndo() {
    if (!this.pen) return false
    this.pen.anchors.pop()
    if (!this.pen.anchors.length) this.pen = null
    this.render()
    return true
  }

  /** end the path: two or more anchors become one curve in the target layer, on top of it, then selected */
  finishPen(closed = false) {
    const pen = this.pen
    this.pen = null
    if (pen?.from) return this.finishContinuation(pen as { anchors: Anchor[]; from: { curveId: string; end: 'start' | 'end' } }, closed)
    if (!pen || pen.anchors.length < 2) return this.render(), null
    const layer = this.targetLayer()
    if (typeof layer !== 'string') {
      this.setStatus(layer.error)
      this.render()
      return null
    }
    const anchors = Object.fromEntries(pen.anchors.map((a) => [a.id, a]))
    const segments = pen.anchors.slice(1).map((a, i) => ({ id: `s${i + 1}`, from: pen.anchors[i].id, to: a.id }))
    if (closed) segments.push({ id: `s${segments.length + 1}`, from: pen.anchors[pen.anchors.length - 1].id, to: pen.anchors[0].id })
    const siblings = (['container', 'curve', 'fill', 'reference'] as const).flatMap((t) => childrenOf(this.editor.reader as any, layer, t).map((id) => (this.editor.reader.get(id as any) as unknown as { index: string }).index))
    const top = siblings.sort().at(-1) ?? null
    const r = this.applyAndLog({ type: 'createCurve', parentId: layer as any, index: getIndexAbove(top as IndexKey | null), anchors, segments, closed })
    if (r.ok && r.written) this.selection.set([r.affected[0]])
    this.render()
    return r
  }

  /** a continued path: the drafted anchors are added to that curve (extendCurve) — closing onto its other end too, one step */
  private finishContinuation(pen: { anchors: Anchor[]; from: { curveId: string; end: 'start' | 'end' } }, closed: boolean) {
    const [endDraft, ...drawn] = pen.anchors
    const outer = endDraft.hOut.x || endDraft.hOut.y ? endDraft.hOut : undefined
    if (!drawn.length && !closed && !outer) return this.render(), null
    // the layer may have been hidden (or locked) while drawing: checked again when the path ends, as for a new path
    // (review of 3ef87db S2)
    const curve = this.editor.reader.get(pen.from.curveId as any) as CurveRecord | undefined
    const chain = curve ? containerChain(this.editor.reader, curve.parentId) : []
    const blocked = chain.find((k) => !k.visible || k.locked)
    if (blocked) {
      this.setStatus(`LOCKED: 图层「${blocked.name}」${blocked.locked ? '已锁定' : '已隐藏'}，不能在上面画`)
      this.render()
      return null
    }
    // drawing order → curve order: appended as drawn at the end; before the first anchor (reversed, handles swapped) at the start
    const anchors = pen.from.end === 'end' ? drawn : [...drawn].reverse().map((a) => ({ ...a, hIn: a.hOut, hOut: a.hIn }))
    const cmd: Command = { type: 'extendCurve', curveId: pen.from.curveId as any, end: pen.from.end, anchors, ...(outer ? { endHandle: outer } : {}) }
    if (!closed) {
      const r = this.applyAndLog(cmd)
      this.render()
      return r
    }
    const run = this.editor.batchRun('continuePath', () => {
      // the end's dragged outer handle is kept also when closing straight away (review of 3ef87db S1)
      if (drawn.length || outer) {
        const a = this.editor.apply(cmd)
        if (!a.ok) throw a.error
      }
      const b = this.editor.apply({ type: 'addClosingSegment', curveId: pen.from.curveId as any })
      if (!b.ok) throw b.error
    })
    const err = !run.ok ? (run.thrown as EditError) : null
    this.setStatus(err ? `${err.code ?? 'INVALID'}: ${err.message ?? String(err)}` : '')
    this.render()
    return run
  }

  /** where new drawing goes (Illustrator: the current layer): the layer of the selection, else the front-most layer */
  targetLayer(): string | { error: string } {
    const reader = this.editor.reader
    const sel = this.selection.get()[0]
    const top = sel ? (layerOf(reader, sel) ?? sel) : childrenOf(reader as any, null, 'container').map((id) => reader.get(id as any) as ContainerRecord).sort((a, b) => (a.index < b.index ? 1 : -1))[0]?.id
    const rec = top ? (reader.get(top as any) as ContainerRecord | undefined) : undefined
    if (!rec || rec.typeName !== 'container') return { error: 'INVALID: 没有可画入的图层（先新建或选中一个图层）' }
    if (rec.locked || !rec.visible) return { error: `LOCKED: 图层「${rec.name}」${rec.locked ? '已锁定' : '已隐藏'}，不能在上面画` }
    return rec.id
  }

  // ---- Add / Delete Anchor Point (+ / −) and Scissors (C): one click = one structure command (Illustrator) ----
  private structureClick(e: PointerEvent) {
    const ev = this.editor.derived.evaluated()
    const p = this.canvas.getScenePoint(e)
    const tol = 6 / this.canvas.getZoom()
    const anchor = hitTest(ev, p, { mode: 'A', tolerance: tol })
    const seg = hitStack(ev, p, tol).find((h) => h.kind === 'segment') as Extract<Hit, { kind: 'segment' }> | undefined
    const viaRef = (h: { referenceId?: string } | undefined | null) => {
      if (h?.referenceId) this.setStatus('INVALID: 引用里的线请在源上编辑（双击进入源，或用 A 勾选「在引用里改源」）')
      return !!h?.referenceId
    }
    if (this.mode === '+') {
      if (seg && !viaRef(seg)) this.applyAndLog({ type: 'insertPoint', curveId: seg.curveId, segmentId: seg.segmentId, u: seg.t })
      return
    }
    if (this.mode === '-') {
      if (anchor?.kind === 'anchor' && !viaRef(anchor)) this.deleteAnchor(anchor.curveId, anchor.anchorId)
      return
    }
    // Scissors: at an anchor, split there; on a segment, add an anchor there and split at it (one undo step)
    if (anchor?.kind === 'anchor') {
      if (!viaRef(anchor)) this.applyAndLog({ type: 'breakAt', curveId: anchor.curveId, anchorId: anchor.anchorId })
      return
    }
    if (seg && !viaRef(seg)) {
      const run = this.editor.batchRun('scissors', () => {
        const a = this.editor.apply({ type: 'insertPoint', curveId: seg.curveId, segmentId: seg.segmentId, u: seg.t })
        if (!a.ok) throw a.error
        const m = a.affected[1].split('#')[1]
        const b = this.editor.apply({ type: 'breakAt', curveId: seg.curveId, anchorId: m })
        if (!b.ok) throw b.error
        return b
      })
      const err = !run.ok ? (run.thrown as EditError) : null
      this.log.push({ source: 'ui', cmd: { type: 'insertPoint', curveId: seg.curveId, segmentId: seg.segmentId, u: seg.t }, ok: run.ok, written: run.ok && run.written, error: err ?? undefined })
      this.setStatus(err ? `${err.code ?? 'INVALID'}: ${err.message ?? String(err)}` : '')
    }
  }

  /**
   * Live Paint Bucket (K, fills.ts): the area the lines enclose at the click gets a face of the current fill colour in
   * the lines' shape group (made / reused by `paintRegion`, shapes.ts); an area already filled gets the colour. The
   * shape group is selected.
   */
  bucket(p: Vec) {
    // the front-most of: the drawn fills there (locked ones too), colourless areas (§30.24), the area the lines
    // enclose — never reaching through what is in front (fills.bucketTarget, doc 18 §30.25)
    const t = bucketTarget(this.editor.reader, this.editor.derived.evaluated(), p)
    return this.fillFace('error' in t ? t : { boundary: t.boundary, curves: [], area: 0 })
  }
  /** 建立填充 from the selection (v103 createFill(curveIds)): the outline the selected lines form, in the fill colour */
  fillSelection() {
    const reader = this.editor.reader
    const curves = this.selection.get().flatMap((id) => {
      const r = reader.get(id as any) as DocRecord | undefined
      return r?.typeName === 'curve' ? [id] : r?.typeName === 'container' ? within(reader as any, r.id as any, 'curve') : []
    })
    return this.fillFace(outlineOf(reader, this.editor.derived.evaluated(), curves))
  }
  private fillFace(face: ReturnType<typeof faceAt>) {
    if ('error' in face) return this.setStatus(face.error), null
    const r = this.applyAndLog({ type: 'paintRegion', boundary: face.boundary, color: this.fillColor.get() })
    // the shape (or an older file's own fill) is the object now selected
    if (r.ok) this.selection.set([r.affected[0]])
    return r
  }

  /** Delete Anchor Point: an inner anchor joins its neighbours keeping their handles (Illustrator); an end anchor is
   *  removed with its segment */
  deleteAnchor(curveId: string, anchorId: string) {
    const c = this.editor.reader.get(curveId as any) as { segments: { from: string; to: string }[] } | undefined
    if (!c) return null
    const inner = c.segments.some((s) => s.to === anchorId) && c.segments.some((s) => s.from === anchorId)
    return this.applyAndLog(inner ? { type: 'removeAnchorJoin', curveId: curveId as any, anchorId, mode: 'keepHandles' } : { type: 'deleteAnchorWithSegments', curveId: curveId as any, anchorId })
  }

  /** Delete with anchors selected (A): each anchor goes with its segments (Illustrator) — one undo step */
  deleteSelectedAnchors() {
    const keys = this.selection.getAnchors()
    if (!keys.length) return null
    const run = this.editor.batchRun('deleteAnchors', () => {
      for (const k of keys) {
        const [c, a] = k.split('#')
        if (!(this.editor.reader.get(c as any) as any)?.anchors?.[a]) continue // gone with an earlier one
        const r = this.editor.apply({ type: 'deleteAnchorWithSegments', curveId: c as any, anchorId: a })
        if (!r.ok) throw r.error
      }
    })
    const err = !run.ok ? (run.thrown as EditError) : null
    this.setStatus(err ? `${err.code ?? 'INVALID'}: ${err.message ?? String(err)}` : '')
    if (run.ok) this.selection.clear()
    return run
  }

  /**
   * Join (⌘J, Illustrator Object › Path › Join): two selected END anchors of one open path → close it (coincident: merge
   * the ends into one anchor, else a closing segment); end anchors of two paths → connect them (one shared node at the
   * midpoint: Average + Join — our `bind`); an open path selected with V → close it with a segment.
   */
  join() {
    const reader = this.editor.reader
    const keys = this.selection.getAnchors()
    const isEnd = (c: CurveRecord, a: string) => !c.closed && (!c.segments.some((s) => s.to === a) || !c.segments.some((s) => s.from === a))
    if (keys.length === 2) {
      const [[ca, aa], [cb, ab]] = keys.map((k) => k.split('#'))
      const A = reader.get(ca as any) as CurveRecord | undefined, B = reader.get(cb as any) as CurveRecord | undefined
      if (!A || !B || !isEnd(A, aa) || !isEnd(B, ab)) return this.setStatus('INVALID: 连接需要选中两个端点'), null
      if (ca === cb) {
        const pa = A.anchors[aa].p, pb = A.anchors[ab].p
        return this.applyAndLog(pa.x === pb.x && pa.y === pb.y ? { type: 'mergeEnds', curveId: A.id, keep: 'mid' } : { type: 'addClosingSegment', curveId: A.id })
      }
      return this.applyAndLog({ type: 'bind', a: { curveId: A.id, anchorId: aa }, b: { curveId: B.id, anchorId: ab }, keep: 'mid' })
    }
    const ids = this.selection.get()
    const one = ids.length === 1 ? (reader.get(ids[0] as any) as CurveRecord | undefined) : undefined
    if (one?.typeName === 'curve' && !one.closed) return this.applyAndLog({ type: 'addClosingSegment', curveId: one.id })
    this.setStatus('INVALID: 连接：用 A 选中两个端点，或用 V 选中一条开放路径')
    return null
  }

  // ---- copy / paste (clipboard.ts): the system clipboard holds the content as JSON text (tldraw / Excalidraw), and a
  // copy is also kept in the page so paste works where the browser does not grant clipboard reading ----
  private clip: string | null = null

  /**
   * ⌘C: the selection's content to the clipboard; a refusal (a fill without its curves …) is said. The content is taken
   * when the copy STARTS (dot: asynchronous operations fix their objects at the start).
   */
  async copy(ids: readonly string[] = this.selection.get()) {
    ids = ids.filter((id) => this.editor.reader.get(id as any))
    if (!ids.length) return false
    const c = contentOf(this.editor.reader, ids, this.editor.documentToken)
    if ('error' in c) return this.setStatus(`${c.error.code}: ${c.error.message}`), false
    this.clip = JSON.stringify(c)
    try {
      await navigator.clipboard?.writeText(this.clip)
    } catch {
      // not granted: the page copy above is enough inside this page
    }
    this.setStatus('')
    return true
  }
  /**
   * ⌘X: copy, then delete (the delete is the undo step). The objects are the ones selected when the cut STARTED; the
   * delete happens only if the document did not change while the clipboard was written (another document opened, any
   * edit) — otherwise the copy stands, nothing is deleted, and the status says so (dot, review of 7538032).
   */
  async cut() {
    const ids = this.selection.get().filter((id) => this.editor.reader.get(id as any))
    if (!ids.length) return null
    const epoch = this.editor.documentEpoch, revision = this.editor.revision
    if (!(await this.copy(ids))) return null
    if (this.editor.documentEpoch !== epoch || this.editor.revision !== revision) {
      this.setStatus('剪切：复制完成时文档已经变了，没有删除（内容已复制）')
      return null
    }
    return this.deleteSelection(ids)
  }
  /**
   * ⌘V: at the centre of the view; ⇧⌘V (`inPlace`): where it was (Illustrator Paste / Paste in Place). Into the current
   * layer, on top; the pasted objects become the selection. The layer and the view are taken when the paste STARTS; a
   * paste whose document was replaced meanwhile does nothing.
   */
  async paste(inPlace = false) {
    const epoch = this.editor.documentEpoch
    const layer = this.targetLayer()
    if (typeof layer !== 'string') return this.setStatus(layer.error), null
    const inv = util.invertTransform(this.canvas.viewportTransform)
    const centreOfView = util.transformPoint(new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2), inv)
    let text = this.clip
    try {
      const t = await navigator.clipboard?.readText()
      if (t && parseContent(t)) text = t
    } catch {
      // not granted: the page copy
    }
    if (this.editor.documentEpoch !== epoch) return this.setStatus('粘贴：读取剪贴板时已经打开了别的文档，没有粘贴'), null
    const content = text ? parseContent(text) : null
    if (!content) return this.setStatus('剪贴板里没有可以粘贴的图形'), null
    let offset = { x: 0, y: 0 }
    const centre = contentCentre(content)
    if (!inPlace && centre) offset = { x: round(centreOfView.x - centre.x), y: round(centreOfView.y - centre.y) }
    const r = this.applyAndLog({ type: 'pasteContent', content, parentId: layer as any, offset, origin: this.editor.documentToken })
    if (r.ok && r.written) this.selection.set(r.affected.filter((id) => (this.editor.reader.get(id as any) as { parentId?: string } | undefined)?.parentId === layer))
    return r
  }

  // ---- masks (Illustrator Object › Clipping Mask): ⌘7 Make, ⌥⌘7 Release; the panel switches mode / enabled ----
  /**
   * ⌘7: of the selected objects the FRONT-most is the mask's source (a fill: its area; a line: its ink; a group: the
   * fills and lines inside it), the others its targets, mode `inside` (a clipping mask). Adaptation (stated): the source
   * stays visible — hide it yourself if wanted (a hidden source still masks, §1.7b).
   */
  makeMask() {
    const reader = this.editor.reader
    const ids = this.selection.get().filter((id) => reader.get(id as any))
    if (ids.length < 2) return this.setStatus('INVALID: 建立蒙版需要选中至少两个对象：最上面的当蒙版，其余被蒙'), null
    const ev = this.editor.derived.evaluated()
    const order = ev.paint.map((p) => p.item.address)
    const front = (id: string) => Math.max(-1, ...order.map((a, i) => (isInside(reader, a.split('/')[0], id) ? i : -1)))
    const src = [...ids].sort((a, b) => front(b) - front(a))[0]
    const r = reader.get(src as any) as DocRecord
    // a selected whole path brings its own fill (doc 18 §30.18; dot 1791360107): as the source, its ink AND its filled
    // area; as a target, its ink AND its fill. Only this UI expansion — a stored curve address still means its ink,
    // a fill address its area (older files and the API keep that meaning)
    const own = (id: string) => ((reader.get(id as any) as DocRecord | undefined)?.typeName === 'curve' ? ownFillsOf(reader as any, id) : [])
    const inside = (t: 'fill' | 'curve') => (r.typeName === 'container' ? within(reader as any, r.id as any, t) : r.typeName === t ? [r.id] : [])
    const sources = { fills: [...inside('fill'), ...own(src)] as any[], strokes: inside('curve') as any[] }
    if (!sources.fills.length && !sources.strokes.length) return this.setStatus(`INVALID: ${src} 不能当蒙版（需要填充或线）`), null
    const targets = ids.filter((id) => id !== src).flatMap((id) => [id, ...own(id)])
    return this.applyAndLog({ type: 'setMask', name: `蒙版（${(r as { name?: string }).name ?? src}）`, sources, targets, mode: 'inside' })
  }
  /** ⌥⌘7: remove the masks the selection takes part in (as source or target) — one undo step */
  releaseMask() {
    const masks = [...new Map(this.selection.get().flatMap((id) => masksOf(this.editor.reader, id)).map((x) => [x.mask.id, x.mask])).values()]
    if (!masks.length) return this.setStatus('INVALID: 选中的对象没有参与蒙版'), null
    return this.applyAndLog({ type: 'deleteRecords', ids: masks.map((m) => m.id) })
  }
  /** the panel: a mask's mode (正常 inside / 反转 outside) or enabled, the rest kept */
  setMaskProps(id: string, change: { mode?: 'inside' | 'outside'; enabled?: boolean }) {
    const m = this.editor.reader.get(id as any) as any
    if (!m) return null
    return this.applyAndLog({ type: 'setMask', id: m.id, name: m.name, sources: m.sources, targets: m.targets, mode: change.mode ?? m.mode, enabled: change.enabled ?? m.enabled })
  }

  // ---- arrange / group / layers (arrange.ts; Illustrator ⌘] ⌘[ ⌘G ⇧⌘G, Layers › New Layer) ----
  arrange(to: 'front' | 'forward' | 'backward' | 'back') {
    const ids = this.selection.get().filter((id) => this.editor.reader.get(id as any))
    if (!ids.length) return null
    return this.applyAndLog({ type: 'arrange', ids, to })
  }
  group() {
    const ids = this.selection.get().filter((id) => this.editor.reader.get(id as any))
    if (!ids.length) return null
    const r = this.applyAndLog({ type: 'group', ids })
    if (r.ok && r.written) this.selection.set([r.affected[0]])
    return r
  }
  ungroup() {
    const ids = this.selection.get().filter((id) => (this.editor.reader.get(id as any) as DocRecord | undefined)?.typeName === 'container')
    if (!ids.length) return this.setStatus('INVALID: 先选中一个组'), null
    const kids = ids.flatMap((g) => (['container', 'curve', 'fill', 'reference'] as const).flatMap((t) => childrenOf(this.editor.reader as any, g, t)))
    const r = this.applyAndLog({ type: 'ungroup', ids })
    if (r.ok && r.written) this.selection.set(kids)
    return r
  }
  /** a new layer on top (Illustrator: above the current layer's stack — here the top of the layers) */
  newLayer() {
    const r = this.applyAndLog({ type: 'createContainer', parentId: null })
    if (r.ok && r.written) this.selection.set([r.affected[0]])
    return r
  }

  /** the drawing as an exported file (export.ts): PNG through the reference renderer without aids, 2×; or SVG */
  async exportBlob(kind: 'png' | 'svg', scale = 2): Promise<Blob | null> {
    const ev = this.editor.derived.evaluated()
    const box = drawingBounds(ev)
    if (!box) return null
    if (kind === 'svg') return new Blob([toSVG(ev, box)], { type: 'image/svg+xml' })
    const el = document.createElement('canvas')
    el.width = Math.max(1, Math.ceil(box.w * scale))
    el.height = Math.max(1, Math.ceil(box.h * scale))
    new Canvas2DRef(el).draw([scale, 0, 0, scale, -box.x * scale, -box.y * scale], 1, ev, [], { aids: false })
    return new Promise((resolve) => el.toBlob((b) => resolve(b), 'image/png'))
  }

  /** remove a shared node (the properties panel's 断开连接) */
  unbind(connectionId: string) {
    return this.applyAndLog({ type: 'unbind', connectionId: connectionId as any })
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
    this.selection.setAnchors([])
    if (unit) {
      const before = this.selection.get()
      if (!e.shiftKey && (behind || !now.includes(unit))) this.pressSelected = true
      if (e.shiftKey) this.selection.toggle(unit)
      else if (behind || !now.includes(unit)) this.selection.set([unit])
      if (this.selection.get() === before) this.pressSelected = false
      const ids = this.selection.get()
      // the canvas has re-rendered for the new selection (react): the box is current
      if (ids.includes(unit) && !this.boxItem?.locked) {
        // the point that snaps: the selection's anchor nearest the pointer (within the tolerance), else the pointer
        const ev = this.editor.derived.evaluated()
        const mine = new Set(drawnOf(reader, ev, ids))
        const refs: AnchorRef[] = []
        let grab: Vec = { x: p.x, y: p.y }, best = 6 / this.canvas.getZoom()
        const movingRefs: string[] = []
        for (const c of ev.curves.filter((x) => mine.has(x.address)))
          for (const a of Object.values(c.anchors)) {
            if (!c.referenceId) refs.push({ curveId: c.curveId, anchorId: a.id })
            else movingRefs.push(`ref:${c.referenceId}`)
            const d = Math.hypot(a.p.x - p.x, a.p.y - p.y)
            if (d <= best) (best = d), (grab = { ...a.p })
          }
        // a fill moves its boundary lines: their anchors move too
        for (const id of ids) {
          const f = reader.get(id as any) as DocRecord | undefined
          if (f?.typeName === 'fill') for (const st of f.boundary) if (!('bridge' in st)) for (const aid of Object.keys((reader.get(st.curveId) as CurveRecord).anchors)) refs.push({ curveId: st.curveId, anchorId: aid })
        }
        const moving = this.movingSet(refs)
        for (const r of movingRefs) moving.add(r)
        this.vGesture = { kind: 'move', start: { x: p.x, y: p.y }, op: this.editor.prepare(), ids: [...ids], ok: false, grab, moving }
      }
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
  deleteSelection(of: readonly string[] = this.selection.get()) {
    const ids = of.filter((id) => this.editor.reader.get(id as any))
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
    if ((hit.kind === 'handle' || this.drag?.convert) && hit.referenceId && !this.editSource)
      return { error: { code: 'INVALID', message: 'handle overrides on a reference are not supported in this slice; tick 改源 to edit the source', objects: [hit.address], fixes: ['tick 改源'] } }
    if (this.drag?.convert === 'anchor') return { type: 'setHandles', target, hIn: { x: 0 - local.x, y: 0 - local.y }, hOut: { ...local }, pointType: 'smooth' }
    if (hit.kind === 'handle') {
      const sm = this.drag?.smooth
      if (sm) {
        // the dragged handle follows the pointer; the other keeps its length, pointing the opposite way
        const key = hit.handle === 'in' ? 'hIn' : 'hOut', other = hit.handle === 'in' ? 'hOut' : 'hIn'
        const moved = { x: round(sm[key].x + local.x), y: round(sm[key].y + local.y) }
        const len = Math.hypot(moved.x, moved.y), keep = Math.hypot(sm[other].x, sm[other].y)
        const opp = len > 1e-9 ? { x: round((0 - moved.x / len) * keep), y: round((0 - moved.y / len) * keep) } : { ...sm[other] }
        return { type: 'setHandles', target, ...(key === 'hIn' ? { hIn: moved, hOut: opp } : { hIn: opp, hOut: moved }) } as Command
      }
      // ⌥ (at the press or during the drag) or the Convert tool: this handle alone, and the point becomes a corner — kept
      // until the author makes it smooth again (it is not re-inferred from the handles lining up)
      const corner = this.drag?.breakPair || this.drag?.convert === 'handle'
      return { type: 'moveHandle', target, handle: hit.handle, delta: local, ...(corner ? { pointType: 'corner' as const } : {}) }
    }
    if (hit.referenceId && !this.editSource) return { type: 'moveOverride', referenceId: hit.referenceId, target, delta: local }
    return { type: 'moveAnchors', targets: this.drag?.targets ?? [target], delta: local }
  }

  private onMove(e: PointerEvent) {
    if (this.pen && this.mode === 'P') return this.penMove(e)
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
      if (!e.shiftKey && g.grab) {
        const s = this.snapAt({ x: g.grab.x + dx, y: g.grab.y + dy }, g.moving)
        dx = s.p.x - g.grab.x
        dy = s.p.y - g.grab.y
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
    if (e.altKey && this.drag.hit.kind === 'handle' && !this.drag.convert) {
      // ⌥ pressed during a handle drag breaks the pair from then on (Illustrator)
      this.drag.smooth = undefined
      this.drag.breakPair = true
    }
    const p = this.canvas.getScenePoint(e)
    let delta = { x: round(p.x - this.drag.start.x), y: round(p.y - this.drag.start.y) }
    // an anchor being dragged snaps onto other anchors / aligns with them (Smart Guides); handles do not snap
    const dh = this.drag.hit
    if (dh.kind === 'anchor' && !dh.referenceId && !this.drag.convert) {
      if (!this.drag.origin) {
        const ea = this.editor.derived.evaluated().curves.find((c) => c.address === dh.curveId)?.anchors[dh.anchorId]
        this.drag.origin = ea ? { ...ea.p } : { ...this.drag.start }
        this.drag.moving = this.movingSet(this.drag.targets ?? [{ curveId: dh.curveId, anchorId: dh.anchorId }])
      }
      const o = this.drag.origin
      const s = this.snapAt({ x: o.x + delta.x, y: o.y + delta.y }, this.drag.moving)
      delta = { x: round(s.p.x - o.x), y: round(s.p.y - o.y) }
    }
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
    this.snapHint = null
    if (this.pressSelected) {
      this.pressSelected = false
      queueMicrotask(() => this.render()) // the box takes its handles now
    }
    const g = this.vGesture
    if (g?.kind === 'move') {
      this.vGesture = null
      this.finishV(g)
      this.render()
      return
    }
    if (this.mode === 'P') return this.penUp()
    if (g?.kind === 'marquee') {
      this.vGesture = null
      const z = this.canvas.getZoom()
      // a click without a drag only deselects (done on press)
      if (Math.abs(g.now.x - g.start.x) * z >= 2 || Math.abs(g.now.y - g.start.y) * z >= 2) {
        const rect = { x0: g.start.x, y0: g.start.y, x1: g.now.x, y1: g.now.y }
        if (this.mode === 'A') {
          const keys = anchorsInRect(this.editor.derived.evaluated(), rect)
          this.selection.setAnchors(g.additive ? [...this.selection.getAnchors(), ...keys] : keys)
          this.selection.set([...new Set(this.selection.getAnchors().map((k) => k.split('#')[0]))])
        } else {
          const units = unitsInRect(this.editor.reader, this.editor.derived.evaluated(), rect, g.enclosed)
          if (g.additive) this.selection.add(units)
          else this.selection.set(units)
        }
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
    if (!d.cmd && d.convert === 'anchor' && !d.hit.referenceId) {
      d.op.cancel()
      const a = (this.editor.reader.get(d.hit.curveId) as CurveRecord | undefined)?.anchors[d.hit.anchorId]
      if (a && (a.hIn.x || a.hIn.y || a.hOut.x || a.hOut.y || a.type !== 'corner')) this.applyAndLog({ type: 'setHandles', target: { curveId: d.hit.curveId, anchorId: d.hit.anchorId }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 }, pointType: 'corner' })
      this.render()
      return
    }
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
/** a smooth point: both handles out, in one straight line through the anchor (opposite directions, within 0.5°) */
export function isSmooth(a: { hIn: Vec; hOut: Vec; type?: 'smooth' | 'corner' }) {
  // the author's choice wins; only a point never typed is inferred from its handles (review of b818183)
  if (a.type) return a.type === 'smooth'
  const li = Math.hypot(a.hIn.x, a.hIn.y), lo = Math.hypot(a.hOut.x, a.hOut.y)
  if (li < 1e-9 || lo < 1e-9) return false
  const cos = (a.hIn.x * a.hOut.x + a.hIn.y * a.hOut.y) / (li * lo)
  return cos < -Math.cos((0.5 * Math.PI) / 180)
}

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
