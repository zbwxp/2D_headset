# V0.9.2 — HeadSet Free 3D Bézier

本轮只升级 HeadSet 普通 FREE Curve 的 source 和编辑方式。

## Source / 编辑

```ts
shape: {
  kind: 'FREE_3D';
  startHandleOffset: [number, number, number];
  endHandleOffset: [number, number, number];
}
```

两个 offset 是 HeadFrame-local、按 XYZ 半径归一化的端点相对向量。世界控制点为 evaluated endpoint 加上 HeadFrame 变换后的 offset。普通左右成对 Curve 可以使用任意非共面控制点；原有中线 Curve 的严格对称约束仍保留。

- 移动 endpoint：offset 数值不变，不按新的 chord length 缩放或旋转。
- 调整 HeadFrame：同一 local offset 经当前 Frame 变换。
- 2D 拖 handle：沿当前相机的 right/up 修改，视线深度保留；另一视图可调整原先不可见的分量。
- 拖曲线本体：保留原有最小二乘 handle 分配方式，位移扩展为完整三维向量。
- 镜像侧编辑：先把鼠标位移映射回 canonical，再存唯一 source。
- Curve Smooth Join 后依然显示和编辑 source handles；曲线显示使用 Final provider。
- 普通 HeadSet Curve 不再显示 Curve Plane slider。

## 旧文件

加载完整依赖图后，针对同一份未迁移 source 求出原 P0/H0/H1/P1，再转换成 endpoint-local offsets。使用的是 source cubic，不把 Curve Smooth Join 派生结果烘焙回 source。

新文件版本为 `landmarks-0.9.2`。旧 planar parser/evaluator 留给旧文件和 Eyes；新 HeadSet 曲线不存 planeNormal / along / offset。Eyes-owned 曲线、CONTROL_POINTS 不迁移。

现有头部样本（35 条 Curve、36 个 Point、12 个 Patch）实测迁移最大误差：

- 控制点：4.24e-16
- evaluated point：4.24e-16
- Natural + Fullness 曲面采样：2.78e-16

数值报告：`artifacts/free3d/migration.json`。

## 保持的管线

ON_CURVE 仍保存 host ID 和 normalized arc-length s；CurveSpan、Tri/Quad/Lens/Loop、Fullness、Surface Continuity、Curve Smooth Join、Contour 都通过原 CurveProvider 消费几何。

新增 Free3D source → HeadFrame 的依赖边，以覆盖 endpoint 为 WORLD 的特殊情况；没有改变删除或宿主规则。

本轮没有修改 `domain/eyes`、`domain/patches`、`domain/continuity`、`domain/contour`、`domain/recording` 中的代码；没有修改 tessellation / Surface solver。

## 验证

- 构建通过。
- Free3D 专项：非共面、无 along clamp、端点跟随、弧长点、旋转和非等比 Frame、镜像、多个视图深度、body drag、保存校验、Curve Smooth Join、旧文件迁移、Surface Smooth/Fullness、Eyes 隔离。
- 11 项浏览器回归通过：正面/侧面实际拖 handle、端点拖动不改 offset、Undo/Redo、删除/撤销、刷新保存、旧线迁移/Plane UI 移除；原 3D 创建 Curve/Patch 与 Eyes / Join 流程回归。
- 全量单元测试 425 项：420 通过，5 项旧测试仍失败。关闭本次迁移后相同 5 项复现，分别涉及旧项目完整对象快照、旧 45° 视角预期，以及 Contour 的旧 display-independent 快照。本轮未改这些产品逻辑。

后续可以直接在不同 2D 窗口调整下颌/耳根/颏下 Curve，并使用原来的 Patch 工具建面。本轮没有承诺消除原 Natural Patch 参数化的限制，也没有继续重构 Surface。
