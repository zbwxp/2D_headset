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
const grey: Rgba = [128, 128, 128, 255]

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
const mask = (mode: 'inside' | 'outside', fills: string[], strokes: string[], targets: string[]) =>
  ({ typeName: 'mask', id: 'mask:m', name: 'm', sources: { fills, strokes }, targets, mode, enabled: true }) as DocRecord

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
  // P6 with a semi-transparent FILL (fills may have opacity, R9): the own stroke stays fully opaque
  // inside F; the centre is the fill colour at its own opacity over nothing.
  'P6-semi-fill': {
    rule: 'P6 own boundary with a 50 % fill in front: [B blue, F 50 % red]',
    above: [['fill:F', 'curve:F-boundary']],
    records: () => {
      const [b, f] = square(id('L'), 'a2', 'a1', BLUE, 12)
      return [layer('L', 'a1'), b, { ...f, color: 'rgba(255,0,0,0.5)' } as DocRecord]
    },
    expect: [
      { at: { x: 40, y: 11 }, rgba: blue, what: 'own boundary stroke unchanged under a semi-transparent fill' },
      { at: centre, rgba: [255, 0, 0, 128], what: 'F at 50 %' },
    ],
  },
  // D2 example 2 (C1's natural result, dot): an unrelated green X between F's own boundary B and F.
  // Inside F along B: where X covers B → green (X is in front of B, F leaves B's ink out); elsewhere
  // on B → blue; F's interior → red.
  'P6-third-party-between': {
    rule: 'C1 with a third-party object between: L1 = [B blue] < L2 = [X green] < L3 = [F]',
    above: [['fill:F', 'curve:X'], ['curve:X', 'curve:F-boundary']],
    records: () => {
      const [b, f] = square(id('L3'), 'a1', 'a1', BLUE, 12)
      return [
        layer('L1', 'a1'),
        layer('L2', 'a2'),
        layer('L3', 'a3'),
        { ...b, parentId: id('L1') } as DocRecord,
        line('X', id('L2'), 'a1', '#00ff00', 30, 0, 30, 60),
        f,
      ]
    },
    expect: [
      { at: { x: 30, y: 11 }, rgba: [0, 255, 0, 255], what: 'X in front of B, F leaves B out → X shows there' },
      { at: { x: 50, y: 11 }, rgba: blue, what: 'B elsewhere along the boundary' },
      { at: { x: 30, y: 30 }, rgba: red, what: 'F covers X inside, away from B' },
    ],
  },
  // H1 / H2 — picking must agree with the picture (dot): the fill's own curve has a FREE butt end inside
  // the fill (H1: a tail from corner a into the interior), or an acute inward mitre (H2: a notch).
  'H1-butt-end-inside': {
    rule: 'H1 picking vs picture at a butt end: own curve e→a→b→c→d→a, fill = abcd, fill in front',
    above: [['fill:F', 'curve:B']],
    records: () => {
      const b = Curve.create({
        id: Curve.createId('B'),
        name: 'B',
        parentId: id('L'),
        index: 'a1',
        anchors: { e: anchor('e', 35, 25), a: anchor('a', 20, 10), b: anchor('b', 60, 10), c: anchor('c', 60, 50), d: anchor('d', 20, 50) },
        segments: [
          { id: 'ea', from: 'e', to: 'a' },
          { id: 'ab', from: 'a', to: 'b' },
          { id: 'bc', from: 'b', to: 'c' },
          { id: 'cd', from: 'c', to: 'd' },
          { id: 'da', from: 'd', to: 'a' },
        ],
        stroke: { color: BLUE, width: 12 },
      })
      const f = Fill.create({ id: Fill.createId('F'), name: 'F', parentId: id('L'), index: 'a2', color: RED, boundary: ['ab', 'bc', 'cd', 'da'].map((segmentId) => ({ curveId: b.id, segmentId, dir: 1 as const })) })
      return [layer('L', 'a1'), b, f]
    },
    expect: [
      { at: { x: 50, y: 40 }, rgba: red, what: 'F interior' },
      { at: { x: 30, y: 20 }, rgba: red, what: 'the UNREFERENCED tail e→a inside F is covered by F (not own ink)' },
      { at: { x: 40, y: 11 }, rgba: blue, what: 'referenced boundary ab stays visible' },
    ],
  },
  'H2-acute-inward-mitre': {
    rule: 'H2 picking vs picture at an acute inward mitre: notch vertex (40,15)',
    above: [['fill:F', 'curve:B']],
    records: () => {
      const pts: [string, number, number][] = [['a', 10, 5], ['b', 70, 5], ['c', 70, 60], ['d', 40, 15], ['e', 10, 60]]
      const segs = ['ab', 'bc', 'cd', 'de', 'ea']
      const b = Curve.create({
        id: Curve.createId('B'),
        name: 'B',
        parentId: id('L'),
        index: 'a1',
        anchors: Object.fromEntries(pts.map(([k, x, y]) => [k, anchor(k, x, y)])),
        segments: segs.map((sid) => ({ id: sid, from: sid[0], to: sid[1] })),
        stroke: { color: BLUE, width: 12 },
      })
      const f = Fill.create({ id: Fill.createId('F'), name: 'F', parentId: id('L'), index: 'a2', color: RED, boundary: segs.map((segmentId) => ({ curveId: b.id, segmentId, dir: 1 as const })) })
      return [layer('L', 'a1'), b, f]
    },
    expect: [{ at: { x: 40, y: 8 }, rgba: red, what: 'F interior above the notch' }],
  },
  // H3 — the fill RULE must be the drawing's (dot): a pentagram boundary winds twice around the centre,
  // so 'nonzero' fills the centre pentagon and 'evenodd' would leave it empty.
  'H3-pentagram-fill-rule': {
    rule: 'H3 fill rule: pentagram boundary, nonzero → the centre is filled',
    above: [['fill:F', 'curve:B']],
    records: () => {
      const pt = (k: number) => [40 + 30 * Math.sin((k * 4 * Math.PI) / 5), 32 - 30 * Math.cos((k * 4 * Math.PI) / 5)] as const
      const ids5 = ['p0', 'p1', 'p2', 'p3', 'p4']
      const b = Curve.create({
        id: Curve.createId('B'),
        name: 'B',
        parentId: id('L'),
        index: 'a1',
        anchors: Object.fromEntries(ids5.map((k, i) => [k, anchor(k, pt(i)[0], pt(i)[1])])),
        segments: ids5.map((k, i) => ({ id: `s${i}`, from: k, to: ids5[(i + 1) % 5] })),
        stroke: { color: BLUE, width: 6 },
      })
      const f = Fill.create({ id: Fill.createId('F'), name: 'F', parentId: id('L'), index: 'a2', color: RED, boundary: ids5.map((_, i) => ({ curveId: b.id, segmentId: `s${i}`, dir: 1 as const })) })
      return [layer('L', 'a1'), b, f]
    },
    expect: [{ at: { x: 40, y: 32 }, rgba: red, what: 'centre pentagon filled (nonzero)' }],
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
  // ---------- masks (doc 18 §1.7b / §29.2b): the expectation comes from the mask rule, never from a renderer ----------
  // M1 side nose (outside): the nose line C is hidden where it is inside the face fill F, drawn where it leaves F
  'M1-mask-outside': {
    rule: 'M1 mask outside: C (front) hidden inside F, drawn outside F',
    records: () => [layer('L1', 'a1'), ...square(id('L1'), 'a2', 'a1'), layer('L2', 'a2'), line('C', id('L2'), 'a1', BLUE, 40, 30, 80, 30), mask('outside', ['fill:F'], [], ['curve:C'])],
    expect: [
      { at: { x: 50, y: 30 }, rgba: red, what: 'inside F: the line is hidden, F shows' },
      { at: { x: 70, y: 30 }, rgba: blue, what: 'outside F: the line is drawn' },
    ],
  },
  // M2 shadow (inside): the line is drawn only inside F
  'M2-mask-inside': {
    rule: 'M2 mask inside: C drawn only inside F',
    records: () => [layer('L1', 'a1'), ...square(id('L1'), 'a2', 'a1'), layer('L2', 'a2'), line('C', id('L2'), 'a1', BLUE, 0, 30, 80, 30), mask('inside', ['fill:F'], [], ['curve:C'])],
    expect: [
      { at: centre, rgba: blue, what: 'inside F: drawn' },
      { at: { x: 10, y: 30 }, rgba: empty, what: 'left of F: not drawn' },
      { at: { x: 70, y: 30 }, rgba: empty, what: 'right of F: not drawn' },
    ],
  },
  // M3 collar: the source is the neck fill PLUS the neck outline's stroke (its actual width) — the line on the outline
  // is hidden also just outside the fill, where only the outline's ink covers it
  'M3-mask-fill-and-stroke': {
    rule: 'M3 mask outside, sources F + stroke of B: C on the top edge hidden where B ink or F covers it',
    records: () => [layer('L1', 'a1'), ...square(id('L1'), 'a2', 'a1', GREY, 12), layer('L2', 'a2'), line('C', id('L2'), 'a1', BLUE, 0, 10, 80, 10), mask('outside', ['fill:F'], ['curve:F-boundary'], ['curve:C'])],
    expect: [
      { at: { x: 40, y: 9 }, rgba: grey, what: "just outside F, on B's ink: C hidden, B shows" },
      { at: { x: 5, y: 10 }, rgba: blue, what: 'far left: C drawn' },
    ],
  },
  // M4 a hidden source still masks (Compositor LiveMaskTests)
  'M4-mask-hidden-source': {
    rule: 'M4 the source F is in a hidden layer: nothing of F drawn, C still hidden inside F',
    records: () => [layer('L0', 'a1', { visible: false }), ...square(id('L0'), 'a2', 'a1'), layer('L2', 'a2'), line('C', id('L2'), 'a1', BLUE, 40, 30, 80, 30), mask('outside', ['fill:F'], [], ['curve:C'])],
    expect: [
      { at: { x: 50, y: 30 }, rgba: empty, what: 'inside the hidden F: C hidden, F not drawn' },
      { at: { x: 70, y: 30 }, rgba: blue, what: 'outside F: drawn' },
    ],
  },
  // M5 a mask switched off does nothing
  'M5-mask-disabled': {
    rule: 'M5 disabled mask: C drawn everywhere',
    records: () => [layer('L1', 'a1'), ...square(id('L1'), 'a2', 'a1'), layer('L2', 'a2'), line('C', id('L2'), 'a1', BLUE, 40, 30, 80, 30), { ...mask('outside', ['fill:F'], [], ['curve:C']), enabled: false } as DocRecord],
    expect: [{ at: { x: 50, y: 30 }, rgba: blue, what: 'inside F: drawn (mask off)' }],
  },
  // M6 (dot, review of ce2736c M2): F's own boundary stroke is masked away inside F (outside mask, source F): that ink
  // is not drawn, so F is not cut there either — F fills up to its own geometry; outside F the stroke still shows
  'M6-mask-own-boundary': {
    rule: 'M6 masked own boundary: the hidden half of B does not cut F',
    records: () => [layer('L', 'a1'), ...square(id('L'), 'a2', 'a1', BLUE, 12), mask('outside', ['fill:F'], [], ['curve:F-boundary'])],
    expect: [
      { at: { x: 40, y: 11 }, rgba: red, what: "B's inner half is masked away: F shows there (not a hole)" },
      { at: { x: 40, y: 9 }, rgba: blue, what: "B's outer half still drawn" },
      { at: { x: 40, y: 15 }, rgba: red, what: 'F itself' },
    ],
  },
}
