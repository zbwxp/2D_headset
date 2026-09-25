# Contour — V0.12.37

头部构造、视角录制和二维线稿编辑器。当前包含 HeadSet / Eyes 建模、Recording Room 视角关键帧与语义点，以及独立的 Drawing Room。

Drawing Room 支持 Bézier 钢笔、连续笔画、端点绑定与接笔、图层与组合、显示区间、端点笔触、深度偏移、轮廓雾化和闭合边界雾化填充。

## 基础脸模

[基础脸模·正面·v1 使用说明与预览](docs/assets/front-face-v1/README.md) · [下载 JSON 存档](docs/assets/front-face-v1/基础脸模·正面·v1.json)

这是正式归档的正面 Drawing Room 基础资产：18 个图层、46 条连续/闭合笔画、208 段曲线、23 个填充。已整理图层、笔画、曲线和填充命名；保留作者修正后的几何与遮挡关系。

运行软件后进入「绘制间」，使用顶部「打开」载入 JSON。请先保存当前工程；打开存档会替换当前工程。

## 运行

```sh
npm ci
npm run dev -- --port 5173
```

打开 http://127.0.0.1:5173/。验证命令：`npm test`、`npm run build`、`npm run test:e2e`。

## 当前文档

- [V0.12.37 软件快照与验证结果](docs/v01237-checkpoint.md)
- [Drawing Room 基础结构](docs/v0110-drawing-room.md)
- [内部端点笔触](docs/v01235-interior-endpoint-ink.md)
- [曲线深度偏移](docs/v01236-curve-depth-offset.md)
- [雾化填充](docs/v01237-gaussian-mist-fill.md)
- [Recording Room](docs/v070-recording-room.md)
- [模块隔离](docs/v080-geometry-modules.md)

## 历史文档

[V0.4.5 结构线定位点](docs/on-curve-v045.md)

[V0.3.6 空间平滑实验](docs/spatial-smooth-v036.md) · [V0.3.5 平滑实验](docs/smooth-junctions-v035.md) · [V0.3.1 UI](docs/editor-ui-v031.md) · [V0.3 Planar Curve](docs/planar-curves-v03.md) · [V0.2 Semantic Point](docs/semantic-points-v02.md)

旧 Curve-only Smooth 实验不在当前 active geometry path。
