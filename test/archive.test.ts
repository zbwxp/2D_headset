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

  it('1c. a link join across layers opens equal, and a reversed link join is refused (dot 1791512476)', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A'); e.layer('B')
      e.line('la', { id: 'a0', layer: 'A', position: P(0, 0) }, { id: 'a1', layer: 'A', position: P(10, 0) })
      e.line('lb', { id: 'b0', layer: 'B', position: P(10, 0) }, { id: 'b1', layer: 'B', position: P(20, 5) })
    })
    d.edit(e => { e.link('a1', 'b0'); e.linkJoin('a1', 'b0', 'la', 'lb', { mode: 'smooth' }) })
    const good = save(d)
    same(d, open(good))
    const x = JSON.parse(good), j = x.document.links.joins[0]
    x.document.links.joins[0] = { a: j.b, b: j.a, lines: [j.lines[1], j.lines[0]], mode: j.mode }
    expect(() => open(JSON.stringify(x))).toThrow(/links are not in their stored form/)
  })

  it('1d. dot’s minimal case: ab and bc with a radius-2 arc join at b opens equal; reversed, doubled or radius-less it is refused (dot 1791512476)', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); e.line('ab', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(10, 0) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(15, 8) }) })
    d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 2 }))
    const good = save(d)
    same(d, open(good))
    const variant = (f: (rows: any[]) => void) => { const x = JSON.parse(good); f(x.document.joins.rows); return JSON.stringify(x) }
    expect(() => open(variant(r => { r[0].lines = ['bc', 'ab'] }))).toThrow(/not in their stored form/)
    expect(() => open(variant(r => { r.push({ ...r[0], lines: ['bc', 'ab'] }) }))).toThrow(/not in their stored form/)
    // radii are per view (step 4): a missing one in any view is refused
    const noRadius = JSON.parse(good); const L = noRadius.document.network.shapes.layers[3]; for (const k of Object.keys(L.radius)) delete L.radius[k]
    expect(() => open(JSON.stringify(noRadius))).toThrow(/has no radius in view:/)
  })

  it('1e. a split that renames a line inside link joins keeps their stored order: saved and opened equal (dot 1791512672)', () => {
    // one link a–b; two joins across it, [a1, k] and [b1, k]; splitting a1 renames it to z…, which sorts after b1
    const d = new Core()
    d.edit(e => {
      e.layer('A'); e.layer('B')
      e.line('a1', { id: 'p0', layer: 'A', position: P(0, 0) }, { id: 'a', layer: 'A', position: P(10, 0) })
      e.line('b1', 'a', { id: 'p2', layer: 'A', position: P(20, -5) })
      e.line('k', { id: 'b', layer: 'B', position: P(10, 0) }, { id: 'q', layer: 'B', position: P(10, 20) })
    })
    d.edit(e => { e.link('a', 'b'); e.linkJoin('a', 'b', 'a1', 'k', { mode: 'smooth' }); e.linkJoin('a', 'b', 'b1', 'k', { mode: 'smooth' }) })
    d.edit(e => e.split('a1', 0.5, 'm', 'z1', 'z2'))
    expect(d.snapshot().linkJoins.map(j => j.lines)).toEqual([['b1', 'k'], ['z2', 'k']])
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
      ['another version', good.replace('"version":2', '"version":3'), /unsupported version 3/],
      // shape layers (docs/architecture-multiview.md): single-view version 1 files are not supported (bowen 1791651929)
      ['a version 1 file', good.replace('"version":2', '"version":1'), /unsupported version 1/],
      ['a missing part', edit(doc => { delete doc.links }), /missing links/],
      ['a line pointing to a missing point', edit(doc => { doc.network.lines[0].a = 'nowhere' }), /open-failed/],
      ['a point id used twice', edit(doc => { doc.network.points.push({ ...doc.network.points[0] }) }), /open-failed/],
      ['a duplicate name', edit(doc => { doc.names.line[1][1] = doc.names.line[0][1] }), /open-failed: Name/],
      // data that reads fine but would break a later edit (dot 1791512144)
      ['usedLines missing', edit(doc => { delete doc.network.usedLines }), /usedLines is not a list/],
      ['usedLines emptied (an existing line id could be drawn again)', edit(doc => { doc.network.usedLines = [] }), /is not marked as used/],
      ['groups.next behind an existing g-id', edit(doc => { doc.groups.next = 1 }), /would make g1 again/],
      ['a coordinate that is text', edit(doc => { const L = doc.network.shapes.layers[0]; L.points[Object.keys(L.points)[0]!].x = 'oops' }), /\.x is not a finite number/],
      ['no shape layers', edit(doc => { delete doc.network.shapes }), /shapes is not an object/],
      ['a shape layer without a point', edit(doc => { const L = doc.network.shapes.layers[0]; delete L.points[Object.keys(L.points)[0]!] }), /has no position for point/],
      ['a shape layer with a point that does not exist', edit(doc => { doc.network.shapes.layers[0].points.ghost = { x: 0, y: 0 } }), /positions for points that do not exist/],
      ['a shape layer without a line', edit(doc => { const L = doc.network.shapes.layers[0]; delete L.lines[Object.keys(L.lines)[0]!] }), /has no shape for line/],
      ['a shape layer of an unknown kind', edit(doc => { doc.network.shapes.layers[0].kind = 'magic' }), /unknown kind/],
      ['no front view layer', edit(doc => { doc.network.shapes.layers[0].key = 'view:9,9' }), /no shape layer view:0,0/],
      ['two shape layers with one key', edit(doc => { doc.network.shapes.layers[0].key = 'view:90,0' }), /shape layer view:90,0 appears twice/],
      ['a line ending at a point of another layer', edit(doc => { const l = doc.network.lines.find((x: any) => x.id === 'k1'); l.a = 'a' }), /crosses layers/],
      ['a group that is not one connected curve', edit(doc => { const g = doc.groups.groups; g[0].lines.push(g[1].lines.pop()) }), /open-failed/],
      ['a join on a line that does not end at its point', edit(doc => { doc.joins.rows[0].lines[1] = 'w1' }), /does not end at/],
      ['a link inside one layer', edit(doc => { doc.links.pairs[0].b = 'a' }), /inside one layer/],
      ['a fill on a missing line', edit(doc => { doc.fills.loops[0].lines[0] = 'gone' }), /missing line gone/],
      ['a mirror pair on a missing line', edit(doc => { doc.apply.pairs[0].a = 'gone' }), /mirror pair 0 uses a missing line/],
      ['a line without a name', edit(doc => { doc.names.line.pop() }), /has no name/],
      // the rest of the same class (dot 1791512188): each module's own type, reference and relation checks
      ['a negative line width', edit(doc => { const L = doc.network.shapes.layers[0]; L.lines[Object.keys(L.lines)[0]!].stroke.width = -1 }), /stroke width that is not positive/],
      ['a missing stroke', edit(doc => { const L = doc.network.shapes.layers[0]; delete L.lines[Object.keys(L.lines)[0]!].stroke }), /stroke in view:0,0 is not an object/],
      ['an axis that is not a number', edit(doc => { doc.apply.axis = 'middle' }), /mirror axis is not a finite number/],
      ['a point in a missing layer', edit(doc => { doc.network.points[0].layer = 'nowhere' }), /in a missing layer/],
      ['an endpoint linked to itself', edit(doc => { doc.links.pairs[0].b = doc.links.pairs[0].a }), /inside one layer/],
      ['a line mirror-paired with itself', edit(doc => { doc.apply.pairs[0].b = doc.apply.pairs[0].a }), /pairs a line with itself/],
      ['a join of a line with itself', edit(doc => { doc.joins.rows[0].lines[1] = doc.joins.rows[0].lines[0] }), /uses one line twice/],
      ['an end stroke on a missing point', edit(doc => { doc.network.shapes.layers[2].end.gone = { taper: 1 } }), /end stroke in view:[-\d,]+ is on a missing point gone/],
      // restore writes through the normal writers and must give the stored form back (dot 1791512476)
      // radii and end strokes are per view (step 4, dot 1791654260)
      ['an arc join without a radius in one view', edit(doc => { const L = doc.network.shapes.layers[5]; delete L.radius[Object.keys(L.radius)[0]!] }), /has no radius in view:/],
      ['a radius that belongs to no arc join', edit(doc => { const r = doc.joins.rows.find((x: any) => x.mode === 'smooth'); r.mode = 'cusp'; doc.network.shapes.layers[0].radius[JSON.stringify([r.point, ...r.lines])] = 3 }), /belongs to no arc join/],
      ['a radius that is not above zero', edit(doc => { const L = doc.network.shapes.layers[1]; L.radius[Object.keys(L.radius)[0]!] = 0 }), /is not above zero/],
      ['a join row carrying a radius (radii live in the views)', edit(doc => { doc.joins.rows[0].radius = 3 }), /carries an extra value/],
      ['a join with its line pair reversed', edit(doc => { const r = doc.joins.rows[0]; r.lines = [r.lines[1], r.lines[0]] }), /not in their stored form/],
      ['one join stored in both orders', edit(doc => { const r = doc.joins.rows[0]; doc.joins.rows.push({ ...r, lines: [r.lines[1], r.lines[0]] }) }), /not in their stored form/],
      ['a link pair reversed', edit(doc => { const p = doc.links.pairs[0]; doc.links.pairs[0] = { a: p.b, b: p.a } }), /links are not in their stored form/],
      ['one link stored in both orders', edit(doc => { const p = doc.links.pairs[0]; doc.links.pairs.push({ a: p.b, b: p.a }) }), /Already linked/],
      ['a mirror pair reversed', edit(doc => { const p = doc.apply.pairs[0]; doc.apply.pairs[0] = { a: p.b, b: p.a, reversed: p.reversed } }), /mirror pairs are not in their stored form/],
      ['linked points apart', edit(doc => { doc.network.shapes.layers[0].points.k = { x: -90, y: 3 } }), /linked points c and k are apart|linked points k and c are apart/],
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
