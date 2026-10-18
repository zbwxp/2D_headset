// 骨骼线 package B3 (docs/bone-lines-checklist.md §6b): 录制标准 / 捏脸, standards saved from a drawing, chosen per layer,
// imported as copies. In 捏脸 every bone off the front is generated from its standard (paired once by name, stored by
// key) and every bone there refuses a side edit; switching modes never changes a standard; old v15 files open.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Core, save, open, Refusal, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45'
const code = (f: () => void) => { try { f(); return undefined } catch (e) { return e instanceof Refusal ? e.code : (e as Error).message } }
const message = (f: () => void) => { try { f(); return '' } catch (e) { return (e as Error).message } }
type Cubic = [Vec, Vec, Vec, Vec]
const cubic = (d: Core, view: string, id: string): Cubic => {
  const s = d.in(view).snapshot(), l = s.lines.find(x => x.id === id)!, pos = (p: string) => s.points.find(x => x.id === p)!.position
  const a = pos(l.a), b = pos(l.b)
  return [a, P(a.x + l.ha.x, a.y + l.ha.y), P(b.x + l.hb.x, b.y + l.hb.y), b]
}
const at = (c: Cubic, t: number): Vec => { const u = 1 - t; return P(u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y) }
/** The largest distance from a point of `a` to the curve `b`, both ways. */
const shapeDistance = (a: Cubic, b: Cubic) => {
  const one = (p: Cubic, q: Cubic) => { let worst = 0; for (let i = 0; i <= 100; i++) { const x = at(p, i / 100); let best = Infinity; for (let k = 0; k <= 400; k++) { const y = at(q, k / 400); best = Math.min(best, Math.hypot(y.x - x.x, y.y - x.y)) } worst = Math.max(worst, best) } return worst }
  return Math.max(one(a, b), one(b, a))
}
const json = (x: unknown) => JSON.stringify(x)
const sides = (d: Core, ids: string[]) => json(d.views().filter(v => v !== FRONT).map(v => ids.map(id => cubic(d, v, id))))

/**
 * An eye: bones U (upper arch) and D (lower arch) sharing both ends i, o, named 上骨 / 下骨; line up attached to U, lo to
 * D; a free line f elsewhere. In 录制标准 the side views' bones are adjusted by hand (as bowen would), then saved as S1.
 */
function face(shift = 0) {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.line('U', { id: 'i', layer: 'L', position: P(0 + shift, 0) }, { id: 'o', layer: 'L', position: P(40 + shift, 0) }, { ha: P(10, -12), hb: P(-10, -12) })
    e.line('D', 'i', 'o', { ha: P(10, 8), hb: P(-10, 8) })
    e.line('up', { id: 'u0', layer: 'L', position: P(4 + shift, -4) }, { id: 'u1', layer: 'L', position: P(36 + shift, -4) }, { ha: P(10, -10), hb: P(-10, -10) })
    e.line('lo', { id: 'l0', layer: 'L', position: P(4 + shift, 3) }, { id: 'l1', layer: 'L', position: P(36 + shift, 3) }, { ha: P(10, 5), hb: P(-10, 5) })
    e.line('f', { id: 'f0', layer: 'L', position: P(100, 0) }, { id: 'f1', layer: 'L', position: P(110, 0) })
    e.renameLine('U', '上骨'); e.renameLine('D', '下骨')
  })
  d.edit(e => e.markBone(['U', 'D']))
  d.edit(e => { e.attach(['up'], 'U'); e.attach(['lo'], 'D') })
  return d
}
/** 录制标准: the side views' bones drawn by hand (the shared outer end moves; the upper bone flattens at 90,0). */
function recorded() {
  const d = face()
  d.editIn(SIDE, e => { e.move([{ id: 'o', target: P(30, 2) }]); e.moveHandle('U', 'b', P(-6, -6)); e.moveHandle('D', 'b', P(-6, 5)) })
  d.editIn(UP, e => { e.move([{ id: 'i', target: P(1, -3) }]); e.moveHandle('U', 'a', P(9, -7)) })
  d.edit(e => e.saveStandard('L', 'S1'))
  return d
}
const stdId = (d: Core, name: string) => d.snapshot().standards.find(t => t.name === name)!.id

