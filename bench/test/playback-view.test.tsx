// Playback's pose pad and the viewport tools (docs/pose-pad-plan.md; bowen 1791727397, 1791727452; dot
// 1791727663, 1791727680). Real App, real Core, jsdom events. A pose that takes effect is one update for
// the pad, the sliders and the fields; the pad's drag shares the one gesture slot; Zoom, the wheel and the
// middle / right pan act in every mode and leave the drawing, the undo history and autosave untouched.
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
/** A real click on a slider's bar at `v` (the bar given a 100 px rect): the jump is the slider's own change (docs/slider-plan.md). */
async function slideTo(thumb: Element, v: number, lo: number, hi: number) {
  const bar = thumb.parentElement as HTMLElement
  bar.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 4, right: 100, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect
  const x = (v - lo) / (hi - lo) * 100, ev = (type: string, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 7 }); return e }
  await act(async () => { bar.dispatchEvent(ev('pointerdown', 1)); window.dispatchEvent(ev('pointerup', 0)) })
}
const valueOf = (thumb: Element) => thumb.getAttribute('aria-valuenow')
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }); delete (window as { benchStore?: Store }).benchStore; resetPage() })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number }; log: { calls: string; result: string }[] }
const bench = () => (window as unknown as { bench: B }).bench
function pe(type: string, x: number, y: number, buttons: number, opts: { id?: number; button?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: opts.button ?? 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: opts.id ?? 1 })
  return e
}
const keydown = (target: EventTarget, k: string, more: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }))
/** A store whose read waits for `release` (to hold restoring open) and whose writes are counted. */
function countingStore(hold = false) {
  const data: Record<string, string> = {}, writes: string[] = []
  let open!: () => void
  const gate = hold ? new Promise<void>(r => { open = r }) : Promise.resolve()
  const store: Store = { async get(k) { await gate; return data[k] }, async put(k, v) { writes.push(k); data[k] = v } }
  return { store, writes, release: async () => { await act(async () => { open(); await wait(10) }) } }
}
/** An App with v<k>: p (0, 300k) – q (100, 300k); q at (60, 300k + 30) in the side view. */
async function setup(opts: { hold?: boolean } = {}) {
  const k = ++n, mem = countingStore(opts.hold)
  ;(window as { benchStore?: Store }).benchStore = mem.store
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  if (!opts.hold) await act(async () => {
    await wait(10)
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: 300 * k } }))
    bench().core.editIn('view:90,0', e => e.move([{ id: `q${k}`, target: { x: 60, y: 300 * k + 30 } }]))
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  const input = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
  const type = async (id: string, v: string) => { const el = input(id); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
  // playback with A (docs/playback-edit-checklist.md §2)
  const play = async (yaw: number, pitch: number) => { await act(async () => { button('Playback').click() }); await type('yaw-text', String(yaw)); await type('pitch-text', String(pitch)); await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) }) }
  const pad = () => { const p = host.querySelector('[data-testid="pose-pad"]') as SVGSVGElement; p.getBoundingClientRect = () => ({ left: 1000, top: 0, width: 200, height: 100, right: 1200, bottom: 100, x: 1000, y: 0, toJSON() {} }) as DOMRect; return p }
  /** Where a pose lands on the pad (left 1000, 200 × 100). */
  const padAt = (yaw: number, pitch: number) => ({ x: 1000 + (yaw + 90) / 180 * 200, y: (45 - pitch) / 90 * 100 })
  const posed = (id: string) => { const p = bench().pose()!; return bench().core.atPose(p).snapshot().points.find(x => x.id === id)!.position }
  const viewBox = () => svg.getAttribute('viewBox')
  const untouched = () => ({ text: save(bench().core), undo: bench().core.canUndo, writes: mem.writes.length })
  return { host, svg, k, button, input, type, play, pad, padAt, posed, viewBox, untouched, mem }
}

