// Batch tools at a correction pose (docs/playback-tools-checklist.md, accepted by dot 1791981220 at ad6ea2b): a playback
// selection (box, A / V, Shift, Alt); move, the box's scale, arrows, 四角 — each one correct whose preview is that correct
// read at the pose (`previewAt`); the selection stays through its writes; a pose change mid-drag writes nothing.
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
function pe(type: string, x: number, y: number, buttons: number, mods: { shiftKey?: boolean; altKey?: boolean } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, ...mods })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}
const key = async (k: string, type = 'keydown') => { await act(async () => { window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })) }) }
const near = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6

/** An eye-like curve at Y = 300k: e1 p (0, Y) – q (40, Y + 10) – r (80, Y); a far line s far away; q moved in the side view. */
async function setup() {
  const k = ++n, Y = 300 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  const [p, q, r] = [`p${k}`, `q${k}`, `r${k}`]
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => {
      e.line(`e${k}`, { id: p, layer: 'layer-1', position: { x: 0, y: Y } }, { id: q, layer: 'layer-1', position: { x: 40, y: Y + 10 } }, { ha: { x: 10, y: 5 }, hb: { x: -10, y: 0 } })
      e.line(`f${k}`, q, { id: r, layer: 'layer-1', position: { x: 80, y: Y } }, { ha: { x: 10, y: 0 }, hb: { x: -10, y: 5 } })
      e.line(`s${k}`, { id: `s1${k}`, layer: 'layer-1', position: { x: 300, y: Y } }, { id: `s2${k}`, layer: 'layer-1', position: { x: 340, y: Y } })
    })
    bench().core.editIn('view:90,0', e => e.move([{ id: q, target: { x: 60, y: Y + 30 } }]))
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  const type = async (id: string, v: string) => {
    const el = host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const play = async (yaw: number, pitch: number, tool = 'a') => { await act(async () => { button('Playback').click() }); await type('yaw-text', String(yaw)); await type('pitch-text', String(pitch)); await key(tool) }
  const posed = (id: string) => { const ps = bench().pose()!; return bench().core.atPose(ps).snapshot().points.find(x => x.id === id)!.position }
  const posedLine = (id: string) => { const ps = bench().pose()!; return bench().core.atPose(ps).snapshot().lines.find(x => x.id === id)! }
  const drag = async (from: Vec, to: Vec, mods: { shiftKey?: boolean; altKey?: boolean } = {}, release = true) => {
    await act(async () => { svg.dispatchEvent(pe('pointerdown', from.x, from.y, 1, mods)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, 1, mods)); window.dispatchEvent(pe('pointermove', to.x, to.y, 1, mods)) })
    if (release) await act(async () => { window.dispatchEvent(pe('pointerup', to.x, to.y, 0, mods)) })
  }
  const picked = () => [...svg.querySelectorAll('[data-pb-selected]')].map(x => x.getAttribute('data-pb-selected')).sort()
  const corrects = () => bench().log.filter(r => /^correct\(/.test(r.calls) && r.result === 'ok').length
  return { host, svg, k, Y, p, q, r, button, type, play, posed, posedLine, drag, picked, corrects }
}

