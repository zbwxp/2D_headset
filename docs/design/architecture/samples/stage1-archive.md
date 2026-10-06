# 阶段 1 完整存档样例（草稿 v0，Claude 起草；doc 18 §23.2 阶段 1，dot 1791306229 要求「先给一份完整存档样例」）

> 目的：在写阶段 1 代码之前，把存档里**每样东西归谁、怎么存、缺了怎么办**摆出来审。范围只到 §23 已定的东西；暂缓项（§23.4）不出现。
> 记录沿用现有 proto `schema.ts` 的 tldraw store 记录（`typeName` + `id`）；**现有 6 种记录一字不改**（container / curve / connection / fill / reference / pose），新增 6 种。坐标是部件局部坐标。

## 0. 一个需要先审的选择：关键形态怎么编码

**每个控制点存相对「编码基准」的差量**，编码基准 = 曲线记录 `curve.anchors` 求出的绝对控制点（锚点 p、绝对入柄、绝对出柄）。每个锚点存三个差量 `dp / dIn / dOut`，三者**彼此独立**，所以能表达完整控制点（§19.0-1 的 2 / 4 / 6 例子）。

理由：
1. **旧数据逐位兼容**：现在 `pose.ts` 的求值是「画稿绝对控制点 + 插值后的偏移」，三个控制点加同一个偏移。迁移成 `dp = dIn = dOut = 旧偏移` 以后，用同一个公式「基准 + 插值后的差量」求值，**数值运算的顺序和现在完全一样**，结果能逐位相等。如果改存绝对坐标，插值 `lerp(a+o₁, a+o₂)` 和现在的 `a + lerp(o₁, o₂)` 浮点结果不同，做不到逐位。
2. **成熟依据**：Spine deform key 存的就是「相对 setup pose 的偏移」（<https://esotericsoftware.com/spine-json-format>，现有 `pose.ts` 注释已引）；现有「改画稿会传到所有角度」（`pose.test.ts` 第 3 项，选项甲）也靠这个。
3. 这就是 §15.5 里的「编码基准」：它是**一种存法**，不改变 §15 / §20 的语义（求值看到的永远是完整控制点）。§15.5 原先写「第一版不用」，这里改为第一版就用——**请 dot 判断**。
4. 加点 / 删点对差量照样成立：de Casteljau 拆分是线性的，差量和基准各自拆分再相加，等于拆分后的形状（浮点误差另报）。

## 1. 样例存档（JSON；只列 `document` 作用域的记录）

