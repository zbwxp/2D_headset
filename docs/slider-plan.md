# One slider for the whole program — rules before code

**Module blur** (dot 1791772430, 1791772443): the module ends its own thumb run when the window loses focus (a window `blur` listener for the run, removed at its end and on unmount); the app's own cancel after it is a no-op. Test in `bench/test/slider.test.tsx`.

Three code commits → `docs/slider-problems.md` (the events × states table this package lacked).

**Review fixes** (dot 1791771773, 1791771918, 1791771994, 1791772095, 1791772141 — eight kinds, one commit): (1) a run's last key up with a net-zero raw offset (↑ refused, ↓ taken) is its own ending — the applied value is written; (2) an input method's keys in the field and on the thumb are its own; (3) a thumb key run (`SLIDER_KEYS`) is a key run for blur, ⌘Z / ⇧⌘Z, the Undo / Redo buttons, an input method, focus into a field and a layer change (`isKeyRun`); (4) a slide's release recomputes the value at the release point (40 → 80 → back to 40 writes 40); (5) this slider's own write coming back through `value` is its echo (acknowledged once), so its own field ended at its own bar's press leaves the slide running, which starts from that written value; (6) an outside change is any `value` other than what the session expects — its start before any preview, its last preview after one (dot 1791772141: the start is no lasting exemption) — or this slider's own write coming back; no valid preview needed (invalid text only, a thumb pressed and not moved, only refused steps); (7) while a slide or a thumb run runs, its own field takes no typing, Enter or ↑ / ↓. Tests: `bench/test/slider.test.tsx` (+9), `bench/test/slider-bench.test.tsx` (+1, and the old undo-during-run test changed to the key-run rule). Each fix fails a test when removed.

