// Stage 3b, package 5 (docs/stage3b-pkg5-bench-drag.md; accepted for coding by dot 1791696958):
// dragging a point during playback. Real App, real Core, jsdom events; the gate is tested through
// the App's own logged wrapper (window.bench.edit), not only through disabled buttons.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
let n = 0
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number }; edit(fn: (e: Editor) => unknown): void; log: { calls: string; result: string }[] }
const bench = () => (window as unknown as { bench: B }).bench

function pe(type: string, x: number, y: number, buttons: number, opts: { id?: number; button?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: opts.button ?? 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: opts.id ?? 1 })
  return e
}
/** An App with v<k>: p<k> (0, 300k) – q<k> (100, 300k); q at (60, 300k + 30) in the side view, p equal in front and side. */
async function setup(opts: { seed?: boolean } = {}) {
  const k = ++n
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('svg')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  if (opts.seed !== false) await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: 300 * k } }))
    bench().core.editIn('view:90,0', e => e.move([{ id: `q${k}`, target: { x: 60, y: 300 * k + 30 } }]))
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  const input = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
  const type = async (id: string, v: string) => {
    const el = input(id)
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const status = () => host.querySelector('svg')!.previousElementSibling!.textContent!
  const play = async (yaw: number, pitch: number) => { await act(async () => { button('Playback').click() }); await type('yaw-text', String(yaw)); await type('pitch-text', String(pitch)) }
  const posed = (id: string) => { const p = bench().pose()!; return bench().core.atPose(p).snapshot().points.find(x => x.id === id)!.position }
  /** Press at `from`, move by `by` in steps, and optionally release. */
  const drag = async (from: { x: number; y: number }, by: { x: number; y: number }, release = true, id = 1) => {
    await act(async () => { svg.dispatchEvent(pe('pointerdown', from.x, from.y, 1, { id })) })
    await act(async () => { window.dispatchEvent(pe('pointermove', from.x + by.x / 2, from.y + by.y / 2, 1, { id })); window.dispatchEvent(pe('pointermove', from.x + by.x, from.y + by.y, 1, { id })) })
    if (release) await act(async () => { window.dispatchEvent(pe('pointerup', from.x + by.x, from.y + by.y, 0, { id })) })
  }
  const lateUp = async (at: { x: number; y: number }, id = 1) => { await act(async () => { window.dispatchEvent(pe('pointerup', at.x, at.y, 0, { id })) }) }
  return { host, svg, k, root, button, input, type, status, play, posed, drag, lateUp }
}
async function openFile(host: HTMLElement, text: string) {
  const input = host.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([text], 'd.json', { type: 'application/json' })], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 1e-9 * Math.max(1, Math.abs(b.x)) && Math.abs(a.y - b.y) < 1e-9 * Math.max(1, Math.abs(b.y))

describe('a drag on a line commits one correct', () => {
  it('q dragged at yaw 45 shows its start + displacement there; one correct in the log; one undo step after leaving playback', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(45, 0)
    expect(t.status()).toContain('on the line view:0,0 → view:90,0 at t = 0.5')
    const start = t.posed(q), before = save(bench().core)
    await t.drag(start, { x: 20, y: 10 })
    expect(bench().log[0]).toMatchObject({ result: 'ok' })
    expect(bench().log[0]!.calls).toMatch(/^correct\(/)
    expect(near(t.posed(q), { x: start.x + 20, y: start.y + 10 })).toBe(true)
    await t.button('Leave playback').click()
    await act(async () => {})
    await act(async () => { bench().core.undo() })
    expect(save(bench().core)).toBe(before)
  })

  it('a press off the point\'s centre does not make it jump: 6 px off, dragged 20 px → start + 20', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(45, 0)
    const start = t.posed(q)
    await t.drag({ x: start.x + 6, y: start.y }, { x: 20, y: 0 })
    expect(near(t.posed(q), { x: start.x + 20, y: start.y })).toBe(true)
  })

  it('a move case: p, equal in front and side, dragged at yaw 45 moves the side view', async () => {
    const t = await setup(), p = `p${t.k}`
    await t.play(45, 0)
    await t.drag(t.posed(p), { x: 0, y: 15 })
    await act(async () => { t.button('Leave playback').click() })
    expect(bench().core.in('view:90,0').snapshot().points.find(x => x.id === p)!.position.y).toBeGreaterThan(300 * t.k)
  })

  it('an unmoved press commits nothing', async () => {
    const t = await setup()
    await t.play(45, 0)
    const before = save(bench().core), start = t.posed(`q${t.k}`)
    await t.drag(start, { x: 1, y: 0 })
    expect(save(bench().core)).toBe(before)
  })
})

