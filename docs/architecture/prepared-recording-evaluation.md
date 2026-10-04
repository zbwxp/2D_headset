# 统一录制求值与性能重构

核对：2026-10-04 11:46 UTC。线上仍为 v84。最小改动反推的正确性候选冻结于 `c5d7c73`，尚未发布；本文件是统一性能重构方案及基线，不把方案当成完成实现。

## 已确认的问题

慢的主要不是四个二维 Bézier 控制点的加权。一次修正目标目前会从多个入口重复组织快照依赖、真实基点、镜像、覆盖与材料。部分最终缓存查询发生在这些准备之后；小型全局缓存还会淘汰同一次拖动的起点。

同一个冻结起点、连续新目标，私人 124 的 Node CPU 中位数如下。计时不含文件解析和断言，也不是浏览器帧率。

| 操作 | 预览准备 | 显示求值 | 完整提交准备 | 提交后显示 |
| --- | ---: | ---: | ---: | ---: |
| 耳根 X，40% 方向跟随，需调整基点 | 456.8ms | 26.8ms | 562.4ms | 447.3ms |
| 耳根 Y，同上 | 402.9ms | 20.2ms | 521.9ms | 416.7ms |
| 侧轮廓横缩，原响应路径可解 | 34.5ms | 17.6ms | 49.5ms | 416.3ms |
| 侧轮廓纵缩，需调整基点 | 471.4ms | 19.1ms | 438.0ms | 396.5ms |

回退路径请求基线九个 basis、四个单独 basis、最终九个 basis 重放；显示又请求九个。这是请求/遍历次数，不意味着每次都重新拟合所有几何，但依赖和材料准备仍发生在缓存检查前。最终重放约 204–283ms，自动镜像层传播约 60–80ms；纯优化器只有耳根 5–7ms、纵缩约 45.5ms。分项计时可能包含嵌套工作，不能相加成新总数。原始结果在 `artifacts/interpolation-architecture/minchange-warm-baseline.json`。

## 当前入口及职责

| 用户动作/产品 | 现有入口 | 可复用的权威内核 | 当前重复准备 |
| --- | --- | --- | --- |
| 真实视角与游标预览 | `evaluateRecordingSnapshot` / `resolveRecordingSnapshotBasis` | `resolveSnapshot`、`evaluateOwn` | 每个根新建递归会话；全顶点解析后才查结果缓存 |
| 真实基点 A/V/曲边框 | Drawing shared editor → `prepareSnapshotDrawingToolEdit` / domain adapter | `captureSnapshotControlTargets` | 目标、校验和画布各自取得相同姿态 |
| 中间角 A/V/临时框 | `captureSnapshotDrawingControlTarget` | `prepareSnapshotSurfaceTargetEdit` | 重取基线、basis、完整目标重放 |
| 最小改动回退 | `surfaceBasisFallback` | `boundedBasisInverse` 与同一目标/重放内核 | 基点补偿及保护角度再次进入整个 Recorder |
| 洋葱皮 | `useSnapshotOnionFrames` → `surfaceOnion` | `createSnapshotSurfaceValueSampler` | 每次扫帧另建 coverage 和 sampler 容器 |
| 视角镜像 | `viewMirrorSurface` / `viewMirrorMaterial` | 局部零基准对应及同源采样 | 不同调用者重复准备零基准及反射支持 |
| 区间反推/主材料 | `propertyResponses` / `surfaceMaterial` | 原路径参数运输、材料 recipe | 与几何路径的准备生命周期不统一 |
| 父源/成员传播 | `automaticSnapshotEdits` / source adapter | 相同快照关系和材料来源 | 纯响应/草稿事务也解析镜像父稿几何 |
| 保存/丢弃/提交 | `commands` → `snapshotEditTransaction` | 统一 ownership、schema、精确回放 | 内部可信提交仍深复制全工作区，丢失缓存身份 |
| Undo/Redo | 全局 store 历史 | 完整项目事务 | 不能依赖只按 ID 的可变修订号，否则旧状态误用新缓存 |

真实快照、source 原始几何、录制响应仍各守其职责。重构统一的是计算所有权、产品请求和失效传播，不增加另一套编辑器或插值数学。

## 唯一准备上下文

在 `resolveSnapshot` 和三角求值入口下建立 domain 所有的不可变 `PreparedRecordingContext`。它组合通用快照依赖解析与 Recorder 的 mesh/响应服务；Drawing 引用快照也使用同一快照解析服务。现有导出函数可保留薄适配器，禁止为某个 UI 工具再建立独立求值器。

上下文持有：

1. 经验证的 source/library/snapshot 索引、单父及图层引用依赖、反向依赖。
2. 有效 saved/live-draft 策略，包括中间修正拥有的异角末端基点草稿。
3. 可按需解析的 basis 和中间阶段值，以及结构性 membership/coverage 计划。
4. 编译后的响应、表达式、镜像、材料和显隐规则；每次采样独立的临时缓冲。
5. 按产品缓存的控制几何、终端材料/显隐、paint/depth/ink 输入和诊断。

概念接口是 `prepare → sample / sampleMany → beginGesture → fork(changes) → validateCommit`。具体接口以实现时的最小职责划分为准，不能让调用者重新拼一次基点列表。requested angle、draft 可见策略、0−/0+侧、质量选项与需要的产品属于请求策略；“从父解析调用还是根调用”本身不是几何依赖。

快照、镜像、材料 recipe、显隐 recipe、响应表达式和曲边拟合已有依赖枚举器，应归到同一解析会话。按当前单形、各红色范围外曲线的投影支持、反射角度/角点、表达式叶子和隐藏拟合兄弟取依赖闭包；不能只取当前三角，也不能无条件取全九点。

## 结构、数值与产品分层

