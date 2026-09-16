import type { LandmarkProject } from '../landmarks/model';
import type { SurfacePatch } from '../patches/model';
import { patchFairKey, type ContinuityResult, type PatchSolution } from './solver';
const cache = new Map<string, PatchSolution>(), results = new Map<string, ContinuityResult>();
let version = 0;
const listeners = new Set<() => void>();
export const subscribeSmooth = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const smoothVersion = () => version;
export const solveKey = (p: LandmarkProject) => (p.patches ?? []).filter(x => !x.canonicalId).map(x => patchFairKey(p, x)).join('|');
export function installSmoothResult(p: LandmarkProject, r: ContinuityResult) { for (const x of p.patches ?? [])
    if (!x.canonicalId && r.patches[x.id])
        cache.set(patchFairKey(p, x), r.patches[x.id]); results.set(solveKey(p), r); if (results.size > 12)
    results.delete(results.keys().next().value!); while (cache.size > 512)
    cache.delete(cache.keys().next().value!); version++; listeners.forEach(f => f()); }
export function getSmoothResult(p: LandmarkProject) { return results.get(solveKey(p)); }
export function getPatchSolution(p: LandmarkProject, x: SurfacePatch) { return cache.get(patchFairKey(p, x)); }
export function evaluationToken(p: LandmarkProject, x?: SurfacePatch): string { if (x) {
    const r = getPatchSolution(p, x);
    return r ? patchFairKey(p, x) + (r.error ?? ':ready') : ':natural';
} return (p.patches ?? []).map(x => evaluationToken(p, x)).join('|'); }
