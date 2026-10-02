# Contour AI 矢量创作操作手册

当前 Recording 使用 API 2.0 的 `inspectScene / scene / previewScene / previewSceneFrames`，完整契约见 [场景接口](recording-scene-api.md)，最短操作顺序见 [录制作者流程](recording-author-checklist.md)。本页的源编辑合同仍适用；明确标注的旧单画稿 rig 记录只作历史参考。

本文对应2026-10-02已发布的 v27，功能代码 `6b72514`，`contourAI` 2.0。Recording 现以显式视角组织编辑，右侧复用 Drawing 图层控件；每个有图层的来源实例只有一个可折叠组，层行标注跨实例的全局层序。分组只改变列表展示，不改变渲染顺序。v18/v19 新场景首轮真实浏览器验收范围见[发布验证记录](recording-scene-release-validation.md)。v22 已实测：无 Warp 建立 90°、隐藏嘴部成员并更新、建立 0°；新 Warp 自动获得 0°/90°中性键，90°实际拖节点并更新，45°网格严格中值且禁止编辑，实拖滑杆回 90°恢复且无警告。A/V/Z/Space 全操作未扩测，v23已另行实测每实例唯一标题：正面2层、侧面1层，整体折叠/展开恢复，层序1/3/2不变；没有将v22主流程声称为v23重跑。Drawing 是可复用源稿库，Recording 引用多个实例并按对象保存独立关键帧。源连接、显示路由、末端笔触、镜像和临时视图的旧版实测记录保留在下文，不能当作本次完整验收。

优先使用应用已经提供的结构化接口：查询真实 ID，预演，执行一个小而完整的事务，检查结果。不要用截图重建用户的原画，不要猜 ID，不要用任意 JavaScript、原始工程替换或默认资产文件覆盖来绕过接口。

**当前验证边界**：v8 的区间材料漂移已在 v9 修正，源 API 四方向小移与共同 Warp 小幅拖动完成实际重测。v11 又验证了显式镜像配对、中心轴约束，以及开放路由末端拖动不再跨支路翻转。直接拖柄与 API 输出曾核验一致，但重合的真实端点/区间标记仍需注意命中对象；独立分层 Warp 的完整 UI 转头验收尚未完成。不能把这些有限结果扩展成全部交互与姿态都已稳定的承诺。

本文与 [接口详细定义](vector-editing-api.md) 配套。源码仓库中的旧手册 `docs/ai-drawing-room-guide.md` 保留历史交互说明；涉及当前 AI 接口、模式和术语时，以本页为准。

## 1 入口与能力发现

打开应用的「AI 编辑」界面。文本框接受两种固定 JSON 形态：

- 普通批次：包含 `commands` 数组，可附 `expectedRevision` 与 `dryRun` 字段
- 固定方法：包含 `method` 与 `request`；源稿 method 为 `inspect`、`preview`、`artwork`、`inspectArtworks`、`select`

点击「预演命令」只检查；点击「执行（可撤销）」提交。界面的「检查源稿」和「导出源稿 JSON」是独立按钮。有效方法的 JSON 输出可从 `data-testid="ai-api-result"` 读取；信封语法错误或未知 method 在 v13 的界面层可能仍显示纯文本错误，先检查而不要把它当成成功 JSON；预览成功时会显示「源稿预览」图像。不要解析整个对话框的文字，也不要向文本框发送函数、脚本或未知 method。

程序接入使用固定的 `window.contourAI` 方法：源稿使用 `inspect / execute / preview / select / exportSource / inspectArtworks / artwork`，录制使用 `inspectScene / scene / previewScene / previewSceneFrames`，临时视图使用 `inspectView / view / snapView`。`help()` 返回版本、命令名与限额；它不是执行任意代码的入口。固定信封只接受界面列出的 method；导出源稿使用界面独立按钮。带 scene 的工程调用旧 `inspectRecording / recording / previewRecording / previewRecordingFrames` 返回 `LEGACY_RECORDING_RETIRED`，请改用对应 scene 方法；旧数据仍保留。

<!-- tested: inspect-nose -->
```json
{"method":"inspect","request":{"layerNames":["鼻部"],"includeRecording":false}}
```

这是实际浏览器执行过的查询形态。名称过滤会返回所有匹配项；名称可以重名。写入必须改用结果中的稳定 ID。可组合 `layerIds / layerNames / curveIds / curveNames / strokeNames / nameIncludes`，过滤条件按 AND 连接。空结果不是权限成功或选中了默认对象。

检查 `mode`、`sourceEditable`、`sourceId`、`apiVersion` 与返回的 `revision`。`includeRecording:false` 可避免输出全部关键形数据。图层的 `effectiveState` 才是成员显隐和锁定状态汇总；旧 `visible/locked` 容器字段不代表继承式开关。填充与偏移对象具有所属 `layerId`，其源曲线可能在另一图层。

## 2 三种对象不能混用

- **端点**：真实 Bézier 的 P0/P1。它有几何 node ID，可参与共享节点或位置联动
- **区间**：路径上的 SHOW/HIDE 覆盖范围。`start/end` 是归一化弧长，不是 Bézier t，也不是新的 node
- **末端**：最终可见墨线的端部。它可能在区间裁切处，位于曲线内部