结构 coverage 保存候选支持区域和 canonical 成员对应；坐标修改不重建这部分。不过 EndpointLink 是否在所有支持姿态中保持同点仍依赖几何，必须随脏坐标复核。显隐、层序等离散元数据的主导基点随几何重心坐标变化，不能固定在编译时。

共同阶段为：输入/成员与来源 → 局部变形和保留域依赖 → 最终 basis 控制 → 支持及原始重心坐标 → 响应/表达式/镜像与 linked/SMOOTH 约束 → 终端材料/显隐 → paint/depth/ink。

有序域中的 ARC、材料参数映射和拟合可能影响最终控制点，因此不能把所有“材料”粗暴移到最后。应区分产生权威几何所必需的域材料依赖，与最终区间裁切/墨线。完整曲线洋葱不请求后者；仍使用相同的几何产品。

`createSnapshotSurfaceValueSampler` 带投影/拟合/反射的临时采样状态。跨主画面、洋葱和反推共享编译程序，不能共享未清理的可变角度缓冲。

## 手势与提交

手势起点固定项目身份、上下文、当前目标、选区关系闭包、basis、响应权重、归一化尺度、信赖范围及已校准角度输出。每个 pointer target 从这个起点 fork，上一轮数值解至多作为初值，不能改变基线或保护目标。

所有 A/V/旋转/非等比/临时框都提交同一目标计划。计划输出明确的脏集合：坐标、basis 草稿、响应支持、结构成员、材料、关系和镜像依赖。候选只重新计算其传递闭包，精确回放的结果直接交画布或洋葱，不在 UI 另求一次。

完整提交仍检查项目版本、锁定/所有权、共同草稿、schema 及权威回放，形成一笔全局历史。可信、已验证的不可变内部状态应保留未变对象身份；外部 JSON/可变批处理仍防御性复制和验证。取消只丢弃候选上下文，不存在异步迟到提交。

最小改动反推要求不变：0° 严格不动；已有可解响应路径结果不变；只有不可解时才有限调整末端基点，端点移动代价高于相对柄；保护原校准输出。新回退目前限基于 0° 的主轴 ±90° 边，二维内点和已有继承表达式的扩展须明确列出，不能借性能重构偷偷改变数学能力。

## 失效规则

| 变化 | 失效范围 | 应保留 |
| --- | --- | --- |
| source/add/split/delete、成员、父引用、alias/fork、mesh 绑定 | 结构依赖、coverage、下游姿态及材料 | 不可达来源与无关录制 |
| saved/draft 坐标或域参数 | 该 basis、实际后代、受影响关系/表达式/材料 | 未变结构计划和无关 basis |
| 响应 knot/sample/expression | 所属支持及反射/继承消费者 | 不读取该响应的原生 basis |
| 区间/属性 | 对应材料/paint 与读取它的 recipe | 无依赖的控制几何 |
| 游标角度 | λ、支持需求、必要的 draft 可见策略、主导元数据 | 未变几何与结构 |
| Save/Discard/Undo/Redo | saved/live 身份、共同草稿拥有者、依赖 revision | 可复用的历史不可变片段 |
| 外部导入或可变 batch | 新验证会话或显式批次 revision | 不信任可被原地写过的旧 identity cache |

## 验收与实施顺序

先完成同任务基线矩阵，再按下列顺序实现，最后统一发布：

1. 共享依赖索引/解析会话，提前查询可用值，分离结构 coverage 与几何状态；原导出函数全部接入。
2. main/onion/mirror/material/inverse/replay 统一请求产品及支持闭包，移除各自重新准备的活跃分支。
3. 手势上下文 fork、显式脏集、内部提交保持身份及传播失效；全局 Undo/取消不改变语义。
4. 差分正确性、调用计数和相同目标 CPU 对照，再完整构建与允许的浏览器检查。

计数测真实阶段执行/缓存 miss，不仅测函数调用。一个有效依赖 revision 中必需 basis/父输入/验证最多准备一次；温热游标不重建未变 basis；响应独立的小 fixture 预览重建零 basis；回退只改 side 和真实闭包且不重建固定 zero；main/onion/replay 不按帧数重复准备；属性独立的 fixture 不重建控制几何。还要覆盖超过旧缓存容量、主画面/洋葱/反推交错、source 成员变化、Save/Discard/Undo/JSON 和取消/过期目标。

基线矩阵采用私人 124 和内置完整眼耳 121 段两套数据。代表性行覆盖负/正/二维游标、真实 A/V/框、中间可解/回退 A/V/临时框、区间、9/18 帧洋葱、source 继承及提交历史，不把所有维度做笛卡尔积。失败的数学目标明确列为不支持，不能以拒绝时间冒充成功性能。

## GPU 的评估边界

当前 App 挂载 DrawingRoom 与 SnapshotRecordingWorkspace，录制使用 PaintScene/SVG。旧 `rendering/edit2d/GpuScene` 仍可把已求出的 Float32 几何缓冲交给 Three 绘制，且其 picking 有同步读取；它不是现有 Recording 插值计算后端。

先统一 CPU 准备、减少工作量，再分别量控制采样、材料/墨线、序列化、GPU 上传/读回和实际绘制。如果届时批量洋葱或绘制占主导，可评估共享产品后的 GPU 渲染接收端；不能把双精度权威逆解/回放直接改成 Float32，也不能声称 GPU 会消除关系解析、重复克隆或验证。

参考：[WebGPU 的提交和数据组织优化](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)、[NVIDIA 性能诊断指导](https://github.com/NVIDIA/elements/blob/main/.agents/skills/guidance-webgpu-performance/references/performance-diagnostics.md)。当前没有 GPU 实现或加速承诺，也没有浏览器 FPS 证据。
