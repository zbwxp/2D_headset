// Local candidate, 45,15 only (dot 1792495126): one arc-length correspondence, a WHOLE-SEGMENT geometric trial — the
// four keys share no clear internal semantic marker, so none is added (the level keys' paths end at the chin pole, the
// pitch-30 keys' under the chin on the jaw–neck line: not the same point, so the correspondence is not established).
//   each key 30,0 / 30,30 / 60,0 / 60,30: its x+ jawline path (jawpath.ts: its own jaw point, along its loop, to the
//   first x = 0) is fixed, ordered chin → jaw, and resampled at 13 equal fractions of its 3D arc length;
//   new mix: per sample, the keys' (u, y) mixed with the view's weights (u unwrapped as in mixContour), the point taken
//   on the head; visibility attached last, by the depth test at the view (each edge split in 8, in (u, y));
//   old mix: mixContour's x+ chin–jaw samples 0 … 12, drawn edge by edge with opacity min(vis) (shown ≥ 0.5);
//   target: the view's own x+ jawline path, its visible intervals.
// Reported per view (45,15 and yaw / pitch ± 1°), on screen: both-way point-to-segment distance between the shown mix
// and the target's visible path, visible coverage (within 0.02 R), the longest uncovered stretch, and path switching
// (shown mix points off the target but on another visible outline; points past the mid plane). Prints and draws
// (F3D_DIAG=1, F3D_DIAG_DIR). Nothing is wired into the model.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { mixContour, weights } from '../src/contour'
import { makeModel } from '../src/model'
import { hiddenOn, occluder } from '../src/outline'
import { toCamera } from '../src/view'
import { type V3, type View, len, rotate, sub } from '../src/view'
import { type P2, type Run, outlineRuns } from './eval'
import { type JawPath, jawOf, jawPath } from './jawpath'

const N = 13, NEAR = 0.02, SIDE_X = 0.02, SPLIT = 8
const m = makeModel(), head = m.head
const KEYS = [{ yaw: 30, pitch: 0 }, { yaw: 30, pitch: 30 }, { yaw: 60, pitch: 0 }, { yaw: 60, pitch: 30 }]
const P = (v: View) => (p: V3): P2 => { const r = rotate(p, v); return [r[0], r[1]] }
const segDist = (p: P2, a: P2, b: P2) => { const ab: P2 = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / Math.max(1e-30, ab[0] ** 2 + ab[1] ** 2))); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t) }
const toSegs = (p: P2, segs: [P2, P2][]) => { let d = Infinity; for (const [a, b] of segs) d = Math.min(d, segDist(p, a, b)); return d }
const unwrap = (us: number[]) => { const o = [us[0]!]; for (let i = 1; i < us.length; i++) o.push(us[i]! + 2 * Math.PI * Math.round((o[i - 1]! - us[i]!) / (2 * Math.PI))); return o }

/** a key's path, chin → jaw, resampled at N equal fractions of its 3D arc length: (u, y) per sample */
function keySamples(k: { yaw: number; pitch: number }): { path: JawPath; uv: { u: number; y: number }[] } {
  const path = jawPath(head, k, jawOf(m, k, k)!)!
  const pts = [...path.pts].reverse(), us = unwrap([...path.uv].reverse().map(q => q.u)), ys = [...path.uv].reverse().map(q => q.y)
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + len(sub(pts[i]!, pts[i - 1]!)))
  const L = cum[cum.length - 1]!, uv: { u: number; y: number }[] = []
  for (let j = 0; j < N; j++) {
    const s = (L * j) / (N - 1)
    let i = 0; while (i < pts.length - 2 && cum[i + 1]! < s) i++
    const t = Math.min(1, Math.max(0, (s - cum[i]!) / Math.max(1e-30, cum[i + 1]! - cum[i]!)))
    uv.push({ u: us[i]! + (us[i + 1]! - us[i]!) * t, y: ys[i]! + (ys[i + 1]! - ys[i]!) * t })
  }
  return { path, uv }
}

interface Shown { segs: [P2, P2][]; hiddenSegs: [P2, P2][]; heads: V3[] }
/** the new mix at a view: (u, y) mixed per sample, then split into shown / hidden pieces by the depth test there */
function newMix(v: View, ks: { uv: { u: number; y: number }[] }[]): { uv: { u: number; y: number }[]; shown: Shown } {
  const W = weights(v.yaw, v.pitch), uv: { u: number; y: number }[] = []
  for (let i = 0; i < N; i++) {
    let u = 0, y = 0, u0: number | undefined
    KEYS.forEach((k, ki) => {
      const w = W.find(x => x.yaw === k.yaw && x.pitch === k.pitch)?.w ?? 0, q = ks[ki]!.uv[i]!
      u0 ??= q.u
      u += w * (q.u + 2 * Math.PI * Math.round((u0 - q.u) / (2 * Math.PI))); y += w * q.y
    })
    uv.push({ u, y })
  }
  return { uv, shown: pieces(v, uv, true) }
}

