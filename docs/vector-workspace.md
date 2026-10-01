# Vector workspace (local V0.17 implementation)

One workspace now has Drawing and Recording modes. The previous recording and
assembly UI is retired; old project payloads are retained in a read-only legacy
archive during loading, even when malformed. Nothing is deployed by this change.

## Artwork and ownership

Drawing retains the existing pen, node/handle tools, layers, joins, interval editor,
ink and fill tools. Named artworks are independent editable vector documents.
Saving/updating artwork is separate from recording an angle keyform. Switching
artworks prompts to save a copy, discard, or cancel when the canvas has unsaved
changes. Layer import copies selected parts from another artwork with new IDs;
dependencies require explicit inclusion and the source artwork stays unchanged.

Only Drawing can change source geometry. Recording source writes and any undo
that would change source geometry are rejected at the editor store. Saving an
unnamed working artwork for the first time transfers its rig to the new artwork
identity. Later changes to source geometry/topology require explicit acceptance
before the rig can be edited again; existing deformation controls remain intact,
deleted-layer bindings are removed and new layers start unbound.

## Recording workflow

1. Select the artwork's layers and create a Warp; choose its control cell rows and
   columns. Bind any other layers in the deformer tree. Deformers may be nested.
2. Select Angle X/Y in the range -90 to +90. The five initial neutral/directional
   keys start as identity shapes; a turned face must be authored, not guessed.
3. Select nodes, entire rows or columns, Shift-select, or marquee-select and drag.
   Bézier handle display exposes outgoing U/V control handles. Space pans, wheel
   zooms, arrow keys nudge; one drag or held nudge is one undo operation. Escape
   cancels the active gesture.
4. Save/update the keyform. Dragged changes are clearly marked as drafts and
   autosaved separately from authored keys. Save or discard before changing an
   angle. Intermediate/corrective keys can be created, named, removed or reset.
5. Layer visibility and existing interval enabled states can be recorded by pose.
   In Recording, expand an interval track to key its SHOW/HIDE mode, start/end
   percentages and tip tapers for this angle. These are pose appearance overrides:
   canonical Drawing intervals, nodes and curves are unchanged. Create/remove base
   tracks and edit their defaults in Drawing. Review every intended fold's visibility.

Child deformers edit in an explicit local-space view, with ancestor transforms
excluded and unrelated layers hidden. This keeps the control cage and artwork
aligned without assuming that a folded parent has a unique inverse. The global
preview button shows the full child-to-parent composition; return to Local Edit
to manipulate that child's controls.

Interpolation is a piecewise bilinear parameter lattice. Missing corner cells use
neutral + authored X delta + authored Y delta. Explicit two-dimensional corrective
keys override their lattice cell. A generic external parameter-driver descriptor
is retained; physics and back-of-head angles are deferred.

## Vector fidelity

The internal field is a shared-node bicubic Hermite patch grid with Bézier control
handles, interior nodes and C1 seams. It permits folds. It is our explicit vector
implementation, not a claim to reproduce proprietary Cubism Core mathematics.

Every original source cubic produces exactly one output cubic with stable source
IDs. Fitting never adds source nodes or segments. Over-tolerance curves are red and
can be selected back in Drawing for manual subdivision. Endpoint mapping conflicts
are reported separately. Error is densely sampled same-parameter distance in
source drawing units, not a proven supremum; nominal display units use 250 px/unit.
Fast drag diagnostics are provisional; release runs the full sampled check.

## Structured AI editing

See [vector-editing-api.md](vector-editing-api.md). window.contourAI offers source
inspection, stable IDs, coordinate conversions, validated atomic batches, dry-run,
preview, clean SVG/source export and undo. The AI editing console is local-only.
Optional visual guides default off and never enter source artwork or ordinary
exports. Automatic matching from a pixel face is a future workflow, not implemented
or claimed by this change.

## Durable local saves

Full project autosave uses IndexedDB, with a visible saving/saved/error indicator.
Startup awaits the durable project before considering the starter face. Existing
localStorage saves are read and migrated without deleting their original bytes.
Retired payloads are serialized once in the archive, not duplicated as active rigs.
Writes are ordered and considered saved only after transaction completion. When
storage is blocked/full the app keeps edits in memory, reports failure and asks for
JSON export; it does not quietly fall back to quota-limited full-project localStorage.
Leaving while a write is pending or failed uses the browser's unsaved-change guard.

## Angle interval overrides

Interval appearance is evaluated in source-path arc coordinates before Warp. The
legacy interval interpolator supplies circular start-plus-length/wrap behavior,
SHOW/HIDE coverage and tip transitions. Its result is transported materially
through the new Warp exactly once. Interval enabled switches remain distinct
from smoothly interpolated boundaries. White fills retain their existing
inter-layer occlusion role, including when a closure edge's ink is hidden.

At a missing X/Y corner, a track edited on only one axis follows that axis without
dilution. If both axes changed the same track, their appearances use positive
|X|:|Y| blending; author a 2D corrective key when a specific combined result is
needed. Explicit 2D keys take precedence. Source edits still require the existing
source-review step; pose overrides keep the source geometry and ownership intact.

## Bundled authored stage

“导入无发五官阶段稿” explicitly imports “无发·五官对称·脸片待建” as a new
artwork. This is the actual hands-on authored stage: 12 layers, 119 curves and
19 fills, without a reference image. Features have been mirrored; the unchanged
face contour and overlapping left/right face pieces still need authoring, and
some ears remain occluded by that existing face. It is not a completed symmetric
face. The loader never replaces startup data or an existing saved artwork. Any
unsaved working artwork is saved as a separate copy first; the whole import is
one undo step and the current working rig keeps its original artwork ownership.
