# Recording 场景与独立对象轨道

本页对应 2026-10-02 部署中的 v23（功能代码 `384c310`）、`contourAI` 2.0、工程字段 `recordingScenes.version=1`。v18/v19 首轮真实浏览器验收涵盖跨来源组装、独立对象保存/放弃、父子 Warp、源工作副本同步、Undo/Redo 与重载；范围见[发布验证记录](recording-scene-release-validation.md)。v22 已实测无 Warp 建立 90°并更新成员显隐、再建立 0°，新 Warp 的 0°/90°中性键、90°实际拖节点并更新、45°严格中值预览且禁止编辑，以及实拖滑杆回 90°恢复且无警告。A/V/Z/Space 全操作未扩测，来源分组补丁 `384c310` 正在部署；未覆盖的手势、姿态与完整转头美术不由这些结果推定通过。本次架构将 Drawing 作为配件库，Recording 作为引用配件的独立场景。本文的 JSON 示例由 `recording-scene-api.test.ts` 调用真实接口验证。

## 开始前先查询

固定 AI 编辑窗口支持 `inspectScene / scene / previewScene / previewSceneFrames`。写入只允许 Recording 模式；接口不会替你切模式。查询和预览可在两种模式读取，均不提交工程、不增加 Undo。源稿编辑仍使用 Drawing 的 [源编辑接口](vector-editing-api.md)。

<!-- scene-tested: inspect -->
```json
{"method":"inspectScene","request":{"includeKeyValues":false}}
```

结果包含场景列表、当前场景、`viewpoints` 命名视角、实例、实例图层、Warp 父子关系、叶子绑定和各轨道的独立键列表。`hasExplicitViewpoints` 区分显式视角列表与尚未建立视角的旧场景。`availableArtworks` 列出来源画稿、图层及成员 ID、当前有效源签名；`liveWorkingCopy` 标明是否解析到了当前未保存的 Drawing。`includeKeyValues:true` 才返回完整键值；默认仍提供当前 Warp 网格。

名称仅用于查找，不能作为写入身份。`instanceIds / warpIds / nameIncludes` 可过滤检查结果。同一画稿可以加载多次，两个实例的变形和外观轨道独立。

## 来源、身份和坐标

- 实例保存 `artworkId`，不复制或拥有源几何。源更新会作用于所有引用实例
- 解析顺序为 active Drawing → 同 ID 的 `drawingWorkingCopies` → checkpoint。切到其他画稿时，A 的未更新修改仍保留在 A 的工作副本；所有 A 实例继续使用它，返回 A 也恢复它
- 未命名画稿使用 `$working`。正常 API 切稿前要求先命名/另存或显式丢弃；store 也保护旧调用路径，必要时保存一个真实 checkpoint 并提升 `$working` 引用。首次另存后实例指向稳定 ID，后续切稿不偷换来源
- 图层引用为 `{instanceId,sourceLayerId}`。成员再增加 `sourceObjectId`。不要手工拼接渲染 ID
- 派生渲染 ID 有实例命名空间；预览返回 `provenance / layerMap / objectMap`，可查回真实来源身份
- 几何端点仍是 Bézier P0/P1；区间仍是路径上的 SHOW/HIDE；可见末端及其笔触不变成新的几何端点

Warp 的节点与绝对 U/V 柄处于本网格输出坐标，也就是紧邻父级的输入空间。子级先作用，祖先依次作用。`stopAtWarpId` 的局部预览保留所选 Warp 及其子级，省略它的祖先；没有使用非线性反解去冒充源坐标。

选择部分来源图层时，必须同时选择它们依赖的端点联动、跨层显示路径、填充边界和偏移源。接口返回 `LAYER_DEPENDENCIES` 并列出需要补选的图层；不会偷偷引入隐藏成员参与端点平均。

## 原子批次和引用

先 inspect 取得 `revision`，再 dry-run，同版本 apply，最后检查查询和实际预览。`expectedRevision` 覆盖整个工程及源/库身份：即使场景对象没变，Drawing 工作副本变化也会拒绝旧批次；这也包含非活动画稿的 working copy。整批先在分离副本中完成校验，失败不部分提交；成功只增加一次 Undo。

创建命令可用 `ref`，后续 ID 字段用 `$ref`。只支持同一批次中较早的引用；真实 canonical ID 优先。dry-run 生成的 ID 不保留给 apply，应重放相同引用结构。

