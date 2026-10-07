// Stage 3b (doc 18 §24.5): commands that write presets (author mode) and characters, through the one write entry.
// Every plan is checked once more by preparing the affected characters on the plan's final overlay: a character
// that prepared before must still prepare after (nothing is committed that playback would refuse).
// The fixed bases (§24.2, dot 1791312539): a line takeover's L is fitted on the curve correspondence front → target
// at that moment (the verified §16 rule, fitLinear over the control points the curve's segments use); a node
// takeover copies the L of a line takeover at that node and state, else the weighted helper domains Σ w·L (our
// derivation, the derivative of the blend for a common fine-tune with fixed weights) — copied, never recomputed.
import type { RecordId } from '@tldraw/store'
import { ctxOf, prepareCharacter, type CharacterGrid } from './character'
import type { EditError, IdSource, Plan } from './commands'
import { fitLinear } from './experiments/fineTuneTransfer'
import { paramFor, presetExpr, presetFormsIdOf, presetNeutral } from './forms'
import { connectionsAt } from './indexes'
import { anchorKey, getAs, overlayReader } from './model'
import {
  Visibility,
  type AbsoluteYawKey,
  type BaseReader,
  type CharacterRecord,
  type ConnectionRecord,
  type CurveRecord,
  type DocRecord,
  type FamilyRecord,
  type FormsRecord,
  type HelperDomainRecord,
  type PointDelta,
  type PresetRecord,
  type Shape,
  type Vec,
  type VisibilityRecord,
} from './schema'

type Store = BaseReader
type CharId = RecordId<CharacterRecord>
export type CharacterCommand =
  | { type: 'setPresetWeights'; character: CharId; weights: Record<string, number> }
  | { type: 'setFineTune'; character: CharId; curveId: RecordId<CurveRecord>; anchorId: string; delta: PointDelta | null }
  | { type: 'fixLine'; character: CharId; curveId: RecordId<CurveRecord>; yaw: number; target: Shape }
  | { type: 'fixNode'; character: CharId; connectionId: RecordId<ConnectionRecord>; yaw: number; target: Vec }
  /** the character's own expression keyframes at one yaw: one or more curves the parameter names (full shapes) */
  | { type: 'fixExpression'; character: CharId; param: string; yaw: number; keyframes: Record<string, Shape> }
  | { type: 'clearFix'; character: CharId; id: string }
  /** a preset key: neutral (no `param`) or the author's expression keyframe of `param` (value 1) */
  | { type: 'setPresetKey'; preset: RecordId<PresetRecord>; curveId: RecordId<CurveRecord>; yaw: number; shape: Shape; param?: string }
  | { type: 'setVisibilityKey'; preset: RecordId<PresetRecord>; curveId: RecordId<CurveRecord>; yaw: number; visible: boolean }

const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })
type Mat2 = [number, number, number, number]
const v = (x: number, y: number): Vec => ({ x, y })
const finite = (q: Vec) => Number.isFinite(q.x) && Number.isFinite(q.y)
const shapeOk = (s: Shape, c: CurveRecord) => {
  const a = Object.keys(s).sort(), b = Object.keys(c.anchors).sort()
  return a.length === b.length && a.every((x, i) => x === b[i]) && Object.values(s).every((q) => finite(q.p) && finite(q.hIn) && finite(q.hOut))
}
/** the control points the curve's segments use, in order, without repeats (what a line takeover is fitted on) */
const usedPoints = (c: CurveRecord, s: Shape): Vec[] => {
  const out: Vec[] = []
  const seen = new Set<string>()
  const push = (k: string, q: Vec) => !seen.has(k) && (seen.add(k), out.push(q))
  for (const g of c.segments) {
    push(`${g.from}.p`, s[g.from].p), push(`${g.from}.hOut`, s[g.from].hOut), push(`${g.to}.hIn`, s[g.to].hIn), push(`${g.to}.p`, s[g.to].p)
  }
  return out
}

