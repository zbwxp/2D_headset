// Face-outline snapshots at yaw 0 / 15 / 30 / 45 / 60 / 75 / 90 (bowen 1792512376: "这就是未来脸轮廓的建模"), all in 2D:
//   keys = bowen's hand-tuned bench outlines put at their ESTIMATED true angles (angles.ts; candidates, dot 1792512223):
//     the front, made symmetric (averaged with its mirror); "30" and "60" (his playback corrections, +yaw side only —
//     the −yaw side is not hand-tuned); the +90 view and the −90 view mirrored, each at its own estimated angle;
//   every control (each line's end points and handle vectors, canvas px) interpolated LINEARLY over the true angle
//   between neighbouring keys (bowen 1792512406: "脸轮廓建模的本质就是几个关键帧加上线性interpolate"), read at the
//   snapshot angles (outside the keys: the nearest key); −yaw = the mirror, so the set is symmetric.
// Run: npx vite-node face3d/fit/snapshots.ts <angles.json> <out-prefix> [pitch]
import { readFileSync, writeFileSync } from 'node:fs'
import { type Pose } from '../../../headset-core/src/evaluate/index'
import { type Controls, LINES, avg, controlsAt, cubicsOf, flat, mirror, sample, unflat } from './outline-sym'
export { LINES, controlsAt, cubicsOf, mirror }

export interface Key { yaw: number; from: string; c: Controls }
/** the keys for one pitch row from an angle estimate */
export function keys(A: { nominal: Pose[]; angles: Pose[] }, pitch: number): Key[] {
  const est = (yaw: number) => A.angles[A.nominal.findIndex(n => n.yaw === yaw && n.pitch === pitch)]!
  const front = controlsAt({ yaw: 0, pitch })
  const out: Key[] = [{ yaw: 0, from: `bench 0,${pitch}（与镜像平均）`, c: avg(front, mirror(front)) }]
  for (const y of [30, 60]) out.push({ yaw: est(y).yaw, from: `bench 「${y}」,${pitch}`, c: controlsAt({ yaw: y, pitch }) })
  out.push({ yaw: est(90).yaw, from: `bench 90,${pitch}`, c: controlsAt({ yaw: 90, pitch }) })
  out.push({ yaw: -est(-90).yaw, from: `bench −90,${pitch}（镜像）`, c: mirror(controlsAt({ yaw: -90, pitch })) })
  return out.sort((a, b) => a.yaw - b.yaw)
}
export function snapshots(K: Key[], at: number[]): { yaw: number; c: Controls }[] {
  const cols = K.map(k => flat(k.c)), n = cols[0]!.length
  const lin = (j: number) => (yaw: number) => {
    if (yaw <= K[0]!.yaw) return cols[0]![j]!
    if (yaw >= K[K.length - 1]!.yaw) return cols[K.length - 1]![j]!
    let i = 0; while (yaw > K[i + 1]!.yaw) i++
    const t = (yaw - K[i]!.yaw) / (K[i + 1]!.yaw - K[i]!.yaw); return cols[i]![j]! * (1 - t) + cols[i + 1]![j]! * t
  }
  const fns = Array.from({ length: n }, (_, j) => lin(j))
  return at.map(yaw => ({ yaw, c: unflat(K[0]!.c, fns.map(f => f(yaw))) }))
}

if (process.argv[1]?.includes('vite-node') || process.env.SNAP) {
  const [anglesFile, prefix, pitchArg] = process.argv.slice(2)
  if (anglesFile && prefix) {
    const A = JSON.parse(readFileSync(anglesFile, 'utf8')), pitch = Number(pitchArg ?? 0), K = keys(A, pitch), AT = [0, 15, 30, 45, 60, 75, 90], S = snapshots(K, AT)
    writeFileSync(`${prefix}.json`, JSON.stringify({ pitch, angles: anglesFile, keys: K.map(k => ({ yaw: k.yaw, from: k.from })), snapshots: S }, null, 1))
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="PingFang SC, sans-serif"><rect width="100%" height="100%" fill="white"/>`
    svg += `<text x="10" y="24" font-size="16">外轮廓快照 · pitch ${pitch} · 关键帧（估计角度）：${K.map(k => `${k.from} @ ${k.yaw.toFixed(1)}°`).join('；')}</text>`
    const cw = 1500 / AT.length
    S.forEach((s, i) => {
      const ox = i * cw + cw / 2, oy = 220, sc = 1.0
      svg += `<text x="${ox - 16}" y="${oy + 170}" font-size="18">${s.yaw}°</text>`
      for (const q of cubicsOf(s.c)) svg += `<polyline fill="none" stroke="#111" stroke-width="2" points="${sample(q).map(p => `${(ox + p.x * sc).toFixed(1)},${(oy + p.y * sc).toFixed(1)}`).join(' ')}"/>`
    })
    // the keys themselves, at their angles, overlaid in red on the same strip scale (row 2)
    K.forEach((k, i) => {
      const ox = (i + 0.5) * (1500 / K.length), oy = 560
      svg += `<text x="${ox - 70}" y="${oy + 170}" font-size="14" fill="#c62828">${k.from} @ ${k.yaw.toFixed(1)}°</text>`
      for (const q of cubicsOf(k.c)) svg += `<polyline fill="none" stroke="#c62828" stroke-width="1.6" points="${sample(q).map(p => `${(ox + p.x).toFixed(1)},${(oy + p.y).toFixed(1)}`).join(' ')}"/>`
    })
    writeFileSync(`${prefix}.svg`, svg + '</svg>'); console.log('ok', K.map(k => `${k.yaw.toFixed(1)}`).join(' '))
  }
}
