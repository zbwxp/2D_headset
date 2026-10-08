// Corner-case probing (bowen 1791428827): random edit sequences through the public
// API, checking after every step that the result is valid, that the same sequence
// always gives the same result, and that undoing everything returns to the start.
import { describe, it, expect } from 'vitest'
import { Core, type Vec, type Snapshot, type Editor } from '../src'

// Small deterministic PRNG (mulberry32).
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Op = { name: string; run: (e: Editor) => void } | { name: 'undo' | 'redo' }

/** Choose one operation from the current snapshot. Ids come from a counter so sequences replay exactly. */
function chooseOp(s: Snapshot, r: () => number, next: () => string): Op {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const layers = ['A', 'B']
  const pos = (): Vec => ({ x: Math.round(r() * 40), y: Math.round(r() * 40) })
  const handle = (): Vec => ({ x: Math.round((r() - 0.5) * 20), y: Math.round((r() - 0.5) * 20) })
  const roll = r()
  const lines = s.lines, points = s.points
  if (roll < 0.05) return { name: 'undo' }
  if (roll < 0.08) return { name: 'redo' }
  if (roll < 0.30 || lines.length < 3) {
    // pen: from an existing point or a new one, to an existing point or a new one, same layer
    const layer = pick(layers)!
    const inLayer = points.filter(p => p.layer === layer)
    const end = () => (inLayer.length && r() < 0.6 ? pick(inLayer)!.id : { id: next(), layer, position: pos() })
    const a = end(), b = end(), id = next(), h = r() < 0.5 ? { ha: handle(), hb: handle() } : undefined
    return { name: `line ${id}`, run: e => e.line(id, a, b, h) }
  }
  if (roll < 0.40) { const l = pick(lines)!, m = next(), p1 = next(), p2 = next(), t = 0.2 + r() * 0.6; return { name: `split ${l.id}`, run: e => e.split(l.id, t, m, p1, p2) } }
  if (roll < 0.47) { const l = pick(lines)!; return { name: `delete ${l.id}`, run: e => e.deleteLine(l.id) } }
  if (roll < 0.57) {
    const p = pick(points)!, q = pick(points.filter(x => x.layer === p.layer && x.id !== p.id))
    return { name: `bind ${p.id} ${q?.id}`, run: e => e.bind(p.id, q?.id ?? p.id) }
  }
  if (roll < 0.62) {
    const p = pick(points)!, at = lines.filter(l => l.a === p.id || l.b === p.id).map(l => l.id)
    const subset = at.filter(() => r() < 0.5), id = next()
    return { name: `unbind ${p.id}`, run: e => e.unbind(p.id, subset.length ? subset : at.slice(0, 1), id) }
  }
  if (roll < 0.67) {
    const p = pick(points)!, q = pick(points.filter(x => x.layer !== p.layer))
    return { name: `link ${p.id} ${q?.id}`, run: e => e.link(p.id, q?.id ?? p.id) }
  }
  if (roll < 0.77) {
    const p = pick(points)!, at = lines.filter(l => l.a === p.id || l.b === p.id).map(l => l.id)
    const l1 = pick(at), l2 = pick(at.filter(x => x !== l1)), mode = pick(['smooth', 'cusp', 'arc'] as const)!
    return { name: `join ${p.id} ${mode}`, run: e => e.join(p.id, l1 ?? '?', l2 ?? '?', { mode, radius: mode === 'arc' ? 1 + r() * 3 : undefined }) }
  }
  if (roll < 0.85) { const l = pick(s.loops); return { name: `fill ${l?.id}`, run: e => e.fill(l?.id ?? '?', pick(['red', 'blue'])!) } }
  if (roll < 0.88) { const l = pick(s.loops.filter(x => x.color)); return { name: `clear ${l?.id}`, run: e => e.clearFill(l?.id ?? '?') } }
  if (roll < 0.95) { const ps = points.filter(() => r() < 0.3).map(p => ({ id: p.id, target: pos() })); return { name: 'move', run: e => e.move(ps) } }
  const l = pick(lines)!, end = r() < 0.5 ? 'a' as const : 'b' as const, h = handle()
  return { name: `handle ${l.id}`, run: e => e.moveHandle(l.id, end, h) }
}

