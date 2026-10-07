// Schema 2 → 3 (doc 18 §27 / §29 I-1, dot 1791342672): expressions become the author's keyframes; the old
// generation rule (`rule` records, lidClose: upper anchor = copy of the corresponding lower anchor) goes.
// Every converted shape is the OLD EVALUATED result, so nothing a document shows changes on open:
// - a preset's rule key at yaw y      → shape = rule(source neutral at y)
// - a preset's author key at yaw y    → shape = rule(source neutral at y) + (target − base)   (10 / 12 / 11 → 13)
// - the rule's SOURCE curve (it stayed in its neutral form when the expression was on) gets keys at the moved curve's
//   key yaws and its own neutral key yaws, holding exactly that neutral form — the old display, now explicit data
// - a character's expression fix at y → shape = rule(the CHARACTER's source neutral at y) + (target − base)
// - each `rule` becomes an `expressionParam` naming both role curves; the rule record is removed.
// Anything the old evaluation could not produce (a missing source shape, an unknown rule kind) refuses the open.
import { prepareCharacter, type Ctx } from './character'
import { presetFormsIdOf, presetNeutral } from './forms'
import type { DocRecord, FormsRecord, Shape } from './schema'

type Raw = Record<string, any>
const copyPt = (a: Shape[string]) => ({ p: { ...a.p }, hIn: { ...a.hIn }, hOut: { ...a.hOut } })
const H = ['p', 'hIn', 'hOut'] as const
const plusDiff = (s: Shape, target: Shape, base: Shape): Shape =>
  Object.fromEntries(Object.keys(s).map((k) => [k, Object.fromEntries(H.map((h) => [h, { x: s[k][h].x + (target[k][h].x - base[k][h].x), y: s[k][h].y + (target[k][h].y - base[k][h].y) }]))])) as Shape

/** the old lidClose v1 rule: every anchor of the moved (upper) curve takes the corresponding source (lower) anchor */
function oldRule(rule: Raw, source: Shape): Shape {
  if (rule.kind !== 'lidClose' || rule.version !== 1) throw new Error(`migration: unknown rule ${rule.kind} version ${rule.version} in ${rule.id}`)
  return Object.fromEntries(
    Object.entries(rule.correspondence as Record<string, string>).map(([u, l]) => {
      if (!source[l]) throw new Error(`migration: ${rule.id} correspondence names ${l}, missing in its source`)
      return [u, copyPt(source[l])]
    }),
  ) as Shape
}

/** a plain prepare context over the raw (pre-conversion) store — neutral-only reads */
function rawCtx(store: Raw): Ctx {
  const all = () => Object.values(store) as DocRecord[]
  return {
    get: (id) => store[id] as DocRecord | undefined,
    helpersOf: (p) => all().filter((r: any) => r.typeName === 'helperDomain' && r.presetId === p).map((r) => r.id),
    paramsOf: () => [],
    visibilityOf: () => [],
    connectionsAt: (key) => all().filter((r: any) => r.typeName === 'connection' && r.ends.some((e: any) => `${e.curveId}#${e.anchorId}` === key)).map((r) => r.id),
  }
}

/** curves reachable from `start` through connections (the shared nodes the neutral evaluation pins) */
function linkedClosure(store: Raw, start: string[]): Set<string> {
  const out = new Set(start)
  const conns = Object.values(store).filter((r: any) => r?.typeName === 'connection') as Raw[]
  for (let grew = true; grew; ) {
    grew = false
    for (const cn of conns) {
      const cs = (cn.ends as Raw[]).map((e) => e.curveId as string)
      if (cs.some((c) => out.has(c)) && cs.some((c) => !out.has(c))) {
        cs.forEach((c) => out.add(c))
        grew = true
      }
    }
  }
  return out
}

