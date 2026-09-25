# V0.12.0 · Drawing Ink — Stage 4

Stage 4 adds ink profiles, independent white/black fills, and persistent offset followers to the existing Drawing Room. It does not change HeadSet, Eyes, Recording geometry/evaluation, or implement Stage 5.

## Using it

Select a Curve or continuous stroke. **Stroke and Fill** in the right inspector provides:

- Uniform, Taper End, Taper Both, Eyelid; Reverse profile swaps thin/heavy ends. Width is the base width; the Eyelid peak is 1.7 times base width near 76% of the stroke.
- Show ink on selected segments: disable black ink without removing the source geometry, picking or a dependent fill. Split first if only part of one cubic should have invisible ink.
- Select a single closed boundary (several separate curves/strokes are fine), then Create white/black fill. Smooth/Bind are not required if endpoints already coincide. The fill starts just behind its boundary strokes. Layer rows and object ordering buttons control occlusion.
- Create offset follower / Independent offset copy. The follower inspector controls signed distance, source start/end percentages, endpoint convergence, width/profile, and Convert to independent curves. Select source geometry takes you back to editing its inputs.

Fills and offsets are named entries with their own visibility and lock state. Broken/deleted boundaries remain in the list marked Invalid with an explanation in the inspector. They draw nothing; they are never silently closed.

Show fills toggles fill preview while editing. Hide editing helpers always displays visible fills. Reference images remain editor references, not fill objects.

The Pen options include **Continue with: Smooth / Cusp**, so a pointed join can be authored before placing the next segment.

## Data and evaluation

`DrawingDocument.version` is now 2. Version 1 is migrated on load: `layer.curves` becomes `layer.items`, and new `fills` / `offsets` arrays start empty. The layer's ordered object IDs are the only ownership/z-order representation. Derived stroke members are contiguous. There is still no stored Path asset.

- Curves add optional `profile`, `profileReverse`, `inkVisible`.
- `FillRegion` stores ordered `{id, reverse}` Curve uses and white/black color. Missing references are deliberately retained so deleting a boundary cannot silently erase the region.
- `OffsetRelation` stores ordered source Curve uses, signed distance, normalized arc-length range, end-convergence fraction, width/profile. These are persistent source references, not independently editable derived control points.
- Exact cubic split updates forward/reversed fill and offset references. Duplicate layer remaps internal references. Moving a source to another layer preserves its identity and the relationship; moving/deleting an entire fill does not alter its source.
- Open-stroke traversal uses stable outer node IDs, independent of layer sorting and exact subdivision. Duplicating nodes preserves the visible asymmetric profile direction despite new IDs.

`appearance.ts` flattens source cubics adaptively in drawing units, builds one arc-length table across the complete stroke, and applies width profiles to that shared progress. Hiding ink on one segment does not restart the profile on later segments. Uniform strokes keep exact SVG cubic paths; variable widths use an outline of sampled ink.

Fills and stroke ink use the same ordered render pass. Transparent authoring hits are placed with each object in that pass, so a selectable foreground white fill blocks ordinary picks on curves behind it. Selecting a source from the list still exposes its editable controls.

Offsets evaluate source position plus signed unit normal times distance and a smooth convergence ramp. Adaptive Hermite cubic fitting uses a sampled positional error criterion of 0.0001 drawing units (0.025 nominal px at 250 px/unit). Fit data is runtime cached by immutable document identity. Converting uses those same cubics, creates ordinary independent joined curves, and removes the relation in one Undo transaction.

## Deliberate V1 limits

- A fill contains one unambiguous closed loop. It does not guess gaps, branching choices, holes or self-intersection semantics beyond SVG even-odd fill.
- Closed continuous strokes use Uniform width to avoid a taper seam. The other presets apply to open strokes.
- An offset captures the ordered source stroke at creation; geometry edits and exact splits update it. Newly connected additional source curves do not silently change that captured boundary.
- A range spanning a sharp tangent discontinuity/cusp reports an invalid offset. Narrow the range or smooth the source. This iteration does not implement offset corner joins or self-intersection cleanup.
- Width/distance are in document units and scale with canvas zoom. No pressure/texture brushes, color system, formal SVG/PNG export, Recording sync, Batch Bend or generic deformer.

## Verification

- 32 Drawing unit tests pass (18 existing + 14 new).
- 5 Stage 4 browser workflows pass: continuous profiles and Pen Cusp, actual raster occlusion, hidden ink, invalid fill, object sorting, persistent offset edits/conversion, Undo, Save/Load, layer duplication and bilingual controls.
- 7 existing Drawing browser workflows pass.
- 20 existing Recording / drawing regions / EyeCoord / unified-authoring browser workflows pass (32 browser workflows total).
- Whole suite: 539 tests, 534 pass; the same 5 pre-existing failures remain in landmarks / landmark-management / silhouette.
- Build passes. Vite retains its existing large-chunk warning.

Visual/editable sample: `artifacts/drawing-stage4/line-art-zh.png`, `line-art-en.png`, `line-art-demo.json`. These are generated in an isolated test browser, without modifying the user's open project.

Pre-change source snapshot: `artifacts/drawing-stage4/V0.11.0-before-stage4.tar.gz`. Use it for scoped rollback; it predates all Stage 4 changes. Do not restore the entire dirty working tree blindly. Old V1 Drawing files load in V0.12.0; V0.11.0 does not know new V2 fill/offset assets.
