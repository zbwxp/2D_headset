// The selection box in the bench (docs/selection-box-plan.md): drawn with V / A and a selection, not in playback
// or with Move picture; the cursor follows hover by the same rule as a press; dragging its inside moves the
// selection in one undo step.
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
const bench = () => (window as unknown as { bench: { core: Core; refresh(): void; chooseView(k: string): void } }).bench
const pe = (type: string, x: number, y: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
let n = 0

/** An L-shaped curve (0, Y)–(100, Y)–(100, Y + 100), selected with V; Y apart for each test. */
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
  const pos = (id: string) => bench().core.snapshot().points.find(p => p.id === id)!.position
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  return { host, svg, k, Y, pos, button }
}

describe('the selection box in the bench', () => {
  it('drawn with V and a selection; not in playback; not with Move picture', async () => {
    const t = await setup()
    expect(t.host.querySelectorAll('[data-selection-box] [data-box-handle]').length).toBe(9)
    await act(async () => { t.button('Playback').click() })
    expect(t.host.querySelector('[data-selection-box]')).toBeNull()
    await act(async () => { t.button('Leave playback').click() })
    await act(async () => { (t.host.querySelector('[data-testid="move-picture"]') as HTMLInputElement).click() })
    expect(t.host.querySelector('[data-selection-box]')).toBeNull()
    // and not hit: a drag from where the corner was moves nothing of the selection
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 100, t.Y + 100, 1)); window.dispatchEvent(pe('pointermove', 150, t.Y + 150, 1)); window.dispatchEvent(pe('pointerup', 150, t.Y + 150, 0)) })
    expect(t.pos(`c${t.k}`)).toEqual({ x: 100, y: t.Y + 100 })
  })

  it('the cursor follows hover by the press\'s rule: a corner, an edge, the inside, the rotation handle', async () => {
    const t = await setup()
    const hover = async (x: number, y: number) => { await act(async () => { t.svg.dispatchEvent(pe('pointermove', x, y, 0)) }); return t.svg.style.cursor }
    expect(await hover(100, t.Y + 100)).toBe('nwse-resize')
    expect(await hover(100, t.Y + 50)).toBe('ew-resize')
    expect(await hover(40, t.Y + 60)).toBe('move')
    const rot = t.host.querySelector('[data-box-handle="rotate"]')!
    expect(await hover(Number(rot.getAttribute('cx')), Number(rot.getAttribute('cy')))).toContain('data:image/svg+xml')
  })

  it('dragging the inside moves the whole selection in one undo step; a corner drag scales it in one', async () => {
    const t = await setup()
    const before = save(bench().core)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 40, t.Y + 60, 1)); window.dispatchEvent(pe('pointermove', 50, t.Y + 70, 1)); window.dispatchEvent(pe('pointerup', 50, t.Y + 70, 0)) })
    expect([t.pos(`a${t.k}`), t.pos(`c${t.k}`)]).toEqual([{ x: 10, y: t.Y + 10 }, { x: 110, y: t.Y + 110 }])
    await act(async () => { t.button('Undo').click() })
    expect(save(bench().core)).toBe(before)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 100, t.Y + 100, 1)); window.dispatchEvent(pe('pointermove', 150, t.Y + 150, 1)) })
    expect(t.host.querySelectorAll('[data-transform-ghost]').length).toBe(2)
    expect(save(bench().core)).toBe(before)
    await act(async () => { window.dispatchEvent(pe('pointerup', 150, t.Y + 150, 0)) })
    expect(t.pos(`c${t.k}`)).toEqual({ x: 150, y: t.Y + 150 })
    await act(async () => { t.button('Undo').click() })
    expect(save(bench().core)).toBe(before)
  })

  it('the status line never wraps, so selecting cannot resize the canvas between a press and its release', async () => {
    const t = await setup()
    const st = (t.host.querySelector('[data-testid="status"]') as HTMLElement).style
    expect([st.whiteSpace, st.height, st.overflow]).toEqual(['nowrap', '18px', 'hidden'])
    expect((t.host.querySelector('[data-testid="status"]')!.parentElement as HTMLElement).style.minWidth).toBe('0')
  })

  it('one box, one extent: with V the selection box; with Move picture or the pen the same frame without handles (dot 1791737043, 1791737260)', async () => {
    const t = await setup()
    const frame = (sel: string) => { const r = t.host.querySelector(sel)!; return ['x', 'y', 'width', 'height'].map(a => Number(r.getAttribute(a))) }
    expect([!!t.host.querySelector('[data-selection-box]'), !!t.host.querySelector('[data-selection-outline]')]).toEqual([true, false])
    const box = frame('[data-selection-box] rect')
    expect(box).toEqual([0, t.Y, 100, 100])
    await act(async () => { (t.host.querySelector('[data-testid="move-picture"]') as HTMLInputElement).click() })
    expect([!!t.host.querySelector('[data-selection-box]'), frame('[data-selection-outline]')]).toEqual([false, box])
    await act(async () => { (t.host.querySelector('[data-testid="move-picture"]') as HTMLInputElement).click() })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true })) })
    expect([!!t.host.querySelector('[data-selection-box]'), frame('[data-selection-outline]'), t.host.querySelectorAll('[data-box-handle]').length]).toEqual([false, box, 0])
  })

  it('the cursor follows Shift held over the inside with the pointer still: the press would start a marquee, not a move', async () => {
    const t = await setup()
    await act(async () => { t.svg.dispatchEvent(pe('pointermove', 40, t.Y + 60, 0)) })
    expect(t.svg.style.cursor).toBe('move')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true })) })
    expect(t.svg.style.cursor).not.toBe('move')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })) })
    expect(t.svg.style.cursor).toBe('move')
  })

  it('a handle drag draws the moved joins\' arcs too', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => e.join(`b${t.k}`, `h${t.k}`, `v${t.k}`, { mode: 'arc', radius: 10 })); bench().refresh() })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 100, t.Y + 100, 1)); window.dispatchEvent(pe('pointermove', 150, t.Y + 150, 1)) })
    expect(t.host.querySelectorAll('[data-transform-ghost-arc]').length).toBe(1)
    await act(async () => { window.dispatchEvent(pe('pointerup', 150, t.Y + 150, 0)) })
  })
})

