# V0.3.5 Local G1 Smooth Junction

本轮止于 Point + Planar Curve + Local G1 SmoothJunction。没有 Surface、Patch、Mesh、Curve View Lock、G2、恒定半径圆角或全局优化器。

## 使用

在二维编辑区右键或双击共享语义点，打开「交点检查器」。仅有两条未配对结构线时直接点击「设为平滑」；多条结构线时从未配对端点中选择两条。每个端点最多属于一个平滑连接。

平滑范围默认 15%，可调 1%–45%。一次滑块拖动是一步 Undo。悬停配对行可在二维和三维中查看两条结构线以及 V、Q1、Q2。点击绿色 blend 打开对应交点检查器；blend 不直接拖动。外侧曲线仍可按原方式编辑。

检查器使用共享 FloatingPanel，支持移动、置顶，切换视图不关闭。侧边栏 Rename/CRUD 不变。取消平滑无损恢复原曲线。

## Source 数据

```ts
interface CurveHalfEdgeRef {
  curveId: string;
  endpoint: "start" | "end";
}
interface SmoothJunction {
  id: string;
  landmarkId: string;
  sideA: CurveHalfEdgeRef;
  sideB: CurveHalfEdgeRef;
  extent: number;
  mode: "G1";
  symmetry: "paired" | "self";
}
```

`project.smoothJunctions` 只存上述 source。普通镜像配对只有一条 canonical record；另一侧由 Curve mirror 对应关系派生。左右 Inspector 修改同一 UUID/extent。不保存 Q、trim 参数、弧长表、blend 控制点、采样、VALID/INVALID 或 invalidReason。

旧项目缺省迁移为空数组。加载校验 UUID、端点归属、对称关系、extent 范围及 half-edge 独占，但不删除几何暂时失效的意图。自动保存使用 `contour.landmarks.v035`，首次可读取旧 v03/v02/v01。

## Resolved pipeline

每条 source cubic 建立 512 段固定采样的累计弧长 LUT。令 `s = extent * min(LA, LB)`，二分查找并局部插值获得两侧 trim 参数。外围使用 de Casteljau 精确 subcurve，不重拟合。两个 blend 分别为 Q1→V、V→Q2，各自留在 source Plane，端部柄长为对应 Q–V 弦长的三分之一。

共同切线按路径方向定向；Q1、V、Q2 的单位切向连续。`junctionPath` 提供四段有向局部 composite；全局 renderer 使用去重的 `resolveNetwork().spans`，避免双端 Junction 重复画同一外围段。没有新增 CurveEdge 或 Landmark。

求值按不可变 project snapshot 缓存。source body、handle、plane、Landmark、extent 或 Undo/Load 产生新 snapshot 后重新计算。V0.3 endpoint minimal-rotation transport 和镜像世界控制点数学未改。

## 严格几何分支

- 单位法向叉积长度 ≥ `intersectionStabilityTolerance = 1e-5`：使用归一化交线。
- 长度 ≤ `samePlaneTolerance = 1e-10`：同平面/反平行法向，使用路径切向和投影到共同平面的 bisector。
- 两阈值之间：拒绝不稳定近乎平行的情况，不放松 Plane。
- 真正 cusp/U-turn、零长度、退化切线或 Q–V 弦：明确失效。
- CENTERLINE 的镜像两半：两侧 Plane 必须包含 X 方向，切线使用 ±X；否则拒绝。另半 blend 严格从前半世界控制点镜像并反向得到。
- 普通 mirror：最终 canonical blend 世界控制点逐个镜像，没有独立 follower shape。

双端 trim 按弧长检测重叠并将冲突连接标成 INVALID。正常 extent 上限 0.45 意味着每端至多使用该曲线 45%，通常本身已留出 10%；额外守卫用于防止异常几何/内部数据反向。新增配对或 extent 操作若破坏已有合法连接会拒绝。

## Invalid、历史与生命周期

失效记录继续占用两侧及镜像 half-edge。该 endpoint 回退 Corner，Inspector 显示原因，extent 仍可调整；不自动取消，不画近似 Smooth。source 再次合法时自动恢复。另一个端点的合法 Junction 可以继续工作。

删除 Curve/pair 或 Landmark 会级联删除引用的 Junction；Rename 不变，Duplicate Landmark 不复制曲线或 Junction。创建、取消、extent、级联操作均使用既有 100 步 project Undo/Redo。派生几何没有独立历史。

## 渲染与拾取

2D 主视图、3D 和缩略图共享 resolved cubic spans。被 trim 的原始部分不再显示或命中。外围命中参数从 subcurve 映射回原 source 参数再交给现有 body 编辑数学；blend 命中映射到共享 Landmark/交点检查器。Q 标记不可编辑，不属于语义点。

## 验证与限制

75 个单元测试（新增 13 个）与 20 个浏览器测试（新增 3 个）。覆盖四种端点方向、精确外围段、G1/planarity、阈值分支、body/handle/plane 重新求值、自对称与镜像、占用、失效/恢复、双端范围、Save/Load、删除及 Undo/Redo、Inspector 和 resolved picking。

弧长为固定 LUT 数值近似，外围 subcurve 为精确 cubic 分割；严格平面/G1 在浮点容差内检验。只保证局部接缝 G1，不保证 G2、恒定曲率或整个网络无自交。狭小范围或极端 source 曲率可能需要用户调整 source。未加入自动配对、blend 直接编辑或全局 CurveChain 拓扑管理。
