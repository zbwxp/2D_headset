# Contour AI 矢量创作操作手册

适用版本：2026-10-01 的 v7 源编辑接口，代码基线 `855c686`，`contourAI` 版本 1.3。本文面向操作现有矢量画稿的 AI，也可供开发者实现固定 JSON 接入。

优先使用应用已经提供的结构化接口：查询真实 ID，预演，执行一个小而完整的事务，检查结果。不要用截图重建用户的原画，不要猜 ID，不要用任意 JavaScript、原始工程替换或默认资产文件覆盖来绕过接口。

本文与 [接口详细定义](vector-editing-api.md) 配套。旧的 [Drawing Room 操作手册](ai-drawing-room-guide.md) 保留历史交互说明；涉及当前 AI 接口、模式和术语时，以本页为准。

## 1 入口与能力发现

打开应用的「AI 编辑」界面。文本框接受两种固定 JSON 形态：

- 普通批次：包含 `commands` 数组，可附 `expectedRevision` 与 `dryRun` 字段
- 固定方法：包含 `method` 与 `request`；method 只允许 `inspect`、`preview`、`artwork`、`inspectArtworks`

点击「预演命令」只检查；点击「执行（可撤销）」提交。界面的「检查源稿」和「导出源稿 JSON」是独立按钮。输出可从 `data-testid="ai-api-result"` 读取；预览成功时会显示「源稿预览」图像。不要解析整个对话框的文字，也不要向文本框发送函数、脚本或未知 method。

程序接入使用固定的 `window.contourAI` 方法：`help / inspect / execute / preview / select / exportSource / inspectArtworks / artwork / undo / redo / convertPoint`。`help()` 返回版本、命令名与限额；它不是执行任意代码的入口。当前可见 JSON 路由只接受上面四个 method，不能凭方法列表推断所有方法都可通过同一个界面信封调用。

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

读取 `mirrorAxisX=a`。源坐标镜像矩阵为 `[-1,0,0,1,2*a,0]`。UI「水平镜像」使用选择包围盒中心，含义不同；不要把它误认为全局镜像轴。

<!-- tested: mirror-layer -->
```json
{"commands":[{"op":"duplicateLayer","layerId":"SOURCE_LAYER_ID","ref":"mirror"},{"op":"transformLayers","layerIds":["$mirror"],"matrix":[-1,0,0,1,-0.6589609028577848,0]},{"op":"setLayer","layerId":"$mirror","name":"左眼内结构"},{"op":"reorderLayer","layerId":"$mirror","targetLayerId":"SOURCE_LAYER_ID","after":true}]}
```

`SOURCE_LAYER_ID` 必须由查询结果替换。这个数字矩阵只适用于实测正面稿的 `a=-0.3294804514288924`，不适用于任意新画稿。验证每个 P0/H0/H1/P1：`x左=2a-x右`、`y左=y右`。镜像几何后还要检查填充、隐藏边界、图层顺序和区间，不能只比较像素轮廓。

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

**v7 的位置联动本身不等于平滑/ARC，也不宣称存在跨层贯通显示路径。** 跨层 through 路由、有效末端抑制和 ink ARC 的消费尚待对应版本部署，不要发送猜测的 `joinBrush`/route 字段。旧局部 ARC 不应接到隐藏内部闭合线上。需要保留旧 ARC 的参数时，保留原画稿与明确的参数记录，待实际支持的新关联契约接入。

## 8 区间隐藏线条而保留填充

`addDisplayInterval(curveId,...)` 选择该曲线所在的派生笔画。对已经闭合的三段环调用 `start:0,end:1` 会作用于整条环，不是只作用于传入的那一段。

<!-- tested: hide-range -->
```json
{"commands":[{"op":"addDisplayInterval","curveId":"PATH_CURVE_ID","mode":"HIDE","start":0.2,"end":0.4,"ref":"gap"},{"op":"setDisplayIntervalEnd","rangeId":"$gap","end":0,"style":{"taper":0.04,"extension":0}}]}
```

