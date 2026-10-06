// The example drawing from docs/design/architecture/11 §1 (plus one reference, per 15 §2).
//
// 画稿 D
// ├─ L1「轮廓」          C1「左片·外下颌」 a1→a2→a3 (s1, s2); R1 → L3 (mirrored)
// ├─ L2「阴影」 locked   C2「右片·外下颌」 b1→b2→b3 (s3, s4); F = s1,s2 → J → s4,s3 → J0
// ├─ L3「耳朵」          E1 e1→e2 (s5)
// ├─ J : a3 ⟷ b3  (chin, cross-layer)
// └─ J0: a1 ⟷ b1  (top, closes the fill boundary)
import { Connection, Container, Curve, Fill, Reference, type Anchor, type DocRecord } from './schema'

const v = (x: number, y: number) => ({ x, y })
const anchor = (id: string, x: number, y: number, hIn = v(0, 0), hOut = v(0, 0)): Anchor => ({ id, p: v(x, y), hIn, hOut })

export const ids = {
  L1: Container.createId('L1'),
  L2: Container.createId('L2'),
  L3: Container.createId('L3'),
  C1: Curve.createId('C1'),
  C2: Curve.createId('C2'),
  E1: Curve.createId('E1'),
  J: Connection.createId('J'),
  J0: Connection.createId('J0'),
  F: Fill.createId('F'),
  R1: Reference.createId('R1'),
}

export function exampleRecords(): DocRecord[] {
  return [
    Container.create({ id: ids.L1, name: '轮廓', tags: ['轮廓'], index: 'a1' }),
    Container.create({ id: ids.L2, name: '阴影', index: 'a2', locked: true }),
    Container.create({ id: ids.L3, name: '耳朵', index: 'a3' }),
    Curve.create({
      id: ids.C1,
      name: '左片·外下颌',
      tags: ['左侧', '下颌', '轮廓'],
      parentId: ids.L1,
      index: 'a1',
      anchors: { a1: anchor('a1', 0, 0), a2: anchor('a2', 10, 60, v(0, -20), v(0, 20)), a3: anchor('a3', 60, 100) },
      segments: [
        { id: 's1', from: 'a1', to: 'a2' },
        { id: 's2', from: 'a2', to: 'a3' },
      ],
    }),
    Curve.create({
      id: ids.C2,
      name: '右片·外下颌',
      tags: ['右侧', '下颌', '轮廓'],
      parentId: ids.L2,
      index: 'a1',
      anchors: { b1: anchor('b1', 0, 0), b2: anchor('b2', 80, 50, v(-10, -20), v(10, 20)), b3: anchor('b3', 60, 100) },
      segments: [
        { id: 's3', from: 'b1', to: 'b2' },
        { id: 's4', from: 'b2', to: 'b3' },
      ],
    }),
    Curve.create({
      id: ids.E1,
      name: '左耳',
      tags: ['左侧', '耳朵'],
      parentId: ids.L3,
      index: 'a1',
      anchors: { e1: anchor('e1', -20, 20), e2: anchor('e2', -30, 50) },
      segments: [{ id: 's5', from: 'e1', to: 'e2' }],
    }),
    Connection.create({ id: ids.J, ends: [{ curveId: ids.C1, anchorId: 'a3' }, { curveId: ids.C2, anchorId: 'b3' }] }),
    Connection.create({ id: ids.J0, ends: [{ curveId: ids.C1, anchorId: 'a1' }, { curveId: ids.C2, anchorId: 'b1' }] }),
    Fill.create({
      id: ids.F,
      name: '下颌填充',
      parentId: ids.L2,
      index: 'a0',
      boundary: [
        { curveId: ids.C1, segmentId: 's1', dir: 1 },
        { curveId: ids.C1, segmentId: 's2', dir: 1 },
        { curveId: ids.C2, segmentId: 's4', dir: -1 },
        { curveId: ids.C2, segmentId: 's3', dir: -1 },
      ],
    }),
    Reference.create({
      id: ids.R1,
      name: '右耳（引用左耳）',
      parentId: ids.L1,
      index: 'a2',
      sourceId: ids.L3,
      transform: { a: -1, b: 0, c: 0, d: 1, e: 60, f: 0 }, // mirror around x = 30
    }),
  ]
}
