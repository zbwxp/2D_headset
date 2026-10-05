# Contour 架构重设计（设计阶段，不含产品代码）

目标：参照成熟软件，为“带模板制作器的 OC 线稿生成系统”设计一个牢固的 base。捏形、视角插值、曲边域等需求相关能力通过明确接口接入，不各自再造选择、保存、撤销逻辑。

| 文件 | 内容 | 负责 |
| --- | --- | --- |
| [01-reference-survey.md](01-reference-survey.md) | 成熟软件对照：各自怎么建模、借什么、不借什么 | Claude |
| [02-candidate-architectures.md](02-candidate-architectures.md) | 候选架构、推荐方案、验收检验点、待决问题 | Claude |
| 03-scenarios.md（待建） | 需求场景与反例清单，用于压测候选架构 | dot（Claude 同步入库） |

约定：

- 本分支 `design/architecture` 只改 `docs/design/`，不改产品代码。
- 仓库 Markdown 是主稿；Slack canvas 是同步阅读版和待讨论清单。
- 每次更新在 Slack #headset-collab 说明：改了哪份文档、哪个 commit、哪些结论待 bowen 决定。
- 旧实现（v103，`7205381`）只用于查遗漏和保留有效算法，不作为新架构的前提。
