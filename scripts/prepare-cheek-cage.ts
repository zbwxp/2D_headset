/** One-time project preparation, not an application migration or special editing rule. */
import { readFileSync, writeFileSync } from "node:fs";
import { parseLandmarks } from "../src/domain/landmarks/persistence";
import { duplicateLandmark } from "../src/domain/landmarks/management";
import { createCurve } from "../src/domain/curves/management";
import { mirror, modelStateCode } from "../src/domain/landmarks/model";
import type { Vec3 } from "../src/domain/project/types";
const source = parseLandmarks(
  readFileSync("artifacts/head-neck-refinement/refined.json", "utf8"),
);
if (source.landmarks.length !== 47 || source.curves.length !== 62)
  throw Error("Unexpected source counts");
const A = "c72513a5-3dee-4121-ba4f-766e6d8a60a9",
  C = "c745ec0b-b4ff-4da8-9476-59ec3aae20af";
if (
  !source.curves.some((c) => c.startLandmarkId === A && c.endLandmarkId === C)
)
  throw Error("A–C edge missing");
// UUIDs and final coordinates recorded from the ordinary editor operations in the user's tab.
const ids = [
  "d50bc14f-fa43-44df-b351-75ec9bd8c16c",
  "82c3df8a-1cd3-474e-a829-f8439046881d",
  "69cc200e-9882-4a60-9690-f7ba1fd6ea05",
  "adfb53ce-4c73-4e17-b462-41484214e797",
  "e7e3c559-7418-46ce-bde8-ca31ebb6299b",
  "55195070-3551-40b0-b6c9-2d1c7ceba5e9",
];
let i = 0;
const original = crypto.randomUUID;
crypto.randomUUID = () =>
  ids[i++] as `${string}-${string}-${string}-${string}-${string}`;
let p = duplicateLandmark(source, A, "颊峰点").project;
const B: Vec3 = [
  79.54586061272899 / 160,
  -86.76695099588616 / 160,
  127.79328695418675 / 160,
];
p = {
  ...p,
  landmarks: p.landmarks.map((l) =>
    l.id === ids[0]
      ? { ...l, position: B }
      : l.id === ids[1]
        ? { ...l, position: mirror(B) }
        : l,
  ),
};
for (const [a, b, name] of [
  [A, ids[0], "颊部体积线·颧颊至颊峰"],
  [ids[0], C, "颊部体积线·颊峰至下颊"],
])
  p = createCurve(p, a, b, p.views.find((v) => v.id === "side")!, name).project;
crypto.randomUUID = original;
p = parseLandmarks(JSON.stringify(p));
writeFileSync(
  "artifacts/patch-prep/cheek-cage.json",
  JSON.stringify(p, null, 2) + "\n",
);
console.log({
  sourceHash: modelStateCode(source),
  resultHash: modelStateCode(p),
  B,
  points: p.landmarks.length,
  curves: p.curves.length,
});
