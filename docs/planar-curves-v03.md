# V0.3 — Semantic Planar Curve

## 使用

左侧「结构线 → 创建曲线」，然后在列表或 2D 画布依次选择 A/B。Esc 或「取消创建」退出。初始为严格直线。
选中结构线后直接拖线改变弯曲，两个圆形控制柄可调整 C / S 形；所有视图和 3D 同步。
「调整曲线平面」滑块相对于本次选中时的方向旋转（±180°），仅绕 AB，保持端点与归一化形状参数不变。
CENTERLINE → CENTERLINE 固定于 x=0 平面，只生成一条，适合从侧面编辑。
同侧点或中心点到单侧点自动建立镜像 pair；任意一侧可编辑，Rename/Delete 始终作用于整对。
同 endpoints 可建立多条结构线，重叠时从列表选择需要编辑的那条；选中线优先接受鼠标。

## 几何与数据

项目 `curves: CurveEdge[]`；每条有独立 UUID、名称、两个 Landmark UUID。端点世界位置只存于 Landmark。
Canonical record 保存单位 `planeNormal`、`startHandle/endHandle {along, offset}`。Mirror record 只有 canonical UUID 和镜像伙伴关系，不保存独立 shape。
局部 frame：d=normalize(B-A)，L=|B-A|，b=normalize(n×d)。
P1=A+L(a1*d+h1*b)，P2=B-L*a2*d+L*h2*b；初始 a1=a2=1/3，h1=h2=0。
Follower 的最终四个世界控制点逐点应用既有 mirror([x,y,z])=[-x,y,z]；编辑该侧先将世界目标镜像回 canonical，旋转方向也映射回 canonical。

创建法向：将 camera forward 投影到 chord 垂直空间；退化时依次 camera up/right，再选与 chord 最不平行的固定世界轴。
端点改变：使用旧/新 chord 的 cross/dot 求 shortest-arc axis-angle rotation（与 minimal quaternion 等价），旋转旧法向。接近完全反向时用旧法向确定旋转轴；最后仅清理浮点正交误差。normalized handles 不变。中线曲线不参与 transport。
端点恰好重合时所有控制点退化到 endpoint，保留形状参数和法向，暂停编辑。重新分开时在无法定义旧 chord 的退化情形才使用确定性垂直法向恢复。创建重合端点曲线会被拒绝。

拖本体：屏幕最近参数（128 个区间搜索及局部细化），t 固定于本次拖动并 clamp [0.05,0.95]；正交 mouse ray 与 plane 求交。保留抓取偏移；只使用 b 方向位移，以 Bézier 权重作 minimum-norm h1/h2 更新，along 不变。
拖 handle：同样 ray/plane 求交，再投回局部 along/offset，along clamp [0,1]。
近平行 ray/plane（|n·forward|<1e-5）拒绝本次形状拖动并提示换视图，不增加空间自由度。
所有 2D/thumbnail 用投影后的同一组控制点绘制 SVG cubic；3D 用同一 cubic 的线段采样渲染，没有曲面或三角形网格。

## 拓扑、历史与存档

LEFT→RIGHT 直接连接不支持，需显式 CENTERLINE 点拆分。交叉不插点、不拆线、不创建拓扑。
Landmark Delete 统计相关 curve UUID（含 pair），确认后级联删除；Undo 整体恢复。Duplicate Landmark 不复制曲线。
centerlineOrder 和黄色 guide 完全独立。
创建、重命名、删除、拖线、拖柄、平面旋转、端点跟随、级联删除都接入原有项目历史；每次连续拖动一步。
JSON 版本 `landmarks-0.3`，兼容旧文件，缺少 curves 则补空数组。校验 UUID、端点、单位法向、共面、handle 数值、对称引用；拒绝 dangling / 独立 follower shape。
自动保存使用 `contour.landmarks.v03`；无 V0.3 存档时读取并迁移 V0.2/V0.1，保留原存档键。
V0.2 branch 保留在 `12801b3`，V0.3 从此建立。

## 验证

- 62 项单元测试通过（包括原有 52 项），生产构建通过。
- 8 项原有浏览器回归通过；4 项 V0.3 浏览器验收通过（最后一轮对新增 4 项做了定向复测）。
- 覆盖：直线初始化、C/S 形、镜像世界控制点、mirror-side 操作、平面旋转、shortest-arc transport、反向/零长/极短 chord、多个同端点 edge、pair 管理、级联删除及恢复、Save/Load、V0.2 迁移和窄版界面。
- 实际 JSON 下载、刷新、重新导入后形状与 UUID 一致；拖线不改变 endpoint/lock 数据。
- 原有 Landmark 投影、nullspace、受限拖动、driver/follower、View Lock 函数未修改。

主要新增文件：`src/domain/curves/{model,geometry,management,persistence}.ts`，`src/ui/curves/{CurvePanel,CurveLayer}.tsx`，`src/tests/curves.test.ts`，`tests/e2e/curves.spec.ts`。
接入位置：project model/presets/parser、store、App/sidebar、EditView/MiniPreview、InspectView、Landmark 删除确认。

## 当前边界

曲线平面近乎侧向时需要换视角编辑；零长 chord 暂停形状编辑。完全对称模型不允许直接 LEFT→RIGHT 单条曲线。
Curve 没有 View Lock：锁定视图中的内部形状投影仍可随别处编辑改变，只有 Landmark 端点受既有锁约束。
没有 Surface、Patch、Mesh、网络 solver、自动拟合或自动交点拓扑。