/** prepare a character on a reader */
const prepOn = (r: Store, id: string) => prepareCharacter(ctxOf(r), id)
/** characters of a family */
const charactersOf = (store: Store, familyId: string) => store.allRecords().filter((r): r is CharacterRecord => r.typeName === 'character' && r.familyId === familyId)

/**
 * Characters that cannot be prepared AFTER the edit — whether or not they could before (an author keeps editing a family
 * whose character is already unplayable: every edit still says so; dot, review of 513444f): a NOTICE, not a refusal —
 * normal authoring (a new curve not yet drawn in every preset, a key whose basis is added next …) must not be blocked;
 * prepare / play then report what is missing and never fake a playable result (dot 1791315660).
 */
export function playabilityNotices(store: Store, puts: DocRecord[], characters: string[], removals: string[] = []): string[] {
  const after = overlayReader(store, puts, removals)
  const out: string[] = []
  for (const id of characters) {
    const p = prepOn(after, id)
    if (!p.ok) out.push(`${id} cannot be prepared until: ${p.problems.join('; ')}`)
  }
  return out
}

const sample = <K extends { yaw: number }>(keys: K[], yaw: number, at: (k: K) => Mat2): Mat2 => {
  if (yaw <= keys[0].yaw) return at(keys[0])
  const last = keys[keys.length - 1]
  if (yaw >= last.yaw) return at(last)
  const i = keys.findIndex((k) => k.yaw >= yaw)
  if (keys[i].yaw === yaw) return at(keys[i])
  const a = at(keys[i - 1]), b = at(keys[i]), t = (yaw - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw)
  return a.map((x, j) => x + (b[j] - x) * t) as Mat2
}