describe('录制标准 and saving a standard', () => {
  it('a standard holds every view of the layer\'s bones, by name with a stable key; the snapshot lists it without shapes', () => {
    const d = recorded(), [t] = d.standardsData()
    expect(t!.name).toBe('S1'); expect(t!.layer).toBe('L')
    expect(t!.bones.map(b => b.name).sort()).toEqual(['连续曲线1·上骨', '连续曲线1·下骨'])
    for (const b of t!.bones) expect(Object.keys(b.views).sort()).toEqual([...d.views()].sort())
    expect(t!.bones.find(b => b.name === '连续曲线1·上骨')!.views[SIDE]).toEqual(cubic(d, SIDE, 'U'))
    expect(d.snapshot().standards).toEqual([{ id: t!.id, name: 'S1', layer: 'L', bones: t!.bones.map(b => ({ key: b.key, name: b.name })) }])
    expect(d.snapshot().boneMode).toBe('record')
  })
  it('saving again under the same name is refused; overwriting keeps its id and the keys of same-named bones', () => {
    const d = recorded(), was = d.standardsData()[0]!
    expect(code(() => d.edit(e => e.saveStandard('L', 'S1')))).toBe('standard-exists')
    d.editIn(SIDE, e => e.moveHandle('U', 'a', P(4, -9)))
    d.edit(e => e.saveStandard('L', 'S1', true))
    const now = d.standardsData()[0]!
    expect(now.id).toBe(was.id)
    expect(now.bones.map(b => [b.name, b.key])).toEqual(was.bones.map(b => [b.name, b.key]))
    expect(now.bones.find(b => b.name === '连续曲线1·上骨')!.views[SIDE]).toEqual(cubic(d, SIDE, 'U'))
    expect(code(() => d.edit(e => e.saveStandard('L', ' ')))).toBe('standard-name')
  })
  it('a layer without bones has nothing to save; a standard in use is not removed', () => {
    const d = recorded()
    d.edit(e => e.layer('M', 'M'))
    expect(code(() => d.edit(e => e.saveStandard('M', 'x')))).toBe('standard-empty')
    const id = stdId(d, 'S1')
    d.edit(e => e.useStandard('L', id))
    expect(code(() => d.edit(e => e.removeStandard(id)))).toBe('standard-in-use')
    d.edit(e => { e.useStandard('L', null); e.removeStandard(id) })
    expect(d.snapshot().standards).toEqual([])
  })
})

