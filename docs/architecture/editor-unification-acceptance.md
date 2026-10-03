# 编辑器统一实现验收矩阵

核对日期：2026 年 10 月 3 日。依据为 [已确认的原则及补充约定](editor-snapshot-recording-principles.md)、代码调用链和浏览器验证记录。基础检查点为 `dcf74eb`；提交 `fa8ddb8335d14585111eec2ea82ca8f6945ff22c` 已于当天 14:32:52 UTC 部署为 v50，并完成下述限定范围的真实云端浏览器验证。后续属性键、源删除级联和 Drawing 反向粘贴仍在实现中，不属于 v50 已完成能力。

完成标准是全部已约定职责落实在代码中，并且每项职责只有一份实际执行的实现，由 Drawing、Recording、API 和预览共同消费。公共包装函数、相同按钮或共享面板不能代替功能去重。v50 的自动化、构建与列明的浏览器操作已验证；“已接入”仍不代表其他缺口已关闭。本次文档更新未重新运行代码测试。

## 按原则核对

模块列标明当前职责落点；多文件可以承担不同阶段，但同一项规则不能各算一遍。测试列列出已有证据及其范围，不把测试辅助函数等同于实际消费路径。

| 原则 | 职责归口与当前代码 | 实际消费者 | 已有测试证据 | 尚未满足的验收条件 |
| --- | --- | --- | --- | --- |
| 1 图层 快照 录制器分工 | [model.ts](../../src/domain/recordingSnapshot/model.ts) 定义成员、单父级和角度图；[snapshotEditTransaction.ts](../../src/app/snapshotEditTransaction.ts) 统一提交边界 | `store.ts` 的 Drawing 与快照写入；`recordingSnapshotApi.ts` 的命令批次 | [snapshot-edit-transactions](../../src/tests/snapshot-edit-transactions.test.ts)、[angle-graph](../../src/tests/recordingSnapshot/angle-graph.test.ts) 覆盖归属保护、图数据与回读 | **部分**：共享提交入口已接入，完整图层编辑职责仍分布于 Drawing 与 Recording 路径。需按功能迁入共同内核，消除活动旁路，不能把事务包装算作全部完成 |
| 2 同一编辑器和一次 Undo | [drawing/commands.ts](../../src/domain/drawing/commands.ts) 生成节点、控制柄和变换目标；[transformTargets.ts](../../src/domain/recordingSnapshot/transformTargets.ts) 处理目标关系；[surfaceTargets.ts](../../src/domain/recordingSnapshot/surfaceTargets.ts) 反解响应 | `DrawingRoom` 使用 Drawing 命令；快照 `commands.ts` 的 `applySurfaceEdit` 复用目标命令后调用反解；两者通过共享事务提交 | [surface-command-api](../../src/tests/recordingSnapshot/surface-command-api.test.ts) 覆盖变换、失败原子性和一次 Undo；v50 实测基准拖动、−45° 整层反解、保存及 Undo／Redo | **部分已验证**：点和变换目标已有复用；完整绘制、拆分、连接等真实基准工具入口，以及 Drawing／Recording 的共同关系解析和手势处理仍需收敛 |
| 3 稳定 ID 动态域 点响应范围 | [sources.ts](../../src/domain/recordingSnapshot/sources.ts) 管理原始身份映射；[localMembership.ts](../../src/domain/recordingSnapshot/localMembership.ts) 管理增删成员；`surfaceTargets.ts` 只写改变的控制目标 | `resolveSnapshot` 动态解析成员；快照命令调用 `applySnapshotMembershipEdit`；反解使用规范节点与曲线 ID | [domain](../../src/tests/recordingSnapshot/domain.test.ts) 覆盖新增成员继续受已有域影响；[surface-targets](../../src/tests/recordingSnapshot/surface-targets.test.ts) 覆盖未改目标、共享节点和响应隔离 | **部分**：数据与核心求值已有覆盖；需由完整 Drawing／Recording 工具入口验证新增、删除、域变形和直接点编辑，不能从底层函数推断全部工具已通 |
| 4 层内深度上下文与快照层序分离 | [evaluation.ts](../../src/domain/recordingSnapshot/evaluation.ts) 的来源上下文与 `snapshotPaintBatches`；[drawing/depth.ts](../../src/domain/drawing/depth.ts) 的深度规则 | 引用快照求值、镜像父输入、主画面绘制批次；快照命令单独修改层数组顺序 | [local-membership-contract](../../src/tests/recordingSnapshot/local-membership-contract.test.ts) 覆盖层内交错和旧偏移不误指邻层；[automatic-snapshot-edits](../../src/tests/recordingSnapshot/automatic-snapshot-edits.test.ts) 覆盖镜像深度来源 | **已接入待验收**：补实际跨模式反向粘贴、改层序和 Undo 的浏览器检查，确认上下文在完整写入链中保留 |
| 5 单一语义父快照 | `model.ts` 的 `parentSnapshotId`；[validation.ts](../../src/domain/recordingSnapshot/validation.ts) 与 [persistence.ts](../../src/domain/recordingSnapshot/persistence.ts)；`evaluation.ts` 的父输入解析 | 项目解析、普通快照求值和自动子快照更新；各层 `baseSnapshotId/baseLayerId` 仍只是来源地址 | `angle-graph` 覆盖一个语义父级与多个图层来源并存；`automatic-snapshot-edits` 覆盖局部覆盖 | **已接入待验收**：跨来源编辑与回读需随完整适配器验收。未来切换父快照不是本次当前 UI 的完成项 |
| 6 非破坏引用与共用剪贴板 | [referenceClipboard.ts](../../src/domain/recordingSnapshot/referenceClipboard.ts) 负责地址和粘贴；[layerReferenceClipboard.ts](../../src/ui/drawing/layerReferenceClipboard.ts) 负责共享会话；`localMembership.ts` 负责本地排除 | Drawing 已接取引用；Recording 已接引用粘贴和独立复制；显式目标的纯粘贴函数能写入 Drawing 来源快照 | [drawing-layer-reference-clipboard](../../src/tests/drawing-layer-reference-clipboard.test.ts) 和 `local-membership-contract` 覆盖共享会话与身份；v50 实际完成 Drawing → Recording 的 13 层同 ID 引用粘贴 | **反向适配器实现中**：v50 的 [snapshotPresentation.ts](../../src/ui/drawing/snapshotPresentation.ts) 只有测试消费。后续正在接 Drawing 完整显示、命中与按所有者写入，Recording → Drawing 尚未验收；禁止把合成几何送回原稿写入 |
| 6 补充 源删除与局部排除 | 目标归口为规范源资产与依赖引用的统一级联清理；现有 `sources.ts`、`localMembership.ts` 区分来源与成员 | 局部排除已有消费；源曲线／源图层删除的共同级联路径正在实现 | 现有局部成员测试证明子快照排除不删源；新增源删除专项证据待接入 | **实现中**：源曲线删除清规范资产与依赖引用，保留空层；源图层删除清全部层引用；源删除后无幽灵红线；局部子快照排除仅影响本地，并按一次事务支持 Undo |
| 7 真实视图 修正帧 角度绑定分离 | [angleGraph.ts](../../src/domain/recordingSnapshot/angleGraph.ts) 保存顶点与响应；[commands.ts](../../src/domain/recordingSnapshot/commands.ts) 分流真实基准和修正 | `evaluateRecordingSnapshot`、绑定控件、修正保存／丢弃、创建空的范围外真实视图 | `surface-command-api` 和 `angle-graph` 覆盖改绑与草稿；v50 实际新建空 −90° 后粘贴，同一 −45° 反解／保存仍保持九个顶点 | **未完成内部插点**：覆盖内创建真实 60° 仍返回 `SURFACE_INSERTION_REQUIRES_TRANSFER`。正常姿态捕获与非线性响应保真细分仍待完成，不能把安全拒绝算作功能完成 |
| 7 补充 独立属性角度键 | 目标归口为 Recorder 属性层；属性纯模型正在实现，尚无可报告为完成的 v50 通路 | v50 三角化命令仍阻止中间角度的显隐／区间写入，不能以旧 channel 旁路冒充新能力 | 独立属性键、精确零和端点各自响应的专项测试及集成证据待补 | **实现中**：0° 区间 start=end，30° 展开响应保持 0，90° 再展开；起止端点独立响应，精确零长度而非 epsilon 或显隐开关；只建属性键，不建真实顶点、不烘焙几何 |
| 8 稳定二维网格与原始几何成员支持 | [triangulation.ts](../../src/domain/recordingSnapshot/triangulation.ts) 定位真实顶点、边和面；[simplexGeometry.ts](../../src/domain/recordingSnapshot/simplexGeometry.ts) 执行活动基准的成员交集 | 正常画面和逐曲线覆盖采样使用定位器与 simplex 几何；隐藏标记、修正权重不参与成员支持 | [triangulation](../../src/tests/recordingSnapshot/triangulation.test.ts)、[simplex-geometry](../../src/tests/recordingSnapshot/simplex-geometry.test.ts) 覆盖三点／两点／单点、极小非零权重、隐藏和有符号响应 | **部分**：运行时主链明确；`localMembership.ts` 的 `resolveSnapshotSimplexPresence` 目前仅测试调用。需决定统一归口或移除冗余合同辅助入口，不能拿未被消费的函数证明运行时去重完成 |
| 9 共享边响应与按轴反解 | `surfaceTargets.ts` 统一编译响应与准备目标编辑；[triangularResponses.ts](../../src/domain/recordingSnapshot/triangularResponses.ts) 求最接近原始重心权重的解；`simplexGeometry.ts` 统一采样 | 主画面、反解重放和新洋葱皮共同消费；节点权威与 `H − P` 相对柄保持一致 | [triangular-responses](../../src/tests/recordingSnapshot/triangular-responses.test.ts) 和 `surface-targets` 覆盖连续性、退化诊断；v50 实际 −45° 整层反解后保存，Undo 恢复 SVG | **部分已验证**：节点／控制柄／变换已有代码与交互证据；其他目标工具仍须进同一链。退化目标和无法用控制响应表达的 ARC 参数变化继续明确拒绝，不新增隐藏几何键 |
| 10 逐曲线红色只读投影 | [snapshotCoverage.ts](../../src/domain/recordingSnapshot/snapshotCoverage.ts) 当前负责逐曲线覆盖投影；源存活判断随级联清理接入 | 主求值和 `surfaceOnion.ts` 共用；`SnapshotRecordingWorkspace` 将 `outsideCurves` 画成无指针事件的红色覆盖层 | [snapshot-coverage](../../src/tests/recordingSnapshot/snapshot-coverage.test.ts)、[surface-workspace](../../src/tests/recordingSnapshot/surface-workspace.test.ts)；v50 仅有 0° 样本时，在 90° 得到 121 条红线，空视图粘贴同 ID 后恢复正常 | **预览路径已验证，源删除清理实现中**：红回退只能表示存活资产缺样本；源资产被删除后不得继续红显。错误 ID 黑红并存与混合覆盖已有自动化，完整源删除交互尚待验收 |
| 11 删除极值保留空洞 | `triangulation.ts` 的 `removeSnapshotVertex`；`angleGraph.ts` 的响应退役归档；快照删除命令 | 显式删除命令修改覆盖；普通加载只解析，不补点；共享事务承担 Undo | `triangulation`、`surface-command-api`、`automatic-snapshot-edits` 覆盖空洞、不自动连邻点、回读不再生和相关响应保留 | **已接入待验收**：验证 UI 删除、离开范围的逐线反馈、Undo／Redo 与保存重载；不能用重三角化补回用户删除的覆盖 |
| 12 镜像与自动占位属于普通编辑 | [automaticSnapshotEdits.ts](../../src/domain/recordingSnapshot/automaticSnapshotEdits.ts) 负责明确创建和继承更新；[snapshotMirror.ts](../../src/domain/recordingSnapshot/snapshotMirror.ts) 负责语义镜像 | 创建命令调用 `seedAutomaticExtremeSnapshots`；普通事务调用 `propagateAutomaticSnapshotLayers`；父输入求值执行镜像 | [snapshot-mirror](../../src/tests/recordingSnapshot/snapshot-mirror.test.ts)、`automatic-snapshot-edits`；v50 实际得到九点，基准拖动后 +90° 镜像 210 条输出路径，反射误差小于 0.001 像素 | **核心流程已验证**：重载后九点与镜像仍可见。局部覆盖、已有视图不覆写及删点不再生保留自动化证据，未据此扩称所有浏览器组合已验收；不新增第四套几何系统 |
| 13 父曲线拆分保留后代变形 | 当前只有 [drawing/commands.ts](../../src/domain/drawing/commands.ts) 的本地 `splitCurve` 和 [displayIntervals.ts](../../src/domain/drawing/displayIntervals.ts) 的本地区间拆分 | Drawing 本地拆分；来源同步会刷新成员，但不是跨快照谱系传播 | 现有本地曲线和区间测试仅能证明局部行为，尚无完整父子谱系验收证据 | **未完成**：需一次分配子 ID、记录共同参数 `t`、拆分后代已变形曲线，保留／重映射响应和材质区间；子快照单独拆分须明确警告对应中断 |
| 14 洋葱皮只是 Recorder 预览 | [surfaceOnion.ts](../../src/ui/vectorRecording/surfaceOnion.ts) 只选角度和组织帧，复用 `prepareSnapshotCoverage` → `createSnapshotSurfaceResponseSampler` → `interpolateSnapshotSimplexGeometry`；[SceneOnionSkin.tsx](../../src/ui/vectorRecording/SceneOnionSkin.tsx) 共用渲染 | [useSnapshotOnionFrames.ts](../../src/ui/vectorRecording/useSnapshotOnionFrames.ts) 按模式派发；新模式使用完整曲线中心线分支 | `surface-workspace` 逐角度比较主求值且检查无写入；v50 真实浏览器记录十帧完整曲线洋葱皮 | **采样与基本显示已验证**：5°／10° 步长、30°／60° 高亮和完整曲线仅为预览设置，不建快照、不改图层。隐藏／闭合曲线组合及性能测量待补；旧 endpoint 分支当前仍存在，不能宣称已经移除 |
| 15 安全迁移与明确退役范围 | [migration.ts](../../src/domain/recordingSnapshot/migration.ts) 保留原归档；`angleGraph.ts` 的 `createTriangulatedRecordingCopy` 创建副本并转换可表达的旧响应 | 显式复制迁移命令；当前仍保留旧模式分支；新模式禁止直接编辑保留的旧轨道 | `angle-graph` 覆盖键／草稿／ID 保留和不可表达时拒绝；[external-migration](../../src/tests/recordingSnapshot/external-migration.test.ts) 覆盖外部旧数据 | **部分且须按授权分开处理**：旧 v40 单调权重资产及旧 3D／Assembly／GPU 房间已获准退役，共享数学保留；旧 channel runtime 尚待决定。非线性细分未完成，不得静默烘焙或删除原件 |

