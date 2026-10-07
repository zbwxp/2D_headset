// Stage 3a (doc 18 §24 v2 — the limited stage-3 contract): prepare a character once, play it read-only.
// prepare: §24.1 steps 1–8 → one grid per character (every family curve at every grid yaw, neutral and per
// expression parameter; visibility; shared-node checks). play: step 9 — bilinear in (yaw, expression) inside the
// grid; no helper domain is read, nothing is written.
// Expressions (doc 18 §27 / §29 I-1): a parameter NAMES its curves; at value 1 each such curve takes the author's
// keyframes (the presets' blended keyframes, or the character's own keyframe at a yaw where it has one) — no
// generation rule. A missing keyframe, or character neutral data an expression state would need carried over
// (fine-tune / line takeovers: I-2, not done), makes THAT parameter unplayable, reported; the rest still plays.
// Several parameters play together when their curves (closed over connections) are disjoint — two eyes.
// Scope (dot 1791312456 / 1791312539): fine-tune transfer only through helper domains at a preset's OWN key yaws
// (none needed without fine-tune); takeovers only on end-of-direction ranges 0 → θₜ; node takeovers only on single-
// connection nodes; one expression value (1) per parameter; visibility conflicts refused; weights must sum to 1.
import { fillCubics, fromPaint, IDENTITY, type Cubic, type EvalCurve, type Evaluated, type PaintInput } from './evaluate'
import { presetFormsIdOf } from './forms'
import { connectionsAtKeyed, helperDomainsOf, paramsOfFamily, visibilityOfCurve, type Queryable } from './indexes'
import type { AbsoluteYawKey, Affine, BaseReader, FillRecord, ReferenceRecord, CharacterRecord, ConnectionRecord, DocRecord, ExpressionParamRecord, FamilyRecord, FormsRecord, HelperDomainRecord, PresetRecord, Shape, Vec, VisibilityRecord } from './schema'

/**
 * What prepare reads: records by id, and keyed membership — helper domains of a preset, rules of a family,
 * visibility of a curve, connections at an anchor — through the store's incremental indexes when it has them (so
 * a change in another family never re-runs this character: dot, review of 819dd22), else by scanning.
 */
export type Ctx = {
  get: (id: string) => DocRecord | undefined
  helpersOf: (presetId: string) => string[]
  paramsOf: (familyId: string) => string[]
  visibilityOf: (curveId: string) => string[]
  connectionsAt: (anchorKey: string) => string[]
}
export function ctxOf(store: BaseReader & { query?: unknown }): Ctx {
  const q = store as Queryable
  return {
    get: (id) => store.get(id as any) as DocRecord | undefined,
    helpersOf: (p) => helperDomainsOf(q, p),
    paramsOf: (f) => paramsOfFamily(q, f),
    visibilityOf: (c) => visibilityOfCurve(q, c),
    connectionsAt: (k) => connectionsAtKeyed(q, k),
  }
}

export type CurveGrid = { neutral: Shape[]; expr: Record<string, Shape[]>; visible: { yaw: number; visible: boolean }[] | null }
export type CharacterGrid = {
  characterId: string
  yaws: number[]
  params: string[]
  /** the curves each parameter acts on (from its record), and the linked curve pairs (connections) */
  paramCurves: Record<string, string[]>
  links: [string, string][]
  /** parameters that cannot be played, with why (missing keyframes, I-2 transfer needed) */
  unplayable: Record<string, string[]>
  curves: Record<string, CurveGrid>
  front: Record<string, Shape | null>
  retained: number
}
export type Prepared = { ok: true; grid: CharacterGrid } | { ok: false; problems: string[] }

