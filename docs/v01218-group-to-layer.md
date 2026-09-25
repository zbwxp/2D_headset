# V0.12.18 · Group to Layer

Creating a group still creates an element inside its current layer. Drag the group header onto the Layers + button to convert it into a new layer. The + button highlights on a valid group drag; ordinary clicks still create an empty layer. The group's Properties also offers “Convert group to layer”.

Conversion removes the group container and creates a layer with the same name immediately above its former owner. It carries all member curves and owned fills in their existing internal paint order. Geometry, joins, profiles, display intervals and individual flags are unchanged. The new layer inherits effective group/owner visibility so hidden content is not revealed. Other source-layer objects remain in place. Locked containers or members reject the operation atomically. The operation uses one existing Undo transaction and requires no save-schema change.

V selects a whole group. A or expanded member rows select individual members; direct selection now also supports dragging a curve body. Handles, endpoints, width and other properties remain individually editable subject to existing shared-node relationships. Shift-click retains multi-selection. Selecting a member never dissolves its group.

Validated with group domain regressions and browser coverage for plus-button drag feedback/drop, Properties conversion, member movement/handles/width, Undo/Redo, hidden states, save/load and existing Drawing/layer workflows.
