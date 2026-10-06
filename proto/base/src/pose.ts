// Head-turn forms stored in the document: one PoseRecord per curve (schema.ts), edited through the
// write entry (`setPoseKey`), and PLAYED as an evaluation input — playing an angle never writes.
// Forms are per-anchor OFFSETS relative to the base drawing (11 〔待定 4〕 option 甲 — Spine deform
// keys "offsets added to the setup pose", https://en.esotericsoftware.com/spine-json-format,
// behaviour only). The 0° form is an explicit form, NOT the base drawing (fix of 09 regression ①).
// Interpolation: piecewise-linear on yaw between the keys of EACH curve (Live2D keyform linear
// interpolation, behaviour only: https://docs.live2d.com/en/cubism-editor-manual/parameter/).
// Strokes are not touched: a form moves points only; the stroke width stays the authored one (16 §3.0).
import { counters } from './counters'
import { evaluate, type Cubic, type EvalCurve, type EvalFill, type Evaluated } from './evaluate'
import { poseIdOf, type DocReader, type FillRecord, type PoseRecord, type Vec } from './schema'

const ZERO: Vec = { x: 0, y: 0 }

/** Offset of one anchor at `yaw`, from one curve's keys (clamped outside the recorded range). */
export function offsetAt(keys: PoseRecord['keys'], anchorId: string, yaw: number): Vec {
  if (!keys.length) return ZERO
  if (yaw <= keys[0].yaw) return keys[0].offsets[anchorId] ?? ZERO
  const last = keys[keys.length - 1]
  if (yaw >= last.yaw) return last.offsets[anchorId] ?? ZERO
  const i = keys.findIndex((k) => k.yaw >= yaw)
  const a = keys[i - 1]
  const b = keys[i]
  const t = (yaw - a.yaw) / (b.yaw - a.yaw)
  const oa = a.offsets[anchorId] ?? ZERO
  const ob = b.offsets[anchorId] ?? ZERO
  return { x: oa.x + (ob.x - oa.x) * t, y: oa.y + (ob.y - oa.y) * t }
}

/** One evaluated curve (base or reference instance) at `yaw`: anchors and handles shifted together. */
export function curveAtYaw(c: EvalCurve, pose: PoseRecord | undefined, yaw: number): EvalCurve {
  if (!pose || !pose.keys.length) return c
  const add = (p: Vec, o: Vec) => ({ x: p.x + o.x, y: p.y + o.y })
  const anchors = Object.fromEntries(
    Object.values(c.anchors).map((a) => {
      const o = offsetAt(pose.keys, a.id, yaw)
      return [a.id, { ...a, p: add(a.p, o), hIn: add(a.hIn, o), hOut: add(a.hOut, o) }]
    }),
  )
  const segments = c.segments.map((s) => ({ ...s, cubic: [anchors[s.from].p, anchors[s.from].hOut, anchors[s.to].hIn, anchors[s.to].p] as Cubic }))
  return { ...c, anchors, segments } // stroke unchanged
}

/** A fill at `yaw`: re-reads the moved boundary segments (still one geometry for stroke and fill). */
export function fillAtYaw(f: EvalFill, rec: FillRecord, curveOf: (id: string) => EvalCurve | undefined): EvalFill {
  return {
    ...f,
    cubics: rec.boundary.map((step) => {
      const seg = curveOf(step.curveId)!.segments.find((s) => s.id === step.segmentId)!
      const [p0, c1, c2, p3] = seg.cubic
      return step.dir === 1 ? seg.cubic : ([p3, c2, c1, p0] as Cubic)
    }),
  }
}

/**
 * Full, uncached evaluation at `yaw` — the independent reference the cached angle evaluation
 * (derived.ts) is compared against. `prepared` lets several yaws share one base evaluation.
 */
export function evaluateAtYaw(store: Pick<DocReader, 'get'> & Partial<DocReader>, yaw: number, prepared?: Evaluated): Evaluated {
  counters.fullYawEvals++
  const base = prepared ?? evaluate(store as DocReader)
  const curves = base.curves.map((c) => curveAtYaw(c, store.get(poseIdOf(c.curveId) as any) as PoseRecord | undefined, yaw))
  const byBase = new Map(curves.filter((c) => !c.referenceId).map((c) => [c.curveId as string, c]))
  const fills = base.fills.map((f) => fillAtYaw(f, store.get(f.address as any) as FillRecord, (id) => byBase.get(id)))
  return { curves, fills }
}
