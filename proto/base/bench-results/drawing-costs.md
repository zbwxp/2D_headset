# Drawing-path cost inventory (2026-10-06, after 53d9fc0)

Source: `e2e/drawing-costs.spec.ts` (not in the gate — slow by design). One Playwright Chromium run on
bowen's Mac (Apple M4); synthetic workload (`?bench&curves=N&onion=K`: N open curves + 15 loop
curves/fills, 8 layers, connections, one pose per curve); A-mode drag of one free anchor; 6 measured
moves after one warm-up move; each move waits two animation frames. **Per-move averages; one run —
informational, not a benchmark, not a cross-machine claim.**

**Correction (same day):** the first table counted Fabric's top-layer `after:render` (renderTop,
`contextTop`) as a second render of each move and timed it from the earlier start mark, so "2 renders
per move" and "renderAll ≈ 156–207 ms" were wrong. Fixed in `FabricView`: only the main canvas render
is timed; input → paint is measured from the pointer event to the end of that render. Corrected run:

| curves | onion yaws | plan | preview changes | assemble lists | container scan | build objects | attach (remove + add) | renderAll (main canvas) | input → paint | renders / move | Fabric objects | path strings / move | whole-table rows / move |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 121 | 0 | 0.05 ms | 0.05 ms | 0.05 ms | 0.03 ms | 11.4 ms | 12.6 ms | 128.8 ms | 168.7 ms | 1 | 1,783 | 151 | 408 |
| 121 | 19 | 0.08 | 0.07 | 0.80 | 0.05 | 37.7 | 34.2 | 144.0 | 232.9 | 1 | 4,367 | 2,735 | 408 |
| 1000 | 0 | 0.08 | 0.08 | 0.07 | 0.43 | 86.2 | 138.8 | 151.1 | 394.1 | 1 | 13,210 | 1,030 | 3,045 |
| 1000 | 19 | 0.12 | 0.03 | 4.72 | 0.23 | 279.1 | 540.5 | 178.2 | 1,020.0 | 1 | 32,495 | 20,315 | 3,045 |
| 3000 | 0 | 0.10 | 0.07 | 0.15 | 0.65 | 259.8 | 743.7 | 186.5 | 1,209.6 | 1 | 39,210 | 3,030 | 9,045 |
| 3000 | 19 | — | — | — | — | — | — | — | — | — | — | — | — (did not finish the initial load within 300 s, first run) |

"Evaluation ≤ 5 ms" holds for THIS workload only (dot): no fill materials, no real recording, no
large-area full change.

## ⚠ Off-screen correction (same day)

All tables below this section and above were measured at the DEFAULT viewport (zoom 3), where the
synthetic drawing is mostly OFF the 640 × 420 canvas — and Fabric skips drawing off-screen objects. So
their renderAll / input → draw numbers UNDERSTATE a drawing that is on screen; they are kept only as a
record. Benchmark documents are now fitted to the canvas (`FabricView.fitToContent`), and the metric is
named **input → draw call done** (pointer event → end of the main canvas render; it does not prove
the pixels are presented — dot).

## Fitted to the canvas — main workload and curve-count stress (current numbers)

