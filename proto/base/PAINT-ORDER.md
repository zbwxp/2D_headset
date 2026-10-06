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
R9. Lines are opaque: no transparency option for lines; fills may have opacity (bowen 2026-10-06:
    "线条默认是不透明的/没有透明选项。填充才可以有透明度" — an inking pen does not darken where its
    strokes overlap; take the simplest, smallest implementation; see-through lines are an exception to
    consider only if a real need appears). Also bowen: if reused mature code brings its own opacity,
    keep its standard behaviour (e.g. SVG `stroke-opacity`, group opacity) — no custom see-through
    stroke rules.

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

**Results after S1 (A and B identical):** P1–P4, P7, P10 (+ control) pass in A and B, and the paint list
itself passes `test/paint-order.test.ts` (case pairs + a 300-run property over random trees with
nesting, mixed-case and prefix indexes and references, checked against an element-wise path oracle;
mutations caught: `localeCompare`, a separator above the index alphabet, direct-parent-only keys,
fills-before-curves, the order reading geometry). P6-own-boundary and P6-cross-layer are known
failures until S2: with fills interleaved, a fill painted after its own boundary now covers it (P6
passed before only because all curves were painted after all fills).

## 3. Proposals (Claude → dot)

**D1 — depth offset base and unit (R3).** Candidate = v103 `src/domain/drawing/depth.ts` (read): one
mechanism for curves AND fills; an integer counted in structural sibling slots; the reference
(`depthScope`) is PARENT or LAYER per object; positive = forward; clamped at the ends; never follows
another object's offset → no cycles; ties keep the stable list order. Worked example, layers
back → front L1 = [collar K], L2 = [neck], L3 = [group G = [eye-white fill F, eye line E], jaw J]:
K +1 (LAYER) → in front of all of L2, behind L3; K +5 → clamped, in front of all of L3. bowen's use
case: the side-face patch fill with a LAYER offset in front of the side-face edge lines.

D1 second reference (read, docs.live2d.com/en/cubism-editor-manual/draworder/): Live2D gives every
drawable an ABSOLUTE draw order 0–1000 (higher in front; equal values → Parts palette order), which
can be keyed to parameters like shapes; "Draw Order Group" scopes it per part. Candidates to compare:
absolute value + group scope + parameter-driven (Live2D) vs relative sibling-slot offset (v103).

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

**D5 — local interleaving (RC-16 待定).** Out of scope for this contract version. Mature reference
(read): Illustrator "Intertwine" — overlapping objects form an Intertwine group; clicking or encircling
an overlap area chooses which object is on top there; non-destructive (Edit / Release)
(helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/create-intertwined-objects.html).
bowen's case: a closed curve "wrapping" another layer (a collar in front of / behind the neck).

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
Current SCOPE LIMIT (not a product decision — container opacity and stroke opacity are different
needs, and bowen did not cancel container opacity, dot): the current base does not apply container
opacity. The stored value is reported, never silently ignored: `unappliedContainerOpacity` lists the
containers and the editor status line says 「图层不透明度当前不支持（未生效）」. To implement with a
real need, following the two-kinds rule above.

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
- Order key = for every level of the whole container path from the root, then the object itself:
  its fractional index, then its record id (stable identity breaks ties AT EACH LEVEL, so siblings
  with equal indexes are ordered as whole subtrees and a container's content stays contiguous — dot,
  S1 review: tie-breaking only at the leaf interleaved two equal-index containers). Code-unit compare.
- Reference instances (D6): key = the reference's own path, then the source-relative path of the
  source item, so the source's internal order is kept and nothing leaves the instance.
- `depthOffset`: not interpreted in S1 (before, it only broke ties, which has no meaning under D1);
  reported, never silent: `unappliedDepthOffsets(ev)` lists the items, the editor status line says
  so; listed in OPEN.md until D1 is agreed.
- Recomputed only when parent / index / visibility / membership change (it reads those fields, not
  geometry), so a drag preview reuses it; counted (`paintOrderBuilds`).
