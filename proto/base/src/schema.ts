// Document records for the route-B slice (docs/design/architecture/11, 15).
// Storage: @tldraw/store v5.5.2 (MIT) — createRecordType / StoreSchema / Store.
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/RecordType.ts
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreSchema.ts
// Anchor = point + in/out handles (Paper.js Segment model, MIT):
//   https://github.com/paperjs/paper.js/blob/v0.12.18/src/path/Segment.js
// Connections as separate records linking anchors (tldraw bindings idea, MIT tlschema):
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/records/TLBinding.ts
import { BaseRecord, RecordId, Store, StoreSchema, createMigrationSequence, createRecordType } from '@tldraw/store'
import { convertRuleExpressions } from './expressionMigration'

export type Vec = { x: number; y: number }

/** A point with handles. Handles are stored relative to the point. */
export type Anchor = { id: string; p: Vec; hIn: Vec; hOut: Vec }
/** One cubic Bézier between two anchors of the same curve — the smallest interpolation unit. */
export type Segment = { id: string; from: string; to: string }

export interface ContainerRecord extends BaseRecord<'container', RecordId<ContainerRecord>> {
  name: string
  tags: string[]
  parentId: RecordId<ContainerRecord> | null
  index: string // fractional index among siblings
  visible: boolean
  locked: boolean
  opacity: number
}

export interface CurveRecord extends BaseRecord<'curve', RecordId<CurveRecord>> {
  name: string
  tags: string[]
  parentId: RecordId<ContainerRecord>
  index: string
  anchors: Record<string, Anchor>
  segments: Segment[] // ordered chain
  closed: boolean
  stroke: { color: string; width: number }
  depthOffset: number
}

/** Joins two or more anchors (possibly in different layers). Owned by the document, not a layer. */
export interface ConnectionRecord extends BaseRecord<'connection', RecordId<ConnectionRecord>> {
  ends: { curveId: RecordId<CurveRecord>; anchorId: string }[]
  geometricJoin: 'corner' | 'smooth'
}

/** A fill boundary step along one segment of a curve, in either direction. */
export type SegmentStep = { curveId: RecordId<CurveRecord>; segmentId: string; dir: 1 | -1 }
/**
 * A fill-only closing edge (bridge, doc 18 §19.2): a straight line between two anchors' CURRENT positions,
 * stored only in the fill's own boundary — no stroke, no own ink, no endpoint linkage. Cutting a filled loop
 * inserts one at the cut so the fill stays closed (SVG closepath for open subpaths, adapted to our fills).
 */
export type BridgeStep = { bridge: { from: { curveId: RecordId<CurveRecord>; anchorId: string }; to: { curveId: RecordId<CurveRecord>; anchorId: string } } }
export type BoundaryStep = SegmentStep | BridgeStep
export const isBridge = (s: BoundaryStep): s is BridgeStep => 'bridge' in s

export interface FillRecord extends BaseRecord<'fill', RecordId<FillRecord>> {
  name: string
  parentId: RecordId<ContainerRecord>
  index: string
  boundary: BoundaryStep[]
  color: string
  depthOffset: number
}

export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }

/** Places a container's content again. Overrides are keyed by `${curveId}#${anchorId}`. */
export interface ReferenceRecord extends BaseRecord<'reference', RecordId<ReferenceRecord>> {
  name: string
  parentId: RecordId<ContainerRecord>
  index: string
  sourceId: RecordId<ContainerRecord>
  transform: Affine
  overrides: Record<string, Vec>
}

