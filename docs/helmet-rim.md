# Default Helmet Rim

The complete Side Ring pair and all existing intersection UUIDs remain unchanged. The Helmet domain is now the upper hemisphere union each side cap above a new open Rim. Side Shell roundness evaluation is unchanged.

Rim reuses SIDE_R_1/SIDE_R_3 (and mirrored left endpoints). With normalized radius r and front-to-back z=r(1-2t), y=-rimSag*r*(1-z²/r²). x is evaluated on the existing final Side Shell. Sag ranges 0..0.5, default 0.2. Zero is a straight horizontal projection in side view; nonzero values lower its center. No new points or Bézier shape parameters are persisted.

HELMET_RIM is a system Curve provider with exact evaluation and analytic derivative. It is open, not a Section. Existing ON_CURVE arc-length mapping and BoundaryUse slicing consume it; a small provider branch supports open non-cubic boundaries without cubic fitting. The mirror is derived from the canonical final world-space provider. Side Rings retain their closed providers and full picking/copy behavior.

Both Rim and domain read the same Sag source. HeadFrame, side position, side roundness and Sag invalidate Rim descendants. Patch interpolation and continuity solvers are unchanged; they consume provider geometry as before. Rim records are undeletable, editable only through Sag, and reuse existing save/load and history.
