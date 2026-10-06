# 12 候选内核职责核对（源码审查）

草稿 v0.3（2026-10-07，Claude 汇总；v0.2 按 dot 抽查修正了事务语义、收窄了结论；v0.3 增加 §5 扩展成本比较）。
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
| **R13–R15 一次手势接入统一事务，失败整体回滚，只有一套撤销** | 需适配：`store.put` 会逐条校验记录，抛错时整体回滚；before-change 处理器可以否决修改（[Store.ts#L617](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/Store.ts#L617)、[StoreSideEffects.ts#L57](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/store/src/lib/StoreSideEffects.ts#L57)）。**更正（dot 抽查）**：v0.1 写的“抛错会崩溃而不是回滚”不准确。单独调用 `store.put` 失败时会回滚，源码和上游测试都能证明（[Store.test.ts#L495-L511](https://github.com/tldraw/tldraw/blob/be4d5b30cbf896c92436d634e59843a920705cef/packages/store/src/lib/Store.test.ts#L495-L511)）；`editor.run` 里抛出的异常会**先回滚，再进入崩溃处理**（[Editor.ts#L387](https://github.com/tldraw/tldraw/blob/v5.5.2/packages/editor/src/lib/editor/Editor.ts#L387)），两种行为同时存在。真正待验证的是边界情况：嵌套事务内部自己捕获异常时、有非响应式的副作用时、已经成功写入一次之后再失败时，历史 diff 能否被完整清理。**不能把单次 put 会回滚，扩大成“所有手势都有回滚保证”。**撤销是一套栈，用 mark / squash / bail 来分组；`editor.history` 不能替换 | 未找到：先改 DOM，事后才记录命令，失败时不回滚；拖动过程中直接改文档本身（[selected-elem.js#L202](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/selected-elem.js#L202)、[event.js#L87](https://github.com/SVG-Edit/svgedit/blob/v7.4.2/packages/svgcanvas/core/event.js#L87)）。`undoMgr` 可以替换，但大约有 40 处直接调用它 | 未找到：`set()` 直接写入；`fire()` 没有返回值，监听者无法否决；没有任何历史记录（[CommonMethods.ts#L29](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/CommonMethods.ts#L29)、[Observable.ts#L167](https://github.com/fabricjs/fabric.js/blob/9ccefc119b90fe74c6fd74c1da9837b14de92a40/packages/core/src/Observable.ts#L167)） | 未找到：每个 setter 都立即写入，没有事务，也没有撤销；错误输入会被静默转换（[Base.js#L180](https://github.com/paperjs/paper.js/blob/v0.12.18/src/core/Base.js#L180)） |
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

## 4. 初步结论（v0.2：按 dot 的意见收窄到证据能支持的范围）

1. 证据能支持的结论只有一条：**四个候选都没有一家能开箱即用地满足我们全部的领域契约**，包括段和锚点的稳定寻址、统一事务、跨层连接和填充、实例覆盖。缺少原生功能**不等于**无法通过扩展来承载。
2. 要证明某个候选“不能作为权威内核”，必须指出一个**通过扩展也解决不了的具体冲突**。目前列为“初步的可能冲突、待验证”的有以下几项，都还没有定论：
   - svgcanvas 和 Fabric 的路径点只能按数组序号寻址，编辑工具也是按序号写回的。要改成稳定 ID，等于重写它们的路径编辑部分。这算“扩展成本高”，还是“冲突”？
   - tldraw editor 的事务失败语义，在嵌套事务和多步写入这些边界情况下的表现（见 §1）。
   - Paper.js 的段只属于一条路径（R3）；我们需要的“跨路径共享锚点”能否靠外部的连接表来实现，成本有多大。
3. 因此，下一步要做的是**比较各候选的扩展成本**，而不是排除它们：对每个候选，把 11 的例子画稿和 09 的最小工程需要补写的部分逐项列出来，估算工作量，并找出可能的硬冲突。
4. 关于存储层、交互层哪家“最强”“最成熟”“最细”，v0.1 的这类排序**已收回**，目前的证据不足以支持。§3 的“可借用部分”只列出了各家的功能，并不代表已经比较过哪家更好。
5. 本文全部结论都只来自源码审查；凡是标了“待验证”的地方，都需要实际运行来确认。

## 5. 扩展成本比较（v0.3，源码审查，未运行）

按 dot 的要求，对每个候选回答四个问题：
- 能否只通过**公开扩展点**接入，还是需要 fork 或打补丁；
- 原有的哪些能力可以**保留**，哪些要**绕开**；
- 以后**升级**的代价有多大；
- 是否存在**扩展也解决不了的冲突**。

前提（四家通用）：数组下标可以通过“映射表 + 拓扑变化通知”转换成稳定 ID；跨图层联动用连接记录来实现，不要求两条路径共用同一个锚点对象（dot 的提醒）。

| | tldraw SDK v5.5.2 | Fabric.js `9ccefc1` | Paper.js v0.12.18 | svgcanvas v7.4.2 |
| --- | --- | --- | --- | --- |
| **不 fork 能做到吗** | 大部分可以，都走公开扩展点：自定义 `ShapeUtil`、`BindingUtil`、`StateNode`，副作用处理器，自定义记录，`createComputedCache`，以及撤销历史的 mark / squash / bail。**唯一的例外**：在 `editor.run` 里抛错会先回滚、再进入崩溃处理，所以必须遵守“写入前先校验，绝不在运行中途抛错”；做不到的话，就得给 `Editor.run` 打补丁 | 可以，**前提是 Fabric 对象只是我们文档的投影**。具体做法：Path 子类加 `segIds[]`、通过 `classRegistry` 注册、自定义 `actionHandler`、重写 `_render` / `_toSVG` | 可以，**前提也是 Paper 只当投影**。具体做法：WeakMap 段→ID、用公开的弧长和截取函数、把 `applyMatrix` 设为 false | **不行**：段 ID 的变化通知（要包装 `Path.addSeg` / `deleteSeg`）、填充不被原生工具误改、原生工具在写入前校验，这三项都要给内部打补丁 |
| **保留** | store、持久化与迁移、撤销历史的标记、工具状态机、相机、空间索引、吸附、整形状变换、binding 生命周期、导出管线 | 事件循环、手势状态、选择与框选、变换框的数学、Control 框架、视口 | 段对象、命中测试、弧长计算、渲染、`exportSVG` | 图层的显隐、透明度和顺序；缩放平移；SVG 序列化；选择框的绘制 |
| **绕开** | 形状以下的选择和编辑；实例；组的缩放（它会烘焙进点，且没有斜切）；用 Editor 方法作为错误出口 | `path` 作为数据模型；序列化；适应内容的默认布局；包围盒命中（要么逐像素命中，要么重写 `findTarget`）；派生对象的缓存 | 会生成新段的操作（`divideAt`、`splitAt`、`join`、`simplify`……）；SymbolItem；它的错误处理 | 原生路径编辑（除非打补丁）；命中测试；`<use>`；原生撤销命令；导入时的 ID 重建；错误路径 |
| **升级代价** | 中：主要依赖已公开的 API；要避开受保护的 `editor.history` 和标为 @internal 的 `addHistoryInterceptor`；形状以下的选择要依赖未写进文档的 `Geometry2d` 行为 | 中到高：重写点包括带下划线的方法（`_render`、`_toSVG`、`_exitGroup`）；`findTarget` 和原点默认值都在 7.0 出现过破坏性变更 | 上游几乎没有新版本，所以升级成本接近 0；**代价是 bug 只能自己修**（例如 #2058 被关闭而没有合并） | 高：没有 `exports` 字段；7.4.1、7.4.2 这样的补丁版本也改过变换语义 |
| **扩展解决不了的冲突** | 不 fork 的话，无法“在事务中途失败并整体回滚”，所以拒绝必须全部发生在写入之前；如果把“图层”映射成 tldraw 的页面，跨页 binding 不支持（映射成组或 frame 则没有这个问题）。实例没法复用真实形状，因为一个形状只能有一个父级 | 未发现。最接近的两个是：精确的几何命中测试要依赖内部实现；离开多选状态时，变换会在手势范围之外被烘焙进对象（待验证） | 未发现（只看那 7 项需求的话） | ① 原生手势在任何钩子之前就改了 DOM，`mouseDown` 无法否决；② 生成出来的填充和描边不能对原生工具设为不可编辑；③ 每个事件只有一个 `bind` 槽，而且不带变化细节 |

### 5.1 审查中发现的一项设计层冲突（不只是 Paper.js 的问题）

Paper.js 的核对指出了一个问题：**跨图层的深度偏移**和**图层整体透明度**互相冲突。

图层透明度小于 1 时，整个图层要作为一个整体先合成、再按透明度叠上去。可是如果某条线靠深度偏移插到了另一个图层的对象之间，它就不再属于这次整体合成，所在图层的整体透明度也就无法作用到它身上。如果改成给每个对象单独应用透明度，在对象互相重叠的地方，视觉效果会和整体合成不同。

这是**我们自己的需求组合**带来的冲突，换哪个内核都会遇到。需要 bowen 和 dot 决定：
- 带深度偏移的对象是否不参与图层的整体透明度；或者
- 图层透明度改为逐对象应用，接受重叠处的视觉差异；或者
- 规定深度偏移不能跨出一个“合成组”。

### 5.2 小结（待 dot 抽查）

1. **tldraw SDK** 和 **Fabric** 都能**不 fork、只通过公开扩展点**承载我们的模型。两者的区别在于：
   - tldraw 自带数据层（store、迁移、撤销），但要遵守“写入前校验”，并且有专有许可证；
   - Fabric 只能做交互层和显示层，数据层要我们自己出，升级时要重新检查几个带下划线的重写点。
2. **Paper.js** 也能以投影的方式接入。但它的贡献主要是几何计算和命中测试，而且上游已停滞，bug 只能自己修。
3. **svgcanvas** 的关键需求要打内部补丁，升级代价高，在这四家里扩展成本最高。
4. 下一步：把 tldraw 和 Fabric 这两条路线，按 11 的例子画稿和 09 的最小工程**列出需要补写的具体模块并估算工作量**；“待验证”的各项留到最小实现时再核对。
