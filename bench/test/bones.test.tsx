// 骨骼 in the bench (B2; docs/bone-lines-checklist.md §5; dot 1792300555): mark a bone, 绑骨 by a canvas pick or the
// list, 解绑, highlight without selecting, the drag switch (one transaction, one undo), bones drawn bright and never as
// ink, hidden in playback unless asked; the pick ends with Esc, a tool change, playback and another drawing, and a late
// release never attaches. jsdom only: real mouse checks are listed in the hand-in.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
type B = { core: Core; ix: { setTool(t: string): void; selection(): unknown[] }; refresh(): void; view(): string; chooseView(k: string): void; edit(fn: (e: never) => void): void }
const bench = () => (window as unknown as { bench: B }).bench
const P = (x: number, y = 0) => ({ x, y })

function pe(type: string, x: number, y: number, buttons: number, pointerId = 1, button = 0) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button, buttons })
  Object.defineProperty(e, 'pointerId', { value: pointerId })
  return e
}

/** A bone B (an arch) and the lines up and f, far apart; each test's drawing is placed at its own height. */
let last: { root: ReturnType<typeof createRoot>; host: HTMLElement } | null = null
async function setup() {
  const k = ++n, Y = 400 * k
  // one App at a time: every mounted App listens to the window's keys (an earlier test's App would undo too)
  if (last) { const l = last; await act(async () => { l.root.unmount() }); l.host.remove() }
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  last = { root, host }
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  const id = (s: string) => `${s}${k}`
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => {
      e.line(id('B'), { id: id('b0'), layer: 'layer-1', position: P(0, Y) }, { id: id('b1'), layer: 'layer-1', position: P(40, Y) }, { ha: P(10, -10), hb: P(-10, -10) })
      e.line(id('up'), { id: id('u0'), layer: 'layer-1', position: P(2, Y - 2) }, { id: id('u1'), layer: 'layer-1', position: P(38, Y - 2) }, { ha: P(10, -12), hb: P(-10, -12) })
      e.line(id('f'), { id: id('f0'), layer: 'layer-1', position: P(100, Y) }, { id: id('f1'), layer: 'layer-1', position: P(140, Y) })
    })
    bench().ix.setTool('V'); bench().refresh()
  })
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
  const click = async (sel: string) => { await act(async () => { q(sel)!.click() }) }
  const select = async (...lines: string[]) => { await act(async () => { bench().core.edit(e => (e as unknown as { select(u: unknown[]): void }).select(lines.map(l => ({ kind: 'line', id: l })))); bench().refresh() }) }
  const press = async (x: number, y: number) => { await act(async () => { svg.dispatchEvent(pe('pointerdown', x, y, 1)); window.dispatchEvent(pe('pointerup', x, y, 0)) }) }
  // the arch's middle (t = 0.5): (20, Y − 7.5)
  return { host, svg, k, Y, id, q, click, select, press, boneAt: P(20, Y - 7.5), root }
}
const snap = () => bench().core.snapshot()

