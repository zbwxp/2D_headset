# V0.6.3 — Local Free Curve Smooth Join

## 使用

选中共享端点 → 关联 / Relations → 平滑连接 / Smooth Joins → 添加。
选两条 incident FREE Curve 的端点，调整 Smooth Radius，然后创建。
已有连接可以在 Point 或 Curve 的 Relations 修改半径、移除；Curve Relations 可以跳转到共享 Point 和另一条 Curve。
已占用的端点不可再加入第二组连接。同一个 Point 可以有多组互不占用端点的 Join。

没有自动检测，不依赖中线、左右侧或人体名称。只支持 FREE planar cubic source。

## Source 与 Final

- `GeometryEvaluationContext.sourceCurve()` / `sourceCurveControls()`：原始平面 cubic。
- `GeometryEvaluationContext.curve()`：Final CurveProvider。
- 2D 控制柄和 plane 编辑明确使用 `sourceControls()`。
- 原 `controls()` / `curveControls()` 保留为 Source 兼容别名，不用于 Final 几何。
- Join 存在时 Final 不再暴露单 cubic controls，防止下游误走 de Casteljau source 快捷路径。
- BoundaryUse、CurveSpan、ON_CURVE、Patch、3D/2D renderer、OPEN_EDGE 和 Contour 均消费 Final。
- Contour Worker 的源快照增加 `curveSmoothJoins` 字段；Contour 线条算法没有改动。

## 几何

从两条 Source 的 outward 单位切向计算 `axis = normalize(uA-uB)`，另一侧为 `-axis`。
`blendLength = radiusRatio * min(sourceLengthA, sourceLengthB)`，用现有弧长 LUT 求 Source 接回参数。

Radius 默认 0.08，范围 0–0.35。双端各至多替换自身弧长的 35%，因此不会重叠，保留至少 30% 的精确 Source 中段。

每侧 P→Q cubic：P 是原语义点，P 切向为共同轴，Q 位置和切向来自 Source。自动 handle 限制为 blend/chord 尺度；控制多边形沿弦投影单调，另用 Bernstein 系数保守认证 `dot(C-P,C') >= 0`，避免局部回折。

- P 永远不动；不写回 handle、plane 或 Point。
- Radius 外直接调用 Source evaluator，没有拟合替换。
- 已匹配的 tangent 不生成新 blend；Radius=0 精确返回 Source provider。
- Q 处是 G1，不保证 raw parameter derivative magnitude 的 C1。
- 新建时拒绝近同向 cusp、退化切向、过短曲线和会返折的 blend。
- 后续 source 编辑使已有关系退化时，保留关系并在 Inspector 显示原因；该 pair 回退到 Source，条件恢复后自动重新生效。
- 镜像关系只保存一份；完整镜像参与对象存在时派生镜像 occurrence。自镜像中心线 pair 不重复保存。镜像 Final 从 canonical Final 反射。

## 数据与依赖

项目新增可选 `curveSmoothJoins: CurveSmoothJoin[]`。字段为 id、pointId、两个 curveId+START/END、radiusRatio。JSON 版本支持 `landmarks-0.6.3`；旧项目没有 Join 时走原 Source 路径。

求值 DAG：

```
Points → curveSource:A ─┐
Points → curveSource:B ─┼→ join:id → curve:A / curve:B → existing descendants
relation radius ───────┘
```

因此不存在 A Final ↔ B Final 假循环；如果用户通过 ON_CURVE / ON_PATCH 构造真实反馈，则仍拒绝。

删除闭包使用 Source 所有权依赖，不把 Join 的配对依赖视作“删除另一条 Curve”的依据。
删除参与 Point/Curve 会移除关系；删除关系仅恢复 Source。

创建、移除、Radius 支持 Undo/Redo；NumericSlider 一次长按或拖动是一条历史。Save/Load 保存关系，不保存 blend controls 或采样 mesh。

## 验证与样例

- `src/tests/smooth-join.test.ts`：非镜像与非共面 G1、Source 不变、exact outer span、切向 no-op、Radius=0、cusp 拒绝/回退、endpoint occupancy、三组独立 pair、镜像、双端 middle、source 更新、DAG/cycle/delete、ON_CURVE、CurveSpan、Patch、OPEN_EDGE、尺度不变及单调性。
- `tests/e2e/smooth-join.spec.ts`：实际创建、键盘 Radius 历史、关系导航、移除/撤销、Save/Load、中文/英文 Inspector、Patch/Contour 输入一致性。
- `artifacts/v063/symmetric-example.json`：自镜像连接示例。
- `artifacts/v063/same-side-patch-example.json`：同侧 Curve pair 与 Patch 联动示例。
- `artifacts/v063/before-v063.tar.gz`：实施前源码、测试、package 和 docs 快照；不包含/覆盖用户项目存档。

本版本不新增 Surface solver、Contour smoothing、ON_PATCH Join、Section/Rim Join 或额外 blend handle。

## 本轮执行结果

- 新增 12 项 domain 单测全部通过。
- 全量单测：325 通过，5 项原有基线失败（默认点集旧断言、45° 旧视角断言，以及 3 项 ±0 JSON/坐标序列化断言）。未修改这些无关行为。
- 浏览器回归 15/15；最后的 Source API 命名整理后，5 项 Join/ON_PATCH 关键回归再次通过。
- Build 通过，仅保留原有 bundle 大小提示。
- 浏览器旧脚本的英文/混合文案选择器同步为当前中文 UI；没有为通过测试改变编辑行为。

完整日志在 `artifacts/v063/`。
