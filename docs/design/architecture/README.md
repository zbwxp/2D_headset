# Contour 架构重设计（设计阶段，不含产品代码）

目标：参照成熟软件，为“带模板制作器的 OC 线稿生成系统”设计一个牢固的 base。捏形、视角插值、曲边域等需求相关能力通过明确接口接入，不各自再造选择、保存、撤销逻辑。

| 文件 | 内容 | 负责 |
| --- | --- | --- |
| [01-reference-survey.md](01-reference-survey.md) | 成熟软件对照：各自怎么建模、借什么、不借什么 | Claude |
| [02-candidate-architectures.md](02-candidate-architectures.md) | 候选架构、推荐方案、验收检验点、待决问题 | Claude |
| [03-scenarios.md](03-scenarios.md) | 需求场景与反例清单（RC-01～RC-20），用于压测候选架构 | dot（Claude 同步入库） |
| [04-pressure-test.md](04-pressure-test.md) | 用 RC-01～20 压测候选 A，修订为 v0.2；对 Q1～Q5 的看法 | Claude |
| [05-numeric-cases.md](05-numeric-cases.md) | 数值例子 N1～N5（dot 出题，Claude 推导）与由此引出的 4 处契约澄清 | dot + Claude |
| [06-decisions.md](06-decisions.md) | bowen 已决定的事项（只追加，不删除） | bowen |
| [07-tech-stack.md](07-tech-stack.md) | 技术底座选型：三条路线对比；直接采用 / 只借鉴 / 必须自研 | Claude |
| [08-base-one-pager.md](08-base-one-pager.md) | **给 bowen 的地基一页说明**（一张图、3 个日常操作、插件怎么接、现成 vs 自研） | Claude（待 dot 挑措辞） |
| [09-concrete-structure.md](09-concrete-structure.md) | （候选，非基线）具体结构：图层 / 画稿 / 模板 / 角色 / 录制的关系；0° / 30° / 90° 带数字的完整例子；从数据到画面；5 个操作 | Claude（待 dot 挑错） |
| [10-base-reference-code.md](10-base-reference-code.md) | 最小实现的地基：分两步走，每个模块参考哪份成熟代码（用法、许可证） | Claude 提议，待 dot 商定、bowen 点头 |
| [11-base-objects-and-layers.md](11-base-objects-and-layers.md) | **基本对象与图层**：曲线 / 端点 / 笔触 / 连接 / 填充 / 图层 / 编组 / 引用；同一内容被引用两次；选择、撤销、保存；人用界面与 AI API 共用一套操作；录制如何叠加 | Claude（待 dot 审） |
| [12-kernel-check.md](12-kernel-check.md) | 候选内核职责核对（源码审查）：tldraw SDK / svgcanvas / Fabric / Paper.js 对照 11 的四组关键职责；可借用零件；初步结论 | Claude 汇总（待 dot 抽查） |
| [13-recording-references.md](13-recording-references.md) | 录制的参照：Live2D（含 ArtPath 矢量线、Glue）、CSP、MMD；DMB 论文的边界（dot 核对） | Claude 汇总，dot 核对 |

约定：

- 本分支 `design/architecture` 只改 `docs/design/`，不改产品代码。
- 仓库 Markdown 是主稿；Slack canvas 是同步阅读版和待讨论清单。
- 每次更新在 Slack #headset-collab 说明：改了哪份文档、哪个 commit、哪些结论待 bowen 决定。
- 旧实现（v103，`7205381`）只用于查遗漏和保留有效算法，不作为新架构的前提。
