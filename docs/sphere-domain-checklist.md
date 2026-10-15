# Sphere domain (球面域), first version: checklist before any code, for dot's review

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
- **The front view's set is always the identity** and cannot be edited: the front is where the eye is drawn (bowen 1792052788).

## 2. The map (per view or pose; mapping A)
For a front point p:
1. q = p − anchor; refused if |q| ≥ r (see §4).
2. On the sphere: P = (q.x, q.y, √(r² − |q|²)). The front pole is (0, 0, r).
3. Turn: P′ = R(yaw, pitch) · P; pole′ = R · (0, 0, r).
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
- **A pose's reader** (`atPose`, `previewAt`): evaluate as today, then the domain layers' points and handles are replaced by the map of the front geometry with the **blended set**. The blend uses the pose's geometric weights of its cell's four views (3a's bilinear weights), each parameter linearly. So in-between angles follow the sphere (乙), not a blend of positions.
- **Everything downstream** (snapshot, geometry, ink, fills, masks, hit-testing, name labels) reads those readers and follows without change.
- **Unchanged per view:** widths, end strokes, zones, joins. Only positions and handles are generated.

## 4. Refusals (never repaired)
- **A point outside the sphere:** any sampled point of the layer's front lines (end points and 16 samples per curve) with |q| ≥ r in some view → refused (`domain-outside`, naming the view).
- **Folding:** any sampled point turned to depth P′.z ≤ 0.05 r in some view or blended corner → refused (`domain-fold`). A sampled check, as `deform/`'s.
- **When:** any edit after which some view (or a pose's corner set) would break these is refused whole, whichever edit it is (a view's parameter, or a front edit of the layer's lines). Proposal; dot to review (the alternative, letting a front edit through and showing the view as broken, contradicts "refused, never repaired").
- **Generated geometry is not edited directly:** at a view ≠ front, an edit that writes positions or handles of a domain layer's points is refused (`domain-generated`): move, handles, 四角, apply-from-view, mirror apply into the layer.
- **Corrections:** `correct` on a domain layer's controls is refused. Adding a domain to a layer that has corrections is refused (clear them first; the bench already has 「删除选中图层的全部修正」).
- **Links:** adding a domain to a layer with linked points, and linking into a domain layer, are refused (a linked partner would have to follow generated positions).

## 5. Edits
- `addSphereDomain(layer)`, `removeSphereDomain(layer)`, `setSphereAnchor(layer, at)`, `setSphere(layer, view, partialSet)`; each one undo step.
- Effects: `shared: ['domains']`.
- Copy layer carries the domain; deleting a layer drops it.
- Playback: the gate refuses all four (setting 30° / 60° comes later through the same logic, bowen 1792052788).

## 6. File
- Archive 13 → 14: `domains` holds the per-layer records above.
- Open checks: known layers; finite numbers; scale > 0; r > 0; known view keys; no set for the front.
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
