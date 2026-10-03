# 编辑器统一实现验收矩阵

核对日期：2026 年 10 月 3 日 23:22 UTC。当前线上 v71（`cee081a`）于 22:50:09 UTC 部署。v70 的 Snapshot 编辑锁与镜像曲边独立复制、v71 的不同控制阶段共同编辑均已有下述真人证据。全框架任务仍在进行；尚未接入的工具、属性、成员移动与精确非线性分段，不因公共包装存在而算作完成。

当前真正开放的工程分为三组：

1. 非线性程序下的分段和后续拓扑：源分段须保原角度场、原材料位置与 live source；已有角度相关 q、响应、JSON、重复分段的生产回归，真实内部插点仍在最后接线。继承程序中的局部拓扑、分段家族部分成员删除／排除仍须同一 lineage 支持，不能以永久拒绝代替正常操作。
2. Drawing 编辑调用面：Recording 消费共同 palette、ellipse、mirror、bind/merge/unbind 控制器，以及原属性组件；候选已在隔离树测试，需通用 `before → target` 事务 helper 和镜像元信息接齐后发布。Drawing 已有属性在真实 Snapshot 保存局部覆盖，不能改源或显示空按钮。
3. 成员移动与排序：同一 Drawing 操作写局部 membership/order；引用中的移动为旧层排除＋目标层增加相同 canonical ID，保原始来源与 offset 属性。源码所有者移动使用原始资产规则。当前尚无完整通道，不能把临时 capability 禁用宣布为完成。

待决定项独立列出：中间修正角曲边域对未来成员的程序语义、跨模式 Undo 旧 guard、旧 channel runtime 退役。单点/柄反推的零差轴、互相矛盾的真实连接目标、非有限透视映射是数值或约束边界；它们不等于上述未完成的工程适配。独立中间 Boolean 属性样本未新增；当前明确完成的中间属性是连续区间端点，其他 appearance 在真实 Snapshot 编辑。
v68（`b04d5fa`）包含继承节点解绑、自有曲边域内 P/绑定、原生曲边独立副本及 Drawing/Recording 共用 cage controller/overlay。合并类型检查、生产构建与 42 项交叉测试通过。实际在真实 0° 眉层设置宽度 150%，拖曲边、切 A 拖柄 (+15, −12) 像素，最终控制点精确同移；Update/Undo/Redo 通过。域内 P 新线以局部成员和 postShape 保存，原稿不变，Undo 一笔恢复。

v68 同层复制曾使原对象的编辑 cubic 保持不变，但 derived material 再次应用 affine/cage。v69 在 `affineDrawing.ts` 从各组真正的变换前材料输入追加程序；offset-only 图层也保留其位移。41 项针对回归和构建通过，真实保存文件冷读重现由失败转为通过。v69 实际复测同一流程：新 ID 副本与原线完全重合；同视口 Undo/Redo 中原路径逐字不变；右移副本 1 像素只改变副本，Undo 恢复。实际 SaveJSON 显示副本为无语义父级的自有根，Drawing 来源全字段不变。7 笔正常 Undo 清理全部本轮准备，原 4 个录制与 5 份画稿保留。证据：[v68 报告与发现](../../artifacts/triangulated-recorder-qa/v68-browser-verification.json)、[v69 修复验收](../../artifacts/triangulated-recorder-qa/v69-browser-verification.json)、[保存数据核对](../../artifacts/triangulated-recorder-qa/v69-save-validation.json)。
v67 实际流程使用内置完整正面与侧稿：引用两面片 6 条曲线，曲边手柄与 A 编辑后保存；父源新增一条 P 曲线后引用成为 7 条。同一域 ID、固定 rest、bend、已有 postShape 全字段保持一致，新线没有自己的点响应；精确发布代码回读显示新线与同一域的控制点误差为 0，材料诊断为空。禁用/Undo 与 A Undo/Redo 恢复原路径。7 笔普通 Undo 清理本轮操作后，原 5 稿及先前稍侧工作副本保留，Undo 灰色。证据：[v67 操作报告](../../artifacts/triangulated-recorder-qa/v67-browser-verification.json)、[保存文件回读](../../artifacts/triangulated-recorder-qa/v67-domain-save-validation.json)。未上传私人归档，未测浏览器 FPS。

v70（`8d1ddbf`）真人验证：Drawing 锁左眉后引用到 Recording，A 显示 0 个可编辑柄；子快照局部解锁后显示 2 个柄，Update 计数仍为 0，返回 Drawing 父锁仍为 true。JSON 中是 Snapshot `objectLocks=false`，无 pose 草稿或轨。−90° 两眉曲边后，自动 +90° 镜像复制得到两个新 ID；两副本分别与原路径逐字重合，同视口 Undo/Redo 保原路径，副本为无父级 original 根＋纯 reflected program。9 笔录制 Undo＋1 笔 Drawing 源锁 Undo 清理本轮。证据：[v70 操作](../../artifacts/triangulated-recorder-qa/v70-browser-verification.json)、[保存核对](../../artifacts/triangulated-recorder-qa/v70-save-validation.json)。

v71（`cee081a`）真人验证：一条眉有 cage、一条普通，按曲线复选并用共同 V 中心拖 (+19,+6) 像素，两条曲线全部控制点精确同移；A 仅动普通线的一柄 (+12,−9)，其余三柄不变。Update/Undo/Redo、保存与 6 笔清理均通过；source Drawing 全字段不变，仍 3 个真实角度点，分别写 cage 后修正与普通 shape。共享 node/LINK/SMOOTH、可达零轴的覆盖来自针对自动化，未虚称为此轮真人覆盖。证据：[v71 操作](../../artifacts/triangulated-recorder-qa/v71-browser-verification.json)、[保存核对](../../artifacts/triangulated-recorder-qa/v71-save-validation.json)。

