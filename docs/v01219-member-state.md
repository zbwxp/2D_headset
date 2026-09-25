# V0.12.19 · Member Visibility and Locks

Drawing Room group, layer and continuous-stroke visibility/lock buttons now perform one-shot batch actions on their current members. There is no inherited container gate. A member can subsequently show, hide, lock or unlock independently. Showing or unlocking the whole container sets all current members to that state; it does not restore a previous hidden/locked mask. Newly created or moved-in members do not inherit past batch actions.

Container icons summarize the actual members (including owned fills; layers also include offsets). Mixed states use the existing amber indication and “Partly visible / Partly locked” tooltips. Individual flags remain authoritative. Empty containers have disabled state buttons. Existing geometry locks still protect edits that would move another locked curve through a shared node or endpoint relation.

Fill visibility remains independent of boundary segment ink and display intervals. A whole-stroke batch hide now sets the fill's own visibility, so the fill can be shown independently afterwards. Group and layer actions also set fill locks; fills can be independently unlocked.

Drawing schema V3 flattens old V1/V2 layer/group visibility and locks into effective member flags on load, and folds legacy `hiddenWithStroke` into fill visibility. Geometry, ordering and relationships are preserved. Legacy container fields remain neutral and are ignored by rendering and editing. A V3 reload does not reapply a previous batch action. Live pre-V3 sessions migrate without reloading the page or creating an authoring Undo. Normal batch actions and member overrides use the existing atomic Undo/Redo system.

Validation: 126 Drawing/i18n unit tests, 30 browser regressions, production build. Browser coverage includes hiding/locking a group or layer, independently showing/unlocking a member and dragging its handle, fill-only visibility/editing, mixed indicators, Undo/Redo, Save/Load, group-to-layer promotion and cross-layer transfer.
