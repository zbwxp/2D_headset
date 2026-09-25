# V0.12.6 · Continuous Stroke Groups

Drawing Room derives one continuous-stroke group from every connected component of shared endpoint nodes. POSITION, SMOOTH, CUSP and ARC all count. Connection modes still control local geometry: POSITION leaves handles independent; Smooth/Cusp constrain directions; ARC retains its derived transition. Removing only a tangent join retains group membership. Unbinding or deleting geometry recomputes connected components.

V selection, layer-list grouping, whole-stroke ordering, width and profiles use this membership. Simple POSITION chains and loops now render as a continuous path. At multiway nodes, paired joins retain their route and remaining branches render as separate subpaths in the same group; no artificial connection is drawn across branches. Offset creation uses the selected member's continuous route.

Select the group or one of its members and edit **Stroke name / 笔画名称** in Properties. The layer list shows the group name above individual curves. Segment names remain independent. Optional `DrawingCurve.strokeName` stores only the label on members; there is no additional persistent Path topology. The label survives splitting, duplication, deletion of another member, and Save/Load. A newly bound group takes the first-click group's explicit name, or the second group's name if the first is unnamed. Disconnected descendants initially retain the label and may be renamed independently. Old documents need no migration.

Validation covers all four join modes, mixed chains, cycles, branches without phantom ink, independent POSITION handles, names through topology changes, locks, Undo/Redo and Save/Load, plus existing Drawing regressions.