### 最新实现与证据

| 当前路径 | 唯一职责模块与消费者 | 已验证范围 | 当前剩余 |
| --- | --- | --- | --- |
| 整层 affine 与动态成员 | `layerDomainIntent.ts`、`layerDomain.ts` 由 `drawingSnapshotEdit.ts` / 共同事务 / 明确图层 API 消费；现有 affine material projection 保持派生笔触 | v62 实际宽度真 0、恢复／Undo、150%×50% 非等比、−100% 反射；源 P 新增后引用层 2→3，保存文件全部控制点与同一有序域最大误差 0 | v67 已接持久 H∘Coons 与后域 A/派生材料；父拟合结果的拆分 restriction 与部分继承程序拓扑仍在实现 |
| 新局部端点联动与贯通材料 | `endpointInteraction.ts`、`endpointRelationAuthoring.ts`、`routeMaterialSource.ts` 与 `DisplayRouteControls` 共同使用原 Drawing 几何及材料解析 | v61 重做 v60 实际失败路径成功；SMOOTH、ARC 10→15px、逐笔 Undo 到 SHARP 路径逐字相同；保存文件清理验证原稿数据保留 | 不把一次成功例子扩大成全部笔触／拓扑组合已验收 |
| 非线性 SMOOTH 拆分与真实插点 | `responseExpressionProjection.ts` / restriction / shared smooth kernel | v58 父拆分、v60 一般非线性内部插点有针对性自动化；v55/v57 保留各自限定浏览器证据 | v65 已统一 CURVE / unscoped / STROKE / route 材料 lineage；实际父耳线分段的 7 个 yaw 材料世界端点误差 1.14e−16。非线性域下的 fit 参数 restriction 仍属后续组合 |
| 局部移除与真正源删除 | response / material 依赖退役和 `sourceDeletion.ts` | v62 局部移除只停用失去支持的字段，其他曲线继续正常；恢复成员可恢复材料字段；真正源删除清相应属性目标，不产生红色幽灵 | 继续随新材料 lineage / 非线性域检查具体依赖，不设置全画面硬门槛 |
| Drawing 引用层通用作者入口 | `drawingSnapshotEdit.ts`、`drawingTopology.ts`、`relationAuthoringIntent.ts` | `144eb41` 已冻结：P 本地创建、来源／引用混合关系批次、API、一次 Undo 和来源隔离；独立 203 项及组合构建通过 | v63/v65 实际引用层 P 与真合笔通过；width/profile/inkEnds 使用局部 curveAppearance，v66 nodeAliases 支持两个继承端点真绑定。继承解除绑定已在下一候选 c9dd74b，通过 120 项相关测试；曲边程序组合仍有明确边界，lock 等局部能力仍需核对 |
| 独立当前形状复制 | `independentCopy.ts` 经现有 `cloneLayers` 和共同事务调用 | `e5b4273` 已冻结：新自有 ID、脱离旧父级、当前几何和颜色／填充／区间／ARC／偏移／层序检查，74 项通过、1 既有跳过 | v63 实际自动 +90° 镜像左眉复制：新 ID、同一视口 SVG 逐字相同、保存为无父级自有根；确实无法保持外观的异构 affine / 材料组合原子诊断 |
| 共享曲边数学 | `deformation/cageField.ts`、`cubicDeformation.ts`、`drawing/deformMaterial.ts` | `c071169` 抽出当前 Drawing H∘Coons 与单 cubic 拟合；20 个旧／新结果逐字段一致，185 项相关测试通过 | v67 持久层域已消费同一数学；下一候选 b04d5fa 将实际 Drawing/Recording cage controller、overlay、controls 归为一份，尚待发布后 Recording UI 验证 |

