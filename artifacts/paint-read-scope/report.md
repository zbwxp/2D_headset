# Shared PaintScene read scope

## Change and cause

Baseline: isolated `git archive 5069518`. The only production change is wrapping
PaintScene's synchronous preparation in the existing `withDrawingReadScope`.
`useId` remains at the component top level. No new evaluator, math, brush rule,
per-tool cache, permanent immutable opt-in, GPU code, or fixture data change.

The public Recording frame has 121 curves, 135 nodes and 13 layers; 24 curves
are hidden. Evaluation owns a transient read scope that ends before React
invokes PaintScene. PaintScene also creates a separate visibility wrapper.
Neither document has a persistent prepared context. Baseline rendering therefore
recomputes the same 481 stroke keys and 37 local continuation indexes per frame.
The new render scope covers both documents and every synchronous route, stroke,
material, fill, offset, depth and hit preparation. MistInk/MistFill consume the
resulting geometry later; they perform no Drawing read-context work.

The shared topology cache is already bounded and keyed by structural values.
Per-render indexes and visibility are transient. No mutable authoring Drawing
is permanently prepared. A new topology performs 13 actual stroke builds and
one continuation build; subsequent unchanged-topology renders perform neither.

## Equivalent output

All 30 complete SVG strings match baseline byte-for-byte across both process
orders. All 192 measured frames per process also have identical SVG hashes,
lengths and path counts, for 768 measured frames across four processes.
Regression tests retain baseline digests, byte lengths and path counts.

Coverage includes:

- Public Drawing, varying Recording angles, immutable changed bases, fills off
  and ordinary solid fills on
- Cross-layer route ARC, local ARC, interval cuts, taper/extensions, SVG ink mist,
  depth slots, fills, cutouts, offsets, selection, opacity and hit paths
- Both line-scoped and layer-scoped affine, quad and Coons evaluated domains;
  their runtime source, control/material program and opaque serialized metadata
- Same-object in-place coordinates, visibility, node membership, layer/item order,
  link enabled state and interval ranges between renders
- Exception cleanup and a nested synchronous read scope
- Eighty additional visible unrelated curves: 201 curves and 317 paths with
  fills off, versus the 121-curve baseline's 157 paths. Every extra curve still
  paints and has a hit path; changing an added node changes the SVG

## Structural work per steady frame

| Input | Before stroke keys | Before continuation builds | After both |
| --- | ---: | ---: | ---: |
| Public Recording, precomputed paint batches | 481 | 37 | 0 / 0 |
| Mutable Drawing, PaintScene derives batches | 494 | 38 | 0 / 0 |
| Mutable Drawing plus 80 visible curves | 532 | 38 | 0 / 0 |

The replacement work is two transient contexts and two topology signatures per
frame: one for the current Drawing and one for the visibility wrapper. Their
same structural topology is retained. Steady stroke builds, prepared stroke
misses, continuation builds and material dependency builds are zero.

## Node SSR timing

The run order was baseline, candidate, candidate, baseline in separate Vitest
processes. Each case has four warmups and 24 measured varied frames. Values
below are milliseconds, with the two process-order values separated by `/`.
Timing includes synchronous PaintScene preparation, child rendering and SVG HTML
serialization. It is not a browser DOM, raster, FPS or input latency measure.

| Input | Solid fills | Baseline p50 | Candidate p50 |
| --- | --- | ---: | ---: |
| Recording angle | off | 39.08 / 37.87 | 24.40 / 22.45 |
| Recording angle | on | 35.05 / 35.56 | 23.16 / 21.93 |
| Recording basis | off | 38.45 / 33.61 | 21.20 / 22.66 |
| Recording basis | on | 39.20 / 36.10 | 22.24 / 18.43 |
| Mutable Drawing | off | 21.83 / 22.10 | 9.94 / 11.54 |
| Mutable Drawing | on | 23.85 / 20.58 | 9.93 / 9.81 |
| Mutable + 80 curves | off | 37.68 / 32.78 | 21.65 / 19.99 |
| Mutable + 80 curves | on | 33.70 / 32.70 | 21.74 / 19.99 |

Raw per-frame work, timings and hashes are in `measurements.json`. The structured
summary includes source fixture SHA-256 and hashes of the directly compared full
SVG exports. The directly compared complete SVG exports are retained locally;
they contain only public/synthetic fixtures and are not needed to reproduce the
committed regression checks.

## Verification and remaining browser gate

At candidate `0ea573e`, the core 39-file manifest plus four relevant Drawing
renderer/read-context test files produced 409 passes and five skips in one
43-file aggregate run. New focused coverage contains eight tests. The release
verifier then set `CONTOUR_MINCHANGE_PRIVATE_FIXTURE` and ran the original five
skipped cases separately on that same candidate; all five passed. This is
**414 unique passing tests across the aggregate and separate private-fixture
runs**, not a single 43-file run with 414 passes. `test-manifest.json` names the
43 aggregate files; `test.log` accurately retains that run's 409-pass/five-skip
result.

The normal production build, standalone benchmark TypeScript check and
revision-labelled bundle bootstrap smoke guard passed. Bootstrap validation is
separate from actual browser rendering.

These are the five cases that initially skipped because
`CONTOUR_MINCHANGE_PRIVATE_FIXTURE` was unset, then passed in the separate run:

- `replays the supplied private ear X target without altering its file`
- `replays the supplied private ear Y target without altering its file`
- `replays the supplied private profile X target without altering its file`
- `replays the supplied private profile Y target without altering its file`
- `private 124 fallback samples 718 scalars exactly twice and preserves its frozen source`

An additional bounded local check of the original private 124 file at
0, -60 and -90 degrees produced identical complete fills-off SVG strings before
and after. The original file SHA-256 and frozen parsed project were unchanged.
Private source and SVG content are not included in these committed artifacts.

Node has no Canvas/Path2D. Public fills-on cases explicitly disable only fill
mist on a wrapper, leaving the original public fixture unchanged; those cases
have 177 paths. This is solid-fill parity, not fill-mist bitmap validation. SVG
ink mist is included. Native browser testing is still required for actual fill
mist (the existing browser fixture has 179 main paths with fills on), DOM commit,
raster behavior and a browser speed comparison. No browser speedup is claimed by
these Node results. Candidate `0ea573e` is deployed as v91, with the 21-pass
native browser comparison in progress at this documentation update.

The v91 public diagnostics matrix does not replace main-app manual A/V and
line/layer-domain Save/Undo interaction acceptance for this revision. Earlier
v87/v88 manual acceptance remains evidence for those releases and their tested
flows. The bounded private-file SSR comparison above establishes rendering
parity only, not end-to-end interaction latency.

## Reproduction

The harness is `profile.test.ts.txt`. Copy it to `src/paint-read-scope-profile.test.ts`
in the checkout being measured and run:

```sh
PAINT_READ_OUTPUT=/absolute/output/prefix ./node_modules/.bin/vitest run src/paint-read-scope-profile.test.ts
```

It writes `<prefix>.json` and `<prefix>-svg.json`; remove the temporary source
file afterward. The baseline was a separate archive of `5069518`, with only
this harness and `src/tests/fixtures/paint-read-scope.ts` copied into it. Its
production renderer was never edited. Run sequentially on a free CPU slot.
The normal regression is `src/tests/drawing-paint-read-scope.test.ts`.
