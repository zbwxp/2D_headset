# One slider for the whole program — rules before code

Asked by bowen 1791769016: every slider in the program is one module, and the others use it; each can **take a typed number**, **slide**, and, **once selected (focused), move by keyboard**. bowen 1791769065: the slider's moving uses the move code written before — **both the slide and the keys are `move/` sessions** (as bowen 1791768870: one move code, not written twice). bowen 1791769146: the step sizes are **passed in** (single / long / short). bowen 1791769257: stroke width and the arc radius stay number fields, with arrow keys adding and subtracting — "a vertical slider": the same module **without a track**.

Order: this is the package after the playback arrows (`docs/keyboard-pose-pan-plan.md`); it stays a plan until that one is accepted.

## What exists today (bench)

| Where | Parts | Writes |
|---|---|---|
| Playback yaw, pitch | a range input (step 1, ±90 / ±45) and a text field (red while not a valid angle) | nothing (the pose is the view's) |
| Reference picture x, y, scale, angle, opacity | a number field and a range input each; scale's range is log10 | a preview while dragging or typing; **one** `setReference` on release / Enter / blur; Esc puts it back |
| Stroke width, arc join radius | a number field only | width: the field's own state, applied by "Set width"; radius: the join tool's option |

## The module, `slider/`

A package beside `pose-pad/` and `rename/`: one React component, `<Slider>`. It imports React and `move/` only; it knows nothing of the drawing.

### Props

- `value` — the value as it is; `identity` — what it belongs to (e.g. a picture's id and source plus the field's name); `version` — anything the app changes when the value is changed from outside (the picture: its drawing's change counter; the pose: none).
- **What ends a session from outside** (dot 1791769272 §2, 1791769582 §1): `identity` changing, `version` changing, or `value` arriving different from **the session's own last preview** — the same identity's value changed by someone else (undo, another view, another App) is not taken for an echo. Each **cancels** the session, and a cancel **only withdraws the preview** (`onCancel`): it never writes, and never puts an old value back over the new one. `value` arriving equal to the session's last preview is its own echo and changes nothing.
- `accept(v) → boolean` — **the caller's own check** of a value (dot 1791769582 §3: an interval cannot say "> 0 and a finite size after scaling"); and `track: [lo, hi] | null` — the slide's range, or `null` for the field-only form (dot §3: **the track's range is not the accepted range**; the module never narrows what was accepted before).
- `scale: 'linear' | 'log'` — the track's mapping (log: the thumb moves in log10 of the value).
- `steps: { step, long, short }` — single / Shift / Option or Ctrl, passed in (bowen 1791769146), in the units the keys act in (below). Shift with Option / Ctrl is the single step (as `move/`). **Nothing is rounded to a step** (dot 1791769582 §2): a linear value keeps its own decimals — a step is added in whole units of the finer of the value's and the step's decimal places (as the playback arrows, dot 1791769354), so opacity 0.25 with a 0.1 step is 0.35 and no float tail shows; a log value is `start × 10^offset` (below), never rounded, so a legal 0.0001 stays 0.0001.
- `label`.
- The app's hooks, as `pose-pad`'s (dot §1): `onStart(d: { input: 'drag' | 'keys' | 'typing'; pointerId?: number; cancel(): void }) → boolean` — the app may **refuse** (another gesture runs, the target is gone) and takes the session's **cancel** into its one gesture slot; `onPreview(v)`; `onCommit(v)`; `onCancel()`; `onEnd(cancel)` — the session ended, the app frees its slot.

### One session at a time

- **Typing, a slide and a key run are each a session** on this slider. While one runs, the slider's other inputs are ignored (a second pointer is ignored and never ends the first; keys during a slide are taken and ignored, as `move/`); a new input elsewhere goes through the app's slot, whose cancel ends this session **by cancelling it — never by forcing a commit** (dot §1).
- **Ends with a write only through its own ending:** a slide's release, a key run's last key up, typing's Enter or leaving the field. Every other end is a cancel: Esc, blur (a slide or a key run), `identity` changing, undo / redo, a document or view change, playback starting / ending where it applies, unmount (the module cancels on unmount; listeners removed). **A late release or key up after a cancel writes nothing** (the `move/` session is ended first).
- **No change, no write** (dot 1791769298): a session whose final value equals its start calls `onCancel`, not `onCommit`.
- **The commit takes the final value** (dot 1791769298): a slide commits the value at the release position (`move/`'s release computes the offset there), not the last preview.

### Typing

- The field previews each number `accept` takes; `""`, `"-"` and refused text show the field red and change nothing.
- **Typing is not a gesture** (dot 1791769582 §5): it does not take the app's gesture slot, so a press on another control cannot cancel it before the field's blur — **leaving the field always commits a valid typed value** (blur), whatever the browser's order of pointerdown and blur. The slide and the key run do take the slot.
- **Enter or leaving the field commits** the shown value; **Esc cancels** and shows `value` again. Enter then blur commits once (the session ended at Enter).
- **Valid, then invalid** (dot 1791769298): after a valid preview, if the text is invalid when the field is left or Enter is pressed, the session is **cancelled** (`onCancel`: back to `value`); the earlier valid preview is not committed.
- In the field, **↑ / ↓** step from the value shown (the typed value if valid, else `value`) — a `move/` key run that **only previews** inside the field's session: it changes the text, and the field's own ending (Enter or leaving) is the one write. So typing then ↑ / ↓ then Enter writes once. **← / →** move the caret, as in any text field.

### Sliding — a `move/` drag session

- The track is the module's own (a bar and a thumb; a native range input's drag cannot be a `move/` session).
- **On the thumb:** the grab offset is kept (a press off the thumb's centre does not jump).
- **On the bar:** the thumb jumps to the press (as a native slider does) — **that jump is a change: a click on the bar with no drag commits once** (dot §5; the "no movement = nothing" rule of a plain `move/` drag would lose it), and dragging on continues from there.
- The pointer's horizontal displacement in pixels is the session's offset, turned into a value through the track's width and `scale`, clamped to `track`. Each move previews; the release commits.

### Keys — a `move/` key run

- **Focused thumb:** → / ↑ add, ← / ↓ subtract. **Focused field:** ↑ add, ↓ subtract (above: previews only, the field writes).
- **The thumb keeps its keys from the app** (dot 1791769582 §4): the thumb is not an `INPUT`, so the bench's key guard would not see it; the module stops its arrow keys, Esc and its key-ups from reaching the window's handlers (`stopPropagation`), and the bench's guard also treats `role="slider"` as a control, so an arrow on the thumb never moves the selection, the picture or the pose. An input method's composing keys in the field stay the field's.
- A held key repeats; the run previews each step and **commits once on the last key up** (one undo step, one write); Esc / blur cancel it.
- **A step `accept` refuses is not taken** (dot 1791769582 §3): the value stays at the last accepted one — an overflow to Infinity, a log step down to 0, a scale whose size is no longer finite are never previewed or committed.
- **What a key step acts in** (dot §4): a linear slider steps its value; **a log slider steps the log10 of the value** (the same way the thumb moves): the value is `start × 10^offset`, the offset counted exactly by `move/`, so a run back to its start gives exactly `start`; scale's `{ step 0.01, long 0.1, short 0.001 }` multiply the value by about ×1.023, ×1.26, ×1.0023.
- An arrow on a focused slider never also moves the drawing's selection or the picture (the bench's key handler already leaves arrows on focused controls to them; tested).

## Who uses it — units and sizes

The picture's `accept` is core's own rules (`src/reference`: x, y, angle finite; scale > 0 with a finite size; opacity 0–1) — the module refuses what core would refuse and nothing more.

| Control | Track | Accepted (`accept`) | Steps (single / long / short) | Ending |
|---|---|---|---|---|
| Playback yaw | ±90 | ±90 | 1° / 10° / 0.1° | preview and commit `changePose` (nothing written); `onCancel` keeps the last pose — a view, as the grid and the arrows (dot 1791769205); **`changePose` from the slider's own session does not cancel that session** (dot 1791769272) |
| Playback pitch | ±45 | ±45 | 1° / 10° / 0.1° | as yaw |
| Picture x, y | the visible box (as today) | any finite (off screen allowed) | 1 / 10 / 0.1 drawing units | preview → `previewRef`, commit → `commitPreview` (one `setReference`), cancel → `cancelPreview`; refused by `onStart` when the picture changed (`RefBind`) |
| Picture angle | ±180 | any finite | 1° / 10° / 0.1° | as x |
| Picture scale | log10 −3 … 2 | > 0 | log10 0.01 / 0.1 / 0.001 | as x |
| Picture opacity | 0 … 1 | 0 … 1 | 0.01 / 0.1 / 0.001 | as x |
| Stroke width | none | > 0 | 1 / 10 / 0.1 | the field's own value only; **"Set width" still applies it** to the selected lines (dot 1791769298) |
| Arc radius | none | > 0 | 1 / 10 / 0.1 | the join tool's option (`ix.setOptions`) |

## Not now

- Dragging on the number itself ("scrubbing"); a wheel over the slider; a vertical drag for the field-only form.

## Tests

- Package (DOM): typed accepted / refused (accepted beyond `track`); typing then ↑ then Enter one write; a press on another control while typing commits by blur (both event orders); a value changed from outside during a session (same identity, a different value; `version` changed) cancels it and shows the new value, never the old; a step `accept` refuses (log scale toward 0, overflow) not taken; a log run back to its start exactly `start`; 0.0001 kept; an arrow on the real thumb not reaching the window (the selection, picture and pose unmoved); an input method's keys in the field the field's; Enter then blur one commit; Esc cancels; valid then invalid then leave → cancel; ↑ / ↓ in the field, ← / → the caret; a thumb drag keeps the grab offset, previews each move, commits the release's value; a click on the bar with no drag commits once; a second pointer ignored and not ending the first; log mapping both ways and log key steps; keys with the given sizes (two sliders, different sizes), Shift + Option = single, no float tail,  a held run one commit, Esc / blur cancel; no change → `onCancel`; `identity` changed during a session → cancelled, a late release writes nothing; the session's own `value` echo not shown over it; `onStart` refusing starts nothing; unmount during a session cancels and leaves no window listener (counted by type, callback and capture).
- Bench: yaw / pitch through the module — the pad and fields follow, nothing written, the slider's own `changePose` does not cancel its session; the picture's x, y, scale, angle, opacity — a held arrow on a focused slider is one `setReference` (one undo step), typing + Enter one, a slide one, a bar click one, Esc none; x typed off screen and angle 400 accepted as before; undo, a view change and the picture removed during a session cancel it; an arrow on a focused slider does not move the selection; stroke width ↑ changes the field, not the lines, until "Set width"; arc radius ↑ changes the option; the existing reference and playback tests pass unchanged. A boundary test: no `type="range"` in the bench outside the module, and the module imports `move/` and nothing else of the program. Feature-off: with the keyboard run removed, the one-undo test fails; with the slide not a `move/` session, the slide's Esc test fails.