/** Absolute control points of every anchor of a curve (handles absolute, unlike `CurveRecord.anchors`). */
export type Shape = Record<string, { p: Vec; hIn: Vec; hOut: Vec }>
export type FormsOwner = { kind: 'document' } | { kind: 'preset'; id: RecordId<PresetRecord> }
/** Legacy yaw key (migrated from the old pose record): one offset per anchor, missing anchor = offset 0. */
export type LegacyYawKey = { yaw: number; offsets: Record<string, Vec> }
/** Promoted legacy key (stage 2): one offset per control point (anchor, in-handle, out-handle). */
export type Legacy3YawKey = { yaw: number; offsets: Record<string, PointDelta> }
export type AbsoluteYawKey = { yaw: number; shape: Shape }
/**
 * One key of an expression's own sparse track: the author's FULL shape of this curve in that expression state at that
 * yaw (doc 18 §27 / §29 I-1 — bowen draws the open and closed keyframes; no generation rule). Schema 3 (`contour.
 * document/2`) converts the older rule / author keys by their evaluated result.
 */
export type ExprKey = { yaw: number; shape: Shape }

/**
 * Every recorded form of ONE curve for ONE owner (doc 18 samples/stage1-archive.md v4.1).
 * - `legacy-delta` (owner = document): the old head-turn track, migrated from the old `pose` record as is
 *   — offsets relative to the curve's drawing (option 甲), evaluated in the old order so old documents give
 *   the same numbers. Its id is derived from the curve id (`legacyFormsIdOf`).
 * - `absolute` (owner = preset): full control points (original, yaw keys, expression keys); new data never
 *   hangs on the editable curve drawing (dot 1791306841). `original: null` = no no-yaw original.
 */
export interface FormsRecord extends BaseRecord<'forms', RecordId<FormsRecord>> {
  curveId: RecordId<CurveRecord>
  owner: FormsOwner
  encoding: 'legacy-delta' | 'legacy-delta3' | 'absolute'
  /** legacy-delta: 'curve' (the curve record is the original); absolute: a shape, or null */
  original: 'curve' | Shape | null
  /** sorted by yaw, unique; legacy-delta: LegacyYawKey, absolute: AbsoluteYawKey */
  yaw: (LegacyYawKey | Legacy3YawKey | AbsoluteYawKey)[]
  /** per expression parameter, its own sparse track sorted by yaw (absolute only; legacy-delta: {}) */
  expr: Record<string, ExprKey[]>
}

/** A family of presets: the ONE authority for which curves belong to it. */
export interface FamilyRecord extends BaseRecord<'family', RecordId<FamilyRecord>> {
  name: string
  curves: RecordId<CurveRecord>[]
}
/** A preset: its family is the ONE authority for preset membership. */
export interface PresetRecord extends BaseRecord<'preset', RecordId<PresetRecord>> {
  name: string
  familyId: RecordId<FamilyRecord>
}
/**
 * An expression parameter of a family (blinkL, blinkR, …): it NAMES the curves it acts on (doc 18 §29 I-1, dot
 * 1791342672 — never guessed from which curves happen to have keys). Value 0 = the neutral forms, 1 = the curves'
 * expression keyframes. Replaces the old `rule` record (schema 3).
 */
export interface ExpressionParamRecord extends BaseRecord<'expressionParam', RecordId<ExpressionParamRecord>> {
  familyId: RecordId<FamilyRecord>
  name: string
  curves: RecordId<CurveRecord>[]
}
/** A helper domain: used to initialise / rebuild a preset's form at one yaw, never during playback. */
export interface HelperDomainRecord extends BaseRecord<'helperDomain', RecordId<HelperDomainRecord>> {
  presetId: RecordId<PresetRecord>
  yaw: number
  affine: Affine
  source: { yaw: number }
  target: { yaw: number }
  ruleVersion: number
}
export type PointDelta = { dp: Vec; dIn: Vec; dOut: Vec }
export type Takeover =
  | { kind: 'line'; id: string; curveId: RecordId<CurveRecord>; state: { yaw: number }; direction: { from: number; to: number }; target: Shape; basisFront: Shape; L: [number, number, number, number] }
  | { kind: 'node'; id: string; connectionId: RecordId<ConnectionRecord>; state: { yaw: number }; direction: { from: number; to: number }; target: Vec; basisFront: Vec; L: [number, number, number, number]; basisFrom: string | BlendBasis | ClearedLineBasis }
