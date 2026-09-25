# V0.8.4 — Eyes Stylized Perspective

Eyes / Construction contains shared X and Y Perspective Strength sliders (0–1,
initially 0). They persist on eyeScaffold.perspective and participate in normal
edit sessions/Undo. Old files default to zero. HeadSet geometry is untouched.

A view-derived, invertible affine map is applied separately to each eye, after
its gaze pose and before the viewport's existing projection. For HeadFrame-local
yaw θ and side sign σ (right +1):

- horizontal scale = 1 + 0.55 X σ sin θ;
- vertical scale = 1 + 0.40 Y σ sin θ;
- projected eye-center separation *= 1 − 0.30 X sin² θ.

Scale is about each cylinder's center. Depth is retained. The map is identity
at frontal yaw and mirrored for negative yaw. It remains bounded at all yaw
angles; it is an art control, not a physical lens. Existing perspective cameras
retain their own perspective underneath this correction. Zero restores exactly
the prior projection, including any existing physical perspective.

Main 2D uses its own view; 3D and Contour use the 3D orientation. Cylinder guides,
eyeball guides, iris cap/rim and ordinary Eyes point/curve display use this map.
The iris cap remains 3D-only. Explicit contour-visible Eyes curves keep the
existing visibility/occlusion pass; the iris retains its always-visible policy.
HeadSet and Recording Room are not deformed. This version does not add a new
Eye surface/patch system or alter source evaluators.

3D uses object matrices on cached eye geometry, so orbit does not regenerate
source geometry. Picking uses the same transformed positions. 2D free-point and
curve editing invert the display map before writing source edits; on-curve drag
searches the transformed curve. Canvas pan/zoom and view depth remain separate.

Checks: near/far scale, independent Y, center separation, negative-yaw mirror,
front/zero identity, iris shared rim, inverse edit mapping, module isolation,
source immutability, old-file defaults and validation; browser slider, history,
roundtrip, displayed widths and 3D point picking, plus existing eye/gaze tests.