describe('捏脸 (bones generated off the front from the chosen standard)', () => {
  it('the face the standard was recorded from: choosing it and switching to 捏脸 leaves every view as it was', () => {
    const d = recorded(), before = sides(d, ['U', 'D', 'up', 'lo'])
    d.edit(e => { e.useStandard('L', stdId(d, 'S1')); e.boneMode('make') })
    const now = JSON.parse(sides(d, ['U', 'D', 'up', 'lo'])) as Cubic[][], was = JSON.parse(before) as Cubic[][]
    expect(Math.max(...now.flatMap((v, i) => v.map((c, k) => shapeDistance(c, was[i]![k]!))))).toBeLessThan(1e-6)
    expect(d.snapshot().standardChoices).toEqual([{ layer: 'L', standard: stdId(d, 'S1'), pairs: [{ bone: 'D', key: 'D' }, { bone: 'U', key: 'U' }].sort((p, q) => (p.bone < q.bone ? -1 : 1)) }])
  })
  it('a new face reusing the standard (imported as a copy): with the same 0,0 bones, its side bones and lines match the recorded face', () => {
    const A = recorded(), B = face()
    B.edit(e => { const id = e.addStandard('L', A.standardsData()[0]!); e.useStandard('L', id); e.boneMode('make') })
    for (const v of B.views()) for (const id of ['U', 'D', 'up', 'lo']) expect(shapeDistance(cubic(B, v, id), cubic(A, v, id))).toBeLessThan(1e-6)
    // one edit: one undo takes the import, the choice, the mode and the generated bones back
    const fresh = face()
    B.undo()
    expect(B.snapshot().standards).toEqual([]); expect(B.snapshot().boneMode).toBe('record'); expect(B.snapshot().standardChoices).toEqual([])
    expect(sides(B, ['U', 'D', 'up', 'lo'])).toBe(sides(fresh, ['U', 'D', 'up', 'lo']))
  })
  it('a 0,0 bone edit regenerates the side bones from the standard: path-independent, idempotent, and the lines follow', () => {
    const one = recorded(), two = recorded()
    for (const d of [one, two]) d.edit(e => { e.useStandard('L', stdId(d, 'S1')); e.boneMode('make') })
    one.edit(e => { e.move([{ id: 'o', target: P(46, 4) }]); e.moveHandle('U', 'a', P(12, -15)) })
    two.edit(e => e.move([{ id: 'o', target: P(30, -9) }]))
    two.edit(e => e.moveHandle('U', 'a', P(3, -2)))
    two.edit(e => { e.move([{ id: 'o', target: P(46, 4) }]); e.moveHandle('U', 'a', P(12, -15)) })
    expect(sides(two, ['U', 'D', 'up', 'lo'])).toBe(sides(one, ['U', 'D', 'up', 'lo']))
    const before = save(one)
    one.edit(e => e.move([{ id: 'f1', target: P(112, 1) }]))
    one.edit(e => e.move([{ id: 'f1', target: P(110, 0) }]))
    expect(sides(one, ['U', 'D', 'up', 'lo'])).toBe(JSON.stringify(JSON.parse(sides(open(before), ['U', 'D', 'up', 'lo']))))
    // the side bones changed with the 0,0 bone (the outer end moved out at 0,0, so it moves out in 90,0 too)
    expect(cubic(one, SIDE, 'U')[3].x).toBeGreaterThan(30.5)
    // and the attached lines are generated from them
    const text = save(one)
    expect(save(open(text))).toBe(text)
  })
  it('every bone refuses a side edit in 捏脸, with the reason: from a standard, not paired, no standard chosen', () => {
    const d = recorded()
    d.edit(e => { e.useStandard('L', stdId(d, 'S1')); e.boneMode('make') })
    const drag = () => d.editIn(SIDE, e => e.moveHandle('U', 'a', P(3, -3)))
    expect(code(drag)).toBe('bone-standard')
    expect(message(drag)).toMatch(/comes from the standard 「S1」/)
    // a bone the standard does not have: unpaired, still not edited off the front in 捏脸
    d.edit(e => { e.line('E', { id: 'e0', layer: 'L', position: P(0, 20) }, { id: 'e1', layer: 'L', position: P(30, 20) }); e.renameLine('E', '眉骨') })
    d.edit(e => e.markBone(['E']))
    expect(message(() => d.editIn(SIDE, e => e.moveHandle('E', 'a', P(3, -3))))).toMatch(/not paired/)
    // no standard chosen: refused too
    d.edit(e => e.useStandard('L', null))
    expect(message(drag)).toMatch(/no standard is chosen/)
    // back in 录制标准 the side bones are edited by hand again
    d.edit(e => e.boneMode('record'))
    expect(code(drag)).toBeUndefined()
  })
  it('switching 捏脸 → 录制标准 → 捏脸 never changes a standard (bit-equal); a side edit in 录制标准 is undone by 捏脸 unless saved', () => {
    const d = recorded(), id = stdId(d, 'S1'), std = json(d.standardsData())
    d.edit(e => { e.useStandard('L', id); e.boneMode('make') })
    const made = cubic(d, SIDE, 'U')
    d.edit(e => e.boneMode('record'))
    d.editIn(SIDE, e => e.moveHandle('U', 'a', P(2, -14)))
    expect(json(d.standardsData())).toBe(std)
    d.edit(e => e.boneMode('make'))
    expect(json(d.standardsData())).toBe(std)
    expect(shapeDistance(cubic(d, SIDE, 'U'), made)).toBeLessThan(1e-9)
  })
  it('renaming a paired bone keeps its pair (stored by key, not looked up by name again)', () => {
    const d = recorded(), id = stdId(d, 'S1')
    d.edit(e => { e.useStandard('L', id); e.boneMode('make') })
    const pairs = json(d.snapshot().standardChoices), side = cubic(d, SIDE, 'U')
    d.edit(e => e.renameLine('U', '上眼睑骨'))
    expect(json(d.snapshot().standardChoices)).toBe(pairs)
    d.edit(e => e.moveHandle('U', 'a', P(11, -13)))
    expect(json(cubic(d, SIDE, 'U'))).not.toBe(json(side))
    expect(code(() => d.editIn(SIDE, e => e.moveHandle('U', 'a', P(3, -3))))).toBe('bone-standard')
  })
  it('an end shared by a paired bone and an unpaired one: a disagreement refuses the whole step', () => {
    // a standard with the upper bone only; the lower bone shares both ends but is not paired
    const d = face()
    d.edit(e => e.markBone(['D'], false))
    d.edit(e => e.saveStandard('L', 'upper'))
    d.edit(e => e.markBone(['D']))
    d.edit(e => e.useStandard('L', stdId(d, 'upper')))
    expect(d.snapshot().standardChoices[0]!.pairs).toEqual([{ bone: 'U', key: 'U' }])
    // unchanged 0,0: the paired bone's ends land where they are, no conflict
    d.edit(e => e.boneMode('make'))
    d.edit(e => e.boneMode('record'))
    // the shared outer end moved at 0,0: the upper bone's standard puts it elsewhere than the unpaired lower bone has it
    d.edit(e => e.move([{ id: 'o', target: P(48, 6) }]))
    const was = save(d)
    expect(code(() => d.edit(e => e.boneMode('make')))).toBe('bone-standard-conflict')
    expect(save(d)).toBe(was)
  })
  it('importing: a copy (later changes on either side do not reach the other); checked; a same name only with overwrite', () => {
    const A = recorded(), B = face(), data = A.standardsData()[0]!
    const id = (() => { let x = ''; B.edit(e => { x = e.addStandard('L', data) }); return x })()
    const copy = json(B.standardsData())
    ;(data.bones[0]!.views[SIDE]![0] as { x: number }).x += 5
    A.editIn(SIDE, e => e.moveHandle('U', 'a', P(1, -1))); A.edit(e => e.saveStandard('L', 'S1', true))
    expect(json(B.standardsData())).toBe(copy)
    expect(code(() => B.edit(e => e.addStandard('L', A.standardsData()[0]!)))).toBe('standard-exists')
    B.edit(e => e.addStandard('L', A.standardsData()[0]!, true))
    expect(B.snapshot().standards.map(t => t.id)).toEqual([id])
    expect(code(() => B.edit(e => e.addStandard('L', { name: 'bad', bones: [{ key: 'k', name: 'n', views: { [FRONT]: [P(0), P(1), P(NaN), P(3)] as unknown as Cubic } }] })))).toBe('standard-data')
    expect(code(() => B.edit(e => e.addStandard('L', { name: 'dup', bones: [{ key: 'k', name: 'a', views: {} }, { key: 'k', name: 'b', views: {} }] })))).toBe('standard-data')
    expect(code(() => B.edit(e => e.addStandard('L', { name: 'none', bones: [] })))).toBe('standard-empty')
  })
  it('saves and reopens in 捏脸 with its choice and pairs', () => {
    const d = recorded()
    d.edit(e => { e.useStandard('L', stdId(d, 'S1')); e.boneMode('make') })
    d.edit(e => e.move([{ id: 'o', target: P(44, 2) }]))
    const text = save(d), back = open(text)
    expect(save(back)).toBe(text)
    expect(back.snapshot().boneMode).toBe('make')
    expect(back.snapshot().standardChoices).toEqual(d.snapshot().standardChoices)
  })
})

