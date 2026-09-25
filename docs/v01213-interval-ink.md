# V0.12.13 · Interval Ink

## Fill visibility

Hiding a boundary segment, disabling its ink, or restricting ink with display intervals does not hide the fill. An ellipse can have all four curve rows hidden and retain a white highlight fill. Fill geometry still requires an intact closed boundary; deleted or disconnected geometry is not silently repaired.

Explicit whole-stroke hiding continues to hide its owned fills, and hiding a layer hides all its content. `FillRegion.hiddenWithStroke` records that explicit group action, separate from the fill's own `visible` flag and individual segment flags. Showing the group does not turn on fills whose own visibility was turned off. A group with hidden segments and a visible fill has mixed visibility in the layer tree. No new persistent stroke topology is introduced.

## Display interval endpoint ink

Each `DisplayInterval` optionally stores `inkEnds: [InkEndStyle, InkEndStyle]`. Select either green marker, or its start/end button in Properties, to set taper distance and tangent extension distance. Marker positions remain arc-length fractions on the original derived path. Appearance changes do not move nodes, handles, interval markers, fill boundaries or offset source geometry.

Rendering unions the intervals before applying endpoint ink. Only exposed union boundaries taper or extend. Covered interior markers never create notches, double ink or stray extensions. Coincident outer endpoints use the larger requested taper/extension. Marker-attached styles follow reversed traversal and crossing on open paths. Closed wrapping intervals remain one run across the parameter seam, with taper only at the two real ends. Full closed-loop coverage has no artificial ink tips.

The source stroke's width profile continues to use whole-path progress. Interval tip styles are additional local controls; at a physical terminal they override that terminal's taper or extension when explicitly set. Tangent extensions affect ink only. Requested tapers are fitted proportionally when their total exceeds a visible interval's length, keeping a full-width body on short intervals.

## New Pen defaults

Only `createPenCurve` initializes newly authored Pen curves with `taperWidthScale: 20` at both ends. The active derived stroke uses the outermost endpoint styles, so connected Pen segments do not restart the taper at each joint. Closed strokes ignore ordinary terminal tapers. Ellipse creation, JSON loading, splitting and copying retain existing styles; no migration changes previous artwork.

New display intervals also receive the width-relative 20× default. Existing intervals without `inkEnds` retain their previous hard crop until explicitly edited. `inkTaperDistance` resolves width-relative values at render time, so changing line width adjusts these defaults. Short new Pen strokes fit width-relative tapers to their available length. Legacy absolute endpoint distances retain their prior behavior.

Entering a taper distance replaces the width-relative setting with an explicit distance; extension remains independently editable. Absolute taper distances support 0–5000 logical px and extensions retain 0–500 px. All additions are optional in the existing version-2 Drawing JSON. Validation, Undo/Redo, Save/Load, clone and exact split preserve the endpoint settings.

## Verification

Unit and browser coverage includes four hidden ellipse sides with a visible fill, whole-group versus segment visibility, closed wrapping intervals, asymmetric independent endpoint settings, tangent extensions, overlap union, reversed/crossing markers, short runs, legacy appearance, width-relative new Pen defaults, split/duplicate, lock handling, Undo/Redo and Save/Load. Browser artifacts include a white highlight with hidden outline and interval endpoint controls in Chinese.
