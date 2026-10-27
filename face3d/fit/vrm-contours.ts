// The VRoid head's outline seen from every 15° (bowen 1793075586 「每15度画一道轮廓…用不同颜色画…拖拽任意角度查看」): for each
// view (turn −90…90 × pitch −45…45, 15° steps; pitch = the camera tilting after the turn, as everywhere in face3d), the curve
// on the skin where the surface turns edge-on to that view (smooth contour: the zero line of normal · view direction inside each
// triangle, from the file's vertex normals), kept where that view's depth buffer shows it — the outline you see from there.
// Plus the semantic points at 0,0 (eye corners, nose tip, mouth, 山根, 眉心, upper and lower ear roots), found on the mesh.
// Writes face3d/viewer/vrm-contours.json. Run: npx vite-node face3d/fit/vrm-contours.ts [face3d/fit/ref/test.vrm]
import { readFileSync, writeFileSync } from 'node:fs'
import { cutNeck, loadVrmHead, rasterHead } from '../mesh/vrmhead'
import { type V3, rotate, toCamera } from '../src/view'

const file = process.argv[2] ?? 'face3d/fit/ref/test.vrm'
const b = readFileSync(file), D = cutNeck(loadVrmHead(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))) // no neck: the outline closes over the chin (bowen 1793076475)
const P = D.P, N = D.N, T = D.skinTris
const dot = (a: V3, c: V3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2]
const lerp = (a: V3, c: V3, t: number): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]

function contour(yaw: number, pitch: number): { seg: number[]; outer: number[] } {
  const d = toCamera({ yaw, pitch }), g = N.map(n => dot(n, d))
  const W = 480, f = { W, H: W, S: W / 3.4, cx: W / 2, cy: W * 0.47 }, ras = rasterHead(D, { yaw, pitch }, f, new Uint8ClampedArray(W * W * 4))
  const visible = (p: V3) => { const r = rotate(p, { yaw, pitch }), x = Math.round(f.cx + r[0] * f.S), y = Math.round(f.cy - r[1] * f.S)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < W && r[2] >= ras.zb[Y * W + X]! - 0.03) return true }
    return false }
  const out: number[] = [], outer: number[] = []
  for (let t = 0; t < T.length; t += 3) {
    const ids = [T[t]!, T[t + 1]!, T[t + 2]!], gs = ids.map(i => g[i]!)
    if (gs.every(v => v > 0) || gs.every(v => v < 0)) continue
    const pts: V3[] = []
    for (let e = 0; e < 3; e++) { const i = ids[e]!, j = ids[(e + 1) % 3]!, gi = g[i]!, gj = g[j]!; if ((gi > 0) !== (gj > 0)) pts.push(lerp(P[i]!, P[j]!, gi / (gi - gj))) }
    if (pts.length !== 2) continue
    const m = lerp(pts[0]!, pts[1]!, 0.5)
    if (!visible(m)) continue
    for (const p of pts) out.push(+p[0].toFixed(4), +p[1].toFixed(4), +p[2].toFixed(4))
    // the outermost outline: the segment touches the background (no head drawn) within 3 px on screen
    const r = rotate(m, { yaw, pitch }), x = Math.round(f.cx + r[0] * f.S), y = Math.round(f.cy - r[1] * f.S); let edge = false
    for (let dy = -3; dy <= 3 && !edge; dy++) for (let dx = -3; dx <= 3 && !edge; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= W || ras.zb[Y * W + X] === -Infinity) edge = true }
    outer.push(edge ? 1 : 0)
  }
  return { seg: out, outer }
}

