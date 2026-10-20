// The local experiment (dot 1792493982): depth occlusion at the current view gates drawing; vis stays the opacity.
// Only 45,15 and 75,15; the mix is unchanged. Before / after gating: drawn length, drawn-but-hidden length, the drawn
// lines' largest distance from the visible outline, visible outline covered and the gap gating would open. Plus the
// reference study with the candidate grid and the occlusion grid refined separately (values unrounded).
import { describe, expect, it } from 'vitest'
import { mixContour } from '../src/contour'
import { makeModel } from '../src/model'
import { rotate } from '../src/view'
import { type P2, gateReport, nearestVisible, outlineRuns } from './eval'

const model = makeModel()
describe('depth gating at 45,15 and 75,15', () => {
  for (const v of [{ yaw: 45, pitch: 15 }, { yaw: 75, pitch: 15 }]) for (const rule of ['depth', 'depth-far'] as const) it(`${v.yaw},${v.pitch}, rule ${rule}`, () => {
    const rep = gateReport(model, v, undefined, rule)
    for (const r of rep) console.log(`${v.yaw},${v.pitch} ${rule} ${r.side}: drawn ${r.drawn.len.toFixed(4)} R (hidden ${r.drawn.hiddenLen.toFixed(4)}, of which > NEAR from the visible outline ${r.drawn.hiddenFarLen.toFixed(4)}), max off visible ${r.drawn.maxOffVisible.toFixed(4)} | gated ${r.gated.len.toFixed(4)} R (hidden ${r.gated.hiddenLen.toFixed(4)}, far ${r.gated.hiddenFarLen.toFixed(4)}), max off visible ${r.gated.maxOffVisible.toFixed(4)} | visible outline covered ${r.coveredBefore.toFixed(4)} → ${r.coveredAfter.toFixed(4)} (gap ${r.gapFromGating.toFixed(4)})`)
    const x = rep.find(r => r.side === 'pos')!
    expect(x.drawn.len).toBeGreaterThan(0) // the regression cannot pass on an empty drawing
    expect(x.gated.len).toBeGreaterThan(0)
    expect(x.gated.hiddenFarLen).toBe(0)
  }, 600000)
  it('75,15 reference: candidate grid and occlusion grid refined separately, unrounded distances to the mix samples', () => {
    const v = { yaw: 75, pitch: 15 }, mix = mixContour(model.head, model.table, v).find(l => l.side === 'pos')!
    const P = (p: readonly number[]): P2 => { const r = rotate(p as [number, number, number], v); return [r[0], r[1]] }
    const combos = [[{ nu: 240, ny: 160 }, { nu: 360, ny: 240 }], [{ nu: 960, ny: 640 }, { nu: 360, ny: 240 }], [{ nu: 240, ny: 160 }, { nu: 1080, ny: 720 }], [{ nu: 960, ny: 640 }, { nu: 1080, ny: 720 }]] as const
    const lines = combos.map(([g, og]) => { const runs = outlineRuns(model.head, v, g, og); return `outline ${g.nu}x${g.ny}, occlusion ${og.nu}x${og.ny}: ${mix.pts.slice(0, 8).map(p => nearestVisible(P(p), runs).d).join(' ')}` })
    console.log(lines.join('\n'))
    expect(lines.length).toBe(4)
  }, 1800000)
})
