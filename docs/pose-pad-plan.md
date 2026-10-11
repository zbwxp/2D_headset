# Pose pad: yaw and pitch on one grid — rules before code

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

## Not now

- Snapping to the nine views; the pad outside playback; dragging on the canvas to orbit.

## Tests

- Package (DOM): a press at a position gives the expected whole-degree pose (corners → ±90 / ±45, centre → 0,0; top = +45, left = −90); a drag reports each move; outside the grid clamps; the handle follows `yaw` / `pitch` given; release / a move without the button / pointercancel / blur / unmount end it, the window's pointer listeners counted by type, callback and capture (dot 1791718017) back to none; a second pointer ignored.
- Bench: in playback, a drag on the pad changes the pose shown (the sliders and fields follow, the drawing's text unchanged); a press on the pad during a playback correction drag cancels that drag (as a slider change does); leaving playback during a pad drag leaves no listeners and no pose. Feature-off: without the pad's `onChange` wired, the bench test fails.

## Order

The picture library (`docs/reference-images-plan.md` §10) is handed in and not yet accepted; per the package rule this stays a plan until it is.
