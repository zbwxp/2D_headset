// Dragging rows in the layers panel (bowen 1791865224: "common sense", as in Adobe's panel): the half of
// the row under the cursor says above / below, shown by a line; a curve dropped on a layer's row goes into
// that layer. Real App, real Core; jsdom drag events (rows have zero size, so clientY < 0 is the upper half).
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt

type B = { core: Core; refresh(): void; scope(): { layer: string; layers: string[] } }
const bench = () => (window as unknown as { bench: B }).bench
const snap = () => bench().core.snapshot()

/** Layers bottom → top A, B, C, D; A holds three separate lines a1, a2, a3, the others one line each. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<App />) })
  const d = Core.newDocument()
  d.edit(e => {
    for (const [i, L] of ['A', 'B', 'C', 'D'].entries()) {
      e.layer(L, L)
      const n = L === 'A' ? 3 : 1
      for (let k = 1; k <= n; k++) e.line(`${L.toLowerCase()}${k}`, { id: `p${L}${k}`, layer: L, position: { x: 0, y: 40 * i + 10 * k } }, { id: `q${L}${k}`, layer: L, position: { x: 100, y: 40 * i + 10 * k } })
    }
  })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
  await act(async () => { ([...host.querySelectorAll('svg title')].find(x => x.textContent === '展开全部图层')!.parentElement!).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  return host
}
const layers = () => snap().layers.map(l => l.id).filter(id => id !== 'layer-1') // the new document's empty layer, at the bottom
const groupOf = (line: string) => snap().groups.find(g => g.lines.includes(line))!.id
/** Each layer's groups bottom → top, by their first line. */
const groups = (layer: string) => snap().groups.filter(g => g.layer === layer).map(g => g.lines[0])
const layerRow = (host: HTMLElement, id: string) => host.querySelector(`[data-layer-row="${id}"]`) as HTMLElement
const groupRow = (host: HTMLElement, line: string) => host.querySelector(`[data-group-row="${groupOf(line)}"]`) as HTMLElement
const fire = (el: HTMLElement, type: string, clientY = 0) => act(async () => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })) })
/** Drag `from` over `to` (upper or lower half), check the insertion mark, drop. */
async function dragTo(from: HTMLElement, to: () => HTMLElement, half: 'above' | 'below' | 'into') {
  await fire(from, 'dragstart')
  await fire(to(), 'dragover', half === 'above' ? -1 : 1)
  const mark = to().dataset.drop
  await fire(to(), 'drop')
  await fire(from, 'dragend')
  return mark
}
const undo = (host: HTMLElement) => act(async () => { ([...host.querySelectorAll('button')].find(b => b.textContent === 'Undo') as HTMLButtonElement).click() })

