# 球面变形框 (sphere deform frame): an edit, beside 四角 / 曲边 — checklist before any code, for dot's review

Replaces `docs/sphere-domain-checklist.md` (bowen 1792053826: "keep the domain an editing behaviour; friendlier to the whole framework"). Nothing is stored on a layer; the result is ordinary lines in the view.

## The ask
- **bowen 1792050227:** a sphere-perspective deform frame beside 四角 / 曲边; set r and the sphere's yaw / pitch / rotation to get the shape wanted.
- **bowen 1792053212:** mapping **A**: what was drawn is what you see; it deforms only when the sphere turns. Uniform scale anywhere; r is the curvature, not the scale; no sphere-to-canvas distance.
- **bowen 1792053508:**
  - the sphere is modelled in the background;
  - he sees one frame like the selection box: move, scale, rotate, plus sliders yaw and pitch;
  - the lines follow;
  - the sphere's yaw / pitch have nothing to do with the view's.
- **bowen 1792053826:** an edit, not a domain.
- **Agreed rules** (dot 1792050450, Claude 1792050562):
  - r only bends;
  - the frame's centre stays fixed under yaw / pitch;
  - no rotation → unchanged;
  - parallel projection;
  - no folding;
  - no occlusion;
  - each curve refitted whole, with its error.
- **Open (Claude 1792053870):** r as a third slider 「弧度」, or fixed (the sphere just encloses the selection). The plan below has the slider; dropping it fixes r at its default.

## 1. The field (in `deform/`, plain maths, no imports, like `deformField`)
`sphereField({ anchor, r, yaw, pitch, roll, scale, offset })` returns a `Field` (`map`, `vector`, `denominator ≡ 1`, `affine: false`). For a point p:
1. q = p − anchor; |q| ≥ r is refused (「超出球面」).
2. P = (q.x, q.y, √(r² − |q|²)).
3. P′ = R·P with R = Rx(pitch)·Ry(yaw): yaw about the vertical axis first, then pitch about the horizontal axis; |yaw|, |pitch| < 90°. Positive yaw moves the sphere's front toward +x; positive pitch toward −y (up on screen).
4. P′.z ≤ 0.05 r is refused (「转到背面」, fold).
5. pole′ = R·(0, 0, r); d = (P′.x − pole′.x, P′.y − pole′.y): parallel projection, anchor fixed.
6. Result: anchor + offset + scale · Rot(roll) · d.

- `vector`: the analytic derivative of the above (checked against finite differences).
- Refusals are thrown errors with those messages, as `deformField`'s; every input and output finite (the `deform/` rules).
- The curve fit is the existing `fitDeformedCubic` (end points exact, tangents from `vector`, least-squares handles, `maxError`). `denominator ≡ 1` makes its parameter scale 1.

## 2. The edit (in `interaction/flows/deform.ts`, nothing new in core)
- `deformOpFrom` is generalised to take a `Field` (the 四角 call passes `deformField(rect, quad, bend)`, unchanged behaviour).
- `sphereOp(core, view, lines, sphere)`: the selected lines' stored curves, read and frozen now, then `deformPlan` with `sphereField(sphere)`, then `move` + `moveHandle`. The same op is previewed (`core.preview(view, op)`) and committed (`core.editIn(view, op)`).
- **Every rule of 四角 package 2 holds as it is:**
  - shared points mapped once;
  - lines not given keep their far ends;
  - locks;
  - links follow;
  - mirror settling;
  - auto-bind;
  - one undo step.
- **Source:** the lines as they are in this view now, as 四角. To start from the front's shape, first use the existing 「从视角应用」.
- **Any view, the front included.** Playback correction poses: if the 四角 tool's playback path takes a `Field` op unchanged, the sphere frame works there too; otherwise not in this version (no special case).

## 3. The frame (bench + `interaction/flows/deform.ts` session)
- **Opening:** a new tool 「球面框」 on the selected lines (or the current layer's lines).
- **The frame:** the selection's bounding box, as the selection box draws it.
  - drag inside → `offset`;
  - corner handles → `scale` (uniform; no separate horizontal / vertical);
  - rotate handle → `roll`.
- **The anchor** is the box's centre at opening.
- **Sliders:**
  - yaw, pitch (−85…85°);
  - 「弧度」 = r: from 1.05 × the largest distance of the selection from the anchor (most curved), up to 20 ×; default 1.5 ×.
- **The sphere is not drawn** (bowen 1792053508).
- **Live preview** of the frozen op on every change. A refused state (outside, fold, lock) shows its message and keeps the last valid preview. The fit error is shown beside the sliders.
- **Committing:** Enter or 「应用」. Esc / right-click cancels. After a commit the frame reopens on the result with every slider at zero (each commit is a new edit).

## 4. Evidence
**deform/:**
- identity at zero for any r;
- the anchor fixed under yaw / pitch;
- `vector` against finite differences;
- r large → close to the affine compression cos(yaw) along x;
- refusals at |q| = r and at the fold threshold;
- non-finite input refused.

**interaction:**
- package 2's tests 1–10 run with a sphere field: preview = commit, shared points, locks, links, mirror, auto-bind, one undo step.

**bench:**
- open the frame on an eye at view 90,0;
- yaw 40 → the eye turns; pitch, scale, roll, offset each move it as named;
- commit;
- undo;
- a refused yaw shows its message and draws no change.

**Screenshots:** an eye at the front, then at view 90,0 with yaw 40 at two 「弧度」 values.

## Not in this version
- Hair.
- A domain stored on the layer.
- A sphere-to-canvas distance.
- Points beyond the limb (refused, not hidden).
