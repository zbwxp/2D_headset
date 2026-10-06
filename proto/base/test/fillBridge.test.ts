// Fill-only closing edge (doc 18 §19, dot 1791302404). Expected values are checked against the data itself
// (positions, segment cubics by id), not against the geometry function under test where avoidable.
import { describe, expect, it } from 'vitest'
import { breakAt, deleteEndNode, fillContains, fillDependencies, fillGeometry, loopDoc, moveAnchor, outlineGaps, Session, type Doc } from '../src/experiments/fillBridge'

const P = (x: number, y: number) => ({ x, y })
const segPts = (d: Doc) =>
  Object.fromEntries(Object.values(d.curves).flatMap((c) => c.segments.map((s) => [s.id, [c.anchors[s.from].p, c.anchors[s.from].hOut, c.anchors[s.to].hIn, c.anchors[s.to].p]])))
const bridges = (d: Doc) => d.fills.F.boundary.filter((st) => st.kind === 'bridge')
const report: Record<string, unknown>[] = []
const ok = (r: ReturnType<typeof breakAt>) => {
  if (!r.ok) throw new Error(r.reason)
  return r.doc
}

describe('fill-only closing edge', () => {
  it('main sequence: filled loop → break → move one side → undo / redo → save / reopen', () => {
    const s = new Session(loopDoc())
    const before = segPts(s.doc)
    s.apply(ok(breakAt(s.doc, 'C', 'b')))
    // break: the curve is now ONE open chain starting at the break; shapes unchanged; one bridge between s1 and s2
    const c = s.doc.curves.C
    expect(c.closed).toBe(false)
    expect(c.segments.map((x) => x.id)).toEqual(['s2', 's3', 's4', 's1'])
    const after = segPts(s.doc)
    for (const id of Object.keys(before)) expect(after[id]).toEqual(before[id])
    expect(bridges(s.doc).length).toBe(1)
    const kinds = s.doc.fills.F.boundary.map((st) => (st.kind === 'segment' ? st.segmentId : 'bridge'))
    expect(kinds).toEqual(['s1', 'bridge', 's2', 's3', 's4'])
    expect(outlineGaps(fillGeometry(s.doc, 'F'))).toBe(0)
    // move ONE side of the break (the copy that ends s1)
    const br = bridges(s.doc)[0] as Extract<Doc['fills']['F']['boundary'][number], { kind: 'bridge' }>
    const moved = br.from
    const otherBefore = s.doc.curves.C.anchors[br.to.anchorId].p
    s.apply(moveAnchor(s.doc, moved, P(-3, -13)))
    const otherAfter = s.doc.curves.C.anchors[br.to.anchorId].p
    expect(otherAfter).toEqual(otherBefore) // the other end does not follow
    const nowSegs = segPts(s.doc)
    for (const id of ['s2', 's3', 's4']) expect(nowSegs[id]).toEqual(before[id]) // untouched segments not secretly changed
    const g = fillGeometry(s.doc, 'F')
    const bridgeCubic = g[1]
    expect(bridgeCubic[0]).toEqual(P(-3, -13))
    expect(bridgeCubic[3]).toEqual(otherBefore) // the straight edge follows the break
    expect(outlineGaps(g)).toBe(0)
    expect(fillContains(s.doc, 'F', P(0, 0))).toBe(true)
    // undo / redo / save / reopen
    const atEnd = JSON.stringify(s.doc)
    expect(s.undo()).toBe(true)
    expect(s.undo()).toBe(true)
    expect(JSON.stringify(s.doc)).toBe(JSON.stringify(loopDoc()))
    expect(s.redo()).toBe(true)
    expect(s.redo()).toBe(true)
    expect(JSON.stringify(s.doc)).toBe(atEnd)
    const r = Session.reopen(s.save())
    expect(fillGeometry(r.doc, 'F')).toEqual(fillGeometry(s.doc, 'F'))
    report.push({ case: 'main', bridgeFrom: bridgeCubic[0], bridgeTo: bridgeCubic[3], gaps: outlineGaps(g) })
  })

  it('reversed boundary: the bridge keeps the boundary order and direction', () => {
    const d = ok(breakAt(loopDoc(true), 'C', 'b'))
    const kinds = d.fills.F.boundary.map((st) => (st.kind === 'segment' ? `${st.segmentId}${st.dir === 1 ? '+' : '-'}` : 'bridge'))
    expect(kinds).toEqual(['s4-', 's3-', 's2-', 'bridge', 's1-'])
    const br = bridges(d)[0] as Extract<Doc['fills']['F']['boundary'][number], { kind: 'bridge' }>
    expect(br.from.anchorId).toBe('b') // s2 reversed ends at b
    expect(outlineGaps(fillGeometry(d, 'F'))).toBe(0)
    report.push({ case: 'reversed', kinds })
  })

  it('two breaks: two curves, two bridges; both curves are dependencies; ends move independently', () => {
    let d = ok(breakAt(loopDoc(), 'C', 'b'))
    d = ok(breakAt(d, 'C', 'd'))
    expect(Object.keys(d.curves).length).toBe(2)
    expect(bridges(d).length).toBe(2)
    expect(outlineGaps(fillGeometry(d, 'F'))).toBe(0)
    const deps = fillDependencies(d, 'F')
    expect(deps.length).toBe(2)
    // every bridge end refers to a curve that really holds that anchor (re-mapped after the second break)
    for (const st of bridges(d)) if (st.kind === 'bridge') for (const e of [st.from, st.to]) expect(d.curves[e.curveId].anchors[e.anchorId]).toBeTruthy()
    // move the end on the second curve; the first curve is unchanged
    const br = bridges(d)[1] as Extract<Doc['fills']['F']['boundary'][number], { kind: 'bridge' }>
    const firstBefore = JSON.stringify(d.curves.C)
    const target = br.to.curveId === 'C' ? br.from : br.to
    const moved = moveAnchor(d, target, P(target.curveId === 'C' ? 0 : 2, 11))
    if (target.curveId !== 'C') expect(JSON.stringify(moved.curves.C)).toBe(firstBefore)
    expect(outlineGaps(fillGeometry(moved, 'F'))).toBe(0)
    report.push({ case: 'two breaks', curves: Object.keys(d.curves), deps, bridges: bridges(d).length })
  })

  it('deleting a bridged end node is refused with the fill named (no dangling reference, no automatic patching)', () => {
    const d = ok(breakAt(loopDoc(), 'C', 'b'))
    const br = bridges(d)[0] as Extract<Doc['fills']['F']['boundary'][number], { kind: 'bridge' }>
    const r = deleteEndNode(d, br.from)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('fill F')
    report.push({ case: 'delete bridged end', refused: !r.ok })
  })

  it('a boundary that did not pass through the break gets no bridge', () => {
    // a second fill that uses only s3 and s4 plus its own existing bridge back (simulated as an independent fill)
    const base = loopDoc()
    base.fills.G = { id: 'G', boundary: [{ kind: 'segment', curveId: 'C', segmentId: 's3', dir: 1 }, { kind: 'segment', curveId: 'C', segmentId: 's4', dir: 1 }, { kind: 'bridge', from: { curveId: 'C', anchorId: 'a' }, to: { curveId: 'C', anchorId: 'c' } }] }
    const d = ok(breakAt(base, 'C', 'b'))
    expect(d.fills.G.boundary.filter((st) => st.kind === 'bridge').length).toBe(1) // only its own, nothing added
    report.push({ case: 'unrelated fill', bridgesInG: 1 })
  })

  it('a cut point that already touches an existing bridge (review of 066676c): the bridge is re-pointed, forward and reverse', () => {
    for (const reversed of [false, true]) {
      const base = loopDoc()
      // G: s1 (a→b) then an existing bridge b→a — or the reverse-equivalent [bridge a→b, s1 reversed b→a]
      base.fills.G = {
        id: 'G',
        boundary: reversed
          ? [{ kind: 'bridge', from: { curveId: 'C', anchorId: 'a' }, to: { curveId: 'C', anchorId: 'b' } }, { kind: 'segment', curveId: 'C', segmentId: 's1', dir: -1 }]
          : [{ kind: 'segment', curveId: 'C', segmentId: 's1', dir: 1 }, { kind: 'bridge', from: { curveId: 'C', anchorId: 'b' }, to: { curveId: 'C', anchorId: 'a' } }],
      }
      const cut = ok(breakAt(base, 'C', 'b'))
      // the copy that now ends s1
      const s1 = cut.curves.C.segments.find((x) => x.id === 's1')!
      const moved = moveAnchor(cut, { curveId: 'C', anchorId: s1.to }, P(-3, -13))
      const gap = outlineGaps(fillGeometry(moved, 'G'))
      report.push({ case: 'existing bridge at the cut', reversed, gap, gBridges: moved.fills.G.boundary.filter((x) => x.kind === 'bridge').length })
      expect(gap).toBe(0)
      expect(moved.fills.G.boundary.filter((x) => x.kind === 'bridge').length).toBe(1) // re-pointed, not duplicated
      expect(outlineGaps(fillGeometry(moved, 'F'))).toBe(0)
    }
  })

  it('prints the table', () => {
    console.log('[fillBridge]\n' + report.map((r) => JSON.stringify(r)).join('\n'))
  })
})
