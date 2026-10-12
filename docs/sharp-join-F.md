# Sharp join, variant F (each stroke keeps its own width, trimmed locally) — the construction, before any code

An experiment for bowen 1791780683 (one layer first; a sharp join where the two lines may differ in width), defined at dot 1791781468 / 1791781594 / 1791781680 / 1791781802. **This is an experiment's definition, passed for the next sample sheet (dot 1791781802) — not a product implementation plan.** Nothing here is a decided visual rule: the classes marked **bowen** are aesthetic choices for him. The sample sheet (`bench/experiments/sharp-join-sheet.mjs`) draws A–E; F is drawn only after this definition is reviewed.

## Setup

One joint p, where stroke S0 ends and stroke S1 starts (same layer, a sharp join). At p: S0's end tangent a, S1's start tangent b; the local half widths h0, h1 (the drawn widths at p); the angle between the strokes θ; the thin and wide half widths h_t ≤ h_w, r = h_w / h_t. Each stroke has four offset edges near p: outer and inner (outer = the side the turn bulges to).

## 1. What ink may change

Only each stroke's **end piece**: the part of the stroke within arc length ℓ of p along its centre line (the **joint zone**). Everything of either stroke outside its zone — its outer and inner edges, its other end and cap — is drawn exactly as without the join.

- **ℓ is the experiment's parameter, not a rule of bowen's** (dot 1791781802): it is not the 5× tip limit and not another 5× rule. In this experiment ℓ = k × the wider local full width (2 h_w), measured as **arc length along each stroke's centre line from p**; the sheet tries k = 3 and k = 6 and prints k.
- Inside the zone the ink is **rebuilt**, not only trimmed: the join paths below may *extend* a stroke's edges beyond its square end (to M) and drop parts of it (beyond Q). Trimming the existing square ends alone never produces M (dot 1791781802).

## 2. Which edges are kept

- Outside the zones: all four offset edges, unchanged.
- Inside the zones: each stroke's own **outer edge** and **inner edge** (the offset curves of its centre line at its own width) are kept up to where the join path leaves them (below); nothing of a stroke's width changes.
- The zone ends at a **cut** across each stroke: the segment from its outer edge to its inner edge at arc length ℓ from p (E0o–E0i on S0, E1o–E1i on S1).

## 3. How the boundary closes

The joint region is one closed outline, in this order:

E0o → **outer join path** → E1o → cut across S1 → E1i → **inner join path**, backwards → E0i → cut across S0 → E0o.

Each stroke outside its zone is closed by the same cut segment, so the joint region and the strokes **meet at the same seam** (no gap along it). That alone does not rule out an overlap (dot 1791782262): "no overlap" also needs the two regions to lie on opposite sides of each cut and the joint region's closed outline not to cross itself — checked per case (the curved-stroke sheet counts the outline's self-crossings), not assumed from the closing order. The two join paths are what each class below defines.

## 4. The meeting points, by class

Three different things meet here, kept apart (dot 1791782262):
- each stroke's **offset curves** (its outer and inner edge, at its own width, from its centre line);
- the **forward extension** of an outer edge at the joint: the straight line along the stroke's end tangent from A (or B) — new ink, not part of the offset curve;
- the **inner meeting point Q**: where the two actual inner offset curves cross, located on each stroke by its **centre-line arc length** from p.

So M is computed on the forward extensions, Q on the actual inner offset curves — never on straight lines through p (the first two F attempts used a straight line from the inner to the outer meeting point and clipped whole strokes by it; that is the error dot 1791781594 named).

**Outer join path** (from S0's outer edge to S1's outer edge):
- **O1 — the outer edges, each extended forward, meet:** extended *forward* along their end tangents beyond A = p + o0 and B = p + o1 (neither folding back past its own corner), the two outer edges meet at M on the outer side. With straight edges both forward extensions meet iff θ < 180° − arccos(1/r) (r = 1: always below 180°; 2: 120°; 3: 109.5°; 4: 104.5°). This is the condition **for this experiment's forward-extension construction** only — not for every F-like construction (dot 1791781802). Path (rebuilt ink): S0's outer edge to A, the extension A → M, M → B, S1's outer edge.
- **O2 — O1, but M is beyond the limit** (5 × the average local width, measured from p to the farthest drawn point, dot 1791781520): the tip is shortened by one of the styles A / B / D / E of the sheet — **bowen**.
- **O3 — the forward extensions do not meet** (θ ≥ 180° − arccos(1/r), r > 1): marked on the sheet as **"not covered: this experiment uses no backward extension"** — not as "no construction exists". A and B are joined some other way (a step, a straight bevel, a smooth curve, widths eased) — **bowen**.
- **θ = 0° — a reversal** (or a degenerate tangent): its own case; the outline pinches to p (as v103).
- **θ = 180° — straight on:** its own case. Equal widths: a straight continuation, no tip, nothing to join — not a failure. Unequal widths: no tip; a pure width change at p, treated as O3.