describe('dot 1792304023', () => {
  it('an imported standard (keys from its source), chosen, a local bone renamed, then overwritten: the keys and the pairs stay', () => {
    const A = recorded(), data = A.standardsData()[0]!
    const B = face()
    B.edit(e => { const id = e.addStandard('L', { name: data.name, naming: data.naming, bones: data.bones.map(b => ({ ...b, key: `src-${b.key}` })) }); e.useStandard('L', id); e.boneMode('make') })
    const pairs = json(B.snapshot().standardChoices)
    expect(B.snapshot().standardChoices[0]!.pairs.map(p => p.key).sort()).toEqual(['src-D', 'src-U'])
    B.edit(e => e.boneMode('record'))
    B.edit(e => e.renameLine('U', '上眼睑骨'))
    B.edit(e => e.saveStandard('L', data.name, true))
    expect(B.standardsData()[0]!.bones.map(b => [b.key, b.name]).sort()).toEqual([['src-D', '连续曲线1·下骨'], ['src-U', '连续曲线1·上眼睑骨']])
    expect(json(B.snapshot().standardChoices)).toBe(pairs)
    // still generated from it in 捏脸
    B.edit(e => e.boneMode('make'))
    expect(code(() => B.editIn(SIDE, e => e.moveHandle('U', 'a', P(3, -3))))).toBe('bone-standard')
    expect(message(() => B.editIn(SIDE, e => e.moveHandle('U', 'a', P(3, -3))))).toMatch(/comes from the standard/)
  })
  it('an imported standard with two bones of one name (different keys) is refused; so is a bone without a name', () => {
    const d = face(), v = { [FRONT]: [P(0), P(1), P(2), P(3)] as Cubic }
    expect(code(() => d.edit(e => e.addStandard('L', { name: 'x', bones: [{ key: 'a', name: '上骨', views: v }, { key: 'b', name: '上骨', views: v }] })))).toBe('standard-data')
    expect(code(() => d.edit(e => e.addStandard('L', { name: 'x', bones: [{ key: 'a', name: ' ', views: v }] })))).toBe('standard-data')
    expect(d.snapshot().standards).toEqual([])
  })
})

