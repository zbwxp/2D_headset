// Document records for the route-B slice (docs/design/architecture/11, 15).
// Storage: @tldraw/store v5.5.2 (MIT) — createRecordType / StoreSchema / Store.
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/RecordType.ts
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreSchema.ts
// Anchor = point + in/out handles (Paper.js Segment model, MIT):
//   https://github.com/paperjs/paper.js/blob/v0.12.18/src/path/Segment.js
// Connections as separate records linking anchors (tldraw bindings idea, MIT tlschema):
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/records/TLBinding.ts
import { BaseRecord, RecordId, Store, StoreSchema, createMigrationSequence, createRecordType } from '@tldraw/store'

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

export type BoundaryStep = { curveId: RecordId<CurveRecord>; segmentId: string; dir: 1 | -1 }

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
export type AbsoluteYawKey = { yaw: number; shape: Shape }
/** One key of an expression's own sparse track (§20.3): a rule key, or an author target with its base then. */
export type ExprKey = { yaw: number; kind: 'rule' } | { yaw: number; kind: 'author'; target: Shape; base: Shape; ruleVersion: number }

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
  encoding: 'legacy-delta' | 'absolute'
  /** legacy-delta: 'curve' (the curve record is the original); absolute: a shape, or null */
  original: 'curve' | Shape | null
  /** sorted by yaw, unique; legacy-delta: LegacyYawKey, absolute: AbsoluteYawKey */
  yaw: (LegacyYawKey | AbsoluteYawKey)[]
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
/** An expression rule bound to a family parameter, with its version and point correspondence. */
export interface RuleRecord extends BaseRecord<'rule', RecordId<RuleRecord>> {
  familyId: RecordId<FamilyRecord>
  param: string
  kind: string
  version: number
  roles: Record<string, RecordId<CurveRecord>>
  /** anchor of the moved role → anchor of the source role (lidClose: upper → lower) */
  correspondence: Record<string, string>
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
  | { kind: 'node'; id: string; connectionId: RecordId<ConnectionRecord>; state: { yaw: number }; direction: { from: number; to: number }; target: Vec; basisFront: Vec; L: [number, number, number, number]; basisFrom: string }
export type ExprFix = { id: string; curveId: RecordId<CurveRecord>; state: { yaw: number } & Record<string, number>; target: Shape; base: Shape; ruleVersion: number }
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

export type DocRecord =
  | ContainerRecord
  | CurveRecord
  | ConnectionRecord
  | FillRecord
  | ReferenceRecord
  | FormsRecord
  | FamilyRecord
  | PresetRecord
  | RuleRecord
  | HelperDomainRecord
  | CharacterRecord
  | VisibilityRecord

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
      for (const s of r.segments as Segment[]) {
        check(r.anchors[s.from] && r.anchors[s.to], `curve ${r.id} segment ${s.id} dangling`)
      }
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
  validator: { validate: (r: any) => (check(r.boundary.length > 0, 'fill.boundary'), r) },
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

const isShape = (sh: any) => sh && typeof sh === 'object' && Object.values(sh).every((a: any) => a && isVec(a.p) && isVec(a.hIn) && isVec(a.hOut))
const sortedUnique = (keys: { yaw: unknown }[], what: string) =>
  keys.forEach((k, i) => {
    check(isNum(k.yaw), `${what} key ${i} yaw not finite`)
    if (i > 0) check((k.yaw as number) > (keys[i - 1].yaw as number), `${what} keys not sorted by yaw / duplicate yaw`)
  })

export const Forms = createRecordType<FormsRecord>('forms', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(r.encoding === 'legacy-delta' || r.encoding === 'absolute', `forms ${r.id} encoding`)
      check(Array.isArray(r.yaw), `forms ${r.id} yaw`)
      sortedUnique(r.yaw, `forms ${r.id}`)
      if (r.encoding === 'legacy-delta') {
        check(r.owner?.kind === 'document' && r.original === 'curve', `forms ${r.id}: legacy-delta is owned by the document with original 'curve'`)
        for (const k of r.yaw) for (const [a, o] of Object.entries(k.offsets ?? {})) check(isVec(o), `forms ${r.id} offset ${a} at ${k.yaw} not finite`)
        check(r.expr && Object.keys(r.expr).length === 0, `forms ${r.id}: legacy-delta has no expression tracks`)
      } else {
        check(r.owner?.kind === 'preset' && typeof r.owner.id === 'string', `forms ${r.id}: absolute forms are owned by a preset`)
        check(r.original === null || isShape(r.original), `forms ${r.id} original`)
        for (const k of r.yaw) check(isShape(k.shape), `forms ${r.id} shape at ${k.yaw} not finite`)
        for (const [param, keys] of Object.entries(r.expr ?? {}) as [string, any[]][]) {
          check(Array.isArray(keys), `forms ${r.id} expr ${param}`)
          sortedUnique(keys, `forms ${r.id} expr ${param}`)
          for (const k of keys) {
            check(k.kind === 'rule' || k.kind === 'author', `forms ${r.id} expr ${param} kind`)
            if (k.kind === 'author') check(isShape(k.target) && isShape(k.base) && isNum(k.ruleVersion), `forms ${r.id} expr ${param} author key at ${k.yaw}`)
          }
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
  validator: { validate: (r: any) => (check(typeof r.name === 'string' && Array.isArray(r.curves), `family ${r.id}`), r) },
})
export const Preset = createRecordType<PresetRecord>('preset', {
  scope: 'document',
  validator: { validate: (r: any) => (check(typeof r.name === 'string' && typeof r.familyId === 'string', `preset ${r.id}`), r) },
})
export const Rule = createRecordType<RuleRecord>('rule', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(typeof r.param === 'string' && typeof r.kind === 'string' && isNum(r.version), `rule ${r.id}`)
      check(r.roles && typeof r.roles === 'object' && r.correspondence && typeof r.correspondence === 'object', `rule ${r.id} roles / correspondence`)
      return r
    },
  },
})
export const HelperDomain = createRecordType<HelperDomainRecord>('helperDomain', {
  scope: 'document',
  validator: {
    validate(r: any) {
      const t = r.affine
      check(isNum(r.yaw) && t && [t.a, t.b, t.c, t.d, t.e, t.f].every(isNum) && isNum(r.ruleVersion), `helperDomain ${r.id}`)
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
      for (const [p, w] of Object.entries(r.weights ?? {})) check(isNum(w), `character ${r.id} weight ${p}`)
      for (const [c, as] of Object.entries(r.fineTune ?? {}) as [string, any][])
        for (const [a, d] of Object.entries(as)) check(isVec((d as any).dp) && isVec((d as any).dIn) && isVec((d as any).dOut), `character ${r.id} fineTune ${c}#${a}`)
      for (const t of r.takeovers ?? []) {
        check(isL(t.L) && isNum(t.state?.yaw) && isNum(t.direction?.from) && isNum(t.direction?.to), `character ${r.id} takeover ${t.id}`)
        if (t.kind === 'line') check(isShape(t.target) && isShape(t.basisFront), `character ${r.id} takeover ${t.id} shapes`)
        else check(t.kind === 'node' && isVec(t.target) && isVec(t.basisFront) && typeof t.basisFrom === 'string', `character ${r.id} takeover ${t.id}`)
      }
      for (const f of r.exprFixes ?? []) check(isShape(f.target) && isShape(f.base) && isNum(f.ruleVersion) && isNum(f.state?.yaw), `character ${r.id} exprFix ${f.id}`)
      return r
    },
  },
}).withDefaultProperties(() => ({ weights: {}, fineTune: {}, takeovers: [], exprFixes: [] }))
export const Visibility = createRecordType<VisibilityRecord>('visibility', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(r.mode === 'step' && Array.isArray(r.keys), `visibility ${r.id}`)
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
          delete store[id]
          const nid = legacyFormsIdOf(r.curveId)
          store[nid] = { typeName: 'forms', id: nid, curveId: r.curveId, owner: { kind: 'document' }, encoding: 'legacy-delta', original: 'curve', yaw: r.keys, expr: {} }
        }
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
    rule: Rule,
    helperDomain: HelperDomain,
    character: Character,
    visibility: Visibility,
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

const recordTypes = { container: Container, curve: Curve, connection: Connection, fill: Fill, reference: Reference, forms: Forms, family: Family, preset: Preset, rule: Rule, helperDomain: HelperDomain, character: Character, visibility: Visibility } as const
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
