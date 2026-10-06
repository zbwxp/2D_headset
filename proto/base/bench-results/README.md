# Onion-skin benchmark (2026-10-07; re-run after d533b08, results within noise of the first run)

Machine: Apple M4 (10 cores), macOS, Playwright headless Chromium 140.
Workload: 121 synthetic open curves (3 segments each), 8 layers, chained connections, 15 closed-loop fills.
The edit is a single handle or anchor. The onion yaws run from −90° to 90° in 10° steps.
The numbers are **absolute only**. This is not the old 121-curve face, so it must not be compared with the old report (15 §5).

## Scope A: the old report's scope ("target construction + synchronous display"), p50 / p95, ms, n=48

| onion | compute (plan + evaluate + onion evaluate) | path objects (SVG string → Fabric Path) | draw (Fabric renderAll) | total |
| --- | --- | --- | --- | --- |
| 0 | 0.6 / 0.8 | 1.4 / 1.6 | 1.1 / 2.3 | 3.0 / 4.5 |
| 19 | 3.8 / 6.1 | 30.7 / 33.2 | 25.1 / 31.8 | 60.6 / 69.2 |

Not included: input dispatch, the committing transaction, inverse solving, or compositing beyond Fabric's renderAll.

## Scope B: pointermove → first animation frame after our render, during a real A-mode drag, ms, n=40

| onion | p50 | p95 |
| --- | --- | --- |
| 0 | 156.5 | 173.1 |
| 19 | 221.7 | 238.8 |

Caveat: Playwright sends moves without waiting for frames, so these numbers may include time spent queued behind earlier moves.

## Breakdown of one FabricView preview frame (median of 24, ms; `e2e/breakdown.spec.ts`)

| onion | Fabric objects | preview (plan) | throwaway store | evaluate | rebuild Fabric scene | Fabric renderAll |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 1783 | 0.1 | 0.4 | 0.6 | 19.0 | 130.9 |
| 19 | 4367 | 0.2 | 0.4 | 0.7 | 98.1 | 153.5 |

## What these numbers support (and what they don't)

- In this slice, our document, command planning and evaluation cost **about 1–4 ms** even with 19 onion yaws. The time goes to **building and drawing thousands of Fabric objects**. The 1452 anchor/handle dots at onion 0 are part of that.
- So, for this workload, moving the computation to WASM would not address the bottleneck. Scene construction and drawing would have to change. Options (none tested yet):
  - Draw the document and onion skins with our own Canvas2D renderer, one `Path2D` per layer, and cache onion layers as bitmaps.
  - Keep Fabric only for interaction widgets: the V transform box and selection.
  - Update only changed objects instead of re-projecting everything on every move.
- These numbers say nothing about the real face with real recording, nor about other machines.

## Re-run after the correctness fixes (d533b08)

| scope | onion 0 | onion 19 |
| --- | --- | --- |
| A total p50 / p95 | 3.0 / 4.3 | 59.9 / 63.7 |
| A compute / paths / draw p50 | 0.6 / 1.4 / 1.1 | 3.6 / 30.5 / 24.9 |
| B p50 / p95 | 156.3 / 169.5 | 222.8 / 236.6 |
| breakdown: rebuild scene / renderAll | 18.6 / 132.3 | 84.1 / 144.9 |

Commands: `npx playwright test e2e/bench.spec.ts e2e/breakdown.spec.ts --workers=1`.