/** The node's L was copied from a line takeover that was cleared since (history only; the copied L stays the authority). */
export type ClearedLineBasis = { kind: 'clearedLine'; id: string }
/** Where a node takeover's copied L came from when no line takeover provided it: the weighted helper domains (§24.2). */
export type BlendBasis = { kind: 'blend'; yaw: number; weights: Record<string, number> }
/**
 * A character's own expression keyframe of one curve (its full shape at value 1 of `param`, at `yaw`). `origin:
 * 'converted'` = written by the schema-3 conversion to keep an old file's picture (the old rule's result), not drawn by
 * the author; an author edit of that keyframe drops the mark.
 */
export type ExprFix = { id: string; curveId: RecordId<CurveRecord>; param: string; yaw: number; shape: Shape; origin?: 'converted' }
/** A character: weights, front fine-tune (offsets over the preset blend), takeovers with frozen L, expression fixes. */
export interface CharacterRecord extends BaseRecord<'character', RecordId<CharacterRecord>> {
  name: string
  familyId: RecordId<FamilyRecord>
  weights: Record<string, number>
  fineTune: Record<string, Record<string, PointDelta>>
  takeovers: Takeover[]
  exprFixes: ExprFix[]
}
/** Visibility of a curve as its own stepped track (instant switch), separate from shape. */
export interface VisibilityRecord extends BaseRecord<'visibility', RecordId<VisibilityRecord>> {
  curveId: RecordId<CurveRecord>
  owner: FormsOwner
  mode: 'step'
  keys: { yaw: number; visible: boolean }[]
}

/**
 * A mask (doc 18 §1.7b, §29.2b; bowen 1791280741 / 1791342631): hide (or show only) the targets inside a region.
 * The region = the union of the source fills' areas and the source curves' stroke areas (actual stroke width), taken
 * from the same evaluation BEFORE any mask applies; a hidden source still masks (Compositor LiveMaskTests); only
 * `enabled: false` turns it off. `inside` = the targets show only inside the region; `outside` = they are hidden inside
 * it. Several masks on one target all apply (AND). Paint order is not changed.
 */
export interface MaskRecord extends BaseRecord<'mask', RecordId<MaskRecord>> {
  name: string
  sources: { fills: RecordId<FillRecord>[]; strokes: RecordId<CurveRecord>[] }
  /** curves (their stroke), fills, or containers (everything drawn inside them) */
  targets: string[]
  mode: 'inside' | 'outside'
  enabled: boolean
}

export type DocRecord =
  | ContainerRecord
  | CurveRecord
  | ConnectionRecord
  | FillRecord
  | ReferenceRecord
  | FormsRecord
  | FamilyRecord
  | PresetRecord
  | ExpressionParamRecord
  | HelperDomainRecord
  | CharacterRecord
  | VisibilityRecord
  | MaskRecord

const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const isVec = (v: any) => v && isNum(v.x) && isNum(v.y)
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

export const Container = createRecordType<ContainerRecord>('container', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(typeof r.name === 'string', 'container.name')
      check(typeof r.visible === 'boolean' && typeof r.locked === 'boolean', 'container flags')
      check(isNum(r.opacity) && r.opacity >= 0 && r.opacity <= 1, 'container.opacity')
      return r
    },
  },
}).withDefaultProperties(() => ({ tags: [], parentId: null, index: 'a0', visible: true, locked: false, opacity: 1 }))

