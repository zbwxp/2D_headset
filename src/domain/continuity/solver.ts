import {isOnPatch} from '../curves/model';
import {validateSmoothSurface, type SurfaceSmoothSafetyResult, type SmoothGroupSafety} from './safety';
import {mirrorPoint,mirrorVector} from '../head/frame';
import { InputCache } from '../geometry/cache';
import type { LandmarkProject } from '../landmarks/model';
import { mirror } from '../landmarks/model';
import type { Vec3 } from '../project/types';
import { add, sub, scale, dot, cross } from '../geometry/core';
import { derivative } from '../geometry/bezier';
import { patchInputKey } from '../geometry/revisions';
import { baseDifferential } from '../patches/fullness';
import { loop, type SurfacePatch } from '../patches/model';
import { boundaryGeometry, boundaryParameters, boundaryKey, mirrorBoundary, canonicalBoundary, type PatchBoundaryUse } from '../patches/boundary';
import { relations, type BoundaryRelation } from './model';
import { FAIR_DEGREE, indices, weights, fieldDifferential, type FairField } from './basis';
import { pcg, type Row } from '../smooth/pcg';
export type Differential = (u: number, v: number) => {
    position: Vec3;
    du: Vec3;
    dv: Vec3;
};
export interface PatchSolution {
    field?: FairField;
    iterations: number;
    error?: string;
    shapeProtection?: SmoothGroupSafety['reason'];
}
export interface ContinuityResult {
    patches: Record<string, PatchSolution>;
    diagnostics: {
        safety?: SmoothGroupSafety[];
        warnings: string[];
        angles: Record<string, {
            before: number;
            after: number;
            solverSamples: number;
        }>;
    };
}
const unit = (v: Vec3) => { const n = Math.hypot(...v); if (n < 1e-12 || !Number.isFinite(n))
    throw Error('切线或跨边界方向退化'); return scale(v, 1 / n); };
const naturalCache = new InputCache<Differential>(512);
export function naturalDifferential(p: LandmarkProject, x: SurfacePatch): Differential {
    const key = patchInputKey(p, x, true), hit = naturalCache.get(key);
    if (hit)
        return hit;
    if (x.canonicalId) {
        const f = naturalDifferential(p, p.patches!.find(q => q.id === x.canonicalId)!);
        return naturalCache.set(key, (u, v) => { const d = f(u, v); return { position: mirrorPoint(p,d.position), du: mirrorVector(p,d.du), dv: mirrorVector(p,d.dv) }; });
    }
    return naturalCache.set(key, baseDifferential(p, x));
}
const ringCache = new InputCache<PatchBoundaryUse[]>(512);
function ring(p: LandmarkProject, x: SurfacePatch): PatchBoundaryUse[] { const key = patchInputKey(p, x, true), hit = ringCache.get(key); if (hit)
    return hit; return ringCache.set(key, !x.canonicalId ? (x.type==='loop'?x.boundaryUses:loop(p, x.boundaryUses).map(r => r.use)) : ring(p, p.patches!.find(q => q.id === x.canonicalId)!).map(b => mirrorBoundary(p, b))); }
