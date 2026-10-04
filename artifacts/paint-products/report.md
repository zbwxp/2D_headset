# Shared world-coordinate paint products

## Result and boundary

The shared Drawing/Recording PaintScene now prepares and reuses world-coordinate
stroke, member, route, fill and offset products. It continues to call the same
canonical geometry/material functions. Screen path formatting, pixel rounding,
React structure, selection, opacity and event handlers still run from current
props; none are cached in these products. No GPU or geometry algorithm changed.

The existing native path material signature was extracted unchanged from
`endpointPairMaterial.ts` into
[`pathMaterialSignature.ts`](../../src/domain/drawing/pathMaterialSignature.ts).
The original endpoint consumer still uses that same signature. The new
[`paintProducts.ts`](../../src/ui/drawing/paintProducts.ts) reader extends it with
paint dependencies and a bounded 128-entry value cache. It does not identify
mutable geometry by Drawing object identity or fabricate an evaluator dirty
proof. The measured one-handle input is produced by the existing common edit
plan and its opaque proof; all 32 product signatures are still checked.

Each synchronous reader resolves ordered route ownership once. Within the reader,
all consumers of a path share its product. Native cross-frame keys include:

- Complete path geometry and its existing curve/node/join/link dependency closure
- Structural identity token, including outside-path shared-node incidence
- Current interval/range data and WeakMap-only interval pinches
- Actual ordered route resolutions and diagnostics, guarding precedence changes
  caused by selected port geometry outside a local path
- Current curve width/profile/end brushes, mist, visibility and ink visibility
- Relevant depth positions, sampling quality, fill boundary and offset parameters

A retained affine/Coons program in the authoritative input conservatively keeps
the entire reader on its original canonical input and cache lifetime. No fitted
control JSON is treated as the source/program identity. Opaque oversized ARC
brush permission, custom projection callbacks, missing dependency proof, and an
actual borrowed route with different members also disable cross-frame reuse.
These cases keep their existing editable canonical path. Numeric products never
enter the persistent structural topology plan.

Native mutable authoring uses a fresh shallow read facade, preserving node-keyed
metadata and preventing old document-identity ARC/offset caches from returning
obsolete geometry. Retained-domain inputs keep their original identity. Existing
line/layer affine, quad and Coons tests explicitly check that a repeated/zoomed
reader retains that input and returns the same canonical cached offset result.

## Ownership and copy cost

Native `inkRuns` already copies source control points before constructing cached
shapes, outlines, tips and fragments. These numeric trees are reused read-only.
The product reader copies only data that can still alias authoring input: derived
piece points (with `copyCurveSource`), endpoint styles, mist objects and outer
extension cubics. Member-body fragment arrays remain shared with the detached
ink cache. This avoids copying an already detached outline a second time.

An isolated instrumented copy comparison used the same five short workloads;
production has no copy timers. For 32 changed products per frame, whole-tree
copying cost 1.31 ms in ordinary angle and 1.91 ms with 19 onions. The final
ownership-based copy costs were 0.25 and 0.22 ms. A single changed product cost
0.058 versus 0.008 ms. SVG hashes matched. Raw attribution is in
`copy-attribution.json`. No cache-admission heuristic or tool/angle-specific
algorithm was introduced.

## Correctness and the mutable reference distinction

The candidate matches all **74 independent previous-kernel cold-canonical SVG
references**, including complete bytes/lengths/path counts. Cases cover:

- Public 121-curve Drawing and Recording, unchanged and changed bases/angles
- Three camera/scale values, selection, opacity, preview, current hit modes
- Both line/layer scopes for affine, quad and Coons
- Local and routed ARC, width/profile/taper/extension/mist, visibility, depth,
  intervals/pinches, fills/cutouts and offsets
- A formerly invalid earlier route becoming valid
- Equal ARC brush JSON with different opaque evaluated permissions
- In-place edits, detached-product rollback, and a local branch borrowing an
  equal-length route containing a different curve

The baseline is an isolated archive of `a61e1d9`, whose production renderer is
`0ea573e`. For each case it renders both its original document and a fresh shallow
facade with the same current content. **19 of the 74 sequence steps have different
old warm-document and cold-canonical results**, because the old ARC/offset
WeakMaps retained geometry after in-place edits. These are affected sequence
steps, not 19 independent bugs. The candidate follows the independent old
kernel's cold-canonical result for all 74 cases and is itself warm/cold consistent.

