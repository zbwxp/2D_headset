# 骨骼线 (bone lines) — checklist before any code, for dot's review and bowen's decisions

bowen 1792210180–1792210306: semantic "bones" for Bézier lines. 1792251783: bones as simple as possible. 1792252296 / 1792253068: the eye = two bones sharing both ends (inner tip, middle of the lid band's outer end). 1792255326: bound end points are a hard constraint first, then lines follow bones. 1792257811: edit only the 0,0 bone; the other eight views' bones follow from it, then their lines. 1792290858: still an edit, still a meta-line, still helps the nine views make pictures. 1792293978: the workflow — design a standard face, then for a new eye move the reused (same-named) bones at 0,0 and get the other eight views; 30°/60° corrections kept apart; width must not change too sharply when looking up / down. 1792295715: "now it matches — discuss with dot how to build it, UI included". 1792296174: the default face differs from made faces; several standards (标准1, 标准2 …), each its own recorded nine views, because some eye shapes behave differently across the views. 1792296232: two modes — **录制标准** (all nine views adjustable) and **捏脸** (only 0,0). 1792296313: in 录制标准 the side views adjust **bones only**; bones are what this discussion adds. Review: dot 1792295961, 1792295977, 1792296043, 1792296199, 1792296300 (all points taken in below).

Evidence so far (throwaway scripts, not in the repo): bowen's 165.json left eye, nine-view sheets in the Slack thread (eye-ninegrid-tip.png, eye-arch-A/B/C.png, eye-ninegrid-spine2.png). Proven on one eye only; hair / ears untried.

## 0. Two modes (the panel's main entry, named as bowen sees them — dot 1792296300)
- **录制标准** — making a standard for one part (部位, e.g. 左眼): bowen draws the 0,0 lines, hangs them on bones, then adjusts the **bones** in each of the nine views; the hung lines in every view other than 0,0 are always generated, never hand-edited. 「存为标准…」 saves the part's bones in the nine views under a name (标准1, 标准2 …); an existing name is overwritten only after an explicit 「覆盖」.
- **捏脸** — making a face on a chosen standard: only 0,0 is edited (its bones and hung lines). For each part a standard is chosen; the eight other views' bones are generated from it, then the hung lines. The side views of that part cannot be edited; if they look wrong, go back to 录制标准 and fix that standard or record a new one.
- Lines not hung on any bone (parts without bones yet) are edited as today in both modes.

## 1. What is stored (new module `src/bones`, archive v14 → v15; v14 opens with an empty part)
- **Bone mark**: a set of line ids. A bone is an ordinary meta-line: nine view positions, edited like any line where its mode allows. It is never inked, filled or masked; playback hides it by default (a debug switch shows it).
- **挂接 (hang)**: per line, at most one `{ line, bone, follow }`, `follow` = `贴着跟` (close) or `整体跟` (whole). Cross-layer allowed (lids and lashes live on different layers). A bone cannot hang on a bone (no hierarchy in v1).
- **挂接基准 (hang base)** per hung line: its 0,0 shape and the 0,0 bone's shape at the moment of hanging, plus the bone coordinates of its sample points computed once on that base bone. Every derivation starts from the base (§2), never from the last fitted result.
- **部位 (part)**: a name and the set of bones in it (chosen when the part is made; the two eye bones are one part).
- **标准 (standard)**: `{ name, part, bones: [{ boneName, nine view shapes }] }`, written only by 「存为标准…」. Several per part. Stored where bowen decides (§7) — by default in the default-face drawing; a made face imports a **copy**, so nothing done in the made face changes the source.
- **Choice** per part in a made face: which standard it uses, by the standard's stable id (dot 1792296507) — the name is for display and import matching only, so renaming a standard never breaks the choice.
- Ids are stable inside a drawing; names (part, standard, bone) are used only to match on import — renaming inside a drawing never breaks a relation.

## 2. Derivation (pure functions in `deform/`, next to `Field`, `deformPlan`, `fit`)
- **贴着跟** = bone coordinates: a point is (fraction along the bone, signed distance from it); in another view: the same fraction along that view's bone, distance × (that bone's length / base bone length). **Past a bone end** (dot 1792296347) the fraction is clamped to 0 or 1 and the rest is kept as a distance along the end tangent: the bone is extended straight past its ends, so a point beyond an end is (end, along-tangent distance, normal distance), scaled by the same length ratio. With the bone unchanged the map is the identity; and the 0,0 lines are not rewritten at all when hanging, on 「摆放骨骼」, or when the bone did not move (no refit of an unchanged line). Along-the-bone correspondence = **fraction of length** (bowen 1792251439 — decided; the experiments' Bézier t was my throwaway choice).
- **整体跟** = the best affine map of pins on the bone.
- **Side bones in 捏脸**: each point of the current 0,0 bone in bone coordinates of the standard's 0,0 bone, placed on the standard's bone in that view (the same rule as 贴着跟, applied to the bone itself). Ends shared by two bones of the part get one target (§7.2).
- Each hung line is mapped as sampled points, then refit with the existing fit (end points exact; whole-line shape error measured as the symmetric Hausdorff distance over dense samples, reported).
- **0,0** hung line = map(base bone → current 0,0 bone)(base line). **Side view** = map(base bone → that view's bone)(base line), in one step (not through the 0,0 fit).
- The base is renewed when bowen edits a hung line at 0,0 directly (new base = edited line + current bone) and on 「摆放骨骼」 (new base = unchanged lines + moved bone); 「带动线稿」 keeps the base.
- **Degenerate cases (refused, nothing written):** bone shorter than a threshold; ambiguous projection (two parts of the bone equally near) → "choose another bone"; a zero end tangent → the chord direction, and a zero chord too → refuse (never a NaN); 整体跟 on collinear pins (a straight bone) → falls back to a similarity (move, turn, uniform scale). Checked **on every derivation**, not only when hanging (dot 1792296043); the whole step is refused and the drawing kept.
- **A line that one Bézier cannot follow** (fit error above a threshold): the step is refused naming that line — never committed as a bad shape with only an error readout, never split behind bowen's back.

## 3. When it runs — inside the commit, a fixed pipeline; any conflict refuses the whole step and keeps the drawing
1. bowen's edit lands in the current view (where the mode allows it); if it edited a hung line at 0,0, its base is renewed here;
2. front mirror handles (existing, front only); a hung line changed by the mirror gets its base renewed too;
3. side bones: 捏脸 → generated from the chosen standard (§2); 录制标准 → as bowen placed them;
4. per view, one target for every hung point — shared points by the rule bowen picks (§7.2);
5. each hung line refit with fixed ends;
6. existing link align and `joins.solve` must not move a hung line's points or handles; if they would, refuse.
One undo step reverts all of it. Results are written into the views' positions — playback reads ordinary nine-view lines, unchanged.

## 4. Boundaries (each one a test)
- **Side views**: hung lines — direct geometry edits (move point, move handle, transform, 四角/曲边, 球面框) refused in both modes (`bone-derived`, "generated from the bone — edit at 0,0"); bones — editable in 录制标准, refused in 捏脸 (`bone-standard`, "the side views come from 标准X — change it in 录制标准"). Strokes, visibility and names stay editable.
- **从视角应用**: checks only the lines actually applied; refuses when one of them is a hung line (or, in 捏脸, a bone) in a non-front target.
- **Delete**: a bone → its hung lines are released, positions kept; a hung line → its hang record goes too; a bone that a standard names → the standard keeps its data (it is a copy), the part lists it as missing.
- **Split**: a hung line → both halves inherit the hang (new base = the halves); a bone → refused in v1.
- **Copy / paste** (dot 1792296347): a bone copied alone stays a bone (its own data — mark, name, part membership — travels with it), so a standard's bones can be pasted and hung on a brand-new eye; a hang travels only when both the bone and the line are copied, with ids remapped to the pasted copies.
- **Links (联动)**: hanging a line that already has links is refused ("unlink first"); new links on hung lines are refused. Ledger row.
- **Mirror**: tested, not argued — a mirror pair with one side hung; both sides on different bones.
- **Masks, fills**: read geometry only. **30° / 60° corrections**: v1 never touches correction data; a test shows they still apply.

## 5. Bench (side panel, existing tools A / V / Z)
- Top of the 「骨骼」 block: the mode, 「录制标准 / 捏脸」, shown also on the canvas (which views can be edited).
- With lines selected: 「设为骨骼 / 取消骨骼」; 「挂接到骨骼」 then pick the bone on the canvas **or** from a name list; batch hang. Each bone lists its hung lines with a 贴着跟 / 整体跟 switch and 「取下」. Esc or switching tools cancels an unfinished pick.
- Display: bones dashed, one colour each; selecting a bone highlights its hung lines without adding them to the selection. Where a line cannot be edited it is drawn as usual, hover: 「由骨骼生成」 / 「来自标准X」.
- Dragging a 0,0 bone: a switch 「带动线稿」 / 「摆放骨骼（正面线稿不动）」, also shown on the canvas.
- 录制标准: 「存为标准…」 (name; lists the part's existing standards; 「覆盖」 must be chosen explicitly). 捏脸: per part 「用标准：[标准1 ▾]」 and 「从文件导入标准…」. The panel shows the last derivation's largest fit error.

## 6. The new-eye flow (捏脸)
1. Import / choose a standard for the part; keep the standard eye as reference; draw the new lines (not hung).
2. Move the part's bones at 0,0 onto the new eye (「摆放骨骼」: lines stay); the other eight views' bones follow from the standard.
3. Hang the new lines → the eight views are generated at that moment.
If a view looks wrong for this eye shape: 录制标准, adjust the bones in that view, 「存为标准…」 under a new name (or overwrite on purpose), back to 捏脸.

## 7. Decisions for bowen (defaults in brackets)
1. Name of the relation [挂接].
2. Who owns a point shared by lines on different bones: (a) average of the bones; (b) the bone nearest the point at 0,0; (c) chosen by hand per point [b — dot advises against a silent average]. In the eye: the two outer ends of the lid band (上眼睑上 × 外眼角外, 上眼睑下 × 外眼角内).
3. Keep 整体跟? (used for the crease) [keep].
4. Bone width factor per view (lid thickness when looking up / down), default the length ratio [later package B4].
5. Bones in playback [hidden; debug switch].
6. A standard per part or per whole face [per part: a face may use 标准2 for the eyes and 标准1 for the brows].
7. Where standards live [in the default-face drawing; made faces import copies].
Decided: two modes (1792296232); in 录制标准 the side views adjust bones only (1792296313); along-the-bone correspondence by fraction of length (1792251439). Hence no stored side-bone offsets, and **the geometry of hung lines cannot be edited directly in non-front views** — 0,0 editing, lines not hung on a bone, and the shared strokes stay as they are (dot 1792296507).

## 8. Evidence (tests; dot's four first)
- Generate twice without changes → the second changes nothing; also after save and reopen.
- One edit to the end vs ten edits to the same end → identical results.
- 捏脸: side bones and lines refused; switching the part's standard regenerates the eight views; editing a made face never changes the imported standard's source.
- 录制标准: side bones editable, hung lines regenerate at once; 「存为标准…」 under an existing name only with 「覆盖」.
- Hanging, and 「摆放骨骼」, leave the 0,0 lines exactly as they were (bit-equal), including points past a bone end; a bone not moved changes nothing.
- A bone copied alone pastes as a bone; bone + line copied together keep the hang, remapped to the copies.
- Real fills and ink in the nine views and in between; the two bones almost coinciding.
- Degenerate cases reached by a later drag (bone made short, zero chord, ambiguous) → the whole step refused, the drawing unchanged, no NaN anywhere.
- A line that one Bézier cannot follow → refused naming the line; topology unchanged.
- 30° / 60° corrections present, then bones edited → the new results stand and the corrections still apply; save / reopen and undo both pass.
- Each boundary in §4; each degenerate case in §2; the eye of 165.json as a fixture (nine views, numbers like the Slack sheets).

## 9. Packages (dot accepts each)
- **B1 core**: `src/bones` (bone mark, hangs, bases, parts, standards, choices — the whole data shape now), archive v15 (+ legacy step), derivation functions, the commit pipeline, refusals, §4 boundaries, tests.
- **B2 bench**: bones, hanging, display, the two drag switches (§5 without the standard controls).
- **B3 modes and standards**: 录制标准 / 捏脸, 「存为标准…」, choosing and importing standards, the §6 flow.
- **B4 (later)**: width factor.

## 10. Not in this checklist
Bone hierarchies (a bone hung on a bone), hair / ear pilots, the 30° / 60° correction interplay beyond "untouched".
