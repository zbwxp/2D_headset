// Where each state's shape comes from (headset-design doc 18 §20 v2, batch 2). STANDALONE, limited:
// one family of presets, one character, yaw tracks with arbitrary signed keys, one expression (closed eyes).
//
// - Evaluation CONTEXT: { yaw?: number }. No yaw = the drawing context: the ORIGINAL drawing if one exists,
//   else the curve is MISSING there (only registered / only drawn at some angle gives no original; dot).
//   With a yaw: the yaw track, interpolated and clamped outside its range (existing `pose.ts` offsetAt
//   rule); a curve without yaw keys stays at its original (Spine: no deform key = setup pose).
// - Each expression has its OWN sparse track (keys only at its own yaws). A key is a rule key (expression
//   base only) or an author target (base + correction); per §15 the base is the rule applied to the current
//   neutral shape at that yaw, and a character fix wins over blended preset corrections. The playback grid
//   RESAMPLES every track onto the union of yaws; resampled points are cache, never author keys, and never
//   run the rule again (dot 1791304345 counterexample).
// - Blending: a participant with non-zero weight that has no shape is REPORTED, never dropped with the
//   remaining weights renormalised (dot 1791304035).
// - Visibility is a separate stepped track (instant switch; fading deferred until bowen decides).
// The expression rule here is a STAND-IN (a linear squash toward y = 0), not a design choice.
import { v, type V } from './scenarioE'

export type Anchor = { p: V; hIn: V; hOut: V }
export type Shape = Record<string, Anchor>
export type YawKey = { yaw: number; shape: Shape }
export type ExprKey = { yaw: number; target?: Shape } // no target = rule key
export type PresetCurve = { original?: Shape; yaw: YawKey[]; closed: ExprKey[] }
export type Preset = Record<string, PresetCurve>
export type Character = { weights: Record<string, number>; closedFix: Record<string, Record<number, { target: Shape; base: Shape }>> }
export type Visibility = { yaw: number; visible: boolean }[]
export type Doc = { presets: Record<string, Preset>; character: Character; visibility: Record<string, Visibility> }
export type Eval = { ok: true; shape: Shape; source: string } | { ok: false; reason: string }

const map = (s: Shape, f: (q: V) => V): Shape => Object.fromEntries(Object.entries(s).map(([id, a]) => [id, { p: f(a.p), hIn: f(a.hIn), hOut: f(a.hOut) }]))
const zip = (a: Shape, b: Shape, f: (x: V, y: V) => V): Shape =>
  Object.fromEntries(Object.entries(a).map(([id, x]) => [id, { p: f(x.p, b[id].p), hIn: f(x.hIn, b[id].hIn), hOut: f(x.hOut, b[id].hOut) }]))
export const lerpShape = (a: Shape, b: Shape, t: number) => zip(a, b, (x, y) => v(x.x + (y.x - x.x) * t, x.y + (y.y - x.y) * t))
const add = (a: Shape, b: Shape) => zip(a, b, (x, y) => v(x.x + y.x, x.y + y.y))
const sub = (a: Shape, b: Shape) => zip(a, b, (x, y) => v(x.x - y.x, x.y - y.y))
const scale = (a: Shape, k: number) => map(a, (q) => v(q.x * k, q.y * k))
export const maxDiff = (a: Shape, b: Shape) => Math.max(...Object.keys(a).flatMap((id) => [a[id].p, a[id].hIn, a[id].hOut].map((q, i) => { const r = [b[id].p, b[id].hIn, b[id].hOut][i]; return Math.hypot(q.x - r.x, q.y - r.y) })))
/** stand-in expression rule: close by squashing toward y = 0 */
export const blinkRule = (s: Shape) => map(s, (q) => v(q.x, q.y * 0.1))

/** sample a sparse track at yaw: interpolate between keys, clamp outside (existing offsetAt rule) */
export function sample<T>(keys: { yaw: number }[], yaw: number, at: (i: number) => Shape): Shape {
  if (yaw <= keys[0].yaw) return at(0)
  const last = keys.length - 1
  if (yaw >= keys[last].yaw) return at(last)
  const i = keys.findIndex((k) => k.yaw >= yaw)
  if (keys[i].yaw === yaw) return at(i)
  return lerpShape(at(i - 1), at(i), (yaw - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw))
}

