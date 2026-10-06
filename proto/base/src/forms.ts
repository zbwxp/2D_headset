// Stage 1 (doc 18 §23.2; samples/stage1-archive.md v4.1): the preset-level reading of the new records and the
// relation rules that make a saved archive valid. LIMITED: this reads PRESET forms only (original, yaw keys,
// expression keys with their rule) — enough to check an archive; the character rebuild (weights, fine-tune
// transfer, takeovers) and playback are stage 3 and are NOT here.
import { connectionsAt } from './indexes'
import { Forms, type BaseReader, type CharacterRecord, type ConnectionRecord, type CurveRecord, type DocRecord, type FamilyRecord, type FormsRecord, type PresetRecord, type RuleRecord, type Shape, type AbsoluteYawKey, type ExprKey } from './schema'

export type Problem = { object: string; field: string; target: string; message: string }
type Get = Pick<BaseReader, 'get'> & Partial<Pick<BaseReader, 'allRecords'>>

/** The forms record of one preset for one curve (every preset has one per family curve). */
export const presetFormsIdOf = (presetId: string, curveId: string) => Forms.createId(`${presetId}/${curveId}`)

const as = <T extends DocRecord['typeName']>(store: Get, id: unknown, type: T) => {
  const r = typeof id === 'string' ? (store.get(id as any) as DocRecord | undefined) : undefined
  return r?.typeName === type ? (r as Extract<DocRecord, { typeName: T }>) : undefined
}

// ---------- rules (a registry: a rule kind is a fixed, versioned function) ----------
/** `apply` returns null when the correspondence names an anchor the source lacks (reported by the rule record's check). */
type RuleImpl = { versions: number[]; moved: string; source: string; apply: (source: Shape, correspondence: Record<string, string>) => Shape | null }
const copy = (a: Shape[string]) => ({ p: { ...a.p }, hIn: { ...a.hIn }, hOut: { ...a.hOut } })
export const RULES: Record<string, RuleImpl> = {
  /** close the eye: every anchor of the upper lid takes the corresponding lower-lid anchor (v1). */
  lidClose: { versions: [1], moved: 'upper', source: 'lower', apply: (lower, corr) => (Object.values(corr).every((l) => lower[l]) ? Object.fromEntries(Object.entries(corr).map(([u, l]) => [u, copy(lower[l])])) : null) },
}

// ---------- preset-level evaluation (same sampling rule as §20: interpolate, clamp outside) ----------
const lerpShape = (a: Shape, b: Shape, t: number): Shape =>
  Object.fromEntries(
    Object.keys(a).map((k) => {
      const l = (h: 'p' | 'hIn' | 'hOut') => ({ x: a[k][h].x + (b[k][h].x - a[k][h].x) * t, y: a[k][h].y + (b[k][h].y - a[k][h].y) * t })
      return [k, { p: l('p'), hIn: l('hIn'), hOut: l('hOut') }]
    }),
  )
const addDiff = (s: Shape, target: Shape, base: Shape): Shape =>
  Object.fromEntries(Object.keys(s).map((k) => [k, Object.fromEntries((['p', 'hIn', 'hOut'] as const).map((h) => [h, { x: s[k][h].x + (target[k][h].x - base[k][h].x), y: s[k][h].y + (target[k][h].y - base[k][h].y) }]))])) as Shape
export function sample<K extends { yaw: number }>(keys: K[], yaw: number, at: (k: K) => Shape | null): Shape | null {
  if (!keys.length) return null
  if (yaw <= keys[0].yaw) return at(keys[0])
  const last = keys[keys.length - 1]
  if (yaw >= last.yaw) return at(last)
  const i = keys.findIndex((k) => k.yaw >= yaw)
  if (keys[i].yaw === yaw) return at(keys[i])
  const a = at(keys[i - 1]), b = at(keys[i])
  return a && b ? lerpShape(a, b, (yaw - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw)) : null
}

/** Neutral shape of one preset's forms: no yaw = the original (null if none); a yaw = the track, else the original. */
export function presetNeutral(f: FormsRecord, yaw?: number): Shape | null {
  if (f.encoding !== 'absolute') return null
  const original = f.original === 'curve' ? null : f.original
  if (yaw === undefined) return original
  return f.yaw.length ? sample(f.yaw as AbsoluteYawKey[], yaw, (k) => k.shape) : original
}

/** The rule bound to (family, param), if any. */
function ruleFor(store: Get, familyId: string, param: string): RuleRecord | undefined {
  return store.allRecords?.().find((r): r is RuleRecord => r.typeName === 'rule' && r.familyId === familyId && r.param === param)
}

