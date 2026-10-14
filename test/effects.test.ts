// Stage 3b, package 1 (ledger row 1; docs/stage3b-correction-plan.md §6; dot 1791688005): every
// Editor operation declares its effects. The transaction checks a call against the table, merges
// the declarations into today's three settle modes (no behaviour change), and checks the geometric
// intents before the settle. Direct writes without intents are checked here, one operation at a
// time, against the state just before the commit's settle (a limited guarantee, dot 1791687901).
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type Vec } from '../src'
import { Editor, observeBeforeSettle, UNWRAPPED, type BeforeSettle } from '../src/document'
import { EFFECTS, resolve, type Effect, type Shared } from '../src/document/effects'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0'

/** Layers L, M, K; a filled square abcd and a second filled triangle in L; qr in M, st in K, linked r–s; strokes differ per view. */
function fixture() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.layer('M', 'M'); e.layer('K', 'K')
    e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) })
    e.line('cd', 'c', { id: 'd', layer: 'L', position: P(0, 10) })
    e.line('da', 'd', 'a')
    e.line('ef', { id: 'e', layer: 'L', position: P(100) }, { id: 'f', layer: 'L', position: P(110) })
    e.line('fg', 'f', { id: 'g', layer: 'L', position: P(105, 8) })
    e.line('ge', 'g', 'e')
    e.line('xy', { id: 'x', layer: 'L', position: P(70) }, { id: 'y', layer: 'L', position: P(80) })
    e.line('qr', { id: 'q', layer: 'M', position: P(30, 30) }, { id: 'r', layer: 'M', position: P(40, 30) })
    e.line('st', { id: 's', layer: 'K', position: P(50, 50) }, { id: 'u', layer: 'K', position: P(60, 50) })
  })
  d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))
  d.edit(e => { for (const l of d.snapshot().loops) e.fill(l.id, '#ccc') })
  d.edit(e => e.link('r', 's'))
  d.edit(e => e.move([{ id: 'b', target: P(11, 1) }])) // a pending change for the shape broadcast
  d.editIn('view:90,0', e => e.lineStroke('ab', { width: 5, profile: 'uniform' })) // strokes differ for the stroke broadcast
  // responses (stage 3b package 2), from a file: a on the linear line (so a link to q merges), b, y,
  // the linked r and s alike, and handles of ab and xy, so the structural operations write animation
  const file = JSON.parse(save(d)), E = 'view:0,0>view:90,0'
  file.document.animation = {
    points: { a: { [E]: { x: [[0.5, 0.5]] } }, b: { [E]: { x: [[0.5, 0.8]] } }, y: { [E]: { y: [[0.4, 0.1]] } }, r: { [E]: { x: [[0.3, 0.6]] } }, s: { [E]: { x: [[0.3, 0.6]] } } },
    handles: { ab: { a: { [E]: { x: [[0.5, 0.7]] } } }, xy: { b: { [E]: { y: [[0.5, 0.2]] } } } },
  }
  return open(JSON.stringify(file))
}
/**
 * Mirror cases that reach every branch of apply (dot 1791688672): a source triangle with an arc
 * corner and a fill, a target triangle whose own arc sits on another corner (removed) and no
 * fill; and two linked pairs across L and M, the source pair with a link join, the target without.
 */
