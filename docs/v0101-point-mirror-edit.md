# V0.10.1 — Recorded Point Mirror Edit

The existing Recording Room **Mirror Edit / 镜像编辑** tool now accepts recorded semantic points as well as curves. Click the source point and then a different, unlocked target point, either on the canvas or in the point list. The source is highlighted during the two-click operation. Point/curve pairs cannot be mixed.

- Read the source's evaluated position in the current view, including interpolation. Do not create a source key.
- Reflect its displayed X coordinate about the centerline, preserve Y, then inverse whole-view mirror before writing the target's canonical key.
- An uncovered target is allowed. If it has no exact key, create one even when the mirrored position matches the frozen/interpolated reference.
- Source keys, unrelated points and raw curve keys stay unchanged. Every semantic curve attached to the target follows its new position and retains its endpoint-relative handle vectors.
- Frozen sources, locked targets and self-targeting are rejected. A locked source can still be read.
- Complete in one Undo transaction, return to Edit and select the target point. Escape and view navigation use the existing tool cancellation rules. Save format is unchanged.

Validation: production build, 59 recording/language unit tests and targeted browser tests for point/curve mirror, negative yaw, dependency propagation, Undo/Redo, Save/Load and selection guards.