**Inner join path** (from S0's inner edge to S1's inner edge):
- **I1 — the inner edges cross inside both zones:** the two inner offset curves cross at Q within arc length ℓ of p on both strokes. Path: S0's inner edge from E0i to Q, then S1's inner edge from Q to E1i. Nothing of either stroke's inner corner shows (no inner shoulder).
- **I2 — the inner edges do not cross inside the zones.** That Q lies beyond a zone does **not** mean the two strokes overlap throughout it (dot 1791782871); what shows depends on whether a square end sticks out. With straight bands (thin half width h_t, wide h_w, angle θ, the wider stroke written W, the thinner T):
  - **Q's distance:** (h_w + h_t·cos θ) / sin θ along T's direction from T's inner corner (straight bands only, dot 1791782262; on curves Q is found on the inner offset curves and placed by centre-line arc length).
  - **What can show:** W's square end has its inner corner C_W = p − o_W at a lateral distance h_w·cos θ from T's centre line. It lies inside T's band iff h_w·cos θ ≤ h_t; T's inner corner lies inside W's band iff h_t·cos θ ≤ h_w (always, as h_t ≤ h_w).
  - **I2a — h_w·cos θ ≤ h_t** (always for equal widths): no square end shows past the other band. **Exposed edges:** T's and W's outer edges and the outer tip only; both inner edges lie inside the other band between p and Q. **Construction:** nothing is rebuilt on the inner side; the zone outline is E0o → A → tip (O1 / O2) → B → E1o, and the two strokes' own outlines close it. **Leave / arrive:** at A along T's outer edge, at B along W's outer edge (tangent by construction; O2 as in §4).
  - **I2b — h_w·cos θ > h_t:** W's square end sticks out past T's **outer** edge. **Exposed edges** near p: W's inner edge from R1 to C_W, and W's end face from C_W down to R0 — R1 where W's inner edge crosses T's outer edge, at d1 = (h_w·cos θ − h_t) / sin θ along W from p; R0 where W's end face crosses T's outer edge (its forward extension).
    - **I2b-i — d1 ≤ ℓ:** the whole protrusion lies inside W's zone. **Construction:** the zone's ink is the union of three pieces — T's end piece, W's end piece **trimmed to T's side of T's outer-edge line** (that line and its forward extension to A), and the outer tip; the protrusion (R1 → C_W → R0) is dropped. **What shows:** the top is T's outer edge, unbroken from E0o to A, then the tip, then B and W's outer edge to E1o; inside the zone both inner edges lie inside the other piece and do not show. **Leave / arrive:** only at A and B (along the outer edges, tangent by construction); the trim along T's outer-edge line coincides with T's own edge, so it adds no visible corner. **Closing order of the zone (its boundary as a region):** E0o → A → tip → B → E1o → E1i → along W's inner edge toward p, until it first meets the boundary of T's end piece (T's cut E0o–E0i or T's inner edge) at X1 → along that boundary to E0i → E0o (T's cut). X1 depends on the geometry and is computed, not assumed; the parts of this boundary inside the union (W's inner edge, the cuts) are seams, not visible outline — the checks verify the union has no self-crossing and no exposed corner. *(Corrected before review: a first wording closed back along T's outer edge from R1, which retraces it — a zero-area overlap.)*
    - **I2b-ii — d1 > ℓ:** the protrusion leaves the zone; outside it W's inner edge is the top of the ink and the zone cannot drop it without a step at the cut. **Not covered** by this experiment (marked so); a construction needs its own definition before any drawing.
- **I3 — the inner edges cross only outside the zones on one stroke:** treated as I2.

## 5. Failure inputs kept (dot 1791781680)

The first two F attempts and their inputs are kept as failure cases, not replaced by other geometry: widths 1:3 (8 / 24), the sheet's strokes, at 8° (the thin stroke cut through; a notch), 20° (an enclosed blank of 1.4 px² at the 0.25 grid), 140° and 170° (a white wedge open to the outside, not caught by the enclosed-blank check), and the long-stroke geometry (`node sharp-join-sheet.mjs 1 long`). The attempt itself is kept as `bench/experiments/sharp-join-F-failed-attempt.mjs` (marked as failed).

## 6. Questions for bowen (after review)

The classes O2, O3 and I2 are where the look is his choice; O1 and I1 are geometry. Order (dot 1791781802): first a sheet of **straight bands only**, F drawn in O1 / O2 × I1 cells and every other cell marked with its class; then a check that the rebuilt zone joins the **real curved strokes** at the cuts (no gap, no kink at E0o / E0i / E1o / E1i).
