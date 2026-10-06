// Fine-tune transfer experiment (doc 18 §10.3d). Prints the table; asserts only properties the rule
// guarantees by construction (zero fine-tune = recording; affine side view = exact; the reconcile rule
// closes shared anchors; near-collinear curves are reported, never silently NaN). Everything else is
// REPORTED, not judged: whether the result looks right is bowen's call from the pictures.
// Units: part-local (eye corners at x = ±10, base eye height 8).
import { describe, expect, it } from 'vitest'
import {
  curveIds,
  dist,
  fineTune,
  frontEye,
  mapEye,
  MIN_SPREAD,
  reconcileShared,
  redrawn,
  sharedGap,
  sideMaps,
  transferAdditive,
  transferPerCurve,
  type Cubic,
  type Eye,
} from '../src/experiments/fineTuneTransfer'
import type { V } from '../src/experiments/scenarioE'

const bez = (c: Cubic, t: number): V => {
  const u = 1 - t
  return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y }
}
/** largest distance between two eyes, same curve and same parameter, 101 samples per curve (measured) */
const curveDev = (a: Eye, b: Eye) => Math.max(...curveIds.flatMap((id) => Array.from({ length: 101 }, (_, i) => dist(bez(a[id], i / 100), bez(b[id], i / 100)))))
const report: Record<string, unknown>[] = []

describe('fine-tune transfer (doc 18 §10.3d)', () => {
  const front = frontEye()
  const tuned = fineTune(front)

  it('no fine-tune: the result is exactly the recording, for every side view', () => {
    for (const [name, side] of [['affine', mapEye(front, sideMaps.affine)], ['warped', mapEye(front, sideMaps.warped)], ['redrawn', redrawn(mapEye(front, sideMaps.warped))]] as const) {
      const r = transferPerCurve(front, front, side).eye
      const d = curveDev(r, side)
      report.push({ check: 'zero fine-tune', side: name, deviation: d })
      expect(d).toBe(0)
    }
  })

  it('affine side view: the per-curve rule is exact; the additive rule (T1) is reported', () => {
    const side = mapEye(front, sideMaps.affine)
    const ideal = mapEye(tuned, sideMaps.affine)
    const rule = transferPerCurve(front, tuned, side)
    const t1 = transferAdditive(front, tuned, side)
    report.push({ check: 'affine', ruleVsIdeal: curveDev(rule.eye, ideal), t1VsIdeal: curveDev(t1, ideal), sharedGapRule: sharedGap(rule.eye) })
    expect(curveDev(rule.eye, ideal)).toBeLessThan(1e-9)
  })

  it('warped side view: deviation from the known ideal (same map on the fine-tuned front) — reported, not judged', () => {
    const side = mapEye(front, sideMaps.warped)
    const ideal = mapEye(tuned, sideMaps.warped)
    const rule = transferPerCurve(front, tuned, side)
    const reconciled = reconcileShared(rule.eye)
    const t1 = transferAdditive(front, tuned, side)
    report.push({
      check: 'warped',
      ruleVsIdeal: curveDev(rule.eye, ideal),
      reconciledVsIdeal: curveDev(reconciled, ideal),
      t1VsIdeal: curveDev(t1, ideal),
      sharedGapRule: sharedGap(rule.eye),
      sharedGapReconciled: sharedGap(reconciled),
      sharedGapT1: sharedGap(t1),
      perCurve: rule.perCurve,
    })
    expect(sharedGap(reconciled)).toBeLessThan(1e-12)
  })

  it('a flat (straight) lower lid: near-collinear curves borrow their neighbours, explicitly reported', () => {
    const flat: Eye = { ...front, L0: [{ x: -10, y: 0 }, { x: -6, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 0 }], L1: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 10, y: 0 }] }
    const flatTuned: Eye = { ...fineTune(flat), L0: flat.L0.map((p, i) => (i === 3 || i === 2 ? { x: p.x, y: p.y + 1 } : p)) as Cubic }
    const side = mapEye(flat, sideMaps.warped)
    const rule = transferPerCurve(flat, flatTuned, side)
    report.push({ check: 'flat lower lid', perCurve: rule.perCurve })
    expect(rule.perCurve.L0.spread).toBeLessThan(MIN_SPREAD)
    expect(rule.perCurve.L0.source).toBe('with-neighbours')
    for (const id of curveIds) for (const p of rule.eye[id]) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  })

  it('redrawn side view: no ideal exists — numbers only describe the result, pictures decide', () => {
    const side = redrawn(mapEye(front, sideMaps.warped))
    const rule = transferPerCurve(front, tuned, side)
    const t1 = transferAdditive(front, tuned, side)
    report.push({ check: 'redrawn', ruleVsT1: curveDev(rule.eye, t1), sharedGapRule: sharedGap(rule.eye), sharedGapReconciled: sharedGap(reconcileShared(rule.eye)) })
  })

  it('prints the table', () => {
    const fmt = (x: unknown): unknown => (typeof x === 'number' ? Number(x.toPrecision(4)) : Array.isArray(x) ? x.map(fmt) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fmt(y)])) : x)
    console.log('[fineTuneTransfer]\n' + report.map((r) => JSON.stringify(fmt(r))).join('\n'))
  })
})
