# Sphere domain (球面域), first version: checklist before any code, for dot's review

**Superseded** by `docs/sphere-frame-checklist.md` (bowen 1792053826: an edit, not a domain). Kept for the record.

## The ask
- **bowen 1792050227:** a new deform frame beside 四角 / 曲边: a sphere-perspective frame. Per layer, at chosen angles, bowen sets the sphere's r and its yaw / pitch / rotation to get the shape he wants. "This brings the domain (域) back, one true sphere per layer."
- **bowen 1792052788:**
  - a domain, not a one-off tool; hair may use it later;
  - first version only: draw an eye at the front, look at it in the other views;
  - a heavily restricted 四角 + 曲边 frame, a preset deform;
  - parameters: r, the sphere centre, the sphere's yaw / pitch, the in-plane rotation;
  - r may change linearly between views; 30° / 60° editing not needed now (fine if it falls out of the same logic, no special case);
  - no separate horizontal / vertical stretch: the deform follows the sphere.
- **bowen 1792052881:** like a shape on a globe: near the poles it gets smaller and bends up / down; the further to the side, the larger the deform.
- **bowen 1792053212:**
  - mapping **A**: the front drawing is what you see; it deforms only when the sphere turns;
  - any view can be scaled (uniformly); r sets the curvature and is not the scale;
  - no sphere-to-canvas distance needed if scaling works without it.
- **Agreed rules (dot 1792050450, Claude 1792050562):**
  - r sets only how strongly it bends; size is separate; a larger r is flatter;
  - the frame's centre stays fixed when the sphere turns (the eye does not swing around the sphere's centre);
  - no rotation → the lines exactly as drawn;
  - parallel projection;
  - only the range that does not fold;
  - the sphere does not hide anything: occlusion stays with layer order and masks;
  - each curve is refitted whole, with its error.

Provenance: v103 layer domains (7205381 `src/app/layerDomainOperation.ts`: a deform operation stored on a layer and always applied); v103 eye perspective (`docs/v084-eyes-perspective.md`: a view-derived map applied per eye, identity at the front). Neither is ported; the sphere map is new and is bowen's.

## 1. Data
A new module **`src/domains`**: per layer, at most one sphere domain.
- **`anchor`** (front drawing coordinates): where the sphere's front pole touches the drawing. Set when the domain is added: the centre of the layer's front bounding box. Editable (number fields).
- **Per view** (the 9 views), a parameter set:
  - `offset` (Vec): moves the result;
  - `scale` (> 0): uniform;
  - `r` (> 0): curvature;
  - `yaw`, `pitch` (degrees): turn the sphere;
  - `roll` (degrees): in-plane rotation of the result.
