// Editing in playback (docs/playback-edit-checklist.md; bowen 1791969415, 1791976386; dot 1791976889): the layer eye in
// playback; A's marks at a correction pose, none with Z or between; A drags a handle, V a whole curve; at a view A edits
// that view; 「刚才改了什么」 names what a write changed; 「删除修正拐点」 removes a correction. Real App, real Core, jsdom.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor, type Vec } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number }; edit(fn: (e: Editor) => unknown): void; log: { calls: string; result: string }[] }
const bench = () => (window as unknown as { bench: B }).bench
function pe(type: string, x: number, y: number, buttons: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}
const key = async (k: string) => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) }) }
const anim = () => JSON.parse(save(bench().core)).document.animation as { points: Record<string, unknown>; handles: Record<string, unknown> }

/**
 * One curve: v<k> p (0, Y) – q (100, Y), w<k> q – r (200, Y), Y = 300k; v's a handle (30, −20) in the front, (10, −40) in
 * the side; q at (60, Y + 30) in the side view.
 */
async function setup() {
  const k = ++n, Y = 300 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => {
      e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: Y } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: Y } }, { ha: { x: 30, y: -20 }, hb: { x: 0, y: 0 } })
      e.line(`w${k}`, `q${k}`, { id: `r${k}`, layer: 'layer-1', position: { x: 200, y: Y } })
    })
    bench().core.editIn('view:90,0', e => { e.move([{ id: `q${k}`, target: { x: 60, y: Y + 30 } }]); e.moveHandle(`v${k}`, 'a', { x: 10, y: -40 }) })
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  const type = async (id: string, v: string) => {
    const el = host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const status = () => host.querySelector('[data-testid="status"]')!.textContent!
  const pose = async (yaw: number, pitch: number) => { await type('yaw-text', String(yaw)); await type('pitch-text', String(pitch)) }
  const play = async (yaw: number, pitch: number, tool = 'a') => { await act(async () => { button('Playback').click() }); await pose(yaw, pitch); await key(tool) }
  const posed = (id: string) => { const p = bench().pose()!; return bench().core.atPose(p).snapshot().points.find(x => x.id === id)!.position }
  const posedLine = (id: string) => { const p = bench().pose()!; return bench().core.atPose(p).snapshot().lines.find(x => x.id === id)! }
  const hover = async (at: Vec) => { await act(async () => { svg.dispatchEvent(pe('pointermove', at.x, at.y, 0)) }) }
  const drag = async (from: Vec, by: Vec) => {
    await act(async () => { svg.dispatchEvent(pe('pointerdown', from.x, from.y, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', from.x + by.x / 2, from.y + by.y / 2, 1)); window.dispatchEvent(pe('pointermove', from.x + by.x, from.y + by.y, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointerup', from.x + by.x, from.y + by.y, 0)) })
  }
  return { host, svg, k, Y, button, type, status, pose, play, posed, posedLine, hover, drag }
}
const near = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6

describe('the gate (§1)', () => {
  it('between the views: the layer eye writes; a lock, a stroke and an empty edit are refused with the call named', async () => {
    const t = await setup()
    await t.play(20, 0)
    await act(async () => { bench().edit(e => e.layerState('layer-1', { visible: false })) })
    expect(bench().log[0]).toMatchObject({ result: 'ok' })
    expect(bench().core.snapshot().lines.find(l => l.id === `v${t.k}`)!.state.visible).toBe(false) // a layer's state is its lines'
    const before = save(bench().core)
    expect(() => bench().edit(e => e.layerState('layer-1', { locked: true }))).toThrow(/read-only-playback: layerState is not allowed/)
    expect(() => bench().edit(e => e.lineStroke(`v${t.k}`, { width: 3, profile: 'uniform' }))).toThrow(/read-only-playback: lineStroke is not allowed/)
    expect(() => bench().edit(() => {})).toThrow(/it called nothing/)
    expect(save(bench().core)).toBe(before)
  })
})

describe('marks and where a drag writes (§2)', () => {
  it('A at a correction pose marks the visible ends; Z hides them; between the views there are none', async () => {
    const t = await setup()
    await t.play(30, 0)
    expect(t.svg.querySelectorAll('[data-pose-point]').length).toBeGreaterThanOrEqual(3)
    await key('z')
    expect(t.svg.querySelectorAll('[data-pose-point]').length).toBe(0)
    await key('a')
    await t.pose(20, 0)
    expect(t.svg.querySelectorAll('[data-pose-point]').length).toBe(0)
  })
})

