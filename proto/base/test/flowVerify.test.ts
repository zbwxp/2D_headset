// Flow verification (doc 18 §16). Expected values are computed INDEPENDENTLY in this file (own
// arithmetic, literal affine numbers, own least squares) — never by calling the functions under test
// (dot 1791297493). Undo / reopen are verified at the experiment data level only.
import { describe, expect, it } from 'vitest'
import { blinkRule, counters, fineTuneUp, fineTuneUpAndLower, makeDoc, playback, rebuild, Session, type Cache, type Doc } from '../src/experiments/flowVerify'
import { curveIds, type CurveId, type Cubic, type Eye } from '../src/experiments/fineTuneTransfer'
import type { V } from '../src/experiments/scenarioE'

// ---------- independent helpers (test-side) ----------
const P = (x: number, y: number): V => ({ x, y })
const each = (e: Eye, f: (p: V, id: CurveId, i: number) => V): Eye => Object.fromEntries(curveIds.map((id) => [id, e[id].map((p, i) => f(p, id, i))])) as Eye
const maxDiff = (a: Eye, b: Eye) => Math.max(...curveIds.flatMap((id) => a[id].map((p, i) => Math.hypot(p.x - b[id][i].x, p.y - b[id][i].y))))
const cacheDiff = (a: Cache, b: Cache) => Math.max(...(Object.keys(a) as (keyof Cache)[]).map((k) => maxDiff(a[k], b[k])))
const weighted = (terms: [Eye, number][]): Eye => each(terms[0][0], (_p, id, i) => terms.reduce((s, [e, w]) => P(s.x + w * e[id][i].x, s.y + w * e[id][i].y), P(0, 0)))
// literal copies of the two known affines' linear parts (independent of the module's constants)
const LA: [number, number, number, number] = [0.45, -0.08, 0.15, 0.95]
const LB: [number, number, number, number] = [0.35, 0.05, 0.1, 1.05]
const lin = (m: number[], p: V) => P(m[0] * p.x + m[2] * p.y, m[1] * p.x + m[3] * p.y)
/** own least-squares linear fit (normal equations via explicit 2x2 inverse), centred */
function lsqLinear(src: V[], dst: V[]) {
  const n = src.length
  const cs = src.reduce((s, p) => P(s.x + p.x / n, s.y + p.y / n), P(0, 0))
  const cd = dst.reduce((s, p) => P(s.x + p.x / n, s.y + p.y / n), P(0, 0))
  let sxx = 0, sxy = 0, syy = 0, ux = 0, uy = 0, vx = 0, vy = 0
  src.forEach((p, k) => {
    const a = p.x - cs.x, b = p.y - cs.y, u = dst[k].x - cd.x, w = dst[k].y - cd.y
    sxx += a * a; sxy += a * b; syy += b * b; ux += u * a; uy += u * b; vx += w * a; vy += w * b
  })
  const det = sxx * syy - sxy * sxy
  const inv = [syy / det, -sxy / det, -sxy / det, sxx / det] // [[i0 i1][i2 i3]]
  // M = [[ux uy][vx vy]] · inv
  return { a: ux * inv[0] + uy * inv[2], c: ux * inv[1] + uy * inv[3], b: vx * inv[0] + vy * inv[2], d: vx * inv[1] + vy * inv[3] }
}
const closureGap = (e: Eye) => Math.max(...(['0', '1'] as const).flatMap((k) => e[`U${k}`].map((p, i) => Math.hypot(p.x - e[`L${k}`][i].x, p.y - e[`L${k}`][i].y))))
const report: Record<string, unknown>[] = []

