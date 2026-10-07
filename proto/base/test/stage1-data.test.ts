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
// the stage-1 sample files are in the format BEFORE §29 I-1 (rule + rule/author expression keys): opened as that
// version, they go through the schema-3 conversion (contour.document/2) like any old file
const BEFORE_I1 = { schemaVersion: 2, sequences: { 'contour.document': 1 } }
const archive = (records: DocRecord[]) => ({ store: Object.fromEntries(records.map((r) => [r.id, r])), schema: BEFORE_I1 })
/** an archive already in the current format (built by saving an opened sample) */
const current = (e: Editor) => JSON.parse(JSON.stringify(e.save()))
const sample = (): DocRecord[] => json('stage1-valid.json').records
const openRecords = (records: DocRecord[]) => Editor.open(archive(records) as any)
/** the sample in the CURRENT format (converted once), for checks that are about the current records */
const currentRecords = (): any[] => Object.values(current(openRecords(sample())).store)
const openCurrent = (rs: any[]) => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: schema.serialize() } as any)

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
    expect(saved.schema.sequences['contour.document']).toBe(2) // schema 3: the expression conversion (§29 I-1) is the newest step
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
    // converted by the old evaluation: at the author key whose base is unchanged since capture, that is its target
    const old = (sample().find((r: any) => r.id === 'forms:preset:P/curve:lid') as any).expr.blink.find((k: any) => k.yaw === 0)
    expect(presetExpr(lidP, 'blink', 0)).toEqual(old.target)
    expect((lidP.expr.blink as any[]).every((k) => k.shape && !('kind' in k))).toBe(true)
    const bad = openRecords(json('stage1-invalid-missing.json').records)
    const qStrand = bad.reader.get(presetFormsIdOf('preset:Q', 'curve:strand') as any) as FormsRecord
    expect(presetNeutral(qStrand)).toBeNull()
    expect(presetNeutral(qStrand, 90)).toBeNull() // identity only: missing everywhere (the blend reports it — stage 3)
  })

  const broken: [string, (rs: any[]) => void, RegExp][] = [
    ['a preset without forms for a family curve', (rs) => rs.splice(rs.findIndex((r) => r.id === 'forms:preset:Q/curve:lowerLid'), 1), /no forms for family curve curve:lowerLid/],
    ['a shape missing an anchor', (rs) => delete rs.find((r) => r.id === 'forms:preset:P/curve:lid').original.m, /original does not list exactly the anchors/],
    ['a weight on a preset outside the family', (rs) => (rs.find((r) => r.id === 'character:K').weights['preset:X'] = 0.1), /preset:X is not a preset of family:eye/],
    ['a node takeover whose basisFrom is empty', (rs) => (rs.find((r) => r.id === 'character:K').takeovers[1].basisFrom = ''), /basisFrom  is not a takeover/], // review of 819dd22: a string names the source line (possibly cleared since): provenance only
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
      const rs = currentRecords()
      mutate(rs)
      expect(() => openCurrent(rs)).toThrow(message)
    })
  // old files whose expressions cannot be converted by the old evaluation: refused, with the conversion's reason
  const unconvertible: [string, (rs: any[]) => void, RegExp][] = [
    ['an old rule correspondence to a missing anchor', (rs) => (rs.find((r) => r.id === 'rule:eye/blink').correspondence.m = 'zz'), /invalid document: migration: rule:eye\/blink correspondence names zz, missing in its source/],
    ['an unknown old rule version', (rs) => (rs.find((r) => r.id === 'rule:eye/blink').version = 9), /invalid document: migration: unknown rule lidClose version 9/],
  ]
  for (const [name, mutate, message] of unconvertible)
    it(`old file refused: ${name}`, () => {
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
    ['an expression keyframe missing an anchor', (rs) => delete rs.find((r) => r.id === 'forms:preset:P/curve:lid').expr.blink[1].shape.b],
    ['a parameter naming a missing curve', (rs) => rs.find((r) => r.id === 'expressionParam:eye/blink').curves.push('curve:nope')],
    ['a takeover on a non-family curve', (rs) => (rs.find((r) => r.id === 'character:K').takeovers[0].curveId = 'curve:C1')],
    ['(old file) a rule role naming a missing curve', (rs) => (rs.find((r) => r.id === 'rule:eye/blink').roles.lower = 'curve:nope')],
  ]
  for (const [name, mutate] of mutations)
    it(name, () => {
      const old = name.startsWith('(old file)')
      const rs = old ? structuredClone(sample()) : currentRecords()
      mutate(rs)
      let message = ''
      try {
        if (old) openRecords(rs)
        else openCurrent(rs)
      } catch (e) {
        message = String((e as Error).message)
      }
      expect(message).toMatch(/^invalid document: /)
      expect(message).not.toMatch(/Cannot read|undefined is not/)
    })
})

