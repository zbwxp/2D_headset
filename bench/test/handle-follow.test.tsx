// Handle follow and Straight in the bench (docs/handle-follow-checklist.md §3): the switch, the drag ghost equals the
// release, S straightens the selection, S typed in a field is only typing.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type Ix = { options(): { follow: boolean } }
const bench = () => (window as unknown as { bench: { core: Core; ix: Ix; refresh(): void; chooseView(k: string): void } }).bench
const pe = (type: string, x: number, y: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
const key = (k: string, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
let n = 0

async function setup() {
  const k = ++n, Y = 1000 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`l${k}`, { id: `a${k}`, layer: 'layer-1', position: { x: 0, y: Y } }, { id: `b${k}`, layer: 'layer-1', position: { x: 100, y: Y } }, { ha: { x: 30, y: -20 }, hb: { x: -30, y: -20 } }))
    bench().refresh()
  })
  const line = () => bench().core.snapshot().lines.find(l => l.id === `l${k}`)!
  return { host, svg, k, Y, line }
}

describe('handle follow in the bench', () => {
  it('the switch is on by default and turns the option off', async () => {
    const t = await setup(), box = t.host.querySelector('[data-testid="handle-follow"]') as HTMLInputElement
    expect([box.checked, bench().ix.options().follow]).toEqual([true, true])
    await act(async () => { box.click() })
    expect(bench().ix.options().follow).toBe(false)
  })

  it('an A drag of an end: the ghost shows the followed handles, the release writes the same curve', async () => {
    const t = await setup()
    await act(async () => { key('a') })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 0, t.Y, 1)); window.dispatchEvent(pe('pointermove', 20, t.Y + 30, 1)) })
    const ghost = t.host.querySelector('[data-drag-ghost]')!.getAttribute('d')
    await act(async () => { window.dispatchEvent(pe('pointerup', 20, t.Y + 30, 0)) })
    const l = t.line(), a = { x: 20, y: t.Y + 30 }, b = { x: 100, y: t.Y }
    const nums = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(m => Number(m[0]))
    const expected = [a.x, a.y, a.x + l.ha.x, a.y + l.ha.y, b.x + l.hb.x, b.y + l.hb.y, b.x, b.y]
    nums(ghost!).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 4))
    expect(l.ha).not.toEqual({ x: 30, y: -20 }) // it followed
  })

  it('S straightens the selected line; S typed in a field only types', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: `l${t.k}` }])); bench().refresh() })
    const field = [...t.host.querySelectorAll('input')].find(i => !['file', 'checkbox', 'radio', 'range', 'color'].includes(i.type))!
    await act(async () => { field.focus(); key('s', field) })
    expect(t.line().ha).toEqual({ x: 30, y: -20 })
    await act(async () => { field.blur(); key('s') })
    expect([t.line().ha, t.line().hb]).toEqual([{ x: 100 / 3, y: 0 }, { x: -100 / 3, y: -0 }])
  })
})
