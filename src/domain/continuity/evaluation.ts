import {isOnPatch} from '../curves/model';
import type { LandmarkProject } from '../landmarks/model';
import type { SurfacePatch } from '../patches/model';
import { patchFairKey, acceptanceKey, solveSafePatch, solvePatch, isCandidateScope, continuitySourceKey, type ContinuityResult, type PatchSolution } from './solver';
const cache = new Map<string, PatchSolution>(), results = new Map<string, ContinuityResult>();
let version = 0;
const listeners = new Set<() => void>();
export const subscribeSmooth = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const smoothVersion = () => version;
export const solveKey = (p: LandmarkProject) => p.curves.some(isOnPatch)?continuitySourceKey(p):(p.patches ?? []).filter(x => !x.canonicalId).map(x => patchFairKey(p, x)).join('|');
export function installSmoothResult(p: LandmarkProject, r: ContinuityResult) { for (const x of p.patches ?? [])
    if (!x.canonicalId && r.patches[x.id])
        cache.set(x.id+'|'+acceptanceKey(p, x), r.patches[x.id]); results.set(solveKey(p), r); if (results.size > 12)
    results.delete(results.keys().next().value!); while (cache.size > 512)
    cache.delete(cache.keys().next().value!); version++; listeners.forEach(f => f()); }
export function getSmoothResult(p: LandmarkProject) { return results.get(solveKey(p)); }
export function getPatchSolution(p: LandmarkProject, x: SurfacePatch) { if(isCandidateScope(p,x))return solvePatch(p,x.canonicalId?p.patches!.find(q=>q.id===x.canonicalId)!:x);const owner=x.canonicalId?p.patches!.find(q=>q.id===x.canonicalId)!:x,key=owner.id+'|'+acceptanceKey(p,owner);let r=cache.get(key);if(!r&&p.curves.some(isOnPatch)){r=solveSafePatch(p,owner);cache.set(key,r);}return r; }
export function evaluationToken(p: LandmarkProject, x?: SurfacePatch): string { if (x) {
    const r = getPatchSolution(p, x);
    return r ? (isCandidateScope(p,x)?':candidate:'+patchFairKey(p,x):p.curves.some(isOnPatch)?x.id+'|'+acceptanceKey(p,x):patchFairKey(p,x)) + (r.error ?? ':ready') : ':natural';
} return (p.patches ?? []).map(x => evaluationToken(p, x)).join('|'); }
