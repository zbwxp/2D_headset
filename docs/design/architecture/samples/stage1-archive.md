# 阶段 1 完整存档样例（草稿 v1——v1 按 dot 1791306841：新数据存完整坐标，legacy-delta 只给旧轨道；Claude 起草；doc 18 §23.2 阶段 1，dot 1791306229 要求「先给一份完整存档样例」）

> 目的：在写阶段 1 代码之前，把存档里**每样东西归谁、怎么存、缺了怎么办**摆出来审。范围只到 §23 已定的东西；暂缓项（§23.4）不出现。
> 记录沿用现有 proto `schema.ts` 的 tldraw store 记录（`typeName` + `id`）；**现有 6 种记录一字不改**（container / curve / connection / fill / reference / pose），新增 6 种。坐标是部件局部坐标。

## 0. 坐标编码：新数据存完整坐标；只有迁移来的旧角度轨道用 legacy-delta（v1，按 dot 1791306841）

- **新数据一律存完整坐标**（部件局部坐标，每个锚点 `p / hIn / hOut` 三个绝对控制点）：预设原稿、预设角度键、表情作者目标、角色接管的目标与接管时的依据正脸、表情手修的目标与基准。
  - 原因（dot 的反例）：接管目标 10、当时正脸 0、冻结 L = 2；之后正脸 +1，正确结果 = 10 + 2 ×（1 − 0）= **12**。若目标和依据都存成相对会被编辑的 `curve.anchors` 的差量，正脸编辑移动了基准，目标变 11、依据变 1，结果 = 11 + 2 ×（1 − 1）= **11**，语义被改。**冻结的东西不能挂在可变基准上。**
- **只有迁移来的旧角度轨道**（owner = document）用 **legacy-delta**：存相对 `curve.anchors` 的偏移，求值走「画稿 + 插值后的偏移」，运算顺序照旧，所以旧文档逐位兼容；改画稿传到所有角度（选项甲，`pose.test.ts`）也保留。这是专门的读取分支，**不推广到新数据**。
- v0 曾提议所有数据统一用差量（「编码基准」），已撤回；§15.5「编码基准第一版不用」保持不变。

## 1. 样例存档（JSON；只列 `document` 作用域的记录）

