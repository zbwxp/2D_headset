// Step 7: the bench's view picker (docs/step7-view-picker.md). Real App, real Core, real
// interaction; jsdom events.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
type B = { core: Core; ix: { setTool(t: string): void; selection(): unknown[] }; refresh(): void; view(): string; chooseView(k: string): void }
const bench = () => (window as unknown as { bench: B }).bench

function pe(type: string, x: number, y: number, buttons: number, pointerId = 1, button = 0) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button, buttons })
  Object.defineProperty(e, 'pointerId', { value: pointerId })
  return e
}

async function setup() {
  const k = ++n
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('svg')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: 300 * k } }))
    bench().ix.setTool('A'); bench().refresh()
  })
  return { svg, k, host }
}
const at = (view: string, id: string) => bench().core.in(view).snapshot().points.find(p => p.id === id)!.position

describe('the view picker', () => {
  it('shows the nine views and switches the current one', async () => {
    const { host } = await setup()
    const buttons = [...host.querySelectorAll('[data-testid="views"] button')]
    expect(buttons.map(b => b.getAttribute('data-view')).sort()).toEqual([...bench().core.views()].sort())
    await act(async () => { (host.querySelector('[data-view="view:90,0"]') as HTMLButtonElement).click() })
    expect(bench().view()).toBe('view:90,0')
  })

  it('a drag in the side view moves the point there only, and the canvas draws the side view', async () => {
    const { svg, k, host } = await setup()
    await act(async () => { (host.querySelector('[data-view="view:90,0"]') as HTMLButtonElement).click() })
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 0, 300 * k, 1))
      window.dispatchEvent(pe('pointermove', 20, 300 * k + 40, 1))
      window.dispatchEvent(pe('pointerup', 20, 300 * k + 40, 0))
    })
    expect(at('view:90,0', `p${k}`)).toEqual({ x: 20, y: 300 * k + 40 })
    expect(at('view:0,0', `p${k}`)).toEqual({ x: 0, y: 300 * k })
    expect(svg.outerHTML).toContain(`M20,${300 * k + 40}`)
  })

  it('the broadcast button gives every view the side view\'s stroke for the selected line', async () => {
    const { svg, k, host } = await setup()
    await act(async () => { (host.querySelector('[data-view="view:90,0"]') as HTMLButtonElement).click() })
    await act(async () => {
      bench().core.editIn('view:90,0', e => e.lineStroke(`v${k}`, { width: 6, profile: 'uniform' }))
      bench().ix.setTool('V'); bench().refresh()
      svg.dispatchEvent(pe('pointerdown', 50, 300 * k, 1)); window.dispatchEvent(pe('pointerup', 50, 300 * k, 0))
    })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Broadcast stroke')!.click() })
    for (const v of bench().core.views()) expect(bench().core.in(v).snapshot().lines.find(l => l.id === `v${k}`)!.stroke.width).toBe(6)
  })
})
