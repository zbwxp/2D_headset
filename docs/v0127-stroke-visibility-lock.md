# V0.12.7 · Stroke Visibility & Lock

Continuous and closed stroke rows now have whole-stroke visibility and lock controls. They apply atomically to all connected member curves, including branches and named single-curve groups. Member controls remain independent.

- Any visible member: hide all. No visible members: show all.
- All members locked: unlock all. Otherwise: lock all.
- Mixed states use amber controls with a tooltip and accessible mixed state.
- Group visibility can be changed while its geometry is locked. A locked parent layer disables both group controls.
- Hiding a selected group removes its transform box. Locked curves have no draggable node/handle controls.

The commands update existing member flags, so Undo/Redo and Save/Load use the existing document transaction/schema. No new stored group asset is introduced.

Validation: Drawing/catalog unit suite and browser tests for named/branched and closed strokes, mixed member states, parent locks, atomic Undo/Redo, persistence and bilingual controls.
