# Playback: pose pad, and the viewport tools — rules before code

**Coded** (for dot's check; plan accepted dot 1791727754, coding cleared by bowen 1791730959): `pose-pad/index.tsx` (the pad: its own drag and window listeners, handed to the app at the press with its one cancel); the bench — `changePose(next, source)` (one update for pose and both fields; the pad's own updates never cancel its drag), the pad under the sliders taking the one gesture slot, the **View** group with the **Zoom Z** toggle (always enabled), a plain Z handled after the typing check and before the write gates, and every canvas press that belongs to a viewport tool (Zoom on, middle or right button) routed to the canvas's viewport path in every mode (Move picture too); the cursor table asked with Z first. Tests: `bench/test/pose-pad.test.tsx` (12), `bench/test/playback-view.test.tsx` (7), `pose-pad/test/boundary.test.ts`; the existing tests now find the canvas by its test id (the pad is an earlier svg). Checked in Chrome: a drag on the pad moved the pose to yaw 63, pitch −31, sliders and fields and handle in agreement. Note: with a mouse, a press of the same pointer also ends the other drag on each side; the shared slot is what lets Esc, leaving playback and a tool change end a pad drag.

Asked by bowen 1791727397: playback keeps its yaw and pitch sliders, and gains a coordinate grid where the mouse slides freely through any combination of yaw and pitch.

## What it is

- A small separate package, **`pose-pad/`** (beside `rename/` and `cursor/`): one React component, `<PosePad yaw pitch limits onChange />`. It knows nothing of the drawing: it shows a pose and reports a new one; the bench decides what a pose change does. React only.
- Shown in the Playback section under the two sliders, only while playing back.

## The grid

- A rectangle twice as wide as it is tall: **yaw −90 … +90 left to right, pitch +45 … −45 top to bottom** (left = the −90 view, as bowen's −90 is the left profile; top = +45, as his 0,45 is the upward view). Its size follows the bench's limits (`yaw 90`, `pitch 45`), passed in, not written into the package.
- Lines at yaw −90, −45, 0, 45, 90 and pitch −45, 0, 45; a dot at each of the nine drawn views (the grid's corners, edge middles and centre); a handle at the current pose.
- The numbers stay in the sliders and fields as now; the pad and the sliders show the same pose at all times.

## Moving it

- **Press** anywhere on the grid: the pose jumps there. **Drag**: the pose follows the pointer. Values are whole degrees (as the sliders), clamped to the limits; a pointer dragged outside the grid holds the nearest edge value.
- Each new value goes through the bench's existing `changePose` — the same path as the sliders: it ends a playback correction drag first (dot 1791696847) and writes nothing to the drawing.
- **One update for a pose that takes effect** (dot 1791727663): today `changePose` does not set the number fields' text and the slider sets it separately. A pose that takes effect — from the pad, a slider, a valid typed number, entering playback — is set in one place that sets the pose *and* both fields' text, so pad, sliders and fields always agree. A field being typed into keeps its own text while it is not a valid angle (`""`, `"-"`): such text changes nothing, as now.
- The drag belongs to the pointer and button that started it and is tracked on the window (as the canvas gestures are, since pointer capture proved unreliable on bowen's trackpad): it ends on that pointer's release, on a move without that button held, on pointercancel, on leaving the window, and when the pad goes (leaving playback, unmount) — its window listeners removed every time. A second pointer meanwhile is ignored.
- **The pad's drag and the canvas's gestures cancel each other** (dot 1791727663): the pad's drag takes the bench's one gesture slot (`gesture.current`), so a pad press cancels a running canvas gesture (a correction drag, a pan, a zoom drag) and a canvas press cancels a running pad drag, each through its one cancel path; Esc, a right click, a new press of the same pointer, leaving playback and unmounting cancel it too. A late move or release of a cancelled drag changes nothing. Window listeners are checked by type, callback and capture (dot 1791718017).
- **Who cancels whom** (dot 1791727680): `changePose` today cancels any running gesture, which would make every pad update cancel the pad's own drag. So a pose change names its source: a pad press first ends any other running gesture and then takes the slot; the pad's own updates during its drag do not cancel it; a slider, a number field or a canvas press ends a running pad drag (and, as now, a correction drag). A pad press at the current pose (no value change) still ends the old gesture and takes the slot. Tests cover both directions and the unchanged-value press.
- No keyboard control (not asked; the fields remain for exact values).

## Viewport tools in playback (bowen 1791727452)

bowen: Zoom is a viewport tool and must work in playback. **Rule, for every mode:** a viewport tool changes only the camera — what part of the drawing the canvas shows — never the drawing, so it works while editing, in playback and while restoring alike; a tool that writes is the only kind a mode can disable.

Today in playback: the wheel zooms; the right- and middle-button pan does not (the playback press takes the left button only and ignores the rest); **Z** (key and button) is disabled with the editing tools.

- The viewport tools — Zoom (Z key, Zoom Z button), the wheel, right- and middle-button pan, a right click that cancels — act in playback exactly as in editing, through the same code.
- The Zoom Z button moves out of the editing tools' disabled group into its own **View** group, always enabled; the Z key is handled before playback's "no shortcut writes" check — but **after** the typing check (a field or an input method keeps its keys) and only as a plain Z: ⌘Z / Ctrl-Z stays undo, never zoom (dot 1791727663). In playback and while restoring, the tool keys and everything that writes stay inert, as now: the write gate is unchanged, and the viewport path is the only one these modes open.
- **Leaving Zoom** (dot 1791727663): today Z only turns zoom on and playback disables the other tool keys, so there would be no way back to the correction drag. Pressing **Z** again, or the **Zoom Z** button again, turns zoom off (a toggle), in every mode; in editing, choosing another tool also turns it off, as now.
- In playback with Z on, a left press zooms (click in, Alt-click out, drag up / down), as in editing; with Z off, a left press is playback's correction drag, as now. The cursor follows: `zoom-in` with Z on, the arrow otherwise (the cursor table's order puts Z before playback).
- Tests: in playback, Z key and button toggle zoom on and off; ⌘Z is not zoom; Z typed in a field is not zoom; a left press with Z zooms, a right-button drag pans, the wheel zooms — each leaving **the drawing's text, the undo history and the autosave write count unchanged** (dot 1791727663); Z off again, a left press on a line starts a correction; the cursor shows `zoom-in` with Z in playback; while restoring, Z and pan act on the view only and no editing tool can be reached. Feature-off: with playback's presses not routed to the viewport tools, the tests fail.

## Not now

- Snapping to the nine views; the pad outside playback; dragging on the canvas to orbit.

## Tests

- Package (DOM): a press at a position gives the expected whole-degree pose (corners → ±90 / ±45, centre → 0,0; top = +45, left = −90); a drag reports each move; outside the grid clamps; the handle follows `yaw` / `pitch` given; release / a move without the button / pointercancel / blur / unmount end it, the window's pointer listeners counted by type, callback and capture (dot 1791718017) back to none; a second pointer ignored.
- Bench: in playback, a drag on the pad changes the pose shown — sliders and fields follow (and a slider or a typed number moves the pad's handle), the drawing's text unchanged; a field holding `-` changes nothing until valid; a pad press during a correction drag cancels it, and a canvas press during a pad drag cancels that; Esc, a right click, a new press of the same pointer, leaving playback and unmounting each end a pad drag, a late move or release changes nothing, no window listeners left. Feature-off: without the pad's `onChange` wired, the bench test fails.

## Order

The picture library (`docs/reference-images-plan.md` §10) is handed in and not yet accepted; per the package rule this stays a plan until it is.
