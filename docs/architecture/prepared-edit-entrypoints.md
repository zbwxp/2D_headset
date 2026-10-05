# 编辑入口与事务边界

本表约束当前 Drawing 与三角录制的编辑入口。共用数学函数不足以保证流程一致：同一份已经接受的目标，必须携带真实事务结果直到提交。旧房间、已退休录制模式和未开放的反推拓扑不在此表内。

## 执行顺序由代码约束

1. `drawing/controlEditPlan.ts` 从冻结 Drawing 和真实选择编译控制及依赖范围。点、柄、曲线、层和连续线组仍保留自己的语义范围。
2. `app/snapshotEditTransaction.ts` 冻结原项目，检查所有权，执行对应作者策略，给结果签发运行期凭证。凭证记录准确的原项目、结果项目和取消 revision；JSON、复制字段或调用方布尔量不能伪造凭证。
3. `recordingSnapshot/evaluation.ts` 的原上下文接收完成后的候选。受控几何沿用可证明的 dirty controls；来源、placement、材料、拓扑和复杂域仍使用同一个权威求值器，不伪造稀疏证明。
4. `app/preparedEditPreview.ts` 只匹配请求并保留真实计划，不授予写权限。正常松手前隐藏预览可以保留计划；拒绝预览清除它。Esc、切换对象、历史变化和取消令活动计划失效。
5. `finalizePreparedSnapshotEdit` 最多完成一次尚未执行的完整解析；不会再执行作者操作、反推或源同步。Store 再检查准确原项目和 revision，随后只写一笔历史。

普通原稿、引用层局部状态、持久域、真实录制基点和中间反推是写入策略差异。它们不共享错误的所有权，也不需要第二个手势执行器。

## 入口清单

| 入口 | 目标/范围 | 候选与提交 |
| --- | --- | --- |
| Drawing A 点、柄、本体；V 笔画、复选 | 共同控制计划；关系扩展保留隐藏语义成员和锁定约束 | Drawing 所有权适配 → 共同 capture → 已接受计划 |
| Recording A/V，真实基点 | 同一 Drawing 目标；显式 placement 采用现有 placement 策略 | 同一事务；控制/placement 候选从冻结上下文求值 |
| Recording A/V，反推帧 | 同一目标，反推策略保留严格 0° 和校准约束 | 已接受响应/基点联合候选，松手不重算目标或反推 |
| 单线/连续线组、整层/复选层的四角与曲边域 | 同一个域成员计划及数学；范围按关系/归属，不按矩形命中 | 来源写源几何；引用基点保存当前域；中间框只产出临时目标 |
| Arrow 连按、数值点/柄/长度、数值变换 | 共用控制生产者；连按冻结起点、累积目标值 | 最后一个键释放提交一次；拒绝不退回旧合法目标 |
| Pen、ellipse | 共用拓扑生产者；Pen 保留同一候选及生成 ID | 完整拓扑检查仍执行，预览目标和松手提交一致 |
| ARC/区间/笔触、锁定、顺序、外观 | 现有类型化属性/关系作者 | 预览保留计划；滑块取消不提交；离散动作直接进入同一事务 |
| split、bind/link/unbind、mirror、创建/删除/复制/粘贴 | 稳定 ID、分段映射、关系/来源策略 | 完整身份/拓扑检查；已准备的按钮结果不再二次包装提交 |
| Snapshot JSON/native 命令 | 一个 `prepareSnapshotCommands` 构建循环 | 完成的不可变命令结果；外部请求校验保留；共同凭证提交 |
| Drawing JSON/source 命令 | 同一 Drawing 数学与所有权策略；批量镜像保留累积写入规则 | 来源批次在必要边界同步；局部输出仅在完整证明成立时保留控制 provenance |
| Save/Discard、Undo/Redo | 原有快照/响应与历史语义 | Save/Discard 采用同一候选上下文；历史恢复使旧候选失效 |

## 明确保留的完整工作

- 外部 JSON 请求必须做格式与边界校验；原稿的 `parseDrawing`、工作副本标准化在源同步之前执行。不能在源已经传播后才改变其标准化语义。
- 结构、材料或复杂域没有完整稀疏证明时，使用共同完整权威求值。域编辑仍影响其全部实际成员，新来源成员按动态归属参与。
- 不可变数组容器可以复制；这不等于对其中每条无关曲线重新做数值运算。测试分别统计数组槽位、实际控制写入、拟合和采样。
- 完整验证与源传播不被“native”标记免除。API 的批量镜像保护规则也不为获取一个稀疏标签而改变。

## 结构性回归

`prepared-snapshot-edit-lifecycle.test.ts` 检查伪造、字段篡改、原项目突变、取消、相同历史对象被 Undo/Redo 恢复、单次标准化与单次历史；`prepared-edit-preview.test.ts` 检查准确请求身份及一次消费。

`command-candidate-lifecycle.test.ts`、`drawing-snapshot-control-capture.test.ts` 将无关曲线扩到 0/100/1000，分别验证基点、响应、最小改变回退和没有 Recorder 的 Drawing。未知域回退不是这个计数断言的豁免漏洞，而有自己的权威冷热等价检查。

`shared-canvas-selection-gestures.test.ts` 执行实际组件处理器与父级预览更新，验证接受候选在松手时不再次作者求值/反推；`drawing-pen-controller.test.ts`、`recording-pen-canvas.test.ts`、`recording-drawing-tools.test.ts` 检查稳定新 ID、合法→失败→松手、取消/切换与重复释放。`numeric-slider-gesture.test.ts` 检查标量预览取消及历史事件消费。

这些是自动化组件/域检查。发布后的浏览器操作、同环境 CPU 对照和全量工作负载回退必须单独记录，不能由测试数量替代。
