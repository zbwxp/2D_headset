# V0.3.1 — Editor UI Cleanup

## 操作

语义点与结构线为独立可折叠 section；中心线/左右对称点内部维持原分组及显式排序。折叠不清空 selection，底部始终显示选中对象。
结构线 section 内，当前曲线与 Plane slider 放在列表上方，参数区不滚动，只有列表滚动。保持原 PlaneControl 的旋转和历史事务代码。

单击选择；双击列表名字内联重命名；Enter 保存、Esc 取消、失焦提交有效修改。输入时全选基础名称，mirror pair 沿用既有 Rename；不变的名称不新增 history。Enter/Esc 后恢复行焦点，便于继续快捷键。
Ctrl/Cmd+C 只为 Landmark 打开复制面板。Delete/Backspace 按当前 active selection 类型分发至单一对象的删除确认，保留 pair/cascade 规则。列表右键提供次级 CRUD 入口；viewport 右键未改用途。

## 纯 UI state

`src/ui/session.ts` 独立保存折叠、面板位置、复制源 UUID、删除目标、内联编辑目标、右键菜单。
不进入 project JSON 或 geometry history。activeSelection 从有效 selectedCurveId 优先、否则 selectedId 统一解析，不根据列表焦点猜测。选中曲线时不会对残留的 Landmark ID 执行 Delete。
`store.ts` 的三个 Landmark CRUD 包装入口增加可选 sourceId，保证 non-modal panel 打开后目标绑定稳定；实际 domain CRUD 与几何函数未改。

## FloatingPanel

`src/ui/shared/FloatingPanel.tsx` 使用 portal + fixed 定位、共享标题拖动、pointer capture、关闭、会话位置保存、点击置顶。
resize 限制位置，内容高度受可用窗口高度限制并内部滚动；切 View 造成内容变化不会推动面板位置。
面板是 non-modal region，整体标记 UI keyboard context。pointer / wheel 不穿透；标题或空白内容点击将焦点留在 panel。

Duplicate 面板绑定打开时 source UUID；自动 focus/select 新名称；Enter 确认，Esc/取消关闭。可以切 View/选其他对象后回来确认，仍复制原 source。source 删除后禁止确认。关闭后恢复 workspace 焦点。
Reference 面板取消 viewId key 导致的重挂载，跟随 active View 数据，保留打开状态及位置；无图时显示空状态/载入入口。关闭仅隐藏 inspector。平移图片或删除图片后保留 inspector，不改变 transform 计算、锁/显示/透明度/缩放/偏移/旋转/替换/重置业务。

## 键盘隔离

全局几何快捷键仅在 .point-workspace 的键盘上下文执行。
排除 input、textarea、contenteditable、FloatingPanel、菜单、确认对话框；尊重 defaultPrevented/isComposing。
复制/重命名/删除只有提交时进入原 history；UI 开关、移动、折叠、选择、草稿和滚动不入 history。

## 修改文件

新增：
- src/ui/session.ts
- src/ui/EditorActions.tsx
- src/ui/shared/FloatingPanel.tsx
- src/ui/shared/InlineName.tsx
- tests/e2e/ui-cleanup.spec.ts
- docs/editor-ui-v031.md

修改：
- index.html；README.md
- src/app/App.tsx；store.ts；styles.css
- src/ui/curves/CurvePanel.tsx
- src/ui/edit2d/EditView.tsx；LandmarkList.tsx；ReferenceControls.tsx
- tests/e2e/centerline-order.spec.ts；curves.spec.ts；landmarks.spec.ts；management.spec.ts（适配新入口，保留既有几何断言）

删除：src/ui/edit2d/LandmarkActions.tsx（旧大按钮与模态重命名/复制入口，已由 EditorActions 和 InlineName 替代）。

## 验证与边界

- 62 项既有单元测试通过；构建通过。
- 完整 16 项浏览器回归通过；之后补充焦点恢复测试，定向 6 项（5 项 UI + 中心线排序）通过，合计覆盖 17 项浏览器用例。
- 重点覆盖：复制源绑定、面板拖动/resize、UI keyboard context、内联重命名/取消/失焦/无变更、pair/cascade 删除、折叠后删除对象、102 条曲线时参数固定、Reference 切视角不改 transform、原有对称/投影/历史/存档。
- 人工检查：读取 in-app 实际页面结构，并目视检查宽版参考图面板及 650px 窄版复制面板截图。未额外宣称完整独立手工几何回归；几何交互由 Playwright 原有用例覆盖。
- src/domain 全目录没有改动；Landmark/Curve geometry、View Lock、symmetry、persistence schema 未改；无 SmoothJunction/Surface/Patch/Mesh 新功能。
