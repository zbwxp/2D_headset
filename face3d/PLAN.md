# face3d — a 3D standard face bone set (isolated experiment)

Branch `exp/face-bones-3d` (worktree `~/Documents/headset-face3d`). Not wired into core, the bench or any archive
(dot 1792487927). Everything lives in `face3d/`.

## 0. Requirements (provenance)
- bowen 1792487883: Claude builds a 3D bone-line set for an anime face, face contour included, as a model; bowen later
  deforms / offsets these standard bone lines; Claude and dot choose the modelling; bowen is consultant.
- bowen 1792487883, contour idea: each key view has its own contour line; between key views the line is the
  proportional mix of the two neighbouring lines. The 90° nose-profile line is left for later.
- dot 1792487927: first deliverable is a standalone prototype — rotate, edit the bones, see the 25-cell comparison.
  90° nose profile and occlusion come later.
- dot 1792488006, three constraints:
  1. key contours sampled over yaw × pitch together (not level-only then tilted); correspondence segment by segment —
     forehead / cheek / jaw / chin — never mixing different parts;
  2. the 3D mix is an approximate contour, not necessarily the true outline at in-between angles; the viewer keeps a
     switch "contour straight from the rough head" so a sweep shows the difference;
  3. state how key contours update when cheek / jaw are edited — bones never left floating off an edited head; the
     first acceptance includes one reshape followed by a continuous rotation.
- Not decided here, for later: 90° nose profile, occlusion (hidden-line removal), hair, export to the editor's
  standards.

## 1. Frame and units
- Head space, unit = head-ball radius R. Origin = the ball centre. x to the screen's right at yaw 0, y up, z toward the
  viewer at yaw 0 (the face looks along +z).
