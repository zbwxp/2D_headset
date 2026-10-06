# Paint order: rules → independent expected-result tests (draft for dot's review)

Status of each item:
- **明确** — the expected result follows from a written rule; a counterexample may be recorded as a known
  failure (`it.fails`) until fixed.
- **待定义** — the semantics are not decided. NO test, NO known failure: writing one would turn a candidate
  rule into a product contract (dot).

Every test uses a small picture whose expected front/back result is written down in advance. The same
input is checked in three places: the paint list produced by evaluation, Fabric (A) and B. A is never
compared with B as the proof.

Found so far: the code paints onion yaws → ALL fills → ALL curves → anchor dots (A and B), uses
depthOffset only as a tie-break, keys the order on the direct parent only, and compares fractional
indexes with `localeCompare`.

## 明确

**P1 — order inside one parent** (doc 11 §3 "排序": children of a parent are ordered; later ones are
painted on top). Layer L holds a red fill F and a blue curve C crossing it.
Case a: order [C, F] → where they overlap the pixel is red (F on top).
Case b: order [F, C] → blue (C on top).
Today: case a paints blue (fills always under curves) → counterexample.

**P2 — layer order** (doc 11 §3 "前后深度": by default the layer order and the order inside the layer
decide what covers what). Layers back → front: L1 holds blue curve C, L2 holds red fill F over C's middle.
Expected: red at the overlap. Reverse the layers → blue.
Today: blue in both cases → counterexample (dot reproduced it independently in the 0264deb review,
RGBA(85,0,170,192) where red should dominate).

**P3 — nested containers** (doc 11 §3: the same ordering rule at every level). Top level: L1 (index
`a0`) behind L2 (index `a1`). L1 = [group G (index `a5`) = [red fill F]]; L2 = [blue curve C (index `a0`)]
over F. Expected: blue at the overlap (L2 is in front). Swap the two layers' indexes → red.
Today: the key is "direct parent's index / own index", so F's key starts with G's `a5` and C's with
L2's `a1` → F is sorted in front → counterexample expected (to be confirmed by the test).

**P4 — fractional index comparison** (doc 11 §3: order stored as fractional indexes; they sort by
character code). Siblings with indexes `a0B` and `a0a`: `a0B` < `a0a` by character code, so the `a0a`
object is in front.
Today: `localeCompare` orders `a0a` first → counterexample (node: `'a0B'.localeCompare('a0a') === 1`).

**P7 — other objects cover a fill normally** (doc 11 §3 / RC-16: "其他对象照常可以盖住它"). Fill F in L1;
an unrelated curve U (not part of F's boundary) in L2 in front. Expected: U visible over F. And an
unrelated curve V in a layer BEHIND F's layer is covered by F. This guards against "lines always on top".
Today: V is painted over F → counterexample.

**P10 — visibility is inherited** (doc 11 §3 "显示": shown = own flag AND all ancestors shown). Hide the
parent container → its curves and fills are not painted (pixels equal the background).
Today: covered by data tests only; picture test to add (expected to pass).

## 待定义

**Requirements already fixed (bowen, doc 11 §2–§3; NOT to be re-asked):** lines AND fills support a
depth offset that can move them across layers; a fill never covers the strokes of its own boundary;
every other object still covers / is covered by it normally. The old product (V0.12.36) is a
comparison only: its "offset moves lines only", "a fill may cover its own line" and "boundary in the
same layer only" are NOT constraints of the new base (dot).

**P6 — own boundary strokes stay visible (明确, requirement).** Fill F and its boundary curve B; F placed
in front of B by order or offset. Expected: B's stroke pixels are the stroke colour over F, with the
same single-stroke colour as where B does not touch F (no double-painted darkening for a
semi-transparent stroke). Today: passes trivially (all curves are painted after all fills).

**D1 — depthOffset base and unit (implementation to design).** The requirement is fixed; how the number
is measured is not. Candidate for comparison: the old product (`docs/v01236-curve-depth-offset.md`,
`src/domain/drawing/depth.ts`, read): an integer counted in structural siblings; reference = direct
parent or top-level layers; positive = forward; clamped at the ends; never follows another curve's
offset. Worked example, layers back → front L1 = [collar K], L2 = [neck], L3 = [group G = [eye-white
fill F, eye line E], jaw J]: K +1 (layer reference) → in front of all of L2, behind L3; K +5 → clamped,
in front of all of L3. For fills the same unit would apply (new requirement; the old product had no
fill offset).

**D2 — how the own-stroke rule composes with order and offsets (implementation to design).** One
shared compositing rule is needed that keeps own boundary strokes visible WITHOUT painting a stroke
twice (no darkening of semi-transparent strokes) and without covering objects that should be in front.
"Repaint the boundary over the fill" (former R2) is a candidate implementation only and fails that
second condition as stated. Expected pictures for the hard cases (an unrelated object between the fill
and its boundary in depth; a semi-transparent boundary) are to be defined with dot before any test.
Withdrawn: a global "every boundary curve above its fill, reject conflicts" constraint.

**D3 — boundaries in another layer.** Doc 11 §2 (fill row): "边界可以引用其他图层的段" — allowed in the
new design. Which strokes count as the fill's own, and how D2 applies when one boundary is shared by
several fills in different layers, follows from D2.

**D4 — global contradictions (RC-16: "全局矛盾可检测").** What counts as a contradiction depends on D1/D2
(under R1 with the old offset rule there is none: plain order plus clamped offsets cannot form a cycle).
Whether a contradiction is refused on write or reported: to define.

**D5 — local interleaving (RC-16, 待定 there).** Not tested.

**D6 — references.** Is a reference's content painted at the reference's own position (between its
neighbours), and how do offsets inside the source behave in an instance? Not written down.

**D7 — container / reference opacity** (doc 11 §2: containers have 不透明度). Evaluation ignores it today
(dot: L3.opacity = 0 draws as 1). "Group opacity" (draw the group, then fade the result) and
"multiply each object's alpha" give different pictures where objects of the group overlap — to define.

**E1 — editor overlays** (onion yaws, anchor dots, selection). Editor display convention, not a product
rule; to be written down separately (today: onion under everything, dots over everything).