v62 浏览器证据：[操作报告](../../artifacts/triangulated-recorder-qa/v62-browser-verification.json)、[保存文件回读](../../artifacts/triangulated-recorder-qa/v62-domain-save-validation.json)。9 笔准备与编辑已正常 Undo 到底，原 5 稿和先前稍侧工作副本恢复。本轮实际使用数字变换控件，没有宣称重新拖过全部框柄；文件以精确发布模块本地回读，没有重新导入浏览器。未上传私人归档，未测浏览器 FPS，也未作美术审美验收。

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
| 6 非破坏引用与共用剪贴板 | [referenceClipboard.ts](../../src/domain/recordingSnapshot/referenceClipboard.ts) 负责地址和粘贴；[layerReferenceClipboard.ts](../../src/ui/drawing/layerReferenceClipboard.ts) 负责共享会话；`localMembership.ts` 负责本地排除 | Drawing 已接取引用；Recording 已接引用粘贴和独立复制；显式目标的纯粘贴函数能写入 Drawing 来源快照 | [drawing-layer-reference-clipboard](../../src/tests/drawing-layer-reference-clipboard.test.ts) 和 `local-membership-contract` 覆盖共享会话与身份；v50 实际完成 Drawing → Recording 的 13 层同 ID 引用粘贴 | **反向基础编辑已验证**：[snapshotPresentation.ts](../../src/ui/drawing/snapshotPresentation.ts) 和 `snapshotEditContext.ts` 已是 Drawing 活动入口。v53 已接 Drawing 完整显示、命中与按所有者写入；反向引用粘贴、数值平移、A 柄编辑和 Undo 实测通过。引用层新增／材质／连接等完整工具仍未全部接入；合成几何不回写为源原件 |
| 6 补充 源删除与局部排除 | 目标归口为规范源资产与依赖引用的统一级联清理；现有 `sources.ts`、`localMembership.ts` 区分来源与成员 | `sourceDeletion.ts` 由原始源同步事务调用；本地排除保持独立，Recording 不可冒充源所有者删除 | `recording-snapshot-source-deletion` 与 `source-visibility-inheritance`；v51/v53 源层删除、引用清理、Undo、重载及无红线残影实测通过 | **已验证**：源曲线删除清规范资产与依赖引用，保留空层；源图层删除清全部层引用；源删除后无幽灵红线；局部子快照排除仅影响本地，并按一次事务支持 Undo |
| 7 真实视图 修正帧 角度绑定分离 | [angleGraph.ts](../../src/domain/recordingSnapshot/angleGraph.ts) 保存顶点与响应；[commands.ts](../../src/domain/recordingSnapshot/commands.ts) 分流真实基准和修正 | `evaluateRecordingSnapshot`、绑定控件、修正保存／丢弃、创建空的范围外真实视图 | `surface-command-api` 和 `angle-graph` 覆盖改绑与草稿；v50 实际新建空 −90° 后粘贴，同一 −45° 反解／保存仍保持九个顶点 | **v57 完整脸插点已验证**：覆盖内真实视图采用引用和局部姿态，`responseExpressionTransactions.ts` 限制旧响应到新单形；材质由 `materialRestriction.ts` 保留原场。默认完整脸 −60° 插点、邻角、Undo/Redo 和真实 SaveJSON 回读通过。未保存修正草稿及任意非线性 SMOOTH 投影的精确保真插入仍需明确处理 |
| 7 补充 独立属性角度键 | `propertyResponses.ts` 与 `scalarResponseSupport.ts` 共享标量响应和端点目标；材质应用在 `simplexMaterial.ts` | 中间角度的 `changeInterval` 独立记录区间 start/end；不建真实视图、不改变几何响应 | `surface-property-responses` 与 v53 浏览器覆盖精确 0..30 平台、60 部分展开、重载及几何键数量不变 | **区间已验证，其他属性待扩展**：0° 区间 start=end，30° 展开响应保持 0，90° 再展开；起止端点独立响应，精确零长度而非 epsilon 或显隐开关；只建属性键，不建真实顶点、不烘焙几何 |
| 8 稳定二维网格与原始几何成员支持 | [triangulation.ts](../../src/domain/recordingSnapshot/triangulation.ts) 定位真实顶点、边和面；[simplexGeometry.ts](../../src/domain/recordingSnapshot/simplexGeometry.ts) 执行活动基准的成员交集 | 正常画面和逐曲线覆盖采样使用定位器与 simplex 几何；隐藏标记、修正权重不参与成员支持 | [triangulation](../../src/tests/recordingSnapshot/triangulation.test.ts)、[simplex-geometry](../../src/tests/recordingSnapshot/simplex-geometry.test.ts) 覆盖三点／两点／单点、极小非零权重、隐藏和有符号响应 | **已归口**：未被生产消费的 `resolveSnapshotSimplexPresence` 已于 9c57652 删除；有用合同用例迁到实际 `simplexGeometry` / coverage 运行时测试，36 项通过。未新增第二个求值器 |
| 9 共享边响应与按轴反解 | `surfaceTargets.ts` 统一编译响应与准备目标编辑；[triangularResponses.ts](../../src/domain/recordingSnapshot/triangularResponses.ts) 求最接近原始重心权重的解；`simplexGeometry.ts` 统一采样 | 主画面、反解重放和新洋葱皮共同消费；节点权威与 `H − P` 相对柄保持一致 | [triangular-responses](../../src/tests/recordingSnapshot/triangular-responses.test.ts) 和 `surface-targets` 覆盖连续性、退化诊断；v50 实际 −45° 整层反解后保存，Undo 恢复 SVG | **部分已验证**：节点／控制柄／变换已有代码与交互证据；其他目标工具仍须进同一链。退化目标和无法用控制响应表达的 ARC 参数变化继续明确拒绝，不新增隐藏几何键 |
| 10 逐曲线红色只读投影 | [snapshotCoverage.ts](../../src/domain/recordingSnapshot/snapshotCoverage.ts) 当前负责逐曲线覆盖投影；源存活判断随级联清理接入 | 主求值和 `surfaceOnion.ts` 共用；`SnapshotRecordingWorkspace` 将 `outsideCurves` 画成无指针事件的红色覆盖层 | [snapshot-coverage](../../src/tests/recordingSnapshot/snapshot-coverage.test.ts)、[surface-workspace](../../src/tests/recordingSnapshot/surface-workspace.test.ts)；v50 仅有 0° 样本时，在 90° 得到 121 条红线，空视图粘贴同 ID 后恢复正常 | **预览及源删除已验证**：红回退只能表示存活资产缺样本；源资产被删除后不得继续红显。错误 ID 黑红并存与混合覆盖已有自动化，完整源删除交互已在 v51/v53 验收 |
| 11 删除极值保留空洞 | `triangulation.ts` 的 `removeSnapshotVertex`；`angleGraph.ts` 的响应退役归档；快照删除命令 | 显式删除命令修改覆盖；普通加载只解析，不补点；共享事务承担 Undo | `triangulation`、`surface-command-api`、`automatic-snapshot-edits` 覆盖空洞、不自动连邻点、回读不再生和相关响应保留 | **已接入待验收**：验证 UI 删除、离开范围的逐线反馈、Undo／Redo 与保存重载；不能用重三角化补回用户删除的覆盖 |
| 12 镜像与自动占位属于普通编辑 | [automaticSnapshotEdits.ts](../../src/domain/recordingSnapshot/automaticSnapshotEdits.ts) 负责明确创建和继承更新；[snapshotMirror.ts](../../src/domain/recordingSnapshot/snapshotMirror.ts) 负责语义镜像 | 创建命令调用 `seedAutomaticExtremeSnapshots`；普通事务调用 `propagateAutomaticSnapshotLayers`；父输入求值执行镜像 | [snapshot-mirror](../../src/tests/recordingSnapshot/snapshot-mirror.test.ts)、`automatic-snapshot-edits`；v50 实际得到九点，基准拖动后 +90° 镜像 210 条输出路径，反射误差小于 0.001 像素 | **核心流程已验证**：重载后九点与镜像仍可见。局部覆盖、已有视图不覆写及删点不再生保留自动化证据，未据此扩称所有浏览器组合已验收；不新增第四套几何系统 |
| 13 父曲线拆分保留后代变形 | `drawing/layerEditIntent.ts` 一次分配身份并调用唯一 split 内核；`topologyEdits.ts` 冻结/重映射后代姿态；`responseExpressionSplit.ts` 保留 live basis 标量表达式 | Drawing 分割手势、shared store intent；Recording 真实快照分割走同一 local transaction；主画面及洋葱皮共用 value sampler | `drawing-layer-edit-intent`、`topology-edits`、`response-expression-split`、`response-expression-runtime` 和真实 store Undo；成对正/反向镜像、各端既有变形、材质、重复拆分、split→真实插点已自动化覆盖 | **v55 有界浏览器验证通过**：完整镜像脸的眉线 121→123 段、镜像 54→55 组，同步到各视角；Undo 恢复。精确保留受支持轨迹；局部分割明确新 ID/中断对应。一般非线性 SMOOTH 父拆分随后由 v58 的投影表达式组合覆盖；旧 live channel 拓扑转移及有依赖 fill/offset 的局部拆分仍有明确限制；不宣称所有原则完成 |
| 14 洋葱皮只是 Recorder 预览 | [surfaceOnion.ts](../../src/ui/vectorRecording/surfaceOnion.ts) 只选角度和组织帧，复用 `prepareSnapshotCoverage` → `createSnapshotSurfaceValueSampler` → `interpolateSnapshotSimplexGeometry`；[SceneOnionSkin.tsx](../../src/ui/vectorRecording/SceneOnionSkin.tsx) 共用渲染 | [useSnapshotOnionFrames.ts](../../src/ui/vectorRecording/useSnapshotOnionFrames.ts) 按模式派发；新模式使用完整曲线中心线分支 | `surface-workspace` 逐角度比较主求值且检查无写入；v50 真实浏览器记录十帧完整曲线洋葱皮 | **采样与基本显示已验证**：5°／10° 步长、30°／60° 高亮和完整曲线仅为预览设置，不建快照、不改图层。隐藏／闭合曲线组合及性能测量待补；旧 endpoint 分支当前仍存在，不能宣称已经移除 |
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