```jsonc
{
  "schema": { "contour": 2 },            // 1 → 2：多了下面 6 种记录；旧文档读入时迁移（§4）
  "records": [
    // ── 现有记录：不变 ──
    { "typeName": "container", "id": "container:L1", "name": "眼", "parentId": null, "index": "a1", "visible": true, "locked": false, "opacity": 1, "tags": [] },
    { "typeName": "curve", "id": "curve:lid", "name": "上眼睑", "parentId": "container:L1", "index": "a1",
      "anchors": {                       // 拓扑 + 曲线自己的画稿（相对手柄，沿用现有约定）；新预设数据不相对它存
        "a": { "id": "a", "p": { "x": -10, "y": 0 }, "hIn": { "x": 0, "y": 0 }, "hOut": { "x": 3, "y": -4 } },
        "m": { "id": "m", "p": { "x": 0, "y": -4 }, "hIn": { "x": -5, "y": 0 }, "hOut": { "x": 5, "y": 0 } },
        "b": { "id": "b", "p": { "x": 10, "y": 0 }, "hIn": { "x": -3, "y": -4 }, "hOut": { "x": 0, "y": 0 } } },
      "segments": [ { "id": "s1", "from": "a", "to": "m" }, { "id": "s2", "from": "m", "to": "b" } ],
      "closed": false, "stroke": { "color": "#000", "width": 2 }, "depthOffset": 0, "tags": [] },
    { "typeName": "curve", "id": "curve:strand", "name": "侧发", "parentId": "container:L1", "index": "a2",
      "anchors": { "...": "画在 90° 时的位置（曲线记录总要有坐标）" },
      "segments": [ { "id": "t1", "from": "u", "to": "w" } ], "closed": false, "stroke": { "color": "#000", "width": 1.5 }, "depthOffset": 0, "tags": [] },
    { "typeName": "curve", "id": "curve:C1", "name": "旧文档里的下颌线", "...": "现有字段" },

    // ── 新：A 预设 ──
    { "typeName": "family", "id": "family:eye", "name": "眼型",
      "curves": [ "curve:lid", "curve:strand" ],          // 拓扑归属：族里登记了哪些曲线身份（每个预设都必须为它们各有一条 forms）
      "presets": [ "preset:P", "preset:Q" ] },
    { "typeName": "preset", "id": "preset:P", "familyId": "family:eye", "name": "杏眼" },
    { "typeName": "preset", "id": "preset:Q", "familyId": "family:eye", "name": "圆眼" },

    // 一条曲线在一个归属者下的全部关键形态（归属者 = 预设、角色，或迁移来的 document）
    { "typeName": "forms", "id": "forms:preset:P/curve:lid", "curveId": "curve:lid",
      "owner": { "kind": "preset", "id": "preset:P" },
      "original": { "a": { "p": [-10, 0], "hIn": [-10, 0], "hOut": [-7, -4] }, "m": { "p": [0, -4.5], "hIn": [-5, -4.5], "hOut": [5, -4.5] }, "b": { "p": [10, 0], "hIn": [7, -4], "hOut": [10, 0] } },
                                                       // 无 yaw 原稿，完整绝对控制点（手柄也是绝对坐标）；null = 没有原稿
      "yaw": [                                          // 角度键：任意正负，按 yaw 排序、唯一；范围外夹取
        { "yaw": -60, "shape": { "a": { "p": [-14, 0], "hIn": [-14, 0], "hOut": [-10.6, -3.8] }, "...": "每个锚点三个独立的绝对控制点" } },
        { "yaw": 0,   "shape": { "...": "0° 显式形态，可以 ≠ original" } },
        { "yaw": 90,  "shape": { "...": "" } } ],
      "expr": {                                         // 表情：每个参数一条自己的稀疏轨道（§20.3）
        "blink": [
          { "yaw": 0,  "kind": "author", "target": { "...": "完整目标（绝对坐标）" }, "ruleVersion": 1 },   // 预设修正 = target − 规则(预设在该角的中性形态)，重建时按 ruleVersion 的规则算
          { "yaw": 90, "kind": "rule" } ] } },            // 规则键：只有表情基准
    { "typeName": "forms", "id": "forms:preset:Q/curve:lid", "curveId": "curve:lid", "owner": { "kind": "preset", "id": "preset:Q" },
      "original": { "...": "" }, "yaw": [ { "yaw": 0, "shape": { "...": "" } }, { "yaw": 45, "shape": { "...": "" } } ],
      "expr": { "blink": [ { "yaw": 45, "kind": "rule" } ] } },
    { "typeName": "forms", "id": "forms:preset:P/curve:strand", "curveId": "curve:strand", "owner": { "kind": "preset", "id": "preset:P" },
      "original": null,                                  // 只在 90° 画过：无 yaw 上下文里报缺失（§20.2）
      "yaw": [ { "yaw": 90, "shape": { "u": { "p": [30, -2], "hIn": [30, -2], "hOut": [32, 1] }, "w": { "...": "" } } } ],
      "expr": {} },
    { "typeName": "forms", "id": "forms:preset:Q/curve:strand", "curveId": "curve:strand", "owner": { "kind": "preset", "id": "preset:Q" },
      "original": null, "yaw": [], "expr": {} },          // 只登记身份、没有任何形状：Q 权重非 0 时混合报缺失，不重新归一化

    // ── 新：B 依据 ──
    { "typeName": "rule", "id": "rule:eye/blink", "familyId": "family:eye", "param": "blink",
      "kind": "lidClose", "version": 1,                   // 规则绑定和版本：重建按这个版本跑；版本变了要重建并报告
      "roles": { "upper": "curve:lid", "lower": "curve:lowerLid" } },   // 下眼睑曲线在样例里省略
    { "typeName": "helperDomain", "id": "helperDomain:P/90", "presetId": "preset:P", "yaw": 90,
      "affine": { "a": 0.42, "b": -0.07, "c": 0.11, "d": 0.9, "e": 3, "f": 0 },
      "source": { "yaw": 0 }, "target": { "yaw": 90 }, "ruleVersion": 1 },   // 只用于初始化和重建（§11 / §15.1），播放不读

    // ── 新：C 角色 ──
    { "typeName": "character", "id": "character:K", "familyId": "family:eye", "name": "角色 K",
      "weights": { "preset:P": 0.6, "preset:Q": 0.4 },
      "fineTune": { "curve:lid": { "m": { "dp": [0, -0.8], "dIn": [0.3, -0.8], "dOut": [-0.3, -0.8] } } },   // 正脸微调：本身就是「叠在预设混合上的偏移」（§15.1），按定义是差量，相对的是预设混合、不是 curve.anchors
      "takeovers": [
        { "kind": "line", "curveId": "curve:lid", "owner": "character", "state": { "yaw": 90 }, "range": { "from": 0, "to": 90 },
          "target": { "...": "接管时的完整目标（绝对坐标）" }, "basisFront": { "...": "接管时的角色正脸（绝对坐标）" },
          "L": [0.42, -0.07, 0.11, 0.9] } ],              // 冻结的 L：之后只用它传递（§15.2），不重新拟合
      "exprFixes": [
        { "curveId": "curve:lid", "state": { "yaw": 90, "blink": 1 },
          "target": { "...": "绝对坐标" }, "base": { "...": "当时的表情基准（绝对坐标）" }, "ruleVersion": 1 } ] },   // 角色修正优先，不叠预设修正

    // ── 新：显隐（形状和显隐分开） ──
    { "typeName": "visibility", "id": "visibility:preset:P/curve:strand", "curveId": "curve:strand",
      "owner": { "kind": "preset", "id": "preset:P" }, "mode": "step",
      "keys": [ { "yaw": -90, "visible": false }, { "yaw": 30, "visible": true } ] },

    // ── 迁移来的旧数据（§4）：旧 pose 记录 → document 归属的 forms ──
    { "typeName": "forms", "id": "forms:document/curve:C1", "curveId": "curve:C1", "owner": { "kind": "document" },
      "encoding": "legacy-delta",                         // 只有迁移来的旧角度轨道用；相对 curve.anchors 的偏移，求值顺序照旧
      "original": "curve",                                // 原稿就是曲线记录本身（旧语义）
      "yaw": [ { "yaw": -30, "offsets": { "a1": [-2, 1], "...": "旧偏移原样；缺项 = 0（旧语义）" } } ],
      "expr": {} }
  ]
}
```