/** Every invariant the relationship graph promises about a published state. */
function invariants(d: Core): string[] {
  const s = d.snapshot(), bad: string[] = []
  const pointById = new Map(s.points.map(p => [p.id, p]))
  const lineById = new Map(s.lines.map(l => [l.id, l]))
  const ends = new Set(s.lines.flatMap(l => [l.a, l.b]))
  for (const p of s.points) {
    if (!ends.has(p.id)) bad.push(`isolated point ${p.id}`)
    if (!Number.isFinite(p.position.x) || !Number.isFinite(p.position.y)) bad.push(`non-finite ${p.id}`)
  }
  for (const l of s.lines) {
    const a = pointById.get(l.a), b = pointById.get(l.b)
    if (!a || !b) bad.push(`line ${l.id} has a missing end`)
    else if (a.layer !== b.layer) bad.push(`line ${l.id} crosses layers`)
    if (l.a === l.b) bad.push(`line ${l.id} has both ends on one point`)
  }
  // groups partition the lines into connected components of one layer
  const seen = new Set<string>()
  for (const g of s.groups) for (const id of g.lines) { if (seen.has(id)) bad.push(`line ${id} in two groups`); seen.add(id) }
  if (seen.size !== s.lines.length) bad.push('groups do not cover all lines')
  for (const g of s.groups) {
    const reach = new Set([g.lines[0]!]); let grew = true
    while (grew) {
      grew = false
      for (const id of g.lines) {
        if (reach.has(id)) continue
        const l = lineById.get(id)!
        if ([...reach].some(r => { const x = lineById.get(r)!; return [x.a, x.b].some(p => p === l.a || p === l.b) })) { reach.add(id); grew = true }
      }
    }
    if (reach.size !== g.lines.length) bad.push(`group ${g.id} is not connected`)
  }
  for (const j of s.joins) {
    const at = s.lines.filter(l => l.a === j.point || l.b === j.point).map(l => l.id)
    if (!j.lines.every(x => at.includes(x)) || j.lines[0] === j.lines[1]) bad.push(`join at ${j.point} is stale`)
  }
  for (const k of s.links) {
    const a = pointById.get(k.a), b = pointById.get(k.b)
    if (!a || !b) bad.push(`link ${k.a}-${k.b} has a missing point`)
    else {
      if (a.layer === b.layer) bad.push(`link ${k.a}-${k.b} in one layer`)
      if (Math.abs(a.position.x - b.position.x) > 1e-9 || Math.abs(a.position.y - b.position.y) > 1e-9) bad.push(`link ${k.a}-${k.b} not coincident`)
      if (!a.links.includes(k.b) || !b.links.includes(k.a)) bad.push(`link ${k.a}-${k.b} not on both points`)
    }
  }
  const filled = s.loops.filter(l => l.color)
  if (JSON.stringify([...filled.map(l => l.id)].sort()) !== JSON.stringify([...s.fillOrder].sort())) bad.push('fill order and filled loops differ')
  for (const loop of s.loops) {
    const steps = loop.route.map(u => { const l = lineById.get(u.line); return l ? (u.reversed ? [l.b, l.a] : [l.a, l.b]) : ['?', '!'] })
    steps.forEach((st, i) => { if (st[1] !== steps[(i + 1) % steps.length]![0]) bad.push(`loop ${loop.id} is not closed`) })
    if (new Set(loop.route.map(u => pointById.get(lineById.get(u.line)?.a ?? '')?.layer)).size !== 1) bad.push(`loop ${loop.id} crosses layers`)
  }
  for (const f of d.geometry().fills) f.parts.forEach((p, i) => {
    const n = f.parts[(i + 1) % f.parts.length]!
    if (Math.hypot(p.curve[3].x - n.curve[0].x, p.curve[3].y - n.curve[0].y) > 1e-6) bad.push(`fill ${f.id} outline has a gap`)
  })
  return [...new Set(bad)]
}

export const stats = { tried: {} as Record<string, number>, ok: {} as Record<string, number>, maxLoops: 0, maxFilled: 0 }

/** Run a seeded sequence; returns the snapshots after each step and the invariant failures. */
function run(seed: number, steps: number) {
  const d = new Core(), r = rng(seed)
  let counter = 0
  const next = () => `i${counter++}`
  d.edit(e => { e.layer('A'); e.layer('B') })
  const trail: string[] = [], failures: string[] = []
  for (let i = 0; i < steps; i++) {
    const op = chooseOp(d.snapshot(), r, next)
    try {
      stats.tried[op.name.split(' ')[0]!] = (stats.tried[op.name.split(' ')[0]!] ?? 0) + 1
      if (op.name === 'undo') d.undo()
      else if (op.name === 'redo') d.redo()
      else d.edit((op as { run: (e: Editor) => void }).run)
      stats.ok[op.name.split(' ')[0]!] = (stats.ok[op.name.split(' ')[0]!] ?? 0) + 1
    } catch { /* refused operations are fine; the state must stay valid */ }
    stats.maxLoops = Math.max(stats.maxLoops, d.snapshot().loops.length)
    stats.maxFilled = Math.max(stats.maxFilled, d.snapshot().fillOrder.length)
    for (const f of invariants(d)) failures.push(`seed ${seed} step ${i} (${op.name}): ${f}`)
    trail.push(JSON.stringify([d.snapshot(), d.geometry()]))
  }
  return { d, trail, failures }
}

describe('random edit sequences (bowen 1791428827)', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1)

  it('every published state satisfies the graph invariants', () => {
    const failures = seeds.flatMap(seed => run(seed, 80).failures)
    expect(failures.slice(0, 10)).toEqual([])
    if (process.env.FUZZ_STATS) console.log(JSON.stringify(stats))
  })

  it('the same sequence always gives the same result', () => {
    for (const seed of seeds.slice(0, 10)) expect(run(seed, 60).trail).toEqual(run(seed, 60).trail)
  })

  it('undoing everything returns to the starting state', () => {
    for (const seed of seeds.slice(0, 10)) {
      const { d } = run(seed, 60)
      while (d.canUndo) d.undo()
      expect(d.snapshot().lines).toEqual([])
      expect(d.snapshot().points).toEqual([])
      expect(d.snapshot().loops).toEqual([])
    }
  })
})