describe('the pose pad in playback', () => {
  it('a drag on the pad moves the pose; the sliders and both fields follow; the drawing is untouched', async () => {
    const t = await setup()
    await t.play(0, 0)
    const before = save(bench().core)
    const a = t.padAt(-45, 30), b = t.padAt(60, -20)
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', a.x, a.y, 1)) })
    expect(bench().pose()).toEqual({ yaw: -45, pitch: 30 })
    await act(async () => { window.dispatchEvent(pe('pointermove', b.x, b.y, 1)); window.dispatchEvent(pe('pointerup', b.x, b.y, 0)) })
    expect([bench().pose(), valueOf(t.input('yaw')), valueOf(t.input('pitch')), t.input('yaw-text').value, t.input('pitch-text').value]).toEqual([{ yaw: 60, pitch: -20 }, '60', '-20', '60', '-20'])
    expect(save(bench().core)).toBe(before)
  })

  it('a slider or a valid typed number moves the handle; a field holding "-" changes nothing and keeps its text', async () => {
    const t = await setup()
    await t.play(0, 0)
    const handle = () => { const h = t.host.querySelector('[data-handle]')!; return [h.getAttribute('cx'), h.getAttribute('cy')] }
    await slideTo(t.input('yaw'), 45, -90, 90)
    expect([handle(), t.input('yaw-text').value]).toEqual([['150', '50'], '45'])
    await t.type('pitch-text', '-')
    expect([bench().pose(), handle(), t.input('pitch-text').value]).toEqual([{ yaw: 45, pitch: 0 }, ['150', '50'], '-'])
    await t.type('pitch-text', '-45')
    expect([bench().pose(), handle()]).toEqual([{ yaw: 45, pitch: -45 }, ['150', '100']])
  })

  it('a pad press during a correction drag cancels that drag (even at the pose already shown); a canvas press during a pad drag cancels the pad', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(45, 0)
    const start = t.posed(q), before = save(bench().core), here = t.padAt(45, 0)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', start.x, start.y, 1)); window.dispatchEvent(pe('pointermove', start.x + 20, start.y, 1)) })
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', here.x, here.y, 1)) }) // the same pose: still a handover
    await act(async () => { window.dispatchEvent(pe('pointerup', start.x + 20, start.y, 0)) })
    expect([save(bench().core), bench().log.some(l => l.calls.startsWith('correct('))]).toEqual([before, false])
    // and the other way: a pad drag, then a press on the canvas
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', here.x, here.y, 1)) })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 5000, 5000, 1)) })
    const far = t.padAt(-90, 45)
    await act(async () => { window.dispatchEvent(pe('pointermove', far.x, far.y, 1)) })
    expect(bench().pose()).toEqual({ yaw: 45, pitch: 0 })
  })

  it('Esc ends a pad drag; leaving playback during a pad drag leaves no pose and a late move changes nothing', async () => {
    const t = await setup()
    await t.play(0, 0)
    const a = t.padAt(30, 0), far = t.padAt(-90, -45)
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', a.x, a.y, 1)) })
    await act(async () => { keydown(window, 'Escape') })
    await act(async () => { window.dispatchEvent(pe('pointermove', far.x, far.y, 1)) })
    expect(bench().pose()).toEqual({ yaw: 30, pitch: 0 })
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', a.x, a.y, 1)) })
    await act(async () => { t.button('Leave playback').click() })
    await act(async () => { window.dispatchEvent(pe('pointermove', far.x, far.y, 1)) })
    expect(bench().pose()).toBeNull()
  })
})

