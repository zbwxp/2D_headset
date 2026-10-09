// Save and open (graph "Save and open", design 977137f; docs/archive-plan.md acceptance 1–4).
// The fuzz round trip (acceptance 1, every published state) is in fuzz.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y: number): Vec => ({ x, y })
// compared as JSON: a file cannot tell -0 from 0, and the two are equal numbers
const json = (x: unknown) => JSON.parse(JSON.stringify(x))
const same = (a: Core, b: Core) => {
  expect(json({ ...b.snapshot(), selection: [] })).toEqual(json({ ...a.snapshot(), selection: [] }))
  expect(json(b.geometry())).toEqual(json(a.geometry()))
}

/** Two eyes: smooth joins, an arc corner, a fill, names, a mirror link, and an endpoint link to a third layer. */
function eyes() {
  const d = new Core({ axis: 0 })
  const p = (id: string, x: number, y: number, layer = 'L') => ({ id, layer, position: P(x, y) })
  d.edit(e => {
    e.layer('L', '左'); e.layer('K', '其他')
    e.line('u1', p('a', -300, 0), p('b', -200, -60)); e.line('u2', 'b', p('c', -100, 0)); e.line('w1', 'c', p('d', -200, 40)); e.line('w2', 'd', 'a')
    e.line('k1', p('k', -100, 0, 'K'), p('k2', -50, 50, 'K'))
  })
  d.edit(e => { e.join('b', 'u1', 'u2', { mode: 'smooth' }); e.join('d', 'w1', 'w2', { mode: 'smooth' }); e.join('a', 'u1', 'w2', { mode: 'arc', radius: 10 }); e.link('c', 'k') })
  d.edit(e => e.fill(d.snapshot().loops[0]!.id, '#f2c94c'))
  d.edit(e => { e.renameLine('u1', '左上眼睑外'); e.copyLayer('L', 'R') })
  d.edit(e => { e.selectGroup('R/u1'); e.translate(400, 0); e.flip() })
  const g = (l: string) => d.snapshot().groups.find(x => x.lines.includes(l))!.id
  d.edit(e => e.mirrorLink([g('u1')], [g('R/u1')]))
  d.edit(e => e.lineState('u2', { locked: true }))
  return d
}

