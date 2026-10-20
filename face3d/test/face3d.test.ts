// face3d F1 (PLAN §6): the math under the prototype — camera, head, outline, key contours, mixing, surface bones.
import { describe, expect, it } from 'vitest'
import { attach, BONE_DEFS, place } from '../src/bones'
import { COUNTS, keyTable, mixContour, PITCH_KEYS, weights, YAW_KEYS } from '../src/contour'
import { defaultShape, makeHead } from '../src/head'
import { candidates, hiddenOn, occluder } from '../src/outline'
import { type V3, dot, len, mirror, rotate, screenAxes, sub, toCamera } from '../src/view'

const head = makeHead(defaultShape)
const table = keyTable(head)
const close = (a: V3, b: V3, eps = 1e-9) => len(sub(a, b)) < eps

describe('camera', () => {
  it('toCamera is the head-space direction that rotates to +z; screen axes rotate to +x and +y', () => {
    for (const v of [{ yaw: 0, pitch: 0 }, { yaw: 37, pitch: -21 }, { yaw: -90, pitch: 45 }]) {
      expect(close(rotate(toCamera(v), v), [0, 0, 1])).toBe(true)
      const ax = screenAxes(v)
      expect(close(rotate(ax.right, v), [1, 0, 0])).toBe(true)
      expect(close(rotate(ax.up, v), [0, 1, 0])).toBe(true)
    }
  })
  it('yaw > 0 turns the face (+z) toward the screen right; pitch > 0 shows the underside (仰视)', () => {
    expect(rotate([0, 0, 1], { yaw: 30, pitch: 0 })[0]).toBeGreaterThan(0)
    expect(rotate([0, -1, 0], { yaw: 0, pitch: 30 })[2]).toBeGreaterThan(0)
  })
})

describe('rough head', () => {
  it('every section is convex about its centre: back ≤ widest depth ≤ front', () => {
    for (let y = head.shape.yMin; y <= head.shape.yMax; y += 0.01) { const s = head.section(y); expect(s.b <= s.z0 + 1e-12 && s.z0 <= s.f + 1e-12).toBe(true) }
  })
  it('normals point outward (away from a point inside the head) and the head is mirror-symmetric in x', () => {
    const inside: V3 = [0, -0.3, 0.1]
    for (const y of [0.8, 0, -0.6, -1.1]) for (const u of [-2.5, -1, 0, 0.7, 2]) {
      const p = head.at(u, y), n = head.normal(u, y)
      expect(dot(n, sub(p, inside))).toBeGreaterThan(0)
      expect(close(head.at(-u, y), mirror(p), 1e-12)).toBe(true)
    }
  })
})

describe('outline', () => {
  it('level front view: the outline runs down both sides at x = ±half-width, visible', () => {
    const v = { yaw: 0, pitch: 0 }, occ = occluder(head, v)
    const pts = candidates(head, v).flatMap(l => l.pts)
    for (const y of [-0.3, -0.7]) {
      const near = pts.filter(q => Math.abs(q.y - y) < 0.02 && q.p[0] > 0)
      expect(near.length).toBeGreaterThan(0)
      for (const q of near) { expect(Math.abs(q.p[0] - head.section(y).a)).toBeLessThan(0.02); expect(hiddenOn(occ, q.p, q.u, q.y)).toBe(false) }
    }
  })
  it('a point at the back of the head is hidden behind the face (the occlusion test works)', () => {
    const v = { yaw: 0, pitch: 0 }, occ = occluder(head, v), u = Math.PI, y = -0.2
    expect(hiddenOn(occ, head.at(u, y), u, y)).toBe(true)
  })
})

describe('key contours', () => {
  it('every key has both sides, three segments each, fixed counts (absent ones filled)', () => {
    for (const k of table.keys) for (const s of [k.pos, k.neg]) { expect(s.length).toBe(3); s.forEach((seg, i) => expect(seg.samples.length).toBe(COUNTS[i])) }
  })
  it('the level key is complete and visible on both sides, the two sides mirror images', () => {
    const k = table.at(0, 0)
    for (const s of [k.pos, k.neg]) for (const seg of s) { expect(seg.present).toBe(true); expect(seg.vis.every(Boolean)).toBe(true) }
    k.pos.forEach((seg, i) => seg.samples.forEach((q, j) => { expect(q.y).toBeCloseTo(k.neg[i]!.samples[j]!.y, 12); expect(q.u).toBeCloseTo(-k.neg[i]!.samples[j]!.u, 12) }))
  })
  it('segments meet at their anchors (each segment starts where the previous one ended)', () => {
    for (const k of table.keys) for (const s of [k.pos, k.neg]) for (let i = 1; i < 3; i++) {
      if (!s[i]!.present || !s[i - 1]!.present) continue
      const a = s[i - 1]!.samples[COUNTS[i - 1]! - 1]!, b = s[i]!.samples[0]!
      expect(close(head.at(a.u, a.y), head.at(b.u, b.y), 1e-9)).toBe(true)
    }
  })
  it('reports which key segments are absent (recorded, not hidden)', () => {
    const absent = table.keys.flatMap(k => (['pos', 'neg'] as const).flatMap(s => k[s].map((seg, i) => seg.present ? [] : [`${k.view.yaw},${k.view.pitch} ${s}${i}`]).flat()))
    console.log(`absent key segments (${absent.length} of ${table.keys.length * 6}):`, absent.join('  '))
    expect(absent.length).toBeLessThan(table.keys.length * 6)
  })
})