export const Curve = createRecordType<CurveRecord>('curve', {
  scope: 'document',
  validator: {
    validate(r: any) {
      for (const a of Object.values(r.anchors) as Anchor[]) {
        check(isVec(a.p) && isVec(a.hIn) && isVec(a.hOut), `curve ${r.id} anchor ${a.id} not finite`)
      }
      const seen = new Set<string>()
      for (const s of r.segments as Segment[]) {
        check(r.anchors[s.from] && r.anchors[s.to], `curve ${r.id} segment ${s.id} dangling`)
        // topology identity (stage 2b review): a segment id once per curve, never from an anchor to itself
        check(!seen.has(s.id), `curve ${r.id} segment id ${s.id} is used twice`)
        check(s.from !== s.to, `curve ${r.id} segment ${s.id} goes from ${s.from} to itself`)
        seen.add(s.id)
      }
      for (const [k, a] of Object.entries(r.anchors) as [string, Anchor][]) check(a.id === k, `curve ${r.id} anchor key ${k} holds id ${a.id}`)
      return r
    },
  },
}).withDefaultProperties(() => ({ tags: [], index: 'a0', closed: false, stroke: { color: '#222', width: 2 }, depthOffset: 0 }))

export const Connection = createRecordType<ConnectionRecord>('connection', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(Array.isArray(r.ends) && r.ends.length >= 2, 'connection needs 2+ ends')
      return r
    },
  },
}).withDefaultProperties(() => ({ geometricJoin: 'corner' as const }))

export const Fill = createRecordType<FillRecord>('fill', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(Array.isArray(r.boundary) && r.boundary.length > 0, 'fill.boundary')
      const end = (e: any) => isObj(e) && typeof e.curveId === 'string' && typeof e.anchorId === 'string'
      r.boundary.forEach((b: any, i: number) =>
        check(isObj(b) && (isObj(b.bridge) ? end(b.bridge.from) && end(b.bridge.to) : typeof b.curveId === 'string' && typeof b.segmentId === 'string' && (b.dir === 1 || b.dir === -1)), `fill ${r.id} boundary step ${i}`),
      )
      return r
    },
  },
}).withDefaultProperties(() => ({ index: 'a0', color: '#f3d9c4', depthOffset: 0 }))

export const Reference = createRecordType<ReferenceRecord>('reference', {
  scope: 'document',
  validator: {
    validate(r: any) {
      const t = r.transform
      check(t && [t.a, t.b, t.c, t.d, t.e, t.f].every(isNum), `reference ${r.id} transform not finite`)
      for (const [k, v] of Object.entries(r.overrides ?? {})) check(isVec(v), `reference ${r.id} override ${k} not finite`)
      return r
    },
  },
}).withDefaultProperties(() => ({ index: 'a0', overrides: {} }))

const isObj = (o: unknown) => !!o && typeof o === 'object' && !Array.isArray(o)
const isOwner = (o: any) => isObj(o) && (o.kind === 'document' || (o.kind === 'preset' && typeof o.id === 'string'))
const isStrArr = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string')
const isShape = (sh: any) => sh && typeof sh === 'object' && Object.values(sh).every((a: any) => a && isVec(a.p) && isVec(a.hIn) && isVec(a.hOut))
const sortedUnique = (keys: { yaw: unknown }[], what: string) =>
  keys.forEach((k, i) => {
    check(isObj(k), `${what} key ${i} is not an object`)
    check(isNum(k.yaw), `${what} key ${i} yaw not finite`)
    if (i > 0) check((k.yaw as number) > (keys[i - 1].yaw as number), `${what} keys not sorted by yaw / duplicate yaw`)
  })