export function convertRuleExpressions(store: Raw) {
  const rules = Object.values(store).filter((r: any) => r?.typeName === 'rule') as Raw[]
  const presetsOf = (familyId: string) => Object.values(store).filter((r: any) => r?.typeName === 'preset' && r.familyId === familyId) as Raw[]
  const ruleFor = (familyId: string, param: string) => rules.find((r) => r.familyId === familyId && r.param === param)
  const puts: Raw[] = []

  // ---- presets: every expression key → its old evaluated shape; the source curve gets its (unchanged) neutral form ----
  const formsOut = new Map<string, Raw>()
  const formsNow = (id: string) => formsOut.get(id) ?? store[id]
  for (const f of Object.values(store) as Raw[]) {
    if (f?.typeName !== 'forms' || f.encoding !== 'absolute' || !Object.keys(f.expr ?? {}).length) continue
    const preset = store[f.owner.id]
    const expr: Record<string, { yaw: number; shape: Shape }[]> = {}
    for (const [param, keys] of Object.entries(f.expr as Record<string, Raw[]>)) {
      const rule = ruleFor(preset?.familyId, param)
      if (!rule) throw new Error(`migration: ${f.id} has a ${param} track but no rule binds ${preset?.familyId} / ${param}`)
      const src = store[presetFormsIdOf(preset.id, rule.roles.lower)] as FormsRecord | undefined
      expr[param] = keys.map((k) => {
        const s = src && presetNeutral(src, k.yaw)
        if (!s) throw new Error(`migration: ${f.id} ${param} key at ${k.yaw}: the source ${rule.roles.lower} has no shape there (the old evaluation could not produce it)`)
        const base = oldRule(rule, s)
        return { yaw: k.yaw, shape: k.kind === 'author' ? plusDiff(base, k.target, k.base) : base }
      })
    }
    formsOut.set(f.id, { ...f, expr })
  }
  for (const rule of rules)
    for (const pr of presetsOf(rule.familyId)) {
      const moved = formsNow(presetFormsIdOf(pr.id, rule.roles.upper))
      const keys = moved?.expr?.[rule.param] as { yaw: number }[] | undefined
      if (!keys?.length) continue
      const srcId = presetFormsIdOf(pr.id, rule.roles.lower)
      const src = formsNow(srcId)
      if (!src || src.encoding !== 'absolute') continue
      if (src.expr?.[rule.param]?.length) throw new Error(`migration: ${srcId} already has a ${rule.param} track (the old source never had one)`)
      // at the moved curve's key yaws AND the source's own neutral key yaws: the source's neutral track is piecewise
      // linear with breakpoints there, so these keys reproduce it at every yaw (and clamp the same way outside)
      const ys = [...new Set([...keys.map((k) => k.yaw), ...(src.yaw as { yaw: number }[]).map((k) => k.yaw)])].sort((a, b) => a - b)
      const shapes = ys.map((y) => {
        const s = presetNeutral(src as FormsRecord, y)
        if (!s) throw new Error(`migration: ${srcId} has no neutral shape at ${y} to keep as its ${rule.param} keyframe`)
        return { yaw: y, shape: s }
      })
      formsOut.set(srcId, { ...src, expr: { ...src.expr, [rule.param]: shapes } })
    }

  // ---- characters: every expression fix → the character's old evaluated shape at that yaw ----
  // A character whose rule curves (closed over connections) carry fine-tune or takeovers showed its OWN neutral data in
  // the old closed eye (the rule copied the character's lower lid). The new evaluation never carries character data
  // into an expression state (that is I-2), so such a character keeps its old picture as explicit keyframes of both
  // rule curves, marked `origin: 'converted'` — the old result, not an author's fix (dot, review of 6eb9635 B1):
  // - the moved curve at the old key yaws (presets' keys ∪ fixes): rule(source neutral) + the old correction
  // - the source curve at every yaw of its old grid: its neutral form (piecewise linear between them, as before)
  const ctx = rawCtx(store)
  const sampleRaw = <T extends { yaw: number }>(keys: T[], y: number, at: (k: T) => Shape): Shape => {
    if (y <= keys[0].yaw) return at(keys[0])
    const last = keys[keys.length - 1]
    if (y >= last.yaw) return at(last)
    const i = keys.findIndex((k) => k.yaw >= y)
    if (keys[i].yaw === y) return at(keys[i])
    const t = (y - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw)
    const s0 = at(keys[i - 1]), s1 = at(keys[i])
    return Object.fromEntries(Object.keys(s0).map((k) => [k, Object.fromEntries(H.map((h) => [h, { x: s0[k][h].x + (s1[k][h].x - s0[k][h].x) * t, y: s0[k][h].y + (s1[k][h].y - s0[k][h].y) * t }]))])) as Shape
  }
  const zero = (s: Shape): Shape => Object.fromEntries(Object.keys(s).map((k) => [k, { p: { x: 0, y: 0 }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } }])) as Shape
  for (const K of Object.values(store) as Raw[]) {
    if (K?.typeName !== 'character') continue
    const famRules = rules.filter((r) => r.familyId === K.familyId)
    if (!famRules.length) continue
    const fixes = ((K.exprFixes ?? []) as Raw[]).map((x) => {
      const param = Object.entries(x.state as Record<string, number>).find(([k, v]) => k !== 'yaw' && v === 1)?.[0]
      if (!param) throw new Error(`migration: ${K.id} fix ${x.id} names no expression parameter`)
      const rule = ruleFor(K.familyId, param)
      if (!rule) throw new Error(`migration: ${K.id} fix ${x.id}: no rule binds ${K.familyId} / ${param}`)
      return { x, param, rule, yaw: x.state.yaw as number }
    })
    const touches = (closure: Set<string>) =>
      Object.entries((K.fineTune ?? {}) as Record<string, Record<string, Raw>>).some(([c, ft]) => closure.has(c) && Object.values(ft).some((d) => ['dp', 'dIn', 'dOut'].some((h) => d[h]?.x || d[h]?.y))) ||
      ((K.takeovers ?? []) as Raw[]).some((t) => (t.kind === 'line' ? closure.has(t.curveId) : (store[t.connectionId]?.ends ?? []).some((e: Raw) => closure.has(e.curveId))))
    const baked = famRules.filter((r) => touches(linkedClosure(store, [r.roles.upper, r.roles.lower])))
    if (!fixes.length && !baked.length) continue
    // only the curves the old evaluation read for these: the rules' curves and what is linked to them (an unrelated
    // identity-only curve elsewhere in the family must not block the conversion)
    const needed = linkedClosure(store, [...fixes.map((f) => f.rule.roles.lower as string), ...baked.flatMap((r) => [r.roles.upper as string, r.roles.lower as string])])
    const view: Ctx = {
      ...ctx,
      get: (id) => {
        const r = ctx.get(id) as any
        if (r?.id === K.familyId) return { ...r, curves: r.curves.filter((c: string) => needed.has(c)) }
        if (r?.id === K.id)
          return { ...r, takeovers: r.takeovers.filter((t: any) => (t.kind === 'line' ? needed.has(t.curveId) : (store[t.connectionId]?.ends ?? []).every((e: any) => needed.has(e.curveId)))) }
        return r
      },
    }
    // the WHOLE old grid (the old play interpolated on it): every family curve's neutral and expression key yaws in a
    // participating preset, every takeover yaw (and 0), every fix yaw — the view above only narrows what is evaluated
    const parts = Object.entries((K.weights ?? {}) as Record<string, number>).filter(([, w]) => w !== 0)
    const famCurves = (store[K.familyId]?.curves ?? []) as string[]
    const oldYaws = [
      ...parts.flatMap(([p]) => famCurves.flatMap((c) => {
        const f = store[presetFormsIdOf(p, c)]
        return [...((f?.yaw ?? []) as Raw[]), ...Object.values((f?.expr ?? {}) as Record<string, Raw[]>).flat()].map((k) => k.yaw as number)
      })),
      ...((K.takeovers ?? []) as Raw[]).flatMap((t) => [t.state.yaw as number, 0]),
      ...fixes.map((f) => f.yaw),
    ]
    const prep = prepareCharacter(view, K.id, { neutralOnly: true, extraYaws: oldYaws })
    if (!prep.ok) {
      if (fixes.length) throw new Error(`migration: ${K.id} cannot be evaluated to convert its expression fixes: ${prep.problems.join('; ')}`)
      continue // the old evaluation failed too: there was no picture to keep
    }
    const g = prep.grid
    const neutralAt = (c: string, y: number) => {
      const i = g.yaws.indexOf(y)
      if (i < 0 || !g.curves[c]) throw new Error(`migration: ${K.id}: no ${c} neutral at ${y}`)
      return g.curves[c].neutral[i]
    }
    const exprFixes: Raw[] = fixes.map(({ x, param, rule, yaw }) => ({ id: x.id, curveId: x.curveId, param, yaw, shape: plusDiff(oldRule(rule, neutralAt(rule.roles.lower, yaw)), x.target, x.base) }))
    for (const rule of baked) {
      const up = rule.roles.upper as string, lo = rule.roles.lower as string, param = rule.param as string
      const own = (c: string, y: number) => exprFixes.some((f) => f.curveId === c && f.param === param && f.yaw === y)
      const add = (c: string, y: number, shape: Shape) => {
        if (!own(c, y)) exprFixes.push({ id: `exprFix:${c}@${y}/${param}`, curveId: c, param, yaw: y, shape, origin: 'converted' })
      }
      // the moved curve: the old key yaws and the old correction there (old step 6: author → target − base, rule → 0,
      // each preset's correction track resampled and weighted)
      const keyYaws = [...new Set([...parts.flatMap(([p]) => ((store[presetFormsIdOf(p, up)]?.expr?.[param] ?? []) as Raw[]).map((k) => k.yaw as number)), ...fixes.filter((f) => f.rule === rule).map((f) => f.yaw)])].sort((a, b) => a - b)
      for (const y of keyYaws) {
        const base = oldRule(rule, neutralAt(lo, y))
        let corr = zero(base)
        for (const [p, w] of parts) {
          const keys = (store[presetFormsIdOf(p, up)]?.expr?.[param] ?? []) as (Raw & { yaw: number })[]
          if (!keys.length) continue
          const c = sampleRaw(keys, y, (k) => (k.kind === 'author' ? plusDiff(zero(base), k.target, k.base) : zero(base)))
          corr = plusDiff(corr, Object.fromEntries(Object.entries(c).map(([k, q]) => [k, Object.fromEntries(H.map((h) => [h, { x: q[h].x * w, y: q[h].y * w }]))])) as Shape, zero(base))
        }
        add(up, y, plusDiff(base, corr, zero(base)))
      }
      // the source curve: its neutral form at every yaw of its old grid
      for (const y of g.yaws) add(lo, y, structuredClone(neutralAt(lo, y)))
    }
    puts.push({ ...K, exprFixes })
  }

  // ---- rules → expression parameters naming both role curves ----
  for (const rule of rules) {
    const id = `expressionParam:${String(rule.id).replace(/^rule:/, '')}`
    if (store[id]) throw new Error(`migration: ${rule.id} would become ${id}, which already exists`)
    delete store[rule.id]
    store[id] = { typeName: 'expressionParam', id, familyId: rule.familyId, name: rule.param, curves: [...new Set([rule.roles.upper, rule.roles.lower])] }
  }
  for (const [id, f] of formsOut) store[id] = f
  for (const r of puts) store[r.id] = r
}

/**
 * tldraw reports a failed migration only as "Failed to migrate": run the conversion on a copy first and name the reason
 * (the open boundary always says `invalid document: <reason>`). Only for files older than schema 3.
 */
export function expressionConversionProblem(snapshot: { store?: Raw; schema?: { sequences?: Record<string, number> } }): string | null {
  const v = snapshot?.schema?.sequences?.['contour.document'] ?? 0
  if (v >= 2) return null
  try {
    convertRuleExpressions(structuredClone(snapshot.store ?? {}))
    return null
  } catch (e) {
    const m = String((e as Error)?.message ?? e)
    return m.startsWith('migration: ') ? m : `migration: the old expressions cannot be converted (${m})`
  }
}
