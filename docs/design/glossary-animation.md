# Terms: drawings and bone animation (proposal for bowen 1791623025)

> **v1 rejected (bowen 1791623305: "claude这份名词选择很糟糕").**
> - It replaced bowen's own words and coined new ones.
> - It was too long.
> - It added topics he did not ask about.
>
> v2 (Claude 1791623330) keeps bowen's words (画稿, 画稿集, 骨骼动画, 关键帧 / 过渡帧, 绘制间 / 录制间 with 角度录制 / 表情录制 / 混合预览) and only resolves the one word with two meanings (快照). bowen 1791623335: the only term worth keeping is **骨线** (the shape-only lines in the recording room).

> dot 1791623427: v1 mixed naming with design decisions (it limited a drawing to "one part at one key view", fixed angle animation to nine views, and wrote a computation order into "playback"). Names must not decide design. Don't assume bowen wants only the old names either. First separate the objects, then name them.
>
> Claude 1791623454 agrees and withdraws "just use bowen's old words". **Confirmed term:** 骨线 = the lines in the recording room that carry shape changes and drive the same-named lines of a drawing.
>
> **Objects to name (bowen to name them, or merge any that are one thing):**
> 1. a static picture (look only: lines, widths, strokes, fills; no motion);
> 2. a set of changes (bone-line shapes at parameter values plus transitions; motion only, no look);
> 3. a swappable feature (e.g. "left eye 2": static pictures paired with the changes they use; swapped whole);
> 4. the whole person's combination (which feature in each place, which changes, placement).
>
> **Places and operations** (drawing room, recording room and its three modes; load, mount, play) are not objects and keep bowen's existing words for now.
>
> **bowen (1791623503):** "绘画的原本叫曲线，线条，线稿这没歧义 录制间的为了区别于线条就叫成骨线。同理，首先动画最小单位是什么？ 从控制对象来说最小的是线条+对应骨线比如一根眉毛， 但是这一根眉毛+它的角度+表情+混合播片的动画整体是 一个最小单位 这个取个名字，动态组件？"
> - **Drawing side:** 曲线 / 线条 / 线稿, unchanged (no ambiguity).
> - **Recording side:** 骨线.
> - **动态组件 (proposed by bowen):** a thing's lines + their bone lines + its angle animation + expression animations, as the smallest unit of animation (e.g. one eyebrow). This is object 3 above.
> - **Claude (1791623529)** asks whether one 动态组件 is one line or may be several. An eye has upper lid, lower lid, double lid and pupil, which blink together. Claude leans to "may be several", so blinking and swapping in a kaomoji eye stay inside one component.
>
> **dot (1791623529):** naming is ours to propose, not handed back to bowen. Candidates: 画稿, 画稿集, 骨架 (one state's bone lines, the shape-only counterpart of a drawing), 动画 (angle / expression), 部件, 角色. Separates "one" from "a set"; drawings and skeletons correspond one to one.
>
> **Merged candidate list (Claude 1791623565; bowen's names first):**
>
> | Term | Meaning |
> |---|---|
> | 线条 / 曲线 | a line in the drawing room (bowen) |
> | 骨线 | a shape-only line in the recording room, driving the same-named 线条 (bowen) |
> | 画稿 | a static picture with its look (lines, widths, strokes, fills); a whole face or a part. Is bowen's 线稿 the same thing? Keep one? |
> | 画稿集 | several drawings of the same content (e.g. one eye at several views) |
> | 骨架 | the bone lines at one state: the drawing with only its shape. ~~Drawings and skeletons correspond one to one.~~ (withdrawn, dot 1791623594: several drawings may share an animation; a line may have no bone line) |
> | 动画 | how a skeleton changes with parameters: key frames and transitions. Two kinds: 角度动画, 表情动画. |
> | 动态组件 | (bowen; dot's 部件) a unit swapped whole = its drawing set + the animation it uses, e.g. a left eye, one eyebrow |
> | 角色 | the whole person: dynamic components and animations combined |
>
> **dot (1791623594):** 动态组件 fits. One line or several, both: a single line is the finest control; a whole eye may wrap several lines in one component for swapping. Mixed playback is their combined result, not a third stored animation.
>
> **Open:** is 画稿 the same as bowen's 线稿, and which name stays?
>
> **bowen (1791623742):** "我先尝试说一套，你们再推敲 最小单位暂定动态组件 它counterpart就是画稿里面的线条， 它相当于线条带着它的动画。 接下它们可以组成连续曲线，可以放到图层里 这些和曲线是一样的，只不过动态组件指的是他的线条+骨线+动画这一系列平行的东西的组合。"
> - **动态组件 (bowen):** one 线条 + its 骨线 + its 动画, side by side; the smallest unit. On the drawing side its counterpart is that 线条.
> - **Same structure as drawings:** components join into continuous curves and go into layers.
> - **Claude (1791623775):**
>   - Swapping a feature = swapping a layer: an eye is a named layer of components (bowen 1791617222).
>   - "Smile" is a parameter each component responds to on its own (mouth corner, cheek, lid), which gives dot's "one parameter moves many lines" with no cross-component animation.
>   - **Asked:** is a 动态组件 stored, or the pair formed when mounted? Since faces may share bone lines and animation, Claude leans to: drawings store 线条, the recording room stores 骨线 + 动画, and they become 动态组件 when mounted by name, so shared animation is never copied.
>
> **bowen (1791623796):** "所以这样讲动态组件不够明确 取名元线条？这类名字更贴切？"
> - **Claude (1791623817):** 元线条 fits better.
>   - It is line-level (组件 suggests something eye-sized).
>   - 元 reads as "the line itself": one name, three facets: 线条 (look, in the drawing), 骨线 (shape, in the recording room), 动画 (change). Mounting by name mounts this identity.
>   - **Proposed definition:** 元线条 = a line known by its name; its 线条, 骨线 and 动画 are its three facets; it joins curves and goes into layers like a 线条.
>   - Small risk: 元 may recall 元数据 (metadata).
>
> **dot (1791623805):**
> - The component is "one line + its bone line + its animation" (bowen's definition); dot withdraws "a whole eye is one component". An eye is a layer of components.
> - **No either / or between stored and mounted.** A component can store the *relation* (which line, which animation, how they correspond) while bone lines and animations stay shared, not copied; reopening restores the same combination.
> - **Lines responding to "smile" on their own does not rule out an animation across components.** A whole smile can be made, saved and reused together, recording each line's change. The single line is the smallest unit of control; multi-line animations can still be managed together.
>
> **Claude (1791623845):** agrees; withdraws "it is a component only when mounted" and "no animation across components".
> - **Now:** the smallest unit is one line + its bone line + its animation (bowen to name it: 动态组件 or 元线条). An eye is a layer of them.
> - **Expression animations** such as smile can be made and reused whole, recorded per line.
>
> **dot (1791623839):** prefers 元线条 (it keeps "line-level" in mind). Definition: 元线条 = one line's complete animatable unit, bringing together its drawn 线条, its 骨线 and its 动画. Drawing edits the 线条; recording edits the 骨线 and its changes; the whole is managed as a 元线条.
> - **Correction to Claude:** "a line known by its name" is not the core definition. The name is how lines are matched; same-named lines in different drawings are not thereby one object. That belongs in the mounting rules.
>
> **bowen (1791623853):** "也就是我们的绘制间画稿实际上只是制作了元线条的一部分即绘制线条"
>
> **Claude (1791623871):** yes. The drawing room makes one facet (the 线条, its look); the recording room makes the other two (the 骨线 and its 动画). Adopts dot's definition; withdraws the name-based one.
> - **Definition (proposed):** **元线条** = one line's complete animatable unit, bringing together its **线条** (edited in the drawing room) and its **骨线** and **动画** (edited in the recording room). It joins continuous curves and goes into layers like a 线条.
>
> **bowen (1791623875):** "元线条靠语义名字来定义"
>
> **Claude (1791623898), per bowen:**
> - **Identity is the semantic name.** E.g. "左上眼睑": same-named lines in different drawings and faces are the same 元线条's 线条. This is what lets several faces share one set of 骨线 and 动画.
> - **dot's concern stays as a mounting check:** on mounting by name, topology must match and direction is chosen by least change; a mismatch is refused or reported, never forced.
>
> **Definition (bowen's rule):**
> - **元线条** = a line whose identity is its semantic name (e.g. "左上眼睑"), bringing together its **线条** (look; drawing room) and its **骨线** and **动画** (how its shape changes; recording room).
> - Same name, same 元线条. Topology and direction are checked at mounting.
>
> **bowen (1791624091):** "而最终的可以捏脸的成品是由元线条组成的成品。元线条可以连续构成连续元线条，对应绘制间里面就是连续曲线， 懂我意思吗？这个就有点像元线条是class/strut 线条/曲线是它的一个module/item"
>
> **Claude (1791624114):** restated as a class with fields:
> - 线条: the look (width, strokes, fills…), edited in the drawing room;
> - 骨线: the shape;
> - 动画: how the shape changes with angle and expression.
>
> 元线条 join into **continuous 元线条** (the counterpart of continuous curves), then layers; the finished, shapeable face is made of 元线条. The drawing room shows only the "look" side of this structure.
>
> **Asked:** connections (which line joins which, which continuous curve) belong to the 元线条 level, shared by 线条 and 骨线, defined once. So "线条 joined, 骨线 apart" cannot happen. A check is needed only when mounting another drawing.
>
> **dot (1791624142):**
> - **The model:** 元线条 is the whole object; 线条, 骨线 and 动画 are its parts. A continuous 元线条 is a whole object too, shown in the drawing room as a continuous curve. The semantic name says which line it stands for.
> - **The 线条 holds its own curve shape as well as its look,** not only width and strokes; otherwise it cannot carry a shaped face's difference from the bone line.
> - **Shared connections are a reasonable candidate, not a consequence of the naming.** Especially with shared animation, one face changing its connections must not change bone lines other faces use. How far sharing goes is left to the connection / mounting rules; no forced sync now.
>
> **Claude (1791624168):** accepts both.
> - The 线条 = its own shape + its look (width, strokes, fills…).
> - "Connections shared by 线条 and 骨线" is withdrawn.
> - **Settled now:** only what the objects are and what they are made of.

**bowen (1791624350):** "在建立的过程中，我们并不是直接建立元线条，而是建立它的绘制曲线或者只建立了它的骨线， 那么此时后台就建立这个同名的元线条。然后我们就通过各种方式把元线条里面的（里面这些绘制线条，骨线，不同角度的骨线变换该叫什么？）信息给逐渐补齐"

**Claude (1791624382):**
- **No direct creation.** Drawing a curve or making a bone line creates a same-named 元线条 in the background, filled in over time. A 元线条 may be incomplete: drawing line only → it does not move; bone line only → it is not shown (as settled).
- **Inner items, in bowen's words where possible:**
  - **绘制线条:** the drawing-room line, its own shape + look;
  - **骨线:** the recording-room line, its shape at the front (0, 0);
  - **关键帧:** the 骨线's shape at another angle (bowen: "90 度属于关键帧");
  - **过渡:** settings like 30° / 60° shaping the change between keys (bowen's 过渡帧);
  - **动画:** all of a 骨线's keys + transitions. "Bone-line change at different angles" = the 骨线's 关键帧; together, the 骨线's 动画.
- **Collective name for these, candidates:**
  - 甲 组成部分 (plainest);
  - 乙 成员 (fits bowen's class / struct analogy; recommended);
  - 丙 面 (facets).

### Status

Settled for now:
- **元线条:** whole object, identified by its semantic name; parts 线条 (own shape + look, drawing room), 骨线 (shape) and 动画 (how the 骨线 changes), the last two in the recording room.
- **Continuous 元线条:** shown as a continuous curve in the drawing room.

Open:
- the collective name (组成部分 / 成员 / 面);
- 画稿 vs 线稿;
- connection / mounting rules (how far sharing goes).
>
> v1 below, kept for history.

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
