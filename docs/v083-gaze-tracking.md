# V0.8.3 — View Gaze Tracking

Enabled by default for new and loaded Gaze Eyeball modules. The checkbox is an undoable source setting; derived rotations are never saved and camera movement creates no history.

Each viewport computes a common world target = HeadFrame center + camera-facing unit vector × (10 × radiusX). Each eye independently rotates its HeadFrame-local +Z toward target minus eye center using a shortest-arc quaternion, including a deterministic antipodal solution. Centers and cylinder geometry stay fixed. The entire eyeball reference geometry, iris rim and recessed surface rotate rigidly around the eyeball center. OFF yields identity relative to the base HeadFrame orientation.

Main 2D uses its own orthographic basis. 3D applies per-eye group matrices each frame without rebuilding the head surface. Contour uses the same 3D camera quaternion, derives only the two iris polylines per camera request and reuses resident surface geometry and framing. The source geometry remains unchanged. Base eyeball guide rendering/picking is replaced with posed guide rendering/picking while the module exists, retaining the original guide IDs.

No editable target, recording keys, convergence clamp, eyelids, animation smoothing or mouse tracking.