```jsonc
{
  "schema": { "contour": 2 },            // 1 → 2：多了下面 6 种记录；旧文档读入时迁移（§4）
  "records": [
    // ── 现有记录：不变 ──
    { "typeName": "container", "id": "container:L1", "name": "眼", "parentId": null, "index": "a1", "visible": true, "locked": false, "opacity": 1, "tags": [] },
    { "typeName": "curve", "id": "curve:lid", "name": "上眼睑", "parentId": "container:L1", "index": "a1",
      "anchors": {                       // 拓扑 + 编码基准（相对手柄，沿用现有约定）
        "a": { "id": "a", "p": { "x": -10, "y": 0 }, "hIn": { "x": 0, "y": 0 }, "hOut": { "x": 3, "y": -4 } },
        "m": { "id": "m", "p": { "x": 0, "y": -4 }, "hIn": { "x": -5, "y": 0 }, "hOut": { "x": 5, "y": 0 } },
        "b": { "id": "b", "p": { "x": 10, "y": 0 }, "hIn": { "x": -3, "y": -4 }, "hOut": { "x": 0, "y": 0 } } },
      "segments": [ { "id": "s1", "from": "a", "to": "m" }, { "id": "s2", "from": "m", "to": "b" } ],
      "closed": false, "stroke": { "color": "#000", "width": 2 }, "depthOffset": 0, "tags": [] },
    { "typeName": "curve", "id": "curve:strand", "name": "侧发", "parentId": "container:L1", "index": "a2",
      "anchors": { "...": "画在 90° 时的位置；作为它的编码基准" },
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
      "original": { "a": { "dp": [0, 0], "dIn": [0, 0], "dOut": [0, 0] }, "m": { "dp": [0, -0.5], "dIn": [0, -0.5], "dOut": [0, -0.5] }, "b": { "dp": [0, 0], "dIn": [0, 0], "dOut": [0, 0] } },
                                                       // 无 yaw 原稿（相对编码基准）；null = 只登记身份、没有原稿
      "yaw": [                                          // 角度键：任意正负，按 yaw 排序、唯一；范围外夹取
        { "yaw": -60, "d": { "a": { "dp": [-4, 0], "dIn": [-4, 0], "dOut": [-3.6, 0.2] }, "...": "每个锚点三个独立差量" } },
        { "yaw": 0,   "d": { "...": "0° 显式形态，可以 ≠ original" } },
        { "yaw": 90,  "d": { "...": "" } } ],
      "expr": {                                         // 表情：每个参数一条自己的稀疏轨道（§20.3）
        "blink": [
          { "yaw": 0,  "kind": "author", "target": { "...": "完整目标（差量）" }, "ruleVersion": 1 },   // 预设修正 = target − 规则(预设在该角的中性形态)，重建时按 ruleVersion 的规则算
          { "yaw": 90, "kind": "rule" } ] } },            // 规则键：只有表情基准
    { "typeName": "forms", "id": "forms:preset:Q/curve:lid", "curveId": "curve:lid", "owner": { "kind": "preset", "id": "preset:Q" },
      "original": { "...": "" }, "yaw": [ { "yaw": 0, "d": { "...": "" } }, { "yaw": 45, "d": { "...": "" } } ],
      "expr": { "blink": [ { "yaw": 45, "kind": "rule" } ] } },
    { "typeName": "forms", "id": "forms:preset:P/curve:strand", "curveId": "curve:strand", "owner": { "kind": "preset", "id": "preset:P" },
      "original": null,                                  // 只在 90° 画过：无 yaw 上下文里报缺失（§20.2）
      "yaw": [ { "yaw": 90, "d": { "u": { "dp": [0, 0], "dIn": [0, 0], "dOut": [0, 0] }, "w": { "...": "" } } } ],
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
      "fineTune": { "curve:lid": { "m": { "dp": [0, -0.8], "dIn": [0.3, -0.8], "dOut": [-0.3, -0.8] } } },   // 正脸微调：叠在预设混合上的控制点偏移
      "takeovers": [
        { "kind": "line", "curveId": "curve:lid", "owner": "character", "state": { "yaw": 90 }, "range": { "from": 0, "to": 90 },
          "target": { "...": "接管时的完整目标（差量）" }, "basisFront": { "...": "接管时的角色正脸（差量）" },
          "L": [0.42, -0.07, 0.11, 0.9] } ],              // 冻结的 L：之后只用它传递（§15.2），不重新拟合
      "exprFixes": [
        { "curveId": "curve:lid", "state": { "yaw": 90, "blink": 1 },
          "target": { "...": "" }, "base": { "...": "当时的表情基准" }, "ruleVersion": 1 } ] },   // 角色修正优先，不叠预设修正

    // ── 新：显隐（形状和显隐分开） ──
    { "typeName": "visibility", "id": "visibility:preset:P/curve:strand", "curveId": "curve:strand",
      "owner": { "kind": "preset", "id": "preset:P" }, "mode": "step",
      "keys": [ { "yaw": -90, "visible": false }, { "yaw": 30, "visible": true } ] },

    // ── 迁移来的旧数据（§4）：旧 pose 记录 → document 归属的 forms ──
    { "typeName": "forms", "id": "forms:document/curve:C1", "curveId": "curve:C1", "owner": { "kind": "document" },
      "original": { "a1": { "dp": [0, 0], "dIn": [0, 0], "dOut": [0, 0] }, "...": "全部为 0：旧画稿就是原稿" },
      "yaw": [ { "yaw": -30, "d": { "a1": { "dp": [-2, 1], "dIn": [-2, 1], "dOut": [-2, 1] }, "...": "旧偏移原样复制到三个差量" } } ],
      "expr": {} }
  ]
}
```

## 2. 每样东西归谁

| 东西 | 记录 | 块（§15.1） | 谁写 |
| --- | --- | --- | --- |
| 拓扑（锚点 / 段身份）+ 编码基准 | `curve`（现有） | — | 结构命令（阶段 2）；旧 `moveAnchors` 等不传新目标时照旧改它（§22.6 第 7 项） |
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
- 锚点在某个差量里缺项：**不合法**（新记录要求每个键列出全部锚点；旧 `pose` 的「缺项 = 0」只在迁移时按旧语义补齐）。

## 4. 迁移（schema 1 → 2）
1. 每条旧 `pose` 记录 → 一条 `forms`（owner = document）：`original` 全 0；每个旧键 → 一个角度键，旧偏移 o 复制成 `dp = dIn = dOut = o`；旧键里缺的锚点补 0（旧语义「缺项 = 0」）。
2. 旧 `pose` 记录删除；之后 `setPoseKey`（不传新目标）改写 `forms:document/…`，语义不变。
3. 验收：迁移后**真正读 `forms` 求值**（不留旧路径），每个旧测试文档在每个记录角度、键之间、范围外的结果与迁移前**逐位相等**；求值路径里不再有 `pose` 记录。

## 5. 请 dot 审的点
1. §0 编码基准（差量存法）是否接受；它让 §15.5「第一版不用编码基准」改为「用曲线记录作编码基准」。
2. `forms` 一条记录装一个归属者对一条曲线的全部状态（像现在的 `pose`），还是按状态拆成多条记录。我倾向一条：和现有 `pose`、Spine 每个附件一条 deform 时间线一致，撤销 / 依赖检查的单位清楚。
3. 角色的接管和表情手修放在 `character` 记录里（一条），还是各自独立记录。我倾向放在 `character` 里，归属和删除角色时的依赖都简单；代价是改一条接管要重写整条角色记录（和现在改一个锚点重写整条曲线一样）。
4. 族登记要求「每个预设对每条族曲线都有 `forms`」，缺记录 = 存档不合法，以区别于「有记录但只登记身份」。
