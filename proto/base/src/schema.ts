// Document records for the route-B slice (docs/design/architecture/11, 15).
// Storage: @tldraw/store v5.5.2 (MIT) — createRecordType / StoreSchema / Store.
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/RecordType.ts
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreSchema.ts
// Anchor = point + in/out handles (Paper.js Segment model, MIT):
//   https://github.com/paperjs/paper.js/blob/v0.12.18/src/path/Segment.js
// Connections as separate records linking anchors (tldraw bindings idea, MIT tlschema):
//   https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/records/TLBinding.ts
import { BaseRecord, RecordId, Store, StoreSchema, createRecordType } from '@tldraw/store'

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

/**
 * Recorded forms of ONE curve at angles (the head turn). One pose per curve; its id is derived from
 * the curve id (`poseIdOf`), so it never needs an index and a plan always names the same record.
 * Offsets are relative to the base drawing (11 〔待定 4〕 option 甲); keys are interpolated per curve.
 */
export interface PoseRecord extends BaseRecord<'pose', RecordId<PoseRecord>> {
  curveId: RecordId<CurveRecord>
  /** sorted by yaw, yaws unique; an anchor missing from a key has offset 0 there */
  keys: { yaw: number; offsets: Record<string, Vec> }[]
}

export type DocRecord = ContainerRecord | CurveRecord | ConnectionRecord | FillRecord | ReferenceRecord | PoseRecord

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

export const Pose = createRecordType<PoseRecord>('pose', {
  scope: 'document',
  validator: {
    validate(r: any) {
      check(Array.isArray(r.keys), `pose ${r.id} keys`)
      r.keys.forEach((k: any, i: number) => {
        check(isNum(k.yaw), `pose ${r.id} key ${i} yaw not finite`)
        if (i > 0) check(k.yaw > r.keys[i - 1].yaw, `pose ${r.id} keys not sorted by yaw / duplicate yaw`)
        for (const [a, o] of Object.entries(k.offsets ?? {})) check(isVec(o), `pose ${r.id} offset ${a} at ${k.yaw} not finite`)
      })
      return r
    },
  },
}).withDefaultProperties(() => ({ keys: [] }))

/** The one pose record of a curve. */
export const poseIdOf = (curveId: string) => Pose.createId(curveId.replace(/^curve:/, ''))

export const schema = StoreSchema.create<DocRecord>({
  container: Container,
  curve: Curve,
  connection: Connection,
  fill: Fill,
  reference: Reference,
  pose: Pose,
})

export type DocStore = Store<DocRecord>
/** Read-only view of the document. Everything except the Editor's write entry gets only this.
 *  `query` is tldraw's read-only derivation API (indexes); it cannot write. */
export type DocReader = Pick<DocStore, 'get' | 'allRecords' | 'getStoreSnapshot' | 'serialize' | 'query'>
export const createDocStore = () => new Store<DocRecord>({ schema, props: {} })

const recordTypes = { container: Container, curve: Curve, connection: Connection, fill: Fill, reference: Reference, pose: Pose } as const
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