## v50 真实浏览器证据

使用应用自带的完整对称正面画稿，包含 121 条曲线和 13 个图层。验证在云端浏览器执行，没有上传私人画稿。记录见 [v50 浏览器验证报告](../../artifacts/triangulated-recorder-qa/v50-browser-verification.json)，示例见 [+90° 实时镜像截图](../../artifacts/triangulated-recorder-qa/v50-live-mirror-90.png)。

- Drawing → Recording 实际跨模式引用粘贴保留 13 层及相同 ID；只有 0° 样本时，在 90° 显示 121 条红色回退路径。
- 创建的 −90° 真实视图最初为空，粘贴相同 ID 后正常显示；自动 +90° 镜像和指定俯仰列共同得到九个角度点。
- V 工具基准拖动使用屏幕位移 30／11 像素，再执行 Update。对 +90° 的 210 条输出三次曲线路径比较反射，最大控制点误差约 0.000972 像素，低于 SVG 三位小数显示精度的 0.001 像素界限。
- 在 −45° 用 V 工具整层拖动 5／2 像素并保存反解，顶点数仍为九个。保存撤销恢复草稿，拖动撤销恢复原 SVG；基准重做也恢复相同 SVG。
- 重载后仍有九个点且镜像可见；完整曲线洋葱皮记录十帧。临时测试录制已删除。

