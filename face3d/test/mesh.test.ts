// The mesh-shell tools (mesh/shell.ts) checked on a mesh whose answers are known: the unit ball, and the loft head
// tessellated (its outline must match the loft's own projected edge).
import { describe, expect, it } from 'vitest'
import { makeHead } from '../src/head'
import { boundaryPoints, mask } from '../src/outline'
import { type Mesh, identityField, meshBoundary, reshape, toHeadSpace } from '../mesh/shell'
import { shapeOfB } from '../fit/shape'
import benchFit from '../fit/ref/fit-bench-all.json'

const sphere = (n = 48, c = [0.3, 1.5, -0.2], r = 0.12): Mesh => {
  const pos: number[] = [], idx: number[] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i < 2 * n; i++) { const th = (Math.PI * j) / n, ph = (Math.PI * i) / n; pos.push(c[0]! + r * Math.sin(th) * Math.sin(ph), c[1]! + r * Math.cos(th), c[2]! + r * Math.sin(th) * Math.cos(ph)) }
  for (let j = 0; j < n; j++) for (let i = 0; i < 2 * n; i++) { const a = j * 2 * n + i, b = j * 2 * n + ((i + 1) % (2 * n)); idx.push(a, a + 2 * n, b, b, a + 2 * n, b + 2 * n) }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}
const loftMesh = (): Mesh => {
  const head = makeHead(shapeOfB(benchFit)), nu = 160, ny = 120, { yMin, yMax } = head.shape, pos: number[] = [], idx: number[] = []
  for (let j = 0; j <= ny; j++) { const y = yMax - ((1 - Math.cos((Math.PI * j) / ny)) / 2) * (yMax - yMin); for (let i = 0; i < nu; i++) pos.push(...head.at(-Math.PI + (2 * Math.PI * i) / nu, y)) }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nu; i++) { const a = j * nu + i, b = j * nu + ((i + 1) % nu); idx.push(a, a + nu, b, b, a + nu, b + nu) }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}
const near = (p: number[], s: number[][]) => Math.sqrt(Math.min(...s.map(q => (p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2)))

describe('mesh shell', () => {
  it('a ball anywhere, any size, is put at the origin with radius 1', () => {
    const m = toHeadSpace(sphere(), 1), P = m.positions
    let worst = 0
    for (let i = 0; i < P.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(P[i]!, P[i + 1]!, P[i + 2]!) - 1))
    expect(worst).toBeLessThan(1e-4)
  })
  it('the tessellated loft\'s outline matches the loft\'s own projected edge (within two pixels) at several views', () => {
    const m = loftMesh(), head = makeHead(shapeOfB(benchFit))
    for (const v of [{ yaw: 0, pitch: 0 }, { yaw: 45, pitch: 0 }, { yaw: 90, pitch: 30 }, { yaw: -30, pitch: -45 }]) {
      const a = meshBoundary(m, v), b = boundaryPoints(mask(head, v, { nu: 240, ny: 180 }))
      expect(a.length).toBeGreaterThan(100)
      const d = Math.max(...a.filter((_, i) => i % 7 === 0).map(p => near(p, b)))
      expect(d).toBeLessThan(0.02)
    }
  }, 120000)
  it('the identity field leaves the mesh unchanged; the field is symmetric (θ and −θ)', () => {
    const m = loftMesh(), F = identityField([-1, 0, 1], [0, Math.PI / 2, Math.PI])
    expect([...reshape(m, F).positions].every((v, i) => v === m.positions[i])).toBe(true)
    F.s[1]![1] = 1.3
    const r = reshape({ positions: new Float32Array([0.5, 0, 0, -0.5, 0, 0]), indices: new Uint32Array() }, F).positions
    expect(r[0]).toBeCloseTo(-r[3]!, 12)
  })
})