describe('layers panel drag (bowen 1791865224)', () => {
  it('a layer dropped on the upper half of a row goes above it, on the lower half below; the line shows where; undo restores', async () => {
    const host = await setup()
    expect(await dragTo(layerRow(host, 'A'), () => layerRow(host, 'D'), 'above')).toBe('above')
    expect(layers()).toEqual(['B', 'C', 'D', 'A'])
    expect(host.querySelector('[data-drop]')).toBeNull() // the line goes when the drag ends
    expect(await dragTo(layerRow(host, 'A'), () => layerRow(host, 'B'), 'below')).toBe('below')
    expect(layers()).toEqual(['A', 'B', 'C', 'D'])
    expect(await dragTo(layerRow(host, 'D'), () => layerRow(host, 'B'), 'above')).toBe('above')
    expect(layers()).toEqual(['A', 'B', 'D', 'C'])
    await undo(host)
    expect(layers()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a drop that changes nothing makes no edit; a layer over itself shows no line', async () => {
    const host = await setup()
    const undoable = bench().core.canUndo
    expect(await dragTo(layerRow(host, 'B'), () => layerRow(host, 'A'), 'above')).toBe('above') // already just above A
    expect(await dragTo(layerRow(host, 'B'), () => layerRow(host, 'B'), 'above')).toBeUndefined()
    expect(layers()).toEqual(['A', 'B', 'C', 'D'])
    expect(bench().core.canUndo).toBe(undoable)
  })

  it('curves are listed top first, like the layers, and drag within their layer', async () => {
    const host = await setup()
    expect(groups('A')).toEqual(['a1', 'a2', 'a3'])
    const rows = [...layerRow(host, 'A').parentElement!.querySelectorAll('[data-group-row]')].map(r => r.getAttribute('data-group-row'))
    expect(rows).toEqual(['a3', 'a2', 'a1'].map(groupOf))
    expect(await dragTo(groupRow(host, 'a1'), () => groupRow(host, 'a3'), 'above')).toBe('above')
    expect(groups('A')).toEqual(['a2', 'a3', 'a1'])
    expect(await dragTo(groupRow(host, 'a1'), () => groupRow(host, 'a2'), 'below')).toBe('below')
    expect(groups('A')).toEqual(['a1', 'a2', 'a3'])
  })

  it('a curve dropped on another layer\'s row goes into it, on top; onto a curve of another layer, beside that curve', async () => {
    const host = await setup()
    expect(await dragTo(groupRow(host, 'a2'), () => layerRow(host, 'C'), 'into')).toBe('into')
    expect(groups('C')).toEqual(['c1', 'a2'])
    expect(groups('A')).toEqual(['a1', 'a3'])
    expect(await dragTo(groupRow(host, 'a3'), () => groupRow(host, 'c1'), 'below')).toBe('below')
    expect(groups('C')).toEqual(['a3', 'c1', 'a2'])
    await undo(host)
    expect(groups('A')).toEqual(['a1', 'a3'])
    expect(groups('C')).toEqual(['c1', 'a2'])
  })

  it('a curve over its own layer\'s row, or a layer over a curve, shows nothing and drops nothing', async () => {
    const host = await setup()
    expect(await dragTo(groupRow(host, 'a1'), () => layerRow(host, 'A'), 'into')).toBeUndefined()
    expect(await dragTo(layerRow(host, 'B'), () => groupRow(host, 'a1'), 'above')).toBeUndefined()
    expect(layers()).toEqual(['A', 'B', 'C', 'D'])
    expect(groups('A')).toEqual(['a1', 'a2', 'a3'])
  })

  it('over a place to drop, then back over no place: the mark goes and the release moves nothing (dot 1791865974)', async () => {
    const host = await setup()
    const undoable = bench().core.canUndo
    const back = async (from: HTMLElement, via: () => HTMLElement, home: () => HTMLElement, y: number) => {
      await fire(from, 'dragstart')
      await fire(via(), 'dragover', y)
      expect(via().dataset.drop).toBeDefined()
      await fire(home(), 'dragover', y)
      expect(host.querySelector('[data-drop]')).toBeNull()
      await fire(home(), 'drop')
      await fire(from, 'dragend')
    }
    await back(layerRow(host, 'A'), () => layerRow(host, 'D'), () => layerRow(host, 'A'), -1)
    await back(groupRow(host, 'a1'), () => layerRow(host, 'C'), () => layerRow(host, 'A'), 1)
    await back(groupRow(host, 'a1'), () => groupRow(host, 'a3'), () => groupRow(host, 'a1'), -1)
    expect(layers()).toEqual(['A', 'B', 'C', 'D'])
    expect(groups('A')).toEqual(['a1', 'a2', 'a3'])
    expect(groups('C')).toEqual(['c1'])
    expect(bench().core.canUndo).toBe(undoable)
  })

  it('the canvas paints in the panel\'s order: a layer or curve dragged up is drawn over those below it, its fill with it (dot 1791866043)', async () => {
    const host = await setup()
    // B's line closed into a filled triangle
    await act(async () => {
      bench().core.edit(e => { e.line('b2', 'qB1', { id: 'rB', layer: 'B', position: { x: 50, y: 120 } }); e.line('b3', 'rB', 'pB1') })
      const loops = snap().loops
      bench().core.edit(e => loops.forEach(l => e.fill(l.id, 'red')))
      bench().refresh()
    })
    expect(snap().loops.filter(l => l.filled)).toHaveLength(1)
    const painted = () => [...host.querySelectorAll('[data-paint-group]')].map(el => [...snap().groups.find(g => g.id === el.getAttribute('data-paint-group'))!.lines].sort()[0])
    expect(painted()).toEqual(['a1', 'a2', 'a3', 'b1', 'c1', 'd1'])
    const bPaint = () => host.querySelector(`[data-paint-group="${groupOf('b1')}"]`)!
    expect(bPaint().firstElementChild!.hasAttribute('data-fill')).toBe(true) // the fill under its own lines
    expect(bPaint().children.length).toBeGreaterThan(1)
    await dragTo(layerRow(host, 'B'), () => layerRow(host, 'D'), 'above')
    expect(painted()).toEqual(['a1', 'a2', 'a3', 'c1', 'd1', 'b1'])
    await dragTo(groupRow(host, 'a1'), () => groupRow(host, 'a3'), 'above')
    expect(painted()).toEqual(['a2', 'a3', 'a1', 'c1', 'd1', 'b1'])
    await dragTo(groupRow(host, 'a2'), () => groupRow(host, 'b1'), 'above')
    expect(painted()).toEqual(['a3', 'a1', 'c1', 'd1', 'b1', 'a2'])
  })

  // dot 1791866486: an arc's or a cusp tip's own piece, and the arc's centre line with the ink off, go with their curve
  async function overFill(mode: 'cusp' | 'arc') {
    const host = await setup()
    await act(async () => {
      bench().core.edit(e => {
        // A (bottom): a big filled triangle under D's corner
        e.line('a4', 'qA1', { id: 'rA', layer: 'A', position: { x: 50, y: 300 } }); e.line('a5', 'rA', 'pA1')
        // D (top): a corner at qD1 over it, joined
        e.line('d2', 'qD1', { id: 'rD', layer: 'D', position: { x: 20, y: 200 } })
        e.join('qD1', 'd1', 'd2', mode === 'arc' ? { mode, radius: 10 } : { mode })
      })
      const loops = snap().loops
      bench().core.edit(e => loops.forEach(l => e.fill(l.id, 'red')))
      bench().refresh()
    })
    expect(snap().loops.filter(l => l.filled)).toHaveLength(1)
    const inGroup = (line: string, sel: string) => !!host.querySelector(`[data-paint-group="${groupOf(line)}"] ${sel}`)
    return { host, inGroup }
  }
  it('a cusp tip on the upper curve with one side selected is painted with that curve', async () => {
    const { inGroup } = await overFill('cusp')
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: 'd1' }])); bench().refresh() })
    expect(inGroup('d1', '[data-ink^="tip:"]')).toBe(true)
    expect(inGroup('a1', '[data-ink^="tip:"]')).toBe(false)
  })
  it('with the ink off, an arc\'s centre line is painted with its curve, over the lower fill', async () => {
    const { host, inGroup } = await overFill('arc')
    const toggle = host.querySelector('[data-testid="ink-outline"]') as HTMLInputElement
    if (toggle.checked) await act(async () => { toggle.click() })
    expect(inGroup('d1', 'path[stroke="#a50"]')).toBe(true)
    expect(inGroup('a1', 'path[stroke="#a50"]')).toBe(false)
    expect(host.querySelectorAll('path[stroke="#a50"]')).toHaveLength(1)
  })

  it('a drop on a row other than the marked one moves nothing', async () => {
    const host = await setup()
    await fire(layerRow(host, 'A'), 'dragstart')
    await fire(layerRow(host, 'D'), 'dragover', -1)
    await fire(layerRow(host, 'B'), 'drop') // no dragover reached B first
    await fire(layerRow(host, 'A'), 'dragend')
    expect(layers()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('Shift in the list runs across layers: the rows shown between the two clicks, their layers added to the selected ones (bowen 1791897991)', async () => {
    const host = await setup()
    const name = (line: string) => host.querySelector(`[data-group-row="${groupOf(line)}"] [title^="点击选中这条连续曲线"]`) as HTMLElement
    await act(async () => { name('a1').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { name('c1').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })) })
    const lines = snap().selection.flatMap(u => (u.kind === 'line' ? [u.id] : [])).sort()
    expect(lines).toEqual(['a1', 'a2', 'a3', 'b1', 'c1']) // shown top first: D d1, C c1, B b1, A a3 a2 a1
    expect(bench().scope().layers).toEqual(expect.arrayContaining(['A', 'B', 'C'])) // (D, the current layer at opening, stays selected)
  })
})
