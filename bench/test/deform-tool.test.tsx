// The 四角 / 曲边 tool in the bench (docs/deform-p3-checklist.md §4): its button, the frame drawn (4 corners,
// 8 handles, 4 midpoints), a corner drag on the canvas committing once, the readout, reset and done.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type Ix = { preview(): { deform?: { frame: { corners: { x: number; y: number }[] }; maxError: number } } }
const bench = () => (window as unknown as { bench: { core: Core; ix: Ix; refresh(): void; chooseView(k: string): void } }).bench
const pe = (type: string, x: number, y: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
let n = 0

/** An L-shaped curve, selected with V; then the 四角/曲边 tool. */
async function setup() {
  const k = ++n, Y = 1000 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => { e.line(`h${k}`, { id: `a${k}`, layer: 'layer-1', position: { x: 0, y: Y } }, { id: `b${k}`, layer: 'layer-1', position: { x: 100, y: Y } }); e.line(`v${k}`, `b${k}`, { id: `c${k}`, layer: 'layer-1', position: { x: 100, y: Y + 100 } }) })
    bench().refresh()
  })
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true })) })
  await act(async () => { svg.dispatchEvent(pe('pointerdown', 50, Y, 1)); window.dispatchEvent(pe('pointerup', 50, Y, 0)) })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  await act(async () => { button('四角/曲边').click() })
  const count = (sel: string) => host.querySelectorAll(sel).length
  const corner = (i: number) => bench().ix.preview().deform!.frame.corners[i]!
  return { host, svg, k, Y, button, count, corner }
}

describe('the 四角/曲边 tool in the bench', () => {
  it('the frame over the selection: 4 corners, 8 handles, 4 midpoints, 4 edges; the readout and its two buttons', async () => {
    const t = await setup()
    expect([t.count('[data-deform-corner]'), t.count('[data-deform-handle]'), t.count('[data-deform-midpoint]'), t.count('[data-deform-edge]')]).toEqual([4, 8, 4, 4])
    expect(t.host.querySelector('[data-testid="deform-error"]')!.textContent).toBe('约束前采样拟合误差 0.000')
    expect([!!t.host.querySelector('[data-testid="deform-reset"]'), !!t.host.querySelector('[data-testid="deform-done"]')]).toEqual([true, true])
  })

  it('a corner dragged on the canvas: one commit, the curve follows, Undo puts it back; 完成 removes the frame', async () => {
    const t = await setup(), start = save(bench().core), c = t.corner(2)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', c.x, c.y, 1)); window.dispatchEvent(pe('pointermove', c.x + 20, c.y + 10, 1)) })
    expect(t.count('[data-deform-ghost]')).toBe(2) // the preview of the release
    expect(save(bench().core)).toBe(start)
    await act(async () => { window.dispatchEvent(pe('pointerup', c.x + 20, c.y + 10, 0)) })
    expect(save(bench().core)).not.toBe(start)
    expect(bench().core.snapshot().points.find(p => p.id === `c${t.k}`)!.position).not.toEqual({ x: 100, y: t.Y + 100 })
    expect(t.corner(2)).toEqual({ x: c.x + 20, y: c.y + 10 })
    await act(async () => { t.button('Undo').click() })
    expect(save(bench().core)).toBe(start)
    expect(t.count('[data-deform-corner]')).toBe(0) // the undo ended the session
    await act(async () => { t.button('四角/曲边').click() })
    await act(async () => { t.button('完成').click() })
    expect(t.count('[data-deform-corner]')).toBe(0)
  })

  it('重置变形框 after a drag: the original curves back, the frame back on the rest rect', async () => {
    const t = await setup(), start = bench().core.snapshot().points, rest = [0, 1, 2, 3].map(t.corner), c = t.corner(0)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', c.x, c.y, 1)); window.dispatchEvent(pe('pointermove', c.x - 15, c.y + 5, 1)); window.dispatchEvent(pe('pointerup', c.x - 15, c.y + 5, 0)) })
    expect(bench().core.snapshot().points).not.toEqual(start)
    await act(async () => { t.button('重置变形框').click() })
    expect(bench().core.snapshot().points).toEqual(start)
    expect([0, 1, 2, 3].map(t.corner)).toEqual(rest)
  })
})
