// Small documents for the paint-order contract (PAINT-ORDER.md §2). Each case names world points and
// the colour the contract expects there; the expectation comes from the written rule, never from
// another renderer. Loaded by the test page with `?case=<name>`.
import { Container, Curve, Fill, type Anchor, type DocRecord } from './schema'

export type Rgba = [number, number, number, number]
/** `above`: pairs [a, b] — a must come after b in the core's paint list (painted above it). */
export type PaintCase = { rule: string; records: () => DocRecord[]; above?: [string, string][]; expect: { at: { x: number; y: number }; rgba: Rgba; what: string }[] }

const RED = '#ff0000'
const BLUE = '#0000ff'
const GREY = '#808080'
const red: Rgba = [255, 0, 0, 255]
const blue: Rgba = [0, 0, 255, 255]
const empty: Rgba = [0, 0, 0, 0]

const anchor = (id: string, x: number, y: number): Anchor => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
const layer = (name: string, index: string, more: Partial<Parameters<typeof Container.create>[0]> = {}) =>
  Container.create({ id: Container.createId(name), name, index, ...more })
/** A straight line from (x1,y1) to (x2,y2); stroke width 12 → 4 world units on screen (FabricView draws width / 3). */
const line = (name: string, parent: string, index: string, color: string, x1: number, y1: number, x2: number, y2: number) =>
  Curve.create({
    id: Curve.createId(name),
    name,
    parentId: parent as any,
    index,
    anchors: { p: anchor('p', x1, y1), q: anchor('q', x2, y2) },
    segments: [{ id: 's', from: 'p', to: 'q' }],
    stroke: { color, width: 12 },
  })
/** Fill F = square (20,10)–(60,50), bounded by its own closed grey curve B (width 3 → 1 world unit). */
const square = (parent: string, fillIndex: string, boundaryIndex: string, boundaryColor = GREY, boundaryWidth = 3, name = 'F') => {
  const b = Curve.create({
    id: Curve.createId(`${name}-boundary`),
    name: `${name} boundary`,
    parentId: parent as any,
    index: boundaryIndex,
    anchors: { a: anchor('a', 20, 10), b: anchor('b', 60, 10), c: anchor('c', 60, 50), d: anchor('d', 20, 50) },
    segments: [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c' },
      { id: 'cd', from: 'c', to: 'd' },
      { id: 'da', from: 'd', to: 'a' },
    ],
    stroke: { color: boundaryColor, width: boundaryWidth },
  })
  const f = Fill.create({
    id: Fill.createId(name),
    name,
    parentId: parent as any,
    index: fillIndex,
    color: RED,
    boundary: ['ab', 'bc', 'cd', 'da'].map((segmentId) => ({ curveId: b.id, segmentId, dir: 1 as const })),
  })
  return [b, f]
}
const id = (name: string) => Container.createId(name)
const centre = { x: 40, y: 30 }

