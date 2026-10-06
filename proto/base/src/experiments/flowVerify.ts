// Flow verification (headset-design doc 18 §16, design fixed at §15 `1b6e90b`). STANDALONE: not wired
// into the product store, transactions or UI. Undo and save/reopen are verified at the EXPERIMENT DATA
// level only (snapshots, JSON round trip); the product transaction chain is verified separately.
//
// Saved data, three blocks (§15.1):
//   A presets   — author key forms per state (yaw × expression), full control points
//   B basis     — helper domain per preset at 90° (affine here), blink rule + version
//   C character — preset weights, front fine-tune (control-point offsets), hand-fix takeover records
// Everything a character evaluates to is a rebuildable cache, never written back to A (§15.1).
// Two entry points (§15.3): rebuild (on edits) and playback (read + interpolate only).
import { curveIds, fitLinear, frontEye, type CurveId, type Cubic, type Eye, type Mat2 } from './fineTuneTransfer'
import { v, type V } from './scenarioE'

export type Yaw = 0 | 90
export type Expr = 'open' | 'closed'
export type StateKey = `${Yaw}|${Expr}`
export const STATES: StateKey[] = ['0|open', '90|open', '0|closed', '90|closed']
export type Affine = { m: Mat2; t: V }

export type Preset = { id: string; keys: Partial<Record<StateKey, Eye>> } // open states required; closed optional (author target)
export type AngleTakeover = { kind: 'angle'; state: '90|open'; curve: CurveId; range: [0, 90]; target: Cubic; basisFront: Cubic }
export type ExprFix = { kind: 'expression'; state: `${Yaw}|closed`; target: Eye; base: Eye }
export type Character = { weights: Record<string, number>; fineTune: Eye; takeovers: AngleTakeover[]; exprFixes: ExprFix[] }
export type Doc = {
  presets: Record<string, Preset>
  basis: { domains90: Record<string, Affine>; ruleVersion: 1 }
  characters: Record<string, Character>
}
export type Cache = Record<StateKey, Eye>

// ---------- small helpers ----------
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y)
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y)
const mul = (a: V, k: number): V => v(a.x * k, a.y * k)
const applyM = (m: Mat2, p: V): V => v(m[0] * p.x + m[2] * p.y, m[1] * p.x + m[3] * p.y)
const mapEye = (e: Eye, f: (p: V, id: CurveId, i: number) => V): Eye => Object.fromEntries(curveIds.map((id) => [id, e[id].map((p, i) => f(p, id, i))])) as Eye
const zipEye = (a: Eye, b: Eye, f: (p: V, q: V) => V): Eye => mapEye(a, (p, id, i) => f(p, b[id][i]))
export const zeroEye = (): Eye => mapEye(frontEye(), () => v(0, 0))

/** counters, so playback can be checked for not running generation rules or reading domains */
export const counters = { ruleRuns: 0, domainReads: 0 }

/** Blink rule (version 1): the upper lid's control points go onto the lower lid's (§10.3d, doc 17). */
export function blinkRule(open: Eye): Eye {
  counters.ruleRuns++
  return { ...open, U0: open.L0.map((p) => ({ ...p })) as Cubic, U1: open.L1.map((p) => ({ ...p })) as Cubic }
}

function domainLinear(doc: Doc, preset: string): Mat2 {
  counters.domainReads++
  return doc.basis.domains90[preset].m
}

