// Reference pictures, round two (docs/reference-images-plan.md §8, §8a; dot 1791703489, 1791703574):
// live previews that end once, Move picture with grab and arrow keys, position slots in the panel.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const pending: (() => void)[] = []
class StubImage { width = 0; height = 0; onload: null | (() => void) = null; onerror: null | (() => void) = null
  set src(_: string) { pending.push(() => { this.width = 400; this.height = 300; this.onload?.() }) } }
const realImage = globalThis.Image
beforeEach(() => { pending.length = 0; (globalThis as { Image: unknown }).Image = StubImage })
const roots: { unmount(): void }[] = []
afterEach(async () => { (globalThis as { Image: unknown }).Image = realImage; await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
const bench = () => (window as unknown as { bench: { core: Core; chooseView(k: string): void } }).bench
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
const pe = (type: string, x: number, y: number, buttons: number, id = 1) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: id }); return e }
const key = (k: string, target: EventTarget = window, shift = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }))

/** An App in the front view with one picture placed: 400 × 300 px at scale 1, centred at (0, 0). */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('svg')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => { bench().chooseView('view:0,0') })
  const input = host.querySelector('[data-testid="ref-file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([Uint8Array.from(atob(PNG), c => c.charCodeAt(0))], 'f.png', { type: 'image/png' })], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(30) })
  await act(async () => { pending.shift()!() })
  const pic = () => bench().core.in('view:0,0').references().at(-1)!
  const id = pic().id
  const q = (sel: string) => host.querySelector(sel) as HTMLInputElement
  const field = (k: string) => q(`[data-ref="${id}"] [data-field="${k}"]`)
  const slider = (k: string) => q(`[data-ref="${id}"] [data-slider="${k}"]`)
  const drawnX = () => Number(host.querySelector(`[data-reference="${id}"]`)!.getAttribute('x'))
  const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  const moveMode = async (on: boolean) => { await act(async () => { const c = q('[data-testid="move-picture"]'); if (c.checked !== on) c.click() }) }
  return { host, root, svg, id, pic, field, slider, drawnX, button, moveMode }
}