describe('a face far from its standard (bowen 1792304469: made faces are edited where the default face is)', () => {
  it('a standard recorded 2000 away: 捏脸 is refused with bone-standard-far, nothing changes; near it, it works', () => {
    const A = recorded(), B = face(2000), data = A.standardsData()[0]!
    B.edit(e => { const id = e.addStandard('L', data); e.useStandard('L', id) })
    const was = save(B)
    expect(code(() => B.edit(e => e.boneMode('make')))).toBe('bone-standard-far')
    expect(save(B)).toBe(was)
    // a face a little off (a few units) is a changed eye, carried as before
    const C = face(3)
    C.edit(e => { const id = e.addStandard('L', data); e.useStandard('L', id); e.boneMode('make') })
    expect(C.snapshot().boneMode).toBe('make')
  })
})

describe('names 图层·连续曲线·线 (bowen 1792308208, docs/names-scope.md rule 9)', () => {
  it('two bones of one line name in different curves pair each with its own; a standard bone saved before (line name only) pairs when unique', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('A', { id: 'a0', layer: 'L', position: P(0, 0) }, { id: 'a1', layer: 'L', position: P(40, 0) }, { ha: P(10, -10), hb: P(-10, -10) })
      e.line('B', { id: 'b0', layer: 'L', position: P(0, 60) }, { id: 'b1', layer: 'L', position: P(40, 60) }, { ha: P(10, -10), hb: P(-10, -10) })
      e.line('C', { id: 'c0', layer: 'L', position: P(0, 120) }, { id: 'c1', layer: 'L', position: P(40, 120) }, { ha: P(10, -10), hb: P(-10, -10) })
    })
    const gid = (l: string) => d.snapshot().groups.find(x => x.lines.includes(l))!.id
    d.edit(e => { e.renameGroup(gid('A'), '左眼'); e.renameGroup(gid('B'), '右眼'); e.renameGroup(gid('C'), '眉'); e.renameLine('A', '骨'); e.renameLine('B', '骨'); e.renameLine('C', '眉骨') })
    d.edit(e => e.markBone(['A', 'B', 'C']))
    d.edit(e => e.saveStandard('L', 'S'))
    expect(d.standardsData()[0]!.bones.map(b => b.name).sort()).toEqual(['右眼·骨', '左眼·骨', '眉·眉骨'])
    d.edit(e => e.useStandard('L', d.snapshot().standards[0]!.id))
    expect(d.snapshot().standardChoices[0]!.pairs.map(p => p.bone).sort()).toEqual(['A', 'B', 'C'])
    // an old standard (line names only): 「眉骨」 is unique → paired; 「骨」 is held by two bones → unpaired
    const v = { [FRONT]: [P(0), P(1, -1), P(2, -1), P(3)] as Cubic }
    d.edit(e => { const id = e.addStandard('L', { name: 'old', bones: [{ key: 'k1', name: '骨', views: v }, { key: 'k2', name: '眉骨', views: v }] }); e.useStandard('L', id) })
    expect(d.snapshot().standardChoices[0]!.pairs).toEqual([{ bone: 'C', key: 'k2' }])
  })
  it('joining two curves with same-named lines: the later line becomes 副本 (rule 6); undo restores', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('p', { id: 'p0', layer: 'L', position: P(0) }, { id: 'p1', layer: 'L', position: P(10) }); e.line('q', { id: 'q0', layer: 'L', position: P(20) }, { id: 'q1', layer: 'L', position: P(30) }) })
    d.edit(e => { e.renameLine('p', '上缘'); e.renameLine('q', '上缘') })
    const was = save(d)
    d.edit(e => e.move([{ id: 'q0', target: P(10) }]))
    const gr = d.snapshot().groups.find(x => x.lines.includes('p'))!
    expect(gr.lines).toContain('q')
    const nm = (id: string) => d.snapshot().lines.find(l => l.id === id)!.name
    expect([nm(gr.lines[0]!), nm(gr.lines[1]!)]).toEqual(['上缘', '上缘副本'])
    d.undo()
    expect(save(d)).toBe(was)
  })
  it('a file with 「·」 in names opens with it removed (bowen 1792308685); a collision that makes gets 副本', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('p', { id: 'p0', layer: 'L', position: P(0) }, { id: 'p1', layer: 'L', position: P(10) }, ); e.line('q', 'p1', { id: 'q1', layer: 'L', position: P(20) }) })
    d.edit(e => { e.renameLine('p', '上缘'); e.renameLine('q', '上缘x') })
    const file = JSON.parse(save(d))
    for (const e of file.document.names.line) if (e[1] === '上缘x') e[1] = '上·缘'
    const back = open(JSON.stringify(file)), names = back.snapshot().lines.map(l => l.name).sort()
    expect(names).toEqual(['上缘', '上缘副本'])
  })
})