describe('drags at a correction pose (§2) and what they changed (§3)', () => {
  it('A on the hovered line\'s handle: one correct of that handle; the panel names it', async () => {
    const t = await setup(), v = `v${t.k}`
    await t.play(30, 0)
    const l = t.posedLine(v), p = t.posed(`p${t.k}`), tip = { x: p.x + l.ha.x, y: p.y + l.ha.y }
    await t.hover({ x: p.x + 0.5 * l.ha.x + 5, y: p.y + 0.5 * l.ha.y + 1 }) // on the line near its start
    expect(t.svg.querySelector(`[data-pose-handle="${v}:a"]`)).not.toBeNull()
    await t.drag(tip, { x: 6, y: -4 })
    expect(bench().log[0]!.calls).toMatch(/^correct\(.*handles/)
    expect(near(t.posedLine(v).ha, { x: l.ha.x + 6, y: l.ha.y - 4 })).toBe(true)
    expect(t.host.querySelector('[data-testid="last-change"]')!.textContent).toMatch(/a 端手柄 · 0,0 → 90,0 · t 0\.333 · x 加修正/)
  })

  it('V on a line: its whole curve moves; one correct with every end point', async () => {
    const t = await setup(), k = t.k
    await t.play(30, 0, 'v')
    const ps = [`p${k}`, `q${k}`, `r${k}`].map(id => t.posed(id)), q = ps[1]!, r = ps[2]!
    await t.drag({ x: (q.x + r.x) / 2, y: (q.y + r.y) / 2 }, { x: 10, y: 5 })
    expect(bench().log[0]!.calls).toMatch(/^correct\(/)
    expect([`p${k}`, `q${k}`, `r${k}`].map((id, i) => near(t.posed(id), { x: ps[i]!.x + 10, y: ps[i]!.y + 5 }))).toEqual([true, true, true])
  })

  it('the corrections here are listed and ringed; 「删除修正拐点」 removes one, and the panel says so', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(30, 0)
    await t.drag(t.posed(q), { x: 5, y: 5 })
    expect(t.svg.querySelector(`[data-corrected-here="${q}"]`)).not.toBeNull()
    const row = t.host.querySelector(`[data-correction="${q}"]`)!
    await act(async () => { (row.querySelector('button') as HTMLButtonElement).click() })
    expect(bench().log[0]!.calls).toMatch(/^uncorrect\(/)
    expect(anim().points[q]).toBeUndefined()
    expect(t.svg.querySelector(`[data-corrected-here="${q}"]`)).toBeNull()
    expect(t.host.querySelector('[data-testid="last-change"]')!.textContent).toContain('删除修正拐点')
  })
})

describe('at a view (§2)', () => {
  it('A at view 90,0 edits that view itself: the point moves there, by an ordinary translate; no knot', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(90, 0)
    expect(t.status()).toContain('视角 view:90,0')
    const at = bench().core.in('view:90,0').snapshot().points.find(p => p.id === q)!.position
    await t.drag(at, { x: 7, y: 3 })
    expect(bench().core.in('view:90,0').snapshot().points.find(p => p.id === q)!.position).toEqual({ x: at.x + 7, y: at.y + 3 })
    expect(bench().log.some(r => /translate\(/.test(r.calls) && r.result === 'ok')).toBe(true)
    expect(anim().points[q]).toBeUndefined()
  })
})

describe('playback pictures (§5; bowen 1791970202)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  it('placed in playback, drawn and listed there at every pose, never in a view; Move picture drags it; a view picture is refused', async () => {
    const t = await setup(), id = `pb${t.k}`
    await t.play(20, 0)
    await act(async () => { bench().edit(e => { const asset = e.addAsset({ id: `as${t.k}`, name: 'sheet', src: PNG, width: 40, height: 20 }); e.placeReference({ id, view: 'playback', asset, x: 50, y: t.Y, scale: 1, angle: 0, opacity: 0.5, visible: true }) }); bench().refresh() })
    expect(t.svg.querySelector(`[data-reference="${id}"]`)).not.toBeNull()
    expect(t.host.querySelector(`[data-ref="${id}"]`)).not.toBeNull()
    await t.pose(60, 45)
    expect(t.svg.querySelector(`[data-reference="${id}"]`)).not.toBeNull()
    expect(() => bench().edit(e => e.placeReference({ id: `v${id}`, view: 'view:0,0', asset: `as${t.k}`, x: 0, y: 0, scale: 1, angle: 0, opacity: 1, visible: true }))).toThrow(/placeReference is not allowed/)
    await act(async () => { (t.host.querySelector('[data-testid="move-picture"]') as HTMLInputElement).click() })
    await t.drag({ x: 50, y: t.Y }, { x: 15, y: 5 })
    expect(bench().core.playbackReferences().find(r => r.id === id)).toMatchObject({ x: 65, y: t.Y + 5 })
    await act(async () => { t.button('Leave playback').click() })
    expect(t.svg.querySelector(`[data-reference="${id}"]`)).toBeNull()
    expect(bench().core.in('view:0,0').references().some(r => r.id === id)).toBe(false)
  })
})
