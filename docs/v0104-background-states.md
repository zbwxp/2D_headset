# V0.10.4 — Recording Background States

Recording Background Settings contains a nine-slot grid of named states. Clicking an empty slot saves the current image transform into that slot. Click a saved state to apply it, rename it in the name field, or explicitly overwrite it with **Update Current Background State**. **Save as New Background State** fills the next available slot and allows more than nine states. Deletion frees the slot without moving other states or changing the current background transform.

Each state stores an ID, name, stable grid slot, offset, scale, rotation and opacity. The image is embedded once in the existing recording reference. Image visibility and lock state stay unchanged when applying a state. Explicit state navigation works while the background is locked; manual sliders and panning remain locked. Camera/view state and recorded geometry are unaffected.

Manual adjustments do not overwrite presets. The panel marks a selected state as adjusted until it is updated or reapplied. Saving, switching, renaming, overwriting and deleting each use one Undo transaction. States and the current transform persist through Save/Load and autosave. States belong to the current image: replacing/removing the image follows the existing image replacement operation, and Undo restores the previous image and its states.

The recording reference extends the old image schema with optional `states` and `activeStateId`; old saves still load unchanged. Validation rejects malformed transforms, duplicate IDs/slots and dangling active IDs. No state includes duplicate image bytes, and reference backgrounds remain absent from Final Preview.

Validation: production build; 65 recording/language unit tests; browser tests for the existing background editor and ten named states, including nine-cell transforms, overwrite, lock-safe switching, Undo/Redo, Save/Load and image-data deduplication.
