# V0.3.6 — 空间局部平滑

## 行为

仍在二维视口右键/双击共享语义点打开交点检查器，或点击可见过渡段。唯一形状参数为「平滑范围」。V 现在是裁剪球中心，过渡不必经过 V，也不受 source Plane 限制。

Source Landmark、Plane、控制柄、Curve UUID 均不修改；取消平滑无损恢复。新派生路径为 exact cubic outer → spatial quintic → exact cubic outer。没有增加 Landmark、CurveEdge、Surface、Patch 或 Mesh。

## Source 与兼容

Junction 保留 id、landmarkId、sideA/sideB（curveId + endpoint）、extent、symmetry。新 mode 为 `spatial-G2`。加载旧 `G1` 记录时保留 UUID/配对/extent，并显式迁移 mode。extent 数值保留，但裁剪语义由弧长改为球半径，所以旧平滑外观有意改变。

项目版本 `landmarks-0.3.6`；自动保存键 `contour.landmarks.v036`，首次读取旧 v035/v03/v02/v01。旧键不覆盖。Q、trim t、五次控制点、hA/hB、质量分数及 INVALID 原因均不持久化。Load/Undo 恢复 source 后重新求值。

## 球面裁剪

`r = extent × min(LA, LB)`。长度仍采用固定 512 段 LUT。将 cubic 平移缩放到单位球后，展开 `|C(t)-V|²-r²` 的六次多项式，递归隔离导数根，把区间分成单调段，再二分寻找球面交点。按 half-edge 路径方向选择第一个真正进入球外的交点，跳过仅接触球面的偶重根。

支持非单调距离、多次进出、反向端点。无出界、仅相切、截点落到另一端而没有外围、长度或切线退化时明确失效。双端裁剪比较实际 start/end 参数，不再把半径误当弧长。外围由 de Casteljau 精确提取。

## 五次构造与搜索

端点位置 A/B，路径定向切线 uA/uB，曲率向量 K = dT/ds。路径反向只反转单位切线，不反转曲率向量。

设置 `D0=hA*uA`、`D1=hB*uB`、`E0=hA²*KA`、`E1=hB²*KB`，使用用户指定的五次 Hermite→Bézier 控制点公式。qA/qB 保持 0；实际耳廓/眼角验证没有显示必须开放 q 或增加分段的证据。

全部候选在单位球坐标下构造，h 以 r 为单位。上下界为 `[max(0.08, 0.15*chord), min(8, max(0.8, 4*chord))]`；9×9 对数网格选优，再做最多 22 轮有界坐标细化。对已搜索候选按质量排序，选择通过正则性与自交检查的候选。

评分检查整段 41 个位置，包含弯曲能量、曲率向量变化、曲率峰值、相对长度、球外过冲、与原局部轮廓的距离及反向运动惩罚。球外不是硬限制，inflection 和非零挠率不被一律禁止。

这是确定性的有限搜索，不宣称全局最优或对所有 source 都有自然解。固定搜索与细化减少网格切换；实测 extent 1%–45% 每 1% 扫描没有突跳，但不宣称所有输入都具有理论连续的最优解分支。

## 对称

普通镜像侧严格镜像最终世界控制点。CENTERLINE mirror pair 用同一个 h（hA=hB），并按镜像反向关系构造后半控制点，得到自对称五次曲线；不再要求 source Plane 包含 X 方向。两条 sagittal source 的过渡自然留在 sagittal plane。

## 失效、质量与交叉检查

- `VALID` 且无 warning：当前检查通过，质量指标可接受。
- `VALID` 且有 warning：保留过渡，Inspector 显示急弯/过冲质量提示。
- `INVALID`：回退 source Corner，保留配对、UUID、extent 与 half-edge 占用。允许调 extent，恢复合法时自动重新显示过渡。

质量阈值是启发式：单位球坐标下峰值曲率 >35、球外 RMS 过冲 >0.25 或长度/弦长 >2.5 会提示。不是“美观”的数学定义。

非零导数用导数控制多边形的正投影界递归检查。过渡内部与保留网络的交叉采用有误差界的自适应折线和线段距离检测。除了共享端点的接触，过渡与其他外围/过渡的相交或过近会失效；回退后重新检查，防止新露出的 source 片段未参与检查。

这些检查属于有限精度的保守检测，极近接触可能被拒绝，不是任意极端输入无自交的符号证明。仅检查新增过渡相关交叉，不修复 source 原本已有的外围—外围自交，也不自动补齐开口拓扑。

## 绘制、拾取与包围盒

ResolvedSpan 支持 4 或 6 个 Bézier 控制点。通用 de Casteljau evaluator、任意阶导数、曲率、分割和控制多边形包围盒直接支持五次。

2D/缩略图：外围使用 SVG cubic；五次过渡按控制多边形到弦的最大距离递归细分，误差目标 0.15 屏幕像素（依据 zoom 换算）。显示与 hit path 使用同一折线，不做 cubic 拟合。

3D：直接自适应采样实际 Bézier，按曲线局部尺寸设置误差，再由 Three.js 更新 LineSegments 包围球。采样不会反写源控制点或影响端点连续性。JSON 是当前唯一产品导出格式，只导出 source；没有新增几何导出器。

## 实际案例

Fixture `src/tests/fixtures/ear-eye.json` 来自用户提供的项目，移除了参考图片数据。extent：耳廓 44%，眼角 38%。

| 对象 | 旧两段过渡峰值曲率 | 新整段峰值曲率 |
| --- | ---: | ---: |
| 外耳廓 | 17.1440 | 4.8334 |
| 外眼角 | 12.1587 | 6.5981 |

峰值用每个过渡 401 点诊断采样；单位是模型长度单位的倒数。旧值包含整段，而非只测连接点 V，因此与此前 V 处 16.66/11.36 的报告不同。

查看 [新旧对比](qa/spatial-smooth/comparison.html) 或 [对比图](qa/spatial-smooth/comparison.png)。橙色旧平面 G1，绿色新空间 G2，灰色原 source。截点规则改变，二者接管区间并非完全相同。

原耳廓文件是开口链：上耳根→耳尖→外耳廓→下耳根。闭合验收另在测试副本补充耳根闭合曲线，未修改用户 JSON；检查过渡与保留边界没有新增交叉。没有宣称自动闭合原文件或保证未来内部曲面质量。

## 验证

78 项单元测试、21 项浏览器测试及生产构建通过。实际案例图已人工查看。

自动测试覆盖两端位置/切向/曲率向量、四种 start/end、球相切/多根/无出界、镜像及自对称、双端裁剪、失效占用与恢复、尺度 1e-4/1e4、实际 extent 扫描、闭合测试边界、质量警告、删除/取消/Undo/Redo、旧 mode 迁移、JSON export/load 和真实项目浏览器拾取。

原 V0.3 source Curve geometry、minimal-rotation transport、View Lock、nullspace 和对称拖动数学未改。旧平面 Smooth 的交线限制与 D/3 构造已由本轮授权的新算法替换。