**Coded** (for dot's check; plan passed dot 1791770295, started on dot 1791770469): `slider/index.tsx` (`<Slider>`, `places`, `addExact`) — a field, and with a track a bar and a thumb (`role="slider"`); the field is the open field (`onField`), its ↑ / ↓ a `move/` key run that only previews; the thumb's keys and the slide `move/` sessions holding the app's slot (`onStart` / `onEnd`); each key step on the value as it is now (an applied offset, a refused step not taken), log sliders `start × 10^applied`; a bar click with no drag commits its jump; a slide snaps to the single step; outside changes (`identity`, `version`, a value other than its own last preview) cancel; unmount cancels and removes its listeners. The bench: `sliderHooks` (the slot, `SLIDER_KEYS` for thumb key runs, the one open field ended before any slider start, canvas press, picture press, pad press and every picture or library control — `refAct`, `libAct`); `changePose` lets a thumb session's own updates through (`'slider'`); the key guard treats `role="slider"` as a control; playback yaw / pitch, the picture's x, y, scale (log), angle, opacity, the stroke width and the join radius (fields only) are all the module; `poseText` / `typePose` gone. Tests: `slider/test/boundary.test.ts`, `bench/test/slider.test.tsx` (23), `bench/test/slider-bench.test.tsx` (7), `bench/test/pose-keys.test.tsx` (+1); the old tests that set a native range's value now click the module's bar (`slideTo` / `slideAt`) or read `aria-valuenow`. **A changed outcome to note:** Mirror (or another picture control) during a running *slide* now cancels the slide (the plan: a new input never forces a commit), where the old native slider's preview was written first (dot 1791717133); an open *field* still ends by its own ending, written first. Mutations failing the tests: thumb keys reaching the window, dead travel, the bar click lost, no grab offset, the echo cancelling, outside changes ignored, identity ignored, no unmount clean-up, field keys writing, an invalid ending writing the earlier value, no snap, the open field kept at a slider's start, the slider's own `changePose` cancelling it, a loose scale or opacity check. Not caught by a test of its own: `refAct` / `libAct` ending the open field — the outside-change rule cancels the field after the control's write anyway (two guards, one observable result). Chrome (5199): a real drag on the yaw thumb gave 49, → 50, Shift ← 40; field, pad and status in agreement, nothing written, no scroll.

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
- The app's hooks (dot §1, 1791770098):
  - `onStart(d: { input: 'drag' | 'keys'; pointerId?: number; cancel(): void }) → boolean` — a slide or a thumb key run: the app may **refuse** (another gesture runs, the target is gone) and takes the session's **cancel** into its one gesture slot; `onEnd(cancel)` — it ended, the app frees the slot.
  - `onField(d: { end(): void } | null)` — typing: the field tells the app it is **open** (`end` finishes it exactly as leaving the field would) and, `null`, that it closed. Not the gesture slot (below).
  - `onPreview(v)`, `onCommit(v)`, `onCancel()`.

### One session at a time

- **A slide and a thumb key run are gestures**: they hold the app's slot; while one runs the slider's other inputs are ignored (a second pointer is ignored and never ends the first; keys during a slide are taken and ignored, as `move/`); a new input elsewhere ends it through the slot's cancel — **cancelling it, never forcing a commit** (dot §1).
- **An open field is ended first** (dot 1791770098): before any other input begins or previews — another slider's press or keys, another field's first keystroke, a canvas press — the app ends the open field (`end`: as its blur would — the typed value committed if valid, else cancelled), and only then lets the new input begin. So the old field commits **its own** value, never a preview another control has just put in the shared place (the picture's one `refPreview`), whichever comes first, the new press or the old field's blur: if the blur comes first the field has closed and nothing is open; if the press comes first the press ends it. Tested both orders, the same picture's other field and another picture's.
- **Ends with a write only through its own ending:** a slide's release; a thumb key run's last key up; a field's Enter, leaving it, or its `end` (the same thing). Every other end is a cancel: Esc, blur (a slide or a key run), `identity` changing, undo / redo, a document or view change, playback starting / ending where it applies, unmount (the module cancels on unmount; listeners removed). **A late release or key up after a cancel writes nothing** (the `move/` session is ended first).
- **No change, no write** (dot 1791769298): a session whose final value equals its start calls `onCancel`, not `onCommit`.
- **The commit takes the final value** (dot 1791769298): a slide commits the value at the release position (`move/`'s release computes the offset there), not the last preview.

### Typing

- The field previews each number `accept` takes; `""`, `"-"` and refused text show the field red and change nothing.
- **Typing is not a gesture** (dot 1791769582 §5): it does not take the gesture slot (a slot cancel would throw a typed value away); it is the **open field** (`onField`), ended as above — so leaving it, by blur or by another input's start, always commits a valid typed value, whatever the browser's order of pointerdown and blur.
- **Enter or leaving the field commits** the shown value; **Esc cancels** and shows `value` again. Enter then blur commits once (the session ended at Enter).
- **Valid, then invalid** (dot 1791769298): after a valid preview, if the text is invalid when the field is left or Enter is pressed, the session is **cancelled** (`onCancel`: back to `value`); the earlier valid preview is not committed.
- In the field, **↑ / ↓** step from the value shown (the typed value if valid, else `value`) — a `move/` key run that **only previews** inside the field (it takes no slot): it changes the text, and the field's own ending (Enter, leaving, `end`) is the one write. So typing then ↑ / ↓ then Enter writes once; **leaving the field with ↑ still held** ends the run and commits the shown value once, as leaving does; a later key-up writes nothing. **← / →** move the caret, as in any text field.

### Sliding — a `move/` drag session

- The track is the module's own (a bar and a thumb; a native range input's drag cannot be a `move/` session).
- **On the thumb:** the grab offset is kept (a press off the thumb's centre does not jump).
- **On the bar:** the thumb jumps to the press (as a native slider does) — **that jump is a change: a click on the bar with no drag commits once** (dot §5; the "no movement = nothing" rule of a plain `move/` drag would lose it), and dragging on continues from there.
- The pointer's horizontal displacement in pixels is the session's offset, turned into a value through the track's width and `scale`, clamped to `track`. Each move previews; the release commits.

### Keys — a `move/` key run

- **Focused thumb:** → / ↑ add, ← / ↓ subtract. **Focused field:** ↑ add, ↓ subtract (above: previews only, the field writes).
- **The thumb keeps its keys from the app** (dot 1791769582 §4): the thumb is not an `INPUT`, so the bench's key guard would not see it; the module stops its arrow keys, Esc and its key-ups from reaching the window's handlers (`stopPropagation`), and the bench's guard also treats `role="slider"` as a control, so an arrow on the thumb never moves the selection, the picture or the pose. An input method's composing keys in the field stay the field's.
- **On the thumb**, a held key repeats; the run previews each step and **commits once on the last key up** (one undo step, one write); Esc, and blur **with a key still held**, cancel it (the preview withdrawn, nothing written).
- **Each step moves the value as it is now** (dot 1791770098, as the playback arrows): the run keeps the offset it has **applied** — a step is added to it only when `accept` takes the result. **A refused step is not taken and leaves no dead travel** (dot 1791769582 §3): opacity at 1, ↑ ↑ refused, then ↓ gives 0.99 at once. An overflow to Infinity, a log step down to 0, a scale whose size is no longer finite are never previewed or committed.
- **What a key step acts in** (dot §4): a linear slider steps its value (`start` + the applied offset, the value's own decimals kept); **a log slider steps the log10 of the value** (the same way the thumb moves): the value is `start × 10^applied`, so a run back to its start gives exactly `start`; scale's `{ step 0.01, long 0.1, short 0.001 }` multiply the value by about ×1.023, ×1.26, ×1.0023.
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

- Package (DOM): typed accepted / refused (accepted beyond `track`); typing then ↑ then Enter one write; leaving the field with ↑ held one write, the key-up none; another slider pressed while a field is open — the field commits its own typed value, then the new slider previews — in both event orders (pointerdown first, blur first), for the same picture's other field and another picture's; opacity at 1, ↑ refused twice, ↓ gives 0.99 at once; a value changed from outside during a session (same identity, a different value; `version` changed) cancels it and shows the new value, never the old; a step `accept` refuses (log scale toward 0, overflow) not taken; a log run back to its start exactly `start`; 0.0001 kept; an arrow on the real thumb not reaching the window (the selection, picture and pose unmoved); an input method's keys in the field the field's; Enter then blur one commit; Esc cancels; valid then invalid then leave → cancel; ↑ / ↓ in the field, ← / → the caret; a thumb drag keeps the grab offset, previews each move, commits the release's value; a click on the bar with no drag commits once; a second pointer ignored and not ending the first; log mapping both ways and log key steps; keys with the given sizes (two sliders, different sizes), Shift + Option = single, no float tail,  a held run one commit, Esc / blur cancel; no change → `onCancel`; `identity` changed during a session → cancelled, a late release writes nothing; the session's own `value` echo not shown over it; `onStart` refusing starts nothing; unmount during a session cancels and leaves no window listener (counted by type, callback and capture).
- Bench: yaw / pitch through the module — the pad and fields follow, nothing written, the slider's own `changePose` does not cancel its session; the picture's x, y, scale, angle, opacity — a held arrow on a focused slider is one `setReference` (one undo step), typing + Enter one, a slide one, a bar click one, Esc none; x typed off screen and angle 400 accepted as before; undo, a view change and the picture removed during a session cancel it; an arrow on a focused slider does not move the selection; stroke width ↑ changes the field, not the lines, until "Set width"; arc radius ↑ changes the option; the existing reference and playback tests pass unchanged. A boundary test: no `type="range"` in the bench outside the module, and the module imports `move/` and nothing else of the program. Feature-off: with the keyboard run removed, the one-undo test fails; with the slide not a `move/` session, the slide's Esc test fails.
