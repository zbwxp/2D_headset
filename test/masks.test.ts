// Masks (显隐) in the drawing — docs/mask-p2-checklist.md §5: make / remove / refusals, the lock rule, reference upkeep
// (split, delete, clear, a loop broken, a fill switched off), copy / paste / copy layer, the archive (v10, v9, bad files).
import { describe, it, expect } from 'vitest'
import { radiiPerView } from './old-files'
import { Core, save, open } from '../src'

const P = (x: number, y = 0) => ({ x, y })
/** A filled square abcd and a filled triangle efg in L, a line xy in L, a line qr in M. */
function scene() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.layer('M', 'M')
    e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) })
    e.line('cd', 'c', { id: 'd', layer: 'L', position: P(0, 10) })
    e.line('da', 'd', 'a')
    e.line('ef', { id: 'e', layer: 'L', position: P(100) }, { id: 'f', layer: 'L', position: P(110) })
    e.line('fg', 'f', { id: 'g', layer: 'L', position: P(105, 8) })
    e.line('ge', 'g', 'e')
    e.line('xy', { id: 'x', layer: 'L', position: P(-5, 5) }, { id: 'y', layer: 'L', position: P(15, 5) })
    e.line('qr', { id: 'q', layer: 'M', position: P(30, 30) }, { id: 'r', layer: 'M', position: P(40, 30) })
  })
  d.edit(e => { for (const l of d.snapshot().loops) e.fill(l.id, '#ccc') })
  return d
}
const loopOf = (d: Core, line: string) => d.snapshot().loops.find(l => l.route.some(u => u.line === line))!.id
const masks = (d: Core) => d.snapshot().masks
const line = (id: string) => ({ kind: 'line' as const, id })

describe('masks in the drawing', () => {
  it('made and removed by one edit each, listed in the snapshot, undone and redone', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => e.mask('m1', [sq, tri], line('xy'), 'inverse'))
    d.edit(e => e.mask('m2', [sq], { kind: 'fill', id: tri }, 'normal'))
    expect(masks(d)).toEqual([
      { id: 'm1', sources: [sq, tri], target: line('xy'), mode: 'inverse' },
      { id: 'm2', sources: [sq], target: { kind: 'fill', id: tri }, mode: 'normal' },
    ])
    d.edit(e => e.removeMask('m1'))
    expect(masks(d).map(m => m.id)).toEqual(['m2'])
    d.undo(); expect(masks(d).map(m => m.id)).toEqual(['m1', 'm2'])
    d.redo(); expect(masks(d).map(m => m.id)).toEqual(['m2'])
  })

  it('refused, nothing written: an id in use, no source, a repeated source, an unknown or unfilled source, an unknown target, a fill masking itself, an unknown mode, an unknown mask', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => e.mask('m1', [sq], line('xy'), 'inverse'))
    const before = save(d)
    const bad: [() => void, RegExp][] = [
      [() => d.edit(e => e.mask('m1', [tri], line('qr'), 'inverse')), /already exists/],
      [() => d.edit(e => e.mask('m2', [], line('qr'), 'inverse')), /needs a source/],
      [() => d.edit(e => e.mask('m2', [sq, sq], line('qr'), 'inverse')), /twice/],
      [() => d.edit(e => e.mask('m2', ['nope'], line('qr'), 'inverse')), /not a filled closed curve/],
      [() => d.edit(e => e.mask('m2', [sq], line('nope'), 'inverse')), /no line nope/],
      [() => d.edit(e => e.mask('m2', [sq], { kind: 'fill', id: 'nope' }, 'inverse')), /not a filled closed curve/],
      [() => d.edit(e => e.mask('m2', [sq], { kind: 'fill', id: sq }, 'inverse')), /cannot mask itself/],
      [() => d.edit(e => e.mask('m2', [sq], line('qr'), 'sideways' as never)), /unknown mode/],
      [() => d.edit(e => e.removeMask('m9')), /No mask m9/],
    ]
    for (const [f, why] of bad) { expect(f).toThrow(why); expect(save(d)).toBe(before) }
  })

  it('the same rule twice on one target is refused, in any source order; another mode or another target is a new mask (bowen 1791908041)', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => e.mask('m1', [sq, tri], line('xy'), 'inverse'))
    const before = save(d)
    expect(() => d.edit(e => e.mask('m2', [tri, sq], line('xy'), 'inverse'))).toThrow(/mask-exists/)
    expect(save(d)).toBe(before)
    d.edit(e => { e.mask('m3', [sq, tri], line('xy'), 'normal'); e.mask('m4', [sq, tri], line('qr'), 'inverse'); e.mask('m5', [sq], line('xy'), 'inverse') })
    expect(masks(d).map(m => m.id)).toEqual(['m1', 'm3', 'm4', 'm5'])
  })

  it('locks are not consulted: a locked target or source takes masks and loses them (bowen 1791903940)', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => e.mask('m1', [sq], line('xy'), 'inverse'))
    d.edit(e => { e.lineState('xy', { locked: true }); e.fillState(tri, { locked: true }) })
    d.edit(e => { e.mask('m2', [sq], line('xy'), 'normal'); e.mask('m3', [sq], { kind: 'fill', id: tri }, 'normal'); e.mask('m4', [tri], line('qr'), 'inverse') })
    d.edit(e => e.removeMask('m1'))
    expect(masks(d).map(m => m.id)).toEqual(['m2', 'm3', 'm4'])
  })
})

