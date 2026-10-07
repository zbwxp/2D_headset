// Shared eye corner in the closed-eye state (doc 18 §26.2 v3 + dot 1791337766 four definitions) and two independent
// eyes (§26.3). STANDALONE oracle: plain data, no store, no product wiring; the product must later match it.
//
// Model (one eye): lower lid = the rule's SOURCE role, upper lid = its MOVED role (lidClose: upper anchor = copy of the
// corresponding lower anchor, `forms.ts:25`). The two corners are one linked point (a connection; doc 18 §26.5).
// Expression = one parameter at value 1 (blink); yaw keys are sparse; between keys interpolate, outside clamp (§20).
//
// Evaluation at a yaw (closed eye):
//   lower = N_lower + corr_lower                      (corr = target − base; character line fix, else Σw presets)
//   node  = if a character node fix: N_node + (target − base) REPLACES the corner's position correction (def. 1)
//   upper = shape interpolation between the upper track's own keys of [ rule(lower) + corr_upper ] — the rule runs
//           only at key yaws, never at sampling angles (§24 v2)
// Linked edits (§26.2 v3): the command gives FINAL targets; the common point comes from the given end; both given and
// different → refused; before editing, the union of the two tracks' key yaws is filled with the pre-edit full shapes.
import type { Shape } from '../schema'

export type P = { x: number; y: number }
export type Key = { yaw: number; target: Shape; base: Shape }
export type NeutralKey = { yaw: number; shape: Shape }
export type PresetEye = { neutral: { lower: NeutralKey[]; upper: NeutralKey[] }; expr: { lower: Key[]; upper: Key[] } }
export type NodeKey = { yaw: number; target: P; base: P }
export type CharacterEye = { weights: Record<string, number>; lineFix: { lower: Key[]; upper: Key[] }; nodeFix: NodeKey[] }
export type Eye = { presets: Record<string, PresetEye>; corr: Record<string, string>; corner: { upper: string; lower: string } }

// ---------- shape helpers ----------
const H = ['p', 'hIn', 'hOut'] as const
const map = (s: Shape, f: (q: P, a: string, h: (typeof H)[number]) => P): Shape =>
  Object.fromEntries(Object.keys(s).map((a) => [a, Object.fromEntries(H.map((h) => [h, f(s[a][h], a, h)]))])) as Shape
const zip = (a: Shape, b: Shape, f: (p: P, q: P) => P): Shape => map(a, (p, k, h) => f(p, b[k][h]))
export const addS = (a: Shape, b: Shape) => zip(a, b, (p, q) => ({ x: p.x + q.x, y: p.y + q.y }))
export const subS = (a: Shape, b: Shape) => zip(a, b, (p, q) => ({ x: p.x - q.x, y: p.y - q.y }))
const scale = (a: Shape, k: number) => map(a, (p) => ({ x: p.x * k, y: p.y * k }))
const lerpS = (a: Shape, b: Shape, t: number) => zip(a, b, (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }))
const zeroLike = (s: Shape) => map(s, () => ({ x: 0, y: 0 }))
/** move one anchor to `to`; its handles keep their offsets */
export const moveAnchor = (s: Shape, a: string, to: P): Shape => {
  const q = s[a], dx = to.x - q.p.x, dy = to.y - q.p.y
  return { ...s, [a]: { p: { ...to }, hIn: { x: q.hIn.x + dx, y: q.hIn.y + dy }, hOut: { x: q.hOut.x + dx, y: q.hOut.y + dy } } }
}
/** sparse track sampling: exact at keys, linear between, clamped outside */
export function sampleBy<K extends { yaw: number }, T>(keys: K[], yaw: number, at: (k: K) => T, lerp: (a: T, b: T, t: number) => T): T | null {
  const ks = [...keys].sort((a, b) => a.yaw - b.yaw)
  if (!ks.length) return null
  if (yaw <= ks[0].yaw) return at(ks[0])
  if (yaw >= ks[ks.length - 1].yaw) return at(ks[ks.length - 1])
  const i = ks.findIndex((k) => k.yaw >= yaw)
  if (ks[i].yaw === yaw) return at(ks[i])
  return lerp(at(ks[i - 1]), at(ks[i]), (yaw - ks[i - 1].yaw) / (ks[i].yaw - ks[i - 1].yaw))
}
const sampleShape = <K extends { yaw: number }>(keys: K[], yaw: number, at: (k: K) => Shape) => sampleBy(keys, yaw, at, lerpS)
const lerpP = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const rule = (eye: Eye, lower: Shape): Shape => Object.fromEntries(Object.entries(eye.corr).map(([u, l]) => [u, structuredClone(lower[l])])) as Shape