describe('live adjusting: a preview, then one commit (§8.1, §8a.1)', () => {
  it('a slider drag is drawn at once, writes nothing until release, then one undo step', async () => {
    const t = await setup(), before = save(bench().core), x0 = t.drawnX()
    await act(async () => { setValue(t.slider('x'), '120') })
    expect(t.drawnX()).toBe(x0 + 120)
    expect(save(bench().core)).toBe(before)
    await act(async () => { t.slider('x').dispatchEvent(new MouseEvent('pointerup', { bubbles: true })) })
    expect(t.pic().x).toBe(120)
    await act(async () => { t.button('Undo').click() })
    expect(save(bench().core)).toBe(before)
  })

  it('typing previews; Enter commits once and the later blur does not commit again; Esc writes nothing; invalid text never reaches core', async () => {
    const t = await setup(), before = save(bench().core)
    await act(async () => { setValue(t.field('y'), '40') })
    expect(save(bench().core)).toBe(before)
    await act(async () => { key('Enter', t.field('y')) })
    const after = save(bench().core)
    expect(t.pic().y).toBe(40)
    await act(async () => { t.field('y').dispatchEvent(new FocusEvent('blur')); t.field('y').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(save(bench().core)).toBe(after)
    for (const v of ['', '-', 'abc']) await act(async () => { setValue(t.field('scale'), v) })
    await act(async () => { setValue(t.field('scale'), '3'); key('Escape', t.field('scale')); t.field('scale').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(save(bench().core)).toBe(after)
  })

  it('a preview whose picture was undone underneath is dropped, not written back', async () => {
    const t = await setup()
    await act(async () => { setValue(t.field('x'), '10'); key('Enter', t.field('x')) })
    await act(async () => { setValue(t.slider('opacity'), '0.9') })
    await act(async () => { t.button('Undo').click() }) // x back to 0 underneath the opacity preview
    const undone = save(bench().core)
    await act(async () => { t.slider('opacity').dispatchEvent(new MouseEvent('pointerup', { bubbles: true })) })
    expect(save(bench().core)).toBe(undone)
  })
})

describe('Move picture (§8.2, §8a.2, §8a.3)', () => {
  it('a drag on the picture moves only the picture, one undo step; lines and points untouched', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => e.line('ln', { id: 'la', layer: 'layer-1', position: { x: -50, y: 0 } }, { id: 'lb', layer: 'layer-1', position: { x: 50, y: 0 } })) })
    await t.moveMode(true)
    const lines = JSON.stringify(bench().core.snapshot().points)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', -50, 0, 1)); window.dispatchEvent(pe('pointermove', -20, 10, 1)); window.dispatchEvent(pe('pointerup', -20, 10, 0)) })
    expect([t.pic().x, t.pic().y]).toEqual([30, 10])
    expect(JSON.stringify(bench().core.snapshot().points)).toBe(lines)
  })

  for (const [name, act0] of [
    ['Esc', async () => { key('Escape') }],
    ['pointercancel', async () => { window.dispatchEvent(pe('pointercancel', 0, 0, 0)) }],
    ['turning Move picture off', async () => { (document.querySelector('[data-testid="move-picture"]') as HTMLInputElement).click() }],
    ['a view change', async () => { bench().chooseView('view:90,0') }],
  ] as const) it(`a drag cancelled by ${name} writes nothing, and a late pointerup commits nothing`, async () => {
    const t = await setup()
    await t.moveMode(true)
    const before = save(bench().core)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, 0, 1)); window.dispatchEvent(pe('pointermove', 30, 30, 1)) })
    await act(act0)
    await act(async () => { window.dispatchEvent(pe('pointerup', 30, 30, 0)) })
    expect(save(bench().core)).toBe(before)
  })

  it('arrow keys nudge the active picture (Shift ×10), never the lines; with no active picture they do nothing; a focused field keeps its arrows', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => { e.line('ln2', { id: 'la2', layer: 'layer-1', position: { x: -50, y: 20 } }, { id: 'lb2', layer: 'layer-1', position: { x: 50, y: 20 } }); e.select([{ kind: 'line', id: 'ln2' }]) }) })
    await t.moveMode(true)
    const points = JSON.stringify(bench().core.snapshot().points), before = save(bench().core)
    await act(async () => { key('ArrowRight') }) // no active picture yet
    expect(save(bench().core)).toBe(before)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, 0, 1)); window.dispatchEvent(pe('pointerup', 0, 0, 0)) }) // press: active, unmoved
    await act(async () => { key('ArrowRight'); key('ArrowDown', window, true) })
    expect([t.pic().x, t.pic().y]).toEqual([1, 10])
    expect(JSON.stringify(bench().core.snapshot().points)).toBe(points)
    const now = save(bench().core)
    await act(async () => { t.field('x').focus(); key('ArrowLeft', t.field('x')) })
    expect(save(bench().core)).toBe(now)
  })

  it('arrow keys are ignored during a drag; the release then commits only the drag (§8a.2)', async () => {
    const t = await setup()
    await t.moveMode(true)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, 0, 1)) })
    await act(async () => { key('ArrowDown') }) // pressed, not yet moved: still a drag
    await act(async () => { window.dispatchEvent(pe('pointermove', 30, 0, 1)) })
    await act(async () => { key('ArrowDown') })
    await act(async () => { window.dispatchEvent(pe('pointerup', 30, 0, 0)) })
    expect([t.pic().x, t.pic().y]).toEqual([30, 0])
  })

  it('opening another file with the same picture id does not inherit the active target', async () => {
    const t = await setup()
    await t.moveMode(true)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, 0, 1)); window.dispatchEvent(pe('pointerup', 0, 0, 0)) })
    const file = JSON.parse(save(bench().core))
    const open = t.host.querySelector('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(open, 'files', { value: [new File([JSON.stringify(file)], 'd.json', { type: 'application/json' })], configurable: true })
    await act(async () => { open.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
    const opened = save(bench().core)
    await act(async () => { key('ArrowRight') })
    expect(save(bench().core)).toBe(opened)
  })
})

describe('position slots in the panel (§8.3)', () => {
  it('add a slot, save the placement, move away, recall it, clear it, rename it', async () => {
    const t = await setup()
    const slots = () => t.host.querySelector(`[data-slots="${t.id}"]`)!
    await act(async () => { t.button('＋ 加一格', slots()).click() })
    await act(async () => { setValue(t.field('x'), '25'); key('Enter', t.field('x')) })
    await act(async () => { t.button('存', slots()).click() })
    await act(async () => { setValue(t.field('x'), '-60'); key('Enter', t.field('x')) })
    await act(async () => { t.button('调出', slots()).click() })
    expect(t.pic().x).toBe(25)
    const realPrompt = window.prompt; window.prompt = () => '正面'
    await act(async () => { slots().querySelector('b')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    window.prompt = realPrompt
    expect(t.pic().slots[0]!.name).toBe('正面')
    await act(async () => { t.button('×', slots()).click() })
    expect(t.pic().slots[0]!.placement).toBeNull()
    expect(t.button('调出', slots()).disabled).toBe(true)
  })
})