旧功能没有默认永久兼容义务。已经明确批准退役旧 v40 单调权重资产，以及旧 3D、Assembly、GPU 房间；当前功能共用的数学代码保留。该批准范围的活动房间和旧权重编辑入口已于 v54 清理；共享数学仍由当前工具消费。旧 channel runtime 的去留仍未明确决定，不能扩大上述许可。`evaluateRecordingSnapshot` 和 `useSnapshotOnionFrames` 中按模式隔离的 legacy／endpoint 分支目前仍存在；这是当前事实，不是永久保留要求。新三角化模式不能回落到这些分支偷偷解释同一份新数据，原始归档和草稿也不能随代码清理被静默删除。

Drawing 原稿与 working copy 仍通过 [drawingWorkingCopies.ts](../../src/app/drawingWorkingCopies.ts)、`sources.ts` 和共享事务适配。必须先接好合成视图的所有权写入，再移除同一功能的活动旁路。格式适配的支持范围、原件恢复方式和重复的新编辑规则，需要分别作出明确决定。

兼容处理需要分别记录已批准退役与尚待决定的项目。本文未核对用户原始档案，受影响记录及数量仍需补齐，不能推断为没有影响。

| 旧能力或数据情况 | 当前处理 | 实际用户档案影响 |
| --- | --- | --- |
| 旧 v40 单调权重资产及旧 3D／Assembly／GPU 房间 | v54 已清理批准的活动房间和旧权重编辑入口；保留当前共用数学 | 逐项核对影响，原始归档不得静默删除 |
| 旧 channel runtime 及旧 keyed／legacy 转换 | 旧运行时去留尚待明确决定；无法证明等价的转换继续诊断 | 待检查实际使用与对应录制，不能将房间或 v40 资产退役许可扩展为全部旧通道获准移除 |
| 旧非线性端点响应需要在内部真实视图处分段 | 不把单条响应自动改解释为多条边；保真细分尚未完成 | 待列出实际响应、关键帧和草稿；不得默默丢弃或烘焙替代 |
| 已有响应约束的角度改绑 | 未指定约束随网格还是保持绝对角度时，明确拒绝 | 待检查实际是否需要此操作；无约束改绑已支持，不能混为全部改绑均不支持 |

## 结束验收前必须关闭的缺口

