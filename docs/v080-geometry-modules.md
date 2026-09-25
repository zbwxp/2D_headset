# V0.8.0 — HeadSet / Eyes geometry modules

Modeling source objects share the existing geometry arrays and pipeline. The
project stores `geometryModules: Record<UUID, 'HEADSET' | 'EYES'>`; absence in old
files means HeadSet. Parsing and editor initialization materialize ownership.
Default scaffold ownership always remains HeadSet. New objects and their mirror
partners acquire the active module at the source transaction boundary.
The Eyes container exists even when its filtered collections are empty.

Runtime `activeModule` controls the modeling sidebar, selection and pick policy.
Module changes end an edit and clear selection and ToolSession. Inactive geometry
is rendered unchanged in all views. Default scaffold is a selectable reference
exception; its inspector is read-only outside HeadSet. Shared HeadFrame changes
are performed in HeadSet. No Eyes scaffold or eye-specific mirror is generated.
Existing generic symmetric creation remains available in either module.

Commit checks reject source mutations or deletions of inactive objects. New
references may use active objects or Default scaffold, never ordinary inactive
geometry. Duplicate/delete paths and geometry-authoring picking commands also
check permissions. Continuity overrides check participating patches; changing a
global Smooth setting is rejected if inactive patches would be affected.
Viewport/display controls remain global. Undo/Redo remains project-wide.

2D and 3D picking are filtered separately from rendering. Contour is still a
read-only rendering of the full geometry. Recording Room is unchanged.

Save/load includes ownership; active module is an editor preference, not a second
project or separate geometry evaluator. UUIDs, positions, curves, patch topology
and source formulas are unchanged by grouping.
