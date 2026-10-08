# Editing and apply: plan and acceptance list (written before code)

**Spec:** the Editing and Mirror tables of the graph in headset-design `docs/design/review/2026-10-07-architecture-walkthrough.md` (as of `0f6dae6`, reviewed by dot 1791471687). bowen 1791472976: two separate modules.

**Order:**
- Phase E, module `editing`: committed and pushed first, so dot can verify it.
- Phase A, module `apply`.

**Scope:**
- One document.
- Domain deformation (four corners, curved edges) is deferred: its handle fitting is an implementation choice that needs its own tests.
- Copy and paste of selections is also deferred.

## Phase E — module `editing`

**Owns:** the selection (a "pre-edit", part of the document state, so it is undoable).

| Operation | Rule | Source |
|---|---|---|
| `select(units, mode)` with `mode` = replace / add / remove; a unit is a point, a handle (line + end), a line or a fill | A change of selection is one step. No change means no step: the existing "edit that changes nothing" rule already covers this. | Editing rows "Selection", "Selectable units" |
| `selectGroup(line, mode)` (V) | Selects every line of the line's continuous curve, hidden ones included. | "Selectable units" |
| at commit | Units whose target no longer exists are dropped in the same step. | "Selection" |
| `expand(selection)` → points and handles | point → itself; handle → itself; line → its two end points and two handles; group → all of its lines; a shared point counts once | "Geometric transform acts on" |
| `transform(affine)` | Points go to M·p as directly acted-on targets, so endpoint links average them as before. Expanded handles become linear(M)·offset and are held. Any other handle keeps its offset, so it moves with its point without turning. Joins are then solved by their own rules. | "Geometric transform acts on / keeps" |
| `translate`, `rotate(centre, angle)`, `scale(centre, sx, sy)` | Each is the affine above. Scale factors must be finite and non-zero. | same |
| `flip()` | Reflects across the vertical line through the centre of the selection's curve bounds. It is an edit; no copy is made. | Mirror row "Mirror flip" |
| `deleteSelection()` | Deletes the selected lines. If no line is selected (only points or handles), it is refused with code `select-lines-to-delete`. | "Delete with only end points selected" |

**Filled in by us, to confirm (listed in the README):**
- A selected fill expands to its boundary lines for transforms. A fill is an attribute of its loop, so moving it means moving its loop.
- `deleteSelection` also clears selected fills.

**Unchanged:** `scale` never touches line width (bowen 1791471538). A transform acts on points and handles only.

### Acceptance (E)

1. Selecting, adding and removing are each one undo step; reselecting the same set adds no step.
2. Deleting a line drops it from the selection in the same step, and undo restores both.
3. Moving a selected line moves its two points and handles. An unselected neighbour on the shared point follows, with its handle's direction and length kept.
4. Rotating a line that has a smooth join with an unselected neighbour makes the spring turn the neighbour; with a cusp the neighbour does not turn.
5. Two selected lines sharing a point move it once.
6. Scaling never changes line width.
7. A flip reflects across the selection's own centre, keeps ids, and applying it twice returns the original.
8. Transforming a locked line is refused (existing lock check). A locked element can still be selected.
9. Deleting with only points selected is refused with `select-lines-to-delete`.
10. A linked point in another layer follows a transformed point (existing link rule).
11. Fuzz: random select, transform and delete operations keep every existing invariant. A selection never points at a missing element after commit.

## Phase A — module `apply`

**Owns:**
- the document's symmetry axis (a vertical line x = axis);
- the mirror-link records: unordered line pairs `{a, b, reversed}`, stored in one sorted form under the symmetry principle.

