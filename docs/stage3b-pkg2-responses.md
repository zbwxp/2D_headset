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
- **One content, one form:** empty axis lists, empty edges and empty controls are not stored. A response all of whose knots have value exactly equal to progress is the identity and is not stored either (it is the same function as no response). A control without an entry is linear.
- **Ids are ordinary keys** (dot 1791689396), as in `shapes`: entries live in own-property records, read with `hasOwn` and written with `defineProperty`. So any legal id, `constructor`, `toString` and `__proto__` included, works; what is refused is *reading an inherited property*, never a name.
- **"The same"** (to accept a link; dot 1791687776, tightened after dot 1791689543): two points' response sets are the same only when their **normal forms are identical**, compared exactly with no tolerance. By the normal form above, an explicit linear response (every knot exactly on the diagonal) equals a missing one, as dot asked. Any other difference, however small, refuses the link. A response value difference times a large coordinate span can be visible, so no difference is judged discardable on the user's behalf. Two responses that are the same function written with different knots (an extra knot exactly on a segment) are also refused: a conservative rule that never loses tuning, which the user resolves explicitly.
- **Invariant: linked points hold *identical* stored response sets** (dot 1791689396). An approximate comparison is not transitive (A ≈ B and B ≈ C within 1e-12 does not give A ≈ C), and a tiny difference times a large coordinate span becomes a visible gap. So:
  - **on a link** that is accepted, the two components' sets are already identical in normal form, so nothing is discarded. The second component's members are written in normal form, which only drops identity responses, the same function;
  - linked points in every view coincide exactly (links settle them to one position), and their sets are identical, so `evaluate` gives them bit-identical results at every pose;
  - **`correct`** (package 3) writes the same knots to every member of a component;
  - **`open`** requires linked points' stored sets to be exactly equal (in normal form), and refuses otherwise.

## 2. Evaluate with responses (`evaluate`)

- **The model** gains `responses: AnimationState`, a copy, from `Core.model()`.
- **Per control and axis**, in the quadrant of the pose with u, v as in 3a:
  - `u' = (1 − v)·r_bottom(u) + v·r_top(u)`;
  - `v' = (1 − u)·s_left(v) + u·s_right(v)`;
  - then 3a's bilinear formula with u', v' for that scalar.
  - bottom / top are the yaw edges at pitch 0 and at the quadrant's pitch; left / right are the pitch edges at yaw 0 and at the quadrant's yaw.
- **A control with no response on any of its four edges** takes 3a's code path, so its numbers are bit-for-bit those of 3a.
- **Exactness:** at a view, u and v are 0 or 1 and each r is pinned there, so the view comes back exactly. On an edge (v = 0 or u = 0) the formula is exactly that edge's response. Neighbouring cells share their edges, so the result is continuous; responses may extrapolate; nothing promises a good-looking shape (dot 1791687563).
- **Negative and above-one weights are kept** (dot 1791689396). With responses, u' and v' can leave [0, 1] (extrapolation), so a scalar's four weights can be negative or exceed 1. 3a's "keep weights > 0" filter does not apply to responded scalars: only weights exactly 0 are skipped (so a view stays exact). Example: on an edge with values 10 and 20 and a response value −0.5, the result is 5.
- **Weights for the slots and radii:** slot A (appearance) and arc radii still use the geometric weights (non-negative; the dominant view), as v103 kept membership on the geometric weights.
- **Refused:** a malformed response in the model (`model-incomplete`, naming the control, edge and axis), checked with own properties as in package 1 of 3a.

## 3. Responses through structural edits (`animation.follow`, the `follow` hook of the architecture)

`follow(animation, network, record)` runs inside `applyTopology`, after each network operation, like every other attribute module. It also runs for auto-bind, so one rule set covers every path (dot 1791687563).

Fields as `net.Changes` names them (dot 1791689396):

