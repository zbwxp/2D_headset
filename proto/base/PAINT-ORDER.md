# Paint-order contract (v0.2 draft, for dot's review)

The ONE place for paint-order rules of the base. Doc 11 §2–§3 and doc 03 RC-16 (headset-design) state
the product requirements; this file turns them into expected pictures and tests, and records the
compositing design. OPEN.md and bench-results point here instead of restating rules.

## 0. How to read it

- **Requirement** — fixed by bowen (doc 11 / RC-16). Not re-asked.
- **明确** — expected result follows from a requirement. Tested independently: a small picture whose
  expected colour at named points is written down in advance (`src/paintCases.ts`), checked in Fabric
  (A) and in B (`e2e/paint-order.spec.ts`, in the gate); the evaluation's own paint list is checked too
  once the core produces one (today it returns separate curve and fill lists). A is never compared with B as the proof. A counterexample in today's code is
  recorded as a known failure until fixed.
- **Proposal** — our (Claude + dot) design for a technical gap, with counterexamples. Not a user
  choice. No test and no known failure until dot and Claude agree; then it becomes 明确.
- **Comparison** — the pre-refactor baseline is the fixed commit "v103" (zbwxp/2D_headset
  `720538184a810fc7a1c53ec5dbf497ad1b3ad8ba`, branch codex/recording-snapshot-v2-20261002), read
  only with `git show <sha>:<path>`; NOT the local main workspace (V0.16 `40978ba` is an older
  ancestor). Existing methods there are evidence, not the new spec. Its createFill same-layer limit is
  an entry-point limit, not a global rule (doc 11 allows cross-layer boundaries).

## 1. Requirements (doc 11 §2–§3, RC-16)

R1. Children of a parent are ordered (fractional indexes); later is painted on top. Same rule at every
    level of nesting.
R2. By default the layer order and the order inside the layer decide what covers what.
R3. Lines AND fills have a depth offset that can move them across layers.
R4. A fill never covers the strokes of its own boundary (bowen: to an artist a fill sits tight against
    its lines; it is stored on the line's centre line only for simplicity, so the stroke looks like it
    covers the fill's edge. Offsets exist to cover OTHER lines — e.g. near 90° the side-face patch is
    brought forward to cover the side-face edge lines — never the fill's own outline). A fill and its
    own outline are NOT a pair the user orders against each other: to remove an outline, hide the line
    or use a display interval; the offset handles layering against everything else (dot). The own-
    boundary relation is part of the compositing rule, not of the ordering; "what if the fill is
    dragged in front of its own outline" is not a creative need to support, and no ordering option or
    conflict handling exists for it. Storage stays on the centre line; every other object covers / is covered by it
    normally. R4 is NOT "the boundary is always visible": a display interval can still hide
    the stroke and objects in front still cover it; only its own fill must not eat it (dot).
R5. Global contradictions can be detected; local interleaving must not be mistaken for one (RC-16).
R6. Shown = own flag AND every ancestor shown (doc 11 §3 显示).
R7. A fill's boundary may reference segments of other layers (doc 11 §2, fill row).
R8. Containers have an opacity (doc 11 §2, container row).

Today's code: onion yaws → ALL fills → ALL curves → anchor dots (A and B); depthOffset only breaks
ties; the order key uses the direct parent only; fractional indexes compared with `localeCompare`;
container opacity ignored.

## 2. 明确 — tests to write now

Colours: red fill `rgb(255,0,0)`, blue line `rgb(0,0,255)`, both opaque unless stated; "overlap" =
a named point inside both.

**P1 — order inside one parent (R1).** Layer L holds red fill F and blue curve C crossing F. **C is NOT
part of F's boundary** (F's boundary is a separate closed curve B drawn in grey). Order [C, F] → red at
the overlap; order [F, C] → blue. Today: blue in both → known failure.

