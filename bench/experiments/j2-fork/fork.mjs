// J2 experiment (docs/j2-swept-joins-checklist.md §2; dot 1791814515): the three-line fork under the CANDIDATE
// generation rule — widths eased per governing join, then every swept piece unioned. Not product code, not
// imported. Centre lines are fixed straight lines at 120° (no spring solve). Writes fork.svg.
// Run: node bench/experiments/j2-fork/fork.mjs <outdir>
import { union, FillRule } from 'clipper2-ts'
import { writeFileSync } from 'node:fs'

const out = process.argv[2] ?? '.'
const S = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))
const V = (x, y) => ({ x, y }), add = (a, b) => V(a.x + b.x, a.y + b.y), mul = (a, k) => V(a.x * k, a.y * k)
const len = a => Math.hypot(a.x, a.y), norm = a => mul(a, 1 / len(a))
const dir = deg => V(Math.cos(deg * Math.PI / 180), -Math.sin(deg * Math.PI / 180)) // y down (SVG)
const L = 60, W = { a: 4, b: 8, c: 12 }, D = { a: dir(180), b: dir(60), c: dir(-60) }
const zone = (w0, w1) => Math.max(w0, w1) ** 2 / Math.min(w0, w1) // desired (bowen 1791809660)
const limited = (z, l0, l1) => 2 * Math.min(z / 2, l0 / 3, l1 / 3) // between two lines (principle §4)

// a swept stroke: points along a polyline with a half-width at each, as the union of the convex hulls of consecutive discs
const disc = (c, r) => Array.from({ length: 48 }, (_, i) => add(c, V(r * Math.cos(i * Math.PI / 24), r * Math.sin(i * Math.PI / 24))))
const hull = ps => {
  const q = [...ps].sort((a, b) => a.x - b.x || a.y - b.y), cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lo = [], up = []
  for (const p of q) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p) }
  for (const p of q.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p) }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}
const SC = 1000
const sweep = samples => samples.slice(1).map((b, i) => hull([...disc(samples[i].p, samples[i].h), ...disc(b.p, b.h)]))
const unite = polys => union(polys.map(p => p.map(v => ({ x: Math.round(v.x * SC), y: Math.round(v.y * SC) }))), FillRule.NonZero).map(p => p.map(v => V(v.x / SC, v.y / SC)))

/** A straight line from the joint p outward, its half-width h(d) at distance d from p; `from` trims its start. */
const line = (k, hOf, from = 0) => Array.from({ length: Math.ceil((L - from) / 0.25) + 1 }, (_, i) => { const d = Math.min(L, from + i * 0.25); return { p: mul(D[k], d), h: hOf(d) } })
const own = k => () => W[k] / 2
/** One S-curve across a joint: line k's half-width at distance d, meeting width `meet` (full) at the joint over a zone Z. */
const eased = (k, meet, Z) => d => { const h = W[k] / 2, m = meet / 2; return d >= Z / 2 ? h : h + (2 * m - 2 * h) * S(0.5 - d / Z) }
// (the S-curve from the line's width to the width 2·meet − w on the far side, so the joint gets `meet`)

// the arc a–c: a fillet of radius R between the two lines (120° apart)
const R = 15, t = R / Math.tan(Math.PI / 3), bis = norm(add(D.a, D.c)), centre = mul(bis, R / Math.sin(Math.PI / 3))
const ta = mul(D.a, t), tc = mul(D.c, t)
const ang = p => Math.atan2(p.y - centre.y, p.x - centre.x)
let a0 = ang(ta), a1 = ang(tc); if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; if (a0 - a1 > Math.PI) a1 += 2 * Math.PI
const A = R * Math.abs(a1 - a0)
/** The path a (far end → ta), the arc, c (tc → far end) with one S-curve from a's width to c's, centred on the arc's middle. */
function arcPath() {
  const la = L - t, Z = Math.min(zone(W.a, W.c), A + 2 * Math.min((zone(W.a, W.c) - A) / 2, la / 3, la / 3))
  const pts = []
  for (let d = L; d >= t; d -= 0.25) pts.push(mul(D.a, d))
  for (let i = 0; i <= 60; i++) { const th = a0 + (a1 - a0) * i / 60; pts.push(add(centre, V(R * Math.cos(th), R * Math.sin(th)))) }
  for (let d = t; d <= L; d += 0.25) pts.push(mul(D.c, d))
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + len(add(pts[i], mul(pts[i - 1], -1))))
  const mid = la + A / 2
  return { samples: pts.map((p, i) => ({ p, h: (W.a + (W.c - W.a) * S((s[i] - (mid - Z / 2)) / Z)) / 2 })), Z, aEnd: (W.a + (W.c - W.a) * S((la - (mid - Z / 2)) / Z)) }
}

