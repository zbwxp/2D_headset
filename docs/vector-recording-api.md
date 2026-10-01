# AI 录制接口与转头关键形流程

API 1.5 已实现并有测试；使用前通过 `help()` 和当前应用确认部署。源编辑指南见 [AI 创作手册](ai-authoring-guide.md)。这份接口只写现有录制 rig、Warp、姿态草稿和关键形，不接受原始工程替换，也不回写拟合出的源节点。

## 入口与模式

固定 JSON 界面提供 `inspectRecording`、`recording`、`previewRecording` 三个 method。程序入口为同名 `contourAI` 方法。

- `inspectRecording`、`previewRecording` 只读，可在两种模式查看
- `recording` 只能在 Recording；不会自动切换模式
- `recording` 的 request 包含 `commands`，可加 `expectedRevision`、`dryRun`
- 创建命令可用 `ref`，同批后续 ID 可写 `$ref`。预演生成的 ID 不保留给正式执行
- 全部命令先在独立草稿校验，整批成功后一次 `commitVectorRecording`；任何失败都不提交，也不增加撤销记录
- 源稿、画稿库及其他画稿的 rig 保持原样。操作目标是当前画稿的 rig，不按名称猜别的画稿

<!-- recording-tested: inspect -->
```json
{"method":"inspectRecording","request":{"includeKeyGrids":false}}
```

查询返回 rig/artwork ID、角度、是否有草稿、源变化提示、参数范围、Warp ID/名称/父级、rest/current 网格、图层绑定与关键形 ID/名称/角度。`deformerIds / deformerNames` 可筛选网格；`includeKeyGrids:true` 才附每个保存关键形的网格。名称可重名，编辑使用 ID。

`sourceReviewRequired:true` 时，先检查源稿变化。明确使用 `acceptSource` 才接受：保留 Warp/关键形，清理已删图层绑定；显示路径坐标系改变的区间角度覆盖会被清理，不能把旧百分比当成新路径的同一材料。不要自动接受来消除警告。若旧区间使当前插值无法计算，查询仍返回 rig/键/基础网格信息，并给出 poseEvaluationError 与 currentGrid:null；不要把基础网格误当成当前姿态。

## 坐标与网格身份

`rows / columns` 表示网格单元数。节点为行优先顺序，数量 `(rows+1)*(columns+1)`，节点身份用 `deformerId + index`。行号为 `floor(index/(columns+1))`，列号为 `index%(columns+1)`。

`grid.bounds` 是创建时的源/rest 矩形；`currentGrid.nodes` 是当前姿态的局部输出控制位置。父 Warp 随后作用于子 Warp 输出，不要把最终屏幕坐标直接写成子网格坐标。

- `position`：节点局部输出坐标
- `handleU / handleV`：绝对出柄位置，不是相对向量；入柄由节点反射得到
- `twist`：按单元坐标定义的混合导数向量，不是一个可见控制点
- `editGridNodes` 默认 `moveHandles:true`，移动节点会平移两个柄，保留其相对方向/长度；同条 edit 的显式 handle 字段随后覆盖
- bounds 和拓扑不由节点编辑改变；新网格允许 1–16 行/列。不要在已有关键形后用“重新建网格”伪装无损细分

## 最小命令集

| 命令 | 作用 |
|---|---|
| `ensureRig` | 缺失时建立当前画稿的 rig 和五个基础角度键；已有 rig 不重置 |
| `acceptSource` | 明确接受当前源版本，按现有 UI 的规则清理失效引用 |
| `createDeformer {layerIds,name?,parentId?,rows?,columns?,ref?}` | 新建网格并绑定所列图层；空 layerIds 建未绑定的全稿范围网格 |
| `setDeformer {deformerId,name?,parentId?}` | 改名或父级；parentId:null 解除父级；循环拒绝 |
| `deleteDeformer {deformerId}` | 使用现有删除规则，清理各关键形网格/绑定，子级接到原父级 |
| `bindLayers {layerIds,deformerId}` | 替换所列层绑定；deformerId:null 解除 |
| `setAngle {angle:{x,y}}` | 设 −90…90° 参数；有未保存草稿时拒绝 |
| `editGridNodes {deformerId,edits,moveHandles?}` | 编辑当前角度的姿态草稿；每条 edit 必有唯一 index 和至少一个控制字段 |
| `saveKeyform {name?,ref?}` | 保存当前草稿/插值；同角度更新原 ID，不同角度建立新键 |
| `loadKeyform {keyformId}` | 按 ID 切到保存键；有草稿时拒绝 |
| `renameKeyform / deleteKeyform` | 改名或删除中间键；五个基础锚点不能删除 |
| `discardDraft` | 显式放弃当前姿态草稿 |
| `resetGrids {deformerIds?}` | 只把当前草稿中的指定网格恢复 rest；省略则全部 |
| `setTolerance {pixels}` | 0.1–20 nominal px；每源单位等于 250 nominal px |
| `setVisibility {objectIds?,layerIds?,visible}` | 当前姿态显隐；图层展开为其源曲线/填充/偏移对象 |
| `setPoseIntervalEnabled {rangeIds,enabled}` | 当前姿态的区间启用状态 |
| `changePoseInterval {rangeId,mode?,start?,end?,fullLoop?}` | 当前姿态覆盖已有区间；源轨道/范围 ID 不变 |
| `setPoseIntervalEnd {rangeId,end,style}` | 当前姿态的可见末端笔触 |
| `resetPoseIntervals` | 当前草稿回到源区间与默认启用状态 |

