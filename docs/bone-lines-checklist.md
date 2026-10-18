# 骨骼线 (bone lines) — checklist before any code, for dot's review and bowen's decisions

bowen 1792210180–1792210306: semantic "bones" for Bézier lines. 1792251783: bones as simple as possible. 1792252296 / 1792253068: the eye = two bones sharing both ends (inner tip, middle of the lid band's outer end). 1792255326: bound end points are a hard constraint first, then lines follow bones. 1792257811: edit only the 0,0 bone; the other eight views' bones follow from it, then their lines. 1792290858: still an edit, still a meta-line, still helps the nine views make pictures. 1792293978: the workflow — design a standard face (0,0 lines hung on bones, bones placed in nine views), then for a new eye move the reused (same-named) bones at 0,0 and get the other eight views; he leans to no contour hand-fixes in the nine fixed views ("倾向于"), 30°/60° corrections kept apart; width must not change too sharply when looking up / down. 1792295715: "now it matches — discuss with dot how to build it, UI included". Review: dot 1792295961, 1792295977 (all points taken in below).

Evidence so far (throwaway scripts, not in the repo): bowen's 165.json left eye, nine-view sheets in the Slack thread (eye-ninegrid-tip.png, eye-arch-A/B/C.png, eye-ninegrid-spine2.png). Proven on one eye only; hair / ears untried.

## 1. What is stored (new module `src/bones`, archive v14 → v15; v14 opens with an empty part)
- **Bone mark**: a set of line ids. A bone is an ordinary meta-line: nine view positions, edited like any line. It is never inked, filled or masked; playback hides it by default (a debug switch shows it).
- **挂接 (hang)**: per line, at most one `{ line, bone, follow }`, `follow` = `贴着跟` (close) or `整体跟` (whole). Cross-layer allowed (lids and lashes live on different layers). A bone cannot hang on a bone (no hierarchy in v1). Ids are stable; names are used only to match bones when importing a standard (§6) — renaming never breaks a relation.
- **挂接基准 (hang base)** per hung line: its 0,0 shape and the 0,0 bone's shape at the moment of hanging, plus the bone coordinates of the line's sample points computed once on that base bone. Every derivation starts from the base (§2), never from the last fitted result.
- **标准 (standard)** per bone: its nine view shapes, written only by 「设为标准」. A fixed view transform for that bone.
- **骨骼偏移 (bone offset)** per bone per non-front view: the side view's bone = standard-derived(current 0,0 bone) + offset (control-point differences in drawing coordinates — *bowen: drawing coordinates vs bone-local, pending*). Written when bowen edits a side view's bone; so his side-bone adjustments survive later 0,0 edits, and the result depends only on (current 0,0 bone, offsets), not on how many edits led there. **Limit of the first version (dot 1792296043):** drawing-coordinate offsets do not turn or scale when the 0,0 bone is turned or scaled — bowen to confirm.
- Data for §6 (reuse across drawings) is part of this design now, so package B1 stores what B3 needs.

## 2. Derivation (pure functions in `deform/`, next to `Field`, `deformPlan`, `fit`)
- **贴着跟** = bone coordinates: a point is (fraction along the bone, signed distance from it); in another view: the same fraction along that view's bone, distance × (that bone's length / base bone length). Along-the-bone correspondence = **fraction of length** (bowen 1792251439). *Experiments used Bézier t (a tie on the data, my choice, not confirmed) — bowen to confirm length.*
- **整体跟** = the best affine map of pins on the bone.
- Each hung line is mapped as sampled points, then refit with the existing fit (end points exact, whole-line shape error measured as the symmetric Hausdorff distance over dense samples, reported).
- **0,0** hung line = map(base bone → current 0,0 bone)(base line). **Side view** = map(base bone → that view's bone)(base line), in one step (not through the 0,0 fit).
- The base is renewed when bowen edits a hung line at 0,0 directly (new base = edited line + current bone) and on 「摆放骨骼」 (new base = unchanged lines + moved bone); 「带动线稿」 keeps the base.
- **Degenerate cases (refused, nothing written):** bone shorter than a threshold; ambiguous projection at hang time (two parts of the bone equally near) → refuse, "choose another bone"; a zero end tangent → the chord direction, and a zero chord too → refuse (never a NaN); 整体跟 on collinear pins (a straight bone) → falls back to a similarity (move, turn, uniform scale). These are checked **on every derivation**, not only when hanging — a later drag can make a bone short, flat or ambiguous (dot 1792296043); the whole step is then refused and the drawing kept.
- **A line that one Bézier cannot follow** (fit error above a threshold): the step is refused naming that line — never committed as a bad shape with only an error readout, never split behind bowen's back (that would change the topology).

## 3. When it runs — inside the commit, a fixed pipeline; any conflict refuses the whole step and keeps the drawing
1. bowen's edit lands in the current view; if it moved a side view's bone, that bone's offset is updated **here**, before step 3 (else the old offset would overwrite the adjustment); if it edited a hung line at 0,0, its base is renewed here;
2. front mirror handles (existing, front only); a hung line changed by the mirror gets its base renewed too;
3. each view's bones: standard-derived(0,0 bone) + offset (only when a standard exists);
4. per view, one target for every hung point — shared points by the rule bowen picks (§7.2);
5. each hung line refit with fixed ends;
6. existing link align and `joins.solve` must not move a hung line's points or handles; if they would, refuse.
One undo step reverts all of it. Results are written into the views' positions — playback reads ordinary nine-view lines, unchanged.

## 4. Boundaries (each one a test)
- **Side views**: refuse only direct geometry edits of hung lines (move point, move handle, transform, 四角/曲边, 球面框) with `bone-derived` ("generated from the bone — edit at 0,0"). Strokes, visibility and names stay editable. Bones in side views are editable (that is how the nine views are tuned).
- **从视角应用**: checks only the lines actually applied; refuses when one of them is a hung line in a non-front target.
- **Delete**: a bone → its hung lines are released, positions kept; a hung line → its hang record goes too.
- **Split**: a hung line → both halves inherit the hang (new base = the halves); a bone → refused in v1.
- **Copy / paste**: bone mark and hangs travel only when bone and line are copied together.
- **Links (联动)**: hanging a line that already has links is refused ("unlink first"); new links on hung lines are refused. Ledger row.
- **Mirror**: tested, not argued — a mirror pair with one side hung; both sides on different bones.
- **Masks, fills**: read geometry only. **30° / 60° corrections**: v1 never touches correction data; a test shows they still apply.

## 5. Bench (side panel, existing tools A / V / Z)
- With lines selected, a 「骨骼」 block: 「设为骨骼 / 取消骨骼」; 「挂接到骨骼」 then pick the bone on the canvas **or** from a name list; batch hang. Each bone lists its hung lines with a 贴着跟 / 整体跟 switch and 「取下」. Esc or switching tools cancels an unfinished pick.
- Display: bones dashed, one colour each; selecting a bone highlights its hung lines without adding them to the selection. In side views hung lines are visible, not editable (hover: 「由骨骼生成」).
- Dragging a 0,0 bone: a switch 「带动线稿」 / 「摆放骨骼（正面线稿不动）」, also shown on the canvas.
- 「设为标准」 shows whether a standard exists and which bones this press updates. The panel shows the last derivation's largest fit error.

## 6. Reuse (package B3, designed now): the new-eye flow
1. Load / keep the standard eye as reference; draw the new lines (not hung).
2. Move the reused bones at 0,0 onto the new eye (「摆放骨骼」: lines stay); the other eight views' bones follow from the standard (+ offsets).
3. Hang the new lines → the eight views are generated at that moment.
The new eye works on a copy of the standard; the original standard changes only through 「设为标准」. Importing a standard from another drawing matches bones by name.

## 7. Decisions for bowen (defaults in brackets)
1. Name of the relation [挂接].
2. Who owns a point shared by lines on different bones: (a) average of the bones; (b) the bone nearest the point at 0,0; (c) chosen by hand per point [b — dot advises against a silent average]. In the eye: the two outer ends of the lid band (上眼睑上 × 外眼角外, 上眼睑下 × 外眼角内).
3. Keep 整体跟? (used for the crease) [keep].
4. Bone width factor per view (lid thickness when looking up / down), default the length ratio [later package B4].
5. Bones in playback [hidden; debug switch].
6. No contour hand-fixes in the nine fixed views (bowen "倾向于") [as proposed].
7. Bone offsets in drawing coordinates or bone-local [drawing coordinates].
8. Along-the-bone correspondence: fraction of length (bowen's choice) or Bézier t [length].

## 8. Evidence (tests; dot's four first)
- Generate twice without changes → the second changes nothing; also after save and reopen.
- One edit to the end vs ten edits to the same end → identical results.
- Side-bone adjustments, then a 0,0 edit → the adjustments kept, not added twice.
- Real fills and ink in the nine views and in between; the two bones almost coinciding.
- A side bone adjusted, then a 0,0 edit in the next step → the offset was updated first (step 1), the adjustment survives; a mirror edit of a hung line renews its base.
- Degenerate cases reached by a later drag (bone made short, zero chord, ambiguous) → the whole step refused, the drawing unchanged, no NaN anywhere.
- A line that one Bézier cannot follow → refused naming the line; topology unchanged.
- 30° / 60° corrections present, then bones edited → the new bone results stand and the corrections still apply; save / reopen and undo both pass.
- Each boundary in §4; each degenerate case in §2; the eye of 165.json as a fixture (nine views, numbers like the Slack sheets).

## 9. Packages (dot accepts each)
- **B1 core**: `src/bones`, archive v15 (+ legacy step), derivation functions, the commit pipeline, refusals, §4 boundaries, tests.
- **B2 bench**: §5.
- **B3 standard and reuse**: 「设为标准」, offsets, 0,0 bone → side bones, import by name, the §6 flow.
- **B4 (later)**: width factor.

## 10. Not in this checklist
Bone hierarchies (a bone hung on a bone), hair / ear pilots, the 30° / 60° correction interplay beyond "untouched".