// ---- the cases (each: a list, the pieces, the zone marks, the notes) ----
const Zab = limited(zone(W.a, W.b), L, L), Zac = limited(zone(W.a, W.c), L, L)
const cases = []
// 1: a–c smooth on top, a–b bound below
cases.push({ title: '① a–c 平滑（上）· a–b 仅绑定（下）', panels: [
  { sub: '只有上层 a–c', lines: { a: eased('a', 8, Zac), c: eased('c', 8, Zac) }, marks: { a: Zac / 2, c: Zac / 2 }, note: 'a、c 在接点都是 8；接管 Z/2 = ' + (Zac / 2).toFixed(1) },
  { sub: '加入下层 a–b', lines: { a: eased('a', 8, Zac), c: eased('c', 8, Zac), b: own('b') }, marks: { a: Zac / 2, c: Zac / 2 }, note: 'b 由 a–b 管：去接 a 在接点的 8，本来就是 8，不变；三条并成一组' },
] })
// 2: reversed
cases.push({ title: '② a–b 仅绑定（上）· a–c 平滑（下）', panels: [
  { sub: '只有上层 a–b', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab) }, marks: { a: Zab / 2, b: Zab / 2 }, note: 'a、b 在接点都是 6；接管 Z/2 = ' + (Zab / 2).toFixed(1) },
  { sub: '加入下层 a–c', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab), c: eased('c', 6, Zac) }, marks: { a: Zab / 2, b: Zab / 2, c: Zac / 2 }, note: 'c 由 a–c 管：去接 a 在接点的 6（不是平均 8），按 a–c 的 Z/2 = ' + (Zac / 2).toFixed(1) },
] })
// 3: c attached later, no join
cases.push({ title: '③ 只有 a–b 仅绑定 · c 后接、无接法', panels: [
  { sub: '只有 a–b', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab) }, marks: { a: Zab / 2, b: Zab / 2 }, note: '' },
  { sub: '加入后接的 c', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab), c: eased('c', 6, Zab) }, marks: { a: Zab / 2, b: Zab / 2, c: Zab / 2 }, note: 'c 被 a–b 接管：按 a–b 的 Z/2 缓变到 6，并入 a–b 那一组' },
] })
const arc = arcPath()
// 4a: arc a–c on top, bound a–b below
cases.push({ title: '④a 圆弧 a–c（上，r=15）· a–b 仅绑定（下）', panels: [
  { sub: '只有上层圆弧', path: arc.samples, lines: {}, marks: {}, note: '弧截短 a、c 各 ' + t.toFixed(1) + '；宽度沿 a→弧→c 一条 S 形（Z=' + arc.Z.toFixed(1) + '，以弧中点为中心）' },
  { sub: '加入下层 a–b', path: arc.samples, lines: { b: own('b') }, marks: {}, note: 'b 仍接到原接点 p（弧外的角点）：a 已被截短，b 的端头伸进弧外的空角里' },
] })
// 4b: bound a–b on top, arc below
cases.push({ title: '④b a–b 仅绑定（上）· 圆弧 a–c（下）', panels: [
  { sub: '只有上层 a–b', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab) }, marks: { a: Zab / 2, b: Zab / 2 }, note: '' },
  { sub: '候选：整组退成 bound，撤销截线', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab), c: eased('c', 6, Zac) }, marks: { a: Zab / 2, b: Zab / 2, c: Zac / 2 }, note: '弧不画，a、c 不截；c 按 a–c 接 a 的 6' },
  { sub: '对照：只取消弧，保留截短', lines: { a: eased('a', 6, Zab), b: eased('b', 6, Zab), c: own('c') }, from: { a: t, c: t }, marks: {}, note: 'a、c 仍截短 ' + t.toFixed(1) + '：接点处留下缺口' },
] })