- FabricView (A): `want` = onion yaws → `paint` → anchor dots (E1); same incremental keys as today.
  B draws the same list in the same order. V mode: groups are added in PAINT order (dot, S1 review:
  they were added in creation order, so P2 turned red in V); one group per top-level container with ALL its
  painted items (lines, fills, reference instances, nested containers' items) in paint order — before,
  fills were drawn under every group, reference instances above them, and curves of NESTED
  containers were not drawn in V mode at all (members were matched on the direct parent).
- Tests: P1–P4, P7 must leave the known-failure list (Playwright reports if they don't); unit test of
  the paint list itself for every case in `src/paintCases.ts` (the third check the contract asks for);
  property: the list is a permutation of the visible items, consistent with the tree order pairwise.
- New case added in S1, expected to FAIL until S2 and listed as a known failure: **P6-cross-layer** —
  F's own boundary B (opaque blue) in back layer L1, F in front layer L2 (R7): at (40, 11) blue.
  (Today it passes only because fills are always under curves; S1 alone breaks it.)

**S2 — C1: a fill leaves out the visible ink of its own boundary strokes that are behind it.**
Revised after dot: the protected area must be the ACTUAL stroke (same path, width, butt caps, miter
joins, miter limit), not a separately built outline. Withdrawn: "bezier-js outline per segment plus a
disk at joints" — a disk at a butt end / miter join covers pixels the stroke does not, which would cut
holes into the fill.
- Core: each `EvalFill` gets `ownInk`: the addresses of its boundary curves that are visible and
  earlier in `paint` than the fill (identities only; geometry is read from the current items).
- Renderers apply the SAME stroke operation as an inverse mask on the fill, so the excluded pixels are
  exactly the stroke's ink as that renderer rasterises it:
  - B / runtime canvas: paint the fill into a scratch layer, then stroke the own boundary paths with
    the stroke's own width / cap / join / miter limit using `destination-out`, then composite the layer.
  - Fabric (A): a fill object without object cache whose `_render` does the same scratch-layer cut
    in the main canvas transform. Checked and rejected: Fabric `clipPath` (fabric 7.4.0
    `drawObject(ctx, forClipping)` draws clip objects with `fill='black', stroke=''`, so a stroke cannot
    be a clip) and the fill's own object cache (cut shifted ~1 px against the main canvas).
  - SVG export: `<mask>` with a white rect and the boundary path stroked black with the same attributes.
- Hit testing: a point on the own ink is not a fill hit — `isPointInStroke` with the same parameters
  where a canvas is available; the pure core uses distance ≤ w/2 with the same caps / joins rules
  (stated approximation, checked against `isPointInStroke` on the same examples).
- Check FIRST (dot), as small pictures: right-angle, acute-angle (miter limit reached and not reached)
  and curved joints, butt ends at a free end. Expected: every pixel the stroke alone covers fully
  (alpha 255) shows the stroke colour; every pixel inside the fill the stroke alone does not touch
  (alpha 0) shows the fill colour; edge pixels are reported, not asserted.
- Pre-check result (`ownink.html`, `e2e/own-ink-check.spec.ts`, `1cf3078`): right angles + butt ends,
  30° mitre, 18° mitre-limit bevel, curved smooth joint + kink — Canvas2D scratch + destination-out and
  the Fabric scratch-layer object: 0 stroke pixels eaten, 0 holes in all four; unprotected: thousands
  eaten (the check can fail).
- Cost (single informational run, 640×420, DPR 1, 100 protected fills per frame): unprotected 0.05 ms,
  full-canvas scratch 14.8 ms, bounding-box scratch 8.8 ms — a real fixed cost per PROTECTED fill
  (only fills painted after their own boundary need it). Main-workload cost in S3.
- Tests: P6-own-boundary and P6-cross-layer pass; D2 example 2 becomes a 明确 case.

**S2 status (implemented):** core `fromPaint` decides `ownInk` (the REFERENCED segments of visible own
boundary curves painted before the fill — not the whole curve, dot: an unreferenced inner extension
is not own ink; drawn as `inkRuns`, maximal consecutive runs in chain order, butt at run ends; hidden
ones protect nothing); `inkStyle` is the one stroke definition; B and Fabric
call the same `paintFillLeavingOwnInk` (src/view/ownInk.ts; Fabric through `OwnInkFill._render`, an
internal fabric 7.4.0 dependency, documented in src/view/ownInkFill.ts); picking excludes the own ink
with the browser's native stroke test (`inkContains`: `isPointInStroke` with the same `inkStyle`), so
picking agrees with the picture — e2e "picking agrees with the picture" compares every pure-colour
pixel inside the fill for P6 own / cross layer, H1 (free butt end inside the fill) and H2 (acute inward
mitre): 0 disagreements; the earlier round-end approximation gave 19 (H1) and 10 (H2). Without a
canvas (node) it fails loudly instead of approximating; a distance bound skips it where no ink can be. Tests: P6 own / cross
layer / 50 % fill / third party between pass in A and B, also at a fractional pan and DPR 2; unit
tests for ownInk in maker, full, runtime, preview and yaw, and for picking; mutations (no protection,
cut on the main canvas) fail 16 picture tests each. Known: the inner anti-aliased seam (alpha ≥ 0.75)
— option (a) kept until decided. Cost: see S3.

**S3 — measure.** Main workload (500 curves, 100 fills, 6,000 dots), A and B: the cost of the paint
list (structural edits only) and of the clips (Fabric clipPath may force object caching — measured,
not assumed). Then D1 offsets, then D7 container opacity, each after agreement.

One step per commit, gate before each.
