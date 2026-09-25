# V0.11.0 · Drawing Room

基于 V0.10.5，完成 Drawing Room 第一轮阶段 0—3。入口在应用顶部「进入绘制间」。独立纯二维画布；不使用 HeadFrame、view keys 或曲面求值。

## 操作

- 左侧是绘图工具，中央白画布，右侧上方图层、下方属性。中间分隔条可拖动，右栏可折叠，中英文切换沿用应用设置。
- 首次进入可以「开始绘线」自动新建首层，或右侧点击「＋」新建图层。当前层只决定新线归属；其它可见、未锁定层仍可选择。
- **P 钢笔**：第一点拖出柄，继续点击/拖动建立下一段。相邻完成段自动 Smooth 接笔。Enter 或「结束绘制」结束；Esc 丢弃未完成段，已完成段保留。回到首端点附近可闭合。
- **V 选择整笔**：整笔选择与变换框；四角缩放，上方圆柄旋转，拖线移动。Shift 缩放保比例，Shift 旋转按 15° 步进。
- **A 直接选择**：单段、端点、控制柄。拖端点时相邻 handle 同移。方向键微调，Shift 加速，Alt 精调。数值与名称输入在 Enter/失焦时作为一次操作提交。
- **L 椭圆**：拖出四段 cubic 的闭合椭圆（常规 kappa 圆近似）；每段仍可独立编辑。Shift 拖正圆。
- **Merge**：第一击固定端点，第二击移动端点，只移动一次。已绑定的 moving endpoint 要先解绑。
- **Mirror Edit**：第一击源曲线，第二击目标，以逻辑 x=0 镜像写入目标，保留目标身份。右侧「水平镜像」则以所选整体中心翻转。
- **Bind**：两击建立共享位置，可绑定多条线。仅位置绑定仍画成独立笔画。
- **Smooth／尖点**：第一击保持方向，第二击调整方向并保留柄长。Smooth 为从共同节点指向 handle 的向量反向共线，尖点为同向共线。拖任一柄时另一柄联动且保持自身长度，不自动切换模式。零长度约束会拒绝并提示。
- **分割**：在线上点击，精确 de Casteljau 分割；原 ID 留给前段，后段使用新 ID，原末端关系转接到后段；新接点默认 Smooth。
- 图层与整笔都能拖动排序，也可用属性中的置顶、上移、下移、置底。列表顶部在最前。接成一笔以第一击笔画位置为排序基准。
- 多选用 Shift 点击或拖框；复制、删除、线宽、改名、移动到图层均在右侧。Ctrl/Cmd+D 复制，Delete 删除；撤销 Ctrl/Cmd+Z、重做 Ctrl/Cmd+Shift+Z。
- 参考图在最底层，默认锁定，不参与普通拾取。解锁后可平移、缩放、调透明度，也可隐藏。Space／抓手／中右键平移画布，滚轮缩放，「适配」按可见线稿居中。
- 「隐藏编辑辅助」在同一画布切换成稿显示。保存/打开仍使用顶部 JSON 操作。

## 关系与事务

- 数据保存在项目可选字段 `drawing`，内部 `version: 1`。旧项目没有该字段时仍正常加载，进入绘制间不会自动改写旧几何。
- `DrawingLayer.curves` 是所属关系与前后顺序的唯一来源。每根 `DrawingCurve` 是一段 cubic：两个内部节点 ID、两个绝对 handle 坐标、名称、可见/锁定、统一线宽。
- Bind 用多个 endpoint 引用同一个 `DrawingNode` 表达，不重复保存互相追随的位置。
- `TangentJoin` 存 endpoint 配对及 `SMOOTH | CUSP`。一端最多一个切向配对；同一共享位置可以有其它只 Bind 的分支。
- 连续笔画是 endpoint 邻接关系派生结果，**不是额外 Path 资产**。允许闭环，不走 Recording 的曲线依赖 DAG。可见连续链一次 SVG path 描边，无内部端帽。
- 当前一笔统一线宽。合并笔画继承第一击宽度，更新样式作用于整笔。锁定成员不能被间接修改。
- 单段整体变换遇到未选中的绑定邻居时，先要求「选中所需关联曲线」。补齐选择本身无历史；重做操作时，只变换原操作范围及实际受影响的邻接节点/handle，不递归把整张脸拉入。共享端点直接拖动属于显式修改共享位置，无需该提示；锁定/隐藏成员仍阻止修改。
- 跨层移动必须带上位置关系连通成员，以维持 V1 的同层连接限制。需要补选时提示，不静默断开关系。
- 指针拖动、两击预览仅在 runtime draft 中，抬起完成一次历史。取消不写项目。保存校验包括节点、层所属、唯一配对、方向、线宽及参考图结构。

