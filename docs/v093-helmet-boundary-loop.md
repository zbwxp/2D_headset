# V0.9.3 — Helmet Boundary Loop

Rim 与水平主环现在使用同一个 HeadFrame-local Y 高度。取消中间下垂；改变水平环高度、侧盖切割距离、侧盖倾斜或 Roundness 时，下缘一起重新求值。

新增系统 Curve **Helmet 闭合下缘**：水平环前段 → 右 Rim → 水平环后段 → 左 Rim。原完整水平环、左右 Side Ring、两个 Rim 和已有交点仍保留。闭环直接引用原三条 Source Curves，不增加重叠定位点，不保存离散顶点。

## 使用

- 在曲线列表选择 **Helmet 闭合下缘**，或从任一 Rim 的行内操作进入。
- **用下缘区间建立 Patch**：选择已有定位点作两端；一个区间可以跨越水平环/Rim 接头，再与自由曲线围成普通 Patch。
- **用整圈建立环形 Patch**：选另一条闭合线，确认创建环形面。
- 支持添加在线定位点；左右点继续严格镜像，位置使用 normalized arc length。

## 几何与依赖

`HELMET_LOOP` 是一个逻辑闭合 CurveProvider。各分段精确复用水平 Section / Rim evaluator。它与水平环同处一个平面，接头 G1 切线连续；分段原生参数速度不必相等，弧长求值仍走现有 LUT。

依赖为 `HeadFrame / Scaffold → 原 Ring、Rims → 闭环 → hosted points / Patch`。复用现有 Patch evaluator、Fullness 与 Smooth solver。Contour 将闭环边界还原成原 source intervals，与 Helmet 边界共享身份，避免把连接处误画成 open edge。

## 存档

源数据版本 `landmarks-0.9.3`。加载旧存档时将 `rimSag` 归零，并保留原 IDs、ON_CURVE 的 s、Patch topology。旧版共面曲线先通过现有 `followEndpoints` 路径运输平面，再执行 Free3D 迁移。绑定在旧 Rim 上的几何会跟随抬平后的下缘。

## 验证

- 27 组水平高度 / 侧盖倾斜 / Roundness 组合：同高、精确分段、闭合、G1、镜像。
- 原有交点和 Rim 定位点可作闭环锚点；区间可跨接头。
- 普通镜像 Patch、Annular Patch、Contour shared-boundary identity、锁定、旧存档与新存档往返。
- 浏览器实际操作：3D 选择第二环建面、2D 区间锚点建面、高度调整 Undo、建面 Undo/Redo、重新加载。