**P2 — layer order (R2).** Layers back → front: L1 = [blue C], L2 = [red F over C's middle], C not F's
boundary. Red at the overlap; layers swapped → blue. Today: blue in both → known failure (dot
reproduced it in the 0264deb review).

**P3 — nested containers (R1).** Two lines, so today's fill / line split plays no part. Top level: L1
(`a0`) behind L2 (`a1`). L1 = [group G (`a5`) = [red line R]], L2 = [blue line C (`a0`)] crossing R.
Blue at the crossing. Today: the key "direct parent index / own index" puts R (`a5/…`) in front → red
→ known failure.

**P4 — fractional index comparison (R1).** Siblings red line R (`a0B`) and blue line C (`a0a`) crossing.
By character code `a0B` < `a0a` → C in front → blue. Today: `localeCompare` puts `a0B` later → red →
known failure.

**P6 — own boundary strokes stay visible (R4).** Red F bounded by its own opaque blue curve B, F ends up
later than B (as when an offset brings a fill forward over other lines, bowen's side-face case). At (40, 11) — on B's stroke, 1 unit inside F — blue; at the centre red. Today: passes only
because all curves are painted after all fills. (The expected picture for a semi-transparent own
stroke is NOT fixed here: it depends on D2, counterexample 1.)

**P7 — other objects cover a fill normally (R4).** F in L2; unrelated blue curve U in L3 → blue at the
overlap; unrelated blue curve V in L1 → red at the overlap (F covers V). Guards against "lines always
on top". Today: V painted over F → known failure.

**P10 — inherited visibility (R6).** L (hidden) = [G (shown) = [B, F], C (shown)] → transparent at the
sample points. Control case with L shown → F and C painted there (so P10 cannot pass by painting
nothing). Today: passes.

**Results today (A and B identical):** P1 fill-after-line, P2 fill-layer-in-front, P3, P4, P7 fail as
predicted (known failures, listed by the gate); P1 line-after-fill, P2 line-layer-in-front, P6, P10
and its control pass.

## 3. Proposals (Claude → dot)

**D1 — depth offset base and unit (R3).** Candidate = v103 `src/domain/drawing/depth.ts` (read): one
mechanism for curves AND fills; an integer counted in structural sibling slots; the reference
(`depthScope`) is PARENT or LAYER per object; positive = forward; clamped at the ends; never follows
another object's offset → no cycles; ties keep the stable list order. Worked example, layers
back → front L1 = [collar K], L2 = [neck], L3 = [group G = [eye-white fill F, eye line E], jaw J]:
K +1 (LAYER) → in front of all of L2, behind L3; K +5 → clamped, in front of all of L3. bowen's use
case: the side-face patch fill with a LAYER offset in front of the side-face edge lines.

**D2 — compositing for R4 (C1, agreed direction; = v103 `docs/architecture/owned-fill-compositing.md`,
read).** Every object paints once at its own position in the order; a fill does not paint inside the
visible ink area of its own boundary strokes that are BEHIND it. No repaint of the stroke, no lifting
of the stroke or layer, offsets are not rewritten; objects in front still cover. v103 details to keep
as evidence: the protected area is the stroke's actual visible ink (display intervals, tapers, caps
and joins included; hidden or zero-visibility parts protect nothing and a hidden line is never
revived); stroke alpha is not multiplied again; the same clip is used for fill painting and fill hit
testing; blurred / noise-displaced stroke edges and self-intersecting ink outlines are not protected
exactly and produce a diagnostic instead of a silent workaround; nominal vector protection, not
byte-identical anti-aliasing.

Expected pictures for the two hard cases (background: opaque grey backdrop `rgb(128,128,128)` in the
back layer; F red `rgb(255,0,0)`):
1. Own boundary B = 50 % blue `rgba(0,0,255,0.5)`, behind F. At a point of B's ink inside F: blue
   over the BACKDROP once = `rgb(64,64,192)` — natural result of "F leaves out B's ink". With F
   BEHIND B (the usual order) the same point is blue over red = `rgb(128,0,128)`. A violation would
   be `rgb(255,0,0)` (F ate B) or anything darker than one blue layer (B painted twice).
   bowen (2026-10-06), in his words: lines mostly change colour / grey rather than transparency
   (fills may be semi-transparent); for pencil-like see-through strokes "decide by the centre line" —
   such strokes do not emphasise their edge. This does NOT say see-through strokes never occur, and
   bowen has NOT confirmed exact mixed colours for every offset case (dot).
   Decision (dot + Claude): C1 as the minimal implementation for opaque line art; see-through own
   strokes are a recorded simplification (C1 may show what is behind the fill under the inner half
   of such a stroke when the fill is in front); no extra mechanism (no fill splitting, no
   "leave out whatever the order"). No test for the see-through case.
2. An unrelated opaque green object X with B < X < F (B opaque blue). On B's ink inside F: where X
   covers it → green (X is in front of B by order, and F leaves the area out) — natural result; where
   X does not → blue. A violation would be red there (F ate B) or blue where X should cover.

**D3 — geometry reference vs stroke ownership (R7).** A fill's boundary is a list of segment references
(geometry); they may live in any layer. "Own strokes" of a fill = the stroke ink of exactly those
referenced segment pieces, wherever their curves live; the stroke still belongs to its curve and is
painted at the curve's position. One segment shared by two fills in different layers: each fill leaves
out that ink (C1) independently → no ordering constraint between the two fills, no new conflicts.

**D4 — global contradictions (R5), limited inference (dot agreed).** If offsets are computed
deterministically, follow no other offset (no cyclic dependency) and ties use a stable rule, the
result is a total order; with C1, R4 adds no ordering constraint. This does NOT cover local
interleaving, which stays out of scope (D5).

**D5 — local interleaving (RC-16 待定).** Out of scope for this contract version.

**D6 — references (candidate boundary for this round, dot agreed).** A reference's content is painted at
the reference's own position in its parent; the source's internal order is kept; offsets inside the
source resolve within the instance and cannot leave it. The instance as a whole is ordered (and can be
offset) in the outer document.

**D7 — container opacity (R8).** Two kinds of container, kept distinct (dot): an ordinary organising
container, and an explicitly isolated compositing group. An isolated group is painted as one image;
outside objects cannot be interleaved inside it. How an ordinary container's opacity applies to its
members is defined separately. The kind never switches automatically (100 % → 99 % must not change
grouping rules). Withdrawn: "members offset out of the group get the opacity multiplied in, the rest
is composited" (the group's opacity meaning would change as members move). v103 has no container
opacity (checked), so there is no baseline to follow. Which kind the minimal prototype supports
first: to agree; until then container opacity stays unimplemented and listed in OPEN.md.

**E1 — editor overlays** (onion yaws, anchor dots, selection): editor display convention, not a
product rule. Today: onion under everything, dots over everything. Kept as is, stated here.

## 4. Implementation design (draft for dot, before code)

Scope agreed (dot, after bowen's answer): opaque line art first — correct normal order, own-outline
protection (C1) and occlusion of / by other objects. See-through own strokes are not a driver;
"every fill leaves out its full stroke area" is NOT a general rule. Depth offsets (D1) and container
opacity (D7) are NOT in these steps.

**S1 — one paint list in the evaluation core; renderers only read it.**
- `Derived` gets a `paint` computed: the visible curves, fills and reference instances interleaved in
  one list (`{ kind, item }[]`). `evaluateSaved` (runtime) and the reference `evaluate` return the
  same list.
- Order key = the whole container path from the root (each level's fractional index), then the
  object's own index; strings compared by code unit (`<`), not `localeCompare`. Ties: address (stable).
- Reference instances (D6): key = the reference's own path, then the source-relative path of the
  source item, so the source's internal order is kept and nothing leaves the instance.
- `depthOffset`: not interpreted in S1 (today it only breaks ties, which has no meaning under D1);
  listed in OPEN.md as unimplemented until D1 is agreed.
- Recomputed only when parent / index / visibility / membership change (it reads those fields, not
  geometry), so a drag preview reuses it; counted (`paintOrderBuilds`).
- FabricView (A): `want` = onion yaws → `paint` → anchor dots (E1); same incremental keys as today.
  B draws the same list in the same order.
- Tests: P1–P4, P7 must leave the known-failure list (Playwright reports if they don't); unit test of
  the paint list itself for every case in `src/paintCases.ts` (the third check the contract asks for);
  property: the list is a permutation of the visible items, consistent with the tree order pairwise.
- New case added in S1, expected to FAIL until S2 and listed as a known failure: **P6-cross-layer** —
  F's own boundary B (opaque blue) in back layer L1, F in front layer L2 (R7): at (40, 11) blue.
  (Today it passes only because fills are always under curves; S1 alone breaks it.)

**S2 — C1: a fill leaves out the visible ink of its own boundary strokes that are behind it.**
- Core: each `EvalFill` gets `ownInk`: the boundary pieces whose curve is visible and earlier in
  `paint` than the fill, with each piece's ink outline in world units: `bezier-js` `outline(w/2)` per
  segment (butt ends) plus a disk of radius w/2 at interior joints (covers round / most miter joins;
  sharp miter tips are a stated limit). Cached per curve item (geometry + width); a drag of a boundary
  curve recomputes only that curve's outlines.
- Renderers: B — `ctx.clip(rect + piece, 'evenodd')` once per piece (successive clips intersect, i.e.
  the complement of the union, the same "intersected inverse clips" as v103), then fill. A — Fabric
  `clipPath` = Group of the piece outlines with `inverted: true, absolutePositioned: true`. A fill with
  no `ownInk` paints exactly as today (no clip).
- Hit testing uses the same exclusion (v103: fill painting and fill hit share one clip).
- Limits (stated, with a diagnostic): self-intersecting outline pieces, blurred / textured stroke
  edges (none exist yet).
- Tests: P6-cross-layer passes; D2 example 2 becomes a 明确 case (B < X < F: green where X covers B's
  ink inside F, blue where it does not, red at the centre); P6 / P7 unchanged.

**S3 — measure.** Main workload (500 curves, 100 fills, 6,000 dots), A and B: the cost of the paint
list (structural edits only) and of the clips (Fabric clipPath may force object caching — measured,
not assumed). Then D1 offsets, then D7 container opacity, each after agreement.

One step per commit, gate before each.
