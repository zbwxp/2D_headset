// Copy and paste (graph rows "Copy (layer, lines, groups)", "Cut, paste / copy";
// docs/clipboard-plan.md acceptance 1–9; 10 is in boundaries.test.ts).
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y: number): Vec => ({ x, y })
const s = (d: Core) => d.snapshot()
const line = (d: Core, id: string) => s(d).lines.find(l => l.id === id)!
const pos = (d: Core, id: string) => s(d).points.find(p => p.id === id)!.position
const json = (x: unknown) => JSON.stringify(x)

/**
 * Layer L: an eye-like loop a–b–c–d (smooth at b, cusp at c, arc r 4 at a), filled, a free
 * end stroke on e of a tail line, names; layer K: a point linked to c; a mirror pair to
 * a line in layer R.
 */
function scene() {
  const d = new Core({ axis: 0 })
  const p = (id: string, x: number, y: number, layer = 'L') => ({ id, layer, position: P(x, y) })
  d.edit(e => {
    e.layer('L', '左'); e.layer('K', '其他'); e.layer('R', '右')
    e.line('u1', p('a', -300, 0), p('b', -200, -60)); e.line('u2', 'b', p('c', -100, 0)); e.line('w1', 'c', p('d', -200, 40)); e.line('w2', 'd', 'a')
    e.line('t', p('f', -320, 100), p('e', -280, 120))
    e.line('k1', p('k', -100, 0, 'K'), p('k2', -50, 50, 'K'))
    e.line('r1', p('r0', 300, 100, 'R'), p('r9', 320, 120, 'R'))
  })
  d.edit(e => {
    e.join('b', 'u1', 'u2', { mode: 'smooth' }); e.join('c', 'u2', 'w1', { mode: 'cusp' }); e.join('a', 'u1', 'w2', { mode: 'arc', radius: 4 })
    e.endStroke('e', { taper: 0.5 }); e.link('c', 'k')
  })
  d.edit(e => e.fill(s(d).loops[0]!.id, '#f2c94c'))
  const g = (l: string) => s(d).groups.find(x => x.lines.includes(l))!.id
  d.edit(e => { e.renameGroup(g('u1'), '左眼'); e.renameLine('u1', '上眼睑外'); e.mirrorLink([g('t')], [g('r1')]) })
  return d
}
const eyeLines = ['u1', 'u2', 'w1', 'w2']

describe('copy', () => {
  it('1a. copy reads only: the document and its history do not change, locked lines included', () => {
    const d = scene()
    d.edit(e => e.lineState('u1', { locked: true }))
    const before = json([s(d), d.geometry(), d.canUndo, d.canRedo])
    const clip = d.copy(eyeLines)
    expect(clip.network.lines.map(l => l.id).sort()).toEqual([...eyeLines].sort())
    expect(json([s(d), d.geometry(), d.canUndo, d.canRedo])).toBe(before)
  })

  it('1b. copy takes lines: points or handles alone are refused, as delete refuses them', () => {
    const d = scene()
    d.edit(e => e.select([{ kind: 'point', id: 'a' }, { kind: 'handle', line: 'u1', end: 'a' }]))
    expect(() => d.copy()).toThrow(/select-lines-to-copy/)
    d.edit(e => e.select([{ kind: 'point', id: 'a' }, { kind: 'line', id: 'u2' }]))
    expect(d.copy().network.lines.map(l => l.id)).toEqual(['u2'])
  })
})

