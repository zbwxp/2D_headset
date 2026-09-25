# V0.12.30 — Contour Mist

Drawing curves and offset lines have optional `mist: { enabled, width, density }` appearance. Existing documents default to disabled. Width uses logical drawing units (UI: 0.25–60 px at 250 px/unit); density is 0–1. Exactly the selected members change: a directly selected member does not change its whole chain, layer, or endpoint-linked neighbours. Selecting a whole stroke/group enables batch editing. This is independent of the stroke profile.

Rendering adds an unpickable particle image directly behind each affected stroke at its existing paint position. Sharp vectors, fills, control points, join semantics and saved geometry are untouched. The particle source uses the same derived arcs, extensions and visible intervals as ink. Hidden segments do not emit particles; a shared arc emits mist when both adjacent members have matching enabled settings. Offset followers support their own effect and retain it when detached.

Fixed seeded particle placement combines irregular longitudinal density, Gaussian normal offsets and Gaussian splats. Width changes the envelope, density changes alpha without regenerating particles. Raster display caches use local coordinates, survive camera changes, and are bounded by 96 entries / 16 MiB of encoded strings; individual raster surfaces are capped at 1.5 megapixels / 2048 px per side. They are not saved. Very high canvas zoom may expose raster softness in the mist; the source ink remains vector.

Each slider previews live and commits one transaction on release; numeric entry, Undo/Redo, duplication, splitting and Save/Load preserve the settings. Chinese and English UI live under line properties → Contour Mist.

Validation: domain tests cover isolated member effects, intervals/arc geometry, legacy loading and invalid data, copies/split/detach, deterministic Gaussian falloff and bounded particle generation. Browser tests compare pixels, unchanged ink paths, native pointer-event isolation, save/reload, one-transaction slider drags, stable zoom caches, and real hair before/after previews.
