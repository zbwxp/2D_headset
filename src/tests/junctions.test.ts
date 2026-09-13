import { it, expect, describe } from "vitest";
import {
  resolveNetwork,
  plane,
  eigen,
  exact,
  targetTangent,
} from "../domain/surfaceSmooth/solver";
import {
  config,
  setConfig,
  incident,
  key,
} from "../domain/surfaceSmooth/config";
import { createLandmarkProject } from "../domain/landmarks/presets";
import { parseLandmarks } from "../domain/landmarks/persistence";
import { controls, type ControlPoints } from "../domain/curves/geometry";
import {
  createCurve,
  deleteCurve,
  renameCurve,
} from "../domain/curves/management";
import {
  deleteLandmark,
  duplicateLandmark,
} from "../domain/landmarks/management";
import {
  add,
  scale,
  sub,
  cross,
  normalize,
  dot,
} from "../domain/geometry/core";
import { evaluate, derivative, norm } from "../domain/junctions/spatial";
import { mirror, type LandmarkProject } from "../domain/landmarks/model";
import type { Vec3 } from "../domain/project/types";
import data from "./fixtures/ear-eye.json";
function fixture(
  tangents: Vec3[] = [
    [1, 0, 0.2],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0.3],
  ],
  reverse = false,
): LandmarkProject {
  const p = createLandmarkProject();
  p.landmarks = [
    { id: "v", name: "v", type: "FREE", position: [0, 0, 0], viewLocks: {} },
  ];
  p.curves = [];
  p.centerlineOrder = [];
  tangents.forEach((t, i) => {
    const u = normalize(t),
      end = add(scale(u, 1.2), [0, 0, 0.15]),
      id = `p${i}`;
    p.landmarks.push({
      id,
      name: id,
      type: "FREE",
      position: end,
      viewLocks: {},
    });
    const a: ControlPoints = reverse
      ? [end, scale(end, 0.7), scale(u, 0.4), [0, 0, 0]]
      : [[0, 0, 0], scale(u, 0.4), scale(end, 0.7), end];
    const A = a[0],
      B = a[3],
      d = normalize(sub(B, A)),
      n = normalize(cross(u, end)),
      b = normalize(cross(n, d)),
      L = norm(sub(B, A));
    p.curves.push({
      id: `c${i}`,
      name: `c${i}`,
      role: "canonical",
      startLandmarkId: reverse ? id : "v",
      endLandmarkId: reverse ? "v" : id,
      shape: {
        planeNormal: n,
        startHandle: {
          along: dot(sub(a[1], A), d) / L,
          offset: dot(sub(a[1], A), b) / L,
        },
        endHandle: {
          along: -dot(sub(a[2], B), d) / L,
          offset: dot(sub(a[2], B), b) / L,
        },
      },
    });
  });
  return p;
}
const at = (p: LandmarkProject) =>
  resolveNetwork(p).nodes.find((n) => n.landmarkId === "v")!;
const near = (a: Vec3, b: Vec3, e = 1e-8) =>
  expect(norm(sub(a, b))).toBeLessThan(e);