/** a line given by (u, y) samples, drawn as chords; depth: each chord split in 8, a piece hidden when its surface
 *  midpoint fails the depth test at the view; without depth: every piece shown (the geometry alone) */
function pieces(v: View, uv: { u: number; y: number }[], depth: boolean): Shown {
  const occ = occluder(head, v), Q = P(v), shown: Shown = { segs: [], hiddenSegs: [], heads: [] }
  for (let i = 0; i + 1 < uv.length; i++) {
    const a = uv[i]!, b = uv[i + 1]!, du = b.u + 2 * Math.PI * Math.round((a.u - b.u) / (2 * Math.PI)) - a.u
    const A = head.at(a.u, a.y), B = head.at(b.u, b.y)
    for (let k = 0; k < SPLIT; k++) {
      const t0 = k / SPLIT, t1 = (k + 1) / SPLIT, tm = (t0 + t1) / 2, um = a.u + du * tm, ym = a.y + (b.y - a.y) * tm
      const p0: V3 = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0, A[2] + (B[2] - A[2]) * t0], p1: V3 = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1, A[2] + (B[2] - A[2]) * t1]
      const hidden = depth && hiddenOn(occ, head.at(um, ym), um, ym)
      ;(hidden ? shown.hiddenSegs : shown.segs).push([Q(p0), Q(p1)])
      if (!hidden) shown.heads.push(p0, p1)
    }
  }
  return shown
}

/** the old mix's x+ chin–jaw as drawn: edge opacity min(vis), shown ≥ 0.5 */
function oldMix(v: View): Shown {
  const l = mixContour(head, m.table, v).find(x => x.side === 'pos')!, Q = P(v), s: Shown = { segs: [], hiddenSegs: [], heads: [] }
  for (let i = 0; i + 1 < N; i++) { const o = Math.min(l.vis[i]!, l.vis[i + 1]!), seg: [P2, P2] = [Q(l.pts[i]!), Q(l.pts[i + 1]!)]; if (o >= 0.5) { s.segs.push(seg); s.heads.push(l.pts[i]!, l.pts[i + 1]!) } else s.hiddenSegs.push(seg) }
  return s
}

function measure(v: View, target: JawPath, mix: Shown, runs: Run[]) {
  const Q = P(v)
  const tVis: [P2, P2][][] = target.intervals.filter(x => !x.hidden).map(x => x.pts.slice(1).map((p, i) => [Q(x.pts[i]!), Q(p)] as [P2, P2]))
  const tAll: [P2, P2][] = target.pts.slice(1).map((p, i) => [Q(target.pts[i]!), Q(p)])
  const tFlat = tVis.flat()
  // mix → target: every shown piece end
  const mPts = mix.segs.flatMap(s => s)
  const toT = mPts.map(p => toSegs(p, tFlat))
  // target → mix: the visible target path sampled every ≤ 0.005 R; coverage and the longest uncovered stretch
  let covered = 0, total = 0, gap = 0, maxGap = 0, toMmax = 0, toMsum = 0, toMn = 0
  for (const run of tVis) {
    gap = 0
    for (const [a, b] of run) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / 0.005))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, p: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = mix.segs.length ? toSegs(p, mix.segs) : Infinity
        total += l / n; toMmax = Math.max(toMmax, d); toMsum += d; toMn++
        if (d <= NEAR) { covered += l / n; gap = 0 } else { gap += l / n; maxGap = Math.max(maxGap, gap) }
      }
    }
  }
  // path switching: shown mix points off the whole target path (> NEAR) but within NEAR of some other visible outline
  const visRuns: [P2, P2][] = runs.filter(r => !r.hidden).flatMap(r => r.pts.slice(1).map((p, i) => [r.pts[i]!, p] as [P2, P2]))
  const other = mPts.filter(p => toSegs(p, tAll) > NEAR && toSegs(p, visRuns) <= NEAR).length
  const past = mix.heads.filter(h => h[0] < -SIDE_X).length
  const shownLen = mix.segs.reduce((a, [p, q]) => a + Math.hypot(q[0] - p[0], q[1] - p[1]), 0)
  return { mixToT: { max: toT.length ? Math.max(...toT) : NaN, mean: toT.length ? toT.reduce((a, b) => a + b, 0) / toT.length : NaN }, tToMix: { max: toMmax, mean: toMsum / Math.max(1, toMn) }, coverage: covered / Math.max(1e-30, total), visLen: total, maxGap, other, past, shownLen }
}

