# Frozen cage gesture addresses

Audit stage 3, based on `5027930`.

The existing Drawing control dependency index now also supplies layer ownership
and links by curve. A runtime domain plan resolves layer or continuous-stroke
membership once for a frozen Drawing frame and scope, and checks only the
selected members' endpoint incidence. Persistent cage targets reuse that plan
for their ownership guard. Temporary cage targets pass it to the existing
canonical Drawing operation.

The plan does not persist resolved membership. Source additions, split/deletion,
lock changes and layer ownership changes still resolve through a new immutable
evaluation frame. Different layer IDs or stroke provenance produce a different
scope. A foreign frame, changed scope or copied plan has no proof and uses the
canonical live resolver. The plan API, like the existing control plan API, is
only for caller-owned immutable frames; ordinary mutable Drawing calls do not
automatically opt into it.

Fitting, geometry, material transport, exact target capture, replay validation,
source ownership checks and full workspace validation are unchanged. Full-layer
operations continue to include every actual curve, including hidden members.
Only empty write containers avoid an array copy: handle-only writes retain the
node array, and node-only writes retain the curve array.

## Structural evidence

An instrumented run of the original implementation used one selected curve,
1,000 unrelated curves, 2,002 nodes, and three targets from one frozen frame:

| Work | Original | Updated |
| --- | ---: | ---: |
| Persistent scope resolutions | 3 | 1 |
| Persistent node × curve membership checks | 6,012,006 | 0 |
| Selected endpoint incidence visits | Not indexed | 2 total |
| Temporary apply scope re-resolutions after plan preparation | 3 | 0 |
| Handle-only merged target node-array slots copied | 2,002 per target | 0 |

The updated path builds one shared dependency index per frame. That initial
index remains linear in the document size; the canonical edit and its fitting
still process their necessary geometry. These counters are not a wall-time or
browser-frame-rate claim.

`layer-domain-edit-plan.test.ts` checks the counts with 0, 100 and 1,000 unrelated
curves, layer/line affine, quadrilateral and Coons output parity, actual hidden
members, connected/disconnected additions, membership and provenance changes,
locks, shared-node/link guards and unknown-plan fallback. The existing source
split, replay and Undo tests cover persistent live-scope semantics.

Focused validation: 120 of 121 tests passed in 11 files. The sole failure is an
existing singular-axis error-message assertion in
`drawing-layer-domain-intent.test.ts:192`: the operation rejects with
“its local placement cannot reach this control target while the collapsed input
is retained”, while the test expects “Restore or disable”. Restoring the touched
implementation files to `5027930` reproduces the same failure. This change does
not alter that behavior or its test.

`npx tsc --noEmit` and `git diff --check` pass. No production build, browser
run or deployment is part of this stage.

## Serialized CPU measurement

Baseline `5027930` and candidate `0aec4ed` ran sequentially in one reserved CPU
window. Each cell uses one selected curve, 1,000 unrelated curves, three different
cage parameter targets, one warm-up batch and seven measured batches. Each entry
is the median / maximum batch duration in milliseconds; the maximum is an
observed sample, not an estimated percentile.

| Scope / field | Address preparation + 3 guards, before → after | Persistent adapter 3 targets, before → after | Temporary Drawing preparation + 3 targets, before → after |
| --- | --- | --- | --- |
| Line / quad | 88.14 / 103.08 → 1.75 / 3.75 | 286.97 / 314.86 → 113.26 / 142.70 | 43.16 / 51.13 → 39.57 / 48.22 |
| Line / Coons | 88.33 / 89.02 → 1.54 / 1.70 | 240.91 / 322.28 → 113.58 / 114.96 | 41.28 / 43.05 → 41.27 / 50.79 |
| Layer / quad | 86.86 / 91.08 → 1.44 / 1.70 | 253.66 / 284.12 → 105.00 / 124.37 | 39.40 / 41.15 → 40.72 / 43.53 |
| Layer / Coons | 87.00 / 95.04 → 1.57 / 3.86 | 255.08 / 326.58 → 112.56 / 122.18 | 41.53 / 48.11 → 43.38 / 51.48 |

The isolated address baseline copies the original guard exactly. The persistent
measurement calls the actual baseline/candidate
`prepareRecordingLayerDomainWorkspace`, including candidate evaluation and
canonical fitting, after preparing the frozen input evaluation. It does not
include the outer transaction parser, store commit or browser rendering.
The temporary measurement includes control-plan preparation and canonical
Drawing authoring/fitting, but excludes the inverse Recording transaction.

The persistent adapter improves in this synthetic CPU case. Temporary authoring
shows no consistent total improvement despite removing repeated membership
discovery; its remaining canonical work still dominates. No overall editor,
real-scene or browser frame-rate conclusion follows from these measurements.
Both measurement runs completed without target errors; exact geometry/replay and
source-topology correctness are established by the focused regressions above.
