# Stage 3b: in-between correction (插帧) — direction and rules, before code

**Status:** second draft, after dot 1791687457, 1791687532, 1791687563. One scope question goes to bowen (§1); the rules (§2–§7) are proposals for dot's check. Nothing is coded until both pass.

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

## 1. Decided, and the one question for bowen

Corrected after dot 1791687457: two of the three first-draft questions re-asked rules that are already decided.

**Already decided (not asked again):**
- **No Save button:** a release takes effect at once; the response change and any 90° move are undone together in one step (bowen 1791651929 乙).
- **The 90° rule** (`docs/architecture-multiview.md` §6, rules of 2026-10-03/04):
  - 0° never moves;
  - first keep 90° fixed and adjust the response;
  - only if the target is still unreachable may 90° move, minimally;
  - end points are penalised more than handles, a weighting, not a ban.

  The algorithm that meets this goal, and the range it can reach, are ours to argue (§4a, open item 4). The first draft's "keep the response, move 90° by whatever is needed" is withdrawn: it does not minimise the move and is not the decided goal.

**The one question for bowen: a narrower scope for this round.**
- bowen decided that corrections are made "at any angle bowen moves to".
- **Proposal for 3b:** open corrections only on the lines between two neighbouring views (e.g. yaw 30 pitch 0, yaw 90 pitch 20), which covers the 30° / 60° cases.
- **Not in 3b:** corrections inside a cell (e.g. yaw 30 pitch 20). There the drawing follows from the four lines around it, but it cannot be corrected directly yet.
- This narrows a decided requirement, so it needs bowen's yes. It is not a reinterpretation of "any angle".

## 2. The data: responses (owner `animation`; dot 1791687563)