describe('dot 1792309220 / 1792309259: old names and old standards', () => {
  it('an unmarked standard: a name with 「·」 (an old line name 「左眼·骨」, or an unmarked 「连续曲线·线」) is never paired; one without pairs by line name', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('A', { id: 'a0', layer: 'L', position: P(0, 0) }, { id: 'a1', layer: 'L', position: P(40, 0) }, { ha: P(10, -10), hb: P(-10, -10) })
      e.line('B', { id: 'b0', layer: 'L', position: P(0, 60) }, { id: 'b1', layer: 'L', position: P(40, 60) }, { ha: P(10, -10), hb: P(-10, -10) })
    })
    d.edit(e => { e.renameGroup(d.snapshot().groups.find(x => x.lines.includes('B'))!.id, '左眼'); e.renameLine('B', '骨'); e.renameLine('A', '左眼骨') })
    d.edit(e => e.markBone(['A', 'B']))
    const v = { [FRONT]: [P(0), P(1, -1), P(2, -1), P(3)] as Cubic }
    // as an old file holds it: no naming marker
    const file = JSON.parse(save(d))
    file.document.bones.standards = [{ id: 'std-9', name: 'old', layer: 'L', bones: [{ key: 'kA', name: '左眼·骨', views: v }, { key: 'kB', name: '左眼骨', views: v }] }]
    const back = open(JSON.stringify(file))
    expect(back.standardsData()[0]!.bones.map(b => b.name)).toEqual(['左眼·骨', '左眼骨'])
    back.edit(e => e.useStandard('L', 'std-9'))
    expect(back.snapshot().standardChoices[0]!.pairs).toEqual([{ bone: 'A', key: 'kB' }])
    // imported directly (unmarked data): the same
    const C = open(save(d))
    C.edit(e => { const id = e.addStandard('L', { name: 'old', bones: [{ key: 'kA', name: '左眼·骨', views: v }] }); e.useStandard('L', id) })
    expect(C.snapshot().standardChoices[0]!.pairs).toEqual([])
    // a marked standard is paired by 「连续曲线·线」
    C.edit(e => { const id = e.addStandard('L', { name: 'new', naming: 'curve·line', bones: [{ key: 'kB', name: '左眼·骨', views: v }] }); e.useStandard('L', id) })
    expect(C.snapshot().standardChoices[0]!.pairs).toEqual([{ bone: 'B', key: 'kB' }])
    // saving it again (marked) makes an unmarked standard pair as usual
    C.edit(e => e.saveStandard('L', 'old', true))
    C.edit(e => e.useStandard('L', C.snapshot().standards.find(t => t.name === 'old')!.id))
    expect(C.snapshot().standardChoices[0]!.pairs.map(p => p.bone).sort()).toEqual(['A', 'B'])
  })
  it('opening: only names that held 「·」 are repaired; a repeat or an empty name otherwise is still refused', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('p', { id: 'p0', layer: 'L', position: P(0) }, { id: 'p1', layer: 'L', position: P(10) }); e.line('q', 'p1', { id: 'q1', layer: 'L', position: P(20) }) })
    const file = JSON.parse(save(d))
    for (const e of file.document.names.line) e[1] = 'N'
    for (const e of file.document.names.group) e[1] = '左·眼'
    expect(() => open(JSON.stringify(file))).toThrow(/N/)
    const f2 = JSON.parse(save(d))
    f2.document.names.line[0][1] = ' '
    expect(() => open(JSON.stringify(f2))).toThrow()
  })
  it('layer names: 「·」 refused when made or renamed, removed on opening (dot 1792309343)', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    expect(code(() => d.edit(e => e.layer('M', '左·脸')))).toBe('name-dot')
    expect(code(() => d.edit(e => e.renameLayer('L', '左·脸')))).toBe('name-dot')
    d.edit(e => e.layer('M', '左脸'))
    const file = JSON.parse(save(d))
    file.document.network.layers = file.document.network.layers.map((l: { id: string; name: string }) => (l.id === 'L' ? { ...l, name: '左·脸' } : l))
    expect(open(JSON.stringify(file)).snapshot().layers.map(l => l.name).sort()).toEqual(['左脸', '左脸副本'])
  })
  it('pasting from an older clipboard with 「·」 in names: removed at once, the same as after save / open', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('p', { id: 'p0', layer: 'L', position: P(0) }, { id: 'p1', layer: 'L', position: P(10) }))
    const clip = d.copy(['p']) as unknown as { names: { lines: [string, string][]; groups: { name: string }[] } }
    clip.names.lines = clip.names.lines.map(([id]) => [id, '上·缘'])
    clip.names.groups = clip.names.groups.map(g => ({ ...g, name: '左·眼' }))
    d.edit(e => e.paste(clip as never, 'L', P(0, 50), 'c'))
    const names = () => d.snapshot().lines.map(l => l.name).concat(d.snapshot().groups.map(g => g.name)).sort()
    expect(names().some(x => x.includes('·'))).toBe(false)
    expect(names()).toContain('上缘')
    const text = save(d)
    expect(save(open(text))).toBe(text)
  })
})