describe('save and open', () => {
  it('1a. the two eyes open equal: snapshot (selection apart) and geometry', () => {
    const d = eyes()
    d.edit(e => e.select([{ kind: 'line', id: 'u1' }]))
    const o = open(save(d))
    same(d, o)
    expect(o.snapshot().selection).toEqual([])
  })

  it('1b. the v2 right eye with its mirror-linked copy opens equal', () => {
    const eye = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v2-right-eye.json'), 'utf8')) as {
      axis: number; layers: { id: string; name: string }[]; links: [string, string][]
      lines: { id: string; layer: string; a: string; b: string; pa: Vec; pb: Vec; ha: Vec; hb: Vec }[]
    }
    const d = new Core({ axis: eye.axis }), made = new Set<string>()
    const end = (id: string, layer: string, at: Vec) => { if (made.has(id)) return id; made.add(id); return { id, layer, position: at } }
    d.edit(e => {
      for (const L of eye.layers) e.layer(L.id, L.name)
      for (const l of eye.lines) e.line(l.id, end(l.a, l.layer, l.pa), end(l.b, l.layer, l.pb), { ha: l.ha, hb: l.hb })
      for (const [a, b] of eye.links) e.link(a, b)
    })
    d.edit(e => { for (const L of eye.layers) e.copyLayer(L.id, `C${L.id}`) })
    const layerOf = (id: string) => eye.lines.find(l => l.a === id || l.b === id)!.layer
    d.edit(e => { for (const [a, b] of eye.links) e.link(`C${layerOf(a)}/${a}`, `C${layerOf(b)}/${b}`) }) // links are not copied
    const gs = d.snapshot().groups
    d.edit(e => e.mirrorLink(gs.filter(g => !g.layer.startsWith('C')).map(g => g.id), gs.filter(g => g.layer.startsWith('C')).map(g => g.id)))
    same(d, open(save(d)))
  })

  it('2. the opened document works: empty history, the same edit gives the same result, new ids and names do not collide', () => {
    const d = eyes(), o = open(save(d))
    expect(o.canUndo).toBe(false)
    expect(o.canRedo).toBe(false)
    for (const x of [d, o]) x.edit(e => { e.select([{ kind: 'point', id: 'd' }]); e.translate(0, 15); e.split('w1', 0.5, 'm', 'w1a', 'w1b') })
    same(d, o)
    // a new line makes a new group: its id and default names are new in both
    for (const x of [d, o]) x.edit(e => e.line('n1', { id: 'n', layer: 'K', position: P(0, 200) }, { id: 'n2', layer: 'K', position: P(50, 200) }))
    same(d, o)
    const s = o.snapshot(), names = [...s.layers.map(l => l.name), ...s.groups.map(g => g.name), ...s.lines.map(l => l.name)]
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(s.groups.map(g => g.id)).size).toBe(s.groups.length)
    o.undo()
    expect(o.snapshot().lines.find(l => l.id === 'n1')).toBeUndefined()
  })

  describe('3. damaged or foreign files are refused with open-failed, and nothing else changes', () => {
    const d = eyes(), good = save(d)
    const edit = (f: (doc: any) => void) => { const x = JSON.parse(good); f(x.document); return JSON.stringify(x) }
    const cases: [string, string, RegExp][] = [
      ['not JSON', '{oops', /not JSON/],
      ['another format', JSON.stringify({ format: 'something', version: 1, document: {} }), /not a headset v3 drawing/],
      ['another version', good.replace('"version":1', '"version":2'), /unsupported version 2/],
      ['a missing part', edit(doc => { delete doc.links }), /missing links/],
      ['a line pointing to a missing point', edit(doc => { doc.network.lines[0].a = 'nowhere' }), /open-failed/],
      ['a point id used twice', edit(doc => { doc.network.points.push({ ...doc.network.points[0] }) }), /open-failed/],
      ['a duplicate name', edit(doc => { doc.names.line[1][1] = doc.names.line[0][1] }), /open-failed: Name/],
      // data that reads fine but would break a later edit (dot 1791512144)
      ['usedLines missing', edit(doc => { delete doc.network.usedLines }), /usedLines is not a list/],
      ['usedLines emptied (an existing line id could be drawn again)', edit(doc => { doc.network.usedLines = [] }), /is not marked as used/],
      ['groups.next behind an existing g-id', edit(doc => { doc.groups.next = 1 }), /would make g1 again/],
      ['a coordinate that is text', edit(doc => { doc.network.points[0].position.x = 'oops' }), /position.x is not a finite number/],
      ['a line ending at a point of another layer', edit(doc => { const l = doc.network.lines.find((x: any) => x.id === 'k1'); l.a = 'a' }), /crosses layers/],
      ['a group that is not one connected curve', edit(doc => { const g = doc.groups.groups; g[0].lines.push(g[1].lines.pop()) }), /open-failed/],
      ['a join on a line that does not end at its point', edit(doc => { doc.joins.rows[0].lines[1] = 'w1' }), /does not end at/],
      ['a link inside one layer', edit(doc => { doc.links.pairs[0].b = 'a' }), /inside one layer/],
      ['a fill on a missing line', edit(doc => { doc.fills.loops[0].lines[0] = 'gone' }), /missing line gone/],
      ['a mirror pair on a missing line', edit(doc => { doc.apply.pairs[0].a = 'gone' }), /mirror pair 0 uses a missing line/],
      ['a line without a name', edit(doc => { doc.names.line.pop() }), /has no name/],
      ['linked points apart', edit(doc => { doc.network.points.find((x: any) => x.id === 'k').position = { x: -90, y: 3 } }), /linked points c and k are apart|linked points k and c are apart/],
    ]
    for (const [label, text, why] of cases) {
      it(label, () => {
        const before = save(d)
        expect(() => open(text)).toThrow(why)
        expect(save(d)).toBe(before)
      })
    }
  })
})
