import type { LandmarkProject } from "../landmarks/model";
import type {
  CurveHalfEdgeRef,
  NodeConfig,
  SurfaceSmoothNodeOverride,
} from "./model";
export const DEFAULTS = { enabled: true, extent: 0.15 };
export const key = (h: CurveHalfEdgeRef) => `${h.curveId}:${h.endpoint}`;
export function incident(p: LandmarkProject, id: string): CurveHalfEdgeRef[] {
  return p.curves
    .flatMap((c) => [
      ...(c.startLandmarkId === id
        ? [{ curveId: c.id, endpoint: "start" as const }]
        : []),
      ...(c.endLandmarkId === id
        ? [{ curveId: c.id, endpoint: "end" as const }]
        : []),
    ])
    .sort((a, b) => key(a).localeCompare(key(b)));
}
export function mirrorHalf(
  p: LandmarkProject,
  h: CurveHalfEdgeRef,
): CurveHalfEdgeRef {
  return {
    ...h,
    curveId:
      p.curves.find((c) => c.id === h.curveId)?.mirrorPartnerCurveId ??
      h.curveId,
  };
}
export function canonicalId(p: LandmarkProject, id: string) {
  const l = p.landmarks.find((l) => l.id === id);
  return l?.type === "RIGHT" ? (l.mirrorPartnerId ?? id) : id;
}
export function config(p: LandmarkProject, id: string): NodeConfig {
  const cid = canonicalId(p, id),
    o = p.surfaceSmoothNodes?.[cid];
  return {
    ...DEFAULTS,
    ...p.surfaceSmoothDefaults,
    ...o,
    excludedHalfEdges: (o?.excludedHalfEdges ?? []).map((h) =>
      cid === id ? h : mirrorHalf(p, h),
    ),
  };
}
export function setConfig(
  p: LandmarkProject,
  id: string,
  patch: SurfaceSmoothNodeOverride,
): LandmarkProject {
  const cid = canonicalId(p, id);
  if (!p.landmarks.some((l) => l.id === cid)) return p;
  let excluded = patch.excludedHalfEdges?.map((h) =>
    cid === id ? h : mirrorHalf(p, h),
  );
  if (excluded && p.landmarks.find((l) => l.id === cid)?.type === "CENTERLINE")
    excluded = excluded.flatMap((h) => [h, mirrorHalf(p, h)]);
  const valid = new Set(incident(p, cid).map(key));
  if (excluded)
    excluded = [
      ...new Map(
        excluded
          .filter((h) => valid.has(key(h)))
          .map((h) => [key(h), { curveId: h.curveId, endpoint: h.endpoint }]),
      ).values(),
    ].sort((a, b) => key(a).localeCompare(key(b)));
  const next = {
    ...p.surfaceSmoothNodes?.[cid],
    ...patch,
    ...(excluded ? { excludedHalfEdges: excluded } : {}),
  };
  if (next.extent !== undefined) {
    if (!Number.isFinite(next.extent)) throw Error("平滑范围必须为有限数");
    next.extent = Math.max(0.01, Math.min(0.45, next.extent));
  }
  if (JSON.stringify(next) === JSON.stringify(p.surfaceSmoothNodes?.[cid]))
    return p;
  return { ...p, surfaceSmoothNodes: { ...p.surfaceSmoothNodes, [cid]: next } };
}
export function cleanConfigs(p: LandmarkProject): LandmarkProject {
  const nodes: Record<string, SurfaceSmoothNodeOverride> = {};
  for (const [id, o] of Object.entries(p.surfaceSmoothNodes ?? {})) {
    if (!p.landmarks.some((l) => l.id === id)) continue;
    const valid = new Set(incident(p, id).map(key));
    nodes[id] = {
      ...o,
      ...(o.excludedHalfEdges
        ? {
            excludedHalfEdges: o.excludedHalfEdges.filter((h) =>
              valid.has(key(h)),
            ),
          }
        : {}),
    };
  }
  return { ...p, surfaceSmoothNodes: nodes };
}
export function migrate(
  p: LandmarkProject,
  raw: LandmarkProject,
): LandmarkProject {
  const defaults = raw.surfaceSmoothDefaults ?? DEFAULTS;
  if (
    typeof defaults.enabled !== "boolean" ||
    !Number.isFinite(defaults.extent) ||
    defaults.extent < 0.01 ||
    defaults.extent > 0.45
  )
    throw Error("Surface Smooth 默认配置无效");
  p = {
    ...p,
    surfaceSmoothDefaults: {
      enabled: defaults.enabled,
      extent: defaults.extent,
    },
    surfaceSmoothNodes: {},
  };
  if (raw.version !== "landmarks-0.3.8") {
    for (const j of raw.smoothJunctions ?? []) {
      const id = canonicalId(p, j.landmarkId);
      if (!p.landmarks.some((l) => l.id === id) || !Number.isFinite(j.extent))
        continue;
      const extent = Math.max(0.01, Math.min(0.45, j.extent));
      p = setConfig(p, id, {
        extent: Math.min(
          p.surfaceSmoothNodes?.[id]?.extent ?? Infinity,
          extent,
        ),
      });
    }
  } else {
    const rawNodes = raw.surfaceSmoothNodes ?? {};
    if (
      typeof rawNodes !== "object" ||
      Array.isArray(rawNodes) ||
      rawNodes === null
    )
      throw Error("Surface Smooth 节点配置无效");
    for (const [id, o] of Object.entries(rawNodes).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (
        !o ||
        typeof o !== "object" ||
        (o.enabled !== undefined && typeof o.enabled !== "boolean") ||
        (o.extent !== undefined &&
          (!Number.isFinite(o.extent) || o.extent < 0.01 || o.extent > 0.45)) ||
        (o.excludedHalfEdges !== undefined &&
          (!Array.isArray(o.excludedHalfEdges) ||
            o.excludedHalfEdges.some(
              (h) =>
                !h ||
                typeof h.curveId !== "string" ||
                !["start", "end"].includes(h.endpoint),
            )))
      )
        throw Error("Surface Smooth 节点配置无效");
      p = setConfig(p, id, {
        ...(o.enabled !== undefined ? { enabled: o.enabled } : {}),
        ...(o.extent !== undefined ? { extent: o.extent } : {}),
        ...(o.excludedHalfEdges !== undefined
          ? { excludedHalfEdges: o.excludedHalfEdges }
          : {}),
      });
    }
  }
  return p;
}