describe('switching the chosen standard', () => {
  it('regenerates the side bones from the new standard; back to the first gives the first result again', () => {
    const d = recorded(), s1 = stdId(d, 'S1')
    d.editIn(SIDE, e => { e.move([{ id: 'o', target: P(24, 6) }]); e.moveHandle('U', 'b', P(-3, -9)) })
    d.edit(e => e.saveStandard('L', 'S2'))
    const s2 = stdId(d, 'S2')
    d.edit(e => { e.useStandard('L', s1); e.boneMode('make') })
    d.edit(e => e.move([{ id: 'o', target: P(44, 2) }]))
    const one = sides(d, ['U', 'D', 'up', 'lo'])
    d.edit(e => e.useStandard('L', s2))
    expect(sides(d, ['U', 'D', 'up', 'lo'])).not.toBe(one)
    expect(cubic(d, SIDE, 'U')[3].x).toBeLessThan(cubic(open(save(d)), SIDE, 'U')[3].x + 1e-9)
    d.edit(e => e.useStandard('L', s1))
    expect(sides(d, ['U', 'D', 'up', 'lo'])).toBe(one)
  })
})

describe('标准tmp (bowen 165.json left eye; a test fixture, not a standard eye — bowen 1792297995)', () => {
  const eye = JSON.parse(readFileSync(new URL('./fixtures/eye-standard-tmp.json', import.meta.url), 'utf8'))
  const top: string = eye.lines.find((l: { name: string }) => l.name === '上眼睑上').id
  const lash: string[] = eye.lines.filter((l: { group: string }) => l.group === '连续曲线1').map((l: { id: string }) => l.id)
  /** The eye in all nine views as drawn; 上眼睑上 made a bone (named 上骨) with the lashes attached. */
  function eyeDoc() {
    const d = Core.newDocument({ layer: { id: 'eye', name: 'eye' } })
    const V0 = eye.views[FRONT], pt = (v: string, id: string) => P(...(eye.views[v].points[id] as [number, number]))
    d.edit(e => {
      const made = new Set<string>(), end = (id: string) => (made.has(id) ? id : (made.add(id), { id, layer: 'eye', position: pt(FRONT, id) }))
      for (const l of eye.lines) e.line(l.id, end(l.a), end(l.b), { ha: P(...(V0.handles[l.id].ha as [number, number])), hb: P(...(V0.handles[l.id].hb as [number, number])) })
    })
    for (const v of d.views()) if (v !== FRONT && eye.views[v]) d.editIn(v, e => {
      e.move(Object.keys(eye.views[v].points).map(id => ({ id, target: pt(v, id) })))
      for (const l of eye.lines) { e.moveHandle(l.id, 'a', P(...(eye.views[v].handles[l.id].ha as [number, number]))); e.moveHandle(l.id, 'b', P(...(eye.views[v].handles[l.id].hb as [number, number]))) }
    })
    d.edit(e => e.renameLine(top, '上骨'))
    d.edit(e => e.markBone([top]))
    d.edit(e => e.attach(lash, top))
    return d
  }
  it('recorded → 标准1 → a new eye imports it, is placed differently at 0,0, 捏脸: side bones and lashes generated; saves and reopens', () => {
    const A = eyeDoc()
    A.edit(e => e.saveStandard('eye', '标准1'))
    const B = eyeDoc(), c0 = cubic(B, FRONT, top)
    B.edit(e => { const id = e.addStandard('eye', A.standardsData()[0]!); e.useStandard('eye', id); e.boneMode('make') })
    // the same 0,0 eye: every view exactly as recorded
    for (const v of B.views()) for (const id of [top, ...lash]) expect(json(cubic(B, v, id))).toBe(json(cubic(A, v, id)))
    // a different eye at 0,0 (the lid 5 % larger about its inner end): every side bone changes, the lashes follow
    const l = B.snapshot().lines.find(x => x.id === top)!, k = 1.05, S = (p: Vec) => P(c0[0].x + k * (p.x - c0[0].x), c0[0].y + k * (p.y - c0[0].y))
    B.edit(e => { e.move([{ id: l.b, target: S(c0[3]) }]); e.moveHandle(top, 'a', P(k * (c0[1].x - c0[0].x), k * (c0[1].y - c0[0].y))); e.moveHandle(top, 'b', P(k * (c0[2].x - c0[3].x), k * (c0[2].y - c0[3].y))) })
    for (const v of B.views().filter(v => v !== FRONT)) {
      expect(json(cubic(B, v, top))).not.toBe(json(cubic(A, v, top)))
      expect(shapeDistance(cubic(B, v, top), cubic(A, v, top))).toBeLessThan(6)
      for (const id of lash) expect(shapeDistance(cubic(B, v, id), cubic(A, v, id))).toBeLessThan(8)
    }
    expect(code(() => B.editIn(SIDE, e => e.moveHandle(top, 'a', P(1, 1))))).toBe('bone-standard')
    const text = save(B)
    expect(save(open(text))).toBe(text)
  })
  it('a tight hook (this lid bone at 90,45): lifting the 0,0 lid by 1 and by 3 is followed there as one curve, no loop', () => {
    const A = eyeDoc()
    A.edit(e => e.saveStandard('eye', '标准1'))
    A.edit(e => { e.useStandard('eye', stdId(A, '标准1')); e.boneMode('make') })
    const std = cubic(A, 'view:90,45', top), l = A.snapshot().lines.find(x => x.id === top)!
    for (const k of [1, 3]) {
      A.edit(e => { e.moveHandle(top, 'a', P(l.ha.x, l.ha.y - k)); e.moveHandle(top, 'b', P(l.hb.x, l.hb.y - k)) })
      // a loop would reach far from the hook (before the fix: a loop 11 units out at k = 3)
      expect(shapeDistance(cubic(A, 'view:90,45', top), std)).toBeLessThan(1.5 * k)
    }
    const text = save(A)
    expect(save(open(text))).toBe(text)
  })
})

