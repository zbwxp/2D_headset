import { ensureObliqueViews } from "./views";
import type { LandmarkProject, SemanticLandmark, LandmarkView } from "./model";
import { mirror } from "./model";
import type { Vec3 } from "../project/types";
export function createLandmarkProject(): LandmarkProject {
  const landmarks: SemanticLandmark[] = [];
  const make = (
    name: string,
    position: Vec3,
    type: SemanticLandmark["type"],
  ): SemanticLandmark => ({
    id: crypto.randomUUID(),
    name,
    placement:{kind:"WORLD",position},
    type,
    viewLocks: {},
  });
  const centers: [string, Vec3][] = [
    ["颅顶点", [0, 1.22, 0]],
    ["山根点", [0, 0.38, 0.83]],
    ["鼻尖点", [0, 0.03, 1.03]],
    ["鼻下点", [0, -0.18, 0.87]],
    ["人中点", [0, -0.28, 0.83]],
    ["下巴尖点", [0, -1.05, 0.56]],
  ];
  centers.forEach(([n, p]) => landmarks.push(make(n, p, "CENTERLINE")));
  const pairs: [string, Vec3][] = [
    ["眉头点", [0.17, 0.47, 0.8]],
    ["眉尾点", [0.61, 0.43, 0.61]],
    ["内眼角点", [0.19, 0.26, 0.82]],
    ["外眼角点", [0.57, 0.26, 0.67]],
    ["嘴角点", [0.3, -0.46, 0.74]],
    ["上耳根点", [0.79, 0.3, 0.02]],
    ["下耳根点", [0.74, -0.38, 0.02]],
  ];
  pairs.forEach(([n, p]) => {
    const l = make("左" + n, p, "LEFT"),
      r = make("右" + n, mirror(p), "RIGHT");
    l.mirrorPartnerId = r.id;
    r.mirrorPartnerId = l.id;
    landmarks.push(l, r);
  });
  const defs: [string, string, Vec3][] = [
    ["front", "正面", [0, 0, 4]],
    ["left45", "左 45°", [-3, 0, 3]],
    ["right45", "右 45°", [3, 0, 3]],
    ["side", "侧面", [4, 0, 0]],
    ["high45", "俯 45°", [0, 3, 3]],
    ["low45", "仰 45°", [0, -3, 3]],
  ];
  const views: LandmarkView[] = defs.map(([id, label, position]) => ({
    id,
    label,
    shortLabel: label,
    camera: {
      projection: "orthographic",
      position,
      target: [0, 0, 0],
      up: [0, 1, 0],
      zoom: 1,
    },
    canvas: { zoom: 1, pan: [0, 0] },
  }));
  return {
    version: "landmarks-0.4.9.1",
    curves: [],
    meta: {
      name: "语义点头部研究",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    lockedViews: [],
    centerlineOrder: landmarks
      .filter((l) => l.type === "CENTERLINE")
      .map((l) => l.id),
    landmarks,
    views: ensureObliqueViews(views),
  };
}
