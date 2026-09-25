# V0.12.2 — Reliable Dragging

## Symptom and confirmed failure path

Drawing Room formerly kept pointer edits in a local preview and committed only
from the SVG's `pointerup`. Both `lostpointercapture` and window `blur` discarded
the preview. This affected mirror-axis position, nodes, handles, whole strokes,
transforms, and background movement through the same drag session.

Browser regression reproduced the reset by releasing native pointer capture
during a real mouse drag, then releasing over the sidebar. A separate blur-at-release
test also lost the complete edit. Neither failure involved a domain validation
error. These controlled reproductions establish a failure mechanism; they do not
establish which native event triggered every instance in the user's session.

## Fix

- Track the initiating pointer and button at window level. Native capture remains
  useful but is no longer required to commit an edit.
- Continue through capture loss and accept release outside the canvas.
- Accept a mouseup fallback for mouse sessions. If a later pointermove indicates
  the button was already released, finish at the last preview rather than jumping
  to the pointer's re-entry position.
- Real pointer cancellation, window blur, or document hiding finishes the last
  valid preview with an interruption notice, rather than silently reverting it.
- Clear the active transaction before committing/releasing capture, so subsequent
  pointerup, mouseup, and capture-loss events cannot commit twice.
- Ignore unrelated pointer IDs/buttons. An extra touch cannot cancel a mouse edit.
- Escape and Undo still cancel a pending edit. An external document replacement
  invalidates the drag base; a late release cannot overwrite the new document.
- Starting a drag after a property input blur takes the current committed document
  as its base, avoiding overwriting a just-committed numeric edit.
- Domain guards for locked objects, related selections, and degenerate handles
  remain unchanged. This fix does not bypass geometric validity checks.

Scope: Drawing Room canvas gestures. Numeric sliders already finish their edit on
capture loss. Recording and modeling gesture implementations are unchanged in this
patch; the new tracker is reusable but is not a global behavioral override.

## Verification

- Before the fix: three new browser regression cases failed (mirror capture loss,
  blur on release, node/handle capture loss); explicit cancellation passed.
- After the fix: the original four cases passed along with all 16 existing Drawing,
  ARC, and Stage 4 browser scenarios.
- Additional regression verifies matching pointercancel and mouseup-only fallback
  both preserve the last valid edit exactly once and remain undoable.
- TypeScript and production build checked.