末端笔触字段、闭环 fullLoop 和归一化弧长语义与源接口一致。区间覆盖先在源材料坐标下求值，再随 Warp 传递；区间起止不是新的 Bézier 端点。

## 0 → 30 → 60 → 90 的实际调用顺序

先在 Drawing 另存操作副本，再通过 UI 进入 Recording。查源图层 ID 和录制状态，处理未保存草稿/源版本，再建网格。下面是**接口测试用的一单位曲线示例**，不是人脸拟合结果；SOURCE_LAYER_ID 与节点坐标必须换成当前查询和参考图要求的值。不要将示例坐标套到用户的脸。

<!-- recording-tested: turn-scaffold -->
```json
{"method":"recording","request":{"commands":[
 {"op":"ensureRig"},
 {"op":"setAngle","angle":{"x":0,"y":0}},
 {"op":"createDeformer","layerIds":["SOURCE_LAYER_ID"],"name":"Head demo","rows":2,"columns":2,"ref":"head"},
 {"op":"saveKeyform","name":"0 demo"},
 {"op":"setAngle","angle":{"x":30,"y":0}},
 {"op":"editGridNodes","deformerId":"$head","edits":[{"index":4,"position":[0.51,0.1]}]},
 {"op":"saveKeyform","name":"30 demo"},
 {"op":"setAngle","angle":{"x":60,"y":0}},
 {"op":"editGridNodes","deformerId":"$head","edits":[{"index":4,"position":[0.53,0.1],"handleU":[0.7,0.1]}]},
 {"op":"saveKeyform","name":"60 demo"},
 {"op":"setAngle","angle":{"x":90,"y":0}},
 {"op":"editGridNodes","deformerId":"$head","edits":[{"index":4,"position":[0.55,0.1]}]},
 {"op":"saveKeyform","name":"90 demo"}
],"dryRun":true}}
```

读取当前 revision，加入 expectedRevision，先预演再执行。正式执行只改 dryRun:false，仍使用本批 `$head`，不使用上次预演的临时 ID。返回的 `created` 会说明新建还是更新，并给出实际 keyform/deformer ID。

真实人脸应逐个角度做小批次：查当前控制 → 预演多个节点/柄 → 预览 → 检查拟合、显隐和轮廓 → 保存该角度。还要查看 15/45/75 等中间角度，必要时在该角度增加中间修正键；不要只检查四张静态图片。细分源线属于 Drawing 操作，要另行回到源稿处理并重新接受源版本。

## 预览究竟显示了什么

<!-- recording-tested: preview-saved -->
```json
{"method":"previewRecording","request":{"angle":{"x":45,"y":0},"width":600,"height":600,"center":[0.5,0.1],"pixelsPerUnit":250,"showFills":true}}
```

这份固定相机也只对应上面的测试曲线；人脸应选择合适的固定相机，在各角度保持一致。

- angle 省略：使用当前角度及其草稿；返回 `usedDraft`
- angle 明确给出：默认只用保存关键形插值，即使该角度恰好等于当前角度也不暗用草稿
- 要显式查看当前角度草稿，可用 `useDraft:true`；指定别的角度时拒绝
- `hasUnappliedDraft:true` 表示当前还有一份没有用于这次保存键预览的草稿
- `commands` 可附一个临时 Recording 批次来预览假设编辑，但不提交、不给 Undo 添记录

输出使用真实的姿态显隐 → 子/父 Warp 链 → 每源段一条 cubic 拟合 → PaintScene SVG 绘制。普通 SVG 不含控制网格；辅助注释必须显式打开 annotations。返回拟合诊断、最大误差、端点场冲突、区间传递错误与路由错误。源 JSON 和保存关键形不会因预览改变。

超差不等于可以忽略：一般拟合误差可回源稿人工分段；互相矛盾的端点场请求需要协调控制/父级，分段不能消除冲突。折叠或退化导致的区间传递警告必须单独检查。SVG 与数值检查通过仍需按参考图做实际视觉验收。

## 测试与当前边界

`src/tests/vector-recording-api.test.ts` 从本文件原文提取 JSON 示例测试，并覆盖 0/30/60/90 的保存、45° 插值、真实 SVG 输出、源只读、草稿拒绝、refs、错误索引、层绑定与父级、显隐和区间覆盖、原子 Undo、序列化和 stale revision。

本接口是可重复的录制控制面，不是自动把像素参考转换成完整头像的图像匹配求解器。转头外观仍由实际网格/显隐设计和浏览器画面验收决定。部署前不要把本地测试结果称为已在线实际完成。
