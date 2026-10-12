# Keyboard: turning the view in playback — rules before code

The two stages left of bowen 1791733125 ("everything the mouse can drag, the keyboard can move"; tracked in `docs/move-plan.md`). Directions chosen by bowen 1791768754:
- **Playback:** no point is selected; moving with the keys is **grabbing the point in the coord grid** (the pose pad) and moving it — turning the view. So the arrows move the pose, not a point of the drawing (this replaces the "keyboard correction" stage: the correction drag keeps the mouse only).
- **"背景":** bowen 1791768870 — the background picture: its Move picture moving is right, and it must use the same move code. It does: the picture's drag and arrows, the selection's drag and arrows and the box's handle drags are all `createMover` sessions of the one `move/` module, each with its own target (told bowen 1791768893 and after). So ⌘ + arrows was not a request for the view; part 2 is dropped (bowen 1791768959).

Both are bench-only (glue, `bench/src/app.tsx`): nothing in core, interaction, `move/` or `pose-pad/` changes; neither writes the drawing.

## 1. Playback: the arrows move the pose

- **Keys:** in playback, a plain arrow (no ⌘) moves the pose as the pad's handle would move: **→ yaw +, ← yaw −, ↑ pitch +, ↓ pitch −** (the pad: left = −90, top = +45).
- **Steps — `move/`'s, not a second set** (dot 1791769046): a playback arrow run is a **`move/` key run** (`createMover`, `stepOf`): 1°; **Shift** ×10 (10°); **Option / Ctrl** ×0.1 (0.1°); combined keys multiply as there. The pose takes decimals already (the number fields accept them); only the pad's mouse drag rounds to whole degrees, and stays so. Clamped to the limits (±90, ±45); at a limit a step changes nothing.
- **The run's target** (bowen 1791768754: grabbing the coord grid's point): `begin` takes the pose at the first press; `preview(offset)` sets the pose to start + offset (x → yaw, y → pitch; ↑ is +pitch), clamped, through `changePose(next, 'keys')` — the one place that sets the pose and both fields' text, so the pad's handle and the sliders follow at each step and each repeat; `commit` the same; `cancel` (Esc, blur, leaving playback, a pad / slider / field / canvas input) puts back the pose of the run's start. Nothing is written (the drawing's text, the history and autosave's write count unchanged). The run holds the bench's one gesture slot as the other key runs do (`KEYS`).
- **One input at a time:** while a mouse gesture runs (a correction drag, a pad drag, a pan or zoom drag) the arrows are ignored, as for the move sessions (`docs/move-plan.md` §1); a key never cancels a running drag.
- **Keys that stay elsewhere:** an arrow on a focused field or slider is that control's (the existing rule: the yaw slider steps the yaw itself); a typing field or an input method keeps its keys; ⌘ + arrow does nothing (not a move, §2).
- While restoring: nothing (the restoring gate comes first, as now).
- The correction's `REACH`, picking and drag are unchanged; a pose change by key ends nothing (no gesture runs when it is taken).

## 2. The view's pan: no keys (bowen 1791768959)

"画布平移右键拖动够了。不用再搞别的" — the right / middle drag stays the pan; no keyboard pan. ⌘ + arrow stays what it is: not a move.

## Not now

- Panning or zooming by keys (bowen 1791768959: the right drag is enough; Z exists).

## Tests (bench)

- Playback: → / ← / ↑ / ↓ change yaw / pitch by 1 in the pad's directions; Shift by 10; Option and Ctrl by 0.1 (`stepOf`); Esc during a held run puts back the run's start; clamped at ±90 / ±45; a held key's repeats each step; the pad's handle, the sliders and both fields show the new pose; the drawing's text, the history and autosave's write count unchanged.
- An arrow during a correction drag and during a pad drag changes nothing and cancels nothing; an arrow on the focused yaw slider is the slider's (one step, not two); while restoring nothing.
- Feature-off: without the playback arrow route the pose test fails.