/**
 * Shape of one preset's curve in expression `param` (=1) at `yaw`: the curve's OWN sparse track for that param
 * resampled (rule keys = rule(source neutral at that key's yaw); author keys = that + (target − base)); a curve
 * without a track for the param keeps its neutral shape. No rule runs at non-key yaws (§20.3).
 */
export function presetExpr(store: Get, f: FormsRecord, param: string, yaw: number): Shape | null {
  const keys = f.encoding === 'absolute' ? (f.expr[param] ?? []) : []
  if (!keys.length) return presetNeutral(f, yaw)
  const owner = f.owner.kind === 'preset' ? as(store, f.owner.id, 'preset') : undefined
  const rule = owner && ruleFor(store, owner.familyId, param)
  const impl = rule && RULES[rule.kind]
  if (!rule || !impl) return null
  if (rule.roles[impl.moved] !== f.curveId) return null // only the rule's moved role has this track (reported by the forms check)
  const src = as(store, presetFormsIdOf(owner!.id, rule.roles[impl.source]), 'forms')
  const at = (k: ExprKey) => {
    const s = src && presetNeutral(src, k.yaw)
    if (!s) return null
    const base = impl.apply(s, rule.correspondence)
    if (!base) return null
    return k.kind === 'author' ? addDiff(base, k.target, k.base) : base
  }
  return sample(keys, yaw, at)
}

