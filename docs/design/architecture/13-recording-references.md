# 13 录制的参照：Live2D、Clip Studio Paint、MMD

草稿 v0.1（2026-10-07）。来源：Claude 的调研代理用 curl 读取官方文档和开源加载器源码；dot 独立核对了三处容易误读的地方（标为“dot 核对”）。原文副本保存在 scratchpad 的 `recording-refs/`。没有特别标注的，都已对照所引页面或源码确认；**〔未证实〕**表示未逐字核对。

bowen 指出这三个软件最接近“录制”。dot 补充：我们的“录制间”最接近的是 Live2D 的**建模参数和关键形态编辑**，而不是它那个叫 Record 的时间轴录制功能。

## 1. Live2D Cubism

**存什么**
- **参数**：带编号，有最小值、默认值、最大值，可以设成循环，可以标记为混合形状。有一套标准编号（如 ParamAngleX/Y/Z、ParamEyeLOpen、ParamMouthForm……）。[参数文档](https://docs.live2d.com/en/cubism-editor-manual/parameter/)，[标准参数表](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/)
- **关键形态**：每个对象在它绑定的各参数的关键点组合上，各存一份形态。例：一个对象绑定两个参数，分别有 4 个和 2 个关键点，就要存 8 份。官方建议每个对象最多绑 2 个参数，最多 3 个，绝不要 4 个以上；更多维度应拆到上下级变形器上分担（眉毛的例子：拆开后需要 3+3+9=15 份，不拆则是 81 份）。[多关键点](https://docs.live2d.com/en/cubism-editor-manual/multi-key/)，[父子分担](https://docs.live2d.com/en/cubism-editor-manual/keyform-parent-chilid-relation/)
- **ArtPath**：Live2D **本身就有矢量线**，带控制点、每个点各自的线宽、线色，线宽不随变形器缩放而变化。但它只在模型目标版本为 “SDK(N/A)/Latest” 时可用，不会进入游戏运行时。[ArtPath](https://docs.live2d.com/en/cubism-editor-manual/artpath/) **这是和我们最相关的一项先例。**
- **绘制顺序**：取值 0–1000，可以按关键形态变化；“绘制顺序组”让一个部件在外部看起来像一层。[绘制顺序](https://docs.live2d.com/en/cubism-editor-manual/draworder/)，[绘制顺序组](https://docs.live2d.com/en/cubism-editor-manual/drawing-order-group/)

**怎样组合和插值**
- 关键点之间做线性插值（在多维网格上是多线性插值）。“扩展插值”会预先烘焙出最多 20 个额外的关键点。[扩展插值](https://docs.live2d.com/en/cubism-editor-manual/extended-interpolation/)
- **混合形状**是叠加上去的增量：相对“最接近默认值的那份关键形态”计算差值。默认形态必须先锁定；可以设置权重上限曲线，防止多个混合形状叠加后形状崩坏。[混合形状](https://docs.live2d.com/en/cubism-editor-manual/blend-shape/)
- **辅助工具全部是“烘焙”出关键形态，而不是实时约束**：镜像会按变形器中心翻转生成关键形态；“3D 旋转表现”从正面自动估算出 AngleX/Y 的关键形态。[镜像](https://docs.live2d.com/en/cubism-editor-manual/motion-mirroring/)，[3D 旋转表现](https://docs.live2d.com/en/cubism-editor-manual/apply-3d-rotation-expression/)
- **在中间值编辑**：在当前参数值上点 [+] 添加一个关键点。新关键点的初始形状来自插值结果〔未证实：是否只能在关键点上编辑〕。**没有把修改反推分摊到相邻关键点的功能。**[编辑参数](https://docs.live2d.com/en/cubism-editor-manual/edit-parameters/)

**Glue（黏合）**
- 把两个 ArtMesh 上重叠的顶点成对绑在一起。每个顶点可以设置 A:B 的影响权重（用画笔涂，不能按关键形态变化）；整体“有效度”按关键形态设置，可以变化。
- **dot 核对**：Glue 确实是跨 ArtMesh 的顶点黏合，有两侧的影响权重，也有可以绑定参数的有效度。但官方文档**不支持**把它等同于通用的“端点 / 切线约束”；而且修改网格之前，要先解除 Glue。[Glue](https://docs.live2d.com/en/cubism-editor-manual/glue/)
- **可以借鉴的**：连接处设一个“谁主导”的权重，再加一个可以随参数变化的强度。**不能借鉴的**：它是变形完成后施加的软约束，不能代替我们的拓扑连接。

**运行时**：`.moc3` 是不透明的编译数据，运行时只暴露参数这个输入，以及顶点、透明度、绘制顺序这些输出，看不到关键形态和变形器。所有驱动（动作、物理、表情、追踪）都只写参数。[CubismModel.cpp](https://github.com/Live2D/CubismNativeFramework/blob/develop/src/Model/CubismModel.cpp)

## 2. Clip Studio Paint

- **矢量图层**：每条线由路径和控制点组成，**每个控制点各自有线宽和不透明度**。修正线宽时，有一种模式会把尖头变圆，另一种模式保持尖头。可以连接矢量线；矢量橡皮擦可以擦到交点为止，并且可以设成“参照所有图层”。[矢量图层](https://help.clip-studio.com/en-us/manual_en/180_layers/Vector_layers.htm)
- **填充**：填充不能直接用在矢量图层上，要在另一个栅格图层上，参照其他图层来填。“填充到矢量路径为止”会让填充停在矢量线的中心线上。填充是一次性的栅格结果，线条移动后不会重新计算〔未证实〕。[填充工具](https://help.clip-studio.com/en-us/manual_en/420_fill/Fill_Tool.htm)
- **动画**：用手画的动画单元，时间轴决定显示哪一个单元；关键帧只能控制图层的变换、不透明度和蒙版。**没有按参数对矢量控制点做插值**〔未证实：没有找到这种功能〕。dot 补充：可以借鉴它“画稿内容”和“怎样调用画稿”分开组织的方式，但不能说它有跨角度的曲线插值。[动画单元](https://help.clip-studio.com/en-us/manual_en/600_animation/Animation_folders_and_cels.htm)
- **3D 头部模型**（Ver.2.0）：有脸型混合器和各部位滑块，可以调角度，但**只是姿势参考**，和线稿没有关联。[3D 头部模型](https://help.clip-studio.com/en-us/manual_en/660_3d/3D_Head_Models.htm)

## 3. MMD / PMX

- **模型**：顶点、材质（含描边颜色和宽度）、骨骼（含 IK、付与亲：按比例继承另一根骨骼的旋转或位移）、变形（Morph），以及显示用的分组。[PMX 规格](https://gist.github.com/felixjones/f8a06bd48f9da9a4539f)
- **变形怎样组合**：顶点变形是稀疏的叠加增量（位置 += 偏移 × 权重）；组合变形让每个子变形按“自身权重 × 组权重”递归叠加，并做环检测。[saba PMXModel.cpp](https://github.com/benikabocha/saba/blob/master/src/Saba/Model/MMD/PMXModel.cpp)
- **翻转变形（flip morph）**：**dot 核对：它不是几何镜像**，结构和组合变形相同，按取值在几个变形之间切换〔具体语义未证实〕。左右镜像靠的是命名约定（左 / 右）和姿势的镜像粘贴〔未证实〕。
- **VMD 动作**：骨骼关键帧带 4 条 Bézier 缓动曲线（X、Y、Z、旋转各一条）；表情变形的关键帧是线性插值。[three.js MMDLoader](https://github.com/mrdoob/three.js/blob/r160/examples/jsm/loaders/MMDLoader.js)

## 3.5 论文《2.5D Cartoon Models》（Rivers、Igarashi、Durand）

已核实：ACM TOG 29(4)，SIGGRAPH 2010，DOI [10.1145/1778765.1778796](https://doi.org/10.1145/1778765.1778796)，项目页 http://www.alecrivers.com/2.5dcartoonmodels/ 。全文副本在 scratchpad 的 `recording-refs/rivers.txt`。

- **输入**：矢量线稿。在 yaw × pitch 网格上的几个关键视角里，分别画出同一笔画；跨视角的对应关系是**显式**的：选中一个笔画，在另一个视角里重画它。
- **插值**：对每个笔画，在它自己那几个关键视角构成的 **Delaunay 三角形**里做二维插值。（旧实现 v103 的 yaw/pitch 三角剖分正是这个思路，这一点支持保留三角剖分。我之前提的“改用 RBF”，目前缺少依据。）
- **3D 锚点**：每个笔画只有一个 3D 锚点，由它在各个关键视角中的中心反推出来。笔画像广告牌一样跟着锚点平移，锚点的深度决定前后遮挡顺序。可以设置为不跟锚点（比如总是朝向镜头的耳朵）；也可以让几个笔画共用一个平均锚点（比如瞳孔和眼睛）。
- **派生视角**：背面用正面镜像得到；对称的笔画在负 yaw 时用镜像生成。
- **遮挡和显隐**：默认按锚点深度决定前后。在视角网格上画一个多边形区域，可以在这个区域内覆盖两两之间的前后关系；类似的区域也可以控制显隐，用来切换不同风格的画法。
- **局限**：内部线不能融入外轮廓；凹形或尖锐的形状插值效果差；不支持局部遮挡（论文自己举的失败例子是头发）；前后关系翻转时会突然跳变；每个笔画大约需要 3–4 个关键视角。
- **后续工作**（只确认了存在，内容未读）：Yeh 等人的 Double-Sided 2.5D Graphics（IEEE TVCG 2013）；Fukusato & Maejima 的 View-Dependent Deformation for 2.5-D Cartoon Models（IEEE CG&A 2022）。
- **它没有做的**：在中间视角编辑后反推回关键视角。它的做法是添加新的关键视角。

**补充：Live2D ArtPath 可以按关键形态记录控制点的位置、线宽、线色和不透明度**（[ArtPath 调整](https://docs.live2d.com/en/cubism-editor-manual/artpath-adjustment/)）；线宽和线色还可以做混合形状。但它不进 SDK 运行时。

## 4. 关于“直接拖动反推”的学术依据（dot 核对）

Direct Manipulation Blendshapes（Lewis & Anjyo, 2010）求解的未知量是**现有形态的混合权重**，目标是在拟合拖动的同时尽量少改滑块值。它**不是**直接替我们解决“固定 0°、尽量少改 90° 的控制点”这个问题。正则化的思想可以借鉴，但不能当成我们的问题已经被它解决了。[DMB 预印本](https://scribblethink.org/Work/DirectManipBlendshapes/DMBpreprint.pdf)

## 5. 对我们设计的意义（待 dot 审）

| 我们的需求 | 最接近的先例 | 借鉴什么 | 不能借鉴或需要扩展的 |
| --- | --- | --- | --- |
| 同一套线在不同角度存不同形态 | Live2D 参数 + 关键形态；**ArtPath 矢量线**（控制点、线宽可以按关键形态变化）；**《2.5D Cartoon Models》**（每个笔画有自己的一组关键视角，在 Delaunay 三角形里插值） | 带编号的参数和关键形态；每个对象绑定的参数不超过 2–3 个，更多的靠层级分担；跨视角的对应关系要显式；按视角区域覆盖前后顺序和显隐 | Live2D 的变形对象主要是贴图网格；ArtPath 不进运行时，也看不到它的插值细节 |
| 表情 | Live2D 混合形状；MMD 组合变形 | 相对基础形态的叠加增量、权重上限、由原子滑块组合出表情预设 | 线条在转头时出现或消失，单靠线性增量表达不了，要靠按关键形态变化的显隐和绘制顺序 |
| 跨图层连接 | Live2D Glue | 连接处的主导权重、可以随参数变化的强度 | Glue 是软约束，修改网格前要先解除；我们的连接属于拓扑，要和填充共用同一份几何（11） |
| 每个点各自的线宽 | CSP 矢量线、Live2D ArtPath | 线宽按控制点存；修正线宽时保留尖头的模式 | — |
| 填充 | CSP“填充到矢量路径为止” | 以线的中心线作为边界 | CSP 填充是一次性结果，我们需要实时的区域 |
| 镜像 | Live2D 镜像（烘焙） | 显式的镜像轴，生成新的形态，而不是永久约束 | MMD 的翻转变形不是几何镜像 |
| 在中间角度拖动后反推 | 三个软件和《2.5D Cartoon Models》都没有（它们都是添加新的关键视角）；DMB 只解混合权重 | 正则化的思路 | **这一块需要我们自己设计并验证** |


