// slider — the one slider of the program (bowen 1791769016, 1791769065, 1791769146, 1791769257;
// docs/slider-plan.md; dot 1791769272, 1791769298, 1791769582, 1791770098): a typed number, a slide and keys,
// the slide and the keys `move/` sessions. It knows nothing of the drawing: the caller says what a value does.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createMover, isArrow, type Steps, type Target, type Vec } from '../move'

export type Input = 'drag' | 'keys' | 'typing'
export interface SliderProps {
  /** The value as it is; what it belongs to; anything the caller changes when it is changed from outside. */
  value: number
  identity: string
  version?: unknown
  /** The caller's own check of a value (dot 1791769582 §3). */
  accept(v: number): boolean
  /** The slide's range (in log10 for `scale: 'log'`), or null: the field alone (bowen 1791769257). */
  track: readonly [number, number] | null
  scale?: 'linear' | 'log'
  /** Single / Shift / Option or Ctrl — in the track's units (log10 for a log slider). */
  steps: Steps
  label?: string
  width?: number
  /** Attributes for the field and the thumb (test ids). */
  fieldAttrs?: Record<string, string>
  thumbAttrs?: Record<string, string>
  /** A slide or a thumb key run asks for the app's one gesture slot; the app may refuse. */
  onStart(d: { input: 'drag' | 'keys'; pointerId?: number; cancel(): void }): boolean
  onEnd(cancel: () => void): void
  /** Typing: the field is open (`end` finishes it as leaving it would), or closed. */
  onField(d: { end(): void } | null): void
  onPreview(v: number, input: Input): void
  onCommit(v: number, input: Input): void
  onCancel(input: Input): void
}

/** The decimal places of a number (up to 20), or Infinity when it has no short decimal form. */
export const places = (n: number) => { for (let d = 0; d <= 20; d++) if (Number(n.toFixed(d)) === n) return d; return Infinity }
/** a + b without a float tail and without losing either's decimals; plain JS precision beyond 20 places. */
export const addExact = (a: number, b: number) => { const p = Math.max(places(a), places(b)); return p <= 20 ? Number((a + b).toFixed(p)) : a + b }
const parse = (t: string) => (t.trim() === '' ? NaN : Number(t))

