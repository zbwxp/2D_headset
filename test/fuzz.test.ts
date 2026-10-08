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
  const layers = s.layers.map(l => l.id)
  const pos = (): Vec => ({ x: Math.round(r() * 40), y: Math.round(r() * 40) })
  const handle = (): Vec => ({ x: Math.round((r() - 0.5) * 20), y: Math.round((r() - 0.5) * 20) })
  const lines = s.lines, points = s.points
  // layer / element batch (docs/layer-batch-plan.md)
  if (r() < 0.15 || !layers.length) {
    const k = r(), layer = pick(layers) ?? '?', g = pick(s.groups), state = { [r() < 0.5 ? 'visible' : 'locked']: r() < 0.5 }
    if (k < 0.12 || !layers.length) { const id = next(); return { name: `layer ${id}`, run: e => e.layer(id, pick(['n1', 'n2', id])!) } }
    if (k < 0.24) { const l = pick(lines); return { name: `lineState ${l?.id}`, run: e => e.lineState(l?.id ?? '?', state) } }
    if (k < 0.34) return { name: `groupState ${g?.id}`, run: e => e.groupState(g?.id ?? '?', state) }
    if (k < 0.42) return { name: `layerState ${layer}`, run: e => e.layerState(layer, state) }
    if (k < 0.50) { const f = pick(s.loops.filter(x => x.color)); return { name: `fillState ${f?.id}`, run: e => e.fillState(f?.id ?? '?', state) } }
    if (k < 0.60) { const w = 1 + Math.floor(r() * 4); return { name: `stroke ${g?.id}`, run: e => e.stroke(g?.id ?? '?', { width: w, profile: 'uniform' }) } }
    if (k < 0.75) { const to = pick(layers)!; return { name: `moveGroup ${g?.id} ${to}`, run: e => e.moveGroup(g?.id ?? '?', to) } }
    if (k < 0.85) { const id = next(); return { name: `copyLayer ${layer} ${id}`, run: e => e.copyLayer(layer, id) } }
    if (k < 0.93) return { name: `deleteLayer ${layer}`, run: e => e.deleteLayer(layer) }
    return { name: `reorderLayer ${layer}`, run: e => e.reorderLayer(layer, Math.floor(r() * 3)) }
  }
  // apply (docs/editing-apply-plan.md, Phase A)
  if (r() < 0.06 && lines.length >= 2) {
    const k = r(), ids = lines.map(l => l.id)
    if (k < 0.4) {
      const size = 1 + Math.floor(r() * Math.min(3, Math.floor(ids.length / 2)))
      const shuffled = [...ids].sort(() => r() - 0.5), src = shuffled.slice(0, size), tgt = shuffled.slice(size, 2 * size)
      return { name: `mirrorApply ${size}`, run: e => e.mirrorApply(src, tgt) }
    }
    if (k < 0.8) { const a = pick(s.groups), b = pick(s.groups); return { name: `mirrorLink ${a?.id} ${b?.id}`, run: e => e.mirrorLink([a?.id ?? '?'], [b?.id ?? '?']) } }
    const l = pick(ids)!; return { name: `unmirror ${l}`, run: e => e.unmirror([l]) }
  }
  // editing (docs/editing-apply-plan.md, Phase E)
  if (r() < 0.12) {
    const k = r()
    if (k < 0.35) {
      const pool = [
        ...lines.map(l => ({ kind: 'line' as const, id: l.id })),
        ...points.map(p => ({ kind: 'point' as const, id: p.id })),
        ...lines.map(l => ({ kind: 'handle' as const, line: l.id, end: (r() < 0.5 ? 'a' : 'b') as 'a' | 'b' })),
        ...s.loops.filter(x => x.color).map(x => ({ kind: 'fill' as const, id: x.id })),
      ]
      const units = pool.filter(() => r() < 0.3), mode = pick(['replace', 'add', 'remove'] as const)!
      return { name: `select ${units.length}`, run: e => e.select(units, mode) }
    }
    if (k < 0.45) { const l = pick(lines); return { name: `selectGroup ${l?.id}`, run: e => e.selectGroup(l?.id ?? '?') } }
    if (k < 0.65) { const dx = Math.round((r() - 0.5) * 10), dy = Math.round((r() - 0.5) * 10); return { name: 'translate', run: e => e.translate(dx, dy) } }
    if (k < 0.75) { const c = pos(), a = (r() - 0.5) * 2; return { name: 'rotate', run: e => e.rotate(c, a) } }
    if (k < 0.85) { const c = pos(), f = 0.5 + r(); return { name: 'scale', run: e => e.scale(c, f, f) } }
    if (k < 0.92) return { name: 'flip', run: e => e.flip() }
    return { name: 'deleteSelection', run: e => e.deleteSelection() }
  }
  const roll = r()
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
  if (roll < 0.80 && s.links.length) {
    const k = pick(s.links)!, at = (p: string) => lines.filter(l => l.a === p || l.b === p).map(l => l.id)
    const la = pick(at(k.a)), lb = pick(at(k.b))
    return { name: `linkJoin ${k.a} ${k.b}`, run: e => e.linkJoin(k.a, k.b, la ?? '?', lb ?? '?', { mode: 'smooth' }) }
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
  for (const j of s.linkJoins) {
    const ends = (line: string, p: string) => { const l = lineById.get(line); return !!l && (l.a === p || l.b === p) }
    if (!s.links.some(k => (k.a === j.a && k.b === j.b) || (k.a === j.b && k.b === j.a))) bad.push(`link join ${j.a}-${j.b} without its link`)
    if (!ends(j.lines[0], j.a) || !ends(j.lines[1], j.b)) bad.push(`link join ${j.a}-${j.b} is stale`)
  }
  // Q31: no two endpoints in one layer coincide; Q30: layer names are unique
  const places = s.points.map(p => JSON.stringify([p.layer, p.position.x, p.position.y]))
  if (new Set(places).size !== places.length) bad.push('two endpoints coincide in one layer')
  if (new Set(s.layers.map(l => l.name)).size !== s.layers.length) bad.push('layer names repeat')
  for (const loop of s.loops) {
    const first = lineById.get(loop.route[0]?.line ?? '')
    if (first && loop.layer !== pointById.get(first.a)?.layer) bad.push(`loop ${loop.id} reports layer ${loop.layer}`)
  }
  for (const p of s.points) if (!s.layers.some(l => l.id === p.layer)) bad.push(`point ${p.id} in a missing layer`)
  // mirror pairs reference existing lines, and a line is in at most one pair
  const paired = s.mirrorPairs.flatMap(p => [p.a, p.b])
  for (const id of paired) if (!lineById.has(id)) bad.push(`mirror pair holds a missing line ${id}`)
  if (new Set(paired).size !== paired.length) bad.push('a line is in two mirror pairs')
  // the selection never points at something that no longer exists
  for (const u of s.selection) {
    const ok = u.kind === 'point' ? pointById.has(u.id) : u.kind === 'fill' ? s.fillOrder.includes(u.id) : lineById.has(u.kind === 'line' ? u.id : u.line)
    if (!ok) bad.push(`selection holds a missing ${u.kind}`)
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

/**
 * Q29: a published edit never changes a line that is locked in its result, and a
 * locked line never disappears. Checked independently of the locks module, on the
 * raw curve only (end positions, handles, stroke).
 */
function lockedKept(before: Snapshot, after: Snapshot): string[] {
  const at = (s: Snapshot, id: string) => s.points.find(p => p.id === id)?.position
  const raw = (s: Snapshot, x: Snapshot['lines'][number]) => JSON.stringify([at(s, x.a), at(s, x.b), x.ha, x.hb, x.stroke])
  const gone = before.lines.filter(l => l.state.locked && !after.lines.some(x => x.id === l.id)).map(l => `locked line ${l.id} disappeared`)
  return [...gone, ...after.lines.filter(l => l.state.locked).flatMap(m => {
    const l = before.lines.find(x => x.id === m.id)
    return !l || raw(before, l) === raw(after, m) ? [] : [`locked line ${m.id} changed`]
  })]
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
    let op = chooseOp(d.snapshot(), r, next)
    // Sometimes several operations in one edit, so later ones must read the draft as
    // it is now, not as it was published (dot 1791459521).
    if ('run' in op && r() < 0.2) {
      const ops = [op, chooseOp(d.snapshot(), r, next), chooseOp(d.snapshot(), r, next)].filter((x): x is Extract<Op, { run: unknown }> => 'run' in x)
      op = { name: 'batch ' + ops.map(x => x.name).join(' + '), run: e => { for (const x of ops) x.run(e) } }
    }
    const before = d.snapshot()
    try {
      stats.tried[op.name.split(' ')[0]!] = (stats.tried[op.name.split(' ')[0]!] ?? 0) + 1
      if (op.name === 'undo') d.undo()
      else if (op.name === 'redo') d.redo()
      else {
        d.edit((op as { run: (e: Editor) => void }).run)
        for (const f of lockedKept(before, d.snapshot())) failures.push(`seed ${seed} step ${i} (${op.name}): ${f}`)
      }
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
  }, 60000) // a long random run; the default 5 s limit is too tight on a busy machine (dot 1791431253)

  it('the same sequence always gives the same result', () => {
    for (const seed of seeds.slice(0, 10)) expect(run(seed, 60).trail).toEqual(run(seed, 60).trail)
  }, 60000)

  it('undoing everything returns to the starting state', () => {
    for (const seed of seeds.slice(0, 10)) {
      const { d } = run(seed, 60)
      while (d.canUndo) d.undo()
      expect(d.snapshot().lines).toEqual([])
      expect(d.snapshot().points).toEqual([])
      expect(d.snapshot().loops).toEqual([])
      expect(d.snapshot().selection).toEqual([])
    }
  }, 60000)
})
