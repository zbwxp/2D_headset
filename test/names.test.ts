// Names (graph "Names", design eb2748a; docs/names-plan.md acceptance 1–10). Scope since
// step 5 (docs/step5-names-meta.md; bowen 1791649036 甲, 1791651929; dot 1791655027):
// layer names unique among layers; line and curve names unique together within their
// layer; defaults numbered within the layer. Tests 1, 2, 5, 7 and 10b-3 changed with it.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })
const s = (d: Core) => d.snapshot()
const lineName = (d: Core, id: string) => s(d).lines.find(l => l.id === id)!.name
const groupOf = (d: Core, line: string) => s(d).groups.find(g => g.lines.includes(line))!
/** Names by scope: the layers; and, per layer, its curves and lines together. */
const scopes = (d: Core) => {
  const snap = s(d), layerOfPoint = new Map(snap.points.map(p => [p.id, p.layer]))
  const lineLayer = new Map(snap.lines.map(l => [l.id, layerOfPoint.get(l.a)!]))
  // the scopes (docs/names-scope.md): layers; each layer's curves; each curve's lines
  void lineLayer
  return [snap.layers.map(l => l.name), ...snap.layers.map(L => snap.groups.filter(g => g.layer === L.id).map(g => g.name)), ...snap.groups.map(g => g.lines.map(id => snap.lines.find(l => l.id === id)!.name))]
}
const unique = (d: Core) => { for (const n of scopes(d)) { expect(new Set(n).size).toBe(n.length); expect(n.every(x => x.trim())).toBe(true) } }

/** A chain a–b–c–d of three lines l1, l2, l3 in layer L. */
function chain(d: Core, L = 'L', x = 0, p = '') {
  d.edit(e => {
    sk(e).point(p + 'a', L, P(x)); sk(e).point(p + 'b', L, P(x + 10)); sk(e).point(p + 'c', L, P(x + 20)); sk(e).point(p + 'd', L, P(x + 30))
    sk(e).line(p + 'l1', p + 'a', p + 'b'); sk(e).line(p + 'l2', p + 'b', p + 'c'); sk(e).line(p + 'l3', p + 'c', p + 'd')
  })
}
function doc() { const d = new Core(); d.edit(e => e.layer('L', 'L')); return d }