describe('the playback selection (§1)', () => {
  it('a box dragged right takes the lines wholly inside, A their end points; left takes what it touches; Shift adds, Alt removes; nothing is written', async () => {
    const t = await setup(), before = save(bench().core)
    await t.play(30, 0)
    const p0 = t.posed(t.p), r0 = t.posed(t.r)
    await t.drag({ x: p0.x - 5, y: p0.y - 40 }, { x: r0.x + 5, y: r0.y + 40 })
    expect(t.picked()).toEqual([t.p, t.q, t.r].sort())
    await t.drag({ x: p0.x + 20, y: p0.y - 30 }, { x: p0.x + 30, y: p0.y - 20 }, { altKey: true }) // a right drag around no line: nothing removed
    expect(t.picked()).toEqual([t.p, t.q, t.r].sort())
    await t.drag({ x: r0.x + 2, y: r0.y + 40 }, { x: r0.x - 15, y: r0.y - 40 }, { altKey: true }) // left: touches f → its ends removed
    expect(t.picked()).toEqual([t.p])
    await t.drag({ x: r0.x + 2, y: r0.y + 40 }, { x: r0.x - 15, y: r0.y - 40 }, { shiftKey: true })
    expect(t.picked()).toEqual([t.p, t.q, t.r].sort())
    expect(save(bench().core)).toBe(before)
  })

  it('V picks a whole curve; Shift toggles it; a pose change clears the selection', async () => {
    const t = await setup()
    await t.play(30, 0, 'v')
    const q0 = t.posed(t.q)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', q0.x, q0.y, 1, { shiftKey: true })); window.dispatchEvent(pe('pointerup', q0.x, q0.y, 0, { shiftKey: true })) })
    expect(t.picked()).toEqual([t.p, t.q, t.r].sort())
    await t.type('yaw-text', '60')
    expect(t.picked()).toEqual([])
  })
})

describe('batch writes (§2, §3)', () => {
  it('box-select, move inside the box: one correct with every point; the preview equals the drawing after the release; the selection stays', async () => {
    const t = await setup()
    await t.play(30, 0)
    const p0 = t.posed(t.p), q0 = t.posed(t.q), r0 = t.posed(t.r)
    await t.drag({ x: p0.x - 5, y: p0.y - 40 }, { x: r0.x + 5, y: r0.y + 40 })
    const n0 = t.corrects()
    const inside = { x: (p0.x + q0.x) / 2, y: p0.y + 4 } // inside the box, away from its handles
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', inside.x, inside.y, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', inside.x + 6, inside.y + 3, 1)); window.dispatchEvent(pe('pointermove', inside.x + 12, inside.y + 5, 1)) })
    const ghost = [...t.svg.querySelectorAll('[data-ghost]')].map(x => [x.getAttribute('data-ghost'), x.getAttribute('d')]).sort()
    await act(async () => { window.dispatchEvent(pe('pointerup', inside.x + 12, inside.y + 5, 0)) })
    expect(t.corrects()).toBe(n0 + 1)
    for (const [id, was] of [[t.p, p0], [t.q, q0], [t.r, r0]] as const) expect([id, t.posed(id)]).toEqual([id, { x: was.x + 12, y: was.y + 5 }])
    const drawn = bench().core.atPose(bench().pose()!).geometry().lines.filter(l => ghost.some(([gid]) => gid === l.id)).map(l => [l.id, `M${l.curve[0]!.x},${l.curve[0]!.y} C${l.curve[1]!.x},${l.curve[1]!.y} ${l.curve[2]!.x},${l.curve[2]!.y} ${l.curve[3]!.x},${l.curve[3]!.y}`]).sort()
    expect(ghost).toEqual(drawn)
    expect(t.picked()).toEqual([t.p, t.q, t.r].sort())
  })

  it('the box\'s side handle squeezes sideways: one correct, x scaled about the opposite side, y and the handles\' y untouched; then the arrows nudge, one correct per run', async () => {
    const t = await setup()
    await t.play(30, 0)
    const p0 = t.posed(t.p), q0 = t.posed(t.q), r0 = t.posed(t.r), ha0 = t.posedLine(`e${t.k}`).ha
    await t.drag({ x: p0.x - 5, y: p0.y - 40 }, { x: r0.x + 5, y: r0.y + 40 })
    const h = t.svg.querySelector('[data-pb-handle="e"]')!, hx = Number(h.getAttribute('x')) + 3.5, hy = Number(h.getAttribute('y')) + 3.5
    const n0 = t.corrects(), w = r0.x - p0.x
    await t.drag({ x: hx, y: hy }, { x: hx - w / 2, y: hy })
    expect(t.corrects()).toBe(n0 + 1)
    const sx = 0.5, x = (v: Vec) => p0.x + (v.x - p0.x) * sx
    expect([near(t.posed(t.p), p0), near(t.posed(t.q), { x: x(q0), y: q0.y }), near(t.posed(t.r), { x: x(r0), y: r0.y })]).toEqual([true, true, true])
    expect(near(t.posedLine(`e${t.k}`).ha, { x: ha0.x * sx, y: ha0.y })).toBe(true)
    const q1 = t.posed(t.q)
    await key('ArrowRight'); await key('ArrowRight', 'keyup')
    expect(t.corrects()).toBe(n0 + 2)
    expect(near(t.posed(t.q), { x: q1.x + 1, y: q1.y })).toBe(true)
    expect(t.picked()).toEqual([t.p, t.q, t.r].sort())
  })

  it('四角: with the curve picked, a corner dragged writes one correct; the frame stays for the next drag', async () => {
    const t = await setup()
    await t.play(30, 0)
    const p0 = t.posed(t.p), r0 = t.posed(t.r)
    await t.drag({ x: p0.x - 5, y: p0.y - 40 }, { x: r0.x + 5, y: r0.y + 40 })
    await act(async () => { t.button('四角/曲边').click() })
    const c = t.svg.querySelector('[data-pb-deform-corner="2"]')!, cx = Number(c.getAttribute('x')) + 6, cy = Number(c.getAttribute('y')) + 6
    const n0 = t.corrects()
    await t.drag({ x: cx, y: cy }, { x: cx + 10, y: cy + 8 })
    expect(t.corrects()).toBe(n0 + 1)
    expect(near(t.posed(t.p), p0)).toBe(true) // the opposite corner's point stays
    expect(t.svg.querySelector('[data-testid="pb-deform-frame"]')).not.toBeNull()
  })

  it('a pose change mid-drag writes nothing', async () => {
    const t = await setup()
    await t.play(30, 0)
    const q0 = t.posed(t.q), before = save(bench().core)
    await t.drag(q0, { x: q0.x + 10, y: q0.y }, {}, false)
    await t.type('yaw-text', '60')
    await act(async () => { window.dispatchEvent(pe('pointerup', q0.x + 10, q0.y, 0)) })
    expect(save(bench().core)).toBe(before)
  })
})

