// 视角背景 (bowen, after 1792058545; dot): beside 「从视角应用」, a button adds another view's lines, drawn in that view's
// colour under the drawing, for reference only — never picked or boxed, no edit, not saved; several views, each removable.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
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

/** One line, moved far away in the side view, so the side view's line lies where the front has nothing. */
async function setup() {
  const k = ++n, Y = 300 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: Y } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: Y } }))
    bench().core.editIn('view:90,0', e => e.move([{ id: `p${k}`, target: { x: 0, y: Y + 150 } }, { id: `q${k}`, target: { x: 100, y: Y + 150 } }]))
    bench().ix.setTool('V'); bench().refresh()
  })
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
  const click = async (sel: string) => { await act(async () => { q(sel)!.click() }) }
  return { host, svg, k, Y, q, click }
}

describe('the view background', () => {
  it('「添加视角背景…」 then a view: that view\'s lines drawn in its colour under the drawing; the current view stays the current one', async () => {
    const t = await setup()
    await t.click('[data-testid="add-view-background"]')
    expect((t.q('[data-view="view:0,0"]') as HTMLButtonElement).disabled).toBe(true) // the current view is not offered
    await t.click('[data-view="view:90,0"]')
    expect(bench().view()).toBe('view:0,0')
    const g = t.q('[data-view-background="view:90,0"]')!
    expect(g.getAttribute('pointer-events')).toBe('none')
    expect(g.getAttribute('stroke')).toBe('#d81b60')
    expect(g.innerHTML).toContain(`M0,${t.Y + 150}`) // the side view's position, not the front's
    // under the drawing: before every ink or line path of the drawing in the canvas
    const all = [...t.svg.querySelectorAll('path')], first = all.findIndex(p => p.closest('[data-view-background]'))
    expect(all.slice(0, first).some(p => p.hasAttribute('data-ink') || p.hasAttribute('data-ink-group'))).toBe(false)
    expect(t.q('[data-view-background-chip="view:90,0"]')).not.toBeNull()
  })

  it('never picked or boxed, never written: a click on a background line selects nothing; a box over it takes nothing; the file is unchanged', async () => {
    const t = await setup()
    const before = save(bench().core)
    await t.click('[data-testid="add-view-background"]'); await t.click('[data-view="view:90,0"]')
    expect(save(bench().core)).toBe(before)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 50, t.Y + 150, 1)); window.dispatchEvent(pe('pointerup', 50, t.Y + 150, 0)) })
    expect(bench().ix.selection()).toEqual([])
    await act(async () => {
      t.svg.dispatchEvent(pe('pointerdown', -20, t.Y + 120, 1)); window.dispatchEvent(pe('pointermove', 130, t.Y + 180, 1)); window.dispatchEvent(pe('pointerup', 130, t.Y + 180, 0))
    })
    expect(bench().ix.selection()).toEqual([])
    expect(save(bench().core)).toBe(before)
  })

  it('several views, each with its own colour, each removable; Esc cancels the pick; switching to a background\'s view does not draw it over itself', async () => {
    const t = await setup()
    await t.click('[data-testid="add-view-background"]'); await t.click('[data-view="view:90,0"]')
    await t.click('[data-testid="add-view-background"]'); await t.click('[data-view="view:0,45"]')
    expect([...t.host.querySelectorAll('[data-view-background]')].map(g => [g.getAttribute('data-view-background'), g.getAttribute('stroke')])).toEqual([['view:90,0', '#d81b60'], ['view:0,45', '#2e86de']])
    await t.click('[data-testid="add-view-background"]')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await t.click('[data-view="view:-90,0"]') // picking ended: this chooses the view
    expect(bench().view()).toBe('view:-90,0')
    await act(async () => { bench().chooseView('view:90,0') })
    expect(t.q('[data-view-background="view:90,0"]')).toBeNull() // its own view: not drawn over itself
    expect(t.q('[data-view-background="view:0,45"]')).not.toBeNull()
    await t.click('[data-remove-view-background="view:0,45"]')
    expect(t.q('[data-view-background="view:0,45"]')).toBeNull()
    expect(t.q('[data-view-background-chip="view:0,45"]')).toBeNull()
    expect(t.q('[data-view-background-chip="view:90,0"]')).not.toBeNull()
  })
})
