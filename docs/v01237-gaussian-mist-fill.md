# V0.12.37 · Gaussian Mist Fill

Mist fill is a FillRegion appearance that follows a closed Bézier boundary. It is not a particle brush, a blur of the solid interior, or a layer effect. Existing solid fills and transparent cutouts keep their prior behavior.

Select a complete ellipse/closed stroke and use **Create mist fill**, or select an existing black/white fill and change **Fill type**. Controls: black/white color, Inside / Outside / Both sides, 0.25–200 logical px extent, and 0–100% opacity. The boundary has peak opacity; Gaussian falloff reaches transparent at the extent. Larger widths let the band spread across the interior. Black inward mist plus a lower white ellipse gives a soft iris; sharp pupil/highlight fills remain independent. Like other fills, the stroke remains separately ordered and can be placed in front using its depth offset.

## Implementation

- Additive optional `FillRegion.mist: {enabled, side, width, opacity}`. Absent/disabled settings retain solid fill behavior. Save/Load, layer duplication, cut/paste and source splitting preserve the settings through existing boundary references.
- Canvas even-odd coverage determines inside/outside, independent of traversal direction. A linear-time Euclidean distance transform computes distance to the complete rasterized boundary. Gaussian alpha uses the nearest boundary, so segment seams do not accumulate density. There is no noise, random displacement or grain.
- Raster output is runtime only. Source nodes, handles and joins never change. Translation, pan, zoom and opacity reuse bounded cached bitmaps; shape, width, direction or color updates invalidate them. Limits: 2048 px per side, approximately 1.5 million pixels per raster, 48 cached entries and 24 MiB of encoded cache storage.
- Picking uses a boundary band clipped to the requested side, not a rectangular image target. Zero-opacity mist does not intercept clicks. Fill diagnostics, object visibility/locks, per-layer transparent cutouts and normal depth compositing still apply. Stroke visibility/display intervals do not erase the fill.
- Both sliders use preview transactions: one drag is one Undo. Solid/Mist switching remembers the mist settings. Transparent cutout selection disables mist; it does not silently turn it into an alpha eraser.

## Validation

161 focused Drawing unit tests passed, including brute-force distance-transform comparisons, Gaussian falloff, malformed settings, persistence, source edits, splitting and transfer. 17 relevant browser scenarios passed: side-specific alpha, opacity gain, UI transactions, Undo/Redo, Save/Load, reversed boundary traversal, hidden strokes, display intervals, outer-band picking, transparent cutouts, curve depth, contour mist and a two-ellipse iris study. Production build passes (existing bundle-size advisory remains).

Browser raster measurement at 20 px extent / 100% opacity: inward alpha 238 near the boundary, 29 farther in, and exactly 0 outside. At 40% opacity the near/far alpha scales correspondingly without rebuilding the bitmap.

Artifacts: `artifacts/drawing-room/mist-fill-controls.png`, `artifacts/drawing-room/iris-mist-study.png`. User source archives and the live browser project's data were not overwritten.
