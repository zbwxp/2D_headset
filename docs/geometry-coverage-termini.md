# 几何端点、显示区间与可见末端

三者不共用一个 Endpoint 对象或编辑行为。

- GeometryEndpoint / GeometryEndpointLink：真实 Bézier 的端点、node/handle 与位置联动。几何端点可能位于笔画内部，也可能被隐藏，不等于可见末端。
- DisplayIntervalBoundary / StrokeDisplayIntervals：显示路径上的覆盖范围与弧长边界。区间裁切不创建 node，不具有移动源几何端点的行为。
- ResolvedVisibleTerminus：墨线派生后的只读渲染结果，包含可见位置、方向和末端笔触，不是可移动源节点。

只共享末端笔触：TerminusBrushStyle / TerminusBrushPair，以及 TerminusJoinBrush 的锐角、平滑、ARC 外观。定位、编辑、联动拓扑和显示路径仍然各自负责。renderTerminusBrush 已供原有 inkTips 使用；geometryJoinBrush 仅把既有几何接笔样式映射到渲染样式，不重写原有 ARC/fill 几何。

旧 Endpoint、EndpointLink、InkEndStyle、InkEnds TypeScript 名称保留为明确的兼容别名，旧 JSON 字段和存档不改写。ARC 的 trimDistance 对应原 radius 字段的两侧影响/裁切距离，并非固定圆半径。

有效笔触抑制与 authored 数据分离：effectiveTerminusBrush 在连接状态返回等宽、零延伸的有效样式，原有 authored 样式不变。旧 clearConnectedInk 的历史行为尚未借此自动迁移或恢复；新的显示路径/联动应用必须显式使用有效样式，不可覆盖作者的数据。
