# 录制作者最短流程：独立场景 API 2.0

本页对应 v27 / `6b72514`（2026-10-02已发布），完整合同见 [场景接口](recording-scene-api.md)，数据所有权见 [架构说明](architecture/recording-scenes.md)。Drawing 保存配件源稿，Recording 引用它们组成场景。切换参考画稿不构成转头结果。

1. **Inspect**：进入 Recording，用 `inspectScene` 查 scene/instance/layer/Warp/track/key ID、`viewpoints` 与 `revision`。检查当前角度、各对象草稿和有效源版本；同源多实例有不同实例 ID
2. **建立视角**：推荐先 `createViewpoint {name,angle}`，也可在左侧调整角度后点击「建立视角」。没有 Warp 也能建立。UI 在未建立视角的角度只预览，不能编辑显隐、排序或网格；底层 API 仍能直接写轨道，这不是 API 强制门禁
3. **Dry-run → Apply**：`scene` 带 `dryRun:true` 和最新 `expectedRevision`，再重放相同 `$ref` 结构正式执行。右侧与 Drawing 使用同一个多快照图层面板，每实例一个折叠组和一套眼睛/填充/折叠工具。工具只作用本实例内所选层；没有本实例选择时作用全部已载入层。跨实例混选不会扩大单份快照工具的范围；共享 Warp 创建在独立栏。可先做成员显隐，也可选真实层 refs 创建 Warp。已有绑定用明确的包父/建子/重挂接命令
4. **更新此视角**：推荐 `updateViewpoint {viewpointId}`，保存该角度已改动的 Warp 和外观草稿；无 Warp 也可更新嘴段显隐。其他角度草稿和未修改通道不补键。建立新视角本身不采样现有轨道；新建 Warp 才在已有显式视角上写自己的 rest 中性键
5. **Preview**：`previewScene` 省略 angle 可看匹配当前角度的草稿；明确 angle 默认只读保存键。检查关键角度与中间角度的填充、轮廓、区间材料、拟合和端点冲突。通过滑块查看未建立的中间角度，不应为看插值而自动建新视角
6. **Reload / Undo**：正常导出、载入完整工程 JSON，核验库、working copies、viewpoints、实例 refs、每轨 keys/draft；再从保存键预览并验证一次 Undo/Redo。录制不能写源几何，源更新应同步全部引用实例

`saveSelected {warpIds?,layerRefs?}` 仍保留作明确的底层对象保存；仅传真正选择的类型，避免空数组。它只写所选对象，而「更新此视角」按目标视角角度提交已有草稿，不依赖当前选择。两者都不等于采样全部场景。首次操作旧场景时，UI 可将原键角度转成显式视角；直接 API 的旧场景兼容行为见[场景合同](recording-scene-api.md#命名视角与更新)。

## 图层操作的边界

Drawing 只传入一份快照，Recording 可传入多份，Ctrl/Cmd、Shift、组/成员选择都沿用同一套逻辑。Drawing 原有锁定、结构工具和排序保留；Recording 通过命令适配器写姿态覆盖，不改源结构。眼睛和录制层序进入当前角度草稿；填充预览、列表展开/折叠始终是临时状态，不随「更新此视角」写键。未建立的预览角度不能改姿态，但可以看填充和折叠列表。

## 网格选择与移动

- 右侧选已有 Warp，或重选绑定同一 Warp 的图层找回网格。「显示已有 Warp」只显示，不重复创建；点击空白也不丢失当前网格
- V 整体平移当前 Warp；A 编辑节点、网格边的端点对和 Warp Bézier 柄。Shift 复选／框选，画布 Ctrl/Cmd+A 或「全选网格」选择全部节点；Z／空格只控制视口
- 整行／整列只执行一次：有选点立即扩选，无选点等下一点；选好后拖已选成员保持多选，普通点未选成员恢复单选
- 方向键按屏幕像素微调：普通1、Shift10、Alt/Option0.1。连按在释放键时提交一个草稿；输入控件与未建立视角都不写网格
- 自动显示网格不扩大保存选择；实际网格手势才选定该 Warp。用「更新此视角」提交当前角度已有草稿，或明确使用所选对象保存。源线条仍只在 Drawing 修改

## 七帧验收导出

固定 JSON 界面使用 `method:previewSceneFrames`。默认输出 X=0/15/30/45/60/75/90、Y=0；自定义最多31帧，只读取保存键。完整、经接口测试的 JSON 在 [场景接口的帧示例](recording-scene-api.md#预览和完整工程保存)。

相机省略时从同一场景源范围计算一次，所有帧共用。检查 `sceneId`、`savedKeyformsOnly:true`、每帧 `usedDraft:false`、`warningFrameIndices`、`hasUnappliedDraft` 和 `allFramesIdentical`；不能把旧草稿或不同源图的切换当作连续参数动画。

每帧走真实 Scene→Warp→单 cubic 拟合→PaintScene，并使用与 UI 相同的 paint batches。雾化需要真实 Canvas/Path2D；离线真实 Canvas 可验证渲染，但不代替浏览器交互。普通 SVG 不带临时参考、标尺、网格或 AI 辅助线。

将完整 API 结果保存为 JSON 后运行附带 [提取工具](tools/extract-recording-frames.mjs)：

```sh
node docs/tools/extract-recording-frames.mjs scene-frames-result.json NEW_frames_directory
```

工具验证同一 scene/相机/保存键帧，再写入全新目录；不覆盖旧目录或改工程。输出 SVG 与逐帧诊断 manifest。可再用 Inkscape/ffmpeg 转换，保留原 SVG/manifest 作为依据。工具兼容历史 rig 返回值，但不能混用 scene 身份。

## 来源工作副本与历史界限

命名源稿切换前自动保留同 ID 工作副本；所有实例仍解析最新内容，优先顺序为 active Drawing → 同 ID working copy → checkpoint。同 ID 更新清除副本；另存新 ID 不改原实例来源。未命名稿仍需先命名或明确丢弃。旧 rig 原数据保留供兼容迁移，带 scene 的工程调用旧录制 API 返回 `LEGACY_RECORDING_RETIRED`。

[旧单稿录制合同](vector-recording-api.md) 与 [旧 yaw 美术报告](yaw-authoring-example.md) 是历史资料。v18/v19有限场景流程和v22视角用户主流程已实际检查；v23实例单组树与v24同源双13层批处理隔离状态见[验证记录](recording-scene-release-validation.md)。未测手势、姿态与完整转头美术不能由这些有限结果推定通过。
