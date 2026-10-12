# Keyboard: turning the view in playback, panning the view — rules before code

The two stages left of bowen 1791733125 ("everything the mouse can drag, the keyboard can move"; tracked in `docs/move-plan.md`). Directions chosen by bowen 1791768754:
- **Playback:** no point is selected; moving with the keys is **grabbing the point in the coord grid** (the pose pad) and moving it — turning the view. So the arrows move the pose, not a point of the drawing (this replaces the "keyboard correction" stage: the correction drag keeps the mouse only).
- **⌘ + arrows:** "背景" — read as the view (the canvas's camera); asked to confirm (1791768781). If bowen meant the background picture, part 2 changes target, not its rules.

Both are bench-only (glue, `bench/src/app.tsx`): nothing in core, interaction, `move/` or `pose-pad/` changes; neither writes the drawing.

## 1. Playback: the arrows move the pose

- **Keys:** in playback, a plain arrow (no ⌘) moves the pose as the pad's handle would move: **→ yaw +, ← yaw −, ↑ pitch +, ↓ pitch −** (the pad: left = −90, top = +45).
- **Steps:** 1°; **Shift** ×10 (10°). The pose is whole degrees (pad, sliders, fields), so **Option / Ctrl** has no finer step here: 1° as the plain key (stated; bowen may ask for 0.1° — the pose would then leave whole degrees everywhere). Clamped to the limits (±90, ±45); at a limit the key changes nothing.
- **Each press and each repeat** of a held key takes effect at once, as each move of a pad drag does: through `changePose(next, 'keys')` — the one place that sets the pose and both fields' text; the pad's handle and the sliders follow. No session and no commit: nothing is written (the drawing's text, the history and autosave's write count unchanged), so there is nothing to undo or cancel.
- **One input at a time:** while a mouse gesture runs (a correction drag, a pad drag, a pan or zoom drag) the arrows are ignored, as for the move sessions (`docs/move-plan.md` §1); a key never cancels a running drag.
- **Keys that stay elsewhere:** an arrow on a focused field or slider is that control's (the existing rule: the yaw slider steps the yaw itself); a typing field or an input method keeps its keys; ⌘ + arrow is part 2.
- While restoring: nothing (the restoring gate comes first, as now).
- The correction's `REACH`, picking and drag are unchanged; a pose change by key ends nothing (no gesture runs when it is taken).

## 2. ⌘ + arrows pan the view, in every mode

- **Keys:** ⌘ + arrow (Mac; `metaKey` without Ctrl — Ctrl + arrow stays the slow move). A viewport tool: it changes only the camera, so it acts in editing, playback, restoring and with Move picture alike (the rule of `docs/pose-pad-plan.md`, "Viewport tools").
- **Direction:** the drawing moves **with the arrow**, as the hand's drag moves it with the pointer (bowen frames keys as the mouse's drag); ⌘ → shows more of the left. (The other convention — scrolling, the view moving with the arrow — is the alternative if bowen finds this backwards.)
- **Steps in screen pixels**, so a step feels the same at any zoom: 40 px; **Shift** ×10 (400 px); **Option** ×0.1 (4 px). Converted with the canvas's current scale (`box.w / clientWidth`), as the mouse pan does.
- Each press and repeat pans at once; nothing written, nothing to undo; the hover is asked again after the render (as after a mouse pan).
- **One input at a time:** ignored while any gesture runs (a mouse drag or a key run), so a pan never shifts the screen-to-drawing mapping under a drag.
- **The browser's own ⌘ + ← / →** (back / forward in Chrome on a Mac) must not fire: the bench prevents the key's default. To be checked in Chrome — if the browser takes it anyway, the plan comes back.
- Arrows on a focused field / slider and typing keep their keys, as now (⌘ + arrow in a text field stays the field's).

## Not now

- 0.1° pose steps; pan by keys while a gesture runs; zoom by keys (Z exists).

## Tests (bench)

- Playback: → / ← / ↑ / ↓ change yaw / pitch by 1 in the pad's directions; Shift by 10; Option and Ctrl by 1; clamped at ±90 / ±45; a held key's repeats each step; the pad's handle, the sliders and both fields show the new pose; the drawing's text, the history and autosave's write count unchanged.
- An arrow during a correction drag and during a pad drag changes nothing and cancels nothing; an arrow on the focused yaw slider is the slider's (one step, not two); while restoring nothing.
- ⌘ + arrow pans the view by 40 screen px at two zooms (the same on screen), Shift 400, Option 4, in editing, playback and with Move picture; the drawing unchanged; ignored during a drag and during a key run; ⌘ + arrow is not a move of the selection or the picture (the existing tests); the key's default prevented.
- Feature-off: without the playback arrow route the pose test fails; without the ⌘ route the pan test fails.
