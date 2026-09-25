# V0.9.8 · Recording Background

Recording Room now has **Insert Background Image** in the upper-right corner of its editing viewport. Import JPG/PNG/WebP, then use Pan image or numeric sliders to align a multi-view sheet. Image scale is 10–500%; horizontal/vertical offsets are −10 to +10, five times the modeling viewport's slider range. Numeric input, arrow adjustments, rotation, opacity, hide/show, lock, reset, replace and remove use the existing UI components.

A single room-wide image is shared across yaw/pitch views and persisted as optional `recording.reference: ReferenceImage`. It is independent of Recorded Curve ViewKeys and modeling views' references. Camera zoom/pan carries the image; yaw and pitch do not rotate, warp or mirror it. This is an authoring reference and is excluded from Final Preview. The head reference is dimmed while the image is visible.

Background import and completed drags each create one Undo transaction. A cancelled drag creates neither a project edit nor a Key. Slider sessions use the existing continuous-edit transaction. Locking blocks image transforms. Source geometry and recordings' curve/key data are unchanged by reference edits.

The recording importer reuses `readPhoto` with a 4200-pixel longest-side limit and 1.2 million data-URL character budget; modeling-view import retains its old 1400/350000 limits. Stored content must be an embedded PNG/JPEG/WebP and its transform is validated during load. No application-schema bump is required for the optional field; Recording version remains 1.

Validation: 24 unit tests across recording-reference, recording and i18n; 13 Recording Room browser tests, including a 3000×3000 nine-cell test image, expanded offsets, scale, drag Undo/Redo/cancel, lock, JSON/load, autosave/reload and unchanged geometry/keys. Production build passes.