it("Jacobi eigenvectors satisfy symmetric matrix eigenproblem", () => {
  const M = [
    [2, 0.3, 0.4],
    [0.3, 1, -0.2],
    [0.4, -0.2, 3],
  ];
  for (const e of eigen(M))
    near(
      M.map((r) => dot(r as Vec3, e.vector)) as Vec3,
      scale(e.vector, e.value),
    );
});
it.each([0, 1])("valence %s is no-op", (n) => {
  const p = fixture(([[1, 0, 0]] as Vec3[]).slice(0, n));
  expect(at(p).state).toBe("NO_OP");
  for (const s of resolveNetwork(p).spans)
    expect(s.controls).toEqual(
      controls(p, p.curves.find((c) => c.id === s.curveId)!),
    );
});
it.each([false, true])(
  "two nonparallel tangents are exact source, reversed=%s",
  (r) => {
    const p = fixture(
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      r,
    );
    expect(at(p).state).toBe("VALID");
    expect(at(p).halves.every((h) => !h.fairing)).toBe(true);
    expect(resolveNetwork(p).spans.length).toBe(2);
  },
);
it("already coplanar high valence preserves source exactly", () => {
  const p = fixture([
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0],
  ]);
  expect(at(p).state).toBe("VALID");
  expect(at(p).halves.every((h) => !h.fairing)).toBe(true);
});
it.each([false, true])(
  "noncoplanar node stays anchored, planar and G1; end=%s",
  (r) => {
    const p = fixture(undefined, r),
      n = at(p);
    expect(n.state).toBe("VALID");
    expect(n.halves.some((h) => h.fairing)).toBe(true);
    for (const h of n.halves) {
      expect(Math.abs(dot(n.normal!, h.target))).toBeLessThan(1e-8);
      if (!h.fairing) continue;
      const cp = h.fairing,
        c = p.curves.find((c) => c.id === h.half.curveId)!;
      near(cp[r ? 3 : 0], [0, 0, 0]);
      for (const q of cp)
        expect(
          Math.abs(
            dot(
              sub(q, cp[0]),
              c.role === "canonical" ? c.shape.planeNormal : [0, 0, 0],
            ),
          ),
        ).toBeLessThan(1e-8);
      const i = r ? 0 : 1;
      near(
        normalize(derivative(cp, i)),
        normalize(derivative(controls(p, c), h.trimT)),
      );
      const outer = resolveNetwork(p).spans.find(
        (s) => s.curveId === c.id && s.kind === "outer",
      )!;
      near(
        evaluate(outer.controls, 0.37),
        evaluate(
          controls(p, c),
          outer.sourceRange[0] +
            0.37 * (outer.sourceRange[1] - outer.sourceRange[0]),
        ),
      );
    }
  },
);
it("OFF retains exclusions and restores source at the node", () => {
  const p = fixture(),
    h = incident(p, "v")[0],
    off = setConfig(setConfig(p, "v", { excludedHalfEdges: [h] }), "v", {
      enabled: false,
    });
  expect(at(off).state).toBe("OFF");
  expect(config(off, "v").excludedHalfEdges).toEqual([h]);
  expect(resolveNetwork(off).spans.every((s) => s.kind === "outer")).toBe(true);
  expect(at(setConfig(off, "v", { enabled: true })).participants.length).toBe(
    3,
  );
});
it("exclusion removes observation and leaves exact source to V", () => {
  const p = fixture(),
    h = incident(p, "v")[0],
    q = setConfig(p, "v", { excludedHalfEdges: [h] });
  expect(at(q).participants.map(key)).not.toContain(key(h));
  expect(
    resolveNetwork(q).spans.find((s) => s.curveId === h.curveId)!.controls,
  ).toEqual(controls(q, q.curves[0]));
});
it("one remaining participant is not an error", () => {
  const p = fixture();
  expect(
    at(setConfig(p, "v", { excludedHalfEdges: incident(p, "v").slice(1) }))
      .state,
  ).toBe("NO_OP");
});
it("new curve participates automatically", () => {
  const p = fixture([
      [1, 0, 0],
      [0, 1, 0],
    ]),
    q = setConfig(p, "v", { excludedHalfEdges: [incident(p, "v")[0]] }),
    extra = fixture().curves[2];
  q.curves = [...q.curves, extra];
  q.landmarks = [...q.landmarks, fixture().landmarks[3]];
  expect(at(q).participants.length).toBe(2);
});
it("ordering does not affect node plane or fairing", () => {
  const p = fixture(),
    q = {
      ...p,
      curves: [...p.curves].reverse(),
      landmarks: [...p.landmarks].reverse(),
    };
  expect(at(q)).toEqual(at(p));
});
it("normal sign reversal does not change result geometry", () => {
  const p = fixture(),
    q = {
      ...p,
      curves: p.curves.map((c) =>
        c.role === "canonical"
          ? {
              ...c,
              shape: {
                ...c.shape,
                planeNormal: scale(c.shape.planeNormal, -1),
                startHandle: {
                  ...c.shape.startHandle,
                  offset: -c.shape.startHandle.offset,
                },
                endHandle: {
                  ...c.shape.endHandle,
                  offset: -c.shape.endHandle.offset,
                },
              },
            }
          : c,
      ),
    };
  const a = at(p),
    b = at(q);
  expect(b.state).toBe(a.state);
  b.halves.forEach((h, i) => near(h.target, a.halves[i].target));
});
it("repeated eigenvalues on centerline choose invariant plane", () => {
  for (const ts of [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [1, 0, 0],
      [-1, 0, 0],
    ],
  ] as Vec3[][]) {
    const n = plane(ts, ts, true);
    expect(Math.abs(n[0]) < 1e-12 || Math.hypot(n[1], n[2]) < 1e-12).toBe(true);
    expect(plane(ts, ts, true)).toEqual(n);
  }
});
it("collinear fallback uses source normals, is camera independent", () => {
  near(
    plane(
      [
        [1, 0, 0],
        [-1, 0, 0],
      ],
      [
        [0, 0, 1],
        [0, 0, -1],
      ],
      false,
    ),
    [0, 0, 1],
  );
});
it("zero-length source is INVALID and config remains, then recovers", () => {
  const p = fixture(),
    q = setConfig(p, "v", { extent: 0.21 }),
    bad = {
      ...q,
      landmarks: q.landmarks.map((l) =>
        l.id === "p0" ? { ...l, position: [0, 0, 0] as Vec3 } : l,
      ),
    };
  expect(at(bad).state).toBe("INVALID");
  expect(bad.surfaceSmoothNodes).toEqual(q.surfaceSmoothNodes);
  expect(at(q).state).toBe("VALID");
  expect(at(bad).halves).toEqual([]);
});
it("invalid node falls back all participants, no NaN", () => {
  const p = fixture(),
    q = {
      ...p,
      curves: p.curves.map((c) =>
        c.id === "c0" && c.role === "canonical"
          ? { ...c, shape: { ...c.shape, planeNormal: [NaN, 0, 0] as Vec3 } }
          : c,
      ),
    };
  expect(at(q).state).toBe("INVALID");
  expect(at(q).halves.length).toBe(0);
});
it("old actual ear/eye migration preserves V and minimum extent without pair exclusions", () => {
  const raw = structuredClone(data),
    p = parseLandmarks(JSON.stringify(raw));
  expect(p.version).toBe("landmarks-0.3.8");
  expect(p.smoothJunctions).toBeUndefined();
  for (const l of p.landmarks)
    expect(l.position).toEqual(
      raw.landmarks.find((x) => x.id === l.id)!.position,
    );
  expect(JSON.stringify(p)).not.toContain("smoothJunctions");
  for (const o of Object.values(p.surfaceSmoothNodes!))
    expect(o.excludedHalfEdges ?? []).toEqual([]);
});
it("new save/load roundtrip only stores source overrides", () => {
  let p = parseLandmarks(JSON.stringify(data));
  const l = p.landmarks.find((l) => incident(p, l.id).length > 1)!;
  p = setConfig(p, l.id, {
    extent: 0.23,
    enabled: false,
    excludedHalfEdges: [incident(p, l.id)[0]],
  });
  const q = parseLandmarks(JSON.stringify(p));
  expect(q).toEqual(p);
  expect(resolveNetwork(q)).toEqual(resolveNetwork(p));
  expect(JSON.stringify(p.surfaceSmoothNodes)).not.toMatch(
    /normal|trimPoint|INVALID|stress/,
  );
});
it("mirror config/exclusion shared; center mirror checkbox expands", () => {
  const p = parseLandmarks(JSON.stringify(data)),
    r = p.landmarks.find(
      (l) => l.type === "RIGHT" && incident(p, l.id).length >= 2,
    )!,
    q = setConfig(p, r.id, {
      extent: 0.22,
      excludedHalfEdges: [incident(p, r.id)[0]],
    });
  expect(config(q, r.mirrorPartnerId!).extent).toBe(0.22);
  expect(config(q, r.mirrorPartnerId!).excludedHalfEdges.length).toBe(1);
  const c = p.landmarks.find(
      (l) =>
        l.type === "CENTERLINE" &&
        incident(p, l.id).some(
          (h) => p.curves.find((c) => c.id === h.curveId)?.mirrorPartnerCurveId,
        ),
    )!,
    h = incident(p, c.id).find(
      (h) => p.curves.find((c) => c.id === h.curveId)?.mirrorPartnerCurveId,
    )!;
  expect(
    config(setConfig(p, c.id, { excludedHalfEdges: [h] }), c.id)
      .excludedHalfEdges.length,
  ).toBe(2);
});
it("delete cleans UUID refs and duplicate does not inherit override", () => {
  let p = parseLandmarks(JSON.stringify(data));
  const l = p.landmarks.find((l) => incident(p, l.id).length > 1)!;
  p = setConfig(p, l.id, { excludedHalfEdges: [incident(p, l.id)[0]] });
  const h = incident(p, l.id)[0],
    q = deleteCurve(p, h.curveId);
  expect(config(q, l.id).excludedHalfEdges).toEqual([]);
  const d = duplicateLandmark(p, l.id, "copy");
  expect(config(d.project, d.selectedId).excludedHalfEdges).toEqual([]);
  expect(config(d.project, d.selectedId).extent).toBe(0.15);
  const gone = deleteLandmark(p, l.id);
  expect(
    Object.keys(gone.surfaceSmoothNodes!).every((id) =>
      gone.landmarks.some((l) => l.id === id),
    ),
  ).toBe(true);
  expect(renameCurve(p, h.curveId, "renamed").surfaceSmoothNodes).toBe(
    p.surfaceSmoothNodes,
  );
});
it("both endpoint fairings retain exact middle on actual network", () => {
  const p = parseLandmarks(JSON.stringify(data)),
    net = resolveNetwork(p);
  for (const c of p.curves) {
    const spans = net.spans.filter((s) => s.curveId === c.id),
      middle = spans.find((s) => s.kind === "outer")!;
    expect(middle.sourceRange[0]).toBeLessThan(middle.sourceRange[1]);
    near(
      evaluate(middle.controls, 0.3),
      evaluate(
        controls(p, c),
        middle.sourceRange[0] +
          0.3 * (middle.sourceRange[1] - middle.sourceRange[0]),
      ),
    );
  }
});
it("large corrections remain valid HIGH_STRESS rather than solver failure", () => {
  const p = fixture([
      [-0.5146872718, 0.6410618327, -0.0808512205],
      [-0.4057097635, 0.4280075058, -0.3342155446],
      [0.3427109579, -0.5707280817, -0.6881292593],
      [0.1168438732, 0.02012303, -0.2412550314],
    ]),
    n = at(p);
  expect(n.state).toBe("VALID");
  expect(n.stress).toBe("HIGH_STRESS");
  expect(n.halves.some((h) => h.angle > Math.PI / 3 && h.fairing)).toBe(true);
});
it.each([0.001, 1000])(
  "uniform scaling preserves node decisions and normalized fairings (%s)",
  (factor) => {
    const p = fixture(),
      q = {
        ...p,
        landmarks: p.landmarks.map((l) => ({
          ...l,
          position: scale(l.position, factor),
        })),
      },
      a = at(p),
      b = at(q);
    expect(b.state).toBe(a.state);
    b.halves.forEach((h, i) => {
      near(h.target, a.halves[i].target);
      if (h.fairing)
        h.fairing.forEach((x, j) =>
          near(scale(x, 1 / factor), a.halves[i].fairing![j]),
        );
    });
  },
);
it("two genuinely corrected ends compose with exact middle and no order dependency", () => {
  let p = fixture();
  const other = fixture(),
    V = p.landmarks[1].position;
  p = {
    ...p,
    landmarks: [
      ...p.landmarks,
      ...other.landmarks
        .slice(1)
        .map((l) => ({ ...l, id: "b" + l.id, position: add(l.position, V) })),
    ],
    curves: [
      ...p.curves,
      ...other.curves.map((c) => ({
        ...c,
        id: "b" + c.id,
        startLandmarkId: "p0",
        endLandmarkId: "b" + c.endLandmarkId,
      })),
    ],
  };
  const a = resolveNetwork(p),
    spans = a.spans.filter((s) => s.curveId === "c0");
  expect(spans.map((s) => s.kind)).toEqual(["blend", "outer", "blend"]);
  const mid = spans[1];
  expect(mid.sourceRange[0]).toBeLessThan(mid.sourceRange[1]);
  near(
    evaluate(mid.controls, 0.42),
    evaluate(
      controls(p, p.curves[0]),
      mid.sourceRange[0] + 0.42 * (mid.sourceRange[1] - mid.sourceRange[0]),
    ),
  );
  const b = resolveNetwork({ ...p, curves: [...p.curves].reverse() });
  expect(b.nodes).toEqual(a.nodes);
  expect(b.spans.filter((s) => s.curveId === "c0")).toEqual(spans);
});
it("actual canonical final resolved spans mirror exactly, independent of selection driver", () => {
  const p = parseLandmarks(JSON.stringify(data)),
    net = resolveNetwork(p);
  for (const c of p.curves.filter((c) => c.role === "mirror")) {
    if (c.role !== "mirror") continue;
    const a = net.spans.filter((s) => s.curveId === c.canonicalCurveId),
      b = net.spans.filter((s) => s.curveId === c.id);
    expect(b.length).toBe(a.length);
    b.forEach((s, i) =>
      s.controls.forEach((v, j) => near(v, mirror(a[i].controls[j]))),
    );
  }
});
it("migration picks minimum per node and strips derived fields even on half-edge refs", () => {
  const raw: any = structuredClone(data),
    j = raw.smoothJunctions[0];
  raw.smoothJunctions.push({ ...j, id: "extra", extent: 0.04 });
  const p = parseLandmarks(JSON.stringify(raw));
  expect(config(p, j.landmarkId).extent).toBe(0.04);
  const id = p.landmarks.find((l) => incident(p, l.id).length > 1)!.id,
    h = incident(p, id)[0];
  const q = parseLandmarks(
    JSON.stringify({
      ...p,
      surfaceSmoothNodes: {
        [id]: {
          extent: 0.2,
          normal: [0, 0, 1],
          excludedHalfEdges: [
            { ...h, trimPoint: [1, 2, 3] },
            h,
            { curveId: "missing", endpoint: "start" },
          ],
        },
      },
    }),
  );
  expect(JSON.stringify(q.surfaceSmoothNodes)).not.toMatch(
    /normal|trimPoint|missing/,
  );
  expect(config(q, id).excludedHalfEdges.length).toBeGreaterThan(0);
});

