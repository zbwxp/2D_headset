# V0.4.4 — Symmetric Pair Sidebar Consolidation

本轮只合并 Sidebar 表示，不合并任何 geometry object。ON_CURVE 延后到 V0.4.5，未实现。

## 行与左右

`ui/shared/pairRows.ts` 从 reciprocal mirror UUID 和 Point type / Curve endpoint type 推导行。RIGHT 为 primary、LEFT 为 mirror；canonical 可能在左侧，不能当成 RIGHT。无 partner / CENTERLINE / self-symmetric 对象保留单行。Landmark 使用已有 landmarkBaseName；Curve 复用原 Rename 的侧名前缀约定；不靠名字判断左右。

三个 Sidebar 标题计数均为“行”；底部真实点/线/面数仍是 geometry object 数。

`SymmetricPairListItem` 统一实现选择手势：未选 pair 选择 RIGHT；已选时 R/L 交替；viewport 仍使用真实 UUID，行读现有 selected ID 来高亮。无新增 activeSide 持久化状态。

单击等待 400ms，快速双击取消待执行单击并 Rename，保持当前 side。Enter/F2 Rename；空格选择；文本输入不传播这些快捷键。右键、拖动、选中对象变化和组件卸载清除未执行的点击。中心线拖动排序保留。

## Rename / Delete

Point/Curve 继续使用原 domain Rename/Delete。按用户追加授权，Patch 增加可选 `name?: string`：Rename 更新整对同一名称，去首尾空格，1–80 字符，进入既有 Undo。旧文件没有字段时保留自动编号；parsePatches 白名单读取可选名称，JSON Save/Load 保留。未修改 boundary、canonical、fullness 或任何几何字段。

Patch 行使用同一 InlineName；删除任一侧继续删除整对、保留 Node/Edge。底部状态显示 Patch 名称。

## 代码范围

新增共享行组件及 pairRows helper；迁移 LandmarkList、CurvePanel、PatchPanel，统一 InlineName 手势归属；App 更新版本与行计数。store/session/EditorActions 衔接授权的 Patch Rename。几何 evaluator、View Lock、symmetry、Smooth 和 Contour 算法没有修改。

## 验证

新增 grouping、真实项目 UUID 不变、Patch 名称 roundtrip 单测；新增浏览器 pair toggle、viewport 左侧选择、双击不切侧、Enter/F2、成对 Rename、Undo/Redo、Save/Load、Delete 测试。旧浏览器测试按真实成员 UUID 选择合并行，几何断言保留。

最终结果：125 项单元测试通过，build 通过。完整浏览器首轮 39/41 通过；旧左侧行名称选择器和 3D 透明面测试目标修正后，失败项复测全部通过，累计 41 项通过。3D 测试读取实际 Orbit 姿态并选取远离结构线的面内部点击位置，避免误点投影重叠的其他 Curve；未改应用 picking。
