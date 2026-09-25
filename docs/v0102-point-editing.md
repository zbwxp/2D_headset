# V0.10.2 — Recorded Point Editing

- Select a Recording Room semantic point on the canvas or in the list, then use arrow keys to move it in the displayed horizontal/vertical directions. Normalized step is 0.005, Shift multiplies by 5, Alt by 0.2. Negative yaw inverse-mirrors the write just like dragging.
- Nudging outside coverage creates a current-view key. Attached semantic curves follow without gaining curve keys. A held arrow repeats and produces one Undo entry; releasing, changing focus/selection/view/tool, leaving the window, or Undo ends the repeat.
- Locked points cannot move. Inputs, sliders, dialogs, other controls and active modeling tools retain their own keyboard behavior. Nudges do not invoke endpoint snapping, allowing precise motion away from nearby geometry.
- Drag a point list row or its grip onto the upper/lower half of another row to insert before/after it. The drop indicator shows placement. Locks protect geometry, so locked points can still be reordered.
- Array order persists in `Recording.points`; point IDs, positions, curve references and selection remain unchanged. Each completed reorder is one Undo transaction; cancelled and unchanged drops do not add history. No save schema changes.

Validation: production build passes, 60 recording/language unit tests and 8 recorded-point browser tests pass, covering keyboard modifiers/long press/Undo, negative yaw, input isolation, point locks, row drag/drop, geometry preservation and Save/Load.