// ---------- relation rules of the new records (used by model.recordProblems on open and on writes) ----------
const sameAnchors = (sh: Shape, c: CurveRecord) => {
  const a = Object.keys(sh).sort(), b = Object.keys(c.anchors).sort()
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export function newRecordProblems(store: Get, r: DocRecord): Problem[] {
  const out: Problem[] = []
  const p = (field: string, target: string, message: string) => out.push({ object: r.id, field, target, message: `${r.id}: ${message}` })
  const need = (field: string, id: unknown, type: DocRecord['typeName']) => {
    if (!as(store, id, type)) p(field, String(id), `${field} ${String(id)} is not a ${type}`)
  }
  if (r.typeName === 'forms' && r.encoding === 'absolute') {
    const c = as(store, r.curveId, 'curve')
    if (!c) return need('curveId', r.curveId, 'curve'), out
    if (r.owner.kind !== 'preset') return p('owner', '', 'absolute forms must be owned by a preset'), out
    const preset = as(store, r.owner.id, 'preset')
    if (!preset) return need('owner.id', r.owner.id, 'preset'), out
    if (r.id !== presetFormsIdOf(preset.id, c.id)) p('id', c.id, `id must be ${presetFormsIdOf(preset.id, c.id)}`)
    const family = as(store, preset.familyId, 'family')
    if (family && !family.curves.includes(c.id)) p('curveId', c.id, `${c.id} is not registered in ${family.id}`)
    const shapes: [string, Shape][] = [...(r.original && r.original !== 'curve' ? [['original', r.original] as [string, Shape]] : []), ...(r.yaw as AbsoluteYawKey[]).map((k) => [`yaw ${k.yaw}`, k.shape] as [string, Shape])]
    for (const [param, keys] of Object.entries(r.expr)) for (const k of keys) if (k.kind === 'author') shapes.push([`${param} target ${k.yaw}`, k.target], [`${param} base ${k.yaw}`, k.base])
    for (const [where, sh] of shapes) if (!sameAnchors(sh, c)) p(where, c.id, `${where} does not list exactly the anchors of ${c.id}`)
    if (family && store.allRecords) for (const param of Object.keys(r.expr)) {
      const rule = ruleFor(store, family.id, param)
      const impl = rule && RULES[rule.kind]
      if (!rule) p(`expr.${param}`, param, `no rule bound to ${family.id} / ${param}`)
      else if (impl && rule.roles[impl.moved] !== c.id)
        p(`expr.${param}`, rule.id, `${c.id} has a ${param} track but is not the moved role (${impl.moved} = ${rule.roles[impl.moved]}) of ${rule.id}`)
    }
  }
  if (r.typeName === 'family') for (const [i, id] of r.curves.entries()) need(`curves[${i}]`, id, 'curve')
  if (r.typeName === 'preset') {
    const family = as(store, r.familyId, 'family')
    if (!family) need('familyId', r.familyId, 'family')
    else for (const cid of family.curves) if (!as(store, presetFormsIdOf(r.id, cid), 'forms')) p('forms', cid, `no forms for family curve ${cid} (every preset has one per family curve; mark a missing shape explicitly)`)
  }
  if (r.typeName === 'rule') {
    const family = as(store, r.familyId, 'family')
    if (!family) need('familyId', r.familyId, 'family')
    // ONE rule per (family, parameter): lookups find a rule by that pair (dot, review of 2c92206)
    const twins = store.allRecords?.().filter((x) => x.typeName === 'rule' && x.id !== r.id && x.familyId === r.familyId && x.param === r.param) ?? []
    if (twins.length) p('param', twins.map((x) => x.id).join(', '), `${r.familyId} / ${r.param} is also bound by ${twins.map((x) => x.id).join(', ')}: one rule per family parameter`)
    const impl = RULES[r.kind]
    if (!impl || !impl.versions.includes(r.version)) p('kind', `${r.kind}@${r.version}`, `unknown rule ${r.kind} version ${r.version}`)
    else {
      const moved = as(store, r.roles[impl.moved], 'curve'), source = as(store, r.roles[impl.source], 'curve')
      if (!moved || !source) p('roles', JSON.stringify(r.roles), `roles ${impl.moved} / ${impl.source} must be curves`)
      else {
        if (family && (!family.curves.includes(moved.id) || !family.curves.includes(source.id))) p('roles', moved.id, 'role curves must be family curves')
        if (!sameAnchors(Object.fromEntries(Object.keys(r.correspondence).map((k) => [k, null as any])), moved)) p('correspondence', moved.id, `correspondence must list exactly the anchors of ${moved.id}`)
        for (const [a, b] of Object.entries(r.correspondence)) if (!source.anchors[b]) p(`correspondence.${a}`, `${source.id}#${b}`, `${source.id}#${b} missing`)
      }
    }
  }
  if (r.typeName === 'helperDomain') need('presetId', r.presetId, 'preset')
  if (r.typeName === 'visibility') {
    need('curveId', r.curveId, 'curve')
    if (r.owner.kind === 'preset') need('owner.id', r.owner.id, 'preset')
  }
  if (r.typeName === 'character') characterProblems(store, r, p, need)
  return out
}

/** every shape of an absolute forms record lists exactly its curve's anchors */
function wellFormed(store: Get, f: FormsRecord): boolean {
  const c = as(store, f.curveId, 'curve')
  if (!c || f.encoding !== 'absolute') return !!c
  const shapes: Shape[] = [...(f.original && f.original !== 'curve' ? [f.original] : []), ...(f.yaw as AbsoluteYawKey[]).map((k) => k.shape)]
  for (const keys of Object.values(f.expr)) for (const k of keys) if (k.kind === 'author') shapes.push(k.target, k.base)
  return shapes.every((sh) => sameAnchors(sh, c))
}

function characterProblems(store: Get, r: CharacterRecord, p: (f: string, t: string, m: string) => void, need: (f: string, id: unknown, t: DocRecord['typeName']) => void) {
  const family = as(store, r.familyId, 'family') as FamilyRecord | undefined
  if (!family) return need('familyId', r.familyId, 'family')
  for (const pid of Object.keys(r.weights)) {
    const pr = as(store, pid, 'preset') as PresetRecord | undefined
    if (!pr || pr.familyId !== family.id) p(`weights.${pid}`, pid, `${pid} is not a preset of ${family.id}`)
  }
  const curveOf = (id: string) => (family.curves.includes(id as any) ? as(store, id, 'curve') : undefined)
  for (const [cid, as_] of Object.entries(r.fineTune)) {
    const c = curveOf(cid)
    if (!c) p(`fineTune.${cid}`, cid, `${cid} is not a family curve`)
    else for (const a of Object.keys(as_)) if (!c.anchors[a]) p(`fineTune.${cid}.${a}`, `${cid}#${a}`, `${cid}#${a} missing`)
  }
  const ids = new Set<string>()
  for (const t of r.takeovers) {
    if (ids.has(t.id)) p('takeovers', t.id, `duplicate takeover id ${t.id}`)
    ids.add(t.id)
  }
  for (const t of r.takeovers) {
    if (t.kind === 'line') {
      const c = curveOf(t.curveId)
      if (!c) p(`takeovers.${t.id}`, t.curveId, `${t.curveId} is not a family curve`)
      else if (!sameAnchors(t.target, c) || !sameAnchors(t.basisFront, c)) p(`takeovers.${t.id}`, c.id, `shapes must list exactly the anchors of ${c.id}`)
    } else {
      const conn = as(store, t.connectionId, 'connection') as ConnectionRecord | undefined
      if (!conn) {
        p(`takeovers.${t.id}`, t.connectionId, `${t.connectionId} is not a connection`)
        continue
      }
      // v4: a node takeover only on a node made by ONE connection (no overlapping connections / connected groups)
      if (store.allRecords)
        for (const e of conn.ends) {
          const others = connectionsAt(store as BaseReader, `${e.curveId}#${e.anchorId}`).filter((c) => c !== conn.id)
          if (others.length) p(`takeovers.${t.id}`, others.join(', '), `node of ${conn.id} is also in ${others.join(', ')}: node takeovers on connected groups are not supported`)
        }
      if (!ids.has(t.basisFrom)) p(`takeovers.${t.id}.basisFrom`, t.basisFrom, `basisFrom ${t.basisFrom} is not a takeover of ${r.id} (it only records where the copied L came from)`)
    }
  }
  for (const f of r.exprFixes) {
    const c = curveOf(f.curveId)
    if (!c) p(`exprFixes.${f.id}`, f.curveId, `${f.curveId} is not a family curve`)
    else if (!sameAnchors(f.target, c) || !sameAnchors(f.base, c)) p(`exprFixes.${f.id}`, c.id, `shapes must list exactly the anchors of ${c.id}`)
  }
}

/**
 * Shared nodes of preset forms coincide over the whole defined state range (samples §3.1): for each preset
 * holding forms for every end curve, compare the end points at the union of all the end curves' key yaws —
 * neutral, and per expression param — plus the no-yaw originals. Piecewise-linear with clamping ⇒ exact.
 */
export function presetConnectionProblems(store: Get, r: ConnectionRecord): Problem[] {
  if (!store.allRecords) return []
  const out: Problem[] = []
  const presets = store.allRecords().filter((x): x is PresetRecord => x.typeName === 'preset')
  const rules = store.allRecords().filter((x): x is RuleRecord => x.typeName === 'rule')
  for (const pr of presets) {
    const fs = r.ends.map((e) => as(store, presetFormsIdOf(pr.id, e.curveId), 'forms') as FormsRecord | undefined)
    if (fs.some((f) => !f || f.encoding !== 'absolute')) continue
    // malformed forms (anchor sets) of the ends or of any rule source are reported by their own checks; the
    // shared-node comparison needs well-formed shapes, so it is skipped then (never crashes the open)
    const sources = rules.flatMap((ru) => Object.values(ru.roles).map((cid) => as(store, presetFormsIdOf(pr.id, cid), 'forms') as FormsRecord | undefined))
    if ([...fs, ...sources].some((f) => f && !wellFormed(store, f))) continue
    const params = [...new Set(fs.flatMap((f) => Object.keys(f!.expr)))]
    const neutralYaws = [...new Set(fs.flatMap((f) => f!.yaw.map((k) => k.yaw)))]
    const states: { name: string; yaw?: number; at: (f: FormsRecord, yaw?: number) => Shape | null }[] = [{ name: 'no yaw', at: (f) => presetNeutral(f) }]
    for (const y of neutralYaws) states.push({ name: `yaw ${y}`, yaw: y, at: (f, yy) => presetNeutral(f, yy) })
    for (const param of params) {
      const ys = [...new Set([...neutralYaws, ...fs.flatMap((f) => (f!.expr[param] ?? []).map((k) => k.yaw))])]
      for (const y of ys) states.push({ name: `${param} at yaw ${y}`, yaw: y, at: (f, yy) => presetExpr(store, f, param, yy!) })
    }
    for (const st of states) {
      let pts: (Shape[string]['p'] | undefined)[]
      try {
        const shapes = r.ends.map((e, i) => st.at(fs[i]!, st.yaw))
        const lacking = r.ends.findIndex((e, i) => shapes[i] && !shapes[i]![e.anchorId])
        if (lacking >= 0) {
          // an evaluated shape without the end anchor is an error, never a silently skipped comparison
          out.push({ object: r.id, field: 'ends', target: pr.id, message: `${r.id}: in ${pr.id} at ${st.name} the shape of ${r.ends[lacking].curveId} has no anchor ${r.ends[lacking].anchorId}` })
          break
        }
        pts = r.ends.map((e, i) => shapes[i]?.[e.anchorId]?.p)
      } catch (err) {
        // malformed forms (their own checks report why): say so here instead of crashing the whole check
        out.push({ object: r.id, field: 'ends', target: pr.id, message: `${r.id}: cannot evaluate the ends in ${pr.id} at ${st.name}` })
        break
      }
      if (pts.some((q) => !q)) continue // a missing shape is reported where it is blended, not here
      if (pts.some((q) => q!.x !== pts[0]!.x || q!.y !== pts[0]!.y)) {
        out.push({ object: r.id, field: 'ends', target: pr.id, message: `${r.id}: ends separate in ${pr.id} at ${st.name} (${pts.map((q) => `(${q!.x}, ${q!.y})`).join(' vs ')})` })
        break
      }
    }
  }
  return out
}