下面仅展示实例和绑定，不声称创建了转头动画。将两个 `SOURCE_*` 占位符替换为 inspect 返回的真实身份，先保留 `dryRun:true`。

<!-- scene-tested: two-instances -->
```json
{"method":"scene","request":{"dryRun":true,"commands":[{"op":"createScene","name":"配件组合","ref":"scene"},{"op":"addInstance","artworkId":"SOURCE_ARTWORK_ID","name":"实例 A","ref":"a"},{"op":"addInstance","artworkId":"SOURCE_ARTWORK_ID","name":"实例 B","ref":"b"},{"op":"createWarp","name":"共同父域","layerRefs":[{"instanceId":"$a","sourceLayerId":"SOURCE_LAYER_ID"},{"instanceId":"$b","sourceLayerId":"SOURCE_LAYER_ID"}],"rows":3,"columns":3,"ref":"shared"}]}}
```

`sceneId` 可在 request 指定批次目标；不会因这个目标参数自动改变当前场景选择。`selectScene`、`createScene` 才明确切换。结果返回 `created`、`removedIds`、`pinResults`、`changed/dryRun/applied` 和目标 `sceneId`。

## 明确的 Warp 操作

| 命令 | 规则 |
|---|---|
| `createWarp(layerRefs,name?,rows?,columns?,ref?)` | 只接受未绑定层，可跨实例共用一个 Warp；已有绑定返回 `ALREADY_BOUND` |
| `wrapParent(warpIds,...)` | 所选 Warp 必须同一 immediate parent；新父挂原父，原叶子绑定和键不变 |
| `createChild(parentWarpId,layerRefs,...)` | 只移动直接绑定到该父的所选层，保留父链 |
| `rebindLayers(layerRefs,warpId)` | 明确改叶子绑定；`null` 解除绑定 |
| `setWarp(warpId,name?,parentId?)` | 明确重命名或重挂父级；`parentId:null` 挂根，循环拒绝 |
| `deleteWarp(warpId)` | 删除该 Warp；孩子及直接绑定接回原父，没有父则解除对应绑定 |
| `editWarpNodes(warpId,edits,moveHandles?)` | 行优先节点索引；可改 position/handleU/handleV/twist，默认移动位置时跟随柄 |
| `pinWarpPoint(warpId,sourcePoint,targetPoint)` | 当前对象的一次草稿编辑；目标属于紧邻父空间，不是永久约束 |

包父要求同父级，所以同时选择 ancestor 与 descendant 会拒绝；不同父链也不会被悄悄拉到根。新父 rest 范围包含孩子 rest、当前值、全部键/草稿以及完整 bicubic 控制网。插入的网格是 identity，正常域内的现有动画保持不变。之后的矛盾控制请求、外推和拟合超差仍需要检查诊断。

## 每个对象独立保存

场景 angle 只是编辑位置。Warp、显隐通道、区间通道和排序通道各自拥有 keys；一个对象可以只有 2 键，另一个有 10 键。新增或保存一个对象不会给其他对象补键。

`saveSelected {warpIds?,layerRefs?,name?}` 只保存明确选中的对象。选择层时，保存该层的成员显隐、排序和其拥有的区间通道；跨层显示路径的区间只属于 anchor 所在层，保存一次。没有任何外观轨道的层会建立一个继承源显隐的键。`discardSelected` 也只丢弃这些对象的草稿。

每个草稿带有自己的 angle。同一图层的成员显隐、区间和排序属于同一层对象，编辑其中一个通道前会检查该层全部通道的草稿角度，避免同层产生无法一起保存的不同角度草稿。移动场景 angle 不会清空草稿，也不会被其他对象草稿锁住。只有试图在另一个角度修改或保存同一对象时，才返回 `OBJECT_DRAFT_AT_OTHER_ANGLE`；返回其草稿角度，或明确 discard 后继续。

<!-- scene-tested: selected-key -->
```json
{"method":"scene","request":{"dryRun":true,"commands":[{"op":"setAngle","angle":{"x":30,"y":0}},{"op":"saveSelected","warpIds":["WARP_ID"],"name":"仅此对象的 30 度键"}]}}
```

`renameKey/deleteKey` 必须带 `trackId` 和 `keyId`。删除一个轨道的键不删除其他对象同角度的键。新场景不要求每个对象都拥有旧系统的五个锚点。

