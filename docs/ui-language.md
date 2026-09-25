# 界面语言 / UI language

顶栏 `English / 中文` 按钮一键切换，缺省中文。语言保存在本机 localStorage 的 `contour.ui-language` 中，不写项目 JSON、不进入 Undo，不重置选择、工具或相机。

`src/ui/i18n/index.ts` 提供 `useLanguage` 和纯显示层 `uiText`。`messages.tsv` 每行是中文、英文、可选旧文案别名（Tab 分隔）。动态标题使用显式匹配模板。新 UI 文案继续加入词表，在显示边界调用 uiText；不要翻译命令参数、对象 UUID、source enum 的存储值或作者填写的对象名。

已覆盖顶栏、点/线/面列表与 Inspector、创建工具步骤、视角窗口、滑条及数值输入提示、参考图与 3D 背景、Loomis 控件、Continuity、Contour/Risk、菜单/对话框/通知与已有校验提示。自定义名称原样显示；未命名曲面的自动标签随语言变化。技术缩写、坐标字母和版本号保持可辨认。

验证：2 项翻译单测通过；浏览器验证双向切换、菜单/Inspector/Fullness、刷新记忆，并逐字比较切换前后的项目/selection/tool/past/future 不变。生产 build 通过。全量单测 313 passed、5 个已有基线失败，无新增失败。截图与日志在 artifacts/i18n。
