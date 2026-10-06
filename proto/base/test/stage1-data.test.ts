// Stage 1 (doc 18 §23.2; samples/stage1-archive.md v4.1): data records and the REAL migration read.
// Limited contract: archives open and validate; old files migrate and are read through the migrated records with
// exactly the old numbers. Character rebuild / playback is stage 3 and is not claimed here.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { evaluate } from '../src/evaluate'
import { presetExpr, presetFormsIdOf, presetNeutral } from '../src/forms'
import { graphProblems } from '../src/model'
import { evaluateAtYaw, legacyKeys } from '../src/pose'
import { evaluateSaved } from '../src/runtime'
import { schema, type DocRecord, type FormsRecord } from '../src/schema'

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'))
const legacySnapshot = () => json('legacy-v1-snapshot.json')
const golden = json('legacy-v1-golden.json')
const yaws = Object.keys(golden.atYaw).map(Number)
const same = (a: unknown, b: unknown) => expect(JSON.stringify(a)).toBe(JSON.stringify(b)) // same doubles (−0 ≡ 0 aside)
const archive = (records: DocRecord[]) => ({ store: Object.fromEntries(records.map((r) => [r.id, r])), schema: schema.serialize() })
const sample = (): DocRecord[] => json('stage1-valid.json').records
const openRecords = (records: DocRecord[]) => Editor.open(archive(records) as any)

describe('migration of old files: pose → legacy forms, read with the old numbers', () => {
  it('an old file opens migrated: no pose records left, one legacy forms record per old pose with the same keys', () => {
    const old = legacySnapshot()
    const oldPoses = Object.values(old.store).filter((r: any) => r.typeName === 'pose') as any[]
    expect(oldPoses.length).toBe(3)
    const e = Editor.open(old)
    expect(e.reader.allRecords().some((r) => (r as any).typeName === 'pose')).toBe(false)
    for (const p of oldPoses) {
      const f = e.reader.get(`forms:document/${p.curveId}` as any) as FormsRecord
      expect(f).toMatchObject({ typeName: 'forms', encoding: 'legacy-delta', original: 'curve', owner: { kind: 'document' }, expr: {} })
      same(legacyKeys(f), p.keys)
    }
  })

  it('exactly the old numbers: base, every yaw (negative, arbitrary, between keys, outside), cached, runtime — direct curves and the mirrored reference with an override', () => {
    const e = Editor.open(legacySnapshot())
    same(evaluate(e.reader), golden.base)
    for (const y of yaws) {
      same(evaluateAtYaw(e.reader, y), golden.atYaw[y])
      same(e.derived.atYaw(y), golden.derived[y])
      same(evaluateSaved(e.reader.allRecords(), { yaw: y }), golden.runtime[y])
    }
    // the golden data really covers the reference instance and its override
    expect(JSON.stringify(golden.atYaw[60])).toContain('reference:R1/curve:E1')
  })

  it('the evaluation READS the migrated records: changing a migrated offset changes the result (no silent old path)', () => {
    const old = legacySnapshot()
    const e0 = Editor.open(old)
    const f = structuredClone(e0.reader.get('forms:document/curve:E1' as any)) as any
    f.yaw[f.yaw.length - 1].offsets.e1 = { x: 100, y: 100 }
    const changed = e0.reader.allRecords().map((r) => (r.id === f.id ? f : r))
    expect(JSON.stringify(evaluateSaved(changed, { yaw: 120 }))).not.toBe(JSON.stringify(golden.runtime[120]))
  })

  it('migrated files save in the new schema and reopen with the same numbers; legacy setPoseKey writes the legacy forms record', () => {
    const e = Editor.open(legacySnapshot())
    const saved = JSON.parse(JSON.stringify(e.save()))
    expect(saved.schema.sequences['contour.document']).toBe(1)
    const again = Editor.open(saved)
    for (const y of yaws) same(evaluateAtYaw(again.reader, y), golden.atYaw[y])
    const r = again.apply({ type: 'setPoseKey', curveId: 'curve:E1' as any, yaw: 10, offsets: { e2: { x: 1, y: 1 } } })
    expect(r.ok && r.written).toBe(true)
    expect((again.reader.get('forms:document/curve:E1' as any) as FormsRecord).yaw.map((k) => k.yaw)).toContain(10)
  })
})

