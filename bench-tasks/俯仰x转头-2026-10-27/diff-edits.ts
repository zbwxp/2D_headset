// How far bowen moved the bones in a hand-tuned 20–34 file from what make-files.ts gave (the model at the fitted angle):
// per point of view 0,0, grouped by part. Run: npx vite-node …/diff-edits.ts <file in 脸轮廓手调/> …
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, type ModelData, type V } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..')
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
const PART: [string, string[]][] = [['轮廓', ['cmv3m1am1-6/pmv3m1am1-4', 'cmv3m1am1-6/pmv3m1am1-2', 'cmv3m1am1-6/pmv3m1am1-1', 'pmv3m1am1-1', 'pm03-skf']],
  ['侧脸片', ['pmv6kklw1-3', 'pmv6kklw1-5', 'pmv6kklw1-7', 'pmv6kklw1-9']], ['近眼', ['pey-R-in', 'pey-R-out', 'pey-R-mid']], ['远眼', ['pey-L-in', 'pey-L-out', 'pey-L-mid']], ['耳', ['pear-R-up', 'pear-R-tip', 'pear-R-low']]]
const NAME: Record<string, string> = { 'cmv3m1am1-6/pmv3m1am1-4': '颅顶', 'cmv3m1am1-6/pmv3m1am1-2': '下巴', 'cmv3m1am1-6/pmv3m1am1-1': '近颧/耳根', 'pmv3m1am1-1': '远颧骨', 'pm03-skf': '远太阳穴', 'pmv6kklw1-3': '下唇', 'pmv6kklw1-5': '上唇', 'pmv6kklw1-7': '鼻尖', 'pmv6kklw1-9': '眉', 'pey-R-in': '内', 'pey-R-out': '外', 'pey-R-mid': '下', 'pey-L-in': '内', 'pey-L-out': '外', 'pey-L-mid': '下', 'pear-R-up': '上', 'pear-R-tip': '尖', 'pear-R-low': '下' }
for (const file of process.argv.slice(2)) {
  const m = /拟合yaw(-?\d+(?:\.\d+)?)pitch(-?\d+(?:\.\d+)?)/.exec(file)!, yaw = +m[1]!, pitch = +m[2]!
  const f = evaluate(M, yaw, undefined, pitch), p = f.points, ne = f.eyes.near, fe = f.eyes.far, last = (a: V[]) => a[a.length - 1]!
  const model: Record<string, V> = { 'cmv3m1am1-6/pmv3m1am1-4': p.crown!, 'cmv3m1am1-6/pmv3m1am1-2': p.chin!, 'cmv3m1am1-6/pmv3m1am1-1': p.nearRoot!, 'pmv3m1am1-1': p.zyg!, 'pm03-skf': p.temple!,
    'pmv6kklw1-3': p.lipLow!, 'pmv6kklw1-5': p.lipUp!, 'pmv6kklw1-7': p.noseTip!, 'pmv6kklw1-9': p.brow!,
    'pey-R-in': ne[0]!.pts[0]!, 'pey-R-out': last(ne[0]!.pts), 'pey-R-mid': last(ne[1]!.pts), 'pey-L-in': fe[0]!.pts[0]!, 'pey-L-out': last(fe[0]!.pts), 'pey-L-mid': last(fe[1]!.pts),
    'pear-R-up': p.nearEarUp!, 'pear-R-tip': p.nearEarTip!, 'pear-R-low': p.nearEarLow! }
  const d = JSON.parse(readFileSync(join(REPO, '脸轮廓手调', file), 'utf8')), v = d.document.network.shapes.layers.find((l: { key: string }) => l.key === 'view:0,0').points
  console.log(`== ${file}`)
  for (const [part, ids] of PART) console.log('  ' + part + ': ' + ids.map(id => { const q = v[id], o = model[id]!; return `${NAME[id]} (${(q.x - o[0]).toFixed(1)}, ${(q.y - o[1]).toFixed(1)})` }).join('  '))
}
