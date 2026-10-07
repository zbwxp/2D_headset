// doc 18 §29 I-1 (dot 1791342672): the author gives open / closed keyframes → edits them → plays by angle × blink,
// both eyes independently. No closed-eye generator anywhere. Old files convert by their OLD evaluated result.
import { describe, expect, it } from 'vitest'
import { ctxOf, playCharacter, prepareCharacter } from '../src/character'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { presetFormsIdOf, presetNeutral } from '../src/forms'
import { graphProblems } from '../src/model'
import { schema, type DocRecord, type Shape } from '../src/schema'
import { converted, rawSample, BEFORE_I1 } from './helpers/stage1'

type P = { x: number; y: number }
const pt = (x: number, y: number): P => ({ x, y })
/** a 3-anchor lid: ends at x0 / x0 + 10 (the corners), middle at height h, shifted by dx */
const lid = (ids: [string, string, string], x0: number, h: number, dx = 0): Shape => {
  const [a, m, b] = ids
  const q = (p: P) => ({ p, hIn: pt(p.x - 1, p.y), hOut: pt(p.x + 1, p.y) })
  return { [a]: q(pt(x0 + dx, 0)), [m]: q(pt(x0 + 5 + dx, h)), [b]: q(pt(x0 + 10 + dx, 0)) } as Shape
}
const UP = ['a', 'm', 'b'] as [string, string, string], LO = ['c', 'n', 'd'] as [string, string, string]
const EYES = { L: 0, R: 20 } // x of each eye's left corner
/** the drawing: two eyes, corners linked (a–c, b–d), a family with two presets, one parameter per eye */
function twoEyes(): DocRecord[] {
  const curve = (id: string, sh: Shape, segs: [string, string, string][]) => ({ typeName: 'curve', id, name: id, parentId: 'container:face', index: `a${id.length}`, tags: [], closed: false, depthOffset: 0, stroke: { color: '#000', width: 1 },
    anchors: Object.fromEntries(Object.entries(sh).map(([k, q]) => [k, { id: k, p: q.p, hIn: { x: q.hIn.x - q.p.x, y: q.hIn.y - q.p.y }, hOut: { x: q.hOut.x - q.p.x, y: q.hOut.y - q.p.y } }])), segments: segs.map(([sid, from, to]) => ({ id: sid, from, to })) })
  const recs: any[] = [{ typeName: 'container', id: 'container:face', name: 'face', parentId: null, index: 'a1', visible: true, locked: false, opacity: 1, tags: [] }]
  const curves: string[] = []
  for (const [e, x0] of Object.entries(EYES)) {
    recs.push(curve(`curve:up${e}`, lid(UP, x0, 4), [['u0', 'a', 'm'], ['u1', 'm', 'b']]), curve(`curve:lo${e}`, lid(LO, x0, -3), [['l0', 'c', 'n'], ['l1', 'n', 'd']]))
    recs.push({ typeName: 'connection', id: `connection:${e}a`, ends: [{ curveId: `curve:up${e}`, anchorId: 'a' }, { curveId: `curve:lo${e}`, anchorId: 'c' }], geometricJoin: 'corner' })
    recs.push({ typeName: 'connection', id: `connection:${e}b`, ends: [{ curveId: `curve:up${e}`, anchorId: 'b' }, { curveId: `curve:lo${e}`, anchorId: 'd' }], geometricJoin: 'corner' })
    curves.push(`curve:up${e}`, `curve:lo${e}`)
    recs.push({ typeName: 'expressionParam', id: `expressionParam:blink${e}`, familyId: 'family:eyes', name: `blink${e}`, curves: [`curve:up${e}`, `curve:lo${e}`] })
  }
  recs.push({ typeName: 'family', id: 'family:eyes', name: 'eyes', curves })
  for (const [p, tilt] of [['P', 0], ['Q', 1]] as const) {
    recs.push({ typeName: 'preset', id: `preset:${p}`, name: p, familyId: 'family:eyes' })
    for (const [e, x0] of Object.entries(EYES))
      for (const [c, ids, h] of [[`curve:up${e}`, UP, 4], [`curve:lo${e}`, LO, -3]] as const)
        recs.push({ typeName: 'forms', id: presetFormsIdOf(`preset:${p}`, c), curveId: c, owner: { kind: 'preset', id: `preset:${p}` }, encoding: 'absolute', original: lid(ids, x0, h + tilt), yaw: [{ yaw: 0, shape: lid(ids, x0, h + tilt) }, { yaw: 90, shape: lid(ids, x0, h + tilt, 3) }], expr: {} })
  }
  recs.push({ typeName: 'character', id: 'character:K', name: 'K', familyId: 'family:eyes', weights: { 'preset:P': 0.6, 'preset:Q': 0.4 }, fineTune: {}, takeovers: [], exprFixes: [] })
  return recs
}
const open = (rs: DocRecord[]) => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: schema.serialize() } as any)
const K = 'character:K' as any
/** the author's closed keyframes: both lids move to a meeting line (upper more, lower less), corners where they are */
const closedUp = (x0: number, dx = 0, extra = 0) => lid(UP, x0, -1 + extra, dx)
const closedLo = (x0: number, dx = 0) => lid(LO, x0, -1, dx)
const cmdKey = (preset: string, c: string, yaw: number, shape: Shape, param: string): Command => ({ type: 'setPresetKey', preset: preset as any, curveId: c as any, yaw, shape, param })
function author(e: Editor) {
  for (const p of ['P', 'Q'])
    for (const [ey, x0] of Object.entries(EYES))
      for (const [yaw, dx] of [[0, 0], [90, 3]] as const) {
        for (const [c, sh] of [[`curve:up${ey}`, closedUp(x0, dx)], [`curve:lo${ey}`, closedLo(x0, dx)]] as const) {
          const r = e.apply(cmdKey(`preset:${p}`, c, yaw, sh, `blink${ey}`))
          if (!r.ok) throw new Error(r.error.message)
        }
      }
}
const play = (e: Editor, yaw: number | undefined, params: Record<string, number>) => {
  const p = e.derived.character(K)
  if (!p.ok) throw new Error(p.problems.join())
  return playCharacter(p.grid, { yaw, params })
}
const shapes = (e: Editor, yaw: number, params: Record<string, number>) => {
  const r = play(e, yaw, params)
  if (!r.ok) throw new Error(r.problems.join())
  return r.shapes
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

describe('§29 I-1: author keyframes → edit → play (two independent eyes)', () => {
  it('parameters name their curves; an unfinished draft (no closed keyframes) opens, saves and plays OPEN; closing it reports the missing keyframes', () => {
    const e = open(twoEyes())
    expect(graphProblems(e.reader)).toEqual([])
    expect(Object.keys(shapes(e, 30, {})).sort()).toEqual(['curve:loL', 'curve:loR', 'curve:upL', 'curve:upR']) // the open eyes play
    const r = play(e, 30, { blinkL: 1 })
    expect(r.ok === false && r.problems.join()).toMatch(/blinkL cannot be played: missing blinkL keyframes of curve:upL in preset:P, preset:Q \(drawn by the author, never generated\)/)
    expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
    // half-drawn: only P has the left eye's keyframes → still reported (Q), the draft saves
    for (const [c, sh] of [['curve:upL', closedUp(0)], ['curve:loL', closedLo(0)]] as const) expect(e.apply(cmdKey('preset:P', c, 0, sh, 'blinkL')).ok).toBe(true)
    const half = play(e, 30, { blinkL: 1 })
    expect(half.ok === false && half.problems.join()).toMatch(/in preset:Q/)
    expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
  })

  it('a keyframe on a curve the parameter does not name is refused (never guessed)', () => {
    const e = open(twoEyes())
    const r = e.apply(cmdKey('preset:P', 'curve:upR', 0, closedUp(EYES.R), 'blinkL'))
    expect(r.ok === false && r.error.message).toMatch(/expressionParam:blinkL does not act on curve:upR/)
  })

  it('plays every (yaw, blinkL, blinkR): each lid interpolates between its own open and closed keyframes; one eye closed, the other open; corners never split', () => {
    const e = open(twoEyes())
    author(e)
    expect(graphProblems(e.reader)).toEqual([])
    for (const yaw of [0, 30, 45, 90, 120]) {
      const t = Math.min(Math.max(yaw / 90, 0), 1)
      for (const bl of [0, 0.5, 1])
        for (const br of [0, 0.25, 1]) {
          const s = shapes(e, yaw, { blinkL: bl, blinkR: br })
          for (const [ey, b] of [['L', bl], ['R', br]] as const) {
            // independent formula: neutral middle = Σw (h + tilt), closed middle = -1 (both presets); x shifts 3·t
            const nUp = 0.6 * 4 + 0.4 * 5, nLo = 0.6 * -3 + 0.4 * -2
            expect(s[`curve:up${ey}`].m.p.y).toBeCloseTo(lerp(nUp, -1, b), 12)
            expect(s[`curve:lo${ey}`].n.p.y).toBeCloseTo(lerp(nLo, -1, b), 12)
            expect(s[`curve:up${ey}`].m.p.x).toBeCloseTo(EYES[ey] + 5 + 3 * t, 12)
            for (const [u, l] of [['a', 'c'], ['b', 'd']]) expect(s[`curve:up${ey}`][u].p).toEqual(s[`curve:lo${ey}`][l].p)
          }
        }
    }
    // no-yaw context: the front, without expressions (kept apart from yaw 0)
    expect(play(e, undefined, {}).ok).toBe(true)
    const nz = play(e, undefined, { blinkL: 1 })
    expect(nz.ok === false && nz.problems.join()).toMatch(/no-yaw context/)
  })

  it('edits: the upper lid alone (interior) leaves the lower lid; moving a shared corner moves the linked lid’s keyframe in the SAME step; preview / cancel / commit / undo / redo', () => {
    const e = open(twoEyes())
    author(e)
    const forms = (p: string, c: string) => e.reader.get(presetFormsIdOf(p, c) as any) as any
    const lo0 = JSON.stringify(forms('preset:P', 'curve:loL').expr.blinkL)
    // (1) upper lid interior only
    expect(e.apply(cmdKey('preset:P', 'curve:upL', 0, closedUp(0, 0, 0.5), 'blinkL')).ok).toBe(true)
    expect(JSON.stringify(forms('preset:P', 'curve:loL').expr.blinkL)).toBe(lo0)
    // (2) the lower lid alone, moving its left corner: the upper lid's linked end moves with it, atomically
    const moved = { ...closedLo(0), c: { p: pt(0, 0.4), hIn: pt(-1, 0.4), hOut: pt(1, 0.4) } } as Shape
    const cmd = cmdKey('preset:P', 'curve:loL', 0, moved, 'blinkL')
    const before = JSON.stringify(e.reader.allRecords())
    const op = e.prepare()
    const pv = op.preview(cmd)
    expect(pv.ok && pv.affected.sort()).toEqual([presetFormsIdOf('preset:P', 'curve:loL'), presetFormsIdOf('preset:P', 'curve:upL')].sort())
    expect(JSON.stringify(e.reader.allRecords())).toBe(before) // preview writes nothing
    op.cancel()
    expect(JSON.stringify(e.reader.allRecords())).toBe(before) // cancel writes nothing
    const op2 = e.prepare()
    op2.preview(cmd)
    const r = op2.commit()
    expect(r.ok && r.written).toBe(true)
    const up = forms('preset:P', 'curve:upL').expr.blinkL.find((k: any) => k.yaw === 0).shape
    expect(up.a.p).toEqual(pt(0, 0.4))
    expect(up.m).toEqual(closedUp(0, 0, 0.5).m) // the upper lid's interior kept
    const after = JSON.stringify(e.reader.allRecords())
    expect(e.undo()).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(before) // one step undoes both lids
    expect(e.redo()).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(after)
    expect(graphProblems(e.reader)).toEqual([])
    const s = shapes(e, 0, { blinkL: 1 })
    expect(s['curve:upL'].a.p).toEqual(s['curve:loL'].c.p)
    // (3) a character keyframe of the lower lid alone that moves the shared corner: the upper lid's end moves with it
    // in the same step (as for a preset key — dot, review of 6eb9635 B2); its other anchors, the other eye and the
    // presets are untouched; one undo restores everything
    const c = shapes(e, 0, { blinkL: 1 })
    const lift = { ...c['curve:loL'], d: { p: pt(c['curve:loL'].d.p.x, c['curve:loL'].d.p.y + 0.3), hIn: pt(c['curve:loL'].d.hIn.x, c['curve:loL'].d.hIn.y + 0.3), hOut: pt(c['curve:loL'].d.hOut.x, c['curve:loL'].d.hOut.y + 0.3) } } as Shape
    const beforeLift = JSON.stringify(e.reader.allRecords())
    const presetsBefore = JSON.stringify(e.reader.allRecords().filter((r: any) => r.typeName === 'forms'))
    const op3 = e.prepare()
    expect(op3.preview({ type: 'fixExpression', character: K, param: 'blinkL', yaw: 0, keyframes: { 'curve:loL': lift } }).ok).toBe(true)
    expect(op3.commit().ok).toBe(true)
    const s3 = shapes(e, 0, { blinkL: 1 })
    expect(s3['curve:loL']).toEqual(lift)
    const ub = c['curve:upL'].b
    expect(s3['curve:upL']).toEqual({ ...c['curve:upL'], b: { p: lift.d.p, hIn: pt(ub.hIn.x + lift.d.p.x - ub.p.x, ub.hIn.y + lift.d.p.y - ub.p.y), hOut: pt(ub.hOut.x + lift.d.p.x - ub.p.x, ub.hOut.y + lift.d.p.y - ub.p.y) } })
    for (const k of ['curve:upR', 'curve:loR']) expect(s3[k]).toEqual(c[k])
    expect(JSON.stringify(e.reader.allRecords().filter((r: any) => r.typeName === 'forms'))).toBe(presetsBefore)
    expect(e.undo()).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(beforeLift)
    // two given ends that disagree are refused
    const no = e.apply({ type: 'fixExpression', character: K, param: 'blinkL', yaw: 0, keyframes: { 'curve:loL': lift, 'curve:upL': c['curve:upL'] } })
    expect(no.ok === false && no.error.message).toMatch(/the given ends of .* differ: one shared point/)
    const both = e.apply({ type: 'fixExpression', character: K, param: 'blinkL', yaw: 0, keyframes: { 'curve:loL': lift, 'curve:upL': { ...c['curve:upL'], b: lift.d } } })
    expect(both.ok).toBe(true)
  })

  it('saves and reopens (formal snapshot, JSON round trip) with the same playback', () => {
    const e = open(twoEyes())
    author(e)
    const again = Editor.open(JSON.parse(JSON.stringify(e.save())))
    for (const yaw of [0, 45, 90]) expect(shapes(again, yaw, { blinkL: 0.5, blinkR: 1 })).toEqual(shapes(e, yaw, { blinkL: 0.5, blinkR: 1 }))
  })
})

describe('§29 I-1: old files convert by their OLD evaluated result (dot 1791342672)', () => {
  it('a preset author key: stored base 10, target 12, current base 11 → 13 after the conversion (every anchor)', () => {
    const raw = rawSample()
    const lid = raw.find((r: any) => r.id === 'forms:preset:P/curve:lid')
    const lower = raw.find((r: any) => r.id === 'forms:preset:P/curve:lowerLid')
    const k0 = lid.expr.blink.find((k: any) => k.kind === 'author' && k.yaw === 0)
    const now = lower.yaw.find((k: any) => k.yaw === 0).shape.n.p.y // the current base of m (lidClose: m ← n)
    k0.base.m.p.y = now - 1 // captured when the base was 1 lower ("10" vs "11")
    k0.target.m.p.y = k0.base.m.p.y + 2 // the author's correction "+2" ("12")
    const e = Editor.open({ store: Object.fromEntries(raw.map((r: any) => [r.id, r])), schema: BEFORE_I1 } as any)
    const key = (e.reader.get('forms:preset:P/curve:lid' as any) as any).expr.blink.find((k: any) => k.yaw === 0)
    expect(key.shape.m.p.y).toBe(now + 2) // "13": the current base + the kept correction, as the old evaluation showed
    expect(Object.keys(key).sort()).toEqual(['shape', 'yaw'])
  })

  it('a character’s expression fix converts by the CHARACTER’s old evaluation (its own lower lid there + the fix’s correction)', () => {
    const raw = rawSample()
    const fix = raw.find((r: any) => r.id === 'character:K').exprFixes[0]
    const e = Editor.open({ store: Object.fromEntries(raw.map((r: any) => [r.id, r])), schema: BEFORE_I1 } as any)
    const K2 = e.reader.get(K) as any
    const conv = K2.exprFixes.find((x: any) => x.id === fix.id)
    expect(conv).toMatchObject({ curveId: fix.curveId, param: 'blink', yaw: fix.state.yaw })
    // independent: the character's lower lid at that yaw (its neutral grid) through the old correspondence + target − base
    const recs = converted()
    const p = prepareCharacter(ctxOf({ get: (id: string) => recs.find((r) => r.id === id), allRecords: () => recs } as any), K, { neutralOnly: true, extraYaws: [fix.state.yaw] })
    if (!p.ok) throw new Error(p.problems.join())
    const low = p.grid.curves['curve:lowerLid'].neutral[p.grid.yaws.indexOf(fix.state.yaw)]
    for (const [u, l] of Object.entries({ a: 'c', m: 'n', b: 'd' }))
      for (const h of ['p', 'hIn', 'hOut'] as const) {
        expect(conv.shape[u][h].x).toBeCloseTo(low[l][h].x + fix.target[u][h].x - fix.base[u][h].x, 12)
        expect(conv.shape[u][h].y).toBeCloseTo(low[l][h].y + fix.target[u][h].y - fix.base[u][h].y, 12)
      }
  })

  it('the old source lid gets explicit closed keyframes equal to its neutral form (it did not move when closed): every yaw shows the same as before', () => {
    const raw = rawSample()
    const e = Editor.open({ store: Object.fromEntries(raw.map((r: any) => [r.id, r])), schema: BEFORE_I1 } as any)
    for (const p of ['preset:P', 'preset:Q']) {
      const low = e.reader.get(presetFormsIdOf(p, 'curve:lowerLid') as any) as any
      const keyYaws = low.expr.blink.map((k: any) => k.yaw)
      for (const k of low.yaw) expect(keyYaws).toContain(k.yaw) // its neutral breakpoints are keyframes too
      for (const k of low.expr.blink) expect(k.shape).toEqual(presetNeutral(low, k.yaw)) // exactly its neutral form there
    }
    expect(e.reader.allRecords().some((r: any) => r.typeName === 'rule')).toBe(false)
    expect(e.reader.get('expressionParam:eye/blink' as any)).toMatchObject({ name: 'blink', curves: ['curve:lid', 'curve:lowerLid'] })
  })
})