describe('the viewport tools in every mode (bowen 1791727452; dot 1791727663)', () => {
  it('in playback: Z and the Zoom button toggle zoom; ⌘Z is not zoom; a Z typed into a field is not zoom', async () => {
    const t = await setup()
    await t.play(45, 0)
    const on = () => t.svg.style.cursor === 'zoom-in'
    await act(async () => { keydown(window, 'z') })
    expect(on()).toBe(true)
    await act(async () => { keydown(window, 'z') })
    expect(on()).toBe(false)
    await act(async () => { t.button('Zoom Z').click() })
    expect(on()).toBe(true)
    await act(async () => { t.button('Zoom Z').click() })
    await act(async () => { keydown(window, 'z', { metaKey: true }) })
    expect(on()).toBe(false)
    await act(async () => { keydown(t.input('yaw-text'), 'z') })
    expect(on()).toBe(false)
    // Z held down: the repeats toggle nothing (dot 1791731833)
    await act(async () => { keydown(window, 'z'); for (let k = 0; k < 5; k++) keydown(window, 'z', { repeat: true }) })
    expect(on()).toBe(true)
  })

  it('a second pointer pressing the pad during a middle-button pan by pointer 1 is ignored: the pan is kept, the pose unchanged (dot 1791731959)', async () => {
    const t = await setup()
    await t.play(45, 0)
    const box = t.viewBox(), at = t.padAt(-45, 30)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 10, 10, 4, { button: 1 })); window.dispatchEvent(pe('pointermove', 70, 40, 4, { button: 1 })) })
    const panned = t.viewBox()
    expect(panned).not.toBe(box)
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', at.x, at.y, 1, { id: 2 })) })
    expect([t.viewBox(), bench().pose()]).toEqual([panned, { yaw: 45, pitch: 0 }])
    await act(async () => { window.dispatchEvent(pe('pointerup', 70, 40, 0, { button: 1 })) })
    expect(t.viewBox()).toBe(panned)
  })

  it('a second pointer pressing the pad while a correction drag runs is ignored: the correction goes on and commits (dot 1791731833)', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(30, 0)
    const start = t.posed(q), at = t.padAt(-90, 45)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', start.x, start.y, 1)); window.dispatchEvent(pe('pointermove', start.x + 20, start.y, 1)) })
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', at.x, at.y, 1, { id: 2 })) })
    expect(bench().pose()).toEqual({ yaw: 30, pitch: 0 })
    await act(async () => { window.dispatchEvent(pe('pointerup', start.x + 20, start.y, 0)) })
    expect(bench().log[0]!.calls).toMatch(/^correct\(/)
  })

  it('in playback: a Z click zooms, a right-button drag pans, the wheel zooms — the drawing, the undo history and autosave untouched; Z off, a press on the line corrects again', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(30, 0)
    await act(async () => { await wait(10) })
    const before = t.untouched()
    let box = t.viewBox()
    await act(async () => { keydown(window, 'z') })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 10, 10, 1)); window.dispatchEvent(pe('pointerup', 10, 10, 0)) })
    expect(t.viewBox()).not.toBe(box); box = t.viewBox()
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 10, 10, 2, { button: 2 })); window.dispatchEvent(pe('pointermove', 60, 40, 2, { button: 2 })); window.dispatchEvent(pe('pointerup', 60, 40, 0, { button: 2 })) })
    expect(t.viewBox()).not.toBe(box); box = t.viewBox()
    await act(async () => { t.svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100, clientX: 5, clientY: 5 })) })
    expect(t.viewBox()).not.toBe(box)
    await act(async () => { await wait(10) })
    expect(t.untouched()).toEqual(before)
    await act(async () => { keydown(window, 'z') }) // off again
    const start = t.posed(q)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', start.x, start.y, 1)); window.dispatchEvent(pe('pointermove', start.x + 20, start.y + 10, 1)); window.dispatchEvent(pe('pointerup', start.x + 20, start.y + 10, 0)) })
    expect(bench().log[0]!.calls).toMatch(/^correct\(/)
  })

  it('while restoring: Z and the right-button pan act on the view; a plain left press reaches no tool and nothing is written', async () => {
    const t = await setup({ hold: true })
    expect(t.host.querySelector('[data-testid="autosave"]')!.textContent).toBe('autosave: restoring…')
    const box = t.viewBox()
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 10, 10, 2, { button: 2 })); window.dispatchEvent(pe('pointermove', 70, 30, 2, { button: 2 })); window.dispatchEvent(pe('pointerup', 70, 30, 0, { button: 2 })) })
    expect(t.viewBox()).not.toBe(box)
    await act(async () => { keydown(window, 'z') })
    expect(t.svg.style.cursor).toBe('zoom-in')
    await act(async () => { keydown(window, 'z'); keydown(window, 'p') }) // Z off; a tool key stays inert while restoring
    const text = save(bench().core)
    await act(async () => { for (const x of [-300, -250]) { t.svg.dispatchEvent(pe('pointerdown', x, 7, 1)); window.dispatchEvent(pe('pointerup', x, 7, 0)) } })
    expect([save(bench().core), t.mem.writes.length]).toEqual([text, 0])
    await t.mem.release()
  })
})
