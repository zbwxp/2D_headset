# Interaction module: plan and acceptance list

Sources:
- graph "Interaction" (design `1e0d9cf`, corrected `9d585b5`): one owner per state; cancellable, atomic commit; explicit targets;
- doc 22 (design `9d585b5`): packages, the core calls interaction makes, and the placements settled with dot.

No code until dot has reviewed this list.

## Work, in order

1. **Core: refusals carry a code and the objects** (doc 22 §3.3).
   - A `Refusal` error class (`code`, `objects`, the message as now). It is thrown at the refusals interaction shows:
     - `locked` (lock check, moveGroup / cut, locked fill colour);
     - `select-lines-to-delete`, `select-lines-to-copy`;
     - `mirror-no-counterpart`, `topology-mismatch`;
     - `name-taken`.
   - Every other error keeps its message, and nothing changes in what is refused.
2. **Core: a read-only distance query** (doc 22 §3.1). `nearby(at, radius)` gives the points, handles and lines within `radius` of a document position, each with its distance. It changes nothing and holds no selection rules.
3. **`interaction/` package.** It imports only core's public entry; core never imports it.
4. **Bench:** its tool code is replaced by `interaction`. Panels, files, drawing and the camera stay in the bench.

## Interaction's interface (a sketch, to be confirmed by the tests)

```ts
createInteraction({ core: () => Core, newId: (prefix) => Id }) → {
  pointerDown(at, mods), pointerMove(at), pointerUp(at), pointerCancel(), key(name, mods),
  toolChanged(tool, options), drawingChanged(), historyChanged(), cancel(),
  copy(), cut(), paste(layer),
  preview(): PreviewData,   // ghost lines, grey (pending cut), first-pick marks, refusal mark
  status(): { tool, pending: … }, // for panels
}
```

Positions are in document coordinates. The camera stays in the view, and the tolerance is given in document units by the caller.

## Acceptance (`interaction/test/*.test.ts`)

Each test is a scripted input against a real `Core`, checking the core calls made (through a recording wrapper), the drawing and the preview data. No browser is used.

**State owners (graph row 1):**
1. Interaction holds no copy of the drawing. Its state is only tool, drag, pending cut, first pick, pen chain, clip and paste count.
2. A boundary test checks that `interaction/` imports only `../src` (the package root) and that `src/` never imports `interaction/`.

**Cancellable, atomic commit (graph row 2):**

3. **Drag:**
   - press on a line with V selects its curve: one `select` edit;
   - moves change only the preview;
   - release makes one `edit` with `translate`, and undo returns to after the selection.
4. **Esc during a drag:** no edit; the selection made at press stays (dot 1791543266).
5. **Browser-cancelled drag or lost pointer:** the same as Esc.
6. **A drag refused by a lock:**
   - the drawing is unchanged;
   - the preview shows a refusal mark on the refused objects, taken from the `Refusal`'s `objects`;
   - the drag has ended.
7. **Preview:** after any sequence of moves the drawing is unchanged; previews never write.

**Explicit targets (graph row 3):**

8. **Two-click tool (bind):**
   - the first pick is held;
   - changing the selection in between does not change it;
   - the second click gives the second point;
   - the call is `bind(first, second)`.
9. **Pending cut:**
   - it keeps its groups and the drawing it belongs to;
   - selecting something else and then copying ends it, and a paste then pastes the copy;
   - a refused paste keeps it, and a retry after unlocking moves it;
   - `drawingChanged()` ends it.
10. **A drag's target is the selection at its start.** A selection change from outside during the drag (a panel button) does not retarget the drag. The drag commits on its own targets or, if those are gone, is refused.

**Lifecycle calls (doc 22 §3.5):**

11. **`toolChanged`:**
    - it ends the old tool's first pick and pen chain;
    - whether it cancels a drag is an interaction default: yes;
    - the pending cut stays, because it belongs to the clipboard and not to a tool.
12. **`historyChanged`:**
    - it ends a drag in progress;
    - a pending cut whose groups no longer exist ends.
13. **`drawingChanged`:**
    - it ends everything tied to the old drawing;
    - the clip stays, because it is plain data.
14. **`cancel` (Esc), innermost first (an interaction default):** drag, then first pick / pen chain, then pending cut.

**Clipboard (doc 22 §3.6):**

15. **Copy and paste:**
    - `copy` calls `core.copy`;
    - each `paste` calls `paste` with the next offset step;
    - interaction never builds clip content itself.
16. **Cut then paste:**
    - after a cut, `paste` calls `moveGroup` for each pending group into the given layer, in one edit;
    - later pastes copy.
