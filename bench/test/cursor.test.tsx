// The canvas cursor asks cursor/ (bowen 1791708333; docs/rename-and-cursor-plan.md §2; dot 1791708548):
// Pen and Fill show their pictures, A and V a hand that grabs while a press is held; the grab ends on
// every end of the gesture (release, Esc, leaving the window, a tool change, playback, unmount);
// playback, Move picture and restoring show the arrow whatever tool was left on (dot 1791710244).
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core } from '../../src'
import { App } from '../src/app'
import { cursorFor } from '../../cursor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
type B = { core: Core; refresh(): void }
const bench = () => (window as unknown as { bench: B }).bench
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
let n = 0

function pe(type: string, x: number, y: number, buttons: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

/** An App with one line; a press at (x, 0) lands on its first point. */
async function setup() {
  const k = ++n
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  const y = 300 * k
  await act(async () => { bench().core.edit(e => e.line(`c${k}`, { id: `ca${k}`, layer: 'layer-1', position: { x: 0, y } }, { id: `cb${k}`, layer: 'layer-1', position: { x: 100, y } })); bench().refresh() })
  const cursor = () => svg.style.cursor
  const tool = async (k: string) => { await act(async () => { key(k) }) }
  const press = async () => { await act(async () => { svg.dispatchEvent(pe('pointerdown', 0, y, 1)) }) }
  const release = async () => { await act(async () => { window.dispatchEvent(pe('pointerup', 0, y, 0)) }) }
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  return { host, root, svg, cursor, tool, press, release, button }
}
const PEN = cursorFor('pen', false), BUCKET = cursorFor('fill', false)

/** Playback at an in-between pose (yaw 20): read only there; at a view A / V edit it (docs/playback-edit-checklist.md §2). */
async function between(host: HTMLElement) {
  const el = host.querySelector('[data-testid="yaw-text"]') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '20'); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('the canvas cursor', () => {
  it('each tool shows its own: Pen a pen, Fill a bucket, A and V a hand, Z zoom, others the arrow', async () => {
    const t = await setup()
    const seen: [string, string][] = []
    for (const k of ['p', 'f', 'a', 'v', 'u', 'b', 'z']) { await t.tool(k); seen.push([k, t.cursor()]) }
    // jsdom normalises the url's quoting; compare by the picture's identity (its hotspot) and the keywords
    expect(seen.map(([k, c]) => [k, c.includes('data:image/svg+xml') ? (c.includes(' 2 2') ? 'pen' : c.includes(' 3 21') ? 'bucket' : '?') : c])).toEqual(
      [['p', 'pen'], ['f', 'bucket'], ['a', 'grab'], ['v', 'grab'], ['u', 'default'], ['b', 'default'], ['z', 'zoom-in']])
    void PEN; void BUCKET
  })

  it('V: grabbing while a press the tool took is held, the open hand again on release', async () => {
    const t = await setup()
    await t.tool('v')
    await t.press()
    expect(t.cursor()).toBe('grabbing')
    await t.release()
    expect(t.cursor()).toBe('grab')
  })

  it('A: the grab ends on Esc, on leaving the window, and on a tool change', async () => {
    const t = await setup()
    await t.tool('a')
    await t.press(); await act(async () => { key('Escape') })
    expect(t.cursor()).toBe('grab')
    await t.press(); await act(async () => { window.dispatchEvent(new Event('blur')) })
    expect(t.cursor()).toBe('grab')
    await t.press(); await t.tool('u') // S is Straight now (bowen 1791944499)
    expect(t.cursor()).toBe('default')
  })

  it('playback shows the arrow, even with Pen left on or a grab held; leaving it does not bring back a grab', async () => {
    const t = await setup()
    await t.tool('p')
    await act(async () => { t.button('Playback').click() })
    expect(t.cursor()).toBe('default')
    await act(async () => { t.button('Leave playback').click() })
    expect(t.cursor()).toContain('data:image/svg+xml')
    await t.tool('v'); await t.press()
    await act(async () => { t.button('Playback').click() }); await between(t.host)
    expect(t.cursor()).toBe('default')
    await act(async () => { t.button('Leave playback').click() })
    expect(t.cursor()).toBe('grab')
  })

  it('Move picture on: a press moves the picture, so not the Pen — the arrow; off again, the Pen (dot 1791710244)', async () => {
    const t = await setup()
    await t.tool('p')
    expect(t.cursor()).toContain('data:image/svg+xml')
    const box = () => t.host.querySelector('[data-testid="move-picture"]') as HTMLInputElement
    await act(async () => { box().click() })
    expect([box().checked, t.cursor()]).toEqual([true, 'default'])
    await t.tool('v') // a tool key while Move picture is on: still the picture's press
    expect(t.cursor()).toBe('default')
    await act(async () => { box().click() })
    expect([box().checked, t.cursor()]).toEqual([false, 'grab'])
    await t.tool('p')
    expect(t.cursor()).toContain('data:image/svg+xml')
  })

  it('unmounting during a grab leaves nothing behind: a new App shows the open hand', async () => {
    const t = await setup()
    await t.tool('v'); await t.press()
    await act(async () => { t.root.unmount() }); roots.splice(roots.indexOf(t.root), 1)
    const u = await setup()
    await u.tool('v')
    expect(u.cursor()).toBe('grab')
  })
})
