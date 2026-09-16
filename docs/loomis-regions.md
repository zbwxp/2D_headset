# Loomis 辅助与球面区域

Loomis 辅助面板统一管理 HeadFrame 尺寸、Section 创建/参数、Section 在线语义点及纯椭球区域。普通曲线和混合 Patch 继续使用原工具。

## 操作

1. 创建所需 Section，调整方向/Offset。可在 Section 上添加在线点。
2. 在「Loomis 球面区域」勾选参与划分的 Section。
3. 点击「预览候选球面区域」。3D 显示不同颜色的候选区域。
4. 点击目标区域建立；旋转相机可选择背面。Esc 取消。
5. 「移除区域」移除该区域及镜像侧，保留 Section 和定位点。

区域不受三/四边限制，不需要在线点构成端点环。整条 Section 参与划分；圆弧来自 Section 之间的交点。混合自由曲线仍使用原三/四边 Patch。

## Source

`loomisRegions: { id, name, cuts: {curveId, side}[], seed: Vec3 }[]`

cuts 是相对于实际 Section plane 的半空间选择；seed 是 head-local 单位球面内点，用于同一符号组合有多个连通分量时选择分量。没有 Fullness、内部控制柄或写回 mesh。镜像成员使用 `:mirror` 后缀关联 canonical 区域，最终 mesh 从 canonical 镜像。删除宿主 Section 会在 commit 中级联清理依赖区域。

在单位球面建立 Section arrangement，再映射到 HeadFrame 椭球。显示网格是派生数据；裁剪交点沿对应大圆/小圆求根，始终回到椭球表面。显示仍有 tessellation 误差，极小区域可能低于当前固定细分的分辨率。暂不提供球面区域边界后编辑。

普通 Patch 不迁移、不转型；区域独立保存，接入 2D GPU/CPU、3D、Contour 的最终 surface 数据。使用既有 surface 显示开关/透明度；不参与普通 Patch Fullness 或 continuity solver。Undo/Redo 通过 project history 保存。

验证：八分球面、偏移/斜切约束、椭球尺寸联动、Save/Load、2D/Contour 数据源；浏览器真实 3D 点击、Undo/Redo、reload、删除；原 Section mixed Patch 回归。
