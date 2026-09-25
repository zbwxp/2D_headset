# V0.10.5 · Drawing Regions

Recording curve inspector → Drawing Regions → Add Drawing Region → click two positions on the selected curve in the left editor. The first click is a pending UI choice; the second creates one undoable region and enables restriction. Any number of regions is supported. Start/end percentage fields edit the endpoints; the × button removes a region. Escape, tool changes and view navigation cancel the unfinished choice.

Each RecordedCurve optionally stores `drawing: {enabled, regions: [{id, start, end}]}`. Positions are stable full-source cubic parameters in [0,1], shared across views, including negative-yaw mirroring. They are not semantic point assets or shape keys. Overlaps/touching spans are unioned. Absent/disabled restriction draws the whole curve. Enabled with no regions draws nothing. Turning restriction off retains the regions. The inspector explains these states.

Final rendering clips evaluated geometry with exact de Casteljau subdivision. Source keys, coverage, binds, Smooth solving, ordinary picking and snapping remain unchanged. The left editor retains the complete curve and shows cyan selected ranges with A/B markers. Hover and pending-region preview are yellow. Point markers and editing guides are never emitted into Final Recorded Preview.

Smooth display provenance is handled after solving: a source owns the adjacent half of its transition, with its replaced endpoint mapped to the transition midpoint and its trim point mapped to the transition end. Source-parameter spans are mapped onto those display pieces. Both picking and clipping use the same mapping. Contributions to a shared transition are unioned before rendering, avoiding duplicate strokes or a midpoint seam. No new geometry or junction semantics are introduced.

Persistence validates optional region data and keeps existing saves compatible. Duplicate copies region settings independently. Region commands respect locks and participate in the normal atomic history; changing the display mask does not Auto-Key. Global/current-view visibility and coverage continue to gate the final strokes.

Validation: exact clipped cubic samples, union/empty/disabled cases, immutable authoring and Smooth geometry, four Smooth endpoint orientations, trim-crossing spans, negative yaw, duplicate, invalid input, JSON roundtrip, two-click browser authoring, cancellation, numeric editing, Undo/Redo, reload and points-only-in-editor regression.