Main workload (closer to real use, dot / bowen) — **actual totals (naming corrected per dot):** 400 open
curves + **100 closed loop curves** (each fill's boundary is its own 4-segment loop curve) = **500
curves**, + **100 solid fills** (50 × 50, spacing 30 → overlapping each other),
+ **6,000 anchor dots** in A mode (500 curves × 4 anchors × 3 dots: anchor, hIn, hOut) =
**6,600 scene objects**, all on screen (fitted). Earlier labels "400 curves + 100 fills" undercounted.
**Paint-order caveat (dot):** both drawing paths (Fabric A and B) paint in a GLOBAL order — onion yaws →
all fills → all curves → dots — so fills never cover any curve. That violates doc 11 (depth by layer /
order / depth offset; RC-16: a fill must not cover its own boundary strokes, other objects cover it
normally). The earlier phrase "occluding curves of their layer" was wrong. A/B equality does not mean the
product rule holds; the shared paint order is an open fix (OPEN.md). Stress: curve count only. One Chromium run, fitted
viewport, A-mode drag, 6 moves; the grabbed anchor is recorded (S0.p1 free; L0.q1 = a fill boundary).
**Fill materials (gradient, blur, pattern, transparency stacks) are not implemented and not measured.**

| workload | onion | drag | mode | build objects | attach | renderAll | input → draw call done | objects | objects created / move |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 curves + 100 fills | 0 | free anchor | A | 0.50 ms | 0.12 ms | 552 ms | 570 ms | 6,600 | 1 |
| 500 curves + 100 fills | 0 | free anchor | full rebuild | 44.5 | 59.1 | 828 | 950 | 6,600 | 6,600 |
| 500 curves + 100 fills | 0 | fill boundary | A | 0.32 | 0.05 | 546 | 563 | 6,600 | 2 |
| 500 curves + 100 fills | 0 | fill boundary | full rebuild | 44.9 | 59.4 | 831 | 953 | 6,600 | 6,600 |
| 500 curves + 100 fills | 19 | free anchor | A | 1.38 | 0.40 | 569 | 591 | 16,100 | 20 |
| 500 curves + 100 fills | 19 | free anchor | full rebuild | 145.3 | 190.3 | 865 | 1,221 | 16,100 | 16,100 |
| 500 curves + 100 fills | 19 | fill boundary | A | 1.23 | 0.60 | 567 | 589 | 16,100 | 21 |
| 500 curves + 100 fills | 19 | fill boundary | full rebuild | 151.1 | 203.5 | 944 | 1,319 | 16,100 | 16,100 |
| stress 1000 curves | 0 | free anchor | A | 0.65 | 0.10 | 1,777 | 1,793 | 13,210 | 1 |
| stress 1000 curves | 19 | free anchor | A | 3.65 | 2.07 | 1,378 | 1,414 | 32,495 | 20 |
| stress 3000 curves | 0 | free anchor | A | 1.92 | 1.05 | 5,113 | 5,169 | 39,210 | 1 |
| stress 3000 curves | 19 | — | — | — | — | — | — | — | — (initial full build does not finish; not run) |

Plan, preview changes and list assembly stay ≤ 7 ms in every row. With the drawing on screen, Fabric's
**renderAll — repainting every object — is the dominant cost** (≈ 0.55 s per move for the main
workload even with A). Option A removes the rebuild / attach part (≈ 100–350 ms for the main
workload) but not the repaint. B (a reference implementation with the same output) is the comparison
for the repaint.

## Reference drawing path B — same picture with plain Canvas2D (dot)

`src/view/canvas2dRef.ts`, `?renderer=b`: draws the A-mode scene (onion yaws → fills → curves → anchor
dots) with the same canvas size, DPR, viewport, styles and Fabric's defaults; Path2D built from the
evaluated cubics, cached per evaluated item; the whole frame is repainted each render on the next
animation frame (as Fabric does). Input, hit testing, planning and preview are unchanged.

**Same picture, not pixel-identical** (`e2e/renderer-b.spec.ts`): example document — 245 of 44,133 ink
pixels differ by > 32 levels, coverage equal; main workload fitted (zoom 0.745, ≈ 0.5 px strokes) —
9,631 of 77,644 differ by > 32, total coverage within 0.41 %; at zoom 3 / 6 the share falls to 3.1 % /
2.3 %, no 8 × 8 block at zoom 6 differs by > 5 % on average, coverage within 0.01 %; crops at zoom 6
are visually identical. In these samples and by these measures, **every** visible difference
(> 32 levels) lies within 1 px of an edge in either image (0 interior differences). **Scope (dot):** this
does NOT prove the differences are all anti-aliasing — a sub-pixel shift, a missing thin line or a local
width change can also leave only edge differences, and coverage totals can cancel out. Line width,
geometric position and occlusion are to be checked separately on small images with exact expected
results. The mutations only show these particular faults are caught (a wrong fill colour in B →
thousands of interior differences; a doubled stroke width → caught by the coverage / visible-share
bounds, not by the edge classifier); they are not a guarantee against all shape / occlusion errors.

| workload (6,600 objects with 0 onion) | onion | drag | B renderAll | B input → draw call done | Fabric A renderAll | Fabric A input → draw call done |
| --- | --- | --- | --- | --- | --- | --- |
| 500 curves + 100 fills | 0 | free anchor | 1.9 ms | 17.7 ms | 552 ms | 570 ms |
| 500 curves + 100 fills | 0 | fill boundary | 2.2 | 18.3 | 546 | 563 |
| 500 curves + 100 fills | 19 | free anchor | 3.0 | 22.6 | 569 | 591 |
| 500 curves + 100 fills | 19 | fill boundary | 2.8 | 21.8 | 567 | 589 |
| stress 1000 | 0 | free anchor | 3.5 | 19.9 | 1,777 | 1,793 |
| stress 1000 | 19 | free anchor | 16.5 | 37.1 | 1,378 | 1,414 |
| stress 3000 | 0 | free anchor | 18.3 | 34.9 | 5,113 | 5,169 |
| stress 3000 | 19 | free anchor | 50.7 | 85.2 | — (did not load) | — |

Input → draw call done includes the wait for the next animation frame (≈ 16 ms) in both paths.

**Limits — not a decision:** one Chromium run on one machine; B covers only the A-mode drawing (V mode
with Fabric's transform box, selection etc. is still Fabric); Fabric ran with `objectCaching: false`
everywhere — Fabric's own object caching was NOT tried and should be measured (with the same pixel
checks) before concluding; no fill materials; "draw call done" is not presentation; GPU time not
measured.

## Option A — Fabric kept, objects reused (same display; dot) — measured OFF-SCREEN, see the correction above

A-mode scene kept per drawn item; only items whose cached evaluation changed are rebuilt (paths) or
moved (anchor dots); membership/order changes and V mode rebuild fully. No whole-table scan (top-level
containers from the parent index, V mode only). Same run conditions as the corrected baseline.

| curves | onion yaws | build objects | attach | renderAll (main canvas) | input → paint | objects created / move | path strings / move | rows scanned / move | baseline input → paint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 121 | 0 | 0.23 ms | 0.05 ms | 91.0 ms | 107.5 ms | 1 | 1 | 0 | 168.7 ms |
| 121 | 19 | 0.63 | 0.28 | 101.8 | 120.1 | 20 | 20 | 0 | 232.9 |
| 1000 | 0 | 0.35 | 0.03 | 99.7 | 117.7 | 1 | 1 | 0 | 394.1 |
| 1000 | 19 | 2.25 | 0.92 | 128.9 | 156.3 | 20 | 20 | 0 | 1,020.0 |
| 3000 | 0 | 0.98 | 0.20 | 123.1 | 143.7 | 1 | 1 | 0 | 1,209.6 |
| 3000 | 19 | — | — | — | — | — | — | — | — (initial load — the unchanged FULL build — did not finish within 300 s) |

Same display is tested: `e2e/scene-incremental.spec.ts` compares every canvas object (type, path
commands, position, size, colours, line width, order) of the incremental scene with a full rebuild,
during drags (preview) and after commit / undo, incl. 19 onion yaws (in the gate). After A, renderAll
— Fabric repainting every object (≈ 90–130 ms) — is what remains; B (a reference implementation with
the same output) is the comparison for that part. The initial full build at 3000 × 19 is unsolved.

What remains on the drawing path, per move (from the code and these counts):

1. **Whole-list consumption**: the view takes the whole preview list (`previewItems` = list length) and,
   with onion skins, one whole list per yaw (19 × N items).
2. **Path strings**: every visible curve / fill / onion curve is turned into an SVG path string
   (`cubicsToPath`), which Fabric then parses back into commands.
3. **Object rebuild**: every Fabric object is constructed again (`buildObjects`); in A mode three dots
   per anchor dominate the count (1,452 of 1,783 objects at 121 curves).
4. **Attach**: all canvas objects are removed and re-added every render (`attach`), growing faster
   than linearly with the object count here.
5. **One whole-table scan per render** (`all(reader, 'container')`): rows scanned = document size.
6. **renderAll** repaints every object (≈ 129–187 ms per render in the corrected run); one render per move.

Evaluation (plan + preview changes + list assembly) is ≤ 5 ms in every completed case; it is not where
the time goes. These numbers do not decide the drawing approach by themselves (dot: replacing the
renderer is not a given) — see the comparison proposed in OPEN.md.


## After paint order S1 + S2 (2026-10-06, single run, 0 onion, fitted, DPR 1)

The main workload's 100 fills are ALL painted after their own boundary loops, so all 100 leave out
their own ink (S2, scratch layer per protected fill).

| drag | B renderAll | B input → draw call done | Fabric A renderAll | Fabric A input → draw call done |
| --- | --- | --- | --- | --- |
| free anchor | 15.0 ms (was 1.9) | 31.3 ms (was 17.7) | 557 ms (was 552) | 574 ms |
| fill boundary | 15.1 ms (was 2.2) | 31.4 ms (was 18.3) | 556 ms (was 546) | 573 ms |

≈ 13 ms per frame for 100 protected fills in B — the cost probe's order (8.8 ms / 100 bounding-box
scratch composites). Earlier numbers in this file time the OLD, wrong paint order.