这组证据没有测量浏览器 FPS，也没有创作或验收新的侧面美术。重载会重置视口与选择覆盖层，因此没有断言重载前后全部 SVG 字符串完全相同。未匹配的镜像材质路径保留明确诊断。独立属性角度键、内部真实视图插入等剩余工作不由这次验证覆盖。

## 保留兼容与删除重复实现的边界

旧功能没有默认永久兼容义务。已经明确批准退役旧 v40 单调权重资产，以及旧 3D、Assembly、GPU 房间；当前功能共用的数学代码保留。这是范围授权，不表示删除实现已经完成。旧 channel runtime 的去留仍未明确决定，不能扩大上述许可。`evaluateRecordingSnapshot` 和 `useSnapshotOnionFrames` 中按模式隔离的 legacy／endpoint 分支目前仍存在；这是当前事实，不是永久保留要求。新三角化模式不能回落到这些分支偷偷解释同一份新数据，原始归档和草稿也不能随代码清理被静默删除。

Drawing 原稿与 working copy 仍通过 [drawingWorkingCopies.ts](../../src/app/drawingWorkingCopies.ts)、`sources.ts` 和共享事务适配。必须先接好合成视图的所有权写入，再移除同一功能的活动旁路。格式适配的支持范围、原件恢复方式和重复的新编辑规则，需要分别作出明确决定。