当前剩余按实际调用链列出；v51～v67 的已验证阶段不再列为完全未做：

1. Recording 共用曲边框、own-domain P 与原生非镜像曲边独立副本已于 v68/v69 完成上述限定 UI 验证。继承解绑有针对性自动化；不把这些证据扩成全部笔触与拓扑组合已验证。
2. 父 source 拆分通过非线性拟合域时，须保留 `split(fit(parent))` 的参数 restriction、原材料 t 和后域修正。普通 source split、全路径区间与 Recorder 材质响应已在 v65 闭环；不能将那些结果扩称此非线性组合已完成。
3. 已携带父级非线性程序的 topology 身份变化、共享 P/alias 输入，仍有精确 guard；当前自有域的 P/绑定/本地 fork 已在下一候选支持。后续应复用同一 lineage 和目标适配，不再写第二套钢笔。
4. 镜像后的非线性程序尚缺可持久化的反射及端方向描述，独立副本仍原子拒绝该组合。普通镜像副本 v63 已实测；非镜像原生曲边副本在下一候选保留自己的材料输入、域与 postShape，不留下祖先快照。
5. 局部 objectLocks 正在接共同 Snapshot 编辑状态与 Drawing/Recording/API；沿用源有效锁，false 为明确局部解锁，层按钮仍批量当前成员，不增加 layer gate 或响应轨道。其他独立属性作者入口与混合来源/引用曲边目标应按具体调用链核对。已支持的 width/profile/inkEnds、区间起止响应、继承节点绑定和源删除不重复列为缺失。独立布尔属性作者 UI 没有新增；真实插点保持原离散显隐边界已于 v66 实测。
6. 不同程序 stage 的 A/V 目标分组正在接同一原子捕获/回放；中间修正角的曲边域是否对未来成员持续作用已询问，相关新持久字段暂未落地。不能用永久工具禁用代替真正可解的共同目标编辑。
7. 跨模式 Undo 的旧 guard 去留和旧 channel runtime 退役仍待明确决定；原始文档/working-copy 兼容入口尚存在。已批准旧权重与房间退役已完成。源文件与归档不得随清理被默默丢弃。

每一职责须有一个实际执行内核。当前 neutral SMOOTH component、shared cage controller、共同钢笔和 snapshot 事务已有明确消费者；不能由这些归口推断所有组合和所有历史工具都已完成。
后续历史段落保留版本来源；若与本节当前状态冲突，以本节为准。

## v53/v54 与下一候选边界

v53 浏览器已验证引用层在 Drawing 编辑只产生本地残差；原始源几何不变。源删除层同步清理 Recording 与自动镜像，不再产生该层红色回退。v54 在工具栏未固定时，删除和切换前保存的对话框仍可见且可正常完成；临时 QA 备份获得明确授权后已删除。

父拆分候选不是保存旧中间几何副本：表达式只引用存活基础快照的节点/相对柄标量，保留原响应支持域，反解在既有残差之上求新的局部响应。真实内部视图插入限制旧场，现有修正帧不会变成三角顶点。候选尚待独立构建与线上鼠标检查。

剩余工程入口仍需完成：完整 Recording 钢笔/新增/连接工具复用、局部拓扑的 paint 依赖新身份、一般非线性 SMOOTH 依赖组合、过程化整层域 intent、跨模式 Undo 的历史归属交互、未获明确退役决定的旧 channel 分支。不能把共同事务包装、按钮或当前单一成功样例等同于这些工作已经完成。


## v56 共同钢笔／真实快照拓扑

`ui/drawing/penController.ts` 是 Drawing 与 Recording 的共同落点、拖柄、继续接笔、闭合及预览控制器；两边调用同一 Drawing 创建/连接命令。`drawingTopology.ts` 只负责所有权、最终坐标逆映射和快照关系适配，`local-drawing-topology` 通过既有共同事务提交。它不是另一份钢笔几何实现。

候选支持真实角度快照上的空图层、P 新线/接笔、层复制/删除和本地成员删除；相同 LayerPanel 结构按钮通过显式 adapter 调用。新增线保持新的 canonical ID，缺父来源只发诊断；删除继承线成为局部排除，原稿不变。仅真实 Recorder 顶点可改拓扑，修正位置不默默创建几何。POSITION/SMOOTH/CUSP、平移/旋转/非等比 placement 下的目标坐标、闭合、Undo/Redo 和重载已有针对性测试。

依然未完成：一般非线性域的精确逆映射、合并两个不同继承节点的源拓扑变更、全部独立材质/连接属性工具、过程化整层编辑 intent，。默认完整稿的材质场内部插点随后在 v57 闭环。P 阶段不以禁止整个编辑器来掩盖具体不可表达操作，也不把这些诊断边界称作全部原则已完成。


v56 实际鼠标验证：空真实 0° 新层、P 拖柄、3 段连续闭合；整笔 Delete 清曲线但保空层；Undo 保留全部原 ID，重复 Redo/Undo 路径逐字相同。自动子快照删除继承笔画只产生局部排除，父快照仍为 3 段；子视图显示 3 条只读红回退，符合逐线覆盖规则。修正位置 P／新层禁用，真实顶点数未变。5 笔准备事务随后全部正常 Undo，原 5 稿不变。

## v57 材质场内部插点

`materialRestriction.ts` 把原材质支持域及属性响应保存在 Recorder 的 `materialRecipes`／`materialBasisRecipes`，每次先将 live real-basis 区间运输到当前最终曲线，再执行原有混合规律。真实 60° 插入不自动添加区间属性键；新真实快照以后明确修改区间时，以局部属性 delta 叠加。Snapshot 没有新增语义父级。该实现不进入完整曲线洋葱皮的采样路径。

