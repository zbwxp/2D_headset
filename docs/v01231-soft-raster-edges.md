# V0.12.31 — Soft Raster Edges

Replaces V0.12.30's scattered particle effect with continuous raster line-art softening. Existing curve-level `mist` settings and UI controls are retained without migration. There is no particle mode, grain, dithering or per-frame randomness.

The effect rasterizes the actual visible ink outline (including taper, cusp tips, display intervals and derived arc joins), applies a Gaussian blur, then resamples with a slowly varying two-dimensional displacement and shade field. Drift is bounded to 1.4 logical pixels; closely adjacent pixels see closely adjacent displacements. Alpha has subtle tonal steps, providing grayscale raster edges at high zoom rather than sprayed dots. The sharp source vector, geometry and interaction targets remain unchanged.

The existing bounded, local-coordinate cache remains: width/ink changes rebuild it; opacity, camera pan/zoom and selection reuse it. Save/Load contains only the settings, not pixels. Old values produce the new rendering automatically; apparent opacity can be softer because blur now follows actual line weight rather than dense particle coverage.

Validated 25 domain tests and 4 browser tests, including a connected grayscale-edge check (one connected component, 26 alpha levels in a straight-line example), isolated members, Undo/Redo, stable zoom, Save/Load and source editing. Real hair fixture: warm zoom ~46 ms per action and handle drag ~33 ms per event in local Chrome. These are local measurements, not frame-rate guarantees. Build passes.

Visual comparisons: `artifacts/drawing-room/mist-v01231/old-particles.png` and `soft-edges.png`.
