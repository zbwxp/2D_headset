# V0.8.5 — Eye Default from 眼部研究.json

New scaffold defaults use the supplied study's normalized dimensions and location:
x=0.5, y=-0.3665315937744661, z=0.5911634322080732, cylinder rx=rz=0.25,
height=0.7, eyeball rx=ry=rz=0.25, ballOffsetX=0. Perspective defaults X=
0.234422041418454, Y=0. New Gaze Eyeball defaults irisScale=0.3,
recessDepth=0.12, tracking=false. Existing saved parameters are not overwritten.

Creating Eyes now also creates the local +Z half of each elliptical cylinder.
Each half uses two ordinary Quad Patches, with the existing top/bottom quarter
arcs and generators as boundaries. No extra seam curves, points or surface type;
no top/bottom/back cap. Each right quarter is canonical with a mirrored left
quarter. Boundary mirror mapping uses the stable eye-scaffold IDs. The sidebar
shows two paired rows. Fullness starts at zero; ordinary Patch editing applies.

Existing projects have an idempotent Add Missing Front Cylinder Patches command,
with one Undo transaction. It leaves source points, curves and eye parameters
unchanged. Save/load retains the ordinary Patch records and Eyes ownership.

Eye surface display uses the same per-eye perspective matrix as the wire guides
in Main 2D and 3D. Contour reuses cached surface geometry and applies the same
matrix to only the Eyes vertex ranges and boundary lines per camera. These
surfaces remain subject to normal Contour visibility/occlusion. Gaze rotation
continues to affect the eyeball, not the cylinder patches.
