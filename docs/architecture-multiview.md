# Multi-view architecture (before any code)

**Why this file exists:** bowen 1791650867 / 1791650882 — "现在还不能说代码框架可以建立起来了吧？要坚持住别再最关键的地方变成屎山了". The first stage-1 split (`meta-views-plan.md` §5a) put the nine views into `network`, which already owns the most; it is withdrawn (Claude 1791650945). This file defines the packages, what each owns, the interfaces and dependency direction, and walks every stage's flows on paper.

**Status:** consolidated after dot's attacks 1791651293 and 1791651394. Only the current text counts; no later section corrects an earlier one. Its history is in git and the Slack thread.

**Labels:**
- **decided:** bowen's words, cited.
- *framework choice:* our implementation choice; changeable, and shown to bowen through examples.
- *proposal:* a filled-in default bowen has seen and not objected to.
- *open:* not coded. It belongs to the stage named, and no shared mechanism decides it silently (dot 1791651394).

**Decided inputs:**
- graph tables "Models and 元组件" … "Matching" and row "Names" (headset-design);
- bowen 1791650085 (drawing order shared; stroke per view, with a broadcast button);
- bowen 1791650171 / 1791650206 (stroke broadcast is a plain assignment and a batch edit);
- bowen 1791650323 (binds in all views; auto-bind judged only in the edited view; mirror at 0,0 only);
- bowen 1791650828 (shared topology + per-view data);
- bowen 1791651097 + the rules of 2026-10-03/04 (§6).

## 1. The idea: structure once, shapes in layers

- **Structure (one copy):** layers, points, lines, which line ends at which point, element state, join modes, links, fills, continuous curves, names, order, mirror pairs.
- **Shape layers (several copies):** for every point its position; for every line its two handles and its stroke; for every point its end stroke; for every arc join its radius.

Every shape layer has a **kind**, stored with it in `shapes`. Shared code acts on kinds, never on layer names (dot 1791651293):

| Kind | Layers | Edited by the user | Settle after a change | Checked at open |
|---|---|---|---|---|
| `view` | `view:Y,P` × 9 (stage 1) | yes | full settle (with auto-bind) **only when it is the edit's target**; otherwise positions only (links, springs, tips) | structure, references, links coincide, positions-only settle changes nothing |
| `expression` | `expr:<id>` (stage 4) | yes | positions only; **never auto-bind**, even as the target (closing a mouth may make lip ends meet; binding them would change the whole model) | as `view` |
| `record` | `base:angle` (stage 2), `base:expr` (stage 4) | no | none: records are not drawings | id, data and reference integrity only |

**Structural changes reach every layer through one shared mechanism.**
- A structural change is decided once, on the structure, and applied to each layer **in the same edit**.
- Rules that are the same for every kind:
  - **delete:** removes the entries;
  - **split:** re-expresses each layer's curve at the same t (*proposal*). A record layer keeps its old values re-expressed; it is never updated to the current front.
  - **bind:** each layer keeps the first-clicked point's position (decided, Q1);
  - **unbind:** each layer gets the old position + the same offset (*proposal*).
- **What differs by role is handled by the owner of that role, not by `shapes`:**
  - how a new line initialises each layer: views copy the drawn shape; records start equal to the front; an expression layer gets the line only if the line joins that expression;
  - expression membership;
  - how a paste maps expressions (§4, *open*).

**Single-view algorithms stay single-view:** springs, link alignment, overlap detection, outlines and picking, transforms, mirror correspondence and the lock comparison work on "structure + one shape layer". They are not told how many layers exist.

## 2. Packages and modules

Dependencies point downward only; `test/boundaries.test.ts` enforces them.

```
geometry ← topology ← shapes ← network (façade) ← groups / joins / links / fills ← derived / locks / editing / apply / names ← clipboard
meta      ← topology, names
views     ← network, shapes        (acts on layer kinds; does not know animation's layers)
animation ← views, shapes
document  ← all of the above;   archive ← document
evaluate  ← geometry only           (separate package, like interaction/)
```

