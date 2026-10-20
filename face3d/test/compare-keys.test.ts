// Keys before / after the pole fix, sample by sample (dot 1792492402). Run through
// face3d/experiments/compare-keys-before-pole-fix.sh, which provides face3d/tmp-old (src at 502ddb9); skipped otherwise.
import { it } from 'vitest'
import * as N from '../src/contour'
import * as NH from '../src/head'
it.skipIf(!process.env.F3D_COMPARE_OLD)('keys before / after the pole fix: segment ends (u, y) and how far each sample moved', async () => {
  const O = await import('../tmp-old/contour'), OH = await import('../tmp-old/head')
  const nh = NH.makeHead(NH.defaultShape), oh = OH.makeHead(OH.defaultShape)
  const nt = N.keyTable(nh), ot = O.keyTable(oh)
  for (const [yaw, pitch] of [[30, 0], [30, 30], [60, 0], [60, 30], [90, 0], [90, 30]]) {
    const nk = nt.at(yaw, pitch), ok = ot.at(yaw, pitch)
    for (const side of ['pos'] as const) for (let seg = 0; seg < 2; seg++) {
      const a = ok[side][seg]!, b = nk[side][seg]!
      const d = a.samples.map((q, i) => { const p = oh.at(q.u, q.y), r = b.samples[i]!, s = nh.at(r.u, r.y); return Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) })
      const fmt = (s: typeof a) => `${s.present ? 'present' : 'ABSENT'} start u ${(s.samples[0]!.u * 57.3).toFixed(0)}° y ${s.samples[0]!.y.toFixed(3)} → end u ${(s.samples[s.samples.length - 1]!.u * 57.3).toFixed(0)}° y ${s.samples[s.samples.length - 1]!.y.toFixed(3)}`
      console.log(`key ${yaw},${pitch} ${side}${seg}\n  before: ${fmt(a)}\n  after : ${fmt(b)}\n  moved per sample (R): ${d.map(x => x.toFixed(3)).join(' ')}`)
    }
  }
})
