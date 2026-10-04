# Local Recording renderer benchmark

This is a bounded developer fixture, not a product feature. It imports the
production Recording evaluator, full-curve onion sampler, `PaintScene`, and
`SceneOnionSkin`. It does not import the editor store, read or write localStorage,
load private project data, or modify the normal Contour app.

## Build and run

Run only when the shared CPU/browser measurement slot is free:

```sh
./node_modules/.bin/tsc -p tests/fixtures/recording-renderer-benchmark.tsconfig.json
node scripts/build-recording-renderer-benchmark.mjs
node scripts/build-recording-renderer-benchmark.mjs --serve
```

Open `http://localhost:5184/recording-renderer-benchmark.html` in
a separate native browser tab. Use its visible controls. Do not use Playwright,
CDP, DevTools, injected page scripts, or hidden browser-state access. Production
React profiling is enabled only for this separate bundle, written under `/tmp`.
The regular app and deployment files are unchanged.

If local navigation is blocked, leave browser security and extensions unchanged.
The same bundle can be included in an already-authorized Contour Site release,
at the release owner's discretion. Build the main app first, then run this from
the isolated baseline worktree with an explicit output directory:

```sh
node scripts/build-recording-renderer-benchmark.mjs --out-dir /absolute/path/to/main-app/dist/diagnostics
```

This writes `dist/diagnostics/recording-renderer-benchmark.html` and its separate
`assets/` directory. All URLs are relative. It never empties a custom output
directory and does not modify the main HTML or application bundle. The route is
`/diagnostics/recording-renderer-benchmark.html`. Creating or publishing a Site
is deliberately outside this script. Its source guard rejects tracked production
changes, so use a detached baseline with only these fixture/script files copied.

1. Show the selected scene and verify the entire face, both eyes and both ears.
2. Run the 0 / 10 / 19 ghost matrix with fills off and 24 measured frames.
3. Select the synthetic live-basis workload and run the matrix again.
4. Optionally enable fills and run the selected 19-ghost case.
5. Use Download JSON. A second complete run can check stability if needed.
6. Optionally check browser GPU APIs. This requests an adapter and reports its
   public info/fallback flag when exposed, plus WebGL2 availability. It creates
   no WebGPU device, shader or compute/render pipeline and changes no flags.
   This describes this browser/device only; availability is not speedup evidence
   and does not measure another computer.

## What the numbers mean

- Geometry is the bundled public `hairless-symmetric-two-face-mirror.json`:
  exactly 121 curves in 13 layers, with six eye/ear layers asserted visible.
  Nine real view snapshots reference this source; they apply synthetic per-layer
  translations `[x / 300, y / 300]` for angles `[-90, 0, 90]²`.
- Every ghost is a complete 121-curve controls product from the same evaluator.
  The shared production ghost renderer batches those into one SVG path per
  frame. Ghost angles run 0–90° at 10° or 5° spacing. Main angles have nonzero Y,
  so the renderer does not remove one as coincident with the current angle.
- The affine view is fixed at 900×650 CSS pixels, 250 pixels/unit. The main
  renderer uses normal picking paths and optional fills; no selection/editor
  overlays are included. Browser DPR and viewport are included in the report.
- Cold workspace allocation, context preparation, first sampling, and fresh
  React mount are separate. These are not cold browser/JIT measurements.
- Four warmup frames precede varied steady samples. Angle mode retains bases;
  live-basis mode creates a new immutable 90° basis with a small translation.
  The latter is a controlled invalidation workload, not an inverse-edit test.
- Combined measures preparation, main display sampling, ghost control sampling,
  and synchronous React display. Evaluation-only performs the same numerical
  requests without rendering. Render-only pre-evaluates the identical sequence,
  then measures the actual renderer over those complete evaluated documents.
  Main lazy drawing and paint products are forced inside main evaluation.
- Profiler subtree durations include React render/path construction. Synchronous
  flush includes that work plus reconciliation/commit/lifecycle overhead. Its
  residual after subtracting render is not a pure DOM-only cost.
- Main/ghost evaluation stage counters, Drawing read counters, curve counts,
  DOM/path counts and total path-string characters are reported independently.
  The object counters are structural work counts, not allocation-byte metrics.
- rAF intervals are callback opportunities. They are not input-to-paint, actual
  raster/compositor timing, dropped frames, or FPS. Foreground visibility is
  required, with a 10-second callback timeout. No GPU timing is claimed.

The useful comparison is how much measured preparation/sampling and display
cost can possibly be removed, while keeping the current material, full-curve
ghost, picking and DOM semantics. A fast hypothetical geometry kernel does not
remove the renderer's path-string, React, or DOM work. This fixture alone cannot
establish an end-to-end GPU speedup or the private project's gesture cost.