// ---------- one preset alone (the author's view) ----------
export const presetNeutral = (pe: PresetEye, side: 'lower' | 'upper', yaw: number) => sampleShape(pe.neutral[side], yaw, (k) => k.shape)!
const corrOfKeys = (keys: Key[], yaw: number) => sampleShape(keys, yaw, (k) => subS(k.target, k.base))
export function presetLower(pe: PresetEye, yaw: number): Shape {
  const n = presetNeutral(pe, 'lower', yaw)
  return addS(n, corrOfKeys(pe.expr.lower, yaw) ?? zeroLike(n))
}
export function presetUpper(eye: Eye, pe: PresetEye, yaw: number): Shape {
  const keys = pe.expr.upper
  if (!keys.length) return rule(eye, presetLower(pe, yaw))
  return sampleShape(keys, yaw, (k) => addS(rule(eye, presetLower(pe, k.yaw)), subS(k.target, k.base)))!
}

// ---------- a character (weights, line fixes, node fix) ----------
export function characterNeutral(eye: Eye, ch: CharacterEye, side: 'lower' | 'upper', yaw: number): Shape {
  const parts = Object.entries(ch.weights).filter(([, w]) => w !== 0)
  return parts.reduce<Shape | null>((acc, [p, w]) => {
    const s = scale(presetNeutral(eye.presets[p], side, yaw), w)
    return acc ? addS(acc, s) : s
  }, null)!
}
/** one source per side (def. 2): the character's line fix if it has one, else the weighted presets' corrections */
function corrSide(eye: Eye, ch: CharacterEye, side: 'lower' | 'upper', yaw: number, zero: Shape): Shape {
  if (ch.lineFix[side].length) return corrOfKeys(ch.lineFix[side], yaw)!
  return Object.entries(ch.weights).reduce((acc, [p, w]) => addS(acc, scale(corrOfKeys(eye.presets[p].expr[side], yaw) ?? zero, w)), zero)
}
export function characterLower(eye: Eye, ch: CharacterEye, yaw: number): Shape {
  const n = characterNeutral(eye, ch, 'lower', yaw)
  let s = addS(n, corrSide(eye, ch, 'lower', yaw, zeroLike(n)))
  // def. 1: a node fix REPLACES the corner's position correction: node = neutral corner + (target − base)
  const d = sampleBy(ch.nodeFix, yaw, (k) => ({ x: k.target.x - k.base.x, y: k.target.y - k.base.y }), lerpP)
  if (d) s = moveAnchor(s, eye.corner.lower, { x: n[eye.corner.lower].p.x + d.x, y: n[eye.corner.lower].p.y + d.y })
  return s
}
/** the upper track's key yaws: the character's own fix keys, else the union of the weighted presets' keys */
const upperKeyYaws = (eye: Eye, ch: CharacterEye) =>
  ch.lineFix.upper.length ? ch.lineFix.upper.map((k) => k.yaw) : [...new Set(Object.entries(ch.weights).filter(([, w]) => w).flatMap(([p]) => eye.presets[p].expr.upper.map((k) => k.yaw)))]
