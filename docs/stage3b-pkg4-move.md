# Stage 3b, package 4: the outer view's minimal move — rules before code

**Status:** first draft for dot's check (asked by dot 1791693873). No code until dot accepts it. Package 3 is accepted at `d6502dc` (dot 1791693873).

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
  - S = the larger of the x and y extents of all point positions in the front and O, at least 1e-6: the move is measured relative to the drawing's size, so scaling the drawing does not change the answer.
  - k, λ and the floor of S are v103's values (`boundedBasisInverse.ts` at 7205381: `SNAPSHOT_BASIS_NODE_PENALTY = 16`, `SNAPSHOT_BASIS_RESPONSE_PENALTY = .005`; `surfaceBasisFallback.ts` `basisScale`, floor 1e-6). They are tuning constants, kept in one place.
- **The minimum exists and is unique:**
  - f → ∞ as w → 0 (the move grows without bound) and as |w| → ∞ (the response change grows without bound). This is the real minimum dot asked for (dot 1791687563): the response is not free, so the move cannot tend to 0.
  - Setting f′(w) = 0 gives w³ (w − r) = K, with K = k c² / (λ S²) > 0.
  - On w > 0, f decreases then increases, with exactly one stationary point: the root w₊ of w³(w − r) = K on w > max(r, 0) (there w³(w − r) increases from 0 to ∞).
  - On w < 0, likewise exactly one: the root w₋ on w < min(r, 0) (there w³(w − r) decreases from ∞ to 0 as w rises).
  - The answer is the cheaper of w₊ and w₋; a tie goes to w₊. With r ≥ 0, f(a) ≤ f(−a) for every a > 0, so w₊ always wins (tie only at r = 0). So O moves in the direction of the drag, unless the control was earlier corrected to swing behind the front at t (r < 0).
  - Each root is found by bisection on a bracket where w³(w − r) − K changes sign, until the bracket cannot shrink: deterministic, no tolerance chosen by hand.
- **What v103 had that this drops, and why:**
  - its sampled-curve rows (the change of each implicated curve at 9 samples), which couple a curve's points and handles into one non-convex problem solved by coordinate descent, a local solve with no uniqueness claim (v103's own comment). Without them every control and axis is solved alone and the answer is unique, which the tests can pin down;
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

- **On front → O:** every other knot of that axis had value A (A === B); it is re-solved to keep A: [t_k, 0].
- **On O → corner:** each knot is re-solved to keep its value v (read at its recorded t, before the move): w′ = (v − B′)/(C − B′), C the corner's value, with package 3's overflow-free form.
  - If C === B′: when v === B′ the knot is still met and stays as it is; otherwise the whole correction is refused (`correction-breaks-target`, naming the control, edge and t; dot 1791687776).
  - A non-finite w′, or a non-finite value with it, refuses (`correction-not-finite`).
- **Unchanged:** knots of controls that did not move, and every knot on edges without O. Controls without knots on O's edges get a new in-between shape there: that is O moving, which the decided rule allows.
- The re-solved knots keep their t, so the lists stay valid; written in the same step as the new knot.

## 5. The final check (after the settle)

Run on the settled trial (the draft as the commit will settle it), so springs and links in O are included (dot 1791687776):

| What | Must hold |
|---|---|
| at the pose: each control in the target set, each axis | its target, within 1e-9 · max(1, \|q\|) |
| at the pose: every other control | its value before, exactly |
| in O: every control not moved by §3 | its value before, exactly (a spring or link that moved anything else refuses) |
| in O: each moved control and axis | B′, exactly as written |
| every knot on front → O and on O → corners | its value at its recorded t: exactly when not re-solved; within 1e-9 · max(1, \|v\|) when re-solved |
| every knot on every other edge | unchanged (nothing there is written) |
| the front, the other views, `base:angle`, structure | unchanged (declarations and tests) |

Anything else refuses the whole edit (`correction-not-reproduced`, naming the control). One undo step reverts the knots and O.

## 6. The three lists (from the package 3 summary, dot 1791693587)