describe('where a drag can start', () => {
  it('at a view and inside a cell a press starts nothing; the status says why', async () => {
    const t = await setup()
    await t.play(0, 0)
    expect(t.status()).toContain('at a view · read only')
    const before = save(bench().core), logged = bench().log.length
    await t.drag({ x: 100, y: 300 * t.k }, { x: 20, y: 0 })
    await t.type('yaw-text', '30'); await t.type('pitch-text', '20')
    expect(t.status()).toContain('inside a cell · read only')
    await t.drag(t.posed(`q${t.k}`), { x: 20, y: 0 })
    expect([save(bench().core) === before, bench().log.length]).toEqual([true, logged])
  })

  it('hidden points are not picked: the nearer hidden one is skipped for the visible one; a point whose lines are all hidden is never picked', async () => {
    const t = await setup(), k = t.k
    await act(async () => {
      // r sits 3 px from where q shows at yaw 45 (80, 300k + 15); s is far from everything
      bench().core.edit(e => e.line(`h${k}`, { id: `r${k}`, layer: 'layer-1', position: { x: 83, y: 300 * k + 15 } }, { id: `s${k}`, layer: 'layer-1', position: { x: 160, y: 300 * k + 60 } }))
      bench().core.edit(e => e.lineState(`h${k}`, { visible: false }))
    })
    await t.play(45, 0)
    const r = t.posed(`r${k}`), q = t.posed(`q${k}`), before = save(bench().core)
    // pressed exactly on r (hidden), 3 px from q: q is dragged by the pointer's displacement, r is not
    expect(Math.hypot(r.x - q.x, r.y - q.y)).toBeLessThan(10)
    await t.drag(r, { x: 0, y: 12 })
    expect(near(t.posed(`q${k}`), { x: q.x, y: q.y + 12 })).toBe(true)
    expect(t.posed(`r${k}`)).toEqual(r)
    // s only ends the hidden line: pressing on it picks nothing
    const mid = save(bench().core)
    await t.drag(t.posed(`s${k}`), { x: 10, y: 10 })
    expect(save(bench().core)).toBe(mid)
    expect(before).not.toBe(mid)
  })
})

describe('refusals', () => {
  it('a locked line\'s point: locked in red in the status, a cross on the line, nothing published; the next press clears it', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => e.lineState(`v${t.k}`, { locked: true })) })
    await t.play(45, 0)
    const before = save(bench().core)
    await t.drag(t.posed(`q${t.k}`), { x: 20, y: 0 })
    expect(t.status()).toMatch(/^✗ Line v\d+.* is locked/)
    expect(t.svg.innerHTML).toContain('stroke="#d00"')
    expect(save(bench().core)).toBe(before)
    await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 700, 0, 1)); window.dispatchEvent(pe('pointerup', 700, 0, 0)) })
    expect(t.status()).not.toContain('✗')
    expect(t.svg.innerHTML).not.toContain('stroke="#d00"')
  })
})

describe('the gate, through the App\'s own wrapper (dot 1791696773, 1791696847)', () => {
  const pose = { yaw: 45, pitch: 0 }
  it('correct then a caught forbidden call, and the reverse order: nothing published', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(45, 0)
    const before = save(bench().core), target = { points: [{ id: q, position: { x: 90, y: 300 * t.k + 3 } }] }
    expect(() => bench().edit(e => { e.correct(pose, target); try { e.move([{ id: q, target: { x: 0, y: 0 } }]) } catch { /* caught */ } })).toThrow(/read-only-playback.*it called move/)
    expect(() => bench().edit(e => { try { e.select([]) } catch { /* caught */ } e.correct(pose, target) })).toThrow(/read-only-playback.*it called select/)
    expect(save(bench().core)).toBe(before)
  })

  it('a forbidden call whose argument cannot be logged (circular), caught, then correct: nothing published; a correct with an unprintable argument is logged as such and runs (dot 1791697642)', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(45, 0)
    const before = save(bench().core)
    const cyclic: Record<string, unknown> = { id: q, target: { x: 0, y: 0 } }; cyclic.self = cyclic
    expect(() => bench().edit(e => { try { e.move([cyclic as never]) } catch { /* caught */ } e.correct(pose, { points: [{ id: q, position: { x: 90, y: 300 * t.k + 3 } }] }) })).toThrow(/read-only-playback.*it called move/)
    expect(save(bench().core)).toBe(before)
    const odd: Record<string, unknown> = { points: [{ id: q, position: { x: 90, y: 300 * t.k + 3 } }] }; odd.self = odd
    bench().edit(e => e.correct(pose, odd as never))
    expect(save(bench().core)).not.toBe(before)
    expect(bench().log[0]!.calls).toContain('‹unprintable›')
  })

  it('an empty edit is refused before core settles it: two coincident points of one layer from a file stay two', async () => {
    const t = await setup({ seed: false })
    const d = Core.newDocument({ layer: { id: 'layer-1', name: 'L' } })
    d.edit(e => { e.line('c1', { id: 'm', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'n', layer: 'layer-1', position: { x: 50, y: 0 } }); e.line('c2', { id: 'u', layer: 'layer-1', position: { x: 10, y: 10 } }, { id: 'w', layer: 'layer-1', position: { x: 60, y: 10 } }) })
    const file = JSON.parse(save(d))
    for (const l of file.document.network.shapes.layers) if (l.points.u) l.points.u = { x: 0, y: 0 } // u onto m in every view
    await openFile(t.host, JSON.stringify(file))
    expect(bench().core.snapshot().points.map(p => p.id).sort()).toEqual(['m', 'n', 'u', 'w'])
    await t.play(45, 0)
    const before = save(bench().core)
    expect(() => bench().edit(() => {})).toThrow(/read-only-playback.*it called correct 0 times/)
    expect(save(bench().core)).toBe(before)
  })

  it('two corrects refused; an async callback with one correct refused by core; exactly one correct published', async () => {
    const t = await setup(), q = `q${t.k}`
    await t.play(45, 0)
    const before = save(bench().core), target = { points: [{ id: q, position: { x: 90, y: 300 * t.k + 3 } }] }
    expect(() => bench().edit(e => { e.correct(pose, target); e.correct(pose, target) })).toThrow(/read-only-playback.*correct 2 times/)
    expect(() => bench().edit(async e => { e.correct(pose, target) })).toThrow(/synchronous/)
    expect(save(bench().core)).toBe(before)
    bench().edit(e => e.correct(pose, target))
    expect(save(bench().core)).not.toBe(before)
  })
})

