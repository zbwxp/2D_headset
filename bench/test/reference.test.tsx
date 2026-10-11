// Reference pictures in the bench (docs/reference-images-plan.md §4, §7.1): placing through the panel,
// drawn only in their view and not in playback; a read that returns after a view change (even back),
// playback in and out, or unmounting writes nothing; a picture that does not decode is not placed.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// jsdom decodes no picture: a stub whose decoding the test finishes (or fails) when it chooses
const pending: { done(w: number, h: number): void; fail(): void }[] = []
class StubImage { width = 0; height = 0; onload: null | (() => void) = null; onerror: null | (() => void) = null
  set src(_: string) { pending.push({ done: (w, h) => { this.width = w; this.height = h; this.onload?.() }, fail: () => this.onerror?.() }) } }
const realImage = globalThis.Image
beforeEach(() => { pending.length = 0; (globalThis as { Image: unknown }).Image = StubImage })
const roots: { unmount(): void }[] = []
afterEach(async () => { (globalThis as { Image: unknown }).Image = realImage; await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
const bench = () => (window as unknown as { bench: { core: Core; chooseView(k: string): void } }).bench

async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  await act(async () => { bench().chooseView('view:0,0') })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  /** Choose a file in the panel; the read starts, decoding waits for the test. */
  const choose = async () => {
    const input = host.querySelector('[data-testid="ref-file"]') as HTMLInputElement
    const bytes = Uint8Array.from(atob(PNG), c => c.charCodeAt(0))
    Object.defineProperty(input, 'files', { value: [new File([bytes], 'face.png', { type: 'image/png' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(30) })
    expect(pending.length).toBe(1)
  }
  const decode = async (w = 400, h = 300) => { await act(async () => { pending.shift()!.done(w, h) }) }
  const images = () => [...host.querySelectorAll('[data-reference]')].length
  return { host, root, button, choose, decode, images }
}

describe('reference pictures in the bench', () => {
  it('placed in the current view: drawn there, not in another view, not in playback', async () => {
    const t = await setup(), before = bench().core.in('view:0,0').references().length
    await t.choose(); await t.decode()
    expect(bench().core.in('view:0,0').references().length).toBe(before + 1)
    expect(t.images()).toBe(before + 1)
    await act(async () => { bench().chooseView('view:90,0') })
    expect(t.images()).toBe(bench().core.in('view:90,0').references().length)
    await act(async () => { bench().chooseView('view:0,0') })
    await act(async () => { t.button('Playback').click() })
    expect(t.images()).toBe(0)
  })

  it('a read that returns after a view change, even back to the same view, writes nothing', async () => {
    const t = await setup(), before = save(bench().core)
    await t.choose()
    await act(async () => { bench().chooseView('view:90,0') }); await act(async () => { bench().chooseView('view:0,0') })
    await t.decode()
    expect(save(bench().core)).toBe(before)
  })

  it('a read that returns after playback was entered and left writes nothing', async () => {
    const t = await setup(), before = save(bench().core)
    await t.choose()
    await act(async () => { t.button('Playback').click() }); await act(async () => { t.button('Leave playback').click() })
    await t.decode()
    expect(save(bench().core)).toBe(before)
  })

  it('a read that returns after the App unmounted writes nothing; a picture that does not decode is not placed', async () => {
    const t = await setup(), before = save(bench().core)
    await t.choose()
    await act(async () => { t.root.unmount() })
    await t.decode()
    expect(save(bench().core)).toBe(before)
    const u = await setup()
    await u.choose()
    await act(async () => { pending.shift()!.fail() })
    expect(save(bench().core)).toBe(before)
  })

  it('the number fields follow the document: edit → undo → redo, and a file with the same id but other values (dot 1791701767)', async () => {
    const t = await setup()
    await t.choose(); await t.decode()
    const id = bench().core.in('view:0,0').references().at(-1)!.id
    const field = (k: string) => t.host.querySelector(`[data-ref="${id}"] [data-field="${k}"]`) as HTMLInputElement
    const x0 = field('x').value
    await act(async () => {
      const el = field('x')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '123')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(field('x').value).toBe('123')
    await act(async () => { t.button('Undo').click() })
    expect(field('x').value).toBe(x0)
    await act(async () => { t.button('Redo').click() })
    expect(field('x').value).toBe('123')
    // a file whose picture has the same id and another x
    const file = JSON.parse(save(bench().core))
    file.document.reference.images.find((i: { id: string }) => i.id === id).x = 7
    const input = t.host.querySelector('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'd.json', { type: 'application/json' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
    expect(field('x').value).toBe('7')
  })

  it('a picture that fails to draw shows an error, bound to its drawing and source: opening a file with a good picture of the same id clears it (dot 1791703225)', async () => {
    const t = await setup()
    await t.choose(); await t.decode()
    const id = bench().core.in('view:0,0').references().at(-1)!.id
    const status = () => t.host.querySelector('[data-testid="canvas"]')!.previousElementSibling!.textContent!
    await act(async () => { t.host.querySelector(`[data-reference="${id}"]`)!.dispatchEvent(new Event('error')) })
    expect(status()).toContain(`reference picture ${id} could not be drawn`)
    // another drawing with the same id and a different (good) picture
    const file = JSON.parse(save(bench().core))
    // (version 6: the picture's content is its library entry's)
    const asset = file.document.reference.images.find((i: { id: string }) => i.id === id).asset
    file.document.reference.library.find((a: { id: string }) => a.id === asset).src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggh=='
    const input = t.host.querySelector('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'd.json', { type: 'application/json' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
    expect(status()).not.toContain('could not be drawn')
  })

  it('after placing and editing a picture, the Pen still draws (bowen 1791703582)', async () => {
    const t = await setup()
    await t.choose(); await t.decode()
    const id = bench().core.in('view:0,0').references().at(-1)!.id
    const field = t.host.querySelector(`[data-ref="${id}"] [data-field="x"]`) as HTMLInputElement
    await act(async () => {
      field.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '50')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const svg = t.host.querySelector('[data-testid="canvas"]')!
    ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
    Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
    await act(async () => { t.button('Pen P').click() })
    const before = bench().core.snapshot().lines.length
    const click = async (x: number, y: number) => {
      const pe = (type: string, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
      await act(async () => { svg.dispatchEvent(pe('pointerdown', 1)); window.dispatchEvent(pe('pointerup', 0)) })
    }
    await click(-150, -150); await click(-100, -120)
    expect(bench().core.snapshot().lines.length).toBe(before + 1)
  })
})