export function characterUpper(eye: Eye, ch: CharacterEye, yaw: number): Shape {
  const ys = upperKeyYaws(eye, ch).map((y) => ({ yaw: y }))
  const at = (y: number) => {
    const low = characterLower(eye, ch, y)
    const r = rule(eye, low)
    return addS(r, corrSide(eye, ch, 'upper', y, zeroLike(r)))
  }
  if (!ys.length) return at(yaw)
  return sampleShape(ys, yaw, (k) => at(k.yaw))!
}
export const cornerGap = (eye: Eye, lower: Shape, upper: Shape) => {
  const a = lower[eye.corner.lower].p, b = upper[eye.corner.upper].p
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ---------- linked edit: preset author (setPresetKey in the expression state) ----------
export type Refusal = { ok: false; reason: string }
export type Given = { lower?: Shape; upper?: Shape }
/** fill the union of both tracks' key yaws (plus `extra`) with the pre-edit FULL displayed shapes; nothing changes */
export function fillUnion(eye: Eye, pe: PresetEye, extra: number[] = []): PresetEye {
  const ys = [...new Set([...pe.expr.lower, ...pe.expr.upper].map((k) => k.yaw).concat(extra))].sort((a, b) => a - b)
  const lower = [...pe.expr.lower], upper = [...pe.expr.upper]
  for (const y of ys) {
    if (!lower.some((k) => k.yaw === y)) lower.push({ yaw: y, target: presetLower(pe, y), base: presetNeutral(pe, 'lower', y) })
    if (!upper.some((k) => k.yaw === y)) upper.push({ yaw: y, target: presetUpper(eye, pe, y), base: rule(eye, presetLower(pe, y)) })
  }
  const byYaw = (a: Key, b: Key) => a.yaw - b.yaw
  return { ...pe, expr: { lower: lower.sort(byYaw), upper: upper.sort(byYaw) } }
}
export function presetLinkedEdit(eye: Eye, presetId: string, yaw: number, given: Given): { ok: true; eye: Eye } | Refusal {
  const pe0 = eye.presets[presetId]
  if (!given.lower && !given.upper) return { ok: false, reason: 'nothing given' }
  // 1. the common point, uniquely from the given end(s)
  const cl = given.lower?.[eye.corner.lower].p, cu = given.upper?.[eye.corner.upper].p
  if (cl && cu && (cl.x !== cu.x || cl.y !== cu.y)) return { ok: false, reason: `the two given corners differ (${cl.x}, ${cl.y}) vs (${cu.x}, ${cu.y}): one shared point` }
  const c = (cl ?? cu)!
  // fill the key-yaw union first (the edit yaw included). The fill keeps the pre-edit display EXACTLY — so it cannot
  // close a split that already exists (finding, see tests: a neutral key with no moved-role key at its yaw)
  const pe = fillUnion(eye, pe0, [yaw])
  // 2. lower: given, or the pre-edit display with the corner moved to the common point
  const lowerTarget = given.lower ?? moveAnchor(presetLower(pe, yaw), eye.corner.lower, c)
  const lower = pe.expr.lower.map((k) => (k.yaw === yaw ? { yaw, target: lowerTarget, base: presetNeutral(pe, 'lower', yaw) } : k))
  // 3. upper: base = rule(this edit's FINAL lower); given → its target as is (its corner is the common point)
  const upperBase = rule(eye, lowerTarget)
  const upper = given.upper ? pe.expr.upper.map((k) => (k.yaw === yaw ? { yaw, target: given.upper!, base: upperBase } : k)) : pe.expr.upper
  return { ok: true, eye: { ...eye, presets: { ...eye.presets, [presetId]: { ...pe, expr: { lower, upper } } } } }
}

// ---------- linked edit: character (fixExpression) ----------
/** corner only → a node fix (full target + fixed base = the character's NEUTRAL corner at that yaw; def. 1);
 *  whole lines → line fixes; a line target that disagrees with an existing node target → refused unless `replace` */
export function characterCornerFix(eye: Eye, ch: CharacterEye, yaw: number, target: P): CharacterEye {
  const base = characterNeutral(eye, ch, 'lower', yaw)[eye.corner.lower].p
  return { ...ch, nodeFix: [...ch.nodeFix.filter((k) => k.yaw !== yaw), { yaw, target: { ...target }, base: { ...base } }].sort((a, b) => a.yaw - b.yaw) }
}
export function characterLineFix(eye: Eye, ch: CharacterEye, yaw: number, given: { lower: Shape; upper: Shape }, opts: { replace?: boolean } = {}): { ok: true; ch: CharacterEye } | Refusal {
  const cl = given.lower[eye.corner.lower].p, cu = given.upper[eye.corner.upper].p
  if (cl.x !== cu.x || cl.y !== cu.y) return { ok: false, reason: 'the two given corners differ: one shared point' }
  if (ch.nodeFix.length && !opts.replace) {
    const at = characterLower(eye, ch, yaw)[eye.corner.lower].p
    if (at.x !== cl.x || at.y !== cl.y) return { ok: false, reason: 'a node fix holds this corner at another position: clear it or replace it explicitly' }
  }
  const nl = characterNeutral(eye, ch, 'lower', yaw)
  const lower = [...ch.lineFix.lower.filter((k) => k.yaw !== yaw), { yaw, target: given.lower, base: nl }]
  const upper = [...ch.lineFix.upper.filter((k) => k.yaw !== yaw), { yaw, target: given.upper, base: rule(eye, given.lower) }]
  // `replace` clears the whole node track (its other keys would still interpolate / clamp onto this yaw)
  return { ok: true, ch: { ...ch, lineFix: { lower, upper }, nodeFix: opts.replace ? [] : ch.nodeFix } }
}
export const clearNodeFix = (ch: CharacterEye): CharacterEye => ({ ...ch, nodeFix: [] })

// ---------- §26.3 two independent eyes: read/write dependencies ----------
/** curves a parameter reads or writes: moved + source roles, plus every curve reached through links (transitively) */
export function dependencies(param: { moved: string; source: string }, links: [string, string][]): Set<string> {
  const out = new Set([param.moved, param.source])
  for (let grew = true; grew; ) {
    grew = false
    for (const [a, b] of links)
      if (out.has(a) !== out.has(b)) {
        out.add(a)
        out.add(b)
        grew = true
      }
  }
  return out
}
export function independent(params: { moved: string; source: string }[], links: [string, string][]): boolean {
  const seen = new Set<string>()
  for (const p of params) {
    const d = dependencies(p, links)
    for (const c of d) if (seen.has(c)) return false
    for (const c of d) seen.add(c)
  }
  return true
}
