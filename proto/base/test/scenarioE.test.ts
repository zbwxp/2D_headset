// Scenario E comparison (docs 16 §2, 17). Prints the comparison tables; asserts only the facts the
// tables are used for. Not a product test: it informs what the base must carry.
import { describe, expect, it } from 'vitest'
import { CLOSE_RULES, CHARACTERS, customise, customiseThenTurnT1, defaultData, evaluateEye, measure, SURPRISE_RULES, turnAffine, turnT2, type Stage } from '../src/experiments/scenarioE'

const chars = Object.keys(CHARACTERS)
const P = (angle: number, close = 0, surprise = 0) => ({ angle, close, surprise })
const data = defaultData()

const pipelines = (close: Stage): Record<string, Stage[]> => ({
  'O1 customise→turn(T2)→close': [customise, turnT2, close],
  'O2 customise→close→turn(T2)': [customise, close, turnT2],
  'O1 turn(T1)→close': [customiseThenTurnT1, close],
})

describe('scenario E — closing rules on complete lids', () => {
  const rows: Record<string, unknown>[] = []
  for (const [rule, stage] of Object.entries(CLOSE_RULES))
    for (const [order, pipe] of Object.entries(pipelines(stage)))
      for (const angle of [0, 30])
        for (const ch of chars) {
          const full = measure(evaluateEye(ch, P(angle, 1), pipe, data).eye)
          const half = measure(evaluateEye(ch, P(angle, 0.5), pipe, data).eye)
          rows.push({ rule, order, angle, ch, ...full, halfArea: half.area, halfCrossings: half.crossings })
        }
  it('prints the table', () => {
    console.log('[scenarioE close]\n' + rows.map((r) => JSON.stringify(r)).join('\n'))
  })
  const pick = (rule: string, order: string, angle: number, ch: string) => rows.find((r) => r.rule === rule && r.order === order && r.angle === angle && r.ch === ch) as any
  it('a two-point check is not enough: the midpoint-only rule closes the middle but not the whole lid', () => {
    const r = pick('midpointOnly', 'O1 customise→turn(T2)→close', 0, 'base')
    expect(r.midGap).toBeLessThan(1e-9)
    expect(r.maxGap).toBeGreaterThan(0.5)
  })
  it('fixed offsets authored on the part close the part only', () => {
    expect(pick('fixedOffset', 'O1 customise→turn(T2)→close', 0, 'base').maxGap).toBeLessThan(0.01)
    expect(pick('fixedOffset', 'O1 customise→turn(T2)→close', 0, 'wide').area).toBeGreaterThan(1) // still open
    const narrow = pick('fixedOffset', 'O1 customise→turn(T2)→close', 0, 'narrow')
    expect(narrow.area < -1 || narrow.crossings > 0).toBe(true) // lids pass through each other
  })
  it('rules that read the current shape or character data close every character, at 0° and 30°, in both orders (T2)', () => {
    for (const rule of ['relational', 'generatedTarget', 'presetTarget'])
      for (const order of ['O1 customise→turn(T2)→close', 'O2 customise→close→turn(T2)'])
        for (const angle of [0, 30])
          for (const ch of chars) {
            const r = pick(rule, order, angle, ch)
            expect(r.maxGap, `${rule} ${order} ${angle} ${ch}`).toBeLessThan(0.01)
            expect(r.cornersJoined).toBe(true)
            expect(r.halfCrossings).toBe(0)
          }
  })
  it('every closing rule that closes leaves two coincident strokes (failure condition: needs a line switch or merge rule)', () => {
    for (const rule of ['relational', 'generatedTarget', 'presetTarget']) expect(pick(rule, 'O1 customise→turn(T2)→close', 0, 'wide').strokeOverlap).toBe(1)
  })
})

describe('scenario E — surprise rules (aesthetics: shown, not chosen)', () => {
  it('prints eye heights per character', () => {
    const out: Record<string, Record<string, number>> = {}
    for (const [rule, stage] of Object.entries(SURPRISE_RULES)) {
      out[rule] = {}
      for (const ch of chars) {
        const e = evaluateEye(ch, P(0, 0, 1), [customise, stage], data).eye
        out[rule][ch] = +(e.lower[1].p.y - e.upper[1].p.y).toFixed(2)
      }
    }
    console.log('[scenarioE surprise heights]', JSON.stringify(out))
    expect(out.presetShape.wide).toBe(out.presetShape.narrow) // preset: differences disappear
    expect(out.proportional.wide / out.proportional.narrow).toBeCloseTo(11 / 5, 5) // ratio kept
  })
  it('combination order matters: close after surprise stays closed; a fixed-amount surprise after close reopens', () => {
    const closeLast = measure(evaluateEye('wide', P(0, 1, 1), [customise, SURPRISE_RULES.fixedAmount, CLOSE_RULES.relational], data).eye)
    const surpriseLast = measure(evaluateEye('wide', P(0, 1, 1), [customise, CLOSE_RULES.relational, SURPRISE_RULES.fixedAmount], data).eye)
    console.log('[scenarioE combo wide]', JSON.stringify({ closeLast, surpriseLast }))
    expect(closeLast.maxGap).toBeLessThan(0.01)
    expect(surpriseLast.maxGap).toBeGreaterThan(1)
  })
})

describe('scenario E — ownership and the turn', () => {
  it('a character reads only its own data; changing another character does not change it', () => {
    const pipe = [customise, turnT2, CLOSE_RULES.relational]
    const run = evaluateEye('narrow', P(30, 0.5), pipe, data)
    expect(run.reads.filter((k) => k.startsWith('character:'))).toEqual(['character:narrow'])
    const changed = { ...data, 'character:wide': { upperMid: { x: 0, y: -5 }, lowerMid: { x: 0, y: 3 } } }
    expect(evaluateEye('narrow', P(30, 0.5), pipe, changed).eye).toEqual(run.eye)
    // declared reads match actual reads
    for (const s of pipe) for (const k of s.reads('narrow').filter((k) => k.startsWith('character:'))) expect(run.reads).toContain(k)
  })
  it('after a tilted 30° turn the customisation is present; T1 and T2 carry it differently', () => {
    const at = (ch: string, pipe: Stage[]) => evaluateEye(ch, P(30), pipe, data).eye.upper[1].p
    const dT1 = { x: at('wide', [customiseThenTurnT1]).x - at('base', [customiseThenTurnT1]).x, y: at('wide', [customiseThenTurnT1]).y - at('base', [customiseThenTurnT1]).y }
    const dT2 = { x: at('wide', [customise, turnT2]).x - at('base', [customise, turnT2]).x, y: at('wide', [customise, turnT2]).y - at('base', [customise, turnT2]).y }
    const expectedT2 = turnAffine(30).linear({ x: 0, y: -2 })
    console.log('[scenarioE turn carry]', JSON.stringify({ T1: dT1, T2: dT2 }))
    expect(dT1.x).toBeCloseTo(0, 9) // stays vertical though the eye is tilted
    expect(dT1.y).toBeCloseTo(-2, 9)
    expect(dT2.x).toBeCloseTo(expectedT2.x, 9)
    expect(dT2.y).toBeCloseTo(expectedT2.y, 9) // rotated with the tilt
  })
})