// ---------- entry 1: rebuild (§15.3, v4 order) ----------
export function rebuild(doc: Doc, charId: string): Cache {
  const ch = doc.characters[charId]
  const ids = Object.keys(ch.weights)
  const blend = (state: StateKey) => {
    let e = zeroEye()
    for (const id of ids) e = zipEye(e, doc.presets[id].keys[state]!, (p, q) => add(p, mul(q, ch.weights[id])))
    return e
  }
  // 1. front = Σ w P(0) + f
  const front = zipEye(blend('0|open'), ch.fineTune, add)
  // 2. 90° = Σ w (P(90) + T_i(f)); T_i = the linear part of preset i's own helper domain (affine)
  let side = zeroEye()
  for (const id of ids) {
    const L = domainLinear(doc, id)
    const k = doc.presets[id].keys['90|open']!
    side = zipEye(side, mapEye(k, (p, c, i) => add(p, applyM(L, ch.fineTune[c][i]))), (s, q) => add(s, mul(q, ch.weights[id])))
  }
  // 3. angle takeovers (before expressions): target + L_fixed · (front now − front at takeover)
  for (const t of ch.takeovers) {
    const { L } = fitLinear(t.basisFront, t.target)
    side = { ...side, [t.curve]: t.target.map((q, i) => add(q, applyM(L, sub(front[t.curve][i], t.basisFront[i])))) as Cubic }
  }
  const open: Record<Yaw, Eye> = { 0: front, 90: side }
  // 4. expression states: same-state base generation + correction (character fix first, else preset corrections)
  const closed = {} as Record<Yaw, Eye>
  for (const yaw of [0, 90] as Yaw[]) {
    const state = `${yaw}|closed` as const
    const base = blinkRule(open[yaw])
    const fix = ch.exprFixes.find((f) => f.state === state)
    let corr = zeroEye()
    if (fix) corr = zipEye(fix.target, fix.base, sub)
    else
      for (const id of ids) {
        const target = doc.presets[id].keys[state]
        if (!target) continue // a preset without an author target contributes 0
        const presetBase = blinkRule(doc.presets[id].keys[`${yaw}|open`]!)
        corr = zipEye(corr, zipEye(target, presetBase, sub), (c, d) => add(c, mul(d, ch.weights[id])))
      }
    closed[yaw] = zipEye(base, corr, add)
  }
  return { '0|open': open[0], '90|open': open[90], '0|closed': closed[0], '90|closed': closed[90] }
}

// ---------- entry 2: playback (§15.3) — reads and interpolates only ----------
// Interpolation rule (stated for independent hand calculation, dot 1791300051): bilinear over the four key
// states. t = clamp(yaw / 90, 0, 1); open(yaw) = (1−t)·K(0|open) + t·K(90|open); closed(yaw) likewise;
// result = (1−blink)·open(yaw) + blink·closed(yaw), per control point.
export function playback(cache: Cache, yaw: number, blink: number): Eye {
  const t = Math.max(0, Math.min(1, yaw / 90))
  const lerp = (a: Eye, b: Eye, k: number) => zipEye(a, b, (p, q) => add(p, mul(sub(q, p), k)))
  const open = lerp(cache['0|open'], cache['90|open'], t)
  const shut = lerp(cache['0|closed'], cache['90|closed'], t)
  return lerp(open, shut, blink)
}

// ---------- edits with undo (experiment data level: whole-document snapshots) ----------
export class Session {
  private undoStack: Doc[] = []
  private redoStack: Doc[] = []
  constructor(public doc: Doc) {}
  private commit(next: Doc) {
    this.undoStack.push(this.doc)
    this.redoStack = []
    this.doc = next
  }
  undo() {
    const prev = this.undoStack.pop()
    if (!prev) return false
    this.redoStack.push(this.doc)
    this.doc = prev
    return true
  }
  redo() {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(this.doc)
    this.doc = next
    return true
  }
  setFineTune(ch: string, fineTune: Eye) {
    const d = structuredClone(this.doc)
    d.characters[ch].fineTune = structuredClone(fineTune)
    this.commit(d)
  }
  setWeights(ch: string, weights: Record<string, number>) {
    const d = structuredClone(this.doc)
    d.characters[ch].weights = { ...weights }
    this.commit(d)
  }
  /** a hand fix of one curve at 90° (angle state): takeover with the fixed basis of that moment */
  fixAngle(ch: string, curve: CurveId, target: Cubic) {
    const cache = rebuild(this.doc, ch)
    const d = structuredClone(this.doc)
    d.characters[ch].takeovers = [...d.characters[ch].takeovers.filter((t) => t.curve !== curve), { kind: 'angle', state: '90|open', curve, range: [0, 90], target: structuredClone(target), basisFront: structuredClone(cache['0|open'][curve]) }]
    this.commit(d)
  }
  /** a hand fix of a closed (expression) state: full target + the same-state base of that moment */
  fixExpression(ch: string, yaw: Yaw, target: Eye) {
    const cache = rebuild(this.doc, ch)
    const state = `${yaw}|closed` as const
    const base = blinkRule(cache[`${yaw}|open`])
    const d = structuredClone(this.doc)
    d.characters[ch].exprFixes = [...d.characters[ch].exprFixes.filter((f) => f.state !== state), { kind: 'expression', state, target: structuredClone(target), base }]
    this.commit(d)
  }
  save(): string {
    return JSON.stringify(this.doc)
  }
  static reopen(json: string) {
    return new Session(JSON.parse(json) as Doc)
  }
}

