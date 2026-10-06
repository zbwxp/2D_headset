# Drawing-path cost inventory (2026-10-06, after 53d9fc0)

Source: `e2e/drawing-costs.spec.ts` (not in the gate — slow by design). One Playwright Chromium run on
bowen's Mac (Apple M4); synthetic workload (`?bench&curves=N&onion=K`: N open curves + 15 loop
curves/fills, 8 layers, connections, one pose per curve); A-mode drag of one free anchor; 6 measured
moves after one warm-up move; each move waits two animation frames. **Per-move averages; one run —
informational, not a benchmark, not a cross-machine claim.**

| curves | onion yaws | plan | preview changes | assemble lists | container scan | build objects | attach (remove + add) | renderAll (per render) | renders / move | Fabric objects | path strings / move | whole-table rows scanned / move |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 121 | 0 | 0.08 ms | 0.10 ms | 0.02 ms | 0.07 ms | 11.5 ms | 12.5 ms | 156 ms | 2 | 1,783 | 151 | 408 |
| 121 | 19 | 0.07 | 0.08 | 0.72 | 0.08 | 37.4 | 34.2 | 170 | 2 | 4,367 | 2,735 | 408 |
| 1000 | 0 | 0.10 | 0.05 | 0.05 | 0.22 | 85.9 | 140.0 | 178 | 2 | 13,210 | 1,030 | 3,045 |
| 1000 | 19 | 0.10 | 0.07 | 4.62 | 0.25 | 280.2 | 539.1 | 207 | 2 | 32,495 | 20,315 | 3,045 |
| 3000 | 0 | 0.07 | 0.05 | 0.18 | 0.62 | 259.7 | 734.2 | 207 | 2 | 39,210 | 3,030 | 9,045 |
| 3000 | 19 | — | — | — | — | — | — | — | — | — | — | — (did not finish the initial load within 300 s) |

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
6. **renderAll** repaints every object (≈ 156–207 ms per render in this run), and each move produced two
   renders.

Evaluation (plan + preview changes + list assembly) is ≤ 5 ms in every completed case; it is not where
the time goes. These numbers do not decide the drawing approach by themselves (dot: replacing the
renderer is not a given) — see the comparison proposed in OPEN.md.
