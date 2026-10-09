# Layer scope plan: selected layers, and which layers each tool reaches

**Requirement:** bowen 1791555800 (with 1791555230, 1791553331, 1791553510; dot 1791555264, 1791555418). bowen 1791555918 calls it a principle: every tool has a matching layer focus (dot's wording 1791555954: the focus decides on which layers a tool shows its operation components and accepts direct picks; showing and hitting use one set; the focus limits the direct way in, not the follow-on effects of existing links). Not in the graph until bowen says so.

> 那就做图层复选吧。图层本来就会default选中至少一个图层，为了让跨图层编辑方便，可以按shift复选图层那么被选中的图层就常亮 也就是可以一起av编辑。想取消复选随便单击任何一个单独图层就完事了。然后按照这个思路 bind点击的时候就应该只显示当前图层的端点，而merge就是所有端点。这就是区别。split link unbind join fill之类的同理。

Each item below is tagged: **bowen** (his words), **note** (follows uniquely from them), **common sense** (a mature-tool default, not asked), or **default (ours)** (our choice; bowen or dot may change it).

## 1. Selected layers and the current layer (layers panel)

- At least one layer is always selected. **bowen**
- Selected rows stay highlighted, and V and A edit all of them together. **bowen**
- A plain click on a row selects only that layer. **bowen**
- Shift-click selects the range from the anchor to the clicked row. Cmd-click adds or removes one row. **common sense** (Finder, Adobe panels; bowen asked how it goes)
  - The anchor is the last row clicked without Shift.
- The **current layer** is the last row clicked, and it is always one of the selected layers. **default (ours)**
  - New lines (pen), pastes, and a new layer's position go to the current layer, as today.
  - The panel's fill / copy / delete buttons also act on the current layer, as today.
  - If Cmd-click removes the current layer, the topmost remaining selected layer becomes current.
  - Cmd-click on the only selected layer does nothing, because at least one stays selected.
- The current row is drawn stronger than the other selected rows. **default (ours)**

## 2. Which layers each tool reaches (its scope)

What a tool shows as operable, and what it can hit, is the same set (bowen 1791553331). Lines of other layers stay drawn, as reference only.

| Tool | Scope | Why |
|---|---|---|
| V, A | selected layers | **bowen** |
| bind, split, unbind, join, fill | selected layers | **bowen** ("同理"). With two layers selected, a join across them is still possible (dot 1791556023); bind stays within one layer, as core already rules |
| merge position, link | all visible layers | **bowen** (merge = all points); link joins two layers by definition (graph, Linkage) |
| pen | current layer | **note**: a new line goes into the current layer, and both ends of a line are in one layer, so only the current layer's points can be connected to |

- The scope covers points, handles and lines alike. For fill, it covers the loops whose lines are in scope. **note**
- A shows handles for every visible line in its scope; this extends #12 (`800c9bd`) from one layer to the selected layers. **note**

## 3. A selection outside the focus

Only the selection units on the selected layers are shown selected and acted on: drag, Delete, copy / cut, flip / rotate / scale, mirror source and target. Each of these takes them as explicit targets. **note** (bowen 1791553331)

- Units on other layers stay in core's selection, inert. An undo may bring them back; nothing acts on them (dot 1791556061, case 1).
- A focus change makes no edit, so it never clears the redo history. *Replaces the first version's "deselect on a focus change", which would have broken that case.*
- A mirror source and a pending cut stay through a focus change: both were named explicitly. The paste goes into the new current layer (dot 1791556088).
- A drag cannot be in progress while the panel is clicked (the pointer is busy).

## 4. Where it lives

- **Interaction** (a graph module) gets the selected layers from the app, `Env.layers()`, next to `Env.layer()` (the current one).
  - It picks only within each tool's scope.
  - It gives the points and handles it shows in `preview()` (`points`, `handles`); the view draws exactly those.
  - `selection()` gives the selection on the selected layers.
- **Core** gets two additions, both following existing patterns:
  - `deleteSelection(units?)` takes explicit targets, as the transforms already do.
  - `loopsAt(at)` is a read-only query: every loop containing the point, smallest first. `pickLoop` is now its first. Fill takes the smallest loop in its scope, so a small loop on another layer inside a loop of the focus does not hide it (dot 1791556061, case 2). The geometry stays core's.
- **visual/LayersPanel** takes `selected` and `current`, and reports clicks with their modifiers.
- **The bench** keeps the selected layers and the current layer. It draws only the points and handles that interaction lists.
- **The bench** highlights `ix.selection()` and passes it as explicit targets from its buttons.

## 5. Flows to run before announcing (checklist)

1. Panel: click, Shift range (both directions), Cmd add, Cmd remove, Cmd on the last one does nothing, and current moves when it is removed.
2. Every tool, both scopes: a press on a point, handle or line in scope hits it, and one out of scope does not. `preview().points` and `preview().handles` equal what can be hit (pressed one by one, as in #12's test).
3. V across two selected layers, then mirror source → apply and mirror link: the upper/lower-eyelid flow across layers (dot 1791555418).
4. bind shows and hits only selected layers' points; merge and link reach every visible layer's points.
5. Pen connects only to current-layer points; a press on another layer's point starts a new point there instead.
6. Fill picks only loops in scope.
7. Narrowing the focus leaves the other selection inert and makes no edit. In the A+B → A → undo case, drag, Delete, flip, rotate and copy act on A only, and redo stays.
11. Fill with a small loop of another layer inside a loop of the focus picks the focus's loop.
12. A mirror source and a pending cut survive a focus change; the paste lands in the new current layer.
8. Hidden layers: nothing shown or hit, even when selected.
9. Opening another drawing resets to one selected layer (its top one), as today.
10. All earlier suites still pass (core / interaction, bench).
