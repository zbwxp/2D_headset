# V0.7.0 — Recording Room V1

Recording Room is an independent view-conditioned 2D drawing workspace. The original head is a read-only reference. There is no conversion to FREE/ON_PATCH, surface attachment, old Contour pass, permanent mirror relation, or endpoint topology relation.

## Entry and workflow

Use the header's **进入录制间 / Enter Recording Room** button. The left viewport renders the current head with a 2D cubic overlay; the right viewport shows only valid recorded curves on white.

1. Create a Recorded Curve at the current view. Edit its name in the sidebar.
2. Drag its endpoint/handle in Edit Curve mode. Moving an endpoint carries its adjacent handle.
3. Use View Navigation to orbit, right-drag/Shift-drag to pan, and wheel to zoom. Yaw/Pitch NumericSliders also support precise typed angles. ViewMap clicks navigate without creating keys.
4. Outside a curve's coverage it is a red frozen editing reference, absent from Final Preview. Editing creates the current Key, initialized from the currently evaluated shape.
5. Mirror Edit: click a valid source curve, then a different unlocked target. Endpoint Merge: click a valid fixed endpoint, then another curve's moving endpoint. Both exit to Edit Curve, selecting the target. Escape clears a first selection; a second Escape exits. View changes cancel partial tool selection.
6. Duplicate Current Frame copies exactly the displayed Key/interpolated/frozen cubic, offsets it by 8 CSS px diagonally, and creates an independent curve with one Key. Undo removes the whole duplicate.

All visible uncovered curves remain red, not just the selected one. Locked curves may be read as sources but cannot be overwritten. Hidden curves are absent from both views. The last Key cannot be deleted independently; delete its curve instead.

## Source data and coordinates

`LandmarkProject.recording?: { version: 1, curves: RecordedCurve[] }` is an optional project JSON block. Legacy files without it behave as an empty room and need no geometry migration. Strict parsing validates finite cubic coordinates, angle ranges, unique curve IDs, and unique current-view keys.

Each curve owns `{ id, name, visible, locked, keys }`. Each key stores `{ yaw, pitch, shape: [P0,H0,H1,P1] }` in normalized HeadFrame-projected coordinates. No screen pixels, coverage meshes, red flags, mirror partners or relationship graph are persisted.

The origin is projected HeadFrame center. The units are the basic ellipsoid's orthographic support radii along screen right/up, e.g. `sqrt(sum((axis_i * radius_i)^2))`. Camera orientation is HeadFrame local. Canonical yaw is 0..180°, pitch -89..89°. Negative yaw reflects the entire canonical output, preserving control point order; editing inverse-reflects the displayed shape before storage. No perspective/FOV/distance keys, roll, or per-curve symmetry modes.

## Coverage

- One Key: exact-view coverage only.
- Two/collinear Keys: piecewise linear interpolation along consecutive segments.
- Noncollinear Keys: deterministic Delaunay triangulation, complete convex hull.
- Barycentric weights directly interpolate the four control points.
- Outside coverage: nearest Euclidean point on the coverage in degree-space; evaluate there for a deterministic frozen shape. No last-camera-history dependency.
- View match tolerance: 1e-6 degrees, not a snap grid.

Triangulation is isolated in `domain/recording/evaluation.ts`, cached by immutable curve identity. It uses a hull triangulation, interior insertion and Lawson edge flips. Sorted point order and strict scale-aware incircle tests define cocircular ties. Starting from the actual hull avoids finite-supertriangle clipping for skinny configurations. Tests cover affine reproduction, complete area coverage, empty circumcircles, shuffled insertion, skinny triangles and collinear cases.

## Commands and history

`editShape`, `writeKey`, `createRecorded`, `duplicate`, `mirrorEdit`, and `mergeEndpoint` are pure commands. Existing project history and autosave are reused via a recording-only store update, bypassing geometry validation/propagation. Recording-only undo/redo also bypass modeling propagation.

A drag stages a local recording draft, immediately previewing the new Key and cubic. Release commits one project snapshot; Escape, cancellation, blur, visibility loss, view changes or unmount discard the uncommitted draft. Merely selecting a handle creates no Key/history.

Mirror reads the source's evaluated cubic without adding a source Key. Merge seeds the complete moving cubic from its displayed result, assigns the destination endpoint exactly, translates only the attached handle, and preserves the opposite endpoint/handle. Both commands create/overwrite just the target Key. Undo restores the previous Key's existence and content; red/frozen is reevaluated, not stored.

## Reference and UI

- `ui/recording/Reference.tsx`: read-only Three.js orthographic adapter using existing final tessellation, Helmet, Region, Cap and curve providers. Camera updates only update projection; recording edits do not rebuild reference geometry buffers.
- `ui/recording/RecordingRoom.tsx`: dual view, overlay control points, two-click tools, own curve selection, Curve list/Inspector, interactive ViewMap.
- `ui/recording/session.ts`: runtime-only room, view, tool, selection and display transform.
- All new controls use existing language switching and NumericSlider.

Recording curves do not enter modeling ObjectRef/ToolSession. Switching rooms cancels the modeling tool and unmounts recording drafts. Persistent recording data remains in the same saved project and chronological history.

## Verification

- 17 recording unit tests cover interpolation, Delaunay, coordinates, negative yaw, all seed states, exact endpoint/handle semantics, locks, parser and project roundtrip.
- Browser tests exercise pointer editing/transaction grouping, interpolation/frozen Undo, negative yaw, mirror, merge, duplicate, persistence, room switching, viewport resize, orbit, cancellation, hide/lock and rename Undo.
- Representative existing modeling browser tests cover 3D curve/patch creation, overlapping selection, Contour toggle and language switching.
- Production build checked.

The full unit suite currently has five pre-existing failing assertions in `landmarks`, `head-frame`, `on-curve`, and `patch-prep` tests (old 45° preset expectation and signed-zero/roundtrip expectations). An isolated copy with the original recording-unaware loader reproduces the exact same five failures. The feature does not alter these geometry/view semantics to make those assertions pass.
