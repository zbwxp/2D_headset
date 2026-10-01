# 转头录制作者的最短检查流程

使用当前画稿的同一 rig。右侧源参考稿只作对照，切换参考画稿不是转头结果。API 细节见 [录制接口](vector-recording-api.md)，临时参考/辅助线见 [视图接口](vector-workspace-view-api.md)。

1. **Inspect**：进入 Recording，inspectRecording 查 artworkId/rigId、sourceReviewRequired、hasDraft、Warp/绑定/键 ID。记录源 JSON 与画稿库身份；处理源变化和已有草稿，不能默默丢弃
2. **Dry-run**：用最新 expectedRevision，recording 的 dryRun:true 预演一个小而完整的修改。明确 layerId/deformerId；节点/柄在本网格空间，pin 目标在紧邻父空间
3. **Apply**：保持同 revision，dryRun:false 执行同批命令。看返回错误、pin residual 和影响范围；失败不得跳过坏命令继续提交
4. **Preview**：previewRecording 省略 angle 查看当前草稿。检查填充遮挡、下巴连贯、眼/鼻/嘴高度、源区间材料、拟合超差和端点场冲突。不能用调 HIDE 来掩盖几何传递错误
5. **Save**：保存本角度 keyform 后再切到下一角度。至少制作 0/30/60/90，并检查 15/45/75；有需要就补中间修正键。对应的子网格末端用相同真实输入点/共同父目标 pin，再检查真实场请求
6. **Reload**：导出完整工程 JSON，经正常 UI 重新载入。核验源 JSON、画稿 ID、绑定、关键形 ID/控制和参数恢复；再从保存键预览，不能把旧的未保存草稿当作载入成功

## 七帧验收导出

API 1.7 的 previewRecordingFrames 默认输出 X=0/15/30/45/60/75/90、Y=0。只用保存键，不能传 useDraft 或假设 commands。角度可自定义，最多 31 帧。每帧来自真实 Pose→Warp→单 cubic 拟合→PaintScene 链，不加载或切换另一份源稿。

固定 JSON 界面使用 method:previewRecordingFrames，request 可设置 width/height/center/pixelsPerUnit/showFills/expectedRevision。相机省略时只从当前源稿计算一次，全帧共用；不要在外部重新给每帧自动适配。完整可执行 JSON 见 [录制文档中的七帧示例](vector-recording-api.md)。

检查输出：artworkId/rigId 全帧相同，savedKeyformsOnly:true，usedDraft:false。hasUnappliedDraft 会提示未采用的草稿；allFramesIdentical:true 说明尚未展示转头变化。warningFrameIndices 和各帧诊断不能忽略。

当前头像带雾化填充，需要在应用浏览器中产生完整 SVG。若出现 BROWSER_REQUIRED，应返回浏览器渲染；不能关闭雾化/填充来冒充完整验收图。普通输出不带临时参考、标尺、控制网格或辅助线。

把整个 API 结果保存为 JSON 后，用附带的 [提取工具](tools/extract-recording-frames.mjs) 输出帧文件：

```sh
node docs/tools/extract-recording-frames.mjs recording-frames-result.json NEW_frames_directory
```

工具只接受同一来源/rig/相机的保存键帧，先验证，再写入一个全新目录；不会覆盖旧目录或修改应用。输出 frame-000.svg … 与 manifest.json，后者保留逐帧角度和诊断。随后可用现有 Inkscape 逐帧转换为 PNG，再用 ffmpeg 按编号合成视频；源 SVG 与 manifest 一并留存作验收证据。不要用混剪不同参考稿替代实际连续参数评估。