### 6a. Invariants relied on, where and how strongly each entry enforces them

| Invariant | Commit of an edit | Open (file) | Paste (clip) | Inside an edit, between calls | How the design meets the weakest |
|---|---|---|---|---|---|
| I1 exactly nine views | creation; no operation removes a view | exact (`checkViews`) | cannot add or remove views | as published | relied on as exact |
| I2 knots valid (finite, strictly increasing in (0, 1), ≤ 256) | only `correct` and `follow` write them | exact (`checkResponses`) | exact (clip check) | `correct` is alone | re-solved knots keep their t; values checked finite before writing |
| I3 linked members hold identical response sets | `link` (exact), `correct` (exact) | exact (`canon`) | links are not pasted | `correct` is alone | package 3's check on the sets as they would be written (`correction-link-differs`) |
| I4 linked members coincide in each view | exact only for groups the edit acted on (`links.align`) | within 1e-9 | — | not aligned until the settle | members a hair apart get different c, so different w: refused by I3's check, never written apart. O's move aligns them exactly. |
| I5 every view is settled (settling again changes nothing) | front fully, others by positions | exact (settle-again check) | — | `correct` is alone | the 'views' settle changes nothing outside O; checked in §5 |
| I6 the front and the corners never move | — | — | — | — | declared (§8); `undeclared-write` guards it; tested |

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
| the settled trial (`settleLayerPositions` in O) | springs and links: no throw on finite input | no | internal error |
| `evaluate` after (settled) | `pose-not-finite` | no: every changed value checked before writing | if it happens anyway, `correction-not-finite` naming the control it reports (§7a); other errors stay errors |
| commit | `locked`, `stage2-alone`, `undeclared-write` | yes / yes / declaration bug | as declared |

### 6c. Tests, each through its weakest reachable entry

- **I4, through a file:** linked members 1e-10 apart, a move-case drag → `correction-link-differs`, state unchanged, the file still opens.
- **I5, through a file:** a file-opened drawing with a smooth join and a link in O; a move of a point → only O's moved controls change, every other view byte-identical; a move of a handle whose spring turns its partner → `correction-not-reproduced`.
- **`pose-not-finite` before, through a file:** knots and views that already overflow at the pose → `pose-not-finite` refusal, not a bare error.
- **The cost:** w₊ and w₋ as roots (an independent check of w³(w − r) = K and of f(w₊) ≤ f at nearby w); a point moves less than a handle for the same drag; scaling the whole drawing by 2 gives the same w; r < 0 chooses w₋ when cheaper; r = 0 ties to w₊.
- **The range:** a pitch edge (front → (0, 45)) as well as a yaw edge; an equal axis on an edge not from the front stays `correction-axis-fixed`; an A ≠ B axis never moves O; the other axis of a moved point keeps its value in O.
- **Old targets:** a knot on O → corner is kept after the move (within 1e-9); C === B′ with an equal target is kept, with a different target refuses `correction-breaks-target`; front → O's other knots become 0 and keep A.
- **Numbers:** a drag so large that K overflows → `correction-not-finite`, naming the control; a tiny S (all points coincide) still gives a finite move or a refusal, never a bare error.
- **Transaction:** one undo step reverts knots and O; the front, the corners, the other cardinal views and `base:angle` unchanged; the declaration test covers the move case.
- **Mid-edit:** with a select beside it (allowed) the result is the same as alone.

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
- intents and shapes: a new range `front-neighbours`, the four views next to the front ((±90, 0), (0, ±45)): the only views O can be. One of them at most is written;
- records `false`; shared `animation`;
- `autoStructure: false`, `settle: 'non-front-positions'` (the 'views' mode), alone.

A correction that moves nothing still runs the 'views' settle, which changes nothing (I5).

## 9. Not in package 4

- No bench or interaction (package 5).
- No move for edges that do not start at the front, and no corner move.
- No smooth-join re-alignment at the pose (slot B).
- Corrections inside a cell (later, open item 6 of the plan).
