// Playback's arrows turn the view as the coord grid's point does (bowen 1791768754; docs/keyboard-pose-pan-plan.md;
// dot 1791769087, 1791769205, 1791769354): a `move/` key run with the pose's sizes, each step on the pose as it is
// now, the pose's decimals kept, ending keeps the last pose, presses end the run and act, the page never scrolls.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'
import { resetPage, type Store } from '../../autosave'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
let n = 0
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }); delete (window as { benchStore?: Store }).benchStore; resetPage() })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number } }
const bench = () => (window as unknown as { bench: B }).bench
function pe(type: string, x: number, y: number, buttons: number, opts: { id?: number; button?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: opts.button ?? 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: opts.id ?? 1 })
  return e
}

async function setup() {
  const k = ++n, writes: string[] = [], data: Record<string, string> = {}
  ;(window as { benchStore?: Store }).benchStore = { async get(key) { return data[key] }, async put(key, v) { writes.push(key); data[key] = v } }
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    await wait(10)
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: 300 * k } }))
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  const input = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
  const type = async (id: string, v: string) => { const el = input(id); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
  const play = async (yaw: number, pitch: number) => { await act(async () => { button('Playback').click() }); await type('yaw-text', String(yaw)); await type('pitch-text', String(pitch)) }
  const pad = () => { const p = host.querySelector('[data-testid="pose-pad"]') as SVGSVGElement; p.getBoundingClientRect = () => ({ left: 1000, top: 0, width: 200, height: 100, right: 1200, bottom: 100, x: 1000, y: 0, toJSON() {} }) as DOMRect; return p }
  const padAt = (yaw: number, pitch: number) => ({ x: 1000 + (yaw + 90) / 180 * 200, y: (45 - pitch) / 90 * 100 })
  /** A key on the page (not a field); the event is returned so its default can be read. */
  const key = async (k: string, more: KeyboardEventInit = {}, target: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more })
    await act(async () => { target.dispatchEvent(e) })
    return e
  }
  const up = async (k: string) => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })) }) }
  const shown = () => [bench().pose(), t2(input('yaw').value), t2(input('pitch').value), input('yaw-text').value, input('pitch-text').value]
  const t2 = (v: string) => Number(v)
  const untouched = () => ({ text: save(bench().core), undo: bench().core.canUndo, writes: writes.length })
  return { host, svg, k, input, type, play, pad, padAt, key, up, shown, untouched }
}