export function Slider(props: SliderProps) {
  const p = useRef(props); p.current = props
  const mover = useRef(createMover()).current
  const [shown, setShown] = useState<number | null>(null) // the running session's value
  const [text, setText] = useState<string | null>(null) // the field's text while it is open
  // what `value` may come back as without being an outside change (dot 1791771918): the session's start, its last
  // preview, and this slider's own last write (its echo is acknowledged once, then forgotten)
  const last = useRef<number | null>(null)
  const sessionStart = useRef<number | null>(null)
  const committed = useRef<number | null>(null)
  const field = useRef<null | { start: number; typed: number | null; end(): void }>(null)
  const drag = useRef<null | { off(): void }>(null)
  const bar = useRef<HTMLDivElement | null>(null)
  const keyEnding = useRef(false) // a thumb run's last key up is under way
  const scale = props.scale ?? 'linear'

  const toTrack = (v: number) => (p.current.scale === 'log' ? Math.log10(v) : v)
  const fromTrack = (t: number) => (p.current.scale === 'log' ? 10 ** t : t)
  const ok = (v: number) => Number.isFinite(v) && p.current.accept(v)
  const show = (v: number, input: Input) => { last.current = v; setShown(v); p.current.onPreview(v, input) }
  const reset = () => { last.current = null; sessionStart.current = null; setShown(null); setText(null) }
  const writeValue = (v: number, input: Input) => { committed.current = v; p.current.onCommit(v, input) }

  /** A run of steps (keys): the offset applied is kept, a step `accept` refuses is not taken — no dead travel. */
  const stepper = (start: number, input: Input) => {
    let applied = 0, seen: Vec = { x: 0, y: 0 }, value = start
    return {
      get value() { return value },
      step(o: Vec) {
        // → and ↑ add, ← and ↓ subtract (↑ is −y in move/)
        const delta = addExact(addExact(o.x, -seen.x), -addExact(o.y, -seen.y))
        seen = o
        if (delta === 0) return
        const next = addExact(applied, delta), v = p.current.scale === 'log' ? start * 10 ** next : addExact(start, next)
        if (!ok(v)) return
        applied = next; value = v; show(v, input)
      },
    }
  }

  // ---- typing: the open field (not a gesture; ended by the app before any other input begins) ----
  const closeField = (write: boolean) => {
    const f = field.current
    if (!f) return
    field.current = null
    if (mover.running === 'keys') mover.cancel() // a field key run only previews
    const v = f.typed
    reset()
    p.current.onField(null)
    if (write && v !== null && v !== f.start) writeValue(v, 'typing')
    else p.current.onCancel('typing')
  }
  const openField = () => {
    if (field.current) return field.current
    const f = { start: p.current.value, typed: null as number | null, end: () => closeField(true) }
    field.current = f
    sessionStart.current = f.start
    p.current.onField({ end: f.end })
    return f
  }
  const type = (t: string) => {
    if (mover.running && !field.current) return // a slide or a thumb run is running: one input at a time (dot 1791771994)
    const f = openField()
    setText(t)
    const v = parse(t)
    if (ok(v)) { f.typed = v; show(v, 'typing') } else f.typed = null // invalid at the end: cancelled (dot 1791769298)
  }
  const fieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return // an input method's keys are its own (dot 1791771773)
    if (e.key === 'Enter') { closeField(true); return }
    if (e.key === 'Escape') { if (field.current) { e.stopPropagation(); closeField(false) } return }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return // ← / → move the caret
    e.preventDefault()
    if (mover.running && !field.current) return // the thumb's session runs: the field waits
    const f = openField()
    const base = f.typed ?? (shown ?? p.current.value)
    let s: ReturnType<typeof stepper> | null = null
    // a key run inside the field: it previews only; the field's own ending is the one write
    mover.keyDown(() => ({
      begin: () => { s = stepper(base, 'typing'); return true },
      preview: o => { s!.step(o); const ff = field.current; if (ff) { ff.typed = s!.value; setText(String(s!.value)) } },
      commit: () => {},
      cancel: () => {},
    }), { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, p.current.steps)
  }

  // ---- a session holding the app's slot: a thumb key run or a slide ----
  const cancelSession = () => mover.cancel()
  const held = (input: 'drag' | 'keys', from: { start: number }, getValue: () => number, onCancelled?: () => boolean): Target & { pointerId?: number } => {
    const done = (write: boolean) => {
      const v = getValue(), start = from.start
      drag.current?.off(); drag.current = null
      reset()
      p.current.onEnd(cancelSession)
      if (write && v !== start) writeValue(v, input)
      else p.current.onCancel(input)
    }
    return {
      begin: () => { const ok = p.current.onStart({ input, cancel: cancelSession }); if (ok) sessionStart.current = from.start; return ok },
      preview: () => {},
      commit: () => done(true),
      cancel: () => done(!!onCancelled?.()),
    }
  }

  const thumbKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') { if (mover.running) { e.stopPropagation(); e.preventDefault(); mover.cancel() } return }
    if (!isArrow(e.key)) return
    // the thumb keeps its keys from the app's handlers (dot 1791769582 §4)
    e.preventDefault(); e.stopPropagation()
    let s: ReturnType<typeof stepper> | null = null
    mover.keyDown(() => {
      const start = p.current.value
      s = stepper(start, 'keys')
      const t = held('keys', { start }, () => s!.value, () => keyEnding.current)
      return { ...t, preview: o => s!.step(o) }
    }, { key: e.key, repeat: e.repeat, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, p.current.steps)
  }
  // the last key up ends the run as its own ending: move/ calls a net-zero raw offset a cancel, but refused steps are
  // not taken, so the applied move may differ (opacity 1: ↑ refused, ↓ 0.99) — it is written (dot 1791771773)
  const thumbKeyUp = (e: React.KeyboardEvent) => { if (isArrow(e.key)) { e.stopPropagation(); keyEnding.current = true; try { mover.keyUp(e.key) } finally { keyEnding.current = false } } }

  /** The track value at a pointer's x, snapped to the single step, within the track. */
  const atX = (x: number) => {
    const tr = p.current.track!, r = bar.current!.getBoundingClientRect(), f = Math.min(1, Math.max(0, (x - r.left) / (r.width || 1)))
    const st = p.current.steps.step, t = tr[0] + f * (tr[1] - tr[0])
    const snapped = Math.min(tr[1], Math.max(tr[0], addExact(0, Math.round(t / st) * st)))
    return fromTrack(Number(snapped.toFixed(Math.min(20, places(st)))))
  }
  const press = (e: React.PointerEvent) => {
    if (e.button !== 0 || mover.running || drag.current) return // a second pointer is ignored and never ends the first
    const tr = p.current.track!, r = bar.current!.getBoundingClientRect()
    const onThumb = (e.target as HTMLElement).hasAttribute('data-thumb')
    const from = { start: p.current.value }
    // on the thumb the grab offset is kept; on the bar the thumb jumps there first — a change of its own
    const thumbX = r.left + ((toTrack(shown ?? from.start) - tr[0]) / (tr[1] - tr[0])) * r.width
    const grab = onThumb ? e.clientX - thumbX : 0
    let value = from.start, releasing = false
    const jumped = !onThumb
    const at = (o: Vec) => { const v = atX(e.clientX - grab + o.x); if (ok(v)) value = v; return value }
    const base = held('drag', from, () => value, () => releasing && jumped && value !== from.start)
    const target: Target = { ...base, preview: o => show(at(o), 'drag'), commit: o => { at(o); base.commit(o) } }
    const id = e.pointerId
    // the app may end this slider's own open field first (its value written): the slide starts from that value
    const begin = () => { const ok = p.current.onStart({ input: 'drag', pointerId: id, cancel: cancelSession }); if (ok) { if (committed.current !== null) from.start = committed.current; sessionStart.current = from.start } return ok }
    if (!mover.press({ ...target, begin }, { x: e.clientX, y: 0 })) return
    if (jumped) show(at({ x: 0, y: 0 }), 'drag')
    const move = (ev: PointerEvent) => { if (ev.pointerId !== id) return; if ((ev.buttons & 1) === 0) { up(ev); return } mover.drag({ x: ev.clientX, y: 0 }) }
    // the release decides: the value at the release point, also when it is back where the press was (dot 1791771918)
    const up = (ev: PointerEvent) => { if (ev.pointerId !== id) return; at({ x: ev.clientX - e.clientX, y: 0 }); releasing = true; mover.release({ x: ev.clientX, y: 0 }); releasing = false }
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) mover.cancel() }
    const blur = () => mover.cancel()
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', blur)
    drag.current = { off: () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur) } }
  }

  // ---- what ends a session from outside (dot 1791769272 §2, 1791769582 §1) ----
  const cancelAll = () => { if (field.current) closeField(false); if (mover.running) mover.cancel() }
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } cancelAll() }, [props.identity, props.version]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (props.value === committed.current) { committed.current = null; return } // this slider's own write coming back
    // before any preview the session's start is the expected value; after one, only that preview is (dot 1791772141)
    const expected = last.current !== null ? last.current : sessionStart.current
    if ((field.current || mover.running) && props.value !== expected) cancelAll()
  }, [props.value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (field.current) closeField(false); if (mover.running) mover.cancel(); drag.current?.off() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const value = shown ?? props.value
  const fieldText = text ?? String(value)
  const invalid = text !== null && !ok(parse(text))
  const tr = props.track
  const f = tr ? Math.min(1, Math.max(0, ((scale === 'log' ? Math.log10(value) : value) - tr[0]) / (tr[1] - tr[0]))) : 0
  const w = props.width ?? 70
  const thumbStyle: CSSProperties = { position: 'absolute', left: `calc(${f * 100}% - 5px)`, top: -4, width: 10, height: 12, borderRadius: 3, background: '#fff', border: '1px solid #666', boxSizing: 'border-box', outlineOffset: 1 }
  return <span data-slider-root="" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    {props.label}
    <input {...props.fieldAttrs} value={fieldText} style={{ width: 54, borderColor: invalid ? '#c00' : undefined }}
      onChange={e => type(e.target.value)} onKeyDown={fieldKey} onKeyUp={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') mover.keyUp(e.key) }} onBlur={() => closeField(true)} />
    {tr && <div ref={bar} onPointerDown={press} style={{ position: 'relative', width: w, height: 4, background: '#ccc', borderRadius: 2, margin: '6px 5px', touchAction: 'none', cursor: 'pointer' }}>
      <div {...props.thumbAttrs} data-thumb="" role="slider" tabIndex={0} aria-valuenow={value} aria-valuemin={scale === 'log' ? 10 ** tr[0] : tr[0]} aria-valuemax={scale === 'log' ? 10 ** tr[1] : tr[1]}
        style={thumbStyle} onKeyDown={thumbKey} onKeyUp={thumbKeyUp} onBlur={() => { if (mover.running === 'keys') mover.cancel() }} />
    </div>}
  </span>
}