兼容处理需要分别记录已批准退役与尚待决定的项目。本文未核对用户原始档案，受影响记录及数量仍需补齐，不能推断为没有影响。

| 旧能力或数据情况 | 当前处理 | 实际用户档案影响 |
| --- | --- | --- |
| 旧 v40 单调权重资产及旧 3D／Assembly／GPU 房间 | 已批准退役；保留当前共用数学；尚未以本页宣称清理完成 | 逐项核对影响，原始归档不得静默删除 |
| 旧 channel runtime 及旧 keyed／legacy 转换 | 旧运行时去留尚待明确决定；无法证明等价的转换继续诊断 | 待检查实际使用与对应录制，不能将房间或 v40 资产退役许可扩展为全部旧通道获准移除 |
| 旧非线性端点响应需要在内部真实视图处分段 | 不把单条响应自动改解释为多条边；保真细分尚未完成 | 待列出实际响应、关键帧和草稿；不得默默丢弃或烘焙替代 |
| 已有响应约束的角度改绑 | 未指定约束随网格还是保持绝对角度时，明确拒绝 | 待检查实际是否需要此操作；无约束改绑已支持，不能混为全部改绑均不支持 |

## 结束验收前必须关闭的缺口

1. 完成正在接入的 Recording → Drawing 引用粘贴显示、命中和所有权写入，并验收源删除级联；源曲线删除保留空层，源图层删除清引用，子快照排除只作用于本地。
2. 接通 Recording 真实基准的完整拓扑编辑工具，并把现有 Drawing／Recording 重复的目标、关系和手势处理收敛到共享实现。
3. 完成父曲线拆分谱系，以及后代姿态、响应、材质区间和局部拆分警告。
4. 完成覆盖内部创建真实 60° 的正常姿态捕获与响应保真细分；红色投影不进入捕获。
5. 完成独立属性角度键及其 UI／保存接线，验证区间端点独立响应、精确零、0° 塌缩／30° 响应为零／90° 展开，且不增加几何顶点。
6. 按已批准范围清理旧资产与房间，保留共享数学；单独补齐旧 channel runtime 的影响清单与决定，不擅自扩大清理范围。
7. 对最终代码运行相关自动化，并补齐双向引用、源删除、拓扑、属性键、内部插点、迁移恢复等真实浏览器检查。v50 已通过的具体步骤保留为证据，不能替代新增功能验收。

第一个可运行候选只用于验证，不是全部原则完成的标志。每一项应当以实际调用链、保存后的数据及相应测试／交互证据关闭；发现仍在使用重复活动实现时，继续收敛后再验收。
