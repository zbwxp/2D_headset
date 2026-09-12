import type { LandmarkView } from "./model";

/** Add missing presets without replacing authored cameras, photos, or canvas settings. */
export function ensureObliqueViews(views: LandmarkView[]): LandmarkView[] {
  const result = [...views];
  for (const degrees of [15, 30]) {
    const id = `right${degrees}`;
    if (result.some((v) => v.id === id)) continue;
    const angle = (degrees * Math.PI) / 180;
    const view: LandmarkView = {
      id,
      label: `右 ${degrees}°`,
      shortLabel: `右 ${degrees}°`,
      camera: {
        projection: "orthographic",
        position: [4 * Math.sin(angle), 0, 4 * Math.cos(angle)],
        target: [0, 0, 0],
        up: [0, 1, 0],
        zoom: 1,
      },
      canvas: { zoom: 1, pan: [0, 0] },
    };
    const index = result.findIndex((v) => v.id === "right45");
    result.splice(index < 0 ? result.length : index, 0, view);
  }
  if (!result.some((v) => v.id === "top")) {
    const view: LandmarkView = {
      id: "top",
      label: "纯俯视",
      shortLabel: "俯视",
      camera: {
        projection: "orthographic",
        position: [0, 4, 0],
        target: [0, 0, 0],
        // Keep world X screen-right; the face (+Z) points down the screen.
        up: [0, 0, -1],
        zoom: 1,
      },
      canvas: { zoom: 1, pan: [0, 0] },
    };
    const index = result.findIndex((v) => v.id === "high45");
    result.splice(index < 0 ? result.length : index + 1, 0, view);
  }
  return result;
}