/** neutral shape of ONE preset's curve in a context */
export function presetOpen(pc: PresetCurve | undefined, ctx: { yaw?: number }): Eval {
  if (!pc) return { ok: false, reason: 'curve not in preset' }
  if (ctx.yaw === undefined) return pc.original ? { ok: true, shape: pc.original, source: 'original' } : { ok: false, reason: 'no original drawing (no-yaw context)' }
  if (pc.yaw.length) return { ok: true, shape: sample(pc.yaw, ctx.yaw, (i) => pc.yaw[i].shape), source: 'yaw track' }
  return pc.original ? { ok: true, shape: pc.original, source: 'original (no yaw keys)' } : { ok: false, reason: 'no yaw keys and no original' }
}

/** weighted blend; a non-zero participant without a shape is reported, never dropped */
function blend(doc: Doc, f: (p: Preset) => Eval): Eval {
  let acc: Shape | null = null
  const sources: string[] = []
  for (const [pid, w] of Object.entries(doc.character.weights)) {
    if (w === 0) continue
    const preset = doc.presets[pid]
    if (!preset) return { ok: false, reason: `preset ${pid} (weight ${w}): preset missing` } // reported, never thrown or dropped
    const r = f(preset)
    if (!r.ok) return { ok: false, reason: `preset ${pid} (weight ${w}): ${r.reason}` }
    acc = acc ? add(acc, scale(r.shape, w)) : scale(r.shape, w)
    sources.push(`${pid}:${r.source}`)
  }
  return acc ? { ok: true, shape: acc, source: sources.join(' + ') } : { ok: false, reason: 'no participant' }
}

export const characterOpen = (doc: Doc, curve: string, ctx: { yaw?: number }) => blend(doc, (p) => presetOpen(p[curve], ctx))

/** yaws of the character's closed track for a curve: the union of the presets' OWN closed key yaws and the
 *  character's fix yaws — never the neutral track's yaws */
export function closedKeyYaws(doc: Doc, curve: string): number[] {
  const ys = new Set<number>()
  for (const [pid, w] of Object.entries(doc.character.weights)) if (w !== 0) for (const k of doc.presets[pid]?.[curve]?.closed ?? []) ys.add(k.yaw)
  for (const y of Object.keys(doc.character.closedFix[curve] ?? {})) ys.add(Number(y))
  return [...ys].sort((a, b) => a - b)
}

/** one preset's closed correction at one of ITS closed keys: target − rule(preset neutral there); rule key → 0 */
function presetCorrection(pc: PresetCurve, yaw: number): Eval {
  const keys = pc.closed
  if (!keys.length) return { ok: false, reason: 'no closed keys' }
  const at = (i: number): Shape => {
    const o = presetOpen(pc, { yaw: keys[i].yaw })
    if (!o.ok) throw new Error(o.reason)
    const t = keys[i].target
    return t ? sub(t, blinkRule(o.shape)) : scale(o.shape, 0)
  }
  try {
    return { ok: true, shape: sample(keys, yaw, at), source: 'preset correction' }
  } catch (e) {
    return { ok: false, reason: String((e as Error).message) }
  }
}

/** character closed shape at one of the closed track's OWN keys (§15: base + correction, character fix first) */
export function closedAtKey(doc: Doc, curve: string, yaw: number): Eval {
  const open = characterOpen(doc, curve, { yaw })
  if (!open.ok) return open
  const base = blinkRule(open.shape)
  const fix = doc.character.closedFix[curve]?.[yaw]
  if (fix) return { ok: true, shape: add(base, sub(fix.target, fix.base)), source: 'rule + character fix' }
  const corr = blend(doc, (p) => presetCorrection(p[curve], yaw))
  if (!corr.ok) return corr
  return { ok: true, shape: add(base, corr.shape), source: 'rule + preset corrections' }
}

/** the closed track resampled at any yaw: interpolate between the track's own keys (no new rule run) */
export function closedAt(doc: Doc, curve: string, yaw: number): Eval {
  const ys = closedKeyYaws(doc, curve)
  if (!ys.length) return { ok: false, reason: 'no closed track' }
  const keys = ys.map((y) => ({ yaw: y }))
  try {
    const shape = sample(keys, yaw, (i) => {
      const r = closedAtKey(doc, curve, ys[i])
      if (!r.ok) throw new Error(r.reason)
      return r.shape
    })
    return { ok: true, shape, source: ys.includes(yaw) ? 'closed key' : 'closed track resampled' }
  } catch (e) {
    return { ok: false, reason: String((e as Error).message) }
  }
}