/** Boundary coordinates and an inward transversal; both sides use the SAME exact span parameter. */
export function edgeFrame(p: LandmarkProject, x: SurfacePatch, r: BoundaryRelation, t: number, e = 0) {
    const bs = ring(p, x),source=r.sources?.[x.id]??r.use,i = bs.findIndex(b => boundaryKey(p, b) === boundaryKey(p,source));
    if (i < 0)
        throw Error('边界未附着到曲面');
    if(boundaryKey(p,bs[i])!==r.key){
        const a=boundaryParameters(p,r.use),b=boundaryParameters(p,bs[i]);
        const local=(a.t0+(a.t1-a.t0)*t-b.t0)/(b.t1-b.t0);
        if(!Number.isFinite(local)||local< -1e-8||local>1+1e-8)throw Error('共享区间未包含于曲面边界');
        t=Math.max(0,Math.min(1,local));
        r={...r,use:bs[i]};
    }
    if(x.type==='loop'){const q=!!bs[i].reversed===!!r.use.reversed?t:1-t;return {uv:[q,i===0?e:1-e],inward:[0,i===0?1:-1]};}
    if(x.type==='lens'){const tAlong=bs[i].startLandmarkId===r.use.startLandmarkId?t:1-t;return {uv:[i===0?tAlong:1-tAlong,i===0?e:1-e],inward:[0,i===0?1:-1]};}
    const q = bs[i].startLandmarkId === r.use.startLandmarkId ? t : 1 - t;
    const uv = x.type === 'quad' ? [[q, e], [1 - e, q], [1 - q, 1 - e], [e, 1 - q]][i] : [[(1 - e) * q, e], [(1 - e) * (1 - q), (1 - e) * q], [e, (1 - e) * (1 - q)]][i];
    const inward = x.type === 'quad' ? [[0, 1], [-1, 0], [0, -1], [1, 0]][i] : [[-q, 1], [-(1 - q), -q], [1, -(1 - q)]][i];
    return { uv, inward };
}
function transversal(f: Differential, frame: ReturnType<typeof edgeFrame>) { const d = f(frame.uv[0], frame.uv[1]); return add(scale(d.du, frame.inward[0]), scale(d.dv, frame.inward[1])); }
const targetCache = new InputCache<(t: number) => Vec3[]>(512);
export function targetEvaluator(p: LandmarkProject, r: BoundaryRelation) {
    const [a, b] = r.pair!.map(id => p.patches!.find(x => x.id === id)!);
    const key = r.key + '|' + r.pair!.map(id => patchInputKey(p, p.patches!.find(x => x.id === id)!, true)).join('|');
    const hit = targetCache.get(key);
    if (hit)
        return hit;
    const da = naturalDifferential(p, a), db = naturalDifferential(p, b), cp = boundaryGeometry(p, r.use);
    return targetCache.set(key, (t: number) => {
        const T = unit(cp.derivative(t)), ca = transversal(da, edgeFrame(p, a, r, t)), cb = transversal(db, edgeFrame(p, b, r, t));
        const A = sub(ca, scale(T, dot(ca, T))), B = sub(cb, scale(T, dot(cb, T))), ua = unit(A), ub = unit(B);
        // Inward transverse directions acquire opposite path signs before fitting a plane.
        // Equal angular weighting removes parameter shear and arbitrary UV scale.
        const axis = unit(sub(ua, ub));
        if (dot(axis, ua) < 1e-4 || dot(axis, ub) > -1e-4)
            throw Error('两侧方向无法稳定区分，未强制翻转曲面');
        return [add(scale(T, dot(ca, T)), scale(axis, Math.hypot(...A))), add(scale(T, dot(cb, T)), scale(axis, -Math.hypot(...B)))];
    });
}
export const targetAt = (p: LandmarkProject, r: BoundaryRelation, t: number) => targetEvaluator(p, r)(t);
export function patchFairKey(p: LandmarkProject, x: SurfacePatch) {
    const owner = x.canonicalId ? p.patches!.find(q => q.id === x.canonicalId)! : x;
    return patchInputKey(p, owner, true) + '|' + JSON.stringify(relations(p).filter(r => r.pair?.includes(owner.id)).map(r => [r.key, r.pair!.map(id => patchInputKey(p, p.patches!.find(x => x.id === id)!, true))]));
}
const solutionCache = new Map<string, PatchSolution>();
export const fairStats = { solves: 0, cacheHits: 0 };
export function solvePatch(p: LandmarkProject, x: SurfacePatch): PatchSolution {
    const key = patchFairKey(p, x), hit = solutionCache.get(key);
    if (hit) {
        fairStats.cacheHits++;
        return hit;
    }
    const rs = relations(p).filter(r => r.pair?.includes(x.id));
    let solution: PatchSolution = { iterations: 0 };
    if (rs.length)
        try {
            const n = FAIR_DEGREE, ids = indices(x.type, n), rows: Row[] = [], base = naturalDifferential(p, x);
            // Positive fidelity on EVERY coefficient + full-domain lattice fairness. No band/radius.
            for (let k = 0; k < ids.length; k++)
                rows.push({ indices: [k], coefficients: [.01], target: 0 });
            for (let k = 0; k < ids.length; k++) {
                const [i, j] = ids[k], neighbors = (x.type !== 'tri' ? [[x.type==='loop'?(i+n-1)%n:i-1, j], [x.type==='loop'?(i+1)%n:i+1, j], [i, j - 1], [i, j + 1]] : [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1], [i - 1, j + 1], [i + 1, j - 1]]);
                const ii = [k], cc = [1];
                for (const [a, b] of neighbors) {
                    const index = ids.findIndex(([c, d]) => c === a && d === b);
                    if (index >= 0) {
                        ii.push(index);
                        cc.push(-1 / neighbors.length);
                    }
                }
                rows.push({ indices: ii, coefficients: cc, target: 0 });
            }
            const targets: Vec3[] = rows.map(() => [0, 0, 0]);
            for (const r of rs) {
                const target = targetEvaluator(p, r);
                for (let k = r.use.kind==='closed'?0:1; k < 40; k++) {
                    const t = k / 40, frame = edgeFrame(p, x, r, t), d = target(t)[r.pair!.indexOf(x.id)], delta = sub(d, transversal(base, frame));
                    const fade = r.use.kind==='closed'?1:Math.min(1, t / .15, (1 - t) / .15), weight = 100 * fade ** 3;
                    const w = weights(x.type, n, frame.uv[0], frame.uv[1]).map(w => (w[1] * frame.inward[0] + w[2] * frame.inward[1]) * weight);
                    const ii: number[] = [], cc: number[] = [];
                    w.forEach((v, i) => { if (Math.abs(v) > 1e-14) {
                        ii.push(i);
                        cc.push(v);
                    } });
                    rows.push({ indices: ii, coefficients: cc, target: 0 });
                    targets.push(scale(delta, weight));
                }
            }
            fairStats.solves++;
            const xyz = [0, 1, 2].map(a => pcg(rows.map((row, i) => ({ ...row, target: targets[i][a] })), ids.length));
            const field: FairField = { type: x.type, degree: n, coefficients: ids.map((_, i) => xyz.map(r => r.x[i]) as Vec3) };
            // Self-symmetric patch: equivariant control net permutation, exact reflection.
            const bs = (x.type==='loop'||x.type==='lens')?[]:loop(p, x.boundaryUses), perm = bs.map(b => { const l = p.landmarks.find(l => l.id === b.vertex)!; return bs.findIndex(q => q.vertex === (l.mirrorPartnerId ?? l.id)); });
            if (perm.every(i => i >= 0) && perm.some((i, j) => i !== j)) {
                const old = field.coefficients;
                field.coefficients = ids.map(([i, j], k) => { const u = i / n, v = j / n, w = x.type === 'tri' ? [1 - u - v, u, v] : [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v], m = perm.map(i => w[i]), a = Math.round(n * (x.type === 'tri' ? m[1] : m[1] + m[2])), b = Math.round(n * (x.type === 'tri' ? m[2] : m[2] + m[3])), other = ids.findIndex(([i, j]) => i === a && j === b); return other < 0 ? old[k] : scale(add(old[k], mirrorVector(p,old[other])), .5); });
            }
            if(x.type==='loop'&&!x.mirrorPartnerId){
              const mapped=x.boundaryUses.map(b=>mirrorBoundary(p,b)),order=mapped.map(b=>x.boundaryUses.findIndex(q=>q.curveId===b.curveId));
              if(order.every(i=>i>=0)){
                const flips=mapped.map((b,i)=>!!b.reversed!==!!x.boundaryUses[order[i]].reversed);
                if(flips[0]===flips[1]){const old=field.coefficients;field.coefficients=ids.map(([i,j],k)=>{const other=ids.findIndex(([a,b])=>a===(flips[0]?(n-i)%n:i)&&b===(order[0]===1?n-j:j));return scale(add(old[k],mirrorVector(p,old[other])),.5);});}
              }
            }
            solution = { ...(Math.max(...field.coefficients.flat().map(Math.abs)) > 1e-12 ? { field } : {}), iterations: Math.max(...xyz.map(r => r.iterations)) };
        }
        catch (e) {
            solution = { iterations: 0, error: (e as Error).message };
        }
    solutionCache.set(key, solution);
    if (solutionCache.size > 512)
        solutionCache.delete(solutionCache.keys().next().value!);
    return solution;
}
export function fairDifferential(p: LandmarkProject, x: SurfacePatch, result?: ContinuityResult): Differential {
    if (x.canonicalId) {
        const f = fairDifferential(p, p.patches!.find(q => q.id === x.canonicalId)!, result);
        return (u, v) => { const d = f(u, v); return { position: mirrorPoint(p,d.position), du: mirrorVector(p,d.du), dv: mirrorVector(p,d.dv) }; };
    }
    const base = naturalDifferential(p, x), field = result?.patches[x.id]?.field;
    if (!field)
        return base;
    return (u, v) => { const a = base(u, v), b = fieldDifferential(field, u, v); return { position: add(a.position, b.position), du: add(a.du, b.du), dv: add(a.dv, b.dv) }; };
}
export function seamAngle(p: LandmarkProject, r: BoundaryRelation, t: number, result?: ContinuityResult) { const normals = r.pair!.map(id => { const x = p.patches!.find(x => x.id === id)!, f = fairDifferential(p, x, result), { uv } = edgeFrame(p, x, r, t, 1e-5), d = f(uv[0], uv[1]); return unit(cross(d.du, d.dv)); }); return Math.acos(Math.min(1, Math.abs(dot(normals[0], normals[1])))) * 180 / Math.PI; }
/** Union canonical owners: any mirrored occurrence shares the same acceptance decision. */
export function smoothGroup(p: LandmarkProject, x: SurfacePatch): string[] {
    const owner = (id: string) => p.patches!.find(q => q.id === id)?.canonicalId ?? id;
    const ids = new Set([owner(x.id)]), pairs = relations(p).flatMap(r => r.pair ? [r.pair.map(owner)] : []);
    let changed = true;
    while (changed) { changed = false; for (const pair of pairs) if (pair.some(id => ids.has(id))) for (const id of pair) if (!ids.has(id)) { ids.add(id); changed = true; } }
    return [...ids].sort();
}
// Project edits replace source arrays/settings. Avoid rebuilding all group signatures
// on every surface evaluation; acceptance still depends on every member's candidate.
// Candidate evaluation has its own immutable context. Hosted curves may read the
// original candidate of an upstream group member, without re-entering acceptance.
const candidateScopes=new WeakMap<LandmarkProject,Set<string>>();
export const isCandidateScope=(p:LandmarkProject,x:SurfacePatch)=>candidateScopes.get(p)?.has(x.canonicalId??x.id)??false;
const sourceKeys=new WeakMap<LandmarkProject,string>();
export function continuitySourceKey(p:LandmarkProject){
 let key=sourceKeys.get(p);if(!key){key=JSON.stringify([p.landmarks,p.curves,p.patches,p.headFrame,p.loomisScaffold,p.loomisCaps,p.curveSmoothJoins,p.surfaceContinuity,p.chinScaffold]);sourceKeys.set(p,key);}return key;
}
const acceptanceKeys=new WeakMap<LandmarkProject,{inputs:unknown[];keys:Map<string,string>}>();
export function acceptanceKey(p: LandmarkProject, x: SurfacePatch) {
    const inputs=[p.landmarks,p.curves,p.patches,p.surfaceContinuity,p.headFrame,p.loomisScaffold,p.curveSmoothJoins,p.chinScaffold,p.landmarks.length,p.curves.length,p.patches?.length];
    let cached=acceptanceKeys.get(p);
    if(!cached||inputs.some((v,i)=>v!==cached!.inputs[i])){cached={inputs,keys:new Map()};acceptanceKeys.set(p,cached);}
    const id=x.canonicalId??x.id,hit=cached.keys.get(id);if(hit)return hit;
    const ids=smoothGroup(p,x);
    // Acceptance covers the whole group, whose downstream members may depend on
    // this member's final surface. Never evaluate geometry to identify that group.
    const key=p.curves.some(isOnPatch)?'hosted:'+ids.join(',')+'|'+continuitySourceKey(p):ids.map(id=>id+':'+patchFairKey(p,p.patches!.find(q=>q.id===id)!)).join('|');
    for(const id of ids)cached.keys.set(id,key);return key;
}
const safetyCache = new Map<string, SurfaceSmoothSafetyResult>();
const acceptedGroups = new Map<string, {patches:Record<string,PatchSolution>; safety?:SmoothGroupSafety}>();
function solveSafeGroup(p:LandmarkProject,x:SurfacePatch) {
    const key=acceptanceKey(p,x),hit=acceptedGroups.get(key);if(hit)return hit;
    const ids=smoothGroup(p,x),patches:Record<string,PatchSolution>={},checks:Record<string,SurfaceSmoothSafetyResult>={};
    const candidateProject=p.curves.some(isOnPatch)?{...p}:p;
    if(candidateProject!==p)candidateScopes.set(candidateProject,new Set(ids));
    for(const id of ids) patches[id]=solvePatch(candidateProject,p.patches!.find(q=>q.id===id)!);
    let reason:SmoothGroupSafety['reason']=ids.some(id=>patches[id].error)?'candidate-solve-failed':undefined;
    for(const id of ids){
        const patch=p.patches!.find(q=>q.id===id)!,candidate=patches[id];if(!candidate.field)continue;
        const k=patchFairKey(candidateProject,patch);let check=safetyCache.get(k);
        if(!check){
            let L=NaN;try{const lengths=patch.boundaryUses.map(b=>boundaryGeometry(candidateProject,b).arcLengthLUT().at(-1)!).sort((a,b)=>a-b),i=Math.floor(lengths.length/2);L=lengths.length%2?lengths[i]:(lengths[i-1]+lengths[i])/2;}catch{/* Invalid scale is rejected by validation. */}
            check=validateSmoothSurface(patch.type,naturalDifferential(candidateProject,patch),fairDifferential(candidateProject,patch,{patches,diagnostics:{warnings:[],angles:{}}}),L);
            safetyCache.set(k,check);if(safetyCache.size>512)safetyCache.delete(safetyCache.keys().next().value!);
        }
        checks[id]=check;if(!check.accepted&&!reason)reason=check.reason;
    }
    const safety:SmoothGroupSafety|undefined=Object.keys(checks).length||reason?{patchIds:ids,accepted:!reason,patches:checks,...(reason?{reason}:{})}:undefined;
    if(reason)for(const id of ids){const c=patches[id];patches[id]={iterations:c.iterations,error:c.error??'自动平滑未应用：曲面形状保护',shapeProtection:reason};}
    const result={patches,safety};acceptedGroups.set(key,result);if(acceptedGroups.size>128)acceptedGroups.delete(acceptedGroups.keys().next().value!);return result;
}
/** Synchronous ON_PATCH evaluation must not bypass group acceptance. */
export function solveSafePatch(p:LandmarkProject,x:SurfacePatch):PatchSolution {return solveSafeGroup(p,x).patches[x.canonicalId??x.id];}
export function solveContinuity(p: LandmarkProject): ContinuityResult {
    const result: ContinuityResult = { patches: {}, diagnostics: { warnings: [], angles: {} } };
    result.diagnostics.safety=[];
    for (const x of p.patches ?? [])
        if (!x.canonicalId && !result.patches[x.id]) {
            const group=solveSafeGroup(p,x);Object.assign(result.patches,group.patches);
            if(group.safety)result.diagnostics.safety.push(group.safety);
            for(const [id,solution]of Object.entries(group.patches))if(solution.error)
                result.diagnostics.warnings.push(`${p.patches!.find(q=>q.id===id)?.name??id}: ${solution.error}`);
        }
    for (const r of relations(p))
        if (r.pair)
            try {
                let before = 0, after = 0, solverSamples = 0;
                for (let k = 8; k <= 32; k++)
                    solverSamples = Math.max(solverSamples, seamAngle(p, r, k / 40, result));
                for (let k = 0; k < 23; k++) {
                    const t = .2 + .6 * (k + .37) / 23;
                    before = Math.max(before, seamAngle(p, r, t));
                    after = Math.max(after, seamAngle(p, r, t, result));
                }
                result.diagnostics.angles[r.key] = { before, after, solverSamples };
                if (after > 2)
                    result.diagnostics.warnings.push(`${r.key}: 中段法向偏差 ${after.toFixed(2)}°，数值连续性尚不理想`);
            }
            catch (e) {
                result.diagnostics.warnings.push(`${r.key}: ${(e as Error).message}`);
            }
    return result;
}
