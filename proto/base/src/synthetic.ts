// Synthetic workload for the onion-skin benchmark (15 §2). Deterministic, no randomness.
// Shape: `curves` open curves (4 anchors, 3 segments) in `layers` layers, chained by connections
// within each layer, plus `fills` closed 4-segment loops used as fill boundaries.
// It is NOT the old 121-curve face; numbers from it are absolute only (15 §5, dot).
import { Connection, Container, Curve, Fill, Forms, poseIdOf, type Anchor, type CurveRecord, type DocRecord, type FormsRecord } from './schema'

const v = (x: number, y: number) => ({ x, y })
const anchor = (id: string, x: number, y: number): Anchor => ({ id, p: v(x, y), hIn: v(-4, 0), hOut: v(4, 0) })

export function syntheticRecords(opts: { curves: number; layers: number; fills: number; fillSize?: number; fillSpacing?: number; fillCols?: number }) {
  // defaults keep the original small, non-overlapping 20×20 loops; larger size / smaller spacing overlap
  const size = opts.fillSize ?? 20
  const cols = opts.fillCols ?? 5
  const sx = opts.fillSpacing ?? 40
  const sy = opts.fillSpacing ?? 30
  const records: DocRecord[] = []
  const layerIds = Array.from({ length: opts.layers }, (_, i) => Container.createId(`S${i}`))
  layerIds.forEach((id, i) => records.push(Container.create({ id, name: `layer ${i}`, index: `a${i}` })))
  const curveIds: ReturnType<typeof Curve.createId>[] = []
  for (let i = 0; i < opts.curves; i++) {
    const id = Curve.createId(`S${i}`)
    curveIds.push(id)
    const row = Math.floor(i / 11)
    const col = i % 11
    const x0 = col * 18
    const y0 = row * 14
    records.push(
      Curve.create({
        id,
        name: `curve ${i}`,
        parentId: layerIds[i % opts.layers],
        index: `a${i}`,
        anchors: { p0: anchor('p0', x0, y0), p1: anchor('p1', x0 + 5, y0 + 4), p2: anchor('p2', x0 + 10, y0 + 2), p3: anchor('p3', x0 + 15, y0 + 6) },
        segments: [
          { id: 'g0', from: 'p0', to: 'p1' },
          { id: 'g1', from: 'p1', to: 'p2' },
          { id: 'g2', from: 'p2', to: 'p3' },
        ],
      }),
    )
  }
  // chain consecutive curves that share a layer: end of one ⟷ start of the next
  for (let i = 0; i + opts.layers < opts.curves; i++) {
    records.push(Connection.create({ id: Connection.createId(`S${i}`), ends: [{ curveId: curveIds[i], anchorId: 'p3' }, { curveId: curveIds[i + opts.layers], anchorId: 'p0' }] }))
  }
  for (let i = 0; i < opts.fills; i++) {
    const id = Curve.createId(`L${i}`)
    const x0 = (i % cols) * sx
    const y0 = 160 + Math.floor(i / cols) * sy
    records.push(
      Curve.create({
        id,
        name: `loop ${i}`,
        parentId: layerIds[i % opts.layers],
        index: `b${i}`,
        anchors: { q0: anchor('q0', x0, y0), q1: anchor('q1', x0 + size, y0), q2: anchor('q2', x0 + size, y0 + size), q3: anchor('q3', x0, y0 + size) },
        segments: [
          { id: 'h0', from: 'q0', to: 'q1' },
          { id: 'h1', from: 'q1', to: 'q2' },
          { id: 'h2', from: 'q2', to: 'q3' },
          { id: 'h3', from: 'q3', to: 'q0' },
        ],
        closed: true,
      }),
      Fill.create({
        id: Fill.createId(`L${i}`),
        name: `fill ${i}`,
        parentId: layerIds[i % opts.layers],
        index: `c${i}`,
        boundary: ['h0', 'h1', 'h2', 'h3'].map((segmentId) => ({ curveId: id, segmentId, dir: 1 as const })),
      }),
    )
  }
  return records
}

/** One pose record per curve: 0° and ±90° forms with an offset for every anchor (every onion yaw differs). */
export function syntheticPoses(records: DocRecord[]): FormsRecord[] {
  return records
    .filter((r): r is CurveRecord => r.typeName === 'curve')
    .map((c) => {
      const at = (sign: number) => Object.fromEntries(Object.keys(c.anchors).map((a) => [a, { x: 12 * sign, y: (a.charCodeAt(1) % 3) - 1 }]))
      return Forms.create({ id: poseIdOf(c.id), curveId: c.id, owner: { kind: 'document' }, encoding: 'legacy-delta', original: 'curve', yaw: [{ yaw: -90, offsets: at(-1) }, { yaw: 0, offsets: {} }, { yaw: 90, offsets: at(1) }], expr: {} })
    })
}

/** 19 onion yaws from −90° to 90° in 10° steps (the old report's onion count; not its workload). */
export const onionYaws = (n = 19) => Array.from({ length: n }, (_, i) => -90 + (180 / (n - 1)) * i)