// ---------- synthetic inputs (§16.1) ----------
export const AFFINE_A: Affine = { m: [0.45, -0.08, 0.15, 0.95], t: v(2, 0) }
export const AFFINE_B: Affine = { m: [0.35, 0.05, 0.1, 1.05], t: v(1.5, 0.5) }
const applyA = (a: Affine, p: V): V => add(applyM(a.m, p), a.t)

export function makeDoc(): Doc {
  const base = frontEye()
  // preset B: preset A after one domain edit (taller eye), so the two match point for point
  const bFront = mapEye(base, (p) => v(p.x, 1.3 * p.y))
  const aClosed0 = blinkRule(base)
  // A's author closed-eye target at yaw 0: the eye tail (right end of BOTH lids) lifted together, so closure holds by construction
  const lift = (e: Eye, d: V): Eye => ({ ...e, U1: e.U1.map((p, i) => (i >= 2 ? add(p, d) : p)) as Cubic, L1: e.L1.map((p, i) => (i >= 2 ? add(p, d) : p)) as Cubic })
  const presets: Record<string, Preset> = {
    A: { id: 'A', keys: { '0|open': base, '90|open': mapEye(base, (p) => applyA(AFFINE_A, p)), '0|closed': lift(aClosed0, v(0, -0.6)) } },
    B: { id: 'B', keys: { '0|open': bFront, '90|open': mapEye(bFront, (p) => applyA(AFFINE_B, p)) } },
  }
  counters.ruleRuns = 0
  const fine = mapEye(zeroEye(), (p, id, i) => ((id === 'U0' && i === 3) || (id === 'U0' && i === 2) || (id === 'U1' && i <= 1) ? v(0, -1.2) : p))
  return {
    presets,
    basis: { domains90: { A: AFFINE_A, B: AFFINE_B }, ruleVersion: 1 },
    characters: {
      c1: { weights: { A: 0.5, B: 0.5 }, fineTune: zeroEye(), takeovers: [], exprFixes: [] },
      untouched: { weights: { A: 0.3, B: 0.7 }, fineTune: fine, takeovers: [], exprFixes: [] },
    },
  }
}
/** the fine-tune used in steps 2 / 4: upper-lid middle raised (anchor and handles) */
export const fineTuneUp = (k: number): Eye => mapEye(zeroEye(), (p, id, i) => ((id === 'U0' && i >= 2) || (id === 'U1' && i <= 1) ? v(0, -k) : p))
/** the fine-tune used in step 6 (dot 1791300051): upper-lid middle raised AND lower-lid middle lowered, so the
 *  blink rule's same-state base (upper copied onto lower) actually changes and 'new base + correction' is tested */
export const fineTuneUpAndLower = (up: number, down: number): Eye =>
  mapEye(zeroEye(), (p, id, i) => ((id === 'U0' && i >= 2) || (id === 'U1' && i <= 1) ? v(0, -up) : (id === 'L0' && i >= 2) || (id === 'L1' && i <= 1) ? v(0, down) : p))
