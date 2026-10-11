# Stage 3b, package 4: the outer view's minimal move — rules before code

**Status:** rules accepted by dot 1791694943 at `ac7a315` as the basis for implementation and acceptance, with the z === ρ line added. The coordinate refusal (`385707a`) is reviewed on its own first; the body is coded after it passes and after the summary `docs/stage3b-pkg4-solve-problems.md`. Package 3 is accepted at `d6502dc` (dot 1791693873).

**Ledger check** (`docs/consolidation-ledger.md`): rows 13 and 14 are triggered by this package; their handling is §7. No other row is triggered.

**Decided, not re-asked** (`docs/architecture-multiview.md` §6, §7; rules of 2026-10-03/04):
- 0° never moves;
- first keep the outer view fixed and adjust the response; only if the target is still unreachable may the outer view move, minimally;
- end points are penalised more than handles: a weighting, not a ban;
- the move takes effect at once and is undone with the response change in one step (bowen 1791651929 乙).
- This round corrects on edges only (bowen 1791692031).

## 1. When the outer view moves

Package 3 refuses a dragged axis whose two views are equal (`correction-axis-fixed`): no response can move a value that is the same at both ends. Package 4 opens that case, and only that case:

- **The edge starts at the front:** front → (±90, 0) or front → (0, ±45). The view that may move is that edge's outer view, O. The front never moves; the corners never move.
- **The control and axis:** in the target set, A === B exactly (A in the front, B in O), and the target differs from what the pose shows (q ≠ p).
- **The target is A itself (c = q − A = 0):** with A === B the pose shows (1 − r)·A + r·A, which is A only up to rounding, so a drag to exactly A can arrive here. The knot [t, 0] shows A exactly (the B term has weight 0 and is left out), so it is written and nothing moves. Package 3 refuses this case as `correction-axis-fixed` today; package 4 changes that.
- **Everything else is as in package 3.** A reachable axis (A ≠ B) is solved by the response alone, with no bound, exactly as accepted. An equal axis on an edge that does not start at the front is still `correction-axis-fixed`.