## 模块与复用审计

- 新几何：`src/domain/drawing/model.ts`、`commands.ts`、`strokes.ts`。
- 新界面：`src/ui/drawing/`，独立工具/选择/草稿状态。
- 接入：`App.tsx` 增加工作区切换并卸载建模键盘操作；项目 schema/persistence 增加可选 drawing；store 复用现有事务、自动保存与 Undo/Redo。
- 复用已有二维 tuple 类型、通用 Bézier 精确分割/求值、曲线位置拾取、图片读取校验、语言字典。
- 旧 Recording Smooth 在 `src/domain/recording/smooth.ts` 仍然按 radius 裁剪 source、生成 transition。Drawing 没有调用或修改它；没有增加 radius、trim 或 transition。
- 原几何文件未为本任务修改，HeadSet、Eyes、Patch、Surface Smooth 行为保持原样。独立浏览器验证 Drawing 编辑前后除 `drawing` 字段外整个项目数据不变。

## 验证结果

- `npm run build`：通过。
- `src/tests/drawing.test.ts`：18 项通过，涵盖四类 START/END 配对、两种模式、共享节点、局部变换范围、锁定、闭环、精确分割、排序、镜像/合并、复制、跨层、保存校验。
- `tests/e2e/drawing.spec.ts`：7 项真实浏览器流程通过，涵盖连续钢笔、V/A、拖 handle/变换框、数值与键盘、两击预览/取消、椭圆、参考图、图层命名/拖动/显示/复制/删除、选择补齐、保存下载/导入/刷新恢复、中文切换、工作区隔离。
- 绘制间 7 项 + 原录制间 12 项 + 录制绘制区域 3 项 + Eyes 2 项 + 建模 authoring 3 项，共 **27 项浏览器回归通过**。
- 全量单元：525 项，520 通过，5 项失败。开工前 507 项已有同样 5 项失败，本轮未更改这些旧失败：
  - `landmark-management.test.ts`: H: mixed management operations roundtrip UUIDs, custom names, positions, mirrors and anchors
  - `landmarks.test.ts`: 20 stable UUID landmarks, six centers, seven mirror pairs; no surface geometry
  - `landmarks.test.ts`: unlocked pitch vertical drag follows the camera 45-degree axis; partner is projected independently
  - `landmarks.test.ts`: driver handoff reanchors at current coordinates and follower remains unconstrained through roundtrip
  - `silhouette.test.ts`: final patch source includes Fullness, preserves provenance, ignores display settings

## 截图和回滚

- 实际画布（由测试用鼠标连续绘制上/下眼睑、椭圆和发束）：`artifacts/drawing-room/workspace.png`，中文版 `workspace-zh.png`。
- 开工源码快照：`artifacts/drawing-room/V0.10.5-before-drawing.tar.gz`。包含当时 src、tests、package 与配置；不是覆盖当前工作目录的自动回滚命令。仓库本来有大量未提交历史工作，本轮未重置或批量提交它们。

## 停止范围

本轮到阶段 3 停止。仅等宽线稿，**没有填充或遮挡底面**；排序不意味着头发自动挡住后方眼睛。未做线宽预设/笔刷、偏移跟随、批量弯折、SVG/图片导出、Recording 同步。参考图只作为编辑参考；后续真正导出线稿时需排除参考图。