export const paintCases: Record<string, PaintCase> = {
  // P1 — order inside one parent. C crosses F and is NOT F's boundary (B is).
  'P1-fill-after-line': {
    rule: 'P1 later sibling on top: [B, C, F] → F over C',
    above: [['fill:F', 'curve:C']],
    records: () => [layer('L', 'a1'), ...square(id('L'), 'a3', 'a1'), line('C', id('L'), 'a2', BLUE, 0, 30, 80, 30)],
    expect: [{ at: centre, rgba: red, what: 'F (later) covers unrelated line C' }],
  },
  'P1-line-after-fill': {
    rule: 'P1 later sibling on top: [B, F, C] → C over F',
    above: [['curve:C', 'fill:F']],
    records: () => [layer('L', 'a1'), ...square(id('L'), 'a2', 'a1'), line('C', id('L'), 'a3', BLUE, 0, 30, 80, 30)],
    expect: [{ at: centre, rgba: blue, what: 'C (later) over F' }],
  },
  // P2 — layer order.
  'P2-fill-layer-in-front': {
    rule: 'P2 layer order: L1 = [C] behind L2 = [B, F] → F over C',
    above: [['fill:F', 'curve:C']],
    records: () => [layer('L1', 'a1'), layer('L2', 'a2'), line('C', id('L1'), 'a1', BLUE, 0, 30, 80, 30), ...square(id('L2'), 'a2', 'a1')],
    expect: [{ at: centre, rgba: red, what: 'F (front layer) covers C (back layer)' }],
  },
  'P2-line-layer-in-front': {
    rule: 'P2 layer order: L2 = [B, F] behind L1 = [C] → C over F',
    above: [['curve:C', 'fill:F']],
    records: () => [layer('L1', 'a2'), layer('L2', 'a1'), line('C', id('L1'), 'a1', BLUE, 0, 30, 80, 30), ...square(id('L2'), 'a2', 'a1')],
    expect: [{ at: centre, rgba: blue, what: 'C (front layer) over F' }],
  },
  // P3 — nested containers: the order follows the whole container path (two lines, so the
  // fill / line split of today's code plays no part).
  'P3-nested': {
    rule: 'P3 whole path: L1 (a0) = [G (a5) = [red R]] behind L2 (a1) = [blue C (a0)] → C over R',
    above: [['curve:C', 'curve:R']],
    records: () => [
      layer('L1', 'a0'),
      layer('L2', 'a1'),
      layer('G', 'a5', { parentId: id('L1') }),
      line('R', id('G'), 'a0', RED, 40, 0, 40, 60),
      line('C', id('L2'), 'a0', BLUE, 0, 30, 80, 30),
    ],
    expect: [{ at: centre, rgba: blue, what: 'C (front top-level layer) over R (nested in the back layer)' }],
  },
  // P4 — fractional indexes compare by character code: 'a0B' < 'a0a'.
  'P4-index-bytes': {
    rule: "P4 character-code order: red R 'a0B' before blue C 'a0a' → C over R",
    above: [['curve:C', 'curve:R']],
    records: () => [layer('L', 'a1'), line('R', id('L'), 'a0B', RED, 40, 0, 40, 60), line('C', id('L'), 'a0a', BLUE, 0, 30, 80, 30)],
    expect: [{ at: centre, rgba: blue, what: "C ('a0a', later by character code) over R" }],
  },
  // P6 — a fill never covers its own boundary strokes. B (blue, 4 world units wide) is F's boundary,
  // F is later (in front). The point (40, 11) is on B's stroke, 1 unit inside F.
  'P6-own-boundary': {
    rule: 'P6 own boundary visible: [B blue, F] → B over F along the boundary',
    above: [['fill:F', 'curve:F-boundary']],
    records: () => [layer('L', 'a1'), ...square(id('L'), 'a2', 'a1', BLUE, 12)],
    expect: [
      { at: { x: 40, y: 11 }, rgba: blue, what: "F's own boundary stroke stays visible inside F" },
      { at: centre, rgba: red, what: 'F itself' },
    ],
  },
  // P6 across layers (R7): F's own boundary B lies in a BACK layer, F in a front layer, so F is painted
  // after B. B must stay visible (needs S2's own-ink leave-out; S1 alone paints F over B).
  'P6-cross-layer': {
    rule: 'P6 own boundary in a back layer: L1 = [B blue], L2 = [F] → B still visible along the boundary',
    above: [['fill:F', 'curve:F-boundary']],
    records: () => {
      const [b, f] = square(id('L2'), 'a1', 'a1', BLUE, 12)
      return [layer('L1', 'a1'), layer('L2', 'a2'), { ...b, parentId: id('L1') } as DocRecord, f]
    },
    expect: [
      { at: { x: 40, y: 11 }, rgba: blue, what: "F's own boundary stroke (back layer) stays visible inside F" },
      { at: centre, rgba: red, what: 'F itself' },
    ],
  },
  // P7 — other objects cover a fill normally: V behind F is covered, U in front covers F.
  'P7-others': {
    rule: 'P7 others normal: L1 = [V] behind L2 = [B, F] behind L3 = [U]',
    above: [['fill:F', 'curve:V'], ['curve:U', 'fill:F']],
    records: () => [
      layer('L1', 'a1'),
      layer('L2', 'a2'),
      layer('L3', 'a3'),
      line('V', id('L1'), 'a1', BLUE, 0, 20, 80, 20),
      ...square(id('L2'), 'a2', 'a1'),
      line('U', id('L3'), 'a1', BLUE, 0, 40, 80, 40),
    ],
    expect: [
      { at: { x: 40, y: 20 }, rgba: red, what: 'F covers unrelated line V of a back layer' },
      { at: { x: 40, y: 40 }, rgba: blue, what: 'unrelated line U of a front layer covers F' },
    ],
  },
  // P10 control: the same document with L shown paints F and C (so P10 cannot pass by painting nothing)
  'P10-shown-parent': {
    rule: 'P10 control: L (shown) = [G = [B, F], C]',
    above: [['curve:C', 'fill:F']],
    records: () => [
      layer('L', 'a1'),
      layer('G', 'a1', { parentId: id('L') }),
      ...square(id('G'), 'a2', 'a1'),
      line('C', id('L'), 'a2', BLUE, 0, 30, 80, 30),
    ],
    expect: [
      { at: centre, rgba: blue, what: 'C (later than G) over F' },
      { at: { x: 40, y: 20 }, rgba: red, what: 'F' },
    ],
  },
  // P10 — inherited visibility: a hidden parent hides children that are themselves visible.
  'P10-hidden-parent': {
    rule: 'P10 inherited visibility: L (hidden) = [G = [B, F], C]',
    records: () => [
      layer('L', 'a1', { visible: false }),
      layer('G', 'a1', { parentId: id('L') }),
      ...square(id('G'), 'a2', 'a1'),
      line('C', id('L'), 'a2', BLUE, 0, 30, 80, 30),
    ],
    expect: [
      { at: centre, rgba: empty, what: 'nothing painted' },
      { at: { x: 40, y: 20 }, rgba: empty, what: 'nothing painted' },
    ],
  },
}
