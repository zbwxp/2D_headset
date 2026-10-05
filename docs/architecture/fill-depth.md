# 填充的独立深度偏移

实色与雾化填充使用和曲线相同的 `depthOffset`、`depthScope`、`depthContext` 与 `depthPaintBatches`。省略字段等价于 0/PARENT，旧文档的绘制顺序不变。不是第二套填充排序器。

PARENT 使用结构上的所属笔画/组合，无法归入笔画时使用其真实层；LAYER 以所属层在图层序列中的位置为基准。正值向前、负值向后；隐藏项和空层仍占序位，超出边界只钳制当前效果，不擦除保存数值。目标来自原始结构位置，不递归跟随其他对象的偏移。

偏移只改绘制队列位置。填充的实际 `layerId`、边界引用、图层列表和边界曲线深度都不变。因此线条和其填充可以分别调遮挡位置。跨层移动或独立复制保留字段，随后按对应作者/所属结构求值。

透明挖空继续裁切所属层的全部实色/雾化填充，与深度排序无关。它的深度控件禁用，并解释原因；API 拒绝深度编辑。切换为透明时原数值保留但不生效，切回实色/雾化时恢复。移动挖空的所属层仍会改变裁切范围，深度偏移不会。

## 共同入口与下游

| 消费者 | 实现约束 |
| --- | --- |
| Drawing 与 Recording 属性 | 共用 `DepthControls`，由各自现有事务适配写入 |
| Drawing API | `setDepth` 严格提供 `curveId` 或 `fillId` 之一；同一整数/范围校验与 setter |
| Recording API | 同名 `setDepth` 调用同一 Drawing setter，再进入 `prepareSnapshotLocalDrawingEdit`；无需第二个属性 writer |
| 快照保存/继承 | `paintAppearance` 保存局部覆盖；显式 0 不回退到父稿；来源目标身份随引用、镜像映射 |
| 当前显示与 SVG | 共用 `PaintBatch`；批次排序变化保留所属层，用原层的 cutout 裁切 |
| 缓存与序列化 | fill 外观值参与有效键；校验字段、JSON 往返和原地 draft 值变化均覆盖 |

这沿用现有外观属性策略：真实视角可编辑，中间角取主导 basis 的离散外观，不创建层序响应键。插入真实视角时，已有的轨迹保护检查仍拒绝端点外观不同的情形；两端深度一致时可以插入并保留该值。

## 回归依据

- `drawing-fill-depth.test.ts`：0 默认、父级/跨层顺序、隐藏和空位、独立线/填充、非递归、复制/移动、透明作用域、可变 draft 缓存与 SVG。
- `fill-depth-api.test.ts`：source API 预览/提交/Undo/Redo、检查与导出、非法请求原子拒绝、真实视角/修正帧共享属性控件。
- `recordingSnapshot/fill-depth-properties.test.ts`：来源与局部覆盖、作者目标、Save/Discard、镜像、复制/移动、源曲线分段、序列化、冷热等价、离散插值与真实视角插入边界、公共 API。

构建、组合运行和实际浏览器验证另行记录；测试列表本身不等于所有流程已验收。
