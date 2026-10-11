# Stage 3b, package 3: the correction on an edge (`correct`) — rules and read / write flow

**Status:** for dot's check (dot 1791691047: rules and read / write flow first). Nothing is coded until this passes.

**Scope and what is not claimed:**
- **On the edges between neighbouring views only.** bowen has not yet confirmed that this round is edges only (asked 1791687531, 1791688562). Package 3 builds the edge case, which is needed in any answer. It does **not** deliver corrections "at any angle": inside a cell nothing can be corrected directly yet.
- **No view moves.** Anything a response alone cannot reach is refused (`correction-axis-fixed`). The outer view's minimal move is package 4, after its cost is argued (open item 4 of `docs/stage3b-correction-plan.md`).
- **No bench or interaction** (package 5).
- **Smooth joins are not re-aligned at the pose** (slot B stays a placeholder).

**Ledger check:**
- Row 9 is not triggered: a correction changes geometry, not appearance.
- No other row is triggered: the declaration table (row 1, closed) is used as it is.

## 1. The operation

`Editor.correct(pose, targets)`, one call per edit (alone).

- **`pose`:** `{ yaw, pitch }`, exactly on one of the 12 edges, **not** at a view:
  - yaw ∈ {0, ±90} with 0 < |pitch| < 45, or pitch ∈ {0, ±45} with 0 < |yaw| < 90;
  - the edge and the progress t along it (inner → outer) follow from the pose: t = |yaw| / 90 on a yaw edge, |pitch| / 45 on a pitch edge.
  - Refused:
    - at a view (`correction-at-view`: there you edit the view itself);
    - inside a cell (`correction-off-edge`, this round's scope);
    - outside the domain (`pose-out-of-range`).
- **`targets`:** `{ points?: { id, position }[], handles?: { line, end, vector }[] }`: the positions and handle vectors as dragged at the pose. Controls not given are unchanged.
  - Refused: an unknown id, a duplicate, an end other than a / b, a non-finite number (`correction-bad-target`).

## 1a. The order of the steps (dot 1791691213)

1. **Explicit targets:** the points and handle vectors given, checked as in §1.
2. **Link expansion:** each given point stands for its whole link component (§3). The **target set** is every member of every component touched. Two members of one component given different targets are refused (`correction-link-conflict`).
3. **Checks on the full target set:**
   - locks (§4) are checked for every point and handle in the target set, members reached only through a link included;
   - the axis cases of §2 run for every control in the target set.
4. **One solve:** the knots of the whole target set are computed from the draft as read before any write, then written in one step.
5. **The final check** (§5) uses the same target set:
   - its members must equal their targets;
   - everything outside it must be unchanged, including points not reached by the expansion and the handle vectors of every line not given.

Every later section uses "the target set" in this sense.

## 2. Per control and axis

A and B are the control's values on that axis in the edge's inner and outer views. r is its current response there, and p = (1 − r(t))·A + r(t)·B is its current value at the pose (what `evaluate` gives on an edge). q is the target.

1. **Already met:** `q === p` (exact, the value the pose already shows): nothing is written for this axis, and no view moves (dot 1791687532).
2. **Reachable by the response:** `B ≠ A`.
   - **The knot value is solved without intermediate overflow** (dot 1791691300): with s = max(|A|, |B|, |q|), `w = (q/s − A/s) / (B/s − A/s)`. Example: A = −1e308, B = 1e308, q = 0 gives w = 0.5, which `evaluate` turns into exactly 0. A plain `(q − A)/(B − A)` overflows to 0 there, and the case must not be reported as unreachable or as a tiny span.
   - If w is not finite, the correction is refused (`correction-not-finite`).
   - Whether w really reaches q is decided by the final check (§5), never by this formula.
   - Otherwise the knot `[t, w]` is inserted, replacing a knot at exactly t. Every other knot stays, so every protected target on this edge keeps its coordinate.
   - More than 256 knots refuses (`correction-too-many-knots`).
3. **Not reachable:** `B === A` and `q ≠ p`: refused (`correction-axis-fixed`, naming the control, the axis and the edge), until package 4.

## 3. Linked points

- A target for one point is a target for its whole link component: every member joins the target set (§1a).
  - The members coincide in every view and hold identical response sets (package 2's rule), so A, B, r and the solve are the same.
  - The same knot is written to every member, so the sets stay identical.
- Two members of one component given different targets refuse (`correction-link-conflict`).

## 4. Locks

A target in the **target set** (§1a) on a locked line is refused (`locked`, naming the line): for a point, any line ending there; for a handle, its line. This covers a member reached only through a link: dragging A refuses when its linked B ends a locked line. A correction changes that line's in-between shape.

*This is one small rule, not a new lock design (bowen 1791651929: locks "代码写到哪就到哪"). If bowen or dot prefers no lock check here, it is dropped.*

## 5. The final check

The correction is solved, the knots are written to the draft's `animation`, and then the draft is evaluated at the pose and at every protected target on that edge. No view moves in package 3, so there is nothing to settle.

| Control | Must hold |
|---|---|
| a control in the target set (given, or reached through a link), each axis | equals its target within **1e-9 · max(1, \|q\|)**: the target's own scale only (dot 1791691300). The views' coordinates may be used to analyse the numbers but never widen what counts as reached. |
| any control outside the target set (points not reached; every handle vector not given) | equals its value before the edit, exactly |
| every protected target on the edge (every knot of every control there) | its coordinate unchanged, exactly, except the knots written now |

Anything else refuses the whole edit (`correction-not-reproduced`, naming the control). This is the check package 4 will need when a view moves. Here it guards the solve and the write, and it is where a target the numbers cannot represent is refused. Example: A = −1e12, B = 1e12, q = 0.00001. w rounds to exactly 0.5, the pose stays at 0, and 0.00001 is not reached: refused, not counted as done. The guarantee is "reached reliably, or refused explicitly", not arbitrary precision.

## 6. Declaration and transaction

`correct` declares:
- reads the `draft` (its geometry equals the published state, since it stands alone);
- intents `none`, shapes `none`, records `false`;
- shared `animation`;
- `autoStructure: false`, `settle: 'none'`, alone.

So the merged commit is today's `keeps`: no settle. Only selections and stroke broadcasts may share its edit (`stage2-alone` as for the stage-2 operations). One edit is one undo step.

## 7. Read and write paths

| What | Read from | Written to |
|---|---|---|
| A, B per control and axis | the draft's inner and outer view (`net.of(draft, inner / outer)`) | — |
| r (current response) | the draft's `animation` | — |
| locks, link components | the draft's network and links | — |
| knots | — | the draft's `animation`, every member of a link component (`animation.setKnot`) |
| final check | `evaluate(modelOf(draft))` at the pose and at each protected target, against the same before the write | — |
| undo | the state stack | — |

## 8. Tests (package 3)

- **Pose:**
  - each of the 12 edges at an interior progress works;
  - at a view → `correction-at-view`;
  - inside a cell → `correction-off-edge`;
  - out of range → `pose-out-of-range`.
- **Steps 1–3:**
  - already met writes nothing (an axis not dragged, an outer edge with equal views and an undragged axis);
  - reachable: the knot value, the result at the pose equals the target;
  - a second correction at another t on the same edge keeps the first's coordinate;
  - a correction at the same t replaces the knot;
  - equal views and a dragged axis → `correction-axis-fixed`;
  - a tiny span giving a non-finite w → `correction-not-finite`;
  - 256 + 1 → `correction-too-many-knots`.
- **Handles:** a handle vector target, both ends.
- **Numbers** (dot 1791691300):
  - A = −1e308, B = 1e308, q = 0 → w = 0.5, and the pose shows exactly 0;
  - A = −1e12, B = 1e12, q = 1e-5 → `correction-not-reproduced` (the drag cannot be represented), the state unchanged;
  - the tolerance follows the target: a small q is held to a small absolute error even next to huge view coordinates.
- **Links:**
  - a target on one member writes all members, which stay identical and evaluate bit-identically;
  - the member reached through the link counts as a target in the final check, not as "unchanged";
  - only A given, its linked B ending a locked line → `locked` (naming B's line);
  - conflicting targets → `correction-link-conflict`;
  - a point not reached and the handle vectors not given stay exactly as they were.
- **Locks:** a target on a locked line, through a point and through a handle → `locked`.
- **Final check:** other controls unchanged at the pose; every protected target on the edge unchanged.
- **Transaction:**
  - alone (with a move → `stage2-alone`; with a select → allowed);
  - one undo step restores the responses;
  - the effects table declares `correct`, and the per-operation write test covers it;
  - nothing else changes (views, records, structure).
- **Bad targets:** unknown id, duplicate, bad end, non-finite → `correction-bad-target`.
