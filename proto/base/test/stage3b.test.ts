// Stage 3b (doc 18 §24.5 / §24.6): preset-author and character commands through the real write entry; the §16
// flow run on the product against the flowVerify oracle (where the two models coincide).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { playCharacter, type CharacterGrid } from '../src/character'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { blinkRule, fineTuneUp, fineTuneUpAndLower, makeDoc, playback, rebuild, AFFINE_A, AFFINE_B } from '../src/experiments/flowVerify'
import { curveIds, type Eye } from '../src/experiments/fineTuneTransfer'
import { graphProblems } from '../src/model'
import { schema, type DocRecord, type Shape } from '../src/schema'

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'))
const openRecords = (rs: DocRecord[]) => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: schema.serialize() } as any)
const K = 'character:K' as any
const grid = (e: Editor, id = K): CharacterGrid => {
  const p = e.derived.character(id)
  if (!p.ok) throw new Error(p.problems.join('; '))
  return p.grid
}
const play = (e: Editor, yaw: number, blink = 0, id = K) => {
  const r = playCharacter(grid(e, id), { yaw, params: { blink } })
  if (!r.ok) throw new Error(r.problems.join('; '))
  return r.shapes
}
const apply = (e: Editor, cmd: Command) => {
  const before = JSON.stringify(e.reader.allRecords())
  const r = e.apply(cmd)
  expect(r.ok && r.written, JSON.stringify(r)).toBe(true)
  expect(graphProblems(e.reader)).toEqual([])
  const after = JSON.stringify(e.reader.allRecords())
  expect(e.undo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
  expect(e.redo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(after)
  expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
  return r
}
const refused = (e: Editor, cmd: Command, message: RegExp) => {
  const before = JSON.stringify(e.reader.allRecords())
  const r = e.apply(cmd)
  expect(r.ok, JSON.stringify(r)).toBe(false)
  if (!r.ok) expect(r.error.message).toMatch(message)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
}
const character = (e: Editor) => e.reader.get(K) as any
const maxDiff = (a: Shape, b: Shape) => Math.max(...Object.keys(a).flatMap((k) => (['p', 'hIn', 'hOut'] as const).map((h) => Math.hypot(a[k][h].x - b[k][h].x, a[k][h].y - b[k][h].y))))

describe('character commands on the sample', () => {
  it('setPresetWeights and setFineTune: weights must sum to 1; fine-tune deltas finite; both undoable and reopenable', () => {
    const e = openRecords(json('stage1-valid.json').records)
    refused(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0.5, 'preset:Q': 0.4 } }, /sum to 0.9/)
    refused(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 1.5, 'preset:Q': -0.5 } }, /finite and non-negative/)
    refused(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0, 'preset:Q': 0 } }, /sum to 0/)
    apply(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0.1 + 0.2, 'preset:Q': 0.7 } }) // 0.30000000000000004 + 0.7: rounding only
    apply(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0.25, 'preset:Q': 0.75 } })
    apply(e, { type: 'setFineTune', character: K, curveId: 'curve:lid' as any, anchorId: 'a', delta: { dp: { x: 0, y: 1 }, dIn: { x: 0, y: 1 }, dOut: { x: 0, y: 1 } } })
    expect(character(e).fineTune['curve:lid'].a.dp).toEqual({ x: 0, y: 1 })
    apply(e, { type: 'setFineTune', character: K, curveId: 'curve:lid' as any, anchorId: 'a', delta: null })
    expect(character(e).fineTune['curve:lid'].a).toBeUndefined()
  })

  it('a fine-tune that a preset cannot carry is refused: an edit of a character must leave it playable (preset authoring only reports)', () => {
    const e = openRecords(json('stage1-valid.json').records)
    refused(e, { type: 'setFineTune', character: K, curveId: 'curve:strand' as any, anchorId: 'w', delta: { dp: { x: 1, y: 0 }, dIn: { x: 1, y: 0 }, dOut: { x: 1, y: 0 } } }, /no longer be playable: .*no helper domain at yaw 90/)
  })

  it('fixLine: L fitted on the curve correspondence (front → target), frozen; reproduces its target while the front is unchanged', () => {
    const e = openRecords(json('stage1-valid.json').records)
    const k0 = character(e)
    k0.takeovers // (sample takeovers are replaced by the command for the same curve and direction)
    const at90 = play(e, 90)['curve:lid']
    const target: Shape = Object.fromEntries(Object.entries(at90).map(([a, q]) => [a, a === 'm' ? { p: { x: q.p.x, y: q.p.y - 1 }, hIn: { x: q.hIn.x - 0.5, y: q.hIn.y - 1 }, hOut: { x: q.hOut.x + 0.5, y: q.hOut.y - 1 } } : q]))
    apply(e, { type: 'fixLine', character: K, curveId: 'curve:lid' as any, yaw: 90, target })
    const t = character(e).takeovers.find((x: any) => x.kind === 'line' && x.curveId === 'curve:lid')
    expect(t.id).toBe('takeover:lid@90') // replacing keeps the identity (the node takeover names it)
    expect(t.basisFront).toEqual(grid(e).front['curve:lid'])
    const got = play(e, 90)['curve:lid']
    expect(maxDiff({ m: got.m }, { m: target.m })).toBeLessThan(1e-9) // the interior as accepted; the corners follow the node
    const L = [...t.L]
    apply(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0.9, 'preset:Q': 0.1 } })
    expect(character(e).takeovers.find((x: any) => x.id === 'takeover:lid@90').L).toEqual(L) // frozen
  })

  it('fixNode copies the L of the line takeover at that node and state (basisFrom = its id)', () => {
    const e = openRecords(json('stage1-valid.json').records)
    apply(e, { type: 'fixNode', character: K, connectionId: 'connection:corner' as any, yaw: 90, target: { x: 16, y: -1 } })
    const t = character(e).takeovers.find((x: any) => x.kind === 'node')
    const line = character(e).takeovers.find((x: any) => x.kind === 'line')
    expect(t.basisFrom).toBe(line.id)
    expect(t.L).toEqual(line.L)
    for (const y of [0, 30, 60, 90]) {
      const s = play(e, y)
      expect(s['curve:lid'].b.p).toEqual(s['curve:lowerLid'].d.p)
    }
    expect(play(e, 90)['curve:lowerLid'].d.p).toEqual({ x: 16, y: -1 })
  })

  it('fixNode without a line takeover: L = Σ w · L (our derivation), checked against a finite difference; a blend basis; frozen under weight changes', () => {
    const rs = json('stage1-valid.json').records
    const kr = rs.find((r: any) => r.id === K)
    kr.takeovers = []
    kr.fineTune = {}
    const e = openRecords(rs)
    apply(e, { type: 'fixNode', character: K, connectionId: 'connection:corner' as any, yaw: 90, target: { x: 15, y: 0 } })
    const t = character(e).takeovers[0]
    expect(t.basisFrom).toEqual({ kind: 'blend', yaw: 90, weights: { 'preset:P': 0.6, 'preset:Q': 0.4 } })
    // finite difference of the node's neutral position at 90 for a common fine-tune ε on both ends (no takeover)
    const probe = openRecords(rs)
    const node = (ed: Editor) => grid(ed).curves['curve:lowerLid'].neutral[grid(ed).yaws.indexOf(90)].d.p
    const n0 = node(probe)
    for (const [ex, ey] of [[1e-3, 0], [0, 1e-3]]) {
      const d = { dp: { x: ex, y: ey }, dIn: { x: ex, y: ey }, dOut: { x: ex, y: ey } }
      const fd = openRecords(rs)
      apply(fd, { type: 'setFineTune', character: K, curveId: 'curve:lid' as any, anchorId: 'b', delta: d }) // the linked end d follows (one node)
      expect((fd.reader.get(K) as any).fineTune['curve:lowerLid'].d.dp).toEqual(d.dp)
      const n1 = node(fd)
      const col = ex ? [t.L[0], t.L[1]] : [t.L[2], t.L[3]]
      expect(Math.abs((n1.x - n0.x) / 1e-3 - col[0])).toBeLessThan(1e-9)
      expect(Math.abs((n1.y - n0.y) / 1e-3 - col[1])).toBeLessThan(1e-9)
    }
    const L = [...t.L]
    apply(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0.2, 'preset:Q': 0.8 } })
    expect(character(e).takeovers[0].L).toEqual(L)
  })

  it('fixExpression on the moved role stores target + the base of this moment; clearFix restores the inherited result', () => {
    const e = openRecords(json('stage1-valid.json').records)
    const inherited = play(e, 45, 1)
    const now = play(e, 45, 1)['curve:lid']
    const target: Shape = { ...now, m: { p: { x: now.m.p.x, y: now.m.p.y - 0.7 }, hIn: now.m.hIn, hOut: now.m.hOut } }
    apply(e, { type: 'fixExpression', character: K, curveId: 'curve:lid' as any, param: 'blink', yaw: 45, target })
    expect(maxDiff(play(e, 45, 1)['curve:lid'], target)).toBeLessThan(1e-12)
    refused(e, { type: 'fixExpression', character: K, curveId: 'curve:lowerLid' as any, param: 'blink', yaw: 45, target: play(e, 45, 1)['curve:lowerLid'] }, /not the moved role/)
    apply(e, { type: 'clearFix', character: K, id: 'exprFix:curve:lid@45/blink' })
    expect(play(e, 45, 1)).toEqual(inherited)
  })

  it('setPresetKey: an unmodified key changes nothing; the linked curve gets a key at that yaw with its end moved along; refused when a character would stop playing', () => {
    const rs = json('stage1-valid.json').records
    rs.find((r: any) => r.id === K).fineTune = {}
    const e = openRecords(rs)
    const before = [0, 20, 30, 60, 90].map((y) => play(e, y, 1))
    const P = e.reader.get('forms:preset:P/curve:lid' as any) as any
    const k0 = P.yaw[1].shape, k90 = P.yaw[2].shape
    const at30: Shape = Object.fromEntries(Object.keys(k0).map((a) => [a, Object.fromEntries((['p', 'hIn', 'hOut'] as const).map((h) => [h, { x: k0[a][h].x + (k90[a][h].x - k0[a][h].x) / 3, y: k0[a][h].y + (k90[a][h].y - k0[a][h].y) / 3 }]))])) as any
    apply(e, { type: 'setPresetKey', preset: 'preset:P' as any, curveId: 'curve:lid' as any, yaw: 30, shape: at30 })
    expect((e.reader.get('forms:preset:P/curve:lowerLid' as any) as any).yaw.map((k: any) => k.yaw)).toContain(30) // linked key
    ;[0, 20, 30, 60, 90].forEach((y, i) => expect(maxDiff(play(e, y, 1)['curve:lid'], before[i]['curve:lid'])).toBeLessThan(1e-12))
    // moving the corner in a new neutral key: the linked lower lid's end is moved with it, but the closed track has no
    // key at 30 (its corner stays interpolated) — the node would split in the closed state: refused, not patched
    const moved = { ...at30, b: { p: { x: at30.b.p.x + 1, y: at30.b.p.y }, hIn: { x: at30.b.hIn.x + 1, y: at30.b.hIn.y }, hOut: { x: at30.b.hOut.x + 1, y: at30.b.hOut.y } } }
    refused(e, { type: 'setPresetKey', preset: 'preset:P' as any, curveId: 'curve:lid' as any, yaw: 30, shape: moved }, /ends separate in preset:P at blink at yaw 30/)
    // an interior change at 30 goes through; the linked curve's key keeps its evaluated form
    const inner = { ...at30, m: { p: { x: at30.m.p.x, y: at30.m.p.y - 1 }, hIn: at30.m.hIn, hOut: at30.m.hOut } }
    apply(e, { type: 'setPresetKey', preset: 'preset:P' as any, curveId: 'curve:lid' as any, yaw: 30, shape: inner })
    // with a fine-tune, a new key at a yaw without a helper domain: written with a notice (the basis is added next)
    const f = openRecords(json('stage1-valid.json').records)
    const n = apply(f, { type: 'setPresetKey', preset: 'preset:P' as any, curveId: 'curve:lid' as any, yaw: 30, shape: at30 })
    expect(n.ok && (n as any).notices?.join()).toMatch(/no helper domain at yaw 30/)
  })

  it('setVisibilityKey: presets that would disagree → written with a notice (prepare refuses until they agree); a consistent change has none', () => {
    const e = openRecords(json('stage1-valid.json').records)
    // (1) the author's commit goes through with a notice (an unfinished preset state is allowed) …
    const r = apply(e, { type: 'setVisibilityKey', preset: 'preset:P' as any, curveId: 'curve:strand' as any, yaw: 30, visible: false })
    expect(r.ok && (r as any).notices?.join()).toMatch(/disagree on visibility/)
    // (2) … but blending the character refuses the conflict — never a playable result (dot 1791316457)
    const blended = e.derived.character(K)
    expect(blended.ok === false && blended.problems.join()).toMatch(/disagree on visibility at yaw 30/)
    expect(e.undo()).toBe(true)
    const k = character(e)
    apply(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 1 } })
    apply(e, { type: 'setVisibilityKey', preset: 'preset:P' as any, curveId: 'curve:strand' as any, yaw: 50, visible: false })
    expect(playCharacter(grid(e), { yaw: 60 }).ok && (playCharacter(grid(e), { yaw: 60 }) as any).visible['curve:strand']).toBe(false)
    void k
  })

  it('a character already unplayable before the edit: its own edits are still refused unless the result plays; author edits keep giving the notice (dot, review of 513444f)', () => {
    const e = openRecords(json('stage1-valid.json').records)
    apply(e, { type: 'setVisibilityKey', preset: 'preset:P' as any, curveId: 'curve:strand' as any, yaw: 30, visible: false })
    expect(e.derived.character(K).ok).toBe(false)
    // (1) a character edit whose result is still unplayable → refused, nothing written
    refused(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 0.5, 'preset:Q': 0.5 } }, /would no longer be playable: .*disagree on visibility at yaw 30/)
    // (2) a further author edit: written, and preview and commit both carry the notice
    const cmd: Command = { type: 'setVisibilityKey', preset: 'preset:P' as any, curveId: 'curve:strand' as any, yaw: 50, visible: false }
    const pv = e.prepare().preview(cmd)
    expect(pv.ok && (pv as any).notices?.join()).toMatch(/character:K cannot be prepared until: .*disagree on visibility/)
    const r = apply(e, cmd)
    expect(r.ok && (r as any).notices?.join()).toMatch(/character:K cannot be prepared until: .*disagree on visibility/)
    // (3) a character edit that makes it playable again is allowed
    apply(e, { type: 'setPresetWeights', character: K, weights: { 'preset:P': 1 } })
    expect(e.derived.character(K).ok).toBe(true)
  })

  it('identity: a prepared preset-mode createCurve re-aimed at another preset gets its own new curve id', () => {
    const e = openRecords(json('stage1-valid.json').records)
    const four = { anchors: { p: { id: 'p', p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 1, y: 0 } }, q: { id: 'q', p: { x: 9, y: 0 }, hIn: { x: -1, y: 0 }, hOut: { x: 0, y: 0 } } }, segments: [{ id: 'k1', from: 'p', to: 'q' }] }
    const op = e.prepare()
    const a = op.preview({ type: 'createCurve', parentId: 'container:L1' as any, preset: 'preset:P' as any, ...four })
    const b = op.preview({ type: 'createCurve', parentId: 'container:L1' as any, preset: 'preset:Q' as any, ...four })
    expect(a.ok && b.ok && a.affected[0] !== b.affected[0]).toBe(true)
    const again = op.preview({ type: 'createCurve', parentId: 'container:L1' as any, preset: 'preset:P' as any, ...four })
    expect(again.ok && a.ok && again.affected[0] === a.affected[0]).toBe(true) // back to the first target: its identity
  })
})