| Operation | Rule | Source |
|---|---|---|
| `setAxis(x)` | An edit (one step); later applies and links use it. | "Symmetry axis" |
| `mirrorApply(source lines, target lines)` | The two sets must not overlap. Find the correspondence (below), then write into the target: reflected positions (as acted-on targets) and handles (held, orientation swapped on reversed pairs); stroke and element state; the end strokes of corresponding points; the join rows among corresponding lines at corresponding points; the fill colour and state of corresponding loops. The target keeps its ids, layer and outside links. A point in both sets receives both intents and they are averaged, so a self-corresponding point lands on the axis. | "Mirror apply", "Apply" |
| correspondence | A bijection between source and target lines, each with an orientation, that preserves end-point sharing and endpoint links inside the selection. Each assignment is scored by the squared distance between the reflected source controls and the target controls, and the lowest score wins. Ties keep the first in a stable search order. No bijection gives `topology-mismatch`. | "Mirror correspondence" |
| `mirrorLink(source groups, target groups)` | Each side is one or more whole first-level elements, and the sides are disjoint. The operation is a mirror apply followed by storing the pairs. | "Mirror link" |
| `unmirror(lines)` | Removes the pairs only; geometry stays. | "Mirror link can be removed" |
| **paired execution** (in `document`, using `apply.counterpart*`) | Each Editor operation on a paired line, point, handle or fill is done once more on the counterpart: stroke, state, fill, end stroke, join, link join, delete, split (at t, or 1−t on a reversed pair), bind, unbind, endpoint link. The counterpart's new ids are the caller's ids with the suffix `′`. Bind or link between a paired point and an unpaired outside point is refused with `mirror-no-counterpart`. | "Mirror link", "protects" |
| commit: positions | Endpoint links and mirror point pairs are solved in one averaging step. Each group is a union of link edges (identity) and mirror edges (reflection). Acted-on targets are taken into the group's frame and averaged. A group that needs a point to equal its own reflection is placed on the axis. | "Both sides edited", dot 1791470434 (position part only) |
| commit: handles | A held handle on a paired line gives its counterpart the reflected handle (held). If both are held, their reflected values are averaged. Springs run afterwards. | same |
| pairs after topology changes | A split pairs the pieces; a delete removes the pair; a bind keeps the pair while both lines exist. | "Mirror link", "End points … reaching the axis" |

**Filled in by us, to confirm:**
- the counterpart id suffix `′`;
- error codes `topology-mismatch`, `mirror-no-counterpart`, `select-lines-to-delete`;
- the axis defaults to x = 0.

**Derived consequence to report to bowen:** `deleteLayer` deletes each unlocked line. Under a mirror link each of those deletes is paired, so deleting the left eye's layer also deletes the mirror-linked right eye, unless the right eye is locked, in which case the whole operation is refused.

### Acceptance (A)

1. A mirror apply onto a target with the same topology gives an exact mirror and keeps the target's ids. Stroke, end strokes, joins, fill colour and state are copied. A pair with opposite direction maps handles correctly.
2. A topology mismatch is refused with `topology-mismatch`; overlapping source and target are refused.
3. Correspondence:
   - a two-line case picks the matching nearest after reflection;
   - a symmetric source (a 4-segment circle) yields a stable choice, the same every time.
4. A locked target refuses the apply (existing lock check).
5. Mirror link: dragging a point on one side moves its counterpart to the mirror position, in both directions. Dragging both sides the same way across the axis cancels; dragging them inward (mirrored) takes effect.
6. Eyelids on two layers with eye-corner endpoint links on both sides: dragging a left corner leaves the right side an exact mirror. Building the links per layer or at once gives the same pairs and the same later result.
7. Under a mirror link:
   - a paired delete removes both lines;
   - a paired split gives paired pieces, reversed on reversed pairs;
   - stroke, state and fill colour sync;
   - undo restores all of it.
8. Matching end points dragged onto the axis in one layer bind, and the pairs survive.
9. Binding a paired point to an outside unpaired point is refused with `mirror-no-counterpart`.
10. A locked counterpart refuses a paired edit.
11. `unmirror` keeps the current shapes; afterwards edits no longer pair.
12. Fuzz: the existing invariants hold; mirror pairs always reference existing lines; after each commit every pair's points are mirrored where nothing else forbids it.