// ---------- shape arithmetic (absolute control points) ----------
type Pt = Shape[string]
const v = (x: number, y: number): Vec => ({ x, y })
const mapPt = (a: Pt, f: (q: Vec, h: 'p' | 'hIn' | 'hOut') => Vec): Pt => ({ p: f(a.p, 'p'), hIn: f(a.hIn, 'hIn'), hOut: f(a.hOut, 'hOut') })
const mapShape = (s: Shape, f: (q: Vec, a: string, h: 'p' | 'hIn' | 'hOut') => Vec): Shape => Object.fromEntries(Object.entries(s).map(([a, q]) => [a, mapPt(q, (x, h) => f(x, a, h))]))
const lerpShape = (a: Shape, b: Shape, t: number): Shape => mapShape(a, (q, k, h) => v(q.x + (b[k][h].x - q.x) * t, q.y + (b[k][h].y - q.y) * t))
const addShape = (a: Shape, b: Shape): Shape => mapShape(a, (q, k, h) => v(q.x + b[k][h].x, q.y + b[k][h].y))
const subShape = (a: Shape, b: Shape): Shape => mapShape(a, (q, k, h) => v(q.x - b[k][h].x, q.y - b[k][h].y))
const scaleShape = (a: Shape, w: number): Shape => mapShape(a, (q) => v(q.x * w, q.y * w))
type Mat2 = [number, number, number, number]
const applyL = (L: Mat2, q: Vec): Vec => v(L[0] * q.x + L[2] * q.y, L[1] * q.x + L[3] * q.y)
const transform = (L: Mat2, s: Shape): Shape => mapShape(s, (q) => applyL(L, q))
const zeroShape = (anchors: string[]): Shape => Object.fromEntries(anchors.map((a) => [a, { p: v(0, 0), hIn: v(0, 0), hOut: v(0, 0) }]))
/** sample a sparse track: interpolate between keys, clamp outside (the §20 rule) */
function sample<K extends { yaw: number }>(keys: K[], yaw: number, at: (k: K) => Shape): Shape {
  if (yaw <= keys[0].yaw) return at(keys[0])
  const last = keys[keys.length - 1]
  if (yaw >= last.yaw) return at(last)
  const i = keys.findIndex((k) => k.yaw >= yaw)
  if (keys[i].yaw === yaw) return at(keys[i])
  return lerpShape(at(keys[i - 1]), at(keys[i]), (yaw - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw))
}
const nonZero = (s: Shape) => Object.values(s).some((q) => [q.p, q.hIn, q.hOut].some((x) => x.x !== 0 || x.y !== 0))

