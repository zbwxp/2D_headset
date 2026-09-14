# Contour — ON_CURVE Semantic Point V0.4.5

当前版本支持 WORLD / 结构线定位点、Planar Curve、Patch Fullness、Surface Smooth 与只读 Contour。选中结构线后点击「添加结构线定位点」，通过「在线位置」调整弧长位置。

[V0.4.5 使用与实现说明](docs/on-curve-v045.md)

```sh
npm ci
npm run dev -- --port 5173
```

打开 http://127.0.0.1:5173/。验证命令：`npm test`、`npm run build`、`npm run test:e2e`。

## 历史文档

[V0.3.6 空间平滑实验](docs/spatial-smooth-v036.md) · [V0.3.5 平滑实验](docs/smooth-junctions-v035.md) · [V0.3.1 UI](docs/editor-ui-v031.md) · [V0.3 Planar Curve](docs/planar-curves-v03.md) · [V0.2 Semantic Point](docs/semantic-points-v02.md)

旧 Curve-only Smooth 实验不在当前 active geometry path。
