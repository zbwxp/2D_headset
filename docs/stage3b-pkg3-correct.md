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

## 2. Per control and axis

A and B are the control's values on that axis in the edge's inner and outer views. r is its current response there, and p = (1 − r(t))·A + r(t)·B is its current value at the pose (what `evaluate` gives on an edge). q is the target.

1. **Already met:** `q === p` (exact, the value the pose already shows): nothing is written for this axis, and no view moves (dot 1791687532).
2. **Reachable by the response:** `B ≠ A`.
   - The knot value is `w = (q − A) / (B − A)`.
   - If w is not finite (a tiny span), the correction is refused (`correction-not-finite`).
   - Otherwise the knot `[t, w]` is inserted, replacing a knot at exactly t. Every other knot stays, so every protected target on this edge keeps its coordinate.
   - More than 256 knots refuses (`correction-too-many-knots`).
3. **Not reachable:** `B === A` and `q ≠ p`: refused (`correction-axis-fixed`, naming the control, the axis and the edge), until package 4.

## 3. Linked points

- A target for one point is a target for its whole link component.
  - The members coincide in every view and hold identical response sets (package 2's rule), so A, B, r and the solve are the same.
  - The same knot is written to every member, so the sets stay identical.
- Two members of one component given different targets refuse (`correction-link-conflict`).

## 4. Locks

A target on a locked line is refused (`locked`, naming the line): for a point, any line ending there; for a handle, its line. A correction changes that line's in-between shape.

*This is one small rule, not a new lock design (bowen 1791651929: locks "代码写到哪就到哪"). If bowen or dot prefers no lock check here, it is dropped.*

## 5. The final check

The correction is solved, the knots are written to the draft's `animation`, and then the draft is evaluated at the pose and at every protected target on that edge. No view moves in package 3, so there is nothing to settle.

| Control | Must hold |
|---|---|
| a dragged control, each axis | equals its target within 1e-9 · max(1, \|A\|, \|B\|, \|q\|) |
| any other control | equals its value before the edit, exactly |
| every protected target on the edge (every knot of every control there) | its coordinate unchanged, exactly, except the knots written now |

Anything else refuses the whole edit (`correction-not-reproduced`, naming the control). This is the check package 4 will need when a view moves. Here it guards the solve and the write.

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
- **Links:**
  - a target on one member writes all members, which stay identical and evaluate bit-identically;
  - conflicting targets → `correction-link-conflict`.
- **Locks:** a target on a locked line, through a point and through a handle → `locked`.
- **Final check:** other controls unchanged at the pose; every protected target on the edge unchanged.
- **Transaction:**
  - alone (with a move → `stage2-alone`; with a select → allowed);
  - one undo step restores the responses;
  - the effects table declares `correct`, and the per-operation write test covers it;
  - nothing else changes (views, records, structure).
- **Bad targets:** unknown id, duplicate, bad end, non-finite → `correction-bad-target`.