## 命名视角与更新

`viewpoints` 是场景可选的轻量视角列表，每项为 `{id,name,angle}`。没有 Warp、实例或任何轨道也能建立视角。它记录查看和编辑的位置，不是全场景快照；对象仍有各自独立的键。

UI 左侧管理角度、建立和更新视角，右侧加载画稿并复用 Drawing 图层列表。每个有图层的来源实例只有一个可折叠组，层行标注跨实例的全局层序；分组只改变列表展示，不改变渲染顺序。未建立视角的角度只可预览插值；显隐、层序、网格编辑、建立 Warp 和所选对象保存/放弃须先建立当前视角。这个门槛仅在 UI：`scene` API 的 `setAngle`、草稿编辑、Warp 创建和 `saveSelected` 不要求已有对应视角，仍执行模式、绑定和对象草稿角度等原有校验。

| 命令 | 规则 |
|---|---|
| `createViewpoint(name?,angle?,ref?)` | 在指定 angle（省略时为当前场景 angle）建立视角并移到该位置；省略名称使用 `Viewpoint N`。不采样或改动任何已有对象轨道。同角度重复建立返回 `VIEWPOINT_EXISTS` |
| `updateViewpoint(viewpointId)` | 移到这个视角，只提交 draft.angle 与视角匹配的已有草稿；其他角度草稿、没有草稿的对象及其键保持不变。没有草稿时仍保留视角，不制造键 |
| `renameViewpoint(viewpointId,name)` | 只改视角名称，键及轨道不变 |
| `deleteViewpoint(viewpointId)` | 只删除视角书签，保留对象键、草稿和当前场景 angle |

「更新此视角」不依赖当前选择，也不要求存在 Warp；它可以一起提交目标视角角度已改动的 Warp、成员显隐、区间和排序通道。没有改动的通道不会被补键，也不会为了保存一个成员而新建整层显隐通道。更新一个已经有键的通道会保留该键 ID 和名称。

`createWarp/createChild/wrapParent` 在有显式视角的场景中新建 Warp 时，仅为这个新 Warp 在每个已建立视角写入 `restGrid` 中性键。例如先建立 30°、90°，再建 Warp 并只改 90°，30°仍保持 identity，45°为这两个键之间的 25% 插值。其他 Warp 和外观轨道不会增加键。之后建立新视角也不会给已有 Warp 自动补键。

旧场景省略 `viewpoints` 时，UI 可以从已有键角度派生可编辑视角列表；普通解析和查询不持久化这个列表。UI 首次建立/更新视角或创建 Warp 时，会先将派生视角转成显式列表；因此经此 UI 流程创建的 Warp 也有这些视角的中性键。直接 API 创建 Warp 且场景仍省略 `viewpoints` 时，保持原有零键行为；直接 `createViewpoint` 只建立请求的视角，不自动复制旧键角度。删除最后一个视角后保留 `viewpoints:[]`，因此不会重新启用旧键派生列表。独立轨道的插值和缺省 rest/source 逻辑不变。

## 层外观和源只读

`setVisibility {target,visible}` 支持 `true / false / null`。层级 false 关闭整层；true 打开容器并保留源成员隐藏状态；null 继承源。明确的成员目标 `sourceObjectId` 才能覆盖这个成员的显隐；层 false 仍压住它。API 要“显示全部成员”，应先查询成员 ID，再逐成员明确发批次。当前 Recording 图层列表的眼睛按钮就是对真实成员写显隐通道（层级按钮批量作用于成员），可以覆盖源成员的隐藏状态；画布工具栏的填充预览开关不写录制轨道。`inkVisible` 和 SHOW/HIDE 不被显隐命令改写。

`changeInterval / setIntervalEnd / setIntervalEnabled` 使用 `instanceId + sourceTrackId + rangeId`。它们只改姿态外观，不能新建源轨道或改 anchor/route；`start/end` 是归一化弧长，`fullLoop` 与 Drawing 使用同一语义。`setLayerOrder {target,value}` 写当前层排序轨道草稿，保留源元素在其原实例内的深度偏移关系。

源坐标、源控制柄、拓扑、填充结构只在 Drawing 修改。改名不改变实例引用；复制源稿的新 ID 不会替换旧实例。删除来源不会顺便删除场景动画；旧使用中保护若适用会拒绝删除，否则留下局部 `MISSING_SOURCE`，源 Undo 后可以接回。

