// Thinnest possible "recording" layer for the slice (15 §5: 0°/90° forms + 30° evaluation check,
// and the input for the onion-skin benchmark). Forms are stored as per-anchor OFFSETS relative to the
// base drawing (11 〔待定 4〕 option 甲 — Spine deform keys "offsets added to the setup pose",
//   https://en.esotericsoftware.com/spine-json-format (behaviour only)).
// The 0° form is an explicit form, NOT the base drawing (fix of 09 regression ①).
// Interpolation: piecewise-linear on yaw between the keys of each curve (Live2D keyform linear
// interpolation, behaviour only: https://docs.live2d.com/en/cubism-editor-manual/parameter/).
// Not stored in the document yet: this is a read-only evaluation input for the benchmark.
import type { CurveRecord, DocStore, Vec } from './schema'
import { evaluate, type Evaluated } from './evaluate'

export type PoseKey = { yaw: number; offsets: Record<string, Vec> } // key: `${curveId}#${anchorId}`
export type PoseTrack = PoseKey[] // sorted by yaw

export function offsetAt(track: PoseTrack, key: string, yaw: number): Vec {
  if (!track.length) return { x: 0, y: 0 }
  const keys = [...track].sort((a, b) => a.yaw - b.yaw)
  if (yaw <= keys[0].yaw) return keys[0].offsets[key] ?? { x: 0, y: 0 }
  if (yaw >= keys.at(-1)!.yaw) return keys.at(-1)!.offsets[key] ?? { x: 0, y: 0 }
  const i = keys.findIndex((k) => k.yaw >= yaw)
  const a = keys[i - 1]
  const b = keys[i]
  const t = (yaw - a.yaw) / (b.yaw - a.yaw)
  const oa = a.offsets[key] ?? { x: 0, y: 0 }
  const ob = b.offsets[key] ?? { x: 0, y: 0 }
  return { x: oa.x + (ob.x - oa.x) * t, y: oa.y + (ob.y - oa.y) * t }
}

/**
 * Evaluate the document at a yaw: base anchors + interpolated offsets (handles move with their anchor
 * in this thin version). Reuses `evaluate` for everything else so the same geometry rules apply.
 * `prepared` lets several onion-skin yaws share one base evaluation (15 §2 onion requirements).
 */
export function evaluateAtYaw(store: DocStore, track: PoseTrack, yaw: number, prepared: Evaluated = evaluate(store)): Evaluated {
  const shift = (curveId: string, anchorId: string) => offsetAt(track, `${curveId}#${anchorId}`, yaw)
  const add = (p: Vec, o: Vec) => ({ x: p.x + o.x, y: p.y + o.y })
  const curves = prepared.curves.map((c) => {
    const anchors = Object.fromEntries(
      Object.values(c.anchors).map((a) => {
        const o = shift(c.curveId, a.id)
        return [a.id, { ...a, p: add(a.p, o), hIn: add(a.hIn, o), hOut: add(a.hOut, o) }]
      }),
    )
    const segments = c.segments.map((s) => {
      const A = anchors[s.from]
      const B = anchors[s.to]
      return { ...s, cubic: [A.p, A.hOut, B.hIn, B.p] as [Vec, Vec, Vec, Vec] }
    })
    return { ...c, anchors, segments }
  })
  // Fills re-read the moved segments — still one geometry for stroke and fill.
  return { curves, fills: recomputeFills(store, curves, prepared.fills) }
}

function recomputeFills(store: DocStore, curves: Evaluated['curves'], fills: Evaluated['fills']): Evaluated['fills'] {
  const by = new Map(curves.filter((c) => !c.referenceId).map((c) => [c.curveId as string, c]))
  return fills.map((f) => {
    const rec = store.get(f.address as any) as any
    const cubics = rec.boundary.map((step: { curveId: string; segmentId: string; dir: 1 | -1 }) => {
      const seg = by.get(step.curveId)!.segments.find((s) => s.id === step.segmentId)!
      const [p0, c1, c2, p3] = seg.cubic
      return step.dir === 1 ? seg.cubic : [p3, c2, c1, p0]
    })
    return { ...f, cubics }
  })
}

export const curveIdsOf = (store: DocStore) => store.allRecords().filter((r) => r.typeName === 'curve') as CurveRecord[]
