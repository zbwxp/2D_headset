# One slider for the whole program — rules before code

Asked by bowen 1791769016: every slider in the program is one module, and the others use it; each can **take a typed number**, **slide**, and, **once selected (focused), move by keyboard**. bowen 1791769065: the slider's moving uses the move code written before — **both the slide and the keys are `move/` sessions** (as bowen 1791768870: one move code, not written twice), the same steps and the same one-undo-per-run as the selection and the picture.

Order: this is the package after the playback arrows (`docs/keyboard-pose-pan-plan.md`); it stays a plan until that one is accepted. The playback arrows and this slider's runs are both `move/` key runs; each passes its own sizes (single / long / short, bowen 1791769146).

## What exists today (bench)

| Where | Parts | Writes |
|---|---|---|
| Playback yaw, pitch | a range input (step 1, ±90 / ±45) and a text field (red while not a valid angle) | nothing (the pose is the view's) |
| Reference picture x, y, scale, angle, opacity | a number field and a range input each; scale's range is log10 | a preview while dragging or typing; **one** `setReference` on release / Enter / blur; Esc puts it back |
| Stroke width, arc join radius | a number field only | each change at once |

Two slider places, written twice with different rules (the pose field validates; the picture's field previews and commits on blur).

## The module, `slider/`

A small package beside `pose-pad/` and `rename/`: one React component, `<Slider>`. It knows nothing of the drawing; the caller says what a value does.

- **Props:** `value`, `min`, `max`, `step` (the track's step and the keyboard's unit), `precision` (the smallest value kept, e.g. 1 for whole degrees; values are rounded to it), `scale: 'linear' | 'log'` (the track's mapping; the number shown and typed is always the real value), `label`, and three callbacks: `onPreview(v)` (a value to show, nothing kept), `onCommit(v)` (the value to keep: one write for a drawing value), `onCancel()` (back to `value`).
- **Typing:** the number field shows `value`; typing previews each valid number (a finite number within `[min, max]`; `""`, `"-"` change nothing, the field shown red); **Enter or leaving the field commits**, **Esc cancels** and shows `value` again. Out-of-range typed numbers are refused (red), not clamped.
- **Sliding — a `move/` drag session:** the track is the module's own (a bar and a thumb, not a native range input, whose drag cannot be a `move/` session): a press on the thumb or the bar starts a drag (a press on the bar first jumps the thumb there, as a native slider does); the pointer's horizontal displacement in pixels is the session's offset, turned into a value through the track's width and `scale`; each move previews, the release commits once; Esc, blur and a second pointer end it as the other drags. The thumb is focusable (`role="slider"`, `aria-valuenow` / `min` / `max`).
- **Keyboard, once focused** (the track or the field — a focused control is "selected"): ↑ / → add, ↓ / ← subtract — a **`move/` key run** with this slider's own sizes passed in (bowen 1791769146): props `steps = { step, long, short }` (single, Shift, Option / Ctrl), held keys repeat, so a held run previews each step and **commits once on the last release** (one undo step), Esc / blur cancel it. Values are rounded to `precision`; a step smaller than it still moves one `precision` in its direction. Clamped to `[min, max]`.
- **One value, three inputs, one ending:** whichever input runs (typing, sliding, a key run), a new one first ends the running one by its own ending (commit for the slide / run, as their release would; typing commits on leaving the field). `value` changing from outside (undo, another view) during none of them simply shows the new value.

## Who uses it

- **Playback yaw / pitch:** `precision 0.1`, `step 1` (the pose takes decimals; dot 1791769046); `onPreview` and `onCommit` both `changePose` (nothing is written; the pad and the other slider follow). The field's existing rules (red while invalid, keeping its own text while typed) become the module's.
- **Reference x, y, scale, angle, opacity:** `onPreview` → today's `previewRef`, `onCommit` → `commitPreview`, `onCancel` → `cancelPreview`; scale `scale: 'log'`; ranges as today. Its bindings (`RefBind`, a picture changed underneath) stay the bench's, unchanged.
- **Stroke width, arc radius** have no slider now — **asked of bowen** whether they become sliders too (no natural maximum: a range would have to be chosen) or stay number fields.

## Not now

- Dragging on the number itself (Blender / Figma "scrubbing"); a wheel over the slider; units.

## Tests

- Package (DOM): typed valid / invalid / out of range; Enter, blur commit once, Esc cancels; a drag on the thumb previews on each move and commits once on release, a press on the bar jumps then drags, Esc / blur / a second pointer end it; log scale maps both ways; focused arrows: the sizes given (two sliders with different sizes), precision rounding, clamping, a held run one commit, Esc / blur cancel it; a new input ends the running one; an outside `value` change is shown.
- Bench: yaw / pitch through the module — the pad and fields follow, nothing written; the picture's x, y, scale, angle, opacity — a held arrow on a focused slider is one `setReference` (one undo step), typing + Enter one, a slide one, Esc none; the existing reference and playback tests pass unchanged. A boundary test: no `type="range"` left in the bench outside the module. A boundary test: the module imports `move/` and nothing else of the program. Feature-off: with the keyboard run removed, the one-undo test fails; with the slide not a `move/` session (a plain range input), the slide's Esc test fails.