describe('playback: the arrows turn the view', () => {
  it('→ ← ↑ ↓ move yaw / pitch as the grid\'s point: 1°, Shift 10°, Option 0.1°, Ctrl 0.1°; the pad, sliders and fields follow; nothing written', async () => {
    const t = await setup()
    await t.play(0, 0)
    const before = t.untouched()
    await t.key('ArrowRight'); await t.up('ArrowRight')
    await t.key('ArrowUp', { shiftKey: true }); await t.up('ArrowUp')
    await t.key('ArrowLeft', { altKey: true }); await t.up('ArrowLeft')
    await t.key('ArrowDown', { ctrlKey: true }); await t.up('ArrowDown')
    expect(t.shown()).toEqual([{ yaw: 0.9, pitch: 9.9 }, 0.9, 9.9, '0.9', '9.9'])
    await t.key('ArrowRight', { shiftKey: true, altKey: true }); await t.up('ArrowRight') // both: the single step
    expect(bench().pose()).toEqual({ yaw: 1.9, pitch: 9.9 })
    const h = t.host.querySelector('[data-handle]')!
    expect([Number(h.getAttribute('cx')), Number(h.getAttribute('cy'))].map(v => +v.toFixed(3))).toEqual([+(100 + 1.9 / 90 * 100).toFixed(3), +(50 - 9.9 / 45 * 50).toFixed(3)])
    expect(t.untouched()).toEqual(before)
  })

  it('a held key repeats; alternating → and ↑ each start from the newest pose', async () => {
    const t = await setup()
    await t.play(10, 10)
    await t.key('ArrowRight'); await t.key('ArrowRight', { repeat: true }); await t.key('ArrowUp'); await t.key('ArrowRight', { repeat: true }); await t.key('ArrowUp', { repeat: true })
    expect(bench().pose()).toEqual({ yaw: 13, pitch: 12 })
    await t.up('ArrowRight'); await t.up('ArrowUp')
    expect(bench().pose()).toEqual({ yaw: 13, pitch: 12 })
  })

  it('at a limit the opposite key moves at once: 89, Shift → 90, ← 89 (no dead travel); clamped at ±90 / ±45', async () => {
    const t = await setup()
    await t.play(89, 44)
    await t.key('ArrowRight', { shiftKey: true }); await t.key('ArrowRight', { shiftKey: true, repeat: true })
    expect(bench().pose()).toEqual({ yaw: 90, pitch: 44 })
    await t.key('ArrowLeft')
    expect(bench().pose()).toEqual({ yaw: 89, pitch: 44 })
    await t.up('ArrowRight'); await t.up('ArrowLeft')
    await t.key('ArrowUp', { shiftKey: true }); await t.up('ArrowUp')
    await t.key('ArrowDown'); await t.up('ArrowDown')
    expect(bench().pose()).toEqual({ yaw: 89, pitch: 44 })
  })

  it('the pose keeps its own decimals: 0.25 with Option → is 0.35 and ← 0.25; the other axis untouched; a run back and forth ends exactly at its start', async () => {
    const t = await setup()
    await t.play(0.25, 12.345)
    await t.key('ArrowRight', { altKey: true }); await t.up('ArrowRight')
    expect(t.shown()).toEqual([{ yaw: 0.35, pitch: 12.345 }, 0.35, 12.345, '0.35', '12.345'])
    await t.key('ArrowLeft', { altKey: true }); await t.up('ArrowLeft')
    expect(bench().pose()).toEqual({ yaw: 0.25, pitch: 12.345 })
    for (let i = 0; i < 3; i++) await t.key('ArrowRight', { altKey: true, repeat: i > 0 })
    for (let i = 0; i < 3; i++) await t.key('ArrowLeft', { altKey: true, repeat: i > 0 })
    await t.up('ArrowRight'); await t.up('ArrowLeft')
    expect(bench().pose()).toEqual({ yaw: 0.25, pitch: 12.345 })
  })

  it('ending keeps the last pose: Esc, blur, a slider, leaving playback — none puts back the pose from before the keys', async () => {
    const t = await setup()
    await t.play(0, 0)
    await t.key('ArrowRight', { shiftKey: true })
    await t.key('Escape')
    expect(bench().pose()).toEqual({ yaw: 10, pitch: 0 })
    await t.key('ArrowRight', { repeat: true }) // the ended run's repeat does nothing
    expect(bench().pose()).toEqual({ yaw: 10, pitch: 0 })
    await t.up('ArrowRight')
    await t.key('ArrowUp'); await act(async () => { window.dispatchEvent(new Event('blur')) })
    expect(bench().pose()).toEqual({ yaw: 10, pitch: 1 })
    await t.up('ArrowUp')
    await t.key('ArrowUp')
    await act(async () => { const s = t.input('yaw'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(s, '30'); s.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(bench().pose()).toEqual({ yaw: 30, pitch: 2 })
    await t.key('ArrowUp', { repeat: true }) // the slider ended the run
    expect(bench().pose()).toEqual({ yaw: 30, pitch: 2 })
  })

  it('a repeat counts only for a key really pressed in this run: hold →, blur, press ↑ — →\'s repeats do nothing', async () => {
    const t = await setup()
    await t.play(0, 0)
    await t.key('ArrowRight')
    await act(async () => { window.dispatchEvent(new Event('blur')) })
    await t.key('ArrowUp')
    await t.key('ArrowRight', { repeat: true })
    await t.key('ArrowUp', { repeat: true })
    expect(bench().pose()).toEqual({ yaw: 1, pitch: 2 })
  })

  it('a pad press during a run ends the run (the pose stays) and acts: the pose jumps to the pad', async () => {
    const t = await setup()
    await t.play(0, 0)
    await t.key('ArrowRight')
    const a = t.padAt(-45, 30)
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', a.x, a.y, 1)); window.dispatchEvent(pe('pointerup', a.x, a.y, 0)) })
    expect(bench().pose()).toEqual({ yaw: -45, pitch: 30 })
    await t.key('ArrowRight', { repeat: true }) // the run ended
    expect(bench().pose()).toEqual({ yaw: -45, pitch: 30 })
  })

  it('during a pad drag, a right / middle pan and a Zoom drag an arrow changes nothing and cancels nothing, and its repeats start nothing after; the default is still prevented', async () => {
    const t = await setup()
    await t.play(0, 0)
    // a pad drag
    const a = t.padAt(0, 0), b = t.padAt(20, 0)
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', a.x, a.y, 1)) })
    let e = await t.key('ArrowUp')
    expect([bench().pose(), e.defaultPrevented]).toEqual([{ yaw: 0, pitch: 0 }, true])
    await act(async () => { window.dispatchEvent(pe('pointermove', b.x, b.y, 1)); window.dispatchEvent(pe('pointerup', b.x, b.y, 0)) })
    expect(bench().pose()).toEqual({ yaw: 20, pitch: 0 }) // the drag was not cancelled
    await t.key('ArrowUp', { repeat: true }) // pressed during the drag: no run after it
    expect(bench().pose()).toEqual({ yaw: 20, pitch: 0 })
    await t.up('ArrowUp')
    // a right pan and a middle pan
    for (const [button, buttons] of [[2, 2], [1, 4]] as const) {
      const vb = t.svg.getAttribute('viewBox')
      await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 100, 100, buttons, { button })); window.dispatchEvent(pe('pointermove', 160, 130, buttons)) })
      e = await t.key('ArrowRight')
      expect([bench().pose(), e.defaultPrevented]).toEqual([{ yaw: 20, pitch: 0 }, true])
      await act(async () => { window.dispatchEvent(pe('pointerup', 160, 130, 0, { button })) })
      expect(t.svg.getAttribute('viewBox')).not.toBe(vb) // the pan went through
      await t.key('ArrowRight', { repeat: true }); await t.up('ArrowRight')
      expect(bench().pose()).toEqual({ yaw: 20, pitch: 0 })
    }
    // a Zoom drag
    await t.key('z')
    const vb = t.svg.getAttribute('viewBox')
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 100, 100, 1)); window.dispatchEvent(pe('pointermove', 100, 40, 1)) })
    e = await t.key('ArrowDown')
    expect([bench().pose(), e.defaultPrevented]).toEqual([{ yaw: 20, pitch: 0 }, true])
    await act(async () => { window.dispatchEvent(pe('pointerup', 100, 40, 0)) })
    expect(t.svg.getAttribute('viewBox')).not.toBe(vb)
    await t.key('ArrowDown', { repeat: true }); await t.up('ArrowDown')
    expect(bench().pose()).toEqual({ yaw: 20, pitch: 0 })
  })

  it('the page never scrolls: at a limit the default is prevented; ⌘ + arrow keeps its own and moves nothing; an arrow on the focused yaw slider is the slider\'s', async () => {
    const t = await setup()
    await t.play(90, 0)
    const e = await t.key('ArrowRight')
    expect([bench().pose(), e.defaultPrevented]).toEqual([{ yaw: 90, pitch: 0 }, true])
    await t.up('ArrowRight')
    const m = await t.key('ArrowLeft', { metaKey: true })
    expect([bench().pose(), m.defaultPrevented]).toEqual([{ yaw: 90, pitch: 0 }, false])
    const s = await t.key('ArrowLeft', {}, t.input('yaw'))
    expect([bench().pose(), s.defaultPrevented]).toEqual([{ yaw: 90, pitch: 0 }, false])
  })

  it('the pose keeps plain JS precision: 0.1234567890123 and 1e-11 with Option → then ← come back as they were (dot 1791770081, 1791770133)', async () => {
    const t = await setup()
    await t.play(0.1234567890123, 0)
    await t.key('ArrowRight', { altKey: true }); await t.up('ArrowRight')
    await t.key('ArrowLeft', { altKey: true }); await t.up('ArrowLeft')
    expect(bench().pose()).toEqual({ yaw: 0.1234567890123, pitch: 0 })
    await t.type('yaw-text', '1e-11') // dot 1791770133: a tiny value is not cut to 0
    await t.key('ArrowRight', { altKey: true }); await t.up('ArrowRight')
    await t.key('ArrowLeft', { altKey: true }); await t.up('ArrowLeft')
    expect(bench().pose()).toEqual({ yaw: 1e-11, pitch: 0 })
  })

  it('every ⌘ combination keeps its own: ⌘ + Ctrl + arrow turns nothing (dot 1791770081)', async () => {
    const t = await setup()
    await t.play(0, 0)
    const e = await t.key('ArrowRight', { metaKey: true, ctrlKey: true })
    expect([bench().pose(), e.defaultPrevented]).toEqual([{ yaw: 0, pitch: 0 }, false])
  })

  it('an input method taking the keys ends the run: the held key\'s repeats after it do nothing (dot 1791770081)', async () => {
    for (const how of ['compositionstart', 'isComposing'] as const) {
      const t = await setup()
      await t.play(0, 0)
      await t.key('ArrowRight')
      if (how === 'compositionstart') await act(async () => { document.body.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
      else await t.key('a', { isComposing: true })
      await t.key('ArrowRight', { repeat: true })
      expect([how, bench().pose()]).toEqual([how, { yaw: 1, pitch: 0 }])
      await t.up('ArrowRight')
      await t.key('ArrowRight'); await t.up('ArrowRight') // a new real press turns again
      expect(bench().pose()).toEqual({ yaw: 2, pitch: 0 })
    }
  })
})

