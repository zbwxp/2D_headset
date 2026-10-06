# 10 最小地基的来源清单

草稿 v0.2（2026-10-07，Claude 提议；**待 dot 审定，再请 bowen 点头**）。
分工（bowen 定）：Claude 写代码；dot 负责需求、架构边界和独立验收。
dot 的要求：每一块都写清三件事：
1. 复用哪个现成模块、参考哪份具体实现，附源码位置和版本；
2. 为什么适合我们，哪些行为原样保留，哪些必须适配；
3. 用什么测试证明，适配之后选择、编辑、撤销、保存仍然一致。

我们自己补写的连接部分，也要标明理由。源码路径都在 2026-10-07 通过 GitHub API 核对过存在；“行为”一栏是根据官方文档和源码阅读得出的判断，**还没有运行验证**。

## 0. 范围：两步走

| 阶段 | 包含哪几块 | 验收 |
| --- | --- | --- |
| 第一步：无界面核心 | §1 文档与引用、§2 事务与历史、§3 保存加载、§4 继承与求值 | 用测试把 09 的最小工程完整跑通 |
| 第二步：画布与工具 | §5 选择与变换框、§6 路径编辑、§7 描边 | 07 的共同检验流程；**绘制和录制必须走同一套编辑过程** |

## 1. 文档与引用

| 项 | 内容 |
| --- | --- |
| 来源 | `@tldraw/store` v5.5.2（MIT）：`packages/store/src/lib/Store.ts`、`RecordType.ts`、`StoreSchema.ts`、`migrate.ts` |
| 用法 | 候选一：直接依赖。候选二：参考它的思路，用 Immer 自己写一个最小版。**待和 dot 商定** |
| 为什么适合 | 记录带类型和稳定 ID，有差异（diff）和 schema 迁移，正好对应“一份数据、永久编号、文件格式带版本” |
| 原样保留 | 记录 ID 机制、按记录类型划分、迁移序列 |
| 必须适配 | 模板继承、角色局部修改、跨部件贴附这些引用关系，store 本身不懂。要我们自己写一层“引用校验”：删除被引用的记录时要拦下，并列出影响范围 |
| 注意 | tldraw 只有 `store` 和 `state` 两个包是 MIT；`@tldraw/editor`、`tldraw` 是专有许可证，**不复制任何代码** |
| 测试 | ① 改名不改身份（RC-01）；② 删除被继承的脸型 A 时被拦下，列出 B 和小明（09 §6）；③ 旧版本文件迁移后，所有记录内容不变 |

## 2. 事务与历史

| 项 | 内容 |
| --- | --- |
| 来源 | Immer v11.1.21（MIT）：`src/core/immerClass.ts`（`produceWithPatches`）、`src/plugins/patches.ts`；Compositor @ `11d8d7a`（MIT）：`Compositor/Document/DocumentHistory.swift`（撤销分组、无变化不进历史、修订号） |
| 用法 | Immer 直接依赖；Compositor 只读它的思路，按同样的机制自己写，并在注释里注明出处 |
| 为什么适合 | 一次提交对应一组正向补丁和一组反向补丁，撤销靠反向补丁，不必为每种操作手写逆运算（dot 的检验点 1） |
| 原样保留 | Compositor 的撤销分组可以嵌套、只有最外层记一步；没有变化的编辑不进历史；每步一个修订号 |
| 必须适配 | 在 Compositor 里，beginEdit/endEdit **只划定撤销边界**，工具仍然直接改会话。我们要在这之上自己补一个**唯一入口**：提交前校验写入目标，失败时整体不生效。理由见 04、05 的契约 |
| 测试 | ① 一次拖动只产生一步撤销；② 提交失败时，文档和历史都不变（RC-18）；③ 撤销、重做反复 100 次后文档和原来完全一样；④ 纯导航（改角度）不进历史（D-001） |

## 3. 保存加载

| 项 | 内容 |
| --- | --- |
| 来源 | Compositor @ `11d8d7a`（MIT）：`Compositor/IO/ProjectController.swift`（先捕获快照和修订号，再后台写盘，写完只标记这个修订已保存）、`IO/ProjectStore.swift`、`docs/project-format.md`（版本号、加载前全量校验） |
| 用法 | 读它的思路，自己写；第一步只做内存加 JSON 文件，第二步再接 idb（ISC） |
| 原样保留 | 修订号决定是否“未保存”；加载前先全量校验，校验通过才替换当前文档 |
| 必须适配 | 保存范围是“所选资源的依赖闭包”（模板、继承源、角色、局部修改），不保存画面（dot 的检验点 2） |
| 测试 | ① 保存后重开，每个角度的计算结果都一致；② 撤销回到保存时的那一步，状态自动变回“未修改”；③ 损坏的文件被拒绝，当前文档不受影响 |