it("distinct exact-plane / unstable intersection / orientation degeneracy branches", () => {
  expect(targetTangent([1, 0, 0], [0, 0, 1], [0, 0, -1])).toEqual([1, 0, 0]);
  expect(() =>
    targetTangent([1, 0, 0], [0, 0, 1], normalize([1e-9, 0, 1])),
  ).toThrow("交线数值不稳定");
  expect(() => targetTangent([1, 0, 0], [0, 0, 1], [1, 0, 0])).toThrow(
    "方向选择不稳定",
  );
  near(targetTangent([0, 1, 0], [0, 0, 1], normalize([1e-5, 0, 1])), [0, 1, 0]);
});
it("refined head network resolves deterministically with all semantic endpoints retained", async () => {
  const { readFileSync } = await import("node:fs");
  const p = parseLandmarks(
      readFileSync("artifacts/head-neck-refinement/refined.json", "utf8"),
    ),
    n = resolveNetwork(p);
  for (const c of p.curves) {
    const spans = n.spans.filter((s) => s.curveId === c.id);
    near(
      spans[0].controls[0],
      p.landmarks.find((l) => l.id === c.startLandmarkId)!.position,
    );
    near(
      spans.at(-1)!.controls[3],
      p.landmarks.find((l) => l.id === c.endLandmarkId)!.position,
    );
    expect(spans.every((s) => s.controls.flat().every(Number.isFinite))).toBe(
      true,
    );
  }
  console.log(
    "HEAD_NODE_REPORT",
    JSON.stringify({
      counts: n.nodes.reduce(
        (r, x) => ({ ...r, [x.state]: (r[x.state] ?? 0) + 1 }),
        {} as Record<string, number>,
      ),
      stress: n.nodes.filter((x) => x.stress === "HIGH_STRESS").length,
      invalid: n.nodes
        .filter((x) => x.state === "INVALID")
        .map((x) => ({
          name: p.landmarks.find((l) => l.id === x.landmarkId)!.name,
          reason: x.reason,
        })),
      fairings: n.spans.filter((x) => x.kind === "blend").length,
    }),
  );
});
