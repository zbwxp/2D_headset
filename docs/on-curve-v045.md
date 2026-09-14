# V0.4.5 — 结构线定位点

使用：选中结构线，在 Inspector 点击「添加结构线定位点」。自动选择同侧新点；点 Inspector 的「在线位置」按弧长百分比调整。左右点仍合并为一行，切换左右只改变操作入口。2D 可以点击选中定位点，不能空间拖动或用方向键移动；Slider 可用方向键、Alt 精调、Shift 粗调、长按加速。

## 数据与迁移

```ts
type PointPlacement =
  | { kind: 'WORLD'; position: Vec3 }
  | { kind: 'ON_CURVE'; role: 'canonical'; hostCurveId: string; s: number }
  | { kind: 'ON_CURVE'; role: 'mirror'; hostCurveId: string; canonicalPointId: string };
```

原 Landmark 的 id、name、type、mirrorPartnerId、viewLocks 保留。type 仍表达 CENTERLINE / LEFT / RIGHT / FREE 分类。旧 position 原值迁入 WORLD；当前保存版本为 landmarks-0.4.5。原 Curve、Patch、Fullness、Smooth、参考图及锁锚点保留。旧文件不被覆盖；浏览器自动存档加载成功后保存迁移后的格式。

加载先解析实体与旧 placement，再校验 UUID、镜像和宿主引用，建立有向依赖图并检查循环，最后求值并验证 Curve Plane。只保存 placement source，不保存派生 XYZ、t、LUT 或缓存。CENTERLINE 的 ON_CURVE 点单独列出，不加入 centerlineOrder，不改变黄色 guide。

## 统一求值

`GeometryEvaluationContext(project)` 提供 `pointPosition(id)` 与 `curveControls(id)`，包含点、控制点、弧长表缓存和递归 guard。`pointPosition(project,id,context?)`、原 `controls(project,curve,context?)` 是便利入口。Context 绑定一个 source snapshot，不能跨编辑复用。

普通点直接读取 WORLD position；定位点求 Planar Source Curve 控制点，再反算弧长参数。Curve endpoint 仍仅引用 Landmark UUID。Curve 创建/加载、View Lock、2D/3D、guide、缩略图、App 坐标显示已切换 evaluator。没有 active domain/render 路径继续读取 `landmark.position`。WORLD position 的直接访问仅在 schema 解析/迁移、evaluator 本身及明确的 WORLD duplicate anchor 初始化中。

沿用 512 段累计 chord-length LUT，二分查找并局部插值，提供 `normalizedArcLengthToT(lut,s)` 和 `tToNormalizedArcLength(lut,t)`。处理端点、clamp 和重复累计长度；零长度明确拒绝。精度是有限采样的弧长近似，不是解析积分。Host 改形后的新 Context 不复用旧 LUT；同 Context 同 host 只生成一次。

镜像 Point 的 ownership 跟随宿主 Curve，canonical 不强制为右侧。仅一份 s；另一侧最终 XYZ 严格镜像 canonical XYZ，保留实际 mirror host ID 供未来拓扑使用。真正矢状面宿主只创建一个 CENTERLINE 定位点。

## 依赖与编辑

`dependencyGraph` 显式维护 Point/Curve dependencies，按稳定 key 顺序 DFS，输出 dependency-first 顺序；缺失引用和 cycle 拒绝。创建 Curve、加载、placement validation 以及传播均校验；evaluator guard 是损坏数据的最后防线。

`followEndpoints(old,next)` 按拓扑顺序处理 canonical Curve，复用原 shortest-arc/minimal-rotation transport；along/offset 不变，中线曲线法线仍固定。处理 s、宿主 handle/plane、上游 WORLD point 的变化，支持多层 Curve → Point → Curve。Store 的一次编辑使用 edit-start snapshot 重求下游平面，避免重复中间 transport 的累积漂移。自动测试验证相同开始状态与相同最终 s，经不同中间更新路径后几何完全相同。

ON_CURVE 不建立 View Lock anchor，不调用空间拖动，不切换 driver；WORLD 的投影、零空间和镜像约束公式不变。不可求值的编辑保留此前有效状态并提示错误。

## 管理与缓存

Rename 沿用整对规则。Duplicate 复制 host/s、生成新 UUID 和新镜像关系，不复制 incident Curve。删除 Point 只沿下游传播，不删宿主；删除宿主递归删除定位点、下游曲线/定位点、相关 Patch 和 Smooth overrides，镜像成对清理。一次删除一个 Undo；selection 清除悬空 ID。

s/host/WORLD 编辑提交新的 source 对象。Smooth fingerprint 使用 placement 而非旧 position；Patch/Fullness 经过统一 Curve evaluator，2D/3D 和 Contour 消费更新后的几何。没有改变 Smooth solver 或 Patch boundary 模型。

NumericSlider 新增可选 `snapTargets`；定位点传 `[0.5]`，保留原默认零点吸附。1% 范围向目标靠近时吸附，离开目标仍可 fine step。没有定位点专用键盘/拖动实现。一次 keyboard hold 或 pointer session 一个 Undo，沿用 blur/cancel/unmount 等生命周期。

## 验证与限制

- 140 个单元测试通过：含旧 WORLD/Curve/Fullness/Smooth 测试，以及新增弧长、ownership、循环、两层依赖、edit-start 确定性、删除闭包、JSON 和 Patch → Smooth → Contour 链路。
- 21 项相关浏览器检查分批通过，build 通过。浏览器专项覆盖：新点创建/侧别、共享 Slider 与吸附、2D 禁止拖动、宿主 handle 跟随、作为新 Curve endpoint、Rename/Duplicate/Delete、Undo/Redo、重新加载、曲面及 Contour 更新；旧 WORLD Lock/45°镜像、Curve plane/handles、Slider、Sidebar 回归。
- 没有实施 CurveSpan、隐式切线、隐藏 CurveEdge、rehost、placement conversion、3D 点拾取或新的 Surface/Smooth 功能。
- 可选的宿主 secondary highlight 暂未加入；宿主名称显示在 Inspector。只有真正选中 Curve 才显示其控制柄。
