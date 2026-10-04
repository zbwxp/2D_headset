# 曲线编辑与变形器的效率原则

快照组织图层，图层容纳曲线。几何计算的最小单位是曲线及其控制点；容器变化本身不意味着整幅画都要重新求值。

## 一次选择，一份作用计划

1. **选择确定直接作用范围。** A 的点／柄、V 的笔画、复选图层、连续线组和整层变形器都先给出明确的对象身份。手势开始时固定输入、范围和关系依赖；后续鼠标位置只改变目标值。拓扑、绑定或域范围改变时重新准备计划。
2. **真正的依赖决定扩展范围。** 共享节点、LINK、SMOOTH、镜像编辑、连续材料路径和域可以影响未直接选中的控制点。使用反向索引找到它们；既不省略必须联动的对象，也不把所有无关曲线加入可写集合。ARC 的相邻线可能只是只读校验依赖。
3. **线组框与图层框只在成员范围上不同。** 两者使用同一四角投影、曲边数学、手势控制器和域求值。图层框读取当前层成员；连续线组框按节点／接笔拓扑扩展。新线只有进入相应范围才受影响，不能靠屏幕上是否落入矩形来判断。

对应入口：`drawing/controlEditPlan.ts`、`ui/drawing/cageEditorController.ts`、`drawing/layerDomainIntent.ts`、`recordingSnapshot/layerCageScope.ts`。

## 一套数学，按需产生结果

4. **复用计算内核，不复制工具算法。** Drawing 工具产生目标；Snapshot 事务处理所有权和关系；Recorder 决定保存基准属性还是反推响应。真实基点保留当前域状态，中间角的临时框只产生目标后反推，不新增真实快照或永久框记录。
5. **结构准备与坐标变化分开。** 成员、拓扑、支持域和依赖编译可以复用。坐标更新只使有实际依赖的数值结果失效。来源增删、分段、绑定和域成员变化会重新计算对应结构，不能套用旧选区证明。
6. **一个求值上下文服务所有消费者。** 主画面、反推回放、洋葱、镜像和材料共用 `PreparedRecordingContext`。共同 simplex 内核分别产出最终控制、材料和绘制数据；完整曲线洋葱不计算终端裁切、墨线或 paint。产生域几何所必需的材料计算仍需执行。

对应入口：`app/snapshotDrawingToolEdit.ts`、`app/snapshotEditTransaction.ts`、`app/recordingTemporaryCageEdit.ts`、`recordingSnapshot/evaluation.ts`、`simplexGeometry.ts`、`surfaceMaterial.ts`、`surfaceOnion.ts`。这些 `recordingSnapshot` 文件均位于 `src/domain/recordingSnapshot/`。

## 可以证明的复用才有效

7. **复用依据实际事务和依赖身份。** 内部不可变事务记录变过的 basis／响应控制地址，几何产品记录实际 dirty curves，再反查材料消费者。外部导入、未知域／表达式、缺失证明或关系条件变化回到同一个完整内核；不通过猜测跳过几何或校验。
8. **预览和提交保持同一结果。** 每次目标从冻结手势起点求解，上一帧不成为新的基准。严格 0° 不变、受保护校准、原子失败和一次 Undo 都是正确性条件。保存前的权威验证不能被漂亮但不一致的预览替代。
9. **测实际工作量和完整链路。** 计数包括真正执行的控制、关系、basis 和材料路径；同时报告剩余容器拷贝和完整阶段。新目标要与冷求值及旧正确结果比较。CPU 时间、浏览器输入到显示、FPS 是不同指标，不能互相替代。

对应入口：`preparedControlChanges.ts`、`preparedSurfaceMaterial.ts`、`surfaceBasisFallback.ts`、`workspaceChanges.ts`；外部导入继续使用生产 parser 和完整验证。

## 当前验收与边界

| 需要保证的行为 | 自动化依据 |
| --- | --- |
| 一点／一柄与 LINK、SMOOTH、镜像依赖；无关曲线不增数值工作 | `drawing-control-edit-plan.test.ts`、`dirty-control-sampling.test.ts` |
| ARC 只读相邻线保留原校验，可写集合不扩大 | `drawing-control-edit-plan.test.ts` |
| 原生曲线修改只运输真正依赖的材料路径 | `prepared-surface-material.test.ts` |
| affine、四角、曲边、连续组、新成员与 fitted 材料保持正确 | `layer-affine-domains.test.ts`、`layer-cage-evaluation.test.ts`、`layer-cage-runtime.test.ts`、`topological-cage-scope.test.ts` |
| 真实域与临时修正框使用共同作者数学，存储语义各自准确 | `recording-cage-control-target.test.ts`、`temporary-cage-edit.test.ts`、`shared-cage-editor.test.ts` |
| 线组／整层 × 仿射／四角／曲边 × 基点／修正角，同入口范围与拟合计数 | `deformer-scope-parity.test.ts`（16 项） |
| 冷热一致、取消、Save／Discard／Undo、严格零基准 | `prepared-recording-policy.test.ts`、`prepared-recording-invalidation.test.ts`、`minchange-inverse-workflow.test.ts`、`global-history.test.ts` |

专项 16 项在主树通过：12 格组合、同 operation ID 的 scope 改绑、连接／未连接的新来源成员。实际 cubic fit 计数分别为线组 3 条、改绑后 1 条、加入连接延续后 4 条、整层 6 条；不是只比较最终截图。

公开站 v87、v88 均完成真实鼠标验收：修正角 A／V 后保存和 Undo；同一个 12 曲线眼睑层中，单折痕框保存 continuous-strokes 范围，整层框不带 strokeScope，拖边柄产生曲边参数变化。v88 还检查未保存 A 草稿切到两个基点再返回并继续第二次编辑。来源和九个真实视图保留，最后全项目导出与新鲜基线完全一致。

当前曲线级控制和材料更新已有有界计数证明；复杂域仍使用共同 canonical 路径，不宣称所有域操作已按单条曲线增量化。整层域参数改变时整层成员都受影响，本来就不能只算选中的一段。

变化 basis 的完整求值、不可变容器拷贝、正侧完整材料／绘制仍是已测剩余成本。详细同任务数字及回退见 [统一求值报告](prepared-recording-evaluation.md)。没有引入第二套 GPU 反推算法，也没有把本阶段结果宣称为性能极限。

基点阶段也遵守相同规则：原生 shape、材料消费者、fit 诊断和身份映射现已支持可信修订。saved/live 政策不共用同一状态槽；外部防御性解析不因内部加速而省略。后续 GPU 是否值得加入，以 CPU 整理后的整体实测收益决定；如采用，继续消费同一作用计划和产品，保留 CPU 回退，不为 A/V／各类框各造一套后端。
