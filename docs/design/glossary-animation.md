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

**dot (1791624530):**
- "成员" for the inner items, matching the class / struct analogy. A 元线条 may start with one member and fill in later.
- **骨线** is the driving curve, not limited to the front one.
- **Keys correspond to parameter values, not times.** E.g. "the 骨线 at 90°" is a key frame; "how it goes from 0° to 90°" is the transition; together they are the angle animation. Expression animations likewise.

**bowen (1791624530):** "嗯那就叫成员吧…… 然后这个元线条 它只是"横向"组织起各种成员的容器，它本身并不是很高级的框架层级。与他这个横向相对应的是纵向-连续线条，图层，图层组合，线条联动 这些都是"纵向"概念。这个你们看我说清楚没有？"

**Decided (bowen):** the inner items are called **成员**.

**Claude (1791624556):** clear. Two directions:
- **Horizontal:** one line's members side by side in a 元线条 (绘制线条, 骨线, 动画). The 元线条 is only the container, not a high framework level.
- **Vertical:** how lines are organised among themselves (continuous lines, layers, layer combinations, line links such as end-point links and mirror links).
- Horizontal answers "what members does this line have"; vertical answers "how do these lines make a face". Neither replaces the other.
- dot's corrections are accepted (骨线 not only the front one; keys at parameter values).

**bowen (1791624638):** "元线条按照名称组成了横向， 原本的连续曲线 图层之类的是纵向，这个一套算是一个框架设计原则。你们攻击一下看看"

**Claude's attack (1791624683), most serious first:**
1. **Default names mismatch.**
   - Every line has a name; unnamed ones get defaults ("曲线 4"). Two unrelated drawings each with a "曲线 4" would match by name and take each other's bone line and animation.
   - v1's principles said the opposite: "不能根据名称……自动把两个不同成员认作同一个成员" (editor-snapshot-recording-principles.md:42). This is a deliberate reversal and should say why.
   - **Proposed:** only *semantic* names (ones bowen gives, like 左上眼睑) take part in matching; default-named lines do not match, and count as "no 元线条 yet".
2. **Who owns the vertical structure.** 绘制线条 have joins (shared end points, continuous curves); 骨线 need joins too, or a jaw and a chin bone move apart and the seam opens.
   - A vertical structure on each side may disagree (drawing joined, bones apart).
   - One structure at the 元线条 level clashes with sharing (dot 1791624142): one face changing joins would change others'.
   - The principle does not settle this; it needs its own rule.
3. **A member kind may have several copies in one 元线条.** "左上眼睑" holds the front drawing's line, the side drawing's line, character 2's line…; bone lines may be one shared and several own. Horizontal is not "one 线条 + one 骨线 + one 动画". What tells copies apart (character, view)?
4. **Renaming and splitting cross the horizontal.**
   - Renaming a line moves it to another 元线条 and detaches its bone line and animation: follow, or detach?
   - Splitting a 绘制线条 must split its 骨线 and 动画 too, or correspondence breaks. v1 passed parent splits down by position (facts doc).
