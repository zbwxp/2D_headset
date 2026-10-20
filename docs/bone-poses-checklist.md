# 骨线在 30° / 60° 调整，语义线跟着走 — checklist (B5)

## 0. Requirements (bowen)
- 1792474274: bone lines get 30° / 60° adjustments; 语义线 (attached lines) are edited at 0,0 only.
- 1792475406: ① — at any pose an attached line is generated from its bone at that pose (if performance is fine);
  a pose where a line cannot be generated is drawn the ordinary way and reported; old adjustments on attached lines are
  dropped.
- Measured before deciding (标准tmp lashes, 0→90 sweep): the current fit 3.2 ms / line, 16 samples 1.0 ms / line, same
  error on that sample set. Not an acceptance: §6 measures again, independently.

## 1. What exists (core/v1 at 84922a1, checked)
- A 30° / 60° adjustment is a response: per control (a point, or one end's handle), per edge between two neighbouring
  views, per axis, knots of progress → value (src/animation, src/evaluate). `evaluate(model, pose)` blends the nine
  views with them; `afterBlend` is an empty slot after the blend.
- Every reader of a pose builds its model with `modelOf` and calls `evaluate`: `atPose` (playback canvas), `previewAt`
  (a correction's preview), and `correct`'s own before / after (`CorrectionWorld.model / settled`). One model, one
  function, so whatever the slot does, all of them see it.
- Bones can already be corrected at 30° (correct() only refuses attached lines); the attached lines then stay where the
  blend of their own nine views puts them — the gap to close. A correction on a control whose two views hold the same
  value is refused (correction-not-reproduced), for every line; not changed here.

## 2. The derivation at a pose (P1, core)
1. `Model` gains `bones?: { attach: [{ line, bone, base: { line, bone } }], owners: [{ point, bone }] }` (copies, from
   `modelOf`). `evaluate` stays pure: it calls `bones/coords` (pure math), nothing else.
2. At a view (a pose with a single view weight 1): the view's stored shapes, exactly — never refit (dot 1792474596).
3. Between the views, for each attached line: its bone as blended at this pose; the line = `boneLine(base.line,
   base.bone, bone@pose, ends)`, the fit with 16 samples (§6 checks its error separately).
4. Ends, as in the views (bone-lines-checklist §1, §3): a point used only by attached lines (and bones) follows the
   derivation, a point shared by lines on different bones follows its owner, a point a bone uses is the bone's.
   **To decide (bowen, with a real drawing):** a point an attached line shares with an *ordinary* line —
   A. the ordinary line's end takes the derived position (as the views' settle carries it), its handle turned with it
      so a smooth join stays smooth (dot 1792474482), or
   B. the attached line's end is pinned where the blend puts the ordinary line's end.
5. The derived shapes replace the attached lines' points and handles in `Posed`; nothing else changes.

## 3. When a pose cannot be generated (P1)
- Causes: the blended bone degenerate (too short, no direction), a point ambiguous on it, a fit over its limit.
- Rule (bowen 1792475406): that line, and every attached line sharing a point with it (so no join opens; dot
  1792474630), are drawn from the plain blend at this pose; `Posed` lists them with the reason; never a non-finite
  number, never the previous frame reused silently. The bench marks them (red) and names them in the status line.

## 4. Responses of attached lines (P1)
- `evaluate` never reads them for attached lines (their shapes are generated).
- Dropped (bowen 1792475406): the line's own handles' responses, and the responses of points used only by attached
  lines. Never a point an ordinary line or a bone also uses — those responses belong to that line or bone (dot
  1792474482).
- When: on 绑骨 (in the same edit), and on opening an older file (archive v16 reads v15: the same drop, listed in the
  open report with the line names — never silent).

## 5. Corrections on bones (P2)
- 录制标准: allowed. `correct`'s final check (nothing outside the targets changes at this pose, nothing outside the
  moves changes in any view; dot 1792474538) gains one allowed dependency: the attached lines of the corrected bones and
  the points §2.4 moves with them. Every ordinary line stays protected; the check is never skipped. The trial, the
  commit and the views' derivation are the same `modelOf` / settle (dot 1792474877).
- 捏脸: a bone's responses come from its standard, so `correct`, `uncorrect` and `clearCorrections` on a bone are
  refused (`bone-standard`, the reasons of `standardLock`), as its side views are (dot 1792474662).

## 6. Evidence (each package)
- At the nine views: every attached line bit-equal to the stored views (no refit), every pose type: playback,
  preview, correct's trial.
- Continuity: poses approaching each view from both sides (t = 1e-3 … 1e-9) converge to the view's shapes; no jump
  (dot 1792474630).
- Error, independently of the fit's own samples: 400 samples on each curve, both ways, against the carried curve; the
  earlier loop and tight-hook regressions (标准tmp 90,45) run again with 16 samples (dot 1792475485).
- Failure: a bone collapsing between two valid views; the fallback group; finite numbers everywhere; reported names.
- A 30° bone correction: the attached lines follow at 30°; an ordinary line elsewhere unchanged (refused if touched).
- Old responses: dropped exactly per §4 (shared points kept), on 绑骨 and on opening v15; undo restores them.
- Performance in the bench (P4): a real drawing, a full drag through playback: median and 95th-percentile frame time,
  with drawing and fallbacks included; the 40-line figure stays an estimate until measured.

## 7. Standards (P3)
- A standard bone stores its responses (its two points and two handles, every edge and axis); save, import check
  (`checkKnots`), restore, copy isolation as for its views.
- 捏脸: a paired bone's responses are written from its standard (points shared by paired bones: the smaller bone id).
- **To decide (bowen):** reuse keeps the progress per axis (what the numbers are) — on a bone turned against the
  standard's, the motion does not turn with it; or the standard's motion shape kept (needs another representation).
  Faces are made where the default face is (bowen 1792304469), so their bones are close in direction (dot 1792474596).

## 8. Packages
- P1 core: Model.bones, the derivation at a pose, fallback, responses dropped, archive v16 — §6 evidence.
- P2 core: corrections on bones (dependency scope; 捏脸 refusals).
- P3 core: standards carry responses.
- P4 bench: fallback marking and status; the frame-time measurement.