describe('names', () => {
  it('1. new lines and curves get the smallest free default within their layer, skipping names in use there only', () => {
    const d = doc()
    d.edit(e => { e.layer('M', '曲线2'); sk(e).point('p', 'L', P(0, 50)); sk(e).point('q', 'L', P(10, 50)); sk(e).line('x', 'p', 'q'); e.renameLine('x', '曲线2') })
    chain(d)
    // a layer named 曲线2 does not take the name from lines; the line named 曲线2 in L does
    expect(['l1', 'l2', 'l3'].map(id => lineName(d, id))).toEqual(['曲线1', '曲线3', '曲线4'])
    expect(groupOf(d, 'l1').name).toBe('连续曲线2')
    // another layer starts its own numbering
    chain(d, 'M', 0, 'k')
    expect(['kl1', 'kl2', 'kl3'].map(id => lineName(d, id))).toEqual(['曲线1', '曲线2', '曲线3'])
    unique(d)
  })

  it('3. a split keeps the name on the first piece; the second piece gets a default', () => {
    const d = doc(); chain(d)
    d.edit(e => e.renameLine('l2', '上眼睑'))
    d.edit(e => e.split('l2', 0.5, 'm', 'p1', 'p2'))
    expect(lineName(d, 'p1')).toBe('上眼睑')
    expect(lineName(d, 'p2')).toBe('曲线2')
    unique(d)
  })

  it('4a. a group split keeps the name on the identity keeper; the split-off group gets a default', () => {
    const d = doc(); chain(d)
    const g = groupOf(d, 'l1').id
    d.edit(e => e.renameGroup(g, '左耳'))
    d.edit(e => e.deleteLine('l2'))
    const kept = s(d).groups.find(x => x.id === g)!, other = s(d).groups.find(x => x.id !== g)!
    expect(kept.name).toBe('左耳')
    expect(other.name).toBe('连续曲线1')
    unique(d)
  })

  it('4b. a bind merge keeps the winner’s name; the absorbed group’s name is gone', () => {
    const d = doc()
    d.edit(e => {
      sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(10)); sk(e).line('x', 'a', 'b')
      sk(e).point('c', 'L', P(20)); sk(e).point('e', 'L', P(30)); sk(e).line('y', 'c', 'e')
    })
    const gx = groupOf(d, 'x').id, gy = groupOf(d, 'y').id
    d.edit(e => { e.renameGroup(gx, '左耳'); e.renameGroup(gy, '右耳') })
    d.edit(e => e.bind('b', 'c'))
    expect(s(d).groups.map(g => g.name)).toEqual(['左耳'])
    unique(d)
  })

  it('5. rename refuses an empty name, a name held in its scope (a line: its curve; a curve: its layer\'s curves; a layer: the layers), saying who holds it, and 「·」', () => {
    const d = doc(); chain(d)
    const g = groupOf(d, 'l1').id
    expect(() => d.edit(e => e.renameLine('l1', ' '))).toThrow(/empty/)
    expect(() => d.edit(e => e.renameLine('l1', '曲线2'))).toThrow(/line l2/)
    expect(() => d.edit(e => e.renameLine('l1', '上·下'))).toThrow(/·/)
    expect(() => d.edit(e => e.renameGroup(g, '左·眼'))).toThrow(/·/)
    // a line and a curve never collide (图层·连续曲线·线, bowen 1792308208)
    d.edit(e => e.renameGroup(g, '曲线3'))
    expect(groupOf(d, 'l1').name).toBe('曲线3')
    expect(() => d.edit(e => e.layer('N', 'L'))).toThrow(/Layer name "L" is already used/)
    d.edit(e => e.renameLine('l1', '曲线1')) // its own name: allowed, no change
    expect(lineName(d, 'l1')).toBe('曲线1')
    // different scopes never collide: a line may share a layer's name, and the other way round
    d.edit(e => { e.renameLine('l1', 'L'); e.renameLayer('L', '连续曲线1'); e.layer('N', '曲线2') })
    expect(lineName(d, 'l1')).toBe('L')
    unique(d)
  })

  it('6. a locked line refuses rename; a group whose lines are all locked, and its layer, can be renamed', () => {
    const d = doc(); chain(d)
    d.edit(e => e.layerState('L', { locked: true }))
    expect(() => d.edit(e => e.renameLine('l1', '睫毛'))).toThrow(/locked/)
    const g = groupOf(d, 'l1').id
    d.edit(e => { e.renameGroup(g, '左眼'); e.renameLayer('L', '脸') })
    expect(groupOf(d, 'l1').name).toBe('左眼')
    expect(s(d).layers[0]!.name).toBe('脸')
  })

  it('7. copy layer (a 元组件): the layer becomes "<name>副本", then 副本2; its curves and lines keep their names', () => {
    const d = doc(); chain(d)
    const g = groupOf(d, 'l1').id
    d.edit(e => { e.renameGroup(g, '左耳'); e.renameLine('l2', '耳垂') })
    d.edit(e => e.copyLayer('L', 'C1'))
    d.edit(e => e.copyLayer('L', 'C2'))
    expect(s(d).layers.find(l => l.id === 'C1')!.name).toBe('L副本')
    expect(s(d).layers.find(l => l.id === 'C2')!.name).toBe('L副本2')
    expect(lineName(d, 'C1/l2')).toBe('耳垂')
    expect(lineName(d, 'C2/l2')).toBe('耳垂')
    expect(groupOf(d, 'C1/l1').name).toBe('左耳')
    expect(groupOf(d, 'C2/l1').name).toBe('左耳')
    unique(d)
    // an explicit copy name is checked among layers
    expect(() => d.edit(e => e.copyLayer('L', 'C3', 'L副本'))).toThrow(/Layer name "L副本" is already used/)
  })

  it('8. mirror apply keeps the target’s names', () => {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('L', 'L')
      sk(e).point('s1', 'L', P(-30, 0)); sk(e).point('s2', 'L', P(-10, 5)); sk(e).line('src', 's1', 's2')
      sk(e).point('t1', 'L', P(12, 1)); sk(e).point('t2', 'L', P(28, 2)); sk(e).line('tgt', 't1', 't2')
    })
    d.edit(e => { e.renameLine('src', '左上眼睑'); e.renameLine('tgt', '右上眼睑') })
    const before = { line: lineName(d, 'tgt'), group: groupOf(d, 'tgt').name }
    d.edit(e => e.mirrorApply(['src'], ['tgt']))
    expect({ line: lineName(d, 'tgt'), group: groupOf(d, 'tgt').name }).toEqual(before)
    unique(d)
  })

  it('9. a rename is one undo step; a refused rename publishes nothing', () => {
    const d = doc(); chain(d)
    const before = JSON.stringify(s(d))
    d.edit(e => e.renameLine('l1', '睫毛'))
    d.undo()
    expect(JSON.stringify(s(d))).toBe(before)
    d.redo()
    expect(lineName(d, 'l1')).toBe('睫毛')
    const now = JSON.stringify(s(d))
    expect(() => d.edit(e => { e.renameLine('l2', '眼角'); e.renameLine('l3', '眼角') })).toThrow()
    expect(JSON.stringify(s(d))).toBe(now)
  })

  it('5b. a line drawn earlier in the same edit can be named in it; an unknown id is refused', () => {
    const d = doc()
    d.edit(e => { sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(10)); sk(e).line('x', 'a', 'b'); e.renameLine('x', '睫毛') })
    expect(lineName(d, 'x')).toBe('睫毛')
    expect(groupOf(d, 'x').name).toBe('连续曲线1')
    expect(() => d.edit(e => e.renameLine('nope', 'n'))).toThrow(/No line nope/)
    expect(() => d.edit(e => e.renameGroup('nope', 'n'))).toThrow(/No group nope/)
  })

  it('10b-1. delete, then reuse the deleted line’s name in the same edit (dot 1791479554)', () => {
    const d = doc(); chain(d)
    d.edit(e => { e.renameLine('l1', '睫毛') })
    d.edit(e => { e.deleteLine('l1'); e.renameLine('l2', '睫毛') })
    expect(lineName(d, 'l2')).toBe('睫毛')
  })

  it('10b-2. bind two groups, then give the kept group the absorbed group’s name in the same edit (dot 1791479554)', () => {
    const d = doc()
    d.edit(e => {
      sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(10)); sk(e).line('x', 'a', 'b')
      sk(e).point('c', 'L', P(20)); sk(e).point('f', 'L', P(30)); sk(e).line('y', 'c', 'f')
    })
    const gx = groupOf(d, 'x').id, gy = groupOf(d, 'y').id
    d.edit(e => { e.renameGroup(gx, '左耳'); e.renameGroup(gy, '右耳') })
    d.edit(e => { e.bind('b', 'c'); e.renameGroup(gx, '右耳') })
    expect(s(d).groups.map(g => g.name)).toEqual(['右耳'])
  })

  it('10b-3. a line drawn and its layer copied in one edit: the copy keeps the (default) names in its new layer (dot 1791479554)', () => {
    const d = doc()
    d.edit(e => { sk(e).point('a', 'L', P(0)); sk(e).point('b', 'L', P(10)); sk(e).line('x', 'a', 'b'); e.copyLayer('L', 'C') })
    expect(lineName(d, 'x')).toBe('曲线1')
    expect(lineName(d, 'C/x')).toBe('曲线1')
    expect(groupOf(d, 'x').name).toBe('连续曲线1')
    expect(groupOf(d, 'C/x').name).toBe('连续曲线1')
    unique(d)
  })

  it('2. names stay unique through a mixed sequence, undo and redo included', () => {
    const d = doc(); chain(d); chain(d, 'L', 100, 'k')
    d.edit(e => e.copyLayer('L', 'C'))
    d.edit(e => e.split('l2', 0.3, 'm', 'q1', 'q2'))
    d.edit(e => e.deleteLine('l3'))
    d.edit(e => e.bind('c', 'ka'))
    unique(d)
    for (let i = 0; i < 4; i++) { d.undo(); unique(d) }
    for (let i = 0; i < 4; i++) { d.redo(); unique(d) }
  })
})
