# 录制作者最短流程：独立场景 API 2.0

本包对应 v19 / `1559770`，完整合同见 [场景接口](recording-scene-api.md)，数据所有权见 [架构说明](architecture/recording-scenes.md)。Drawing 保存配件源稿，Recording 引用它们组成场景。切换参考画稿不构成转头结果。

1. **Inspect**：进入 Recording，用 `inspectScene` 查 scene/instance/layer/Warp/track/key ID 与 `revision`。检查当前角度、各对象草稿和有效源版本；同源多实例有不同实例 ID
2. **Dry-run**：向 `scene` 发送 `dryRun:true` 与最新 `expectedRevision`。用真实 layer refs 创建共享 Warp；已有绑定应明确使用 `wrapParent / createChild / rebindLayers`，不要隐式替换
3. **Apply**：重放同一批次的 `$ref` 结构，移除 dryRun 或设为 false。整批一次 Undo；不要使用预演生成的临时 ID。Recording 不改源节点、柄、拓扑或填充结构
4. **Preview**：`previewScene` 省略 angle 可查看匹配当前角度的草稿；明确 angle 默认只用保存键。检查填充遮挡、轮廓、区间材料、拟合与端点冲突。数值无警告不等于美术通过
5. **Save selected**：使用 `saveSelected {warpIds,layerRefs}` 只保存明确选择的 Warp/层对象。每对象独立键数，新增一对象的键不改其他对象。角度移动保留其他草稿；同对象在另一角度编辑前须保存或明确丢弃已有草稿
6. **Reload**：正常导出并载入完整工程 JSON，核验库、`drawingWorkingCopies`、`recordingScenes`、实例 refs、每轨 keys/draft；从保存键再次预览并验证一次 Undo/Redo。源更新应同步所有引用实例

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

[旧单稿录制合同](vector-recording-api.md) 与 [旧 yaw 美术报告](yaw-authoring-example.md) 是历史资料。新 scene 完整浏览器验收仍在进行；首轮双实例/两个独立 Warp 与0/90键检查不代表全部父子编辑、切稿、重载和美术路径通过。
