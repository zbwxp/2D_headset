# Architecture walkthrough with bowen (started 2026-10-07)

bowen asked (Slack 1791382158) for a new, separate record of the step-by-step architecture walkthrough. This is that record.

**Rules for this record:**

- **One entry per question.** Each entry has:
  - bowen's original wording;
  - the facts, with code locations;
  - our answer;
  - any corrections;
  - the status: open, or decided by bowen.
- **Fixed code baseline:** proto `4bc7cc2`. Uncommitted changes don't count.
- **Who writes what:** Claude records. dot checks independently. Only bowen decides.
- **Product code stays frozen** during the walkthrough (bowen 1791380182 "你们先停下").

---

## Relationship graph (bowen 1791382746: "我相当于帮你们建立一个知识图谱/关系图谱类似的东西")

> **Only write rows here when bowen asks** (bowen 1791382929: "这个还没让你写入关系图谱"). Q&A facts go in each Q entry, not in this table.

How this section works:

- **One row per relation:** subject, relation, object, source.
- **Updated alongside the questions below.**
- **Status of each row:**
  - **confirmed**: decided by bowen.
  - **current code**: a fact at 4bc7cc2, not a decision.
  - **open**: not decided.

| Subject | Relation | Object | Status | Source |
|---|---|---|---|---|
| Reference-image module | manages | Reference collection (add / remove) | confirmed | bowen 1791382641 (Q3) |
| View / snapshot | references | One image from the collection | confirmed (belongs to views for now) | bowen 1791382641 (Q3) |
| Reference-image tool | is the UI for | Reference-image module | confirmed (module = responsibility boundary, tool = how it is operated) | dot 1791382710, bowen 1791382641 (Q3/Q4) |
| Artwork layer | does not contain | Reference images | confirmed | bowen 1791382641 (Q3) |
| Layer | contains | Groups (incl. shape groups), paths, references (instances) | current code | Q4 |
| Path | owns | Its own fill (a closed path's fill) | current code (differs from confirmed Q18 rows) | Q2/Q4 |
| Shape group | owns | Faces (fills of enclosed areas) | current code (differs from confirmed Q18 rows) | Q2/Q4 |
| Path | consists of | Bézier segments (between anchors; anchor = point + two handles) | current code | Q2 |
| Reference (instance) | redraws | Another container's content, through a transform | current code | Q4 |
| Layer module | exposes interface | (not defined; no dedicated interface today) | open | Q1 |
| Snapshot / view | is | (no persisted domain object in the new version) | open | Q3 |
| Fill | is an attribute of | Closed curve (show / hide / clear; no separate fill element) | confirmed | bowen 1791390174, 1791390533, 1791390987 (Q18) |
| Fill | does not cross | Layers (cross-layer areas: fill each side and stack) | confirmed | bowen 1791389840, 1791390174 (Q17) |
| Closed curve | is a loop in | Continuous curve (all loops found automatically and listed) | confirmed | bowen 1791383633, 1791390174 (Q18) |
| Closed curve | references | Its boundary segments (a segment may be listed under several loops; stored once, drawn once) | confirmed | bowen 1791390174; dot 1791390408 (Q18) |
| Filled closed curve | keeps | Its identity and colour when points are added or other lines are bound to it | confirmed (required correctness) | dot 1791390408, 1791390592; bowen 1791390987 (Q18) |
| Closed curve | becomes invalid when | Its lines no longer connect end to end, close, and lie in one layer, checked after each complete edit. This covers deleting a line, unbinding, and copy-then-delete with no per-operation special case. The fill disappears with it. Adding a point keeps the loop. "Clear fill" is not "delete loop". | confirmed | bowen 1791391384 (Q20), 1791392314, 1791392425 (Q21); dot 1791390455 |
| Layer, and the elements in it | are | Ordered lists; closed-curve order = fill order | confirmed | bowen 1791390533 (Q18) |
| Continuous curve | is drawn as | Its fills first, then all its lines together (lines within the group use a stable drawing order; no separate occlusion relation) | confirmed | bowen 1791390897 (Q18) |
| Everything else in a layer | covers by | List order only (no separate occlusion analysis) | confirmed | bowen 1791390897 (Q18) |
| Canvas click inside fills | selects | The smallest loop containing the point; larger loops are picked from the list | confirmed | bowen 1791390533 (Q18) |
| Manual boundary picking for fill | is | Not needed | confirmed | bowen 1791390533 (Q18) |
| Self-crossing figure-eight | is | A drawing / deformation error; no special fill handling | confirmed | bowen 1791390533 (Q18) |
| Design principle | is | Do not block an action; show its consequences | confirmed | bowen 1791392425 (Q21) |
| Delete (user action) | removes | Lines only. | confirmed | bowen 1791392558 (Q22) |
| Point | is removed when | It is isolated (no line attached), or merged away by binding. A point exists only as a line end. | confirmed | bowen 1791428195 |
| Endpoint binding | merges | Two points into one. The first point is kept and the later-bound point is deleted; every line that ended there re-attaches to the kept point. | confirmed | bowen 1791391384 (Q20); v103 `commands.ts:102-110` |
| Endpoint binding | deletes | Every line whose two ends land on the same point after the bind | confirmed | bowen 1791391384, 1791392871 (Q22) |
| Endpoint binding | is | One complete edit. Loops still closed afterwards keep their fills; nearby shapes may change. | confirmed | bowen 1791391384; dot 1791391503 (Q20) |
| Adding a point (split) | keeps | The loop; its reference is updated to the two halves | confirmed | bowen 1791391384 (Q20) |
| Closed curve | has at least | Two lines (no loop is made of a single line) | confirmed (consequence of binding rule) | bowen 1791392871 (Q22) |
| Loop passing through one point twice | is | Valid; keeps its fill (special edit kept for tool consistency) | confirmed | bowen 1791391694 (Q20); dot 1791392923 (Q22) |
| Move to another layer | is | Copy, or copy then delete; not a separate operation | confirmed | bowen 1791392425 (Q21) |
| Drawing | has no | Cut, only copy and copy-then-delete | confirmed | bowen 1791392233 (Q21) |
| Cut-and-paste between recordings (keeps line ids) | is | To be sorted out later | open | bowen 1791392233 (Q21) |
| Point | is | A shared position. Each line keeps its own end there, with its own handle; handles belong to lines. | confirmed | bowen 1791383633; Q23 |
| End stroke (taper and so on) | belongs to | The point. Connected points have a continuous stroke, so tapers take effect only at free ends. Special effects at a junction use show/hide intervals. | confirmed | bowen 1791393850 (Q23) |
| Join | is an attribute of | The point: a table with one row per pair of its lines, each with a mode. **Smooth** is a spring; **cusp** gives a sharp stroke outline; **arc** generates arc geometry with a radius. No row means 仅绑定, drawn as a continuous round junction. | confirmed | bowen 1791393710 (Q23), 1791425164 (Q27); v103 `model.ts:68` |
| Fill boundary | follows | The closed curve's final geometric outline after joins and deformation (an arc join changes it). It does not follow stroke width, taper, blur or show/hide. Whether a loop exists depends only on connectivity. How fill joins at forks is open. | confirmed | bowen 1791425164, 1791425445; dot 1791425290, 1791425420 (Q27) |
| Merge position, deformation, mirror editing | belong to | The "editing" level, discussed later | confirmed (placement only) | bowen 1791424844, 1791425164 (Q26/Q27) |
| Show/hide intervals | belong to | The continuous curve, discussed later | confirmed (placement only) | bowen 1791425164 (Q27) |
| Smooth join | is | A stiff spring pulling two handles toward a straight line. Conflicts show the compromise and are never refused. Stiffness is one global fixed value. | confirmed | bowen 1791421304, 1791421988 (Q23) |
| 3 / 4 lines all mutually smooth | settle at | 120° / 90°. Acceptance cases: a large stiffness alone does not guarantee them. | confirmed | bowen 1791421988; dot 1791422049 (Q23) |
| Endpoint binding | sets | The width and profile of both groups to the first-clicked group's | confirmed | bowen 1791421988 (Q23) |
| Endpoint binding | drops | The deleted point's join records. New connections use the tool's preset join. | confirmed (new rule, not v103) | bowen 1791423036 (Q23) |
| Preset join | applies to | The two clicked lines only; other lines at the points get none | derived from v103 `connect(a,b)`; agreed by Claude and dot, not separately confirmed | Claude 1791423219, dot 1791423203 (Q24) |
| Merged group (after binding two groups) | takes | The first-clicked group's list position, with the other group's content after it. When a group splits, the new group goes next to the original. | confirmed | bowen 1791424619 (Q24 B) |
| Line stroke (width, profile) | belongs to | The continuous curve (the whole connected group). Within one layer, a connected group has one width. | confirmed | bowen 1791424619 (Q24 C) |
| Newly filled loop | is placed | At the top of its group by default | confirmed | bowen 1791424619 (Q24 D) |
| Endpoint link | connects | Two points in **different layers** (cross-layer only). Both points are kept; each stores the other's id. | confirmed | bowen 1791424124 (Q25) |
| Endpoint link | on creation | Moves the second-clicked point to the first | confirmed | bowen 1791424124 (Q25) |
| Endpoint link | keeps points coincident by | After each operation, averaging the target positions of the points the operation directly acted on; the others follow. One side edited: the other follows. Both edited: midpoint. | confirmed | bowen 1791424124, 1791424255, 1791424388; dot 1791424385 (Q25) |
| Endpoint link | ends when | Either point is deleted. Both copies are cleared, with no automatic re-linking. | confirmed | bowen 1791424124; dot 1791424173 (Q25) |
| Join across a link | is stored in | Both link copies, as one relation (not two springs) | confirmed | bowen 1791424493; Claude 1791424509; dot 1791424556 |
| Endpoint link | does not | Merge topology; cross-layer lines never form one closed loop | confirmed (consequence) | dot 1791424556 |

---

## Q1: Can this be a closed module that only exposes an interface? (layers)

**bowen** 1791381703 / 1791381805:
> 先来图层模块。（首先你的代码难道不是一个个模块相对独立只是暴露接口然后回传处理后的效果吗）
> 为什么不能写成一个模块相对封闭然后暴露接口的方式？这样写有什么弊端吗？还是说成熟方案各有各的历史包袱才不这样写？

### Facts (layer page `Codex/2026-10-06/task/architecture-4bc7cc2/layers-module.html`)

**No layers module exists.** A layer is a `container` record:

- With no parent, it is a layer.
- With a parent, it is a group.
- With the `shape` flag added, it is a shape group.

All three are the same record type (schema.ts:25-38). The related code is cut by layer (data / commands / evaluation / UI) and spread over 9 files. What is missing is a **dedicated layers-module interface**. A single write entry does exist: every change goes through the same plan, check and write path (commands.ts:179-211, editor.ts:145-180).

**Several places compute the same kind of thing separately.** Corrected after dot's source check (1791382204).

Sibling order is computed in 4 places, mostly for different purposes, so they are not all duplicates:

| Place | What it is for |
|---|---|
| evaluate.ts:148-168 | Paint order. Also handles the parent chain and fills |
| arrange.ts:26-30 | Order used by arrange and group |
| ui/layerTree.ts:27-31 | Panel display, which is the reverse of internal order |
| view/fabricView.ts:873 | Default layer to draw into |

**The one real difference found is the last row:** it compares only the index and does not break ties by id. If two layers have the same index, it may choose a different layer from the one the panel shows on top. This is a code risk and **has not been tested**.

Inherited locks and visibility are computed in 2 places with different purposes, and no rule conflict was found:

| Place | What it is for |
|---|---|
| model.ts:19-38 | Enforcement |
| ui/layerTree.ts:36-55 | Panel display |

**There is no current layer.** The layer a new line goes into is worked out from the current selection (fabricView.ts:868-878).

**Commit history:** 17 commits touched layer code: 8 new features, 6 bug fixes, 2 rule changes, 1 refactor.

- 2 of the bug fixes (d4cff1a, dfa6a05) concern the same-index tie.
- The fill and shape-group commits touched paint order, arrange and the panel several times.
- This shows **where** the repeated impact landed. **It does not show that fills were the root cause** (dot).

### Answer (dot 1791381882, Claude 1791382023)

**It can be done.** There is no evidence that it can't. tldraw and Fabric don't force the current layout.

**The current layout is our own choice.** All commands live together and all evaluation lives together. That helps a single transaction and shared validation. But we never settled the external interface or which module owns which rule.

**Encapsulating does not mean dropping the shared write path.** Operations that cross modules hand their changes to the same transaction entry point: one check, one commit, one undo. For example, deleting a layer affects the lines, fills, masks and references inside it.

"Mature tools carry historical baggage" does not explain any of this.

### Status

**Open.** bowen reviews the page and decides direction.

**One question is for bowen:** should shape groups belong to the layers module? A shape group is currently the same record type as a layer, which is why every change to fill rules drags layer code along.

---

## Q2: What is the smallest unit in this project?

**bowen** 1791382010:
> 图层应该不是最小单位 我们这个项目的最小单位是什么？bezier曲线吗？ 或者说图层里面的element吗？有几种element？

### Facts (4bc7cc2)

**Smallest geometry: the segment.** A segment is one cubic Bézier between two anchors. The code comment calls it "the smallest interpolation unit" (schema.ts:22-23).

- An anchor is a point plus an in-handle and an out-handle (schema.ts:21).
- A segment is not a separate record. It only exists inside a line.

**Five record kinds can be placed in a layer.** These are listed in `PLACED_KINDS` (indexes.ts:23):

1. container
2. curve (a line)
3. fill
4. reference
5. image

**Nine more record kinds are not placed in layers.** They are relations or data attached to elements:

- connection
- mask
- forms, family, preset, expressionParam, helperDomain, character, visibility

In total there are 14 record types (schema.ts:232-246).

**v103 was different:** one record was one segment (208 in the old face), and a stroke was a group of segments sharing a name. In the new version one record is a whole line.

### Answer (Claude 1791382050; dot 1791382119 corrected it, Claude agreed 1791382131)

From the user's point of view there are three levels:

1. **Layers and groups** organise objects.
2. **A path** is a whole line made of several Bézier segments. It is the main drawing object.
3. **Anchors, handles and segments** are the editable geometry inside a path.

**Correction to Claude's first answer:** "a record" is not "an element the user manages". Two examples:

- A closed path's own fill is a separate record, but selecting it selects the path, and the layers panel does not list it on its own row (selection.ts:21-48, layerTree.ts:58-61).
- The faces inside a shape group belong to the shape group in the same way.

### Status

**Fact answer given.** The layering above is open for bowen to confirm.

---

## Q3: Why is a reference image something you can place in a layer?

**bowen** 1791382158:
> 首先参考图为什么是图层里能放的元素？

### Facts

**Where the decision came from:** design doc 18 §31.3 step 1 (the checklist Claude wrote; v2 reviewed by dot): "新建一个图层「参考图」放在最下面". It is marked **[默认] (our own choice)**.

- The cited basis is Illustrator's "template layer": Template, Lock, Show and Print are layer options, and §31.1 cites Adobe's help page.
- Why it was done this way: reuse the existing layer locking, visibility and paint order, so a reference image locked like a layer does not get in the way of drawing (§31.3 steps 4, 15).

**v103 did not do it this way.** It kept one reference image outside the layers, as a single document field `reference?: ReferenceImage` (`7205381:src/domain/drawing/model.ts:70`).

**What it cost in code:**

- The image became the fifth placeable kind (indexes.ts:23). Every place that walks a container's children has to decide what to do with images.
- The reference-image commit 4a208bc touched **25** product source files. That number also includes the colour picker and the image panel.
- Before it, the refactor b7a2972 had to gather the kind lists scattered across about 10 places into one.
- Several places had to add an "exclude images" rule:
  - export excludes images by type (§31.3 step 13);
  - K fill and snapping ignore images;
  - the mask and hit-test rules were extended for images.

### Answer (Claude)

**It was our own choice, not something mature tools or the libraries required.** It is also the opposite of v103. The goal was to reuse layer locking and visibility. The cost is that every function that handles layer contents must now handle images too.

**Options for bowen** (listed only, not recommended or started):

- **A. Keep it as now:** the image is an element inside a layer.
- **B. Like v103:** the reference image lives outside the layer tree as its own document-level data, with its own visibility, lock, opacity and position slots, and layer code stays unaware of it. It takes no part in K fill, snapping or export.
  - **Correction (dot 1791382315):** "managed separately" does not mean "cannot be picked". Outside the layer tree it can still have its own drag, scale and selection entry. Both options are candidates only and are not recorded as bowen's decision.
- bowen's earlier requirements (wide adjustment range, slots, X/Y by field, slider and arrow keys; 1791365335) are unaffected either way.

### bowen's requirement (1791382313)

> 参考图应该放的位置，很显然 它具有slot 而slot是和视觉/快照绑定的。因此它所在的层级应该是快照（不知道你们叫它什么）

bowen 1791382362 added: "我说的你们要加一重判断。如果觉得我说的不对可以反驳"

### Independent judgement 1: Claude (1791382419)

**Agree:** a reference image is an aid for working with views, not artwork, so it should not be an ordinary layer element. The current code already treats it as an exception: export, K fill and snapping all exclude it.

**Addition 1: the slot-to-view link does not exist yet.**

- In the new version a slot stores only its number, name and image transform (schema.ts `ImageRecord.slots`). It does not record which view it belongs to.
- In v103 the recording-room reference had a set of states (slot, offset, scale, rotation, opacity), switched by hand with `activeStateId` (`7205381:src/domain/recording/reference.ts:6-48`). No binding to a snapshot or angle was found in the data. Whether the UI added one has not been checked.
- So "a slot belongs to a view" is bowen's way of working: a 9- or 21-view matrix image where each cell is one view. It is a relation to **add**, not one that exists today.

**Addition 2: separate where the image is stored from which snapshot uses it.**

- One image such as full_source (1.7 MB) holds many views.
- If every snapshot stored its own copy of the image, it would be duplicated many times.
- Storing it once at document level, outside layers, with each snapshot recording only "which image, which slot", avoids that. In short: **stored at document level, bound at snapshot level**.

**Precondition:** the new version has **no persisted view or snapshot domain object** yet. It does have view state that serves other purposes: the canvas viewport (zoom and pan) and the save-file `StoreSnapshot` (dot 1791382538). Neither can stand in for the snapshot bowen means.

- Head-turn is stored per line as yaw keys in `forms`. There is no record like v103's `RecordingSnapshot` (an angle plus its own layers; `7205381:src/domain/recordingSnapshot/model.ts:99-126`).
- So "the reference image lives at snapshot level" depends on first deciding whether, and how, the new version defines snapshots.
- Drawing at the default view without recording also needs a reference image.

### Independent judgement 2: dot (1791382433)

**dot accepts bowen's reasoning for how slots are used, with one distinction:** a slot being tied to a view or snapshot does not mean the whole image belongs to that snapshot alone.

Example: a 21-view matrix image. Several snapshots use the same image, each at a different position and scale. A sensible split:

- **The image resource:** one copy, shared.
- **Each view or snapshot:** manages which reference image it uses, plus its position, size and slot.
- **Ordinary artwork layers:** hold none of this reference state.

dot supports "reference state belongs to the view/snapshot context". dot does not support "each snapshot stores its own copy of the image and its resources". Binding, data ownership and UI placement must each be decided separately.

This agrees with Claude's addition 2. No disagreement recorded so far.

### bowen's decision (1791382641)

> 参考图暂时归视角 我们是在捋架构 不是要细化到怎么实现。然后参考图这也应该是个模块 里面应该有参考图集。这样就支持我不同的快照我引用图集里面的某张图当作参考。图集可以增添可删除。之后的捋到那里在说。我说这个架构上是不是把参考图归类为一个模块/工具了。

### Confirmed design (architecture level only, no implementation detail)

- **The reference image is its own module.** It holds a **reference collection**: images can be added to and removed from it.
- **Reference images belong to views for now.** Different views or snapshots each **reference** one image from the collection as their reference.
- **Ordinary artwork layers do not hold reference images.**
- **Still open:** fields, slots, the default view, and what a "snapshot" is. These are decided when the walkthrough reaches snapshots ("之后的捋到那里在说").

### Comparison with the current code (4bc7cc2)

- **There is no "reference image module" yet.** A reference image is one of the 5 kinds that can be placed in a layer (indexes.ts:23).
- **Its code is spread across several files, each handling one part:**
  - record type: schema.ts `ImageRecord`
  - commands: imageCommands.ts
  - data checks: imageData.ts, ui/imageInput.ts
  - decoding and drawing: view/images.ts
  - panel: ui/imagePanel.tsx
  - plus paint order and hit testing in evaluate.ts / derived.ts
- **There is no collection.** Each image is its own record, and its slots live inside that image record.
- **The decision above agrees with both independent judgements** (Claude and dot: store once, bind per view). No disagreement.

### Status

**Architecture direction confirmed (bowen 1791382641).** Implementation details wait until the walkthrough reaches snapshots.

---

## Q4: With reference images out of layers, how many kinds of element remain in a layer?

**bowen** 1791382709:
> 好现在图层里面存的element有几种了？

### Background (dot 1791382710)

**Module vs tool:** "module" means the responsibility boundary; "tool" means how the user operates it. They are not either-or. The reference-image module manages the collection. A view or snapshot references one of its images. The reference-image tool is the UI entry for operating the module.

### Facts (4bc7cc2; reference images already moved out of layers per Q3)

**Storage level: 4 kinds remain.**

| Kind | What it is | Notes |
|---|---|---|
| **container** | A group inside a layer | A shape group is also a container |
| **curve** | A path; the main drawing object | |
| **fill** | A filled area | Stored separately, but not a separate user element; see below |
| **reference** | An instance: another container's content drawn again through a transform, e.g. a mirrored reference | Only sounds like 参考图 in Chinese; unrelated |

More on fill:

- A closed path's own fill belongs to that path.
- The faces inside a shape group belong to the shape group.
- The code still has a `createFill` command (commands.ts:569) that creates a standalone fill. The UI's K and 建立填充 (create fill) do not use it; only the API and old data do.

More on reference:

- **The UI cannot create a reference today.** References exist only in the sample document (fixture.ts:79). Copy and paste carry existing ones along.

**User level: 3 things to manage.**

1. groups (including shape groups)
2. paths
3. references

Fills belong to a path or a shape group.

### Status

**Facts recorded.** Next item waits for bowen.

---

## Q5: Is a container / group the same as v103's continuous and closed curves?

**bowen** 1791382807:
> 容器/组 是不是老版的连续曲线和封闭曲线？也就是曲线组成的结构？

### Facts

**v103** (`7205381:src/domain/drawing/model.ts`):

- **One record is one segment:** two nodes and two handles (line 62, `DrawingCurve`).
- **A continuous curve is not a record.** It is derived from segments that share nodes. A curve whose ends join is a closed curve. `strokeName` is only a label copied onto each segment; the comment says "geometry membership remains derived".
- **A group** (line 66, `DrawingGroup`) is a list of segment ids (`curveIds`).
- **A layer** (line 64) is a list of items (`items`).
- **Group and layer flags are retired** (line 69 comment): only the members' own visibility and lock count.

**New version** (4bc7cc2):

- **A path is one record** holding its segments in order and whether it is closed (schema.ts `CurveRecord`). It is stored explicitly, not derived.
- **A container** is a layer or group. It holds things and manages order, lock and visibility. It has nothing to do with how segments join into a line.
- **Visibility and lock live only on containers.** Paths have none of their own, which is the reverse of v103.
- **Shape groups are new;** v103 has nothing equivalent.

### Answer (Claude 1791382835)

**No.**

- v103's continuous and closed curves correspond to the new **path**.
- v103's group and layer correspond to the new **container**.

### Status

**Facts recorded.**

### Q5 follow-up: what is a group in the new version, and does it overlap with layers?

**bowen** 1791382929:
> 那你给我解释一下你们新版的组是个什么玩意？它如果是个清单 那是不是和图层的功能重叠了？

#### Facts (4bc7cc2)

A group and a layer are **the same record** (a container). Without a parent it is a layer; with one it is a group. Both carry exactly the same fields: name, order, visibility, lock and opacity.

The only differences in the code:

1. **Selection unit.** Clicking with V selects the outermost group below the layer (selection.ts:30-41; Illustrator Selection tool).
2. **New lines go into a layer,** never into a group (fabricView.ts:868-878).
3. **A layer cannot be grouped or ungrouped** (arrange.ts:116, 131).
4. **They are created differently:** "＋图层" makes a layer; ⌘G makes a group, placed at the position of the front-most member.

#### Judgements

**Claude (1791382971):** for organising things, groups and layers overlap. The only thing a group adds is being selected and moved as one unit.

**dot (1791383017):**
- A group is "a level of organisation inside a layer". It does not mean its lines are continuous or closed, or that they can be filled.
- If layers can already nest and support whole-unit operations, "group" can just be the name for a nested layer. It does not need its own feature set or its own module.
- Whether to keep both names depends on how bowen needs to organise things. Our existing record types should not decide it in reverse.

#### Status

**Open.** Not added to the graph (bowen 1791382929).

---

## Q6: Where did the group concept come from: a mature tool, or something we made up?

**bowen** 1791383041:
> 那这个组的概念明显不是很优雅 这玩意是哪来的？是哪个成熟方案写的还是你们瞎写的？

### Facts

**1. The group feature already existed in v103:**

- ⌘G groups two or more lines on the same layer and auto-names the result 组合 N; ⇧⌘G ungroups.
- Clicking with V selects the whole group.
- Sources: `7205381:src/domain/drawing/model.ts:66` `DrawingGroup`; UI in DrawingRoom.tsx:154 and 363.

**2. "Group and layer are the same record and can nest without limit" is our own design decision.** It comes from design doc 11 v0.2 (Claude as main author, commit e3514f7, 2026-10-06):

> 〔决定〕全软件只有一种容器机制……图层是顶层的容器，编组是图层里的容器，在 V 模式下点一下会整组选中

- The reason given at the time: v103's templates, characters and drawings each used a different layer mechanism, and we wanted to unify them.
- **That entry cites no mature tool as its basis.**
- **The comparison below is unverified** (from memory, not opened this time):
  - Illustrator treats "layers / sublayers" and "groups" as two different things.
  - Figma and SVG use one node tree, where a group is just one kind of node.
  - Our choice is closer to Figma and SVG, but the document never made this comparison.

### Answer (Claude 1791383088)

**What a group is for** comes from bowen's v103 and from Illustrator.

**The structure "group = nested layer, same record"** is our design decision. It had no stated basis, and it was never confirmed with bowen.

### Judgement 2: dot (1791383140)

**Ordinary grouping is a mature feature, and dot opened the source.** Adobe Illustrator's help says a group moves and transforms several objects as one while each keeps its own attributes, and the group appears in the Layers panel. Source: <https://helpx.adobe.com/illustrator/desktop/manage-objects/select-objects/group-ungroup-objects.html>

**Two separate things:**

- **The grouping feature** has a mature precedent.
- **Putting layers, ordinary groups and shape groups into one container record** is our own structural design, and the code is ours too.

**Sharing one container is not inelegant in itself;** it can reduce duplication. What needs reviewing is whether three jobs are tied together:

1. ordinary organisation
2. whole-unit selection
3. fill areas

If they are tied, changing fills forces changes to ordinary group rules.

**Neither shortcut proves anything:**

- A mature precedent for groups does not prove our implementation is reasonable.
- Overlapping features do not prove the group concept is unnecessary.

### Status

**Open.** Waiting for bowen.

---

## Q7: Attacking bowen's knowledge-graph structure, v1 (Claude's independent review)

**bowen** 1791383214, 1791383633, 1791383724:
- 1791383214: 我给你们一套知识图谱结构，然后你们来尝试攻击它 看这种关系会有哪里出问题。如果没问题也可以提出和成熟方案不一致然后分析为什么会不一致。
- 1791383633: 最基础的element是bezier曲线。单条曲线具有四个参数 分别是两个端点和两个handle。 端点具有笔触属性，线条具有线条笔触属性。接下来是连续曲线： 连续曲线是相邻两条单独曲线共用端点构成（相邻两条 意思是可以有很多相邻两条构成很多连续曲线） 共享端点因此具有了接笔属性（定义两端handle的角度限制） 连续曲线出现循环时，就是闭合曲线。闭合曲线增添了填充属性。因此填充属于闭合曲线。闭合曲线是连续曲线的子集。一组连续曲线可能有很多组闭合曲线。 单条曲线+连续曲线构成了图层的基本element （我的语义描述不准确时你们合理补救…帮我完善之后再攻击）
- 1791383724: 这一版发完 你们可以开始了；1791383776: 我先说到这一层 你们可以开始整理审查了

**Review rules (dot 1791383276):** findings are sorted into four kinds.

| Kind | What it means |
|---|---|
| Real contradiction | A concrete action makes two relations impossible to hold at once |
| Gap | Something bowen needs cannot be expressed |
| Cost | The relation holds, but brings sync, performance or maintenance cost |
| Difference from mature tools | Verified source and the reason for the difference; being different is not an error |

Each challenge names the relation and gives a counter-example. Suggestions go in a separate section. **The graph itself is not changed.**

### 1. Restatement (filling in the wording, to be confirmed by bowen)

**S1 Single curve (segment).**
- A cubic Bézier with 4 parameters: 2 endpoints, plus 2 handles that each belong to one endpoint.
- **Line stroke** belongs to the segment: width, colour.
- **End stroke** belongs to the endpoint: taper and extension where the line ends at that point.

**S2 Shared endpoint (node).**
- Several segments can share one endpoint, which turns it into a **node**.
- A node has a **join attribute** that constrains the angles of the handles on each side: smooth, corner, arc.

**S3 Continuous curve.**
- Segments joined by shared nodes form a connected structure.
- It is allowed to **branch**: a node can have 3 or more segments, so in effect it is a **network**.

**S4 Closed curve.**
- A loop inside the continuous curve, carrying a **fill attribute**. The fill belongs to the closed curve.
- One continuous curve can contain several closed curves. Keep this; do not change it to "a single simple path" (dot 1791383731).

**S5 Layer elements.** A layer's basic elements are single curves and continuous curves.

### 2. Attacks

**A1 [Real contradiction] "Fill belongs to the closed curve" × "one network has several closed curves".**

Counter-example: a θ shape, i.e. a circle with a horizontal line through it whose ends sit on the circle.

- It has 3 loops: upper half, lower half, and the whole outer ring.
- It has only 2 enclosed regions.

If fill belongs to loops, then "outer ring filled red" plus "upper half filled blue" means the upper region carries two fills from two closed curves. Which shows?

The structure has no rule for this. Moving the middle line also changes all 3 loops at once.

**A2 [Gap] The join attribute assumes two curves.**

"The join defines the angle limits of the handles on both sides" only works where 2 segments meet. At a T or Y junction (3 or more segments), which two are smooth and which is a corner cannot be expressed.

- v103 recorded joins **pairwise** (`TangentJoin {a, b, mode}`, `7205381:src/domain/drawing/model.ts:68`).
- Doc 11 proposed "through-pairing" for the same reason.

**A3 [Gap] End stroke at a shared endpoint.**

End stroke (taper) naturally belongs at a free end. When an endpoint is shared, which applies there, the end stroke or the join attribute?

- v103 had "interior end enable" (from the v103 inventory: InkEndControls), meaning bowen sometimes wants a taper at an interior node.
- The structure needs a rule for which takes priority.

**A4 [Gap] Stroke along a whole line.**

Line stroke lives on each segment. A long stroke that **narrows gradually along its whole length**, or a show/hide interval running along a line, needs a **direction and a route** across many segments.

- In the old face, 28 strokes (116 segments) use tapers, and 17 show/hide intervals run along routes.
- Once a continuous curve can branch (S3), "along the line" is undefined: which branch does it go down?
- v103 used `DisplayRoute {seed, throughLinkIds}` to choose the route explicitly. Doc 11 had a "path P" for this.

**A5 [Gap] Continuous curves across layers.**

"Single curves and continuous curves are layer elements" implies a continuous curve sits in one layer. But in the old face the chin join crosses layers.

bowen has already said (memory "binding vs linkage"): **across layers, each line stays in its own layer; the ends are only linked.**

The structure has no relation for "linked across layers but not a shared endpoint". Nor does it say which layer a closed curve that crosses layers, and its fill, belongs to.

**A6 [Cost] Fill identity on derived loops and regions.**

Loops are worked out from shared endpoints. Splitting, merging or deleting a segment changes which loops exist.

- After a loop splits in two, or two loops merge into one, which part keeps the old fill?
- This is the same class of problem as the earlier rounds of fill fixes: bridges, shape groups, keeping an area after clearing its fill.
- The structure is still workable, but these rules have to be designed explicitly.

**A7 [Cost] Head-turn and keyframes.**

Topology decided by shared endpoints stays the same across poses. That is good for interpolation.

But if fill uses **enclosed regions found from geometry**, the regions can change between poses when lines cross or curves self-intersect. So fill should be tied to topology (which segments surround it), not recomputed from geometry at each pose.

### 3. Differences from mature tools (only sources I opened)

**D1 Figma Vector Networks** (opened and checked; <https://www.figma.com/blog/introducing-vector-networks/>). This is the closest to bowen's structure:

- Lines and curves can connect between any two points, without having to form a single chain.
- Stroke cap and join styles work even at points with 3 or more lines.
- Fills automatically fill every enclosed space. The paint bucket toggles any enclosed **region** on or off.
- **Difference:** Figma attaches fill to **enclosed regions**; bowen's structure attaches it to **closed curves**. Figma's choice avoids the overlapping loops of A1.

**D2 The path model** (Illustrator / SVG / Paper.js / the current new proto).

- Figma's article describes a path as "a chain of lines and curves from one endpoint to the other" and notes that three lines cannot meet at one point.
- The current proto's `CurveRecord` is exactly this kind of ordered chain (schema.ts:40-49).
- **So at the most basic level, the current proto differs from bowen's structure**: it stores chains, and cannot branch.
- Illustrator's own docs on this were not opened this time.

**D3 v103 (bowen's own).** Segment records + shared nodes + pairwise joins + routes along lines (DisplayRoute). This is closest to bowen's structure. The difference: v103 handled A4 with an explicit route.

### 4. Not found to be a problem (in the cases above)

- A segment has 4 parameters, and each handle belongs to its endpoint.
- A closed curve is part of a continuous curve (a loop inside it).
- One network can hold several loops (the question is only where fill attaches; see A1).

### 5. Suggestions (separate from the attacks; nothing changed in bowen's graph)

- **For A1:** fill belongs to an **enclosed region (face)** of the network; a region is surrounded by a set of segments. This is how Figma works. It also matches bowen's earlier "fill is an attribute": the region is an attribute of the network, not a separate object.
- **For A2:** the join attribute is stored **per pair of segments** at a node.
- **For A4:** add a **stroke route** concept: a directed run along segments, which can pass through nodes and cross-layer links. Line stroke tapers and show/hide intervals hang on the route.
- **For A5:** add a **cross-layer link** relation, distinct from a shared endpoint (bowen's binding / linkage decision).
- **For A3:** a rule for which wins between end stroke and join at a node. Suggestion: the join applies by default; an end stroke is used only when explicitly turned on.

### dot's independent review (1791384045, summarised)

**Conclusion:** the structure can be modelled as a **network of curves with shared endpoints**. dot found no hard contradiction that forces it to be overturned. What needs work is the meaning of some relations; there is no reason to switch back to our current path records.

dot raised four points:

1. **A loop existing is not the same as the user creating a fill.** Which loops actually carry a fill must be stated explicitly; a fill should not appear automatically for every loop found.
   - dot **disagrees** with Claude's A1 being a "real contradiction". Outer ring red and upper half blue can resolve cleanly through paint order. What is missing is fill identity and an overlap rule; the structure is not logically impossible.
2. **Joins at a branching node must say which pair of segments or handles they constrain.** Sharing a position does not mean every handle there constrains the others. Likewise, sharing an endpoint does not mean sharing its taper or width.
3. **When the continuous structure is split, what happens to "this element"?** If the middle segment linking two parts is deleted, do they automatically become two continuous objects, or keep one identity? Either can be designed, but select, move, copy and undo behave differently. **Claude's review did not cover this.**
4. **After topology changes, which loop does the fill follow?**
   - Adding a point to a triangle edge should keep the fill.
   - Cutting a link and rejoining it: does the old fill come back?
   - Re-finding the current loops each time is not enough to remember which area the user filled.
   - This is the same as Claude's A6.

**Mature tools (as cited by dot):**
- Figma VectorNetwork API: <https://developers.figma.com/docs/plugins/api/VectorNetwork/>
- SVG painting order: <https://www.w3.org/TR/SVG2/render.html>

### Claude checked dot's Figma source (opened and read)

- **A vector network has three parts:** vertices, segments, and **regions**. A region lists one or more loops, each a sequence of segments, plus its own fills.
- **With no regions,** all enclosed space is filled automatically. Once regions exist, they are stated explicitly.
- A region can hold several loops, for example the inner and outer outline of the letter "o".
- **Stroke cap, join style and handle mirroring are stored per vertex,** not per pair of segments.

### Merged result (Claude accepts dot's corrections)

- **A1 is reclassified from "real contradiction" to "gap: fill identity and overlap rule".**
  - Claude's earlier claim that "there is no rule for which colour shows" was overstated. Overlapping fills are legal in SVG and resolve by paint order.
  - Claude also withdraws its suggestion that "fill belongs to the minimal region". Figma states regions explicitly, each region references one or more loops, and the user decides which of them are filled. That matches bowen's "fill belongs to a closed curve" more closely than minimal regions do.
- **dot's point 3 (identity after a split) is added as a gap.** Claude had missed it.
- **A2 and A3** match dot's point 2: the scope of an attribute (which pair, whose taper) needs to be spelled out. Figma stores joins per vertex. Whether a T-shaped node needs a per-pair rule is left for bowen.
- **A6 and dot's point 4 are the same thing:** after a topology change, which loop the fill follows.
- **A4 (stroke route) and A5 (across layers)** are **deferred to the layers they belong to and not counted as defects**, because bowen has not reached those layers yet (dot).

**No hard contradiction found.** Two things to settle with bowen first:

1. Which loops become real fill objects, and how overlapping fills are ordered.
2. Whether a continuous structure automatically splits and merges with its connectivity, and therefore how its identity changes.

### Status

**Both independent reviews are merged.** Waiting for bowen on the two items above. Nothing in bowen's graph has been changed.

### Q7 follow-up A: How does Figma define a fill? Can it fill a θ shape as a whole?

**bowen** 1791384107:
> figma填充挂在区域上没懂 相当于它不支持 theta形状的整体填充是吗？ 那么它怎么定义填充的？然后一个端点连接2条以上线条的等一会儿再讨论 先把填充解决了。

#### Facts

Source: Figma VectorNetwork API, opened and read: <https://developers.figma.com/docs/plugins/api/VectorNetwork/>

- **What a region is:** a winding rule, **one or more loops**, and its own fills. A loop is a sequence of segments running round once.
- **Regions are listed explicitly.** Any loop can be chosen; it does not have to be the smallest area.
- **The letter "o"** is one region with two loops, the outer and the inner.
- **Only when no region is declared** does Figma fill all enclosed space automatically.

#### Answer (Claude 1791384140)

**Figma supports filling a θ as a whole.** Calling it "attached to a region" earlier was misleading; Claude corrects that.

| What you want | How Figma declares it |
|---|---|
| Fill the whole θ | One region whose loop is the two arcs of the outer circle. The middle line is only a stroke. |
| Fill only the upper half | One region whose loop is the upper arc plus the middle line. |
| Upper and lower halves in different colours | Two regions, each with its own loop. |

So **fill = which closed curve(s) you choose + colour**. That is very close to bowen's "a fill belongs to a closed curve".

**Not yet verified:**
- When regions overlap, which one is drawn on top. The docs do not say; it may follow the order regions are listed.
- Which loop the paint bucket creates in Figma's UI.

#### Status

**Fills come first;** nodes joining 3 or more lines are set aside for later (bowen 1791384107).

### Q7 follow-up B: In Figma, do I pick a closed region by hand and then fill it? Is there a smarter way?

**bowen** 1791384247:
> 那么figma的交互是我需要手动选择一个闭合区间 然后去填充吗？（这应该是最没有歧义的方案吧？只不过有没有更聪明的交互方式。

#### Facts

Source: Figma Help "Edit vector layers", section "Add fills to closed regions", opened and read: <https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers>

1. In vector edit mode, choose the **Paint tool** (Shift B) and pick a colour.
2. **Hover over a region.** Diagonal stripes mark the region that will be painted, and the cursor shows what a click will do:

   | Cursor | When | Click result |
   |---|---|---|
   | Droplet with + | The region has a different colour or no fill | Change or add the fill |
   | Droplet with − | The region already has this colour | Remove the fill |

3. **Click** to change one region. **Press and drag** across several regions to change them all at once.

**Not verified:** after dragging across both halves of a θ, is it stored as "one region with the outer ring" or "two regions"? The help page does not say.

**Correction (dot 1791384395, 1791384478):** filling both halves in the same colour can look like one whole fill, but **whether it is one fill object is unverified**.

- We have not confirmed how Figma stores the result after a drag across two regions, or how gradient coordinates work there. If the two regions share one gradient coordinate system, the result may still look continuous.
- So "drag across both halves" **cannot be treated as** "fill the whole θ".
- The thing to separate is **the identity and editing behaviour of a whole fill**. It cannot be inferred from appearance.
- What Figma's interaction is worth borrowing: regions found automatically, with a hover preview before you click.
- bowen's need, "one whole fill defined by the outer ring", stays a separate requirement to judge. It must not be quietly replaced by painting twice.

#### Answer (Claude 1791384311)

**You do not pick a loop by hand.**

- **Data:** "fill = which closed curve(s)" is the least ambiguous.
- **Interaction:** the user never touches loops. They hover to see the highlight, then click or drag.
- These two can sit together.

**Our current K, compared:**
- It can only click and fill the smallest area.
- It has no hover preview, no drag across several areas, and no toggle-off.
- The cursor does not change.

These are batch 2 (interaction feel) items.

#### Status

**Waiting for bowen to decide how fill is defined.** Settle the data definition first; the interaction comes after.

### Q7 follow-up C: Does Figma only fill minimal regions? If the middle line is hidden, how demanding is the seam?

**bowen** 1791384504:
> 我觉得它们的逻辑应该是只把"最小闭合区域"当作可填充的，也就是theta对于figma就不存在整体填充 而是分成两块填充。然后填充区域是在线的中间点。因此如果隐藏中间线条 那就严格严密填充了（如果填的是同一个颜色） 这样的实现会对接缝处的计算有很高要求吗？

#### Facts and judgement (Claude 1791384585)

**1. Does Figma only treat minimal regions as fillable?**

- **In the UI, probably yes.** The help page says the Paint tool hovers over and clicks "closed regions", which reads as region by region. It is **not verified** that the UI only ever produces minimal regions.
- **In the data, no.** The API lets a region use any loops.

**2. Fill boundary along the middle of the line: correct.**

- SVG and the current proto both compute the fill along the line's centre line. The stroke straddles the centre line, half inside and half outside.
- So while the middle line is visible, its stroke covers the seam.

**3. Hidden middle line, both regions in the same colour.**

- **Geometric precision is not the problem.** Both regions share the same segment, so their boundary numbers are identical.
- **Anti-aliasing is the problem.** Each region covers about half of each boundary pixel, and stacking the two gives about 75% instead of 100%. That leaves a faint light line, known as a **conflation artifact**.
  - Source (opened): linebender/vello issue #49 <https://github.com/linebender/vello/issues/49>, quoting NVIDIA's "GPU-accelerated Path Rendering" §4.1.2: "Conflation is particularly noticeable when two opaque paths exactly seam at a shared boundary".
  - The same issue notes that the HTML5 Canvas model appears to require each anti-aliased element to be composited separately. Our Fabric and Canvas2D renderers work that way.
  - The proto already records a seam of the same kind: `view/ownInk.ts:8-9` notes that cutting a fill's own stroke leaves a faint see-through seam along the inner anti-aliased edge (alpha ≥ 0.75). That is between a fill and its own stroke, not between two adjacent fills, but the cause is the same.
- **Common fixes:**
  1. Keep the middle line visible so its stroke covers the seam.
  2. Merge adjacent same-colour regions into one shape when drawing.
  3. Expand each region slightly so they overlap.
  4. Use a renderer that does not produce conflation artifacts (high cost).
- **How this relates to bowen's need:** if "one whole fill defined by the outer ring" is supported, a θ is a single region and there is no seam at all. This is a technical reason in favour of supporting whole fills.

#### dot's judgement (1791384685)

**It does not need especially high geometric precision.** But a shared boundary alone does not guarantee a seamless picture on screen; what matters is how anti-aliasing is composited.

- Two 50% coverages composited with the ordinary formula give 75%. Adding decimal places does not fix that. Formula source: <https://www.w3.org/TR/compositing-1/>
- **For adjacent regions with the same colour and opacity,** both regions can keep their identity for editing, while drawing treats their coverage together. The object structure does not have to change to remove the seam.
  - **This is only a candidate (dot 1791384756).** It must also stay compatible with paint order, masks and effects; same-colour fills cannot be merged indiscriminately.
  - This is a feasibility analysis. No implementation has been chosen.
- **Expanding each region slightly has side effects.** It breaks with transparency, different colours or blur, so it cannot be a general fix. Claude's fix 3 above should carry this caveat.
- **Hiding the middle line's ink is not the same as deleting the middle segment's geometry:**
  - Hiding the ink keeps the shared boundary.
  - Deleting the geometry can change the region structure.
  - These two operations must not be mixed up.

#### Status

**Waiting for bowen to decide how fill is defined** (minimal regions only, or whole fills defined by a chosen outer loop as well).

### Q7 follow-up D: Different colours on each side with the middle line hidden: how do mature tools handle it? Is it supported at all?

**bowen** 1791384758:
> 那就算是异色隐藏中线 也可能出现极细的缝隙。那么成熟方案对异色中间隐藏线条是怎么处理的？还是说成熟方案根本不支持两边异色填充隐藏中间线？

#### Facts (Claude 1791384824)

**Different colours also leave a seam.** Each side covers about half of each boundary pixel, so after compositing, some background still shows through.

**Mature tools do support it.** The classic case is **Flash (now Adobe Animate)**: colour blocks meeting directly, with no stroke between them.

Source, opened: Ruffle (a reimplementation of the Flash player) issue #26, "Seams between fills in canvas renderer": <https://github.com/ruffle-rs/ruffle/issues/26>

- The comparison image there shows **no seams in Flash's own player**, and seams on shared edges in Ruffle's Canvas backend.
- The issue text says Flash "almost always generates non-overlapping paths". The "standard advice" in Canvas/SVG is to overlap paths, for example drawing the outline on top of the fill. Another option is to turn off anti-aliasing (`shape-rendering: crispEdges`).

**Unverified (the SWF specification was not opened this time):** that Flash's data records which fill lies on the left and right of each edge, and that its renderer draws shared edges together.

#### How mature tools handle it

1. **Flash's approach:** the renderer knows two regions share an edge and draws them together. The data recording side fills for each edge is still unverified.
2. **Overlap the shapes.** Draw the stroke over the fill, or tuck one region slightly under the other. This is the Canvas/SVG "standard advice". Per dot 1791384685, it has side effects with transparency, blur and similar cases.
3. **Turn off anti-aliasing on that edge.** The seam goes away but the edge becomes jagged.
4. **Use a renderer that avoids conflation artifacts** (vello and similar). High cost.

#### Relation to this project

- The current proto draws with Canvas2D and Fabric, which are the kind that show seams.
- To get Flash-style seamless joins between different colours with the middle line hidden, the drawing layer has to handle shared edges specially. The data structure cannot fix it automatically.
- **Which region lies on each side of an edge** is worth storing. This matches bowen's idea of a "shared boundary".

#### dot's judgement (1791384943)

**Different colours on each side with no stroke between them is allowed by mature formats.** The Adobe SWF specification explicitly allows an edge to use a different fill on each side with the stroke set to none.

- Source: <https://open-flash.github.io/mirrors/swf-spec-19.pdf>, p. 128 of the body (opened by dot).
- This **verifies** the item Claude had marked unverified: "Flash records the fill on each side of an edge".

**One way to draw it without seams:** decide colour at the same set of subsample positions first, then composite pixels.

- A pixel half in the red region and half in the blue region should come out as red mixed with blue, without extra background showing through.
- This differs from "make each region a semi-transparent edge, then stack them twice".
- Multisampling and supersampling are established techniques. They cost more computation and storage, but need no extra geometry points.
- Further reading: <https://github.com/linebender/vello/issues/49>

**So different colours cannot be fixed by "merging into one single-colour region".** They can be handled correctly at the shared boundary in the drawing layer.

**Two limits on the conclusions:**

- Not every mature renderer guarantees no seams.
- **Flash's algorithm cannot be worked out from how its output looks.** Claude's earlier "Flash draws the two regions together" was an inference and is withdrawn as a statement of fact.

**Confirmed:** the requirement is valid.
**Still to verify:** which rendering implementation to use.

#### Status

**Facts and both judgements recorded.** Fill definition is still waiting for bowen.

### Q7 follow-up E: Is overlapping the regions what print calls "bleed"? Who overlaps whom, and should we overlap before hiding the line?

**bowen** 1791384973:
> 我觉得可以互相压的方案，出版学上叫"出血"？ 因为缝的问题远远大于交界处偏移几个像素的问题。这样同色的也解决了 至于谁压谁，在隐藏线条之前要不要出血 这个成熟方案怎么定的？

#### Facts (Claude 1791385033)

**Terms:**

- **Bleed (出血)** extends the artwork beyond the trim line.
- **Two adjacent colours overlapping slightly** is called a **trap (陷印 / 补漏白)** in print.

**Adobe Illustrator Help, "Trapping"** (opened): <https://helpx.adobe.com/illustrator/using/trapping.html>

- A trap is "a small area of overlap between colors" that compensates for gaps.
- **Default: the lighter colour is pushed into the darker one.** Illustrator "identifies the lighter-colored artwork (object or background) and overprints (trapping) it into the darker artwork".
- **Two kinds:**
  - *Spread*: a lighter object overlaps a darker background.
  - *Choke*: a lighter background overlaps a darker object.
- **Reverse Traps** pushes darker colours into lighter ones.
- **The width is set by the print shop.**
- **Tint Reduction exists for two light colours,** because their overlap mixes into a third colour. The page's example: light yellow into light blue gives a green border.

**Not sourced (Claude's inference):** why lighter goes into darker. The darker colour defines the edge the eye sees, so pushing the lighter colour into it is nearly invisible.

#### How this differs for this project (Claude's suggestion, not mature-tool text)

1. **The width is much smaller.**
   - Print traps cover plate misregistration of a fraction of a millimetre.
   - Here we only need to cover one row of anti-aliased pixels: **a fraction of a screen pixel to 1 screen pixel**.
   - So the cost is not "an offset of a few pixels"; it is below one pixel.
2. **When to overlap.**
   - In Illustrator, a trap is an extra treatment added on top (an effect or a separate stroke). It does not change the original shape.
   - Following that idea: overlap only when the shared edge's line is hidden or not drawn. When the line is drawn, its stroke already covers the seam.
   - Stored geometry stays unchanged; this is done only when drawing.
3. **Caveat (dot 1791384685).**
   - Overlapping semi-transparent or blurred fills produces a darker band.
   - Traps suit opaque colour blocks. Semi-transparent cases need another approach, such as compositing on shared subsample positions (dot 1791384943).

#### dot's judgement (1791385180); Claude accepts the corrections

**dot accepts bowen's trade-off:** for opaque colour blocks, a tiny overlap is better than a gap showing through.

But print rules are ink-registration rules, not rules screen drawing must copy. dot's three candidate rules for a screen editor:

1. **Who overlaps whom.** Use the existing paint order: the lower block extends underneath the upper one, and the upper block keeps the boundary. Do not quietly change paint order by lightness.
2. **When to overlap.** Not only when the middle line is hidden. A very thin or semi-transparent stroke may not cover the seam either. Skip the overlap only when the stroke truly covers it.
3. **How wide.** **There is currently no evidence that "less than one screen pixel is always enough".** It must be measured across zoom levels, output resolutions and anti-aliasing.

**Claude's corrections:**

- **"A fraction of a pixel to 1 pixel is enough; the eye cannot see any shape change" was overstated.** It is unproven and needs measurement.
- **"Overlap only when the line is hidden" was too narrow.** Use "overlap whenever the stroke does not reliably cover the seam".
- **"Lighter into darker" stays a print rule.** For the screen, use dot's "follow paint order".

These are candidate drawing rules. They do not change the shared curves and they do not change fill ownership.

#### Status

**Facts recorded.** Fill definition is still waiting for bowen.

---

## Q8: Attacking "only the smallest enclosed regions can be filled" (Claude's independent review)

**bowen** 1791385308:
> 不透明在我们纯电脑显示里不会出现黄蓝变绿的情况。这里的所谓trap到底要选择哪种方案可以待定，目前设置为null（现阶段有缝就有缝吧） 但是这样就解决了我们之前的架构问题， 只填充最小合围区域。那么如果之前一个大圆中间加了一条线，这个填充就变成两个。这样的设定你们再尝试攻击一下（这样和figma也非常相似了吧？）

### bowen's decisions

- **trap = null for now:** seams are accepted at this stage.
- **Only the smallest enclosed regions (faces) can be filled.**
- **When a line is added across a large filled circle, the one fill becomes two.**

### Restatement (to be confirmed by bowen)

- **Fill target:** a fill can only sit on a face of the network.
- **What a face is:** an area enclosed by segments that share endpoints and that no other segment cuts through.
- **Lines that cross without sharing an endpoint do not split a face.** This matches the current K, see fills.ts:3-6.

### Attacks

**B1 [Gap] What happens to the fill when a face splits or merges.**

- **Split:** adding a line through a red circle makes two faces. Are both automatically red? bowen implied yes, "the fill becomes two".
- **Merge:** deleting the line between a red face and a blue face makes one face. What colour is it?
  - Options: the larger one, the one drawn first, the one that was selected, or no fill.
  - **No rule yet.**
- **Undo** must restore exactly the colours from before the split or merge. The structure itself has no way to remember "which pieces used to be one fill".

**B2 [Gap / future conflict] Gradients and blurred fills.**

bowen wants gradient and Gaussian-blur fills in the stress test (1791378981).

- With faces only, a gradient across the whole face is cut into two as soon as any line inside joins both sides of the outline at endpoints.
- The two halves get separate gradients, so there is a visible break where they meet.
- Whole-face soft edges (blur) are split the same way.
- **Solid colours are unaffected.** Future gradients or blur would need either "several faces share one gradient coordinate frame" or a separate whole-fill concept.

**B3 [Gap] Islands inside a face (holes).**

- Example: an eye outline sits inside the face outline but is not joined to it. Geometrically, the face region has a hole.
- With faces only, it is undecided whether the face fill **includes** the eye area (and is covered by the eye's own fill) or **excludes** it (has a hole).
  - With opaque fills the result looks the same.
  - With semi-transparent fills, or if the eye fill is removed, the result differs.
- **The current code makes no faces with holes** (fills.ts:6: "Faces with holes are not made"). In effect it chose "includes".

**B4 [Gap] Faces enclosed by lines from several layers.**

- Example: the chin in the old face is joined across layers.
- A face enclosed by lines from different layers: which layer does it belong to, and what is its paint order?
- This was deferred to the cross-layer level earlier (Q7 merged result). It stays deferred, but this rule depends on it.

**B5 [Cost] Faces change as topology changes.**

- Join, cut, delete or add a segment, and faces must be recomputed and existing fills mapped onto the new faces.
- This is the same class of problem as the earlier rounds of fill fixes (bridges, colourless areas).
- **But compared with "fill on any loop", faces never overlap.** That removes the overlap-order problem from A1.
- **Overall complexity goes down.**

**B6 [Cost] Lines crossing without a shared point.**

- Two lines that just cross do not split a face (B-restatement).
- The user may see an area that looks enclosed and is not fillable. An anchor must be added at the crossing first.
- This is the current behaviour. Its feedback needs to be clear (batch 2).

### Not found to be a problem (in these cases)

- **No ambiguity from overlapping fills:** faces never overlap.
- **Head-turn:** topology stays the same across poses, so faces stay the same. Each pose only redraws a face's boundary with that pose's geometry.
- **Lines that end inside a face** (one end free), such as a hair strand touching the outline at one end, do not split the face.

### Comparison with Figma

**Interaction: very similar.** Figma's Paint tool works on closed regions: highlight on hover, click or drag to fill (Q7 follow-up B, help page opened).

**Data: different.**
- Figma's region can use any loops, including the outer ring, and holes are expressed with several loops (API opened, Q7 follow-up A).
- bowen's rule is a **stricter subset**: only the smallest region.

**Still unverified:** what Figma does to existing fills when a line is added across a filled region, and when a separating line is deleted.

### dot's independent review (1791385538, summarised)

**The change is self-consistent.** It removes the θ ambiguity of the outer ring counting as an extra fill. No hard contradiction found.

**Three items need meaning settled:**

1. **Is a region split by geometric intersection, or only by shared endpoints?**
   - Example: a line across a circle, with no node added by hand where it crosses. Does it split the circle in two?
   - Both models are possible and give different results.
   - "Adding a line cuts it in two" reads like geometric intersection. **The old code's "no shared endpoint, no split" must not be assumed.**
2. **A smallest region can have two boundaries.**
   - Put a small circle inside a large circle and include both in the same partition. The result is an inner disc and an outer ring.
   - The ring is one smallest region with an inner and an outer boundary.
   - So "a fill belongs to a closed curve" should be extended to **"a fill belongs to a face, and a face is enclosed by one or more boundaries"**.
   - No separate hole-punching tool is needed.
3. **How fill colour carries over when a region splits or merges.**
   - Two halves of a split red circle both inheriting red is the natural candidate.
   - Red and blue merging into one face: keep one of the colours, or clear it.
   - "Only one single-colour face remains" and "the original red / blue split stays unchanged" cannot both hold.
   - A small region that disappears and reappears during a drag needs a similar rule.

**Limits on Claude's conclusions:**

- **"No overlap" only holds inside one partition.** It does not remove paint order between different layers or objects.
- **A gradient does not necessarily break when the region is split in two.** If both parts inherit the original gradient coordinates, it stays continuous. It only changes if each new region rescales the gradient.
- **Whether blur applies per face or to the whole** is decided at the effects level.

**Comparison:**

- It is close to how Figma's paint bucket works region by region, but the data models are not the same.
- **Adobe Live Paint is a more direct comparison:** edges are split at intersections and the enclosed faces are coloured. Source (opened by dot): <https://helpx.adobe.com/illustrator/desktop/paint-and-fill/learn-painting-basics/about-live-paint.html>
- No more arguing against the seams bowen has already accepted.

### Merged result (Claude accepts dot's corrections)

- **Claude's restatement "lines that only cross do not split a region" is withdrawn as a fact.** It came from the old code (fills.ts:3-6) and is not bowen's decision. It becomes **question 1**.
- **Claude's B3 (holes) becomes dot's point 2.** A face can have several boundaries, and a ring is one face.
- **Claude's B2 "a gradient is bound to break" was overstated.** Inheriting the gradient coordinates keeps it continuous. Leave it to the effects level.
- **Claude's B1 merges with dot's point 3:** inheriting colour on split / merge, plus disappear-and-reappear during a drag.
- **B4 (across layers)** stays deferred.
- **No hard contradiction found.**

### Three questions for bowen

1. **What splits a region?** Do lines split it wherever they geometrically cross, as in Live Paint, or only where they share an endpoint?
2. **May a fill's region have holes?** For example the ring between a large and a small circle: is it one face?
3. **How do colours carry over on split, merge, or disappear-and-reappear?** On split, both halves inherit? On merge, keep which one?

### bowen's decision on question 1 (1791386368)

> 几何相交只有端点合围起来才算也就是说一条穿圆的线交点没有节点不算把圆分半。我觉得这是矢量图操作的基础

- **Only regions closed at endpoints count.** A line crossing a circle with no node at the crossing does not split the circle.
- **Comparison (fact only, not an objection):**
  - Illustrator Live Paint splits edges at geometric intersections, so a circle with a line through it is two faces (verified, see Q9).
  - bowen's rule matches ordinary paths and Figma vector networks, where only shared vertices connect.
  - It also matches the current code (fills.ts:3-6).
- **Interaction note:** an area that looks enclosed but is not fillable needs clear feedback, for example "add a point at the crossing", in batch 2.

### Status

**Question 1 decided by bowen (1791386368): split only at endpoints.** Questions 2 (holes) and 3 (colour inheritance) are partly answered in Q9 and wait to be merged there.

---

## Q9: bowen's fill proposal v2 (Claude's independent review)

**bowen** 1791386268:
> 删掉红蓝中间线这种相当于出现了undefined/有歧义的情况，此时直接删除所有有歧义的element 即红蓝都删除。这个遇到歧义即破坏性删除应该适用于整个项目。2.渐变模糊面上面添加线条，只要添加了，那么就展现出切段的渐变，这样会非常明显，并且基本上是undesired的效果。那么想要在渐变的面上加线条，就要在新的图层里绘制。这样不是闭合曲线也就不影响渐变了，纯色同理。（我目前想不到什么在渐变填充上还要是用同一组闭合曲线去绘制一根线的情况，成熟方案支持这个吗？）3 区域里的孤岛：要实现这个孤岛就让大圆套小圆，然后用一根线将大圆小圆相连，这样填充两圆之间区域就能形成孤岛，再把连接大圆小圆的线隐藏 就是完美孤岛。（孤岛一半很少用到，我这个方案你可以再攻击一下试试 4. 跨图层用端点联动围成了区域……。 说到这里，我觉得，如果我在填充之前 手动选择一个闭合区域再填充，是不是就直接解决上述所有问题了？ 跨图层也可以精确定义了只要我手动选择了的是闭合曲线 就可以填充。 也不用trap啥的了（同色时候） 这样就是ui交互繁琐一点， 那么在交互设计上，可以油漆桶default只填充最小区域。然后支持人手动选择区域来填充。后填充覆盖先填充。大填充覆盖小填充。

### Mature-tool facts (opened this time)

**Adobe Illustrator Live Paint:**

- **Faces and edges.** An edge is the part of a path between intersection points. A face is the area enclosed by one or more edges, so **islands are supported natively**. A circle with a line across it is two faces. Each face can be filled with a different colour, pattern or gradient. Source: <https://helpx.adobe.com/illustrator/desktop/paint-and-fill/learn-painting-basics/about-live-paint.html>
- **Editing a path.** Modified or newly created faces are coloured automatically with the group's existing fills. If the result is not wanted, the user repaints with the Live Paint Bucket. Source: <https://helpx.adobe.com/illustrator/desktop/paint-and-fill/learn-painting-basics/modify-live-paint-groups.html>
- **Deleting a dividing path.** The merged face is filled with "one of the fills previously in the circle"; the figure caption says "the larger fill spreads into the merged area". Same source.
- **Live Paint Selection tool.** Double-clicking selects all contiguous faces not separated by a painted edge. Same source.

**Figma VectorNetwork:** a region references any loops; several loops give holes (Q7 follow-up A).

### Review

**1. "Ambiguity → destructive delete (delete both red and blue)", applied project-wide**

- **Difference from mature tools (verified):** Illustrator keeps one fill, the larger. bowen's rule is stricter and simpler. Both are workable; it is a product choice.
- **Gap: what counts as "ambiguous".** Two faces of the **same colour** merging have no conflict. Should they also be deleted? "Project-wide" needs a definition of ambiguity; otherwise it will be applied inconsistently.
- **Gap: mid-drag.** During a drag a small face can shrink to nothing and then reappear (dot 1791385538). If each frame decides on its own, the fill is deleted halfway through. Suggestion: decide ambiguity **once, at the end of the gesture (commit)**.
- **Consistent with "deleting a point is serious" (§32.6a):** a destructive delete must say what it deleted, and one undo must restore everything.

**2. Lines on a gradient face go on a new layer**

- **No problem found.** Mature tools allow drawing a line inside a gradient face, but the result is per face: each face gets its own gradient (verified: each face can have its own gradient, and new faces take the group's fill). bowen's call that this is usually unwanted and the line should go on another layer is reasonable.
- **To confirm:** a line on a new layer is part of no closed curve and splits no face, which is consistent with "lines on different layers do not partition each other".

**3. An island made by connecting the two circles with a line, then hiding that line**

- **Dependency.** "Hide the line's ink but keep the geometry" belongs to the stroke and visibility features, which bowen deferred (1791378715). The island depends on it.
- **Risk.** If the user deletes the connecting line instead of hiding it, the faces change and, under rule 1, the ring's fill is destroyed. Accidental data loss.
- **Rendering, unverified.** The region boundary runs along the bridge once in each direction (a zero-width slit). Some anti-aliased renderers may leave a hairline along the hidden bridge; vello #49 notes that a single path can also show conflation gaps. **Needs testing.**
- **Difference from mature tools (verified):** Live Paint faces and Figma regions express holes directly with several boundaries; no bridge is needed. With the manual selection in item 5, an island is just "pick the outer ring and the inner ring", so the bridge workaround is unnecessary.

**4 and 5. Manual region selection; the bucket defaults to the smallest region; "later covers earlier" and "larger covers smaller"**

- **Real contradiction: the two cover rules conflict.**
  - Example: manually fill the whole θ red, then use the bucket to fill the upper half blue.
  - By "later covers earlier", blue is on top.
  - By "larger covers smaller", red is on top and blue cannot be seen at all.
  - **One priority must be chosen.**
- **Gap: which layer holds a manual cross-layer fill.** Selecting the closed curve defines the boundary exactly, but the fill still has to live in one layer, and which one controls its paint order relative to other layers. Options: the active layer, or the front-most layer among the boundary lines. Needs a decision.
- **Good: rule 1 makes manual regions well defined.** If a manual region loses part of its boundary through an edit, it is ambiguous and is deleted. This avoids the problem from many earlier fill rounds of "where does the fill go after an edit" (dot point 4).
- **Good: same-colour seams.** A whole manual region is one fill, so there is no seam.
- **Matches mature tools (verified):** the data matches Figma, where a region references any loops. The interaction matches Live Paint and Figma's Paint tool (default to the smallest region, with hover preview). Live Paint's double-click to select contiguous faces could serve as a quick way to select manually (verified fact; whether to use it is bowen's call).

### dot's independent review (1791386558, summarised)

**The proposal works** ("bucket defaults to the smallest region + boundary chosen by hand"). It mainly settles **where** to fill. It does not yet settle ownership, what happens after edits, or cover order.

**The endpoint rule (bowen 1791386368) can be adopted.** It is this project's choice, not a rule shared by all vector tools.

1. **Clearing both red and blue fills after they merge is fine.** dot reads it as "clear the ambiguous fills, do not delete the lines that enclose them". **dot opposes making "ambiguity → delete" an unconditional project-wide rule.**
   - "The program cannot tell which line was meant" and "an existing fill became invalid through an edit" are different kinds of ambiguity.
   - If the first case also deletes every candidate, a program uncertainty turns into damage to the drawing.
   - It should be limited to objects **made invalid directly by this explicit operation**. When the target or the scope of the effect is unclear, **stop; do not widen the deletion**.
2. **Mature tools allow decorative lines on a gradient within the same layer.** A gradient shape in an ordinary group and a separate stroke can coexist without splitting the fill.
   - **A separate layer is not required.** bowen's rule (a line added inside the network splits faces; decorative lines go on another layer) can stand as a stricter rule, but it should not be described as what mature tools all do.
   - **Splitting faces does not necessarily restart the gradient or blur.** Illustrator supports one gradient's coordinates shared across several objects. Source: <https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-gradients/apply-gradients-across-multiple-objects.html>
3. **A hidden bridge between the two circles can express the ring.** But the boundary goes out along the bridge and back along the same bridge, so **a boundary must be allowed to pass the same edge twice**.
   - It cannot both allow this construction and require that a closed boundary never repeats an edge.
   - Hiding the ink is not the same as deleting the bridge.
4. **A hand-chosen boundary must say what it follows afterwards.**
   - Example: fill the whole large circle by hand, then add a dividing line inside it. Does the fill stay with the outer ring, or split into two?
   - If it stays with the outer ring, a whole-shape gradient is kept.
   - If it splits automatically, hand selection only settles the first choice of area, not its wholeness later.
   - **Which layer a cross-layer hand-chosen fill is drawn in, and whose lock and mask apply,** is decided at the layer-relations level.
5. **Cover rules.** dot reads "larger covers smaller" as "a larger region filled later covers the earlier smaller ones", which reduces to time order.
   - If bowen means "larger is always on top regardless of order", it conflicts with "later covers earlier".
   - Example: large red first, small blue later. Which is on top? Needs a decision.
   - Filling a whole shape as one block removes the seams inside it, not the seams between it and other neighbouring fills. trap stays null.

### Merged result (Claude accepts dot's corrections and additions)

- **Destructive delete (item 1).** Claude's question was "what counts as ambiguous". dot's stance is narrower and safer: delete only objects made invalid directly by an explicit operation; when the target or scope is unclear, stop. **Claude agrees.** This also fits "deleting a point is a serious action" (§32.6a).
- **Lines on a gradient (item 2).** Claude's "no problem found" is kept. dot's addition is accepted: in mature tools a separate stroke object does not split the fill and gradient coordinates can be shared, so **"a new layer" is a stricter rule, not a necessity**.
- **Bridge island (item 3).** dot's requirement is added: a boundary must be allowed to pass the same edge twice.
- **New gap from dot (item 4):** after a hand-chosen fill, adding a dividing line inside it. Does the fill stay with the outer ring, or split? **Claude missed this.**
- **Cover rules (item 5).** Claude and dot found the same conflict.
- **Cross-layer.** Both agree to defer it to the layer-relations level.

### Questions for bowen (after merging)

1. **Scope of destructive delete.** Is it limited to fills made invalid directly by an explicit operation, with deletion stopped when the target is unclear (dot's proposal)?
2. **Cover rules.** By time order only, or does "larger always on top" also apply?
3. **A hand-chosen fill after an inner dividing line is added.** Does it stay with the outer ring as one whole fill, or split into two?
4. **Which layer a cross-layer hand-chosen fill lives in.** Deferred to the layer-relations level.

### Status

**Both independent reviews merged.** Waiting for bowen.

### Q9 follow-up: How does Figma model fills, and how does it handle the issues above?

**bowen** 1791386736:
> figma是怎么解决上述问题的 它的填充问题建模是什么

#### Verified (Claude 1791386761)

**Data model.** Source: Figma VectorNetwork API, opened. A vector shape has three tables:

| Table | What it holds | Notes |
|---|---|---|
| **vertices** | Position, plus strokeCap, strokeJoin, cornerRadius and handleMirroring | Stored **per vertex** |
| **segments** | Start and end vertices, plus tangentStart and tangentEnd | No direction; **every segment gets a stroke** |
| **regions** (optional) | windingRule, one or more **loops** (segment indices in order), and fills | e.g. the letter "o" is one region with two loops |

**When no region is given, all enclosed space is filled.**

**Interaction.** Source: Figma Help "Edit vector layers", opened.

- The Paint tool shows a striped preview on hover.
- Click fills one region; dragging fills several.
- Clicking a region that already has the same colour removes the fill.

#### Mapping to the open questions

- **Where to fill.** A region is an explicitly listed set of loops: a smallest piece, the outer ring, or a shape with holes. That is wider than "smallest region only" and matches bowen's later "choose a closed region by hand".
- **Whole-shape gradient.** With no regions, all enclosed space shares the shape's single fill. **Not verified** whether this means one continuous gradient; the docs do not say so directly.
- **Not documented in the pages read:**
  - how regions and colours change after a line is added or deleted;
  - which overlapping region is on top;
  - which kind of region the UI actually stores.

  These can only be learned by trying Figma by hand. Claude cannot create or sign in to an account; bowen can test it.

#### Status

**Waiting for bowen.** The four questions from Q9 are still open; Figma's documentation does not settle them.

---

## Q10: Is Figma open source? Are there similar open-source tools?

**bowen** 1791386850:
> figma是开源软件吗？或者有和它类似的开源软件吗？

### Facts (Claude 1791386897; licence and star counts from the GitHub API, read this time)

**Figma** is commercial software. Its source code is not public.

**Graphite** (Apache-2.0, about 27k stars): <https://github.com/GraphiteEditor/Graphite>

- An open-source tool for 2D design, illustration and motion graphics, built on a node-based procedural engine.
- It has "vector meshes", which generalise paths to any topology. This is the same idea as Figma's Vector Networks.
- **Issue #2309 is still open** (opened 2025-02): <https://github.com/GraphiteEditor/Graphite/issues/2309>
  - **What it is about:** "topological styling". Fill and stroke styles attach to the **topology**, so that while the geometry moves from frame to frame, every sub-segment and sub-region can still be identified stably.
  - **Current plan:** "a filled region = the area bounded by a list of segments, each with a direction".
  - **Why it matters here:** it is almost exactly this project's problem (head-turns keep the topology while the geometry moves), and it is still unsolved there.
  - Only the first part has been read so far.

**Penpot** (MPL-2.0, about 61k stars): <https://github.com/penpot/penpot>

- The open-source design platform closest to Figma.
- A search of its issues for "vector network" returns 0. **Probably** it uses plain paths; **not verified**.

**Inkscape:** a long-established open-source vector editor based on ordinary SVG paths.

### Status

Claude suggested reading Graphite #2309 and its implementation in full and writing up a comparison. **Waiting for bowen to agree.**

### Q10 follow-up: Are there lightweight open-source vector editors?

**bowen** 1791386895:
> 或者有矢量编辑轻量化的开源软件吗？

#### Facts (Claude 1791386966; licence and activity from the GitHub API)

**Lightweight browser editors.** Both use the **ordinary path model** (a line is a chain of segments joined end to end), not a network.

| Editor | Licence | Stars | Last update | Notes |
|---|---|---|---|---|
| **SVG-Edit** <https://github.com/SVG-Edit/svgedit> | MIT | about 7.9k | 2026-08 | |
| **Method Draw** <https://github.com/methodofaction/Method-Draw> | MIT | about 3k | 2024-05 | A trimmed-down fork of SVG-Edit |

**Drawing libraries** (not editors):

- **Paper.js:** paths are made of segments. GitHub does not detect its licence; the official site says MIT, which is **not verified**. Early design docs used it as a reference.
- **Fabric.js** (MIT): the canvas library the proto uses now.

**Not a fit:** Excalidraw and tldraw are whiteboard tools. They do not edit Bézier anchors and handles.

#### Conclusion

- **Lightweight open-source editors all use the path model.**
- **Of bowen's network model,** the only open-source example is Graphite, and it is heavy (Q10).
- **bowen's own v103 is a lightweight network-style implementation:** one record per segment, shared endpoints, pairwise joins.

### Q10 follow-up 2: What is the ordinary path model, what is the network model, and how do they differ?

**bowen** 1791387009:
> 什么是普通路径 什么是网格模型？这俩区别是什么？

#### Answer (Claude)

**Naming:** Figma calls it a "vector network" and Graphite calls it a "vector mesh". They mean the same thing, called "network" below.

**Ordinary path:** a line is a chain of points connected from start to end. Figma's blog compares it to a pen plotter: pen down, travel along, pen up.

- Each point connects to at most the point before and the point after.
- It can close into a closed path, and a closed path has its own fill.
- **It has a natural direction and order,** so effects along the line are easy, for example thinning from thick to thin.
- **It cannot have three lines meet at one point.** That has to be drawn as several paths whose ends touch, plus a separate connection.

**Network:** points and segments are stored separately. Any two points can be joined, and **one point can have 3 or more segments**, like roads meeting at an intersection.

- A fill is one or more loops enclosed by segments.
- Moving a shared point moves every segment attached to it.
- **There is no natural direction or order,** so effects along a line need a separately defined route (Q7 A4).

**Examples:**

| Shape | Path model | Network model |
|---|---|---|
| A Y-shaped strand of hair | Two or three lines with touching ends, plus a connection | Three segments sharing one point |
| A θ | A circle plus a line: two separate objects, and the fill is not split | The arcs and the middle line share two points, giving two regions |

**Which model each version uses:**

| Version | Model |
|---|---|
| bowen's v103 | Close to a network: one record per segment, shared endpoints, pairwise joins |
| The current new proto | Paths plus cross-path connection records: a hybrid |
| bowen's knowledge-graph structure | A network |

#### dot's additions (1791387125)

- **The core difference is how connections are represented, not which shapes can be drawn.** Both use Bézier curves.
- **A network can also give a single edge, or a chosen route, a direction.** A branching network just has no single start-to-end order.
- **A network does not automatically mean "fill only the smallest regions".** The connection model and the fill rule are separate questions. Figma uses separate regions to specify fill boundaries.
- **"Network" here is neither a 3D triangle mesh nor Graphite's procedural node graph.**
- bowen's "single segments + shared endpoints" is the network approach.
- Source: <https://developers.figma.com/docs/plugins/api/VectorNetwork/>

### Q10 follow-up 3: dot suggests evaluating SVG-Edit first (1791387187)

**dot's view:**
- SVG-Edit is more than a drawing library. It is officially split into a reusable editing core, `svgcanvas`, and an editor UI, and the whole editor can be embedded in our own page. That is closer to bowen's idea of reuse than taking another canvas library and rewriting every tool ourselves. <https://github.com/SVG-Edit/svgedit>
- Method Draw is leaner, but it drops layers and other features for simplicity. It may not suit us as a full base.
- Whether needs like shared endpoints can be kept must be checked separately. No promise that switching would solve them.

**Claude checked this time (GitHub API / raw files):**
- The repo's `packages/` contains `svgcanvas`, published as `@svgedit/svgcanvas` 7.4.2 under MIT.
- Its `core/` has separate modules, including `history.js`, `undo.js`, `layer.js`, `path.js`, `path-actions.js`, `select.js`, `selection.js`, `clipboard.js`, `draw.js` and `paste-elem.js`.

**Not yet checked; to cover in an evaluation:**
1. **What it treats as the document.** Very likely the live SVG elements themselves (inferred from the module names, **not verified**). If so, a line is an SVG `<path>`, i.e. the **ordinary path model**. bowen's network model (shared endpoints, regions of loops) has no native representation.
2. **This project's own data:** head-turn keyframes, masks and fill regions. Do these go in a layer above it, or do they require changing its core?
3. **Its undo and selection model vs our needs:** for example, the selected point always belongs to the selected line (E1), and one gesture is one undo step.

**Status:** this is only a candidate for evaluation. Whether to run a short evaluation is up to bowen.

### Q10 follow-up 4: VPaint / VGC (found by dot, 1791387306), and a correction

**Correction:** Claude said (1791386966) that "for bowen's network model, the only open-source example is Graphite". **That is wrong.** VPaint / VGC fits that model more closely.

**dot's view:**
- VPaint's official description says connections between curves are kept during editing. A face created with the paint bucket remembers the lines that form its boundary, and the fill follows when that boundary changes.
- VPaint and its successor VGC are better suited to studying the network and fill structure. SVG-Edit is better suited to evaluating direct reuse of general editing tools. **Keep these two directions separate.**
- VPaint is a research prototype and VGC is still alpha. "The model fits" must not be stated as "it is mature and can replace ours directly".

**Claude verified (GitHub API / README):**

| Project | Licence | Stars | Last push | Description |
|---|---|---|---|---|
| **VPaint** <https://github.com/dalboris/vpaint> | Apache-2.0 | about 770 | 2024-07 | "Experimental vector graphics and 2D animation editor" |
| **VGC** <https://github.com/vgc/vgc> | Apache-2.0 | about 340 | 2025-01 | |

- **The VPaint README says** it is an "experimental prototype" built on the **Vector Graphics Complex (VGC)**, a technology from a research collaboration between Inria and the University of British Columbia.
- The README shows demos named shared edges, glue, depth ordering and star split.
- It states that it "is considered BETA, and always will", and that the team is developing **VGC Illustration / VGC Animation**.

**Not verified:** Claude recalls papers on the Vector Graphics Complex and the Vector Animation Complex (Dalstein et al., around SIGGRAPH 2014 / 2015), whose subject is animating vector graphics while topology changes. **Not opened this time.** If true, they are closely related to this project's head-turn case (geometry moves while topology stays the same, or changes).

**Status:** two kinds of reference, kept separate:
- **Studying the model:** VPaint / VGC, Graphite #2309.
- **Evaluating reuse of tools:** SVG-Edit.

Which to look into further is bowen's call.

---

## Q11: Should an open-source vector editor be the base we build on?

**bowen** 1791387360:
> 我们应该搞一个开源的矢量绘制软件当作基座然后在上面开发的， 你们都同意吗？毕竟这个基础绘制一是没必要造轮子 二是好像确实很复杂 3是其实和我们的架构并不怎么相关。我们完全可以把它当做一个包 从里面提取我们要的element再去构建我们的东西 但是编辑靠它

### Claude's independent judgement (1791387408)

**Agree with the direction.** Basic drawing tools (pen, selection, anchors, undo) should not be reinvented again; this round has shown that.

**Only half agree with point 3 ("not really related to our architecture").** Head-turn key shapes, show/hide, mirroring and fill regions all **attach to points and segments**, and those are the base editor's objects. The base must provide three things:

1. **Stable identity.** Every point and segment has a fixed id that survives edits and undo.
2. **Change notification.** When the user changes a point, the base tells us which one.
3. **A way to attach our own data and tools,** such as mirror editing, cross-layer links and key shapes.

**Data model:** ideally bowen's network (shared endpoints, regions of loops). With a path model, a conversion layer has to sit on top.

### Candidates (implementation languages from the GitHub API this time)

| Candidate | Language | Model | Notes |
|---|---|---|---|
| **SVG-Edit** | JavaScript 97%, MIT | Path model | Embeds in a web page. Probably edits SVG elements directly (unverified). **Stable point ids are the biggest question.** |
| **Graphite** | Rust 89%, Svelte 6%, Apache-2.0 | Network (vector mesh) | Runs in the browser as WebAssembly, to Claude's knowledge. A complete application, not a library to embed. |
| **VPaint / VGC** | C++, Apache-2.0 | Fits best | Desktop programs, not web technology; cannot be embedded directly. |
| **Penpot** | Clojure 73%, MPL-2.0 | | A complete collaboration platform; too heavy. |
| **Paper.js** | JavaScript | | A drawing library; no ready-made editing tools. |

### Suggestion

1. **Write the base's must-have list first:** the three points above, plus works on the web, a licence that allows it, and adequate performance.
2. **Run a short evaluation** of the two web-capable candidates, SVG-Edit and Graphite. The question that matters most: **can they provide stable ids and change notifications?**

### Status

**Waiting for dot's independent judgement, then bowen decides.**

### dot's independent judgement (1791387516), merged

**dot agrees with the direction:** reuse a complete open-source vector editor first, and spend our effort on head-turn, snapshots, characters and recording. Taking only a drawing library, rewriting the pen, selection, hit testing and undo, and calling that "reusing a mature solution" must stop.

**"Extracting elements" has to work both ways,** not as a one-off export after drawing:

- **After the user drags, adds or cuts points,** the key shapes and links we attached to those points and lines must survive.
- **After we switch view or change a character,** the result must go back into the same editor for further editing.
- **Commit, cancel and undo of one operation must be coordinated.** There must not be two separate histories that drift out of sync.

These are adapter boundaries, not a request to rebuild the editor.

**Native permanent point ids need not be the only hurdle.** If the base offers a reliable editing interface, a thin adapter can keep identity. What cannot be accepted: after every change we only get a picture of the result and must guess which point corresponds to which.

**Target:**

| Part | Responsible for |
|---|---|
| Base | General editing |
| Us | Our business data |
| Adapter | Only explicit mapping and keeping operations in sync |

Check whether SVG-Edit and other candidates can hold this boundary before choosing a base. No more patching our own tools in the meantime, and no promise that any candidate can be wrapped directly.

**Merged result:**

- Claude's three requirements (stable identity, change notification, attaching our data) **stand.**
- Claude's "stable identity must be native to the base" was **too strict.** It is changed to dot's "a reliable editing interface plus a thin adapter that keeps identity". What is not acceptable is having only the result to go on.
- **Two of dot's additions are added to the requirements:**
  - results can be handed back into the editor;
  - **one shared operation history** (commit, cancel, undo coordinated).

### Q11 follow-up: Even if it is C++, porting it one-to-one to TS shouldn't be hard, so can the constraints be relaxed?

**bowen** 1791387509:
> 就算是c++ 你们一比一复刻一个ts版的应该也不难吧？因此限制范围可以放宽？

#### Facts (Claude cloned dalboris/vpaint (`--depth 1`) and measured it)

**Size:**

| Part | Size |
|---|---|
| VPaint's own code (`src/VAC`) | about **57.7k lines** of C++ in 193 files |
| Third-party code (`src/Third`, maths libraries and others) | about 136k lines; not ported |
| Topology core (`src/VAC/VectorAnimationComplex`: points, edges, faces, cycles, in-betweens) | about **27.9k lines** in 81 files |

**Dependencies:** 44 of the 81 core files reference Qt (`QObject` / `QWidget` / `#include <Q…>`). Drawing uses OpenGL.

**Edge geometry is not a Bézier with handles.** `EdgeGeometry.h` defines `LinearSpline`, a polyline through sampled points used to store hand-drawn strokes. Bézier appears only in fitting (`SculptCurve.h` CubicBezierFitter / QuarticBezierFitter). **This differs from bowen's base unit:** two endpoints and two handles.

#### Judgement (Claude 1791387583)

- **Port cost:** it is not a line-by-line translation; the Qt and OpenGL dependencies have to be removed along the way. After porting, those tens of thousands of lines become **our own code** with no one else maintaining them, which runs against "don't reinvent the wheel". The geometry layer would also have to change to Bézier.
- **What to borrow from VPaint is its topology design:** how points, edges and faces are organised, how cycles and faces remember their boundaries, and how topology changes during animation. Treat it as a design reference.
- **Relax the constraints separately:**
  1. **As a research reference** (reading the design): C++ is fine; relax.
  2. **As the editing base we use directly:** prefer something that runs natively in a web page and is still maintained. Otherwise we are writing it ourselves again.

#### Status

**Waiting for dot's independent judgement and bowen's decision.**

### Q11 follow-up 2: Wrap the base's layers in our own outer layer

**bowen** 1791387571:
> 然后我的思路是 它的图层可以很原始 可以raster类似的， 但我们也构筑一个外图层， 它们图层建立了什么我们的外套图层立刻拿来然后给它加上各种属性。这样的把它当基座

#### Facts

**Mature precedent: Figma plugin API `setPluginData`.** Opened: <https://developers.figma.com/docs/plugins/api/properties/nodes-setplugindata/>

- It lets a plugin store "custom information on any node or style, private to your plugin".
- Each entry is at most 100 kB, and the data becomes unreadable if the plugin ID changes.

#### Judgement (Claude 1791387699)

**To confirm with bowen:** "primitive, raster-like layers" is read as "few features, we barely use its layer functions", not "the content is pixels". Lines must stay editable vectors, or dragging and adding points is impossible.

**Two ways to build the outer layer:**

| Approach | How it works | Trade-off |
|---|---|---|
| **1. Store attributes on the base's objects** (how Figma plugins do it) | The data travels with the object; copy and undo are handled by the base | **Least work.** Requires the base to allow custom data on objects. |
| **2. Our own outer layer tree** (what bowen describes) | Each node maps to a base object by id | **Most freedom.** Every create, delete, copy and undo in the base must be synced immediately, or the two sides drift. |

**Approach 2 must first decide who has the say.** Order, visibility and lock must not be editable in both places. Suggested split:

- **The base does geometry editing only:** drawing lines, changing points, cutting.
- **The outer layer owns organisation and attributes:** layers, groups, visibility, lock, head-turn data, fill rules. It tells the base what to show and what to lock.

So each thing is changed in exactly one place.

**Relation to the earlier judgement:** this matches dot's (1791387516) "the base does general editing, we own business data, an adapter in between". bowen's "outer layer" is that adapter in concrete form.

#### Status

**Waiting for bowen to confirm** the raster point and the split of authority.

---

## Q12: How mature vector software designs points, lines and faces (open-source half, Claude)

**bowen** 1791387658:
> 行吧 那就这样 去成熟的矢量软件里去搜它们的点线面（填充）的设计框架

**bowen** 1791387745:
> 所以现在的目标是 搞一套点线面的知识图谱型框架即可

### Method

- **Division of work:** Claude covers the open-source projects whose source can be read. dot covers the closed-source ones from official docs (Figma, Illustrator, SWF, Harmony).
- **Who did the reading:** three read-only agents read the source, and Claude spot-checked the key claims.
- **Where the full text is:** `Codex/2026-10-06/task/vector-model-research/` (`opentoonz.md`, `vpaint-vgc.md`, `graphite-paperjs-synfig.md`).
- **Evidence:** every claim cites file:line or is marked unverified. Several items marked "inferred from code" were not run.

### Comparison table (five questions)

| | **OpenToonz** (BSD, active) | **VPaint** (Apache, dormant) / **VGC** (Apache, alpha) | **Graphite** (MIT/Apache, active) | **Synfig** (GPL, active) | **Paper.js** (MIT, dormant) |
|---|---|---|---|---|---|
| **1. Points / lines** | Stroke = a chain of **quadratic** curves; **each control point has its own thickness**; strokes **cross each other** and do not share endpoints | **Vertex, edge and face are separate cells**; edge endpoints are shared vertices; 3 or more edges can meet. VPaint edges are sampled polylines; VGC edges are Catmull-Rom knots (converted to Bézier internally) | Points and segments are separate tables; segment endpoints are shared point indices; 3 or more can meet; **handles live on the segment**; stable u64 ids | A spline is an ordered list of vertices; vertices can be **linked** across layers (shared parameters, not a graph) | Path = ordered segments (anchor plus two handles); **3 lines cannot share a point** |
| **2. Where fill attaches / who decides regions** | **Computed automatically** (intersections of all strokes in a group → smallest regions, holes allowed); colour **stored on the boundary edge pieces** | **A face is its own cell**: a list of cycles (holes allowed), its own colour; the paint bucket creates it **explicitly** (smallest planar cycle plus holes); faces may overlap and have a z-order | **Computed every time it is drawn** (loops of the shared-point graph; holes by winding); **one fill colour for the whole object**; per-region styling not done (#2309 open) | One region layer = one closed spline; fill and stroke share the same spline object. **Correction (dot 1791389023):** "no holes" was wrong. The official wiki shows a transparent inner ring made with the Even/Odd winding rule (<https://www.wiki.synfig.org/Winding_Style_Parameter>). It is still not an explicit multi-boundary face object like VGC's | Fill is the path's or compound path's style, decided by the fill rule |
| **3. Topology changes** | When a split crosses, colour passes **by maximum overlap of segment ranges on the same stroke** (inferred); on merge, colour taken **by walk order** (inferred) | Cutting an edge: the face **repairs its boundary in place**. Splitting a face: **both halves keep the colour**. Smart delete merges: VPaint **blends colours 50/50**, VGC **keeps the colour of the larger area**. Hard delete: **all faces touching the edge are removed** | Regions are recomputed from topology; no per-region identity to keep | Inserting or deleting a vertex affects every layer that shares that spline | Fill follows the path; splitting a path copies the style |
| **4. Stroke attributes** | **Thickness per control point**; one style per stroke; caps and joins per stroke | VPaint: width per sample, colour per cell, joins are round-cap overlaps. VGC: width per knot (left/right independent), a join model exists but **multi-join is off by default** | Per object: width, cap, join, dashes; no per-segment width | **The most complete along-the-line width curve** (WidthPoint: position, width, tip shape) | Per object |
| **5. Animation** | Inbetweening **pairs stroke by stroke and point by point, by index**; regions re-derived each frame | **VPaint: inbetween cells** (vertex / edge / face); **topology can change over time** (splits and merges between key frames). Fixed topology = 1:1 inbetweens (motionPaste); geometry interpolation is fairly simple (linear by arc length) | Stable ids allow fixed-topology motion; the keyframe timeline is still unfinished | **Every point position and width can be keyframed on its own**; points can **appear and disappear smoothly** over time | None (code-driven only); `interpolate` requires the same topology |

### Observations relevant to bowen's structure

- **"Segments + shared endpoints" (network):** found in VPaint/VGC and Graphite. OpenToonz uses crossing strokes; Synfig uses linked parameters; Paper.js cannot do it.
- **"Fill on a closed loop / face, holes allowed":** VPaint/VGC are closest. **A face is an explicit object** whose boundary is a list of loops.
- **"Fill only on the smallest region":** for VPaint/VGC this is **the paint bucket's default behaviour**; the data does not require it. **This matches bowen's later proposal: bucket defaults to the smallest region, boundaries can also be chosen by hand.**
- **Merge ambiguity:**

  | Tool | What happens on merge |
  |---|---|
  | VPaint | Blends 50/50 |
  | VGC | Keeps the colour of the larger area |
  | Illustrator Live Paint | Larger one spreads (Q9) |
  | OpenToonz | Takes one by walk order |

  **Correction (dot 1791389023):** deleting both does have a precedent.
  - VGC has an explicit operation that deletes an edge together with its incident faces: <https://www.vgc.io/news/snapping-paint-bucket-rectangle-selection-move-and-delete-and-improved-sketch-to>
  - VPaint and VGC hard delete also destroy every face that touches the edge (the source reports already said so; the earlier summary missed it).
  - **But that is a definite delete operation the user chooses.** It does not support "delete whenever anything is ambiguous".
  - bowen's rule remains a product choice.
- **Head-turn with fixed topology:** VPaint's 1:1 inbetween cells are the closest model. Its interpolation resamples both key paths to the same number of samples by arc length, then interpolates each sample linearly (vertices use cubic Hermite). **No conclusion is drawn here about whether that is enough for a head-turn; there is no evidence yet** (dot 1791388425).
- **Width along the line:** Synfig's WidthPoint and OpenToonz's per-point thickness are both mature examples. These belong to the "stroke" level, deferred by bowen.

### Status

**The open-source half is done.** Waiting for dot's closed-source half. After that, the merged result becomes **a draft point-line-face graph framework for bowen**:

- entities, relations and rules;
- each relation marked decided / proposed / disputed, with sources.

**Nothing is written into the formal graph.**

### Closed-source half (dot 1791388300, summarised)

**Common pattern:** mature tools usually keep **connections, curve geometry, fill boundaries and appearance separate**, rather than packing them all into "closed curve".

1. **Figma:** network plus explicit fill regions.
   - Edges reference their two endpoints and store the handles.
   - Regions reference one or more boundary loops and carry the fill.
   - A region is not a separate layer. Effects such as blur sit on the vector object, not on each face.
   - Source: <https://developers.figma.com/docs/plugins/api/VectorNetwork/>
2. **Illustrator:** two mechanisms side by side.
   - Ordinary and compound paths: fill follows the path object, and several boundaries make holes.
   - Live Paint: intersections of the original paths define edges and faces, colour attaches to faces, and fills are re-matched after edits. This differs from bowen's "only shared endpoints connect".
3. **Flash SWF:** each side of an edge references a fill style; strokes are separate.
   - The public format has no separate face table, and the editor's internals cannot be inferred from the file format.
   - Its curved edges are **quadratic Béziers**.
4. **Toon Boom Harmony:** its public model separates lines, connection points, the colour on each side, and line width.
   - Lines are split at intersections.
   - Current docs separate pencil lines (centre line), brush shapes (outline) and invisible lines used only to close a fill area.
   - The old API link is dead, so these are historical public-model references only.

### Cross-check: dot's skeleton against the open-source findings (Claude)

**dot's six candidate concepts:** point, curve segment, connection constraint, boundary loop, fill region, appearance style. Layer organisation and view data sit outside.

| dot's concept | Open-source match |
|---|---|
| Point | VGC KeyVertex (position only); Graphite PointDomain |
| Curve segment | VGC KeyEdge (two endpoint vertices + geometry); Graphite SegmentDomain (start / end + BezierHandles) |
| Connection constraint | VGC vertex join model (computed per vertex; multi-join off by default); v103 TangentJoin {a, b, mode} pairs |
| Boundary loop | VGC KeyCycle (closed sequence of halfedges / closed edge / single vertex) |
| Fill region | VGC KeyFace (several cycles = holes, its own colour); Figma region |
| Appearance style | VGC CellStyle (per cell); Graphite Appearance (per object); OpenToonz style per stroke plus fill on edges; Synfig WidthPoint |

**No conflict found** between dot's six concepts and the VPaint / VGC cell model. But **they do not correspond one to one** (dot 1791388488). These six are our own proposed concepts, not a mapping of any tool's implementation.

**The one open-source exception:** OpenToonz and Graphite compute regions instead of storing them explicitly. dot's "explicit fill region" is closer to VGC and Figma.

### Draft framework (proposal; not in the formal graph; bowen decides)

**Entities:**

| Entity | What it is |
|---|---|
| **Point** | A position |
| **Segment** | A cubic Bézier: two endpoint Points plus two handles. Handles belong to the segment (Graphite, Figma) |
| **Join constraint** (geometry) | On a Point, which **pair** of Segments' handles are constrained, and how: smooth (collinear), corner (independent), mirrored. v103's "arc join" (ARC + radius) trims the geometry, so it also belongs here |
| **Corner appearance** (appearance) | How the stroke looks at a corner: miter / round / bevel. **It changes no geometry.** It belongs under Appearance |
| **Loop** | An ordered sequence of directed Segments that closes, as a fill boundary |
| **Face** | A fill region: one or more Loops, so holes are allowed, plus a fill colour |
| **Appearance** | Line stroke (on a Segment or a route), end stroke (on a Point / segment end), fill style (on a Face) |

**Relations:**

| Relation | Status |
|---|---|
| Segment —two ends are→ Point | decided |
| A Point may be shared by several Segments | bowen's structure |
| Join constraint —belongs to→ Point and names a pair of Segments | proposed (Q7 A2) |
| Corner appearance —belongs to→ Appearance (per point or per pair) | proposed. **Kept separate from the join constraint** (dot 1791388488): a round join is not a change of the two Béziers into an arc, and a miter join is not a broken handle. Source: Figma VectorVertex defines `handleMirroring` (geometry) and `strokeJoin` (appearance) separately |
| Loop —consists of→ Segments (direction matters) | proposed |
| Face —is enclosed by→ one or more Loops | proposed (Q8 point 2) |
| Fill —belongs to→ Face | decided |
| Only Segments that share endpoints close a region; a plain crossing does not split | **decided** (bowen 1791386368) |

**Rules:**

- **Creating a Face:** the paint bucket picks the smallest region by default; a boundary can also be chosen by hand. **Proposed** by bowen (1791386268).
- **A line splits a Face:** both halves inherit the colour. **Proposed.** VPaint and VGC both do this (sources: Q12).
- **Merging two Faces:** bowen proposes deleting the ambiguous fills.
  - **Disputed:** dot limits it to fills made invalid directly by an explicit action.
  - **Behaviours checked this time:** blend, larger area wins, or walk order. **Not generalised to all tools** (dot 1791388425).
- **Cover rules:** "later covers earlier" vs "larger covers smaller". **Disputed, waiting for bowen.**
- **Topology changes after a Face is chosen by hand** (a dividing line added inside it): **not decided.**

**Unknown:**
- The split and merge inheritance algorithms in the closed-source tools are not published. **Do not fill the gap with "mature tools ought to do this"** (dot).
- The open-source rules above are read from code, partly inferred, and not run.

**Outside this graph:** layers and groups, view / snapshot, head-turn key shapes, reference images.

**Three tiers of evidence, kept apart** (dot 1791388425):

| Tier | Covers |
|---|---|
| **A. Source code** | OpenToonz, VPaint / VGC, Graphite, Synfig, Paper.js. Read, with spot checks; several items inferred and not run |
| **B. Public API or file format** | Figma VectorNetwork API, SWF spec, Harmony's old script model |
| **C. Behaviour inferred from user docs** | Illustrator Live Paint help, Figma help, Harmony drawing-tool docs |

Tiers B and C are not internal implementations that have been verified.

---

## Q13: A concise fill-only proposal, drawing on these tools

**bowen** 1791388512:
> 这几家的方案你们能统筹出一个有关填充的简洁方案吗？只看填充

### Claude's draft (1791388555; proposal, not in the graph)

**1. What a fill is**

- **Face** = one outer Loop + zero or more inner Loops (holes) + a paint.
- **Loops are made only of Segments joined end to end at shared endpoints** (decided, bowen 1791386368).
- **A Face references Segments, not coordinates** (VGC KeyFace, Figma region). Geometry moves and the fill follows. During a head-turn the topology does not change, so the fill follows automatically.

**2. Creating**

- **Paint bucket:** fills the **smallest region** containing the click. Independent loops inside it become holes automatically. This matches the VPaint / VGC paint bucket (Q12, tier A).
- **Manual:** choose one or more Loops (bowen 1791386268).
- **Overlap:** faces made by the bucket in one network never overlap. Manual faces may overlap; then **the later fill covers the earlier one**. "Larger covers smaller" is dropped for now; see Q9.

**3. After edits**

1. **A point is added on a boundary:** the Face updates its boundary in place and **keeps its colour** (VGC cut repair, tier A).
2. **A boundary segment is deleted, or cut so the loop no longer closes:** **delete that fill.** Plain delete in VPaint / VGC does the same (tier A).
3. **A line is added inside a filled region with both ends on the boundary:** **both halves inherit the colour.** VPaint `cutFace_` and VGC `cutGlueFace` do the same (tier A).
4. **A line is deleted so two faces merge:**
   - Same colour: merge directly.
   - **Different colours: bowen decides.** Either delete both (bowen 1791386268), or the larger area wins (VGC, tier A; Illustrator, tier C).
5. **Ambiguity is decided once, at commit when the hand lifts.** It is not checked during a drag.

**4. Display**

- **Seams are not handled for now** (trap = null, bowen 1791385308).

### Decisions for bowen

- **A.** Merging two faces of different colours: delete both, or the larger wins?
- **B.** A manually chosen whole fill with a line added inside it: split into two as in item 3, or stay one piece because its outer ring has not changed?
  - Faces made by the bucket split as in item 3.
  - For manual whole fills, Claude leans towards **staying one piece**, so a whole-face gradient is not cut. bowen decides.

### Status

**Waiting for dot's independent review and bowen's two decisions.**

---

## Q14: Will a face-making app ever hit these fill problems?

**bowen** 1791388696:
> 有没有一种可能 我们这个捏脸为主的软件根本就不会遇到这些情况和问题。我们主要的填充是皮肤和阴影 都是一层一层单独定义叠放上去的。像live2d从来不会有我们这些困扰。

### Facts (Claude 1791388760)

**Statistics from bowen's v103 「基础脸模·正面·v1」, all 23 fills.** Each fill's `boundary` is grouped by the `strokeName` of its segments, and each segment is mapped to its layer:

- **All 23 fills are enclosed by exactly one closed stroke.** None uses two or more strokes.
- **None crosses layers.**

**So in this real drawing, every fill is a closed line's own fill, stacked layer by layer.** None of the problems from Q7–Q13 appears here: splitting a network into several regions, the θ shape, which colour wins on merge, and how a manual whole fill behaves after edits.

**Live2D (Claude's understanding, official docs not opened, unverified):** parts are bitmaps cut from a PSD and mapped onto deforming meshes. Fill is pixels, so the vector region problem does not arise.

### Judgement and suggestion

- **Simplest fill scheme:**
  - **Fill = an attribute of one closed line.** This matches the earlier "fill belongs to a closed curve" and memory "fill-is-attribute".
  - **Skin and shadow are separate closed lines, stacked by layer order.**
  - **A shadow sits on top of the skin, so there is no seam; trap is not needed.**
  - The current proto already supports a closed line's own fill (owner = path).
- **Two points still to watch:**
  1. **Shadow edge and face outline.** A shadow often follows the face outline. Drawn as a separate closed line, it can misalign with the outline during a head-turn. v103 bound such lines with endpoint links (this face has 4 links). This is a **connection** question, not a fill question.
  2. **Scope of the statistics.** Only this one front face was counted. Other drawings (hair, side face) were not.
- **Suggestion:** settle fill first as "a closed line's own fill + layer stacking". Set the network region-splitting scheme (Q8–Q13) aside until it is actually needed. **Waiting for bowen.**

### Q14 correction and merge (dot 1791388880; Claude re-checked by topology)

**dot:** grouping by `strokeName` cannot prove "one closed outline in topological terms". A name label is not topology.

**Claude re-checked by topology.** Each v103 curve record is one segment, with `nodes` [start, end] and the fill boundary's `reverse` flag.

- **All 23 fills:**
  - The boundary steps join end to start into **one closed loop**: each step's end node is the next step's start node, and the last joins back to the first.
  - **No segment or node repeats.**
  - **Every segment is in the same layer.**
- **Whether the loop touches other lines:**
  - 22 loops are **isolated**: every node on the loop has exactly 2 segments.
  - **1 is not:** 衣领与肩线 · 白底 has 3 nodes where other segments also attach. It sits inside a larger branching network.
- **More precise wording:** in this front face, every fill is one simple closed loop within one layer. 22 of the 23 are isolated loops, and 1 is embedded in a branching network.
- **This statistic only supports the conclusion.** The main reason for narrowing the scope is bowen's stated use (dot).

**dot's fill scheme for a face-making app** (Claude agrees):

1. **Skin and shadow are colour blocks the author creates explicitly.** Each has its own closed outline and appearance.
2. **Colour blocks stack by layer order.** When a shadow must stay inside the skin, use a mask.
3. **When face-shaping or a head-turn changes the outline, the fill follows.** No rescan of all lines, no automatic split or merge.
4. **A newly drawn decorative line does not cut an existing fill.**

**A closed outline may be several Bézier segments.** It does not need to be stored as one record.

**Live2D:** the official manual describes importing layered images and turning each layer into an ArtMesh for deformation, which keeps drawing and deformation separate. Source: <https://docs.live2d.com/en/cubism-editor-manual/concept-of-artmesh/>, given by dot. We can borrow that boundary without switching to bitmaps.

**dot independently checked the original v103 JSON (1791389059) and got the same result:**

- All 23 fills are each one closed loop of boundary segments joined end to start, and none crosses layers.
- 22 loops are isolated; the collar loop sits inside a larger connected network.
- **What this supports:** fills recognise only the boundary the author specifies. The network the boundary sits in does not have to contain only that one loop.
- **Limit:** the statistic checks node-and-edge connectivity only. It does not prove that no curve self-intersects geometrically.

**Status:** waiting for bowen to confirm this scope. The network region-splitting scheme (Q8–Q13) is set aside.

---

## Q15: bowen's fill proposal v3 — two ways to create, fill as its own element

**bowen** 1791389089:
> OK就是填充就是两种：1，单调闭合曲线（即一根线从头到尾）才能进行填充 填充完曲线和其他线条端点绑定成连续曲线也无所谓 反正是靠编辑顺序实现一组连续曲线上多个填充区间的实现的 2，手动指定一个闭合曲线进行填充（这个一般是应付跨图层曲线的填充） 这些都是填充建立的过程 而填充此时应作为element存在 因此可以显隐 删除。（就不和闭合曲线绑定了） 这个你们推敲攻击一下

### Restatement (to be confirmed by bowen)

- **"Monotone closed curve"** = one line joined end to start with no branches. It may be made of several Bézier segments.
- **The two creation methods differ only in how the boundary is chosen.** Once created, the data is the same: **one fill element that records which segments form its boundary.**
- **This changes bowen's earlier position.**
  - **Before:** "fill is an attribute of a closed path, not a separate object" (memory fill-is-attribute; v103 / §30.18).
  - **Now:** "fill is its own element, not bound to the closed curve".
  - **Recorded as "changed", not as a contradiction.**

### Claude's independent judgement (1791389133)

**Strengths:**

1. **"Which layer for a cross-layer fill" disappears.** As its own element, a fill has its own place in the layer tree.
2. **Cover order is the fill's position in the layer tree.** Neither "later covers earlier" nor "larger covers smaller" is needed (the Q9 conflict goes away).
3. **It matches mature tools:**
   - VGC's KeyFace is its own cell: it references its boundary cycles and has its own z-order (Q12, tier A).
   - **bowen's v103 does the same:** a fill is its own record with a name, can be selected and deleted, and its boundary is a list of segments (v103 inventory #104–110).
4. **Fill first, bind later:** the segments the fill references still exist, so it is unaffected.

**Points to settle:**

- **A. How far "not bound" goes.** Proposed reading: **its identity is independent** (shown, hidden, deleted and ordered on its own), but **its shape still references the boundary segments**, so it follows face-shaping and head-turns. If it stored its own copy of the shape, it would not follow edits; that would contradict "fill follows the outline" (Q14, dot point 3).
- **B. When the boundary is edited:**
  - **A point is added, or a segment is split in two:** the fill updates its boundary in place (VGC cut repair).
  - **A boundary segment is deleted, or the loop is cut open:** the boundary is invalid. Delete the fill, or keep it marked as invalid (it is now its own element)?
  - **The whole closed line is deleted:** delete the fill too, or keep it?
- **C. Picking.** Today clicking a fill area selects the line, because a path's own fill counts as part of the path (selection.ts:21-25). With a separate element, clicking the fill area **selects the fill itself**. The behaviour changes.
- **D. Copying.** Can a fill be copied without its boundary lines? The current new proto refuses this.
- **E. Figure-eight.** A single line joined end to start but crossing itself: does it count as a "monotone closed curve"?

### Status

**Waiting for dot's independent review, then merging.** bowen decides A–E.

## Q16: How v103 set up fills, and attacking it

**bowen** 1791389256:
> 你们回头看看旧版，看旧版是怎么设置的 然后攻击一下旧版

dot is checking the same code independently (1791389316); its result goes here when it arrives.

### What v103 does (Claude 1791389522; code at fixed SHA `7205381`)

**Conclusion first:** in v103 **a fill is already its own element.** This is essentially v3 method 2 (Q15), but without cross-layer support.

1. **Own record.**
   - `FillRegion` has a name, visible, locked, a colour (white / black / transparent) and an optional mist.
   - `boundary` is a list of segments, each with a direction (`CurveUse[]`).
   - The fill has its own slot in the layer item order. It is created directly behind its boundary strokes.
   - Code: `model.ts:60`, `paintCommands.ts:36`.
2. **Creation.**
   - The user selects the boundary curves.
   - The endpoints must coincide by coordinate (1e-7) and form exactly one loop with no branches. The curves must all be in the same layer. Anything else is refused.
   - Code: `paintCommands.ts:27`, `:40`.
3. **Shape** is recomputed from the boundary curves every time, so the fill follows line edits (`resolvedFillGeometry.ts:99`).
4. **Splitting a boundary curve:** the boundary is rewritten to the two halves and stays valid (`commands.ts:225`).
5. **Deleting any boundary curve** deletes the fill in the same edit (`commands.ts:146`).
6. **Dragging an endpoint apart so the loop breaks:**
   - The fill is kept, with the status "边界未闭合".
   - The hairstyle studio refuses to use it (`studio.ts:42`).
7. **Visibility** is independent of the strokes. The legacy `hiddenWithStroke` is migrated to `visible=false` on load (`model.ts:162`).
8. **Copy, cut and move to layer:** the fill goes along only when **all** of its boundary curves are selected; otherwise it stays (`clipboard.ts:12`, `commands.ts:207`).
9. **Transparent fill** cuts the other solid and mist fills in its own layer; strokes are kept.

### Attacks (Claude)

- **A. No cross-layer fill.** Cross-layer is exactly what v3 method 2 is meant for. Allowing it raises two questions:
  - Which layer does the fill sit in?
  - How is it ordered against strokes in the other layer?
  - The v103 rule "directly behind its boundary strokes" no longer works across layers.
- **B. "Loop no longer closed" has two different outcomes.**
  - Deleting a segment deletes the fill.
  - Dragging an endpoint apart keeps the fill and reports an error.
  - With v3's "not bound to the closed curve", should deleting a line still delete its fill? Decide this together with Q9's "ambiguity → destructive delete".
- **C. "Closed" is judged by coordinates, not by whether the endpoints are connected.**
  - Ends that look joined but are off by a tiny amount are refused.
  - Ends that coincide by accident count as joined.
- **D. Partial copy drops the fill silently.** Partial cut: see the follow-up checks below.
- **E. Fill shape depends on the stroke display computation.**
  - ARC joins borrow geometry from display routes (`resolvedFillGeometry.ts:13-60`).
  - So fill computation is coupled to the hide/show interval machinery, which was v103's performance bottleneck.
- **F. Colours are only white, black and transparent, plus mist.** Skin and shadow need colour and gradients.
- **G. Figure-eight:** see the follow-up checks below.

**What this means for v3:** v103 already shows that "own element + references its boundary segments + own slot in the layer order" works. v3 adds two things:
- method 1, one-step fill of a single closed line;
- cross-layer fills.

The decisions for bowen are A and B.

### Follow-up checks (Claude 1791389602)

- **D, partial cut (worse than "silently dropped"):**
  - A cut is copy-then-delete.
  - The delete removes every fill that references a deleted curve. But the fill is not in the clipboard, because not all of its boundary was selected.
  - So **after paste the fill is gone.** Only undo brings it back.
  - Code: `clipboard.ts:12`, `:24`; `commands.ts:146`.
- **Broken loop display:** the fill stays in the data but is **not drawn** (`PaintScene.tsx:60`). To the user, "deleted line" and "dragged apart" both look like the fill vanished; the difference is only whether the data survives.
- **G, figure-eight:**
  - Solid fills use the even-odd rule (`PaintScene.tsx:67`).
  - A plain figure-eight fills both lobes.
  - A line that loops twice over itself leaves the overlap as a hole.
- **Picking (relevant to Q15 C):**
  - Clicking a solid fill's area selects the fill itself, not the line (`PaintScene.tsx:67`).
  - A transparent cutout can only be picked by its edge.

### dot's independent check (1791389703; source reading, v103 not run)

**Core:** independent fill element + explicit boundary references + its own layer order. v103 does not rescan the whole network to decide what is filled.

**Three attacks:**

1. **Partial cut loses the fill.**
   - The clipboard takes a fill only when all of its boundary is selected.
   - The delete step removes the fill as soon as any one boundary edge is deleted.
   - Each rule makes sense on its own; together they lose content.
2. **"Independent" fill, but not independent movement.**
   - Moving a selected fill (for example with the arrow keys) moves its boundary curves.
   - Where nodes are shared, unselected branches are pulled along too.
   - The user selected the fill, but the edit includes the source lines. There is no fill-only geometry transform.
3. **Cross-layer is not fully unsupported.**
   - Creating a fill requires the boundary to be in one layer.
   - After creation, the fill can be moved to another layer and still reference the original layer's lines.
   - Deleting the source line then deletes that fill in the other layer, and copying may be refused because of the cross-layer dependency.
   - What is missing is a consistent set of cross-layer rules, not the ability to reference across layers.

**Facts to state precisely:**
- Closure is judged by a coordinate tolerance; shared node ids are not required.
- A broken fill that is kept has a diagnosis in the sidebar.
- Adding points and splitting update the boundary references. Normal line deletion cleans up dependants. There is no evidence of dangling references.

**Conclusion:** the fill representation works. The weak points are the unified meaning of related operations (cut, move, cross-layer). Fixing them does not need an automatic face system.

### Claude's corrections after dot's check (1791389734)

- **dot points 2 and 3 confirmed in code:**
  - Moving a fill moves its boundary curves: `movement.ts:11-13`.
  - A sidebar drop moves a fill alone to another layer with no boundary-layer check: `paintCommands.ts:76` `movePaint`, called from `dropPaint`.
- **Attack A rewritten:** cross-layer is refused only at creation. After creation a fill can already reference another layer. The missing piece is a consistent cross-layer operation rule.
- **"Broken looks the same as deleted"** is true only on the canvas; the sidebar shows "边界未闭合".
- **Merged view (Claude and dot agree):** the representation is usable. The open work is consistent rules for cut, move and cross-layer. bowen still decides B (delete a line → delete its fill or keep it invalid).

### Status

Claude and dot agree on the facts and the conclusion. Waiting for bowen on A (cross-layer rules) and B.

## Q17: Should cross-layer fill be supported at all?

**bowen** 1791389840:
> OK 我想起来了 旧版跨图层填充靠的是两侧分别填充 然后叠放。那有没有可能跨图层填充就是不应该支持的？ 成熟方案有支持这个的吗？

### Claude's independent judgement (1791389880)

**Short answer:** none of the checked tools fills a single region whose boundary is assembled from lines in different layers. To fill across objects, they either merge the geometry into one object first, or fill each part separately.

**What each tool does:**

| Tool | Behaviour | Evidence |
|---|---|---|
| Figma | Regions exist only inside one vector node's network. Merge or flatten first. | public API `VectorNetwork.regions`, tier B |
| OpenToonz | Regions are computed per vector image, and only strokes in the same group are intersected. | `tcomputeregions.cpp:2285` |
| Graphite / Paper.js | One fill per item. Crossing paths need one compound path. | `CompoundPath.js:17-25` |
| Synfig (closest) | The fill is its own Region layer whose spline is **linked** to the outline layer's spline. | `layermakebline.cpp:203-209` |
| Illustrator Live Paint across layers | **Not checked.** | — |

- **The Synfig limit:** the link covers one whole spline, not a loop assembled from pieces in several layers. Per-vertex linking could do it in theory, but no evidence was found that this is a normal workflow.
- **Recommendation:** do not support cross-layer fill. bowen's v103 practice, filling each side separately and stacking, is the mature-tool practice. The overlap also avoids the seam problem (Q8).

**If adopted:**

1. **Close the v103 loophole** (dot, Q16): a fill could be dragged alone to another layer afterwards. New rule: **a fill always lives in the layer of its boundary lines.** It moves with them, or the move is refused.
2. **v3 method 2 (manual loop pick) remains, with a new purpose.** It is no longer for cross-layer fills. It picks one loop out of a branching network in the same layer. Example: the outer loop of a θ, which method 1 (a single closed line) cannot select.

### Correction after dot's check (dot 1791390455; Claude verified in source)

**The "no checked tool supports it" framing was too strong.** Inkscape has dedicated linked-fill path effects that do it:

- **Fill Between Strokes:**
  - References two independent source paths.
  - Converts each into the fill object's coordinates, handling different parent containers; layers are parent groups in Inkscape.
  - Code: `lpe-fill-between-strokes.cpp:23-24`, `:115-120`.
- **Fill Between Many:**
  - References any number of source paths (`lpe-fill-between-many.cpp:34`).
  - The fill is its own object, with its own z-order, in any layer. This is close to v103's `FillRegion`.
- **Cross-layer UI behaviour not tested.**

**Corrected statement:**
- Figma, OpenToonz, Graphite and Paper.js do not support cross-layer fill.
- Inkscape supports it through a dedicated linked-fill effect.
- **The recommendation stays, but the reason changes:** not supporting cross-layer fill follows from our product scope (bowen fills each side and stacks). It does not follow from "no precedent in the industry".

### Status

Recommendation unchanged, reason corrected. bowen decides.


## Q18: Back to "fill is an attribute of a closed curve", with closed curves enumerated

**bowen** 1791390174:
> 那么针对填充我们的知识图谱是不是可以确定了。它就不支持跨图层。然后如果不支持跨图层那它还有必要单独成为element吗？还是说就是闭合曲线的属性就好了？ 然后既然说了闭合曲线是连续曲线的子集， 那么在图层-连续曲线-闭合曲线这样的展示范围里可不可以一旦连续曲线里出现了像theta这样的形状那么连续曲线里自动穷举出所有的闭合曲线。（即一个element可以同时出现在多个连续曲线里） 这我觉得没什么毛病，一个图层里出现了多次同一条曲线，这只是ui展示方式 它们本身的引用还只是一个。这样填充就和闭合曲线完整绑定了

### Claude's independent judgement (1791390231)

**Verdict:** a fill can be an attribute of a closed curve, and enumerating the closed curves holds up.

**Why it works:**

1. **Storage is almost the same either way.** A closed curve can only be stored as "which segments enclose it", and that is what a v103 fill stores (Q16). "Own element" and "attribute" differ in only three things:
   - who owns paint order;
   - whether the fill dies with the loop;
   - where it is listed.
2. **Stable, unlike "minimal regions only".**
   - Adding a line inside a θ leaves existing loops, and their fills, intact.
   - A loop disappears only when one of its segments is deleted or disconnected. Its fill then goes too, which matches "ambiguity → destructive delete".
3. **Closure is decided by real connection** (shared endpoints), not by coordinates. This removes Q16 attack C.
4. **Showing one segment under several loops is only display**; the reference stays single. Agreed.

**Attacks:**

- **A. Paint order (most important).**
  - As an attribute, a fill is drawn directly under its own group of lines.
  - v103 could reorder a fill on its own, for example putting a shadow fill under another group's lines. An attribute cannot do that, so "colour below, line art on top" means separate layers. That is the same as bowen's "fill each side, then stack".
  - Acceptable in Claude's view. **bowen to confirm:** is there any case where a fill must sit between other lines?
- **B. Several fills in one group.** Example: a θ with both the left loop and the outer loop filled. v3's "by editing order" needs an order stored in the attribute, and that order must be adjustable.
- **C. The number of loops can explode.**
  - Up to 2^k − 1 loops, where k = segments − endpoints + 1.
  - A θ has 3. A 2×2 grid has 13. A hair network with many crossings may have hundreds.
  - Suggestion: list only filled loops. Compute the others on demand, for example hover highlight and click to fill, like Figma's paint bucket. The loops do not need to be stored.
- **D. Picking.** A point in the θ's left half is inside both the left loop and the outer loop.
  - Proposed rule: select the topmost **filled** one; if none is filled, select the smallest loop.
  - bowen to decide.
- **E. Figure-eight through one shared endpoint.** Counted as loops that do not revisit an endpoint, it is two loops, each filled on its own. The whole 8 is not one loop.

**Summary:** "no cross-layer + fill is an attribute of a closed curve + closed curves enumerated on demand" holds, provided bowen agrees to A (a fill only sits under its own lines) and decides D (picking). Graph rows wait for bowen.

### dot's independent review (1791390408)

Agrees a fill can be a closed-curve attribute. Turning a fill off or clearing it is an operation on the loop, with no separate element. Not supporting cross-layer does not by itself decide element vs attribute; both organisations work. Agrees that showing a segment under several loops is a reference, with geometry stored once.

**Four attacks:**

1. **Discovering every loop is not the same as enumerating all of them on each edit and filling the list.**
   - Keep "any loop can be picked".
   - Discover unused loops on demand.
   - Always show filled loops.
2. **A filled loop must keep its identity and boundary.**
   - Example: the outer loop is filled red and a chord is added. The red must not jump to the upper loop because re-enumeration renumbered the loops.
   - Adding a point updates the loop's boundary; it is not "old loop gone, colour deleted".
   - "Unused candidates can be computed" does not mean "filled loops need not be stored".
3. **Repeated listing must not become repeated drawing.**
   - The θ middle line is drawn once, otherwise translucent strokes darken.
   - Deleting the shared line from one row affects both loops. The user must not think only that row was deleted.
4. **Ownership and paint order are separate.**
   - "An attribute can only be drawn directly under its own lines" (Claude A) is not a necessary limit.
   - Loop fills can have an order, and strokes their own drawing rule.
   - Whether line art always sits above colour is a product rule to decide separately.

**Core accepted:** same-layer shared curves form a network; closed loops reference its segments; fills hang on loops.
- **Must keep:** stable loop identity, fill order, and one copy of each shared line.
- **Should not be an architectural requirement:** "exhaustively enumerate all loops".

### Claude's response (1791390428)

- **Point 4 accepted; Claude's A was an overclaim.** It becomes a product choice for bowen:
  - **甲:** a fill is fixed directly under its own lines. Simple, but it cannot go under other lines.
  - **乙:** fills have their own adjustable order in the layer, as in v103.
- **Point 2:** "loops need not be stored" meant unused candidate loops only. Filled loops store their identity and boundary segments. Adding a chord does not move the colour; adding a point updates the referenced segments.
- **Point 3:** agreed. One drawing per line. Deleting a shared line warns which loops are affected.
- **Point 1:** agreed; same as Claude's C. The architecture requires only "any loop can be picked", not exhaustive enumeration.

**Joint conclusion (Claude and dot):** same-layer lines sharing endpoints form a network; closed loops reference its segments; fills hang on loops. Three guarantees:
- stable loop identity;
- fill order;
- one copy of each shared line.

### dot addendum (1791390455)

Because loops are discovered automatically, "delete loop" without changing any line would be rediscovered next time. The entry must be called **"clear fill"**; deleting curves is a separate action.

Claude agrees. There are only two operations: **clear fill** and **delete curve**.

### bowen's answers (1791390533)

> A可以调整闭合曲线的顺序 那么填充就自然带顺序了。B本来就设定过图层和里面的element都是order list  C我们就不可能存在特别复杂的环出现在同一个图层的同一组连续曲线里。D 点选默认选小的 想要去填充大的去旁边的list里面去找。那么指定边缘填充也不用了。E 8字形那一定是这个图画错了或者deform过于扭曲了。爱怎么填怎么填 反正这肯定不对劲

### Claude's restatement for bowen to confirm (1791390562)

1. **Fill is a closed-curve attribute.** It can be shown, hidden or cleared. There is no "delete loop"; a loop goes away only when a curve is deleted.
2. **All closed curves are found automatically** from the continuous curve and listed in the side list.
   - A segment may appear under several loops.
   - It is stored once and drawn once.
3. **Layers and their elements are ordered lists.** Closed curves have an order in the list; reordering a closed curve reorders its fill.
4. **Canvas click selects the smallest loop.** Larger loops are picked from the side list.
5. **Manual boundary picking is no longer needed.**
6. **No cross-layer fill.**
7. **A figure-eight is a drawing error** and gets no special handling.

**Completion proposed by Claude, pending bowen:** where do lines sit in the order? The θ middle line belongs to two loops but is drawn once. Proposal:
- a continuous curve's lines are drawn above all of its own fills;
- continuous curves are ordered in the layer list;
- closed-curve order only decides which fill covers which inside one continuous curve.

**Correction (dot 1791390661; Claude agreed):** this is a **new rule**, not v103's. v103 only places a new fill directly behind its boundary strokes at creation (`paintCommands.ts:36`); afterwards it can be reordered freely.

**Effect of the new rule:** even if the θ outer-loop fill is ordered last, it never covers the middle line. To make the middle line disappear, hide its stroke. The other answers stand and need no re-confirmation.

### dot (1791390592)

dot's six-point summary matches Claude's seven points.

**Required correctness, not a choice:** a filled loop keeps its identity and colour after adding points or binding other lines.

dot also asked Claude to write the formal graph now. Claude declined (1791390610): graph rows wait for bowen's explicit go-ahead (1791382929), and the line-order completion is still unanswered.

### Status

### bowen on line order (1791390897)

> theta中间线它本身就不会被两边的填充遮挡。而作为线，一般也不会严格分析线与线之间的遮挡关系。遮挡关系是在需要分析时候查一下list（是这样吧？） 然后基本不会出现同一套连续曲线里， theta中间的线和同组的线（还要不同颜色）进行遮挡分析，而任何其他的线或者填充，在list上的先后关系都会很清晰。

**Claude's confirmation (1791390916):** yes. Drawing goes bottom-up through the list, so who covers whom is just list order; there is no separate occlusion analysis.
- **One continuous curve:** its fills are drawn first, then its lines together. The θ middle line is above both fills.
- **Lines within one group:** drawn together, with no line-over-line ordering. Same-group, different-colour overlap is not expected and gets no special handling. If it happens, a fixed internal order keeps the result deterministic.
- **Everything else:** list order.

The fill layer is complete. Waiting for bowen's "写" to add graph rows.

Graph rows wait for bowen's "写".

## Q19: Is "one endpoint, many lines" the only thing left in point / line / face?

**bowen** 1791390987:
> 写吧 这样点线面就只差一个端点多条线需要处理吧？其他的关系都无法攻击了吧？

Fill rows were written to the graph in `cb93586`.

### Claude (1791391051) and dot (1791391029)

**Not the only one.** dot found no contradiction that would overturn the point / segment / loop / fill structure for the current scope. Open items:

**Endpoint group:**

1. **3 or more lines at one endpoint.** Which lines are joined smoothly, which handles move together, and which only share a position. v103 stored joins pairwise. (Q7 A2)
2. **End stroke at a shared endpoint.** Does the taper apply there, or the join? v103 could turn on a taper at an interior end. (Q7 A3)
3. **Two groups joined by sharing an endpoint.** How do their list positions and fill orders merge? (dot 1791391029)

**Line group:**

4. **Stroke along a whole line.** Tapers and show/hide intervals need a direction and a route across segments and branches. v103 stored an explicit route. This is tied to show/hide interval performance. (Q7 A4)
5. **Endpoints linked across layers.** Lines stay in their own layers and only the ends are linked (bowen's binding / linkage decision). The graph has no "linked but not shared" relation yet. (Q7 A5)

**Editing rules (dot 1791391029):**

6. Rules that must be written down and later verified:
   - a loop keeps its identity after a point is added;
   - which fills are affected when a shared line is deleted;
   - undo restores the exact previous state.

   They are editing-operation rules inside this structure; nothing so far requires a different point / line / face model.

### Status

Waiting for bowen to choose which group to start with (asked in 1791391085).

## Q20: When a loop becomes invalid, and reducing points by endpoint binding

**bowen** 1791391384:
> 环什么时候失效， 删掉合围曲线的任意一根就失效，填充也消失。你们的顾虑我懂 可能在脸上线条先加了点 后面又想删除 结果填充要重做。而正确的减少闭合曲线端点数量的方式是， 将闭合曲线上两个相邻端点合并（端点绑定） 这样就减少了端点数量还没破坏闭合区间 然后同一条bezier曲线两端端点绑定的动作就是删掉这条曲线（因为端点绑定会删除一个端点。按照旧版规则删除后绑定的那个端点

The graph row "Closed curve becomes invalid when" is rewritten to bowen's wording (it replaces dot's 1791391113 wording).

### Claude (1791391436)

**v103 check:**

- `connect` keeps the first-clicked endpoint's node. It moves the second endpoint's node onto it, rewrites references, and deletes the second node (`7205381:src/domain/drawing/commands.ts:102-110`). This matches bowen's "delete the later-bound endpoint".
- **Difference:** binding the two ends of the **same** curve does not delete the curve in v103. The code leaves the curve with both ends on one node, a small loop. "Binding a curve's own two ends = deleting that curve" is a **new rule**. Claude finds it more reasonable than v103, and consistent with the goal of reducing points.

**Cases derived from the rule (bowen to confirm):**

1. **A loop of 3 segments**, binding one segment's two ends:
   - That segment is deleted, and its neighbours' ends move to the kept point. Handles translate with them, so the shape changes only locally.
   - 2 segments remain and the loop stays closed. **The fill is kept.**
2. **A loop of 2 segments**, binding one segment's two ends: one curve remains, with both ends on one point. Does it still count as a closed curve that keeps its fill?
3. **The θ middle line**, binding its two ends:
   - The middle line is deleted, and its two circle points merge into one.
   - The upper and lower loops stay closed and keep their fills.
   - The outer loop becomes a figure-eight through one point twice. Per Q18 E that is a drawing error, so a fill on the outer loop becomes invalid?

### dot (1791391503)

The rule holds. There are two distinct actions:

- **Deleting a boundary segment:** the loop breaks and its fill disappears.
- **Merging adjacent endpoints:** the two points become one, the segment between them is removed, and the remaining boundary is reconnected. A loop that is still closed keeps its fill.

**Endpoint binding must be one complete operation.** Removing the middle segment internally must not trigger "delete line → delete fill" before the remaining boundary is reconnected. The same applies to adding a point (splitting). This is an implementation rule; the user does nothing extra.

**Only closure is preserved, not the exact outline:** nearby curves change shape.

**Case 3 overreached.** bowen said such error shapes get no special care; he did not say self-intersection deletes the fill. **Case 2** (whether the remaining self-loop is kept) is the real boundary to settle.

### Claude agrees (1791391525)

**Case 3 corrected:**
- By bowen's rule a loop becomes invalid only when one of its curves is deleted.
- The outer loop's two arcs still exist, so the loop stays valid and **keeps its fill**.
- How it draws now that it passes through one point twice is "爱怎么填怎么填": no special handling, and no automatic deletion.

### bowen's decision (1791391694)

> 2造成了单独bezier曲线成环的情况，这是我没想过的 也几乎不会用到 但是为了工具的一致性 我会认为这样成立 这也是唯一制作单线成环的方法。 3也不失效 这也作为一种特殊的编辑方法。基本上不会用但是为了工具一致性保留

- ~~**Case 2 holds.** The remaining single curve, with both ends on one point, is a closed curve and keeps its fill.~~ **Superseded by Q22:** binding deletes both curves, and no single-curve loop exists.
  - This is the only way to make a single-curve loop.
  - Binding a free curve's own two ends deletes it.
- **Case 3 does not invalidate the loop.** It is kept as a special editing method, for tool consistency. **Narrowed by Q22:** this holds only when the arcs have intermediate points. In a minimal θ every line runs directly between the two points, so all of them are deleted.

> **Note (Q22):** the case 2 and case 3 derivations above silently assumed that only one curve is deleted. **Superseded by Q22 (bowen 1791392871 chose 甲):** binding deletes every curve whose two ends land on one point. A 2-curve loop and the θ are deleted entirely, and no single-curve loop exists.

### Claude (1791391716): one ambiguity in case 2

- In a 2-segment loop, both s1 and s2 have A and B as their ends. "Bind A and B" alone cannot tell which segment to delete.
- v103 avoids this: an endpoint is `{curveId, end}`, a curve end rather than a point.
- **Proposal:** binding acts on curve ends. Where several curves share a position, the end the user clicked decides which curve is meant.
- **Status: waiting for bowen.**

### dot (1791391744)

- **Explicitly supported editing results:**
  - A closed loop may consist of a single segment (case 2).
  - A closed loop may pass through the same endpoint twice (case 3).
- **Implementation rule:**
  - A bind removes only the collapsed segment.
  - It must not rescan and delete other curves that have just become "both ends on one point". Doing so would destroy the confirmed single-segment loop and the θ special edit.
- **The Q18 E row is not a reason to exclude such loops.** It covers geometric self-crossing caused by bad drawing or deformation, with no special handling. A loop that revisits a shared endpoint, as in case 3, is a supported result.

### Status

**Superseded by Q22** (bowen 1791392871, 甲). The curve-end question is dissolved, because binding acts on points and deletes every curve whose two ends land on one point. Binding rules are in the graph (`941bfeb`).


## Q21: Any attacks left on fill / loop / binding?

**bowen** 1791391864:
> 这回还有攻击方案了吗？

### Claude (1791391895)

**1. Unbinding (a real gap).**
- The rule is "a loop becomes invalid when any of its curves is deleted". Unbinding breaks a loop without deleting any curve: it splits a shared endpoint back into two separate ends (v103 `unbind`, `7205381:src/domain/drawing/commands.ts`).
- Options for the fill:
  - **甲:** same as deleting a line; the loop is invalid and the fill disappears.
  - **乙:** refuse to unbind while a filled loop passes through that endpoint, and warn the user.
  - **丙:** keep the fill but do not draw it until the endpoint is rebound (v103's "边界未闭合" state).
- **Claude prefers 甲:** one rule, "the loop is no longer closed → the fill is gone", exactly like deleting a line.

**2. Consequence of 1: moving part of a loop to another layer.**
- Endpoints cannot be shared across layers, so this action contains an unbind and follows rule 1.
- Alternative: do not allow moving only part of a loop.

**3. Partial cut.**
- A cut is copy-then-delete. Cutting part of a loop invalidates it and its fill disappears. Pasting brings the lines back but not the fill.
- This is consistent with "delete a line → invalid"; the user just needs to know that cut-and-paste loses the fill.
- Undo restores everything, and cutting the whole loop carries the fill along.

**Also pending:** the curve-end question from Q20.

Apart from these, Claude finds no further attack on the fill / loop / binding layer.

### dot (1791391965)

No hard contradiction that overturns the structure; there are a few operation boundaries.

- **Unbind:**
  - "Deleting an edge invalidates the loop" holds, but it cannot be the only invalidation condition.
  - Proposal: when an unbind really breaks a filled loop's closed boundary, clear that fill. Unbroken loops are unaffected.
- **Moving part of a boundary to another layer:**
  - This violates "no cross-layer fill", so either refuse the move, or move and clear the affected fill.
  - Claude's "it necessarily means an unbind" does not follow: cross-layer endpoint linkage has not been discussed yet.
- **Two curves joining the same pair of endpoints:** the operation must name the target segment explicitly; the program must not guess.
- **Partial cut losing the fill** follows from "deleting an edge invalidates", so it is not a structural contradiction. Show the impact before the operation; undo restores fully.

### Claude agrees (1791391979)

- The point 2 overreach is corrected.
- dot's unbind wording ("clear only the fills whose closed boundary is actually broken") is more precise than Claude's 甲.

**Three decisions for bowen:**

1. When an unbind breaks a filled loop: clear that loop's fill (Claude and dot lean this way), or refuse the unbind?
2. When part of a loop's lines is moved to another layer: refuse, or move and clear the fill?
3. When two curves join the same pair of endpoints, the curve end the user clicks decides which curve a bind deletes; the program never guesses. Agreed?

### bowen (1791392233)

> 1选甲 这是原则决定的行为。2没看懂 举个例子。3. 绘制操作不存在剪切 要么复制完回来删除要么复制。录制间的剪切粘贴是我为了将线带着id转移过来。这个操作未来还需要捋顺。

bowen's numbering follows Claude's first Q21 message (1791391895).

- **1 (unbind): 甲.** Unbinding that breaks a loop clears that loop's fill, "by principle".
- **2 (part of a loop to another layer):** bowen asked for an example.
- **3 (cut): drawing has no cut.**
  - There is only "copy", and "copy, then delete", which follows the delete rule.
  - Cut-and-paste between recordings exists to carry lines over with their ids. It needs to be sorted out later.

### Claude's example for 2 (1791392256)

**Example:**
- A face layer has a closed loop made of a cheek line, a jaw line and an ear line, filled with skin.
- bowen selects only the jaw line and moves it to a "chin" layer.
- The loop's three lines are now in two layers, so under "no cross-layer fill" the skin fill has no valid home.

**Two ways to handle it:**
- **Refuse:** "this line is part of a filled loop and cannot be moved alone". Move the whole loop, or clear the fill first.
- **Move and clear:** the jaw line moves and the skin fill is cleared, as with delete and unbind.

**Side question, left for later:** does the shared endpoint between the jaw and cheek lines break, or become a cross-layer link? This belongs to the cross-layer endpoint item.

**Still pending:** for two curves joining the same pair of endpoints, the curve end the user clicks decides which curve a bind deletes.

### bowen (1791392314)

> 让你选甲是我希望你按照原则把代码写出来 甲是自然出现的结果。而不是你设置一个corner case

### Claude (1791392332): one principle, no special cases

After each complete edit, a fill exists if and only if its loop still exists: its segments still connect end to end, close, and all lie in one layer.

- **Delete, unbind, copy-then-delete:** no per-operation handling. The result follows from the principle.
- **Binding** is one complete operation. The loop is still closed afterwards, so the fill stays.
- **Adding a point** replaces the loop's reference to the split segment with the two new halves, so the loop still exists.
- **Item 2 follows too:** moving part of a loop to another layer means the loop is no longer in one layer, so the fill is gone. No separate refusal rule is needed. A warning before the move would be UI only and would not change the rule.
- **Asked bowen to confirm.**

### dot (1791392383)

Agrees: the object relation decides the result. A fill depends on its closed loop; if the loop does not hold, neither does the fill.
- Maintain this relation once, after each complete edit.
- Adding a point or merging endpoints first updates the existing loop's boundary references, then checks whether the loop still holds.
- Do not find some new loop and move the old colour onto it.

### bowen (1791392425)

> 2的例子同样，软件设计原则是不阻止行为但是展示后果。按照原则写的代码 在2的例子里 你复制过去对于原本图层，你如果是复制过去 那原本图层线条还是闭合， 你如果是复制完再删除 那原本图层就删除了。还需要解释吗？

**General design principle (bowen): do not block an action; show its consequences.**

"Move to another layer" is not a separate primitive. It is either copy or copy-then-delete:
- **Copy only:** the original layer's lines remain, the loop stays closed, and the fill stays.
- **Copy, then delete:** the original line is deleted, the loop is no longer closed, and the fill is gone.

### Claude (1791392438)

Understood. Following the same reasoning: every endpoint is the end of a specific curve. A bind acts on the end of the curve the user clicked, and that curve is the one deleted, so the program never guesses. Recorded this way unless bowen objects. *(Withdrawn; see Status.)*

### Status

- 1: decided (甲, as a natural result of the principle, not a special case).
- 3: decided (no cut in drawing; cross-recording cut-and-paste comes later).
- 2: decided. Move = copy or copy-then-delete; the result follows from the principle. Do not block; show consequences.
- Curve-end question: **dissolved by Q22** (binding acts on points). Earlier status: open, moved to the endpoint round (dot 1791392483). A point and "the end of a specific curve" still have to be distinguished at a shared endpoint with several lines, and this does not follow from the copy/delete decision. Claude withdrew "recorded unless bowen objects".

## Q22: Binding A and B when several lines connect them, derived from the code

**bowen** 1791392558, 1791392665:
> 绑定线那个我没看懂。我们删除只能删除线， 能删除端点的只有绑定端点。你要问什么？
> 如果我对这个情况不适配 那么我绑定端点后会出现什么情况？ 按代码来 你推演一下

### Claude (1791392718): derivation, and a correction to Q20

**Correction.** Q20's cases 2 and 3 silently assumed that only one line is deleted. That is already a special case.

**v103 code as it is** (`7205381:src/domain/drawing/commands.ts:102-110`, binding A and B):
1. Node B moves to A's position.
2. Every curve end on B is rewritten to A, and node B is deleted.
3. **No curve is deleted.** `clean()` only drops nodes no curve uses (`commands.ts:18`).

So a lemon (upper and lower arc, both A→B) becomes two petals: both arcs become loops with both ends on A.

**bowen's new rule applied with no special case:** after a bind, every curve whose two ends land on the same point is deleted.

- **Lemon:** both arcs have ends A and B, so both are deleted. The whole lemon and its fill disappear.
- **θ (Q20 case 3 was wrong):** the upper arc, lower arc and middle line all end at the circle points P and Q. Binding P and Q deletes all three, so the whole θ disappears.
- **Loop of 3 or more segments:** only the collapsed segment ends on both points, so only it is deleted and the loop stays. Unchanged.
- **Consequence:** under this rule a single-curve loop can never be made. Every loop has at least two curves.

**If a bind acts on the clicked curve's end:** only that curve is deleted, and the others become single-curve loops. This gives the Q20 cases 2 and 3 results bowen confirmed, but it is an **added** rule, not a derived one.

**Choice for bowen:**
- **甲:** the general rule. Every curve whose two ends are bound to one point is deleted.
  - The rule is simple.
  - No single-curve loops can exist.
  - Binding the θ middle line's ends deletes the whole θ.
- **乙:** a bind deletes only the clicked curve.
  - Single-curve loops and the θ special edit work.
  - It needs one extra rule: "the clicked curve end decides".

### bowen's decision (1791392871)

> 显然是甲 不过你再仔细解释下 我没想明白为什么都没了

**Decided: 甲.**

### Claude's explanation (1791392896)

**Key point:** a bind acts on **points**, and a point is shared by every line that ends there. Binding A and B binds both ends of **every** line running between A and B.

- **Lemon** (points A and B only):
  - Both arcs run A–B.
  - Binding B onto A rewires every end at B to A.
  - Each arc now has both ends on A, so both are deleted. Nothing remains.
- **θ** (points P and Q only):
  - The upper arc, the lower arc and the middle line all run P–Q.
  - Binding Q onto P deletes all three.
- **Triangle** (A, B, C; lines AB, BC, CA). Binding C onto B:
  - Only BC runs between B and C, so it is deleted.
  - CA becomes BA; AB is unchanged.
  - Two lines remain between A and B, forming a lemon. The loop stays closed and the fill stays.
  - Binding the lemon's A and B then deletes everything.

**Effect:** reducing points by binding goes down to at least two lines; one more bind deletes the shape. No loop made of a single line exists.

### Status

### dot's qualification (1791392923)

**Lines disappear because they connect the same pair of points, not because they shrank to nothing geometrically.**

Only the minimal θ disappears entirely: each of its three lines is one Bézier running directly A–B. If the upper arc has a middle point C (A–C and C–B), binding B onto A turns it into A–C and C–A. Both segments still have distinct ends, so they survive as a loop.

So "binding the θ middle line's ends deletes the whole θ" holds only when every line connects A and B directly.

**Decided (甲).** Q20 cases 2 and 3 are superseded:
- no single-curve loop exists;
- binding the ends of the middle line of a minimal θ (every line runs directly A–B) deletes the whole θ; arcs with intermediate points survive.

## Q23: One endpoint, many lines, derived from existing rules

**bowen** 1791393203:
> 这种推演才是我想要的。你们要不要试着这个方式推演一下一个端点多条线？

### Claude's derivation (1791393260, addendum 1791393280)

**Premises already in the graph:**
1. A line has two endpoints and two handles; each handle belongs to its end.
2. Endpoints have an end stroke; lines have a line stroke.
3. A shared endpoint has a join that constrains the angles of the two sides' handles.
4. Binding keeps the first point, deletes the later one, and re-attaches its lines.

**Derivation:**

1. **N lines at a point means N handles.**
   - By premise 1, a handle belongs to "this end of this line", not to the point.
   - Binding only changes which point a line end is attached to, so handles stay with their lines.
   - An "endpoint" is therefore two layers:
     - **the point:** a shared position;
     - **the line ends:** one per line, each carrying its own handle.
2. **Dragging the point** moves all N line ends and translates their handles (v103 `moveNode`).
3. **Where the join lives.**
   - Premise 3 is about "the angles of the two sides' handles", i.e. a relation between **two line ends**.
   - With two lines this looks like a property of the point. With N lines it generalises to: **any two line ends at the same point may have a join**.
   - A join belongs to a pair of line ends, not to the point.
4. **A corner needs no record.** A corner means no angle constraint, i.e. no join between those two ends. Only "smooth" constraints need recording.
5. **Dragging a handle.**
   - A handle joined smoothly to the dragged one turns to the opposite direction. A third handle joined smoothly to that one turns as well.
   - The constraint **propagates along smooth relations** with no extra rule. v103 already computes smooth components when dragging a handle (`moveHandle` → `drawingSmoothComponents`).
   - **Result:** if A–B and A–C are both smooth, then B and C point the same way. This is a smooth fork, like a strand of hair splitting. It is geometrically valid, so under "do not block" it is allowed.
   - **v103 did not allow it:** `connect` limits each line end to one join and refuses with "端点已与另一条曲线接笔".
6. **End stroke.** By premise 2 it belongs to the line end, so N lines at one point each keep their own end stroke. Binding deletes only the point; end strokes on line ends remain.
7. **Deleting a line** removes its line end and, naturally, the joins on that end.
   - If no line remains, the point disappears.
   - If one line remains, it becomes a free end.
8. **Loops and fills are unaffected by joins.**
   - Loops depend only on shared points (graph); joins only constrain angles.
   - So a continuous curve is defined by shared points, not by joins.
9. **No line is joined to itself.** Q22 rules out single-line loops, so a line's two ends never share a point.

**Addendum: contradictory smooth cycles (1791393280).**
- v103 builds smooth relations into components with a same/opposite sign per handle and reports "conflicting handle directions" (`7205381:src/domain/drawing/smoothHandleAuthoring.ts:7-19`).
- **Example:** A–B smooth (opposite) and B–C smooth (opposite) imply A and C point the same way. Adding A–C smooth then demands opposite. Both cannot hold.
- **General rule:** a cycle of an odd number of smooth relations is always contradictory; an even cycle is fine.
- This is an impossibility that follows from the rules, not an added special case. "Do not block, show consequences" meets a consequence that cannot exist.
- **bowen to decide:** refuse adding that relation, or allow it and mark the conflict in red?

**For bowen to confirm (Claude's added assumptions):**
- **Step 1:** handle and end stroke belong to the line end; position belongs to the point. Is that the right reading of "端点具有笔触属性"?
- **Step 3:** a join is a relation between two line ends, not an attribute of the point.

**Aside:** a smooth pair at a fork can later decide which branch a stroke follows (the "line group" item). Not expanded here.

### dot's independent derivation (1791393337)

The result is essentially the same as Claude's. Key separation: **shared points decide "joined together"; join relations decide "how they join".**

**Three handles A, B, C at one point:**
- A–B smooth: A and B are opposite; C is free.
- Add A–C smooth: B and C are both opposite to A, so they point the same way. This is valid, and the curves can still bend apart later.
- Add B–C smooth: this demands B and C be both the same and opposite. With non-zero handles there is no solution. This is the real conflict.

**Four lines** can form two pairs, A–B and C–D, each smooth, with free angles between the pairs. No special behaviour for three-way or four-way forks is needed; only the chosen line-end relations are maintained.

**Two things do not follow:**
1. Smooth constrains direction only. Equal handle length is an extra symmetry constraint.
2. Smooth relations do not uniquely decide the stroke route. If A is smooth to both B and C, two branches remain. Stroke routing is left for later.

**End stroke belonging to the line end** is a reasonable design proposal, not a necessary consequence of shared positions. bowen decides.

### Claude accepts (1791393354)

- **Point 1:** step 5 only claims direction; equal length would be a separate constraint.
- **Point 2:** the aside overclaimed and is withdrawn. A smooth fork leaves two possible routes.
- **End stroke:** already listed as a bowen confirmation (step 1).

### bowen (1791393710)

> 1没明白在问什么 2 接笔 线都共用端点了哪来两个线端的关系只能是端点的属性吧。3 这个最后讨论。

- **2 decided:** the join is an attribute of the point.
- **3 deferred to last.**
- **1 needs rephrasing.**

### Claude (1791393735)

**Item 1 rephrased.** Three lines meet at P, such as hair forking into a trunk and two branches.
- **Handles:** each line has its own handle at P (three handles), otherwise no corner is possible. Handles belong to lines. This part is settled.
- **End stroke (taper and so on):** is there one end stroke for the whole point, shared by all three lines? Or does each line have its own at P (for example the trunk not tapering while both branches taper)?

**Item 2 restated.** The join is the point's attribute. Its content is "which pairs of the lines at this point are smooth", for example "trunk and left branch smooth, right branch free".

**Consequence of "point attribute" with binding:**
- Binding deletes the later point. If the deleted point Q recorded "C and D smooth", that record disappears with Q. After C and D re-attach to P they are free and need re-setting.
- The kept point P's own join records are unaffected.
- **bowen to confirm:** is this intended, or should binding merge Q's joins into P?

### dot (1791393786) and Claude (1791393799)

- **dot withdraws** its earlier "the join cannot be a point attribute". P's join attribute can record which handles are linked and how their angles are limited; one position, several handles, no contradiction.
- **Item 1 is only about tapering.** It moves to the stroke layer and does not block now.
- **On binding:**
  - Storing joins on the point does not by itself force loss.
  - Deleting the old point's record and carrying its effective attributes to the kept point are separate questions.
  - Claude: the plain rule ("delete the later point") loses them, and carrying them over needs an added merge rule.
  - Both options were put to bowen without choosing.

**Single open question for bowen:** when binding, are the deleted point's join relations dropped, or carried to the kept point?

### bowen (1791393850)

> 1端头笔触属于点 这种链接曲线肯定是连接起来的所以是同样的笔触。而且相连的端点都是连贯笔触。如果需要特殊笔触可以在这位置附加显隐区间

**Decided:**
- The end stroke belongs to the point.
- Connected endpoints have a continuous stroke.
- Special effects at a junction are made with a show/hide interval there.

### Claude (1791393874)

**Derived:**
- End strokes (tapers) only take effect at free ends, i.e. points with one line. Shared points are continuous.
- On binding, the deleted point's end stroke goes with it. Continuity at the joined point is unaffected.
- **Matches v103:** binding clears tapers at connected ends by default (`clearConnectedInk`, `7205381:src/domain/drawing/commands.ts`).
- v103's "interior end taper" switch is replaced by show/hide intervals.

**New question:** does "connected lines have the same stroke" mean:
- (a) continuous only at the junction; or
- (b) the whole connected group shares one line stroke (width and profile)?

v103 `connect` unified the width and profile of both groups to the first group's (`c.width=width`, `profile`). Under (b), "line stroke" belongs to the continuous curve, not to each line, and all branches at a fork share it.

**Still open:** on binding, are the deleted point's joins dropped or carried over?

### bowen (1791421304): smooth is a stiff spring

> 首先是多个线共用端点然后平滑接笔的问题 我想的是平滑这个属性是一个弹性系数很大的量它使得两端的handle几乎保持平行（也可以稍微弯曲这是可以预见的） 当一个y字形俩俩互相平滑时（这种设计本来就是错的，不拒绝操作展示失误）那效果就是三个k作用变成了互为60度。如果这不是用户想要的他自己会取消不想要的组的平滑。

**Decided:**
- Smooth is a soft constraint, a very stiff spring pulling the two handles toward one straight line. It is not a hard rule.
- A conflict is not refused; the compromise result is shown. This answers item 3 (odd smooth cycle).
- The user removes unwanted smooth pairs.

### Claude's derivation (1791421341)

1. **Y with all three pairs smooth.**
   - The springs balance with the three handles evenly spread, **120° apart**, so each pair is 60° short of straight. Claude reads bowen's "互为60度" this way; to confirm.
   - Holding one handle still gives the same 120° spread.
2. **Without a conflict a spring and a hard rule give the same result.**
   - When dragging a handle, its smooth partner has no other force on it and turns fully straight.
   - "Slight bending" only appears with another force: conflicting smooth pairs, or deformation (head-turn) pushing handles while the spring pulls back.
   - **To confirm:** is the second the bending bowen foresees?
3. **Differs from v103:** v103 used a hard projection and raised "conflicting handle directions" on contradiction (`7205381:src/domain/drawing/smoothHandleAuthoring.ts:16`). The new model solves for the spring balance.
4. **Stiffness:** global and fixed, or per join? Claude suggests a global fixed large value for now.

### bowen (1791421340) asked what is still open; Claude listed (1791421356)

1. **Line stroke scope:** continuous only at the junction, or one width and profile for the whole connected group? v103 unified them on binding.
2. **On binding:** are the deleted point's joins dropped or carried to the kept point?
3. **Spring:** is "slight bending" about deformation, and is stiffness global for now?

### dot (1791421412)

- **Remaining:** attribute inheritance on binding. Does P keep only its own joins, or also take Q's still-valid joins (such as C–D smooth)?
- **Line stroke scope** (whole-group width and profile) can wait for the stroke layer. Continuity at the junction is already decided.
- **The soft constraint answers "what about conflicts":** allow the action and show the compromise. Stiffness value and adjustability need no detail now.
- **Y qualification:**
  - With equal weights and direction-only constraints, the symmetric balance is three outward handles 120° apart. The acute angle between the lines they lie on is 60°, which reconciles bowen's "60°".
  - A large k alone does not guarantee this in every case; other constraints change the result.

### bowen (1791421988)

> 60度是我说错了是120度奔驰车标。如果四条线就是90度（如果真的有人非要手动把四条线俩俩相平滑的话。然后老版我记得对于笔触的范围，各种工具default的接笔都有预设。这个你先调出来看一眼。旧版把两组统一成先点那组我倾向于保留 这种操作虽然可能不是理想的但至少没有歧义。然后几乎不会有在多条线交点用端点绑定来删点的情况，就算删也是两种操作先点多线交点再点其他，那么笔触都保留。反之那就是新的点接到了这个多线交点 那么就是按照预设。我记得旧版预设连续曲线就是仅绑定？（但是仅绑定的连续曲线是渲染时会给接上，所有连续曲线都不会有"断茬"） 弹簧硬度设一个全局固定值吧。未来实在需要也可以拓展。

**Decided:**
- Y with all pairs smooth → 120° (Mercedes star).
- Spring stiffness is one global fixed value, extendable later.
- **Keep v103's width unification on binding:** both groups take the first-clicked group's width. Not ideal, but unambiguous.

### Claude (1791422060)

**v103 join presets** (`7205381`):
- **Pen:** a "继续接笔" option with 仅绑定 / 平滑接笔 / 尖点接笔. **The default is 仅绑定**, reset every time the pen is selected (`ui/drawing/session.ts`, `DrawingRoom.tsx:406`).
- **Ellipse:** four segments joined **smooth** (`commands.ts:242`).
- **Offset line → independent curves:** segments joined **smooth** (`paintCommands.ts:93`).
- **Endpoint tools** (`ui/drawing/tools.ts`):
  - **合并位置:** moves positions together only.
  - **端点联动:** the ends move together; strokes, width and layers are kept (used across layers).
  - **绑定端点:** one stroke, independent handles (= 仅绑定).
  - **平滑接笔:** one stroke, handles opposite and collinear.
  - **尖点接笔:** one stroke, a sharp corner is kept.
  - **圆弧接笔:** one stroke, with an adjustable arc transition.
  - The last four merge into one stroke, with width unified to the first-clicked group.
- **Not verified:** the rendering difference between 仅绑定 and 尖点, and that 仅绑定 renders with no gap.

**Inheritance on binding, as Claude restates bowen (to confirm):**
- **Junction first, then another point:** the junction is kept with its joins and strokes. The newly attached line gets the current tool's preset.
- **Another point first, then the junction:** by the rule the junction is the later point and is deleted, and its joins go with it. All lines re-attach to the first point and use the tool preset.
- **In short:** the deleted point's join records are dropped; every new connection uses the tool preset.

**Four lines, all pairs smooth, is not necessarily a 90° cross.**
- With a spring measuring each pair's angular deviation from straight, the balance is the 90° cross.
- With a direction-vector spring, any arrangement of "two straight opposite pairs at any angle" also balances, so the result depends on the starting position.
- The formula is chosen later; the difference is noted here.

### dot (1791422049)

- Spring stiffness is recorded as global and fixed.
- dot will check v103's actual defaults. The focus is whether "仅绑定" and the rendering that fills in the junction are two different layers of handling.
- **Acceptance item:** an even 90° with four mutually smooth lines is the symmetric behaviour bowen wants. It is not the unique result of every high-k spring model. When the solver rule is chosen, this example must be in the acceptance tests; raising k alone does not count as implemented.

### dot's v103 check (1791422170; source reading)

**"仅绑定 also renders joined" is true, and it is two layers of handling:**

1. **Geometry:** 仅绑定 merges the endpoints into one point but does not straighten the handles; corners are allowed.
2. **Rendering:**
   - Two connected segments are chained into one stroke path, with no separate end caps in between.
   - A uniform stroke uses a round join; tapers and similar effects produce a continuous stroke outline.
   - So "joined, no gap" does not require geometric smooth.
   - Sources: `7205381:src/domain/drawing/strokes.ts`, `appearance.ts`.
3. **The other modes:** 尖点 generates a sharp-corner stroke outline; 平滑 constrains handle direction. This is why v103 has these modes.

The check is from source reading only; it does not guarantee that multi-branch or extreme-corner cases render without defects.

**A difference from the restatement above:**
- v103 join records reference curve ends, so deleting the merged point does not drop its joins wholesale.
- v103 also clears tapers at the junction.
- So "junction first keeps its settings, the reverse order uses presets" is a **new rule** to be stated explicitly, not v103 behaviour.
- **Claude's note:** the restatement was framed as bowen's rule, not as v103. This is now explicit.

### Status

- 2 decided (the join is a point attribute).
- 1 decided (end stroke belongs to the point; shared points are continuous; special effects use show/hide intervals).
- Open: line stroke per line or per connected group?
- 3 (odd smooth cycle) decided: smooth is a stiff spring; conflicts show the compromise, nothing is refused.
- **Decided (bowen 1791423036):** the deleted point's joins are dropped; new connections use the tool preset. This is a new rule, not v103.
- Decided: spring stiffness global and fixed; width unified to the first-clicked group on binding.

## Q24: Anything left to attack in the point / line / face graph?

**bowen** 1791423036:
> 可以。那么现在点线面的知识图谱还有可以攻击的情况吗？

("可以" approves the Q23 binding-inheritance rule.)

### Claude (1791423093)

**A. Cross-layer endpoint linking is not in the graph yet.**
- Binding merges two points into one. Points cannot be shared across layers, so v103 used **端点联动**:
  - two points kept, moving together;
  - each side keeps its stroke, width and layer (`ui/drawing/tools.ts`).
- v103 also allowed smooth joins on a link, rotating handles together across layers (`smoothHandleAuthoring.ts:8`).
- **Derived from existing rules:**
  - A link deletes no point, so the "lines with both ends on one point are deleted" rule does not apply.
  - Loops do not cross layers, so fills are unaffected.
  - Deleting a line on one side naturally removes the link.
- **To confirm:** a link is its own relation in the graph (two points that move together), and spring smoothness can hang on it.

**B. List order after binding two groups.**
- v103 places the merged group at the first-clicked group's position, with the other group's items right after it (`commands.ts:114`). This is consistent with "width unified to the first-clicked group".
- **Proposal for the reverse:** when deleting or unbinding splits a group, the new group goes right next to the original.

**C. Line stroke ownership.**
- v103 changes width for the whole connected stroke (`widthChange`, `commands.ts:135`) and unifies width on binding. So in practice the line stroke belongs to the continuous curve.
- **Consequence:** different widths inside one group require a link instead of a bind.
- **To confirm.**

**D. (minor)** A newly filled loop goes on top within its group by default (later fill covers earlier).

**Out of scope here:** head-turn and snapshots, show/hide intervals and mirror editing belong to the next layer. They are not gaps in point / line / face itself.

### dot (1791423203)

No hard contradiction that would overturn the point / line / face model. Two operations are not fully defined:

1. **Order after merging groups.**
   - Example: the order is A, B, C and binding joins A and C into one group. The group takes one list slot, so B cannot sit inside it.
   - By "first-clicked wins", the merged group takes the first-clicked group's slot and the other group's content moves into it.
   - This changes some occlusion, but the consequence is clear and can be shown.
2. **"New connections use the preset": which handles get the join?**
   - If the bind tool's preset is 仅绑定, there is no ambiguity: position is shared and nothing is smoothed.
   - If a tool adds smooth, it must say which two lines. Merging two fork points cannot decide all pairings from the word "smooth".
   - The soft constraint balances existing relations; it does not decide which relations to create.

A (cross-layer link), C (stroke scope) and D (new fill position) are feature scope still to define, not model failures.

### Claude (1791423219)

Agrees: A, C and D are definitions to add, not overturns.

**Point 2 already has an answer in v103:**
- Clicking an endpoint selects one line's end (`Endpoint = {curveId, end}`).
- The smooth tool creates a join between **the two clicked lines** (`connect(d,a,b,'SMOOTH')`, `7205381:src/domain/drawing/commands.ts:102`).
- So:
  - the click position decides which two points merge (Q22: binding acts on points);
  - the clicked line end decides which pair of lines gets the preset join;
  - other lines at the two fork points get no automatic join.

### Status

Waiting for dot's independent review and bowen on A–D.


## Q25: Endpoint linking as a continuing edit

**bowen** 1791423700:
> 端点联动是特殊情况。因为两端端点都存在，它相当于一种持续的编辑行为。即每一次操作结束之后，两个端点需要位置重合即可。而接笔是再次编辑两个端点对应的handle的。我暂时这样想 你们攻击一下看这种设定可不可以。可以预见这种操作应该比端点绑定更耗费计算资源。但这种情况应该不多。

### Claude (1791423739)

**Mostly holds.** v103 is close:
- Creating a link keeps the first point and moves the second onto it (`7205381:src/domain/drawing/commands.ts:69-74`).
- Dragging either point moves all linked points (`moveNode`, `commands.ts:61-66`).

**Attacks:**

1. **Who yields when restoring coincidence (main).**
   - Direct dragging is fine; both points move together.
   - But if another operation moves only one side (moving only layer B, deforming one side, or a head-turn deforming two layers differently), the points separate and one side must yield:
     - **A yields:** moving layer B drags layer A's line end along.
     - **B yields:** layer B moves, but its linked end is pulled back and that line bends.
   - **Proposal:** "first-clicked wins". The first point is master and the second follows. If the user directly drags the follower, both move. v103 recording junctions also use master / follower (`src/domain/recording/model.ts:32`).
2. **Linking within one layer?**
   - Same-layer points can already be bound. A same-layer link would create coincident but unshared points, bypassing the binding rules (no loops, no stroke unification).
   - **Proposal:** linking only across layers; same layer always binds. This matches bowen's earlier "bind within a layer, link across layers".
3. **Where a join across a link lives.** Joins are point attributes, but a link has two points, so neither is symmetric. The natural home is **the link relation itself**.
4. **A linked point deleted by binding.** By the Q23 rule its joins are dropped; for consistency its links are dropped too. To confirm.
5. **Cost:** each edit checks only the linked pairs, linear in the number of links, which is negligible if links are few. Head-turn realigns them per frame, still only those pairs.

### dot (1791423817)

**The setting holds:** two independent points, required to coincide on screen after each complete edit. A link does not merge topology, so it cannot turn two lines into a fillable loop.

**Examples to check:**
1. **A–B and B–C linked:** all three coincide as one group, not by overwriting coordinates pair by pair.
2. **A and B selected and moved by 10:** the group moves 10 once, not twice.
3. **The two sides compute different positions in one operation** (for example different deformations). "Coincide at the end" does not decide the common position. **This is the main open item.**

**Objections:**
- Claude's fixed master / follower is one option.
- "Cross-layer only" and "a link is dropped with a merged point" do not follow from the position-equality principle. They are not premises.
- **Cost:** only the affected link groups need updating, not the whole drawing. But the links drive curve and fill updates, so real cost needs stress testing. It cannot be called negligible now.

### Claude accepts (1791423831)

- dot's examples 1 and 2 are recorded as acceptance cases.
- Points 2 and 4 above are Claude's proposals for bowen, not derived premises.
- The cost claim was an overclaim; it needs stress testing.

**Main open item:** when the two sides get different positions in one operation, who decides the final position?

### bowen's decision (1791424124)

> 设置联动时 后点的移动到先点的位置。然后这两个不同图层的端点各自保存这个联动属性。接下来移动任何一个单独图层，对于另一个图层的这个点来说 相当于被人拖拽了这个点（编辑行为） 联动只用于跨图层。因为联动属性存了两份，那么如果有一侧的点被删除，联动属性里与之联动的端点id消失 那么联动失效，另一侧联动属性也消失。如果id依旧存在 那就跟着联动id走。这样够清晰了吗？

### Claude's restatement (1791424148)

1. When a link is created, the second-clicked point moves to the first-clicked point's position.
2. Each of the two points stores its own link attribute, holding the other's id.
3. Links are cross-layer only.
4. **The edited side decides.** When one side is moved (for example its layer is moved), the other side treats it as "someone dragged this point" and follows.
5. **Deleting either point invalidates the link.** When one side's point is deleted, the partner id no longer exists, so the link is invalid and the other side's attribute is cleared too. While the id exists, the link follows it.
   - So if binding deletes the linked point, the link disappears naturally.
   - A link on the kept point survives.

**One case not covered:** in one operation **both sides move by different amounts**, so both "drag" each other.
- In normal editing this hardly occurs: selecting both and dragging moves them by the same amount, once.
- It occurs in **head-turn and deformation**, where two layers deform differently and the linked points get different positions every frame.
- **Proposal:** decide this in the head-turn / deformation layer, with "the first-clicked side at creation leads" as the default. Asked bowen whether to defer.

### dot (1791424173)

**Agrees, with clarifications:**
- **No permanent master.**
  - The first click only decides the position when the link is created.
  - Afterwards, whichever side the user moves drives the other side's endpoint, as if dragging that point. It does not move the other's whole layer.
- **No automatic rebinding.** When the partner is deleted, the stale attribute is cleared; it never re-links to another point.
- **One update for both copies.** The two copies describe one link and are updated together, without triggering each other or moving back and forth.
- **Deferred:** both sides receiving different deformations is left to the deformation layer.

### bowen (1791424255)

> 联动建立完就是对称的 那么如果遭遇两者都移动那么相对移动也是对称的（即都移动到中点）就好了。

**Decided:** once created, a link is symmetric. If both sides move differently, both go to the midpoint.

### Claude: one combined rule (1791424274)

**Average the new positions of the points this operation moved; all other points in the link group follow to that position.**

- **One side moved:** the average is that point, and the other follows. This equals "the edited side decides".
- **Both moved by the same amount** (selected and dragged together): the average is the same position, and the group moves once (dot's acceptance case).
- **Both moved differently** (for example different deformations in a head-turn): the midpoint, so each side yields half.
- **A three-layer chain A–B–C:** the average of the moved points, the natural generalisation of the midpoint.

No master / follower is needed.

### dot's precision (1791424305, 1791424385)

**"Moved points" means the points this operation directly acts on.** It does not mean points carried along by a link, and it does not mean points whose coordinates happened to change.

- **Example:** both sides take part in a deformation. One side's result is still 0 and the other's is 10. The final position is 5. The first side is not excluded just because its coordinate did not change.
- **How to compute:**
  - use the target positions before link correction;
  - work in one canvas coordinate system;
  - count each point once.
- **Result:** single-side follow, two-sided midpoint and many-sided average are one rule, independent of processing order.
- **Example:** targets 10 and 20 end at 15. If only one side is edited to 10, the other follows to 10, with no halving against an unedited point.

Claude agrees; the rule above is to be read with this definition.

### Status

**Decided:**
- rules 1–5 (bowen 1791424124);
- the symmetric midpoint (bowen 1791424255), unified with rule 4 as "average of the moved points".

### Wrap-up of point / line / face (bowen 1791424493, Claude 1791424509, dot 1791424556)

**bowen:** point / line / face is complete. Linking and binding are unified for joins; one deletes a point, the other keeps both.

**Claude:**
- **Binding:** one point, and the join is stored on it.
- **Linking:** two points, and the join across them is stored in the link attribute, which each side keeps a copy of (bowen's "two copies"). This settles Q25 attack 3.

**dot:**
- No hard contradiction remains in the current scope. Joins share one rule: position first, then handle angles.
- **The topology differs:** binding shares one point; linking keeps two points, so cross-layer lines never become one closed loop.
- **Implementation rule:** the two copies of a link or join express **one** relation. They must not be computed as two springs, which would double the stiffness.

**Q24 still waiting for bowen:**
- **B:** list position of the merged group.
- **C:** line stroke belongs to the continuous curve. Links are cross-layer only, so within one layer a connected group has one width.
- **D:** a newly filled loop goes to the top of its group.

**bowen 1791424619:** "bcd都可以". Q24 B, C and D are approved, and the Q23–Q25 graph rows are written (bowen had been told this approval would trigger writing them, 1791424509).


## Q26: Tools by level, distilled from the graph

**bowen** 1791424689:
> 这样的知识图谱 你们提炼一下 目前有哪些工具，这些工具都归属于哪个层级（点？线？连续曲线？ 闭合曲线？）

### Claude (1791424728)

Sources: confirmed graph rows, plus the v103 toolbar (`7205381:src/ui/drawing/tools.ts`). "Decided" means it is in the graph; "v103, open" means v103 has it but the graph has not placed it.

| Level | Tool | What it does | Status |
|---|---|---|---|
| Point | Drag point | All line ends at the point move; handles translate | decided |
| Point | Bind endpoints | Two points become one; the later one is deleted; lines with both ends on one point are deleted | decided |
| Point | Unbind | Splits a shared point; a broken loop loses its fill | decided |
| Point | Join: smooth | A spring between two of the point's lines | decided |
| Point | End stroke | Only takes effect at free ends (taper) | decided |
| Point (cross-layer) | Endpoint link | Two points move together by averaging | decided |
| Line | Pen | Draws lines; continuing uses the preset join, default 仅绑定 | decided (preset follows v103) |
| Line | Drag handle | Smooth partners rotate with it | decided |
| Line | Split / add point | One segment becomes two; the loop stays | decided |
| Line | Delete | Lines only | decided |
| Line | Copy | "Move to layer" = copy, or copy then delete | decided |
| Continuous curve | Line stroke | Width and profile, one per group | decided |
| Continuous curve | Order | Position in the layer list | decided |
| Continuous curve | Ellipse | Four segments joined smooth | v103, open |
| Closed curve | Fill (paint bucket) | Click fills the smallest loop; larger loops from the list | decided |
| Closed curve | Clear / show-hide fill | Changes the fill only; never deletes a loop | decided |
| Closed curve | Order | Which fill covers which within a group | decided |
| Layer | New / delete / reorder | Layers and their elements are ordered lists | decided |

**v103 tools with no place in the graph yet (for bowen):**

1. **Cusp join, arc join.** The graph treats a corner as "no join record". But v103's cusp and arc change how the stroke is drawn at the junction: a sharp outline, or an arc transition (dot verified, 1791422170). They are junction stroke appearance, not geometric constraints. **Proposal:** treat them as a **stroke attribute of the point**, following "end stroke belongs to the point".
2. **Merge position** (moves two points together without sharing them). Under current rules, the same layer uses bind and different layers use link, so this tool has no place. **Proposal:** remove it.
3. **Corner / curved-edge deform, mirror editing, show/hide intervals.** These edit groups of elements and belong to the next layer (deformation and appearance), not to point / line / face.

### dot's five categories (1791424826)

These are operation ownership, not one button per item.

1. **Point (position and connection):**
   - drag a point (carries the attached line ends);
   - bind / unbind;
   - set or clear a join (spring smooth);
   - adjust the end stroke.
   - A join belongs to the point but acts on the handles of the lines attached there.
2. **Single Bézier (geometry):**
   - pen;
   - drag the two handles;
   - add a point / split (one curve → two curves and a new point);
   - delete a curve.
   - There is no "delete endpoint" tool; points are reduced by binding.
3. **Continuous curve (group management):**
   - group line stroke (width, profile);
   - order in the layer;
   - select, move and copy as a whole.
   - Binding, deleting and unbinding change membership; this follows from connectivity.
4. **Closed curve (fill management):**
   - create a fill (canvas: smallest loop; list: larger loops);
   - change style, show/hide, clear;
   - loop order = fill order.
   - Loops are auto-detected and keep no copy of their boundary. There is no "manual edge fill" and no "delete only the loop but keep its boundary".
5. **Cross-layer endpoint link (relation editing):**
   - create / remove a link;
   - set a join across the link.
   - It acts on two independent points; it belongs to no single curve or loop.

**Cross-level general capabilities:** selection, move, copy and undo, not one set per level. Layers organise and order. Viewport, reference images and recording are not in this table.

**Corrections:**
- **"Merge position"** is a one-time alignment, a different purpose from a continuing link. The existence of bind and link does not mean it must be removed.
- **Arc join** changes the derived display route, so it cannot be called "purely appearance" alongside cusp.

### Claude accepts (1791424845)

**Adopts dot's five categories.**

- **Merge position:** "remove" was an overreach and is now open. In graph terms it is a drag-point with snapping, at the point level, creating no relation.
- **Arc join:**
  - v103 fill boundaries borrow the arc join's geometry (`resolvedFillGeometry.ts:13-60`, Q16), so arc changes derived shape, fill boundary included.
  - **Revised open items:**
    - cusp is a stroke attribute of the point;
    - arc is a geometry-generating join on the point, to be decided separately.

### One-time edits vs persistent attributes (dot 1791424906, Claude 1791424925)

dot: the table must mark one-time edit actions and persistent attributes separately.

**One-time edits** change geometry or connectivity once, then are done.
- Point: drag point, bind, unbind, merge position.
- Single curve: pen, drag handle, split / add point, delete.
- General: select, move, copy, undo.

**Persistent attributes** are stored and keep acting afterwards, or decide display.
- Point: join (spring smooth), end stroke.
- Continuous curve: line stroke (width, profile), layer order.
- Closed curve: fill (present, style, visibility), fill order.
- Cross-layer: endpoint link, join across a link.

**Only spring smooth and endpoint link actively change geometry after each operation.** The other attributes are only stored or only affect display. These two are where stress tests and acceptance cases are needed.

### Status

Waiting for bowen:
- cusp as a point stroke attribute;
- arc join's place (it generates geometry);
- ~~merge position as a one-time snap at the point level~~ **decided (bowen 1791424844):** "合并位置是一次编辑行为 端点联动才是修改了属性". Merge position is a one-time edit at the point level and creates no relation; a link modifies attributes;
- deformation, mirror editing and show/hide intervals in the next layer.

## Q27: Cusp and arc joins in the graph; fill follows the arc

**bowen** 1791425164:
> 尖点接笔我记得旧版设定可以完美嵌入现在的图谱里面吧？ 圆弧也同理 是一种会产生几何的接笔，唯一要注意的是圆弧接笔处的填充要跟随圆弧而不是原本的端点位置。（这里你们查一下知识图谱是否需要添加新原则） 3 合并位置 变形 镜像编辑都属于"编辑"这个层级 之后再说。显隐区间会属于连续曲线 这个之后再回来。

### Claude (1791425203)

**1. Cusp and arc fit directly.**
- v103's join record is "a pair of line ends + a mode": `TangentJoin {a, b, mode: 'SMOOTH'|'CUSP'|'ARC', radius?}` (`7205381:src/domain/drawing/model.ts:68`). 仅绑定 means no record.
- In graph terms, the point's join attribute is a table with one row per pair:
  - **no record:** 仅绑定, drawn with a smooth (round) junction;
  - **smooth:** spring;
  - **cusp:** independent handles, drawn as a sharp outline;
  - **arc:** generates arc geometry (with a radius).
- **Graph row to amend:** "a corner means no record" (Claude's Q23 step 4) is inaccurate. It should read "仅绑定 = no record; cusp is a record whose effect is a sharp outline."

**2. Fill following the arc needs a new principle.**
- The graph only says "a loop references its boundary segments"; it does not say where the fill **shape** comes from.
- **Proposed principle:** whether a loop exists depends only on shared points (topology). The fill shape uses the geometry derived after joins are applied, the same geometry the stroke is drawn with.
- **Derived:**
  - **Loop uses the arc's pair:** where a loop passes a point with an arc join and uses exactly that pair of lines, the fill boundary follows the arc, not the original endpoint.
  - **Loop uses another pair** (at a fork): that loop stays a sharp corner through the original point.
  - **v103 already does this:** fill boundaries borrow the arc geometry (`resolvedFillGeometry.ts:13-60`, Q16). But it uses a fill-specific borrowing path, the coupling in Q16 attack E. Under the principle, stroke and fill **read the same derived geometry** and do not compute separately.
  - **Q23 step 8 narrowed:** "loops and fills are unaffected by joins" becomes "**whether a loop exists** is unaffected by joins".

**3. Recorded:**
- merge position, deformation and mirror editing belong to the "editing" level, later;
- show/hide intervals belong to the continuous curve, later.

### dot (1791425290)

**Proposed principle (dot's wording):** a closed loop's identity and validity are decided by connectivity; the boundary actually used for filling is the geometry of that loop's route after join processing.

- **Cusp** mainly changes the stroke corner's outer outline. It does not change the fill's structural boundary.
- **Arc join** trims part of the curves near the original corner and adds an arc. A fill passing through that pair uses the arc and no longer reaches the original endpoint.
- **Lines and fill reuse the same join geometry** so they cannot disagree.
- **The fill does not follow** the ink's outer edge, tapers or show/hide intervals. Hiding a stretch of ink does not cut the fill boundary.
- **Pairing check (v103 `derivedUses`, `7205381:src/domain/drawing/roundedJoin.ts`):** an arc applies according to which two lines the loop passes through at that point. Not every loop at a multi-line point is rounded.

**Claude's precision:** "the same derived geometry" in Claude's wording means the **centreline path after join processing**, not the stroke outline. This matches dot's last two points.

### dot's limit on the fork example (1791425335)

- "It must match that pair of lines" is the rule for an ordinary loop route.
- v103 also borrows half an arc across links and rejoins fill boundaries there (`7205381:src/domain/drawing/resolvedFillGeometry.ts`).
- So "taking another pair always returns to the original endpoint" is **not** a general principle.

**Principle to write for now:** a fill uses the derived geometry of its boundary route and stays consistent with the related strokes. How a fork is joined in detail is left open.

**Claude accepts:** the fork bullet in Claude's 1791425203 derivation is withdrawn as a general rule.

### bowen's wording (1791425361) and Claude's reply (1791425378)

> 原则可以这样说吗？填充是跟随闭合曲线最终显示效果的外轮廓来定

**Claude:** close, but "final displayed outer outline" can be read as the stroke's outer edge, which causes three problems:
1. **Width:** a 4 px line's outer edge is 2 px outside the centreline, so the fill would spill 2 px outside the line.
2. **Show/hide intervals:** hidden ink has no displayed outline there, so the fill would lose its boundary. That contradicts "hiding ink does not break loop or fill".
3. **Taper:** the fill boundary would shrink inward where the line tapers.

**Proposed wording:** the fill follows the closed curve's final **shape**, meaning the lines' centre path including shape-changing joins such as arcs. It does not follow stroke width, taper or show/hide intervals.

Lines are drawn above fills, and the ink straddles the centreline, so it looks like "filled up to the line". **To confirm with bowen.**

### Status

Claude and dot agree on the principle. The graph changes wait for bowen's "写":
- amend "corner means no record";
- add the derived-geometry principle.

**bowen 1791425445:** "OK 这样改合理". The Q27 wording is approved and written to the graph: the join row is amended and the fill-boundary principle added. Claude had said this approval would trigger writing (1791425431).


## Q28: Turn the graph into packages

**bowen** 1791425592:
> 首先把现有的图谱写成package（这是python的说法， ts啥的该怎么写你们自己知道） 就是现在所有的工具 概念都有它们各自的归属 那么就应该写进它们对应的package，以便后面的进行调用。代码要模块化，这样出逻辑问题也局限在模块内部

### Claude (1791425683)

The package plan is in `docs/design/architecture/20-packages.md` (`1034a4a`): packages, the one-way dependency direction, one fixed edit pipeline, and 16 acceptance cases written as tests first. No code before bowen signs off the direction.

**For bowen:**
1. **Where:**
   - (a) a new clean set of packages next to the proto (recommended);
   - (b) rewrite the proto model in place.
2. **Is the package split right?**

### Status

Waiting for dot's independent review and bowen.

## Q29: Layers — a minimal set of principles

**bowen** 1791432837:
> 图层你们按照旧版以及成熟方案，给我总结出几条最小原则集 给我审阅。

### Claude's draft (1791432979)

Sources:
- v103 = `7205381` code.
- Illustrator and Figma = official help pages opened this session:
  - helpx.adobe.com: Illustrator Layers overview / Lock or unlock layers / Hide or show layers / Delete layers;
  - help.figma.com: Toggle visibility to hide layers / Lock and unlock layers.

**Already decided (carried over):**

1. A layer is an ordered list of continuous curves (groups). Layers themselves are an ordered list, and upper layers cover lower ones.
2. Lines, closed curves and fills never cross layers. Only endpoint links do.
3. Moving to another layer is copy + delete.

**Proposed:**

4. **A layer has three attributes: name, visibility, lock.** Order is its list position.
   - v103 `DrawingLayer {id, name, visible, locked, items}` (`model.ts:64`).
   - Illustrator and Figma both have visibility and lock toggles.
5. **A layer's visibility and lock govern everything inside it.**
   - Figma: locking a parent locks its children, and a child cannot be unlocked alone.
   - v103: `layerChange` sets the state of every item (`commands.ts:21-25`).
6. **Deleting a layer deletes its contents, then the layer.** At least one layer remains.
   - v103 `deleteLayers` deletes the objects, then the layer.
   - Illustrator: the delete icon is unavailable when the document has only one layer.
7. **No sublayers.** Our groups are derived from shared endpoints, so nesting would only add concepts. This is Claude's proposal, with no source.

**For bowen:**

- **A. Can hidden things be edited?**
  - Figma: a hidden layer cannot be selected on the canvas, but can be selected and changed in the Layers panel.
  - v103: hidden objects cannot be modified, except deletion from the list.
- **B. Can locked things be deleted?**
  - v103: no.
  - Figma's page says a locked layer cannot be selected or moved on the canvas, but can still be selected and changed in the panel. The page says nothing about deleting.
- **C. Cross-layer link with a locked side.** When layer B is locked and the linked point in A moves:
  - the locked side stays fixed and the other side aligns to it; or
  - the move does not take effect.
- **D. Do groups and fills get their own visibility and lock,** or only layers? Today only fills have visibility in the graph.

### dot's proposal (1791433101)

Six principles: layer as an identified container; order only decides covering; hiding only stops display; lock scope stated separately; delete by ownership; layer operations change attributes or ownership only.

**dot's corrections to Claude's draft:**
- v103 batch-writes visibility and lock onto members, and the container fields are neutralised. A layer-level master switch that keeps member settings is dot's proposed improvement, not v103.
- "Locked means nothing may change" is not a rule shared by mature tools. Figma allows selecting a locked layer in the panel and changing its properties, and says nothing about cross-layer links.
- Do not quietly make the locked side the fixed master of a link. Either let links move it, or refuse the whole edit.
- Keeping at least one layer and having no sublayers are scope and defaults, not core principles.

### Merged (Claude 1791433123)

1. A layer is an identified container: name, visibility, lock, and an ordered list of contents (continuous curves). Renaming and reordering change neither geometry nor connections.
2. Order only decides covering. Being in the same layer never binds anything or forms a loop.
3. Hiding only stops display. Contents, fills and links are kept.
4. Deleting a layer deletes everything it owns. Other layers only lose relations that pointed at deleted endpoints, such as links. It is one commit and one undo.
5. New, rename, reorder, show/hide, lock and delete change attributes or ownership only. Moving, copying and deforming belong to the editing layer.

**For bowen:**

- **A. Visibility:**
  - a master switch (dot's proposal, new), where an individually hidden member stays hidden when the layer is shown again; or
  - a batch write to members (**v103 behaviour**, `commands.ts:21-25`).
  - Hidden and locked are kept separate: v103 treated hidden linked objects differently from one operation to another, so one rule should replace that (dot 1791433131).
- **B. Lock and links:**
  - links still move a locked point. This is dot's proposal, and it **changes v103 semantics**: lock would only stop direct edits.
  - an edit that would move a locked point is refused whole. **This is the v103 behaviour:** `followLinkedNodes` throws "联动端点所在曲线或图层已隐藏或锁定" for locked members, and for hidden ones unless `allowHidden` (`7205381:src/domain/drawing/endpointLinks.ts:16-25`, dot 1791433131, Claude verified).
- **C.** Can locked things be deleted? Can hidden things be edited?

### Status

Waiting for dot's review and bowen's decisions.

### bowen's decision (1791433646)

> 算了还是之前那样，之后你们来攻击。图层是有身份的容器 可以容纳单条曲线和连续曲线（单条曲线和连续曲线是平级的单条曲线是只有一条的连续曲线）然后它自身有顺序里面的element也有顺序。 之前说过element是线和填充 这些element（代码要把这些都写进element或者起个更好名字struct里面） 具有显隐属性 隐藏之后不可直接选中，但是可以通过按v本质上是选择连续曲线，这时候就可以被选中和处理）锁定之后不可更改。而图层的显隐锁定是对里面element的批处理。（连续曲线的显隐也是对它下面单独曲线的批处理）显隐和锁定不属于编辑，属于状态变更操作。而图层只能进行状态变更操作（显隐锁定 修改排序）

**Claude's restatement (1791433686):**
1. A layer is an identified, ordered container of continuous curves (a single line is a one-line continuous curve), and these are ordered too.
2. **Element = line or fill.** Visibility and lock live only on elements, in one element structure in code.
3. A hidden element cannot be picked directly. Selecting the whole continuous curve (V) includes it, and then it can be processed.
4. A locked element cannot be changed.
5. Layer visibility and lock are batch operations on its elements. A continuous curve's visibility is a batch over its lines. This is v103 behaviour.
6. Visibility and lock are **state changes**, not edits. A layer itself only takes state changes: visibility, lock, reorder.

**Claude's attacks (for bowen):**
- **A. Shared endpoint with a locked line.** Dragging the point would deform the locked line. Refuse the whole drag? (v103 refused.)
- **B. Smooth spring with a locked line.** The locked handle cannot turn, so it acts as held and the other side aligns. Derived, no refusal needed. Agree?
- **C. Fill lock.** Does it cover only the fill's own attributes (colour, visibility, order), or forbid changing its boundary lines? Proposal: own attributes only; the shape follows the boundary.
- **D. Group line stroke** (width, profile). Refuse if any line in the group is locked?
- **E. New, delete and rename layer.** Are these allowed, and what kind of operation are they?
- **F. Undo.** Do state changes go into undo history?

### dot's review (1791433808)

- **Structure:** a unified `DrawableElement`. Lines and fills share identity, visibility and lock fields, and each keeps its own geometry. Layers and continuous curves organise and batch.
- **Batches leave nothing behind:** hiding a layer sets its current members hidden. Later elements take their own default. A layer with some members shown and some hidden is valid, and the layer keeps no contradictory visibility of its own.
- **A and D follow directly:** dragging a shared point, or changing a group's stroke, would change a locked member, so the whole edit is not committed.
- **B is not a natural result:** treating the locked handle as a fixed pivot is one strategy and refusing the conflicting edit is another. The spring must not get special treatment silently.
- **C is the important boundary:** does locking a fill also protect its shape that follows the boundary? bowen to confirm.
- **Undo:** separating state changes from geometry edits does not exclude them from undo; the unified undo continues.
- **New, delete and rename:** these are container and attribute management, with no new geometry rules.

### Claude (1791433831)

Agrees: B is a strategy choice, not derived.

**Left for bowen:**
- **B:** fixed pivot, or refuse.
- **C:** lock only the fill's own attributes, or also its boundary.

**Following the derivations unless bowen objects:**
- A and D are refused whole.
- State changes are undoable.
- New, delete and rename layers are container management.

### bowen's decisions on A–F (1791434101)

> A拒绝，交互的表现是被锁定那条线上打个红叉表示这里有错误 然后红叉旁边出现一个锁头 表示是这里被锁定发生的错误。B也是拒绝然后出现对应的交互提示 C 锁定只锁自己和子集/属性，对于填充来说它能锁的就是填充颜色/材质。D 这个不是 锁定不会锁定父级，但是这种基本上算是误操作，就其他线都改宽度就被锁的线孤零零原本宽度 展示后果。E这个另说F 状态变更不进撤销。

- **A:** refused. Interaction: a red cross on the locked line, with a lock icon beside it.
- **B:** refused, with a matching interaction hint.
- **C:** a lock covers the element itself, its subsets and its attributes. For a fill this means colour and material; the shape still follows the boundary.
- **D:** a lock never locks the parent. A group stroke change applies to the unlocked lines; a locked line keeps its width, and the consequence is shown.
- **E:** later.
- **F:** state changes are not in undo.

### Claude's consequences (1791434134), for bowen to confirm

1. **D changes Q24 C** ("line stroke belongs to the whole continuous curve"). Width can now differ within a group, so the stroke lives on each line. A group stroke change, and binding's "unify to the first-clicked group", become batches over lines, and locked lines keep their width.
2. **Locked elements can still change state.** Visibility and lock are state changes, not edits, so the lock does not block them; otherwise nothing could be unlocked.
3. **F means undo restores edits only.** An element hidden after an edit stays hidden when that edit is undone.
   - **Edge case for bowen:** undoing an edit that changed a line which is now locked — undo as usual, or refuse because of the lock?

### dot (1791434214) and Claude (1791434229)

**Two base definitions change:**
- Each line stores its own final width, and a group width change is a batch.
- Visibility, lock and order states are separate from edit undo, so undoing a shape does not restore old states.

**A/B versus D:**
- D's legal targets are the unlocked members, all committed together.
- A/B would change locked geometry, so the whole operation is refused. This is not "execute half and ignore the error".

**Binding correction (Claude agrees):**
- Binding is allowed only if the locked line's endpoints and connections are unaffected; then it only keeps its width.
- If the locked line ends at the merged-away point, or its connections change, binding is refused per A.

**Asked bowen:**
- Is reordering also a state change outside undo?
- Does that cover only layer order, or also the order of groups and fills inside a layer?

