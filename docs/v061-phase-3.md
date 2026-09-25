# V0.6.1 — Phase 3：2D Surface Picking & Constrained Authoring

完成范围：所有 viewport 建模输入统一到 Main 2D，3D 仅查看与选择。本轮没有实现 ON_PATCH，也没有修改 domain geometry formula 或持久化 schema。

## 选择和命中

- `InteractionDispatcher2D.ts` 集中解释工具和命中类别。普通选择为 Point > Curve > Surface；点有 8 CSS px 邻近命中范围，曲线复用 SVG hit ribbon。
- `GpuScene.pick` 复用 Surface BufferGeometry，独立 offscreen ID target，深度测试/写入开启，关闭 blending，没有 display polygon offset。只在点击/工具需要时 readback，不按帧轮询。恢复原 render target 和 clear state。
- PATCH / HELMET / CAP / REGION 的 ID 通过 `surfaceRef` 进入唯一 Selection，展开并定位统一 Surfaces 列表。
- `surfaceHit.ts` 区分 identity 与 position。Patch/Helmet/Region 在命中的 mesh 上求 triangle + barycentric；Cap 使用解析 plane hit 求 u/v；Construction ellipsoid 使用现有解析 ray–ellipsoid helper。
- Surface Point 工具筛选 Construction 对象，不让普通 Patch 吞掉工具输入。纯 HeadFrame ellipsoid 保留解析命中，不伪装成 Surface record。

## 2D 拖动

`constrainedDrag.ts` 负责屏幕到 host 参数的映射，原 source setter 负责约束、镜像、history 和求值。

| Placement | 行为 |
| --- | --- |
| WORLD / FRAME_RELATIVE | 原有投影空间拖动及 View Lock |
| ON_CURVE | 投影距离最小化得到 normalized arc-length s；多个近似解优先接近上一帧 s |
| ON_LOOMIS_SURFACE | 解析射线交点；开始时由已有 source direction 推导 Front/Back，整次拖动保持分支 |
| ON_SECTION_CAP | 解析射线与 Cap 平面求 u/v；超出既有合法 disk 时拒绝 |
| LOOMIS_SCAFFOLD / system ring endpoints | 选择，不直接拖动 |

ON_CURVE 采用 256 段候选采样并细化局部极小值，模糊解使用 6 px 距离容差保持参数连续。它是交互近似求逆，不改变 Curve evaluator。

已有 XYZ Offset 保持 source 数值不变；通过减去 offset 的屏幕投影来移动 host coordinate。一次拖动一个 Undo transaction。球面越界时保持上一个合法位置，不自动跳到背面。

## 创建工作流

- Creation Shelf → Construction Surface Point → 2D 点击 → 黄色临时点预览 → 确认创建。
- Front/Back、成对/中线是 ToolSession 参数；不写入 Point schema。切换分支清除旧 draft，需要重新点击。
- Cancel 不留下 Point；确认通过现有 ToolDraft 原子提交。
- Cap 上同样通过该入口点击并确认。
- Region：选择 Sections → 预览 → 2D 彩色候选 → 点击最近命中的 candidate → 提交。背面候选通过切换 2D view 选择。
- 进入 viewport 创建工具会自动展开隐藏的 2D 窗口。
- 原 Free Curve、whole/span/loop Patch 工具继续使用唯一 ToolSession。

## 3D 留存与移除

保留 orbit / pan / zoom / projection toggle / hover / select / background manipulation。Inspector 数值编辑不受影响。

从 `InspectView.tsx` 删除旧 surfaceDown/surfaceMove/surfaceUp、surface drag session、3D surface-point creation、Region commit/candidate handlers、Patch/anchor tool advancement 和 candidate picking。3D 在 curve、patch、surfacePoint、region 四种工具下均只改变选择，不写 source 或工具状态。

移除未被 App 使用的旧 `HeadFramePanel.tsx`，避免保留“3D 点击创建”的过期入口。

Arrow nudge 仅在 `data-authoring-focus="2d"` 且 Select 工具时生效；3D canvas 获得焦点后方向键不移动 geometry。数值和文本控件继续拥有自身键盘事件。

## 验证

- Build：通过；仍有 bundle 超过 500 kB 的体积提示。
- Unit：298 passed，6 baseline known failures；新增 4 项 constrained authoring 测试通过。
- 既有六项：旧 Landmark 数量、45° 默认视角预期、三个 migration/save-load 数值对比、HeadFrame migration 求值测试超时。没有在本轮修它们。
- 浏览器：主回归 19 项通过，另补 2D span Patch 创建/Undo/Redo 回归。
- 覆盖四类 Surface ID、点优先、三类 constrained drag、背面分支、Offset 保留、draft cancel、拖动 Undo/Redo、Region、3D 四工具状态隔离、3D arrow focus、统一 Slider、Free Curve 和原 Inspector。
- 与开工前归档比较，69 个 domain 文件逐字节一致。

截图：
- ../artifacts/v061/surface-point-2d.png：背面球面点完成 2D 拖动，行内 Inspector 与 3D 同步。
- ../artifacts/v061/cap-point-2d.png：Cap 点 2D 拖动，Offset Y = 0.08 保持。
- ../artifacts/v061/region-candidates-2d.png：2D Region 彩色候选预览。

回滚参考：../artifacts/v061/pre-phase3-source.tar.gz 为开工前 source/tests/package 快照；它不是整个工作区的 Git 回滚点。此前工作区已有修改，本轮没有覆盖或重置这些改动。

Phase 3 到此停止；ON_PATCH 仍禁用并显示 Coming in next phase。
