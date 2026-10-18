// Widths belong to points (docs/point-widths-checklist.md, bowen 1791820396): one width per point, for every view (bowen
// 1792057731; docs/shared-strokes-checklist.md), shared by
// every line ending there; a line reads `width` at its a end and `widthB` at its b end (absent when equal).
import { describe, it, expect } from 'vitest'
import { radiiPerView } from './old-files'
import { Core, save, open, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y: number): Vec => ({ x, y })
const line = (d: Core, id: string) => d.snapshot().lines.find(l => l.id === id)!
const width = (d: Core, id: string) => d.snapshot().points.find(p => p.id === id)!.width

function pair() {
  const d = new Core()
  d.edit(e => { e.layer('L'); e.line('l0', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'p', layer: 'L', position: P(40, 0) }); e.line('l1', 'p', { id: 'c', layer: 'L', position: P(80, 0) }) })
  return d
}

describe('widths belong to points', () => {
  it('a new point is 1 wide; a point\'s width is shared by the lines ending there', () => {
    const d = pair()
    expect([width(d, 'a'), width(d, 'p'), width(d, 'c')]).toEqual([1, 1, 1])
    d.edit(e => e.pointWidth('p', 4))
    expect(line(d, 'l0').stroke).toEqual({ width: 1, widthB: 4, profile: 'uniform' })
    expect(line(d, 'l1').stroke).toEqual({ width: 4, widthB: 1, profile: 'uniform' })
    expect(() => d.edit(e => e.pointWidth('p', 0))).toThrow(/positive/)
  })
  it('a line\'s width write sets its two points (and so its neighbours there)', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 2, profile: 'uniform' }))
    expect([width(d, 'a'), width(d, 'p')]).toEqual([4, 2])
    expect(line(d, 'l1').stroke).toEqual({ width: 2, widthB: 1, profile: 'uniform' })
    d.edit(e => e.lineStroke('l0', { width: 3, profile: 'uniform' }))
    expect(line(d, 'l0').stroke).toEqual({ width: 3, profile: 'uniform' })
  })
  it('one width for every view: set in one view, every view reads it; undo restores everywhere', () => {
    const d = pair()
    d.editIn('view:90,0', e => e.pointWidth('p', 5))
    for (const k of d.views()) expect([k, d.in(k).snapshot().points.find(p => p.id === 'p')!.width]).toEqual([k, 5])
    d.undo()
    for (const k of d.views()) expect([k, d.in(k).snapshot().points.find(p => p.id === 'p')!.width]).toEqual([k, 1])
  })
  it('saved and opened unchanged (current version, 15)', () => {
    const d = pair()
    d.edit(e => e.pointWidth('p', 6))
    const text = save(d)
    expect(JSON.parse(text).version).toBe(15)
    expect(width(open(text), 'p')).toBe(6)
    expect(save(open(text))).toBe(text)
  })
  it('a version 8 file (widths on lines) opens converted: each point takes the largest width its lines had there', () => {
    const d = pair()
    d.edit(e => e.pointWidth('a', 3))
    const v9 = radiiPerView(JSON.parse(save(d)))
    // the same drawing as version 8 wrote it, with l0 ending 2 wide at p and l1 starting 5 wide there
    const lines = v9.document.network.lines as { id: string; a: string; b: string }[]
    for (const L of v9.document.network.shapes.layers) {
      for (const l of lines) L.lines[l.id].stroke = { width: L.widths[l.a], ...(L.widths[l.b] !== L.widths[l.a] ? { widthB: L.widths[l.b] } : {}), profile: 'uniform' }
      if (L.key === 'view:0,0') { L.lines.l0.stroke = { width: 3, widthB: 2, profile: 'uniform' }; L.lines.l1.stroke = { width: 5, widthB: 1, profile: 'uniform' } }
      delete L.widths
    }
    v9.version = 8
    const back = open(JSON.stringify(v9))
    expect(['a', 'p', 'c'].map(id => width(back, id))).toEqual([3, 5, 1])
    // one width per point for every view since version 14: the front's (bowen 1792057731)
    expect(back.in('view:90,0').snapshot().points.map(p => p.width)).toEqual([3, 5, 1])
    expect(JSON.parse(save(back)).version).toBe(15)
  })
  it('a version 8 file with a bad old width is refused, not opened with another width (dot 1791821589)', () => {
    const d = pair()
    const v9 = radiiPerView(JSON.parse(save(d))), lines = v9.document.network.lines as { id: string; a: string; b: string }[]
    for (const L of v9.document.network.shapes.layers) { for (const l of lines) L.lines[l.id].stroke = { width: 1, profile: 'uniform' }; delete L.widths }
    v9.version = 8
    const front = v9.document.network.shapes.layers.find((L: { key: string }) => L.key === 'view:0,0')
    for (const [field, value, why] of [['width', 'wide', /stroke width that is not a positive number/], ['width', -2, /stroke width that is not a positive number/], ['widthB', -1, /end width that is not a positive number/], ['widthB', 'x', /end width that is not a positive number/]] as const) {
      const f = structuredClone(v9)
      f.document.network.shapes.layers.find((L: { key: string }) => L.key === 'view:0,0').lines.l1.stroke[field] = value
      expect(() => open(JSON.stringify(f))).toThrow(why)
    }
    expect(front).toBeDefined()
    expect(() => open(JSON.stringify(v9))).not.toThrow()
  })
  it('copied and pasted with their points', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }))
    const clip = d.copy(['l0'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'q'))
    const pasted = d.snapshot().lines.filter(l => l.id !== 'l0' && l.id !== 'l1')
    expect(pasted.map(l => l.stroke)).toEqual([{ width: 4, widthB: 1, profile: 'uniform' }])
  })
  it('split: the new point takes the width at the cut, linear in arc length — a straight 4 → 1 cut at 0.4 is 2.8', () => {
    const d = pair()
    d.edit(e => e.lineStroke('l0', { width: 4, widthB: 1, profile: 'uniform' }))
    d.edit(e => e.split('l0', 0.4, 'm', 'h1', 'h2'))
    expect(width(d, 'm')).toBeCloseTo(2.8, 3)
    expect(line(d, 'h1').stroke.width).toBe(4)
    expect(line(d, 'h2').stroke.widthB).toBe(1)
  })
  it('bind: the kept point keeps its width; unbind: the new point copies it', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); e.line('x', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(10, 0) }); e.line('y', { id: 'c', layer: 'L', position: P(20, 0) }, { id: 'e', layer: 'L', position: P(30, 0) }) })
    d.edit(e => { e.pointWidth('b', 5); e.pointWidth('c', 2) })
    d.edit(e => e.bind('b', 'c'))
    expect(width(d, 'b')).toBe(5)
    expect(line(d, 'y').stroke.width).toBe(5)
    d.edit(e => e.unbind('b', ['y'], 'b2'))
    expect(width(d, 'b2')).toBe(5)
  })
  it('mirror apply onto a line drawn the other way round: each target point takes its source point\'s width', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(-10, 0)); sk(e).point('b', 'A', P(-2, 6)); sk(e).line('s', 'a', 'b')
      sk(e).point('c', 'A', P(2.5, 6)); sk(e).point('d', 'A', P(9, 0.5)); sk(e).line('t', 'c', 'd')
      e.lineStroke('s', { width: 4, widthB: 1, profile: 'uniform' })
    })
    d.edit(e => e.mirrorApply(['s'], ['t'])) // matched reversed: d = R(a), c = R(b)
    expect([width(d, 'd'), width(d, 'c')]).toEqual([4, 1])
    expect(line(d, 't').stroke).toEqual({ width: 1, widthB: 4, profile: 'uniform' })
  })
  it('the automatic zone reads the shared width: both lines are 3 at p → 3² / 3 = 3', () => {
    const d = pair()
    d.edit(e => e.pointWidth('p', 3))
    expect(d.in('view:0,0').zones().find(x => x.point === 'p')!.desired).toBeCloseTo(3, 9)
  })
})

describe('a free end\'s taper (bowen 1791853511): endStroke.taper is a multiple of the end width, 0 or more', () => {
  it('accepted 0 and above, one for every view (bowen 1792057731); a negative or non-number taper is refused', () => {
    const d = pair()
    d.edit(e => e.endStroke('a', { taper: 0 }))
    d.edit(e => e.endStroke('c', { taper: 6 }))
    expect(d.snapshot().points.find(p => p.id === 'c')!.endStroke).toEqual({ taper: 6 })
    expect(d.in('view:90,0').snapshot().points.find(p => p.id === 'c')!.endStroke).toEqual({ taper: 6 })
    expect(() => d.edit(e => e.endStroke('a', { taper: -1 }))).toThrow(/0 or more/)
    expect(() => d.edit(e => e.endStroke('a', { taper: 'long' as unknown as number }))).toThrow(/0 or more/)
    expect(save(open(save(d)))).toBe(save(d))
  })
})