export function planCharacter(store: Store, cmd: CharacterCommand, _ids: IdSource): Plan {
  void _ids
  if (cmd.type === 'setPresetKey' || cmd.type === 'setVisibilityKey') return planPreset(store, cmd)
  const K = getAs(store, cmd.character, 'character')
  if (!K) return fail('NOT_FOUND', `no character ${cmd.character}`, [String(cmd.character)])
  const fam = getAs(store, K.familyId, 'family') as FamilyRecord | undefined
  if (!fam) return fail('NOT_FOUND', `no family ${K.familyId}`, [K.familyId])
  const famCurve = (id: string) => (fam.curves.includes(id as any) ? getAs(store, id, 'curve') : undefined)
  const before = prepOn(store, K.id)
  const grid: CharacterGrid | undefined = before.ok ? before.grid : undefined
  const needGrid = (): Plan | null => (grid ? null : fail('INVALID', `${K.id} cannot be prepared now: ${(before as { problems: string[] }).problems.join('; ')}`, [K.id]))
  let next: CharacterRecord
  switch (cmd.type) {
    case 'setPresetWeights': {
      for (const [p, w] of Object.entries(cmd.weights)) {
        const pr = getAs(store, p, 'preset')
        if (!pr || pr.familyId !== fam.id) return fail('INVALID', `${p} is not a preset of ${fam.id}`, [p])
        if (!Number.isFinite(w) || w < 0) return fail('INVALID', `weight of ${p} must be finite and non-negative (got ${w})`, [p])
      }
      const sum = Object.values(cmd.weights).reduce((s, w) => s + w, 0)
      if (Math.abs(sum - 1) > 1e-9) return fail('INVALID', `weights sum to ${sum}, not 1 (never renormalised)`, [K.id])
      next = { ...K, weights: { ...cmd.weights } }
      break
    }
    case 'setFineTune': {
      const c = famCurve(cmd.curveId)
      if (!c || !c.anchors[cmd.anchorId]) return fail('NOT_FOUND', `${anchorKey({ curveId: cmd.curveId, anchorId: cmd.anchorId })} is not an anchor of a family curve`, [String(cmd.curveId)])
      const ft = { ...(K.fineTune[cmd.curveId] ?? {}) }
      if (cmd.delta === null) delete ft[cmd.anchorId]
      else {
        if (![cmd.delta.dp, cmd.delta.dIn, cmd.delta.dOut].every((q) => q && finite(q))) return fail('INVALID', 'delta must be finite dp / dIn / dOut', [K.id])
        ft[cmd.anchorId] = structuredClone(cmd.delta)
      }
      const fineTune: CharacterRecord['fineTune'] = { ...K.fineTune, [cmd.curveId]: ft }
      if (!Object.keys(ft).length) delete fineTune[cmd.curveId]
      // a shared node is ONE point: every end linked to this anchor gets the same anchor offset in the same commit,
      // its own handles shifted by the same amount (like setPoseKey's linked keys)
      const newDp = cmd.delta?.dp ?? v(0, 0)
      for (const cnId of connectionsAt(store, anchorKey({ curveId: cmd.curveId, anchorId: cmd.anchorId }))) {
        for (const e of getAs(store, cnId, 'connection')!.ends) {
          if (e.curveId === cmd.curveId && e.anchorId === cmd.anchorId) continue
          if (!fam.curves.includes(e.curveId)) continue
          const other = { ...(fineTune[e.curveId] ?? {}) }
          const old = other[e.anchorId] ?? { dp: v(0, 0), dIn: v(0, 0), dOut: v(0, 0) }
          const sh = v(newDp.x - old.dp.x, newDp.y - old.dp.y)
          const moved = { dp: { ...newDp }, dIn: v(old.dIn.x + sh.x, old.dIn.y + sh.y), dOut: v(old.dOut.x + sh.x, old.dOut.y + sh.y) }
          if ([moved.dp, moved.dIn, moved.dOut].every((q) => q.x === 0 && q.y === 0)) delete other[e.anchorId]
          else other[e.anchorId] = moved
          if (Object.keys(other).length) fineTune[e.curveId] = other
          else delete fineTune[e.curveId]
        }
      }
      next = { ...K, fineTune }
      break
    }
    case 'fixLine': {
      const c = famCurve(cmd.curveId)
      if (!c) return fail('NOT_FOUND', `${cmd.curveId} is not a family curve of ${fam.id}`, [String(cmd.curveId)])
      if (!Number.isFinite(cmd.yaw) || cmd.yaw === 0) return fail('INVALID', 'a line takeover needs a finite, non-zero yaw', [c.id])
      if (!shapeOk(cmd.target, c)) return fail('INVALID', `target must list exactly the anchors of ${c.id} with finite control points`, [c.id])
      const no = needGrid()
      if (no) return no
      const front = grid!.front[c.id]
      if (!front) return fail('INVALID', `the front of ${c.id} is needed (a participating preset has no original)`, [c.id])
      // the verified rule: L fitted on the curve correspondence (front at this moment → target) — the points the segments use
      const { L, spread } = fitLinear(usedPoints(c, front), usedPoints(c, cmd.target))
      if (!(spread > 1e-9) || !L.every(Number.isFinite)) return fail('INVALID', `the front of ${c.id} is (nearly) collinear: no fixed basis can be fitted (degenerate fallback not supported)`, [c.id])
      const dir = Math.sign(cmd.yaw)
      // replacing the takeover of this curve and direction keeps its identity (a node takeover may name it as basisFrom)
      const prior = K.takeovers.find((x) => x.kind === 'line' && x.curveId === c.id && Math.sign(x.state.yaw) === dir)
      const t = { kind: 'line' as const, id: prior?.id ?? `takeover:${c.id}@${cmd.yaw}`, curveId: c.id, state: { yaw: cmd.yaw }, direction: { from: 0, to: cmd.yaw }, target: structuredClone(cmd.target), basisFront: structuredClone(front), L: L as Mat2 }
      next = { ...K, takeovers: [...K.takeovers.filter((x) => !(x.kind === 'line' && x.curveId === c.id && Math.sign(x.state.yaw) === dir)), t] }
      break
    }
    case 'fixNode': {
      const cn = getAs(store, cmd.connectionId, 'connection')
      if (!cn || !cn.ends.every((e) => fam.curves.includes(e.curveId))) return fail('NOT_FOUND', `${cmd.connectionId} is not a connection between family curves`, [String(cmd.connectionId)])
      if (!Number.isFinite(cmd.yaw) || cmd.yaw === 0 || !cmd.target || !finite(cmd.target)) return fail('INVALID', 'a node takeover needs a finite, non-zero yaw and a finite target', [cn.id])
      for (const e of cn.ends) {
        const others = connectionsAt(store, anchorKey(e)).filter((x) => x !== cn.id)
        if (others.length) return fail('INVALID', `the node of ${cn.id} is also in ${others.join(', ')}: node takeovers on connected groups are not supported`, [cn.id, ...others])
      }
      const no = needGrid()
      if (no) return no
      const first = cn.ends[0]
      const front = grid!.front[first.curveId]
      if (!front) return fail('INVALID', `the front of ${first.curveId} is needed`, [first.curveId])
      const dir = Math.sign(cmd.yaw)
      // §24.2: a line takeover at this node and state gives the L; two different ones → refused; else Σ w · L
      const lines = K.takeovers.filter((t) => t.kind === 'line' && cn.ends.some((e) => e.curveId === t.curveId) && t.state.yaw === cmd.yaw) as Extract<CharacterRecord['takeovers'][number], { kind: 'line' }>[]
      let L: Mat2
      let basisFrom: string | { kind: 'blend'; yaw: number; weights: Record<string, number> }
      if (lines.length) {
        if (lines.some((t) => t.L.some((x, j) => x !== lines[0].L[j]))) return fail('INVALID', `line takeovers ${lines.map((t) => t.id).join(', ')} at this node have different bases: unify them first`, lines.map((t) => t.id))
        L = [...lines[0].L] as Mat2
        basisFrom = lines[0].id
      } else {
        const helpers = store.allRecords().filter((r): r is HelperDomainRecord => r.typeName === 'helperDomain')
        let acc: Mat2 = [0, 0, 0, 0]
        for (const [p, w] of Object.entries(K.weights)) {
          if (w === 0) continue
          const fm = getAs(store, presetFormsIdOf(p, first.curveId), 'forms') as FormsRecord | undefined
          const own = [...new Set([0, ...((fm?.yaw ?? []) as AbsoluteYawKey[]).map((k) => k.yaw)])].sort((a, b) => a - b)
          const Ls: { yaw: number; L: Mat2 }[] = []
          for (const y of own) {
            if (y === 0) Ls.push({ yaw: 0, L: [1, 0, 0, 1] })
            else {
              const h = helpers.find((x) => x.presetId === p && x.yaw === y)
              if (!h) return fail('INVALID', `${p} has no helper domain at yaw ${y}: no node basis can be blended`, [p])
              Ls.push({ yaw: y, L: [h.affine.a, h.affine.b, h.affine.c, h.affine.d] })
            }
          }
          const Li = sample(Ls, cmd.yaw, (k) => k.L)
          acc = acc.map((x, j) => x + w * Li[j]) as Mat2
        }
        L = acc
        basisFrom = { kind: 'blend', yaw: cmd.yaw, weights: { ...K.weights } }
      }
      const priorNode = K.takeovers.find((x) => x.kind === 'node' && x.connectionId === cn.id && Math.sign(x.state.yaw) === dir)
      const t = { kind: 'node' as const, id: priorNode?.id ?? `takeover:${cn.id}@${cmd.yaw}`, connectionId: cn.id, state: { yaw: cmd.yaw }, direction: { from: 0, to: cmd.yaw }, target: { ...cmd.target }, basisFront: { ...front[first.anchorId].p }, L, basisFrom }
      next = { ...K, takeovers: [...K.takeovers.filter((x) => !(x.kind === 'node' && x.connectionId === cn.id && Math.sign(x.state.yaw) === dir)), t] }
      break
    }
    case 'fixExpression': {
      // the character's own keyframes (doc 18 §29 I-1): full shapes of curves the parameter names; no rule, no base
      const ep = paramFor(store, fam.id, cmd.param)
      if (!ep) return fail('INVALID', `no expression parameter ${cmd.param} in ${fam.id}`, [fam.id])
      if (!Number.isFinite(cmd.yaw)) return fail('INVALID', 'yaw must be finite', [K.id])
      const targets = Object.entries(cmd.keyframes ?? {})
      if (!targets.length) return fail('INVALID', 'no target given', [K.id])
      for (const [cid, sh] of targets) {
        const c = famCurve(cid)
        if (!c) return fail('NOT_FOUND', `${cid} is not a family curve of ${fam.id}`, [cid])
        if (!ep.curves.includes(c.id)) return fail('INVALID', `${ep.id} does not act on ${c.id} (its curves: ${ep.curves.join(', ')})`, [c.id, ep.id])
        if (!shapeOk(sh, c)) return fail('INVALID', `the target of ${c.id} must list exactly its anchors with finite control points`, [c.id])
      }
      // linked ends: one shared point. Two given ends must agree; an end linked to a curve NOT given must stay where
      // that curve has it in this state (else give that curve's target too) — never moved behind the author's back
      const no = needGrid()
      if (no) return no
      const keys = grid!.yaws.map((y, i) => ({ yaw: y, i }))
      const stateOf = (cid: string): Shape | null => {
        const g = grid!.curves[cid]
        if (!g) return null
        const list = ep.curves.includes(cid as any) ? (grid!.unplayable[ep.name] ? null : g.expr[ep.name]) : g.neutral
        return list ? sampleShape(keys.map((k) => ({ yaw: k.yaw, shape: list[k.i] })), cmd.yaw) : null
      }
      for (const [cid, sh] of targets)
        for (const a of Object.keys(sh))
          for (const cnId of connectionsAt(store, anchorKey({ curveId: cid as RecordId<CurveRecord>, anchorId: a }))) {
            const cn = getAs(store, cnId, 'connection')!
            for (const e of cn.ends) {
              if (e.curveId === cid) continue
              const q = sh[a].p
              const given = cmd.keyframes[e.curveId]
              const other = given ? given[e.anchorId]?.p : stateOf(e.curveId)?.[e.anchorId]?.p
              if (!other) continue // that curve has no state here yet (an unfinished draft): checked when it is drawn
              if (other.x !== q.x || other.y !== q.y)
                return fail('INVALID', given ? `the given ends of ${cn.id} differ: one shared point` : `${cid}#${a} is linked to ${e.curveId}#${e.anchorId} (${cn.id}): give ${e.curveId}'s target too, or keep the end where it is`, [cn.id, e.curveId])
            }
          }
      // replace by meaning — the same curve, parameter and yaw — whatever id an imported record has
      let fixes = [...K.exprFixes]
      for (const [cid, sh] of targets) {
        const same = (x: CharacterRecord['exprFixes'][number]) => x.curveId === cid && x.yaw === cmd.yaw && x.param === ep.name
        const prior = fixes.find(same)
        fixes = [...fixes.filter((x) => !same(x)), { id: prior?.id ?? `exprFix:${cid}@${cmd.yaw}/${ep.name}`, curveId: cid as RecordId<CurveRecord>, param: ep.name, yaw: cmd.yaw, shape: structuredClone(sh) }]
      }
      next = { ...K, exprFixes: fixes }
      break
    }
    case 'clearFix': {
      if (!K.takeovers.some((t) => t.id === cmd.id) && !K.exprFixes.some((x) => x.id === cmd.id)) return fail('NOT_FOUND', `${K.id} has no takeover or expression fix ${cmd.id}`, [K.id])
      // a node takeover that named this line as basisFrom is untouched: its copied L is the authority and basisFrom is
      // provenance only, kept as written (dot, review of 819dd22: clearing the source was refused)
      next = { ...K, takeovers: K.takeovers.filter((t) => t.id !== cmd.id), exprFixes: K.exprFixes.filter((x) => x.id !== cmd.id) }
      break
    }
  }
  // an edit of a CHARACTER must leave that character preparable — checked on the result alone, also when the character
  // was already unplayable before the edit (dot, review of 513444f): an unsupported result (e.g. a joint eye-tail
  // correction that splits a node) is refused; preset authoring only reports (notices)
  const broken = playabilityNotices(store, [next], [K.id])
  if (broken.length) return fail('INVALID', `${K.id} would no longer be playable: ${broken.join('; ')}`, [K.id])
  return { ok: true, label: cmd.type, puts: [next], affected: [K.id] }
}

