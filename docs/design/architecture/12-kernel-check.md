# 12 候选内核职责核对（源码审查）

草稿 v0.1（2026-10-07，Claude 汇总；**待 dot 抽查源码依据**）。
按 10 §0 第 2 步：对照 11 的对象和编辑契约，逐项核对每个候选内核能承担哪些职责。全部 19 项职责见 `scratchpad/kernel-check/RESPONSIBILITIES.md`（R1–R19）；本文只展开决定选型的 4 组。

**方法**：只审源码和文档，证据用固定版本链接。每格的状态取以下之一：
- **未找到**：源码里没有对应的东西。
- **找到函数**：有相关函数，但语义和我们要的不一样，或者还不清楚。
- **语义符合**：读代码判断能满足我们的语义，但还没跑过。
- **需适配**：可以用，但要做明确的改动。

**没有任何一格经过运行验证**；凡是涉及运行时行为的说法，都标为“待验证”。

披露：Paper.js 的核对代理在范围调整（不装依赖、不跑脚本）送达之前，已经装了 `paper@0.12.18` 并跑过两个脚本（在 scratchpad 里，没有动仓库）。它的观察结果只作为“待验证”的线索，**不算验证**。

## 1. 决定选型的四组职责

| 职责 | E1 tldraw SDK v5.5.2 | E2a svgcanvas v7.4.2 | E2b Fabric.js `9ccefc1` | E2c Paper.js v0.12.18 |
| --- | --- | --- | --- | --- |
| **R1 段和锚点的稳定寻址** | 需适配：原生只有形状级 ID。line 形状把点存成“ID → 点”的字典，自定义形状可以照此存锚点和段（[TLLineShape.ts#L54](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/shapes/TLLineShape.ts#L54)） | 未找到：点只按 `d` 里的序号寻址，增删一个点后面的都会重新编号；元素 ID 还会被回收复用（[path-method.js#L551](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/path-method.js#L551)、[draw.js#L260](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/draw.js#L260)） | 未找到：路径就是命令数组，控件按 `c_${序号}` 命名（[Path.ts#L57](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/shapes/Path.ts#L57)、[pathControl.ts#L253](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/controls/pathControl.ts#L253)） | 需适配：Segment 只有 `_index`，Curve 是按位置算出来的；只有 Item 有 ID，而且只在本次会话内有效（[Path.js#L447](https://github.com/paperjs/paper.js/blob/v0.12.18/src/path/Path.js#L447)、[Item.js#L146](https://github.com/paperjs/paper.js/blob/v0.12.18/src/item/Item.js#L146)） |
| **R13–R15 一次手势接入统一事务，失败整体回滚，只有一套撤销** | 需适配：`store.put` 会逐条校验记录，抛错时整体回滚；before-change 处理器可以否决修改（[Store.ts#L617](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts#L617)、[StoreSideEffects.ts#L57](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreSideEffects.ts#L57)）。**但是**在 `editor.run` 里抛错会被当成崩溃，store 被标记为可能已损坏（[Editor.ts#L387](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/Editor.ts#L387)）；历史里未提交的 diff 是否会残留，待验证。撤销是一套栈，用 mark / squash / bail 来分组；`editor.history` 不能替换 | 未找到：先改 DOM，事后才记录命令，失败时不回滚；拖动过程中直接改文档本身（[selected-elem.js#L202](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/selected-elem.js#L202)、[event.js#L87](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/event.js#L87)）。`undoMgr` 可以替换，但大约有 40 处直接调用它 | 未找到：`set()` 直接写入；`fire()` 没有返回值，监听者无法否决；没有任何历史记录（[CommonMethods.ts#L29](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/CommonMethods.ts#L29)、[Observable.ts#L167](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/Observable.ts#L167)） | 未找到：每个 setter 都立即写入，没有事务，也没有撤销；错误输入会被静默转换（[Base.js#L180](https://github.com/paperjs/paper.js/blob/v0.12.18/src/core/Base.js#L180)） |
| **R3–R5 跨图层连接、有向路径、独立的填充边界** | 需适配 / 未找到：一个 binding 只能连两个形状；锚点 ID 只能塞进自定义属性；三岔连接需要一个中心记录；跨页面的连接不处理。路径和由多段围成的填充都要自己做成记录（[TLBaseBinding.ts#L54](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/tlschema/src/bindings/TLBaseBinding.ts#L54)） | 未找到 | 未找到 | 未找到：一个段只属于一条路径，填充只用自己的段（[CompoundPath.js#L347](https://github.com/paperjs/paper.js/blob/v0.12.18/src/path/CompoundPath.js#L347)） |
| **R17–R18 界面和 API 共用内核，错误结构化** | 找到函数：工具都通过公开的 Editor 方法操作，`dispatch` 可以用合成输入来驱动；但有些逻辑只写在工具里面，比如 Resizing 有自己的缩放路径。编辑操作失败时静默，没有错误码（[Editor.ts#L8998](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/Editor.ts#L8998)） | 需适配 / 未找到：API 依赖隐藏的界面状态（当前选择、缩放比例、编辑模式的单例）；失败时返回 `false` 或什么都不返回 | 找到函数：编程接口直接修改对象，不经过手势事件，所以界面和 API 走的是两条路径；`FabricError` 只用于加载 | 需适配 / 未找到：没有界面操作这一层；命令层得完全自己写；错误只是普通字符串 |

## 2. 其他与选型有关的发现

- **整组变换（11 的〔待定 5〕）**：
  - Paper.js 的 `applyMatrix` 开关两种都支持：开着时变换烘焙进点，关着时保留为属性（[Item.js#L149](https://github.com/paperjs/paper.js/blob/v0.12.18/src/item/Item.js#L149)）。这可以作为原型里做对比的现成参考。
  - svgcanvas 的策略是混合的：缩放和平移写进路径的点，旋转保留为属性（[recalculate.js#L146](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/recalculate.js#L146)）。
  - Fabric 的 Group 保留变换，但默认的布局方式会改写包围盒（[Group.ts#L378](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/shapes/Group.ts#L378)）。
  - tldraw 只有平移和旋转，缩放会烘焙进子对象。
- **引用 / 实例（R8）**：tldraw 和 Fabric 都没有。svgcanvas（`<symbol>` + `<use>`）和 Paper.js（SymbolItem）都有，但都不支持覆盖，也不能单独定位实例里的子元素。
- **跨图层的深度偏移（R9）**：四个候选都没有，绘制顺序都只在同一个父级内部排列。
- **存档版本和迁移（R16）**：只有 tldraw 的 store 语义符合：每种记录各自有迁移序列，迁移失败时 store 不变（[StoreSchema.ts#L156](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreSchema.ts#L156)）。其余三家都没有版本迁移。
- **维护情况**：Paper.js 的 develop 分支最后一次推送是 2024-07-23，2024-08 以后没有合并过任何 PR；2025–2026 年新开的 PR 大多被关闭而没有合并。所以**“已停滞”这一点有证据支持**（GitHub API，2026-10-06）。

## 3. 可以直接借用的部分

| 来源 | 可借用 | 许可证 |
| --- | --- | --- |
| `@tldraw/store`（以及 `@tldraw/tlschema` 的记录写法） | 单一文档存储、逐条记录校验、整体回滚、副作用钩子、带版本的迁移 | MIT |
| Fabric.js | 画布事件循环、命中测试、框选、变换框（缩放 / 旋转 / 斜切）、Control 框架 | MIT |
| Paper.js | 段、手柄、曲线、描边、填充的命中测试；Bézier 计算；`applyMatrix` 的两种语义可作为参考 | MIT |
| svgcanvas | 变换框的数学、节点编辑（文件头标注 MIT） | MIT |

## 4. 初步结论（待 dot 抽查后再交给 bowen）

1. **四个候选都不能直接作为我们对象模型的权威内核**。R1、R13–R15、R3–R5 这几项是我们模型的核心：段和锚点的稳定身份、统一事务、跨层连接和填充。没有哪家原生具备；即使选它们，这些也全都要我们自己在上面写。
2. 差别只在于“谁能提供更多可用的零件”：
   - **存储层**：`@tldraw/store`（MIT）最强，有校验、回滚、迁移和副作用钩子。
   - **交互层**：Fabric 的选择和变换框最成熟；Paper.js 的命中测试最细，但已停滞。
   - **tldraw editor 整体**：可以当作可选的界面外壳。但它是专有许可证，另外“抛错就崩溃，而不是回滚”这一点和我们的提交协议冲突。
3. 所以实际的路线倾向于：**我们自己的对象模型和编辑契约（11）**，建在 `@tldraw/store` 这类成熟的存储层之上，再借用或移植 Fabric、Paper 中经过验证的交互和命中代码。这介于原先的 E2 和 E3 之间。是否把 tldraw editor 用作界面外壳，单独评估。
4. 上述结论都只来自源码审查。凡是标了“待验证”的地方，比如 tldraw 回滚失败后历史是否干净、各候选的性能，都要在最小实现里核实。