**Package 1 — drawing core** (`src/`)
- **`topology`** (new, the structural half of today's `network`):
  - **Owns:** layers (id, name, order), points (id, layer), lines (id, a, b, element state), used ids.
  - **Operations:** add, split, delete, bind, unbind, move to layer, insert, isolated removal; plus linesAt / components / closedWalk / closedLoops.
  - **Each operation returns a complete structural record,** new lines and inserts included (today's `Changes` is partial; dot 1791649528).
- **`shapes`** (new):
  - **Owns:** the shape layers and their kinds.
  - **Applies** a structural record to every layer by the kind-independent rules of §1.
  - **Knows nothing** of views, baselines or expressions beyond the kind.
- **`network`** (becomes a thin façade):
  - `net.of(state, layer)` gives a handle bound to **this state and this layer**. There is no global current view (dot 1791649915).
  - Today's reads and geometry writes act on that layer.
  - A structural call changes `topology` and `shapes` together, in the edit's draft, never one now and the other later (dot 1791651293).
  - Geometric intents (targets, held handles, tips) are recorded per layer (dot 1791650432).
- **`groups`, `joins`, `links`, `fills`, `derived`, `locks`, `editing`, `apply`, `names`, `clipboard`:**
  - they take a layer-bound handle where they read geometry;
  - `joins` keeps the modes; radius and end strokes move to `shapes`;
  - `locks` compares one layer, and the caller loops;
  - `clipboard` carries every layer;
  - `names`: line names unique within their layer; continuous-curve names likewise (*open* until bowen confirms).

**Package 2 — meta structure** (`src/meta`)
- **Its part of the document state:** each layer's 元组件 type. No store outside the document transaction (dot 1791650999).
- **Rules:**
  - 元线条 identity = (layer, line name), kept through renames;
  - lookup by identity;
  - copying a whole 元组件 keeps its line names.

**Package 3 — multi-view editing** (`src/views`)
- **Owns:** the nine view keys and the front (`0,0`).
- **Settle orchestration by kind** (the table in §1): which layers an edit changed, from the per-layer intents and the structural record.
- **Stroke broadcast** (stage 1): assigns the edited view's stroke to the other views for the chosen lines; a batch edit.
- **Diagonal draft** (stage 2): `front + (yaw view − front) + (pitch view − front)` written into a corner view.

**Package 4 — animation making** (`src/animation`)
- **Its part of the document state:**
  - expression definitions (id, name, explicit list of participating lines);
  - which layers are its records and expressions;
  - response curves (stage 3, §6).
- **Rules:**
  - broadcast (stage 2 / 4): `target += front − base` for the chosen lines, then `base := front`. Differences are read from the pre-edit state; a shared end point moves once; baselines are updated together at the end (dot 1791651293).
  - fit: `base := front`.
  - "unbroadcast change" mark: `front ≠ base`.
  - initialising its layers for a new line.
- **`animation.follow(state, record)`:** called by the document pipeline in the same edit, with the structural record. It keeps definitions, memberships and response curves consistent. Its per-curve rules are *open* until stage 3, but the interface exists from stage 1.

**Package 5 — evaluation** (`evaluate/`)
- **Interface:** pure, `evaluate(model, { yaw, pitch, expressions }) → shapes`. Its input is plain data, in a type it defines itself.
- **Angle:** the interpolation scheme is *open*: v103 triangulated the domain; piecewise bilinear over the 3 × 3 grid is a candidate. Response curves are applied as in §6. Decided before stage 3.
- **Expressions:** their difference from the front, carried by the angle level. The carry algorithm is *open* and verified by experiment.

**Package 6 — document and edit transaction** (`src/document`)
- **Owns:** the whole state (topology, shapes, groups, joins, links, fills, selection, apply, names, meta, animation) and undo / redo.
- **`Core.edit(fn, { layer })`:**
  - the target layer is explicit, given by interaction;
  - a multi-view call without a layer is refused;
  - the old single-view entry that today's tests use is a separate, isolated compatibility layer that names `view:0,0` itself (dot 1791650999).
- **Pipeline:**
  1. structural changes (`topology` + `shapes`);
  2. `animation.follow`;
  3. settle by kind (`views`);
  4. names check;
  5. lock check on every `view` and `expression` layer;
  6. publish: one undo step.
- `afterApply`'s scratch settle uses the same orchestration.
- **Reads per layer:** `snapshot(layer)`, `geometry(layer)`, `nearby(layer, …)`.

**Package 7 — file** (`src/archive`):
- Saves structure and every layer.
- Open checks each layer by its kind (§1 table). It triggers no new auto-bind (Q2; dot 1791650402).

**Outside `src/`:** `interaction/` holds the current mode and current layer and passes the layer to each edit. `visual/` and `bench/` are throwaway glue.

**Today's `network` (809 lines)** becomes `topology` + `shapes` + a thin façade. Its rules do not change; its tests rerun through the compatibility entry on `view:0,0`.

## 3. Flows on paper

Each flow: what acts → which layers change → which settle runs.

1. **Draw a line in view 90,0** (stage 1):
   - structure: a new line;
   - views get the drawn shape;
   - full settle on `view:90,0` (a snapped end binds; each layer keeps the first point);
   - positions-only on the other views;
   - locks checked in every view.
2. **Drag a point at the front:** the intent is on `view:0,0` only; full settle there; other layers untouched.
3. **Split in a side view:** every layer re-expressed at the same t; no drawing changes.
4. **Bind in a side view:** in each layer the kept point keeps its position, and the removed point's lines end there with their handle offsets kept. Positions-only settle in the other views.
5. **Delete:** entries leave every layer. Undo restores the whole state.
6. **Paste** (the clip carries every layer): every layer + offset; full settle on the target layer, positions-only elsewhere. Expressions in a clip: §4.
7. **Copy a whole 元组件:** as 6, and `meta` keeps the names and type.
8. **Stroke broadcast** (stage 1): one edit; a locked line refuses it.
9. **Mirror apply at 0,0:** runs on `view:0,0`. Its paired splits / deletes are structural and reach every layer. The stroke and end strokes it copies are front values.
10. **Angle broadcast** (stage 2):
    - `animation` updates the views ≠ front and `base:angle`;
    - positions-only settle on the changed views;
    - the lock check covers every view;
    - repeating with no new change moves nothing.
11. **Fit** (stage 2): only `base:angle`; the picture is unchanged and the offset becomes zero; undo restores the offset.
12. **Diagonal draft** (stage 2): written into a corner view, positions-only settle there.
13. **Expression** (stage 4):
    - the definition lists its lines; the layer starts equal to the front for them;
    - editing it is positions-only, with no auto-bind;
    - structural changes come only from explicit operations.
14. **Expression broadcast** (stage 4): updates the expression layers and `base:expr`. Angle and expression baselines never clear each other.
15. **In-between correction** (stage 3, §6): solve response knots; where needed, move the 90° view minimally; a lock check; one undo step.
16. **Playback** (stage 3 / 4): `evaluate`.
17. **Save, reopen, continue:** each layer is checked by kind; a chance coincidence in a side view stays two points; a broadcast after reopening gives the same result.
18. **Undo of any of these:** the whole state is one draft, so every layer goes back together.

## 4. Open, by stage (not decided by shared mechanisms)

- **Stage 3:**
  - the angle-domain scheme and where response curves live;
  - the response-curve rule on split / bind / new line (§6).
- **Stage 4:**
  - **Expression carry algorithm** (experiment).
  - **Pasting expressions:** a clip carries expression definitions. A target that lacks the expression, or has a different one under the same id, needs a mapping rule. Data in an expression layer is not membership: the definition's list is.
  - **Expression preview** (*framework choice*): expression layers store absolute shapes, so "expression − front" changes as soon as the front is edited, before any broadcast (dot 1791651394). Examples for acceptance, to show bowen:
    1. The front eye is enlarged, not broadcast. Blink plays from the new, larger open eye to the old, smaller closed eye; the eye shows the "unbroadcast change" mark.
    2. After fit: the preview is the same as in example 1, and the mark is cleared.
    3. After expression broadcast: the closed eye has received the same enlargement, and blink is consistent again.
- **Locks** (*proposal*):
  - the shape and stroke of `view` and `expression` layers are protected;
  - a fit on a locked line is allowed, since it changes only a record;
  - the check covers unselected locked lines affected through shared end points and links, per layer.
- **Undo cost:** guarantee whole rollback first; then measure time and memory with real line counts, expression counts and undo depth. No promise, and no new history system up front.

## 5. Build constraints and the first step (dot 1791650999)

1. **No intermediate version loses data.** Saving and the clipboard carry every layer before any multi-view editing entry is public. The old entry never silently saves only the front.
2. **No second state:** every package's data lives in the one document state.
3. **Every new interface names its layer.** The 0,0 compatibility entry is isolated.
4. **Proposals are named before each step.** Lifting old single-view files is a separate decision. Tests of intentionally changed rules (name scope, no auto-bind at open) are updated explicitly; "existing tests pass" covers unchanged rules only.

**Step 1, to be reviewed on its own** (dot 1791651394):
- view definitions;
- `shapes` with layer kinds;
- the state + layer bound accessor.

Tests:
- the old front regression;
- layers never share data;
- documents and trial copies never share data;
- a failed edit rolls back whole.

No multi-view save or copy is exposed in this step. Expressions, broadcast and the in-between correction stay in their own stages.

## 6. In-between correction (bowen 1791650951, 1791651008, 1791651097; rules of 2026-10-03/04 found by dot 1791651254)

**Decided:**
- Between two views the change can be made non-linear, at any angle bowen moves to (not only 30° / 60°).
- The corrections are back-solved, not separate snapshots.
- 0° never moves.
- First keep 90° fixed and adjust the response. Only if the target is still unreachable may 90° move, minimally.
- End points are penalised more than handles: a weighting, not a ban.

**v103 for reference** (7205381, `src/domain/recordingSnapshot/surfaceTargets.ts`, `surfaceBasisFallback.ts`):
- per node and per handle vector, per axis, a response curve on each segment (knots at the edited progress; interior samples in triangles), solved by `solveClosestBarycentricWeights`;
- when an axis cannot move (`SURFACE_AXIS_UNAVAILABLE`), a bounded adjustment moves the ±90° view within a trust radius, as a coupled draft. It was supported only on edges 0° → cardinal ±90°;
- arc radius and join changes are refused in a correction.

**In this framework:**
- Response curves are `animation` data; `evaluate` reads them.
- A correction is an edit: knots are solved; where needed, the 90° view layer moves minimally; a lock check; one undo step.

**Open until stage 3:**
- the per-curve rules in `animation.follow`;
- the angle-domain scheme;
- whether the 90° adjustment stays a "save or discard" draft.

## 7. Unified decision list sent to bowen (Claude, with dot 1791651485, 1791651503)

**Authoritative version: dot 1791651534** (sent at the same time; it carries a recommendation per item, and Claude 1791651556 agrees with all six).
- Its recommendations:
  1. preview, then save the response curves and the 90° change together; cancelling reverts both;
  2. keep the old expression targets, marked "to adapt"; fit does not repair them;
  3. lock protects every view and expression; fit is allowed and undoable;
  4. keep the mirror draft as a one-off batch tool, with no lasting link (it may wait);
  5. curve names unique within their 元组件;
  6. import old files as new nine-view documents, without overwriting; or refuse clearly.
- Its default list adds "no auto-bind when editing expression shapes". Claude adds "new lines and split-off points start with linear response".

**For bowen to choose:**
1. 90° minimal move in an in-between correction: a draft to save or discard (甲, v103), or applied at once and undoable (乙).
2. Expression preview before broadcast (§4 examples): acceptable, or should expressions follow the front automatically?
3. Locks: shape and stroke protected in every view and expression (broadcast included); fit allowed on a locked line.
4. Right-side mirror draft: withdrawn, or a separate whole-view flip tool.
5. Continuous-curve names unique within their 元组件.
6. Old single-view files: lifted to nine equal views, or unsupported.

**Defaults** (not confirmed by bowen; used unless he objects):
- split at the same t in every layer;
- unbind: old position + the same offset;
- link creation in every view;
- paste: all views, the same offset;
- arc radius per view;
- visibility / lock, fill colour and join mode shared;
- new lines and split-off points start with linear response.

**Ours to verify:** the angle-domain scheme, the expression carry algorithm, response-curve inheritance, expression paste mapping, measured undo cost.
