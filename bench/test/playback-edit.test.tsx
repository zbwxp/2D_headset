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

describe('review fixes (dot 1791978385)', () => {
  it('V picks by editing\'s rules: an unselected layer\'s line is not taken; a line the masks hide wholly gives the press to the visible line under it', async () => {
    const t = await setup(), k = t.k, Y = t.Y
    await act(async () => {
      bench().core.edit(e => {
        e.layer(`B${k}`, `B${k}`)
        const P = (id: string, layer: string, x: number, y: number) => ({ id, layer, position: { x, y } })
        e.line(`s1${k}`, P(`c1${k}`, `B${k}`, 300, Y - 20), P(`c2${k}`, `B${k}`, 400, Y - 20)); e.line(`s2${k}`, `c2${k}`, P(`c3${k}`, `B${k}`, 400, Y + 100)); e.line(`s3${k}`, `c3${k}`, P(`c4${k}`, `B${k}`, 300, Y + 100)); e.line(`s4${k}`, `c4${k}`, `c1${k}`)
        e.line(`x${k}`, P(`xa${k}`, 'layer-1', 310, Y), P(`xb${k}`, 'layer-1', 390, Y)) // wholly inside the square
        e.line(`ww${k}`, P(`wa${k}`, 'layer-1', 310, Y + 2), P(`wb${k}`, 'layer-1', 390, Y + 2))
      })
      const sq = bench().core.snapshot().loops.find(l => l.route.some(u => u.line === `s1${k}`))!.id
      bench().core.edit(e => { e.fill(sq, '#ccc'); e.mask(`m${k}`, [sq], { kind: 'line', id: `x${k}` }, 'inverse') })
      bench().refresh()
    })
    await t.play(30, 0, 'v')
    const before = save(bench().core)
    await t.drag({ x: 350, y: Y - 20 }, { x: 5, y: 5 }) // the square's top edge: layer B is not selected
    expect(save(bench().core)).toBe(before)
    const x0 = t.posed(`xa${k}`), w0 = t.posed(`wa${k}`)
    await t.drag({ x: 350, y: Y }, { x: 4, y: 3 }) // on x, which is hidden: w under it is taken
    expect([near(t.posed(`wa${k}`), { x: w0.x + 4, y: w0.y + 3 }), near(t.posed(`xa${k}`), x0)]).toEqual([true, true])
  })

  it('A: the hovered line keeps its handles while the pointer travels off the line to a handle; the drag there corrects it', async () => {
    const t = await setup(), v = `v${t.k}`
    await t.play(30, 0)
    const l = t.posedLine(v), p = t.posed(`p${t.k}`), tip = { x: p.x + l.ha.x, y: p.y + l.ha.y }
    await t.hover({ x: p.x + 0.5 * l.ha.x + 5, y: p.y + 0.5 * l.ha.y + 1 })
    await t.hover({ x: tip.x + 9, y: tip.y - 9 }) // off the line, on the way
    expect(t.svg.querySelector(`[data-pose-handle="${v}:a"]`)).not.toBeNull()
    await t.hover(tip)
    await t.drag(tip, { x: 4, y: 4 })
    expect(bench().log[0]!.calls).toMatch(/^correct\(.*handles/)
  })

  it('「刚才改了什么」 follows every playback write: after a correction at yaw 30, a drag at view 90,0 replaces it', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(30, 0)
    await t.drag(t.posed(q), { x: 5, y: 5 })
    expect(t.host.querySelector('[data-testid="last-change"]')!.textContent).toContain('加修正')
    await t.pose(90, 0)
    const at = bench().core.in('view:90,0').snapshot().points.find(x => x.id === q)!.position
    await t.drag(at, { x: 6, y: 2 })
    const text = t.host.querySelector('[data-testid="last-change"]')!.textContent!
    expect(text).toContain('yaw 90, pitch 0')
    expect(text).toContain(`视角 90,0 的点 ${q} 被移动了 (6, 2)`)
    expect(text).not.toContain('加修正')
  })
})

describe('review fix (dot 1791978817)', () => {
  it('a line hovered on L1 loses its handles when only L2 is selected: they are neither drawn nor dragged', async () => {
    const t = await setup(), v = `v${t.k}`, L2 = `L2-${t.k}`
    await act(async () => { bench().core.edit(e => e.layer(L2, L2)); bench().refresh() })
    await t.play(30, 0)
    const l = t.posedLine(v), p = t.posed(`p${t.k}`), tip = { x: p.x + l.ha.x, y: p.y + l.ha.y }
    await t.hover({ x: p.x + 0.5 * l.ha.x + 5, y: p.y + 0.5 * l.ha.y + 1 })
    expect(t.svg.querySelector(`[data-pose-handle="${v}:a"]`)).not.toBeNull()
    const span = [...t.host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === L2)!
    await act(async () => { span.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(t.svg.querySelector(`[data-pose-handle="${v}:a"]`)).toBeNull()
    const before = save(bench().core)
    await t.drag(tip, { x: 4, y: 4 })
    expect(save(bench().core)).toBe(before)
  })
})

describe('every show / hide switch of the panels works in playback (bowen 1791979917)', () => {
  it('the all-layers eye and fill switch, a layer\'s eye, a curve\'s eye and a line\'s eye each write; their locks are refused', async () => {
    const t = await setup()
    await t.play(20, 0)
    const click = async (title: string) => {
      const el = [...t.host.querySelectorAll('svg > title')].find(x => x.textContent === title)?.parentElement
      expect([title, !!el]).toEqual([title, true])
      const n0 = bench().log.length
      await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      return bench().log.slice(0, bench().log.length - n0)
    }
    for (const title of ['隐藏全部图层的填充', '显示全部图层的填充', '隐藏全部图层（Option 点某个图层的眼睛：只显示它）', '显示全部图层']) {
      const rows = await click(title)
      expect([title, rows.every(r => r.result === 'ok')]).toEqual([title, true])
    }
    const lockRows = await click('锁定图层')
    expect(lockRows.some(r => /not allowed during playback/.test(r.result))).toBe(true)
    // the curve's and the line's eyes (rows inside a layer) call groupState and lineState
    const v = `v${t.k}`, group = bench().core.snapshot().groups.find(g => g.lines.includes(v))!.id
    await act(async () => { bench().edit(e => e.groupState(group, { visible: false })) })
    await act(async () => { bench().edit(e => e.lineState(v, { visible: true })) })
    expect(bench().log.slice(0, 2).map(r => r.result)).toEqual(['ok', 'ok'])
    expect(() => bench().edit(e => e.lineState(v, { locked: true }))).toThrow(/lineState is not allowed/)
  })
})
