import {dependencyGraph} from '../geometry/dependencies';
import {InputCache} from '../geometry/cache';
import {isClosedSource} from '../curves/model';
import {evaluationContext} from '../geometry/evaluation';
import type { LandmarkProject } from '../landmarks/model';
import { boundaryKey, curveLocationOfLandmark, canonicalBoundary, mirrorBoundary, type PatchBoundaryUse } from '../patches/boundary';
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
    sources?: Record<string,PatchBoundaryUse>;
    use: PatchBoundaryUse;
    patchIds: string[];
    mode: 'natural' | 'auto' | 'crease' | 'manual';
    pair?: [
        string,
        string
    ];
}
/** Split overlapping uses on open hosts at semantic anchors, never by world proximity. */
const relationCache=new InputCache<BoundaryRelation[]>(32);
export function relations(p: LandmarkProject): BoundaryRelation[] {
    const cacheKey=JSON.stringify([p.patches,p.landmarks,p.curves,p.headFrame,p.loomisScaffold,p.surfaceContinuity]);
    const cached=relationCache.get(cacheKey);if(cached)return cached;
    const map = new Map<string, BoundaryRelation>();
    const uses=(p.patches??[]).flatMap(patch=>patch.boundaryUses.map(use=>({id:patch.id,use})));
    const ctx=evaluationContext(p);
    for (const {id,use} of uses) {
        let pieces=[use];
        const host=p.curves.find(c=>c.id===use.curveId);
        if(host&&!isClosedSource(host)&&use.kind!=='closed')try{
            const start=curveLocationOfLandmark(use.curveId,use.startLandmarkId,ctx),end=curveLocationOfLandmark(use.curveId,use.endLandmarkId,ctx),lo=Math.min(start,end),hi=Math.max(start,end);
            const cuts=new Map<number,string>();
            for(const other of uses)if(other.use.curveId===use.curveId&&other.use.kind!=='closed')for(const point of [other.use.startLandmarkId,other.use.endLandmarkId]){
                const t=curveLocationOfLandmark(use.curveId,point,ctx);if(t>=lo&&t<=hi&&(!cuts.has(t)||point<cuts.get(t)!))cuts.set(t,point);
            }
            const sorted=[...cuts].sort((a,b)=>a[0]-b[0]);
            // Preserve collapsed topology for recovery; do not drop authored intent.
            if(hi-lo>1e-10&&sorted.length>2)pieces=sorted.slice(1).flatMap(([t,id],i)=>t-sorted[i][0]>1e-10?[{curveId:use.curveId,startLandmarkId:sorted[i][1],endLandmarkId:id}]:[]);
        }catch{ /* Keep exact authored relation for temporarily invalid geometry. */ }
        for(const piece of pieces){
            const key=boundaryKey(p,piece);let r=map.get(key);
            if(!r){r={key,use:canonicalBoundary(p,piece),patchIds:[],sources:{},mode:'natural'};map.set(key,r);}
            if(!r.patchIds.includes(id))r.patchIds.push(id);r.sources![id]=use;
        }
    }
    for (const r of map.values()) {
        r.patchIds.sort();
        const settings=p.surfaceContinuity?.overrides;
        const inherited=Object.values(r.sources??{}).map(b=>settings?.[boundaryKey(p,b)]).filter(Boolean);
        const override = settings?.[r.key]??inherited.find(v=>v?.mode==='crease')??inherited.find(v=>v?.mode==='manual'&&v.patchIds.every(id=>r.patchIds.includes(id)));
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
    return relationCache.set(cacheKey,[...map.values()]);
}
export function setRelationship(p: LandmarkProject, key: string, value: Relationship | undefined): LandmarkProject {
    const r = relations(p).find(r => r.key === key);
    if (!r) {
        const children=relations(p).filter(r=>Object.values(r.sources??{}).some(b=>boundaryKey(p,b)===key));
        return children.reduce((next,r)=>setRelationship(next,r.key,value),p);
    }
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
    const overrides:Record<string,Relationship>={};
    // Materialize inherited intent before editing one child span independently.
    for(const rel of relations(p))if(rel.mode==='crease')overrides[rel.key]={mode:'crease'};else if(rel.mode==='manual'&&rel.pair)overrides[rel.key]={mode:'manual',patchIds:rel.pair};
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
    const next={ ...p, surfaceContinuity: { overrides } };dependencyGraph(next);return next;
}
/** Topology repair never consults surface shape. Invalid geometry retains intent. */
export function repairContinuity(p: LandmarkProject): LandmarkProject {
    const overrides: Record<string, Relationship> = {};
    for(const r of relations(p)){
        if(r.mode==='crease')overrides[r.key]={mode:'crease'};
        else if(r.mode==='manual'&&r.pair)overrides[r.key]={mode:'manual',patchIds:r.pair};
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
