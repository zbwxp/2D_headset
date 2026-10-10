# Terms: drawings and bone animation (proposal for bowen 1791623025)

> **v1 rejected (bowen 1791623305: "claude这份名词选择很糟糕").**
> - It replaced bowen's own words and coined new ones.
> - It was too long.
> - It added topics he did not ask about.
>
> v2 (Claude 1791623330) keeps bowen's words (画稿, 画稿集, 骨骼动画, 关键帧 / 过渡帧, 绘制间 / 录制间 with 角度录制 / 表情录制 / 混合预览) and only resolves the one word with two meanings (快照). bowen 1791623335: the only term worth keeping is **骨线** (the shape-only lines in the recording room). Waiting for bowen's specifics. v1 below, kept for history.

bowen asked for one set of terms for the "drawing + bone animation, three modes" framework (Q32), because 线稿 / 画稿 / 快照 / 画稿组 / 录制间 had become confusing. One meaning per term; each retired word maps to its replacement. Proposal by Claude; to be reviewed by dot and decided by bowen.

## The terms

| 中文 | English | Meaning |
|---|---|---|
| **线** | line | The smallest unit: one Bézier curve with a unique name (graph, Names). |
| **画稿** | drawing | What one part looks like at **one key view**: lines with width, end strokes, fills, show / hide. Edited in the drawing room. |
| **画稿集** | drawing set | All drawings of one part at its key views. Same-named lines across them are the same line. |
| **骨线** | bone line | A line in an animation: shape only, no look. It drives the same-named line of a drawing. |
| **参数** | parameter | A control with id, min, default, max and the meaning of +. E.g. yaw, pitch, left eye open, smile. Face tracking or an animation gives its value. |
| **关键帧** | key | The shapes of the bone lines at one fixed set of parameter values (e.g. yaw 90°, pitch 0°). Drawn by bowen. |
| **过渡** | transition | How the shape changes between two keys (e.g. a setting at 30° or 60°). Defines no new look. |
| **角度动画** | angle animation | A part's bone lines at its key views (the nine views), with transitions. The first level. |
| **表情动画** | expression animation | A change of bone lines relative to a stated base, driven by one expression parameter (blink, smile…); may differ by angle; may span several parts. The second level. |
| **组合补丁** | combination patch | An extra key for one angle × expression combination that is generally wrong. Off by default; inside the expression level. |
| **部件** | part | A swappable feature (left eye 2, mouth 1…): its drawing set, plus the angle animation it uses (shared or its own). |
| **槽位** | slot | A place in a character: left eye, mouth, jaw… |
| **角色** | character | The assembly: which part in each slot, which expression animations, placement (position, size, rotation, front / back), and the character's own offsets. |
| **偏移** | offset | How a part's drawing differs from the shared bones it uses; carried through the angles by a rule (to be validated). |
| **专属动画** | own animation | An angle animation made for one part when the shared one is not good enough ("fixed" from offsets). |
| **载入** | load | One edit, line by line, between a drawing and an animation: same-named lines take the source's shape; missing lines are copied in; nothing is deleted. |
| **挂载** | mount | Attaching an animation to a part by line name: the same topology, direction by least change (graph, Apply). |
| **播放** | playback | Given parameter values, compute one picture: angle animation + expression animations (+ patches), then placement, then each drawing's look. |
| **接入层** | adapter | Turns face-tracking or other input into our parameters: names, directions, ranges, calibration. Outside the model. |
| **快捷表情** | hotkey expression | A button that sets parameters to preset values (or swaps a part), with a fade. |

## Rooms and modes

| 中文 | English | Meaning |
|---|---|---|
| **绘制间** | drawing room | Where drawings are edited (today's editor). |
| **动画间** | animation room | Where animations are edited and played, in three modes. |
| ↳ **角度模式** | angle mode | Edit one part's angle animation, explicitly chosen. |
| ↳ **表情模式** | expression mode | Edit one expression animation, explicitly chosen, at the current angle. |
| ↳ **预览模式** | preview mode | Turn every parameter and watch the result. Read-only; to fix something, choose its animation and switch mode. |

## Retired words

| Retired | Use instead |
|---|---|
| 线稿 | 画稿 (one view of a part) |
| 快照 / 绘制快照 | 画稿 (a drawing) |
| 录制快照 | 关键帧 (one key) or 角度动画 (all keys of a part) |
| 录制集 / 一套录制快照 | 角度动画 |
| 画稿组 / 画稿集 (of a whole face) | 部件 (per part); a whole face is a 角色 |
| 变形器 | 骨线 (one line) or 角度动画 (all of a part) |
| 变形域 | not stored; "batch editing of bone lines" |
| 录制间 | 动画间 |
| 混合间 | 预览模式 |
| 动作资产 | 表情动画 |
| 部件资产 | 部件 |
| 组装方案 | 角色 |