/** playback grid: union of neutral yaws and closed yaws; every cell is a resample of its own track */
export function grid(doc: Doc, curve: string) {
  const ys = new Set(closedKeyYaws(doc, curve))
  for (const [pid, w] of Object.entries(doc.character.weights)) if (w !== 0) for (const k of doc.presets[pid]?.[curve]?.yaw ?? []) ys.add(k.yaw)
  const yaws = [...ys].sort((a, b) => a - b)
  return yaws.map((yaw) => ({ yaw, open: characterOpen(doc, curve, { yaw }), closed: closedAt(doc, curve, yaw) }))
}

/** playback: bilinear in (yaw, blink) inside the grid cell; reads only the grid (no rule run) */
export function play(g: ReturnType<typeof grid>, yaw: number, blink: number): Shape {
  const keys = g.map((c) => ({ yaw: c.yaw }))
  const cell = (i: number) => {
    const o = g[i].open, c = g[i].closed
    if (!o.ok || !c.ok) throw new Error('grid cell missing')
    return lerpShape(o.shape, c.shape, blink)
  }
  return sample(keys, yaw, cell)
}

/** author inserts a neutral yaw key into a preset: the shape is the current evaluation there (picture unchanged) */
export function insertYawKey(doc: Doc, preset: string, curve: string, yaw: number): Doc {
  const d = structuredClone(doc)
  const pc = d.presets[preset][curve]
  const cur = presetOpen(pc, { yaw })
  if (!cur.ok) throw new Error(cur.reason)
  pc.yaw = [...pc.yaw.filter((k) => k.yaw !== yaw), { yaw, shape: cur.shape }].sort((a, b) => a.yaw - b.yaw)
  return d
}
export function deleteYawKey(doc: Doc, preset: string, curve: string, yaw: number): Doc {
  const d = structuredClone(doc)
  d.presets[preset][curve].yaw = d.presets[preset][curve].yaw.filter((k) => k.yaw !== yaw)
  return d
}
/** character hand-fix of the closed state at one of the closed track's keys: store full target + base then */
export function fixClosed(doc: Doc, curve: string, yaw: number, target: Shape): Doc {
  const d = structuredClone(doc)
  const open = characterOpen(d, curve, { yaw })
  if (!open.ok) throw new Error(open.reason)
  ;(d.character.closedFix[curve] ??= {})[yaw] = { target, base: blinkRule(open.shape) }
  return d
}
export function clearClosedFix(doc: Doc, curve: string): Doc {
  const d = structuredClone(doc)
  delete d.character.closedFix[curve]
  return d
}

/** stepped visibility (instant switch): the last key at or before yaw; before the first key, the first */
export function visibleAt(vis: Visibility | undefined, yaw: number): boolean {
  if (!vis?.length) return true
  let cur = vis[0].visible
  for (const k of vis) if (k.yaw <= yaw) cur = k.visible
  return cur
}

// ---------- fixture ----------
const A = (x: number, y: number, hx = 2, hy = 0): Anchor => ({ p: v(x, y), hIn: v(x - hx, y - hy), hOut: v(x + hx, y + hy) })
export function fixture(): Doc {
  const lid = (k: number, dx = 0): Shape => ({ a: A(-10 + dx, 0), m: A(dx, -4 * k, 4, 0.3 * k), b: A(10 + dx, 0) })
  return {
    presets: {
      P: {
        // original drawing + yaw keys at -60, 0, 90 (arbitrary signed); 0° key differs from the original
        lid: {
          original: lid(1),
          yaw: [{ yaw: -60, shape: lid(0.9, -4) }, { yaw: 0, shape: lid(1.1) }, { yaw: 90, shape: lid(0.7, 5) }],
          // closed track: author target at 0 (a corrected closed lid), rule key at 90
          closed: [{ yaw: 0, target: { a: A(-10, 0.5), m: A(0, 1.2, 4, 0), b: A(10, 0.5) } }, { yaw: 90 }],
        },
        brow: { original: lid(0.5), yaw: [], closed: [{ yaw: 0 }] }, // has an original, no yaw keys
        strand: { yaw: [{ yaw: 90, shape: lid(2, 3) }], closed: [] }, // only drawn at 90, no original
      },
      Q: {
        lid: { original: lid(1.3), yaw: [{ yaw: 0, shape: lid(1.4) }, { yaw: 45, shape: lid(1.2, 2) }], closed: [{ yaw: 45 }] },
        brow: { original: lid(0.6), yaw: [], closed: [{ yaw: 0 }] },
        // strand deliberately absent from Q
      },
    },
    character: { weights: { P: 0.6, Q: 0.4 }, closedFix: {} },
    visibility: { strand: [{ yaw: -90, visible: false }, { yaw: 30, visible: true }] },
  }
}
