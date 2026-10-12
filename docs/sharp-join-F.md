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

Each stroke outside its zone is closed by the same cut segment, so the joint region and the strokes share their cuts exactly: no gap and no overlap is possible along them by construction. The two join paths are what each class below defines.

## 4. The meeting points, by class

All meeting points are computed **on the actual offset curves inside the zones** — not on straight lines through p (the first two F attempts used a straight line from the inner to the outer meeting point and clipped whole strokes by it; that is the error dot 1791781594 named).

**Outer join path** (from S0's outer edge to S1's outer edge):
- **O1 — the outer edges, each extended forward, meet:** extended *forward* along their end tangents beyond A = p + o0 and B = p + o1 (neither folding back past its own corner), the two outer edges meet at M on the outer side. With straight edges both forward extensions meet iff θ < 180° − arccos(1/r) (r = 1: always below 180°; 2: 120°; 3: 109.5°; 4: 104.5°). This is the condition **for this experiment's forward-extension construction** only — not for every F-like construction (dot 1791781802). Path (rebuilt ink): S0's outer edge to A, the extension A → M, M → B, S1's outer edge.
- **O2 — O1, but M is beyond the limit** (5 × the average local width, measured from p to the farthest drawn point, dot 1791781520): the tip is shortened by one of the styles A / B / D / E of the sheet — **bowen**.
- **O3 — the forward extensions do not meet** (θ ≥ 180° − arccos(1/r), r > 1): marked on the sheet as **"not covered: this experiment uses no backward extension"** — not as "no construction exists". A and B are joined some other way (a step, a straight bevel, a smooth curve, widths eased) — **bowen**.
- **θ = 0° — a reversal** (or a degenerate tangent): its own case; the outline pinches to p (as v103).
- **θ = 180° — straight on:** its own case. Equal widths: a straight continuation, no tip, nothing to join — not a failure. Unequal widths: no tip; a pure width change at p, treated as O3.

**Inner join path** (from S0's inner edge to S1's inner edge):
- **I1 — the inner edges cross inside both zones:** the two inner offset curves cross at Q within arc length ℓ of p on both strokes. Path: S0's inner edge from E0i to Q, then S1's inner edge from Q to E1i. Nothing of either stroke's inner corner shows (no inner shoulder).
- **I2 — the inner edges do not cross inside the zones:** with straight edges, Q lies at a distance (h_w + h_t·cos θ) / sin θ **along the thin stroke's direction**, measured from the thin stroke's inner corner at p (dot 1791781802: this is the along-stroke distance — compared with ℓ, which is also along-stroke, directly; a straight-line distance from p would also count the half width). At 1:3: 3 thin half widths at 90°, 5.2 at 45°, 11.5 at 20°, about 29 at 8° — at small angles it is beyond a local zone. This experiment does not cover it ("not covered: Q beyond the zone"); what is drawn there (keep the inner shoulder, ease the widths, or a longer zone) — **bowen**.
- **I3 — the inner edges cross only outside the zones on one stroke:** treated as I2.

## 5. Failure inputs kept (dot 1791781680)

The first two F attempts and their inputs are kept as failure cases, not replaced by other geometry: widths 1:3 (8 / 24), the sheet's strokes, at 8° (the thin stroke cut through; a notch), 20° (an enclosed blank of 1.4 px² at the 0.25 grid), 140° and 170° (a white wedge open to the outside, not caught by the enclosed-blank check), and the long-stroke geometry (`node sharp-join-sheet.mjs 1 long`). The attempt itself is kept as `bench/experiments/sharp-join-F-failed-attempt.mjs` (marked as failed).

## 6. Questions for bowen (after review)

The classes O2, O3 and I2 are where the look is his choice; O1 and I1 are geometry. Order (dot 1791781802): first a sheet of **straight bands only**, F drawn in O1 / O2 × I1 cells and every other cell marked with its class; then a check that the rebuilt zone joins the **real curved strokes** at the cuts (no gap, no kink at E0o / E0i / E1o / E1i).