完整 121 线／13 层默认脸的 −60° 插入已通过自动化，0/−15/−30/−45/−60/−75/−90 区间轨迹误差小于 1e−10。已有 property field、多次插点、三角/shared-edge、精确 0 长度 HIDE 平台、后续属性修改、source 更新/删除及 JSON 已覆盖。v57 已复跑 v55 实际命中的完整脸场景，具体浏览器证据如下。


### v57 真实浏览器闭环

使用内置完整正面 121 条曲线／13 层，同 ID 引用到 0° 与 −90°，对 −90° 作实际 V 拖动并 Update。插入真实 −60° 后顶点由 9 增至 10；−60° 的 99 条主画面命中路径逐字不变。对 −30°、−45°、−75° 分别记录，Undo 插点后再访问，三处各 99 条路径均逐字一致。Undo 恢复 9 点，Redo 恢复 10 点。

实际点击保存 JSON 并下载后，以精确 v57 生产 parser/evaluator 本地回读，保留 10 顶点、29 材质支持 recipe 和 1 个基础材质 recipe；6 个 yaw 角各 121 条曲线、0 个 SOURCE_MATERIAL 警告。这项是保存文件的生产代码回读，不是浏览器重新导入，也不是所有既有镜像材质诊断归零。7 笔临时准备事务随后正常 Undo，QA 录制消失，Undo 禁用，原 5 份画稿保留。

证据：[浏览器报告](../../artifacts/triangulated-recorder-qa/v57-browser-verification.json)、[保存回读报告](../../artifacts/triangulated-recorder-qa/v57-save-read-validation.json)。未上传私人画稿、未测浏览器 FPS。

### 当前待关闭的实际边界

- 一般非线性 SMOOTH 必须按原投影后 de Casteljau 的顺序组合，且后续反推保持同一约束；正在独立实现与回放验证
- 明确整层操作需保留过程参数，使未来加入该层的成员继续继承。第一批平移、旋转、正等比缩放正在接入；非等比、反射和弯边域还需同一职责的扩展
- 两模式应调用相同端点联动与笔触属性作者工具；真正跨层联动和合并节点身份必须分别明确
- Drawing 引用层的全部拓扑／材质能力、局部 paint 依赖身份转移及跨模式 Undo 交互仍有明确缺口
- 旧 channel runtime 的退役未获得清晰最终决定；已批准退役的旧权重／房间范围已完成，不重复作为待办


## v58 一般 SMOOTH 父拆分组合

`responseExpressionProjection.ts` 记录有界标量表达式及原稳定 driver／方向／长度尺度；`smoothComponent.ts` 为原投影提供唯一数学实现。父拆分按“原控制值求值 → 原 SMOOTH 投影 → de Casteljau”组合，不将拆后的子柄重新当成一套近似父约束。`surfaceTargets.ts` 对后续点／柄目标先反解该投影，再统一回放验证，任一不可表达轴整笔拒绝。

自动化覆盖一般非线性边／三角、saved/draft、重复拆分、live source 柄长度变更、子线端点和柄独立编辑、短 driver 原阈值、JSON 校验及后续修正。最终 Recorder 测试 371 通过、4 跳过；专门投影 21 项与 TypeScript 通过。v58 于 17:58:45 UTC 上线；该数学阶段没有另外重复整套浏览器父拆分操作，保留自动化与 v55 原路径证据各自边界。

本候选关闭的是父拆分与后续修正的非线性投影组合；任意非线性 SMOOTH 场的内部真实视图插入仍保留明确门槛，不能用 v57 的材质插点结果替代它。


## 共同端点作者工具与显式整层域候选

`endpointInteraction.ts` 由 Drawing 和 Recording 共同承担两次点击端点选择、实际 Drawing 命令和目标坐标；Recording 的“端点联动”保留两个来源节点身份，不能冒称合并节点。`endpointRelationAuthoring.ts`、`smoothHandleAuthoring.ts` 共同承担末端笔触修改及主动柄投影；旧 Scene 作者命令也复用同一函数。Recording 新关系卡片提供位置联动／解除、已有有效贯通路径的 SMOOTH／ARC 修改。Drawing 保留原属性卡片，因此这里只宣称交互和作者命令共享。

新创建的局部联动若其原始来源端点分离，贯通路径仍需要修正输入关系解析顺序；本候选在提交前验证路径存活并原子拒绝，不能提示保存成功却丢路径。该缺口未关闭前，Recording 不提供误导的贯通建立按钮。

`LayerDomainIntent` 明确保存整层目标和作者输入的平移／旋转／正等比参数。Drawing 明确选引用层时写本地 placement，未来新增成员继续继承，直接点或框选全体元素仍是稀疏元素编辑。原始自有层继续写源。现有 Warp、非等比／零轴 placement 和材质求值继续复用。非等比、反射、H∘Coons 的引用层过程域，及明确图层 API 的同入口接线仍待后续阶段，不能把现有几何工具存在等同于这些域参数已经保留。

层域相关 93 项、端点相关 146 项及 TypeScript 通过；新路径丢失原子拒绝另由 8 项端点集成测试覆盖。v59 精确构建及下述实际 UI 验证通过。


### v59 真实 UI 与保存数据

