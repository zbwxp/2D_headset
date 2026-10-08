# 20 — Packages from the point / line / face graph (draft for bowen's sign-off)

bowen 1791425592:
> 首先把现有的图谱写成package（这是python的说法， ts啥的该怎么写你们自己知道） 就是现在所有的工具 概念都有它们各自的归属 那么就应该写进它们对应的package，以便后面的进行调用。代码要模块化，这样出逻辑问题也局限在模块内部

**Status:** draft, revised after dot 1791425776: one-time edits moved into their owning modules, and `edits` replaced by a thin `commands` layer. No code until bowen signs off the direction. Per retro §9, this file is the checklist committed **before** the first code commit.

Source of truth: the relationship graph in `docs/design/review/2026-10-07-architecture-walkthrough.md`, as of `5a6d95c`.

## 1. Rules for every package

0. **"Package" here means a module boundary**, a folder with one entry file, all inside one npm package. Not every concept is a separate npm package (dot 1791425776).
1. **Exposed interface only.**
   - Each package is one folder with one `index.ts`; outside code imports only from it.
   - A lint rule fails the build on deep imports.
2. **Dependencies point one way** (section 3). There are no cycles, and a lower package never imports a higher one.
3. **No UI and no drawing library in these packages.** They are pure logic (data in, data out), tested with unit tests. The UI (Fabric, React) only calls `index.ts`.
4. **Each package owns its own data.** Other packages read it through the interface; they never write it directly.
5. **One edit pipeline** (section 4). After every complete edit, the maintenance steps run in a fixed order, in one place. Packages never call each other ad hoc to "fix up" after an edit.

## 2. Packages and what goes in each

| Package | Graph level | Owns (data) | Exposes (operations / queries) |
|---|---|---|---|
| `geometry` | (math base) | nothing | Bézier evaluate / split / bounds / nearest, arc fillet between two curves. Wraps `bezier-js`. |
| `network` | point, line | points (position), lines (two point ids + two handles) | **Owns the one-time edits on points and lines:** add line (pen), drag point, drag handle, split / add point, delete line, **bind** (merge points; delete lines with both ends on one point), unbind, merge position (one-time snap), copy.<br>Queries:<br>- lines at a point;<br>- **connected groups** (continuous curves);<br>- **loops** (closed curves), found on demand. |
| `commands` | (orchestration only) | nothing | One entry per user action. It calls the owning module's operation, then runs the pipeline (section 4). **It holds no rule logic of its own** (dot 1791425776). |
| `joins` | point attribute | join table per point: rows of {line end A, line end B, mode smooth / cusp / arc, radius} | Set / clear a join; tool presets. **Solve smooth springs** (one global stiffness). |
| `links` | cross-layer relation | link attribute on both points (partner id) | Create / remove a link (cross-layer only). **Realign**: average the targets of the directly acted-on points. Clear on partner deletion. |
| `strokes` | point + continuous curve attributes | end stroke per point; line stroke (width, profile) per connected group | Set / get; unify to the first-clicked group on bind. |
| `derived` | (shared result) | nothing persistent | **Final geometric outline:** centreline after joins (arc trims and inserts) and deformation. Read by both strokes and fills. |
| `fills` | closed curve attribute | fill per loop {boundary segment refs, style, visible} and fill order within a group | Fill (smallest loop at a point; larger from the list), clear, show / hide, reorder. **Maintain identity** on split and bind, and drop a fill when its loop no longer closes in one layer. Boundary shape comes from `derived`. |
| `layers` | layer | ordered list of layers; ordered list of groups in each layer | New / delete / reorder; **merged group takes the first-clicked slot**; a split group goes next to the original; a new fill goes on top. |
| `history` | (general) | undo stack, transactions | Run one complete edit as one transaction; undo / redo. |
| `selection` | (general) | selection state | Select point / handle / line / group / loop; picking rules (smallest loop). |

**Left out on purpose** (decided "later" by bowen): merge-position UI details, deformation, mirror editing, show/hide intervals (they will go in the continuous curve level), views / snapshots, reference images, recording.

## 3. Dependency direction

```
geometry
   ↑
network
   ↑
joins   links   strokes   layers
   ↑       ↑       ↑        ↑
          derived ←──────────┘ (reads joins; deformation later)
             ↑
           fills
             ↑
commands ── pipeline (section 4) ── history, selection
```

- `commands` only orchestrates. The rules live in the owning modules: `network` (split, bind and so on), `joins`, `links`, `fills`, `layers`. `fills` and `layers` are never edited by another module directly; they react in the pipeline.
- `derived` is the **only** place that computes the final outline, so strokes and fills can never disagree (dot 1791425290).

## 4. The edit pipeline (one place, fixed order)

For every complete edit, inside one `history` transaction:

1. **Apply the edit** to `network` (and record which points were directly acted on).
2. **`links.realign`:** average the targets of the directly acted-on points; the other points in each link group follow.
3. **`joins.solve`:** spring smooth balance at the affected points.
4. **`fills.maintain`:**
   - update loop references for splits and binds;
   - drop fills whose loop no longer closes in one layer.
5. **`layers.normalize`:** group merge / split order rules.
6. **`derived`** is recomputed lazily, only for what changed.

This is the "follow the principle, no special cases" rule (bowen 1791392314) turned into code: delete, unbind, copy-then-delete and moving to another layer all go through the same steps.

## 5. What comes from libraries

| Library | Used for | Already in the proto |
|---|---|---|
| `bezier-js` | curve maths inside `geometry` | yes |
| `@tldraw/store`, `@tldraw/state` | record storage, change diffs and undo inside `history` (local only, no purchase) | yes |
| Fabric | **UI only**, outside these packages | yes |

Everything in sections 2–4 above the library level is our own code. The graph rules are ours, and no library provides them.

## 6. Acceptance cases (written as tests before the code)

| Case | Expected |
|---|---|
| Triangle, bind two adjacent points | Lemon remains; fill kept |
| Lemon, bind its two points | Both lines and the fill are deleted |
| Minimal θ, bind the middle line's ends | Everything is deleted |
| θ with a mid point on one arc | That arc survives as a loop |
| Split a line of a filled loop | Fill kept; boundary references the two halves |
| Delete a loop line / unbind / copy-then-delete | Fill gone; other loops unaffected |
| Outer loop filled red, add a chord | Red stays on the outer loop (identity) |
| 3 lines all smooth | 120° |
| 4 lines all smooth | 90° (not just "a large k") |
| Link, edit one side to 10 | Both at 10 |
| Link, both sides acted on (0 and 10) | Both at 5 |
| Link chain A–B–C, move A and B together by 10 | Group moves 10 once |
| Two copies of a link | Counted as one spring, not two |
| Arc join on a filled loop | Fill follows the arc |
| Hide ink / taper / widen stroke | Fill boundary unchanged |
| Bind group A (first) to group C with B between | Merged group takes A's slot |

## 7. Questions for bowen (direction only)

1. **Where?**
   - **(a) recommended:** a new, clean set of packages next to the proto. The current proto UI is later switched over to call them.
   - **(b):** rewrite the proto's model in place.
2. **Is the package split in section 2 right?** In particular: points and lines share one `network` package, because lines are defined by their points; joins, links, strokes and fills are separate packages.
