# Rename by double-click, and tool cursors — rules before code

**§2 coded** (for dot's check, after §1): `cursor/index.ts` (no imports), the bench canvas asks `cursorFor`; tests `cursor/test/cursor.test.ts` (5), `bench/test/cursor.test.tsx` (5). Checked in Chrome on port 5199: the computed cursor is the image (not the fallback) for Pen and Fill and both images decode at 24 × 24; V shows grab, grabbing while a press on a point is held, grab after release.

**§1 coded** (for dot's check): `rename/index.tsx`, used in `visual/LayersPanel.tsx` (layer, curve, line rows) and the bench's slot names; the Rename line / Rename curve buttons removed. Tests `bench/test/rename.test.tsx` (16), `rename/test/boundary.test.ts`; in `bench/test/reference-move.test.tsx` the slot test renames by double-click and a new test opens a drawing during a slot edit. Checked in Chrome on port 5199: double-click a curve name, type, Enter renames; Esc cancels; letters typed in the field do not switch tools.

Asked by bowen 1791708333: (1) curves and lines are renamed by double-click like layers, with renaming pulled out into a small package others call; (2) Pen, Fill, A and V change the cursor (pen, paint bucket, hand; the hand grabs while pressed), in its own package that every tool asks, falling back to the default arrow.

## 1. `rename/` — one way to rename a name shown in a list

**Now:** a layer's name is renamed by double-click (`visual/LayersPanel.tsx`, an inline field). A continuous curve or a line is renamed by the bench buttons **Rename curve** / **Rename line**, which open the browser's `prompt`. A reference picture's slot is renamed by double-click, also with `prompt`. Three ways for one action (bowen: "不理解为什么做成两种").

**Package:** `headset-core/rename/` beside `visual/`, one React component, `<Rename name onRename title? />`.
- Shows the name; **double-click** turns it into a text field with the name selected.
- **Enter** or leaving the field commits **once**; **Esc** cancels. The value is trimmed; empty or unchanged commits nothing.
- It never decides whether a name is allowed: it calls `onRename(newName)`, and the caller passes it to core (a taken or empty name is refused by core and shown in the status line, as layers do now).
- A click on the name still reaches the row (selection works as before); only the double-click edits.
- It knows nothing of core, layers or lines: it imports React only.
- **Boundaries** (dot 1791708548): with an input method, the Enter that picks a word does not commit; keys typed in the field never reach the tool shortcuts — the field itself stops every key from bubbling, before the input-method check, so it does not rely on a caller's typing check (dot 1791709183); Enter then a blur commits once, Esc then a blur commits nothing. An edit belongs to the name it started from: if that name changes under it (an undo), the field closes and the edit is dropped; if the row goes (the object deleted, another drawing opened: the layers panel and each slot name are remounted per drawing), nothing is written, so an old edit never reaches the same id in another drawing. Core's refusals are shown as before.

**Used by:** the layer row, the continuous-curve row and the line row in the layers panel (`visual/`), and the slot name in the bench's reference panel. The bench's **Rename curve** / **Rename line** buttons and every `prompt` used for renaming are removed: one way only.

**Tests (DOM):** double-click → field with the name; Enter commits once (a following blur does not commit again); blur commits; Esc cancels and commits nothing; trimmed; empty / unchanged commit nothing; a single click does not edit and still reaches the row; the name shown follows the document (undo after a rename shows the old name). In the panel: a curve and a line renamed by double-click change in the drawing and undo in one step; a taken name is refused and shown. Feature-off check: without the double-click handler the curve/line tests fail.

## 2. `cursor/` — which cursor a tool shows

**Now:** the canvas shows the default arrow for every tool, except Zoom (`zoom-in`), set inline in the bench.

**Package:** `headset-core/cursor/`, no React, no imports: one function, `cursorFor(tool: string, pressed: boolean): string`, returning a CSS `cursor` value. The table is the only place a tool's cursor is defined:

| tool | not pressed | pressed |
| --- | --- | --- |
| `pen` | pen (an SVG drawn into the package, hotspot at the nib) | same |
| `fill` | paint bucket (SVG, hotspot at the pouring tip) | same |
| `A`, `V` | open hand (`grab`) | closed hand (`grabbing`) |
| `Z` | `zoom-in` (moved here from the bench) | same |
| any other tool, or an unknown name | `default` (the arrow) | `default` |

Each SVG cursor has a CSS keyword fallback (`crosshair` for the pen and the bucket), so a browser that refuses the image still shows something.

**Boundaries** (dot 1791708548): the grab is set where a gesture the tool took starts and cleared in the gesture's one `stop` (release, pointercancel, Esc, leaving the window, a new press, a tool change, entering playback, unmount), so it never sticks; in playback the canvas shows the arrow whatever tool was left on.

**The bench asks it** for the canvas: `cursor: cursorFor(zoomTool ? 'Z' : ix.tool, pressed)`, where `pressed` is true from a left press that the tool took on the canvas until its release or cancel (the gesture the bench already tracks). Panning with the middle or right button is unchanged. A new tool gets a cursor by adding one row to the table; without a row it shows the arrow.

**Tests:** the table (each tool, pressed and not, an unknown tool → `default`); the bench canvas shows the pen / bucket cursor after choosing Pen / Fill, `grab` for A and V, `grabbing` while a press with A or V is held and `grab` again after release or cancel, the arrow for Split. Feature-off check: the bench test fails if the canvas does not ask `cursorFor`. Checked once in a real browser (the cursor images load, hotspots in the right place).

## Not in scope

- Cursors over handles or points (hover feedback), and cursors for the middle/right-button pan: not asked.
- Icons on the tool buttons: not asked (the buttons keep their text).
- With **Move picture** on, a press moves the reference picture, but the canvas keeps the tool's cursor (e.g. the pen). Not asked; recorded for bowen.

## Order

Autosave is awaiting dot's final run (dot 1791706490). Per dot 1791684959 the next package is not written before the previous is accepted; this plan is sent now, code starts when dot OKs it and lets it start. `rename/` first, then `cursor/`, each accepted separately.