在空真实快照用 P 实际绘制两条不同层的曲线，选择第一个端点、切层、再点第二个端点，成功建立局部位置联动。两端屏幕坐标完全相同；解除联动不移动所选曲线，Undo 恢复关系且路径逐字相同。无有效贯通时 SMOOTH/ARC 明确禁用。已记录“选整层后关系卡消失”的入口摩擦，下一候选补充层成员选择展开。

Drawing 中确认粘贴出的引用鼻部层后，实际通过数字控件执行平移、20° 旋转和 120% 缩放；随后在来源鼻部层用 P 新增一条线，引用层从 2 条变为 3 条。真实保存 JSON 经精确 v59 生产模块回读，三个成员的全部控制点都等于同一 placement 的映射，最大误差 0；本地 shape 为空。此处验证了数字控件，不将其扩称为本轮已逐一鼠标拖过全部框柄。

两组准备分别 6 和 14 笔正常 Undo 到底，原 5 画稿 ID 与原先的“稍侧12 修改中”状态恢复。早先一次切换画稿后立即粘贴观察到旧选择状态，未将那组源编辑计作域成功；它们也全部撤销。报告为 `artifacts/triangulated-recorder-qa/v59-browser-verification.json` 和 `v59-domain-save-validation.json`。这不是私人档案浏览器测试、文件重新导入或浏览器 FPS 测量。

### 后续冻结候选

- `bc1c4be`：所有者解析实际实现移至 `app/drawingSnapshotEdit.ts`／`drawingSnapshotPresentation.ts`，UI 只保留薄导出；`prepareSnapshotEdit` 与明确 `transformLayers` API 共用 layer-domain intent。150 项与 TypeScript、精确构建通过
- `4a54cb7`：一般 SMOOTH 内部真实视图插入复用投影 DAG 和 sourceBaseline restriction；真实 60° 节点／柄编辑、45° 反推、再插 30°、邻角、JSON、Undo/Redo 通过。34 项针对性检查与此前 Recorder 377 通过／4 跳过；没有采样几何后备。待与 route 收口合并构建及发布
- 仍需完成新局部贯通的材料基准接入；全 affine／H∘Coons 程序域、其余共享属性／拓扑能力与跨模式 Undo 等未因此完成


## 局部新贯通路径材料与共享 UI 候选

`routeMaterialSource.ts` 标记 raw Snapshot 输入，按现有真实联动解析器形成瞬时材料基准。`commands.ts` 的数值区间、`drawingTopology.ts` 的作者目标、`endpointPairMaterial.ts` 的运输和 `materialRestriction.ts` 的插点 recipe 共同取该基准。最终已求值基准不被自动吸附／重投影；失败不回贴旧百分比。既有 Drawing route 求解和参数运输仍是唯一数学实现。

Recording 的关系卡现在直接消费同一个 `DisplayRouteControls`：可为新局部联动建立区间、贯通、解除和修改 SMOOTH／ARC。选中整层时展开成员找到关系卡。原始来源端点分离的新联动不再提前被当作坏 route 丢弃；后续 A 编辑仍按原 curve/t 材料位置运输。共同 2× placement 下修改 ARC trim 只逆映射一次。

545 项相关检查通过／4 跳过，最后失败材料映射拒绝策略下再验证 24/24；新增路径、内部插点、后续数值、保存 JSON、Undo/Redo 均有针对性覆盖。此候选尚待合并精确构建与真实浏览器；v59 的无贯通限制是旧版事实，不能混为本候选已验收。


## v63 通用引用编辑和当前形状独立复制

真实 Drawing 操作把完整正面嘴部取引用到侧稿，P 拖出一条本地新曲线；保存文件中它只出现在当前引用层的 `membership.addElementIds`，原五份画稿逐字段不变。随后使用“绑定端点”时，原 Drawing connect 会合并节点并统一 connected ink／整笔外观，当前局部外观数据尚未覆盖这部分变化，因此 guard 原子拒绝。画布却保留临时预览，切回选择才恢复，这是真实 UI 缺陷，不能把关系卡的短暂成功当成已保存。窄修 `2daf9fd` 统一清理失败预览并给引用层明确的“端点联动”入口；真正合笔的局部外观覆盖作为后续能力继续实现，而非永久禁止。

实际在九点测试录制的自动 +90° 镜像左眉上点击复制并粘贴，层数 13→14，副本 canonical ID 改变。在同一视口选择原件与副本，两条最终 Bézier 路径逐字相同。保存文件中的独立根全部为自有层、无 parent，原五份画稿逐字段不变。测试后先撤销副本，再共五笔 Undo 撤回该录制全部准备；前一引用 P 测试三笔 Undo 也已清理。窗口回 Drawing，Undo 禁用。

报告：[v63 浏览器验证](../../artifacts/triangulated-recorder-qa/v63-browser-verification.json)。本轮复制鼠标证据是一条镜像眉线，完整 ARC／fill／offset／material 组合仍依据各自自动化覆盖，不扩大为本次浏览器验收。没有私人上传、浏览器重新导入或 FPS 测量。


## v64 引用层位置联动与失败恢复

在同一 v63 复现场景，真合笔的外观 guard 仍然准确拒绝，但本次立即清掉临时预览，关系卡恢复“未绑定”，新线命中路径保持原值。随后从工具选项明确进入“端点联动”，实际两次点击建立关系；原嘴端点与新线端点保留不同节点 ID，屏幕坐标完全相同。保存 JSON 包含新的 Snapshot endpointLink，原五份源画稿逐字段不变。Undo 移除关系并恢复原新线，Redo 所选路径逐字恢复。四笔正常 Undo 清完测试准备，Undo 禁用。

