# AI 临时参考与辅助线接口

自 API 1.6 提供、API 2.0 保留：`inspectView()`、`view({commands,dryRun?})` 与只读 `snapView(...)`。已在 v12 实际浏览器验证，v19 保留同一临时接口；本次场景工作流实测范围见[发布验证记录](recording-scene-release-validation.md)，不代表每项临时视图手势都已重新测试。它们使用独立的临时视图状态，不写工程、源稿、录制关键形、自动保存或 Undo；重新载入后不承诺保留。

这组方法不接受 expectedRevision，也不返回工程 revision。源稿/录制批次仍使用各自原有的 revision 和撤销规则。视图命令在 Drawing 与 Recording 都可执行。

<!-- view-tested: inspect -->
```json
{"method":"inspectView","request":{}}
```

成功结果的 value.view 包含 reference、guides、guidesVisible、snappingEnabled、rulersVisible。返回值是分离副本；改输出 JSON 不会改画布。

## 命令

- `setReference {artworkId,placement?,offset?,scale?,opacity?,visible?,snap?}`：从当前画稿库选择已保存画稿作只读参考；placement 为 left/right/overlay。只改对照位置，不切换当前画稿
- 省略 artworkId 时编辑当前参考的视图属性；`artworkId:null` 清除参考
- offset 为源坐标单位的 `[x,y]`，scale 范围 0.01–100，opacity 为 0–1。left/right 是初始放置建议，必要时再设精确 offset
- `addGuide {id?,axis,value}`：axis:x 是恒定 X 的竖线，axis:y 是恒定 Y 的横线；value 为源坐标值。省略 id 时生成并返回新 ID；同批要修改该线可提前显式提供自己的稳定 id
- `changeGuide {id,value}`、`deleteGuides {ids}`：按辅助线 ID 编辑/移除
- `setGuideOptions {visible?,snapping?,rulers?}`：控制辅助线、吸附和标尺的视图开关
- `resetView`：恢复临时视图默认状态，不撤销任何源稿或姿态编辑

最多 200 条命令/批，100 条辅助线。任何失败都不替换视图状态；成功批次只替换一次。没有隐式脚本、网络访问或原始工程写入。开启吸附本身不移动任何源点；后续实际源编辑仍走 Drawing 的事务和约束。

<!-- view-tested: guides -->
```json
{"method":"view","request":{"commands":[{"op":"addGuide","id":"face-axis","axis":"x","value":0},{"op":"setGuideOptions","visible":true,"snapping":true,"rulers":true}],"dryRun":true}}
```

示例的 X=0 只是一条辅助线，不代表当前画稿的镜像轴。应先从源查询读取 mirrorAxisX，按需要替换 value；辅助线与持久镜像配对是不同能力。

<!-- view-tested: reference -->
```json
{"method":"view","request":{"commands":[{"op":"setReference","artworkId":"REFERENCE_ARTWORK_ID","placement":"left","opacity":0.35,"snap":false}],"dryRun":true}}
```

REFERENCE_ARTWORK_ID 必须换成 inspectArtworks 返回的真实 ID。先预演，再用 dryRun:false 应用。返回 changed/applied 与 createdGuideIds/removedGuideIds，但不会新增工程撤销步骤。

普通源稿/姿态 JSON 和 SVG 导出不包含这些对照和辅助线；AI 控制柄注释仍需在 preview/previewScene 的 annotations 里显式请求。临时画布参考可以辅助人工/AI观察，不能把它误当成已经导入源稿的图层。

`src/tests/vector-workspace-view-api.test.ts` 直接读取本文 JSON 示例，并验证双模式、无源/历史/revision 改动、预演、失败无部分应用与默认视图适配器。


## 人工与 AI 共用的吸附查询

`snapView({point:[x,y],unitsPerPixel,thresholdPx?,excludeCurveIds?,targetSpace?:"source"})` 使用与 Drawing 指针相同的候选计算。当前只支持源稿空间，返回 targetSpace:"source"；不支持 posed 或 child-local 查询。unitsPerPixel 是每屏幕像素对应的源单位（即 pixelsPerUnit 的倒数），thresholdPx 默认 8。excludeCurveIds 只排除当前源稿的指定曲线，错误 ID 会拒绝。

结果 value.candidate 为候选或 null，包含建议 point、kind、guideIds，以及有曲线目标时的 target.source（artwork/reference）、target.curveId/curveIds。t 是裁切后候选 cubic 的参数；普通源段另返回 target.sourceT，才是原源曲线的 Bézier t；派生 ARC 返回 target.joinId，不能拿它冒充某条原线的 t。候选按 SHOW/HIDE 裁切，包含派生 ARC，但不计算填充遮挡、末端收尖轮廓或延伸。参考的 scale/offset 在查询前实际应用。辅助线隐藏、吸附关闭或没有辅助线时返回 null。现有几何端点/节点吸附仍是独立行为。Recording 指针目前会传入其评估后的显示几何（子级局部视图可能省略父级），因此不能声称本源空间查询与 Recording 的 posed/child-local 吸附完全等同。

此方法只查询，不移动节点、不更新辅助线，也不加入 source revision/Undo。AI 可以检查候选后，把其 point 作为明确的 `moveNode` 输入，由正常源编辑事务处理锁定、镜像和区间材料。不要将吸附建议当成已经提交的几何编辑。


v12 实际记录确认：临时参考与辅助线操作后，源 JSON 与源 revision 均不变，普通 SVG 与操作前字节一致；对参考拖动没有选择源曲线。该次 smoke 未覆盖按住拖动同时按 Delete/Arrow/Esc 或 Alt 的所有组合，不把一次基础测试视为所有手势都已覆盖。