## 2. 每样东西归谁

| 东西 | 记录 | 块（§15.1） | 谁写 |
| --- | --- | --- | --- |
| 拓扑（锚点 / 段身份）+ 曲线画稿 | `curve`（现有） | — | 结构命令（阶段 2）；旧 `moveAnchors` 等不传新目标时照旧改它（§22.6 第 7 项） |
| 族登记（哪些曲线、哪些预设） | `family` | A | 作者 |
| 预设身份 | `preset` | A | 作者 |
| 原稿 / 角度键 / 表情作者目标与规则键 | `forms`（owner = preset） | A | 作者（预设作者模式） |
| 规则绑定与版本 | `rule` | B | 作者 |
| 辅助域 | `helperDomain` | B | 作者 / 初始化 |
| 权重、正脸微调、接管（含冻结 L）、表情手修 | `character` | C | 用户 / 作者 |
| 显隐轨道 | `visibility` | A（预设）/ C（角色） | 各自的归属者 |
| 迁移来的旧角度形态 | `forms`（owner = document） | — | 迁移；之后旧命令 `setPoseKey` 写它 |
| 缓存（角色可播放形态等） | **不存** | — | 重建（§15.1） |

## 3. 缺失怎么表示（§20.2）
- `original: null` = 没有无 yaw 原稿：无 yaw 上下文报缺失。
- `yaw: []` 且 `original` 存在 = 没有角度轨道：各角度静止在原稿。**轨道中间没有作者键仍插值**。
- 族里登记了、但某预设 `original: null` 且 `yaw: []` = 只登记身份：权重非 0 时混合报缺失。
- 某预设**根本没有**这条曲线的 `forms` 记录 = 存档不合法（打开时报错，同现有 `graphProblems`）——族登记要求每个预设都有。
- 锚点在新数据的某个形状里缺项：**不合法**（新记录要求每个键列出全部锚点）；legacy-delta 的「缺项 = 0」只属于迁移来的旧轨道。

## 4. 迁移（schema 1 → 2）
1. 每条旧 `pose` 记录 → 一条 `forms`（owner = document，`encoding: "legacy-delta"`）：旧键原样搬过来（yaw 与 offsets 不变，缺项 = 0 的旧语义保留）。
2. 旧 `pose` 记录删除；之后 `setPoseKey`（不传新目标）改写 `forms:document/…`，语义不变。
3. 验收：迁移后**真正读 `forms` 求值**（求值路径里不再有 `pose` 记录），每个旧测试文档在每个记录角度、键之间、范围外的结果与迁移前**逐位相等**。

## 5. 已定的粒度（dot 1791306841，先取简单方案）
1. 每个归属者 × 曲线一条 `forms`。
2. 角色接管和表情手修先放在 `character` 记录里。
3. 族内每个预设对每条族曲线都有 `forms` 占位；没有形状时明确标缺失（`original: null`、`yaw: []`）。缺记录 = 存档不合法。

## 6. 仍在核的
具体字段 dot 还在核；阶段 1 **不启动**，等字段核完。