describe('nothing the write entry commits is refused on reopen (dot 1791308648)', () => {
  it('deleting the expression parameter is refused at the write entry (its forms still need it)', () => {
    const e = openRecords(sample())
    const r = e.apply({ type: 'deleteRecords', ids: ['expressionParam:eye/blink'] })
    expect(r.ok === false && r.error.message).toContain('no expression parameter blink in family:eye')
  })

  it('every single-record deletion of the sample is either refused or leaves a document that reopens', () => {
    const recs = sample()
    const outcomes: Record<string, string> = {}
    for (const rec of recs) {
      const e = openRecords(recs)
      const r = e.apply({ type: 'deleteRecords', ids: [rec.id] })
      if (!r.ok) {
        outcomes[rec.id] = r.error.code
        continue
      }
      expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
      outcomes[rec.id] = 'deleted, reopens'
    }
    expect(Object.values(outcomes).filter((o) => o === 'deleted, reopens').length).toBeGreaterThan(0)
    console.log('[stage1 deletions]', JSON.stringify(outcomes))
  })

  it('every PAIR of record deletions is either refused or reopens (300 pairs)', () => {
    const recs = sample()
    let committed = 0
    for (let i = 0; i < recs.length; i++)
      for (let j = i + 1; j < recs.length; j++) {
        const e = openRecords(recs)
        const r = e.apply({ type: 'deleteRecords', ids: [recs[i].id, recs[j].id] })
        if (!r.ok) continue
        committed++
        expect(() => Editor.open(JSON.parse(JSON.stringify(e.save()))), `${recs[i].id} + ${recs[j].id}`).not.toThrow()
      }
    expect(committed).toBeGreaterThan(0)
  })

  it('existing edits on the sample (drag an anchor, move a container, legacy pose key) reopen', () => {
    const e = openRecords(sample())
    for (const cmd of [
      { type: 'moveAnchors', targets: [{ curveId: 'curve:lid', anchorId: 'm' }], delta: { x: 1, y: 2 } },
      { type: 'transformContainer', containerId: 'container:L1', matrix: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 } },
      { type: 'setPoseKey', curveId: 'curve:C1', yaw: 10, offsets: { a1: { x: 1, y: 0 } } },
    ] as const) {
      const r = e.apply(cmd as any)
      expect(r.ok, JSON.stringify(r)).toBe(true)
      expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
    }
  })
})

