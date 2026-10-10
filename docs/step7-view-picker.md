# Step 7: interaction and bench, the view picker (plan before code)

**Status:** for dot's check (dot 1791656235 asked for the view-switching flow first). Nothing is coded until dot has checked it.

**Inputs:**
- bowen 1791637819 / 1791640911: a nine-view editor; draw and edit in any view.
- Architecture §2: interaction holds the current mode and current view and passes it to every edit. Bench and visual are throwaway glue (bowen 1791477975).
- Core API from steps 1–6: `editIn(view, fn)`, `in(view)` reads, `views()`, `broadcastStroke`.

## Rules (interaction)

1. **The current view is held by the app and given to interaction** as `env.view()`, explicit like `env.layer()`. It is required, with no default; old tests pass `'view:0,0'` themselves.
2. **Every read goes through `core.in(env.view())`:** snapshot, nearby (hit-testing), linesInRect (box select), loopsAt (fill pick), copy, preview points and handles. **Every commit goes through `core.editIn(env.view(), fn)`.**
3. **An unfinished operation records its view** along with its Core: `Owned = { core, view }`. It stays valid only while both are current (explicit targets, dot 1791543494).
4. **Switching the view** (`ix.viewChanged()`, called by the app):
   - ends what belongs to one view: a drag, the picks of a two-click tool, the pen chain, the mirror source;
   - keeps what does not: the selection (by id, in core), the clipboard, a pending cut (moving groups is structural and allowed in any view).

   Switching is not an edit and adds no undo step.
5. **Refusals keep their path:** e.g. `mirror-front-only` or `select-lines-to-broadcast` become the usual feedback.
6. **Stroke broadcast:** an interaction action `broadcastStroke()` commits `e.broadcastStroke()` in the current view on the selection.

## Bench (glue)

- A 3 × 3 view picker: columns yaw −90 / 0 / +90, rows pitch +45 / 0 / −45, showing the current view. Picking calls `viewChanged()`.
- The canvas draws `core.in(view)`: geometry, snapshot points and handles.
- A "Broadcast stroke" button.
- Panel edits (rename, state, stroke…) go through `editIn(view)`.

## Read / write paths

| Path | Reads / writes |
|---|---|
| hit-test, preview points / handles | `in(view).nearby / snapshot` |
| box select | `in(view).linesInRect` |
| fill pick | `in(view).loopsAt` |
| copy | `in(view).copy` (carries every layer) |
| every commit | `editIn(view, …)` |
| canvas | `in(view).geometry / snapshot` |

## Tests

- **Interaction:**
  - a drag in the side view moves the point there only;
  - hit-testing picks a point at its side-view position while the side view is current, and not at its front position;
  - box select uses the current view;
  - switching views mid-drag ends the drag with nothing committed, and ends the pen chain and two-click picks;
  - a pending cut and the selection survive a switch;
  - a mirror apply attempt off the front shows `mirror-front-only`.
- **Bench:**
  - the picker shows nine views and switches;
  - the canvas shows the side view's geometry after a side-view drag;
  - the broadcast button makes the front equal the side for the selected line.