This is deliberately not described as byte parity with those 19 obsolete warm
outputs. Their old/new hashes remain in `parity.json` and
`paint-products-baseline.json`; the original `paint-read-scope-baseline.json` is
unchanged. Only the existing mutable-sequence assertions now use the independently
generated cold reference. Ordinary public frames and the existing immutable
domain cases retain their prior byte expectations. No ARC/offset math changed.

## Actual work

For the complete public face, after warmup:

| Input | Product signatures | Product hits | Canonical product builds |
| --- | ---: | ---: | ---: |
| Fixed input | 32 | 32 | 0 |
| One proved changed curve/handle | 32 | 31 | 1 |
| Changing ordinary angle | 32 | 0 | 32 |
| Changing angle plus 19 full-curve onions | 32 | 0 | 32 |
| Fixed styled fill/offset fixture | 5 | 5 | 0 |

The public frame still has 157 main paths. Nineteen ghosts retain all their
full-curve geometry. Route ownership is resolved once per reader; 13 additional
owner reads reuse an already prepared path product. Fixed styled fill/offset
build counts are both zero, so the native shallow facade does not force their
canonical fitting to repeat. Unsupported-domain product requests are distinct
from actual canonical cache misses; those requests preserve original input
identity and its prior ARC/offset caches.

## Paired Node SSR measurement

Final process order: baseline, candidate, candidate, baseline. Each case has four
warmups and eight measured frames in each process, pooled to 16 samples per side.
All paired frame hashes, lengths and path counts match. Evaluation and target
preparation occur outside timing. Times include SVG preparation, React and Node
HTML serialization; they are not browser commit, raster or input latency.

| Case | Baseline p50 / p95 ms | Candidate p50 / p95 ms |
| --- | ---: | ---: |
| Fixed input | 18.23 / 20.57 | 11.69 / 12.65 |
| One changed handle | 15.08 / 19.01 | 11.07 / 14.88 |
| Ordinary angle | 18.77 / 22.69 | 18.90 / 26.11 |
| Angle + 19 onions | 21.82 / 32.16 | 21.85 / 27.76 |
| Fixed solid fills + offset | 2.00 / 2.59 | 1.22 / 6.73 |

Fixed and local-change medians improve. Complete changing-angle/onion medians
are effectively unchanged in this small Node sample; the angle and styled-fixture
tails include worse candidate observations. Do not claim broad angle speedup,
improved tail latency or a browser speedup from this result. Native browser
comparison remains the release owner's separate gate. Raw samples, counters,
paired hashes and both process orders are in `benchmark.json`.

## Verification and reproduction

The 44-file aggregate passes **419/419 in one run**, with the private fixture
environment enabled, so the original five private-gated cases run and pass.
`test-manifest.json` and `test.log` contain the exact run. The normal production
build and standalone benchmark TypeScript check also pass. No private source,
raw private geometry or private SVG is committed.

`parity.test.ts.txt` and `benchmark.test.ts.txt` are bounded reproduction harnesses.
Copy each to its named temporary `src/*.test.ts` location in the checkout being
measured and set `PAINT_PRODUCT_OUTPUT` to a local output prefix. The benchmark's
`PRODUCT_IMPORT` / `PRODUCT_STATS` placeholders use `paintProductStats` only for
the candidate; the unchanged baseline leaves the product counters empty. Remove
the temporary files after running. The permanent renderer regressions are
[`drawing-paint-products.test.ts`](../../src/tests/drawing-paint-products.test.ts)
and [`drawing-paint-read-scope.test.ts`](../../src/tests/drawing-paint-read-scope.test.ts).

Node fill cases explicitly cover solid fill geometry and SVG ink mist; Canvas
fill-mist bitmap rendering still needs the native browser. Existing v87/v88
manual acceptance remains historical evidence for its tested flows. This new
candidate's diagnostic/SSR checks do not replace main-app A/V, domain and
Save/Undo manual acceptance or establish end-to-end interaction latency.