// ---------- the §16 flow on the product, against the flowVerify oracle ----------
/** flowVerify's eye (four cubics) as two product curves: upper a–m–b, lower c–n–d */
const toShapes = (e: Eye) => ({
  'curve:upper': { a: { p: e.U0[0], hIn: e.U0[0], hOut: e.U0[1] }, m: { p: e.U0[3], hIn: e.U0[2], hOut: e.U1[1] }, b: { p: e.U1[3], hIn: e.U1[2], hOut: e.U1[3] } } as Shape,
  'curve:lower': { c: { p: e.L0[0], hIn: e.L0[0], hOut: e.L0[1] }, n: { p: e.L0[3], hIn: e.L0[2], hOut: e.L1[1] }, d: { p: e.L1[3], hIn: e.L1[2], hOut: e.L1[3] } } as Shape,
})
const fromShapes = (s: Record<string, Shape>): Eye => {
  const u = s['curve:upper'], l = s['curve:lower']
  return { U0: [u.a.p, u.a.hOut, u.m.hIn, u.m.p], U1: [u.m.p, u.m.hOut, u.b.hIn, u.b.p], L0: [l.c.p, l.c.hOut, l.n.hIn, l.n.p], L1: [l.n.p, l.n.hOut, l.d.hIn, l.d.p] }
}
const eyeDiff = (a: Eye, b: Eye) => Math.max(...curveIds.flatMap((id) => a[id].map((p, i) => Math.hypot(p.x - b[id][i].x, p.y - b[id][i].y))))
const fineOf = (f: Eye) => {
  const s = toShapes(f)
  const pd = (q: Shape[string]) => ({ dp: q.p, dIn: q.hIn, dOut: q.hOut })
  return Object.fromEntries(Object.entries(s).map(([c, sh]) => [c, Object.fromEntries(Object.entries(sh).map(([a, q]) => [a, pd(q)]))]))
}
/**
 * flowVerify's doc with ONE change both sides share: A's author closed target at 0° lifts the upper lid's middle only.
 * (flowVerify's own target lifts the eye tail of BOTH lids; in the product only the rule's moved role — the upper lid —
 * has an expression track and the lower lid keeps its neutral shape when closed, so that target is not expressible:
 * a stated limit of the §24 contract, reported.)
 */
