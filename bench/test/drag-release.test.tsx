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

  it('Esc during a pan ends it and puts the view back (v1); later moves do not pan', async () => {
    const { svg } = await setup()
    const vb = () => svg.getAttribute('viewBox')
    const before = vb()
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 700, -250, 2, 1, 2)) }) // a right-drag pan (bowen 1791554290)
    await act(async () => { window.dispatchEvent(pe('pointermove', 690, -250, 2)) })
    const panned = vb()
    expect(panned).not.toBe(before)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      window.dispatchEvent(pe('pointermove', 600, -200, 2))
    })
    expect(vb()).toBe(before)
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
  it('a right click during a middle-button pan ends it and puts the view back (v1); later moves do not pan', async () => {
    const { svg } = await setup()
    const vb = () => svg.getAttribute('viewBox')
    const before = vb()
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 700, -250, 4, 1, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', 690, -250, 4)) })
    const panned = vb()
    expect(panned).not.toBe(before)
    await act(async () => {
      svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
      window.dispatchEvent(pe('pointermove', 600, -200, 4))
    })
    expect(vb()).toBe(before)
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
  /** A right click as macOS sends it: press, contextmenu, release. During a left drag the press comes only as contextmenu. */
  const rightClick = (svg: Element) => {
    const during = !!ix().preview().drag
    if (!during) svg.dispatchEvent(pe('pointerdown', 5, 5, 2, 1, 2))
    svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    if (!during) window.dispatchEvent(pe('pointerup', 5, 5, 0, 1, 2))
  }
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

describe('A: the handles drawn are the handles that can be picked (bowen 1791553275, 1791553510)', () => {
  type Ix = { preview(): { handles: { line: string; end: 'a' | 'b' }[] } }
  const ix = () => (window as unknown as { bench: { ix: Ix } }).bench.ix
  it('a four-sided curve, one side selected: every handle is drawn, and a neighbour’s drawn handle is picked', async () => {
    const { svg, k } = await setup()
    const y = 200 * k + 60, id = (s: string) => `${s}${k}`
    await act(async () => {
      bench().core.edit(e => {
        const L = 'layer-1'
        e.line(id('s1'), { id: id('p1'), layer: L, position: { x: 300, y } }, { id: id('p2'), layer: L, position: { x: 390, y } })
        e.line(id('s2'), id('p2'), { id: id('p3'), layer: L, position: { x: 390, y: y + 90 } })
        e.line(id('s3'), id('p3'), { id: id('p4'), layer: L, position: { x: 300, y: y + 90 } })
        e.line(id('s4'), id('p4'), id('p1'))
        e.select([{ kind: 'line', id: id('s1') }])
      })
      bench().ix.setTool('A'); bench().refresh()
    })
    const handles = ix().preview().handles
    const visibleInLayer = bench().core.snapshot().lines.filter(l => l.state.visible).length // all on layer-1 here
    expect(handles.length).toBe(2 * visibleInLayer)
    // the view draws one square per shown handle, no more and no fewer
    const squares = [...svg.querySelectorAll('rect')].filter(r => r.getAttribute('stroke') === '#555')
    expect(squares.length).toBe(handles.length)
    const s2 = bench().core.snapshot().lines.find(l => l.id === id('s2'))!
    const at = { x: 390 + s2.ha.x, y: y + s2.ha.y }
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', at.x, at.y, 1))
      window.dispatchEvent(pe('pointerup', at.x, at.y, 0))
    })
    expect(bench().core.snapshot().selection).toEqual([{ kind: 'handle', line: id('s2'), end: 'a' }])
  })
})

