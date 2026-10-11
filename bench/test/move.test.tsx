// Moving by keyboard in the bench (docs/move-plan.md; bowen 1791733125, 1791733775; dot 1791733296, 1791733489):
// a held run of arrows is one move session — one undo step, written only on the last release; Shift ×10,
// Option / Ctrl ×0.1; it holds the one gesture slot, and every cancel path ends it without writing.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'
import { resetPage, type Store } from '../../autosave'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const pending: (() => void)[] = []
class StubImage { width = 0; height = 0; onload: null | (() => void) = null; onerror: null | (() => void) = null
  set src(_: string) { pending.push(() => { this.width = 400; this.height = 300; this.onload?.() }) } }
const realImage = globalThis.Image
beforeEach(() => { pending.length = 0; (globalThis as { Image: unknown }).Image = StubImage })
const roots: { unmount(): void }[] = []
afterEach(async () => { (globalThis as { Image: unknown }).Image = realImage; await act(async () => { for (const r of roots.splice(0)) r.unmount() }); delete (window as { benchStore?: Store }).benchStore; resetPage() })
const bench = () => (window as unknown as { bench: { core: Core; chooseView(k: string): void } }).bench
const pe = (type: string, x: number, y: number, buttons: number, id = 1) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: id }); return e }
const down = (k: string, more: KeyboardEventInit = {}, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }))
const up = (k: string, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }))
let n = 0

/** The front view with a picture (400 × 300, centred at 0, 0) and a line m<k> from (-50, 1000k) to (50, 1000k) (apart from other tests' lines); autosave writes counted. */
async function setup() {
  const k = ++n, writes: string[] = [], data: Record<string, string> = {}
  ;(window as { benchStore?: Store }).benchStore = { async get(key) { return data[key] }, async put(key, v) { writes.push(key); data[key] = v } }
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />); await wait(10) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => { bench().chooseView('view:0,0') })
  await act(async () => { bench().core.edit(e => e.line(`m${k}`, { id: `ma${k}`, layer: 'layer-1', position: { x: -50, y: 1000 * k } }, { id: `mb${k}`, layer: 'layer-1', position: { x: 50, y: 1000 * k } })) })
  const input = host.querySelector('[data-testid="ref-file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([Uint8Array.from(atob(PNG), c => c.charCodeAt(0))], 'f.png', { type: 'image/png' })], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(30) })
  await act(async () => { pending.shift()!() })
  const pic = () => bench().core.in('view:0,0').references().at(-1)!
  const id = pic().id
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  const moveMode = async (on: boolean) => { await act(async () => { const c = host.querySelector('[data-testid="move-picture"]') as HTMLInputElement; if (c.checked !== on) c.click() }) }
  const activate = async () => { await moveMode(true); await act(async () => { svg.dispatchEvent(pe('pointerdown', 0, 0, 1)); window.dispatchEvent(pe('pointerup', 0, 0, 0)) }) }
  const point = (pid: string) => bench().core.snapshot().points.find(p => p.id === pid)!.position
  await act(async () => { await wait(10) })
  return { host, svg, k, y: 1000 * k, id, pic, button, moveMode, activate, point, writes }
}

describe('the background picture by keyboard (Move picture on)', () => {
  it('a held arrow is one move and one undo step: nothing written until the release; Shift ×10, Option and Ctrl ×0.1', async () => {
    const t = await setup()
    await t.activate()
    const before = save(bench().core)
    await act(async () => { down('ArrowRight'); down('ArrowRight', { repeat: true }); down('ArrowRight', { repeat: true }) })
    expect(save(bench().core)).toBe(before)
    await act(async () => { up('ArrowRight') })
    expect(t.pic().x).toBe(3)
    await act(async () => { t.button('Undo').click() })
    expect(save(bench().core)).toBe(before)
    const step = async (more: KeyboardEventInit) => { const x0 = t.pic().x; await act(async () => { down('ArrowRight', more) }); await act(async () => { up('ArrowRight') }); return Math.round((t.pic().x - x0) * 1e9) / 1e9 }
    expect([await step({ shiftKey: true }), await step({ altKey: true }), await step({ ctrlKey: true })]).toEqual([10, 0.1, 0.1])
  })

  it('Esc, a tool change, a view change, a layer-scope change or focus moving into a field ends a run with nothing written; the late release writes nothing', async () => {
    const t = await setup()
    const ends: [string, () => Promise<void>][] = [
      ['Esc', async () => { await act(async () => { down('Escape') }) }],
      ['a tool change', async () => { await act(async () => { t.button('Pen P').click() }) }],
      ['a view change', async () => { await act(async () => { bench().chooseView('view:0,0') }) }],
      ['focus into a field', async () => { await act(async () => { (t.host.querySelector(`[data-ref="${t.id}"] [data-field="x"]`) as HTMLInputElement).focus() }) }],
      ['a layer-scope change', async () => { await act(async () => { const name = bench().core.snapshot().layers[0]!.name; [...t.host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === name)!.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }],
    ]
    for (const [name, end] of ends) {
      await t.activate()
      const before = save(bench().core)
      await act(async () => { down('ArrowLeft') })
      await end()
      await act(async () => { up('ArrowLeft') })
      expect([name, save(bench().core)]).toEqual([name, before])
    }
  })

  it('a canvas press during a run is ignored; the run then commits as one move', async () => {
    const t = await setup()
    await t.activate()
    await act(async () => { down('ArrowDown') })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, 0, 1)); window.dispatchEvent(pe('pointermove', 80, 0, 1)); window.dispatchEvent(pe('pointerup', 80, 0, 0)) })
    await act(async () => { up('ArrowDown') })
    expect([t.pic().x, t.pic().y]).toEqual([0, 1])
  })

  it('a repeat after a cancel starts nothing: a real press is needed', async () => {
    const t = await setup()
    await t.activate()
    const before = save(bench().core)
    await act(async () => { down('ArrowUp') })
    await act(async () => { down('Escape') })
    await act(async () => { down('ArrowUp', { repeat: true }); down('ArrowUp', { repeat: true }) })
    await act(async () => { up('ArrowUp') })
    expect(save(bench().core)).toBe(before)
  })
})