describe('bones in the bench', () => {
  it('设为骨骼 marks the selected line; a bone is drawn bright, never as ink', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    expect(snap().bones).toContain(t.id('B'))
    const el = t.q(`[data-bone="${t.id('B')}"]`)!
    expect(['#00c853', '#aa00ff']).toContain(el.getAttribute('stroke'))
    expect(t.q(`[data-ink="${t.id('B')}"]`)).toBeNull()
  })

  it('绑骨 by a canvas pick: the selected line is attached to the bone pressed; the pick ends', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    expect(t.q('[data-testid="bone-pick-hint"]')).not.toBeNull()
    await t.press(t.boneAt.x, t.boneAt.y)
    expect(snap().attachments).toContainEqual({ line: t.id('up'), bone: t.id('B') })
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
  })

  it('绑骨 from the list; 解绑 releases; a bone highlighted never changes the selection', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    const sel = t.q('[data-testid="bone-pick-select"]') as HTMLSelectElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, t.id('B')); sel.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(snap().attachments).toContainEqual({ line: t.id('up'), bone: t.id('B') })
    const before = JSON.stringify(snap().selection)
    await t.click(`[data-bone-hi="${t.id('B')}"]`)
    expect(t.q(`[data-bone-hi-line="${t.id('up')}"]`)).not.toBeNull()
    expect(JSON.stringify(snap().selection)).toBe(before)
    await t.click(`[data-bone-detach="${t.id('up')}"]`)
    expect(snap().attachments.find(a => a.line === t.id('up'))).toBeUndefined()
  })

  it('the pick ends with Esc, a tool change and playback; a late release after Esc attaches nothing', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up'))
    // Esc, then the press's release arriving late
    await t.click('[data-testid="bone-attach"]')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { window.dispatchEvent(pe('pointerup', t.boneAt.x, t.boneAt.y, 0)) })
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
    // the drawing is the page's one drawing (earlier tests' lines are there too): only this test's lines are looked at
    const mine = () => snap().attachments.filter(a => a.line.endsWith(String(t.k)) && a.line.startsWith('up'))
    expect(mine()).toEqual([])
    // a tool change
    await t.click('[data-testid="bone-attach"]')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) })
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
    // playback
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    await act(async () => { button('Leave playback').click() })
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
    expect(mine()).toEqual([])
  })

  it('another drawing opened ends the pick', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    const input = t.q('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([save(Core.newDocument())], 'other.json', { type: 'application/json' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
  })

  it('a batch with one line that cannot be attached (it has a link) attaches none', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => { (e as unknown as { layer(i: string, n: string): void }).layer(`M${t.k}`, `M${t.k}`) }) })
    await act(async () => { bench().core.edit(e => { (e as unknown as { line(...a: unknown[]): void }).line(t.id('m'), { id: t.id('m0'), layer: `M${t.k}`, position: P(100, t.Y + 30) }, { id: t.id('m1'), layer: `M${t.k}`, position: P(110, t.Y + 30) }) }) })
    await act(async () => { bench().core.edit(e => { (e as unknown as { link(a: string, b: string): void }).link(t.id('f0'), t.id('m0')) }); bench().refresh() })
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up'), t.id('f')); await t.click('[data-testid="bone-attach"]')
    await t.press(t.boneAt.x, t.boneAt.y)
    expect(snap().attachments.filter(a => a.line === t.id('up') || a.line === t.id('f'))).toEqual([])
  })

  it('摆放骨骼: a bone dragged at 0,0 moves alone (the lines stay), in one transaction — one undo puts it back', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]'); await t.press(t.boneAt.x, t.boneAt.y)
    await t.click('[data-testid="bone-place"]')
    const up = JSON.stringify(snap().lines.find(l => l.id === t.id('up'))), points = JSON.stringify(snap().points.filter(p => p.id === t.id('u0') || p.id === t.id('u1')))
    const text = save(bench().core)
    // drag the bone's end with A: press, move, release
    await act(async () => { bench().ix.setTool('A'); bench().refresh() })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 40, t.Y, 1)); window.dispatchEvent(pe('pointermove', 46, t.Y + 3, 1)); window.dispatchEvent(pe('pointerup', 46, t.Y + 3, 0)) })
    expect(snap().points.find(p => p.id === t.id('b1'))!.position).toEqual(P(46, t.Y + 3))
    expect(JSON.stringify(snap().lines.find(l => l.id === t.id('up')))).toBe(up)
    expect(JSON.stringify(snap().points.filter(p => p.id === t.id('u0') || p.id === t.id('u1')))).toBe(points)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })) })
    expect(save(bench().core)).toBe(text)
  })

  it('带动线稿 (the default): the same drag carries the line', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]'); await t.press(t.boneAt.x, t.boneAt.y)
    const u1 = snap().points.find(p => p.id === t.id('u1'))!.position
    await act(async () => { bench().ix.setTool('A'); bench().refresh() })
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 40, t.Y, 1)); window.dispatchEvent(pe('pointermove', 46, t.Y + 3, 1)); window.dispatchEvent(pe('pointerup', 46, t.Y + 3, 0)) })
    expect(snap().points.find(p => p.id === t.id('u1'))!.position).not.toEqual(u1)
  })

  it('playback hides bones unless 显示骨骼 is ticked', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    expect(t.q(`[data-bone="${t.id('B')}"]`)).toBeNull()
    expect(t.q('[data-testid="bones-in-playback"]')!.textContent).toBe('显示骨线')
    await t.click('[data-testid="bones-in-playback"]')
    expect(t.q(`[data-bone="${t.id('B')}"]`)).not.toBeNull()
    expect(t.q('[data-testid="bones-in-playback"]')!.textContent).toBe('隐藏骨线')
    // the choice stays for the next playback (bowen 1792472201: checking how bones move)
    await act(async () => { button('Leave playback').click() })
    await act(async () => { button('Playback').click() })
    expect(t.q(`[data-bone="${t.id('B')}"]`)).not.toBeNull()
    await t.click('[data-testid="bones-in-playback"]')
    expect(t.q(`[data-bone="${t.id('B')}"]`)).toBeNull()
    await act(async () => { button('Leave playback').click() })
  })

  it('off the front an attached line says it is generated; dragging it there is refused and nothing changes', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]'); await t.press(t.boneAt.x, t.boneAt.y)
    await act(async () => { bench().chooseView('view:90,0'); bench().ix.setTool('A'); bench().refresh() })
    expect(t.q(`[data-attached-line="${t.id('up')}"] title`)?.textContent).toContain('由骨骼生成')
    const text = save(bench().core)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 38, t.Y - 2, 1)); window.dispatchEvent(pe('pointermove', 30, t.Y - 20, 1)); window.dispatchEvent(pe('pointerup', 30, t.Y - 20, 0)) })
    expect(save(bench().core)).toBe(text)
  })

  it('a bone selected on the canvas highlights its attached lines (as the list does)', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]'); await t.press(t.boneAt.x, t.boneAt.y)
    // the bone in the selection (as a V or A press leaves it; the press itself is covered by the pick tests)
    await t.select(t.id('B'))
    expect(t.q(`[data-bone-hi-line="${t.id('up')}"]`)).not.toBeNull()
    await t.select(t.id('f'))
    expect(t.q(`[data-bone-hi-line="${t.id('up')}"]`)).toBeNull()
  })

  it('a selected bone in playback (显示骨骼 off): no selection halo, no label, no pick — only ticked it shows (dot 1792301388)', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('B'))
    const halo = () => [...t.svg.querySelectorAll('path')].filter(p => p.getAttribute('stroke') === '#2a7fff' && p.getAttribute('stroke-opacity') === '0.3').length
    expect(halo()).toBe(1)
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    expect(t.q(`[data-bone="${t.id('B')}"]`)).toBeNull()
    expect(halo()).toBe(0)
    expect(t.q(`[data-label="${t.id('B')}"]`)).toBeNull()
    await t.click('[data-testid="bones-in-playback"]')
    expect(halo()).toBe(1)
    await act(async () => { button('Leave playback').click() })
  })
  it('from an empty selection, playback with bones hidden: V on the hidden bone picks nothing (dot 1792301418)', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select()
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    await act(async () => { bench().ix.setTool('V'); bench().refresh() })
    await t.press(t.boneAt.x, t.boneAt.y)
    expect(snap().selection.map(u => u.id)).not.toContain(t.id('B'))
    await act(async () => { button('Leave playback').click() })
  })

  it('playback with bones hidden: A reaches neither the bone\'s own end point nor its handle; a point a shown line shares stays reachable (dot 1792301703)', async () => {
    const t = await setup()
    // a short ordinary line from the bone's start b0: that point is shared
    await act(async () => { bench().core.edit(e => { (e as unknown as { line(...a: unknown[]): void }).line(t.id('s'), t.id('b0'), { id: t.id('s1'), layer: 'layer-1', position: P(-30, t.Y) }) }); bench().refresh() })
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('B'))
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    await act(async () => { bench().ix.setTool('A'); bench().refresh() })
    const picked = () => snap().selection.map(u => (u.kind === 'handle' ? `${u.line}:${u.end}` : u.id))
    await t.press(40, t.Y) // b1: the bone's own end
    expect(picked()).not.toContain(t.id('b1'))
    // the a handle's tip in the view: b0 + (10, −10) — a fresh pick from an empty selection
    await t.select()
    await t.press(10, t.Y - 10)
    expect(picked()).not.toContain(`${t.id('B')}:a`)
    await t.press(0, t.Y) // b0: shared with the shown line s
    expect(picked()).toContain(t.id('b0'))
    await act(async () => { button('Leave playback').click() })
    // the shared line hidden too: no shown line uses b0 any more, so it is out of reach as well
    await act(async () => { bench().core.edit(e => { (e as unknown as { lineState(l: string, s: unknown): void }).lineState(t.id('s'), { visible: false }) }); bench().refresh() })
    await t.select()
    await act(async () => { button('Playback').click() })
    await act(async () => { bench().ix.setTool('A'); bench().refresh() })
    await t.press(0, t.Y)
    expect(picked()).not.toContain(t.id('b0'))
    await act(async () => { button('Leave playback').click() })
  })

  it('a bone never takes the pick of an ordinary line away: V on the far line selects it', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await act(async () => { bench().ix.setTool('V'); bench().refresh() })
    await t.press(120, t.Y)
    expect(snap().selection.map(u => u.id)).toEqual([t.id('f')])
  })

  it('绑骨 lists and takes only the bones of the chosen lines\' layer (bowen 1792307973; lines of two layers: the core refuses, bone-layer)', async () => {
    const t = await setup()
    const M = `M${t.k}`
    await act(async () => { bench().core.edit(e => { e.layer(M, `另${t.k}`); e.line(t.id('Z'), { id: t.id('z0'), layer: M, position: P(0, t.Y + 30) }, { id: t.id('z1'), layer: M, position: P(40, t.Y + 30) }, { ha: P(10, -10), hb: P(-10, -10) }) }); bench().refresh() })
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('Z')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    // (earlier tests' bones are in layer-1 too: the page's core is shared) — never the other layer's bone
    const options = [...t.host.querySelectorAll('[data-testid="bone-pick-select"] option')].map(o => (o as HTMLOptionElement).value).filter(Boolean)
    expect(options).toContain(t.id('B'))
    expect(options).not.toContain(t.id('Z'))
    // named 「连续曲线 · 线」 (bowen 1792308208); a curve of one line by the curve's name alone (bowen 1792308645)
    const sn = snap(), gr = sn.groups.find(x => x.lines.includes(t.id('B')))!
    expect(gr.lines.length).toBe(1)
    expect((t.q(`[data-testid="bone-pick-select"] option[value="${t.id('B')}"]`) as HTMLOptionElement).textContent).toBe(gr.name)
    expect(t.q('[data-testid="bone-pick-hint"]')!.textContent).toContain('「Layer 1」')
    // a press on the other layer's bone attaches nothing
    await t.press(20, t.Y + 22.5)
    expect(snap().attachments.some(a => a.line === t.id('up'))).toBe(false)
  })

  it('a 绑骨 pick ends when another layer is chosen or the chosen lines change; nothing is attached afterwards (dot 1792308617)', async () => {
    const t = await setup()
    const M = `M${t.k}`
    await act(async () => { bench().core.edit(e => e.layer(M, `另${t.k}`)); bench().refresh() })
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    expect(t.q('[data-testid="bone-pick-select"]')).not.toBeNull()
    await t.click(`[data-layer-row="${M}"]`)
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
    expect(t.q('[data-testid="bone-pick-select"]')).toBeNull()
    await t.click('[data-layer-row="layer-1"]')
    await t.press(t.boneAt.x, t.boneAt.y)
    expect(snap().attachments.some(a => a.line === t.id('up'))).toBe(false)
    // other lines chosen while picking: the pick ends too
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]')
    await t.select(t.id('f'))
    expect(t.q('[data-testid="bone-pick-hint"]')).toBeNull()
    await t.press(t.boneAt.x, t.boneAt.y)
    expect(snap().attachments.some(a => a.line === t.id('up') || a.line === t.id('f'))).toBe(false)
  })

  it('P0: 语义线跟骨线（试验）, off by default; on, an attached line follows its bone between the views; a collapse is reported for the group', async () => {
    const t = await setup()
    await t.select(t.id('B')); await t.click('[data-testid="bone-mark"]')
    await act(async () => { bench().core.editIn('view:90,0', e => (e as unknown as import('../../src').Editor).move([{ id: t.id('b1'), target: P(30, t.Y + 8) }])); bench().refresh() })
    await t.select(t.id('up')); await t.click('[data-testid="bone-attach"]'); await t.press(t.boneAt.x, t.boneAt.y)
    expect(snap().attachments.some(a => a.line === t.id('up'))).toBe(true)
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    const toggle = t.q('[data-testid="follow-bones"]') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    const pose = { yaw: 30, pitch: 0 }
    const off = JSON.stringify(bench().core.atPose(pose).snapshot().points.find(p => p.id === t.id('u1')))
    const on = JSON.stringify(bench().core.atPose(pose, { followBones: true }).snapshot().points.find(p => p.id === t.id('u1')))
    expect(on).not.toBe(off)
    await act(async () => { toggle.click() })
    expect((t.q('[data-testid="follow-bones"]') as HTMLInputElement).checked).toBe(true)
    // a bone reversed at 90,0: at 45° it collapses; the attached line falls back, marked and named
    await act(async () => { button('Leave playback').click() })
    await act(async () => { bench().core.editIn('view:90,0', e => { const x = e as unknown as import('../../src').Editor; x.move([{ id: t.id('b0'), target: P(40, t.Y) }, { id: t.id('b1'), target: P(0, t.Y) }]); x.moveHandle(t.id('B'), 'a', P(-10, 10)); x.moveHandle(t.id('B'), 'b', P(10, 10)) }); bench().refresh() })
    const fb = bench().core.atPose({ yaw: 45, pitch: 0 }, { followBones: true }).boneFallback()
    expect(fb.map(f => f.lines)).toEqual([[t.id('up')]])
  })

  it('测帧耗时（试验）: one at a time; leaving playback stops it (no pose set afterwards); a full run ends at the starting pose (dot 1792476848)', async () => {
    const t = await setup()
    const button = (label: string) => [...t.host.querySelectorAll('button')].find(x => x.textContent === label)!
    await act(async () => { button('Playback').click() })
    const start = JSON.stringify((bench() as unknown as { pose(): unknown }).pose())
    // a full run
    await act(async () => { (t.q('[data-testid="measure-frames"]') as HTMLButtonElement).click(); await wait(0) })
    expect((t.q('[data-testid="measure-frames"]') as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 400 && !t.q('[data-testid="frame-times"]'); i++) await act(async () => { await wait(20) })
    expect(t.q('[data-testid="frame-times"]')!.textContent).toMatch(/中位数.*p95/)
    expect(JSON.stringify((bench() as unknown as { pose(): unknown }).pose())).toBe(start)
    expect((t.q('[data-testid="measure-frames"]') as HTMLButtonElement).disabled).toBe(false)
    // leaving playback during a run: it stops; nothing sets a pose afterwards
    await act(async () => { (t.q('[data-testid="measure-frames"]') as HTMLButtonElement).click(); await wait(5) })
    await act(async () => { button('Leave playback').click() })
    await act(async () => { await wait(300) })
    expect((bench() as unknown as { pose(): unknown }).pose()).toBeNull()
    // back in playback: the trial switch is as it was before the run (off), the button free again
    await act(async () => { button('Playback').click() })
    expect((t.q('[data-testid="follow-bones"]') as HTMLInputElement).checked).toBe(false)
    expect((t.q('[data-testid="measure-frames"]') as HTMLButtonElement).disabled).toBe(false)
    // left during a run, re-entered at once and the switch turned on: the old run's end never turns it back (dot 1792477359)
    await act(async () => { (t.q('[data-testid="measure-frames"]') as HTMLButtonElement).click(); await wait(5) })
    await act(async () => { button('Leave playback').click() })
    await act(async () => { button('Playback').click() })
    await act(async () => { (t.q('[data-testid="follow-bones"]') as HTMLInputElement).click() })
    await act(async () => { await wait(400) })
    expect((t.q('[data-testid="follow-bones"]') as HTMLInputElement).checked).toBe(true)
    await act(async () => { (t.q('[data-testid="follow-bones"]') as HTMLInputElement).click() })
    // Esc stops a run and puts the starting pose back
    const here = JSON.stringify((bench() as unknown as { pose(): unknown }).pose())
    await act(async () => { (t.q('[data-testid="measure-frames"]') as HTMLButtonElement).click(); await wait(5) })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(300) })
    expect(JSON.stringify((bench() as unknown as { pose(): unknown }).pose())).toBe(here)
    expect((t.q('[data-testid="measure-frames"]') as HTMLButtonElement).disabled).toBe(false)
    // a finished result is the drawing's own: after opening another drawing (below) it is gone (dot 1792477691)
    expect(t.q('[data-testid="frame-times"]')).not.toBeNull()
    // another drawing opened during a run: the run stops and never touches it (dot 1792477020)
    await act(async () => { (t.q('[data-testid="measure-frames"]') as HTMLButtonElement).click(); await wait(5) })
    const other = Core.newDocument(), otherText = save(other)
    const input = t.q('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([otherText], 'other.json', { type: 'application/json' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(400) })
    expect(save(bench().core)).toBe(otherText)
    expect(t.q('[data-testid="frame-times"]')).toBeNull()
    expect((t.q('[data-testid="measure-frames"]') as HTMLButtonElement | null)?.disabled ?? false).toBe(false)
    if (!t.q('[data-testid="measure-frames"]')) await act(async () => { button('Playback').click() })
    // a second click while one runs starts nothing (one at a time)
    await act(async () => { const b = t.q('[data-testid="measure-frames"]') as HTMLButtonElement; b.click(); b.click(); await wait(5) })
    await act(async () => { button('Leave playback').click() })
    await act(async () => { await wait(300) })
    expect((bench() as unknown as { pose(): unknown }).pose()).toBeNull()
  }, 30000)
})
