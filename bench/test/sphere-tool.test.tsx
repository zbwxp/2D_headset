// The 球面变形框 in the bench (docs/sphere-frame-checklist.md §3–4): the panel's sliders preview, the frame is drawn
// with the lines as 「应用」 would write them, 「应用」 commits once, undo restores; refused values disable 「应用」;
// playback offers no sphere tool.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number }; edit(fn: (e: Editor) => unknown): void }
const bench = () => (window as unknown as { bench: B }).bench

async function setup() {
  const k = ++n, Y = 300 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const [e1, e2] = [`up${k}`, `lo${k}`]
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => {
      e.line(e1, { id: `l${k}`, layer: 'layer-1', position: { x: 0, y: Y } }, { id: `r${k}`, layer: 'layer-1', position: { x: 80, y: Y } }, { ha: { x: 20, y: -25 }, hb: { x: -20, y: -25 } })
      e.line(e2, `l${k}`, `r${k}`, { ha: { x: 25, y: 18 }, hb: { x: -25, y: 18 } })
      e.select([{ kind: 'line', id: e1 }, { kind: 'line', id: e2 }])
    })
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  /** The slider module's field: type a value and press Enter (a slide's preview takes the same path). */
  const slide = async (id: string, v: number) => {
    const el = q(id) as HTMLInputElement
    await act(async () => { el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  }
  const points = () => JSON.stringify(bench().core.snapshot().points.filter(p => p.id.endsWith(String(k))).map(p => p.position))
  return { host, k, e1, e2, button, q, slide, points }
}

describe('the sphere frame in the bench', () => {
  it('opens on the selection; a slider previews in place (the lines drawn turned, nothing written); 「应用」 commits once; undo restores', async () => {
    const t = await setup(), start = save(bench().core), before = t.points()
    await act(async () => { t.button('球面框')!.click() })
    expect(t.q('sphere-panel')).not.toBeNull()
    expect(t.q('sphere-frame')).not.toBeNull()
    expect((t.q('sphere-apply') as HTMLButtonElement).disabled).toBe(false)
    const drawnBefore = (bench() as unknown as { svg(): string }).svg()
    await t.slide('sphere-yaw', 35)
    expect((bench() as unknown as { svg(): string }).svg()).not.toBe(drawnBefore) // the canvas shows the turned lines
    expect(save(bench().core)).toBe(start)
    await act(async () => { (t.q('sphere-apply') as HTMLButtonElement).click() })
    expect(t.points()).not.toBe(before)
    await act(async () => { t.button('Undo')!.click() })
    expect(t.points()).toBe(before)
  })

  it('a refused value: the message shows and 「应用」 is disabled', async () => {
    const t = await setup()
    // a lock the turn would break (a fold is not refused, bowen 1792056346; the panel keeps the lines on the sphere)
    await act(async () => { bench().core.edit(e => e.lineState(t.e2, { locked: true })); bench().refresh() })
    const start = save(bench().core)
    await act(async () => { t.button('球面框')!.click() })
    await t.slide('sphere-yaw', 35)
    expect(t.q('sphere-refused')).not.toBeNull()
    expect((t.q('sphere-apply') as HTMLButtonElement).disabled).toBe(true)
    expect(save(bench().core)).toBe(start)
  })

  it('playback: an open frame ends, Enter writes nothing, and the tool cannot be chosen (its toolbar is disabled)', async () => {
    const t = await setup()
    await act(async () => { t.button('球面框')!.click() })
    await t.slide('sphere-yaw', 30)
    const start = save(bench().core)
    await act(async () => { t.button('Playback')!.click() })
    expect(bench().pose()).not.toBeNull()
    expect(t.q('sphere-frame')).toBeNull()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(save(bench().core)).toBe(start)
    expect((t.button('球面框')!.closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  })
})