describe('flow verification (doc 18 §16)', () => {
  const s = new Session(makeDoc())
  const original = structuredClone(s.doc)
  const untouchedBefore = rebuild(s.doc, 'untouched')
  const history: { label: string; doc: Doc; cache: Cache }[] = []
  const snap = (label: string) => history.push({ label, doc: structuredClone(s.doc), cache: rebuild(s.doc, 'c1') })

  it('1. zero fine-tune, no fixes: every open key state equals Σ w K exactly', () => {
    const c = rebuild(s.doc, 'c1')
    const A = original.presets.A.keys, B = original.presets.B.keys
    for (const st of ['0|open', '90|open'] as const) {
      const want = weighted([[A[st]!, 0.5], [B[st]!, 0.5]])
      report.push({ step: 1, state: st, diff: maxDiff(c[st], want) })
      expect(maxDiff(c[st], want)).toBeLessThan(1e-12)
    }
    snap('start')
  })

  it('2. fine-tune f: 90° = Σ w (K + M f); closed states close', () => {
    const f = fineTuneUp(1.2)
    s.setFineTune('c1', f)
    const c = rebuild(s.doc, 'c1')
    const A = original.presets.A.keys, B = original.presets.B.keys
    const want = weighted([[each(A['90|open']!, (p, id, i) => { const q = lin(LA, f[id][i]); return P(p.x + q.x, p.y + q.y) }), 0.5], [each(B['90|open']!, (p, id, i) => { const q = lin(LB, f[id][i]); return P(p.x + q.x, p.y + q.y) }), 0.5]])
    report.push({ step: 2, diff90: maxDiff(c['90|open'], want), closure0: closureGap(c['0|closed']), closure90: closureGap(c['90|closed']) })
    expect(maxDiff(c['90|open'], want)).toBeLessThan(1e-12)
    expect(closureGap(c['90|closed'])).toBeLessThan(1e-12)
    snap('fine-tune')
  })

  let takeoverTarget: Cubic
  it('3. angle hand fix at 90° (upper lid, right segment): reproduces the accepted result', () => {
    const before = rebuild(s.doc, 'c1')['90|open'].U1
    takeoverTarget = before.map((p, i) => (i === 1 || i === 2 ? P(p.x + 0.4, p.y - 0.5) : p)) as Cubic // interior handles only
    s.fixAngle('c1', 'U1', takeoverTarget)
    const c = rebuild(s.doc, 'c1')
    const d = Math.max(...c['90|open'].U1.map((p, i) => Math.hypot(p.x - takeoverTarget[i].x, p.y - takeoverTarget[i].y)))
    report.push({ step: 3, reproduce: d })
    expect(d).toBeLessThan(1e-12)
    snap('angle fix')
  })

  it('4. change fine-tune AND weights: the takeover moves by L_fixed · (front now − front at takeover); joint gap reported', () => {
    const t = s.doc.characters.c1.takeovers[0]
    s.setFineTune('c1', fineTuneUp(2.0))
    s.setWeights('c1', { A: 0.7, B: 0.3 })
    const c = rebuild(s.doc, 'c1')
    const M = lsqLinear(t.basisFront, t.target)
    const want = t.target.map((q, i) => {
      const dx = c['0|open'].U1[i].x - t.basisFront[i].x, dy = c['0|open'].U1[i].y - t.basisFront[i].y
      return P(q.x + M.a * dx + M.c * dy, q.y + M.b * dx + M.d * dy)
    })
    const d = Math.max(...c['90|open'].U1.map((p, i) => Math.hypot(p.x - want[i].x, p.y - want[i].y)))
    const jointMid = Math.hypot(c['90|open'].U0[3].x - c['90|open'].U1[0].x, c['90|open'].U0[3].y - c['90|open'].U1[0].y)
    const jointCorner = Math.hypot(c['90|open'].U1[3].x - c['90|open'].L1[3].x, c['90|open'].U1[3].y - c['90|open'].L1[3].y)
    report.push({ step: 4, vsIndependent: d, jointGapMiddle: jointMid, jointGapCorner: jointCorner })
    expect(d).toBeLessThan(1e-9)
    snap('fine-tune 2 + weights')
  })

  let exprTarget: Eye
  it('5. expression hand fix at 0° closed (A has an author target there): character first, reproduces its own target', () => {
    const now = rebuild(s.doc, 'c1')['0|closed']
    // eye tail of BOTH lids moved together, so the closed relation holds by construction
    exprTarget = { ...now, U1: now.U1.map((p, i) => (i >= 2 ? P(p.x + 0.3, p.y - 0.9) : p)) as Cubic, L1: now.L1.map((p, i) => (i >= 2 ? P(p.x + 0.3, p.y - 0.9) : p)) as Cubic }
    s.fixExpression('c1', 0, exprTarget)
    const c = rebuild(s.doc, 'c1')
    // A's own correction at this state (independent): its author target − its open eye with the upper lid on the lower
    const aOpen = original.presets.A.keys['0|open']!
    const aCorr = maxDiff(original.presets.A.keys['0|closed']!, { ...aOpen, U0: aOpen.L0, U1: aOpen.L1 })
    report.push({ step: 5, reproduce: maxDiff(c['0|closed'], exprTarget), closure: closureGap(c['0|closed']), presetACorrectionThatMustNotBeAdded: aCorr })
    expect(aCorr).toBeGreaterThan(0.1) // so 'not adding it' is a real check
    expect(maxDiff(c['0|closed'], exprTarget)).toBeLessThan(1e-12) // not target + A's correction
    snap('expression fix')
  })

  it('6. change fine-tune again: rule re-closes, then the character correction; still closed; tail fix kept', () => {
    const fix = s.doc.characters.c1.exprFixes[0]
    s.setFineTune('c1', fineTuneUpAndLower(0.5, 0.7)) // also moves the lower lid, so the closed base really changes
    const c = rebuild(s.doc, 'c1')
    // independent expectation: new open front → close (copy lower onto upper) → + (target − base at fix time)
    const open0 = c['0|open']
    const newBase: Eye = { ...open0, U0: open0.L0, U1: open0.L1 }
    const want = each(newBase, (p, id, i) => P(p.x + fix.target[id][i].x - fix.base[id][i].x, p.y + fix.target[id][i].y - fix.base[id][i].y))
    const baseMoved = maxDiff(newBase, fix.base)
    report.push({ step: 6, vsIndependent: maxDiff(c['0|closed'], want), closure: closureGap(c['0|closed']), baseMovedBy: baseMoved })
    expect(baseMoved).toBeGreaterThan(0.1) // the same-state base really changed, so 'new base + correction' is exercised
    expect(maxDiff(c['0|closed'], want)).toBeLessThan(1e-12)
    expect(closureGap(c['0|closed'])).toBeLessThan(1e-12)
    snap('fine-tune 3')
  })

  it('7. undo 6, 5, 4 (two edits), 3 and redo: data and rebuild return exactly', () => {
    const undoTo = (label: string, steps: number) => {
      for (let k = 0; k < steps; k++) expect(s.undo()).toBe(true)
      const h = history.find((x) => x.label === label)!
      expect(JSON.stringify(s.doc)).toBe(JSON.stringify(h.doc))
      expect(cacheDiff(rebuild(s.doc, 'c1'), h.cache)).toBe(0)
    }
    undoTo('expression fix', 1)
    undoTo('fine-tune 2 + weights', 1)
    undoTo('angle fix', 2) // step 4 was two edits
    undoTo('fine-tune', 1)
    for (let k = 0; k < 5; k++) expect(s.redo()).toBe(true)
    const last = history.find((x) => x.label === 'fine-tune 3')!
    expect(JSON.stringify(s.doc)).toBe(JSON.stringify(last.doc))
    report.push({ step: 7, undoRedo: 'exact' })
  })

  it('8. save → reopen (no cache saved): the rebuild equals the result at save time', () => {
    const atSave = rebuild(s.doc, 'c1')
    const reopened = Session.reopen(s.save())
    const d = cacheDiff(rebuild(reopened.doc, 'c1'), atSave)
    report.push({ step: 8, diff: d })
    expect(d).toBe(0)
  })

  it('9. playback reads and interpolates only: data unchanged, no rule runs, no domain reads', () => {
    const cache = rebuild(s.doc, 'c1')
    const docBefore = JSON.stringify(s.doc)
    counters.ruleRuns = 0
    counters.domainReads = 0
    const e = playback(cache, 45, 0.5)
    // independent: bilinear mix of the four key states
    const want = each(cache['0|open'], (_p, id, i) => {
      const m = (st: keyof Cache) => cache[st][id][i]
      const o = P((m('0|open').x + m('90|open').x) / 2, (m('0|open').y + m('90|open').y) / 2)
      const c = P((m('0|closed').x + m('90|closed').x) / 2, (m('0|closed').y + m('90|closed').y) / 2)
      return P((o.x + c.x) / 2, (o.y + c.y) / 2)
    })
    report.push({ step: 9, diff: maxDiff(e, want), ruleRuns: counters.ruleRuns, domainReads: counters.domainReads })
    expect(maxDiff(e, want)).toBeLessThan(1e-12)
    expect(JSON.stringify(s.doc)).toBe(docBefore)
    expect(counters.ruleRuns).toBe(0)
    expect(counters.domainReads).toBe(0)
  })

  it('10. ten rebuilds with no input change are identical', () => {
    const first = rebuild(s.doc, 'c1')
    for (let k = 0; k < 10; k++) expect(cacheDiff(rebuild(s.doc, 'c1'), first)).toBe(0)
    report.push({ step: 10, drift: 0 })
  })

  it('11. the untouched character and the shared presets are unchanged by all of this', () => {
    expect(JSON.stringify(s.doc.presets)).toBe(JSON.stringify(original.presets))
    expect(JSON.stringify(s.doc.basis)).toBe(JSON.stringify(original.basis))
    expect(cacheDiff(rebuild(s.doc, 'untouched'), untouchedBefore)).toBe(0)
    report.push({ step: 11, presetsUnchanged: true, untouchedUnchanged: true })
  })

  it('sanity: the blink rule closes by construction (it copies the lower lid onto the upper)', () => {
    expect(closureGap(blinkRule(makeDoc().presets.A.keys['0|open']!))).toBe(0)
  })

  it('prints the table', () => {
    const fmt = (x: unknown): unknown => (typeof x === 'number' ? Number(x.toPrecision(4)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fmt(y)])) : x)
    console.log('[flowVerify]\n' + report.map((r) => JSON.stringify(fmt(r))).join('\n'))
  })
})