export function prepareCharacter(ctx: Ctx, characterId: string, opts: { neutralOnly?: boolean; extraYaws?: number[] } = {}): Prepared {
  const problems: string[] = []
  const K = ctx.get(characterId) as CharacterRecord | undefined
  if (!K || K.typeName !== 'character') return { ok: false, problems: [`no character ${characterId}`] }
  const fam = ctx.get(K.familyId) as FamilyRecord | undefined
  if (!fam) return { ok: false, problems: [`no family ${K.familyId}`] }
  // a convex combination (dot 1791313635): finite, non-negative weights summing to 1 within float rounding only
  for (const [p, w] of Object.entries(K.weights)) if (!Number.isFinite(w) || w < 0) problems.push(`${K.id}: weight of ${p} is ${w} — weights must be finite and non-negative`)
  const parts = Object.entries(K.weights).filter(([, w]) => w !== 0)
  const sum = parts.reduce((s, [, w]) => s + w, 0)
  if (Math.abs(sum - 1) > 1e-9) problems.push(`${K.id}: the non-zero weights sum to ${sum}, not 1 (never renormalised)`)
  const anchorsOf = (c: string) => Object.keys((ctx.get(c) as { anchors: Record<string, unknown> }).anchors)
  const formsOf = (p: string, c: string) => ctx.get(presetFormsIdOf(p, c)) as FormsRecord | undefined
  const helperL = (p: string, yaw: number): Mat2 | undefined => {
    if (yaw === 0) return [1, 0, 0, 1]
    const h = ctx.helpersOf(p).map((id) => ctx.get(id) as HelperDomainRecord).find((x) => x.yaw === yaw)
    return h ? [h.affine.a, h.affine.b, h.affine.c, h.affine.d] : undefined
  }
  // the character's fine-tune of a curve as a full offset shape (missing anchors = 0), or null
  const fineOf = (c: string): Shape | null => {
    const ft = K.fineTune[c]
    if (!ft) return null
    const s = mapShape(zeroShape(anchorsOf(c)), (q, a, h) => (ft[a] ? (h === 'p' ? ft[a].dp : h === 'hIn' ? ft[a].dIn : ft[a].dOut) : q))
    return nonZero(s) ? s : null
  }

  // ---- step 2: each preset's OWN sparse track per curve (K + T(f) at its own key yaws) ----
  type Own = { keys: { yaw: number; shape: Shape }[] } | { static: Shape }
  const own: Record<string, Record<string, Own>> = {}
  const gridYaws = new Set<number>()
  for (const c of fam.curves) {
    own[c] = {}
    const f = fineOf(c)
    for (const [p] of parts) {
      const fm = formsOf(p, c)
      if (!fm || fm.encoding !== 'absolute') {
        problems.push(`${p} (weight ${K.weights[p]}) has no forms for ${c}`)
        continue
      }
      if (fm.yaw.length) {
        own[c][p] = {
          keys: (fm.yaw as AbsoluteYawKey[]).map((k) => {
            gridYaws.add(k.yaw)
            if (!f) return { yaw: k.yaw, shape: k.shape } // T(0) = 0: the drawn form, no basis needed
            const L = helperL(p, k.yaw)
            if (!L) {
              problems.push(`${p} has no helper domain at yaw ${k.yaw} to carry the fine-tune of ${c}`)
              return { yaw: k.yaw, shape: k.shape }
            }
            return { yaw: k.yaw, shape: addShape(k.shape, transform(L, f)) }
          }),
        }
      } else if (fm.original && fm.original !== 'curve') own[c][p] = { static: f ? addShape(fm.original, f) : fm.original }
      else problems.push(`${p} (weight ${K.weights[p]}) has no shape for ${c} (identity only): reported, never dropped`)
    }
  }
  // takeover, fix and expression key yaws are grid yaws too (one grid for the whole character)
  for (const t of K.takeovers) gridYaws.add(t.state.yaw), gridYaws.add(0)
  for (const y of opts.extraYaws ?? []) gridYaws.add(y)
  if (!opts.neutralOnly) {
    for (const x of K.exprFixes) gridYaws.add(x.yaw)
    for (const c of fam.curves) for (const [p] of parts) for (const keys of Object.values(formsOf(p, c)?.expr ?? {})) for (const k of keys) gridYaws.add(k.yaw)
  }
  if (!gridYaws.size) gridYaws.add(0)
  const yaws = [...gridYaws].sort((a, b) => a - b)
  if (problems.length) return { ok: false, problems }

  // ---- step 1 (only when needed): the front = Σ w · original + fine-tune ----
  const frontCache = new Map<string, Shape | null>()
  const frontOf = (c: string): Shape | null => {
    if (frontCache.has(c)) return frontCache.get(c)!
    let acc: Shape | null = null
    for (const [p, w] of parts) {
      const o = formsOf(p, c)?.original
      if (!o || o === 'curve') {
        frontCache.set(c, null)
        return null
      }
      acc = acc ? addShape(acc, scaleShape(o, w)) : scaleShape(o, w)
    }
    const f = fineOf(c)
    const r = acc && f ? addShape(acc, f) : acc
    frontCache.set(c, r)
    return r
  }

  // ---- step 3: character neutral on the grid (each own track resampled, then blended) ----
  const ownAt = (o: Own, yaw: number) => ('static' in o ? o.static : sample(o.keys, yaw, (k) => k.shape))
  const neutral: Record<string, Shape[]> = {}
  for (const c of fam.curves) neutral[c] = yaws.map((y) => parts.reduce<Shape | null>((acc, [p, w]) => (acc ? addShape(acc, scaleShape(ownAt(own[c][p], y), w)) : scaleShape(ownAt(own[c][p], y), w)), null)!)
  const normal = Object.fromEntries(Object.entries(neutral).map(([c, s]) => [c, [...s]])) // before takeovers: the node results

  // ---- takeover ranges: end of direction only, no overlap ----
  const sign = (y: number) => (y > 0 ? 1 : y < 0 ? -1 : 0)
  const end = (d: number) => (d > 0 ? yaws[yaws.length - 1] : yaws[0])
  const ranges = new Map<string, number>()
  for (const t of K.takeovers) {
    const th = t.state.yaw, d = sign(th)
    if (d === 0 || t.direction.from !== 0 || t.direction.to !== th) problems.push(`${t.id}: only ranges 0 → θₜ (θₜ ≠ 0) are supported`)
    else if (th !== end(d)) problems.push(`${t.id}: ends at ${th}, inside the ${d > 0 ? 'positive' : 'negative'} range (track goes to ${end(d)}) — refused, it would jump back to the old track`)
    const key = `${t.kind === 'line' ? t.curveId : t.connectionId}|${d}`
    if (ranges.has(key)) problems.push(`${t.id}: overlaps another takeover on the same ${t.kind === 'line' ? 'curve' : 'node'} and direction`)
    ranges.set(key, th)
  }
  if (problems.length) return { ok: false, problems }
  const inRange = (y: number, th: number) => sign(y) === sign(th) && Math.abs(y) <= Math.abs(th)

  // ---- step 4: line takeovers (frozen L; handles only, the shared ends are pinned in step 5) ----
  for (const t of K.takeovers) {
    if (t.kind !== 'line') continue
    const front = frontOf(t.curveId)
    if (!front) {
      problems.push(`${t.id}: the front of ${t.curveId} is needed (no original in a participant)`)
      continue
    }
    const L = t.L as Mat2
    const value = addShape(t.target, transform(L, subShape(front, t.basisFront)))
    const i0 = yaws.indexOf(0)
    const at0 = neutral[t.curveId][i0]
    neutral[t.curveId] = neutral[t.curveId].map((s, i) => (inRange(yaws[i], t.state.yaw) ? lerpShape(at0, value, yaws[i] / t.state.yaw) : s))
  }

  // ---- step 5: nodes — the normal (pre-takeover) result, or an explicit node takeover over its whole range ----
  const connIds = new Set(fam.curves.flatMap((c) => anchorsOf(c).flatMap((a) => ctx.connectionsAt(`${c}#${a}`))))
  const conns = [...connIds].sort().map((id) => ctx.get(id) as ConnectionRecord).filter((cn) => cn.ends.every((e) => fam.curves.includes(e.curveId)))
  for (const cn of conns) {
    const first = cn.ends[0]
    // every node takeover of this connection — one per direction (dot, review of 819dd22: only the first was used)
    const nodeTks = K.takeovers.filter((t) => t.kind === 'node' && t.connectionId === cn.id) as Extract<CharacterRecord['takeovers'][number], { kind: 'node' }>[]
    let nodeAt = (i: number) => normal[first.curveId][i][first.anchorId].p
    for (const nodeTk of nodeTks) {
      const front = frontOf(first.curveId)
      if (!front) {
        problems.push(`${nodeTk.id}: the front of ${first.curveId} is needed`)
        continue
      }
      const L = nodeTk.L as Mat2
      const d = applyL(L, v(front[first.anchorId].p.x - nodeTk.basisFront.x, front[first.anchorId].p.y - nodeTk.basisFront.y))
      const value = v(nodeTk.target.x + d.x, nodeTk.target.y + d.y)
      const i0 = yaws.indexOf(0)
      const n0 = normal[first.curveId][i0][first.anchorId].p
      const base = nodeAt
      nodeAt = (i) => (inRange(yaws[i], nodeTk.state.yaw) ? v(n0.x + (value.x - n0.x) * (yaws[i] / nodeTk.state.yaw), n0.y + (value.y - n0.y) * (yaws[i] / nodeTk.state.yaw)) : base(i))
    }
    // every end takes the node position; its handles move with it (no smoothing)
    for (const e of cn.ends)
      neutral[e.curveId] = neutral[e.curveId].map((s, i) => {
        const q = s[e.anchorId], n = nodeAt(i)
        const dx = n.x - q.p.x, dy = n.y - q.p.y
        return dx === 0 && dy === 0 ? s : { ...s, [e.anchorId]: { p: n, hIn: v(q.hIn.x + dx, q.hIn.y + dy), hOut: v(q.hOut.x + dx, q.hOut.y + dy) } }
      })
  }
  if (problems.length) return { ok: false, problems }

  const conns0 = [...new Set(fam.curves.flatMap((c) => anchorsOf(c).flatMap((a) => ctx.connectionsAt(`${c}#${a}`))))]
  const links = conns0.map((id) => ctx.get(id) as ConnectionRecord).filter((cn) => cn && cn.ends.every((e) => fam.curves.includes(e.curveId))).flatMap((cn) => cn.ends.slice(1).map((e) => [cn.ends[0].curveId, e.curveId] as [string, string]))
  if (opts.neutralOnly) {
    // the conversion of old files only needs the neutral grid (expressionMigration)
    const curves = Object.fromEntries(fam.curves.map((c) => [c, { neutral: neutral[c], expr: {}, visible: null }]))
    return { ok: true, grid: { characterId, yaws, params: [], paramCurves: {}, links, unplayable: {}, curves, front: {}, retained: 0 } }
  }

  // ---- step 6: expressions — the AUTHOR's keyframes (doc 18 §27 / §29 I-1; no generation rule) ----
  const eps = ctx.paramsOf(fam.id).map((id) => ctx.get(id) as ExpressionParamRecord).filter((x) => x?.typeName === 'expressionParam').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const expr: Record<string, Record<string, Shape[]>> = Object.fromEntries(fam.curves.map((c) => [c, {}]))
  const params: string[] = []
  const paramCurves: Record<string, string[]> = {}
  const unplayable: Record<string, string[]> = {}
  for (const ep of eps) {
    params.push(ep.name)
    paramCurves[ep.name] = [...ep.curves]
    const why: string[] = []
    for (const c of fam.curves) {
      if (!ep.curves.includes(c)) {
        expr[c][ep.name] = neutral[c] // a curve the parameter does not name keeps its neutral form
        continue
      }
      // the character's own keyframes win at their yaws; elsewhere the weighted presets' keyframes
      const fixes = K.exprFixes.filter((x) => x.curveId === c && x.param === ep.name)
      const tracks = parts.map(([p, w]) => ({ p, w, keys: formsOf(p, c)?.expr[ep.name] ?? [] }))
      const keyYaws = [...new Set([...fixes.map((x) => x.yaw), ...tracks.flatMap((t) => t.keys.map((k) => k.yaw))])].sort((a, b) => a - b)
      const needPresets = !keyYaws.length || keyYaws.some((y) => !fixes.some((x) => x.yaw === y))
      const lacking = tracks.filter((t) => !t.keys.length).map((t) => t.p)
      expr[c][ep.name] = neutral[c] // placeholder until computed (an unplayable parameter is never sampled)
      if (needPresets && lacking.length) {
        why.push(`missing ${ep.name} keyframes of ${c} in ${lacking.join(', ')} (drawn by the author, never generated)`)
        continue
      }
      // I-1 does not carry the character's own neutral data into expression states (that is I-2: domains / line
      // correspondence) — reported, never dropped silently (dot 1791342672)
      const nodeTk = K.takeovers.some((t) => t.kind === 'node' && (ctx.get(t.connectionId) as ConnectionRecord | undefined)?.ends.some((e) => e.curveId === c))
      if (needPresets && (fineOf(c) || nodeTk || K.takeovers.some((t) => t.kind === 'line' && t.curveId === c))) {
        why.push(`${c}: the character's fine-tune / takeovers would have to be carried into ${ep.name} (domain / line transfer, I-2 — not implemented yet)`)
        continue
      }
      const at = (y: number): Shape =>
        fixes.find((x) => x.yaw === y)?.shape ?? tracks.reduce<Shape | null>((acc, t) => (acc ? addShape(acc, scaleShape(sample(t.keys, y, (k) => k.shape), t.w)) : scaleShape(sample(t.keys, y, (k) => k.shape), t.w)), null)!
      const ks = keyYaws.map((y) => ({ yaw: y, shape: at(y) }))
      expr[c][ep.name] = yaws.map((y) => sample(ks, y, (k) => k.shape))
    }
    if (why.length) unplayable[ep.name] = why
  }

  // ---- step 7: visibility (presets must agree; stepped) ----
  const visibility: Record<string, CurveGrid['visible']> = {}
  for (const c of fam.curves) {
    const visRecs = ctx.visibilityOf(c).map((id) => ctx.get(id) as VisibilityRecord)
    const tracks = parts.map(([p]) => visRecs.find((r) => r.owner.kind === 'preset' && r.owner.id === p)?.keys ?? null)
    if (tracks.every((t) => !t)) {
      visibility[c] = null
      continue
    }
    const keyYs = [...new Set(tracks.flatMap((t) => (t ? t.map((k) => k.yaw) : [])))].sort((a, b) => a - b)
    const at = (t: { yaw: number; visible: boolean }[] | null, y: number) => (!t || !t.length ? true : (t.filter((k) => k.yaw <= y).pop() ?? t[0]).visible)
    const probe = [Number.NEGATIVE_INFINITY, ...keyYs]
    const bad = probe.find((y) => new Set(tracks.map((t) => at(t, y))).size > 1)
    if (bad !== undefined) problems.push(`${c}: presets disagree on visibility at yaw ${bad} — no blending rule (refused)`)
    // the agreed stepped track; a leading −∞ entry holds the value before the first key
    else visibility[c] = probe.map((y) => ({ yaw: y, visible: at(tracks[0], y) }))
  }

  // ---- step 8: shared nodes coincide in every cell (neutral and every expression) and in the front ----
  for (const cn of conns) {
    const fr = cn.ends.map((e) => frontOf(e.curveId)?.[e.anchorId].p)
    if (fr.every((q) => q) && fr.some((q) => q!.x !== fr[0]!.x || q!.y !== fr[0]!.y))
      problems.push(`${cn.id}: ends separate in the front (${fr.map((q) => `(${q!.x}, ${q!.y})`).join(' vs ')}) — the fine-tune moves one end only`)
  }
  for (const cn of conns)
    for (const [label, gridOf] of [['neutral', (c: string) => neutral[c]] as const, ...params.filter((p) => !unplayable[p]).map((p) => [`${p}`, (c: string) => expr[c][p]] as const)])
      for (let i = 0; i < yaws.length; i++) {
        const pts = cn.ends.map((e) => gridOf(e.curveId)[i][e.anchorId].p)
        if (pts.some((q) => q.x !== pts[0].x || q.y !== pts[0].y)) {
          problems.push(`${cn.id}: ends separate in ${label} at yaw ${yaws[i]} (${pts.map((q) => `(${q.x}, ${q.y})`).join(' vs ')}) — never averaged`)
          break
        }
      }
  if (problems.length) return { ok: false, problems }

  const curves: Record<string, CurveGrid> = Object.fromEntries(fam.curves.map((c) => [c, { neutral: neutral[c], expr: expr[c], visible: visibility[c] }]))
  const front = Object.fromEntries(fam.curves.map((c) => [c, frontOf(c)]))
  // the budget weight = the DISTINCT shape objects this grid actually retains (unchanged curves share their neutral
  // shapes with their expression lists; dot: count what is kept, not a formula)
  const kept = new Set<Shape>()
  for (const c of fam.curves) {
    for (const sh of neutral[c]) kept.add(sh)
    for (const list of Object.values(expr[c])) for (const sh of list) kept.add(sh)
    if (front[c]) kept.add(front[c]!)
  }
  const retained = kept.size
  return { ok: true, grid: { characterId, yaws, params, paramCurves, links, unplayable, curves, front, retained } }
}