describe('reference upkeep', () => {
  it('a target line split: the mask on both pieces, the second a mask of its own; a split source fill keeps its masks', () => {
    const d = scene(), sq = loopOf(d, 'ab')
    d.edit(e => e.mask('m1', [sq], line('xy'), 'inverse'))
    d.edit(e => e.split('xy', 0.5, 'mid', 'xy1', 'xy2'))
    expect(masks(d)).toEqual([
      { id: 'm1', sources: [sq], target: line('xy1'), mode: 'inverse' },
      { id: 'm1/xy2', sources: [sq], target: line('xy2'), mode: 'inverse' },
    ])
    d.edit(e => e.split('cd', 0.5, 'm', 'cd1', 'cd2')) // the source's boundary: the fill keeps its id
    expect(masks(d).map(m => m.sources)).toEqual([[sq], [sq]])
  })

  it('a second split never takes a mask id in use', () => {
    const d = scene(), sq = loopOf(d, 'ab')
    d.edit(e => { e.mask('m1', [sq], line('xy'), 'inverse'); e.mask('m1/xy2', [sq], line('qr'), 'normal') })
    d.edit(e => e.split('xy', 0.5, 'mid', 'xy1', 'xy2'))
    expect(masks(d).map(m => [m.id, m.target.id])).toEqual([['m1', 'xy1'], ['m1/xy2~2', 'xy2'], ['m1/xy2', 'qr']])
  })

  it('a target gone takes its masks: a line deleted, a fill cleared', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => { e.mask('m1', [sq], line('xy'), 'inverse'); e.mask('m2', [sq], { kind: 'fill', id: tri }, 'normal'); e.mask('m3', [tri], line('qr'), 'inverse') })
    d.edit(e => e.deleteLine('xy'))
    expect(masks(d).map(m => m.id)).toEqual(['m2', 'm3'])
    d.edit(e => e.clearFill(tri))
    expect(masks(d).map(m => m.id)).toEqual([]) // m2's target and m3's only source were the triangle
  })

  it('a source gone leaves the sources (cleared, or its loop broken); a mask with none left goes; a fill switched off keeps them (dot 1791903786)', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => { e.mask('m1', [sq, tri], line('xy'), 'inverse'); e.mask('m2', [sq], line('qr'), 'normal') })
    d.edit(e => e.fillVisible(sq, false))
    expect(masks(d).map(m => m.sources)).toEqual([[sq, tri], [sq]])
    d.edit(e => e.deleteLine('bc')) // the square's loop breaks: its fill goes
    expect(masks(d)).toEqual([{ id: 'm1', sources: [tri], target: line('xy'), mode: 'inverse' }])
    d.undo()
    d.edit(e => e.clearFill(sq))
    expect(masks(d)).toEqual([{ id: 'm1', sources: [tri], target: line('xy'), mode: 'inverse' }])
  })
})

