# V0.6.2 — On Surface Curve

## 使用

在 2D 选普通 Patch，再点击 Creation Shelf → Curve → On Surface Curve。也可先启动工具再选 Host。点击两处 boundary，已有合法 Point 会复用，否则生成 draft ON_CURVE Point。黄色预览后确认；两个端点和 Curve 一次提交、一次撤销，Esc 全部取消。

曲线跟随 Host Final Surface；选中后没有 Plane 或 Bézier handles。可拖动其 ON_CURVE 端点、编辑 Host Fullness/Continuity，也可继续 Add On-Curve Point、作为 CurveSpan 或下游 Patch boundary。3D 仍只做 selection/navigation。

## 数据与求值

- `OnPatchCurve` 保存 `geometryType: ON_PATCH`、Host Patch ID、两个现有 Landmark ID。canonical 的 `path` 保存 start/end boundary occurrence、整数 winding，Loop 另存 referenceU 用于跨周期 seam 的参数提升。mirror 只引用 canonical，并严格镜像其最终几何。
- `domain/patches/domain.ts` 是公共 Boundary → Domain 映射，包括 Tri、Quad、Lens、Loop、反向 boundary 和 span。检查 endpoint 实际位置，不能通过有空间 Offset 的点冒充 boundary 点。
- `domain/curves/onPatch.ts` 将 domain 直线路径送入已有最终 evaluator。有限差分 derivative、公共采样/弧长 LUT 和 normalized s 可用，`closed=false`，没有 cubic controls。
- Key 包含 Host source key、Final Continuity token、端点 domain 位置和路径信息。消费者统一读 CurveProvider key。
- `isDerived` 管理无 Bézier shape 的 Curve；Section/Rim 原有解析语义保留。

## DAG、删除与存档

依赖现在允许 Point → Curve → Patch Final → ON_PATCH Curve → Point/Curve/Patch。带 ON_PATCH 的项目将 Natural 与 Final 分阶段，Final 还依赖 Continuity 邻居 Natural；先检查 source DAG，再检查求值 DAG。直接循环及 `A Final → C → B Natural → A Final` 隐藏反馈明确拒绝。

Dirty 从上游及 Fullness/Continuity 变化传播到所有下游，删除走 source dependency closure，不把 Continuity 邻居当删除对象。Load 先解析记录，再建图和检查引用/环，最后求值，不依赖旧的 Point/Curve/Patch 固定加载顺序。

为了让同步 CurveProvider 冷启动就取得真实 Final，带 ON_PATCH 项目在 Continuity 缓存未命中时按需调用原 solvePatch，并缓存结果。没有改动能量公式，也不使用 stale/Natural 冒充 Final。首次冷求值可能有同步计算开销，后续复用缓存；本轮未进行新性能优化。

## Contour

所有 Curve 增加可选公共 `contourRole: NONE | OPEN_EDGE`，旧记录缺省为 NONE，新 ON_PATCH 默认 OPEN_EDGE。Inspector 可切换，mirror 同步。

OPEN_EDGE 的 provider samples 加入现有 Contour mesh boundary candidate 通道，使用原 projection/depth/visibility clipping。没有新增 renderer、不切面、不改变三角形或 Continuity。成为 shared boundary 也不会自动关闭绘制属性。

## 验证及示例

`artifacts/v062/` 中提供可直接打开的 `tri-example.json`、`quad-example.json`、`lens-example.json`、`loop-example.json`，以及对应截图。`jaw-contour-example.json` 从实际头壳 fixture 的下颌 Lens Patch 构造，`jaw-open-edge.png` 与 `jaw-role-none.png` 对比绘制属性。

背面截图 `jaw-rear-exposure.png` 保留未被遮挡的线段：该存档不是封闭头壳，不能把“从背后看”当作全线隐藏条件。单测另外使用实际前方三角面证明 coincident 贴面线可见、前方面完全覆盖时线被隐藏。

- 新增 ON_PATCH 单测 12/12：四拓扑、Final/Fullness/Continuity、Mirror、Loop 跨 seam、Offset 拒绝、弧长点、CurveSpan、下游 Patch、dirty/delete/load、直接及隐藏环、公共绘制属性与遮挡。
- 全量 unit：311 passed / 5 failed。五项均为已有基线：head-frame 的 ±0 存档等价、旧默认 Landmark 项目断言、45° 旧视图预期、on-curve 的 ±0 migration、patch-prep 的 ±0 存档等价。没有为通过测试改动这些既有行为。
- 浏览器原有专项 21/21，加两个新增场景后共 23 个独立场景通过。新增三个 ON_PATCH 场景覆盖 draft/确认/取消/Undo、四 Host 显示/Fullness/端点鼠标拖动、真实头壳 Contour。
- TypeScript 与生产 build 通过；保留已有 bundle >500 kB 提示。

本轮前源码快照：`artifacts/v062/pre-v062-source.tar.gz`，包含已有未提交工作，未覆盖原项目存档。停止在 V0.6.2，未扩展 ON_HELMET/CAP/REGION、任意面内点、geodesic 或独立 shape handles。
