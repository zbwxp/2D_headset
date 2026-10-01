# Contour — V0.17.0

以矢量线稿为底层的双模式工作区：绘制模式保留完整钢笔与图层，录制模式用嵌套 Bézier Warp 与 Angle X / Y 关键形驱动画稿。旧录制/组装入口已退出主界面，旧数据安全保留在存档中。

[新工作区与录制操作](docs/vector-workspace.md) · [AI 结构化编辑接口](docs/vector-editing-api.md) · [AI 矢量创作操作手册](docs/ai-authoring-guide.md)

画稿库与角度关键形独立保存。录制模式锁定源线条，每段只拟合为一条 Bézier，超差会标红；全工程使用 IndexedDB 自动保存，并保留 JSON 导出。AI 辅助视图默认关闭。

Drawing Room 支持命名视角快照、适配 Bézier 的四角透视变形、Bézier 钢笔、连续笔画、端点绑定与接笔、图层与组合、显示区间、端点笔触、深度偏移、轮廓雾化和闭合边界雾化填充。

[视角快照使用说明](docs/v01239-drawing-snapshots.md)

[Sites 发布与反馈更新流程](docs/sites-release.md) · 线上试用的帮助入口在顶部问号按钮。

## 基础脸模

[基础脸模·正面·v1 使用说明与预览](docs/assets/front-face-v1/README.md) · [下载 JSON 存档](docs/assets/front-face-v1/基础脸模·正面·v1.json)

这是正式归档的正面 Drawing Room 基础资产：18 个图层、46 条连续/闭合笔画、208 段曲线、23 个填充。已整理图层、笔画、曲线和填充命名；保留作者修正后的几何与遮挡关系。

运行软件后进入「绘制模式」，使用顶部「打开」载入 JSON。请先保存当前工程；打开存档会替换当前工程。

## 运行

```sh
npm ci
npm run dev -- --port 5173
```

打开 http://127.0.0.1:5173/。验证命令：`npm test`、`npm run build`、`npm run test:e2e`。

## 当前文档

- [组装间：独立绘制、三维定位与旧发型存档瘦身](docs/v0160-assembly-room.md)

- [四角变形与隐藏成员整体编辑](docs/v01238-quad-deform.md)

- [AI Drawing Room 操作与资产语义手册](docs/ai-drawing-room-guide.md)
- [正面到近正面左视：Live2D/Spine 研究与矢量实验](docs/front-near-left-experiment.md)
- [V0.12.37 软件快照与验证结果](docs/v01237-checkpoint.md)
- [Drawing Room 基础结构](docs/v0110-drawing-room.md)
- [内部端点笔触](docs/v01235-interior-endpoint-ink.md)
- [曲线深度偏移](docs/v01236-curve-depth-offset.md)
- [雾化填充](docs/v01237-gaussian-mist-fill.md)
- [快照录制间](docs/v0130-snapshot-recording.md)
- [模块隔离](docs/v080-geometry-modules.md)

## 历史文档

[V0.4.5 结构线定位点](docs/on-curve-v045.md)

[V0.3.6 空间平滑实验](docs/spatial-smooth-v036.md) · [V0.3.5 平滑实验](docs/smooth-junctions-v035.md) · [V0.3.1 UI](docs/editor-ui-v031.md) · [V0.3 Planar Curve](docs/planar-curves-v03.md) · [V0.2 Semantic Point](docs/semantic-points-v02.md)

旧 Curve-only Smooth 实验不在当前 active geometry path。