| Record field | Responses |
|---|---|
| `deletedPoints` (delete, bind's removed point, auto-bind, isolated points) | the point's entry goes |
| `deletedLines`, `collapsedLines` | the line's handle entries go |
| `merged` (bind, auto-bind) | nothing more: the kept point keeps its own; the removed point is in `deletedPoints` (dot 1791687873: links follow the same deletion) |
| `unbound` `{ point, newPoint }` | the new point gets a copy of the old point's entry |
| `addedPoints`, `addedLines` (pen, split, unbind, insert) | **nothing is written.** "No response" is the absence of an entry, so a new point or line simply has none, and nothing clears what another rule wrote. Unbind records its new point in both `addedPoints` and `unbound`, and the copy from `unbound` stays. A borrowed existing end point is not in `addedPoints` and keeps its own |
| `relocated` (move to another layer) | ids unchanged: entries unchanged |
| `replaced` (split) | cannot happen with responses: refused before it (below) |

**Order inside one record:** deletions, then `unbound` copies. `added*` writes nothing, so its place does not matter. Inserted entries (paste, copy layer) come from the clip through `animation.insert`, not from `follow`.

**Checked before the operation, in the operation (`document`):**
- **`split`** (and each mirror-paired split) is refused when the split line's handles or its end points have any response (`split-has-responses`, naming the line). A split with no responses goes through unchanged.
- **`link`** (and each paired link) is refused when the two points' components' sets do not behave the same (`link-responses-differ`, naming both points). When accepted, the second component takes an exact copy of the first's (§1).

**Insert (`paste`, `copyLayer`; dot 1791689360):**
- **The clip gains an `animation` part:** the entries of exactly the clip's points and lines, extracted by `animation.extract`. It is read from the same version as the rest of the clip, and the two copy entries differ:
  - `Core.copy` (the clipboard) reads the **published** state;
  - `copyLayer` inside an edit reads the **draft's** attributes, `animation` included, with geometry from the settled trial, as it does today. So a response a point inherited earlier in the same edit (e.g. unbind, then copy the layer) is carried.
- **`clipboard.check` validates and returns the part,** through `animation.checkClipData` (clipboard gains a dependency on animation). Today's `check` rebuilds a whitelisted object, so an unchecked field would be dropped silently.
  - a clip **without** the part is an old clip and inserts no responses;
  - a clip **with** the part is checked in full: every id is one of the clip's points or lines; edge keys valid; knots valid; own properties only. Anything wrong refuses the paste (`clip-invalid`, naming what). It is never read as "no responses".
- **`insertClip` writes them to the new ids through the actual copy map** (`animation.insert`). A partial copy carries only what was copied.

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
| copy to the clipboard (`Core.copy`) | the **published** state's `animation`, for the clip's ids | the clip | `copy` |
| copy a layer (`copyLayer`, in an edit) | the **draft's** `animation` as written so far in the edit (geometry from the settled trial, attributes from the draft, as today) | the clip, then the draft | in the operation |
| clip check | the clip's `animation` part | the checked clip (`clipboard.check` returns it) | `paste` |
| insert | the checked clip | the draft's `animation`, through the actual copy map | `paste`, `copyLayer` |
| save / open | the published `animation` / the file | the file / a new Core | archive |
| undo / redo | the state stack | — | as every part |

## 7. Tests (package 2)

- **Data:** normal form; "same behaviour" (missing = identity = explicit diagonal; unequal by a knot; equal with different knot sets that evaluate the same).
- **Evaluate:**
  - no responses → bit-for-bit 3a at sampled poses;
  - every one of the 12 edges: a response there acts exactly on its edge and on the two cells beside it;
  - extrapolation: values 10 and 20, response −0.5 → 5 (a negative weight kept); a response above 1 likewise;
  - appearance (slot A) and radii use the geometric weights, unchanged by responses;
  - at the nine views exact with responses present;
  - on an edge: exactly that edge's response;
  - inside a cell: the u' / v' formula;
  - continuity across cells and across 0° with responses;
  - a malformed response refused;
  - a response on one control changes no other control.
- **Ids:** points and lines named `constructor`, `toString` and `__proto__` carry responses through every path (store, follow, clip, file), and an inherited name is never read as a response.
- **Follow,** one test per row of §3, each through a real operation:
  - delete a point, a line, a layer, the selection;
  - bind, and auto-bind (by a move in the edited view);
  - unbind (copy), pen from a borrowed end point (kept);
  - move to another layer (kept).
- **Refusals:**
  - `split-has-responses` (ends, handles, a paired split) and a split without responses going through;
  - `link-responses-differ`, and a link between identity and explicit-linear responses going through;
  - after an accepted link, every member of the second component holds a set identical to the first's, and linked points evaluate bit-identically at sampled poses;
  - a difference of one ulp in one knot value refuses the link (no tolerance); an explicit diagonal against a missing response is accepted; the same function with an extra collinear knot is refused (conservative);
  - a file whose linked points' sets differ at all is refused at open.
- **Insert:**
  - paste and copy-layer carry responses to the new ids, partial copies only what was copied;
  - unbind then copy-layer in one edit carries the inherited response;
  - a clip without the part inserts none;
  - a clip whose part has an id that is not one of the clip's points or lines, a bad edge or a bad knot refuses the paste (`clip-invalid`). A key named `constructor` is refused only when no such point or line is in the clip; a clip id with that name is carried;
  - `clipboard.check` returns the part (a clip round-tripped through JSON keeps its responses).
- **Archive:** save / open round trip; format 3 refused; each `open` refusal (unknown id, edge, bad knot order, out of (0, 1), non-finite, 257 knots, linked points that differ). A key named `constructor` with no such point is an unknown id; a real point named `constructor` opens.
- **Declarations:** the per-operation write test with responses present; no undeclared `animation` write.
- **Undo:** an edit that changes responses (a delete) is undone with everything else.
- **Ledger row 5:** the clipboard uses `shapes.KINDS`.