Why this is the only case: with A ≠ B every target has a response (package 3's w), so the outer view never has to move. With A === B no response can change the value. That is the decided "only if still unreachable".

## 2. The cost and its minimum

For one control and axis in the move case, with c = q − A (≠ 0), r = r(t) (its current response at t), S the scale (below):

- The new knot is [t, w] and O's value becomes B' = A + c / w, so the pose shows A + w·(B' − A) = q.
- **Cost:** f(w) = k · ((B' − B) / S)² + λ · (w − r)² = k · c² / (S² w²) + λ · (w − r)².
  - k = 16 for a point's position, k = 1 for a handle vector: end points cost more than handles.
  - λ = 0.005: the price of changing the response.
  - S = the larger of the x and y extents of all point positions in the front and O, at least 1e-6, **read once from the draft on entry, before any move, and shared by every control of the correction** (dot 1791694500). The move is measured relative to the drawing's size, so scaling the whole drawing does not change the answer, **as long as the extent stays above the floor**; a drawing whose extent crosses 1e-6 when scaled does not keep its answer (tested separately).
  - k, λ and the floor of S are v103's values (`boundedBasisInverse.ts` at 7205381: `SNAPSHOT_BASIS_NODE_PENALTY = 16`, `SNAPSHOT_BASIS_RESPONSE_PENALTY = .005`; `surfaceBasisFallback.ts` `basisScale`, floor 1e-6). They are tuning constants, kept in one place.
- **What is solved, and what is not claimed** (dot 1791694376): the cost of one control and axis (its move plus its response change) is minimised, and that best candidate is then checked (§4, §5). It is **not** a minimum over the whole correction: old knots, links and springs are checked after the solve, not part of it. A refused candidate does not prove that no other move would work; it is refused, not searched around.
- **The per-axis minimum exists:**
  - f → ∞ as w → 0 (the move grows without bound) and as |w| → ∞ (the response change grows without bound). This is the real minimum dot asked for (dot 1791687563): the response is not free, so the move cannot tend to 0.
  - Setting f′(w) = 0 gives w³ (w − r) = K, with K = k c² / (λ S²) > 0.
  - On w > 0, f decreases then increases, with exactly one stationary point: the root w₊ of w³(w − r) = K on w > max(r, 0) (there w³(w − r) increases from 0 to ∞).
  - On w < 0, likewise exactly one: the root w₋ on w < min(r, 0) (there w³(w − r) decreases from ∞ to 0 as w rises).
  - **The branch is chosen by the sign of r, not by comparing costs** (dot 1791694778): f for r and f for −r are mirror images (f_r(−w) = f_−r(w)), and with r ≥ 0, f(a) ≤ f(−a) for every a > 0. So r > 0 takes w₊, r < 0 takes w₋, and r = 0 (−0 included) takes w₊; at r = 0 the two cost the same, so w₊ is a deterministic choice, not uniqueness. Choosing by sign avoids a tiny negative r rounding into a cost tie and picking the wrong direction. So O moves in the direction of the drag, unless the control was earlier corrected to swing behind the front at t (r < 0).
  - **Solved in a scaled form, never through K** (dot 1791694458: K = k c² / (λ S²) underflows to 0 for c = 1e-200, S = 1, and overflows for large c / S, though c ≠ 0):
    - a = |c| / S · √(k / λ), computed in that order; refused (`correction-not-finite`, naming the control) unless a is finite and > 0, and √a > 0. Then K = a².
    - w = √a · z and ρ = r / √a (refused unless finite). The equation becomes z³ (z − ρ) = 1, and the cost f = λ · a · (1/z² + (z − ρ)²), so candidates are compared by φ(z) = 1/z² + (z − ρ)², free of the scale.
    - **Brackets of width 2, never expanded,** each from an inner end (where the test fails) to an outer end (where it holds): z₊ from max(ρ, 0) to max(ρ, 0) + 2, z₋ from min(ρ, 0) to min(ρ, 0) − 2. At the inner end z³(z − ρ) ≤ 0 < 1 (at z = 0 it is 0). At the outer end it is ≥ 2 in exact arithmetic, so rounding cannot drop it below 1. A margin of 1 is not enough: for ρ ≈ 1e-16, ρ + 1 rounds to 1, where the value is 1 − ρ < 1 (found by a prototype run).
    - **The sign test without overflow:** z³(z − ρ) ≥ 1 ⇔ sign(z) · ((z − ρ) − 1/z/z/z) ≥ 0 for z ≠ 0; z = 0 counts as below. No product z³ is formed, so a huge ρ cannot give ∞ · 0.
    - **Midpoint and end:** mid = inner + (outer − inner) / 2 (no overflow: the width is at most 2 plus an ulp of ρ). The half where the test holds becomes the new outer end. Stop when mid equals either end (adjacent doubles). **The candidate is the one of the two ends with the smaller φ** (zero excluded), not always the outer end (dot 1791694778: at √a = 1, ρ = r = 2⁵³ the bracket [r, r + 2] has no double inside; the outer end r + 2 has φ ≈ 4, the inner end r has φ ≈ 1.2e-32). Equal φ: the end nearer ρ (the smaller response change); still equal: the larger |z| (the smaller move). If the two ends are one double (|ρ| so large that ρ ± 2 rounds to ρ), the candidate is that double. **Whenever the chosen z === ρ, w is set to r directly**, not computed as √a · ρ, so the scaling's round trip cannot change a response that should stay (dot 1791694943): the response unchanged and only O moving. Deterministic.
    - **Prototype check (scratch scripts; the body's tests will carry the same cases as reproducible tests, dot 1791694943):** 50 000 random ρ over 10^±30 plus 0, ±5e-324, ±1e300, ±1.7e308 and 2⁵³: every bracket valid, at most 395 halvings; c = 1e-200, S = 1, r = 0 gives z = 1 and a finite move (≈ 1.3e-101); ρ = 2⁵³ now gives z = r (φ ≈ 1.2e-32). **Not claimed:** that the candidate is the cheapest of all doubles. Over 120 000 cases a neighbouring double outside the final bracket sometimes evaluates to a smaller φ, by at most 3.4e-16 relative: φ's own rounding near a flat minimum, not a real gain.
    - **Refused before any write** (`correction-not-finite`, naming the control): any NaN; w = 0 or w not finite; B′ or the shown value not finite. A finite 0 for B′ or for the shown value is legal (dot 1791694791).
- **What v103 had that this drops, and why:**
  - its sampled-curve rows (the change of each implicated curve at 9 samples), which couple a curve's points and handles into one non-convex problem solved by coordinate descent, a local solve with no uniqueness claim (v103's own comment). Without them every control and axis is solved alone, with one deterministic candidate the tests can pin down;
  - its trust radius ±8 on the response: the penalty λ already bounds it, and package 3's response-only solve has no bound either.
- **Example** (S = 100, a point at t = 0.5 with r = 0.5, dragged 2 units): w³(w − 0.5) = 16·4 / (0.005·10⁴) = 1.28, w ≈ 1.215, O moves by 2 / 1.215 ≈ 1.65. A handle (k = 1) dragged the same: w ≈ 0.72, O's handle moves ≈ 2.8.

## 3. The range of the move

- **Which view:** only O, the outer view of the pose's edge, and only when that edge starts at the front.
- **Which controls and axes:** only those of §1 (in the target set, A === B, q ≠ p). Every other control in O keeps its value. A linked member moves with its component (same target, same knot).
- **How far:** what §2 gives; no hard bound. Refused if any number on the way is not finite (§6).
- **How it is written:** through O's own `net.move` / `net.moveHandle`, so O's links and springs settle it. O's other axis of a moved point keeps its value.
- **Settling:** the stage-2 'views' mode: O and every other view by positions only, the front not settled, no auto-bind anywhere.

## 4. Old targets (protected knots)

Moving O changes what a kept knot produces on every edge with O as an end: front → O, and O → each corner next to it. So, for each moved control and axis:

- **On front → O:** every other knot of that axis is re-solved by the same formula as below, keeping the value it showed. That value is A only up to rounding ((1 − w_k)·A + w_k·A ≠ A in about 29% of random cases), so it is not replaced by [t_k, 0]; the re-solve gives a value near 0.
- **On O → corner:** each knot is re-solved to keep its value v (read at its recorded t, before the move): w′ = (v − B′)/(C − B′), C the corner's value, with package 3's overflow-free form.
- **B′ here is O's value as the settle leaves it**, not as written: three or more linked members go to the average of their targets, which can differ from B′ by rounding (about 17% of random cases for three equal targets). So the order is: write the moves, settle the trial, read O's settled values, then re-solve the protected knots against them and write the knots (§10).
  - If C === B′: when v === B′ the knot is still met and stays as it is; otherwise the whole correction is refused (`correction-breaks-target`, naming the control, edge and t; dot 1791687776).
  - A non-finite w′, or a non-finite value with it, refuses (`correction-not-finite`).
- **Unchanged:** knots of controls that did not move, and every knot on edges without O. Controls without knots on O's edges get a new in-between shape there: that is O moving, which the decided rule allows.
- The re-solved knots keep their t, so the lists stay valid; written in the same step as the new knot.

## 5. The final check (after the settle)

**Baseline: the draft as it was when `correct` was entered**, not the published state (dot 1791694523). A stroke broadcast earlier in the same edit is an allowed companion and has already changed strokes legally; comparing with the published state would refuse it. The whole edit's declarations are checked separately by the merge rules, as for every edit.

**The move mask, per control and axis** (dot 1791694560): the set of (control, axis) pairs §3 moves in O. Everything outside the mask is compared per scalar, so a moved point's other axis is outside it.

Run on the settled trial (the draft as the commit will settle it), so springs and links in O are included (dot 1791687776):

| What (fields compared) | Must hold |
|---|---|
| at the pose: each control in the target set, each axis | its target, within 1e-9 · max(1, \|q\|) |
| at the pose: every other control, each axis | its value on entry, exactly |
| in O: each (control, axis) in the mask | B′ within 1e-9 · max(1, \|B′\|) (the settle may average linked members) |
| in O: every point position and handle vector scalar outside the mask, the other axis of a moved point included | its value on entry, exactly |
| in every other view and in `base:angle`: every point position and handle vector | its value on entry, exactly |
| every knot on front → O and on O → corners | its value at its recorded t: exactly when not re-solved; within 1e-9 · max(1, \|v\|) when re-solved |
| every knot on every other edge, and every control's knots not written by this correction | unchanged |

Strokes, end strokes, radii and structure are not written by `correct` or by the 'views' settle; they are left to the declarations and the per-operation write test (package 1's limited guarantee), not compared here.

Reachable refusals of this table: dot's example (1791694560), linked b and m with x = 0 / +1e-10 in the front and 0 / −1e-10 in O, y = 0 at both ends, a correction of y only. `net.move` writes whole positions, and the settle averages the members, so O's x becomes −5e-11 for both: outside the mask, so refused (`correction-not-reproduced`, naming the control and axis), although the pose and the responses would pass. Likewise a smooth join whose handles a file left unaligned: moving its point in O makes the spring re-solve them, so refused.

Anything else refuses the whole edit (`correction-not-reproduced`, naming the control and axis). One undo step reverts the knots and O.

## 6. The three lists (from the package 3 summary, dot 1791693587)

### 6a. Invariants relied on, where and how strongly each entry enforces them

| Invariant | Commit of an edit | Open (file) | Paste (clip) | Inside an edit, between calls | How the design meets the weakest |
|---|---|---|---|---|---|
| I1 exactly nine views | creation; no operation removes a view | exact (`checkViews`) | cannot add or remove views | as published | relied on as exact |
| I2 knots valid (finite, strictly increasing in (0, 1), ≤ 256) | written by `correct`, by `follow` (deletions, unbind copies), by `link` (`mergeForLink`, the union of knots) and by paste / copy layer (`insert` of a checked clip) (dot 1791694791) | exact (`checkResponses`) | exact (clip check) | `correct` is alone | re-solved knots keep their t; values checked finite before writing |
| I3 linked members hold identical response sets | `link` (exact), `correct` (exact) | exact (`canon`) | links are not pasted | `correct` is alone | package 3's check on the sets as they would be written (`correction-link-differs`) |
| I4 linked members coincide in each view | exact only for groups the edit acted on (`links.align`) | within 1e-9 | — | not aligned until the settle | members a hair apart get different c, so different w: refused by I3's check, never written apart. O's move aligns them exactly. |
| I5 the settle of a layer changes only what the edit acted on there | links align only groups with a target in that layer; springs re-solve only joins whose points or handles were touched or held there | the same code at open; a file may hold unaligned smooth handles and linked points up to 1e-9 apart, which stay as they are until touched | — | as published plus companions | `correct` leaves targets and held handles in O only, and touches nothing in any other layer, so the trial's settle of the front and of every other view is a no-op there (dot 1791694500). Not "settling again never changes anything". The final check (§5) compares every other layer exactly, and tests use states with unaligned smooth handles and nearly coincident linked points. |
| I6 only O changes among the views; the front, the corners, the other three neighbours and `base:angle` stay | — | — | — | — | the final check compares them with the draft on entry to `correct` exactly (§5) and tests cover it. `undeclared-write` only checks the geometric intents the operation left, and `front-neighbours` allows any of four views, so it does not guarantee this (dot 1791694376); the guarantee is the one package 1 limited it to |

### 6b. Every throw on the operation's path

| Where | Throw | Reachable? | Becomes |
|---|---|---|---|
| `edgeAt` | pose refusals | yes | as package 3 |
| target checks | `correction-bad-target` | yes | as package 3 |
| `net.point` / `net.line` / `net.handle` | unknown id | no: ids checked first | internal error |
| `evaluate` before the write | `pose-not-finite` | **yes**: a file whose views and knots already overflow at this pose | `pose-not-finite` refusal (§7a) |
| `evaluate` before the write | `model-incomplete` | no: I1, I2 | internal error |
| the solve (§2) | K, w, B′ or the shown value not finite | yes (extreme drags, a tiny S) | `correction-not-finite`, naming the control (checked before any write) |
| the re-solve (§4) | w′ or its value not finite; views equal and the target differs | yes | `correction-not-finite` / `correction-breaks-target` |
| `net.move` / `net.moveHandle` in O | `Coordinates must be finite numbers` | no: B′ checked finite first | internal error |
| the settled trial and the commit's settle (`settleLayerPositions`) | `Coordinates must be finite numbers` from `net` when a settle step overflows on finite input: `links.align` sums before averaging (two linked x = 1e308 → ∞), springs take `Math.hypot` of a handle (components ≈ 1.5e308 → ∞) (dot 1791694458) | **yes**, and in any edit, not only `correct` (a plain move of those linked points throws today) | `net`'s coordinate check throws a typed refusal, `coordinates-not-finite`, with the same message; the edit rolls back. One check for the whole class, not a catch around the settle. A separate fix commit before package 4's code, with tests through a plain move and through `correct` (rollback, undo history unchanged). The averaging's spurious refusal near the largest numbers is a new ledger row (refused, never wrong). |
| `evaluate` after (settled) | `pose-not-finite` | no: every changed value checked before writing | if it happens anyway, `correction-not-finite` naming the control it reports (§7a); other errors stay errors |
| commit | `locked`, `stage2-alone`, `undeclared-write` | yes / yes / declaration bug | as declared |

### 6c. Tests, each through its weakest reachable entry

- **I4, through a file:** linked members 1e-10 apart, a move-case drag → `correction-link-differs`, state unchanged, the file still opens.
- **I5, through a file:** a file-opened drawing with a smooth join and a link in O; a move of a point → only O's moved controls change, every other view byte-identical; a move of a handle whose spring turns its partner → `correction-not-reproduced`.
- **`pose-not-finite` before, through a file:** knots and views that already overflow at the pose → `pose-not-finite` refusal, not a bare error.
- **The cost:** the chosen w as a root (an independent check of z³(z − ρ) = 1 within rounding, and that φ at the chosen end is not above the other end's); a point moves less than a handle for the same drag; scaling the whole drawing by 2 gives the same w (above the floor); r < 0 takes the negative branch; r = 0 and r = −0 take the positive one.
- **The range:** a pitch edge (front → (0, 45)) as well as a yaw edge; an equal axis on an edge not from the front stays `correction-axis-fixed`; an A ≠ B axis never moves O; the other axis of a moved point keeps its value in O.
- **Old targets:** a knot on O → corner is kept after the move (within 1e-9); C === B′ with an equal target is kept, with a different target refuses `correction-breaks-target`; front → O's other knots keep the value they showed (recorded by `onEdge`, not assumed to be A), including dot's A = B = 1, r = 1e16 knot that shows 0 (dot 1791694396).
- **Numbers:** √a = 1, ρ = r = 2⁵³: the candidate is r, and its φ is compared with r + 2's in the test, not only "the bracket is valid and the loop ends" (dot 1791694778); a tiny negative r (−1e-300) takes the negative branch; c = 1e-200 with S = 1 and r = 0 (K would underflow) → a finite move; c / S so large that a overflows → `correction-not-finite` naming the control; |ρ| > 2⁵³ → w = r exactly; a tiny S (all points coincide) gives a finite move or a refusal, never a bare error.
- **The settle's overflow, in a plain edit and in `correct`:** two linked points at x = 1e308 moved in y → `coordinates-not-finite`, state and undo history unchanged; a spring on a handle with components 1.5e308 likewise.
- **Transaction:** one undo step reverts knots and O; the front, the corners, the other cardinal views and `base:angle` unchanged; the declaration test covers the move case.
- **Mid-edit companions** (dot 1791694523): a stroke broadcast before `correct` and one after it in the same edit, each with a move case: both go through, the broadcast's strokes kept, the move checks not tripped; a select beside it gives the same result as alone.
- **The per-axis mask** (dot 1791694560): dot's linked b / m example (x 0 / ±1e-10, y corrected) → `correction-not-reproduced` naming the x axis; a single point corrected in y keeps its x in O exactly.
- **I5 states, through a file:** a smooth join with unaligned handles elsewhere in O and nearly coincident linked points elsewhere: a move case leaves them exactly as they were; the same join at the moved point → refused.
- **S:** scaling the drawing by 2 keeps w while the extent stays above 1e-6; a drawing whose extent crosses the floor is tested on its own.

## 7. Ledger rows 13 and 14

### 7a. Row 13 (`modelOf` in `document`, `correct` takes a callback): close it by declaring the boundary

- Assembling the model needs every module's parts (joins' radii, end strokes, responses), and the settled trial is the document's pipeline. Neither belongs in `animation`, and `animation` must not import `document`.
- So the boundary becomes explicit instead of a workaround: `animation.correct` receives **models**, `{ draft(): Model; settled(): Model }`, from the Editor (both from `modelOf`, the second of `this.view()`), and calls `evaluate` itself. It no longer receives a `posed` result.
- `evaluate` throws a typed `PoseNotFinite` error (with the scalar it names) instead of a plain `Error`. `correct` turns only that class into a refusal: `pose-not-finite` before the write, `correction-not-finite` after it. `Core.atPose` turns it into a `pose-not-finite` refusal too, the same class of gap swept where it appears (dot 1791693222: no catch-all).

### 7b. Row 14 (`edgeValue` repeats `evaluate`'s on-edge sum): close it

- `evaluate` exports `onEdge(knots, t, A, B)`, built from the same summation helper as its blend (zero weights left out, summed from the first term). `animation`'s `edgeValue` is removed.
- A property test checks that `evaluate(model, pose)` at a pose on each of the 12 edges equals `onEdge` bit for bit (dyadic t, so the pose maps to t exactly), for random knots and values.

## 8. Declaration

`correct` changes from package 3's to:
- reads `settled-trial` (the final check reads the settled trial; A, B and r are read from the draft, which equals the published geometry since it stands alone);
- intents and shapes: a new range `front-neighbours`, the four views next to the front ((±90, 0), (0, ±45)): the only views O can be. That at most one of them changes is not something the declaration checks; the final check (§5) does;
- records `false`; shared `animation`;
- `autoStructure: false`, `settle: 'non-front-positions'` (the 'views' mode), alone.

A correction that moves nothing still runs the 'views' settle, which changes nothing (I5).

## 9. Not in package 4

- No bench or interaction (package 5).
- No move for edges that do not start at the front, and no corner move.
- No smooth-join re-alignment at the pose (slot B).
- Corrections inside a cell (later, open item 6 of the plan).

## 10. Self-review while dot reviews `8fcf3f6`

Found by attacking the plan on dot's three questions (dot 1791694328); §4 and §5 above are amended accordingly.

1. **Where "minimal" holds** (at r = 0 there are two optima; the branch is chosen by r's sign, dot 1791694376, 1791694778): per control and axis, over w ≠ 0, with nothing else in the cost. It is not a minimum over the whole correction: the protected knots (§4) are checked after the solve, not part of the minimisation. So if the chosen B′ lands exactly on a corner value C where an old target differs, the correction is refused (`correction-breaks-target`) although a slightly different w would have kept it. This happens only when B′ === C exactly; it is refused, not searched around. Linked members are solved once each; members whose c differs (I4) are refused by I3's check, so a component never has two answers.
2. **The front → O knots** are re-solved by the general formula from the value `onEdge` recorded, not set to 0 (§4). dot's example (1791694396): A = B = 1 and an old knot r = 1e16 show 0, not 1; setting it to 0 would show 1 and lose the target. The re-solve gives exactly 0 only when the recorded value is exactly A.
3. **Settled values:** the protected knots are re-solved against O's settled values, and the moved controls in O are checked within tolerance (§4, §5). Order inside `correct`: checks and solve from the draft → write O's moves → settle the trial → re-solve the protected knots from the trial's O → write all knots → settle the trial again → final check. Both trials are the same pure function of the draft (`view()`), and the commit's 'views' settle gives the same O. The knots do not change positions, so the second trial's O equals the first's.
4. **What the trial settles that the commit does not:** `view()` settles every view by positions, the front included; the commit's 'views' mode does not settle the front. They agree because `correct` leaves no target, hold or touch in the front, and the settle skips a layer the edit did not act on (I5, as corrected by dot 1791694500). The final check compares the front with its value on entry exactly, so a difference would refuse rather than pass silently.
