// bowen's 头壳标注 made symmetric (bowen 1793112590 「首先给它对称了（中间那条明显的线给它居中）」): he tuned the left half
// (x < 0). Points within MID of the midline go onto it (x = 0), and so do the handles of lines lying along it; every left
// point and line is mirrored to the right, replacing what was there (the old right ear, eye and forehead half). Names: 左 → 右,
// a left name without a side gets 右 in front; bowen's left names are kept.
// Run: npx vite-node face3d/fit/shell-sym.ts face3d/viewer/ref-shell/bowen-1793112590.json  (writes …-sym.json beside it)
import { readFileSync, writeFileSync } from 'node:fs'
type P3 = [number, number, number]
interface Pt { id: number; name: string; p: P3 }
interface Ln { id: number; name: string; a: number; b: number; c: P3[]; own?: boolean }
interface Doc { version: 1; next: number; points: Pt[]; lines: Ln[] }
const file = process.argv[2]!, doc = JSON.parse(readFileSync(file, 'utf8')) as Doc
const MID = 0.05
const pt = (id: number) => doc.points.find(p => p.id === id)!
const onMid = (p: P3) => Math.abs(p[0]) < MID
// 1. the midline
for (const p of doc.points) if (onMid(p.p)) p.p[0] = 0
for (const l of doc.lines) {
  const a = pt(l.a), b = pt(l.b); l.c[0] = [...a.p]; l.c[3] = [...b.p]
  if (onMid(a.p) && onMid(b.p) && onMid(l.c[1]!) && onMid(l.c[2]!)) { l.c[1]![0] = 0; l.c[2]![0] = 0 }
}
// 1b. lines bowen let go (·俯视 / ·大角度俯仰 helpers, bowen 1793114630 「给它们删掉」)
doc.lines = doc.lines.filter(l => !/·俯视|·大角度俯仰/.test(l.name))
// 1c. names made twice (the editor's 使相交 named a cut 线5 again → 线5前/线5后 twice): the later lines get the next free number,
// one per group of joined lines, keeping their 前/后 tail
{ const seen = new Set<string>(), dup = doc.lines.filter(l => { const d = seen.has(l.name); seen.add(l.name); return d })
  const taken = () => new Set(doc.lines.map(l => (/^线(\d+)/.exec(l.name) ?? [])[1]).filter(Boolean).map(Number))
  const groups: Ln[][] = []; for (const l of dup) { const g = groups.find(g => g.some(o => [o.a, o.b].some(e => e === l.a || e === l.b))); if (g) g.push(l); else groups.push([l]) }
  for (const g of groups) { const used = taken(); let n = 1; while (used.has(n)) n++
    for (const l of g) { const old = l.name; l.name = l.name.replace(/^线\d+/, `线${n}`); console.log('renamed', old, '→', l.name, `(${pt(l.a).name} → ${pt(l.b).name})`) } } }
// 2. the right half out: lines reaching right of the midline with nothing on the left, then the points left on their own
const side = (l: Ln) => { const xs = [pt(l.a).p[0], pt(l.b).p[0], l.c[1]![0], l.c[2]![0]]; return xs.some(x => x < -MID) ? -1 : xs.some(x => x > MID) ? 1 : 0 }
const dropped = doc.lines.filter(l => side(l) === 1).map(l => l.name)
doc.lines = doc.lines.filter(l => side(l) !== 1)
const used = new Set(doc.lines.flatMap(l => [l.a, l.b]))
const droppedPts = doc.points.filter(p => p.p[0] > MID && !used.has(p.id)).map(p => p.name)
doc.points = doc.points.filter(p => !(p.p[0] > MID && !used.has(p.id)))
// 3. the left half mirrored
const rightName = (n: string) => (n.includes('左') ? n.replace(/左/g, '右') : `右${n}`)
const mir = new Map<number, number>()
for (const p of [...doc.points]) if (p.p[0] < -MID) { const id = doc.next++; mir.set(p.id, id); doc.points.push({ id, name: rightName(p.name), p: [-p.p[0], p.p[1], p.p[2]] }) }
const to = (id: number) => mir.get(id) ?? id
for (const l of [...doc.lines]) if (side(l) === -1) doc.lines.push({ id: doc.next++, name: rightName(l.name), a: to(l.a), b: to(l.b), c: l.c.map(p => [-p[0], p[1], p[2]] as P3), own: true })
const out = file.replace(/\.json$/, '-sym.json')
writeFileSync(out, JSON.stringify(doc, null, 1))
console.log('dropped lines', dropped.join(' '), '| dropped points', droppedPts.join(' '))
console.log('points', doc.points.length, 'lines', doc.lines.length, '→', out)
