// Run: npx vite-node face3d/mesh/check-skin.ts <file.vrm> (read-only)
// Apply the skin (rest-pose joint world × inverse bind, JOINTS_0 / WEIGHTS_0) to every vertex of both meshes and
// compare with the POSITION values read directly: the largest displacement, overall and for the head (y ≥ 1.47 m).
import { readFileSync } from 'node:fs'
const b = readFileSync(process.argv[2] ?? '/Users/bowen/Desktop/test.vrm'), buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
const dv = new DataView(buf), len = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))), bin = new DataView(buf, 20 + len + 8)
type M = number[]
const mul = (a: M, c: M) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) for (let e = 0; e < 4; e++) o[k * 4 + r] += a[e * 4 + r]! * c[k * 4 + e]!; return o }
const trs = (n: any): M => { if (n.matrix) return n.matrix; const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0]; return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1] }
const parent: Record<number, number> = {}; json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => { parent[c] = i }))
const world = (i: number): M => parent[i] === undefined ? trs(json.nodes[i]) : mul(world(parent[i]!), trs(json.nodes[i]))
const SIZE: any = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, CS: any = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }
const read = (ai: number) => { const a = json.accessors[ai], v = json.bufferViews[a.bufferView], n = SIZE[a.type], st = v.byteStride ?? n * CS[a.componentType], base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out: number[] = []; for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) { const o = base + i * st; out.push(a.componentType === 5126 ? bin.getFloat32(o + k * 4, true) : a.componentType === 5125 ? bin.getUint32(o + k * 4, true) : a.componentType === 5123 ? bin.getUint16(o + k * 2, true) : bin.getUint8(o + k)) } return out }
json.nodes.forEach((node: any) => {
  if (node.mesh === undefined) return
  const skin = json.skins[node.skin], ibmA = read(skin.inverseBindMatrices), J = skin.joints.map((j: number, k: number) => mul(world(j), ibmA.slice(16 * k, 16 * k + 16)))
  const nodeWorld = world(json.nodes.indexOf(node))
  let all = 0, head = 0, n = 0
  const seen = new Set<number>()
  for (const p of json.meshes[node.mesh].primitives) {
    if (seen.has(p.attributes.POSITION)) continue; seen.add(p.attributes.POSITION)
    const P = read(p.attributes.POSITION), JI = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0)
    for (let i = 0; i < P.length / 3; i++) {
      const x = P[3 * i]!, y = P[3 * i + 1]!, z = P[3 * i + 2]!, s = [0, 0, 0]
      for (let k = 0; k < 4; k++) { const w = W[4 * i + k]!; if (!w) continue; const m = J[JI[4 * i + k]!]!; s[0] += w * (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!); s[1] += w * (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!); s[2] += w * (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) }
      const d = Math.hypot(s[0]! - x, s[1]! - y, s[2]! - z); all = Math.max(all, d); if (y >= 1.47) head = Math.max(head, d); n++
    }
  }
  console.log(`${node.name}: ${n} vertices; node world identity: ${nodeWorld.every((v, e) => Math.abs(v - (e % 5 === 0 ? 1 : 0)) < 1e-12)}; skinned − read: max ${(all * 1000).toFixed(4)} mm overall, ${(head * 1000).toFixed(4)} mm for y ≥ 1.47 m`)
})
