import type { HeadProject } from "../project/types";
import { project } from "../geometry/core";
import { curveFromPoints } from "../curves/polyline";
/** Upgrade the legacy front+back closed ring to the fixed front meridian. */
export function normalizeMidline(p: HeadProject) {
  const ring = p.semanticModel.rings.find((r) => r.id === "midline_curve");
  if (!ring) return;
  if (ring.closed) {
    const bottom = ring.samples.findIndex((s) => Math.abs(s.u - 0.5) < 1e-8);
    if (bottom > 0)
      ring.samples = ring.samples
        .slice(0, bottom + 1)
        .map((s) => ({ ...s, u: s.u * 2 }));
  }
  ring.closed = false;
  ring.editable = false;
  ring.color = "#ffc879";
  for (const c of p.constraints.filter((c) => c.entityId === ring.id)) {
    const v = p.views.find((v) => v.id === c.viewId)!;
    c.curve = curveFromPoints(
      ring.samples.map((s) => project(p.surface.vertices[s.vertexId], v)),
      false,
    );
    c.curve.handles = [];
    c.strength = "guide";
    c.userAuthored = false;
    c.enabled = true;
  }
  return p;
}
