# 共同手势事务

`ui/drawing/gestureTransaction.ts` 统一控制目标的预览与提交资格，以及键盘历史事件的消费策略。Drawing 和 Recording 保留各自的存储适配，使用同一组生命周期函数。

- 每次预览先撤下上一目标的提交资格；只有目标生成和预览验证都成功才重新登记
- 拒绝或异常同时清掉显示预览与候选，不能回到起点显示后在松手时提交旧目标
- `takeGestureTarget` 先消费再调用写入适配，重复松手或适配失败不能重交同一候选
- 取消清掉候选；原有目标／历史身份检查仍负责切换视图和工程版本失效
- Drawing 的指针几何预览及 held-arrow、Recording 的 A/V 指针、native 轴／角点、held-arrow 及 cage 使用相同策略
- Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl/Cmd+Y 共用识别与一次消费。活动手势先取消；没有活动手势时交给全局 Undo/Redo。未落笔的第一个 Pen 锚点保持原有局部撤销语义
- App 的兜底监听忽略已经消费的事件和编辑输入，不会再撤销第二次。历史跳转继续由全局 store 恢复模式／视角／相机，不把跳转写成新历史

这里不改变反推、零基准、节点／柄权重或域几何算法。Pen 的成笔事务与现有 cage 意图生成继续由原控制器负责，不把一次失败转化为新的几何关键帧。

验证：8 个相关文件共 110 项通过，包含真实三点反推不可解目标、全局 store 历史，以及实际 SceneWarpCanvas 回调的合法→拒绝／异常→松手或抬键。中断、导航、历史和工具切换原有回归保留。两个旧组件测试夹具补齐已存在的 workspaceView store 模拟；原有 controlPlan 断言更新为检查其真实冻结起点与节点意图，未改变生产数学以迎合断言。该测试结果不是完整浏览器输入覆盖。

后续合并补齐 V 的 bool 预览反馈，拒绝必须从命令适配一路返回 Canvas；delta、absolute-value 与临时反推框不再吞掉 false。快平移仍只合并 DOM transform，不新增每次指针 React setState。实际 Canvas 回归覆盖 move／corner／axis／nudge 的合法→拒绝或异常→释放。

最终组合：25 个相关文件、352 项在同一次运行全部通过（含启用本地输入的最小改动回归）。这是针对本轮共享交互与域的聚合，不是全仓库全绿。旧 singular-input 文案断言更新为检查实际明确拒绝原因，并追加工程不变断言；轴框测试补齐当前 SnapshotEvaluation 的 state，未改生产行为迁就夹具。

实际界面后发现父组件选线会同步更新 Pen 目标图层，原 Pen effect 无条件取消所有手势，导致 A/V 第一次拖动只选中、第二次才移动。修正只让 Pen 手势消费 Pen 目标变更；真实视角／历史身份的完整取消栅栏保留。新增回归模拟父级 Pen targetKey 变化，分别验证 A/V 首拖继续、实际 view targetKey 改变仍取消，避免仅测固定 Canvas props。