describe('cancel flows: nothing written, a late pointerup commits nothing, listeners removed in pairs (dot 1791696958)', () => {
  type Way = { name: string; act: (t: Awaited<ReturnType<typeof setup>>) => Promise<void> }
  const ways: Way[] = [
    { name: 'Esc with a number field focused', act: async t => { t.input('yaw-text').focus(); await act(async () => { t.input('yaw-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }) } },
    { name: 'a right click outside the canvas', act: async () => { await act(async () => { document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) }) } },
    { name: 'pointercancel', act: async () => { await act(async () => { window.dispatchEvent(pe('pointercancel', 0, 0, 0)) }) } },
    { name: 'window blur', act: async () => { await act(async () => { window.dispatchEvent(new Event('blur')) }) } },
    { name: 'a new press of the same pointer', act: async t => { await act(async () => { t.svg.dispatchEvent(pe('pointerdown', 700, 0, 1)); window.dispatchEvent(pe('pointerup', 700, 0, 0)) }) } },
    { name: 'a pose change by the slider', act: async t => { await t.type('yaw', '50') } },
    { name: 'a valid number typed', act: async t => { await t.type('yaw-text', '31.35') } },
    { name: 'leaving playback', act: async t => { await act(async () => { t.button('Leave playback').click() }) } },
  ]
  for (const way of ways) it(way.name, async () => {
    const t = await setup()
    await t.play(45, 0)
    const start = t.posed(`q${t.k}`), before = save(bench().core)
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener')
    await t.drag(start, { x: 20, y: 10 }, false)
    expect(t.svg.querySelector('[data-ghost-point]')).not.toBeNull()
    await way.act(t)
    await t.lateUp({ x: start.x + 20, y: start.y + 10 })
    const count = (spy: typeof added) => spy.mock.calls.filter(c => ['pointermove', 'pointerup', 'pointercancel', 'blur', 'contextmenu', 'pointerdown'].includes(c[0] as string)).length
    expect([way.name, save(bench().core) === before, count(added), count(removed) >= count(added), t.svg.querySelector('[data-ghost-point]')]).toEqual([way.name, true, 6, true, null])
    added.mockRestore(); removed.mockRestore()
  })

  it('another pointer\'s move, up and cancel do not end the drag; its own release then commits', async () => {
    const t = await setup()
    await t.play(45, 0)
    const start = t.posed(`q${t.k}`)
    await t.drag(start, { x: 20, y: 0 }, false)
    await act(async () => { for (const ty of ['pointermove', 'pointerup', 'pointercancel']) window.dispatchEvent(pe(ty, 0, 0, 0, { id: 2 })) })
    expect(t.svg.querySelector('[data-ghost-point]')).not.toBeNull()
    await t.lateUp({ x: start.x + 20, y: start.y })
    expect(near(t.posed(`q${t.k}`), { x: start.x + 20, y: start.y })).toBe(true)
  })

  it('unmounting the App during a drag: nothing written, a late pointerup commits nothing', async () => {
    const t = await setup()
    await t.play(45, 0)
    const start = t.posed(`q${t.k}`), before = save(bench().core)
    await t.drag(start, { x: 20, y: 0 }, false)
    await act(async () => { t.root.unmount() })
    await t.lateUp({ x: start.x + 20, y: start.y })
    expect(save(bench().core)).toBe(before)
  })
})

describe('number fields keep typing apart from the pose (dot 1791696847)', () => {
  it('"", "-", "1e999", "abc" leave the pose and a drag as they are', async () => {
    const t = await setup()
    await t.play(45, 0)
    await t.drag(t.posed(`q${t.k}`), { x: 20, y: 0 }, false)
    for (const v of ['', '-', '1e999', 'abc', '91']) {
      await t.type('yaw-text', v)
      expect([v, bench().pose(), t.svg.querySelector('[data-ghost-point]') !== null]).toEqual([v, { yaw: 45, pitch: 0 }, true])
    }
  })
})

describe('two Apps on the page share the drawing', () => {
  it('a press on a frame drawn before the drawing changed starts nothing and redraws; the next press works (dot 1791697642)', async () => {
    const t = await setup()
    await t.play(45, 0)
    const start = t.posed(`q${t.k}`)
    // the shared drawing changes without this App redrawing
    bench().core.edit(e => e.line(`z${t.k}`, { id: `z1${t.k}`, layer: 'layer-1', position: { x: 600, y: 0 } }, { id: `z2${t.k}`, layer: 'layer-1', position: { x: 640, y: 0 } }))
    const changed = save(bench().core)
    await t.drag(start, { x: 20, y: 0 })
    expect(save(bench().core)).toBe(changed)
    expect(bench().log[0]!.calls).toContain('the drawing changed since this frame was drawn')
    await t.drag(t.posed(`q${t.k}`), { x: 20, y: 0 })
    expect(save(bench().core)).not.toBe(changed)
  })

  it('the same pointer pressed in the other App cancels this App\'s drag; its late release writes nothing for it', async () => {
    const a = await setup()
    await a.play(45, 0)
    const start = a.posed(`q${a.k}`)
    await a.drag(start, { x: 20, y: 0 }, false)
    const b = await setup({ seed: false })
    const before = save(bench().core)
    await act(async () => { b.svg.dispatchEvent(pe('pointerdown', 700, 50, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointerup', start.x + 20, start.y, 0)) })
    expect(save(bench().core)).toBe(before)
    expect(a.svg.querySelector('[data-ghost-point]')).toBeNull()
  })

  it('the drawing changed during the drag (an edit, then separately an Open in the other App): the release writes nothing and the log says why', async () => {
    const a = await setup()
    await a.play(45, 0)
    const start = a.posed(`q${a.k}`)
    await a.drag(start, { x: 20, y: 0 }, false)
    await act(async () => { bench().core.edit(e => e.line(`x${a.k}`, { id: `x1${a.k}`, layer: 'layer-1', position: { x: 500, y: 0 } }, { id: `x2${a.k}`, layer: 'layer-1', position: { x: 520, y: 0 } })) })
    const changed = save(bench().core)
    await act(async () => { window.dispatchEvent(pe('pointerup', start.x + 20, start.y, 0)) })
    expect(save(bench().core)).toBe(changed)
    expect(bench().log.some(r => r.calls.includes('the drawing changed during the drag'))).toBe(true)
    // an Open by another App
    const s2 = a.posed(`q${a.k}`)
    await a.drag(s2, { x: 20, y: 0 }, false)
    const b = await setup({ seed: false })
    await openFile(b.host, save(Core.newDocument()))
    const opened = save(bench().core)
    await act(async () => { window.dispatchEvent(pe('pointerup', s2.x + 20, s2.y, 0)) })
    expect(save(bench().core)).toBe(opened)
  })
})

describe('the shared gesture code: an editing drag is cancelled by the same pointer pressed in another App too (dot 1791696828)', () => {
  it('A drags q with the A tool, the same pointer presses in B, then a release: A commits nothing', async () => {
    const a = await setup()
    await act(async () => { (bench() as unknown as { ix: { setTool(t: string): void } }).ix.setTool('A') })
    const q0 = bench().core.snapshot().points.find(p => p.id === `q${a.k}`)!.position
    await act(async () => { a.svg.dispatchEvent(pe('pointerdown', q0.x, q0.y, 1)); window.dispatchEvent(pe('pointermove', q0.x + 30, q0.y, 1)) })
    const b = await setup({ seed: false })
    await act(async () => { b.svg.dispatchEvent(pe('pointerdown', 700, 50, 1)) })
    await act(async () => { window.dispatchEvent(pe('pointerup', q0.x + 30, q0.y, 0)) })
    expect(bench().core.snapshot().points.find(p => p.id === `q${a.k}`)!.position).toEqual(q0)
  })
})
