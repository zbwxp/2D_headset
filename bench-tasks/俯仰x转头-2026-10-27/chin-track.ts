// Chin, crown, ear and nose heights along the turn at pitch ±45 (bowen 1793073816: the chin's track should not curve — a turn
// never changes a height). Bowen's front keys vs the derived ones. Run: npx vite-node …/chin-track.ts <out.svg>
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, withDerivedPitch, type ModelData } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), M = JSON.parse(readFileSync(join(H, '../转头模型/model.json'), 'utf8')) as ModelData, MD = withDerivedPitch(M)
const W = 1400, PTS: [string, string][] = [['crown', '颅顶'], ['chin', '下巴'], ['nearEarUp', '上耳点'], ['noseTip', '鼻尖']]
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" font-family="PingFang SC"><rect width="100%" height="100%" fill="#fff"/>`
;[45, -45].forEach((pt, i) => {
  const ox = 80 + i * 680, oy = 80, w = 560, h = 520, y0 = -100, y1 = 80, X = (yaw: number) => ox + (yaw / 90) * w, Y = (v: number) => oy + ((v - y0) / (y1 - y0)) * h
  svg += `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="none" stroke="#ccc"/><text x="${ox}" y="${oy - 20}" font-size="22">${pt > 0 ? '仰' : '俯'} 45：各点高度随转头（横轴 转 0→90°，纵轴 高度，往下为正）</text>`
  for (const v of [-80, -40, 0, 40]) svg += `<line x1="${ox}" x2="${ox + w}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eee"/><text x="${ox - 8}" y="${Y(v) + 4}" font-size="12" text-anchor="end" fill="#888">${v}</text>`
  for (const yaw of [0, 30, 60, 90]) svg += `<text x="${X(yaw)}" y="${oy + h + 18}" font-size="12" text-anchor="middle" fill="#888">${yaw}°</text>`
  for (const [k, lab] of PTS) for (const [m, col, dash] of [[M, '#c33', '6 4'], [MD, '#26c', '']] as const) {
    const ys = Array.from({ length: 91 }, (_, yaw) => evaluate(m, yaw, undefined, pt).points[k]![1])
    svg += `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash && `stroke-dasharray="${dash}"`} points="${ys.map((v, yaw) => `${X(yaw).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`
    if (m === MD) svg += `<text x="${X(90) + 6}" y="${Y(ys[90]!) + 4}" font-size="13" fill="#333">${lab}</text>`
  }
})
svg += `<text x="80" y="680" font-size="16" fill="#444">红虚线 = 你现在的正脸关键帧　蓝实线 = 推导（正脸 ±45 的高度来自侧面转 45°）　真正的 3D 头转头时高度不变，应接近水平线</text>`
writeFileSync(process.argv[2]!, svg + '</svg>')