function flowDoc() {
  const doc = makeDoc()
  const open = doc.presets.A.keys['0|open']!
  const closed = blinkRule(open)
  const up = (q: { x: number; y: number }) => ({ x: q.x, y: q.y - 0.6 })
  doc.presets.A.keys['0|closed'] = { ...closed, U0: closed.U0.map((q, i) => (i >= 2 ? up(q) : q)) as any, U1: closed.U1.map((q, i) => (i <= 1 ? up(q) : q)) as any }
  return doc
}
function flowArchive(): DocRecord[] {
  const doc = flowDoc()
  const curve = (id: string, sh: Shape, segs: [string, string, string][]) => ({ typeName: 'curve', id, name: id, parentId: 'container:E', index: 'a1', tags: [], closed: false, depthOffset: 0, stroke: { color: '#000', width: 1 },
    anchors: Object.fromEntries(Object.entries(sh).map(([a, q]) => [a, { id: a, p: q.p, hIn: { x: q.hIn.x - q.p.x, y: q.hIn.y - q.p.y }, hOut: { x: q.hOut.x - q.p.x, y: q.hOut.y - q.p.y } }])), segments: segs.map(([sid, from, to]) => ({ id: sid, from, to })) })
  const front = toShapes(doc.presets.A.keys['0|open']!)
  const recs: any[] = [
    { typeName: 'container', id: 'container:E', name: 'eye', parentId: null, index: 'a1', visible: true, locked: false, opacity: 1, tags: [] },
    curve('curve:upper', front['curve:upper'], [['u0', 'a', 'm'], ['u1', 'm', 'b']]),
    curve('curve:lower', front['curve:lower'], [['l0', 'c', 'n'], ['l1', 'n', 'd']]),
    { typeName: 'connection', id: 'connection:left', ends: [{ curveId: 'curve:upper', anchorId: 'a' }, { curveId: 'curve:lower', anchorId: 'c' }], geometricJoin: 'corner' },
    { typeName: 'connection', id: 'connection:right', ends: [{ curveId: 'curve:upper', anchorId: 'b' }, { curveId: 'curve:lower', anchorId: 'd' }], geometricJoin: 'corner' },
    { typeName: 'family', id: 'family:eye', name: 'eye', curves: ['curve:upper', 'curve:lower'] },
    { typeName: 'rule', id: 'rule:blink', familyId: 'family:eye', param: 'blink', kind: 'lidClose', version: 1, roles: { upper: 'curve:upper', lower: 'curve:lower' }, correspondence: { a: 'c', m: 'n', b: 'd' } },
  ]
  for (const [pid, aff] of [['A', AFFINE_A], ['B', AFFINE_B]] as const) {
    const k = doc.presets[pid].keys
    recs.push({ typeName: 'preset', id: `preset:${pid}`, name: pid, familyId: 'family:eye' })
    recs.push({ typeName: 'helperDomain', id: `helperDomain:${pid}/90`, presetId: `preset:${pid}`, yaw: 90, affine: { a: aff.m[0], b: aff.m[1], c: aff.m[2], d: aff.m[3], e: aff.t.x, f: aff.t.y }, source: { yaw: 0 }, target: { yaw: 90 }, ruleVersion: 1 })
    const o0 = toShapes(k['0|open']!), o90 = toShapes(k['90|open']!)
    for (const c of ['curve:upper', 'curve:lower'] as const) {
      const expr: any = {}
      if (c === 'curve:upper') {
        const closed0 = k['0|closed']
        // closed keys at both yaws (flowVerify computes 0 and 90 for every preset): author target where A has one
        expr.blink = [closed0 ? { yaw: 0, kind: 'author', target: toShapes(closed0)['curve:upper'], base: toShapes(blinkRule(k['0|open']!))['curve:upper'], ruleVersion: 1 } : { yaw: 0, kind: 'rule' }, { yaw: 90, kind: 'rule' }]
      }
      recs.push({ typeName: 'forms', id: `forms:preset:${pid}/${c}`, curveId: c, owner: { kind: 'preset', id: `preset:${pid}` }, encoding: 'absolute', original: o0[c], yaw: [{ yaw: 0, shape: o0[c] }, { yaw: 90, shape: o90[c] }], expr })
    }
  }
  recs.push({ typeName: 'character', id: 'character:c1', name: 'c1', familyId: 'family:eye', weights: { 'preset:A': 0.5, 'preset:B': 0.5 }, fineTune: {}, takeovers: [], exprFixes: [] })
  return recs
}