/** preset author mode: a preset key (linked curves get a key at the same yaw, their shared end moved with it) and visibility */
function planPreset(store: Store, cmd: Extract<CharacterCommand, { type: 'setPresetKey' | 'setVisibilityKey' }>): Plan {
  const pr = getAs(store, cmd.preset, 'preset')
  if (!pr) return fail('NOT_FOUND', `no preset ${cmd.preset}`, [String(cmd.preset)])
  const fam = getAs(store, pr.familyId, 'family') as FamilyRecord | undefined
  if (!fam || !fam.curves.includes(cmd.curveId)) return fail('NOT_FOUND', `${cmd.curveId} is not a curve of ${pr.familyId}`, [String(cmd.curveId)])
  if (!Number.isFinite(cmd.yaw)) return fail('INVALID', 'yaw must be finite', [String(cmd.curveId)])
  const puts: DocRecord[] = []
  if (cmd.type === 'setVisibilityKey') {
    const id = Visibility.createId(`${pr.id}/${cmd.curveId}`)
    const old = getAs(store, id, 'visibility') as VisibilityRecord | undefined
    const keys = [...(old?.keys ?? []).filter((k) => k.yaw !== cmd.yaw), { yaw: cmd.yaw, visible: !!cmd.visible }].sort((a, b) => a.yaw - b.yaw)
    puts.push(old ? { ...old, keys } : ({ typeName: 'visibility', id, curveId: cmd.curveId, owner: { kind: 'preset', id: pr.id }, mode: 'step', keys } as VisibilityRecord))
    const notices = playabilityNotices(store, puts, charactersOf(store, fam.id).map((c) => c.id))
    return { ok: true, label: 'setVisibilityKey', puts, affected: [id], ...(old ? {} : { creates: [id] }), ...(notices.length ? { notices } : {}) }
  }
  const c = getAs(store, cmd.curveId, 'curve')!
  if (!shapeOk(cmd.shape, c)) return fail('INVALID', `shape must list exactly the anchors of ${c.id} with finite control points`, [c.id])
  const fm = getAs(store, presetFormsIdOf(pr.id, c.id), 'forms') as FormsRecord | undefined
  if (!fm || fm.encoding !== 'absolute') return fail('NOT_FOUND', `no forms of ${pr.id} for ${c.id}`, [c.id])
  // an expression keyframe (doc 18 §29 I-1): the parameter must NAME this curve
  const ep = cmd.param !== undefined ? paramFor(store, fam.id, cmd.param) : undefined
  if (cmd.param !== undefined && !ep) return fail('INVALID', `no expression parameter ${cmd.param} in ${fam.id}`, [fam.id])
  if (ep && !ep.curves.includes(c.id)) return fail('INVALID', `${ep.id} does not act on ${c.id} (its curves: ${ep.curves.join(', ')})`, [c.id, ep.id])
  const withKey = (f: FormsRecord, shape: Shape): FormsRecord =>
    ep
      ? { ...f, expr: { ...f.expr, [ep.name]: [...(f.expr[ep.name] ?? []).filter((k) => k.yaw !== cmd.yaw), { yaw: cmd.yaw, shape }].sort((a, b) => a.yaw - b.yaw) } }
      : { ...f, yaw: [...(f.yaw as AbsoluteYawKey[]).filter((k) => k.yaw !== cmd.yaw), { yaw: cmd.yaw, shape }].sort((a, b) => a.yaw - b.yaw) }
  puts.push(withKey(fm, structuredClone(cmd.shape)))
  // linked curves: a key at the same yaw holding their EXISTING evaluated form (never a rule run), with the shared
  // end moved onto this key's end (handles with it) — atomically, like setPoseKey's linked keys
  for (const a of Object.keys(c.anchors))
    for (const cnId of connectionsAt(store, anchorKey({ curveId: c.id, anchorId: a }))) {
      const cn = getAs(store, cnId, 'connection')!
      for (const e of cn.ends) {
        if (e.curveId === c.id) continue
        const lf = (puts.find((r) => r.id === presetFormsIdOf(pr.id, e.curveId)) as FormsRecord | undefined) ?? (getAs(store, presetFormsIdOf(pr.id, e.curveId), 'forms') as FormsRecord | undefined)
        if (!lf || lf.encoding !== 'absolute') continue
        const n = cmd.shape[a].p
        if (ep && !ep.curves.includes(e.curveId)) {
          // the linked curve stays in its neutral form in this expression: the end may not leave it
          const there = presetNeutral(lf, cmd.yaw)?.[e.anchorId]?.p
          if (there && (there.x !== n.x || there.y !== n.y)) return fail('INVALID', `${c.id}#${a} is linked to ${e.curveId}#${e.anchorId}, which ${ep.name} does not move: the end must stay at (${there.x}, ${there.y})`, [cnId, e.curveId])
          continue
        }
        let current: Shape | null
        if (ep) {
          // the linked curve's keyframe here, or its keyframes sampled; none yet (an unfinished draft) → nothing to link
          current = (lf.expr[ep.name] ?? []).find((k) => k.yaw === cmd.yaw)?.shape ?? presetExpr(lf, ep.name, cmd.yaw)
          if (!current) continue
        } else {
          const keys = lf.yaw as AbsoluteYawKey[]
          const existing = keys.find((k) => k.yaw === cmd.yaw)?.shape
          current = existing ?? (keys.length ? sampleShape(keys, cmd.yaw) : lf.original && lf.original !== 'curve' ? lf.original : null)
          if (!current) return fail('INVALID', `${e.curveId} has no shape in ${pr.id} to link at yaw ${cmd.yaw}`, [e.curveId])
        }
        const q = current[e.anchorId]
        const dx = n.x - q.p.x, dy = n.y - q.p.y
        const moved: Shape = { ...structuredClone(current), [e.anchorId]: { p: { ...n }, hIn: v(q.hIn.x + dx, q.hIn.y + dy), hOut: v(q.hOut.x + dx, q.hOut.y + dy) } }
        const i = puts.findIndex((r) => r.id === lf.id)
        if (i >= 0) puts[i] = withKey(lf, moved)
        else puts.push(withKey(lf, moved))
      }
    }
  const notices = playabilityNotices(store, puts, charactersOf(store, fam.id).map((ch) => ch.id))
  return { ok: true, label: 'setPresetKey', puts, affected: puts.map((r) => r.id), ...(notices.length ? { notices } : {}) }
}

function sampleShape(keys: AbsoluteYawKey[], yaw: number): Shape {
  if (yaw <= keys[0].yaw) return keys[0].shape
  const last = keys[keys.length - 1]
  if (yaw >= last.yaw) return last.shape
  const i = keys.findIndex((k) => k.yaw >= yaw)
  const a = keys[i - 1].shape, b = keys[i].shape, t = (yaw - keys[i - 1].yaw) / (keys[i].yaw - keys[i - 1].yaw)
  return Object.fromEntries(Object.keys(a).map((k) => [k, Object.fromEntries((['p', 'hIn', 'hOut'] as const).map((h) => [h, v(a[k][h].x + (b[k][h].x - a[k][h].x) * t, a[k][h].y + (b[k][h].y - a[k][h].y) * t)]))])) as Shape
}
