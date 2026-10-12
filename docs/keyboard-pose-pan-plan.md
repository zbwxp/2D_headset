# Keyboard: turning the view in playback — rules before code

The two stages left of bowen 1791733125 ("everything the mouse can drag, the keyboard can move"; tracked in `docs/move-plan.md`). Directions chosen by bowen 1791768754:
- **Playback:** no point is selected; moving with the keys is **grabbing the point in the coord grid** (the pose pad) and moving it — turning the view. So the arrows move the pose, not a point of the drawing (this replaces the "keyboard correction" stage: the correction drag keeps the mouse only).
- **"背景":** bowen 1791768870 — the background picture: its Move picture moving is right, and it must use the same move code. It does: the picture's drag and arrows, the selection's drag and arrows and the box's handle drags are all `createMover` sessions of the one `move/` module, each with its own target (told bowen 1791768893 and after). So ⌘ + arrows was not a request for the view; part 2 is dropped (bowen 1791768959).

Both are bench-only (glue, `bench/src/app.tsx`): nothing in core, interaction, `move/` or `pose-pad/` changes; neither writes the drawing.

## 1. Playback: the arrows move the pose

- **Keys:** in playback, a plain arrow (no ⌘) moves the pose as the pad's handle would move: **→ yaw +, ← yaw −, ↑ pitch +, ↓ pitch −** (the pad: left = −90, top = +45).
- **Steps:** 1°; **Shift** ×10 (10°). The pose is whole degrees (pad, sliders, fields), so **Option / Ctrl** has no finer step here: 1° as the plain key (stated; bowen may ask for 0.1° — the pose would then leave whole degrees everywhere). Clamped to the limits (±90, ±45); at a limit the key changes nothing.
- **Each press and each repeat** of a held key takes effect at once, as each move of a pad drag does: through `changePose(next, 'keys')` — the one place that sets the pose and both fields' text; the pad's handle and the sliders follow. No session and no commit: nothing is written (the drawing's text, the history and autosave's write count unchanged), so there is nothing to undo or cancel.
- **One input at a time:** while a mouse gesture runs (a correction drag, a pad drag, a pan or zoom drag) the arrows are ignored, as for the move sessions (`docs/move-plan.md` §1); a key never cancels a running drag.
- **Keys that stay elsewhere:** an arrow on a focused field or slider is that control's (the existing rule: the yaw slider steps the yaw itself); a typing field or an input method keeps its keys; ⌘ + arrow does nothing (not a move, §2).
- While restoring: nothing (the restoring gate comes first, as now).
- The correction's `REACH`, picking and drag are unchanged; a pose change by key ends nothing (no gesture runs when it is taken).

## 2. The view's pan: no keys (bowen 1791768959)

"画布平移右键拖动够了。不用再搞别的" — the right / middle drag stays the pan; no keyboard pan. ⌘ + arrow stays what it is: not a move.

## Not now

- 0.1° pose steps; panning or zooming by keys (bowen 1791768959: the right drag is enough; Z exists).

## Tests (bench)

- Playback: → / ← / ↑ / ↓ change yaw / pitch by 1 in the pad's directions; Shift by 10; Option and Ctrl by 1; clamped at ±90 / ±45; a held key's repeats each step; the pad's handle, the sliders and both fields show the new pose; the drawing's text, the history and autosave's write count unchanged.
- An arrow during a correction drag and during a pad drag changes nothing and cancels nothing; an arrow on the focused yaw slider is the slider's (one step, not two); while restoring nothing.
- Feature-off: without the playback arrow route the pose test fails.
