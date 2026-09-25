# V0.6.0 — Unified Geometry Authoring, Phase 0–2

Reference: app/package version `0.6.0`; source persistence schema remains unchanged.
Stopped before Phase 3: no 2D GPU Surface picking, no ON_PATCH source.

## UI
- Creation Shelf: Point / Curve / Surface dropdowns; disabled entries carry reasons.
- Active Tool Bar: active tool, step/host, pending boundaries, Undo Step, Cancel Esc.
- Sidebar: Construction / Points / Curves / Surfaces. All use ObjectRow and InlineInspectorHost.
- Inline sections: Identity / Source / Relations / Operations. Existing source controls are reused.
- Relations resolve actual ObjectRef values and select, expand and scroll to the object.
- Verified reciprocal pairs retain separate UUIDs, default RIGHT, L/R switching and double-click Rename.

Screenshots: `artifacts/v06/point-inspector.png`, `curve-inspector.png`, `surface-inspector.png`, `active-tool.png`.

## State ownership
`useEditor.selection` is the single selection authority:

```ts
type ObjectRef =
 | { kind: 'point'; id: string }
 | { kind: 'curve'; id: string }
 | { kind: 'surface'; source: 'PATCH' | 'HELMET' | 'CAP' | 'REGION'; id: string }
 | { kind: 'frame'; id: 'head' };
```

`selectObject` only validates/selects; no source edit, history entry or authoring step.
`selectedId`, `selectedCurveId`, `selectedPatchId` are read-only derived getters.
Legacy action payloads enter a central normalization bridge that translates them to `selection`; they are never stored independently. Existing renderer consumers can continue reading the getters.
`useLoomisUI.regionId` was removed. Region selection derives from ObjectRef.

`useEditor.tool` is the single ToolSession authority: select, curve, patch, surfacePoint, region.
`curveCreation` / `patchCreation` are derived getters. `useSurfaceTool` and `useRegionTool` no longer own Zustand stores; they are projection/action adapters over ToolSession.
Drafts hold source additions separately from project/history. Materialization rejects a stale base or duplicate IDs. `commitToolDraft` installs a completed command delta in one history step; cancel drops the draft. This is transaction infrastructure, not an ON_PATCH implementation; future commands must validate their own domain payload before submission.

ObjectAdapter supplies names, mirror rows, source identifiers, capabilities and Relations. DescriptorRegistry currently maps source identifiers to reused field renderers; it is not a generic form/schema engine.

## Migrated and transitional interactions
Migrated: point creation, free-curve creation entry, Section creation, boundary/loop creation entry, Cap/Region entry, unified selection, object lists, relation navigation, ordinary 3D selection, pair rename/delete, inline parameters.
2D point and curve tool hits explicitly dispatch authoring actions; selection actions never advance the tool.
3D ordinary point/curve/surface clicks select only, including while a boundary tool is pending. 3D can still display pending geometry as a preview. Boundary/anchor authoring uses the 2D tool path.
Explicit existing Construction Surface Point and Region-preview 3D creation, and existing surface-point 3D dragging, remain transitional until Phase 3. Their lifecycle already uses ToolSession.
Old LandmarkList / CurvePanel / PatchPanel / HeadFramePanel wrappers remain in source for transition but are not mounted by App. Reused field controls (Section, Plane, Fullness, surface/online position, offset, NumericSlider) remain active.

## Regression evidence
Baseline captured before edits: `artifacts/v06/pre-v06-source.tar.gz` (includes uncommitted source). Git reference at start: `8ed76d9`, dirty working tree; do not use that commit alone as the full pre-change snapshot.
Binary comparison against that archive: **no files under src/domain or src/rendering changed**.

- Build passes; existing bundle-size warning remains.
- Full unit suite: **294 passed, 6 failed / 300**. Baseline: **291 passed, 6 failed / 297**. Added three unified-state/draft tests pass. Boundary tool test intentionally updated from partial Esc-cancel to Undo Step; Esc now exits the session.
- Browser regression: **14 passed**, covering unified sidebar and screenshots, pure selection, pairs/Rename/Undo, draft cancel/atomic history, 2D free-curve/control-handle interaction, ON_CURVE, Section/Cap/surface-point controls, 3D point hover/picking/orbit, independent Contour/3D projection, and all NumericSlider interaction cases.
- Existing geometry unit coverage includes Tri/Quad/Lens/Loop, Fullness, Continuity, Sections/Rim/caps, symmetry, dependencies, source evaluation and persistence. Old browser suites targeting removed panels have not all been ported or claimed to pass.

Pre-existing failing tests (unchanged failure categories):
1. head-frame migration solver test exceeds 5s under full-suite load.
2. head-frame save/load comparison distinguishes -0 and +0.
3. landmarks legacy preset/serialization expectations.
4. landmarks old 45-degree view assertion versus current 30-degree preset.
5. on-curve save/load comparison distinguishes -0 and +0.
6. patch-prep save/load comparison distinguishes -0 and +0.

No geometry formula, Patch solver, Fairing, Contour algorithm or source schema changed in this batch.
