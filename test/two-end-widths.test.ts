// Two end widths per line (docs/two-end-widths-checklist.md, bowen 1791818995): `width` at the a end, `widthB` at the
// b end, absent when equal; per view; saved, copied, read by the zones at the joint's end.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y: number): Vec => ({ x, y })
const line = (d: Core, id: string) => d.snapshot().lines.find(l => l.id === id)!

function pair() {
  const d = new Core()
  d.edit(e => { e.layer('L'); e.line('l0', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'p', layer: 'L', position: P(40, 0) }); e.line('l1', 'p', { id: 'c', layer: 'L', position: P(80, 0) }) })
  return d
}

describe('two end widths', () => {
  it('stored per line: widthB kept when it differs, dropped when equal (one form per content)', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }))
    expect(line(d, 'l0').stroke).toEqual({ width: 4, widthB: 1, profile: 'uniform' })
    d.edit(e => e.lineStroke('l0', { width: 2, widthB: 2, profile: 'uniform' }))
    expect(line(d, 'l0').stroke).toEqual({ width: 2, profile: 'uniform' })
    expect(() => d.edit(e => e.lineStroke('l0', { width: 2, widthB: 0, profile: 'uniform' }))).toThrow(/end width/)
  })
  it('per view: another view keeps its own widths; undo restores', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }))
    expect(d.in('view:90,0').snapshot().lines.find(l => l.id === 'l0')!.stroke).toEqual({ width: 1, profile: 'uniform' })
    d.undo()
    expect(line(d, 'l0').stroke).toEqual({ width: 1, profile: 'uniform' })
  })
  it('saved and opened unchanged; a file storing widthB equal to width is refused', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l1', { width: 3, widthB: 6, profile: 'uniform' }))
    const text = save(d)
    expect(line(open(text), 'l1').stroke).toEqual({ width: 3, widthB: 6, profile: 'uniform' })
    expect(save(open(text))).toBe(text)
    expect(() => open(text.replace('"widthB":6', '"widthB":3'))).toThrow(/one form per content/)
  })
  it('copied and pasted with the line', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }))
    const clip = d.copy(['l0'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'q'))
    const pasted = d.snapshot().lines.filter(l => l.id !== 'l0' && l.id !== 'l1')
    expect(pasted.map(l => l.stroke)).toEqual([{ width: 4, widthB: 1, profile: 'uniform' }])
  })
  it('the automatic zone reads each line\'s width at the joint: l0 ends with 1 at p, l1 starts with 3 → 3² / 1 = 9', () => {
    const d = pair()
    d.edit(e => { e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }); e.lineStroke('l1', { width: 3, profile: 'uniform' }) })
    const z = d.in('view:0,0').zones().find(x => x.point === 'p')!
    expect(z.desired).toBeCloseTo(9, 9)
  })
  it('split (dot 1791819133): both halves take the width at the cut, linear in arc length — a straight 4 → 1 cut at 0.4 meets at 2.8', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }))
    d.edit(e => e.split('l0', 0.4, 'm', 'h1', 'h2'))
    expect(line(d, 'h1').stroke.width).toBe(4)
    expect(line(d, 'h1').stroke.widthB).toBeCloseTo(2.8, 3)
    expect(line(d, 'h2').stroke.width).toBeCloseTo(2.8, 3)
    expect(line(d, 'h2').stroke.widthB).toBe(1)
  })
  it('a uniform line splits into two uniform halves, as before', () => {
    const d = pair()
    d.edit(e => e.split('l0', 0.4, 'm', 'h1', 'h2'))
    expect([line(d, 'h1').stroke, line(d, 'h2').stroke]).toEqual([{ width: 1, profile: 'uniform' }, { width: 1, profile: 'uniform' }])
  })
  it('mirror apply onto a line drawn the other way round swaps the end widths with its ends (dot 1791819133)', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(-10, 0)); sk(e).point('b', 'A', P(-2, 6)); sk(e).line('s', 'a', 'b')
      sk(e).point('c', 'A', P(2.5, 6)); sk(e).point('d', 'A', P(9, 0.5)); sk(e).line('t', 'c', 'd')
      e.lineStroke('s', { width: 4, widthB: 1, profile: 'uniform' })
    })
    d.edit(e => e.mirrorApply(['s'], ['t'])) // matched reversed: d = R(a), c = R(b)
    expect(line(d, 't').stroke).toEqual({ width: 1, widthB: 4, profile: 'uniform' })
  })
})