## 4. 继承、局部修改与求值

| 项 | 内容 |
| --- | --- |
| 来源 | 都是**只借鉴行为，不读也不复制源码**：Figma 的覆盖和变体（公开帮助文档）；Blender 的库覆盖、相对形态键、修正形态键、依赖图（developer.blender.org 的设计文档和用户手册；Blender 是 GPL）；Spine 的形变关键帧（`spine-json-format` 公开文档；运行时有授权限制）；Live2D 关键形态插值（用户手册；SDK 有授权限制） |
| 失效通知 | `@tldraw/state` v5.5.2（MIT）：`packages/state/src/lib/Atom.ts`、`Computed.ts`、`transactions.ts`。直接依赖，或者用 alien-signals（MIT），二选一 |
| 自己写的部分及理由 | 09 §5 的 11 步求值顺序，以及“形态 = 相对原稿的偏移”“中间角度默认存修正”。现成库都没有“参数驱动的可编辑线稿 + 模板继承”这种组合（07 §2 B 类，调研范围内） |
| 测试 | 09 的最小工程整体写成测试夹具：0° / 90° / 30° 的数值；在 30° 拖动后，“改哪一份”和“影响谁”的每种组合写入的位置；换脸型；RC-12 的“修正 vs 新形态”在 90° 再次修改后的区别 |

## 5. 选择与变换框（第二步）

| 项 | 内容 |
| --- | --- |
| 候选来源 | E2a：`@svgedit/svgcanvas` v7.4.2（MIT；整包为复合许可，要逐个核对）：`packages/svgcanvas/core/select.js`、`selection.js`、`selected-elem.js`、`recalculate.js`。E2b：Fabric.js（MIT，dot 引用的 commit `9ccefc1`）：`packages/core/src/canvas/SelectableCanvas.ts`、`packages/core/src/controls/commonControls.ts`、`scale.ts`、`rotate.ts`、`skew.ts`、`drag.ts`。E1：tldraw SDK（专有许可，只能依赖，不能复制） |
| 必须适配 | 选中的对象要映射到我们文档里的地址（槽 + 线 + 锚点 + 写入目标）；库自带的撤销要关闭或接管；权威原稿只能有一份 |
| 测试 | ① 选中的、拖动的和真正被修改的是同一个东西；② 显示、点选、高亮使用同一套几何；③ 绘制界面和录制界面调用的是同一个编辑过程（dot 的重点检查项） |

## 6. 路径编辑（第二步）

| 项 | 内容 |
| --- | --- |
| 候选来源 | E2a：svgcanvas 的 `packages/svgcanvas/core/path-actions.js`、`path-method.js`、`path.js`。E2b：Fabric.js 的 `packages/core/src/controls/pathControl.ts`（`createPathControls`）。E2c：Paper.js v0.12.18（MIT）的 `src/path/Path.js`、`src/item/Item.js`（hitTest）、`src/tool/Tool.js`。曲线计算用 bezier-js v6.1.4（MIT）的 `src/bezier.js` |
| 必须适配 | 拖动锚点或手柄时，要变成一次“向门提交”（第 2 块）；在中间角度拖动时，要先问“改哪一份、影响谁”（09 §4） |
| 测试 | 07 的共同检验流程：拖手柄 → 带收笔的线跟着变 → 关联的角色跟着变 → 一次撤销全部恢复 → 保存重开一致 |

## 7. 可变线宽描边（第二步）

| 项 | 内容 |
| --- | --- |
| 来源 | perfect-freehand v1.2.3（MIT）：`packages/perfect-freehand/src/getStrokeOutlinePoints.ts` |
| 用法 | 参考它的轮廓生成方法。它的输入是采样点，我们要改成“Bézier 曲线 + 线宽曲线” |
| 测试 | 显示和导出的描边轮廓是同一份几何；收笔只出现在可见的末端，不出现在路径内部的接头（05 的 N4） |

## 8. dot 的独立验收清单（每次提交都查）

1. 绘制和录制是否真正共用同一个编辑过程；
2. 是否出现了第二份可以写入的原稿；
3. 是否出现了第二套撤销；
4. 是否为了某个功能临时绕过了基础规则；
5. 新代码是否注明了参考来源和许可证。

## 9. 代码位置

新分支 `proto/base-v0`（从 `design/architecture` 切出），代码放在独立目录 `proto/base/`，**不碰 `src/` 下的产品代码**。每个文件头部注明参考来源（URL 或路径 + 版本 / commit）和许可证。

## 10. 待和 dot 商定

1. 文档存储是直接依赖 `@tldraw/store`，还是参考它用 Immer 自己写一个最小版。
2. 失效通知用 `@tldraw/state` 还是 alien-signals。
3. 第一步只做无界面核心，这个范围是否同意。
