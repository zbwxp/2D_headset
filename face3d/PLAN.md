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
- At a key view the contour comes from the head's true outline (where the surface normal is perpendicular to the view
  direction), traced on the (u, v) grid.
- Each side (x+ and x−) of the face contour has four anchors and three segments:
  temple → cheek → jaw angle → chin. Anchors: temple, cheek, jaw angle = the outline's crossing of fixed section
  heights (v); chin = its crossing of the midline (u = 0). Each segment is resampled to a fixed count by arc length.
  Correspondence is therefore per segment (dot constraint 1).
- A segment that is not on the outline at a key view (the near side's temple–cheek when the face turns away) is kept
  as the surface line between its anchors and marked not visible there; mixing mixes positions and visibility, so it
  fades instead of jumping.
- Stored per key view: the samples as surface parameters (u, v) + a user offset in that view's picture plane (zero
  until bowen edits it).
- Between key views: bilinear weights over the four surrounding keys; mix the corresponding samples in 3D, then
  project with the real rotation. At a key view the weights are 1/0/0/0, so the drawn line is the key exactly.
- **After a head edit** (dot constraint 3): every key contour is traced again from the new head, the stored user
  offsets are re-applied sample by sample (they are relative to the traced outline, not absolute positions). So the
  bones stay on the head and bowen's adjustments survive the reshape.

## 5. Viewer (the prototype)
- Rotate by drag and sliders; the 25 presets of the master sheet.
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
