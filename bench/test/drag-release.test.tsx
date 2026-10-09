// A drag commits on release wherever the release is seen (inbox #7; bowen 1791552361): lifting a
// trackpad while moving loses pointer capture before any release reaches the canvas. Real App,
// real Core, real interaction; jsdom events.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Core } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no layout and no DOMPoint: one screen pixel = one document unit
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
type B = { core: Core; ix: { setTool(t: string): void }; refresh(): void }
const bench = () => (window as unknown as { bench: B }).bench

/** A pointer event with the fields the bench reads (jsdom has no PointerEvent). */
function pe(type: string, x: number, y: number, buttons: number, pointerId = 1) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: pointerId })
  return e
}

async function setup() {
  const k = ++n
  const host = document.createElement('div'); document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<App />) })
  const svg = host.querySelector('svg')!
  // jsdom has no layout: give the canvas an identity mapping, one screen pixel = one document unit
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().core.edit(e => e.line(`h${k}`, { id: `a${k}`, layer: 'layer-1', position: { x: 0, y: 200 * k } }, { id: `b${k}`, layer: 'layer-1', position: { x: 100, y: 200 * k } }))
    bench().ix.setTool('V'); bench().refresh()
  })
  return { svg, k }
}
const at = (id: string) => bench().core.snapshot().points.find(p => p.id === id)!.position

describe('a drag’s release', () => {
  it('lost capture, then the release seen on the window: the move commits', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
      svg.dispatchEvent(pe('lostpointercapture', 60, 200 * k + 20, 1)) // the trackpad case
      window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0))
    })
    expect(at(`a${k}`)).toEqual({ x: 20, y: 200 * k + 30 })
  })

  it('a missed release (a move with no button held) commits at that point', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
      window.dispatchEvent(pe('pointermove', 65, 200 * k + 25, 0))
    })
    expect(at(`a${k}`)).toEqual({ x: 15, y: 200 * k + 25 })
  })

  it('pointercancel still cancels: nothing moves', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
      window.dispatchEvent(pe('pointercancel', 60, 200 * k + 20, 0))
      window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0))
    })
    expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k })
  })
})