describe('the same input rules for the picture and the selection (dot 1791734673)', () => {
  it('⌘ + arrow moves neither the picture nor the selection', async () => {
    const t = await setup()
    await t.activate()
    const before = save(bench().core)
    await act(async () => { down('ArrowRight', { metaKey: true }) }); await act(async () => { up('ArrowRight') })
    await t.moveMode(false)
    await act(async () => { down('a') }); await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.y, 1)); window.dispatchEvent(pe('pointerup', 0, t.y, 0)) })
    const selected = save(bench().core)
    await act(async () => { down('ArrowRight', { metaKey: true }) }); await act(async () => { up('ArrowRight') })
    expect([JSON.parse(before).document.reference, save(bench().core)]).toEqual([JSON.parse(selected).document.reference, selected])
  })

  it('arrows on a focused slider are the slider\'s: they move neither the picture nor the selection', async () => {
    const t = await setup()
    await t.activate()
    const slider = t.host.querySelector(`[data-ref="${t.id}"] [data-slider="angle"]`) as HTMLInputElement
    const before = save(bench().core)
    await act(async () => { slider.focus() })
    await act(async () => { down('ArrowRight', {}, slider) }); await act(async () => { up('ArrowRight', slider) })
    expect(save(bench().core)).toBe(before)
    await t.moveMode(false)
    await act(async () => { down('a') }); await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.y, 1)); window.dispatchEvent(pe('pointerup', 0, t.y, 0)) })
    const selected = save(bench().core)
    await act(async () => { slider.focus() })
    await act(async () => { down('ArrowLeft', {}, slider) }); await act(async () => { up('ArrowLeft', slider) })
    expect(save(bench().core)).toBe(selected)
  })

  it('⌘Z or Ctrl + Z during a key run ends the run only: nothing earlier is undone, the late release moves nothing — the picture and the selection alike', async () => {
    const t = await setup()
    await t.activate()
    await act(async () => { down('ArrowUp') }); await act(async () => { up('ArrowUp') }) // an earlier move, committed
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      const before = save(bench().core)
      await act(async () => { down('ArrowRight') })
      await act(async () => { down('z', mod) })
      await act(async () => { up('ArrowRight') })
      expect(save(bench().core)).toBe(before)
    }
    const before = save(bench().core) // the Undo button during a picture run: the same
    await act(async () => { down('ArrowRight') }); await act(async () => { t.button('Undo').click() }); await act(async () => { up('ArrowRight') })
    expect(save(bench().core)).toBe(before)
    await t.moveMode(false)
    await act(async () => { down('a') }); await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.y, 1)); window.dispatchEvent(pe('pointerup', 0, t.y, 0)) })
    const selected = save(bench().core)
    await act(async () => { down('ArrowRight') }); await act(async () => { down('z', { metaKey: true }) }); await act(async () => { up('ArrowRight') })
    expect(save(bench().core)).toBe(selected)
    await act(async () => { down('ArrowRight') }); await act(async () => { t.button('Undo').click() }); await act(async () => { up('ArrowRight') })
    expect(save(bench().core)).toBe(selected)
  })
})

describe('the selection by keyboard (V / A)', () => {
  it('A on a line, a held arrow: one translate, one undo step; autosave writes only after the release; Ctrl + Z still undoes', async () => {
    const t = await setup()
    await act(async () => { down('a') })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.y, 1)); window.dispatchEvent(pe('pointerup', 0, t.y, 0)) })
    await act(async () => { await wait(10) })
    const writes = t.writes.length, before = save(bench().core)
    await act(async () => { down('ArrowLeft', { shiftKey: true }); down('ArrowLeft', { shiftKey: true, repeat: true }); await wait(10) })
    expect([t.writes.length, save(bench().core)]).toEqual([writes, before])
    await act(async () => { up('ArrowLeft'); await wait(10) })
    expect([t.point(`ma${t.k}`), t.writes.length > writes]).toEqual([{ x: -70, y: t.y }, true])
    await act(async () => { down('z', { ctrlKey: true }) })
    expect(save(bench().core)).toBe(before)
  })

  it('arrows during a canvas drag are ignored; arrows in playback move nothing', async () => {
    const t = await setup()
    await act(async () => { down('a') })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.y, 1)); window.dispatchEvent(pe('pointerup', 0, t.y, 0)) })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.y, 1)); window.dispatchEvent(pe('pointermove', 10, t.y, 1)) })
    await act(async () => { down('ArrowDown'); up('ArrowDown') })
    await act(async () => { window.dispatchEvent(pe('pointerup', 10, t.y, 0)) })
    expect(t.point(`ma${t.k}`)).toEqual({ x: -40, y: t.y })
    await act(async () => { t.button('Playback').click() })
    const before = save(bench().core)
    await act(async () => { down('ArrowDown'); up('ArrowDown') })
    expect(save(bench().core)).toBe(before)
  })
})
