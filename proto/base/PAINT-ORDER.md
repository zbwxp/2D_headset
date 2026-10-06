# Paint-order contract (v0.2 draft, for dot's review)

The ONE place for paint-order rules of the base. Doc 11 §2–§3 and doc 03 RC-16 (headset-design) state
the product requirements; this file turns them into expected pictures and tests, and records the
compositing design. OPEN.md and bench-results point here instead of restating rules.

## 0. How to read it

- **Requirement** — fixed by bowen (doc 11 / RC-16). Not re-asked.
- **明确** — expected result follows from a requirement. Tested independently: a small picture whose
  expected colour at named points is written down in advance, checked in the evaluation's paint list,
  in Fabric (A) and in B. A is never compared with B as the proof. A counterexample in today's code is
  recorded as a known failure until fixed.
- **Proposal** — our (Claude + dot) design for a technical gap, with counterexamples. Not a user
  choice. No test and no known failure until dot and Claude agree; then it becomes 明确.
- **Comparison** — the old product (main repo, V0.12.36) is reference material only. Its "offset moves
  lines only", "a fill may cover its own line" and "boundary in the same layer only" are NOT
  constraints of the new base.

## 1. Requirements (doc 11 §2–§3, RC-16)

R1. Children of a parent are ordered (fractional indexes); later is painted on top. Same rule at every
    level of nesting.
R2. By default the layer order and the order inside the layer decide what covers what.
R3. Lines AND fills have a depth offset that can move them across layers.
R4. A fill never covers the strokes of its own boundary; every other object covers / is covered by it
    normally.
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

**P3 — nested containers (R1).** Top level: L1 (`a0`) behind L2 (`a1`). L1 = [group G (`a5`) = [red F]],
L2 = [blue C (`a0`)] over F, C not F's boundary. Blue at the overlap; swap L1 / L2 indexes → red.
Today: key "direct parent index / own index" puts F (`a5/…`) in front → expected known failure.

**P4 — fractional index comparison (R1).** Siblings with indexes `a0B` (red F) and `a0a` (blue C), C
not F's boundary. By character code `a0B` < `a0a` → C in front → blue. Today: `localeCompare` puts
`a0a` first → known failure.

**P6 — own boundary strokes stay visible (R4).** Red F with boundary curve B (blue). F placed in front
of B by order. At a point on B's stroke inside F: the blue stroke colour; for a 50 % blue B the pixel
equals the same B over F's colour painted once (no darkening from painting twice). Today: passes only
because all curves are painted after all fills.

**P7 — other objects cover a fill normally (R4).** F in L2; unrelated blue curve U in L3 → blue at the
overlap; unrelated blue curve V in L1 → red at the overlap (F covers V). Guards against "lines always
on top". Today: V painted over F → known failure.

**P10 — inherited visibility (R6).** Hide the parent container → its curves and fills leave the
background colour. Today: data tests only; picture test expected to pass.

## 3. Proposals (Claude → dot)

**D1 — depth offset base and unit (R3).** Candidate for comparison (old product, read: integer counted
in structural siblings; reference = direct parent or top-level layers; positive = forward; clamped at
the ends; never follows another object's offset → no cycles). Worked example, layers back → front
L1 = [collar K], L2 = [neck], L3 = [group G = [eye-white fill F, eye line E], jaw J]: K +1 (layer
reference) → in front of all of L2, behind L3; K +5 → clamped, in front of all of L3. In the new base
the same unit applies to fills. Open: whether the reference choice is per object (old) or fixed.

**D2 — compositing for R4 without painting a stroke twice.** Candidate C1 ("the fill leaves out its own
stroke ink"): every object paints once at its own position in the order; a fill does not paint inside
the ink area of the stroke pieces it references (its boundary pieces, D3). Effects:
- An opaque own stroke behind the fill is visible, painted once (P6).
- Objects in front of the fill cover it and the stroke normally (P7 unchanged).
Counterexamples to settle with dot:
1. Semi-transparent own stroke behind the fill: inside the left-out area, what shows under the stroke
   is whatever is behind the fill, not the fill colour. With the fill BEHIND the stroke (the usual
   case) the stroke is over the fill colour. So the same 50 % stroke looks different on its inner half
   depending on order.
2. An unrelated object X with stroke < X < fill in depth: inside the stroke's ink area the fill paints
   nothing, so X shows there instead of the fill. Is "X visible through the fill only along the
   stroke" acceptable, or should the left-out area be limited to pixels where the own stroke is the
   top-most of {stroke, objects between}?
Withdrawn: a global constraint lifting boundary curves above their fills; repainting the boundary over
the fill (paints twice, covers objects that are in front of the stroke).

**D3 — geometry reference vs stroke ownership (R7).** A fill's boundary is a list of segment references
(geometry); they may live in any layer. "Own strokes" of a fill = the stroke ink of exactly those
referenced segment pieces, wherever their curves live; the stroke still belongs to its curve and is
painted at the curve's position. One segment shared by two fills in different layers: each fill leaves
out that ink (C1) independently → no ordering constraint between the two fills, no new conflicts.

**D4 — global contradictions (R5).** With D1 (offsets never follow other offsets) plus C1 (R4 adds no
ordering constraint), the paint order is a total order computed from the tree and the offsets, so these
rules cannot create a cycle. RC-16's cyclic case (A over B, B over C, C over A) then needs local
interleaving (D5); a whole-object cycle has no representation. To confirm.

**D5 — local interleaving (RC-16 待定).** Out of scope for this contract version.

**D6 — references.** Proposal: a reference's content is painted at the reference's own position in its
parent, as if its source subtree were a group placed there; the source's internal order is kept.
Offsets inside the source resolve within the instance (the instance is their root), so source content
cannot jump over unrelated layers of the target. Counterexample to check: a source curve whose offset
uses the "layer" reference — inside an instance it clamps at the instance's ends.

**D7 — container opacity (R8).** Two semantics differ where objects of the container overlap:
group opacity (paint the container, then fade the result; SVG `<g opacity>`, Photoshop layer opacity)
vs multiply each object's alpha (overlaps darken). Proposal: group opacity, because an artist's 50 %
layer should not show darker overlaps of its own lines. Conflict with D1: a group painted as one image
cannot have an outside object interleaved inside it (CSS: opacity < 1 creates a stacking context).
Counterexample: setting a layer to 99 % must not change what covers what. Candidate: members whose
offset moves them out of the container are painted separately with the container's opacity multiplied
in; the rest of the container is painted as one image. Order never depends on opacity; the cost is
that escaped members do not share the group image.

**E1 — editor overlays** (onion yaws, anchor dots, selection): editor display convention, not a
product rule. Today: onion under everything, dots over everything. Kept as is, stated here.
