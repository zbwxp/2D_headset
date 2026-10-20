// The VTuber viewing pose split into the modelling view B plus an in-picture roll (fit/pose.ts): the split reproduces
// the head's rotation exactly, and the corner cases come out as expected.
import { describe, expect, it } from 'vitest'
import { B, Rz, mul, split } from '../fit/pose'

describe('VTuber pose → modelling view B + roll', () => {
  it('Rz(roll)·B(yaw, pitch) equals the head rotation for a grid of poses', () => {
    let worst = 0
    for (const X of [-90, -60, -15, 0, 30, 75, 90]) for (const Y of [-60, -30, 0, 20, 45, 60]) for (const Z of [-30, 0, 10, 30]) {
      const s = split(X, Y, Z), R = mul(Rz(s.roll), B(s.yaw, s.pitch))
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(R[i]![j]! - s.A[i]![j]!))
    }
    expect(worst).toBeLessThan(1e-9)
  })
  it('corner cases: turning only is B yaw; nodding only at the front is B pitch; tilting only is a roll; a profile nod is a pure roll', () => {
    const t = split(40, 0, 0); expect(t.yaw).toBeCloseTo(40, 9); expect(t.pitch).toBeCloseTo(0, 9); expect(t.roll).toBeCloseTo(0, 9)
    const n = split(0, 25, 0); expect(n.yaw).toBeCloseTo(0, 9); expect(n.pitch).toBeCloseTo(25, 9); expect(n.roll).toBeCloseTo(0, 9)
    const z = split(0, 0, 10); expect(z.yaw).toBeCloseTo(0, 9); expect(z.pitch).toBeCloseTo(0, 9); expect(z.roll).toBeCloseTo(10, 9)
    const p = split(90, 30, 0); expect(p.yaw).toBeCloseTo(90, 9); expect(p.pitch).toBeCloseTo(0, 9); expect(Math.abs(p.roll)).toBeCloseTo(30, 9)
  })
  it('the neck pivot: looking down lowers the head in the picture, looking up raises the chin', () => {
    const at = (Y: number, p: number[]) => { const s = split(0, Y, 0), d = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!; return d(s.A[1]!, p) + s.shift[1]! }
    const centre = [0, 0, 0], chin = [0, -1.2, 0.75]
    expect(at(0, centre)).toBeCloseTo(0, 12)
    expect(at(-30, centre)).toBeLessThan(-0.05)
    expect(at(30, chin)).toBeGreaterThan(at(0, chin))
    expect(at(-30, chin)).toBeLessThan(at(0, chin))
  })
})