// ---- semantic points at 0,0 (head space: x right, y up, z toward the viewer; the near side in our drawings is x < 0) ----
const skin = new Set(T), part = (re: RegExp) => D.parts.filter(p => p.kind === 'feature' && re.test(String((p as unknown as { material?: string }).material ?? '')))
void part
const SK = [...skin].map(i => ({ i, p: P[i]! }))
// eye whites: the feature part coloured white (EyeWhite)
const white = D.parts.find(p => p.kind === 'feature' && p.color[0] === 245)!, wv = [...new Set(white.tris)].map(i => P[i]!)
const eye = (side: -1 | 1) => { const vs = wv.filter(p => Math.sign(p[0]) === side), ax = (p: V3) => Math.abs(p[0])
  const inner = vs.reduce((a, p) => (ax(p) < ax(a) ? p : a)), outer = vs.reduce((a, p) => (ax(p) > ax(a) ? p : a)); return { inner, outer } }
// the midline profile: skin points with |x| small, by height
const mid = SK.filter(s => Math.abs(s.p[0]) < 0.02 && s.p[2] > 0).map(s => s.p).sort((a, c) => a[1] - c[1])
const noseTip = mid.reduce((a, p) => (p[2] > a[2] && p[1] > -0.9 ? p : a))
const above = mid.filter(p => p[1] > noseTip[1] && p[1] < noseTip[1] + 0.6)
// 山根: the deepest point of the bridge above the nose tip (before the brow comes forward again); 眉心: the most forward above it
let nasion = above[0]!; for (const p of above) if (p[2] < nasion[2] && p[1] < (eye(-1).inner[1] + 0.12)) nasion = p
const glabella = above.filter(p => p[1] > nasion[1]).reduce((a, p) => (p[2] > a[2] ? p : a), nasion)
// mouth: the mouth part's centre, put on the skin in front of it
const mouthPart = D.parts.find(p => p.kind === 'feature' && p.color[0] === 180)
const mv = mouthPart ? [...new Set(mouthPart.tris)].map(i => P[i]!) : []
const mouthC: V3 = mv.length ? [0, mv.reduce((a, p) => a + p[1], 0) / mv.length, Math.max(...mv.map(p => p[2]))] : [0, 0, 0]
// ears (near side, x < 0): the skin standing out past the head's side (|x| > 0.92; the head there is ~0.87 wide) behind the
// cheek; each root = the ear point nearest the head (smallest |x|) at the ear's top and at its bottom
const E = SK.filter(s => s.p[0] < -0.92 && s.p[2] > -0.6 && s.p[2] < 0.15 && s.p[1] < 0 && s.p[1] > -1.1).map(s => s.p)
const yTop = Math.max(...E.map(p => p[1])), yLow = Math.min(...E.map(p => p[1]))
const nearest = (ps: V3[]) => ps.reduce((a, p) => (Math.abs(p[0]) < Math.abs(a[0]) ? p : a))
const earTop = nearest(E.filter(p => p[1] > yTop - 0.08)), earLow = nearest(E.filter(p => p[1] < yLow + 0.08))
const R = (p: V3 | null) => p && p.map(v => +v.toFixed(4))
const points = { '外眼角(画面左)': R(eye(-1).outer), '内眼角(画面左)': R(eye(-1).inner), '内眼角(画面右)': R(eye(1).inner), '外眼角(画面右)': R(eye(1).outer), '鼻尖': R(noseTip), '山根': R(nasion), '眉心': R(glabella), '嘴': R(mouthC), '上耳根(画面左)': R(earTop), '下耳根(画面左)': R(earLow) }
console.log(JSON.stringify(points))

const contours: { yaw: number; pitch: number; seg: number[]; outer: number[] }[] = []
for (let pitch = -45; pitch <= 45; pitch += 15) for (let yaw = -90; yaw <= 90; yaw += 15) contours.push({ yaw, pitch, ...contour(yaw, pitch) })
writeFileSync('face3d/viewer/vrm-contours.json', JSON.stringify({ note: 'VRoid head outlines from every 15° (face3d/fit/vrm-contours.ts, bowen 1793075586); head space x right, y up, z toward the viewer', points, contours }))
console.log('contours', contours.length, 'segments', contours.reduce((a, c) => a + c.seg.length / 6, 0))