describe('the canvas: right-drag pans, Z zooms, a left press on blank space does neither (bowen 1791554290, 1791554415)', () => {
  type Ix = { cut(): void; preview(): { cut: unknown[] } }
  const ix = () => (window as unknown as { bench: { ix: Ix } }).bench.ix
  const box = (svg: Element) => svg.getAttribute('viewBox')!.split(' ').map(Number)
  const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }))

  it('a left drag on blank space clears the selection and does not move the canvas', async () => {
    const { svg, k } = await setup()
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: `h${k}` }])) })
    const before = box(svg)
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 700, -250, 1))
      window.dispatchEvent(pe('pointermove', 600, -150, 1))
      window.dispatchEvent(pe('pointerup', 600, -150, 0))
    })
    expect([box(svg), bench().core.snapshot().selection]).toEqual([before, []])
  })

  it('a right drag pans and cancels nothing; an unmoved right click cancels one level, in either event order', async () => {
    const { svg, k } = await setup()
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: `h${k}` }])); ix().cut() })
    const before = box(svg)
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 700, -250, 2, 1, 2))
      svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })) // macOS: on press
      window.dispatchEvent(pe('pointermove', 650, -250, 2))
      window.dispatchEvent(pe('pointerup', 650, -250, 0, 1, 2))
    })
    expect(box(svg)[0]).not.toBe(before[0])
    expect(ix().preview().cut.length).toBe(1) // the pan cancelled nothing
    await act(async () => { // Windows order: press, release, contextmenu; moved within the click distance
      svg.dispatchEvent(pe('pointerdown', 700, -250, 2, 1, 2))
      window.dispatchEvent(pe('pointermove', 701, -249, 2))
      window.dispatchEvent(pe('pointerup', 701, -249, 0, 1, 2))
      svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    })
    expect(ix().preview().cut.length).toBe(0)
  })

  it('Z: drag up zooms in, drag down zooms out, a click zooms in ×1.3 (v1), each around the press; the drawing is untouched', async () => {
    const { svg, k } = await setup()
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: `h${k}` }])) })
    const doc = bench().core.snapshot(), canUndo = bench().core.canUndo
    await act(async () => { key('z') })
    const zoom = async (dy: number) => {
      await act(async () => {
        svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1)) // on the line: with Z it is not picked
        if (dy) window.dispatchEvent(pe('pointermove', 50, 200 * k + dy, 1))
        window.dispatchEvent(pe('pointerup', 50, 200 * k + dy, 0))
      })
      return box(svg)
    }
    const b0 = box(svg), up = await zoom(-50), down = await zoom(100), click = await zoom(0)
    expect(up[2]).toBeLessThan(b0[2])
    expect(down[2]).toBeGreaterThan(up[2])
    expect(click[2]).toBeCloseTo(down[2] / 1.3)
    // around the press: the pressed document point keeps its place in the view box
    const frac = (b: number[]) => [(50 - b[0]!) / b[2]!, (200 * k - b[1]!) / b[3]!]
    expect(frac(click)[0]).toBeCloseTo(frac(down)[0]!); expect(frac(click)[1]).toBeCloseTo(frac(down)[1]!)
    expect([bench().core.snapshot(), bench().core.canUndo]).toEqual([doc, canUndo])
  })

  it('a tool key leaves Z: the left button goes to the tool again', async () => {
    const { svg, k } = await setup()
    await act(async () => { key('z'); key('v') })
    const before = box(svg)
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 50, 200 * k, 1))
      window.dispatchEvent(pe('pointermove', 50, 200 * k + 30, 1))
      window.dispatchEvent(pe('pointerup', 50, 200 * k + 30, 0))
    })
    expect(box(svg)).toEqual(before)
    expect(at(`a${k}`)).toEqual({ x: 0, y: 200 * k + 30 })
  })
})

describe('Z as in v1 (7205381; bowen 1791554424)', () => {
  const box = (svg: Element) => svg.getAttribute('viewBox')!.split(' ').map(Number)
  it('Alt-click zooms out ×1.3; Esc during a zoom drag puts the view back', async () => {
    const { svg } = await setup()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' })) })
    const b0 = box(svg)
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 300, 300, 1))
      const up = pe('pointerup', 300, 300, 0); Object.defineProperty(up, 'altKey', { value: true }); window.dispatchEvent(up)
    })
    expect(box(svg)[2]).toBeCloseTo(b0[2]! * 1.3)
    const b1 = box(svg)
    await act(async () => {
      svg.dispatchEvent(pe('pointerdown', 300, 300, 1))
      window.dispatchEvent(pe('pointermove', 300, 200, 1))
    })
    expect(box(svg)[2]).toBeLessThan(b1[2]!)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(box(svg)).toEqual(b1)
  })
})
