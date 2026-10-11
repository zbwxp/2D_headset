# Stage 3b: in-between correction (插帧) — direction and rules, before code

**Status:** first draft. Three direction questions go to bowen (§1); the rules (§2–§7) are proposals for dot's check. Nothing is coded until both pass.

**Ledger check** (`docs/consolidation-ledger.md`):
- **Row 1 is triggered:** a correction is a new edit whose settling is neither "full" nor any stage-2 mode. 3b consolidates it first (§6): operations declare their effects, the transaction checks and merges them, a missing declaration is an error.
- **Row 4** (dead `ops` field) is removed with it.
- **Row 3** (link creation vs `base:angle`) and a new link rule for responses meet here (§5): linked points must share their in-between behaviour.
- **Row 9** (slots A / B) is untouched: a correction changes geometry only.

## Inputs

- **bowen:**
  - between two views the change can be made non-linear, at any angle bowen moves to, not only 30° / 60°;
  - 0° never moves; 90° may move minimally, and that moves its view;
  - 乙 (1791651929): the 90° move takes effect at once; undo reverts it with the response change in one step;
  - the focus is the framework of the multi-view editor, 插帧 and the expression editor (1791684361).
- **Architecture** (`docs/architecture-multiview.md` §6): corrections are solved back, not separate snapshots; endpoints are penalised more than handles (a weighting, not a ban); responses are `animation` data and `evaluate` reads them.
- **v103 for reference** (7205381, read with `git show`, not run):
  - **What could be done at a correction angle:** drag nodes and handles (A tool), transform strokes (V), or edit through a temporary cage. Topology, strokes and fills could not be edited there (`SnapshotRecordingWorkspace.tsx:146, 228`).
  - **The solve:**
    - per control (node / handle vector H−P), per axis (x / y), independently;
    - a pose on a mesh edge inserts one knot `[progress, weight]` into that edge's piecewise-linear response, replacing a knot at the same progress (`surfaceTargets.ts:281-290`);
    - a pose inside a triangle stores an interior sample instead (`:291-302`);
    - the result is replayed and must match within 1e-7 (`:305-312`).
  - **Unreachable axis** (the two views equal on that axis, `SURFACE_AXIS_UNAVAILABLE`):
    - the fallback is only on edges between 0,0 and a cardinal ±90 view, and only the ±90 view moves (`surfaceBasisFallback.ts:45-52`);
    - it minimises (penalty 16 per node delta², 1 per handle delta², 0.005 per response change², with curve-sample rows), within a trust radius of ±8 on the response and an extent bound on the move, by coordinate descent: "a local minimum, not global" (`boundedBasisInverse.ts`);
    - earlier calibrated angles are re-solved and protected.
  - **Commit:** live preview while dragging; the release writes a *draft*; explicit Save / Discard; one undo step per release, the moved 90° view included (`store.ts:314`; `minchange-inverse-workflow.test.ts:154-159`).
  - **Refused at a correction angle:** topology, join mode, arc radius (`SURFACE_ARC_BASIS_REQUIRED`), a real view's own angle (`SURFACE_CORRECTION_REQUIRES_INTERIOR`), locked objects.
  - **Structure:**
    - a split converts the parent's responses into expressions on the seam node and child handles (de Casteljau, `responseExpressionSplit.ts`);
    - delete removes or archives;
    - bind looks up the link component's authority (minimum id);
    - a new line has no response (linear).

## 1. Direction questions for bowen

1. **Where can a correction be made?**
   - **甲 (proposal):** on the lines between two neighbouring views, e.g. yaw 30 pitch 0, or yaw 90 pitch 20 — every 30° / 60° case bowen named. Inside a cell (e.g. yaw 30 pitch 20) the result follows from the four lines around it; correcting there directly comes later.
   - 乙: anywhere, inside cells too (v103 had both, with a different rule for each).
2. **Does a correction need a Save button?**
   - **甲 (proposal):** no. Each release is one edit and one undo step, like any drag. This is what bowen chose for the 90° move (乙, 1791651929), applied to the whole correction.
   - 乙: as v103, a draft with explicit Save / Discard.
3. **When something cannot bend because it is the same at 0° and 90°** (e.g. a point that does not move between front and side), the 90° view has to move. How much?
   - **甲 (proposal, simplest):** the in-between curve keeps its shape and the 90° view moves by whatever the target needs. Correcting close to 0° then moves 90° a lot (about 1 / progress times the drag).
   - 乙: as v103, balance the two: the 90° view moves less, the in-between curve bends more, within a limit.
   - Either way 0° never moves, and only views touching the front may be moved this way (as v103: front ↔ ±90 yaw, front ↔ ±45 pitch); elsewhere the correction is refused with the reason.

## 2. The data: responses (owner `animation`)