function mirrorScene(d: Core) {
  const at = (id: string, layer: string, x: number, y = 0) => ({ id, layer, position: P(x, y) })
  d.edit(e => {
    e.line('l1', at('A1', 'L', -30), at('B1', 'L', -20)); e.line('l2', 'B1', at('C1', 'L', -25, 10)); e.line('l3', 'C1', 'A1')
    e.line('r1', at('A2', 'L', 30), at('B2', 'L', 20)); e.line('r2', 'B2', at('C2', 'L', 25, 10)); e.line('r3', 'C2', 'A2')
    e.line('la', at('P1', 'L', -60, -20), at('P2', 'L', -50, -20)); e.line('lb', at('P3', 'M', -50, -20), at('P4', 'M', -40, -20))
    e.line('ra', at('Q1', 'L', 60, -20), at('Q2', 'L', 50, -20)); e.line('rb', at('Q3', 'M', 50, -20), at('Q4', 'M', 40, -20))
  })
  d.edit(e => { e.join('B1', 'l1', 'l2', { mode: 'arc', radius: 2 }); e.join('C2', 'r2', 'r3', { mode: 'arc', radius: 3 }) })
  d.edit(e => e.fill(d.snapshot().loops.find(l => l.route.some(u => u.line === 'l1'))!.id, '#0a0'))
  d.edit(e => { e.link('P2', 'P3'); e.link('Q2', 'Q3') })
  d.edit(e => e.linkJoin('P2', 'P3', 'la', 'lb', { mode: 'smooth' }))
}
const groupOf = (d: Core, line: string) => d.snapshot().groups.find(x => x.lines.includes(line))!.id
const loops = (d: Core) => d.snapshot().loops.map(l => l.id)
/** A real 1 × 1 PNG, and a reference image of it in the front view. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const refImage = (id: string) => ({ id, view: FRONT, src: PNG, width: 1, height: 1, x: 0, y: 0, scale: 10, angle: 0, opacity: 0.5, visible: true })
const sel = (...ids: string[]) => ids.map(id => ({ kind: 'line' as const, id }))

/** One representative call per operation (an operation may have more than one case). */
type Case = { op: string; args: (d: Core) => unknown[]; note?: string; views?: string[]; setup?: (d: Core) => void }
const CASES: Case[] = [
  { op: 'layer', args: () => ['N', 'N'] },
  { op: 'renameLayer', args: () => ['M', 'MM'] },
  { op: 'renameLine', args: () => ['ab', 'x1'] },
  { op: 'renameGroup', args: d => [groupOf(d, 'ab'), 'g1'] },
  { op: 'layerType', args: () => ['M', 'eye'] },
  { op: 'reorderLayer', args: () => ['M', 0] },
  { op: 'copyLayer', args: () => ['L', 'L2'] },
  { op: 'copyLayer', args: () => ['M', 'M2'], note: 'a typed layer: the type is copied', setup: d => d.edit(e => e.layerType('M', 'eye')) },
  { op: 'paste', args: d => [d.copy(['qr']), 'L', P(5, 5), 'p'] },
  { op: 'paste', args: d => [d.copy(['ab', 'bc', 'cd', 'da']), 'M', P(200, 0), 'p'], note: 'a clip with a join and a fill' },
  { op: 'deleteLayer', args: () => ['M'] },
  { op: 'deleteLayer', args: () => ['M'], note: 'a typed layer: its type goes', setup: d => d.edit(e => e.layerType('M', 'eye')) },
  { op: 'lineState', args: () => ['ab', { visible: false }] },
  { op: 'fillState', args: d => [loops(d)[0], { visible: false }] },
  { op: 'groupState', args: d => [groupOf(d, 'ab'), { locked: true }] },
  { op: 'layerState', args: () => ['L', { visible: false }] },
  { op: 'layerFills', args: () => ['L', { visible: false }] },
  { op: 'line', args: () => ['nn', 'a', { id: 'n', layer: 'L', position: P(-5, -5) }], note: 'without handles' },
  { op: 'line', args: () => ['nh', 'a', { id: 'h', layer: 'L', position: P(-5, 5) }, { ha: P(1, 0), hb: P(-1, 0) }], note: 'with handles' },
  { op: 'move', args: () => [[{ id: 'a', target: P(-1, -1) }]] },
  { op: 'mergePosition', args: () => ['c', 'q'] },
  { op: 'moveHandle', args: () => ['cd', 'a', P(0, 2)] },
  { op: 'split', args: () => ['cd', 0.5, 'm', 'cd1', 'cd2'] },
  { op: 'deleteLine', args: () => ['xy'] },
  { op: 'bind', args: () => ['y', 'a'] },
  { op: 'unbind', args: () => ['b', ['bc'], 'b2'] },
  { op: 'join', args: () => ['c', 'bc', 'cd', { mode: 'arc', radius: 2 }], note: 'arc' },
  { op: 'join', args: () => ['c', 'bc', 'cd', { mode: 'smooth' }], note: 'smooth' },
  { op: 'removeJoin', args: () => ['b', 'ab', 'bc'], note: 'smooth' },
  { op: 'removeJoin', args: () => ['c', 'bc', 'cd'], note: 'arc: its radius goes from every layer', setup: d => d.edit(e => e.join('c', 'bc', 'cd', { mode: 'arc', radius: 3 })) },
  { op: 'joinOrder', args: () => ['c', [['bc', 'cd'], ['bc', 'cz']]], note: 'a fork: bc–cd (bound when drawn) moved above bc–cz', setup: d => d.edit(e => { e.line('cz', 'c', { id: 'z', layer: 'L', position: P(20, 20) }); e.join('c', 'bc', 'cz', { mode: 'cusp' }) }) },
  { op: 'endStroke', args: () => ['a', { taper: 2 }] },
  { op: 'zone', args: () => ['c', 'bc', 'cd', 12], note: 'a manual zone on the bound join bc–cd' },
  { op: 'link', args: () => ['a', 'q'] },
  { op: 'unlink', args: () => ['r', 's'] },
  { op: 'linkJoin', args: () => ['r', 's', 'qr', 'st', { mode: 'smooth' }] },
  { op: 'removeLinkJoin', args: () => ['r', 's', 'qr', 'st'], setup: d => d.edit(e => e.linkJoin('r', 's', 'qr', 'st', { mode: 'smooth' })) },
  { op: 'lineStroke', args: () => ['ab', { width: 3, profile: 'uniform' }] },
  { op: 'pointWidth', args: () => ['a', 3] },
  { op: 'stroke', args: d => [groupOf(d, 'ab'), { width: 4, profile: 'uniform' }] },
  { op: 'reorderGroup', args: d => [groupOf(d, 'xy'), 0] },
  { op: 'moveGroup', args: d => [groupOf(d, 'xy'), 'M'] },
  { op: 'fill', args: d => [loops(d)[0], '#f00'] },
  { op: 'clearFill', args: d => [loops(d)[0]] },
  { op: 'clearFill', args: d => [loops(d)[0]], note: 'its mask goes', setup: d => d.edit(e => e.mask('m1', [loops(d)[0]!], { kind: 'line', id: 'xy' }, 'inverse')) },
  { op: 'mask', args: d => ['m1', [loops(d)[0]], { kind: 'line', id: 'xy' }, 'inverse'] },
  { op: 'removeMask', args: () => ['m1'], setup: d => d.edit(e => e.mask('m1', [loops(d)[0]!], { kind: 'line', id: 'xy' }, 'inverse')) },
  { op: 'fillVisible', args: d => [loops(d)[0], false] },
  { op: 'reorderFill', args: d => { const s = d.snapshot(), sq = s.fillOrder.filter(id => s.loops.find(l => l.id === id)!.route.some(u => u.line === 'ab')); return [sq[sq.length - 1], 0] },
    // fills reorder within one connected curve: a diagonal gives the square several filled loops
    setup: d => { d.edit(e => e.line('ac', 'a', 'c')); d.edit(e => { for (const l of d.snapshot().loops) if (l.route.some(u => u.line === 'ac')) e.fill(l.id, '#abc') }) } },
  { op: 'select', args: () => [sel('ab')] },
  { op: 'selectGroup', args: () => ['ab'] },
  { op: 'transform', args: () => [{ a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }, sel('xy')] },
  { op: 'translate', args: () => [1, 2, sel('xy')] },
  { op: 'rotate', args: () => [P(0), 0.1, sel('xy')] },
  { op: 'scale', args: () => [P(0), 1.1, 1.1, sel('xy')] },
  { op: 'flip', args: () => [sel('xy')] },
  { op: 'broadcastShape', args: () => [sel('ab')], views: [FRONT] },
  { op: 'draftCorners', args: () => [sel('ab')] },
  // b differs between the front and the side: applied from the side, the edited view takes the side's L (in the side itself: nothing)
  { op: 'applyFromView', args: () => [['L'], 'view:90,0'] },
  { op: 'fit', args: () => [sel('ab')] },
  // b differs between the front (11, 1) and the side (10, 0): the correction at yaw 45 writes knots on that edge (stage 3b package 3)
  { op: 'correct', args: () => [{ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(10.4, 0.7) }] }] },
  // a is at (0, 0) in every view: equal on both axes, so a drag at yaw 45 moves the side view (stage 3b package 4)
  { op: 'correct', args: () => [{ yaw: 45, pitch: 0 }, { points: [{ id: 'a', position: P(0, 2) }] }], note: 'the side view moves' },
  // the knots that correction wrote, removed again (docs/playback-edit-checklist.md §4)
  { op: 'uncorrect', args: () => [{ yaw: 45, pitch: 0 }, { kind: 'point', id: 'b' }], setup: d => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(10.4, 0.7) }] })) },
  // every knot of b, on every edge (docs/correction-cleanup-checklist.md §2)
  { op: 'clearCorrections', args: () => [[{ kind: 'point', id: 'b' }]], setup: d => d.edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: P(10.4, 0.7) }] })) },
  // the corner's own stroke differs too, so a broadcast from either view writes the other
  { op: 'broadcastStroke', args: () => [sel('ab')], setup: d => d.editIn('view:90,45', e => e.lineStroke('ab', { width: 7, profile: 'uniform' })) },
  { op: 'deleteSelection', args: () => [sel('xy')] },
  { op: 'placeReference', args: () => [refImage('r1')] },
  { op: 'setReference', args: () => ['r1', { opacity: 0.9 }], setup: d => d.edit(e => e.placeReference(refImage('r1'))) },
  { op: 'removeReference', args: () => ['r1'], setup: d => d.edit(e => e.placeReference(refImage('r1'))) },
  { op: 'addAsset', args: () => [{ id: 'a1', name: 'sheet', src: PNG, width: 1, height: 1 }] },
  { op: 'renameAsset', args: () => ['a1', 'front sheet'], setup: d => d.edit(e => e.addAsset({ id: 'a1', name: 'sheet', src: PNG, width: 1, height: 1 })) },
  { op: 'removeAsset', args: () => ['a1'], setup: d => d.edit(e => e.addAsset({ id: 'a1', name: 'sheet', src: PNG, width: 1, height: 1 })) },
  { op: 'mirrorApply', args: () => [['qr'], ['st']], views: [FRONT] },
  { op: 'mirrorApply', args: () => [['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']], views: [FRONT], note: 'arc set and removed, fill copied', setup: mirrorScene },
  { op: 'mirrorApply', args: () => [['la', 'lb'], ['ra', 'rb']], views: [FRONT], note: 'link join copied', setup: mirrorScene },
  { op: 'mirrorLink', args: d => [[groupOf(d, 'qr')], [groupOf(d, 'st')]], views: [FRONT] },
  { op: 'mirrorLink', args: d => [[groupOf(d, 'l1')], [groupOf(d, 'r1')]], views: [FRONT], note: 'arc set and removed, fill copied', setup: mirrorScene },
  { op: 'mirrorLink', args: d => [[groupOf(d, 'la'), groupOf(d, 'lb')], [groupOf(d, 'ra'), groupOf(d, 'rb')]], views: [FRONT], note: 'link join copied', setup: mirrorScene },
  { op: 'unmirror', args: () => [['st']], views: [FRONT], setup: d => d.edit(e => e.mirrorLink([groupOf(d, 'qr')], [groupOf(d, 'st')])) },
]

