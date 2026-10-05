# 01 成熟软件对照

版本：v0.1（2026-10-06，Claude）。资料来源附在每节末尾；标注〔未证实〕的是记忆或推断，未在官方文档中逐字确认。

我们的产品没有完全对应的成熟软件。下面每个软件只借它最成熟的那一块，并写明不借什么。

## 总览

| 我们的问题 | 最值得参照 | 借什么 |
| --- | --- | --- |
| 文档里到底存什么、对象身份 | Figma、Blender | 扁平的 ID → 属性存储；客户端生成稳定 ID；ID 之间的强引用 |
| 编辑、事务、撤销 | Blender、Compositor、Figma | 一次操作 = 一个撤销步；拖拽先改草稿再一次提交；不改变文档的操作不进历史 |
| 求值与保存分离 | Blender depsgraph | 只保存原始数据；视口和导出读“求值副本”，求值结果永不保存 |
| 模板 / 实例 / 局部修改 | Figma、Blender、Spine | 实例 = 引用 + 参数值 + 按稳定 ID 路径记录的稀疏覆盖；链接 / 覆盖 / 断开 |
| 转头、表情、捏形 | Live2D Cubism、Moho、Spine、Harmony | 参数 → 关键形态；分层叠加；拓扑变化用切换而不是插值 |
| 选择与外观 | Illustrator | A/V 两种选择深度；几何与外观（描边、收笔、填充）分离 |
| 部件复用到新脸型 | Spine 皮肤、Cubism 模型模板 | 占位符 + 继承形变；稳定参数 ID；套用后再微调 |

## 1. Adobe Animate / Flash

**模型**：文档有一个元件库（library），每个元件有自己的时间轴（图层 → 帧）。舞台上的实例只存“引用哪个元件 + 变换矩阵 + 少量实例属性”。图形元件实例还能指定“停在第几帧”（single frame / firstFrame）。Adobe 为口型同步做的 Frame Picker，就是“一个部件元件的每一帧是一种口型，实例只选用哪一帧”。

**借**：
- “部件定义 + 实例选用某个状态”的结构，直接对应“部件有若干角度 / 表情状态，角色实例选择用哪个”。
- 关键帧 = 某个位置上的稀疏值，补间设置挂在关键帧上，不挂在对象上。
- 形状提示（shape hints）说明了：对应关系必须显式。我们的曲线锚点要有稳定 ID，而不是靠猜。

**不借**：
- 按名字引用元件（改名就断）。
- 只有一条时间轴：我们需要 yaw、pitch、表情、捏形等多个独立维度。
- “打散（Break Apart）后才能做形状补间”，这会切断和源部件的联系。

**教训**：形状补间在拓扑变化时不可靠。快照“像帧”是对的直觉，但帧只是参数空间里的一种特例。

来源：helpx.adobe.com/animate（symbol-instances、symbols、shape-tweening，2024 存档）；XFL 逆向 schema：jindrapetrik.github.io/xfl-schema

## 2. Figma

**模型**：文档是 `Map<对象ID, Map<属性, 值>>`。ID 由客户端生成，内含客户端编号，离线也唯一。树结构用“父 ID + 分数索引位置”一个原子属性表达，所以改父级不会出现重复节点。组件（component）与实例（instance）：实例记录对主组件的直接覆盖 `{id, overriddenFields}`；可覆盖的是填充、描边、文本、可见性、嵌套实例替换，结构（层级顺序、位置）不可覆盖。组件属性（布尔、文本、实例替换、变体）就是制作者暴露给使用者的参数。

**事务与撤销**：属性级“最后写入者胜”。撤销原则是“撤销很多步、复制、再重做回来，文档必须不变”。插件运行在沙箱里，只能通过文档 API 改文档；一次插件运行默认是一个撤销步。

**借**：
- 扁平的 ID → 属性存储，稳定的客户端 ID。
- 属性级操作作为修改单位。
- 实例 = 引用 + 稀疏覆盖，覆盖按（稳定子路径，属性）记录；提供“重置覆盖”和“断开”。
- 组件属性 = 制作者定义的参数面板。
- **插件只能通过同一套文档 API 修改文档**，这是消灭“每个功能一套特例”的关键。