export const Forms = createRecordType<FormsRecord>('forms', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(r.encoding === 'legacy-delta' || r.encoding === 'legacy-delta3' || r.encoding === 'absolute', `forms ${r.id} encoding`)
      check(typeof r.curveId === 'string', `forms ${r.id} curveId`)
      check(isOwner(r.owner), `forms ${r.id} owner`)
      check(Array.isArray(r.yaw), `forms ${r.id} yaw`)
      check(isObj(r.expr), `forms ${r.id} expr (required; {} when none)`)
      sortedUnique(r.yaw, `forms ${r.id}`)
      if (r.encoding === 'legacy-delta' || r.encoding === 'legacy-delta3') {
        check(r.owner?.kind === 'document' && r.original === 'curve', `forms ${r.id}: ${r.encoding} is owned by the document with original 'curve'`)
        for (const k of r.yaw) {
          check(isObj(k.offsets), `forms ${r.id} offsets at ${k.yaw} (an object; {} when none)`)
          for (const [a, o] of Object.entries(k.offsets) as [string, any][])
            if (r.encoding === 'legacy-delta') check(isVec(o), `forms ${r.id} offset ${a} at ${k.yaw} not finite`)
            else check(isObj(o) && isVec(o.dp) && isVec(o.dIn) && isVec(o.dOut), `forms ${r.id} offset ${a} at ${k.yaw} (dp / dIn / dOut)`)
        }
        check(r.expr && Object.keys(r.expr).length === 0, `forms ${r.id}: legacy-delta has no expression tracks`)
      } else {
        check(r.owner?.kind === 'preset' && typeof r.owner.id === 'string', `forms ${r.id}: absolute forms are owned by a preset`)
        check(r.original === null || isShape(r.original), `forms ${r.id} original`)
        for (const k of r.yaw) check(isShape(k.shape), `forms ${r.id} shape at ${k.yaw} not finite`)
        for (const [param, keys] of Object.entries(r.expr ?? {}) as [string, any[]][]) {
          check(Array.isArray(keys), `forms ${r.id} expr ${param}`)
          sortedUnique(keys, `forms ${r.id} expr ${param}`)
          for (const k of keys) check(isShape(k.shape), `forms ${r.id} expr ${param} key at ${k.yaw} (a full shape)`)
        }
      }
      return r
    },
  },
}).withDefaultProperties(() => ({ yaw: [], expr: {} }))

/** The one migrated legacy head-turn track of a curve (old name kept: it is what `setPoseKey` writes). */
export const legacyFormsIdOf = (curveId: string) => Forms.createId(`document/${curveId}`)
export const poseIdOf = legacyFormsIdOf