百分比是整个显示路径的归一化弧长。闭合路径 start>end 会跨过 1→0。现有 SHOW 仍会限制可见部分；需要改变时显式禁用/删除它，不要把新 HIDE 当作自动重置旧 SHOW。

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

普通预览和导出干净，不包含 AI 辅助线。需要机器辅助时，显式传 `annotations:{curveIds:[...],grid:true,labels:true,handles:true,diagnostics:true}`，最多 32 曲线。辅助视图是临时状态，不写进画稿。对比前后图时固定 center、pixelsPerUnit 和输出尺寸，避免自动适配造成伪位移。浏览器外带雾化填充的预览可能返回 `BROWSER_REQUIRED`，不能偷偷换成简化外观。

## 10 本次实际操作记录

1. 在原正面稿之外保存独立无发副本，移除六个头发图层并隐藏参考图，原画稿保留
2. 以角色右侧（画面左侧）的眼睑、眼内结构、眉、耳为源，实际使用 UI 复制与固定 JSON 仿射命令完成镜像。49 曲线、196 控制点精确对称；恢复并核验 12 条隐藏眼内边界，填充保留
3. 使用节点/handle 数值命令使单片脸、嘴和鼻对称，保留原真实下巴 ARC 和共享几何节点。冠顶随后按用户要求降低；上方几何保留，用 HIDE 隐线
4. 实际发现闭环 HIDE 结束于 1 时，一侧末端笔触丢失。修复的是有效区间运算与 0/1 容差，没有靠移动几何或写不等笔触掩盖问题
5. v7 实际执行了两个三曲线脸片的创建、六次 POSITION 合并与两个白色填充。每片都是独立的真实三节点闭合环。内部闭合线的两个 handle 向另一半偏移 0.10 源单位，形成重叠；该构建阶段仍保留旧脸片，随后按真实新路径测量遮盖范围

当前两片实测路径均按「上缘 → 下颌 → 内部闭合」正向。右片上缘终点弧长比例 `0.35870166107613266`，左片为 `0.3587016610761327`；两片下颌终点均为 `0.5889569240999535`。针对这份特定阶段稿，HIDE `[0,上缘终点]` 与 `[下颌终点,1]` 可只留下下颌墨线。上述比例不是通用面部常数；几何、顺序或路径变化后必须重新测量。

两片阶段二已经实际通过固定 JSON 界面完成 dry-run、执行、保存与重新载入：四个 HIDE 范围、旧脸片移除、真实下巴跨层位置联动。结果为 121 曲线、13 图层、20 填充；每片 3 个真实共享节点，其他 115 曲线与既有非脸部填充保持原样。两片控制点精确镜像，内部闭合曲线最大越过中轴 0.075 源单位。**当前下巴的 authored 收尖仍保留，位置联动本身不会抹去缺口；跨层 ink ARC 仍未记为完成。**旧 ARC 的字段 `radius=0.05257222158088604` 保存在原稿/操作记录中，它代表既有两侧影响范围，不能被未经支持的新字段假装成已渲染的跨层圆弧。

## 11 最后检查与测试来源

提交后至少检查：所属画稿 ID、图层数量、真实节点共享、closed stroke、填充诊断、显隐/锁定、位置联动、末端笔触、普通预览、Undo/Redo、重新载入后的保存状态。不要只看截图像不像。

本页 JSON 示例由 `src/tests/ai-authoring-guide.test.ts` 从文档原文读取并验证，占位 ID/revision 由测试中的真实查询结果替换。源连接的两片配方还覆盖于 `vector-source-connections.test.ts`；依赖复制、源 CRUD、画稿事务、闭环笔触分别有独立回归。

```sh
npx vitest run src/tests/ai-authoring-guide.test.ts src/tests/vector-source-connections.test.ts src/tests/vector-editing-api.test.ts src/tests/vector-editing-crud.test.ts src/tests/vector-artwork-api.test.ts
```

截至本页版本：源/画稿 CRUD 与固定 JSON 操作可用；跨层显示路由/ink ARC 仍须等待对应部署并重新实测。不要把源码里尚未接入运行时的模块当作现在线上能力。
