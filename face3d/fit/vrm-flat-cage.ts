// The flat birdcage (bowen 1793152656 「转到15度，然后切出来一个外轮廓之后，这个外轮廓直接在15度的z轴方向压扁…只有15度方向的一个线框并且
// 没有15度对应的z方向的起伏，这样给我转一圈，就应该看起来像鸟笼一样」): for each turn, VRoid's outline on the screen (the head drawn
// with its neck down to the neck's base ring; ears pressed flat, or kept), squashed along that turn's line of sight — a flat
// line in the upright plane through the turning axis that faces that turn. All turns together: the cage. A turn and the turn
// 180° on give the same plane (the outline mirrored), so 0 … 175° are kept.
// Writes face3d/viewer/vrm-flat-cage.json. Run: npx vite-node face3d/fit/vrm-flat-cage.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { screenAxes, toCamera } from '../src/view'
import { flattenEars } from './flatten-ears'
type P3 = [number, number, number]
const doc = JSON.parse(readFileSync('face3d/viewer/ref-shell/bowen-1793118841-sym.json', 'utf8')) as { points: { name: string; p: P3 }[] }
const pt = (n: string) => doc.points.find(p => p.name === n)!.p
const buf = readFileSync('face3d/fit/ref/test.vrm'), ab = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
// the head with its neck in the usual head space (as the 头壳标注 page), skin only, no arms
const d0 = loadVrmHead(ab()), D = loadVrmHead(ab(), 1.3)
const ext = (P: readonly (readonly number[])[], k: number) => P.reduce((m, p) => (p[k]! > m[k]! ? p : m))
const a0 = ext(d0.P, 1), b0 = ext(d0.P, 2), a1 = ext(D.P, 1), b1 = ext(D.P, 2)
const sc = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!) / Math.hypot(a1[0]! - b1[0]!, a1[1]! - b1[1]!, a1[2]! - b1[2]!)
const P = D.P.map(p => [0, 1, 2].map(k => a0[k]! + sc * (p[k]! - a1[k]!)) as P3)
const parts = D.parts.filter(p => p.kind === 'skin').map(p => { const tris: number[] = [], cornerN: number[] = []
  for (let i = 0; i < p.tris.length; i += 3) { const v = [p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!]; if (!v.every(k => P[k]![1] > -1.2 || Math.abs(P[k]![0]) < 1.0)) continue; tris.push(...v); cornerN.push(...p.cornerN.slice(3 * i, 3 * i + 9)) }
  return { ...p, tris, cornerN } })
const skinTris = parts.flatMap(p => p.tris)
const PF = P.map(p => [...p] as P3); flattenEars(PF, D.N.map(n => [...n]), skinTris)
const yBase = Math.max(pt('后颈')[1], pt('颈前')[1]) + 0.03
// the head cut at the base ring (nothing below it drawn: from above or below the shoulders would hide the head's outline)
for (const p of parts) { const t: number[] = [], cn: number[] = []; for (let i = 0; i < p.tris.length; i += 3) { if ([0, 1, 2].some(k => P[p.tris[i + k]!]![1] < yBase - 0.02)) continue; t.push(p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!); cn.push(...p.cornerN.slice(3 * i, 3 * i + 9)) } p.tris = t; p.cornerN = cn }
skinTris.splice(0, skinTris.length, ...parts.flatMap(p => p.tris))
const W = 640, F = { W, H: W, S: W / 3.6, cx: W / 2, cy: W * 0.4 }

/** the outline at a view, on the screen, opened at the neck's cut (from the neck's one side over the crown to the other); seen
 * from above (no cut on it) a closed loop */