**不借**：
- 变体切换时按图层名匹配覆盖（Figma 自己说这是启发式、会变）。我们用稳定 ID。
- 多人协作的服务器排序机制（目前不需要）。

**教训**：实例不允许结构性修改，所以结构变化只能断开。我们需要提前决定：使用者能不能在实例里增删曲线？

来源：figma.com/blog/how-figmas-multiplayer-technology-works；figma.com/blog/realtime-editing-of-ordered-sequences；figma.com/plugin-docs（InstanceNode、how-plugins-run、commitUndo）；help.figma.com（Apply overrides to instances）

## 3. Adobe Illustrator

**模型**：图层 → 子图层 → 编组 → 路径。外观（任意多个填充、描边、透明度、效果）可以挂在任意层级上，不改变底下的路径几何。实时效果是非破坏性的，“扩展外观”才会烘焙成几何。

**借**：
- 几何与外观分离：线宽、收笔、描边样式、显隐区间属于外观；转头和捏形只动几何。
- 选择两档深度：V 选整个对象，A 选锚点和线段。隔离模式 = “进入部件定义编辑”。
- 非破坏性的效果管线，加显式的“烘焙”。

**不借**：外观依赖层级位置（对象移出图层就丢失效果）。部件在角色之间移动时，样式应该跟着部件走。

来源：helpx.adobe.com/illustrator（appearance-attributes、selecting-objects、effects，2024 存档）

## 4. Live2D Cubism

**模型**：参数是带 min/default/max 和稳定 ID 的标量。每个对象（网格、变形器）在它绑定的参数的每个关键点上存一个关键形态（keyform）。绑定多个参数时存完整的笛卡尔网格（4 键 × 2 键 = 8 个关键形态）。变形器是父子链：先插值出每个对象的关键形态，再沿父变形器逐级变换。

**组合方式**：
- 普通关键形态不可叠加。官方建议每个对象最多绑 2 个参数，最多 3 个；更多维度靠拆到父子变形器上（眉毛例子：3+3+9=15 个关键形态，而不是 81 个）。
- Blend Shape 是较新的可叠加层：增量 = (blend 关键形态 − 普通网格中最接近默认的形态) × 权重，在所有普通关键点上加同一个增量。多个 blend shape 会互相冲突，用“权重限制曲线”（由其他参数驱动，取最小值后相乘）来驯服，典型例子是口型元音。官方提醒：默认形态改了，blend shape 就会坏，所以要最后做。

**中间角度修正**：在中间值（如 AngleX=15）加关键点，会给整个网格加一行或一列。没有稀疏修正。

**复用**：模型模板（Model Template）把部件、变形器结构和关键形态套到新画稿上：用包围盒和调整参数对齐，自动映射网格，再手动修正。标准参数 ID（ParamAngleX…）让动作可以跨模型共享。新画稿超出模板变形器范围时精度下降。

**借**：参数 = 稳定 ID 的标量；关键形态；变形器父子链（让子部件的局部增量跟着头一起转）；权重限制曲线；模板“套用 + 微调”的工作流；绘制顺序可以按关键形态变化。

**不借**：所有参数的完整笛卡尔网格（会爆炸）；中间修正必须加整行关键点；blend shape 的增量在屏幕空间里计算（大角度转头时会错）。

来源：docs.live2d.com/en/cubism-editor-manual/（blend-shape、limit-settings-for-blend-shape-weights、keyform-parent-chilid-relation、combintion-of-parent-child-relation、multi-key、extended-interpolation、template、applying-the-model-template、draworder、drawing-order-group、apply-3d-rotation-expression）

## 5. Moho（Smart Bones）

**模型**：Smart Bone 拥有一个以骨骼命名的小时间轴（Action）。骨骼角度映射到动作帧：静止姿态在第 0 帧，转动后的姿态在第 N 帧。动作可以给点位置、曲率、线宽、切换层选择、可见性打关键帧。Smart Warp 是由骨骼或动作驱动的变形网格层。