describe('links and refusals (§3)', () => {
  it('a linked member on an unselected layer moves with the target: the preview shows its line, and so does the drawing after', async () => {
    const t = await setup(), k = t.k
    await act(async () => {
      bench().core.edit(e => { e.layer(`M${k}`, `M${k}`); e.line(`mn${k}`, { id: `m${k}`, layer: `M${k}`, position: { x: 40, y: t.Y + 10.5 } }, { id: `mm${k}`, layer: `M${k}`, position: { x: 40, y: t.Y + 60 } }) })
      bench().core.edit(e => e.link(t.q, `m${k}`))
      bench().refresh()
    })
    await t.play(30, 0)
    const q0 = t.posed(t.q)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', q0.x, q0.y, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', q0.x + 4, q0.y, 1)); window.dispatchEvent(pe('pointermove', q0.x + 8, q0.y, 1)) })
    expect(t.svg.querySelector(`[data-ghost="mn${k}"]`)).not.toBeNull()
    await act(async () => { window.dispatchEvent(pe('pointerup', q0.x + 8, q0.y, 0)) })
    expect(t.posed(`m${k}`)).toEqual(t.posed(t.q))
  })

  it('a refused correction: no ghost, the reason in the status line, nothing written', async () => {
    const t = await setup()
    await t.play(30, 45) // the edge 0,45 → 90,45 does not start at the front: p equal in both views cannot be corrected there
    const p0 = t.posed(t.p), before = save(bench().core)
    await t.drag(p0, { x: p0.x + 10, y: p0.y + 4 })
    expect(save(bench().core)).toBe(before)
    expect(t.host.querySelector('[data-testid="status"]')!.textContent).toMatch(/correction-axis-fixed/)
  })
})
