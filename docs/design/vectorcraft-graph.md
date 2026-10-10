# VectorCraft knowledge graph (for comparison with ours)

**Requested by** bowen 1791628701 ("可以为它单独制定一套知识图谱方便于我们的进行对照"); plan `vectorcraft-eval-plan.md`.

- **Source:** github.com/storytold/vectorcraft at commit `5b198f3c009c07d7729ac92152940dd537022551`. Paths are relative to that repository.
- **Method:**
  - **Source reading only**; nothing here comes from running the app (the build waits for the Rust 1.95 toolchain).
  - Rows were extracted by a read-only research agent. Claude re-read the key ones (§1–2: `crates/geom/src/path.rs` 29–41 and 183–189, `crates/doc/src/selection.rs` 9–10, `crates/engine/src/cmd/path.rs` 340–366 and 388–400).
- **Rules:** facts only; "not found in this check" means not found by this reading, not "not supported".
- **Sections** follow ours (graph sections in the architecture walkthrough).

## 1. Points, anchors, handles, segments, paths

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Anchor | has | `p`, `h_in`, `h_out` (absolute positions) and `kind` | crates/geom/src/path.rs:29-41 |
| Handle | is | an absolute position; a handle equal to `p` means "no handle" | path.rs:29, 131-136 |
| AnchorKind | is | `Corner` (default; handles independent) or `Smooth` (handles collinear) | path.rs:19-27 |
| Smooth anchor | keeps | the opposite handle aimed opposite, at its own length, when one handle moves | path.rs:147-163 |
| SubPath | is | `anchors: Vec<Anchor>` plus `closed: bool` | path.rs:183-189 |
| Segment | is | not stored; derived between consecutive anchors as cubic(a.p, a.h_out, b.h_in, b.p) | path.rs:200-216 |
| PathData | is | `subpaths: Vec<SubPath>` | path.rs:352-356 |
| Path node | holds | `path`, fill rule, optional `live` parametric shape, `clipping`, `guide` | crates/doc/src/node.rs:426-438 |
| Live shape | is dropped | when anchors are edited | node.rs:76-130; crates/engine/src/cmd/path.rs:119-128 |

## 2. Shared points and topology (the key question)

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Anchor | is owned by | exactly one SubPath, stored by value, with no id | path.rs:183-189 |
| Anchor reference | is | a position `(subpath index, anchor index)` inside one node | crates/doc/src/selection.rs:9-10 |
| A point shared by two paths (graph, network, weld, constraint) | not found in this check | searched "topology", "network", "weld", "shared anchor", "glue", "connector", "constraint", "coincident", "planar" in doc, geom, engine/cmd, tools | — |
| `path.join` (two paths) | merges | the **first open subpath** of node B into the first open subpath of node A (reversed as needed; requested ends, else the nearest pair). Ends within 1e-6 collapse into one anchor. Otherwise the anchors are appended, so the new segment uses the existing end handles and **may be curved**, not straight. **The whole node B is deleted**: its other subpaths are not carried over. A keeps its id. | engine/src/cmd/path.rs:331-370 (corrected per dot 1791629225) |
| `path.join` (one path) | closes | its open subpath | path.rs:308-324 |
| Pen tool | joins | onto another path's open end through `path.join` | crates/tools/src/pen.rs:178-183 |
| `path.average` | moves | selected anchors (across paths) to their mean: coinciding, not linked | engine/src/cmd/path.rs:388-417 |
| Cut at anchors | makes | two coinciding, independent anchors | geom/src/path.rs:310-343; engine path.rs:535-582 |
| Live Paint | computes | faces and edges as a derived result, stored as ordinary groups, not as shared points | crates/pathops/src/planar.rs:1-17; crates/tools/src/builder.rs:1-12 |

## 3. Continuous curves, compound paths, groups

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Continuous chain | is | one SubPath; a chain across several path objects is not found in this check | path.rs:183-189 |
| Compound | is | child paths painted as one, with a fill rule | node.rs:439-444 |
| Group | is | children, optionally clipped by the first | node.rs:420-425 |