// NOT covered (stated, dot 1791314662): the original §16 joint closed-eye fix of BOTH lids' tail. The product's
// expression tracks live on the rule's moved role only, so that author / character target is refused (see the last
// test); the shared fixture below lifts the upper middle, and only the shared part is compared with flowVerify.
describe('§16 flow through the product (oracle: flowVerify where the two models coincide)', () => {
  const C1 = 'character:c1' as any
  const oracle = flowDoc() // flowVerify data, edited in step with the product
  const e = openRecords(flowArchive())
  const productCache = (blink: number, yaw: number) => fromShapes(play(e, yaw, blink, C1))
  const check = (label: string) => {
    const o = rebuild(oracle, 'c1')
    let worst = 0
    for (const y of [0, 30, 45, 90]) for (const b of [0, 0.5, 1]) worst = Math.max(worst, eyeDiff(productCache(b, y), playback(o, y, b)))
    expect(worst, label).toBeLessThan(1e-12)
    return worst
  }
  it('1. the preset blend (no fine-tune, no fixes) equals the oracle at every yaw and blink', () => check('blend'))
  it('2. fine-tune: Σ w (K + L f) at 90°, closed states close — equals the oracle', () => {
    oracle.characters.c1.fineTune = fineTuneUp(1.2)
    for (const [c, as] of Object.entries(fineOf(fineTuneUp(1.2)))) for (const [a, d] of Object.entries(as)) if ([d.dp, d.dIn, d.dOut].some((q: any) => q.x || q.y)) apply(e, { type: 'setFineTune', character: C1, curveId: c as any, anchorId: a, delta: d as any })
    check('fine-tune')
  })
  it('3. weights changed: equals the oracle', () => {
    oracle.characters.c1.weights = { A: 0.7, B: 0.3 }
    apply(e, { type: 'setPresetWeights', character: C1, weights: { 'preset:A': 0.7, 'preset:B': 0.3 } })
    check('weights')
  })
  it('4. expression fix at 90° closed (interior of the upper lid): reproduces its target; after a further fine-tune: new base + the kept correction (oracle)', () => {
    const now = productCache(1, 90)
    const target = { ...now, U0: now.U0.map((p, i) => (i === 2 ? { x: p.x + 0.2, y: p.y - 0.6 } : i === 3 ? { x: p.x, y: p.y - 0.6 } : p)) as any, U1: now.U1.map((p, i) => (i === 0 ? { x: p.x, y: p.y - 0.6 } : i === 1 ? { x: p.x - 0.2, y: p.y - 0.6 } : p)) as any }
    apply(e, { type: 'fixExpression', character: C1, curveId: 'curve:upper' as any, param: 'blink', yaw: 90, target: toShapes(target)['curve:upper'] })
    const base = blinkRule(rebuild(oracle, 'c1')['90|open'])
    oracle.characters.c1.exprFixes = [{ kind: 'expression', state: '90|closed', target, base }]
    expect(eyeDiff(productCache(1, 90), target)).toBeLessThan(1e-12)
    check('expression fix')
    oracle.characters.c1.fineTune = fineTuneUpAndLower(0.5, 0.7)
    for (const c of ['curve:upper', 'curve:lower']) for (const a of c === 'curve:upper' ? ['a', 'm', 'b'] : ['c', 'n', 'd']) if ((e.reader.get(C1) as any).fineTune[c]?.[a]) apply(e, { type: 'setFineTune', character: C1, curveId: c as any, anchorId: a, delta: null })
    for (const [c, as] of Object.entries(fineOf(fineTuneUpAndLower(0.5, 0.7)))) for (const [a, d] of Object.entries(as)) if ([d.dp, d.dIn, d.dOut].some((q: any) => q.x || q.y)) apply(e, { type: 'setFineTune', character: C1, curveId: c as any, anchorId: a, delta: d as any })
    check('fine-tune after the expression fix')
  })
  it('5. save → reopen gives the same playback; playback writes nothing', () => {
    const before = JSON.stringify(e.reader.allRecords())
    const r = Editor.open(JSON.parse(JSON.stringify(e.save())))
    for (const y of [0, 45, 90]) expect(fromShapes(playCharacter(grid(r, C1), { yaw: y, params: { blink: 0.5 } }).ok ? (playCharacter(grid(r, C1), { yaw: y, params: { blink: 0.5 } }) as any).shapes : {})).toEqual(productCache(0.5, y))
    expect(JSON.stringify(e.reader.allRecords())).toBe(before)
  })
  it('6. line takeover at 90° on the upper lid: the interior follows target + L·(front − basisFront) (independent formula); the shared corners stay on the node (§17 — where flowVerify, per cubic, would split them)', () => {
    const now = play(e, 90, 0, C1)['curve:upper']
    const target: Shape = { ...now, m: { p: { x: now.m.p.x + 0.4, y: now.m.p.y - 0.5 }, hIn: { x: now.m.hIn.x + 0.4, y: now.m.hIn.y - 0.5 }, hOut: { x: now.m.hOut.x + 0.4, y: now.m.hOut.y - 0.5 } } }
    apply(e, { type: 'fixLine', character: C1, curveId: 'curve:upper' as any, yaw: 90, target })
    const t = (e.reader.get(C1) as any).takeovers[0]
    apply(e, { type: 'setPresetWeights', character: C1, weights: { 'preset:A': 0.4, 'preset:B': 0.6 } })
    const front = grid(e, C1).front['curve:upper']!
    const L = t.L
    const want = (q: { x: number; y: number }, b: { x: number; y: number }, f: { x: number; y: number }) => ({ x: q.x + L[0] * (f.x - b.x) + L[2] * (f.y - b.y), y: q.y + L[1] * (f.x - b.x) + L[3] * (f.y - b.y) })
    const got = play(e, 90, 0, C1)['curve:upper']
    expect(Math.hypot(got.m.p.x - want(t.target.m.p, t.basisFront.m.p, front.m.p).x, got.m.p.y - want(t.target.m.p, t.basisFront.m.p, front.m.p).y)).toBeLessThan(1e-12)
    const s = play(e, 90, 0, C1)
    expect(s['curve:upper'].b.p).toEqual(s['curve:lower'].d.p)
    expect(s['curve:upper'].a.p).toEqual(s['curve:lower'].c.p)
  })
})

it('the original §16 joint closed-eye target (both lids) is refused, not silently approximated', () => {
  const rs = flowArchive()
  const lower = rs.find((r: any) => r.id === 'forms:preset:A/curve:lower') as any
  lower.expr = { blink: [{ yaw: 0, kind: 'rule' }] } // an expression track on the lower lid (the source role)
  expect(() => openRecords(rs)).toThrow(/curve:lower has a blink track but is not the moved role/)
  const e = openRecords(flowArchive())
  const now = (e.derived.character('character:c1') as any).grid.curves['curve:lower'].neutral[0]
  refused(e, { type: 'fixExpression', character: 'character:c1' as any, curveId: 'curve:lower' as any, param: 'blink', yaw: 0, target: now }, /not the moved role/)
})
