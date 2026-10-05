# Drawing / Recording selection and transform policy

The two canvases consume the same interaction decisions from
`ui/drawing/editGestures.ts`:

- V curve hits select complete strokes/groups; A curve hits select a segment
- Both V and A curve-body hits begin a move; deform hits only select
- Marquees replace the prior curve selection, or append the selection frozen at
  pointer-down when Shift is held. A stroke transform frame does not block a new
  marquee
- Visibility and editability determine eligible hits. Expanding an eligible hit
  retains hidden continuations and locked group members. Commands validate the
  complete operation instead of silently changing an unlocked subset
- Corner drags scale X and Y independently. Shift uses the X ratio for both axes

Explicit Recording layer-container selection keeps its deliberate body-drag
behavior. It is distinct from a stroke selection with a transform frame.

## Write adapters and frames

Drawing remains the geometry-authoring authority. Recording A body dragging
uses the shared frozen control plan and preview-target transaction before the
existing real-basis/inverse adapter receives the requested drawing. It does not
write source artwork or infer a native placement from changed points.

Native single-layer and stroke corners use the same scale intent in their
existing material frame. The adapter changes native axis values around the
opposite material corner. Native axes retain their existing nonnegative range;
side handles still restore exact zero without inverting the collapsed placement.
Drawing source geometry keeps its existing authoring minimum, while retained
layer domains can represent exact zero.

Real multilayer selections use native similarity placement when possible.
Independent world-axis scaling persists an ordered affine layer-domain intent
through the existing snapshot transaction. Once a selection has output domains,
later world gestures remain after those domains. This avoids scaling or rotating
a requested translation through a previously saved domain.

Plain affine output domains are also included in native display frames. The
display frame may be a matrix with shear; its exact inverse maps the pointer
back to the retained material frame. A singular display domain cannot be
inverted and must be disabled/restored before native frame editing. No epsilon
or pseudoinverse replaces that guard. Intermediate corrections continue to use
Drawing control targets and the existing strict inverse pipeline.

## Focused verification

- `shared-canvas-selection-gestures.test.ts` executes both actual canvas
  handlers: consecutive/Shift marquees, A body dragging with mirror following,
  complete semantic membership, locked-operation rejection, and corner modifiers
- `recordingSnapshot/shared-layer-transform-gestures.test.ts` uses real
  triangulated snapshots for multilayer scaling, source/library preservation,
  subsequent world movement, lock rejection, Undo/Redo, native zero recovery
  under an affine frame, and intermediate correction targets
- Existing `recording-instance-canvas`, `drawing-edit-gestures`,
  `recording-canvas-selection`, and `recordingSnapshot/layer-affine-domains`
  suites retain the adjacent frame, axis, and domain checks

These are focused automated checks; they do not claim browser acceptance or a
full release run. The legacy `recording-stroke-pick-drag` fixture currently calls
the retired `createRecording` API and fails before reaching its canvas tests.