describe('copy, paste, copy layer', () => {
  it('a mask goes with the clip only when its target and every source are in it; new ids as the clip\'s other records', () => {
    const d = scene(), sq = loopOf(d, 'ab'), tri = loopOf(d, 'ef')
    d.edit(e => { e.mask('m1', [sq], line('xy'), 'inverse'); e.mask('m2', [sq, tri], line('xy'), 'normal') })
    expect(d.copy(['xy']).masks).toEqual([])
    const clip = d.copy(['ab', 'bc', 'cd', 'da', 'xy'])
    expect(clip.masks!.map(m => m.id)).toEqual(['m1'])
    d.edit(e => e.paste(clip, 'M', P(200), 'p'))
    const pasted = d.snapshot().loops.find(l => l.route.some(u => u.line === 'p/ab'))!.id
    expect(masks(d).filter(m => m.id.startsWith('p/'))).toEqual([{ id: 'p/m1', sources: [pasted], target: line('p/xy'), mode: 'inverse' }])
  })

  it('copy layer carries the layer\'s masks onto the copies', () => {
    const d = scene(), sq = loopOf(d, 'ab')
    d.edit(e => e.mask('m1', [sq], line('xy'), 'inverse'))
    d.edit(e => e.copyLayer('L', 'L2'))
    const copy = d.snapshot().loops.find(l => l.route.some(u => u.line === 'L2/ab'))!.id
    expect(masks(d)).toContainEqual({ id: 'L2/m1', sources: [copy], target: line('L2/xy'), mode: 'inverse' })
  })

  it('a clip whose masks point outside it is refused whole; a clip without masks (older) pastes with none', () => {
    const d = scene(), sq = loopOf(d, 'ab')
    d.edit(e => e.mask('m1', [sq], line('xy'), 'inverse'))
    const clip = d.copy(['ab', 'bc', 'cd', 'da', 'xy']), before = save(d)
    type W = { sources: string[]; target: { kind: string; id: string } }
    const bad = structuredClone(clip); (bad.masks![0] as unknown as W).sources = ['elsewhere']
    expect(() => d.edit(e => e.paste(bad, 'M', P(200), 'p'))).toThrow(/clip-invalid|sources must be distinct fills of the clip/)
    const badTarget = structuredClone(clip); (badTarget.masks![0] as unknown as W).target = line('qr')
    expect(() => d.edit(e => e.paste(badTarget, 'M', P(200), 'p'))).toThrow(/target must be/)
    expect(save(d)).toBe(before)
    const old = structuredClone(clip); delete old.masks
    d.edit(e => e.paste(old, 'M', P(200), 'p'))
    expect(masks(d).map(m => m.id)).toEqual(['m1'])
  })
})

describe('the archive', () => {
  it('the current version keeps the masks; a version 9 file opens with none', () => {
    const d = scene(), sq = loopOf(d, 'ab')
    d.edit(e => e.mask('m1', [sq], line('xy'), 'inverse'))
    const text = save(d)
    expect(JSON.parse(text).version).toBe(14)
    expect(masks(open(text))).toEqual(masks(d))
    expect(save(open(text))).toBe(text)
    const v9 = radiiPerView(JSON.parse(text)); v9.version = 9; delete v9.document.masks
    expect(masks(open(JSON.stringify(v9)))).toEqual([])
  })

  it('a bad mask refuses the file, never repaired: a missing source, a missing target, a repeated id, an unknown mode, an unfilled target', () => {
    const d = scene(), sq = loopOf(d, 'ab')
    d.edit(e => { e.mask('m1', [sq], line('xy'), 'inverse'); e.mask('m2', [sq], line('qr'), 'normal') })
    const text = save(d)
    const edit = (f: (ms: { id: string; sources: string[]; target: { kind: string; id: string }; mode: string }[]) => void) => { const x = JSON.parse(text); f(x.document.masks.masks); return JSON.stringify(x) }
    expect(() => open(edit(ms => { ms[0]!.sources = ['gone'] }))).toThrow(/open-failed.*not a filled closed curve/)
    expect(() => open(edit(ms => { ms[0]!.target.id = 'gone' }))).toThrow(/open-failed.*no line gone/)
    expect(() => open(edit(ms => { ms[1]!.id = 'm1' }))).toThrow(/open-failed.*already exists/)
    expect(() => open(edit(ms => { ms[0]!.mode = 'both' }))).toThrow(/open-failed.*unknown mode/)
    expect(() => open(edit(ms => { ms[0]!.target = { kind: 'fill', id: 'gone' } }))).toThrow(/open-failed.*not a filled closed curve/)
  })
})