**组合**：同一组点上的多个 smart bone 动作以相对静止姿态的偏移叠加，所以左右转头和上下转头两个控制可以叠加〔实践做法，非文档规定〕。

**借**：矢量线稿的“参数驱动点位、线宽、可见性”这件事有成熟先例；拓扑变化用切换层（switch layer）解决。

**不借**：复用能力弱，动作直接绑定具体点 ID，换设计几乎要重做。

来源：moho.lostmarble.com/pages/features；mohoscripting.com（MohoLayer、SwitchLayer）

## 6. Toon Boom Harmony

**模型**：节点图：画稿元素 → 变形链（骨骼 / 曲线 / 偏移节点，各有静止位置和动画位置）→ 合成。画稿替换（drawing substitution）是一列可切换的画稿。

**转头**：主控制器（Master Controller）的滑块向导在关键姿态（正面、3/4、侧面…）之间插值；网格向导用一个二维点在姿态网格中插值头部朝向，或混合 4 个表情。官方要求这些姿态“使用相同的图层和画稿，只依赖形变”；拓扑变化需要画稿替换；变形切换节点（Transformation-Switch）决定使用哪条变形链。

**借**：二维姿态网格（yaw × pitch）是业内标准做法；**能插值的只有同拓扑的形变，拓扑不同就切换**，这条规则必须写进我们的 base。

来源：docs.toonboom.com/help/harmony-22/premium/（master-controller、slider-wizard、grid-wizard、deformation、bone-node、deformation-switch-node）

## 7. Spine

**模型**：骨骼 → 插槽（绘制顺序）→ 附件；皮肤（skin）把（插槽，占位名）映射到真正的附件，缺失时回退到默认皮肤。网格形变关键帧存的是“加在设置姿态上的顶点偏移”。

**组合**：动画轨道按顺序应用，高轨道只覆盖它打了关键帧的属性，可以设为叠加模式并按比例混合。约束按用户指定的显式顺序执行。Spine 4.3 的 Sliders 用骨骼属性驱动动画帧，和 Moho 的 smart bone 是同一个思路。

**复用**：链接网格（linked mesh）共享源网格的顶点和权重，使用不同的画，并继承源的形变时间轴。这是“同一套动作换一套设计”最干净的做法，前提是拓扑相同。

**借**：皮肤占位符（部件槽 + 可替换的具体部件）；形变存为相对设置姿态的偏移；求值顺序显式且确定。

来源：esotericsoftware.com（spine-json-format、spine-skins、spine-applying-animations、spine-constraints、spine-sliders、spine-api-reference）

## 8. Blender

**模型**：几乎所有持久数据都是 ID 数据块（网格、物体、材质、形态键…）或属于某个 ID。ID 之间的强引用会增加用户计数；有一个通用 API 能遍历所有 ID 指针，删除、重映射、引用检查都靠它。
- 链接（link）：只读引用另一个文件里的 ID，每次打开都从源文件重新加载。
- 追加（append）：独立本地副本，不再有联系。
- 库覆盖（library override）：链接数据的本地可编辑版本，存“源引用 + 按 RNA 路径记录的覆盖操作”；源更新后重新推导再重放覆盖。难点是源结构改变时的“重新同步”（resync）。

**形态键与驱动器**：Basis 是静止形；相对模式下每个键贡献 `值 × (键 − 相对键)`，在 basis 上相加。驱动器是挂在任意属性上的曲线，由其他属性驱动（典型用法：由骨骼角度驱动修正形态键）。

**依赖图（depsgraph）**：原始数据不含运行时字段；求值时做写时复制，修改器、约束、驱动器、形态键都作用在副本上。视口和渲染只读求值数据。求值结果永不保存，因为它可再生、会过期，而且不同窗口可以有不同的求值状态。修改器是有序、非破坏性的栈，“应用”才烘焙回原始数据。