## 4. Corners and joins

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Geometric smoothness | is | per anchor, inside one subpath (`AnchorKind`) | geom/path.rs:19-27 |
| Convert anchors | sets | corner (handles retracted) or smooth (handles in line, a third of the way to each neighbour) | engine path.rs:419-445; geom path.rs:273-309 |
| Stroke join (miter, round, bevel) | is | a paint attribute of a stroke, not geometry | crates/doc/src/appearance.rs:15-21 |
| Live corners | store | per-corner radius and kind on the parametric shape | node.rs:117-129 |
| A join constraint between two different paths (smooth / cusp / arc) | not found in this check | — | — |

## 5. Links and constraints

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| A general constraint system | not found in this check | "constraint" found only in puppet-warp pins | crates/tools/src/distort/arap.rs:8-13 |
| Symbol instance | references | a symbol by name, plus a transform | node.rs:447-450 |
| Mirror | exists as | Live Repeat "Mirror" over source nodes (a generated copy), and a Mirror & Cut tool | crates/doc/src/pattern.rs:399, 413-416; crates/tools/src/cut.rs:1-8 |
| Graphic style | links | by id; the link breaks on an appearance edit | node.rs:539-542 |

## 6. Closed shapes and fills

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Fill | is | an item in the node's appearance stack | appearance.rs:446-454 |
| Fill rule | lives on | the path or compound node | node.rs:429, 443 |
| Fills on regions | exist only as | Live Paint's generated face paths | tools/src/builder.rs:7-12 |

## 7. Layers, locks, visibility

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Document | holds | `layers` (bottom first); sublayers nest | crates/doc/src/lib.rs:537-538; node.rs:400-419 |
| Every node | has | `visible`, `locked`, `opacity`, `blend` | node.rs:495-558 |
| Editable | means | the node and all its ancestors are visible and unlocked | doc/lib.rs:914-916 |

## 8. Undo and transactions

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| History entry | stores | label, a whole-document snapshot (`Arc<Document>`), the selection; limit 500 | engine/src/lib.rs:61-75 |
| Structural sharing | is | children as `Arc<Node>`, copied on write along the path | node.rs:493; doc/lib.rs:813-820 |
| One edit | is | a closure on a copy-on-write document → one undo step. On error (including a post-edit sanity check) the document and selection roll back. **Previews during an interaction are merged** (they are not separate steps) | engine/lib.rs:1189-1240, 1268-1338 |
| Guard | catches | a panic in a command, restores the document, and reports an internal error | engine/lib.rs:1163-1187; engine/src/guard.rs:14-23 |
| Batch over MCP | is | one undo step per step, not atomic | crates/mcp/src/tools.rs:96-105 |

## 9. Editing

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Selection | is | objects, plus selected anchors per path `(si, ai)` | selection.rs:12-36 |
| Handles and segments | are not | stored in the selection (handles are tool state; a clicked segment selects its two anchors) | crates/tools/src/direct.rs:1-23, 229-246 |
| Transforms | are | commands (`object.transform`, move, rotate, scale, reflect, shear) on a subtree | engine/cmd/object.rs:22-65; node.rs:832-869 |
| Scissors | opens / splits | a closed subpath is opened **inside the same node**; an open path with **one** subpath splits into two nodes (a new sibling); with **several** subpaths, both pieces stay in the same node | engine/cmd/draw2.rs:879-904 (corrected per dot 1791629225) |
| Delete anchors | opens / drops | a closed subpath at the anchor / subpaths under 2 anchors, empty nodes | engine path.rs:447-479 |
| Other objects | get | no shared-end-point coupling from these edits. The single edit entry still refreshes dependent content (masks, text wrap, threads…) | same functions; engine/lib.rs:1197-1215 (corrected per dot 1791629225) |

