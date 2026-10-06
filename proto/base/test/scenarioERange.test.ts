// Scenario E applicability range: every closing rule over a family of 200 eye shapes. Prints where
// each rule holds and why it fails; asserts the facts used in docs/17; tests explicit failure of the
// selection mechanism. Standalone experiment, not a product test.
import { describe, expect, it } from 'vitest'
import { applyExpression, checkRule, closeRelationalMatched, family, makeEye, RANGE_RULES, type RuleEntry } from '../src/experiments/scenarioERange'
import { CLOSE_RULES } from '../src/experiments/scenarioE'

const fam = family()
const regular = fam.filter((f) => !f.extraUpper)
const extra = fam.filter((f) => f.extraUpper)
const geometric = ['closes', 'noCrossingWhileClosing', 'cornersJoined'] as const

describe('applicability range of closing rules over a family of eye shapes', () => {
  const table: Record<string, any> = {}
  for (const [name, stage] of Object.entries(RANGE_RULES)) {
    const res = fam.map((f) => ({ f, r: checkRule(stage, makeEye(f)) }))
    const geomOk = (x: (typeof res)[number]) => !x.r.error && geometric.every((c) => !x.r.failed.includes(c))
    const reasons: Record<string, number> = {}
    for (const x of res) for (const c of x.r.error ? ['ERROR'] : x.r.failed) reasons[c] = (reasons[c] ?? 0) + 1
    table[name] = {
      regularPass: res.filter((x) => !x.f.extraUpper && geomOk(x)).length + '/' + regular.length,
      extraUpperPass: res.filter((x) => x.f.extraUpper && geomOk(x)).length + '/' + extra.length,
      keepsOwnPosition: res.filter((x) => !x.r.error && !x.r.failed.includes('keepsOwnPosition')).length + '/' + fam.length,
      reasons,
      firstFailure: res.find((x) => !geomOk(x))?.f,
    }
  }
  it('prints the range table', () => console.log('[scenarioE range]\n' + Object.entries(table).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')))
  it('facts used in docs/17', () => {
    expect(table.relational.regularPass).toBe(`${regular.length}/${regular.length}`)
    expect(table.relational.reasons.ERROR).toBe(extra.length) // different anchor counts: crashes unless guarded
    expect(table.relationalMatched.regularPass).toBe(`${regular.length}/${regular.length}`)
    expect(table.relationalMatched.extraUpperPass).toBe(`${extra.length}/${extra.length}`)
    expect(table.generatedTarget.regularPass).toBe(`${regular.length}/${regular.length}`)
    expect(table.fixedOffset.regularPass).not.toBe(`${regular.length}/${regular.length}`)
  })
})

describe('selection: specific rule, else default; checked; explicit failure', () => {
  const isRegular = (f: { extraUpper: boolean }) => !f.extraUpper
  const defaultRelational: RuleEntry = { name: 'close (default, relational)', scope: 'default', appliesTo: isRegular, stage: CLOSE_RULES.relational, requires: [...geometric] }
  const specificMatched: RuleEntry = { name: 'close (4-anchor upper lids)', scope: 'specific', appliesTo: (f) => f.extraUpper, stage: closeRelationalMatched, requires: [...geometric] }
  const wide = { hU: -7, hL: 5, tilt: 0, shift: 0, extraUpper: false }
  const fourAnchor = { hU: -5, hL: 3, tilt: 3, shift: 0, extraUpper: true }

  it('a regular eye uses the default; a 4-anchor eye uses the specific rule', () => {
    expect(applyExpression([defaultRelational, specificMatched], wide, 1)).toMatchObject({ ok: true, used: 'close (default, relational)', scope: 'default' })
    expect(applyExpression([defaultRelational, specificMatched], fourAnchor, 1)).toMatchObject({ ok: true, used: 'close (4-anchor upper lids)', scope: 'specific' })
  })
  it('no rule in range → NO_APPLICABLE_RULE, not a wrong drawing', () => {
    expect(applyExpression([defaultRelational], fourAnchor, 1)).toMatchObject({ ok: false, code: 'NO_APPLICABLE_RULE' })
  })
  it('a rule whose declared range is too wide → RULE_CHECK_FAILED naming the rule and the check', () => {
    const overclaiming: RuleEntry = { name: 'close (fixed offsets, claims all eyes)', scope: 'default', appliesTo: () => true, stage: CLOSE_RULES.fixedOffset, requires: [...geometric] }
    expect(applyExpression([overclaiming], wide, 1)).toMatchObject({ ok: false, code: 'RULE_CHECK_FAILED', rule: 'close (fixed offsets, claims all eyes)', failed: ['closes'] })
  })
  it('a rule that cannot handle the shape → RULE_ERROR naming the rule (instead of a crash)', () => {
    const wrongRange: RuleEntry = { ...defaultRelational, name: 'close (relational, claims all eyes)', appliesTo: () => true }
    expect(applyExpression([wrongRange], fourAnchor, 1)).toMatchObject({ ok: false, code: 'RULE_ERROR', rule: 'close (relational, claims all eyes)' })
  })
})
