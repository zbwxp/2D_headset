# Draft graph rows: 元线条, views, expressions, broadcast (for bowen 1791645593)

**Revised after dot 1791645801.** **Status:** candidate rows, **not in the graph**. They are written into the walkthrough graph only when bowen says "写". dot attacks them first. The discussion behind each row is in `glossary-animation.md` and the walkthrough (Q32).

Format as in the graph: subject | relation | object | status | source.

### Model and 元组件

| Subject | Relation | Object | Status | Source |
|---|---|---|---|---|
| Model | is | A combination of 元组件 that plays angle and expression animation (e.g. mouth 2 + eye 1 + ear 1). Several models may share a 元组件. Choosing among a feature's presets (eye 1–6) is runtime UI, not architecture. | decided | bowen 1791634995, 1791639688 |
| 元组件 | is | A layer, with a **type** (眼睛) and a **name** (眼睛1, 圆眼1). It is a semantic group, not another geometric level. | decided | bowen 1791634995, 1791637819, 1791645279 |
| 元线条 | is identified by | Its 元组件 + its name. The same name in different 元组件 means unrelated lines. | decided | bowen 1791623875, 1791634995 |
| Renaming a 元线条 | keeps | The same line: its nine views, expressions and existing references stay connected. Only copying makes an independent new object. How ids are stored is an implementation choice. | candidate (result requirement) | dot 1791645801 |
| 元线条 | has | One shape in each of the nine views, plus its look (strokes, show / hide intervals, fills) and its expressions. It is created automatically when drawn. There are no separate drawing lines and bone lines. | decided | bowen 1791624350, 1791640911 |
| Copying 元线条 or a 元组件 | makes | New identities (editing the copy never changes the original). Every view, the expressions and the broadcast baselines are copied as they are. | decided (copy) / candidate (baseline as is: dot 1791642599, Claude 1791642620) | bowen 1791634995, 1791640535; dot 1791637961 |

### Views

| Subject | Relation | Object | Status | Source |
|---|---|---|---|---|
| Views | are | Nine: yaw −90 / 0 / +90 × pitch −45 / 0 / +45 (pitch ±45 is a candidate value). Between views the shape is interpolated. | decided (nine); pitch candidate | bowen 1791637819, 1791638945; dot 1791639052 |
| Adding or deleting a line | in any view | Adds or deletes it in all nine. Editing a shape changes only the view being edited. | decided | bowen 1791637819, 1791640911 |
| A line's view not yet made | equals | That line's current front, at once, also before any broadcast; broadcast pushes only to views the line has been made in. "Made" is judged **per line in each view** (a new line in a finished model has no model yet: it counts as made only in the view it was drawn in, and its other views follow the front. Drawn in a non-front view, its front starts as a copy of that shape and is adjusted by hand; dot 1791646368). "Made" is a stored mark, never inferred from "shape equals the front" (dot 1791645873). | decided (甲 + A) | bowen 1791640535, 1791646151, 1791646291; dot 1791640627, 1791645873, 1791646368 |
| Diagonal view | is drafted as | The front + the yaw change + the pitch change (vector sum), then adjusted by hand. | decided (draft method) | bowen 1791639688; dot 1791639052 |
| Right-side views | can be drafted | From the left by a one-off mirror apply (graph row "Mirror apply"); they are not bound to the left afterwards. A lasting link is a separate choice (row "Mirror link"). The left / right pairing may reuse mirror-link pairs (candidate, to be checked). | decided (mirror apply as a draft); pairing candidate | bowen 1791638945; dot 1791639052, 1791639097, 1791645801 |

### Expressions

| Subject | Relation | Object | Status | Source |
|---|---|---|---|---|
| Levels | are | At most two: the angle level (nine views) and the expression level. Expressions combine with each other and are carried by the angle level. | decided | bowen 1791622232, 1791622727 |
| Expression | is | A 0 → 1 change of chosen lines. Its 0 is always the 0,0 front; it is made at the front by default. | decided | bowen 1791637819, 1791638945 |
| Combination fix (angle × expression) | is | Off by default. Added by hand only when a combination is generally wrong; it belongs to the motion and lives in the expression level, never a third level. | decided | bowen 1791622843, 1791623025 |

### Room, modes, broadcast

| Subject | Relation | Object | Status | Source |
|---|---|---|---|---|
| Editor | is | One room with modes (draw, angle, expression, playback). No loading between rooms. | decided | bowen 1791640535, 1791640911 |
| Editing a view | shows | The new shape at once, while making and at runtime. | decided | bowen 1791640535 |
| Broadcast | is | An explicit action after editing the front. The other views (or expressions) are derived from the change between the current front and the matching baseline; then that baseline is set to the current front. Without broadcast, views and expressions that have their own shapes do not change. | decided | bowen 1791640535, 1791642539; Claude 1791642580; dot 1791645801 |
| Broadcast derivation | is, for now | Adding "current front − baseline" to each target, point by point. | candidate (to be verified) | Claude 1791642580; dot 1791642640, 1791645801 |
| Broadcast | is | One edit: all its writes and the baseline advance succeed or roll back together, as one undo step. | candidate | dot 1791642640 |
| Broadcast baseline | is kept | Separately for angles and for expressions, saved in the making file. The runtime product does not carry these making records; publishing does not delete them from the making source. | decided | bowen 1791642767; dot 1791645801 |

### Matching

| Subject | Relation | Object | Status | Source |
|---|---|---|---|---|
| Finding the closest 元组件 | searches | Only within the same type. Candidates are ranked by shape (position and overall size normalised; aspect ratio and corner tilt kept; parts scored separately) and the user picks. A score suggests "probably less work", not "fewest edits". | decided (same type); ranking candidate | bowen 1791645259, 1791645279; dot 1791644993 |
| Deriving views from a match | is | A broadcast from the match's baseline: the match's other views + (new front − its baseline front). It needs every new line paired with a line of the match. | candidate | bowen 1791645259; Claude 1791645293 |

### Not yet settled (not rows)

- **Which shape a match uses** (dot 1791645801): a candidate with an unbroadcast edit shows a front that is not the baseline its other views correspond to. Which one ranking compares and which one deriving uses is settled in the derivation experiment.
- **Line pairing for a match:** whether a type carries standard line names; point pairing within a line (resample by proportion); extra or missing lines.
- **The offset rule itself:** how "front − baseline" is applied to a side view or an expression. To be verified by experiment.
- **Acceptance targets:** publishing does not change the face; the component search causes no sudden change; "expression needs adapting" marks; autosave / crash recovery (separate from rollback).
- **Minor:** 画稿 vs 线稿.

### Flow checklist must cover (dot 1791645801)

- add a line in a side view, then adjust it at the front;
- copy a 元组件 that has an unbroadcast edit;
- broadcast angles and expressions separately;
- repeated broadcast, and undo;
- save, reopen, continue broadcasting.

Core flows may go in stages; matching and auto-fit experiments do not block the editor.