5. **Where a whole expression set lives.** A whole "smile" (dot 1791623805) spans many 元线条. It is neither horizontal (one line's members) nor vertical (how lines are organised); perhaps a third direction, organised by parameter.

1 and 2 first. dot asked to add attacks.

**dot (1791624722):** the principle holds (horizontal = one line's members, vertical = relations between lines). What fails easily is "which data does one edit change".
1. **Scope of a name.** Two faces' "左上眼睑" share a meaning, but editing 甲 must not change 乙. Semantic correspondence must be told apart from the data each instance actually uses; default-name collisions are the same issue.
2. **Who owns an edit.** Dragging an eye corner could change the 绘制线条, the angle animation or an expression animation. The container does not answer this; editing modes must name the target explicitly, and shared content must not change by accident.
3. **Propagation of structural changes.** What do splitting, deleting and renaming affect (members, views, references)? These rules are needed. In particular, splitting one face's line must not split an animation all faces share.

**Corrections to Claude:**
- A default-named line still gets its 元线条 (the auto-creation flow). It just has no cross-asset semantic correspondence yet; "no 元线条 yet" is withdrawn.
- 骨线 and 绘制线条 not sharing joins does not have to crack: drawing-side join constraints can guarantee the result, given a stated settling rule.
- A whole smile across lines is organisation between lines (vertical) and links; no third direction.
- **Conclusion:** no reason to overturn the framework.

**Claude (1791624748):** accepts all three corrections. Two rules to add:
1. **Telling instances apart under one name.** Each face's own data is separate; default names take no part in semantic correspondence.
2. **For each kind of edit, which data it writes and what follows.**
   - Editing writes to an explicitly chosen target; shared data is never changed by the way.
   - Splitting, deleting and renaming state which members, views and references follow. Splitting one face's line never splits a shared animation.

**Restated for bowen (Claude 1791627260), after dot's corrections:**
- **The framework holds.**
  - Horizontal: one line's members by name in a 元线条.
  - Vertical: relations between lines (continuous curves, layers, layer combinations, line links).
- **Two rules to add:**
  1. **Instances under one name.** Each face's actual data is separate; default names create 元线条 but take no part in cross-drawing semantic correspondence. This deliberately reverses v1's "no automatic matching by name", relying on bowen's semantic names.
  2. **For each edit, which data it writes and what follows.**
     - The target is explicit; shared data is never changed by the way.
     - Splitting, deleting and renaming state which members, views and references follow.
     - Splitting one face's line never splits a shared animation.
- **Resolved:**
  - Separate joins for 骨线 and 绘制线条 need not crack, given a drawing-side settling rule.
  - Whole expressions across lines are vertical organisation and links.

**dot (1791627788):** the main conclusion matches (keep the framework; add "telling instances apart" and "which data an edit writes and affects"). Two items are not settled:
- **"Default names take no part in cross-drawing correspondence"** is a proposed safeguard, not yet confirmed by bowen.
- **Joins** have a feasible direction only, not a solution. How drawing-side constraints settle together with animation results must be stated.
- **"Semantically one 元线条" is not "merged into one data object".** So this need not reverse v1's identity principle; Claude's "deliberately reverses" overstated it.
- dot has not independently checked the ArtCraft research; it is Claude's alone.

**Claude (1791627810):** accepts all.
- **For bowen:** should default names take part in cross-drawing correspondence? Claude suggests no: only semantic names correspond.
- The two rules (instances under one name; what each edit writes and what follows, including how joins settle) remain open.

**bowen (1791634995):** "然后还是说回我们的元线条那一部分。抱歉我第三次让你们重复一下 元线条的横向和纵向那个框架你们攻击了之后有什么问题来着？ 有关命名， 我限制一下元线条的作用范围是一套"模型" 即一套元线条组成的可以播放角度 表情动画的 是一套模型。因此 一个捏脸就可以建立一套模型， 一套模型可以共用好几组元线条组成的眼睛 五官之类的。元线条可以组成元组件。元组件并没有框架上的意义，而是语义上 眼睛，耳朵，嘴1 咧嘴笑嘴2 虎牙嘴3 这种 三套元组件里面都可以有元上唇，但它们分别属于不一样的元组件 就可以区分成完全不相干的不同组件。而一个模型可以由嘴2 眼睛1 耳朵1 构成的。 嘴1嘴3可能互相复制粘贴元线条（不是剪切粘贴）这个是复用元线条的骨线表情效果之类的，复制不会被阻拦（也没原则会阻拦）。 这是建立整个捏脸器的过程。而在使用捏脸器runtime时， 它会是对一个模型的绘制线条捏脸， 捏完之后，后天会搜索和当前捏脸拓扑结构最相似的元组件集合，组成新模型，并且根据offset推导出新的绘制线条，反向更新骨线，进而更新成新模型。（捏脸会提供不同预设，而每一次捏脸，在没捏完的时候 是时时靠offset来推每个角度绘制线（也就是有个捏脸中间态 此时依靠offset做播片）一旦固定了捏脸 就记录成新的模型。（制作捏脸器时很多脸模型的建立过程估计也差不多，只是制作时多了可以反复微调绘制线，骨线的过程。） 在制作过程中会不断出现利用offset算新骨线，修改骨线，骨线反推绘制线，绘制线引导骨线的过程。也就是offset这个东西和计算 只有在模型发布时（模型调整稳定后）才会真正元线条统一，其他时候可能都是互相带着offset的。我这个需求描述你们尝试理解一下。"

**Claude (1791635050).**
- **Attack results repeated:**
  1. instances under one name;
  2. which data each edit writes and what follows.
  - Pending: default names; how 骨线 and 绘制线条 joins settle.
- **Understanding of bowen's description:**
  - **模型 (model):** a set of 元线条 that plays angle and expression animation; one shaping can make one model.
  - **元组件 (meta-component):** a semantic group of 元线条 with no framework meaning (eye 1, ear 1, mouth 1, wide-smile mouth 2, fang mouth 3). Same-named 元线条 in different components (元上唇 in mouth 1 and mouth 3) are unrelated.
  - **A model is a choice of components** (mouth 2 + eye 1 + ear 1). Several models may share one component.
  - **Reuse by copying:** copy (not cut) 元线条 between components, bringing their 骨线 and expressions. A copy is a new 元线条; nothing blocks it.
  - **Runtime shaping:**
    - The user edits a model's 绘制线条. Until fixed, offsets drive every angle (an intermediate state, played via offsets).
    - Once fixed, the back end finds the topologically closest set of components, derives new 绘制线条 from the offsets, updates the 骨线 back, and records a new model.
  - **Offsets** exist only during making and shaping; they unify on publishing a model.
- **This settles attack 1:** a 元线条's identity = its 元组件 + its name. Default names only count inside their own component.
- **Asked:**
  1. On publishing, are shaped components **copied** (originals untouched, since other models may use them) or **changed in place**? Claude recommends copying; this answers attack 2 for shared components.
  2. "Topologically closest": first the same 元线条 names and connections, then the smallest shape difference? (May be refined later.)
  3. Is identity = 元组件 + name right?

**dot (1791635121):** understood. "Model in progress" vs "published model": while making / shaping, 绘制线条 and 骨线 carry offsets and are adjusted and previewed; publishing fixes the adjustments into a new model, which then plays without those temporary offsets.
- 元组件 is a semantic grouping, not another geometric level. Mouth 1's and mouth 3's "上唇" each belong to their own component.
- Reuse is by copying whole 元线条 **and** by several models sharing a component; not "only by copying" (Claude's wording was too narrow).
- **Three result requirements:**
  1. **Publishing must not change the previewed result.** Removing offsets keeps angles, expressions and the transitions between them, not only the front or a few keys. This is what the fixing algorithm must be verified against.
  2. **The component search must not make the face jump.** "Same connection topology" and "similar shape" are separate: lines of the same number and connections can draw a completely different mouth. When another component set is used, check its difference from the preview.
  3. **Shaping one's own face does not change shared originals by default.** The changes become a new version used by the new model; other models keep the original. No need to ask bowen each time.
- **Identity:** the owning component tells mouth 1 from mouth 3. When one component is shared by several models, the shared original must be told apart from the copy in use. A same-name collision on copying may be disambiguated automatically or mapped; copying is not forbidden.
- How offsets are carried and fixed is ours to verify; bowen chooses no maths now.

**Claude (1791635149):** agrees (withdraws "reuse only by copying"); posted the three requirements to bowen. Requirement 3 was offered as the default for Claude's question 1. **Corrected (dot 1791635168):** it stays a proposal until bowen confirms; silence is not agreement. "Publishing does not change the face" is an acceptance target, not yet shown possible. Asked which part of the flow bowen wants next.

**bowen (1791637819), the making process** (summary; the original is in the Slack thread):
- **Structure:**
  - Drawing lines are named as drawn (renamable, unique). Drawing snapshots are the unit of batch loading.
  - 元线条 are created while drawing and belong to their layer's 元组件: **a layer is the unit of a 元组件**.
  - **A 元线条 has one id in every view**, for drawings and bones alike; views are different parameters of it.
  - **Nine views per drawing.** After the front is drawn, it is duplicated into nine views, one id per named line. Adding or deleting a line in any view adds or deletes it at the same place in all nine.
  - **A model** has 9 drawings, 9 bone layers and any number of expressions.
  - **A model is a combination of 元组件.** A 元组件 has 9 drawing layers, 9 bone layers and any number of expression-layer pairs. Each expression's 0 point is always the 0,0 front; its 1 point may have different pictures.
- **Flow:**
  - Draw the front.
  - Load it at 0,0 in angle mode, then make 90° etc.
  - In expression mode (all expressions start empty), choose the eye, set 0 and 1, and adjust the eye to closed. Eye 1 now blinks.
  - Check in playback mode at every angle.
- **When drawing and bones differ, the user chooses:**
  - **follow the bones:** the drawing reverts;
  - **derive the offset:** the bones at 0,0 take the new drawing and the offset is propagated to every view. After review, batch-load the bones in drawing mode so every view's drawing follows. Expressions are derived the same way.
- **Adding eye 2:**
  - 甲: copy model 1 into model 2 and change the eye. Duplicate storage.
  - 乙: in one model, copy eye 1 to eye 2 (drawings and bones, all views), reshape, hide eye 1, derive the offset. One model with eye 1 / eye 2 switchable.

**Claude (1791637879):**
- **Restated as above.** This answers part of attack 2: structural edits act on all views of the component, and the drawing / bone direction is an explicit user choice.
- **Asked:**
  1. Are the nine views yaw {−90, 0, 90} × pitch {−90, 0, 90}, with the diagonals drawn or derived first?
  2. Are expressions defined at the front only and carried to other angles by the angle level (no side-view expressions by default)?
  3. Is the eye 1 / eye 2 switch a model option (hotkey or shaping choice) or only show / hide while making?

**dot (1791637961):** the flow is clear.
- **Key new definition:** the nine views are one line's different shapes, not nine unrelated lines. Adding / deleting is synced, shapes are adjusted per view, and copying / hiding a whole eye covers every view.
- **The flow:** draw front → load angle bones → make the turn → make expressions → mixed preview. Eye 2 reuses eye 1's whole set, then adapts angles and expressions, and finally loads the checked bone shapes back into the drawings.
- **Three boundaries:**
  1. **"One id across views" only ties lines within one eye set.** Eye 2 copied from eye 1 needs new, independent identities, or editing eye 2 may change eye 1. Whether a drawing line and its bone share an id is not decided by this statement.
  2. **Keep the old bone baseline until the offset is derived.** "Load the new eye, then derive" must not overwrite the old baseline first, or the difference cannot be computed. One user operation; old values kept internally; commit after deriving.
  3. **Mark expressions not yet adapted.** After the angles change (or lines are added / deleted) and before expressions are adapted, show "expression needs adapting". Old expressions must not look synced.
- **Corrections to Claude:**
  - "Expression 0 point = front" does not imply expressions can only be made at the front (Claude's question 2 stays a question).
  - Duplicating into nine is initialisation, not nine correct views.
- **This makes "which data an edit writes and how it spreads" concrete.** The algorithms still need verifying.

**Claude (1791637989):** agrees; relayed the three boundaries to bowen. The three questions (nine views, expressions at the front only?, eye switching) are still open.

**bowen (1791638945):**
- **Expressions are made at the front by default;** other angles later if needed.
- **Process:**
  - Draw the front; generate nine copies (all front at first).
  - **For a side:** either pose the side lines in the drawing room, then load front and side into recording; or load the front into recording, pose the side there, then load the bones into the drawing's side view.
  - **The right side** comes from the left: apply the left to the right (one-to-one, a unique result), then mirror. Perhaps move the whole so both offsets match (viewport guides). Then load the bones at the right side; until then they stay the initial 0,0 bones.
  - **The plane:** yaw ±90; pitch perhaps ±45, so the coordinate starts at yaw 90, pitch 45.
  - **Diagonal (four-corner) faces** are derived from the yaw and pitch bones, adjusted, then loaded into the drawings. Together: a region of up / down / left / right and diagonal turns.
- **Why drawing and recording are separate:** drawing owns strokes, show / hide intervals and fill occlusion; recording bones only interpolate. Could be one, but separate is clearer.

**Claude (1791638981):**
- Restated as above.
- The left → right step is the graph's existing **mirror apply** (source reflected onto a same-structured target).
- Questions 1 (views; diagonals derived then adjusted) and 2 (expressions at the front by default) are answered.
- **Still asked:** question 3, eye 1 / eye 2 switching in the finished model or only while making.

**dot (1791639052):** both routes make sense. Drawing and recording each keep editable shapes and pass them by explicit loads; drawing also owns strokes, show / hide intervals and fill occlusion. The separation has a real use. Three points to tighten:
1. **The mirror's "unique result" needs a fixed correspondence and axis.** "The left view" is not "the character's left eye". Reflecting a whole left-side face may need left / right eyes and ears assigned by their pairing, not by the cross-view id alone. Moving the whole by guides is fine.
2. **Up / down / left / right cover a diamond.** A corner such as "turned 90° and raised 45°" lies outside it and cannot be interpolated from the four directions. A derived draft then adjusted is fine, but the method is undecided; the draft is not the answer.
3. **Loading bones into the drawing should update shapes only,** keeping the drawing's strokes, show / hide and fills, and marking what needs re-adapting after a shape change. Otherwise moving between rooms loses finished looks.
- **Scope:** expressions made at the front by default is bowen's explicit scope. Pitch ±45° is a candidate value, not fixed. Remaining algorithms and switching in the finished product need not be settled now.

**Claude (1791639078):** agrees; relayed. For point 1, the graph's mirror-link line pairs can provide the left / right pairing.

**dot (1791639097), wording:**
- Reusing mirror-link line pairs for the cross-view apply is a **candidate**. Their completeness and meaning must be checked, and a one-off apply does not mean a lasting link.
- "Loading bones updates shapes only, keeping the look" is **dot's suggestion**, recorded as a rule only once bowen confirms.

**bowen (1791639688):** "45度角上的视觉，可以用简单的形变相加（就是a向量+b向量等于其对角线向量）。然后一个模型里面 眼睛鼻子嘴有123456好几种预设，如果都画好 那接下来就是runtime的ui设计的事情了。尤其对那种变化特别大的眼睛形状 直接跳变捏脸（像脸萌那样选择脸 所以这个不是什么架构上的问题。还有什么不清楚的"
- **Diagonals:** the change at a diagonal = the yaw change + the pitch change (vector sum). A draft by addition, then adjusted.
- **Several presets per feature in a model** (eyes / nose / mouth 1–6): choosing among them is runtime UI (jump selection, like 脸萌), not architecture. This answers Claude's question 3.

**Claude (1791639726):**
- **Waiting for bowen:**
  1. shaping one's face publishes a new version, shared originals untouched (our proposal);
  2. loading bones into drawings updates shapes only (dot's suggestion);
  3. (minor) 线稿 vs 画稿.
- **Ours to verify:**
  - carrying / fixing offsets so publishing does not change the face;
  - the topologically-closest search without sudden change;
  - how joins settle between 骨线 and 绘制线条;
  - new identities on copy; the old baseline kept while deriving; "expression needs adapting" marks.
- **Offered:** draft graph rows for the whole framework (元线条, 元组件, model, rooms, nine views, expressions, offsets, publishing), written only when bowen says "写".

**bowen (1791640004):** "捏自己的脸那是runtime的事情可能的设计是直接复制一个预设模型 然后想换什么换什么。2 骨线 绘制互相load 是赋予 传递的只有4参数的信息也就是更改形状 其他的不做。（骨线里面应该也load填充和遮挡顺序，用来方便看效果。） 因此我其实有个疑问 就是如果只有笔触端点 链接笔触和显隐区间（还没定义）有区别 那么我真的需要区分绘制录制两个房间吗？（感官上觉得元曲线的信息太多，一个绘制间可能信息量过于爆炸，但是仔细一想好像没有什么区分的必要？ld人家也没区分。"
- **Decided (bowen):**
  - shaping one's own face is runtime; a likely design is copying a preset model and swapping freely;
  - load between 骨线 and drawing is an apply carrying only the 4 shape parameters (the bone side also shows fills and occlusion order, for viewing).
- **Asked by bowen:** are two rooms really needed?

**Claude (1791640048):**
- **Analysis:**
  - The two sides differ only in look (strokes, end strokes, linked strokes, show / hide intervals); both hold a shape per line per view.
  - In a published model there are no offsets, so drawing and bone shapes coincide at every key: two copies are redundant.
  - Two shapes only earn their keep when several faces share one bone set with offsets; bowen's "copy a preset model" replaces that sharing with copying.
- **甲 (recommended): one room.**
  - Each 元线条 has one shape per view, with its look on the same line.
  - Modes: look, angle, expression, playback.
  - "Derive offset" becomes an operation: after editing the front, choose "carry to other views" by the rule, or edit the front only.
  - Information load is handled by modes and display toggles (e.g. hide strokes while adjusting angles). Live2D also uses one editor with modes (from memory).
- **乙: keep two rooms.** Keeps "one bone set shared by many faces" possible, at the cost of loading two shapes back and forth (out-of-sync risk).
- dot's boundaries still apply (keep old values while deriving; mark expressions not adapted).

**dot (1791640067):** disagrees that "the second shape has no reason to exist". Copying a preset does not cancel sharing, and a mergeable finished model does not mean making needs only one shape.

**Claude (1791640082):** withdraws that claim. Two separate questions:
- **rooms:** one room with modes, or two;
- **data:** one shape per view, or two (drawing shape + bone shape, possibly offset).
They can be chosen independently (one room may still hold two shape layers). The recommendation is on hold until dot's analysis.

**dot (1791640119):**
- **One editing room with modes is fine.** Drawing shows look tools, angle shows view and shape tools, expression shows expression states, playback hides editing. Fills and occlusion still preview together. These differences do not need two rooms.
- **Do not merge away "an unconfirmed reshape" and "the original animation baseline".** One room can keep "original baseline + this pending change", updated on acceptance; two permanent independent shape sets are not required. Only if bowen needs two shape sets edited independently long-term and applied to each other at any time, keep two working copies.
- A published model can store without duplicates; that does not decide whether making keeps drafts.
- **The one experience question for bowen:** after enlarging an eye, should playback preview the change at once (revertible to the baseline), or keep playing the original until he explicitly applies the new shape?

**Claude (1791640145):** agrees; relayed, asking bowen to choose:
- A: preview at once, revertible;
- B: the original plays until applied.

**dot (1791640164):** "preview the new shape at once" does not mean every angle and expression has been derived; whether the change spreads to them is a separate rule. Don't bind the two.

**Claude (1791640186)** splits the question for bowen:
1. **The view being edited:** (1a) shows the new shape at once, revertible; or (1b) takes effect after confirming.
2. **Other angles and expressions:** (2a) derived live while editing; or (2b) only when he explicitly chooses "derive", unchanged until then.

They are chosen independently (e.g. 1a + 2b).

**bowen (1791640535):** "在runtime肯定是立刻用新形状显示 在模型制作时，应该也是希望立刻新形状。那么就一套多种模式吧。在我完成了一个既准模型之后，我想增添新眼睛，那么我复制眼睛命名为眼睛2 然后把眼睛1隐藏 然后开始专注修改眼睛2。然后0，0正脸相当于元线条修改，修改正脸的眼睛 其他视角的就都计算offset并且修改。（可以修改完成后点击广播到其他成员再广播 制作模型期间不用实时修改） 然后如果模型还没建立 相当于其他成员/视角的变形器为0 因此和0，0一样保持不变。"

**Decided (bowen 1791640535):**
- **One room, several modes** (no separate drawing / recording rooms).
- **The view being edited shows the new shape at once** (1a), both while making and at runtime.
- **While making a model,** other views and expressions update when he clicks "broadcast" after editing (2b), not live.
- **Adding an eye:** copy eye 1 as eye 2, hide eye 1, edit eye 2. Editing the 0,0 front edits the 元线条 itself; broadcasting carries the change to other views by offset.
- **Before other views exist,** their deformation **relative to the front** is 0. When the front changes, their final shape follows it and equals the new front (corrected per dot 1791640582; Claude's "broadcast does not change them" was wrong).

**Claude (1791640564):**
- Restated; reading of runtime shaping as 1a + 2a (live offset preview of every angle, per bowen 1791634995), for bowen to correct.
- Offered graph rows for the whole framework, written on "写".

**dot (1791640627):**
- **Confirmed against bowen's words:** one room with modes; the shape being edited shows at once; explicit broadcast while making. These three can be recorded as decided.
- **Wording:** views not yet made have no extra deformation, and after broadcast they still equal the new front. E.g. the front eye made bigger: the unmade side view also has the bigger eye, just without a side-turn shape yet.
- **Not to be widened:** runtime live derivation of every angle has an earlier basis, but "every expression derived live too" is not newly confirmed.
- **Broadcast's algorithm is still to be verified.** At least:
  - broadcasting eye 2 does not affect eye 1;
  - clicking broadcast again without new edits does not add the same offset twice.
- **Enough for a requirements draft.** But "one room" does not decide whether the underlying data stores one shape for good, or which of the old two-way load entries remain in the new modes.

**bowen (1791640911):** "什么叫底层永久只存一份形状？ 还有现在绘制和录制合并了就不分绘制线和骨线了。而是我们这个软件层面上，就是多视角编辑软件 绘制一个视觉自带9个视觉。在任意视角里增减线条都会同步增减。（并不一定在0，0增减。我可以在90度绘制侧鼻线，在0，0调整即可 反正侧鼻线肯定是占一个图层元组件都是相互独立的。"

**Decided (bowen 1791640911):**
- **No separate drawing lines and bone lines.** The software is a multi-view editor: drawing one view comes with nine.
- **A 元线条 has one shape per view (nine),** plus its look (strokes, show / hide, fills) and its expressions.
- **Lines can be added or removed in any view, synced across all nine.** E.g. a side nose line drawn at 90°, then adjusted at 0,0 (collapsed onto the axis). It lives in its own layer (元组件), independent of others.

**Claude (1791640941):**
- **"One shape" meant:** one shape per view, or two (drawing + bone, with an offset between). bowen answered: one.
- **Consequences:**
  1. **No more "load"** between rooms. What remains is **broadcast**: after editing a view, explicitly push the change to other views and expressions by offset.
  2. **Offsets are no longer stored long-term.** They exist only while broadcasting and for a pending change (baseline kept, revertible).
  3. **Asked:** keep the word 骨线 (for the per-view shape) or drop it?

**dot (1791640973):** the two shape sets are cancelled; "how many shapes underneath" is no longer open. A 元线条 has a shape in each of nine views; adding / removing in any view is synced; adjusting a shape in a view edits that view's shape. Corrections to Claude:
- **What is cancelled is the drawing ↔ bone load.** Cross-view apply and mirror apply stay, and they are not broadcast.
- **No drawing / bone offset does not mean every offset is only temporary.** Storing view shapes as full parameters or relative to a base is an implementation choice; no need to ask bowen.
- **Broadcast,** as stated, is "after editing the front, push to the other members". It is not "every edit in any view broadcasts". Otherwise fixing the side nose line at the front could change an already-drawn side view. How the side nose line is handled at the front stays "adjusted by hand", not fixed to "collapsed onto the axis".
- **骨线** is no longer its own object; say "the line's shape in a view"; no new name needed.

**Claude (1791640998):** agrees and withdraws all three points. Question 3 (骨线) needs no answer.

**bowen (1791642539):** "有没有可能骨线其实需要隐式储存， 否则如果我复制了眼睛2 然后在那里调整的过程中，掉线了 那么我岂不是就失去了眼睛2调整前的骨线 也就不知道怎么算offset广播到其他视角了？"

**Claude (1791642580), proposed:** yes, it must be stored **in the file**, not only in memory. Each 元线条 keeps a hidden **broadcast baseline**:
- **What it is:** the front shape at the last broadcast. Broadcast starts only from the front, so one shape, not nine.
- **On broadcast:** push "current front − baseline" to other views and expressions, then set the baseline to the current front.
- **Saved with the data,** so after a disconnect, close or crash the baseline is still there and broadcast still works.
- **Copying eye 1 to eye 2 copies the baseline as it is** (corrected per dot 1791642599; Claude 1791642620). Eye 2's other views are copied from eye 1 and match eye 1's *baseline*, not necessarily its current front. So eye 2 carries the same unbroadcast change and broadcasts it later. Setting eye 2's baseline to the current front would silently swallow that change.
- **Meets dot's two safeguards (1791640627):** a repeated broadcast with no new edit pushes zero; eye 2's baseline is its own, so broadcasting it does not touch eye 1.
- **Shown to the user only as a mark:** "edited, not yet broadcast".

**dot (1791642640):** supports a hidden, saved baseline (a basis for computing, not a bone set to edit). Two additions:
1. **Broadcast is atomic.** Updating other views, updating expressions and advancing the baseline succeed or roll back together, and undo together. Otherwise a break midway may skip a push or push the same change twice.
2. **If angles and expressions can be broadcast separately,** each must remember which change it has received. Advancing one baseline on the angle broadcast would leave unprocessed expressions without their old baseline. One shared baseline is enough only if everything is always broadcast together.
- **"Stored in the file" is not "nothing lost on a crash".** A completed save or an automatic recovery record is needed; current shapes, baseline and broadcast state are restored together.
- **Still to verify:** whether one front baseline suffices depends on whether broadcast is split; how "current front − baseline" is applied to side views and expressions remains a rule to verify.

**Claude (1791642667):**
- Point 1 fits core's existing edit transaction (one edit = all or nothing, one undo).
- An autosave / crash-recovery requirement may be recorded.
- **Asked bowen:** are angles and expressions always broadcast together (one baseline per line), or separately (each keeps its own "received" mark)?

**dot (1791642685):** wiring broadcast to the existing edit transaction is right. But "a failed edit rolls back" and "the file is whole after a process crash" are verified separately; passing the first does not guarantee the second. A one-step broadcast in the UI also needs saving and recovery to keep the whole state consistent.

**bowen (1791642767):** "表情角度各记各的吧。这个进入runtime就不用记了，绘制过程中文件稍微冗余一点无所谓"

**Decided (bowen 1791642767):**
- **Angles and expressions each keep their own "received" record (baseline),** so angles can be broadcast first and expressions later.
- **These records exist only while making;** some redundancy in the file is fine. A published model at runtime does not keep them.

**Claude (1791642785):** acknowledged.

**bowen (1791644874):** "然后有种情况是比如我想绘制一种眼型，但是我不知道现存的哪个离它最近/改动最小。这有任何方法进行match吗？"

**Claude (1791644920):** yes; the same tool as runtime's "topologically closest component" search.
1. **Same names and connections** (e.g. a copied eye then changed): "least change" is directly computable. Mount the new eye on each existing component, align position and size, and sum the per-point differences. The smallest offset is the closest. It is the same quantity broadcast computes.
2. **Different names or line counts** (a freehand sketch with default names): compare shape only.
   - Sample both outlines evenly into points.
   - Align them (move, scale, rotate if needed).
   - Measure the mean distance.
   - Known methods: Procrustes alignment, Chamfer distance (from memory, unchecked).
- **In use:** sketch → list the closest few eye components with a score → preview any one mounted on the sketch at every angle → copy the chosen one as a new component and refine. Coarse by shape (no names needed), then exact change size among same-topology candidates.
- **Offered:** a small experiment on existing eye data to check the ranking.

### Status

Settled for now:
- **元线条:** a horizontal container of one line's **成员**, identified by its semantic name: 绘制线条 (own shape + look, drawing room), 骨线 (the driving curve) and 动画 (key frames at parameter values + transitions). The last two are in the recording room. Created automatically when its first member is made; members are filled in over time.
- **Vertical concepts** (continuous lines, layers, layer combinations, line links) organise lines among themselves.
- **Continuous 元线条:** shown as a continuous curve in the drawing room.

Open:
- whether default names take part in cross-drawing correspondence (Claude suggests no);
- the two rules (instances under one name; what each edit writes and what follows, including how joins settle);
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
