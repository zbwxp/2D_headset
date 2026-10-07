// A reference image's properties (doc 18 §31.8; bowen 1791365335, dot 1791365450 / 1791365752):
// - opacity (how it is shown — its pixels never change);
// - X / Y (its centre in the drawing), size (% of its own pixels) and angle: each by typing (Enter commits, Esc puts it
//   back), by a slider centred on the current value (re-centred when released, so any distance is reachable — one
//   undo step per drag) and, for X / Y, by the arrow keys on the canvas (the usual nudge of the selection);
//   size and angle change about the image's centre and keep the rest of its placement (mirror, any skew from the
//   canvas box); the panel's size is uniform;
// - position slots: each slot shows its number, whether it holds a position and that position; 「存」 writes the
//   CURRENT placement into that slot (empty or not), 「调出」 recalls it — two separate buttons, the slot itself does
//   nothing (v103's trap, §31.8); the slot matching the current placement is marked; after 存 the status line names
//   the slot. Both work while the layer is locked (the one stated lock exemption, imageCommands.ts).
import { useValue } from '@tldraw/state-react'
import { useEffect, useRef, useState } from 'react'
import type { Command } from '../commands'
import type { Affine, ImageRecord } from '../schema'
import type { Ui } from './panels'

const fmt = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d)
const same = (a: Affine, b: Affine) => a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.e === b.e && a.f === b.f
const apply = (m: Affine, x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f })
const mul = (m: Affine, n: Affine): Affine => ({ a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f })
/** the placement's numbers: centre (drawing), size (fraction of its own pixels), angle (degrees) */
export function placementOf(img: Pick<ImageRecord, 'width' | 'height' | 'transform'>) {
  const m = img.transform
  const c = apply(m, img.width / 2, img.height / 2)
  return { x: c.x, y: c.y, size: Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)), angle: (Math.atan2(m.b, m.a) * 180) / Math.PI }
}
/** `m` changed about the image's centre by `n` (scale / rotate), the rest of the placement kept */
const about = (img: Pick<ImageRecord, 'width' | 'height' | 'transform'>, n: Affine): Affine => {
  const c = apply(img.transform, img.width / 2, img.height / 2)
  return mul({ a: 1, b: 0, c: 0, d: 1, e: c.x, f: c.y }, mul(n, mul({ a: 1, b: 0, c: 0, d: 1, e: -c.x, f: -c.y }, img.transform)))
}
export const withCentre = (img: ImageRecord, x: number, y: number): Affine => {
  const p = placementOf(img)
  return { ...img.transform, e: img.transform.e + (x - p.x), f: img.transform.f + (y - p.y) }
}
export const withSize = (img: ImageRecord, size: number): Affine => {
  const k = size / placementOf(img).size
  return about(img, { a: k, b: 0, c: 0, d: k, e: 0, f: 0 })
}
export const withAngle = (img: ImageRecord, deg: number): Affine => {
  const r = ((deg - placementOf(img).angle) * Math.PI) / 180
  return about(img, { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 })
}

/**
 * A slider drag as one panel gesture (FabricView.beginPanelGesture): previewed while dragging, committed once on release
 * — one undo step — and cancelled by Esc (nothing written, the slider put back). Review of 4a208bc D3 / D4.
 */
function useSliderGesture(ui: Ui, reset: () => void) {
  // cancelled by Esc: the rest of this drag (until the pointer is released) does nothing — no new gesture starts
  const cancelled = useRef(false)
  const onCancel = () => ((cancelled.current = true), reset())
  return {
    start: () => {
      cancelled.current = false
      if (!ui.view.panelOperation()) ui.view.beginPanelGesture(onCancel)
    },
    move: (cmd: Command) => {
      if (cancelled.current) return reset()
      const op = ui.view.panelOperation() ?? ui.view.beginPanelGesture(onCancel)
      ui.view.previewCommand(op, cmd)
    },
    end: () => {
      if (cancelled.current) return void ((cancelled.current = false), reset())
      ui.view.endPanelGesture()
    },
    active: () => !!ui.view.panelOperation() || cancelled.current,
  }
}