it.skipIf(!process.env.F3D_DIAG)('45,15: arc-length correspondence of the four keys\' jawline paths, against the old mix', () => {
  const dir = process.env.F3D_DIAG_DIR, out: string[] = []
  const ks = KEYS.map(keySamples)
  out.push('45,15 arc-length trial (whole segment, no internal marker). Keys (path chin → jaw, 3D length, end):')
  ks.forEach((k, i) => out.push(`  key ${KEYS[i]!.yaw},${KEYS[i]!.pitch}: length ${k.path.intervals.reduce((a, x) => a + x.len, 0).toFixed(3)}, chin end y ${k.path.marker![1].toFixed(3)} z ${k.path.marker![2].toFixed(3)}, jaw end y ${k.path.jaw[1].toFixed(3)} z ${k.path.jaw[2].toFixed(3)}`))
  const views: View[] = [{ yaw: 45, pitch: 15 }, { yaw: 44, pitch: 15 }, { yaw: 46, pitch: 15 }, { yaw: 45, pitch: 14 }, { yaw: 45, pitch: 16 }]
  const f = (x: number) => (Number.isNaN(x) ? '—' : x.toFixed(3))
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  svg += `<text x="10" y="20" font-size="13">45,15 弧长对应试验（整段几何试验，不加内部锚点）。灰 = 当前视角可见轮廓；绿 = 目标颌线路径可见段，红虚 = 其被挡段；橙 = 旧 mix（下巴–颌角，粗细 = 显示透明度）；蓝 = 新 mix 的显示段，浅蓝虚 = 新 mix 被挡段；数字 = 样点号</text>`
  const drawView = (ox: number, oy: number, v: View, label: string, target: JawPath, runs: Run[], nm: ReturnType<typeof newMix>, numbered: boolean, center: P2) => {
    const Q = P(v), S = 600, X = (p: P2) => `${(ox + 250 + (p[0] - center[0]) * S).toFixed(1)},${(oy + 250 - (p[1] - center[1]) * S).toFixed(1)}`
    svg += `<svg x="${ox}" y="${oy}" width="500" height="480" viewBox="${ox} ${oy} 500 480" overflow="hidden"><rect x="${ox + 2}" y="${oy}" width="496" height="480" fill="white" stroke="#eee"/><text x="${ox + 8}" y="${oy + 16}" font-size="12">${label}</text>`
    for (const r of runs) if (!r.hidden) svg += `<polyline fill="none" stroke="#bbb" stroke-width="1" points="${r.pts.map(X).join(' ')}"/>`
    for (const iv of target.intervals) svg += `<polyline fill="none" stroke="${iv.hidden ? '#d32f2f' : '#2e7d32'}" stroke-width="${iv.hidden ? 2.5 : 5}" ${iv.hidden ? 'stroke-dasharray="4 3"' : 'opacity="0.45"'} points="${iv.pts.map(Q).map(X).join(' ')}"/>`
    const l = mixContour(head, m.table, v).find(x => x.side === 'pos')!
    for (let i = 0; i + 1 < N; i++) { const o = Math.min(l.vis[i]!, l.vis[i + 1]!); if (o > 0.001) svg += `<polyline fill="none" stroke="#ef6c00" stroke-width="${(0.5 + 2.5 * o).toFixed(1)}" points="${X(Q(l.pts[i]!))} ${X(Q(l.pts[i + 1]!))}"/>` }
    for (const [a, b] of nm.shown.hiddenSegs) svg += `<polyline fill="none" stroke="#90caf9" stroke-width="1.5" stroke-dasharray="3 2" points="${X(a)} ${X(b)}"/>`
    for (const [a, b] of nm.shown.segs) svg += `<polyline fill="none" stroke="#1565c0" stroke-width="2" points="${X(a)} ${X(b)}"/>`
    nm.uv.forEach((q, i) => { const [x, y] = X(Q(head.at(q.u, q.y))).split(','); svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="#1565c0"/>${numbered ? `<text x="${+x! + 4}" y="${+y! - 4}" font-size="10" fill="#1565c0">${i}</text>` : ''}` })
    svg += '</svg>'
  }
  let center: P2 = [0, 0]
  views.forEach((v, vi) => {
    const target = jawPath(head, v, jawOf(m, v)!)!, runs = outlineRuns(head, v), nm = newMix(v, ks)
    const a = measure(v, target, nm.shown, runs), b = measure(v, target, oldMix(v), runs)
    const row = (name: string, r: ReturnType<typeof measure>) => `    ${name}: mix→target max ${f(r.mixToT.max)} mean ${f(r.mixToT.mean)} | target→mix max ${f(r.tToMix.max)} mean ${f(r.tToMix.mean)} | coverage ${(100 * r.coverage).toFixed(1)}% of ${r.visLen.toFixed(3)} R, longest uncovered ${r.maxGap.toFixed(3)} R | shown ${r.shownLen.toFixed(3)} R | on another outline ${r.other} pts, past mid plane ${r.past} pts`
    out.push(`view ${v.yaw},${v.pitch} (weights ${weights(v.yaw, v.pitch).map(w => `${w.yaw},${w.pitch}:${w.w.toFixed(3)}`).join(' ')}); target ${target.intervals.map(x => `${x.hidden ? 'H' : 'V'}${x.len.toFixed(3)}`).join(' ')}`)
    const ol = mixContour(head, m.table, v).find(x => x.side === 'pos')!.uv.slice(0, N)
    out.push(row('new, depth-tested    ', a)); out.push(row('new, geometry only   ', measure(v, target, pieces(v, nm.uv, false), runs)))
    out.push(row('old, as drawn (vis)  ', b)); out.push(row('old, depth-tested    ', measure(v, target, pieces(v, ol, true), runs)))
    // the new mix's samples: depth test, and how far from the silhouette the surface turns there (asin n·d, degrees;
    // > 0 faces the camera)
    const occ = occluder(head, v), d = toCamera(v)
    out.push(`    new samples (hidden?, asin n·d°): ${nm.uv.map((q, i) => { const n = head.normal(q.u, q.y), nd = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]; return `#${i} ${hiddenOn(occ, head.at(q.u, q.y), q.u, q.y) ? 'H' : 'V'} ${((Math.asin(Math.max(-1, Math.min(1, nd))) * 180) / Math.PI).toFixed(2)}` }).join(' ')}`)
    if (vi === 0) { const Q = P(v), all = target.pts.map(Q); center = [(Math.min(...all.map(p => p[0])) + Math.max(...all.map(p => p[0]))) / 2, (Math.min(...all.map(p => p[1])) + Math.max(...all.map(p => p[1]))) / 2] }
    const slots = [[0, 30], [1000, 520], [0, 1010], [500, 1010], [1000, 1010]] as const
    drawView(slots[vi]![0], slots[vi]![1], v, vi === 0 ? `本视角 45,15（新 mix 样点号对应各 key 同号样点）` : `±1°：${v.yaw},${v.pitch}`, target, runs, nm, vi === 0, center)
  })
  // the four keys, each at its own view: its path and the numbered resampled points (the correspondence)
  ks.forEach((k, i) => {
    const v = KEYS[i]!, Q = P(v), ox = [500, 1000, 0, 500][i]!, oy = [30, 30, 520, 520][i]!, all = k.path.pts.map(Q)
    const c: P2 = [(Math.min(...all.map(p => p[0])) + Math.max(...all.map(p => p[0]))) / 2, (Math.min(...all.map(p => p[1])) + Math.max(...all.map(p => p[1]))) / 2], S = 450
    const X = (p: P2) => `${(ox + 250 + (p[0] - c[0]) * S).toFixed(1)},${(oy + 240 - (p[1] - c[1]) * S).toFixed(1)}`
    svg += `<svg x="${ox}" y="${oy}" width="500" height="480" viewBox="${ox} ${oy} 500 480" overflow="hidden"><rect x="${ox + 2}" y="${oy}" width="496" height="480" fill="white" stroke="#eee"/><text x="${ox + 8}" y="${oy + 16}" font-size="12">key ${v.yaw},${v.pitch}（w ${weights(45, 15).find(w => w.yaw === v.yaw && w.pitch === v.pitch)!.w.toFixed(3)}）：路径 下巴 ● → 颌角 ▲，按三维弧长 13 等分</text>`
    for (const r of outlineRuns(head, v)) if (!r.hidden) svg += `<polyline fill="none" stroke="#bbb" stroke-width="1" points="${r.pts.map(X).join(' ')}"/>`
    for (const iv of k.path.intervals) svg += `<polyline fill="none" stroke="${iv.hidden ? '#d32f2f' : '#2e7d32'}" stroke-width="${iv.hidden ? 2.5 : 5}" ${iv.hidden ? 'stroke-dasharray="4 3"' : 'opacity="0.45"'} points="${iv.pts.map(Q).map(X).join(' ')}"/>`
    k.uv.forEach((q, j) => { const [x, y] = X(Q(head.at(q.u, q.y))).split(','); svg += `<circle cx="${x}" cy="${y}" r="3" fill="#000"/><text x="${+x! + 5}" y="${+y! - 4}" font-size="11">${j}</text>` })
    svg += '</svg>'
  })
  console.log(out.join('\n'))
  if (dir) writeFileSync(`${dir}/diag-arcmix.svg`, svg + '</svg>')
}, 900000)