/** What the operations wrote directly: the draft just before the settle against the published state. */
function written(x: BeforeSettle) {
  type Store = { layers: unknown; points: unknown; lines: unknown; usedPoints: unknown; usedLines: unknown; shapes: { layers: { key: string }[] } }
  const store = (s: unknown) => (s as { network: { store: Store } }).network.store
  const ds = store(x.draft), ps = store(x.published)
  const json = (v: unknown) => JSON.stringify(v)
  const shapes = ds.shapes.layers.filter(l => json(l) !== json(ps.shapes.layers.find(q => q.key === l.key))).map(l => l.key)
  const shared: Shared[] = []
  if ((['layers', 'points', 'lines', 'usedPoints', 'usedLines'] as const).some(k => json(ds[k]) !== json(ps[k]))) shared.push('structure')
  for (const k of ['groups', 'joins', 'links', 'fills', 'masks', 'selection', 'apply', 'names', 'meta', 'animation', 'reference'] as const) {
    if (json((x.draft as unknown as Record<string, unknown>)[k]) !== json((x.published as unknown as Record<string, unknown>)[k])) shared.push(k)
  }
  const intents = [...new Set([...x.changes.targets, ...x.changes.held, ...x.changes.handleTips].map(i => i.layer))]
  return { shapes, shared, intents }
}