// ---- drawing ----
const PW = 380, PH = 330, SCALE = 2.0, PAD = 20
const P = pts => 'M' + pts.map(v => `${(v.x).toFixed(2)} ${(v.y).toFixed(2)}`).join(' L') + ' Z'
let svg = '', y = 110, clipId = 0
const W_ = PAD * 2 + PW * 3 + 20 * 2
for (const c of cases) {
  svg += `<text x="${PAD}" y="${y - 12}" font-size="18" font-weight="bold" fill="#222">${c.title}</text>`
  c.panels.forEach((pn, i) => {
    const x0 = PAD + i * (PW + 20)
    const polys = []
    for (const [k, hOf] of Object.entries(pn.lines)) polys.push(...sweep(line(k, hOf, pn.from?.[k] ?? 0)))
    if (pn.path) polys.push(...sweep(pn.path))
    const ink = unite(polys)
    const orig = Object.keys(pn.lines).concat(pn.path ? ['a', 'c'] : []).map(k => unite(sweep(line(k, own(k)))))
    const cid = 'k' + clipId++
    svg += `<g><defs><clipPath id="${cid}"><rect x="${x0}" y="${y + 26}" width="${PW}" height="${PH - 64}"/></clipPath></defs><rect x="${x0}" y="${y}" width="${PW}" height="${PH}" fill="#fff" stroke="#ccc"/>`
    svg += `<text x="${x0 + 8}" y="${y + 20}" font-size="14" fill="#333">${pn.sub}</text>`
    // the fork's box is x −60…30, y −52…52 around p: p placed so the box is centred
    svg += `<g clip-path="url(#${cid})"><g transform="translate(${x0 + PW / 2 + 15 * SCALE} ${y + 26 + (PH - 64) / 2}) scale(${SCALE})">`
    svg += `<path d="${ink.map(P).join(' ')}" fill="#111" fill-rule="nonzero"/>`
    for (const o of orig) svg += `<path d="${o.map(P).join(' ')}" fill="none" stroke="#e33" stroke-width="${0.6 / SCALE * 2}" stroke-dasharray="1.2 0.8"/>`
    for (const [k, m] of Object.entries(pn.marks)) {
      const q = mul(D[k], m), n = V(-D[k].y, D[k].x)
      svg += `<line x1="${q.x + n.x * 9}" y1="${q.y + n.y * 9}" x2="${q.x - n.x * 9}" y2="${q.y - n.y * 9}" stroke="#08f" stroke-width="0.5"/>`
    }
    for (const k of ['a', 'b', 'c']) if (pn.lines[k] || (pn.path && k !== 'b')) { const q = mul(D[k], L - 8), n = V(-D[k].y, D[k].x); svg += `<text x="${q.x + n.x * 9 - 4}" y="${q.y + n.y * 9 + 2}" font-size="6" fill="#06c">${k} 宽${W[k]}</text>` }
    svg += `<circle cx="0" cy="0" r="1" fill="#e80"/></g></g>`
    // the joint enlarged, in the empty lower-left of the panel (the same ink, outlines and marks)
    const ZS = 5.5, iw = 186, ih = 112, ix = x0 + 8, iy = y + 26 + (PH - 64) - ih - 6
    svg += `<defs><clipPath id="${cid}z"><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}"/></clipPath></defs><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="#fff" stroke="#888"/>`
    svg += `<g clip-path="url(#${cid}z)"><g transform="translate(${ix + iw / 2 + 2 * ZS} ${iy + ih / 2}) scale(${ZS})">`
    svg += `<path d="${ink.map(P).join(' ')}" fill="#111" fill-rule="nonzero"/>`
    for (const o of orig) svg += `<path d="${o.map(P).join(' ')}" fill="none" stroke="#e33" stroke-width="${1.2 / ZS}" stroke-dasharray="${3 / ZS} ${2 / ZS}"/>`
    for (const [k, m] of Object.entries(pn.marks)) {
      const q = mul(D[k], m), n = V(-D[k].y, D[k].x)
      svg += `<line x1="${q.x + n.x * 9}" y1="${q.y + n.y * 9}" x2="${q.x - n.x * 9}" y2="${q.y - n.y * 9}" stroke="#08f" stroke-width="${1.2 / ZS}"/>`
    }
    svg += `<circle cx="0" cy="0" r="${2 / ZS}" fill="#e80"/></g></g><text x="${ix + 4}" y="${iy + 12}" font-size="10" fill="#666">接点放大</text>`
    svg += `<text x="${x0 + 8}" y="${y + PH - 24}" font-size="11" fill="#555">${pn.note}</text>`
    svg += `<text x="${x0 + 8}" y="${y + PH - 10}" font-size="10" fill="#999">候选：改宽后求并（非区域接管）· 中心线固定，未做弹簧求解</text></g>`
  })
  y += PH + 48
}
const H = y
const legend = `<text x="${PAD}" y="30" font-size="20" font-weight="bold" fill="#c00">J2 三线分叉（宽 a 4 · b 8 · c 12，彼此 120°）</text><text x="${PAD}" y="52" font-size="13" fill="#444">黑 = 候选生成的墨迹；红虚线 = 各线原来的等宽墨迹；蓝短线 = 接管范围（Z/2）；橙点 = 接点 p；左下小框 = 接点放大</text>`
writeFileSync(`${out}/fork.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(W_, H)}" height="${Math.max(W_, H)}" viewBox="0 0 ${Math.max(W_, H)} ${Math.max(W_, H)}" font-family="PingFang SC, Helvetica, sans-serif"><rect width="${W_}" height="${H}" fill="#f6f6f6"/>${legend}${svg}</svg>`)
console.log('wrote', `${out}/fork.svg`, W_, H)
