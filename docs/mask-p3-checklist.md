# Masks (蒙版) — package 3: picking follows what is drawn (checklist before any code, for dot's review)

Packages 1 (geometry and drawing, 29baaf3) and 2 (relations in the drawing and the panel, 053c572 / 38ce2fb / f2ddef3) are accepted. Until now a part a mask hides can still be hovered and clicked (package 1 checklist §3). Package 3 makes picking match the picture: what is not drawn cannot be picked. Rules kept few (bowen 1791902281); problems found on real drawings are shown, not chased.

## 1. One question from interaction to the drawing
- `Env` gains one optional hook: **`cut?(target, at, reach)`** — whether the drawing of `target` is out of reach of the pointer `at`, in the current view, because of masks. `target` = `{ kind: 'line', id }` or `{ kind: 'fill', id }`; `reach` = the line hit radius in drawing units.
  - **A line** (revised, dot 1791907560: not the centre point nearest the pointer — a wide line half cut keeps its other half): cut when the line has masks and **its masked ink** (the outline as drawn) is farther than `reach` from the pointer. A line without masks is never cut (picking as today).
  - **A fill:** cut when the click point `at` is outside its drawn (masked) area.
- **Interaction stays free of masks** (graph: masks are visual, the 显隐 module): it only asks. Without the hook — or with the bench's 蒙版 switch or 墨迹轮廓 off — nothing changes: picking matches what is drawn either way.
- **The bench answers from what it drew** (the drawing's masks, each source fill's area in this view, read before any mask; Q33): a line's masked ink piece from the render of this drawing and view (kept with its core and view; any other core or view → not cut), a fill's masked area likewise. Every write through the bench drops it (dot 1791907635: the same view with a source just reshaped or switched must not use the old cut); the next render keeps the new one. Between a write and that render the cut is **computed again from the drawing as it is** (revised, dot 1791908685: a width typed and committed by the same canvas press that picks must still pick by the masks) — never an old cut, never "not cut" for want of one.

## 2. What follows it
- **Lines — hover and click** (V, A, and every step tool that picks a line: split, join, fill's line picks, merge / link line ends…; all go through `ctx.shown`): a line within reach counts only if its masked ink is still within reach of the pointer. A cut line drops out, so **whatever is under it can be picked** (the next line within reach).
- **Fills — the fill tool's click** (`loopsAt`): a loop whose drawing is cut at the click point is skipped; the next loop containing the point is taken.
- **Points and Bézier handles: unchanged.** They are editing marks drawn on top for the tools that use them (POINT_TOOLS, A's handles), not part of the picture.
- **The selection box: unchanged — it does NOT follow the visible ink** (it selects by geometry, hidden parts included; stated in the hand-in; recorded as a known limit — a box is a way to gather lines to edit, and selecting a line whose visible part is outside the box is rare). Revisited if bowen meets it.
- **Join pieces (arcs, tips):** picking is by line, not by ink piece; an arc cut with its two lines (package 1 §2) follows from its lines. Not separately handled.

## 3. Evidence
- interaction (a fake `cut` hook): a cut line at the pointer is not hit and the line under it is; no hook = as before; points and handles still hit where a line is cut.
- bench (dot 1791907560): **a wide line with only half left** (width 10, an inverse mask over y ≥ −1): a click at y = −3 hits it, a click at y = +3 does not; **near the cut edge**: a click just past the cut, within the reach of the remaining ink, hits; beyond it does not.
- bench: the square-and-line scene of package 1 — with 蒙版 on, a click inside the square on the cut line selects nothing (or the square's own line under it), outside the square selects the line; with 蒙版 off, inside selects the line; a source fill turned off makes the line pickable again; the fill tool skips a cut fill.
- 126.json through the bench on 5199: hover across the front view where the side-face line is hidden — no hover mark; a short note and screenshot in the hand-in.

## 4. Not in package 3
The selection box by visible parts; stroke display intervals; lines' stroke areas as sources; mirror.