只共享 **末端笔触**：收尖、延伸与接笔外观。`TerminusBrushStyle` 不统一三者的位置、编辑行为或拓扑。不要把“区间起止”当成可移动的源端点；不要因为两条线在画面上重合，就声称它们已经真实连接。

`controls` 将 P0/P1 与 H0/H1、node ID、curve ID 明确区分。`activeCreationLayerId` 是当前创建图层，不一定是选中对象的所属图层。

## 3 坐标与工作模式

源坐标 X 向右、Y 向上；四个控制点是绝对位置 `[P0,H0,H1,P1]`，不是相对 handle。屏幕和参考图像像素的 Y 方向、缩放与偏移不同。程序接口的 `convertPoint` 可在 source、canvas、client、reference 空间间转换；不要直接把截图像素写进节点坐标。

`inspect().bounds` 是精确 cubic 中心线包围盒，不含线宽、末端延伸、雾化或偏移线。`preview()` 渲染源稿，不是录制姿态，也不是逆向匹配照片的求解器。

- **绘制模式**：允许源几何、拓扑、图层、填充、区间与画稿库操作
- **录制模式**：上述写入返回 `MODE_RESTRICTED`。接口不会自动切换模式
- 源查询、源导出和画稿元数据可在录制模式读取；源修改的 Undo 也必须回到绘制模式
- 录制 Warp、关键形与角度区间覆盖通过独立的 [Recording 场景接口](recording-scene-api.md) 编辑，不通过本源命令集写入。不能拿录制后的拟合控制点覆盖源稿

### 每份快照自己的图层工具

Drawing 和 Recording 使用同一个多快照图层面板：Drawing 传入当前一份画稿，Recording 传入多个实例。每份快照都有自己的眼睛、填充预览和展开/折叠工具；有该快照内选中的层时只作用这些层，没有该快照内选择时作用它的全部已载入层。跨快照混选时先按实例求交集，点击 A 的工具不会改 B；同一画稿加载两次也分别控制。跨快照选择和建立共享 Warp 仍保留，Warp 创建工具单独成栏。

共享交互以 Drawing 原实现为基础，保留 Ctrl/Cmd 增减选择、Shift 连选、组/笔画/成员选择、图层排序、锁定与结构工具。Drawing 的操作写源稿；Recording 的显隐和层序写当前角度的姿态草稿，通过「更新此视角」提交，结构和源锁定仍回 Drawing 操作。填充工具仅切换临时预览，折叠也只是列表状态，都不生成关键帧或修改源。未建立视角时姿态眼睛/排序仍禁用，临时填充预览和折叠可用。

### Recording 的视角流程

左侧调整角度并「建立视角」，右侧加载画稿、选择图层并按需建立 Warp。没有已建立视角的角度在 UI 中只可预览，不能修改显隐、层序或网格；这个限制属于 UI，`scene` API 的 `setAngle`、草稿编辑和 `saveSelected` 仍可在未建立视角的角度使用，受原有模式与对象草稿角度校验约束。

