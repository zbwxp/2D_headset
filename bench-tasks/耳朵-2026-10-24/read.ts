import { readFileSync } from 'node:fs'
import { open } from '/Users/bowen/Documents/headset-core/src/archive/index'
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
for (const f of ['01-正脸-yaw0-pitch0.近2远3.眼睛骨线.json', '03-转头45-yaw45-pitch0.近2远3.眼睛骨线.json', '02-侧脸-yaw90-pitch0.近2远3.眼睛骨线.json']) {
  const text = readFileSync(D + f, 'utf8'), core = open(text), s = core.snapshot() as any
  console.log('==', f, 'bench', JSON.stringify(JSON.parse(text).bench))
  console.log('layers', JSON.stringify((s.layers ?? []).map((l: any) => [l.id, l.name])))
  const want = ['pmv3m1am1-1', 'pm03-skf', 'cmv3m1am1-6/pmv3m1am1-1', 'cmv3m1am1-6/pmv3m1am1-2', 'cmv3m1am1-6/pmv3m1am1-4', 'pmv6kklw1-2', 'pmv6kklw1-11']
  for (const p of s.points) if (want.includes(p.id)) console.log('pt', p.id, p.layer, JSON.stringify(p.position))
  for (const l of s.lines) if ([l.a, l.b].some((x: string) => x.startsWith('cmv3m1am1-6') || x.startsWith('pmv3m1am1') || x === 'pm03-skf' || x === 'pmv6kklw1-2')) console.log('line', l.id, l.name ?? '', l.a, l.b, JSON.stringify(l.ha), JSON.stringify(l.hb))
}
