import type { LandmarkProject } from '../landmarks/model';
export interface SurfaceSmoothSettings {
    enabled: boolean;
    strength: number;
    edgeInfluenceOverrides: Record<string, number>;
}
export const defaultSmooth: SurfaceSmoothSettings = { enabled: false, strength: 1, edgeInfluenceOverrides: {} };
export const SMOOTH_SUBDIVISIONS = 12;
export const SMOOTH_BAND_RINGS = 3;
export const SMOOTH_WEIGHTS = { source: 1, edge: 12, fair: .5, seam: 4 } as const;
export function surfaceAdjacency(p: LandmarkProject) {
    const result = new Map<string, string[]>();
    for (const patch of p.patches ?? [])
        for (const id of patch.boundaryEdgeIds) {
            const list = result.get(id) ?? [];
            list.push(patch.id);
            result.set(id, list);
        }
    return result;
}
export function influence(p: LandmarkProject, id: string) { const c = p.curves.find(c => c.id === id); return p.surfaceSmooth?.edgeInfluenceOverrides[c?.role === 'mirror' ? c.canonicalCurveId : id] ?? 1; }
export function parseSmooth(value: unknown, p: LandmarkProject): SurfaceSmoothSettings {
    if (value === undefined)
        return structuredClone(defaultSmooth);
    const v = value as SurfaceSmoothSettings;
    if (!v || typeof v.enabled !== 'boolean' || !Number.isFinite(v.strength) || v.strength < 0 || v.strength > 1 || !v.edgeInfluenceOverrides || Array.isArray(v.edgeInfluenceOverrides) || typeof v.edgeInfluenceOverrides !== 'object')
        throw Error('Surface Smooth 设置无效');
    const overrides: Record<string, number> = {};
    for (const [id, n] of Object.entries(v.edgeInfluenceOverrides)) {
        if (!Number.isFinite(n) || n < 0 || n > 1)
            throw Error('Smooth Influence 无效');
        const c = p.curves.find(c => c.id === id);
        if (!c)
            continue;
        if (c.role === 'mirror')
            throw Error('Smooth Influence 必须保存在 canonical Curve 上');
        if (n !== 1)
            overrides[id] = n;
    }
    return { enabled: v.enabled, strength: v.strength, edgeInfluenceOverrides: overrides };
}
