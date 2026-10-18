// A second layer order for yaw < 0 (docs/left-layer-order-checklist.md; bowen 1791995249, 1791996722): views at yaw −90
// and poses at yaw < 0 stack in the left order; yaw ≥ 0 (the front included) in today's; a reorder edits the order of
// the view it is in; new / copied / removed layers keep both orders whole; the file is version 13.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'
import { strokesPerView } from './old-files'

const P = (x: number, y = 0): Vec => ({ x, y })
const LEFT = 'view:-90,0', RIGHT = 'view:90,0'
const ids = (d: Core, k: string) => d.in(k).snapshot().layers.map(l => l.id)
const groupLayers = (r: { snapshot(): { groups: { layer: string }[] } }) => r.snapshot().groups.map(g => g.layer)
function code(f: () => void): string {
  try { f() } catch (x) { return x instanceof Refusal ? x.code : (x as Error).message }
  return 'no refusal'
}
/** Three layers bottom → top: face, eye, side; one line in each. */
function doc() {
  const d = Core.newDocument({ layer: { id: 'face', name: 'face' } })
  d.edit(e => {
    e.layer('eye', 'eye'); e.layer('side', 'side')
    e.line('f', { id: 'f1', layer: 'face', position: P(0) }, { id: 'f2', layer: 'face', position: P(10) })
    e.line('e', { id: 'e1', layer: 'eye', position: P(0, 5) }, { id: 'e2', layer: 'eye', position: P(10, 5) })
    e.line('s', { id: 's1', layer: 'side', position: P(0, 9) }, { id: 's2', layer: 'side', position: P(10, 9) })
  })
  return d
}

describe('the left layer order', () => {
  it('none at first: every view and pose stacks as today; a file without it opens equal', () => {
    const d = doc()
    for (const k of d.views()) expect(ids(d, k)).toEqual(['face', 'eye', 'side'])
    expect(JSON.parse(save(d)).document.network.leftOrder).toBeUndefined()
    expect(save(open(save(d)))).toBe(save(d))
  })

  it('a reorder in view −90 moves the left order only: −90 views and poses at yaw < 0 stack by it, the rest as today; one undo step', () => {
    const d = doc()
    d.editIn(LEFT, e => e.reorderLayer('side', 1)) // side between face and eye on the left
    for (const k of d.views()) expect([k, ids(d, k)]).toEqual([k, k.startsWith('view:-90') ? ['face', 'side', 'eye'] : ['face', 'eye', 'side']])
    expect(groupLayers(d.in(LEFT))).toEqual(['face', 'side', 'eye'])
    expect(groupLayers(d.in(RIGHT))).toEqual(['face', 'eye', 'side'])
    for (const [yaw, left] of [[-30, true], [-60, true], [0, false], [30, false]] as const) {
      const r = d.atPose({ yaw, pitch: 10 }), want = left ? ['face', 'side', 'eye'] : ['face', 'eye', 'side']
      expect([yaw, r.snapshot().layers.map(l => l.id), groupLayers(r)]).toEqual([yaw, want, want])
    }
    const before = save(d)
    const pv = d.previewAt({ yaw: -30, pitch: 0 }, () => {})!
    expect(groupLayers(pv)).toEqual(['face', 'side', 'eye'])
    expect(save(d)).toBe(before) // reading writes nothing
    d.undo()
    expect(ids(d, LEFT)).toEqual(['face', 'eye', 'side'])
  })

  it('a reorder in a right-side view leaves the left order; new, copied and removed layers keep both orders whole', () => {
    const d = doc()
    d.editIn(LEFT, e => e.reorderLayer('side', 0))
    d.editIn(RIGHT, e => e.reorderLayer('face', 2))
    expect([ids(d, LEFT), ids(d, RIGHT)]).toEqual([['side', 'face', 'eye'], ['eye', 'side', 'face']])
    d.edit(e => e.layer('hair', 'hair', 'face'))
    expect([ids(d, LEFT), ids(d, RIGHT)]).toEqual([['side', 'face', 'hair', 'eye'], ['eye', 'side', 'face', 'hair']])
    d.edit(e => e.copyLayer('side', 'side2'))
    expect([ids(d, LEFT), ids(d, RIGHT)]).toEqual([['side', 'side2', 'face', 'hair', 'eye'], ['eye', 'side', 'side2', 'face', 'hair']])
    d.edit(e => e.deleteLayer('hair'))
    expect([ids(d, LEFT), ids(d, RIGHT)]).toEqual([['side', 'side2', 'face', 'eye'], ['eye', 'side', 'side2', 'face']])
    expect(save(open(save(d)))).toBe(save(d))
  })

  it('resetLeftOrder drops it (one undo step); refused when there is none', () => {
    const d = doc()
    expect(code(() => d.edit(e => e.resetLeftOrder()))).toBe('left-order-none')
    d.editIn(LEFT, e => e.reorderLayer('side', 0))
    d.edit(e => e.resetLeftOrder())
    expect(ids(d, LEFT)).toEqual(['face', 'eye', 'side'])
    expect(JSON.parse(save(d)).document.network.leftOrder).toBeUndefined()
    d.undo()
    expect(ids(d, LEFT)).toEqual(['side', 'face', 'eye'])
  })

  it('the file: version 13 on, now 15, round trip; a version 12 file opens and draws as before; a bad left order is refused', () => {
    const d = doc()
    d.editIn(LEFT, e => e.reorderLayer('side', 0))
    const f = JSON.parse(save(d))
    expect([f.version, f.document.network.leftOrder]).toEqual([15, ['side', 'face', 'eye']])
    const plain = doc(), v12 = strokesPerView(JSON.parse(save(plain))); v12.version = 12
    const opened = open(JSON.stringify(v12))
    for (const k of opened.views()) expect(ids(opened, k)).toEqual(ids(plain, k))
    const bad = (v: unknown) => { const x = JSON.parse(save(d)); x.document.network.leftOrder = v; return JSON.stringify(x) }
    for (const [v, why] of [[['side', 'face'], /does not hold every layer/], [['side', 'face', 'face'], /appears twice|twice/], [['side', 'face', 'eye', 'zz'], /missing layer zz/], [['side', 'face', 'zz'], /missing layer zz/], ['side', /must be a list|list/]] as const) {
      expect(() => open(bad(v))).toThrow(why)
    }
  })
})