describe('paste', () => {
  it('2. the same shape moved by the offset, with joins, end strokes, fills, state and stroke; no links, no mirror pairs', () => {
    const d = scene()
    d.edit(e => e.lineStroke('u2', { width: 3, profile: 'uniform' }))
    const clip = d.copy([...eyeLines, 't'])
    d.edit(e => e.paste(clip, 'K', P(0, 300), 'p1'))
    const id = (old: string) => `p1/${old}`
    for (const pt of ['a', 'b', 'c', 'd', 'e', 'f']) expect(pos(d, id(pt))).toEqual({ x: pos(d, pt).x, y: pos(d, pt).y + 300 })
    for (const l of [...eyeLines, 't']) {
      expect(line(d, id(l)).ha).toEqual(line(d, l).ha)
      expect(line(d, id(l)).hb).toEqual(line(d, l).hb)
      expect(line(d, id(l)).stroke).toEqual(line(d, l).stroke)
      expect(s(d).points.find(p => p.id === id(line(d, l).a))!.layer).toBe('K')
    }
    const joins = s(d).joins.filter(j => j.point.startsWith('p1/')).map(j => [j.point, j.mode, j.radius ?? null]).sort()
    expect(joins).toEqual([[id('a'), 'arc', 4], [id('b'), 'smooth', null], [id('c'), 'cusp', null]].sort())
    expect(s(d).points.find(p => p.id === id('e'))!.endStroke).toEqual({ taper: 0.5 })
    const fill = s(d).loops.find(l => l.route.some(u => u.line === id('u1')))!
    expect([fill.filled, fill.color]).toEqual([true, '#f2c94c'])
    expect(s(d).links.some(k => k.a.startsWith('p1/') || k.b.startsWith('p1/'))).toBe(false)
    expect(s(d).mirrorPairs.some(p => p.a.startsWith('p1/') || p.b.startsWith('p1/'))).toBe(false)
    expect(s(d).selection.map(u => (u as { id: string }).id).sort()).toEqual([...eyeLines, 't'].map(id).sort())
  })

  it('3. new ids each time; names "<name>副本", then 副本2; a curve copied in part gets a default name', () => {
    const d = scene()
    const clip = d.copy(eyeLines)
    d.edit(e => e.paste(clip, 'K', P(0, 300), 'p1'))
    d.edit(e => e.paste(clip, 'K', P(0, 600), 'p2'))
    expect(line(d, 'p1/u1').name).toBe('上眼睑外副本')
    expect(line(d, 'p2/u1').name).toBe('上眼睑外副本2')
    const group = (l: string) => s(d).groups.find(x => x.lines.includes(l))!
    expect(group('p1/u1').name).toBe('左眼副本')
    expect(group('p2/u1').name).toBe('左眼副本2')
    { const clip = d.copy(['u1', 'u2']); d.edit(e => e.paste(clip, 'K', P(0, 900), 'p3')) }
    expect(group('p3/u1').name).toMatch(/^连续曲线\d+$/)
    const names = [...s(d).layers.map(l => l.name), ...s(d).groups.map(g => g.name), ...s(d).lines.map(l => l.name)]
    expect(new Set(names).size).toBe(names.length)
  })

  it('4a. pasted with no offset onto the original’s own layer: every end point binds, and the originals stay', () => {
    const d = scene()
    const ids = new Set(s(d).points.map(p => p.id))
    { const clip = d.copy(eyeLines); d.edit(e => e.paste(clip, 'L', P(0, 0), 'p1')) }
    expect(s(d).points.filter(p => p.layer === 'L').map(p => p.id).every(id => ids.has(id))).toBe(true)
    expect(line(d, 'p1/u1').a).toBe('a')
    expect(line(d, 'p1/u1').b).toBe('b')
  })

  it('4b. if that bind would change a locked original, the paste is refused and nothing changes', () => {
    // t is locked and its end e is free, with an end stroke; a copy pasted onto it binds at e,
    // so e is no longer free and t's end stroke would disappear: a change to what t owns alone
    const d = scene()
    d.edit(e => e.lineState('t', { locked: true }))
    const clip = d.copy(['t']), before = json([s(d), d.geometry()])
    expect(() => d.edit(e => e.paste(clip, 'L', P(0, 0), 'p1'))).toThrow(/Locked lines would change/)
    expect(json([s(d), d.geometry()])).toBe(before)
  })

  it('5. a pasted locked line is locked afterwards: a later edit that changes it is refused', () => {
    const d = scene()
    d.edit(e => e.lineState('t', { locked: true }))
    { const clip = d.copy(['t']); d.edit(e => e.paste(clip, 'K', P(0, 300), 'p1')) }
    expect(line(d, 'p1/t').state.locked).toBe(true)
    expect(() => d.edit(e => e.move([{ id: 'p1/e', target: P(0, 0) }]))).toThrow(/Locked lines would change/)
  })

  it('5b. a pasted lock protects from the moment of the paste: changing it later in the same edit is refused (dot 1791513520)', () => {
    const d = scene()
    d.edit(e => e.lineState('t', { locked: true }))
    const clip = d.copy(['t']), before = json([s(d), d.geometry()])
    expect(() => d.edit(e => { e.paste(clip, 'K', P(0, 300), 'p1'); e.move([{ id: 'p1/e', target: P(0, 0) }]) })).toThrow(/Locked lines would change \(p1\/t\)/)
    expect(json([s(d), d.geometry()])).toBe(before)
    // the paste alone in one edit is fine
    d.edit(e => e.paste(clip, 'K', P(0, 300), 'p1'))
    expect(line(d, 'p1/t').state.locked).toBe(true)
  })

  describe('5c. protected from the paste on, whatever comes after in the same edit (dot 1791514309)', () => {
    const setup = () => { const d = scene(); d.edit(e => e.lineState('t', { locked: true })); return { d, clip: d.copy(['t']) } }
    const refused: [string, (e: any) => void][] = [
      ['deleting it', e => e.deleteLine('p1/t')],
      ['splitting it', e => e.split('p1/t', 0.5, 'm', 'q1', 'q2')],
      ['locking it again, then moving it', e => { e.lineState('p1/t', { locked: true }); e.move([{ id: 'p1/e', target: P(0, 0) }]) }],
    ]
    for (const [label, after] of refused) it(`refused: ${label}`, () => {
      const { d, clip } = setup(), before = json([s(d), d.geometry()])
      expect(() => d.edit(e => { e.paste(clip, 'K', P(0, 300), 'p1'); after(e) })).toThrow(/Locked lines would change/)
      expect(json([s(d), d.geometry()])).toBe(before)
    })
    it('allowed: a real unlock, then moving it', () => {
      const { d, clip } = setup()
      d.edit(e => { e.paste(clip, 'K', P(0, 300), 'p1'); e.lineState('p1/t', { locked: false }); e.move([{ id: 'p1/e', target: P(0, 0) }]) })
      expect(pos(d, 'p1/e')).toEqual(P(0, 0))
    })
    it('the same holds for a lock a mirror apply copies: deleting the target later in the edit is refused', () => {
      const d = new Core({ axis: 0 })
      d.edit(e => {
        e.layer('L')
        e.line('src', { id: 's1', layer: 'L', position: P(-30, 0) }, { id: 's2', layer: 'L', position: P(-10, 5) })
        e.line('tgt', { id: 't1', layer: 'L', position: P(12, 1) }, { id: 't2', layer: 'L', position: P(28, 2) })
      })
      d.edit(e => e.lineState('src', { locked: true }))
      expect(() => d.edit(e => { e.mirrorApply(['src'], ['tgt']); e.deleteLine('tgt') })).toThrow(/Locked lines would change \(tgt\)/)
    })
  })

  it('6d. a clip fill whose lines are not a closed curve refuses the paste, instead of being dropped (dot 1791514309)', () => {
    const d = scene(), c = JSON.parse(JSON.stringify(d.copy([...eyeLines, 't'])))
    c.fills[0].lines = ['t']
    const before = json([s(d), d.geometry()])
    expect(() => d.edit(e => e.paste(c, 'K', P(0, 300), 'p1'))).toThrow(/not a closed curve/)
    expect(json([s(d), d.geometry()])).toBe(before)
  })

  describe('6b. a clip changed by the caller is refused whole, through the checks (dot 1791513520)', () => {
    const d = scene(), good = JSON.stringify(d.copy([...eyeLines, 't']))
    const bad = (f: (c: any) => void) => { const c = JSON.parse(good); f(c); return c }
    const cases: [string, any, RegExp][] = [
      ['a line ending at a point outside the clip', bad(c => { c.network.lines[0].a = 'elsewhere' }), /needs two of the clip's points/],
      // shapes are only in the clip's shape layers (architecture §1; step 2)
      ['a coordinate that is text', bad(c => { c.network.layers[0].points[0].position.y = '3' }), /is not a finite number/],
      ['a lock that is not true / false', bad(c => { c.network.lines[0].state.locked = 'yes' }), /is not true \/ false/],
      ['a negative stroke width', bad(c => { c.network.layers[0].lines[0].stroke.width = -2 }), /positive number/],
      ['a clip without its source shape layer', bad(c => { c.network.source = 'view:9,9' }), /no shape layer view:9,9, its source/],
      ['a join on a line outside the clip', bad(c => { c.joins.rows[0].lines[0] = 'k1' }), /points outside the clip/],
      ['an arc join without a radius', bad(c => { delete c.joins.rows.find((r: any) => r.mode === 'arc').radius }), /positive radius/],
      ['an unknown join mode', bad(c => { c.joins.rows[0].mode = 'wavy' }), /Unknown join mode wavy/],
      ['a fill on a line outside the clip', bad(c => { c.fills[0].lines[0] = 'gone' }), /points outside the clip/],
      ['a name for a line outside the clip', bad(c => { c.names.lines[0][0] = 'gone' }), /points outside the clip/],
      ['a point id used twice', bad(c => { c.network.points.push({ ...c.network.points[0] }) }), /appears twice/],
    ]
    for (const [label, clip, why] of cases) it(label, () => {
      const before = json([s(d), d.geometry(), d.canUndo])
      expect(() => d.edit(e => e.paste(clip, 'K', P(0, 300), 'bad'))).toThrow(why)
      expect(json([s(d), d.geometry(), d.canUndo])).toBe(before)
    })
  })

  it('6c. the join writer refuses an unknown mode for every caller, not only a clip', () => {
    const d = scene()
    expect(() => d.edit(e => e.join('d', 'w1', 'w2', { mode: 'wavy' as never }))).toThrow(/Unknown join mode wavy/)
  })

  it('6. a clip is plain data: from one document into another, through JSON', () => {
    const d = scene(), other = Core.newDocument()
    const clip = JSON.parse(JSON.stringify(d.copy(eyeLines)))
    other.edit(e => e.paste(clip, 'layer-1', P(0, 0), 'x'))
    expect(s(other).lines).toHaveLength(4)
    expect(s(other).loops.filter(l => l.filled)).toHaveLength(1)
  })

  it('7. one paste is one undo step; undo removes all of it, redo brings it back', () => {
    const d = scene()
    const before = json([s(d), d.geometry()])
    { const clip = d.copy(eyeLines); d.edit(e => e.paste(clip, 'K', P(0, 300), 'p1')) }
    const after = json([s(d), d.geometry()])
    d.undo()
    expect(json([s(d), d.geometry()])).toBe(before)
    d.redo()
    expect(json([s(d), d.geometry()])).toBe(after)
  })

  it('9. a document with pasted content saves and opens equal', () => {
    const d = scene()
    { const clip = d.copy([...eyeLines, 't']); d.edit(e => e.paste(clip, 'K', P(0, 300), 'p1')) }
    const o = open(save(d))
    expect(JSON.parse(json({ ...s(o), selection: [] }))).toEqual(JSON.parse(json({ ...s(d), selection: [] })))
  })
})