- **A response** belongs to one control (a point, or one end's handle vector), one axis (x / y) and one edge of the view grid (the 12 edges between neighbouring views).
- **Its form** (as v103): a list of knots `[progress, value]`, progress strictly inside (0, 1), piecewise linear, pinned at (0, 0) and (1, 1), values not clamped. No response means linear. Progress runs from the view nearer the front to the outer one.
- **Stored** as a new part of the document state, `animation`, saved in the file. Archive format 4 (§7, open item 1).
- **Limits:** at most 256 knots per response (as v103), refused beyond.

## 3. Evaluate with responses

- **On an edge** between views A (inner) and B (outer), at progress t, a scalar is `A + r(t)·(B − A)`, where r is that control's response on that edge for that axis.
- **Inside a cell** (bilinear, 3a rule 2), each control and axis uses responded coordinates:
  `u' = (1 − v)·r_bottom(u) + v·r_top(u)`, `v' = (1 − u)·s_left(v) + u·s_right(v)`, then the bilinear formula with u', v'.
  On an edge this is exactly the edge rule. At the four views it is exact. Neighbouring cells share their edge, so it stays continuous.
- `evaluate`'s input gains the responses. 3a's tests still hold where there are none.

## 4. The correction (`Editor.correct(pose, targets)`)

- **Where:** a pose exactly on an edge (answer to Q1), not at a view (there you edit the view itself).
- **What:** target positions for points and target vectors for handles, as dragged at the pose. Anything not given is unchanged.
- **Per control and axis**, with A, B the edge's two views and t the progress:
  - if `|B − A| > ε`: insert the knot `[t, (q − A) / (B − A)]`, replacing a knot at exactly t; all other knots stay, so every angle corrected before keeps its value;
  - else the axis cannot bend, and the 90° rule applies (answer to Q3). On an edge not touching the front it is refused (`correction-axis-fixed`, naming the control, the axis and the edge).
- **Linked points** move together: a target for one point is a target for its whole link component (§5).
- **Smooth joins:** nothing is re-aligned at the pose (slot B is a placeholder). Only the dragged controls change.
- **Refused:**
  - at a view, or off an edge (Q1);
  - a pose outside the domain;
  - a target on a locked line;
  - anything other than point / handle targets (topology, join modes, radii, strokes);
  - more than 256 knots;
  - the result not reproduced at the pose within 1e-9 (replay check, as v103).
- **One edit, one undo step:** the responses and any moved 90° view together (bowen 乙).

## 5. Responses through structural edits (`animation.follow`)

| Edit | Responses (proposal) |
|---|---|
| new line | none: linear |
| delete | the deleted controls' responses go |
| bind | the kept point keeps its own; the removed one's go (step-2 rule: bind keeps the first point) |
| unbind | the new point copies the old point's |
| split | **open item 2:** exact carrying needs v103's expression machinery. Proposal for 3b: a split of a line whose ends or handles have responses is refused (`split-has-responses`) with the reason, rather than silently changing tuned in-betweens (dot 1791652021) |
| link | **open item 3:** linked points must share their responses, or they separate between views. Proposal: the link component holds one response set; creating a link between points whose responses differ is refused (`link-responses-differ`) |
| paste | the clip carries the copied controls' responses, mapped to the new ids (as `base:angle`) |
| broadcast / fit / draft | responses unchanged: they are progress, so they follow the new views |

## 6. Ledger row 1: operations declare their effects

- **Every Editor operation declares,** next to its definition, in one table:
  - which layers it writes geometry into: none / the edited view / other views / records;
  - whether it changes structure;
  - whether it must stand alone in its edit (it reads the draft as settled).
- **The transaction** checks the calls against the table and merges them into one settle:
  - structure or the edited view written → full settle (today's `full`);
  - only other views written → those views by positions only, front not settled (today's `views`);
  - only records, selections or strokes → no geometric settle (today's `keeps`);
  - two "alone" operations, or one with anything but selections and stroke broadcasts → `stage2-alone` as today.
- **An operation with no declaration** refuses the edit (`undeclared-operation`). A test enumerates every Editor method and requires a declaration, so a new operation cannot be forgotten.
- **Behaviour does not change:** every existing test passes unchanged, and the dead `ops` field goes (row 4).
- **`correct`** declares: writes records (responses), may write one outer view (positions, handles), stands alone; settle: that view by positions only, then the replay check.

## 7. Open items for dot

1. **Archive format 4:** opening a format-3 file as format 4 with no responses is a migration. Refuse as before (bowen redraws), or accept 3 → 4 as "no responses"?
2. Split with responses: refuse in 3b (proposal) or carry them (v103's expressions).
3. Links and responses: one response set per link component, and refusing links whose responses differ.
4. Order of packages (proposal):
   - **1:** ledger row 1, the declarations, no behaviour change;
   - **2:** responses as data, `follow`, archive, evaluate with responses;
   - **3:** `correct` on edges (without the 90° fallback);
   - **4:** the 90° fallback (after bowen's Q3);
   - **5:** bench: drag at a pose in playback.