**操作符与撤销**：注册了 UNDO 的操作符执行完成时推一个撤销步，取消则不推；模态操作符（拖拽）结束时只推一次。操作符参数可序列化，因此支持“调整上一步操作”。教训：同一个撤销栈里混着多种撤销类型（全局 memfile、编辑模式、雕刻…）是长期的 bug 来源；整文件快照只有在结构共享时才可行；UI 状态不进撤销。

**插件**：可以注册操作符、面板、属性；不能定义新的核心数据类型。

**借**：只保存原始数据；求值副本；链接 / 追加 / 覆盖三种复用关系；相对形态键 + 驱动器；一次操作一个撤销步；可序列化的操作参数；一开始就给所有实体稳定 ID，避免 resync 难题。

**不借**：多种撤销步类型混在一个栈里；插件不能扩展数据类型（我们应该允许插件在 schema 约束下注册新的部件类型和求值器）。

来源：developer.blender.org/docs/features/core/（datablocks、relationships、overrides/library、depsgraph、undo）；docs.blender.org/manual（shape keys、drivers、library overrides）；docs.blender.org/api（Operator）

## 9. Compositor（robbietilton/Compositor @ 11d8d7a）

macOS 上用 Swift/Metal 写的像素合成器。

**模型**：`CanvasDocument` 和 `ImageLayer` 是值类型；图层是一个扁平数组，用 `parentID/isGroup` 表达文件夹；像素是不可变的共享 `CGImage`，所以复制文档很便宜。选择属于文档（撤销会覆盖它），但不保存。参数化的形状和文字只在图层图像仍是它们渲染出的那张图时“活着”，任何破坏性像素编辑都会丢掉它们。

**历史**（`Document/DocumentHistory.swift`）：撤销存整份文档的前后快照，共享像素。`beginEdit/endEdit` 可嵌套、带名字，只有最外层记录；没有改变的编辑通过 `Equatable` 丢弃，所以选择、导航不会清空重做；手势进行中禁止撤销；拖拽改的是草稿，结束时一次提交。

**保存**：每个历史条目有一个修订 UUID，“已修改”就是当前修订 ≠ 已保存修订，撤销回保存点会自动变回“未修改”。保存时捕获一份快照和修订号，后台写盘，只把那一个修订标为已保存。文件格式有严格版本号，加载前全量校验再替换，原子写入；外部修改按内容摘要检测。

**借**：不可变文档 + 结构共享（TypeScript 里用 Immer 或持久化 Map）；命名、可嵌套的事务；草稿再提交；无变化的编辑不进历史；修订号做脏标记；后台保存捕获的快照；版本化 schema + 加载前全量校验；屏幕和导出共用一个渲染器；按对象身份做缓存键。

**不借**：没有求值层，烘焙后的像素就是文档本身；扁平图层、没有复用和参数；一个巨大的 `EditorSession` 加上工具枚举，没有注册边界；“编辑后静默丢掉矢量数据”的回退（对线稿来说曲线必须永远是真相）。

来源：本地克隆的 `Compositor/Document/EditorSession.swift`、`Document/DocumentHistory.swift`、`IO/ProjectController.swift`、`IO/ProjectStore.swift`、`docs/project-format.md`

## 综合结论

1. **没有一个成熟软件同时解决“多维参数 + 线稿质量 + 模板复用”**。组合方式是我们自己的设计，但每个部分都有成熟先例。
2. **快照不是一个概念，而是三个**：参数空间里的关键形态（Cubism keyform / Flash 关键帧）、某个视角下的美术修正（稀疏增量）、以及“存档版本”。旧实现把它们混在一起，这是特例泛滥的根源之一。
3. **能插值的只有同拓扑的形变**（Harmony、Spine 都这样要求）。拓扑变化（耳朵出现 / 消失、鼻子轮廓换形）必须走“切换”或“可见性通道”，不能硬插值。
4. **参数要分层、按固定顺序叠加**，而不是一个大网格（Cubism 自己都建议不超过 3 维）。
5. **所有修改只走一套文档 API**（Figma 插件、Blender 操作符）。这是让“插件式扩展”不再各自造选择和保存逻辑的前提。