- **Responses are `animation` state,** a new part of the document state. They are not a shape layer and not a record layer.
- **A response** belongs to one control (a point, or one end's handle vector), one axis (x / y) and one edge of the view grid (the 12 edges between neighbouring views).
- **Form** (as v103):
  - a list of knots `[progress, value]`, progress strictly inside (0, 1);
  - piecewise linear, pinned at (0, 0) and (1, 1);
  - values not clamped, so the curve can overshoot (extrapolate) its ends;
  - no response means linear;
  - progress runs from the view nearer the front to the outer one.
- **What a knot stands for:** each knot is a correction target the user set explicitly. The **protected set** is: that control, that axis, that edge, at that progress, with the coordinate it produced (`A + value·(B − A)`). Protection means these targets, not "every old angle's whole picture stays the same" (dot 1791687563).
- **Linked points:** each point keeps its own response set. Linked points always have *equal* sets (copies), so no response hangs on one representative id that could disappear (§5).
- **Limits:** at most 256 knots per response (as v103); refused beyond.
- **Archive:** format 4 holds the `animation` state. Files of format 3 or older are refused, as decided ("no old-format compatibility"; dot 1791687532). No migration package.

## 3. Evaluate with responses

- **On an edge** between views A (inner) and B (outer), at progress t, a scalar is `A + r(t)·(B − A)`, where r is that control's response on that edge for that axis.
- **Inside a cell** (3a's bilinear, rule 2), each control and axis uses responded coordinates:
  - `u' = (1 − v)·r_bottom(u) + v·r_top(u)`
  - `v' = (1 − u)·s_left(v) + u·s_right(v)`
  - then the bilinear formula with u', v'.
- **What this gives** (dot 1791687563):
  - exact at the nine views;
  - on an edge, exactly the edge rule;
  - continuous across cells (neighbouring cells share their edges, edge orientation fixed as above);
  - unbounded responses may extrapolate; that does not break continuity, and nothing promises the in-between shape looks good.
- `evaluate`'s input type gains the responses; 3a's tests still hold where there are none.

## 4. The correction (`Editor.correct(pose, targets)`)

**Where:** a pose exactly on an edge, within the 3b scope (§1). Not at a view: there you edit the view itself.

**What:** target positions for points and target vectors for handles, as dragged at the pose. Controls not given are unchanged.

**Per control and axis.** A and B are the edge's two views, t the progress, q the target, p the current value `A + r(t)(B − A)`.
1. **Already met:** if `|q − p| ≤ ε`, nothing changes for this axis: no knot, no view move (dot 1791687532). Example: on an outer edge both views have y = 0 and the drag is along x only. The y target is 0, so y stays as it is, neither refused nor moving a view.
2. **Reachable by the response:** if `|B − A| > ε`, insert the knot `[t, (q − A) / (B − A)]`, replacing a knot at exactly t. Every other knot stays, so every protected target on this edge keeps its coordinate.
3. **Not reachable by the response alone:**
   - on an edge touching the front, the decided 90° rule applies (§4a);
   - elsewhere refuse with `correction-axis-fixed`, naming the control, the axis and the edge.

**4a. When the outer view must move** (the decided goal: 0° fixed; responses first; 90° only if needed and minimally; end points cost more than handles).
- **Which view:** only the outer view of an edge touching the front moves (front ↔ ±90 yaw, front ↔ ±45 pitch), and only for the controls and axes that step 3 could not reach.
- **Every protected target on every edge that view touches is re-solved** (dot 1791687532). Moving the outer view changes the coordinate a kept knot produces on its other edges.
  - Example: front and side both have 0 on an axis, and the upper corner has 10. The side → corner midpoint was corrected to 5. Moving the side to 4 to fix the front → side midpoint would turn that 5 into 7.
  - So each such knot is re-solved to keep its coordinate: `r' = (target − A') / (B' − A')` with the moved view's new value.
  - If on some edge the two views become equal on that axis: when the old target equals that common value it is still met (no change); only a different target makes the whole correction refused (`correction-breaks-target`, naming the target) (dot 1791687776).
- **The cost must have a real minimum** (dot 1791687563). Minimising only the view's move has none: the response can grow without bound while the move tends to 0. So the response change is bounded, or penalised, or both. v103 did both:
  - penalty 0.005 on the response change;
  - trust radius ±8 around the old response;
  - node delta² weighted 16, handle delta² weighted 1;
  - sampled curve rows;
  - an extent bound on the move.

  The concrete cost and its reachable range are open item 4, argued before package 4. Package 3 ships steps 1–2 and refuses step 3 with `correction-axis-fixed` everywhere until then.
- **Undo:** one edit, one undo step for the responses and the moved view together (bowen 1791651929 乙).

**Four things the correction keeps apart** (dot 1791687563):
1. **Response writes:** knots in the `animation` state.
2. **Geometric intents:** the outer view's moves, through that view's own `net.move` / `net.moveHandle`, so links and springs see them.
3. **Settle authority:** that view by positions only; no auto-bind anywhere; the front never settled (§6).
4. **Final check:** after the settle, with the moved view's *settled* values (springs and links may have changed controls nobody dragged), for every control on the edges that view touches, not only the dragged ones (dot 1791687776):
   - at the pose, a dragged control equals its target, and every other control equals its value before the edit;
   - every protected target on those edges keeps its coordinate.

   Each must match within 1e-9, or the whole edit is refused (`correction-not-reproduced`, naming the control and target). Acceptance tests check all of them, not only the edited angle and the dragged controls.

**Linked points:** a target for one point is a target for its whole link component. Every member gets the same knots (§5). In every view the members coincide, so their A, B and the solve are the same.

**Smooth joins:** nothing is re-aligned at the pose (slot B is a placeholder); only the dragged controls change.

**Refused:**
- at a view, or off an edge (the 3b scope);
- a pose outside the domain;
- a target on a locked line;
- anything other than point / handle targets (topology, join modes, radii, strokes);
- more than 256 knots;
- `correction-axis-fixed`, `correction-breaks-target`, `correction-not-reproduced`.

## 5. Responses through structural edits (`animation.follow`)

One rule set, used by every path that changes structure, auto-bind included (dot 1791687563).

| Edit | Responses |
|---|---|
| new line | only the **new** points and the new line's handles start without responses (linear); an **existing** end point the line borrows keeps its responses (the same boundary as `base:angle`; dot 1791687776) |
| delete a line | its handles' responses go; its end points' go with the points when they go |
| bind (explicit or auto-bind) | follows the existing result (dot 1791687873): the removed point is a deleted point, and `links.update` drops its links, so the kept point does **not** join the removed point's link component. The kept point keeps its own set; the removed point's set goes with it, as its position does. No new constraint and no response check |
| unbind | the new point copies the old point's set |
| split | refused when the split line's end points or handles have responses (`split-has-responses`): exact carrying is not possible with this data, and a copied curve must not pose as shape-preserving (dot 1791687532) |
| link | allowed only when the two points' sets **behave** the same; otherwise refused (`link-responses-differ`), so a second point's tuned in-betweens are never overwritten silently (dot 1791687776). "The same" is judged by behaviour: no response and an explicit linear one (knots on the diagonal) are equal; two sets are compared as functions at the union of their knots. A "reset to the first point's" operation, if wanted later, is defined separately |
| unlink | each point keeps its copy |
| delete one member of a link component | the others keep their copies; nothing is lost with it |
| paste / copy part of a link component | each pasted point gets a copy of its source point's set, mapped to the new ids, as `base:angle` |
| broadcast / fit / draft | responses unchanged: they are progress, so they follow the new views |

The tests walk each row, including a component whose first-made point is deleted.

## 6. Ledger row 1: operations declare their effects (package 1, no behaviour change)

**Each Editor operation declares, in one table next to the operations:**

| Field | Values | Meaning |
|---|---|---|
| reads | `draft` / `settled-trial`, possibly depending on the call's arguments | which version it reads: the edit's draft as written, or the scratch copy with every view's positions settled (`this.view()`). A declaration may be a function of the arguments: `line` reads the draft when handles are given and the settled trial otherwise (dot 1791687873). No operation reads the published state: broadcast, fit and the draft read the **draft's geometry**, which the allowed companions (selections, stroke broadcasts) leave unchanged. A selection before them is read from the current draft, as written |
| writes | geometry layers (`edited` / `other-views` / `none`), structure (yes / no), records, animation | where it writes |
| autoStructure | `edited-view` / `none` | whether the commit may auto-bind in the edited view because of it |
| settle | `full` / `non-front-positions` / `none` | which position settling it needs |
| alone | yes / no | whether it must stand alone in its edit |

**The transaction:**
- **checks each call when it is made**, inside the method wrapper, which already marks the whole edit failed even if the callback catches the throw. An operation with no declaration throws `undeclared-operation`, so the edit fails and nothing written before it is published (dot 1791687563);
- **checks the geometric intents at commit, and only claims that** (a limited guarantee, dot 1791687873, 1791687901):
  - the layers that hold this edit's geometric intents (`targets`, `held`, `handleTips` carry their layer) must be within the union of the calls' declared geometry layers, else `undeclared-write`;
  - the check runs on the intents the operations recorded, **before** the commit's settle. What the settle then changes (auto-bind, springs, links, mirror at the front, positions in other views) is authorised by the merged `autoStructure` / `settle` rules, not by the operation's write declaration, and is never refused by it;
  - it does **not** cover writes made without intents: lines added or split write every layer's shapes directly; fit and broadcast write `base:angle` directly; strokes, radii and end strokes are written as slots. The commit does not claim to detect these. A write cancelled out within the edit leaves no net change and is not claimed detected either;
  - those direct writes are covered by **tests, one per operation**: run the operation alone in a small document and compare the state just before the commit's settle with the published state. The changed shape layers, records and shared parts must match the declaration;
- *(withdrawn: the first idea of comparing all content at commit, c87aa89. It mixed direct writes with settle effects, dot 1791687901.)*
- **merges explicitly:**
  - `autoStructure`: any call with `edited-view` → auto-bind in the edited view;
  - `settle`: `full` if any call needs it, else `non-front-positions` if any, else `none`;
  - `alone`: two alone calls, or an alone call with anything other than `select` / `selectGroup` / `broadcastStroke` → `stage2-alone`, as today.

  None of these is guessed from whether a written layer happens to equal the edited one. A diagonal draft run *in* a corner view stays `non-front-positions` with no auto-bind (dot 1791687532).

**Today's behaviour, operation by operation (the table must reproduce it exactly):**

| Today's mode | Operations |
|---|---|
| no geometric settle (`keeps`) when the edit holds only these | `select`, `selectGroup`, `broadcastStroke`, `fit` |
| `views`: non-front views by positions, no auto-bind, front not settled; alone | `broadcastShape`, `draftCorners` (`fit` is also alone) |
| `full`: edited view fully (auto-bind there), other views by positions | every other operation, *including* renames (`renameLayer`, `renameLine`, `renameGroup`), `layerType`, visibility and lock states (`lineState`, `fillState`, `groupState`, `layerState`, `layerFills`), `lineStroke`, `stroke`, `endStroke`, fill colour and order, layer order, joins and links, transforms, mirror operations, `deleteSelection`; and **an empty edit** (no calls) |

- **Reads today:**
  - `settled-trial`: `copyLayer`, `line`, `mergePosition`, `split`, `unbind`, `link`, `transform` (and through it `translate`, `rotate`, `scale`), `flip`, `deleteSelection`, `mirrorApply`, `mirrorLink`;
  - `draft`, geometry equal to the published state by the alone rule: `broadcastShape`, `draftCorners`, `fit`;
  - every other operation reads the `draft`.
- **Nested calls** (e.g. `paste` calls `select`, `stroke` calls `lineStroke`) are recorded as calls too, as today, and merged the same way.
- **Unchanged on purpose:** a stroke edit or a rename still triggers the full settle, and an empty edit still does, auto-bind included. Changing that is a separate proposal (ledger row 7), not part of this package (dot 1791687532).
- **The dead `ops` field goes** (ledger row 4).
- **Tests:**
  - every existing test passes unchanged;
  - a test enumerates every Editor method and requires a declaration;
  - an undeclared method fails the edit even when the callback catches;
  - an operation that writes outside its declaration is refused;
  - a draft in a corner view does not auto-bind.

**Package 1 scope (revised for dot):**
- **In:**
  - the declaration table for every Editor operation, five fields, `reads` possibly a function of the arguments;
  - the wrapper check at call time (`undeclared-operation` fails the whole edit even if caught);
  - the merge into today's three settle modes, reproducing them exactly, the alone rule included;
  - the intent-scope check before the settle (`undeclared-write`, intents only);
  - removing the dead `ops` field (ledger row 4).
- **Tests:**
  - every existing test unchanged;
  - an enumeration test (every Editor method declared);
  - an undeclared method fails the edit even when the callback catches;
  - an intent outside the declaration is refused (through a test-only narrowed declaration);
  - a draft run in a corner view neither auto-binds nor fully settles;
  - one direct-write test per operation, comparing pre-settle state with the published state against the declaration;
  - a nested call (`paste` → `select`) merges as today.
- **Out:**
  - responses, `correct`, the 90° move;
  - any change to which edits auto-bind (ledger row 7);
  - a full write-tracking system.

**`correct` declares:**
- reads the `draft` (its geometry equals the published state: it stands alone);
- writes animation, and geometry in at most one outer view, chosen at run time and checked against the actual intents;
- `autoStructure: none`;
- `settle`: positions in the layer it wrote only (a new value, `written-positions`);
- alone.

## 7. Open items for dot

1. ~~Archive format 4~~: refused as decided (§2).
2. ~~Split with responses~~: refused in 3b (§5).
3. ~~Link~~: refuse sets that differ in behaviour (dot 1791687776, §5).
4. **The 90° minimal move:** the cost terms (dragged controls only, or the in-between curve's shape too), how the response change is bounded or penalised so a minimum exists, the bounds on the move, and what is reachable. To be argued against the decided goal, not chosen for simplicity. Until then, package 3 refuses step 3.
5. **Order of packages** (proposal):
   - **1:** ledger row 1, the declarations, no behaviour change;
   - **2:** responses as data, `follow`, archive 4, evaluate with responses;
   - **3:** `correct` on edges, steps 1–2, with the full final check;
   - **4:** the 90° minimal move (after item 4);
   - **5:** bench: drag at a pose in playback (after bowen's scope answer).
