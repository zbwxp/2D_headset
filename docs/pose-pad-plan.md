# Playback: pose pad, and the viewport tools — rules before code

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
- The drag belongs to the pointer and button that started it and is tracked on the window (as the canvas gestures are, since pointer capture proved unreliable on bowen's trackpad): it ends on that pointer's release, on a move without that button held, on pointercancel, on leaving the window, and when the pad goes (leaving playback, unmount) — its window listeners removed every time. A second pointer meanwhile is ignored.
- No keyboard control (not asked; the fields remain for exact values).

## Viewport tools in playback (bowen 1791727452)

bowen: Zoom is a viewport tool and must work in playback. **Rule, for every mode:** a viewport tool changes only the camera — what part of the drawing the canvas shows — never the drawing, so it works while editing, in playback and while restoring alike; a tool that writes is the only kind a mode can disable.

Today in playback: the wheel zooms; the right- and middle-button pan does not (the playback press takes the left button only and ignores the rest); **Z** (key and button) is disabled with the editing tools.

- The viewport tools — Zoom (Z key, Zoom Z button), the wheel, right- and middle-button pan, a right click that cancels — act in playback exactly as in editing, through the same code.
- The Zoom Z button moves out of the editing tools' disabled group into its own **View** group, always enabled; the Z key is handled before playback's "no shortcut writes" check. In playback, the tool keys that write stay inert, as now.
- In playback with Z on, a left press zooms (click in, Alt-click out, drag up / down), as in editing; with Z off, a left press is playback's correction drag, as now. The cursor follows: `zoom-in` with Z on, the arrow otherwise (the cursor table's order puts Z before playback).
- Tests: in playback, Z key and button turn zoom on; a left press with Z zooms and writes nothing; a right-button drag pans and writes nothing; Z off, a left press on a line still starts a correction; the cursor shows `zoom-in` with Z in playback. Feature-off: with playback's presses not routed to the viewport tools, the tests fail.

## Not now

- Snapping to the nine views; the pad outside playback; dragging on the canvas to orbit.

## Tests

- Package (DOM): a press at a position gives the expected whole-degree pose (corners → ±90 / ±45, centre → 0,0; top = +45, left = −90); a drag reports each move; outside the grid clamps; the handle follows `yaw` / `pitch` given; release / a move without the button / pointercancel / blur / unmount end it, the window's pointer listeners counted by type, callback and capture (dot 1791718017) back to none; a second pointer ignored.
- Bench: in playback, a drag on the pad changes the pose shown (the sliders and fields follow, the drawing's text unchanged); a press on the pad during a playback correction drag cancels that drag (as a slider change does); leaving playback during a pad drag leaves no listeners and no pose. Feature-off: without the pad's `onChange` wired, the bench test fails.

## Order

The picture library (`docs/reference-images-plan.md` §10) is handed in and not yet accepted; per the package rule this stays a plan until it is.