/** The distinct shape objects a grid keeps (what the cache budget counts). */
export function retainedShapes(grid: CharacterGrid): unknown[] {
  const kept = new Set<unknown>()
  for (const g of Object.values(grid.curves)) {
    for (const sh of g.neutral) kept.add(sh)
    for (const list of Object.values(g.expr)) for (const sh of list) kept.add(sh)
  }
  for (const f of Object.values(grid.front)) if (f) kept.add(f)
  return [...kept]
}

/** the curves a parameter reads or writes: its own curves, closed over the links (connections) */
function reach(curves: string[], links: [string, string][]): Set<string> {
  const out = new Set(curves)
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

/**
 * Step 9: read-only playback — on the grid, bilinear in (yaw, value) per curve. Several parameters play together
 * when what they act on (closed over connections) is disjoint — each eye its own value; overlapping ones (a
 * multi-axis combination) are refused, as is an unplayable parameter with a non-zero value. No-yaw context = the
 * front, without expressions (kept apart from yaw 0).
 */
export function playCharacter(grid: CharacterGrid, at: { yaw?: number; params?: Record<string, number> }): { ok: true; shapes: Record<string, Shape>; visible: Record<string, boolean> } | { ok: false; problems: string[] } {
  const active = Object.entries(at.params ?? {}).filter(([, x]) => x !== 0)
  for (const [p, x] of active) {
    if (!grid.params.includes(p) || !(x >= 0 && x <= 1)) return { ok: false, problems: [`expression ${p} = ${x} is not playable`] }
    if (grid.unplayable[p]) return { ok: false, problems: [`${p} cannot be played: ${grid.unplayable[p].join('; ')}`] }
  }
  const reaches = active.map(([p]) => [p, reach(grid.paramCurves[p], grid.links)] as const)
  for (let i = 0; i < reaches.length; i++)
    for (let j = i + 1; j < reaches.length; j++)
      if ([...reaches[i][1]].some((c) => reaches[j][1].has(c)))
        return { ok: false, problems: [`${reaches[i][0]} and ${reaches[j][0]} act on the same curves (directly or through connections): combining them is not supported yet`] }
  if (at.yaw === undefined) {
    const missing = Object.entries(grid.front).filter(([, f]) => !f).map(([c]) => c)
    if (missing.length) return { ok: false, problems: [`the no-yaw context needs an original for every participating preset (${missing.join(', ')})`] }
    if (active.length) return { ok: false, problems: ['expressions in the no-yaw context are not supported'] }
    return { ok: true, shapes: grid.front as Record<string, Shape>, visible: Object.fromEntries(Object.keys(grid.curves).map((c) => [c, true])) }
  }
  const yaw = at.yaw
  const keys = grid.yaws.map((y, i) => ({ yaw: y, i }))
  const shapes: Record<string, Shape> = {}
  const visible: Record<string, boolean> = {}
  for (const [c, g] of Object.entries(grid.curves)) {
    const n = sample(keys, yaw, (k) => g.neutral[k.i])
    const on = active.find(([p]) => grid.paramCurves[p].includes(c))
    shapes[c] = on ? lerpShape(n, sample(keys, yaw, (k) => g.expr[on[0]][k.i]), on[1]) : n
    visible[c] = !g.visible ? true : (g.visible.filter((k) => k.yaw <= yaw).pop() ?? g.visible[0]).visible
  }
  return { ok: true, shapes, visible }
}

/**
 * The evaluated document seen as one character: family curves (and their reference instances, placed by the
 * reference transform) take the played shapes; fills re-read them (fillCubics); everything else is the normal
 * evaluation at that yaw (legacy curves keep their legacy tracks). Paint order unchanged.
 */
export function asCharacter(store: BaseReader, base: Evaluated, played: { shapes: Record<string, Shape>; visible: Record<string, boolean> }): Evaluated {
  const tp = (m: Affine, q: Vec): Vec => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f })
  const curves = new Map<string, EvalCurve>()
  for (const c of base.curves) {
    const shape = played.shapes[c.curveId]
    if (!shape) {
      curves.set(c.address, c)
      continue
    }
    const m = c.referenceId ? (store.get(c.referenceId as any) as ReferenceRecord).transform : IDENTITY
    const anchors = Object.fromEntries(Object.entries(shape).map(([id, q]) => [id, { id, p: tp(m, q.p), hIn: tp(m, q.hIn), hOut: tp(m, q.hOut) }]))
    const segments = c.segments.map((s) => ({ ...s, cubic: [anchors[s.from].p, anchors[s.from].hOut, anchors[s.to].hIn, anchors[s.to].p] as Cubic }))
    curves.set(c.address, { ...c, anchors, segments, visible: c.visible && played.visible[c.curveId] !== false })
  }
  const byBase = new Map([...curves.values()].filter((c) => !c.referenceId).map((c) => [c.curveId as string, c]))
  return fromPaint(
    base.paint.map((p): PaintInput =>
      p.kind === 'image'
        ? p // a reference image is not part of a character (doc 18 §31)
        : p.kind === 'curve'
          ? { kind: 'curve', item: curves.get(p.item.address)! }
          : { kind: 'fill', item: { ...p.item, cubics: fillCubics((store.get(p.item.address as any) as FillRecord).boundary, (id) => byBase.get(id)) } },
    ),
    base.maskDefs,
  )
}
