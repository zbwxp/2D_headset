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
| Path | owns | Its own fill (a closed path's fill) | current code | Q2/Q4 |
| Shape group | owns | Faces (fills of enclosed areas) | current code | Q2/Q4 |
| Path | consists of | Bézier segments (between anchors; anchor = point + two handles) | current code | Q2 |
| Reference (instance) | redraws | Another container's content, through a transform | current code | Q4 |
| Layer module | exposes interface | (not defined; no dedicated interface today) | open | Q1 |
| Snapshot / view | is | (no persisted domain object in the new version) | open | Q3 |

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

#### Status

**Waiting for bowen to decide how fill is defined** (minimal regions only, or whole fills defined by a chosen outer loop as well).