describe('mixing', () => {
  it('weights: one key at a key view, bilinear in between, summing to 1', () => {
    expect(weights(30, 0)).toEqual([{ yaw: 30, pitch: 0, w: 1 }])
    const w = weights(45, 15)
    expect(w.length).toBe(4)
    expect(w.reduce((a, b) => a + b.w, 0)).toBeCloseTo(1, 12)
  })
  it('at every key view the mixed line is the key exactly', () => {
    for (const yaw of YAW_KEYS) for (const pitch of PITCH_KEYS) {
      const k = table.at(yaw, pitch)
      for (const line of mixContour(head, table, { yaw, pitch })) {
        const segs = k[line.side]
        const want = segs.flatMap((seg, i) => (i === 0 ? seg.samples : seg.samples.slice(1)).map(q => head.at(q.u, q.y)))
        want.forEach((p, i) => expect(close(line.pts[i]!, p, 1e-12)).toBe(true))
      }
    }
  })
  it('continuity: approaching a key from both sides converges to it (no jump at the grid)', () => {
    for (const [yaw, pitch] of [[30, 0], [60, 30], [0, -30]] as const) {
      const at = mixContour(head, table, { yaw, pitch })
      // lines matched by side: a negative yaw lists them the other way round
      const gap = (dy: number, dp: number) => Math.max(...mixContour(head, table, { yaw: yaw + dy, pitch: pitch + dp }).flatMap(l => l.pts.map((p, i) => len(sub(p, at.find(a => a.side === l.side)!.pts[i]!)))))
      for (const d of [1e-3, -1e-3]) { expect(gap(d, 0)).toBeLessThan(1e-3); expect(gap(0, d)).toBeLessThan(1e-3) }
    }
  })
  it('negative yaw is the mirror of positive yaw with the sides swapped', () => {
    const a = mixContour(head, table, { yaw: 40, pitch: 10 }), b = mixContour(head, table, { yaw: -40, pitch: 10 })
    for (const la of a) { const lb = b.find(l => l.side !== la.side)!; la.pts.forEach((p, i) => expect(close(mirror(p), lb.pts[i]!, 1e-12)).toBe(true)) }
  })
})

describe('path independence and the u seam (dot 1792489303)', () => {
  it('a view jumped to directly, reached by a forward sweep and by a backward sweep draws the same, in yaw and in pitch', () => {
    const same = (a: ReturnType<typeof mixContour>, b: ReturnType<typeof mixContour>) =>
      a.every(la => { const lb = b.find(l => l.side === la.side)!; return la.pts.every((p, i) => close(p, lb.pts[i]!, 1e-15)) && la.vis.every((v, i) => v === lb.vis[i]) })
    for (const target of [{ yaw: 47, pitch: 13 }, { yaw: -71, pitch: -38 }, { yaw: 88, pitch: 41 }]) {
      const direct = mixContour(head, table, target)
      for (const axis of ['yaw', 'pitch'] as const) for (const from of [-1, 1]) {
        let last = direct
        for (let k = 20; k >= 0; k--) { const v = { ...target, [axis]: target[axis] + from * k }; last = mixContour(head, table, v) }
        expect(same(direct, last)).toBe(true)
      }
    }
  })
  it('mixing across the ±π seam stays between the two keys (u unwrapped, not averaged through the front)', () => {
    let checked = 0
    for (let a = 0; a < YAW_KEYS.length - 1; a++) for (const pitch of PITCH_KEYS) {
      const k0 = table.at(YAW_KEYS[a]!, pitch), k1 = table.at(YAW_KEYS[a + 1]!, pitch)
      const mid = mixContour(head, table, { yaw: (YAW_KEYS[a]! + YAW_KEYS[a + 1]!) / 2, pitch })
      for (const side of ['pos', 'neg'] as const) {
        const line = mid.find(l => l.side === side)!
        let n = 0
        for (let seg = 0; seg < 3; seg++) for (let i = seg === 0 ? 0 : 1; i < COUNTS[seg]!; i++, n++) {
          const q0 = k0[side][seg]!.samples[i]!, q1 = k1[side][seg]!.samples[i]!
          if (Math.abs(q0.u) < 2.5 && Math.abs(q1.u) < 2.5) continue
          const p0 = head.at(q0.u, q0.y), p1 = head.at(q1.u, q1.y), m = line.pts[n]!
          expect(len(sub(m, p0)) + len(sub(m, p1))).toBeLessThan(1.5 * len(sub(p0, p1)) + 0.05)
          checked++
        }
      }
    }
    console.log(`seam samples checked: ${checked}`)
  })
})

describe('surface bones', () => {
  it('attaching then placing gives the point back (the round trip is exact up to the search)', () => {
    for (const d of BONE_DEFS) for (const p of d.pts) expect(len(sub(place(head, attach(head, p)), p))).toBeLessThan(1e-6)
  })
})
