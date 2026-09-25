# V0.12.35 — Interior Endpoint Ink

Continuous and closed strokes now expose per-curve interior endpoint ink.

## Using it

Expand the stroke in the layer list, select one constituent curve, then choose **P0 / P1 Interior endpoint ink** in Properties. Enable the checkbox and adjust **Endpoint taper distance px** and **Stroke extension distance px**. Selecting a curve's physical P0 / P1 endpoint also opens the corresponding settings. The two sides of a shared point remain independent choices.

Equal taper and extension distances produce a full-width root at the original endpoint and taper the extension to a point. In the supplied `正面v1.1.json`, the neck ends are **曲线100 P1** and **曲线104 P0**. Settings affect ink only: nodes, handles, joins, derived stroke membership and fill boundaries do not change.

## Compatibility and geometry

- `InkEndStyle.interior` is an optional explicit opt-in, default absent/off. Dormant legacy 20× Pen taper settings remain inactive at internal joins.
- First enable resets this endpoint's taper and extension to zero and clears its old width multiplier. Disabling then re-enabling remembers manually assigned distances.
- Internal taper is limited to its own source segment. Original whole-stroke progress and external endpoint settings remain intact. Local effects split rendered ink runs, not document topology.
- Reversed traversal maps styles back to their authored P0/P1. Closed traversal seams, visibility masks and display intervals are supported. An interval cutting away a source endpoint suppresses that endpoint's ink; explicit coincident interval-end styles take precedence.
- ARC source endpoints use their visible trimmed positions and tangents. The original ARC transition is preserved.
- Extension picking, endpoint markers, arrow-key extension edits, mist, Undo/Redo and JSON persistence use the same evaluated result.

## Verification

62 focused domain checks passed across endpoint ink, intervals, appearance, ARC, CUSP seams, nudging and mist. Six browser checks passed across original endpoint interactions and the new internal controls. The supplied neck archive was additionally checked in an isolated browser; the source file was not modified. Production build passed with the existing bundle-size warning.