describe('v15 files made before B3 (dot 1792302329)', () => {
  it('a file saved by the B2 code opens (bones and attachments, no standards)', () => {
    const text = readFileSync(new URL('./fixtures/v15-b2.json', import.meta.url), 'utf8'), d = open(text)
    expect(d.snapshot().bones.length).toBeGreaterThan(0)
    expect(d.snapshot().boneMode).toBe('record')
    expect(d.snapshot().standards).toEqual([])
  })
  it('a hand-made v15 whose standard bones have no key and whose choice has no pairs opens: key = name, unpaired', () => {
    const d = recorded()
    d.edit(e => e.useStandard('L', stdId(d, 'S1')))
    const file = JSON.parse(save(d))
    for (const t of file.document.bones.standards) for (const b of t.bones) delete b.key
    for (const c of file.document.bones.choice) delete c.pairs
    const back = open(JSON.stringify(file))
    expect(back.snapshot().standards[0]!.bones.map(b => [b.key, b.name]).sort()).toEqual([['连续曲线1·上骨', '连续曲线1·上骨'], ['连续曲线1·下骨', '连续曲线1·下骨']])
    expect(back.snapshot().standardChoices).toEqual([{ layer: 'L', standard: stdId(d, 'S1'), pairs: [] }])
    // choosing the standard again pairs by name
    back.edit(e => e.useStandard('L', stdId(d, 'S1')))
    expect(back.snapshot().standardChoices[0]!.pairs.map(p => p.key).sort()).toEqual(['连续曲线1·上骨', '连续曲线1·下骨'])
  })
})
