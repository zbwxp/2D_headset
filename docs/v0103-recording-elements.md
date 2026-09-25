# V0.10.3 — Recording Element Lists and Frame Visibility

All Recording Room curve types (semantic, free and guide) now support list drag/drop, matching recorded points. Drop on the upper/lower half of a row to insert before/after it. Sorting preserves IDs, selection, keys, semantic endpoints and Junction references. Both lists use the same drag interaction; their array order is saved. Cross-list moves are not allowed.

Every recorded point/curve inspector exposes **Hide/Delete at This View / 在当前帧隐藏/删除** and **Restore at This View / 在当前帧恢复显示**. This is the existing curve view-visibility behavior, now shared with points. It records a visibility sample, not a geometry-key deletion or permanent asset removal. Permanent deletion and key-list deletion remain separate operations. Hidden elements stay in the list with a current-view badge.

- Points gain optional `visibilityKeys` with the same canonical yaw/pitch validation, interpolation and threshold behavior as curves. Shape keys retain their values and counts, and other authored views seed their original visible state. Between samples, visibility follows the existing visibility field.
- Editor drawing, point picking and Final Preview respect point global visibility and the view visibility field. Hiding a point hides its marker only; attached semantic curves still evaluate from the point's geometry.
- Existing curve visibility still suppresses its picking, snap targets and affected Smooth transitions.
- Global checkboxes remain separate. The inspector explains when an element is globally hidden. Locks protect view-visibility changes; list order can still be changed.
- Reorder and view-visibility commands support atomic Undo/Redo and Save/Load. Legacy points without visibility keys remain visible by default.

Validation: production build, 62 recording/language unit tests, and 16 targeted browser tests pass. Coverage includes point/curve sorting, exact-view hide/restore, negative yaw, preserved point dependencies, Smooth suppression, locks, keyboard/mirror regression, Undo and persistence.
