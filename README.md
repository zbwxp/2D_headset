# Contour — Spatial Smooth V0.3.6

共享三维语义点 + 严格共面的 cubic Bézier 结构线。左右曲线共用一套形状，镜像侧由世界控制点镜像生成。原有 Landmark View Lock、中心线排序、参考图及 100 步历史保留。

```sh
npm ci
npm run dev -- --port 5173
```

打开 http://127.0.0.1:5173/。左侧「创建曲线」后依次选择两个语义点；拖曲线弯曲，选中后用两个控制柄精调，滑块调整曲线平面。

[V0.3.6 空间平滑说明](docs/spatial-smooth-v036.md) · [V0.3.5 历史平滑说明](docs/smooth-junctions-v035.md) · [V0.3.1 界面操作说明](docs/editor-ui-v031.md) · [V0.3 使用与实现说明](docs/planar-curves-v03.md) · [V0.2 历史说明](docs/semantic-points-v02.md)

Git 基线：`v0.1-landmark-editor` (`7a40cd0`)、`v0.2-landmark-management` (`12801b3`)；UI 基线：`v0.3.1-ui-cleanup` (`9a34bed`)；平面平滑基线：`v0.3.5-smooth-junctions` (`5f29ba4`)；当前开发分支：`v0.3.6-spatial-smooth`。旧 surface/solver 及历史测试保留，未接回主路径。

```sh
npm run build
npm test
npm run test:e2e
```

右键或双击共享语义点打开交点检查器，可添加两端匹配曲率向量的空间平滑并调整「平滑范围」。

V0.3.6 不实现 Surface、Patch、Mesh 或 Curve View Lock。