describe('review of 2c92206 (dot): uniqueness, closure, required fields, wrong roles, migration collisions, new-mode overrides', () => {
  const err = (fn: () => unknown) => {
    try {
      fn()
      return ''
    } catch (e) {
      return String((e as Error).message)
    }
  }
  it('two expression parameters with the same name in one family are refused on open', () => {
    const snap = current(openRecords(sample()))
    snap.store['expressionParam:z-alternate'] = { ...snap.store['expressionParam:eye/blink'], id: 'expressionParam:z-alternate' }
    expect(err(() => Editor.open(snap))).toMatch(/is also defined by expressionParam:z-alternate: one parameter per family name/)
  })

  it('removing the parameter re-checks what depends on it (closure reaches the forms)', () => {
    const e = openRecords(sample())
    const r = e.apply({ type: 'deleteRecords', ids: ['expressionParam:eye/blink'] })
    expect(r.ok === false && r.error.objects).toContain('forms:preset:P/curve:lid')
  })

  it('a migration never overwrites: an old pose whose target forms id already exists refuses the file', () => {
    const old = legacySnapshot()
    old.store['forms:document/curve:E1'] = { typeName: 'forms', id: 'forms:document/curve:E1', curveId: 'curve:E1', owner: { kind: 'document' }, encoding: 'legacy-delta', original: 'curve', yaw: [], expr: {} }
    expect(err(() => Editor.open(old))).toMatch(/would become forms:document\/curve:E1, which already exists/)
  })

  const missing: [string, string, (r: any) => void, RegExp][] = [
    ['absolute forms without expr', 'forms:preset:P/curve:lowerLid', (r) => delete r.expr, /expr \(required/],
    ['visibility without owner', 'visibility:preset:P/curve:strand', (r) => delete r.owner, /visibility .* owner/],
    ['helper domain without source', 'helperDomain:P/90', (r) => delete r.source, /source \/ target yaw/],
    ['character without weights', 'character:K', (r) => delete r.weights, /weights \/ fineTune \/ takeovers \/ exprFixes/],
    ['family with a duplicate curve', 'family:eye', (r) => r.curves.push('curve:lid'), /unique curve ids/],
  ]
  for (const [name, id, mutate, message] of missing)
    it(`required fields are validated, not crashed on: ${name}`, () => {
      const rs = currentRecords()
      mutate(rs.find((r: any) => r.id === id))
      const m = err(() => openCurrent(rs))
      expect(m).toMatch(message)
      expect(m).not.toMatch(/Cannot read|Cannot convert|undefined is not/)
    })

  it('an expression parameter with a non-string curve id is refused (required fields)', () => {
    const snap = current(openRecords(sample()))
    snap.store['expressionParam:eye/blink'].curves.push(3)
    const m = err(() => Editor.open(snap))
    expect(m).toMatch(/expressionParam .* curves/)
    expect(m).not.toMatch(/Cannot read|undefined is not/)
  })

  it('an expression track on a curve the parameter does not name is refused (never guessed from the keys)', () => {
    const snap = current(openRecords(sample()))
    const strand = snap.store['forms:preset:P/curve:strand']
    strand.expr.blink = [{ yaw: 90, shape: strand.yaw[0].shape }]
    expect(err(() => Editor.open(snap))).toMatch(/curve:strand has a blink track but expressionParam:eye\/blink does not act on it/)
  })

  it('a reference override on a preset-form (family) curve is refused at the write entry; legacy overrides still work', () => {
    const rs = structuredClone(sample())
    const r1: any = rs.find((r: any) => r.id === 'reference:R1')
    Object.assign(r1, { sourceId: 'container:L1', parentId: 'container:L3', overrides: {} })
    const e = openRecords(rs)
    const before = JSON.stringify(e.reader.allRecords())
    const r = e.apply({ type: 'moveOverride', referenceId: 'reference:R1' as any, target: { curveId: 'curve:lid' as any, anchorId: 'm' }, delta: { x: 3, y: 2 } })
    expect(r.ok === false && r.error.message).toMatch(/reference overrides on preset-form curves are not supported/)
    expect(JSON.stringify(e.reader.allRecords())).toBe(before)
    const legacy = openRecords(sample())
    expect(legacy.apply({ type: 'moveOverride', referenceId: 'reference:R1' as any, target: { curveId: 'curve:C1' as any, anchorId: 'a1' }, delta: { x: 1, y: 0 } }).ok).toBe(true)
  })
})

describe('review of 72438b8 (dot): null inside existing fields is a named refusal, never a TypeError', () => {
  const cases: [string, (rs: any[]) => void, RegExp][] = [
    ['a yaw key that is null', (rs) => (rs.find((r) => r.id === 'forms:preset:P/curve:lid').yaw = [null]), /forms:preset:P\/curve:lid key 0 is not an object/],
    ['an expression key that is null', (rs) => (rs.find((r) => r.id === 'forms:preset:P/curve:lid').expr.blink = [null]), /expr blink key 0 is not an object/],
    ['legacy offsets that are null', (rs) => (rs.find((r) => r.id === 'forms:document/curve:C1').yaw = [{ yaw: 0, offsets: null }]), /offsets at 0 \(an object/],
    ['a fine-tune delta that is null', (rs) => (rs.find((r) => r.id === 'character:K').fineTune['curve:lid'].m = null), /fineTune curve:lid#m/],
    ['a visibility key that is null', (rs) => (rs.find((r) => r.id === 'visibility:preset:P/curve:strand').keys = [null]), /visibility .* key 0 is not an object/],
  ]
  for (const [name, mutate, message] of cases)
    it(name, () => {
      const rs = currentRecords()
      mutate(rs)
      let m = ''
      try {
        openCurrent(rs)
      } catch (e) {
        m = String((e as Error).message)
      }
      expect(m).toMatch(/^invalid document: /)
      expect(m).toMatch(message)
      expect(m).not.toMatch(/TypeError|Cannot read|Cannot convert/)
    })
})
