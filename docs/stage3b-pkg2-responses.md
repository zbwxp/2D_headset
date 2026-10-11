# Stage 3b, package 2: responses as data, evaluate with responses — final rules, read and write paths

**Status:** for dot's check (dot 1791689059: the final rules and read / write paths of the response data and its evaluation, before code). Nothing is coded until this passes.

**Not in this package:**
- the correction itself (`correct`, package 3);
- the outer view's minimal move (package 4, method still open);
- the bench (package 5);
- the scope question to bowen (corrections only on edges) does not affect this package: the data and its evaluation are the same either way.

**Ledger check:**
- **Row 5 is triggered:** this package changes the clip, which carries responses. So the clipboard's duplicated list of layer kinds is replaced by `shapes.KINDS` here.
- Rows 2, 3, 6, 7, 9, 10 and 11 are not triggered.

## 1. The data (`animation` state)

A new part of the document state, owned by the `animation` module, undone and saved with everything else. It is not a shape layer and not a record layer.

```
AnimationState = {
  points:  { [pointId]: ControlResponses }
  handles: { [lineId]: { a?: ControlResponses, b?: ControlResponses } }
}
ControlResponses = { [edge]: { x?: Knot[], y?: Knot[] } }
Knot = [progress, value]
```

- **Edges:** the 12 edges between neighbouring views, each oriented from the view nearer the front to the outer one; `views.EDGES` lists them.
  - 6 yaw edges: `view:0,p > view:±90,p` for p ∈ {−45, 0, 45};
  - 6 pitch edges: `view:y,0 > view:y,±45` for y ∈ {−90, 0, 90}.
  - Key form: `inner>outer`, e.g. `view:0,0>view:90,0`.
- **A response** (one control, one edge, one axis):
  - knots with progress strictly increasing inside (0, 1), values finite and not clamped;
  - the curve is piecewise linear through (0, 0), the knots, (1, 1);
  - at most 256 knots.
- **Controls:** a point (its position), or one end of a line (its handle vector). Arc radii have no responses; they blend linearly, as in v103.
- **One content, one form:** empty axis lists, empty edges and empty controls are not stored. A control without an entry is linear.
- **"Same behaviour"** (for links, dot 1791687776): two responses of one edge and axis are the same when, evaluated at the union of their knot progresses, every value is equal within 1e-12. A missing response is the identity. So an explicit linear one (knots on the diagonal) equals a missing one.
- **Invariant:** linked points (a link component) have the same behaviour on every edge and axis.

## 2. Evaluate with responses (`evaluate`)

- **The model** gains `responses: AnimationState`, a copy, from `Core.model()`.
- **Per control and axis**, in the quadrant of the pose with u, v as in 3a:
  - `u' = (1 − v)·r_bottom(u) + v·r_top(u)`;
  - `v' = (1 − u)·s_left(v) + u·s_right(v)`;
  - then 3a's bilinear formula with u', v' for that scalar.
  - bottom / top are the yaw edges at pitch 0 and at the quadrant's pitch; left / right are the pitch edges at yaw 0 and at the quadrant's yaw.
- **A control with no response on any of its four edges** takes 3a's code path, so its numbers are bit-for-bit those of 3a.
- **Exactness:** at a view, u and v are 0 or 1 and each r is pinned there, so the view comes back exactly. On an edge (v = 0 or u = 0) the formula is exactly that edge's response. Neighbouring cells share their edges, so the result is continuous; responses may extrapolate; nothing promises a good-looking shape (dot 1791687563).
- **Weights for the slots:** slot A (appearance) still uses the geometric weights (dominant view), as v103 kept membership on the geometric weights.
- **Refused:** a malformed response in the model (`model-incomplete`, naming the control, edge and axis), checked with own properties as in package 1 of 3a.

## 3. Responses through structural edits (`animation.follow`, the `follow` hook of the architecture)

`follow(animation, network, record)` runs inside `applyTopology`, after each network operation, like every other attribute module. It also runs for auto-bind, so one rule set covers every path (dot 1791687563).

