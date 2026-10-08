# Layer / element batch: plan and acceptance list (written before code)

**Spec:** graph rows from Q29–Q31 in headset-design `docs/design/review/2026-10-07-architecture-walkthrough.md` (as of `337297e`).

**Scope:** operations within one document only. Cut across snapshots waits for the snapshot layer.

## Model changes

| Where | Change | Rule |
|---|---|---|
| `network` | Layers become records `{id, name}`. Names are unique and non-empty. | Q30 |
| `network` | Each line carries an **element state** `{visible, locked}` and its own **stroke** `{width, profile}`. A split copies them to both pieces. | Q29 |
| `fills` | Each filled loop carries the same element state `{visible, locked}`; its colour (and later material) is the protected content. | Q29 C |
| `groups` | No stroke any more: a group's width change is a batch over its unlocked lines. | Q29 D |
| new `locks` module | Compares each locked element's **protected content** before and after an edit. | Q31 |
| `network` | **No two endpoints in one layer may coincide.** At commit, exactly coincident endpoints in one layer are bound. The kept point is the one not directly acted on in this edit; if both or neither were acted on, the earlier-created one is kept. | Q31 |

**Protected content checked by `locks`** (dot's correction, after `f9c4109`):
- **locked line:**
  - its final geometry as `derived` computes it, so an arc join that changes the drawn shape counts as a change;
  - width and profile;
  - for each end, the effective end stroke: the end stroke if the end is free, nothing if it is shared.
  The free/shared flag itself is not compared. Only a real change in shape or in the stroke that is drawn counts.
- **locked fill:** colour.

A locked fill that vanished because its loop broke is allowed (Q30 甲).

## Operations (Editor)

| Operation | Kind | Rule |
|---|---|---|
| `lineState(line, {visible?, locked?})`, `fillState(loop, …)` | state change; allowed on locked elements | Q29 |
| `groupState(group, …)` | batch over the group's lines | Q29 |
| `layerState(layer, …)` | batch over the layer's lines and fills | Q29 |
| `layerFills(layer, visible)` | batch over the layer's fills only | backlog 3, dot 1791435501 |
| `lineStroke(line, stroke)` | edit (refused if the line is locked) | Q29 |
| `stroke(group, stroke)` | batch over the unlocked lines of the group | Q29 D |
| `newLayer(id, name, below?)` | empty container, placed above the current or given layer | Q30 |
| `renameLayer(id, name)` | unique and non-empty | Q30 |
| `reorderLayer(id, index)` | state change | Q29 |
| `copyLayer(id, newId, name?)` | new-identity copy above the original. Internal relations are remapped; links are never copied; states are kept. The name defaults to "name · n", unique. | Q30 |
| `deleteLayer(id)` | batch: unlocked lines and fills are deleted. The layer stays while it still holds anything. | Q30 |
| `moveGroup(group, layer)` | cut + paste of a whole group, keeping ids. Refused if any element in it is locked. The group goes on top of the target layer. Links stay if the partner still exists; the same-layer case binds through the overlap rule. | Q31 |
| `unbind(point, lines, newPoint)` | the new point is offset a short fixed distance back along the first moved line, in the same operation | Q31 |
| `mergePosition` (same layer) | becomes a bind through the overlap rule | Q31 |

**Undo:** one history for edits and state changes (already true).

## Commit pipeline (fixed order)

1. **Isolated points:** remove them.
2. **Position loop**, repeated until nothing changes (dot's correction, after `f9c4109`):
   - overlap auto-bind: bind coincident endpoints in each layer;
   - links: drop links between points now in one layer, then align the rest.
   Link alignment can create a new coincidence in one layer, so one pass is not enough.
   The published state therefore never has coincident endpoints in one layer.
3. **Smooth springs:** solve. They turn handles only and never move points.
4. **Fills:** validate.
5. **Groups:** reconcile.
6. **Locks:** compare the published state with the draft and refuse the edit on any difference.

Every step reports its changes through `Changes`, so isolated points and stale relations left by a bind are cleaned in the same commit.

## Acceptance cases (tests first)

**Layers**
1. A new layer is empty, placed above the given layer, with a unique name. Duplicate and empty names are refused.
2. Renaming to an existing name is refused.
3. Reordering is undoable.

**Copying a layer**
4. Gives new ids for lines, points and fills, and the same shape, joins and fill colours.
5. Element states are kept.
6. Links are not copied, and the original's link stays.
7. The copy's name is unique.

**Deleting a layer**
8. With unlocked lines only, the layer is gone and its links end.
9. With a locked line, the unlocked lines go and the locked line and the layer stay.
10. A locked fill whose boundary lines are unlocked vanishes (甲).
11. A deletion that would turn a locked line's shared end into a free end (making its taper appear) is refused (dot's cross-case).

**State changes and locks**
12. Hiding a layer hides all its elements. Showing it again shows all of them (it is a batch, with no lasting layer state).
13. A locked element can still be hidden and unlocked.
14. Every state change is one undo step.

**Line width**
15. A group width change skips locked lines.
16. Dragging a point shared with a locked line is refused.
17. A smooth spring that would turn a locked handle is refused.
18. Binding onto a locked line's shared end is allowed if nothing on that line changes.
19. Binding onto a locked line's free end that has a taper is refused.

**Overlapping endpoints**
20. A pen line drawn to an existing point's exact position is auto-bound.
21. A point dragged onto another is bound, keeping the stationary point.
22. Merge position within one layer equals a bind.
23. Dragging a line's end onto its own other end deletes the line.

**Unbind**
24. Unbind leaves the two points apart and does not rebind.

**Moving a group**
25. `moveGroup` to another layer keeps all ids. Fills and joins follow, and the group lands on top.
26. `moveGroup` of a group containing a locked element is refused.
27. Moving a group into its link partner's layer binds the linked points, and the link ends. The same holds when two linked groups are both moved into one third layer.
28. Moving two linked groups into two different other layers keeps the link.

**Copy and paste with locks**
29. Copying a locked group gives a locked copy.

**Lock signature** (dot's correction, after `f9c4109`)
29a. An arc join that changes a locked line's drawn shape is refused.
29b. Binding onto a locked point is allowed when the locked line's protected content is unchanged.

**Fuzz**
30. The random edit invariants are extended: no two coincident endpoints in one layer; locked elements are never changed by a refused edit; layer names are unique.

## Decided: bind width

bowen chose 甲 in reply to 1791458383: binding no longer touches widths, and each line keeps its own.
