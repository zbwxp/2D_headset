# Contour AI 矢量创作操作手册

适用版本：2026-10-01 已实际操作的 v9，代码基线 `0ab9a55`，`contourAI` 版本 1.3。源连接自 v7 提供，v8 已部署显式显示路由与跨层末端接笔笔触。本文面向操作现有矢量画稿的 AI，也可供开发者实现固定 JSON 接入。

优先使用应用已经提供的结构化接口：查询真实 ID，预演，执行一个小而完整的事务，检查结果。不要用截图重建用户的原画，不要猜 ID，不要用任意 JavaScript、原始工程替换或默认资产文件覆盖来绕过接口。

**当前验证边界**：v8 曾出现联动下巴小移后的区间材料漂移（下颌隐去、颅顶显线）。v9 修正了路径交界处的材料识别，实际固定 JSON 源编辑已通过 X/Y 四方向小移与逐次 Undo 重测。实际录制 UI 的共同 Warp 小幅整行拖动也保持轮廓、隐藏颅顶与源稿。直接鼠标拖点修复尚未部署测试，独立分层 Warp 的 UI 测试也未完成；不能把这些有限结果扩展成所有交互与变形都已稳定的承诺。

本文与 [接口详细定义](vector-editing-api.md) 配套。旧的 [Drawing Room 操作手册](ai-drawing-room-guide.md) 保留历史交互说明；涉及当前 AI 接口、模式和术语时，以本页为准。

## 1 入口与能力发现

打开应用的「AI 编辑」界面。文本框接受两种固定 JSON 形态：

- 普通批次：包含 `commands` 数组，可附 `expectedRevision` 与 `dryRun` 字段
- 固定方法：包含 `method` 与 `request`；源稿 method 为 `inspect`、`preview`、`artwork`、`inspectArtworks`

点击「预演命令」只检查；点击「执行（可撤销）」提交。界面的「检查源稿」和「导出源稿 JSON」是独立按钮。输出可从 `data-testid="ai-api-result"` 读取；预览成功时会显示「源稿预览」图像。不要解析整个对话框的文字，也不要向文本框发送函数、脚本或未知 method。

程序接入使用固定的 `window.contourAI` 方法：`help / inspect / execute / preview / select / exportSource / inspectArtworks / artwork / undo / redo / convertPoint`。`help()` 返回版本、命令名与限额；它不是执行任意代码的入口。API 1.5 另提供 `inspectRecording / recording / previewRecording`；API 1.6 提供 `inspectView / view`。新方法需确认对应应用部署，不能凭源码中的方法列表推断当前界面已经可调用。

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
- 录制 Warp、关键形与角度区间覆盖目前不能通过本源编辑命令集写入。不能拿录制后的拟合控制点覆盖源稿

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

### 持续镜像编辑（API 1.4 新增，部署与实际检查待确认）

这组命令配置 Drawing 源稿的几何关系，只有实际 `help()` 返回相应命令才可使用：

- `createMirrorPair {a,b,reverse?,ref?}`：明确配对两个 curve ID；reverse=true 表示一侧 P0 对另一侧 P1，H0 对 H1
- `setMirrorPair {pairId,a?,b?,reverse?}` / `deleteMirrorPairs {pairIds}`：按稳定配对 ID 修改或解除关系
- `setMirrorAxisNodes {nodeIds}`：设置显式轴上 node ID；已配对到自身的节点组件也会被约束在轴上
- `setMirrorEditing {enabled}`：开关。第一次登记配对默认关闭；开启只校验已有对称，不会替作者决定覆盖哪一边

查询返回 `mirrorEditing` 配置与 `mirrorEditingState` 汇总。配对修改使用同一个原子事务、预演、revision 和 Undo 规则；Recording 拒绝写入。关闭保留配对 ID，允许暂时不对称；再次开启时若两侧不符则明确拒绝。移动镜像轴必须先关闭镜像编辑。

打开后，节点与控制柄按显式关系镜像，中心节点锁 X、可改 Y；位置联动与已有平滑约束仍要同时满足。隐藏成员也参与几何关系，锁定的对侧会拒绝整批编辑。宽度、显隐、填充、层次、末端笔触与区间的作者设置不会自动成对覆盖；区间随最终几何传递原材料位置。

同批次的直接编辑意图会累计检查：若分别把两侧指定为不一致的位置，整批拒绝，不能靠命令顺序让最后一侧偷偷覆盖前一侧。对同一控件多次直接写入取最后一次；先改 handle 再平移其 node，handle 意图随 node 平移。实际配置变化创建新的约束阶段；无变化的开关或配置命令不会抹掉先前的直接编辑意图。分段、删除、复制等涉及已配对对象的拓扑操作目前要求先解除相关配对，再重新建立明确映射。

[双脸片严格配置批次](examples/two-face-mirror-editing-api-batch.json) 从已经核验的双脸片源 ID 生成，包含 54 个曲线配对（覆盖 107 条曲线）、7 个显式轴上节点与一次开启；剩余 14 条曲线未登记，不会因开关而自动配对。它默认 dryRun=true；必须先另存副本、核验源稿身份、填入最新 expectedRevision，预演后才实际执行。文件中的 ID 只适用于指定示例，不是按名称猜配对。`vector-mirror-editing-api.test.ts` 直接读取这份 JSON，证明开启不改任何几何或外观；实际 UI 测试仍需在部署后完成。

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

临时参考画稿、辅助线和标尺使用独立的 [视图接口](vector-workspace-view-api.md)，不写源稿或 Undo。普通预览和导出干净，不包含 AI 辅助线。需要机器辅助时，显式传 `annotations:{curveIds:[...],grid:true,labels:true,handles:true,diagnostics:true}`，最多 32 曲线。辅助视图是临时状态，不写进画稿。对比前后图时固定 center、pixelsPerUnit 和输出尺寸，避免自动适配造成伪位移。浏览器外带雾化填充的预览可能返回 `BROWSER_REQUIRED`，不能偷偷换成简化外观。

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
