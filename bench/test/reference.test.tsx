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
})