「更新此视角」对应 `updateViewpoint(viewpointId)`，不要求选中对象或存在 Warp；它只保存该视角角度的已有脏通道，保留其他角度草稿和未改动通道。`createViewpoint` 只建立位置，不采样已有轨道。先建立视角、再创建 Warp 时，新 Warp 在各已建立视角获得自己的中性键，其他对象不会补键。完整命令和旧场景兼容规则见[命名视角与更新](recording-scene-api.md#命名视角与更新)。

### Recording 画布：Warp 整体与网格局部

v27 的录制画布以当前 Warp 为编辑对象。V 选择整个 Warp，拖动其弯曲网格区域或节点会整体平移全部网格点，U/V 柄一起移动；A 选择局部节点、网格边的两个端点或已显示的 Warp Bézier 柄。Shift 增减节点选择，空白框选用于网格；画布内 Ctrl/Cmd+A 或「全选网格」选中全部网格点。Z 和空格用于缩放与平移视口。没有当前 Warp 时，先从右侧选层创建，或选已有 Warp；录制画布始终不写源 Bézier。

「整行／整列」是一次性选择：已有选点时立即扩展为这些点所在的行／列；没有选点时等待下一次点选再扩展。之后点一个未选中的点恢复单点选择；拖动已选成员保留整组选点。「全选网格」随时清除待执行的行／列模式，显示网格并把键盘焦点放回画布。方向键每次移动1个屏幕像素，Shift 为10像素，Alt/Option 为0.1像素；两修饰键同时按下时 Shift 优先。输入框和其它界面控件中的方向键不会移动网格。连按形成一次草稿提交，释放方向键时提交；未建立视角的预览位置不能改网格。Drawing 原有微调和源编辑交互不变。

显示网格与选择保存对象是两件事：空白点击保留当前网格；重选绑定同一 Warp 的图层会自动找回网格，按钮显示「显示已有 Warp」，不会重复建立或覆盖已有键。不同绑定或部分未绑定的混选给出就近说明，需要明确包父级或重新挂接。自动找回仅显示网格，不把 Warp 加入所选对象保存范围；实际点选或编辑网格才明确选择该 Warp。主操作「更新此视角」仍提交该角度全部已有草稿，不要求额外选中对象。

## 4 事务和失败处理

推荐循环：查询 → 保存独立副本 → 小批次 dry-run → 同 revision 执行 → 查询/预览核验 → 保存快照。任何 UI 编辑、Undo、换画稿或工程替换都可能使 revision 失效。

批次先在分离的草稿上逐条校验，全部成功后只进入一次正常 store 事务。失败、预演与无变化不增加 Undo。不要捕获错误后跳过坏命令继续提交剩余部分。

创建命令可声明 `ref:"copy"`；同一批次后续 ID 字段使用 `$copy`。复制的映射还可使用 `$copy/原对象ID`。引用不能前向使用、重复声明或与真实 ID 冲突。dry-run 的新 ID 是临时的，不保留给下一次执行；重放同一批次时应继续使用引用。

<!-- tested: create-layer -->
```json
{"commands":[{"op":"createLayer","name":"AI 测试层","ref":"newLayer"},{"op":"setLayer","layerId":"$newLayer","name":"AI 已命名层"}],"dryRun":true}
```

实际提交时读取最新 revision，加入 `expectedRevision`，把 `dryRun` 改为 false。`created` 返回新 ID 与复制映射；`addedCurves` 返回新曲线；`beforeAfter` 描述已有曲线变化；`removed` 返回删除的 ID。需要重新查询的关联对象会体现在变化 ID 中。

遇到 `STALE_REVISION`：重新查询并重算。遇到锁定或关联选择错误：明确确认作用域或显式解锁，不要使用 `allowRelated` 绕过锁。遇到 `GEOMETRY_INVALID`：保留原稿，修正整批命令。删除填充边界时必须同时处理依赖填充，不能留下悬空引用。

## 5 已提供的源操作

| 类别 | 命令与主要参数 |
|---|---|
| 源点与形状 | `moveNode(nodeId,position)`；`moveHandle(curveId,end,position)`；`transformCurves(curveIds,matrix,allowRelated?)`；`deformCurves(curveIds,bounds,quad,allowRelated?)` |
| 曲线创建与细分 | `createCurve(layerId,shape,width?,name?,ref?)`；`splitCurve(curveId,t,ref?)`；`renameCurve`；`renameStroke`；`setCurveWidth` |
| 图层 | `createLayer`；`duplicateLayer`；`deleteLayers`；`setLayer`；`reorderLayer`；`transformLayers`；`moveToLayer` |
| 对象显隐与删除 | `setObjectState(objectIds,visible?,locked?)`；`deleteObjects(objectIds)`；`setInkVisibility(curveIds,visible)` |
| 对象复制与顺序 | `duplicateObjects(objectIds,targetLayerId?,includeDependencies?,ref?)`；`reorderObject`；`reorderCurveMember`；`setDepth` |
| 填充 | `createFill(curveIds,color,kind?,ref?)`；`setFill(fillId,name?,color?,visible?,locked?,mist?)`；通过 `deleteObjects` 删除；`movePaint` 移动所属层 |
| 偏移线 | `createOffset`；`setOffset`；`detachOffset`；显隐/删除使用通用对象命令 |
| 组合 | `createGroup`；`setGroup`；`ungroup`；`groupToLayer` |
| 线条外观 | `setInkStyle`；`setContourMist`；`setCurveInkEnd` |
| 源区间 | `addDisplayInterval`；`changeDisplayInterval`；`removeDisplayInterval`；`setDisplayIntervalEnd` |
| 几何连接 | `connectGeometry`（仅 POSITION）；`linkEndpoints`；`unlinkEndpoints` |
| 镜像参考 | `setMirrorAxis(x)`；镜像使用仿射矩阵，不使用屏幕拖拽估计 |

参数完整枚举见 [接口契约](vector-editing-api.md) 和 `help()`。未知字段会被拒绝。颜色为 `white/black/transparent`；透明填充是所在图层内的挖空，不是关闭所有填充。

复制整层保留成员的显隐、锁定、墨线开关、填充与顺序。对象复制保留同一图层内完整依赖；若需额外共享节点、组合、填充或偏移源，默认拒绝并要求 `includeDependencies:true`。跨图层依赖不会被偷偷拆掉或压平。

`reorderObject` 按现有笔画/组合排序，`reorderCurveMember` 才是同一连续笔画内部的段顺序。`setInkStyle` 和线宽编辑可作用于整条连接笔画；`setInkVisibility` 仅修改所选段的墨线。图层/组合显隐会批量改当前成员，包含填充；后续新建成员不会继承一个隐式隐藏门。

## 6 镜像必须指定真正的轴

读取 `mirrorAxisX=a`。源坐标镜像矩阵为 `[-1,0,0,1,2*a,0]`。UI「水平镜像」使用选择包围盒中心，含义不同；不要把它误认为全局镜像轴。 矩阵变换是一次性操作，不会自动登记持续左右配对；后续单侧修改不因此自动镜像。持续镜像配对需使用下面独立的显式配置能力，不能由轴线或名称相近推断。

<!-- tested: mirror-layer -->
```json
{"commands":[{"op":"duplicateLayer","layerId":"SOURCE_LAYER_ID","ref":"mirror"},{"op":"transformLayers","layerIds":["$mirror"],"matrix":[-1,0,0,1,-0.6589609028577848,0]},{"op":"setLayer","layerId":"$mirror","name":"左眼内结构"},{"op":"reorderLayer","layerId":"$mirror","targetLayerId":"SOURCE_LAYER_ID","after":true}]}
```

`SOURCE_LAYER_ID` 必须由查询结果替换。这个数字矩阵只适用于实测正面稿的 `a=-0.3294804514288924`，不适用于任意新画稿。验证每个 P0/H0/H1/P1：`x左=2a-x右`、`y左=y右`。镜像几何后还要检查填充、隐藏边界、图层顺序和区间，不能只比较像素轮廓。


### 视角检查与工作区参考

左侧 XY 坐标窗口覆盖 X/Y 各 −90°…90°；+X 向画面右转，+Y 仰头。窗口显示当前光标和已建立视角，点击或拖动只预览角度，不建立关键形。精确数值、建立／更新视角位于同一区域；尚未建立的位置仍不能编辑姿态。

洋葱皮沿 X 或 Y 单轴以5°／10°采样，另一轴固定当前值，可设范围和透明度。淡色轮廓来自实际已保存姿态及显示区间，当前角度单独突出，不重复参考图、网格或隐藏闭合线。未更新的草稿只影响自身角度，应先更新视角再检查连续形变。采样只读，使用缓存和分批准备，不写当前角度、关键形或历史；普通导出不包含此叠图。

Recording 的「背景参考图」与 Drawing 共用照片载入、显隐、锁定、透明度、缩放、旋转和位置控件。Recording 通过独立视口适配器写入本机 IndexedDB，刷新同一工程／场景后恢复；不会改源稿或录制关键形，普通工程 JSON 和 SVG 不携带这项工作区参考。Drawing 源稿自带参考图的原有保存／导出行为保持。背景图平移期间不编辑 Warp；图片、快照参考和辅助线集中在 Recording 的同一个「参考 / 辅助线」弹层，独立滚动。XY、建立／更新和洋葱皮连续排列，打开参考不会顶走角度控件。

右侧创建／显示已有 Warp 工具栏固定在图层上方，画布工具栏的 Warp 下拉可随时找回当前网格。

### 持续镜像编辑（API 1.4 新增，已在 v11 实测）

这组命令配置 Drawing 源稿的几何关系，只有实际 `help()` 返回相应命令才可使用：

- `createMirrorPair {a,b,reverse?,ref?}`：明确配对两个 curve ID；reverse=true 表示一侧 P0 对另一侧 P1，H0 对 H1
- `setMirrorPair {pairId,a?,b?,reverse?}` / `deleteMirrorPairs {pairIds}`：按稳定配对 ID 修改或解除关系
- `setMirrorAxisNodes {nodeIds}`：设置显式轴上 node ID；已配对到自身的节点组件也会被约束在轴上
- `setMirrorEditing {enabled}`：开关。第一次登记配对默认关闭；开启只校验已有对称，不会替作者决定覆盖哪一边

查询返回 `mirrorEditing` 配置与 `mirrorEditingState` 汇总。配对修改使用同一个原子事务、预演、revision 和 Undo 规则；Recording 拒绝写入。关闭保留配对 ID，允许暂时不对称；再次开启时若两侧不符则明确拒绝。移动镜像轴必须先关闭镜像编辑。

打开后，节点与控制柄按显式关系镜像，中心节点锁 X、可改 Y；位置联动与已有平滑约束仍要同时满足。隐藏成员也参与几何关系，锁定的对侧会拒绝整批编辑。宽度、显隐、填充、层次、末端笔触与区间的作者设置不会自动成对覆盖；区间随最终几何传递原材料位置。

同批次的直接编辑意图会累计检查：若分别把两侧指定为不一致的位置，整批拒绝，不能靠命令顺序让最后一侧偷偷覆盖前一侧。对同一控件多次直接写入取最后一次；先改 handle 再平移其 node，handle 意图随 node 平移。实际配置变化创建新的约束阶段；无变化的开关或配置命令不会抹掉先前的直接编辑意图。分段、删除、复制等涉及已配对对象的拓扑操作目前要求先解除相关配对，再重新建立明确映射。

[双脸片严格配置批次](examples/two-face-mirror-editing-api-batch.json) 从已经核验的双脸片源 ID 生成，包含 54 个曲线配对（覆盖 107 条曲线）、7 个显式轴上节点与一次开启；剩余 14 条曲线未登记，不会因开关而自动配对。它默认 dryRun=true；必须先另存副本、核验源稿身份、填入最新 expectedRevision，预演后才实际执行。文件中的 ID 只适用于指定示例，不是按名称猜配对。`vector-mirror-editing-api.test.ts` 直接读取这份 JSON，证明开启不改任何几何或外观；v11 的实际浏览器已应用这 54 对/7 轴点配置：右耳 H0 的 X/Y 各移 +0.02 后对侧自动反射；鼻 P0 请求偏离轴 X+0.03 时被约束回轴，Y+0.01 保留。检查全部 54 对的最大反射残差为 0，Undo 后整个源 JSON 完全一致。

## 7 真闭合与跨层位置联动

`createCurve` 总会创建两个新的几何 node。坐标相等不会自动共享节点。新脸片应先合并同层端点，再建立填充和覆盖范围。

<!-- tested: closed-piece -->
```json
{"commands":[
 {"op":"createLayer","name":"闭合脸片示例","ref":"face"},
 {"op":"createCurve","layerId":"$face","shape":[[0,1],[-0.6,1],[-0.8,0.6],[-0.7,0]],"width":0.008,"ref":"cap"},
 {"op":"createCurve","layerId":"$face","shape":[[-0.7,0],[-0.7,-0.3],[-0.3,-0.8],[0,-0.9]],"width":0.008,"ref":"jaw"},
 {"op":"createCurve","layerId":"$face","shape":[[0,-0.9],[0.2,-0.5],[0.2,0.6],[0,1]],"width":0.008,"ref":"closure"},
 {"op":"connectGeometry","mode":"POSITION","a":{"curveId":"$cap","end":1},"b":{"curveId":"$jaw","end":0}},
 {"op":"connectGeometry","mode":"POSITION","a":{"curveId":"$jaw","end":1},"b":{"curveId":"$closure","end":0}},
 {"op":"connectGeometry","mode":"POSITION","a":{"curveId":"$closure","end":1},"b":{"curveId":"$cap","end":0}},
 {"op":"createFill","curveIds":["$cap","$jaw","$closure"],"color":"white","ref":"skin"}
]}
```

这是测试覆盖的独立示例，不是用这些坐标覆盖用户的脸。结果应有 3 曲线、3 真实节点、1 closed stroke、1 有效填充。两个镜像脸片各自独立闭合，合计 6 节点；它们不能偷偷共享跨层 node。

`connectGeometry` 仅合并同层几何节点，保留 authored 末端笔触。它拒绝会同步不同 width/profile 的合并，也检查零位移时的联动锁定依赖。若相关笔画已有 whole-stroke 区间，会返回 `INTERVAL_TOPOLOGY_CONFLICT`，避免弧长范围被偷偷解释到更长的新笔画上。

所以新片的顺序是：**同层真闭合 → 填充 → 区间 → 跨层位置联动**。这不否定“先区间再联动”：后者指下面的 `linkEndpoints`，不是同层共享节点合并。

<!-- tested: link-ports -->
```json
{"commands":[{"op":"linkEndpoints","a":{"curveId":"RIGHT_JAW_ID","end":1},"b":{"curveId":"LEFT_JAW_ID","end":1},"ref":"chinLink"}]}
```

该命令保持图层、节点 ID 和笔画独立，把 B 端及其联动位置移到 A 端；相邻 handle 跟随位移。API 保留作者的末端笔触。`unlinkEndpoints(linkId)` 只解除位置联动，不自动把几何移回旧位置；要完整恢复此前编辑，用 Undo。

**位置联动本身仍不等于平滑/ARC。** v8 已提供显式接入显示路由：先已有真实端点联动，再设置共享末端接笔笔触并采用指定区间轨道的路径。旧局部 ARC 不应接到隐藏内部闭合线上。

<!-- tested: route-arc -->
```json
{"commands":[{"op":"setLinkJoinBrush","linkId":"CHIN_LINK_ID","brush":{"kind":"ARC","trimDistance":0.05257222158088604}},{"op":"adoptDisplayRoute","trackId":"RIGHT_FACE_TRACK_ID","linkId":"CHIN_LINK_ID"}]}
```

这是实际双脸片操作的命令顺序。ID 必须从当前稿的 endpointLinks/displayIntervals 查询获得。`trimDistance` 是两侧请求的裁切影响距离，不是固定圆半径。接笔类型还支持 SHARP 和 SMOOTH；不满足当前几何/线宽/样式支持条件时应处理错误，不要为了通过校验偷偷同步用户样式。

`adoptDisplayRoute` 把已有覆盖先按旧路径的真实材料位置捕获，再映射到显式新路径；节点、几何图层与填充不合并。它不是把原百分比直接套在变长的路径上。旧范围可能分成带 `originId` 的多个可编辑片段；请重新查询新的 track/range 列表，不要假设一个旧 ID 仍代表全部片段。混合 SHOW 与隐式全显时，可能出现可见、可编辑的「保留原可见范围」，它用于保持此前覆盖。

只有接入有效显示路由且接合两侧确实可见时，渲染才抑制接合处的有效末端笔触。作者的 cap/收尖仍保留，其他外露末端不应受影响。`detachDisplayRoute(trackId)` 显式退回局部路径并保留几何联动；如果某段覆盖只存在于新 ARC 上、不能无损映回局部源线，它应拒绝并要求作者处理。被采用的 link 不能直接 unlink；先明确解除相关显示路由。

## 8 区间隐藏线条而保留填充

`addDisplayInterval(curveId,...)` 选择该曲线所在的派生笔画。对已经闭合的三段环调用 `start:0,end:1` 会作用于整条环，不是只作用于传入的那一段。

<!-- tested: hide-range -->
```json
{"commands":[{"op":"addDisplayInterval","curveId":"PATH_CURVE_ID","mode":"HIDE","start":0.2,"end":0.4,"ref":"gap"},{"op":"setDisplayIntervalEnd","rangeId":"$gap","end":0,"style":{"taper":0.04,"extension":0}}]}
```

百分比是整个显示路径的归一化弧长。闭合路径 start>end 会跨过 1→0。 API 1.4 新增显式 `fullLoop:true` 表示闭合路径的一整圈，会把区间起止规范到相同位置；没有该标志时相同起止表示空区间。它只允许真正闭合的显示路径，开放路径与 CURVE 局部范围会拒绝。后续只改 start/end 会清掉 fullLoop，除非同时明确再次指定 true；单独改 mode/enabled 则保留。跨过 0/1 不应被当作自动翻转显示规则。现有 SHOW 仍会限制可见部分；需要改变时显式禁用/删除它，不要把新 HIDE 当作自动重置旧 SHOW。

填充使用完整闭合边界，HIDE 只裁墨线。内部闭合线可以延伸到另一半脸形成面积重叠，再用覆盖区间隐藏它。不要删掉内部几何来消除脸上的接缝，否则填充会失去闭合或重叠余量。

区间终点样式是末端笔触。新 HIDE 使用默认宽度倍数收尖；修改时只写明确请求的 style。真正的连接状态应由渲染端抑制有效末端笔触，不能为了无缝连接把作者的原笔触永久清零。闭环 0/1 接缝的有效笔触传播已有回归测试，包含旋转/反向路径和浮点小片段。

## 9 画稿库和导出

<!-- tested: save-copy -->
```json
{"method":"artwork","request":{"op":"save","name":"AI 操作副本","expectedRevision":"LATEST_REVISION"}}
```

没有 artworkId 的 save 总会新建 ID，即便名称相同。有明确 artworkId 的 save 更新那一份并保留 rig 映射。rename 只改名字，不捕获未保存几何。restore 默认拒绝丢失未保存源稿；确实需要时显式使用 `discardUnsaved:true`。delete 保留当前画布，可正常 Undo；存在录制 rig 的画稿禁止删除，避免遗失关键形。

<!-- tested: list-artworks -->
```json
{"method":"inspectArtworks","request":{}}
```

源 JSON 导出默认不带参考图像像素，也不含完整工程的画稿库/录制数据。要交付整个工程，另用应用的工程 JSON 导出。不要把 DrawingDocument 文件称为完整工程。

<!-- tested: preview -->
```json
{"method":"preview","request":{"width":600,"height":600,"showFills":true,"expectedRevision":"LATEST_REVISION"}}
```

临时参考画稿、辅助线和标尺使用独立的 [视图接口](vector-workspace-view-api.md)，不写源稿或 Undo。普通预览和导出干净，不包含 AI 辅助线。需要机器辅助时，显式传 `annotations:{curveIds:[...],grid:true,labels:true,handles:true,diagnostics:true}`，最多 32 曲线。辅助视图是临时状态，不写进画稿。对比前后图时固定 center、pixelsPerUnit 和输出尺寸，避免自动适配造成伪位移。雾化填充需要真实 Canvas/Path2D；裸 Node 可能返回 `BROWSER_REQUIRED`，不能偷偷换成简化外观。经验证的真实 Canvas 离线适配器可走同一 PaintScene/雾化算法，但不替代浏览器交互验收。

## 10 本次实际操作记录

1. 在原正面稿之外保存独立无发副本，移除六个头发图层并隐藏参考图，原画稿保留
2. 以角色右侧（画面左侧）的眼睑、眼内结构、眉、耳为源，实际使用 UI 复制与固定 JSON 仿射命令完成镜像。49 曲线、196 控制点精确对称；恢复并核验 12 条隐藏眼内边界，填充保留
3. 使用节点/handle 数值命令使单片脸、嘴和鼻对称，保留原真实下巴 ARC 和共享几何节点。冠顶随后按用户要求降低；上方几何保留，用 HIDE 隐线
4. 实际发现闭环 HIDE 结束于 1 时，一侧末端笔触丢失。修复的是有效区间运算与 0/1 容差，没有靠移动几何或写不等笔触掩盖问题
5. v7 实际执行了两个三曲线脸片的创建、六次 POSITION 合并与两个白色填充。每片都是独立的真实三节点闭合环。内部闭合线的两个 handle 向另一半偏移 0.10 源单位，形成重叠；该构建阶段仍保留旧脸片，随后按真实新路径测量遮盖范围

完整的实际请求、返回的新 ID、两次预演/执行结果与保存结果见 [双脸片实际 API 配方](examples/two-face-executed-api-recipe.json)。文件内的 revision 和对象 ID 是那次会话记录，不能原样重放到别的工程；测试会依据本次新返回的 ID 重映射第二阶段。

当前两片实测路径均按「上缘 → 下颌 → 内部闭合」正向。右片上缘终点弧长比例 `0.35870166107613266`，左片为 `0.3587016610761327`；两片下颌终点均为 `0.5889569240999535`。针对这份特定阶段稿，HIDE `[0,上缘终点]` 与 `[下颌终点,1]` 可只留下下颌墨线。上述比例不是通用面部常数；几何、顺序或路径变化后必须重新测量。

两片阶段二已经实际通过固定 JSON 界面完成 dry-run、执行、保存与重新载入：四个 HIDE 范围、旧脸片移除、真实下巴跨层位置联动。结果为 121 曲线、13 图层、20 填充；每片 3 个真实共享节点，其他 115 曲线与既有非脸部填充保持原样。两片控制点精确镜像，内部闭合曲线最大越过中轴 0.075 源单位。**随后在 v8 实际采用显示路由与 ARC；authored 收尖仍保留，接合抑制发生在有效渲染中。**旧 ARC 的字段 `radius=0.05257222158088604` 保存在原稿/操作记录中，它代表既有两侧影响范围；实际新命令使用 `brush:{kind:"ARC",trimDistance:0.05257222158088604}`。

### 看似断线时先查覆盖和层次

本次 ARC 已几何连续后，在 238% 放大下仍看见约 2px 白色缺口。临时关闭填充后缺口消失，说明是既有白色填充与元素绘制层次遮住了另一半 ARC。恢复填充后，对后方左下颌使用下面的元素深度偏移解决，没有移动曲线、删除填充、写不等末端笔触或添加临时遮罩：

<!-- tested: depth-fix -->
```json
{"commands":[{"op":"setDepth","curveId":"LEFT_JAW_ID","offset":1,"scope":"LAYER"}]}
```

这不是所有画稿都要套用的常数。先检查几何位置与宽度，再检查 SHOW/HIDE 和有效笔触，最后检查填充与 depth/绘制顺序。本次修正保持所属图层、6 个脸片节点与两个填充不变，只调整一个元素的相对绘制层次。

实际 ARC、深度修正、保存与视觉核验结果见 [双脸片 ARC 与层次 API 配方](examples/two-face-arc-depth-executed-api-recipe.json)。最终快照名为「无发·对称双脸片」，完整工程重新载入后源 JSON 一致。

### 最终区间简化：一段跨下巴的 SHOW

随后按用户对这张脸的明确选择，在保留原稿的副本中把四段 HIDE 简化为一段 SHOW：`[0.38526009094373365,0.6147399090562666]`，沿现有跨层路径只显示两侧下颌与下巴接笔，其余由 SHOW 规则隐藏。保留范围 ID `395ebef8-81c0-4a2d-ae61-34096a9c38a8`，移除另外三个范围，没有重画任何边界。

这是已实际执行、Undo 核验并保存的「无发·对称双脸片·简化区间」。含填充的前后 SVG 字节完全一致；独立 API 检查中可见材料范围、两端收尖、几何和填充也一致。[实际请求和保存结果](examples/two-face-one-show-executed-api-recipe.json) 保留了这次记录。此前“四 HIDE”是构建步骤，不是最终所选区间配置；两段 HIDE 方案只作等价比较，没有作为最终稿执行。

该等价关系只针对当时这份路径和笔触配置。后续修改 SHOW 边界仍应进行跨 0/1、空/整圈、小幅变形、Undo 与重载检查；不要把本次静态等价当作通用简化规则。右侧 90° 的第一轮参考源稿已另行制作，但参考画稿不是完成的转头 rig，也不代表各中间角度已视觉验收。

## 11 最后检查与测试来源

提交后至少检查：所属画稿 ID、图层数量、真实节点共享、closed stroke、填充诊断、显隐/锁定、位置联动、末端笔触、普通预览、Undo/Redo、重新载入后的保存状态。不要只看静态截图或空的 diagnostics。

带路由、区间和变形的画稿还必须在副本中做小幅稳定性检查：

1. 保存基准；固定预览中心、比例、输出尺寸，导出基准源 JSON
2. 在绘制模式，把真实联动端点分别沿 X/Y 正负方向小移（本次发现问题用的是 0.01 源单位），每次检查两侧节点、handle、可见墨线和隐藏闭合线，然后 Undo 回基准；不要累计四次移动
3. 在录制界面已有 Warp 控制下做小幅正负扰动与几个角度关键形检查。源接口当前不能写 Warp；不要编造本接口的录制命令
4. 检查区间仍覆盖原材料：下颌不应突然整段消失，颅顶/内部闭合线不应重新显现。相同百分比、几何诊断通过或节点仍联动，都不足以证明材料保持正确
5. 验证 Undo/Redo、返回默认姿态、保存并重新载入；比较源 JSON、区间和基准预览。出现整段跳变先撤销并报告，不要重画形状或修改 HIDE 百分比掩盖错误

v11 还实际拖动旧开放路由的末端从约 99% 到 100% 再向另一支路移动：保存值保持约 99.22704%，没有翻转到约 1%；三次 Undo 后源 JSON 精确恢复。这个结果针对开放路径，不替代闭环 fullLoop/空区间的专门检查。

这套检查曾揭示 v8 的区间边界材料识别错误。v9 已通过固定 JSON 源命令的 X/Y 四方向实际 UI 重测，每次 Undo 后整个源 JSON 完全一致。共同 Warp 的实际 UI 检查使用全部 13 图层、3×3 细分网格，将一整行 4 个控制点向上拖约 5 屏幕像素：脸部与下巴连续、颅顶仍隐藏，阈值 1 nominal px 下 0 段超差、0 端点冲突，观测最大误差约 0.89 nominal px；源稿 JSON 保持不变，Undo 后草稿清除、误差回到 0。同一小幅 Warp 还在 QA 副本保存为 AngleX=10 的关键形，重新载入后录制数据与源稿 JSON 完全一致，渲染连续；回到 0 后误差为 0。直接鼠标拖动源端点和独立分层 Warp 的 UI 检查仍须分别完成。后续只有相应验证通过，才能把某次画稿交付标为通过该路径的动态编辑/变形稳定性检查。

### 拟合超差和端点场冲突要分开处理

录制评估仍保持一条源 Bézier 对应一条输出 Bézier，且保留真实节点/联动节点的重合约束。一般的曲线拟合近似超差，可以回绘制模式人工分段后重新评估；系统不会为了通过误差检查偷偷增加节点。

`endpointConflict` / `endpointMismatchError` 则表示相同联动端点的不同入射曲线请求了不一致的变形位置。此时运行时把它们投影到共同位置以保持连接，同时报告冲突；增加曲线分段不能让两个互相矛盾的位置请求同时成立。应对齐相关 Warp 控制或使用共同父变形器，再检查完整姿态。

本次独立技术检查中，仅将一片脸的下巴 Warp 移动 0.01、另一片保持不动，两边实际输出共同移动 0.005；轮廓与区间没有断开，但四条入射曲线各报告 0.005 源单位的端点场不匹配（按每源单位 250 nominal px 换算为 1.25 nominal px，不是当前缩放下的屏幕像素）。这证明几何连接仍被保持，也说明控制请求需要协调；它不是建议将分歧隐藏或忽略诊断。

本页 JSON 示例由 `src/tests/ai-authoring-guide.test.ts` 从文档原文读取并验证，占位 ID/revision 由测试中的真实查询结果替换。实际双脸片 JSON 配方也由该测试在源示例上重放，依据真实新 ID 重映射后续步骤。源连接的两片配方还覆盖于 `vector-source-connections.test.ts`；依赖复制、源 CRUD、画稿事务、闭环笔触分别有独立回归。

```sh
npx vitest run src/tests/ai-authoring-guide.test.ts src/tests/vector-source-connections.test.ts src/tests/vector-editing-api.test.ts src/tests/vector-editing-crud.test.ts src/tests/vector-artwork-api.test.ts
```

截至本页版本：源/画稿 CRUD、固定 JSON 操作、显式显示路由与跨层 ink ARC 已在实际浏览器完成操作与保存核验。后续新增能力仍应先确认实际部署，不要仅凭源码中的模块名称推断线上可用。


## 12 历史：旧单画稿 +90° 转头示例

本节是旧单画稿 rig 的历史离线报告，不是 v18 scene 浏览器验收。当前录制请使用 [场景接口](recording-scene-api.md)。当时冻结工程为 `yaw-final-rig-project.json`，SHA-256 为 `c6aba9f1e8783a09274192b6039a43b2e9dbc4fde7d02efdaa2691ca3c7f9fc6`。它是实际 rig 工程，和右侧源参考稿不同：一份 134 曲线源稿、13 个 deformer，正向作者键为 X=0/15/30/45/48/50/55/60/90。原正面和侧面参考保持原样；当前源稿与已存画稿一致，没有未保存源修改。

本轮只制作正向 yaw 到 +90°，不包含头发或物理。负向 yaw 与 pitch 保持中立；-90° 与 Y±90° 锚点的完整 SVG/像素核验均与0°一致，不应把这些基础锚点当成其他方向的完成稿。

同一 artworkId/rigId、800×800 相机、center=[-0.3294804514288924,-0.05]、pixelsPerUnit=300 的实际 API 用真实 Canvas 与生产 PaintScene 输出完整填充/雾化 SVG。标准七帧 0/15/30/45/60/75/90 与交接细查 45/46/47/48/49/50/55 均无端点、区间传递、路由或填充错误；最大观测拟合误差约0.899 nominal px。有对应复核文件的0/45/48/49/50/55/60/90° SVG 均字节一致；其他帧也重新生成并检查，七张标准帧并非相同静图。

离线视觉复核确认：0°新增的 Q 白缺口与原48°的大白缝已修正，48/49°主轮廓连续，50°为单线。但46–49°仍短暂存在相连分支/窄双线，是当前已知的轮廓交接妥协。0°与不可变正面参考仍有少量边缘像素差，不宣称逐像素完全保持。数值诊断通过不能掩盖这些可见限制。

分离副本还验证了 inspect→dryRun→apply→Undo/Redo→保存键 ID 保持→解析重载，源稿和画稿库未变；未保存草稿切角度、Recording 写源稿均被拒绝。结果绑定上述精确文件哈希，见 [技术核验记录](examples/yaw-final-rig-api-validation.json)。

旧版仓库曾集成显式「0–90° 转头工作稿」载入操作，详见 [例稿继续编辑与复现](yaw-authoring-example.md)。它新增独立的正面参考、侧面参考和转头源稿/录制；先保存当前未存源稿，再按步骤建立新画稿，最后向当前录制追加新 rig。全部属于一次 Undo。画稿、rig、Warp 和关键形获得新 ID；源对象 ID 保持画稿内部作用域。现有录制容差和其他 rig 保留。载入器保留示例的已存角度与草稿，不静默归零或丢弃草稿。当前操作会留在 Drawing，便于立即撤销；要查看转头需主动切到 Recording。本段描述旧版载入器，v18 通过显式迁移保存兼容结果；不得将旧全场 saveKeyform 步骤用于新场景。

**历史验证边界**：当时工程上传未获所需确认，恢复后的浏览器状态读取超时，因此没有完成这份旧冻结工程的在线导入、手势和重载核验。包内成果可用于离线查看和继续制作，但必须保留这项边界；真实 Canvas 离线渲染不等于已通过浏览器验收。