- **A view without a set** reads the identity: offset 0, scale 1, yaw = pitch = roll = 0, r = the layer's default r (set when added: 1.5 × the largest distance of the layer's front geometry from the anchor).
- **The front view's set:** default the identity. Whether it can be changed (bowen: "any view can scale", 1792053212; dot 1792053573 #1) is asked in Claude 1792053576 Q2.
  - **Either way, generation always reads the undeformed front source** (the stored front positions), never the front's mapped result (dot 1792053573 #1).
  - If the front set can change, the front view shows the mapped source too, and editing at the front then goes through the map (decided with bowen's answer).

## 2. The map (per view or pose; mapping A)
For a front point p:
1. q = p − anchor; refused if |q| ≥ r (see §4).
2. On the sphere: P = (q.x, q.y, √(r² − |q|²)). The front pole is (0, 0, r).
3. Turn: P′ = R · P, R = Rx(pitch) · Ry(yaw) (yaw about the vertical axis first, then pitch about the horizontal axis); pole′ = R · (0, 0, r). |yaw| and |pitch| < 90°.
4. Parallel projection, relative to the turned pole: d = (P′.x − pole′.x, P′.y − pole′.y). This keeps the anchor fixed (dot's "centre fixed").
5. Result: anchor + offset + scale · Rot(roll) · d.

- **Identity check:** yaw = pitch = roll = 0, scale 1, offset 0 → d = q → the point itself, for any r.
- **The sphere's yaw / pitch have nothing to do with the view's yaw / pitch** (bowen 1792053508). Sign: positive yaw moves the front of the sphere toward +x, positive pitch toward −y (up on screen).
- **Curves:** each line's cubic is refitted with `deform/`'s `fitDeformedCubic`:
  - end points exact;
  - tangent directions from the map's Jacobian (analytic);
  - least-squares handle lengths;
  - `maxError` kept and shown in the bench.

## 3. Where it is read
At read time only. The stored positions of the domain layer in views other than the front are left untouched and ignored while the domain exists (removing the domain brings them back; undo-safe, nothing to migrate).
- **A view's reader** (`core.in(view)`, view ≠ front): a private copy of the state (as `posedState` does today) in which the domain layers' points and handles are replaced by the map of the front geometry with that view's set.
- **A pose's reader** (`atPose`, `previewAt`): evaluate as today, then the domain layers' points and handles are replaced by the map of the front geometry with the **blended set**. The blend uses the pose's geometric weights of its cell's four views (3a's bilinear weights), each parameter linearly (angles in degrees, linearly; scale and r linearly). So in-between angles follow the sphere (乙), not a blend of positions.
- **One generated state per reader** (dot 1792053573 #3): the overlay is applied inside the reader's state accessor, so every method of that reader reads the same generated state:
  - `snapshot`, `geometry`, `nearby`, `pickLoop`, `linesInRect`, `loopsAt`, bounds, zones, `copy`;
  - `core.preview(view, fn)` and `previewAt` apply `fn` to the stored state, then generate.
  What is drawn and what is hit can never differ.
- **Everything downstream** (ink, fills, masks, name labels) reads those readers and follows without change.
- **Unchanged per view:** widths, end strokes, zones, joins. Only positions and handles are generated.

## 4. Refusals (never repaired)
**Validity of one parameter set** (for a view, or a blended set at a pose):
- every sampled point of the layer's front source (end points and 16 samples per curve) has |q| < r (`domain-outside`);
- after the turn, depth P′.z > 0.05 r (`domain-fold`).
These are sampled checks, as `deform/`'s.

**At edit time** (dot 1792053573 #2): an edit is refused whole if, afterwards:
- any of the 9 views' sets is invalid, or
- any of a guard grid of poses is invalid: 9 × 9 poses per cell, for the cells touching a changed view (all cells after a front edit).
The grid is a guard, not a proof that every pose is valid; the next point covers the rest.

**At read time** (dot 1792053573 #2): a pose whose blended set is invalid is refused by `atPose` / `previewAt` (`domain-fold` or `domain-outside`, naming the layer and the pose). The bench already handles a refused pose: it shows `✗` and the message in the status line and draws the view as it does for any refused pose; nothing crashes. Tested at a pose between two valid views that turns through the back.

**Which edits, checked on the final state** (dot 1792053573 #4, "the entry and the final state agree"):
- at a view ≠ front, an edit is refused (`domain-generated`) if its final state differs from the state before in any domain layer's:
  - points or lines (added, removed, moved between layers);
  - stored positions or handles in that view;
  - joins or links touching its points.
  This covers every path (move, handles, 四角, split, paste, layer moves, smooth joins, apply-from-view), not just the ones listed. Edits that change only widths, end strokes, zones, visibility or locks stay allowed (they are not generated).
- at the front, every edit is allowed, then the validity checks above run.
- corrections:
  - `correct` touching a domain layer's controls (points or handle ends) is refused;
  - adding a domain to a layer with any correction (point or handle) is refused.
- links and mirror pairs:
  - adding a domain to a layer with linked points or with points in a mirror pair (`apply` pairs) is refused;
  - creating a link or a mirror pair touching a domain layer is refused.

## 5. Edits
- `addSphereDomain(layer)`, `removeSphereDomain(layer)`, `setSphereAnchor(layer, at)`, `setSphere(layer, view, partialSet)`; each one undo step.
- Effects: `shared: ['domains']`, `settle: none`. A parameter edit writes `domains` only: no settling, no merging, the unused stored views untouched (dot 1792053573 #5).
- Copy layer carries the domain; deleting a layer drops it.
- Playback: the gate refuses all four (setting 30° / 60° comes later through the same logic, bowen 1792052788).

## 6. File
- Archive 13 → 14: `domains` holds the per-layer records above.
- Open checks: the shape (known layers; finite numbers; scale > 0; r > 0; |yaw|, |pitch| < 90; known view keys), and the same meaning as the edits (dot 1792053573 #5):
  - the 9 views' sets valid;
  - no corrections, links or mirror pairs touching a domain layer.
  A file that fails is refused.
- `legacy.fromV13`: identity (no domains).

## 7. Bench (first version)
bowen 1792053508: the sphere is modelled in the background; what he sees is one "sphere deform" frame, like the selection box (move, corner scale, rotate), plus two sliders yaw and pitch; the layer's lines follow. (r as a third slider 「弧度」 or fixed: asked in Claude 1792053576.)

- Layers panel: 「加球面域」 / 「去掉球面域」 on the current layer.
- At a view ≠ front, the frame for that view's set:
  - drag inside: offset; corner handles: scale (uniform); rotate handle: roll;
  - sliders yaw, pitch (and 「弧度」 = r if bowen wants it);
  - the sphere itself is not drawn;
  - the largest fitting error shown beside the sliders.
- At the front: the anchor field only.

## 8. Evidence
**Core:**
- **The map:**
  - identity for any r;
  - the anchor stays fixed under yaw / pitch;
  - r → ∞ approaches an affine compression;
  - the Jacobian against finite differences;
  - refusals for outside and fold, at the threshold.
- **Readers:**
  - views ±90 and ±45 give the mapped front;
  - the front is unchanged;
  - `atPose` at yaw 30 uses the blended set (differs from the blend of the two views' mapped positions, and equals the map with the blended set);
  - reading writes nothing.
- **Edits:** each refusal in §4; undo; copy / delete layer; removing the domain restores the stored views.
- **Archive:** round trip; bad records refused; a v13 file opens as 14 unchanged.

**Bench:**
- add a domain;
- set yaw 40 at view 90,0;
- the canvas and the pose at 30 show the turned eye;
- a drag at view 90 is refused.

**Screenshots:** an eye at the front, at view 90,0 (yaw 40, r at two values) and at playback 30.

## Not in this version
- Editing at 30° / 60°.
- Hair.
- Several spheres per layer.
- A sphere-to-canvas distance (perspective).
- Points on the back of the sphere (hidden instead of refused).