/**
 * A number with a typed field and a slider centred on the current value. The slider's range is fixed when a drag starts
 * (centre ± `span`) and re-centred after it; the whole drag is one gesture (useSliderGesture).
 */
function NumberSlider(props: { ui: Ui; id: string; label: string; value: number; span: number; min?: number; max?: number; digits?: number; unit?: string; make: (v: number) => Affine; scale?: (v: number) => number; unscale?: (v: number) => number }) {
  const { ui, id, value, span } = props
  const toSlider = props.scale ?? ((v: number) => v)
  const fromSlider = props.unscale ?? ((v: number) => v)
  const [text, setText] = useState(fmt(value, props.digits))
  const [range, setRange] = useState({ lo: toSlider(value) - span, hi: toSlider(value) + span })
  const [sv, setSv] = useState(toSlider(value))
  const reverting = useRef(false) // Esc: put the value back — the blur that follows must not commit
  const latest = useRef(value)
  latest.current = value
  const g = useSliderGesture(ui, () => setSv(toSlider(latest.current)))
  useEffect(() => {
    setText(fmt(value, props.digits))
    if (!g.active()) {
      setRange({ lo: toSlider(value) - span, hi: toSlider(value) + span })
      setSv(toSlider(value))
    }
  }, [value, span])
  const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v))
  const commitTyped = () => {
    if (reverting.current) return void ((reverting.current = false), setText(fmt(value, props.digits)))
    const v = Number(text)
    if (!Number.isFinite(v) || fmt(v, props.digits) === fmt(value, props.digits)) return setText(fmt(value, props.digits))
    ui.apply({ type: 'setProps', id, transform: props.make(clamp(v)) })
  }
  return (
    <tr data-placement={props.label}>
      <th>{props.label}</th>
      <td className="inline">
        <input
          data-prop={`image-${props.label}`}
          type="number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
            if (e.key === 'Escape') (e.stopPropagation(), (reverting.current = true), setText(fmt(value, props.digits)), (e.currentTarget as HTMLInputElement).blur())
          }}
          onBlur={commitTyped}
        />
        {props.unit ? <span>{props.unit}</span> : null}
        <input
          data-slider={props.label}
          type="range"
          min={range.lo}
          max={range.hi}
          step={(range.hi - range.lo) / 1000}
          value={sv}
          onPointerDown={() => g.start()}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setSv(v)
            g.move({ type: 'setProps', id, transform: props.make(clamp(fromSlider(v))) })
          }}
          onPointerUp={g.end}
          onKeyUp={(e) => e.key.startsWith('Arrow') && g.end()}
          onBlur={() => g.active() && g.end()}
        />
      </td>
    </tr>
  )
}

/** opacity: a slider whose drag is one gesture too (review of 4a208bc D4: every movement was an undo step) */
function OpacitySlider({ ui, image }: { ui: Ui; image: ImageRecord }) {
  const pct = Math.round(image.opacity * 100)
  const [v, setV] = useState(pct)
  const latest = useRef(pct)
  latest.current = pct
  const g = useSliderGesture(ui, () => setV(latest.current))
  useEffect(() => {
    if (!g.active()) setV(pct)
  }, [pct])
  return (
    <tr>
      <th>不透明度</th>
      <td className="inline">
        <input
          data-prop="image-opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={v}
          onPointerDown={() => g.start()}
          onInput={(e) => {
            const n = Number((e.target as HTMLInputElement).value)
            setV(n)
            g.move({ type: 'setProps', id: image.id, opacity: n / 100 })
          }}
          onPointerUp={g.end}
          onKeyUp={(e) => e.key.startsWith('Arrow') && g.end()}
          onBlur={() => g.active() && g.end()}
        />
        <span>{v}%</span>
      </td>
    </tr>
  )
}

