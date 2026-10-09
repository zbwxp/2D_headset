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
  const root = createRoot(host)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('svg')!
  // jsdom has no layout: give the canvas an identity mapping, one screen pixel = one document unit
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().core.edit(e => e.line(`h${k}`, { id: `a${k}`, layer: 'layer-1', position: { x: 0, y: 200 * k } }, { id: `b${k}`, layer: 'layer-1', position: { x: 100, y: 200 * k } }))
    bench().ix.setTool('V'); bench().refresh()
  })
  return { svg, k, root }
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

describe('a drag’s release: what must not commit (dot 1791552536)', () => {
  it('another pointer’s release or move does nothing to this drag', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1, 1))
      window.dispatchEvent(pe('pointerup', 90, 200 * k + 90, 0, 7))
      window.dispatchEvent(pe('pointermove', 90, 200 * k + 90, 0, 7))
    })
    expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k })
    await act(async () => { window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0, 1)) })
    expect(at(`a${k}`)).toEqual({ x: 20, y: 200 * k + 30 })
  })

  it('after Esc, a later release or a move with no button held commits nothing', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      window.dispatchEvent(pe('pointermove', 65, 200 * k + 25, 0))
      window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0))
    })
    expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k })
  })

  it('after leaving the window, a later release commits nothing', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0))
    })
    expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k })
  })

  it('a new press ends the old gesture’s tracking: two drags in a row each commit once', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k, 1))
      svg.dispatchEvent(pe('pointerdown', 60, 200 * k, 1)) // a second press before any release was seen
      window.dispatchEvent(pe('pointerup', 70, 200 * k, 0))
    })
    // the first gesture's tracking was stopped by the second press, so one release makes one move
    expect(at(`a${k}`)).toEqual({ x: 10, y: 200 * k })
  })
})

describe('window tracking: start, end and unmount in one place (dot 1791552771)', () => {
  it('another pointer’s press during a drag is ignored; the drag still commits on its own release', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1, 1))
      svg.dispatchEvent(pe('pointerdown', 300, 200 * k + 150, 1, 2)) // a second finger / pen
      window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0, 1))
    })
    expect(at(`a${k}`)).toEqual({ x: 20, y: 200 * k + 30 })
  })

  it('Esc during a pan ends it: later moves do not pan', async () => {
    const { svg } = await setup()
    const vb = () => svg.getAttribute('viewBox')
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 700, -250, 1)) }) // empty space: a pan
    await act(async () => { window.dispatchEvent(pe('pointermove', 690, -250, 1)) })
    const panned = vb()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      window.dispatchEvent(pe('pointermove', 600, -200, 1))
    })
    expect(vb()).toBe(panned)
  })

  it('a move without the starting button held is the release, even with another button down', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
      window.dispatchEvent(pe('pointermove', 62, 200 * k + 22, 2)) // left up, right down
      window.dispatchEvent(pe('pointermove', 90, 200 * k + 90, 2))
    })
    expect(at(`a${k}`)).toEqual({ x: 12, y: 200 * k + 22 })
  })

  it('unmounting removes the window listeners: a later release does nothing', async () => {
    const { svg, k, root } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
    })
    const core = bench().core
    await act(async () => { root.unmount() })
    // a listener left behind would run on a gone canvas and throw inside the event
    const errors: unknown[] = [], onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault() }
    window.addEventListener('error', onError)
    await act(async () => { window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0)) })
    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
    expect(core.snapshot().points.find(p => p.id === `a${k}`)!.position).toEqual({ x: 0, y: 200 * k })
  })
})

describe('one way to end a gesture: stop the tracking and end the drag or pan (dot 1791552803)', () => {
  const ixOf = () => (window as unknown as { bench: { ix: { preview(): { drag?: unknown } } } }).bench.ix
  it('a right click during a pan ends the pan: later moves do not pan', async () => {
    const { svg } = await setup()
    const vb = () => svg.getAttribute('viewBox')
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 700, -250, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', 690, -250, 1)) })
    const panned = vb()
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
      window.dispatchEvent(pe('pointermove', 600, -200, 1))
    })
    expect(vb()).toBe(panned)
  })

  it('a middle-button pan started before the old drag ended clears the old drag: no ghost left, nothing moved', async () => {
    const { svg, k } = await setup()
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * k + 20, 1))
    })
    expect(ixOf().preview().drag).toBeDefined()
    const middle = new MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 0, button: 1, buttons: 4 })
    Object.defineProperty(middle, 'pointerId', { value: 1 })
    await act(async () => { svg.dispatchEvent(middle) })
    expect(ixOf().preview().drag).toBeUndefined()
    await act(async () => { window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0)) })
    expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k })
  })
})


describe('one right click or Esc cancels one thing (dot 1791553129)', () => {
  type Ix = { cut(): void; preview(): { drag?: unknown; cut: unknown[] } }
  const ix = () => (window as unknown as { bench: { ix: Ix } }).bench.ix
  const rightClick = (svg: Element) => svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  /** Cut the line (it turns grey, pending), then start dragging it. */
  async function cutThenDrag() {
    const s = await setup()
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: `h${s.k}` }])); ix().cut() })
    expect(ix().preview().cut.length).toBe(1)
    await act(async () => {
      s.svg.dispatchEvent(pe('pointerdown', 50, 200 * s.k, 1))
      window.dispatchEvent(pe('pointermove', 60, 200 * s.k + 20, 1))
    })
    expect(ix().preview().drag).toBeTruthy()
    return s
  }
  for (const [name, cancelOnce] of [['right click', (svg: Element) => rightClick(svg)], ['Esc', () => esc()]] as const) {
    it(`cut, drag, ${name}: only the drag is cancelled, the pending cut stays; a second ${name} clears the cut`, async () => {
      const { svg, k } = await cutThenDrag()
      await act(async () => { cancelOnce(svg) })
      expect([!!ix().preview().drag, ix().preview().cut.length]).toEqual([false, 1])
      await act(async () => { window.dispatchEvent(pe('pointerup', 70, 200 * k + 30, 0)) })
      expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k })
      await act(async () => { cancelOnce(svg) })
      expect(ix().preview().cut.length).toBe(0)
    })
  }
})
