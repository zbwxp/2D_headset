import type { LandmarkProject } from '../landmarks/model';
import { boundaryKey, canonicalBoundary, mirrorBoundary, type PatchBoundaryUse } from '../patches/boundary';
export type Relationship = {
    mode: 'crease';
} | {
    mode: 'manual';
    patchIds: [
        string,
        string
    ];
};
export interface ContinuitySettings {
    overrides: Record<string, Relationship>;
}
export interface BoundaryRelation {
    key: string;
    use: PatchBoundaryUse;
    patchIds: string[];
    mode: 'natural' | 'auto' | 'crease' | 'manual';
    pair?: [
        string,
        string
    ];
}
/** Exact topology only: no geometry evaluation, including during collapsed spans. */
export function relations(p: LandmarkProject): BoundaryRelation[] {
    const map = new Map<string, BoundaryRelation>();
    for (const patch of p.patches ?? [])
        for (const use of patch.boundaryUses) {
            const key = boundaryKey(p, use);
            let r = map.get(key);
            if (!r) {
                r = { key, use: canonicalBoundary(p, use), patchIds: [], mode: 'natural' };
                map.set(key, r);
            }
            r.patchIds.push(patch.id);
        }
    for (const r of map.values()) {
        r.patchIds.sort();
        const override = p.surfaceContinuity?.overrides[r.key];
        if (override?.mode === 'crease')
            r.mode = 'crease';
        else if (override?.mode === 'manual' && override.patchIds[0] !== override.patchIds[1] && override.patchIds.every(id => r.patchIds.includes(id))) {
            r.mode = 'manual';
            r.pair = override.patchIds;
        }
        else if (r.patchIds.length === 2) {
            r.mode = 'auto';
            r.pair = r.patchIds as [
                string,
                string
            ];
        }
    }
    return [...map.values()];
}
export function setRelationship(p: LandmarkProject, key: string, value: Relationship | undefined): LandmarkProject {
    const r = relations(p).find(r => r.key === key);
    if (!r)
        return p;
    if (value?.mode === 'manual' && (value.patchIds[0] === value.patchIds[1] || !value.patchIds.every(id => r.patchIds.includes(id))))
        throw Error('请选择这条边界上的两个不同曲面');
    if (value?.mode === 'manual') {
        let mk: string | undefined;
        try {
            mk = boundaryKey(p, mirrorBoundary(p, r.use));
        }
        catch { }
        if (mk === key) {
            const reflected = value.patchIds.map(id => p.patches!.find(x => x.id === id)!.mirrorPartnerId ?? id).sort();
            if (JSON.stringify(reflected) !== JSON.stringify([...value.patchIds].sort()))
                throw Error('中轴对称边界只能选择镜像不变的一组曲面；当前选择需要两组关系。');
        }
    }
    const overrides = { ...p.surfaceContinuity?.overrides };
    const put = (key: string, v: Relationship | undefined) => { if (v)
        overrides[key] = v;
    else
        delete overrides[key]; };
    put(key, value);
    try {
        const mk = boundaryKey(p, mirrorBoundary(p, r.use));
        let mv = value;
        if (value?.mode === 'manual')
            mv = { mode: 'manual', patchIds: value.patchIds.map(id => { const q = p.patches!.find(q => q.id === id)!; return q.mirrorPartnerId ?? q.id; }) as [
                    string,
                    string
                ] };
        if (mk !== key)
            put(mk, mv);
    }
    catch { /* Unpaired boundary. */ }
    return { ...p, surfaceContinuity: { overrides } };
}
/** Topology repair never consults surface shape. Invalid geometry retains intent. */
export function repairContinuity(p: LandmarkProject): LandmarkProject {
    const attached = new Map(relations(p).map(r => [r.key, r.patchIds]));
    const overrides: Record<string, Relationship> = {};
    for (const [key, r] of Object.entries(p.surfaceContinuity?.overrides ?? {})) {
        const ids = attached.get(key);
        if (!ids)
            continue;
        if (r.mode === 'crease' || r.mode === 'manual' && r.patchIds[0] !== r.patchIds[1] && r.patchIds.every(id => ids.includes(id)))
            overrides[key] = r;
    }
    if (JSON.stringify(overrides) === JSON.stringify(p.surfaceContinuity?.overrides ?? {}))
        return p;
    return { ...p, surfaceContinuity: { overrides } };
}
export function migrateContinuity(p: LandmarkProject, raw: unknown): LandmarkProject {
    let result = { ...p, surfaceContinuity: { overrides: {} } } as LandmarkProject;
    if (raw !== undefined) {
        const o = (raw as ContinuitySettings)?.overrides;
        if (!o || typeof o !== 'object')
            throw Error('Surface Continuity 数据无效');
        for (const [key, r] of Object.entries(o)) {
            if (!r || !(r.mode === 'crease' || r.mode === 'manual' && Array.isArray(r.patchIds) && r.patchIds.length === 2 && r.patchIds.every(id => typeof id === 'string')))
                throw Error('Surface Continuity 关系无效');
            result = setRelationship(result, key, r);
        }
    }
    else {
        for (const r of relations(result)) {
            const c = p.curves.find(c => c.id === r.use.curveId)!;
            const owner = c.role === 'mirror' ? c.canonicalCurveId : c.id;
            if (p.surfaceSmooth?.edgeInfluenceOverrides[owner] === 0)
                result = setRelationship(result, r.key, { mode: 'crease' });
        }
    }
    const { surfaceSmooth: legacy, ...clean } = repairContinuity(result);
    if (!Object.keys(clean.surfaceContinuity?.overrides ?? {}).length)
        delete clean.surfaceContinuity;
    return clean;
}