| Structural record | Responses |
|---|---|
| `deletedPoints` (delete, bind's removed point, auto-bind, isolated points) | the point's entry goes |
| `deletedLines`, `collapsedLines` | the line's handle entries go |
| `merged` (bind, auto-bind) | nothing more: the kept point keeps its own; the removed point is a deleted point (dot 1791687873: links follow the same deletion) |
| `unbound` | the new point gets a copy of the old point's entry |
| `created` (pen, split, unbind, insert) | new points and new lines start with no entry; a borrowed existing end point keeps its own (dot 1791687776) |
| `relocated` (move to another layer) | ids unchanged: entries unchanged |
| `replaced` (split) | cannot happen with responses: refused before it (below) |

**Checked before the operation, in the operation (`document`):**
- **`split`** (and each mirror-paired split) is refused when the split line's handles or its end points have any response (`split-has-responses`, naming the line). A split with no responses goes through unchanged.
- **`link`** (and each paired link) is refused when the two points' responses do not behave the same (`link-responses-differ`, naming both points).

**Insert (`paste`, `copyLayer`):**
- the clip gains an `animation` part: the entries of the clip's points and lines, extracted by `animation.extract` when the clip is made (read from the published state, like the rest of the clip);
- `insertClip` maps them to the new ids with the copy map (`animation.insert`);
- a clip without that part (an old clip object) inserts no responses.

**No user operation writes knots in this package.** `correct` (package 3) is the first. Until then responses come only from an opened file or a pasted clip.

## 4. Archive

- **Format 4:** the document gains `animation`. Format 3 or older is refused, as decided; there is no migration.
- **`open` checks** (`animation.restore`):
  - every point and line id exists;
  - every edge key is one of the 12;
  - every knot is valid: progress strictly increasing inside (0, 1), finite values, at most 256;
  - own properties only;
  - linked points behave the same.

  Anything else is refused (`open-failed`, naming what).
- **Save** writes the normalised form (§1).

## 5. Declarations (package 1's table)

- `Shared` gains `animation`.
- Operations whose `applyTopology` record can delete, merge or unbind points or lines, or insert, write it through `follow` / `insert`:
  - `deleteLine`, `deleteLayer`, `deleteSelection`, `bind`, `unbind`;
  - `paste`, `copyLayer`, which insert;
  - `mirrorApply`, `mirrorLink`: no structural deletion, so not declared; checked by their cases.
- Each declaration that gains `animation` gets a case with responses present, so the per-operation write test sees the write. A test asserts that no other operation writes `animation`.
- Auto-bind's deletions are settle effects, authorised by `autoStructure`, not by an operation's declaration (package 1's rule).

## 6. Read and write paths

| What | Read from | Written to | When |
|---|---|---|---|
| evaluate | `Core.model()`: the published state's views and `animation`, a copy | nothing | `atPose`, playback |
| follow | the edit's structural record | the draft's `animation` | inside each structural operation (`applyTopology`) |
| split / link checks | the draft's `animation` (as written so far in the edit) | nothing (refuse or go on) | in the operation |
| copy (clip) | the published state's `animation` for the clip's ids | the clip | `copy` |
| insert | the clip | the draft's `animation` | `paste`, `copyLayer` |
| save / open | the published `animation` / the file | the file / a new Core | archive |
| undo / redo | the state stack | — | as every part |

## 7. Tests (package 2)

- **Data:** normal form; "same behaviour" (missing = identity = explicit diagonal; unequal by a knot; equal with different knot sets that evaluate the same).
- **Evaluate:**
  - no responses → bit-for-bit 3a at sampled poses;
  - at the nine views exact with responses present;
  - on an edge: exactly that edge's response;
  - inside a cell: the u' / v' formula;
  - continuity across cells and across 0° with responses;
  - a malformed response refused;
  - a response on one control changes no other control.
- **Follow,** one test per row of §3, each through a real operation:
  - delete a point, a line, a layer, the selection;
  - bind, and auto-bind (by a move in the edited view);
  - unbind (copy), pen from a borrowed end point (kept);
  - move to another layer (kept).
- **Refusals:**
  - `split-has-responses` (ends, handles, a paired split) and a split without responses going through;
  - `link-responses-differ`, and a link between identity and explicit-linear responses going through.
- **Insert:** paste and copy-layer carry responses to the new ids; a clip without the part inserts none.
- **Archive:** save / open round trip; format 3 refused; each `open` refusal (unknown id, edge, bad knot order, out of (0, 1), non-finite, 257 knots, an inherited-name key, linked points that differ).
- **Declarations:** the per-operation write test with responses present; no undeclared `animation` write.
- **Undo:** an edit that changes responses (a delete) is undone with everything else.
- **Ledger row 5:** the clipboard uses `shapes.KINDS`.