describe('the stage-1 sample archive', () => {
  it('the complete valid sample opens with no problems', () => {
    const e = openRecords(sample())
    expect(graphProblems(e.reader)).toEqual([])
    expect(e.reader.allRecords().length).toBe(25)
  })

  it('preset-level reading: no-yaw context, yaw track, expression track (§20); identity-only shapes are missing, not (0, 0)', () => {
    const e = openRecords(sample())
    const f = (p: string, c: string) => e.reader.get(presetFormsIdOf(p, c) as any) as FormsRecord
    const lidP = f('preset:P', 'curve:lid')
    expect(presetNeutral(lidP)).toEqual(lidP.original)
    expect(presetNeutral(lidP, 0)).toEqual((lidP.yaw[1] as any).shape)
    expect(presetNeutral(f('preset:P', 'curve:strand'))).toBeNull() // only drawn at 90: no original
    // closed at the author key reproduces the target (base unchanged since capture)
    const k0 = (lidP.expr.blink as any[]).find((k) => k.yaw === 0)
    expect(presetExpr(e.reader, lidP, 'blink', 0)).toEqual(k0.target)
    const bad = openRecords(json('stage1-invalid-missing.json').records)
    const qStrand = bad.reader.get(presetFormsIdOf('preset:Q', 'curve:strand') as any) as FormsRecord
    expect(presetNeutral(qStrand)).toBeNull()
    expect(presetNeutral(qStrand, 90)).toBeNull() // identity only: missing everywhere (the blend reports it — stage 3)
  })

  const broken: [string, (rs: any[]) => void, RegExp][] = [
    ['a preset without forms for a family curve', (rs) => rs.splice(rs.findIndex((r) => r.id === 'forms:preset:Q/curve:lowerLid'), 1), /no forms for family curve curve:lowerLid/],
    ['a shape missing an anchor', (rs) => delete rs.find((r) => r.id === 'forms:preset:P/curve:lid').original.m, /original does not list exactly the anchors/],
    ['a rule correspondence to a missing anchor', (rs) => (rs.find((r) => r.id === 'rule:eye/blink').correspondence.m = 'zz'), /curve:lowerLid#zz missing/],
    ['an unknown rule version', (rs) => (rs.find((r) => r.id === 'rule:eye/blink').version = 9), /unknown rule lidClose version 9/],
    ['a weight on a preset outside the family', (rs) => (rs.find((r) => r.id === 'character:K').weights['preset:X'] = 0.1), /preset:X is not a preset of family:eye/],
    ['a node takeover whose basisFrom is not a takeover', (rs) => (rs.find((r) => r.id === 'character:K').takeovers[1].basisFrom = 'nope'), /basisFrom nope is not a takeover/],
    ['the shared corner separating in the closed state (c2a1ce7 counterexample)', (rs) => {
      const lid = rs.find((r) => r.id === 'forms:preset:Q/curve:lid')
      lid.expr.blink = lid.expr.blink.filter((k: any) => k.yaw !== 0)
    }, /ends separate in preset:Q at blink at yaw 0 \(\(12, 0\) vs \(10, 0\)\)/],
    ['a node takeover on a connected group', (rs) => {
      rs.push({ typeName: 'connection', id: 'connection:extra', ends: [{ curveId: 'curve:lowerLid', anchorId: 'd' }, { curveId: 'curve:lid', anchorId: 'b' }], geometricJoin: 'corner' })
    }, /node takeovers on connected groups are not supported/],
  ]
  for (const [name, mutate, message] of broken)
    it(`refused on open: ${name}`, () => {
      const rs = structuredClone(sample())
      mutate(rs)
      expect(() => openRecords(rs)).toThrow(message)
    })

  it('deleting a preset forms record or a family curve is refused (the dependants are named)', () => {
    const e = openRecords(sample())
    const forms = e.apply({ type: 'deleteRecords', ids: ['forms:preset:P/curve:strand'] })
    expect(forms.ok === false && forms.error.message).toContain('preset:P')
    const curve = e.apply({ type: 'deleteRecords', ids: ['curve:strand'] })
    expect(curve.ok === false && curve.error.code).toBe('BAD_REFERENCE')
  })
})

describe('malformed archives are refused with a reason, never an internal crash', () => {
  const mutations: [string, (rs: any[]) => void][] = [
    ['a yaw key shape missing an anchor', (rs) => delete rs.find((r) => r.id === 'forms:preset:P/curve:lowerLid').yaw[1].shape.d],
    ['an author target missing an anchor', (rs) => delete rs.find((r) => r.id === 'forms:preset:P/curve:lid').expr.blink[1].target.b],
    ['a rule role naming a missing curve', (rs) => (rs.find((r) => r.id === 'rule:eye/blink').roles.lower = 'curve:nope')],
    ['a takeover on a non-family curve', (rs) => (rs.find((r) => r.id === 'character:K').takeovers[0].curveId = 'curve:C1')],
  ]
  for (const [name, mutate] of mutations)
    it(name, () => {
      const rs = structuredClone(sample())
      mutate(rs)
      let message = ''
      try {
        openRecords(rs)
      } catch (e) {
        message = String((e as Error).message)
      }
      expect(message).toMatch(/^invalid document: /)
      expect(message).not.toMatch(/Cannot read|undefined is not/)
    })
})
