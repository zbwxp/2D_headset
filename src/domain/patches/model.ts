import type { LandmarkProject } from '../landmarks/model';
export interface SurfacePatch {
    id: string;
    type: 'tri' | 'quad';
    boundaryEdgeIds: string[];
    mirrorPartnerId?: string;
    canonicalId?: string;
}
export interface PatchDisplay {
    opacity2d: number;
    opacity3d: number;
}
export const defaultDisplay: PatchDisplay = { opacity2d: .9, opacity3d: .7 };
export function loop(p: LandmarkProject, ids: string[]) {
    if (![3, 4].includes(ids.length) || new Set(ids).size !== ids.length)
        throw Error('请选择 3 或 4 条不同的边');
    const edges = ids.map(id => p.curves.find(c => c.id === id));
    if (edges.some(c => !c))
        throw Error('边界结构线不存在');
    const degree = new Map<string, number>();
    for (const c of edges) {
        for (const id of [c!.startLandmarkId, c!.endLandmarkId])
            degree.set(id, (degree.get(id) ?? 0) + 1);
    }
    if (degree.size !== ids.length || [...degree.values()].some(n => n !== 2))
        throw Error('所选边未组成连续闭环');
    let vertex = [...degree.keys()].sort()[0];
    const result: {
        id: string;
        reverse: boolean;
        vertex: string;
    }[] = [];
    for (let i = 0; i < ids.length; i++) {
        const c = edges.filter(c => !result.some(r => r.id === c!.id) && (c!.startLandmarkId === vertex || c!.endLandmarkId === vertex)).sort((a, b) => a!.id.localeCompare(b!.id))[0]!;
        if (!c)
            throw Error('边界不连通');
        const reverse = c.endLandmarkId === vertex;
        result.push({ id: c.id, reverse, vertex });
        vertex = reverse ? c.startLandmarkId : c.endLandmarkId;
    }
    if (vertex !== result[0].vertex)
        throw Error('边界未闭合');
    return result;
}
const key = (ids: string[]) => [...ids].sort().join('|');
export function addPatch(p: LandmarkProject, ids: string[]): LandmarkProject {
    loop(p, ids);
    const patches = p.patches ?? [];
    if (patches.some(x => key(x.boundaryEdgeIds) === key(ids)))
        throw Error('该闭环已有 Patch');
    const mirrored = ids.map(id => { const c = p.curves.find(c => c.id === id)!; return c.mirrorPartnerCurveId ?? ([c.startLandmarkId, c.endLandmarkId].every(id => p.landmarks.find(l => l.id === id)?.type === 'CENTERLINE') ? c.id : null); });
    const a: SurfacePatch = { id: crypto.randomUUID(), type: ids.length === 3 ? 'tri' : 'quad', boundaryEdgeIds: [...ids] };
    const added = [a];
    if (mirrored.every(Boolean) && key(mirrored as string[]) !== key(ids)) {
        const m = mirrored as string[];
        loop(p, m);
        if (patches.some(x => key(x.boundaryEdgeIds) === key(m)))
            throw Error('镜像闭环已有 Patch');
        const b: SurfacePatch = { id: crypto.randomUUID(), type: a.type, boundaryEdgeIds: m, canonicalId: a.id, mirrorPartnerId: a.id };
        a.mirrorPartnerId = b.id;
        added.push(b);
    }
    return { ...p, version: 'landmarks-0.4.0', patches: [...patches, ...added] };
}
export function prunePatches(p: LandmarkProject): LandmarkProject {
    if (!p.patches)
        return p;
    const ids = new Set(p.curves.map(c => c.id));
    const bad = new Set(p.patches.filter(x => x.boundaryEdgeIds.some(id => !ids.has(id))).flatMap(x => [x.id, x.mirrorPartnerId]));
    return { ...p, patches: p.patches.filter(x => !bad.has(x.id)) };
}
export function parsePatches(value: unknown, p: LandmarkProject): SurfacePatch[] {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw Error('Patch 数据无效');
    const ids = new Set<string>(), keys = new Set<string>();
    const result = value.map(x => { if (!x || typeof x.id !== 'string' || ids.has(x.id) || !Array.isArray(x.boundaryEdgeIds))
        throw Error('Patch 数据无效'); loop(p, x.boundaryEdgeIds); if (x.type !== (x.boundaryEdgeIds.length === 3 ? 'tri' : 'quad') || keys.has(key(x.boundaryEdgeIds)))
        throw Error('Patch 类型或重复边界无效'); ids.add(x.id); keys.add(key(x.boundaryEdgeIds)); return { id: x.id, type: x.type, boundaryEdgeIds: [...x.boundaryEdgeIds], ...(x.mirrorPartnerId ? { mirrorPartnerId: x.mirrorPartnerId } : {}), ...(x.canonicalId ? { canonicalId: x.canonicalId } : {}) } as SurfacePatch; });
    for (const x of result) {
        if (x.mirrorPartnerId) {
            const m = result.find(y => y.id === x.mirrorPartnerId);
            if (!m || m.mirrorPartnerId !== x.id || m.id === x.id || !!m.canonicalId === !!x.canonicalId || (x.canonicalId && x.canonicalId !== m.id))
                throw Error('Patch 镜像关系无效');
            const mapped = x.boundaryEdgeIds.map(id => p.curves.find(c => c.id === id)!.mirrorPartnerCurveId ?? id);
            if (key(mapped) !== key(m.boundaryEdgeIds))
                throw Error('Patch 镜像边界不匹配');
        }
        else if (x.canonicalId)
            throw Error('Patch canonical 无效');
    }
    return result;
}