function outline(Pv: P3[], yaw: number, pitch = 0): [number, number][] {
  const v = { yaw, pitch }, ras = rasterHead({ ...D, P: Pv, parts, skinTris } as unknown as Parameters<typeof rasterHead>[0], v, F, new Uint8ClampedArray(W * W * 4))
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < W && ras.zb[j * W + i]! > -Infinity
  let s0: [number, number] | null = null; for (let j = 0; j < W && !s0; j++) for (let i = 0; i < W && !s0; i++) if (on(i, j)) s0 = [i, j]
  const D8 = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]] as const, cells: [number, number][] = [s0!]
  for (let cur = s0!, back: [number, number] = [s0![0] - 1, s0![1]], n = 0; n < 40000; n++) { const bi = D8.findIndex(d => cur[0] + d[0] === back[0] && cur[1] + d[1] === back[1]); let moved = false
    for (let k = 1; k <= 8; k++) { const d = D8[(bi + k) % 8]!, c: [number, number] = [cur[0] + d[0], cur[1] + d[1]]; if (on(c[0], c[1])) { const pd = D8[(bi + k - 1) % 8]!; back = [cur[0] + pd[0], cur[1] + pd[1]]; cur = c; moved = true; break } }
    if (!moved || (cur[0] === s0![0] && cur[1] === s0![1])) break; cells.push(cur) }
  // the neck's cut: where the outline point lies on the head below the base ring's height (by its depth, back in head space)
  const ax = screenAxes(v), fw = toCamera(v)
  const all = cells.map(([i, j]) => [(i + 0.5 - F.cx) / F.S, (F.cy - (j + 0.5)) / F.S] as [number, number])
  const keep = cells.map(([i, j], k) => ax.right[1]! * all[k]![0] + ax.up[1]! * all[k]![1] + fw[1]! * ras.zb[j * W + i]! > yBase + 0.07), n = all.length
  // the longest run of the outline above the cut (all of it, closed, when nothing is cut — seen from above)
  const closed = keep.every(Boolean); let run: [number, number][] = []
  if (closed) run = [...all, all[0]!]
  else for (let st = 0; st < n; st++) { if (!keep[st] || keep[(st - 1 + n) % n]) continue; const r: [number, number][] = []; for (let k = 0; k < n; k++) { const i = (st + k) % n; if (!keep[i]) break; r.push(all[i]!) } if (r.length > run.length) run = r }
  const sm = run.map((_, i) => { const w = run.slice(Math.max(0, i - 3), i + 4); return [w.reduce((a, q) => a + q[0], 0) / w.length, w.reduce((a, q) => a + q[1], 0) / w.length] as [number, number] })
  const out: [number, number][] = [sm[0]!]; let acc = 0
  for (let i = 1; i < sm.length; i++) { acc += Math.hypot(sm[i]![0] - sm[i - 1]![0], sm[i]![1] - sm[i - 1]![1]); if (acc >= 0.012) { out.push(sm[i]!); acc = 0 } }
  return out
}
/** the screen outline put flat in its plane: x along the turn's screen right, y up, nothing along its line of sight */
const flatten = (q: [number, number][], yaw: number, pitch = 0): P3[] => { const ax = screenAxes({ yaw, pitch }); return q.map(([x, y]) => [0, 1, 2].map(k => +(ax.right[k]! * x + ax.up[k]! * y).toFixed(3)) as P3) }
const out: { yaw: number; flat: P3[]; ears: P3[] }[] = []
for (let yaw = 0; yaw < 180; yaw += 5) out.push({ yaw, flat: flatten(outline(PF, yaw), yaw), ears: flatten(outline(P, yaw), yaw) })
// the pitch cage (bowen 1793152966 「yaw0 pitch 每5度来一个这样的」): turn 0, tilt every 5° from straight above (−90) to just
// before straight below (+85) — a tilt and the tilt 180° on share a plane; each squashed along its line of sight into the plane
// through the left-right axis that faces it
// … and the same at other turns (bowen 1793153501 「再做一个yaw 15度然后pitch从-90到90 度的笼子」): turn 0, 15, … 90, each tilt
// from −90 to +90 every 5° (a turn's tilts −90 and +90 are different views once turned; at turn 0 they share a plane)
const pitchOut: { yaw: number; pitch: number; flat: P3[]; ears: P3[] }[] = []
for (let yaw = 0; yaw <= 90; yaw += 15) for (let pitch = -90; pitch <= 90; pitch += 5) pitchOut.push({ yaw, pitch, flat: flatten(outline(PF, yaw, pitch), yaw, pitch), ears: flatten(outline(P, yaw, pitch), yaw, pitch) })
writeFileSync('face3d/viewer/vrm-flat-cage.json', JSON.stringify({ round: 3, note: "VRoid's outline per turn (cages) and per tilt at turn 0 (pitches), squashed along that view's line of sight into the plane through the head's centre facing it (face3d/fit/vrm-flat-cage.ts, bowen 1793152656 / 1793152966); flat = ears pressed flat, ears = kept", yBase, cages: out, pitches: pitchOut }))
console.log('turns', out.length, 'tilts', pitchOut.length, 'points', out.reduce((a, c) => a + c.flat.length, 0))
