// pose-pad — yaw and pitch on one grid (bowen 1791727397; docs/pose-pad-plan.md): press anywhere to jump
// there, drag to follow. It knows nothing of the drawing: it shows a pose and reports new ones. Its drag
// is handed to the app at the press (`onStart` with its one cancel), so the app keeps one gesture at a
// time; the drag ends on its pointer's release, a move without the button, pointercancel, leaving the
// window, a right click, a new press of the same pointer, the app's cancel, or unmount. React only.
import { useEffect, useRef } from 'react'

export interface Pose { readonly yaw: number; readonly pitch: number }
export interface PosePadProps {
  readonly yaw: number
  readonly pitch: number
  /** The largest |yaw| and |pitch|: the grid spans −yaw … +yaw left to right, +pitch … −pitch top to bottom. */
  readonly limits: Pose
  /** A press takes the app's gesture slot: `cancel` ends this drag (listeners removed), from the app's side. */
  onStart(drag: { readonly pointerId: number; readonly cancel: () => void }): void
  /** A pose from the press or the drag, whole degrees, within the limits; called on the press even if unchanged. */
  onChange(pose: Pose): void
  /** The drag ended, by any path (its `cancel` named, so the app clears its slot only if it is still this drag). */
  onEnd(cancel: () => void): void
}

const W = 200, H = 100
const whole = (v: number) => Math.round(v) || 0 // never −0

export function PosePad({ yaw, pitch, limits, onStart, onChange, onEnd }: PosePadProps) {
  const box = useRef<SVGSVGElement>(null)
  const running = useRef<null | { id: number; stop: () => void }>(null)
  const props = useRef({ limits, onChange, onEnd })
  props.current = { limits, onChange, onEnd }
  useEffect(() => () => running.current?.stop(), []) // unmounting ends a drag

  const poseAt = (x: number, y: number): Pose => {
    const r = box.current!.getBoundingClientRect(), L = props.current.limits
    const u = Math.min(1, Math.max(0, (x - r.left) / (r.width || 1))), v = Math.min(1, Math.max(0, (y - r.top) / (r.height || 1)))
    return { yaw: whole(-L.yaw + u * 2 * L.yaw), pitch: whole(L.pitch - v * 2 * L.pitch) }
  }

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (running.current) {
      if (running.current.id !== e.pointerId) return // another pointer while a drag runs: ignored
      running.current.stop()
    }
    const id = e.pointerId
    let done = false
    const move = (ev: PointerEvent) => { if (ev.pointerId !== id) return; if ((ev.buttons & 1) === 0) { stop(); return } props.current.onChange(poseAt(ev.clientX, ev.clientY)) }
    const up = (ev: PointerEvent) => { if (ev.pointerId === id) stop() }
    const otherDown = (ev: PointerEvent) => { if (ev.pointerId === id) stop() }
    const listeners: [string, EventListener][] = [['pointermove', move as EventListener], ['pointerup', up as EventListener], ['pointercancel', up as EventListener], ['blur', () => stop()], ['contextmenu', () => stop()]]
    function stop() {
      if (done) return
      done = true
      for (const [t, f] of listeners) window.removeEventListener(t, f)
      window.removeEventListener('pointerdown', otherDown as EventListener, true)
      if (running.current?.stop === stop) running.current = null
      props.current.onEnd(stop)
    }
    running.current = { id, stop }
    onStart({ pointerId: id, cancel: stop })
    for (const [t, f] of listeners) window.addEventListener(t, f)
    // capture: a later press of the same pointer anywhere ends the drag (this press has already passed the window)
    window.addEventListener('pointerdown', otherDown as EventListener, true)
    onChange(poseAt(e.clientX, e.clientY))
  }

  const L = limits, sx = (v: number) => ((v + L.yaw) / (2 * L.yaw)) * W, sy = (v: number) => ((L.pitch - v) / (2 * L.pitch)) * H
  const yaws = [-L.yaw, -L.yaw / 2, 0, L.yaw / 2, L.yaw], pitches = [L.pitch, 0, -L.pitch]
  return <svg ref={box} data-testid="pose-pad" width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerDown={down}
    style={{ background: '#f4f4f4', border: '1px solid #bbb', touchAction: 'none', cursor: 'crosshair', flex: 'none' }}>
    {yaws.map(v => <line key={`y${v}`} x1={sx(v)} x2={sx(v)} y1={0} y2={H} stroke={v === 0 ? '#999' : '#ddd'} />)}
    {pitches.map(v => <line key={`p${v}`} x1={0} x2={W} y1={sy(v)} y2={sy(v)} stroke={v === 0 ? '#999' : '#ddd'} />)}
    {[-L.yaw, 0, L.yaw].flatMap(a => pitches.map(b => <circle key={`${a},${b}`} data-view={`${a},${b}`} cx={sx(a)} cy={sy(b)} r={3} fill="#888" />))}
    <circle data-handle="" cx={sx(yaw)} cy={sy(pitch)} r={5} fill="#2a7fff" stroke="#fff" strokeWidth={1.5} />
  </svg>
}