export const Family = createRecordType<FamilyRecord>('family', {
  scope: 'document',
  validator: { validate: (r: any) => (check(typeof r.name === 'string' && isStrArr(r.curves) && new Set(r.curves).size === r.curves.length, `family ${r.id} (name, unique curve ids)`), r) },
})
export const Preset = createRecordType<PresetRecord>('preset', {
  scope: 'document',
  validator: { validate: (r: any) => (check(typeof r.name === 'string' && typeof r.familyId === 'string', `preset ${r.id}`), r) },
})
export const Mask = createRecordType<MaskRecord>('mask', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(typeof r.name === 'string' && isObj(r.sources) && isStrArr(r.sources.fills) && isStrArr(r.sources.strokes), `mask ${r.id} (name, sources.fills, sources.strokes)`)
      check(r.sources.fills.length + r.sources.strokes.length > 0, `mask ${r.id} has no source`)
      check(isStrArr(r.targets) && r.targets.length > 0 && new Set(r.targets).size === r.targets.length, `mask ${r.id} targets (unique ids, at least one)`)
      check((r.mode === 'inside' || r.mode === 'outside') && typeof r.enabled === 'boolean', `mask ${r.id} (mode inside / outside, enabled)`)
      return r
    },
  },
}).withDefaultProperties(() => ({ name: 'mask', enabled: true }))
export const ExpressionParam = createRecordType<ExpressionParamRecord>('expressionParam', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(typeof r.familyId === 'string' && typeof r.name === 'string' && r.name.length > 0, `expressionParam ${r.id} (familyId, name)`)
      check(isStrArr(r.curves) && new Set(r.curves).size === r.curves.length, `expressionParam ${r.id} curves (unique curve ids)`)
      return r
    },
  },
})
export const HelperDomain = createRecordType<HelperDomainRecord>('helperDomain', {
  scope: 'document',
  validator: {
    validate(r: any) {
      const t = r.affine
      check(typeof r.presetId === 'string' && isNum(r.yaw) && t && [t.a, t.b, t.c, t.d, t.e, t.f].every(isNum) && isNum(r.ruleVersion), `helperDomain ${r.id}`)
      check(isObj(r.source) && isNum(r.source.yaw) && isObj(r.target) && isNum(r.target.yaw), `helperDomain ${r.id} source / target yaw`)
      return r
    },
  },
})
const isL = (L: any) => Array.isArray(L) && L.length === 4 && L.every(isNum)
export const Character = createRecordType<CharacterRecord>('character', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(typeof r.name === 'string' && typeof r.familyId === 'string', `character ${r.id}`)
      // every field is required (defaults apply only when a record is CREATED): what is validated is what is read
      check(isObj(r.weights) && isObj(r.fineTune) && Array.isArray(r.takeovers) && Array.isArray(r.exprFixes), `character ${r.id} weights / fineTune / takeovers / exprFixes`)
      for (const [p, w] of Object.entries(r.weights)) check(isNum(w), `character ${r.id} weight ${p}`)
      for (const [c, as] of Object.entries(r.fineTune) as [string, any][]) {
        check(isObj(as), `character ${r.id} fineTune ${c}`)
        for (const [a, d] of Object.entries(as)) check(isObj(d) && isVec((d as any).dp) && isVec((d as any).dIn) && isVec((d as any).dOut), `character ${r.id} fineTune ${c}#${a}`)
      }
      for (const t of r.takeovers) {
        check(isObj(t) && typeof t.id === 'string', `character ${r.id} takeover id`)
        check(isL(t.L) && isNum(t.state?.yaw) && isNum(t.direction?.from) && isNum(t.direction?.to), `character ${r.id} takeover ${t.id}`)
        if (t.kind === 'line') check(typeof t.curveId === 'string' && isShape(t.target) && isShape(t.basisFront), `character ${r.id} takeover ${t.id} shapes`)
        else
          check(
            t.kind === 'node' && typeof t.connectionId === 'string' && isVec(t.target) && isVec(t.basisFront) &&
              (typeof t.basisFrom === 'string' ||
                (isObj(t.basisFrom) && t.basisFrom.kind === 'blend' && isNum(t.basisFrom.yaw) && isObj(t.basisFrom.weights) && Object.values(t.basisFrom.weights).every(isNum)) ||
                (isObj(t.basisFrom) && t.basisFrom.kind === 'clearedLine' && typeof t.basisFrom.id === 'string')),
            `character ${r.id} takeover ${t.id}`,
          )
      }
      for (const f of r.exprFixes) check(isObj(f) && typeof f.id === 'string' && typeof f.curveId === 'string' && typeof f.param === 'string' && isNum(f.yaw) && isShape(f.shape) && (f.origin === undefined || f.origin === 'converted'), `character ${r.id} exprFix ${f?.id} (curveId, param, yaw, shape, origin)`)
      return r
    },
  },
}).withDefaultProperties(() => ({ weights: {}, fineTune: {}, takeovers: [], exprFixes: [] }))
export const Visibility = createRecordType<VisibilityRecord>('visibility', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(r.mode === 'step' && Array.isArray(r.keys) && typeof r.curveId === 'string' && isOwner(r.owner), `visibility ${r.id} (mode, keys, curveId, owner)`)
      sortedUnique(r.keys, `visibility ${r.id}`)
      for (const k of r.keys) check(typeof k.visible === 'boolean', `visibility ${r.id} key ${k.yaw}`)
      return r
    },
  },
})

/**
 * Schema 1 → 2 (doc 18 samples/stage1-archive.md §4): every old `pose` record becomes the curve's legacy
 * forms record, keys moved as they are (yaw and offsets unchanged; missing anchor = 0 stays the meaning).
 * Store-scoped because the record TYPE changes; retroactive, so files saved before this sequence existed
 * are migrated on open.
 */
