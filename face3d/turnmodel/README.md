# 转头模型 — the turning head

The final anime turning-head model (bowen 1792849247 「打包」). One pure function: a head yaw goes in, every line of that view
comes out, each with the rule that decides what of it is seen.

- Code: `face3d/turnmodel/index.ts` — `evaluate(model, yaw, params?) → Frame`. No drawing, no DOM.
- Data: `bench-tasks/转头模型/model.json`, built by `bench-tasks/转头模型/build.py` from bowen's files (read only). Every path is relative to the repository.
- Viewer: `face3d/viewer/turnmodel.html` (port 5192). It only draws; the parameters can be tried in its boxes (not saved).
- Tests: `face3d/turnmodel/turnmodel.test.ts`, in the project run (`npx vitest run`); `fixtures/old-turncheck.json` is the old turncheck's output at nine yaws, the new model is checked against it.

Yaw runs −90 … 90. A turn to the other side is the mirror of the same turn (bowen 1792603165).

## Input data (bowen's drawings)

| Data | What | Source |
|---|---|---|
| outline keyframes 0 / 45 / 90° | the near ear root, far 颧骨点 and 太阳穴点 (heights fixed, only sideways) and the five outline lines' handles | bowen's hand-tuned files; 90° far face pulled in 5 (1792811015), chin handle (1792764100) |
| side face (脸片) | each point's 90° x and height; the six side lines' 90° handles; the speed curve's 5 numbers (from the old rigid sheet, θ 43.58° at 45°) | bowen's 侧脸 files (1792674653); 5 numbers bowen 1793026252 |
| eye | bowen's 0° near eye (three lines), its track centre and depth (z 65.34), sphere radius 40 | 眼睛骨线 files (1792675801) |
| ear | bowen's hand-tuned near ear at 90° (two lines) | 耳朵骨线 files (1792813942) |

## Rules

1. **Outline.** Near two lines (nearJaw, nearSkull), far three (farJaw, farCheek, farSkull). Points and handles go through the
   0 / 45 / 90° keyframes with a smooth cubic whose speed is continuous (平滑插值, bowen 1792762034). Shown outside the side face.
2. **Side face (脸片)** — keyframes like the outline (bowen 1793026252): 0° = every point on the midline, 90° = bowen's side face.
   One speed curve for the whole part says how far between the two the turn has got: about 0.251 / 0.486 / 0.689 / 0.858 / 0.964 at
   15 / 30 / 45 / 60 / 75°, linear in between. Heights are kept; handles are squeezed the same way. The numbers are the old rigid
   sheet's (x = d·sin θ, bowen 1792762758); the curve is at most 0.84 off it (nose tip), 0 at the knots. The crown and the chin are
   side-face points that the outline shares. Shown outside the face outline.
3. **Eyes — 朝向 + 远近** (bowen 1792769914, final 1792811289):
   - the centre turns with the head on its track, x = x0·cos ψ + z·sin ψ;
   - the sphere frame counts from the eye facing the camera: bowen's 0° eye already faces α away, so the near eye turns
     γ·(ψ − α) (it first turns to the camera and widens) and the far eye −γ·(ψ + α) (「反向弯」, bowen 1792686126 / 1792770380);
     the part turned past edge-on is not seen;
   - 近大远小: each eye is scaled by its own depth, across and up alike.

   The near eye shows inside the outline or the side face. The far eye shows inside the outline and outside the side face.
4. **Near ear** (bowen 1792813942): 上耳点 / 下耳点 sit on nearSkull / nearJaw at fixed heights (线上点). The ear is bowen's 90°
   ear, a plate turned φ0·(1 − yaw / 90) away from the camera: sideways offsets × cos(facing), heights kept.
   The ear's **shape** at 90° is bowen's exactly (tip offset and handles); its **position** is not. The fixed heights put
   上耳点 / 下耳点 0.6–1.1 away from where he drew them at 90°, and 0–2.3 at 0° and 45°. This is the result of the chosen rule,
   and it was not re-fitted (dot 1792856044).
5. **Far ear** (bowen 1792814749, 1792837565, 1792846244): the mirror of the near ear, hung on a 假线. The 假线 is the symmetric
   two-line contour on the far side; it turns with the head and shares the crown and chin. Its ear root is the near one's
   mirror turned with the head, plus push × how far the far 颧骨点 has moved out since 0°. The far ear faces
   φ0·(1 + yaw / 90). Shown outside the face outline and the side face.

## Parameters

| Name | Value | What | Source |
|---|---|---|---|
| eyeAlpha | 28° | each eye faces this far off the camera at 0° | fit to the thirds 0–50° + bowen's 90° near eye width |
| eyeRate | 0.76 | the sphere frame turns this × the head | same fit |
| eyeKappa | 0.003 | 近大远小 on depth | near/far eye height 1.12 at 45° (his 45° reference 1.08–1.16) |
| earFacing0 | 46.3° | the ear plate faces this far away at 0° | bowen's 0° ear width 14.4 = 20.9 · cos 46.3° |
| earUp / earLow | 1.6 / 30.2 | 上耳点 / 下耳点 heights | the mean of bowen's 0 / 45 / 90° ear keys |
| fakePush | 0.4 | how much the 假线 ear root slides out with the far 颧骨点 | the far ear still shows a little at 30° and is gone at 32° (bowen 1792846244; dot's pictures 25–30°) |

## Not in the model

- The two top principles are 透视三等分 and 露出瞳仁 (bowen 1792773388). Here they are only checked against the model; neither is
  a rule in it. The eyes meet the thirds within 1.4 on average over 0–50°. The far iris is covered by the side face at
  68–72°: bowen accepted this, since the far eye is nearly invisible after 65° (1792811612).
- The history (17 outline versions, the thirds eyes, the old eye tables, the far-eye hand-tuning panel) is in the old
  `turncheck.html` and in git (exp/face-bones-3d up to ab92e5f0).
