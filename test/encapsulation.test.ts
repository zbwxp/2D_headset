// Runtime encapsulation checks (dot 1791427188): reads are copies, inputs are copied.
import { describe, it, expect } from 'vitest'
import * as net from '../src/network'
import { Core } from '../src'
import { sk } from './sketch'

function small() {
  const n = net.create(), ch = net.emptyChanges()
  net.addLayer(n, 'L')
  const pos = { x: 1, y: 2 }
  net.addLine(n, ch, 'ab', { id: 'a', layer: 'L', position: pos }, { id: 'b', layer: 'L', position: { x: 5, y: 2 } })
  return { n, pos }
}

describe('network encapsulation', () => {
  it('changing the caller’s input object later does not change the network', () => {
    const { n, pos } = small()
    pos.x = 99
    expect(net.point(n, 'a').position).toEqual({ x: 1, y: 2 })
  })

  it('read results are frozen copies: writing to them throws and leaves the network unchanged', () => {
    const { n } = small()
    const p = net.point(n, 'a') as { position: { x: number } }
    expect(() => { p.position = { x: 7 } }).toThrow(TypeError)
    expect(() => { (net.lines(n) as unknown as unknown[]).push(1) }).toThrow(TypeError)
    expect(() => { (net.line(n, 'ab').ha as { x: number }).x = 50 }).toThrow(TypeError)
    expect(net.point(n, 'a').position).toEqual({ x: 1, y: 2 })
    expect(net.line(n, 'ab').ha.x).toBeCloseTo(4 / 3)
  })

  it('non-finite coordinates are refused', () => {
    const { n } = small()
    expect(() => net.addLine(n, net.emptyChanges(), 'bc', 'b', { id: 'c', layer: 'L', position: { x: NaN, y: 0 } })).toThrow(/finite/)
  })

  it('a Core snapshot is detached from the document', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); sk(e).point('a', 'L', { x: 0, y: 0 }); sk(e).point('b', 'L', { x: 1, y: 0 }); sk(e).line('ab', 'a', 'b') })
    const snap = d.snapshot()
    snap.points[0]!.position = { x: 5, y: 5 }
    expect(d.snapshot().points[0]!.position).toEqual({ x: 0, y: 0 })
  })
})