/** Run one case in one view: what it wrote before the settle, how often it read the settled trial. */
function run(c: Case, layer: string) {
  const d = fixture()
  c.setup?.(d)
  let seen: BeforeSettle | undefined
  const off = observeBeforeSettle(x => { seen = x })
  const proto = Editor.prototype as unknown as { view: () => unknown }
  const original = proto.view
  let trials = 0
  proto.view = function (this: unknown) { trials++; return original.call(this) }
  try {
    const args = c.args(d)
    d.editIn(layer, e => (e as unknown as Record<string, (...a: unknown[]) => unknown>)[c.op]!(...args))
    return { seen: seen!, trials, args, d }
  } finally { proto.view = original; off() }
}
const decl = (op: string): Effect => EFFECTS[op]!

describe('every Editor operation declares its effects', () => {
  it('the table and the operations match exactly: no operation undeclared, no declaration for nothing', () => {
    const ops = Object.getOwnPropertyNames(Editor.prototype).filter(n => typeof Object.getOwnPropertyDescriptor(Editor.prototype, n)?.value === 'function' && !UNWRAPPED.includes(n)).sort()
    expect(Object.keys(EFFECTS).sort()).toEqual(ops)
    // and the cases below run every declared operation
    expect([...new Set(CASES.map(c => c.op))].sort()).toEqual(ops)
  })

  it('a call to an undeclared operation fails the whole edit, even when the callback catches it', () => {
    const d = fixture(), before = save(d), kept = EFFECTS.lineStroke!
    delete EFFECTS.lineStroke
    try {
      let caught: unknown
      expect(() => d.edit(e => {
        e.move([{ id: 'a', target: P(-3, -3) }])
        try { e.lineStroke('ab', { width: 9, profile: 'uniform' }) } catch (x) { caught = x }
      })).toThrow(/An operation in this edit failed/)
      expect(caught).toBeInstanceOf(Refusal)
      expect((caught as Refusal).code).toBe('undeclared-operation')
      expect(save(d)).toBe(before) // the move before it is not published either
    } finally { EFFECTS.lineStroke = kept }
  })

  it('a geometric intent outside the declared layers is refused before the settle, naming the layers', () => {
    const d = fixture(), before = save(d), kept = EFFECTS.move!
    EFFECTS.move = { ...kept, intents: 'none' }
    try {
      expect(() => d.editIn('view:90,0', e => e.move([{ id: 'a', target: P(-3, -3) }]))).toThrow(/undeclared-write: this edit's geometric intents reach view:90,0, outside what move declared/)
      expect(save(d)).toBe(before)
    } finally { EFFECTS.move = kept }
    // the same edit with the real declaration goes through
    d.editIn('view:90,0', e => e.move([{ id: 'a', target: P(-3, -3) }]))
  })
})

describe('the observer seam cannot re-enter an edit (dot 1791688692)', () => {
  it('an Editor kept from the callback is closed when the observer runs: it writes nothing, and the edit publishes only its own result', () => {
    const d = fixture()
    let kept: Editor | undefined
    const errors: string[] = []
    const off = observeBeforeSettle(() => {
      try { kept!.move([{ id: 'a', target: P(-50, -50) }]) } catch (x) { errors.push((x as Error).message) }
      try { kept!.move([{ id: 'nope', target: P(1, 1) }]) } catch (x) { errors.push((x as Error).message) }
    })
    try { d.edit(e => { kept = e; e.select(sel('ab')) }) } finally { off() }
    expect(errors).toEqual(['This editor belongs to a finished edit', 'This editor belongs to a finished edit'])
    expect(d.in(FRONT).snapshot().points.find(p => p.id === 'a')!.position).toEqual(P(0))
    expect(d.snapshot().selection).toEqual(sel('ab'))
  })
})

describe('the declarations against what each operation really does (front and a corner view)', () => {
  for (const c of CASES) for (const layer of c.views ?? [FRONT, 'view:90,45']) {
    it(`${c.op}${c.note ? ` (${c.note})` : ''} in ${layer}`, () => {
      const { seen, trials, args } = run(c, layer)
      const e = decl(c.op), all = seen.draft ? [...new Set((seen.draft as unknown as { network: { store: { shapes: { layers: { key: string; kind: string }[] } } } }).network.store.shapes.layers.filter(l => l.kind === 'view').map(l => l.key))] : []
      const w = written(seen)
      // reads: the settled trial is read exactly when declared (a declaration may depend on the arguments)
      const reads = typeof e.reads === 'function' ? e.reads(args) : e.reads
      expect(trials > 0).toBe(reads === 'settled-trial')
      // intents and direct writes within the declaration, resolved to concrete layer keys
      expect(w.intents.filter(k => !resolve(e.intents, layer, all).includes(k))).toEqual([])
      const allowedShapes = [...resolve(e.shapes, layer, all), ...(e.records ? ['base:angle'] : [])]
      expect(w.shapes.filter(k => !allowedShapes.includes(k))).toEqual([])
      expect(w.shared.filter(k => !e.shared.includes(k))).toEqual([])
      // and it did something, so the case tests the declaration
      expect(w.shapes.length + w.shared.length + w.intents.length).toBeGreaterThan(0)
    })
  }
})

describe('responses: the operations that declare animation write it (stage 3b package 2)', () => {
  it('each operation declaring animation writes it in its case, and no other operation does', () => {
    const declaring = Object.entries(EFFECTS).filter(([, e]) => e.shared.includes('animation')).map(([op]) => op).sort()
    expect(declaring).toEqual(['bind', 'clearCorrections', 'correct', 'deleteLayer', 'deleteLine', 'deleteSelection', 'link', 'unbind', 'uncorrect'])
    for (const op of declaring) {
      const c = CASES.find(x => x.op === op)!
      expect([op, written(run(c, FRONT).seen).shared.includes('animation')]).toEqual([op, true])
    }
  })
})

describe('the merged commit is today\'s, operation by operation (no behaviour change)', () => {
  const mode = (d: Core, layer: string, fn: (e: Editor) => void) => {
    let m: string | undefined
    const off = observeBeforeSettle(x => { m = x.mode })
    try { d.editIn(layer, fn) } finally { off() }
    return m
  }
  it('select, selectGroup, broadcastStroke and fit skip settling; broadcastShape and draftCorners settle the non-front views; everything else, and an empty edit, settles fully', () => {
    const today: Record<string, string> = { placeReference: 'keeps', setReference: 'keeps', removeReference: 'keeps', addAsset: 'keeps', renameAsset: 'keeps', removeAsset: 'keeps', mask: 'keeps', removeMask: 'keeps', uncorrect: 'keeps', clearCorrections: 'keeps', select: 'keeps', selectGroup: 'keeps', broadcastStroke: 'keeps', fit: 'keeps', correct: 'views', broadcastShape: 'views', draftCorners: 'views' }
    for (const c of CASES) for (const layer of c.views ?? [FRONT]) {
      const d = fixture()
      c.setup?.(d)
      const args = c.args(d)
      expect([c.op, mode(d, layer, e => (e as unknown as Record<string, (...a: unknown[]) => unknown>)[c.op]!(...args))]).toEqual([c.op, today[c.op] ?? 'full'])
    }
    expect(mode(fixture(), FRONT, () => {})).toBe('full')
  })

  it('companions and nesting merge as today; two alone operations, or one with anything but selections and stroke broadcasts, are refused', () => {
    const d = fixture()
    expect(mode(d, FRONT, e => { e.select(sel('ab')); e.fit(sel('ab')) })).toBe('keeps')
    expect(mode(fixture(), FRONT, e => { e.select(sel('ab')); e.broadcastStroke(sel('ab')); e.broadcastShape(sel('ab')) })).toBe('views')
    expect(mode(fixture(), FRONT, e => { e.select(sel('ab')); e.lineStroke('ab', { width: 2, profile: 'uniform' }) })).toBe('full')
    const f = fixture(), clip = f.copy(['qr'])
    expect(mode(f, FRONT, e => e.paste(clip, 'L', P(5, 5), 'p'))).toBe('full') // paste calls select inside: full, as today
    expect(() => fixture().edit(e => { e.fit(sel('ab')); e.broadcastShape(sel('ab')) })).toThrow(/stage2-alone/)
    expect(() => fixture().edit(e => { e.broadcastShape(sel('ab')); e.move([{ id: 'a', target: P(1, 1) }]) })).toThrow(/stage2-alone/)
  })

  it('a diagonal draft run in a corner view does not auto-bind there: a draft that lands one end on another point keeps both points', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('cd', { id: 'c', layer: 'L', position: P(20) }, { id: 'd', layer: 'L', position: P(30) }) })
    d.editIn('view:90,0', e => e.move([{ id: 'b', target: P(15) }]))
    d.editIn('view:0,45', e => e.move([{ id: 'b', target: P(15) }]))
    d.editIn('view:90,45', e => e.draftCorners(sel('ab'))) // the corner's b = 10 + 5 + 5 = 20: on c
    const corner = d.in('view:90,45').snapshot().points
    expect(corner.find(p => p.id === 'b')!.position).toEqual(corner.find(p => p.id === 'c')!.position)
    expect(corner.map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    // an ordinary move there settles fully: auto-bind joins every coincidence in the edited view,
    // the one the draft left (b on c) and the one the move makes (a on d), as today (ledger row 7)
    d.editIn('view:90,45', e => e.move([{ id: 'a', target: P(30) }]))
    expect(d.in('view:90,45').snapshot().points).toHaveLength(2)
  })
})
