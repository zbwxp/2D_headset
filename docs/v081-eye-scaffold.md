# V0.8.1 — Default Eye Scaffold

Eyes → Construction → Create Default Eye Scaffold creates two editable wire guides. Each eye has top/bottom elliptical rings, four vertical generators, an axis, three eyeball reference rings and a center point. No Patch, mesh or Contour feature is created.

All parameters use HeadFrame-local axes and radiusX (R) as the unit. Defaults: centers ±0.48R, −0.03R, 0.88R; cylinder radii 0.33R/0.23R, height 0.7R; eyeball radii 0.25R/0.28R/0.2R. Left/right edits share one canonical parameter set. X is the nonnegative distance from the midline; the left center is mirrored. V1 independent-eye saves migrate using right-eye parameters, retaining both sides’ object UUIDs. The ellipsoid defaults to the cylinder center. Shared ballOffsetX (in R, default 0) offsets only the eyeball and attached iris: negative values move both eyes inward, positive outward. Cylinder and group-center markers stay fixed. Legacy saves default to zero offset.

Selecting any guide opens its eye controls. Edit center XYZ, cylinder radii/height or eyeball XYZ radii using NumericSlider, including direct numeric entry and edit-session Undo. Generated guide vertices/handles cannot be edited separately. Ellipses use four cubic quarter-arc approximations, reusing existing point/curve display and picking.

Eye scaffold parameters and stable generated object IDs are persisted with geometry. HeadFrame edits regenerate the guides; HeadSet treats them as read-only reference. Eyes cannot modify ordinary HeadSet geometry. Creation, parameter changes and undo use existing project transactions.

No recording integration, eye surfaces, lids, projection solver or new mirror parameter system is included.
