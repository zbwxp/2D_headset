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
