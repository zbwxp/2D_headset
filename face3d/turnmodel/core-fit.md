# 转头模型 × core: how the bone-line model fits (design, no code yet)

bowen 1792856309 / 1792856339 / 1792856368 / 1792856383: the turning head becomes **one bone layer** with well-named continuous
curves and implicit occlusion. Every other layer is drawn only at 0,0 and attached to those bones (绑骨); other angles are
generated. The face outline gets a 「标准脸轮廓」 layer made by 「从骨线复制」, where widths and ends are edited. Rarely, a side line
is touched at 90,0.

Facts below are from core/v1 (file:line), read 2026-10-24. Nothing here is decided until bowen chooses (§5).

## 1. What core already has that fits

| Need | Core today | Where |
|---|---|---|
| bone lines in one layer, attach lines to them | a bone is an ordinary line marked in `bones`; 绑骨 `{line, bone, base}`; attached lines carried by bone coordinates, refit as one cubic (fit limit 2 % of length) | src/bones/index.ts:11-40, 170-191; coords.ts:1-7, 274, 295 |
| draw only at 0,0, others generated | mode 捏脸: only 0,0 edited, side bones from a standard; side views' attached lines always generated | docs/bone-lines-checklist.md §0-§2; bones:327-333 |
| one standard for the whole head | a part = a layer; 「存为标准」 saves the layer's bones in the nine views | bones:76, 108, 127 |
| named curves | true name 图层·连续曲线·线; a continuous curve is a group | src/names/index.ts:3, 22, 60-61 |
| any angle between views | per control and axis, a response remaps the weight along an edge: knots `[progress, value]`, any finite value, ≤ 256 knots; inside a cell the Coons patch | src/evaluate/index.ts:51-66, 100-132, 165-179; animation:111-128 |
| attached lines between views follow their bones | P0 `followBones` (display only, bench switch off by default); P1 (Model.bones, archive v16) planned, not built | src/bones/pose.ts; document:907-938; docs/bone-poses-checklist.md §8 |

## 2. Where the turn model does not fit as it is

1. **Angles.** Core has nine views, yaw −90 / 0 / 90 × pitch −45 / 0 / 45 (views:8-20), and is linear in yaw between them unless a
   response is given. The turn model is keyed at 0 / 45 / 90° and continuous (smooth outline, rigid sheet, eye rules, ears).
2. **Rules vs positions.** Core stores positions per view and remaps the blend; it has no slot for a rule evaluated at an angle
   (`afterBlend` is an identity placeholder, ledger row 9).
3. **Eyes.** The turn model's eyes are sphere-frame maps of samples; core bones are cubics, so each angle's eye bone is a refit.
4. **Occlusion.** The turn model has its own rules: the outline vs the side face, the far eye inside the outline and outside
   the side face, the fold (turned past edge-on), and the far ear outside both. The bench's 隐式遮挡 is glue keyed by layer name
   (bench/src/app.tsx:419-462), with no rule for ears, folds or attached lines.
5. **线上点 and the 假线.** The ear points' on-line rule and the 假线 (a guide bone never drawn) exist only in the turn model or
   in bench glue (bench:226-298; ledger 28-29).
6. **Pitch.** The turn model has no pitch; core requires the ±45 pitch views.
7. **从骨线复制** does not exist anywhere (grep: src, bench, docs).

## 3. Two ways to bring the turn model in

**A. Bake it (no core change).** A script writes the bone layer into a bench file. The bones' positions go in at the nine
views, and the turn model's in-between motion goes in as responses on the 0→±90 edges. One knot every 1–2° per control and
axis encodes x(yaw) exactly at the knots: on an edge a control is F + w·(Y − F), so w = (x − F)/(Y − F). The heights are kept,
so only x needs knots. Re-baking from model.json changes nothing for attached lines (they follow the bones).
- Limits: a control whose x is the same at 0 and 90 cannot take a response on that axis (w undefined). Such controls are found
  and listed when baking; a small offset or a refusal follows, never a silent change. The rules become numbers: changing a
  parameter means re-baking. In-between, attached lines follow their bones only through P0 / P1 (§1).
**B. Core evaluates the rules.** The bone layer's pose comes from the turn model at any angle (the afterBlend slot or P1's
Model.bones). The rules stay live, at the cost of a core change: archive, settle and the bones pipeline all need it.

Recommended: **A first.** It uses what core and the bench already do, it can be checked against the turn model at every
degree, and B stays open later.

## 4. What else is needed either way

- **One bone layer** 「转头骨线」: the outline (近2远3), the side sheet (6), the eyes (3 + 3), the ears (2 + 2), the 假线 (2, a bone
  that is never drawn). Names are bowen's: 连续曲线 = part, 线 = segment.
- **Occlusion as a rule of the bone layer**: each bone carries its show rule (the turn model's `Show`), and an attached line
  takes its bone's rule. This extends the bench's 隐式遮挡 from layer names to bone rules, as glue first; it moves to core only
  when the graph says so.
- **从骨线复制**: copy the chosen bones into a new layer as ordinary lines, each attached to its source bone. Widths and ends
  are then edited there.
- **Pitch ±45**: no model yet (§5).

## 5. For bowen to choose

1. A (bake) or B (core evaluates)? Recommended: A.
2. Pitch ±45 views for now: (a) copies of the pitch-0 row (the head does not nod yet), or (b) left for a pitch model later.
   Recommended: (a).
3. Occlusion for attached lines: they inherit their bone's rule (recommended), or each semantic layer sets its own.
