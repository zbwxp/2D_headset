// Module-level checks for network (the acceptance file tests through Core).
import { describe, it, expect } from 'vitest'
import * as net from '../src/network'

function grid() {
  // 3×3 points, 12 lines: 13 simple loops (2×2 grid of cells)
  const n = net.create({ key: 'view:0,0', kind: 'view' }), ch = net.emptyChanges()
  net.addLayer(n, 'L')
  const made = new Set<string>()
  const end = (x: number, y: number): net.EndSpec => {
    const id = `p${x}${y}`
    if (made.has(id)) return id
    made.add(id)
    return { id, layer: 'L', position: { x, y } }
  }
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x < 2) net.addLine(n, ch, `h${x}${y}`, end(x, y), end(x + 1, y))
    if (y < 2) net.addLine(n, ch, `v${x}${y}`, end(x, y), end(x, y + 1))
  }
  return n
}

describe('network', () => {
  it('finds every closed curve of a 2×2 grid once: 13 simple loops plus the 2 diagonal cell pairs meeting at the centre', () => {
    const loops = net.closedLoops(grid())
    expect(loops).toHaveLength(15)
    expect(new Set(loops.map(l => l.key)).size).toBe(15)
  })

  it('a loop route is a closed walk: each step starts where the previous ended', () => {
    const n = grid()
    for (const loop of net.closedLoops(n)) {
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
    expect(ch.replaced).toEqual([{ line: 'h00', a: 'p00', b: 'p10', mid: 'm', pieces: ['h00a', 'h00b'], t: 0.5 }])
  })

  it('components follow shared points', () => {
    const n = grid(), ch = net.emptyChanges()
    expect(net.components(n)).toHaveLength(1)
    net.unbind(n, ch, 'p11', net.linesAt(n, 'p11').map(e => e.line.id).slice(0, 1), 'p11x')
    expect(net.components(n)).toHaveLength(1)
  })
})

describe('closed-curve search cost (dot 1791430851)', () => {
  it('20 small loops strung together by single lines (59 lines): 20 loops, found quickly', () => {
    const n = net.create({ key: 'view:0,0', kind: 'view' }), ch = net.emptyChanges()
    net.addLayer(n, 'L')
    // loop i: two lines between p_i and q_i; consecutive loops joined by one line: 20·2 + 19 = 59 lines
    const made = new Set<string>()
    const end = (id: string, x: number, y: number): net.EndSpec => (made.has(id) ? id : (made.add(id), { id, layer: 'L', position: { x, y } }))
    for (let i = 0; i < 20; i++) {
      const x = i * 10
      net.addLine(n, ch, `t${i}a`, end(`p${i}`, x, 0), end(`q${i}`, x + 3, 0))
      net.addLine(n, ch, `t${i}b`, `p${i}`, `q${i}`, { ha: { x: 1, y: 2 }, hb: { x: -1, y: 2 } })
      if (i > 0) net.addLine(n, ch, `bridge${i}`, `q${i - 1}`, `p${i}`)
    }
    expect(net.lines(n)).toHaveLength(59)
    const t0 = performance.now()
    const loops = net.closedLoops(n)
    expect(loops).toHaveLength(20)
    expect(performance.now() - t0).toBeLessThan(200)
  })

  it('two blocks sharing a point give their loops plus the curve through that point twice', () => {
    const n = net.create({ key: 'view:0,0', kind: 'view' }), ch = net.emptyChanges()
    net.addLayer(n, 'L')
    net.addLine(n, ch, 'x1', { id: 'c', layer: 'L', position: { x: 0, y: 0 } }, { id: 'u', layer: 'L', position: { x: 5, y: 5 } })
    net.addLine(n, ch, 'x2', 'u', { id: 'w', layer: 'L', position: { x: 0, y: 8 } }); net.addLine(n, ch, 'x3', 'w', 'c')
    net.addLine(n, ch, 'y1', 'c', { id: 'v', layer: 'L', position: { x: 5, y: -5 } })
    net.addLine(n, ch, 'y2', 'v', { id: 'z', layer: 'L', position: { x: 0, y: -8 } }); net.addLine(n, ch, 'y3', 'z', 'c')
    expect(net.closedLoops(n)).toHaveLength(3)
  })
})
