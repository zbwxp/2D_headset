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