同 ID 更新 checkpoint 会清除该 ID 的工作副本；显式另存为新 ID 不会将原 A 实例改指新 B，A 的未更新内容仍保留在 A 的工作副本。删除来源清除该 ID 的副本，完整 Undo 可恢复。导出/解析保留工作副本，而普通切稿不制造多余备份画稿。`artwork.restore` 对已有 ID 默认切到最新工作副本；`discardUnsaved:true` 仍是明确丢弃当前副本并恢复 checkpoint 的请求。

同拓扑的源几何编辑在同一 store 事务中迁移各实例的区间材料。来源层、对象、区间或材料失效时，保留原键，并只诊断/暂停受影响通道。恢复同源身份后可再接上；不会以全场 source hash 锁住整个页面，也不会自动删掉“坏键”。

## 场景与实例管理

`createScene/selectScene/renameScene/deleteScene` 管理场景。`addInstance/renameInstance/removeInstance/setInstanceLayers` 管理场景引用；`sourceLayerIds:null` 恢复跟随来源全部图层，包括以后新加的层。移除实例会移除它的场景绑定和外观轨道，保留 Drawing 配件库。没有自动删除其可能共用的 Warp。

`cleanupUnused` 是明确的场景清理命令，处理已失效的场景引用；`removeUnboundWarps:true` 还会删除没有任何有效叶子使用的 Warp 及其轨道。先 dry-run 检查 `removedIds`。清理不会删除源稿或原库图片。

## 预览和完整工程保存

<!-- scene-tested: preview -->
```json
{"method":"previewScene","request":{"angle":{"x":30,"y":0},"width":600,"height":600,"showFills":true}}
```

省略 angle 时查看匹配当前角度的草稿；显式 angle 默认只用保存键。`useDraft:true` 也只使用该角度匹配的对象草稿，其他角度草稿仍保留，并以 `hasUnappliedDraft` 提示。`commands` 可作假设预览，使用同一校验链，不写工程。

<!-- scene-tested: frames -->
```json
{"method":"previewSceneFrames","request":{"angles":[{"x":0,"y":0},{"x":15,"y":0},{"x":30,"y":0},{"x":45,"y":0},{"x":60,"y":0},{"x":75,"y":0},{"x":90,"y":0}],"width":800,"height":800,"showFills":true}}
```

帧预览只读取保存键，最多 31 帧，全程同一场景与固定相机。输出真实 Scene→Warp→单 cubic 拟合→PaintScene SVG，使用和 UI 相同的 `paintBatches`。检查 `sceneDiagnostics / fitDiagnostics / intervalTransportErrors / conflictingNodeIds`；没有诊断不等于美术已经验收。雾化仍需要真实 Canvas/Path2D，不能悄悄关闭填充来冒充完整图。

通过正常界面导出/载入完整工程 JSON：它同时保存 Drawing 库和 `recordingScenes` 引用。没有允许写入任意原始项目的 scene 命令。schema 包含 scenes、可选 viewpoints、instances、warps、bindings、visibilityTracks、intervalTracks、depthTracks；每条轨道的 keys 是 `{id,name?,angle,value}`，草稿是 `{angle,value}`。

旧 `vectorRecording` 原数据保留。显式 store 初始化/载入时，只在缺少新字段的情况下，将每个旧 rig 迁移为单实例兼容场景。迁移保留完整旧 angle lattice，包括重复值；未知来源不猜配件。带有 `recordingScenes` 的工程调用旧 `inspectRecording/recording/previewRecording/previewRecordingFrames` 会返回 `LEGACY_RECORDING_RETIRED` 并指向新接口；不会编辑或显示后台另一套 rig。缺少新字段的离线旧工程和兼容纯函数测试仍可使用旧逻辑。普通 parse/inspect/preview 不持久化迁移。

## 最小验收

先 inspect→dryRun→apply→真实 preview。验证同源两实例独立、跨实例共享 Warp、同父包父和子级插入全角度等价、各对象键数不同、源编辑同步全部实例、源删除/Undo 局部恢复、完整工程重载和一次 Undo。对旧稿比较关键角度与中间角的填充、区间材料和墨线，不能只比控制点。浏览器实操验证另行记录，代码或离线测试不能替代它。
