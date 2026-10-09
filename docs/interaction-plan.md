# Interaction module: plan and acceptance list

Sources:
- graph "Interaction" (design `1e0d9cf`, corrected `9d585b5`): one owner per state; cancellable, atomic commit; explicit targets;
- doc 22 (design `9d585b5`): packages, the core calls interaction makes, and the placements settled with dot.

No code until dot has reviewed this list.

## Work, in order

1. **Core: refusals carry a code and the objects** (doc 22 §3.3).
   - A `Refusal` error class (`code`, `objects`, the message as now). Each object is `{ kind, id }` (point / line / group / fill / layer), so a point and a line that share an id are never confused (dot 1791543494). It is thrown at the refusals interaction shows:
     - `locked` (lock check, moveGroup / cut, locked fill colour);
     - `select-lines-to-delete`, `select-lines-to-copy`;
     - `mirror-no-counterpart`, `topology-mismatch`;
     - `name-taken`.
   - Every other error keeps its message, and nothing changes in what is refused.
2. **Core: transforms with explicit targets** (dot 1791543296).
   - `translate` / `rotate` / `scale` / `flip` take an optional list of units.
   - Given, they act on exactly those units and expand them as the selection would: lines to their points and handles, shared points once. They reuse `editing`'s plan on a scratch selection.
   - The real selection is neither read nor changed, so a drag commits on the targets it started with. It never selects the old objects again, moves them, and restores.
   - Without the list, behaviour is as now.
3. **Core: a read-only distance query** (doc 22 §3.1). `nearby(at, radius)` gives the points, handles and lines within `radius` of a document position, each with its distance. It changes nothing and holds no selection rules.
4. **`interaction/` package.** It imports only core's public entry; core never imports it.
5. **Bench:** its tool code is replaced by `interaction`. Panels, files, drawing and the camera stay in the bench.

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
   - release makes one `edit` with `translate(dx, dy, units)` on the units the drag started with;
   - undo returns to the state after the selection.
4. **Esc during a drag:** no edit; the selection made at press stays (dot 1791543266).
5. **Browser-cancelled drag or lost pointer:** the same as Esc.
6. **A drag refused by a lock:**
   - the drawing is unchanged;
   - the preview shows a refusal mark on the refused objects, taken from the `Refusal`'s `objects`;
   - the drag has ended.
7. **Preview:** after any sequence of moves the drawing is unchanged, and so is the history (`canUndo`, `canRedo`, and what one undo restores). Previews never write.
   - Every cancel test checks the history the same way (dot 1791543494).

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
10. **A drag's target is the selection at its start.**
    - A selection change from outside during the drag (a panel button) does not retarget it: the drag commits on its own targets, through the explicit-target `translate`.
    - Dragging A while the selection changes to B moves A and never B, and B stays selected (dot 1791543296).
    - If its targets are gone, the drag is refused.

17. **A two-click pick whose first object is gone** (deleted, or undone away) before the second click never binds anything else. The second click is refused, and the pick ends.
    - `historyChanged` also ends a first pick or pen chain whose object no longer exists (dot 1791543296).
18. **Opening another drawing that fails** keeps the current drawing and every unfinished operation on it. `drawingChanged` is called only after a successful open (dot 1791543296).
20. **An operation belongs to one drawing object.**
    - Every unfinished operation remembers the `Core` it started on and checks it before committing.
    - After switching to another drawing that happens to use the same ids, an old operation never lands on the new drawing (dot 1791543494).
21. **A pending cut whose groups changed members** (a bind or split since the cut) ends. It never takes the new members along. The interaction shows a hint to select again, as an interaction default (dot 1791543494).
19. **A repeated release** for one drag (pointerUp twice, or pointerUp then lost capture) commits once.

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
