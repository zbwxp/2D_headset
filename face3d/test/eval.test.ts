// The three-measure evaluation (eval.ts, dot 1792493683) at the in-between views: printed per view and side; the 45,15
// fit kept as a regression; the 75,15 reference outline's own change across finer grids measured before any part of
// its ~0.05 R is put on the mix.
import { describe, expect, it } from 'vitest'
import { mixContour } from '../src/contour'
import { makeModel } from '../src/model'
import { rotate } from '../src/view'
import { type P2, evalView, nearestVisible, outlineRuns } from './eval'

const model = makeModel()
const VIEWS = [15, 45, 75].flatMap(yaw => [-38, -15, 15, 38].map(pitch => ({ yaw, pitch })))

describe('three-measure evaluation', () => {
  it('prints fit / semantic / visibility per view and side', () => {
    const rows: string[] = []
    for (const v of VIEWS) for (const s of evalView(model, v).sides) rows.push(`${v.yaw},${v.pitch} ${s.side}: fit max ${s.fit.max.toFixed(3)} R (sample #${s.fit.worst}, nearest run on the ${s.fit.runSide} side) | semantic: other-side ${s.semantic.otherSide}, uncovered ${s.semantic.uncovered.toFixed(3)} R, shared ${s.semantic.sharedWithOther.toFixed(3)} R | visibility: shown-but-hidden ${s.visibility.shownButHidden} (furthest from the visible outline ${s.visibility.shownButHiddenFar.toFixed(3)} R), hidden-but-on-outline ${s.visibility.hiddenButShownOnOutline}`)
    console.log(rows.join('\n'))
    expect(rows.length).toBe(VIEWS.length * 2)
  }, 600000)
  it('regression: at 45,15 the shown mix lies on the full visible outline (x+ side, within 0.02 R)', () => {
    const s = evalView(model, { yaw: 45, pitch: 15 }).sides.find(x => x.side === 'pos')!
    expect(s.fit.max).toBeLessThan(0.02)
  }, 600000)
  it('75,15: how much the reference outline itself moves with the grid, next to the mix samples', () => {
    const v = { yaw: 75, pitch: 15 }
    const runsBy = [{ nu: 240, ny: 160 }, { nu: 480, ny: 320 }, { nu: 960, ny: 640 }].map(g => ({ g, runs: outlineRuns(model.head, v, g) }))
    const mix = mixContour(model.head, model.table, v).find(l => l.side === 'pos')!
    const P = (p: readonly number[]): P2 => { const r = rotate(p as [number, number, number], v); return [r[0], r[1]] }
    const rows = mix.pts.slice(0, 8).map((p, i) => `  mix #${i}: to the visible outline at ${runsBy.map(r => `${r.g.nu}x${r.g.ny} ${nearestVisible(P(p), r.runs).d.toFixed(3)}`).join(', ')} R`)
    console.log(`75,15 x+ chin–jaw, the reference outline per grid:\n${rows.join('\n')}`)
    expect(rows.length).toBe(8)
  }, 900000)
})
