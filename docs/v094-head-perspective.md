# V0.9.4 — HeadSet Perspective

HeadSet → Construction → HeadSet Perspective adds independent X/Y strengths (0–1, default 0). Numeric entry, drag, arrow keys, Undo/Redo and project Save/Load use the existing control/transaction paths. Eye Set retains its independent settings.

The connected HeadSet uses one continuous camera-local display transform, applied after final source evaluation. With HeadFrame center as origin, camera depth `d`, largest frame radius `R` and local camera yaw `θ`:

```
kx = 0.55 * X * sin²(θ) / R
ky = 0.40 * Y * sin²(θ) / R
x' = x / max(0.25, 1 - kx*d)
y' = y / max(0.25, 1 - ky*d)
d' = d
```

This gives stronger near-side scale and smaller far-side scale without splitting the head into independently scaled halves. Frontal views and zero strength are identity. The denominator floor bounds extreme positions outside the head. HeadSet source coordinates, handles, patch parameters and evaluated source geometry are unchanged. Settings are optional `headPerspective: {x,y}` project data; old projects default to zero.

Main 2D follows its own camera. Inspection and Contour follow the inspection camera. All HeadSet surfaces, real boundary curves, points and authoring overlays share the transform. Surface display normals are recomputed after posing. Curves are sampled before the nonlinear warp, including straight source curves. Contour receives the posed mesh and posed boundaries together; extraction and visibility algorithms are unchanged.

Point/control-handle editing inverses the transform at the editing depth. Analytic Loomis/Cap picking inverses the screen ray within the head-frame domain. Surface chart editing picks the displayed mesh but writes source UV coordinates.

Validation covers front/zero identity, separate X/Y, near/far behavior, negative-yaw reflection, common boundary positions, exact inverse editing, analytic surface picking, Eye Set isolation, persistence, Contour source posing, actual browser slider transactions, 3D picking and control-handle drag, Contour update and orbit. Existing Free 3D handle tests also passed.
