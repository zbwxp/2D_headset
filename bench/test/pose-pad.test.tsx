// pose-pad/ (bowen 1791727397; docs/pose-pad-plan.md): a press jumps, a drag follows, whole degrees within the
// limits; the drag is handed to the app at the press and ends on every path, its window listeners with it.
import { describe, it, expect, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PosePad, type Pose } from '../../pose-pad'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
function pe(type: string, x: number, y: number, buttons: number, id = 1, button = 0) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button, buttons })
  Object.defineProperty(e, 'pointerId', { value: id })
  return e
}
/** Window listeners counted by type, callback and capture (dot 1791718017). */
function track() {
  const live = new Set<string>(), add = window.addEventListener, remove = window.removeEventListener
  const ids = new WeakMap<object, number>(); let n = 0
  const key = (t: string, f: object, o: unknown) => `${t}|${ids.get(f) ?? (ids.set(f, ++n), n)}|${typeof o === 'boolean' ? o : !!(o as { capture?: boolean } | undefined)?.capture}`
  window.addEventListener = function (this: Window, t: string, f: EventListenerOrEventListenerObject, o?: unknown) { if (/^pointer|^blur$|^contextmenu$/.test(t)) live.add(key(t, f as object, o)); return add.call(this, t, f, o as boolean) } as typeof window.addEventListener
  window.removeEventListener = function (this: Window, t: string, f: EventListenerOrEventListenerObject, o?: unknown) { live.delete(key(t, f as object, o)); return remove.call(this, t, f, o as boolean) } as typeof window.removeEventListener
  return { count: () => live.size, restore: () => { window.addEventListener = add; window.removeEventListener = remove } }
}

async function mount(limits: Pose = { yaw: 90, pitch: 45 }) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  const seen: Pose[] = [], events: string[] = []
  let cancel: (() => void) | undefined, setShown!: (p: Pose) => void, show!: (b: boolean) => void
  function Host() {
    const [p, setP] = useState<Pose>({ yaw: 0, pitch: 0 }), [on, setOn] = useState(true)
    setShown = setP; show = setOn
    return on ? <PosePad yaw={p.yaw} pitch={p.pitch} limits={limits}
      onStart={d => { cancel = d.cancel; events.push(`start ${d.pointerId}`) }}
      onChange={x => { seen.push(x) }} onEnd={c => { events.push(c === cancel ? 'end' : 'end?') }} /> : null
  }
  await act(async () => { root.render(<Host />) })
  const pad = () => host.querySelector('[data-testid="pose-pad"]') as SVGSVGElement
  pad().getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect
  return { host, pad, seen, events, cancel: () => cancel!(), setShown: async (p: Pose) => { await act(async () => { setShown(p) }) }, unmountPad: async () => { await act(async () => { show(false) }) } }
}

describe('the pose pad', () => {
  it('a press gives whole degrees: left −90, right +90, top +45, bottom −45, the middle 0,0; outside clamps; never −0', async () => {
    const t = await mount()
    const at = async (x: number, y: number) => { await act(async () => { t.pad().dispatchEvent(pe('pointerdown', x, y, 1)); window.dispatchEvent(pe('pointerup', x, y, 0)) }); return t.seen.at(-1) }
    expect(await at(0, 0)).toEqual({ yaw: -90, pitch: 45 })
    expect(await at(200, 100)).toEqual({ yaw: 90, pitch: -45 })
    expect(await at(100, 50)).toEqual({ yaw: 0, pitch: 0 })
    expect(Object.is((await at(99.9, 50.1))!.yaw, -0)).toBe(false)
    expect(await at(150, 25)).toEqual({ yaw: 45, pitch: 23 })
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', 100, 50, 1)); window.dispatchEvent(pe('pointermove', -500, 900, 1)) })
    expect(t.seen.at(-1)).toEqual({ yaw: -90, pitch: -45 })
  })

  it('a drag reports each move; the handle follows the pose given', async () => {
    const t = await mount()
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', 100, 50, 1)); window.dispatchEvent(pe('pointermove', 120, 50, 1)); window.dispatchEvent(pe('pointermove', 140, 40, 1)) })
    expect(t.seen).toEqual([{ yaw: 0, pitch: 0 }, { yaw: 18, pitch: 0 }, { yaw: 36, pitch: 9 }])
    await t.setShown({ yaw: 45, pitch: -45 })
    const h = t.host.querySelector('[data-handle]')!
    expect([h.getAttribute('cx'), h.getAttribute('cy')]).toEqual(['150', '100'])
  })

  const ENDS: [string, (t: Awaited<ReturnType<typeof mount>>) => Promise<void>][] = [
    ['its release', async () => { window.dispatchEvent(pe('pointerup', 100, 50, 0)) }],
    ['a move without the button (the release was missed)', async () => { window.dispatchEvent(pe('pointermove', 100, 50, 0)) }],
    ['pointercancel', async () => { window.dispatchEvent(pe('pointercancel', 100, 50, 0)) }],
    ['leaving the window', async () => { window.dispatchEvent(new Event('blur')) }],
    ['a right click', async () => { window.dispatchEvent(new MouseEvent('contextmenu')) }],
    ['a new press of the same pointer elsewhere', async () => { document.body.dispatchEvent(pe('pointerdown', 900, 900, 1)) }],
    ['the app\'s cancel', async t => { t.cancel() }],
    ['unmounting', async t => { await t.unmountPad() }],
  ]
  for (const [name, end] of ENDS) it(`ends on ${name}: every window listener gone, a late move changes nothing`, async () => {
    const tr = track()
    try {
      const t = await mount()
      await act(async () => { t.pad().dispatchEvent(pe('pointerdown', 100, 50, 1)) })
      expect(tr.count()).toBeGreaterThan(0)
      await act(async () => { await end(t) })
      expect([tr.count(), t.events.at(-1)]).toEqual([0, 'end'])
      const before = t.seen.length
      await act(async () => { window.dispatchEvent(pe('pointermove', 180, 10, 1)) })
      expect(t.seen.length).toBe(before)
    } finally { tr.restore() }
  })

  it('another pointer during a drag is ignored; the first drag goes on', async () => {
    const t = await mount()
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', 100, 50, 1)); t.pad().dispatchEvent(pe('pointerdown', 0, 0, 1, 2)); window.dispatchEvent(pe('pointermove', 0, 0, 1, 2)) })
    expect([t.seen, t.events]).toEqual([[{ yaw: 0, pitch: 0 }], ['start 1']])
    await act(async () => { window.dispatchEvent(pe('pointermove', 200, 50, 1)) })
    expect(t.seen.at(-1)).toEqual({ yaw: 90, pitch: 0 })
  })

  it('a press at the pose already shown still starts a drag and reports it (the app takes its slot)', async () => {
    const t = await mount()
    await act(async () => { t.pad().dispatchEvent(pe('pointerdown', 100, 50, 1)) })
    expect([t.events, t.seen]).toEqual([['start 1'], [{ yaw: 0, pitch: 0 }]])
  })
})