export function ImagePanel({ ui, image }: { ui: Ui; image: ImageRecord }) {
  const p = placementOf(image)
  const zoom = useValue(ui.zoom)
  const view = { w: ui.view.canvas.getWidth() / zoom, h: ui.view.canvas.getHeight() / zoom }
  const [count, setCount] = useState(9)
  const shown = Math.max(count, ...image.slots.map((s) => s.n + 1))
  const [renaming, setRenaming] = useState<number | null>(null)
  return (
    <>
      <OpacitySlider ui={ui} image={image} />
      <tr><th>原图</th><td>{image.width} × {image.height} px</td></tr>
      <NumberSlider ui={ui} id={image.id} label="X" value={p.x} span={view.w} make={(v) => withCentre(image, v, p.y)} />
      <NumberSlider ui={ui} id={image.id} label="Y" value={p.y} span={view.h} make={(v) => withCentre(image, p.x, v)} />
      {/* size: % of its own pixels, 1%–10000%; the slider moves on a log scale (×/÷ 4 around the current size) */}
      <NumberSlider ui={ui} id={image.id} label="大小" unit="%" value={p.size * 100} span={Math.log(4)} min={1} max={10000} digits={1} make={(v) => withSize(image, v / 100)} scale={(v) => Math.log(v)} unscale={(v) => Math.exp(v)} />
      <NumberSlider ui={ui} id={image.id} label="角度" unit="°" value={p.angle} span={180} digits={1} make={(v) => withAngle(image, v)} />
      <tr>
        <th>位置 slot</th>
        <td>
          <div className="slots" data-slots>
            {Array.from({ length: shown }, (_, n) => {
              const s = image.slots.find((x) => x.n === n)
              const here = !!s && same(s.transform, image.transform)
              const sp = s ? placementOf({ ...image, transform: s.transform }) : null
              return (
                <div key={n} className={`slot ${s ? 'filled' : 'empty'} ${here ? 'here' : ''}`} data-slot={n} data-filled={!!s} data-here={here}>
                  <span className="slot-n">{n + 1}</span>
                  {renaming === n && s ? (
                    <input
                      className="rename"
                      autoFocus
                      defaultValue={s.name}
                      onBlur={(e) => (setRenaming(null), e.target.value.trim() && e.target.value !== s.name && ui.apply({ type: 'renameImageSlot', id: image.id, n, name: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                    />
                  ) : (
                    <span className="slot-name" title={s ? '双击改名' : ''} onDoubleClick={() => s && setRenaming(n)}>
                      {s ? s.name : '空'}
                    </span>
                  )}
                  <span className="slot-values muted small">{sp ? `X ${fmt(sp.x, 1)} · Y ${fmt(sp.y, 1)} · ${fmt(sp.size * 100, 1)}% · ${fmt(sp.angle, 1)}°` : '—'}</span>
                  <button
                    data-slot-save
                    title={s ? `把当前位置和大小存进 ${n + 1} 号（覆盖原来的）` : `把当前位置和大小存进 ${n + 1} 号`}
                    onClick={() => {
                      const before = ui.editor.revision
                      ui.apply({ type: 'saveImageSlot', id: image.id, n })
                      if (ui.editor.revision !== before) ui.view.showStatus(`已存到 ${n + 1} 号${s ? '（覆盖了原来的位置）' : ''}`)
                    }}
                  >
                    存
                  </button>
                  <button data-slot-recall disabled={!s} title={s ? `调出 ${n + 1} 号存的位置和大小` : '这一格还没有存位置'} onClick={() => s && ui.apply({ type: 'recallImageSlot', id: image.id, n })}>
                    调出
                  </button>
                  <button data-slot-clear disabled={!s} title="清空这一格" onClick={() => s && ui.apply({ type: 'clearImageSlot', id: image.id, n })}>
                    ×
                  </button>
                </div>
              )
            })}
            <button data-slot-more onClick={() => setCount(shown + 1)}>＋ 加一格</button>
          </div>
        </td>
      </tr>
    </>
  )
}