/** Old poses that the migration could not move without overwriting a record (refused with this reason). */
export function legacyMigrationConflicts(store: Record<string, any>): string[] {
  return Object.entries(store)
    .filter(([, r]) => r?.typeName === 'pose' && store[legacyFormsIdOf(r.curveId)])
    .map(([id, r]) => `migration: ${id} would become ${legacyFormsIdOf(r.curveId)}, which already exists`)
}

export const documentMigrations = createMigrationSequence({
  sequenceId: 'contour.document',
  retroactive: true,
  sequence: [
    {
      id: 'contour.document/1',
      scope: 'store',
      up(store: any) {
        for (const [id, r] of Object.entries(store) as [string, any][]) {
          if (r.typeName !== 'pose') continue
          const nid = legacyFormsIdOf(r.curveId)
          // never overwrite: a file holding both an old pose and a forms record with the target id is refused
          // (dot, review of 2c92206: the old pose silently replaced the existing record)
          if (store[nid]) throw new Error(`migration: ${id} would become ${nid}, which already exists`)
          delete store[id]
          store[nid] = { typeName: 'forms', id: nid, curveId: r.curveId, owner: { kind: 'document' }, encoding: 'legacy-delta', original: 'curve', yaw: r.keys, expr: {} }
        }
      },
    },
    {
      // Schema 2 → 3 (doc 18 §27 / §29 I-1): expressions become the author's keyframes; the generation rule goes.
      // Every converted shape is the OLD EVALUATED result (dot 1791342672: base 10, target 12, current base 11 → 13),
      // for preset keys and character fixes alike; see expressionMigration.ts.
      id: 'contour.document/2',
      scope: 'store',
      up(store: any) {
        convertRuleExpressions(store)
      },
    },
  ],
})

export const schema = StoreSchema.create<DocRecord>(
  {
    container: Container,
    curve: Curve,
    connection: Connection,
    fill: Fill,
    reference: Reference,
    forms: Forms,
    family: Family,
    preset: Preset,
    expressionParam: ExpressionParam,
    helperDomain: HelperDomain,
    character: Character,
    visibility: Visibility,
    mask: Mask,
  },
  { migrations: [documentMigrations] },
)

export type DocStore = Store<DocRecord>
/** Read-only view of the document. Everything except the Editor's write entry gets only this.
 *  `query` is tldraw's read-only derivation API (indexes); it cannot write. */
/**
 * What EVERY reader has: reads by id and enumeration, both over the same final state. Overlays (previews)
 * and plain runtime readers are only this. Membership lookups (indexes.ts) fall back to scanning
 * `allRecords` on such a reader, so ids, enumeration and membership always agree (dot, review of 3729d27).
 */
export type BaseReader = Pick<DocStore, 'get' | 'allRecords'>
/** A live store view: a BaseReader plus the reactive indexes (`query`) and snapshots. */
export type DocReader = BaseReader & Pick<DocStore, 'getStoreSnapshot' | 'serialize' | 'query'>
export const createDocStore = () => new Store<DocRecord>({ schema, props: {} })

const recordTypes = { container: Container, curve: Curve, connection: Connection, fill: Fill, reference: Reference, forms: Forms, family: Family, preset: Preset, expressionParam: ExpressionParam, helperDomain: HelperDomain, character: Character, visibility: Visibility, mask: Mask } as const
/** Run the record validators (same ones the store uses) without writing. */
export function validateRecord(r: DocRecord) {
  ;(recordTypes[r.typeName] as any).validate(r)
}

/**
 * Freeze a record deeply. @tldraw/store only freezes in development (`devFreeze`), so in production
 * a caller could mutate stored objects and bypass history and locks (dot, production-mode review).
 * We freeze on WRITE only (new or changed records), never by deep-copying the project per frame.
 */
export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as object)) deepFreeze(v)
  }
  return o
}
