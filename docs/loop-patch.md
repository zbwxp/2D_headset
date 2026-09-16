# Loop-to-Loop Patch

## 使用

曲面 Patch → 绘制面 → 环形 Patch。依次点选两条不同的完整闭合曲线（2D、3D 可混用）。金色对应连线显示相同 normalized arc-length 的位置；必要时翻转第二条环方向，然后点击创建。完成后继续留在绘制面模式，Esc 退出。

支持完整 Section、系统逻辑 Ring 和 Composite Ring、副本 Ring。开放的 Helmet Rim 不是闭环，不能用于此模式；它仍可作为普通 Tri/Quad 的边界。

## Source 与派生几何

`SurfacePatch.type = 'loop'`，`boundaryUses` 恰有两项：

```ts
{ kind: 'closed', curveId: string, reversed?: boolean }
```

不保存 seam Point、内部 Curve、mesh 或新形状参数。旧 span/whole-open 边界和 Tri/Quad 保留原路径。第一条环保持 canonical start，创建预览时比较第二条环两个方向的采样连接长度，选择较小者；用户可翻转，结果随项目保存。后续 evaluation 不重猜方向、不自动移动起点相位。

Natural Surface 是 `lerp(A(s), B(s), v)`。s 使用现有弧长 LUT 映射到宿主真实 evaluator 参数；导数使用真实宿主 derivative 与 LUT 映射的链式法则。环向 periodic，纵向 open。显示网格使用 4n 个环向采样和 n 段纵向采样；最后一段直接引用第一列顶点，没有重复 seam 列。n 仍由当前显示质量或 Contour 固定质量提供。

Fullness 继续使用 `fullness × 0.15 × median(boundary lengths)`，环域 bubble 为 `[4v(1-v)]²`，不沿 s 衰减。两个真实边界位置和一阶行为不动；每张 canonical Patch 一个 outward sign，mirror 由 canonical 最终 surface 镜像。沿用现有基于 Head Origin 的 outward 规则，其退化情况仍会显示原因。

## Continuity

整个闭合边界的 identity 是 `[curveId, 'closed']`，与遍历方向无关，不伪造 span。仍使用现有 boundary relationship / target fitting / PCG，环形域的 displacement field 为 periodic cubic B-spline(U) × interior Bernstein(V)。V 边界系数硬零；U 无边界约束也无端点 fade，环向 fairness 邻接周期闭合。Tri/Quad 保留原 Bernstein 基底。仅复用 active Surface Continuity，不扩展退休的旧 Smooth solver。

## 生命周期

依赖只指向两条宿主 Curve，无虚构端点。宿主变化进入现有增量 key/dirty graph；删除宿主按 dependency closure 删除 Patch。创建/删除/Fullness 沿用 Undo；序列化保持两个完整闭环与持久方向。两侧 Patch 仍为 mirror pair 管理。

## 范围与限制

这是简单 ruled loft，不做最优 phase alignment、不保证任意交叉/倾斜/穿插闭环形成无自交曲面。预览连线用于检查；几何退化按现有 INVALID 路径保留 source record。不会生成 semantic Quad 或 parameter seam Curve。Contour 只消费最终三角面 coverage。

## 验证记录

- 新增 9 项单测：周期拓扑/边界、方向、Fullness、一圈 Continuity（含 seam 采样）、依赖删除、镜像存档、输入校验、微分、Contour。
- Loop + 原有 Patch/Fullness/BoundaryUse/Continuity 专项共 59 项通过；build 通过。
- 新增 2 项 Playwright：真实 2D 点选、翻转、Fullness、Undo/Redo、刷新；真实 3D → 2D 混合选环与几何/Contour 联动。均通过。
- 全量单测 266 项，261 通过，5 失败：旧视角迁移的 `-0` vs `0` 精确比较、仍期望 45° 的旧测试，以及默认 scaffold 的旧迁移断言。未把全量结果报告为全部通过。
- 原浏览器回归中，区间混合 authoring 的 3D 两项通过；另外旧 fixture 的 Curve/Point 数量与新增 Default scaffold 不符，使部分历史断言失败。原有 Tri/Quad kernel 与 Continuity 专项单测通过。