- View (yaw, pitch), orthographic, same as the landmark viewer: turn by yaw about y (yaw > 0: the face turns toward the
  screen's right), then tilt by pitch about x (pitch > 0: looking up at the face, 仰视; < 0: 俯视).
- Character data: the level row of the generated sheet (round 5 with the mouth fix): front cell for x / y, 90° cell
  for z. It is a hypothesis (dot 1792487307), recorded with its source; bowen corrects it later.

## 2. The rough head (the source of contours)
- A loft: horizontal sections from the crown to the chin, each a superellipse in x–z: half-width `a(y)`, front `f(y)`,
  back `b(y)`, roundness `n(y)` (2 = ellipse, larger = squarer cheeks). Above the brow the sections are the ball.
- The face front `f(y)` goes forehead → nose root → philtrum → lips → chin with **no nose** (the nose is a surface
  bone; the 90° nose profile is out of scope).
- A neck cylinder below the jaw, separate from the loft.
- Every surface point has parameters (v = section height, u = angle round the section); the loft maps (u, v) → 3D
  and gives the normal there.
- Editing the head = editing `a / f / b / n` at a few control heights (temple, cheek, jaw angle, chin): smooth curves
  through them.

## 3. Surface bones (rigid, attached)
- Eyes (loop + iris), brows, nose (bridge, tip, wings, base), mouth (corners + centre), chin tip, ear root and ear rim.
- Stored attached to the head: (u, v, h) — a surface point plus an offset h along that section's outward direction
  (the nose tip has a large h). Reshaping the head moves them with it; rotating rotates them rigidly.
- The ear rim is a real edge of the ear, treated as rigid in v1 (noted: the ear is a thin shell; its visible outline
  can change near the back views).

## 4. Contour bones (per key view, mixed)
- Key views: yaw {0, 30, 60, 90} × pitch {−45, −30, 0, 30, 45}; negative yaw by mirror (x → −x).
- Lines are points joined by straight segments (bowen 1792488168); Bézier fitting may come later.
- At a key view, *candidate* outline = where the surface normal is perpendicular to the view direction, traced on the
  (u, v) grid (closed loops). Candidates are not all drawn (dot 1792488237): the head is projected to a mask and its
  outer boundary traced; a candidate point is *visible outline* when it lies on that boundary (within one mask pixel).
  The switch "straight from the rough head" draws exactly this visible outer boundary.
- Each side (x+ and x−) of the face contour has four anchors and three segments: chin → jaw angle → cheek → temple.
  - chin: the candidate-loop point nearest (in 3D) to the chin landmark — not a crossing of u = 0, which pitched and
    side views need not have;
  - walk from the chin along the loop toward that side (u > 0 for x+, u < 0 for x−), leaving the face region
    (|u| > 110°) ends the walk;
  - jaw angle, cheek, temple: the *first* point of the walk whose section height reaches that anchor's height
    (later crossings — the loop folding back — are ignored, so each anchor is unique);
  - an anchor not reached before the walk ends: that segment and every one above it are *absent* at this key.
  Each present segment is resampled to a fixed count by arc length. Correspondence is per segment (dot constraint 1);
  equal counts alone are not the correspondence — the anchors are.
- An absent segment (or a present one not on the visible outline) is kept with positions and marked not visible
  there. Positions of an absent segment = the same segment of the level key (yaw 0, pitch 0) — the surface line where
  that part of the face edge sits when it is the outline. Mixing mixes positions and visibility, so a segment fades
  instead of jumping. Recorded as an approximation: the in-between line of a fading segment is not a true outline.
- Stored per key view: the samples as surface parameters (u, v) (the *base line*) + a user offset per sample (zero
  until bowen edits it, F2).
- The offset's frame (dot 1792488237): a 2D vector in that key view's picture plane (the key camera's right / up
  axes), in head units R. Applied as base point + right·dx + up·dy, which moves the point parallel to that key's
  screen, so at that key the drawn line moves exactly as dragged and its depth is the base point's depth.
- Two separate guarantees, never one: (a) the base line always comes from the current head (it is re-traced after a
  head edit, so it stays on the head); (b) the offset is kept per sample relative to the base line. An offset point
  is generally **not** on the head's surface and is not promised to be — that is what bowen's deform means.
- Between key views: bilinear weights over the four surrounding keys; mix the corresponding samples in 3D, then
  project with the real rotation. At a key view the weights are 1/0/0/0, so the drawn line is the key exactly.
- **After a head edit** (dot constraint 3): every key contour's base line is traced again from the new head (anchors
  found again by the rules above), and the stored offsets are re-applied sample by sample. Base lines stay on the head;
  offsets survive the reshape as relative displacements (guarantee (a) and (b) above, separately).

## 5. Viewer (the prototype)
- A fixed address on this Mac (bowen 1792488104): refresh to see the latest model. Rotate by drag and sliders;
  nothing else is required of bowen.
- Switch: contour = key mix (default) / straight from the rough head (dot constraint 2); both together in two colours.
- 25-cell strip: the master grid (1600 × 1600, cells 320 × 300, ball (160, 148), R 78), drawn live from the model.
- Edit: the rough head (control heights' half-width / front / roundness), key contour points (drag in a key view →
  that key's offset), surface bone points (drag → u, v, h).
- Save / load the model as JSON (not the core archive).
- Marked missing: the 90° nose profile; occlusion.

## 6. Evidence (each package, rendered images included)
- Continuity: approaching each key view from both sides converges to the key's line; no jump at segment anchors.
- Correspondence: anchors drawn; counts per segment fixed; mirror symmetry at yaw 0.
- Mixed vs true outline: the largest distance between the mixed contour and the head's own outline at in-between
  angles (yaw 15 / 45 / 75 × pitch 15 / −15 / −38), reported in R and as a picture.
- Reshape: widen the jaw / cheek, then sweep yaw 0 → 90 and pitch −45 → 45: bones stay on the head (distance from
  the surface), offsets survive, no jump.
- Unit tests for the math (loft, outline tracing, anchors, resampling, mixing, mirror).

## 7. Packages
- F1: rough head + surface bones + key contours + mixing + viewer (rotate, switch, 25 cells). No editing yet.
- F2: editing (head, key contour offsets, surface bones), save / load, the reshape acceptance.
- Later (not now): 90° nose profile, occlusion, hair, export to the editor's standards.
