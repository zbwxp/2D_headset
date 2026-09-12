# V0.2 Semantic Landmark Management

V0.1 基线：`v0.1-landmark-editor`，提交 `7a40cd0`。V0.2 在 `v0.2-landmark-management` 开发。旧 surface/solver 源码及历史测试保留，仍不参与点编辑主路径。

## 使用

运行 `npm run dev -- --port 5173`，打开 http://127.0.0.1:5173/。选择任意语义点，在左侧列表上方使用「复制」「重命名」「删除」。不存在原始点保护，也没有直接 Create Point。

- 复制中心线点：新 UUID、独立坐标数组、相同 CENTERLINE 类型，位置与源点一致，自动选中新点。
- 复制左右点：输入不含左右前缀的基础名称，创建完整 pair，两个新 UUID 互相引用，分别复制对应侧坐标，选中与源点同侧的 driver。源 pair 不变。
- 重命名：只替换名称，pair 同步修改左右名称，UUID、位置、类型和投影锚点不变。
- 删除：中心线删除单点，左右点删除整对。锚点随所属点一起移除。可撤销恢复，包含原 UUID 和 anchors。
- 删光后：复制/重命名/删除禁用，现有“新建”入口也禁用；可通过 Undo 或打开项目恢复。空项目可以保存加载和切换全局锁。

## 全局锁与新对象

`project.lockedViews` 显式保存锁定 View ID 数组。即使 `landmarks=[]`，该数组仍保存。`viewIsLocked` 优先读取它，仅对旧数据兼容从 anchors 推导。

投影锚点仍在 `landmark.viewLocks[viewId]` 中：每个 centerline 独立保存；pair 只有 driver 保存，follower 为空。Duplicate 枚举全局已锁视图，调用 V0.1 原有 `captureLock`，用新对象的当前位置和该视图的相机基建立新锚点。

一个斜视锁保留普通 pair 的 1DOF，Pure Top 显示正确斜线；两个独立锁会让新对象立即 0DOF。不自动解锁，不放松约束，不重新设计 driver/follower。

## 历史与存储

管理操作每次写入现有 `past/future` 历史一次，仍为 100 步。复制在 Undo 时完整移除，Redo 使用同一批 UUID；删除的 Undo 恢复名称、位置、类型、镜像关系和锚点；Rename 的 Undo 只恢复名称。

新 JSON 版本为 `landmarks-0.2`，读取兼容 `landmarks-0.1`。旧文件没有 `lockedViews` 时从已有 anchors 推导。新本地自动保存键为 `contour.landmarks.v02`，首次读取可回退到 V0.1 自动保存，原 V0.1 键不覆盖。浏览器本地数据不属于 Git，V0.1 分支保留并不等于个人 JSON 文件备份。

## 变更文件

新增：
- `src/domain/landmarks/management.ts`：纯数据 Duplicate/Rename/Delete。
- `src/ui/edit2d/LandmarkActions.tsx`：简洁操作按钮和名称/删除对话框。
- `src/tests/landmark-management.test.ts`、`tests/e2e/management.spec.ts`：管理操作及空项目测试。
- 本文档。

修改：
- `src/app/store.ts`：管理动作、空 selection、复用历史及新自动保存键。
- `src/domain/landmarks/model.ts`：仅类型、显式全局锁状态读写及状态码。
- `src/domain/landmarks/presets.ts`：新项目初始化全局锁数组及文件版本。
- `src/domain/landmarks/persistence.ts`：空项目、自定义点、版本兼容和全局锁存储。
- `src/app/App.tsx`、`styles.css`：操作入口、版本和空项目显示。
- `src/ui/edit2d/EditView.tsx`、`src/ui/inspect3d/InspectView.tsx`：无选中点/空数组的显示处理。
- `tests/e2e/landmarks.spec.ts`：测试读取 V0.2 存储键。
- `README.md`、`index.html`：V0.2 说明。

## 数学核对

与 Git 基线逐函数对比，`mirror`、`captureLock`、`allowedBasis`、`editingBasis`、`dragPosition`、`motionState`、`driverLocks`、`activateDriver`、`centerlineGuide` 完全一致。`src/domain/geometry/core.ts`、相机视角配置和 ReferenceControls 没有改动。setGlobalViewLock 只额外写入全局状态数组，原 driver 选择及 anchor 算法原样保留。

## 验证及限制

验证覆盖中心线复制、左右两侧复制、原始点重命名删除、Front/Right45 锁下复制、双锁 0DOF、源对象独立性、空项目、旧格式读取、UUID 和 anchors 的保存恢复，以及操作的 Undo/Redo。

仍只有语义点，无 Curve/Bézier/Surface/Patch。参考图沿用既有压缩与浏览器存储上限；撤销历史只在当前会话有效，刷新不恢复历史。名称允许重复，身份始终由 UUID 决定。新名称输入最多 80 个字符。

最终自动验证：`npm run build` 通过，49 项单元测试通过，7 组 Playwright 浏览器测试通过。已检查实际渲染截图；Git diff whitespace 检查通过。

## 显式中心线顺序（2026-09-12）

项目增加 `centerlineOrder: string[]`，仅含全部 CENTERLINE UUID，每个恰好一次。
侧栏分为中心线点和左右对称点。中心线点可拖到目标行上半部/下半部以插入其前/后；也可用 Alt + 上下方向键排序。
排序只替换顺序数组，不改变 landmark、投影 anchor、锁、坐标或选择。
所有 2D、3D 和缩略图继续共用 `centerlineGuide`，按显式顺序生成开放参考折线，不创建 CurveEdge 或几何约束。

复制中心点插在源点后；删除同时移除顺序项；重命名不改顺序。
顺序进入现有项目快照、100 步 Undo/Redo、JSON Save/Load 和本机自动保存。
旧版没有独立 UI 排序字段，因此缺少顺序时按 landmarks 数组中中心点的现有顺序迁移。
修复规则：保留有效项首次出现的顺序，移除重复、非中心点、未知 UUID；缺失中心点按 landmarks 现有顺序补到末尾。
迁移/修复后启动时立即写回本机存储；导入时保存到本机，原导入文件不覆盖。存储满时提示下载 JSON。
不根据空间位置、距离、高度或创建时间排序。

验证：52 项单元测试和 8 项浏览器测试通过，生产构建通过。
新增覆盖确定性迁移修复、复制/删除/重命名、拖拽不改变锁定几何、Undo/Redo、刷新及 JSON 导入。
投影、零空间、受限拖动和 driver/follower 数学未修改。
