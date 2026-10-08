// Module-level checks for network (the acceptance file tests through Core).
import { describe, it, expect } from 'vitest'
import * as net from '../src/network'

function grid() {
  // 3×3 points, 12 lines: 13 simple loops (2×2 grid of cells)
  const n = net.create(), ch = net.emptyChanges()
  net.addLayer(n, 'L')
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) net.addPoint(n, `p${x}${y}`, 'L', { x, y })
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x < 2) net.addLine(n, ch, `h${x}${y}`, `p${x}${y}`, `p${x + 1}${y}`)
    if (y < 2) net.addLine(n, ch, `v${x}${y}`, `p${x}${y}`, `p${x}${y + 1}`)
  }
  return n
}

describe('network', () => {
  it('finds all 13 simple loops of a 2×2 grid, each once', () => {
    const loops = net.simpleLoops(grid())
    expect(loops).toHaveLength(13)
    expect(new Set(loops.map(l => l.key)).size).toBe(13)
  })

  it('a loop route is a closed walk: each step starts where the previous ended', () => {
    const n = grid()
    for (const loop of net.simpleLoops(n)) {
      const ends = loop.route.map(u => { const l = net.line(n, u.line); return u.reversed ? [l.b, l.a] : [l.a, l.b] })
      for (let i = 0; i < ends.length; i++) expect(ends[i]![1]).toBe(ends[(i + 1) % ends.length]![0])
    }
  })

  it('split keeps the curve shape and order', () => {
    const n = grid(), ch = net.emptyChanges()
    const before = net.curve(n, 'h00')
    net.splitLine(n, ch, 'h00', 0.5, 'm', 'h00a', 'h00b')
    expect(net.curve(n, 'h00a')[0]).toEqual(before[0])
    expect(net.curve(n, 'h00b')[3]).toEqual(before[3])
    expect(net.lines(n).findIndex(l => l.id === 'h00a')).toBe(0)
    expect(ch.replaced).toEqual([{ line: 'h00', a: 'p00', b: 'p10', mid: 'm', pieces: ['h00a', 'h00b'] }])
  })

  it('components follow shared points', () => {
    const n = grid(), ch = net.emptyChanges()
    expect(net.components(n)).toHaveLength(1)
    net.unbind(n, ch, 'p11', net.linesAt(n, 'p11').map(e => e.line.id).slice(0, 1), 'p11x')
    expect(net.components(n)).toHaveLength(1)
  })
})