## Correction: the ≈ 550 ms Fabric renderAll is the anchor dots' default object cache (2026-10-06)

dot (reuse review) pointed out that the anchor dots keep Fabric's default `objectCaching: true` while
every path is uncached. Probe `e2e/dots-cache-probe.spec.ts` (not in the gate): main workload exactly
as above (6,600 objects, 6,000 dots), Fabric A, fitted, 0 onion, DPR 1, synchronous `renderAll` on the
same scene, two runs:

| variant | first render | median of 7 |
| --- | --- | --- |
| dots cached (Fabric default — what every Fabric number above measured) | 568–661 ms | 557–562 ms |
| dots NOT cached | 24–27 ms | 23 ms |
| dots removed | 13–14 ms | 12 ms |

So nearly all of Fabric's ≈ 550 ms was 6,000 tiny per-object cache canvases being composited, not
Fabric drawing as such. Every earlier conclusion of the form "Fabric renderAll dominates" / "B is ~200×
faster than Fabric" compared B against a misconfigured Fabric and is withdrawn. The setting is not
changed in the product yet (dot is reviewing the reuse boundary); comparisons must be redone with the
dots uncached (and with B's own-ink cost included on both sides).


## Re-comparison with the anchor dots uncached (2026-10-06, single run, fitted, DPR 1)

Anchor dots now `objectCaching: false` like every other scene object (fabricView.ts `dot`). Both
paths include the own-ink protection of all 100 fills (S2) and the interleaved paint order (S1).

| onion | drag | Fabric A renderAll | Fabric A input → draw call done | B renderAll | B input → draw call done | full rebuild input → draw done |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | free anchor | 21.8 ms | 39.1 ms | 14.8 ms | 31.3 ms | 136 ms |
| 0 | fill boundary | 21.9 | 39.3 | 14.2 | 30.3 | 136 |
| 19 | free anchor | 43.5 | 66.0 | 23.4 | 43.2 | 368 |
| 19 | fill boundary | 44.4 | 65.9 | 24.0 | 43.8 | 371 |

B is ≈ 1.5–1.9× faster than Fabric A on the draw call — not ≈ 200×; the earlier gap was the dot cache.
Option A (incremental scene) still matters: a full rebuild per move costs ≈ 100–300 ms more (build +
attach). Input → draw call done is not on-screen presentation.

### A2 controlled check (dot): only the dots' caching toggled, same scene (`e2e/dots-cache-a2.spec.ts`)

| | cache canvases | theoretical RGBA size | renderAll median |
| --- | --- | --- | --- |
| dots uncached (now) | 0 | 0 | 21.2 ms |
| dots cached (Fabric default) | 6,000 (256 × 256 each) | 1,500 MiB | 556 ms |

Pixels: 43,680 of 268,800 device pixels differ (max channel delta 255) — ALL within a dot (radius × zoom
+ 2 px), none elsewhere. Zoomed crops: cached handle dots (radius 0.9 ≈ 0.7 px at zoom 0.745) are
fainter / blurred; uncached ones are drawn directly, as B draws them. The size is theoretical (cache
canvas width × height × 4), not measured GPU or resident memory. Picking and dragging do not involve
the dots (not evented; picking is ours); the gate's drag tests pass with the dots uncached.