记录：[v64 实际浏览器报告](../../artifacts/triangulated-recorder-qa/v64-browser-verification.json)。此处位置联动保各自外观；真合笔的普通 Drawing 行为仍应通过局部外观覆盖继续完成，不能把 guard 当成永久功能限制。当前局部 width/profile/inkEnds 实现与持久 Coons、通用路径材料父拆分并行，尚未作为线上完成项。


## v65 材料父拆分和局部笔触外观

`curveAppearance.ts` 保存按曲线、末端及字段稀疏的局部外观覆盖；缺省继续读来源，null 明确清除该可选字段。普通 Drawing 真合笔的 connected ink／笔画名修改不再写回被引用原稿。v65 实際引用嘴线与本地 P 新线合笔后，保存文件显示同一 canonical node 和本地 curveAppearance；原五份画稿逐字段不变，Undo／Redo 路径复原。

`pathMaterialSupport.ts`／`materialPathLineages.ts` 记录 live 曲线 ID 与 native t，Recorder 先求原材料响应再映射拆分后的路径。CURVE、未指定 scope、STROKE、反向、闭合和显式 route 走共同路径框架。默认完整脸 11 条及私人档案内存副本 9 条 source split 本地对照通过，原件 hash 未变。实际 UI 在独立完整脸来源先设置 −90° 区间终点，再于 −30° 保存区间响应，成对分割父耳线后 121→123 段；9 顶点和 propertyResponses 均保持，7 个 yaw 角的材料世界端点最大误差 1.14e−16。

最初在原完整稿上的分割被既有旧 Warp 轨迹依赖原子拒绝，未删除旧轨或假称它已支持；该准备撤回后才使用普通“保存为新画稿”建立独立 QA 来源。两次邻近颅顶误命中均撤销且排除在证据外，放大后由子 cubic 和保存 lineage 确认正确耳线。测试结束 4／8／10 笔 Undo 分别清除真合笔、旧依赖失败准备、独立来源和录制，五份原稿与既有工作副本恢复。

报告：[v65 UI](../../artifacts/triangulated-recorder-qa/v65-browser-verification.json)、[材料保存回读](../../artifacts/triangulated-recorder-qa/v65-material-save-validation.json)。显示百分比由 80 变为 80.000079 是分段后路径弧长归一化的坐标差，材料世界位置没有漂移。

## v66 单一关系组件、继承节点与可见性插点

`endpointRelations/smoothComponent.ts` 为 Drawing、目标变换与 Recorder 提供唯一带方向的关系遍历；作者和运行时保留各自明确投影策略，未改变原投影数值顺序。真实 Drawing 中关闭镜像，把跨层下颌贯通设为 SMOOTH，再拖一侧控制柄；另一层柄同步变化，统一 Snapshot presentation 回读的叉积为 0、方向相反，从柄长度完全保持。旧 raw Drawing 兼容字段不是局部关系覆盖后的最终画面，验证取实际 presentation。

`nodeAliases.ts` 在当前 Snapshot 输入解析成员后建立局部共享节点权威，source canonical library 不变。真实引用嘴层两继承端点绑定后节点 3→2，闭合笔画保存为 canonical alias；Undo 回 3 节点、Redo 路径逐字相同。解除继承绑定的反向拓扑操作仍在实现，不以 POSITION link 代替真合笔。

`visibilityRestriction.ts` 保留原几何支持域的离散选择器，与材料和几何共用 `simplexSupport.ts`。插入真实 −60° 不产生布尔 authored key，也不将原 −45° 切换搬到新边中点。实际两条嘴线中一条在 −90° 隐藏，插点前后 −30／−44.999 各两条，−45／−45.001／−60 各一条，五处输出路径逐字一致；Undo／Redo 顶点 10→9→10。私人112本地回归的 73 个可见性差异、2010项flag比较、重复插点和 split→insert→interval-edit 全链已通过，未上传该文件。

报告：[v66 UI](../../artifacts/triangulated-recorder-qa/v66-browser-verification.json)、[跨层平滑回读](../../artifacts/triangulated-recorder-qa/v66-smooth-save-validation.json)。三组实际操作分别 3／3／7 笔正常 Undo 清理，窗口回 Drawing，Undo 禁用。API 与 Drawing 同目标相等有专门自动化；本轮鼠标执行的是 Drawing A。没有浏览器 FPS、私人档案浏览器验收或完整转头美术验收。

### 21:13 未关闭清单

- 有序 H∘Coons 域的完整持久、ARC/material provenance、后域 A、UI/API/save 实现正在最后冻结；Recording 尚无共用 quad/cage 作者工具栏入口，不能把 API 已能存算成录制 UI 已能操作
- 后域 alias／bind、父 split 的 fit 参数 restriction、独立当前形状复制和局部 P 的共同作者目标适配仍需组合闭环。新父/source线默认无自身 delta；child 主动 P 创建的明确局部目标可以拥有本地 postShape，不能误扩大“零 delta”限制
- 继承解绑的局部新节点身份、部分锁定／外观属性工具和实际能力提示需要继续完成
- 测试专用 `resolveSnapshotSimplexPresence` 已移除，三条缺失合同改测实际 runtime；此清理 `9c57652` 与文案 `a7f9c8c` 尚未部署，不改变采样规则
- 中间角独立布尔作者样本的切换语义尚未新增；当前已明确要求的连续区间端点与真实插点离散继承分别有实现，不悄悄增加布尔 UI
- 跨模式全局 Undo 的守卫去除等待用户对明确问题的答复；旧 channel runtime 的退役仍未获得清楚决定。原归档不随任何清理被删除