## 10. Interaction

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Command | is | `{id, label, menu, shortcut, params, enabled, run, journal}` | engine/cmd/mod.rs:97-110 |
| `Session::execute` | is | the single entry for UI, CLI, control channel and MCP | engine/lib.rs:1070-1099 |
| Tool | emits | Begin / Preview / Commit / Cancel (and Exec, Dialog…), never changes the document itself | crates/tools/src/lib.rs:1-7, 134-152 |
| Begin / Preview / Commit / Cancel | are | snapshot / re-run on the snapshot / one undo step / drop | engine/lib.rs:1268-1338 |
| Control channel | offers | `engine.execute`, `ui.pointer`, `ui.tool.select`… (JSON lines) | crates/ui-egui/src/control.rs:10-14, 137-150 |

## 11. Names and ids

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Node id | is | a per-document number, never reused | node.rs:16-19; doc/lib.rs:728-746 |
| Node name | is | optional; otherwise the kind is shown | node.rs:498, 716-728 |
| Anchor id | not found in this check | anchors are positions that shift on insert / delete | selection.rs:9-10 |

## 12. Save and open

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| `.vectorcraft` | is | JSON (optionally gzip): format, version 4, generator, document, images | crates/format/src/lib.rs:1-62 |

## 13. Live Blends and Envelope Distort (nearest to our in-betweening and deformation)

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Blend | pairs | subpaths by index; a missing subpath becomes a point at the centre of **its own whole path's bounding box** | crates/doc/src/blend.rs:377-425 (corrected per dot 1791629225) |
| Blend | matches anchors by | explicit start anchors if clicked; reversing a closed subpath if windings differ; splitting the segment with the longest **chord** (straight end-to-end distance, not arc length) at t = 0.5 until counts match. For closed subpaths, both are **centred and scaled by their bounding boxes**, then the cyclic shift with the least summed squared distance is sought: exhaustively up to 512 anchors, above that a strided search plus a local refine, **not guaranteed to be the global minimum** | blend.rs:300-375 (`grow`, `best_rotation`; corrected per dot 1791629225) |
| Blend | interpolates | `p`, `h_in`, `h_out` linearly; `kind` switches at t = 0.5 | blend.rs:322-324 |
| Envelope | maps | content bounds to [0,1]² and onto a warp, a mesh (Catmull-Rom grid or bicubic patches) or a Coons patch from a top path, splitting each segment (up to 64 pieces by fidelity) and mapping control points. **The curve mapping is an approximation** | crates/doc/src/live.rs:398-442, 1109-1157, 1570-1592 |

## 14. Layering of crates

| Subject | Relation | Object | Evidence |
|---|---|---|---|
| Layers | are | L0 geom, color; L1 doc; L2 pathops, brush, text…; L3 render, svg, format…; L4 tools; L5 engine; L6 ui-egui, mcp; L7 apps | xtask/src/layers.rs:35-64 |
| Rule | is | dependencies point strictly lower; UI crates only at L6+ | layers.rs:66-94, 175-209 |

## The key question, from source reading

1. **Two paths do not share an anchor in the stored model.** An anchor is a value inside one subpath, with no id, referenced only by position (`path.rs` 183–189; `selection.rs` 9–10).
2. **"Join" merges the first open subpaths of two path objects into one** and deletes the whole second node; coinciding ends collapse into one anchor (`engine/src/cmd/path.rs` 331–370).
3. **Average and Cut only make anchors coincide,** as independent copies.
4. **No network, weld or constraint structure was found** in this check. Live Paint's planar map is derived and stored as plain paths.
5. **Smooth / corner is per anchor inside one subpath;** stroke joins are paint attributes.

**Conclusion (dot 1791629225):** used unchanged, it cannot meet our network-relation needs. Whether keeping our relation layer and reusing its geometry and editing pays off is for the experiment. Source findings do not replace running it.

**Review:** dot 1791629225 confirmed the core finding (no cross-path anchor identity in the stored model) and corrected six descriptions (join, blend chord and alignment, missing subpaths, scissors, "other objects", preview merging, envelope approximation). Claude re-checked join, `grow`, `best_rotation` and scissors in the source and applied all corrections.

To be confirmed by running (flow test) once the toolchain is available.
